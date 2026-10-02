import { strFromU8, unzipSync } from "fflate";
import { type Hub, newId } from "../hub";
import { HttpError } from "../errors";

/**
 * The library: documents Peter gives the assistant to read (revision guides, the syllabus, a
 * script, worksheets). The text is pulled out on the Pi, once, when the file arrives — nothing
 * is sent anywhere to do it and no credit is used. After that it's part of the private search,
 * cut into page-numbered passages, so a question only ever carries the few passages it needs.
 */
export interface LibDoc {
  id: string;
  title: string;
  kind: "pdf" | "word" | "slides" | "text" | "image";
  bytes: number;
  /** read by OCR (OpenRouter), not from text in the file */
  ocr?: boolean;
  pages: number;
  chars: number;
  addedAt: number;
}

/** A page (or slide) of text. PDFs and slides keep their numbers; everything else is one "page". */
export interface LibPage {
  n: number;
  text: string;
}

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 1_500_000;
const MAX_DOCS = 200;
const KEY = "library";

const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const entities = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

export function kindOf(name: string, mime: string, data: Uint8Array): LibDoc["kind"] | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf" || (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) return "pdf";
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(ext) || /^image\/(jpeg|png|webp|heic)$/.test(mime)) return "image";
  if (ext === "docx") return "word";
  if (ext === "pptx") return "slides";
  if (["txt", "md", "markdown", "csv", "html", "htm", "srt", "vtt", "fountain"].includes(ext) || mime.startsWith("text/")) return "text";
  return null;
}

/** Word and PowerPoint files are zips: a small file can claim to unpack into gigabytes. Not here. */
const MAX_UNZIPPED = 40 * 1024 * 1024;
const safeSize = (f: { originalSize: number }) => f.originalSize <= MAX_UNZIPPED;

/** Text out of a file, page by page. Scanned PDFs (pictures of pages) have no text to find. */
export async function extractPages(data: Uint8Array, kind: LibDoc["kind"]): Promise<LibPage[]> {
  if (kind === "image") return [{ n: 1, text: "" }];
  if (kind === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const pages: LibPage[] = [];
    try {
      for (let i = 1; i <= Math.min(doc.numPages, 1000); i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        let t = "";
        for (const it of tc.items) if ("str" in it) t += it.str + (it.hasEOL ? "\n" : " ");
        pages.push({ n: i, text: clean(t) });
      }
    } finally {
      await doc.destroy();
    }
    return pages;
  }
  if (kind === "word") {
    const xml = strFromU8(unzipSync(data, { filter: (f) => f.name === "word/document.xml" && safeSize(f) })["word/document.xml"] ?? new Uint8Array());
    const text = entities(xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, ""));
    return [{ n: 1, text: clean(text) }];
  }
  if (kind === "slides") {
    let total = 0;
    const files = unzipSync(data, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) && safeSize(f) && (total += f.originalSize) <= MAX_UNZIPPED });
    return Object.keys(files)
      .map((f) => ({ n: Number(/slide(\d+)\.xml$/.exec(f)![1]), xml: strFromU8(files[f]) }))
      .sort((a, b) => a.n - b.n)
      .map(({ n, xml }) => ({ n, text: clean(entities([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ").replace(/<\/a:p>/g, "\n"))) }));
  }
  const s = strFromU8(data);
  const text = /<html|<body|<p[ >]/i.test(s) ? entities(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(p|div|h\d|li|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")) : s;
  return [{ n: 1, text: clean(text) }];
}

export function listDocs(hub: Hub): LibDoc[] {
  return hub.db.kvGet<LibDoc[]>(KEY, []);
}

export function docPages(hub: Hub, id: string): LibPage[] {
  const b = hub.db.blobGet(`libtext:${id}`);
  if (!b) return [];
  try {
    return JSON.parse(strFromU8(b.data)) as LibPage[];
  } catch {
    return [];
  }
}

export function docFile(hub: Hub, id: string) {
  return hub.db.blobGet(`libfile:${id}`);
}

/** OCR for scans and photos, provided by the hub when OpenRouter is set up. */
export type Ocr = (data: Uint8Array, kind: "pdf" | "image", mime: string, pages: number) => Promise<LibPage[]>;

export async function addDoc(hub: Hub, f: { name: string; mime: string; data: Uint8Array }, o: { ocr?: Ocr | null; ocrOk?: boolean; estimate?: (pages: number) => number } = {}): Promise<LibDoc> {
  if (f.data.length > MAX_BYTES) throw new HttpError(413, "that file is too big (25 MB max)");
  const list = listDocs(hub);
  if (list.length >= MAX_DOCS) throw new HttpError(409, "the library is full — delete something first");
  const kind = kindOf(f.name, f.mime, f.data);
  if (!kind) throw new HttpError(415, "PDF, Word, PowerPoint, text or a photo only");
  let pages: LibPage[];
  try {
    pages = await extractPages(f.data, kind);
  } catch {
    throw new HttpError(422, "couldn't read that file");
  }
  let usedOcr = false;
  const hasText = pages.some((p) => p.text.trim().length > 20);
  if (!hasText && (kind === "pdf" || kind === "image")) {
    // A scan or a photo: no text to find on the Pi. Reading it costs a little, so ask first.
    const n = Math.max(1, pages.length);
    if (!o.ocr) throw new HttpError(422, kind === "pdf" ? "no text in that PDF (it's scanned) — connect OpenRouter to read scans" : "photos need OpenRouter connected to be read");
    if (!o.ocrOk) throw new HttpError(402, "it's a scan: reading it costs a little", undefined, { needsOcr: true, pages: n, estUsd: o.estimate?.(n) ?? 0 });
    try {
      pages = await o.ocr(f.data, kind, f.mime, n);
    } catch (e) {
      throw new HttpError(502, `couldn't read it: ${(e as Error).message}`.slice(0, 200));
    }
    usedOcr = true;
  }
  let chars = 0;
  pages = pages.filter((p) => p.text).map((p) => {
    const text = p.text.slice(0, Math.max(0, MAX_CHARS - chars));
    chars += text.length;
    return { ...p, text };
  }).filter((p) => p.text);
  if (!chars) throw new HttpError(422, "no text in that file");
  const title = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 80) || "document";
  const doc: LibDoc = { id: newId(), title, kind, bytes: f.data.length, pages: pages.length, chars, addedAt: hub.now(), ...(usedOcr ? { ocr: true } : {}) };
  hub.db.blobPut(`libfile:${doc.id}`, f.mime || "application/octet-stream", f.data);
  hub.db.blobPut(`libtext:${doc.id}`, "application/json", new TextEncoder().encode(JSON.stringify(pages)));
  hub.db.kvSet(KEY, [...list, doc]);
  hub.bus.changed("library");
  return doc;
}

export function removeDoc(hub: Hub, id: string): boolean {
  const list = listDocs(hub);
  if (!list.some((d) => d.id === id)) return false;
  hub.db.kvSet(KEY, list.filter((d) => d.id !== id));
  hub.db.blobDel(`libfile:${id}`);
  hub.db.blobDel(`libtext:${id}`);
  hub.bus.changed("library");
  return true;
}

/**
 * Passages for the search: ~700 characters each, split at paragraph or sentence ends where it
 * can, overlapping a little so an answer that straddles two isn't lost.
 */
export function chunk(text: string, size = 700, overlap = 120): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const window = text.slice(i + size * 0.6, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (cut > 0) end = i + Math.floor(size * 0.6) + cut + 1;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}
