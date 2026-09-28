import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HubMessage } from "@nudge/shared";
import { Db } from "../db";
import { Hub } from "../hub";
import { spend } from "../agent/spend";
import { ttsService, type SynthFn } from "./tts";

describe("read-out answers", () => {
  const setup = () => {
    const hub = new Hub(new Db(":memory:"));
    const played: HubMessage[] = [];
    hub.bus.subscribe({ roles: new Set(["local"]), send: (m) => void (m.type === "play" && played.push(m)) });
    const calls: string[] = [];
    const synth: SynthFn = async ({ voice, text }) => (calls.push(`${voice}:${text}`), Buffer.alloc(48000)); // 1 s of audio
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
    return { hub, played, calls, tts: ttsService({ hub, synth, dir, log: () => {} }) };
  };

  it("stays quiet unless spoken replies are on", async () => {
    const { hub, tts, calls } = setup();
    hub.updateSettings("owner", { ai: true, voiceReplies: false });
    expect(await tts.speak("week a.")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("uses the live voice, and pays for each phrase once", async () => {
    const { hub, tts, calls, played } = setup();
    hub.updateSettings("owner", { ai: true, voiceReplies: true, voiceName: "Kore" });
    expect(await tts.speak("Week A.")).toBe(true);
    expect(await tts.speak("week a.")).toBe(true);
    expect(calls).toEqual(["Kore:Week A."]);
    expect(played).toHaveLength(2);
    expect(spend(hub).usd).toBeGreaterThan(0);
    expect(spend(hub).usd).toBeLessThan(0.001);
  });

  it("stops at the monthly budget", async () => {
    const { hub, tts, calls } = setup();
    hub.updateSettings("owner", { ai: true, voiceReplies: true, aiBudgetUsd: 0.5 });
    hub.db.kvSet("aiSpend", { [hub.todayKey().slice(0, 7)]: 0.5 });
    expect(await tts.speak("hello")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
