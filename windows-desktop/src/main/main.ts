import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray, clipboard } from "electron";
import fs from "node:fs";
import path from "node:path";
import { HubClient, memoryKV, type Snapshot, type Handoff, hhmmToMinutes } from "@nudge/shared";
import { loadPairing, savePairing, prefs, setPrefs, type Pairing } from "./store";
import { Watcher, distraction } from "./watch";
import { signInToSchool, openDraft } from "./school";
import { startBlocker, blockerKey, BLOCKER_PORT } from "./blocker";
import { claudeCapabilities, handleClaude } from "./claude";

/**
 * Nudge for Windows.
 *  - the on-task HUD (small window, bottom right) that mirrors the wall's session
 *  - the Nudge agent window (the assistant, asks before anything is sent)
 *  - school sign-in for the wall, and finishing email drafts by hand
 *  - the local endpoint the browser blocker extension reads
 */

const DEV = process.argv.includes("--dev") || !app.isPackaged;
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
const RENDERER = path.join(RES, app.isPackaged ? "renderer" : "dist-renderer");

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("studio.peterz.nudge");

let tray: Tray | null = null;
let hud: BrowserWindow | null = null;
let agent: BrowserWindow | null = null;
let pairWin: BrowserWindow | null = null;
let client: HubClient | null = null;
let pairing: Pairing | null = null;
let snap: Snapshot | null = null;
const watcher = new Watcher();
const openHandoffs = new Set<string>();

/* --------------------------------- windows -------------------------------- */

const secure = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  preload: path.join(__dirname, "preload.cjs"),
};

function page(win: BrowserWindow, name: string) {
  void win.loadFile(path.join(RENDERER, `${name}.html`));
  // Our windows never navigate anywhere or open popups.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function hudBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 268, h = 242, m = 16;
  const c = prefs().hudCorner;
  return { width: w, height: h, x: c.endsWith("r") ? wa.x + wa.width - w - m : wa.x + m, y: c.startsWith("b") ? wa.y + wa.height - h - m : wa.y + m };
}

function openHud() {
  if (hud && !hud.isDestroyed()) {
    hud.showInactive();
    return;
  }
  hud = new BrowserWindow({
    ...hudBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: secure,
  });
  hud.setAlwaysOnTop(true, "floating");
  page(hud, "hud");
  hud.once("ready-to-show", () => hud?.showInactive());
  hud.on("closed", () => (hud = null));
}

function openAgent() {
  if (agent && !agent.isDestroyed()) {
    agent.show();
    agent.focus();
    return;
  }
  agent = new BrowserWindow({
    width: 720,
    height: 500,
    minWidth: 560,
    minHeight: 400,
    frame: false,
    backgroundColor: "#0c0c0c",
    title: "Nudge agent",
    show: false,
    webPreferences: secure,
  });
  page(agent, "agent");
  agent.once("ready-to-show", () => agent?.show());
  agent.on("closed", () => (agent = null));
}

function openPair() {
  if (pairWin && !pairWin.isDestroyed()) return pairWin.focus();
  pairWin = new BrowserWindow({ width: 420, height: 600, resizable: false, autoHideMenuBar: true, backgroundColor: "#0a0a0c", title: "Connect to the wall", webPreferences: secure });
  page(pairWin, "pair");
  pairWin.on("closed", () => (pairWin = null));
}

/** The phone apps (my app, notes, setup) served by the hub, in a window, already signed in. */
function openHubApp(file: "index" | "notes" | "admin", title: string) {
  if (!pairing) return openPair();
  const win = new BrowserWindow({
    width: file === "admin" ? 980 : 420,
    height: file === "admin" ? 820 : 820,
    title,
    autoHideMenuBar: true,
    backgroundColor: file === "notes" ? "#f4f3ef" : "#0a0a0c",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: "persist:hubapps" },
  });
  const base = pairing.hub.replace(/\/$/, "");
  const p = pairing;
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(base + "/app/")) e.preventDefault();
  });
  // Hand this computer's pairing to the page once, so it doesn't ask for a code.
  win.webContents.once("did-finish-load", () => {
    const stored = JSON.stringify({ hub: base, token: p.token, role: "desktop", name: p.name });
    void win.webContents
      .executeJavaScript(`(() => { if (!localStorage.getItem("nudge-owner:pairing")) { localStorage.setItem("nudge-owner:pairing", ${JSON.stringify(stored)}); location.reload(); } })()`)
      .catch(() => {});
  });
  void win.loadURL(`${base}/app/${file}.html`);
}

/* ---------------------------------- tray ---------------------------------- */

function trayIcon() {
  const f = path.join(RES, "build", "tray.png");
  return fs.existsSync(f) ? nativeImage.createFromPath(f) : nativeImage.createEmpty();
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip("Nudge");
    tray.on("click", () => (pairing ? openHud() : openPair()));
  }
  const p = prefs();
  const sess = snap?.session;
  const task = sess ? snap!.tasks.find((t) => t.id === sess.taskId) : null;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: pairing ? (task ? `Focusing: ${task.name}` : snap ? `${snap.tasks.filter((t) => !t.done).length} tasks left today` : "Connecting…") : "Not connected", enabled: false },
      { type: "separator" },
      { label: "On-task window", enabled: !!pairing, click: openHud },
      { label: "Nudge agent", enabled: !!pairing, click: openAgent },
      { label: "My tasks", enabled: !!pairing, click: () => openHubApp("index", "Nudge") },
      { label: "Notes", enabled: !!pairing, click: () => openHubApp("notes", "Nudge notes") },
      { type: "separator" },
      { label: snap?.school.needsSignIn ? "Sign in to school again…" : "Sign in to school…", enabled: !!client, click: () => client && void signInToSchool(client) },
      { label: "Set up the wall…", enabled: !!pairing, click: () => openHubApp("admin", "Nudge setup") },
      {
        label: "Browser blocker",
        submenu: [
          { label: "Open the extension folder", click: () => void shell.openPath(extensionDir()) },
          { label: "Copy install steps", click: () => clipboard.writeText(`1. Open edge://extensions (or chrome://extensions)\n2. Turn on Developer mode\n3. Load unpacked → ${extensionDir()}`) },
        ],
      },
      {
        label: "My tools",
        enabled: !!snap?.tools.length,
        submenu: (snap?.tools ?? []).slice(0, 15).map((t) => ({ label: t.title, click: () => void openToolInBrowser(t.id) })),
      },
      {
        label: "Claude on this computer",
        submenu: [
          { label: "Let the assistant run Claude Code here", type: "checkbox", checked: p.claudeAllowRun, click: (i) => { setPrefs({ claudeAllowRun: i.checked }); reportClaude(); } },
          { label: "…and edit files (off = read and plan only)", type: "checkbox", enabled: p.claudeAllowRun, checked: p.claudeCanEdit, click: (i) => { setPrefs({ claudeCanEdit: i.checked }); reportClaude(); } },
          { type: "separator" },
          { label: "Add a folder…", click: () => void addClaudeFolder() },
          ...p.claudeWorkspaces.map((w) => ({
            label: `Remove "${w.name}"`,
            click: () => { setPrefs({ claudeWorkspaces: prefs().claudeWorkspaces.filter((x) => x.path !== w.path) }); reportClaude(); buildTray(); },
          })),
        ],
      },
      { type: "separator" },
      { label: "Start with Windows", type: "checkbox", checked: p.launchAtLogin, click: (i) => { setPrefs({ launchAtLogin: i.checked }); applyLogin(); } },
      { label: "Nudge me when I drift", type: "checkbox", checked: p.watchApps, click: (i) => setPrefs({ watchApps: i.checked }) },
      { label: pairing ? `Disconnect from the wall (${pairing.name})` : "Connect to the wall…", click: () => { if (pairing) unpair(); else openPair(); } },
      { label: "Quit Nudge", click: () => { app.exit(0); } },
    ]),
  );
}

/** Built tools open in the normal browser (their own origin on the wall; installable there too). */
async function openToolInBrowser(id: string) {
  if (!client) return;
  const r = await client.get<{ origin: string }>("/api/tools").catch(() => null);
  if (r?.origin && /^https?:\/\//.test(r.origin)) void shell.openExternal(`${r.origin}/t/${encodeURIComponent(id)}/`);
}

/** Tell the hub what Claude can do on this computer (folder names only). */
function reportClaude() {
  if (!client) return;
  void client.request("PUT", "/api/desktop/claude", claudeCapabilities(prefs())).catch(() => {});
}

async function addClaudeFolder() {
  const r = await dialog.showOpenDialog({ title: "A folder Claude Code may work in", properties: ["openDirectory"] });
  const dir = r.filePaths[0];
  if (r.canceled || !dir) return;
  const list = prefs().claudeWorkspaces.filter((w) => w.path !== dir);
  let name = path.basename(dir).toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 40) || "folder";
  while (list.some((w) => w.name === name)) name = `${name.slice(0, 36)}-${list.length + 1}`;
  setPrefs({ claudeWorkspaces: [...list, { name, path: dir }].slice(0, 20) });
  reportClaude();
  buildTray();
}

function applyLogin() {
  if (process.platform === "win32" || process.platform === "darwin") app.setLoginItemSettings({ openAtLogin: prefs().launchAtLogin, args: ["--hidden"] });
}

/* -------------------------------- the hub --------------------------------- */

function connect(p: Pairing) {
  pairing = p;
  client?.close();
  client = new HubClient({ baseUrl: p.hub, token: p.token, kv: memoryKV(), WebSocketImpl: globalThis.WebSocket, fetchImpl: globalThis.fetch });
  client.onSnapshot((s) => {
    const before = snap;
    snap = s;
    broadcast("snapshot", s);
    onSnapshot(before, s);
    buildTray();
  });
  client.onStatus((on) => broadcast("online", on));
  client.onMessage((m) => {
    if (m.type === "changed" && m.topics.some((t) => t === "handoffs" || t === "asks")) void checkHandoffs();
    if (m.type === "changed" && m.topics.includes("agent")) broadcast("agent-changed", m.rev);
  });
  client.connect();
  void client.snapshot().catch(() => {});
  void checkHandoffs();
  reportClaude();
  buildTray();
}

function unpair() {
  client?.close();
  client = null;
  pairing = null;
  snap = null;
  savePairing(null);
  hud?.close();
  agent?.close();
  buildTray();
  openPair();
}

function broadcast(channel: string, data: unknown) {
  for (const w of [hud, agent, pairWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
}

async function checkHandoffs() {
  if (!client) return;
  try {
    const list = await client.get<Handoff[]>("/api/handoffs");
    for (const h of list) {
      if (openHandoffs.has(h.id)) continue;
      openHandoffs.add(h.id);
      if (h.kind === "compose") await openDraft(client, h);
      else if (h.kind === "claude") void handleClaude(client, h, prefs());
    }
  } catch {
    /* offline */
  }
}

/* ------------------------------ nudges logic ------------------------------ */

let lastDrift: { name: string; at: number }[] = [];
let idleNudged = false;
let lastSignPrompt = 0;
let bedtimeShown = "";

function onSnapshot(before: Snapshot | null, s: Snapshot) {
  const running = s.session?.state === "running";
  if (running && !before?.session) openHud();
  if (s.school.needsSignIn && Date.now() - lastSignPrompt > 6 * 3600_000) {
    lastSignPrompt = Date.now();
    openHud();
    setTimeout(() => broadcast("sign", "ask"), 600);
  }
}

watcher.on((f) => {
  const s = snap;
  if (!s || s.session?.state !== "running" || !prefs().watchApps) return;
  const name = distraction(f, s.settings.blockList);
  if (!name) return;
  const now = Date.now();
  lastDrift = [...lastDrift.filter((d) => now - d.at < 60_000), { name, at: now }];
  const hits = lastDrift.filter((d) => d.name === name).length;
  if (hits === 2) {
    const task = s.tasks.find((t) => t.id === s.session!.taskId);
    openHud();
    broadcast("nudge", { icon: "visibility", line: `${name} twice in a minute. back to ${task?.name ?? "it"}?` });
  }
});

setInterval(() => {
  const s = snap;
  if (!s) return;
  // Idle for six minutes during a running session: one quiet nudge.
  if (s.session?.state === "running") {
    const idle = watcher.idleSeconds();
    if (idle >= 360 && !idleNudged) {
      idleNudged = true;
      broadcast("nudge", { icon: "hourglass_top", line: "nothing typed for six minutes." });
    }
    if (idle < 30) idleNudged = false;
  }
  // Bedtime: reopen the window with "time to sleep", once a night (snooze 10 min).
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const bed = hhmmToMinutes(s.settings.bedtime);
  const key = now.toDateString();
  if (mins >= bed && bedtimeShown !== key && Date.now() > prefs().bedtimeSnoozeUntil) {
    bedtimeShown = key;
    openHud();
    setTimeout(() => broadcast("bedtime", true), 600);
  }
}, 15_000);

/* ----------------------------------- IPC ---------------------------------- */

const ALLOWED = /^\/api\/(state|agent\/threads(\/[\w-]+(\/stop)?)?|asks\/[\w-]+\/answer|session\/(pause|resume|break|switch)|notes|school\/(status|refresh)|feed|stats)$/;

ipcMain.handle("state", () => ({ snap, online: client?.online ?? false, paired: !!pairing, hub: pairing?.hub ?? null }));
ipcMain.handle("hub", async (_e, method: string, p: string, body?: unknown) => {
  if (!client) throw new Error("not connected");
  const bare = p.split("?")[0];
  if (!ALLOWED.test(bare)) throw new Error("not allowed from this window");
  if (method === "GET") return client.get(p);
  return client.request(method, p, body);
});
ipcMain.handle("pair", async (_e, hub: string, code: string, name: string) => {
  const base = hub.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("the hub address starts with https:// or http://");
  const res = await fetch(base + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.replace(/\D/g, ""), name }) });
  const data = (await res.json().catch(() => ({}))) as { token?: string; device?: { role: string }; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error || "couldn't reach the hub");
  if (data.device?.role !== "desktop" && data.device?.role !== "owner") throw new Error("use a code from “pair a computer”");
  const p = { hub: base, token: data.token, name };
  savePairing(p);
  connect(p);
  pairWin?.close();
  openHud();
  return true;
});
ipcMain.handle("signin", async () => (client ? signInToSchool(client, hud ?? undefined) : false));
ipcMain.handle("win", (e, action: "min" | "max" | "close" | "hide") => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === "min") w.minimize();
  if (action === "max") (w.isMaximized() ? w.unmaximize() : w.maximize());
  if (action === "close") w.close();
  if (action === "hide") w.hide();
});
ipcMain.handle("open", (_e, what: "agent" | "notes" | "tasks") => {
  if (what === "agent") openAgent();
  if (what === "notes") openHubApp("notes", "Nudge notes");
  if (what === "tasks") openHubApp("index", "Nudge");
});
ipcMain.handle("snooze-bedtime", () => setPrefs({ bedtimeSnoozeUntil: Date.now() + 10 * 60_000 }));
ipcMain.handle("copy", (_e, text: string) => clipboard.writeText(String(text).slice(0, 20_000)));

/* ------------------------------ extension dir ----------------------------- */

function extensionDir(): string {
  const dst = path.join(app.getPath("userData"), "browser-extension");
  const src = path.join(RES, "extension");
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    fs.writeFileSync(path.join(dst, "key.json"), JSON.stringify({ key: blockerKey(), port: BLOCKER_PORT }));
  } catch {
    /* dev without a built extension */
  }
  return dst;
}

/* --------------------------------- start ---------------------------------- */

app.on("second-instance", () => (pairing ? openHud() : openPair()));
app.on("window-all-closed", () => {
  /* keep running in the tray */
});

void app.whenReady().then(() => {
  applyLogin();
  buildTray();
  startBlocker(() => snap);
  extensionDir();
  watcher.start();
  const p = loadPairing();
  if (p) {
    connect(p);
    if (!process.argv.includes("--hidden")) openHud();
  } else {
    openPair();
  }
  if (DEV) console.log("nudge desktop (dev) — renderer:", RENDERER);
  void Notification.isSupported();
});
