import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await retryAdapter(() => adapters.rules.list(activeSeedPersonaId()));
    return NextResponse.json({ rules });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

// GATE 5 (attack-post-2 F-4): the ONLY rule actions a caller may create.
//
// `pin` and `banner` exist for the owner's delivery tiers, which compile them
// internally and never travel through this route. The algo importer already
// refuses them by name — but this route was the other way in: POST a rule with
// action "pin", PATCH it onto a mode, and every post it matches is pinned. An
// allowlist here closes the second door, in the same words as the first.
const CREATABLE_ACTIONS = new Set(["hide", "downrank", "flag"]);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action ?? "hide";
  if (!CREATABLE_ACTIONS.has(action))
    return NextResponse.json(
      { error: `action "${action}" is set by the owner's own delivery tiers and cannot be created as a rule`, code: "action_not_creatable" },
      { status: 400 }
    );
  // GATE 5 (attack-post-2 F-4, residual): the ACTION was allowlisted and the ROOT was not, so
  // `{action:"hide", root:{combinator:"AND"}}` stored fine and then threw inside the evaluator
  // on every feed build — a persisted 503 on the whole timeline, surviving restarts, from two
  // ordinary requests. The evaluator's own validator is the right gate, and it already exists.
  const { validateRuleGroup } = await import("@/lib/rules/evaluate");
  const violations = validateRuleGroup(body.root);
  if (violations.length)
    return NextResponse.json(
      { error: "rule refused: " + violations.map((v) => v.reason).join("; "), code: "malformed_rule" },
      { status: 400 }
    );
  try {
    const rule = await adapters.rules.create({
      personaId: activeSeedPersonaId(),
      name: body.name,
      action,
      root: body.root,
    });
    return NextResponse.json({ rule });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const ruleId = req.nextUrl.searchParams.get("ruleId");
  if (!ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });
  try {
    await retryAdapter(() => adapters.rules.delete(ruleId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
