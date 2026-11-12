import "server-only";
// MULTI-FID PASS Gate 1 — neynar-managed custody. Fixture: a simulated
// managed signer per fid (the sim transport accepts it). Live: provisioning
// a managed signer is part of the user's acquisition command (it creates
// the fid in the same flow); this module never calls Neynar on its own —
// a sweep can never provision, and the app never spends.
import type { ProvisionInput, SignerCustodyAdapter, SignerRef } from "./types";

export const neynarManaged: SignerCustodyAdapter = {
  kind: "neynar-managed",
  compromise:
    "Neynar holds a managed signer for the persona's fid and can post as the persona (they already operate the protocol); the derived key is registered as the persona's own signer where the API allows, so the compromise is 'Neynar too', never 'Neynar instead'",
  async provision(input: ProvisionInput): Promise<SignerRef> {
    if (input.mode !== "fixture") {
      throw new Error("neynar-managed live provisioning happens only in the user's acquisition command (scripts/fid-acquire.mjs), never in the app");
    }
    return { kind: "neynar-managed", uuid: `sim-signer-${input.fid}`, derivedPubHex: input.derivedPubHex, derivedRegistered: false };
  },
};
