import { useEffect, useMemo, useRef, useState } from "react";
import { glyphOn, setGlyphOn, useGlyphs, useGlyphSupport } from "../lib/glyph";
import {
  addDays, dateKey, DAY_SHORT, hhmm, MONTH_LONG, MONTH_SHORT, parseDateKey, tint, type Snapshot, type DayState, type Task,
  type Settings, type CalEvent, type Birthday, SUBJECT_NAMES, dueLabel, relativeDay,
} from "@nudge/shared";
import { getClient, savePairing, useHubGet, useSnapshot } from "../lib/hub";
import { D, DOTO, Ms, Sheet, haptic, inputStyle, toast, toastError } from "../lib/ui";
import { native } from "../lib/native";
import { PhoneLock, togglePhoneLock, usePhoneLock } from "./PhoneLock";
import { ToolsTab } from "./ToolsTab";
import { AskCard } from "./AskCard";
import { BrainSheet } from "./Brain";
import { LibrarySheet } from "./Library";
import { LightsSheet } from "./Lights";
import { setThemePref, themePref, type ThemePref } from "../lib/theme";

/** "my app — plan and look, nothing else." From "Nudge Apps.dc.html". */

type Tab = "today" | "plan" | "tools" | "sick" | "settings";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "today", icon: "checklist", label: "today" },
  { id: "plan", icon: "calendar_month", label: "plan" },
  { id: "tools", icon: "apps", label: "tools" },
  { id: "sick", icon: "sick", label: "unwell" },
  { id: "settings", icon: "settings", label: "settings" },
];
const ORDER = TABS.map((t) => t.id);
const SEG = 38;

export function MyApp({ onUnpair }: { onUnpair: () => void }) {
  const client = getClient("owner")!;
  const { snap, online } = useSnapshot(client);
  const [locked, hideLock] = usePhoneLock(snap);
  const [tab, setTab] = useState<Tab>("today");
  const [prev, setPrev] = useState<Tab>("today");
  const [scrolled, setScrolled] = useState(false);
  const i = ORDER.indexOf(tab);
  const fwd = i >= ORDER.indexOf(prev);
  const seg = window.innerWidth < 380 ? 33 : SEG;
  const show = (t: Tab, from: Tab) => {
    if (t === from) return;
    setPrev(from);
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const go = (t: Tab) => {
    if (t === tab) return void window.scrollTo({ top: 0, behavior: "smooth" });
    haptic();
    // Other tabs sit one step "in" from today, so the phone's back gesture comes home first.
    if (t === "today" && history.state?.tab) return void history.back();
    if (tab === "today") history.pushState({ ...(history.state ?? {}), tab: t }, "");
    else history.replaceState({ ...(history.state ?? {}), tab: t }, "");
    show(t, tab);
  };
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    const on = (e: PopStateEvent) => show(((e.state as { tab?: Tab } | null)?.tab) ?? "today", tabRef.current);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The Glyph lights on the back of a Nothing phone follow the session (nothing on other phones).
  const glyph = useGlyphSupport();
  useGlyphs(glyph?.supported ? snap : null, glyph?.zones ?? 0);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 6);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const day = snap ? parseDateKey(snap.today.date) : new Date();
  const title =
    tab === "today" ? DAY_SHORT[day.getDay()] : tab === "sick" ? (snap?.today.sick ? "resting" : "not well?") : TABS[i].label;
  const sub = tab === "today" && snap ? `${day.getDate()} ${MONTH_SHORT[day.getMonth()]} · ${snap.today.kind === "school" && snap.today.week ? `WEEK ${snap.today.week}` : kindLabel(snap.today)}` : "";
  // Little dots on the icons when something's waiting there.
  const badge: Partial<Record<Tab, boolean>> = snap
    ? { today: snap.asks.some((a) => a.kind !== "build"), tools: snap.asks.some((a) => a.kind === "build") || snap.jobs.some((j) => j.status === "done" && Date.now() - j.updatedAt < 3600_000) }
    : {};
  const status = !online ? { c: "var(--c-5f5f67)", anim: "aBreath 2.4s ease-in-out infinite", tip: "the wall is offline — showing what it last said" } : snap?.session ? { c: "var(--c-ff4d17)", anim: "aBreath 2s ease-in-out infinite", tip: "focus session on the wall" } : { c: "var(--c-ff4d17)", anim: "none", tip: "connected to the wall" };

  return (
    <div className="page" style={{ background: "var(--c-0a0a0c)", paddingBottom: 40 }}>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 30, padding: "calc(env(safe-area-inset-top, 0px) + 14px) 18px 12px",
          background: scrolled ? "var(--c-0a0a0cd9)" : "var(--c-0a0a0c)", backdropFilter: scrolled ? "blur(18px) saturate(1.4)" : "none", WebkitBackdropFilter: scrolled ? "blur(18px) saturate(1.4)" : "none",
          boxShadow: scrolled ? "0 1px 0 var(--c-1c1c23)" : "none", transition: "background-color .3s ease, box-shadow .3s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span key={title} style={{ fontFamily: D, fontSize: scrolled ? 26 : "clamp(27px, 9vw, 38px)", lineHeight: 0.82, letterSpacing: -1, whiteSpace: "nowrap", animation: "aSwap .38s cubic-bezier(.32,.72,0,1) both", transition: "font-size .35s cubic-bezier(.32,.72,0,1)" }}>{title}</span>
              <span title={status.tip} onClick={() => toast(online ? "sensors" : "wifi_off", status.tip)} style={{ width: 7, height: 7, marginTop: 1, borderRadius: "50%", flex: "none", background: status.c, animation: status.anim, cursor: "pointer" }} />
            </div>
            {sub && !scrolled && <span style={{ fontSize: 8, letterSpacing: ".2em", color: "var(--c-8e8e97)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "aFade .3s ease-out" }}>{sub}</span>}
          </div>
          <nav aria-label="sections" style={{ position: "relative", flex: "none", display: "flex", padding: 3, borderRadius: 22, background: "var(--c-13131a)", boxShadow: "inset 0 0 0 1px var(--c-1c1c23)" }}>
            <span style={{ position: "absolute", top: 3, left: 3, width: seg, height: seg - 2, borderRadius: 19, background: "var(--c-ff4d17)", transform: `translateX(${i * seg}px)`, transition: `transform ${fwd ? ".5s" : ".42s"} cubic-bezier(.32,.72,0,1)` }} />
            {TABS.map((t) => (
              <button key={t.id} aria-label={t.label} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)} className="tap" style={{ position: "relative", width: seg, height: seg - 2, border: 0, padding: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Ms style={{ fontSize: 17, color: tab === t.id ? "var(--c-0b0b0d)" : "var(--c-8e8e97)", transition: "color .35s" }}>{t.icon}</Ms>
                {badge[t.id] && tab !== t.id && <span style={{ position: "absolute", top: 6, right: 8, width: 5, height: 5, borderRadius: "50%", background: "var(--c-ff4d17)", animation: "cPop .4s cubic-bezier(.2,1.4,.4,1)" }} />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div key={tab} style={{ paddingTop: 6, animation: `${fwd ? "aSlide" : "aSlideL"} .32s cubic-bezier(.32,.72,0,1) both` }}>
        {!snap && <div style={{ padding: "40px 22px", fontSize: 11, color: "var(--c-8e8e97)" }}>connecting to the wall…</div>}
        {snap && tab === "today" && <Today snap={snap} />}
        {snap && tab === "plan" && <Plan />}
        {snap && tab === "tools" && <ToolsTab snap={snap} />}
        {snap && tab === "sick" && <Sick snap={snap} />}
        {snap && tab === "settings" && <SettingsTab snap={snap} onUnpair={onUnpair} />}
      </div>
      {snap && locked && <PhoneLock snap={snap} onHide={hideLock} />}
    </div>
  );
}

/* --------------------------------- today --------------------------------- */

function Today({ snap }: { snap: Snapshot }) {
  const client = getClient("owner")!;
  const notSet = async (id: string, name: string) => {
    if (!confirm(`No ${name.toLowerCase()} was set? It'll be removed (doesn't use a skip).`)) return;
    try {
      await client.send("POST", `/api/tasks/${id}/notset`);
      toast("check_circle", "removed");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const tasks = snap.tasks;
  const done = tasks.filter((t) => t.done).length;
  const rows = useMemo(() => timeline(snap), [snap]);
  const bagLeft = snap.bag.filter((b) => !b.got && !b.kept).length;
  const evening = new Date().getHours() >= 17;
  const pct = Math.min(100, Math.round((snap.bank / Math.max(1, snap.reward.goal)) * 100));
  return (
    <div style={{ padding: "0 18px" }}>
      {tasks.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 3, flex: 1, flexWrap: "wrap" }}>
            {tasks.map((t, k) => (
              <span key={t.id} style={{ width: 7, height: 7, borderRadius: k < done ? "50%" : 2, background: k < done ? "var(--c-ff4d17)" : "var(--c-2a2a33)", transition: "border-radius .4s cubic-bezier(.4,0,.2,1),background-color .4s ease" }} />
            ))}
          </div>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 24, lineHeight: 0.9, color: "var(--c-ff4d17)" }}>{done}/{tasks.length}</span>
        </div>
      )}

      {snap.asks.filter((a) => a.kind !== "build").map((a) => <AskCard key={a.id} a={a} />)}

      <UpNext snap={snap} />

      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 18 }}>
        {rows.length === 0 && <span style={{ fontSize: 11, color: "var(--c-8e8e97)", padding: "14px 2px" }}>nothing set for today{snap.today.kind === "sick" ? " — rest up" : ""}.</span>}
        {rows.map((t, k) => (
          <div key={t.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, height: t.now ? 52 : 42, padding: "0 13px", borderRadius: t.now ? 14 : k === 0 ? "12px 12px 5px 5px" : k === rows.length - 1 ? "5px 5px 12px 12px" : 5, overflow: "hidden", background: t.now ? "var(--c-1e1e26)" : "var(--c-13131a)", transition: "background-color .4s ease, height .4s cubic-bezier(.32,.72,0,1)" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: t.done ? "var(--c-2a2a33)" : tint(t.subject) }} />
            <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, flex: "none", width: 36, paddingLeft: 5, color: t.now ? "var(--c-ff4d17)" : "var(--c-6d6d77)" }}>{t.time}</span>
            <span style={{ fontSize: 12, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: t.done ? "var(--c-6d6d77)" : t.now ? "var(--c-ffffff)" : "var(--c-dedad4)", textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
            {t.due && !t.done && !t.now && <span style={{ fontSize: 8, letterSpacing: ".1em", color: "var(--c-8e8e97)", flex: "none" }}>{t.due.toUpperCase()}</span>}
            {t.expected && !t.done && !t.now && (
              <span className="tap" aria-label="homework wasn't set?" onClick={() => void notSet(t.id, t.name)} style={{ flex: "none", display: "flex" }}>
                <Ms style={{ fontSize: 15, color: "var(--c-5f5f67)" }}>help</Ms>
              </span>
            )}
            {t.now && t.left && <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 12, color: "var(--c-ff4d17)" }}>{t.left}</span>}
            {(t.done || t.now) && <Ms style={{ fontSize: 15, flex: "none", color: t.done ? "var(--c-5f5f67)" : "var(--c-ff4d17)" }}>{t.done ? "check" : "play_arrow"}</Ms>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 9, letterSpacing: ".12em", color: "var(--c-6d6d77)" }}>
        <span style={{ whiteSpace: "nowrap" }}>{snap.bank}/{snap.reward.goal} · {snap.reward.name.toUpperCase()}</span>
        <span style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--c-1c1c23)", overflow: "hidden" }}>
          <span style={{ display: "block", height: 3, width: pct + "%", borderRadius: 2, background: "var(--c-ff4d17)", transition: "width .8s cubic-bezier(.4,0,.2,1)" }} />
        </span>
        {evening && bagLeft > 0 && snap.tomorrow.kind === "school" && <span style={{ whiteSpace: "nowrap", color: "var(--c-8e8e97)" }}>{bagLeft} TO PACK</span>}
      </div>
    </div>
  );
}

/**
 * One card for "what's next": the pinned heads-up, the lesson now or next, and the next thing on
 * tonight. Tap it for the full day (lessons, rooms, teachers) and the next few school dates.
 */
function UpNext({ snap }: { snap: Snapshot }) {
  const [open, setOpen] = useState(false);
  const mins = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const lessons = snap.timetable;
  const acts = (snap.activities ?? []).filter((a) => toMin(a.end) > mins);
  const soon = snap.events.filter((e) => e.date > snap.today.date || !e.time || toMin(e.time) >= mins).slice(0, 3);
  const cur = lessons.find((l) => mins >= toMin(l.start) && mins < toMin(l.end));
  const next = lessons.find((l) => toMin(l.start) > mins);
  const lesson = cur ? `now · ${SUBJECT_NAMES[cur.subject] ?? cur.subject}${cur.room ? ` · ${cur.room}` : ""}` : next ? `next · ${SUBJECT_NAMES[next.subject] ?? next.subject} ${next.start}${next.room ? ` · ${next.room}` : ""}` : "";
  const later = acts[0] ? `${acts[0].name} ${acts[0].start}` : soon[0] && soon[0].date === snap.today.date ? `${soon[0].title} ${soon[0].time ?? ""}` : "";
  if (!snap.heads && !lesson && !later && !lessons.length && !soon.length) return null;
  return (
    <div className="tap" onClick={() => setOpen(!open)} style={{ padding: "12px 13px", borderRadius: 14, background: "var(--c-13131a)", marginBottom: 12, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {snap.heads && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--c-ff4d17)" }}>
              <Ms style={{ fontSize: 14 }}>push_pin</Ms>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snap.heads}</span>
            </span>
          )}
          {(lesson || later) && (
            <span style={{ fontSize: 11, color: "var(--c-c9c8c2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lesson || "school's done"}{later ? <span style={{ color: "var(--c-6d6d77)" }}> · then {later.toLowerCase()}</span> : null}
            </span>
          )}
          {!snap.heads && !lesson && !later && <span style={{ fontSize: 11, color: "var(--c-8e8e97)" }}>coming up</span>}
        </div>
        <Ms style={{ fontSize: 17, color: "var(--c-5f5f67)", transform: open ? "rotate(180deg)" : "none", transition: "transform .35s cubic-bezier(.32,.72,0,1)" }}>expand_more</Ms>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 11, paddingTop: 10, boxShadow: "0 -1px 0 var(--c-1c1c23)", animation: "aFade .3s ease-out" }}>
          {acts.filter((a) => !lessons.length || toMin(a.start) < toMin(lessons[0].start)).map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--c-dedad4)", marginTop: 2 }}>
              <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, width: 36 }}>{a.start}</span>
              <Ms style={{ fontSize: 13, color: "var(--c-ff4d17)" }}>theater_comedy</Ms>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}{a.where ? ` · ${a.where}` : ""}</span>
            </div>
          ))}
          {lessons.length > 0 && snap.formTime && <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--c-8e8e97)" }}><span style={{ fontFamily: DOTO, fontWeight: 700, width: 36 }}>08:30</span><span>{snap.formTime}</span></div>}
          {lessons.map((l, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: l === cur ? "var(--c-ff4d17)" : toMin(l.end) <= mins ? "var(--c-5f5f67)" : "var(--c-c9c8c2)" }}>
              <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, width: 36 }}>{l.start}</span>
              <span style={{ width: 3, height: l.span > 1 ? 22 : 12, borderRadius: 2, background: tint(l.subject) }} />
              <span style={{ flex: 1 }}>{SUBJECT_NAMES[l.subject] ?? l.subject}{l.span > 1 ? " ×2" : ""}</span>
              <span style={{ fontSize: 9, color: "var(--c-8e8e97)" }}>{[l.room, l.teacher].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
          {acts.filter((a) => lessons.length && toMin(a.start) >= toMin(lessons[0].start)).map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--c-dedad4)", marginTop: 2 }}>
              <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, width: 36 }}>{a.start}</span>
              <Ms style={{ fontSize: 13, color: "var(--c-ff4d17)" }}>theater_comedy</Ms>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}{a.where ? ` · ${a.where}` : ""}</span>
            </div>
          ))}
          {soon.length > 0 && <div style={{ fontSize: 8, letterSpacing: ".2em", color: "var(--c-5f5f67)", margin: "8px 0 0" }}>COMING UP</div>}
          {soon.map((e) => <EventRow key={e.id} e={e} today={snap.today.date} />)}
        </div>
      )}
    </div>
  );
}

function EventRow({ e, today }: { e: CalEvent; today: string }) {
  const hot = e.tags.includes("exam") || e.tags.includes("term");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", fontSize: 10, color: "var(--c-b6b5af)" }}>
      <Ms style={{ fontSize: 14, color: hot ? "var(--c-ff4d17)" : "var(--c-6d6d77)" }}>{e.tags.includes("exam") ? "edit_note" : e.tags.includes("term") ? "event" : e.tags.includes("creative") ? "palette" : e.tags.includes("parents") ? "family_restroom" : "campaign"}</Ms>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
      <span style={{ fontSize: 8, letterSpacing: ".1em", color: "var(--c-6d6d77)", flex: "none" }}>{relativeDay(e.date, today).toUpperCase()}{e.time ? " " + e.time : ""}</span>
    </div>
  );
}


function kindLabel(d: DayState): string {
  if (d.kind === "school" && d.week) return `SCHOOL · WEEK ${d.week}`;
  return { school: "SCHOOL", weekend: d.lieIn ? "LIE IN" : "WEEKEND", halfterm: "HALF TERM", holiday: "HOLIDAY", away: "AWAY", sick: "RESTING" }[d.kind];
}

/** Estimated times: done tasks at the time they were claimed, the rest back to back from now. */
function timeline(snap: Snapshot) {
  const now = new Date();
  let cursor = now.getHours() * 60 + now.getMinutes();
  const sess = snap.session;
  return snap.tasks.map((t: Task) => {
    const isNow = !!sess && sess.taskId === t.id;
    let time: string;
    let left = "";
    if (t.done && t.doneAt) {
      const d = new Date(t.doneAt);
      time = hhmm(d.getHours() * 60 + d.getMinutes());
    } else if (isNow && sess) {
      const s = new Date(sess.startedAt);
      time = hhmm(s.getHours() * 60 + s.getMinutes());
      const worked = sess.state === "running" && sess.runningSince ? sess.workedSec + (Date.now() - sess.runningSince) / 1000 : sess.workedSec;
      const rem = Math.max(0, sess.totalSec - worked);
      left = `${String(Math.floor(rem / 60)).padStart(2, "0")}:${String(Math.floor(rem % 60)).padStart(2, "0")}`;
      cursor += Math.ceil(rem / 60) + 5;
    } else {
      time = hhmm(cursor);
      cursor += Math.max(1, t.mins - Math.floor(t.spentSec / 60)) + 5;
    }
    const due = t.due ? dueLabel(t.due, snap.today.date) : "";
    return { id: t.id, name: t.name, subject: t.subject, done: t.done, now: isNow, time, left, expected: !!t.expected, due };
  });
}

/* ---------------------------------- plan --------------------------------- */

function Plan() {
  const client = getClient("owner")!;
  const today = dateKey();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [sel, setSel] = useState(today);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, "0")}`;
  const { data, reload } = useHubGet<{ day: DayState; tasks: Task[]; events?: CalEvent[] }[]>(client, `/api/calendar?from=${from}&to=${to}`, [month]);
  const byDate = new Map((data ?? []).map((x) => [x.day.date, x]));
  const selInfo = byDate.get(sel);
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const mark = async (kind: "away" | "holiday") => {
    const cur = selInfo?.day;
    const on = kind === "away" ? cur?.kind === "away" : cur?.kind === "holiday" && cur.baseKind === "school";
    try {
      await client.send("POST", "/api/day/mark", { date: sel, kind: on ? null : kind });
      reload();
      toast(kind === "away" ? "event_busy" : "beach_access", on ? "cleared" : kind === "away" ? "marked as away" : "marked as a day off");
    } catch (e) {
      toastError(e);
    }
  };
  const selDay = selInfo?.day;
  const kindText = !selDay ? "" : selDay.kind === "away" ? "AWAY, NOTHING SET" : selDay.kind === "school" ? "SCHOOL DAY" : selDay.kind === "halfterm" ? "HALF TERM" : selDay.kind === "holiday" ? "HOLIDAY" : selDay.kind === "sick" ? "RESTING" : "WEEKEND";

  return (
    <div style={{ padding: "0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: D, fontSize: 22, lineHeight: 0.9, letterSpacing: -0.5 }}>{MONTH_LONG[m - 1]}</span>
        <span style={{ fontSize: 9, color: "var(--c-5f5f67)" }}>{y}</span>
        <span style={{ flex: 1 }} />
        <Ms style={{ fontSize: 22, cursor: "pointer", color: "var(--c-8e8e97)" }}><span onClick={() => shift(-1)}>chevron_left</span></Ms>
        <Ms style={{ fontSize: 22, cursor: "pointer", color: "var(--c-8e8e97)" }}><span onClick={() => shift(1)}>chevron_right</span></Ms>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 6 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((h, i) => <span key={i} style={{ fontSize: 8, letterSpacing: ".1em", textAlign: "center", color: "var(--c-5c5c66)" }}>{h}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 16 }}>
        {Array.from({ length: lead }, (_, i) => <span key={"x" + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          const info = byDate.get(key);
          const isSel = key === sel;
          const off = info && ["away", "holiday", "halfterm"].includes(info.day.kind);
          const isToday = key === today;
          return (
            <div key={key} onClick={() => setSel(key)} style={{ position: "relative", aspectRatio: "1", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: isSel ? "var(--c-ff4d17)" : off ? "var(--c-2a1420)" : "var(--c-13131a)", boxShadow: isToday && !isSel ? "inset 0 0 0 1.5px var(--c-ff4d17)" : "none", transition: "background-color .3s" }}>
              <span style={{ fontSize: 11, color: isSel ? "var(--c-0b0b0d)" : off ? "var(--c-c98aa8)" : info?.day.kind === "weekend" ? "var(--c-8e8e97)" : "var(--c-c9c8c2)" }}>{i + 1}</span>
              {info && info.tasks.length > 0 && !isSel && <span style={{ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: "50%", background: "var(--c-ff4d17)" }} />}
              {info?.events?.some((e) => e.tags.includes("exam") || e.tags.includes("year")) && !isSel && <span style={{ position: "absolute", top: 3, right: 4, width: 4, height: 4, borderRadius: 1, background: "var(--c-f4f3ef)" }} />}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
        <span style={{ fontSize: 11 }}>{MONTH_LONG[Number(sel.slice(5, 7)) - 1]} {Number(sel.slice(8))}</span>
        <span style={{ flex: 1, height: 1, background: "var(--c-1c1c23)" }} />
        <span style={{ fontSize: 8, letterSpacing: ".14em", color: selDay?.kind === "away" ? "var(--c-8a2f5c)" : "var(--c-8e8e97)" }}>{kindText}{selDay?.week && selDay.kind === "school" ? ` · WEEK ${selDay.week}` : ""}</span>
      </div>
      {(selInfo?.events ?? []).map((e) => <EventRow key={e.id} e={e} today={today} />)}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
        {(selInfo?.tasks ?? []).map((t) => (
          <div key={t.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, height: 42, padding: "0 14px", borderRadius: 12, overflow: "hidden", background: "var(--c-13131a)", animation: "aSlide .26s ease-out" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tint(t.subject) }} />
            <span style={{ fontSize: 11, paddingLeft: 4, minWidth: 0, color: t.done ? "var(--c-7a7a84)" : "var(--c-f4f3ef)", textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "var(--c-8e8e97)" }}>{t.mins >= 60 ? `${t.mins / 60}h` : `${t.mins}m`}</span>
          </div>
        ))}
        {selInfo && !selInfo.tasks.length && <span style={{ fontSize: 10, color: "var(--c-5f5f67)", padding: "6px 2px" }}>nothing planned</span>}
      </div>
      {sel >= today && (
        <div style={{ display: "flex", gap: 8 }}>
          {([["event_busy", "away", "away"], ["beach_access", "day off", "holiday"]] as const).map(([icon, label, kind]) => {
            const on = kind === "away" ? selDay?.kind === "away" : selDay?.kind === "holiday" && selDay.baseKind === "school";
            return (
              <div key={kind} className="tap" onClick={() => mark(kind)} style={{ flex: 1, height: 44, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: on ? "var(--c-ff4d17)" : "var(--c-13131a)", color: on ? "var(--c-0b0b0d)" : "var(--c-c9c8c2)" }}>
                <Ms style={{ fontSize: 16 }}>{icon}</Ms>
                <span style={{ fontSize: 10 }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
      <span style={{ display: "none" }}>{addDays(today, 0)}</span>
    </div>
  );
}

/* ---------------------------------- sick --------------------------------- */

function Sick({ snap }: { snap: Snapshot }) {
  const client = getClient("owner")!;
  const [pick, setPick] = useState<"ill" | "hurt" | "flat" | "">("");
  const parent = snap.settings.parentName;
  const already = snap.today.sick;
  const send = async (kind: "ill" | "hurt" | "flat" | null) => {
    try {
      await client.send("POST", "/api/day/sick", { kind });
      toast("check_circle", kind ? `${parent} has been told` : "welcome back", 3200);
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  if (already) {
    return (
      <div style={{ padding: "0 18px" }}>
        <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 22 }}>Tasks are paused and nothing counts against you. {cap(parent)} knows.</div>
        <div className="tap" onClick={() => send(null)} style={{ height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-f4f3ef)", color: "var(--c-0b0b0d)", fontSize: 11 }}>feeling better</div>
      </div>
    );
  }
  const opts = [["sick", "unwell, staying home", "ill"], ["healing", "injured", "hurt"], ["psychology", "bad day, need a pause", "flat"]] as const;
  return (
    <div style={{ padding: "0 18px" }}>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)", marginBottom: 22 }}>Tasks pause. Nothing counts against you. {cap(parent)} is told straight away.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        {opts.map(([icon, name, id]) => (
          <div key={id} className="tap" onClick={() => setPick(id)} style={{ display: "flex", alignItems: "center", gap: 12, height: 50, padding: "0 15px", borderRadius: 13, background: pick === id ? "var(--c-1e1e26)" : "var(--c-13131a)", boxShadow: pick === id ? "inset 0 0 0 1px var(--c-ff4d17)" : "none", transition: "background-color .3s" }}>
            <Ms style={{ fontSize: 19, color: pick === id ? "var(--c-ff4d17)" : "var(--c-5c5c66)" }}>{icon}</Ms>
            <span style={{ fontSize: 12, color: pick === id ? "var(--c-f4f3ef)" : "var(--c-8e8e97)" }}>{name}</span>
          </div>
        ))}
      </div>
      <div className={pick ? "tap" : ""} onClick={() => pick && send(pick)} style={{ height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: pick ? "var(--c-ff4d17)" : "var(--c-13131a)", color: pick ? "var(--c-0b0b0d)" : "var(--c-5c5c66)", fontSize: 11, letterSpacing: ".06em", transition: "background-color .3s" }}>
        {pick ? `tell ${parent} and pause today` : "pick one first"}
      </div>
    </div>
  );
}

/* -------------------------------- settings ------------------------------- */

function SettingsTab({ snap, onUnpair }: { snap: Snapshot; onUnpair: () => void }) {
  const client = getClient("owner")!;
  const s = snap.settings;
  const set = async (p: Partial<Settings>) => {
    try {
      await client.send("PATCH", "/api/settings", p);
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const [theme, setTheme] = useState<ThemePref>(themePref);
  const [notify, setNotify] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const { data: cfg, reload } = useHubGet<{ birthdays: Birthday[] }>(client, "/api/config");
  const bdays = cfg?.birthdays;
  const [bdOpen, setBdOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const glyphHere = useGlyphSupport();
  const [glyphLit, setGlyphLit] = useState(glyphOn);
  const [lightsOpen, setLightsOpen] = useState(false);
  const { data: lib } = useHubGet<unknown[]>(client, "/api/library", [libOpen]);
  const nat = native();
  const [lock, setLock] = useState(false);
  const refreshLock = async () => {
    if (nat) setLock((await nat.lockStatus().catch(() => null))?.enabled ?? false);
  };
  useEffect(() => {
    void refreshLock();
    document.addEventListener("visibilitychange", refreshLock);
    return () => document.removeEventListener("visibilitychange", refreshLock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const askNotify = async () => {
    if (typeof Notification === "undefined") return toast("notifications_off", "not supported here");
    const r = await Notification.requestPermission();
    setNotify(r === "granted");
  };
  const groups: { head: string; rows: { name: string; meta: string; on: boolean; locked?: boolean; go: () => void }[] }[] = [
    { head: "ASSISTANT", rows: [
      { name: "assistant", meta: s.ai ? "ON" : "OFF", on: s.ai, go: () => set({ ai: !s.ai, ...(s.ai ? { wakeWord: false } : {}) }) },
      { name: "wake word", meta: s.ai && s.wakeWord ? "NUDGE" : "OFF", on: s.ai && s.wakeWord, locked: !s.ai, go: () => s.ai && set({ wakeWord: !s.wakeWord }) },
      { name: "answers from", meta: s.aiEngine === "claude" ? "MY CLAUDE (PC)" : "QUICK MODEL", on: s.aiEngine === "claude", locked: !s.ai, go: () => s.ai && set({ aiEngine: s.aiEngine === "claude" ? "openrouter" : "claude" }).then(() => s.aiEngine !== "claude" && toast("computer", "switch it on in the Nudge tray on your PC too", 4200)) },
      { name: "what it knows about you", meta: "SEE ALL", on: true, go: () => setBrainOpen(true) },
      { name: "documents it can read", meta: `${lib?.length ?? 0} ${lib?.length === 1 ? "FILE" : "FILES"}`, on: true, go: () => setLibOpen(true) },
    ] },
    { head: "THE WALL", rows: [
      { name: "icon keys", meta: s.iconKeys ? "SYMBOLS" : "WORDS", on: s.iconKeys, go: () => set({ iconKeys: !s.iconKeys }) },
      { name: "dim at night", meta: s.dimAtNight ? "AUTO" : "OFF", on: s.dimAtNight, go: () => set({ dimAtNight: !s.dimAtNight }) },
      { name: "lie in at weekends", meta: s.lieInWeekends ? "ON" : "OFF", on: s.lieInWeekends, go: () => set({ lieInWeekends: !s.lieInWeekends }) },
      { name: "lights", meta: `${Object.keys(s.lightMap ?? {}).length || "NO"} CUSTOM`, on: Object.keys(s.lightMap ?? {}).length > 0, go: () => setLightsOpen(true) },
    ] },
    { head: "SCHOOL", rows: [
      { name: "read school mail", meta: s.schoolMail ? "ON" : "OFF", on: s.schoolMail, go: () => set({ schoolMail: !s.schoolMail }) },
    ] },
    { head: "PEOPLE", rows: [
      { name: "birthdays", meta: `${bdays?.length ?? 0} SAVED`, on: true, go: () => setBdOpen(true) },
    ] },
    { head: "THIS PHONE", rows: [
      // A Nothing phone whose software won't share the lights: say why, don't just hide it.
      ...(glyphHere?.nothing && !glyphHere.supported ? [{ name: "glyph lights", meta: "NOT AVAILABLE", on: false, locked: true, go: () => toast("light_mode", `${glyphHere.reason || "Nothing didn't allow it"}. see docs/nothing-phone.md`, 5000) }] : []),
      ...(glyphHere?.supported ? [{ name: "glyph lights", meta: glyphLit ? "SESSIONS" : "OFF", on: glyphLit, go: () => { setGlyphOn(!glyphLit); setGlyphLit(!glyphLit); toast("light_mode", glyphLit ? "glyph lights off" : "glyph lights on the back while nudge is open"); } }] : []),
      { name: "appearance", meta: theme === "auto" ? "LIKE THE PHONE" : theme.toUpperCase(), on: true, go: () => { const n = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto"; setThemePref(n); setTheme(n); } },
      { name: "google keep", meta: s.googleKeep ? "SHARE" : "LOCAL", on: s.googleKeep, go: () => set({ googleKeep: !s.googleKeep }) },
      ...(nat ? [{ name: "phone lock", meta: lock ? "IN SESSIONS" : "OFF", on: lock, go: () => void togglePhoneLock(!lock).then((m) => { toast(lock ? "lock_open" : "lock", m); void refreshLock(); }).catch((e) => toast("lock", String((e as Error).message || e))) }] : []),
      { name: "reminders", meta: notify ? "ON" : "OFF", on: notify, go: askNotify },
      { name: "quiet after 11", meta: s.quietAfter11 ? "ON" : "OFF", on: s.quietAfter11, locked: true, go: () => toast("lock", "set in the parent app") },
    ] },
  ];
  const school = snap.school;
  return (
    <div style={{ padding: "0 18px" }}>
      {groups.map((g) => (
        <div key={g.head} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 8, letterSpacing: ".24em", color: "var(--c-6d6d77)", paddingBottom: 4 }}>{g.head}</div>
          {g.rows.map((r) => (
            <div key={r.name} onClick={() => { if (!r.locked) haptic(); r.go(); }} style={{ display: "flex", alignItems: "center", gap: 12, height: 46, boxShadow: "inset 0 -1px 0 var(--c-17171d)", cursor: r.locked ? "default" : "pointer" }}>
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, color: r.on ? "var(--c-f4f3ef)" : r.locked ? "var(--c-4a4a54)" : "var(--c-b6b5af)", transition: "color .3s" }}>{r.name}</span>
              <span style={{ fontSize: 9, letterSpacing: ".1em", flex: "none", color: r.on ? "var(--c-8e8e97)" : "var(--c-5c5c66)" }}>{r.meta}</span>
              <span style={{ width: 30, height: 4, borderRadius: 2, flex: "none", overflow: "hidden", background: "var(--c-22222a)" }}>
                <span style={{ display: "block", width: 15, height: 4, borderRadius: 2, background: r.on ? "var(--c-ff4d17)" : r.locked ? "var(--c-33333c)" : "var(--c-8e8e97)", transform: `translateX(${r.on ? 15 : 0}px)`, transition: "transform .42s cubic-bezier(.22,1,.28,1),background-color .35s" }} />
              </span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ padding: 14, borderRadius: 14, background: "var(--c-13131a)", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Ms style={{ fontSize: 16, color: school.needsSignIn ? "var(--c-ff4d17)" : "var(--c-5c5c66)" }}>school</Ms>
        <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--c-8e8e97)" }}>
          {school.signedIn ? (school.needsSignIn ? "Signed out of school — sign in again from the Nudge app on your computer." : `School is connected. Last read ${school.lastOk ? new Date(school.lastOk).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "never"}.`) : "School isn't connected yet. Sign in once from the Nudge app on your computer."}
        </div>
      </div>
      <div className="tap" onClick={() => { savePairing("owner", null); onUnpair(); }} style={{ height: 44, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--c-13131a)", color: "var(--c-8e8e97)", fontSize: 10 }}>
        <Ms style={{ fontSize: 15 }}>link_off</Ms> unpair this phone
      </div>
      <div style={{ fontSize: 9, color: "var(--c-43434c)", marginTop: 14 }}>{snap.termLabel.toLowerCase()} · nudge 0.1.0</div>
      <Birthdays open={bdOpen} onClose={() => setBdOpen(false)} list={bdays ?? []} saved={reload} />
      <BrainSheet open={brainOpen} onClose={() => setBrainOpen(false)} />
      <LibrarySheet open={libOpen} onClose={() => setLibOpen(false)} />
      <LightsSheet open={lightsOpen} onClose={() => setLightsOpen(false)} />
    </div>
  );
}

/** Birthdays: search, add, change, remove. Dates are typed day/month, like "23/09". */
function Birthdays({ open, onClose, list, saved }: { open: boolean; onClose: () => void; list: Birthday[]; saved: () => void }) {
  const client = getClient("owner")!;
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [dm, setDm] = useState("");
  const toMmdd = (s: string) => {
    const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const show = (b: Birthday) => `${b.date.slice(3)}/${b.date.slice(0, 2)}`;
  const put = async (next: Birthday[]) => {
    try {
      await client.send("PUT", "/api/config/birthdays", next);
      saved();
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const add = () => {
    const date = toMmdd(dm);
    if (!name.trim() || !date) return toast("error", "a name and a date like 23/09");
    void put([...list, { name: name.trim().slice(0, 40), date }]).then(() => {
      setName("");
      setDm("");
      toast("cake", "saved");
    });
  };
  // Soonest first, from today.
  const today = dateKey().slice(5);
  const sorted = [...list].map((b, i) => ({ b, i })).sort((x, y) => ((x.b.date < today ? "1" : "0") + x.b.date).localeCompare((y.b.date < today ? "1" : "0") + y.b.date));
  const shown = sorted.filter(({ b }) => !q || b.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="birthdays" dark>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input style={{ ...inputStyle(true), flex: 1, minWidth: 0 }} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={{ ...inputStyle(true), width: 84 }} placeholder="dd/mm" inputMode="numeric" value={dm} onChange={(e) => setDm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <span className="tap" onClick={add} style={{ width: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-ff4d17)", color: "var(--c-0b0b0d)" }}><Ms style={{ fontSize: 18 }}>add</Ms></span>
      </div>
      <input style={{ ...inputStyle(true), width: "100%", marginBottom: 8, height: 38, fontSize: 12 }} placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
        {shown.map(({ b, i }) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height: 40, boxShadow: "inset 0 -1px 0 var(--c-1c1c23)" }}>
            <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 11, width: 44, color: "var(--c-ff4d17)" }}>{show(b)}</span>
            <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
            <span className="tap" onClick={() => {
              const nd = prompt(`New date for ${b.name} (dd/mm)`, show(b));
              const date = nd ? toMmdd(nd) : null;
              if (date) void put(list.map((x, j) => (j === i ? { ...x, date } : x)));
            }}><Ms style={{ fontSize: 15, color: "var(--c-6d6d77)" }}>edit</Ms></span>
            <span className="tap" onClick={() => confirm(`Remove ${b.name}?`) && void put(list.filter((_, j) => j !== i))}><Ms style={{ fontSize: 15, color: "var(--c-6d6d77)" }}>close</Ms></span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
