import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blockedApp, writeControl } from "./focus";

describe("blocking apps during a session", () => {
  const apps = ["steam", "Discord.exe", "netflix"];
  it("blocks listed apps only while a session runs", () => {
    expect(blockedApp({ process: "steam", title: "Steam" }, apps, true)).toBe("steam");
    expect(blockedApp({ process: "discord", title: "#general" }, apps, true)).toBe("discord");
    expect(blockedApp({ process: "steam", title: "Steam" }, apps, false)).toBeNull();
    expect(blockedApp({ process: "winword", title: "essay.docx" }, apps, true)).toBeNull();
  });
  it("catches Store apps, which all run inside ApplicationFrameHost", () => {
    expect(blockedApp({ process: "applicationframehost", title: "Netflix" }, apps, true)).toBe("netflix");
    expect(blockedApp({ process: "applicationframehost", title: "Calculator" }, apps, true)).toBeNull();
  });
  it("never blocks Nudge itself or the desktop", () => {
    expect(blockedApp({ process: "nudge", title: "x" }, ["nudge"], true)).toBeNull();
    expect(blockedApp({ process: "explorer", title: "x" }, ["explorer"], true)).toBeNull();
  });
  it("writes a control file that expires, with safe names only", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nudge-")), "focus.json");
    writeControl(f, true, ["Steam.exe", "steam", "explorer", "bad'name", "roblox player"], 1000);
    expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({ active: true, apps: ["steam", "roblox player"], until: 91_000 });
  });
});
