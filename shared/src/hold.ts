import type { Ask } from "./model";

/**
 * Anything that leaves the house (an email, a message or post in a connected app, work on the
 * computer, a paid build) can't be approved with a tap: it has to be held down, and not in the
 * first moment it appears. The hub enforces this; the wall and the apps show a fill-to-hold key.
 */
export const HOLD_KINDS: readonly Ask["kind"][] = ["email", "app", "claude", "build"];
export const HOLD_MS = 1200;
export const HOLD_MIN_SHOWN_MS = 1500;
export const askNeedsHold = (a: Pick<Ask, "kind">): boolean => HOLD_KINDS.includes(a.kind);
