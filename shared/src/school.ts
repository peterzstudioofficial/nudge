import type { FormTime, HomeworkPlan, Period, SchoolDay, Teacher, TermDate, Timetable } from "./model";
import { addDays, isoWeekday, parseDateKey } from "./time";
import { guessSubject } from "./subjects";

/* ------------------------------------------------------------------ */
/*  Two-week timetables, bell times, homework and staff.               */
/* ------------------------------------------------------------------ */

export type WeekLetter = "A" | "B";

/** Churcher's senior school day. Reg 08:30, 8 × 40-minute periods, out at 16:00. */
export const CHURCHERS_DAY: SchoolDay = {
  reg: { start: "08:30", end: "09:00" },
  slots: [
    { start: "09:00", end: "09:40" },
    { start: "09:40", end: "10:20" },
    { start: "10:40", end: "11:20" },
    { start: "11:20", end: "12:00" },
    { start: "13:10", end: "13:50" },
    { start: "13:50", end: "14:30" },
    { start: "14:40", end: "15:20" },
    { start: "15:20", end: "16:00" },
  ],
  breaks: [
    { label: "break", start: "10:20", end: "10:40" },
    { label: "lunch", start: "12:00", end: "13:10" },
    { label: "break", start: "14:30", end: "14:40" },
  ],
};

export const DEFAULT_FORM_TIME: FormTime = {
  "1": "House assembly",
  "2": "PSHE",
  "3": "Study session",
  "4": "Full school assembly",
  "5": "Form time",
};

export const DEFAULT_HOMEWORK: HomeworkPlan = { days: {}, weeklyMinsPerSubject: 60, on: true };

function mondayOf(key: string): string {
  return addDays(key, 1 - isoWeekday(parseDateKey(key)));
}

function isTermSchoolDay(key: string, t: TermDate): boolean {
  if (key < t.start || key > t.end) return false;
  if (isoWeekday(parseDateKey(key)) > 5) return false;
  return !t.breaks.some((b) => key >= b.start && key <= b.end);
}

/** Mondays of the weeks in a term that have at least one school day. */
export function teachingWeeks(t: TermDate): string[] {
  const out: string[] = [];
  for (let mon = mondayOf(t.start); mon <= t.end; mon = addDays(mon, 7)) {
    for (let i = 0; i < 5; i++) {
      if (isTermSchoolDay(addDays(mon, i), t)) {
        out.push(mon);
        break;
      }
    }
  }
  return out;
}

/**
 * Week A or B for a date. Weeks alternate through each term, skipping weeks with no school
 * (half term), starting from the term's `abStart` letter. Null outside term time.
 */
export function weekLetter(key: string, terms: TermDate[]): WeekLetter | null {
  const t = terms.find((x) => key >= mondayOf(x.start) && key <= x.end);
  if (!t) return null;
  const idx = teachingWeeks(t).indexOf(mondayOf(key));
  if (idx < 0) return null;
  const first = t.abStart ?? "A";
  return idx % 2 === 0 ? first : first === "A" ? "B" : "A";
}

/** The lessons on a day. Week-specific keys ("A3") win over plain weekday keys ("3"). */
export function periodsFor(tt: Timetable, letter: WeekLetter | null, weekday: number): Period[] {
  return (letter && tt[`${letter}${weekday}`]) || tt[String(weekday)] || [];
}

export function hasTwoWeeks(tt: Timetable): boolean {
  return Object.keys(tt).some((k) => /^[AB]/.test(k));
}

export interface Lesson extends Period {
  start: string;
  end: string;
}

/** Lay lessons onto the bell times: each lesson takes `span` slots in order. */
export function lessonTimes(periods: Period[], day: SchoolDay): Lesson[] {
  const out: Lesson[] = [];
  let i = 0;
  for (const p of periods) {
    const first = day.slots[Math.min(i, day.slots.length - 1)];
    const last = day.slots[Math.min(i + p.span - 1, day.slots.length - 1)];
    out.push({ ...p, start: first.start, end: last.end });
    i += p.span;
  }
  return out;
}

/** Everything the planner needs to know about school days. */
export interface SchoolCtx {
  terms: TermDate[];
  timetable: Timetable;
  /** true if school is on that day (term time, weekday, not marked away / holiday) */
  isSchoolDay: (key: string) => boolean;
}

export function lessonsOn(key: string, ctx: SchoolCtx): Period[] {
  if (!ctx.isSchoolDay(key)) return [];
  return periodsFor(ctx.timetable, weekLetter(key, ctx.terms), isoWeekday(parseDateKey(key)));
}

/** The next school day after `from` with a lesson in `subject` (looks up to 5 weeks ahead). */
export function nextLesson(subject: string, from: string, ctx: SchoolCtx): string | null {
  for (let i = 1; i <= 35; i++) {
    const d = addDays(from, i);
    if (lessonsOn(d, ctx).some((p) => p.subject === subject)) return d;
  }
  return null;
}

/** Subjects that set homework on a date, from the homework plan. */
export function homeworkSetOn(key: string, plan: HomeworkPlan, terms: TermDate[]): string[] {
  const wd = isoWeekday(parseDateKey(key));
  const letter = weekLetter(key, terms);
  return (letter && plan.days[`${letter}${wd}`]) || plan.days[String(wd)] || [];
}

/**
 * Minutes for one piece of homework: the weekly allowance per subject shared between the times
 * that subject sets it that week (e.g. 60 min, set twice → 30 min each). Rounded to 5.
 */
export function homeworkMins(subject: string, letter: WeekLetter | null, plan: HomeworkPlan): number {
  let times = 0;
  for (let wd = 1; wd <= 7; wd++) {
    const list = (letter && plan.days[`${letter}${wd}`]) || plan.days[String(wd)] || [];
    times += list.filter((s) => s === subject).length;
  }
  const mins = plan.weeklyMinsPerSubject / Math.max(1, times);
  return Math.max(10, Math.round(mins / 5) * 5);
}

/* ------------------------------ staff ------------------------------ */

function initials(name: string): string[] {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase());
}

/**
 * Match a timetable code (e.g. "NEC", "JML") to a staff member. The code's first letter is the
 * first name's initial or its middle letter is (a middle name the list doesn't have), and the
 * last letter is the surname's initial. Subject is used to break ties. Null if unsure.
 */
export function matchTeacher(code: string, subject: string | null, staff: Teacher[]): Teacher | null {
  const c = code.toUpperCase();
  if (c.length < 2) return null;
  const exact = staff.find((t) => t.code?.toUpperCase() === c);
  if (exact) return exact;
  // Score everyone who fits the letters; the subject and a first-letter match break ties.
  const scored: { t: Teacher; score: number }[] = [];
  for (const t of staff) {
    const ini = initials(t.name);
    if (ini.length < 2) continue;
    const surnameOk = c[c.length - 1] === ini[ini.length - 1] || (ini.length > 2 && c[c.length - 1] === ini[ini.length - 2]);
    const first = c[0] === ini[0] ? 2 : c.length > 2 && c[1] === ini[0] ? 1 : 0;
    if (!surnameOk || !first) continue;
    let score = first;
    if (subject) {
      if (roleNames(t.role, subject)) score += 4;
      else if (guessSubject(t.role) === subject || roleMentions(t.role, subject)) score += 2;
    }
    scored.push({ t, score });
  }
  const byName = new Map<string, { t: Teacher; score: number }>();
  for (const x of scored) if ((byName.get(x.t.name)?.score ?? -1) < x.score) byName.set(x.t.name, x);
  const ranked = [...byName.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[1].score === ranked[0].score) return null;
  // Letters alone aren't enough: when we know the subject, the job title has to fit it.
  if (subject && ranked[0].score < 3) return null;
  return ranked[0].t;
}

/** The job title names the subject outright ("Teacher of Mathematics", "…/Games"). */
function roleNames(role: string, subject: string): boolean {
  const words: Record<string, RegExp> = {
    eng: /\benglish\b/i, drama: /\bdrama\b/i, art: /\bart\b/i, physics: /\bphysics\b/i, chem: /\bchemistry\b/i,
    bio: /\bbiology\b/i, maths: /\bmath(s|ematics)\b/i, biz: /\bbusiness\b/i, re: /religion|philosophy|\br&p\b/i,
    pe: /\bpe\b/i, games: /\bgames\b/i,
  };
  return words[subject]?.test(role) ?? false;
}

function roleMentions(role: string, subject: string): boolean {
  const words: Record<string, RegExp> = {
    eng: /english/i, drama: /drama/i, art: /\bart\b/i, physics: /physics|science/i, chem: /chemistry|science/i,
    bio: /biology|science/i, maths: /math/i, biz: /business/i, re: /religion|philosophy|r&p/i, pe: /\bpe\b|sport/i,
    games: /games|\bpe\b|sport|rugby|hockey/i,
  };
  return words[subject]?.test(role) ?? false;
}

/**
 * Parse a pasted staff list: "Name" on one line, "Job title" on the next (blank lines ignored).
 * Duplicates (people listed under two departments) are merged.
 */
export function parseStaffList(text: string): Teacher[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = new Map<string, Teacher>();
  const looksLikeName = (l: string) => /^[A-Z][a-zA-Z'’.-]+( [A-Z][a-zA-Z'’.-]+){1,3}$/.test(l) && !/^(Head|Teacher|Deputy|Assistant|Director|Senior|Science|Art|Business|Contingent|Music|PE|Design)\b/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    const role = lines[i + 1];
    if (!looksLikeName(name) || !role || looksLikeName(role)) continue;
    const prev = out.get(name);
    out.set(name, { name, role: prev && !prev.role.includes(role) ? `${prev.role}; ${role}`.slice(0, 160) : role.slice(0, 160) });
    i++;
  }
  return [...out.values()];
}

/** Which subject an email is about, from the sender being one of the student's teachers. */
export function subjectFromSender(from: string, tt: Timetable, staff: Teacher[]): string | null {
  const f = from.toLowerCase();
  if (!f) return null;
  for (const periods of Object.values(tt)) {
    for (const p of periods) {
      if (!p.teacher) continue;
      const t = matchTeacher(p.teacher, p.subject, staff);
      if (!t) continue;
      const surname = t.name.split(/\s+/).pop()!.toLowerCase();
      if (f.includes(t.name.toLowerCase()) || (surname.length > 3 && f.includes(surname))) return p.subject;
    }
  }
  return null;
}

/* ------------------------------ calendar ------------------------------ */

const OTHER_YEARS = /\b(1st|2nd|3rd|4th)(?:,? ?(?:&|and|[-–]) ?(?:1st|2nd|3rd|4th))* ?Years?\b|\bL6(th)?\b|\bU6(th)?\b|\b6th Form\b|\bSixth Form\b|Lower School|\bKS3\b|\bA Level\b|\bUCAS\b|Oxbridge|Conservatoire|\bprospective\b|\bOld Churcherians\b|Junior|Scholars/i;
const STAFF = /\b(staff|governors|tutors|teachers|heads of|committee)\b|\bPA\b|Meeting for|Review Group|Planning Meeting/i;
const HOUSES = /\b(Grenville|Rodney|Collingwood|Nelson|Drake)\b/i;

/**
 * Is a school-calendar line worth showing to this student? Keeps term dates, whole-school days,
 * their year group, their house, their exams, and creative things (drama, art, film, photography)
 * open to them; drops other years, staff meetings and sports fixtures.
 */
export function calendarTags(title: string, who: { yearGroup: string; house: string; interests?: string[] }): string[] | null {
  const t = title.replace(/\s+/g, " ").trim();
  if (STAFF.test(t)) return null;
  // Things the student is part of (e.g. "senior production"): every word of the interest appears
  // in the title, so rehearsals count too, but "Lower School Production" doesn't match.
  const words = t.toLowerCase().split(/[^a-z0-9]+/);
  const hit = (who.interests ?? []).find((i) => {
    const w = i.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return w.length > 0 && w.every((x) => words.includes(x));
  });
  if (hit) return ["mine", "creative"];
  // Fixtures belong to the sports apps, not the wall.
  if (/\bv\b .*\((A|H)\b|\bU1[2-8][A-D]\b|\b1st XV\b|Development League/i.test(t)) return null;
  const body = t.replace(/\([^)]*\)/g, ""); // venues like "(Lecture Theatre)" aren't the event
  const year = who.yearGroup.trim();
  const n = year.match(/(\d)/)?.[1];
  const mine = n ? new RegExp(`\\b${n}(st|nd|rd|th)? ?(year|yr)|\\b1st ?[-–] ?${n}th Year|\\b${n}th Years?\\b`, "i").test(t) : false;
  const others = OTHER_YEARS.test(t);
  if (!mine && /\b(1st|2nd|3rd|4th)\b[^.]*\bYears?\b/i.test(t) && !/1st\s*[-–]\s*\dth/i.test(t)) return null;
  const house = t.match(HOUSES)?.[1];
  if (house && who.house && house.toLowerCase() !== who.house.toLowerCase()) return null;
  const tags: string[] = [];
  if (/TERM (COMMENCES|RECOMMENCES|ENDS|BEGINS)|HALF TERM COMMENCES|^HALF TERM$|BANK HOLIDAY/i.test(t) && !others) tags.push("term");
  if (mine) tags.push("year");
  if (house && who.house) tags.push("house");
  if (/\b(mock|exams?|assessment)\b/i.test(body) && (mine || /GCSE/i.test(t)) && !/Associated Board/i.test(t)) tags.push("exam");
  if (/PARENTS|REPORT/i.test(t) && mine) tags.push("parents");
  if (/\b(drama|art|film|photograph\w*|production|design|theatre)\b/i.test(body) && !/rehearsal/i.test(body) && (mine || /GCSE/i.test(t) || !others)) tags.push("creative");
  if (/whole school|all pupils|speech day|pupil photographs|carol service|flu vaccination|non-uniform/i.test(t) && !/rehearsal/i.test(t) && (mine || !others)) tags.push("school");
  if (!tags.length) return null;
  if (others && !mine && !/GCSE/i.test(t)) return null;
  return [...new Set(tags)];
}

export interface CalLine {
  date: string;
  time: string | null;
  title: string;
}

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/**
 * Parse the text of a Churcher's term calendar (one row of text per line, cells joined by " | ",
 * pages separated by form feeds or "=== PAGE" lines). Returns dated lines from the weekly pages
 * and the "future events" page, plus the A/B letter of each week.
 */
export function parseSchoolCalendar(text: string): { lines: CalLine[]; weeks: { monday: string; letter: WeekLetter }[] } {
  const lines: CalLine[] = [];
  const weeks: { monday: string; letter: WeekLetter }[] = [];
  let weekStart: string | null = null;
  let cur: string | null = null;
  let last: CalLine | null = null;
  let future: { year: number; month: number | null } | null = null;
  let year = new Date().getFullYear();
  const yearHit = text.match(/\b(AUTUMN|SPRING|SUMMER) TERM\s*\|?\s*(20\d\d)/i);
  if (yearHit) year = Number(yearHit[2]);
  let lastMonth = 0;
  const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  /** first date on/after the week's Monday (allowing a day before) with this day of the month */
  const dayInWeek = (d: number): string | null => {
    if (!weekStart) return null;
    for (let i = -1; i < 40; i++) {
      const k = addDays(weekStart, i);
      if (Number(k.slice(8)) === d) return k;
    }
    return null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (/^\f|^=== PAGE/.test(raw)) {
      weekStart = null;
      cur = null;
      last = null;
      future = null;
      continue;
    }
    const row = raw.replace(/^\s*\|\s*/, "").replace(/\s+/g, " ").trim();
    if (!row) continue;
    if (/^FUTURE EVENTS$/i.test(row)) {
      future = { year, month: null };
      continue;
    }
    if (future) {
      const mon = MONTH_NAMES.indexOf(row.toUpperCase());
      if (mon >= 0) {
        future.month = mon + 1;
        future.year = mon + 1 < lastMonth ? year + 1 : year;
        continue;
      }
      const ev = row.match(/^(?:[A-Za-z]+(?: - [A-Za-z]+)?) \| (\d{1,2})(?: [–-] \d{1,2})? \| (.+)$/);
      if (ev && future.month) lines.push({ date: key(future.year, future.month, Number(ev[1])), time: null, title: ev[2].replace(/\s*\|\s*/g, " ").slice(0, 160) });
      continue;
    }
    const wk = row.match(/WEEK \d+ \((A|B)\) \| (\d{2}) ([A-Z]{3}) - (\d{2}) ([A-Z]{3})/);
    if (wk) {
      const m = MONTHS[wk[3]];
      if (lastMonth && m < lastMonth) year++;
      lastMonth = m;
      weekStart = key(year, m, Number(wk[2]));
      if (!weeks.some((w) => w.monday === weekStart)) weeks.push({ monday: weekStart, letter: wk[1] as WeekLetter });
      cur = null;
      last = null;
      continue;
    }
    if (!weekStart) continue;
    const day = row.match(/^(Mon|Tues|Wed|Thurs|Fri|Sat|Sun) (\d{1,2})(?: \(Continued\))?\s*\|?\s*(.*)$/);
    if (day) {
      cur = dayInWeek(Number(day[2]));
      last = null;
      const rest = day[3].trim();
      if (cur && rest) {
        last = { date: cur, time: null, title: rest.replace(/\s*\|\s*/g, " ") };
        lines.push(last);
      }
      continue;
    }
    if (!cur) continue;
    if (/^\d{1,3}$/.test(row)) continue; // page number
    const timed = row.match(/^(\d{2}:\d{2})\s*\|\s*(.+)$/);
    if (timed) {
      last = { date: cur, time: timed[1], title: timed[2].replace(/\s*\|\s*/g, " ").trim() };
      lines.push(last);
      continue;
    }
    // Untimed row: a new all-day item, or the wrapped tail of the one before.
    const txt = row.replace(/\s*\|\s*/g, " ").trim();
    const cont =
      !!last && (/^[a-z(]/.test(txt) || (!/\)$/.test(last.title) && last.title.length >= 45 && !/^[A-Z0-9’'&:,. -]{6,}$/.test(txt)));
    if (last && cont) {
      last.title = `${last.title} ${txt}`.slice(0, 160);
    } else {
      last = { date: cur, time: null, title: txt.slice(0, 160) };
      lines.push(last);
    }
  }
  // "HALF TERM" printed on every day: keep the first of each run.
  return {
    lines: lines.filter((l, i) => !(l.title === "HALF TERM" && lines.slice(0, i).some((x) => x.title === "HALF TERM" && addDays(x.date, 10) >= l.date))),
    weeks,
  };
}

export function formTimeOn(key: string, ft: FormTime): string {
  return ft[String(isoWeekday(parseDateKey(key)))] ?? "";
}
