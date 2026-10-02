import { hhmmToMinutes } from "@nudge/shared";
import type { Hub } from "../hub";
import type { Kws } from "./kws";

/**
 * Decides when the wake word listens, and runs the spotter on what the mic daemon sends.
 *
 * Listening only when it's useful: the wake word is switched on, the assistant is on, there's a
 * voice path (Gemini Live or speech-to-text on the Pi), and it isn't night (bedtime → 06:00). The
 * rest of the time the daemon closes the mic entirely. The hardware mic switch overrides all this
 * on the daemon's side.
 */
export interface WakeService {
  /** gated audio from the daemon (base64 16 kHz PCM) */
  audio(b64: string): void;
  /** the daemon's gate closed: forget any half-heard word */
  gap(): void;
  /** should the mic listen for "nudge" right now? */
  active(): boolean;
  /** tell the daemon (and the wall) whether it should listen */
  sync(): void;
}

export function wakeService(o: { hub: Hub; kws: Kws | null; voiceReady: () => boolean; log: (m: string) => void; now?: () => Date }): WakeService {
  const { hub } = o;
  let last: boolean | null = null;
  let lastHit = 0;
  const active = () => {
    const s = hub.settings();
    if (!o.kws || !s.wakeWord || !s.ai || !o.voiceReady()) return false;
    const d = (o.now ?? (() => new Date()))();
    const mins = d.getHours() * 60 + d.getMinutes();
    const bed = hhmmToMinutes(s.bedtime);
    const night = bed > 6 * 60 ? mins >= bed || mins < 6 * 60 : mins >= bed && mins < 6 * 60;
    return !night;
  };
  const sync = () => {
    const on = active();
    if (on !== last) o.log(`wake word ${on ? "listening" : "off"}`);
    last = on;
    hub.bus.broadcast({ type: "wake-config", on }, ["local"]);
  };
  // Settings changes take effect at once; bedtime and morning within a minute.
  hub.bus.subscribe({ roles: new Set(["wake"]), send: (m) => void (m.type === "changed" && m.topics.includes("settings") && sync()) });
  setInterval(sync, 60_000).unref();
  return {
    audio(b64) {
      if (!o.kws || !last) return;
      const buf = Buffer.from(b64, "base64");
      if (buf.length < 2 || buf.length > 64_000) return;
      const hit = o.kws.feed(new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1));
      if (hit && Date.now() - lastHit > 3000) {
        lastHit = Date.now();
        o.kws.reset();
        hub.bus.broadcast({ type: "wake", word: hit }, ["local"]);
      }
    },
    gap() {
      o.kws?.reset();
    },
    active,
    sync,
  };
}
