// End-to-end: a real hub (not dev mode, like the Pi), a fake OpenRouter on loopback, and a
// browser. Imports a setup pack (a made-up student by default, or yours: --pack private/nudge-setup.json),
// then drives the wall, phone, parent, notes, the assistant, the library + OCR, sharper search and
// the Claude connector. Prints PASS/FAIL per check; exits non-zero on any failure.
//   npm run build && node scripts/e2e/run.mjs [--pack file] [--keep]
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const D = fs.mkdtempSync(path.join(os.tmpdir(), "nudge-e2e-"));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const PACK = arg("--pack") ? path.resolve(arg("--pack")) : samplePack();
const HUB = "http://127.0.0.1:9981", LOCAL = "http://127.0.0.1:9982";
const HUBJS = path.join(ROOT, "pi-hub/dist/hub.mjs");
const CHROME = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));
fs.mkdirSync(`${D}/data`, { recursive: true });
fs.writeFileSync(`${D}/or.log`, "");
fs.writeFileSync(`${D}/scan.pdf`, pdf(["", ""]));
fs.writeFileSync(`${D}/macbeth.pdf`, pdf(["Macbeth Act 1: the witches predict Macbeth will be king. Lady Macbeth persuades him to kill Duncan.", "Macbeth Act 2: Macbeth murders Duncan; Malcolm and Donalbain flee.", "Key quote: Fair is foul, and foul is fair."]));
const procs = [
  spawn(process.execPath, [path.join(ROOT, "scripts/e2e/fake-openrouter.mjs"), `${D}/or.log`, "9990"], { stdio: "ignore" }),
  spawn(process.execPath, [HUBJS], { env: { ...process.env, NUDGE_PORT: "9981", NUDGE_HOST: "127.0.0.1", NUDGE_DATA: `${D}/data`, OPENROUTER_API_KEY: "sk-or-e2e-test", NUDGE_OPENROUTER_BASE: "http://127.0.0.1:9990/api/v1", NUDGE_DEV: "" }, stdio: ["ignore", fs.openSync(`${D}/hub.log`, "w"), "inherit"] }),
];
const stop = () => { for (const p of procs) p.kill(); if (!process.argv.includes("--keep")) fs.rmSync(D, { recursive: true, force: true }); };
process.on("exit", stop);
for (let i = 0; i < 60; i++) { if (await fetch(`${HUB}/api/health`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 250)); }

/** A made-up student whose term always includes today. */
function samplePack() {
  const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  const subjects = ["eng", "maths", "chem", "physics", "bio", "art", "drama", "biz", "re", "pe"];
  const timetable = {};
  for (const w of ["A", "B"]) for (let d = 1; d <= 5; d++) timetable[`${w}${d}`] = Array.from({ length: 6 }, (_, i) => ({ subject: subjects[(d * 3 + i + (w === "B" ? 1 : 0)) % subjects.length], span: 1, teacher: `T${(d + i) % 9}X` }));
  const slots = [["09:00", "09:40"], ["09:40", "10:20"], ["10:40", "11:20"], ["11:20", "12:00"], ["13:10", "13:50"], ["13:50", "14:30"]].map(([start, end]) => ({ start, end }));
  const pack = {
    settings: { ownerName: "alex", yearGroup: "5th Year", house: "Test", profile: "Made-up student for tests.", interests: ["drama"] },
    terms: [{ term: "Test term", start: day(-40), end: day(80), breaks: [], confirmed: true, note: "", abStart: "A" }],
    timetable, schoolDay: { reg: { start: "08:30", end: "09:00" }, slots, breaks: [{ label: "break", start: "10:20", end: "10:40" }] },
    homework: { on: true, weeklyMinsPerSubject: 60, days: { A1: ["eng"], A3: ["chem"], B2: ["maths"] } },
    memories: ["plays the lead in the school play", "likes short answers", "revises best in the morning", "wants to spend as little as possible on AI", "makes short films"],
  };
  const f = path.join(D, "sample-setup.json");
  fs.writeFileSync(f, JSON.stringify(pack));
  return f;
}

/** A real PDF with one line of text per page (or none, like a scan). */
function pdf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((t, i) => { const st = t ? `BT /F1 11 Tf 40 720 Td (${t}) Tj ET` : "q 0 0 0 rg 72 600 200 100 re f Q"; objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`); objs.push(`<< /Length ${st.length} >>\nstream\n${st}\nendstream`); });
  let o = "%PDF-1.4\n"; const off = [];
  objs.forEach((x, i) => { off.push(o.length); o += `${i + 1} 0 obj\n${x}\nendobj\n`; });
  const xr = o.length;
  return o + `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((v) => String(v).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
}

const results = [];
const check = (name, ok, info = "") => { results.push([ok, name, info]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + String(info).slice(0, 160) : ""}`); };
const code = (role) => execSync(`"${process.execPath}" "${HUBJS}" pair --role ${role} --data "${D}/data" 2>&1`).toString().match(/\d{6}/)[0];
const pair = async (role, name) => (await (await fetch(`${HUB}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code(role), name }) })).json()).token;
const api = (tok) => async (m, p, b, raw) => { const r = await fetch(HUB + p, { method: m, headers: { authorization: "Bearer " + tok, ...(raw ? { "content-type": "application/octet-stream" } : b ? { "content-type": "application/json" } : {}) }, body: raw ?? (b ? JSON.stringify(b) : undefined) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(250); } return null; };

// 1. import the private setup through the wall's loopback, like `sudo nudge import`
const imp = await fetch(`${LOCAL}/api/config/import`, { method: "POST", headers: { "content-type": "application/json" }, body: fs.readFileSync(PACK) });
check("setup pack imports on the wall", imp.ok, (await imp.text()).slice(0, 160));
const pc = await (await fetch(`${LOCAL}/api/pairing-codes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "owner" }) })).json();
check("the wall's pair code comes with a link a phone can scan (not 127.0.0.1)", /^https?:\/\/(?!127\.)[^/]+\/app\/index\.html\?pair=\d{6}$/.test(pc.url ?? ""), pc.url);

const owner = api(await pair("owner", "peter's phone"));
const parent = api(await pair("parent", "dad"));
const desktop = api(await pair("desktop", "peter's pc"));
const st = (await owner("GET", "/api/state")).j;
const schoolToday = st?.today?.kind === "school";
check("the timetable is loaded (today, or the next school day)", schoolToday ? st.timetable.length > 3 : true, schoolToday ? st.timetable.map((l) => l.subject).join(",") : `not a school day (${st?.today?.kind})`);
check("the profile is loaded", !!st?.settings?.ownerName && st.settings.ownerName === JSON.parse(fs.readFileSync(PACK, "utf8")).settings.ownerName);
const brain = (await owner("GET", "/api/brain")).j;
check("memory seeded from setup", brain?.length >= 5, brain?.map((m) => m.text).slice(0, 2).join(" | "));
check("teachers/staff private from parent", (await parent("GET", "/api/config/teachers")).status >= 400);

// 2. assistant: free local answer, then real loop through OpenRouter (fake), with ZDR
const ask = async (prompt, origin = "app") => { const r = await owner("POST", "/api/agent/threads", { prompt, mode: "act" }); return until(async () => { const t = (await owner("GET", `/api/agent/threads/${r.j.id}`)).j; return t && t.status !== "working" ? t : null; }, 15000) ?? (await owner("GET", `/api/agent/threads/${r.j.id}`)).j; };
const q1 = await ask("what's next?");
check("simple question answered on the Pi, free", q1?.steps?.[0]?.meta === "ON THE PI · FREE", q1?.log?.at(-1)?.text);
const q2 = await ask("what have I got first today and anything I should know");
check("assistant loop runs through OpenRouter", q2?.status === "done" && (schoolToday ? /first up/i : /./).test(q2?.log?.at(-1)?.text ?? ""), q2?.log?.at(-1)?.text ?? q2?.error);
const log = () => fs.readFileSync(`${D}/or.log`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const chats = log().filter((x) => x.url.endsWith("/chat/completions") && x.body.tools);
check("every assistant request is zero-retention, no data collection", chats.length > 0 && chats.every((x) => x.body.provider?.zdr === true && x.body.provider?.data_collection === "deny"), chats.map((x) => JSON.stringify(x.body.provider)).slice(0, 1));
check("his memory rides along with questions", chats.some((x) => JSON.stringify(x.body.messages).includes("What you know about them")));
const q3 = await ask("email mr hale asking for two more days on the chemistry write-up");
const asks = (await owner("GET", "/api/state")).j.asks;
check("email becomes a question, nothing sent", q3?.status === "asking" && asks.some((a) => a.kind === "email"), q3?.log?.at(-1)?.text);
const em = asks.find((a) => a.kind === "email");
check("a tap can't approve it", (await owner("POST", `/api/asks/${em.id}/answer`, { yes: true })).status === 428);
await wait(1600);
check("a held yes approves it", (await owner("POST", `/api/asks/${em.id}/answer`, { yes: true, held: true })).status === 200);
const hand = (await desktop("GET", "/api/handoffs")).j;
check("…and it's a draft for the computer, not a sent email", hand?.some((h) => h.kind === "compose" && h.payload.to === "j.hale@churcherscollege.com"));
const q4 = await ask("remember that I like revising before school");
check("remember tool stores to the brain", (await owner("GET", "/api/brain")).j.some((m) => /before school/.test(m.text)));

// 3. library + RAG: real PDF, scan via OCR (cost asked first), search finds it
const pdfFile = `${D}/macbeth.pdf`;
let up = await owner("POST", `/api/library?name=${encodeURIComponent("Macbeth revision.pdf")}`, null, fs.readFileSync(pdfFile));
check("PDF read on the Pi", up.status === 200 && up.j.pages === 3, JSON.stringify(up.j).slice(0, 120));
const scan = fs.readFileSync(`${D}/scan.pdf`);
up = await owner("POST", `/api/library?name=inspector-scan.pdf`, null, scan);
check("scan: asks first with a cost", up.status === 402 && up.j.needsOcr && up.j.estUsd > 0, JSON.stringify(up.j));
up = await owner("POST", `/api/library?name=inspector-scan.pdf&ocr=1`, null, scan);
check("scan: read by OCR after yes", up.status === 200 && up.j.ocr === true && up.j.pages === 2, JSON.stringify(up.j).slice(0, 120));
const ocrReq = log().find((x) => JSON.stringify(x.body.messages ?? "").includes('"type":"file"'));
check("OCR request is private (ZDR)", ocrReq?.body?.provider?.zdr === true && ocrReq?.body?.plugins?.[0]?.id === "file-parser");
const q5 = await ask("what does my inspector calls guide say about sheila");
check("assistant answers from his document with the page", /p\. 2|inspector/i.test(q5?.log?.at(-1)?.text ?? ""), q5?.log?.at(-1)?.text);
const autos = log().filter((x) => x.url.endsWith("/chat/completions") && x.body.tools && JSON.stringify(x.body.messages).includes("sheila"));
check("matching passages were sent automatically with the question", autos.some((x) => JSON.stringify(x.body.messages).includes("From their own notes and documents")));
await owner("PATCH", "/api/settings", { ragEmbed: "openrouter" });
await wait(300);
const q6 = await ask("what does macbeth's witches prophecy say");
await wait(500);
const emb = log().filter((x) => x.url.endsWith("/embeddings"));
check("sharper search uses OpenRouter embeddings, privately", emb.length > 0 && emb.every((x) => x.body.provider?.zdr === true), `${emb.length} calls`);
const status = (await owner("GET", "/api/ai/status")).j;
check("status shows the search engine and documents", status?.search?.documents === 2 && /or:/.test(status?.search?.engine), JSON.stringify(status?.search));
await owner("PATCH", "/api/settings", { ragEmbed: "local" });

// 4. Claude connector API (computer only)
check("connector refuses the phone", (await owner("GET", "/api/agent/tools")).status === 403);
const tl = (await desktop("GET", "/api/agent/tools")).j;
check("connector lists tools for the computer", tl?.some((t) => t.name === "search_my_stuff") && !tl.some((t) => t.name === "hand_to_claude"), tl?.length);
const cs = (await desktop("POST", "/api/agent/tools/search_my_stuff", { args: { query: "sheila" } })).j;
check("connector search reads his library", /Sheila/.test(cs?.text ?? ""), cs?.text?.slice(0, 100));

// 5. parent: no private content
const feed = JSON.stringify((await parent("GET", "/api/feed")).j);
check("parent feed has no questions, emails or devices", !/hale|chemistry write-up|paired|Asked the agent|inspector|macbeth/i.test(feed), feed.slice(0, 200));
check("parent can't read memory or library", (await parent("GET", "/api/brain")).status === 403 && (await parent("GET", "/api/library")).status === 403);
check("parent can set smart blocking", (await parent("PATCH", "/api/settings", { focusAllow: [{ name: "canva.com", subjects: ["art"] }] })).status === 200);
check("owner can't change parent rules", (await owner("PATCH", "/api/settings", { blockList: [] })).status === 403);

// 6. the screens, in a browser
const b = await chromium.launch(CHROME ? { executablePath: CHROME } : { channel: "chrome" });
const errs = [];
const wall = await b.newPage({ viewport: { width: 1024, height: 600 } });
wall.on("pageerror", (e) => errs.push("wall: " + e));
await wall.goto(`${LOCAL}/screen/`); await wall.waitForTimeout(2500);
check("wall screen renders", (await wall.evaluate(() => document.body.innerText.length)) > 10);

// 7. the assistant's screens on the wall: a free timer, then a page of his document
await wall.keyboard.press("4"); // morning alarm (if it's up): any key
await wall.waitForTimeout(400);
const calls0 = log().filter((x) => x.url.endsWith("/chat/completions")).length;
const tq = await ask("nudge, set a timer for 10 minutes");
let wallNow = (await owner("GET", "/api/state")).j?.wall;
check("a timer is set on the Pi, free (no model call)", wallNow?.card?.kind === "timer" && wallNow.card.secs === 600 && log().filter((x) => x.url.endsWith("/chat/completions")).length === calls0, tq?.log?.at(-1)?.text);
const wallText = () => wall.evaluate(() => document.body.innerText);
check("the wall shows the timer", !!(await until(async () => /timer/i.test(await wallText()) && /\b(9:5\d|10:00)\b/.test(await wallText()), 12000)), (await wallText()).replace(/\s+/g, " ").slice(0, 120));
const dq = await ask("put my inspector calls guide on the wall");
wallNow = (await owner("GET", "/api/state")).j?.wall;
check("the assistant opens his document on the wall at a page", wallNow?.card?.kind === "doc" && wallNow.card.page === 2 && /Sheila/.test(wallNow.card.body), dq?.log?.at(-1)?.text);
const reads = async () => { const t = await wallText(); return /P\. 2\/2/.test(t) && /Sheila/.test(t) && /prev/.test(t); };
check("the wall reads it, with page and keys", !!(await until(reads, 8000)), (await wallText()).replace(/\s+/g, " ").slice(0, 160));
check("the parent app never sees what's on the wall", (await parent("GET", "/api/state")).j?.wall === null);
await owner("POST", "/api/wall/page", { delta: -1 });
check("keys turn its pages", (await owner("GET", "/api/state")).j?.wall?.card?.page === 1);
await owner("DELETE", "/api/wall");
check("done takes it down", (await owner("GET", "/api/state")).j?.wall === null);

// 8. the 5×5 lights: a pack from a file, a glyph on demand, a moment, and what reaches the Pi's daemon
const frames = [];
const daemon = new WebSocket(LOCAL.replace("http", "ws") + "/api/ws");
daemon.onopen = () => daemon.send(JSON.stringify({ type: "auth", token: null }));
daemon.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === "leds") frames.push(m.frame); };
const lp = await owner("POST", "/api/lights/packs", JSON.parse(fs.readFileSync(path.join(ROOT, "docs/lights-example.json"), "utf8")));
check("a light pack is checked and added", lp.status === 200 && lp.j?.glyphs?.length === 3, JSON.stringify(lp.j).slice(0, 100));
check("a broken pack is turned away", (await owner("POST", "/api/lights/packs", { name: "x", glyphs: [{ name: "a", palette: ["red"], frames: ["1"] }] })).status === 400);
check("the parent app can't add packs", (await parent("POST", "/api/lights/packs", JSON.parse(fs.readFileSync(path.join(ROOT, "docs/lights-example.json"), "utf8")))).status === 403);
await owner("PATCH", "/api/settings", { lightMap: { award: "film/clapper" } });
await owner("POST", "/api/lights/play", { ref: "film/rec", secs: 6 });
const lights = (await owner("GET", "/api/state")).j?.lights;
check("a glyph plays, and moments use his pack", lights?.playing?.name === "film/rec" && lights?.moments?.award?.frames?.length === 3, JSON.stringify(lights?.playing ?? null).slice(0, 80));
check("the parent app doesn't see the lights", (await parent("GET", "/api/state")).j?.lights?.playing === null);
const got = await until(() => frames.find((f) => f.glyph?.palette?.[0] === "#ff2a1a" || (f.level ?? 1) < 0.1), 8000);
check("the wall hands the glyph to the light daemon (or it's night: lights stay dark)", !!got, got ? (got.glyph ? `glyph ${got.glyph.frames.length} frames @ ${got.glyph.fps} fps, level ${got.level}` : `night, level ${got.level}`) : `${frames.length} frames`);
daemon.close();
const tok = (await (await fetch(`${HUB}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code("owner"), name: "browser" }) })).json());
const phone = await b.newPage({ viewport: { width: 412, height: 912 } });
phone.on("pageerror", (e) => errs.push("phone: " + e));
await phone.goto(`${HUB}/app/index.html`);
await phone.evaluate(([t, hub]) => localStorage.setItem("nudge-owner:pairing", JSON.stringify({ hub, token: t.token, role: "owner", name: "browser" })), [tok, HUB]);
await phone.reload(); await phone.waitForTimeout(2000);
const txt = await phone.evaluate(() => document.body.innerText.toLowerCase());
check("phone today shows the day", /mon|tue|wed|thu|fri|sat|sun/.test(txt) && (!schoolToday || /next ·|now ·|school's done/.test(txt)), txt.slice(0, 120));
for (const [icon, name] of [["calendar_month", "plan"], ["apps", "tools"], ["settings", "settings"]]) {
  await phone.locator(".ms", { hasText: new RegExp(`^${icon}$`) }).first().click(); await phone.waitForTimeout(900);
}
await phone.getByText("documents it can read").click(); await phone.waitForTimeout(1200);
check("documents sheet lists the files", /macbeth/i.test(await phone.evaluate(() => document.body.innerText)));
const notes = await b.newPage({ viewport: { width: 412, height: 912 } });
notes.on("pageerror", (e) => errs.push("notes: " + e));
await notes.goto(`${HUB}/app/index.html`);
await notes.evaluate(([t, hub]) => localStorage.setItem("nudge-owner:pairing", JSON.stringify({ hub, token: t.token, role: "owner", name: "browser" })), [tok, HUB]);
await notes.goto(`${HUB}/app/notes.html`); await notes.waitForTimeout(1800);
check("notes app opens", (await notes.evaluate(() => document.body.innerText.toLowerCase())).includes("notes"));
check("no page errors in any screen", errs.length === 0, errs.join(" | "));
await b.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`hub log: ${D}/hub.log (run with --keep to look)`);
process.exit(failed.length ? 1 : 0);
