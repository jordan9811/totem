// PERSONA LAUNCH P7 — THE CEREMONY PINS AS PLAIN DATA (moved here from lib/zk/ceremony.ts, which re-exports them).
//
// Why a separate module: the browser's Web Worker prover (lib/zk/prover/browser-worker.ts → public/device/prover.js)
// must check the proving artifacts and the verification key against the SAME pins the node prover and the validator
// use, and it cannot import ceremony.ts (node:fs, node:path, the platform crypto layer). This file has no imports at
// all, so every host reads one copy of the numbers. The pins are unchanged; their provenance is ceremony.ts's header
// and research/zk-ceremony-verification.json.
//
// What the worker trusts: THESE values, bundled into prover.js at build. Never the pins in the served
// public/device/zk/manifest.json (informational only), never a hash the artifact host serves (it serves none).

export const SEMAPHORE_ARTIFACT_VERSION = "4.13.0";
export const SEMAPHORE_ARTIFACT_BASE = `https://snark-artifacts.pse.dev/semaphore/${SEMAPHORE_ARTIFACT_VERSION}/`;

export interface ArtifactPin {
  file: string;
  bytes: number;
  sha256: string;
  blake2b512: string;
}

/** The ONE depth we ship. A second depth is a second ceremony transcript
 * to verify and a second pair of pins — added deliberately, never by
 * letting the library infer a depth from a group. */
export const ARTIFACT_PINS: Readonly<Record<number, { wasm: ArtifactPin; zkey: ArtifactPin }>> = Object.freeze({
  20: {
    wasm: {
      file: "semaphore-20.wasm",
      bytes: 1847949,
      sha256: "6f71e55586929e520e76027ebe067daac8b41e2f4b8057313a5fd0304e1e44ee",
      blake2b512:
        "c6b5e351c3d00c816407dabe3950e14a7628f5649a31f0a367391151a913f49451885447959ddf2182cf263af367ef1bdc1efde3fb99c90f49e040da4091d094",
    },
    zkey: {
      file: "semaphore-20.zkey",
      bytes: 3890175,
      sha256: "33f9a067a80c7daf90e085449073613a9559a1904dd40aeb6d603afb7988c2cc",
      blake2b512:
        "456ed7884aac44c3357ace20172104464f073a05eee623a3c8c6ecacc478fda241a4a99f34243f1ad73474420b0c304b0919e4ad6a1e0653fc3d7af95f26869a",
    },
  },
});

/**
 * The per-depth verification-key file, pinned — AND THE ONLY KEY ANY
 * VERIFIER USES. attack-2 finding 2: @semaphore-protocol/proof's
 * verifyProof() verifies against a copy of this key INLINED in its dist
 * bundle, which no pin covered. Neither verifier calls verifyProof() any
 * more: the worker (client side) and validator/zk.js both read THIS file,
 * hash the bytes they just read, refuse on a mismatch, and hand the parsed
 * key to snarkjs.groth16.verify directly. The pin therefore covers the
 * bytes that are used, not a sibling file.
 */
export const VKEY_PIN = Object.freeze({
  file: "@semaphore-protocol/proof/src/verification-keys.json",
  bytes: 57550,
  sha256: "d96ec60593b6fc2334f1f04e008e07425d5536d7777f6ac21d996fc80779b3c9",
});

export const CEREMONY = Object.freeze({
  name: "Semaphore Binary Merkle Root Fix",
  finalized: "2025-07-23",
  page: "https://ceremony.pse.dev/projects/Semaphore%20Binary%20Merkle%20Root%20Fix",
  circuitCommit: "3521c96b5a766f65f46ee33fe87917513d67c0cf",
  contributionsDepth20: 386,
  coordinator: "mpc-dev-121107909",
  beaconHash: "633881ca07fc1183e7d23ea58c7250bd699a71d783f545378a8474261ee134f7",
  finalContributionHashDepth20:
    "1e6f9a1eea7bb35a59e255bcfb0abb83b9b70e7eaa9b786c0193d5f89d42b86366c82cd2433abe29f2563f2c8d17f1bba78de86e53a9229e33872ba17dbd446f",
});

/** the ONE depth the pins above cover — equal to lib/zk/config.ts MERKLE_TREE_DEPTH (scripts/unit-prover.mjs pins the
 *  two together; the browser prover cannot import config.ts) */
export const PINNED_DEPTH = 20;
