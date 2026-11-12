// MEGA PASS 2 Gate 3 — CONFIGURABLE ACTION BUTTONS. Pure (no node, no
// server-only): the card, the picker, the mode builder and the API's
// validator all read this one registry.
//
// The per-cast action row is BINDABLE per mode. Modes already carry
// `actionButtonSlots` (composer, nav); this adds `cast`: the row's
// bindings, one action id per slot. The DEFAULT reproduces X's row
// exactly — reply, recast, like, views, bookmark, share, in that order,
// with the same components — so parity is untouched until the user
// changes something. Long-press on any button opens its binding.

export const CAST_ACTIONS = [
  "reply",
  "recast",
  "like",
  "views",
  "bookmark",
  "share",
  "stake-as",
  "bookmark-to-folder",
  "send-to-friend",
  "mark-caught-up",
  "act-as",
  "refute",
  "note",
  "custom-rule",
] as const;
export type CastAction = (typeof CAST_ACTIONS)[number];

/** X's row, exactly — the parity baseline */
export const DEFAULT_CAST_ROW: readonly CastAction[] = Object.freeze(["reply", "recast", "like", "views", "bookmark", "share"]);

export const CAST_ACTION_LABELS: Record<CastAction, string> = {
  reply: "Reply",
  recast: "Repost",
  like: "Like",
  views: "Views",
  bookmark: "Bookmark",
  share: "Share",
  "stake-as": "Stake as…",
  "bookmark-to-folder": "Bookmark to folder",
  "send-to-friend": "Send to a friend",
  "mark-caught-up": "Mark caught up",
  "act-as": "Act as…",
  refute: "Mark as refutation",
  note: "Concur with the note",
  "custom-rule": "Custom rule trigger",
};

export const MAX_CAST_SLOTS = 8;

export function isCastAction(x: unknown): x is CastAction {
  return typeof x === "string" && (CAST_ACTIONS as readonly string[]).includes(x);
}

/** the row a mode renders: its binding if it has one, X's row otherwise */
export function castRowFor(slots: { cast?: string[] } | null | undefined): CastAction[] {
  const row = slots?.cast;
  if (!Array.isArray(row) || !row.length) return [...DEFAULT_CAST_ROW];
  const out = row.filter(isCastAction);
  return out.length ? out : [...DEFAULT_CAST_ROW];
}

export function isDefaultRow(row: readonly string[]): boolean {
  return row.length === DEFAULT_CAST_ROW.length && row.every((a, i) => a === DEFAULT_CAST_ROW[i]);
}

/** validate a proposed row — never repairs; the reason names the slot */
export function validateCastRow(raw: unknown): { row: CastAction[] | null; reason?: string } {
  if (!Array.isArray(raw)) return { row: null, reason: "the row must be a list of action ids" };
  if (raw.length < 1 || raw.length > MAX_CAST_SLOTS) return { row: null, reason: `the row holds 1..${MAX_CAST_SLOTS} buttons` };
  const seen = new Set<string>();
  const row: CastAction[] = [];
  for (const [i, a] of raw.entries()) {
    if (!isCastAction(a)) return { row: null, reason: `slot ${i + 1}: unknown action "${String(a)}"` };
    if (seen.has(a)) return { row: null, reason: `slot ${i + 1}: "${a}" is already bound` };
    seen.add(a);
    row.push(a);
  }
  return { row };
}
