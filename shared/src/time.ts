/** Date helpers. All "date keys" are local calendar days (the Pi runs on Europe/London). */

export function dateKey(d: Date | number = new Date()): string {
  const x = typeof d === "number" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** 1 = Monday … 7 = Sunday */
export function isoWeekday(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

export function minutesOfDay(d: Date | number = new Date()): number {
  const x = typeof d === "number" ? new Date(d) : d;
  return x.getHours() * 60 + x.getMinutes();
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

export function mmss(sec: number): string {
  const a = Math.abs(Math.round(sec));
  return String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
}

export const DAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const MONTH_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const MONTH_LONG = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "yesterday", "tuesday", "12 sep" style labels for lists. */
export function relativeDay(key: string, today: string): string {
  if (key === today) return "today";
  if (key === addDays(today, -1)) return "yesterday";
  if (key === addDays(today, 1)) return "tomorrow";
  const d = parseDateKey(key);
  const diff = (parseDateKey(today).getTime() - d.getTime()) / 86_400_000;
  if (diff > 0 && diff < 7) return DAY_LONG[d.getDay()];
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()].toLowerCase()}`;
}
