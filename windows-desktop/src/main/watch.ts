import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { powerMonitor } from "electron";

/**
 * What's on screen, for the "off task" nudge. Only the foreground window's title and process
 * name are looked at, only during a focus session, and nothing is stored or sent anywhere —
 * it stays on this computer.
 */
export interface Foreground {
  title: string;
  process: string;
}

const PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NudgeFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
while ($true) {
  $h = [NudgeFg]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][NudgeFg]::GetWindowText($h, $sb, 512)
  $pid2 = 0
  [void][NudgeFg]::GetWindowThreadProcessId($h, [ref]$pid2)
  $p = ""
  try { $p = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine(($p + "|" + $sb.ToString()))
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
`;

export class Watcher {
  private proc: ChildProcessWithoutNullStreams | null = null;
  last: Foreground | null = null;
  private listeners = new Set<(f: Foreground) => void>();

  start() {
    if (process.platform !== "win32" || this.proc) return;
    this.proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS], { windowsHide: true });
    let buf = "";
    this.proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const bar = line.indexOf("|");
        if (bar < 0) continue;
        const f = { process: line.slice(0, bar).toLowerCase(), title: line.slice(bar + 1) };
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
  if (["steam", "epicgameslauncher", "robloxplayerbeta", "discord"].includes(f.process)) return f.process;
  return null;
}
