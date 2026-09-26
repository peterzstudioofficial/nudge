import crypto from "node:crypto";
import type { Device, Role } from "@nudge/shared";
import type { Db } from "./db";
import { HttpError } from "./errors";

/**
 * Who is asking.
 *  - Loopback (the wall's own kiosk browser and the GPIO daemon on the Pi) is the `screen`.
 *  - Everyone else presents a bearer token they got by pairing with a 6-digit code.
 * Tokens are 256-bit random values; only their SHA-256 is stored, so a stolen database
 * doesn't leak working tokens. Pairing codes expire after 10 minutes and are single-use.
 */

interface StoredDevice extends Device {
  tokenHash: string;
  revoked: boolean;
}

interface PairCode {
  hash: string;
  role: Role;
  expires: number;
  createdBy: string;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface Caller {
  role: Role;
  deviceId: string;
  name: string;
}

export class Auth {
  private devices;
  private attempts = new Map<string, { n: number; until: number }>();

  constructor(private db: Db) {
    this.devices = db.collection<StoredDevice>("device", () => null, (d) => d.createdAt);
  }

  listDevices(): Device[] {
    return this.devices
      .all()
      .filter((d) => !d.revoked)
      .map(({ id, name, role, createdAt, lastSeen }) => ({ id, name, role, createdAt, lastSeen }));
  }

  hasRole(role: Role): boolean {
    return this.devices.all().some((d) => !d.revoked && d.role === role);
  }

  revoke(id: string): void {
    const d = this.devices.get(id);
    if (d) this.devices.put({ ...d, revoked: true });
  }

  /** Make a one-time pairing code. Returns the plain code once; only a hash is kept. */
  createCode(role: Role, createdBy: string): { code: string; expires: number } {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expires = Date.now() + 10 * 60_000;
    const codes = this.codes().filter((c) => c.expires > Date.now());
    codes.push({ hash: sha(code), role, expires, createdBy });
    this.db.kvSet("pairCodes", codes.slice(-10));
    return { code, expires };
  }

  private codes(): PairCode[] {
    return this.db.kvGet<PairCode[]>("pairCodes", []);
  }

  /** Exchange a code for a device token. 5 wrong tries from one address locks it out for 10 minutes. */
  pair(code: string, name: string, ip: string): { token: string; device: Device } {
    const a = this.attempts.get(ip);
    if (a && a.until > Date.now() && a.n >= 5) throw new HttpError(429, "too many tries, wait 10 minutes");
    const h = sha(code.replace(/\D/g, ""));
    const codes = this.codes();
    const match = codes.find((c) => c.expires > Date.now() && crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(h)));
    if (!match) {
      const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 10 * 60_000 };
      cur.n++;
      this.attempts.set(ip, cur);
      throw new HttpError(401, "that code didn't work");
    }
    this.attempts.delete(ip);
    this.db.kvSet("pairCodes", codes.filter((c) => c !== match && c.expires > Date.now()));
    const token = crypto.randomBytes(32).toString("base64url");
    const device: StoredDevice = {
      id: crypto.randomUUID(),
      name: name.slice(0, 40) || "device",
      role: match.role,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      tokenHash: sha(token),
      revoked: false,
    };
    this.devices.put(device);
    return { token, device: { id: device.id, name: device.name, role: device.role, createdAt: device.createdAt, lastSeen: device.lastSeen } };
  }

  /** Resolve a request to a caller, or null. */
  identify(token: string | null, ip: string, loopbackIsScreen: boolean): Caller | null {
    if (token) {
      const h = sha(token);
      const d = this.devices.all().find((x) => !x.revoked && x.tokenHash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(h)));
      if (d) {
        if (!d.lastSeen || Date.now() - d.lastSeen > 60_000) this.devices.put({ ...d, lastSeen: Date.now() });
        return { role: d.role, deviceId: d.id, name: d.name };
      }
    }
    if (loopbackIsScreen && isLoopback(ip)) return { role: "screen", deviceId: "wall", name: "the wall" };
    return null;
  }
}

export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Tailscale's CGNAT range 100.64.0.0/10 and its IPv6 prefix. */
export function isTailscale(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  const m = /^(\d+)\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127) return true;
  return ip.toLowerCase().startsWith("fd7a:115c:a1e0");
}

export function isPrivateLan(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  return /^10\./.test(v4) || /^192\.168\./.test(v4) || /^172\.(1[6-9]|2\d|3[01])\./.test(v4) || /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip);
}
