import "server-only";
// ZK PASS 1 — the LIVE transport: stock Semaphore v4 (Groth16 / snarkjs),
// run in a CHILD PROCESS forked from a SEPARATE, unbundled file
// (lib/zk/prover/semaphore-worker.mjs) — one job over IPC, killed when it
// reports. Two reasons for the separate process:
//   1. license scope is explicit — snarkjs (GPL-3) lives in its own file,
//      never in the Next server bundle (verification runs there too);
//   2. proving is CPU-heavy; it never blocks the request thread. (A
//      worker_threads worker was the first design; snarkjs's pool cannot
//      start inside one — see the prover file's header.)
//
// TOPOLOGY NOTE (the conservative call, stated in SECURITY-POSTURE.md §8):
// in this codebase the "device" that holds the seed is the user-side Next
// process, so the prover is a child of that process on the same host and
// the zk secret crosses an OS pipe, never a network boundary. A browser
// Web Worker prover is the same snarkjs code path; its timings are the
// research PoC's, marked UNMEASURED-EXTRAPOLATED for mid-range mobile. If
// the operator ran this process, nothing here would be private — that is
// the posture doc's A-TOPOLOGY line, not a property this file can enforce.
//
// F5, enforced: the verification key is the BUILD-PINNED FILE — read,
// hashed and USED by the worker itself (never the library's inlined copy;
// attack-2 finding 2); a mismatch refuses before prove AND before verify.
// The client verifies its own proof before it is ever submitted; the
// validator's "valid" is never trusted. (A-VERIFIER-MONOCULTURE: both
// sides still run the same snarkjs; that is stated, not fixed.)
//
// Used ONLY by live-z* scripts and the bench harness. Never in sweeps.
import { fork } from "node:child_process";
import path from "node:path";
import { ensureArtifacts } from "../artifacts";
import { loadPinnedVkey } from "../ceremony";
import { MERKLE_TREE_DEPTH } from "../config";
import { zkMasterHexForProver, zkSecretScalarForProver } from "../identity";
import { anonFidTreeMasterHexForProver, anonFidTreeSecretScalarForProver } from "../anon/fcJoin";
import { nullifierFor } from "../nullifier";
import { parseField } from "../hash";
import {
  isClaimKind,
  type ClaimKind,
  type LiveProofBody,
  type ProofEnvelope,
  type PublicInputs,
  type VerifyResult,
  type WitnessRef,
  type ZkTransport,
} from "./types";

const WORKER = path.join(process.cwd(), "lib", "zk", "prover", "semaphore-worker.mjs");
const TIMEOUT_MS = 180_000;

interface SemaphoreProofWire {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: string[];
}

function runWorker<T>(job: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [], { serialization: "json", stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString("utf8");
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      settle(() => reject(new Error("zk live prover timed out")));
    }, TIMEOUT_MS);
    child.once("message", (m: { ok: boolean; error?: string; result?: T }) => {
      // snarkjs's thread pool would keep the child alive after it has
      // reported; the result is in hand, so the child is killed here.
      child.kill();
      settle(() => (m.ok ? resolve(m.result as T) : reject(new Error("zk live prover: " + (m.error ?? "unknown error")))));
    });
    child.once("error", (e) => settle(() => reject(e)));
    child.once("exit", (code) => settle(() => reject(new Error(`zk live prover exited with code ${code} before reporting${stderr ? ": " + stderr.trim().slice(0, 400) : ""}`))));
    child.send(job);
  });
}

/** PERSONA LAUNCH P7 (L2): the last live proof's prover time, in this process only (never on an envelope) */
let lastLive: { at: number; ms: number } | null = null;
export function lastLiveProve(): { at: number; ms: number } | null {
  return lastLive ? { ...lastLive } : null;
}

/** The pinned vkey, loaded and hash-checked NOW (a throw is a refusal). */
function requirePin() {
  return loadPinnedVkey(MERKLE_TREE_DEPTH);
}

export const liveTransport: ZkTransport = {
  mode: "live",

  async prove(claimKind: ClaimKind, publicInputs: PublicInputs, witness: WitnessRef): Promise<ProofEnvelope> {
    if (publicInputs.mode !== "live") throw new Error("live transport: refusing to prove a non-live envelope");
    if (!isClaimKind(claimKind) || publicInputs.claimKind !== claimKind) throw new Error("live transport: unknown claim kind");
    const scope = parseField(publicInputs.scope);
    const message = parseField(publicInputs.message);
    if (scope === null || message === null) throw new Error("live transport: scope/message are not field elements");
    requirePin();
    const artifacts = await ensureArtifacts(MERKLE_TREE_DEPTH);
    // PUBLIC GO-LIVE (PRIV-LIVE-1): the fid-gated live crowd is proved with the device's CROWD identity
    // (lib/zk/anon/fcJoin.ts — joined with Farcaster, never registered under a root); lib/zk/prove.ts declares which
    // (witness.identity). Every other tree, and a witness that declares nothing, is the root's, as before.
    const crowd = (witness as WitnessRef & { identity?: "root" | "anon-fid-tree" }).identity === "anon-fid-tree";
    const { proof, ms } = await runWorker<{ proof: SemaphoreProofWire; ms: number }>({
      op: "prove",
      privateKeyHex: crowd ? anonFidTreeMasterHexForProver() : zkMasterHexForProver(),
      members: witness.members,
      message: publicInputs.message,
      scope: publicInputs.scope,
      depth: MERKLE_TREE_DEPTH,
      wasm: artifacts.wasm,
      zkey: artifacts.zkey,
    });
    // The proof must be about EXACTLY the public inputs we intended.
    if (proof.merkleTreeRoot !== publicInputs.merkleTreeRoot) throw new Error("live transport: proof root differs from the intended root");
    if (proof.message !== publicInputs.message || proof.scope !== publicInputs.scope) throw new Error("live transport: proof message/scope differ from the intended inputs");
    // F10 cross-check: the circuit's nullifier equals our duplicate formula.
    const expected = nullifierFor(scope, crowd ? anonFidTreeSecretScalarForProver() : zkSecretScalarForProver()).toString(10);
    if (proof.nullifier !== expected) throw new Error("live transport: circuit nullifier != Poseidon(hash(scope), secret) — formula drift, refusing");
    const body: LiveProofBody = { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points };
    const envelope: ProofEnvelope = { v: 1, mode: "live", claimKind, publicInputs, nullifier: proof.nullifier, proof: body };
    // F5: verify locally against the pinned vkey BEFORE anyone sees it.
    const v = await liveTransport.verify(claimKind, envelope);
    if (!v.ok) throw new Error(`live transport: self-verification failed (${v.reason}) — proof never leaves`);
    // PERSONA LAUNCH P7 (L2): the prover's wall time used to ride the envelope as `provingMs` — and so the padded
    // anonymous body (lib/zk/anon/submit.ts) of every live envelope from a server device: a per-device timing
    // fingerprint the padding and the slots exist to hide. It is kept in this process's memory instead (lastLiveProve,
    // read by app/api/zk's "prove" action for the live-z* scripts), and submit.ts serializes an allowlist besides.
    lastLive = { at: Date.now(), ms };
    return envelope;
  },

  async verify(claimKind: ClaimKind, envelope: ProofEnvelope): Promise<VerifyResult> {
    if (envelope.mode !== "live" || envelope.publicInputs?.mode !== "live") return { ok: false, code: "MODE", reason: "not a live-universe envelope" };
    if (!isClaimKind(claimKind) || envelope.claimKind !== claimKind || envelope.publicInputs.claimKind !== claimKind) {
      return { ok: false, code: "KIND", reason: "unknown or mismatched claim kind" };
    }
    const body = envelope.proof as LiveProofBody;
    if (body?.scheme !== "semaphore-v4" || !Array.isArray(body.points) || body.points.length !== 8 || body.merkleTreeDepth !== MERKLE_TREE_DEPTH) {
      return { ok: false, code: "MALFORMED", reason: "malformed semaphore proof body" };
    }
    if (
      parseField(envelope.nullifier) === null ||
      parseField(envelope.publicInputs.merkleTreeRoot) === null ||
      parseField(envelope.publicInputs.message) === null ||
      parseField(envelope.publicInputs.scope) === null
    ) {
      return { ok: false, code: "MALFORMED", reason: "public values are not canonical field elements" };
    }
    let pin: ReturnType<typeof loadPinnedVkey>;
    try {
      pin = requirePin();
    } catch (e) {
      return { ok: false, code: "PIN", reason: (e as Error).message };
    }
    const proof: SemaphoreProofWire = {
      merkleTreeDepth: body.merkleTreeDepth,
      merkleTreeRoot: envelope.publicInputs.merkleTreeRoot,
      nullifier: envelope.nullifier,
      message: envelope.publicInputs.message,
      scope: envelope.publicInputs.scope,
      points: body.points,
    };
    let valid = false;
    try {
      // the worker re-reads and re-hashes the pinned file itself and
      // verifies with THAT key — the bytes hashed are the bytes used
      ({ valid } = await runWorker<{ valid: boolean }>({ op: "verify", proof, depth: MERKLE_TREE_DEPTH, vkeyPath: pin.path, vkeySha256: pin.sha256, vkeyBytes: pin.bytes }));
    } catch (e) {
      return { ok: false, code: "TAMPER", reason: "verifier error: " + (e as Error).message }; // a throw is a refusal
    }
    return valid ? { ok: true } : { ok: false, code: "TAMPER", reason: "groth16 verification failed" };
  },
};
