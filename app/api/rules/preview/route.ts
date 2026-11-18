import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const root = body && typeof body === "object" ? (body as { root?: unknown }).root : undefined;
  if (!root) return NextResponse.json({ error: "root required" }, { status: 400 });
  // a tree the evaluator cannot walk is refused by its shape, in the rules route's own sentence (the evaluator would
  // count it as matching nothing, which would preview a rule that cannot be saved)
  const { isWellFormedGroup, RULE_SHAPE_REFUSED_SENTENCE } = await import("@/lib/rules/evaluate");
  if (!isWellFormedGroup(root)) return NextResponse.json({ error: RULE_SHAPE_REFUSED_SENTENCE, code: "malformed_rule" }, { status: 400 });
  try {
    const count = await retryAdapter(() => adapters.rules.previewCount(root));
    return NextResponse.json({ count });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
