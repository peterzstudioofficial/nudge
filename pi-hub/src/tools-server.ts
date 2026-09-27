import fs from "node:fs";
import zlib from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { isLoopback, isPrivateLan, isTailscale } from "./auth";
import type { Ctx } from "./context";

/**
 * Serves the tools the assistant built, on their own port — so their own origin. A tool is
 * AI-written code, so it's kept away from the Nudge apps: it can't read their storage or pairing
 * keys, can't call the hub's API with them, and can't reach the internet (connect-src 'self').
 *
 * Each tool gets a web-app manifest, an icon and a small service worker, so it works offline and
 * Android's Chrome offers to install it as an app (one tap; Android never allows a silent install).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

/** What goes into every tool's <head>: manifest, icon, offline worker and an install button. */
export function injectHead(html: string): string {
  const head = `<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><meta name="theme-color" content="#0a0a0c">
<script>/* added by Nudge */(function(){if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(function(){});var d;addEventListener("beforeinstallprompt",function(e){e.preventDefault();d=e;var b=document.createElement("button");b.textContent="Install app";b.style.cssText="position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:10px 14px;border-radius:12px;border:0;background:#ff4d17;color:#0b0b0d;font:600 14px system-ui,sans-serif;box-shadow:0 4px 18px #0006";b.onclick=function(){b.remove();d.prompt()};(document.body||document.documentElement).appendChild(b)})})();</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `${head}\n${html}`;
}

/** A plain PNG icon: the Nudge orange with a dark rounded mark (no image library needed). */
const iconCache = new Map<number, Buffer>();
export function iconPng(size: number): Buffer {
  const hit = iconCache.get(size);
  if (hit) return hit;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const dx = Math.max(Math.abs(x + 0.5 - c) - r * 0.6, 0);
      const dy = Math.max(Math.abs(y + 0.5 - c) - r * 0.6, 0);
      const inner = Math.hypot(dx, dy) < r * 0.55;
      const [R, G, B] = inner ? [11, 11, 13] : [255, 77, 23];
      raw[o] = R;
      raw[o + 1] = G;
      raw[o + 2] = B;
      raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let k = n;
    for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
    return k >>> 0;
  });
  const crc = (b: Buffer) => {
    let x = 0xffffffff;
    for (const v of b) x = crcTable[(x ^ v) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c2 = Buffer.alloc(4);
    c2.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c2]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  iconCache.set(size, png);
  return png;
}

export async function buildToolsServer(ctx: Ctx): Promise<FastifyInstance> {
  const { cfg, hub } = ctx;
  const https = cfg.tlsCert && cfg.tlsKey && fs.existsSync(cfg.tlsCert) && fs.existsSync(cfg.tlsKey) ? { cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey) } : null;
  const app = Fastify({ logger: false, ...(https ? { https } : {}) }) as unknown as FastifyInstance;

  app.addHook("onRequest", async (req, reply) => {
    const ip = req.socket.remoteAddress || "";
    if (!(isLoopback(ip) || isTailscale(ip) || (cfg.allowLan && isPrivateLan(ip)) || cfg.dev)) {
      reply.code(403).send("not on the home network or tailnet");
      return reply;
    }
    reply.header("content-security-policy", CSP);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("permissions-policy", "camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
  });

  const tool = (id: string) => hub.tools.get(id);

  app.get("/", async (_req, reply) => reply.type("text/plain").send("Nudge tools"));
  app.get("/t/:id", async (req, reply) => reply.redirect(`/t/${(req.params as { id: string }).id}/`));
  app.get("/t/:id/manifest.webmanifest", async (req, reply) => {
    const t = tool((req.params as { id: string }).id);
    if (!t) return reply.code(404).send("no such tool");
    reply.type("application/manifest+json").header("cache-control", "no-cache");
    return {
      id: `./?tool=${t.id}`,
      name: t.title,
      short_name: t.title.slice(0, 12),
      description: t.description,
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#0a0a0c",
      theme_color: "#0a0a0c",
      icons: [192, 512].map((s) => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png", purpose: "any" })),
    };
  });
  app.get("/t/:id/icon-:size.png", async (req, reply) => {
    const { id, size } = req.params as { id: string; size: string };
    if (!tool(id) || !["192", "512"].includes(size)) return reply.code(404).send("no");
    return reply.type("image/png").header("cache-control", "max-age=86400").send(iconPng(Number(size)));
  });
  app.get("/t/:id/sw.js", async (req, reply) => {
    const t = tool((req.params as { id: string }).id);
    if (!t) return reply.code(404).send("no such tool");
    const cache = `nudge-tool-${t.id}-v${t.version}`;
    // Network first so updates arrive; the cached copy when offline.
    const js = `const C=${JSON.stringify(cache)};self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["./"])))});self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith(${JSON.stringify(`nudge-tool-${t.id}-`)})&&x!==C).map(x=>caches.delete(x))))));self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))});`;
    return reply.type("text/javascript").header("cache-control", "no-cache").header("service-worker-allowed", `/t/${t.id}/`).send(js);
  });
  app.get("/t/:id/*", async (req, reply) => {
    const { id } = req.params as { id: string; "*": string };
    const pth = (req.params as { "*": string })["*"] || "index.html";
    const t = tool(id);
    if (!t) return reply.code(404).send("no such tool");
    const f = hub.toolFile(id, pth);
    if (!f) return reply.code(404).send("not found");
    reply.header("cache-control", "no-cache");
    if (pth === "index.html") return reply.type("text/html; charset=utf-8").send(injectHead(new TextDecoder().decode(f.data)));
    return reply.type(f.mime).send(Buffer.from(f.data));
  });
  return app;
}
