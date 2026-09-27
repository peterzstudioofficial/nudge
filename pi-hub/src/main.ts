import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type HwInput, type LedFrame, minutesOfDay, isoWeekday, hhmmToMinutes } from "@nudge/shared";
import { Auth } from "./auth";
import { loadConfig } from "./config";
import type { Ctx } from "./context";
import { Db } from "./db";
import { Hub } from "./hub";
import { agentService } from "./agent/agent";
import { openRouter } from "./agent/llm";
import { addSpend } from "./agent/spend";
import { appsService } from "./agent/composio";
import { PersonalIndex } from "./rag/index";
import { loadEmbedder } from "./rag/embed";
import { searchTool } from "./rag/tool";
import { loadStt } from "./voice/stt";
import { voiceService } from "./voice/wall";
import { schoolReader, refreshTermDates } from "./school/reader";
import { Vault } from "./school/vault";
import { newsService } from "./services/news";
import { weatherService } from "./services/weather";
import { buildServer, sayOnWall } from "./server";
import { seedDemo } from "./seed";
import { loadPrivateSetup } from "./setup";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

async function main() {
  const cfg = loadConfig();
  const db = new Db(cfg.dataDir);
  const hub = new Hub(db);
  const auth = new Auth(db);
  const log = (m: string) => console.log(`[nudge] ${m}`);

  // `node hub.mjs pair --role owner|parent` — make a pairing code from the Pi's terminal.
  if (process.argv[2] === "pair") {
    const i = process.argv.indexOf("--role");
    const role = (i > 0 ? process.argv[i + 1] : "owner") as "owner" | "parent" | "desktop";
    const { code } = auth.createCode(role, "console");
    console.log(`\n  pairing code for a ${role} device: ${code}  (valid 10 minutes)\n`);
    db.close();
    return;
  }

  // `node hub.mjs transcribe note.wav` — check on-device speech-to-text from the Pi's terminal.
  if (process.argv[2] === "transcribe") {
    const stt = loadStt(process.env.NUDGE_STT_MODEL || path.join(cfg.dataDir, "models", "moonshine"), log);
    if (!stt) throw new Error("speech-to-text model isn't installed (sudo ./install.sh --update)");
    const t0 = Date.now();
    console.log(await stt.transcribeWav(new Uint8Array(fs.readFileSync(process.argv[3]))));
    log(`took ${Date.now() - t0} ms`);
    db.close();
    return;
  }

  if (cfg.dev) {
    seedDemo(hub);
    loadPrivateSetup(hub, fileURLToPath(new URL("../../private/nudge-setup.json", import.meta.url)), log);
  }

  // Private search over everything on the wall. Embeddings load in the background if installed.
  const index = new PersonalIndex(hub, null, log);
  void loadEmbedder(process.env.NUDGE_EMBED_MODEL || path.join(cfg.dataDir, "models", "minilm"), log).then((e) => index.setEmbedder(e));
  // On-device speech-to-text (voice notes, and the voice fallback without Gemini).
  const stt = loadStt(process.env.NUDGE_STT_MODEL || path.join(cfg.dataDir, "models", "moonshine"), log);
  const apps = appsService({ hub, apiKey: cfg.composioKey, log });
  const ctx = {} as Ctx;
  Object.assign(ctx, {
    cfg,
    hub,
    auth,
    weather: weatherService(hub, false),
    news: newsService(hub, false),
    school: schoolReader({
      hub,
      vault: new Vault(cfg.dataDir),
      chromium: cfg.chromium,
      dev: cfg.dev,
      log,
      onNeedsSignIn: () => sayOnWall(ctx, "school", "sign in to school again", "ON YOUR COMPUTER", 4000),
    }),
    apps,
    index,
    stt: () => stt,
    agent: agentService({
      hub,
      llm: cfg.openrouterKey ? openRouter(cfg.openrouterKey, { onCost: (usd) => addSpend(hub, usd) }) : null,
      extraTools: async (mode, gate) => [
        searchTool(index),
        ...(mode === "ask" || mode === "watch" ? (await apps.tools()).filter((t) => t.kind === "read") : await apps.tools()).map(gate),
      ],
      say: (i, l, s, ms) => sayOnWall(ctx, i, l, s, ms),
      log,
    }),
    hw: {
      input: (input: HwInput) => hub.bus.broadcast({ type: "input", input }, ["local"]),
      leds: (frame: LedFrame) => hub.bus.broadcast({ type: "leds", frame }, ["local"]),
    },
  } satisfies Ctx);

  ctx.voice = voiceService({ ctx, geminiKey: cfg.geminiKey, stt: () => stt, log });

  const app = await buildServer(ctx);
  await app.listen({ port: cfg.port, host: cfg.host });
  log(`hub up on ${cfg.tlsCert ? "https" : "http"}://${cfg.host}:${cfg.port}  (data: ${cfg.dataDir}${cfg.dev ? ", DEV MODE" : ""})`);
  // Plain-HTTP twin on loopback only, for the wall's own kiosk browser and the hardware daemon.
  const local = await buildServer(ctx, { tls: false });
  await local.listen({ port: cfg.localPort, host: "127.0.0.1" }).catch((e) => log(`local port ${cfg.localPort} unavailable: ${e.message}`));
  if (!auth.listDevices().length) {
    const { code } = auth.createCode("owner", "first-run");
    log(`no devices paired yet — first pairing code (owner): ${code}`);
  }
  if (!cfg.openrouterKey) log("assistant off: set OPENROUTER_API_KEY in /etc/nudge/hub.env (sudo nudge key openrouter)");

  /* -------------------------------- schedule -------------------------------- */
  const every = (ms: number, fn: () => void | Promise<void>, now = true) => {
    const run = () => Promise.resolve(fn()).catch((e) => log(String(e)));
    if (now) setTimeout(run, 2000);
    setInterval(run, ms).unref();
  };
  every(30_000, () => hub.heartbeat());
  every(60 * 60_000, () => ctx.weather.refresh());
  every(60 * 60_000, () => ctx.news.refresh());
  every(7 * 24 * 3600_000, () => refreshTermDates(hub, log), !cfg.dev);
  // School: every 30 min from 7am to 10pm on weekdays, hourly at weekends.
  let lastSchool = 0;
  every(60_000, () => {
    const now = new Date();
    const m = minutesOfDay(now);
    if (m < 7 * 60 || m > 22 * 60) return;
    const gap = isoWeekday(now) >= 6 ? 60 : 30;
    if (Date.now() - lastSchool < gap * 60_000) return;
    lastSchool = Date.now();
    return ctx.school.refresh("scheduled");
  });
  // Reminders and day rollover: tell screens to re-read when the clock crosses into a new minute that matters.
  let lastDay = hub.todayKey();
  every(20_000, () => {
    if (hub.dueReminders().length) hub.bus.changed("reminders");
    const d = hub.todayKey();
    if (d !== lastDay) {
      lastDay = d;
      hub.bus.changed("day", "tasks", "bag");
    }
    const s = hub.session();
    if (s?.state === "break" && s.breakUntil && s.breakUntil <= Date.now()) hub.bus.changed("session");
    // After the last bell: add the homework the timetable says was set today.
    const slots = hub.schoolDay().slots;
    const out = slots.length ? hhmmToMinutes(slots[slots.length - 1].end) : 16 * 60;
    if (minutesOfDay(new Date()) >= out + 5) hub.planHomework();
  });

  const stop = async () => {
    log("shutting down");
    hub.heartbeat();
    await app.close();
    await local.close().catch(() => {});
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
