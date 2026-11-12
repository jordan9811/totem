import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PUBLIC GO-LIVE (the relay track) — REPORT AN ANONYMOUS POST.
//
// POST { castHash, reason, universe? }  → the validator's POST /zk/anon/report (validator/anonpublic.js). The reason is one of
//   lib/zk/anon/moderation.ts REPORT_REASONS; universe is "fixture" or "live" (absent: this device's universe). Nothing that
//   names the reporter is sent or stored: no persona, no root, no device header — the validator keeps the cast, the reason
//   and the hour, and holds a per-address limit in memory only. The moderators see the report in their signed takedown
//   queue (Settings › Moderation).
// Answered by the visitor's browser device on the public site (lib/device/routes.generated.ts); NO node-only import at the
// top. Plain sentences in every answer, for components/zk/AnonReportButton.tsx and the /anon page.

const THANKS = "Thanks. Your report reached the moderators, and it doesn't say who sent it.";
const ALREADY = "You already reported this post. The moderators have it.";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { castHash?: unknown; reason?: unknown; universe?: unknown };
  const castHash = typeof body.castHash === "string" ? body.castHash.toLowerCase() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!/^[0-9a-f]{64}$/.test(castHash)) return NextResponse.json({ error: "That isn't an anonymous post this site can report." }, { status: 400 });
  const { REPORT_REASONS } = await import("@/lib/zk/anon/moderation");
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return NextResponse.json({ error: "Pick a reason from the list." }, { status: 400 });
  const { zkMode } = await import("@/lib/zk/config");
  const mode = body.universe === "live" ? "live" : body.universe === "fixture" ? "fixture" : zkMode();
  const { postAnonReport } = await import("@/lib/zk/validatorClient");
  let r: { status: number; json: Record<string, unknown> | null };
  try {
    r = await postAnonReport({ mode, castHash, reason });
  } catch {
    return NextResponse.json({ error: "Couldn't send the report just now. Try again in a moment." }, { status: 503 });
  }
  if (r.status === 201) return NextResponse.json({ ok: true, sentence: THANKS }, { status: 201 });
  if (r.status === 200 && r.json?.ok === true) return NextResponse.json({ ok: true, already: true, sentence: ALREADY });
  if (r.status === 404) return NextResponse.json({ error: "That post isn't showing any more, so there is nothing to report." }, { status: 404 });
  if (r.status === 429) return NextResponse.json({ error: "Too many reports from here this hour. Try again later." }, { status: 429 });
  return NextResponse.json({ error: typeof r.json?.error === "string" ? r.json.error : "The report wasn't taken (" + r.status + ")." }, { status: r.status >= 400 && r.status < 600 ? r.status : 502 });
}
