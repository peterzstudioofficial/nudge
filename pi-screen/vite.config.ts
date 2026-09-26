import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.NUDGE_HUB || "http://127.0.0.1:8787";

// Served by the hub at /screen/ on the Pi. In dev, /api is proxied to a local hub.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2020",
    rollupOptions: { input: { index: "index.html", sim: "sim.html" } },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: hub, ws: true, changeOrigin: false } },
  },
});
