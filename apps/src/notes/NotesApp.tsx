import { useEffect, useMemo, useRef, useState } from "react";
import { dateKey, formatNoteBody, hhmm, relativeDay, searchNotes, uid, type Note, type Snapshot } from "@nudge/shared";
import { getClient, loadPairing, useHubGet, useSnapshot } from "../lib/hub";
import { isLocalClient, localAudio, setLocalMode } from "../lib/localNotes";
import { D, DOTO, Ms, toast, toastError } from "../lib/ui";
import { sendToKeep } from "../lib/native";

/**
 * "nudge notes — second app, capture only." From "Nudge Notes App.dc.html".
 * Folders filed by day, hold-to-record voice notes (slide left to bin, up to lock),
 * edit pop-up, and "to the wall" with a day strip that only lets you pick times that can land.
 */

type Drawer = "all" | "voice" | "task";
const DRAWERS: { id: Drawer; label: string; icon: string }[] = [
  { id: "all", label: "all", icon: "inbox" },
  { id: "voice", label: "voice", icon: "graphic_eq" },
  { id: "task", label: "tasks", icon: "check_box_outline_blank" },
];
const MARK: Record<string, string> = { note: "", voice: "graphic_eq", task: "check_box_outline_blank" };

export function NotesApp() {
  const client = getClient("owner")!;
  const { snap, online } = useSnapshot(client);
  const { data: fetched, reload } = useHubGet<Note[]>(client, "/api/notes");
  const [local, setLocal] = useState<Note[]>([]); // optimistic, not yet synced
  const notes = useMemo(() => {
    const ids = new Set((fetched ?? []).map((n) => n.id));
    return [...local.filter((n) => !ids.has(n.id)), ...(fetched ?? [])];
  }, [fetched, local]);
  const [drawer, setDrawer] = useState<Drawer>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState("");
  const [fresh, setFresh] = useState("");
  const [edit, setEdit] = useState<Note | null>(null);
  const [wall, setWall] = useState<Note | null>(null);
  const [y, setY] = useState(0);
  const [mini, setMini] = useState(false);
  const lastY = useRef(0);
  const pane = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState<{ dir: number; key: number } | null>(null);

  const list = notes.filter((n) => drawer === "all" || n.kind === drawer);
  const rows = q.trim() ? searchNotes(list, q) : list;
  const today = dateKey();
  const sections = useMemo(() => {
    if (q.trim()) return rows.length ? [{ day: "results", rows }] : [];
    const order: string[] = [];
    const by = new Map<string, Note[]>();
    for (const n of rows) {
      const d = relativeDay(dateKey(n.createdAt), today);
      if (!by.has(d)) {
        by.set(d, []);
        order.push(d);
      }
      by.get(d)!.push(n);
    }
    return order.map((day) => ({ day, rows: by.get(day)! }));
  }, [rows, q, today]);

  const onScroll = () => {
    const el = pane.current!;
    setY(el.scrollTop);
    const d = el.scrollTop - lastY.current;
    if (Math.abs(d) > 8) {
      setMini(d > 0 && el.scrollTop > 60);
      lastY.current = el.scrollTop;
    }
  };
  const t = Math.min(1, Math.max(0, y / 44));

  const switchDrawer = (id: Drawer) => {
    if (id === drawer) return;
    const dir = DRAWERS.findIndex((x) => x.id === id) > DRAWERS.findIndex((x) => x.id === drawer) ? 1 : -1;
    setDrawer(id);
    setOpen("");
    setSlide({ dir, key: Date.now() });
    pane.current?.scrollTo({ top: 0 });
  };
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  const saved = (n: Note) => {
    setFresh(n.id);
    setTimeout(() => setFresh(""), 700);
    reload();
  };

  const del = async (n: Note) => {
    setOpen("");
    setLocal((l) => l.filter((x) => x.id !== n.id));
    try {
      await client.send("DELETE", `/api/notes/${n.id}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="page" style={{ height: "100dvh", overflow: "hidden", background: "var(--c-f4f3ef)", color: "var(--c-17171b)" }}>
      <div ref={pane} onScroll={onScroll} style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", paddingBottom: 150 }}>
        <div style={{ height: "calc(52px + env(safe-area-inset-top))" }} />
        <div style={{ padding: "0 20px 14px", display: "flex", alignItems: "flex-end", gap: 10, transformOrigin: "0 100%", opacity: 1 - t, transform: `scale(${1 - t * 0.08})` }}>
          <span style={{ fontFamily: D, fontSize: 40, lineHeight: 0.9, letterSpacing: -1 }}>notes</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 13, paddingBottom: 5, color: "var(--c-5a5852)" }}>{String(notes.length).padStart(2, "0")}</span>
        </div>
        <div style={{ padding: "0 16px 18px" }}>
          <div style={{ height: 42, borderRadius: 12, display: "flex", alignItems: "center", gap: 9, padding: "0 12px", background: q ? "var(--c-ffffff)" : "var(--c-e9e8e3)", boxShadow: q ? "inset 0 0 0 1.5px var(--c-17171b)" : "none", transition: "background-color .25s,box-shadow .25s" }}>
            <Ms style={{ fontSize: 18, color: "var(--c-5a5852)" }}>search</Ms>
            <input spellCheck={false} value={q} onChange={(e) => { setQ(e.target.value); setOpen(""); }} placeholder="search" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", fontSize: 14, color: "var(--c-17171b)" }} />
            {q && <span className="tap" onClick={() => setQ("")}><Ms style={{ fontSize: 17, color: "var(--c-5a5852)" }}>cancel</Ms></span>}
          </div>
          {q && <div style={{ padding: "10px 4px 0", fontSize: 11, color: "var(--c-5a5852)", animation: "fIn .25s ease-out" }}>{rows.length} {rows.length === 1 ? "note" : "notes"}, closest first</div>}
        </div>

        <div
          key={slide?.key}
          onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() })}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s || edit || wall) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - s.t > 600) return;
            const i = DRAWERS.findIndex((d) => d.id === drawer);
            const j = Math.max(0, Math.min(2, i + (dx < 0 ? 1 : -1)));
            if (j !== i) switchDrawer(DRAWERS[j].id);
          }}
          style={{ touchAction: "pan-y", animation: slide ? `${slide.dir > 0 ? "pageInR" : "pageInL"} .45s cubic-bezier(.32,.72,0,1)` : undefined }}
        >
          {!sections.length && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, padding: "50px 30px 0" }}>
              <Ms style={{ fontSize: 34, color: "var(--c-bdbbb3)" }}>search_off</Ms>
              <span style={{ fontSize: 12, textAlign: "center", color: "var(--c-5a5852)" }}>{q ? `nothing filed under “${q}”` : "nothing in here yet — hold the orange button to record"}</span>
            </div>
          )}
          {sections.map((sec) => (
            <div key={sec.day} style={{ position: "relative", paddingBottom: 26 }}>
              <DayTab label={sec.day} />
              {sec.rows.map((n, i) => (
                <Folder
                  key={n.id}
                  n={n}
                  z={i + 1}
                  last={i === sec.rows.length - 1}
                  open={open === n.id}
                  fresh={fresh === n.id}
                  onToggle={() => setOpen(open === n.id ? "" : n.id)}
                  onEdit={() => setEdit(n)}
                  onWall={() => setWall(n)}
                  onKeep={snap?.settings.googleKeep ? () => void sendToKeep(n.label, n.body).then((r) => toast("cloud_sync", r === "copied" ? "copied — paste it into Keep" : "sent to Keep")).catch(() => {}) : undefined}
                  onDelete={() => del(n)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* nav: small title + search once scrolled */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "calc(96px + env(safe-area-inset-top))", zIndex: 5, pointerEvents: "none", background: `linear-gradient(var(--c-f4f3ef) ${t > 0.6 ? 70 : 0}%, var(--c-f4f3ef00))` }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "env(safe-area-inset-top)", height: 44, display: "flex", alignItems: "center", padding: "0 26px" }}>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 13, letterSpacing: 0.5 }}>{hhmm(new Date().getHours() * 60 + new Date().getMinutes())}</span>
          <span style={{ flex: 1 }} />
          {isLocalClient(client) ? (
            <span className="tap" title="on this phone only — tap to pair with the wall" style={{ pointerEvents: "auto" }} onClick={() => { if (confirm("Pair with the wall? Your notes move to it once you do.")) { setLocalMode(false); location.reload(); } }}>
              <Ms style={{ fontSize: 15, color: "var(--c-5a5852)" }}>smartphone</Ms>
            </span>
          ) : (
            <Ms style={{ fontSize: 15, color: "var(--c-5a5852)" }}>{online ? "cloud_done" : "cloud_off"}</Ms>
          )}
        </div>
        <div onClick={() => pane.current?.scrollTo({ top: 0, behavior: "smooth" })} style={{ position: "absolute", left: 120, right: 120, top: "calc(22px + env(safe-area-inset-top))", display: "flex", justifyContent: "center", opacity: Math.max(0, t * 1.6 - 0.6), transform: `translateY(${(1 - t) * 6}px)`, pointerEvents: t > 0.6 ? "auto" : "none", cursor: "pointer" }}>
          <span style={{ fontFamily: D, fontSize: 17 }}>notes</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 110, pointerEvents: "none", background: "linear-gradient(var(--c-f4f3ef00),var(--c-f4f3ef) 64%)", zIndex: 6 }} />

      <Island drawer={drawer} mini={mini} onDrawer={(id) => (mini ? setMini(false) : switchDrawer(id))} onSaved={(n) => { setLocal((l) => [n, ...l]); saved(n); setOpen(""); setQ(""); pane.current?.scrollTo({ top: 0, behavior: "smooth" }); }} />

      {edit && <EditCard n={edit} onClose={() => setEdit(null)} onSaved={(n) => { setEdit(null); saved(n); }} />}
      {wall && snap && <WallCard n={wall} snap={snap} onClose={() => setWall(null)} onSent={() => { setWall(null); reload(); }} />}
      <style>{`@keyframes pageInR{from{transform:translateX(120px);opacity:0}to{transform:none;opacity:1}}@keyframes pageInL{from{transform:translateX(-120px);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

/* ------------------------------ day + folder ------------------------------ */

function DayTab({ label }: { label: string }) {
  const w = Math.round(label.length * 7.4 + 28);
  const r = 7, h = 22;
  const d = `M 0 ${h} Q ${r} ${h} ${r} ${h - r} L ${r} ${r} Q ${r} 0 ${r * 2} 0 L ${w} 0 Q ${w + r} 0 ${w + r} ${r} L ${w + r} ${h - r} Q ${w + r} ${h} ${w + r * 2} ${h} Z`;
  return (
    <div style={{ position: "relative", zIndex: 0, height: 22, pointerEvents: "none" }}>
      <div style={{ position: "absolute", right: 14, top: 0, width: w + r * 2, height: 22 }}>
        <svg width={w + r * 2} height={22} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={d} fill="var(--c-17171b)" />
        </svg>
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, letterSpacing: ".04em", color: "var(--c-f4f3ef)" }}>{label}</span>
      </div>
    </div>
  );
}

function Folder({ n, z, last, open, fresh, onToggle, onEdit, onWall, onDelete, onKeep }: { n: Note; z: number; last: boolean; open: boolean; fresh: boolean; onToggle: () => void; onEdit: () => void; onWall: () => void; onDelete: () => void; onKeep?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(390);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stamp = new Date(n.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const L = 14, R = W - 14, TH = 30, H = 44;
  const tw = Math.round(Math.min(W * 0.72, Math.max(110, n.label.length * 7.2 + (MARK[n.kind] ? 22 : 0) + stamp.length * 6.5 + 44)));
  const x2 = L + tw;
  const path = `M ${L} ${H} L ${L} 10 Q ${L} 0 ${L + 10} 0 L ${x2 - 16} 0 C ${x2 - 6} 0 ${x2 - 8} ${TH} ${x2 + 6} ${TH} L ${R - 2} ${TH} Q ${R} ${TH} ${R} ${TH + 2} L ${R} ${H}`;
  const fill = fresh ? "var(--c-ff4d17)" : "var(--c-ffffff)";
  const lines = formatNoteBody(n.body);
  return (
    <div ref={ref} style={{ position: "relative", marginTop: -30, zIndex: z }}>
      <div onClick={onToggle} style={{ position: "relative", height: 44, cursor: "pointer" }}>
        <svg width={W} height={44} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={path + " Z"} fill={fill} style={{ transition: "fill .9s ease" }} />
          <path d={path} fill="none" stroke="var(--c-aeaca5)" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
        <div style={{ position: "absolute", left: 14, top: 0, width: tw, height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 13px" }}>
          {MARK[n.kind] && <Ms style={{ fontSize: 14, color: "var(--c-5a5852)" }}>{MARK[n.kind]}</Ms>}
          <span style={{ fontSize: 12, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
          {n.wall && <Ms style={{ fontSize: 13, color: "var(--c-ff4d17)" }}>north_east</Ms>}
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 10, color: "var(--c-5a5852)" }}>{stamp}</span>
        </div>
      </div>
      <div style={{ position: "relative", margin: "0 14px", borderRadius: last ? "0 0 12px 12px" : 0, background: fill, transition: "background-color .9s ease", borderLeft: "1.5px solid var(--c-aeaca5)", borderRight: "1.5px solid var(--c-aeaca5)", borderBottom: last ? "1.5px solid var(--c-aeaca5)" : "none" }}>
        <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows .52s cubic-bezier(.32,.72,0,1)" }}>
          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <div style={{ padding: "6px 18px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
              {n.kind === "voice" && <Voice n={n} />}
              {lines.map((ln, i) => (
                <div key={i} style={{ display: "flex", gap: 9 }}>
                  {ln.bullet && <span style={{ width: 4, height: 4, borderRadius: "50%", flex: "none", marginTop: 9, background: "var(--c-ff4d17)" }} />}
                  <span style={{ fontSize: ln.heading ? 18 : lines.length === 1 ? 14 : 13, lineHeight: 1.5, fontFamily: ln.heading ? D : undefined, color: ln.heading ? "var(--c-17171b)" : "var(--c-3c3c42)", textWrap: "pretty" }}>{ln.text}</span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6 }}>
                <div className="tap" onClick={onEdit} style={{ flex: 1.6, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "var(--c-efeee9)" }}><Ms style={{ fontSize: 16 }}>edit</Ms><span style={{ fontSize: 11 }}>edit</span></div>
                <div className="tap" onClick={onWall} style={{ flex: 1.4, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "var(--c-17171b)", color: "var(--c-f4f3ef)" }}><Ms style={{ fontSize: 16 }}>north_east</Ms><span style={{ fontSize: 11 }}>{n.wall ? "on wall" : "to wall"}</span></div>
                {onKeep && <div className="tap" title="send to Google Keep" onClick={onKeep} style={{ flex: 0.6, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-efeee9)", color: "var(--c-5a5852)" }}><Ms style={{ fontSize: 16 }}>cloud_sync</Ms></div>}
                <div className="tap" onClick={onDelete} style={{ flex: 0.6, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-efeee9)", color: "var(--c-5a5852)" }}><Ms style={{ fontSize: 16 }}>delete</Ms></div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ height: last ? 16 : 36 }} />
      </div>
    </div>
  );
}

function Voice({ n }: { n: Note }) {
  const [playing, setPlaying] = useState(false);
  const [prog, setProg] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    if (!n.hasAudio) return toast("graphic_eq", "the recording is still uploading");
    try {
      if (!audio.current) {
        let blob: Blob | undefined;
        if (isLocalClient(getClient("owner"))) blob = await localAudio.get(n.id);
        else {
          const p = loadPairing("owner")!;
          const res = await fetch(`${p.hub}/api/notes/${n.id}/audio`, { headers: { authorization: "Bearer " + p.token } });
          if (!res.ok) throw new Error();
          blob = await res.blob();
        }
        if (!blob) throw new Error();
        const a = new Audio(URL.createObjectURL(blob));
        a.ontimeupdate = () => setProg(a.duration ? a.currentTime / a.duration : 0);
        a.onended = () => { setPlaying(false); setProg(0); };
        audio.current = a;
      }
      await audio.current.play();
      setPlaying(true);
    } catch {
      toast("cloud_off", "can't reach the wall");
    }
  };
  const bars = 40;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span onClick={play} style={{ width: 36, height: 36, flex: "none", borderRadius: "50%", background: "var(--c-17171b)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <Ms style={{ fontSize: 20, color: "var(--c-f4f3ef)" }}>{playing ? "pause" : "play_arrow"}</Ms>
      </span>
      <div onClick={play} style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, height: 30, minWidth: 0, cursor: "pointer" }}>
        {Array.from({ length: bars }, (_, k) => (
          <span key={k} style={{ flex: 1, height: 5 + ((k * 29 + n.id.charCodeAt(k % n.id.length)) % 11) * 2.2, borderRadius: 1, background: k / bars < prog ? "var(--c-ff4d17)" : "var(--c-d2d0c8)", transition: "background-color .2s" }} />
        ))}
      </div>
      <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 11, color: "var(--c-5a5852)" }}>{Math.floor(n.secs / 60)}:{String(n.secs % 60).padStart(2, "0")}</span>
    </div>
  );
}

/* ---------------------------------- island --------------------------------- */

function Island({ drawer, mini, onDrawer, onSaved }: { drawer: Drawer; mini: boolean; onDrawer: (d: Drawer) => void; onSaved: (n: Note) => void }) {
  const client = getClient("owner")!;
  const [rec, setRec] = useState(false);
  const [holding, setHolding] = useState(false);
  const [locked, setLocked] = useState(false);
  const [secs, setSecs] = useState(0);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [hint, setHint] = useState("");
  const p0 = useRef<{ x: number; y: number; t: number } | null>(null);
  const media = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; t0: number } | null>(null);
  const iv = useRef<number>(0);
  const onW = 112, offW = 52;
  const islandW = (mini ? onW : onW + offW * 2) + 57;
  const on = DRAWERS.findIndex((d) => d.id === drawer);
  const cp = Math.min(1, -dx / 120);
  const lq = Math.min(1, -dy / 72);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.start(250);
      media.current = { rec: r, chunks, stream, t0: Date.now() };
      setSecs(0);
      iv.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
      return true;
    } catch {
      toast("mic_off", "the mic isn't available here");
      return false;
    }
  };
  const stop = async (save: boolean) => {
    clearInterval(iv.current);
    const m = media.current;
    media.current = null;
    setRec(false);
    setHolding(false);
    setLocked(false);
    setDx(0);
    setDy(0);
    if (!m) return;
    const done = new Promise<void>((res) => (m.rec.onstop = () => res()));
    m.rec.stop();
    await done;
    m.stream.getTracks().forEach((t) => t.stop());
    if (!save) return;
    const secs = Math.max(1, Math.round((Date.now() - m.t0) / 1000));
    const blob = new Blob(m.chunks, { type: m.rec.mimeType || "audio/webm" });
    const id = uid();
    const now = Date.now();
    const note: Note = { id, kind: "voice", label: "new recording", body: "", tags: [], secs, hasAudio: false, wall: false, createdAt: now, updatedAt: now };
    onSaved(note);
    try {
      await client.send("POST", "/api/notes", { id, kind: "voice", label: "new recording", body: "", secs });
      if (isLocalClient(client)) {
        await client.setAudio(id, blob, secs);
        return;
      }
      const p = loadPairing("owner")!;
      await fetch(`${p.hub}/api/notes/${id}/audio?secs=${secs}`, { method: "PUT", headers: { authorization: "Bearer " + p.token, "content-type": blob.type.split(";")[0] || "audio/webm" }, body: blob });
      void client.snapshot();
      // Words for the note, worked out on the hub itself (skipped quietly if it can't).
      const wav = await toWav16k(blob).catch(() => null);
      if (wav) {
        const r = await fetch(`${p.hub}/api/notes/${id}/transcribe`, { method: "POST", headers: { authorization: "Bearer " + p.token, "content-type": "audio/wav" }, body: wav }).catch(() => null);
        if (r?.ok) void client.snapshot();
      }
    } catch {
      toast("cloud_off", "saved here — uploads when back online");
    }
  };

  const down = async (e: React.PointerEvent) => {
    if (locked) return void stop(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    p0.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setRec(true);
    setHolding(true);
    if (!(await start())) {
      setRec(false);
      setHolding(false);
      p0.current = null;
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!holding || !p0.current) return;
    const x = Math.min(0, e.clientX - p0.current.x);
    const y = Math.min(0, e.clientY - p0.current.y);
    if (y < -72) {
      p0.current = null;
      setLocked(true);
      setHolding(false);
      setDy(0);
      return;
    }
    if (x < -120) {
      p0.current = null;
      return void stop(false);
    }
    if (Math.abs(x) > Math.abs(y)) { setDx(x); setDy(0); } else { setDx(0); setDy(y); }
  };
  const up = () => {
    if (!holding) return;
    const quick = p0.current && Date.now() - p0.current.t < 350;
    p0.current = null;
    if (quick) {
      void stop(false);
      setHint("hold to record, slide up to lock");
      setTimeout(() => setHint(""), 1800);
      return;
    }
    void stop(true);
  };

  return (
    <>
      {hint && <div style={{ position: "absolute", right: 16, bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 9, padding: "8px 12px", borderRadius: 10, background: "var(--c-17171b)", fontSize: 11, color: "var(--c-f4f3ef)", animation: "rise .28s cubic-bezier(.32,.72,0,1)" }}>{hint}</div>}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(20px + env(safe-area-inset-bottom))", display: "flex", justifyContent: "center", zIndex: 8, pointerEvents: "none" }}>
        <div style={{ position: "relative", height: 52, width: islandW, borderRadius: 26, background: "var(--c-17171b)", boxShadow: "0 14px 30px -12px var(--c-00000080),inset 0 1px 0 var(--c-ffffff1a)", pointerEvents: "auto", transition: "width .55s cubic-bezier(.32,.72,0,1)" }}>
          <div style={{ position: "absolute", left: 5, top: 5, bottom: 5, right: 52, borderRadius: 21, overflow: "hidden", opacity: rec ? 0 : 1, pointerEvents: rec ? "none" : "auto", transition: `opacity .22s ease ${rec ? "0s" : ".28s"}` }}>
            <span style={{ position: "absolute", top: 0, left: 0, height: 42, width: onW, borderRadius: 21, background: "var(--c-f4f3ef)", transform: `translateX(${mini ? 0 : on * offW}px)`, transition: "transform .45s cubic-bezier(.32,.72,0,1)" }} />
            <div style={{ position: "relative", display: "flex", height: 42 }}>
              {DRAWERS.map((d, i) => {
                const act = i === on;
                return (
                  <div key={d.id} onClick={() => onDrawer(d.id)} style={{ width: act ? onW : mini ? 0 : offW, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", opacity: act || !mini ? 1 : 0, overflow: "hidden", transition: "width .45s cubic-bezier(.32,.72,0,1),opacity .25s" }}>
                    <Ms style={{ fontSize: 18, color: act ? "var(--c-0b0b0d)" : "var(--c-a3a19b)" }}>{d.icon}</Ms>
                    {act && <span style={{ fontSize: 11, whiteSpace: "nowrap", color: "var(--c-0b0b0d)" }}>{d.label}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ position: "absolute", right: 5, bottom: 26, width: 42, height: holding ? 58 + lq * 34 : 26, borderRadius: 21, background: "var(--c-26262c)", overflow: "hidden", opacity: holding ? 1 : 0, transition: holding ? "height .1s ease-out" : "height .45s cubic-bezier(.32,.72,0,1),opacity .22s ease .2s", zIndex: 1, pointerEvents: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12 }}>
              <Ms style={{ fontSize: 18, color: lq > 0.85 ? "var(--c-ff4d17)" : "var(--c-f4f3ef)" }}>{lq > 0.85 ? "lock" : "lock_open"}</Ms>
              <Ms style={{ fontSize: 16, marginTop: 4, color: "var(--c-f4f3ef)", opacity: Math.max(0, 1 - lq * 1.4), animation: "cRise 1.3s ease-in-out infinite" }}>keyboard_arrow_up</Ms>
            </div>
          </div>
          <div style={{ position: "absolute", right: 5, top: 5, height: 42, width: rec ? islandW - 10 : 42, borderRadius: 21, background: rec ? "var(--c-26262c)" : "var(--c-ff4d17)", overflow: "visible", zIndex: 2, transition: "width .5s cubic-bezier(.32,.72,0,1),background-color .45s ease" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, right: 42, display: "flex", alignItems: "center", gap: 10, paddingLeft: 5, opacity: rec ? 1 : 0, pointerEvents: rec ? "auto" : "none", transition: `opacity .2s ease ${rec ? ".22s" : "0s"}` }}>
              <span onClick={(e) => { e.stopPropagation(); void stop(false); }} style={{ width: 32, height: 32, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: cp > 0.55 ? "var(--c-ff4d17)" : "var(--c-3a3a42)", transform: `scale(${1 + cp * 0.2})` }}>
                <Ms style={{ fontSize: 18, color: cp > 0.55 ? "var(--c-0b0b0d)" : "var(--c-f4f3ef)" }}>delete</Ms>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, opacity: 1 - cp * 0.85, transform: `translateX(${holding ? dx * 0.35 : 0}px)` }}>
                {holding && cp < 0.08 && lq < 0.08 && <Ms style={{ fontSize: 16, marginLeft: -4, color: "var(--c-8e8e97)", animation: "cNudge 1.1s ease-in-out infinite" }}>keyboard_double_arrow_left</Ms>}
                <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 16, letterSpacing: 0.5, color: "var(--c-f4f3ef)" }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
                {locked && <Ms style={{ fontSize: 15, color: "var(--c-ff4d17)", animation: "cPop .45s cubic-bezier(.2,1.4,.4,1)" }}>lock</Ms>}
              </div>
            </div>
            <div
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              style={{ position: "absolute", right: 0, top: 0, width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", touchAction: "none", userSelect: "none", background: "var(--c-ff4d17)", transform: `translate(${holding ? Math.max(-150, dx) : 0}px,${holding ? Math.max(-80, dy) : 0}px) scale(${holding ? 1.34 - cp * 0.08 : rec ? 1.08 : 1})`, boxShadow: holding ? "0 10px 24px -8px var(--c-ff4d17a6)" : "none", transition: holding ? "transform .04s linear" : "transform .4s cubic-bezier(.32,.72,0,1)", zIndex: 3 }}
            >
              <Ms style={{ fontSize: 20, color: "var(--c-0b0b0d)", pointerEvents: "none" }}>{holding && cp > 0.55 ? "delete" : holding && lq > 0.85 ? "lock" : locked ? "arrow_upward" : "mic"}</Ms>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------- edit ---------------------------------- */

function EditCard({ n, onClose, onSaved }: { n: Note; onClose: () => void; onSaved: (n: Note) => void }) {
  const client = getClient("owner")!;
  const [label, setLabel] = useState(n.label);
  const [body, setBody] = useState(n.body);
  const [kind, setKind] = useState(n.kind);
  const [closing, setClosing] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const close = (after?: () => void) => {
    setClosing(true);
    setTimeout(() => (after ? after() : onClose()), 220);
  };
  const done = () =>
    close(async () => {
      try {
        const r = await client.send<Note>("PATCH", `/api/notes/${n.id}`, { label: label.trim() || n.label, body, kind });
        onSaved(r ?? { ...n, label, body, kind });
      } catch (e) {
        toastError(e);
        onClose();
      }
    });
  return (
    <>
      <div onClick={() => close()} style={{ position: "fixed", inset: 0, zIndex: 20, background: "var(--c-17171b59)", animation: closing ? "scrimOut .24s ease both" : "scrimIn .28s ease both" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 21, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "min(100%,520px)", height: "100%", borderRadius: 30, background: "var(--c-f4f3ef)", display: "flex", flexDirection: "column", overflow: "hidden", pointerEvents: "auto", animation: closing ? "popOut .22s cubic-bezier(.4,0,1,1) both" : "popIn .42s cubic-bezier(.2,1.2,.35,1) both", transformOrigin: "50% 60%" }}>
          <div style={{ display: "flex", alignItems: "center", height: 46, padding: "0 16px", marginTop: "calc(30px + env(safe-area-inset-top))" }}>
            <span className="tap" onClick={() => close()} style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-e9e8e3)" }}><Ms style={{ fontSize: 18 }}>close</Ms></span>
            <span style={{ flex: 1, textAlign: "center", fontFamily: D, fontSize: 17 }}>edit</span>
            <span style={{ width: 32 }} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, padding: "8px 22px 14px" }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} spellCheck={false} style={{ border: 0, outline: 0, background: "transparent", padding: "0 0 10px", borderBottom: "1.5px solid var(--c-e2e0d9)", fontFamily: D, fontSize: 30, lineHeight: 1.1, color: "var(--c-17171b)" }} />
            {kind === "voice" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40, padding: "0 12px", borderRadius: 12, background: "var(--c-ffffff)", boxShadow: "inset 0 0 0 1.5px var(--c-e2e0d9)" }}>
                <Ms style={{ fontSize: 17, color: "var(--c-ff4d17)" }}>graphic_eq</Ms>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 12, color: "var(--c-5a5852)" }}>{Math.floor(n.secs / 60)}:{String(n.secs % 60).padStart(2, "0")}</span>
              </div>
            )}
            <textarea ref={ta} value={body} onChange={(e) => setBody(e.target.value)} rows={Math.max(4, body.split("\n").length + 1)} placeholder="first line becomes the heading, the rest become points" style={{ flex: 1, minHeight: 140, border: 0, outline: 0, resize: "none", background: "transparent", padding: 0, fontSize: 15, lineHeight: 1.65, color: "var(--c-2c2c31)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px calc(30px + env(safe-area-inset-bottom))", borderTop: "1px solid var(--c-e2e0d9)" }}>
            <Tool icon="format_list_bulleted" on={false} go={() => { setBody(body.replace(/\s*$/, "") + "\n"); setTimeout(() => ta.current?.focus(), 0); }} />
            {kind !== "voice" && <Tool icon={kind === "task" ? "check_box" : "check_box_outline_blank"} on={kind === "task"} go={() => setKind(kind === "task" ? "note" : "task")} />}
            <Tool icon="undo" on={false} go={() => { setLabel(n.label); setBody(n.body); setKind(n.kind); }} />
            <span style={{ flex: 1 }} />
            <div className="tap" onClick={done} style={{ height: 42, padding: "0 18px", borderRadius: 13, display: "flex", alignItems: "center", gap: 7, background: "var(--c-17171b)", color: "var(--c-f4f3ef)" }}>
              <Ms style={{ fontSize: 17 }}>check</Ms><span style={{ fontSize: 12 }}>done</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Tool({ icon, on, go }: { icon: string; on: boolean; go: () => void }) {
  return (
    <div className="tap" onClick={go} style={{ width: 42, height: 42, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "var(--c-17171b)" : "var(--c-e9e8e3)", color: on ? "var(--c-f4f3ef)" : "var(--c-17171b)", transition: "background-color .25s" }}>
      <Ms style={{ fontSize: 19 }}>{icon}</Ms>
    </div>
  );
}

/* ---------------------------------- to wall -------------------------------- */

interface When { id: string; label: string; chip: string; at: number }

function whenOptions(snap: Snapshot): When[] {
  const now = new Date();
  const at = (h: number, m: number, plusDay = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + plusDay);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const afterSchool = at(16, 10) > now.getTime() ? at(16, 10) : at(16, 10, 1);
  const tonight = at(19, 0) > now.getTime() ? at(19, 0) : at(19, 0, 1);
  const alarm = snap.settings.alarm.split(":").map(Number);
  return [
    { id: "now", label: "right now", chip: "now", at: now.getTime() },
    { id: "school", label: afterSchool > at(23, 59) ? "after school tomorrow" : "after school", chip: "home", at: afterSchool },
    { id: "night", label: "tonight", chip: "tonight", at: tonight },
    { id: "morning", label: "tomorrow morning", chip: "morning", at: at(alarm[0], alarm[1] + 20, 1) },
  ];
}

function WallCard({ n, snap, onClose, onSent }: { n: Note; snap: Snapshot; onClose: () => void; onSent: () => void }) {
  const client = getClient("owner")!;
  const opts = useMemo(() => whenOptions(snap), [snap]);
  const [as, setAs] = useState<"reminder" | "task">(n.kind === "task" ? "task" : "reminder");
  const [at, setAt] = useState(opts[1].at);
  const [sent, setSent] = useState(false);
  const [closing, setClosing] = useState(false);
  const clockOf = (t: number) => (Math.abs(t - Date.now()) < 60_000 ? "now" : new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  const nearest = opts.reduce((a, b) => (Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a));
  const label = Math.abs(nearest.at - at) < 20 * 60_000 ? nearest.label : new Date(at).toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" }).toLowerCase();

  // day strip: 18 hours from the current hour, 40px an hour; school, sessions and sleep blocked out
  const H0 = new Date();
  H0.setMinutes(0, 0, 0);
  const t0 = H0.getTime();
  const PX = 40;
  const SPAN = 40; // hours shown on the strip
  const x = (t: number) => ((t - t0) / 3600_000) * PX;
  const zones = useMemo(() => {
    const out: { from: number; to: number; icon: string }[] = [];
    for (let d = 0; d < 3; d++) {
      const day = new Date(t0);
      day.setDate(day.getDate() + d);
      const key = dateKey(day);
      const kind = d === 0 ? snap.today.kind : d === 1 ? snap.tomorrow.kind : "school";
      const mk = (h: number, m: number) => { const x = new Date(day); x.setHours(h, m, 0, 0); return x.getTime(); };
      if (kind === "school") out.push({ from: mk(8, 40), to: mk(15, 40), icon: "school" });
      if (d === 0 && snap.tasks.some((t) => !t.done)) out.push({ from: Math.max(Date.now(), mk(16, 30)), to: Math.max(Date.now(), mk(16, 30)) + snap.tasks.filter((t) => !t.done).reduce((a, t) => a + (t.mins + 5) * 60_000, 0), icon: "timer" });
      const [bh, bm] = snap.settings.bedtime.split(":").map(Number);
      const [ah, am] = snap.settings.alarm.split(":").map(Number);
      const bed = mk(bh, bm);
      const wake = new Date(bed);
      wake.setDate(wake.getDate() + 1);
      wake.setHours(ah, am, 0, 0);
      out.push({ from: bed, to: wake.getTime(), icon: "bedtime" });
      void key;
    }
    return out;
  }, [snap, t0]);
  const blocked = (t: number) => zones.some((z) => t > z.from && t < z.to);
  const scrub = useRef<{ x: number; at: number; moved: boolean } | null>(null);
  const clampTo = (t: number) => Math.max(Date.now(), Math.min(t0 + SPAN * 3600_000, t));

  const send = async () => {
    if (sent) return;
    if (blocked(at) && Math.abs(at - Date.now()) > 60_000) return toast("block", "it can't land then — pick a free time");
    setSent(true);
    try {
      await client.send("POST", `/api/notes/${n.id}/wall`, { as, at });
      setTimeout(() => {
        setClosing(true);
        setTimeout(() => { onSent(); toast("north_east", `on the wall · ${clockOf(at)}`); }, 220);
      }, 820);
    } catch (e) {
      setSent(false);
      toastError(e);
    }
  };
  const keys = as === "task" ? ["start", "later", "", ""] : ["", "", "", "got it"];
  const line = n.body.split("\n")[0] || "";

  return (
    <>
      <div onClick={() => { setClosing(true); setTimeout(onClose, 220); }} style={{ position: "fixed", inset: 0, zIndex: 20, background: "var(--c-17171b59)", animation: closing ? "scrimOut .24s ease both" : "scrimIn .28s ease both" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 21, display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(40px + env(safe-area-inset-top)) 14px 30px", pointerEvents: "none" }}>
        <div style={{ width: "min(100%,440px)", maxHeight: "100%", borderRadius: 26, background: "var(--c-f4f3ef)", boxShadow: "0 30px 60px -20px var(--c-00000073)", display: "flex", flexDirection: "column", overflow: "hidden", pointerEvents: "auto", animation: closing ? "popOut .22s cubic-bezier(.4,0,1,1) both" : "popIn .42s cubic-bezier(.2,1.2,.35,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", height: 46, padding: "0 16px", flex: "none" }}>
            <span className="tap" onClick={() => { setClosing(true); setTimeout(onClose, 220); }} style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-e9e8e3)" }}><Ms style={{ fontSize: 18 }}>close</Ms></span>
            <span style={{ flex: 1, textAlign: "center", fontFamily: D, fontSize: 17 }}>to the wall</span>
            <span style={{ width: 32 }} />
          </div>
          <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: "4px 20px 16px" }}>
            <div style={{ alignSelf: "center", width: 310, maxWidth: "100%", flex: "none", borderRadius: 18, padding: "12px 12px 11px", background: "var(--c-fbfaf7)", boxShadow: "0 18px 36px -20px var(--c-0000006b),inset 0 0 0 1.5px var(--c-e2e0d9)" }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "286/214", borderRadius: 10, background: "var(--c-0a0a0c)", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 14, right: 14, top: 13, display: "flex", alignItems: "center", gap: 7 }}>
                  <Ms style={{ fontSize: 16, color: "var(--c-ff4d17)" }}>{as === "task" ? "check_box_outline_blank" : "push_pin"}</Ms>
                  <span style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--c-9a9aa3)" }}>{as === "task" ? "NEW TASK" : "REMINDER"}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 14, color: "var(--c-f4f3ef)" }}>{clockOf(at)}</span>
                </div>
                <div style={{ position: "absolute", left: 14, right: 14, top: 48, display: "flex", flexDirection: "column", gap: 7 }}>
                  <span style={{ fontFamily: D, fontSize: 27, lineHeight: 1.02, color: "var(--c-f4f3ef)", textWrap: "pretty" }}>{n.label}</span>
                  <span style={{ fontSize: 12, lineHeight: 1.4, color: "var(--c-b6b5af)" }}>{line}</span>
                </div>
                <div style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 30, display: "flex", gap: 6 }}>
                  {keys.map((l, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: "7px 7px 0 0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, background: !l ? "var(--c-101015)" : i === 0 || l === "got it" ? "var(--c-f4f3ef)" : "var(--c-1d1d24)", color: !l ? "var(--c-101015)" : i === 0 || l === "got it" ? "var(--c-0b0b0d)" : "var(--c-c9c8c2)", transition: "background-color .35s,color .35s" }}>{l}</div>
                  ))}
                </div>
                {sent && (
                  <div style={{ position: "absolute", inset: 0, background: "var(--c-0a0a0cf2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, animation: "fIn .2s ease-out" }}>
                    <Ms style={{ fontSize: 46, color: "var(--c-ff4d17)", animation: "wSent .5s cubic-bezier(.2,1.3,.4,1)" }}>check_circle</Ms>
                    <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 13, color: "var(--c-f4f3ef)" }}>{clockOf(at)}</span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, padding: "10px 8px 0" }}>
                {keys.map((l, i) => <span key={i} style={{ flex: 1, height: 24, borderRadius: 6, background: l ? "var(--c-ffffff)" : "var(--c-eceae4)", boxShadow: l ? "0 2px 0 var(--c-cfccc4),inset 0 0 0 1px var(--c-e2e0d9)" : "inset 0 0 0 1px var(--c-e2e0d9)" }} />)}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              {([["reminder", "push_pin", "shows once"], ["task", "check_box_outline_blank", "joins the list"]] as const).map(([id, icon, hint]) => {
                const on = as === id;
                return (
                  <div key={id} className="tap" onClick={() => setAs(id)} style={{ flex: 1, height: 62, borderRadius: 16, padding: "0 14px", display: "flex", alignItems: "center", gap: 11, background: on ? "var(--c-17171b)" : "var(--c-e9e8e3)", transition: "background-color .3s" }}>
                    <Ms style={{ fontSize: 20, color: on ? "var(--c-ff4d17)" : "var(--c-5a5852)" }}>{icon}</Ms>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 13, color: on ? "var(--c-f4f3ef)" : "var(--c-17171b)" }}>{id}</span>
                      <span style={{ fontSize: 10, color: on ? "var(--c-b6b5af)" : "var(--c-5a5852)" }}>{hint}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: "none" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--c-5a5852)" }}>ARRIVES</span>
                  <span style={{ fontFamily: D, fontSize: 24, lineHeight: 1 }}>{label}</span>
                </div>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 28, lineHeight: 0.9, color: blocked(at) && clockOf(at) !== "now" ? "var(--c-a5a5ad)" : "var(--c-ff4d17)" }}>{clockOf(at)}</span>
              </div>
              <div
                onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrub.current = { x: e.clientX, at, moved: false }; }}
                onPointerMove={(e) => {
                  const s = scrub.current;
                  if (!s) return;
                  const dx = e.clientX - s.x;
                  if (Math.abs(dx) > 4) s.moved = true;
                  if (s.moved) setAt(clampTo(Math.round((s.at - (dx / PX) * 3600_000) / 900_000) * 900_000));
                }}
                onPointerUp={() => (scrub.current = null)}
                style={{ position: "relative", height: 96, borderRadius: 18, background: "var(--c-17171b)", overflow: "hidden", touchAction: "none", cursor: "grab" }}
              >
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: SPAN * PX, transform: `translateX(${-x(at)}px)`, transition: scrub.current ? "none" : "transform .5s cubic-bezier(.32,.72,0,1)", pointerEvents: "none" }}>
                  {zones.map((z, i) => {
                    const l = Math.max(0, x(z.from)), r = Math.min(SPAN * PX, x(z.to));
                    if (r <= l) return null;
                    return (
                      <div key={i} style={{ position: "absolute", left: l, width: r - l, top: 12, height: 24, borderRadius: 8, background: "repeating-linear-gradient(135deg,var(--c-2e2e36) 0 4px,var(--c-1f1f25) 4px 8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ms style={{ fontSize: 14, color: "var(--c-8e8e97)" }}>{z.icon}</Ms>
                      </div>
                    );
                  })}
                  {Array.from({ length: SPAN * 2 + 1 }, (_, i) => (
                    <span key={i} style={{ position: "absolute", left: i * (PX / 2), bottom: 30, width: 2, height: i % 2 ? 7 : 14, marginLeft: -1, borderRadius: 1, background: i % 2 ? "var(--c-3c3c44)" : "var(--c-6f6f78)" }} />
                  ))}
                  {Array.from({ length: SPAN + 1 }, (_, i) => i % 2 === 0 && (
                    <span key={"h" + i} style={{ position: "absolute", left: i * PX, bottom: 11, transform: "translateX(-50%)", fontFamily: DOTO, fontWeight: 900, fontSize: 11, color: "var(--c-6f6f78)" }}>{String((H0.getHours() + i) % 24).padStart(2, "0")}</span>
                  ))}
                  {opts.map((o) => (
                    <span key={o.id} style={{ position: "absolute", left: x(o.at), top: 44, width: o.id === nearest.id ? 12 : 8, height: o.id === nearest.id ? 12 : 8, transform: "translate(-50%,-50%)", borderRadius: "50%", background: o.id === nearest.id ? "var(--c-ff4d17)" : "var(--c-f4f3ef)", transition: "width .25s,height .25s,background-color .25s" }} />
                  ))}
                </div>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 70, background: "linear-gradient(90deg,var(--c-17171b),var(--c-17171b00))", pointerEvents: "none" }} />
                <span style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 70, background: "linear-gradient(270deg,var(--c-17171b),var(--c-17171b00))", pointerEvents: "none" }} />
                <span style={{ position: "absolute", left: "50%", top: 8, bottom: 8, width: 3, marginLeft: -1.5, borderRadius: 2, background: "var(--c-ff4d17)", pointerEvents: "none" }} />
                <span style={{ position: "absolute", left: "50%", top: 4, width: 11, height: 6, marginLeft: -5.5, borderRadius: "0 0 6px 6px", background: "var(--c-ff4d17)", pointerEvents: "none" }} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {opts.map((o) => {
                  const on = o.id === nearest.id && Math.abs(o.at - at) < 20 * 60_000;
                  return (
                    <div key={o.id} className="tap" onClick={() => setAt(o.at)} style={{ flex: 1, height: 46, borderRadius: 13, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: on ? "var(--c-17171b)" : "var(--c-e9e8e3)", transition: "background-color .3s" }}>
                      <span style={{ fontSize: 10, whiteSpace: "nowrap", color: on ? "var(--c-f4f3ef)" : "var(--c-17171b)" }}>{o.chip}</span>
                      <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 11, color: on ? "var(--c-ff4d17)" : "var(--c-5a5852)" }}>{clockOf(o.at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ flex: "none", padding: "10px 16px 16px", borderTop: "1px solid var(--c-e2e0d9)" }}>
            <div className="tap" onClick={send} style={{ height: 54, borderRadius: 17, background: "var(--c-17171b)", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
              <Ms style={{ fontSize: 18, color: "var(--c-ff4d17)" }}>north_east</Ms>
              <span style={{ fontSize: 13, color: "var(--c-f4f3ef)" }}>send to the wall</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Any recording → 16 kHz mono 16-bit WAV, the format the hub's on-device speech-to-text reads. */
async function toWav16k(blob: Blob): Promise<Blob> {
  const ac = new AudioContext();
  let buf: AudioBuffer;
  try {
    buf = await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ac.close();
  }
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out.buffer], { type: "audio/wav" });
}
