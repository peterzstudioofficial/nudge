import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * Where the desktop app keeps its pairing. The token is encrypted with Windows DPAPI
 * (Electron safeStorage), so it's tied to this Windows user account.
 */
export interface Pairing {
  hub: string;
  token: string;
  name: string;
}

export interface Prefs {
  hudCorner: "br" | "bl" | "tr" | "tl";
  launchAtLogin: boolean;
  watchApps: boolean;
  bedtimeSnoozeUntil: number;
}

const file = () => path.join(app.getPath("userData"), "nudge.json");

interface Disk {
  hub?: string;
  name?: string;
  token?: string; // base64 of the encrypted token
  plainToken?: string; // only when encryption is unavailable (Linux dev without a keyring)
  prefs?: Partial<Prefs>;
}

function read(): Disk {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Disk;
  } catch {
    return {};
  }
}
function write(d: Disk) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 });
}

export function loadPairing(): Pairing | null {
  const d = read();
  if (!d.hub) return null;
  let token = d.plainToken ?? null;
  if (d.token && safeStorage.isEncryptionAvailable()) {
    try {
      token = safeStorage.decryptString(Buffer.from(d.token, "base64"));
    } catch {
      token = null;
    }
  }
  return token ? { hub: d.hub, token, name: d.name ?? "computer" } : null;
}

export function savePairing(p: Pairing | null) {
  const d = read();
  if (!p) {
    delete d.hub;
    delete d.token;
    delete d.plainToken;
  } else {
    d.hub = p.hub;
    d.name = p.name;
    if (safeStorage.isEncryptionAvailable()) {
      d.token = safeStorage.encryptString(p.token).toString("base64");
      delete d.plainToken;
    } else {
      d.plainToken = p.token;
    }
  }
  write(d);
}

export function prefs(): Prefs {
  return { hudCorner: "br", launchAtLogin: true, watchApps: true, bedtimeSnoozeUntil: 0, ...read().prefs };
}
export function setPrefs(p: Partial<Prefs>) {
  const d = read();
  d.prefs = { ...d.prefs, ...p };
  write(d);
}
