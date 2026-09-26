import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const hub = process.env.NUDGE_HUB || "http://127.0.0.1:8787";

// Served by the hub at /app/ (PWA) and bundled into the Android and Windows shells.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2020",
    rollupOptions: { input: { index: "index.html", parent: "parent.html", notes: "notes.html", admin: "admin.html" } },
  },
  server: {
    port: 5174,
    proxy: { "/api": { target: hub, ws: true } },
  },
});
