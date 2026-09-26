import { useEffect, useState } from "react";
import { SUBJECT_NAMES, tint, type Device, type Settings, type Snapshot, type TermDate, type Timetable, type Birthday, type SchoolItem } from "@nudge/shared";
import { getClient, useHubGet, useSnapshot, type AppKey } from "../lib/hub";
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
}

const WDAYS = ["mon", "tue", "wed", "thu", "fri"];
const SUBJECTS = Object.keys(SUBJECT_NAMES).filter((s) => !["bag", "free", "mine"].includes(s));

export function Admin({ app }: { app: AppKey }) {
  // Setup is for the owner's devices; parents have their own rules sheet in the parent app.
  const client = getClient(app)!;
  const { snap } = useSnapshot(client);
  const { data: cfg, reload } = useHubGet<Config>(client, "/api/config");
  const [tab, setTab] = useState<"school" | "week" | "wall" | "devices">("school");
  if (!snap || !cfg) return <div style={{ padding: 30, color: "#8e8e97", fontSize: 12 }}>connecting…</div>;
  const parent = app === "parent";
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "34px 22px 80px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 22 }}>
        <span style={{ fontFamily: D, fontSize: 34 }}>nudge setup</span>
        <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97" }}>{snap.termLabel.toUpperCase()}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 26, flexWrap: "wrap" }}>
        {(["school", "week", "wall", "devices"] as const).map((t) => (
          <div key={t} className="tap" onClick={() => setTab(t)} style={{ padding: "9px 16px", borderRadius: 10, fontSize: 11, background: tab === t ? "#ff4d17" : "#15151b", color: tab === t ? "#0b0b0d" : "#c9c8c2" }}>{t}</div>
        ))}
      </div>
      {tab === "school" && <School snap={snap} disabled={parent} />}
      {tab === "week" && <Week cfg={cfg} reload={reload} disabled={parent} />}
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

function Week({ cfg, reload, disabled }: { cfg: Config; reload: () => void; disabled: boolean }) {
  const client = getClient("owner")!;
  const [tt, setTt] = useState<Timetable>(cfg.timetable);
  const [terms, setTerms] = useState<TermDate[]>(cfg.terms);
  const put = async (path: string, body: unknown) => {
    try {
      await client.send("PUT", path, body);
      toast("check_circle", "saved");
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <Section title="timetable" note="Shown on the morning brief and used to pack the bag. Tap a lesson to change it; + adds one; 2× makes it a double.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {WDAYS.map((d, i) => {
            const key = String(i + 1);
            const list = tt[key] ?? [];
            return (
              <div key={d} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#8e8e97", marginBottom: 2 }}>{d.toUpperCase()}</span>
                {list.map((p, j) => (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 4, height: p.span > 1 ? 50 : 32, padding: "0 6px", borderRadius: 8, background: "#15151b", borderLeft: `3px solid ${tint(p.subject)}` }}>
                    <select disabled={disabled} value={p.subject} onChange={(e) => setTt({ ...tt, [key]: list.map((x, k) => (k === j ? { ...x, subject: e.target.value } : x)) })} style={{ flex: 1, minWidth: 0, background: "transparent", color: "#f4f3ef", border: 0, fontSize: 11 }}>
                      {SUBJECTS.map((s) => <option key={s} value={s} style={{ color: "#000" }}>{SUBJECT_NAMES[s]}</option>)}
                    </select>
                    <span className="tap" onClick={() => !disabled && setTt({ ...tt, [key]: list.map((x, k) => (k === j ? { ...x, span: x.span > 1 ? 1 : 2 } : x)) })} style={{ fontSize: 9, color: p.span > 1 ? "#ff4d17" : "#5f5f67" }}>2×</span>
                    <span className="tap" onClick={() => !disabled && setTt({ ...tt, [key]: list.filter((_, k) => k !== j) })}><Ms style={{ fontSize: 13, color: "#5f5f67" }}>close</Ms></span>
                  </div>
                ))}
                {!disabled && <span className="tap" onClick={() => setTt({ ...tt, [key]: [...list, { subject: "maths", span: 1 }] })} style={{ height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #2a2a33", color: "#5f5f67" }}><Ms style={{ fontSize: 15 }}>add</Ms></span>}
              </div>
            );
          })}
        </div>
        {!disabled && <Btn dark style={{ width: 170, height: 38, marginTop: 12 }} onClick={() => put("/api/config/timetable", tt)}>save timetable</Btn>}
      </Section>
      <Section title="term dates · churcher's college" note="Autumn 2026 is from the school website. Terms marked “estimate” were not published when this was set up — check them against the school site. The wall also re-reads the school's term-dates page every week.">
        {terms.map((t, i) => (
          <div key={t.term} style={{ padding: 12, borderRadius: 12, background: "#101015", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, width: 110 }}>{t.term}</span>
              <input disabled={disabled} type="date" style={inp} value={t.start} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span style={{ fontSize: 10, color: "#5f5f67" }}>to</span>
              <input disabled={disabled} type="date" style={inp} value={t.end} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
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

/* ---------------------------------- wall --------------------------------- */

function Wall({ snap, cfg, reload, disabled }: { snap: Snapshot; cfg: Config; reload: () => void; disabled: boolean }) {
  const client = getClient("owner")!;
  const s = snap.settings;
  const [bdays, setBdays] = useState(cfg.birthdays);
  const [kept, setKept] = useState(cfg.kept.join(", "));
  const [times, setTimes] = useState({ alarm: s.alarm, leaveForSchool: s.leaveForSchool });
  const [loc, setLoc] = useState(s.location);
  const [model, setModel] = useState(s.aiModel);
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
      <Section title="birthdays" note="Shown on the morning brief a few days ahead, and on the day.">
        {bdays.map((b, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input disabled={disabled} style={{ ...inp, width: 180 }} value={b.name} onChange={(e) => setBdays(bdays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="mum" />
            <input disabled={disabled} style={{ ...inp, width: 110 }} value={b.date} onChange={(e) => setBdays(bdays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} placeholder="MM-DD" />
            <span className="tap" onClick={() => setBdays(bdays.filter((_, j) => j !== i))} style={{ width: 36, display: "flex", alignItems: "center", justifyContent: "center" }}><Ms style={{ fontSize: 16, color: "#5f5f67" }}>close</Ms></span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn dark style={{ width: 130, height: 36, background: "#15151b", color: "#c9c8c2" }} onClick={() => setBdays([...bdays, { name: "", date: "" }])}>add</Btn>
          <Btn dark style={{ width: 130, height: 36 }} onClick={() => {
            if (bdays.some((b) => !/^\d{2}-\d{2}$/.test(b.date) || !b.name.trim())) return toast("error", "use a name and MM-DD");
            void put("/api/config/birthdays", bdays);
          }}>save</Btn>
        </div>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#8e8e97" }}>Claude model</span>
          <input disabled={disabled} style={{ ...inp, width: 220 }} value={model} onChange={(e) => setModel(e.target.value)} />
          {!disabled && <Btn dark style={{ width: 90, height: 38 }} onClick={() => set({ aiModel: model.trim() || "claude-opus-5" })}>save</Btn>}
        </div>
        <div style={{ fontSize: 10, color: "#5f5f67", marginTop: 8, lineHeight: 1.5 }}>The API key lives only on the hub (ANTHROPIC_API_KEY in /etc/nudge/hub.env). When you ask the assistant something, the relevant school items and notes are sent to Claude to answer it.</div>
      </Section>
    </>
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
