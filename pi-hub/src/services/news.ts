import type { Hub } from "../hub";
import type { NewsService } from "../context";

/** One local headline for the morning brief. Plain RSS, first item, cut to one sentence. */
export function newsService(hub: Hub, offline: boolean): NewsService {
  return {
    headline() {
      return hub.db.kvGet<string>("news", "");
    },
    async refresh() {
      const url = hub.settings().newsFeed;
      if (offline || !url) return;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const xml = await res.text();
        const item = /<item>[\s\S]*?<\/item>/.exec(xml)?.[0] ?? "";
        const pick = (tag: string) =>
          decode((new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(item)?.[1] ?? "").trim());
        const desc = pick("description");
        const title = pick("title");
        const line = (desc && desc.length < 110 ? desc : title).split(/(?<=\.)\s/)[0];
        if (line) {
          hub.db.kvSet("news", line.endsWith(".") ? line : line + ".");
          hub.bus.changed("news");
        }
      } catch {
        /* offline */
      }
    },
  };
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
