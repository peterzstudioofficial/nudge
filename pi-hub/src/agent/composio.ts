import type { Composio } from "@composio/core";
import type { Ask } from "@nudge/shared";
import type { Hub } from "../hub";
import type { Tool } from "./tools";

/**
 * Connected apps through Composio (Google Calendar, Gmail, Notion, Spotify…).
 *
 * - One Composio "user" for the whole wall; the OAuth sign-ins are done by Peter in his browser.
 * - Tools are only offered from toolkits switched on in setup, "important" ones only, so the
 *   cheap model isn't drowned in hundreds of tools.
 * - A tool counts as read-only only if Composio tags it `readOnlyHint` AND its name doesn't
 *   look like a write. Everything else becomes an ask and only runs after a yes.
 */
const USER = "nudge-wall";
const WRITE = /(SEND|CREATE|DELETE|REMOVE|UPDATE|EDIT|PATCH|POST|REPLY|FORWARD|MOVE|ADD|INSERT|SHARE|INVITE|UPLOAD|PUBLISH|ARCHIVE|TRASH|MARK|SET|PLAY|PAUSE|SKIP|FOLLOW|LIKE|SUBSCRIBE|PAY|BUY|ORDER|BOOK)/;

export const SUGGESTED_TOOLKITS = [
  { slug: "googlecalendar", name: "Google Calendar" },
  { slug: "gmail", name: "Gmail (personal)" },
  { slug: "googledrive", name: "Google Drive" },
  { slug: "googletasks", name: "Google Tasks" },
  { slug: "notion", name: "Notion" },
  { slug: "spotify", name: "Spotify" },
  { slug: "youtube", name: "YouTube" },
];

export interface AppsService {
  available(): boolean;
  status(): Promise<{ toolkits: string[]; connected: { toolkit: string; status: string; id: string }[] }>;
  connect(toolkit: string): Promise<{ url: string | null; id: string }>;
  disconnect(id: string): Promise<void>;
  tools(): Promise<(Omit<Tool, "run"> & { run(args: unknown): Promise<string> })[]>;
}

export function appsService(o: { hub: Hub; apiKey: string | null; log: (m: string) => void }): AppsService {
  // Loaded on first use, so a wall without connected apps never pays for the SDK's memory.
  let sdk: Promise<Composio> | null = null;
  const client = (): Promise<Composio> | null =>
    o.apiKey ? (sdk ??= import("@composio/core").then(({ Composio }) => new Composio({ apiKey: o.apiKey!, allowTracking: false }))) : null;
  let cache: { at: number; list: Awaited<ReturnType<AppsService["tools"]>> } | null = null;
  const enabled = () => o.hub.db.kvGet<string[]>("composioToolkits", []);

  const run = async (slug: string, args: unknown): Promise<string> => {
    const c = await client();
    if (!c) return "error: connected apps are off";
    const r = await c.tools.execute(slug, { userId: USER, arguments: (args ?? {}) as Record<string, unknown>, dangerouslySkipVersionCheck: true }, { signal: AbortSignal.timeout(30_000) });
    if (!r.successful) return `error: ${r.error ?? "failed"}`.slice(0, 400);
    return JSON.stringify(r.data).slice(0, 8000);
  };

  // An approved app action (from an ask) runs here, exactly as it was shown.
  o.hub.onAppApproved = async (a: Ask) => {
    const p = a.payload as { connector?: string; args?: unknown };
    if (!p.connector) return;
    try {
      const out = await run(p.connector, p.args);
      o.hub.feed("agent", out.startsWith("error") ? `Couldn't ${p.connector.toLowerCase().replace(/_/g, " ")}` : `Done: ${p.connector.toLowerCase().replace(/_/g, " ")}`);
    } catch (e) {
      o.log(`app action failed: ${(e as Error).message}`);
    }
  };

  return {
    available: () => !!o.apiKey,
    async status() {
      const c = await client();
      if (!c) return { toolkits: enabled(), connected: [] };
      const list = await c.connectedAccounts.list({ userIds: [USER] });
      const items = (list as { items?: { id: string; status: string; toolkit?: { slug: string } }[] }).items ?? [];
      return { toolkits: enabled(), connected: items.map((i) => ({ id: i.id, status: i.status, toolkit: i.toolkit?.slug ?? "" })) };
    },
    async connect(toolkit) {
      const c = await client();
      if (!c) throw new Error("connected apps are off");
      if (!/^[a-z0-9_-]{2,40}$/.test(toolkit)) throw new Error("bad app name");
      const req = await c.toolkits.authorize(USER, toolkit);
      const list = enabled();
      if (!list.includes(toolkit)) o.hub.db.kvSet("composioToolkits", [...list, toolkit].slice(0, 12));
      cache = null;
      return { url: (req as { redirectUrl?: string | null }).redirectUrl ?? null, id: (req as { id: string }).id };
    },
    async disconnect(id) {
      const c = await client();
      if (!c) return;
      await c.connectedAccounts.delete(id);
      cache = null;
    },
    async tools() {
      if (!o.apiKey || !enabled().length) return [];
      if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
      const c = (await client())!;
      const out: Awaited<ReturnType<AppsService["tools"]>> = [];
      for (const tk of enabled()) {
        try {
          const raw = await c.tools.getRawComposioTools({ toolkits: [tk], important: true, limit: 12 });
          for (const t of raw) {
            const readOnly = (t.tags ?? []).includes("readOnlyHint") && !WRITE.test(t.slug.replace(/^[A-Z0-9]+_/, ""));
            out.push({
              name: t.slug.slice(0, 64),
              description: `${t.toolkit?.name ?? tk}: ${(t.description ?? t.name).slice(0, 300)}`,
              parameters: (t.inputParameters as Record<string, unknown>) ?? { type: "object", properties: {} },
              kind: readOnly ? "read" : "ask",
              run: (args) => run(t.slug, args),
            });
          }
        } catch (e) {
          o.log(`apps: couldn't load ${tk}: ${(e as Error).message}`);
        }
      }
      cache = { at: Date.now(), list: out };
      return out;
    },
  };
}
