import type { Memory } from "@nudge/shared";
import { type Hub, newId } from "../hub";

/**
 * The assistant's memory of its owner: short facts it was told ("I revise best before school") or picked
 * up ("likes revision in 25-minute blocks"). It lives on the Pi only, the owner can read, add and
 * delete every line from the app, and nothing sensitive is ever kept.
 *
 * It costs almost nothing: the dozen most useful lines ride along with each question (a few
 * dozen tokens), and the rest are found by the private search when they're relevant.
 */
const KEY = "brain";
const MAX = 150;

/** Never remembered: secrets, money, health, other people's contact details. */
const NEVER = /\b(password|passcode|passwd|pin|login|otp|2fa|code is|sort code|account number|card|cvv|iban|bank|api key|token|secret|sk-[\w-]{6,}|diagnos|medication|therapy|self[- ]harm|suicid|address is|lives at|phone number|\+?\d[\d\s-]{8,})\b|@[\w-]+\.\w/i;

const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
};

export function memories(hub: Hub): Memory[] {
  return hub.db.kvGet<Memory[]>(KEY, []);
}

function write(hub: Hub, list: Memory[]) {
  hub.db.kvSet(KEY, list.slice(-MAX));
  hub.bus.changed("brain");
}

export type RememberResult = { ok: true; memory: Memory; updated: boolean } | { ok: false; why: string };

export function remember(hub: Hub, text: string, source: Memory["source"]): RememberResult {
  const t = text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (t.length < 4) return { ok: false, why: "too short" };
  if (t.length > 200) return { ok: false, why: "keep it to one short line" };
  if (NEVER.test(t)) return { ok: false, why: "not kept: looks private (passwords, money, health, addresses or numbers are never remembered)" };
  const list = memories(hub);
  const w = words(t);
  const now = hub.now();
  // Same fact again (or a newer version of it): replace, don't pile up.
  const same = list.find((m) => overlap(words(m.text), w) >= 0.7);
  if (same) {
    const memory = { ...same, text: t, source: source === "told" ? "told" : same.source, usedAt: now };
    write(hub, [...list.filter((m) => m.id !== same.id), memory]);
    return { ok: true, memory, updated: true };
  }
  const memory: Memory = { id: newId(), text: t, source, createdAt: now, usedAt: now };
  // Full: the least recently useful "noticed" line goes first; things they told us stay longest.
  let next = [...list, memory];
  if (next.length > MAX) {
    const drop = [...next].sort((a, b) => (a.source === b.source ? a.usedAt - b.usedAt : a.source === "noticed" ? -1 : 1))[0];
    next = next.filter((m) => m.id !== drop.id);
  }
  write(hub, next);
  return { ok: true, memory, updated: false };
}

export function forget(hub: Hub, idOrWords: string): number {
  const list = memories(hub);
  if (list.some((m) => m.id === idOrWords)) {
    write(hub, list.filter((m) => m.id !== idOrWords));
    return 1;
  }
  const w = words(idOrWords);
  const keep = list.filter((m) => !(w.size && overlap(words(m.text), w) >= 0.6));
  if (keep.length !== list.length) write(hub, keep);
  return list.length - keep.length;
}

/**
 * The few lines that ride along with every question: the most relevant to it first (word overlap,
 * free), then the most recently useful, within a small character budget.
 */
export function brief(hub: Hub, question: string, budget = 520): string {
  const list = memories(hub);
  if (!list.length) return "";
  const q = words(question);
  const ranked = [...list].sort((a, b) => overlap(words(b.text), q) - overlap(words(a.text), q) || b.usedAt - a.usedAt);
  const out: string[] = [];
  let n = 0;
  for (const m of ranked) {
    if (n + m.text.length + 3 > budget) break;
    out.push(m.text);
    n += m.text.length + 3;
  }
  return out.join("; ");
}
