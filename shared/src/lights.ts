import { z } from "zod";

/**
 * Content for the 5×5 light matrix.
 *
 * A glyph is a few 5×5 frames drawn with a small palette: each frame is 25 characters, row by row,
 * "." for off and "1"–"8" for a palette colour. The wall sends the whole glyph to the light daemon
 * once and the Pi animates it by itself (so nothing streams, and a still glyph costs nothing).
 *
 * Packs are how new content plugs in: a JSON file of glyphs, added from the phone (or by Claude on
 * the computer), checked here before anything stores or draws it.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colours are #rrggbb");
const frame = z
  .string()
  .transform((s) => s.replace(/[\s|/]/g, ""))
  .pipe(z.string().regex(/^[.1-8]{25}$/, "a frame is 25 cells of . or 1-8"));

export const Glyph = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/, "names are lowercase, a-z 0-9 and -"),
  palette: z.array(hex).min(1).max(8),
  frames: z.array(frame).min(1).max(64),
  /** frames per second (a single frame ignores it) */
  fps: z.number().min(0.2).max(20).default(4),
  loop: z.boolean().default(true),
  /** blend each frame into the next instead of cutting */
  fade: z.boolean().default(false),
});
export type Glyph = z.infer<typeof Glyph>;

export const LightPack = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/),
    by: z.string().max(40).optional(),
    glyphs: z.array(Glyph).min(1).max(40),
  })
  .refine((p) => new Set(p.glyphs.map((g) => g.name)).size === p.glyphs.length, "glyph names must be different");
export type LightPack = z.infer<typeof LightPack>;

/** What the light daemon gets: just enough to draw it. */
export interface GlyphFrame {
  palette: string[];
  frames: string[];
  fps: number;
  loop: boolean;
  fade: boolean;
}
export const glyphFrame = (g: Glyph): GlyphFrame => ({ palette: g.palette, frames: g.frames, fps: g.fps, loop: g.loop, fade: g.fade });

/** The colour of a cell at frame `f` ("" for off). */
export function glyphCell(g: GlyphFrame, f: number, i: number): string {
  const ch = g.frames[f % g.frames.length][i];
  return ch === "." ? "" : g.palette[Number(ch) - 1] ?? "";
}

/** Which frame is showing `ms` after it started (the last one stays up if it doesn't loop). */
export function glyphFrameAt(g: GlyphFrame, ms: number): number {
  if (g.frames.length < 2) return 0;
  const n = Math.floor((ms / 1000) * g.fps);
  return g.loop ? n % g.frames.length : Math.min(n, g.frames.length - 1);
}

/* ---------------------------------- text ---------------------------------- */

/** A 3×5 font: each character is 5 rows of 3 cells. */
const FONT: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111", " ": "000000000000000", "!": "010010010000010", "?": "110001010000010", ".": "000000000000010",
  ":": "000010000010000", "-": "000000111000000", "+": "000010111010000", "'": "010010000000000", "%": "101001010100101",
  "<": "001010100010001", ">": "100010001010100", "/": "001001010100100", "#": "101111101111101",
};

/** Scrolling text, right to left, in one colour. Unknown characters are skipped. */
export function textGlyph(text: string, colour = "#ff4d17", fps = 9): Glyph {
  const chars = [...text.toUpperCase()].filter((c) => FONT[c]).slice(0, 40);
  const cols: number[][] = []; // each column: 5 cells, top to bottom
  const blank = () => cols.push([0, 0, 0, 0, 0]);
  for (let k = 0; k < 5; k++) blank();
  for (const c of chars) {
    const bits = FONT[c];
    const w = c === " " ? 2 : 3;
    for (let x = 0; x < w; x++) cols.push([0, 1, 2, 3, 4].map((y) => Number(bits[y * 3 + x])));
    blank();
  }
  for (let k = 0; k < 4; k++) blank();
  const frames: string[] = [];
  for (let start = 0; start + 5 <= cols.length; start++) {
    let f = "";
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) f += cols[start + x][y] ? "1" : ".";
    frames.push(f);
  }
  return { name: "text", palette: [colour], frames: frames.length ? frames : [".".repeat(25)], fps, loop: false, fade: false };
}

/* -------------------------------- built in -------------------------------- */

const O = "#ff4d17"; // the Nudge orange
const W = "#f4f3ef"; // warm white
const D = "#5a1a08"; // orange, dimmed
const B = "#3b82f6"; // rain blue
const Y = "#ffb020"; // sun yellow

const g = (name: string, palette: string[], fps: number, frames: string[][], o: { loop?: boolean; fade?: boolean } = {}): Glyph => ({
  name, palette, fps, frames: frames.map((rows) => rows.join("")), loop: o.loop ?? true, fade: o.fade ?? false,
});

/** The 16 edge cells, clockwise from the top-left. */
const EDGE = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];

/** A bright head chasing round the edge, with a dim tail. */
function spinner(): Glyph {
  const frames = Array.from({ length: 8 }, (_, f) => {
    const cells = Array<string>(25).fill(".");
    for (let k = 0; k < 4; k++) cells[EDGE[(f * 2 - k + 16) % 16]] = k < 2 ? "1" : "2";
    return cells.join("");
  });
  return { name: "spinner", palette: [O, D], fps: 10, frames, loop: true, fade: false };
}

/** A sine wave rolling across. */
function wave(): Glyph {
  const frames = Array.from({ length: 8 }, (_, f) => {
    const cells = Array<string>(25).fill(".");
    for (let x = 0; x < 5; x++) {
      const y = Math.round(2 - 2 * Math.sin(((x + f) * 2 * Math.PI) / 8));
      cells[y * 5 + x] = "1";
      if (y < 4) cells[(y + 1) * 5 + x] = "2";
    }
    return cells.join("");
  });
  return { name: "wave", palette: [O, D], fps: 8, frames, loop: true, fade: false };
}

/** Icons and little animations that come with Nudge. */
export const BUILTIN_GLYPHS: Glyph[] = [
  g("check", [O], 1, [[".....", "....1", "...1.", "1.1..", ".1..."]]),
  g("cross", [O], 1, [["1...1", ".1.1.", "..1..", ".1.1.", "1...1"]]),
  g("heart", [O, D], 1.6, [[".1.1.", "11111", "11111", ".111.", "..1.."], [".....", ".1.1.", ".111.", "..1..", "....."]], { fade: true }),
  g("star", [Y, O], 2, [["..1..", ".111.", "11111", ".1.1.", "1...1"], ["..2..", ".222.", "22222", ".2.2.", "2...2"]], { fade: true }),
  g("smile", [O], 1, [[".....", ".1.1.", ".....", "1...1", ".111."]]),
  g("note", [O], 1, [["..111", "..1.1", "..1.1", "111.1", "11.11"]]),
  g("bolt", [Y], 1, [["...1.", "..1..", ".111.", "..1..", ".1..."]]),
  g("moon", [W], 1, [[".111.", "11...", "11...", "11...", ".111."]]),
  g("sun", [Y, O], 1.5, [["1.1.1", ".222.", "12221", ".222.", "1.1.1"], [".1.1.", "12221", ".222.", "12221", ".1.1."]], { fade: true }),
  g("rain", [W, B], 6, [
    ["111..", "11111", "..2..", "2...2", ".2..."],
    ["111..", "11111", "2..2.", ".2...", "...2."],
    ["111..", "11111", ".2..2", "...2.", "2...."],
  ]),
  g("film", [W, O], 1, [["1.1.1", "22222", "2...2", "2...2", "22222"]]),
  g("mic", [O, W], 1, [[".111.", ".111.", ".111.", "2...2", ".222."]]),
  g("bell", [Y], 3, [["..1..", ".111.", ".111.", "11111", "..1.."], ["...1.", "..111", "..111", ".1111", "..1.."], ["..1..", ".111.", ".111.", "11111", "..1.."], [".1...", "111..", "111..", "1111.", "..1.."]]),
  g("mail", [W], 1, [[".....", "11111", "11.11", "1.1.1", "11111"]]),
  g("book", [O, W], 1, [["11.11", "12.21", "12.21", "11.11", "....."]]),
  g("up", [O], 1, [["..1..", ".111.", "1.1.1", "..1..", "..1.."]]),
  g("down", [O], 1, [["..1..", "..1..", "1.1.1", ".111.", "..1.."]]),
  g("hourglass", [W, O], 2, [
    ["11111", ".222.", "..2..", ".1.1.", "11111"],
    ["11111", ".1.1.", "..2..", ".222.", "11111"],
    ["11111", ".1.1.", "..1..", ".222.", "12221"],
  ]),
  spinner(),
  g("pulse", [O, D], 5, [
    [".....", ".....", "..1..", ".....", "....."],
    [".....", ".111.", ".1.1.", ".111.", "....."],
    ["11111", "1...1", "1...1", "1...1", "11111"],
    ["22222", "2...2", "2...2", "2...2", "22222"],
    [".....", ".....", ".....", ".....", "....."],
  ]),
  g("eq", [O, Y], 6, [
    [".....", "...1.", ".1.1.", "11.11", "11111"],
    [".1...", ".1...", ".1.1.", "11111", "11111"],
    ["....1", "..1.1", "1.1.1", "11111", "11111"],
    [".....", "1..1.", "1.11.", "11111", "11111"],
  ]),
  wave(),
  g("sparkle", [W, O], 5, [
    ["1....", "...2.", ".....", ".2...", "....1"],
    ["...1.", ".2...", "....2", "1....", "..1.."],
    [".2...", "....1", "..1..", "...2.", "1...."],
  ], { fade: true }),
  g("fire", [Y, O, D], 7, [
    ["..3..", ".323.", ".212.", "32123", ".222."],
    [".3...", "..23.", ".2123", "32122", ".222."],
    ["...3.", ".32..", "3212.", "22123", ".222."],
  ]),
  g("cake", [W, O, Y], 2, [["3.3.3", "1.1.1", "22222", "11111", "22222"], [".3.3.", "1.1.1", "22222", "11111", "22222"]]),
  g("dot", [O], 1, [[".....", ".....", "..1..", ".....", "....."]]),
];

/** Built-ins by name, then "pack/name" from packs. */
export function findGlyph(ref: string, packs: LightPack[]): Glyph | null {
  const [a, b] = ref.toLowerCase().split("/");
  if (b) return packs.find((p) => p.name === a)?.glyphs.find((x) => x.name === b) ?? null;
  return BUILTIN_GLYPHS.find((x) => x.name === a) ?? null;
}

/**
 * Wall moments a glyph can take over (Settings → lights): when one happens, the mapped glyph
 * plays instead of the built-in pattern. Never during a focus session.
 */
export const LIGHT_MOMENTS = ["idle", "award", "unlock", "listen", "voice", "alarm", "bag", "timer"] as const;
export type LightMoment = (typeof LIGHT_MOMENTS)[number];
