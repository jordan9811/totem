// ZK PASS 1 — BENCH HARNESS (LIVE). Measures cold/warm proving + verify
// time on THIS host with the real stock Semaphore v4 prover and emits a
// JSON report. NEVER run in sweeps (it downloads artifacts and burns CPU).
//
//   npm run bench:zk            → shots/zk-bench.json + a summary line
//
// Mobile is reported as UNMEASURED-EXTRAPOLATED unless a real-device run
// is pasted into the report by a human — this script cannot measure a
// phone, and says so.
//
// Also a free live cross-check of the nullifier formula (F10): the
// circuit's nullifier must equal Poseidon(hash(scope), secret).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite";
import { keccak_256 } from "@noble/hashes/sha3";

const N = Number(process.argv[2] ?? 5);
const DEPTH = 20;
const rec = JSON.parse(readFileSync("research/zk-ceremony-verification.json", "utf8"));
const pins = rec.artifactsShipped;
const dir = process.env.ZK_ARTIFACT_DIR || ".zk-artifacts";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const toHex = (b) => Buffer.from(b).toString("hex");
const toBeBytes32 = (x) => { const out = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; } return out; };
const semaphoreHash = (x) => BigInt("0x" + toHex(keccak_256(toBeBytes32(x)))) >> 8n;

async function ensure(pin) {
  const file = path.join(dir, pin.file);
  let downloaded = false;
  if (!existsSync(file)) {
    const res = await fetch(pins.downloadBaseUrl + pin.file);
    if (!res.ok) throw new Error(`download ${pin.file}: HTTP ${res.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    downloaded = true;
  }
  const buf = readFileSync(file);
  if (buf.length !== pin.bytes || sha(buf) !== pin.sha256) throw new Error(`${pin.file} does not match its pin — REFUSED`);
  return { file, downloaded };
}

console.log(`machine: ${os.cpus()[0].model} / ${os.cpus().length} threads / node ${process.version}`);
const vkeyOnDisk = sha(readFileSync("node_modules/@semaphore-protocol/proof/src/verification-keys.json"));
if (vkeyOnDisk !== pins.verificationKeyBundle.sha256) throw new Error("bundled vkey != pin — REFUSED");
const t0 = performance.now();
const wasm = await ensure(pins.wasm);
const zkey = await ensure(pins.zkey);
const artifactMs = performance.now() - t0;
console.log(`artifacts: ${wasm.downloaded || zkey.downloaded ? "downloaded" : "cached"} + hash-verified in ${artifactMs.toFixed(0)} ms`);

const identity = new Identity("layers-bench-identity");
const members = [];
for (let i = 0; i < 512; i++) members.push(new Identity("bench-m" + i).commitment);
members.push(identity.commitment);
const group = new Group(members);
const scope = 123456789n;
const message = 987654321n;

const times = [];
let verifyMs = 0;
let proofBytes = 0;
let nullifierOk = false;
for (let i = 0; i <= N; i++) {
  const a = performance.now();
  const proof = await generateProof(identity, group, message, scope, DEPTH, { wasm: wasm.file, zkey: zkey.file });
  times.push(performance.now() - a);
  if (i === 0) {
    proofBytes = Buffer.byteLength(JSON.stringify(proof.points));
    const v0 = performance.now();
    const okv = await verifyProof(proof);
    verifyMs = performance.now() - v0;
    if (!okv) throw new Error("the real proof did not verify");
    nullifierOk = String(proof.nullifier) === poseidon2([semaphoreHash(scope), identity.secretScalar]).toString(10);
    if (!nullifierOk) throw new Error("F10: circuit nullifier != Poseidon(hash(scope), secret)");
    console.log(`cold (incl. artifact load): ${times[0].toFixed(0)} ms | verify ${verifyMs.toFixed(0)} ms | proof ${proofBytes} B | nullifier formula: OK`);
  } else {
    console.log(`warm run ${i}: ${times[i].toFixed(0)} ms`);
  }
}
const warm = times.slice(1).sort((x, y) => x - y);
const median = warm.length ? warm[Math.floor(warm.length / 2)] : null;
const report = {
  at: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, threads: os.cpus().length, node: process.version, platform: process.platform },
  depth: DEPTH,
  groupSize: members.length,
  artifacts: { wasm: pins.wasm.sha256, zkey: pins.zkey.sha256, verified: true, downloaded: wasm.downloaded || zkey.downloaded, loadMs: Math.round(artifactMs) },
  coldMs: Math.round(times[0]),
  warmMs: warm.map((x) => Math.round(x)),
  warmMedianMs: median === null ? null : Math.round(median),
  verifyMs: Math.round(verifyMs),
  proofPointsBytes: proofBytes,
  nullifierFormulaVerified: nullifierOk,
  mobile: "UNMEASURED-EXTRAPOLATED — research/browser-perf-realist.md: ~0.9s flagship phone measured in the PoC, ~3–8s mid-range Android EXTRAPOLATED; no real device run recorded by this harness",
};
mkdirSync("shots", { recursive: true });
writeFileSync("shots/zk-bench.json", JSON.stringify(report, null, 2));
console.log(`warm median: ${report.warmMedianMs} ms over ${warm.length} runs → shots/zk-bench.json`);
// snarkjs's thread pool keeps the event loop alive after the work is done
// (the research PoC needed this too) — exit explicitly, the report is written.
process.exit(0);
