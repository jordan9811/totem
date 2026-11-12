import "server-only";
import { withMockLatency } from "../mockUtils";
import { AdapterError, SENSITIVE_CATEGORIES } from "../types";
import type {
  ClaimCategory,
  ClaimMethod,
  GraphAdapter,
  GraphClaim,
  ImportConnector,
  ImportJob,
  ImportPreviewItem,
} from "../types";
import graphRaw from "@/seed/data/graph.json";
import { nextId, state } from "./store";
import { bank } from "@/lib/world";

export const CLAIM_CATALOGUE = graphRaw.catalogue as Record<string, { label: string; value: string }[]>;
export const CONNECTORS = graphRaw.connectors as (ImportConnector & {
  yields: { category: ClaimCategory; label: string; value: string }[];
})[];
// LAYERS_WORLD=empty (lib/world.ts): the catalogue and connectors above are PRODUCT taxonomy and stay; the seeded
// viewer's claims are demo content
const SEED_CLAIMS = bank(graphRaw.viewerClaims as GraphClaim[], []);

export function isSensitive(category: ClaimCategory): boolean {
  return SENSITIVE_CATEGORIES.includes(category);
}

/** Seed claims are the baseline; mutable state overlays and extends them. */
function allClaims(personaId: string): GraphClaim[] {
  const s = state();
  const merged = new Map<string, GraphClaim>();
  for (const c of SEED_CLAIMS) if (c.personaId === personaId) merged.set(c.id, c);
  // an "att_" entry is a TOGGLE OVERRIDE for a vault-derived attested claim
  // (attestedClaimsFor below), never a claim of its own
  for (const [id, c] of s.graphClaims) if (c.personaId === personaId && !id.startsWith("att_")) merged.set(id, c);
  return [...merged.values()];
}

const consentKey = (personaId: string, category: ClaimCategory) => `${personaId}:${category}`;

/** The method a connector's claims carry — explicit, else "platform-export"
 * (a plain data import). */
function connectorMethod(connector: (typeof CONNECTORS)[number]): ClaimMethod {
  return connector.method ?? "platform-export";
}

/** Exactly what an import WOULD write, one line per yield, with sensitive-
 * without-consent items marked `withheld` (shown, never written). preview
 * and commit both derive from this, so the preview provably matches what
 * lands. */
function previewItemsFor(
  connector: (typeof CONNECTORS)[number],
  personaId: string,
  s: ReturnType<typeof state>
): ImportPreviewItem[] {
  const source = connector.trustSource ?? "attested";
  const method = connectorMethod(connector);
  return connector.yields.map((y) => {
    const sensitive = isSensitive(y.category);
    const withheld = sensitive && s.graphConsent.get(consentKey(personaId, y.category)) !== true;
    return {
      category: y.category,
      label: y.label,
      value: y.value,
      source,
      method,
      issuer: connector.issuer,
      sensitive,
      withheld,
    };
  });
}

// ATTESTATION PASS Gate 2: the backpack shows this ROOT's onchain attestations
// (vault-held, issuer-signed, bucketed) as attested-tier claims with issuer
// provenance — for the root's OWN personas only, synthesized at read time
// from the vault (never written into the claim store: the vault is the
// source of truth and a revocation or expiry must not leave a stale claim).
const ATTEST_CATEGORY: Record<string, { category: ClaimCategory; label: string }> = {
  "onchain.wallet-age": { category: "ownership", label: "Wallet age (onchain)" },
  "onchain.holdings": { category: "finances", label: "ETH holdings (onchain, coarse)" },
  "onchain.protocol-history": { category: "habits", label: "DeFi protocol used (onchain)" },
  "onchain.governance": { category: "habits", label: "Governance votes (onchain)" },
  // MULTI-FID Gate 0
  "x.account-region": { category: "demographics", label: "Based in (X, coarse region)" },
  "x.account-age": { category: "ownership", label: "X account age, username never changed" },
  "neynar.score": { category: "ownership", label: "Neynar user score (coarse)" },
};
async function attestedClaimsFor(personaId: string): Promise<GraphClaim[]> {
  try {
    const { isOwnPersona } = await import("@/lib/identity/keystore");
    const { SEED_VIEWER } = await import("./store");
    if (!isOwnPersona(personaId) && !SEED_VIEWER.personas.includes(personaId)) return [];
    const { myAttestations } = await import("@/lib/attest/vault");
    const { isHonoredIssuer } = await import("@/lib/attest/subscriber");
    const s = state();
    const out: GraphClaim[] = [];
    const slug = (x: string) => x.replace(/[^a-z0-9]/gi, "_");
    for (const a of await myAttestations()) {
      const map = ATTEST_CATEGORY[a.issuerId];
      if (!map || !isHonoredIssuer(a.issuerId, a.issuerPubkey)) continue;
      // per PERSONA — the narrower scope: a root may show an attestation on
      // one persona and hide it on another
      const id = `att_${slug(personaId)}_${slug(a.issuerId)}_${slug(a.bucket)}`;
      // a sensitive category is DEFAULT-OFF like every other claim in it:
      // active only under this persona's explicit consent (a signed claim is
      // not a consent), and the owner's own toggle (setClaimActive) on top
      const consented = !isSensitive(map.category) || s.graphConsent.get(consentKey(personaId, map.category)) === true;
      const toggle = s.graphClaims.get(id);
      out.push({
        id,
        personaId,
        category: map.category,
        label: map.label,
        value: a.bucket,
        source: "attested",
        method: "zk-attestation",
        issuer: a.issuerId,
        // recorded at issuance, inside the sealed record; an older record
        // without it renders as unknown rather than as a made-up time
        issuedAt: typeof a.issuedAt === "number" ? a.issuedAt : null,
        active: consented && (toggle ? toggle.active : true),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export const mockGraphAdapter: GraphAdapter = {
  async listClaims(personaId) {
    const attested = await attestedClaimsFor(personaId);
    return withMockLatency(() => [...allClaims(personaId), ...attested], { label: "graph.listClaims" });
  },

  // FAIL CLOSED. Sensitive claims are included ONLY when their category's
  // consent is readable AND true. If the consent lookup throws, sensitive
  // claims are omitted and the caller is told so via sensitiveIncluded=false
  // — standard claims still render, so a graph read error degrades the
  // matching surface instead of breaking it.
  async claimsForMatching(personaId) {
    // Attestation pass Gate 3: the root's honoured onchain attestations count
    // exactly as they match — attested tier, consent-gated for sensitive
    // categories below like every other claim
    const attested = await attestedClaimsFor(personaId);
    return withMockLatency(() => {
      const active = [...allClaims(personaId), ...attested].filter((c) => c.active);
      // A claim can be held both self-declared and attested (e.g. you say you
      // buy coffee weekly, then a card import proves it). Collapse to one
      // entry per value, preferring the attested version — showing both is
      // just duplicate UI, and the attested one carries strictly more info.
      const byValue = new Map<string, GraphClaim>();
      for (const c of active) {
        const existing = byValue.get(c.value);
        if (!existing || (existing.source === "self" && c.source === "attested")) {
          byValue.set(c.value, c);
        }
      }
      const claims = [...byValue.values()];
      const standard = claims.filter((c) => !isSensitive(c.category));
      let sensitive: GraphClaim[] = [];
      let sensitiveIncluded = false;
      try {
        const s = state();
        sensitive = claims.filter((c) => {
          if (!isSensitive(c.category)) return false;
          const consented = s.graphConsent.get(consentKey(personaId, c.category));
          if (consented === undefined) return false; // never consented => excluded
          return consented === true;
        });
        sensitiveIncluded = true;
      } catch {
        sensitive = [];
        sensitiveIncluded = false;
      }
      return { claims: [...standard, ...sensitive], sensitiveIncluded };
    }, { label: "graph.claimsForMatching" });
  },

  async addClaim(personaId, category, label, value, source = "self") {
    return withMockLatency(() => {
      // A sensitive claim cannot be created without prior explicit consent.
      if (isSensitive(category) && state().graphConsent.get(consentKey(personaId, category)) !== true) {
        throw new AdapterError("sensitive category requires explicit consent first", "FORBIDDEN");
      }
      const claim: GraphClaim = {
        id: nextId("claim"),
        personaId,
        category,
        label,
        value,
        source,
        // provenance method: a self-declared claim was declared; an
        // x-inferred addClaim comes from the X archive importer.
        method: source === "x-inferred" ? "x-archive" : "self-declared",
        issuer: null,
        issuedAt: source === "self" ? null : Date.now(),
        active: true,
      };
      state().graphClaims.set(claim.id, claim);
      return claim;
    }, { label: "graph.addClaim" });
  },

  async setClaimActive(claimId, active, personaId) {
    // a vault-derived attested claim (att_…) has no row of its own: the
    // toggle is stored as an override under its id and honoured by
    // attestedClaimsFor — off hides it from matching for THIS persona; the
    // issuance itself is untouched (revocation is the issuer's)
    const attested =
      claimId.startsWith("att_") && personaId ? (await attestedClaimsFor(personaId)).find((c) => c.id === claimId) : undefined;
    return withMockLatency(() => {
      const s = state();
      const existing = attested ?? s.graphClaims.get(claimId) ?? SEED_CLAIMS.find((c) => c.id === claimId);
      if (!existing) throw new AdapterError("unknown claim", "NOT_FOUND");
      // an attested claim in a sensitive category cannot be toggled ON past
      // the category's consent (default-off is the category's rule, not the toggle's)
      const consented =
        !attested || !isSensitive(existing.category) || s.graphConsent.get(consentKey(existing.personaId, existing.category)) === true;
      const updated = { ...existing, active: active && consented };
      s.graphClaims.set(claimId, updated);
      return updated;
    }, { label: "graph.setClaimActive" });
  },

  async getConsent(personaId, category) {
    return withMockLatency(
      // Default OFF. Absence of a record is a NO, never an implicit yes.
      () => state().graphConsent.get(consentKey(personaId, category)) === true,
      { label: "graph.getConsent" }
    );
  },

  async setConsent(personaId, category, consented) {
    return withMockLatency(() => {
      state().graphConsent.set(consentKey(personaId, category), consented);
      // Withdrawing consent deactivates that category's claims immediately —
      // consent withdrawal has to actually take effect, not just hide a toggle.
      if (!consented) {
        const s = state();
        for (const c of allClaims(personaId)) {
          if (c.category === category) s.graphClaims.set(c.id, { ...c, active: false });
        }
      }
    }, { label: "graph.setConsent" });
  },

  async listConnectors() {
    return withMockLatency(
      () => CONNECTORS.map(({ yields, ...rest }) => rest as ImportConnector),
      { label: "graph.listConnectors" }
    );
  },

  // Imports are multi-step with visible progress, never instant.
  async startImport(personaId, connectorId) {
    return withMockLatency(() => {
      const connector = CONNECTORS.find((c) => c.id === connectorId);
      if (!connector) throw new AdapterError("unknown connector", "NOT_FOUND");
      const job: ImportJob = {
        id: nextId("import"),
        personaId,
        connectorId,
        status: "running",
        step: 1,
        totalSteps: 4,
        claimIds: [],
        startedAt: Date.now(),
      };
      state().imports.set(job.id, job);
      return job;
    }, { label: "graph.startImport" });
  },

  async advanceImport(jobId) {
    return withMockLatency(() => {
      const s = state();
      const job = s.imports.get(jobId);
      if (!job) throw new AdapterError("unknown import job", "NOT_FOUND");
      if (job.status === "complete" || job.status === "preview") return job;
      const next: ImportJob = { ...job, step: job.step + 1 };

      if (next.step >= next.totalSteps) {
        // Backpack pass: the walk ends at a PREVIEW, not a commit. Nothing
        // is written until commitImport — no bulk import bypasses the
        // confirm step, and the preview shows exactly what will land.
        const connector = CONNECTORS.find((c) => c.id === job.connectorId)!;
        next.status = "preview";
        next.step = next.totalSteps;
        next.preview = previewItemsFor(connector, job.personaId, s);
      }
      s.imports.set(jobId, next);
      return next;
    }, { label: "graph.advanceImport" });
  },

  async commitImport(jobId) {
    return withMockLatency(() => {
      const s = state();
      const job = s.imports.get(jobId);
      if (!job) throw new AdapterError("unknown import job", "NOT_FOUND");
      if (job.status === "complete") return job; // idempotent — no double write
      if (job.status !== "preview") {
        throw new AdapterError("import is not ready to commit (no preview)", "FORBIDDEN");
      }
      // Re-derive the preview against CURRENT consent so a category opted in
      // (or out) between preview and commit is honoured — what commits is
      // exactly the non-withheld items as of commit time.
      const connector = CONNECTORS.find((c) => c.id === job.connectorId)!;
      const items = previewItemsFor(connector, job.personaId, s);
      const claimIds: string[] = [];
      for (const item of items) {
        if (item.withheld) continue; // sensitive-without-consent never lands
        const claim: GraphClaim = {
          id: nextId("claim"),
          personaId: job.personaId,
          category: item.category,
          label: item.label,
          value: item.value,
          source: item.source,
          method: item.method,
          issuer: item.issuer,
          issuedAt: Date.now(),
          active: true,
        };
        s.graphClaims.set(claim.id, claim);
        claimIds.push(claim.id);
      }
      const done: ImportJob = { ...job, status: "complete", claimIds, preview: items };
      s.imports.set(jobId, done);
      return done;
    }, { label: "graph.commitImport" });
  },

  async getImport(jobId) {
    return withMockLatency(() => state().imports.get(jobId) ?? null, { label: "graph.getImport" });
  },
};
