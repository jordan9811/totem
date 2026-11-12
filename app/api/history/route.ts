import { NextResponse } from "next/server";
// PROD-LIVE PASS (D-CU-0-4) — the history shelf (the fixture bookmarks list) with the persona layer applied for the
// ACTING persona: attribution and a granted viewer's merged identities are viewer-scoped, so on a public deployment
// the browser device answers this route rather than the server rendering the fixture viewer's view of them.
import { hydrate } from "@/lib/adapters/mock/store";
import { historyShelfView } from "@/lib/views/social.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await hydrate(); // the attribution index is a direct state() read — never serve pre-hydration emptiness
    return NextResponse.json(await historyShelfView());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "could not read your history" }, { status: 503 });
  }
}
