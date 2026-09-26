import type { Role } from "./model";

/**
 * Capability table. The hub checks every request against it.
 *
 *  owner   — Peter's own devices (phone app, desktop). Plans and looks; runs the school sign-in.
 *  screen  — the wall itself (loopback only). Runs sessions, packs the bag, answers asks.
 *  desktop — the Windows app. Same as owner, plus the compose hand-off queue.
 *  parent  — the parent app. Sets tasks, rules and rewards; the only role that can end a session.
 */
export type Cap =
  | "read"
  | "session"          // start / pause / break / claim / switch
  | "session.end"      // end a session outright (parent only)
  | "tasks.plan"       // add / remove / edit tasks and weekly templates
  | "tasks.skip"
  | "bag"
  | "day.mark"         // away / holiday / sick
  | "day.arrive"
  | "notes"
  | "school.read"
  | "school.act"
  | "school.session"   // upload / clear the school sign-in
  | "agent"
  | "asks.answer"
  | "rewards.edit"
  | "rewards.ack"
  | "settings.owner"
  | "settings.parent"
  | "devices.manage"
  | "handoff";

const TABLE: Record<Role, Cap[]> = {
  owner: [
    "read", "day.mark", "notes", "school.read", "school.act", "school.session", "agent", "asks.answer",
    "settings.owner", "devices.manage", "tasks.skip", "bag", "session", "day.arrive",
  ],
  // Peter's computer: everything his phone can do, plus finishing email drafts by hand.
  desktop: [
    "read", "day.mark", "notes", "school.read", "school.act", "school.session", "agent", "asks.answer",
    "settings.owner", "devices.manage", "tasks.skip", "bag", "session", "day.arrive", "handoff",
  ],
  screen: [
    "read", "session", "tasks.skip", "bag", "day.arrive", "notes", "school.read", "school.act", "agent",
    "asks.answer", "settings.owner",
  ],
  parent: [
    "read", "tasks.plan", "rewards.edit", "rewards.ack", "settings.parent", "session.end", "day.mark",
    "school.read", "devices.manage",
  ],
};

export function can(role: Role, cap: Cap): boolean {
  return TABLE[role].includes(cap);
}
