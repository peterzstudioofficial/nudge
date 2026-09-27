import { describe, expect, it, vi } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";

// A fake Composio: records the session config and what gets executed.
const fake = vi.hoisted(() => ({
  created: [] as unknown[],
  executed: [] as { slug: string; args: unknown }[],
  tools: {
    GOOGLECALENDAR_EVENTS_LIST: { tags: ["readOnlyHint"], toolkit: { slug: "googlecalendar" }, name: "List events" },
    GOOGLECALENDAR_CREATE_EVENT: { tags: [], toolkit: { slug: "googlecalendar" }, name: "Create event" },
    GOOGLECALENDAR_QUICK_ADD: { tags: ["readOnlyHint"], toolkit: { slug: "googlecalendar" }, name: "Quick add" },
    GMAIL_FETCH_EMAILS: { tags: ["readOnlyHint"], toolkit: { slug: "gmail" }, name: "Fetch emails" },
  } as Record<string, { tags: string[]; toolkit: { slug: string }; name: string }>,
}));
vi.mock("@composio/core", () => ({
  Composio: class {
    tools = {
      getRawComposioToolBySlug: async (slug: string) => {
        const t = fake.tools[slug];
        if (!t) throw new Error("not found");
        return t;
      },
    };
    connectedAccounts = { delete: async () => ({}) };
    async create(user: string, config: unknown) {
      fake.created.push({ user, config });
      return {
        execute: async (slug: string, args: unknown) => (fake.executed.push({ slug, args }), { data: { ok: true }, error: null, logId: "log_1" }),
        search: async () => ({
          success: true,
          error: null,
          results: [{ useCase: "list events", primaryToolSlugs: ["GOOGLECALENDAR_EVENTS_LIST", "COMPOSIO_REMOTE_BASH_TOOL"], relatedToolSlugs: [], toolkits: ["googlecalendar"] }],
          toolSchemas: { GOOGLECALENDAR_EVENTS_LIST: { toolSlug: "GOOGLECALENDAR_EVENTS_LIST", toolkit: "googlecalendar", description: "List events", inputSchema: { type: "object" } } },
        }),
        authorize: async () => ({ id: "ca_1", redirectUrl: "https://connect.composio.dev/x" }),
        toolkits: async () => ({ items: [] }),
      };
    }
  },
}));
const { appsService } = await import("./composio");

function setup() {
  const hub = new Hub(new Db(":memory:"));
  hub.db.kvSet("composioToolkits", ["googlecalendar"]);
  const apps = appsService({ hub, apiKey: "ak_test", log: () => {} });
  return { hub, apps };
}

describe("connected apps (Composio sessions)", () => {
  it("offers two small tools and a session with no remote sandbox", async () => {
    const { apps } = setup();
    const tools = await apps.tools();
    expect(tools.map((t) => t.name)).toEqual(["find_app_actions", "use_app"]);
    const found = JSON.parse(await tools[0].run({ query: "what's on" }));
    expect(found[0].actions.map((a: { slug: string }) => a.slug)).toEqual(["GOOGLECALENDAR_EVENTS_LIST"]);
    expect(fake.created.at(-1)).toMatchObject({ user: "nudge-wall", config: { toolkits: ["googlecalendar"], manageConnections: false, sandbox: { enable: false } } });
  });

  it("only real, switched-on app actions run; writes need a yes", async () => {
    const { apps } = setup();
    const use = (await apps.tools())[1];
    expect(await use.needsOk!({ slug: "GOOGLECALENDAR_EVENTS_LIST", arguments: {} })).toEqual({ ok: false });
    expect((await use.needsOk!({ slug: "GOOGLECALENDAR_CREATE_EVENT", arguments: { a: 1 } })).ok).toBe(true);
    // tagged read-only but named like a write → still needs a yes
    expect((await use.needsOk!({ slug: "GOOGLECALENDAR_QUICK_ADD", arguments: {} })).ok).toBe(true);
    expect((await use.needsOk!({ slug: "MADE_UP", arguments: {} })).ok).toBe(true);

    fake.executed.length = 0;
    expect(await use.run({ slug: "COMPOSIO_REMOTE_BASH_TOOL", arguments: {} })).toMatch(/isn't an app action/);
    expect(await use.run({ slug: "GMAIL_FETCH_EMAILS", arguments: {} })).toMatch(/isn't switched on/);
    expect(await use.run({ slug: "GOOGLECALENDAR_EVENTS_LIST", arguments: { max: 5 } })).toContain("ok");
    expect(fake.executed).toEqual([{ slug: "GOOGLECALENDAR_EVENTS_LIST", args: { max: 5 } }]);
  });

  it("an approved ask runs exactly what was shown", async () => {
    const { hub } = setup();
    fake.executed.length = 0;
    await hub.onAppApproved!({ payload: { connector: "GOOGLECALENDAR_CREATE_EVENT", args: { summary: "rehearsal" } } } as never);
    expect(fake.executed).toEqual([{ slug: "GOOGLECALENDAR_CREATE_EVENT", args: { summary: "rehearsal" } }]);
    await hub.onAppApproved!({ payload: { connector: "COMPOSIO_REMOTE_BASH_TOOL", args: {} } } as never);
    expect(fake.executed).toHaveLength(1);
  });
});
