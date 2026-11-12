// PORTABLE ALGORITHMS — the artifact format.
//
// An algorithm here is the thing a mode already is: ranking weights, a rule
// set, and a handful of behaviour flags. The artifact carries FULL rule
// definitions rather than rule ids, because ids are meaningless off this
// device — portability means the receiver can evaluate everything locally.
//
// SECURITY MODEL, stated bluntly: an imported artifact is hostile until
// sanitized. Import runs three gates, in order:
//   1. signature verification (authorship + tamper evidence),
//   2. whitelist sanitization (unknown fields do not survive),
//   3. guardrail validation via the RULES EVALUATOR's own validator —
//      the spec is explicit that enforcement lives in the evaluator, not
//      the import UI, so the import calls the evaluator's validator and
//      the evaluator ALSO refuses protected rules at evaluation time.
//      Two layers, one source of truth for what is protected.
import type { RankingWeights, Rule } from "@/lib/adapters/types";
import { validateRuleGroup, type GuardrailViolation } from "@/lib/rules/evaluate";
import { signForPersona, publicKeyForPersona } from "@/lib/identity/keys";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import { sanitizeLensSpec } from "@/lib/lens/sanitize";
import type { LensSpec } from "@/lib/lens/types";

export const ARTIFACT_SCHEMA_VERSION = 1;

/** Behaviour flags an artifact may carry. A closed whitelist — the four
 * guardrailed surfaces (composer destination indicator, correction cards,
 * disclosure/grants, k-floor) have no representation here and cannot gain
 * one through an import. */
export const ALLOWED_MODE_FLAGS = [
  "followedOnly",
  "longformOnly",
  "hideReplies",
  "showTrending",
  "calmRanking",
  "allowAds",
  "kingOfTheHill",
] as const;
export type AllowedModeFlag = (typeof ALLOWED_MODE_FLAGS)[number];

export interface AlgoProvenance {
  authorHandle: string;
  algoVersion: number;
  name: string;
}

/** A pack predicate over a PERSONA: holding or lacking a claim from the
 * existing audience-population index. Closed shape — packs compose existing
 * primitives, and this whitelist is where that rule is enforced. */
export interface AttestationPredicate {
  claim: string;
  mode: "holding" | "lacking";
}

export interface PackCuratorSubscription {
  feedId: string;
  action: "badge" | "demote" | "autoblock";
}

export interface AlgoArtifact {
  /** "algo" (default, Tier A) or "filter_pack" (Tier B Gate 1). Same signed
   * shape, same pipeline, same guardrails — a pack is an artifact that also
   * carries persona-level predicates and curator riders. */
  kind?: "algo" | "filter_pack" | "lens";
  schemaVersion: number;
  name: string;
  summary: string;
  authorPersonaId: string;
  authorHandle: string;
  algoVersion: number;
  ranking: RankingWeights;
  rules: Pick<Rule, "name" | "action" | "root">[];
  modeFlags: Partial<Record<AllowedModeFlag, boolean>>;
  createdAt: number;
  /** filter packs only */
  attestationPredicates?: AttestationPredicate[];
  curatorSubscriptions?: PackCuratorSubscription[];
  /** MEGA PASS 2 Gate 2: the lens section — signal weights + the influence distribution. REQUIRED for
   * kind "lens"; optional on an algo or a filter pack (either may pin a lens). Sanitized by
   * lib/lens/sanitize.ts: unknown keys stripped and reported, the five protected surfaces refused BY NAME. */
  lens?: LensSpec;
  /** present when this artifact was edited from someone else's algo */
  forkedFrom?: AlgoProvenance;
  signature: string;
}

// ---------------------------------------------------------------- signing

/** Canonical form. Everything semantic is inside it — a tampered rule, a
 * renamed algo, or an altered weight all break the signature. Signed with
 * the AUTHOR persona's Ed25519 key, same stance as grant signatures. */
export function canonicalForm(a: Omit<AlgoArtifact, "signature">): string {
  return [
    a.kind ?? "algo",
    String(a.schemaVersion),
    a.name,
    a.summary,
    a.authorPersonaId,
    a.authorHandle,
    String(a.algoVersion),
    JSON.stringify(a.ranking),
    JSON.stringify(a.rules),
    JSON.stringify(a.modeFlags),
    a.attestationPredicates ? JSON.stringify(a.attestationPredicates) : "",
    a.curatorSubscriptions ? JSON.stringify(a.curatorSubscriptions) : "",
    a.lens ? JSON.stringify(a.lens) : "",
    String(a.createdAt),
    a.forkedFrom ? JSON.stringify(a.forkedFrom) : "",
  ].join("|");
}

/** Sign as the author. Null = no key resolves for authorPersonaId — the
 * CALLER refuses the operation; an unsigned artifact is never produced. */
export function signArtifact(a: Omit<AlgoArtifact, "signature">): string | null {
  return signForPersona(a.authorPersonaId, canonicalForm(a));
}

/** Authorship, not just integrity: the signature must verify against the
 * author persona's resolved public key. No resolvable key = false — an
 * unverifiable artifact is treated as absent. */
export function verifyArtifact(a: AlgoArtifact): boolean {
  const { signature, ...rest } = a;
  const pub = publicKeyForPersona(a.authorPersonaId);
  return pub !== null && verifyCanonical(signature, canonicalForm(rest), pub);
}

// ------------------------------------------------------------- sanitizing

export interface SanitizeResult {
  artifact: AlgoArtifact | null;
  /** everything that was refused or stripped, by name — surfaced in the
   * preview, never silently discarded */
  violations: GuardrailViolation[];
}

/**
 * Whitelist sanitization + guardrail validation. Refuses rather than
 * repairs where the artifact is attacking a protected surface: a stripped
 * hostile flag is reported, and a rule touching a protected namespace kills
 * the IMPORT, not just the rule — an artifact that tried to reach the
 * disclosure layer once is not an artifact to run at all.
 */
export function sanitizeArtifact(raw: unknown): SanitizeResult {
  const violations: GuardrailViolation[] = [];
  const a = raw as Record<string, unknown>;
  if (!a || typeof a !== "object") return { artifact: null, violations: [{ where: "artifact", field: "(root)", reason: "not an object" }] };

  // Unknown mode flags: strip and report. This is where a hostile
  // hideAudienceLine / suppressCorrections / kFloor lands and dies.
  const flags: Partial<Record<AllowedModeFlag, boolean>> = {};
  const rawFlags = (a.modeFlags ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawFlags)) {
    if ((ALLOWED_MODE_FLAGS as readonly string[]).includes(k)) {
      flags[k as AllowedModeFlag] = Boolean(v);
    } else {
      violations.push({ where: "modeFlags", field: k, reason: "not an importable behaviour — stripped" });
    }
  }

  // Any top-level key outside the schema: strip and report.
  const KNOWN = new Set([
    "kind", "schemaVersion", "name", "summary", "authorPersonaId", "authorHandle",
    "algoVersion", "ranking", "rules", "modeFlags", "createdAt", "forkedFrom", "signature",
    "attestationPredicates", "curatorSubscriptions", "lens",
  ]);
  for (const k of Object.keys(a)) {
    if (!KNOWN.has(k)) violations.push({ where: "artifact", field: k, reason: "unknown field — stripped" });
  }

  // Rules: validated by the evaluator's own validator. A protected-namespace
  // hit is fatal to the whole import.
  const rules: AlgoArtifact["rules"] = [];
  let fatal = false;
  for (const r of (Array.isArray(a.rules) ? a.rules : []) as Rule[]) {
    const ruleViolations = validateRuleGroup(r.root);
    if (ruleViolations.length) {
      violations.push(...ruleViolations.map((v) => ({ ...v, where: `rule "${r.name}"` })));
      fatal = true;
      continue;
    }
    // POST-DEPLOY Gate 3: the allowlist stays THREE. `pin` and `banner` exist
    // now (delivery tiers compile to them), and they are device-only on purpose:
    // an imported algorithm that could pin an account to the top of somebody's
    // timeline is an ad slot with extra steps, and one that could banner an
    // account is a push channel. An import naming either is refused by name.
    if (!["hide", "downrank", "flag"].includes(r.action)) {
      const why = ["pin", "banner"].includes(r.action)
        ? `action "${r.action}" is set by the owner's own delivery tiers and cannot be imported`
        : `unknown action "${r.action}"`;
      violations.push({ where: `rule "${r.name}"`, field: "action", reason: why });
      fatal = true;
      continue;
    }
    rules.push({ name: r.name, action: r.action, root: r.root });
  }

  // Pack predicates: closed shape, and the claim must exist in the audience
  // index — "compose existing primitives only" is enforced here, not hoped.
  const predicates: AttestationPredicate[] = [];
  for (const raw of (Array.isArray(a.attestationPredicates) ? a.attestationPredicates : []) as Record<string, unknown>[]) {
    const mode = raw.mode;
    if (mode !== "holding" && mode !== "lacking") {
      violations.push({ where: "attestationPredicates", field: String(raw.claim ?? "?"), reason: `unknown predicate mode "${String(mode)}" — refused` });
      fatal = true;
      continue;
    }
    const extra = Object.keys(raw).filter((k) => !["claim", "mode"].includes(k));
    if (extra.length) {
      violations.push({ where: "attestationPredicates", field: extra.join(","), reason: "predicates carry only claim+mode — a new capability is a design change, not an import" });
      fatal = true;
      continue;
    }
    predicates.push({ claim: String(raw.claim), mode });
  }

  const packSubs: PackCuratorSubscription[] = [];
  for (const raw of (Array.isArray(a.curatorSubscriptions) ? a.curatorSubscriptions : []) as Record<string, unknown>[]) {
    if (!["badge", "demote", "autoblock"].includes(String(raw.action))) {
      violations.push({ where: "curatorSubscriptions", field: String(raw.feedId ?? "?"), reason: `unknown action "${String(raw.action)}"` });
      fatal = true;
      continue;
    }
    packSubs.push({ feedId: String(raw.feedId), action: raw.action as PackCuratorSubscription["action"] });
  }

  // MEGA PASS 2 Gate 2: the lens section — whitelisted signals, sanitized curves, the five protected surfaces
  // refused BY NAME (fatal). A `kind: "lens"` artifact WITHOUT a lens section is not a lens: refused.
  let lens: LensSpec | undefined;
  if (a.lens !== undefined || a.kind === "lens") {
    const r = sanitizeLensSpec(a.lens);
    violations.push(...r.violations);
    if (r.fatal || !r.spec) fatal = true;
    else lens = r.spec;
  }

  if (fatal) return { artifact: null, violations };

  const ranking = a.ranking as RankingWeights;
  if (
    !ranking ||
    [ranking.recency, ranking.engagement, ranking.authorAffinity, ranking.clusterAffinity].some(
      (n) => typeof n !== "number" || !Number.isFinite(n)
    )
  ) {
    return { artifact: null, violations: [...violations, { where: "artifact", field: "ranking", reason: "missing or non-numeric weights" }] };
  }

  const artifact: AlgoArtifact = {
    kind: a.kind === "filter_pack" ? "filter_pack" : a.kind === "lens" ? "lens" : "algo",
    schemaVersion: Number(a.schemaVersion ?? ARTIFACT_SCHEMA_VERSION),
    name: String(a.name ?? "Unnamed algorithm"),
    summary: String(a.summary ?? ""),
    authorPersonaId: String(a.authorPersonaId ?? ""),
    authorHandle: String(a.authorHandle ?? ""),
    algoVersion: Number(a.algoVersion ?? 1),
    ranking,
    rules,
    modeFlags: flags,
    createdAt: Number(a.createdAt ?? 0),
    ...(predicates.length ? { attestationPredicates: predicates } : {}),
    ...(packSubs.length ? { curatorSubscriptions: packSubs } : {}),
    ...(lens ? { lens } : {}),
    ...(a.forkedFrom ? { forkedFrom: a.forkedFrom as AlgoProvenance } : {}),
    signature: String(a.signature ?? ""),
  };
  return { artifact, violations };
}
