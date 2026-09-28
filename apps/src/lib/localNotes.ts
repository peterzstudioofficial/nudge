import type { HubClient, HubMessage, Note, Snapshot } from "@nudge/shared";

/**
 * Notes without the wall. When the notes app is used "on this phone only", it talks to this
 * instead of the hub: notes live in IndexedDB on the phone (recordings too), everything works
 * offline, and the moment the phone is paired with the wall they're uploaded and this store is
 * emptied. It answers the same few calls the notes app makes to the hub.
 */
const DB = "nudge-notes-local";
const FLAG = "nudge-notes:local";

export const localMode = (): boolean => {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
};
export const setLocalMode = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* private mode */
  }
};

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("notes", { keyPath: "id" });
      r.result.createObjectStore("audio");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: "notes" | "audio", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const localAudio = {
  get: (id: string) => tx<Blob | undefined>("audio", "readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>),
  put: (id: string, b: Blob) => tx("audio", "readwrite", (s) => s.put(b, id)),
};

type Listener<T> = (v: T) => void;

class LocalNotesClient {
  online = false;
  last: Snapshot | null = null;
  private msg = new Set<Listener<HubMessage>>();
  private changed() {
    for (const l of this.msg) l({ type: "changed", rev: Date.now(), topics: ["notes"] });
  }
  async get<T>(path: string): Promise<T> {
    if (path.startsWith("/api/notes")) {
      const all = await tx<Note[]>("notes", "readonly", (s) => s.getAll() as IDBRequest<Note[]>);
      return all.sort((a, b) => b.createdAt - a.createdAt) as T;
    }
    throw new Error("not available without the wall");
  }
  async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const m = /^\/api\/notes(?:\/([\w-]+))?(\/\w+)?$/.exec(path);
    if (!m) throw new Error("that needs the wall");
    const [, id, sub] = m;
    const now = Date.now();
    if (method === "POST" && !id) {
      const b = (body ?? {}) as Partial<Note>;
      const n: Note = { id: b.id ?? crypto.randomUUID(), kind: b.kind ?? "note", label: b.label ?? "note", body: b.body ?? "", tags: b.tags ?? [], secs: b.secs ?? 0, hasAudio: false, wall: false, createdAt: now, updatedAt: now } as Note;
      await tx("notes", "readwrite", (s) => s.put(n));
      this.changed();
      return n as T;
    }
    if (id && !sub && method === "PATCH") {
      const cur = await tx<Note | undefined>("notes", "readonly", (s) => s.get(id) as IDBRequest<Note | undefined>);
      if (!cur) throw new Error("no such note");
      const n = { ...cur, ...(body as object), updatedAt: now } as Note;
      await tx("notes", "readwrite", (s) => s.put(n));
      this.changed();
      return n as T;
    }
    if (id && !sub && method === "DELETE") {
      await tx("notes", "readwrite", (s) => s.delete(id));
      await tx("audio", "readwrite", (s) => s.delete(id));
      this.changed();
      return { ok: true } as T;
    }
    throw new Error("that needs the wall — pair it in settings");
  }
  async setAudio(id: string, blob: Blob, secs: number) {
    await localAudio.put(id, blob);
    const cur = await tx<Note | undefined>("notes", "readonly", (s) => s.get(id) as IDBRequest<Note | undefined>);
    if (cur) await tx("notes", "readwrite", (s) => s.put({ ...cur, hasAudio: true, secs }));
    this.changed();
  }
  async snapshot() {
    return null;
  }
  async flush() {}
  onSnapshot(_l: Listener<Snapshot>) {
    return () => {};
  }
  onStatus(_l: Listener<boolean>) {
    return () => {};
  }
  onMessage(l: Listener<HubMessage>) {
    this.msg.add(l);
    return () => void this.msg.delete(l);
  }
  connect() {}
  close() {}
}

let local: LocalNotesClient | null = null;
export const localNotesClient = (): HubClient => ((local ??= new LocalNotesClient()) as unknown as HubClient);
export const isLocalClient = (c: unknown): c is LocalNotesClient => c instanceof LocalNotesClient;

/** After pairing: move every phone-only note (and recording) to the wall, then empty the store. */
export async function uploadLocalNotes(hub: string, token: string): Promise<number> {
  const all = await tx<Note[]>("notes", "readonly", (s) => s.getAll() as IDBRequest<Note[]>).catch(() => [] as Note[]);
  let n = 0;
  for (const note of all) {
    const r = await fetch(`${hub}/api/notes`, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json", "idempotency-key": `local-${note.id}` },
      body: JSON.stringify({ id: note.id, kind: note.kind, label: note.label, body: note.body, tags: note.tags, secs: note.secs }),
    }).catch(() => null);
    if (!r?.ok) continue;
    const audio = await localAudio.get(note.id).catch(() => undefined);
    if (audio) {
      await fetch(`${hub}/api/notes/${note.id}/audio?secs=${note.secs}`, { method: "PUT", headers: { authorization: "Bearer " + token, "content-type": audio.type.split(";")[0] || "audio/webm" }, body: audio }).catch(() => null);
    }
    await tx("notes", "readwrite", (s) => s.delete(note.id));
    await tx("audio", "readwrite", (s) => s.delete(note.id)).catch(() => {});
    n++;
  }
  return n;
}
