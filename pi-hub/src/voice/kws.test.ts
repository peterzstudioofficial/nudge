import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadKws } from "./kws";

// Needs the model (sudo nudge install-models, or NUDGE_KWS_MODEL) and test clips; skipped otherwise.
const DIR = process.env.NUDGE_KWS_MODEL ?? "";
const CLIPS = process.env.NUDGE_KWS_CLIPS ?? "";
const have = !!DIR && fs.existsSync(DIR) && !!CLIPS && fs.existsSync(CLIPS);

const read = (f: string) => {
  const w = createRequire(import.meta.url)("sherpa-onnx-node").readWave(path.join(CLIPS, f)) as { samples: Float32Array };
  return Int16Array.from(w.samples, (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
};
const heard = (file: string) => {
  const k = loadKws(DIR, () => {})!;
  const pcm = read(file);
  const out: string[] = [];
  for (let i = 0; i < pcm.length; i += 4000) {
    const h = k.feed(pcm.subarray(i, i + 4000));
    if (h) out.push(h);
  }
  // a little silence after, like the gate's tail
  const h = k.feed(new Int16Array(8000));
  if (h) out.push(h);
  return out;
};

describe.skipIf(!have)("wake word", () => {
  it("hears 'nudge' and 'hey nudge'", () => {
    expect(heard("nudge1.wav")).toEqual(["nudge"]);
    expect(heard("nudge2.wav")[0]).toMatch(/nudge/);
  });
  it("ignores other speech, even rhymes", () => {
    expect(heard("neg1.wav")).toEqual([]);
    expect(heard("neg2.wav")).toEqual([]);
  });
});
