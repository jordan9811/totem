// PERSONA LAUNCH P4 — THE RENDER SEAMS for what a ring member received (lib/feed.ts, lib/policy.ts, the profile route).
//
// From MEMORY only: no decrypt and no fetch at render (the tick did both). Every answer is null unless the record behind
// it is renderable right now (the latest drop read was FULL and showed it, its lease has not run out) — so an anon
// card for a non-member, or for a member whose last read failed, is exactly the card everyone else gets: the caller
// leaves the `ringShared` key ABSENT, never null.
//
// COMPARTMENT MODE hides both merges (lib/identity/chrome.ts viewScope): a ring is root-level, so under compartment
// mode no persona view shows it. The flag is read from the chrome document's in-process copy (the tick loads it on the
// schedule); a document that has not been read is treated as compartment ON — a merge is never shown on a guess.
import { zkMode } from "@/lib/zk/config";
import { recordForFid, revealFor, type RingReveal } from "./received";

export type { RingReveal } from "./received";

/** the chrome document's in-process copy (lib/identity/chrome.ts keeps it on this global; never fetched here) */
function compartmentOn(): boolean {
  const doc = (globalThis as unknown as { __layersPersonaChrome?: { compartment?: unknown; loaded?: unknown } }).__layersPersonaChrome;
  if (!doc || doc.loaded !== true) return true;
  return doc.compartment === true;
}

/** "@persona · shared with you by <label>" for one anon post, or null (the caller then sets NOTHING on the card) */
export function ringRevealForAnon(castHash: string, mode: "fixture" | "live" = zkMode()): RingReveal | null {
  if (typeof castHash !== "string" || !/^[0-9a-f]{64}$/.test(castHash)) return null;
  if (compartmentOn()) return null;
  return revealFor(mode, castHash);
}

/** the author fields for a card by an fid a ring shared with this device (main, a launched or fid-pass persona), or
 *  null. `linked` is the ROOT (left half of the avatar); its picture is an inline thumbnail or nothing — never a URL. */
export function mergedAuthorForFid(fid: number): { merged: true; linked: { username: string; displayName: string; pfpUrl: string; tier: string; thumb: string | null; sharedBy: string } } | null {
  if (compartmentOn()) return null;
  const hit = recordForFid(fid);
  if (!hit) return null;
  return {
    merged: true,
    linked: { username: hit.root.fname ?? "", displayName: hit.root.displayName, pfpUrl: "", tier: "ring", thumb: hit.root.thumb, sharedBy: hit.rec.label },
  };
}

/** for a profile: what a ring told this device about the account behind `fid` (names only), or null */
export function sharedForFid(fid: number): { label: string; root: RingReveal["root"]; persona: { handle: string; displayName: string; depth: string }; others: { handle: string; displayName: string }[]; expiresAt: number } | null {
  if (compartmentOn()) return null;
  const hit = recordForFid(fid);
  if (!hit) return null;
  return {
    label: hit.rec.label,
    root: hit.root,
    persona: { handle: hit.subject.handle, displayName: hit.subject.display, depth: hit.subject.depth },
    others: hit.rec.subjects.filter((x) => x.ref !== hit.subject.ref).map((x) => ({ handle: x.handle, displayName: x.display })),
    expiresAt: hit.rec.expiresAt,
  };
}
