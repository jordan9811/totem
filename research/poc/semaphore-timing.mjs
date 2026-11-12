// PoC timing: Semaphore v4 (Groth16 via snarkjs WASM) in Node.
// PROXY for browser WASM: same snarkjs wasm witness gen + JS/WASM prover code path
// as in-browser; Node lacks browser jank but same single-machine WASM execution.
// Measures: cold run (includes artifact download), warm runs, verify time, proof size.
// Machine: recorded at runtime below. NOT wired into the app; research/poc only.
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";
import os from "node:os";

const DEPTH = 20; // Merkle depth ~20: the Semaphore-class target in the research brief
const N = Number(process.argv[2] ?? 5);

console.log(`machine: ${os.cpus()[0].model} / ${os.cpus().length} threads / node ${process.version}`);

const identity = new Identity();
const members = [];
for (let i = 0; i < 512; i++) members.push(new Identity(`m${i}`).commitment);
members.push(identity.commitment);
const group = new Group(members);

const scope = "layers-poc-scope";
const message = "layers-poc-message";

const times = [];
for (let i = 0; i <= N; i++) {
  const t0 = performance.now();
  const proof = await generateProof(identity, group, message, scope, DEPTH);
  const t1 = performance.now();
  const ms = t1 - t0;
  times.push(ms);
  if (i === 0) {
    console.log(`cold (incl. artifact fetch/load): ${ms.toFixed(0)} ms`);
    const bytes = Buffer.byteLength(JSON.stringify(proof.points));
    console.log(`proof points JSON size: ${bytes} bytes; merkleTreeDepth=${proof.merkleTreeDepth}`);
    const v0 = performance.now();
    const ok = await verifyProof(proof);
    console.log(`verify: ${(performance.now() - v0).toFixed(0)} ms, valid=${ok}`);
  } else {
    console.log(`warm run ${i}: ${ms.toFixed(0)} ms`);
  }
}
const warm = times.slice(1);
if (warm.length) {
  warm.sort((a, b) => a - b);
  console.log(`warm median: ${warm[Math.floor(warm.length / 2)].toFixed(0)} ms over ${warm.length} runs`);
}
process.exit(0);
