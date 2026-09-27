import type { GoogleGenAI, LiveServerMessage, Modality, Session } from "@google/genai";
import type { Ctx } from "../context";
import type { Stt } from "./stt";

/**
 * The wall's voice assistant. The hardware daemon streams the mic here (16 kHz 16-bit mono PCM)
 * after the touch pad is pressed, and says when the student stops talking.
 *
 * - With a Gemini key: one Gemini Live turn, audio in, with the same tools and rules as the text
 *   assistant (anything that sends or changes something is still only an ask). The reply shows
 *   on the wall, and is spoken too if spoken replies are on and there's a speaker.
 * - Without one: the Pi turns the speech into text itself (Moonshine, on-device) and hands it to
 *   the wall screen, which asks the cheap text assistant.
 *
 * Audio is never saved.
 */
export const DEFAULT_VOICE_MODEL = "gemini-3.8-live";
const MAX_BYTES = 16000 * 2 * 15; // 15 s
const TURN_TIMEOUT = 30_000;

export interface VoiceService {
  audio(b64: string): void;
  end(): void;
  available(): { live: boolean; local: boolean };
}

export function voiceService(o: { ctx: Ctx; geminiKey: string | null; stt: () => Stt | null; log: (m: string) => void }): VoiceService {
  // The Gemini SDK is loaded on the first spoken turn, not at start-up (memory on the Pi).
  let sdk: Promise<{ ai: GoogleGenAI; audio: Modality }> | null = null;
  const gemini = () =>
    (sdk ??= import("@google/genai").then(({ GoogleGenAI, Modality }) => ({ ai: new GoogleGenAI({ apiKey: o.geminiKey! }), audio: Modality.AUDIO })));
  const { ctx } = o;
  let turn: Turn | null = null;

  const say = (icon: string, line: string, sub?: string, ms = 2600) => ctx.hub.bus.broadcast({ type: "say", icon, line, sub, ms }, ["local"]);

  interface Turn {
    chunks: Buffer[];
    bytes: number;
    ended: boolean;
    live: Promise<Session | null> | null;
    session: Session | null;
    done: boolean;
  }

  function startTurn(): Turn {
    const t: Turn = { chunks: [], bytes: 0, ended: false, live: null, session: null, done: false };
    if (o.geminiKey && ctx.agent.voiceTurn) t.live = openLive(t).catch((e) => {
      o.log(`voice: Gemini Live unavailable (${(e as Error).message.slice(0, 120)}), using on-device`);
      return null;
    });
    return t;
  }

  async function openLive(t: Turn): Promise<Session> {
    const g = await gemini();
    const vt = await ctx.agent.voiceTurn!();
    const byName = new Map(vt.tools.map((x) => [x.name, x]));
    const s = ctx.hub.settings();
    let heard = "";
    let said = "";
    let finished = false;
    const timer = setTimeout(() => close("say that again?"), TURN_TIMEOUT);
    const speak = s.voiceReplies;

    const close = (err?: string) => {
      if (finished) return;
      finished = true;
      t.done = true;
      clearTimeout(timer);
      try {
        session?.close();
      } catch {
        /* already closed */
      }
      if (err || (!said.trim() && !heard.trim())) {
        vt.fail(err ?? "didn't catch that");
        say("help", "say that again?");
      } else vt.finish(heard.trim(), said.trim());
      if (turn === t) turn = null;
    };

    const onmessage = async (m: LiveServerMessage) => {
      const sc = m.serverContent;
      if (sc?.inputTranscription?.text) heard += sc.inputTranscription.text;
      if (sc?.outputTranscription?.text) said += sc.outputTranscription.text;
      if (speak) {
        for (const p of sc?.modelTurn?.parts ?? []) {
          if (p.inlineData?.data && p.inlineData.mimeType?.startsWith("audio/pcm")) {
            const rate = Number(/rate=(\d+)/.exec(p.inlineData.mimeType)?.[1] ?? 24000);
            ctx.hub.bus.broadcast({ type: "play", pcm: p.inlineData.data, rate }, ["local"]);
          }
        }
      }
      if (m.toolCall?.functionCalls?.length) {
        const functionResponses = [];
        for (const c of m.toolCall.functionCalls) {
          const tool = c.name ? byName.get(c.name) : undefined;
          let output: string;
          try {
            output = tool ? await tool.run(c.args ?? {}) : `error: no tool ${c.name}`;
          } catch (e) {
            output = `error: ${(e as Error).message.slice(0, 200)}`;
          }
          vt.thread.log.push({ icon: tool?.kind === "read" ? "search" : "front_hand", text: `${c.name}` });
          functionResponses.push({ id: c.id, name: c.name, response: { output } });
        }
        session?.sendToolResponse({ functionResponses });
      }
      if (sc?.turnComplete) close();
    };

    let session: Session | null = null;
    session = await g.ai.live.connect({
      model: s.voiceModel || DEFAULT_VOICE_MODEL,
      config: {
        responseModalities: [g.audio],
        systemInstruction: `${vt.system}\n\nYou are speaking out loud through a small wall device. Keep answers to one or two short sentences.\n\n${vt.context}`,
        tools: [{ functionDeclarations: vt.tools.map((x) => ({ name: x.name, description: x.description, parametersJsonSchema: x.parameters })) }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (m) => void onmessage(m).catch((e) => o.log(`voice: ${(e as Error).message}`)),
        onerror: (e) => {
          o.log(`voice: Gemini Live error ${(e as ErrorEvent).message ?? ""}`);
          close("voice assistant error");
        },
        onclose: () => close(),
      },
    });
    // Send what was said while the connection was opening.
    if (finished) {
      session.close();
      return session;
    }
    for (const c of t.chunks) session.sendRealtimeInput({ audio: { data: c.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    if (t.ended) session.sendRealtimeInput({ audioStreamEnd: true });
    t.session = session;
    return session;
  }

  /** No Gemini: speech → text on the Pi, then the wall screen takes it from there. */
  async function local(t: Turn) {
    const stt = o.stt();
    if (!stt || !t.bytes) {
      say(stt ? "help" : "mic_off", stt ? "say that again?" : "voice isn't set up", stt ? undefined : "RUN SUDO NUDGE KEY GEMINI");
      return;
    }
    const pcm = Buffer.concat(t.chunks);
    const n = Math.floor(pcm.length / 2);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = pcm.readInt16LE(i * 2) / 32768;
    try {
      const text = await stt.transcribe(f, 16000);
      if (text) ctx.hw.input({ kind: "voice", text });
      else say("help", "say that again?");
    } catch (e) {
      o.log(`voice: speech-to-text failed (${(e as Error).message})`);
      say("help", "say that again?");
    }
  }

  return {
    available: () => ({ live: !!o.geminiKey, local: !!o.stt() }),
    audio(b64) {
      if (!ctx.hub.settings().ai) return;
      if (!turn || turn.ended) turn = startTurn();
      const t = turn;
      const buf = Buffer.from(b64, "base64");
      if (t.bytes + buf.length > MAX_BYTES) return;
      t.bytes += buf.length;
      t.chunks.push(buf);
      // Once connected, stream straight through; until then it's buffered and sent on connect.
      if (t.session && !t.done) t.session.sendRealtimeInput({ audio: { data: b64, mimeType: "audio/pcm;rate=16000" } });
    },
    end() {
      const t = turn;
      if (!t || t.ended) return;
      t.ended = true;
      say("progress_activity", "checking", undefined, 30_000);
      if (!t.live) {
        turn = null;
        void local(t);
        return;
      }
      if (t.session) {
        if (!t.done) t.session.sendRealtimeInput({ audioStreamEnd: true });
        return;
      }
      void t.live.then((s) => {
        if (!s) {
          if (turn === t) turn = null;
          void local(t);
        }
      });
    },
  };
}
