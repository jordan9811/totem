import "server-only";
// MULTI-FID PASS Gate 1 — self-custody. SPEC: the persona's derived signer
// key is added on the fid through the KeyGateway (`add(keyType=1, key,
// metadataType=1, metadata=SignedKeyRequestMetadata)`) by the fid's
// CUSTODY address — which this build derives per persona from the root
// (kdf: fc-custody/<nonce>), so recovery re-derives it and no third party
// ever holds a key the network accepts. The add is an Optimism transaction
// (gas, paid by the custody address): Call Option A, live, is a
// user-run command; this build never sends chain transactions. Fixture:
// the add is simulated and flagged as such.
//
// PERSONA LAUNCH P6: a LAUNCHED account (origin "layers-launch") is self-custody from birth — its signer is added by the
// (simulated) Totem registrar's Bundler call together with the registration, from the persona's own custody signatures
// (lib/launch/request.ts, validator/simchain.js), so its record is written by lib/launch/tick.ts with this SignerRef
// kind ({ kind: "self-custody", registered: true, simulated: true }) without going through provision() below.
import type { ProvisionInput, SignerCustodyAdapter, SignerRef } from "./types";

export const selfCustody: SignerCustodyAdapter = {
  kind: "self-custody",
  compromise: "no third party holds a signer the network accepts for the persona; the custody address (derived from the root) is the only key that can add or remove signers",
  async provision(input: ProvisionInput): Promise<SignerRef> {
    if (input.mode !== "fixture") {
      throw new Error("self-custody live is Call Option A: a KeyGateway add from the fid's custody address — a chain transaction this build does not send");
    }
    return { kind: "self-custody", derivedPubHex: input.derivedPubHex, registered: true, simulated: true };
  },
};
