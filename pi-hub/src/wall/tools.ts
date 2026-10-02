import { z } from "zod";
import { tool, type Tool } from "../agent/tools";
import type { Hub } from "../hub";
import type { PersonalIndex } from "../rag/index";
import { listDocs } from "../rag/library";
import type { WallCards } from "./cards";

/**
 * The assistant's way of putting something up on the wall to look at. These only change what the
 * wall shows (nothing leaves the house, nothing is changed), so they don't need a yes.
 */
export function wallTools(hub: Hub, cards: WallCards, index: PersonalIndex | null): Tool[] {
  return [
    tool(
      "show_on_wall",
      "Put something up on the wall screen for the student to look at: 'text' for a longer answer or explanation (a few short paragraphs), 'list' for steps or a checklist, 'info' for one big fact (a time, a score, a date, a temperature). Use it when an answer is too long to say in a line, or when they ask to see something. Keep it tight: the screen is small. Then answer in one short line.",
      z.object({
        style: z.enum(["text", "list", "info"]),
        title: z.string().min(1).max(60).describe("a few words"),
        body: z.string().max(3000).optional().describe("text: the answer, short paragraphs, no markdown"),
        items: z.array(z.string().min(1).max(140)).max(10).optional().describe("list: the steps or items"),
        ordered: z.boolean().optional().describe("list: numbered steps"),
        big: z.string().max(12).optional().describe("info: the big thing, e.g. '14:20' or '7°'"),
        sub: z.string().max(70).optional().describe("info: one small line under it"),
        icon: z.string().max(30).optional().describe("info: a Material Symbols icon name, e.g. 'event', 'schedule'"),
      }),
      "read",
      async (a) => {
        const strip = (s: string) => s.replace(/[*_`#>]+/g, "").trim();
        if (a.style === "list") {
          const items = (a.items ?? []).map(strip).filter(Boolean);
          if (!items.length) return "error: a list needs items";
          cards.show({ kind: "list", title: strip(a.title), items, ordered: !!a.ordered });
        } else if (a.style === "info") {
          if (!a.big) return "error: info needs 'big'";
          cards.show({ kind: "info", title: strip(a.title), big: a.big, sub: a.sub, icon: /^[a-z_]{2,30}$/.test(a.icon ?? "") ? a.icon! : "info" });
        } else {
          if (!a.body?.trim()) return "error: text needs a body";
          cards.show({ kind: "text", title: strip(a.title), body: strip(a.body) });
        }
        return "shown on the wall. Reply with one short line (don't repeat it).";
      },
    ),
    tool(
      "open_document",
      "Open one of the student's own documents (revision guide, syllabus, script, worksheet) on the wall at a page, so they can read it there and turn pages with the keys. Give words from its title, or what the page is about.",
      z.object({
        query: z.string().min(1).max(120).describe("words from the title, or what's on the page"),
        page: z.number().int().min(1).max(2000).optional().describe("a page number, if they said one"),
      }),
      "read",
      async ({ query, page }) => {
        const docs = listDocs(hub);
        if (!docs.length) return "They haven't added any documents yet (phone app → Settings → documents).";
        const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
        const byTitle = docs
          .map((d) => ({ d, n: words.filter((w) => d.title.toLowerCase().includes(w)).length }))
          .filter((x) => x.n > 0 && x.n >= Math.ceil(words.length / 2))
          .sort((a, b) => b.n - a.n || b.d.addedAt - a.d.addedAt)[0]?.d;
        let docId = byTitle?.id ?? null;
        let at = page ?? 1;
        // Not a title: find the page it's talking about.
        if (!docId && index) {
          const hit = (await index.search(query, 8)).find((h) => h.id.startsWith("lib:"));
          if (hit) {
            const [, id, n] = hit.id.split(":");
            docId = id;
            at = page ?? Number(n);
          }
        }
        if (!docId) return `No document matches "${query}". Their documents: ${docs.slice(0, 12).map((d) => d.title).join("; ")}`;
        const shown = cards.openDoc(docId, at);
        if (!shown || shown.card.kind !== "doc") return "That document has no readable text.";
        return `Opened "${shown.card.title}" at ${shown.card.slides ? "slide" : "page"} ${shown.card.page} of ${shown.card.pages} on the wall (keys turn pages). Reply in one short line.`;
      },
    ),
    tool(
      "set_timer",
      "Start a countdown timer on the wall (it shows big, and says when it's done). For focus sessions on homework, don't use this: tasks have their own sessions.",
      z.object({ minutes: z.number().min(0.25).max(180), label: z.string().max(30).optional() }),
      "read",
      async ({ minutes, label }) => {
        const secs = Math.round(minutes * 60);
        cards.show({ kind: "timer", label: (label || "timer").toLowerCase(), secs, endsAt: Date.now() + secs * 1000 });
        return `Timer set for ${fmtSecs(secs)}. Reply in a few words.`;
      },
    ),
  ];
}

export const fmtSecs = (secs: number) => (secs % 60 === 0 ? `${secs / 60} minute${secs === 60 ? "" : "s"}` : secs < 60 ? `${secs} seconds` : `${Math.floor(secs / 60)}m ${secs % 60}s`);

/**
 * "Set a timer for 10 minutes", "cancel the timer": done on the Pi, free and instant.
 * Returns what to say, or null if it isn't one of those.
 */
export function quickWall(cards: WallCards, prompt: string): string | null {
  const q = prompt.toLowerCase().replace(/^(hey |ok |okay )?nudge[,!]?\s*/, "").replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
  if (/^(cancel|stop|clear|end)( the| my)? timer$/.test(q)) {
    const c = cards.current();
    if (c?.card.kind !== "timer") return "no timer running.";
    cards.close();
    return "timer cancelled.";
  }
  if (/^(close|hide|clear)( it| that| the screen| the wall)?$/.test(q)) {
    if (!cards.current()) return null;
    cards.close();
    return "done.";
  }
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, sixty: 60, half: 0.5 };
  const m = /^(?:set |start )?(?:a |an )?timer (?:for )?(\d+(?:\.\d+)?|[a-z]+(?: five)?)(?: and a half)? ?(seconds?|secs?|minutes?|mins?|hours?|hrs?|m|s|h)(?: for (.{1,30}))?$|^(\d+|[a-z]+) ?(seconds?|secs?|minutes?|mins?|m|s) timer(?: for (.{1,30}))?$/.exec(q);
  if (!m) return null;
  const rawN = m[1] ?? m[4];
  const unit = m[2] ?? m[5];
  const n = /^\d/.test(rawN) ? Number(rawN) : words[rawN];
  if (!n) return null;
  const half = /and a half/.test(q) ? 0.5 : 0;
  const mult = /^s/.test(unit) ? 1 : /^h/.test(unit) ? 3600 : 60;
  const secs = Math.round((n + half) * mult);
  if (secs < 5 || secs > 3 * 3600) return "timers go from 5 seconds to 3 hours.";
  const label = (m[3] ?? m[6] ?? "timer").trim();
  cards.show({ kind: "timer", label, secs, endsAt: Date.now() + secs * 1000 });
  return `${fmtSecs(secs)}, starting now.`;
}
