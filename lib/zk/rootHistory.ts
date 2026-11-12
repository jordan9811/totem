import "server-only";
// ZK PASS 1 — the SPLIT-VIEW DEFENSE (F8): signed, append-only root
// history, cross-checked by the client before it ever proves.
//
// The attack: a malicious validator serves each client a slightly
// different tree root; every proof then reveals which root it was built
// against, tagging the prover without breaking any crypto. The defense:
// the validator publishes ONE signed, hash-chained history of roots per
// (mode, tree); the client (1) pins the validator's signing key on first
// sight (TOFU — stated, like the device anchor), (2) verifies every entry's
// hash and signature and the chain links, (3) refuses to prove against any
// root that is not in that verified history, and (4) ANCHORS the newest
// chain hash in its vault so a later, forked history — one that omits or
// rewrites what this client already saw — is detected as a fork, not
// accepted as fresh.
//
// What this does NOT do: prove the validator serves everyone the SAME
// history (that needs cross-device or external anchoring — a stated
// assumption). It does make per-client re-tagging detectable by the
// client that keeps its anchor.
//
// WHERE THE ANCHOR LIVES (attack-3 F-3): on the device, in
// lib/zk/localPins.ts — never in a vault namespace on the validator, whose
// operator could delete it and make every client a first-run client. And
// the validator key is pinned ONCE, globally (attack-3 F-7), not once per
// tree: the first tree the client ever verifies pins the key for all.
//
// Canonical forms are DELIBERATE DUPLICATES of validator/zk.js; the Gate 0
// suite signs on one side and verifies on the other to pin them together.
import { createHash } from "@/lib/platform/crypto";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import type { ZkMode } from "./config";
import { anchorFor, pinValidatorKey, pinnedValidatorKey, setAnchor, type RootAnchor } from "./localPins";
import { anonymousHead } from "./anon/relay";
import { fetchHistory, fetchValidatorKey, type ZkHistoryEntry, type ZkPlacement } from "./validatorClient";

export type { RootAnchor } from "./localPins";

export const ZERO_HASH = "0".repeat(64);

export function historyEntryHash(e: Omit<ZkHistoryEntry, "hash" | "sig">): string {
  return createHash("sha256")
    .update(["layers-zk-root-history/1", e.mode, e.tree, String(e.epoch), e.root, e.prevHash].join("|"))
    .digest("hex");
}

export function placementCanonical(p: Omit<ZkPlacement, "sig">): string {
  return ["layers-zk-placement/1", p.mode, p.tree, String(p.epoch), p.commitment, String(p.leafIndex), p.root].join("|");
}

export function verifyPlacement(p: ZkPlacement, validatorPubKey: string): boolean {
  return verifyCanonical(p.sig, placementCanonical(p), validatorPubKey);
}

export interface ChainVerdict {
  ok: boolean;
  reason?: string;
  newest: ZkHistoryEntry | null;
}

/**
 * Verify a history window. Fail-closed on every defect: a bad hash, a bad
 * signature, a broken link, a non-increasing epoch, a mismatched mode/tree,
 * or — with an anchor — a chain that does not contain the anchored hash
 * (a fork: the server is telling this client a different story than the
 * one it already anchored).
 */
export function verifyHistoryChain(
  entries: ZkHistoryEntry[],
  validatorPubKey: string,
  expect: { mode: ZkMode; tree: string },
  anchor: RootAnchor | null
): ChainVerdict {
  if (anchor && anchor.validatorPubKey !== validatorPubKey) {
    return { ok: false, reason: "validator signing key differs from the anchored key (TOFU pin violated)", newest: null };
  }
  if (entries.length === 0) return { ok: false, reason: "empty history", newest: null };
  let prev: ZkHistoryEntry | null = null;
  let anchorSeen = anchor === null;
  for (const e of entries) {
    if (e.mode !== expect.mode || e.tree !== expect.tree) return { ok: false, reason: "entry for a different mode/tree", newest: null };
    if (historyEntryHash(e) !== e.hash) return { ok: false, reason: `entry hash mismatch at epoch ${e.epoch}`, newest: null };
    if (!verifyCanonical(e.sig, e.hash, validatorPubKey)) return { ok: false, reason: `entry signature invalid at epoch ${e.epoch}`, newest: null };
    if (prev) {
      if (e.prevHash !== prev.hash) return { ok: false, reason: `chain link broken at epoch ${e.epoch}`, newest: null };
      if (!(e.epoch > prev.epoch)) return { ok: false, reason: `epochs not strictly increasing at ${e.epoch}`, newest: null };
    }
    if (anchor && e.hash === anchor.lastHash) anchorSeen = true;
    prev = e;
  }
  if (!anchorSeen) {
    // The window may legitimately have scrolled past the anchor if the
    // client was away for longer than the window; that is ALSO a refusal —
    // the conservative side. (The posture doc names this as a liveness
    // cost, not a hole.)
    return { ok: false, reason: "anchored history hash not present in the served window (fork or stale anchor)", newest: null };
  }
  return { ok: true, newest: prev };
}

export function readAnchor(mode: ZkMode, tree: string): RootAnchor | null {
  return anchorFor(mode, tree);
}

export interface RootCheck {
  ok: boolean;
  reason?: string;
  /** epochs the root was found at (current or the one-epoch grace) */
  epoch?: number;
  newestEpoch?: number;
}

/** What the history check needs, however it was obtained (a prefetch
 * snapshot, or a direct fetch by the dev/suite path). */
export interface HistorySupplied {
  pubkey: string;
  entries: ZkHistoryEntry[];
  /** THE SECOND VIEWPOINT: the newest head as served over the anonymous path */
  anonHead: { epoch: number; hash: string } | null;
  anonHeadError?: string | null;
}

/**
 * THE GATE before proving (fetching variant — dev/suite paths and trees
 * outside the prefetch). The product path proves from the prefetch
 * snapshot via verifyRootAgainstHistoryWith and never fetches here.
 */
export async function verifyRootAgainstHistory(mode: ZkMode, tree: string, root: string): Promise<RootCheck> {
  const pubkey = await fetchValidatorKey();
  const { pubkey: servedKey, entries } = await fetchHistory(mode, tree);
  if (servedKey !== pubkey) return { ok: false, reason: "history endpoint reports a different key than the key endpoint" };
  let anonHead: HistorySupplied["anonHead"] = null;
  let anonHeadError: string | null = null;
  try {
    const h = await anonymousHead(mode, tree);
    anonHead = { epoch: h.epoch, hash: h.hash };
  } catch (e) {
    anonHeadError = (e as Error).message;
  }
  return verifyRootAgainstHistoryWith(mode, tree, root, { pubkey, entries, anonHead, anonHeadError });
}

/**
 * The check itself, on supplied material: the key against the device's
 * ONE pinned validator key; the chain against the device's anchor for
 * this tree; THE SECOND VIEWPOINT — the head the anonymous path served
 * must equal the head the identified path served (a validator forking the
 * history per identity is caught here; a missing second viewpoint is a
 * refusal, never a pass); `root` at the newest epoch or the one before
 * (the bounded stale-root grace); then advance the anchor (and pin the
 * key on true first sight). Refusal = no proof is generated.
 */
export function verifyRootAgainstHistoryWith(mode: ZkMode, tree: string, root: string, s: HistorySupplied): RootCheck {
  const pinned = pinnedValidatorKey();
  if (pinned !== null && pinned !== s.pubkey) {
    return { ok: false, reason: "validator signing key differs from the key pinned on this device (TOFU pin violated — a key rotation is never accepted implicitly)" };
  }
  const anchor = readAnchor(mode, tree);
  const verdict = verifyHistoryChain(s.entries, s.pubkey, { mode, tree }, anchor);
  if (!verdict.ok || !verdict.newest) return { ok: false, reason: verdict.reason };
  if (!s.anonHead) {
    return { ok: false, reason: `second viewpoint unavailable (${s.anonHeadError ?? "no anonymous head"}) — refusing to prove against a history seen from one identity only` };
  }
  if (s.anonHead.hash !== verdict.newest.hash || s.anonHead.epoch !== verdict.newest.epoch) {
    return { ok: false, reason: "SPLIT VIEW BY IDENTITY: the anonymous viewpoint reports a different history head than the identified one — refusing to prove" };
  }
  const newest = verdict.newest.epoch;
  const hit = s.entries.find((e) => e.root === root && (e.epoch === newest || e.epoch === newest - 1));
  if (!hit) return { ok: false, reason: "root is not in the signed history at the current epoch or its one-epoch grace", newestEpoch: newest };
  if (pinned === null) pinValidatorKey(s.pubkey); // true first sight: TOFU, stated
  setAnchor(mode, tree, {
    validatorPubKey: s.pubkey,
    lastHash: verdict.newest.hash,
    lastEpoch: newest,
    lastRoot: verdict.newest.root,
    anchoredAt: Date.now(),
  });
  return { ok: true, epoch: hit.epoch, newestEpoch: newest };
}
