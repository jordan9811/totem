import "server-only";
// ZK PASS 1 — transport selection. Fixture is the default universe; live
// is loaded LAZILY so a fixture-mode server never pulls the live module
// (and the worker path that carries snarkjs) into its process. Sweeps run
// fixture; only live-z* scripts request live.
//
// PERSONA LAUNCH P7: in the BROWSER DEVICE (the public preview's tab) both universes prove in a Web Worker
// (./browser.ts → public/device/prover.js), so every production-shaped run exercises the path strangers' tabs run.
// It is imported lazily too: the Next server bundle never loads it, and the device bundle carries only its small
// bridge — snarkjs lives in prover.js alone. A server-side device keeps the node transports, unchanged.
import type { ZkMode } from "../config";
import { fixtureTransport } from "./fixture";
import type { ZkTransport } from "./types";

export async function transportFor(mode: ZkMode): Promise<ZkTransport> {
  if (typeof window !== "undefined") {
    const { browserTransport } = await import("./browser");
    return browserTransport(mode);
  }
  if (mode === "live") {
    const { liveTransport } = await import("./live");
    return liveTransport;
  }
  return fixtureTransport;
}
