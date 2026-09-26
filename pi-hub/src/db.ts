import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/**
 * Storage. One SQLite file, documents stored as JSON with a couple of indexed columns.
 * The data set is small (a family's tasks and notes), so this keeps the code simple and the
 * Pi fast. WAL mode + synchronous=NORMAL survives power cuts without corrupting.
 */
export class Db {
  sql: DatabaseSync;

  constructor(dataDir: string | ":memory:") {
    this.sql = new DatabaseSync(dataDir === ":memory:" ? ":memory:" : path.join(dataDir, "nudge.sqlite"));
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS docs (
        kind TEXT NOT NULL,
        id   TEXT NOT NULL,
        day  TEXT,
        ts   INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS docs_day ON docs(kind, day);
      CREATE INDEX IF NOT EXISTS docs_ts  ON docs(kind, ts);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
    `);
  }

  tx<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.sql.exec("COMMIT");
      return r;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }

  kvGet<T>(key: string, fallback: T): T {
    const row = this.sql.prepare("SELECT data FROM kv WHERE key = ?").get(key) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : fallback;
  }
  kvSet(key: string, value: unknown): void {
    this.sql.prepare("INSERT INTO kv(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data").run(key, JSON.stringify(value));
  }
  kvDel(key: string): void {
    this.sql.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }

  blobPut(id: string, mime: string, data: Uint8Array): void {
    this.sql.prepare("INSERT INTO blobs(id, mime, data) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data").run(id, mime, data);
  }
  blobGet(id: string): { mime: string; data: Uint8Array } | null {
    const row = this.sql.prepare("SELECT mime, data FROM blobs WHERE id = ?").get(id) as { mime: string; data: Uint8Array } | undefined;
    return row ?? null;
  }
  blobDel(id: string): void {
    this.sql.prepare("DELETE FROM blobs WHERE id = ?").run(id);
  }

  collection<T extends { id: string }>(kind: string, dayOf?: (t: T) => string | null, tsOf?: (t: T) => number): Collection<T> {
    return new Collection<T>(this, kind, dayOf, tsOf);
  }

  close(): void {
    this.sql.close();
  }
}

export class Collection<T extends { id: string }> {
  constructor(
    private db: Db,
    readonly kind: string,
    private dayOf: (t: T) => string | null = () => null,
    private tsOf: (t: T) => number = () => Date.now(),
  ) {}

  get(id: string): T | null {
    const row = this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? AND id = ?").get(this.kind, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }
  all(): T[] {
    return this.rows(this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? ORDER BY ts").all(this.kind));
  }
  byDay(day: string): T[] {
    return this.rows(this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? AND day = ? ORDER BY ts").all(this.kind, day));
  }
  betweenDays(from: string, to: string): T[] {
    return this.rows(this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? AND day >= ? AND day <= ? ORDER BY day, ts").all(this.kind, from, to));
  }
  since(ts: number): T[] {
    return this.rows(this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? AND ts >= ? ORDER BY ts").all(this.kind, ts));
  }
  latest(limit: number): T[] {
    return this.rows(this.db.sql.prepare("SELECT data FROM docs WHERE kind = ? ORDER BY ts DESC LIMIT ?").all(this.kind, limit));
  }
  count(): number {
    return (this.db.sql.prepare("SELECT COUNT(*) AS n FROM docs WHERE kind = ?").get(this.kind) as { n: number }).n;
  }
  put(item: T): T {
    this.db.sql
      .prepare("INSERT INTO docs(kind, id, day, ts, data) VALUES(?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET day = excluded.day, ts = excluded.ts, data = excluded.data")
      .run(this.kind, item.id, this.dayOf(item), this.tsOf(item), JSON.stringify(item));
    return item;
  }
  patch(id: string, fn: (t: T) => T): T | null {
    const cur = this.get(id);
    if (!cur) return null;
    return this.put(fn(cur));
  }
  del(id: string): void {
    this.db.sql.prepare("DELETE FROM docs WHERE kind = ? AND id = ?").run(this.kind, id);
  }
  private rows(rows: unknown[]): T[] {
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data) as T);
  }
}
