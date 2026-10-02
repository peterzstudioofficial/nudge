import { BUILTIN_GLYPHS, findGlyph, glyphFrame, LightPack, LIGHT_MOMENTS, textGlyph, type Glyph, type GlyphFrame, type LightMoment, type Snapshot } from "@nudge/shared";
import { z } from "zod";
import { tool, type Tool } from "../agent/tools";
import { HttpError } from "../errors";
import type { Hub } from "../hub";

/**
 * The 5×5 lights' content: built-in glyphs, packs added from the phone or the computer, and
 * whatever is playing right now. Packs are checked (LightPack) before they're stored; at most
 * ten, so the wall never fills up.
 */
export interface Lights {
  packs(): LightPack[];
  addPack(raw: unknown): LightPack;
  removePack(name: string): boolean;
  /** play a glyph ("heart", "pack/name") or scroll some text, for a few seconds */
  play(o: { ref?: string; text?: string; secs?: number }): { name: string; secs: number };
  stop(): void;
  snapshot(): Snapshot["lights"];
}

const KEY = "lightPacks";
const MAX_PACKS = 10;

export function lightsService(o: { hub: Hub; now?: () => number }): Lights {
  const { hub } = o;
  const now = o.now ?? (() => Date.now());
  let playing: { name: string; glyph: GlyphFrame; until: number } | null = null;
  let timer: NodeJS.Timeout | null = null;
  const packs = () => hub.db.kvGet<LightPack[]>(KEY, []);

  const svc: Lights = {
    packs,
    addPack(raw) {
      const r = LightPack.safeParse(raw);
      if (!r.success) throw new HttpError(400, `that pack isn't right: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`.slice(0, 300));
      const list = packs().filter((p) => p.name !== r.data.name);
      if (list.length >= MAX_PACKS) throw new HttpError(409, `${MAX_PACKS} packs is the most; remove one first`);
      hub.db.kvSet(KEY, [...list, r.data]);
      hub.bus.changed("lights");
      return r.data;
    },
    removePack(name) {
      const list = packs();
      if (!list.some((p) => p.name === name)) return false;
      hub.db.kvSet(KEY, list.filter((p) => p.name !== name));
      hub.bus.changed("lights");
      return true;
    },
    play({ ref, text, secs }) {
      let g: Glyph | null = null;
      if (text?.trim()) g = textGlyph(text.trim());
      else if (ref) g = findGlyph(ref, packs());
      if (!g) throw new HttpError(404, `no glyph called "${ref ?? ""}"`);
      const f = glyphFrame(g);
      // Text plays once through; anything else for the time asked (2 to 60 seconds).
      const runs = text ? (f.frames.length / f.fps) * 1000 + 400 : Math.min(60, Math.max(2, secs ?? 6)) * 1000;
      playing = { name: text ? `"${text.trim().slice(0, 24)}"` : ref!, glyph: f, until: now() + runs };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => svc.stop(), runs);
      timer.unref();
      hub.bus.changed("lights");
      return { name: playing.name, secs: Math.round(runs / 1000) };
    },
    stop() {
      if (!playing) return;
      playing = null;
      hub.bus.changed("lights");
    },
    snapshot() {
      if (playing && playing.until <= now()) playing = null;
      const map = hub.settings().lightMap ?? {};
      const moments: Partial<Record<LightMoment, GlyphFrame>> = {};
      for (const m of LIGHT_MOMENTS) {
        const ref = map[m];
        const g = ref ? findGlyph(ref, packs()) : null;
        if (g) moments[m] = glyphFrame(g);
      }
      return { playing, moments };
    },
  };
  return svc;
}

/** The assistant can light the matrix up ("show me a heart", "spell out GO"). Nothing else. */
export function lightTool(lights: Lights): Tool {
  return tool(
    "light_up",
    `Play something on the wall's 5×5 lights for a few seconds: a glyph by name, or a short word scrolling across. Built-in glyphs: ${BUILTIN_GLYPHS.map((g) => g.name).join(", ")}${lights.packs().length ? `; from their packs: ${lights.packs().flatMap((p) => p.glyphs.map((g) => `${p.name}/${g.name}`)).slice(0, 30).join(", ")}` : ""}. Only when they ask for it, or to celebrate something they did.`,
    z.object({
      glyph: z.string().max(50).optional(),
      text: z.string().max(24).optional().describe("a short word to scroll instead of a glyph"),
      seconds: z.number().min(2).max(30).optional(),
    }),
    "read",
    async ({ glyph, text, seconds }) => {
      try {
        const r = lights.play({ ref: glyph, text, secs: seconds });
        return `Playing ${r.name} on the lights for ${r.secs}s. Reply in a few words.`;
      } catch (e) {
        return `error: ${(e as Error).message}`;
      }
    },
  );
}
