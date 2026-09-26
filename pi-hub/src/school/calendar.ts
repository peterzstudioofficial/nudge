import crypto from "node:crypto";
import { calendarTags, parseSchoolCalendar, teachingWeeks, type CalEvent, type TermDate } from "@nudge/shared";
import type { Hub } from "../hub";

/**
 * School calendar PDFs → the dates that matter to this student.
 * The PDF is read locally with pdf.js (no scripts run: eval is off), turned into text rows,
 * then parsed and filtered by year group / house.
 */
export async function pdfToRows(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const rows = new Map<number, [number, string][]>();
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const y = Math.round(it.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y)!.push([it.transform[4], it.str]);
      }
      pages.push(
        [...rows.keys()]
          .sort((a, b) => b - a)
          .map((y) => " | " + rows.get(y)!.sort((a, b) => a[0] - b[0]).map(([, s]) => s.trim()).join(" | "))
          .join("\n"),
      );
    }
  } finally {
    await doc.destroy();
  }
  return pages.join("\n\f\n");
}

/** Replace the calendar's events in the dates it covers, and learn which weeks are A / B. */
export function importCalendarText(hub: Hub, text: string): { events: number; weeks: number; from: string | null; to: string | null } {
  const s = hub.settings();
  const { lines, weeks } = parseSchoolCalendar(text);
  const keep: CalEvent[] = [];
  for (const l of lines) {
    const tags = calendarTags(l.title, { yearGroup: s.yearGroup, house: s.house });
    if (!tags) continue;
    const id = "cal:" + crypto.createHash("sha1").update(`${l.date}|${l.time}|${l.title}`).digest("hex").slice(0, 16);
    keep.push({ id, date: l.date, time: l.time, title: l.title.slice(0, 160), tags, source: "calendar" });
  }
  const dates = [...lines.map((l) => l.date), ...weeks.map((w) => w.monday)].sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  if (from && to) {
    for (const e of hub.events.betweenDays(from, to)) if (e.source === "calendar") hub.events.del(e.id);
  }
  for (const e of keep) hub.events.put(e);

  // Week letters: set each term's starting letter from the first labelled week inside it.
  if (weeks.length) {
    const terms = hub.terms().map((t): TermDate => {
      const tw = teachingWeeks(t);
      for (const w of weeks) {
        const idx = tw.indexOf(w.monday);
        if (idx < 0) continue;
        const other = w.letter === "A" ? "B" : "A";
        return { ...t, abStart: idx % 2 === 0 ? w.letter : other };
      }
      return t;
    });
    hub.setTerms(terms);
  }
  hub.bus.changed("day", "events");
  return { events: keep.length, weeks: weeks.length, from, to };
}
