import { describe, expect, it, vi } from "vitest";
import type { HubMessage, HwInput } from "@nudge/shared";
import type { Ctx } from "../context";
import { Db } from "../db";
import { Hub } from "../hub";
import { agentService } from "../agent/agent";
import { parseWav, segments } from "./stt";

// A fake Gemini Live: records what it's sent and plays back a scripted conversation.
const live = vi.hoisted(() => ({
  sent: [] as unknown[],
  toolResponses: [] as unknown[],
  config: null as null | { model: string; config: { systemInstruction: string; tools: { functionDeclarations: { name: string }[] }[] } },
  cb: null as null | { onmessage(m: unknown): void; onclose(): void },
}));
vi.mock("@google/genai", () => ({
  Modality: { AUDIO: "AUDIO" },
  GoogleGenAI: class {
    live = {
      connect: async (o: { model: string; config: never; callbacks: never }) => {
        live.config = o;
        live.cb = o.callbacks;
        return {
          sendRealtimeInput: (x: unknown) => live.sent.push(x),
          sendToolResponse: (x: unknown) => live.toolResponses.push(x),
          close: () => {},
        };
      },
    };
  },
}));
const { voiceService } = await import("./wall");

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const pcm = (n = 4000) => Buffer.alloc(n * 2).toString("base64");

function setup(o: { gemini: boolean; stt?: string }) {
  const hub = new Hub(new Db(":memory:"));
  hub.updateSettings("owner", { ai: true, voiceReplies: true });
  const msgs: HubMessage[] = [];
  hub.bus.subscribe({ roles: new Set(["local"]), send: (m) => msgs.push(m) });
  const inputs: HwInput[] = [];
  const agent = agentService({ hub, llm: null, say: () => {}, log: () => {} });
  const ctx = { hub, agent, hw: { input: (i: HwInput) => inputs.push(i), leds: () => {} } } as unknown as Ctx;
  const stt = o.stt === undefined ? null : { transcribe: async () => o.stt!, transcribeWav: async () => o.stt! };
  const voice = voiceService({ ctx, geminiKey: o.gemini ? "k" : null, stt: () => stt, log: () => {} });
  return { hub, voice, msgs, inputs };
}

describe("wall voice", () => {
  it("without Gemini, turns speech into text on the Pi and hands it to the wall", async () => {
    const { voice, inputs, msgs } = setup({ gemini: false, stt: "what's due tomorrow" });
    voice.audio(pcm());
    voice.audio(pcm());
    voice.end();
    await wait();
    expect(inputs).toEqual([{ kind: "voice", text: "what's due tomorrow" }]);
    expect(msgs.some((m) => m.type === "say" && m.line === "checking")).toBe(true);
  });

  it("says so when nothing is set up", async () => {
    const { voice, msgs } = setup({ gemini: false });
    voice.audio(pcm());
    voice.end();
    await wait();
    expect(msgs.some((m) => m.type === "say" && m.line === "voice isn't set up")).toBe(true);
  });

  it("with Gemini Live: streams audio, runs tools with the same rules, shows and speaks the reply", async () => {
    live.sent.length = 0;
    live.toolResponses.length = 0;
    const { hub, voice, msgs } = setup({ gemini: true });
    voice.audio(pcm());
    await wait();
    voice.audio(pcm());
    voice.end();
    await wait();
    expect(live.config?.model).toBe("gemini-3.8-live");
    const names = live.config!.config.tools[0].functionDeclarations.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["propose_email", "get_today"]));
    // two chunks then end-of-audio, none sent twice
    expect(live.sent.filter((x) => (x as { audio?: unknown }).audio)).toHaveLength(2);
    expect(live.sent.at(-1)).toEqual({ audioStreamEnd: true });

    // The model tries to send an email: that only becomes an ask.
    live.cb!.onmessage({ serverContent: { inputTranscription: { text: "email mr hale I'm ill" } } });
    live.cb!.onmessage({ toolCall: { functionCalls: [{ id: "1", name: "propose_email", args: { to_email: "j.hale@churcherscollege.com", to_name: "mr hale", subject: "ill", body: "I'm ill today", ask_summary: "off ill" } }] } });
    await wait();
    expect(live.toolResponses).toHaveLength(1);
    expect(hub.asks.all().some((a) => a.kind === "email")).toBe(true);

    live.cb!.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "I've drafted it — check the wall." } } });
    live.cb!.onmessage({ serverContent: { turnComplete: true } });
    await wait();
    expect(msgs.some((m) => m.type === "play" && m.rate === 24000)).toBe(true);
    const t = hub.threads.all().find((x) => x.origin === "wall");
    expect(t?.prompt).toBe("email mr hale I'm ill");
    expect(t?.log.some((l) => l.text.includes("drafted"))).toBe(true);
  });
});

describe("on-device speech-to-text helpers", () => {
  it("reads 16-bit WAV", () => {
    const n = 16;
    const b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0);
    b.writeUInt32LE(36 + n * 2, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(16000, 24);
    b.writeUInt32LE(32000, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36);
    b.writeUInt32LE(n * 2, 40);
    b.writeInt16LE(16384, 44);
    const w = parseWav(new Uint8Array(b));
    expect(w.sampleRate).toBe(16000);
    expect(w.samples.length).toBe(n);
    expect(w.samples[0]).toBeCloseTo(0.5);
    expect(() => parseWav(new Uint8Array(10))).toThrow();
  });

  it("cuts long notes at a quiet moment", () => {
    const rate = 1000;
    const s = new Float32Array(60 * rate).fill(0.5);
    s.fill(0, 20 * rate, 20 * rate + 300); // a pause at 20 s
    const parts = segments(s, rate);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeGreaterThanOrEqual(20 * rate);
    expect(parts[0].length).toBeLessThanOrEqual(20 * rate + 300);
    expect(parts.every((p) => p.length <= 25 * rate)).toBe(true);
    expect(parts.reduce((a, p) => a + p.length, 0)).toBe(s.length);
  });
});
