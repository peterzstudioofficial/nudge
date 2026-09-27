import { app, dialog, Notification, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

/** Is the Claude Code CLI on PATH? */
export function hasClaudeCli(): boolean {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const e of exts) if (dir && fs.existsSync(path.join(dir, `claude${e}`))) return true;
  }
  return false;
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
    new Notification({ title: "Nudge → Claude", body: `Opened Claude ${target === "cowork" ? "Cowork" : "Code"} with the task typed in. Check it, then press send.` }).show();
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

  new Notification({ title: "Nudge → Claude Code", body: `Working in ${ws.name}…` }).show();
  const r = await runClaude(ws.path, task, mode);
  new Notification({ title: "Nudge → Claude Code", body: r.ok ? `Done in ${ws.name}.` : `Didn't finish: ${r.text.slice(0, 80)}` }).show();
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
    // On Windows `claude` is usually a .cmd shim, which needs a shell; every argument above is fixed text.
    const child = spawn("claude", args, { cwd, shell: process.platform === "win32", windowsHide: true, env: { ...process.env } });
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
  new Notification({ title: "Nudge → Claude Code", body: `Building ${title}…` }).show();
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
    new Notification({ title: "Nudge", body: `${title} is ready in your Tools tab.` }).show();
  } catch (e) {
    await done(client, h, false, `couldn't send it to the wall: ${(e as Error).message}`);
  }
}

