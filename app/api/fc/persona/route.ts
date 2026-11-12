import { NextRequest, NextResponse } from "next/server";
// MULTI-FID PASS Gate 1 — the persona ↔ FID surface.
//   GET  the network mode, the custody kind, the plain map (what the validator learns) and the
//        records with every secret stripped (a Neynar signer uuid never leaves the vault)
//   POST product: costSheet, signerProbe, registrantLinkage, identityProbe
//        rig (ZK_DEV_HOOKS=true): acquire (FIXTURE only), forget, setNetworkMode, setCustody,
//        recordLiveFid + recordFidSpend (the user's live command hands its receipt here)
import { hydrate } from "@/lib/adapters/mock/store";
import { MAX_LIVE_PERSONA_FIDS, acquireFixtureFid, costSheet, recordLiveFid } from "@/lib/fc/acquire";
import { custodyKind, setCustodyOverride } from "@/lib/fc/custody/source";
import { registrantLinkage } from "@/lib/fc/linkage";
import { personaNetworkMode, setNetworkModeOverride } from "@/lib/fc/networkMode";
import { allPersonaFids, forgetPersonaFids, personaFidMap, type PersonaFidRecord } from "@/lib/fc/personaFid";
import { FcIdentityError, assertOwnFidIdentity } from "@/lib/fc/writes";
import { fcCustodyAddressFor, fcSignerPublicKeyFor } from "@/lib/identity/keys";
import { fidSpendEntries, recordFidSpend, type SpendEntry } from "@/lib/x/spend";
import { signCustodyTransfer, signKeyRequest } from "@/lib/fc/custodySign";

export const dynamic = "force-dynamic";

const devHooksOn = () => process.env.ZK_DEV_HOOKS === "true";
const PERSONA_RE = /^[A-Za-z0-9_]{1,80}$/;

function redact(r: PersonaFidRecord) {
  const signer = r.signer.kind === "neynar-managed" ? { kind: r.signer.kind, derivedPubHex: r.signer.derivedPubHex, derivedRegistered: r.signer.derivedRegistered, uuid: "<vault>" } : r.signer;
  return { ...r, signer };
}

export async function GET() {
  await hydrate();
  return NextResponse.json({
    networkMode: personaNetworkMode(),
    custody: custodyKind(),
    // GATE 5 (attack-post-1 F-3): the persona -> fid/fname map IS the sibling set, in the
    // clearest possible form — one row per persona account of this root. It narrows with
    // every other cross-persona surface.
    ...(await (async () => {
      const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
      const visible = new Set(await visibleOwnPersonaIds());
      const fullMap = await personaFidMap();
      const map: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fullMap)) if (visible.has(k)) map[k] = v;
      return { map, records: (await allPersonaFids()).filter((r) => visible.has(r.personaId)).map(redact) };
    })()),
  });
}

/** GATE 5 (attack-post-1 F-3a): the GET was narrowed and the POST actions were not, so two
 *  requests rebuilt the whole persona→fid map the GET stopped returning — `registrantLinkage`
 *  with no `fids` answered for EVERY own record, and `identityProbe` turned each fid back into
 *  a persona id. `signerProbe` handed back the fname and custody address for any own persona.
 *  All three now answer only for personas in the device's current scope. */
async function inScope(personaId: string): Promise<boolean> {
  const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
  return (await visibleOwnPersonaIds()).includes(personaId);
}
const OUT_OF_SCOPE = { error: "not a persona in this device's current scope", code: "out_of_scope" };

export async function POST(req: NextRequest) {
  await hydrate();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  const action = String(body.action ?? "");
  const personaId = body.personaId === undefined ? "" : String(body.personaId);
  // LAYERS_WORLD=empty (lib/world.ts): no fixture accounts are minted or injected (demo furniture), and no sealed
  // persona↔fid record is forgotten (a live record is the only copy of that account's signer)
  if ((action === "forget" || action === "acquire" || action === "injectFidRecord") && (await import("@/lib/world")).isEmptyWorld()) {
    return NextResponse.json({ error: `"${action}" refused under LAYERS_WORLD=empty`, code: "empty_world" }, { status: 403 });
  }

  if (action === "costSheet") {
    const n = Math.max(1, Math.min(MAX_LIVE_PERSONA_FIDS, Number(body.personas ?? 2)));
    return NextResponse.json(costSheet(n));
  }
  if (action === "signerProbe") {
    if (!PERSONA_RE.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    if (!(await inScope(personaId))) return NextResponse.json(OUT_OF_SCOPE, { status: 403 });
    // PUBLIC material only: the derived signer's public key and the custody ADDRESS
    // + the fname the acquisition would claim (the persona's handle in the protocol grammar)
    const { fnameFromHandle } = await import("@/lib/fc/acquire");
    const { getPersona } = await import("@/lib/identity/keystore");
    const { personaById } = await import("@/lib/adapters/mock/store");
    const handle = getPersona(personaId)?.handle ?? personaById.get(personaId)?.handle ?? personaId;
    const { isKeystoreRootedPersona } = await import("@/lib/identity/keys");
    const { kindOf } = await import("@/lib/identity/personaKind");
    const keystoreRooted = isKeystoreRootedPersona(personaId);
    const fname = fnameFromHandle(handle);
    // CONNECT MAIN review (PL-4): an account whose handle or fname shares a stem with the connected main account's name
    // would sit beside main in the fname registry for good — refused here, before the acquisition spends anything
    // (the command reads `refusal`). An unreadable vault refuses too, never "no main".
    let refusal: string | null = null;
    try {
      const { mainNameDerivation } = await import("@/lib/fc/personaFid");
      refusal = (await mainNameDerivation(handle)) ?? (await mainNameDerivation(fname));
    } catch (e) {
      refusal = "couldn't check this persona's name against your main account's (" + (e as Error).message + ") — try again";
    }
    // MULTI-FID Gate 5: WHICH root the keys came from is part of the probe — the live command refuses a fixture-rooted persona before any billable call
    return NextResponse.json({ personaId, derivedPubHex: fcSignerPublicKeyFor(personaId), custodyAddress: fcCustodyAddressFor(personaId), fname, keystoreRooted, liveEligible: keystoreRooted && kindOf(personaId) === "public" && !refusal, ...(refusal ? { refusal } : {}) });
  }
  if (action === "registrantLinkage") {
    // With no `fids` key this answered for EVERY own record — the whole own-fid set in one
    // request, with the findings grouping those fids by shared custody address, which links
    // them to each other directly. That DEFAULT is the leak, and it is scoped.
    //
    // An explicitly named fid set is not: this is the safety set's own probe, and it is asked
    // about records the caller already holds (including injected ones). Scoping the named
    // case broke the assertion it exists to make. Same shape as the lens delta: the default
    // narrows, the explicit question is answered.
    // What is EXCLUDED is precisely the sibling leak: records belonging to one of this
    // device's OWN personas that the current scope hides. Everything else stays, because
    // this probe is the safety set's own scanner — it exists to find cross-linkage across
    // every record the device holds, including injected and foreign ones, and the first
    // version of this narrowing filtered those out and silently defeated the assertion.
    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    const visible = new Set(await visibleOwnPersonaIds());
    const own = new Set(await ownPersonaIdsAll());
    const hiddenSibling = (personaId: string) => own.has(personaId) && !visible.has(personaId);
    const everything = (await allPersonaFids()).filter((r) => !hiddenSibling(r.personaId));
    const fids = Array.isArray(body.fids) ? (body.fids as unknown[]).map(Number) : null;
    const records = fids ? everything.filter((r) => fids.includes(r.fid)) : everything;
    return NextResponse.json({ ...registrantLinkage(records), fids: records.map((r) => r.fid) });
  }
  if (action === "identityProbe") {
    try {
      const creds = await assertOwnFidIdentity({
        fid: body.fid === undefined ? undefined : Number(body.fid),
        signerUuid: body.signerUuid === undefined ? undefined : String(body.signerUuid),
        personaId: personaId || undefined,
      });
      // The probe answered fid -> personaId for any own fid, which turned the set above back
      // into the map. It still answers "is this fid usable by me", and it no longer NAMES a
      // persona the current scope hides.
      const named = creds.personaId ?? null;
      if (named && !(await inScope(named))) return NextResponse.json(OUT_OF_SCOPE, { status: 403 });
      return NextResponse.json({ allowed: true, fid: creds.fid, personaId: named });
    } catch (e) {
      if (e instanceof FcIdentityError) return NextResponse.json({ allowed: false, reason: e.message }, { status: 403 });
      throw e;
    }
  }

  if (!devHooksOn()) return NextResponse.json({ error: "test-rig action — refused unless ZK_DEV_HOOKS=true" }, { status: 403 });

  if (action === "custodySign") {
    // MULTI-FID Gate 2: the user's acquisition command asks the app to sign with the persona's custody key —
    // a Transfer to the persona's OWN custody address, or a SignedKeyRequest for its OWN derived signer key
    if (!PERSONA_RE.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const r =
      body.kind === "keyRequest"
        ? await signKeyRequest(personaId, { requestFid: Number(body.requestFid), deadline: Number(body.deadline) })
        : await signCustodyTransfer(personaId, { fid: Number(body.fid), to: String(body.to ?? ""), nonce: Number(body.nonce), deadline: Number(body.deadline) });
    if ("refused" in r) return NextResponse.json({ ok: false, refused: true, reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, ...r });
  }
  if (action === "acquire") {
    if (!PERSONA_RE.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const r = await acquireFixtureFid(personaId);
    if ("refused" in r) return NextResponse.json({ ok: false, refused: true, reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, record: redact(r) });
  }
  if (action === "forget") {
    // MULTI-FID Gate 5 (attack-fid-1 #12): a LIVE record is a real account's only key to its signer — forgetting it takes a second, explicit flag
    const mode = body.mode === "fixture" ? "fixture" : body.mode === "live" ? "live" : undefined;
    if (mode !== "fixture" && body.confirmLive !== true) return NextResponse.json({ error: "forgetting live records needs confirmLive: true — the sealed record is the only place the account's signer lives" }, { status: 400 });
    await forgetPersonaFids(mode);
    return NextResponse.json({ ok: true });
  }
  if (action === "setNetworkMode") {
    setNetworkModeOverride(body.mode === "shared-fid" ? "shared-fid" : body.mode === "per-persona-fid" ? "per-persona-fid" : null);
    return NextResponse.json({ ok: true, networkMode: personaNetworkMode() });
  }
  if (action === "setCustody") {
    setCustodyOverride(body.kind === "self-custody" ? "self-custody" : body.kind === "neynar-managed" ? "neynar-managed" : null);
    return NextResponse.json({ ok: true, custody: custodyKind() });
  }
  // MULTI-FID Gate 5 (attack-fid-3 #12): the LIVE-money actions are armed by their own flag, apart from the rig's
  if ((action === "recordLiveFid" || (action === "recordFidSpend" && body.mode === "live")) && process.env.FID_ACQUIRE_ENABLED !== "true") {
    return NextResponse.json({ error: "live acquisition actions are refused unless FID_ACQUIRE_ENABLED=true (the rig flag alone does not arm real money)" }, { status: 403 });
  }
  if (action === "recordLiveFid") {
    const rec = body.record as PersonaFidRecord | undefined;
    if (!rec || typeof rec !== "object") return NextResponse.json({ error: "record required" }, { status: 400 });
    const r = await recordLiveFid(rec);
    if ("refused" in r) return NextResponse.json({ ok: false, refused: true, reason: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, record: redact(r) });
  }
  if (action === "recordFidSpend") {
    const e = body.entry as Partial<SpendEntry> | undefined;
    if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.amount !== "number") return NextResponse.json({ error: "entry {id, kind, amount, note} required" }, { status: 400 });
    const kind = e.kind === "fid_signer" ? "fid_signer" : e.kind === "fid_fname" ? "fid_fname" : "fid_create";
    const mode = body.mode === "live" ? "live" : "fixture";
    const rec = await recordFidSpend({ id: e.id, kind, amount: e.amount, note: String(e.note ?? "") }, mode);
    return NextResponse.json({ ok: true, entry: rec });
  }
  if (action === "fidSpend") {
    return NextResponse.json({ entries: fidSpendEntries() });
  }
  if (action === "injectFidRecord") {
    // test rig ONLY: an arbitrary record for the NEGATIVE cases (a shared registrant, a foreign origin) —
    // the product path (acquire / recordLiveFid) validates every field this skips
    const rec = body.record as PersonaFidRecord | undefined;
    if (!rec || typeof rec !== "object" || !PERSONA_RE.test(String(rec.personaId ?? ""))) return NextResponse.json({ error: "record required" }, { status: 400 });
    // MULTI-FID Gate 5 (attack-fid-3 #4): an injected record is FIXTURE furniture — never the live transport, never the
    // pass's own origin string; the identity rule re-derives the keys at write time regardless
    if (rec.origin === "layers-fid-pass" || rec.mode === "live") return NextResponse.json({ error: "injected records are fixture-only and never carry this pass's live origin" }, { status: 400 });
    const { recordPersonaFid } = await import("@/lib/fc/personaFid");
    await recordPersonaFid({ ...rec, mode: "fixture", createdAt: rec.createdAt || Date.now() });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
