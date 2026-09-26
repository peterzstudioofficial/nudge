import "@nudge/shared/tokens.css";
import "./ui/screen.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Screen } from "./ui/Screen";
import { useDevice } from "./device/useDevice";
import { attachKeyboard } from "./input";
import type { Mode } from "./device/types";

/**
 * Dev / testing mode: the whole ND-1 Panel v2 on your computer — screen, four keys, dial,
 * touch pad, 5×5 LEDs, light bar, switches — talking to a real hub running in dev mode.
 * Everything here is what the Pi does; only the physical parts are drawn instead of wired.
 */

const STATES: Mode[] = [
  "boot", "alarm", "brief", "welcome", "standby", "select", "countdown", "active", "paused", "break", "resumeScan",
  "claim", "bag", "reward", "unlock", "nextReward", "breathe", "doze", "offline", "resume", "agent", "agent2",
  "update", "sleep", "bright", "about", "pair", "disco",
];
const SIZES = [
  { label: "design 320×240", w: 320, h: 240 },
  { label: "800×480", w: 800, h: 480 },
  { label: "1024×600", w: 1024, h: 600 },
  { label: "1280×720", w: 1280, h: 720 },
  { label: "1920×1080", w: 1920, h: 1080 },
];

function Panel() {
  const [size, setSize] = useState(SIZES[0]);
  const scale = size.h / 240;
  const logical = { w: size.w / scale, h: 240 };
  const { d, vm, panel } = useDevice(logical);
  const [voice, setVoice] = useState("");
  useEffect(() => attachKeyboard(d), [d]);
  const dialRef = useRef<HTMLDivElement>(null);

  // Show the screen inside the panel at the design's 466×350 window, or at full preview size.
  const inPanel = size.w === 320;
  const winScale = inPanel ? 1.4562 : Math.min(1, 900 / size.w) * scale;

  const dialDown = (e: React.PointerEvent) => {
    const b = e.currentTarget.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    let last = Math.atan2(e.clientY - cy, e.clientX - cx), acc = 0;
    const move = (ev: PointerEvent) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let da = a - last;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      last = a;
      acc += (da * 180) / Math.PI;
      if (Math.abs(acc) > 24) {
        d.turn(acc > 0 ? 1 : -1);
        acc = 0;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const settings = d.snap?.settings;
  const patch = (p: Record<string, unknown>) => void d.client.send("PATCH", "/api/settings", p).then(() => d.client.snapshot());
  const btn = (label: string, on: boolean, go: () => void, dashed = false) => (
    <div
      key={label}
      onClick={go}
      style={{
        padding: "8px 13px", borderRadius: 6, fontSize: 10, letterSpacing: ".1em", cursor: "pointer",
        border: `1px ${dashed ? "dashed" : "solid"} #ffffff${dashed ? "33" : "1f"}`,
        background: on ? "#ff4d17" : "transparent", color: on ? "#0b0b0d" : "#b6b5af",
      }}
    >
      {label}
    </div>
  );
  const at = (h: number, m: number) => {
    const t = new Date();
    t.setHours(h, m, 0, 0);
    d.sim.clockOffsetMs = t.getTime() - Date.now();
    d.set({});
  };
  const effective = d.effectiveMode();

  return (
    <div style={{ minHeight: "100vh", padding: "40px 48px 80px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 36, background: "radial-gradient(130% 90% at 50% 0%,#1e1e23,#0a0a0d 74%)", fontFamily: "'DM Mono',ui-monospace,monospace" }}>
      <div style={{ width: 1000, display: "flex", alignItems: "flex-end", justifyContent: "space-between", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#5f5f67" }}>
        <span>peterzstudio nudge · nd-1 · dev simulator</span>
        <span>dial: drag / ← → / push enter · keys 1-4 · t touch pad</span>
      </div>

      {inPanel ? (
        <div style={{ position: "relative", width: 1000, height: 700, borderRadius: 16, background: "linear-gradient(160deg,#f4f2ed,#eae8e1 54%,#e2e0d8)", boxShadow: "0 60px 120px -46px #0000008c,inset 0 2px 0 #ffffff,inset 0 -2px 0 #00000012", color: "#26262a" }}>
          <div style={{ position: "absolute", inset: 6, borderRadius: 12, pointerEvents: "none", boxShadow: "inset 0 0 0 1px #ffffffb3,inset 0 0 0 2px #0000000f" }} />
          {[[22, 22, 22], [540, 22, -8], [958, 22, 40], [22, 658, -31], [540, 382, 12], [958, 658, -19]].map(([x, y, r], i) => (
            <div key={i} style={{ position: "absolute", left: x, top: y, width: 20, height: 20, borderRadius: "50%", background: "radial-gradient(circle at 38% 32%,#f6f5f1,#d2d0c8 70%,#c2c0b8)", boxShadow: "inset 0 1px 2px #ffffff,0 1px 2px #00000026" }}>
              <span style={{ position: "absolute", left: "50%", top: "50%", width: 11, height: 2, margin: "-1px 0 0 -5.5px", borderRadius: 1, background: "#a8a69e", transform: `rotate(${r}deg)` }} />
            </div>
          ))}
          <div style={{ position: "absolute", left: 49, top: 49, width: 466, height: 350, borderRadius: 14, overflow: "hidden", background: "#000", boxShadow: "0 1px 0 #ffffffd9" }}>
            <div style={{ width: 320, height: 240, transform: `scale(${winScale})`, transformOrigin: "0 0" }}>
              <Screen vm={vm} radius={10} onKeyDown={d.keyDown} onKeyUp={d.keyUp} />
            </div>
          </div>

          {[0, 1, 2, 3].map((i) => {
            const has = panel.plan[i];
            const down = panel.holdKey === i;
            return (
              <div
                key={i}
                onPointerDown={() => d.keyDown(i)}
                onPointerUp={d.keyUp}
                onPointerLeave={d.keyUp}
                style={{
                  position: "absolute", top: 424, left: 65 + i * 114, width: 100, height: 100, borderRadius: 11, cursor: "pointer", overflow: "hidden",
                  background: has ? "linear-gradient(#fdfdfb,#efede7)" : "linear-gradient(#f0eee8,#e4e2da)",
                  boxShadow: down ? "0 1px 0 #d2d0c8,inset 0 2px 5px #00000026" : has ? "0 5px 0 #d6d4cc,0 11px 16px -9px #00000040,inset 0 0 0 1px #ffffff" : "0 4px 0 #dcdad2,inset 0 0 0 1px #ffffffd9",
                  transform: `translateY(${down ? 3 : 0}px)`, transition: "transform .1s cubic-bezier(.3,0,.4,1),box-shadow .1s",
                }}
              >
                <span style={{ position: "absolute", inset: 0, background: "linear-gradient(#ffffffcc,transparent 56%)", pointerEvents: "none" }} />
                <span style={{ position: "absolute", left: 0, bottom: 0, height: 4, background: "#ff4d17", width: down ? panel.hold * 100 + "%" : "0%", transition: "width .09s linear" }} />
              </div>
            );
          })}

          <div style={{ position: "absolute", left: 46, top: 562, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: "'ZCOOL QingKe HuangYou',sans-serif", fontSize: 50, lineHeight: 1, letterSpacing: -1.5, color: "#26262a" }}>nudge</span>
            <span style={{ fontFamily: "Doto,monospace", fontWeight: 900, fontSize: 8, letterSpacing: ".3em", color: "#a8a69e" }}>PETERZSTUDIO · ND-1</span>
          </div>

          <div onClick={d.wake} style={{ position: "absolute", left: 266, top: 556, width: 252, height: 104, borderRadius: 13, cursor: "pointer", background: "linear-gradient(#f7f6f2,#e8e6df)", boxShadow: "inset 0 0 0 1px #ffffff,0 3px 0 #d6d4cc,0 8px 14px -8px #0000003d", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <span style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", border: `2px solid ${panel.touchRing ? "#ff4d17" : "#c2c0b8"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color .35s" }}>
              <span style={{ position: "absolute", width: 15, height: 2, borderRadius: 1, background: panel.touchRing ? "#ff4d17" : "#c2c0b8" }} />
              <span style={{ position: "absolute", width: 2, height: 15, borderRadius: 1, background: panel.touchRing ? "#ff4d17" : "#c2c0b8" }} />
            </span>
            <span style={{ fontSize: 8, letterSpacing: ".28em", color: "#a8a69e" }}>TOUCH</span>
          </div>

          <div ref={dialRef} onPointerDown={dialDown} onWheel={(e) => d.turn(e.deltaY > 0 ? 1 : -1)} style={{ position: "absolute", left: 598, top: 44, width: 284, height: 284, borderRadius: "50%", background: "radial-gradient(circle at 50% 50%,#f0eee8 60%,#e0ded6 82%,#d2d0c8)", boxShadow: "inset 0 0 0 1px #ffffff,0 2px 5px -2px #00000026", display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", touchAction: "none" }}>
            <div style={{ position: "relative", width: 224, height: 224, borderRadius: "50%", background: "conic-gradient(from 210deg,#b8b6ae,#f4f3ef 12%,#a8a6a0 27%,#eceae4 42%,#adaba4 56%,#f2f0ea 70%,#b2b0a8 85%,#e4e2da 100%)", boxShadow: "0 6px 16px -8px #00000059,inset 0 0 0 1px #ffffff80", transform: `rotate(${d.s.dial}deg)`, transition: "transform .13s cubic-bezier(.2,.9,.25,1)" }}>
              <span style={{ position: "absolute", left: "50%", top: 26, width: 4, height: 56, marginLeft: -2, borderRadius: 2, background: "#4a4a4e" }} />
            </div>
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                d.set({ dialPress: true });
                setTimeout(() => d.set({ dialPress: false }), 130);
                d.pressDial();
              }}
              style={{ position: "absolute", left: "50%", top: "50%", width: 52, height: 52, margin: "-26px 0 0 -26px", borderRadius: "50%", cursor: "pointer", background: "radial-gradient(circle at 42% 34%,#f6f5f1,#dedcd4)", boxShadow: "inset 0 0 0 1px #ffffff,0 2px 5px -2px #00000040", display: "flex", alignItems: "center", justifyContent: "center", transform: `translateY(${d.s.dialPress ? 2 : 0}px)`, transition: "transform .1s cubic-bezier(.3,0,.4,1)" }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff4d17", opacity: panel.dialLed, transition: "opacity .35s" }} />
            </div>
          </div>

          <div style={{ position: "absolute", left: 600, top: 378, display: "grid", gridTemplateColumns: "repeat(5,34px)", gridTemplateRows: "repeat(5,34px)", gap: 32 }}>
            {panel.leds.map((l, i) => (
              <span key={i + panel.pat} style={{ width: 34, height: 34, borderRadius: "50%", background: l.bg, opacity: l.o, boxShadow: l.glow, animation: l.anim, animationDelay: l.delay, transition: "background-color .5s cubic-bezier(.4,0,.2,1),opacity .45s ease,box-shadow .5s ease" }} />
            ))}
          </div>
          <div style={{ position: "absolute", left: 600, top: 658, width: 298, textAlign: "center", fontSize: 8, letterSpacing: ".26em", color: "#a8a69e" }}>{panel.ledLabel}</div>
        </div>
      ) : (
        <div style={{ borderRadius: 12, overflow: "hidden", boxShadow: "0 40px 90px -40px #000", outline: "8px solid #1a1a1f" }}>
          <div style={{ width: size.w * Math.min(1, 900 / size.w), height: size.h * Math.min(1, 900 / size.w), overflow: "hidden" }}>
            <div style={{ width: logical.w, height: logical.h, transform: `scale(${winScale})`, transformOrigin: "0 0" }}>
              <Screen vm={vm} onKeyDown={d.keyDown} onKeyUp={d.keyUp} />
            </div>
          </div>
        </div>
      )}

      <div style={{ width: 1000, display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#5f5f67" }}>TOP / LOOKING DOWN</span>
        <div style={{ position: "relative", width: 1000, height: 76, borderRadius: 14, background: "linear-gradient(#f0eee8,#e2e0d8)", boxShadow: "0 22px 50px -28px #000000a6,inset 0 2px 0 #ffffff", display: "flex", alignItems: "center", padding: "0 48px", gap: 22 }}>
          <div style={{ position: "relative", flex: 1, height: 22, borderRadius: 11, overflow: "hidden", background: "#dad8d0", boxShadow: "inset 0 2px 5px #00000026" }}>
            <div style={{ position: "absolute", left: 2, top: 2, bottom: 2, right: 2, borderRadius: 9, background: "linear-gradient(94deg,#fff4ec,#ffe3d4)", opacity: panel.barLit, transition: "opacity .7s cubic-bezier(.4,0,.2,1)" }} />
            <div style={{ position: "absolute", left: 2, top: 2, bottom: 2, borderRadius: 9, background: "linear-gradient(94deg,#ff7a33,#ff4d17)", width: panel.barPct + "%", opacity: panel.barOn, boxShadow: "0 0 18px 3px #ff4d1766", transition: "width 1s cubic-bezier(.4,0,.2,1),opacity .6s ease" }} />
            <div style={{ position: "absolute", inset: 2, borderRadius: 9, pointerEvents: "none", background: "linear-gradient(#ffffff8c,transparent 48%)" }} />
          </div>
          <span style={{ fontSize: 8, letterSpacing: ".24em", flex: "none", color: "#a8a69e" }}>PROGRESS</span>
        </div>
      </div>

      <div style={{ width: 1000, height: 74, borderRadius: 15, background: "linear-gradient(#eae7e1,#d9d5cd)", boxShadow: "0 24px 56px -30px #000000a6,inset 0 2px 0 #ffffff8c", display: "flex", alignItems: "center", padding: "0 38px", gap: 38 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ width: 50, height: 17, borderRadius: 9, background: "#2a2a2e", boxShadow: "inset 0 2px 4px #000000a6" }} />
          <span style={{ fontSize: 8, letterSpacing: ".2em", color: "#8e8a82" }}>USB-C</span>
        </div>
        <div style={{ flex: 1 }} />
        {[
          { label: "ON / OFF", on: d.s.power, go: () => d.input({ kind: "power", on: !d.s.power }) },
          { label: "LISTENING " + (d.s.mic ? "ON" : "OFF"), on: d.s.mic, go: () => d.input({ kind: "mic", on: !d.s.mic }) },
        ].map((t) => (
          <div key={t.label} onClick={t.go} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }}>
            <div style={{ width: 66, height: 29, borderRadius: 15, background: "#d0ccc4", boxShadow: "inset 0 2px 4px #00000024", padding: 3, display: "flex", justifyContent: t.on ? "flex-end" : "flex-start" }}>
              <span style={{ width: 23, height: 23, borderRadius: "50%", background: "linear-gradient(#f7f5f1,#d5d1c9)", boxShadow: "0 1px 3px #00000059" }} />
            </div>
            <span style={{ fontSize: 8, letterSpacing: ".2em", color: "#4a4a50" }}>{t.label}</span>
          </div>
        ))}
      </div>

      <div style={{ width: 1080, display: "flex", flexDirection: "column", gap: 14, paddingTop: 12, borderTop: "1px solid #ffffff17" }}>
        <Row label="size">{SIZES.map((s) => btn(s.label, s === size, () => setSize(s)))}</Row>
        <Row label="day">
          {btn(settings?.iconKeys ? "icon keys" : "word keys", !!settings?.iconKeys, () => patch({ iconKeys: !settings?.iconKeys }))}
          {btn(settings?.ai ? "ai on" : "ai off", !!settings?.ai, () => patch({ ai: !settings?.ai }))}
          {btn("real day", d.sim.dayKind === null, () => { d.sim.dayKind = null; d.set({}); })}
          {btn("school day", d.sim.dayKind === "school", () => { d.sim.dayKind = "school"; d.set({}); })}
          {btn("weekend", d.sim.dayKind === "weekend", () => { d.sim.dayKind = "weekend"; d.set({}); })}
          {btn("half term", d.sim.dayKind === "halfterm", () => { d.sim.dayKind = "halfterm"; d.set({}); })}
          {btn(settings?.lieInWeekends ? "lie in allowed" : "lie in off", !!settings?.lieInWeekends, () => patch({ lieInWeekends: !settings?.lieInWeekends }))}
        </Row>
        <Row label="time">
          {btn("real time", d.sim.clockOffsetMs === 0, () => { d.sim.clockOffsetMs = 0; d.set({}); })}
          {btn("07:10", false, () => at(7, 10))}
          {btn("16:08", false, () => at(16, 8))}
          {btn("19:30", false, () => at(19, 30))}
          {btn("23:26", false, () => at(23, 26))}
        </Row>
        <Row label="tags">
          {btn("touch pad", false, d.wake, true)}
          {btn("nfc: home", false, () => d.arrive(), true)}
          {btn("nfc: desk", false, () => d.begin(), true)}
          {btn("nfc: morning", false, () => d.set({ mode: "brief", lastAct: d.now() }), true)}
          <input
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && voice.trim()) {
                d.heard(voice);
                setVoice("");
              }
            }}
            placeholder="say something (after touch pad)…"
            style={{ flex: 1, minWidth: 220, height: 32, borderRadius: 6, border: "1px solid #ffffff1f", background: "transparent", color: "#f4f3ef", padding: "0 10px", fontFamily: "inherit", fontSize: 11 }}
          />
        </Row>
        <Row label="states">{STATES.map((m) => btn(m, effective === m, () => d.jump(m)))}</Row>
        <span style={{ fontSize: 10, color: "#5f5f67", lineHeight: 1.6 }}>
          hub: {d.s.online ? "online" : "offline"} · mode: {effective} · the screen alone (what the Pi shows) is at <a href="./" style={{ color: "#ff4d17" }}>./</a>
        </span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "#55555d", width: 64 }}>{label}</span>
      {children}
    </div>
  );
}

document.body.classList.add("sim");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
