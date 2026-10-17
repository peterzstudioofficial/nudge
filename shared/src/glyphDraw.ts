/** Drawing a 5×5 glyph frame by frame. No zod here: the phone and the wall load this. */

/** What the light daemon gets: just enough to draw it. */
export interface GlyphFrame {
  palette: string[];
  frames: string[];
  fps: number;
  loop: boolean;
  fade: boolean;
}

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

/**
 * Wall moments a glyph can take over (Settings → lights): when one happens, the mapped glyph
 * plays instead of the built-in pattern. Never during a focus session.
 */
export const LIGHT_MOMENTS = ["idle", "award", "unlock", "listen", "voice", "alarm", "bag", "timer"] as const;
export type LightMoment = (typeof LIGHT_MOMENTS)[number];
