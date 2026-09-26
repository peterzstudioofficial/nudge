import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encrypts the school sign-in cookies at rest (AES-256-GCM). The key lives in its own file,
 * readable only by the hub's user (0600), outside the database. The database alone is useless
 * to anyone who copies it.
 */
export class Vault {
  private key: Buffer;

  constructor(dataDir: string) {
    const file = path.join(dataDir, "secret.key");
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 });
    }
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* windows */
    }
    this.key = fs.readFileSync(file);
    if (this.key.length !== 32) throw new Error("secret.key is corrupt — delete it and sign in to school again");
  }

  seal(value: unknown): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  }

  open<T>(sealed: string): T | null {
    try {
      const buf = Buffer.from(sealed, "base64");
      const d = crypto.createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      const out = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
      return JSON.parse(out) as T;
    } catch {
      return null;
    }
  }
}
