import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaByHandle, personaById, state } from "@/lib/adapters/mock/store";
import {
  currentGrantHolders,
  issueForwardPointer,
  reissueGrants,
  resolveForwardPointer,
} from "@/lib/identity/fork";
import { persistNs } from "@/lib/adapters/mock/store";
import { BETRAYAL, isSuspect } from "@/lib/identity/seedGrants";
import { kindOf } from "@/lib/identity/personaKind";
import { randomBytes } from "@/lib/platform/crypto";
// MULTI-FID Gate 5 (attack-fid-1 #5): a new handle that is the old one with a suffix, a prefix of it, or the old one
// minus its trailing digits publishes the fork in the fname registry. CONNECT MAIN review (PL-4): the same rule keeps
// every persona's handle off the owner's main account's name — one copy of it, in lib/identity/handleStem.ts.
import { handleDerivedFrom } from "@/lib/identity/handleStem";
import { localAvatar } from "@/lib/identity/localAvatar";

export const dynamic = "force-dynamic";

const idOf = (v: string | undefined | null): string | null => {
  if (!v) return null;
  const byHandle = personaByHandle.get(v);
  if (byHandle) return byHandle.id;
  return personaById.has(v) ? v : null;
};

/**
 * GET — the fork wizard's data, or a forward-pointer resolution.
 *
 * `?resolve=<persona>` asks "did this account move?". It answers ONLY for a
 * carried grant-holder. A dropped holder gets the same null here as they do
 * in the UI: forcing the adapter call directly buys them nothing.
 */
export async function GET(req: NextRequest) {
  const personaId = idOf(req.nextUrl.searchParams.get("personaId"));
  const resolveFor = req.nextUrl.searchParams.get("resolve");
  const viewerParam = req.nextUrl.searchParams.get("viewerPersonaId");
  const viewer =
    viewerParam === null ? activeSeedPersonaId() : viewerParam === "" ? null : idOf(viewerParam);
  // GATE 5 (attack-post-1 F-4, residual): the forward pointer calls itself "FAIL CLOSED by
  // construction" because it matches a grant against THE VIEWER — but the viewer was
  // caller-supplied, so naming a holder returned by the audience read above turned the
  // resolver into an oracle for the victim's new persona id, name, handle, fid and the fork
  // commitment with its nonce. A caller may still name a viewer (the rig does), but only one
  // this device actually controls; anyone else's is refused rather than honoured.
  if (viewerParam !== null && viewerParam !== "" && viewer) {
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    const { getSession } = await import("@/lib/session");
    const own = new Set([...(await ownPersonaIdsAll()), ...(await getSession()).personas.map((x) => x.id)]);
    if (!own.has(viewer))
      return NextResponse.json(
        { error: "viewerPersonaId must be one of your own personas", code: "not_own_viewer" },
        { status: 403 }
      );
  }

  try {
    if (resolveFor) {
      const old = idOf(resolveFor);
      if (!old) return NextResponse.json({ error: "unknown persona" }, { status: 404 });
      const s = state();
      const record = s.forks.get(old);
      // No fork, or no grant naming this viewer → null. Not an error, not a
      // hint that something exists: the honest answer is "nothing to tell you".
      const forwardIds = new Set(record?.forwardGrantIds ?? []);
      const moved = resolveForwardPointer(old, viewer, forwardIds);
      const target = moved ? personaById.get(moved) : null;
      // ZK PASS 2 Gate 3: a CARRIED holder is handed the continuity
      // commitment AND its nonce, so they can open sha256(old|new|nonce)
      // themselves and check the validator's fork-claim record — the
      // validator never held the old persona, only the commitment.
      const continuity = moved && record?.forkCommit && record.forkNonce ? { forkCommit: record.forkCommit, forkNonce: record.forkNonce, personaId: moved } : null;
      // MULTI-FID Gate 3: the forward pointer resolves to the NEW account (fid + fname) for a carried holder only
      let movedFid: { fid: number; fname: string | null } | null = null;
      if (moved) {
        const { personaFidRecord } = await import("@/lib/fc/personaFid");
        const rec = await personaFidRecord(moved);
        if (rec) movedFid = { fid: rec.fid, fname: rec.fname };
      }
      return NextResponse.json({
        moved: moved ?? null,
        persona: target ? { id: target.id, name: target.name, handle: target.handle, avatarUrl: target.avatarUrl } : null,
        continuity,
        movedFid,
      });
    }

    if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const holders = currentGrantHolders(personaId).map((h) => ({
      ...h,
      handle: personaById.get(h.audienceMember)?.handle ?? h.audienceMember,
      name: personaById.get(h.audienceMember)?.name ?? h.audienceMember,
      avatarUrl: personaById.get(h.audienceMember)?.avatarUrl ?? null,
      // Demo staging only — see BETRAYAL. Flags which box starts unticked.
      suspect: isSuspect(personaId, h.audienceMember),
    }));
    const source = personaById.get(personaId);
    return NextResponse.json({
      personaId,
      handle: source?.handle ?? null,
      name: source?.name ?? null,
      holders,
      suspicion: holders.some((h) => h.suspect) ? BETRAYAL.note : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

/** POST — perform the fork. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  // POST-DEPLOY Gate 1: resolve against the SESSION's roster as well as the rendering map. A persona this device
  // minted lives in the device's roster and may not be in the seeded map at all, so forking or cloning one by its
  // own id used to answer "fromPersona required" for a persona the picker was showing. Registering it here also
  // makes every later `personaById.get` in this route find it.
  // PERSONA LAUNCH P1 (SIWF): never a fork FROM the read-only public self — asked of the raw id FIRST, so the answer
  // is the refusal whether or not this process's rendering map or session lists that persona (asked again below on
  // the resolved id, for a handle that resolves to it)
  {
    const { publicSelfRefusalFor, PUBLIC_SELF_NO_FORK_SENTENCE } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = typeof body.fromPersona === "string" ? body.fromPersona : null;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null), PUBLIC_SELF_NO_FORK_SENTENCE);
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }
  let fromPersona = idOf(body.fromPersona);
  if (!fromPersona && typeof body.fromPersona === "string") {
    const { getSession } = await import("@/lib/session");
    const session = await getSession();
    const mine = session.personas.find((p) => p.id === body.fromPersona || p.handle === body.fromPersona);
    if (mine) {
      if (!personaById.has(mine.id)) {
        personaById.set(mine.id, { id: mine.id, rootId: session.rootId ?? "", name: mine.name, handle: mine.handle, avatarUrl: mine.avatarUrl ?? "", bio: mine.bio ?? "", cluster: "", tier: 1, demoTags: ["roster"] } as unknown as NonNullable<ReturnType<typeof personaById.get>>);
        if (!personaByHandle.has(mine.handle)) personaByHandle.set(mine.handle, personaById.get(mine.id)!);
      }
      fromPersona = mine.id;
    }
  }
  if (!fromPersona) return NextResponse.json({ error: "fromPersona required" }, { status: 400 });
  // PERSONA LAUNCH P1 (SIWF): never a fork FROM the read-only public self. A fork carries a continuity proof to its
  // source, which would publicly link the new persona to the visitor's own Farcaster account (D-SIWF-3).
  {
    const { publicSelfRefusalFor, PUBLIC_SELF_NO_FORK_SENTENCE } = await import("@/lib/identity/handleStem");
    const { getPersona } = await import("@/lib/identity/keystore");
    const who = fromPersona;
    const refusal = publicSelfRefusalFor(() => (who ? getPersona(who) : null), PUBLIC_SELF_NO_FORK_SENTENCE);
    if (refusal) return NextResponse.json(refusal, { status: 403 });
  }

  // GATE 5 (attack-post-1 F-4): WHAT A NON-OWNED SOURCE MAY HAND YOU.
  //
  // lib/identity/clone.ts says in its own docstring that "the personas must both belong to
  // the caller's root — the route checks that", and the route did not: the only ownership
  // gate was a signing refusal further down that `carry: []` skips entirely. So
  // `{fromPersona: "<a stranger>", startFrom: true}` copied that stranger's rules, modes and
  // folders onto a new persona of the caller's root, and took their TIER with it.
  //
  // The fork itself is deliberately NOT gated: the fixture fork demo forks a seeded ACCOUNT
  // to show forward pointers and grant carry, and three suites depend on that. What is gated
  // is the two things the finding is really about — the settings copy and the tier — because
  // those are the parts that transfer something of the source's to you.
  const sourceIsOwn = await (async () => {
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    const { getSession } = await import("@/lib/session");
    const own = new Set([...(await ownPersonaIdsAll()), ...(await getSession()).personas.map((p) => p.id)]);
    return own.has(fromPersona);
  })();
  if (body.startFrom && !sourceIsOwn)
    return NextResponse.json(
      { error: "not one of your personas — you can fork from any account, but you can only START FROM the settings of one you control", code: "not_own" },
      { status: 403 }
    );

  const carry = (body.carry ?? []).map(idOf).filter(Boolean) as string[];
  const allHolders = currentGrantHolders(fromPersona).map((h) => h.audienceMember);
  const dropped = allHolders.filter((h) => !carry.includes(h));

  try {
    const source = personaById.get(fromPersona);
    if (!source) return NextResponse.json({ error: "unknown persona" }, { status: 404 });

    // Reputation lives on the ROOT, so the new persona inherits the tier
    // immediately. Asserted by the acceptance test — it is the whole point.
    // GATE 5 (attack-post-1 F-4, the tier half — REVERTED, deliberately).
    //
    // The tier carries from the SOURCE, including a source you do not own. The review is
    // right that this hands you a stranger's standing, and the closing sweep is right that
    // changing it breaks a contract this product STATES and TESTS: "the new persona inherits
    // the tier immediately" is asserted by accept-m2 check 3 and is the whole point of the
    // fork demo. A review finding outranks an unstated assumption; it does not outrank a
    // stated, tested contract, and quietly changing one to close a fixture-only exposure is
    // how a product ends up disagreeing with its own documentation.
    //
    // The half with no counter-contract IS closed: `startFrom` above refuses a source you do
    // not own, so a stranger's rules, modes and folders cannot be copied onto your persona.
    // The tier is carried under A-POST-THE-FIXTURE-FORK-IS-A-DEMO, which says what it costs:
    // a production deployment has no seeded accounts to fork, and against real accounts this
    // affordance would not exist.
    const tier = await retryAdapter(() => adapters.rep.tierFor(fromPersona));

    // MULTI-FID Gate 5 (attack-fid-1 #5, attack-fid-3 #13): in per-persona-fid mode the new persona becomes a NETWORK
    // account — a private source never forks into one, the new name shares no stem with the old, and nothing of the
    // old profile (avatar, bio) is copied onto the new account
    const { personaNetworkMode } = await import("@/lib/fc/networkMode");
    const perPersonaFid = personaNetworkMode() === "per-persona-fid";
    // a PRIVATE source forks into a PRIVATE persona (no account, no fid): the fork keeps its continuity machinery and
    // the network never learns either persona exists
    const forkKind: "public" | "private" = kindOf(fromPersona) === "private" ? "private" : "public";
    const requestedHandle = typeof body.newHandle === "string" ? body.newHandle : null;
    // the name-stem rule protects an ACCOUNT PAIR: it applies when the source already owns a network account (a fid
    // record); a fork of a persona with no account has no old fname to be linked to (the mega-gate's forks)
    if (perPersonaFid && requestedHandle && handleDerivedFrom(requestedHandle, source.handle)) {
      const { personaFidRecord } = await import("@/lib/fc/personaFid");
      if (await personaFidRecord(fromPersona)) {
        return NextResponse.json({ error: "the new handle is derived from the old one — a fork's account must share no name stem with its predecessor's" }, { status: 400 });
      }
    }
    // CONNECT MAIN review (PL-4): nor with the owner's connected main account's name (main stays main after a
    // disconnect). The default handle in per-persona-fid mode is random, so only a requested one is checked.
    // PERSONA LAUNCH P1 (SIWF): and with the visitor's signed-in Farcaster account, IN THE DEVICE TOO (the check used to
    // be per-persona-fid only, because the browser device never held a main account; now it can). lib/identity/
    // mainName.ts reads the connected record on a server and the sealed accountLinks record wherever a sign-in can run.
    // The defaults need no check: a random handle shares no stem, and "<source>_2" derives from main only if its
    // source already did, which the sign-in itself refuses (a clashing persona blocks the sign-in until renamed).
    if (requestedHandle) {
      const { mainNameDerivation } = await import("@/lib/identity/mainName");
      const why = await mainNameDerivation(requestedHandle); // THROWS on an unreadable vault: refused below, never guessed
      if (why) return NextResponse.json({ error: why, code: "handle_stem" }, { status: 400 });
    }
    const freshSeed = randomBytes(8).toString("hex");
    const created = await retryAdapter(() =>
      adapters.identity.createPersona({
        name: body.newName ?? (perPersonaFid ? "New persona" : `${source.name} (new)`),
        handle: body.newHandle ?? (perPersonaFid ? "u" + freshSeed.slice(0, 8) : `${source.handle}_2`),
        kind: forkKind,
        // PUBLIC GO-LIVE: a per-persona-fid fork's fresh picture is drawn locally (lib/identity/localAvatar.ts), no image host
        avatarUrl: body.newAvatarUrl ?? (perPersonaFid ? localAvatar(freshSeed) : source.avatarUrl),
        bio: perPersonaFid ? "" : source.bio,
        cluster: source.cluster,
        forkedFrom: fromPersona,
      })
    );

    // Register the new persona in the seeded map so every surface can render
    // it (seed personas are the rendering source of truth in mock mode).
    personaById.set(created.id, {
      id: created.id,
      rootId: source.rootId,
      name: created.name,
      handle: created.handle,
      avatarUrl: created.avatarUrl ?? source.avatarUrl,
      bio: created.bio ?? source.bio,
      cluster: source.cluster,
      tier,
      demoTags: ["forked"],
    });
    personaByHandle.set(created.handle, personaById.get(created.id)!);

    // POST-DEPLOY Gate 1 (D-POST-1-A-NEW-PERSONA-JOINS-THE-ROSTER): register it in the DEVICE's own root roster
    // too. The rendering map above is what draws a persona; the roster is what makes it one of yours — the session
    // reads `personaIdsForRoot`, so a persona missing from it is invisible to the picker, unswitchable, and
    // effectively did not happen. It has always been the fork's omission; cloning made it load-bearing.
    // the CALLER's root, not the source record's: on a device whose keystore root differs from the seeded one they
    // are not the same, and recording under the wrong root leaves the new persona in nobody's roster
    // Resolve the root the SESSION lists personas for, by the same path the session uses: an explicit root when a
    // root cookie is set, otherwise the one this device holds for the self account. Recording under the source
    // record's own rootId is wrong whenever those differ, and on a device with its own keystore they do.
    const { getSession } = await import("@/lib/session");
    const { rootForFid, ownRootId } = await import("@/lib/identity/rootRoster");
    const { getSelf } = await import("@/lib/data");
    const { isEmptyWorld } = await import("@/lib/world-flag");
    const sessionRoot = (await getSession()).rootId;
    // LAYERS_WORLD=empty (review WORLD-ID-2 / F4): a fork is filed under THE SERVICE'S OWN ROOT (lib/identity/rootRoster.ts
    // ownRootId, registered on first need) — never the seeded self's fixture root that rootForFid(9152) resolved to, nor
    // the source record's rootId ("" for a real persona, so the fork was recorded nowhere). An unreadable roster THROWS
    // (fail closed): the route's catch answers 503 with the persona minted, and the roster's next read files it.
    const rosterRoot = isEmptyWorld() ? await ownRootId() : sessionRoot ?? (await rootForFid(getSelf().fid)) ?? source.rootId;
    if (rosterRoot) {
      const { recordPersona } = await import("@/lib/identity/rootRoster");
      await recordPersona(rosterRoot, created.id, {
        id: created.id,
        name: created.name,
        handle: created.handle,
        avatarUrl: created.avatarUrl ?? source.avatarUrl ?? null,
        bio: created.bio ?? source.bio ?? null,
        createdAt: Date.now(),
      });
    }

    // A signing refusal ("fork: cannot sign grant as …") is a permanent
    // authorization failure, not adapter flake — 403, not the catch-all 503.
    let forwardGrantIds: string[];
    let reissuedGrantIds: string[];
    try {
      forwardGrantIds = issueForwardPointer(fromPersona, created.id, carry);
      reissuedGrantIds = reissueGrants(fromPersona, created.id, carry);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 403 });
    }

    // ZK PASS 2 Gate 3: FORK CONTINUITY AS A PROOF. The commitment hides
    // the old persona behind a nonce; the nonce lives in the (vault-sealed)
    // fork record and travels only with the disclosure-gated forward
    // pointer. Under the zk binding the new persona's tier carries ONLY
    // through the fork-continuity proof the next tick makes.
    const { createHash: sha, randomBytes: rnd } = await import("node:crypto");
    const forkNonce = rnd(16).toString("hex");
    const forkCommit = sha("sha256").update(["layers-fork-commit/1", fromPersona, created.id, forkNonce].join("|")).digest("hex");
    let proofRequested = false;
    {
      const { currentRepImpl } = await import("@/lib/adapters/registry");
      if (currentRepImpl() === "zk") {
        const { requestForkContinuity } = await import("@/lib/zk/gate");
        proofRequested = requestForkContinuity(created.id, forkCommit);
      }
    }
    // MULTI-FID Gate 3: in per-persona-fid mode the fresh persona gets a FRESH fid through the same
    // spend-capped path — minted here on fixture, the user's command on live (the response says which).
    // The OLD fid stays live as the decoy; the two records share nothing but the plain map's shape.
    let newFid: { fid: number; fname: string | null } | null = null;
    let fidPending = false;
    {
      const { personaNetworkMode } = await import("@/lib/fc/networkMode");
      // (Gate 5) a private fork never gets an account: no mint, nothing pending
      if (personaNetworkMode() === "per-persona-fid" && forkKind === "public") {
        const { acquireFixtureFid } = await import("@/lib/fc/acquire");
        const liveOnly = process.env.PERSONA_FID_LIVE_ONLY === "true";
        if (!liveOnly) {
          const r = await acquireFixtureFid(created.id);
          if (!("refused" in r)) newFid = { fid: r.fid, fname: r.fname };
          else fidPending = true;
        } else {
          fidPending = true;
        }
      }
    }
    state().forks.set(fromPersona, {
      oldPersona: fromPersona,
      newPersona: created.id,
      forwardGrantIds,
      carried: carry,
      dropped,
      forkedAt: Date.now(),
      forkCommit,
      forkNonce,
    });
    await persistNs("forks");
    await persistNs("grantsV3");
    // GATE 4: a minted persona's nonce lives only in the keystore file,
    // which total device loss destroys — mirror the roster into the vault
    // so recovery can bring this fork back. Best-effort: a roster-sync
    // failure must not fail the fork (the persona still exists locally),
    // but it is the recovery path, so it is attempted on every mint.
    try {
      const { syncRoster } = await import("@/lib/identity/roster");
      await syncRoster();
    } catch {
      /* roster sync is best-effort; recovery health is surfaced separately */
    }

    // POST-DEPLOY Gate 1 — "start from": the new persona inherits the source's SETTINGS as its own artifacts.
    // Opt-in per class and reported rather than promised, so the response says what was actually copied. A copy
    // failure is not a fork failure: the persona exists either way, and a half-copied settings set is visible in
    // the report instead of being silently presented as complete.
    let clone: Record<string, unknown> | null = null;
    if (body.startFrom) {
      try {
        const { copySettings } = await import("@/lib/identity/clone");
        const copyOpts = (body.copy ?? {}) as { settings?: boolean; folders?: boolean };
        clone = { ...(await copySettings(fromPersona, created.id, copyOpts)) } as Record<string, unknown>;
      } catch (e) {
        clone = { error: (e as Error).message };
      }
    }

    // POST-DEPLOY Gate 2: the tint is CHOSEN AT CREATION when the caller names
    // one, and otherwise auto-assigned to a colour no sibling is using — the
    // report says which, because "your new persona is blue" and "your new
    // persona happens to be blue today" are different promises. A tint failure
    // never fails a fork: the persona exists, and the pill is the real cue.
    let tint: Record<string, unknown> | null = null;
    try {
      const { setTint, tintsFor } = await import("@/lib/identity/chrome");
      const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
      if (typeof body.tint === "string" && body.tint) {
        const r = await setTint(created.id, body.tint, [...(await ownPersonaIdsAll()), created.id]);
        tint = r.ok ? { ...r.tint } : { error: r.reason, code: r.code };
      } else {
        // GATE 5 (attack-post-3 F-8): PERSIST the assignment rather than reporting a colour
        // nothing stores. The auto-assignment is a deterministic function of the roster, so
        // it MOVES when the roster changes — delete a sibling and a third persona's chrome
        // silently becomes the colour the deleted one had. Writing it at creation is what
        // "chosen at creation" was supposed to mean, and it makes the accent the persona's
        // own for as long as it exists.
        const ids = [...(await ownPersonaIdsAll()), created.id];
        const assigned = await tintsFor(ids);
        const picked = assigned[created.id];
        if (picked) {
          const persisted = await setTint(created.id, picked.color, ids);
          tint = persisted.ok ? { ...persisted.tint } : { ...picked };
        } else {
          tint = null;
        }
      }
    } catch (e) {
      tint = { error: (e as Error).message };
    }

    return NextResponse.json({
      oldPersona: fromPersona,
      newPersona: created.id,
      newHandle: created.handle,
      tint,
      tier,
      carried: carry,
      dropped,
      clone,
      forwardGrantIds,
      reissuedGrantIds,
      continuity: { forkCommit, proofRequested },
      // MULTI-FID Gate 3
      newFid,
      fidPending,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
