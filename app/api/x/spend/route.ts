import { NextRequest, NextResponse } from "next/server";
// THE SPEND SURFACE — the ledger, the caps, and what remains. Test-facing
// and demo-facing; every number here comes from lib/x/spend.ts.
import {
  beginSpendRun,
  liveSpendTotal,
  PER_ACTION_CONFIRM_USD,
  PER_DAY_CAP_USD,
  PER_RUN_CAP_USD,
  spendEntries,
  spentThisRun,
  spentToday,
} from "@/lib/x/spend";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    entries: spendEntries().sort((a, b) => b.at - a.at),
    totals: {
      today: spentToday(),
      thisRun: spentThisRun(),
      liveTotal: liveSpendTotal(),
    },
    caps: {
      perActionConfirm: PER_ACTION_CONFIRM_USD,
      perDay: PER_DAY_CAP_USD,
      perRun: PER_RUN_CAP_USD,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.action === "beginRun") {
    const runId = await beginSpendRun(String(body.label ?? "test"));
    return NextResponse.json({ runId });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
