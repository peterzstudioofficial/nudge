import crypto from "node:crypto";
import { addDays, SUBJECT_NAMES, matchTeacher } from "@nudge/shared";
import type { Hub } from "../hub";
import { cosine, type Embedder } from "./embed";
import { memories } from "../agent/brain";
import { chunk, docPages, listDocs } from "./library";

/**
 * Private search over everything on the wall: notes and voice-note transcripts, school mail
 * and pages, the school calendar, tasks, weekly commitments, birthdays and teachers.
 *
 * It all stays on the Pi: keywords (BM25) always, plus on-device embeddings when the model is
 * installed, fused by rank. Only the few results the assistant asks for leave the Pi, inside
 * that one question.
 */
export interface Hit {
  id: string;
  kind: string;
  title: string;
  text: string;
  date: string | null;
  score: number;
  /** how sure the match is: cosine similarity (if embeddings are on) and share of the question's words found */
  cos: number;
  cover: number;
}

interface Doc {
  id: string;
  kind: string;
  title: string;
  text: string;
  date: string | null;
}

const tokenise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
const STOP = new Set("the a an and or of to in on at for is are was were be been it its this that with from by as i my me you your we our he she they them his her about what when where who how do does did say says said tell told explain anything something can could would should please any".split(" "));

export class PersonalIndex {
  private docs = new Map<string, Doc & { tokens: string[] }>();
  private vecs = new Map<string, Float32Array>();
  private df = new Map<string, number>();
  private avgLen = 1;
  private dirty = true;
  /** the hub's change counter when the index was last built (changes bump it synchronously) */
  private builtRev = -1;
  private building: Promise<void> | null = null;
  private libCache = new Map<string, Doc[]>();

  constructor(private hub: Hub, private embedder: Embedder | null = null, private log: (m: string) => void = () => {}) {
    hub.db.sql.exec("CREATE TABLE IF NOT EXISTS rag (id TEXT PRIMARY KEY, hash TEXT NOT NULL, vec BLOB)");
    // Anything changing marks the index stale; it's rebuilt lazily on the next search (or tick).
    hub.bus.subscribe({ roles: new Set(["index"]), send: (m) => m.type === "changed" && (this.dirty = true) });
  }

  setEmbedder(e: Embedder | null) {
    if (e === this.embedder) return;
    this.embedder = e;
    // A different model means different vectors: drop the old ones; refresh re-embeds what changed.
    this.vecs.clear();
    this.dirty = true;
  }

  /** which embedder is in use, for the status page */
  get engine(): string {
    return this.embedder ? (this.embedder.id ?? "on the Pi") : "keywords only";
  }

  /** Everything worth finding, as plain text. */
  private collect(): Doc[] {
    const h = this.hub;
    const today = h.todayKey();
    const out: Doc[] = [];
    for (const n of h.listNotes()) {
      const kind = n.kind === "voice" ? "voice note" : n.kind;
      const date = new Date(n.createdAt).toISOString().slice(0, 10);
      // Long notes are searched passage by passage, so the right paragraph comes back.
      const parts = n.body.length > 1200 ? chunk(n.body) : [n.body];
      parts.forEach((part, k) => out.push({ id: parts.length > 1 ? `note:${n.id}:${k}` : `note:${n.id}`, kind, title: n.label, text: `${n.label}\n${part}${k === 0 ? "\n" + n.tags.join(" ") : ""}`, date }));
    }
    // The library: passages with their page numbers (cached; documents never change once added).
    for (const d of listDocs(h)) {
      let passages = this.libCache.get(d.id);
      if (!passages) {
        passages = [];
        for (const pg of docPages(h, d.id)) {
          chunk(pg.text).forEach((text, k) => passages!.push({ id: `lib:${d.id}:${pg.n}:${k}`, kind: "document", title: d.pages > 1 ? `${d.title} · ${d.kind === "slides" ? "slide" : "p."} ${pg.n}` : d.title, text, date: new Date(d.addedAt).toISOString().slice(0, 10) }));
        }
        this.libCache.set(d.id, passages);
      }
      out.push(...passages);
    }
    for (const id of this.libCache.keys()) if (!listDocs(h).some((d) => d.id === id)) this.libCache.delete(id);
    for (const i of h.school.all()) {
      out.push({ id: `school:${i.id}`, kind: i.source === "mail" ? "school email" : "school page", title: i.title, text: `${i.title}\nfrom ${i.from}\n${i.preview}`, date: i.due ?? new Date(i.receivedAt).toISOString().slice(0, 10) });
    }
    for (const e of h.events.all()) out.push({ id: `event:${e.id}`, kind: "school calendar", title: e.title, text: `${e.title} ${e.time ?? ""} ${e.tags.join(" ")}`, date: e.date });
    for (const t of h.tasks.betweenDays(addDays(today, -60), addDays(today, 30))) {
      out.push({ id: `task:${t.id}`, kind: "task", title: t.name, text: `${t.name} ${SUBJECT_NAMES[t.subject] ?? t.subject} ${t.note}${t.done ? " done" : ""}${t.due ? " due " + t.due : ""}`, date: t.date });
    }
    for (const a of h.activities()) out.push({ id: `activity:${a.id}`, kind: "weekly commitment", title: a.name, text: `${a.name} ${a.where} ${a.start}-${a.end} days ${a.days.join(",")}`, date: null });
    for (const m of memories(h)) out.push({ id: `memory:${m.id}`, kind: "about the student", title: m.text.slice(0, 60), text: m.text, date: null });
    for (const b of h.birthdays()) out.push({ id: `bday:${b.name}:${b.date}`, kind: "birthday", title: `${b.name}'s birthday`, text: `${b.name} birthday ${b.date}`, date: null });
    const staff = h.teachers();
    const codes = new Set<string>();
    for (const periods of Object.values(h.timetable())) {
      for (const p of periods) {
        if (!p.teacher || codes.has(p.teacher)) continue;
        codes.add(p.teacher);
        const t = matchTeacher(p.teacher, p.subject, staff);
        out.push({ id: `teacher:${p.teacher}`, kind: "teacher", title: `${SUBJECT_NAMES[p.subject] ?? p.subject} teacher`, text: `${SUBJECT_NAMES[p.subject] ?? p.subject} teacher ${t?.name ?? p.teacher} (${p.teacher}) room ${p.room ?? ""}`, date: null });
      }
    }
    return out;
  }

  /** Bring the index up to date. Only new or changed documents are embedded. */
  async refresh(): Promise<void> {
    if (!this.dirty && this.builtRev === this.hub.bus.rev) return;
    if (this.building) return this.building;
    this.building = (async () => {
      this.dirty = false;
      this.builtRev = this.hub.bus.rev;
      const docs = this.collect();
      const stored = new Map(
        (this.hub.db.sql.prepare("SELECT id, hash, vec FROM rag").all() as { id: string; hash: string; vec: Uint8Array | null }[]).map((r) => [r.id, r]),
      );
      const next = new Map<string, Doc & { tokens: string[] }>();
      const toEmbed: { doc: Doc; hash: string }[] = [];
      for (const d of docs) {
        const hash = crypto.createHash("sha1").update(`${this.embedder?.id ?? "local"}\0${d.text}`).digest("hex").slice(0, 16);
        next.set(d.id, { ...d, tokens: tokenise(d.text.startsWith(d.title) ? d.text : `${d.title} ${d.text}`) });
        const row = stored.get(d.id);
        if (row && row.hash === hash && (row.vec || !this.embedder)) {
          if (row.vec) this.vecs.set(d.id, new Float32Array(row.vec.buffer.slice(row.vec.byteOffset, row.vec.byteOffset + row.vec.byteLength)));
        } else toEmbed.push({ doc: d, hash });
      }
      const up = this.hub.db.sql.prepare("INSERT OR REPLACE INTO rag (id, hash, vec) VALUES (?, ?, ?)");
      for (let i = 0; i < toEmbed.length; i += 16) {
        const batch = toEmbed.slice(i, i + 16);
        let vecs: Float32Array[] = [];
        if (this.embedder) {
          try {
            vecs = await this.embedder.embed(batch.map((b) => `${b.doc.kind}: ${b.doc.text}`));
          } catch (e) {
            this.log(`search: embedding failed (${(e as Error).message})`);
          }
        }
        batch.forEach((b, k) => {
          const v = vecs[k];
          if (v) this.vecs.set(b.doc.id, v);
          up.run(b.doc.id, b.hash, v ? new Uint8Array(v.buffer.slice(0)) : null);
        });
      }
      for (const id of stored.keys()) if (!next.has(id)) this.hub.db.sql.prepare("DELETE FROM rag WHERE id = ?").run(id);
      for (const id of this.vecs.keys()) if (!next.has(id)) this.vecs.delete(id);
      this.docs = next;
      this.df = new Map();
      let total = 0;
      for (const d of next.values()) {
        total += d.tokens.length;
        for (const w of new Set(d.tokens)) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      }
      this.avgLen = total / Math.max(1, next.size);
    })().finally(() => (this.building = null));
    return this.building;
  }

  async search(query: string, k = 8): Promise<Hit[]> {
    await this.refresh();
    const q = tokenise(query);
    const N = this.docs.size || 1;
    // BM25 (k1 1.2, b 0.75)
    const bm = new Map<string, number>();
    for (const d of this.docs.values()) {
      let s = 0;
      for (const w of q) {
        const tf = d.tokens.filter((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1)))).length;
        if (!tf) continue;
        const df = this.df.get(w) ?? 0.5;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.tokens.length) / this.avgLen));
      }
      if (s > 0) bm.set(d.id, s);
    }
    const ranks = new Map<string, number>();
    [...bm.entries()].sort((a, b) => b[1] - a[1]).forEach(([id], i) => ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i)));
    const cosOf = new Map<string, number>();
    if (this.embedder && this.vecs.size) {
      try {
        const [qv] = await this.embedder.embed([query]);
        [...this.vecs.entries()]
          .map(([id, v]) => [id, cosine(qv, v)] as const)
          .filter(([, s]) => s > 0.25)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 60)
          .forEach(([id, c], i) => {
            cosOf.set(id, c);
            ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + i));
          });
      } catch {
        /* keywords still work */
      }
    }
    const qset = new Set(q);
    const out: Hit[] = [];
    const perDoc = new Map<string, number>();
    for (const [id, score] of [...ranks.entries()].sort((a, b) => b[1] - a[1])) {
      const d = this.docs.get(id);
      if (!d) continue;
      // At most two passages from the same document or note, so answers draw on more than one.
      const parent = id.split(":").slice(0, 2).join(":");
      if ((perDoc.get(parent) ?? 0) >= 2) continue;
      perDoc.set(parent, (perDoc.get(parent) ?? 0) + 1);
      const toks = new Set(d.tokens);
      const cover = qset.size ? [...qset].filter((w) => toks.has(w) || [...toks].some((x) => w.length > 4 && x.startsWith(w.slice(0, -1)))).length / qset.size : 0;
      out.push({ id, kind: d.kind, title: d.title, text: d.text.slice(0, d.kind === "document" ? 900 : 400), date: d.date, score: Math.round(score * 1e4) / 1e4, cos: Math.round((cosOf.get(id) ?? 0) * 100) / 100, cover: Math.round(cover * 100) / 100 });
      if (out.length >= k) break;
    }
    return out;
  }

  /**
   * The passages worth sending with a question without being asked for: only confident matches
   * (close in meaning, or most of the question's words present), a few, and short.
   */
  async relevant(question: string, max = 3, budget = 1400): Promise<Hit[]> {
    if (tokenise(question).length < 2) return [];
    const words = tokenise(question).length;
    // Close in meaning, or most of the question's real words in one passage (at least two of them).
    const hits = (await this.search(question, 8)).filter((h) => h.cos >= 0.5 || (h.cover >= 0.5 && Math.round(h.cover * words) >= 2));
    const out: Hit[] = [];
    let used = 0;
    for (const h of hits) {
      if (out.length >= max || used + h.text.length > budget) break;
      out.push(h);
      used += h.text.length;
    }
    return out;
  }

  get size(): number {
    return this.docs.size;
  }
  get semantic(): boolean {
    return !!this.embedder;
  }
}
