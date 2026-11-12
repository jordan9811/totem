import "server-only";
// MULTI-FID PASS Gate 1 — which custody adapter provisions persona signers.
// FC_SIGNER_CUSTODY = neynar-managed (default) | self-custody; the rig may
// override at runtime; resetSeed restores the env/default.
import { neynarManaged } from "./neynarManaged";
import { selfCustody } from "./selfCustody";
import type { CustodyKind, SignerCustodyAdapter } from "./types";

const g = globalThis as unknown as { __layersCustodyOverride?: CustodyKind | null };

export function setCustodyOverride(kind: CustodyKind | null): void {
  g.__layersCustodyOverride = kind;
}

export function custodyKind(): CustodyKind {
  const o = g.__layersCustodyOverride;
  if (o) return o;
  return process.env.FC_SIGNER_CUSTODY === "self-custody" ? "self-custody" : "neynar-managed";
}

export function custody(): SignerCustodyAdapter {
  return custodyKind() === "self-custody" ? selfCustody : neynarManaged;
}
