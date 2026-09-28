import { native } from "./native";

/**
 * Light and dark for every app. Each app was designed in one theme; the other comes from the
 * generated palette (body.flip, see scripts/theme-palette.mjs). By default it follows the phone's
 * own setting; "light" or "dark" can be fixed in the app's settings (shared by all Nudge apps on
 * this device).
 */
export type ThemePref = "auto" | "light" | "dark";
const KEY = "nudge-theme";
let designed: "light" | "dark" = "dark";
const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setThemePref(p: ThemePref) {
  try {
    if (p === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private mode */
  }
  update();
}

export const currentTheme = (): "light" | "dark" => {
  const p = themePref();
  return p === "auto" ? (mq()?.matches ? "dark" : "light") : p;
};

function update() {
  const want = currentTheme();
  document.body.classList.add("themed");
  document.body.classList.toggle("flip", want !== designed);
  document.documentElement.style.colorScheme = want;
  const bg = getComputedStyle(document.body).backgroundColor;
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;
  // Android: status and navigation bar icons dark on light, light on dark.
  void native()?.setBars?.({ light: want === "light", color: bg }).catch(() => {});
  window.dispatchEvent(new Event("nudge-theme"));
}

export function applyTheme(d: "light" | "dark") {
  designed = d;
  update();
  mq()?.addEventListener?.("change", update);
  // Another Nudge app on this device changed it.
  window.addEventListener("storage", (e) => e.key === KEY && update());
}
