// Builds everything the Pi needs into pi-os/deploy/nudge-pi.tar.gz:
//   hub/ (one-file server + playwright-core), screen/, apps/, gpio/, files/, install.sh
// Copy it to the Pi, unpack, `sudo ./install.sh`.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "pi-os/deploy");
const stage = path.join(out, "nudge-pi");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(stage, to), {
  recursive: true,
  filter: (src) => !src.includes("__pycache__"),
});

if (!process.argv.includes("--no-build")) run("npm run build");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "hub/node_modules"), { recursive: true });
for (const f of ["hub.mjs", "hub.mjs.map"]) cp(`pi-hub/dist/${f}`, `hub/${f}`);
fs.writeFileSync(path.join(stage, "hub/package.json"), JSON.stringify({ type: "module", private: true }) + "\n");

// playwright-core is the hub's only runtime dependency that isn't bundled (it loads its own files).
const pw = path.dirname(execSync("node -p \"require.resolve('playwright-core/package.json')\"", { cwd: path.join(root, "pi-hub") }).toString().trim());
fs.cpSync(pw, path.join(stage, "hub/node_modules/playwright-core"), { recursive: true, dereference: true });

cp("pi-screen/dist", "screen");
cp("apps/dist", "apps");
cp("pi-os/gpio", "gpio");
cp("pi-os/files", "files");
cp("pi-os/install.sh", "install.sh");
cp("pi-os/README.md", "README.md");

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
let rev = "";
try { rev = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch {}
fs.writeFileSync(path.join(stage, "VERSION"), `${version}${rev ? "+" + rev : ""}\n`);

const tar = path.join(out, "nudge-pi.tar.gz");
fs.rmSync(tar, { force: true });
execSync(`tar --owner=0 --group=0 -czf nudge-pi.tar.gz nudge-pi`, { cwd: out, stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
const mb = (fs.statSync(tar).size / 1e6).toFixed(1);
console.log(`\n  ✓ ${path.relative(root, tar)}  (${mb} MB)\n\n  On the Pi:  tar xzf nudge-pi.tar.gz && cd nudge-pi && sudo ./install.sh\n`);
