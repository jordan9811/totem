// ZK PASS 1 — BUILD-PINNED artifact and verification-key hashes (F4/F5).
//
// The values here were produced by the Gate 0 ceremony-verification pass
// and are recorded, with sources, in research/zk-ceremony-verification.json.
// They are pinned into the client build on purpose: the prover refuses any
// artifact whose hash differs, and the verifier refuses to load if the
// bundled verification key differs from the pin — a vkey or zkey swapped
// on the artifact host (which publishes no checksums of its own) is caught
// here, never trusted.
//
// THE CHAIN THESE PINS REST ON (each step verified in this pass):
//   ceremony "Semaphore Binary Merkle Root Fix" (finalized 2025-07-23)
//     └─ its published final zkey  ≡ (byte-identical)  the CDN zkey pinned below
//         └─ embedded transcript: 386 contributions, coordinator beacon,
//            an independently published contributor hash present verbatim
//     └─ its circuit commit 3521c96b… ≡ (byte-identical) the installed source
//     └─ its ptau ≡ the public PPOT ppot_0080_13
//   zkey-derived vkey ≡ the vkey bundled in @semaphore-protocol/proof (pinned below)
// What is NOT closed (ASSUMPTION A-ZKEY-VERIFY in the posture doc): a
// completed `snarkjs zkey verify` — the ceremony's r1cs is not public.
import { createHash } from "@/lib/platform/crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MERKLE_TREE_DEPTH } from "./config";

// PERSONA LAUNCH P7: the pins themselves live in ./ceremonyPins.ts (plain data, no imports) so the browser's Web Worker
// prover checks the same numbers; re-exported here unchanged for every existing importer.
export { SEMAPHORE_ARTIFACT_VERSION, SEMAPHORE_ARTIFACT_BASE, ARTIFACT_PINS, VKEY_PIN, CEREMONY, type ArtifactPin } from "./ceremonyPins";
import { ARTIFACT_PINS, VKEY_PIN } from "./ceremonyPins";

export function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function blake2b512Hex(bytes: Uint8Array | Buffer): string {
  return createHash("blake2b512").update(bytes).digest("hex");
}

/** Where the bundled vkey file lives on disk (server-side process). */
export function bundledVkeyPath(): string {
  return path.join(process.cwd(), "node_modules", "@semaphore-protocol", "proof", "src", "verification-keys.json");
}

export interface VkeyPinCheck {
  ok: boolean;
  sha256: string;
  bytes: number;
  expectedSha256: string;
  reason?: string;
}

/**
 * Assert the verification key the verifier will use is the pinned one.
 * Called at live-verifier load and by the Gate 0 suite every iteration.
 * A mismatch is a REFUSAL to verify anything (F5: never verify against a
 * key you did not pin), never a warning.
 */
export function checkVkeyPin(): VkeyPinCheck {
  let buf: Buffer;
  try {
    buf = readFileSync(bundledVkeyPath());
  } catch (e) {
    return { ok: false, sha256: "", bytes: 0, expectedSha256: VKEY_PIN.sha256, reason: `vkey file unreadable: ${(e as Error).message}` };
  }
  const sha = sha256Hex(buf);
  const ok = sha === VKEY_PIN.sha256 && buf.length === VKEY_PIN.bytes;
  return { ok, sha256: sha, bytes: buf.length, expectedSha256: VKEY_PIN.sha256, reason: ok ? undefined : "bundled vkey differs from the build pin" };
}

/** A Groth16 verification key as snarkjs consumes it (one depth). */
export interface Groth16Vkey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: unknown;
  vk_beta_2: unknown;
  vk_gamma_2: unknown;
  vk_delta_2: unknown;
  vk_alphabeta_12: unknown;
  IC: unknown;
}

export interface PinnedVkey {
  vk: Groth16Vkey;
  depth: number;
  sha256: string;
  bytes: number;
  path: string;
}

/**
 * Read the pinned vkey file ONCE, hash exactly those bytes against the pin,
 * and slice the per-depth key out of the same bytes (no second read, so
 * the bytes hashed are the bytes used). Throws on any mismatch or on an
 * unexpected shape — a throw is a refusal to verify anything.
 */
export function loadPinnedVkey(depth: number = MERKLE_TREE_DEPTH): PinnedVkey {
  const file = bundledVkeyPath();
  const buf = readFileSync(file);
  const sha = sha256Hex(buf);
  if (sha !== VKEY_PIN.sha256 || buf.length !== VKEY_PIN.bytes) {
    throw new Error(`zk ceremony: verification key file is NOT the build pin (sha256 ${sha}, ${buf.length} B) — refusing to verify`);
  }
  const bundle = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  const delta = bundle.vk_delta_2 as unknown[];
  const ic = bundle.IC as unknown[];
  if (bundle.protocol !== "groth16" || bundle.curve !== "bn128" || bundle.nPublic !== 4 || !Array.isArray(delta) || !Array.isArray(ic) || delta.length < depth || ic.length < depth) {
    throw new Error("zk ceremony: pinned verification key bundle has an unexpected shape — refusing to verify");
  }
  return {
    vk: {
      protocol: "groth16",
      curve: "bn128",
      nPublic: 4,
      vk_alpha_1: bundle.vk_alpha_1,
      vk_beta_2: bundle.vk_beta_2,
      vk_gamma_2: bundle.vk_gamma_2,
      vk_delta_2: delta[depth - 1],
      vk_alphabeta_12: bundle.vk_alphabeta_12,
      IC: ic[depth - 1],
    },
    depth,
    sha256: sha,
    bytes: buf.length,
    path: file,
  };
}

export function pinsForDepth(depth: number = MERKLE_TREE_DEPTH) {
  const p = ARTIFACT_PINS[depth];
  if (!p) throw new Error(`zk ceremony: no pinned artifacts for depth ${depth} — a new depth needs its own verified pins`);
  return p;
}
