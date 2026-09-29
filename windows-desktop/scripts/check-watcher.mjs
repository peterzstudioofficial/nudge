// CI (Windows): run the real watcher loop for a few seconds and check it reports the foreground
// window and exits by itself once its parent is gone. Usage: node scripts/check-watcher.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const out = path.join(os.tmpdir(), "nudge-focus.mjs");
await build({ entryPoints: ["src/main/focus.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "silent" });
const { watcherScript, writeControl } = await import("file://" + out);
const control = path.join(os.tmpdir(), "nudge-focus.json");
writeControl(control, true, ["notepad"]);
// A short-lived "parent" so we can check the loop quits when Nudge does.
const parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 6000)"]);
const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", watcherScript(control, parent.pid)]);
let lines = 0, err = "";
ps.stdout.on("data", (d) => (lines += String(d).split("\n").filter((l) => l.split("|").length >= 3).length));
ps.stderr.on("data", (d) => (err += d));
const exited = new Promise((r) => ps.on("exit", r));
const t = await Promise.race([exited.then(() => "exited"), new Promise((r) => setTimeout(() => r("timeout"), 25_000))]);
fs.rmSync(control, { force: true });
console.log({ lines, t, err: err.slice(0, 400) });
if (err.trim() || lines < 2 || t !== "exited") process.exit(1);
