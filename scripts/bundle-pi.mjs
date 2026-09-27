// Builds everything the Pi needs into pi-os/deploy/nudge-pi.tar.gz (NUDGE_ARCH=x64 → nudge-pi-x64.tar.gz, for testing on a PC):
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
// hub.mjs plus the chunks it loads on demand (source map for the main file only)
fs.cpSync(path.join(root, "pi-hub/dist"), path.join(stage, "hub"), { recursive: true, filter: (f) => !(f.includes("/chunks/") && f.endsWith(".map")) });
fs.writeFileSync(path.join(stage, "hub/package.json"), JSON.stringify({ type: "module", private: true }) + "\n");

// Runtime dependencies that load their own files, so aren't bundled.
// Where a package is installed (walks up from pi-hub like Node does; some packages don't export package.json).
const pkgDir = (name) => {
  for (let d = path.join(root, "pi-hub"); ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules", name);
    if (fs.existsSync(path.join(p, "package.json"))) return fs.realpathSync(p);
    if (d === path.dirname(d)) throw new Error(`${name} isn't installed`);
  }
};
fs.cpSync(pkgDir("playwright-core"), path.join(stage, "hub/node_modules/playwright-core"), { recursive: true, dereference: true });
// pdf.js: only the Node build (reads the school calendar PDF).
const pdfjs = pkgDir("pdfjs-dist");
fs.mkdirSync(path.join(stage, "hub/node_modules/pdfjs-dist/legacy"), { recursive: true });
fs.cpSync(path.join(pdfjs, "package.json"), path.join(stage, "hub/node_modules/pdfjs-dist/package.json"));
fs.cpSync(path.join(pdfjs, "LICENSE"), path.join(stage, "hub/node_modules/pdfjs-dist/LICENSE"));
fs.cpSync(path.join(pdfjs, "legacy/build"), path.join(stage, "hub/node_modules/pdfjs-dist/legacy/build"), { recursive: true, filter: (f) => !f.endsWith(".map") });

// On-device AI runtimes, Linux only, for the Pi's CPU (arm64 unless NUDGE_ARCH=x64).
const arch = process.env.NUDGE_ARCH || "arm64";
const nm = path.join(stage, "hub/node_modules");
const ort = pkgDir("onnxruntime-node");
fs.mkdirSync(path.join(nm, "onnxruntime-node/bin/napi-v6/linux"), { recursive: true });
for (const f of ["package.json", "LICENSE", "dist"]) {
  if (fs.existsSync(path.join(ort, f))) fs.cpSync(path.join(ort, f), path.join(nm, "onnxruntime-node", f), { recursive: true, filter: (x) => !x.endsWith(".map") });
}
fs.cpSync(path.join(ort, `bin/napi-v6/linux/${arch}`), path.join(nm, `onnxruntime-node/bin/napi-v6/linux/${arch}`), { recursive: true });
// its postinstall only fetches GPU builds; the CPU ones are already here
const ortPkg = JSON.parse(fs.readFileSync(path.join(nm, "onnxruntime-node/package.json"), "utf8"));
delete ortPkg.scripts;
fs.writeFileSync(path.join(nm, "onnxruntime-node/package.json"), JSON.stringify(ortPkg, null, 2));
fs.cpSync(pkgDir("onnxruntime-common"), path.join(nm, "onnxruntime-common"), { recursive: true, dereference: true, filter: (x) => !x.endsWith(".map") });
fs.cpSync(pkgDir("sherpa-onnx-node"), path.join(nm, "sherpa-onnx-node"), { recursive: true, dereference: true });
// sherpa's prebuilt library comes in a per-platform package; fetch the Pi's one if this isn't a Pi.
const sherpaVer = JSON.parse(fs.readFileSync(path.join(pkgDir("sherpa-onnx-node"), "package.json"), "utf8")).version;
const sherpaPlat = `sherpa-onnx-linux-${arch}`;
let sherpaDir = null;
try { sherpaDir = pkgDir(sherpaPlat); } catch {}
if (sherpaDir) fs.cpSync(sherpaDir, path.join(nm, sherpaPlat), { recursive: true, dereference: true });
else {
  const tmp = fs.mkdtempSync(path.join(out, ".pack-"));
  execSync(`npm pack ${sherpaPlat}@${sherpaVer} --silent`, { cwd: tmp, stdio: ["ignore", "pipe", "inherit"] });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  execSync(`tar xzf ${tgz}`, { cwd: tmp });
  fs.cpSync(path.join(tmp, "package"), path.join(nm, sherpaPlat), { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

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

const name = arch === "arm64" ? "nudge-pi.tar.gz" : `nudge-pi-${arch}.tar.gz`;
const tar = path.join(out, name);
fs.rmSync(tar, { force: true });
execSync(`tar --owner=0 --group=0 -czf ${name} nudge-pi`, { cwd: out, stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
const mb = (fs.statSync(tar).size / 1e6).toFixed(1);
console.log(`\n  ✓ ${path.relative(root, tar)}  (${mb} MB)\n\n  On the Pi:  tar xzf ${name} && cd nudge-pi && sudo ./install.sh\n`);
