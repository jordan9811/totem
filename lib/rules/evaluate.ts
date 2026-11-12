// THE evaluator. Modes, feed filters, and channel gates all call this —
// no feature grows its own bespoke filter logic (ARCHITECTURE.md).
// Pure, synchronous, no server-only import: runs identically on server
// (feed filtering) and client (rule builder live preview).
import type { RuleCondition, RuleField, RuleGroup } from "../adapters/types";

export interface EvalContext {
  post: {
    hash: string;
    topicId: string | null;
    isUpdate: boolean;
    hasMedia: boolean;
    /** age in minutes */
    ageMinutes: number;
    /** SPEC A (the algorithm dial on real posts): the post's own words, for a `post.text contains` rule (a muted
     *  word). Absent where a caller has no text: the rule then reads null and matches nothing. */
    text?: string;
  };
  author: {
    personaId: string;
    tier: number;
    cluster: string | null;
    /** Attestation pass Gate 3: "<issuer>/<bucket>" the author PROVED this
     * epoch (lib/attest/proven.ts) — absent/empty under a non-zk binding */
    attestations?: string[];
  };
  viewer: {
    personaId: string | null;
    followingPersonaIds: string[];
  };
  /** UX Gate 1: present only when evaluating a mode's activation rule
   * (never for post-filter evaluation — those contexts omit it, and a rule
   * touching clock.hourUTC there simply reads null, matching nothing). */
  clock?: { hourUTC: number };
  /** POST-DEPLOY Gate 3: the delivery tier this viewer set for the post's
   * AUTHOR in the ACTIVE mode. Resolved by the caller from the (account x
   * mode) map — the evaluator stays pure and never reads a vault. Absent in
   * contexts that have no mode (an activation-rule preview, the client-side
   * rule builder), where a delivery rule reads null and matches nothing. */
  delivery?: { tier: string };
}

function fieldValue(field: RuleField, ctx: EvalContext): string | number | boolean | null {
  switch (field) {
    case "author.tier":
      return ctx.author.tier;
    case "author.cluster":
      return ctx.author.cluster;
    case "post.topicId":
      return ctx.post.topicId;
    case "post.isUpdate":
      return ctx.post.isUpdate;
    case "post.hasMedia":
      return ctx.post.hasMedia;
    case "post.age":
      return ctx.post.ageMinutes;
    case "post.text":
      return typeof ctx.post.text === "string" ? ctx.post.text : null;
    case "clock.hourUTC":
      return ctx.clock?.hourUTC ?? null;
    case "delivery.tier":
      return ctx.delivery?.tier ?? null;
    case "attest.holds":
      return null; // a set membership, evaluated in evalCondition, not a scalar
    default:
      return null;
  }
}

// ---------------------------------------------------------------- guardrails
//
// THE enforcement point for imported algorithms, per the Tier A spec:
// "enforce in the rules evaluator, not the import UI". Both the import
// sanitizer and the evaluator itself call this, so a hostile rule that
// somehow survives import still cannot evaluate.

/** The only fields a rule may touch. Everything else — identity, grants,
 * disclosure, k-floor, correction surfaces, composer chrome — is not
 * reachable from a rule, and an attempt to reach it is refused BY NAME. */
const EVALUABLE_FIELDS: ReadonlySet<string> = new Set([
  "author.tier",
  "author.cluster",
  "post.topicId",
  "post.isUpdate",
  "post.hasMedia",
  "post.age",
  "post.text",
  "graph.claim",
  "clock.hourUTC",
  "attest.holds",
]);

/** Namespaces that signal an attack rather than a typo. Named so the
 * refusal can say what was attempted. */
const PROTECTED_PATTERNS: [RegExp, string][] = [
  [/^identity\.|^grant|^linkage|^disclosure/i, "the disclosure/grant layer"],
  [/kfloor|k_floor|audienceSize/i, "the k-anonymity floor"],
  [/correction|note/i, "correction-card delivery"],
  [/composer|audienceLine|destination/i, "the composer destination indicator"],
];

export interface GuardrailViolation {
  where: string;
  field: string;
  reason: string;
}

/** Walk a rule tree; return every violation. Empty array = evaluable. */
export function validateRuleGroup(group: RuleGroup, where = "rule"): GuardrailViolation[] {
  const out: GuardrailViolation[] = [];
  for (const clause of group.clauses ?? []) {
    if (isGroup(clause)) {
      out.push(...validateRuleGroup(clause, where));
      continue;
    }
    const field = String(clause.field);
    if (EVALUABLE_FIELDS.has(field)) continue;
    const attack = PROTECTED_PATTERNS.find(([re]) => re.test(field));
    out.push({
      where,
      field,
      reason: attack
        ? `attempts to reach ${attack[1]} — refused`
        : "not an evaluable field — refused",
    });
  }
  return out;
}

function isGroup(clause: RuleCondition | RuleGroup): clause is RuleGroup {
  return (clause as RuleGroup).combinator !== undefined;
}

function evalCondition(cond: RuleCondition, ctx: EvalContext): boolean {
  if (cond.field === "attest.holds") {
    // ATTESTATION PASS Gate 3: proof-mediated. The author's list is what it
    // PROVED this epoch; a root that merely HOLDS an issuance matches nothing.
    const held = ctx.author.attestations ?? [];
    const want = Array.isArray(cond.value) ? cond.value.map(String) : [String(cond.value)];
    const any = want.some((w) => held.includes(w));
    if (cond.op === "eq" || cond.op === "in") return any;
    if (cond.op === "neq") return !any;
    return false;
  }
  const actual = fieldValue(cond.field, ctx);
  const expected = cond.value;
  // SPEC A: a word in a post's text matches whatever its case ("Crypto" mutes "crypto"); only `contains` reads text
  if (cond.field === "post.text") {
    if (cond.op !== "contains") return false;
    return typeof actual === "string" && typeof expected === "string" && expected.length > 0 && actual.toLowerCase().includes(expected.toLowerCase());
  }

  switch (cond.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && (expected as (string | number)[]).includes(actual as string | number);
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    default:
      return false;
  }
}

export function evaluateGroup(group: RuleGroup, ctx: EvalContext): boolean {
  const results = group.clauses.map((clause) =>
    isGroup(clause) ? evaluateGroup(clause, ctx) : evalCondition(clause, ctx)
  );
  // An empty group matches nothing (safer default than matching everything:
  // a half-built rule in the builder shouldn't nuke the whole feed).
  if (results.length === 0) return false;
  const combined = group.combinator === "AND" ? results.every(Boolean) : results.some(Boolean);
  return group.negate ? !combined : combined;
}

/** What a set of rules decides for ONE post: hide it, or (for a post that stays) pin it, put it in the banner strip,
 *  push it down. THE per-post decision every feed takes: the sample feed's seeded and live passes (lib/feed.ts) and the
 *  real Following (lib/fc/hubRead/mode.ts) call this, so a rule decides a Farcaster post exactly as it decides a sample
 *  post given the same fields. `flag` changes nothing in a feed's membership or order. */
export function ruleActions(
  rules: ReadonlyArray<{ action: string; root: RuleGroup }>,
  ctx: EvalContext
): { hide: boolean; pin: boolean; banner: boolean; downrank: boolean } {
  const out = { hide: false, pin: false, banner: false, downrank: false };
  for (const rule of rules) {
    const a = rule.action;
    if (a !== "hide" && a !== "pin" && a !== "banner" && a !== "downrank") continue;
    if (out[a]) continue;
    if (evaluateGroup(rule.root, ctx)) out[a] = true;
  }
  return out;
}

/** the fields a rule tree reads (for saying which of them a kind of post does not carry) */
export function fieldsOf(group: RuleGroup): RuleField[] {
  const out = new Set<RuleField>();
  const walk = (g: RuleGroup) => {
    for (const c of g.clauses ?? []) {
      if (isGroup(c)) walk(c);
      else out.add(c.field);
    }
  };
  walk(group);
  return [...out];
}

/** a rule tree the evaluator can walk (a stored root with no clause list would throw inside it on every build) */
export function isWellFormedGroup(group: unknown): group is RuleGroup {
  if (!group || typeof group !== "object") return false;
  const g = group as Record<string, unknown>;
  if ((g.combinator !== "AND" && g.combinator !== "OR") || !Array.isArray(g.clauses)) return false;
  return g.clauses.every((c) => {
    if (!c || typeof c !== "object") return false;
    if ((c as Record<string, unknown>).combinator !== undefined) return isWellFormedGroup(c);
    return typeof (c as Record<string, unknown>).field === "string" && typeof (c as Record<string, unknown>).op === "string";
  });
}

export function fieldLabel(field: RuleField): string {
  return FIELD_LABEL[field] ?? String(field);
}

/** Plain-language rendering of a rule, for the rule builder + mode summaries. */
export function describeGroup(group: RuleGroup): string {
  if (group.clauses.length === 0) return "(no conditions yet)";
  const parts = group.clauses.map((clause) =>
    isGroup(clause) ? `(${describeGroup(clause)})` : describeCondition(clause)
  );
  const joined = parts.join(group.combinator === "AND" ? " and " : " or ");
  return group.negate ? `not (${joined})` : joined;
}

const FIELD_LABEL: Record<RuleField, string> = {
  "author.tier": "author tier",
  "author.cluster": "author topic",
  "post.topicId": "story",
  "post.isUpdate": "is an update",
  "post.hasMedia": "has media",
  "post.age": "post age (minutes)",
  "post.text": "text",
  "graph.claim": "graph claim",
  "attest.holds": "proven attestation (issuer/bucket)",
  "clock.hourUTC": "hour (UTC)",
  "delivery.tier": "delivery tier for this author",
};

const OP_LABEL: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "is above",
  gte: "is at least",
  lt: "is below",
  lte: "is at most",
  in: "is one of",
  contains: "contains",
};

export function describeCondition(cond: RuleCondition): string {
  const value = Array.isArray(cond.value) ? cond.value.join(", ") : String(cond.value);
  return `${FIELD_LABEL[cond.field]} ${OP_LABEL[cond.op]} ${value}`;
}
