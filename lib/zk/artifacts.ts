import "server-only";
// ZK PASS 1 — hash-verified artifact cache for the LIVE prover.
//
// @zk-kit/artifacts downloads wasm/zkey into the OS temp dir with no
// integrity check. We do not use that path. Artifacts are fetched from the
// same host into ZK_ARTIFACT_DIR, hashed, and REFUSED unless both sha256
// and blake2b-512 match the build pins (lib/zk/ceremony.ts). A cached file
// is re-hashed on every load — a tampered cache is the same as a tampered
// download. Used ONLY by the live transport (live-z* scripts / bench),
// never by sweeps.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ZK_ARTIFACT_DIR } from "./config";
import { SEMAPHORE_ARTIFACT_BASE, blake2b512Hex, pinsForDepth, sha256Hex, type ArtifactPin } from "./ceremony";

export interface VerifiedArtifacts {
  wasm: string;
  zkey: string;
  depth: number;
  verified: { wasm: ArtifactPin; zkey: ArtifactPin };
  /** true if at least one file was fetched from the network this call */
  downloaded: boolean;
}

function artifactDir(): string {
  return path.isAbsolute(ZK_ARTIFACT_DIR) ? ZK_ARTIFACT_DIR : path.join(process.cwd(), ZK_ARTIFACT_DIR);
}

function verifyFile(file: string, pin: ArtifactPin): void {
  const buf = readFileSync(file);
  if (buf.length !== pin.bytes) {
    throw new Error(`zk artifacts: ${pin.file} is ${buf.length} bytes, pin says ${pin.bytes} — REFUSED`);
  }
  const sha = sha256Hex(buf);
  if (sha !== pin.sha256) {
    throw new Error(`zk artifacts: ${pin.file} sha256 ${sha} != pinned ${pin.sha256} — REFUSED (artifact host serves no checksums; ours is the only integrity check)`);
  }
  const b2 = blake2b512Hex(buf);
  if (b2 !== pin.blake2b512) {
    throw new Error(`zk artifacts: ${pin.file} blake2b-512 mismatch — REFUSED`);
  }
}

async function download(pin: ArtifactPin, dest: string): Promise<void> {
  const url = SEMAPHORE_ARTIFACT_BASE + pin.file;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`zk artifacts: download of ${url} failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + ".tmp";
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
}

/**
 * Ensure the pinned artifacts for `depth` exist locally and verify. Every
 * exit path either returns verified files or throws — there is no
 * "use unverified" branch.
 */
export async function ensureArtifacts(depth?: number): Promise<VerifiedArtifacts> {
  const pins = pinsForDepth(depth);
  const dir = artifactDir();
  const wasm = path.join(dir, pins.wasm.file);
  const zkey = path.join(dir, pins.zkey.file);
  let downloaded = false;
  for (const [file, pin] of [
    [wasm, pins.wasm],
    [zkey, pins.zkey],
  ] as const) {
    if (!existsSync(file)) {
      await download(pin, file);
      downloaded = true;
    }
    verifyFile(file, pin); // re-hashed on every load, cached or not
  }
  return { wasm, zkey, depth: depth ?? 20, verified: pins, downloaded };
}

/** Hash-check WITHOUT downloading (for suites: "the cache, if present, is
 * the pinned bytes"). Returns null when no cache exists. */
export function checkCachedArtifacts(depth?: number): { wasm: boolean; zkey: boolean } | null {
  const pins = pinsForDepth(depth);
  const dir = artifactDir();
  const wasm = path.join(dir, pins.wasm.file);
  const zkey = path.join(dir, pins.zkey.file);
  if (!existsSync(wasm) && !existsSync(zkey)) return null;
  const check = (file: string, pin: ArtifactPin) => {
    try {
      verifyFile(file, pin);
      return true;
    } catch {
      return false;
    }
  };
  return { wasm: existsSync(wasm) && check(wasm, pins.wasm), zkey: existsSync(zkey) && check(zkey, pins.zkey) };
}
