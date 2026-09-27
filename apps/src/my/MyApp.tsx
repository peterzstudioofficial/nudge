import { useEffect, useMemo, useState } from "react";
import {
  addDays, dateKey, DAY_SHORT, hhmm, MONTH_LONG, MONTH_SHORT, parseDateKey, tint, type Snapshot, type DayState, type Task,
  type Settings, type CalEvent, type Birthday, SUBJECT_NAMES, dueLabel, relativeDay,
} from "@nudge/shared";
import { getClient, savePairing, useHubGet, useSnapshot } from "../lib/hub";
import { D, DOTO, Ms, Sheet, inputStyle, toast, toastError } from "../lib/ui";
import { native } from "../lib/native";
import { PhoneLock, togglePhoneLock, usePhoneLock } from "./PhoneLock";
import { ToolsTab } from "./ToolsTab";

/** "my app — plan and look, nothing else." From "Nudge Apps.dc.html". */

type Tab = "today" | "plan" | "tools" | "sick" | "settings";
const ORDER: Tab[] = ["today", "plan", "tools", "sick", "settings"];

export function MyApp({ onUnpair }: { onUnpair: () => void }) {
  const client = getClient("owner")!;
  const { snap, online } = useSnapshot(client);
  const [locked, hideLock] = usePhoneLock(snap);
  const [tab, setTab] = useState<Tab>("today");
  const [prev, setPrev] = useState<Tab>("today");
  const i = ORDER.indexOf(tab);
  const fwd = i >= ORDER.indexOf(prev);
  const go = (t: Tab) => {
    if (t === tab) return;
    setPrev(tab);
    setTab(t);
  };
  const now = new Date();

  return (
    <div className="page" style={{ background: "#0a0a0c", paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, height: 44, padding: "0 18px" }}>
        <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 13, letterSpacing: 0.5 }}>{hhmm(now.getHours() * 60 + now.getMinutes())}</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 9px", borderRadius: 9, background: "#101017" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: online ? "#ff4d17" : "#43434c", animation: online ? "none" : "aBreath 3s ease-in-out infinite" }} />
          <span style={{ fontSize: 8, letterSpacing: ".14em", color: "#8e8e97" }}>{online ? (snap?.session ? "WALL · FOCUS" : "WALL ON") : "OFFLINE"}</span>
        </div>
        <Ms style={{ fontSize: 13, color: "#5f5f67" }}>{online ? "wifi" : "wifi_off"}</Ms>
      </div>

      <div style={{ position: "relative", padding: "2px 14px 16px" }}>
        <div style={{ position: "relative", height: 40, borderRadius: 13, background: "#101017", padding: 3 }}>
          <span style={{ position: "absolute", top: 3, height: 34, borderRadius: 10, background: "#ff4d17", left: `calc(3px + (100% - 6px) * ${i / ORDER.length})`, right: `calc(3px + (100% - 6px) * ${(ORDER.length - 1 - i) / ORDER.length})`, transition: `left ${fwd ? ".56s" : ".32s"} cubic-bezier(.32,.72,0,1),right ${fwd ? ".32s" : ".56s"} cubic-bezier(.32,.72,0,1)` }} />
          <div style={{ position: "relative", display: "flex", height: "100%" }}>
            {([["checklist", "tasks", "today"], ["calendar_month", "plan", "plan"], ["apps", "tools", "tools"], ["sick", "unwell", "sick"], ["settings", "settings", "settings"]] as const).map(([icon, label, id]) => (
              <div key={id} onClick={() => go(id)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", zIndex: 1 }}>
                <Ms style={{ fontSize: 16, color: tab === id ? "#0b0b0d" : "#7a7a84", transition: "color .4s" }}>{icon}</Ms>
                {tab === id && <span style={{ fontSize: 10, letterSpacing: ".06em", whiteSpace: "nowrap", color: "#0b0b0d", animation: "aFade .4s ease-out .12s both" }}>{label}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!snap && <div style={{ padding: "40px 22px", fontSize: 11, color: "#8e8e97" }}>connecting to the wall…</div>}
      {snap && tab === "today" && <Today snap={snap} />}
      {snap && tab === "plan" && <Plan />}
      {snap && tab === "tools" && <ToolsTab snap={snap} />}
      {snap && tab === "sick" && <Sick snap={snap} />}
      {snap && tab === "settings" && <SettingsTab snap={snap} onUnpair={onUnpair} />}
      {snap && locked && <PhoneLock snap={snap} onHide={hideLock} />}
    </div>
  );
}

/* --------------------------------- today --------------------------------- */

function Today({ snap }: { snap: Snapshot }) {
  const now = new Date();
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
  const dk = parseDateKey(snap.today.date);
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 15 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: D, fontSize: 58, lineHeight: 0.8, letterSpacing: -2 }}>{DAY_SHORT[dk.getDay()]}</span>
          <span style={{ fontSize: 8, letterSpacing: ".22em", color: "#8e8e97", marginTop: 4 }}>{dk.getDate()} {MONTH_SHORT[dk.getMonth()]} · {kindLabel(snap.today)}</span>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 34, lineHeight: 0.9, color: "#ff4d17" }}>{done}/{tasks.length}</span>
          <div style={{ display: "flex", gap: 3 }}>
            {tasks.map((t, i) => (
              <span key={t.id} style={{ width: 7, height: 7, borderRadius: i < done ? "50%" : 2, background: i < done ? "#ff4d17" : "#f4f3ef", transition: "border-radius .4s cubic-bezier(.4,0,.2,1),background-color .4s ease" }} />
            ))}
          </div>
        </div>
      </div>

      {snap.heads && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 12, background: "#ff4d17", color: "#0b0b0d", marginBottom: 12, fontSize: 11, lineHeight: 1.3 }}>
          <Ms style={{ fontSize: 15 }}>push_pin</Ms>
          <span>{snap.heads}</span>
        </div>
      )}

      <SchoolStrip snap={snap} />

      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 16 }}>
        {rows.length === 0 && <span style={{ fontSize: 11, color: "#8e8e97", padding: "14px 2px" }}>nothing set for today{snap.today.kind === "sick" ? " — rest up" : ""}.</span>}
        {rows.map((t, i) => (
          <div key={t.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, height: t.now ? 50 : 40, padding: "0 13px", borderRadius: t.now ? 13 : i === 0 ? "12px 12px 5px 5px" : i === rows.length - 1 ? "5px 5px 12px 12px" : 5, overflow: "hidden", background: t.now ? "#1e1e26" : "#13131a", transition: "background-color .4s ease" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tint(t.subject) }} />
            <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, flex: "none", width: 36, paddingLeft: 5, color: t.now ? "#ff4d17" : "#8e8e97" }}>{t.time}</span>
            <span style={{ fontSize: 12, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: t.done ? "#7a7a84" : t.now ? "#ffffff" : "#dedad4", textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
            {t.due && !t.done && !t.now && <span style={{ fontSize: 8, letterSpacing: ".1em", color: "#8e8e97", flex: "none" }}>DUE {t.due.toUpperCase()}</span>}
            {t.expected && !t.done && !t.now && (
              <span className="tap" onClick={() => void notSet(t.id, t.name)} style={{ fontSize: 8, letterSpacing: ".1em", padding: "5px 7px", borderRadius: 7, background: "#26262e", color: "#c9c8c2", flex: "none" }}>NOT SET?</span>
            )}
            {t.now && t.left && <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 12, color: "#ff4d17" }}>{t.left}</span>}
            {(t.done || t.now) && <Ms style={{ fontSize: 15, flex: "none", color: t.done ? "#6d6d77" : "#ff4d17" }}>{t.done ? "check" : "play_arrow"}</Ms>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7 }}>
        <Stat v={String(snap.bank)} k={`OF ${snap.reward.goal} · ${snap.reward.name.toUpperCase()}`} />
        <Stat v={String(snap.bag.filter((b) => !b.got && !b.kept).length)} k="TO PACK" />
      </div>
      <div style={{ fontSize: 9, lineHeight: 1.5, color: "#5f5f67", marginTop: 14 }}>
        Tasks are started and claimed on the wall. This app plans and looks — nothing else.
      </div>
      <span style={{ display: "none" }}>{now.getSeconds()}</span>
    </div>
  );
}

/** Today's lessons (times + rooms), form time, and the next school-calendar dates. */
function SchoolStrip({ snap }: { snap: Snapshot }) {
  const [open, setOpen] = useState(false);
  const mins = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const lessons = snap.timetable;
  const soon = snap.events.filter((e) => e.date > snap.today.date || !e.time || toMin(e.time) >= mins).slice(0, 3);
  const acts = snap.activities ?? [];
  if (!lessons.length && !soon.length && !acts.length) return null;
  const cur = lessons.find((l) => mins >= toMin(l.start) && mins < toMin(l.end));
  const next = lessons.find((l) => toMin(l.start) > mins);
  return (
    <div style={{ marginBottom: 12 }}>
      {lessons.length > 0 && (
        <div className="tap" onClick={() => setOpen(!open)} style={{ padding: "10px 12px", borderRadius: 12, background: "#13131a", marginBottom: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Ms style={{ fontSize: 15, color: "#8e8e97" }}>school</Ms>
            <span style={{ fontSize: 11, flex: 1, color: "#dedad4" }}>
              {cur ? `now: ${SUBJECT_NAMES[cur.subject] ?? cur.subject}${cur.room ? " · " + cur.room : ""}` : next ? `next: ${SUBJECT_NAMES[next.subject] ?? next.subject} ${next.start}${next.room ? " · " + next.room : ""}` : "school's done"}
            </span>
            <span style={{ fontSize: 8, letterSpacing: ".12em", color: "#8e8e97" }}>{snap.formTime ? snap.formTime.toUpperCase() : ""}</span>
            <Ms style={{ fontSize: 15, color: "#5f5f67" }}>{open ? "expand_less" : "expand_more"}</Ms>
          </div>
          {open && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 9 }}>
              <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#8e8e97" }}><span style={{ fontFamily: DOTO, fontWeight: 700, width: 36 }}>08:30</span><span>{snap.formTime || "registration"}</span></div>
              {lessons.map((l, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: l === cur ? "#ff4d17" : "#c9c8c2" }}>
                  <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, width: 36 }}>{l.start}</span>
                  <span style={{ width: 3, height: l.span > 1 ? 22 : 12, borderRadius: 2, background: tint(l.subject) }} />
                  <span style={{ flex: 1 }}>{SUBJECT_NAMES[l.subject] ?? l.subject}{l.span > 1 ? " ×2" : ""}</span>
                  <span style={{ fontSize: 9, color: "#8e8e97" }}>{[l.room, l.teacher].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {acts.map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 12px", fontSize: 10, color: "#dedad4" }}>
          <Ms style={{ fontSize: 14, color: "#ff4d17" }}>theater_comedy</Ms>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}{a.where ? ` · ${a.where}` : ""}</span>
          <span style={{ fontSize: 8, letterSpacing: ".1em", color: "#8e8e97", flex: "none" }}>{a.start}–{a.end}</span>
        </div>
      ))}
      {soon.map((e) => <EventRow key={e.id} e={e} today={snap.today.date} />)}
    </div>
  );
}

function EventRow({ e, today }: { e: CalEvent; today: string }) {
  const hot = e.tags.includes("exam") || e.tags.includes("term");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 12px", fontSize: 10, color: "#b6b5af" }}>
      <Ms style={{ fontSize: 14, color: hot ? "#ff4d17" : "#6d6d77" }}>{e.tags.includes("exam") ? "edit_note" : e.tags.includes("term") ? "event" : e.tags.includes("creative") ? "palette" : e.tags.includes("parents") ? "family_restroom" : "campaign"}</Ms>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
      <span style={{ fontSize: 8, letterSpacing: ".1em", color: "#6d6d77", flex: "none" }}>{relativeDay(e.date, today).toUpperCase()}{e.time ? " " + e.time : ""}</span>
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div style={{ flex: 1, padding: "13px 12px", borderRadius: 14, background: "#13131a", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 21, lineHeight: 1 }}>{v}</span>
      <span style={{ fontSize: 7, letterSpacing: ".14em", color: "#8e8e97", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
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
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: D, fontSize: 30, lineHeight: 0.9, letterSpacing: -1 }}>{MONTH_LONG[m - 1]}</span>
        <span style={{ fontSize: 9, color: "#5f5f67" }}>{y}</span>
        <span style={{ flex: 1 }} />
        <Ms style={{ fontSize: 22, cursor: "pointer", color: "#8e8e97" }}><span onClick={() => shift(-1)}>chevron_left</span></Ms>
        <Ms style={{ fontSize: 22, cursor: "pointer", color: "#8e8e97" }}><span onClick={() => shift(1)}>chevron_right</span></Ms>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 6 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((h, i) => <span key={i} style={{ fontSize: 8, letterSpacing: ".1em", textAlign: "center", color: "#5c5c66" }}>{h}</span>)}
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
            <div key={key} onClick={() => setSel(key)} style={{ position: "relative", aspectRatio: "1", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: isSel ? "#ff4d17" : off ? "#2a1420" : "#13131a", boxShadow: isToday && !isSel ? "inset 0 0 0 1.5px #ff4d17" : "none", transition: "background-color .3s" }}>
              <span style={{ fontSize: 11, color: isSel ? "#0b0b0d" : off ? "#c98aa8" : info?.day.kind === "weekend" ? "#8e8e97" : "#c9c8c2" }}>{i + 1}</span>
              {info && info.tasks.length > 0 && !isSel && <span style={{ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: "50%", background: "#ff4d17" }} />}
              {info?.events?.some((e) => e.tags.includes("exam") || e.tags.includes("year")) && !isSel && <span style={{ position: "absolute", top: 3, right: 4, width: 4, height: 4, borderRadius: 1, background: "#f4f3ef" }} />}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
        <span style={{ fontSize: 11 }}>{MONTH_LONG[Number(sel.slice(5, 7)) - 1]} {Number(sel.slice(8))}</span>
        <span style={{ flex: 1, height: 1, background: "#1c1c23" }} />
        <span style={{ fontSize: 8, letterSpacing: ".14em", color: selDay?.kind === "away" ? "#8a2f5c" : "#8e8e97" }}>{kindText}{selDay?.week && selDay.kind === "school" ? ` · WEEK ${selDay.week}` : ""}</span>
      </div>
      {(selInfo?.events ?? []).map((e) => <EventRow key={e.id} e={e} today={today} />)}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
        {(selInfo?.tasks ?? []).map((t) => (
          <div key={t.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 11, height: 42, padding: "0 14px", borderRadius: 12, overflow: "hidden", background: "#13131a", animation: "aSlide .26s ease-out" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tint(t.subject) }} />
            <span style={{ fontSize: 11, paddingLeft: 4, minWidth: 0, color: t.done ? "#7a7a84" : "#f4f3ef", textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "#8e8e97" }}>{t.mins >= 60 ? `${t.mins / 60}h` : `${t.mins}m`}</span>
          </div>
        ))}
        {selInfo && !selInfo.tasks.length && <span style={{ fontSize: 10, color: "#5f5f67", padding: "6px 2px" }}>nothing planned</span>}
      </div>
      {sel >= today && (
        <div style={{ display: "flex", gap: 8 }}>
          {([["event_busy", "away", "away"], ["beach_access", "day off", "holiday"]] as const).map(([icon, label, kind]) => {
            const on = kind === "away" ? selDay?.kind === "away" : selDay?.kind === "holiday" && selDay.baseKind === "school";
            return (
              <div key={kind} className="tap" onClick={() => mark(kind)} style={{ flex: 1, height: 44, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: on ? "#ff4d17" : "#13131a", color: on ? "#0b0b0d" : "#c9c8c2" }}>
                <Ms style={{ fontSize: 16 }}>{icon}</Ms>
                <span style={{ fontSize: 10 }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 9, color: "#5f5f67", marginTop: 12, lineHeight: 1.5 }}>Term dates and weeks A/B: Churcher's College calendar. A white corner mark means a school date for your year.</div>
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
      <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
        <div style={{ fontFamily: D, fontSize: 34, lineHeight: 1.02, marginBottom: 8 }}>resting today</div>
        <div style={{ fontSize: 10, lineHeight: 1.5, color: "#8e8e97", marginBottom: 22 }}>Tasks are paused and nothing counts against you. {cap(parent)} knows.</div>
        <div className="tap" onClick={() => send(null)} style={{ height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f3ef", color: "#0b0b0d", fontSize: 11 }}>feeling better</div>
      </div>
    );
  }
  const opts = [["sick", "unwell, staying home", "ill"], ["healing", "injured", "hurt"], ["psychology", "bad day, need a pause", "flat"]] as const;
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div style={{ fontFamily: D, fontSize: 34, lineHeight: 1.02, marginBottom: 8 }}>not well<br />today?</div>
      <div style={{ fontSize: 10, lineHeight: 1.5, color: "#8e8e97", marginBottom: 22 }}>Tasks pause. Nothing counts against you. {cap(parent)} is told straight away.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        {opts.map(([icon, name, id]) => (
          <div key={id} className="tap" onClick={() => setPick(id)} style={{ display: "flex", alignItems: "center", gap: 12, height: 50, padding: "0 15px", borderRadius: 13, background: pick === id ? "#1e1e26" : "#13131a", boxShadow: pick === id ? "inset 0 0 0 1px #ff4d17" : "none", transition: "background-color .3s" }}>
            <Ms style={{ fontSize: 19, color: pick === id ? "#ff4d17" : "#5c5c66" }}>{icon}</Ms>
            <span style={{ fontSize: 12, color: pick === id ? "#f4f3ef" : "#8e8e97" }}>{name}</span>
          </div>
        ))}
      </div>
      <div className={pick ? "tap" : ""} onClick={() => pick && send(pick)} style={{ height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: pick ? "#ff4d17" : "#13131a", color: pick ? "#0b0b0d" : "#5c5c66", fontSize: 11, letterSpacing: ".06em", transition: "background-color .3s" }}>
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
  const [notify, setNotify] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const { data: cfg, reload } = useHubGet<{ birthdays: Birthday[] }>(client, "/api/config");
  const bdays = cfg?.birthdays;
  const [bdOpen, setBdOpen] = useState(false);
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
    ] },
    { head: "THE WALL", rows: [
      { name: "icon keys", meta: s.iconKeys ? "SYMBOLS" : "WORDS", on: s.iconKeys, go: () => set({ iconKeys: !s.iconKeys }) },
      { name: "dim at night", meta: s.dimAtNight ? "AUTO" : "OFF", on: s.dimAtNight, go: () => set({ dimAtNight: !s.dimAtNight }) },
      { name: "lie in at weekends", meta: s.lieInWeekends ? "ON" : "OFF", on: s.lieInWeekends, go: () => set({ lieInWeekends: !s.lieInWeekends }) },
    ] },
    { head: "SCHOOL", rows: [
      { name: "read school mail", meta: s.schoolMail ? "ON" : "OFF", on: s.schoolMail, go: () => set({ schoolMail: !s.schoolMail }) },
    ] },
    { head: "PEOPLE", rows: [
      { name: "birthdays", meta: `${bdays?.length ?? 0} SAVED`, on: true, go: () => setBdOpen(true) },
    ] },
    { head: "THIS PHONE", rows: [
      { name: "google keep", meta: s.googleKeep ? "SHARE" : "LOCAL", on: s.googleKeep, go: () => set({ googleKeep: !s.googleKeep }) },
      ...(nat ? [{ name: "phone lock", meta: lock ? "IN SESSIONS" : "OFF", on: lock, go: () => void togglePhoneLock(!lock).then((m) => { toast(lock ? "lock_open" : "lock", m); void refreshLock(); }).catch((e) => toast("lock", String((e as Error).message || e))) }] : []),
      { name: "reminders", meta: notify ? "ON" : "OFF", on: notify, go: askNotify },
      { name: "quiet after 11", meta: s.quietAfter11 ? "ON" : "OFF", on: s.quietAfter11, locked: true, go: () => toast("lock", "set in the parent app") },
    ] },
  ];
  const school = snap.school;
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      {groups.map((g) => (
        <div key={g.head} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 8, letterSpacing: ".24em", color: "#6d6d77", paddingBottom: 4 }}>{g.head}</div>
          {g.rows.map((r) => (
            <div key={r.name} onClick={r.go} style={{ display: "flex", alignItems: "center", gap: 12, height: 46, boxShadow: "inset 0 -1px 0 #17171d", cursor: r.locked ? "default" : "pointer" }}>
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, color: r.on ? "#f4f3ef" : r.locked ? "#4a4a54" : "#b6b5af", transition: "color .3s" }}>{r.name}</span>
              <span style={{ fontSize: 9, letterSpacing: ".1em", flex: "none", color: r.on ? "#8e8e97" : "#5c5c66" }}>{r.meta}</span>
              <span style={{ width: 30, height: 4, borderRadius: 2, flex: "none", overflow: "hidden", background: "#22222a" }}>
                <span style={{ display: "block", width: 15, height: 4, borderRadius: 2, background: r.on ? "#ff4d17" : r.locked ? "#33333c" : "#8e8e97", transform: `translateX(${r.on ? 15 : 0}px)`, transition: "transform .42s cubic-bezier(.22,1,.28,1),background-color .35s" }} />
              </span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ padding: 14, borderRadius: 14, background: "#13131a", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Ms style={{ fontSize: 16, color: school.needsSignIn ? "#ff4d17" : "#5c5c66" }}>school</Ms>
        <div style={{ fontSize: 10, lineHeight: 1.5, color: "#8e8e97" }}>
          {school.signedIn ? (school.needsSignIn ? "Signed out of school — sign in again from the Nudge app on your computer." : `School is connected. Last read ${school.lastOk ? new Date(school.lastOk).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "never"}.`) : "School isn't connected yet. Sign in once from the Nudge app on your computer."}
        </div>
      </div>
      <div className="tap" onClick={() => { savePairing("owner", null); onUnpair(); }} style={{ height: 44, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#13131a", color: "#8e8e97", fontSize: 10 }}>
        <Ms style={{ fontSize: 15 }}>link_off</Ms> unpair this phone
      </div>
      <div style={{ fontSize: 9, color: "#43434c", marginTop: 14 }}>{snap.termLabel.toLowerCase()} · nudge 0.1.0</div>
      <Birthdays open={bdOpen} onClose={() => setBdOpen(false)} list={bdays ?? []} saved={reload} />
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
        <span className="tap" onClick={add} style={{ width: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "#ff4d17", color: "#0b0b0d" }}><Ms style={{ fontSize: 18 }}>add</Ms></span>
      </div>
      <input style={{ ...inputStyle(true), width: "100%", marginBottom: 8, height: 38, fontSize: 12 }} placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
        {shown.map(({ b, i }) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height: 40, boxShadow: "inset 0 -1px 0 #1c1c23" }}>
            <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 11, width: 44, color: "#ff4d17" }}>{show(b)}</span>
            <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
            <span className="tap" onClick={() => {
              const nd = prompt(`New date for ${b.name} (dd/mm)`, show(b));
              const date = nd ? toMmdd(nd) : null;
              if (date) void put(list.map((x, j) => (j === i ? { ...x, date } : x)));
            }}><Ms style={{ fontSize: 15, color: "#6d6d77" }}>edit</Ms></span>
            <span className="tap" onClick={() => confirm(`Remove ${b.name}?`) && void put(list.filter((_, j) => j !== i))}><Ms style={{ fontSize: 15, color: "#6d6d77" }}>close</Ms></span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
