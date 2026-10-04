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
  } else if (e instanceof Error && !(e instanceof TypeError) && e.message) toast("error", e.message.slice(0, 70));
  else toast("cloud_off", "offline — it'll sync when the wall's back");
  haptic("warn");
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
  const bg = dark ? "var(--c-f4f3ef)" : "var(--c-17171b)";
  const fg = dark ? "var(--c-111114)" : "var(--c-f4f3ef)";
  return (
    <div style={{ position: "fixed", left: 0, right: 0, top: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 100 }}>
      <div style={{ position: "relative", animation: t.leaving ? "aLift .4s cubic-bezier(.5,0,.75,0) both" : "aDrop .52s cubic-bezier(.32,.72,0,1)", transformOrigin: "50% 0", filter: "drop-shadow(0 8px 18px var(--c-00000066))" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, maxWidth: "min(86vw, 360px)", padding: "calc(11px + env(safe-area-inset-top)) 16px 13px", borderRadius: "0 0 21px 21px", background: bg, color: fg }}>
          <span style={{ position: "absolute", left: -15, top: 0, width: 15, height: 16, background: bg, mask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)" }} />
          <span style={{ position: "absolute", right: -15, top: 0, width: 15, height: 16, background: bg, mask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)" }} />
          <Ms style={{ fontSize: 17, flex: "none", color: "var(--c-ff4d17)" }}>{t.icon}</Ms>
          <span style={{ fontSize: 11, lineHeight: 1.3 }}>{t.line}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * A tiny tap of the vibration motor, like a native control. Android only (iOS Safari and desktops
 * ignore it); never more than a few milliseconds.
 */
export function haptic(kind: "tick" | "confirm" | "warn" = "tick") {
  try {
    navigator.vibrate?.(kind === "tick" ? 8 : kind === "confirm" ? [10, 50, 16] : [22, 70, 22]);
  } catch {
    /* not allowed here */
  }
}

/**
 * Bottom sheet used across the apps. Behaves like a native one: drag it down (or swipe it away)
 * to close, the phone's back button and Escape close it, and the page behind doesn't scroll.
 */
export function Sheet({ open, onClose, title, children, dark = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dark?: boolean }) {
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(open);
  const [flung, setFlung] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const drag = useRef<{ y0: number; t0: number; dy: number; on: boolean; id: number } | null>(null);

  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      setFlung(false);
    } else if (shown) {
      setClosing(true);
      const t = setTimeout(() => setShown(false), 240);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Back button / Escape close it; the page behind stays put.
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    let popped = false;
    history.pushState({ ...(history.state ?? {}), sheet: id }, "");
    const onPop = () => {
      popped = true;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (!popped && history.state?.sheet === id) history.back();
    };
  }, [open]);

  if (!shown) return null;
  const bg = dark ? "var(--c-101015)" : "var(--c-f4f3ef)";
  const fg = dark ? "var(--c-f4f3ef)" : "var(--c-17171b)";

  // Drag down from anywhere once the sheet is scrolled to its top.
  const down = (e: React.PointerEvent) => {
    if (closing || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, on: false, id: e.pointerId };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = panel.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (dy > 8 && el.scrollTop <= 0) {
        d.on = true;
        d.y0 = e.clientY;
        d.t0 = performance.now();
        el.setPointerCapture(d.id);
        el.style.transition = "none";
      } else if (Math.abs(dy) > 8) drag.current = null;
      return;
    }
    d.dy = Math.max(0, dy);
    el.style.transform = `translateY(${d.dy}px)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, 1 - d.dy / el.offsetHeight));
  };
  const up = () => {
    const d = drag.current;
    const el = panel.current;
    drag.current = null;
    if (!d?.on || !el) return;
    const v = d.dy / Math.max(1, performance.now() - d.t0); // px per ms
    if (d.dy > Math.min(160, el.offsetHeight * 0.3) || (v > 0.55 && d.dy > 30)) {
      haptic();
      setFlung(true);
      el.style.transition = `transform ${Math.max(0.14, Math.min(0.28, (el.offsetHeight - d.dy) / 1800))}s cubic-bezier(.3,0,.8,.6)`;
      el.style.transform = "translateY(100%)";
      if (scrim.current) {
        scrim.current.style.transition = "opacity .24s ease";
        scrim.current.style.opacity = "0";
      }
      close.current();
    } else {
      el.style.transition = "transform .42s cubic-bezier(.32,.72,0,1)";
      el.style.transform = "";
      if (scrim.current) {
        scrim.current.style.transition = "opacity .3s ease";
        scrim.current.style.opacity = "";
      }
    }
  };

  return (
    <>
      <div ref={scrim} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--c-17171b59)", animation: flung ? "none" : closing ? "scrimOut .24s ease both" : "scrimIn .28s ease both" }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 51, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{
            width: "min(100%, 520px)", maxHeight: "88vh", overflow: "auto", overscrollBehavior: "contain", borderRadius: "26px 26px 0 0", background: bg, color: fg, pointerEvents: "auto",
            padding: "0 18px calc(22px + env(safe-area-inset-bottom))", boxShadow: "0 -20px 50px -20px var(--c-00000073)", touchAction: "pan-y",
            animation: flung ? "none" : closing ? "sheetDown .24s cubic-bezier(.4,0,1,1) both" : "sheetUp .46s cubic-bezier(.32,.72,0,1) backwards",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", height: 58, position: "sticky", top: 0, background: bg, zIndex: 1 }}>
            <span aria-hidden style={{ position: "absolute", left: "50%", top: 7, width: 36, height: 4, marginLeft: -18, borderRadius: 2, background: dark ? "var(--c-2a2a33)" : "var(--c-d6d4cc)" }} />
            <span className="tap" role="button" aria-label="close" onClick={onClose} style={{ width: 32, height: 32, marginTop: 6, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: dark ? "var(--c-1d1d24)" : "var(--c-e9e8e3)" }}>
              <Ms style={{ fontSize: 18 }}>close</Ms>
            </span>
            <span style={{ flex: 1, textAlign: "center", fontFamily: D, fontSize: 18, marginTop: 6 }}>{title}</span>
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
  background: dark ? "var(--c-17171d)" : "var(--c-ffffff)", color: dark ? "var(--c-f4f3ef)" : "var(--c-17171b)",
  boxShadow: dark ? "inset 0 0 0 1px var(--c-26262e)" : "inset 0 0 0 1.5px var(--c-e2e0d9)",
});

export function Btn({ children, onClick, dark = false, primary = false, disabled = false, style }: { children: ReactNode; onClick?: () => void; dark?: boolean; primary?: boolean; disabled?: boolean; style?: CSSProperties }) {
  const bg = disabled ? (dark ? "var(--c-13131a)" : "var(--c-eae7e1)") : primary ? "var(--c-ff4d17)" : dark ? "var(--c-f4f3ef)" : "var(--c-111114)";
  const fg = disabled ? (dark ? "var(--c-5c5c66)" : "var(--c-a5a5ad)") : primary ? "var(--c-0b0b0d)" : dark ? "var(--c-0b0b0d)" : "var(--c-f4f3ef)";
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
