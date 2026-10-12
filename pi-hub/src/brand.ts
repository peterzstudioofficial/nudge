import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, FONT } from "@nudge/shared";

/**
 * The Nudge look, for tools the assistant builds: a small stylesheet, the three brand fonts and
 * (if Peter uploads one) his studio logo, all served from the tools origin under /brand/ so a
 * tool can use them offline. It's the default style, never a cage: if a request asks for a
 * different look, the request wins.
 */

/** Published name → where the font lives in node_modules (copied next to the bundle by build.mjs). */
export const BRAND_FONTS: Record<string, string> = {
  "dm-mono-400.woff2": "@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2",
  "dm-mono-500.woff2": "@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2",
  "doto-700.woff2": "@fontsource/doto/files/doto-latin-700-normal.woff2",
  "doto-900.woff2": "@fontsource/doto/files/doto-latin-900-normal.woff2",
  "zcool-400.woff2": "@fontsource/zcool-qingke-huangyou/files/zcool-qingke-huangyou-latin-400-normal.woff2",
};

const here = path.dirname(fileURLToPath(import.meta.url));
const fontCache = new Map<string, Buffer | null>();
export function brandFont(name: string): Buffer | null {
  if (!(name in BRAND_FONTS)) return null;
  if (fontCache.has(name)) return fontCache.get(name)!;
  let data: Buffer | null = null;
  for (const p of [path.join(here, "brand", name), path.join(here, "..", "dist", "brand", name)]) {
    if (fs.existsSync(p)) {
      data = fs.readFileSync(p);
      break;
    }
  }
  if (!data) {
    try {
      data = fs.readFileSync(createRequire(import.meta.url).resolve(BRAND_FONTS[name]));
    } catch {
      data = null;
    }
  }
  fontCache.set(name, data);
  return data;
}

const face = (family: string, file: string, weight: number) =>
  `@font-face{font-family:${family};src:url(/brand/fonts/${file}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;

/** /brand/nudge.css — tokens, fonts, a few components and the Nudge motion. Opt-in by linking it. */
export const BRAND_CSS = `/* Nudge style for tools. Every value is a variable: override any of them in your own CSS. */
${face('"DM Mono"', "dm-mono-400.woff2", 400)}
${face('"DM Mono"', "dm-mono-500.woff2", 500)}
${face("Doto", "doto-700.woff2", 700)}
${face("Doto", "doto-900.woff2", 900)}
${face('"ZCOOL QingKe HuangYou"', "zcool-400.woff2", 400)}
:root{
  --n-bg:${C.bg};--n-card:${C.panel};--n-raised:${C.panel3};--n-line:${C.faint};
  --n-fg:${C.paper};--n-mid:${C.mid};--n-dim:${C.dim};--n-faint:${C.dimmer};
  --n-accent:${C.accent};--n-accent-soft:${C.accentSoft};--n-on-accent:${C.ink};--n-ok:#6fcf97;--n-bad:#e5484d;
  --n-mono:${FONT.mono};--n-display:${FONT.display};--n-dots:${FONT.dots};
  --n-r:16px;--n-r-sm:12px;--n-gap:12px;
  --n-ease:cubic-bezier(.32,.72,0,1);--n-spring:cubic-bezier(.34,1.56,.64,1);--n-fast:.18s;--n-med:.32s;--n-slow:.5s;
  color-scheme:dark;
}
@media (prefers-color-scheme:light){:root:not(.n-dark){
  --n-bg:${C.paper};--n-card:#fff;--n-raised:${C.paperDim};--n-line:${C.paperLine};
  --n-fg:${C.ink};--n-mid:#3a3a40;--n-dim:#6b6b73;--n-faint:#9a9aa2;color-scheme:light;
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100dvh;background:var(--n-bg);color:var(--n-fg);font:400 14px/1.5 var(--n-mono);-webkit-font-smoothing:antialiased;overscroll-behavior:none}
button,input,textarea,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--n-accent);outline-offset:2px}
::selection{background:var(--n-accent);color:var(--n-on-accent)}
.n-app{max-width:560px;margin:0 auto;padding:max(18px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));display:flex;flex-direction:column;gap:var(--n-gap)}
.n-title{font:400 40px/0.95 var(--n-display);letter-spacing:.01em;margin:6px 0 2px}
.n-h{font:400 22px/1.1 var(--n-display);margin:0}
.n-label{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--n-dim)}
.n-dim{color:var(--n-dim)}
.n-num{font-family:var(--n-dots);font-weight:900;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.n-card{background:var(--n-card);border-radius:var(--n-r);padding:14px 16px}
.n-row{display:flex;align-items:center;gap:12px}
.n-btn{appearance:none;border:0;border-radius:var(--n-r-sm);min-height:44px;padding:0 16px;background:var(--n-raised);color:var(--n-fg);font-size:12px;letter-spacing:.06em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform var(--n-fast) var(--n-ease),background-color var(--n-med) var(--n-ease),opacity var(--n-med)}
.n-btn.primary{background:var(--n-accent);color:var(--n-on-accent)}
.n-btn.ghost{background:transparent;color:var(--n-dim)}
.n-btn:disabled{opacity:.4;cursor:default}
.n-btn:active:not(:disabled),.n-press:active{transform:scale(.96)}
.n-input{width:100%;min-height:44px;border:0;outline:0;border-radius:var(--n-r-sm);padding:10px 14px;background:var(--n-raised);color:var(--n-fg)}
.n-input::placeholder{color:var(--n-faint)}
.n-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--n-raised);font-size:11px;color:var(--n-mid);cursor:pointer;transition:background-color var(--n-med) var(--n-ease),color var(--n-med)}
.n-chip.on{background:var(--n-accent);color:var(--n-on-accent)}
.n-bar{height:6px;border-radius:3px;background:var(--n-raised);overflow:hidden}
.n-bar>i{display:block;height:100%;background:var(--n-accent);border-radius:inherit;transition:width var(--n-slow) var(--n-ease)}
.n-in{animation:n-in var(--n-slow) var(--n-ease) both}
.n-pop{animation:n-pop var(--n-slow) var(--n-spring) both}
.n-fade{animation:n-fade var(--n-med) ease both}
.n-stagger>*{animation:n-in var(--n-slow) var(--n-ease) both}
${Array.from({ length: 8 }, (_, i) => `.n-stagger>*:nth-child(${i + 2}){animation-delay:${(i + 1) * 40}ms}`).join("")}
@keyframes n-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes n-pop{0%{opacity:0;transform:scale(.86)}60%{opacity:1}100%{opacity:1;transform:scale(1)}}
@keyframes n-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}}
`;

/** What the builder is told about the look. `style` (from the request) always wins over the brand. */
export function brandGuide(o: { style: string | null; logo: { name: string } | null; forClaude?: boolean }): string {
  const link = o.forClaude
    ? `When it's served, /brand/nudge.css exists on the same server: link it with <link rel="stylesheet" href="/brand/nudge.css"> and also inline fallbacks for the colours below, so it still looks right opened as a local file.`
    : `Link the Nudge stylesheet: <link rel="stylesheet" href="/brand/nudge.css"> (same server, works offline). It gives the fonts and these classes, all optional: .n-app (page with safe-area padding), .n-title / .n-h (display headings), .n-label (tiny caps), .n-num (dotted digits for times and scores), .n-card, .n-row, .n-btn (+ .primary / .ghost), .n-input, .n-chip (+ .on), .n-bar > i (progress), .n-in / .n-pop / .n-fade / .n-stagger (entrance motion). Variables: --n-bg, --n-card, --n-raised, --n-line, --n-fg, --n-mid, --n-dim, --n-faint, --n-accent, --n-on-accent, --n-ok, --n-bad, --n-r, --n-ease. Override anything in your own <style>.`;
  const look = `Nudge style: near-black ${C.bg} with warm paper text ${C.paper} (the stylesheet flips to a paper background in light mode), one accent ${C.accent} used sparingly for the main action and what needs attention, DM Mono for text, ZCOOL QingKe HuangYou for big headings, Doto for numbers. Lowercase, calm, generous spacing, rounded cards, no gradients or emoji clutter. Motion: short and smooth (ease cubic-bezier(.32,.72,0,1), 180-500ms), things rise in gently, presses scale to .96; respect prefers-reduced-motion.`;
  const style = o.style?.trim()
    ? `The student asked for this look: "${o.style.trim()}". Follow it: it overrides the Nudge style wherever they differ (colours, fonts, theme, mood). Keep only the parts of the Nudge style they didn't ask to change, and still keep it accessible (contrast, touch targets).`
    : `If the brief itself asks for a particular look (colours, light theme, playful, a film's style...), that request overrides the Nudge style.`;
  const logo = o.logo
    ? `The maker's logo ("${o.logo.name}") is at /brand/logo. Use it only where it naturally belongs, e.g. small on a start or about screen; never force it in, never on every screen, never as a watermark, and leave it out if it doesn't fit. Give it alt text.`
    : "";
  return [link, look, style, logo].filter(Boolean).join("\n");
}

/* ---------------------------------- logo ---------------------------------- */

export const LOGO_MAX = 512 * 1024;

/** Checks an uploaded logo. SVGs must be plain drawings: no scripts, links out, or embedded pages. */
export function checkLogo(mime: string, data: Uint8Array): { mime: string; data: Uint8Array } {
  if (data.length > LOGO_MAX) throw new Error("that logo is too big (512 KB max)");
  if (data.length < 16) throw new Error("that file is empty");
  const b = Buffer.from(data);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", data };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", data };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", data };
  if (mime === "image/svg+xml" || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(b.toString("utf8", 0, 2048))) {
    const svg = b.toString("utf8");
    if (!/<svg[\s>]/i.test(svg)) throw new Error("that isn't an SVG");
    const bad: [RegExp, string][] = [
      [/<script/i, "scripts"],
      [/<foreignObject/i, "embedded web pages"],
      [/<!DOCTYPE|<!ENTITY/i, "a DOCTYPE"],
      [/\son[a-z]+\s*=/i, "event handlers"],
      [/javascript:/i, "javascript: links"],
      [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i, "links to other files"],
      [/url\(\s*["']?\s*(?!#|data:image\/)/i, "links to other files"],
      [/@import/i, "imports"],
    ];
    for (const [re, what] of bad) if (re.test(svg)) throw new Error(`that SVG has ${what} in it: export a plain SVG (or use a PNG)`);
    return { mime: "image/svg+xml", data };
  }
  throw new Error("use a PNG, JPEG, WebP or SVG");
}
