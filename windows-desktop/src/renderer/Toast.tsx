import { useEffect, useRef, useState } from "react";
import { bridge } from "./bridge";

/**
 * Nudge's own notifications on the computer. They slide out of the on-task window's edge like a
 * phone notification, but in Nudge's shape: the off-white slab with an orange icon, the same one
 * that drops from the top of the wall. One at a time; a new one replaces the old.
 */
export interface ToastMsg {
  id: number;
  icon: string;
  line: string;
  sub?: string;
  /** where it grows from: "up" when the window sits at the bottom of the screen */
  dir: "up" | "down";
  ms: number;
  action?: string;
}

const Ms = ({ children, style }: { children: string; style?: React.CSSProperties }) => <span className="ms" style={style}>{children}</span>;

export function Toast() {
  const [t, setT] = useState<ToastMsg | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);

  const close = () => {
    setLeaving(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setT(null);
      setLeaving(false);
      void bridge().toastDone();
    }, 380);
  };

  useEffect(
    () =>
      bridge().on("toast", (m) => {
        const msg = m as ToastMsg;
        window.clearTimeout(timer.current);
        setLeaving(false);
        setT(msg);
        timer.current = window.setTimeout(close, msg.ms);
      }),
    [],
  );

  if (!t) return null;
  const up = t.dir === "up";
  return (
    <div
      key={t.id}
      onClick={() => (t.action ? void bridge().toastAction(t.action) : undefined, close())}
      onMouseEnter={() => window.clearTimeout(timer.current)}
      onMouseLeave={() => (timer.current = window.setTimeout(close, 1800))}
      style={{
        position: "absolute", left: 0, right: 0, [up ? "bottom" : "top"]: 0,
        display: "flex", alignItems: "center", gap: 11, padding: "12px 14px",
        borderRadius: 16, background: "#f4f3ef", color: "#111114", cursor: "pointer",
        boxShadow: "0 14px 30px -10px #000000b3, inset 0 0 0 1px #0000000d",
        transformOrigin: up ? "50% 100%" : "50% 0",
        animation: leaving ? `tOut${up ? "Up" : "Down"} .38s cubic-bezier(.5,0,.75,0) both` : `tIn${up ? "Up" : "Down"} .55s cubic-bezier(.32,.72,0,1) both`,
      }}
    >
      <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: "#0b0b0d", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ms style={{ fontSize: 17, color: "#ff4d17" }}>{t.icon}</Ms>
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 11.5, lineHeight: 1.3, color: "#111114", textWrap: "pretty" }}>{t.line}</span>
        {t.sub && <span style={{ fontSize: 8.5, letterSpacing: ".14em", color: "#6f6f78", textTransform: "uppercase" }}>{t.sub}</span>}
      </div>
      <span style={{ position: "absolute", left: 14, right: 14, [up ? "bottom" : "top"]: 0, height: 2, borderRadius: 1, background: "#ff4d17", transformOrigin: "0 50%", animation: leaving ? "none" : `tBar ${t.ms}ms linear both` }} />
    </div>
  );
}
