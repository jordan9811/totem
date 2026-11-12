// ZK PASS 1 — the LIVE prover/verifier, run as a CHILD PROCESS of the app.
// A SEPARATE, UNBUNDLED file on purpose: this is the only place snarkjs
// (GPL-3.0, via @semaphore-protocol/proof) executes on the client side,
// so the license scope is explicit and the Next server bundle never
// contains it. Forked by lib/zk/transport/live.ts with child_process,
// handed ONE job over IPC, killed as soon as it reports.
//
// WHY A PROCESS AND NOT A worker_threads WORKER: snarkjs's thread pool
// (ffjavascript) is built through the `web-worker` polyfill, which —
// loaded inside a worker_threads worker — mistakes itself for the
// polyfill's own child and exports a non-constructor ("Worker is not a
// constructor"). In a forked process it is the main thread again and the
// pool spawns normally. Found by the Gate 4 live-z2 run.
//
// Stock Semaphore v4 only — no circuit modification, no custom scheme.
// Artifacts arrive as paths that lib/zk/artifacts.ts has already
// hash-verified against the build pins.
//
// VERIFICATION USES THE PINNED FILE, NOT THE LIBRARY'S INLINED COPY
// (attack-2 finding 2): this process reads the vkey file it is told about,
// hashes those exact bytes against the pin it is handed, refuses on a
// mismatch, slices the per-depth key from the same bytes, computes the
// public signals exactly as @semaphore-protocol/proof does
// ([root, nullifier, hash(message), hash(scope)], hash = keccak256 >> 8)
// and calls snarkjs.groth16.verify directly. verifyProof() from the
// library is not called anywhere.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { keccak_256 } from "@noble/hashes/sha3";

// the CJS builds — one build family, the same one the validator uses
const require = createRequire(import.meta.url);
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const { generateProof, unpackGroth16Proof } = require("@semaphore-protocol/proof");
const snarkjs = require("snarkjs");

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const CANONICAL = /^(0|[1-9][0-9]{0,76})$/;
const isField = (s) => typeof s === "string" && CANONICAL.test(s) && BigInt(s) < FIELD;

function toBeBytes32(x) {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}
/** @semaphore-protocol/proof's hash(): BigInt(keccak256(toBeHex(x, 32))) >> 8n */
function semaphoreHash(x) {
  const h = keccak_256(toBeBytes32(x));
  let v = 0n;
  for (const b of h) v = (v << 8n) | BigInt(b);
  return v >> 8n;
}

function loadPinnedVkey(file, expectedSha256, expectedBytes, depth) {
  const buf = readFileSync(file);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== expectedSha256 || buf.length !== expectedBytes) throw new Error("verification key file is NOT the build pin — refusing to verify");
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

async function main(d) {
  if (d.op === "prove") {
    const identity = new Identity(Buffer.from(String(d.privateKeyHex), "hex"));
    const group = new Group((d.members || []).map((m) => BigInt(m)));
    if (group.indexOf(identity.commitment) === -1) throw new Error("commitment is not a member of the supplied tree");
    const t0 = performance.now();
    const proof = await generateProof(identity, group, BigInt(d.message), BigInt(d.scope), Number(d.depth), {
      wasm: String(d.wasm),
      zkey: String(d.zkey),
    });
    const ms = performance.now() - t0;
    return {
      proof: {
        merkleTreeDepth: proof.merkleTreeDepth,
        merkleTreeRoot: String(proof.merkleTreeRoot),
        nullifier: String(proof.nullifier),
        message: String(proof.message),
        scope: String(proof.scope),
        points: proof.points.map(String),
      },
      ms,
    };
  }
  if (d.op === "verify") {
    const p = d.proof;
    const depth = Number(p.merkleTreeDepth);
    if (!Number.isInteger(depth) || depth !== Number(d.depth)) throw new Error("depth is not the pinned depth");
    for (const k of ["merkleTreeRoot", "nullifier", "message", "scope"]) {
      if (!isField(p[k])) throw new Error(`${k} is not a canonical field element`);
    }
    if (!Array.isArray(p.points) || p.points.length !== 8 || !p.points.every((x) => typeof x === "string" && /^[0-9]{1,78}$/.test(x))) {
      throw new Error("malformed proof points");
    }
    const vk = loadPinnedVkey(String(d.vkeyPath), String(d.vkeySha256), Number(d.vkeyBytes), depth);
    const t0 = performance.now();
    const signals = [p.merkleTreeRoot, p.nullifier, semaphoreHash(BigInt(p.message)).toString(10), semaphoreHash(BigInt(p.scope)).toString(10)];
    const valid = await snarkjs.groth16.verify(vk, signals, unpackGroth16Proof(p.points));
    return { valid: valid === true, ms: performance.now() - t0 };
  }
  throw new Error("unknown op");
}

if (typeof process.send !== "function") {
  process.stderr.write("semaphore-worker: this prover runs as a forked child of lib/zk/transport/live.ts (one job over IPC)\n");
  process.exit(2);
}
process.once("message", (d) => {
  main(d || {})
    .then((result) => process.send({ ok: true, result }, () => process.exit(0)))
    .catch((e) => process.send({ ok: false, error: e && e.message ? e.message : String(e) }, () => process.exit(0)));
});
