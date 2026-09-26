import type { HubMessage, Snapshot } from "./model";

/**
 * Tiny hub client used by the wall screen, the phone apps and the desktop app.
 *
 *  - Reads: one `snapshot()` call returns everything; the WebSocket says when to re-fetch.
 *  - Writes: `send()` goes straight to the hub when online. If the hub can't be reached the
 *    write is kept in an outbox (persisted) with an idempotency key and replayed later, so the
 *    hub applies each write exactly once even if a retry races a slow success.
 */

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

export const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: (k) => void m.delete(k) };
};

export const localKV = (prefix = "nudge:"): KV => {
  try {
    const ls = globalThis.localStorage;
    ls.setItem(prefix + "probe", "1");
    ls.removeItem(prefix + "probe");
    return {
      get: (k) => ls.getItem(prefix + k),
      set: (k, v) => ls.setItem(prefix + k, v),
      del: (k) => ls.removeItem(prefix + k),
    };
  } catch {
    return memoryKV();
  }
};

interface Queued {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  at: number;
}

export class HubError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

type Listener<T> = (v: T) => void;

export interface ClientOptions {
  baseUrl: string;
  token?: string | null;
  kv?: KV;
  /** WebSocket constructor (browser global by default) */
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
}

export function uid(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export class HubClient {
  baseUrl: string;
  token: string | null;
  private kv: KV;
  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private closed = false;
  private snapListeners = new Set<Listener<Snapshot>>();
  private msgListeners = new Set<Listener<HubMessage>>();
  private statusListeners = new Set<Listener<boolean>>();
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  online = false;
  last: Snapshot | null = null;
  private WS: typeof WebSocket | undefined;
  private F: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token ?? null;
    this.kv = opts.kv ?? localKV();
    this.WS = opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    this.F = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const cached = this.kv.get("snapshot");
    if (cached) {
      try {
        this.last = JSON.parse(cached);
      } catch {
        /* ignore corrupt cache */
      }
    }
  }

  get queued(): Queued[] {
    try {
      return JSON.parse(this.kv.get("outbox") || "[]");
    } catch {
      return [];
    }
  }
  private setQueue(q: Queued[]) {
    this.kv.set("outbox", JSON.stringify(q));
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h.authorization = "Bearer " + this.token;
    return h;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
    const headers = this.headers(body !== undefined ? { "content-type": "application/json" } : {});
    if (idem) headers["idempotency-key"] = idem;
    const res = await this.F(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
      const msg: string = err || res.statusText;
      throw new HubError(res.status, msg, data);
    }
    return data as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>("GET", path);
  }

  /**
   * A write. Online → sent now and the result returned. Offline → queued and `null` returned.
   * Validation errors (4xx) are thrown, never queued, so the UI can explain them.
   */
  async send<T = unknown>(method: string, path: string, body?: unknown, opts: { queue?: boolean } = {}): Promise<T | null> {
    const id = uid();
    try {
      const r = await this.request<T>(method, path, body, id);
      this.setOnline(true);
      return r;
    } catch (e) {
      if (e instanceof HubError) throw e;
      if (opts.queue === false) throw e;
      this.setQueue([...this.queued, { id, method, path, body, at: Date.now() }]);
      this.setOnline(false);
      return null;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let q = this.queued;
      while (q.length) {
        const op = q[0];
        try {
          await this.request(op.method, op.path, op.body, op.id);
        } catch (e) {
          if (!(e instanceof HubError)) break; // still offline, try later
          // the hub rejected it (e.g. rules changed meanwhile); drop it rather than retry forever
        }
        q = this.queued.filter((x) => x.id !== op.id);
        this.setQueue(q);
      }
    } finally {
      this.flushing = false;
    }
  }

  async snapshot(): Promise<Snapshot> {
    const s = await this.get<Snapshot>("/api/state");
    this.last = s;
    this.kv.set("snapshot", JSON.stringify(s));
    this.setOnline(true);
    for (const l of this.snapListeners) l(s);
    return s;
  }

  onSnapshot(l: Listener<Snapshot>) {
    this.snapListeners.add(l);
    return () => void this.snapListeners.delete(l);
  }
  onMessage(l: Listener<HubMessage>) {
    this.msgListeners.add(l);
    return () => void this.msgListeners.delete(l);
  }
  onStatus(l: Listener<boolean>) {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  }

  private setOnline(v: boolean) {
    if (this.online === v) return;
    this.online = v;
    for (const l of this.statusListeners) l(v);
    if (v) void this.flush();
  }

  private scheduleRefetch() {
    if (this.refetchTimer) return;
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      this.snapshot().catch(() => this.setOnline(false));
    }, 120);
  }

  /** Connect the live channel. Reconnects forever with back-off until `close()`. */
  connect(): void {
    this.closed = false;
    if (!this.WS) return;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/api/ws";
    let attempt = 0;
    const open = () => {
      if (this.closed) return;
      const ws = new this.WS!(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify({ type: "auth", token: this.token }));
      };
      ws.onmessage = (ev) => {
        let msg: HubMessage;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "hello" || msg.type === "changed") {
          this.setOnline(true);
          if (!this.last || msg.rev !== this.last.rev) this.scheduleRefetch();
        }
        for (const l of this.msgListeners) l(msg);
      };
      ws.onclose = () => {
        this.ws = null;
        this.setOnline(false);
        if (this.closed) return;
        attempt++;
        this.wsTimer = setTimeout(open, Math.min(15_000, 500 * 2 ** Math.min(attempt, 5)));
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      };
    };
    open();
  }

  /** Send a raw message over the live channel (hardware inputs, LED frames). */
  wsSend(msg: unknown): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    if (this.wsTimer) clearTimeout(this.wsTimer);
    this.ws?.close();
  }
}
