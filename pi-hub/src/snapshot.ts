import { addDays, parseDateKey, isoWeekday, type Role, type Snapshot } from "@nudge/shared";
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
  const periods = today.baseKind === "school" ? hub.timetable()[String(isoWeekday(parseDateKey(todayKey)))] ?? [] : [];

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
    timetable: periods,
    weather: ctx.weather.current(),
    news: ctx.news.headline(),
    birthday: nextBirthday(hub.birthdays(), todayKey),
    heads: hub.heads(),
    reminders: hub.dueReminders(),
    // Asks are Peter's own questions + drafts: a parent never sees them.
    asks: role === "parent" ? [] : hub.pendingAsks(),
    school: ctx.school.status(),
    termLabel: hub.termLabel(todayKey),
    sync: { lastSync: hub.now() },
  };
}

function nextBirthday(list: { name: string; date: string }[], today: string): { name: string; inDays: number } | null {
  let best: { name: string; inDays: number } | null = null;
  for (let i = 0; i <= 3; i++) {
    const key = addDays(today, i).slice(5);
    const hit = list.find((b) => b.date === key);
    if (hit && (!best || i < best.inDays)) best = { name: hit.name, inDays: i };
  }
  return best;
}
