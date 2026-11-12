import "server-only";
// notificationPolicy, ENFORCED.
//
// The field existed on ModeDefinition from the first pass, was stored, was
// rendered in the mode builder, and was read by nothing. A setting that does
// not do anything is worse than a missing one: it tells the user their
// attention is protected while it isn't.
import type { NotificationItem } from "./types";

export type NotificationPolicy = "all" | "mentions_only" | "muted";

/** Types that count as "someone is talking to you", not "activity happened". */
const DIRECT: ReadonlySet<string> = new Set(["reply", "mention", "quote"]);

export function filterByPolicy<T extends { type: string }>(
  items: T[],
  policy: NotificationPolicy
): T[] {
  switch (policy) {
    case "muted":
      return [];
    case "mentions_only":
      return items.filter((n) => DIRECT.has(n.type));
    case "all":
    default:
      return items;
  }
}

/** The tab filter, which was also inert: every tab rendered the same list. */
export function filterByTab(items: NotificationItem[], tab: string): NotificationItem[] {
  if (tab === "mentions") return items.filter((n) => DIRECT.has(n.type));
  // Priority: things a person did toward you, not aggregate engagement.
  if (tab === "priority") return items.filter((n) => n.type !== "like" && n.type !== "recast");
  return items;
}
