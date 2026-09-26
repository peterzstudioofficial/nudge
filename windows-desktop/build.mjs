// Builds Nudge for Windows: the Electron main + preload (esbuild) and the windows (Vite).
import { build } from "esbuild";
import { build as vite } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";

const dev = process.argv.includes("--dev");

await build({
  entryPoints: { main: "src/main/main.ts" },
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: dev,
  logLevel: "info",
});
await build({
  entryPoints: { preload: "src/preload/preload.ts" },
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  logLevel: "info",
});

await vite({
  configFile: false,
  root: ".",
  base: "./",
  plugins: [react()],
  logLevel: "warn",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    target: "chrome130",
    rollupOptions: { input: { hud: "hud.html", agent: "agent.html", pair: "pair.html" } },
  },
});

// The browser blocker ships next to the app.
fs.mkdirSync("dist-extension", { recursive: true });
for (const f of fs.readdirSync("extension")) fs.copyFileSync(`extension/${f}`, `dist-extension/${f}`);
// Nudge's own fonts (Latin display + mono, and the icon subset) so the blocker matches the app offline.
const font = (from, to) => fs.copyFileSync(new URL(from, import.meta.url), `dist-extension/fonts/${to}`);
fs.mkdirSync("dist-extension/fonts", { recursive: true });
font("../node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2", "dm-mono-400.woff2");
font("../node_modules/@fontsource/zcool-qingke-huangyou/files/zcool-qingke-huangyou-latin-400-normal.woff2", "zcool-400.woff2");
font("../shared/src/fonts/icons.woff2", "icons.woff2");
console.log("built nudge desktop");
