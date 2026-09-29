import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./rules";
import { focusPlan } from "./focus";

describe("smart blocking", () => {
  it("keeps Instagram away always, and opens Pinterest only for art or drama", () => {
    const maths = focusPlan(DEFAULT_SETTINGS, "maths");
    expect(maths.sites).toEqual(expect.arrayContaining(["instagram.com", "pinterest.com"]));
    expect(maths.apps).toEqual(expect.arrayContaining(["instagram", "pinterest"]));
    const art = focusPlan(DEFAULT_SETTINGS, "art");
    expect(art.sites).toContain("instagram.com");
    expect(art.sites).not.toContain("pinterest.com");
    expect(art.apps).not.toContain("pinterest");
    expect(art.allowed.map((a) => a.name)).toContain("pinterest.com");
  });
  it("never blocks what school runs on, even if it's on a list by mistake", () => {
    const p = focusPlan({ blockList: ["https://www.Teams.microsoft.com/x", "sharepoint.com", "churchers.sharepoint.com", "youtube.com"], blockApps: ["Teams.exe", "outlook", "steam"], focusAllow: [] }, null);
    expect(p.sites).toEqual(["youtube.com"]);
    expect(p.apps).toEqual(["steam"]);
  });
});
