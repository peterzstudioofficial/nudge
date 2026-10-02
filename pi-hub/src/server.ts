import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  ClaudeDesktop,
  can, type Cap, type HubMessage, type HwInput, type LedFrame, NewBagItem, NewNote, NewTask, NewTemplate, NotePatch,
  Role, SchoolAction, Settings, TaskPatch, TermDate, Timetable, Birthday, ToWall, DateKey, AgentMode, addDays,
  CalEvent, Activity, FormTime, HomeworkPlan, SchoolDay, Teacher, matchTeacher, parseStaffList,
} from "@nudge/shared";
import { importCalendarText, pdfToRows } from "./school/calendar";
import { newId } from "./hub";
import { registerDevtools } from "./devtools";
import { applySetup, SetupPack } from "./setup";
import { spend } from "./agent/spend";
import { openRouterKeyInfo, openRouterExchange } from "./agent/llm";
import { estimateBuild, iconFor } from "./builder/builder";
import { SUGGESTED_TOOLKITS } from "./agent/composio";
import { forget, memories, remember } from "./agent/brain";
import { addDoc, docFile, listDocs, removeDoc } from "./rag/library";
import { ocrEstimate } from "./rag/remote";
import type { Ctx } from "./context";
import { isLoopback, isPrivateLan, isTailscale, type Caller } from "./auth";
import { HttpError } from "./errors";
import { buildSnapshot } from "./snapshot";
import { schoolAction } from "./school/actions";

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

/** The Android and Windows shells load the apps from their own origin and call the hub with a token. */
const APP_ORIGINS = ["capacitor://localhost", "http://localhost", "https://localhost", "app://nudge"];

function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // not a browser page (GPIO daemon, curl)
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, "bad request: " + r.error.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; "));
  return r.data;
}

function need(req: FastifyRequest, cap: Cap): Caller {
  const c = req.caller;
  if (!c) throw new HttpError(401, "pair this device first");
  if (!can(c.role, cap)) throw new HttpError(403, "not allowed", { icon: "lock", line: "ask a parent in their app" });
  return c;
}

/** The built apps are fully self-contained: no inline scripts, no outside hosts. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export async function buildServer(ctx: Ctx, opts: { tls?: boolean } = {}): Promise<FastifyInstance> {
  const { cfg, hub, auth } = ctx;
  const https = opts.tls !== false && cfg.tlsCert && cfg.tlsKey && fs.existsSync(cfg.tlsCert) && fs.existsSync(cfg.tlsKey)
    ? { cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey) }
    : null;
  const app = Fastify({
    // Production logs only problems (every-request logs would wear out the Pi's SD card).
    logger: process.env.VITEST ? false : { level: process.env.NUDGE_LOG_LEVEL || "warn" },
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: false,
    ...(https ? { https } : {}),
  }) as unknown as FastifyInstance;

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  /* ------------------------- network + identity gate ------------------------- */
  app.decorateRequest("caller", null);
  app.addHook("onRequest", async (req, reply) => {
    const ip = req.socket.remoteAddress || "";
    const allowed = isLoopback(ip) || isTailscale(ip) || (cfg.allowLan && isPrivateLan(ip)) || cfg.dev;
    if (!allowed) {
      reply.code(403).send({ error: "not on the home network or tailnet" });
      return reply;
    }
    const h = req.headers.authorization;
    const token = h && h.startsWith("Bearer ") ? h.slice(7) : null;
    // The Pi's own kiosk is trusted as the wall — but never a web page from another origin.
    req.caller = auth.identify(token, ip, sameOrigin(req.headers.origin, req.headers.host));
    const origin = req.headers.origin;
    if (origin && APP_ORIGINS.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "origin");
      reply.header("access-control-allow-headers", "authorization, content-type, idempotency-key");
      reply.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      reply.header("access-control-max-age", "600");
      if (req.method === "OPTIONS") {
        reply.code(204).send();
        return reply;
      }
    }
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    else reply.header("content-security-policy", CSP);
  });

  /* ------------------------------ idempotency ------------------------------ */
  app.addHook("preHandler", async (req, reply) => {
    const key = req.headers["idempotency-key"];
    if (req.method === "GET" || typeof key !== "string" || key.length > 80) return;
    const row = hub.db.sql.prepare("SELECT status, body FROM idem WHERE key = ?").get(key) as { status: number; body: string } | undefined;
    if (row) {
      reply.code(row.status).header("content-type", "application/json").header("idempotent-replay", "1").send(row.body);
      return reply;
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const key = req.headers["idempotency-key"];
    if (req.method !== "GET" && typeof key === "string" && key.length <= 80 && reply.statusCode < 500 && typeof payload === "string") {
      hub.db.sql.prepare("INSERT OR IGNORE INTO idem(key, ts, status, body) VALUES(?, ?, ?, ?)").run(key, Date.now(), reply.statusCode, payload);
    }
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ error: err.message, slab: err.slab ?? null, ...(err.extra ?? {}) });
      return;
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      reply.code(e.statusCode).send({ error: e.message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: "something went wrong on the hub" });
  });

  /* ---------------------------------- core ---------------------------------- */
  app.get("/api/health", async () => ({ ok: true, name: "nudge", version: "0.1.0" }));

  app.get("/api/whoami", async (req) => ({ caller: req.caller }));

  app.post("/api/pair", async (req) => {
    const b = parse(z.object({ code: z.string().min(6).max(12), name: z.string().max(40).default("device") }), req.body);
    const r = auth.pair(b.code, b.name, req.socket.remoteAddress || "");
    hub.feed("device", `New ${r.device.role} device paired: ${r.device.name}`);
    return r;
  });

  app.get("/api/state", async (req) => {
    const c = need(req, "read");
    return buildSnapshot(ctx, c.role);
  });

  /* --------------------------------- devices -------------------------------- */
  app.get("/api/devices", async (req) => {
    need(req, "devices.manage");
    return auth.listDevices();
  });
  app.post("/api/pairing-codes", async (req) => {
    const c = need(req, "read");
    const { role } = parse(z.object({ role: Role }), req.body);
    // Parent codes: only a parent can make them — or the wall itself while no parent is set up yet.
    const ok =
      role === "parent"
        ? c.role === "parent" || (c.role === "screen" && !auth.hasRole("parent"))
        : role === "screen"
          ? false
          : c.role === "parent" || c.role === "screen" || c.role === "owner";
    if (!ok) throw new HttpError(403, "not allowed", { icon: "lock", line: "ask a parent in their app" });
    return auth.createCode(role, c.deviceId);
  });
  app.delete("/api/devices/:id", async (req) => {
    const c = need(req, "devices.manage");
    const { id } = req.params as { id: string };
    const target = auth.listDevices().find((d) => d.id === id);
    if (target?.role === "parent" && c.role !== "parent") throw new HttpError(403, "only a parent can remove a parent device");
    auth.revoke(id);
    return { ok: true };
  });

  /* ---------------------------------- tasks --------------------------------- */
  app.get("/api/tasks", async (req) => {
    need(req, "read");
    const q = parse(z.object({ date: DateKey.optional(), from: DateKey.optional(), to: DateKey.optional() }), req.query);
    if (q.from && q.to) return hub.tasks.betweenDays(q.from, q.to);
    const date = q.date ?? hub.todayKey();
    hub.ensureDay(date);
    return hub.listTasks(date);
  });
  app.post("/api/tasks", async (req) => {
    need(req, "tasks.plan");
    return hub.addTask(parse(NewTask, req.body), "parent");
  });
  app.patch("/api/tasks/:id", async (req) => {
    need(req, "tasks.plan");
    return hub.patchTask((req.params as { id: string }).id, parse(TaskPatch, req.body));
  });
  app.delete("/api/tasks/:id", async (req) => {
    need(req, "tasks.plan");
    hub.deleteTask((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post("/api/tasks/:id/skip", async (req) => {
    need(req, "tasks.skip");
    return hub.skipTask((req.params as { id: string }).id);
  });
  // Phone lock polls this: tiny, so it's cheap to ask every few seconds.
  app.get("/api/session/lock", async (req) => {
    need(req, "read");
    const s = hub.session();
    const t = s ? hub.tasks.get(s.taskId) : null;
    return { active: !!s && s.state !== "paused", task: t?.name ?? null };
  });
  app.post("/api/tasks/:id/notset", async (req) => {
    need(req, "tasks.skip");
    hub.homeworkNotSet((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post("/api/homework/plan", async (req) => {
    need(req, "settings.owner");
    const { date } = parse(z.object({ date: DateKey.optional() }), req.body ?? {});
    const d = date ?? hub.todayKey();
    hub.db.kvDel(`hwPlanned:${d}`);
    return hub.planHomework(d);
  });
  app.get("/api/templates", async (req) => {
    need(req, "read");
    return hub.templates.all();
  });
  app.post("/api/templates", async (req) => {
    need(req, "tasks.plan");
    return hub.addTemplate(parse(NewTemplate, req.body));
  });
  app.delete("/api/templates/:id", async (req) => {
    need(req, "tasks.plan");
    hub.deleteTemplate((req.params as { id: string }).id);
    return { ok: true };
  });

  /* --------------------------------- session -------------------------------- */
  app.post("/api/session/start", async (req) => {
    need(req, "session");
    const { taskId } = parse(z.object({ taskId: z.string() }), req.body);
    return hub.start(taskId);
  });
  app.post("/api/session/pause", async (req) => (need(req, "session"), hub.pause()));
  app.post("/api/session/resume", async (req) => (need(req, "session"), hub.resume()));
  app.post("/api/session/break", async (req) => (need(req, "session"), hub.takeBreak()));
  app.post("/api/session/switch", async (req) => (need(req, "session"), hub.switchAway("switch")));
  app.post("/api/session/claim", async (req) => (need(req, "session"), hub.claim()));
  app.post("/api/session/end", async (req) => (need(req, "session.end"), hub.switchAway("end")));

  /* ----------------------------------- bag ---------------------------------- */
  app.post("/api/bag", async (req) => {
    const c = need(req, "read");
    if (!can(c.role, "bag") && !can(c.role, "tasks.plan")) throw new HttpError(403, "not allowed");
    return hub.addBag(parse(NewBagItem, req.body), c.role === "parent" ? "parent" : "self");
  });
  app.post("/api/bag/:id/got", async (req) => (need(req, "bag"), hub.bagGot((req.params as { id: string }).id)));
  app.post("/api/bag/:id/skip", async (req) => (need(req, "bag"), hub.bagSkip((req.params as { id: string }).id), { ok: true }));
  app.delete("/api/bag/:id", async (req) => {
    const c = need(req, "read");
    if (!can(c.role, "bag") && !can(c.role, "tasks.plan")) throw new HttpError(403, "not allowed");
    hub.bagRemove((req.params as { id: string }).id);
    return { ok: true };
  });

  /* ----------------------------------- day ---------------------------------- */
  app.post("/api/day/arrive", async (req) => (need(req, "day.arrive"), hub.arrive()));
  app.post("/api/day/wake", async (req) => (need(req, "session"), hub.wake(), { ok: true }));
  app.post("/api/day/sick", async (req) => {
    need(req, "day.mark");
    const { kind } = parse(z.object({ kind: z.enum(["ill", "hurt", "flat"]).nullable() }), req.body);
    hub.sick(kind);
    return { ok: true };
  });
  app.post("/api/day/mark", async (req) => {
    need(req, "day.mark");
    const b = parse(z.object({ date: DateKey, kind: z.enum(["away", "holiday"]).nullable() }), req.body);
    hub.markDay(b.date, b.kind);
    return hub.dayState(b.date);
  });
  app.get("/api/calendar", async (req) => {
    need(req, "read");
    const q = parse(z.object({ from: DateKey, to: DateKey }), req.query);
    const out = [];
    for (let d = q.from, i = 0; d <= q.to && i < 62; d = addDays(d, 1), i++) {
      hub.ensureDay(d);
      out.push({ day: hub.dayState(d), tasks: hub.listTasks(d), events: hub.events.byDay(d) });
    }
    return out;
  });

  app.post("/api/nfc/seen", async (req) => {
    need(req, "day.arrive");
    const { uid } = parse(z.object({ uid: z.string().min(2).max(40) }), req.body);
    hub.db.kvSet("lastNfc", { uid, at: Date.now() });
    return { ok: true };
  });

  /* --------------------------------- rewards -------------------------------- */
  app.get("/api/rewards", async (req) => (need(req, "read"), hub.rewardState()));
  app.put("/api/rewards", async (req) => {
    need(req, "rewards.edit");
    const R = z.object({ name: z.string().min(1).max(60), goal: z.number().int().min(5).max(1000), icon: z.string().max(40).default("redeem") });
    return hub.setReward(parse(R.extend({ next: z.array(R).max(5).optional() }), req.body));
  });
  app.post("/api/rewards/ack", async (req) => {
    const c = need(req, "read");
    if (!can(c.role, "rewards.ack") && c.role !== "screen") throw new HttpError(403, "not allowed");
    return hub.ackReward();
  });
  app.get("/api/stats", async (req) => (need(req, "read"), hub.stats()));
  app.get("/api/feed", async (req) => (need(req, "read").role === "parent" ? hub.parentFeed(40) : hub.recentFeed(40)));

  /* ---------------------------------- notes --------------------------------- */
  app.get("/api/notes", async (req) => (need(req, "notes"), hub.listNotes()));
  app.post("/api/notes", async (req) => (need(req, "notes"), hub.addNote(parse(NewNote, req.body))));
  app.patch("/api/notes/:id", async (req) => (need(req, "notes"), hub.patchNote((req.params as { id: string }).id, parse(NotePatch, req.body))));
  app.delete("/api/notes/:id", async (req) => (need(req, "notes"), hub.deleteNote((req.params as { id: string }).id), { ok: true }));
  app.post("/api/notes/:id/wall", async (req) => {
    need(req, "notes");
    const b = parse(ToWall, req.body);
    return hub.noteToWall((req.params as { id: string }).id, b.as, b.at);
  });
  app.addContentTypeParser(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "application/octet-stream"], { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.put("/api/notes/:id/audio", async (req) => {
    need(req, "notes");
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "no audio");
    if (body.length > 10 * 1024 * 1024) throw new HttpError(413, "recording too long");
    const secs = Number((req.query as { secs?: string }).secs) || undefined;
    return hub.setNoteAudio((req.params as { id: string }).id, String(req.headers["content-type"] || "audio/webm"), new Uint8Array(body), secs);
  });
  // Voice note → text, on the Pi (16-bit PCM WAV; the apps convert their recording first).
  app.post("/api/notes/:id/transcribe", async (req) => {
    need(req, "notes");
    const stt = ctx.stt?.();
    if (!stt) throw new HttpError(503, "speech-to-text isn't installed on the hub");
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 44) throw new HttpError(400, "no audio");
    if (body.length > 10 * 1024 * 1024) throw new HttpError(413, "recording too long");
    let text: string;
    try {
      text = await stt.transcribeWav(new Uint8Array(body));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const id = (req.params as { id: string }).id;
    const note = hub.listNotes().find((n) => n.id === id);
    if (!note) throw new HttpError(404, "no such note");
    if (!text) return { text, note };
    const fresh = note.label === "new recording";
    const label = fresh ? text.split(/\s+/).slice(0, 6).join(" ").replace(/[.,!?]+$/, "").slice(0, 60) : undefined;
    const saved = hub.patchNote(id, { body: note.body ? `${note.body}\n\n${text}` : text, ...(label ? { label } : {}) });
    // Then a proper title and tags from the assistant, if it's on (doesn't hold up the reply).
    if (fresh && ctx.agent.tidyNote) {
      void ctx.agent
        .tidyNote(text)
        .then((t) => {
          if (!t) return;
          const cur = hub.listNotes().find((n) => n.id === id);
          if (cur && cur.label === label) hub.patchNote(id, { label: t.label, tags: [...new Set([...cur.tags, ...t.tags])].slice(0, 10) });
        })
        .catch(() => {});
    }
    return { text, note: saved };
  });
  app.get("/api/notes/:id/audio", async (req, reply) => {
    need(req, "notes");
    const blob = hub.db.blobGet("audio:" + (req.params as { id: string }).id);
    if (!blob) throw new HttpError(404, "no audio");
    reply.header("content-type", blob.mime).send(Buffer.from(blob.data));
  });

  app.post("/api/reminders", async (req) => {
    need(req, "notes");
    const b = parse(z.object({ text: z.string().min(1).max(120), line: z.string().max(200).default(""), at: z.number() }), req.body);
    return hub.addReminder(b.text, b.line, b.at, "self");
  });
  app.post("/api/reminders/:id/ack", async (req) => (need(req, "read"), hub.ackReminder((req.params as { id: string }).id), { ok: true }));

  /* --------------------------------- school --------------------------------- */
  app.get("/api/school/items", async (req) => {
    need(req, "school.read");
    return hub.school.all().sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 100);
  });
  app.get("/api/school/status", async (req) => (need(req, "school.read"), ctx.school.status()));
  app.post("/api/school/refresh", async (req) => {
    need(req, "school.act");
    void ctx.school.refresh("manual");
    return { ok: true };
  });
  app.post("/api/school/items/:id/action", async (req) => {
    need(req, "school.act");
    return schoolAction(hub, (req.params as { id: string }).id, parse(SchoolAction, req.body));
  });
  app.post("/api/school/session", async (req) => {
    need(req, "school.session");
    const b = parse(z.object({ cookies: z.array(z.record(z.string(), z.unknown())).max(400), userAgent: z.string().max(400).optional() }), req.body);
    await ctx.school.setSession(b.cookies, b.userAgent ?? null);
    void ctx.school.refresh("signed in");
    return { ok: true };
  });
  app.delete("/api/school/session", async (req) => {
    need(req, "school.session");
    await ctx.school.clearSession();
    return { ok: true };
  });

  /* ---------------------------------- agent --------------------------------- */
  app.get("/api/agent/threads", async (req) => {
    need(req, "agent");
    return hub.threads.latest(30);
  });
  app.get("/api/agent/threads/:id", async (req) => {
    need(req, "agent");
    const t = hub.threads.get((req.params as { id: string }).id);
    if (!t) throw new HttpError(404, "no such thread");
    return t;
  });
  // Private search (owner devices only).
  app.get("/api/search", async (req) => {
    need(req, "notes");
    const { q } = parse(z.object({ q: z.string().min(1).max(200) }), req.query);
    return { semantic: !!ctx.index?.semantic, hits: (await ctx.index?.search(q, 12)) ?? [] };
  });

  // Connected apps (Composio). Owner devices only.
  app.get("/api/apps", async (req) => {
    need(req, "settings.owner");
    const on = !!ctx.apps?.available();
    return { on, suggested: SUGGESTED_TOOLKITS, ...(on ? await ctx.apps!.status() : { toolkits: [], connected: [] }) };
  });
  app.post("/api/apps/connect", async (req) => {
    need(req, "settings.owner");
    if (!ctx.apps?.available()) throw new HttpError(409, "connected apps are off (no Composio key on the hub)");
    const { toolkit } = parse(z.object({ toolkit: z.string().regex(/^[a-z0-9_-]{2,40}$/) }), req.body);
    return ctx.apps.connect(toolkit);
  });
  app.delete("/api/apps/:id", async (req) => {
    need(req, "settings.owner");
    await ctx.apps?.disconnect((req.params as { id: string }).id);
    return { ok: true };
  });
  app.put("/api/apps/toolkits", async (req) => {
    need(req, "settings.owner");
    hub.db.kvSet("composioToolkits", parse(z.array(z.string().regex(/^[a-z0-9_-]{2,40}$/)).max(12), req.body));
    return { ok: true };
  });

  // What's switched on, and what it has cost this month (never the keys themselves).
  // Credit left on the OpenRouter key (cached; free to ask).
  let credit: { at: number; v: Awaited<ReturnType<typeof openRouterKeyInfo>> } | null = null;
  app.get("/api/ai/status", async (req) => {
    need(req, "settings.owner");
    const k = ctx.keys?.openrouter();
    if (k && (!credit || Date.now() - credit.at > 10 * 60_000)) credit = { at: Date.now(), v: await openRouterKeyInfo(k) };
    return {
      text: { on: ctx.agent.available(), model: hub.settings().aiModel, provider: "openrouter", zdr: true, key: ctx.keys?.source() ?? null, credit: k ? (credit?.v ?? null) : null },
      voice: { on: !!ctx.cfg.geminiKey, model: hub.settings().voiceModel, spoken: hub.settings().voiceReplies, onDevice: !!ctx.stt?.() },
      search: { items: ctx.index?.size ?? 0, semantic: !!ctx.index?.semantic, engine: ctx.index?.engine ?? "keywords only", documents: listDocs(hub).length, setting: hub.settings().ragEmbed, ocr: !!k },
      connections: { on: !!ctx.cfg.composioKey },
      spend: spend(hub),
    };
  });
  /* Connect OpenRouter from the setup page (OAuth PKCE): no key is ever typed or pasted. */
  app.post("/api/ai/openrouter/start", async (req) => {
    need(req, "settings.owner");
    if (!ctx.keys) throw new HttpError(503, "not available");
    const b = parse(z.object({ callback: z.string().url().max(300) }), req.body);
    const cb = new URL(b.callback);
    // Only back to this hub's own setup page.
    if (!/^https?:$/.test(cb.protocol) || cb.host !== req.headers.host) throw new HttpError(400, "bad callback");
    return { url: ctx.keys.startOAuth(cb.toString()) };
  });
  app.post("/api/ai/openrouter/finish", async (req) => {
    need(req, "settings.owner");
    if (!ctx.keys) throw new HttpError(503, "not available");
    const b = parse(z.object({ code: z.string().min(4).max(400) }), req.body);
    const verifier = ctx.keys.takeVerifier();
    if (!verifier) throw new HttpError(400, "that sign-in expired, try again");
    ctx.keys.setOpenrouter(await openRouterExchange(b.code, verifier));
    credit = null;
    return { ok: true };
  });
  app.delete("/api/ai/openrouter", async (req) => {
    need(req, "settings.owner");
    ctx.keys?.setOpenrouter(null);
    credit = null;
    return { ok: true };
  });
  /* ----------------------------- tools + build jobs ----------------------------- */
  const toolsOrigin = (req: FastifyRequest) => {
    const host = String(req.headers.host ?? "127.0.0.1").replace(/:\d+$/, "");
    const tls = !!(cfg.tlsCert && cfg.tlsKey && fs.existsSync(cfg.tlsCert));
    return `${tls ? "https" : "http"}://${host}:${cfg.toolsPort}`;
  };
  app.get("/api/tools", async (req) => {
    need(req, "notes");
    return { origin: toolsOrigin(req), tools: hub.listTools(), jobs: hub.activeJobs().map((j) => ({ ...j, request: { ...j.request, brief: j.request.brief.slice(0, 400) } })) };
  });
  app.delete("/api/tools/:id", async (req) => {
    need(req, "settings.owner");
    hub.deleteTool((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post("/api/jobs/:id/cancel", async (req) => {
    need(req, "settings.owner");
    ctx.builder?.cancel((req.params as { id: string }).id);
    return { ok: true };
  });
  // Ask for a tool from the phone (with optional files). It still needs a yes, with its cost shown.
  app.post("/api/tools/request", async (req) => {
    need(req, "settings.owner");
    const b = parse(
      z.object({
        title: z.string().min(2).max(60),
        brief: z.string().min(10).max(6000),
        target: z.enum(["phone", "school", "any"]),
        when: z.enum(["now", "later"]),
        where: z.enum(["pi", "computer"]),
        toolId: z.string().max(40).nullable().default(null),
        attachments: z.array(z.object({ name: z.string().min(1).max(120), mime: z.string().max(80), data: z.string().max(11_000_000) })).max(4).default([]),
      }),
      req.body,
    );
    if (b.where === "computer" && !(hub.claudeDesktop()?.cli && hub.claudeDesktop()?.allowRun)) throw new HttpError(409, "Claude Code isn't set up on your computer yet");
    let total = 0;
    const attachments = b.attachments.map((a) => {
      const data = Buffer.from(a.data, "base64");
      total += data.length;
      const id = newId();
      hub.db.blobPut(`attach:${id}`, a.mime, new Uint8Array(data));
      return { id, name: a.name.replace(/[^\w .-]/g, "_"), mime: a.mime };
    });
    if (total > 8 * 1024 * 1024) throw new HttpError(413, "attachments are too big (8 MB max)");
    const request = { title: b.title, brief: b.brief, target: b.target, when: b.when, where: b.where, toolId: b.toolId, attachments };
    const est = estimateBuild(request);
    return hub.createAsk({
      kind: "build",
      head: "BIG JOB · ARE YOU SURE?",
      line: `build ${b.title.toLowerCase()}?`,
      rows: [
        { k: "WHERE", v: b.where === "computer" ? "claude code on your pc" : "the pi, in a sandbox" },
        { k: "WHEN", v: b.when === "later" ? "later · half price" : "now · a few minutes" },
        { k: "COST", v: b.where === "computer" ? "your claude plan" : `about $${Math.max(est, 0.001).toFixed(3)}` },
      ],
      payload: { request, estUsd: est },
      threadId: null,
    });
  });
  // The computer sends back what Claude Code built for a job.
  app.post("/api/jobs/:id/tool", async (req) => {
    need(req, "handoff");
    const id = (req.params as { id: string }).id;
    const j = hub.jobs.get(id);
    if (!j || j.request.where !== "computer" || j.status === "cancelled") throw new HttpError(404, "no such build");
    const b = parse(z.object({ files: z.record(z.string().max(120), z.string().max(7_000_000)), summary: z.string().max(600).default("") }), req.body);
    const files: Record<string, { mime: string; data: Uint8Array }> = {};
    for (const [pth, data] of Object.entries(b.files)) files[pth] = { mime: mimeOf(pth), data: new Uint8Array(Buffer.from(data, "base64")) };
    const r = j.request;
    const t = hub.putTool({ id: r.toolId ?? undefined, title: r.title, description: (b.summary || r.brief).replace(/\s+/g, " ").slice(0, 300), icon: iconFor(`${r.title} ${r.brief}`), target: r.target, jobId: j.id }, files);
    hub.updateJob(id, { status: "done", toolId: t.id, note: "ready in your Tools tab", error: null });
    hub.feed("agent", `Built "${r.title}" on the computer — it's in your Tools tab`);
    sayOnWall(ctx, "apps", `${r.title.toLowerCase()} is ready`, "IN YOUR PHONE'S TOOLS TAB", 5000);
    return { ok: true, id: t.id };
  });

  app.post("/api/agent/threads", async (req) => {
    const c = need(req, "agent");
    if (!hub.settings().ai) throw new HttpError(409, "assistant is off", { icon: "smart_toy", line: "assistant is off", sub: "TURN IT ON IN THE APP" });
    if (!ctx.agent.available()) throw new HttpError(409, "no OpenRouter key on the hub", { icon: "smart_toy", line: "assistant not set up", sub: "ADD A KEY ON THE HUB" });
    const b = parse(z.object({ prompt: z.string().min(1).max(4000), mode: AgentMode.default("act") }), req.body);
    const id = ctx.agent.run({ prompt: b.prompt, mode: b.mode, origin: c.role === "screen" ? "wall" : c.role === "desktop" ? "desktop" : "app" });
    return { id };
  });
  // The assistant's memory: owner's phone and computer only (never the parent app, not the wall).
  const brainCaller = (req: FastifyRequest) => {
    const c = need(req, "agent");
    if (c.role === "screen") throw new HttpError(403, "not here");
    return c;
  };
  // The library: documents the assistant can read. Owner's phone and computer only.
  app.get("/api/library", async (req) => (brainCaller(req), [...listDocs(hub)].sort((a, b) => b.addedAt - a.addedAt)));
  app.post("/api/library", { bodyLimit: 26 * 1024 * 1024 }, async (req) => {
    brainCaller(req);
    const { name, ocr } = parse(z.object({ name: z.string().min(1).max(160), ocr: z.enum(["0", "1"]).default("0") }), req.query);
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, "no file");
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf" }[ext] ?? String(req.headers["content-type"] ?? "");
    const doc = await addDoc(hub, { name, mime, data: new Uint8Array(body) }, { ocr: ctx.keys?.openrouter() ? (ctx.ocr ?? null) : null, ocrOk: ocr === "1", estimate: ocrEstimate });
    hub.feed("library", `Added "${doc.title}" to the library`);
    return doc;
  });
  app.delete("/api/library/:id", async (req) => {
    brainCaller(req);
    if (!removeDoc(hub, (req.params as { id: string }).id)) throw new HttpError(404, "not found");
    return { ok: true };
  });
  app.get("/api/library/:id/file", async (req, reply) => {
    brainCaller(req);
    const id = (req.params as { id: string }).id;
    const f = docFile(hub, id);
    const d = listDocs(hub).find((x) => x.id === id);
    if (!f || !d) throw new HttpError(404, "not found");
    const img = /^image\/(jpeg|png|webp|heic)$/.test(f.mime) ? f.mime : "image/jpeg";
    const ext = { pdf: "pdf", word: "docx", slides: "pptx", text: "txt", image: img.split("/")[1] }[d.kind];
    const type = { pdf: "application/pdf", word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", slides: "application/vnd.openxmlformats-officedocument.presentationml.presentation", text: "text/plain; charset=utf-8", image: img }[d.kind];
    reply.header("content-type", type).header("content-disposition", `inline; filename="${d.title.replace(/[^\w .-]/g, "")}.${ext}"`).header("x-content-type-options", "nosniff").header("content-security-policy", "sandbox");
    return reply.send(Buffer.from(f.data));
  });

  app.get("/api/brain", async (req) => (brainCaller(req), [...memories(hub)].sort((a, b) => b.createdAt - a.createdAt)));
  app.post("/api/brain", async (req) => {
    brainCaller(req);
    const b = parse(z.object({ text: z.string().min(4).max(200) }), req.body);
    const r = remember(hub, b.text, "told");
    if (!r.ok) throw new HttpError(400, r.why);
    return r.memory;
  });
  app.delete("/api/brain/:id", async (req) => (brainCaller(req), { removed: forget(hub, (req.params as { id: string }).id) }));
  app.delete("/api/brain", async (req) => {
    brainCaller(req);
    hub.db.kvSet("brain", []);
    hub.bus.changed("brain");
    return { ok: true };
  });
  // The Nudge connector: Claude on Peter's computer (Claude Desktop / Claude Code, his own plan)
  // gets the assistant's tools, with every rule unchanged. The computer's token only.
  const connector = (req: FastifyRequest) => {
    const c = need(req, "handoff");
    if (c.role !== "desktop") throw new HttpError(403, "only the computer app");
    if (!hub.settings().ai) throw new HttpError(409, "assistant is off");
    return c;
  };
  app.get("/api/agent/tools", async (req) => (connector(req), (await ctx.agent.toolList?.()) ?? []));
  app.post("/api/agent/tools/:name", async (req) => {
    connector(req);
    const b = parse(z.object({ args: z.record(z.string(), z.unknown()).default({}), threadId: z.string().max(64).nullable().optional() }), req.body);
    const text = (await ctx.agent.callTool?.((req.params as { name: string }).name, b.args, b.threadId ?? null)) ?? "error: not available";
    return { text };
  });
  app.post("/api/agent/threads/:id/stop", async (req) => (need(req, "agent"), ctx.agent.stop((req.params as { id: string }).id), { ok: true }));
  app.post("/api/asks/:id/answer", async (req) => {
    const c = need(req, "asks.answer");
    const b = parse(z.object({ yes: z.boolean(), held: z.boolean().default(false) }), req.body);
    return hub.answerAsk((req.params as { id: string }).id, b.yes, c.name, { held: b.held });
  });
  app.get("/api/handoffs", async (req) => (need(req, "handoff"), hub.pendingHandoffs()));
  app.post("/api/handoffs/:id/done", async (req) => (need(req, "handoff"), hub.doneHandoff((req.params as { id: string }).id), { ok: true }));
  app.post("/api/handoffs/:id/result", async (req) => {
    need(req, "handoff");
    const b = parse(z.object({ ok: z.boolean(), text: z.string().max(8000), costUsd: z.number().min(0).max(100).optional() }), req.body);
    hub.handoffResult((req.params as { id: string }).id, b);
    return { ok: true };
  });
  // The computer says what Claude can do there: folder names only, never paths.
  app.put("/api/desktop/claude", async (req) => {
    need(req, "handoff");
    hub.setClaudeDesktop(parse(ClaudeDesktop, req.body));
    return { ok: true };
  });

  /* -------------------------------- settings -------------------------------- */
  app.get("/api/settings", async (req) => (need(req, "read"), hub.settings()));
  app.patch("/api/settings", async (req) => {
    const c = need(req, "read");
    if (!can(c.role, "settings.owner") && !can(c.role, "settings.parent")) throw new HttpError(403, "not allowed");
    return hub.updateSettings(c.role, parse(Settings.partial(), req.body));
  });
  app.get("/api/config", async (req) => {
    need(req, "read");
    return {
      terms: hub.terms(), timetable: hub.timetable(), birthdays: hub.birthdays(), kept: hub.keptItems(), lastNfc: hub.db.kvGet("lastNfc", null),
      schoolDay: hub.schoolDay(), formTime: hub.formTime(), homework: hub.homeworkPlan(),
    };
  });
  app.put("/api/config/schoolday", async (req) => (need(req, "settings.owner"), hub.setSchoolDay(parse(SchoolDay, req.body)), { ok: true }));
  app.put("/api/config/formtime", async (req) => (need(req, "settings.owner"), hub.setFormTime(parse(FormTime, req.body)), { ok: true }));
  app.get("/api/config/activities", async (req) => (need(req, "read"), hub.activities()));
  app.put("/api/config/activities", async (req) => {
    need(req, "settings.owner");
    hub.setActivities(parse(z.array(Activity.omit({ id: true }).extend({ id: z.string().optional() })).max(40), req.body).map((a) => ({ ...a, id: a.id ?? newId() })));
    return hub.activities();
  });
  app.put("/api/config/homework", async (req) => (need(req, "settings.owner"), hub.setHomeworkPlan(parse(HomeworkPlan, req.body)), { ok: true }));

  // Staff directory: private to the owner's devices (never the parent app).
  const teacherView = () => {
    const staff = hub.teachers();
    const codes = new Map<string, string>();
    for (const periods of Object.values(hub.timetable())) for (const p of periods) if (p.teacher) codes.set(p.teacher, p.subject);
    return {
      teachers: staff,
      matches: [...codes].map(([code, subject]) => ({ code, subject, name: matchTeacher(code, subject, staff)?.name ?? null })),
    };
  };
  app.get("/api/config/teachers", async (req) => (need(req, "settings.owner"), teacherView()));
  app.put("/api/config/teachers", async (req) => {
    need(req, "settings.owner");
    hub.setTeachers(parse(z.array(Teacher).max(500), req.body));
    return teacherView();
  });
  app.post("/api/config/teachers/paste", async (req) => {
    need(req, "settings.owner");
    const { text } = parse(z.object({ text: z.string().max(100_000) }), req.body);
    const byName = new Map(hub.teachers().map((t) => [t.name, t]));
    for (const t of parseStaffList(text)) byName.set(t.name, { ...byName.get(t.name), ...t });
    hub.setTeachers([...byName.values()].slice(0, 500));
    return teacherView();
  });

  // School calendar: upload the term's PDF; its dates and A/B weeks are read on the hub.
  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.post("/api/config/calendar", async (req) => {
    need(req, "settings.owner");
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(400, "that isn't a PDF");
    const text = await pdfToRows(new Uint8Array(body));
    const r = importCalendarText(hub, text);
    hub.feed("school", `School calendar read: ${r.events} dates`);
    return r;
  });
  app.get("/api/events", async (req) => {
    need(req, "read");
    const { from, days } = parse(z.object({ from: DateKey.optional(), days: z.coerce.number().int().min(1).max(400).default(60) }), req.query);
    return hub.upcomingEvents(from ?? hub.todayKey(), days);
  });
  app.post("/api/events", async (req) => {
    need(req, "settings.owner");
    const e = parse(CalEvent.omit({ id: true, source: true }), req.body);
    const ev = hub.events.put({ ...e, id: newId(), source: "self" });
    hub.bus.changed("events");
    return ev;
  });
  app.delete("/api/events/:id", async (req) => {
    need(req, "settings.owner");
    hub.events.del((req.params as { id: string }).id);
    hub.bus.changed("events");
    return { ok: true };
  });

  // One-shot setup file: timetable, bells, form time, homework plan, birthdays, staff, events, profile.
  app.post("/api/config/import", async (req) => {
    need(req, "settings.owner");
    return { imported: applySetup(hub, parse(SetupPack, req.body)) };
  });
  app.put("/api/config/terms", async (req) => (need(req, "settings.owner"), hub.setTerms(parse(z.array(TermDate).max(12), req.body)), { ok: true }));
  app.put("/api/config/timetable", async (req) => (need(req, "settings.owner"), hub.setTimetable(parse(Timetable, req.body)), { ok: true }));
  app.put("/api/config/birthdays", async (req) => (need(req, "read"), hub.setBirthdays(parse(z.array(Birthday).max(500), req.body)), { ok: true }));
  app.put("/api/config/kept", async (req) => {
    need(req, "bag");
    hub.db.kvSet("bagKept", parse(z.array(z.string().min(1).max(40)).max(10), req.body));
    return { ok: true };
  });

  /* ------------------------------ live channel ------------------------------ */
  app.get("/api/ws", { websocket: true }, (socket, req) => {
    const ip = req.socket.remoteAddress || "";
    let caller: Caller | null = null;
    let unsub: (() => void) | null = null;
    const send = (m: HubMessage) => socket.send(JSON.stringify(m));
    const authTimer = setTimeout(() => socket.close(4401, "auth timeout"), 5000);
    socket.on("message", (raw: Buffer) => {
      let msg: { type?: string; token?: string | null; input?: HwInput; frame?: LedFrame; pcm?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!caller) {
        if (msg.type !== "auth") return;
        caller = auth.identify(msg.token ?? null, ip, sameOrigin(req.headers.origin, req.headers.host));
        clearTimeout(authTimer);
        if (!caller) {
          socket.close(4401, "unpaired");
          return;
        }
        const roles = new Set<string>([caller.role, isLoopback(ip) ? "local" : "remote"]);
        unsub = hub.bus.subscribe({ send, roles });
        send({ type: "hello", rev: hub.bus.rev, role: caller.role });
        if (isLoopback(ip)) send({ type: "wake-config", on: !!ctx.wake?.active() });
        return;
      }
      // Hardware traffic only from the Pi itself.
      if (msg.type === "input" && msg.input && isLoopback(ip)) ctx.hw.input(msg.input);
      if (msg.type === "leds" && msg.frame && caller.role === "screen" && isLoopback(ip)) ctx.hw.leds(msg.frame);
      // Mic audio for the voice assistant, streamed by the hardware daemon.
      if (msg.type === "voice-audio" && typeof msg.pcm === "string" && isLoopback(ip)) ctx.voice?.audio(msg.pcm);
      if (msg.type === "voice-end" && isLoopback(ip)) ctx.voice?.end();
      // Wake word: only gated speech arrives here, only from the Pi, and it's never kept.
      if (msg.type === "wake-audio" && typeof msg.pcm === "string" && isLoopback(ip)) ctx.wake?.audio(msg.pcm);
      if (msg.type === "wake-gap" && isLoopback(ip)) ctx.wake?.gap();
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      unsub?.();
    });
  });

  registerDevtools(app, ctx);

  /* ------------------------------ static apps ------------------------------- */
  if (cfg.screenDir) {
    await app.register(fastifyStatic, { root: cfg.screenDir, prefix: "/screen/", decorateReply: false, index: "index.html" });
  }
  if (cfg.appsDir) {
    await app.register(fastifyStatic, { root: cfg.appsDir, prefix: "/app/", decorateReply: false, index: "index.html" });
  }
  app.get("/", async (_req, reply) => reply.redirect(cfg.appsDir ? "/app/" : "/api/health"));
  app.get("/admin", async (_req, reply) => reply.redirect("/app/admin.html"));

  return app;
}

export function sayOnWall(ctx: Ctx, icon: string, line: string, sub?: string, ms?: number) {
  ctx.hub.bus.broadcast({ type: "say", icon, line, sub, ms }, ["screen"]);
}

export type { FastifyReply };
export { path };

const mimeOf = (p: string) =>
  p.endsWith(".html") ? "text/html" : p.endsWith(".js") || p.endsWith(".mjs") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".svg") ? "image/svg+xml"
    : p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" : p.endsWith(".json") || p.endsWith(".webmanifest") ? "application/json"
    : p.endsWith(".woff2") ? "font/woff2" : p.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream";

