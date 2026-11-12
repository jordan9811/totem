// PERSONA LAUNCH P7 — THE BROWSER'S PROVER: a module Web Worker. scripts/build-device.mjs bundles this file (alone) into
// public/device/prover.js — the ONLY file a browser ever loads that carries snarkjs (GPL-3.0; the banner of prover.js and
// prover.js.LICENSE.txt say where its corresponding source is). public/device/device.js never contains it (the build
// fails if it does).
//
// PERSONA LAUNCH P7 (L1) — LOADED THE SAME WAY IN EVERY TAB, NEVER AT JOB TIME. Every tab's device fetches prover.js at
// boot (and, in the live universe, the pinned proving files), whether or not it will ever prove, and starts each
// one-job worker from a Blob URL of those bytes (lib/zk/transport/browser.ts). A worker started from the URL itself made
// a request (and a revalidation: /public is served max-age=0) at the moment a proof was due, which marked the device that
// had just proved among all the uniform tick traffic — the last timing link once OHTTP is armed. So INSIDE A WORKER this
// file never asks the network for anything: the proving files arrive in the job (`files`, the bytes the tab loaded at
// boot), they are pin-checked here exactly as before, and the worker scope's own fetch refuses outright, so no lazy path
// in a library can make a request either. handleJob's network deps remain only for a direct call on a page thread (the
// phone measurement in scripts/accept-anon-prod.mjs) and the node harness.
//
// WHY A WORKER. A Groth16 proof takes seconds on a laptop and longer on a phone; on the page's own thread it would freeze
// the app, and the secret scalar would sit in the same heap as every script on the page. Here the device hands the
// secret to a same-origin worker for ONE job (a structured-clone message, never a request), the worker answers with
// public values only, and the device terminates it.
//
// WHAT THE WORKER CHECKS (F5, the node prover's rules in a browser):
//   - the proving files come from THIS site only (same origin, /device/zk/ only — any other URL is refused before it is
//     asked for), and each is refused unless its byte length, its sha256 (crypto.subtle) and its blake2b-512
//     (@noble/hashes) all equal the pins BUNDLED here (lib/zk/ceremonyPins.ts) — never the pins the served
//     manifest.json lists (informational), never anything the artifact host says;
//   - the verification key is the pinned verification-keys.json, bundled into prover.js as TEXT at build (the define
//     __LAYERS_PINNED_VKEY_TEXT__); its utf-8 bytes are hashed against VKEY_PIN before anything is verified, and the
//     depth-20 key is sliced out of those same bytes;
//   - every proof is verified against that key before it is handed back (a proof that does not verify never leaves);
//   - the worker makes no request at all (L1): the files come in the job, snarkjs is handed in-memory buffers
//     ({type:"mem"} / Uint8Array), so its own fetch-a-URL path is never reached, and the scope's fetch refuses.
// snarkjs runs SINGLE-THREADED: ffjavascript's thread pool would spawn nested workers from data: URLs (the pool inside a
// worker is the trap the node prover hit as "Worker is not a constructor"). The bn128 curve is built once with
// singleThread and seeded as ffjavascript's cached curve, so prove AND verify (which builds its curve without options)
// both use it.
//
// OPS (one per worker): "fixture-prove" (the toy scheme's tag + the REAL nullifier, lib/zk/transport/fixtureCore.ts),
// "live-prove" (stock Semaphore v4 Groth16), "live-verify", "artifacts" (pin-check the proving files only, for the
// measurement) and "bench" (a fixed CPU workload: the phone measurement uses it to see whether CPU throttling reached
// this thread). Each answer names where it ran (the worker global scope's constructor) so the device's log can prove a
// proof was made HERE, not on the page.
//
// Comments in this file are never shipped (the bundle is minified); its strings are.
import * as snarkjs from "snarkjs";
import { Group } from "@semaphore-protocol/group";
import { blake2b } from "@noble/hashes/blake2b";
import { packGroth16Proof, unpackGroth16Proof } from "@zk-kit/utils/proof-packing";
import { ARTIFACT_PINS, PINNED_DEPTH, VKEY_PIN, type ArtifactPin } from "../ceremonyPins";
import { fixtureProveCore } from "../transport/fixtureCore";
import { parseField, semaphoreHash } from "../hash";
import type { ClaimKind, PublicInputs } from "../transport/types";

declare const __LAYERS_PINNED_VKEY_TEXT__: string | undefined;

export const ZK_FILES_PREFIX = "/device/zk/";
/** the witness calculator's memory, in 64 KiB pages: snarkjs asks for 2 GiB by default and halves on failure, which on a
 *  phone means several refused allocations (and console warnings) before every proof; the depth-20 circuit needs far
 *  less (unit-prover proves with this value) */
export const WITNESS_MEMORY_PAGES = 2048;

export interface SemaphoreProofWire {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: string[];
}

/** PERSONA LAUNCH P7 (L1): the proving files the tab loaded at boot, keyed by the path the worker would have asked for
 *  (ZK_FILES_PREFIX + file name) — handed in with a live-prove / artifacts job, never fetched by the worker */
export type ProverFiles = Record<string, Uint8Array>;

export type ProverJob =
  | { id: number; op: "fixture-prove"; claimKind: ClaimKind; publicInputs: PublicInputs; members: string[]; commitment: string; secret: string }
  | { id: number; op: "live-prove"; claimKind: ClaimKind; publicInputs: PublicInputs; members: string[]; commitment: string; secret: string; depth: number; files?: ProverFiles }
  | { id: number; op: "live-verify"; proof: SemaphoreProofWire }
  | { id: number; op: "artifacts"; files?: ProverFiles }
  | { id: number; op: "bench"; rounds?: number };

export interface ProverTimings {
  fetchMs?: number;
  proveMs?: number;
  verifyMs?: number;
  totalMs: number;
  artifactBytes?: number;
}

export interface VerifiedPins {
  vkeySha256: string;
  wasmSha256?: string;
  zkeySha256?: string;
  at: number;
}

export type ProverAnswer =
  | { id: number; ok: true; op: string; where: string; result: Record<string, unknown>; timings: ProverTimings; pins: VerifiedPins | null }
  | { id: number; ok: false; op: string; where: string; error: string; timings: ProverTimings };

export interface WorkerDeps {
  /** one of this site's own proving files (the path is checked before this is called); null when it is not there. In a
   *  worker: the bytes the job carries (inMemoryDeps); on a page thread or in node: a same-origin GET */
  fetchBytes(path: string): Promise<Uint8Array | null>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  /** the bundled pinned vkey text (the build's define), or null when this bundle carries none */
  vkeyText(): string | null;
}

// ---------------------------------------------------------------- small helpers (no Buffer: a worker has none)
const te = new TextEncoder();
const HEX = "0123456789abcdef";
const toHex = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
};
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const CANONICAL = /^(0|[1-9][0-9]{0,76})$/;
const isField = (s: unknown): s is string => typeof s === "string" && CANONICAL.test(s) && parseField(s) !== null;
const where = (): string => {
  const ctor = (globalThis as { constructor?: { name?: string } }).constructor?.name;
  return typeof ctor === "string" && ctor ? ctor : "unknown";
};

/** the origin this worker was loaded from; a path is refused unless it resolves under it, inside /device/zk/ */
export function sameOriginZkUrl(path: string, origin: string | null): string {
  if (!origin) throw new Error("the prover has no origin to fetch its files from");
  const u = new URL(path, origin);
  if (u.origin !== origin || !u.pathname.startsWith(ZK_FILES_PREFIX) || u.search || u.hash || u.username || u.password) {
    throw new Error("the prover fetches this site's own proving files only — refused " + u.pathname);
  }
  return u.href;
}

function defaultDeps(): WorkerDeps {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin ?? null;
  return {
    async fetchBytes(path) {
      const res = await globalThis.fetch(sameOriginZkUrl(path, origin), { credentials: "same-origin", redirect: "error", cache: "default" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
      return new Uint8Array(await res.arrayBuffer());
    },
    async sha256Hex(bytes) {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) throw new Error("this browser has no WebCrypto here — the proving files cannot be checked, so they are not used");
      return toHex(new Uint8Array(await subtle.digest("SHA-256", bytes as unknown as BufferSource)));
    },
    vkeyText() {
      return typeof __LAYERS_PINNED_VKEY_TEXT__ === "string" ? __LAYERS_PINNED_VKEY_TEXT__ : null;
    },
  };
}

// ---------------------------------------------------------------- the pinned verification key
interface Groth16Vkey {
  protocol: "groth16";
  curve: "bn128";
  nPublic: 4;
  vk_alpha_1: unknown;
  vk_beta_2: unknown;
  vk_gamma_2: unknown;
  vk_delta_2: unknown;
  vk_alphabeta_12: unknown;
  IC: unknown;
}

/** hash the BUNDLED vkey bytes against VKEY_PIN, then slice `depth` out of the same bytes (a throw is a refusal) */
export async function pinnedVkey(deps: WorkerDeps, depth: number): Promise<{ vk: Groth16Vkey; sha256: string }> {
  const text = deps.vkeyText();
  if (text === null) throw new Error("this prover bundle carries no verification key — refusing to verify anything");
  const bytes = te.encode(text);
  const sha = await deps.sha256Hex(bytes);
  if (bytes.length !== VKEY_PIN.bytes || sha !== VKEY_PIN.sha256) throw new Error("the bundled verification key is NOT the build pin — refusing to verify");
  const bundle = JSON.parse(text) as Record<string, unknown>;
  const delta = bundle.vk_delta_2 as unknown[];
  const ic = bundle.IC as unknown[];
  if (bundle.protocol !== "groth16" || bundle.curve !== "bn128" || bundle.nPublic !== 4 || !Array.isArray(delta) || !Array.isArray(ic) || delta.length < depth || ic.length < depth) {
    throw new Error("the pinned verification key bundle has an unexpected shape — refusing to verify");
  }
  return {
    sha256: sha,
    vk: { protocol: "groth16", curve: "bn128", nPublic: 4, vk_alpha_1: bundle.vk_alpha_1, vk_beta_2: bundle.vk_beta_2, vk_gamma_2: bundle.vk_gamma_2, vk_delta_2: delta[depth - 1], vk_alphabeta_12: bundle.vk_alphabeta_12, IC: ic[depth - 1] },
  };
}

// ---------------------------------------------------------------- the proving files
export const ARTIFACTS_ABSENT = "The proving files aren't on this site yet, so a real proof can't be made here. Nothing was sent.";

async function verifiedFile(deps: WorkerDeps, pin: ArtifactPin): Promise<Uint8Array> {
  const bytes = await deps.fetchBytes(ZK_FILES_PREFIX + pin.file);
  if (bytes === null) throw new Error(ARTIFACTS_ABSENT);
  if (bytes.length !== pin.bytes) throw new Error(`a proving file served by this site is not the pinned one (${pin.file}: ${bytes.length} bytes, pin ${pin.bytes}) — refused`);
  if ((await deps.sha256Hex(bytes)) !== pin.sha256) throw new Error(`a proving file served by this site is not the pinned one (${pin.file}: sha256 mismatch) — refused`);
  if (toHex(blake2b(bytes, { dkLen: 64 })) !== pin.blake2b512) throw new Error(`a proving file served by this site is not the pinned one (${pin.file}: blake2b-512 mismatch) — refused`);
  return bytes;
}

export async function loadArtifacts(deps: WorkerDeps, depth: number): Promise<{ wasm: Uint8Array; zkey: Uint8Array; fetchMs: number; bytes: number }> {
  const pins = ARTIFACT_PINS[depth];
  if (!pins) throw new Error(`no pinned proving files for depth ${depth} — refused`);
  const t0 = now();
  // the manifest only says whether the build shipped the files at all (so an absent pair costs one small request, not two
  // failed large ones); its pins are never trusted — the bundled ones above are the check
  const manifest = await deps.fetchBytes(ZK_FILES_PREFIX + "manifest.json");
  if (manifest === null) throw new Error(ARTIFACTS_ABSENT);
  let present = false;
  try {
    present = (JSON.parse(new TextDecoder().decode(manifest)) as { present?: unknown }).present === true;
  } catch {
    present = false;
  }
  if (!present) throw new Error(ARTIFACTS_ABSENT);
  const wasm = await verifiedFile(deps, pins.wasm);
  const zkey = await verifiedFile(deps, pins.zkey);
  return { wasm, zkey, fetchMs: now() - t0, bytes: wasm.length + zkey.length };
}

// ---------------------------------------------------------------- snarkjs, single-threaded
type CurvesApi = { getCurveFromName(name: string, opts?: { singleThread?: boolean }): Promise<unknown> };
async function singleThreadCurve(): Promise<void> {
  const gc = globalThis as { curve_bn128?: unknown };
  if (gc.curve_bn128) return;
  // seeded as ffjavascript's cached curve: groth16.verify builds its curve with no options and so finds this one
  gc.curve_bn128 = await (snarkjs as unknown as { curves: CurvesApi }).curves.getCurveFromName("bn128", { singleThread: true });
}

/** the public signals exactly as @semaphore-protocol/proof feeds the circuit: [root, nullifier, hash(message), hash(scope)] */
function signalsOf(p: { merkleTreeRoot: string; nullifier: string; message: string; scope: string }): string[] {
  return [p.merkleTreeRoot, p.nullifier, semaphoreHash(BigInt(p.message)).toString(10), semaphoreHash(BigInt(p.scope)).toString(10)];
}

async function verifyWire(deps: WorkerDeps, p: SemaphoreProofWire): Promise<{ valid: boolean; ms: number; vkeySha256: string }> {
  if (p?.merkleTreeDepth !== PINNED_DEPTH) throw new Error("the proof's depth is not the pinned depth");
  for (const k of ["merkleTreeRoot", "nullifier", "message", "scope"] as const) if (!isField(p[k])) throw new Error(`${k} is not a canonical field element`);
  if (!Array.isArray(p.points) || p.points.length !== 8 || !p.points.every((x) => typeof x === "string" && /^[0-9]{1,78}$/.test(x))) throw new Error("malformed proof points");
  const { vk, sha256 } = await pinnedVkey(deps, PINNED_DEPTH);
  await singleThreadCurve();
  const t0 = now();
  const valid = await snarkjs.groth16.verify(vk, signalsOf(p), unpackGroth16Proof(p.points as never) as never);
  return { valid: valid === true, ms: now() - t0, vkeySha256: sha256 };
}

// ---------------------------------------------------------------- the jobs
function secretOf(job: { secret?: unknown }): bigint {
  if (!isField(job.secret)) throw new Error("no secret scalar for this job");
  return BigInt(job.secret);
}

export async function handleJob(raw: unknown, depsIn?: Partial<WorkerDeps>): Promise<ProverAnswer> {
  const deps: WorkerDeps = { ...defaultDeps(), ...(depsIn ?? {}) };
  const t0 = now();
  const job = (raw ?? {}) as ProverJob;
  const id = Number.isInteger(job.id) ? job.id : -1;
  const op = typeof job.op === "string" ? job.op : "unknown";
  try {
    if (job.op === "fixture-prove") {
      const r = fixtureProveCore(job.claimKind, job.publicInputs, job.members, job.commitment, secretOf(job));
      return { id, ok: true, op, where: where(), result: r, timings: { totalMs: now() - t0 }, pins: null };
    }
    if (job.op === "live-prove") {
      const p = job.publicInputs;
      if (p?.mode !== "live") throw new Error("refusing to prove a non-live envelope with the live prover");
      if (job.depth !== PINNED_DEPTH) throw new Error("the requested depth is not the pinned depth");
      if (!isField(p.scope) || !isField(p.message) || !isField(p.merkleTreeRoot)) throw new Error("the public inputs are not canonical field elements");
      if (!Array.isArray(job.members) || !job.members.every(isField) || !isField(job.commitment)) throw new Error("malformed tree members");
      const secret = secretOf(job);
      // the pin is checked BEFORE any file is fetched: a bundle with a wrong key never asks for the proving files
      const { vk, sha256: vkeySha256 } = await pinnedVkey(deps, PINNED_DEPTH);
      const files = await loadArtifacts(deps, PINNED_DEPTH);
      const group = new Group(job.members.map((m) => BigInt(m)));
      const index = group.indexOf(BigInt(job.commitment));
      if (index === -1) throw new Error("this root's commitment is not a member of the tree — cannot prove membership");
      const mp = group.generateMerkleProof(index);
      if (mp.root.toString(10) !== p.merkleTreeRoot) throw new Error("the tree's members do not build the intended root");
      const merkleProofLength = mp.siblings.length;
      const siblings: bigint[] = [...mp.siblings];
      for (let i = 0; i < PINNED_DEPTH; i++) if (siblings[i] === undefined) siblings[i] = BigInt(0);
      await singleThreadCurve();
      const tp = now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { secret, merkleProofLength, merkleProofIndex: mp.index, merkleProofSiblings: siblings, scope: semaphoreHash(BigInt(p.scope)), message: semaphoreHash(BigInt(p.message)) } as never,
        files.wasm,
        files.zkey,
        undefined,
        { memorySize: WITNESS_MEMORY_PAGES },
        { singleThread: true }
      );
      const proveMs = now() - tp;
      const wire: SemaphoreProofWire = {
        merkleTreeDepth: PINNED_DEPTH,
        merkleTreeRoot: String(publicSignals[0]),
        nullifier: String(publicSignals[1]),
        message: p.message,
        scope: p.scope,
        points: packGroth16Proof(proof as never).map(String),
      };
      if (wire.merkleTreeRoot !== p.merkleTreeRoot) throw new Error("the proof's root differs from the intended root");
      // F5: verified against the pinned key, from public values recomputed here, before anything is handed back
      const tv = now();
      const ok = (await snarkjs.groth16.verify(vk, signalsOf(wire), unpackGroth16Proof(wire.points as never) as never)) === true;
      const verifyMs = now() - tv;
      if (!ok) throw new Error("self-verification failed — the proof never leaves the worker");
      const pins: VerifiedPins = { vkeySha256, wasmSha256: ARTIFACT_PINS[PINNED_DEPTH].wasm.sha256, zkeySha256: ARTIFACT_PINS[PINNED_DEPTH].zkey.sha256, at: Date.now() };
      return { id, ok: true, op, where: where(), result: { proof: wire }, timings: { fetchMs: files.fetchMs, proveMs, verifyMs, totalMs: now() - t0, artifactBytes: files.bytes }, pins };
    }
    if (job.op === "live-verify") {
      const v = await verifyWire(deps, job.proof);
      return { id, ok: true, op, where: where(), result: { valid: v.valid }, timings: { verifyMs: v.ms, totalMs: now() - t0 }, pins: { vkeySha256: v.vkeySha256, at: Date.now() } };
    }
    if (job.op === "artifacts") {
      const { sha256: vkeySha256 } = await pinnedVkey(deps, PINNED_DEPTH);
      const files = await loadArtifacts(deps, PINNED_DEPTH);
      const pins: VerifiedPins = { vkeySha256, wasmSha256: ARTIFACT_PINS[PINNED_DEPTH].wasm.sha256, zkeySha256: ARTIFACT_PINS[PINNED_DEPTH].zkey.sha256, at: Date.now() };
      return { id, ok: true, op, where: where(), result: { bytes: files.bytes }, timings: { fetchMs: files.fetchMs, totalMs: now() - t0, artifactBytes: files.bytes }, pins };
    }
    if (job.op === "bench") {
      // a fixed CPU workload (blake2b over 4 KiB, chained): what CPU throttling does to THIS thread
      const rounds = Math.max(1, Math.min(20_000, Number.isInteger(job.rounds) ? (job.rounds as number) : 2_000));
      let acc = new Uint8Array(4096);
      const tb = now();
      for (let i = 0; i < rounds; i++) {
        const h = blake2b(acc, { dkLen: 64 });
        acc = new Uint8Array(4096);
        acc.set(h, i % 4000);
      }
      return { id, ok: true, op, where: where(), result: { rounds, checksum: toHex(blake2b(acc, { dkLen: 8 })) }, timings: { totalMs: now() - tb }, pins: null };
    }
    throw new Error("unknown prover job");
  } catch (e) {
    return { id, ok: false, op, where: where(), error: (e as Error)?.message ?? String(e), timings: { totalMs: now() - t0 } };
  }
}

// ---------------------------------------------------------------- installed only inside a worker
/** PERSONA LAUNCH P7 (L1): the ONLY deps a worker job gets — the files the job carries (the tab's boot-time load), by
 *  exact path; a file the job does not carry is "not on this site" (null → ARTIFACTS_ABSENT), never a request */
export function inMemoryDeps(job: unknown): Partial<WorkerDeps> {
  const files = (job && typeof job === "object" ? (job as { files?: unknown }).files : undefined) as Record<string, unknown> | undefined;
  return {
    async fetchBytes(path: string) {
      const f = files && typeof files === "object" && Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
      return f instanceof Uint8Array ? f : null;
    },
  };
}
/** PERSONA LAUNCH P7 (L1): what the installed worker answers a message with — the job against in-memory files only */
export function answerWorkerMessage(data: unknown): Promise<ProverAnswer> {
  return handleJob(data, inMemoryDeps(data));
}
function inWorkerScope(): boolean {
  const W = (globalThis as Record<string, unknown>).WorkerGlobalScope as (new () => unknown) | undefined;
  return typeof W === "function" && globalThis instanceof W;
}
if (inWorkerScope()) {
  // L1: nothing in this worker may reach the network — not this file, not a library's lazy path
  (globalThis as { fetch?: unknown }).fetch = () => Promise.reject(new Error("the prover makes no requests — refused"));
  const scope = globalThis as unknown as { onmessage: ((ev: { data: unknown }) => void) | null; postMessage(m: unknown): void };
  scope.onmessage = (ev) => {
    void answerWorkerMessage(ev.data).then((answer) => scope.postMessage(answer));
  };
}
