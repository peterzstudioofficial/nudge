import type { Device } from "./device/device";

/**
 * Keyboard + touch controls, for a Pi with a touchscreen and no physical keys yet,
 * a USB keypad, or testing on a computer.
 *
 *  keys 1-4        the four keys under the screen (hold 3 in the list to skip)
 *  ← →  / wheel    turn the dial
 *  enter / space   push the dial
 *  t               touch pad (assistant)
 *  touch           tap the tabs; swipe up/down to turn the dial; tap the middle to push it;
 *                  press and hold the middle for the assistant
 */
export function attachKeyboard(d: Device): () => void {
  const held = new Set<string>();
  const down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    const n = { "1": 0, "2": 1, "3": 2, "4": 3 }[e.key];
    if (n !== undefined) {
      if (held.has(e.key)) return;
      held.add(e.key);
      d.keyDown(n);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") d.turn(1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") d.turn(-1);
    else if (e.key === "Enter" || e.key === " ") d.pressDial();
    else if (e.key === "t" || e.key === "T") d.wake();
    else return;
    e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    if (held.delete(e.key)) d.keyUp();
  };
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 4) return;
    d.turn(e.deltaY > 0 ? 1 : -1);
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("wheel", wheel, { passive: true });
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("wheel", wheel);
  };
}

/** Gestures on the screen body (the tabs handle their own taps). */
export function attachTouch(el: HTMLElement, d: Device, scale: () => number): () => void {
  let start: { x: number; y: number; t: number; acc: number; moved: boolean } | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-tab]")) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now(), acc: 0, moved: false };
    holdTimer = setTimeout(() => {
      if (start && !start.moved) {
        start = null;
        d.wake();
      }
    }, 800);
  };
  const onMove = (e: PointerEvent) => {
    if (!start) return;
    const dy = (e.clientY - start.y) / scale();
    if (Math.abs(dy) > 8) start.moved = true;
    const steps = Math.trunc(dy / 22) - start.acc;
    if (steps !== 0) {
      for (let i = 0; i < Math.abs(steps); i++) d.turn(steps > 0 ? 1 : -1);
      start.acc += steps;
    }
  };
  const onUp = () => {
    if (holdTimer) clearTimeout(holdTimer);
    if (start && !start.moved && Date.now() - start.t < 400) d.pressDial();
    start = null;
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };
}
