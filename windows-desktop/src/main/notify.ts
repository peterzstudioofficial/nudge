import { BrowserWindow, screen } from "electron";

/**
 * Nudge's notifications on the computer: a small frameless window that slides out of the
 * on-task window's edge (above it when it sits at the bottom of the screen, below it at the top).
 * It never takes focus, never steals keystrokes, and a new one replaces the old one.
 */
type Anchor = () => { x: number; y: number; width: number; height: number; visible: boolean; corner: "br" | "bl" | "tr" | "tl" } | null;

let win: BrowserWindow | null = null;
let anchor: Anchor = () => null;
let ready: Promise<void> | null = null;
let n = 0;
let make: (() => BrowserWindow) | null = null;
let onAction: (a: string) => void = () => {};

export function setupNotify(o: { create: () => BrowserWindow; anchor: Anchor; onAction: (a: string) => void }) {
  make = o.create;
  anchor = o.anchor;
  onAction = o.onAction;
}

export function toastAction(a: string) {
  onAction(a);
}

export function toastDone() {
  win?.hide();
}

const H = 96;

export async function notify(t: { icon: string; line: string; sub?: string; ms?: number; action?: string }): Promise<void> {
  if (!make) return;
  if (!win || win.isDestroyed()) {
    win = make();
    ready = new Promise((res) => win!.webContents.once("did-finish-load", () => res()));
    win.on("closed", () => (win = null));
  }
  await ready;
  const a = anchor();
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.round(Math.max(268, Math.min(420, a?.width ?? 300)));
  const corner = a?.corner ?? "br";
  const bottom = corner.startsWith("b");
  const gap = 10;
  let x: number, y: number;
  if (a && a.visible) {
    x = corner.endsWith("r") ? a.x + a.width - width : a.x;
    y = bottom ? a.y - H - gap : a.y + a.height + gap;
  } else {
    x = corner.endsWith("r") ? wa.x + wa.width - width - 16 : wa.x + 16;
    y = bottom ? wa.y + wa.height - H - 16 : wa.y + 16;
  }
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height: H });
  win.setAlwaysOnTop(true, "screen-saver");
  win.showInactive();
  win.webContents.send("toast", { id: ++n, icon: t.icon, line: t.line.slice(0, 140), sub: t.sub?.slice(0, 60), ms: t.ms ?? 4200, dir: bottom ? "up" : "down", action: t.action });
}
