// ANON REVIEW (R1-09, A2-6, R3-10) — condition 10 of the privacy label, made ONE pure decision that the label, the
// compose gate, the proving tick and the node-only harness all call: is the validator's anon relay account a
// credential AND a fid distinct from everything this app is?
//
// The joins it refuses, named:
//   same-key   the validator relays with THIS app's Neynar key (Neynar joins the anon cast to every persona write)
//   throwaway  the anon fid is the app's own test account (FC_TEST_FID)
//   persona    the anon fid is one of this device's persona fids — hidden siblings included (R3-11)
//   seed-self  fid 9152 (@warpcast, the fid the seed borrowed; never an account the owner controls)
// What it cannot see, said in the ok detail: a distinct key under the SAME Neynar developer account does not hide the
// anon account from Neynar the company (it serves both keys); only a distinct Neynar app narrows what one credential's
// logs can join.
//
// No "server-only": the harness imports it directly.
import { createHash } from "@/lib/platform/crypto";

/** @warpcast — the fid the seed borrowed for the demo self; scripts/owner refuse it everywhere for the same reason */
export const SEED_SELF_FID = 9152;

/** the validator's fingerprint of a key: sha256, first 12 hex (DELIBERATE DUPLICATE of validator/zk.js keyFingerprint) */
export function keyFingerprint(key: string): string | null {
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : null;
}

export interface RelayAccountFacts {
  mode: "fixture" | "live";
  /** the validator reports a named, armed, approvable live relay account */
  liveRelay: boolean;
  fid: number;
  relayKeyFingerprint: string | null;
}

export interface OwnIdentityFacts {
  /** fingerprint of THIS app's own NEYNAR_API_KEY (null when the app holds none) */
  ownKeyFingerprint: string | null;
  /** FC_TEST_FID — the app's throwaway account (null when unset) */
  throwawayFid: number | null;
  /** every fid this device's persona records hold, visible or hidden siblings alike; null = could not be read */
  personaFids: number[] | null;
}

export type RelayJoin = "none" | "not-live" | "no-relay" | "unknown" | "same-key" | "throwaway" | "persona" | "seed-self";

export interface RelayAccountVerdict {
  ok: boolean;
  join: RelayJoin;
  detail: string;
}

export function relayAccountVerdict(a: RelayAccountFacts, own: OwnIdentityFacts): RelayAccountVerdict {
  if (a.mode !== "live") return { ok: false, join: "not-live", detail: "fixture universe — the relay is the validator's own row, not a network account" };
  if (!a.liveRelay) return { ok: false, join: "no-relay", detail: "the validator reports no armed live anon relay account" };
  if (!a.relayKeyFingerprint || !own.ownKeyFingerprint) {
    return { ok: false, join: "unknown", detail: "relay credential fingerprint unavailable — cannot show the anon account is not this app's Neynar identity" };
  }
  if (a.relayKeyFingerprint === own.ownKeyFingerprint) {
    return { ok: false, join: "same-key", detail: "the validator relays with THIS app's Neynar key — Neynar can join the anon cast to every persona write under it (A-FID-NEYNAR-SEES-ALL)" };
  }
  if (!Number.isInteger(a.fid) || a.fid <= 0) return { ok: false, join: "no-relay", detail: "the validator names no anon fid" };
  if (own.throwawayFid !== null && a.fid === own.throwawayFid) {
    return { ok: false, join: "throwaway", detail: "the anon account is this app's own throwaway fid — created and signed for by the same developer credential" };
  }
  if (a.fid === SEED_SELF_FID) return { ok: false, join: "seed-self", detail: "the anon fid is 9152 (@warpcast, the fid the seed borrowed) — not an account this app controls" };
  if (own.personaFids === null) {
    return { ok: false, join: "unknown", detail: "this device's own account list could not be read — the anon fid cannot be shown to be none of your personas (fail closed)" };
  }
  if (own.personaFids.includes(a.fid)) {
    return { ok: false, join: "persona", detail: "the anon fid is one of YOUR persona accounts — 'anonymous' posts would come from a named account of yours" };
  }
  return {
    ok: true,
    join: "none",
    detail: "the anon relay account is a key and a fid distinct from this app's own and from every persona of yours (a distinct key under the same Neynar developer account still lets Neynar the company join both; only a separate Neynar app narrows that)",
  };
}

/** the joins the COMPOSE path refuses on the live universe (fail closed — A2-6): a known join, never an unknown one */
export function relayJoinRefusesPosting(v: RelayAccountVerdict): boolean {
  return v.join === "same-key" || v.join === "throwaway" || v.join === "persona" || v.join === "seed-self";
}
