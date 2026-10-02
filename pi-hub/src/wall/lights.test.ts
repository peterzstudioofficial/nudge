import { describe, expect, it, vi } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";
import { lightTool, lightsService } from "./lights";

const pack = { name: "fx", glyphs: [{ name: "flash", palette: ["#ffffff"], frames: ["1".repeat(25), ".".repeat(25)], fps: 8 }] };

describe("lights", () => {
  it("packs are checked, stored, capped and removable", () => {
    const hub = new Hub(new Db(":memory:"));
    const l = lightsService({ hub });
    expect(l.addPack(pack).glyphs[0].loop).toBe(true);
    expect(() => l.addPack({ name: "bad", glyphs: [{ name: "x", palette: ["red"], frames: ["1"] }] })).toThrow(/isn't right/);
    for (let i = 0; i < 9; i++) l.addPack({ ...pack, name: `p${i}` });
    expect(() => l.addPack({ ...pack, name: "one-too-many" })).toThrow(/10 packs/);
    l.addPack(pack); // replacing one is fine
    expect(l.removePack("p0")).toBe(true);
    expect(l.removePack("p0")).toBe(false);
    expect(l.packs()).toHaveLength(9);
  });

  it("plays a glyph or scrolls text, then stops on its own", () => {
    vi.useFakeTimers();
    try {
      const hub = new Hub(new Db(":memory:"));
      const l = lightsService({ hub });
      l.addPack(pack);
      expect(l.play({ ref: "fx/flash", secs: 3 })).toEqual({ name: "fx/flash", secs: 3 });
      expect(l.snapshot().playing?.glyph.fps).toBe(8);
      vi.advanceTimersByTime(3100);
      expect(l.snapshot().playing).toBeNull();
      expect(l.play({ text: "go" }).name).toBe('"go"');
      expect(() => l.play({ ref: "nope" })).toThrow(/no glyph/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("wall moments use the glyphs picked in settings", () => {
    const hub = new Hub(new Db(":memory:"));
    const l = lightsService({ hub });
    l.addPack(pack);
    hub.updateSettings("owner", { lightMap: { award: "fx/flash", idle: "heart", alarm: "fx/missing" } });
    const m = l.snapshot().moments;
    expect(m.award?.frames).toHaveLength(2);
    expect(m.idle?.palette[0]).toBe("#ff4d17");
    expect(m.alarm).toBeUndefined();
  });

  it("the assistant's tool lists what it can play", async () => {
    const hub = new Hub(new Db(":memory:"));
    const l = lightsService({ hub });
    const t = lightTool(l);
    expect(t.description).toContain("heart");
    expect(await t.run({ glyph: "heart" })).toContain("Playing heart");
    expect(await t.run({ glyph: "nope" })).toContain("error");
  });
});
