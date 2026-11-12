import "server-only";
import { withMockLatency } from "../mockUtils";
import { AdapterError, type AttestationAdapter, type AttestationIssuer } from "../types";
import { state  } from "./store";

const ISSUERS: AttestationIssuer[] = [
  {
    id: "issuer_human",
    name: "Proof of Human",
    description: "Liveness attestation from an independent verifier. Confirms a real person, reveals nothing else.",
    tierBonus: 1,
  },
  {
    id: "issuer_camera",
    name: "Camera Hardware Certificate",
    description: "Device-signed capture provenance. Photos you post can carry an unedited-at-capture attestation.",
    tierBonus: 1,
  },
  {
    id: "issuer_professional",
    name: "Professional Credential",
    description: "Verifiable credential from an issuing body. Proves a qualification without exposing the underlying record.",
    tierBonus: 2,
  },
];

export const mockAttestationAdapter: AttestationAdapter = {
  async listIssuers() {
    return withMockLatency(() => ISSUERS, { label: "attestation.listIssuers" });
  },

  async listConnections(personaId) {
    return withMockLatency(
      () => state().attestations.filter((a) => a.personaId === personaId),
      { label: "attestation.listConnections" }
    );
  },

  async connect(personaId, issuerId) {
    return withMockLatency(() => {
      if (!ISSUERS.some((i) => i.id === issuerId)) throw new AdapterError("unknown issuer", "NOT_FOUND");
      const s = state();
      const existing = s.attestations.find((a) => a.personaId === personaId && a.issuerId === issuerId);
      if (existing) return existing;
      const conn = { issuerId, personaId, connectedAt: Date.now() };
      s.attestations.push(conn);
      return conn;
    }, { label: "attestation.connect" });
  },
};

export { ISSUERS as MOCK_ISSUERS };
