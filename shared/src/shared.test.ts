import { describe, expect, it } from "vitest";
import {
  bankFor, canBreak, canClaim, canSkip, CHURCHERS_2026_27, classifySchoolText, parseDue, searchNotes,
  sessionView, sortTasks, termInfo,
} from "./index";

describe("term dates", () => {
  it("knows autumn 2026 school days, half term and weekends", () => {
    expect(termInfo("2026-09-09", CHURCHERS_2026_27).kind).toBe("school");
    expect(termInfo("2026-09-12", CHURCHERS_2026_27).kind).toBe("weekend");
    expect(termInfo("2026-10-26", CHURCHERS_2026_27).kind).toBe("halfterm");
    expect(termInfo("2026-12-21", CHURCHERS_2026_27).kind).toBe("holiday");
    expect(termInfo("2026-09-08", CHURCHERS_2026_27).confirmed).toBe(true);
    expect(termInfo("2027-01-12", CHURCHERS_2026_27).confirmed).toBe(true);
    expect(termInfo("2027-03-22", CHURCHERS_2026_27).kind).toBe("holiday");
    expect(termInfo("2027-04-12", CHURCHERS_2026_27).kind).toBe("school");
  });
});

describe("rules", () => {
  it("never lets points go down", () => {
    expect(bankFor(10, 30)).toBe(0);
    expect(bankFor(64, 60)).toBe(4);
  });
  it("guards claim, break and skip", () => {
    expect(canClaim(30, 1500).ok).toBe(false);
    expect(canClaim(61, 1500).ok).toBe(true);
    const b = canBreak(120);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.line).toBe("break in 3 min");
    expect(canSkip(2, { skipsPerDay: 2 }).ok).toBe(false);
  });
  it("computes a running session", () => {
    const now = 1_000_000;
    const v = sessionView(
      { taskId: "t", state: "running", totalSec: 1500, workedSec: 100, runningSince: now - 50_000, startedAt: 0, breakUntil: null, now },
      now,
    );
    expect(v.worked).toBe(150);
    expect(v.remaining).toBe(1350);
    expect(v.claimReady).toBe(false);
  });
  it("sorts tasks by phase", () => {
    const s = sortTasks([
      { phase: "bag", order: 0 },
      { phase: "home", order: 2 },
      { phase: "study", order: 1 },
      { phase: "home", order: 1 },
    ] as const as { phase: "bag" | "home" | "study"; order: number }[]);
    expect(s.map((x) => x.phase + x.order)).toEqual(["home1", "home2", "study1", "bag0"]);
  });
});

describe("school text", () => {
  const fri = new Date(2026, 8, 25, 16, 0); // Fri 25 Sep 2026
  it("finds due dates", () => {
    expect(parseDue("the write-up is due Monday", fri)).toBe("2026-09-28");
    expect(parseDue("hand in by 2 October", fri)).toBe("2026-10-02");
    expect(parseDue("tomorrow please", fri)).toBe("2026-09-26");
  });
  it("classifies bring requests", () => {
    const c = classifySchoolText("Chemistry", "Please bring your chemistry book on Monday.", fri);
    expect(c.kind).toBe("bring");
    expect(c.subject).toBe("chem");
    expect(c.bring[0]).toContain("chemistry book");
  });
  it("classifies homework", () => {
    expect(classifySchoolText("Maths prep", "Exercise 12, questions 1-8", fri).kind).toBe("homework");
  });
});

describe("notes search", () => {
  it("returns direct hits then context neighbours", () => {
    const items = [
      { label: "riff", body: "", tags: ["music", "riff"] },
      { label: "song idea", body: "", tags: ["song"] },
      { label: "kit list", body: "", tags: ["school"] },
    ];
    expect(searchNotes(items, "song").map((i) => i.label)).toEqual(["song idea", "riff"]);
  });
});
