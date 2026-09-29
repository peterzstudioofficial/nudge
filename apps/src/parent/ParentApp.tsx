import { useState } from "react";
import {
  addDays, dateKey, mmss, relativeDay, sessionView, SUBJECT_NAMES, tint, type Device, type FeedEvent, type Settings,
  type Snapshot, type Task, type Template,
} from "@nudge/shared";
import { getClient, savePairing, useHubGet, useSnapshot } from "../lib/hub";
import { Btn, D, DOTO, Field, inputStyle, Ms, Sheet, toast, toastError } from "../lib/ui";

/** "parent app — rewards and progress." Light theme, from "Nudge Apps.dc.html". */

type Tab = "reward" | "tasks" | "feed";
type When = "tomorrow" | "weekly" | "later";
const WD = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function ParentApp({ onUnpair }: { onUnpair: () => void }) {
  const client = getClient("parent")!;
  const { snap, online } = useSnapshot(client);
  const [tab, setTab] = useState<Tab>("reward");
  const [rules, setRules] = useState(false);
  const title = tab === "tasks" ? "tasks" : tab === "reward" ? "reward" : "today";
  const TABS = [["redeem", "reward"], ["checklist", "tasks"], ["timeline", "feed"]] as const;
  const idx = TABS.findIndex(([, id]) => id === tab);
  return (
    <div className="page" style={{ background: "var(--c-f4f3ef)", color: "var(--c-111114)", paddingBottom: 40 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 30, padding: "calc(env(safe-area-inset-top, 0px) + 16px) 18px 14px", background: "var(--c-f4f3ef)", display: "flex", alignItems: "flex-end", gap: 10 }}>
        <span key={title} style={{ fontFamily: D, fontSize: 36, lineHeight: 0.82, letterSpacing: -1, animation: "aSwap .38s cubic-bezier(.32,.72,0,1) both" }}>{title}</span>
        <span title={online ? "connected to the wall" : "offline — showing the last sync"} style={{ width: 7, height: 7, borderRadius: "50%", alignSelf: "flex-start", marginLeft: -4, background: online ? "var(--c-ff4d17)" : "var(--c-b2ada3)", animation: online ? "none" : "aBreath 2.4s ease-in-out infinite" }} />
        <span style={{ flex: 1 }} />
        <nav style={{ position: "relative", display: "flex", padding: 3, borderRadius: 22, background: "var(--c-eae7e1)" }}>
          <span style={{ position: "absolute", top: 3, left: 3, width: 40, height: 36, borderRadius: 18, background: "var(--c-111114)", transform: `translateX(${idx * 40}px)`, transition: "transform .48s cubic-bezier(.32,.72,0,1)" }} />
          {TABS.map(([icon, id]) => (
            <button key={id} aria-label={id} className="tap" onClick={() => setTab(id)} style={{ position: "relative", width: 40, height: 36, border: 0, padding: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Ms style={{ fontSize: 18, color: tab === id ? "var(--c-f4f3ef)" : "var(--c-8a8a92)", transition: "color .35s" }}>{icon}</Ms>
            </button>
          ))}
        </nav>
      </header>
      {!snap && <div style={{ padding: "30px 18px", fontSize: 11, color: "var(--c-8a8a92)" }}>connecting…</div>}
      {snap && tab === "reward" && <RewardTab snap={snap} openRules={() => setRules(true)} />}
      {snap && tab === "tasks" && <TasksTab snap={snap} />}
      {snap && tab === "feed" && <FeedTab snap={snap} />}
      {snap && <RulesSheet open={rules} onClose={() => setRules(false)} snap={snap} onUnpair={onUnpair} />}
    </div>
  );
}

/* --------------------------------- reward -------------------------------- */

function RewardTab({ snap, openRules }: { snap: Snapshot; openRules: () => void }) {
  const client = getClient("parent")!;
  const { data: stats } = useHubGet<{ claimed: number; focusedSec: number; switched: number }>(client, "/api/stats");
  const [edit, setEdit] = useState(false);
  const [pts, setPts] = useState<"pointsStart" | "pointsClaim" | null>(null);
  const r = snap.reward;
  const bank = Math.min(snap.bank, r.goal);
  const blocks = 12;
  const lit = Math.round((bank / r.goal) * blocks);
  const hours = stats ? stats.focusedSec / 3600 : 0;
  const ack = async () => {
    try {
      await client.send("POST", "/api/rewards/ack");
      toast("redeem", "enjoy it — next reward started");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div className="tap" onClick={() => setEdit(true)} style={{ padding: 18, borderRadius: 18, background: "var(--c-111114)", color: "var(--c-f4f3ef)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 9, marginBottom: 15 }}>
          <span style={{ fontFamily: D, fontSize: 52, lineHeight: 0.82, color: "var(--c-ff4d17)" }}>{snap.bank}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4 }}>
            <span style={{ fontSize: 9, color: "var(--c-6d6d77)" }}>of {r.goal}</span>
            <span style={{ fontSize: 7, letterSpacing: ".16em", color: "var(--c-43434c)" }}>{Math.max(0, r.goal - snap.bank)} TO GO</span>
          </div>
          <span style={{ flex: 1 }} />
          <Ms style={{ fontSize: 22, color: "var(--c-3a3a42)" }}>{r.icon}</Ms>
        </div>
        <div style={{ fontFamily: D, fontSize: 25, lineHeight: 1, marginBottom: 14 }}>{r.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
          {Array.from({ length: blocks }, (_, i) => (
            <span key={i} style={{ height: 17, borderRadius: i === 0 ? "8px 4px 4px 8px" : i === 5 ? "4px 8px 8px 4px" : i === 6 ? "8px 4px 4px 8px" : i === 11 ? "4px 8px 8px 4px" : 4, background: i < lit ? "var(--c-ff4d17)" : "var(--c-2a2a33)", animation: "aCell .4s cubic-bezier(.2,.9,.25,1) both", animationDelay: (i * 0.035).toFixed(2) + "s", transition: "background-color .5s ease" }} />
          ))}
        </div>
      </div>
      {r.unlockedAt && (
        <div style={{ marginBottom: 16 }}>
          <Btn primary onClick={ack}><Ms style={{ fontSize: 17 }}>redeem</Ms> unlocked — mark as given</Btn>
        </div>
      )}
      <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
        {[{ v: String(stats?.claimed ?? "–"), k: "CLAIMED" }, { v: stats ? (hours >= 1 ? `${Math.round(hours * 10) / 10}h` : `${Math.round(hours * 60)}m`) : "–", k: "FOCUSED" }, { v: String(stats?.switched ?? "–"), k: "SWITCHED" }].map((w) => (
          <div key={w.k} style={{ flex: 1, padding: "13px 12px", borderRadius: 14, background: "var(--c-eae7e1)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 21, lineHeight: 1 }}>{w.v}</span>
            <span style={{ fontSize: 7, letterSpacing: ".14em", color: "var(--c-8a8a92)" }}>{w.k}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 8, letterSpacing: ".22em", color: "var(--c-a5a5ad)", marginBottom: 9 }}>POINTS PER TASK</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {[{ k: "starting a session", v: snap.settings.pointsStart, key: "pointsStart" as const }, { k: "finishing and claiming", v: snap.settings.pointsClaim, key: "pointsClaim" as const }].map((row) => (
          <div key={row.k} className={pts === row.key ? "" : "tap"} onClick={() => pts !== row.key && setPts(row.key)} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 8px 0 15px", borderRadius: 13, background: "var(--c-eae7e1)", cursor: "pointer" }}>
            <span style={{ fontSize: 10 }}>{row.k}</span>
            <span style={{ flex: 1 }} />
            {pts === row.key ? (
              <Stepper value={row.v} min={0} max={row.key === "pointsStart" ? 10 : 20} onChange={(v) => void client.send("PATCH", "/api/settings", { [row.key]: v }).then(() => client.snapshot()).catch(toastError)} prefix="+" />
            ) : (
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15, paddingRight: 7 }}>+{row.v}</span>
            )}
          </div>
        ))}
      </div>
      <div className="tap" onClick={openRules} style={{ display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 15px", borderRadius: 14, boxShadow: "inset 0 0 0 1.5px var(--c-dcd8d0)" }}>
        <Ms style={{ fontSize: 17, color: "var(--c-8a8a92)" }}>tune</Ms>
        <span style={{ fontSize: 11, flex: 1 }}>rules, blocks and devices</span>
        <Ms style={{ fontSize: 16, color: "var(--c-a5a5ad)" }}>chevron_right</Ms>
      </div>
      <RewardSheet open={edit} onClose={() => setEdit(false)} snap={snap} />
    </div>
  );
}

function Stepper({ value, min, max, onChange, prefix = "" }: { value: number; min: number; max: number; onChange: (v: number) => void; prefix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span className="tap" onClick={() => value > min && onChange(value - 1)} style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-f4f3ef)" }}><Ms style={{ fontSize: 15 }}>remove</Ms></span>
      <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15, minWidth: 34, textAlign: "center" }}>{prefix}{value}</span>
      <span className="tap" onClick={() => value < max && onChange(value + 1)} style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-f4f3ef)" }}><Ms style={{ fontSize: 15 }}>add</Ms></span>
    </div>
  );
}

function RewardSheet({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: Snapshot }) {
  const client = getClient("parent")!;
  const [name, setName] = useState(snap.reward.name);
  const [goal, setGoal] = useState(snap.reward.goal);
  const [next, setNext] = useState(snap.nextReward?.name ?? "");
  const save = async () => {
    try {
      await client.send("PUT", "/api/rewards", { name: name.trim() || snap.reward.name, goal, icon: snap.reward.icon, next: next.trim() ? [{ name: next.trim(), goal, icon: "redeem" }] : [] });
      toast("redeem", "reward saved");
      void client.snapshot();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="the reward">
      <Field label="working towards"><input style={inputStyle(false)} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="points needed">
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 45, 60, 90, 120].map((g) => (
            <span key={g} className="tap" onClick={() => setGoal(g)} style={{ flex: 1, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DOTO, fontWeight: 900, background: goal === g ? "var(--c-111114)" : "var(--c-eae7e1)", color: goal === g ? "var(--c-f4f3ef)" : "var(--c-111114)" }}>{g}</span>
          ))}
        </div>
      </Field>
      <Field label="after that"><input style={inputStyle(false)} value={next} onChange={(e) => setNext(e.target.value)} placeholder="the next reward" /></Field>
      <span style={{ display: "block", fontSize: 9, color: "var(--c-8a8a92)", lineHeight: 1.5, marginBottom: 14 }}>About 3–4 points a task. A month of normal days reaches 60.</span>
      <Btn onClick={save}>save</Btn>
    </Sheet>
  );
}

/* --------------------------------- tasks --------------------------------- */

function TasksTab({ snap }: { snap: Snapshot }) {
  const client = getClient("parent")!;
  const [when, setWhen] = useState<When>("tomorrow");
  const [adding, setAdding] = useState(false);
  const today = dateKey();
  const tomorrow = addDays(today, 1);
  const { data: templates, reload: reloadT } = useHubGet<Template[]>(client, "/api/templates");
  const { data: later, reload: reloadL } = useHubGet<Task[]>(client, `/api/tasks?from=${addDays(today, 2)}&to=${addDays(today, 60)}`);
  const cap = snap.settings.maxTasksPerDay;
  const tomorrowParent = snap.tomorrowTasks.filter((t) => t.source === "parent" || t.source === "template");
  const list =
    when === "tomorrow"
      ? tomorrowParent.map((t) => ({ id: t.id, name: t.name, meta: `${t.mins} MIN`, tint: tint(t.subject), kind: "task" as const }))
      : when === "weekly"
        ? (templates ?? []).map((t) => ({ id: t.id, name: t.name, meta: daysLabel(t.days), tint: tint(t.subject), kind: "template" as const }))
        : (later ?? []).filter((t) => t.source === "parent").map((t) => ({ id: t.id, name: t.name, meta: relativeDay(t.date, today).toUpperCase(), tint: tint(t.subject), kind: "task" as const }));
  const full = when === "tomorrow" && snap.tomorrowTasks.filter((t) => t.source === "parent").length >= cap;
  const remove = async (id: string, kind: "task" | "template") => {
    try {
      await client.send("DELETE", kind === "task" ? `/api/tasks/${id}` : `/api/templates/${id}`);
      reloadT();
      reloadL();
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div style={{ display: "flex", gap: 5, marginBottom: 18 }}>
        {(["tomorrow", "weekly", "later"] as When[]).map((w) => (
          <div key={w} className="tap" onClick={() => setWhen(w)} style={{ flex: 1, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: when === w ? "var(--c-111114)" : "var(--c-eae7e1)", color: when === w ? "var(--c-f4f3ef)" : "var(--c-8a8a92)", fontSize: 10, transition: "background-color .3s" }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 16 }}>
        {list.length === 0 && <span style={{ fontSize: 10, color: "var(--c-8a8a92)", padding: "8px 2px" }}>nothing yet</span>}
        {list.map((r) => (
          <div key={r.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 12px 0 16px", borderRadius: 15, overflow: "hidden", background: "var(--c-eae7e1)", animation: "aSlide .28s ease-out" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: r.tint }} />
            <span style={{ fontSize: 12, paddingLeft: 5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, letterSpacing: ".06em", flex: "none", color: "var(--c-8a8a92)" }}>{r.meta}</span>
            <span className="tap" onClick={() => remove(r.id, r.kind)} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}><Ms style={{ fontSize: 18, color: "var(--c-a5a5ad)" }}>close</Ms></span>
          </div>
        ))}
      </div>
      <Btn disabled={full} onClick={() => setAdding(true)}>
        <Ms style={{ fontSize: 17 }}>{full ? "block" : "add"}</Ms>
        {full ? "that is enough for one day" : "add a task"}
      </Btn>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 18 }}>
        <Ms style={{ fontSize: 14, color: "var(--c-a5a5ad)" }}>info</Ms>
        <span style={{ fontSize: 9, lineHeight: 1.45, color: "var(--c-8a8a92)" }}>
          {when === "weekly" ? "Weekly tasks repeat on the days you pick." : `Short lists get finished. Long ones get abandoned, so the day has a limit of ${cap}.`}
        </span>
      </div>
      <AddTask open={adding} onClose={() => setAdding(false)} when={when} tomorrow={tomorrow} onAdded={() => { reloadT(); reloadL(); void client.snapshot(); }} />
    </div>
  );
}

function daysLabel(days: number[]): string {
  const s = [...days].sort();
  if (s.length === 5 && s.join() === "1,2,3,4,5") return "WEEKDAYS";
  if (s.length >= 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${WD[s[0] - 1]} TO ${WD[s[s.length - 1] - 1]}`;
  return s.map((d) => WD[d - 1].slice(0, 2)).join(" ");
}

function AddTask({ open, onClose, when, tomorrow, onAdded }: { open: boolean; onClose: () => void; when: When; tomorrow: string; onAdded: () => void }) {
  const client = getClient("parent")!;
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("study");
  const [mins, setMins] = useState(25);
  const [date, setDate] = useState(addDays(tomorrow, 1));
  const [days, setDays] = useState<number[]>([1, 2, 3, 4]);
  const subjects = ["maths", "eng", "chem", "physics", "bio", "history", "geog", "french", "study", "mine"];
  const save = async () => {
    if (!name.trim()) return toast("edit", "give it a name");
    try {
      if (when === "weekly") await client.send("POST", "/api/templates", { name: name.trim(), subject, phase: subject === "mine" ? "mine" : "home", mins, days, schoolDaysOnly: true });
      else await client.send("POST", "/api/tasks", { name: name.trim(), subject, phase: subject === "study" ? "study" : subject === "mine" ? "mine" : "home", mins, when: "date", date: when === "tomorrow" ? tomorrow : date });
      toast("check_circle", "added — it'll be on the wall");
      setName("");
      onAdded();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={when === "weekly" ? "weekly task" : "new task"}>
      <Field label="what"><input style={inputStyle(false)} value={name} onChange={(e) => setName(e.target.value)} placeholder="chemistry q1-8" autoFocus /></Field>
      <Field label="subject">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {subjects.map((s) => (
            <span key={s} className="tap" onClick={() => setSubject(s)} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 11px", borderRadius: 10, fontSize: 10, background: subject === s ? "var(--c-111114)" : "var(--c-eae7e1)", color: subject === s ? "var(--c-f4f3ef)" : "var(--c-111114)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: tint(s) }} />{SUBJECT_NAMES[s]}
            </span>
          ))}
        </div>
      </Field>
      <Field label="how long">
        <div style={{ display: "flex", gap: 6 }}>
          {[10, 20, 25, 40, 60].map((m) => (
            <span key={m} className="tap" onClick={() => setMins(m)} style={{ flex: 1, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DOTO, fontWeight: 900, fontSize: 13, background: mins === m ? "var(--c-111114)" : "var(--c-eae7e1)", color: mins === m ? "var(--c-f4f3ef)" : "var(--c-111114)" }}>{m}m</span>
          ))}
        </div>
      </Field>
      {when === "later" && <Field label="on"><input type="date" style={inputStyle(false)} value={date} min={tomorrow} onChange={(e) => setDate(e.target.value)} /></Field>}
      {when === "weekly" && (
        <Field label="repeats on">
          <div style={{ display: "flex", gap: 5 }}>
            {WD.map((d, i) => {
              const on = days.includes(i + 1);
              return <span key={d} className="tap" onClick={() => setDays(on ? days.filter((x) => x !== i + 1) : [...days, i + 1])} style={{ flex: 1, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, background: on ? "var(--c-111114)" : "var(--c-eae7e1)", color: on ? "var(--c-f4f3ef)" : "var(--c-8a8a92)" }}>{d.slice(0, 2)}</span>;
            })}
          </div>
        </Field>
      )}
      <Btn onClick={save}>add to the wall</Btn>
    </Sheet>
  );
}

/* ---------------------------------- feed --------------------------------- */

function FeedTab({ snap }: { snap: Snapshot }) {
  const client = getClient("parent")!;
  const { data: feed } = useHubGet<FeedEvent[]>(client, "/api/feed");
  const { data: stats } = useHubGet<{ history: { date: string; label: string; done: number; total: number; pts: number }[] }>(client, "/api/stats");
  const sess = snap.session;
  const task = sess ? snap.tasks.find((t) => t.id === sess.taskId) : null;
  const v = sess ? sessionView(sess, Date.now()) : null;
  const [confirm, setConfirm] = useState(false);
  const [more, setMore] = useState(false);
  const end = async () => {
    try {
      await client.send("POST", "/api/session/end");
      toast("stop_circle", "session ended, progress kept");
      setConfirm(false);
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const today = dateKey();
  const done = snap.tasks.filter((t) => t.done).length;
  return (
    <div style={{ padding: "0 18px", animation: "aUp .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 15px", borderRadius: 14, background: "var(--c-111114)", color: "var(--c-f4f3ef)", marginBottom: 8 }}>
        <span style={{ width: 5, height: 22, borderRadius: 3, background: "var(--c-ff4d17)" }} />
        <span style={{ fontSize: 11, flex: 1 }}>today{snap.today.sick ? " · resting" : ""}</span>
        <span style={{ fontSize: 10 }}>{done}/{snap.tasks.length}</span>
      </div>
      {sess && task && v && (
        <div style={{ padding: 14, borderRadius: 14, boxShadow: "inset 0 0 0 1.5px var(--c-111114)", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-ff4d17)", animation: "aBreath 3s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, flex: 1 }}>{sess.state === "running" ? "focusing on" : sess.state === "paused" ? "paused on" : "on a break from"} {task.name}</span>
            <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15 }}>{mmss(v.remaining)}</span>
          </div>
          {!confirm ? (
            <div className="tap" onClick={() => setConfirm(true)} style={{ marginTop: 10, fontSize: 10, color: "var(--c-8a8a92)" }}>end this session…</div>
          ) : (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <Btn onClick={end} style={{ height: 40 }}>end it, keep progress</Btn>
              <Btn onClick={() => setConfirm(false)} style={{ height: 40, background: "var(--c-eae7e1)", color: "var(--c-111114)" }}>cancel</Btn>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 20 }}>
        {(stats?.history ?? []).slice(0, 3).map((h) => {
          const full = h.total > 0 && h.done === h.total;
          return (
            <div key={h.date} style={{ display: "flex", alignItems: "center", gap: 12, height: 46, padding: "0 15px", borderRadius: 14, background: "var(--c-eae7e1)" }}>
              <span style={{ width: 5, height: 22, borderRadius: 3, flex: "none", background: full ? "var(--c-111114)" : "var(--c-c9c5bd)" }} />
              <span style={{ fontSize: 11, flex: 1, minWidth: 0 }}>{h.label}</span>
              <span style={{ fontSize: 10, flex: "none", color: full ? "var(--c-111114)" : "var(--c-8a8a92)" }}>{h.done}/{h.total}</span>
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 14, flex: "none", color: "var(--c-ff4d17)" }}>+{h.pts}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {(feed ?? []).slice(0, more ? 40 : 10).map((f, i) => (
          <div key={f.id} style={{ display: "flex", gap: 13, animation: "aSlide .3s ease-out both", animationDelay: `${Math.min(i, 8) * 0.06}s` }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 11, flex: "none" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: ["claim", "unlock", "sick"].includes(f.type) ? "var(--c-ff4d17)" : "var(--c-c2beb6)" }} />
              <span style={{ width: 1, flex: 1, background: "var(--c-dcd8d0)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 19, minWidth: 0 }}>
              <span style={{ fontSize: 11, lineHeight: 1.35 }}>{f.text}</span>
              <span style={{ fontSize: 8, letterSpacing: ".1em", color: "var(--c-a5a5ad)" }}>{dateKey(f.ts) === today ? new Date(f.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : relativeDay(dateKey(f.ts), today)}</span>
            </div>
          </div>
        ))}
        {!more && (feed?.length ?? 0) > 10 && <span className="tap" onClick={() => setMore(true)} style={{ fontSize: 9, letterSpacing: ".14em", color: "var(--c-8a8a92)", paddingLeft: 24 }}>SHOW EARLIER</span>}
      </div>
    </div>
  );
}

/* ------------------------------ rules sheet ------------------------------ */

function RulesSheet({ open, onClose, snap, onUnpair }: { open: boolean; onClose: () => void; snap: Snapshot; onUnpair: () => void }) {
  const client = getClient("parent")!;
  const s = snap.settings;
  const { data: devices, reload } = useHubGet<Device[]>(client, open ? "/api/devices" : null);
  const [code, setCode] = useState<string | null>(null);
  const [block, setBlock] = useState("");
  const set = (p: Partial<Settings>) => void client.send("PATCH", "/api/settings", p).then(() => client.snapshot()).catch(toastError);
  const makeCode = async (role: "parent" | "owner") => {
    try {
      const r = await client.send<{ code: string }>("POST", "/api/pairing-codes", { role });
      if (r) setCode(`${role}: ${r.code.slice(0, 3)} ${r.code.slice(3)}`);
    } catch (e) {
      toastError(e);
    }
  };
  const row = (label: string, value: number, min: number, max: number, key: keyof Settings, suffix = "") => (
    <div style={{ display: "flex", alignItems: "center", height: 48, boxShadow: "inset 0 -1px 0 var(--c-e2e0d9)" }}>
      <span style={{ fontSize: 11, flex: 1 }}>{label}</span>
      <Stepper value={value} min={min} max={max} onChange={(v) => set({ [key]: v } as Partial<Settings>)} />
      <span style={{ fontSize: 9, color: "var(--c-8a8a92)", width: 26 }}>{suffix}</span>
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="rules">
      <div style={{ fontSize: 8, letterSpacing: ".22em", color: "var(--c-a5a5ad)", margin: "4px 0 4px" }}>THE DAY</div>
      {row("tasks a day, at most", s.maxTasksPerDay, 1, 12, "maxTasksPerDay")}
      {row("skips a day", s.skipsPerDay, 0, 5, "skipsPerDay")}
      {row("break length", s.breakMins, 1, 30, "breakMins", "min")}
      {row("default session", s.defaultMins, 5, 120, "defaultMins", "min")}
      <div style={{ display: "flex", alignItems: "center", height: 48, boxShadow: "inset 0 -1px 0 var(--c-e2e0d9)" }}>
        <span style={{ fontSize: 11, flex: 1 }}>bedtime</span>
        <input type="time" value={s.bedtime} onChange={(e) => set({ bedtime: e.target.value })} style={{ ...inputStyle(false), height: 36, width: 110 }} />
      </div>
      <div style={{ fontSize: 8, letterSpacing: ".22em", color: "var(--c-a5a5ad)", margin: "18px 0 8px" }}>BLOCKED DURING A SESSION (COMPUTER)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {s.blockList.map((b) => (
          <span key={b} className="tap" onClick={() => set({ blockList: s.blockList.filter((x) => x !== b) })} style={{ display: "flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px", borderRadius: 9, background: "var(--c-eae7e1)", fontSize: 10 }}>
            {b}<Ms style={{ fontSize: 13, color: "var(--c-a5a5ad)" }}>close</Ms>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input style={{ ...inputStyle(false), flex: 1 }} value={block} onChange={(e) => setBlock(e.target.value)} placeholder="add a site, e.g. roblox.com" autoCapitalize="off" />
        <Btn style={{ width: 80, height: 44 }} onClick={() => { const b = block.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (b) { set({ blockList: [...new Set([...s.blockList, b])] }); setBlock(""); } }}>add</Btn>
      </div>
      <span style={{ display: "block", fontSize: 9, color: "var(--c-8a8a92)", lineHeight: 1.5, marginBottom: 18 }}>Study-only: {s.studyOnlySites.join(", ") || "none"} — open for videos that match today's tasks.</span>

      <div style={{ fontSize: 8, letterSpacing: ".22em", color: "var(--c-a5a5ad)", margin: "4px 0 8px" }}>DEVICES</div>
      {(devices ?? []).map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, height: 46, boxShadow: "inset 0 -1px 0 var(--c-e2e0d9)" }}>
          <Ms style={{ fontSize: 16, color: "var(--c-8a8a92)" }}>{d.role === "parent" ? "family_restroom" : d.role === "desktop" ? "desktop_windows" : "smartphone"}</Ms>
          <span style={{ fontSize: 11, flex: 1 }}>{d.name}</span>
          <span style={{ fontSize: 8, letterSpacing: ".12em", color: "var(--c-a5a5ad)" }}>{d.role.toUpperCase()}</span>
          <span className="tap" onClick={() => void client.send("DELETE", `/api/devices/${d.id}`).then(reload).catch(toastError)}><Ms style={{ fontSize: 17, color: "var(--c-a5a5ad)" }}>link_off</Ms></span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, margin: "12px 0" }}>
        <Btn onClick={() => makeCode("parent")} style={{ height: 42 }}>pair a parent</Btn>
        <Btn onClick={() => makeCode("owner")} style={{ height: 42, background: "var(--c-eae7e1)", color: "var(--c-111114)" }}>pair peter's device</Btn>
      </div>
      {code && <div style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 24, textAlign: "center", padding: 12, borderRadius: 12, background: "var(--c-111114)", color: "var(--c-ff4d17)", marginBottom: 12 }}>{code}</div>}
      <div className="tap" onClick={() => { savePairing("parent", null); onUnpair(); }} style={{ textAlign: "center", fontSize: 10, color: "var(--c-8a8a92)", padding: 12 }}>unpair this phone</div>
    </Sheet>
  );
}
