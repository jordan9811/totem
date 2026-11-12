// PERSONA LAUNCH P3 (D4) — ANON SLOT ACCOUNTING. PURE and browser-safe on purpose: no "server-only", no process.env,
// no node:* import, no fetch. P7 moves the prover into the visitor's tab (a Web Worker) and P8's x-anon-post claims a
// slot of its own; both run this file as-is. K is always a PARAMETER: the caller passes the client's own K
// (lib/zk/config.ts ZK_ANON_POST_SLOTS), never a number a validator served (lib/zk/gate.ts says why).
//
// THE MODEL. A person (one root) may post anonymously K times per window, from any of their personas. Each post proves
// under the scope `anon-post/w<n>/s<i>` for a slot i < K: one nullifier per (person, window, slot). So
//   • two posts by one person in one window carry DIFFERENT nullifiers (different slots) — unlinkable to the operator;
//   • a (K+1)th post has no free slot, and re-using a slot re-emits that slot's nullifier — a replay the validator
//     refuses;
//   • the budget is the PERSON's: the slot set is computed over every anon post this device queued, whatever persona
//     it was posted as.
//
// WHY THE SLOT IS DRAWN UNIFORMLY (never lowest-first): the slot index rides the wire. Lowest-first would make slot 0
// mean "this person's first post of the window" and slot 3 "a heavy poster" — a per-post label the operator could
// join on. A uniform draw over the free slots makes the index of any one post carry nothing beyond "a free slot"; the
// residual — two posts of one window from one person never share a slot, so a pair that DOES share one is two people —
// is measured by the linkage suite and stated as A-ANON-SLOT-INDEX-VISIBLE, never hidden.

/** the window part of a qualifier, as lib/zk/config.ts anonPostWindowOf() renders it */
export const ANON_WINDOW_RE = /^w\d{1,12}$/;
/** the ONLY anon-post scope qualifier both sides accept: "w<n>/s<i>" (the bare "w<n>" is refused — a (K+1)th scope) */
export const ANON_SLOT_QUALIFIER_RE = /^w\d{1,12}\/s\d{1,2}$/;

/** "w<n>/s<i>" — the qualifier lib/zk/scopes.ts and validator/zk.js both build the anon scope from. Throws on a
 *  malformed window or a slot that is not a small non-negative integer (the K bound is the scope registry's). */
export function slotQualifier(window: string, slot: number): string {
  if (typeof window !== "string" || !ANON_WINDOW_RE.test(window)) throw new Error("anon slots: the window must be w<n>");
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new Error("anon slots: the slot must be an integer from 0 to 99");
  return `${window}/s${slot}`;
}

/** the inverse of slotQualifier; null for anything else */
export function parseSlotQualifier(q: unknown): { window: string; slot: number } | null {
  if (typeof q !== "string" || !ANON_SLOT_QUALIFIER_RE.test(q)) return null;
  const at = q.indexOf("/s");
  return { window: q.slice(0, at), slot: Number(q.slice(at + 2)) };
}

/** one anon post this device knows about, reduced to what the accounting needs */
export interface SlotItem {
  /** the window of the epoch it was proved in ("w<n>") */
  window: string;
  /** the slot it proved under; null/undefined for a pre-P3 item (it used the retired bare-window scope) */
  slot?: number | null;
  status: string;
  outcome?: string | null;
}

/** does this item hold its slot? A queued item will spend it; a sent one that was accepted spent it, and a REPLAY
 *  means the validator already holds that slot's nullifier (spent by this person from another device, or a duplicate
 *  send) — held either way. A refused or transport-failed one consumed nothing. */
export function slotHeld(item: SlotItem): boolean {
  if (item.status === "queued") return true;
  return item.status === "sent" && (item.outcome === "accepted" || item.outcome === "replay");
}

/**
 * The slots of `window` this person has used, and how much of the window's budget is consumed counting the posts
 * still WANTED (composed, not yet proved — they have no slot until the tick assigns one).
 */
export function usedSlots(items: ReadonlyArray<SlotItem>, wanted: number, window: string): { used: Set<number>; wanted: number; consumed: number } {
  const used = new Set<number>();
  for (const it of items) {
    if (it.window !== window || !slotHeld(it)) continue;
    if (Number.isInteger(it.slot) && (it.slot as number) >= 0) used.add(it.slot as number);
  }
  const w = Math.max(0, Math.floor(Number.isFinite(wanted) ? wanted : 0));
  return { used, wanted: w, consumed: used.size + w };
}

/** the free slots of a window, ascending */
export function freeSlots(used: ReadonlySet<number>, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < k; i++) if (!used.has(i)) out.push(i);
  return out;
}

/** a uniform integer in [0, n) from the platform CSPRNG (crypto.getRandomValues — Node and every browser), by rejection
 *  sampling so no index is favoured. Never Math.random. */
export function csprngIndex(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new Error("anon slots: csprngIndex needs 1 <= n <= 2^32");
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("anon slots: no CSPRNG on this platform — refusing to pick a slot");
  const limit = Math.floor(0x100000000 / n) * n; // the largest multiple of n below 2^32
  const buf = new Uint32Array(1);
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** A free slot drawn UNIFORMLY over the free ones (see the header — never the lowest); null when the window is full. */
export function pickFreeSlot(used: ReadonlySet<number>, k: number, rand: (n: number) => number = csprngIndex): number | null {
  const free = freeSlots(used, k);
  if (free.length === 0) return null;
  return free[rand(free.length)];
}

/** has this person used the window's whole budget (posts already slotted plus posts waiting for their proof)? */
export function windowFull(consumed: number, k: number): boolean {
  return consumed >= k;
}

// ---------------------------------------------------------------------------------- PERSONA LAUNCH P8: the X slots
//
// An anonymous X copy (claim kind x-anon-post) spends an X SLOT, never an anon-post slot: K_X per person per window
// (lib/zk/config.ts ZK_X_ANON_POST_SLOTS, default 1), under its own scope feature, so its nullifier never equals an
// anon-post slot's. The accounting is the same model as above; these names keep the two budgets apart at every call
// site (a K mixed up with K_X would let an X copy spend a Farcaster slot or the other way round). K_X is always the
// caller's OWN — never a served number.

/** "w<n>/s<i>" for an X slot — the same shape as the anon qualifier; the K_X bound is the scope registry's */
export function xSlotQualifier(window: string, slot: number): string {
  return slotQualifier(window, slot);
}
/** a free X slot drawn UNIFORMLY over the free ones (never the lowest); null when this window's X slots are spent */
export function pickFreeXSlot(used: ReadonlySet<number>, kx: number, rand: (n: number) => number = csprngIndex): number | null {
  return pickFreeSlot(used, kx, rand);
}
/** has this person used the window's X budget (X copies already slotted plus those waiting for their proof)? */
export function xWindowFull(consumed: number, kx: number): boolean {
  return consumed >= kx;
}
/** the X refusal, in plain words */
export function xWindowFullSentence(kx: number, windowHours: number): string {
  const hours = Number.isFinite(windowHours) && windowHours > 0 ? Math.round(windowHours * 10) / 10 : 6;
  return kx === 1
    ? `You have already sent a post to @totem on X in this ${hours}-hour window. One is allowed per window, shared across your personas.`
    : `You have used all ${kx} posts to @totem on X for this ${hours}-hour window. They are shared across your personas.`;
}

/** the refusal, in plain words (D4: shared across the person's personas) */
export function windowFullSentence(k: number, windowHours: number): string {
  const hours = Number.isFinite(windowHours) && windowHours > 0 ? Math.round(windowHours * 10) / 10 : 6;
  return `You have used all ${k} anonymous posts for this ${hours}-hour window. They are shared across your personas.`;
}

/** the composer's cadence sentence (D4). PERSONA LAUNCH P3 (UX-2): with a LIFETIME cap on the anonymous account (the
 *  owner service keeps 1 until its first live cast has been checked) the sentence says so — the K-per-window promise
 *  alone read as "4 every 6 hours" where the second post was always going to be refused. */
export function cadenceSentence(k: number, windowHours: number, lifetimeCap?: number | null): string {
  const hours = Number.isFinite(windowHours) && windowHours > 0 ? Math.round(windowHours * 10) / 10 : 6;
  const base = `Up to ${k} every ${hours} hours, shared across your personas.`;
  if (typeof lifetimeCap !== "number" || !Number.isInteger(lifetimeCap) || lifetimeCap < 0) return base;
  return `${base} For now the anonymous account is limited to ${lifetimeCap} post${lifetimeCap === 1 ? "" : "s"} in total.`;
}

// ---------------------------------------------------------------------------------- the RELAY's own budgets (UX-2)
//
// Besides the person's K per window, the VALIDATOR caps the anonymous account itself: a LIFETIME live cap (the owner
// service: 1 until the owner has checked the first live cast, validator/zk.js anonLiveCap) and a global DAILY cap (500;
// every universe). It refuses an envelope past either one at submission — after the composer cleared the box. These
// read the validator's signed config (fetchAnonPostConfig: `cap` with `relayed` + `pending`, `dailyCap` with
// `dailyUsed`) so the composer can say "not now" BEFORE the post, and turn the validator's refusal into plain words
// (no variable names: the owner reads these, not an operator).

export interface RelayBudget {
  cap?: number | null;
  relayed?: number;
  pending?: number;
  dailyCap?: number;
  dailyUsed?: number;
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** why the anonymous account cannot take another post right now, in plain words — null when it can (or when the counts
 *  are not served: an unsigned read carries none, and the validator still refuses at submission). `waiting`: this
 *  device's own anon posts that have not reached the validator's counts yet (composed and waiting for their proof,
 *  queued, or sent after the config was read) — on the single-tenant owner service the first post sits there for up to
 *  a tick plus the jitter before the validator counts it, and a second compose in that time was refused only later. */
export function relayCapReason(mode: "fixture" | "live", c: RelayBudget | null | undefined, waiting = 0): string | null {
  if (!c) return null;
  const ahead = count(waiting);
  if (mode === "live" && typeof c.cap === "number" && Number.isFinite(c.cap) && count(c.relayed) + count(c.pending) + ahead >= c.cap) {
    if (c.cap <= 0) return "posting through the anonymous account is switched off for now";
    return c.cap === 1
      ? "the anonymous account has made the one post it's allowed for now — raise the limit once you've checked that post"
      : `the anonymous account has made the ${c.cap} posts it's allowed for now — raise the limit to post more`;
  }
  if (typeof c.dailyCap === "number" && Number.isFinite(c.dailyCap) && typeof c.dailyUsed === "number" && c.dailyUsed + ahead >= c.dailyCap) {
    return "today's anonymous posts are used up — posting opens again tomorrow";
  }
  return null;
}

/** the validator's own refusal reason (validator/zk.js, the signed reader's lastRefusal) in plain words: the cap
 *  refusals mapped, and an environment variable's name never shown. `cap` says whether posting again can help now. */
export function plainRelayRefusal(reason: string | null | undefined): { text: string; cap: boolean } {
  const r = typeof reason === "string" ? reason : "";
  if (/ZK_ANON_POST_LIVE_CAP|live relay cap/i.test(r)) return { text: "the anonymous account has reached its posting limit for now", cap: true };
  if (/ZK_ANON_POST_DAILY_CAP|anonymous post limit/i.test(r)) return { text: "today's anonymous posts are used up; posting opens again tomorrow", cap: true };
  // anything else: its words, without a variable name in brackets or bare
  const text = r.replace(/\s*\(\s*[A-Z][A-Z0-9_]{3,}\s*\)/g, "").replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, "a server setting").replace(/^anon relay refused:\s*/i, "").trim();
  return { text: text || "the anonymous channel gives no reason by design", cap: false };
}
