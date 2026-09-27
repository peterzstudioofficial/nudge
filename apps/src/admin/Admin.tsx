import { useEffect, useState } from "react";
import {
  SUBJECT_NAMES, tint, type Device, type Settings, type Snapshot, type TermDate, type Timetable, type Birthday, type SchoolItem,
  type FormTime, type HomeworkPlan, type SchoolDay, type Teacher, type Period, type CalEvent, type Activity, relativeDay, dateKey,
} from "@nudge/shared";
import { getClient, loadPairing, useHubGet, useSnapshot, type AppKey } from "../lib/hub";
import { Btn, D, DOTO, Ms, toast, toastError } from "../lib/ui";

/**
 * Hub setup. Opens from the Nudge app on a computer (or /admin on the hub).
 * Everything the designs don't have a screen for: school pages, the timetable, term dates,
 * birthdays, NFC tags, devices, and the school inbox.
 */

interface Config {
  terms: TermDate[];
  timetable: Timetable;
  birthdays: Birthday[];
  kept: string[];
  lastNfc: { uid: string; at: number } | null;
  schoolDay: SchoolDay;
  formTime: FormTime;
  homework: HomeworkPlan;
}

const WDAYS = ["mon", "tue", "wed", "thu", "fri"];
const SUBJECTS = Object.keys(SUBJECT_NAMES).filter((s) => !["bag", "free", "mine"].includes(s));

export function Admin({ app }: { app: AppKey }) {
  // Setup is for the owner's devices; parents have their own rules sheet in the parent app.
  const client = getClient(app)!;
  const { snap } = useSnapshot(client);
  const { data: cfg, reload } = useHubGet<Config>(client, "/api/config");
  const [tab, setTab] = useState<"school" | "week" | "people" | "wall" | "devices">("school");
  if (!snap || !cfg) return <div style={{ padding: 30, color: "#8e8e97", fontSize: 12 }}>connecting…</div>;
  const parent = app === "parent";
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "34px 22px 80px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 22 }}>
        <span style={{ fontFamily: D, fontSize: 34 }}>nudge setup</span>
        <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97" }}>{snap.termLabel.toUpperCase()}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 26, flexWrap: "wrap" }}>
        {(["school", "week", "people", "wall", "devices"] as const).map((t) => (
          <div key={t} className="tap" onClick={() => setTab(t)} style={{ padding: "9px 16px", borderRadius: 10, fontSize: 11, background: tab === t ? "#ff4d17" : "#15151b", color: tab === t ? "#0b0b0d" : "#c9c8c2" }}>{t}</div>
        ))}
      </div>
      {tab === "school" && <School snap={snap} disabled={parent} />}
      {tab === "week" && <Week cfg={cfg} reload={reload} disabled={parent} />}
      {tab === "people" && !parent && <People snap={snap} cfg={cfg} reload={reload} />}
      {tab === "people" && parent && <span style={{ fontSize: 11, color: "#5f5f67" }}>set up from Peter's own devices</span>}
      {tab === "wall" && <Wall snap={snap} cfg={cfg} reload={reload} disabled={parent} />}
      {tab === "devices" && <Devices app={app} />}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontSize: 9, letterSpacing: ".22em", color: "#8e8e97", marginBottom: 6 }}>{title.toUpperCase()}</div>
      {note && <div style={{ fontSize: 11, lineHeight: 1.55, color: "#6d6d77", marginBottom: 12, maxWidth: 620 }}>{note}</div>}
      {children}
    </div>
  );
}

const inp: React.CSSProperties = { height: 40, borderRadius: 10, border: 0, outline: 0, padding: "0 12px", background: "#15151b", color: "#f4f3ef", fontSize: 12, boxShadow: "inset 0 0 0 1px #24242c", minWidth: 0 };

/* --------------------------------- school -------------------------------- */

function School({ snap, disabled }: { snap: Snapshot; disabled: boolean }) {
  const client = getClient(disabled ? "parent" : "owner")!;
  const s = snap.settings;
  const { data: items, reload } = useHubGet<SchoolItem[]>(client, "/api/school/items");
  const [pages, setPages] = useState(s.schoolPages);
  const [senders, setSenders] = useState(s.schoolMailSenders.join(", "));
  useEffect(() => setPages(s.schoolPages), [s.schoolPages]);
  const save = async (p: Partial<Settings>) => {
    try {
      await client.send("PATCH", "/api/settings", p);
      toast("check_circle", "saved");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const act = async (id: string, type: string) => {
    try {
      await client.send("POST", `/api/school/items/${id}/action`, { type });
      toast("check_circle", type === "undo" ? "undone" : type === "dismiss" ? "dismissed" : `added as a ${type === "bag" ? "bag item" : type}`);
      reload();
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const st = snap.school;
  return (
    <>
      <Section title="connection" note="Nudge reads your school SharePoint pages and your Outlook inbox list in a hidden browser on the wall, using a sign-in you do once in the Nudge app on your computer. It only reads — it can't send, delete or mark anything as read.">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, background: "#101015", fontSize: 11, color: "#c9c8c2" }}>
          <Ms style={{ fontSize: 18, color: st.needsSignIn ? "#ff4d17" : st.signedIn ? "#1f7a4d" : "#5f5f67" }}>{st.signedIn && !st.needsSignIn ? "check_circle" : "error"}</Ms>
          <span style={{ flex: 1 }}>{st.running ? "reading school now…" : st.signedIn ? (st.needsSignIn ? "signed out — sign in again on your computer" : `signed in · last read ${st.lastOk ? new Date(st.lastOk).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "never"}`) : "not signed in yet"}{st.lastError && !st.needsSignIn ? ` · ${st.lastError}` : ""}</span>
          {!disabled && <Btn dark style={{ width: 120, height: 36 }} onClick={() => void client.send("POST", "/api/school/refresh").then(() => toast("sync", "reading school…"))}>read now</Btn>}
        </div>
      </Section>
      <Section title="school pages" note="The SharePoint pages to read (up to 10). Open each page in your browser and copy the address.">
        {pages.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input disabled={disabled} style={{ ...inp, width: 140 }} value={p.label} onChange={(e) => setPages(pages.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="year 10 hub" />
            <input disabled={disabled} style={{ ...inp, flex: 1 }} value={p.url} onChange={(e) => setPages(pages.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} placeholder="https://yourschool.sharepoint.com/sites/…" />
            {!disabled && <span className="tap" onClick={() => setPages(pages.filter((_, j) => j !== i))} style={{ width: 40, display: "flex", alignItems: "center", justifyContent: "center" }}><Ms style={{ fontSize: 18, color: "#8e8e97" }}>close</Ms></span>}
          </div>
        ))}
        {!disabled && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Btn dark style={{ width: 150, height: 38, background: "#15151b", color: "#c9c8c2" }} onClick={() => setPages([...pages, { label: "", url: "" }])}>add a page</Btn>
            <Btn dark style={{ width: 150, height: 38 }} onClick={() => {
              const bad = pages.find((p) => !/^https:\/\/[^/]+\.sharepoint\.com\//i.test(p.url));
              if (bad) return toast("error", "addresses must be https://…sharepoint.com/…");
              void save({ schoolPages: pages.map((p) => ({ label: p.label || "school page", url: p.url })) });
            }}>save pages</Btn>
          </div>
        )}
      </Section>
      <Section title="school mail" note="Only the inbox list is read (sender, subject, preview). Messages are never opened, so nothing is marked as read. Optionally, only keep mail from these senders (comma separated, e.g. @school.org.uk).">
        <div style={{ display: "flex", gap: 8 }}>
          <input disabled={disabled} style={{ ...inp, flex: 1 }} value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="@yourschool.org.uk" />
          {!disabled && <Btn dark style={{ width: 120, height: 40 }} onClick={() => save({ schoolMailSenders: senders.split(",").map((x) => x.trim()).filter(Boolean) })}>save</Btn>}
        </div>
      </Section>
      <Section title="from school" note="Turn anything into a task, a bag item, a reminder or a note. Everything can be undone.">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(items ?? []).slice(0, 40).map((it) => (
            <div key={it.id} style={{ display: "flex", gap: 12, padding: "12px 14px", borderRadius: 13, background: it.handled ? "#0d0d11" : "#131318", opacity: it.handled ? 0.6 : 1 }}>
              <span style={{ width: 4, borderRadius: 2, background: tint(it.subject), flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12, color: "#f4f3ef" }}>{it.title}</span>
                  <span style={{ fontSize: 8, letterSpacing: ".14em", color: it.kind === "info" ? "#5f5f67" : "#ff4d17" }}>{it.kind.toUpperCase()}{it.due ? ` · DUE ${it.due}` : ""}</span>
                </div>
                <span style={{ fontSize: 10, color: "#8e8e97" }}>{it.from} · {new Date(it.receivedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span style={{ fontSize: 11, lineHeight: 1.45, color: "#b6b5af" }}>{it.preview}</span>
                {!disabled && (
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {it.handled ? (
                      <Chip icon="undo" label={`undo ${it.action}`} go={() => act(it.id, "undo")} />
                    ) : (
                      <>
                        <Chip icon="checklist" label="task" go={() => act(it.id, "task")} />
                        <Chip icon="backpack" label="bag" go={() => act(it.id, "bag")} />
                        <Chip icon="push_pin" label="remind" go={() => act(it.id, "remind")} />
                        <Chip icon="note_add" label="note" go={() => act(it.id, "note")} />
                        <Chip icon="close" label="dismiss" go={() => act(it.id, "dismiss")} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {items && !items.length && <span style={{ fontSize: 11, color: "#5f5f67" }}>nothing yet</span>}
        </div>
      </Section>
    </>
  );
}

function Chip({ icon, label, go }: { icon: string; label: string; go: () => void }) {
  return (
    <span className="tap" onClick={go} style={{ display: "flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px", borderRadius: 9, background: "#1d1d25", fontSize: 10, color: "#c9c8c2" }}>
      <Ms style={{ fontSize: 14 }}>{icon}</Ms>{label}
    </span>
  );
}

/* ---------------------------------- week --------------------------------- */

const HW_SUBJECTS = ["eng", "maths", "bio", "chem", "physics", "biz", "drama", "art", "re", "history", "geog", "french", "spanish", "music", "cs"];

function Week({ cfg, reload, disabled }: { cfg: Config; reload: () => void; disabled: boolean }) {
  const client = getClient("owner")!;
  const [tt, setTt] = useState<Timetable>(cfg.timetable);
  const [terms, setTerms] = useState<TermDate[]>(cfg.terms);
  const [ft, setFt] = useState<FormTime>(cfg.formTime);
  const [hw, setHw] = useState<HomeworkPlan>(cfg.homework);
  const twoWeeks = Object.keys(tt).some((k) => /^[AB]/.test(k));
  const [wk, setWk] = useState<"A" | "B">("A");
  const prefix = twoWeeks ? wk : "";
  const put = async (path: string, body: unknown) => {
    try {
      await client.send("PUT", path, body);
      toast("check_circle", "saved");
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const setDay = (key: string, list: Period[]) => setTt({ ...tt, [key]: list });
  const toggleTwoWeeks = () => {
    if (twoWeeks) {
      const next: Timetable = {};
      for (let i = 1; i <= 5; i++) next[String(i)] = tt[`A${i}`] ?? [];
      setTt(next);
    } else {
      const next: Timetable = {};
      for (let i = 1; i <= 5; i++) next[`A${i}`] = next[`B${i}`] = tt[String(i)] ?? [];
      setTt(next);
    }
  };
  const hwKey = (i: number) => `${prefix}${i}`;
  const toggleHw = (i: number, subj: string) => {
    const cur = hw.days[hwKey(i)] ?? [];
    setHw({ ...hw, days: { ...hw.days, [hwKey(i)]: cur.includes(subj) ? cur.filter((x) => x !== subj) : [...cur, subj] } });
  };
  const slots = cfg.schoolDay.slots;
  return (
    <>
      <Section title="timetable" note="Shown on the wall and the phone, used to pack the bag and to work out when homework is due. Two-week timetables alternate A / B through each term, skipping half term. Each lesson fills the next bell slot; 2× makes it a double.">
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Chip icon={twoWeeks ? "check_box" : "check_box_outline_blank"} label="two-week timetable" go={() => !disabled && toggleTwoWeeks()} />
          {twoWeeks && (["A", "B"] as const).map((w) => (
            <span key={w} className="tap" onClick={() => setWk(w)} style={{ padding: "7px 14px", borderRadius: 9, fontSize: 11, background: wk === w ? "#ff4d17" : "#15151b", color: wk === w ? "#0b0b0d" : "#c9c8c2" }}>week {w}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, overflowX: "auto" }}>
          {WDAYS.map((d, i) => {
            const key = `${prefix}${i + 1}`;
            const list = tt[key] ?? [];
            let slot = 0;
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
                <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97", marginBottom: 2 }}>{d.toUpperCase()}{twoWeeks ? " " + wk : ""}</span>
                {list.map((p, j) => {
                  const at = slots[Math.min(slot, slots.length - 1)]?.start ?? "";
                  slot += p.span;
                  const upd = (patch: Partial<Period>) => setDay(key, list.map((x, k) => (k === j ? { ...x, ...patch } : x)));
                  return (
                    <div key={j} style={{ display: "flex", flexDirection: "column", gap: 3, minHeight: p.span > 1 ? 62 : 44, padding: "5px 6px", borderRadius: 8, background: "#15151b", borderLeft: `3px solid ${tint(p.subject)}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 8, color: "#5f5f67", width: 28 }}>{at}</span>
                        <select disabled={disabled} value={p.subject} onChange={(e) => upd({ subject: e.target.value })} style={{ flex: 1, minWidth: 0, background: "transparent", color: "#f4f3ef", border: 0, fontSize: 11 }}>
                          {SUBJECTS.map((s) => <option key={s} value={s} style={{ color: "#000" }}>{SUBJECT_NAMES[s]}</option>)}
                        </select>
                        <span className="tap" onClick={() => !disabled && upd({ span: p.span > 1 ? 1 : 2 })} style={{ fontSize: 9, color: p.span > 1 ? "#ff4d17" : "#5f5f67" }}>2×</span>
                        <span className="tap" onClick={() => !disabled && setDay(key, list.filter((_, k) => k !== j))}><Ms style={{ fontSize: 13, color: "#5f5f67" }}>close</Ms></span>
                      </div>
                      <div style={{ display: "flex", gap: 4, paddingLeft: 32 }}>
                        <input disabled={disabled} value={p.room ?? ""} placeholder="room" onChange={(e) => upd({ room: e.target.value.slice(0, 12) || undefined })} style={{ ...mini, width: 44 }} />
                        <input disabled={disabled} value={p.teacher ?? ""} placeholder="teacher" onChange={(e) => upd({ teacher: e.target.value.toUpperCase().slice(0, 8) || undefined })} style={{ ...mini, width: 50 }} />
                      </div>
                    </div>
                  );
                })}
                {!disabled && slot < slots.length && <span className="tap" onClick={() => setDay(key, [...list, { subject: "maths", span: 1 }])} style={{ height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #2a2a33", color: "#5f5f67" }}><Ms style={{ fontSize: 15 }}>add</Ms></span>}
              </div>
            );
          })}
        </div>
        {!disabled && <Btn dark style={{ width: 170, height: 38, marginTop: 12 }} onClick={() => put("/api/config/timetable", tt)}>save timetable</Btn>}
      </Section>

      <Section title="homework plan" note={`Tap the subjects that set homework each day${twoWeeks ? ` (week ${wk})` : ""}. After school the wall adds each one as a task, due at that subject's next lesson and sized from the weekly allowance (e.g. ${hw.weeklyMinsPerSubject} min a week, set twice = ${Math.round(hw.weeklyMinsPerSubject / 2)} min each). They're marked “expected” — tap NOT SET on your phone if one wasn't given.`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {WDAYS.map((d, i) => (
            <div key={d} style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97", width: 44 }}>{d.toUpperCase()}</span>
              {HW_SUBJECTS.filter((x) => Object.values(tt).some((l) => l.some((p) => p.subject === x))).map((x) => {
                const on = (hw.days[hwKey(i + 1)] ?? []).includes(x);
                return (
                  <span key={x} className="tap" onClick={() => !disabled && toggleHw(i + 1, x)} style={{ padding: "6px 9px", borderRadius: 8, fontSize: 10, background: on ? tint(x) : "#15151b", color: on ? "#fff" : "#6d6d77" }}>{SUBJECT_NAMES[x]}</span>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <Chip icon={hw.on ? "toggle_on" : "toggle_off"} label={hw.on ? "adding homework automatically" : "off"} go={() => !disabled && setHw({ ...hw, on: !hw.on })} />
          <span style={{ fontSize: 11, color: "#8e8e97" }}>max per subject per week</span>
          <input disabled={disabled} type="number" min={10} max={240} style={{ ...inp, width: 80 }} value={hw.weeklyMinsPerSubject} onChange={(e) => setHw({ ...hw, weeklyMinsPerSubject: Math.max(10, Math.min(240, Number(e.target.value) || 60)) })} />
          <span style={{ fontSize: 11, color: "#8e8e97" }}>min</span>
          {!disabled && <Btn dark style={{ width: 150, height: 38 }} onClick={() => put("/api/config/homework", hw)}>save plan</Btn>}
        </div>
      </Section>

      <Section title="registration · 08:30" note="What happens in form time each day. Shown on the phone and known to the assistant.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
          {WDAYS.map((d, i) => (
            <label key={d} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97" }}>{d.toUpperCase()}</span>
              <input disabled={disabled} style={inp} value={ft[String(i + 1)] ?? ""} onChange={(e) => setFt({ ...ft, [String(i + 1)]: e.target.value.slice(0, 40) })} />
            </label>
          ))}
        </div>
        {!disabled && <Btn dark style={{ width: 150, height: 38, marginTop: 10 }} onClick={() => put("/api/config/formtime", ft)}>save</Btn>}
      </Section>

      <Calendar disabled={disabled} reload={reload} />

      <Section title="term dates · churcher's college" note="From the school's 2026/27 calendar. Weeks A / B restart at the letter shown each term; importing a term's calendar PDF sets it automatically.">
        {terms.map((t, i) => (
          <div key={t.term} style={{ padding: 12, borderRadius: 12, background: "#101015", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, width: 110 }}>{t.term}</span>
              <input disabled={disabled} type="date" style={inp} value={t.start} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span style={{ fontSize: 10, color: "#5f5f67" }}>to</span>
              <input disabled={disabled} type="date" style={inp} value={t.end} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <span className="tap" onClick={() => !disabled && setTerms(terms.map((x, j) => (j === i ? { ...x, abStart: (x.abStart ?? "A") === "A" ? "B" : "A" } : x)))} style={{ fontSize: 9, letterSpacing: ".14em", padding: "5px 8px", borderRadius: 7, background: "#15151b", color: "#c9c8c2" }}>STARTS WEEK {t.abStart ?? "A"}</span>
              <span className="tap" onClick={() => !disabled && setTerms(terms.map((x, j) => (j === i ? { ...x, confirmed: !x.confirmed } : x)))} style={{ fontSize: 9, letterSpacing: ".14em", padding: "5px 8px", borderRadius: 7, background: t.confirmed ? "#1f7a4d33" : "#ff4d1733", color: t.confirmed ? "#6fcf97" : "#ff8355" }}>{t.confirmed ? "CONFIRMED" : "ESTIMATE"}</span>
            </div>
            {t.breaks.map((b, k) => (
              <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 118 }}>
                <span style={{ fontSize: 10, color: "#8e8e97", width: 70 }}>{b.label}</span>
                <input disabled={disabled} type="date" style={inp} value={b.start} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, breaks: x.breaks.map((y, l) => (l === k ? { ...y, start: e.target.value } : y)) } : x)))} />
                <input disabled={disabled} type="date" style={inp} value={b.end} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, breaks: x.breaks.map((y, l) => (l === k ? { ...y, end: e.target.value } : y)) } : x)))} />
              </div>
            ))}
            {t.note && <div style={{ fontSize: 10, color: "#5f5f67", marginTop: 6, marginLeft: 118 }}>{t.note}</div>}
          </div>
        ))}
        {!disabled && <Btn dark style={{ width: 170, height: 38 }} onClick={() => put("/api/config/terms", terms)}>save term dates</Btn>}
      </Section>
    </>
  );
}

const mini: React.CSSProperties = { height: 22, borderRadius: 6, border: 0, outline: 0, padding: "0 5px", background: "#0d0d11", color: "#c9c8c2", fontSize: 9, minWidth: 0 };

/** POST a file straight to the hub (the JSON client can't send PDFs). */
async function upload<T>(path: string, file: Blob, type: string): Promise<T> {
  const p = loadPairing("owner");
  if (!p) throw new Error("not paired");
  const res = await fetch(`${p.hub}${path}`, { method: "POST", headers: { authorization: "Bearer " + p.token, "content-type": type }, body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `failed (${res.status})`);
  return body as T;
}

function Calendar({ disabled, reload }: { disabled: boolean; reload: () => void }) {
  const client = getClient("owner")!;
  const today = dateKey();
  const { data: events, reload: again } = useHubGet<CalEvent[]>(client, "/api/events?days=120");
  const [busy, setBusy] = useState(false);
  const pick = (accept: string, go: (f: File) => Promise<void>) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = accept;
    i.onchange = () => i.files?.[0] && void go(i.files[0]);
    i.click();
  };
  const readPdf = async (f: File) => {
    setBusy(true);
    try {
      const r = await upload<{ events: number; weeks: number }>("/api/config/calendar", f, "application/pdf");
      toast("event", `${r.events} dates, ${r.weeks} weeks read`);
      again();
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const importPack = async (f: File) => {
    try {
      const pack = JSON.parse(await f.text());
      const r = await client.send<{ imported: string[] }>("POST", "/api/config/import", pack);
      toast("check_circle", `imported: ${r?.imported.join(", ")}`);
      again();
      reload();
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Section title="school calendar" note="Upload each term's calendar PDF: the wall keeps term dates, your year's events, mocks, parents' evenings and creative things, and learns which weeks are A and B. Sports fixtures and other years are left out.">
      {!disabled && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Btn dark style={{ width: 190, height: 38 }} disabled={busy} onClick={() => pick("application/pdf", readPdf)}>{busy ? "reading…" : "upload calendar PDF"}</Btn>
          <Btn dark style={{ width: 190, height: 38, background: "#15151b", color: "#c9c8c2" }} onClick={() => pick("application/json,.json", importPack)}>import setup file</Btn>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto" }}>
        {(events ?? []).map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11, padding: "6px 2px", boxShadow: "inset 0 -1px 0 #17171d" }}>
            <span style={{ width: 86, fontSize: 9, letterSpacing: ".08em", color: "#8e8e97" }}>{relativeDay(e.date, today).toUpperCase()} {e.time ?? ""}</span>
            <span style={{ flex: 1, minWidth: 0, color: "#dedad4" }}>{e.title}</span>
            <span style={{ fontSize: 8, letterSpacing: ".1em", color: "#5f5f67" }}>{e.tags.join(" · ").toUpperCase()}</span>
          </div>
        ))}
        {events && !events.length && <span style={{ fontSize: 11, color: "#5f5f67" }}>no dates yet</span>}
      </div>
    </Section>
  );
}

/* --------------------------------- people -------------------------------- */

function People({ snap, cfg, reload }: { snap: Snapshot; cfg: Config; reload: () => void }) {
  const client = getClient("owner")!;
  const s = snap.settings;
  const [me, setMe] = useState({ yearGroup: s.yearGroup, house: s.house, profile: s.profile });
  const [interests, setInterests] = useState(s.interests.join(", "));
  const { data: acts, reload: reActs } = useHubGet<Activity[]>(client, "/api/config/activities");
  const [actList, setActList] = useState<Activity[] | null>(null);
  const list = actList ?? acts ?? [];
  const { data: staff, reload: again } = useHubGet<{ teachers: Teacher[]; matches: { code: string; subject: string; name: string | null }[] }>(client, "/api/config/teachers");
  const [paste, setPaste] = useState("");
  const [bd, setBd] = useState(() => cfg.birthdays.map((b) => `${b.name}: ${b.date.slice(3)}/${b.date.slice(0, 2)}`).join("\n"));
  const saveMe = async () => {
    try {
      await client.send("PATCH", "/api/settings", { ...me, interests: interests.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12) });
      toast("check_circle", "saved");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const addStaff = async () => {
    try {
      await client.send("POST", "/api/config/teachers/paste", { text: paste });
      setPaste("");
      toast("check_circle", "staff list updated");
      again();
    } catch (e) {
      toastError(e);
    }
  };
  const nameCode = async (code: string, subject: string) => {
    const name = prompt(`Who is ${code} (${SUBJECT_NAMES[subject] ?? subject})? Full name as on the staff list:`);
    if (!name?.trim()) return;
    const list = (staff?.teachers ?? []).filter((t) => t.code !== code);
    const hit = list.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    const next = hit ? list.map((t) => (t === hit ? { ...t, code } : t)) : [...list, { name: name.trim(), role: `Teacher of ${SUBJECT_NAMES[subject] ?? subject}`, code }];
    try {
      await client.send("PUT", "/api/config/teachers", next);
      again();
    } catch (e) {
      toastError(e);
    }
  };
  const saveBd = async () => {
    const out: Birthday[] = [];
    for (const line of bd.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = line.match(/^(.*?)[:\s]\s*(\d{1,2})[/.-](\d{1,2})$/);
      if (!m || !m[1].trim()) return toast("error", `can't read “${line.slice(0, 30)}” — use Name: DD/MM`);
      out.push({ name: m[1].trim().slice(0, 40), date: `${m[3].padStart(2, "0")}-${m[2].padStart(2, "0")}` });
    }
    try {
      await client.send("PUT", "/api/config/birthdays", out);
      toast("cake", `${out.length} birthdays saved`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <Section title="about you" note="Given to the assistant so its help fits you, and used to pick your year's dates out of the school calendar.">
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input style={{ ...inp, width: 140 }} placeholder="year group, e.g. 5th Year" value={me.yearGroup} onChange={(e) => setMe({ ...me, yearGroup: e.target.value.slice(0, 20) })} />
          <input style={{ ...inp, width: 140 }} placeholder="house (optional)" value={me.house} onChange={(e) => setMe({ ...me, house: e.target.value.slice(0, 20) })} />
        </div>
        <input style={{ ...inp, width: "100%", marginBottom: 8 }} placeholder="things you're part of, e.g. senior production, musical theatre" value={interests} onChange={(e) => setInterests(e.target.value)} />
        <textarea style={{ ...inp, width: "100%", height: 90, padding: 12, lineHeight: 1.5, resize: "vertical" }} value={me.profile} onChange={(e) => setMe({ ...me, profile: e.target.value.slice(0, 800) })} placeholder="GCSE subjects, what you enjoy, plans…" />
        <Btn dark style={{ width: 120, height: 38, marginTop: 8 }} onClick={saveMe}>save</Btn>
      </Section>

      <Section title="weekly commitments" note="Rehearsals, clubs, lessons outside school. Shown on your phone, known to the assistant, and homework is planned around them (an evening with rehearsal till six gets less).">
        {list.map((a, i) => {
          const upd = (p: Partial<Activity>) => setActList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={a.id || i} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inp, width: 200 }} value={a.name} onChange={(e) => upd({ name: e.target.value })} placeholder="senior production rehearsals" />
              {WDAYS.map((d, k) => (
                <span key={d} className="tap" onClick={() => upd({ days: a.days.includes(k + 1) ? a.days.filter((x) => x !== k + 1) : [...a.days, k + 1].sort() })} style={{ padding: "6px 8px", borderRadius: 7, fontSize: 9, background: a.days.includes(k + 1) ? "#ff4d17" : "#15151b", color: a.days.includes(k + 1) ? "#0b0b0d" : "#8e8e97" }}>{d}</span>
              ))}
              <input type="time" style={inp} value={a.start} onChange={(e) => upd({ start: e.target.value })} />
              <input type="time" style={inp} value={a.end} onChange={(e) => upd({ end: e.target.value })} />
              <input style={{ ...inp, width: 110 }} value={a.where} onChange={(e) => upd({ where: e.target.value })} placeholder="where" />
              <span className="tap" onClick={() => setActList(list.filter((_, j) => j !== i))}><Ms style={{ fontSize: 16, color: "#5f5f67" }}>close</Ms></span>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn dark style={{ width: 130, height: 36, background: "#15151b", color: "#c9c8c2" }} onClick={() => setActList([...list, { id: "", name: "", days: [1], start: "16:00", end: "17:00", where: "", termOnly: true }])}>add</Btn>
          <Btn dark style={{ width: 130, height: 36 }} onClick={() => {
            if (list.some((a) => !a.name.trim() || !a.days.length || a.end <= a.start)) return toast("error", "each needs a name, a day and an end after its start");
            void client.send("PUT", "/api/config/activities", list.map(({ id, ...a }) => (id ? { id, ...a } : a))).then(() => { toast("check_circle", "saved"); setActList(null); reActs(); }).catch(toastError);
          }}>save</Btn>
        </div>
      </Section>

      <Section title="your teachers" note="Matched from the codes on your timetable. The staff list stays on the wall only — it's never shown in the parent app. Emails from your teachers get filed under their subject.">
        {(staff?.matches ?? []).map((m) => (
          <div key={m.code} style={{ display: "flex", gap: 10, alignItems: "center", height: 36, fontSize: 11, boxShadow: "inset 0 -1px 0 #17171d" }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: tint(m.subject) }} />
            <span style={{ fontFamily: DOTO, fontWeight: 900, width: 44 }}>{m.code}</span>
            <span style={{ width: 90, color: "#8e8e97" }}>{SUBJECT_NAMES[m.subject] ?? m.subject}</span>
            <span style={{ flex: 1, color: m.name ? "#f4f3ef" : "#ff8355" }}>{m.name ?? "not matched"}</span>
            <span className="tap" onClick={() => nameCode(m.code, m.subject)}><Ms style={{ fontSize: 15, color: "#5f5f67" }}>edit</Ms></span>
          </div>
        ))}
        <div style={{ fontSize: 10, color: "#6d6d77", margin: "12px 0 6px" }}>{staff?.teachers.length ?? 0} staff saved. Paste more from the school site (name on one line, job on the next):</div>
        <textarea style={{ ...inp, width: "100%", height: 80, padding: 12, resize: "vertical" }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Nicola Clements\nTeacher of Drama"} />
        <Btn dark style={{ width: 150, height: 38, marginTop: 8 }} disabled={!paste.trim()} onClick={addStaff}>add to staff list</Btn>
      </Section>

      <Section title="birthdays" note="One per line, Name: DD/MM. Shown on the wall up to three days ahead. Also editable on your phone (settings › birthdays).">
        <textarea style={{ ...inp, width: "100%", height: 260, padding: 12, lineHeight: 1.55, resize: "vertical", fontFamily: "inherit" }} value={bd} onChange={(e) => setBd(e.target.value)} />
        <Btn dark style={{ width: 150, height: 38, marginTop: 8 }} onClick={saveBd}>save birthdays</Btn>
      </Section>
    </>
  );
}

/* ---------------------------------- wall --------------------------------- */

function Wall({ snap, cfg, reload, disabled }: { snap: Snapshot; cfg: Config; reload: () => void; disabled: boolean }) {
  const client = getClient("owner")!;
  const s = snap.settings;
  const [kept, setKept] = useState(cfg.kept.join(", "));
  const [times, setTimes] = useState({ alarm: s.alarm, leaveForSchool: s.leaveForSchool });
  const [loc, setLoc] = useState(s.location);
  const [model, setModel] = useState(s.aiModel);
  const [voiceModel, setVoiceModel] = useState(s.voiceModel);
  const set = async (p: Partial<Settings>) => {
    try {
      await client.send("PATCH", "/api/settings", p);
      toast("check_circle", "saved");
      void client.snapshot();
    } catch (e) {
      toastError(e);
    }
  };
  const put = async (path: string, body: unknown) => {
    try {
      await client.send("PUT", path, body);
      toast("check_circle", "saved");
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const tagActions = ["home", "desk", "morning", "homework", "bag", "break"] as const;
  return (
    <>
      <Section title="mornings" note="The alarm rings on school days only. Weekends, half term and holidays are lie-ins.">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#8e8e97" }}>alarm</span>
          <input disabled={disabled} type="time" style={inp} value={times.alarm} onChange={(e) => setTimes({ ...times, alarm: e.target.value })} />
          <span style={{ fontSize: 11, color: "#8e8e97" }}>leave for school</span>
          <input disabled={disabled} type="time" style={inp} value={times.leaveForSchool} onChange={(e) => setTimes({ ...times, leaveForSchool: e.target.value })} />
          {!disabled && <Btn dark style={{ width: 90, height: 38 }} onClick={() => set(times)}>save</Btn>}
        </div>
      </Section>
      <Section title="nfc tags" note="Tap a new tag on the wall's reader, then give it a job here. Tags are only triggers — they don't unlock anything.">
        {cfg.lastNfc && !s.nfcTags[cfg.lastNfc.uid] && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, borderRadius: 12, background: "#101015", marginBottom: 8, flexWrap: "wrap" }}>
            <Ms style={{ fontSize: 17, color: "#ff4d17" }}>nfc</Ms>
            <span style={{ fontSize: 11 }}>new tag <span style={{ fontFamily: DOTO, fontWeight: 900 }}>{cfg.lastNfc.uid}</span></span>
            {tagActions.map((a) => <Chip key={a} icon="sell" label={a} go={() => set({ nfcTags: { ...s.nfcTags, [cfg.lastNfc!.uid]: a } })} />)}
          </div>
        )}
        {Object.entries(s.nfcTags).map(([uid, a]) => (
          <div key={uid} style={{ display: "flex", gap: 10, alignItems: "center", height: 40, fontSize: 11 }}>
            <span style={{ fontFamily: DOTO, fontWeight: 900, width: 160 }}>{uid}</span>
            <span style={{ flex: 1, color: "#c9c8c2" }}>{a}</span>
            {!disabled && <span className="tap" onClick={() => { const n = { ...s.nfcTags }; delete n[uid]; void set({ nfcTags: n }); }}><Ms style={{ fontSize: 16, color: "#5f5f67" }}>close</Ms></span>}
          </div>
        ))}
        {!Object.keys(s.nfcTags).length && !cfg.lastNfc && <span style={{ fontSize: 11, color: "#5f5f67" }}>no tags yet</span>}
      </Section>
      <Section title="always in the bag" note="Things that live in the bag and never need packing (comma separated).">
        <div style={{ display: "flex", gap: 8 }}>
          <input disabled={disabled} style={{ ...inp, flex: 1 }} value={kept} onChange={(e) => setKept(e.target.value)} />
          {!disabled && <Btn dark style={{ width: 90, height: 40 }} onClick={() => put("/api/config/kept", kept.split(",").map((x) => x.trim()).filter(Boolean))}>save</Btn>}
        </div>
      </Section>
      <Section title="weather + assistant">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <input disabled={disabled} style={{ ...inp, width: 140 }} value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />
          <input disabled={disabled} style={{ ...inp, width: 100 }} value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: Number(e.target.value) || 0 })} />
          <input disabled={disabled} style={{ ...inp, width: 100 }} value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: Number(e.target.value) || 0 })} />
          {!disabled && <Btn dark style={{ width: 90, height: 38 }} onClick={() => set({ location: loc })}>save</Btn>}
        </div>
        <AiStatus />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#8e8e97" }}>text model (OpenRouter)</span>
          <input disabled={disabled} style={{ ...inp, width: 260 }} value={model} onChange={(e) => setModel(e.target.value)} />
          {!disabled && <Btn dark style={{ width: 90, height: 38 }} onClick={() => set({ aiModel: model.trim() || "deepseek/deepseek-v4.1-flash" })}>save</Btn>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: "#8e8e97" }}>voice model (Gemini Live)</span>
          <input disabled={disabled} style={{ ...inp, width: 200 }} value={voiceModel} onChange={(e) => setVoiceModel(e.target.value)} />
          {!disabled && <Btn dark style={{ width: 90, height: 38 }} onClick={() => set({ voiceModel: voiceModel.trim() || "gemini-3.8-live" })}>save</Btn>}
          {!disabled && <Chip icon={s.voiceReplies ? "volume_up" : "volume_off"} label={s.voiceReplies ? "spoken replies on" : "spoken replies off"} go={() => set({ voiceReplies: !s.voiceReplies })} />}
        </div>
        <div style={{ fontSize: 10, color: "#5f5f67", marginTop: 8, lineHeight: 1.5 }}>Keys live only on the hub (sudo nudge key openrouter | gemini | composio). Every text request is routed to zero-data-retention providers that don't collect data; if none is free for the model it fails rather than falling back to one that keeps data. Search over your notes, school stuff and calendar runs on the hub; only the few results a question needs go out with it. Voice notes are turned into text on the hub too. Talking to the wall uses Gemini Live when a key is set (Google keeps paid-tier requests briefly for abuse checks only, and doesn't train on them); without it, speech is turned into text on the hub and goes to the text model.</div>
      </Section>
      {!disabled && <Apps />}
    </>
  );
}

/** Connected apps (Composio): sign in once in your browser, then the assistant can use them. */
function Apps() {
  const client = getClient("owner")!;
  const { data, reload } = useHubGet<{ on: boolean; suggested: { slug: string; name: string }[]; toolkits: string[]; connected: { toolkit: string; status: string; id: string }[] }>(client, "/api/apps");
  const [custom, setCustom] = useState("");
  if (!data) return null;
  const connect = async (toolkit: string) => {
    try {
      const r = await client.send<{ url: string | null }>("POST", "/api/apps/connect", { toolkit });
      if (r?.url) window.open(r.url, "_blank", "noopener");
      toast("open_in_new", r?.url ? "finish signing in in the new tab" : "connected");
      setTimeout(reload, 4000);
    } catch (e) {
      toastError(e);
    }
  };
  const byKit = new Map(data.connected.map((c) => [c.toolkit, c]));
  return (
    <Section title="connected apps" note="Let the assistant use your other apps (through Composio). Reading happens straight away; anything that would send, post, add or delete shows you exactly what it will do and waits for your yes. Sign-ins are held by Composio, not on the wall.">
      {!data.on && <div style={{ fontSize: 11, color: "#8e8e97", marginBottom: 10 }}>Off — add a Composio key on the hub: <span style={{ fontFamily: DOTO, fontWeight: 900 }}>sudo nudge key composio</span></div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[...data.suggested, ...data.toolkits.filter((t) => !data.suggested.some((x) => x.slug === t)).map((t) => ({ slug: t, name: t }))].map((t) => {
          const c = byKit.get(t.slug);
          const ok = c?.status === "ACTIVE";
          return (
            <span key={t.slug} className="tap" onClick={() => (data.on ? (c ? void client.send("DELETE", `/api/apps/${c.id}`).then(reload).catch(toastError) : void connect(t.slug)) : undefined)} title={c ? "tap to disconnect" : "tap to connect"} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 9, fontSize: 10, background: ok ? "#1f7a4d33" : "#15151b", color: ok ? "#6fcf97" : data.on ? "#c9c8c2" : "#5f5f67" }}>
              <Ms style={{ fontSize: 14 }}>{ok ? "link" : c ? "hourglass_top" : "add_link"}</Ms>{t.name}
            </span>
          );
        })}
      </div>
      {data.on && (
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inp, width: 200 }} value={custom} onChange={(e) => setCustom(e.target.value.toLowerCase().trim())} placeholder="another app, e.g. todoist" />
          <Btn dark style={{ width: 110, height: 40 }} disabled={!custom} onClick={() => void connect(custom)}>connect</Btn>
        </div>
      )}
    </Section>
  );
}

function AiStatus() {
  const client = getClient("owner")!;
  const { data } = useHubGet<{
    text: { on: boolean; model: string };
    voice: { on: boolean; onDevice: boolean };
    search: { items: number; semantic: boolean };
    connections: { on: boolean };
    spend: { month: string; usd: number };
  }>(client, "/api/ai/status");
  if (!data) return null;
  const pill = (on: boolean, label: string) => (
    <span style={{ fontSize: 9, letterSpacing: ".12em", padding: "5px 9px", borderRadius: 7, background: on ? "#1f7a4d33" : "#15151b", color: on ? "#6fcf97" : "#5f5f67" }}>{label.toUpperCase()} {on ? "ON" : "OFF"}</span>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
      {pill(data.text.on, "text")}
      {pill(data.voice.on, "voice")}
      {pill(data.connections.on, "apps")}
      {pill(data.voice.onDevice, "on-device speech")}
      {pill(data.search.semantic, "smart search")}
      <span style={{ fontSize: 10, color: "#8e8e97", marginLeft: 6 }}>spent this month: ${data.spend.usd.toFixed(3)}</span>
    </div>
  );
}

/* -------------------------------- devices -------------------------------- */

function Devices({ app }: { app: AppKey }) {
  const client = getClient(app)!;
  const { data: devices, reload } = useHubGet<Device[]>(client, "/api/devices");
  const [code, setCode] = useState("");
  const make = async (role: "owner" | "desktop" | "parent") => {
    try {
      const r = await client.send<{ code: string }>("POST", "/api/pairing-codes", { role });
      if (r) setCode(`${role} · ${r.code.slice(0, 3)} ${r.code.slice(3)}`);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Section title="paired devices" note="Every phone, computer and parent app has its own key. Remove one and it stops working straight away.">
      {(devices ?? []).map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, height: 48, boxShadow: "inset 0 -1px 0 #17171d" }}>
          <Ms style={{ fontSize: 17, color: "#8e8e97" }}>{d.role === "parent" ? "family_restroom" : d.role === "desktop" ? "desktop_windows" : "smartphone"}</Ms>
          <span style={{ flex: 1, fontSize: 12 }}>{d.name}</span>
          <span style={{ fontSize: 9, letterSpacing: ".12em", color: "#5f5f67", width: 70 }}>{d.role.toUpperCase()}</span>
          <span style={{ fontSize: 9, color: "#5f5f67", width: 120 }}>{d.lastSeen ? `seen ${new Date(d.lastSeen).toLocaleDateString("en-GB")}` : ""}</span>
          <span className="tap" onClick={() => void client.send("DELETE", `/api/devices/${d.id}`).then(reload).catch(toastError)}><Ms style={{ fontSize: 17, color: "#8e8e97" }}>link_off</Ms></span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Btn dark style={{ width: 170, height: 38 }} onClick={() => make("owner")}>pair a phone</Btn>
        <Btn dark style={{ width: 170, height: 38 }} onClick={() => make("desktop")}>pair a computer</Btn>
        {app === "parent" && <Btn dark style={{ width: 170, height: 38 }} onClick={() => make("parent")}>pair a parent</Btn>}
      </div>
      {code && <div style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 28, marginTop: 14, color: "#ff4d17" }}>{code}</div>}
    </Section>
  );
}
