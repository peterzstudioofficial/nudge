// Bundles the hub into one file for the Pi. playwright-core and pdfjs-dist stay external (they load their own files).
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/hub.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["playwright-core", "pdfjs-dist", "node:sqlite"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
