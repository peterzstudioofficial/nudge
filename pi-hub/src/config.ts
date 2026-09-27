import fs from "node:fs";
import path from "node:path";

export interface Config {
  dev: boolean;
  dataDir: string;
  port: number;
  /** loopback-only plain HTTP port for the kiosk + GPIO daemon */
  localPort: number;
  /** tools the assistant built are served here, on their own origin */
  toolsPort: number;
  host: string;
  /** optional TLS (Tailscale cert) */
  tlsCert: string | null;
  tlsKey: string | null;
  /** built web apps to serve */
  screenDir: string | null;
  appsDir: string | null;
  /** where Chromium lives for the school reader */
  chromium: string | null;
  /** allow requests from LAN addresses (otherwise loopback + Tailscale only) */
  allowLan: boolean;
  /** OpenRouter: the text assistant */
  openrouterKey: string | null;
  /** Gemini Live: the voice assistant on the wall */
  geminiKey: string | null;
  /** Composio: connected apps as tools */
  composioKey: string | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return undefined;
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

export function loadConfig(): Config {
  const dev = process.argv.includes("--dev") || process.env.NUDGE_DEV === "1";
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const dataDir = path.resolve(arg("data") || process.env.NUDGE_DATA || (dev ? path.join(root, "data") : "/var/lib/nudge"));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const repo = path.resolve(root, "..");
  return {
    dev,
    dataDir,
    port: Number(arg("port") || process.env.NUDGE_PORT || 8787),
    localPort: Number(process.env.NUDGE_LOCAL_PORT || Number(arg("port") || process.env.NUDGE_PORT || 8787) + 1),
    toolsPort: Number(process.env.NUDGE_TOOLS_PORT || Number(arg("port") || process.env.NUDGE_PORT || 8787) + 3),
    host: arg("host") || process.env.NUDGE_HOST || "0.0.0.0",
    tlsCert: process.env.NUDGE_TLS_CERT || null,
    tlsKey: process.env.NUDGE_TLS_KEY || null,
    screenDir: firstExisting([process.env.NUDGE_SCREEN_DIR || "", path.join(repo, "pi-screen/dist"), "/opt/nudge/screen"]),
    appsDir: firstExisting([process.env.NUDGE_APPS_DIR || "", path.join(repo, "apps/dist"), "/opt/nudge/apps"]),
    chromium: firstExisting([
      process.env.NUDGE_CHROMIUM || "",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]),
    allowLan: process.env.NUDGE_ALLOW_LAN !== "0",
    openrouterKey: process.env.OPENROUTER_API_KEY || null,
    geminiKey: process.env.GEMINI_API_KEY || null,
    composioKey: process.env.COMPOSIO_API_KEY || null,
  };
}
