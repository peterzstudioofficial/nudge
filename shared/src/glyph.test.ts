import { describe, expect, it } from "vitest";
import { glyphKey, glyphPlan } from "./glyph";
import type { Ask, Session } from "./model";

const T = 1_000_000;
const sess = (o: Partial<Session>): Session => ({ taskId: "t", state: "running", totalSec: 1500, workedSec: 0, runningSince: T, startedAt: T, breakUntil: null, now: T, ...o });
const ask = (kind: Ask["kind"], status: Ask["status"] = "pending"): Ask => ({ id: "a", kind, line: "", head: "", rows: [], payload: {}, status, threadId: null, createdAt: T, answeredAt: null, answeredBy: null });

describe("glyph lights", () => {
  it("off when nothing's going on", () => {
    expect(glyphPlan({ session: null, asks: [], now: T, zones: 6 })).toEqual({ kind: "off" });
  });
  it("a focus session is a bar of time left, shrinking from the top", () => {
    expect(glyphPlan({ session: sess({}), asks: [], now: T, zones: 6 })).toEqual({ kind: "light", zones: [0, 1, 2, 3, 4, 5] });
    expect(glyphPlan({ session: sess({}), asks: [], now: T + 750_000, zones: 6 })).toEqual({ kind: "light", zones: [3, 4, 5] });
    expect(glyphPlan({ session: sess({}), asks: [], now: T + 1_490_000, zones: 6 })).toEqual({ kind: "light", zones: [5] });
    // one-light phones just stay on
    expect(glyphPlan({ session: sess({}), asks: [], now: T, zones: 0 })).toEqual({ kind: "light", zones: [0] });
  });
  it("time's up: the top pulses to claim it", () => {
    expect(glyphPlan({ session: sess({}), asks: [], now: T + 1_600_000, zones: 6 })).toMatchObject({ kind: "breathe", zones: [0] });
  });
  it("paused keeps a slow pulse at the bottom; a break breathes the whole bar", () => {
    expect(glyphPlan({ session: sess({ state: "paused", runningSince: null, workedSec: 600 }), asks: [], now: T, zones: 6 })).toMatchObject({ kind: "breathe", zones: [5] });
    expect(glyphPlan({ session: sess({ state: "break", runningSince: null, breakUntil: T + 300_000 }), asks: [], now: T, zones: 6 })).toMatchObject({ kind: "breathe", zones: [0, 1, 2, 3, 4, 5], period: 4000 });
  });
  it("something waiting for a held yes wins, but only things that need holding", () => {
    expect(glyphPlan({ session: sess({}), asks: [ask("email")], now: T, zones: 6 })).toMatchObject({ kind: "breathe", zones: [0], period: 1600 });
    expect(glyphPlan({ session: null, asks: [ask("reminder")], now: T, zones: 6 })).toEqual({ kind: "off" });
    expect(glyphPlan({ session: null, asks: [ask("email", "done")], now: T, zones: 6 })).toEqual({ kind: "off" });
  });
  it("keys only change when the picture does", () => {
    const a = glyphPlan({ session: sess({}), asks: [], now: T + 10_000, zones: 6 });
    const b = glyphPlan({ session: sess({}), asks: [], now: T + 20_000, zones: 6 });
    expect(glyphKey(a)).toBe(glyphKey(b));
  });
});
