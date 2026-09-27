import type { Hub } from "../hub";

/** What the assistants cost, per month in US dollars (OpenRouter reports it per request). */
export function addSpend(hub: Hub, usd: number): void {
  const month = hub.todayKey().slice(0, 7);
  const all = hub.db.kvGet<Record<string, number>>("aiSpend", {});
  all[month] = Math.round(((all[month] ?? 0) + usd) * 1e6) / 1e6;
  hub.db.kvSet("aiSpend", all);
}

export function spend(hub: Hub): { month: string; usd: number; all: Record<string, number> } {
  const month = hub.todayKey().slice(0, 7);
  const all = hub.db.kvGet<Record<string, number>>("aiSpend", {});
  return { month, usd: all[month] ?? 0, all };
}
