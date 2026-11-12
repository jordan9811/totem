import "server-only";
// PERSONA LAUNCH P6 — which chain reader answers for a universe. Fixture: the validator's simulated chain. Live: REFUSED
// (F25 — the live KeyRegistry read is not built; VERIFY-YOURSELF before any live launch). A refusal is a throw, so every
// caller fails closed (a reveal it cannot check renders as plain anon).
import { fixtureChain } from "./fixture";
import type { ChainSource } from "./types";

export class LiveChainUnavailableError extends Error {
  readonly code = "F25";
}

export function chainSource(mode: "fixture" | "live"): ChainSource {
  if (mode === "fixture") return fixtureChain;
  throw new LiveChainUnavailableError("the live Farcaster key registry is not read in this build (F25) — a claim it cannot check is shown as plain anon");
}
