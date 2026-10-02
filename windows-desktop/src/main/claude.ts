import { app, dialog, shell } from "electron";
import { notify } from "./notify";
import crypto from "node:crypto";
import { BLOCKER_PORT, connectorKeyPath } from "./blocker";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ClaudeDesktop, Handoff, HubClient } from "@nudge/shared";
import type { Prefs } from "./store";

/**
 * Hand-offs from the Nudge assistant to Claude on this computer.
 *
 * - "cowork" / "code": opens Claude Desktop (claude://cowork/new, claude://code/new) with the task
 *   typed in. Nothing is sent until Peter reads it and presses send.
 * - "code_run": runs Claude Code headless (`claude -p`) in one of the folders Peter set up here,
 *   after this computer asks him too. By default it can only read and plan; editing files is a
 *   separate switch. It never gets shell commands or network tools beyond Claude Code's
 *   read-only set, and anything that would prompt is refused (nobody is there to answer).
 *
 * The hub only ever learns folder names. Paths, and everything Claude reads here, stay on this PC;
 * only a short result (at most 4,000 characters) goes back to the assistant's thread.
 */
type ClaudeHandoff = Extract<Handoff, { kind: "claude" }>;
export type Workspace = { name: string; path: string };

const RUN_TIMEOUT = 20 * 60_000;

/**
 * Where the Claude Code CLI is: PATH first, then the native installer's own folder (apps started
 * from the Start menu don't always see PATH changes). A real .exe runs directly; an npm .cmd shim
 * needs cmd.exe, so its arguments are quoted for it.
 */
export function findClaude(): { file: string; shim: boolean } | null {
  const win = process.platform === "win32";
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".local", "bin"), ...(win ? [path.join(process.env.APPDATA ?? "", "npm")] : [])];
  for (const e of win ? [".exe", ".cmd"] : [""]) {
    for (const dir of dirs) {
      const f = dir && path.join(dir, `claude${e}`);
      if (f && fs.existsSync(f)) return { file: f, shim: e === ".cmd" };
    }
  }
  return null;
}
export const hasClaudeCli = () => !!findClaude();

/** cmd.exe quoting, for the .cmd shim only. */
const q = (a: string) => {
  // cmd.exe expands %VAR% and ^ even inside quotes: those never reach a command line from here.
  if (/[%^!\r\n]/.test(a)) throw new Error("unsafe argument for the Claude Code shim");
  return /^[\w@+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`;
};

export function spawnClaude(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const c = findClaude();
  if (!c) throw new Error("Claude Code isn't installed on this computer");
  return c.shim
    ? spawn(q(c.file), args.map(q), { cwd, shell: true, windowsHide: true, env })
    : spawn(c.file, args, { cwd, windowsHide: true, env });
}

/** Claude Desktop registers claude:// — on Windows it's in the registry, elsewhere assume the app. */
export function hasClaudeDesktop(): boolean {
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA ?? "";
    return fs.existsSync(path.join(la, "AnthropicClaude")) || fs.existsSync(path.join(la, "Programs", "Claude"));
  }
  if (process.platform === "darwin") return fs.existsSync("/Applications/Claude.app");
  return false;
}

export function claudeCapabilities(p: Prefs): ClaudeDesktop {
  const ws = (p.claudeWorkspaces ?? []).filter((w) => fs.existsSync(w.path));
  return {
    workspaces: ws.map((w) => w.name).slice(0, 20),
    desktopApp: hasClaudeDesktop(),
    cli: hasClaudeCli(),
    allowRun: !!p.claudeAllowRun,
    runMode: p.claudeCanEdit ? "acceptEdits" : "plan",
    chat: !!p.claudeChat && hasClaudeCli(),
  };
}

const done = (client: HubClient, h: ClaudeHandoff, ok: boolean, text: string, costUsd?: number) =>
  client.request("POST", `/api/handoffs/${h.id}/result`, { ok, text: text.slice(0, 4000), ...(costUsd != null ? { costUsd } : {}) }).catch(() => {});

export async function handleClaude(client: HubClient, h: ClaudeHandoff, p: Prefs): Promise<void> {
  if (h.payload.jobId) return buildTool(client, h, p);
  const { target, task, workspace } = h.payload;
  const ws = workspace ? (p.claudeWorkspaces ?? []).find((w) => w.name === workspace) : undefined;
  if (workspace && (!ws || !fs.existsSync(ws.path))) {
    await done(client, h, false, `the folder "${workspace}" isn't set up on this computer any more`);
    return;
  }

  if (target === "cowork" || target === "code") {
    const q = new URLSearchParams({ q: task.slice(0, 5000) });
    if (ws) q.append("folder", ws.path);
    await shell.openExternal(`claude://${target}/new?${q.toString().replace(/\+/g, "%20")}`);
    void notify({ icon: "terminal", line: `Opened Claude ${target === "cowork" ? "Cowork" : "Code"} with the task typed in. Check it, then press send.` });
    await done(client, h, true, `opened Claude ${target === "cowork" ? "Cowork" : "Code"} with the task ready to send`);
    return;
  }

  // code_run
  if (!p.claudeAllowRun || !ws) return void (await done(client, h, false, "running Claude Code isn't switched on for this computer"));
  if (!hasClaudeCli()) return void (await done(client, h, false, "Claude Code isn't installed on this computer"));
  const mode = p.claudeCanEdit ? "acceptEdits" : "plan";
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Run it", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Nudge → Claude Code",
    message: `Run this in "${ws.name}"?`,
    detail: `${task.slice(0, 1500)}\n\nFolder: ${ws.path}\n${mode === "plan" ? "Claude can read and plan, but not change files." : "Claude can edit files in this folder."}`,
  });
  if (response !== 0) return void (await done(client, h, false, "cancelled on the computer"));

  void notify({ icon: "terminal", line: `Working in ${ws.name}…` });
  const r = await runClaude(ws.path, task, mode);
  void notify({ icon: "terminal", line: r.ok ? `Done in ${ws.name}.` : `Didn't finish: ${r.text.slice(0, 80)}` });
  await done(client, h, r.ok, r.text, r.costUsd);
}

/** `claude -p`, prompt on stdin (so nothing from the task ever reaches a command line). */
export function runClaude(cwd: string, task: string, mode: "plan" | "acceptEdits"): Promise<{ ok: boolean; text: string; costUsd?: number }> {
  return new Promise((resolve) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--permission-mode", mode,
      "--permission-prompts", "none",
      "--append-system-prompt",
      "This task was handed over by Nudge, the student's study assistant. Stay inside this folder. Don't install anything, don't push or publish anything, and finish with a short plain summary of what you did or found.",
    ];
    let child: ReturnType<typeof spawnClaude>;
    try {
      child = spawnClaude(args, cwd);
    } catch (e) {
      return resolve({ ok: false, text: (e as Error).message });
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGINT"), RUN_TIMEOUT);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()).length > 2_000_000 && child.kill());
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `couldn't start Claude Code (${e.message})` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { result?: string; is_error?: boolean; total_cost_usd?: number };
        resolve({ ok: code === 0 && !j.is_error, text: (j.result ?? "(no summary)").trim(), costUsd: j.total_cost_usd });
      } catch {
        resolve({ ok: false, text: (err || out || `exited with ${code}`).trim().slice(-600) });
      }
    });
    child.stdin.end(task);
  });
}

/**
 * A build job: Claude Code builds a tool in its own empty folder under Documents/Nudge Builds
 * (the only place it may edit), then the app in out/ goes back to the hub's Tools tab.
 */
async function buildTool(client: HubClient, h: ClaudeHandoff, p: Prefs): Promise<void> {
  const jobId = h.payload.jobId!;
  if (!p.claudeAllowRun) return void (await done(client, h, false, "running Claude Code isn't switched on for this computer"));
  if (!hasClaudeCli()) return void (await done(client, h, false, "Claude Code isn't installed on this computer"));
  const dir = path.join(app.getPath("documents"), "Nudge Builds", jobId.replace(/[^\w-]/g, "").slice(0, 40));
  fs.mkdirSync(dir, { recursive: true });
  const title = /^Build "([^"]+)"/.exec(h.payload.task)?.[1] ?? "a tool";
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Build it", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Nudge → Claude Code",
    message: `Build "${title}" with Claude Code?`,
    detail: `${h.payload.task.slice(0, 1500)}\n\nIt works only in: ${dir}`,
  });
  if (response !== 0) return void (await done(client, h, false, "cancelled on the computer"));
  void notify({ icon: "terminal", line: `Building ${title}…` });
  const r = await runClaude(dir, h.payload.task, "acceptEdits");
  const out = path.join(dir, "out");
  const files: Record<string, string> = {};
  let bytes = 0;
  const walk = (d: string, rel = "") => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rp);
      else if (Object.keys(files).length < 30) {
        const buf = fs.readFileSync(path.join(d, e.name));
        bytes += buf.length;
        if (bytes <= 5 * 1024 * 1024) files[rp] = buf.toString("base64");
      }
    }
  };
  if (fs.existsSync(out)) walk(out);
  if (!files["index.html"]) {
    await done(client, h, false, r.ok ? "Claude Code finished but there's no out/index.html" : r.text);
    return;
  }
  try {
    await client.request("POST", `/api/jobs/${jobId}/tool`, { files, summary: r.text.slice(0, 600) });
    await done(client, h, true, r.text, r.costUsd);
    void notify({ icon: "apps", line: `${title} is ready in your Tools tab.`, ms: 6000 });
  } catch (e) {
    await done(client, h, false, `couldn't send it to the wall: ${(e as Error).message}`);
  }
}


/* ------------------------- Claude as the assistant ------------------------- */

/** The connector script ships outside the app archive so Claude can start it with Node. */
export const connectorScript = () =>
  app.isPackaged ? path.join(process.resourcesPath, "connector", "nudge-mcp.cjs") : path.join(__dirname, "..", "dist-connector", "nudge-mcp.cjs");

/** How Claude starts the Nudge connector: this app's own runtime in Node mode, no token anywhere. */
export function connectorServer(threadId?: string) {
  return {
    command: process.execPath,
    args: [connectorScript()],
    env: { ELECTRON_RUN_AS_NODE: "1", NUDGE_CONNECTOR_KEY: connectorKeyPath(), NUDGE_PORT: String(BLOCKER_PORT), ...(threadId ? { NUDGE_THREAD: threadId } : {}) },
  };
}

type ChatHandoff = Extract<Handoff, { kind: "chat" }>;
const CHAT_TIMEOUT = 140_000;

/**
 * A question from the phone or computer, answered in one ongoing Claude Code chat on Peter's own
 * plan. Claude gets no built-in tools at all (no files, no commands, no web), only the Nudge
 * connector; anything it wants to do becomes a question he must hold yes to.
 */
export async function handleChat(client: HubClient, h: ChatHandoff, p: Prefs, save: (sid: string | null) => void): Promise<void> {
  const answer = (ok: boolean, text: string) => client.request("POST", `/api/handoffs/${h.id}/result`, { ok, text: text.slice(0, 4000) }).catch(() => {});
  if (!p.claudeChat) return void (await answer(false, "Claude isn't switched on for the assistant on this computer"));
  const dir = path.join(app.getPath("userData"), "claude-chat");
  fs.mkdirSync(dir, { recursive: true });
  const sysFile = path.join(dir, "nudge-system.txt");
  const mcpFile = path.join(dir, "mcp.json");
  fs.writeFileSync(sysFile, h.payload.system);
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { nudge: connectorServer(h.payload.threadId) } }));
  const input = `${h.payload.context}\n\n${h.payload.prompt}`;

  const once = (sid: string | null) =>
    new Promise<{ ok: boolean; text: string; sid: string | null; missing?: boolean }>((resolve) => {
      const fresh = sid ?? crypto.randomUUID();
      const args = [
        "-p", "--output-format", "json", "--model", "sonnet",
        ...(sid ? ["--resume", sid] : ["--session-id", fresh]),
        "--tools", "", "--strict-mcp-config", "--mcp-config", mcpFile, "--allowedTools", "mcp__nudge",
        "--permission-prompts", "none", "--max-turns", "12", "--append-system-prompt-file", sysFile,
      ];
      let child: ReturnType<typeof spawnClaude>;
      try {
        child = spawnClaude(args, dir);
      } catch (e) {
        return resolve({ ok: false, text: (e as Error).message, sid });
      }
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill(), CHAT_TIMEOUT);
      child.stdout.on("data", (d: Buffer) => (out += d.toString()).length > 2_000_000 && child.kill());
      child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
      child.on("error", (e) => (clearTimeout(timer), resolve({ ok: false, text: e.message, sid })));
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { result?: string; is_error?: boolean; session_id?: string };
          resolve({ ok: code === 0 && !j.is_error, text: (j.result ?? "").trim() || "(no answer)", sid: j.session_id ?? fresh });
        } catch {
          const text = (err || out || `exited with ${code}`).trim();
          resolve({ ok: false, text: text.slice(-400), sid, missing: !!sid && /no conversation|not found|session/i.test(text) });
        }
      });
      child.stdin.end(input);
    });

  let r = await once(p.claudeChatSession);
  if (!r.ok && r.missing) r = await once(null); // the old chat was deleted: start a new one
  if (r.ok && r.sid !== p.claudeChatSession) save(r.sid);
  await answer(r.ok, r.text);
}

/**
 * Add the Nudge connector to Claude Desktop (its config file) and Claude Code (user scope), so
 * Peter can talk to Claude with his Nudge stuff in any chat, on his own plan. Asks first.
 */
export async function addConnectorToClaude(): Promise<string[]> {
  const done: string[] = [];
  const server = connectorServer();
  const base = process.platform === "win32" ? process.env.APPDATA ?? "" : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config");
  const cfgPath = path.join(base, "Claude", "claude_desktop_config.json");
  if (hasClaudeDesktop() || fs.existsSync(cfgPath)) {
    let cfg: { mcpServers?: Record<string, unknown> } = {};
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      fs.copyFileSync(cfgPath, cfgPath + ".before-nudge");
    } catch {
      /* no config yet */
    }
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), nudge: server };
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    done.push("Claude Desktop (restart it)");
  }
  if (hasClaudeCli()) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const c = spawnClaude(["mcp", "add-json", "nudge", JSON.stringify({ type: "stdio", ...server }), "--scope", "user"], os.homedir());
        c.on("close", (code) => resolve(code === 0));
        c.on("error", () => resolve(false));
      } catch {
        resolve(false);
      }
    });
    if (ok) done.push("Claude Code");
  }
  return done;
}
