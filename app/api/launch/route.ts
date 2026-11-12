import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PERSONA LAUNCH P6 — LAUNCH A PERSONA (on test data: the Totem registrar is SIMULATED, nothing is created on Farcaster).
//
//   GET  ?personaId=<id>              THE PREVIEW (lib/launch/preview.ts): every anon post that will be linked, the new
//                                     account, what launch narrows and what stays hidden, the timing and the price.
//                                     Device-local; writes nothing and fetches nothing (it reads the own-rows mirror of the
//                                     complete anon list the launch tick keeps — fix W2-LAUNCH-REVEAL-200). When the persona
//                                     already has a launch, its status rides along (`status`).
//   GET  ?personaId=<id>&status=1     where that persona's launch stands, in words (lib/launch/confirm.ts)
//   GET  ?history=1&fid=<fid>         a launched account's WHOLE revealed history at the original dates, every row
//                                     checked against the chain ("revealed from @anon") — public facts only
//   POST {action:"confirm", personaId, typed, fname?, displayName?, bio?, pfpUrl?, quoteOriginals?, acknowledgeCrowd?}
//                                     THE CONFIRM: typed must be exactly @handle; after a preview in the last 30 minutes;
//                                     acknowledgeCrowd when that preview asked for it (fix LP-4). 202 when the launch is
//                                     set going — in memory only; nothing is written or sent at the click.
//   POST {action:"retry", personaId}  "Try again" on a step after registration (fix UX-L6): its next attempt runs at the
//                                     next tick; nothing is sent from here.
//
// DEV HOOKS (ZK_DEV_HOOKS=true on a rig; never on a public deployment): GET &envelope=1 (the queued launch envelope, for
// the suite's header negative control), GET ?dev=1 (the device's launch records and relay log), POST tick (run the
// launch tick now, `now` moves the jittered steps' clock), reset (the launch caches), directPost / quote (the write door
// as the composer drives it), thinRelayProbe (a CastAdd signed by the persona's key or by a key that is not on the
// account: "a wrong key is refused").
//
// REFUSED: on a public deployment ("Launch isn't on this preview yet" — anonymous proving in the browser is P7) and on
// the live universe ("Launch needs the Totem registrar, which isn't set up yet" — the owner's O1).

/** a rig (a public deployment is production WITHOUT dev hooks, so it never gets these) */
function devHooks(): boolean {
  return process.env.ZK_DEV_HOOKS === "true";
}

async function deploymentRefusal(): Promise<NextResponse | null> {
  const { launchDeploymentRefusal } = await import("@/lib/launch/confirm");
  const r = await launchDeploymentRefusal();
  return r ? NextResponse.json({ error: r.reason, code: r.code }, { status: r.status }) : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { zkMode } = await import("@/lib/zk/config");
  const mode = zkMode();
  // the revealed history is a PUBLIC read (rows anyone can list, checked against the chain): it needs no proof layer —
  // only a deployment that has launch at all (never the public preview's browser device this wave)
  if (sp.get("history") !== "1") {
    const refused = await deploymentRefusal();
    if (refused) return refused;
  } else if (typeof window !== "undefined" || (await import("@/lib/platform/env-contract")).isPublicDeployment()) {
    // PUBLIC GO-LIVE (F11): the live site (PUBLIC_LIVE) is no preview; the flag-off words are unchanged
    return NextResponse.json({ error: (await import("@/lib/platform/publicLive")).isPublicLive() ? "Launch isn't on this site yet." : "Launch isn't on this preview yet.", code: "public_preview" }, { status: 409 });
  }
  if (sp.get("history") === "1") {
    const fid = Number(sp.get("fid"));
    if (!Number.isInteger(fid) || fid <= 0) return NextResponse.json({ error: "fid required" }, { status: 400 });
    try {
      const { revealedHistoryFor, REVEALED_FROM_ANON } = await import("@/lib/launch/history");
      const h = await revealedHistoryFor(fid, mode);
      return NextResponse.json({ fid, label: REVEALED_FROM_ANON, ...h, simulated: true });
    } catch (e) {
      return NextResponse.json({ error: "Couldn't read the revealed posts (" + (e as Error).message + ")." }, { status: 503 });
    }
  }
  if (sp.get("dev") === "1") {
    if (!devHooks()) return NextResponse.json({ error: "dev hooks are off" }, { status: 403 });
    const { launchRecords } = await import("@/lib/zk/anon/queue");
    const { lastRegistrationsRead, anonMirror } = await import("@/lib/launch/tick");
    const { thinRelayLog } = await import("@/lib/fc/thinRelay");
    const m = anonMirror(zkMode());
    return NextResponse.json({ records: await launchRecords(), lastRegistrationsRead: lastRegistrationsRead(), anonMirror: m ? { complete: m.complete, readAt: m.readAt, own: m.rows.size } : null, relayLog: thinRelayLog() });
  }
  const personaId = sp.get("personaId") ?? "";
  if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
  const { launchStatusFor } = await import("@/lib/launch/confirm");
  const status = await launchStatusFor(personaId);
  if (sp.get("envelope") === "1") {
    if (!devHooks()) return NextResponse.json({ error: "dev hooks are off" }, { status: 403 });
    const { launchFor } = await import("@/lib/launch/confirm");
    const rec = await launchFor(personaId);
    const { hydrate, state } = await import("@/lib/adapters/mock/store");
    await hydrate();
    const item = rec ? [...state().zkQueue.values()].find((q) => q.claimKind === "persona-launch" && (q.envelope as { publicInputs?: { launchCommit?: string } } | null)?.publicInputs?.launchCommit === rec.launchCommit) : undefined;
    return NextResponse.json({ launchCommit: rec?.launchCommit ?? null, status: item?.status ?? null, envelope: item && item.status === "queued" ? item.envelope : null });
  }
  if (sp.get("status") === "1") {
    if (!status) return NextResponse.json({ error: "No launch for this persona." }, { status: 404 });
    return NextResponse.json(status);
  }
  try {
    const { launchPreview } = await import("@/lib/launch/preview");
    const p = await launchPreview(personaId, mode);
    if (!p.ok) return NextResponse.json({ error: p.reason, code: p.code, ...(status ? { status } : {}) }, { status: status ? 200 : p.status });
    return NextResponse.json({ ...p, ...(status ? { status } : {}) });
  } catch (e) {
    // a preview that could not list every post must not look complete
    return NextResponse.json({ error: "Couldn't read your anonymous posts to build the preview (" + (e as Error).message + "). Nothing was changed." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  const refused = await deploymentRefusal();
  if (refused) return refused;
  const { zkMode } = await import("@/lib/zk/config");
  const mode = zkMode();
  const action = body.action;
  if (action === "confirm") {
    const { confirmLaunch } = await import("@/lib/launch/confirm");
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    const r = await confirmLaunch(String(body.personaId ?? ""), body.typed, {
      fname: str("fname"),
      displayName: str("displayName"),
      bio: str("bio"),
      pfpUrl: str("pfpUrl"),
      quoteOriginals: body.quoteOriginals,
      acknowledgeCrowd: body.acknowledgeCrowd,
    });
    if (!r.ok) return NextResponse.json({ error: r.reason, code: r.code }, { status: r.status });
    return NextResponse.json({ queued: true, launchCommit: r.launchCommit, fname: r.fname, note: "Nothing was sent at the click: the launch request is proved at the next tick and sent anonymously at a random time." }, { status: 202 });
  }
  if (action === "retry") {
    // fix UX-L6: "Try again" on a step after registration — brings its next attempt forward to the next tick; sends nothing
    const { retryLaunchNow } = await import("@/lib/launch/confirm");
    const r = await retryLaunchNow(String(body.personaId ?? ""));
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status });
    return NextResponse.json({ ok: true, note: "Totem tries again at its next tick." });
  }
  if (!devHooks()) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  // ------------------------------------------------------------------ dev hooks (a rig only)
  if (action === "tick") {
    const { launchTick } = await import("@/lib/launch/tick");
    const now = typeof body.now === "number" && Number.isFinite(body.now) ? body.now : undefined;
    return NextResponse.json(await launchTick(mode, { now }));
  }
  if (action === "reset") {
    const { resetLaunchCaches } = await import("@/lib/launch/confirm");
    const { resetChainFixtureCache } = await import("@/lib/fc/chain/fixture");
    const { resetThinRelay } = await import("@/lib/fc/thinRelay");
    resetLaunchCaches();
    resetChainFixtureCache();
    resetThinRelay();
    return NextResponse.json({ ok: true });
  }
  if (action === "directPost" || action === "quote") {
    const personaId = String(body.personaId ?? "");
    const text = String(body.text ?? "");
    if (!personaId || !text) return NextResponse.json({ error: "personaId and text required" }, { status: 400 });
    const { publishFcCast, FcIdentityError, FcSelfLinkError } = await import("@/lib/fc/writes");
    try {
      if (action === "directPost") {
        // exactly the composer's path: where does it go (farcasterDelivery.ts), then the write door, guarded
        const { deliveryFor, isFarcaster } = await import("@/app/api/actions/farcasterDelivery");
        const d = await deliveryFor(personaId);
        if (!isFarcaster(d)) return NextResponse.json({ delivery: d }, { status: 200 });
        const r = await publishFcCast(text, "cast", undefined, { personaId, requireFid: d.fid, requireMode: d.mode });
        return NextResponse.json({ delivery: d, hash: r.hash, fid: r.fid, mode: r.mode, deduped: r.deduped });
      }
      const quoteOf = String(body.quoteOf ?? "");
      const r = await publishFcCast(text, "cast", undefined, { personaId, quoteOf });
      return NextResponse.json({ hash: r.hash, fid: r.fid, mode: r.mode, deduped: r.deduped });
    } catch (e) {
      const status = e instanceof FcSelfLinkError || e instanceof FcIdentityError ? 403 : (e as { definitive?: boolean }).definitive ? 422 : 503;
      return NextResponse.json({ error: (e as Error).message, code: (e as { code?: string }).code ?? null, selfLink: e instanceof FcSelfLinkError }, { status });
    }
  }
  if (action === "thinRelayProbe") {
    // a CastAdd for `fid`, signed by the persona's own key ("persona") or by a fresh key that is on no account ("wrong")
    const fid = Number(body.fid);
    const personaId = String(body.personaId ?? "");
    const text = String(body.text ?? "probe");
    const { submitThinMessage, thinCanonical } = await import("@/lib/fc/thinRelay");
    const unsigned = { type: "CastAdd" as const, fid, signerPubKey: "", timestamp: Date.now(), text, parentHash: null, quoteHash: null };
    let signature: string | null = null;
    if (body.signWith === "wrong") {
      const { randomBytes } = await import("@/lib/platform/crypto");
      const { publicKeyOf, signCanonical } = await import("@/lib/crypto/ed25519");
      const seed = new Uint8Array(randomBytes(32));
      unsigned.signerPubKey = publicKeyOf(seed);
      signature = signCanonical(thinCanonical(mode, unsigned), seed);
    } else {
      const { fcSignerPublicKeyFor, signAsFcSignerFor } = await import("@/lib/identity/keys");
      unsigned.signerPubKey = fcSignerPublicKeyFor(personaId) ?? "";
      signature = signAsFcSignerFor(personaId, thinCanonical(mode, unsigned));
    }
    if (!signature) return NextResponse.json({ error: "could not sign" }, { status: 400 });
    const r = await submitThinMessage(mode, { ...unsigned, signature });
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
