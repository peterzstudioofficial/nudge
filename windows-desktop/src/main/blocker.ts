import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { tint, type Snapshot } from "@nudge/shared";

/**
 * A tiny local endpoint for the Nudge browser extension (Chrome / Edge). The extension asks
 * "is a session running, and what's blocked?" every few seconds. Only listens on 127.0.0.1,
 * and only answers the extension (it must present the key shown in the Nudge tray menu, which
 * is also written next to the extension so installing is copy-free).
 */
export const BLOCKER_PORT = 47823;

export function blockerKey(): string {
  return keyFile("extension.key");
}

/** The Claude connector's key: a separate file, so the browser extension's key can't call tools. */
export const connectorKeyPath = () => path.join(app.getPath("userData"), "connector.key");
export function connectorKey(): string {
  return keyFile("connector.key");
}

function keyFile(name: string): string {
  const f = path.join(app.getPath("userData"), name);
  try {
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    const k = crypto.randomBytes(16).toString("hex");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, k, { mode: 0o600 });
    return k;
  }
}

export interface Connector {
  tools(): Promise<unknown>;
  call(body: { name: string; args: Record<string, unknown>; threadId: string | null }): Promise<unknown>;
}

export function startBlocker(get: () => Snapshot | null, connector?: Connector): http.Server {
  const key = blockerKey();
  const cKey = connectorKey();
  const server = http.createServer((req, res) => {
    // The Claude connector (nudge-mcp, started by Claude on this computer). Never from a browser.
    if (req.url?.startsWith("/connector/")) {
      const given = String(req.headers["x-nudge-connector"] ?? "");
      const ok = !req.headers.origin && given.length === cKey.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(cKey));
      if (!ok || !connector) return void res.writeHead(403).end();
      const answer = (p: Promise<unknown>) =>
        p.then((j) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(j))))
          .catch((e: Error) => (res.writeHead(502, { "content-type": "text/plain" }), res.end(e.message.slice(0, 300))));
      if (req.method === "GET" && req.url === "/connector/tools") return void answer(connector.tools());
      if (req.method === "POST" && req.url === "/connector/call") {
        let raw = "";
        req.on("data", (d: Buffer) => (raw += d.toString()).length > 200_000 && req.destroy());
        req.on("end", () => {
          try {
            const b = JSON.parse(raw) as { name?: unknown; args?: unknown; threadId?: unknown };
            if (typeof b.name !== "string" || !/^[\w-]{1,64}$/.test(b.name)) throw new Error("bad tool name");
            void answer(connector.call({ name: b.name, args: (b.args && typeof b.args === "object" ? b.args : {}) as Record<string, unknown>, threadId: typeof b.threadId === "string" ? b.threadId : null }));
          } catch (e) {
            res.writeHead(400).end((e as Error).message);
          }
        });
        return;
      }
      return void res.writeHead(404).end();
    }
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
      open: (s?.settings.schoolPages ?? []).map((x) => { try { return new URL(x.url).hostname; } catch { return ""; } }).filter(Boolean),
      task: task ? { name: task.name, subject: task.subject, tint: tint(task.subject) } : null,
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
