// MULTI-FID PASS Gate 1 — the SIGNER CUSTODY seam. A persona's Farcaster
// signer is an Ed25519 key DERIVED from the root (kdf: fc-signer/<nonce>),
// so recovery re-derives it; WHO holds a key the network accepts for the
// persona's fid is the custody question this adapter answers:
//
//   neynar-managed  Neynar holds a managed signer for the fid and signs on
//                   request. DOCUMENTED COMPROMISE (SECURITY-POSTURE.md,
//                   Network identities): Neynar can post as any persona —
//                   they already operate the protocol. Our derived key is
//                   registered as the persona's OWN signer where the API
//                   allows, so the compromise is "Neynar too", never
//                   "Neynar instead".
//   self-custody    the derived signer is added through the KeyGateway by
//                   the fid's custody address; no third party can sign.
//                   PERSONA LAUNCH P6: a launched account's signer (added by the
//                   simulated registrar's Bundler call) is this kind.
//                   Fixture + spec in this pass; live is Call Option A (a
//                   chain transaction this build never sends).
//
// Fixture in sweeps; the live provisioning of a real fid is the user's
// command (scripts/fid-acquire.mjs), never a sweep's.

export type CustodyKind = "neynar-managed" | "self-custody";

export type SignerRef =
  | {
      kind: "neynar-managed";
      /** Neynar's managed signer handle — a SECRET: vault only, never the plain map, never a log */
      uuid: string;
      /** the persona's own derived signer public key (64 hex) */
      derivedPubHex: string;
      /** true when the derived key was also registered on the fid (the API allowed it) */
      derivedRegistered: boolean;
    }
  | {
      kind: "self-custody";
      derivedPubHex: string;
      /** true once the KeyGateway add landed (fixture: simulated) */
      registered: boolean;
      simulated: boolean;
    };

export interface ProvisionInput {
  personaId: string;
  fid: number;
  derivedPubHex: string;
  mode: "fixture" | "live";
}

export interface SignerCustodyAdapter {
  readonly kind: CustodyKind;
  /** one-line statement of what the custodian can do — quoted by the posture doc */
  readonly compromise: string;
  /** make a signer for this persona usable on its fid; fixture simulates, live provisions for real */
  provision(input: ProvisionInput): Promise<SignerRef>;
}
