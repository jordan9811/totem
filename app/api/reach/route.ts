import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PERSONA LAUNCH P5 (D1, R6) — REACH TIERS, the route.
//
// GET: what this root holds and what it may boost an anonymous post with right now —
//   { mode, held: [tree], offered: [{ tree, issuer, bucket, label, size }], defaultTree, plainTree, reason, floor,
//     issuers: [{ id, honoured, accepted }], census: { epoch, at } | null, available, unavailableReason }
// judged from the last sync's snapshot (lib/zk/prefetch.ts — nothing fetched here but this root's own vault record of
// what it was issued). A tier under the crowd floor is NEVER in `offered` (lib/reach/trees.ts offeredAnonTrees compares
// the census SIZE with the client's floor, never the validator's clearsFloor); `held` may list it, and `reason` says in
// plain words why it is not offered.
//
// POST { action: "issue", issuer: "fc.reach" | "x.reach", buckets? }: ask the co-hosted reach issuer for this root's
// tiers (lib/attest/issuers/fcReach.ts — the root's OWN main Farcaster account, Neynar score at least 0.7, one account
// per root). The rig and the owner service only: REFUSED on a public deployment (the public server stays keyless — the
// issuer signs with a key) and on the browser device (anonymous proving there is P7).
// TEST RIG ONLY (ZK_DEV_HOOKS, never under LAYERS_WORLD=empty): `includeCohort` on "issue" (the fixture decoy crowd);
// { action: "setFixtureFacts", fid, followers?, score?, xFollowers? } and { action: "clearFixtureFacts" } — the fixture
// fid's facts, cleared by every reset (lib/reach/held.ts resetReachCaches).

const devHooksOn = () => process.env.ZK_DEV_HOOKS === "true";
const REACH_ISSUER_IDS = ["fc.reach", "x.reach"];

/** where reach tiers do not exist at all: the browser device (P7) and a public deployment (keyless) */
async function offHere(): Promise<string | null> {
  if (typeof window !== "undefined") return "Reach tiers aren't on this preview yet.";
  const { isPublicDeployment } = await import("@/lib/platform/env-contract");
  if (isPublicDeployment()) return "Reach tiers aren't on this site yet.";
  return null;
}

export async function GET(req: NextRequest) {
  const { zkMode } = await import("@/lib/zk/config");
  const q = req.nextUrl.searchParams.get("mode");
  const mode = q === "live" ? "live" : q === "fixture" ? "fixture" : zkMode();
  const off = await offHere();
  const { ZK_REACH_FLOOR } = await import("@/lib/zk/config");
  if (off) return NextResponse.json({ mode, available: false, unavailableReason: off, held: [], offered: [], defaultTree: null, plainTree: null, reason: null, floor: ZK_REACH_FLOOR, issuers: [], census: null });
  const { anonPostTree, reachOfferInputFor } = await import("@/lib/zk/gate");
  const { cachedSnapshot } = await import("@/lib/zk/prefetch");
  const { refreshHeldReach } = await import("@/lib/reach/held");
  const { offeredAnonTrees } = await import("@/lib/reach/trees");
  const { isHonoredIssuer } = await import("@/lib/attest/subscriber");
  const snap = cachedSnapshot(mode);
  const held = await refreshHeldReach(mode);
  const input = reachOfferInputFor(mode, snap);
  const offer = offeredAnonTrees(input);
  const keyOf = new Map((snap?.issuers ?? []).map((i) => [i.id, i.pubkey]));
  const served = snap?.anonConfig?.reachIssuers ?? [];
  return NextResponse.json({
    mode,
    available: true,
    unavailableReason: null,
    held: input.held,
    heldError: held.error,
    offered: offer.offered,
    defaultTree: offer.defaultTree,
    plainTree: anonPostTree(),
    reason: held.error ? "Your reach tiers couldn't be read just now, so posts aren't boosted." : offer.reason,
    floor: ZK_REACH_FLOOR,
    issuers: REACH_ISSUER_IDS.map((id) => ({ id, honoured: isHonoredIssuer(id, keyOf.get(id) ?? null), accepted: served.includes(id) })),
    census: snap ? { epoch: snap.epoch.epoch, at: snap.fetchedAt, error: snap.bucketsError } : null,
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const { zkMode } = await import("@/lib/zk/config");
  const mode = body.mode === "live" ? "live" : body.mode === "fixture" ? "fixture" : zkMode();
  const { isEmptyWorld } = await import("@/lib/world-flag");
  const rigOnly = (name: string): NextResponse | null => {
    if (!devHooksOn()) return NextResponse.json({ error: `"${name}" is a test-rig action — refused unless ZK_DEV_HOOKS=true` }, { status: 403 });
    if (isEmptyWorld()) return NextResponse.json({ error: `"${name}" is a test-rig action — refused under LAYERS_WORLD=empty`, code: "empty_world" }, { status: 403 });
    return null;
  };

  if (action === "issue") {
    const off = await offHere();
    if (off) return NextResponse.json({ error: off + " Proving your follower tier needs the issuer's key, which this site doesn't hold.", code: "keyless" }, { status: 403 });
    const issuer = String(body.issuer ?? "");
    if (!REACH_ISSUER_IDS.includes(issuer)) return NextResponse.json({ error: "Unknown reach tier source.", code: "bad-issuer" }, { status: 400 });
    const includeCohort = body.includeCohort === true;
    if (includeCohort) {
      const no = rigOnly("includeCohort");
      if (no) return no;
    }
    const buckets = Array.isArray(body.buckets) ? (body.buckets as unknown[]).map(String) : undefined;
    const { requestIssuance } = await import("@/lib/attest/subject");
    const { isRefusal } = await import("@/lib/attest/types");
    const r = await requestIssuance(mode, issuer, { buckets, includeCohort });
    if (isRefusal(r)) return NextResponse.json({ error: r.reason, code: "refused" }, { status: 409 });
    // what was just issued is held from its activation epoch (the composer reads the held cache, never the validator)
    const { noteReachIssued } = await import("@/lib/reach/held");
    await noteReachIssued(mode, r.buckets.map((bucket) => ({ issuerId: issuer, bucket, issueEpoch: r.epoch, expiryEpoch: r.expiresEpoch })));
    return NextResponse.json({ ok: true, issuer, buckets: r.buckets, accepted: r.accepted, refused: r.refused, epoch: r.epoch, activeFromEpoch: r.activeFromEpoch, expiresEpoch: r.expiresEpoch, cohortAttested: r.cohortAttested });
  }

  if (action === "setFixtureFacts") {
    const no = rigOnly(action);
    if (no) return no;
    const fid = Number(body.fid);
    if (!Number.isInteger(fid) || fid <= 0) return NextResponse.json({ error: "fid (positive integer) required" }, { status: 400 });
    const num = (v: unknown): number | null | undefined => (v === undefined ? undefined : v === null ? null : Number.isFinite(Number(v)) ? Number(v) : undefined);
    const { setFixtureFidOverride } = await import("@/lib/attest/fid/fixture");
    const { setFixtureXFollowers } = await import("@/lib/attest/issuers/xReach");
    const o: { followers?: number | null; score?: number | null } = {};
    if (num(body.followers) !== undefined) o.followers = num(body.followers);
    if (num(body.score) !== undefined) o.score = num(body.score);
    setFixtureFidOverride(fid, Object.keys(o).length ? o : null);
    if (body.xFollowers !== undefined) setFixtureXFollowers(fid, num(body.xFollowers) ?? undefined);
    const { fixtureFidOverrides } = await import("@/lib/attest/fid/fixture");
    return NextResponse.json({ ok: true, overrides: fixtureFidOverrides() });
  }
  if (action === "clearFixtureFacts") {
    const no = rigOnly(action);
    if (no) return no;
    const { clearFixtureFidOverrides } = await import("@/lib/attest/fid/fixture");
    const { clearFixtureXFollowers } = await import("@/lib/attest/issuers/xReach");
    clearFixtureFidOverrides();
    clearFixtureXFollowers();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
