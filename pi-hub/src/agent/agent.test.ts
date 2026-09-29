import { describe, expect, it } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";
import { agentService } from "./agent";
import { openRouter, serverToolsFor, type ChatOptions, type Llm, type Message } from "./llm";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scripted(steps: ((m: Message[]) => { content?: string; tool?: { name: string; args: unknown }; tools?: { name: string; args: unknown }[]; citations?: { url: string; title: string }[] })[]): Llm & { seen: Message[][]; opts: ChatOptions[] } {
  const seen: Message[][] = [];
  const opts: ChatOptions[] = [];
  let i = 0;
  return {
    seen,
    opts,
    async chat(o) {
      const { messages } = o;
      seen.push(structuredClone(messages));
      opts.push(o);
      const s = steps[Math.min(i++, steps.length - 1)](messages);
      const calls = s.tools ?? (s.tool ? [s.tool] : []);
      return {
        content: s.content ?? "",
        toolCalls: calls.map((c, k) => ({ id: `c${i}-${k}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
        finish: calls.length ? "tool_calls" : "stop",
        model: "test",
        cost: 0.0001,
        citations: s.citations ?? [],
        serverToolCalls: s.citations?.length ? 1 : 0,
      };
    },
  };
}

describe("assistant (OpenRouter)", () => {
  it("runs read tools, then answers", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([() => ({ tool: { name: "get_today", args: {} } }), (m) => ({ content: m.some((x) => x.role === "tool" && x.content.includes('"date"')) ? "you have nothing due." : "?" })]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "anything I should worry about today?", mode: "ask", origin: "app" });
    await wait(50);
    const t = hub.threads.get(id)!;
    expect(t.status).toBe("done");
    expect(t.log.at(-1)?.text).toBe("you have nothing due.");
    expect(llm.seen[0][0].role).toBe("system");
  });

  it("never sends: an email becomes an ask waiting for a yes", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([
      () => ({ tool: { name: "propose_email", args: { to_email: "j.hale@churcherscollege.com", to_name: "mr hale", subject: "Write-up", body: "Hi Mr Hale…", ask_summary: "two more days" } } }),
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
    const llm: Llm = { async chat(o) { names = (o.tools ?? []).map((t) => t.function.name); return { content: "ok", toolCalls: [], finish: "stop", model: "t", cost: 0, citations: [], serverToolCalls: 0 }; } };
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

  it("uses OpenRouter's server tools and free extras, with spend caps", async () => {
    let body: Record<string, any> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          model: "x",
          choices: [{
            message: {
              content: "The show opens on 4 Dec.",
              tool_calls: [{ id: "s1", type: "function", function: { name: "openrouter:web_search", arguments: "{}" } }],
              annotations: [
                { type: "url_citation", url_citation: { url: "https://example.org/show", title: "The show" } },
                { type: "url_citation", url_citation: { url: "https://example.org/show", title: "dupe" } },
                { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "bad" } },
              ],
            },
            finish_reason: "stop",
          }],
          usage: { cost: 0.002, server_tool_use_details: { tool_calls_executed: 1 } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const tools = serverToolsFor({ webSearch: true, aiAdvisorModel: "deepseek/deepseek-v4-pro", blockList: ["https://www.youtube.com/", "tiktok.com"] }, { wall: false });
    const r = await openRouter("k", { fetchImpl }).chat({ messages: [{ role: "user", content: "when is the show" }], serverTools: tools, sessionId: "thread-1", effort: "low" });
    expect(r.toolCalls).toEqual([]); // server tools already ran on OpenRouter
    expect(r.citations).toEqual([{ url: "https://example.org/show", title: "The show" }]);
    expect(r.serverToolCalls).toBe(1);
    expect(body.session_id).toBe("thread-1");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.plugins).toContainEqual({ id: "context-compression", engine: "middle-out" });
    expect(body.provider.max_price).toBeTruthy();
    expect(body.stop_server_tools_when).toContainEqual({ type: "max_cost", max_cost_in_dollars: 0.03 });
    const types = body.tools.map((t: { type: string }) => t.type);
    expect(types).toEqual(["openrouter:datetime", "openrouter:web_search", "openrouter:web_fetch", "openrouter:advisor"]);
    const search = body.tools.find((t: { type: string }) => t.type === "openrouter:web_search");
    expect(search.parameters.excluded_domains).toEqual(["www.youtube.com", "tiktok.com"]);
    expect(body.tools.find((t: { type: string }) => t.type === "openrouter:advisor").parameters.forward_transcript).toBe(false);
  });

  it("keeps the wall lean: no advisor, fewer searches; web search can be switched off", () => {
    const wall = serverToolsFor({ webSearch: true, aiAdvisorModel: "m", blockList: [] }, { wall: true });
    expect(wall.map((t) => t.type)).toEqual(["openrouter:datetime", "openrouter:web_search", "openrouter:web_fetch"]);
    expect(wall[1].parameters?.max_uses).toBe(1);
    expect(serverToolsFor({ webSearch: false, aiAdvisorModel: "", blockList: [] }, { wall: false }).map((t) => t.type)).toEqual(["openrouter:datetime"]);
  });

  it("runs several read tools at once and lists the web sources it used", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([
      () => ({ tools: [{ name: "get_today", args: {} }, { name: "get_week", args: {} }] }),
      () => ({ content: "Rehearsal is at 4.", citations: [{ url: "https://example.org/a", title: "A" }] }),
    ]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "when's rehearsal", mode: "ask", origin: "app" });
    await wait(60);
    const t = hub.threads.get(id)!;
    expect(llm.seen[1].filter((m) => m.role === "tool")).toHaveLength(2);
    expect(llm.opts[0].sessionId).toBe(id);
    expect(llm.opts[0].serverTools?.some((x) => x.type === "openrouter:web_search")).toBe(true);
    expect(t.log.some((l) => l.text.includes("https://example.org/a"))).toBe(true);
    expect(t.log.at(-1)?.text).toBe("Rehearsal is at 4.");
  });

  it("titles voice notes with a structured answer (response healing on)", async () => {
    const hub = new Hub(new Db(":memory:"));
    hub.updateSettings("owner", { ai: true });
    let body: Record<string, any> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"chorus idea for act two","tags":["Music","idea!"]}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const agent = agentService({ hub, llm: openRouter("k", { fetchImpl }), say: () => {}, log: () => {} });
    const t = await agent.tidyNote!("so for act two I think the chorus should come in earlier");
    expect(t).toEqual({ label: "chorus idea for act two", tags: ["music", "idea"] });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.plugins).toContainEqual({ id: "response-healing" });
    expect(body.tools).toBeUndefined();
  });

  it("asks again without the reasoning hint if no zero-retention endpoint takes it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      if (b.reasoning) return new Response(JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters." } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await openRouter("k", { fetchImpl }).chat({ messages: [{ role: "user", content: "hi" }], effort: "low" });
    expect(r.content).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reasoning).toBeUndefined();
  });

  it("app actions: reading runs, changing waits for a yes, and never outside act mode", async () => {
    const ran: string[] = [];
    const appTool = {
      name: "use_app",
      description: "Run one action in a connected app",
      parameters: { type: "object" },
      kind: "read" as const,
      needsOk: async (a: unknown) => {
        const slug = (a as { slug: string }).slug;
        return slug.includes("LIST") ? { ok: false as const } : { ok: true as const, connector: slug, args: (a as { arguments: unknown }).arguments, label: "create event" };
      },
      run: async (a: unknown) => (ran.push((a as { slug: string }).slug), "[]"),
    };
    const make = (steps: Parameters<typeof scripted>[0]) => {
      const hub = new Hub(new Db(":memory:"));
      const agent = agentService({ hub, llm: scripted(steps), say: () => {}, log: () => {}, extraTools: async (_m, gate) => [gate(appTool)] });
      return { hub, agent };
    };
    const a = make([() => ({ tool: { name: "use_app", args: { slug: "GOOGLECALENDAR_EVENTS_LIST", arguments: {} } } }), () => ({ content: "free all week" })]);
    a.agent.run({ prompt: "am I free", mode: "ask", origin: "app" });
    await wait(40);
    expect(ran).toEqual(["GOOGLECALENDAR_EVENTS_LIST"]);

    const b = make([() => ({ tool: { name: "use_app", args: { slug: "GOOGLECALENDAR_CREATE_EVENT", arguments: { summary: "rehearsal" } } } }), () => ({ content: "ok" })]);
    b.agent.run({ prompt: "add rehearsal", mode: "act", origin: "app" });
    await wait(40);
    expect(ran).toEqual(["GOOGLECALENDAR_EVENTS_LIST"]); // not run
    expect(b.hub.pendingAsks()[0].payload).toEqual({ connector: "GOOGLECALENDAR_CREATE_EVENT", args: { summary: "rehearsal" } });

    const c = make([() => ({ tool: { name: "use_app", args: { slug: "GOOGLECALENDAR_CREATE_EVENT", arguments: {} } } }), (m) => ({ content: String(m.at(-1)?.content) })]);
    const id = c.agent.run({ prompt: "add rehearsal", mode: "watch", origin: "app" });
    await wait(40);
    expect(c.hub.pendingAsks()).toHaveLength(0);
    expect(c.hub.threads.get(id)!.log.at(-1)?.text).toMatch(/isn't allowed in this mode/);
  });

  it("offers the Claude hand-off only when the computer can take it, and only as an ask", async () => {
    const hub = new Hub(new Db(":memory:"));
    let names: string[] = [];
    const peek: Llm = { async chat(o) { names = (o.tools ?? []).map((t) => t.function.name); return { content: "ok", toolCalls: [], finish: "stop", model: "t", cost: 0, citations: [], serverToolCalls: 0 }; } };
    agentService({ hub, llm: peek, say: () => {}, log: () => {} }).run({ prompt: "hi", mode: "act", origin: "app" });
    await wait(20);
    expect(names).not.toContain("hand_to_claude");

    hub.setClaudeDesktop({ workspaces: ["portfolio"], desktopApp: true, cli: true, allowRun: true, runMode: "plan", chat: false });
    const llm = scripted([
      () => ({ tool: { name: "hand_to_claude", args: { target: "code_run", task: "Make the nav bar sticky on mobile", folder: "portfolio", summary: "sticky nav" } } }),
      () => ({ content: "asked" }),
    ]);
    const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "fix my site nav", mode: "act", origin: "app" });
    await wait(40);
    const [ask] = hub.pendingAsks();
    expect(ask.kind).toBe("claude");
    expect(ask.payload).toEqual({ target: "code_run", task: "Make the nav bar sticky on mobile", workspace: "portfolio", threadId: id });
    expect(hub.pendingHandoffs()).toHaveLength(0);
  });

  it("never uses big expensive models, and stops at the monthly budget", async () => {
    const hub = new Hub(new Db(":memory:"));
    for (const m of ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra", "google/gemini-3.8-pro", "x-ai/grok-4"]) {
      expect(() => hub.updateSettings("owner", { aiModel: m })).toThrow(/expensive/);
    }
    for (const m of ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4-pro", "z-ai/glm-5.3-flash", "google/gemini-3.8-flash", "x-ai/grok-4-fast", "@preset/nudge"]) {
      expect(() => hub.updateSettings("owner", { aiModel: m })).not.toThrow();
    }
    hub.updateSettings("owner", { aiBudgetUsd: 1 });
    hub.db.kvSet("aiSpend", { [hub.todayKey().slice(0, 7)]: 1.2 });
    const llm = scripted([() => ({ content: "should not be called" })]);
    const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "hi", mode: "ask", origin: "app" });
    await wait(20);
    expect(llm.seen).toHaveLength(0);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/budget/);
  });

  it("stops a single question that's getting pricey", async () => {
    const hub = new Hub(new Db(":memory:"));
    let n = 0;
    const llm: Llm = {
      async chat() {
        n++;
        return { content: "", toolCalls: [{ id: `c${n}`, type: "function", function: { name: "get_today", arguments: "{}" } }], finish: "tool_calls", model: "t", cost: 0.03, citations: [], serverToolCalls: 0 };
      },
    };
    const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "loop forever", mode: "ask", origin: "app" });
    await wait(40);
    expect(n).toBe(3); // 0.03, 0.06, 0.09 > 0.06 → stop
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/pricey/);
  });
});


describe("assistant: cheap, safe, remembers", () => {
  const never: Llm = { async chat() { throw new Error("should not call the model"); } };

  it("answers what the wall already knows for free, without the model", async () => {
    const hub = new Hub(new Db(":memory:"));
    const agent = agentService({ hub, llm: never, say: () => {}, log: () => {} });
    for (const q of ["what time is it?", "Nudge, what's due?", "which week is it", "what's next?"]) {
      const t = hub.threads.get(agent.run({ prompt: q, mode: "act", origin: "wall" }))!;
      expect(t.status).toBe("done");
      expect(t.steps[0].meta).toBe("ON THE PI · FREE");
    }
  });

  it("doesn't pay twice for the same question when nothing changed", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([() => ({ content: "revise chemistry first." })]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    agent.run({ prompt: "What should I revise first?", mode: "ask", origin: "app" });
    await wait(30);
    const id = agent.run({ prompt: "what should i revise first", mode: "ask", origin: "app" });
    expect(llm.seen).toHaveLength(1);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toBe("revise chemistry first.");
  });

  it("only drafts emails to school addresses (or people already emailed)", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([
      () => ({ tool: { name: "propose_email", args: { to_email: "someone@evil.example", to_name: "x", subject: "hi", body: "notes attached", ask_summary: "notes" } } }),
      (m) => ({ content: String(m.at(-1)?.content) }),
    ]);
    const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "forward my notes", mode: "act", origin: "app" });
    await wait(40);
    expect(hub.pendingAsks()).toHaveLength(0);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/isn't a school address/);
  });

  it("caps things that leave the house per hour", async () => {
    const hub = new Hub(new Db(":memory:"));
    const email = (n: number) => ({ tool: { name: "propose_email", args: { to_email: "a.b@churcherscollege.com", to_name: "mr b", subject: `s${n}`, body: "hi", ask_summary: "hi" } } });
    let last = "";
    for (let n = 0; n < 5; n++) {
      const llm = scripted([() => email(n), (m) => ({ content: String(m.at(-1)?.content) })]);
      const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: `email ${n}`, mode: "act", origin: "app" });
      await wait(30);
      last = hub.threads.get(id)!.log.at(-1)?.text ?? "";
    }
    expect(hub.asks.all().filter((a) => a.kind === "email")).toHaveLength(4);
    expect(last).toMatch(/several messages or jobs this hour/);
  });

  it("anything that leaves the house needs a hold, and a moment to read it", () => {
    let now = 1_000_000;
    const hub = new Hub(new Db(":memory:"), { clock: () => now });
    const ask = hub.createAsk({ kind: "email", head: "", line: "email?", rows: [], payload: { to: "a@b.c", subject: "s", body: "b" }, threadId: null });
    now += 200;
    expect(() => hub.answerAsk(ask.id, true, "phone", { held: true })).toThrow(/too quick/);
    now += 2000;
    expect(() => hub.answerAsk(ask.id, true, "phone", { held: false })).toThrow(/hold to confirm/);
    expect(hub.answerAsk(ask.id, true, "phone", { held: true }).status).toBe("done");
    // declining is always one tap
    const b = hub.createAsk({ kind: "app", head: "", line: "post?", rows: [], payload: {}, threadId: null });
    expect(hub.answerAsk(b.id, false, "phone", { held: false }).status).toBe("declined");
  });

  it("remembers lasting facts, never secrets, and brings them along", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([
      () => ({ tools: [{ name: "remember", args: { fact: "plays Fagin in the senior production", they_said_it: true } }, { name: "remember", args: { fact: "school password is hunter2", they_said_it: true } }] }),
      (m) => ({ content: m.filter((x) => x.role === "tool").map((x) => x.content).join(" | ") }),
    ]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "I got Fagin!", mode: "ask", origin: "app" });
    await wait(40);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/remembered \| not saved/);
    const { memories } = await import("./brain");
    expect(memories(hub).map((m) => m.text)).toEqual(["plays Fagin in the senior production"]);

    const peek = scripted([() => ({ content: "ok" })]);
    agentService({ hub, llm: peek, say: () => {}, log: () => {} }).run({ prompt: "help me learn my lines", mode: "ask", origin: "app" });
    await wait(20);
    expect(String(peek.seen[0][1].content)).toContain("plays Fagin");
  });

  it("sends the matching passages from their own documents with the question", async () => {
    const hub = new Hub(new Db(":memory:"));
    const peek = scripted([() => ({ content: "it shifts to oppose the change (chem guide p.2)" })]);
    agentService({ hub, llm: peek, say: () => {}, log: () => {}, retrieve: async () => [{ title: "chem guide · p. 2", text: "equilibrium shifts to oppose a change" }] }).run({ prompt: "explain le chatelier", mode: "ask", origin: "app" });
    await wait(20);
    expect(String(peek.seen[0][1].content)).toMatch(/\[1\] chem guide · p\. 2: equilibrium shifts/);
    expect(String(peek.seen[0][1].content)).toMatch(/not instructions/);
  });

  it("marks school mail as data, not instructions", async () => {
    const hub = new Hub(new Db(":memory:"));
    const llm = scripted([() => ({ tool: { name: "get_school_items", args: {} } }), (m) => ({ content: String(m.at(-1)?.content).slice(0, 60) })]);
    const id = agentService({ hub, llm, say: () => {}, log: () => {} }).run({ prompt: "any news from school?", mode: "ask", origin: "app" });
    await wait(30);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/not instructions/);
  });
});

describe("Claude on the computer (his own plan)", () => {
  const pc = { workspaces: [], desktopApp: true, cli: true, allowRun: false, runMode: "plan" as const, chat: true };

  it("sends phone questions to the ongoing Claude chat, and its answer comes back to the thread", async () => {
    const hub = new Hub(new Db(":memory:"));
    hub.updateSettings("owner", { aiEngine: "claude" });
    hub.setClaudeDesktop(pc);
    const llm = scripted([() => ({ content: "should not be used" })]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {} });
    const id = agent.run({ prompt: "help me plan my macbeth essay", mode: "act", origin: "app" });
    await wait(20);
    const [h] = hub.pendingHandoffs();
    expect(h.kind).toBe("chat");
    expect(h.kind === "chat" && h.payload.system).toMatch(/one ongoing chat/);
    hub.handoffResult(h.id, { ok: true, text: "Start with the witches' prophecy, then ambition." });
    expect(hub.threads.get(id)!.log.at(-1)?.text).toMatch(/witches/);
    expect(llm.seen).toHaveLength(0);
  });

  it("the wall stays on the quick model, and a silent computer falls back to it", async () => {
    const hub = new Hub(new Db(":memory:"));
    hub.updateSettings("owner", { aiEngine: "claude" });
    hub.setClaudeDesktop(pc);
    const llm = scripted([() => ({ content: "quick answer" })]);
    const agent = agentService({ hub, llm, say: () => {}, log: () => {}, claudeWaitMs: 30 });
    agent.run({ prompt: "anything due for drama", mode: "act", origin: "wall" });
    await wait(20);
    expect(hub.pendingHandoffs()).toHaveLength(0);
    const id = agent.run({ prompt: "what should I revise tonight", mode: "act", origin: "app" });
    await wait(80);
    expect(hub.threads.get(id)!.log.at(-1)?.text).toBe("quick answer");
    expect(hub.pendingHandoffs()).toHaveLength(0);
    // a late answer from the computer is ignored
    const late = hub.handoffs.all().find((x) => x.kind === "chat")!;
    hub.handoffResult(late.id, { ok: true, text: "late" });
    expect(hub.threads.get(id)!.log.at(-1)?.text).toBe("quick answer");
  });

  it("gives Claude the same tools with the same rules (proposals still need a held yes)", async () => {
    const hub = new Hub(new Db(":memory:"));
    const agent = agentService({ hub, llm: null, say: () => {}, log: () => {} });
    const names = (await agent.toolList!()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_today", "search_notes", "propose_email", "remember"]));
    expect(names).not.toContain("hand_to_claude");
    expect(await agent.callTool!("get_today", {})).toMatch(/"date"/);
    expect(await agent.callTool!("propose_email", { to_email: "x@evil.example", to_name: "x", subject: "s", body: "b", ask_summary: "a" })).toMatch(/isn't a school address/);
    await agent.callTool!("propose_email", { to_email: "a.b@churcherscollege.com", to_name: "mr b", subject: "s", body: "b", ask_summary: "a" });
    const [ask] = hub.pendingAsks();
    expect(ask.kind).toBe("email");
    expect(() => hub.answerAsk(ask.id, true, "phone", { held: false })).toThrow(/hold/);
  });
});
