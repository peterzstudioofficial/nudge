// Bundles the hub into one file for the Pi. playwright-core, pdfjs-dist and the two native
// on-device AI runtimes (onnxruntime-node for search, sherpa-onnx-node for speech) stay external.
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
