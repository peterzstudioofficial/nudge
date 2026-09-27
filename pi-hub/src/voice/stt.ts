import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * On-device speech-to-text (Moonshine tiny, int8, via sherpa-onnx). Used to turn voice notes
 * into text on the Pi itself — the audio never leaves the house. ~2× faster than real time on
 * a Pi 4, fine for short notes on a Pi 3.
 *
 * Model folder: <data>/models/moonshine/{preprocess,encode.int8,uncached_decode.int8,cached_decode.int8}.onnx + tokens.txt
 */
export interface Stt {
  /** 16-bit PCM WAV bytes (any sample rate) → text */
  transcribeWav(wav: Uint8Array): Promise<string>;
  /** raw float samples → text */
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
}

interface SherpaStream {
  acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  decodeAsync(s: SherpaStream): Promise<{ text: string }>;
}
interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<SherpaRecognizer> };
}

/** 16-bit PCM WAV (mono or stereo) → mono float samples. Throws on anything else. */
export function parseWav(wav: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  if (wav.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let o = 12;
  let fmt: { ch: number; rate: number; bits: number; format: number } | null = null;
  while (o + 8 <= wav.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { format: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.ch < 1 || fmt.ch > 2) throw new Error("need 16-bit PCM WAV");
      const n = Math.floor(Math.min(size, wav.length - o - 8) / 2 / fmt.ch);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let c = 0; c < fmt.ch; c++) v += dv.getInt16(o + 8 + (i * fmt.ch + c) * 2, true);
        out[i] = v / fmt.ch / 32768;
      }
      return { samples: out, sampleRate: fmt.rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("WAV has no audio");
}

/**
 * Moonshine is built for short utterances, so long notes are cut into pieces of at most ~25 s,
 * each at the quietest moment between 15 and 25 s so words aren't split.
 */
export function segments(samples: Float32Array, rate: number): Float32Array[] {
  const out: Float32Array[] = [];
  const frame = Math.round(rate / 10);
  let at = 0;
  while (samples.length - at > 25 * rate) {
    let best = at + 25 * rate;
    let bestE = Infinity;
    for (let f = at + 15 * rate; f + frame <= at + 25 * rate; f += frame) {
      let e = 0;
      for (let i = f; i < f + frame; i++) e += samples[i] * samples[i];
      if (e < bestE) {
        bestE = e;
        best = f + Math.round(frame / 2);
      }
    }
    out.push(samples.subarray(at, best));
    at = best;
  }
  if (samples.length - at > rate / 5 || !out.length) out.push(samples.subarray(at));
  return out;
}

/**
 * Returns null if the model isn't installed. Otherwise the model is loaded on first use and
 * let go again after 10 idle minutes, so it only takes the Pi's memory while it's working.
 */
export function loadStt(dir: string, log: (m: string) => void): Stt | null {
  const f = (n: string) => path.join(dir, n);
  const need = ["preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt"];
  if (!need.every((n) => fs.existsSync(f(n)))) return null;
  let rec: Promise<SherpaRecognizer> | null = null;
  let idle: NodeJS.Timeout | null = null;
  const recognizer = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => (rec = null), 10 * 60_000);
    idle.unref();
    return (rec ??= (async () => {
      const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as Sherpa;
      const r = await sherpa.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          moonshine: {
            preprocessor: f("preprocess.onnx"),
            encoder: f("encode.int8.onnx"),
            uncachedDecoder: f("uncached_decode.int8.onnx"),
            cachedDecoder: f("cached_decode.int8.onnx"),
          },
          tokens: f("tokens.txt"),
          numThreads: 2,
          provider: "cpu",
          debug: 0,
        },
      });
      log("speech-to-text: model loaded");
      return r;
    })().catch((e) => {
      rec = null;
      throw new Error(`speech-to-text unavailable (${(e as Error).message.slice(0, 120)})`);
    }));
  };
  log("speech-to-text: on-device model installed");
  // One at a time, so a burst of notes can't eat all the Pi's memory.
  let queue: Promise<unknown> = Promise.resolve();
  const transcribe = (samples: Float32Array, sampleRate: number) => {
    const job = queue.then(async () => {
      const r = await recognizer();
      const parts: string[] = [];
      for (const seg of segments(samples, sampleRate)) {
        const s = r.createStream();
        s.acceptWaveform({ samples: seg, sampleRate });
        const out = await r.decodeAsync(s);
        if (out.text?.trim()) parts.push(out.text.trim());
      }
      return parts.join(" ");
    });
    queue = job.catch(() => {});
    return job;
  };
  return {
    transcribe,
    async transcribeWav(wav) {
      const w = parseWav(wav);
      return transcribe(w.samples, w.sampleRate);
    },
  };
}
