// Bundles the hub into one file for the Pi. playwright-core, pdfjs-dist and the two native
// on-device AI runtimes (onnxruntime-node for search, sherpa-onnx-node for speech) stay external.
import fs from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  entryNames: "hub",
  outExtension: { ".js": ".mjs" },
  // Composio and Gemini go in their own chunks, only loaded when their keys are set.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["playwright-core", "pdfjs-dist", "node:sqlite", "onnxruntime-node", "sherpa-onnx-node"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

// The brand fonts tools can use (served from the tools origin under /brand/fonts/, see src/brand.ts).
const fonts = {
  "dm-mono-400.woff2": "@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2",
  "dm-mono-500.woff2": "@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2",
  "doto-700.woff2": "@fontsource/doto/files/doto-latin-700-normal.woff2",
  "doto-900.woff2": "@fontsource/doto/files/doto-latin-900-normal.woff2",
  "zcool-400.woff2": "@fontsource/zcool-qingke-huangyou/files/zcool-qingke-huangyou-latin-400-normal.woff2",
};
const require = createRequire(import.meta.url);
fs.mkdirSync("dist/brand", { recursive: true });
for (const [name, from] of Object.entries(fonts)) fs.copyFileSync(require.resolve(from), `dist/brand/${name}`);
