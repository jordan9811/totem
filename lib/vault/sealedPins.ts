import "server-only";
// GATE 5 (attack-post-3 F-1) — WHICH SEALED NAMESPACES THIS DEVICE HAS WRITTEN.
//
// THE HOLE THIS FILLS. A sealed namespace that comes back EMPTY is benign only
// if it was never written. The validator answers a missing namespace with
// `200 {entries:{}}` rather than 404, so "this device has never sealed this"
// and "the operator deleted these rows" are the SAME response — and reading the
// second as the first turns compartment mode off silently, un-quiets every
// account the owner turned down, empties the recycle bin, and then seals that
// emptiness over the real record on the next write. Permanently.
//
// The remedy is the one this project already used for the ZK anchors when the
// identical finding was raised against them (posture §3, attack-3 F-3): the
// device keeps its OWN note, outside the operator's reach, of what it has
// written. An empty read for a namespace on that list is a refusal.
//
// WHAT THIS IS NOT. It is not integrity: an operator who deletes a namespace
// still deletes it, and this cannot bring the bytes back. It converts a SILENT
// wrong answer into a LOUD refusal, which is the whole of the claim.
//
// It lives beside the keystore because it is device state, not vault content —
// there is nothing secret in the list of namespace NAMES this device uses, and
// putting it in the vault would need the vault to read it.
import { storage } from "@/lib/platform/storage";
import path from "node:path";

const FILE = "vault-sealed.json";

interface Pins {
  /** namespace → the first time this device sealed it (epoch ms, for a human reading the file) */
  sealed: Record<string, number>;
}

const g = globalThis as unknown as { __layersSealedPins?: Pins };

function dir(): string {
  return process.env.KEYSTORE_DIR || ".keystore";
}

function load(): Pins {
  if (g.__layersSealedPins) return g.__layersSealedPins;
  let pins: Pins = { sealed: {} };
  try {
    const file = path.join(dir(), FILE);
    if (storage.exists(file)) {
      const parsed = JSON.parse(storage.readText(file)) as Partial<Pins>;
      if (parsed && typeof parsed.sealed === "object" && parsed.sealed) pins = { sealed: parsed.sealed as Record<string, number> };
    }
  } catch {
    // No pin file is the honest first-run state: nothing has been sealed, so
    // every namespace reads as never-written and an empty read stays benign.
    pins = { sealed: {} };
  }
  g.__layersSealedPins = pins;
  return pins;
}

/** Has this device ever successfully sealed this namespace? */
export function wasEverSealed(ns: string): boolean {
  return !!load().sealed[ns];
}

/**
 * Record a successful seal. Called from each sealed module AFTER its flush
 * resolves, never before — a namespace pinned on an attempted write would make
 * a failed first write brick the namespace for that device.
 */
export function markEverSealed(ns: string, at = 0): void {
  const pins = load();
  if (pins.sealed[ns]) return;
  pins.sealed[ns] = at || 1;
  try {
    storage.writeText(path.join(dir(), FILE), JSON.stringify(pins, null, 2));
  } catch {
    // A device that cannot persist the pin degrades to the old behaviour for
    // that namespace — an empty read reads as never-written. That is a weaker
    // guarantee, not a wrong one, and it is what an ephemeral in-tab device
    // gets by construction.
  }
}

/** Reset for the rig: a seed reset wipes the validator's rows, so the pins go with them. */
export function resetSealedPins(): void {
  g.__layersSealedPins = undefined;
  try {
    storage.remove(path.join(dir(), FILE));
  } catch {
    /* nothing to remove */
  }
}

/** Identity reload: a different root has its own pins. */
export function forgetSealedPins(): void {
  g.__layersSealedPins = undefined;
}
