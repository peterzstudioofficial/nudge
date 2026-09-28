import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Hub } from "../hub";
import { addSpend, spend } from "../agent/spend";

/**
 * Reading answers out loud, in the same voice as the live voice chat (one of Gemini's prebuilt
 * voices), with Gemini's cheapest speech model.
 *
 * Why not on the Pi: Piper is instant but sounds robotic next to the live voice; Kokoro sounds
 * good but runs slower than real time on a Pi 4. A two-line answer costs about a tenth of a
 * penny here, and every phrase is cached on the Pi, so "week a." or "time to sleep" is only ever
 * paid for once. No key, over budget or offline: the answer is just shown, never an error.
 */
export const TTS_USD_PER_AUDIO_TOKEN = 6 / 1e6;
const AUDIO_TOKENS_PER_SEC = 25;
const RATE = 24000;
const MAX_CACHE = 300;

export type SynthFn = (o: { model: string; voice: string; text: string }) => Promise<Buffer | null>;

export function geminiSynth(apiKey: string): SynthFn {
  let ai: Promise<import("@google/genai").GoogleGenAI> | null = null;
  return async ({ model, voice, text }) => {
    ai ??= import("@google/genai").then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey }));
    const r = await (await ai).models.generateContent({
      model,
      contents: [{ parts: [{ text: `Say casually and warmly, at a natural pace: ${text}` }] }],
      config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    });
    const b64 = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    return b64 ? Buffer.from(b64, "base64") : null;
  };
}

export interface Tts {
  speak(text: string): Promise<boolean>;
}

export function ttsService(o: { hub: Hub; synth: SynthFn | null; dir: string; log: (m: string) => void }): Tts {
  const { hub } = o;
  const play = (pcm: Buffer) => hub.bus.broadcast({ type: "play", pcm: pcm.toString("base64"), rate: RATE }, ["local"]);
  let busy = false;

  return {
    async speak(raw) {
      const s = hub.settings();
      if (!s.voiceReplies || !s.ai) return false;
      const text = raw.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!text) return false;
      const key = crypto.createHash("sha1").update(`${s.ttsModel}|${s.voiceName}|${text.toLowerCase()}`).digest("hex").slice(0, 20);
      const file = path.join(o.dir, `${key}.pcm`);
      try {
        const hit = fs.readFileSync(file);
        fs.utimesSync(file, new Date(), new Date());
        play(hit);
        return true;
      } catch {
        /* not cached yet */
      }
      if (!o.synth || busy || spend(hub).usd >= s.aiBudgetUsd) return false;
      busy = true;
      try {
        const pcm = await o.synth({ model: s.ttsModel, voice: s.voiceName, text });
        if (!pcm?.length) return false;
        addSpend(hub, (pcm.length / 2 / RATE) * AUDIO_TOKENS_PER_SEC * TTS_USD_PER_AUDIO_TOKEN);
        play(pcm);
        fs.mkdirSync(o.dir, { recursive: true });
        fs.writeFileSync(file, pcm);
        prune(o.dir);
        return true;
      } catch (e) {
        o.log(`voice: read-out failed (${(e as Error).message.slice(0, 120)})`);
        return false;
      } finally {
        busy = false;
      }
    },
  };
}

/** Keep the phrase cache small: the least recently played go first. */
function prune(dir: string) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pcm"));
  if (files.length <= MAX_CACHE) return;
  files
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
    .slice(0, files.length - MAX_CACHE)
    .forEach(({ f }) => fs.rmSync(path.join(dir, f), { force: true }));
}
