import { useEffect, useRef, useState } from "react";
import { glyphKey, glyphPlan, type GlyphCmd, type Snapshot } from "@nudge/shared";

/**
 * The Glyph lights on the back of a Nothing phone (Phone (4a): the six-zone Glyph Bar).
 * Everywhere else (other phones, the browser, the computer) every call here does nothing.
 * Nothing only lets the app that's on screen use them, so they show while Nudge is open.
 */
interface GlyphBridge {
  status(): Promise<{ supported: boolean; ready: boolean; device: string; model: string; zones: number; reason: string }>;
  light(o: { zones: number[] }): Promise<void>;
  breathe(o: { zones: number[]; period: number; cycles?: number; interval?: number }): Promise<void>;
  off(): Promise<void>;
}

let bridge: GlyphBridge | null | undefined;
function get(): GlyphBridge | null {
  if (bridge !== undefined) return bridge;
  const C = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; registerPlugin?: (n: string) => unknown } }).Capacitor;
  bridge = C?.isNativePlatform?.() && C.getPlatform?.() === "android" && C.registerPlugin ? (C.registerPlugin("NudgeGlyph") as GlyphBridge) : null;
  return bridge;
}

const PREF = "nudge-glyph";
export const glyphOn = () => {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
};
export function setGlyphOn(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event("nudge-glyph"));
}

export interface GlyphSupport {
  /** the lights can be used right now */
  supported: boolean;
  /** it's a Nothing phone (so the lights should be there, even if Nothing said no) */
  nothing: boolean;
  zones: number;
  model: string;
  /** why not, in plain words */
  reason: string;
}

/** worked out once per app start, then every screen that asks gets it straight away */
let known: GlyphSupport | null = null;

/** Whether this phone has Glyph lights Nudge can use (null while checking). */
export function useGlyphSupport(): GlyphSupport | null {
  const none: GlyphSupport = { supported: false, nothing: false, zones: 0, model: "", reason: "" };
  const [s, setS] = useState<GlyphSupport | null>(known ?? (get() ? null : none));
  useEffect(() => {
    const b = get();
    if (!b || known) return;
    let alive = true;
    // The Glyph service connects a moment after start: ask again for a few seconds. If it never
    // answers (a Nothing OS update that keeps the lights to itself), say so instead of pretending.
    const ask = (n: number) =>
      void b
        .status()
        .then((r) => {
          if (!alive) return;
          const nothing = !!(r as { nothing?: boolean }).nothing;
          if (r.supported && !r.ready && n > 0) return void window.setTimeout(() => ask(n - 1), 800);
          const ok = r.supported && r.ready;
          knownZones = r.zones;
          known = { supported: ok, nothing, zones: r.zones, model: r.model, reason: ok ? "" : r.supported ? "the Glyph service didn't answer" : r.reason };
          setS(known);
        })
        .catch(() => alive && setS(none));
    ask(8);
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

let current = "";
/** zones on this phone, once known (6 on the Phone (4a)) */
let knownZones = 0;
let hold: number | null = null;
function send(c: GlyphCmd) {
  const b = get();
  if (!b) return;
  const key = glyphKey(c);
  if (key === current) return;
  current = key;
  const p = c.kind === "off" ? b.off() : c.kind === "light" ? b.light({ zones: c.zones }) : b.breathe({ zones: c.zones, period: c.period, cycles: 1000 });
  void p.catch(() => {});
}

/**
 * Keep the Glyph lights in step with the wall: a focus session's time left as a bar, a break
 * breathing, a held yes waiting. Checks again every 15 s while a session runs (that's how fast
 * a zone can change on a 25-minute task).
 */
export function useGlyphs(snap: Snapshot | null, zones: number) {
  const [tick, setTick] = useState(0);
  const [enabled, setEnabled] = useState(glyphOn);
  // The setting changing, or a flash finishing: work it out again.
  useEffect(() => {
    const on = () => {
      setEnabled(glyphOn());
      setTick((t) => t + 1);
    };
    window.addEventListener("nudge-glyph", on);
    return () => window.removeEventListener("nudge-glyph", on);
  }, []);
  const running = snap?.session?.state === "running";
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(iv);
  }, [running]);
  const lastBank = useRef<number | null>(null);
  useEffect(() => {
    if (!get()) return;
    if (!enabled || !snap) {
      send({ kind: "off" });
      return;
    }
    // Points just went up: a quick sweep down the bar first.
    const bank = snap.bank;
    const won = lastBank.current !== null && bank > lastBank.current;
    lastBank.current = bank;
    const plan = glyphPlan({ session: snap.session, asks: snap.asks, now: Date.now(), zones });
    if (won) glyphSweep(zones, () => send(plan));
    else if (hold === null) send(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, zones, enabled, tick]);
  useEffect(() => () => send({ kind: "off" }), []);
}

/** A short run down the bar (points won), then back to whatever it was showing. */
export function glyphSweep(zones = knownZones, then?: () => void) {
  if (!get() || !glyphOn()) return then?.();
  const n = Math.max(1, zones);
  if (hold !== null) window.clearTimeout(hold);
  let i = 0;
  const step = () => {
    if (i < n) {
      current = "";
      send({ kind: "light", zones: [i++] });
      hold = window.setTimeout(step, 70);
    } else {
      hold = null;
      current = "";
      then?.();
    }
  };
  step();
}

/** All zones on for a moment (a held yes went through). */
export function glyphFlash(zones = knownZones) {
  if (!get() || !glyphOn()) return;
  if (hold !== null) window.clearTimeout(hold);
  current = "";
  send({ kind: "light", zones: Array.from({ length: Math.max(1, zones) }, (_, i) => i) });
  hold = window.setTimeout(() => {
    hold = null;
    current = "";
    window.dispatchEvent(new Event("nudge-glyph")); // back to what it was showing
  }, 420);
}

/** The notes app while it records: the bottom zone stays lit. */
export function glyphRecording(on: boolean, zones = knownZones) {
  if (!get() || !glyphOn()) return;
  send(on ? { kind: "light", zones: [Math.max(0, zones - 1)] } : { kind: "off" });
}
