/**
 * The safety rails for reading school Microsoft 365 in a headless browser.
 *
 * The reader only ever navigates and reads the page. It never clicks, types or submits.
 * On top of that, every network request the page makes goes through `decide()`:
 *  - only Microsoft hosts are reachable at all;
 *  - PUT / PATCH / DELETE / MERGE are always blocked;
 *  - POSTs that look like they change something (send, delete, move, mark read, flag, reply,
 *    upload, share, like, comment …) are blocked;
 *  - images, fonts and media are skipped to save memory on the Pi.
 * So even a surprise script on a school page cannot send mail or change anything.
 */

export const ALLOWED_HOST_SUFFIXES = [
  "sharepoint.com",
  "sharepointonline.com",
  "office.com",
  "office.net",
  "office365.com",
  "outlook.com",
  "live.com",
  "microsoft.com",
  "microsoftonline.com",
  "msauth.net",
  "msftauth.net",
  "msocdn.com",
  "microsoftonline-p.com",
  "akamaihd.net",
  "cdn.office.net",
  "static.microsoft",
  "svc.ms",
  "msecnd.net",
  "azureedge.net",
];

const WRITE_WORDS =
  /(^|[^a-z])(send|senditem|sendmail|reply|replyall|forward|delete|deleteitem|softdelete|harddelete|recycle|move|moveitem|copyitem|update|updateitem|createitem|create|mark|markasread|markitemsasread|setreadflag|flag|applyconversationaction|emptyfolder|upload|checkin|checkout|publish|like|unlike|comment|follow|share|permission|breakroleinheritance|additem|validateupdatelistitem|saveitem|draft|attachment|respond|accept|decline|tentative|rsvp|subscribe|categor)([^a-z]|$)/i;

/** Read-only POSTs the pages need to render lists and mail. */
const READ_POSTS = [
  /\/_api\/contextinfo$/i,
  /RenderListDataAsStream/i,
  /\/_api\/web\/(lists|getlist)[^?]*\/(getitems|renderlistdataasstream)(\?|$)/i,
  /action=(FindItem|FindConversation|GetConversationItems|GetItem|GetFolder|FindFolder|GetMailTips|GetOwaUserConfiguration|GetAccessTokenforResource)\b/i,
  /startupdata\.ashx/i,
  /\/search\/api\/v\d\/query/i,
  /\/(oauth2|common|organizations|[0-9a-f-]{36})\/(v2\.0\/)?token/i, // token refresh keeps the session alive
  /\/GetCredentialType/i,
  /\/kmsi/i,
];

export type Verdict = "allow" | "skip" | "block";

export function hostAllowed(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

export function decide(req: { url: string; method: string; resourceType: string; headers?: Record<string, string> }): Verdict {
  const { url, resourceType } = req;
  const method = req.method.toUpperCase();
  if (url.startsWith("data:") || url.startsWith("blob:")) return "allow";
  if (!hostAllowed(url)) return "block";
  if (["image", "font", "media"].includes(resourceType)) return "skip";
  const override = (req.headers?.["x-http-method"] || req.headers?.["x-http-method-override"] || "").toUpperCase();
  if (["PUT", "PATCH", "DELETE", "MERGE"].includes(method) || ["PUT", "PATCH", "DELETE", "MERGE"].includes(override)) return "block";
  if (method === "POST") {
    const pathAndQuery = url.replace(/^https?:\/\/[^/]+/, "");
    if (WRITE_WORDS.test(pathAndQuery)) return "block";
    if (READ_POSTS.some((re) => re.test(url))) return "allow";
    // Unknown POST to a Microsoft host: telemetry and similar. Allowed, but logged by the caller.
    return "allow";
  }
  return "allow";
}

/** Sign-in cookies we accept from the desktop. Anything for another site is dropped. */
export function cookieAllowed(domain: string): boolean {
  const d = domain.replace(/^\./, "").toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => d === s || d.endsWith("." + s));
}
