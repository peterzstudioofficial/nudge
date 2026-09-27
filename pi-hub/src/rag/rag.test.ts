import { describe, expect, it } from "vitest";
import { Db } from "../db";
import { Hub } from "../hub";
import { loadEmbedder } from "./embed";
import { PersonalIndex } from "./index";

function seeded() {
  const hub = new Hub(new Db(":memory:"), { clock: () => new Date(2026, 8, 28, 17).getTime() });
  hub.addNote({ kind: "note", label: "song idea", body: "chorus in D, slower second verse", tags: ["music"], secs: 0 });
  hub.addNote({ kind: "note", label: "chem revision", body: "le chatelier, titration practical write-up", tags: [], secs: 0 });
  hub.setActivities([{ id: "r", name: "senior production rehearsal", days: [1, 3], start: "16:00", end: "18:00", where: "DBA", termOnly: true }]);
  hub.setBirthdays([{ name: "Genna", date: "09-17" }]);
  hub.events.put({ id: "e1", date: "2027-01-05", time: null, title: "5th Year Mock Exams begin", tags: ["exam"], source: "calendar" });
  return hub;
}

describe("private search", () => {
  it("finds things by keyword with no model installed", async () => {
    const idx = new PersonalIndex(seeded());
    expect((await idx.search("when do mock exams start"))[0].title).toBe("5th Year Mock Exams begin");
    expect((await idx.search("rehearsal"))[0].kind).toBe("weekly commitment");
    expect((await idx.search("genna"))[0].kind).toBe("birthday");
    expect(idx.semantic).toBe(false);
  });

  it("notices changes", async () => {
    const hub = seeded();
    const idx = new PersonalIndex(hub);
    await idx.search("x");
    hub.addNote({ kind: "note", label: "costume list", body: "black shirt, braces", tags: [], secs: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect((await idx.search("costume"))[0].title).toBe("costume list");
  });

  // Runs when a MiniLM model folder is available (NUDGE_TEST_EMBED=/path/with/model.onnx+tokenizer.json).
  it.skipIf(!process.env.NUDGE_TEST_EMBED)("matches by meaning with the on-device model", async () => {
    const e = await loadEmbedder(process.env.NUDGE_TEST_EMBED!, () => {});
    const idx = new PersonalIndex(seeded(), e);
    const hits = await idx.search("that tune I was writing");
    expect(hits[0].title).toBe("song idea");
    expect(idx.semantic).toBe(true);
  });
});
