// ZK PASS 1 — THE NULLIFIER SCOPE REGISTRY. One frozen module, versioned,
// with the same discipline as lib/crypto/kdf.ts's info strings: a scope
// string is assembled HERE and nowhere else. A caller never concatenates
// its own scope — that is precisely how two personas of one root end up
// emitting the same nullifier and handing the operator the attribution
// table this whole layer exists to destroy (VERIFY-YOURSELF F2).
//
// THE RULE (from the recommendation, treated as a requirement):
//   per-persona gates  scope on (feature, epoch, personaId)
//   one-per-human      scope on (feature, epoch) — and MUST be declared
//                      `onePerHuman: true` at the registry entry, because
//                      that scope DELIBERATELY collides siblings.
//
// THE LINKAGE ARGUMENT (why this is safe, per entry, written down):
//   nullifier = Poseidon(semaphoreHash(scopeValue), secret)   [semaphore.circom]
//   scopeValue = fieldOf("scope", scopeString)                [lib/zk/hash.ts]
//   For two personas P1 ≠ P2 of ONE root (same secret), a per-persona
//   scope yields two scopeStrings that differ in the personaId component,
//   hence (SHA-256 collision resistance) two distinct scopeValues, hence
//   (keccak collision resistance) two distinct circuit scope inputs, hence
//   (Poseidon collision resistance) two distinct nullifiers. Nullifier
//   equality across personas is therefore not observable by the validator
//   unless the entry is onePerHuman — in which case equality is the
//   intended, disclosed semantic ("one proof per human per epoch").
//   For two DIFFERENT roots, secrets differ, so nullifiers differ even at
//   an identical scope (that is what makes one-per-human counting sound).
//   Across EPOCHS the epoch component differs, so the same persona's
//   nullifiers are unlinkable epoch to epoch at the nullifier layer —
//   NOTE this says nothing about personaId riding the public signal in
//   the clear (F2b), which the proof-history budget bounds, not this file.
//
// WHAT THIS FILE DOES NOT DEFEND: metadata. Submission timing, the
// personaId in the signal, IP, join-epoch. Those are Gate 1 / the budget /
// the posture doc. A correct scope table is necessary, not sufficient.
//
// VERSIONING: SCOPE_DOMAIN carries the version. Bumping it changes every
// nullifier (every persona may prove again in the new universe). Do it
// only with a migration plan; never edit an existing entry's `feature`
// string in place — add a new entry.

import { ZK_ANON_POST_SLOTS, ZK_X_ANON_POST_SLOTS } from "./config";
import { ANON_SLOT_QUALIFIER_RE } from "./anon/slots";

export const SCOPE_DOMAIN = "layers/zk-scope/v1";

export interface ScopeEntry {
  /** registry id — what call sites name */
  readonly id: string;
  /** the string that enters the scope (frozen; never reuse across entries) */
  readonly feature: string;
  /** TRUE only for one-per-human semantics: siblings COLLIDE by design. */
  readonly onePerHuman: boolean;
  /** the human-readable linkage argument for this entry */
  readonly linkage: string;
}

/**
 * Every scope in the system. Adding one is a reviewed change: write its
 * linkage line, decide onePerHuman explicitly, and the adversarial
 * collision test (scripts/accept-z0.mjs) will exercise it automatically —
 * it iterates this registry, generates nullifiers for two personas of one
 * root, and asserts they DIFFER unless onePerHuman is declared here.
 */
export const SCOPE_REGISTRY: ReadonlyArray<ScopeEntry> = Object.freeze([
  Object.freeze({
    id: "discovery-tier",
    feature: "discovery-tier",
    onePerHuman: false,
    linkage:
      "Per-persona, per-epoch. Two personas of one root produce different " +
      "nullifiers (personaId in scope); one persona produces one nullifier " +
      "per epoch (replay of the same eligibility proof is refused, a new " +
      "epoch is a new scope). The validator learns 'this persona proved " +
      "tier≥T this epoch' — which it must, to grant eligibility — and " +
      "cannot pair it with a sibling through nullifier equality.",
  }),
  Object.freeze({
    id: "one-human-attest",
    feature: "one-human-attest",
    onePerHuman: true,
    linkage:
      "RESERVED — no gate uses it in Pass 1. One-per-HUMAN semantics: the " +
      "scope omits personaId, so every persona of a root emits the SAME " +
      "nullifier in an epoch. That collision is the feature (one claim per " +
      "human) and it is a DISCLOSED persona→persona link for whoever " +
      "observes both proofs. Any future call site must name that at the " +
      "point of use (C7: an opt-in waiver, never covered by blanket " +
      "unlinkability copy).",
  }),
  Object.freeze({
    id: "fork-continuity",
    feature: "fork-continuity",
    onePerHuman: false,
    linkage:
      "ZK PASS 2 Gate 3. Per-persona on the NEW persona, per-epoch. The " +
      "proof is a membership proof in the GATE's tier tree whose " +
      "MESSAGE binds a fork COMMITMENT sha256('layers-fork-commit/1|old|" +
      "new|nonce'); the validator re-derives the message from the " +
      "commitment it is given and never sees the old persona — only a " +
      "holder of the disclosure-gated forward pointer (who is handed the " +
      "nonce) can open the commitment and check the claim. WHAT IT PROVES " +
      "(attack-z2-3 #2): a tier-T leaf authorises the new persona and " +
      "attached this commitment — a VOUCH; identity continuity old → new " +
      "rests on the forward pointer signed by the OLD persona's key, never " +
      "on this proof alone (A-Z3-FORK-CLAIM-IS-A-VOUCH). Nullifiers: " +
      "the feature string differs from discovery-tier, so the new " +
      "persona's fork nullifier never equals its tier nullifier; the " +
      "personaId component differs from the old persona's, so old and new " +
      "never collide; epochs differ across epochs. What the validator " +
      "learns: 'persona N proved tier≥T under commitment H this epoch' — " +
      "the tier carries to N THROUGH the proof, never through a root read.",
  }),
  Object.freeze({
    id: "anon-post",
    feature: "anon-post",
    onePerHuman: true,
    linkage:
      "MULTI-FID PASS Gate 4 — the anoncast pattern; PERSONA LAUNCH P3 — K slots. " +
      "ONE NULLIFIER PER (PERSON, WINDOW, SLOT): the scope omits the persona (the " +
      "public signal carries the constant 'anon', never a persona id) and is qualified " +
      "by the WINDOW index floor(epoch / ZK_ANON_POST_WINDOW_EPOCHS) AND a SLOT i < K " +
      "(ZK_ANON_POST_SLOTS, default 4) — 'w<n>/s<i>'. So a person posts anonymously " +
      "at most K times per window: each post spends one slot, a re-used slot re-emits " +
      "that slot's nullifier and the validator refuses it as a replay, and the bare " +
      "window is refused on both sides (it would be a (K+1)th nullifier). The slots " +
      "are SHARED across a person's personas — every persona of a root emits the same " +
      "nullifier for the same (window, slot), the disclosed semantic — while two posts " +
      "of one person in one window sit in different slots and share NO nullifier, so " +
      "the operator cannot pair them by nullifier. Neither the tree nor the persona is " +
      "in the scope, deliberately (P5 seam: proving a different reach tree must not " +
      "mint more slots). The proof is membership in the CONFIGURED gate tree whose " +
      "MESSAGE binds the cast's content hash — one proof authorises exactly one text. " +
      "What the validator learns: 'some member of tree T posted this text in window W, " +
      "in slot i'. The slot index is VISIBLE on the wire (the validator can compute a " +
      "person's K candidate scopes for a window, and two posts that share a slot are " +
      "two people — A-ANON-SLOT-INDEX-VISIBLE, measured by the linkage suite) and is " +
      "never stored: no column, no log. The slot is drawn uniformly over the free ones " +
      "(lib/zk/anon/slots.ts), never lowest-first. No persona, no root, no attribution " +
      "row; a relayed cast attributed to no one in every client (C7 waiver: the anon " +
      "composer states 'up to K every window, shared across your personas' at the " +
      "point of use). PERSONA LAUNCH P5 (reach tiers): a post may prove the plain anon " +
      "tree OR a reach tree attest:<fc.reach|x.reach>/<gte-1k|gte-10k|gte-100k>, and THE " +
      "TREE IS DELIBERATELY NOT IN THE SCOPE: the slots are the person's whatever tree a " +
      "post proves, so proving a different reach tree never mints a (K+1)th nullifier, and " +
      "a slot re-used under another tree re-emits the same nullifier (a replay). The tree " +
      "rides every post in the clear (A-REACH-TREE-ON-EVERY-POST) and is recorded on the " +
      "row for the For You label.",
  }),
  Object.freeze({
    id: "persona-launch",
    feature: "persona-launch",
    onePerHuman: true,
    linkage:
      "PERSONA LAUNCH P6. One launch request per person per window; qualifier w<n> only; " +
      "no slot, no persona, no tree; the launch request carries the constant anon. The " +
      "scope omits the persona and is qualified by the WINDOW index alone (the window " +
      "replaces the epoch, as for anon-post), so every persona of a root emits the SAME " +
      "nullifier for a window's launch request — the disclosed semantic: a person may ask " +
      "for at most one launch per window, whichever persona it launches — and a second " +
      "request in that window is a replay the validator refuses. The feature string " +
      "differs from anon-post's, so a launch nullifier never equals any anon-post slot's. " +
      "The proof is membership in the plain anon tree whose MESSAGE binds launch:<commit>, " +
      "the sha256 commitment over the request the registrar queues (validator/registrar.js); " +
      "what the validator learns is 'some member of the anon tree asked for one launch in " +
      "window W' — never the root, never which persona (the request names only the new " +
      "account's custody address and profile).",
  }),
  Object.freeze({
    id: "x-anon-post",
    feature: "x-anon-post",
    onePerHuman: true,
    linkage:
      "PERSONA LAUNCH P8 — the anonymous copy for the @totem X outbox. ONE NULLIFIER PER " +
      "(PERSON, WINDOW, X SLOT): the scope omits the persona (the public signal carries the " +
      "constant 'anon') and is qualified by the WINDOW and an X slot i < K_X " +
      "(ZK_X_ANON_POST_SLOTS, default 1) — 'w<n>/s<i>'; the bare window is refused on both " +
      "sides. Every persona of a root emits the SAME nullifier for the same (window, X slot), " +
      "the disclosed semantic: a person sends at most K_X copies to X per window, whichever " +
      "persona they post as. The feature string differs from anon-post's, so an X nullifier " +
      "NEVER equals any anon-post slot's (D-X-SLOTS): an X copy spends no Farcaster slot and " +
      "the operator cannot pair the copy with its Farcaster sibling by nullifier. The proof is " +
      "membership in the PLAIN anon tree (no reach tier: X carries no boost) whose MESSAGE " +
      "binds x:<xHash>, sha256 over the copy's nonce and text under its own domain " +
      "('layers-x-anon/1', never the cast hash's). What the validator learns: 'some member of " +
      "the anon tree sent this text for X in window W, in X slot i'. What it does NOT stop, " +
      "stated: the copy has the SAME WORDS as its Farcaster sibling, so anyone can pair the two " +
      "by their text, and a later launch that reveals the sibling makes the copy read as the " +
      "persona's too (A-X-COPY-LINKED-BY-WORDS); the X slot index rides the wire like the anon " +
      "one (A-X-SLOT-INDEX-VISIBLE); the moderator reads every text (A-X-MODERATOR-SEES-TEXT).",
  }),
  Object.freeze({
    id: "attestation",
    feature: "attestation",
    onePerHuman: false,
    linkage:
      "ZK PASS 2 Gate 3 (scaffolding). Per-persona, per-epoch, per-ISSUER: " +
      "the feature is qualified — attestation/<issuer>/<bucket> — so two " +
      "issuers', and two BUCKETS of one issuer's, proofs for one persona in " +
      "one epoch have distinct nullifiers (attack-z2-3 #6; Attestation pass " +
      "Gate 1). Over the attest:<issuer>/<bucket> tree (the commitments " +
      "holding an active, unexpired, unrevoked issuance from that issuer in " +
      "that bucket — the coarse public attribute a gated surface predicates " +
      "on). The message binds the tree too, so an attestation proof is not " +
      "a tier proof and vice versa. Two personas " +
      "of one root produce different nullifiers (personaId in scope); " +
      "expiry drops the leaf, so proofs stop at the expiry epoch. The " +
      "validator learns 'persona P proved bucket B of issuer I this " +
      "epoch'. Issuers register on the validator under their own keys " +
      "(open registration); which of them THIS client honours is the " +
      "subscriber's choice (lib/attest/subscriber.ts).",
  }),
]);

export function scopeEntry(id: string): ScopeEntry {
  const e = SCOPE_REGISTRY.find((x) => x.id === id);
  if (!e) throw new Error(`zk scopes: unknown scope entry "${id}" — scopes are registered, never ad hoc`);
  return e;
}

/**
 * The frozen scope string. Fail-closed on misuse in BOTH directions: a
 * per-persona entry without a personaId would silently become a
 * one-per-human scope (collision!), and a one-per-human entry WITH a
 * personaId would silently lose its counting semantic.
 */
export function scopeString(entryId: string, epoch: number, personaId?: string, qualifier?: string): string {
  const e = scopeEntry(entryId);
  if (!Number.isInteger(epoch) || epoch < 0) throw new Error("zk scopes: epoch must be a non-negative integer");
  // ZK PASS 2 Gate 4 (attack-z2-3 #6): a QUALIFIED feature — "attestation/<issuer>" —
  // so two issuers' proofs for one persona in one epoch never share a nullifier.
  // Only the attestation entry takes a qualifier; it is REQUIRED there.
  // The PRODUCT path always qualifies an attestation claim (prove.ts passes
  // the issuer; the validator REQUIRES it on its side, so an unqualified
  // derivation can never verify). The bare feature remains the registry's
  // canonical string for the self-test, the probe and the collision suite.
  let feature = e.feature;
  if (e.id === "attestation" && qualifier !== undefined) {
    // Attestation pass Gate 1: "<issuer>/<bucket>" — two BUCKETS of one issuer
    // for one persona in one epoch must not share a nullifier either
    if (qualifier.length > 81 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(qualifier))
      throw new Error(`zk scopes: "${e.id}" qualifier (issuer/bucket) is malformed`);
    feature = `${e.feature}/${qualifier}`;
  } else if (e.id === "anon-post" && qualifier !== undefined) {
    // MULTI-FID Gate 4: the WINDOW index. PERSONA LAUNCH P3: the window AND the slot — "w<n>/s<i>", i < K — one anon
    // post per person per (window, slot). The bare "w<n>" is REFUSED here and on the validator: it was the pre-P3 scope,
    // and a client that could still prove under it would hold a (K+1)th nullifier. (The UNQUALIFIED call stays as it
    // was — the self-test and the collision suite's registry walk use it; the validator never verifies it.)
    if (!ANON_SLOT_QUALIFIER_RE.test(qualifier)) throw new Error(`zk scopes: "${e.id}" qualifier must be w<n>/s<i> (window and slot) — a bare window is refused`);
    const slot = Number(qualifier.slice(qualifier.indexOf("/s") + 2));
    if (slot >= ZK_ANON_POST_SLOTS) throw new Error(`zk scopes: "${e.id}" slot ${slot} is outside 0..${ZK_ANON_POST_SLOTS - 1}`);
    feature = `${e.feature}/${qualifier}`;
  } else if (e.id === "persona-launch" && qualifier !== undefined) {
    // PERSONA LAUNCH P6: the WINDOW alone — "w<n>". A slot here would hand a person K launch requests per window, so a
    // qualified form is refused on both sides (validator/zk.js scopeString); the UNQUALIFIED call stays valid for the
    // self-test and accept-z0's registry walk (the validator never verifies it).
    if (!/^w\d{1,12}$/.test(qualifier)) throw new Error(`zk scopes: "${e.id}" qualifier must be the window w<n> — no slot, no persona, no tree`);
    feature = `${e.feature}/${qualifier}`;
  } else if (e.id === "x-anon-post" && qualifier !== undefined) {
    // PERSONA LAUNCH P8: the window AND an X slot — "w<n>/s<i>", i < K_X (the client's own K_X); the bare window is
    // refused here and on the validator. The UNQUALIFIED call stays valid for the self-test and accept-z0's registry walk.
    if (!ANON_SLOT_QUALIFIER_RE.test(qualifier)) throw new Error(`zk scopes: "${e.id}" qualifier must be w<n>/s<i> (window and X slot) — a bare window is refused`);
    const xslot = Number(qualifier.slice(qualifier.indexOf("/s") + 2));
    if (xslot >= ZK_X_ANON_POST_SLOTS) throw new Error(`zk scopes: "${e.id}" X slot ${xslot} is outside 0..${ZK_X_ANON_POST_SLOTS - 1}`);
    feature = `${e.feature}/${qualifier}`;
  } else if (e.id !== "attestation" && qualifier !== undefined) {
    throw new Error(`zk scopes: "${e.id}" takes no qualifier`);
  }
  if (e.onePerHuman) {
    if (personaId !== undefined) {
      throw new Error(`zk scopes: "${e.id}" is onePerHuman — a personaId in its scope would break the counting semantic`);
    }
    // MULTI-FID Gate 5 (attack-fid-2 #6, attack-fid-3 #7): a WINDOW-qualified one-per-human scope carries the window
    // IN PLACE OF the epoch — one nullifier per root per window, so the validator's replay rule is the window rule
    if ((e.id === "anon-post" || e.id === "persona-launch" || e.id === "x-anon-post") && qualifier !== undefined) return `${SCOPE_DOMAIN}|${feature}`;
    return `${SCOPE_DOMAIN}|${feature}|${epoch}`;
  }
  if (!personaId || !/^[A-Za-z0-9_]{1,80}$/.test(personaId)) {
    throw new Error(`zk scopes: "${e.id}" is per-persona — a personaId is REQUIRED (omitting it would collide siblings)`);
  }
  return `${SCOPE_DOMAIN}|${feature}|${epoch}|${personaId}`;
}
