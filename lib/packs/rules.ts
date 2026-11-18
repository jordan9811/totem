// A FILTER PACK'S POST RULES, as both feeds run them. A pack attached to a mode adds its post rules to the mode's own,
// and both feeds take them through the one per-post decision (lib/rules/evaluate.ts ruleActions), in the same list as
// the mode's own rules: the sample feed's seeded and live passes (lib/feed.ts) and the real Following and For You
// (lib/fc/hubRead/modeSource.ts appends them to the spec's rules). Before this, a pack's `artifact.rules` were signed,
// sanitized, stored and exported, and never evaluated: an attached pack applied only its claim predicates and its lens.
//
// PURE (no store, no server-only import, browser-safe): the caller hands it the packs attached to the mode.
//
// THE IMPORT GUARDRAILS, ENFORCED AGAIN HERE: lib/algo/artifact.ts sanitizeArtifact refuses a pack whose rule reaches a
// protected field, cannot be walked, or carries an action outside hide / downrank / flag. A stored pack is checked again
// before its rules run, because enforcement lives where rules are evaluated, not only on the import screen: a pack rule
// that would pin or banner (an ad slot or a push channel by another name), one that reads a field no rule may read
// (disclosure, grants, the k-floor, correction delivery, the composer), or one whose tree the evaluator cannot walk is
// INERT, exactly as a stored rule of the mode's own is (runnableRules): it hides and moves no post, the pack's other
// rules still run, and the page names it. Never a crash, never a quiet change to the feed.
//
// A pack's rule ids are `pack:<packId>:<index>`, never `delivery:`, so both feeds' fail-closed author question (a hide
// rule on the author's Totem fields hides every post whose author cannot be resolved) counts them as it counts the
// owner's own.
//
// UNLINKABILITY: nothing here reads or writes. The packs come from the device's own memory, and the rules are evaluated
// over posts that were already read; a pack rule reads only the evaluator's whitelisted post and author fields.
import type { Rule } from "@/lib/adapters/types";
import { ruleProblem, type InertRule } from "@/lib/rules/evaluate";

/** the actions an imported rule may carry (lib/algo/artifact.ts allowlists the same three) */
export const PACK_RULE_ACTIONS: ReadonlySet<string> = new Set(["hide", "downrank", "flag"]);
/** a pack rule's id: `pack:<packId>:<index>` */
export const PACK_RULE_ID_PREFIX = "pack:";

interface PackLike {
  id: string;
  artifact: { name: string; rules?: ReadonlyArray<unknown> };
}

/** the sentence the page shows for a pack rule the feed left out */
export function packRuleInertSentence(packName: string, ruleName: string, why: string): string {
  const rule = ruleName.trim() ? ` ("${ruleName}")` : "";
  return `Pack "${packName}" carries a rule${rule} that ${why}, so that rule does nothing: it hides and moves no post.`;
}

/** why a stored pack rule may not run, or null when it may */
function packRuleProblem(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "isn't a rule";
  const r = entry as { action?: unknown; root?: unknown };
  if (r.action === "pin" || r.action === "banner") return "would pin or banner posts, which only your own delivery settings may do";
  if (typeof r.action !== "string" || !PACK_RULE_ACTIONS.has(r.action)) return `carries an action ("${String(r.action)}") a pack may not`;
  const problem = ruleProblem(r.root);
  if (problem === "shape") return "can't be read";
  if (problem === "field") return "reads something a rule isn't allowed to read";
  return null;
}

/** The attached packs' post rules, as ordinary Rules in pack order (named `[<pack>] <rule>`, as an imported algorithm's
 *  rules are, so a sentence about a rule says which pack it came from), and the ones left out, each with its sentence.
 *  Never throws. */
export function packRules(packs: ReadonlyArray<PackLike>): { run: Rule[]; inert: InertRule[] } {
  const run: Rule[] = [];
  const inert: InertRule[] = [];
  for (const pack of packs) {
    const packName = String(pack.artifact?.name ?? "").trim() || "without a name";
    const list = Array.isArray(pack.artifact?.rules) ? pack.artifact.rules : [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const id = `${PACK_RULE_ID_PREFIX}${pack.id}:${i}`;
      const ruleName = entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string" ? (entry as { name: string }).name : "";
      const name = `[${packName}] ${ruleName}`;
      const why = packRuleProblem(entry);
      if (why) {
        inert.push({ id, name, sentence: packRuleInertSentence(packName, ruleName, why) });
        continue;
      }
      const r = entry as Pick<Rule, "action" | "root">;
      run.push({ id, name, action: r.action, root: r.root, createdAt: 0 });
    }
  }
  return { run, inert };
}
