import crypto from "node:crypto";
import { classifySchoolText, type SchoolItem, type SchoolStatus, parseTermDatesText, subjectFromSender } from "@nudge/shared";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { SchoolService } from "../context";
import type { Hub } from "../hub";
import { cookieAllowed, decide, hostAllowed } from "./guard";
import { extractOutlook, extractSharePoint, mailTime, type RawMail, type RawPageItem } from "./extract";
import { OUTLOOK_FIXTURE, SHAREPOINT_FIXTURE } from "./fixtures";
import type { Vault } from "./vault";

/** Cookie shape Playwright wants. */
export interface PwCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface Sealed {
  cookies: PwCookie[];
  userAgent: string | null;
  savedAt: number;
}

const OUTLOOK_URL = "https://outlook.office.com/mail/inbox";
const PAGE_TIMEOUT = 60_000;
const RUN_TIMEOUT = 5 * 60_000;

export interface ReaderOptions {
  hub: Hub;
  vault: Vault;
  chromium: string | null;
  dev: boolean;
  log: (msg: string) => void;
  onNeedsSignIn: () => void;
}

/** Normalise cookies from Electron / Chrome export into Playwright's shape, dropping anything not Microsoft. */
export function normaliseCookies(raw: Record<string, unknown>[]): PwCookie[] {
  const out: PwCookie[] = [];
  for (const c of raw) {
    const name = String(c.name ?? "");
    const value = String(c.value ?? "");
    let domain = String(c.domain ?? "");
    if (!name || !domain || !cookieAllowed(domain)) continue;
    if (c.hostOnly === true) domain = domain.replace(/^\./, "");
    const exp = Number(c.expirationDate ?? c.expires ?? -1);
    const ss = String(c.sameSite ?? "lax").toLowerCase();
    out.push({
      name,
      value,
      domain,
      path: String(c.path ?? "/"),
      expires: Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: c.secure === undefined ? true : Boolean(c.secure),
      sameSite: ss.startsWith("strict") ? "Strict" : ss.startsWith("no") || ss === "none" ? "None" : "Lax",
    });
  }
  return out;
}

export function schoolReader(o: ReaderOptions): SchoolService {
  const { hub, vault } = o;
  let running = false;

  const status = (): SchoolStatus => {
    const s = hub.db.kvGet<Omit<SchoolStatus, "running" | "itemCount" | "signedIn">>("schoolStatus", {
      needsSignIn: false, lastRun: null, lastOk: null, lastError: null,
    });
    return { ...s, signedIn: !!hub.db.kvGet<string | null>("schoolSession", null), running, itemCount: hub.school.count() };
  };
  const setStatus = (p: Partial<SchoolStatus>) => {
    const cur = status();
    const { running: _r, itemCount: _i, signedIn: _s, ...keep } = { ...cur, ...p };
    hub.db.kvSet("schoolStatus", keep);
    hub.bus.changed("school");
  };

  const loadSession = (): Sealed | null => {
    const s = hub.db.kvGet<string | null>("schoolSession", null);
    return s ? vault.open<Sealed>(s) : null;
  };
  const saveSession = (s: Sealed) => hub.db.kvSet("schoolSession", vault.seal(s));

  /** Store or update an item, keeping whether Peter already acted on it. */
  const upsert = (source: "mail" | "page", ref: string, title: string, from: string, preview: string, url: string, receivedAt: number) => {
    const id = crypto.createHash("sha1").update(source + ":" + ref).digest("hex").slice(0, 20);
    const c = classifySchoolText(title, preview, new Date());
    const prev = hub.school.get(id);
    const what = c.bring[0]?.replace(/^(your|a|an|the)\s+/, "");
    const displayTitle = c.kind === "bring" && what ? `bring your ${what}${source === "page" ? " — " + title.toLowerCase() : ""}` : title;
    const item: SchoolItem = {
      id,
      source,
      sourceRef: ref,
      title: displayTitle.slice(0, 140),
      from,
      preview: preview.slice(0, 600),
      url,
      receivedAt,
      kind: c.kind,
      due: c.due,
      // A teacher's email is about their subject, even if the subject line doesn't say.
      subject: c.subject ?? (source === "mail" ? subjectFromSender(from, hub.timetable(), hub.teachers()) : null),
      handled: prev?.handled ?? false,
      action: prev?.action ?? null,
      createdAt: prev?.createdAt ?? Date.now(),
    };
    hub.school.put(item);
    return !prev;
  };

  const ingestMail = (rows: RawMail[]) => {
    const senders = hub.settings().schoolMailSenders.map((s) => s.toLowerCase());
    let fresh = 0;
    for (const r of rows) {
      if (senders.length && !senders.some((s) => (r.fromEmail || r.from).toLowerCase().includes(s))) continue;
      if (upsert("mail", r.ref, r.subject || "(no subject)", r.from, r.preview, OUTLOOK_URL, mailTime(r.time))) fresh++;
    }
    return fresh;
  };
  const ingestPage = (label: string, pageUrl: string, items: RawPageItem[]) => {
    let fresh = 0;
    for (const it of items) {
      const ref = pageUrl + "#" + crypto.createHash("sha1").update(it.title + it.text).digest("hex").slice(0, 12);
      if (upsert("page", ref, it.title, label, it.text, it.url || pageUrl, Date.now())) fresh++;
    }
    return fresh;
  };

  async function launch(): Promise<Browser> {
    const { chromium } = await import("playwright-core");
    if (!o.chromium) throw new Error("no Chromium found (install chromium or set NUDGE_CHROMIUM)");
    return chromium.launch({
      executablePath: o.chromium,
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--renderer-process-limit=1",
        "--js-flags=--max-old-space-size=256",
        "--disable-extensions",
        "--disable-background-networking",
        "--mute-audio",
        "--no-first-run",
      ],
    });
  }

  async function guardedContext(browser: Browser, sealed: Sealed | null): Promise<BrowserContext> {
    const ctx = await browser.newContext({
      userAgent: sealed?.userAgent ?? undefined,
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
    });
    // tsx/esbuild helper that can leak into evaluated functions in dev
    await ctx.addInitScript("window.__name = window.__name || ((f) => f);");
    if (sealed?.cookies.length) await ctx.addCookies(sealed.cookies);
    let blocked = 0;
    await ctx.route("**/*", async (route) => {
      const r = route.request();
      const v = decide({ url: r.url(), method: r.method(), resourceType: r.resourceType(), headers: r.headers() });
      if (v === "allow") return route.continue();
      if (v === "block") {
        blocked++;
        if (r.method() !== "GET") o.log(`blocked ${r.method()} ${r.url().slice(0, 120)}`);
      }
      return route.abort("blockedbyclient");
    });
    ctx.on("close", () => blocked && o.log(`guard blocked ${blocked} requests this run`));
    return ctx;
  }

  async function onPage(page: Page, url: string): Promise<{ ok: boolean; login: boolean }> {
    if (!hostAllowed(url)) return { ok: false, login: false };
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const final = page.url();
    const login = /login\.microsoftonline\.com|login\.live\.com|\/adfs\/|signin/i.test(final);
    return { ok: !login && hostAllowed(final), login };
  }

  async function runReal(sealed: Sealed): Promise<{ fresh: number }> {
    const browser = await launch();
    let fresh = 0;
    try {
      const ctx = await guardedContext(browser, sealed);
      const page = await ctx.newPage();
      // Never let a page open popups or new windows.
      ctx.on("page", (p) => p !== page && p.close().catch(() => {}));
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      const s = hub.settings();

      for (const p of s.schoolPages) {
        const r = await onPage(page, p.url);
        if (r.login) throw Object.assign(new Error("signed out"), { login: true });
        if (!r.ok) continue;
        const { items } = await page.evaluate(extractSharePoint);
        fresh += ingestPage(p.label, p.url, items);
      }
      if (s.schoolMail) {
        const r = await onPage(page, OUTLOOK_URL);
        if (r.login) throw Object.assign(new Error("signed out"), { login: true });
        if (r.ok) {
          await page.waitForSelector('[role="listbox"], [role="grid"]', { timeout: 30_000 }).catch(() => {});
          const { rows } = await page.evaluate(extractOutlook);
          fresh += ingestMail(rows);
        }
      }
      // Keep the refreshed session (tokens roll forward) for next time.
      const cookies = (await ctx.cookies()).filter((c) => cookieAllowed(c.domain)) as PwCookie[];
      saveSession({ cookies, userAgent: sealed.userAgent, savedAt: Date.now() });
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
    }
    return { fresh };
  }

  /** Dev / test: run the same readers against the saved fixtures. Falls back to plain parsing without Chromium. */
  async function runFixtures(): Promise<{ fresh: number }> {
    if (o.chromium) {
      const browser = await launch();
      try {
        const ctx = await browser.newContext();
        await ctx.addInitScript("window.__name = window.__name || ((f) => f);");
        const page = await ctx.newPage();
        await page.setContent(SHAREPOINT_FIXTURE);
        const sp = await page.evaluate(extractSharePoint);
        await page.setContent(OUTLOOK_FIXTURE);
        const ol = await page.evaluate(extractOutlook);
        await ctx.close();
        return { fresh: ingestPage("year 10 hub", "https://school.sharepoint.com/sites/y10", sp.items) + ingestMail(ol.rows) };
      } finally {
        await browser.close().catch(() => {});
      }
    }
    return {
      fresh: ingestMail([
        { ref: "fx1", from: "Mr Hale", fromEmail: "j.hale@school.org.uk", subject: "Chemistry write-up", preview: "Please bring your chemistry book on Monday. The write-up is due Monday, not Friday.", time: "16:04", unread: true, flagged: false },
      ]),
    };
  }

  const svc: SchoolService = {
    status,
    async refresh(reason: string) {
      if (running) return;
      running = true;
      hub.bus.changed("school");
      const started = Date.now();
      const timer = setTimeout(() => o.log("school run is taking a long time"), RUN_TIMEOUT);
      try {
        const sealed = loadSession();
        let fresh = 0;
        if (sealed) fresh = (await runReal(sealed)).fresh;
        else if (o.dev) fresh = (await runFixtures()).fresh;
        else {
          setStatus({ lastRun: started, lastError: "not signed in", needsSignIn: true });
          return;
        }
        setStatus({ lastRun: started, lastOk: Date.now(), lastError: null, needsSignIn: false });
        if (fresh) hub.feed("school", `${fresh} new from school`);
        o.log(`school ${reason}: ${fresh} new items in ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (e) {
        const login = (e as { login?: boolean }).login === true;
        setStatus({ lastRun: started, lastError: login ? "signed out of school" : String((e as Error).message).slice(0, 200), needsSignIn: login });
        if (login) o.onNeedsSignIn();
        o.log(`school ${reason} failed: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
        running = false;
        hub.bus.changed("school");
      }
    },
    async setSession(cookies: unknown[], ua: string | null) {
      const list = normaliseCookies(cookies as Record<string, unknown>[]);
      if (!list.length) throw Object.assign(new Error("no Microsoft cookies in that sign-in"), { statusCode: 400 });
      saveSession({ cookies: list, userAgent: ua, savedAt: Date.now() });
      setStatus({ needsSignIn: false, lastError: null });
      hub.feed("school", "Signed in to school");
    },
    async clearSession() {
      hub.db.kvDel("schoolSession");
      setStatus({ needsSignIn: false, lastError: null });
      hub.feed("school", "Signed out of school");
    },
  };
  return svc;
}

/** Weekly: read the public term-dates page and update the calendar when it parses cleanly. */
export async function refreshTermDates(hub: Hub, log: (m: string) => void): Promise<void> {
  try {
    const res = await fetch("https://www.churcherscollege.com/school-life/term-dates", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    const parsed = parseTermDatesText(text);
    if (parsed.length < 2) return;
    const cur = hub.terms();
    const merged = [...cur.filter((t) => !parsed.some((p) => p.term === t.term)), ...parsed].sort((a, b) => a.start.localeCompare(b.start));
    hub.setTerms(merged);
    log(`term dates refreshed from the school site (${parsed.length} terms)`);
  } catch {
    /* offline or blocked — keep what we have */
  }
}
