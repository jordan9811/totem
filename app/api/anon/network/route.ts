import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// THE HUB ROUTE — @anon's posts AS THE FARCASTER PROTOCOL HAS THEM, for the /anon page (components/anon/AnonFeed.tsx).
//
// GET → the validator's GET /zk/anon/network-casts (validator/anonpublic.js networkCasts: a keyless castsByFid read of the
// Snapchain node it posts to, FC_HUB_URL, with taken-down rows left out). The Farcaster app hides accounts that have not
// opted in to its rules, so the page shows the protocol's copy instead of linking to a client that may show nothing.
// Answers { casts: [{ hash, castHash, text, at, castUrl }] } (castHash: the relay's own id when the cast is one it relayed,
// so Report and Share work), or { casts: null, error } — NEVER an empty list for a read that failed (retried once). 501:
// this site's validator has no hub set up (the feed then shows its own list alone, as before).
// Answered by the visitor's browser device (lib/device/routes.generated.ts) like the other /api/anon routes; nothing here
// names the visitor.
const NETWORK_HASH_RE = /^0x[0-9a-f]{40}$/;
const CAST_HASH_RE = /^[0-9a-f]{64}$/;

export async function GET() {
  const { fetchAnonNetworkCasts } = await import("@/lib/zk/validatorClient");
  let r: { status: number; json: Record<string, unknown> | null } | null = null;
  for (let attempt = 0; attempt < 2 && (!r || r.status >= 500 || !r.json); attempt++) {
    try {
      r = await fetchAnonNetworkCasts(50);
    } catch {
      r = null;
    }
  }
  if (!r) return NextResponse.json({ casts: null, error: "The post list on Farcaster couldn't be reached just now." }, { status: 503 });
  if (r.status === 501) return NextResponse.json({ casts: null, off: true, error: "This site doesn't read @anon from the Farcaster network." }, { status: 501 });
  const list = r.json && Array.isArray((r.json as { casts?: unknown }).casts) ? ((r.json as { casts: unknown[] }).casts as unknown[]) : null;
  if (r.status !== 200 || !list) {
    const why = r.json && typeof r.json.error === "string" ? String(r.json.error).slice(0, 200) : "the list answered " + r.status;
    return NextResponse.json({ casts: null, error: "The post list on Farcaster couldn't be read just now (" + why + ")." }, { status: 503 });
  }
  const casts = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const x = c as { hash?: unknown; castHash?: unknown; text?: unknown; at?: unknown; castUrl?: unknown };
    if (typeof x.hash !== "string" || !NETWORK_HASH_RE.test(x.hash) || typeof x.text !== "string") continue;
    casts.push({ hash: x.hash, castHash: typeof x.castHash === "string" && CAST_HASH_RE.test(x.castHash) ? x.castHash : null, text: x.text, at: typeof x.at === "number" && Number.isFinite(x.at) ? x.at : null, castUrl: typeof x.castUrl === "string" ? x.castUrl : null });
  }
  return NextResponse.json({ source: "hub", casts });
}
