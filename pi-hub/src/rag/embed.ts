import fs from "node:fs";
import path from "node:path";

/**
 * On-device sentence embeddings (all-MiniLM-L6-v2, int8, 384 dimensions) with onnxruntime.
 * Runs on the Pi's CPU; nothing is sent anywhere. The model files live in
 * <data>/models/minilm/{model.onnx,tokenizer.json} (install.sh downloads them).
 * If they're missing, search falls back to keywords only.
 *
 * The model is loaded on first use and released after 10 idle minutes, so it only takes the
 * Pi's memory (~80 MB) while the assistant is actually searching.
 */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

type Ort = typeof import("onnxruntime-node");

export async function loadEmbedder(dir: string, log: (m: string) => void): Promise<Embedder | null> {
  const model = path.join(dir, "model.onnx");
  const tok = path.join(dir, "tokenizer.json");
  if (!fs.existsSync(model) || !fs.existsSync(tok)) return null;
  interface Loaded {
    ort: Ort;
    session: Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;
    tokenizer: { encode(t: string): { ids: number[] } };
  }
  let loaded: Promise<Loaded> | null = null;
  let broken: string | null = null;
  let idle: NodeJS.Timeout | null = null;
  const load = (): Promise<Loaded> => {
    if (broken) return Promise.reject(new Error(broken));
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      const l = loaded;
      loaded = null;
      void l?.then((x) => x.session.release()).catch(() => {});
    }, 10 * 60_000);
    idle.unref();
    return (loaded ??= (async () => {
      const ort = await import("onnxruntime-node");
      const { Tokenizer } = await import("@huggingface/tokenizers");
      const cfgPath = path.join(dir, "tokenizer_config.json");
      const tokenizer = new Tokenizer(JSON.parse(fs.readFileSync(tok, "utf8")), fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {});
      // Two threads: fast enough, and leaves the Pi's other cores for the wall. No memory arena:
      // slightly slower, a lot less memory.
      const session = await ort.InferenceSession.create(model, { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: "all", enableCpuMemArena: false, executionMode: "sequential" });
      return { ort, session, tokenizer };
    })().catch((e) => {
      broken = `embeddings unavailable (${(e as Error).message.slice(0, 120)})`;
      log(`search: ${broken}; using keywords`);
      loaded = null;
      throw e;
    }));
  };
  log(`search: on-device embeddings installed (${path.basename(dir)})`);
  let queue: Promise<unknown> = Promise.resolve();
  return {
    embed(texts) {
      const job = queue.then(async () => {
        const { ort, session, tokenizer } = await load();
        const needsTypes = session.inputNames.includes("token_type_ids");
        const out: Float32Array[] = [];
        for (const text of texts) {
          const ids = tokenizer.encode(text.slice(0, 2000)).ids.slice(0, 256);
          const n = ids.length;
          const big = (a: number[]) => BigInt64Array.from(a.map((x) => BigInt(x)));
          const feeds: Record<string, InstanceType<Ort["Tensor"]>> = {
            input_ids: new ort.Tensor("int64", big(ids), [1, n]),
            attention_mask: new ort.Tensor("int64", big(new Array(n).fill(1)), [1, n]),
          };
          if (needsTypes) feeds.token_type_ids = new ort.Tensor("int64", big(new Array(n).fill(0)), [1, n]);
          const res = await session.run(feeds);
          const hidden = (res.last_hidden_state ?? res[session.outputNames[0]]).data as Float32Array;
          const dim = hidden.length / n;
          // Mean pooling, then unit length.
          const v = new Float32Array(dim);
          for (let t = 0; t < n; t++) for (let d = 0; d < dim; d++) v[d] += hidden[t * dim + d] / n;
          let norm = 0;
          for (let d = 0; d < dim; d++) norm += v[d] * v[d];
          norm = Math.sqrt(norm) || 1;
          for (let d = 0; d < dim; d++) v[d] /= norm;
          out.push(v);
        }
        return out;
      });
      queue = job.catch(() => {});
      return job;
    },
  };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
