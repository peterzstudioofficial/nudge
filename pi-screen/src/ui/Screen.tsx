import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import confetti from "canvas-confetti";
import type { Vm } from "../device/vm";

/**
 * Screen v2 — the 320×240 wall display, ported from "Screen v2.dc.html".
 * Laid out in logical points: 240 tall, and as wide as the real panel's aspect allows
 * (320 on a 4:3 panel, ~410 on 1024×600). Left/right-anchored pieces stretch with it.
 */

const D = "'ZCOOL QingKe HuangYou', sans-serif";
const DOTO = "Doto, monospace";

function Ms({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span className="ms" style={style}>{children}</span>;
}

export interface ScreenProps {
  vm: Vm;
  radius?: number;
  onKeyDown?: (i: number) => void;
  onKeyUp?: () => void;
}

export function Screen({ vm, radius = 0, onKeyDown, onKeyUp }: ScreenProps) {
  const W = vm.w;
  const H = vm.h;
  const fx = useRef<HTMLCanvasElement>(null);
  const lastFx = useRef("");
  const shoot = useRef<ReturnType<typeof confetti.create> | null>(null);

  useEffect(() => {
    if (!vm.fxKey || vm.fxKey === lastFx.current || !fx.current) return;
    lastFx.current = vm.fxKey;
    shoot.current ??= confetti.create(fx.current, { resize: false });
    const big = vm.fxKind === "unlock";
    void shoot.current({
      particleCount: big ? 90 : 45, spread: big ? 100 : 70, startVelocity: big ? 34 : 24, gravity: 0.85, decay: 0.9,
      scalar: big ? 0.62 : 0.5, ticks: big ? 130 : 95, origin: { x: 0.5, y: big ? 0.62 : 0.56 },
      colors: ["#f4f3ef", "#ffffff", "#dedad2"], disableForReducedMotion: true,
    });
  }, [vm.fxKey, vm.fxKind]);

  const tabW = (W - 16 - 27) / 4;
  const slab = vm.slab;

  return (
    <div
      className="scr"
      style={{
        position: "relative", width: W, height: H, overflow: "hidden", borderRadius: radius, fontFamily: "'DM Mono',ui-monospace,monospace",
        background: vm.bg, color: vm.fg, transition: "background-color .45s cubic-bezier(.4,0,.2,1)",
      }}
    >
      {vm.showHead && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 11, height: 11, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 8, letterSpacing: ".14em", animation: "sFade .3s ease-out" }}>
          <span style={{ color: vm.dim }}>{vm.tagline}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, letterSpacing: 1, color: vm.mid }}>{vm.headClock}</span>
            <div style={{ display: "flex", gap: 3 }}>
              {vm.pips.map((p, i) => (
                <span key={i} style={{ width: 7, height: 7, borderRadius: p.r, background: p.f, animation: p.anim, transition: "border-radius .45s cubic-bezier(.4,0,.2,1),background-color .45s cubic-bezier(.4,0,.2,1)" }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {vm.showStandby && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 30, bottom: 66, display: "flex", flexDirection: "column", justifyContent: "space-between", animation: "sFade .34s ease-out" }}>
          <div style={{ fontFamily: D, fontSize: 76, lineHeight: 0.82, letterSpacing: -1, marginLeft: -3, color: vm.fg }}>{vm.clock}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, flex: "none", background: vm.curTint }} />
            <span style={{ fontSize: 12, flex: "none", minWidth: "max-content", color: vm.fg }}>{vm.curName}</span>
            {vm.curNote && <span style={{ fontSize: 8, flex: "none", padding: "2px 5px", borderRadius: 4, background: "#1e1e26", color: "#b9b8b2" }}>{vm.curNote}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 14, flex: "none", color: vm.mid }}>{vm.curDur}</span>
          </div>
        </div>
      )}

      {vm.showAlarm && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, animation: "sFade .3s ease-out" }}>
          <Ms style={{ fontSize: 22, color: vm.accent, animation: "sBell .9s ease-in-out infinite" }}>notifications_active</Ms>
          <span style={{ fontFamily: D, fontSize: 88, lineHeight: 0.9, color: vm.fg }}>{vm.clock}</span>
          <span style={{ fontSize: 9, letterSpacing: ".18em", whiteSpace: "nowrap", color: vm.accent }}>{vm.alarmHint}</span>
        </div>
      )}

      {vm.showBrief && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 38, display: "flex", animation: "sFade .3s ease-out" }}>
          <div style={{ width: 104, flex: "none", padding: "8px 0 8px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
            {vm.sched.map((p, i) => (
              <div key={i} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, flex: p.flex, padding: "0 8px", borderRadius: p.radius, overflow: "hidden", background: p.bg }}>
                <span style={{ width: 3, height: p.barH, borderRadius: 2, flex: "none", background: p.tint }} />
                <span style={{ fontSize: p.size, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p.fg }}>{p.name}</span>
                <span style={{ flex: 1 }} />
                {p.dbl && <span style={{ width: 9, height: 3, borderRadius: 2, flex: "none", background: p.dblC }} />}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, padding: "9px 11px 8px 12px", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, letterSpacing: ".02em", flex: "none", color: vm.fg }}>{vm.briefDay}</span>
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 13, lineHeight: 1, flex: "none", padding: "2px 7px", borderRadius: 9, background: "#f4f3ef", color: "#0b0b0d" }}>{vm.briefNum}</span>
              <span style={{ fontSize: 10, flex: "none", color: vm.briefSubFg }}>{vm.briefMonShort}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 14, flex: "none", color: vm.fg }}>{vm.clock}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Ms style={{ fontSize: 30, flex: "none", color: vm.fg }}>{vm.wxIcon}</Ms>
              <span style={{ fontFamily: D, fontSize: 40, lineHeight: 0.82, flex: "none", color: vm.fg }}>{vm.wxTemp}</span>
              {vm.bdayName && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 10, background: "#17171d", minWidth: 0 }}>
                  <Ms style={{ fontSize: 13, color: vm.accent }}>{vm.bdayIcon}</Ms>
                  <span style={{ fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: vm.fg }}>{vm.bdayName}</span>
                </div>
              )}
              <span style={{ flex: 1 }} />
              {vm.wxRain && <span style={{ fontSize: 10, flex: "none", padding: "3px 8px", borderRadius: 10, background: vm.accent, whiteSpace: "nowrap", color: "#0b0b0d" }}>{vm.wxRain}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 10, flex: "none", padding: "3px 8px", borderRadius: 10, background: "#f4f3ef", color: "#0b0b0d" }}>{vm.briefKind}</span>
              <div style={{ display: "flex", gap: 3, flex: 1, minWidth: 0 }}>
                {vm.pips.map((p, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: p.r, background: p.f }} />)}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 11, overflow: "hidden", background: "#141419", minHeight: 0 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", minHeight: 0 }}>
                <Ms style={{ fontSize: 15, flex: "none", color: vm.mid }}>bolt</Ms>
                <span style={{ fontSize: 10, lineHeight: 1.35, color: vm.newsFg, textWrap: "pretty", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{vm.news}</span>
              </div>
              {vm.heads && (
                <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, padding: "5px 9px", background: vm.accent, animation: "sUp .34s ease-out" }}>
                  <Ms style={{ fontSize: 13, flex: "none", color: "#0b0b0d" }}>push_pin</Ms>
                  <span style={{ fontSize: 10, lineHeight: 1.25, color: "#0b0b0d", textWrap: "pretty" }}>{vm.heads}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {vm.showWelcome && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 26, bottom: 44, display: "flex", gap: 13, animation: "sUp .34s ease-out" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: D, fontSize: 30, lineHeight: 1, color: vm.fg }}>{vm.wcHead}</span>
            <span style={{ fontFamily: D, fontSize: 30, lineHeight: 1, color: vm.accent }}>{vm.wcName}</span>
          </div>
          <div style={{ width: 150, flex: "none", display: "flex", flexDirection: "column", justifyContent: "center", gap: 7 }}>
            {vm.wcRows.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Ms style={{ fontSize: 13, flex: "none", color: r.iconFg }}>{r.icon}</Ms>
                <span style={{ fontSize: 9, flex: "none", minWidth: "max-content", color: vm.mid }}>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vm.showList && (
        <>
          {vm.listRail && (
            <div style={{ position: "absolute", right: 5, top: 30, bottom: 68, width: 3, borderRadius: 2, background: "#16161c" }}>
              <span style={{ display: "block", width: 3, borderRadius: 2, background: vm.accent, height: vm.listRailH, transform: `translateY(${vm.listRailY})`, transition: "transform .45s cubic-bezier(.22,1,.28,1)" }} />
            </div>
          )}
          <div style={{ position: "absolute", left: 12, right: 14, top: 28, bottom: 66, overflow: "hidden", animation: "sUp .26s ease-out" }}>
            <div className="rowsSlide" style={{ display: "flex", flexDirection: "column", gap: 4, transform: `translateY(${vm.rowsY}px)` }}>
              {vm.rows.length === 0 && <span style={{ fontSize: 11, color: vm.dim, padding: "8px 10px" }}>nothing left today</span>}
              {vm.rows.map((r) => (
                <div key={r.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, height: vm.rowH, flex: "none", padding: "0 10px", borderRadius: 8, overflow: "hidden", background: r.bg, transition: "background-color .45s cubic-bezier(.22,1,.28,1)" }}>
                  <span style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: r.progW, borderRadius: "0 2px 0 0", background: r.progC, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
                  <span style={{ width: 10, height: 10, borderRadius: 3, flex: "none", background: r.tint }} />
                  <span style={{ fontSize: 11, flex: "none", minWidth: "max-content", color: r.fg }}>{r.name}</span>
                  {r.note && <span style={{ fontSize: 9, flex: "none", minWidth: "max-content", padding: "2px 5px", borderRadius: 4, background: r.noteBg, color: r.noteFg }}>{r.note}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 11, flex: "none", color: r.metaFg }}>{r.meta}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {vm.showTimer && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 28, bottom: 66, display: "flex", alignItems: "center", gap: 16, animation: "sFade .3s ease-out" }}>
          <div style={{ position: "relative", width: 54, height: 54, flex: "none" }}>
            {vm.ringBars.map((d, i) => (
              <span key={i} style={{ position: "absolute", left: 26, top: 2, width: 2, height: d.h, borderRadius: 1, transformOrigin: "1px 25px", transform: `rotate(${d.a})`, background: d.c, transition: "background-color .6s cubic-bezier(.4,0,.2,1),height .6s cubic-bezier(.4,0,.2,1)" }} />
            ))}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: vm.curTint }} />
              <span style={{ fontSize: 10, flex: "none", minWidth: "max-content", color: vm.mid }}>{vm.curName}</span>
            </div>
            <div style={{ fontFamily: D, fontSize: 70, lineHeight: 0.88, letterSpacing: -1, color: vm.heroFg, transition: "color .5s cubic-bezier(.4,0,.2,1)" }}>{vm.hero}</div>
            <div style={{ fontSize: 8, letterSpacing: ".22em", color: vm.heroFg, transition: "color .5s cubic-bezier(.4,0,.2,1)" }}>{vm.heroLabel}</div>
          </div>
        </div>
      )}

      {vm.showCount && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 9, letterSpacing: ".22em", color: vm.mid }}>{vm.curName}</span>
          <span key={vm.countN} style={{ fontFamily: D, fontSize: 120, lineHeight: 1, color: vm.accent, animation: "sCount .95s ease-out" }}>{vm.countN}</span>
        </div>
      )}

      {vm.showClaim && (
        <>
          <div style={{ position: "absolute", left: 22, right: 22, top: 36, height: 104, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
            <Ms style={{ fontSize: 32, color: "#0b0b0d" }}>task_alt</Ms>
            <span style={{ fontFamily: D, fontSize: 30, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#0b0b0d" }}>{vm.curName}</span>
            <span style={{ fontSize: 9, letterSpacing: ".18em", color: "#0b0b0d99" }}>{vm.claimSub}</span>
          </div>
          <div style={{ position: "absolute", right: 35 + (tabW - 69.25) / 2, width: 55, bottom: 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            {vm.chevrons.map((c, i) => (
              <span key={i} style={{ width: 14, height: 14, borderRight: "3px solid #0b0b0d", borderBottom: "3px solid #0b0b0d", transform: "rotate(45deg)", animation: "sChev 1.5s ease-in-out infinite", animationDelay: c.d }} />
            ))}
          </div>
        </>
      )}

      {vm.showAward && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <span style={{ fontFamily: D, fontSize: 80, lineHeight: 1, color: "#0b0b0d", animation: "sRise .52s cubic-bezier(.22,1,.28,1)" }}>{vm.awardPts}</span>
          <span style={{ fontSize: 8, letterSpacing: ".26em", color: "#0b0b0d99", animation: "sFade .5s ease-out .2s both" }}>{vm.awardNote}</span>
        </div>
      )}

      {vm.showScan && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 28, bottom: 66, display: "flex", alignItems: "center", gap: 16, animation: "sFade .3s ease-out" }}>
          <div style={{ position: "relative", width: 52, height: 52, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${vm.accent}`, animation: "sHalo 2.1s ease-out infinite" }} />
            <Ms style={{ fontSize: 28, color: vm.accent }}>radio_button_checked</Ms>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <span style={{ display: "block", width: "100%", fontFamily: D, fontSize: 22, lineHeight: 1.05, whiteSpace: "nowrap", color: vm.fg }}>{vm.scanLine}</span>
            <span style={{ display: "block", width: "100%", fontSize: 9, letterSpacing: ".06em", whiteSpace: "nowrap", color: vm.dim }}>{vm.scanSub}</span>
          </div>
        </div>
      )}

      {vm.showBag && (
        <>
          {vm.bagRail && (
            <div style={{ position: "absolute", right: 5, top: 28, bottom: 46, width: 3, borderRadius: 2, background: "#16161c" }}>
              <span style={{ display: "block", width: 3, borderRadius: 2, background: vm.accent, height: vm.bagRailH, transform: `translateY(${vm.bagRailY})`, transition: "transform .45s cubic-bezier(.22,1,.28,1)" }} />
            </div>
          )}
          <div style={{ position: "absolute", left: 12, right: 14, top: 26, bottom: 44, overflow: "hidden", animation: "sUp .28s ease-out" }}>
            <div className="rowsSlide" style={{ display: "flex", flexDirection: "column", gap: 3, transform: `translateY(${vm.bagY}px)` }}>
              {vm.bagRows.map((b) => (
                <div key={b.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, height: vm.bagRowH, flex: "none", padding: "0 9px", borderRadius: b.radius, overflow: "hidden", background: b.bg, transition: "background-color .45s cubic-bezier(.22,1,.28,1)" }}>
                  <span style={{ width: 4, height: 17, borderRadius: 2, flex: "none", background: b.tint }} />
                  <span style={{ position: "relative", width: 16, height: 16, flex: "none", borderRadius: "50%", border: `2px solid ${b.ring}`, background: b.fill, display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color .4s cubic-bezier(.4,0,.2,1),background-color .4s cubic-bezier(.4,0,.2,1)" }}>
                    {b.ticked && <Ms style={{ fontSize: 12, color: "#0b0b0d", animation: "sTick .4s cubic-bezier(.22,1,.28,1)" }}>check</Ms>}
                  </span>
                  <span style={{ fontSize: 11, flex: "none", minWidth: "max-content", color: b.fg, textDecoration: b.strike }}>{b.name}</span>
                  {b.note && <span style={{ fontSize: 9, flex: "none", minWidth: "max-content", padding: "2px 7px", borderRadius: 8, background: b.noteBg, color: b.noteFg }}>{b.note}</span>}
                  <span style={{ flex: 1 }} />
                  {b.stateIcon && <Ms style={{ fontSize: 13, flex: "none", color: b.stateFg }}>{b.stateIcon}</Ms>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {vm.showReward && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 28, bottom: 38, display: "flex", alignItems: "center", gap: 14, padding: "0 16px 0 10px", animation: "sFade .32s ease-out" }}>
          <div style={{ position: "relative", width: 148, height: 148, flex: "none", transform: "scale(.94)" }}>
            {vm.rwRing.map((d, i) => (
              <span key={i} style={{ position: "absolute", left: d.x, top: d.y, width: d.sz, height: d.sz, borderRadius: "50%", background: d.c, animation: `sPop .4s cubic-bezier(.22,1,.28,1) both ${d.d},${d.anim}`, transition: "background-color .5s ease" }} />
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontFamily: D, fontSize: 46, lineHeight: 0.85, color: vm.accent }}>{vm.rwNow}</span>
              <span style={{ fontSize: 11, color: vm.mid }}>{vm.rwOf}</span>
            </div>
            <span style={{ fontFamily: D, fontSize: 26, lineHeight: 1, color: vm.fg, textWrap: "pretty" }}>{vm.rwName}</span>
            <span style={{ alignSelf: "flex-start", fontSize: 10, letterSpacing: ".1em", padding: "4px 9px", borderRadius: 8, background: vm.accent, color: "#0b0b0d" }}>{vm.rwLeft}</span>
          </div>
        </div>
      )}

      {vm.showUnlock && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 22, top: 30, right: 22, bottom: 52, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 8, letterSpacing: ".34em", color: "#0b0b0dad" }}>{vm.unlockSub}</span>
              <span style={{ fontFamily: D, fontSize: 38, lineHeight: 1, color: "#0b0b0d", textWrap: "pretty", animation: "sWordIn .56s cubic-bezier(.22,1,.28,1) .18s both" }}>{vm.unlockName}</span>
            </div>
            <div style={{ width: 76, height: 76, flex: "none", borderRadius: 22, background: "#0b0b0d", display: "flex", alignItems: "center", justifyContent: "center", transform: "rotate(-6deg)", animation: "sStamp .6s cubic-bezier(.2,1.1,.3,1) both" }}>
              <Ms style={{ fontSize: 40, color: vm.accent }}>{vm.unlockIcon}</Ms>
            </div>
          </div>
        </div>
      )}

      {vm.showNext && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", width: 126, height: 126, borderRadius: "50%", background: "#15151b" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Ms style={{ fontSize: 19, color: vm.mid }}>{vm.nextIcon}</Ms>
            <span style={{ fontFamily: D, fontSize: 29, lineHeight: 1.04, textAlign: "center", color: vm.fg, textWrap: "pretty", animation: "sSeep 1s cubic-bezier(.3,0,.2,1) .35s both" }}>{vm.nextName}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 11px", borderRadius: 11, background: vm.accent }}>
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 14, lineHeight: 1, color: "#0b0b0d" }}>{vm.nextGoal}</span>
            </div>
          </div>
        </div>
      )}

      {vm.showAgent && (
        <div style={{ position: "absolute", left: 12, right: 12, top: 26, bottom: 44, display: "flex", gap: 13, animation: "sFade .28s ease-out" }}>
          <div style={{ width: 56, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <div style={{ position: "relative", width: 46, height: 46, animation: "sSpin 1.25s linear infinite" }}>
              <svg viewBox="0 0 46 46" style={{ display: "block", width: 46, height: 46 }}>
                <circle cx="23" cy="23" r="19" fill="none" stroke="#1d1d24" strokeWidth="5" />
                <circle cx="23" cy="23" r="19" fill="none" stroke={vm.accent} strokeWidth="5" strokeLinecap="round" strokeDasharray="34 86" />
              </svg>
            </div>
            <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 12, color: vm.accent }}>{vm.agentElapsed}</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: D, fontSize: 20, lineHeight: 1.1, color: vm.fg, textWrap: "pretty" }}>{vm.agentTask}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {vm.agentSteps.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Ms style={{ fontSize: 13, flex: "none", color: a.iconFg }}>{a.icon}</Ms>
                  <span style={{ fontSize: 10, flex: "none", minWidth: "max-content", color: a.fg }}>{a.text}</span>
                  <span style={{ flex: 1, height: 3, borderRadius: 2, background: a.ruleC }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {vm.showAgent2 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 38, bottom: 44, padding: "0 12px", display: "flex", flexDirection: "column", gap: 7, animation: "sFade .3s ease-out" }}>
          <div style={{ flex: 1, minHeight: 0, borderRadius: 15, overflow: "hidden", background: vm.accent, padding: "10px 13px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
              <Ms style={{ fontSize: 18, flex: "none", color: "#0b0b0d" }}>{vm.jobIcon}</Ms>
              <span style={{ fontFamily: D, fontSize: 20, lineHeight: 1.06, flex: 1, minWidth: 0, color: "#0b0b0d", textWrap: "pretty" }}>{vm.jobNow}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, height: 5, borderRadius: 3, overflow: "hidden", background: "#0b0b0d26" }}>
                <span style={{ display: "block", height: 5, borderRadius: 3, background: "#0b0b0d", width: vm.jobPct, transition: "width .9s cubic-bezier(.4,0,.2,1)" }} />
              </span>
              <span style={{ fontSize: 8, letterSpacing: ".16em", flex: "none", color: "#0b0b0d99" }}>{vm.jobStep}</span>
            </div>
          </div>
          <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {vm.jobQueue.map((q, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Ms style={{ fontSize: 13, flex: "none", color: q.iconFg }}>{q.icon}</Ms>
                <span style={{ fontSize: 10, flex: "none", minWidth: "max-content", color: q.fg }}>{q.name}</span>
                <span style={{ flex: 1, height: 3, borderRadius: 2, background: q.ruleC }} />
                <span style={{ fontSize: 8, letterSpacing: ".14em", flex: "none", color: q.metaFg }}>{q.meta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vm.showAbout && (
        <div style={{ position: "absolute", left: 12, right: 12, top: 28, bottom: 54, display: "flex", flexDirection: "column", gap: 6, animation: "sUp .3s ease-out" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: D, fontSize: 22, lineHeight: 0.9, color: vm.fg }}>nudge</span>
            <span style={{ fontSize: 9, letterSpacing: ".16em", color: vm.dim }}>PETERZSTUDIO</span>
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "1fr", columnGap: 12, rowGap: 3, minHeight: 0 }}>
            {vm.aboutRows.map((r) => (
              <div key={r.k} style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, borderTop: "1px solid #1c1c23", paddingTop: 2 }}>
                <span style={{ fontSize: 7, letterSpacing: ".14em", color: vm.dim }}>{r.k}</span>
                <span style={{ fontFamily: DOTO, fontWeight: 700, fontSize: 10, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: vm.fg }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vm.showPair && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 18, bottom: 44, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, animation: "sUp .3s ease-out" }}>
          <span style={{ fontSize: 8, letterSpacing: ".24em", color: vm.dim }}>PAIR A PHONE OR COMPUTER</span>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 52, lineHeight: 1, letterSpacing: 2, color: vm.accent }}>{vm.pairCode}</span>
          <span style={{ fontSize: 9, letterSpacing: ".1em", color: vm.mid }}>{vm.pairSub}</span>
          <span style={{ fontSize: 9, color: vm.dim }}>{vm.pairUrl}</span>
        </div>
      )}

      {vm.showBright && (
        <div style={{ position: "absolute", left: 14, right: 14, top: 30, bottom: 54, display: "flex", alignItems: "flex-end", gap: 7, animation: "sUp .3s ease-out" }}>
          {vm.brightBars.map((b, i) => (
            <div key={i} style={{ flex: 1, height: b.h, borderRadius: 8, background: b.c, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 7, transition: "height .42s cubic-bezier(.22,1,.28,1),background-color .35s ease" }}>
              <Ms style={{ fontSize: 15, color: b.icoC, transition: "color .35s" }}>{b.ico}</Ms>
            </div>
          ))}
        </div>
      )}

      {vm.showDisco && (
        <div style={{ position: "absolute", inset: 0, background: "#000", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 110, paddingBottom: 6 }}>
            {[
              { w: 40, h: 40, r: "50%", c: "#ff4d17" },
              { w: 34, h: 52, r: "10px", c: "#f4f3ef" },
              { w: 44, h: 30, r: "15px", c: "#ff4d17" },
              { w: 38, h: 38, r: "50% 50% 10px 10px", c: "#f4f3ef" },
              { w: 30, h: 46, r: "15px", c: "#ff4d17" },
            ].map((b, i) => (
              <span key={i} style={{ width: b.w, height: b.h, flex: "none", borderRadius: b.r, background: b.c, transformOrigin: "50% 100%", animation: `sBob ${vm.discoBeatS} cubic-bezier(.45,0,.55,1) infinite`, animationDelay: `calc(${vm.discoBeatS} * -${(i * 0.2).toFixed(1)})` }} />
            ))}
          </div>
        </div>
      )}

      {vm.showUpdate && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <span style={{ fontFamily: D, fontSize: 23, lineHeight: 1, color: vm.fg }}>{vm.updLine}</span>
          <div style={{ width: 172, height: 12, borderRadius: 6, overflow: "hidden", background: "#1c1c23" }}>
            <div style={{ height: 12, borderRadius: 6, background: vm.accent, width: vm.updPct, transition: "width .9s linear" }} />
          </div>
          <span style={{ fontSize: 8, letterSpacing: ".2em", whiteSpace: "nowrap", color: vm.dim }}>{vm.updSub}</span>
        </div>
      )}

      {vm.showDark && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", alignItems: "flex-end", justifyContent: "flex-start", padding: "0 0 9px 11px" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#2a2a31" }} />
        </div>
      )}

      {vm.showPeek && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, animation: "sPeek 6s cubic-bezier(.4,0,.2,1) both" }}>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 78, lineHeight: 1, letterSpacing: 2, color: "#f4f3ef" }}>{vm.peekClock}</span>
          <span style={{ fontSize: 11, letterSpacing: ".24em", color: "#9a9aa3" }}>{vm.peekDate}</span>
        </div>
      )}

      {vm.showSleep && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, animation: "sFade .6s ease-out,sOff 3s cubic-bezier(.4,0,.2,1) 25s forwards" }}>
          <Ms style={{ fontSize: 22, color: "#6d6d77" }}>bedtime</Ms>
          <span style={{ fontFamily: D, fontSize: 30, lineHeight: 1, color: "#8e8e97" }}>{vm.sleepLine}</span>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15, color: "#2c2c34" }}>{vm.clock}</span>
        </div>
      )}

      {vm.showDoze && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", width: 44, height: 44, animation: "sFade 1.2s ease-out,sOff 2.4s cubic-bezier(.4,0,.2,1) 40s forwards" }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg,transparent 0deg,#ff4d1700 150deg,#ff4d17 360deg)", WebkitMask: "radial-gradient(circle,transparent 18.5px,#000 19px)", mask: "radial-gradient(circle,transparent 18.5px,#000 19px)", animation: "sSpinSoft 7s linear infinite" }} />
            <span style={{ position: "absolute", inset: 0, animation: "sSpinSoft 7s linear infinite" }}>
              <span style={{ position: "absolute", left: "50%", top: -1, width: 5, height: 5, marginLeft: -2.5, borderRadius: "50%", background: "#f4f3ef" }} />
            </span>
          </div>
        </div>
      )}

      {vm.showResume && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 28, bottom: 38, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 9, animation: "sUp .3s ease-out" }}>
          <span style={{ fontSize: 8, letterSpacing: ".24em", color: vm.dim }}>{vm.rsTag}</span>
          <span style={{ fontFamily: D, fontSize: 29, lineHeight: 1.04, color: vm.fg, textWrap: "pretty" }}>{vm.rsName}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ flex: 1, height: 7, borderRadius: 4, overflow: "hidden", background: "#1b1b22" }}>
              <span style={{ display: "block", height: 7, borderRadius: 4, background: vm.accent, width: vm.rsPct, transition: "width .7s cubic-bezier(.22,1,.28,1)" }} />
            </span>
            <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15, flex: "none", color: vm.accent }}>{vm.rsLeft}</span>
          </div>
        </div>
      )}

      {vm.showOffline && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 28, bottom: 38, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, animation: "sFade .3s ease-out" }}>
          <Ms style={{ fontSize: 26, color: vm.mid }}>cloud_off</Ms>
          <span style={{ fontFamily: D, fontSize: 24, lineHeight: 1, color: vm.fg }}>{vm.offLine}</span>
          <span style={{ fontSize: 9, letterSpacing: ".02em", color: vm.dim }}>{vm.offSub}</span>
        </div>
      )}

      {vm.showBoot && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", height: 62, display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", animation: "sBootOut .5s ease-in 1.85s both" }}>
              {vm.bootLetters.map((l, i) => (
                <span key={i} style={{ fontFamily: D, fontSize: 62, lineHeight: 1, letterSpacing: -2, color: "#ff4d17", animation: l.anim }}>{l.ch}</span>
              ))}
            </div>
            <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: D, fontSize: 62, lineHeight: 1, letterSpacing: -2, backgroundImage: "linear-gradient(90deg,#ff4d17 50%,#f4f3ef 50%)", backgroundSize: "200% 100%", backgroundRepeat: "no-repeat", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "sBootIn .01s linear 1.85s both,sWipe 2.6s cubic-bezier(.4,0,.2,1) 2s both" }}>nudge</span>
          </div>
          <span style={{ fontSize: 8, letterSpacing: ".4em", color: "#4a4a54", animation: "sFade 1s ease-out 4.9s both" }}>peterzstudio</span>
        </div>
      )}

      {vm.showAlarmRing && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, borderRadius: radius, borderStyle: "solid", borderColor: "#ff4d17", pointerEvents: "none", animation: "sAlarmRing 1.5s cubic-bezier(.42,0,.58,1) infinite" }} />
      )}

      {slab && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 60, display: "flex", justifyContent: "center", pointerEvents: "none", animation: vm.slabAnim, transformOrigin: "50% 0", paddingTop: 1, marginTop: -1 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", maxWidth: Math.min(W - 24, 360) }}>
            <span style={{ width: 15, height: 16, flex: "none", marginRight: -1, background: "#f4f3ef", mask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 0 100%,transparent 14.6px,#000 15px)" }} />
            <div style={{ flex: 1, minWidth: 0, padding: slab.ask ? "14px 18px 16px" : "12px 16px 14px", borderRadius: slab.ask ? "0 0 24px 24px" : "0 0 20px 20px", background: "#f4f3ef", color: "#111114", overflow: "hidden", boxShadow: "0 12px 28px #000000a6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {slab.wave ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 2, flex: "none", height: 16 }}>
                    {[0, 0.12, 0.24, 0.36, 0.48].map((d) => (
                      <span key={d} style={{ width: 3, height: 16, borderRadius: 2, background: "#ff4d17", animation: "sEq 1s ease-in-out infinite", animationDelay: d + "s" }} />
                    ))}
                  </div>
                ) : slab.spin ? (
                  <span style={{ width: 15, height: 15, flex: "none", borderRadius: "50%", border: "3px solid #dcd8d0", borderTopColor: "#ff4d17", animation: "sSpin 1s linear infinite" }} />
                ) : (
                  <Ms style={{ fontSize: slab.ask ? 22 : 17, flex: "none", color: vm.mode === "sleep" || slab.mono ? "#6d6d77" : "#ff4d17" }}>{slab.icon}</Ms>
                )}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: slab.ask ? 12 : 10, lineHeight: 1.25, color: "#111114" }}>{slab.line}</span>
                  {slab.sub && <span style={{ fontSize: 9, letterSpacing: ".12em", color: "#6f6f78" }}>{slab.sub}</span>}
                </div>
                {slab.tail && <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 15, flex: "none", color: "#ff4d17" }}>{slab.tail}</span>}
              </div>
              {slab.ask && slab.rows && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 9, paddingTop: 8, borderTop: "1px solid #dcd8d0" }}>
                  {slab.rows.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontSize: 8, letterSpacing: ".16em", width: 38, flex: "none", color: "#9a9aa2" }}>{r.k}</span>
                      <span style={{ fontSize: 11, flex: 1, minWidth: 0, color: "#111114" }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span style={{ width: 15, height: 16, flex: "none", marginLeft: -1, background: "#f4f3ef", mask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)", WebkitMask: "radial-gradient(circle at 100% 100%,transparent 14.6px,#000 15px)" }} />
          </div>
        </div>
      )}

      {vm.showBreatheIn && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, animation: "sFade .3s ease-out" }}>
          <span key={vm.bInLine} style={{ fontFamily: D, fontSize: 64, lineHeight: 1, color: vm.accent, animation: "sCountIn 1s cubic-bezier(.22,1,.28,1) both" }}>{vm.bInLine}</span>
          <span style={{ fontSize: 9, letterSpacing: ".2em", color: vm.dim }}>{vm.bInSub}</span>
        </div>
      )}

      {vm.showBreathe && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "24px 0 0" }}>
          <div style={{ position: "relative", width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", width: 150, height: 150, border: `4px solid ${vm.accent}`, background: vm.breatheFill, willChange: "transform,border-radius", backfaceVisibility: "hidden", transform: "translateZ(0)", animation: "sBreath 16s linear infinite" }} />
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <span style={{ fontFamily: D, fontSize: 19, lineHeight: 1, whiteSpace: "nowrap", color: vm.fg }}>{vm.breatheWord}</span>
              <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 30, lineHeight: 1, color: vm.accent }}>{vm.bCount}</span>
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 16, display: "flex", justifyContent: "center", gap: 5 }}>
            {vm.bCycles.map((c, i) => (
              <span key={i} style={{ width: c.w, height: 5, borderRadius: 3, background: c.c, transition: "width .5s cubic-bezier(.4,0,.2,1),background-color .5s cubic-bezier(.4,0,.2,1)" }} />
            ))}
          </div>
        </div>
      )}

      {vm.showBreatheEnd && (
        <div style={{ position: "absolute", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <span style={{ fontFamily: D, fontSize: 30, lineHeight: 1, color: vm.fg }}>{vm.bEndLine}</span>
          <span style={{ fontFamily: DOTO, fontWeight: 900, fontSize: 62, lineHeight: 1, color: vm.accent, animation: "sCount .9s ease-out" }}>{vm.bEndN}</span>
        </div>
      )}

      {vm.fxOn && <canvas ref={fx} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, width: W, height: H, pointerEvents: "none", zIndex: 40 }} />}

      {vm.showBar && (
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 44, height: 12, display: "flex", gap: 3 }}>
          {vm.phases.map((p, i) => (
            <div key={i} style={{ flex: p.flex, borderRadius: p.radius, overflow: "hidden", background: p.track }}>
              <div style={{ height: 12, width: p.pct, background: p.fill, transition: "width 1s linear" }} />
            </div>
          ))}
        </div>
      )}

      {vm.showTabs && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 32 }}>
          {vm.tabs.map((k, i) => (
            <div
              key={i}
              data-tab=""
              onPointerDown={onKeyDown ? (e) => { e.preventDefault(); onKeyDown(i); } : undefined}
              onPointerUp={onKeyUp}
              onPointerLeave={onKeyUp}
              onPointerCancel={onKeyUp}
              style={{
                position: "absolute", left: 11 + i * (tabW + 9), bottom: -8, width: tabW, height: 40, borderRadius: k.r, background: k.bg, boxShadow: k.ring,
                display: "flex", justifyContent: "center", paddingTop: 6, animation: "sTab .3s cubic-bezier(.22,1,.28,1)", touchAction: "none",
                transition: "background-color .5s cubic-bezier(.4,0,.2,1),border-radius .5s cubic-bezier(.4,0,.2,1)",
              }}
            >
              <span style={{ fontFamily: vm.kFont, fontSize: vm.kSize, letterSpacing: ".1em", lineHeight: 1, color: k.fg, transition: "color .4s cubic-bezier(.4,0,.2,1)" }}>{k.l}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
