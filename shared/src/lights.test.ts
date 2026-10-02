import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_GLYPHS, findGlyph, Glyph, glyphCell, glyphFrame, glyphFrameAt, LightPack, textGlyph } from "./lights";

describe("lights", () => {
  it("every built-in glyph is valid, with unique names", () => {
    for (const g of BUILTIN_GLYPHS) expect(Glyph.safeParse(g).success, g.name).toBe(true);
    expect(new Set(BUILTIN_GLYPHS.map((g) => g.name)).size).toBe(BUILTIN_GLYPHS.length);
    // every palette index used exists
    for (const g of BUILTIN_GLYPHS) for (const f of g.frames) for (const ch of f) if (ch !== ".") expect(Number(ch) <= g.palette.length, g.name).toBe(true);
  });

  it("packs are checked before anything stores or draws them", () => {
    const ok = LightPack.safeParse({ name: "fx", glyphs: [{ name: "blink", palette: ["#ffffff"], frames: ["11111 ..... 11111 ..... 11111", "....."  .repeat(5)], fps: 2 }] });
    expect(ok.success).toBe(true);
    expect(ok.data!.glyphs[0].frames[0]).toBe("11111.....11111.....11111");
    expect(ok.data!.glyphs[0].loop).toBe(true);
    const bad = [
      { name: "Fx", glyphs: [{ name: "a", palette: ["#fff"], frames: [".".repeat(25)] }] },
      { name: "fx", glyphs: [{ name: "a", palette: ["#ffffff"], frames: [".".repeat(24)] }] },
      { name: "fx", glyphs: [{ name: "a", palette: ["#ffffff"], frames: ["9".repeat(25)] }] },
      { name: "fx", glyphs: [{ name: "a", palette: ["#ffffff"], frames: [".".repeat(25)] }, { name: "a", palette: ["#ffffff"], frames: [".".repeat(25)] }] },
      { name: "fx", glyphs: [{ name: "a", palette: ["#ffffff"], frames: Array(65).fill(".".repeat(25)) }] },
      { name: "fx", glyphs: [{ name: "a", palette: ["#ffffff"], frames: [".".repeat(25)], fps: 500 }] },
    ];
    for (const b of bad) expect(LightPack.safeParse(b).success).toBe(false);
  });

  it("the example pack in the docs is valid", () => {
    const raw = readFileSync(new URL("../../docs/lights-example.json", import.meta.url), "utf8");
    const r = LightPack.safeParse(JSON.parse(raw));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it("finds built-ins and pack glyphs", () => {
    const pack = LightPack.parse({ name: "fx", glyphs: [{ name: "boom", palette: ["#ffffff"], frames: ["1".repeat(25)] }] });
    expect(findGlyph("heart", [])?.name).toBe("heart");
    expect(findGlyph("fx/boom", [pack])?.name).toBe("boom");
    expect(findGlyph("fx/nope", [pack])).toBeNull();
    expect(findGlyph("nope", [])).toBeNull();
  });

  it("scrolls text across the matrix", () => {
    const g = textGlyph("hi");
    // 5 blank + H(3) + gap + I(3) + gap + 4 blank = 17 columns → 13 windows
    expect(g.frames.length).toBe(13);
    expect(g.frames[0]).toBe(".".repeat(25));
    // fully on screen: H at columns 0-2, I at 4 (window starting at column 5)
    expect(g.frames[5].slice(0, 5)).toBe("1.1.1");
    expect(g.loop).toBe(false);
    expect(Glyph.safeParse({ ...g, frames: g.frames.slice(0, 64) }).success).toBe(true);
  });

  it("plays frames at its own speed", () => {
    const g = glyphFrame(findGlyph("spinner", [])!);
    expect(glyphFrameAt(g, 0)).toBe(0);
    expect(glyphFrameAt(g, 150)).toBe(1);
    expect(glyphFrameAt(g, 850)).toBe(0);
    const once = { ...g, loop: false };
    expect(glyphFrameAt(once, 10_000)).toBe(g.frames.length - 1);
    expect(glyphCell(glyphFrame(findGlyph("dot", [])!), 0, 12)).toBe("#ff4d17");
    expect(glyphCell(glyphFrame(findGlyph("dot", [])!), 0, 0)).toBe("");
  });
});
