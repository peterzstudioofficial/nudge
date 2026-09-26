// One command to try the whole thing on your computer, no Pi needed:
//   npm run dev
// Starts the hub with demo data + school fixtures, the wall screen and the apps, with live reload.
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const colours = { hub: 35, screen: 36, apps: 33 };
const kids = [];

function start(name, args) {
  const p = spawn(npm, args, { cwd: root, shell: process.platform === "win32", env: { ...process.env, FORCE_COLOR: "1" } });
  const tag = `\x1b[${colours[name]}m${name.padEnd(6)}\x1b[0m│ `;
  const pipe = (s) => s.on("data", (b) => process.stdout.write(b.toString().replace(/^(?=.)/gm, tag)));
  pipe(p.stdout); pipe(p.stderr);
  p.on("exit", (code) => { if (code) console.log(`${tag}stopped (${code})`); });
  kids.push(p);
}

start("hub", ["run", "dev", "-w", "pi-hub"]);
start("screen", ["run", "dev", "-w", "pi-screen"]);
start("apps", ["run", "dev", "-w", "apps"]);

setTimeout(() => {
  console.log(`
  \x1b[1mNudge dev mode\x1b[0m  (demo data — nothing touches your real school account)

    wall simulator   http://localhost:5173/sim.html     ← the full ND-1 with keys, dial, LEDs
    wall screen      http://localhost:5173/             ← what the Pi shows (resize the window)
    my app           http://localhost:5174/
    notes            http://localhost:5174/notes.html
    parent app       http://localhost:5174/parent.html
    setup            http://localhost:5174/admin.html
    hub API          http://localhost:8787/api/health

  Pair an app with the code the hub prints above (or the wall's Pair screen). Ctrl+C stops everything.
`);
}, 4000);

const stop = () => { for (const k of kids) k.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
