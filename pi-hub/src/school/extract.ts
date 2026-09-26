/**
 * Page readers. These run INSIDE the school page (page.evaluate), so they must be
 * self-contained: no imports, no outside variables. They only read the DOM.
 */

export interface RawPageItem {
  title: string;
  text: string;
  url: string;
  date: string;
}

export interface RawMail {
  ref: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  time: string;
  unread: boolean;
  flagged: boolean;
}

/** SharePoint modern / classic page → sections and news items. */
export function extractSharePoint(): { title: string; items: RawPageItem[] } {
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const title =
    clean(document.querySelector('[data-automation-id="pageHeader"] h1, [data-automation-id="pageTitle"], h1')?.textContent) ||
    clean(document.title);
  const root =
    document.querySelector('#spPageCanvasContent, [data-automation-id="contentScrollRegion"], [role="main"], main, #DeltaPlaceHolderMain, #contentBox') ||
    document.body;
  const skip = (el: Element) => !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [data-automation-id="SiteHeader"], .ms-CommandBar');
  const items: RawPageItem[] = [];
  const seen = new Set<string>();
  const push = (it: RawPageItem) => {
    if (!it.text && it.title === title) return;
    const key = (it.title + "|" + it.text).slice(0, 200);
    if (!it.title || seen.has(key) || items.length >= 40) return;
    seen.add(key);
    items.push(it);
  };

  // 1. News web parts / link cards
  root.querySelectorAll('[data-automation-id="newsItem"], [data-automation-id="news-item"], [data-sp-feature-tag="News"] a, .ms-DocumentCard').forEach((card) => {
    if (skip(card)) return;
    const a = (card.matches("a") ? card : card.querySelector("a")) as HTMLAnchorElement | null;
    const t = clean(card.querySelector('[data-automation-id="newsItemTitle"], [role="heading"], h2, h3, .ms-DocumentCardTitle')?.textContent) || clean(a?.textContent);
    const d = clean(card.querySelector('[data-automation-id="newsItemDescription"], p')?.textContent);
    const date = clean(card.querySelector("time, [data-automation-id='newsItemDate']")?.textContent);
    push({ title: t, text: d, url: a?.href || location.href, date });
  });

  // 2. Headings split the rest of the page into sections
  const blocks = Array.from(root.querySelectorAll("h1, h2, h3, h4, p, li, td")).filter((el) => !skip(el));
  let cur: RawPageItem | null = null;
  for (const el of blocks) {
    const txt = clean(el.textContent);
    if (!txt) continue;
    if (/^H[1-4]$/.test(el.tagName)) {
      if (cur) push(cur);
      const a = el.querySelector("a") as HTMLAnchorElement | null;
      cur = { title: txt.slice(0, 140), text: "", url: a?.href || location.href, date: "" };
    } else if (cur) {
      if (cur.text.length < 600) cur.text += (cur.text ? " " : "") + txt;
      const a = el.querySelector("a") as HTMLAnchorElement | null;
      if (a && cur.url === location.href) cur.url = a.href;
    } else if (el.tagName === "LI" && txt.length > 8) {
      const a = el.querySelector("a") as HTMLAnchorElement | null;
      push({ title: txt.slice(0, 140), text: "", url: a?.href || location.href, date: "" });
    }
  }
  if (cur) push(cur);
  return { title, items };
}

/** Outlook on the web inbox list → rows. Reads the list only; never opens a message. */
export function extractOutlook(): { signedIn: boolean; rows: RawMail[] } {
  const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const list = document.querySelector('[role="listbox"], [role="grid"], [aria-label*="Message list" i]');
  if (!list) return { signedIn: !/login|signin/i.test(location.href), rows: [] };
  const rows: RawMail[] = [];
  const nodes = list.querySelectorAll('[data-convid], [role="option"], [role="row"]');
  nodes.forEach((row, i) => {
    if (rows.length >= 40) return;
    const aria = clean(row.getAttribute("aria-label"));
    const lines = ((row as HTMLElement).innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2 && !aria) return;
    const timeRe = /^(\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(mon|tue|wed|thu|fri|sat|sun)[a-z]* \d{1,2}:\d{2}|(mon|tue|wed|thu|fri|sat|sun)[a-z]* \d{1,2}\/\d{1,2}|yesterday)$/i;
    const time = lines.find((l) => timeRe.test(l)) || "";
    const rest = lines.filter((l) => l !== time && !/^(unread|flagged|pinned|has attachments?)$/i.test(l));
    const emailEl = row.querySelector('[title*="@"]');
    const from = rest[0] || "";
    const subject = rest[1] || "";
    const preview = rest.slice(2).sort((a, b) => b.length - a.length)[0] || "";
    rows.push({
      ref: row.getAttribute("data-convid") || row.getAttribute("id") || `row${i}:${from}:${subject}`.slice(0, 120),
      from: clean(from),
      fromEmail: clean(emailEl?.getAttribute("title")),
      subject: clean(subject),
      preview: clean(preview).slice(0, 400),
      time,
      unread: /\bunread\b/i.test(aria) || !!row.querySelector('[aria-label*="unread" i]'),
      flagged: /\bflagged\b/i.test(aria),
    });
  });
  return { signedIn: true, rows };
}

/** Turn Outlook's "16:04" / "Fri 12:30" / "25/09/2026" / "Yesterday" into a timestamp. */
export function mailTime(s: string, now = new Date()): number {
  const t = s.trim().toLowerCase();
  const hm = /(\d{1,2}):(\d{2})/.exec(t);
  const d = new Date(now);
  if (/^\d{1,2}:\d{2}$/.test(t) && hm) {
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    return d.getTime();
  }
  if (t.startsWith("yesterday")) {
    d.setDate(d.getDate() - 1);
    d.setHours(hm ? Number(hm[1]) : 12, hm ? Number(hm[2]) : 0, 0, 0);
    return d.getTime();
  }
  const wd = /^(mon|tue|wed|thu|fri|sat|sun)/.exec(t);
  if (wd) {
    const target = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wd[1]);
    let diff = (d.getDay() - target + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() - diff);
    d.setHours(hm ? Number(hm[1]) : 12, hm ? Number(hm[2]) : 0, 0, 0);
    return d.getTime();
  }
  const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (dmy) {
    const y = Number(dmy[3].length === 2 ? "20" + dmy[3] : dmy[3]);
    return new Date(y, Number(dmy[2]) - 1, Number(dmy[1]), 12).getTime();
  }
  return now.getTime();
}
