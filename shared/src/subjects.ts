/** Subject colours, taken from ND-1 Panel v2. One colour per subject, used everywhere. */
export const TINT: Record<string, string> = {
  maths: "#2f5fa8",
  chem: "#1f7a4d",
  physics: "#3d6f8f",
  bio: "#4f7a2f",
  eng: "#8a2f5c",
  history: "#6a4a2f",
  geog: "#2f7a73",
  french: "#5a4fa8",
  spanish: "#a84f4f",
  pe: "#4a4a54",
  music: "#7a2f8a",
  art: "#a8552f",
  cs: "#2f4f7a",
  re: "#6f6a3a",
  study: "#a8761f",
  mine: "#8d8d97",
  bag: "#c9c6cf",
  free: "#2a2a33",
};

export const SUBJECT_NAMES: Record<string, string> = {
  maths: "maths", chem: "chemistry", physics: "physics", bio: "biology", eng: "english",
  history: "history", geog: "geography", french: "french", spanish: "spanish", pe: "PE",
  music: "music", art: "art", cs: "computing", re: "RS", study: "revision", mine: "mine", bag: "bag",
  free: "free",
};

const ALIASES: [RegExp, string][] = [
  [/\bmath(s|ematics)?\b|quadratic|algebra|equation|geometry/i, "maths"],
  [/\bchem(istry)?\b|atom|le chatelier|titration|mole\b/i, "chem"],
  [/\bphysics\b|newton|circuit|forces?\b/i, "physics"],
  [/\bbio(logy)?\b|cell|photosynth|enzyme/i, "bio"],
  [/\beng(lish)?\b|essay|poem|macbeth|shakespeare|literature|\blit\b/i, "eng"],
  [/\bhistory\b|\bwar\b|tudor|medieval/i, "history"],
  [/\bgeog(raphy)?\b|river|tectonic/i, "geog"],
  [/\bfrench\b/i, "french"],
  [/\bspanish\b/i, "spanish"],
  [/\bpe\b|games|rugby|hockey|netball|football|kit\b/i, "pe"],
  [/\bmusic\b|guitar|piano|drum|song/i, "music"],
  [/\bart\b|drawing|sketch/i, "art"],
  [/\bcomput(ing|er science)\b|\bcs\b|python|coding/i, "cs"],
  [/\b(re|rs|religio(us|n))\b|philosophy|ethics/i, "re"],
  [/revis(e|ion)|mock|exam|test/i, "study"],
];

/** Guess a subject key from free text (email subject, page title, task name). */
export function guessSubject(text: string): string | null {
  for (const [re, key] of ALIASES) if (re.test(text)) return key;
  return null;
}

export function tint(subject: string | null | undefined): string {
  return (subject && TINT[subject]) || TINT.mine;
}
