import {
  canBreak, hhmmToMinutes, HubClient, HubError, type HubMessage, type HwInput, mmss, sessionView, type Snapshot,
  type Task, CLAIM_GRACE_SEC, isoWeekday, askNeedsHold, HOLD_MS, type Ask,
} from "@nudge/shared";
import type { Mode, Plan, Key, SimOverrides, Slab } from "./types";

/**
 * The ND-1 wall device. A port of the ND-1 Panel v2 design logic, driven by the hub.
 *  - Data (tasks, the running session, the bag, points) always comes from the hub.
 *  - This controller only decides which screen to show and what the four keys do.
 * Nothing here can end a session, shorten a task or lift a block (design rule).
 */

const QUIET: Mode[] = ["select", "welcome", "reward", "nextReward", "bag", "unlock"];
const BUSY: Mode[] = ["active", "countdown", "paused", "overrun", "claim", "breathe", "break", "resumeScan"];
export const LOCAL_BREAK_SEC = 300;

export interface DeviceState {
  mode: Mode;
  lastMode: Mode | "";
  lastAct: number;
  preDoze: Mode;
  sel: string | null;
  listTop: number;
  bagIdx: number;
  countN: number;
  countTaskId: string | null;
  flash: number;
  holdKey: number;
  hold: number;
  dial: number;
  dialPress: boolean;
  slab: Slab | null;
  peek: boolean;
  bT0: number;
  eggTurns: number;
  discoBeat: number;
  fxSeq: number;
  awardPts: number;
  awardBank: number;
  power: boolean;
  mic: boolean;
  armed: boolean;
  bright: number;
  localBreakUntil: number | null;
  listening: boolean;
  online: boolean;
  pairCode: string | null;
  agentThread: string | null;
  bootAt: number;
  shownReminders: string[];
  shownAsks: string[];
  tick: number;
}

type Listener = () => void;

export class Device {
  s: DeviceState;
  snap: Snapshot | null = null;
  sim: SimOverrides = { clockOffsetMs: 0, dayKind: null, forced: null };
  private listeners = new Set<Listener>();
  private timers: Record<string, ReturnType<typeof setTimeout>> = {};
  private holdIv: ReturnType<typeof setInterval> | null = null;
  private iv: ReturnType<typeof setInterval> | null = null;
  private offlineSince: number | null = null;
  /** local clock minus hub clock, measured when each snapshot lands */
  private skew = 0;

  constructor(public client: HubClient) {
    const now = Date.now();
    this.s = {
      mode: "boot", lastMode: "", lastAct: now, preDoze: "standby", sel: null, listTop: 0, bagIdx: 0,
      countN: 3, countTaskId: null, flash: -1, holdKey: -1, hold: 0, dial: 0, dialPress: false, slab: null,
      peek: false, bT0: 0, eggTurns: 0, discoBeat: 0, fxSeq: 0, awardPts: 3, awardBank: 0, power: true, mic: true,
      armed: false, bright: 2, localBreakUntil: null, listening: false, online: false, pairCode: null,
      agentThread: null, bootAt: now, shownReminders: [], shownAsks: [], tick: 0,
    };
    this.snap = client.last;
    client.onSnapshot((snap) => this.onSnapshot(snap));
    client.onMessage((m) => this.onMessage(m));
    client.onStatus((on) => this.onStatus(on));
  }

  /* ------------------------------ plumbing ------------------------------ */

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private emit() {
    for (const l of this.listeners) l();
  }
  set(p: Partial<DeviceState>) {
    this.s = { ...this.s, ...p };
    this.emit();
  }
  private later(key: string, ms: number, fn: () => void) {
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(fn, ms);
  }

  now(): number {
    return Date.now() + this.sim.clockOffsetMs;
  }
  minsOfDay(): number {
    const d = new Date(this.now());
    return d.getHours() * 60 + d.getMinutes();
  }

  start() {
    this.later("boot", 6600, () => this.s.mode === "boot" && this.set({ mode: this.homeMode() }));
    this.iv = setInterval(() => this.beat(), 1000);
    void this.client.snapshot().catch(() => {});
    this.client.connect();
  }
  stop() {
    if (this.iv) clearInterval(this.iv);
    Object.values(this.timers).forEach(clearTimeout);
    this.client.close();
  }

  /* ------------------------------ data views ----------------------------- */

  dayKind(): string {
    return this.sim.dayKind ?? this.snap?.today.kind ?? "weekend";
  }
  isSchool(): boolean {
    return this.dayKind() === "school";
  }
  tasks(): Task[] {
    return this.snap?.tasks ?? [];
  }
  open(): Task[] {
    return this.tasks().filter((t) => !t.done);
  }
  cur(): Task | null {
    const open = this.open();
    return open.find((t) => t.id === this.s.sel) ?? open[0] ?? this.tasks()[0] ?? null;
  }
  session() {
    return this.snap?.session ?? null;
  }
  view() {
    const s = this.session();
    if (!s || !this.snap) return null;
    return sessionView(s, Date.now() - this.skew);
  }

  /** The screen for "nothing going on": resume a paused task first (research brief §15). */
  homeMode(): Mode {
    const s = this.session();
    if (s?.state === "paused") return "resume";
    return "standby";
  }

  /** Session state on the hub wins over whatever screen we were on. */
  effectiveMode(): Mode {
    const m = this.s.mode;
    if (this.sim.forced && this.sim.forced === m) return m;
    if (!this.s.power) return "night";
    const s = this.session();
    const overlays: Mode[] = ["breathe", "countdown", "award", "unlock", "nextReward", "boot", "update", "about", "bright", "pair", "disco"];
    if (s && !overlays.includes(m)) {
      const v = this.view()!;
      if (s.state === "running") {
        if (!v.claimReady) return m === "select" ? "select" : "active";
        return v.overrun > CLAIM_GRACE_SEC ? "overrun" : "claim";
      }
      if (s.state === "paused") return m === "select" ? "select" : m === "resume" ? "resume" : "paused";
      if (s.state === "break") return v.breakRemaining > 0 ? "break" : "resumeScan";
    }
    if (!s && ["active", "paused", "overrun", "claim"].includes(m)) return "standby";
    if (m === "break" && !s && this.s.localBreakUntil && this.now() >= this.s.localBreakUntil) return "resumeScan";
    return m;
  }

  /* -------------------------------- events ------------------------------- */

  private onSnapshot(snap: Snapshot) {
    this.snap = snap;
    this.skew = Date.now() - snap.now;
    // keep the selection pointing at something open
    const open = this.open();
    if (!open.some((t) => t.id === this.s.sel)) this.s.sel = open[0]?.id ?? null;
    if (snap.settings && this.s.bright !== snap.settings.brightness) this.s.bright = snap.settings.brightness;
    // Due reminders: drop in once, leave on their own.
    for (const r of snap.reminders) {
      if (this.s.shownReminders.includes(r.id)) continue;
      this.s.shownReminders = [...this.s.shownReminders, r.id].slice(-50);
      this.say({ icon: "push_pin", line: r.text, sub: r.line ? r.line.toUpperCase().slice(0, 40) : undefined, reminderId: r.id }, 6000);
      break;
    }
    // A question from the assistant takes the keys (yes / no).
    const ask = snap.asks[0];
    if (ask && !this.s.shownAsks.includes(ask.id)) {
      this.s.shownAsks = [...this.s.shownAsks, ask.id].slice(-50);
      clearTimeout(this.timers.slab);
      const icon = ask.kind === "email" ? "send" : ask.kind === "build" ? "construction" : ask.kind === "claude" ? "terminal" : ask.kind === "app" ? "apps" : "event_available";
      this.askKinds.set(ask.id, ask.kind);
      this.set({ slab: { icon, line: ask.line, rows: ask.rows, ask: true, askId: ask.id, sub: askNeedsHold(ask) ? "HOLD YES TO CONFIRM" : undefined } });
    }
    if (this.s.slab?.ask && !snap.asks.some((a) => a.id === this.s.slab!.askId)) this.dropSlab();
    this.emit();
  }

  private onMessage(m: HubMessage) {
    if (m.type === "input") this.input(m.input);
    if (m.type === "dev" && m.action === "reload") location.reload();
    if (m.type === "say") {
      if (this.s.listening) this.set({ listening: false });
      if (this.s.slab?.ask) return; // never cover a question
      this.say({ icon: m.icon, line: m.line, sub: m.sub, spin: m.icon === "progress_activity" }, m.ms ?? 3000);
    }
  }

  private onStatus(on: boolean) {
    if (on) {
      this.offlineSince = null;
      if (this.s.mode === "offline") this.set({ mode: this.homeMode(), online: true });
      else this.set({ online: true });
    } else {
      this.offlineSince ??= Date.now();
      this.set({ online: false });
    }
  }

  /** Physical input from the GPIO daemon, keyboard, touch or the simulator. */
  input(i: HwInput) {
    switch (i.kind) {
      case "key":
        if (i.down) this.keyDown(i.key);
        else this.keyUp();
        break;
      case "dial":
        this.turn(i.delta);
        break;
      case "dialPress":
        this.pressDial();
        break;
      case "touch":
        this.wake();
        break;
      case "nfc":
        this.nfc(i.uid);
        break;
      case "mic":
        this.set({ mic: i.on });
        if (!i.on) this.say({ icon: "mic_off", line: "mic is cut in hardware" }, 2600);
        break;
      case "power":
        this.set({ power: i.on });
        break;
      case "voice":
        this.heard(i.text);
        break;
    }
  }

  /* ------------------------------ the clock ------------------------------ */

  /** Once-a-day pop-ups: the birthday on the morning of the day, and the reward being within reach. */
  private shown = new Set<string>();
  private gentleNudges(snap: NonNullable<typeof this.snap>, mode: string) {
    const day = snap.today.date;
    const once = (key: string) => (this.shown.has(`${day}:${key}`) ? false : (this.shown.add(`${day}:${key}`), true));
    const b = snap.birthday;
    if (b && b.inDays === 0 && this.minsOfDay() < 12 * 60 && once("bday")) {
      const who = b.name.trim();
      const whose = /^(mum|dad|mom|nan|gran|grandma|grandad)$/i.test(who) ? `your ${who.toLowerCase()}'s` : `${who}'s`;
      return this.say({ icon: "cake", line: `it's ${whose} birthday` }, 4000);
    }
    // Bedtime: once a night, monochrome, leaves on its own (Nudge Popups: "time to sleep", 5s).
    const bed = hhmmToMinutes(snap.settings.bedtime);
    const m = this.minsOfDay();
    if (m >= bed && m < bed + 120 && !snap.session && once("bed")) {
      return this.say({ icon: "bedtime", line: "time to sleep", mono: true }, 5000);
    }
    const left = snap.reward.goal - snap.bank;
    const oneTask = snap.settings.pointsStart + snap.settings.pointsClaim;
    if (mode === "standby" && left > 0 && left <= oneTask && once(`reward:${snap.bank}`)) {
      const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      return this.say({ icon: "savings", line: `${words[left] ?? left} more point${left === 1 ? "" : "s"}` }, 3600);
    }
  }

  private beat() {
    const s = this.s;
    const n: Partial<DeviceState> = { tick: s.tick + 1 };
    const mode = this.effectiveMode();
    const now = this.now();
    if (mode === "disco" && s.tick % 8 === 7) n.discoBeat = s.discoBeat + 1;
    const entered = mode !== s.lastMode;
    if (entered) {
      n.lastMode = mode;
      n.lastAct = now;
      n.fxSeq = s.fxSeq + 1;
    }
    const idle = (now - s.lastAct) / 1000;
    if (!entered && QUIET.includes(mode) && idle > 75) {
      n.mode = "doze";
      n.preDoze = mode;
    }
    const leave = hhmmToMinutes(this.snap?.settings.leaveForSchool ?? "07:55");
    if (mode === "brief" && !this.isSchool() && !entered && idle > 40) {
      n.mode = "doze";
      n.preDoze = "standby";
    }
    if (mode === "brief" && this.isSchool() && this.minsOfDay() >= leave) {
      n.mode = "doze";
      n.preDoze = "standby";
    }
    if (mode === "breathe" && now - s.bT0 >= 67_000) this.exitBreathe();
    if (mode === "countdown") {
      if (s.countN <= 1) this.startCounted();
      else n.countN = s.countN - 1;
    }
    // Morning alarm on school days (never on lie-in days).
    const snap = this.snap;
    if (snap && s.power && !["alarm", "brief"].includes(mode) && !BUSY.includes(mode)) {
      const alarm = hhmmToMinutes(snap.settings.alarm);
      const m = this.minsOfDay();
      if (this.isSchool() && !snap.today.wokeAt && m >= alarm && m < alarm + 45 && !this.dismissedToday()) n.mode = "alarm";
    }
    // Pop-ups that come to you (Nudge Popups: "reward and progress", "time of day"). Never during a session.
    if (snap && s.power && !s.slab && !BUSY.includes(mode) && ["standby", "brief", "welcome", "select"].includes(mode)) this.gentleNudges(snap, mode);
    // Offline for 30s while idle: say so, once.
    if (this.offlineSince && Date.now() - this.offlineSince > 30_000 && mode === "standby") n.mode = "offline";
    this.set(n);
  }

  private dismissedToday(): boolean {
    return (globalThis.sessionStorage?.getItem("alarmDismissed") ?? "") === new Date(this.now()).toDateString();
  }

  /* ------------------------------- actions ------------------------------- */

  touch = () => {
    const s = this.s;
    this.sim.forced = null;
    this.set({ lastAct: this.now(), ...(s.mode === "doze" ? { mode: s.preDoze || "standby" } : {}) });
  };

  say(slab: Slab, ms = 4200) {
    // During a session a passive slab carries the countdown and leaves within three seconds.
    const v = this.snap?.session?.state === "running" ? this.view() : null;
    if (v && !slab.ask && !slab.wave && !slab.spin && !slab.tail) {
      slab = { ...slab, tail: mmss(v.remaining) };
      ms = Math.min(ms, 3000);
    }
    this.set({ slab });
    this.later("slab", ms, () => this.dropSlab());
  }
  dropSlab() {
    const sl = this.s.slab;
    if (!sl) return;
    this.set({ slab: { ...sl, leaving: true } });
    if (sl.reminderId) void this.client.send("POST", `/api/reminders/${sl.reminderId}/ack`).catch(() => {});
    this.later("slabOut", 420, () => this.set({ slab: null }));
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    try {
      return await this.client.send<T>(method, path, body);
    } catch (e) {
      if (e instanceof HubError) {
        const slab = (e.body as { slab?: Slab } | undefined)?.slab;
        this.say(slab ?? { icon: "block", line: e.message.slice(0, 40) }, 2600);
      }
      return null;
    }
  }

  private refresh() {
    void this.client.snapshot().catch(() => {});
  }

  turn = (d: 1 | -1) => {
    this.touch();
    const s = this.s;
    const mode = this.effectiveMode();
    const dial = s.dial + d * 26;
    if (mode === "bag") {
      const n = this.snap?.bag.length || 1;
      this.set({ bagIdx: (s.bagIdx + d + n) % n, dial });
      return;
    }
    if (["standby", "select", "reward"].includes(mode)) this.eggBump();
    if (!["standby", "select", "resume", "welcome", "brief", "reward"].includes(mode)) {
      this.set({ dial });
      return;
    }
    const open = this.open();
    if (open.length < 2) {
      this.set({ dial, mode: open.length ? "select" : mode });
      if (open.length === 1) this.say({ icon: "block", line: "last one left" }, 1800);
      return;
    }
    const at = Math.max(0, open.findIndex((t) => t.id === this.cur()?.id));
    const nextAt = (at + d + open.length) % open.length;
    this.set({
      sel: open[nextAt].id, dial, mode: "select",
      listTop: Math.max(0, Math.min(nextAt - 1, Math.max(0, open.length - 4))),
    });
    this.later("sel", 5000, () => this.s.mode === "select" && this.set({ mode: this.homeMode() }));
  };

  private eggBump() {
    const n = this.s.eggTurns + 1;
    if (n >= 8) {
      this.set({ eggTurns: 0, mode: "disco", discoBeat: 0 });
      return;
    }
    this.set({ eggTurns: n });
    this.later("egg", 1400, () => this.set({ eggTurns: 0 }));
  }

  /** Start the selected task: 3-2-1, then the session starts on the hub. */
  begin = () => {
    const mode = this.effectiveMode();
    if (["active", "countdown", "claim", "award", "break", "resumeScan", "update"].includes(mode)) return;
    if (mode === "paused") {
      void this.call("POST", "/api/session/resume").then(() => this.refresh());
      return;
    }
    const t = this.cur();
    if (!t) {
      this.say({ icon: "task_alt", line: "nothing left to do" }, 2600);
      return;
    }
    if (t.phase === "bag") {
      const bag = this.snap?.bag ?? [];
      this.set({ mode: "bag", bagIdx: Math.max(0, bag.findIndex((b) => !b.got && !b.kept)) });
      return;
    }
    if (this.dayKind() === "sick") {
      this.say({ icon: "sick", line: "resting today", sub: "TASKS ARE PAUSED" }, 2600);
      return;
    }
    this.set({ mode: "countdown", countN: 3, countTaskId: t.id });
  };

  private async startCounted() {
    const id = this.s.countTaskId ?? this.cur()?.id;
    this.set({ mode: "active", countTaskId: null, localBreakUntil: null });
    if (!id) return;
    const r = await this.call<{ firstStart: boolean; points: number }>("POST", "/api/session/start", { taskId: id });
    if (r?.firstStart && r.points > 0) this.say({ icon: "bolt", line: `+${r.points} for starting` }, 2200);
    if (!r) this.set({ mode: "standby" });
    this.refresh();
  }

  pressDial = () => {
    this.touch();
    const mode = this.effectiveMode();
    if (mode === "bag") return;
    if (mode === "alarm") return this.dismissAlarm();
    if (mode === "sleep" || mode === "night") return this.peekNow();
    if (mode === "break" || mode === "resumeScan") return this.resume();
    if (mode === "active" || mode === "overrun") return this.startBreathe();
    if (mode === "countdown" || mode === "paused") {
      const v = this.view();
      this.say({ icon: "timer", line: `${mmss(v?.remaining ?? 0)} left` }, 2600);
      return;
    }
    if (mode === "claim") return this.claim();
    this.begin();
  };

  private startBreathe() {
    void this.call("POST", "/api/session/pause").then(() => this.refresh());
    this.set({ mode: "breathe", bT0: this.now() + 3000 });
  }
  private exitBreathe() {
    this.set({ mode: "active" });
    void this.call("POST", "/api/session/resume").then(() => this.refresh());
  }

  resume = () => {
    const s = this.session();
    if (s && (s.state === "break" || s.state === "paused")) {
      this.set({ mode: "active" });
      void this.call("POST", "/api/session/resume").then(() => this.refresh());
      return;
    }
    this.set({ localBreakUntil: null });
    const t = this.cur();
    if (!t) return this.set({ mode: "standby" });
    this.set({ mode: "countdown", countN: 3, countTaskId: t.id });
  };

  dismissAlarm = () => {
    try {
      globalThis.sessionStorage?.setItem("alarmDismissed", new Date(this.now()).toDateString());
    } catch {
      /* private mode */
    }
    this.set({ mode: "brief", lastAct: this.now() });
    void this.call("POST", "/api/day/wake");
  };

  peekNow = () => {
    this.set({ peek: true });
    this.later("peek", 6000, () => this.set({ peek: false }));
  };

  pause = () => {
    const s = this.session();
    if (!s) return;
    void this.call("POST", s.state === "running" ? "/api/session/pause" : "/api/session/resume").then(() => this.refresh());
  };

  takeBreak = () => {
    const v = this.view();
    if (v) {
      const g = canBreak(v.worked);
      if (!g.ok) return this.say({ icon: g.icon, line: g.line }, 2600);
    }
    void this.call("POST", "/api/session/break").then(() => this.refresh());
  };

  switchTask = () => {
    void this.call<{ kept: number }>("POST", "/api/session/switch").then((r) => {
      if (r && r.kept > 30) this.say({ icon: "bookmark", line: `kept at ${mmss(r.kept)}`, sub: "PICK IT UP ANY TIME" }, 3000);
      this.refresh();
    });
    this.set({ mode: "select" });
  };

  claim = async () => {
    const mode = this.effectiveMode();
    if (mode !== "claim" && mode !== "overrun") return;
    const r = await this.call<{ awarded: number; bank: number; unlocked: boolean; allDone: boolean }>("POST", "/api/session/claim");
    if (!r) return;
    this.set({ mode: "award", awardPts: r.awarded, awardBank: r.bank });
    this.refresh();
    this.later("award", 1700, () => {
      if (r.unlocked) return this.set({ mode: "unlock" });
      const open = this.open();
      if (!open.length || r.allDone) {
        if (this.isSchoolTomorrowEvening()) {
          this.set({ mode: "standby" });
          this.say({ icon: "backpack", line: `${this.bagLeft()} books for tomorrow`, sub: "KEY 1 OPENS THE LIST" }, 4000);
          return;
        }
        return this.set({ mode: "standby" });
      }
      this.set({ mode: "break", sel: open[0].id, localBreakUntil: this.now() + LOCAL_BREAK_SEC * 1000 });
    });
  };

  private isSchoolTomorrowEvening(): boolean {
    return (this.snap?.tomorrow.kind ?? "") === "school" && this.minsOfDay() > 15 * 60;
  }
  bagLeft(): number {
    return (this.snap?.bag ?? []).filter((b) => !b.got && !b.kept).length;
  }

  skip = async () => {
    const t = this.cur();
    if (!t) return;
    const r = await this.call<{ left: number }>("POST", `/api/tasks/${t.id}/skip`);
    if (r) {
      this.say({ icon: "low_priority", line: "moved to the end" }, 2600);
      this.refresh();
    }
    this.set({ mode: "select", lastAct: this.now() });
  };

  confirmItem = async () => {
    const bag = this.snap?.bag ?? [];
    const item = bag[this.s.bagIdx];
    if (!item || item.got) {
      const j = bag.findIndex((b) => !b.got);
      if (j >= 0) this.set({ bagIdx: j });
      return;
    }
    const r = await this.call<{ allPacked: boolean; awarded: number }>("POST", `/api/bag/${item.id}/got`);
    if (!r) return;
    this.refresh();
    if (r.allPacked) {
      this.set({ mode: "award", awardPts: r.awarded || 3, awardBank: (this.snap?.bank ?? 0) + (r.awarded || 0) });
      this.later("award", 1700, () => this.set({ mode: "standby" }));
    } else {
      const next = bag.findIndex((b, i) => i !== this.s.bagIdx && !b.got && !b.kept);
      if (next >= 0) this.set({ bagIdx: next });
    }
  };

  bagMiss = async () => {
    const bag = this.snap?.bag ?? [];
    const item = bag[this.s.bagIdx];
    if (!item) return;
    await this.call("POST", `/api/bag/${item.id}/skip`);
    this.refresh();
    const n = bag.length;
    for (let k = 1; k <= n; k++) {
      const c = (this.s.bagIdx + k) % n;
      if (!bag[c].got && !bag[c].skipped && c !== this.s.bagIdx) return this.set({ bagIdx: c });
    }
  };

  /** Door / desk / morning tags. Unknown tags are remembered so the app can name them. */
  nfc(uid: string) {
    this.touch();
    const action = this.snap?.settings.nfcTags[uid];
    void this.call("POST", "/api/nfc/seen", { uid });
    if (!action) return this.say({ icon: "nfc", line: "new tag", sub: "NAME IT IN THE APP" }, 2600);
    const mode = this.effectiveMode();
    if (BUSY.includes(mode)) {
      const t = this.tasks().find((x) => x.id === this.session()?.taskId);
      const v = this.view();
      void t;
      return this.say({ icon: "timer", line: `still running, ${mmss(v?.remaining ?? 0)} left` }, 3000);
    }
    if (action === "home") return this.arrive();
    if (action === "desk") return this.begin();
    if (action === "morning") return this.set({ mode: "brief", lastAct: this.now() });
    if (action === "homework") return this.set({ mode: "select" });
    if (action === "bag") return this.set({ mode: "bag", bagIdx: Math.max(0, (this.snap?.bag ?? []).findIndex((b) => !b.got && !b.kept)) });
    if (action === "break") return this.say({ icon: "directions_walk", line: "move for 30 seconds", sub: this.cur() ? `NEXT: ${this.cur()!.name.toUpperCase()}` : undefined }, 4000);
  }

  arrive = async () => {
    const r = await this.call<{ already: boolean }>("POST", "/api/day/arrive");
    if (r?.already) return this.say({ icon: "home", line: "already back", sub: `${this.open().length} STILL TO DO` }, 3000);
    this.set({ mode: "welcome", lastAct: this.now() });
    this.refresh();
  };

  /* ------------------------------ assistant ------------------------------ */

  private askKinds = new Map<string, string>();

  wake = () => {
    this.touch();
    const snap = this.snap;
    if (!snap?.settings.ai) return this.say({ icon: "smart_toy", line: "assistant is off" }, 2400);
    if (!this.s.mic) return this.say({ icon: "mic_off", line: "mic is cut in hardware" }, 2600);
    const mode = this.effectiveMode();
    if (["unlock", "update", "boot"].includes(mode)) return;
    this.set({ listening: true, slab: { icon: "blur_on", line: "listening", wave: true } });
    // The mic streams for up to ~12 s; the hub answers with "checking" when they stop talking.
    this.later("slab", 14_000, () => {
      if (!this.s.listening) return;
      this.set({ listening: false });
      this.say({ icon: "help", line: "say that again?" }, 2600);
    });
  };

  heard(text: string) {
    const t = text.trim();
    if (!t) return;
    this.set({ listening: false });
    // "nudge, note: …" saves a note without stopping the clock
    const note = /^(?:note|take a note|remember)[:,]?\s+(.+)/i.exec(t);
    if (note) {
      void this.call("POST", "/api/notes", { kind: "note", label: note[1].slice(0, 60), body: note[1] }).then(() =>
        this.say({ icon: "graphic_eq", line: note[1].slice(0, 40), sub: "IN YOUR NOTES" }, 3000),
      );
      return;
    }
    this.say({ icon: "progress_activity", line: "checking", spin: true }, 30_000);
    void this.call<{ id: string }>("POST", "/api/agent/threads", { prompt: t, mode: "act" }).then((r) => {
      if (r) this.set({ agentThread: r.id });
    });
  }

  answerAsk = async (yes: boolean, held = false) => {
    const sl = this.s.slab;
    if (!sl?.askId) return;
    this.dropSlab();
    const r = await this.call("POST", `/api/asks/${sl.askId}/answer`, { yes, held });
    if (!r) {
      // Not accepted (too quick, or the hub was away): bring the question back after the error.
      this.s.shownAsks = this.s.shownAsks.filter((x) => x !== sl.askId);
      this.later("reask", 2400, () => this.refresh());
      return;
    }
    const kind = this.askKinds.get(sl.askId);
    const sub = kind === "email" ? "CHECK YOUR COMPUTER TO SEND" : kind === "build" ? "IT'LL APPEAR IN YOUR TOOLS TAB" : kind === "claude" ? "ON YOUR COMPUTER" : undefined;
    if (r && yes) this.say({ icon: "check_circle", line: kind === "build" ? "building it" : "done", sub }, 2600);
    this.refresh();
  };

  /* -------------------------------- keys --------------------------------- */

  /** The ask on the slab needs holding (email, app message, computer, paid build). */
  guardedAsk(): boolean {
    const sl = this.s.slab;
    return !!(sl?.ask && !sl.leaving && sl.askId && askNeedsHold({ kind: (this.askKinds.get(sl.askId) ?? "week") as Ask["kind"] }));
  }

  holdIdx(): number {
    if (this.guardedAsk()) return 3;
    const m = this.effectiveMode();
    return ["select", "standby", "bag"].includes(m) ? 2 : -1;
  }

  keyDown = (i: number) => {
    this.touch();
    const mode = this.effectiveMode();
    if (this.s.mode === "doze") return this.set({ mode: this.s.preDoze || "standby", lastAct: this.now() });
    if (!this.s.power || mode === "sleep" || mode === "night") return this.peekNow();
    if (mode === "alarm") return this.dismissAlarm();
    if (mode === "breathe") return this.exitBreathe();
    // First key after school on a school day counts as coming home.
    if (mode === "standby" && this.isSchool() && this.minsOfDay() >= 15 * 60 && this.snap && !this.snap.today.arrivedAt) {
      void this.arrive();
      return;
    }
    if (mode === "brief" && !this.isSchool() && this.snap && !this.snap.today.wokeAt) void this.call("POST", "/api/day/wake");
    this.set({ flash: i });
    this.later("flash" + i, 180, () => this.s.flash === i && this.set({ flash: -1 }));
    if (i !== this.holdIdx()) return this.fire(i);
    if (this.holdIv) clearInterval(this.holdIv);
    this.set({ holdKey: i, hold: 0 });
    const t0 = Date.now();
    const need = this.guardedAsk() ? HOLD_MS : 1000;
    this.holdIv = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / need);
      this.set({ hold: p });
      if (p >= 1) {
        if (this.holdIv) clearInterval(this.holdIv);
        this.set({ hold: 0, holdKey: -1 });
        this.fire(i, true);
      }
    }, 55);
  };

  keyUp = () => {
    if (this.holdIv) clearInterval(this.holdIv);
    if (this.s.holdKey >= 0) {
      // Let go too early on something that sends: say how, don't send.
      if (this.guardedAsk() && this.s.holdKey === 3 && this.s.hold < 1 && this.s.slab) this.set({ slab: { ...this.s.slab, sub: "HOLD YES UNTIL IT FILLS" } });
      this.set({ hold: 0, holdKey: -1 });
    }
  };

  fire(i: number, held = false) {
    if (held && i === 3 && this.guardedAsk()) return void this.answerAsk(true, true);
    if (this.s.armed) {
      this.set({ armed: false });
      if (i === 2) return this.set({ mode: "bright" });
      if (i === 3) return this.set({ mode: "about" });
      if (i === 0) return this.showPair();
    }
    const mode = this.effectiveMode();
    if (held && i === 2 && mode === "standby") {
      this.set({ armed: true });
      this.say({ icon: "tune", line: "settings", sub: "1 PAIR · 3 BRIGHTNESS · 4 ABOUT" }, 3000);
      this.later("arm", 3000, () => this.set({ armed: false }));
      return;
    }
    const k = this.plan(mode)[i];
    if (k) k.act();
  }

  pairRole: "owner" | "parent" = "owner";
  async showPair(role: "owner" | "parent" = "owner") {
    const r = await this.call<{ code: string }>("POST", "/api/pairing-codes", { role });
    this.pairRole = role;
    if (r) this.set({ mode: "pair", pairCode: r.code, lastAct: this.now() });
    this.later("pair", 10 * 60_000, () => this.s.mode === "pair" && this.set({ mode: "standby", pairCode: null }));
  }

  plan(m: Mode): Plan {
    const K = (label: string, act: () => void, tone?: Key["tone"]): Key => ({ label, act, tone });
    const home = () => this.set({ mode: "standby" });
    const sl = this.s.slab;
    if (sl?.ask && !sl.leaving) return [K("no", () => this.answerAsk(false)), null, null, this.guardedAsk() ? K("hold", () => {}, "live") : K("yes", () => this.answerAsk(true), "live")];
    switch (m) {
      case "standby":
        if (this.isSchoolTomorrowEvening() && !this.open().length && this.bagLeft()) {
          return [K("list", () => this.set({ mode: "bag", bagIdx: Math.max(0, (this.snap?.bag ?? []).findIndex((b) => !b.got && !b.kept)) }), "primary"), null, null, K("later", home)];
        }
        return [K("start", this.begin, "primary"), K("tasks", () => this.set({ mode: "select" })), null, K("reward", () => this.set({ mode: "reward" }))];
      case "about": return [K("pair", () => void this.showPair()), null, null, K("ok", home, "primary")];
      case "pair": return [
        this.pairRole === "parent" ? K("phone", () => void this.showPair("owner")) : null,
        this.pairRole === "owner" ? K("parent", () => void this.showPair("parent")) : null,
        null,
        K("done", () => this.set({ mode: "standby", pairCode: null }), "primary"),
      ];
      case "bright": return [
        K("dimmer", () => this.setBright(Math.max(0, this.s.bright - 1))),
        K("brighter", () => this.setBright(Math.min(4, this.s.bright + 1))),
        null,
        K("ok", home, "primary"),
      ];
      case "disco": return [null, null, null, K("stop", home)];
      case "welcome": return [K("start", this.begin, "live"), null, null, K("later", home)];
      case "brief": return this.isSchool() ? [null, null, null, K("ok", home)] : [K("start", this.begin, "primary"), K("tasks", () => this.set({ mode: "select" })), null, K("ok", home)];
      case "breathe": return [null, null, null, null];
      case "resume": return [K("start", this.resume, "primary"), null, null, K("switch", () => this.set({ mode: "select" }))];
      case "offline": return [K("retry", () => { this.refresh(); home(); }, "primary"), null, null, K("ok", home)];
      case "doze": return [null, null, null, null];
      case "select": return [K("start", this.begin, "live"), null, K("skip", this.skip), K("back", () => this.set({ mode: this.homeMode() }))];
      case "countdown": return [null, null, null, K("stop", () => this.set({ mode: "standby", countTaskId: null }))];
      case "active": return [null, K("pause", this.pause), K("break", this.takeBreak), K("switch", this.switchTask)];
      case "paused": return [K("resume", this.pause, "primary"), null, K("break", this.takeBreak), K("switch", this.switchTask)];
      case "break": return [K("resume", this.resume, "primary"), null, null, K("switch", () => this.set({ mode: "select", localBreakUntil: null }))];
      case "resumeScan": return [K("resume", this.resume, "live"), null, null, K("switch", () => this.set({ mode: "select", localBreakUntil: null }))];
      case "overrun": return [null, K("pause", this.pause), null, K("claim", this.claim, "live")];
      case "claim": return [null, null, null, K("claim", this.claim, "live")];
      case "bag": return [null, null, K("skip", this.bagMiss), K("got it", this.confirmItem, "primary")];
      case "reward": return [null, null, null, K("back", home, "primary")];
      case "unlock": return [null, null, null, K("next", () => this.set({ mode: "nextReward" }), "live")];
      case "nextReward": return [null, null, null, K("ok", () => { void this.call("POST", "/api/rewards/ack").then(() => this.refresh()); home(); }, "primary")];
      case "agent":
      case "agent2": return [null, null, null, K("stop", home)];
      case "alarm": return [null, null, null, K("up", this.dismissAlarm, "live")];
      default: return [null, null, null, null];
    }
  }

  setBright(b: number) {
    this.set({ bright: b });
    void this.call("PATCH", "/api/settings", { brightness: b });
  }

  /* -------------------------------- dev ---------------------------------- */

  /** Simulator: jump straight to a screen. */
  jump(m: Mode) {
    this.sim.forced = m;
    const p: Partial<DeviceState> = { mode: m, slab: null, peek: false };
    if (m === "breathe") p.bT0 = this.now();
    if (m === "countdown") {
      p.countN = 3;
      p.countTaskId = this.cur()?.id ?? null;
    }
    if (m === "break") p.localBreakUntil = this.now() + 208_000;
    if (m === "bag") p.bagIdx = Math.max(0, (this.snap?.bag ?? []).findIndex((b) => !b.got));
    this.set(p);
  }

  isoWeekdayNow(): number {
    return isoWeekday(new Date(this.now()));
  }
}
