// A stand-in for OpenRouter on loopback: answers like a cheap model would, records every request.
import http from "node:http";
import fs from "node:fs";
const LOG = process.argv[2];
const port = Number(process.argv[3] || 9990);
const vec = (t) => { const v = new Array(64).fill(0); for (const w of String(t).toLowerCase().match(/[a-z]{3,}/g) || []) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 64] += 1; } return v; };
const reply = (res, j) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
const msg = (content, tool_calls) => ({ id: "gen-1", model: "deepseek/deepseek-v4.1-flash", choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? "tool_calls" : "stop" }], usage: { cost: 0.0002, prompt_tokens: 900, completion_tokens: 60 } });
const call = (name, args) => [{ id: "call_" + Math.random().toString(16).slice(2, 8), type: "function", function: { name, arguments: JSON.stringify(args) } }];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
    let b = {}; try { b = JSON.parse(raw || "{}"); } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ url: req.url, auth: !!req.headers.authorization, body: b }) + "\n");
    if (req.url.endsWith("/key")) return reply(res, { data: { label: "test", limit: 5, usage: 0.01, limit_remaining: 4.99 } });
    if (req.url.endsWith("/embeddings")) return reply(res, { data: b.input.map((t, i) => ({ index: i, embedding: vec(t) })), usage: { cost: 0.000002 } });
    if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); return res.end("{}"); }
    const msgs = b.messages || [];
    const last = msgs[msgs.length - 1] || {};
    // OCR: a file or image part in the request
    if (Array.isArray(last.content) && last.content.some((p) => p.type === "file" || p.type === "image_url")) return reply(res, msg("=== page 1 ===\nAn Inspector Calls: Mr Birling is arrogant and selfish.\n=== page 2 ===\nSheila Birling changes the most in the play."));
    const tools = (b.tools || []).map((t) => t.function?.name);
    if (!tools.length) return reply(res, msg(b.response_format ? JSON.stringify({ title: "song idea", tags: ["music"] }) : "ok"));
    const user = msgs.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n").toLowerCase();
    if (last.role === "tool") {
      const t = String(last.content);
      if (t.startsWith("Opened ")) return reply(res, msg("It's up on the wall."));
      if (t.includes("waiting for the student's OK")) return reply(res, msg("I've drafted it — hold yes on your phone to get it ready in Outlook."));
      const lesson = /"subject":"([^"]+)","time":"([0-9:]+)/.exec(t);
      if (lesson) return reply(res, msg(`First up is ${lesson[1]} at ${lesson[2].split("-")[0]}.`));
      const doc = /"from":"([^"]+)"/.exec(t);
      if (doc) return reply(res, msg(`From ${doc[1]}: ${t.slice(t.indexOf('"text":"') + 8, t.indexOf('"text":"') + 90)}`));
      return reply(res, msg("Done."));
    }
    if (/email/.test(user) && tools.includes("propose_email")) return reply(res, msg("", call("propose_email", { to_email: "j.hale@churcherscollege.com", to_name: "mr hale", subject: "Chemistry write-up", body: "Hi Mr Hale, could I have until Tuesday for the write-up? Thanks, Peter", ask_summary: "two more days" })));
    if (/remember/.test(user) && tools.includes("remember")) return reply(res, msg("", call("remember", { fact: "prefers revising before school", they_said_it: true })));
    if (/on the wall/.test(user) && tools.includes("open_document")) return reply(res, msg("", call("open_document", { query: "inspector", page: 2 })));
    if (/inspector|macbeth|guide|document/.test(user) && tools.includes("search_my_stuff")) return reply(res, msg("", call("search_my_stuff", { query: user.split("\n").pop() })));
    return reply(res, msg("", call("get_today", {})));
  });
}).listen(port, "127.0.0.1", () => console.log("fake openrouter on", port));
