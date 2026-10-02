import { describe, expect, it, vi } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";
import { PersonalIndex } from "../rag/index";
import { addDoc } from "../rag/library";
import { wallCards } from "./cards";
import { quickWall, wallTools } from "./tools";

const text = (s: string) => new TextEncoder().encode(s);

describe("wall cards", () => {
  it("shows one card at a time, keeps it across a restart, and lets it go on its own", () => {
    vi.useFakeTimers();
    try {
      const hub = new Hub(new Db(":memory:"));
      const said: string[] = [];
      const cards = wallCards({ hub, say: (_i, l) => said.push(l) });
      cards.show({ kind: "list", title: "pack", items: ["pe kit", "script"] });
      const t = cards.show({ kind: "timer", label: "tea", secs: 60, endsAt: Date.now() + 60_000 });
      expect(cards.current()?.id).toBe(t.id);
      // a restart brings it back
      expect(wallCards({ hub, say: () => {} }).current()?.id).toBe(t.id);
      vi.advanceTimersByTime(61_000);
      expect(said).toEqual(["time's up"]);
      expect(cards.current()).toBeNull();
      // anything else leaves after ten quiet minutes
      cards.show({ kind: "info", icon: "event", title: "mock", big: "14 Nov" });
      vi.advanceTimersByTime(9 * 60_000);
      cards.page(0);
      vi.advanceTimersByTime(9 * 60_000);
      expect(cards.current()).not.toBeNull();
      vi.advanceTimersByTime(2 * 60_000);
      expect(cards.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a document at a page and turns pages within it", async () => {
    const hub = new Hub(new Db(":memory:"));
    const cards = wallCards({ hub, say: () => {} });
    const doc = await addDoc(hub, { name: "Chemistry guide.txt", mime: "text/plain", data: text("Equilibrium shifts to oppose a change.") });
    const s = cards.openDoc(doc.id, 9)!;
    expect(s.card).toMatchObject({ kind: "doc", page: 1, pages: 1, title: "Chemistry guide" });
    expect(cards.page(1)?.card).toMatchObject({ page: 1 });
    expect(cards.openDoc("nope", 1)).toBeNull();
  });

  it("the assistant's tools put things up, and find documents by title or by what's on the page", async () => {
    const hub = new Hub(new Db(":memory:"));
    const cards = wallCards({ hub, say: () => {} });
    await addDoc(hub, { name: "Oliver script.txt", mime: "text/plain", data: text("Fagin counts his treasure while the boys sleep.") });
    const tools = Object.fromEntries(wallTools(hub, cards, new PersonalIndex(hub)).map((t) => [t.name, t]));
    expect(await tools.show_on_wall.run({ style: "list", title: "**steps**", items: ["one", "two"], ordered: true })).toContain("shown");
    expect(cards.current()?.card).toMatchObject({ kind: "list", title: "steps", ordered: true });
    expect(await tools.show_on_wall.run({ style: "info", title: "x" })).toContain("error");
    expect(await tools.open_document.run({ query: "oliver" })).toContain('Opened "Oliver script"');
    expect(await tools.open_document.run({ query: "fagin treasure" })).toContain("Oliver script");
    expect(await tools.open_document.run({ query: "physics" })).toContain("No document matches");
    expect(await tools.set_timer.run({ minutes: 5, label: "Tea" })).toContain("5 minutes");
    expect(cards.current()?.card).toMatchObject({ kind: "timer", label: "tea", secs: 300 });
  });

  it("timers by voice are done on the Pi, for free", () => {
    const hub = new Hub(new Db(":memory:"));
    const cards = wallCards({ hub, say: () => {} });
    expect(quickWall(cards, "nudge, set a timer for 10 minutes")).toBe("10 minutes, starting now.");
    expect(cards.current()?.card).toMatchObject({ kind: "timer", secs: 600 });
    expect(quickWall(cards, "timer for two and a half minutes")).toBe("2m 30s, starting now.");
    expect(quickWall(cards, "5 minute timer for pasta")).toBe("5 minutes, starting now.");
    expect(cards.current()?.card).toMatchObject({ label: "pasta" });
    expect(quickWall(cards, "set a timer for 30 seconds")).toBe("30 seconds, starting now.");
    expect(quickWall(cards, "cancel the timer")).toBe("timer cancelled.");
    expect(quickWall(cards, "cancel the timer")).toBe("no timer running.");
    expect(quickWall(cards, "timer for 9 hours")).toContain("3 hours");
    expect(quickWall(cards, "what's a timer for")).toBeNull();
    expect(quickWall(cards, "explain how timers work in javascript")).toBeNull();
  });
});
