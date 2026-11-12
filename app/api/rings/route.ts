import { NextRequest, NextResponse } from "next/server";
// PERSONA LAUNCH P4 — RINGS (device-served: the visitor's browser device answers it on a public deployment; the rig and
// the owner service answer it themselves). Everything here is THIS root's own: its rings, its addresses, what it
// received. Works with zero personas (LAYERS_WORLD=empty: an empty pane, never an error).
//
// GET                    the panes' state — rings (names, personas, depths, members by a short reference), the publish
//                        line, this device's addresses (a short reference and a name only), what it received. NEVER a
//                        PSK, a note key, a drop token or a full address: GET payloads are what the leak greps scan.
// GET ?fid=<n>           what a ring told this device about that Farcaster account (a profile's "Shared with you")
// POST {action}          createRing {label, shareAs?} · renameRing {ringId, label, shareAs?} · deleteRing {ringId} ·
//                        addMember {ringId, address, label?} · makeLink {ringId, label?} (answers the link ONCE; refused
//                        on the owner service — UX-R2) · setDepth {ringId, personaId, depth: "name"|"posts"|null} ·
//                        revokeMember {ringId, memberId} · createAddress {label?} (hands out a spare with its QR — no
//                        write, LP-3) · listAddresses (the full addresses, asked for) · forgetAddress {addrId} (hidden,
//                        never deleted — UX-R4) · restoreAddress {addrId} · listForgottenAddresses
//                        PERSONA LAUNCH GO-LIVE (UXH-9): restoreMember {ringId, memberId} · restoreRing {ringId} — Remove
//                        and Delete ring HIDE (Settings › Rings › Recently removed, GET's `recentlyRemoved`), and these
//                        bring a record back as a join: from now on, never the posts made while it was removed
//                        SPEC C: send {ringId, target: {fid, hash}} — a Farcaster post to everyone in a ring (ids only,
//                        sealed with the next statement; 409 acting_persona while a persona acts, 403 own_persona)
//
// UX-R2: on the OWNER SERVICE (lib/world-flag.ts isOwnerService) the panes are told `ownerService: true` — rings made
// there are published to the owner service's own validator, which no public-site device reads, and a /d link there
// opens only behind the owner gate. The pane says so in one plain line instead of promising delivery.
//
// LP-2: a change refused because another device of this root sealed first answers 409 with the sentence.
// POST dev actions       ZK_DEV_HOOKS=true only (the rig): publishNow · tickNow {mode?} · cacheProbe · leakNeedles ·
//                        dropProbe · noteProbe {castHash, note?, keys?}
//
// COMPARTMENT MODE: the persona lists are the personas the view scope shows (lib/identity/chrome.ts
// visibleOwnPersonaIds); a persona the scope hides cannot be shared from this view. Never fail open: an unread rings
// document, an unread view scope — 503 with the reason, never an empty pane that looks like "no rings".

export const dynamic = "force-dynamic";

const devHooksOn = () => process.env.ZK_DEV_HOOKS === "true";

/** UX-R2: the one plain line the owner service shows instead of a delivery promise */
const OWNER_SITE_RINGS_LINE = "Rings made on this owner site reach only devices that read this site's server, and don't reach people on the public site yet.";

async function onOwnerService(): Promise<boolean> {
  return (await import("@/lib/world-flag")).isOwnerService();
}

function refusal(e: unknown, status = 400): NextResponse {
  const msg = (e as Error)?.message ?? String(e);
  const name = (e as Error)?.name;
  if (name === "RingsChanged") return NextResponse.json({ error: msg, code: "changed-elsewhere" }, { status: 409 });
  const unread = /couldn't read your rings|haven't been read|vault:|reset while/.test(msg);
  return NextResponse.json({ error: msg }, { status: unread ? 503 : status });
}

async function visiblePersonaIds(): Promise<Set<string>> {
  const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
  return new Set(await visibleOwnPersonaIds());
}

export async function GET(req: NextRequest) {
  const fidParam = req.nextUrl.searchParams.get("fid");
  if (fidParam !== null) {
    const fid = Number(fidParam);
    if (!Number.isSafeInteger(fid) || fid <= 0) return NextResponse.json({ error: "fid must be a positive integer" }, { status: 400 });
    const { sharedForFid } = await import("@/lib/rings/merge");
    return NextResponse.json({ shared: sharedForFid(fid) });
  }
  try {
    const { ringsPaneView } = await import("@/lib/rings/outbound");
    const { publishView } = await import("@/lib/rings/publisher");
    const { receivedStatus } = await import("@/lib/rings/received");
    const { loadRingsDoc } = await import("@/lib/rings/model");
    const { addressSummaries } = await import("@/lib/rings/inbox");
    const view = await ringsPaneView();
    const visible = await visiblePersonaIds();
    const doc = await loadRingsDoc();
    const addresses = addressSummaries(doc);
    return NextResponse.json({
      testData: true,
      ownerService: await onOwnerService(),
      ownerServiceLine: OWNER_SITE_RINGS_LINE,
      rings: view.rings.map((r) => ({ ...r, personas: r.personas.filter((p) => visible.has(p.personaId)) })),
      // UXH-9: what Remove and Delete ring hid — labels, counts and short references only (no persona, no address)
      recentlyRemoved: view.recentlyRemoved,
      admissible: view.admissible.filter((p) => visible.has(p.personaId)).map((p) => ({ personaId: p.personaId, handle: p.handle, name: p.name, hasAccount: typeof p.fid === "number" })),
      limits: view.limits,
      publish: await publishView(),
      // handed-out addresses only (a short reference and a name — never the address); spares are not listed
      addresses: addresses.active,
      forgottenAddresses: addresses.forgotten,
      received: receivedStatus(),
    });
  } catch (e) {
    return refusal(e, 503);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    const out = await import("@/lib/rings/outbound");
    switch (action) {
      case "createRing":
        return NextResponse.json({ ok: true, ...(await out.createRing(body.label, body.shareAs)) });
      case "renameRing":
        await out.renameRing(str("ringId"), body.label, body.shareAs);
        return NextResponse.json({ ok: true });
      case "deleteRing":
        return NextResponse.json({ ok: true, ...(await out.deleteRing(str("ringId"))) });
      case "addMember":
        return NextResponse.json({ ok: true, ...(await out.addMember(str("ringId"), body.address, body.label)) });
      case "makeLink":
        // UX-R2: a link made here would open only behind the owner gate, for the owner — refused, not promised
        if (await onOwnerService()) return NextResponse.json({ error: "A link made here would open only for you. " + OWNER_SITE_RINGS_LINE, code: "owner-service" }, { status: 409 });
        return NextResponse.json({ ok: true, ...(await out.makeLink(str("ringId"), body.label)) });
      case "setDepth": {
        const depth = body.depth === "name" || body.depth === "posts" ? body.depth : body.depth === null || body.depth === "" || body.depth === undefined ? null : "bad";
        if (depth === "bad") return NextResponse.json({ error: 'depth is "name", "posts" or nothing' }, { status: 400 });
        if (!(await visiblePersonaIds()).has(str("personaId"))) return NextResponse.json({ error: "that persona isn't one this view can share (compartment mode shows only the active persona)" }, { status: 403 });
        await out.setDepth(str("ringId"), str("personaId"), depth);
        return NextResponse.json({ ok: true });
      }
      case "revokeMember":
        return NextResponse.json({ ok: true, ...(await out.revokeMember(str("ringId"), str("memberId"))) });
      case "restoreMember":
        return NextResponse.json({ ok: true, ...(await out.restoreMember(str("ringId"), str("memberId"))) });
      case "restoreRing":
        return NextResponse.json({ ok: true, ...(await out.restoreRing(str("ringId"))) });
      case "createAddress": {
        const { createAddress } = await import("@/lib/rings/inbox");
        return NextResponse.json({ ok: true, address: await createAddress(typeof body.label === "string" ? body.label : null) });
      }
      case "listAddresses": {
        const { listAddresses } = await import("@/lib/rings/inbox");
        return NextResponse.json({ addresses: await listAddresses() });
      }
      case "forgetAddress": {
        const { forgetAddress } = await import("@/lib/rings/inbox");
        return NextResponse.json({ ok: true, forgotten: await forgetAddress(str("addrId")) });
      }
      case "restoreAddress": {
        const { restoreAddress } = await import("@/lib/rings/inbox");
        return NextResponse.json({ ok: true, restored: await restoreAddress(str("addrId")) });
      }
      case "listForgottenAddresses": {
        const { listForgottenAddresses } = await import("@/lib/rings/inbox");
        return NextResponse.json({ forgotten: await listForgottenAddresses() });
      }
      case "send": {
        // SPEC C — CLOSE-FRIEND SENDS: a Farcaster post (fid + hash) to everyone in one ring, sealed with the next
        // statement; refused while a persona acts and for a post by one of your personas (lib/rings/outbound.ts)
        try {
          return NextResponse.json({ ok: true, ...(await out.sendToRing(str("ringId"), body.target)) });
        } catch (e) {
          if (e instanceof out.RingSendRefused) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
          throw e;
        }
      }
    }
    if (!devHooksOn()) return NextResponse.json({ error: action ? `unknown action ${action}` : "action required" }, { status: action && DEV_ACTIONS.has(action) ? 403 : 400 });
    return await devAction(action, body);
  } catch (e) {
    return refusal(e);
  }
}

const DEV_ACTIONS = new Set(["publishNow", "tickNow", "cacheProbe", "leakNeedles", "dropProbe", "noteProbe"]);

/** the rig's levers (ZK_DEV_HOOKS=true): force a publish or a rings tick, read the caches, the leak needles */
async function devAction(action: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (action === "publishNow") {
    const { publishOnce } = await import("@/lib/rings/publisher");
    return NextResponse.json(await publishOnce({ force: true }));
  }
  if (action === "tickNow") {
    const { ringsTick } = await import("@/lib/rings/tick");
    const { zkMode } = await import("@/lib/zk/config");
    const mode = body.mode === "live" ? "live" : body.mode === "fixture" ? "fixture" : zkMode();
    return NextResponse.json({ tick: await ringsTick(mode) });
  }
  if (action === "cacheProbe") {
    // counts only: what the reset contract must empty (arm → reset → read back empty)
    const { ringsDocLoaded, ringsDocSecretsForLeakTest, pendingClaims, upkeepDueAt } = await import("@/lib/rings/model");
    const { receivedCounts } = await import("@/lib/rings/received");
    const { publishStatus } = await import("@/lib/rings/publisher");
    const { ringsTickLog } = await import("@/lib/rings/tick");
    const { hydratedNamespace } = await import("@/lib/adapters/mock/persist");
    const { addressCount } = await import("@/lib/rings/inbox");
    const sec = ringsDocSecretsForLeakTest();
    const g = globalThis as unknown as { __layersRingInbox?: Map<string, unknown>; __layersRings?: { doc: import("@/lib/rings/model").RingsDoc | null } };
    // LP-3: a tick that lands after a reset writes the NEW root's first document with fresh spare addresses — that is
    // the new root's material, not a survivor. So `addresses` counts the addresses handed out, and `inboxKeys` the
    // cached keys of anything but this document's unclaimed spares; `spares` is reported beside them.
    const doc = g.__layersRings?.doc ?? null;
    const claims = pendingClaims();
    const spareNonces = new Set(doc ? Object.entries(doc.inbox).filter(([id, e]) => e.spare && !e.forgottenAt && !claims[id]).map(([, e]) => e.nonce) : []);
    return NextResponse.json({
      docLoaded: ringsDocLoaded(),
      rings: sec.labels.length,
      noteKeys: sec.noteKeys.length,
      addresses: doc ? addressCount(doc) : 0,
      spares: spareNonces.size,
      liveRows: sec.tokens.length,
      inboxKeys: [...(g.__layersRingInbox?.keys() ?? [])].filter((nonce) => !spareNonces.has(nonce)).length,
      received: receivedCounts(),
      publishAttempted: publishStatus().lastAttemptAt !== null,
      ticks: ringsTickLog().length,
      hydrateCopy: hydratedNamespace("rings") === undefined ? "none" : "held",
      // LP-3: address claims not sealed yet, and whether the deferred upkeep has its moment drawn
      pendingClaims: Object.keys(pendingClaims()).length,
      upkeepScheduled: upkeepDueAt() !== null,
    });
  }
  if (action === "leakNeedles") {
    // every secret the rings code holds on this device, for scripts/root-leak.mjs and the rig's DB grep
    const { ringsDocSecretsForLeakTest, loadRingsDoc } = await import("@/lib/rings/model");
    const { inboxMaterialForLeakTest } = await import("@/lib/rings/inbox");
    const { receivedNoteKeysForDebug } = await import("@/lib/rings/received");
    const doc = await loadRingsDoc();
    const sec = ringsDocSecretsForLeakTest(doc);
    return NextResponse.json({ ...sec, inbox: await inboxMaterialForLeakTest(), receivedKeys: receivedNoteKeysForDebug().map((k) => k.keyHex) });
  }
  if (action === "dropProbe") {
    // the drop's write rules, through THIS device's signature: unsigned refused, 3 rows refused, 4 accepted (then
    // deleted again by their tokens — the probe leaves nothing behind)
    const { putDropBatch, putDropRaw } = await import("@/lib/rings/publisher");
    const env = await import("@/lib/rings/envelope");
    const { validatorUrl } = await import("@/lib/ports");
    const mk = async () => {
      const d = await env.dummyRowParts();
      const token = env.newToken();
      return { row: { id: env.newRowId(), ...d, expiresHour: env.hourOf(Date.now()) + 2, delHash: env.delHashOf(token) }, token };
    };
    const four = await Promise.all([mk(), mk(), mk(), mk()]);
    const unsignedRes = await fetch(validatorUrl() + "/rings/drop/batch", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: four.map((x) => x.row), deletes: [] }), cache: "no-store" });
    // the client never sends 3 rows (putDropBatch refuses first); the raw write shows the VALIDATOR refuses it too
    const three = await putDropRaw(four.slice(0, 3).map((x) => x.row), []);
    const ok = await putDropBatch(four.map((x) => x.row), []);
    const cleanup = ok.ok ? await putDropBatch([], four.map((x) => x.token)) : null;
    return NextResponse.json({ unsigned: unsignedRes.status, three, four: ok, cleanup });
  }
  if (action === "noteProbe") {
    // the note's rules on demand: make a note for a persona as the composer would, or try keys on a note
    const note = await import("@/lib/rings/note");
    const castHash = String(body.castHash ?? "");
    if (typeof body.note === "string") {
      const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).map(String) : [];
      return NextResponse.json({ ref: note.openNote(body.note, castHash, keys) });
    }
    try {
      const n = await note.noteForPost("fixture", String(body.personaId ?? ""), castHash);
      return NextResponse.json({ note: n, length: n.length });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 });
}
