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
// "enforce in the rules evaluator, not the import UI". The import sanitizer
// calls this, and so do both feeds before they evaluate a stored rule
// (runnableRules below), so a hostile rule that somehow survives import
// still cannot evaluate.

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

/** Walk a rule tree; return every violation. Empty array = evaluable.
 *
 * The SHAPE is a violation too, not only the fields: a group with no clause list (`{ op: "and", conditions: [...] }`,
 * `{ combinator: "AND" }`) used to read as "no clauses, no violations" (`group.clauses ?? []`), was stored by POST
 * /api/rules, and then threw inside the evaluator on every build of a feed whose mode named it. Every caller (the rules
 * route, the algo and pack import sanitizer, buildFeed's inline rules, the activation-rule writes, both feeds' loaders)
 * reads an empty answer as "the evaluator can walk this tree and it reads only evaluable fields", so this refuses at
 * least what isWellFormedGroup refuses. It never throws, whatever it is handed. */
export function validateRuleGroup(group: unknown, where = "rule"): GuardrailViolation[] {
  if (!group || typeof group !== "object" || Array.isArray(group)) return [{ where, field: "root", reason: "not a rule group — refused" }];
  const g = group as Record<string, unknown>;
  const out: GuardrailViolation[] = [];
  if (g.combinator !== "AND" && g.combinator !== "OR")
    out.push({ where, field: "combinator", reason: `combinator ${JSON.stringify(g.combinator ?? null)} is not AND or OR — refused` });
  if (!Array.isArray(g.clauses)) {
    out.push({ where, field: "clauses", reason: "has no list of conditions — refused" });
    return out;
  }
  for (const clause of g.clauses as unknown[]) {
    if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
      out.push({ where, field: "clause", reason: "a condition that is neither a condition nor a group — refused" });
      continue;
    }
    if ((clause as Record<string, unknown>).combinator !== undefined) {
      out.push(...validateRuleGroup(clause, where));
      continue;
    }
    const c = clause as Record<string, unknown>;
    if (typeof c.field !== "string" || typeof c.op !== "string") {
      out.push({ where, field: typeof c.field === "string" ? c.field : "clause", reason: "a condition needs a field and an op — refused" });
      continue;
    }
    const field = c.field;
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

/** Does this tree match this post? A tree the evaluator cannot walk (a stored root with no clause list, a null clause, a
 *  combinator other than AND/OR: isWellFormedGroup) is INERT: it matches no post, whatever its `negate`, and never throws.
 *  It used to throw on every post, so one such stored rule took down every feed whose mode named it. "Matches no post" is
 *  the evaluator's own reading of an empty group (below), and the one reading that can neither blank a feed nor pin,
 *  banner or push down every post; the feeds SAY which rules are inert (inertRuleNotices), so nothing goes quiet. The
 *  check is on the whole tree, once: a broken group nested inside a negated one would otherwise read as false and flip
 *  the outer group to match everything. */
export function evaluateGroup(group: RuleGroup, ctx: EvalContext): boolean {
  if (!isWellFormedGroup(group)) return false;
  return evalGroup(group, ctx);
}

function evalGroup(group: RuleGroup, ctx: EvalContext): boolean {
  const results = group.clauses.map((clause) =>
    isGroup(clause) ? evalGroup(clause, ctx) : evalCondition(clause, ctx)
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

/** the fields a rule tree reads (for saying which of them a kind of post does not carry). An inert tree (one the
 *  evaluator cannot walk) reads nothing. */
export function fieldsOf(group: RuleGroup): RuleField[] {
  if (!isWellFormedGroup(group)) return [];
  const out = new Set<RuleField>();
  const walk = (g: RuleGroup) => {
    for (const c of g.clauses) {
      if (isGroup(c)) walk(c);
      else out.add(c.field);
    }
  };
  walk(group);
  return [...out];
}

// ---------------------------------------------------------------- stored rules that cannot run
//
// A rule that is already stored can still be one the evaluator will not run: its tree cannot be walked (stored before
// the write paths refused that shape), or it reads past the evaluable fields (stored before POST /api/rules ran the
// guardrail). Both feeds ask the same question of the owner's own rules and of an attached pack's (lib/feed.ts,
// lib/fc/hubRead/modeSource.ts): such a rule is left out of the evaluation, so it hides, pins and moves NO post, and
// the page says which rule and why (never a crash, never a quiet change to the feed).

/** why a stored rule cannot run: its tree cannot be walked, or it reads a field no rule may read */
export type RuleProblem = "shape" | "field";
export function ruleProblem(root: unknown): RuleProblem | null {
  if (!isWellFormedGroup(root)) return "shape";
  return validateRuleGroup(root).length ? "field" : null;
}
/** a rule the feed left out, and the sentence the page shows for it */
export interface InertRule {
  id: string;
  name: string;
  sentence: string;
}
export function inertRuleSentence(name: string, problem: RuleProblem): string {
  const label = typeof name === "string" && name.trim() ? name : "without a name";
  return problem === "shape"
    ? `Rule "${label}" can't be read, so it does nothing: it hides and moves no post. Delete it in Settings and make it again.`
    : `Rule "${label}" reads something a rule isn't allowed to read, so it does nothing: it hides and moves no post. Delete it in Settings.`;
}
/** the rules that run, and the ones left out (each with its sentence), in their order */
export function runnableRules<R extends { id: string; name: string; root: unknown }>(rules: readonly R[]): { run: R[]; inert: InertRule[] } {
  const run: R[] = [];
  const inert: InertRule[] = [];
  for (const r of rules) {
    const problem = ruleProblem(r.root);
    if (problem) inert.push({ id: r.id, name: r.name, sentence: inertRuleSentence(r.name, problem) });
    else run.push(r);
  }
  return { run, inert };
}

/** the sentence every write path refuses a rule tree the evaluator cannot walk with (POST /api/rules, its preview, an
 *  activation rule on PATCH /api/modes) */
export const RULE_SHAPE_REFUSED_SENTENCE =
  'Rule refused: its conditions must be { combinator: "AND" or "OR", clauses: [...] }, each clause a condition with a field and an op, or another such group.';

/** a rule tree the evaluator can walk (a stored root with no clause list used to throw inside it on every build) */
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

/** Plain-language rendering of a rule, for the rule builder + mode summaries. A tree the evaluator cannot walk is said as
 *  that (the saved-rules list renders every stored rule, so a throw here took the screen you would delete it from). */
export function describeGroup(group: RuleGroup): string {
  if (!isWellFormedGroup(group)) return "(this rule can't be read, so it does nothing: delete it and make it again)";
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
