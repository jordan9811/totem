import { NextRequest, NextResponse } from "next/server";
// ZK PASS 1 — the app's zk surface: status (GET) and account-level actions
// (POST). PUBLIC MATERIAL ONLY leaves this route: commitments, epochs,
// tree sizes, signatures, proof envelopes, booleans. The leak grep scans
// it like every other route.
//
// TWO CLASSES OF ACTION (attack-2 findings 4/6, attack-3 F-6):
//   product   — register, requestEligibility, reanchor, gateStatus,
//               queueStatus, lastAnon, privacyConditions, probe,
//               recoveryProbe, rootCheck: what the settings/discovery
//               surfaces do. (The app has no auth of its own; the demo
//               topology is one user on one host — SECURITY-POSTURE.md
//               A-DEV-SURFACE.) PERSONA LAUNCH P7: + proverStatus (read-only:
//               where proofs are made, the last proving time).
//   test rig  — everything that OVERRIDES what the label or the gate reads
//               (relay, universe, rep binding, fallback), fabricates state
//               (synthetic queue items, budget probes, decoys, epoch
//               advances, resets), exercises the pipeline on demand
//               (prove / enqueue / verify / submit / anonSubmit / drain),
//               or reveals nullifiers (nullifierProbe — an oracle), or (P7)
//               forces the anonymous-posting switch (setAnonPosting). All of
//               it is REFUSED unless ZK_DEV_HOOKS=true on the app, the same
//               flag that gates the validator's dev hooks.
//
// REGISTRATION IS NOT A PERSONA ACTION. It is refused if the request
// carries a view-as cookie or names a persona in the body — a commitment
// registered "as a persona" would be timestamp-correlated to that persona
// in the validator's own records (C10). It is account-level, from the
// settings surface or a suite, and its insertion is batched to the next
// epoch on the validator side.
import { VIEW_AS_COOKIE } from "@/lib/activePersona";
import { VALIDATOR_URL, setZkModeOverride, zkMode, type ZkMode } from "@/lib/zk/config";

export const dynamic = "force-dynamic";

const modeOf = (v: unknown): ZkMode => (v === "live" ? "live" : v === "fixture" ? "fixture" : zkMode());
const devHooksOn = () => process.env.ZK_DEV_HOOKS === "true";
/** LAYERS_WORLD=empty (review WE-5): the test-rig actions the owner service still answers — an ALLOWLIST, as /api/dev
 *  keeps one, so a rig action added later is refused under the flag until someone decides otherwise. Only the pure
 *  probes: jitterProbe computes a window, eligibilityProbe / attestPredicateProbe read the gate's verdict. Everything
 *  else in DEV_ACTIONS writes, wipes, forges, overrides or reveals (revokeAttestation revoked the owner's REAL
 *  attestation and re-sealed the attestation vault; rosterExport is root material; nullifierProbe is an oracle). */
const EMPTY_WORLD_ZK_DEV_ALLOWED = new Set(["jitterProbe", "eligibilityProbe", "attestPredicateProbe"]);
const DEV_ACTIONS = new Set([
  "nullifierProbe",
  "budgetProbe",
  "prove",
  "verify",
  "submit",
  "anonSubmit",
  "enqueue",
  "enqueueSynthetic",
  "drain",
  "jitterProbe",
  "setRelay",
  "setZkMode",
  "setRepImpl",
  "setGateFallback",
  "advanceEpoch",
  "seedDecoys",
  "resetZk",
  "prefetchNow",
  "splitView",
  "rosterExport",
  "attest",
  // Attestation pass Gate 1 (test rig): explicit registration of a built-in
  // issuer, an issuer's revocation, the subscriber allowlist override
  "registerIssuer",
  "revokeAttestation",
  "setHonoredIssuers",
  // MULTI-FID Gate 0 (test rig): the web-proof / fid-facts source overrides, the eligibility probe
  "setWebProofSource",
  "setFidSource",
  "eligibilityProbe",
  // Gate 2 (test rig): the chain-facts source override (live-att1 only)
  "setChainSource",
  // Gate 3 (test rig): the pack-predicate probe
  "attestPredicateProbe",
  // Gate 4 (test rig): submit raw (tampered) public parts through the device signature
  "attestSubmitRaw",
  // PERSONA LAUNCH P3 (test rig): what a RESTART / a RECOVERY would reconstruct — the sealed anon reveal records with
  // their persona (zkQueue) and a persona's post mode (keystore file, identityRoster, rootRoster), read back COLD.
  // Oracles over this device's own sealed data: dev hooks only, refused under LAYERS_WORLD=empty like every rig action.
  "anonQueueReadback",
  "postModeReadback",
  // PERSONA LAUNCH P6 (UX-L1, test rig): plant / end a launch record UNDER WAY, so a rig can watch what the composer and
  // POST /api/anon say about a post made during a launch. Writes this device's sealed queue: dev hooks only, refused
  // under LAYERS_WORLD=empty like every rig action.
  "launchProbe",
  // PERSONA LAUNCH P7 (test rig): force the anonymous-posting switch for this process ("on" / "off" / null = the
  // environment's answer) — lib/zk/anon/availability.ts setAnonPostingOverride. Overrides what the gate and the composer
  // read: dev hooks only, refused under LAYERS_WORLD=empty like every rig action; resetZk clears it.
  "setAnonPosting",
]);

export async function GET(req: NextRequest) {
  const { zkStatus } = await import("@/lib/zk/status");
  const mode = modeOf(req.nextUrl.searchParams.get("mode"));
  return NextResponse.json({ status: await zkStatus(mode) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const mode = modeOf(body.mode);

  // LAYERS_WORLD=empty (lib/world.ts): every test-rig action but the pure probes is refused on the owner service — its
  // validator holds the owner's real registration and attestations (an allowlist: EMPTY_WORLD_ZK_DEV_ALLOWED)
  if (DEV_ACTIONS.has(action) && !EMPTY_WORLD_ZK_DEV_ALLOWED.has(action) && (await import("@/lib/world-flag")).isEmptyWorld()) {
    return NextResponse.json({ error: `zk action "${action}" refused under LAYERS_WORLD=empty — a test-rig action that writes, wipes, forges, overrides or reveals zk state`, code: "empty_world" }, { status: 403 });
  }
  if (DEV_ACTIONS.has(action) && !devHooksOn()) {
    return NextResponse.json({ error: `zk action "${action}" is a test-rig action — refused unless ZK_DEV_HOOKS=true` }, { status: 403 });
  }

  // ---------- product actions ----------
  if (action === "register") {
    // NOT from a persona context — fail closed on either signal.
    if (req.cookies.get(VIEW_AS_COOKIE)?.value) {
      return NextResponse.json({ error: "registration is account-level: refused from a view-as (persona) context" }, { status: 400 });
    }
    if (body.personaId !== undefined) {
      return NextResponse.json({ error: "registration is account-level: a personaId is not accepted" }, { status: 400 });
    }
    const { registerCommitment } = await import("@/lib/zk/registration");
    try {
      const r = await registerCommitment(mode);
      return NextResponse.json(r, { status: r.ok ? 200 : r.status });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }

  // ---------- ZK PASS 2 Gate 3 ----------
  if (action === "revoke" || action === "reissue") {
    // account-level, like registration: refused from a persona context
    if (req.cookies.get(VIEW_AS_COOKIE)?.value) {
      return NextResponse.json({ error: action + " is account-level: refused from a view-as (persona) context" }, { status: 400 });
    }
    if (body.personaId !== undefined) {
      return NextResponse.json({ error: action + " is account-level: a personaId is not accepted" }, { status: 400 });
    }
    const { revokeCommitment, reissueIdentity } = await import("@/lib/zk/registration");
    try {
      if (action === "revoke") {
        const r = await revokeCommitment(mode);
        return NextResponse.json(r, { status: r.ok ? 200 : r.status });
      }
      const r = await reissueIdentity(mode);
      return NextResponse.json(r, { status: r.registration.ok ? 200 : r.registration.status });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 409 });
    }
  }
  if (action === "recoverIdentityIndex") {
    // account-level: the recovery scan (a recovered device walks its branches)
    if (req.cookies.get(VIEW_AS_COOKIE)?.value || body.personaId !== undefined) {
      return NextResponse.json({ error: "recoverIdentityIndex is account-level" }, { status: 400 });
    }
    const { recoverIdentityIndex } = await import("@/lib/zk/registration");
    try {
      return NextResponse.json(await recoverIdentityIndex(mode));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "forkClaim") {
    // public read: has this persona proven continuity under this commitment?
    const { fetchForkClaim } = await import("@/lib/zk/validatorClient");
    const personaId = String(body.personaId ?? "");
    const forkCommit = String(body.forkCommit ?? "");
    if (!personaId || !/^[0-9a-f]{64}$/.test(forkCommit)) return NextResponse.json({ error: "personaId and a 64-hex forkCommit required" }, { status: 400 });
    try {
      return NextResponse.json(await fetchForkClaim(mode, personaId, forkCommit));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  // ---------- ATTESTATION PASS Gate 1: the open issuer interface ----------
  if (action === "issuers") {
    // product: the validator's OPEN registry, and which of those issuers THIS client honours
    const { listRegisteredIssuers } = await import("@/lib/attest/registry");
    const { honoredIssuerPatterns, isHonoredIssuer } = await import("@/lib/attest/subscriber");
    try {
      const r = await listRegisteredIssuers(mode);
      return NextResponse.json({ epoch: r.epoch, issuers: r.issuers.map((i) => ({ ...i, honored: isHonoredIssuer(i.id, i.pubkey) })), honoredPatterns: honoredIssuerPatterns() });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "registerIssuer") {
    // test rig: register a built-in issuer module explicitly (product issuers register lazily on first issuance)
    const { builtinIssuer, ensureRegistered } = await import("@/lib/attest/registry");
    const issuer = builtinIssuer(String(body.issuerId ?? ""));
    if (!issuer) return NextResponse.json({ error: "no such built-in issuer" }, { status: 404 });
    const r = await ensureRegistered(issuer, mode);
    const okStatus = r.status === 200 || r.status === 201;
    return NextResponse.json({ ok: okStatus, status: r.status, existing: (r.json as { existing?: boolean } | null)?.existing === true, pubkey: issuer.publicKey, response: r.json }, { status: okStatus ? 200 : r.status });
  }
  if (action === "requestIssuance" || action === "attest") {
    // product (requestIssuance): the SUBJECT — this root — asks an issuer for an
    // attestation on its commitment; the value stays in the vault, the public
    // part is batched into the issuer's bucket tree next epoch.
    // "attest" is the test rig's legacy spelling (mock issuer + decoy cohort).
    const { requestIssuance } = await import("@/lib/attest/subject");
    const { isRefusal } = await import("@/lib/attest/types");
    type SubjectWallet = import("@/lib/attest/types").SubjectWallet;
    const issuerId = String(body.issuerId ?? body.issuer ?? "");
    const includeCohort = action === "attest" ? body.includeDecoys === true : body.includeCohort === true;
    if ((issuerId.startsWith("test.") || includeCohort) && !devHooksOn()) {
      return NextResponse.json({ error: "test issuers and cohort issuance are test-rig actions — refused unless ZK_DEV_HOOKS=true" }, { status: 403 });
    }
    const buckets = Array.isArray(body.buckets) ? (body.buckets as unknown[]).map(String) : undefined;
    const wallets = Array.isArray(body.wallets) ? (body.wallets as SubjectWallet[]) : undefined;
    // MULTI-FID Gate 0: web proofs (x.*), fid signer proofs (neynar.*), the fixture demo wallet
    const webProofs = Array.isArray(body.webProofs)
      ? (body.webProofs as { handle?: unknown; proof?: unknown }[]).map((p) => ({ handle: String(p.handle ?? ""), proof: String(p.proof ?? "") }))
      : undefined;
    const fids = Array.isArray(body.fids)
      ? (body.fids as { fid?: unknown; challengeSig?: unknown }[]).map((p) => ({ fid: Number(p.fid), challengeSig: String(p.challengeSig ?? "") }))
      : undefined;
    const r = await requestIssuance(mode, issuerId, {
      buckets,
      includeCohort,
      wallets,
      challenge: typeof body.challenge === "string" ? body.challenge : undefined,
      webProofs,
      fids,
      demoWallet: body.demoWallet === true,
    });
    if (isRefusal(r)) return NextResponse.json({ status: 400, response: { ok: false, refused: true, reason: r.reason } }, { status: 400 });
    return NextResponse.json({ status: 200, response: { ...r, mock: issuerId === "test.mock-issuer", decoysAttested: r.cohortAttested } });
  }
  if (action === "attestChallenge") {
    // product (Gate 2): a challenge the subject's wallets sign to prove control to THIS issuer
    const { builtinIssuer } = await import("@/lib/attest/registry");
    const { zkCommitment } = await import("@/lib/zk/identity");
    const issuer = builtinIssuer(String(body.issuerId ?? ""));
    if (!issuer || !issuer.mintChallenge) return NextResponse.json({ error: "no such issuer, or it binds no wallet" }, { status: 404 });
    return NextResponse.json({ issuerId: issuer.id, challenge: issuer.mintChallenge({ mode, commitment: zkCommitment() }) });
  }
  if (action === "chainSource") {
    const { chainSource } = await import("@/lib/attest/chain/source");
    return NextResponse.json({ source: chainSource() });
  }
  if (action === "setChainSource") {
    // test rig: live chain facts are opt-in for ONE run (live-att1); null restores env/fixture
    const { chainSource, setChainSourceOverride } = await import("@/lib/attest/chain/source");
    setChainSourceOverride(body.source === "live" ? "live" : body.source === "fixture" ? "fixture" : null);
    return NextResponse.json({ ok: true, source: chainSource() });
  }
  if (action === "webProofSource" || action === "fidSource") {
    const { webProofSource } = await import("@/lib/attest/webproof/source");
    const { fidSource } = await import("@/lib/attest/fid/source");
    return NextResponse.json({ webProofSource: webProofSource(), fidSource: fidSource() });
  }
  if (action === "setWebProofSource" || action === "setFidSource") {
    // test rig: live sources are opt-in for ONE recorded run; null restores env/fixture
    const src = body.source === "live" ? "live" : body.source === "fixture" ? "fixture" : null;
    if (action === "setWebProofSource") {
      const { setWebProofSourceOverride, webProofSource } = await import("@/lib/attest/webproof/source");
      setWebProofSourceOverride(src);
      return NextResponse.json({ ok: true, webProofSource: webProofSource() });
    }
    const { setFidSourceOverride, fidSource } = await import("@/lib/attest/fid/source");
    setFidSourceOverride(src);
    return NextResponse.json({ ok: true, fidSource: fidSource() });
  }
  if (action === "attestConfig") {
    // MULTI-FID Gate 0: the configurable knobs, read back (never secrets)
    const { TRACKED_PROTOCOLS } = await import("@/lib/attest/chain/types");
    const { onboardingDisjuncts } = await import("@/lib/attest/onboarding");
    const { chainSource } = await import("@/lib/attest/chain/source");
    const { webProofSource } = await import("@/lib/attest/webproof/source");
    const { fidSource } = await import("@/lib/attest/fid/source");
    return NextResponse.json({
      protocols: [...TRACKED_PROTOCOLS],
      demoWalletSeed: process.env.ATTEST_DEMO_WALLET_SEED || "layers-chain-wallet/0",
      onboarding: onboardingDisjuncts(),
      sources: { chain: chainSource(), webProof: webProofSource(), fid: fidSource() },
    });
  }
  if (action === "onboardingProbe") {
    // MULTI-FID Gate 0: what this persona has PROVEN and whether it clears the OR-gate
    const { onboardingStatusFor, onboardingDisjuncts } = await import("@/lib/attest/onboarding");
    const personaId = String(body.personaId ?? "");
    if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    return NextResponse.json({ personaId, ...(await onboardingStatusFor(personaId, mode)), disjuncts: onboardingDisjuncts() });
  }
  if (action === "eligibilityProbe") {
    // test rig: the discovery gate's verdict for an author, exactly as the feed build asks it
    const { discoveryEligibility } = await import("@/lib/zk/gate");
    const personaId = String(body.personaId ?? "");
    if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const gate = await discoveryEligibility();
    if (!gate) return NextResponse.json({ active: false, personaId });
    const legacyTier = typeof body.legacyTier === "number" ? body.legacyTier : 1;
    return NextResponse.json({
      active: true,
      personaId,
      provenTier: gate.provenTier(personaId),
      provenAttestations: gate.provenAttestations(personaId),
      eligible: gate.isEligible(personaId, legacyTier),
      fallback: gate.fallback,
    });
  }
  if (action === "attestSubmitRaw") {
    // test rig: the refusal oracle for tampered PUBLIC parts, signed by this device like a real submission
    const { submitAttestations } = await import("@/lib/zk/validatorClient");
    const parts = Array.isArray(body.attestations) ? (body.attestations as never[]) : [];
    const r = await submitAttestations(mode, parts);
    return NextResponse.json(r.json ?? {}, { status: r.status });
  }
  if (action === "myAttestations") {
    // product: what THIS root holds — values included, to their owner only
    const { myAttestations } = await import("@/lib/attest/vault");
    return NextResponse.json({ attestations: await myAttestations(mode) });
  }
  if (action === "attestations") {
    const { fetchAttestations } = await import("@/lib/zk/validatorClient");
    const { zkCommitment } = await import("@/lib/zk/identity");
    try {
      return NextResponse.json(await fetchAttestations(mode, zkCommitment()));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "attestBuckets") {
    const { fetchAttestBuckets } = await import("@/lib/zk/validatorClient");
    try {
      return NextResponse.json(await fetchAttestBuckets(mode));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "requestAttestation") {
    const { requestAttestationProof, gateAttempts } = await import("@/lib/zk/gate");
    const r = requestAttestationProof(String(body.personaId ?? ""), String(body.issuer ?? ""), String(body.bucket ?? ""), typeof body.motivatedAt === "number" ? body.motivatedAt : Date.now());
    if (!r.ok) return NextResponse.json({ scheduled: false, reason: r.reason, attempts: gateAttempts().length }, { status: /honoured/.test(r.reason ?? "") ? 200 : 400 });
    return NextResponse.json({ scheduled: true, attempts: gateAttempts().length });
  }
  if (action === "attested") {
    const { fetchAttested } = await import("@/lib/zk/validatorClient");
    const { isHonoredIssuer } = await import("@/lib/attest/subscriber");
    const personaId = String(body.personaId ?? "");
    const issuer = String(body.issuer ?? "");
    const bucket = body.bucket === undefined ? undefined : String(body.bucket);
    if (!personaId || !issuer) return NextResponse.json({ error: "personaId and issuer required" }, { status: 400 });
    // an un-honoured issuer's attestation proves nothing on this client, whatever the validator's presence log says — honour by KEY
    const { fetchIssuers } = await import("@/lib/zk/validatorClient");
    let regKey: string | null = null;
    try {
      regKey = (await fetchIssuers(mode)).issuers.find((i) => i.id === issuer)?.pubkey ?? null;
    } catch {
      regKey = null;
    }
    if (!isHonoredIssuer(issuer, regKey)) return NextResponse.json({ attested: false, honored: false, epoch: null, buckets: [] });
    try {
      return NextResponse.json({ ...(await fetchAttested(mode, personaId, issuer, bucket)), honored: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "attestedMap") {
    const { fetchAttestedMap } = await import("@/lib/zk/validatorClient");
    const { isHonoredIssuer } = await import("@/lib/attest/subscriber");
    try {
      const { fetchIssuers } = await import("@/lib/zk/validatorClient");
      const [r, reg] = await Promise.all([fetchAttestedMap(mode), fetchIssuers(mode)]);
      const keyOf = new Map(reg.issuers.map((i) => [i.id, i.pubkey]));
      const claims: Record<string, string[]> = {};
      for (const [p, list] of Object.entries(r.claims)) {
        const kept = list.filter((k) => isHonoredIssuer(k.split("/")[0], keyOf.get(k.split("/")[0]) ?? null));
        if (kept.length) claims[p] = kept;
      }
      return NextResponse.json({ epoch: r.epoch, claims });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }
  if (action === "revokeAttestation") {
    // test rig: the ISSUER revokes one of its issuances (ours by default), signed under the issuer key
    const { builtinIssuer } = await import("@/lib/attest/registry");
    const { attestRevokeCanonical } = await import("@/lib/attest/canonical");
    const { revokeAttestationOnValidator } = await import("@/lib/zk/validatorClient");
    const { zkCommitment } = await import("@/lib/zk/identity");
    const { forgetIssued } = await import("@/lib/attest/vault");
    const issuerId = String(body.issuerId ?? "");
    const bucket = String(body.bucket ?? "");
    const issuer = builtinIssuer(issuerId);
    if (!issuer) return NextResponse.json({ error: "no such built-in issuer" }, { status: 404 });
    const commitment = typeof body.commitment === "string" ? body.commitment : zkCommitment();
    const issuedAt = Date.now();
    // under the issuer's OWN key (a family may share one) — the key the validator registered
    const sig = issuer.sign(attestRevokeCanonical({ mode, issuer: issuerId, bucket, commitment, issuedAt }));
    const r = await revokeAttestationOnValidator({ mode, issuer: issuerId, bucket, commitment, issuedAt, sig });
    if (r.status === 200 && commitment === zkCommitment()) await forgetIssued(mode, issuerId, bucket);
    return NextResponse.json({ ...(r.json ?? {}), status: r.status }, { status: r.status });
  }
  if (action === "setHonoredIssuers") {
    // test rig: the subscriber allowlist override (null restores the env/default list)
    const { setHonoredIssuersOverride } = await import("@/lib/attest/subscriber");
    setHonoredIssuersOverride(Array.isArray(body.issuers) ? (body.issuers as unknown[]).map(String) : null);
    return NextResponse.json({ ok: true });
  }

  if (action === "probe") {
    // Determinism + pins, booleans only.
    const { zkCommitment, zkCommitmentDerivedTwiceIdentical, zkMaterialForLeakTest } = await import("@/lib/zk/identity");
    const { checkVkeyPin } = await import("@/lib/zk/ceremony");
    return NextResponse.json({
      commitment: zkCommitment(),
      derivedTwiceIdentical: zkCommitmentDerivedTwiceIdentical(),
      zkNeedleCount: zkMaterialForLeakTest().length, // the VALUES never leave
      vkeyPin: checkVkeyPin(),
    });
  }

  if (action === "recoveryProbe") {
    // Would THIS phrase's seed reproduce the current commitment? Booleans
    // only; the phrase is the owner's own secret, submitted by the owner.
    const { mnemonicToSeed } = await import("@/lib/recovery/mnemonic");
    const { zkCommitment, zkCommitmentFromSeedHex } = await import("@/lib/zk/identity");
    try {
      const seedHex = mnemonicToSeed(String(body.phrase ?? ""));
      return NextResponse.json({ matches: zkCommitmentFromSeedHex(seedHex) === zkCommitment() });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  if (action === "rootCheck") {
    const { verifyRootAgainstHistory } = await import("@/lib/zk/rootHistory");
    try {
      const r = await verifyRootAgainstHistory(mode, String(body.tree ?? "valid"), String(body.root ?? ""));
      return NextResponse.json(r);
    } catch (e) {
      return NextResponse.json({ ok: false, reason: (e as Error).message });
    }
  }

  if (action === "reanchor") {
    // THE USER'S EXPLICIT RE-ANCHOR RITUAL (attack-3 F-10): drop this
    // universe's split-view anchors and cohort records; the next
    // verification is a first sight again. The validator key pin is NOT
    // dropped — a key change is never accepted implicitly.
    const { clearAnchorsForMode } = await import("@/lib/zk/localPins");
    return NextResponse.json({ ok: true, mode, cleared: clearAnchorsForMode(mode) });
  }

  if (action === "requestEligibility") {
    // the product trigger: prove at idle, queue with jitter — fire-and-forget
    const { requestEligibility, gateAttempts } = await import("@/lib/zk/gate");
    const personaId = String(body.personaId ?? "");
    if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    requestEligibility(personaId, typeof body.motivatedAt === "number" ? body.motivatedAt : Date.now());
    return NextResponse.json({ scheduled: true, attempts: gateAttempts().length });
  }
  if (action === "gateStatus") {
    const { gateAttempts, gateFallback, gateTree, GATE_ID } = await import("@/lib/zk/gate");
    const { currentRepImpl } = await import("@/lib/adapters/registry");
    const { fetchEligibility } = await import("@/lib/zk/validatorClient");
    const personas = Array.isArray(body.personaIds) ? (body.personaIds as string[]).slice(0, 20) : [];
    const eligibility: Record<string, unknown> = {};
    for (const p of personas) {
      try {
        eligibility[p] = await fetchEligibility(mode, p, GATE_ID);
      } catch (e) {
        eligibility[p] = { error: (e as Error).message };
      }
    }
    // ANON REVIEW (A2-2, R3-02): every anon post's stage and reason, from the in-memory outcome log, so a rig reads them
    // in one call (a refusal is never silent)
    const { anonOutcomes } = await import("@/lib/zk/anon/outcomes");
    return NextResponse.json({ rep: currentRepImpl(), gateId: GATE_ID, tree: gateTree(), fallback: gateFallback(), attempts: gateAttempts(), eligibility, anon: anonOutcomes() });
  }
  if (action === "queueStatus") {
    const { queueStatus } = await import("@/lib/zk/anon/queue");
    return NextResponse.json(await queueStatus());
  }
  if (action === "lastAnon") {
    const { lastAnonSubmission } = await import("@/lib/zk/anon/client");
    return NextResponse.json({ last: lastAnonSubmission() });
  }
  if (action === "proverStatus") {
    // PERSONA LAUNCH P7 (read-only, product): WHERE this device's proofs are made and how long the last one took — the
    // settings page's line. Public values only (an op, a time, a duration, pin hashes); never a fetch, never a secret.
    const { relayChannel } = await import("@/lib/zk/anon/relay");
    if (typeof window !== "undefined") {
      const b = await import("@/lib/zk/transport/browser");
      return NextResponse.json({ where: "browser-worker", channel: relayChannel(), lastProve: b.lastProve(), lastPins: b.lastVerifiedPins() });
    }
    return NextResponse.json({ where: mode === "live" ? "server-process" : "server-in-process", channel: relayChannel(), lastProve: null, lastPins: null });
  }
  if (action === "privacyConditions") {
    const { privacyConditions } = await import("@/lib/zk/privacy");
    // Attestation pass Gate 3: an attestation-gated surface names its bucket → the ninth condition
    const a = body.attestation as { issuer?: unknown; bucket?: unknown } | undefined;
    const opts = a && typeof a === "object" ? { attestation: { issuer: String(a.issuer ?? ""), bucket: String(a.bucket ?? "") } } : {};
    return NextResponse.json(await privacyConditions(mode, opts));
  }
  if (action === "attestPredicateProbe") {
    // test rig: the filter-pack primitive resolves "attest:<issuer>/<bucket>" against what the persona PROVED (after a feed build refreshed the map)
    const { discoveryEligibility } = await import("@/lib/zk/gate");
    const { personaHoldsClaim } = await import("@/lib/packs/service");
    const { provenAttestationsSnapshot } = await import("@/lib/attest/proven");
    await discoveryEligibility();
    const personaId = String(body.personaId ?? "");
    const claim = String(body.claim ?? "");
    return NextResponse.json({ personaId, claim, holds: personaHoldsClaim(personaId, claim), cache: provenAttestationsSnapshot() });
  }
  if (action === "prefetchStatus") {
    const { prefetchStatus, ensurePrefetchLoop } = await import("@/lib/zk/prefetch");
    const { wantedPersonas } = await import("@/lib/zk/gate");
    ensurePrefetchLoop();
    return NextResponse.json({ ...prefetchStatus(mode), wanted: wantedPersonas() });
  }

  // ---------- test-rig actions (ZK_DEV_HOOKS=true only; refused above otherwise) ----------
  if (action === "nullifierProbe") {
    // Nullifiers for registered scopes (they are public once emitted; the
    // suite cross-checks them against its own independent derivation).
    // AN ORACLE — dev-only.
    const { scopeString, SCOPE_REGISTRY } = await import("@/lib/zk/scopes");
    const { fieldOf } = await import("@/lib/zk/hash");
    const { nullifierFor } = await import("@/lib/zk/nullifier");
    const { zkSecretScalarForProver } = await import("@/lib/zk/identity");
    if (typeof body.issuer === "string" && Array.isArray(body.buckets)) {
      // Attestation pass Gate 1: per-BUCKET nullifiers for one persona/epoch (the collision suite's oracle)
      const { fetchEpoch } = await import("@/lib/zk/validatorClient");
      const epoch = Number.isInteger(body.epoch) ? Number(body.epoch) : (await fetchEpoch(mode)).epoch;
      const nullifiers: Record<string, string> = {};
      for (const b of (body.buckets as unknown[]).map(String)) {
        nullifiers[b] = nullifierFor(fieldOf("scope", scopeString("attestation", epoch, String(body.personaId ?? ""), `${body.issuer}/${b}`)), zkSecretScalarForProver()).toString(10);
      }
      return NextResponse.json({ epoch, nullifiers });
    }
    const items = Array.isArray(body.items) ? (body.items as { entryId: string; epoch: number; personaId?: string }[]) : [];
    const out: { entryId: string; epoch: number; personaId: string | null; nullifier: string | null; error?: string }[] = [];
    for (const it of items.slice(0, 50)) {
      try {
        const s = scopeString(String(it.entryId), Number(it.epoch), it.personaId === undefined ? undefined : String(it.personaId));
        out.push({ entryId: it.entryId, epoch: it.epoch, personaId: it.personaId ?? null, nullifier: nullifierFor(fieldOf("scope", s), zkSecretScalarForProver()).toString(10) });
      } catch (e) {
        out.push({ entryId: it.entryId, epoch: it.epoch, personaId: it.personaId ?? null, nullifier: null, error: (e as Error).message });
      }
    }
    return NextResponse.json({ registry: SCOPE_REGISTRY.map((e) => ({ id: e.id, feature: e.feature, onePerHuman: e.onePerHuman })), nullifiers: out });
  }

  if (action === "budgetProbe") {
    const { reserveBudget, budgetStatus } = await import("@/lib/zk/budget");
    const personaId = String(body.personaId ?? "");
    const epoch = Number(body.epoch ?? 0);
    if (!personaId) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const predicate = typeof body.predicate === "string" ? body.predicate : typeof body.claimKind === "string" ? body.claimKind : null;
    if (predicate !== null) {
      const d = reserveBudget(mode, personaId, epoch, predicate);
      return NextResponse.json(d, { status: d.ok ? 200 : 429 });
    }
    return NextResponse.json({ ok: true, status: budgetStatus(mode, personaId, epoch) });
  }

  if (action === "prove") {
    // The full client pipeline, at idle. Never wired to a persona action.
    const { prepareAndProve } = await import("@/lib/zk/prove");
    const { isClaimKind } = await import("@/lib/zk/transport/types");
    if (!isClaimKind(body.claimKind)) return NextResponse.json({ error: "unknown claim kind" }, { status: 400 });
    const personaId = String(body.personaId ?? "");
    if (!personaId) return NextResponse.json({ error: "personaId required (the persona the eligibility is FOR)" }, { status: 400 });
    try {
      const out = await prepareAndProve({
        claimKind: body.claimKind,
        tree: String(body.tree ?? "valid"),
        personaId,
        gateId: String(body.gateId ?? "foryou"),
        mode,
        forkCommit: typeof body.forkCommit === "string" ? body.forkCommit : undefined,
        issuer: typeof body.issuer === "string" ? body.issuer : undefined,
        bucket: typeof body.bucket === "string" ? body.bucket : undefined,
        // PERSONA LAUNCH P4/P5/P6 (test rig): the anon-post and launch inputs, so a suite can watch prepareAndProve refuse
        // a reach tree at its cohort stage (or a launch request at its scope stage) without the wanted set in between
        castHash: typeof body.castHash === "string" ? body.castHash : undefined,
        attributionCommitment: typeof body.attributionCommitment === "string" ? body.attributionCommitment : undefined,
        noteHash: typeof body.noteHash === "string" ? body.noteHash : undefined,
        launchCommit: typeof body.launchCommit === "string" ? body.launchCommit : undefined,
        slot: typeof body.slot === "number" ? body.slot : undefined,
      });
      // PERSONA LAUNCH P7 (L2): the prover's time rides BESIDE the envelope in this answer (scripts/live-z2.mjs reads it),
      // never on the envelope itself — an envelope field would ride the padded anonymous body to the validator
      let provingMs: number | null = null;
      if (out.ok && mode === "live") {
        if (typeof window !== "undefined") provingMs = (await import("@/lib/zk/transport/browser")).lastProve()?.provingMs ?? null;
        else provingMs = (await import("@/lib/zk/transport/live")).lastLiveProve()?.ms ?? null;
      }
      return NextResponse.json(out.ok ? { ...out, provingMs } : out, { status: out.ok ? 200 : 422 });
    } catch (e) {
      // never an HTML 500: a refusal with its reason, as JSON
      return NextResponse.json({ ok: false, stage: "error", reason: (e as Error).message }, { status: 422 });
    }
  }

  if (action === "verify") {
    const { transportFor } = await import("@/lib/zk/transport");
    const { isClaimKind } = await import("@/lib/zk/transport/types");
    const envelope = body.envelope as import("@/lib/zk/transport/types").ProofEnvelope;
    if (!envelope || typeof envelope !== "object") return NextResponse.json({ error: "envelope required" }, { status: 400 });
    const kind = body.claimKind ?? envelope.claimKind;
    if (!isClaimKind(kind)) return NextResponse.json({ ok: false, code: "KIND", reason: "unknown claim kind" });
    const t = await transportFor(modeOf(envelope.mode));
    return NextResponse.json(await t.verify(kind, envelope));
  }

  if (action === "submit") {
    // THE PLAIN DOOR (validator-side dev-only too): an error oracle for the
    // suites. The product never submits here.
    const res = await fetch(`${VALIDATOR_URL}/zk/submit`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envelope: body.envelope }),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {}
    return NextResponse.json({ status: res.status, response: json }, { status: 200 });
  }

  if (action === "anonSubmit") {
    // Submit one envelope over the anonymous channel NOW (suites). Product
    // code never calls this from an action: it enqueues (below).
    const { submitAnonymous } = await import("@/lib/zk/anon/submit");
    const envelope = body.envelope as import("@/lib/zk/transport/types").ProofEnvelope;
    if (!envelope || typeof envelope !== "object") return NextResponse.json({ error: "envelope required" }, { status: 400 });
    return NextResponse.json(await submitAnonymous(envelope));
  }

  if (action === "enqueue") {
    // The precompute path: prove at idle, then queue with a random delay.
    // `motivatedAt` is whatever action prompted it — recorded only so the
    // decorrelation test can measure the offset; never sent.
    const { prepareAndProve } = await import("@/lib/zk/prove");
    const { enqueueSubmission, ensureDrainLoop } = await import("@/lib/zk/anon/queue");
    const { isClaimKind } = await import("@/lib/zk/transport/types");
    if (!isClaimKind(body.claimKind)) return NextResponse.json({ error: "unknown claim kind" }, { status: 400 });
    const out = await prepareAndProve({
      claimKind: body.claimKind,
      tree: String(body.tree ?? "valid"),
      personaId: String(body.personaId ?? ""),
      gateId: String(body.gateId ?? "foryou"),
      mode,
      // Gate 3: the kind-specific inputs ride the enqueue path too
      forkCommit: typeof body.forkCommit === "string" ? body.forkCommit : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
      bucket: typeof body.bucket === "string" ? body.bucket : undefined,
    });
    if (!out.ok) return NextResponse.json(out, { status: 422 });
    try {
      const item = await enqueueSubmission(out.envelope, {
        motivatedAt: typeof body.motivatedAt === "number" ? body.motivatedAt : Date.now(),
        jitterMinMs: typeof body.jitterMinMs === "number" ? body.jitterMinMs : undefined,
        jitterMaxMs: typeof body.jitterMaxMs === "number" ? body.jitterMaxMs : undefined,
      });
      ensureDrainLoop();
      return NextResponse.json({ ok: true, id: item.id, notBefore: item.notBefore, motivatedAt: item.motivatedAt, epoch: item.epoch });
    } catch (e) {
      return NextResponse.json({ ok: false, stage: "enqueue", reason: (e as Error).message }, { status: 422 });
    }
  }

  if (action === "enqueueSynthetic") {
    const { enqueueSynthetic } = await import("@/lib/zk/anon/queue");
    const count = Math.max(1, Math.min(200, Number(body.count ?? 10)));
    const ats = Array.isArray(body.motivatedAts) ? (body.motivatedAts as number[]) : [];
    const shape = body.epochShape === null ? null : body.epochShape && typeof body.epochShape === "object" ? (body.epochShape as { epochMs: number; msRemaining: number }) : undefined;
    try {
      const items = await enqueueSynthetic(count, ats, { lo: Number(body.jitterMinMs ?? 0), hi: Number(body.jitterMaxMs ?? 10_000) }, shape);
      return NextResponse.json({ items: items.map((i) => ({ id: i.id, notBefore: i.notBefore, motivatedAt: i.motivatedAt, createdAt: i.createdAt })) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 422 });
    }
  }

  if (action === "jitterProbe") {
    // the pure window computation under a caller-supplied epoch shape
    const { jitterWindow, jitterSelfTest } = await import("@/lib/zk/anon/queue");
    const shape = body.epochShape === null ? null : (body.epochShape as { epochMs: number; msRemaining: number } | undefined) ?? null;
    try {
      return NextResponse.json({ ok: true, window: jitterWindow(Number(body.jitterMinMs ?? 30_000), Number(body.jitterMaxMs ?? 900_000), shape), selfTest: jitterSelfTest() });
    } catch (e) {
      return NextResponse.json({ ok: false, reason: (e as Error).message, selfTest: jitterSelfTest() });
    }
  }

  if (action === "drain") {
    const { drainQueue } = await import("@/lib/zk/anon/queue");
    // a rig flush sends everything due; `limit: 1` is the product loop's own rule
    return NextResponse.json(
      await drainQueue(typeof body.now === "number" ? body.now : Date.now(), typeof body.limit === "number" ? body.limit : Infinity)
    );
  }

  if (action === "setRelay") {
    const { setRelayOverride, relayConfig } = await import("@/lib/zk/anon/relay");
    if (body.kind === null) setRelayOverride(null);
    else {
      const kind = body.kind === "ohttp" ? "ohttp" : body.kind === "tor" ? "tor" : "direct";
      setRelayOverride({ kind, url: String(body.url ?? ""), thirdParty: body.thirdParty === true });
    }
    return NextResponse.json({ relay: relayConfig() });
  }
  if (action === "setAnonPosting") {
    const { setAnonPostingOverride, anonPostingAvailability } = await import("@/lib/zk/anon/availability");
    const v = body.value === "on" || body.value === "off" ? body.value : null;
    setAnonPostingOverride(v);
    return NextResponse.json({ override: v, availability: anonPostingAvailability({ mode: zkMode() }) });
  }
  if (action === "setZkMode") {
    setZkModeOverride(body.zkMode === "live" ? "live" : body.zkMode === "fixture" ? "fixture" : null);
    return NextResponse.json({ zkMode: zkMode() });
  }
  if (action === "setRepImpl") {
    const { setRepImplOverride, currentRepImpl } = await import("@/lib/adapters/registry");
    setRepImplOverride(body.impl === "zk" ? "zk" : body.impl === "validator" ? "validator" : body.impl === "mock" ? "mock" : null);
    return NextResponse.json({ rep: currentRepImpl() });
  }
  if (action === "setGateFallback") {
    const { setGateFallbackOverride, gateFallback } = await import("@/lib/zk/gate");
    setGateFallbackOverride(body.fallback === "policy" ? "policy" : body.fallback === "none" ? "none" : null);
    return NextResponse.json({ fallback: gateFallback() });
  }

  if (action === "rosterExport") {
    // test rig / operator: the device-side roster a migration-006 rollback
    // needs ({ personaId: rootId }) — root material, dev-only, never a
    // product read (the counts alone are the operator-visible part)
    const { rosterExport, rosterStatus } = await import("@/lib/identity/rootRoster");
    return NextResponse.json({ roster: await rosterExport(), status: await rosterStatus() });
  }
  if (action === "anonQueueReadback") {
    // PERSONA LAUNCH P3 (test rig): persist the queue NOW (the product persists on its own random delay, 30 s – 15 min
    // after a proof is queued — a rig cannot wait for it), then read the ONE sealed zkQueue record back from the
    // validator and open it the way hydrate() does, WITHOUT touching this process's state: exactly what a restart
    // would reconstruct. Answers the operator-visible shape (row keys, ciphertext sizes, whether any of the given persona
    // ids appears in the stored bytes) and, from the opened record, each reveal record's cast hash and persona — never
    // a secret.
    const { persistNs } = await import("@/lib/adapters/mock/store");
    const { fetchState } = await import("@/lib/adapters/mock/persist");
    const { decryptNamespace } = await import("@/lib/vault/vault");
    if (body.flush !== false) await persistNs("zkQueue");
    const res = await fetchState("zkQueue");
    if (!res.ok) return NextResponse.json({ error: "the sealed queue could not be read from the validator (" + res.status + ")" }, { status: 503 });
    const stored = ((await res.json()) as { entries?: Record<string, unknown> })?.entries ?? {};
    const storedText = JSON.stringify(stored);
    const rows = Object.entries(stored).map(([key, v]) => {
      const ct = v && typeof v === "object" && typeof (v as { ct?: unknown }).ct === "string" ? ((v as { ct: string }).ct) : null;
      // the vault's ciphertext is hex (lib/crypto/vaultCipher.ts): its byte size is half the string
      return { key, ciphertext: ct !== null, ctBytes: ct !== null ? Math.floor(ct.length / 2) : null };
    });
    let records: Array<{ castHash: string; personaId: string | null; hasSecret: boolean; mode: string; settled: { status: string; outcome: string | null } | null }> = [];
    // PERSONA LAUNCH P3 (PRIV-3): the anon SUBMISSIONS the sealed record still holds (pruned once their window closed)
    // and the size of its plaintext — so a rig can show the ciphertext's length did NOT follow a post whose plaintext
    // grew by more than a KiB (the padding class is what hides it, not luck)
    let submissions: Array<{ castHash: string | null; status: string; outcome: string | null; hasEnvelope: boolean }> = [];
    let plainBytes = 0;
    try {
      const plain = decryptNamespace("zkQueue", stored);
      const m = ((plain["_"] as { m?: Record<string, import("@/lib/zk/queue").QueuedSubmission> } | undefined)?.m ?? {}) as Record<string, import("@/lib/zk/queue").QueuedSubmission>;
      plainBytes = Buffer.byteLength(JSON.stringify(m), "utf8");
      records = Object.values(m)
        .filter((q) => q && q.claimKind === "anon-attribution" && q.attribution)
        .map((q) => ({ castHash: String(q.id).slice("zka_".length), personaId: q.attribution?.personaId ?? null, hasSecret: /^[0-9a-f]{64}$/.test(String(q.attribution?.secret ?? "")), mode: q.mode, settled: q.attribution?.settled ? { status: q.attribution.settled.status, outcome: q.attribution.settled.outcome } : null }));
      submissions = Object.values(m)
        .filter((q) => q && q.claimKind === "anon-post")
        .map((q) => ({ castHash: ((q.envelope as { publicInputs?: { castHash?: string } } | null)?.publicInputs?.castHash) ?? null, status: q.status, outcome: q.outcome, hasEnvelope: !!q.envelope }));
    } catch (e) {
      return NextResponse.json({ error: "the sealed queue did not open: " + (e as Error).message, rows }, { status: 503 });
    }
    const probe = Array.isArray(body.personaIds) ? (body.personaIds as unknown[]).map(String).filter(Boolean).slice(0, 50) : [];
    return NextResponse.json({ rows, records, submissions, plainBytes, plaintextHits: probe.filter((id) => storedText.includes(id)) });
  }
  if (action === "postModeReadback") {
    // PERSONA LAUNCH P3 (test rig): does a persona's post mode survive a RESTART (the keystore file, read again from disk
    // with the cached copy dropped — what boot reads) and a RECOVERY (the sealed identityRoster a 24-word or passkey
    // recovery rebuilds the keystore from, and the sealed root roster's display record)? Each read is COLD.
    const personaId = String(body.personaId ?? "");
    if (!/^[A-Za-z0-9_]{1,80}$/.test(personaId)) return NextResponse.json({ error: "personaId required" }, { status: 400 });
    const { forgetCachedKeystore, getPersona } = await import("@/lib/identity/keystore");
    forgetCachedKeystore();
    const keystore = getPersona(personaId)?.postMode ?? null;
    const { fetchState } = await import("@/lib/adapters/mock/persist");
    const { decryptNamespace } = await import("@/lib/vault/vault");
    const openDoc = async (ns: string): Promise<Record<string, unknown> | null> => {
      const r = await fetchState(ns);
      if (!r.ok) throw new Error(ns + " unreadable (" + r.status + ")");
      const entries = ((await r.json()) as { entries?: Record<string, unknown> })?.entries ?? {};
      if (!Object.keys(entries).length) return null;
      const plain = decryptNamespace(ns, entries);
      const rec = plain["_"] as { m?: Record<string, unknown> } | undefined;
      return rec && rec.m && typeof rec.m === "object" ? rec.m : (plain as Record<string, unknown>);
    };
    try {
      const idRoster = await openDoc("identityRoster");
      const rootDoc = await openDoc("rootRoster");
      const identityRoster = ((idRoster?.[personaId] as { postMode?: unknown } | undefined)?.postMode as string | undefined) ?? null;
      const rootRoster = (((rootDoc?.personas as Record<string, { postMode?: unknown }> | undefined)?.[personaId])?.postMode as string | undefined) ?? null;
      return NextResponse.json({ personaId, keystore, identityRoster, rootRoster });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, personaId, keystore }, { status: 503 });
    }
  }
  if (action === "launchProbe") {
    // PERSONA LAUNCH P6 (UX-L1, test rig): a launch record UNDER WAY — stage "waiting" (the registrar has the request, the
    // account has not appeared) — for one of this device's personas, WITHOUT a real confirm: a real one's proof and
    // anonymous send would reach the registrar and outlive the suite. Its custody address is random and never registered,
    // so the launch tick (lib/launch/tick.ts) only ever waits on it; its window is null, so it never blocks a real
    // launch's one-per-window rule. op "end" marks it failed (hidden, never deleted). Like a real record it lives in memory
    // and rides the sealed queue's deferred write (lib/zk/anon/queue.ts putLaunchRecord).
    const op = String(body.op ?? "");
    const { putLaunchRecord, updateLaunchRecord, launchRecord } = await import("@/lib/zk/anon/queue");
    if (op === "plant") {
      const personaId = String(body.personaId ?? "");
      const { isOwnPostingPersona, handleOfPersona } = await import("@/lib/identity/postMode");
      if (!isOwnPostingPersona(personaId)) return NextResponse.json({ error: "not one of this device's personas" }, { status: 403 });
      const { randomBytes } = await import("@/lib/platform/crypto");
      const hex = (n: number) => randomBytes(n).toString("hex");
      const launchCommit = hex(32);
      const now = Date.now();
      await putLaunchRecord({
        mode,
        personaId,
        launchCommit,
        request: "{}",
        custody: "0x" + hex(20),
        recovery: "0x" + hex(20),
        signerKey: hex(32),
        fname: "probe-" + hex(3),
        profile: { displayName: "", bio: "", pfpUrl: "" },
        quoteOriginals: [],
        window: null,
        confirmedAt: now,
        stage: "waiting",
        stageAt: now,
        nextAt: 0,
        fid: null,
        registeredHour: null,
        batchHash: null,
        revealed: 0,
        history: { launchCastHash: null, quoted: [] },
        attempts: 0,
        reason: null,
        log: [{ at: now, stage: "waiting", note: "planted by a rig (UX-L1 probe): no request was made and nothing was sent" }],
      });
      return NextResponse.json({ launchCommit, personaId, handle: handleOfPersona(personaId) });
    }
    if (op === "end") {
      const launchCommit = String(body.launchCommit ?? "");
      if (!/^[0-9a-f]{64}$/.test(launchCommit) || !(await launchRecord(launchCommit))) return NextResponse.json({ error: "no such launch record" }, { status: 404 });
      await updateLaunchRecord(launchCommit, { stage: "failed", reason: "The rig's probe ended." }, "the rig probe ended (UX-L1)");
      return NextResponse.json({ ok: true, launchCommit });
    }
    return NextResponse.json({ error: "op must be plant or end" }, { status: 400 });
  }
  if (action === "prefetchNow") {
    // test rig: run one prefetch tick NOW for this universe (prefetch + wanted proofs)
    const { prefetchTick, prefetchStatus } = await import("@/lib/zk/prefetch");
    const tick = await prefetchTick(mode);
    return NextResponse.json({ tick, ...prefetchStatus(mode) });
  }
  if (action === "splitView") {
    // test rig: fork the validator's ANONYMOUS viewpoint for (mode, tree)
    const res = await fetch(VALIDATOR_URL + "/zk/dev/split-view", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, tree: String(body.tree ?? "tier-2"), on: body.on === true }) });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {}
    return NextResponse.json({ status: res.status, response: json }, { status: res.ok ? 200 : res.status });
  }

  if (action === "advanceEpoch" || action === "seedDecoys" || action === "resetZk") {
    // Proxies to the validator's dev hooks (refused there unless
    // ZK_DEV_HOOKS=true). resetZk also clears the client's zk state FOR
    // THAT UNIVERSE ONLY (attack-3 F-10): the device pins of that mode
    // (key pin included — a test rig re-TOFUs) and that mode's queue items.
    const path = action === "advanceEpoch" ? "/zk/dev/advance-epoch" : action === "seedDecoys" ? "/zk/dev/seed-decoys" : "/zk/dev/reset";
    const res = await fetch(VALIDATOR_URL + path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, epochs: body.epochs, count: body.count }),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {}
    if (action === "resetZk" && res.ok) {
      const { state, persistNs, hydrate } = await import("@/lib/adapters/mock/store");
      const { clearPinsForMode } = await import("@/lib/zk/localPins");
      await hydrate();
      clearPinsForMode(mode, true);
      // Gate 3: the identity index is device state the fixture reset returns
      // to 0 — the validator's fixture universe forgot every commitment
      if (mode === "fixture") {
        const { setZkIdentityIndex } = await import("@/lib/identity/keystore");
        const { resetZkIdentityCache } = await import("@/lib/zk/identity");
        setZkIdentityIndex(0);
        resetZkIdentityCache();
      }
      for (const [id, q] of [...state().zkQueue.entries()]) if (q.mode === mode) state().zkQueue.delete(id);
      await persistNs("zkQueue");
      const { resetPrefetch } = await import("@/lib/zk/prefetch");
      resetPrefetch();
      // ANON REVIEW (A2-2): the per-cast outcome log describes this universe's wanted set — a reset forgets it too
      const { resetAnonOutcomes } = await import("@/lib/zk/anon/outcomes");
      resetAnonOutcomes(mode);
      // Attestation pass Gate 1: the universe forgot every commitment, so our
      // issuances are moot; the honour override is a rig setting and resets too
      const { forgetAllIssued } = await import("@/lib/attest/vault");
      await forgetAllIssued(mode);
      // MULTI-FID Gate 1: the issuers’ identity → commitment bindings are moot once the universe forgot every commitment
      const { clearRetention } = await import("@/lib/attest/retention");
      clearRetention();
      // PERSONA LAUNCH P5: the reach families' bindings too, and the held-tier cache and the rig's reach fixture knobs
      const { clearReachRetention } = await import("@/lib/attest/issuers/fcReach");
      clearReachRetention();
      const { resetReachCaches } = await import("@/lib/reach/held");
      resetReachCaches();
      const { setHonoredIssuersOverride } = await import("@/lib/attest/subscriber");
      setHonoredIssuersOverride(null);
    }
    return NextResponse.json({ status: res.status, response: json }, { status: res.ok ? 200 : res.status });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
