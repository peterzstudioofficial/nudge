import { describe, expect, it } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";
import { agentService } from "./agent";
import { openRouter, type Llm, type Message } from "./llm";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scripted(steps: ((m: Message[]) => { content?: string; tool?: { name: string; args: unknown } })[]): Llm & { seen: Message[][] } {
  const seen: Message[][] = [];
  let i = 0;
  return {
    seen,
    async chat({ messages }) {
      seen.push(structuredClone(messages));
      const s = steps[Math.min(i++, steps.length - 1)](messages);
      return {
        content: s.content ?? "",
        toolCalls: s.tool ? [{ id: `c${i}`, type: "function", function: { name: s.tool.name, arguments: JSON.stringify(s.tool.args) } }] : [],
        finish: s.tool ? "tool_calls" : "stop",
        model: "test",
        cost: 0.0001,
      };
    },
  };
}

describe("assistant (OpenRouter)", () => {
  it("runs read tools, then answers", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([() => ({ tool: { name: "get_today", args: {} } }), (m) => ({ content: m.some((x) => x.role === "tool" && x.content.includes('"date"')) ? "you have nothing due." : "?" })]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "what's due?", mode: "ask", origin: "app" });
    await wait(50);
    const t = hub.threads.get(id)!;
    expect(t.status).toBe("done");
    expect(t.log.at(-1)?.text).toBe("you have nothing due.");
    expect(llm.seen[0][0].role).toBe("system");
  });

  it("never sends: an email becomes an ask waiting for a yes", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([
      () => ({ tool: { name: "propose_email", args: { to_email: "j.hale@school.org.uk", to_name: "mr hale", subject: "Write-up", body: "Hi Mr Hale…", ask_summary: "two more days" } } }),
      () => ({ content: "done" }),
    ]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "email mr hale", mode: "act", origin: "desktop" });
    await wait(50);
    expect(hub.threads.get(id)!.status).toBe("asking");
    expect(hub.pendingAsks()).toHaveLength(1);
    expect(hub.pendingHandoffs()).toHaveLength(0);
  });

  it("in ask mode the model can't even see the propose tools", async () => {
    const hub = new Hub(new Db(":memory:"));
    let names: string[] = [];
    const llm: Llm = { async chat(o) { names = (o.tools ?? []).map((t) => t.function.name); return { content: "ok", toolCalls: [], finish: "stop", model: "t", cost: 0 }; } };
    agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "hi", mode: "ask", origin: "app" });
    await wait(20);
    expect(names).toContain("get_today");
    expect(names.some((n) => n.startsWith("propose_"))).toBe(false);
  });

  it("asks OpenRouter for zero-retention providers only", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ model: "x", choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { cost: 0.00002 } }), { status: 200 });
    }) as unknown as typeof fetch;
    let spent = 0;
    const r = await openRouter("sk-or-test", { fetchImpl, onCost: (c) => (spent += c) }).chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("hi");
    expect(body.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(spent).toBeCloseTo(0.00002);
  });

  it("connected-app writes wait for a yes, then run exactly as shown", async () => {
    const hub = new Hub(new Db(":memory:"));
    const ran: unknown[] = [];
    hub.onAppApproved = async (a) => void ran.push(a.payload);
    const llm = scripted([() => ({ tool: { name: "GOOGLECALENDAR_CREATE_EVENT", args: { summary: "rehearsal" } } }), () => ({ content: "ok" })]);
    const agent = agentService({
      hub, llm, say: () => {}, log: () => {},
      extraTools: async (_m, gate) => [gate({ name: "GOOGLECALENDAR_CREATE_EVENT", description: "Google Calendar: create an event", parameters: { type: "object" }, kind: "ask", run: async () => { ran.push("DIRECT"); return "made"; } })],
    });
    agent.run({ prompt: "add rehearsal", mode: "act", origin: "app" });
    await wait(50);
    expect(ran).toEqual([]); // nothing happened yet
    const [ask] = hub.pendingAsks();
    expect(ask.kind).toBe("app");
    hub.answerAsk(ask.id, true, "owner");
    await wait(10);
    expect(ran).toEqual([{ connector: "GOOGLECALENDAR_CREATE_EVENT", args: { summary: "rehearsal" } }]);
  });
});
