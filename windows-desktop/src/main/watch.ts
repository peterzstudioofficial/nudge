import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { powerMonitor } from "electron";
import { watcherScript } from "./focus";
export { blockedApp, writeControl } from "./focus";

/**
 * What's on screen, for the "off task" nudge and for keeping blocked apps out of the way.
 * Only the foreground window's title and process name are looked at, nothing is stored or sent
 * anywhere — it stays on this computer.
 *
 * Blocking: during a running session the loop reads a small control file (written by the app:
 * "is a session on, and which apps are blocked") and minimises a blocked app the moment it comes
 * to the front, every time. Nothing is closed or killed, so no work is ever lost.
 */
export interface Foreground {
  title: string;
  process: string;
  /** true when the loop just minimised this window because it's blocked */
  blocked?: boolean;
}


export class Watcher {
  private proc: ChildProcessWithoutNullStreams | null = null;
  last: Foreground | null = null;
  private listeners = new Set<(f: Foreground) => void>();

  constructor(private control: string) {}

  start() {
    if (process.platform !== "win32" || this.proc) return;
    this.proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", watcherScript(this.control, process.pid)], { windowsHide: true });
    let buf = "";
    this.proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const parts = line.split("|");
        if (parts.length < 3) continue;
        const f: Foreground = { blocked: parts[0] === "B", process: parts[1].toLowerCase(), title: parts.slice(2).join("|") };
        this.last = f;
        for (const l of this.listeners) l(f);
      }
    });
    this.proc.on("exit", () => {
      this.proc = null;
    });
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }

  on(l: (f: Foreground) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Seconds since the last keyboard or mouse input on this computer. */
  idleSeconds(): number {
    return powerMonitor.getSystemIdleTime();
  }
}

/** Is this window a distraction? Matches site names in window titles (browsers show the page title + site). */
export function distraction(f: Foreground, blockList: string[]): string | null {
  const t = f.title.toLowerCase();
  for (const site of blockList) {
    const name = site.replace(/^www\./, "").split(".")[0];
    if (name.length >= 3 && (t.includes(name) || f.process.includes(name))) return name;
  }
  return null;
}
