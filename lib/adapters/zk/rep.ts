import "server-only";
// ZK PASS 1 Gate 2 — the PROOF-MEDIATED RepAdapter.
//
// `tierFor(personaId)` returns what the persona can currently PROVE: the
// tier recorded by the validator when an anonymous-channel proof of
// membership in `zkTier[T]` was verified for this persona this epoch (or
// the one-epoch grace). It NEVER performs a root-side lookup — there is no
// root id in this file, no `/rep/` call, no `tierForRoot`. A persona with
// no proof is tier 0, whatever its root's reputation is: that is the whole
// point, and the suite checks it both statically (grep) and behaviourally.
//
// Blocks and the explainer are not reputation facts; they delegate to the
// existing adapter unchanged.
import type { RepAdapter } from "../types";
import { zkMode } from "@/lib/zk/config";
import { fetchEligibility } from "@/lib/zk/validatorClient";

export function makeZkRepAdapter(delegate: RepAdapter): RepAdapter {
  return {
    async tierFor(personaId) {
      const e = await fetchEligibility(zkMode(), personaId, "foryou");
      return e ? e.tier : 0;
    },
    blockedFor: (personaId) => delegate.blockedFor(personaId),
    block: (a, b) => delegate.block(a, b),
    tierExplainer: (tier) => delegate.tierExplainer(tier),
  };
}
