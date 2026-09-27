import crypto from "node:crypto";
import type { Hub } from "./hub";
import type { Vault } from "./school/vault";

/**
 * The OpenRouter key. Either set by hand in /etc/nudge/hub.env (`sudo nudge key openrouter`),
 * which always wins, or connected from the setup page with OpenRouter's OAuth (PKCE) flow, in
 * which case it's stored encrypted in the hub's database (same vault as the school sign-in).
 * The key itself is never sent to a phone or computer.
 */
export class Keys {
  private pending: { verifier: string; until: number } | null = null;

  constructor(private hub: Hub, private vault: Vault, private env: { openrouter: string | null }) {}

  openrouter(): string | null {
    return this.env.openrouter || this.stored();
  }

  source(): "hub.env" | "connected" | null {
    return this.env.openrouter ? "hub.env" : this.stored() ? "connected" : null;
  }

  private stored(): string | null {
    const s = this.hub.db.kvGet<string | null>("openrouterKey", null);
    return s ? this.vault.open<string>(s) : null;
  }

  setOpenrouter(key: string | null): void {
    this.hub.db.kvSet("openrouterKey", key ? this.vault.seal(key) : null);
  }

  /** Start "Connect OpenRouter": the browser goes to OpenRouter and comes back with a code. */
  startOAuth(callbackUrl: string): string {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    this.pending = { verifier, until: Date.now() + 10 * 60_000 };
    const q = new URLSearchParams({ callback_url: callbackUrl, code_challenge: challenge, code_challenge_method: "S256" });
    return `https://openrouter.ai/auth?${q.toString()}`;
  }

  /** The verifier for the one sign-in in progress; usable once. */
  takeVerifier(): string | null {
    const p = this.pending;
    this.pending = null;
    return p && p.until > Date.now() ? p.verifier : null;
  }
}
