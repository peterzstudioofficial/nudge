import "@nudge/shared/tokens.css";
import "./ui/screen.css";
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Screen } from "./ui/Screen";
import { useDevice, useFit } from "./device/useDevice";
import { attachKeyboard, attachTouch } from "./input";

/** The wall itself: full screen in the kiosk browser, scaled to the panel. */
function Wall() {
  const fit = useFit();
  const { d, vm } = useDevice({ w: fit.w, h: fit.h });
  const ref = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(fit.scale);
  scaleRef.current = fit.scale;

  useEffect(() => attachKeyboard(d), [d]);
  useEffect(() => (ref.current ? attachTouch(ref.current, d, () => scaleRef.current) : undefined), [d]);

  // Software brightness for HDMI panels (no backlight control): a black veil.
  const veil = [0.6, 0.35, 0.12, 0.04, 0][d.s.bright] ?? 0;

  return (
    <div ref={ref} style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000", touchAction: "none" }}>
      <div style={{ width: fit.w, height: fit.h, transform: `scale(${fit.scale})`, transformOrigin: "0 0" }}>
        <Screen vm={vm} onKeyDown={d.keyDown} onKeyUp={d.keyUp} />
      </div>
      <div style={{ position: "fixed", inset: 0, background: "#000", opacity: veil, pointerEvents: "none", transition: "opacity .4s" }} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Wall />
  </StrictMode>,
);
