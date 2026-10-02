import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * "Nudge" — the wake word, spotted on the Pi.
 *
 * A 3.3M-parameter streaming keyword spotter (sherpa-onnx zipformer, int8, ~5 MB) that knows the
 * word by its spelling, so no training and no audio ever leaves the Pi. It's the cheap second
 * stage: the mic daemon only sends audio here while someone is actually talking (a loudness gate
 * on the Pi), so most of the time nothing runs at all. On the Pi 4 it decodes at roughly a fifth of
 * real time on one core while it's fed.
 *
 * The model is loaded when the wake word is switched on and released after 10 quiet minutes.
 */
export interface Kws {
  /** feed 16 kHz mono PCM; returns the keyword if it was just heard */
  feed(pcm: Int16Array): string | null;
  /** forget any half-heard word (after a session ends, or the gate closes) */
  reset(): void;
}

/** The keywords, in the model's own spelling. "Hey nudge" / "OK nudge" work too. */
export const KEYWORDS = [
  "▁ N U D GE :1.5 #0.30 @nudge",
  "▁HE Y ▁ N U D GE :1.5 #0.30 @hey_nudge",
  "▁O K ▁ N U D GE :1.5 #0.30 @ok_nudge",
];

const FILES = {
  encoder: "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  decoder: "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  joiner: "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  tokens: "tokens.txt",
};

interface KwsStream {
  acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void;
}
interface Spotter {
  createStream(): KwsStream;
  isReady(s: KwsStream): boolean;
  decode(s: KwsStream): void;
  reset(s: KwsStream): void;
  getResult(s: KwsStream): { keyword?: string };
}
interface Sherpa {
  KeywordSpotter: new (config: unknown) => Spotter;
}

export function loadKws(dir: string, log: (m: string) => void, opts: { idleMs?: number } = {}): Kws | null {
  const files = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, path.join(dir, f)])) as typeof FILES;
  if (!Object.values(files).every((f) => fs.existsSync(f))) return null;
  const kwFile = path.join(dir, "nudge-keywords.txt");
  try {
    // Fixed in code on purpose: a malformed line makes the native spotter abort the whole process.
    fs.writeFileSync(kwFile, KEYWORDS.join("\n") + "\n");
  } catch {
    /* read-only model dir: use what's there */
  }
  let spotter: Spotter | null = null;
  let stream: KwsStream | null = null;
  let broken = false;
  let idle: NodeJS.Timeout | null = null;
  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      spotter = null;
      stream = null;
      log("wake word: model released (idle)");
    }, opts.idleMs ?? 10 * 60_000);
    idle.unref();
  };
  const ensure = () => {
    if (spotter || broken) return;
    try {
      const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as Sherpa;
      spotter = new sherpa.KeywordSpotter({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: { transducer: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner }, tokens: files.tokens, numThreads: 1, provider: "cpu", debug: 0 },
        keywordsFile: kwFile,
        maxActivePaths: 4,
        numTrailingBlanks: 1,
        keywordsScore: 1.0,
        keywordsThreshold: 0.25,
      });
      stream = spotter.createStream();
      log("wake word: listening for \"nudge\" (on the Pi)");
    } catch (e) {
      broken = true;
      log(`wake word unavailable (${(e as Error).message.slice(0, 120)})`);
    }
  };
  log(`wake word: model installed (${path.basename(dir)})`);
  return {
    feed(pcm) {
      ensure();
      if (!spotter || !stream) return null;
      touch();
      const f = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
      stream.acceptWaveform({ sampleRate: 16000, samples: f });
      let hit: string | null = null;
      while (spotter.isReady(stream)) {
        spotter.decode(stream);
        const r = spotter.getResult(stream);
        if (r.keyword) {
          hit = r.keyword.replace(/_/g, " ");
          spotter.reset(stream);
        }
      }
      return hit;
    },
    reset() {
      if (spotter && stream) spotter.reset(stream);
    },
  };
}
