import { describe, expect, it } from "vitest";
import type { HubMessage } from "@nudge/shared";
import { Db } from "../db";
import { Hub } from "../hub";
import { wakeService } from "./wake";

describe("wake word service", () => {
  const setup = (at = "2026-10-02T16:00:00") => {
    const hub = new Hub(new Db(":memory:"));
    const sent: HubMessage[] = [];
    hub.bus.subscribe({ roles: new Set(["local"]), send: (m) => void sent.push(m) });
    let fed = 0;
    let hear: string | null = null;
    const kws = { feed: () => (fed++, hear), reset: () => {} };
    const w = wakeService({ hub, kws, voiceReady: () => true, log: () => {}, now: () => new Date(at) });
    return { hub, sent, w, fed: () => fed, hear: (x: string | null) => (hear = x) };
  };

  it("listens only when switched on, with the assistant on", () => {
    const { hub, w } = setup();
    expect(w.active()).toBe(false); // off by default
    hub.updateSettings("owner", { wakeWord: true, ai: true });
    expect(w.active()).toBe(true);
    hub.updateSettings("owner", { ai: false });
    expect(w.active()).toBe(false);
  });

  it("is off at night (bedtime to 6am)", () => {
    const late = setup("2026-10-02T23:30:00");
    late.hub.updateSettings("owner", { wakeWord: true, ai: true });
    expect(late.w.active()).toBe(false);
    const early = setup("2026-10-03T05:30:00");
    early.hub.updateSettings("owner", { wakeWord: true, ai: true });
    expect(early.w.active()).toBe(false);
  });

  it("hearing it tells the daemon and the wall once, then cools down", () => {
    const { hub, w, sent, hear } = setup();
    hub.updateSettings("owner", { wakeWord: true, ai: true });
    w.sync();
    expect(sent.some((m) => m.type === "wake-config" && m.on)).toBe(true);
    const chunk = Buffer.alloc(3200).toString("base64");
    hear("nudge");
    w.audio(chunk);
    w.audio(chunk);
    expect(sent.filter((m) => m.type === "wake")).toEqual([{ type: "wake", word: "nudge" }]);
  });

  it("ignores audio when it isn't meant to be listening", () => {
    const { w, fed } = setup();
    w.sync();
    w.audio(Buffer.alloc(3200).toString("base64"));
    expect(fed()).toBe(0);
  });
});
