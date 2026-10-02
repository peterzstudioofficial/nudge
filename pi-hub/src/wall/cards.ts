import type { WallCard, WallShown } from "@nudge/shared";
import { type Hub, newId } from "../hub";
import { docPages, listDocs } from "../rag/library";

/**
 * What's up on the wall: one card at a time (a longer answer, a list, one big number, a page of
 * a document, a timer). It's kept on the Pi so a reload or a restart brings it back, and it goes
 * away on its own so the screen can doze.
 */
export interface WallCards {
  current(): WallShown | null;
  show(card: WallCard): WallShown;
  /** turn a document's page, add minutes to a timer, or keep anything else up a bit longer */
  page(delta: number): WallShown | null;
  close(): void;
  /** open one of their documents at a page; null if there's no such document */
  openDoc(docId: string, page: number): WallShown | null;
}

const KEY = "wallCard";
/** how long a card stays up after the last look (the screen dozes before this anyway) */
const STAY_MS = 10 * 60_000;
/** a page is up to this long on the wall; longer pages are cut (the dial scrolls what's there) */
const PAGE_CHARS = 6000;

export function wallCards(o: { hub: Hub; say: (icon: string, line: string, sub?: string, ms?: number) => void; now?: () => number }): WallCards {
  const { hub } = o;
  const now = o.now ?? (() => Date.now());
  let cur = hub.db.kvGet<WallShown | null>(KEY, null);
  let timer: NodeJS.Timeout | null = null;

  const save = (next: WallShown | null) => {
    cur = next;
    hub.db.kvSet(KEY, next);
    arm();
    hub.bus.changed("wall");
  };
  // One timeout: the card's own end (a timer going off, or it timing out).
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!cur) return;
    const shown = cur;
    timer = setTimeout(() => {
      if (cur?.id !== shown.id) return;
      if (shown.card.kind === "timer") o.say("timer", "time's up", shown.card.label.toUpperCase().slice(0, 40), 8000);
      save(null);
    }, Math.max(0, shown.until - now()));
    timer.unref();
  };
  arm();

  const until = (card: WallCard) => (card.kind === "timer" ? card.endsAt : now() + STAY_MS);
  const docCard = (docId: string, page: number): WallCard | null => {
    const d = listDocs(hub).find((x) => x.id === docId);
    const pages = d ? docPages(hub, docId) : [];
    if (!d || !pages.length) return null;
    const p = Math.min(Math.max(1, page), pages.length);
    const pg = pages.find((x) => x.n === p) ?? pages[p - 1];
    return { kind: "doc", docId, title: d.title, page: pg.n, pages: pages.length, slides: d.kind === "slides", body: pg.text.slice(0, PAGE_CHARS) || "(this page is blank)" };
  };

  return {
    current() {
      if (cur && cur.until <= now()) save(null);
      return cur;
    },
    show(card) {
      const s: WallShown = { id: newId(), card, at: now(), until: until(card) };
      save(s);
      return s;
    },
    page(delta) {
      if (!cur) return null;
      if (cur.card.kind === "doc" && delta) {
        const c = docCard(cur.card.docId, cur.card.page + delta);
        if (c) save({ ...cur, card: c, until: now() + STAY_MS });
        return cur;
      }
      if (cur.card.kind === "timer") {
        // "+1 min" on the wall's key (never shorter: cancel is its own key)
        if (delta > 0) {
          const endsAt = Math.min(cur.card.endsAt + delta * 60_000, now() + 3 * 3600_000);
          save({ ...cur, card: { ...cur.card, endsAt, secs: cur.card.secs + Math.round((endsAt - cur.card.endsAt) / 1000) }, until: endsAt });
        }
        return cur;
      }
      save({ ...cur, until: now() + STAY_MS });
      return cur;
    },
    close() {
      if (cur) save(null);
    },
    openDoc(docId, page) {
      const c = docCard(docId, page);
      return c ? this.show(c) : null;
    },
  };
}
