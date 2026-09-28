import type { Session, Settings, Task } from "./model";

/**
 * The rules every device obeys. The hub enforces them; screens only display the result.
 * Straight from the design + research brief:
 *  - +1 for starting a task (once per task, never repeatable), +3 for claiming it.
 *  - Points are never taken away. No streaks, no penalties.
 *  - Claim needs real work first ("finish it first").
 *  - Break only after five minutes of work ("break in 3 min").
 *  - Two skips a day; a skip moves the task to the back and keeps its progress.
 *  - The parent sets at most `maxTasksPerDay` tasks for one day.
 */

export const MIN_WORK_BEFORE_CLAIM_SEC = 60;
export const MIN_WORK_BEFORE_BREAK_SEC = 300;
export const CLAIM_GRACE_SEC = 28;

export const DEFAULT_SETTINGS: Settings = {
  ownerName: "peter",
  parentName: "dad",
  ai: true,
  wakeWord: false,
  iconKeys: false,
  dimAtNight: true,
  quietAfter11: true,
  reminders: true,
  brightness: 2,
  lieInWeekends: true,
  leaveForSchool: "07:55",
  alarm: "07:10",
  bedtime: "23:00",
  defaultMins: 25,
  breakMins: 5,
  skipsPerDay: 2,
  maxTasksPerDay: 5,
  pointsStart: 1,
  pointsClaim: 3,
  location: { name: "Petersfield", lat: 51.0036, lon: -0.9349 },
  newsFeed: "https://feeds.bbci.co.uk/news/england/hampshire/rss.xml",
  blockList: ["instagram.com", "tiktok.com", "snapchat.com", "x.com", "twitter.com", "reddit.com", "netflix.com", "twitch.tv"],
  studyOnlySites: ["youtube.com"],
  nfcTags: {},
  schoolPages: [],
  schoolMail: true,
  schoolMailSenders: [],
  aiModel: "deepseek/deepseek-v4.1-flash",
  webSearch: true,
  aiAdvisorModel: "deepseek/deepseek-v4-pro",
  buildModel: "deepseek/deepseek-v4.1-flash",
  aiBudgetUsd: 5,
  voiceModel: "gemini-3.8-live",
  voiceReplies: false,
  voiceName: "Puck",
  ttsModel: "gemini-3.8-flash-lite-tts",
  yearGroup: "",
  house: "",
  profile: "",
  googleKeep: false,
  interests: [],
};

/** Work seconds on the clock right now for a session. */
export function workedNow(s: Pick<Session, "workedSec" | "runningSince" | "state">, now: number): number {
  if (s.state === "running" && s.runningSince != null) {
    return s.workedSec + Math.max(0, Math.floor((now - s.runningSince) / 1000));
  }
  return s.workedSec;
}

export interface SessionView {
  worked: number;
  remaining: number;
  overrun: number;
  frac: number;
  claimReady: boolean;
  breakRemaining: number;
}

export function sessionView(s: Session, now: number): SessionView {
  const worked = workedNow(s, now);
  const remaining = Math.max(0, s.totalSec - worked);
  const overrun = Math.max(0, worked - s.totalSec);
  const breakRemaining = s.state === "break" && s.breakUntil ? Math.max(0, Math.ceil((s.breakUntil - now) / 1000)) : 0;
  return {
    worked,
    remaining,
    overrun,
    frac: s.totalSec > 0 ? remaining / s.totalSec : 0,
    claimReady: worked >= s.totalSec,
    breakRemaining,
  };
}

export type Guard = { ok: true } | { ok: false; icon: string; line: string; sub?: string };

export function canClaim(worked: number, totalSec: number): Guard {
  const need = Math.min(MIN_WORK_BEFORE_CLAIM_SEC, totalSec);
  if (worked < need) return { ok: false, icon: "block", line: "finish it first" };
  return { ok: true };
}

export function canBreak(worked: number): Guard {
  if (worked < MIN_WORK_BEFORE_BREAK_SEC) {
    return { ok: false, icon: "self_improvement", line: "break in " + Math.ceil((MIN_WORK_BEFORE_BREAK_SEC - worked) / 60) + " min" };
  }
  return { ok: true };
}

export function canSkip(skipsUsed: number, settings: Pick<Settings, "skipsPerDay">): Guard {
  if (skipsUsed >= settings.skipsPerDay) return { ok: false, icon: "block", line: "no skips left" };
  return { ok: true };
}

export function canAddTask(countForDay: number, settings: Pick<Settings, "maxTasksPerDay">): Guard {
  if (countForDay >= settings.maxTasksPerDay) return { ok: false, icon: "block", line: "that is enough for one day" };
  return { ok: true };
}

/** Points banked towards the current reward. Never negative, never reduced by anything the user does. */
export function bankFor(lifetime: number, rewardStartPoints: number): number {
  return Math.max(0, lifetime - rewardStartPoints);
}

/** Order open tasks the way the wall walks them: home → study → mine → bag, then by order. */
export const PHASE_ORDER = ["home", "study", "mine", "bag"] as const;

export function sortTasks<T extends Pick<Task, "phase" | "order">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const p = PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase);
    return p !== 0 ? p : a.order - b.order;
  });
}

/** "free by 19:40" — now + remaining task minutes + 5 min change-over each. */
export function freeBy(nowMins: number, open: Pick<Task, "mins" | "spentSec">[]): number {
  return nowMins + open.reduce((a, t) => a + Math.max(1, t.mins - Math.floor(t.spentSec / 60)) + 5, 0);
}

/** Adaptive default (research brief §17): if the user keeps shortening a task, suggest the shorter length. */
export function adaptiveMins(history: number[], fallback: number): number {
  if (history.length < 3) return fallback;
  const recent = history.slice(-5);
  const sorted = [...recent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(5, Math.min(fallback, Math.round(median / 5) * 5));
}
