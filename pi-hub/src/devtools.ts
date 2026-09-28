import crypto from "node:crypto";
import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isLoopback } from "./auth";
import type { Ctx } from "./context";
import { HttpError } from "./errors";

/**
 * Small dev tools for the Pi, off by default.
 *
 * - Switched on only by someone with root on the Pi: `sudo nudge dev on [hours]` writes
 *   /etc/nudge/devtools (root-owned) with an expiry (max 24 h) and a one-time code.
 * - Usable from the Pi itself, or from an owner device that also sends that code. Parents,
 *   screens and unpaired devices never see them.
 * - They only look and nudge: logs, state, re-run the school reader or builds, reload the wall,
 *   show a test pop-up. Nothing here deletes data, changes settings, keys or pairing.
 * - `sudo nudge dev off`, the expiry, or any reinstall/update removes them.
 */
export const DEV_FILE = process.env.NUDGE_DEVTOOLS_FILE || "/etc/nudge/devtools";
const MAX_MS = 24 * 3600_000;

export function devState(file = DEV_FILE): { on: boolean; until: number; code: string } {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { until?: number; code?: string };
    const until = Math.min(Number(j.until) || 0, Date.now() + MAX_MS);
    const code = String(j.code ?? "");
    return { on: until > Date.now() && /^\d{6,}$/.test(code), until, code };
  } catch {
    return { on: false, until: 0, code: "" };
  }
}

/** A ring buffer of the hub's own log lines for the dev page (never request bodies or keys). */
const lines: string[] = [];
export function devLog(line: string) {
  lines.push(`${new Date().toISOString().slice(11, 19)} ${line.replace(/(sk-or-[\w-]{6})[\w-]+|(ak_[\w]{4})[\w]+|(AIza[\w-]{4})[\w-]+/g, "$1$2$3…")}`);
  if (lines.length > 300) lines.splice(0, lines.length - 300);
}

export function registerDevtools(app: FastifyInstance, ctx: Ctx, file = DEV_FILE) {
  const { hub } = ctx;
  let tries = 0;
  const guard = (req: FastifyRequest) => {
    const st = devState(file);
    if (!st.on) throw new HttpError(404, "not found");
    const ip = req.socket.remoteAddress || "";
    if (isLoopback(ip) && !req.headers.origin) return;
    const role = (req as FastifyRequest & { caller?: { role: string } | null }).caller?.role;
    const given = String(req.headers["x-nudge-dev"] ?? "");
    const ok = role === "owner" && given.length === st.code.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(st.code));
    if (!ok) {
      if (++tries > 10) throw new HttpError(429, "too many tries");
      throw new HttpError(404, "not found");
    }
  };

  app.get("/api/dev/status", async (req) => {
    guard(req);
    const st = devState(file);
    const m = process.memoryUsage();
    return {
      until: st.until,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: { rss: Math.round(m.rss / 1e6), heap: Math.round(m.heapUsed / 1e6) },
      school: ctx.school.status(),
      jobs: hub.activeJobs().map((j) => ({ id: j.id, title: j.request.title, status: j.status, note: j.note })),
      devices: ctx.auth.listDevices().map((d) => ({ name: d.name, role: d.role, lastSeen: d.lastSeen })),
      assistant: ctx.agent.available(),
    };
  });
  app.get("/api/dev/logs", async (req) => (guard(req), { lines: lines.slice(-200) }));
  app.post("/api/dev/school", async (req) => (guard(req), void ctx.school.refresh("dev tools"), { ok: true }));
  app.post("/api/dev/builds", async (req) => (guard(req), await ctx.builder?.poll(), { ok: true }));
  app.post("/api/dev/reload-wall", async (req) => (guard(req), hub.bus.broadcast({ type: "dev", action: "reload" }, ["local"]), { ok: true }));
  app.post("/api/dev/popup", async (req) => {
    guard(req);
    hub.bus.broadcast({ type: "say", icon: "build", line: "dev tools test", sub: "NOTHING WAS CHANGED", ms: 2600 }, ["local"]);
    return { ok: true };
  });

  // The page itself: plain HTML, only while dev tools are on.
  app.get("/dev", async (req, reply) => {
    if (!devState(file).on) return reply.code(404).send("not found");
    reply.header("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    return reply.type("text/html").send(DEV_PAGE);
  });
}

const DEV_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>nudge dev</title>
<style>body{margin:0;background:#0a0a0c;color:#e9e8e3;font:12px/1.5 ui-monospace,monospace;padding:18px}h1{font-size:15px;margin:0 0 4px}small{color:#8e8e97}
button{background:#1a1a22;color:#e9e8e3;border:0;border-radius:10px;padding:9px 12px;margin:4px 4px 0 0;font:inherit;cursor:pointer}button:hover{background:#262630}
pre{background:#101015;border-radius:12px;padding:12px;white-space:pre-wrap;max-height:50vh;overflow:auto}input{background:#101015;border:1px solid #26262e;color:#e9e8e3;border-radius:8px;padding:7px;font:inherit;width:120px}</style>
<h1>nudge · dev tools</h1><small id=u>switched on with sudo nudge dev on · looks and nudges only, changes nothing</small>
<p><input id=c placeholder="code (phone only)" inputmode=numeric> <button onclick=st()>status</button><button onclick=lg()>logs</button>
<button onclick="p('school')">re-read school</button><button onclick="p('builds')">check builds</button><button onclick="p('reload-wall')">reload wall</button><button onclick="p('popup')">test pop-up</button></p><pre id=o>…</pre>
<script>const h=()=>{const c=document.getElementById('c').value.trim();let t='';try{t=JSON.parse(localStorage.getItem('nudge-owner:pairing')||'{}').token||''}catch(e){};return Object.assign({'content-type':'application/json'},c?{'x-nudge-dev':c}:{},t?{authorization:'Bearer '+t}:{})};
const show=(x)=>document.getElementById('o').textContent=typeof x==='string'?x:JSON.stringify(x,null,2);
const st=()=>fetch('/api/dev/status',{headers:h()}).then(r=>r.json()).then(show);const lg=()=>fetch('/api/dev/logs',{headers:h()}).then(r=>r.json()).then(j=>show((j.lines||[]).join('\\n')));
const p=(w)=>fetch('/api/dev/'+w,{method:'POST',headers:h(),body:'{}'}).then(r=>r.json()).then(show);st();</script>`;
