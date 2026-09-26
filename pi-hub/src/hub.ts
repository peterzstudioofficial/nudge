import crypto from "node:crypto";
import {
  addDays, autoTags, bankFor, BagItem, Birthday, canAddTask, canBreak, canClaim, canSkip, dateKey,
  DayKind, DayState, DEFAULT_SETTINGS, FeedEvent, Handoff, hhmmToMinutes, isoWeekday, mmss, NewBagItem,
  NewNote, NewTask, NewTemplate, Note, NotePatch, OWNER_SETTINGS, PARENT_SETTINGS, parseDateKey, PointEntry,
  Reminder, Reward, Role, Session, Settings, SUBJECT_NAMES, sortTasks, Task, TaskPatch, Template, TermDate,
  termInfo, Timetable, CHURCHERS_2026_27, workedNow, Ask, AgentThread, SchoolItem, relativeDay, dueLabel,
} from "@nudge/shared";
import type { z } from "zod";
import { Bus } from "./bus";
import { Db } from "./db";
import { HttpError, notFound, refuse } from "./errors";

export const newId = () => crypto.randomUUID();

interface DayDoc {
  id: string; // date key
  arrivedAt: number | null;
  wokeAt: number | null;
  sick: "ill" | "hurt" | "flat" | null;
  skipsUsed: number;
  focusSec: number;
  switched: number;
  materialized: string[]; // template ids already copied into this day
  bagMade: boolean;
}

/** Default timetable (edit in the admin page). Taken from the Screen v2 brief. */
export const DEFAULT_TIMETABLE: Timetable = {
  "1": [{ subject: "maths", span: 2 }, { subject: "eng", span: 1 }, { subject: "history", span: 1 }, { subject: "french", span: 2 }, { subject: "bio", span: 1 }],
  "2": [{ subject: "chem", span: 2 }, { subject: "maths", span: 1 }, { subject: "eng", span: 1 }, { subject: "geog", span: 2 }, { subject: "music", span: 1 }],
  "3": [{ subject: "physics", span: 2 }, { subject: "eng", span: 1 }, { subject: "maths", span: 1 }, { subject: "pe", span: 2 }, { subject: "re", span: 1 }],
  "4": [{ subject: "maths", span: 1 }, { subject: "chem", span: 1 }, { subject: "history", span: 2 }, { subject: "cs", span: 2 }, { subject: "eng", span: 1 }],
  "5": [{ subject: "maths", span: 2 }, { subject: "chem", span: 2 }, { subject: "eng", span: 1 }, { subject: "pe", span: 2 }, { subject: "history", span: 1 }],
};

export const DEFAULT_REWARD: Omit<Reward, "id" | "startPoints"> = {
  name: "cinema trip", icon: "redeem", goal: 60, unlockedAt: null, ackedAt: null,
};

export class Hub {
  bus = new Bus();
  tasks;
  templates;
  bag;
  points;
  feedC;
  notes;
  reminders;
  days;
  asks;
  threads;
  handoffs;
  school;
  private clock: () => number;

  constructor(public db: Db, opts: { clock?: () => number } = {}) {
    this.clock = opts.clock ?? Date.now;
    this.tasks = db.collection<Task>("task", (t) => t.date, (t) => t.createdAt);
    this.templates = db.collection<Template>("template", () => null, (t) => t.createdAt);
    this.bag = db.collection<BagItem>("bag", (b) => b.date, (b) => b.order);
    this.points = db.collection<PointEntry>("point", (p) => dateKey(p.ts), (p) => p.ts);
    this.feedC = db.collection<FeedEvent>("feed", (e) => dateKey(e.ts), (e) => e.ts);
    this.notes = db.collection<Note>("note", (n) => dateKey(n.createdAt), (n) => n.createdAt);
    this.reminders = db.collection<Reminder>("reminder", (r) => dateKey(r.at), (r) => r.at);
    this.days = db.collection<DayDoc>("day", (d) => d.id, () => 0);
    this.asks = db.collection<Ask>("ask", () => null, (a) => a.createdAt);
    this.threads = db.collection<AgentThread>("thread", () => null, (t) => t.createdAt);
    this.handoffs = db.collection<Handoff>("handoff", () => null, (h) => h.createdAt);
    this.school = db.collection<SchoolItem>("school", (s) => s.due, (s) => s.receivedAt);
    this.recoverSession();
  }

  now(): number {
    return this.clock();
  }
  todayKey(): string {
    return dateKey(this.now());
  }

  /* ------------------------------ settings ------------------------------ */

  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.db.kvGet<Partial<Settings>>("settings", {}) };
  }

  updateSettings(role: Role, patch: Partial<Settings>): Settings {
    const allowed: (keyof Settings)[] = role === "parent" ? PARENT_SETTINGS : role === "owner" || role === "screen" ? OWNER_SETTINGS : [];
    const bad = Object.keys(patch).filter((k) => !allowed.includes(k as keyof Settings));
    if (bad.length) throw new HttpError(403, `can't change: ${bad.join(", ")}`, { icon: "lock", line: "ask a parent in their app" });
    const next = { ...this.settings(), ...patch };
    this.db.kvSet("settings", next);
    this.bus.changed("settings");
    return next;
  }

  terms(): TermDate[] {
    return this.db.kvGet<TermDate[]>("terms", CHURCHERS_2026_27);
  }
  setTerms(t: TermDate[]): void {
    this.db.kvSet("terms", t);
    this.bus.changed("day");
  }
  timetable(): Timetable {
    return this.db.kvGet<Timetable>("timetable", DEFAULT_TIMETABLE);
  }
  setTimetable(t: Timetable): void {
    this.db.kvSet("timetable", t);
    this.bus.changed("day", "bag");
  }
  birthdays(): Birthday[] {
    return this.db.kvGet<Birthday[]>("birthdays", []);
  }
  setBirthdays(b: Birthday[]): void {
    this.db.kvSet("birthdays", b);
    this.bus.changed("day");
  }
  keptItems(): string[] {
    return this.db.kvGet<string[]>("bagKept", ["planner", "calculator"]);
  }

  /* -------------------------------- days -------------------------------- */

  private dayDoc(date: string): DayDoc {
    return (
      this.days.get(date) ?? {
        id: date, arrivedAt: null, wokeAt: null, sick: null, skipsUsed: 0, focusSec: 0, switched: 0, materialized: [], bagMade: false,
      }
    );
  }
  private saveDay(d: DayDoc) {
    this.days.put(d);
  }

  marks(): Record<string, "away" | "holiday"> {
    return this.db.kvGet<Record<string, "away" | "holiday">>("daymarks", {});
  }

  dayState(date: string): DayState {
    const info = termInfo(date, this.terms());
    const doc = this.dayDoc(date);
    const mark = this.marks()[date];
    let kind: DayKind = info.kind;
    if (mark === "holiday" && kind === "school") kind = "holiday";
    if (mark === "away") kind = "away";
    if (doc.sick) kind = "sick";
    const s = this.settings();
    return {
      date,
      kind,
      baseKind: info.kind,
      arrivedAt: doc.arrivedAt,
      wokeAt: doc.wokeAt,
      sick: doc.sick,
      skipsUsed: doc.skipsUsed,
      lieIn: s.lieInWeekends && kind !== "school",
    };
  }

  isSchoolDay(date: string): boolean {
    return this.dayState(date).kind === "school";
  }

  nextSchoolDay(from: string): string {
    let d = addDays(from, 1);
    for (let i = 0; i < 21; i++, d = addDays(d, 1)) if (this.isSchoolDay(d)) return d;
    return addDays(from, 1);
  }

  termLabel(date: string): string {
    const i = termInfo(date, this.terms());
    return i.term ? `${i.term.term}${i.confirmed ? "" : " (est.)"}` : i.label;
  }

  /** Copy weekly templates into a day and prepare tomorrow's bag. Idempotent. */
  ensureDay(date: string): void {
    const doc = this.dayDoc(date);
    const state = this.dayState(date);
    const wd = isoWeekday(parseDateKey(date));
    let changed = false;
    for (const t of this.templates.all()) {
      if (doc.materialized.includes(t.id)) continue;
      if (!t.days.includes(wd)) continue;
      if (t.schoolDaysOnly && state.baseKind !== "school") continue;
      doc.materialized.push(t.id);
      this.tasks.put(this.makeTask({ date, name: t.name, subject: t.subject, phase: t.phase, mins: t.mins, note: "" }, "template", `tpl:${t.id}:${date}`));
      changed = true;
    }
    if (changed) this.saveDay(doc);
  }

  private ensureBag(target: string): void {
    const doc = this.dayDoc(target);
    if (doc.bagMade) return;
    doc.bagMade = true;
    this.saveDay(doc);
    const wd = String(isoWeekday(parseDateKey(target)));
    const periods = this.timetable()[wd] ?? [];
    let order = 0;
    for (const k of this.keptItems()) {
      this.bag.put({ id: newId(), date: target, name: k, subject: "mine", note: "", kept: true, got: true, skipped: false, source: "self", order: order++ });
    }
    const seen = new Set<string>();
    for (const p of periods) {
      if (["pe", "free", "study", "music"].includes(p.subject) || seen.has(p.subject)) continue;
      seen.add(p.subject);
      this.bag.put({
        id: newId(), date: target, name: SUBJECT_NAMES[p.subject] ?? p.subject, subject: p.subject, note: "",
        kept: false, got: false, skipped: false, source: "self", order: order++,
      });
    }
    this.bus.changed("bag");
  }

  bagTarget(): string {
    const today = this.todayKey();
    return this.nextSchoolDay(today);
  }

  kitLine(target: string): string {
    const periods = this.timetable()[String(isoWeekday(parseDateKey(target)))] ?? [];
    return periods.some((p) => p.subject === "pe") ? "PE kit" : "";
  }

  arrive(): { already: boolean } {
    const d = this.dayDoc(this.todayKey());
    if (d.arrivedAt) return { already: true };
    d.arrivedAt = this.now();
    this.saveDay(d);
    this.feed("arrive", "Home, welcomed back");
    this.bus.changed("day");
    return { already: false };
  }

  wake(): void {
    const d = this.dayDoc(this.todayKey());
    d.wokeAt = this.now();
    this.saveDay(d);
    this.bus.changed("day");
  }

  sick(kind: "ill" | "hurt" | "flat" | null): void {
    const d = this.dayDoc(this.todayKey());
    d.sick = kind;
    this.saveDay(d);
    if (kind) {
      const s = this.session();
      if (s && s.state === "running") this.pause();
      const words = { ill: "unwell, staying home", hurt: "injured", flat: "having a bad day, needs a pause" }[kind];
      this.feed("sick", `${cap(this.settings().ownerName)} is ${words}. Tasks paused for today.`);
    } else {
      this.feed("sick", "Feeling better, tasks back on");
    }
    this.bus.changed("day", "session", "tasks");
  }

  markDay(date: string, kind: "away" | "holiday" | null): void {
    const m = this.marks();
    if (kind) m[date] = kind;
    else delete m[date];
    this.db.kvSet("daymarks", m);
    this.bus.changed("day");
  }

  /* -------------------------------- tasks ------------------------------- */

  private makeTask(input: { date: string; name: string; subject: string; phase: Task["phase"]; mins: number; note: string }, source: Task["source"], id?: string): Task {
    const now = this.now();
    const existing = this.tasks.byDay(input.date);
    return {
      id: id ?? newId(),
      date: input.date,
      name: input.name,
      subject: input.subject,
      phase: input.phase,
      mins: input.mins,
      source,
      order: existing.length ? Math.max(...existing.map((t) => t.order)) + 1 : 0,
      done: false,
      doneAt: null,
      started: false,
      spentSec: 0,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    };
  }

  listTasks(date: string): Task[] {
    return sortTasks(this.tasks.byDay(date));
  }

  addTask(input: z.infer<typeof NewTask>, source: Task["source"], opts: { skipCap?: boolean } = {}): Task {
    const today = this.todayKey();
    const date = input.date ?? (input.when === "today" ? today : input.when === "tomorrow" ? addDays(today, 1) : today);
    if (!opts.skipCap) {
      const g = canAddTask(this.tasks.byDay(date).filter((t) => t.source === "parent").length, this.settings());
      if (!g.ok) throw refuse(g);
    }
    const t = this.tasks.put(this.makeTask({ date, name: input.name, subject: input.subject, phase: input.phase, mins: input.mins, note: input.note }, source));
    this.bus.changed("tasks");
    return t;
  }

  patchTask(id: string, patch: z.infer<typeof TaskPatch>): Task {
    const t = this.tasks.patch(id, (t) => ({ ...t, ...patch, updatedAt: this.now() }));
    if (!t) throw notFound("no such task");
    this.bus.changed("tasks");
    return t;
  }

  deleteTask(id: string): void {
    const s = this.session();
    if (s?.taskId === id) this.db.kvDel("session");
    this.tasks.del(id);
    this.bus.changed("tasks", "session");
  }

  skipTask(id: string): { left: number } {
    const date = this.todayKey();
    const d = this.dayDoc(date);
    const g = canSkip(d.skipsUsed, this.settings());
    if (!g.ok) throw refuse(g);
    const t = this.tasks.get(id);
    if (!t) throw notFound("no such task");
    const max = Math.max(0, ...this.tasks.byDay(t.date).map((x) => x.order));
    this.tasks.put({ ...t, order: max + 1, updatedAt: this.now() });
    d.skipsUsed++;
    this.saveDay(d);
    this.bus.changed("tasks", "day");
    return { left: this.settings().skipsPerDay - d.skipsUsed };
  }

  addTemplate(input: z.infer<typeof NewTemplate>): Template {
    const t = this.templates.put({ ...input, id: newId(), createdAt: this.now() });
    this.bus.changed("tasks");
    return t;
  }
  deleteTemplate(id: string): void {
    this.templates.del(id);
    // future copies go too; today and past stay as they are
    const today = this.todayKey();
    for (const t of this.tasks.all()) if (t.id.startsWith(`tpl:${id}:`) && t.date > today && !t.started) this.tasks.del(t.id);
    this.bus.changed("tasks");
  }

  /* ------------------------------- session ------------------------------ */

  session(): Session | null {
    const s = this.db.kvGet<Session | null>("session", null);
    return s ? { ...s, now: this.now() } : null;
  }
  private saveSession(s: Session | null) {
    if (s) this.db.kvSet("session", s);
    else this.db.kvDel("session");
    this.bus.changed("session");
  }

  /** After a power cut: a running session is paused at the last heartbeat, so no phantom work is counted. */
  private recoverSession() {
    const s = this.db.kvGet<Session | null>("session", null);
    const beat = this.db.kvGet<number>("heartbeat", 0);
    if (s && s.state === "running" && s.runningSince) {
      const until = Math.max(s.runningSince, beat || s.runningSince);
      const worked = s.workedSec + Math.floor((until - s.runningSince) / 1000);
      this.db.kvSet("session", { ...s, state: "paused", workedSec: Math.min(worked, s.totalSec + 3600), runningSince: null });
    }
  }
  heartbeat() {
    this.db.kvSet("heartbeat", this.now());
  }

  /** Keep the task's own record of time in step with the session. */
  private keep(s: Session): number {
    const worked = workedNow(s, this.now());
    const t = this.tasks.get(s.taskId);
    if (t) {
      const delta = Math.max(0, worked - t.spentSec);
      if (delta) {
        const d = this.dayDoc(this.todayKey());
        d.focusSec += delta;
        this.saveDay(d);
      }
      this.tasks.put({ ...t, spentSec: Math.max(t.spentSec, worked), updatedAt: this.now() });
    }
    return worked;
  }

  start(taskId: string): { session: Session; firstStart: boolean; points: number } {
    const task = this.tasks.get(taskId);
    if (!task) throw notFound("no such task");
    if (task.done) throw refuse({ icon: "task_alt", line: "already done" });
    const today = this.dayState(this.todayKey());
    if (today.kind === "sick") throw refuse({ icon: "sick", line: "resting today", sub: "TASKS ARE PAUSED" });
    const cur = this.session();
    if (cur && cur.taskId === taskId) {
      if (cur.state !== "running") return { session: this.resume(), firstStart: false, points: 0 };
      return { session: cur, firstStart: false, points: 0 };
    }
    if (cur) this.switchAway("switch");
    const now = this.now();
    const firstStart = !task.started;
    let points = 0;
    if (firstStart) {
      points = this.settings().pointsStart;
      this.tasks.put({ ...task, started: true, updatedAt: now });
      if (points > 0) this.award(points, "start", taskId);
    }
    const s: Session = {
      taskId,
      state: "running",
      totalSec: task.mins * 60,
      workedSec: Math.min(task.spentSec, task.mins * 60),
      runningSince: now,
      startedAt: now,
      breakUntil: null,
      now,
    };
    this.saveSession(s);
    this.bus.changed("tasks");
    return { session: s, firstStart, points };
  }

  pause(): Session {
    const s = this.session();
    if (!s) throw notFound("no session");
    if (s.state !== "running") return s;
    const worked = this.keep(s);
    const next: Session = { ...s, state: "paused", workedSec: worked, runningSince: null };
    this.saveSession(next);
    return next;
  }

  resume(): Session {
    const s = this.session();
    if (!s) throw notFound("no session");
    if (s.state === "running") return s;
    const next: Session = { ...s, state: "running", runningSince: this.now(), breakUntil: null };
    this.saveSession(next);
    return next;
  }

  takeBreak(): Session {
    const s = this.session();
    if (!s) throw notFound("no session");
    const worked = workedNow(s, this.now());
    const g = canBreak(worked);
    if (!g.ok) throw refuse(g);
    this.keep(s);
    const next: Session = {
      ...s, state: "break", workedSec: worked, runningSince: null, breakUntil: this.now() + this.settings().breakMins * 60_000,
    };
    this.saveSession(next);
    this.feed("break", "Took a break, walked about");
    return next;
  }

  /** Leave the task without finishing it. Progress is kept ("kept at 08:14"). */
  switchAway(kind: "switch" | "end"): { kept: number } {
    const s = this.session();
    if (!s) return { kept: 0 };
    const worked = this.keep(s);
    const d = this.dayDoc(this.todayKey());
    d.switched++;
    this.saveDay(d);
    this.saveSession(null);
    const t = this.tasks.get(s.taskId);
    this.feed(kind, kind === "end" ? `Session on ${t?.name ?? "a task"} ended by ${this.settings().parentName}` : `Switched task, kept at ${mmss(worked)}`);
    this.bus.changed("tasks");
    return { kept: worked };
  }

  claim(): { awarded: number; bank: number; unlocked: boolean; allDone: boolean } {
    const s = this.session();
    if (!s) throw notFound("no session");
    const worked = workedNow(s, this.now());
    const g = canClaim(worked, s.totalSec);
    if (!g.ok || worked < s.totalSec) throw refuse(g.ok ? { icon: "block", line: "finish it first" } : g);
    this.keep(s);
    const task = this.tasks.get(s.taskId);
    if (!task) throw notFound("no such task");
    this.tasks.put({ ...task, done: true, doneAt: this.now(), spentSec: worked, updatedAt: this.now() });
    this.saveSession(null);
    const pts = this.settings().pointsClaim;
    this.award(pts, "claim", task.id);
    this.feed("claim", `Claimed ${task.name}`);
    this.bus.changed("tasks");
    const r = this.rewardState();
    const allDone = this.listTasks(task.date).every((t) => t.done || t.phase === "bag");
    return { awarded: pts, bank: r.bank, unlocked: r.bank >= r.reward.goal, allDone };
  }

  /* ------------------------------- points ------------------------------- */

  lifetime(): number {
    return (this.db.sql.prepare("SELECT COALESCE(SUM(json_extract(data,'$.delta')),0) AS n FROM docs WHERE kind='point'").get() as { n: number }).n;
  }

  private award(delta: number, reason: PointEntry["reason"], taskId: string | null) {
    this.points.put({ id: newId(), ts: this.now(), delta, reason, taskId });
    const r = this.rewardState();
    if (r.bank >= r.reward.goal && !r.reward.unlockedAt) {
      this.db.kvSet("reward", { ...r.reward, unlockedAt: this.now() });
      this.feed("unlock", `Unlocked ${r.reward.name}`);
    }
    this.bus.changed("points");
  }

  rewardState(): { reward: Reward; bank: number; next: { name: string; goal: number; icon: string } | null } {
    let reward = this.db.kvGet<Reward | null>("reward", null);
    if (!reward) {
      reward = { ...DEFAULT_REWARD, id: newId(), startPoints: 0 };
      this.db.kvSet("reward", reward);
    }
    const queue = this.db.kvGet<{ name: string; goal: number; icon: string }[]>("rewardQueue", [{ name: "new headphones", goal: 60, icon: "headphones" }]);
    return { reward, bank: bankFor(this.lifetime(), reward.startPoints), next: queue[0] ?? null };
  }

  /** Move past an unlocked reward. Leftover points carry over; nothing is ever deducted. */
  ackReward(): Reward {
    const { reward, next } = this.rewardState();
    if (!reward.unlockedAt) throw refuse({ icon: "savings", line: "not unlocked yet" });
    const queue = this.db.kvGet<{ name: string; goal: number; icon: string }[]>("rewardQueue", []);
    const nxt = next ?? { name: reward.name, goal: reward.goal, icon: reward.icon };
    const fresh: Reward = { id: newId(), name: nxt.name, goal: nxt.goal, icon: nxt.icon, startPoints: reward.startPoints + reward.goal, unlockedAt: null, ackedAt: null };
    this.db.kvSet("reward", fresh);
    this.db.kvSet("rewardQueue", queue.slice(1));
    this.bus.changed("points");
    return fresh;
  }

  setReward(input: { name: string; goal: number; icon: string; next?: { name: string; goal: number; icon: string }[] }): Reward {
    const { reward } = this.rewardState();
    const r: Reward = { ...reward, name: input.name, goal: input.goal, icon: input.icon };
    const bank = bankFor(this.lifetime(), r.startPoints);
    if (bank >= r.goal && !r.unlockedAt) r.unlockedAt = this.now();
    this.db.kvSet("reward", r);
    if (input.next) this.db.kvSet("rewardQueue", input.next);
    this.bus.changed("points");
    return r;
  }

  /* --------------------------------- bag -------------------------------- */

  bagFor(date: string): BagItem[] {
    this.ensureBag(date);
    return [...this.bag.byDay(date)].sort((a, b) => a.order - b.order);
  }

  addBag(input: z.infer<typeof NewBagItem>, source: BagItem["source"]): BagItem {
    const date = input.date ?? this.bagTarget();
    const items = this.bagFor(date);
    const dup = items.find((b) => b.name.toLowerCase() === input.name.toLowerCase());
    if (dup) {
      if (input.note && !dup.note) return this.bag.put({ ...dup, note: input.note });
      return dup;
    }
    const b = this.bag.put({
      id: newId(), date, name: input.name, subject: input.subject, note: input.note, kept: input.kept, got: input.kept, skipped: false,
      source, order: items.length ? Math.max(...items.map((i) => i.order)) + 1 : 0,
    });
    this.bus.changed("bag");
    return b;
  }

  bagGot(id: string): { allPacked: boolean; awarded: number } {
    const b = this.bag.get(id);
    if (!b) throw notFound("no such item");
    this.bag.put({ ...b, got: true, skipped: false });
    const items = this.bagFor(b.date);
    const allPacked = items.every((i) => i.got || i.kept);
    let awarded = 0;
    if (allPacked) {
      const flag = `bagdone:${b.date}`;
      if (!this.db.kvGet<boolean>(flag, false)) {
        this.db.kvSet(flag, true);
        awarded = this.settings().pointsClaim;
        this.award(awarded, "bag", null);
        this.feed("bag", "Packed bag for tomorrow");
        for (const t of this.tasks.byDay(this.todayKey())) if (t.phase === "bag" && !t.done) this.tasks.put({ ...t, done: true, doneAt: this.now() });
      }
    }
    this.bus.changed("bag", "tasks");
    return { allPacked, awarded };
  }

  bagSkip(id: string): void {
    const b = this.bag.get(id);
    if (!b) throw notFound("no such item");
    this.bag.put({ ...b, skipped: true });
    this.bus.changed("bag");
  }

  bagRemove(id: string): void {
    this.bag.del(id);
    this.bus.changed("bag");
  }

  /* -------------------------------- notes ------------------------------- */

  listNotes(): Note[] {
    return this.notes.all().reverse();
  }

  addNote(input: z.infer<typeof NewNote>): Note {
    const now = this.now();
    if (input.id) {
      const existing = this.notes.get(input.id);
      if (existing) return existing; // offline replay
    }
    const label = input.label || input.body.split("\n")[0]?.slice(0, 60) || (input.kind === "voice" ? "new recording" : "note");
    const n: Note = {
      id: input.id ?? newId(),
      kind: input.kind,
      label,
      body: input.body,
      tags: input.tags.length ? input.tags : autoTags(label, input.body),
      secs: input.secs,
      hasAudio: false,
      wall: false,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.put(n);
    this.bus.changed("notes");
    return n;
  }

  patchNote(id: string, patch: z.infer<typeof NotePatch>): Note {
    const n = this.notes.patch(id, (n) => {
      const next = { ...n, ...patch, updatedAt: this.now() };
      if (!patch.tags && (patch.label !== undefined || patch.body !== undefined)) next.tags = autoTags(next.label, next.body);
      return next;
    });
    if (!n) throw notFound("no such note");
    this.bus.changed("notes");
    return n;
  }

  deleteNote(id: string): void {
    this.notes.del(id);
    this.db.blobDel("audio:" + id);
    this.bus.changed("notes");
  }

  setNoteAudio(id: string, mime: string, data: Uint8Array, secs?: number): Note {
    const n = this.notes.get(id);
    if (!n) throw notFound("no such note");
    this.db.blobPut("audio:" + id, mime, data);
    const next = { ...n, kind: "voice" as const, hasAudio: true, secs: secs ?? n.secs, updatedAt: this.now() };
    this.notes.put(next);
    this.bus.changed("notes");
    return next;
  }

  /** "To the wall" from the notes app: becomes a reminder that drops in at a time, or joins the task list. */
  noteToWall(id: string, as: "reminder" | "task", at: number): Reminder | Task {
    const n = this.notes.get(id);
    if (!n) throw notFound("no such note");
    this.notes.put({ ...n, wall: true, updatedAt: this.now() });
    this.bus.changed("notes");
    const line = n.body.split("\n")[0] ?? "";
    if (as === "reminder") return this.addReminder(n.label, line, at, "note", n.id);
    return this.addTask({ date: dateKey(at), name: n.label.slice(0, 80), subject: "mine", phase: "mine", mins: this.settings().defaultMins, note: line.slice(0, 200), when: "date" }, "note", { skipCap: true });
  }

  addReminder(text: string, line: string, at: number, source: Reminder["source"], noteId: string | null = null): Reminder {
    const r = this.reminders.put({ id: newId(), text: text.slice(0, 120), line: line.slice(0, 200), at, shownAt: null, noteId, source });
    this.bus.changed("reminders");
    return r;
  }

  dueReminders(): Reminder[] {
    const now = this.now();
    return this.reminders.since(now - 86_400_000 * 2).filter((r) => r.at <= now && !r.shownAt);
  }

  ackReminder(id: string): void {
    this.reminders.patch(id, (r) => ({ ...r, shownAt: this.now() }));
    this.bus.changed("reminders");
  }

  /* --------------------------------- feed ------------------------------- */

  feed(type: string, text: string): FeedEvent {
    return this.feedC.put({ id: newId(), ts: this.now(), type, text });
  }

  recentFeed(limit = 30): FeedEvent[] {
    return this.feedC.latest(limit);
  }

  /** The parent app's week: claimed tasks, focused hours, switches, and each day's done/total + points. */
  stats(days = 7) {
    const today = this.todayKey();
    const from = addDays(today, -(days - 1));
    const pts = this.points.betweenDays(from, today);
    let focused = 0;
    let switched = 0;
    const history = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(today, -i);
      const doc = this.days.get(date);
      focused += doc?.focusSec ?? 0;
      switched += doc?.switched ?? 0;
      const tasks = this.tasks.byDay(date).filter((t) => t.phase !== "bag");
      const dayPts = pts.filter((p) => dateKey(p.ts) === date).reduce((a, p) => a + p.delta, 0);
      if (i > 0 && (tasks.length || dayPts)) {
        history.push({ date, label: relativeDay(date, today), done: tasks.filter((t) => t.done).length, total: tasks.length, pts: dayPts });
      }
    }
    return {
      claimed: pts.filter((p) => p.reason === "claim").length,
      focusedSec: focused,
      switched,
      history,
    };
  }

  /* -------------------------------- asks -------------------------------- */

  createAsk(a: Omit<Ask, "id" | "status" | "createdAt" | "answeredAt" | "answeredBy">): Ask {
    // One question at a time on the wall: an older pending ask expires.
    for (const old of this.asks.all()) if (old.status === "pending") this.asks.put({ ...old, status: "expired", answeredAt: this.now() });
    const ask = this.asks.put({ ...a, id: newId(), status: "pending", createdAt: this.now(), answeredAt: null, answeredBy: null });
    this.bus.changed("asks");
    return ask;
  }

  pendingAsks(): Ask[] {
    const cutoff = this.now() - 6 * 3600_000;
    return this.asks.since(cutoff).filter((a) => a.status === "pending");
  }

  /** Runs an approved ask. Nothing is ever sent from here: email becomes a hand-off to the desktop. */
  answerAsk(id: string, yes: boolean, by: string): Ask {
    const a = this.asks.get(id);
    if (!a) throw notFound("no such question");
    if (a.status !== "pending") return a;
    if (!yes) {
      const r = this.asks.put({ ...a, status: "declined", answeredAt: this.now(), answeredBy: by });
      this.bus.changed("asks");
      return r;
    }
    const p = a.payload as Record<string, unknown>;
    if (a.kind === "email") {
      this.handoffs.put({
        id: newId(), kind: "compose",
        payload: { to: String(p.to ?? ""), subject: String(p.subject ?? ""), body: String(p.body ?? "") },
        createdAt: this.now(), doneAt: null,
      });
      this.feed("agent", `Email to ${p.toName ?? p.to} ready to send on the computer`);
      this.bus.changed("handoffs");
    } else if (a.kind === "week" || a.kind === "task") {
      const list = (p.tasks as { name: string; date: string; mins?: number; subject?: string }[]) ?? [];
      for (const t of list) {
        this.addTask({ date: t.date, name: t.name, subject: t.subject ?? "study", phase: "study", mins: t.mins ?? 25, note: "", when: "date" }, "agent", { skipCap: true });
      }
      this.feed("agent", `Added ${list.length} session${list.length === 1 ? "" : "s"} to the week`);
    } else if (a.kind === "reminder") {
      this.addReminder(String(p.text ?? "reminder"), String(p.line ?? ""), Number(p.at ?? this.now()), "agent");
    }
    const r = this.asks.put({ ...a, status: "done", answeredAt: this.now(), answeredBy: by });
    this.bus.changed("asks");
    return r;
  }

  pendingHandoffs(): Handoff[] {
    return this.handoffs.all().filter((h) => !h.doneAt);
  }
  doneHandoff(id: string): void {
    this.handoffs.patch(id, (h) => ({ ...h, doneAt: this.now() }));
    this.bus.changed("handoffs");
  }

  /* ------------------------------ school heads --------------------------- */

  /** The one pinned line on the morning brief, e.g. "bring your chemistry book, mr hale emailed". */
  heads(): string {
    const today = this.todayKey();
    const tomorrow = addDays(today, 1);
    const items = this.school.all().filter((i) => !i.handled || i.action === "bag");
    const rank = (i: SchoolItem) => (i.due === tomorrow ? 0 : i.due === today ? 1 : 2) * 10 + (i.source === "mail" ? 0 : 1);
    const soon = items
      .filter((i) => (i.kind === "bring" || i.kind === "deadline" || i.kind === "homework") && (!i.due || i.due === today || i.due === tomorrow))
      .sort((a, b) => rank(a) - rank(b) || b.receivedAt - a.receivedAt)[0];
    if (!soon) return "";
    const who = soon.from ? (soon.source === "mail" ? `, ${soon.from.toLowerCase()} emailed` : ` (${soon.from.toLowerCase()})`) : "";
    const title = soon.title.split(" — ")[0];
    if (soon.kind === "bring") return `${title}${soon.source === "mail" ? who : ""}`;
    return `${title}${soon.due ? " — due " + dueLabel(soon.due, today) : ""}`;
  }
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function minutesUntil(hhmm: string, nowMins: number): number {
  return hhmmToMinutes(hhmm) - nowMins;
}
