// Fetches Nothing's Glyph SDK (the AAR from Nothing-Developer-Programme/Glyph-Developer-Kit) into the
// Android project, pinned to one commit and checked against its SHA-256. It isn't kept in git.
// Optional: if it can't be fetched the Android apps still build, with the Glyph lights off.
//   node scripts/fetch-glyph-sdk.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const COMMIT = "8ee807a9312a640b0d43051450924e3446bc1d78";
const SRC = `https://raw.githubusercontent.com/Nothing-Developer-Programme/Glyph-Developer-Kit/${COMMIT}/sdk/glyph-matrix-sdk-2.0.aar`;
const SHA256 = "329393019db5f0f987c6245855d13fa273d06756c68829ca0f6ae686ba336da1";
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../android/native/app/libs/glyph-sdk.aar");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
if (fs.existsSync(out) && sha(fs.readFileSync(out)) === SHA256) {
  console.log("glyph sdk: already here");
  process.exit(0);
}
try {
  const res = await fetch(SRC, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== SHA256) throw new Error("checksum didn't match, not using it");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`glyph sdk: fetched (${buf.length} bytes, sha256 ok)`);
} catch (e) {
  fs.rmSync(out, { force: true });
  console.log(`::warning::glyph sdk not fetched (${e.message}); building without Glyph lights`);
}
