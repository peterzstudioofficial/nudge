import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { Snapshot } from "@nudge/shared";

/**
 * A tiny local endpoint for the Nudge browser extension (Chrome / Edge). The extension asks
 * "is a session running, and what's blocked?" every few seconds. Only listens on 127.0.0.1,
 * and only answers the extension (it must present the key shown in the Nudge tray menu, which
 * is also written next to the extension so installing is copy-free).
 */
export const BLOCKER_PORT = 47823;

export function blockerKey(): string {
  const f = path.join(app.getPath("userData"), "extension.key");
  try {
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    const k = crypto.randomBytes(16).toString("hex");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, k, { mode: 0o600 });
    return k;
  }
}

export function startBlocker(get: () => Snapshot | null): http.Server {
  const key = blockerKey();
  const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin || "");
    const fromExtension = origin.startsWith("chrome-extension://") || origin.startsWith("extension://");
    if (fromExtension) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "x-nudge-key");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (req.url !== "/state" || req.headers["x-nudge-key"] !== key) return void res.writeHead(403).end();
    const s = get();
    const sess = s?.session;
    const task = sess ? s!.tasks.find((t) => t.id === sess.taskId) : null;
    const worked = sess ? (sess.state === "running" && sess.runningSince ? sess.workedSec + (Date.now() - sess.runningSince) / 1000 : sess.workedSec) : 0;
    const body = {
      active: !!sess && sess.state !== "break",
      blockList: s?.settings.blockList ?? [],
      studyOnly: s?.settings.studyOnlySites ?? [],
      task: task ? { name: task.name, subject: task.subject } : null,
      pct: sess ? Math.min(100, Math.round((worked / sess.totalSec) * 100)) : 0,
      keywords: (s?.tasks ?? []).filter((t) => !t.done).flatMap((t) => [t.name, t.subject]).join(" ").toLowerCase(),
    };
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  });
  server.listen(BLOCKER_PORT, "127.0.0.1");
  server.on("error", () => {
    /* another copy is running; the single-instance lock normally prevents this */
  });
  return server;
}
