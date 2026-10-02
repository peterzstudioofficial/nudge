import { addDays, formTimeOn, type Role, type Snapshot } from "@nudge/shared";
import type { Ctx } from "./context";

export function buildSnapshot(ctx: Ctx, role: Role): Snapshot {
  const { hub } = ctx;
  const todayKey = hub.todayKey();
  const tomorrowKey = addDays(todayKey, 1);
  hub.ensureDay(todayKey);
  hub.ensureDay(tomorrowKey);
  const today = hub.dayState(todayKey);
  const target = hub.bagTarget();
  const { reward, bank, next } = hub.rewardState();
  const lessons = hub.lessonsOn(todayKey);

  return {
    now: hub.now(),
    rev: hub.bus.rev,
    role,
    today,
    tomorrow: hub.dayState(tomorrowKey),
    tasks: hub.listTasks(todayKey),
    tomorrowTasks: hub.listTasks(tomorrowKey),
    bag: hub.bagFor(target),
    kit: hub.kitLine(target),
    session: hub.session(),
    bank,
    lifetime: hub.lifetime(),
    reward,
    nextReward: next,
    settings: hub.settings(),
    timetable: lessons.map((l) => ({ subject: l.subject, span: l.span, start: l.start, end: l.end, room: l.room, teacher: l.teacher })),
    formTime: today.baseKind === "school" ? formTimeOn(todayKey, hub.formTime()) : "",
    events: hub.upcomingEvents(todayKey, 8),
    activities: hub.activitiesOn(todayKey),
    // Tools and build jobs are Peter's own: a parent never sees them.
    tools: role === "parent" ? [] : hub.listTools(),
    jobs: role === "parent" ? [] : hub.activeJobs().slice(0, 10).map((j) => ({ id: j.id, title: j.request.title, status: j.status, note: j.note, toolId: j.toolId, error: j.error, updatedAt: j.updatedAt })),
    weather: ctx.weather.current(),
    news: ctx.news.headline(),
    birthday: nextBirthday(hub.birthdays(), todayKey),
    heads: hub.heads(),
    reminders: hub.dueReminders(),
    // Asks are Peter's own questions + drafts: a parent never sees them.
    asks: role === "parent" ? [] : hub.pendingAsks(),
    // What's up on the wall can be a page of his documents: never the parent app.
    wall: role === "parent" ? null : ctx.wall?.current() ?? null,
    school: ctx.school.status(),
    termLabel: hub.termLabel(todayKey),
    sync: { lastSync: hub.now() },
  };
}

/** Soonest birthday in the next 3 days; friends sharing a day are shown together. */
function nextBirthday(list: { name: string; date: string }[], today: string): { name: string; inDays: number } | null {
  for (let i = 0; i <= 3; i++) {
    const key = addDays(today, i).slice(5);
    const hits = list.filter((b) => b.date === key).map((b) => b.name.trim()).filter(Boolean);
    if (hits.length) return { name: hits.length > 2 ? `${hits.slice(0, 2).join(", ")} +${hits.length - 2}` : hits.join(" & "), inDays: i };
  }
  return null;
}
