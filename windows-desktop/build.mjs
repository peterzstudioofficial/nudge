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
console.log("built nudge desktop");
