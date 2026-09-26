// Prepares the native Android project for one of the three apps, then syncs web assets.
//   node build-app.mjs my|notes|parent
// Then build with Gradle:  cd native && ./gradlew assembleRelease   (CI does this)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const APPS = {
  my: { id: "studio.peterz.nudge", name: "nudge", entry: "index.html", color: "#0a0a0c" },
  notes: { id: "studio.peterz.nudge.notes", name: "nudge notes", entry: "notes.html", color: "#f4f3ef" },
  parent: { id: "studio.peterz.nudge.parent", name: "nudge parent", entry: "parent.html", color: "#f4f3ef" },
};
const which = process.argv[2] || "my";
const app = APPS[which];
if (!app) throw new Error("usage: node build-app.mjs my|notes|parent");

const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.resolve(here, "../apps/dist");
if (!fs.existsSync(dist)) throw new Error("build the apps first: npm run build -w apps");

// 1. web assets: the chosen app becomes index.html
const www = path.join(here, "www");
fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(dist, www, { recursive: true });
if (app.entry !== "index.html") fs.copyFileSync(path.join(www, app.entry), path.join(www, "index.html"));

// 2. native identity: package id, name, icons, splash colour
const gradle = path.join(here, "native/app/build.gradle");
fs.writeFileSync(gradle, fs.readFileSync(gradle, "utf8").replace(/applicationId "[^"]+"/, `applicationId "${app.id}"`));
const strings = path.join(here, "native/app/src/main/res/values/strings.xml");
fs.writeFileSync(
  strings,
  fs
    .readFileSync(strings, "utf8")
    .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${app.name}</string>`)
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${app.name}</string>`),
);
const res = path.join(here, "native/app/src/main/res");
for (const d of fs.readdirSync(path.join(here, "icons", which))) {
  for (const f of fs.readdirSync(path.join(here, "icons", which, d))) fs.copyFileSync(path.join(here, "icons", which, d, f), path.join(res, d, f));
}
fs.writeFileSync(
  path.join(res, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${app.color}</color>\n</resources>\n`,
);
const cfg = JSON.parse(fs.readFileSync(path.join(here, "capacitor.config.json"), "utf8"));
cfg.appId = app.id;
cfg.appName = app.name;
cfg.android.backgroundColor = app.color;
fs.writeFileSync(path.join(here, "capacitor.config.json"), JSON.stringify(cfg, null, 2) + "\n");

execSync("npx cap sync android", { cwd: here, stdio: "inherit" });
console.log(`ready: ${app.name} (${app.id}) — now: cd android/native && ./gradlew assembleRelease`);
