import type { HubMessage } from "@nudge/shared";

type Sub = { send: (msg: HubMessage) => void; roles: Set<string> };

/** Change notifications to every connected screen. Topics let clients ignore what they don't show. */
export class Bus {
  rev = 1;
  private subs = new Set<Sub>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  subscribe(sub: Sub): () => void {
    this.subs.add(sub);
    return () => void this.subs.delete(sub);
  }

  get size(): number {
    return this.subs.size;
  }

  /** Coalesces bursts of writes into one "changed" message (20 ms). */
  changed(...topics: string[]): void {
    this.rev++;
    for (const t of topics) this.pending.add(t);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const msg: HubMessage = { type: "changed", rev: this.rev, topics: [...this.pending] };
      this.pending.clear();
      this.broadcast(msg);
    }, 20);
  }

  broadcast(msg: HubMessage, roles?: string[]): void {
    for (const s of this.subs) {
      if (roles && ![...s.roles].some((r) => roles.includes(r))) continue;
      try {
        s.send(msg);
      } catch {
        /* dead socket, cleaned up on close */
      }
    }
  }
}
