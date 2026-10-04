import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";

/**
 * The address a phone should use to reach the wall: what the pair screen shows (and puts in its
 * QR code). The wall's own browser talks to 127.0.0.1, which is no use to a phone.
 *
 * In order: NUDGE_PUBLIC_URL if set; the Tailscale HTTPS name from the wall's certificate
 * (works from anywhere); the Tailscale IP; then the home Wi-Fi address.
 */
export function publicBase(o: { port: number; tlsCert: string | null; tlsKey?: string | null; env?: NodeJS.ProcessEnv; nets?: ReturnType<typeof os.networkInterfaces> }): string | null {
  const env = o.env ?? process.env;
  if (env.NUDGE_PUBLIC_URL && /^https?:\/\/[^\s/]+$/.test(env.NUDGE_PUBLIC_URL.replace(/\/$/, ""))) return env.NUDGE_PUBLIC_URL.replace(/\/$/, "");
  const tls = !!(o.tlsCert && fs.existsSync(o.tlsCert));
  const scheme = tls ? "https" : "http";
  const port = (tls && o.port === 443) || (!tls && o.port === 80) ? "" : `:${o.port}`;
  if (tls) {
    try {
      const san = new crypto.X509Certificate(fs.readFileSync(o.tlsCert!)).subjectAltName ?? "";
      const name = /DNS:([a-z0-9.-]+\.ts\.net)/i.exec(san)?.[1] ?? /DNS:([a-z0-9.-]+)/i.exec(san)?.[1];
      if (name) return `https://${name}${port}`;
    } catch {
      /* unreadable certificate: fall back to an IP */
    }
  }
  const v4 = Object.values(o.nets ?? os.networkInterfaces()).flat().filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  const tailnet = v4.find((a) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a));
  const lan = v4.find((a) => /^(192\.168|10)\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a));
  const ip = tailnet ?? lan ?? v4[0];
  return ip ? `${scheme}://${ip}${port}` : null;
}
