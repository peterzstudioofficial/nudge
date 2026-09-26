import type { DayKind, TermDate } from "./model";
import { isoWeekday, parseDateKey } from "./time";

/**
 * Churcher's College, Petersfield — senior school term dates, academic year 2026/27 (+ Autumn 2027).
 *
 * Source: the school's Autumn Term 2026 calendar (page 2, "Term Dates") and its published term-date
 * list, both checked 26 Sep 2026. Autumn starts Wed 9 Sep for everyone except L6 and 1st Year
 * (Tue 8 Sep). Half terms are the school's own ranges; Fri 23 Oct is a day off.
 * Timetable weeks: Autumn 2026 starts on Week A (calendar: "WEEK 1 (A) 07 SEP – 13 SEP") and
 * half-term weeks are skipped. Later terms are assumed to start on Week A too until their
 * calendar says otherwise (importing the calendar PDF fixes it automatically).
 */
export const CHURCHERS_2026_27: TermDate[] = [
  {
    term: "Autumn 2026",
    start: "2026-09-09",
    end: "2026-12-11",
    breaks: [{ label: "half term", start: "2026-10-23", end: "2026-11-01" }],
    confirmed: true,
    note: "L6 & 1st Year start Tue 8 Sep (induction); everyone else Wed 9 Sep.",
    abStart: "A",
  },
  {
    term: "Spring 2027",
    start: "2027-01-05",
    end: "2027-03-19",
    breaks: [{ label: "half term", start: "2027-02-13", end: "2027-02-21" }],
    confirmed: true,
    note: "",
  },
  {
    term: "Summer 2027",
    start: "2027-04-12",
    end: "2027-07-09",
    breaks: [{ label: "half term", start: "2027-05-29", end: "2027-06-06" }],
    confirmed: true,
    note: "",
  },
  {
    term: "Autumn 2027",
    start: "2027-09-08",
    end: "2027-12-17",
    breaks: [{ label: "half term", start: "2027-10-22", end: "2027-10-31" }],
    confirmed: true,
    note: "L6 & 1st Year start Tue 7 Sep; everyone else Wed 8 Sep.",
  },
];

export interface TermInfo {
  kind: DayKind;
  term: TermDate | null;
  label: string;
  confirmed: boolean;
}

/** What kind of day a date is, from term dates alone (no sick / away marks). */
export function termInfo(dateKey: string, terms: TermDate[]): TermInfo {
  const wd = isoWeekday(parseDateKey(dateKey));
  const weekend = wd >= 6;
  for (const t of terms) {
    if (dateKey < t.start || dateKey > t.end) continue;
    const brk = t.breaks.find((b) => dateKey >= b.start && dateKey <= b.end);
    if (brk) return { kind: "halfterm", term: t, label: brk.label, confirmed: t.confirmed };
    return { kind: weekend ? "weekend" : "school", term: t, label: t.term, confirmed: t.confirmed };
  }
  if (!terms.length) return { kind: weekend ? "weekend" : "school", term: null, label: weekend ? "weekend" : "school day", confirmed: false };
  const sorted = [...terms].sort((a, b) => a.start.localeCompare(b.start));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Between terms, or the summer straight after the last known term: holidays.
  const summerEnd = addDaysKey(last.end, 70);
  const summerBefore = addDaysKey(first.start, -60);
  if ((dateKey > first.start && dateKey < last.end) || (dateKey > last.end && dateKey <= summerEnd) || (dateKey < first.start && dateKey >= summerBefore)) {
    return { kind: "holiday", term: null, label: "holiday", confirmed: true };
  }
  // Beyond what we know: assume a normal week so the alarm never silently goes missing.
  return { kind: weekend ? "weekend" : "school", term: null, label: weekend ? "weekend" : "school day", confirmed: false };
}

function addDaysKey(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse term dates out of the school's public term-dates page text. Best effort, never throws. */
export function parseTermDatesText(text: string): TermDate[] {
  const out: TermDate[] = [];
  const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
    august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const clean = text.replace(/\s+/g, " ");
  const termRe = /(Autumn|Spring|Summer) Term (\d{4})([^]*?)(?=(?:Autumn|Spring|Summer) Term \d{4}|$)/gi;
  const dateRe = /(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,? (\d{1,2})(?:st|nd|rd|th)? (January|February|March|April|May|June|July|August|September|October|November|December)(?: (\d{4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = termRe.exec(clean))) {
    const [, season, yearStr, body] = m;
    const year = Number(yearStr);
    const dates: string[] = [];
    let d: RegExpExecArray | null;
    dateRe.lastIndex = 0;
    while ((d = dateRe.exec(body))) {
      const mon = MONTHS[d[2].toLowerCase()];
      let y = d[3] ? Number(d[3]) : year;
      if (!d[3] && season.toLowerCase() === "spring" && mon === 12) y = year - 1;
      dates.push(`${y}-${String(mon).padStart(2, "0")}-${String(Number(d[1])).padStart(2, "0")}`);
    }
    if (dates.length < 2) continue;
    const sorted = [...new Set(dates)].sort();
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    const breaks = [];
    const hi = body.search(/half term/i);
    if (hi >= 0) {
      const tail = body.slice(hi);
      const hd: string[] = [];
      dateRe.lastIndex = 0;
      while ((d = dateRe.exec(tail)) && hd.length < 2) {
        const mon = MONTHS[d[2].toLowerCase()];
        const y = d[3] ? Number(d[3]) : year;
        hd.push(`${y}-${String(mon).padStart(2, "0")}-${String(Number(d[1])).padStart(2, "0")}`);
      }
      if (hd.length === 2) breaks.push({ label: "half term", start: hd[0], end: hd[1] });
    }
    out.push({
      term: `${season[0].toUpperCase()}${season.slice(1).toLowerCase()} ${year}`,
      start,
      end,
      breaks,
      confirmed: true,
      note: "Read from the school website.",
    });
  }
  return out;
}
