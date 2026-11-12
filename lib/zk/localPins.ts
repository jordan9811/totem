import "server-only";
// ZK PASS 1 — DEVICE-LOCAL PINS. The client's defences against the
// validator (the split-view anchor, the TOFU-pinned validator key, the
// cohort-continuity record, the proof-history budget) used to live in
// vault namespaces flushed to the validator's own store. attack-3 F-3:
// encryption kept the operator from READING them, nothing kept it from
// DELETING them — and "absent" was the benign first-run state, so the
// operator could re-TOFU any client onto any key and any history at will.
// attack-1 finding 1: the vault sealed record VALUES, not record
// ADDRESSES, and the budget's address was `personaId:epoch` — sibling
// personas side by side in plaintext, in one device-signed write.
//
// So none of it goes to the validator any more. It lives HERE, next to
// the seed (the same device-local directory, the same trust: whoever
// holds this directory holds the root — SECURITY-POSTURE.md §8). A
// missing file is a genuine first sight (a fresh device). A corrupt file
// is a LOUD refusal, never a silent re-TOFU.
//
// Residual, stated: a fresh device after total loss re-TOFUs the
// validator key and the history (A-SPLIT-VIEW). The explicit re-anchor
// ritual (settings → "re-anchor", POST /api/zk {action:"reanchor"}) is the
// only other way an anchor is dropped, and it is the user's act.
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import { keystoreDir } from "@/lib/identity/keystore";
import type { ZkMode } from "./config";

export interface RootAnchor {
  validatorPubKey: string;
  lastHash: string;
  lastEpoch: number;
  lastRoot: string;
  anchoredAt: number;
}

export interface CohortRecord {
  epoch: number;
  size: number;
  /** sha256 over the sorted member list */
  digest: string;
  /** the members themselves (public commitments) — needed for the
   * intersection with the next epoch's cohort */
  members: string[];
  recordedAt: number;
}

interface PinsFile {
  v: 1;
  validatorKey: { pubkey: string; pinnedAt: number } | null;
  anchors: Record<string, RootAnchor>;
  cohorts: Record<string, CohortRecord>;
  budget: Record<string, string[]>;
  /** Gate 4: per (mode:persona) the running intersection of every attestation tree proven into */
  intersections?: Record<string, string[]>;
}

const g = globalThis as unknown as { __layersZkPins?: PinsFile };

function pinsPath(): string {
  return path.join(keystoreDir(), "zk-pins.json");
}

function blank(): PinsFile {
  return { v: 1, validatorKey: null, anchors: {}, cohorts: {}, budget: {}, intersections: {} };
}

function load(): PinsFile {
  if (g.__layersZkPins) return g.__layersZkPins;
  const file = pinsPath();
  if (!storage.exists(file)) {
    g.__layersZkPins = blank();
    return g.__layersZkPins;
  }
  let parsed: PinsFile;
  try {
    parsed = JSON.parse(storage.readText(file)) as PinsFile;
  } catch (e) {
    throw new Error(`zk pins: ${file} is unreadable or corrupt — refusing to treat this as a first sight (${(e as Error).message})`);
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.anchors !== "object" || typeof parsed.cohorts !== "object" || typeof parsed.budget !== "object") {
    throw new Error(`zk pins: ${file} failed validation — refusing to treat this as a first sight`);
  }
  g.__layersZkPins = parsed;
  return parsed;
}

/**
 * Atomic write (tmp + rename). On Windows a rename over a file another
 * process holds open — a sync client, a scanner — fails with EPERM for a
 * moment; found by Pass 2 Gate 0 with the keystore inside a OneDrive
 * folder. The rename is retried with a short backoff; if it still fails
 * the content is written in place (a crash mid-write leaves a torn file,
 * which the loader refuses LOUDLY — the conservative outcome, never a
 * silent first sight).
 */
function save(p: PinsFile): void {
  const file = pinsPath();
  // the rename retry + in-place fallback described above now lives in lib/platform/storage.ts (Node backend)
  storage.writeText(file, JSON.stringify(p, null, 2));
  g.__layersZkPins = p;
}

const key = (mode: ZkMode, tree: string) => `${mode}:${tree}`;

// ---------- validator key (ONE global pin, not one per tree — attack-3 F-7) ----------
export function pinnedValidatorKey(): string | null {
  return load().validatorKey?.pubkey ?? null;
}
export function pinValidatorKey(pubkey: string): void {
  const p = load();
  if (p.validatorKey && p.validatorKey.pubkey !== pubkey) {
    throw new Error("zk pins: refusing to overwrite the pinned validator key (a rotation needs an explicit re-anchor)");
  }
  if (!p.validatorKey) {
    p.validatorKey = { pubkey, pinnedAt: Date.now() };
    save(p);
  }
}

// ---------- split-view anchors ----------
export function anchorFor(mode: ZkMode, tree: string): RootAnchor | null {
  return load().anchors[key(mode, tree)] ?? null;
}
export function setAnchor(mode: ZkMode, tree: string, anchor: RootAnchor): void {
  const p = load();
  const cur = p.anchors[key(mode, tree)];
  // no-op writes are skipped: the file is touched only when the anchor
  // actually advances (every tick and every label read verify the chain)
  if (cur && cur.lastHash === anchor.lastHash && cur.lastEpoch === anchor.lastEpoch && cur.lastRoot === anchor.lastRoot && cur.validatorPubKey === anchor.validatorPubKey) return;
  p.anchors[key(mode, tree)] = anchor;
  save(p);
}

// ---------- cohort continuity ----------
export function cohortFor(mode: ZkMode, tree: string): CohortRecord | null {
  return load().cohorts[key(mode, tree)] ?? null;
}
export function setCohort(mode: ZkMode, tree: string, rec: CohortRecord): void {
  const p = load();
  p.cohorts[key(mode, tree)] = rec;
  save(p);
}

// ---------- proof-history budget ----------
export function budgetFor(k: string): string[] {
  return [...(load().budget[k] ?? [])];
}
export function setBudget(k: string, used: string[]): void {
  const p = load();
  p.budget[k] = [...used];
  save(p);
}

// ---------- resets ----------
/** The user's explicit RE-ANCHOR ritual for one universe: drop that
 * universe's anchors and cohort records (the next verification is a first
 * sight again). The validator key pin is NOT touched — a key change is
 * never accepted implicitly. */
export function clearAnchorsForMode(mode: ZkMode): { anchors: number; cohorts: number } {
  const p = load();
  let anchors = 0;
  let cohorts = 0;
  for (const k of Object.keys(p.anchors)) if (k.startsWith(mode + ":")) { delete p.anchors[k]; anchors++; }
  for (const k of Object.keys(p.cohorts)) if (k.startsWith(mode + ":")) { delete p.cohorts[k]; cohorts++; }
  save(p);
  return { anchors, cohorts };
}
/** Test-rig reset (dev hooks): everything for one universe, key pin
 * included when `includeKey`. */
export function clearPinsForMode(mode: ZkMode, includeKey: boolean): void {
  const p = load();
  for (const k of Object.keys(p.anchors)) if (k.startsWith(mode + ":")) delete p.anchors[k];
  for (const k of Object.keys(p.cohorts)) if (k.startsWith(mode + ":")) delete p.cohorts[k];
  for (const k of Object.keys(p.budget)) if (k.startsWith(mode + ":")) delete p.budget[k];
  for (const k of Object.keys(p.intersections ?? {})) if (k.startsWith(mode + ":")) delete p.intersections![k];
  if (includeKey) p.validatorKey = null;
  save(p);
}

/** PUBLIC material only, for the status surface: no members, no budget
 * addresses (persona ids) — hashes, epochs, sizes. */
export function pinsSummary(): {
  file: string;
  validatorKeyPinned: boolean;
  anchors: Record<string, { lastEpoch: number; lastHash: string; anchoredAt: number }>;
  cohorts: Record<string, { epoch: number; size: number; digest: string }>;
  budgetEntries: number;
} {
  const p = load();
  const anchors: Record<string, { lastEpoch: number; lastHash: string; anchoredAt: number }> = {};
  for (const [k, a] of Object.entries(p.anchors)) anchors[k] = { lastEpoch: a.lastEpoch, lastHash: a.lastHash, anchoredAt: a.anchoredAt };
  const cohorts: Record<string, { epoch: number; size: number; digest: string }> = {};
  for (const [k, c] of Object.entries(p.cohorts)) cohorts[k] = { epoch: c.epoch, size: c.size, digest: c.digest };
  return { file: pinsPath(), validatorKeyPinned: p.validatorKey !== null, anchors, cohorts, budgetEntries: Object.keys(p.budget).length };
}

// ---------- Gate 4 (attack-att-1 #2, attack-att-3 #3): the RUNNING INTERSECTION ----------
// The floor is per tree and the budget is per epoch; neither bounds what an operator
// learns by intersecting, across buckets AND epochs, every tree a persona has proven
// into. The client keeps, per (mode, persona), the intersection of every attestation
// tree it has proven — on the device, like the budget — and REFUSES an attestation proof
// that would shrink it below the anonymity floor. Fail closed: a persona whose proven
// buckets would single out its root stops proving buckets.
export function intersectionFor(mode: ZkMode, personaId: string): string[] | null {
  const v = load().intersections?.[`${mode}:${personaId}`];
  return Array.isArray(v) ? v : null;
}
export function setIntersection(mode: ZkMode, personaId: string, members: string[]): void {
  const p = load();
  p.intersections ??= {};
  p.intersections[`${mode}:${personaId}`] = members;
  save(p);
}
