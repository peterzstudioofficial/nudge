import { OR_BASE } from "../agent/llm";
import type { Embedder } from "./embed";
import type { LibPage } from "./library";

/**
 * The optional OpenRouter half of the private search. Both are off unless switched on, and both
 * only go to providers that keep nothing (zero data retention, no data collection): if none is
 * free, OpenRouter refuses and the Pi carries on with what it has.
 *
 * - Embeddings: a stronger meaning-match than the small on-device model, for about 2p per
 *   thousand pages. Questions are embedded too (a fraction of a penny a month).
 * - OCR: scanned PDFs and photos of worksheets read by a cheap vision model, page by page,
 *   only after Peter has seen what it would cost and said yes.
 */
const PRIVATE = { zdr: true, data_collection: "deny" } as const;
export const DEFAULT_EMBED_MODEL = "qwen/qwen3-embedding-8b";
export const DEFAULT_OCR_MODEL = "google/gemini-3.5-flash-lite";
/** Qwen3 embeddings are trained so the first N dimensions still work on their own. */
const DIMS = 1024;

export interface RemoteDeps {
  key: () => string | null;
  /** false when this month's AI budget is used up */
  canSpend: () => boolean;
  onCost: (usd: number) => void;
  log: (m: string) => void;
  fetchImpl?: typeof fetch;
}

export function openRouterEmbedder(model: string, d: RemoteDeps): Embedder & { id: string } {
  const f = d.fetchImpl ?? fetch;
  return {
    id: `or:${model}:${DIMS}`,
    async embed(texts) {
      const key = d.key();
      if (!key) throw new Error("no OpenRouter key");
      if (!d.canSpend()) throw new Error("this month's AI budget is used up");
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 6000));
        const r = await f(`${OR_BASE}/embeddings`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Nudge" },
          body: JSON.stringify({ model, input: batch, dimensions: DIMS, provider: PRIVATE }),
          signal: AbortSignal.timeout(60_000),
        });
        const j = (await r.json().catch(() => ({}))) as { data?: { embedding: number[]; index?: number }[]; usage?: { cost?: number }; error?: { message?: string } };
        if (!r.ok || !j.data) throw new Error(`OpenRouter embeddings: ${j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 200));
        if (j.usage?.cost) d.onCost(j.usage.cost);
        const rows = [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        for (const row of rows) out.push(unit(row.embedding.slice(0, DIMS)));
      }
      return out;
    },
  };
}

function unit(v: number[]): Float32Array {
  const a = Float32Array.from(v);
  let n = 0;
  for (const x of a) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= n;
  return a;
}

/** Roughly what reading a scanned document costs: a picture per page in, its words out. */
export function ocrEstimate(pages: number): number {
  return Math.round(Math.max(1, pages) * (1300 * 0.3 + 900 * 2.5) / 1e6 * 10000) / 10000;
}

const OCR_PROMPT =
  "Transcribe all the text in this document exactly as written, page by page. Start every page with a line '=== page N ===' (N = page number). Keep headings, lists and line breaks. Don't summarise, translate, fix or add anything. If a page has no text, write the page line and nothing else.";

/** Read a scanned PDF or a photo with a cheap vision model. Returns the pages it found. */
export async function ocrDocument(model: string, data: Uint8Array, kind: "pdf" | "image", mime: string, pages: number, d: RemoteDeps): Promise<LibPage[]> {
  const key = d.key();
  if (!key) throw new Error("no OpenRouter key on the wall");
  if (!d.canSpend()) throw new Error("this month's AI budget is used up");
  const b64 = Buffer.from(data).toString("base64");
  const part =
    kind === "pdf"
      ? { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${/^image\/(png|jpeg|webp|gif)$/.test(mime) ? mime : "image/jpeg"};base64,${b64}` } };
  const r = await (d.fetchImpl ?? fetch)(`${OR_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Nudge" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: [{ type: "text", text: OCR_PROMPT }, part] }],
      ...(kind === "pdf" ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {}),
      provider: { ...PRIVATE, max_price: { prompt: 1, completion: 3 } },
      temperature: 0,
      max_tokens: Math.min(60_000, 1500 * Math.max(1, pages) + 500),
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(`OpenRouter OCR: ${j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 200));
  if (j.usage?.cost) d.onCost(j.usage.cost);
  const text = j.choices?.[0]?.message?.content ?? "";
  return splitPages(text);
}

/** "=== page 3 ===" markers → pages. Without markers it's one page. */
export function splitPages(text: string): LibPage[] {
  const parts = text.split(/^\s*===\s*page\s+(\d+)\s*===\s*$/im);
  if (parts.length < 3) return text.trim() ? [{ n: 1, text: text.trim() }] : [];
  const out: LibPage[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const t = (parts[i + 1] ?? "").trim();
    if (t) out.push({ n: Number(parts[i]), text: t });
  }
  return out;
}
