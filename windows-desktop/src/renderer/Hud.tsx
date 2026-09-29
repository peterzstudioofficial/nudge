import { useEffect, useRef, useState } from "react";
import { mmss, sessionView, tint, type Snapshot } from "@nudge/shared";
import { bridge, useHubState } from "./bridge";

/** The on-task window, from "Desktop Windows.dc.html" (ON TASK). Mirrors the wall; never controls it. */

type Mode = "list" | "breathe" | "sleep" | "pack" | "relax" | "shut";
const D = "'ZCOOL QingKe HuangYou', sans-serif";
const DOTO = "Doto, monospace";
const countWord = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
const Ms = ({ children, style }: { children: string; style?: React.CSSProperties }) => <span className="ms" style={style}>{children}</span>;

export function Hud() {
  const { snap } = useHubState();
  const [mode, setMode] = useState<Mode>("list");
  const [shutting, setShutting] = useState(false);
  const [nudge, setNudge] = useState<{ icon: string; line: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [sign, setSign] = useState<"ask" | "open" | "done" | null>(null);
  const [signLeaving, setSignLeaving] = useState(false);
  const [bT, setBT] = useState(-3);
  const [justDone, setJustDone] = useState<string | null>(null);
  const prev = useRef<Snapshot | null>(null);
  const seq = useRef<number[]>([]);

  const clearSeq = () => {
    seq.current.forEach(clearTimeout);
    seq.current = [];
  };
  const later = (ms: number, fn: () => void) => seq.current.push(window.setTimeout(fn, ms));

  useEffect(() => {
    const a = bridge().on("nudge", (n) => {
      setMode("list");
      setLeaving(false);
      setNudge(n as { icon: string; line: string });
    });
    const b = bridge().on("sign", () => {
      setSignLeaving(false);
      setSign("ask");
    });
    const c = bridge().on("bedtime", () => {
      clearSeq();
      setShutting(false);
      setMode("sleep");
    });
    return () => {
      a();
      b();
      c();
    };
  }, []);

  // Task finished → flash it; everything finished → pack your bag / relax → close.
  useEffect(() => {
    const p = prev.current;
    prev.current = snap;
    if (!snap || !p) return;
    for (const t of snap.tasks) {
      const was = p.tasks.find((x) => x.id === t.id);
      if (t.done && was && !was.done) {
        setJustDone(t.id);
        window.setTimeout(() => setJustDone(null), 900);
      }
    }
    const allNow = snap.tasks.length > 0 && snap.tasks.every((t) => t.done);
    const allBefore = p.tasks.length > 0 && p.tasks.every((t) => t.done);
    if (allNow && !allBefore) finish(snap);
    if (snap.session && !p.session) {
      clearSeq();
      setShutting(false);
      setMode("list");
    }
    if (snap.school.needsSignIn && !p.school.needsSignIn) setSign("ask");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  useEffect(() => {
    if (mode !== "breathe") return;
    const iv = window.setInterval(() => setBT((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [mode]);
  useEffect(() => {
    if (mode === "breathe" && bT >= 64) setMode("list");
  }, [bT, mode]);

  const finish = (s: Snapshot) => {
    clearSeq();
    const bagLeft = s.bag.filter((b) => !b.got && !b.kept).length;
    if (s.tomorrow.kind === "school" && bagLeft) {
      setMode("pack");
      later(3600, () => setMode("relax"));
      later(8200, () => setShutting(true));
      later(9000, () => { setMode("shut"); setShutting(false); void bridge().win("hide"); });
    } else {
      setMode("relax");
      later(4600, () => setShutting(true));
      later(5400, () => { setMode("shut"); setShutting(false); void bridge().win("hide"); });
    }
  };
  const clearNudge = () => {
    setLeaving(true);
    window.setTimeout(() => {
      setNudge(null);
      setLeaving(false);
    }, 420);
  };
  const signClose = () => {
    setSignLeaving(true);
    window.setTimeout(() => {
      setSign(null);
      setSignLeaving(false);
    }, 420);
  };
  const signGo = async () => {
    setSign("open");
    const ok = await bridge().signIn();
    if (ok) {
      setSign("done");
      window.setTimeout(signClose, 1600);
    } else signClose();
  };

  if (!snap) {
    return (
      <Shell>
        <div style={{ height: 242, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontSize: 10, color: "#5f5f67" }}>
          <Ms style={{ fontSize: 15, animation: "wPulse 1.6s ease-in-out infinite" }}>sync</Ms> finding the wall…
        </div>
      </Shell>
    );
  }

  const sess = snap.session;
  const v = sess ? sessionView(sess, Date.now()) : null;
  const liveId = sess?.taskId ?? snap.tasks.find((t) => !t.done)?.id ?? null;
  const pct = v ? Math.min(100, Math.round((v.worked / sess!.totalSec) * 100)) : 0;
  const pieDeg = Math.round((Math.min(snap.bank, snap.reward.goal) / snap.reward.goal) * 360);
  const bPhase = Math.floor((Math.max(0, bT) % 16) / 4);
  const bCycle = Math.floor(Math.max(0, bT) / 16);
  const stroke = leaving || signLeaving ? "wStrokeOut .62s cubic-bezier(.5,0,.5,1) both" : nudge || sign ? "wStrokeIn .62s cubic-bezier(.32,.8,.3,1) both" : "wStrokeHidden 0s linear both";

  return (
    <Shell anim={shutting ? "wShut .8s cubic-bezier(.36,0,.66,-.28) both" : "wIn .4s ease-out"}>
      <svg viewBox="0 0 268 242" width="268" height="242" fill="none" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: sign ? 6 : 3 }}>
        <path d="M134 1.5 H250.5 A16 16 0 0 1 266.5 17.5 V224.5 A16 16 0 0 1 250.5 240.5 H134" pathLength={100} stroke="#ff4d17" strokeWidth={5} strokeLinecap="round" strokeDasharray="100 100" style={{ animation: stroke }} />
        <path d="M134 1.5 H17.5 A16 16 0 0 0 1.5 17.5 V224.5 A16 16 0 0 0 17.5 240.5 H134" pathLength={100} stroke="#ff4d17" strokeWidth={5} strokeLinecap="round" strokeDasharray="100 100" style={{ animation: stroke }} />
      </svg>

      {mode === "breathe" && (
        <div style={{ position: "relative", height: 242, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 15, animation: "wFade .34s ease-out" }}>
          {bT < 0 ? (
            <span key={bT} style={{ position: "absolute", fontFamily: D, fontSize: 52, lineHeight: 1, color: "#ff4d17", animation: "wCount 1s cubic-bezier(.2,.9,.25,1) both" }}>{-bT}</span>
          ) : (
            <div style={{ position: "relative", width: 132, height: 132, display: "flex", alignItems: "center", justifyContent: "center", animation: "wFade .4s ease-out" }}>
              <span style={{ position: "absolute", width: 132, height: 132, border: "4px solid #ff4d17", background: bPhase === 1 || bPhase === 2 ? "#ff4d1714" : "transparent", animation: "wBreath 16s linear infinite", transition: "background-color .8s ease" }} />
              <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span style={{ fontFamily: D, fontSize: 17, lineHeight: 1, whiteSpace: "nowrap" }}>{["breathe in", "hold", "breathe out", "hold"][bPhase]}</span>
                <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 27, lineHeight: 1, color: "#ff4d17" }}>{4 - (Math.max(0, bT) % 4)}</span>
              </div>
            </div>
          )}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 16, display: "flex", justifyContent: "center", gap: 5 }}>
            {Array.from({ length: 4 }, (_, k) => (
              <span key={k} style={{ width: k < bCycle ? 26 : k === bCycle ? 16 : 10, height: 5, borderRadius: 3, background: k < bCycle ? "#ff4d17" : k === bCycle ? "#4a4a54" : "#23232b", transition: "width .5s cubic-bezier(.4,0,.2,1),background-color .5s" }} />
            ))}
          </div>
          <span onClick={() => setMode("list")} style={{ position: "absolute", right: 11, top: 11, cursor: "pointer" }} className="nodrag"><Ms style={{ fontSize: 15, color: "#5f5f67" }}>close</Ms></span>
        </div>
      )}

      {mode === "list" && (
        <div className="drag" style={{ position: "relative", height: 242, padding: "11px 12px 12px", display: "flex", flexDirection: "column", gap: 4, animation: "wFade .3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 1px 4px" }}>
            <div title={`${snap.bank} of ${snap.reward.goal} — ${snap.reward.name}`} style={{ width: 19, height: 19, flex: "none", borderRadius: 6, background: "#17171d", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: `conic-gradient(#ff4d17 0deg ${pieDeg}deg,#2a2a33 ${pieDeg}deg 360deg)` }}>
                <span style={{ display: "block", margin: 3.5, width: 6, height: 6, borderRadius: "50%", background: "#17171d" }} />
              </span>
            </div>
            <div className="nodrag" title="breathe" onClick={() => { setBT(-3); setMode("breathe"); }} style={{ width: 19, height: 19, flex: "none", borderRadius: 6, background: "#17171d", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, border: "2px solid #ff4d17" }} />
            </div>
            <span style={{ flex: 1 }} />
            <span className="nodrag" title="hide" onClick={() => bridge().win("hide")} style={{ cursor: "pointer" }}><Ms style={{ fontSize: 14, color: "#5f5f67" }}>remove</Ms></span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 4 }}>
            {snap.tasks.length === 0 && <span style={{ fontSize: 10, color: "#5f5f67", padding: 8 }}>nothing on today</span>}
            {snap.tasks.slice(0, 6).map((t) => {
              const live = t.id === liveId;
              const flash = t.id === justDone;
              return (
                <div key={t.id} style={{ alignSelf: "flex-end", width: live ? "100%" : t.done ? "70%" : "84%", borderRadius: live ? 13 : 9, overflow: "hidden", flex: "none", background: live ? "#191921" : t.done ? "transparent" : "#131318", animation: flash ? "wDoneFlash .9s cubic-bezier(.3,0,.3,1) both" : "none", transition: "width .55s cubic-bezier(.22,1,.28,1),background-color .45s ease" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, height: live ? 46 : 32, padding: "0 12px" }}>
                    <span style={{ width: 4, height: live ? 24 : 14, borderRadius: 2, flex: "none", background: t.done ? "#2a2a33" : tint(t.subject), transition: "height .45s" }} />
                    <span style={{ fontSize: live ? 13 : 11, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: live ? "#ffffff" : t.done ? "#8e8e97" : "#c9c8c2", textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
                    {live && v && <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 12, color: sess?.state === "running" ? "#ff4d17" : "#6d6d77" }}>{mmss(v.claimReady ? v.overrun : v.remaining)}</span>}
                    {t.done && <Ms style={{ fontSize: 14, color: flash ? "#ff4d17" : "#8e8e97" }}>check</Ms>}
                  </div>
                  {live && (
                    <div style={{ height: 5, background: "#1b1b22" }}>
                      <div style={{ height: 5, borderRadius: "0 4px 4px 0", background: "#ff4d17", width: pct + "%", transition: "width .8s cubic-bezier(.4,0,.2,1)" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === "sleep" && (
        <div style={{ position: "relative", height: 242, padding: "20px 18px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 11, animation: "wFade .5s ease-out" }}>
          <Ms style={{ fontSize: 28, color: "#ff4d17", animation: "wRelax .7s cubic-bezier(.2,1.1,.3,1) both" }}>bedtime</Ms>
          <span style={{ fontFamily: D, fontSize: 29, lineHeight: 1, animation: "wStep .5s cubic-bezier(.2,.9,.25,1) .12s both" }}>time to sleep</span>
          <div style={{ display: "flex", gap: 7 }}>
            <div onClick={() => { setMode("list"); void bridge().win("hide"); }} style={{ flex: 1, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#ff4d17", fontSize: 10, color: "#0b0b0d" }}>ok</div>
            <div onClick={() => { setMode("list"); void bridge().snoozeBedtime(); void bridge().win("hide"); }} style={{ flex: 1, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#17171d", fontSize: 10, color: "#c9c8c2" }}>ten more minutes</div>
          </div>
        </div>
      )}

      {(mode === "pack" || mode === "relax") && (
        <div style={{ position: "relative", height: 242, padding: "20px 16px", display: "flex", alignItems: "center", gap: 13, animation: "wFade .34s ease-out" }}>
          <Ms style={{ fontSize: 30, flex: "none", color: "#ff4d17", animation: mode === "pack" ? "wRelax .6s cubic-bezier(.2,1.1,.3,1) both" : "wRelax .7s cubic-bezier(.2,1.1,.3,1) both, wSway 4.4s ease-in-out 1s infinite" }}>{mode === "pack" ? "backpack" : "self_improvement"}</Ms>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: D, fontSize: 25, lineHeight: 1, animation: "wStep .5s cubic-bezier(.2,.9,.25,1) .1s both" }}>{mode === "pack" ? "pack your bag" : "time to relax"}</span>
            {mode === "pack" && <span style={{ fontSize: 10, lineHeight: 1.3, color: "#9a9aa3" }}>{countWord(snap.bag.filter((b) => !b.got && !b.kept).length)} {snap.bag.filter((b) => !b.got && !b.kept).length === 1 ? "book" : "books"} for tomorrow, list is on the wall</span>}
          </div>
        </div>
      )}

      {sign && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5, borderRadius: "inherit", overflow: "hidden", background: "#f4f3ef", padding: 16, display: "flex", flexDirection: "column", animation: signLeaving ? "wSignOut .45s cubic-bezier(.5,0,.75,0) both" : "wSignIn .6s cubic-bezier(.32,.72,0,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#5f5f67" }}>{sign === "done" ? "ALL SET" : "SCHOOL ACCOUNT"}</span>
            {sign === "ask" && <span onClick={signClose} style={{ cursor: "pointer" }}><Ms style={{ fontSize: 16, color: "#5f5f67" }}>close</Ms></span>}
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <span style={{ fontFamily: D, fontSize: 38, lineHeight: 0.95, letterSpacing: -0.5, color: "#111114", textWrap: "balance", animation: "wStep .45s cubic-bezier(.32,.72,0,1) both" }}>{sign === "done" ? "you're in. syncing" : sign === "open" ? "finish in the sign-in window" : "sign in to school again"}</span>
          </div>
          {sign === "ask" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div onClick={signGo} style={{ height: 58, borderRadius: 16, background: "#ff4d17", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", cursor: "pointer" }}>
                <span style={{ fontFamily: D, fontSize: 24, lineHeight: 1, color: "#0b0b0d" }}>sign in</span>
                <Ms style={{ fontSize: 24, color: "#0b0b0d" }}>north_east</Ms>
              </div>
              <div onClick={signClose} style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <span style={{ fontSize: 11, color: "#5f5f67" }}>after this session</span>
              </div>
            </div>
          )}
        </div>
      )}

      {nudge && mode === "list" && (
        <div onClick={clearNudge} className="nodrag" style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 4, display: "flex", alignItems: "center", gap: 9, padding: "10px 11px", borderRadius: 12, background: "#ff4d17", cursor: "pointer", transformOrigin: "50% 0", animation: leaving ? "wNudgeOut .42s cubic-bezier(.5,0,.75,0) both" : "wRiseIn .55s cubic-bezier(.32,.72,0,1) both" }}>
          <Ms style={{ fontSize: 15, flex: "none", color: "#0b0b0d" }}>{nudge.icon}</Ms>
          <span style={{ fontSize: 10, lineHeight: 1.25, flex: 1, minWidth: 0, color: "#0b0b0d", textWrap: "pretty" }}>{nudge.line}</span>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, anim = "wIn .4s ease-out" }: { children: React.ReactNode; anim?: string }) {
  // Scale the card: Ctrl+scroll anywhere on it, or drag the grip that shows on hover.
  const scaleNow = () => window.innerWidth / 268;
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    void bridge().scale(scaleNow() * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  };
  const grip = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.screenX, k0 = scaleNow();
    const fromLeft = window.screenX + window.innerWidth / 2 > screen.availWidth / 2; // docked right → grip grows leftwards
    let raf = 0;
    const mv = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => void bridge().scale(k0 + ((fromLeft ? x0 - ev.screenX : ev.screenX - x0) / 268) * k0));
    };
    const up = () => (window.removeEventListener("pointermove", mv), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="hudShell" onWheel={onWheel} style={{ position: "relative", width: 268, height: 242, borderRadius: 16, background: "#0e0e13", boxShadow: "inset 0 0 0 1px #ffffff17", overflow: "hidden", animation: anim }}>
      {children}
      <span className="nodrag hudGrip" title="drag to resize" onPointerDown={grip} />
    </div>
  );
}
