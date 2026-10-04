import { askNeedsHold, type Ask, type Session } from "./model";
import { sessionView } from "./rules";

/**
 * What the Glyph lights on the back of a Nothing phone show. Calm on purpose: they say what's going
 * on at a glance and never flash for attention.
 *
 * Zones are numbered from the top (on the Phone (4a): 0 = A1 at the top, 5 = A6 at the bottom).
 * A phone whose Glyphs are one light (zones = 0) gets the same moments on its whole Glyph.
 */
export type GlyphCmd =
  | { kind: "off" }
  | { kind: "light"; zones: number[] }
  | { kind: "breathe"; zones: number[]; period: number };

export interface GlyphState {
  session: Session | null;
  asks: Ask[];
  now: number;
  /** zones on this phone (6 on the Phone (4a)); 0 = the Glyph is one light */
  zones: number;
}

const all = (n: number) => Array.from({ length: Math.max(1, n) }, (_, i) => i);

export function glyphPlan(st: GlyphState): GlyphCmd {
  const n = st.zones;
  const top = [0];
  const bottom = [Math.max(0, n - 1)];
  // 1. Something waiting for a held yes (an email, a message): a slow pulse at the top.
  if (st.asks.some((a) => a.status === "pending" && askNeedsHold(a))) return { kind: "breathe", zones: top, period: 1600 };
  const s = st.session;
  if (!s) return { kind: "off" };
  const v = sessionView(s, st.now);
  // 2. Break: the whole bar breathes slowly (stand up, walk).
  if (s.state === "break") return { kind: "breathe", zones: all(n), period: 4000 };
  // 3. Paused: the bottom zone breathes, so you know it's kept.
  if (s.state === "paused") return { kind: "breathe", zones: bottom, period: 3000 };
  // 4. Time's up and it can be claimed: the top zone pulses.
  if (v.claimReady) return { kind: "breathe", zones: top, period: 1200 };
  // 5. Focus: time left, as a bar from the bottom that shrinks as the session goes.
  if (n === 0) return { kind: "light", zones: [0] };
  const lit = Math.max(1, Math.ceil(v.frac * n));
  return { kind: "light", zones: Array.from({ length: lit }, (_, i) => n - 1 - i).sort((a, b) => a - b) };
}

/** Same command, same key: only send when the picture changes. */
export const glyphKey = (c: GlyphCmd) => (c.kind === "off" ? "off" : `${c.kind}:${c.zones.join(",")}${c.kind === "breathe" ? `@${c.period}` : ""}`);
