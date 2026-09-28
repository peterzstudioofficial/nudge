import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HOLD_MS, HOLD_MIN_SHOWN_MS } from "@nudge/shared";

/**
 * Press and hold until it fills. Used for anything that leaves the house (emails, messages,
 * work on the computer, paid builds), so a stray tap in a pocket can never send something.
 * It wakes up a moment after it appears (read first), lets go = nothing happens, and it gives a
 * small buzz when it's done.
 */
export function HoldButton({ label, onConfirm, style }: { label: string; onConfirm: () => void; style?: CSSProperties }) {
  const [p, setP] = useState(0);
  const [armed, setArmed] = useState(false);
  const [hint, setHint] = useState(false);
  const raf = useRef(0);
  const t0 = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), HOLD_MIN_SHOWN_MS);
    return () => (window.clearTimeout(t), cancelAnimationFrame(raf.current));
  }, []);

  const tick = () => {
    const v = Math.min(1, (performance.now() - t0.current) / HOLD_MS);
    setP(v);
    if (v >= 1) {
      done.current = true;
      navigator.vibrate?.(18);
      onConfirm();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const down = (e: React.PointerEvent) => {
    if (!armed || done.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    t0.current = performance.now();
    setHint(false);
    raf.current = requestAnimationFrame(tick);
  };
  const up = () => {
    cancelAnimationFrame(raf.current);
    if (done.current) return;
    if (p > 0) setHint(true);
    setP(0);
  };

  return (
    <button
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${label} (press and hold)`}
      style={{
        position: "relative", overflow: "hidden", flex: 1, border: 0, borderRadius: 13, padding: "13px 12px",
        background: "var(--c-2a1810)", color: "var(--c-ff4d17)", font: "inherit", fontSize: 12, letterSpacing: ".04em",
        touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: armed ? "pointer" : "default",
        opacity: armed ? 1 : 0.45, transition: "opacity .5s ease", animation: hint ? "hShake .36s cubic-bezier(.36,.07,.19,.97)" : "none",
        ...style,
      }}
    >
      <span style={{ position: "absolute", inset: 0, background: "var(--c-ff4d17)", transformOrigin: "0 50%", transform: `scaleX(${p})`, transition: p ? "none" : "transform .35s cubic-bezier(.32,.72,0,1)" }} />
      <span style={{ position: "relative", color: p > 0.5 ? "var(--c-0b0b0d)" : undefined, transition: "color .15s" }}>
        {hint ? "keep holding…" : p > 0 ? "hold…" : label}
      </span>
    </button>
  );
}
