import { addDays, dueLabel, parseDateKey, SUBJECT_NAMES, termInfo } from "@nudge/shared";
import type { Hub } from "../hub";

/**
 * Questions the wall already knows the answer to, answered on the Pi for free (no model, no
 * tokens, instant). Only short, plain questions match; anything more goes to the assistant.
 */
const clean = (s: string) =>
  s.toLowerCase().replace(/^(hey |ok |okay )?nudge[,!]?\s*/, "").replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();

const hm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const subj = (s: string) => (SUBJECT_NAMES[s] ?? s).toLowerCase();
const weekday = (d: string) => parseDateKey(d).toLocaleDateString("en-GB", { weekday: "long" }).toLowerCase();

export function quickAnswer(hub: Hub, prompt: string): string | null {
  const q = clean(prompt);
  if (q.length > 48 || /\b(and|email|plan|write|build|remind|why|explain|help me)\b/.test(q)) return null;
  const today = hub.todayKey();
  const now = new Date(hub.now());
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (/^(what'?s the time|what time is it|time)$/.test(q)) return `it's ${hm(now)}.`;

  if (/^(what'?s|what is) (the )?date( today)?$|^what day is it( today)?$/.test(q)) {
    return `${weekday(today)} ${parseDateKey(today).getDate()} ${parseDateKey(today).toLocaleDateString("en-GB", { month: "long" }).toLowerCase()}.`;
  }

  if (/^(is it |what )?week (a or b|is it)$|^which week( is it)?$|^is it week [ab]$/.test(q)) {
    const w = hub.dayState(today).week;
    return w ? `week ${w.toLowerCase()}.` : "no a/b week today — no school.";
  }

  if (/^(what'?s|what is|what have i got) next$|^next lesson$|^what'?s my next lesson$/.test(q)) {
    const next = hub.lessonsOn(today).find((l) => mins(l.start) > nowMin);
    if (next) return `${subj(next.subject)} at ${next.start}${next.room ? `, ${next.room}` : ""}.`;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      const first = hub.lessonsOn(d)[0];
      if (first) return `nothing more today. next: ${subj(first.subject)}, ${weekday(d)} at ${first.start}.`;
    }
    return "no lessons coming up this week.";
  }

  if (/^what (have i got|do i have|'?s on)( today)?$|^(today'?s )?(lessons|timetable)( today)?$/.test(q)) {
    const ls = hub.lessonsOn(today).filter((l) => mins(l.end) > nowMin);
    if (!ls.length) {
      const open = hub.listTasks(today).filter((t) => !t.done);
      return open.length ? `no lessons left. ${open.length} task${open.length === 1 ? "" : "s"} to go.` : "nothing left today. enjoy it.";
    }
    return ls.slice(0, 4).map((l) => `${l.start} ${subj(l.subject)}`).join(", ") + (ls.length > 4 ? ` +${ls.length - 4}` : "") + ".";
  }

  if (/^(what'?s|what is) (due|left)( today| tonight)?$|^(what )?homework( is)? (due|left)$|^what do i (need|have) to do( today| tonight)?$/.test(q)) {
    const open = hub.listTasks(today).filter((t) => !t.done);
    if (!open.length) return "all done. genuinely nothing left.";
    const first = open[0];
    const due = first.due ? ` (due ${dueLabel(first.due, today)})` : "";
    return `${open.length} left. first: ${first.name.toLowerCase()}${due}.`;
  }

  if (/^when('?s| is) (the )?(next )?half ?term$|^when does (the )?term (end|finish)$|^when are the holidays$|^how long (until|till) (the )?(holidays|half ?term)$/.test(q)) {
    const terms = hub.terms();
    const cur = termInfo(today, terms);
    const brk = cur.term?.breaks.find((b) => b.end >= today);
    const wantsBreak = /half ?term/.test(q) && brk;
    const target = wantsBreak ? brk!.start : cur.term?.end;
    if (!target) return null;
    const days = Math.round((parseDateKey(target).getTime() - parseDateKey(today).getTime()) / 86400_000);
    const what = wantsBreak ? "half term starts" : "term ends";
    const tail = cur.confirmed ? "" : " (not confirmed yet)";
    return days <= 0 ? `${what} today${tail}.` : `${what} ${weekday(target)} ${parseDateKey(target).getDate()} ${parseDateKey(target).toLocaleDateString("en-GB", { month: "short" }).toLowerCase()} — ${days} day${days === 1 ? "" : "s"}${tail}.`;
  }

  return null;
}
