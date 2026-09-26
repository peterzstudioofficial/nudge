import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HubError } from "@nudge/shared";

export const D = "'ZCOOL QingKe HuangYou', sans-serif";
export const DOTO = "Doto, monospace";
export const MONO = "'DM Mono', ui-monospace, monospace";

export function Ms({ children, style, fill }: { children: ReactNode; style?: CSSProperties; fill?: boolean }) {
  return (
    <span className="ms" style={{ ...(fill ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 20' } : {}), ...style }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Toast — the slab that drops out of the top edge (design rule: never  */
/* floats, one at a time, leaves on its own).                          */
/* ------------------------------------------------------------------ */

type ToastMsg = { icon: string; line: string; leaving?: boolean; id: number } | null;
let push: ((icon: string, line: string, ms?: number) => void) | null = null;

export function toast(icon: string, line: string, ms = 3000) {
  push?.(icon, line, ms);
}

/** Show a hub refusal the same way the wall would. */
export function toastError(e: unknown) {
  if (e instanceof HubError) {
    const slab = (e.body as { slab?: { icon: string; line: string } } | undefined)?.slab;
    toast(slab?.icon ?? "error", slab?.line ?? e.message);
  } else toast("cloud_off", "saved — will sync when back online");
}

export function Toaster({ dark = false }: { dark?: boolean }) {
  const [t, setT] = useState<ToastMsg>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    push = (icon, line, ms = 3000) => {
      timers.current.forEach(clearTimeout);
      const id = Date.now();
      setT({ icon, line, id });
      timers.current = [
        window.setTimeout(() => setT((p) => (p && p.id === id ? { ...p, leaving: true } : p)), ms),
        window.setTimeout(() => setT((p) => (p && p.id === id ? null : p)), ms + 460),
      ];
    };
    return () => {
      push = null;
    };
  }, []);
  if (!t) return null;
  const bg = dark ? "#f4f3ef" : "#17171b";
  const fg = dark ? "#111114" : "#f4f3ef";
  return (
    <div style={{ position: "fixed", left: 0, right: 0, top: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 100 }}>
      <div style={{ position: "relative", animation: t.leaving ? "aLift .4s cubic-bezier(.5,0,.75,0) both" : "aDrop .52s cubic-bezier(.32,.72,0,1)", transformOrigin: "50% 0", filter: "drop-shadow(0 8px 18px #00000066)" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, maxWidth: "min(86vw, 360px)", padding: "calc(11px + env(safe-area-inset-top)) 16px 13px", borderRadius: "0 0 21px 21px", background: bg, color: fg }}>
          <span style={{ position: "absolute", left: -15, top: 0, width: 15, height: 16, background: bg, mask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)" }} />
          <span style={{ position: "absolute", right: -15, top: 0, width: 15, height: 16, background: bg, mask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)" }} />
          <Ms style={{ fontSize: 17, flex: "none", color: "#ff4d17" }}>{t.icon}</Ms>
          <span style={{ fontSize: 11, lineHeight: 1.3 }}>{t.line}</span>
        </div>
      </div>
    </div>
  );
}

/** Bottom sheet / pop-up card used across the apps. */
export function Sheet({ open, onClose, title, children, dark = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dark?: boolean }) {
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
    } else if (shown) {
      setClosing(true);
      const t = setTimeout(() => setShown(false), 240);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!shown) return null;
  const bg = dark ? "#101015" : "#f4f3ef";
  const fg = dark ? "#f4f3ef" : "#17171b";
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "#17171b59", animation: closing ? "scrimOut .24s ease both" : "scrimIn .28s ease both" }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 51, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "min(100%, 520px)", maxHeight: "88vh", overflow: "auto", borderRadius: "26px 26px 0 0", background: bg, color: fg, pointerEvents: "auto", padding: "0 18px calc(22px + env(safe-area-inset-bottom))", boxShadow: "0 -20px 50px -20px #00000073", animation: closing ? "sheetDown .24s cubic-bezier(.4,0,1,1) both" : "sheetUp .42s cubic-bezier(.32,.72,0,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", height: 54, position: "sticky", top: 0, background: bg, zIndex: 1 }}>
            <span onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: dark ? "#1d1d24" : "#e9e8e3" }}>
              <Ms style={{ fontSize: 18 }}>close</Ms>
            </span>
            <span style={{ flex: 1, textAlign: "center", fontFamily: D, fontSize: 18 }}>{title}</span>
            <span style={{ width: 32 }} />
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
      <span style={{ fontSize: 9, letterSpacing: ".2em", opacity: 0.6, textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle = (dark: boolean): CSSProperties => ({
  height: 44, borderRadius: 12, border: 0, outline: 0, padding: "0 14px", fontFamily: MONO, fontSize: 14,
  background: dark ? "#17171d" : "#ffffff", color: dark ? "#f4f3ef" : "#17171b",
  boxShadow: dark ? "inset 0 0 0 1px #26262e" : "inset 0 0 0 1.5px #e2e0d9",
});

export function Btn({ children, onClick, dark = false, primary = false, disabled = false, style }: { children: ReactNode; onClick?: () => void; dark?: boolean; primary?: boolean; disabled?: boolean; style?: CSSProperties }) {
  const bg = disabled ? (dark ? "#13131a" : "#eae7e1") : primary ? "#ff4d17" : dark ? "#f4f3ef" : "#111114";
  const fg = disabled ? (dark ? "#5c5c66" : "#a5a5ad") : primary ? "#0b0b0d" : dark ? "#0b0b0d" : "#f4f3ef";
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{ height: 50, width: "100%", borderRadius: 14, border: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: disabled ? "default" : "pointer", background: bg, color: fg, fontFamily: MONO, fontSize: 11, letterSpacing: ".06em", transition: "background-color .3s", ...style }}
    >
      {children}
    </button>
  );
}
