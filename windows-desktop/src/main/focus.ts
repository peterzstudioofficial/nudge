import fs from "node:fs";

/** The same rule the loop uses, for the app's own decisions and for tests. */
export function blockedApp(f: { process: string; title: string }, apps: string[], active: boolean): string | null {
  if (!active) return null;
  const p = f.process.toLowerCase();
  if (!p || p === "nudge" || p === "explorer") return null;
  for (const raw of apps) {
    const a = raw.toLowerCase().replace(/\.exe$/, "");
    if (p === a || (p === "applicationframehost" && f.title.toLowerCase().includes(a))) return a;
  }
  return null;
}

/** Tell the watcher loop whether a session is on and which apps to keep minimised. */
export function writeControl(file: string, active: boolean, apps: string[], now = Date.now()) {
  const clean = [...new Set(apps.map((a) => a.toLowerCase().trim().replace(/\.exe$/, "")).filter((a) => /^[a-z0-9 ._-]{2,60}$/.test(a) && a !== "nudge" && a !== "explorer"))];
  try {
    // "until": if Nudge stops refreshing this (crashed, frozen), blocking lapses by itself.
    fs.writeFileSync(file, JSON.stringify({ active, apps: clean, until: now + 90_000 }));
  } catch {
    /* next snapshot tries again */
  }
}

/** The PowerShell loop behind the watcher (foreground window, and minimising blocked apps). */
export const watcherScript = (control: string, parentPid: number) => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NudgeFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
"@
$control = '${control.replace(/'/g, "''")}'
$parent = ${parentPid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  $active = $false; $apps = @()
  try {
    $c = Get-Content -Raw -LiteralPath $control | ConvertFrom-Json
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $active = [bool]$c.active -and ([int64]$c.until -gt $nowMs)
    $apps = @($c.apps)
  } catch {}
  $h = [NudgeFg]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][NudgeFg]::GetWindowText($h, $sb, 512)
  $pid2 = 0
  [void][NudgeFg]::GetWindowThreadProcessId($h, [ref]$pid2)
  $p = ""
  try { $p = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName.ToLower() } catch {}
  $t = $sb.ToString()
  $hit = $false
  if ($active -and $p -ne "" -and $p -ne "nudge" -and $p -ne "explorer") {
    foreach ($a in $apps) {
      if ($p -eq $a -or ($p -eq "applicationframehost" -and $t.ToLower().Contains($a))) { $hit = $true; break }
    }
  }
  if ($hit) { [void][NudgeFg]::ShowWindow($h, 6) }
  $flag = ""; if ($hit) { $flag = "B" }
  [Console]::Out.WriteLine(($flag + "|" + $p + "|" + $t))
  [Console]::Out.Flush()
  if ($active) { Start-Sleep -Milliseconds 700 } else { Start-Sleep -Seconds 2 }
}
`;
