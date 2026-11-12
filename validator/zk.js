"use strict";
// ZK PASS 1 — the validator's PUBLIC zk surface (migration 004).
//
// Trust posture, stated plainly (C1): the validator is TRUSTED for set
// contents. It decides which commitments populate each tree; the leaves
// are opaque, so a corrupt operator can place any commitment in tier-5
// undetectably. What the client CAN check: that the placement and the
// root history it is served are the ones the validator signed
// (auditable, not trustless), and that no per-client fork of the history
// is slipped past an anchored client. The trustless placement circuit is
// a later step, not this pass.
//
// Everything stored here is public. The ONE private value — the
// validator's own Ed25519 signing key — attests the validator's own
// statements and never touches user material.
//
// Epochs: trees are rebuilt per epoch from registrations. Registration is
// BATCHED: a commitment registered in epoch E becomes a leaf from epoch
// E+1 — never insert-then-immediately-prove (C10 join-time correlation).
// The residual leak is stated, not hidden: registration reveals
// account-existence and join-epoch to the validator.
//
// LOGGING DISCIPLINE (Gate 1's grep target): this module logs NOTHING —
// no IPs, no timestamps finer than the epoch, no request ordering.
const {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomInt,
  sign: cryptoSign,
} = require("node:crypto");
const { singleAnchor } = require("./db");
const path = require("node:path");
const fs = require("node:fs");
const { Group } = require("@semaphore-protocol/group");
const { Identity } = require("@semaphore-protocol/identity");
const { unpackGroth16Proof } = require("@semaphore-protocol/proof");
const snarkjs = require("snarkjs");
const { keccak_256 } = require("@noble/hashes/sha3");
const { verifyEd25519 } = require("./crypto");
const { tiersForRoots, scoreForRoot } = require("./rep");
// PERSONA LAUNCH P3 (D4): the relay cadence and the lifetime cap default by SHAPE — the public deployment gets the
// launch numbers, the rig and the owner service keep theirs. Read-only use of byx's env contract (never edited here).
const { isPublicDeployment } = require("./env-contract");

// Gate 2: the validator verifies LIVE proofs — for its OWN eligibility
// decision; the client never trusts this verdict (it verified against its
// build pin first). THE KEY IT USES IS THE PINNED FILE (attack-2 finding
// 2): read, hashed against the recorded ceremony verification, sliced per
// depth and handed to snarkjs.groth16.verify directly — never the copy
// @semaphore-protocol/proof inlines into its dist bundle, which no pin
// covered. A mismatch is a refusal to verify anything.
const CEREMONY_RECORD = require("../research/zk-ceremony-verification.json");
const VKEY_PATH = path.join(path.dirname(require.resolve("@semaphore-protocol/proof")), "..", "src", "verification-keys.json");
const MERKLE_TREE_DEPTH = 20;
function loadPinnedVkey(depth = MERKLE_TREE_DEPTH) {
  const buf = fs.readFileSync(VKEY_PATH);
  const rec = CEREMONY_RECORD.artifactsShipped.verificationKeyBundle;
  if (createHash("sha256").update(buf).digest("hex") !== rec.sha256 || buf.length !== rec.bytes) {
    throw new Error("validator verification key is not the recorded pin — refusing to verify");
  }
  const bundle = JSON.parse(buf.toString("utf8"));
  if (bundle.protocol !== "groth16" || bundle.curve !== "bn128" || bundle.nPublic !== 4) throw new Error("pinned vkey bundle has an unexpected shape");
  return {
    protocol: "groth16",
    curve: "bn128",
    nPublic: 4,
    vk_alpha_1: bundle.vk_alpha_1,
    vk_beta_2: bundle.vk_beta_2,
    vk_gamma_2: bundle.vk_gamma_2,
    vk_delta_2: bundle.vk_delta_2[depth - 1],
    vk_alphabeta_12: bundle.vk_alphabeta_12,
    IC: bundle.IC[depth - 1],
  };
}
function vkeyPinned() {
  try {
    loadPinnedVkey();
    return true;
  } catch {
    return false;
  }
}

const EPOCH_MS = Number(process.env.ZK_EPOCH_MS || 6 * 60 * 60 * 1000);
const HISTORY_WINDOW = Number(process.env.ZK_HISTORY_WINDOW || 64);
// read at call time so unit tests can toggle them without a re-require
const anonFloor = () => Number(process.env.ZK_ANON_FLOOR || 50);
const devHooksOn = () => process.env.ZK_DEV_HOOKS === "true";
// PERSONA LAUNCH P6: + "persona-launch" (DELIBERATE DUPLICATE of CLAIM_KINDS in lib/zk/transport/types.ts)
// PERSONA LAUNCH P8: + "x-anon-post" — an anonymous copy for the @totem X outbox (validator/xoutbox.js), its own slot
const CLAIM_KINDS = ["tier-membership", "fork-continuity", "attestation", "anon-post", "persona-launch", "x-anon-post"];
const MODES = ["fixture", "live"];
const FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const ZERO_HASH = "0".repeat(64);
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** tree names: "valid" (all active roots) + nested "tier-T" (rep >= T);
 * "attest:<issuer>/<bucket>" per issuer bucket that has an issuance. */
const TREES = ["valid", ...TIERS.map((t) => "tier-" + t)];
// ATTESTATION PASS Gate 1: an attestation tree is per (issuer, BUCKET) —
// "attest:onchain.wallet-age/gt2y". The bucket is the coarse public
// attribute a gated surface predicates on; the anonymity floor is enforced
// per bucket exactly as per tier (the client's cohort check refuses to
// prove into a bucket below its floor, so a thin bucket is honoured
// NOWHERE). Issuer ids are namespaced lowercase ("onchain.wallet-age",
// "test.mock-issuer"); a tree that was not issued (frozen) for an epoch is
// served as 404 for that epoch. Deliberate duplicate of lib/attest/ids.ts.
const ISSUER_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const BUCKET_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const validIssuer = (x) => typeof x === "string" && x.length <= 48 && ISSUER_RE.test(x);
const validBucket = (x) => typeof x === "string" && x.length <= 32 && BUCKET_RE.test(x);
const attestTreeName = (issuer, bucket) => "attest:" + issuer + "/" + bucket;
const parseAttestTree = (t) => {
  if (typeof t !== "string" || !t.startsWith("attest:")) return null;
  const parts = t.slice(7).split("/");
  if (parts.length !== 2 || !validIssuer(parts[0]) || !validBucket(parts[1])) return null;
  return { issuer: parts[0], bucket: parts[1] };
};
const isAttestTree = (t) => parseAttestTree(t) !== null;
const isKnownTree = (t) => TREES.includes(t) || isAttestTree(t);
function treesFor(db, mode) {
  // only a REGISTERED issuer's buckets are trees (Gate 4: scaffold rows of an unregistered issuer are not a universe)
  const rows = db
    .prepare("SELECT DISTINCT a.issuer, a.bucket FROM zk_attestations a JOIN zk_issuers i ON i.mode = a.mode AND i.id = a.issuer WHERE a.mode = ? ORDER BY a.issuer, a.bucket")
    .all(mode);
  return [...TREES, ...rows.map((r) => attestTreeName(r.issuer, r.bucket))];
}
const FORK_COMMIT_RE = /^[0-9a-f]{64}$/;
/** Gate 4 (attack-z2-2 #4): root-level registration clocks carry the hour, never the millisecond */
const hourGrainMs = (t) => Math.floor(t / 3_600_000) * 3_600_000;
const revokeCanonical = (mode, commitment, rootId, issuedAt) =>
  ["layers-zk-revoke/1", mode, commitment, rootId, String(issuedAt)].join("|");
/** ATTESTATION PASS Gate 1 — the ISSUER-signed forms (deliberate duplicates
 * of lib/attest/canonical.ts). The validator verifies every issuance and
 * revocation under the issuer's REGISTERED key; the registration itself is
 * self-signed (key possession). */
const attestCanonical = (a) =>
  ["layers-zk-attest/2", a.mode, a.issuer, a.bucket, a.commitment, a.claimHash, String(a.issuedEpoch), String(a.expiresEpoch)].join("|");
const issuerCanonical = (i) =>
  ["layers-zk-issuer/1", i.mode, i.id, i.displayName, i.schemaHash, i.buckets.join(","), String(i.validityEpochs), i.pubkey].join("|");
const attestRevokeCanonical = (r) => ["layers-zk-attest-revoke/1", r.mode, r.issuer, r.bucket, r.commitment, String(r.issuedAt)].join("|");
/** Gate 4 (attack-att-3 #2): the SUBJECT's device-auth key signs the batch it submits */
const attestSubmitCanonical = (mode, partsJson, issuedAt) => ["layers-zk-attest-submit/1", mode, createHash("sha256").update(partsJson).digest("hex"), String(issuedAt)].join("|");
/** Gate 4 (attack-att-1 #4): activation and expiry are quantized to an ISSUE WINDOW of W epochs
 * (ATTEST_ISSUE_WINDOW, default 1 — the fixture's epoch arithmetic), so every issuance of a window
 * activates and expires together; at W = 1 a per-epoch cell remains (A-ATT-ISSUE-CELLS). */
const ISSUE_WINDOW = Math.max(1, Math.min(1000, Number(process.env.ATTEST_ISSUE_WINDOW || 1)));
const windowStart = (epoch) => Math.ceil((epoch + 1) / ISSUE_WINDOW) * ISSUE_WINDOW;

// ---------- canonical forms (DELIBERATE DUPLICATES of lib/zk/*.ts) ----------
const registerCanonical = (mode, commitment, rootId, issuedAt) =>
  ["layers-zk-register/1", mode, commitment, rootId, String(issuedAt)].join("|");
const placementCanonical = (p) =>
  ["layers-zk-placement/1", p.mode, p.tree, String(p.epoch), p.commitment, String(p.leafIndex), p.root].join("|");
const historyEntryHash = (e) =>
  createHash("sha256")
    .update(["layers-zk-root-history/1", e.mode, e.tree, String(e.epoch), e.root, e.prevHash].join("|"))
    .digest("hex");
/** the fixture tag — byte-identical to lib/zk/transport/fixture.ts */
const FIXTURE_TAG_KEY = "layers-zk-fixture-tag/v1";
const fixtureTag = (canonical, nullifier) =>
  createHash("sha256").update(["layers-zk-fixture/1", canonical, nullifier, FIXTURE_TAG_KEY].join("|")).digest("hex");
const canonicalPublicInputs = (p) =>
  [
    "layers-zk-public/1",
    p.mode,
    p.claimKind,
    p.tree,
    String(p.epoch),
    p.merkleTreeRoot,
    p.scope,
    p.message,
    p.personaId,
    p.gateId,
    p.challenge,
    // MULTI-FID Gate 4/PASS: the cast hash and its reveal commitment are part of the canonical signal
    // for an anon post (DELIBERATE DUPLICATE of lib/zk/transport/types.ts)
    // PERSONA LAUNCH P3: and the SLOT index (the fixture tag binds it; a live proof binds it through the scope, which
    // the binding below rebuilds from (window, slot)) — "" when absent, so a slot-less envelope can never match a tag
    // computed over a slot
    // PERSONA LAUNCH P4: and the ring note's hash (the message binds it too; "" when absent — refused below anyway)
    ...(p.claimKind === "anon-post" ? [p.castHash || "", p.attributionCommitment || "", p.slot === undefined || p.slot === null ? "" : String(p.slot), p.noteHash || ""] : []),
    // PERSONA LAUNCH P6: a launch request's commitment
    ...(p.claimKind === "persona-launch" ? [p.launchCommit || ""] : []),
    // PERSONA LAUNCH P8: an X copy's hash and its X slot ("" when absent — a slot-less X envelope never matches a tag made
    // over a slot). DELIBERATE DUPLICATE of lib/zk/transport/types.ts canonicalPublicInputs.
    ...(p.claimKind === "x-anon-post" ? [p.xHash || "", p.slot === undefined || p.slot === null ? "" : String(p.slot)] : []),
  ].join("|");

const isMode = (m) => MODES.includes(m);
/** CANONICAL decimal only ("0" or no leading zero, ≤ 77 digits), in range.
 * attack-2 finding 3: the replay store keys on the string; a verifier
 * that accepted "0"+N would see two nullifiers for one value. */
const isField = (s) => typeof s === "string" && /^(0|[1-9][0-9]{0,76})$/.test(s) && BigInt(s) < FIELD;

// ---------- THE CLAIM BINDING (DELIBERATE DUPLICATES of lib/zk/hash.ts + scopes.ts) ----------
// attack-2 finding 1: a verifier that accepts `scope` and `message` as
// opaque field elements proves only "some leaf produced this"; the persona
// and gate it then records are prover-chosen. So the validator RE-DERIVES
// both from the public inputs it is going to record against and refuses
// any envelope whose values are not exactly that derivation:
//   scope   = fieldOf("scope",   "layers/zk-scope/v1|<feature>|<epoch>|<personaId>")
//   message = fieldOf("message", "<personaId>|<gateId>|epoch-<epoch>|<root>")
//   fieldOf(domain, s) = sha256("layers-zk-field/1|" + domain + "|" + s) >> 8   (248-bit)
// One claim kind → one registry entry, fixed here, never caller-supplied.
const SCOPE_DOMAIN = "layers/zk-scope/v1";
const SCOPE_FOR_CLAIM = {
  "tier-membership": { feature: "discovery-tier", onePerHuman: false },
  // Gate 3: per-persona on the NEW persona; the message carries the fork
  // COMMITMENT (sha256 over old|new|nonce, computed on the device) — the
  // validator re-derives the message from the commitment it is given and
  // never sees the old persona.
  "fork-continuity": { feature: "fork-continuity", onePerHuman: false },
  // Gate 3: per-persona; the tree is attest:<issuer> and the message binds
  // the issuer, so an attestation proof cannot be replayed as a tier proof.
  attestation: { feature: "attestation", onePerHuman: false },
  // MULTI-FID Gate 4: ONE PER HUMAN — the scope omits the persona (the signal carries the constant
  // "anon") and is qualified by the window index; the message binds the cast hash the relay posts.
  // PERSONA LAUNCH P3: one per human per (window, SLOT) — the qualifier is w<n>/s<i>, i < K (anonPostSlots below)
  "anon-post": { feature: "anon-post", onePerHuman: true },
  // PERSONA LAUNCH P6: one launch request per human per WINDOW — the qualifier is w<n> alone (no slot, no persona, no tree)
  "persona-launch": { feature: "persona-launch", onePerHuman: true },
  // PERSONA LAUNCH P8: one X copy per human per (window, X slot) — qualifier w<n>/s<i>, i < K_X (xAnonPostSlots below).
  // The feature differs from anon-post's, so an X nullifier never equals any anon-post slot's (D-X-SLOTS).
  "x-anon-post": { feature: "x-anon-post", onePerHuman: true },
};
// PERSONA LAUNCH P4 (R8): the ring note — 256 bytes as 512 lowercase hex, on EVERY anon post (real or random)
const NOTE_RE = /^[0-9a-f]{512}$/;
// PERSONA LAUNCH P6: a launch request — its commitment (64 hex) and its size bound (the registrar validates the rest)
const LAUNCH_COMMIT_RE = /^[0-9a-f]{64}$/;
const LAUNCH_REQUEST_MAX_BYTES = 2048;
/** PERSONA LAUNCH P6: the launch track's registrar (validator/registrar.js), required LAZILY — this module must load
 * (and every other claim kind must verify) whether or not that file is present; a launch request without it is a
 * refusal, never an acceptance. */
function registrarModule() {
  return require("./registrar");
}
function registrarIfPresent() {
  try {
    require.resolve("./registrar");
  } catch {
    return null;
  }
  return require("./registrar");
}
/** PERSONA LAUNCH P8: the @totem X outbox (validator/xoutbox.js), required LAZILY exactly like the registrar — every other
 * claim kind verifies whether or not that file is present; an X copy without it is a refusal, never an acceptance. */
function xoutboxModule() {
  return require("./xoutbox");
}
function xoutboxIfPresent() {
  try {
    require.resolve("./xoutbox");
  } catch {
    return null;
  }
  return require("./xoutbox");
}
// ---------- MULTI-FID Gate 4: anon-post configuration (the validator's OWN copy; the client's must match) ----------
const ANON_PERSONA = "anon";
// MULTI-FID Gate 5 (attack-fid-3 #8): every numeric knob is finite and clamped — a misspelt env value never opens a gate
const numEnv = (name, def, lo, hi) => {
  const n = Number(process.env[name] ?? def);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : def;
};
const anonPostTree = () => String(process.env.ZK_ANON_POST_TREE ?? "").trim() || `tier-${numEnv("ZK_GATE_TIER", 2, 1, 10)}`;
// PERSONA LAUNCH P5 (D1, R6) — REACH TIERS. An anon post may prove the configured plain anon tree OR the bucket tree of a
// REACH issuer this validator accepts (ZK_ANON_REACH_ISSUERS, default "fc.reach,x.reach"; a blank value means the
// default, an explicit "none" accepts no reach issuer). Only the declared reach buckets (DELIBERATE DUPLICATE of
// REACH_BUCKETS in lib/reach/trees.ts). The validator decides by ID — the open registry is first-come, so it is the
// CLIENT that honours an issuer by key (lib/attest/subscriber.ts) before offering or labelling its tiers.
const REACH_BUCKETS = ["gte-1k", "gte-10k", "gte-100k"];
const anonReachIssuers = () => {
  const raw = process.env.ZK_ANON_REACH_ISSUERS;
  if (raw === undefined || String(raw).trim() === "") return ["fc.reach", "x.reach"];
  if (String(raw).trim() === "none") return [];
  return String(raw).split(",").map((s) => s.trim()).filter((s) => validIssuer(s));
};
const isReachTree = (tree) => {
  const at = parseAttestTree(tree);
  return !!at && anonReachIssuers().includes(at.issuer) && REACH_BUCKETS.includes(at.bucket);
};
/** may an anon post prove this tree? (DELIBERATE DUPLICATE of anonTreeAllowed in lib/zk/prove.ts, each side its own list) */
const anonTreeAllowed = (tree) => tree === anonPostTree() || isReachTree(tree);
/** PUBLIC GO-LIVE (ASM-1): with the fid gate on (every public deployment), a LIVE anon post may prove the gated plain tree
 *  only — "valid" (the tree the gate builds: validator/anonpublic.js fidGateMembers), which must also be the configured
 *  anon tree. True = refused. Anywhere the gate is off, or in the test universe, never refused here. */
const gatedLiveTreeRefused = (mode, tree) => mode === "live" && require("./anonpublic").fidGateOn() && (tree !== anonPostTree() || tree !== "valid");
/** PUBLIC GO-LIVE (ASM-1): the reach issuers anon posts may prove in `mode` — none in the live universe of a gated validator
 *  (the gated plain tree only), the configured ones everywhere else (the preview's fixture reach tiers keep working) */
const anonReachIssuersFor = (mode) => (mode === "live" && require("./anonpublic").fidGateOn() ? [] : anonReachIssuers());
// the crowd floor of a REACH tree: never below ZK_ANON_FLOOR, and its own default is D1's 50 (DELIBERATE DUPLICATE of
// ZK_REACH_FLOOR in lib/zk/config.ts). The PLAIN anon tree keeps no validator floor: the owner service's anonymous account
// is a crowd of one by design (A-ANON-SET-OF-ONE, its app runs ZK_ANON_FLOOR=1) and its client floor is the control there.
const reachFloor = () => Math.max(anonFloor(), envInt("ZK_REACH_FLOOR", 50, 1, 1_000_000));
/**
 * PERSONA LAUNCH wave 3 (L3) — THE BAND RULE, on the FROZEN epoch's sizes (the signed placements). Buckets NEST and the
 * client's default is the HIGHEST tier it is offered, so a post at tier T comes — to anyone who knows the census — from
 * T's BAND: T's members who hold no offered tier above it (their default would have been higher). With 52 of gte-1k's 55
 * also in gte-10k, a gte-1k post came from one of three accounts while both trees cleared the floor of 50. So a tier is
 * OFFERABLE only while it holds at least the floor AND the band it leaves below it does too: walking one issuer's chain
 * upward from the PLAIN anon tree (every member of a reach tree is a member of it), a tier is offerable when
 *   size(T) >= floor  and  size(last offerable below) - size(T) >= floor
 * (a tier that is not offerable is skipped: the next one is compared with the last one that was). Then every band —
 * between two consecutive offerable tiers, and the top one itself — holds at least the floor. A post at a tier that is not
 * offerable is refused BEFORE the nullifier is consumed. DELIBERATE DUPLICATE of the client's offer rule
 * (lib/reach/trees.ts offerableChain, judged there from the last tick's census and the plain tree's size); per issuer —
 * the cross-issuer interplay is A-REACH-BANDS-PER-ISSUER (x.reach is fixture-only this wave). Null = allowed; otherwise
 * the refusal in words. Not a reach tree: null.
 */
function reachBandRefusal(db, mode, tree, epoch) {
  const at = parseAttestTree(tree);
  if (!at || !isReachTree(tree)) return null;
  const sizeAt = (t) => db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = ? AND tree = ? AND epoch = ?").get(mode, t, epoch).n;
  const floor = reachFloor();
  let below = sizeAt(anonPostTree());
  let belowName = "the plain anonymous tree";
  for (const b of REACH_BUCKETS) {
    const t = `attest:${at.issuer}/${b}`;
    const n = sizeAt(t);
    const band = below - n;
    const offerable = n >= floor && band >= floor;
    if (t === tree) {
      // a tree under the floor ITSELF is the size check's refusal (verifyAndRecord, just before this one) — one guard
      // per refusal, so neither can hide the other's absence
      if (offerable || n < floor) return null;
      return `the ${tree} tier would leave only ${Math.max(0, band)} accounts in ${belowName} below it (fewer than ${floor}): a post there would come from that small band`;
    }
    if (offerable) {
      below = n;
      belowName = t;
    }
  }
  return null;
}
const anonPostWindowEpochs = () => numEnv("ZK_ANON_POST_WINDOW_EPOCHS", 1, 1, 1000);
const anonPostWindowOf = (epoch) => "w" + Math.floor(epoch / anonPostWindowEpochs());
const anonPostMaxChars = () => numEnv("ZK_ANON_POST_MAX_CHARS", 320, 1, 1024);
// PERSONA LAUNCH P3: a knob whose BLANK value means "unset" (a variable blanked by name on a platform must fall back to
// the default, never to Number("") = 0: a blank ZK_ANON_POST_SLOTS would silently become K = 1, a blank lifetime cap
// would refuse every post, a blank relay interval would relay every second). DELIBERATE DUPLICATE of envInt() in
// lib/zk/config.ts — the two sides must read the same K from the same environment.
const envInt = (name, def, lo, hi) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : def;
};
// PERSONA LAUNCH P3 (D4) — THE INDEXED ANON SCOPE. K slots per person per window: a person may post anonymously K
// times a window, from any of their personas (the budget is the PERSON's, shared across personas), and every post
// emits the nullifier of its own (window, slot) — so two posts of one person in one window never share a nullifier and
// stay unlinkable to the operator, while a (K+1)th post is impossible (the K slots are the only scopes that verify).
// DELIBERATE DUPLICATE of ZK_ANON_POST_SLOTS in lib/zk/config.ts (default 4, integer 1..16). The client NEVER adopts
// this number for its own slot choice (a validator serving one client a different K could tag that client's posts);
// it only refuses to post when the two disagree.
const anonPostSlots = () => envInt("ZK_ANON_POST_SLOTS", 4, 1, 16);
// the ONLY qualifier an anon-post scope takes: the window AND the slot. The bare window ("w<n>") is refused — it was
// the pre-P3 scope, and accepting it beside the K indexed ones would hand every person a (K+1)th nullifier.
const ANON_SLOT_QUALIFIER_RE = /^w\d{1,12}\/s\d{1,2}$/;
const anonSlotQualifier = (epoch, slot) => anonPostWindowOf(epoch) + "/s" + slot;
const isAnonSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < anonPostSlots();
// PERSONA LAUNCH P8 (D-X-SLOTS) — THE X SLOTS. K_X anonymous X copies per person per window (default 1, integer 1..4),
// their OWN slots under their OWN feature (x-anon-post/w<n>/s<i>): an X copy never spends an anon-post slot and never
// shares a nullifier with one. DELIBERATE DUPLICATE of ZK_X_ANON_POST_SLOTS in lib/zk/config.ts; like K, the client never
// adopts this number for its slot choice (it compares it with its own and refuses on a mismatch — lib/zk/gate.ts).
const xAnonPostSlots = () => envInt("ZK_X_ANON_POST_SLOTS", 1, 1, 4);
const isXSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < xAnonPostSlots();
const xSlotQualifier = (epoch, slot) => anonPostWindowOf(epoch) + "/s" + slot;
/** sha256("layers-x-anon/1|" + nonce + "|" + text) — domain-separated from the cast hash (DELIBERATE DUPLICATE of
 *  validator/xoutbox.js xHashOf and lib/x/outbox/policy.ts xHashOf) */
const xAnonHash = (text, nonce) => createHash("sha256").update("layers-x-anon/1|" + nonce + "|" + text, "utf8").digest("hex");
// MULTI-FID Gate 5 (attack-fid-2 #7): the cast hash is SALTED with a per-post nonce — two identical texts are two posts
const anonCastHash = (text, nonce) => createHash("sha256").update("layers-anon-cast/1|" + nonce + "|" + text, "utf8").digest("hex");
const CAST_HASH_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;
// §14.2 — DELIBERATE DUPLICATE of revealCanonical() in lib/zk/anonAttribution.ts. Byte-identical or
// every reveal is refused; the acceptance suite signs on one side and verifies here to pin them.
const revealCanonical = (mode, castHash, fid, signerPubKey) =>
  ["layers-anon-reveal/1", mode, castHash, String(fid), signerPubKey].join("|");
/** the shared anon account the validator relays through: its OWN account, named explicitly (never the app's throwaway by
 * default, never a persona's signer), and ARMED like every real write (attack-fid-3 #5).
 * PUBLIC GO-LIVE: resolved by validator/anonpublic.js relayAccount — the AGENT path (FC_ANON_NEYNAR_KEY + the switch
 * ZK_ANON_RELAY_LIVE=on, the public site's one relay credential) when the agent key is set, else the owner-service path
 * (NEYNAR_API_KEY + ENABLE_FC_WRITE) with exactly the fields this function computed before. */
const anonRelayAccount = () => require("./anonpublic").relayAccount(process.env);
// PERSONA LAUNCH P3 (D4): the LIFETIME live cap. On every non-public shape (the rig, the owner service) it defaults to 1
// — the owner service keeps ONE live anon post until its owner raises it after seeing the first (arm-anon.ps1 -RaiseCap),
// and keeps 1 even if the variable is lost or blanked. On the PUBLIC shape the global DAILY cap below is the limit and
// this one applies only when set explicitly (null = no lifetime cap).
// PUBLIC GO-LIVE: on the AGENT path (the public @anon) the cap is REQUIRED and explicit (arm-public-anon.ps1 sets it,
// -RaiseCap raises it, up to 1,000,000): relayAccount refuses to arm without it, so null never means "uncapped" there.
const anonLiveCap = () => {
  const ap = require("./anonpublic");
  if (ap.relayAccount(process.env).kind === "agent") return ap.agentLifetimeCap(process.env);
  const raw = process.env.ZK_ANON_POST_LIVE_CAP;
  if (isPublicDeployment() && (raw === undefined || String(raw).trim() === "")) return null;
  return envInt("ZK_ANON_POST_LIVE_CAP", 1, 0, 100);
};
// PERSONA LAUNCH P3 (D4): the GLOBAL daily cap — every anon post this validator accepts in a (shifted-clock) UTC day,
// in one universe, pending and relayed counted together (a row the relay gave up on, or one the network answered for
// another author, is not). Counted INSIDE the insert transaction, before the nullifier is consumed.
const anonDailyCap = () => envInt("ZK_ANON_POST_DAILY_CAP", 500, 0, 1_000_000);
const DAY_MS = 86_400_000;
/** PURE: the epochs whose START falls in the same UTC day (of the validator's shifted epoch clock) as `epoch`'s start,
 *  as [lo, hi). The day is the epoch's, not the wall clock's, so a rig that advances the epoch clock moves through days
 *  with it, and a row is bucketed by the epoch it was accepted in (anon posts get no epoch grace: always the current). */
function anonDayEpochRange(epoch, epochMs = EPOCH_MS) {
  const day = Math.floor((epoch * epochMs) / DAY_MS);
  return [Math.ceil((day * DAY_MS) / epochMs), Math.ceil(((day + 1) * DAY_MS) / epochMs)];
}
function anonDailyUsed(db, mode, epoch) {
  const [lo, hi] = anonDayEpochRange(epoch);
  return db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = ? AND status IN ('pending', 'relayed') AND epoch >= ? AND epoch < ?").get(mode, lo, hi).n;
}
// PERSONA LAUNCH P3 (D4): the relay cadence by SHAPE. Public: 30-minute slots with a 30-minute spread (a post is visible
// within ~75 min, inside a crowd of half an hour). Rig and owner service: the hourly slot with no spread, as before.
// The environment overrides both on any shape.
const anonRelayIntervalMs = () => envInt("ZK_ANON_RELAY_INTERVAL_MS", isPublicDeployment() ? 1_800_000 : 3_600_000, 1000, 86_400_000);
// ANON REVIEW (R1-03): each pending row's relay moment is drawn with a CSPRNG over [slot, slot + spread]; a spread of 0
// keeps the slot behaviour, and ZK_ANON_RELAY_SPREAD_MS (e.g. 6 h) smears the hour of composition
const anonRelaySpreadMs = () => envInt("ZK_ANON_RELAY_SPREAD_MS", isPublicDeployment() ? 1_800_000 : 0, 0, 86_400_000);
// ANON REVIEW (A2-3): a live row that fails to relay this many slots in a row is marked 'failed' — it stops being
// retried and stops counting against the cap (in memory: a redeploy gives it fresh attempts)
const anonRelayMaxAttempts = () => numEnv("ZK_ANON_RELAY_MAX_ATTEMPTS", 6, 1, 1000);
const inFlightNullifiers = new Set();
/** the signer the validator relays with, resolved against Neynar: approved, and for exactly FC_ANON_FID.
 * ANON REVIEW (R3-19): a positive answer is cached for 10 minutes, a negative one for 30 seconds only — a signer the
 * owner just fixed must not keep refusing. */
let anonSignerCheck = null;
async function anonSignerApproved(acct) {
  const who = acct.signerUuid || acct.signerPub || "";
  if (anonSignerCheck && anonSignerCheck.uuid === who && Date.now() - anonSignerCheck.at < (anonSignerCheck.ok ? 600_000 : 30_000)) return anonSignerCheck.ok;
  let ok = false;
  try {
    // PUBLIC GO-LIVE: through the transport seam (validator/anonpublic.js) — on the owner path the very request made here
    // before (GET https://api.neynar.com/v2/farcaster/signer, x-api-key, 20 s); on the agent path its own key and base
    ok = (await require("./anonpublic").anonTransport(acct).signerStatus()).ok === true;
  } catch {
    ok = false;
  }
  anonSignerCheck = { uuid: who, at: Date.now(), ok };
  return ok;
}
// ANON REVIEW (A2-5): the anonymous channel answers a constant "refused" by design; the REASON is kept here, per cast
// hash, for the device-signed reader of /zk/anon-post/config?castHash= (the owner's own app over the private network),
// never on the anonymous wire. Hour-grained, bounded to the last 100. PUBLIC GO-LIVE (PRIV-LIVE-2): a visitor's TAB never
// makes that read (app/api/anon/route.ts asks only from a server-side device): on the public site a signed read naming a
// refused post would tie the post to the device that sent it.
const lastAnonRefusal = new Map();
function noteAnonRefusal(castHash, reason) {
  if (typeof castHash !== "string" || !CAST_HASH_RE.test(castHash)) return;
  lastAnonRefusal.delete(castHash);
  lastAnonRefusal.set(castHash, { reason, at: hourGrainMs(Date.now()) });
  while (lastAnonRefusal.size > 100) lastAnonRefusal.delete(lastAnonRefusal.keys().next().value);
}
const fieldOf = (domain, canonical) => {
  const h = createHash("sha256").update(`layers-zk-field/1|${domain}|${canonical}`, "utf8").digest();
  let v = 0n;
  for (const b of h) v = (v << 8n) | BigInt(b);
  return (v >> 8n).toString(10);
};
function scopeString(entry, epoch, personaId, qualifier) {
  if (!Number.isInteger(epoch) || epoch < 0) throw new Error("epoch must be a non-negative integer");
  // Gate 4 (attack-z2-3 #6): the attestation scope is qualified by the issuer
  let feature = entry.feature;
  if (entry.feature === "anon-post") {
    // MULTI-FID Gate 4: qualified by the WINDOW. PERSONA LAUNCH P3: by the window AND the slot — "w<n>/s<i>", i < K —
    // one anon post per person per (window, slot); the bare window is refused (it would be a (K+1)th nullifier)
    if (typeof qualifier !== "string" || !ANON_SLOT_QUALIFIER_RE.test(qualifier)) throw new Error("anon-post scope requires the window and the slot (w<n>/s<i>) — a bare window is refused");
    if (!isAnonSlot(Number(qualifier.slice(qualifier.indexOf("/s") + 2)))) throw new Error("anon-post scope: the slot is outside 0.." + (anonPostSlots() - 1));
    feature = `${entry.feature}/${qualifier}`;
  } else if (entry.feature === "persona-launch") {
    // PERSONA LAUNCH P6: the window ALONE — "w<n>"; a slot (or anything else) would mint more than one launch per window
    if (typeof qualifier !== "string" || !/^w\d{1,12}$/.test(qualifier)) throw new Error("persona-launch scope requires the window (w<n>) and nothing else");
    feature = `${entry.feature}/${qualifier}`;
  } else if (entry.feature === "x-anon-post") {
    // PERSONA LAUNCH P8: the window AND an X slot — "w<n>/s<i>", i < K_X; the bare window is refused like anon-post's
    if (typeof qualifier !== "string" || !ANON_SLOT_QUALIFIER_RE.test(qualifier)) throw new Error("x-anon-post scope requires the window and the X slot (w<n>/s<i>) — a bare window is refused");
    if (!isXSlot(Number(qualifier.slice(qualifier.indexOf("/s") + 2)))) throw new Error("x-anon-post scope: the X slot is outside 0.." + (xAnonPostSlots() - 1));
    feature = `${entry.feature}/${qualifier}`;
  } else if (entry.feature === "attestation") {
    // Attestation pass Gate 1: qualified by issuer AND bucket — two buckets of
    // one issuer for one persona in one epoch must not share a nullifier
    const q = typeof qualifier === "string" ? qualifier.split("/") : [];
    if (q.length !== 2 || !validIssuer(q[0]) || !validBucket(q[1])) throw new Error("attestation scope requires the issuer and the bucket");
    feature = entry.feature + "/" + qualifier;
  } else if (qualifier !== undefined) throw new Error("this scope takes no qualifier");
  // MULTI-FID Gate 5 (attack-fid-2 #6, attack-fid-3 #7): the window replaces the epoch for a window-qualified scope
  if (entry.onePerHuman) return (entry.feature === "anon-post" || entry.feature === "persona-launch" || entry.feature === "x-anon-post") && qualifier ?`${SCOPE_DOMAIN}|${feature}` : `${SCOPE_DOMAIN}|${feature}|${epoch}`;
  if (!personaId || !/^[A-Za-z0-9_]{1,80}$/.test(personaId)) throw new Error("per-persona scope requires a personaId");
  return `${SCOPE_DOMAIN}|${feature}|${epoch}|${personaId}`;
}
/** what scope / challenge / message MUST be for these public inputs */
function expectedPublicValues(p) {
  const entry = SCOPE_FOR_CLAIM[p.claimKind];
  if (!entry) throw new Error("unknown claim kind");
  const challenge = `epoch-${p.epoch}`;
  // Gate 3: the message binds what the claim is ABOUT, per kind
  //   tier-membership : personaId | gateId | challenge | root
  //   fork-continuity : personaId | gateId | fork:<forkCommit> | challenge | root
  //   attestation     : personaId | gateId | attest:<issuer>/<bucket> | challenge | root
  let parts;
  if (p.claimKind === "fork-continuity") {
    if (!FORK_COMMIT_RE.test(p.forkCommit || "")) throw new Error("fork-continuity requires publicInputs.forkCommit (64 hex)");
    if (!/^tier-\d+$/.test(p.tree)) throw new Error("fork-continuity requires a tier tree (attack-z2-3 #8: a fork proof elsewhere would consume the nullifier and record nothing)");
    parts = [p.personaId, p.gateId, "fork:" + p.forkCommit, challenge, p.merkleTreeRoot];
  } else if (p.claimKind === "attestation") {
    if (!validIssuer(p.issuer) || !validBucket(p.bucket)) throw new Error("attestation requires publicInputs.issuer and publicInputs.bucket");
    if (p.tree !== attestTreeName(p.issuer, p.bucket)) throw new Error("attestation tree must be attest:<issuer>/<bucket> for the named issuer and bucket");
    parts = [p.personaId, p.gateId, p.tree, challenge, p.merkleTreeRoot];
  } else if (p.claimKind === "anon-post") {
    //   anon-post        : anon | gateId | cast:<castHash> | attr:<attributionCommitment> | note:<noteHash> | challenge | root
    if (p.personaId !== ANON_PERSONA) throw new Error("anon-post carries the constant 'anon' where a persona id would be");
    if (!CAST_HASH_RE.test(p.castHash || "")) throw new Error("anon-post requires publicInputs.castHash (64 hex)");
    if (!CAST_HASH_RE.test(p.attributionCommitment || "")) throw new Error("anon-post requires publicInputs.attributionCommitment (64 hex)");
    // PERSONA LAUNCH P4 (R8): the ring note's hash, beside the reveal commitment — every anon post carries one
    if (!CAST_HASH_RE.test(p.noteHash || "")) throw new Error("anon-post requires publicInputs.noteHash (64 hex)");
    // PERSONA LAUNCH P5: the configured plain tree or an accepted reach tree — the tree is NOT in the scope below
    if (!anonTreeAllowed(p.tree)) throw new Error(`anon posts prove membership in ${anonPostTree()} or an accepted reach tier — the validator's configured predicates — not ${p.tree}`);
    // PERSONA LAUNCH P3: the scope is REBUILT from (window, slot) — a slot outside 0..K-1 has no scope that verifies
    if (!isAnonSlot(p.slot)) throw new Error("anon-post requires publicInputs.slot, an integer from 0 to " + (anonPostSlots() - 1));
    parts = [ANON_PERSONA, p.gateId, "cast:" + p.castHash, "attr:" + p.attributionCommitment, "note:" + p.noteHash, challenge, p.merkleTreeRoot];
  } else if (p.claimKind === "persona-launch") {
    //   persona-launch   : anon | persona-launch | launch:<launchCommit> | challenge | root   (PERSONA LAUNCH P6)
    if (p.personaId !== ANON_PERSONA) throw new Error("persona-launch carries the constant 'anon' where a persona id would be");
    if (!LAUNCH_COMMIT_RE.test(p.launchCommit || "")) throw new Error("persona-launch requires publicInputs.launchCommit (64 hex)");
    if (p.tree !== anonPostTree()) throw new Error(`a launch request proves membership in ${anonPostTree()} — the plain anon tree — not ${p.tree}`);
    if (p.slot !== undefined) throw new Error("persona-launch takes no slot (one request per person per window)");
    parts = [ANON_PERSONA, "persona-launch", "launch:" + p.launchCommit, challenge, p.merkleTreeRoot];
  } else if (p.claimKind === "x-anon-post") {
    //   x-anon-post      : anon | x-anon-post | x:<xHash> | challenge | root   (PERSONA LAUNCH P8)
    if (p.personaId !== ANON_PERSONA) throw new Error("x-anon-post carries the constant 'anon' where a persona id would be");
    if (!CAST_HASH_RE.test(p.xHash || "")) throw new Error("x-anon-post requires publicInputs.xHash (64 hex)");
    // the PLAIN anon tree only: an X copy carries no boost, so a reach tree has nothing to say there
    if (p.tree !== anonPostTree()) throw new Error(`an X copy proves membership in ${anonPostTree()} — the plain anon tree — not ${p.tree}`);
    if (!isXSlot(p.slot)) throw new Error("x-anon-post requires publicInputs.slot, an integer from 0 to " + (xAnonPostSlots() - 1));
    parts = [ANON_PERSONA, "x-anon-post", "x:" + p.xHash, challenge, p.merkleTreeRoot];
  } else {
    parts = [p.personaId, p.gateId, challenge, p.merkleTreeRoot];
  }
  return {
    scope: fieldOf("scope", scopeString(entry, p.epoch, entry.onePerHuman ? undefined : p.personaId, p.claimKind === "attestation" ? p.issuer + "/" + p.bucket : p.claimKind === "anon-post" ? anonSlotQualifier(p.epoch, p.slot) : p.claimKind === "persona-launch" ? anonPostWindowOf(p.epoch) : p.claimKind === "x-anon-post" ? xSlotQualifier(p.epoch, p.slot) : undefined)),
    challenge,
    message: fieldOf("message", parts.join("|")),
  };
}
/** @semaphore-protocol/proof's hash(): BigInt(keccak256(toBeHex(x, 32))) >> 8n */
function semaphoreHash(x) {
  const bytes = new Uint8Array(32);
  let v = BigInt(x);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 255n);
    v >>= 8n;
  }
  const h = keccak_256(bytes);
  let out = 0n;
  for (const b of h) out = (out << 8n) | BigInt(b);
  return (out >> 8n).toString(10);
}
/** stock Semaphore v4 Groth16 verification against the PINNED key */
async function verifyLiveProof(body, p, nullifier) {
  const vk = loadPinnedVkey(body.merkleTreeDepth); // throws → refusal
  const signals = [p.merkleTreeRoot, nullifier, semaphoreHash(p.message), semaphoreHash(p.scope)];
  return (await snarkjs.groth16.verify(vk, signals, unpackGroth16Proof(body.points.map(String)))) === true;
}

// ---------- validator signing key ----------
function validatorKey(db) {
  let row = db.prepare("SELECT pkcs8_hex, pub_hex FROM zk_validator_key WHERE id = 1").get();
  if (!row) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" });
    const pubHex = spki.subarray(spki.length - 32).toString("hex");
    const pkcs8Hex = privateKey.export({ format: "der", type: "pkcs8" }).toString("hex");
    db.prepare("INSERT INTO zk_validator_key (id, pkcs8_hex, pub_hex, created_at) VALUES (1, ?, ?, ?)").run(
      pkcs8Hex,
      pubHex,
      Date.now()
    );
    row = { pkcs8_hex: pkcs8Hex, pub_hex: pubHex };
  }
  const priv = createPrivateKey({ key: Buffer.from(row.pkcs8_hex, "hex"), format: "der", type: "pkcs8" });
  return {
    pubHex: row.pub_hex,
    signHex: (canonical) => cryptoSign(null, Buffer.from(canonical, "utf8"), priv).toString("hex"),
  };
}

// ---------- epochs ----------
function epochOffset(db, mode) {
  const r = db.prepare("SELECT offset_ms FROM zk_epoch_offset WHERE mode = ?").get(mode);
  return r ? r.offset_ms : 0;
}
function epochInfo(db, mode, now = Date.now()) {
  const shifted = now + epochOffset(db, mode);
  const epoch = Math.floor(shifted / EPOCH_MS);
  return { mode, epoch, epochMs: EPOCH_MS, msRemaining: (epoch + 1) * EPOCH_MS - shifted };
}

// ---------- trees (rebuilt per (mode, epoch), cached in memory) ----------
const treeCache = new Map(); // `${mode}:${epoch}` -> { [tree]: { group, members[] } }

function activeRegistrations(db, mode, epoch) {
  return db
    .prepare(
      "SELECT commitment, root_id FROM zk_registrations WHERE mode = ? AND active_from_epoch <= ? " +
        "AND (revoked_from_epoch IS NULL OR revoked_from_epoch > ?) ORDER BY registered_at, commitment"
    )
    .all(mode, epoch, epoch);
}

/**
 * THE FROZEN-EPOCH INVARIANT: the tree served for (mode, tree, epoch) is
 * exactly the tree whose root was SIGNED into the history for that epoch.
 * Membership is computed ONCE per epoch (from registrations active this
 * epoch and the rep tiers at that moment) and persisted as signed
 * placements; any later rebuild (cache miss, restart) reconstructs the
 * group FROM THOSE PLACEMENTS, never from live data — a rep change or a
 * registration mid-epoch cannot move a root the client already anchored.
 * If a reconstructed root ever differed from the signed one, that would
 * be a bug, and it is refused loudly (thrown → 500), never served.
 */
function buildTrees(db, mode, epoch) {
  const key = `${mode}:${epoch}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const out = {};
  const frozen = db.prepare("SELECT tree, root FROM zk_root_history WHERE mode = ? AND epoch = ?").all(mode, epoch);
  if (frozen.length > 0) {
    // already built once: reconstruct from the signed placements — over
    // exactly the trees that were FROZEN for the epoch (attestation trees
    // included; a tree not frozen that epoch does not exist for it)
    for (const tree of frozen.map((f) => f.tree)) {
      const members = db
        .prepare("SELECT commitment FROM zk_placements WHERE mode = ? AND tree = ? AND epoch = ? ORDER BY leaf_index")
        .all(mode, tree, epoch)
        .map((r) => r.commitment);
      const group = new Group(members.map((m) => BigInt(m)));
      const signed = frozen.find((f) => f.tree === tree);
      if (!signed) throw new Error(`zk: signed history missing for ${mode}/${tree}/${epoch}`);
      if (rootOf(group) !== signed.root) {
        throw new Error(`zk: FROZEN-EPOCH INVARIANT VIOLATED for ${mode}/${tree}/${epoch} — reconstructed root differs from the signed root; refusing to serve`);
      }
      out[tree] = { group, members };
    }
    treeCache.set(key, out);
    return out;
  }
  const regs = activeRegistrations(db, mode, epoch);
  const tierOf = new Map();
  // PERSONA LAUNCH wave 3 (verify): every registration's tier from ONE read of the scores (rep.js tiersForRoots: the same
  // answers tierForRoot gives one root at a time, without registrations x roots score queries on a synchronous loop)
  const tierByRoot = tiersForRoots(db, regs.map((r) => r.root_id));
  for (const r of regs) tierOf.set(r.commitment, tierByRoot.get(r.root_id));
  for (const tree of treesFor(db, mode)) {
    let members;
    const at = parseAttestTree(tree);
    if (at) {
      // Attestation pass Gate 1: the commitments (active this epoch) holding
      // an issuance from this issuer under this BUCKET that is active
      // (batched to the epoch after submission), unexpired, and not revoked
      // by the issuer. Expiry and revocation drop the leaf: proofs stop.
      const attested = new Set(
        db
          .prepare(
            "SELECT commitment FROM zk_attestations WHERE mode = ? AND issuer = ? AND bucket = ? AND active_from_epoch <= ? AND expires_epoch > ? AND (revoked_from_epoch IS NULL OR revoked_from_epoch > ?)"
          )
          .all(mode, at.issuer, at.bucket, epoch, epoch, epoch)
          .map((r) => r.commitment)
      );
      members = regs.filter((r) => attested.has(r.commitment)).map((r) => r.commitment);
    } else {
      // PUBLIC GO-LIVE (D-PUBLIC-LIVE-TREE): with the fid gate on (the public shape), the LIVE "valid" tree is one
      // commitment per Farcaster account that joined with a verified sign-in (validator/anonpublic.js fidGateMembers);
      // every other tree, and "valid" anywhere the gate is off, is built exactly as before
      const gated = tree === "valid" ? require("./anonpublic").fidGateMembers(db, mode, epoch) : null;
      const minTier = tree === "valid" ? 0 : Number(tree.slice(5));
      members = gated ?? regs.filter((r) => tierOf.get(r.commitment) >= minTier).map((r) => r.commitment);
    }
    const group = new Group(members.map((m) => BigInt(m)));
    out[tree] = { group, members };
  }
  treeCache.set(key, out);
  // Append the epoch's roots to the signed history + write signed
  // placements, exactly once per (mode, tree, epoch).
  const key_ = validatorKey(db);
  const now = Date.now();
  // PERSONA LAUNCH wave 3 (verify): the epoch's whole write — every tree's signed history entry and every signed placement
  // — is ONE savepoint. It was one autocommit (one WAL commit) per row, hundreds per epoch on a synchronous loop (~1.4 s on
  // the rig's database by 2026-10-13), and a failure part-way left some trees frozen and others not. A savepoint nests
  // inside a caller's transaction and is the transaction otherwise; on a failure nothing of this epoch is kept and the
  // cached trees are dropped, so the next read builds the epoch again from scratch (validator/test/reptiers.test.js).
  db.exec("SAVEPOINT zk_build_trees");
  try {
    for (const tree of Object.keys(out)) {
      const existing = db.prepare("SELECT hash FROM zk_root_history WHERE mode = ? AND tree = ? AND epoch = ?").get(mode, tree, epoch);
      if (existing) continue;
      const prev = db
        .prepare("SELECT hash FROM zk_root_history WHERE mode = ? AND tree = ? AND epoch < ? ORDER BY epoch DESC LIMIT 1")
        .get(mode, tree, epoch);
      const root = rootOf(out[tree].group);
      const entry = { mode, tree, epoch, root, prevHash: prev ? prev.hash : ZERO_HASH };
      const hash = historyEntryHash(entry);
      db.prepare(
        "INSERT INTO zk_root_history (mode, tree, epoch, root, prev_hash, hash, sig, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(mode, tree, epoch, root, entry.prevHash, hash, key_.signHex(hash), now);
      const ins = db.prepare(
        "INSERT OR REPLACE INTO zk_placements (mode, tree, epoch, commitment, leaf_index, root, sig) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      out[tree].members.forEach((commitment, leafIndex) => {
        const p = { mode, tree, epoch, commitment, leafIndex, root };
        ins.run(mode, tree, epoch, commitment, leafIndex, root, key_.signHex(placementCanonical(p)));
      });
    }
    db.exec("RELEASE zk_build_trees");
  } catch (e) {
    try {
      db.exec("ROLLBACK TO zk_build_trees");
      db.exec("RELEASE zk_build_trees");
    } catch {
      /* the failure already ended the transaction */
    }
    treeCache.delete(key);
    throw e;
  }
  return out;
}

function rootOf(group) {
  const r = group.root;
  return r === undefined || r === null ? "0" : r.toString(10);
}

function currentTrees(db, mode) {
  const { epoch } = epochInfo(db, mode);
  return { epoch, trees: buildTrees(db, mode, epoch) };
}

// ---------- THE SECOND VIEWPOINT (Pass 2 Gate 0) ----------
// The newest signed history entry for (mode, tree), served to the
// ANONYMOUS path (validator/anon.js mounts it; the OHTTP gateway routes
// the inner GET here). Public material only. A test rig can make this
// viewpoint LIE (the split-view hook) so the client's refusal is provable.
const splitView = new Map(); // `${mode}:${tree}` -> true while the test rig forks the anonymous view
function anonHead(db, mode, tree) {
  if (!isMode(mode) || !isKnownTree(tree)) return null;
  currentTrees(db, mode); // ensure this epoch's entry exists
  const row = db.prepare("SELECT epoch, root, hash FROM zk_root_history WHERE mode = ? AND tree = ? ORDER BY epoch DESC LIMIT 1").get(mode, tree);
  if (!row) return null;
  let hash = row.hash;
  if (devHooksOn() && splitView.get(mode + ":" + tree)) {
    // the rig: a plausible, different head — the client must catch it
    hash = createHash("sha256").update("split-view/" + row.hash).digest("hex");
  }
  return { mode, tree, epoch: row.epoch, hash, root: row.root };
}
// dev-only request counter: proves the render path makes no validator request
const requestCounts = new Map();

// ---------- registration ----------
/** BROWSER KEYSTORE PASS Gate 1 stage 2: the device-auth anchor a root-level signature verifies against — the
 * root's own once bound, else the anchorPubKey the request names (bound on the first verified registration), else
 * the oldest registered anchor (a rig validator's own). */
function anchorForRoot(db, rootId, hint) {
  const root = db.prepare("SELECT anchor FROM roots WHERE id = ?").get(rootId);
  const key = root && root.anchor ? root.anchor : typeof hint === "string" ? hint : singleAnchor(db);
  return db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(key) || null;
}

function register(db, body) {
  const { mode, commitment, rootId, issuedAt, signature } = body || {};
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture|live" } };
  if (!isField(commitment)) return { status: 400, json: { error: "commitment must be a decimal field element" } };
  if (typeof rootId !== "string" || !rootId) return { status: 400, json: { error: "rootId required" } };
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 10 * 60 * 1000)
    return { status: 400, json: { error: "issuedAt missing or outside the 10-minute window" } };
  if (!db.prepare("SELECT id FROM roots WHERE id = ?").get(rootId)) return { status: 404, json: { error: "unknown root" } };
  // authenticated by the ROOT's device-auth key — the anchor, never a persona key; multi-anchor: the root's own
  const anchor = anchorForRoot(db, rootId, body.anchorPubKey);
  if (!anchor) return { status: 409, json: { error: "no device-auth anchor registered for this root (name anchorPubKey)" } };
  if (!verifyEd25519(signature, registerCanonical(mode, commitment, rootId, issuedAt), anchor.pubkey))
    return { status: 403, json: { error: "registration does not verify against the device-auth anchor" } };
  db.prepare("UPDATE roots SET anchor = ? WHERE id = ? AND anchor IS NULL").run(anchor.pubkey, rootId);
  const byCommitment = db.prepare("SELECT root_id, epoch_registered, active_from_epoch, revoked_from_epoch FROM zk_registrations WHERE mode = ? AND commitment = ?").get(mode, commitment);
  if (byCommitment) {
    if (byCommitment.root_id === rootId) {
      if (byCommitment.revoked_from_epoch !== null && byCommitment.revoked_from_epoch !== undefined)
        return { status: 409, json: { error: "this commitment was revoked (append-only) — re-issue a new identity index and register that", revokedFromEpoch: byCommitment.revoked_from_epoch } };
      return { status: 200, json: { ok: true, existing: true, epochRegistered: byCommitment.epoch_registered, activeFromEpoch: byCommitment.active_from_epoch } };
    }
    return { status: 409, json: { error: "commitment already registered to another root" } };
  }
  // Gate 3: one ACTIVE commitment per root. A revoked commitment stays on
  // record (append-only) and the root may register a NEW one — revocation
  // via epoch re-issuance.
  const byRoot = db.prepare("SELECT commitment FROM zk_registrations WHERE mode = ? AND root_id = ? AND revoked_from_epoch IS NULL").get(mode, rootId);
  if (byRoot) return { status: 409, json: { error: "this root already has an active registered commitment (one active per root; revoke it first)" } };
  const { epoch } = epochInfo(db, mode);
  // BATCHED: active from the NEXT epoch, never this one.
  db.prepare(
    "INSERT INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(mode, commitment, rootId, hourGrainMs(Date.now()), epoch, epoch + 1);
  return { status: 201, json: { ok: true, epochRegistered: epoch, activeFromEpoch: epoch + 1 } };
}

/**
 * Gate 3: REVOCATION VIA EPOCH RE-ISSUANCE. Authenticated like a
 * registration (the root's device-auth anchor). Append-only: the row keeps
 * its revocation forever; it takes effect at the NEXT epoch (this epoch's
 * trees are frozen — the invariant), and the root may register a new
 * commitment (a new identity index on the device) from then on. The
 * validator learns "this root revoked" — root-level, like registration.
 */
function revoke(db, body) {
  const { mode, commitment, rootId, issuedAt, signature } = body || {};
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture|live" } };
  if (!isField(commitment)) return { status: 400, json: { error: "commitment must be a decimal field element" } };
  if (typeof rootId !== "string" || !rootId) return { status: 400, json: { error: "rootId required" } };
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 10 * 60 * 1000)
    return { status: 400, json: { error: "issuedAt missing or outside the 10-minute window" } };
  const anchor = anchorForRoot(db, rootId, body.anchorPubKey);
  if (!anchor) return { status: 409, json: { error: "no device-auth anchor registered for this root (name anchorPubKey)" } };
  if (!verifyEd25519(signature, revokeCanonical(mode, commitment, rootId, issuedAt), anchor.pubkey))
    return { status: 403, json: { error: "revocation does not verify against the device-auth anchor" } };
  const row = db.prepare("SELECT root_id, revoked_from_epoch FROM zk_registrations WHERE mode = ? AND commitment = ?").get(mode, commitment);
  if (!row) return { status: 404, json: { error: "commitment is not registered" } };
  if (row.root_id !== rootId) return { status: 403, json: { error: "commitment is not this root's" } };
  if (row.revoked_from_epoch !== null && row.revoked_from_epoch !== undefined)
    return { status: 200, json: { ok: true, existing: true, revokedFromEpoch: row.revoked_from_epoch } };
  const { epoch } = epochInfo(db, mode);
  db.prepare("UPDATE zk_registrations SET revoked_at = ?, revoked_from_epoch = ? WHERE mode = ? AND commitment = ?").run(hourGrainMs(Date.now()), epoch + 1, mode, commitment);
  return { status: 200, json: { ok: true, revokedFromEpoch: epoch + 1 } };
}

// ---------- submission: verify + record nullifier ----------
/**
 * Returns {status, json}. Order of checks is deliberate: universe (mode)
 * first, then kind (unknown → fail closed), then shape (canonical field
 * encodings), then THE CLAIM BINDING (scope / challenge / message must be
 * exactly the derivation for this persona, gate, epoch and root — a proof
 * over anything else proves nothing about the persona it names), then
 * the proof itself, then the root against the SIGNED history, then replay.
 */
async function verifyAndRecord(db, env) {
  if (!env || typeof env !== "object" || env.v !== 1) return { status: 400, json: { error: "malformed envelope" } };
  const mode = env.mode;
  if (!isMode(mode) || !env.publicInputs || env.publicInputs.mode !== mode)
    return { status: 400, json: { error: "envelope universe (mode) invalid or inconsistent" } };
  const kind = env.claimKind;
  if (!CLAIM_KINDS.includes(kind) || env.publicInputs.claimKind !== kind)
    return { status: 400, json: { error: "unknown claim kind (fail closed)" } };
  const p = env.publicInputs;
  for (const k of ["tree", "merkleTreeRoot", "scope", "message", "personaId", "gateId", "challenge"]) {
    if (typeof p[k] !== "string" || !p[k]) return { status: 400, json: { error: `publicInputs.${k} missing` } };
  }
  if (!Number.isInteger(p.epoch) || p.epoch < 0) return { status: 400, json: { error: "publicInputs.epoch must be a non-negative integer" } };
  if (!isField(p.scope) || !isField(p.message) || !isField(p.merkleTreeRoot) || !isField(env.nullifier))
    return { status: 400, json: { error: "public values must be canonical decimal field elements" } };
  if (!isKnownTree(p.tree)) return { status: 400, json: { error: "unknown tree" } };
  // gateId grammar widened for attestation gates ("attest:<issuer>/<bucket>"); both sides agree (lib/zk/prove.ts)
  if (!/^[A-Za-z0-9_]{1,80}$/.test(p.personaId) || !/^[A-Za-z0-9_.:\/-]{1,96}$/.test(p.gateId))
    return { status: 400, json: { error: "personaId/gateId malformed" } };
  // Gate 3: kind-specific public inputs, validated BEFORE the binding
  if (kind === "fork-continuity" && !FORK_COMMIT_RE.test(p.forkCommit || "")) return { status: 400, json: { error: "fork-continuity: forkCommit (64 hex) required" } };
  if (kind === "attestation" && (!validIssuer(p.issuer) || !validBucket(p.bucket) || p.tree !== attestTreeName(p.issuer, p.bucket)))
    return { status: 400, json: { error: "attestation: issuer and bucket required and the tree must be attest:<issuer>/<bucket>" } };
  if (kind !== "fork-continuity" && p.forkCommit !== undefined) return { status: 400, json: { error: "forkCommit is only valid on a fork-continuity claim" } };
  // MULTI-FID Gate 4: an anon post names NO persona and carries its text; nothing else may
  if (kind === "anon-post") {
    if (p.personaId !== ANON_PERSONA) return { status: 400, json: { error: "anon-post: personaId must be the constant 'anon'" } };
    if (!CAST_HASH_RE.test(p.castHash || "")) return { status: 400, json: { error: "anon-post: castHash (64 hex) required" } };
    if (!CAST_HASH_RE.test(p.attributionCommitment || "")) return { status: 400, json: { error: "anon-post: attributionCommitment (64 hex) required" } };
    const text = env.payload && typeof env.payload === "object" ? env.payload.text : undefined;
    const nonce = env.payload && typeof env.payload === "object" ? env.payload.nonce : undefined;
    if (typeof text !== "string" || !text.trim() || text.length > anonPostMaxChars()) return { status: 400, json: { error: "anon-post: payload.text required (1.." + anonPostMaxChars() + " chars)" } };
    if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return { status: 400, json: { error: "anon-post: payload.nonce (32 hex) required" } };
    if (anonCastHash(text, nonce) !== p.castHash) return { status: 400, json: { error: "anon-post: the text does not hash to castHash (tampered payload)" } };
    // PERSONA LAUNCH P4 (R8): the payload is EXACTLY {text, nonce, note} — the 256-byte ring note rides every anon post
    if (Object.keys(env.payload).length !== 3) return { status: 400, json: { error: "anon-post: payload must be exactly the text, its nonce and the note" } };
    const note = env.payload.note;
    if (typeof note !== "string" || !NOTE_RE.test(note)) return { status: 400, json: { error: "anon-post: payload.note (256 bytes as 512 lowercase hex) required" } };
    if (!CAST_HASH_RE.test(p.noteHash || "")) return { status: 400, json: { error: "anon-post: noteHash (64 hex) required" } };
    // sha256 over the RAW 256 bytes on both sides (lib/zk/gate.ts) — the message binds noteHash, so a swapped note fails here
    if (createHash("sha256").update(Buffer.from(note, "hex")).digest("hex") !== p.noteHash) return { status: 400, json: { error: "anon-post: the note does not hash to noteHash" } };
    // PERSONA LAUNCH P3: the slot — an integer 0..K-1, checked here AND rebuilt into the scope by the binding below, all
    // before any nullifier is looked at. The slot is read off the wire and NEVER stored (no column, no log, and the
    // refusal reasons kept for the signed reader do not carry it): the validator can compute a person's K candidate
    // scopes for a window, which is the residual A-ANON-SLOT-INDEX-VISIBLE, and keeps nothing that would let it later.
    if (!isAnonSlot(p.slot)) return { status: 400, json: { error: "anon-post: slot required, an integer from 0 to " + (anonPostSlots() - 1) } };
    if (p.launchCommit !== undefined) return { status: 400, json: { error: "launchCommit is only valid on a persona-launch claim" } };
    // PERSONA LAUNCH P8: an X copy's hash rides only its own claim kind
    if (p.xHash !== undefined) return { status: 400, json: { error: "xHash is only valid on an x-anon-post claim" } };
    // PUBLIC GO-LIVE (ASM-1): on the fid-gated shape a LIVE anon post proves the gated plain tree — "valid", which must also
    // be the configured anon tree — and NOTHING else. A reach tree is built from first-come issuer registrations and
    // anchor-signed issuances, never from the fid gate, so a self-issued attest:fc.reach/* would be a crowd of the poster's
    // own making that skips the gate. Refused here, before the binding and before any nullifier is looked at. The test
    // universe (the preview's fixture reach tiers) and every ungated validator are untouched.
    if (gatedLiveTreeRefused(mode, p.tree)) {
      const msg = `anon-post: on this site a live anonymous post proves the Farcaster-joined crowd (valid) only, not ${p.tree}`;
      noteAnonRefusal(p.castHash, msg);
      return { status: 400, json: { error: msg, code: "gated-tree" } };
    }
  } else if (kind === "x-anon-post") {
    // PERSONA LAUNCH P8 — THE ANONYMOUS X COPY (validator/xoutbox.js). Every check here runs BEFORE the binding and before
    // any nullifier is looked at. The live universe first: X posting is not built (no live transport exists — O4), so a
    // live X copy is a 503 that consumes nothing. Then the shape: the constant 'anon', the 64-hex xHash, EXACTLY
    // { text, nonce } (no ring note: an X copy is never revealed by a launch, so it carries none), the text hashing to
    // xHash under its own domain, the PLAIN anon tree (an X copy carries no boost: a reach tree is refused), an X slot
    // 0..K_X-1 (read off the wire, never stored — A-X-SLOT-INDEX-VISIBLE), none of the other kinds' fields, and the
    // outbox's text policy (validateXText: one https link with a short quote, no @mention, no paragraph breaks, ≤ 280).
    if (mode !== "fixture") return { status: 503, json: { error: "X posting is not built: only test data, and nothing reaches X" } };
    if (p.personaId !== ANON_PERSONA) return { status: 400, json: { error: "x-anon-post: personaId must be the constant 'anon'" } };
    if (p.gateId !== "x-anon-post") return { status: 400, json: { error: "x-anon-post: gateId must be 'x-anon-post'" } };
    if (!CAST_HASH_RE.test(p.xHash || "")) return { status: 400, json: { error: "x-anon-post: xHash (64 hex) required" } };
    for (const k of ["castHash", "attributionCommitment", "noteHash", "launchCommit"]) {
      if (p[k] !== undefined) return { status: 400, json: { error: `${k} is not valid on an x-anon-post claim` } };
    }
    if (!env.payload || typeof env.payload !== "object" || Array.isArray(env.payload) || Object.keys(env.payload).length !== 2) return { status: 400, json: { error: "x-anon-post: payload must be exactly the text and its nonce" } };
    const text = env.payload.text;
    const nonce = env.payload.nonce;
    if (typeof text !== "string" || !text.trim()) return { status: 400, json: { error: "x-anon-post: payload.text required" } };
    if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return { status: 400, json: { error: "x-anon-post: payload.nonce (32 hex) required" } };
    if (xAnonHash(text, nonce) !== p.xHash) return { status: 400, json: { error: "x-anon-post: the text does not hash to xHash (tampered payload)" } };
    if (p.tree !== anonPostTree()) return { status: 400, json: { error: `x-anon-post: an X copy proves the plain anon tree ${anonPostTree()} — never a reach tier (X carries no boost)` } };
    if (!isXSlot(p.slot)) return { status: 400, json: { error: "x-anon-post: slot required, an integer from 0 to " + (xAnonPostSlots() - 1) } };
    let xo;
    try {
      xo = xoutboxModule();
    } catch {
      return { status: 503, json: { error: "x-anon-post: the X outbox is not available on this validator" } };
    }
    const why = xo.validateXText(text);
    if (why !== null) return { status: 400, json: { error: "x-anon-post: " + why } };
  } else if (kind === "persona-launch") {
    // PERSONA LAUNCH P6: the anonymous launch request — the constant 'anon', its commitment, and EXACTLY { request }.
    // The request's own rules and its commitment are the registrar's (validator/registrar.js): it is asked here, before
    // the binding, and queues the request inside the record transaction below (a throw there rolls the nullifier back).
    if (p.personaId !== ANON_PERSONA) return { status: 400, json: { error: "persona-launch: personaId must be the constant 'anon'" } };
    if (!LAUNCH_COMMIT_RE.test(p.launchCommit || "")) return { status: 400, json: { error: "persona-launch: launchCommit (64 hex) required" } };
    for (const k of ["castHash", "attributionCommitment", "slot", "noteHash"]) {
      if (p[k] !== undefined) return { status: 400, json: { error: `${k} is not valid on a persona-launch claim` } };
    }
    if (p.xHash !== undefined) return { status: 400, json: { error: "xHash is only valid on an x-anon-post claim" } };
    if (!env.payload || typeof env.payload !== "object" || Object.keys(env.payload).length !== 1 || typeof env.payload.request !== "string" || !env.payload.request)
      return { status: 400, json: { error: "persona-launch: payload must be exactly { request }" } };
    if (Buffer.byteLength(env.payload.request, "utf8") > LAUNCH_REQUEST_MAX_BYTES) return { status: 400, json: { error: `persona-launch: the request is larger than ${LAUNCH_REQUEST_MAX_BYTES} bytes` } };
    let reg;
    try {
      reg = registrarModule();
    } catch {
      return { status: 503, json: { error: "persona-launch: the registrar is not available on this validator" } };
    }
    let commitOk = false;
    let why = null;
    try {
      commitOk = reg.launchCommitOf(env.payload.request) === p.launchCommit;
      why = reg.validateLaunchRequest(env.payload.request);
    } catch (e) {
      return { status: 400, json: { error: "persona-launch: the request could not be read (" + (e && e.message ? e.message : String(e)) + ")" } };
    }
    if (!commitOk) return { status: 400, json: { error: "persona-launch: the request does not hash to launchCommit" } };
    if (why !== null) return { status: 400, json: { error: "persona-launch: " + String(why) } };
  } else {
    if (p.personaId === ANON_PERSONA) return { status: 400, json: { error: "'anon' is reserved for anon posts" } };
    if (p.castHash !== undefined) return { status: 400, json: { error: "castHash is only valid on an anon-post claim" } };
    if (p.attributionCommitment !== undefined) return { status: 400, json: { error: "attributionCommitment is only valid on an anon-post claim" } };
    if (p.slot !== undefined) return { status: 400, json: { error: "slot is only valid on an anon-post claim" } };
    if (p.noteHash !== undefined) return { status: 400, json: { error: "noteHash is only valid on an anon-post claim" } };
    if (p.launchCommit !== undefined) return { status: 400, json: { error: "launchCommit is only valid on a persona-launch claim" } };
    if (p.xHash !== undefined) return { status: 400, json: { error: "xHash is only valid on an x-anon-post claim" } };
    if (env.payload !== undefined) return { status: 400, json: { error: "a payload is only valid on an anon-post or persona-launch claim" } };
  }
  if (kind !== "attestation" && (p.issuer !== undefined || p.bucket !== undefined)) return { status: 400, json: { error: "issuer/bucket are only valid on an attestation claim" } };
  // THE CLAIM BINDING — before any proof is looked at.
  let expected;
  try {
    expected = expectedPublicValues(p);
  } catch (e) {
    return { status: 400, json: { error: "claim binding: " + e.message } };
  }
  // ANON REVIEW (A2-5): an anon post's refusal reason is kept for the device-signed config reader (never the wire)
  const anonNote = (msg) => {
    if (kind === "anon-post") noteAnonRefusal(p.castHash, msg);
    return msg;
  };
  if (p.challenge !== expected.challenge || p.scope !== expected.scope || p.message !== expected.message) {
    return { status: 400, json: { error: anonNote("public inputs are not the canonical derivation for this (persona, gate, epoch, root) — the proof binds nothing about the persona it names") } };
  }
  const body = env.proof;
  if (mode === "fixture") {
    // the toy scheme, byte-identical to the client
    if (!body || body.scheme !== "layers-zk-fixture/1" || typeof body.tag !== "string")
      return { status: 400, json: { error: "malformed fixture proof body" } };
    if (fixtureTag(canonicalPublicInputs(p), env.nullifier) !== body.tag)
      return { status: 400, json: { error: "tag does not match the public inputs (tampered signals)" } };
  } else {
    // LIVE: stock Semaphore v4 Groth16 verification against the PINNED key.
    // A throw (unpinned key, malformed points) is a refusal.
    if (!body || body.scheme !== "semaphore-v4" || !Array.isArray(body.points) || body.points.length !== 8 || body.merkleTreeDepth !== MERKLE_TREE_DEPTH)
      return { status: 400, json: { error: "malformed semaphore proof body" } };
    if (!vkeyPinned()) return { status: 503, json: { error: "validator verification key is not the recorded pin — refusing to verify" } };
    let valid = false;
    try {
      valid = await verifyLiveProof(body, p, env.nullifier);
    } catch {
      valid = false;
    }
    if (valid !== true) return { status: 400, json: { error: anonNote("groth16 verification failed") } };
  }
  // ROOT against the SIGNED history: current epoch or the one-epoch grace
  const { epoch: current } = epochInfo(db, mode);
  currentTrees(db, mode);
  if (p.epoch !== current && p.epoch !== current - 1)
    return { status: 400, json: { error: anonNote("epoch is neither current nor within the one-epoch grace") } };
  // MULTI-FID Gate 5 (attack-fid-3 #7): no grace for an anon post — at a window boundary the previous window's
  // nullifier would let a second post through
  if (kind === "anon-post" && p.epoch !== current) return { status: 400, json: { error: anonNote("anon-post: the proof must be for the current epoch (no grace)") } };
  // PERSONA LAUNCH P6: a launch request gets no grace either (one per window — the window boundary must not admit two)
  if (kind === "persona-launch" && p.epoch !== current) return { status: 400, json: { error: "persona-launch: the proof must be for the current epoch (no grace)" } };
  // PERSONA LAUNCH P8: an X copy gets no grace either (its slot is the window's — a boundary must not admit two)
  if (kind === "x-anon-post" && p.epoch !== current) return { status: 400, json: { error: "x-anon-post: the proof must be for the current epoch (no grace)" } };
  const hist = db.prepare("SELECT root FROM zk_root_history WHERE mode = ? AND tree = ? AND epoch = ?").get(mode, p.tree, p.epoch);
  if (!hist || hist.root !== p.merkleTreeRoot)
    return { status: 400, json: { error: anonNote("merkle root is not the signed history root for that tree and epoch") } };
  // Gate 3: an attestation proof over an EMPTY attest tree (root "0") proves nothing
  if (kind === "attestation" && hist.root === "0") return { status: 400, json: { error: "attestation tree was empty that epoch" } };
  // PERSONA LAUNCH P5 (R6): the size of the FROZEN tree the post proved, at its epoch (the signed placements — the same
  // leaves the signed root commits to). A reach tree under the crowd floor is refused before any nullifier is consumed:
  // "posted by an account with 10k+ followers" must never describe a crowd small enough to name the account. The size
  // is recorded on the row (tree_size), and the client's label is judged from it (lib/reach/boost.ts).
  let treeSize = null;
  if (kind === "anon-post") {
    treeSize = db.prepare("SELECT COUNT(*) AS n FROM zk_placements WHERE mode = ? AND tree = ? AND epoch = ?").get(mode, p.tree, p.epoch).n;
    if (isReachTree(p.tree) && treeSize < reachFloor())
      return { status: 400, json: { error: anonNote(`anon-post: the ${p.tree} tier is under the crowd floor (${treeSize} of ${reachFloor()} accounts) — refused`) } };
    // PERSONA LAUNCH wave 3 (L3): and the BAND it leaves below it, on the same frozen sizes (reachBandRefusal)
    const band = reachBandRefusal(db, mode, p.tree, p.epoch);
    if (band) return { status: 400, json: { error: anonNote(`anon-post: ${band} — refused`) } };
  }
  // REPLAY: one nullifier, ever (per universe)
  const seen = db.prepare("SELECT 1 FROM zk_nullifiers WHERE mode = ? AND nullifier = ?").get(mode, env.nullifier);
  if (seen) return { status: 409, json: { error: "nullifier already seen (replay)" } };
  // PUBLIC GO-LIVE — THE AUTOMATIC TEXT FILTER (validator/anon-filter.js), on a VERIFIED anon post, before anything is
  // stored or relayed and before the nullifier is consumed: a refused post consumes nothing. Logged as the rule id and the
  // hour only (never the text); the reason is kept for the device-signed reader like every other refusal (A2-5).
  if (kind === "anon-post") {
    const refusedBy = require("./anon-filter").checkAnonFilter(env.payload.text, process.env);
    if (refusedBy) {
      require("./anonpublic").recordFilterRefusal(db, mode, refusedBy.rule);
      return { status: 400, json: { error: anonNote("anon-post: " + refusedBy.sentence), code: "filter", rule: refusedBy.rule } };
    }
  }
  // MULTI-FID Gate 4: THE RELAY. The validator posts the text through ITS shared anon account and
  // records (mode, castHash, text, epoch, hour-grained time, network hash, fid) — no persona, no root,
  // no nullifier on that row, nothing an attribution index could join. On live the network write
  // happens BEFORE the nullifier is consumed (a relay that cannot post consumes nothing); an
  // in-flight set closes the window between the replay check and the insert.
  // MULTI-FID Gate 5 (attack-fid-2 #2, attack-fid-3 #5/#8): the anon row is written WITH the nullifier in one
  // transaction. On fixture the row is the network (relayed at once). On LIVE the row is PENDING: the validator
  // relays it on its own schedule (the top of the next relay interval, pending rows in random order — see
  // anonRelayLoop), so the network timestamp is the relay slot, never the submission time (D-FID-5-STORE-AND-FORWARD).
  // The live cap is counted inside the transaction (pending + relayed), the account must be named, armed and
  // its signer approved for exactly that fid, and a foreign signer in the validator's env refuses everything.
  let anonRow = null;
  if (kind === "anon-post") {
    if (inFlightNullifiers.has(env.nullifier)) return { status: 409, json: { error: "nullifier already seen (replay)" } };
    inFlightNullifiers.add(env.nullifier);
    try {
      const acct = anonRelayAccount();
      if (mode === "live") {
        // PUBLIC GO-LIVE: the AGENT path names its own problems (names only — the switch, the cap, a second credential, the
        // transport); the owner path's refusals below are unchanged word for word
        if (acct.kind === "agent" && !acct.armed) return { status: 503, json: { error: anonNote("anon relay unavailable: " + acct.problems.join("; ")) } };
        if (acct.foreignSigner) return { status: 503, json: { error: anonNote("anon relay refused: a signer credential that is not the anon account's is present in the validator's environment (NEYNAR_SIGNER_UUID)") } };
        if (acct.transport !== "hub" && (!acct.fid || !acct.signerUuid || !acct.apiKey)) return { status: 503, json: { error: anonNote("anon relay unavailable: the validator names no shared anon account (FC_ANON_FID / FC_ANON_SIGNER_UUID / NEYNAR_API_KEY)") } };
        if (!acct.armed) return { status: 503, json: { error: anonNote("anon relay refused: the validator is not armed for real writes (ENABLE_FC_WRITE)") } };
        if (!(await anonSignerApproved(acct))) return { status: 503, json: { error: anonNote("anon relay refused: the configured signer is not approved for FC_ANON_FID") } };
        anonRow = { status: "pending", hash: "", fid: acct.fid, relayedAt: 0 };
      } else {
        anonRow = { status: "relayed", hash: "0xanon" + createHash("sha256").update("layers-anon-network/1|" + mode + "|" + p.castHash).digest("hex").slice(0, 32), fid: acct.fid, relayedAt: Math.floor(Date.now() / 3_600_000) * 3_600_000 };
      }
    } finally {
      if (!anonRow) inFlightNullifiers.delete(env.nullifier);
    }
  }
  db.exec("BEGIN");
  try {
    if (anonRow) {
      // PERSONA LAUNCH P3 (D4): the GLOBAL daily cap, in this universe, counted inside the transaction (pending + relayed
      // rows of the current day's epochs) — a refusal rolls back before the nullifier below is consumed
      if (anonDailyUsed(db, mode, p.epoch) >= anonDailyCap()) throw Object.assign(new Error("anon relay refused: today's anonymous post limit (ZK_ANON_POST_DAILY_CAP) is reached — posting opens again tomorrow"), { cap: true });
    }
    if (anonRow && mode === "live") {
      // ANON REVIEW (A2-3, R3-08): the cap counts the rows that reached or can still reach the network — pending and
      // relayed — never a row the relay gave up on ('failed') or one the network answered for another author
      // PERSONA LAUNCH P3: null on the public shape when not set explicitly (the daily cap is its limit)
      const lifetime = anonLiveCap();
      const n = db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = 'live' AND status IN ('pending', 'relayed')").get().n;
      if (lifetime !== null && n >= lifetime) throw Object.assign(new Error("anon relay refused: the live relay cap (ZK_ANON_POST_LIVE_CAP) is reached"), { cap: true });
    }
    // PERSONA LAUNCH P8: the X outbox's daily cap, counted inside this transaction before the nullifier is consumed
    if (kind === "x-anon-post") xoutboxModule().assertDailyRoom(db, mode);
    db.prepare("INSERT INTO zk_nullifiers (mode, nullifier, claim_kind, tree, epoch) VALUES (?, ?, ?, ?, ?)").run(mode, env.nullifier, kind, p.tree, p.epoch);
    if (anonRow) {
      // PERSONA LAUNCH P3 (migration 21): the row records the TREE the post proved (P5: an anon post may prove any allowed
      // reach tree, and the For You boost reads it). PERSONA LAUNCH P4: the fixed-size ring note (256 bytes, real or
      // random — every row's note is the same size). PERSONA LAUNCH P5 (migration 24): the frozen tree's SIZE at the
      // post's epoch. Never the slot, never a persona: the row is what the network shows plus the public commitment,
      // the predicate, its crowd size and an opaque note.
      db.prepare("INSERT INTO zk_anon_casts (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment, tree, note, tree_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        mode,
        p.castHash,
        env.payload.text,
        p.epoch,
        anonRow.relayedAt,
        anonRow.hash,
        anonRow.fid,
        anonRow.status,
        p.attributionCommitment,
        p.tree,
        env.payload.note,
        treeSize
      );
    }
    if (kind === "persona-launch") {
      // PERSONA LAUNCH P6: the registrar queues the request in THIS transaction, right after the nullifier — a refusal
      // (a throw) rolls the nullifier back, so a request the registrar did not take consumed nothing
      registrarModule().enqueueLaunch(db, mode, env.payload.request, p.launchCommit, p.epoch);
    }
    if (kind === "x-anon-post") {
      // PERSONA LAUNCH P8: the outbox takes the text as 'review' in THIS transaction, right after the nullifier — a refusal
      // (a duplicate, a policy change) rolls the nullifier back, so a copy the outbox did not take consumed nothing
      xoutboxModule().enqueueX(db, mode, env.payload, p.xHash, p.epoch);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    if (anonRow) inFlightNullifiers.delete(env.nullifier);
    if (kind === "anon-post") noteAnonRefusal(p.castHash, e && e.cap ? e.message : "record failed: " + e.message);
    if (e && e.cap) return { status: 503, json: { error: e.message } };
    // the registrar may say why it refused with a status of its own (a duplicate commitment, a full queue)
    if (kind === "persona-launch" && e && Number.isInteger(e.status) && e.status >= 400 && e.status < 600) return { status: e.status, json: { error: "persona-launch: " + e.message } };
    // PERSONA LAUNCH P8: the outbox's own refusals carry their status (a duplicate 409, a text it will not take 400)
    if (kind === "x-anon-post" && e && Number.isInteger(e.status) && e.status >= 400 && e.status < 600) return { status: e.status, json: { error: "x-anon-post: " + e.message } };
    return { status: 500, json: { error: "record failed: " + (e && e.message ? e.message : String(e)) } };
  }
  if (anonRow) inFlightNullifiers.delete(env.nullifier);
  // Gate 2: a verified membership in a TIER tree marks the persona
  // eligible for the gate this epoch, at that tier. (A `valid`-tree proof
  // proves non-revocation only and grants no tier.)
  const tierMatch = /^tier-(\d+)$/.exec(p.tree);
  // Gate 3: a fork-continuity proof in a tier tree carries the tier to the
  // NEW persona exactly like a tier-membership proof — through the proof,
  // never through a root lookup — and records the continuity claim.
  if (kind === "fork-continuity" && tierMatch) {
    db.prepare(
      "INSERT INTO zk_fork_claims (mode, persona_id, fork_commit, tree, tier, epoch, nullifier) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(mode, persona_id, fork_commit) DO UPDATE SET tree = excluded.tree, tier = MAX(tier, excluded.tier), epoch = excluded.epoch, nullifier = excluded.nullifier"
    ).run(mode, p.personaId, p.forkCommit, p.tree, Number(tierMatch[1]), p.epoch, env.nullifier);
    // Gate 4 (attack-z2-3 #5): a presence log like the others — the current epoch and its grace, never forever
    db.prepare("DELETE FROM zk_fork_claims WHERE mode = ? AND epoch < ?").run(mode, current - 1);
  }
  if (kind === "attestation") {
    db.prepare("INSERT OR REPLACE INTO zk_attestation_claims (mode, persona_id, issuer, bucket, epoch, nullifier) VALUES (?, ?, ?, ?, ?, ?)").run(mode, p.personaId, p.issuer, p.bucket, p.epoch, env.nullifier);
    db.prepare("DELETE FROM zk_attestation_claims WHERE mode = ? AND epoch < ?").run(mode, current - 1);
  }
  if ((kind === "tier-membership" || kind === "fork-continuity") && tierMatch) {
    const tier = Number(tierMatch[1]);
    db.prepare(
      "INSERT INTO zk_eligibility (mode, persona_id, gate_id, tier, epoch, nullifier) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(mode, persona_id, gate_id, epoch) DO UPDATE SET tier = MAX(tier, excluded.tier), nullifier = excluded.nullifier"
    ).run(mode, p.personaId, p.gateId, tier, p.epoch, env.nullifier);
    // attack-3 F-12: the eligibility store is a presence log; keep only
    // what the gate can still use (current epoch + the one-epoch grace).
    db.prepare("DELETE FROM zk_eligibility WHERE mode = ? AND epoch < ?").run(mode, current - 1);
  }
  return { status: 200, json: { ok: true, accepted: true, epoch: p.epoch } };
}

/** Eligibility at the current epoch or its one-epoch grace, highest wins. */
function eligibilityFor(db, mode, gateId, personaId) {
  const { epoch } = epochInfo(db, mode);
  const row = db
    .prepare(
      "SELECT persona_id, gate_id, tier, epoch FROM zk_eligibility WHERE mode = ? AND gate_id = ? AND persona_id = ? AND epoch IN (?, ?) ORDER BY tier DESC, epoch DESC LIMIT 1"
    )
    .get(mode, gateId, personaId, epoch, epoch - 1);
  return row ? { personaId: row.persona_id, gateId: row.gate_id, tier: row.tier, epoch: row.epoch } : null;
}
function eligibilityMap(db, mode, gateId) {
  const { epoch } = epochInfo(db, mode);
  const rows = db
    .prepare("SELECT persona_id, MAX(tier) AS tier FROM zk_eligibility WHERE mode = ? AND gate_id = ? AND epoch IN (?, ?) GROUP BY persona_id")
    .all(mode, gateId, epoch, epoch - 1);
  const tiers = {};
  for (const r of rows) tiers[r.persona_id] = r.tier;
  return { epoch, tiers };
}

// ---------- mount ----------
/**
 * opts.requireSig / opts.checkEnvelope come from server.js: when the
 * deployment is armed (LAYERS_REQUIRE_SIG=true) the eligibility reads
 * require the same device-signed envelope as state writes (attack-1
 * finding 5 / attack-3 F-9: the map of who-proved-what was a public,
 * pollable, cross-origin-readable arrival oracle).
 */
function mountZk(app, db, opts = {}) {
  const requireSig = opts.requireSig === true && typeof opts.checkEnvelope === "function";
  const EMPTY_BODY_HASH = createHash("sha256").update("").digest("hex");
  const gatedRead = (req, res, ns) => {
    if (!requireSig) return true;
    const bad = opts.checkEnvelope(req, ns, EMPTY_BODY_HASH);
    if (bad) {
      res.status(bad.status).json({ error: bad.error });
      return false;
    }
    return true;
  };
  const devOnly = (res) => {
    if (!devHooksOn()) {
      res.status(403).json({ error: "zk dev hooks are disabled (ZK_DEV_HOOKS)" });
      return false;
    }
    return true;
  };
  // attack-1 finding 7: the first submission of an epoch used to pay the
  // tree build + signing inside the anonymous request's timing floor.
  // Build the epoch's trees on a timer instead, so no submission does.
  // dev-only: count zk GETs per path (the prefetch/render-path assertion)
  app.use("/zk", (req, res, next) => {
    if (devHooksOn() && req.method === "GET" && !req.path.startsWith("/dev/")) requestCounts.set(req.path, (requestCounts.get(req.path) || 0) + 1);
    next();
  });

  const warm = setInterval(() => {
    for (const mode of MODES) {
      try {
        currentTrees(db, mode);
      } catch {
        /* a broken frozen epoch is reported by the request path, loudly */
      }
    }
  }, 30_000);
  warm.unref?.();

  app.get("/zk/validator-key", (req, res) => {
    res.json({ pubkey: validatorKey(db).pubHex });
  });

  app.get("/zk/epoch", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    res.json(epochInfo(db, mode));
  });

  app.get("/zk/trees", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { epoch, trees } = currentTrees(db, mode);
    const floor = anonFloor();
    res.json({
      mode,
      epoch,
      floor,
      trees: Object.keys(trees).map((tree) => ({
        tree,
        epoch,
        root: rootOf(trees[tree].group),
        size: trees[tree].members.length,
        floor,
        clearsFloor: trees[tree].members.length >= floor,
      })),
    });
  });

  app.get("/zk/registration", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    const commitment = String(req.query.commitment || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!isField(commitment)) return res.status(400).json({ error: "commitment must be a decimal field element" });
    const row = db
      .prepare("SELECT epoch_registered, active_from_epoch, revoked_from_epoch FROM zk_registrations WHERE mode = ? AND commitment = ?")
      .get(mode, commitment);
    // Public material only: whether a commitment is registered and from
    // when. NEVER the root it belongs to.
    if (!row) return res.json({ registered: false, epochRegistered: null, activeFromEpoch: null });
    res.json({ registered: true, epochRegistered: row.epoch_registered, activeFromEpoch: row.active_from_epoch, revokedFromEpoch: row.revoked_from_epoch });
  });

  /**
   * THE PLAIN DOOR — DEV ONLY (attack-2 finding 10). The product submits
   * ONLY over the anonymous channel (validator/anon.js: header allowlist,
   * PoW, constant shape, timing floor). This endpoint exists for unit
   * tests and suites that need the refusal REASON as an oracle; it is
   * refused unless ZK_DEV_HOOKS=true, like the other dev hooks.
   */
  app.post("/zk/submit", async (req, res) => {
    if (!devOnly(res)) return;
    const r = await verifyAndRecord(db, (req.body || {}).envelope);
    res.status(r.status).json(r.json);
  });

  /** Gate 2: what a persona has PROVEN for a gate. Persona ids ride the
   * proof signal in the clear by design (F2b) — but the RESULT is not a
   * public feed: when the deployment is armed, reading it takes the
   * device-signed envelope (the app's feed build signs its request). */
  app.get("/zk/eligibility", (req, res) => {
    if (!gatedRead(req, res, "zk:eligibility")) return;
    const mode = String(req.query.mode || "fixture");
    const gateId = String(req.query.gateId || "foryou");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (req.query.personaId) return res.json({ eligibility: eligibilityFor(db, mode, gateId, String(req.query.personaId)) });
    res.json(eligibilityMap(db, mode, gateId));
  });

  app.get("/zk/members", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    const tree = String(req.query.tree || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!isKnownTree(tree)) return res.status(404).json({ error: "unknown tree" });
    const { epoch, trees } = currentTrees(db, mode);
    if (!trees[tree]) return res.status(404).json({ error: "tree not issued this epoch" });
    res.json({ mode, tree, epoch, root: rootOf(trees[tree].group), members: trees[tree].members });
  });

  app.get("/zk/history", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    const tree = String(req.query.tree || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!isKnownTree(tree)) return res.status(404).json({ error: "unknown tree" });
    currentTrees(db, mode); // ensure this epoch's entry exists
    const rows = db
      .prepare(
        "SELECT mode, tree, epoch, root, prev_hash AS prevHash, hash, sig FROM zk_root_history WHERE mode = ? AND tree = ? ORDER BY epoch DESC LIMIT ?"
      )
      .all(mode, tree, HISTORY_WINDOW)
      .reverse();
    res.json({ pubkey: validatorKey(db).pubHex, mode, tree, entries: rows });
  });

  app.get("/zk/placement", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    const tree = String(req.query.tree || "");
    const commitment = String(req.query.commitment || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!isKnownTree(tree)) return res.status(404).json({ error: "unknown tree" });
    const { epoch } = currentTrees(db, mode);
    const row = db
      .prepare(
        "SELECT mode, tree, epoch, commitment, leaf_index AS leafIndex, root, sig FROM zk_placements WHERE mode = ? AND tree = ? AND epoch = ? AND commitment = ?"
      )
      .get(mode, tree, epoch, commitment);
    if (!row) return res.status(404).json({ error: "no placement for this commitment in the current epoch" });
    res.json({ placement: row });
  });

  app.post("/zk/register", (req, res) => {
    const r = register(db, req.body);
    res.status(r.status).json(r.json);
  });

  /** Gate 3: revocation via epoch re-issuance (root-level, signed, append-only) */
  app.post("/zk/revoke", (req, res) => {
    const r = revoke(db, req.body);
    res.status(r.status).json(r.json);
  });

  /** Gate 3: has this persona PROVEN continuity under this fork commitment?
   * Public material: the commitment is a hash whose preimage (old persona,
   * nonce) only the device's forward pointer discloses. */
  // MULTI-FID Gate 4: the relayed anon casts — a PUBLIC list (hash, text, time, fid); no viewer, no
  // persona, no nullifier, no root. The app's feed reads it like any other public feed.
  // MULTI-FID Gate 5 (D-FID-5-STORE-AND-FORWARD): pending LIVE anon rows are relayed at the top of each relay interval,
  // in random order, never at submission time; a failed relay stays pending for the next slot
  // ANON REVIEW (A2-4, R1-08): ONE relay run at a time; every cast carries a STABLE idempotency key (the row's hash
  // prefix — Neynar dedupes a retry of the same row after a lost or slow answer); every request is bounded; a row that
  // keeps failing is marked 'failed' after ZK_ANON_RELAY_MAX_ATTEMPTS slots (A2-3) instead of being retried forever and
  // counting against the cap. (R1-03) order and the per-row moment inside the slot's spread come from a CSPRNG.
  const relayAttempts = new Map(); // cast_hash -> failed attempts (in memory; a redeploy starts over)
  const relayDueAt = new Map(); // cast_hash -> the CSPRNG moment within [slot, slot + ZK_ANON_RELAY_SPREAD_MS]
  const relayFailed = (castHash) => {
    const n = (relayAttempts.get(castHash) || 0) + 1;
    relayAttempts.set(castHash, n);
    // a failed row waits for the NEXT slot (its moment is drawn again there): dropping its due moment here keeps the
    // between-slot branch of the timer from re-sending it every second until the attempt limit (skeptic harness)
    relayDueAt.delete(castHash);
    if (n < anonRelayMaxAttempts()) return;
    db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND cast_hash = ? AND status = 'pending'").run(castHash);
    relayAttempts.delete(castHash);
  };
  // PUBLIC GO-LIVE (ASM-3): a DISARMED public relay (the switch off, or the key revoked) DROPS the live posts still waiting
  // for their slot — 'failed', the existing "relay gave up" state: never relayed, never counted, already explained to
  // posters. Freezing them instead meant re-arming published the whole backlog (relayDueAt and the attempts are memory
  // only), and a pending row cannot be reported, so no moderator could have seen it. Run at BOOT (a disarm is a redeploy:
  // the disarmed process drops the backlog before any re-armed one starts) and at every relay slot. The owner service's
  // path (kind owner, not the public shape) is unchanged: its pending rows wait (anonpublic.js dropPendingOnDisarm).
  // Returns true when the relay is not ready (the caller then stops).
  const dropIfDisarmed = (acct) => {
    // THE HUB ROUTE: readiness is the transport's own rule (the hub account has a signer key, not a uuid and an API key)
    if (require("./anonpublic").relayReady(acct)) return false;
    if (require("./anonpublic").dropPendingOnDisarm(acct)) {
      const dropped = db.prepare("UPDATE zk_anon_casts SET status = 'failed' WHERE mode = 'live' AND status = 'pending'").run();
      if (dropped.changes > 0) {
        relayDueAt.clear();
        relayAttempts.clear();
      }
    }
    return true;
  };
  try {
    dropIfDisarmed(anonRelayAccount());
  } catch {
    /* a boot that cannot read its rows is reported by the relay path, at its slot */
  }
  let relayInFlight = null;
  const relayPending = (opts = {}) => {
    if (relayInFlight) return relayInFlight;
    relayInFlight = (async () => {
      const acct = anonRelayAccount();
      if (dropIfDisarmed(acct)) return;
      // PUBLIC GO-LIVE: nothing pending, nothing asked of Neynar (a slot with no row spends no signer lookup)
      if (!db.prepare("SELECT 1 FROM zk_anon_casts WHERE mode = 'live' AND status = 'pending' AND hidden_at IS NULL LIMIT 1").get()) return;
      if (!(await anonSignerApproved(acct))) return;
      const now = Date.now();
      const spread = opts.now === true ? 0 : anonRelaySpreadMs();
      // PUBLIC GO-LIVE: the transport seam (validator/anonpublic.js) — on the owner path the very POST made here before; a
      // HIDDEN row (a moderator removed it before its slot) is never relayed
      const transport = require("./anonpublic").anonTransport(acct);
      let rows = db.prepare("SELECT cast_hash, text FROM zk_anon_casts WHERE mode = 'live' AND status = 'pending' AND hidden_at IS NULL").all();
      for (const r of rows) if (!relayDueAt.has(r.cast_hash)) relayDueAt.set(r.cast_hash, now + (spread > 0 ? randomInt(0, spread + 1) : 0));
      if (opts.now !== true) rows = rows.filter((r) => relayDueAt.get(r.cast_hash) <= now);
      for (let i = rows.length - 1; i > 0; i--) { const j = randomInt(0, i + 1); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      for (const r of rows) {
        try {
          const sent = await transport.publish(r.text, r.cast_hash.slice(0, 16));
          const hash = sent.hash || null;
          const author = Number.isFinite(sent.author) ? sent.author : NaN;
          if (!sent.ok || !hash) { relayFailed(r.cast_hash); continue; } // stays pending (bounded)
          relayAttempts.delete(r.cast_hash);
          relayDueAt.delete(r.cast_hash);
          if (author !== acct.fid) {
            // the network answered with another author: recorded as refused, never shown as the anon account's (attack-fid-3 #5)
            db.prepare("UPDATE zk_anon_casts SET status = 'refused-author', network_hash = ?, relayed_at = ? WHERE mode = 'live' AND cast_hash = ?").run(hash, Math.floor(Date.now() / 3_600_000) * 3_600_000, r.cast_hash);
            continue;
          }
          db.prepare("UPDATE zk_anon_casts SET status = 'relayed', network_hash = ?, relayed_at = ? WHERE mode = 'live' AND cast_hash = ?").run(hash, Math.floor(Date.now() / 3_600_000) * 3_600_000, r.cast_hash);
        } catch {
          relayFailed(r.cast_hash); // a timeout or a network error: stays pending (bounded); the idem key makes the retry safe
        }
      }
    })().finally(() => {
      relayInFlight = null;
    });
    return relayInFlight;
  };
  let nextRelaySlot = 0;
  const relayTimer = setInterval(() => {
    const now = Date.now();
    if (nextRelaySlot === 0) { const iv = anonRelayIntervalMs(); nextRelaySlot = (Math.floor(now / iv) + 1) * iv + randomInt(0, Math.floor(Math.min(iv / 6, 600_000)) + 1); }
    if (now < nextRelaySlot) {
      // a row whose spread moment has come is relayed between slots (that is what the spread is for)
      if (relayDueAt.size && [...relayDueAt.values()].some((t) => t <= now)) relayPending().catch(() => {});
      return;
    }
    nextRelaySlot = 0;
    relayPending().catch(() => {});
  }, 1000);
  if (relayTimer.unref) relayTimer.unref();
  // rig hook: relay the pending rows NOW (dev hooks only; a live rig's own slot)
  app.post("/zk/dev/relay-now", async (req, res) => {
    if (!devOnly(res)) return;
    await relayPending({ now: true });
    res.json({ ok: true });
  });

  app.get("/zk/anon-casts", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode invalid" });
    // PUBLIC GO-LIVE: a post a moderator removed is HIDDEN (hidden_at; the row is kept) and listed nowhere
    const rows = db.prepare("SELECT cast_hash, text, epoch, relayed_at, network_hash, fid, attributed_fid, attributed_at, attributed_signer, tree, tree_size, note, attributed_batch FROM zk_anon_casts WHERE mode = ? AND status = 'relayed' AND hidden_at IS NULL ORDER BY relayed_at DESC, cast_hash ASC LIMIT 200").all(mode);
    res.json({
      casts: rows.map((r) => ({
        hash: r.network_hash,
        castHash: r.cast_hash,
        text: r.text,
        at: r.relayed_at,
        fid: r.fid,
        epoch: r.epoch,
        attributedFid: r.attributed_fid ?? null,
        attributedAt: r.attributed_at ?? null,
        // §14.2 — the evidence travels with the claim: the reader checks this key against the fid's
        // keys in the Farcaster key registry. A reader who cannot check it must not render the claim.
        attributedSigner: r.attributed_signer ?? null,
        // PERSONA LAUNCH P5: the tree the post proved and its frozen size at the post's epoch (the For You label's inputs)
        tree: r.tree ?? null,
        treeSize: r.tree_size ?? null,
        // PERSONA LAUNCH P4: the fixed-size ring note — opaque here; ring members trial-decrypt it on their own device
        note: r.note ?? null,
        // PERSONA LAUNCH P6: the launch batch reveal that attributed this post (validator/registrar.js), else null
        attributedBatch: r.attributed_batch ?? null,
      })),
    });
  });

  // MULTI-FID PASS — the anoncast reveal pattern: prove ownership of a past anon post and attribute
  // it to a real fid, at the poster's own choice. A real product endpoint (not a dev hook — revealing
  // is something anyone who posted anonymously may do, any time, on either universe).
  //
  // TRUST BOUNDARY (§14.2, corrected). This endpoint decides two things and no more:
  //   1. the caller holds the secret behind THIS cast's commitment (the hash preimage), and
  //   2. the caller holds the private half of the signer key they name, over a statement that binds
  //      the mode, the cast, the fid and that key (so a signature cannot be lifted onto another
  //      cast, another fid, or another key).
  // It does NOT decide that the key belongs to the fid — it holds no fid->key binding and must not
  // (§14 took the persona->fid map off this service for exactly that reason). That last step is the
  // READER's, against the Farcaster key registry; the key is stored and served so the reader can do
  // it, and a reader who cannot check it must render the cast as plain anon. Until this change the
  // fid was taken on the caller's word, which was only a control against our own app.
  // The record itself is one-way and first-reveal-wins.
  app.post("/zk/anon/reveal", (req, res) => {
    // PERSONA LAUNCH P6: the launch's ONE batch reveal, signed by the launched account's registered key, is the
    // registrar's (validator/registrar.js revealBatch) — a missing registrar is a refusal, never a single-post fallback
    if ((req.body || {}).batch === true) {
      let r;
      try {
        r = registrarModule().revealBatch(db, req.body);
      } catch (e) {
        return res.status(503).json({ error: "batch reveal unavailable on this validator (" + (e && e.message ? e.message : String(e)) + ")" });
      }
      return res.status(r.status).json(r.json);
    }
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    const castHash = String(b.castHash || "");
    const secret = String(b.secret || "");
    const fid = Number(b.fid);
    const signerPubKey = String(b.signerPubKey || "");
    const signature = String(b.signature || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode invalid" });
    if (!CAST_HASH_RE.test(castHash)) return res.status(400).json({ error: "castHash malformed" });
    if (!SECRET_RE.test(secret)) return res.status(400).json({ error: "secret malformed" });
    if (!Number.isInteger(fid) || fid <= 0) return res.status(400).json({ error: "fid required" });
    // §14.2 — the fid is no longer taken on the caller's word alone. The reveal must carry a
    // signature by that fid's own Farcaster signer key; the key is stored with the row so a reader
    // can check it against the key registry. This does NOT let the validator decide whose key it is
    // (it holds no fid->key binding, deliberately) — it makes the claim checkable instead of bare.
    if (!SECRET_RE.test(signerPubKey)) return res.status(400).json({ error: "signerPubKey malformed" });
    if (!/^[0-9a-f]{128}$/.test(signature)) return res.status(400).json({ error: "signature malformed" });
    if (!verifyEd25519(signature, revealCanonical(mode, castHash, fid, signerPubKey), signerPubKey)) {
      return res.status(400).json({ error: "reveal signature does not verify under the signer key given" });
    }
    const row = db.prepare("SELECT attribution_commitment, attributed_fid FROM zk_anon_casts WHERE mode = ? AND cast_hash = ? AND status = 'relayed'").get(mode, castHash);
    if (!row) return res.status(404).json({ error: "no relayed anon cast with that hash" });
    if (createHash("sha256").update("layers-anon-attribution/1|" + secret, "utf8").digest("hex") !== row.attribution_commitment) {
      return res.status(400).json({ error: "the secret does not match this cast's commitment" });
    }
    if (row.attributed_fid !== null && row.attributed_fid !== undefined) {
      if (row.attributed_fid === fid) return res.json({ ok: true, attributedFid: fid, alreadyAttributed: true });
      return res.status(409).json({ error: "this cast is already attributed to a different fid — one reveal, ever" });
    }
    const attributedAt = hourGrainMs(Date.now()); // coarse, like every other anon-cast timestamp
    db.prepare("UPDATE zk_anon_casts SET attributed_fid = ?, attributed_at = ?, attributed_signer = ? WHERE mode = ? AND cast_hash = ?").run(fid, attributedAt, signerPubKey, mode, castHash);
    res.json({ ok: true, attributedFid: fid, attributedAt, attributedSigner: signerPubKey });
  });
  app.get("/zk/anon-post/config", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode invalid" });
    const acct = anonRelayAccount();
    // ANON REVIEW (R1-05): the sensitive half — the relay fid, the arming state, the key fingerprint, the live pending
    // count (a submission-time oracle on a public validator) and the per-cast refusal reasons — goes only to a reader
    // that signs with the device envelope when the deployment is armed (the app's own read); an unsigned reader gets
    // the shape the composer needs and nothing else. Unarmed (a rig) answers the full shape as before.
    const full = !requireSig || (!!req.header("x-layers-device") && !opts.checkEnvelope(req, "zk:eligibility", EMPTY_BODY_HASH));
    const count = (status) => db.prepare("SELECT COUNT(*) AS n FROM zk_anon_casts WHERE mode = ? AND status = ?").get(mode, status).n;
    const out = {
      tree: anonPostTree(),
      windowEpochs: anonPostWindowEpochs(),
      maxChars: anonPostMaxChars(),
      liveRelay: mode === "live" ? require("./anonpublic").relayReady(acct) : true,
      relayIntervalMs: anonRelayIntervalMs(),
      relaySpreadMs: anonRelaySpreadMs(),
      // PERSONA LAUNCH P3: the validator's K — public configuration. A client compares it with its OWN K and refuses to
      // post on a mismatch; it never adopts it (lib/zk/gate.ts)
      slotsPerWindow: anonPostSlots(),
      // PERSONA LAUNCH P5: the reach issuers whose bucket trees anon posts may prove here (public configuration; the
      // client offers a tier only for an issuer in this list that it also honours by key)
      // PUBLIC GO-LIVE (ASM-1): none in the live universe of a gated validator (the client then offers no reach tier there)
      reachIssuers: anonReachIssuersFor(mode),
      // PUBLIC GO-LIVE (ASM-1): true when this validator refuses every live anon post that is not into the gated plain tree
      // (arm-public-anon.ps1 checks it before arming: a build without the refusal is not armed)
      liveTreeOnly: mode === "live" && require("./anonpublic").fidGateOn(),
      // PUBLIC GO-LIVE: public configuration of the public relay — the fid gate on the live tree, whether a moderator is set
      // up, that the text filter runs, which relay path this validator is on (agent / owner); never a value or a count
      ...require("./anonpublic").configFields(db, mode, process.env, devHooksOn()),
    };
    if (full) {
      // PERSONA LAUNCH P3 (D4): the daily cap and today's count — the SIGNED reader only: an unsigned count of
      // accepted posts is a submission-time oracle on a public validator (R1-05), exactly like `pending`
      Object.assign(out, { dailyCap: anonDailyCap(), dailyUsed: anonDailyUsed(db, mode, epochInfo(db, mode).epoch) });
      Object.assign(out, {
        armed: acct.armed,
        fid: acct.fid,
        // MULTI-FID Gate 5 (attack-fid-1 #3): a fingerprint of the relay credential, so the app's privacy label can show whether the
        // anon account is a credential distinct from the app's own Neynar identity (never the key itself)
        relayKeyFingerprint: acct.keyFingerprint,
        pending: count("pending"),
        // ANON REVIEW (A2-3): the cap and the counts it is judged against, and the rows the relay gave up on
        relayed: count("relayed"),
        failed: count("failed"),
        cap: anonLiveCap(),
        // ANON REVIEW (R3-19): the last signer check, when one was made for the configured signer (null = not yet asked)
        signerApproved: anonSignerCheck && anonSignerCheck.uuid === (acct.signerUuid || acct.signerPub || "") ? anonSignerCheck.ok : null,
        // PUBLIC GO-LIVE: why the agent path is not armed (names and plain reasons only, never a value)
        relayProblems: acct.problems ?? [],
      });
      const castHash = String(req.query.castHash || "");
      if (CAST_HASH_RE.test(castHash)) out.lastRefusal = lastAnonRefusal.get(castHash) || null;
    }
    res.json(out);
  });

  app.get("/zk/fork-claim", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    const personaId = String(req.query.personaId || "");
    const forkCommit = String(req.query.forkCommit || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId) || !FORK_COMMIT_RE.test(forkCommit)) return res.status(400).json({ error: "personaId/forkCommit malformed" });
    const row = db.prepare("SELECT tree, tier, epoch FROM zk_fork_claims WHERE mode = ? AND persona_id = ? AND fork_commit = ?").get(mode, personaId, forkCommit);
    if (!row) return res.json({ verified: false });
    res.json({ verified: true, tree: row.tree, tier: row.tier, epoch: row.epoch });
  });

  // ---------- ATTESTATION PASS Gate 1: THE OPEN ISSUER INTERFACE ----------
  // Anyone can be an issuer; the protocol does not care who. An issuer is a
  // namespaced id, an Ed25519 key, a claim schema, the BUCKETS it emits and
  // a validity in epochs. Registration is OPEN and self-signed — the key IS
  // the identity, a rotation is a new id — and TRUST is the subscriber's
  // choice (the client decides which issuers it honours), never the
  // validator's. An ISSUANCE is the issuer's signature over {issuer,
  // bucket, subjectCommitment, claimHash, issueEpoch, expiryEpoch}; the
  // validator verifies it under the registered key, learns that issuer I
  // vouched for commitment C under bucket B, and inserts C into
  // attest:<I>/<B> from the NEXT epoch (batched — C10 join-time correlation
  // applies here as it does to registration). It never sees the claim
  // VALUE (the hash is over a nonce-salted claim in the subject's vault)
  // and never a wallet. Expiry is the issuer's DECLARED validity, quantized
  // to the issue epoch — never per-subject (A-Z3-ATTEST-EXPIRY-PARTITION).
  // An issuer revokes ONE issuance with a signed revocation; the leaf drops
  // at the next epoch. The former validator-signed mock hook is gone: the
  // fixture's mock issuer (test.mock-issuer) is an issuer like any other.
  const issuerRow = (mode, id) => db.prepare("SELECT * FROM zk_issuers WHERE mode = ? AND id = ?").get(mode, id);
  const schemaHashOf = (schema) => createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  const issuerJson = (r) => ({
    id: r.id,
    displayName: r.display_name,
    claimSchema: JSON.parse(r.schema_json),
    buckets: JSON.parse(r.buckets_json),
    validityEpochs: r.validity_epochs,
    trustTier: "attested",
    pubkey: r.pubkey,
    registeredAt: r.registered_at,
  });

  /** the issuer registry (public): what each issuer asserts, in which buckets, under which key */
  app.get("/zk/issuers", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { epoch } = epochInfo(db, mode);
    const rows = db.prepare("SELECT * FROM zk_issuers WHERE mode = ? ORDER BY id").all(mode);
    res.json({ mode, epoch, issuers: rows.map(issuerJson) });
  });

  /** OPEN registration, self-signed. Same id + same key: metadata update (200).
   * Same id + another key: 409 — a key rotation is a NEW issuer id. */
  app.post("/zk/issuers", (req, res) => {
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { id, displayName, claimSchema, buckets, validityEpochs, pubkey, sig } = b;
    if (!validIssuer(id)) return res.status(400).json({ error: "issuer id must be namespaced lowercase [a-z0-9] with . or - separators (e.g. onchain.wallet-age), at most 48 chars" });
    // PUBLIC GO-LIVE (ASM-1): on a gated validator the reach ids are not first-come in the live universe
    const reserved = require("./anonpublic").issuerRegistrationRefusal(mode, id);
    if (reserved) return res.status(403).json({ error: reserved });
    if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 80) return res.status(400).json({ error: "displayName required (≤ 80 chars)" });
    if (!claimSchema || typeof claimSchema !== "object" || Array.isArray(claimSchema)) return res.status(400).json({ error: "claimSchema must be a JSON-schema object" });
    if (!Array.isArray(buckets) || buckets.length < 1 || buckets.length > 64 || !buckets.every(validBucket) || new Set(buckets).size !== buckets.length)
      return res.status(400).json({ error: "buckets must be 1..64 distinct lowercase names" });
    if (!Number.isInteger(validityEpochs) || validityEpochs < 1 || validityEpochs > 10000) return res.status(400).json({ error: "validityEpochs must be an integer in 1..10000" });
    if (!/^[0-9a-f]{64}$/.test(pubkey || "")) return res.status(400).json({ error: "pubkey must be a 64-hex Ed25519 public key" });
    const canonical = issuerCanonical({ mode, id, displayName, schemaHash: schemaHashOf(claimSchema), buckets, validityEpochs, pubkey });
    if (!verifyEd25519(sig, canonical, pubkey)) return res.status(400).json({ error: "issuer registration signature does not verify under the given key" });
    const existing = issuerRow(mode, id);
    if (existing && existing.pubkey !== pubkey) return res.status(409).json({ error: "issuer id is registered to another key — a key rotation is a NEW issuer id" });
    // Gate 4 (attack-att-3 #5): an open registry has a SIZE; past it, registration is refused (A-ATT-OPEN-REGISTRY-COST)
    if (!existing && db.prepare("SELECT COUNT(*) AS n FROM zk_issuers WHERE mode = ?").get(mode).n >= 128) return res.status(429).json({ error: "issuer registry is full for this universe (128)" });
    const registeredAt = existing ? existing.registered_at : hourGrainMs(Date.now());
    db.prepare(
      "INSERT INTO zk_issuers (mode, id, display_name, schema_json, buckets_json, validity_epochs, pubkey, sig, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(mode, id) DO UPDATE SET display_name = excluded.display_name, schema_json = excluded.schema_json, buckets_json = excluded.buckets_json, validity_epochs = excluded.validity_epochs, sig = excluded.sig"
    ).run(mode, id, displayName, JSON.stringify(claimSchema), JSON.stringify(buckets), validityEpochs, pubkey, sig, registeredAt);
    res.status(existing ? 200 : 201).json({ ok: true, existing: !!existing, id, registeredAt });
  });

  /** ISSUANCE (one or a batch): issuer-signed, verified under the registered
   * key, batched into attest:<issuer>/<bucket> from the NEXT epoch. Per-item
   * refusals are reported by index; nothing about a refusal names a value. */
  app.post("/zk/attest", (req, res) => {
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const list = Array.isArray(b.attestations) ? b.attestations : [b];
    if (list.length < 1 || list.length > 500) return res.status(400).json({ error: "1..500 attestations per request" });
    // Gate 4 (attack-att-3 #2): the batch is signed by the subject's DEVICE-AUTH key — only the
    // root's own device enters an issuance for its commitment (single-tenant anchor, as registration)
    if (!Number.isFinite(b.issuedAt) || Math.abs(Date.now() - b.issuedAt) > 10 * 60 * 1000) return res.status(400).json({ error: "issuedAt missing or outside the 10-minute window" });
    const anchorKey = typeof b.anchorPubKey === "string" ? b.anchorPubKey : singleAnchor(db);
    const anchor = db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(anchorKey);
    if (!anchor) return res.status(409).json({ error: "no device-auth anchor registered (name anchorPubKey)" });
    if (!verifyEd25519(b.signature, attestSubmitCanonical(mode, JSON.stringify(list), b.issuedAt), anchor.pubkey))
      return res.status(403).json({ error: "submission does not verify against the device-auth anchor" });
    const { epoch } = epochInfo(db, mode);
    const activeFromEpoch = windowStart(epoch);
    const accepted = [];
    const refused = [];
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO zk_attestations (mode, issuer, bucket, commitment, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch, sig, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
    );
    const issuers = new Map();
    for (let i = 0; i < list.length; i++) {
      const a = list[i] || {};
      const no = (error) => refused.push({ i, error });
      const commitment = String(a.commitment || "");
      if (!validIssuer(a.issuer) || !validBucket(a.bucket)) { no("issuer/bucket malformed"); continue; }
      if (!isField(commitment)) { no("commitment must be a decimal field element"); continue; }
      if (!/^[0-9a-f]{64}$/.test(a.claimHash || "")) { no("claimHash must be 64 hex"); continue; }
      if (!Number.isInteger(a.issuedEpoch) || !Number.isInteger(a.expiresEpoch)) { no("issuedEpoch/expiresEpoch must be integers"); continue; }
      if (!issuers.has(a.issuer)) issuers.set(a.issuer, issuerRow(mode, a.issuer));
      const iss = issuers.get(a.issuer);
      if (!iss) { no("issuer is not registered"); continue; }
      if (!JSON.parse(iss.buckets_json).includes(a.bucket)) { no("bucket is not one the issuer declared"); continue; }
      // Gate 4 (attack-att-1 #4): no issue-epoch grace — a late submission was a cell of one by construction
      if (a.issuedEpoch !== epoch) { no("issuedEpoch must be the current epoch (no grace: a late issuance is a cell of one)"); continue; }
      if (a.expiresEpoch !== windowStart(a.issuedEpoch) + iss.validity_epochs) { no("expiresEpoch must be the issue window's activation epoch + the issuer's declared validity (quantized expiry, never per-subject)"); continue; }
      if (!verifyEd25519(a.sig, attestCanonical({ mode, issuer: a.issuer, bucket: a.bucket, commitment, claimHash: a.claimHash, issuedEpoch: a.issuedEpoch, expiresEpoch: a.expiresEpoch }), iss.pubkey)) {
        no("issuer signature does not verify");
        continue;
      }
      const reg = db.prepare("SELECT revoked_from_epoch FROM zk_registrations WHERE mode = ? AND commitment = ?").get(mode, commitment);
      if (!reg) { no("commitment is not registered"); continue; }
      if (reg.revoked_from_epoch !== null && reg.revoked_from_epoch !== undefined) { no("commitment is revoked"); continue; }
      // a renewal of a CURRENTLY ACTIVE issuance keeps its activation epoch (the
      // leaf never flickers); anything else activates next epoch, batched
      const prev = db.prepare("SELECT issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch FROM zk_attestations WHERE mode = ? AND issuer = ? AND bucket = ? AND commitment = ?").get(mode, a.issuer, a.bucket, commitment);
      // Gate 4 (attack-att-3 #4): a REVOKED issuance is not undone by replaying the original — a re-issuance must be newly issued
      if (prev && prev.revoked_from_epoch !== null && prev.revoked_from_epoch !== undefined && a.issuedEpoch <= prev.issued_epoch) { no("this issuance was revoked by the issuer — a re-issuance must carry a later issue epoch"); continue; }
      const prevActive = !!prev && prev.active_from_epoch <= epoch && prev.expires_epoch > epoch && (prev.revoked_from_epoch === null || prev.revoked_from_epoch === undefined || prev.revoked_from_epoch > epoch);
      upsert.run(mode, a.issuer, a.bucket, commitment, a.claimHash, a.issuedEpoch, prevActive ? prev.active_from_epoch : activeFromEpoch, a.expiresEpoch, a.sig, hourGrainMs(Date.now()));
      accepted.push(i);
    }
    // this epoch's frozen trees are untouched; the leaves appear at the next build
    res.status(accepted.length ? 200 : 400).json({ ok: refused.length === 0, accepted: accepted.length, refused, epoch, activeFromEpoch });
  });

  /** ISSUER REVOCATION of one issuance: signed by the issuer, effective next epoch, idempotent */
  app.post("/zk/attest/revoke", (req, res) => {
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { issuer, bucket, issuedAt, sig } = b;
    const commitment = String(b.commitment || "");
    if (!validIssuer(issuer) || !validBucket(bucket) || !isField(commitment)) return res.status(400).json({ error: "issuer/bucket/commitment malformed" });
    if (!Number.isInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > 3_600_000) return res.status(400).json({ error: "issuedAt must be within an hour of now" });
    const iss = issuerRow(mode, issuer);
    if (!iss) return res.status(404).json({ error: "issuer is not registered" });
    if (!verifyEd25519(sig, attestRevokeCanonical({ mode, issuer, bucket, commitment, issuedAt }), iss.pubkey)) return res.status(400).json({ error: "issuer revocation signature does not verify" });
    const row = db.prepare("SELECT revoked_from_epoch FROM zk_attestations WHERE mode = ? AND issuer = ? AND bucket = ? AND commitment = ?").get(mode, issuer, bucket, commitment);
    if (!row) return res.status(404).json({ error: "no such issuance" });
    if (row.revoked_from_epoch !== null && row.revoked_from_epoch !== undefined) return res.json({ ok: true, existing: true, revokedFromEpoch: row.revoked_from_epoch });
    const { epoch } = epochInfo(db, mode);
    db.prepare("UPDATE zk_attestations SET revoked_from_epoch = ? WHERE mode = ? AND issuer = ? AND bucket = ? AND commitment = ?").run(epoch + 1, mode, issuer, bucket, commitment);
    res.json({ ok: true, revokedFromEpoch: epoch + 1 });
  });

  /** the bucket census for THIS epoch (public, like /zk/trees): which
   * (issuer, bucket) trees exist and whether they clear the validator's
   * floor — the CLIENT's floor is the one that refuses */
  app.get("/zk/attest/buckets", (req, res) => {
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { epoch, trees } = currentTrees(db, mode);
    const floor = anonFloor();
    const buckets = [];
    for (const tree of Object.keys(trees)) {
      const at = parseAttestTree(tree);
      if (!at) continue;
      buckets.push({ issuer: at.issuer, bucket: at.bucket, tree, size: trees[tree].members.length, floor, clearsFloor: trees[tree].members.length >= floor });
    }
    res.json({ mode, epoch, floor, buckets });
  });

  /** the issuances on a commitment — GATED like eligibility (Gate 4, attack-att-1 #4: a public
   * per-leaf (activation, expiry) pair was a cell; the subject reads its own through its device) */
  app.get("/zk/attestations", (req, res) => {
    if (!gatedRead(req, res, "zk:eligibility")) return;
    const mode = String(req.query.mode || "fixture");
    const commitment = String(req.query.commitment || "");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!isField(commitment)) return res.status(400).json({ error: "commitment must be a decimal field element" });
    const { epoch } = epochInfo(db, mode);
    const rows = db
      .prepare("SELECT issuer, bucket, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch FROM zk_attestations WHERE mode = ? AND commitment = ? ORDER BY issuer, bucket")
      .all(mode, commitment);
    res.json({
      epoch,
      attestations: rows.map((r) => ({
        issuer: r.issuer,
        bucket: r.bucket,
        claimHash: r.claim_hash,
        issuedEpoch: r.issued_epoch,
        activeFromEpoch: r.active_from_epoch,
        expiresEpoch: r.expires_epoch,
        revokedFromEpoch: r.revoked_from_epoch,
        activeNow: r.active_from_epoch <= epoch && r.expires_epoch > epoch && (r.revoked_from_epoch === null || r.revoked_from_epoch === undefined || r.revoked_from_epoch > epoch),
      })),
    });
  });

  /** what a persona has PROVEN for an issuer (and optionally one bucket) this epoch (+ grace) — gated like eligibility */
  app.get("/zk/attested", (req, res) => {
    if (!gatedRead(req, res, "zk:eligibility")) return;
    const mode = String(req.query.mode || "fixture");
    const personaId = String(req.query.personaId || "");
    const issuer = String(req.query.issuer || "");
    const bucket = req.query.bucket === undefined ? null : String(req.query.bucket);
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId) || !validIssuer(issuer) || (bucket !== null && !validBucket(bucket))) return res.status(400).json({ error: "personaId/issuer/bucket malformed" });
    const { epoch } = epochInfo(db, mode);
    const rows =
      bucket === null
        ? db.prepare("SELECT bucket, epoch FROM zk_attestation_claims WHERE mode = ? AND persona_id = ? AND issuer = ? AND epoch IN (?, ?) ORDER BY epoch DESC").all(mode, personaId, issuer, epoch, epoch - 1)
        : db.prepare("SELECT bucket, epoch FROM zk_attestation_claims WHERE mode = ? AND persona_id = ? AND issuer = ? AND bucket = ? AND epoch IN (?, ?) ORDER BY epoch DESC").all(mode, personaId, issuer, bucket, epoch, epoch - 1);
    res.json({ attested: rows.length > 0, epoch: rows.length ? rows[0].epoch : null, buckets: [...new Set(rows.map((r) => r.bucket))] });
  });

  /** every persona's PROVEN (issuer/bucket) set this epoch (+ grace) — one gated read for a feed build */
  app.get("/zk/attested-map", (req, res) => {
    if (!gatedRead(req, res, "zk:eligibility")) return;
    const mode = String(req.query.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const { epoch } = epochInfo(db, mode);
    const rows = db.prepare("SELECT persona_id, issuer, bucket FROM zk_attestation_claims WHERE mode = ? AND epoch IN (?, ?)").all(mode, epoch, epoch - 1);
    const claims = {};
    for (const r of rows) {
      const k = r.issuer + "/" + r.bucket;
      if (!claims[r.persona_id]) claims[r.persona_id] = [];
      if (!claims[r.persona_id].includes(k)) claims[r.persona_id].push(k);
    }
    res.json({ epoch, claims });
  });

  // ---------- dev hooks (test-only; refused unless ZK_DEV_HOOKS=true) ----------
  // attack-3 F-10, stated: with the flag ON this validator is a TEST RIG —
  // the epoch clock and the cohort are the test's to shape, in either
  // universe. A production deployment never sets it; every hook is a 403.

  /** Pass 2 Gate 0 rig: fork the ANONYMOUS viewpoint's head for (mode, tree). */
  app.post("/zk/dev/split-view", (req, res) => {
    if (!devOnly(res)) return;
    const b = req.body || {};
    const mode = String(b.mode || "fixture");
    const tree = String(b.tree || "tier-2");
    if (!isMode(mode) || !isKnownTree(tree)) return res.status(400).json({ error: "mode/tree invalid" });
    if (b.on) splitView.set(mode + ":" + tree, true);
    else splitView.delete(mode + ":" + tree);
    res.json({ ok: true, mode, tree, on: !!b.on });
  });

  /** Pass 2 Gate 0 rig: zk GET counts per path since the last reset. */
  app.get("/zk/dev/request-count", (req, res) => {
    if (!devOnly(res)) return;
    const out = Object.fromEntries(requestCounts);
    if (req.query.reset === "1") requestCounts.clear();
    res.json({ counts: out });
  });

  /** Advance the epoch clock for a mode by N epochs (default 1). */
  app.post("/zk/dev/advance-epoch", (req, res) => {
    if (!devOnly(res)) return;
    const mode = String((req.body || {}).mode || "fixture");
    const n = Math.max(1, Math.min(1000, Number((req.body || {}).epochs || 1)));
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const cur = epochOffset(db, mode);
    db.prepare("INSERT INTO zk_epoch_offset (mode, offset_ms) VALUES (?, ?) ON CONFLICT(mode) DO UPDATE SET offset_ms = excluded.offset_ms").run(
      mode,
      cur + n * EPOCH_MS
    );
    res.json(epochInfo(db, mode));
  });

  /** TEST RIG: seed deterministic decoy roots + commitments so the
   * anonymity set can clear the floor and the linkage test has a crowd.
   * Decoy identities are public-by-construction test furniture
   * (Identity("layers-zk-decoy/<i>")); the suite derives the same ones.
   * Allowed in EITHER universe under the dev flag (the live-z2 run needs a
   * floor-clearing live cohort to prove into, because the client now
   * refuses to prove below the floor — attack-2 finding 8). A decoy
   * cohort is exactly the operator-fabricated cohort C1 admits; the
   * posture doc says so. BATCHED like every registration: active from the
   * NEXT epoch, so a frozen epoch's signed root can never move. */
  app.post("/zk/dev/seed-decoys", (req, res) => {
    if (!devOnly(res)) return;
    const body = req.body || {};
    const mode = String(body.mode || "fixture");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture|live" });
    const count = Math.max(0, Math.min(2000, Number(body.count || 0)));
    const { epoch } = epochInfo(db, mode);
    const now = Date.now();
    let inserted = 0;
    const insRoot = db.prepare("INSERT OR IGNORE INTO roots (id, fid, signer_uuid, created_at) VALUES (?, ?, ?, ?)");
    const insEvent = db.prepare("INSERT OR IGNORE INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)");
    const insReg = db.prepare(
      "INSERT OR IGNORE INTO zk_registrations (mode, commitment, root_id, registered_at, epoch_registered, active_from_epoch) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // A tier spread that survives POPULATION DRIFT (Gate 4 verify: the
    // fixture accumulates zero-score signer roots over a marathon, so a
    // fixed score table drifted every decoy into the top decile and the
    // "thin tier-10" premise of accept-z0 check 9 broke). Decoy i targets
    // tier 1 + (i % 10): its score sits just above the CURRENT population's
    // (tier-1)/10 quantile, so each decile holds ~count/10 decoys whatever
    // the fixture has grown into. Deterministic per id; re-seeding is a
    // no-op for an existing decoy (INSERT OR IGNORE + the rep dedupe).
    // quantiles over the accounts WITH rep (zero-rep accounts are tier 1 by definition — validator/rep.js)
    const others = db.prepare("SELECT id FROM roots WHERE id NOT LIKE 'root_zkdecoy_%'").all().map((r) => scoreForRoot(db, r.id)).filter((s) => s > 0).sort((x, y) => x - y);
    const quantile = (p) => (others.length ? others[Math.min(others.length - 1, Math.floor(p * others.length))] : 0);
    for (let i = 0; i < count; i++) {
      const rootId = "root_zkdecoy_" + i;
      // fid namespace far above the seed roots (their fids run into the 3,9xx,xxx range; 3000000 + i collided at i ≥ 80 and the decoy silently lost its root row, then its registration failed the FK)
      insRoot.run(rootId, 900000000 + i, "zk-decoy-" + i, now);
      // decoy 0 (the linkage tests' comparison decoy, "p_decoy_0_a") must sit in
      // EVERY tier tree: target tiers run 10, 9, …, 1 with i, so decoys 0, 10, 20 …
      // are tier 10 (still ~count/10 of them — thin) and decoy 0 is a peer of
      // ours in every gate tree and in the attest tree
      const target = 10 - (i % 10);
      const score = quantile((target - 1) / 10) + 1 + Math.floor(i / 10);
      insEvent.run(rootId, "follow_gained", Math.max(1, Math.ceil(score / 5)), "zk-decoy-seed:" + i, now);
      const commitment = new Identity("layers-zk-decoy/" + i).commitment.toString(10);
      const r = insReg.run(mode, commitment, rootId, now, epoch, epoch + 1);
      if (r.changes > 0) inserted++;
    }
    res.json({ ok: true, inserted, epoch, activeFromEpoch: epoch + 1 });
  });

  /** FIXTURE ONLY: wipe the fixture zk universe (never live). */
  app.post("/zk/dev/reset", (req, res) => {
    // MEGA PASS 2 /verify (sweep 1 finding): a fresh fixture universe has no accruals yet. This reset rewinds the
    // epoch clock, and a stewardship row left by an earlier run would dedupe the new one (one accrual per root per
    // epoch is the product rule; replayed epochs are the rig's). Dev hook only.
    db.prepare("DELETE FROM rep_events WHERE type = 'stewardship'").run();
    if (!devOnly(res)) return;
    const mode = String((req.body || {}).mode || "fixture");
    if (mode !== "fixture") return res.status(400).json({ error: "reset is fixture-only" });
    db.exec("BEGIN");
    try {
      for (const t of ["zk_registrations", "zk_root_history", "zk_placements", "zk_nullifiers", "zk_eligibility", "zk_epoch_offset", "zk_fork_claims", "zk_issuers", "zk_attestations", "zk_attestation_claims", "zk_anon_casts"]) {
        // (zk_eligibility / zk_nullifiers are WITHOUT ROWID since 005; DELETE by mode is unaffected)
        db.prepare(`DELETE FROM ${t} WHERE mode = ?`).run(mode);
      }
      db.prepare("DELETE FROM rep_events WHERE root_id LIKE 'root_zkdecoy_%'").run();
      db.prepare("DELETE FROM roots WHERE id LIKE 'root_zkdecoy_%'").run();
      // PERSONA LAUNCH P6: the registrar's fixture universe (queue, simulated chain, spend ledger, sim clock) is wiped
      // with the zk fixture universe, in the same transaction (a throw rolls both back). Absent while the launch track's
      // file is not on disk (the parallel build); once it is, its reset is part of this one.
      const reg = registrarIfPresent();
      if (reg) reg.resetFixture(db, mode);
      // PERSONA LAUNCH P8: the X outbox's fixture universe (rows, decisions, dev moderators, fixture posts) goes with it
      const xo = xoutboxIfPresent();
      if (xo) xo.resetFixture(db, mode);
      // PUBLIC GO-LIVE: the fixture universe's reports, takedown decisions, filter log and rig moderators go with it
      require("./anonpublic").resetFixture(db, mode);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: e.message });
    }
    for (const k of [...treeCache.keys()]) if (k.startsWith(mode + ":")) treeCache.delete(k);
    res.json({ ok: true });
  });
}

module.exports = {
  mountZk,
  anonHead,
  // exported for validator unit tests + Gate 2 (fixture verification)
  registerCanonical,
  placementCanonical,
  historyEntryHash,
  fixtureTag,
  canonicalPublicInputs,
  expectedPublicValues,
  fieldOf,
  scopeString,
  semaphoreHash,
  loadPinnedVkey,
  epochInfo,
  buildTrees,
  validatorKey,
  verifyAndRecord,
  eligibilityFor,
  vkeyPinned,
  TREES,
  EPOCH_MS,
  anonFloor,
  // Gate 3
  revokeCanonical,
  revoke,
  isKnownTree,
  treesFor,
  // Attestation pass Gate 1
  attestCanonical,
  issuerCanonical,
  attestRevokeCanonical,
  attestSubmitCanonical,
  ISSUE_WINDOW,
  validIssuer,
  validBucket,
  attestTreeName,
  parseAttestTree,
  // PERSONA LAUNCH P3 — for validator/test/anonslots.test.js and scripts/unit-anon-slots.mjs
  anonPostSlots,
  anonSlotQualifier,
  anonDayEpochRange,
  anonDailyCap,
  anonLiveCap,
  anonRelayIntervalMs,
  anonRelaySpreadMs,
  envInt,
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the validator's plain anon tree — scripts/unit-prover.mjs V3 pins this
  // DELIBERATE DUPLICATE to lib/zk/config.ts ZK_ANON_POST_TREE and lib/zk/anon/availability.ts plainAnonTreeName under
  // every environment (the public preview runs ZK_ANON_POST_TREE=valid on both services)
  anonPostTree,
  // PERSONA LAUNCH P4/P5/P6 — for validator/test/reach.test.js, validator/test/zk.test.js and scripts/unit-reach.mjs
  anonReachIssuers,
  // PUBLIC GO-LIVE (ASM-1) — for validator/test/anonpublic.test.js and scripts/unit-anon-relay.mjs
  anonReachIssuersFor,
  gatedLiveTreeRefused,
  anonTreeAllowed,
  isReachTree,
  reachFloor,
  reachBandRefusal,
  anonPostWindowOf,
  NOTE_RE,
  LAUNCH_REQUEST_MAX_BYTES,
  REACH_BUCKETS,
  // PERSONA LAUNCH P7 (the prover track's seam, landed by xout): accept-anon-prod verifies the browser's Groth16 proof
  // with the validator's own pinned-vkey verifier
  verifyLiveProof,
  // PERSONA LAUNCH P8 — for validator/xoutbox.js (its public config), validator/test/xoutbox.test.js and scripts/unit-x-outbox.mjs
  xAnonPostSlots,
  xSlotQualifier,
  xAnonHash,
  CLAIM_KINDS,
};
