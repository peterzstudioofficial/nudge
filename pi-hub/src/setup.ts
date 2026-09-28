import fs from "node:fs";
import { z } from "zod";
import { Activity, Birthday, CalEvent, FormTime, HomeworkPlan, SchoolDay, Settings, Teacher, TermDate, Timetable } from "@nudge/shared";
import { type Hub, newId } from "./hub";
import { remember } from "./agent/brain";

/** A setup file: everything personal that isn't in the code (timetable, staff, birthdays…). */
export const SetupPack = z.object({
  timetable: Timetable.optional(),
  schoolDay: SchoolDay.optional(),
  formTime: FormTime.optional(),
  homework: HomeworkPlan.optional(),
  birthdays: z.array(Birthday).max(500).optional(),
  teachers: z.array(Teacher).max(500).optional(),
  terms: z.array(TermDate).max(12).optional(),
  events: z.array(CalEvent.omit({ id: true, source: true })).max(1000).optional(),
  activities: z.array(Activity.omit({ id: true })).max(40).optional(),
  settings: Settings.pick({ ownerName: true, yearGroup: true, house: true, profile: true, interests: true }).partial().optional(),
  /** starting lines for the assistant's memory ("what Nudge knows about you") */
  memories: z.array(z.string().min(4).max(200)).max(60).optional(),
});
export type SetupPack = z.infer<typeof SetupPack>;

export function applySetup(hub: Hub, pack: SetupPack): string[] {
  const done: string[] = [];
  if (pack.settings) (hub.updateSettings("owner", pack.settings), done.push("profile"));
  if (pack.terms) (hub.setTerms(pack.terms), done.push(`${pack.terms.length} terms`));
  if (pack.timetable) (hub.setTimetable(pack.timetable), done.push("timetable"));
  if (pack.schoolDay) (hub.setSchoolDay(pack.schoolDay), done.push("bell times"));
  if (pack.formTime) (hub.setFormTime(pack.formTime), done.push("form time"));
  if (pack.homework) (hub.setHomeworkPlan(pack.homework), done.push("homework plan"));
  if (pack.birthdays) (hub.setBirthdays(pack.birthdays), done.push(`${pack.birthdays.length} birthdays`));
  if (pack.teachers) (hub.setTeachers(pack.teachers), done.push(`${pack.teachers.length} staff`));
  if (pack.activities) (hub.setActivities(pack.activities.map((a) => ({ ...a, id: newId() }))), done.push(`${pack.activities.length} weekly activities`));
  if (pack.memories) {
    const kept = pack.memories.filter((m) => remember(hub, m, "told").ok).length;
    done.push(`${kept} things to remember`);
  }
  if (pack.events) {
    for (const e of hub.events.all()) if (e.source === "calendar") hub.events.del(e.id);
    for (const e of pack.events) hub.events.put({ ...e, id: `cal:${newId().slice(0, 12)}`, source: "calendar" });
    done.push(`${pack.events.length} calendar dates`);
    hub.bus.changed("events");
  }
  if (done.length) hub.feed("settings", `Setup imported: ${done.join(", ")}`);
  return done;
}

/** Dev mode: load private/nudge-setup.json (git-ignored) once, if it's there. */
export function loadPrivateSetup(hub: Hub, file: string, log: (m: string) => void): void {
  if (!fs.existsSync(file) || hub.db.kvGet<boolean>("privateSetupLoaded", false)) return;
  try {
    const done = applySetup(hub, SetupPack.parse(JSON.parse(fs.readFileSync(file, "utf8"))));
    hub.db.kvSet("privateSetupLoaded", true);
    log(`loaded ${file}: ${done.join(", ")}`);
  } catch (e) {
    log(`couldn't load ${file}: ${String(e).slice(0, 200)}`);
  }
}
