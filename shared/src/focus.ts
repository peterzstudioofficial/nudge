import type { Settings } from "./model";

/**
 * What's kept away during a focus session, on the computer (sites through the browser extension,
 * apps through the desktop watcher). Three kinds of thing:
 *
 * - blocked: no school use (Instagram, TikTok, games…) — always kept away during a session
 * - for a subject: useful for some lessons (Pinterest for art) — open only while the task on the
 *   wall is for one of those subjects
 * - never blocked: what school runs on (Teams, Outlook, Office, SharePoint, revision sites), even
 *   if it's added to a list by mistake
 *
 * YouTube is separate: it stays open for videos whose title matches today's tasks.
 */

/** School tools: never kept away, whatever the lists say. */
export const NEVER_BLOCK = [
  // Microsoft 365 (the school's mail, Teams and files)
  "teams", "ms-teams", "outlook", "olk", "onenote", "winword", "excel", "powerpnt", "onedrive",
  "office.com", "microsoft365.com", "office365.com", "sharepoint.com", "live.com", "microsoft.com", "microsoftonline.com", "onenote.com",
  // school and revision
  "churcherscollege.com", "sparxmaths.uk", "sparx-learning.com", "senecalearning.com", "educake.co.uk", "kerboodle.com",
  "gcsepod.com", "corbettmaths.com", "mathsgenie.co.uk", "physicsandmathstutor.com", "savemyexams.com", "bbc.co.uk",
  "aqa.org.uk", "ocr.org.uk", "pearson.com", "quizlet.com", "wikipedia.org",
];

const norm = (s: string) => s.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/\.exe$/, "");
const never = (name: string) => NEVER_BLOCK.some((n) => name === n || name.endsWith("." + n));

export interface FocusPlan {
  /** sites to keep away right now */
  sites: string[];
  /** apps (process names) to keep away right now */
  apps: string[];
  /** open right now because of the task, with why ("art") — shown in the extension */
  allowed: { name: string; why: string }[];
}

/** The lists for this moment: which subject the task on the wall is for decides the "for a subject" ones. */
export function focusPlan(s: Pick<Settings, "blockList" | "blockApps" | "focusAllow">, subject: string | null): FocusPlan {
  const allowed: FocusPlan["allowed"] = [];
  const gate = (name: string) => {
    const rule = s.focusAllow.find((r) => norm(r.name) === name);
    if (rule && subject && rule.subjects.includes(subject)) {
      allowed.push({ name, why: subject });
      return false;
    }
    return true;
  };
  const sites = [...new Set(s.blockList.map(norm))].filter((n) => n && !never(n) && gate(n));
  const apps = [...new Set(s.blockApps.map(norm))].filter((n) => n && !never(n) && gate(n));
  return { sites, apps, allowed };
}
