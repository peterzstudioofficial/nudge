import type { Composio } from "@composio/core";
import type { Ask } from "@nudge/shared";
import type { Hub } from "../hub";
import type { Tool } from "./tools";

/**
 * Connected apps through Composio sessions (Google Calendar, Gmail, Notion, Spotify…).
 *
 * - One Composio user for the whole wall; Peter signs in to each app once, in his browser.
 * - The model gets two tools instead of hundreds: `find_app_actions` (Composio's semantic tool
 *   search, limited to the apps switched on in setup) and `use_app`. That keeps every request
 *   small and cheap.
 * - An action counts as read-only only if Composio tags it `readOnlyHint` AND its name doesn't
 *   look like a write. Everything else becomes an ask and only runs after a yes, exactly as shown.
 * - Composio's remote sandbox (code/bash) and its own meta tools are never exposed.
 */
const USER = "nudge-wall";
const WRITE = /(SEND|CREATE|DELETE|REMOVE|UPDATE|EDIT|PATCH|POST|REPLY|FORWARD|MOVE|ADD|INSERT|SHARE|INVITE|UPLOAD|PUBLISH|ARCHIVE|TRASH|MARK|SET|PLAY|PAUSE|SKIP|FOLLOW|LIKE|SUBSCRIBE|PAY|BUY|ORDER|BOOK|EXECUTE|RUN)/;

export const SUGGESTED_TOOLKITS = [
  { slug: "googlecalendar", name: "Google Calendar" },
  { slug: "gmail", name: "Gmail (personal)" },
  { slug: "googledrive", name: "Google Drive" },
  { slug: "googletasks", name: "Google Tasks" },
  { slug: "notion", name: "Notion" },
  { slug: "spotify", name: "Spotify" },
  { slug: "youtube", name: "YouTube" },
];

/** A tool whose need for a yes depends on what it's asked to do. */
export type AppTool = Omit<Tool, "run"> & {
  run(args: unknown): Promise<string>;
  /** true → this call must wait for the student's OK (it's turned into an ask) */
  needsOk?(args: unknown): Promise<{ ok: false } | { ok: true; connector: string; args: unknown; label: string }>;
};

export interface AppsService {
  available(): boolean;
  status(): Promise<{ toolkits: string[]; connected: { toolkit: string; status: string; id: string }[] }>;
  connect(toolkit: string): Promise<{ url: string | null; id: string }>;
  disconnect(id: string): Promise<void>;
  tools(): Promise<AppTool[]>;
}

type Session = Awaited<ReturnType<Composio["create"]>>;

export function appsService(o: { hub: Hub; apiKey: string | null; log: (m: string) => void }): AppsService {
  // Loaded on first use, so a wall without connected apps never pays for the SDK's memory.
  let sdk: Promise<Composio> | null = null;
  const client = (): Promise<Composio> | null =>
    o.apiKey ? (sdk ??= import("@composio/core").then(({ Composio }) => new Composio({ apiKey: o.apiKey!, allowTracking: false }))) : null;
  const enabled = () => o.hub.db.kvGet<string[]>("composioToolkits", []);

  // One session per set of switched-on apps.
  let session: { key: string; s: Promise<Session> } | null = null;
  const getSession = async (): Promise<Session> => {
    const c = await client();
    if (!c) throw new Error("connected apps are off");
    const key = enabled().slice().sort().join(",");
    if (!session || session.key !== key) {
      const s = c.create(USER, {
        toolkits: enabled(),
        // Our own setup page handles sign-ins; no remote code sandbox.
        manageConnections: false,
        sandbox: { enable: false },
      });
      session = { key, s };
      s.catch(() => (session = null));
    }
    return session.s;
  };

  // What each action is: its app, and whether it only reads.
  const info = new Map<string, Promise<{ toolkit: string; readOnly: boolean; name: string }>>();
  const toolInfo = (slug: string) => {
    let p = info.get(slug);
    if (!p) {
      p = (async () => {
        const c = (await client())!;
        const t = await c.tools.getRawComposioToolBySlug(slug);
        const readOnly = (t.tags ?? []).includes("readOnlyHint") && !WRITE.test(slug.replace(/^[A-Z0-9]+_/, ""));
        return { toolkit: (t.toolkit?.slug ?? "").toLowerCase(), readOnly, name: t.name ?? slug };
      })();
      p.catch(() => info.delete(slug));
      info.set(slug, p);
    }
    return p;
  };

  const run = async (slug: string, args: unknown): Promise<string> => {
    const s = await getSession();
    const r = await Promise.race([
      s.execute(slug, (args ?? {}) as Record<string, unknown>),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("the app took too long")), 30_000).unref()),
    ]);
    if (r.error) {
      o.log(`apps: ${slug} failed (log ${r.logId})`);
      return `error: ${r.error}`.slice(0, 400);
    }
    return JSON.stringify(r.data).slice(0, 8000);
  };

  /** Only real app actions from switched-on apps; never Composio's own meta/sandbox tools. */
  const allowed = async (slug: string) => {
    if (!/^[A-Z0-9_]{3,80}$/.test(slug) || slug.startsWith("COMPOSIO_")) return "that isn't an app action";
    const i = await toolInfo(slug).catch(() => null);
    if (!i) return "no such app action";
    if (!enabled().includes(i.toolkit)) return `${i.toolkit || "that app"} isn't switched on`;
    return null;
  };

  // An approved app action (from an ask) runs here, exactly as it was shown.
  o.hub.onAppApproved = async (a: Ask) => {
    const p = a.payload as { connector?: string; args?: unknown };
    if (!p.connector || (await allowed(p.connector))) return;
    const what = p.connector.toLowerCase().replace(/_/g, " ");
    try {
      const out = await run(p.connector, p.args);
      o.hub.feed("agent", out.startsWith("error") ? `Couldn't ${what}` : `Done: ${what}`);
    } catch (e) {
      o.log(`app action failed: ${(e as Error).message}`);
    }
  };

  const findActions: AppTool = {
    name: "find_app_actions",
    description:
      "Find actions in the student's connected apps (e.g. Google Calendar, Notion, Spotify). Describe what you want to do; returns action slugs with their input schemas. Then call use_app.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "what you want to do, e.g. 'list next week's calendar events'" } },
      required: ["query"],
      additionalProperties: false,
    },
    kind: "read",
    async run(args) {
      const q = String((args as { query?: unknown })?.query ?? "").slice(0, 300);
      if (!q) return "error: say what you want to do";
      const s = await getSession();
      const r = await s.search({ query: q, toolkits: enabled() });
      if (!r.success) return `error: ${r.error ?? "search failed"}`;
      const out = r.results.slice(0, 3).map((x) => ({
        use_case: x.useCase,
        guidance: x.executionGuidance?.slice(0, 400),
        pitfalls: x.knownPitfalls?.slice(0, 3),
        actions: [...x.primaryToolSlugs, ...x.relatedToolSlugs.slice(0, 2)]
          .filter((slug) => !slug.startsWith("COMPOSIO_"))
          .map((slug) => {
            const sc = r.toolSchemas[slug];
            return { slug, app: sc?.toolkit, description: sc?.description?.slice(0, 200), input: sc?.inputSchema };
          }),
      }));
      return JSON.stringify(out).slice(0, 7000);
    },
  };

  const useApp: AppTool = {
    name: "use_app",
    description:
      "Run one action in a connected app, by slug from find_app_actions. Reading runs straight away; anything that sends, creates, changes or deletes something is shown to the student and only happens after they say yes.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "action slug, e.g. GOOGLECALENDAR_EVENTS_LIST" },
        arguments: { type: "object", description: "the action's input, matching its schema" },
      },
      required: ["slug", "arguments"],
      additionalProperties: false,
    },
    kind: "read",
    async needsOk(args) {
      const a = (args ?? {}) as { slug?: string; arguments?: unknown };
      const slug = String(a.slug ?? "");
      const i = await toolInfo(slug).catch(() => null);
      if (i?.readOnly) return { ok: false };
      return { ok: true, connector: slug, args: a.arguments ?? {}, label: i?.name ?? slug };
    },
    async run(args) {
      const a = (args ?? {}) as { slug?: string; arguments?: unknown };
      const slug = String(a.slug ?? "");
      const bad = await allowed(slug);
      if (bad) return `error: ${bad}`;
      return run(slug, a.arguments);
    },
  };

  return {
    available: () => !!o.apiKey,
    async status() {
      if (!o.apiKey || !enabled().length) return { toolkits: enabled(), connected: [] };
      const s = await getSession();
      const r = await s.toolkits({ toolkits: enabled() });
      const connected = r.items
        .filter((i) => i.connection?.connectedAccount)
        .map((i) => ({ toolkit: i.slug, status: i.connection!.connectedAccount!.status, id: i.connection!.connectedAccount!.id }));
      return { toolkits: enabled(), connected };
    },
    async connect(toolkit) {
      if (!o.apiKey) throw new Error("connected apps are off");
      if (!/^[a-z0-9_-]{2,40}$/.test(toolkit)) throw new Error("bad app name");
      const list = enabled();
      if (!list.includes(toolkit)) o.hub.db.kvSet("composioToolkits", [...list, toolkit].slice(0, 12));
      const s = await getSession();
      const req = await s.authorize(toolkit);
      return { url: req.redirectUrl ?? null, id: req.id };
    },
    async disconnect(id) {
      const c = await client();
      if (!c) return;
      await c.connectedAccounts.delete(id);
    },
    async tools() {
      if (!o.apiKey || !enabled().length) return [];
      return [findActions, useApp];
    },
  };
}
