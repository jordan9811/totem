// PERSONA LAUNCH P7 — THE BROWSER DEVICE'S TRANSPORT: proofs are made in a Web Worker (public/device/prover.js, built
// from lib/zk/prover/browser-worker.ts), in BOTH universes, so every production-shaped run exercises the worker path
// that strangers' tabs will run. lib/zk/transport/index.ts returns it whenever the device runs in a browser; the node
// transports (fixture.ts, live.ts — a forked child for live) are unchanged for a server-side device.
//
// WHAT CROSSES TO THE WORKER, AND WHAT DOES NOT. The device posts ONE job to a same-origin module worker: the public
// inputs, the tree's members, this root's public commitment and — for that one job — its secret scalar as a decimal
// string. A postMessage is not a request: nothing leaves the tab, and the worker answers with public values only (a
// nullifier and a tag, or a Groth16 proof and the hashes it verified against). The worker is terminated when it
// answers, when it fails, and when it outlives its job's timeout; a fresh one serves the next job. It never runs on the
// page's own thread as a fallback: a browser that cannot start the worker gets a plain, retryable refusal.
//
// LIVE needs the proving files this site serves at /device/zk/ (copied there by scripts/build-device.mjs only when the
// pinned files were present and verified at build). Without them the worker answers a plain refusal — "the proving
// files aren't on this site yet" — and the post stays wanted for the next tick (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY).
//
// PERSONA LAUNCH P7 (L1) — NO REQUEST AT JOB TIME. The worker used to be started from /device/prover.js for every job
// (and, live, fetched manifest/wasm/zkey itself). Jobs run only on a tick that has something wanted, /public is served
// max-age=0 (every load revalidates) and every other fetch of the tick is uniform for every device, so that one request
// marked the device that had just proved — and once OHTTP is armed it would be the remaining timing link. Now EVERY
// tab loads the prover the same way, at boot, whether or not it will ever prove (startProverPreload, called by
// lib/device/entry.ts): prover.js once, held as a Blob URL every job's worker starts from (a blob: URL is never a
// request), and in the live universe the three proving files too, handed to each job in its message (the worker
// pin-checks them exactly as before and itself requests nothing). A load that failed is retried on its own slow timer —
// the same for every tab that failed, wanted or not — and a job that finds the prover (or, live, its files) not loaded
// yet is REFUSED, plainly and retryably, never loaded lazily. Measured by scripts/unit-prover.mjs H1/H3 (with mutations
// that restore the lazy load) and scripts/accept-anon-prod.mjs checks 1, 3 and 8 (zero app requests during a proof).
//
// The log of jobs (op, outcome, timings, where the answer was computed) and the last verified pins live in memory:
// the device's DEBUG hook reads the log (lib/device/entry.ts, LAYERS_DEVICE_DEBUG only), the privacy label's condition
// 5 reads the last verified pins (lib/zk/privacy.ts — never a fetch at render), and Settings › ZK says where proofs
// run and how long the last one took (app/api/zk/route.ts proverStatus).
import { MERKLE_TREE_DEPTH, ZK_ANON_POST_TREE, zkMode, type ZkMode } from "../config";
import { ARTIFACT_PINS, PINNED_DEPTH } from "../ceremonyPins";
import { zkCommitment, zkSecretScalarForProver } from "../identity";
import { anonFidTreeCommitment, anonFidTreeSecretScalarForProver, proverIdentityFor } from "../anon/fcJoin";
import { nullifierFor } from "../nullifier";
import { parseField } from "../hash";
import { fixturePrecheck, fixtureVerifyCore, NOT_A_MEMBER } from "./fixtureCore";
import { isClaimKind, type ClaimKind, type FixtureProofBody, type LiveProofBody, type ProofEnvelope, type PublicInputs, type VerifyResult, type WitnessRef, type ZkTransport } from "./types";

/** where the device loads its prover from — same origin, beside device.js (fetched at boot, never at job time) */
export const PROVER_URL = "/device/prover.js";
/** where the proving files live — the worker's ZK_FILES_PREFIX (lib/zk/prover/browser-worker.ts; this bundle cannot import
 *  that file: it carries snarkjs) */
export const ZK_FILES_PATH = "/device/zk/";
/** the three files a live job carries, in the order they are loaded: the manifest says whether the build shipped the pair */
export const ZK_FILE_PATHS = Object.freeze([ZK_FILES_PATH + "manifest.json", ZK_FILES_PATH + ARTIFACT_PINS[PINNED_DEPTH].wasm.file, ZK_FILES_PATH + ARTIFACT_PINS[PINNED_DEPTH].zkey.file]);
export const FIXTURE_JOB_TIMEOUT_MS = 30_000;
/** a phone at 6x slower than a laptop proves in tens of seconds (shots/p7-browser-prover.json); the budget is wide */
export const LIVE_JOB_TIMEOUT_MS = 300_000;
/** a failed boot-time load is tried again on this slow timer, the same for every tab that failed (never at job time) */
export const PRELOAD_RETRY_MS = 60_000;
export const NO_WORKER = "This browser can't run the prover (no Web Worker), so nothing can be proved from this tab. Nothing was sent.";
export const PROVER_NOT_LOADED = "The prover hasn't finished loading in this tab yet, so nothing could be proved. Nothing was sent; it is tried again at the next check.";
export const FILES_NOT_LOADED = "The proving files haven't finished loading in this tab yet, so a real proof can't be made right now. Nothing was sent; it is tried again at the next check.";

export interface ProverLogEntry {
  jobId: number;
  op: string;
  at: number;
  ms: number;
  ok: boolean;
  /** the worker global scope's constructor name the answer came from (e.g. "DedicatedWorkerGlobalScope") */
  where: string | null;
  error?: string;
  timings?: { fetchMs?: number; proveMs?: number; verifyMs?: number; totalMs?: number; artifactBytes?: number };
}
export interface LastVerifiedPins {
  vkeySha256: string;
  wasmSha256?: string;
  zkeySha256?: string;
  at: number;
}
interface ProverState {
  seq: number;
  log: ProverLogEntry[];
  lastPins: LastVerifiedPins | null;
  /** `provingMs` (L2): the worker's own prove time — kept HERE, in the tab's memory, never on the envelope (an envelope
   *  field rides the padded anonymous body to the validator: a per-device timing fingerprint) */
  lastProve: { op: string; at: number; ms: number; mode: ZkMode; provingMs?: number } | null;
}
/** one boot-time load (L1): when, how long, how many bytes, or why it failed */
export interface PreloadRecord {
  ok: boolean;
  at: number;
  ms: number;
  bytes: number;
  error?: string;
}
interface PreloadState {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  /** the blob: URL of the prover's bytes, loaded at boot — what every job's worker starts from */
  proverUrl: string | null;
  prover: PreloadRecord | null;
  /** live universe: the files a job carries, keyed by the worker's path; the manifest alone when the build shipped none */
  files: Record<string, Uint8Array> | null;
  filesLoad: PreloadRecord | null;
  /** the build shipped no proving files (the manifest said so, or there is none): a definitive answer for this document */
  filesAbsent: boolean;
}
const g = globalThis as unknown as { __layersBrowserProver?: ProverState; __layersBrowserPreload?: PreloadState };
const st = (): ProverState => (g.__layersBrowserProver ??= { seq: 0, log: [], lastPins: null, lastProve: null });
const pst = (): PreloadState => (g.__layersBrowserPreload ??= { started: false, timer: null, inFlight: null, proverUrl: null, prover: null, files: null, filesLoad: null, filesAbsent: false });

/** one same-origin GET of a file this site serves (the tab's own fetch — boot.js and the device host pass /device/ by) */
async function getBytes(path: string): Promise<Uint8Array | null> {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== "function") throw new Error("this browser has no fetch");
  const res = await f(path, { credentials: "same-origin", redirect: "error", cache: "default" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + path);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * L1 — ONE PASS of the boot-time load, for universe `mode`: the prover (if not held yet) and, in the live universe, the
 * proving files (if not held and not known absent). Called at boot and by the retry timer, NEVER by a job; a pass with
 * nothing missing makes no request. Exported for the node harness (scripts/unit-prover.mjs) to await a pass.
 */
export function preloadProverNow(mode: ZkMode = zkMode()): Promise<void> {
  const p = pst();
  if (p.inFlight) return p.inFlight;
  const run = async () => {
    if (p.proverUrl === null) {
      const t0 = Date.now();
      try {
        const bytes = await getBytes(PROVER_URL);
        if (bytes === null) throw new Error("this site serves no prover (" + PROVER_URL + " is missing)");
        const B = (globalThis as { Blob?: typeof Blob }).Blob;
        const U = (globalThis as { URL?: typeof URL }).URL;
        if (typeof B !== "function" || typeof U?.createObjectURL !== "function") throw new Error("this browser can't hold the prover in memory (no Blob URLs)");
        p.proverUrl = U.createObjectURL(new B([bytes as unknown as BlobPart], { type: "text/javascript" }));
        p.prover = { ok: true, at: Date.now(), ms: Date.now() - t0, bytes: bytes.length };
      } catch (e) {
        p.prover = { ok: false, at: Date.now(), ms: Date.now() - t0, bytes: 0, error: (e as Error).message };
      }
    }
    if (mode === "live" && !p.filesAbsent && !(p.files && ZK_FILE_PATHS.every((f) => p.files?.[f] instanceof Uint8Array))) {
      const t0 = Date.now();
      try {
        const [manifestPath, wasmPath, zkeyPath] = ZK_FILE_PATHS;
        const manifest = await getBytes(manifestPath);
        let present = false;
        try {
          present = manifest !== null && (JSON.parse(new TextDecoder().decode(manifest)) as { present?: unknown }).present === true;
        } catch {
          present = false;
        }
        if (!present) {
          // the build shipped none: the job carries the manifest (or nothing) and the worker answers its plain refusal
          p.files = manifest ? { [manifestPath]: manifest } : {};
          p.filesAbsent = true;
          p.filesLoad = { ok: true, at: Date.now(), ms: Date.now() - t0, bytes: manifest?.length ?? 0 };
        } else {
          const wasm = await getBytes(wasmPath);
          const zkey = await getBytes(zkeyPath);
          if (!wasm || !zkey) throw new Error("the manifest lists proving files this site does not serve");
          p.files = { [manifestPath]: manifest as Uint8Array, [wasmPath]: wasm, [zkeyPath]: zkey };
          p.filesLoad = { ok: true, at: Date.now(), ms: Date.now() - t0, bytes: wasm.length + zkey.length };
        }
      } catch (e) {
        p.filesLoad = { ok: false, at: Date.now(), ms: Date.now() - t0, bytes: 0, error: (e as Error).message };
      }
    }
  };
  p.inFlight = run().finally(() => {
    p.inFlight = null;
  });
  return p.inFlight;
}

/** L1 — start the boot-time load ONCE per tab (lib/device/entry.ts, at boot, every tab), then keep a slow retry timer
 *  that re-runs a pass (a pass with nothing missing requests nothing; the universe is read each time) */
export function startProverPreload(): void {
  const p = pst();
  if (p.started) return;
  p.started = true;
  const arm = () => {
    // ±25% so tabs that failed together do not retry together; Math.random is enough for a retry spread
    p.timer = setTimeout(() => {
      void preloadProverNow().finally(arm);
    }, Math.round(PRELOAD_RETRY_MS * (0.75 + 0.5 * Math.random())));
    (p.timer as { unref?: () => void }).unref?.();
  };
  void preloadProverNow().finally(arm);
}

/** DEBUG / settings reader: what the boot-time load holds — sizes and times only, never the bytes */
export function preloadStatus(): { started: boolean; prover: PreloadRecord | null; proverReady: boolean; files: PreloadRecord | null; filesReady: boolean; filesAbsent: boolean } {
  const p = pst();
  return { started: p.started, prover: p.prover ? { ...p.prover } : null, proverReady: p.proverUrl !== null, files: p.filesLoad ? { ...p.filesLoad } : null, filesReady: p.files !== null, filesAbsent: p.filesAbsent };
}

/** DEBUG READERS (the device's debug hook, the settings probe): public values only — never a secret, never a member list */
export function proverLog(): ProverLogEntry[] {
  return st().log.map((e) => ({ ...e, timings: e.timings ? { ...e.timings } : undefined }));
}
export function lastVerifiedPins(): LastVerifiedPins | null {
  const p = st().lastPins;
  return p ? { ...p } : null;
}
export function lastProve(): ProverState["lastProve"] {
  const p = st().lastProve;
  return p ? { ...p } : null;
}

interface WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string; preventDefault?: () => void }) => void) | null;
  onmessageerror?: ((ev: unknown) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}
type WorkerCtor = new (url: string, opts?: { type?: "module" | "classic"; name?: string }) => WorkerLike;

interface WorkerAnswer {
  id: number;
  ok: boolean;
  op: string;
  where?: string;
  error?: string;
  result?: Record<string, unknown>;
  timings?: ProverLogEntry["timings"];
  pins?: LastVerifiedPins | null;
}

/** the ops whose job carries the proving files the tab loaded at boot (L1) */
const FILE_OPS = new Set(["live-prove", "artifacts"]);

/** ONE job in ONE fresh worker started from the boot-loaded prover (never from the network: L1); terminated on the
 *  answer, on an error and on the timeout */
export function runProverJob(job: Record<string, unknown> & { op: string }, timeoutMs: number): Promise<WorkerAnswer> {
  const s = st();
  const jobId = ++s.seq;
  const t0 = Date.now();
  const record = (e: Omit<ProverLogEntry, "jobId" | "op" | "at" | "ms">) => {
    s.log.push({ jobId, op: job.op, at: t0, ms: Date.now() - t0, ...e });
    if (s.log.length > 50) s.log.shift();
  };
  const W = (globalThis as { Worker?: WorkerCtor }).Worker;
  if (typeof W !== "function") {
    record({ ok: false, where: null, error: NO_WORKER });
    return Promise.reject(new Error(NO_WORKER));
  }
  // L1: the prover loaded at boot, or a refusal — never a request now (the next tick tries again; the retry timer loads)
  const url = pst().proverUrl;
  if (url === null) {
    record({ ok: false, where: null, error: PROVER_NOT_LOADED });
    return Promise.reject(new Error(PROVER_NOT_LOADED));
  }
  let message: Record<string, unknown> = { ...job, id: jobId };
  if (FILE_OPS.has(job.op)) {
    const files = pst().files;
    if (files === null) {
      record({ ok: false, where: null, error: FILES_NOT_LOADED });
      return Promise.reject(new Error(FILES_NOT_LOADED));
    }
    // copied into the job by structured clone (never transferred: the tab keeps its copy for the next job)
    message = { ...message, files };
  }
  return new Promise<WorkerAnswer>((resolve, reject) => {
    let worker: WorkerLike;
    try {
      worker = new W(url, { type: "module", name: "layers-prover" });
    } catch (e) {
      record({ ok: false, where: null, error: "the prover could not start: " + (e as Error).message });
      reject(new Error("the prover could not start in this tab (" + (e as Error).message + ") — nothing was sent; it is tried again at the next check"));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        record({ ok: false, where: null, error: "timed out" });
        reject(new Error(`the prover took longer than ${Math.round(timeoutMs / 1000)} s and was stopped — nothing was sent; it is tried again at the next check`));
      });
    }, timeoutMs);
    worker.onmessage = (ev) => {
      const a = (ev?.data ?? {}) as WorkerAnswer;
      finish(() => {
        if (a.id !== jobId) {
          record({ ok: false, where: a.where ?? null, error: "an answer for another job" });
          reject(new Error("the prover answered a different job — refused"));
          return;
        }
        record({ ok: a.ok === true, where: typeof a.where === "string" ? a.where : null, error: a.ok ? undefined : a.error, timings: a.timings });
        if (a.ok === true) {
          // merged, not replaced: a verify job checks only the key, and must not erase what the last proof checked
          if (a.pins) s.lastPins = { vkeySha256: a.pins.vkeySha256, wasmSha256: a.pins.wasmSha256 ?? s.lastPins?.wasmSha256, zkeySha256: a.pins.zkeySha256 ?? s.lastPins?.zkeySha256, at: a.pins.at };
          resolve(a);
        } else reject(new Error(typeof a.error === "string" && a.error ? a.error : "the prover refused"));
      });
    };
    worker.onerror = (ev) => {
      ev?.preventDefault?.();
      finish(() => {
        record({ ok: false, where: null, error: "worker error: " + (ev?.message ?? "unknown") });
        reject(new Error("the prover failed in this tab (" + (ev?.message ?? "a worker error") + ") — nothing was sent; it is tried again at the next check"));
      });
    };
    worker.onmessageerror = () => finish(() => {
      record({ ok: false, where: null, error: "an unreadable answer" });
      reject(new Error("the prover's answer could not be read — refused"));
    });
    worker.postMessage(message);
  });
}

interface SemaphoreProofWire {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: string[];
}

function makeTransport(mode: ZkMode): ZkTransport {
  return {
    mode,

    async prove(claimKind: ClaimKind, publicInputs: PublicInputs, witness: WitnessRef): Promise<ProofEnvelope> {
      if (mode === "fixture") {
        // the refusals that need nothing secret are made here, before a worker exists (fixture.ts's order)
        fixturePrecheck(claimKind, publicInputs);
        const commitment = zkCommitment();
        if (!witness.members.includes(commitment)) throw new Error(NOT_A_MEMBER);
        const t0 = Date.now();
        const a = await runProverJob({ op: "fixture-prove", claimKind, publicInputs, members: witness.members, commitment, secret: zkSecretScalarForProver().toString(10) }, FIXTURE_JOB_TIMEOUT_MS);
        const r = (a.result ?? {}) as { nullifier?: unknown; tag?: unknown };
        if (typeof r.nullifier !== "string" || typeof r.tag !== "string") throw new Error("the prover's answer is malformed — refused");
        const body: FixtureProofBody = { scheme: "layers-zk-fixture/1", tag: r.tag };
        const envelope: ProofEnvelope = { v: 1, mode: "fixture", claimKind, publicInputs, nullifier: r.nullifier, proof: body };
        const v = fixtureVerifyCore(claimKind, envelope);
        if (!v.ok) throw new Error(`the prover's fixture tag does not verify (${v.reason}) — refused`);
        st().lastProve = { op: "fixture-prove", at: Date.now(), ms: Date.now() - t0, mode };
        return envelope;
      }
      // LIVE
      if (publicInputs.mode !== "live") throw new Error("live transport: refusing to prove a non-live envelope");
      if (!isClaimKind(claimKind) || publicInputs.claimKind !== claimKind) throw new Error("live transport: unknown claim kind");
      const scope = parseField(publicInputs.scope);
      if (scope === null || parseField(publicInputs.message) === null) throw new Error("live transport: scope/message are not field elements");
      // PUBLIC GO-LIVE (PRIV-LIVE-1): the live plain anon tree of a gated validator is proved by this device's CROWD
      // identity (lib/zk/anon/fcJoin.ts — joined with Farcaster, never registered under a root); every other tree by the
      // root's. lib/zk/prove.ts declares which (witness.identity, chosen on these same members); a direct caller gets the
      // root-first rule (proverIdentityFor)
      const declared = (witness as WitnessRef & { identity?: "root" | "anon-fid-tree" }).identity;
      const pick = proverIdentityFor({
        declared,
        mode: "live",
        tree: publicInputs.tree,
        plainTree: ZK_ANON_POST_TREE,
        members: witness.members,
        rootCommitment: zkCommitment,
        fidCommitment: () => {
          try {
            return anonFidTreeCommitment();
          } catch {
            return null; // unreadable: refused just below, never proved as another identity
          }
        },
      });
      const commitment = pick.commitment;
      if (!commitment || !witness.members.includes(commitment)) throw new Error("live transport: this root's commitment is not a member of the tree — cannot prove membership");
      const secret = pick.identity === "anon-fid-tree" ? anonFidTreeSecretScalarForProver() : zkSecretScalarForProver();
      const t0 = Date.now();
      const a = await runProverJob({ op: "live-prove", claimKind, publicInputs, members: witness.members, commitment, secret: secret.toString(10), depth: MERKLE_TREE_DEPTH }, LIVE_JOB_TIMEOUT_MS);
      const proof = ((a.result ?? {}) as { proof?: SemaphoreProofWire }).proof;
      if (!proof || !Array.isArray(proof.points) || proof.points.length !== 8) throw new Error("the prover's answer is malformed — refused");
      // the proof must be about EXACTLY the public inputs intended (live.ts's checks, unchanged)
      if (proof.merkleTreeRoot !== publicInputs.merkleTreeRoot) throw new Error("live transport: proof root differs from the intended root");
      if (proof.message !== publicInputs.message || proof.scope !== publicInputs.scope) throw new Error("live transport: proof message/scope differ from the intended inputs");
      // F10 cross-check: the circuit's nullifier equals our duplicate formula
      if (proof.nullifier !== nullifierFor(scope, secret).toString(10)) throw new Error("live transport: circuit nullifier != Poseidon(hash(scope), secret) — formula drift, refusing");
      const body: LiveProofBody = { scheme: "semaphore-v4", merkleTreeDepth: proof.merkleTreeDepth, points: proof.points };
      const envelope: ProofEnvelope = { v: 1, mode: "live", claimKind, publicInputs, nullifier: proof.nullifier, proof: body };
      // L2: the prove time stays in this tab's memory (lastProve) — never a field on the envelope that leaves it
      st().lastProve = { op: "live-prove", at: Date.now(), ms: Date.now() - t0, mode, ...(typeof a.timings?.proveMs === "number" ? { provingMs: a.timings.proveMs } : {}) };
      return envelope;
    },

    async verify(claimKind: ClaimKind, envelope: ProofEnvelope): Promise<VerifyResult> {
      if (mode === "fixture") return fixtureVerifyCore(claimKind, envelope);
      if (envelope.mode !== "live" || envelope.publicInputs?.mode !== "live") return { ok: false, code: "MODE", reason: "not a live-universe envelope" };
      if (!isClaimKind(claimKind) || envelope.claimKind !== claimKind || envelope.publicInputs.claimKind !== claimKind) return { ok: false, code: "KIND", reason: "unknown or mismatched claim kind" };
      const body = envelope.proof as LiveProofBody;
      if (body?.scheme !== "semaphore-v4" || !Array.isArray(body.points) || body.points.length !== 8 || body.merkleTreeDepth !== MERKLE_TREE_DEPTH) {
        return { ok: false, code: "MALFORMED", reason: "malformed semaphore proof body" };
      }
      const proof: SemaphoreProofWire = {
        merkleTreeDepth: body.merkleTreeDepth,
        merkleTreeRoot: envelope.publicInputs.merkleTreeRoot,
        nullifier: envelope.nullifier,
        message: envelope.publicInputs.message,
        scope: envelope.publicInputs.scope,
        points: body.points,
      };
      try {
        const a = await runProverJob({ op: "live-verify", proof }, LIVE_JOB_TIMEOUT_MS);
        return (a.result as { valid?: unknown } | undefined)?.valid === true ? { ok: true } : { ok: false, code: "TAMPER", reason: "groth16 verification failed" };
      } catch (e) {
        // a verifier that could not run is a refusal (the pin is checked inside the worker: a mismatch lands here)
        return { ok: false, code: (e as Error).message.includes("NOT the build pin") ? "PIN" : "TAMPER", reason: "verifier error: " + (e as Error).message };
      }
    },
  };
}

const transports: Partial<Record<ZkMode, ZkTransport>> = {};
export function browserTransport(mode: ZkMode): ZkTransport {
  return (transports[mode] ??= makeTransport(mode));
}
