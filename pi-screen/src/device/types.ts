export type Mode =
  | "boot" | "standby" | "select" | "countdown" | "active" | "paused" | "break" | "resumeScan" | "overrun"
  | "claim" | "award" | "bag" | "reward" | "unlock" | "nextReward" | "alarm" | "brief" | "welcome" | "breathe"
  | "doze" | "sleep" | "night" | "about" | "bright" | "disco" | "update" | "offline" | "agent" | "agent2"
  | "resume" | "pair";

export interface Slab {
  icon: string;
  line: string;
  sub?: string;
  tail?: string;
  ask?: boolean;
  askId?: string;
  rows?: { k: string; v: string }[];
  wave?: boolean;
  spin?: boolean;
  leaving?: boolean;
  /** reminder id to ack when it leaves */
  reminderId?: string;
}

export interface Key {
  label: string;
  act: () => void;
  tone?: "primary" | "live";
}

export type Plan = [Key | null, Key | null, Key | null, Key | null];

/** Simulator overrides — only used by the dev panel. */
export interface SimOverrides {
  clockOffsetMs: number;
  dayKind: "school" | "weekend" | "halfterm" | null;
  /** a screen picked from the states list; cleared by the next real input */
  forced: import("./types").Mode | null;
}
