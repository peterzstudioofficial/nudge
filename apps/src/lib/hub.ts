import { useEffect, useState, useSyncExternalStore } from "react";
import { HubClient, localKV, type Snapshot, type Role } from "@nudge/shared";
import { localMode, localNotesClient, setLocalMode, uploadLocalNotes } from "./localNotes";

/**
 * Connection to the Nudge hub for the phone / desktop apps.
 * Each app keeps its own pairing (the parent app pairs as a parent, the others as the owner),
 * stored in this device's localStorage. Nothing but the token is kept here.
 */

export type AppKey = "owner" | "parent";

interface Stored {
  hub: string;
  token: string;
  role: Role;
  name: string;
}

const clients = new Map<AppKey, HubClient>();

export function defaultHub(): string {
  // Served by the hub itself (PWA) → same origin. Inside the Android / desktop shell → ask.
  if (location.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(location.hostname) && location.port !== "5174") {
    return location.origin;
  }
  if (location.port === "5174") return location.origin; // vite dev server proxies /api
  return "";
}

export function loadPairing(app: AppKey): Stored | null {
  try {
    const raw = localStorage.getItem(`nudge-${app}:pairing`);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export function savePairing(app: AppKey, p: Stored | null) {
  if (p) localStorage.setItem(`nudge-${app}:pairing`, JSON.stringify(p));
  else localStorage.removeItem(`nudge-${app}:pairing`);
  clients.get(app)?.close();
  clients.delete(app);
}

export function getClient(app: AppKey): HubClient | null {
  const p = loadPairing(app);
  if (!p) return app === "owner" && localMode() ? localNotesClient() : null;
  let c = clients.get(app);
  if (!c) {
    c = new HubClient({ baseUrl: p.hub, token: p.token, kv: localKV(`nudge-${app}:`) });
    clients.set(app, c);
    c.connect();
    void c.snapshot().catch(() => {});
    const refresh = () => document.visibilityState === "visible" && c!.snapshot().catch(() => {});
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", () => void c!.flush().then(() => c!.snapshot()).catch(() => {}));
  }
  return c;
}

export async function pair(app: AppKey, hub: string, code: string, name: string): Promise<Stored> {
  const base = hub.replace(/\/$/, "");
  const res = await fetch(base + "/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; device?: { role: Role; name: string }; error?: string };
  if (!res.ok || !data.token || !data.device) throw new Error(data.error || "couldn't reach the hub");
  if (app === "parent" && data.device.role !== "parent") throw new Error("that code is for Peter's devices — make a parent code on the wall");
  const stored = { hub: base, token: data.token, role: data.device.role, name: data.device.name };
  savePairing(app, stored);
  // Notes kept on this phone before pairing move to the wall now.
  if (app === "owner") {
    setLocalMode(false);
    void uploadLocalNotes(base, data.token).catch(() => {});
  }
  return stored;
}

/** Live snapshot of the hub, cached for offline use. */
export function useSnapshot(client: HubClient | null): { snap: Snapshot | null; online: boolean } {
  const [online, setOnline] = useState(client?.online ?? false);
  const snap = useSyncExternalStore(
    (cb) => (client ? client.onSnapshot(cb) : () => {}),
    () => client?.last ?? null,
  );
  useEffect(() => (client ? client.onStatus(setOnline) : undefined), [client]);
  // tick so countdowns move
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return { snap, online };
}

/** Fetch a GET endpoint and re-fetch whenever the hub says something changed. */
export function useHubGet<T>(client: HubClient | null, path: string | null, deps: unknown[] = []): { data: T | null; reload: () => void } {
  // Last good answer is kept on the device, so screens open instantly and still work offline.
  const key = path ? `nudge-cache:${path}` : "";
  const [data, setData] = useState<T | null>(() => {
    try {
      return key ? (JSON.parse(localStorage.getItem(key) || "null") as T | null) : null;
    } catch {
      return null;
    }
  });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!client || !path) return;
    let alive = true;
    const got = (d: T) => {
      if (!alive) return;
      setData(d);
      try {
        const s = JSON.stringify(d);
        if (s.length < 400_000) localStorage.setItem(key, s);
      } catch {
        /* storage full: fine */
      }
    };
    client.get<T>(path).then(got).catch(() => {});
    const off = client.onMessage((m) => {
      if (m.type === "changed") client.get<T>(path).then(got).catch(() => {});
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, path, n, ...deps]);
  return { data, reload: () => setN((x) => x + 1) };
}
