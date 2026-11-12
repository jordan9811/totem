import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { root } = await req.json();
  if (!root) return NextResponse.json({ error: "root required" }, { status: 400 });
  try {
    const count = await retryAdapter(() => adapters.rules.previewCount(root));
    return NextResponse.json({ count });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
