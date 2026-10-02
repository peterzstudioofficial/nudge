import type { CSSProperties, ReactNode } from "react";
import type { Vm } from "../device/vm";

const D = "'ZCOOL QingKe HuangYou', sans-serif";
const DOTO = "Doto, monospace";
const Ms = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <span className="ms" style={style}>{children}</span>;

/**
 * What the assistant put up on the wall: a longer answer, a list, a page of a document, one big
 * fact, or a timer. Text is wrapped on the wall and only the lines in view are drawn; nothing
 * moves unless it's turned or counting, so the screen idles at almost no cost.
 */
export function CardView({ vm }: { vm: Vm }) {
  const c = vm.card;
  if (!c) return null;
  const lines = c.kind === "text" || c.kind === "doc" || c.kind === "list";
  return (
    <div key={c.kind + c.title} style={{ position: "absolute", left: 14, right: 14, top: 26, bottom: 44, display: "flex", flexDirection: "column", animation: "sUp .26s ease-out both" }}>
      {lines && (
        <>
          <div style={{ flex: "none", height: 24, display: "flex", alignItems: "center", gap: 7, boxShadow: "inset 0 -1px 0 #1c1c23" }}>
            <Ms style={{ fontSize: 15, flex: "none", color: vm.accent }}>{c.icon}</Ms>
            <span style={{ fontFamily: D, fontSize: 16, lineHeight: 1, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: vm.fg }}>{c.title}</span>
            {c.meta && <span style={{ fontSize: 8, letterSpacing: ".14em", flex: "none", color: vm.dim }}>{c.meta}</span>}
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0, paddingTop: 6 }}>
            {c.lines.map((l, i) => (
              <div key={i} style={{ height: 15, fontSize: 10, lineHeight: "15px", whiteSpace: "pre", color: "#dedad4", display: "flex" }}>
                {c.kind === "list" && <span style={{ width: 18, flex: "none", fontFamily: l.m === "•" ? "inherit" : DOTO, fontWeight: 900, color: vm.accent }}>{l.m ?? ""}</span>}
                <span>{l.t}</span>
              </div>
            ))}
            {c.thumb && (
              <span style={{ position: "absolute", right: -8, top: 6, bottom: 0, width: 2, borderRadius: 1, background: "#1c1c23" }}>
                <span style={{ position: "absolute", left: 0, right: 0, borderRadius: 1, background: vm.accent, top: `${c.thumb.at * 100}%`, height: `${Math.max(8, c.thumb.len * 100)}%`, transition: "top .2s ease-out" }} />
              </span>
            )}
          </div>
        </>
      )}

      {c.kind === "info" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Ms style={{ fontSize: 20, color: vm.accent }}>{c.icon}</Ms>
          <span style={{ fontSize: 9, letterSpacing: ".18em", color: vm.dim }}>{c.title.toUpperCase()}</span>
          <span style={{ fontFamily: D, fontSize: c.big.length > 7 ? 46 : 68, lineHeight: 0.9, color: vm.fg, whiteSpace: "nowrap" }}>{c.big}</span>
          {c.sub && <span style={{ fontSize: 10, color: "#b9b8b2", textAlign: "center", maxWidth: "90%" }}>{c.sub}</span>}
        </div>
      )}

      {c.kind === "timer" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ms style={{ fontSize: 15, color: vm.accent }}>timer</Ms>
            <span style={{ fontSize: 11, color: vm.fg }}>{c.title === "timer" ? "" : c.title}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 8, letterSpacing: ".14em", color: vm.dim }}>{c.sub}</span>
          </div>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 78, lineHeight: 0.9, letterSpacing: -2, color: c.frac > 0 ? vm.accent : vm.fg }}>{c.big}</span>
          <span style={{ height: 6, borderRadius: 3, overflow: "hidden", background: "#17171d" }}>
            <span style={{ display: "block", height: 6, borderRadius: 3, background: vm.accent, width: `${c.frac * 100}%`, transition: "width 1s linear" }} />
          </span>
        </div>
      )}
    </div>
  );
}
