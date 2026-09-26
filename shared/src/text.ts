import { guessSubject } from "./subjects";
import { addDays, dateKey, DAY_LONG, isoWeekday, MONTH_LONG, parseDateKey } from "./time";

/* ------------------------------------------------------------------ */
/*  Reading school messages. Rule based, runs offline on the Pi.       */
/* ------------------------------------------------------------------ */

export type SchoolKind = "homework" | "bring" | "deadline" | "event" | "info";

export interface Classified {
  kind: SchoolKind;
  due: string | null;
  subject: string | null;
  bring: string[];
}

const BRING_RE = /\b(?:bring|remember(?: to bring)?|don'?t forget(?: to bring)?|need(?:s)? to have|pack)\s+(?:your|a|an|the|in)?\s*([a-z][a-z0-9 \-']{2,40}?)(?=[.,;:!\n]| (?:to|for|on|tomorrow|next|by)\b|$)/gi;

export function classifySchoolText(title: string, body: string, now: Date = new Date()): Classified {
  const text = `${title}\n${body}`;
  const lower = text.toLowerCase();
  const subject = guessSubject(text);
  const due = parseDue(text, now);
  const bring: string[] = [];
  let m: RegExpExecArray | null;
  BRING_RE.lastIndex = 0;
  while ((m = BRING_RE.exec(text)) && bring.length < 4) {
    const item = m[1].trim().replace(/\s+/g, " ");
    if (item.length > 2 && !/^(it|this|them|that)$/i.test(item)) bring.push(item.toLowerCase());
  }
  let kind: SchoolKind = "info";
  if (bring.length) kind = "bring";
  else if (/\b(homework|prep|worksheet|exercise|questions? \d|q\d)/i.test(lower)) kind = "homework";
  else if (/\b(deadline|due|hand in|submit|by (mon|tues|wednes|thurs|fri)day)\b/i.test(lower)) kind = "deadline";
  else if (/\b(trip|match|fixture|concert|assembly|parents'? evening|mock|exam|test on|rehearsal|club)\b/i.test(lower)) kind = "event";
  return { kind, due, subject, bring };
}

/** Find a due date in free text: "due Monday", "by Fri", "tomorrow", "12 September", "12/09". */
export function parseDue(text: string, now: Date = new Date()): string | null {
  const today = dateKey(now);
  const t = text.toLowerCase();
  const wd = /\b(?:due|by|on|for|until|before)\s+(?:this |next )?(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\b/.exec(t);
  if (wd) {
    const idx = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].findIndex((d) => wd[1].startsWith(d));
    if (idx >= 0) {
      const target = idx + 1;
      const cur = isoWeekday(now);
      let diff = (target - cur + 7) % 7;
      if (diff === 0) diff = 7;
      if (/next /.test(wd[0]) && diff < 7) diff += 7;
      return addDays(today, diff);
    }
  }
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/.exec(t);
  if (dm) return rollYear(Number(dm[1]), monthIndex(dm[2]), now);
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t);
  if (md) return rollYear(Number(md[2]), monthIndex(md[1]), now);
  const num = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (num) {
    const d = Number(num[1]);
    const m = Number(num[2]) - 1;
    if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
      if (num[3]) {
        const y = Number(num[3].length === 2 ? "20" + num[3] : num[3]);
        return keyOf(y, m, d);
      }
      return rollYear(d, m, now);
    }
  }
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight)\b/.test(t)) return today;
  return null;
}

function monthIndex(s: string): number {
  return MONTH_LONG.findIndex((m) => m.startsWith(s.slice(0, 3)));
}
function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** A date with no year means the next time it comes round (within the school year). */
function rollYear(d: number, m: number, now: Date): string | null {
  if (m < 0 || d < 1 || d > 31) return null;
  let y = now.getFullYear();
  const key = keyOf(y, m, d);
  if (parseDateKey(key).getTime() < now.getTime() - 60 * 86_400_000) y += 1;
  return keyOf(y, m, d);
}

export function dueLabel(key: string | null, today: string): string {
  if (!key) return "";
  if (key === today) return "today";
  if (key === addDays(today, 1)) return "tomorrow";
  const d = parseDateKey(key);
  const diff = Math.round((d.getTime() - parseDateKey(today).getTime()) / 86_400_000);
  if (diff > 0 && diff < 7) return DAY_LONG[d.getDay()];
  return `${d.getDate()} ${MONTH_LONG[d.getMonth()].slice(0, 3)}`;
}

/* ------------------------------------------------------------------ */
/*  Notes: tags and the "closest first" search from the Notes design.  */
/* ------------------------------------------------------------------ */

export const NOTE_CONTEXT: Record<string, string[]> = {
  music: ["song", "music", "riff", "chorus", "bass", "drums", "guitar", "verse", "words", "writing", "melody", "lyrics"],
  school: ["school", "chem", "physics", "english", "revision", "exam", "mock", "essay", "library", "pe", "kit", "homework", "book", "maths", "teacher"],
  home: ["home", "birthday", "mum", "dad", "gift", "shop", "rain", "room"],
};

/** Auto tags: words in the note that belong to a known context, plus a guessed subject. */
export function autoTags(label: string, body: string): string[] {
  const words = `${label} ${body}`.toLowerCase().match(/[a-z]+/g) || [];
  const tags = new Set<string>();
  for (const w of words) {
    for (const [ctx, list] of Object.entries(NOTE_CONTEXT)) {
      if (list.includes(w)) {
        tags.add(w);
        tags.add(ctx);
      }
    }
  }
  const s = guessSubject(`${label} ${body}`);
  if (s) tags.add(s);
  return [...tags].slice(0, 20);
}

export interface Searchable {
  label: string;
  body: string;
  tags: string[];
}

/** Direct hits first, then notes from the same context ("song" also finds "riff"). */
export function searchNotes<T extends Searchable>(items: T[], q: string): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const direct = (it: T) =>
    words.some((w) => it.label.toLowerCase().includes(w) || it.body.toLowerCase().includes(w) || it.tags.some((t) => t.includes(w)));
  const groups = Object.keys(NOTE_CONTEXT).filter((g) => NOTE_CONTEXT[g].some((t) => words.some((w) => t.includes(w) || w.includes(t))));
  const near = (it: T) => groups.some((g) => it.tags.some((t) => NOTE_CONTEXT[g].includes(t) || t === g));
  return items.filter(direct).concat(items.filter((it) => !direct(it) && near(it)));
}

/** Autoformat from the Notes design: first line becomes a heading, the rest bullets. */
export function formatNoteBody(body: string): { text: string; heading: boolean; bullet: boolean }[] {
  const raw = body.split("\n").filter((l) => l.trim());
  if (raw.length <= 1) return raw.map((text) => ({ text, heading: false, bullet: false }));
  return raw.map((text, k) => ({ text, heading: k === 0, bullet: k > 0 }));
}
