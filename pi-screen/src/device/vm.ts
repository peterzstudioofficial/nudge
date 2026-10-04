import { hhmm, mmss, tint, SUBJECT_NAMES, DAY_SHORT, MONTH_SHORT, freeBy, hhmmToMinutes, type GlyphFrame, type LightMoment } from "@nudge/shared";
import type { Device } from "./device";
import { LOCAL_BREAK_SEC } from "./device";
import type { Mode } from "./types";

/**
 * Everything the Screen v2 template needs, computed from the device + hub snapshot.
 * A faithful port of `renderVals()` in "ND-1 Panel v2.dc.html".
 */

const PH = ["home", "study", "mine", "bag"] as const;
const ICON: Record<string, string> = {
  start: "play_arrow", resume: "play_arrow", pause: "pause", break: "coffee", switch: "swap_horiz", tasks: "list",
  skip: "keyboard_double_arrow_down", back: "arrow_back", stop: "close", claim: "check", "got it": "check", done: "check",
  ok: "check", up: "wb_sunny", next: "arrow_forward", reward: "redeem", later: "schedule", no: "close", yes: "check", hold: "touch_app",
  list: "backpack", pair: "qr_code_2", prev: "chevron_left", down: "keyboard_arrow_down", "+1 min": "more_time", cancel: "timer_off", hide: "visibility_off", parent: "family_restroom", phone: "smartphone", retry: "refresh", dimmer: "brightness_low", brighter: "brightness_high",
};

export interface Tab {
  l: string;
  bg: string;
  fg: string;
  r: string;
  ring: string;
  /** 0–1 while this key is being held down (hold-to-confirm) */
  fill?: number;
}

export interface LedCell {
  bg: string;
  o: number;
  anim: string;
  delay: string;
  glow: string;
}

/** One line on a card, wrapped on the wall (the font is monospaced, so this is exact). */
export interface CardLine {
  t: string;
  /** "1." or "•" on an item's first line */
  m?: string;
}
const CHAR_W = 6; // DM Mono at 10px
const LINE_H = 15;

export function wrap(text: string, cols: number, max = 400): CardLine[] {
  const out: CardLine[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    if (!para.trim()) {
      if (out.length && out[out.length - 1].t) out.push({ t: "" });
      continue;
    }
    let line = "";
    for (const word of para.trim().split(/\s+/)) {
      for (let w = word; w; ) {
        const room = cols - (line ? line.length + 1 : 0);
        if (w.length <= room) {
          line = line ? line + " " + w : w;
          w = "";
        } else if (!line && w.length > cols) {
          out.push({ t: w.slice(0, cols) });
          w = w.slice(cols);
        } else {
          out.push({ t: line });
          line = "";
        }
      }
    }
    if (line) out.push({ t: line });
    if (out.length >= max) break;
  }
  while (out.length && !out[out.length - 1].t) out.pop();
  return out.slice(0, max);
}

/** The card the assistant put up, laid out for this screen. */
function cardVm(d: Device, size: { w: number; h: number }) {
  const c = d.card();
  if (!c) return null;
  const cols = Math.max(24, Math.floor((size.w - 40) / CHAR_W));
  const view = Math.max(4, Math.floor((size.h - 26 - 30 - 44) / LINE_H));
  let lines: CardLine[] = [];
  if (c.kind === "text" || c.kind === "doc") lines = wrap(c.body, cols);
  if (c.kind === "list") {
    c.items.forEach((it, i) => {
      const m = c.ordered ? `${i + 1}.` : "•";
      wrap(it, cols - 3, 20).forEach((l, k) => lines.push({ t: l.t, m: k ? undefined : m }));
    });
  }
  const max = Math.max(0, lines.length - view);
  d.scrollMax = max;
  const top = Math.min(d.s.scroll, max);
  const now = d.hubNow();
  const left = c.kind === "timer" ? Math.max(0, Math.ceil((c.endsAt - now) / 1000)) : 0;
  return {
    kind: c.kind,
    icon: c.kind === "doc" ? (c.slides ? "slideshow" : "description") : c.kind === "list" ? "checklist" : c.kind === "info" ? c.icon : c.kind === "timer" ? "timer" : "notes",
    title: c.kind === "timer" ? c.label : c.title,
    meta: c.kind === "doc" ? `${c.slides ? "SLIDE" : "P."} ${c.page}/${c.pages}` : c.kind === "list" ? `${c.items.length} ${c.ordered ? "STEPS" : "ITEMS"}` : c.kind === "text" && c.src ? c.src : "",
    lines: lines.slice(top, top + view),
    view,
    /** scroll thumb: where it starts and how tall, as fractions */
    thumb: max ? { at: top / lines.length, len: view / lines.length } : null,
    big: c.kind === "info" ? c.big : c.kind === "timer" ? mmss(left) : "",
    sub: c.kind === "info" ? c.sub ?? "" : c.kind === "timer" ? (left ? `OF ${mmss(c.secs)}` : "DONE") : "",
    frac: c.kind === "timer" ? left / Math.max(1, c.secs) : c.kind === "doc" ? c.page / Math.max(1, c.pages) : 0,
  };
}

export function buildVm(d: Device, size: { w: number; h: number }) {
  const s = d.s;
  const snap = d.snap;
  const now = d.now();
  const date = new Date(now);
  const hour = date.getHours();
  const mins = hour * 60 + date.getMinutes();
  const settings = snap?.settings;
  const bedtime = settings ? hhmmToMinutes(settings.bedtime) : 23 * 60;
  const late = mins >= bedtime || hour < 6;
  let mode: Mode = d.effectiveMode();
  const raw = mode;
  if (s.power && late && settings?.dimAtNight !== false && !["alarm", "brief", "update", "pair"].includes(raw) && !["active", "paused", "claim", "overrun", "countdown", "breathe", "break"].includes(raw)) mode = "sleep";
  const off = !s.power;
  const working = ["active", "countdown", "overrun"].includes(mode);
  const mono = ["sleep", "night", "doze"].includes(mode);
  const onLight = ["claim", "award", "unlock"].includes(mode);
  const bElapsed = Math.floor((now - s.bT0) / 1000);
  const bPhase = Math.floor((Math.max(0, bElapsed) % 16) / 4);
  const bCycle = Math.min(4, Math.floor(Math.max(0, bElapsed) / 16));
  const accent = mono ? "#5f5f69" : "#ff4d17";
  const clock = hhmm(mins);
  const tasks = d.tasks();
  const t = d.cur();
  const openT = d.open();
  const doneN = tasks.filter((x) => x.done).length;
  const school = d.isSchool();
  const kind = d.dayKind();
  const sess = d.session();
  const v = d.view();
  const sessTask = sess ? tasks.find((x) => x.id === sess.taskId) ?? t : t;
  const shown = working || ["paused", "claim", "overrun", "break", "breathe", "resumeScan"].includes(mode) ? sessTask : t;

  const total = v ? sess!.totalSec : (shown?.mins ?? 25) * 60;
  const rem = v ? v.remaining : total - (shown?.spentSec ?? 0);
  const over = v ? v.overrun : 0;
  const breakLen = sess?.state === "break" ? (settings?.breakMins ?? 5) * 60 : LOCAL_BREAK_SEC;
  const brem = sess?.state === "break" ? v?.breakRemaining ?? 0 : s.localBreakUntil ? Math.max(0, Math.ceil((s.localBreakUntil - now) / 1000)) : breakLen;

  let hero = mmss(rem), heroLabel = "LEFT", heroFg = accent;
  if (mode === "paused") { heroLabel = "PAUSED, SAVED"; heroFg = "#55555f"; }
  if (mode === "overrun") { hero = mmss(over); heroLabel = "EXTRA"; }
  if (mode === "break") { hero = mmss(brem); heroLabel = "STAND UP, WALK"; heroFg = "#f4f3ef"; }
  const wallCard = d.card();
  const timerLeft = wallCard?.kind === "timer" ? Math.max(0, Math.ceil((wallCard.endsAt - d.hubNow()) / 1000)) : null;
  const frac = mode === "break" ? brem / Math.max(1, breakLen) : mode === "overrun" ? 0 : rem / Math.max(1, total);

  const phases = PH.map((id, i) => {
    const inP = tasks.filter((x) => x.phase === id);
    const dn = inP.filter((x) => x.done).length;
    const mine = shown?.phase === id;
    let pct = inP.length ? (dn / inP.length) * 100 : 0;
    if (mine && working && inP.length) pct = ((dn + (1 - frac)) / inP.length) * 100;
    return {
      flex: Math.max(1, inP.length),
      radius: i === 0 ? "6px 3px 3px 6px" : i === 3 ? "3px 6px 6px 3px" : "3px",
      track: mono ? "#141419" : "#1c1c23",
      fill: mine && !mono ? accent : mono ? "#32323b" : "#e0dcd4",
      pct: Math.min(100, pct) + "%",
    };
  });

  const plan = d.plan(mode);
  const tab = (i: number): Tab => {
    const k = plan[i];
    const askOwns = !!(s.slab?.ask && !s.slab.leaving);
    const ring = askOwns && k ? "inset 0 0 0 2px #f4f3ef" : "none";
    if (!k) return { l: "", bg: mode === "disco" ? "transparent" : onLight ? "#0b0b0d14" : "#101015", fg: "transparent", r: "4px 4px 0 0", ring };
    const flash = s.flash === i;
    const live = k.tone === "live", prim = k.tone === "primary";
    return {
      l: settings?.iconKeys ? ICON[k.label] || k.label : k.label,
      bg: onLight ? "#0b0b0d" : flash ? "#ffffff" : live ? accent : prim ? "#f4f3ef" : "#22222b",
      fg: onLight ? accent : flash ? "#0b0b0d" : live || prim ? "#0b0b0d" : "#b9b8b2",
      r: "13px 13px 0 0",
      ring,
      fill: s.holdKey === i ? s.hold : 0,
    };
  };

  // Morning brief timetable. School days: the real timetable with the current period lit.
  const periods = snap?.timetable ?? [];
  const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const dayStart = periods.length ? toMin(periods[0].start) : 9 * 60;
  const schedSrc = school && periods.length
    ? periods.map((p, i) => {
        // A lesson stays lit through the break/lunch after it, until the next one starts.
        const from = toMin(p.start);
        const to = i + 1 < periods.length ? toMin(periods[i + 1].start) : toMin(p.end);
        return { name: SUBJECT_NAMES[p.subject] ?? p.subject, tint: tint(p.subject), span: p.span, now: mins >= from && mins < to, free: false };
      })
    : weekendSched(openT.map((x) => ({ name: x.name, subject: x.subject })), mins);
  if (school && schedSrc.length && !schedSrc.some((x) => x.now) && mins < dayStart) schedSrc[0].now = true;
  const sched = schedSrc.map((x, i) => ({
    name: x.name,
    tint: x.now ? "#0b0b0d" : x.tint,
    flex: x.span,
    barH: x.span > 1 ? "22px" : "14px",
    size: x.now ? (x.name.length > 9 ? "11px" : "12px") : x.name.length > 9 ? "10px" : "11px",
    radius: i === 0 ? "10px 10px 5px 5px" : i === schedSrc.length - 1 ? "5px 5px 10px 10px" : "5px",
    bg: x.now ? accent : x.free ? "#0f0f14" : "#191920",
    fg: x.now ? "#0b0b0d" : x.free ? "#7a7a84" : "#dedad4",
    // the double-lesson mark only means something on a school day
    dbl: school && x.span > 1,
    dblC: x.now ? "#0b0b0d80" : "#4a4a54",
  }));

  const bag = snap?.bag ?? [];
  const reward = snap?.reward;
  const GOAL = reward?.goal ?? 60;
  const bank = mode === "award" ? s.awardBank : snap?.bank ?? 0;
  const bday = snap?.birthday;
  const wx = snap?.weather;
  const briefKind = school ? (snap?.today.week ? `SCHOOL · WK ${snap.today.week}` : "SCHOOL") : kind === "halfterm" ? "HALF TERM" : kind === "holiday" ? "HOLIDAY" : kind === "sick" ? "RESTING" : kind === "away" ? "AWAY" : snap?.today.lieIn ? "LIE IN" : "WEEKEND";
  const openMins = openT.reduce((a, x) => a + x.mins, 0);
  const listTop = Math.max(0, Math.min(Math.max(0, openT.findIndex((x) => x.id === t?.id)) - 1, Math.max(0, openT.length - 4)));
  const bagTop = Math.max(0, Math.min(s.bagIdx - 3, Math.max(0, bag.length - 4)));

  const vm = {
    w: size.w,
    h: size.h,
    mode,
    accent,
    clock,
    bg: onLight ? accent : "#000000",
    fg: onLight ? "#0b0b0d" : "#f4f3ef",
    mid: onLight ? "#0b0b0d" : "#c2c1bb",
    dim: mono ? "#43434c" : "#8e8e97",
    briefSubFg: "#b6b5af",
    newsFg: "#dedad4",
    fxOn: mode === "award" || mode === "unlock",
    fxKind: mode === "unlock" ? "unlock" : "award",
    fxKey: mode === "award" || mode === "unlock" ? mode + ":" + s.fxSeq : "",
    showHead: !["boot", "claim", "award", "unlock", "night", "sleep", "doze", "countdown", "update", "nextReward", "brief", "breathe", "alarm", "disco", "pair"].includes(mode),
    showStandby: mode === "standby",
    showAlarm: mode === "alarm",
    showWelcome: mode === "welcome",
    showBrief: mode === "brief",
    showList: mode === "select",
    showTimer: ["active", "paused", "overrun", "break"].includes(mode),
    showCount: mode === "countdown",
    showClaim: mode === "claim",
    showAward: mode === "award",
    showScan: mode === "resumeScan",
    showBag: mode === "bag",
    showReward: mode === "reward",
    showUnlock: mode === "unlock",
    showNext: mode === "nextReward",
    showAbout: mode === "about",
    showPair: mode === "pair",
    showBright: mode === "bright",
    showDisco: mode === "disco",
    showUpdate: mode === "update",
    showAlarmRing: mode === "alarm",
    showCard: mode === "show",
    card: mode === "show" ? cardVm(d, size) : null,
    showAgent: mode === "agent",
    showAgent2: mode === "agent2",
    showResume: mode === "resume",
    showOffline: mode === "offline",
    showBreatheIn: mode === "breathe" && bElapsed < 0,
    showBreathe: mode === "breathe" && bElapsed >= 0 && bCycle < 4,
    showBreatheEnd: mode === "breathe" && bCycle >= 4,
    showSleep: mode === "sleep" && !s.peek,
    showDoze: mode === "doze" && !s.peek,
    showDark: mode === "night" && !s.peek,
    showPeek: (mode === "sleep" || mode === "night") && s.peek,
    showBoot: mode === "boot",
    showBar: !["boot", "night", "sleep", "claim", "award", "unlock", "countdown", "alarm", "update", "reward", "nextReward", "breathe", "doze", "offline", "resume", "agent", "agent2", "welcome", "bag", "brief", "disco", "bright", "about", "pair", "show"].includes(mode),
    showTabs: !["boot", "night", "sleep", "doze", "update", "breathe"].includes(mode),

    unlockName: reward?.name ?? "cinema trip",
    unlockSub: "UNLOCKED",
    unlockIcon: reward?.icon ?? "redeem",
    nextName: snap?.nextReward?.name ?? reward?.name ?? "",
    nextGoal: (snap?.nextReward?.goal ?? GOAL) + " pt",
    nextIcon: snap?.nextReward?.icon ?? "redeem",
    offLine: "no wifi",
    offSub: "tasks still run, sync when it's back",
    pairCode: s.pairCode ? s.pairCode.slice(0, 3) + " " + s.pairCode.slice(3) : "··· ···",
    pairReady: !!s.pairCode,
    pairSub: d.pairRole === "parent" ? "SCAN WITH THE PARENT'S PHONE" : "SCAN WITH YOUR PHONE, OR TYPE IT IN THE APP",
    pairUrl: (s.pairBase ?? (typeof location !== "undefined" ? location.origin : "")).replace(/^https?:\/\//, ""),
    pairLink: s.pairLink,
    // QR as big as the screen allows; the code shrinks to fit beside it (Doto is ~0.62em per digit)
    pairQr: Math.round(Math.min(136, size.h - 86, size.w * 0.36)),
    pairFont: Math.round(Math.min(44, (size.w - 42 - (s.pairLink ? Math.min(136, size.h - 86, size.w * 0.36) : 0)) / (7 * 0.64))),

    aboutRows: [
      { k: "MODEL", v: "ND-1 rev C" },
      { k: "SOFTWARE", v: "nudge 0.1.0" },
      { k: "HUB", v: s.online ? "online" : "offline" },
      { k: "SCREEN", v: `${Math.round(size.w)}×${Math.round(size.h)} pt` },
      { k: "UPTIME", v: uptime(Date.now() - s.bootAt) },
      { k: "TERM", v: (snap?.termLabel ?? "—").toLowerCase() },
      { k: "SCHOOL", v: snap?.school.signedIn ? (snap.school.needsSignIn ? "sign in again" : "signed in") : "not signed in" },
      { k: "MIC", v: s.mic ? "on" : "hard off" },
      { k: "ASSISTANT", v: settings?.ai ? "on" : "off" },
      { k: "SYNC", v: snap ? ago(Date.now() - snap.sync.lastSync) : "never" },
    ],
    brightBars: [0, 1, 2, 3, 4].map((k) => ({
      h: 30 + k * 24 + "px",
      c: k <= s.bright ? accent : "#17171d",
      ico: k === 0 ? "bedtime" : k === 4 ? "light_mode" : "",
      icoC: k <= s.bright ? "#0b0b0d" : "#3d3d45",
    })),
    discoBeatS: (60 / (116 + ((s.tick >> 3) % 4) * 4)).toFixed(3) + "s",
    updLine: "updating",
    updPct: "34%",
    updSub: "KEEP IT ON THE WALL",
    rsTag: "PICKED UP WHERE YOU LEFT IT",
    rsName: sessTask?.name ?? t?.name ?? "",
    rsPct: sessTask ? Math.round((Math.min(sessTask.spentSec, sessTask.mins * 60) / (sessTask.mins * 60)) * 100) + "%" : "0%",
    rsLeft: mmss(v ? v.remaining : sessTask ? sessTask.mins * 60 - sessTask.spentSec : 0),

    breatheWord: ["breathe in", "hold", "breathe out", "hold"][bPhase],
    breatheFill: bPhase === 1 || bPhase === 2 ? "#ff4d1714" : "transparent",
    bCount: 4 - (Math.max(0, bElapsed) % 4),
    bCycles: Array.from({ length: 4 }, (_, k) => ({
      w: k < bCycle ? "26px" : k === bCycle ? "16px" : "10px",
      c: k < bCycle ? accent : k === bCycle ? "#4a4a54" : "#23232b",
    })),
    bInLine: String(Math.max(1, -bElapsed)),
    bInSub: "SETTLE IN",
    bEndLine: "back to it",
    bEndN: Math.max(1, 4 - (bElapsed - 64)),
    peekClock: clock,
    peekDate: `${DAY_SHORT[date.getDay()].toUpperCase()} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`,
    bootLetters: "nudge".split("").map((ch, i) => ({
      ch,
      anim: (i % 2 ? "sBDown" : "sBUp") + " 1.5s cubic-bezier(.24,1.3,.32,1) " + (i * 0.07).toFixed(2) + "s both",
    })),
    headClock: ["standby", "alarm"].includes(mode) ? "" : clock,
    tagline:
      mode === "show" ? (wallCard?.kind === "doc" ? "reading" : wallCard?.kind === "timer" ? "timer" : "on the wall")
        : mode === "standby" && timerLeft !== null ? `timer ${mmss(timerLeft)}`
        : mode === "welcome" ? "home" : ["agent", "agent2"].includes(mode) ? "working on it" : working ? "focus" : mode === "bag" ? "for tomorrow"
        : mode === "break" ? "break" : mode === "paused" ? "paused" : mode === "resumeScan" ? "waiting" : mode === "reward" ? "reward" : school ? "school day"
        : kind === "halfterm" ? "half term" : kind === "holiday" ? "holiday" : kind === "sick" ? "resting" : "weekend",
    pips: tasks.map((x, i) => ({
      r: i < doneN ? "50%" : "2px",
      f: i < doneN ? accent : "#f4f3ef",
      anim: i === doneN - 1 ? "sPipPop .5s cubic-bezier(.2,.9,.25,1) both" : "sPip .4s ease-out both " + (i * 0.04).toFixed(2) + "s",
    })),
    kFont: settings?.iconKeys ? "'Material Symbols Rounded'" : "'DM Mono', monospace",
    kSize: settings?.iconKeys ? "15px" : "8px",

    curName: shown?.name ?? "all done",
    curDur: shown ? shown.mins + "m" : "",
    curTint: tint(shown?.subject),
    curNote: shown && shown.spentSec > 30 && !shown.done ? Math.round((Math.min(shown.spentSec, shown.mins * 60) / (shown.mins * 60)) * 100) + "% kept" : "",

    hero: mode === "overrun" ? "+" + mmss(over) : hero,
    heroLabel: mode === "paused" ? "PAUSED" : mode === "overrun" ? "OVER" : heroLabel,
    heroFg: mode === "paused" ? "#6d6d77" : mode === "overrun" ? accent : mode === "active" ? "#f4f3ef" : heroFg,
    countN: s.countN,
    awardPts: "+" + s.awardPts,
    awardNote: "BANKED " + bank,
    claimSub: `+${settings?.pointsClaim ?? 3} POINTS`,
    chevrons: [{ d: "0s" }, { d: ".16s" }, { d: ".32s" }],
    alarmHint: "PRESS ANY KEY",

    wcHead: hour < 14 ? "back early" : hour < 17 ? "welcome home" : "long one today",
    wcName: settings?.ownerName ?? "",
    wcRows: [
      { icon: "task_alt", text: `${openT.length} tasks, ${Math.round((openMins / 60) * 10) / 10}h total`, iconFg: accent },
      { icon: "schedule", text: "free by " + hhmm(freeBy(mins + 25, openT)), iconFg: "#4f4f59" },
      { icon: "backpack", text: `${d.bagLeft()} books to pack later`, iconFg: "#4f4f59" },
    ],
    briefDay: DAY_SHORT[date.getDay()],
    briefNum: String(date.getDate()),
    briefMonShort: MONTH_SHORT[date.getMonth()],
    briefKind,
    wxIcon: wx?.icon ?? (school ? "cloud" : "wb_sunny"),
    wxTemp: wx ? wx.temp + "°" : "",
    wxShow: !!wx,
    schedW: Math.round(Math.max(104, Math.min(140, size.w * 0.3))),
    wxRain: wx?.rainAt ?? "",
    bdayIcon: "cake",
    bdayName: bday ? (bday.inDays === 0 ? `${bday.name}, today` : `${bday.name}, in ${bday.inDays} day${bday.inDays === 1 ? "" : "s"}`) : "",
    sched,
    heads: snap?.heads ?? "",
    // No headlines (or no internet): the card says something useful about today instead.
    news: snap?.news || briefFallback(snap, school, openT, mins),
    newsIcon: snap?.news ? "bolt" : "event_note",

    rowH: "32px",
    rowsY: -listTop * 36,
    rows: openT.map((o) => ({
      id: o.id,
      name: o.name,
      meta: o.mins + "m",
      tint: tint(o.subject),
      bg: o.id === t?.id ? "#f4f3ef" : "transparent",
      fg: o.id === t?.id ? "#0b0b0d" : "#9a9aa3",
      metaFg: o.id === t?.id ? "#55555d" : "#4d4d56",
      note: o.spentSec > 30 ? Math.round((Math.min(o.spentSec, o.mins * 60) / (o.mins * 60)) * 100) + "% kept" : "",
      noteBg: o.id === t?.id ? "#0b0b0d14" : "#1e1e26",
      noteFg: o.id === t?.id ? "#55555d" : "#8e8e97",
      progW: Math.min(100, (o.spentSec / (o.mins * 60)) * 100) + "%",
      progC: o.id === t?.id ? "#0b0b0d" : accent,
    })),
    listRail: openT.length > 4,
    listRailH: Math.round((4 / Math.max(4, openT.length)) * 100) + "%",
    listRailY: Math.round((listTop / Math.max(1, openT.length)) * 100) + "%",

    scanLine: "press the dial",
    scanSub: "BREAK IS OVER",
    bagRowH: "31px",
    bagY: -bagTop * 34,
    bagRows: bag.map((b, i) => {
      const on = i === s.bagIdx;
      const inBag = b.got || b.kept;
      return {
        id: b.id,
        name: b.name,
        tint: b.kept ? "#4a4a54" : tint(b.subject),
        radius: i === 0 ? "11px 11px 5px 5px" : i === bag.length - 1 ? "5px 5px 11px 11px" : "5px",
        bg: on ? "#26262f" : inBag ? "#131318" : "#0f0f14",
        ring: inBag ? accent : on ? "#f4f3ef" : "#4a4a54",
        fill: inBag ? accent : "transparent",
        ticked: inBag,
        fg: b.skipped ? "#6d6d77" : inBag ? "#9a9aa3" : "#ffffff",
        strike: b.skipped ? "line-through" : "none",
        note: b.note || "",
        noteBg: inBag ? "#26262e" : accent,
        noteFg: inBag ? "#b6b5af" : "#0b0b0d",
        stateIcon: b.kept ? "backpack" : b.skipped ? "remove_circle_outline" : on ? "chevron_right" : "",
        stateFg: b.kept ? "#8e8e97" : b.skipped ? "#6d6d77" : accent,
      };
    }),
    bagRail: bag.length > 6,
    bagRailH: Math.round((6 / Math.max(6, bag.length)) * 100) + "%",
    bagRailY: Math.round((s.bagIdx / Math.max(1, bag.length)) * 100) + "%",

    rwNow: bank,
    rwOf: "/ " + GOAL,
    rwName: reward?.name ?? "",
    rwLeft: Math.max(0, GOAL - bank) + " TO GO",
    rwRing: Array.from({ length: Math.min(GOAL, 90) }, (_, i) => {
      const n = Math.min(GOAL, 90);
      const a = i * 2.39996;
      const r = 7 + Math.sqrt(i + 1) * 10.2 * Math.sqrt(60 / n);
      const lit = i < Math.round((bank / GOAL) * n);
      const sz = lit ? 6 + (i / n) * 6 : 4;
      return {
        x: (74 + Math.cos(a) * r - sz / 2).toFixed(1) + "px",
        y: (74 + Math.sin(a) * r - sz / 2).toFixed(1) + "px",
        sz: sz.toFixed(1) + "px",
        c: lit ? (i % 9 === 4 ? "#f4f3ef" : accent) : "#2a2a33",
        anim: i === Math.round((bank / GOAL) * n) - 1 ? "sNow 1.8s ease-in-out infinite" : "none",
        d: (i * 0.022).toFixed(3) + "s",
      };
    }),

    sleepLine: hour >= 23 || hour < 3 ? "go to bed" : "wind down",
    ringBars: Array.from({ length: 16 }, (_, i) => {
      const on = i < Math.ceil(frac * 16);
      const lead = i === Math.ceil(frac * 16) - 1;
      return { a: (i / 16) * 360 + "deg", h: on ? (lead ? "15px" : "11px") : "6px", c: on ? heroFg : mono ? "#20202a" : "#2a2a34" };
    }),

    jobIcon: "send",
    jobNow: "emailing mr hale about the deadline",
    jobPct: "64%",
    jobStep: "STEP 2 OF 3",
    jobQueue: [
      { name: "friday revision plan", icon: "edit_note", iconFg: accent, fg: "#ffffff", ruleC: accent, meta: "NEXT", metaFg: accent },
      { name: "chemistry deadline", icon: "check", iconFg: "#8e8e97", fg: "#b6b5af", ruleC: "#26262e", meta: "DONE", metaFg: "#6d6d77" },
    ],
    ...agentVm(s.agentInfo, now, accent),

    slab: s.slab,
    slabAnim: s.slab?.leaving ? "sLift .4s cubic-bezier(.5,0,.75,0) both" : "sDrop .52s cubic-bezier(.32,.72,0,1) both",
    phases,
    tabs: [tab(0), tab(1), tab(2), tab(3)],
  };

  /* ------------------------------- LED matrix ------------------------------ */
  let pat = "off";
  if (mode === "unlock") pat = "sparkle";
  else if (mode === "claim" || mode === "award") pat = "burst";
  else if (mode === "bag") pat = "bag";
  else if (mode === "countdown") pat = "flood";
  else if (mode === "resumeScan") pat = "count";
  else if (mode === "alarm") pat = "alarm";
  else if (mode === "update") pat = "sweep";
  else if (mode === "breathe") pat = "breathe";
  else if (mode === "disco") pat = "disco";
  else if (mode === "bright") pat = "bright";
  else if (mode === "doze" || mode === "standby") pat = "idle";
  else if (s.slab && !s.slab.leaving) pat = s.slab.ask ? "listen" : "voice";
  else if (working) pat = "fill";
  else if (mode === "show") pat = wallCard?.kind === "timer" ? "timer" : wallCard?.kind === "doc" ? "page" : "idle";
  const SIDE = 5;
  const leds: LedCell[] = Array.from({ length: 25 }, (_, i) => {
    const col = i % SIDE, row = Math.floor(i / SIDE);
    const dead: LedCell = { bg: "#d2d0c8", o: 1, anim: "none", delay: "0s", glow: "inset 0 2px 4px #00000026" };
    if (mono || off) return dead;
    const on = (o: number, anim?: string, delay?: string): LedCell => ({ bg: "#ff4d17", o, anim: anim || "none", delay: delay || "0s", glow: "0 0 20px 3px #ff4d1773,inset 0 1px 2px #ffffff59" });
    const white = (o: number): LedCell => ({ bg: "#f4f3ef", o, anim: "none", delay: "0s", glow: "0 0 16px 3px #ffffff80,inset 0 1px 2px #ffffff" });
    const ring = Math.max(Math.abs(col - 2), Math.abs(row - 2));
    switch (pat) {
      case "fill": {
        const edge = Math.max(0, Math.ceil(frac * SIDE) - 1);
        if (col !== edge) return dead;
        return { bg: "#ff4d17", o: 0.55, anim: "lDrift 6s ease-in-out infinite", delay: (row * 0.09).toFixed(2) + "s", glow: "0 0 12px 2px #ff4d1755" };
      }
      case "burst": {
        const phase = Math.floor(s.tick / 2) % 4;
        const show = phase === 0 ? ring < 1.6 : phase === 1 ? ring < 2.6 : phase === 2 ? ring < 3.6 : ring > 2.4;
        return show ? on(1, "lSpark 1.1s ease-in-out infinite", (ring * 0.11).toFixed(2) + "s") : dead;
      }
      case "bag": {
        const got = bag.filter((b) => b.got).length;
        const lit = Math.round((got / Math.max(1, bag.length)) * SIDE);
        if (row >= SIDE - lit) return white(0.85);
        if (row === SIDE - lit - 1) return on(1, "lPulse 2.2s ease-in-out infinite");
        return dead;
      }
      case "flood":
        return on(1, "lRise .55s cubic-bezier(.3,0,.3,1) both, lPulse 1.6s ease-in-out .55s infinite", ((col + row) * 0.045).toFixed(2) + "s");
      case "sparkle": {
        const seed = (col * 7 + row * 13) % 11;
        return seed < 5 ? on(1, "lSpark " + (1.1 + seed * 0.18).toFixed(2) + "s ease-in-out infinite", (seed * 0.16).toFixed(2) + "s") : { ...dead, bg: "#ff4d17", o: 0.1, glow: "none" };
      }
      case "alarm": {
        const diag = (col + row) / (SIDE * 2 - 2);
        const warm = (row + Math.floor(s.tick / 2)) % 2 === 0;
        return { bg: warm ? "#ff4d17" : "#f4f3ef", o: 1, anim: "lAlarm .85s cubic-bezier(.35,0,.4,1) infinite", delay: (diag * 0.7).toFixed(2) + "s", glow: "0 0 18px 3px #ff4d1766" };
      }
      case "voice": {
        const h = [3, 6, 8, 5, 7][col];
        const lit = (s.tick + col) % 3 === 0 ? h : Math.max(2, h - 2);
        return row >= SIDE - lit ? on(1, "lSpark .5s ease-in-out infinite", (col * 0.05).toFixed(2) + "s") : dead;
      }
      case "listen":
        return ring > 2.4 ? on(1, "lPulse 1.4s ease-in-out infinite", (col * 0.05).toFixed(2) + "s") : dead;
      case "breathe":
        return { bg: "#ff4d17", o: 0.9, anim: "lBreathe 16s cubic-bezier(.42,0,.58,1) infinite", delay: (ring * 0.42).toFixed(2) + "s", glow: "0 0 14px 2px #ff4d1755" };
      case "sweep":
        return row === 3 || row === 4 ? on(1, "lSpark 1.8s ease-in-out infinite", (col * 0.11).toFixed(2) + "s") : dead;
      case "idle":
        return col === 0 && row === SIDE - 1 ? { bg: "#ff4d17", o: 1, anim: "lDrift 7s ease-in-out infinite", delay: "0s", glow: "0 0 12px 2px #ff4d1755" } : dead;
      case "disco": {
        const beat = (s.tick + s.discoBeat) % 4;
        const hit = beat === 0 ? ring === 0 : beat === 1 ? ring === 1 : beat === 2 ? ring === 2 : (col + row) % 2 === 0;
        if (!hit) return dead;
        const warm = (col * 3 + row * 5 + s.discoBeat) % 3 === 0;
        return { bg: warm ? "#f4f3ef" : "#ff4d17", o: 1, anim: "lSpark .34s ease-in-out infinite", delay: (ring * 0.05).toFixed(2) + "s", glow: "0 0 22px 5px " + (warm ? "#ffffff8c" : "#ff4d1799") };
      }
      case "bright":
        return row >= SIDE - 1 - s.bright ? on(0.25 + s.bright * 0.18) : dead;
      case "timer": {
        // one cell per 4% left, read like a page (still: it only changes when a cell runs out)
        const left = Math.ceil((timerLeft ?? 0) / Math.max(1, wallCard?.kind === "timer" ? wallCard.secs : 1) * 25);
        return i < left ? on(i === left - 1 ? 0.45 : 0.85) : dead;
      }
      case "page": {
        const p = wallCard?.kind === "doc" ? Math.ceil((wallCard.page / Math.max(1, wallCard.pages)) * SIDE) : 0;
        return row === SIDE - 1 && col < p ? white(0.5) : dead;
      }
      case "count":
        return ring < 1.6 ? on(1, "lPulse 1s ease-in-out infinite") : dead;
      default:
        return dead;
    }
  });

  // A glyph from a pack (or one the assistant is playing) takes the matrix over: never during focus,
  // never at night. The Pi animates it by itself.
  const MOMENT: Record<string, LightMoment> = { idle: "idle", burst: "award", sparkle: "unlock", listen: "listen", voice: "voice", alarm: "alarm", bag: "bag", timer: "timer" };
  const focus = working || ["breathe", "paused", "overrun", "break", "resumeScan"].includes(mode);
  const playing = snap?.lights?.playing && snap.lights.playing.until > d.hubNow() ? snap.lights.playing : null;
  let glyph: GlyphFrame | null = null;
  let glyphName = "";
  if (!mono && !off && !focus) {
    if (playing) [glyph, glyphName] = [playing.glyph, playing.name];
    else if (MOMENT[pat] && snap?.lights?.moments[MOMENT[pat]]) [glyph, glyphName] = [snap.lights.moments[MOMENT[pat]]!, "moment:" + MOMENT[pat]];
  }
  const barPctN = pat === "timer" && wallCard?.kind === "timer" ? Math.round(((timerLeft ?? 0) / Math.max(1, wallCard.secs)) * 100) : working ? Math.round(frac * 100) : mode === "countdown" ? 100 : onLight ? 100 : 0;
  const panel = {
    leds,
    pat,
    ledLabel: pat === "fill" ? "TIME LEFT" : pat === "bag" ? "PACKED" : "",
    barLit: mono || off ? 0 : mode === "disco" ? 0.6 : mode === "bright" ? 0.12 + s.bright * 0.18 : 0.1,
    barOn: ["sleep", "doze"].includes(mode) || off ? 0 : 1,
    barPct: barPctN,
    dialLed: working ? 1 : ["select", "bag"].includes(mode) ? 0.7 : mono ? 0.05 : 0.18,
    touchRing: ["agent", "agent2"].includes(mode) || !!s.slab?.wave,
    holdKey: s.holdKey,
    hold: s.hold,
    plan: plan.map((k) => !!k),
    glyph,
    glyphName,
    /** overall LED brightness: the wall's brightness setting, and very low at night */
    level: mono ? 0.08 : [0.18, 0.35, 0.6, 0.8, 1][s.bright] ?? 0.6,
  };
  return { vm, panel };
}

export type Vm = ReturnType<typeof buildVm>["vm"];
export type Panel = ReturnType<typeof buildVm>["panel"];

function weekendSched(open: { name: string; subject: string }[], mins: number) {
  const out: { name: string; tint: string; span: number; now: boolean; free: boolean }[] = [];
  const list = open.slice(0, 3);
  out.push({ name: "free", tint: "#2a2a33", span: 2, now: !list.length || mins < 10 * 60, free: true });
  list.forEach((t, i) => out.push({ name: t.name, tint: tint(t.subject), span: 2, now: i === 0 && mins >= 10 * 60, free: false }));
  if (out.length < 4) out.push({ name: "free", tint: "#2a2a33", span: 2, now: false, free: true });
  return out;
}

/** What the assistant is doing with the wall's question, from its real steps. */
function agentVm(info: Device["s"]["agentInfo"], now: number, accent: string) {
  if (!info) return { agentElapsed: "0:00", agentTask: "", agentSteps: [] as { icon: string; text: string; iconFg: string; fg: string; ruleC: string }[] };
  const steps = info.steps.length ? info.steps : [{ text: "thinking", done: false }];
  return {
    agentElapsed: mmss(Math.max(0, Math.floor((now - info.t0) / 1000))),
    agentTask: info.prompt.replace(/^(hey |ok )?nudge[,!]?\s*/i, "").toLowerCase().slice(0, 70),
    agentSteps: steps.map((x, i) => {
      const live = !x.done && i === steps.length - 1;
      return { icon: x.done ? "check" : live ? "progress_activity" : "schedule", text: x.text.toLowerCase().slice(0, 40), iconFg: live ? accent : "#8e8e97", fg: live ? "#ffffff" : "#b6b5af", ruleC: live ? accent : "#26262e" };
    }),
  };
}

function briefFallback(snap: Device["snap"], school: boolean, open: { name: string; mins: number }[], mins: number): string {
  if (!snap) return "";
  if (school) {
    const next = snap.timetable.find((l) => hhmmToMinutes(l.start) > mins);
    if (next) return `first up: ${(SUBJECT_NAMES[next.subject] ?? next.subject).toLowerCase()} at ${next.start}${next.room ? `, ${next.room}` : ""}.`;
  }
  const ev = snap.activities[0];
  if (ev) return `${ev.name.toLowerCase()} today${ev.start ? ` at ${ev.start}` : ""}.`;
  if (open.length) return `${open.length} thing${open.length === 1 ? "" : "s"} to do, about ${Math.max(1, Math.round(open.reduce((a, x) => a + x.mins, 0) / 6) / 10)}h. first: ${open[0].name.toLowerCase()}.`;
  return "nothing planned. enjoy it.";
}

function uptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
}
function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}
