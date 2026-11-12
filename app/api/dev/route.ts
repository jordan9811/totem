import { NextRequest, NextResponse } from "next/server";
import { fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import { registrySnapshot } from "@/lib/adapters/registry";
import { maxOutLatencyInjection, forceFailNext, forceNeynar429, setFailureRateOverride, setLatencyInjection } from "@/lib/adapters/devControls";
import { setDataSourceOverride, dataSource } from "@/lib/adapters/neynar/mode";
import { clearNeynarCache } from "@/lib/adapters/neynar/content";
import { resetState } from "@/lib/adapters/mock/store";
import { resetMockBlocks } from "@/lib/adapters/mock/rep";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId, VIEW_AS_COOKIE } from "@/lib/activePersona";
import { isEmptyWorld } from "@/lib/world";

export const dynamic = "force-dynamic";

export async function GET() {
  // the registry names every adapter and its persisted map — a rig diagnostic, refused where the hooks are off
  if (process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true") {
    return NextResponse.json({ error: "dev registry refused on a production build without ZK_DEV_HOOKS" }, { status: 403 });
  }
  // LAYERS_WORLD=empty (lib/world.ts): the world mode and what the partition holds back (COUNTS per namespace, never
  // an entry) — in this process's stash, and in the namespaces as stored on the validator right now. Equal counts
  // after writes are the evidence that every write carried the hidden rows back. The demo world's answer is unchanged.
  if (isEmptyWorld()) {
    const { hydrate, worldHiddenCounts, worldStoredDiff, worldCollisionCounts } = await import("@/lib/adapters/mock/store");
    await hydrate();
    return NextResponse.json({
      registry: registrySnapshot(),
      // collisions (review WE-3): keys a write named whose stored record is hidden — the stored record was kept
      world: { mode: "empty", hidden: worldHiddenCounts(), stored: await worldStoredDiff(), collisions: worldCollisionCounts() },
    });
  }
  return NextResponse.json({ registry: registrySnapshot() });
}

/**
 * LAYERS_WORLD=empty (lib/world.ts): the Developer pane on the owner service may only READ, switch the content source
 * and turn the in-memory latency dials. Every other action writes, wipes, tampers with, deletes or forges stored
 * state or keys (resetSeed's wipe, simulateDeviceLoss's keystore delete, tamperState, the vault corruptors, forged
 * events, seeded inbox cursors...) — and there the stored state is the owner's real root and vault beside the hidden
 * demo world. An ALLOWLIST, so an action added later is refused under the flag until someone decides otherwise.
 */
const EMPTY_WORLD_DEV_ACTIONS = new Set(["lastReceived", "decorateProbe", "cryptoProbe", "setDataSource", "expireNeynarCache", "setLatency", "maxLatency", "viewAs"]);

const RIG_ONLY_ACTIONS = new Set(["resetSeed", "tamperState", "issueTestDelegation", "setDataSource", "simulateDeviceLoss", "revokeDevice", "corruptVaultCiphertext", "dropSealedCaches"]);

export async function POST(req: NextRequest) {
  // MULTI-FID Gate 5 (attack-fid-3 #12): the actions that touch money counters, the device roster or the content source
  // are refused on a PRODUCTION build unless the rig flag is set — a deployed instance keeps its state
  // BROWSER KEYSTORE PASS Gate 1 stage 3 (readiness audit finding 3): on a production build without ZK_DEV_HOOKS this
  // whole route is a rig surface — every action is refused, viewAs and the latency/failure dials included, not only
  // the RIG_ONLY set. The rig runs its production build WITH the hooks and is unaffected. The guard runs BEFORE the
  // body is parsed (attack-custody-1, noted): a malformed body on a public deployment is a 403, not a 500.
  if (process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true") {
    return NextResponse.json({ error: "dev action refused on a production build without ZK_DEV_HOOKS" }, { status: 403 });
  }
  const body = await req.json();
  if (isEmptyWorld() && !EMPTY_WORLD_DEV_ACTIONS.has(String(body?.action ?? ""))) {
    return NextResponse.json(
      { error: `dev action "${String(body?.action ?? "")}" refused under LAYERS_WORLD=empty — it writes, wipes or forges stored state`, code: "empty_world" },
      { status: 403 }
    );
  }

  // Deterministic failure injection for fail-closed tests: force the next N
  // adapter calls matching a label to fail.
  if (body.action === "lastReceived") {
    // Test hook: what did a mock destination actually receive? The
    // degradation preview's contract is checked against this, not against
    // the preview's own description of itself.
    const { lastReceived } = await import("@/lib/crosspost/destinations");
    return NextResponse.json({ received: lastReceived.get(String(body.destinationId)) ?? null });
  }

  if (body.action === "decorateProbe") {
    // Test hook: run the REAL collapse-rendering path (decorateCrossposts —
    // the exact function the classic feed calls) against a cast stub with a
    // chosen seeded author and viewer. Exists because local casts author as
    // SESSION personas while attestations land on SEEDED personas — the
    // real-overlap logic is page-real but its staging is only reachable
    // here. State it consults (attestations, hashed migration source,
    // crosspost records) is the genuine article, not stubbed.
    const { decorateCrossposts } = await import("@/lib/crosspost/collapse");
    const stub = {
      hash: String(body.castHash),
      personaId: String(body.authorPersonaId),
      text: "decorate probe",
      author: { fid: 0, username: "probe", displayName: "probe", pfpUrl: "" },
      timestamp: Date.now(),
      replies: 0,
      likes: 0,
      recasts: 0,
      views: 0,
      embeds: [],
    } as unknown as import("@/lib/types").Cast;
    const out = decorateCrossposts([stub], String(body.viewerPersonaId));
    return NextResponse.json({
      copies: out.length,
      chip: !!out[0]?.alsoPostedTo?.length,
      mirrors: out.filter((c) => c.mirrorOf).length,
    });
  }

  if (body.action === "setCollapse") {
    const { setCollapseDisabled } = await import("@/lib/crosspost/collapse");
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    await setCollapseDisabled(activeSeedPersonaId(), !!body.disabled);
    return NextResponse.json({ ok: true, disabled: !!body.disabled });
  }

  if (body.action === "setLastVisit") {
    // Caught-up staging: mark the viewer as having last visited N minutes
    // ago (0 = right now, which force-exhausts the feed).
    const { state, absoluteTime } = await import("@/lib/adapters/mock/store");
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    const minutesAgo = Number(body.minutesAgo ?? 0);
    state().lastVisitAt.set(activeSeedPersonaId(), minutesAgo === 0 ? Date.now() : absoluteTime(minutesAgo));
    const { persistNs } = await import("@/lib/adapters/mock/store");
    await persistNs("lastVisit");
    return NextResponse.json({ ok: true, minutesAgo });
  }

  if (body.action === "forceExhaust") {
    const { state, persistNs } = await import("@/lib/adapters/mock/store");
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    state().lastVisitAt.set(activeSeedPersonaId(), Date.now());
    await persistNs("lastVisit");
    return NextResponse.json({ ok: true, forced: true });
  }

  if (body.action === "forgeEvent") {
    // Test hook for the no-impressions invariant: attempts to write an event
    // of an arbitrary type through the real adapter. The adapter must throw
    // for anything off the closed union — this reports whether it did.
    const { adapters } = await import("@/lib/adapters/registry");
    try {
      await adapters.eventLog.record({
        id: "ev_forged_" + Date.now().toString(36),
        type: body.type,
        actorPersonaId: "persona_viewer_main",
        targetPersona: "persona_acc_crypto_1",
        triggeringCastId: null,
        context: "forge_test",
        timestamp: Date.now(),
      });
      return NextResponse.json({ recorded: true });
    } catch (e) {
      return NextResponse.json({ recorded: false, refused: String((e as Error).message) });
    }
  }

  if (body.action === "forceFail") {
    forceFailNext(String(body.label ?? ""), Number(body.count ?? 1));
    return NextResponse.json({ ok: true, label: body.label, count: body.count });
  }

  // View-as: render every surface as another seeded persona. Needed to
  // demo AND to test disclosure from the far side.
  if (body.action === "viewAs") {
    const res = NextResponse.json({ ok: true, viewAs: body.personaId ?? null });
    if (body.personaId) res.cookies.set(VIEW_AS_COOKIE, String(body.personaId), { path: "/" });
    else res.cookies.delete(VIEW_AS_COOKIE);
    return res;
  }

  if (body.action === "cryptoProbe") {
    // CRYPTO PASS Gate 0 test hook. PUBLIC MATERIAL ONLY: persona public
    // keys (derived twice inside this call to prove determinism), a
    // fixture-key probe, and a sign→verify roundtrip result. No private
    // key, seed, or vault key is ever in this response — the key-material
    // leak grep scans this route like every other.
    const { personaPublicKey, keyMaterialForLeakTest } = await import("@/lib/identity/keystore");
    const { publicKeyForPersona, signForPersona } = await import("@/lib/identity/keys");
    const { verifyCanonical } = await import("@/lib/crypto/ed25519");
    const { personaById } = await import("@/lib/adapters/mock/store");
    const seededIds = [...personaById.keys()].slice(0, 3);
    const fixtureKeys: Record<string, string | null> = {};
    for (const id of seededIds) fixtureKeys[id] = publicKeyForPersona(id);
    // determinism: same derivation run twice must be byte-identical
    const probeId = seededIds[0];
    const derivedTwiceIdentical =
      probeId !== undefined && publicKeyForPersona(probeId) === publicKeyForPersona(probeId);
    // roundtrip: sign as a seeded persona, verify against its resolved key
    const canonical = "layers-crypto-probe/1|" + Date.now();
    const sig = probeId ? signForPersona(probeId, canonical) : null;
    const pub = probeId ? publicKeyForPersona(probeId) : null;
    const roundtrip = Boolean(sig && pub && verifyCanonical(sig, canonical, pub));
    const tamperRejected = Boolean(sig && pub && !verifyCanonical(sig, canonical + "x", pub));
    // GATE 1 instrument: how many grants exist vs how many VERIFY, plus
    // wall time — the per-signature cost the spec asks reported. Counts
    // only; no grant contents leave through this probe beyond what the
    // grant API already serves.
    const { grantVerifies } = await import("@/lib/identity/verifiedGrants");
    const { state, hydrate } = await import("@/lib/adapters/mock/store");
    await hydrate();
    const allGrants = [...state().grantsV3.values()];
    const t0 = performance.now();
    const verifiedCount = allGrants.filter(grantVerifies).length;
    const grantVerifyMs = performance.now() - t0;
    return NextResponse.json({
      fixtureKeys,
      derivedTwiceIdentical,
      roundtrip,
      tamperRejected,
      keystorePersonaCount: (await import("@/lib/identity/keystore")).listPersonas().length,
      // the count of needles the leak grep hunts — the VALUE list itself
      // obviously never leaves the process
      keyMaterialNeedleCount: keyMaterialForLeakTest().length,
      unknownPersonaKeyIsNull: publicKeyForPersona("persona_does_not_exist_xyz") === null,
      keystoreProbe: personaPublicKey("persona_does_not_exist_xyz") === null,
      grants: {
        total: allGrants.length,
        verified: verifiedCount,
        failed: allGrants.length - verifiedCount,
        verifyMs: Math.round(grantVerifyMs * 100) / 100,
      },
    });
  }

  if (body.action === "simulateDeviceLoss") {
    // CRYPTO PASS Gate 4 test hook: TOTAL device loss. Delete the keystore
    // file (seed + persona roster) and the device identity, and clear
    // their in-memory caches — the seed is now gone from this process, as
    // it would be on a wiped phone. Recovery must rebuild everything from
    // the phrase/escrow + the vault. Nothing here touches the validator,
    // which is the whole point: the roster and vault survive on the
    // server, encrypted.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore");
    // GATE 5 (attack-post-3 F-2): the sealed-pin file is DEVICE state, so total device loss
    // takes it with the keystore. A pin that survived a wipe would make every sealed namespace
    // refuse the recovering device's first read — the vault rows are still there, the device
    // has simply never sealed them in this incarnation.
    for (const f of ["root.json", "device.json", "vault-sealed.json"]) {
      try {
        fs.rmSync(path.join(dir, f));
      } catch {
        /* already gone */
      }
    }
    const gk = globalThis as unknown as { __layersKeystore?: unknown };
    gk.__layersKeystore = undefined;
    const { forgetSealedPins } = await import("@/lib/vault/sealedPins");
    forgetSealedPins();
    // the device identity is gone too — force the next signed write to
    // re-enroll a fresh device rather than fail as an unknown one
    const { resetEnvelopeBootstrap } = await import("@/lib/adapters/mock/persist");
    resetEnvelopeBootstrap();
    // attack-mega-2 F2: the in-process caches this pass added die with the device too, so recovery (c4) rebuilds
    // them from the vault rather than inheriting a warm cache
    const { resetPortsCache: rpc } = await import("@/lib/x/porting");
    rpc();
    const { resetUnifiedIndex: rui } = await import("@/lib/search/unified");
    rui();
    const { resetEmbedWorker: rew } = await import("@/lib/search/embedWorker");
    rew();
    const { resetZonesCache: rzc } = await import("@/lib/zones/store");
    rzc();
    const { resetInfluenceCache: ric } = await import("@/lib/influence/allowance");
    ric();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "vaultRoundTrip") {
    // CRYPTO PASS Gate 2 probe. Encrypt a probe value with the REAL
    // vault key, prove it decrypts back, and prove the plaintext does
    // NOT appear in the ciphertext bytes. Also proves an UNAUTHORIZED
    // context (a different key) cannot decrypt. No key material leaves;
    // only booleans + the (opaque) ciphertext shape.
    const { encryptRecord, decryptRecord } = await import("@/lib/crypto/vaultCipher");
    const { vaultKeyBytes } = await import("@/lib/identity/keystore");
    const { VAULT_CANARY } = await import("@/lib/vault/vault");
    const key = vaultKeyBytes();
    const record = { secret: VAULT_CANARY, n: 42 };
    const ct = encryptRecord(key, "probe", "r1", record);
    const ctText = JSON.stringify(ct);
    let decrypted: unknown = null;
    let roundTripOk = false;
    try {
      decrypted = decryptRecord(key, ct);
      roundTripOk = JSON.stringify(decrypted) === JSON.stringify(record);
    } catch {}
    // unauthorized: a different key must fail
    const wrongKey = new Uint8Array(32).fill(9);
    let wrongKeyRejected = false;
    try {
      decryptRecord(wrongKey, ct);
    } catch {
      wrongKeyRejected = true;
    }
    // moved-record: same key, but the AAD address changed
    let movedRejected = false;
    try {
      decryptRecord(key, { ...ct, id: "r2" });
    } catch {
      movedRejected = true;
    }
    return NextResponse.json({
      roundTripOk,
      plaintextInCiphertext: ctText.includes(VAULT_CANARY),
      wrongKeyRejected,
      movedRejected,
      ciphertextShape: { v: ct.v, hasCt: typeof ct.ct === "string", hasNonce: typeof ct.nonce === "string" },
    });
  }

  if (body.action === "vaultReadback") {
    // CRYPTO PASS Gate 2 probe. Runs the EXACT read gate hydrate() runs —
    // fetch a vault namespace's CIPHERTEXT from the validator and
    // decryptNamespace() it — WITHOUT touching global state (which
    // in-process nulling corrupts via stale references). This is what a
    // restart would reconstruct: recovered records are readable, tampered
    // ones are dropped (fail-closed), a wrong key throws.
    const ns = String(body.ns ?? "");
    const { isVaultNamespace, decryptNamespace } = await import("@/lib/vault/vault");
    if (!isVaultNamespace(ns)) return NextResponse.json({ error: `not a vault namespace: ${ns}` }, { status: 400 });
    const VBASE = validatorUrl();
    const res = await fetchState(ns);
    const stored = (await res.json())?.entries ?? {};
    const total = Object.keys(stored).length;
    try {
      const plain = decryptNamespace(ns, stored);
      return NextResponse.json({ ok: true, total, recovered: Object.keys(plain).length, ids: Object.keys(plain) });
    } catch (e) {
      // every record failed = wrong key: the loud path, surfaced honestly
      return NextResponse.json({ ok: false, total, wrongKey: true, error: (e as Error).message });
    }
  }

  if (body.action === "siwfProbe") {
    // PERSONA LAUNCH P1 (SIWF) test hook, READ-ONLY: how many personas of this process's keystore a Sign in with
    // Farcaster minted (all, and the fixture's), and whether the sealed link record reads as present. COUNTS only —
    // never an id, a handle, an fname or a fid. accept-siwf R8 asserts a resetSeed leaves 0 / 0 / no link.
    const { listPersonas, FIXTURE_SIWF_NONCE_PREFIX } = await import("@/lib/identity/keystore");
    const all = listPersonas();
    let link: "none" | "live" | "disconnected" | "unreadable" = "none";
    try {
      const { mainLink } = await import("@/lib/fc/siwf/links");
      const l = await mainLink();
      link = l ? (l.disconnectedAt === null ? "live" : "disconnected") : "none";
    } catch {
      link = "unreadable";
    }
    return NextResponse.json({
      publicSelfPersonas: all.filter((p) => p.publicSelf === true).length,
      fixtureSiwfPersonas: all.filter((p) => typeof p.nonce === "string" && p.nonce.startsWith(FIXTURE_SIWF_NONCE_PREFIX)).length,
      link,
    });
  }

  if (body.action === "dropSealedCaches") {
    // GATE 5 (attack-post-3 F-12): the fail-closed READ path was untestable. A process that
    // has already decrypted a sealed document does not re-read it, so corrupting the record on
    // the validator changes nothing until a restart — which is true, intended, and exactly why
    // the claim needed a way to be exercised. This forgets the decrypted documents and touches
    // nothing on the validator, so the next read is a COLD one against whatever is stored.
    const { resetChromeCache } = await import("@/lib/identity/chrome");
    const { resetDeliveryCache } = await import("@/lib/delivery/tiers");
    const { resetReadwiseStateCache } = await import("@/lib/readwise/state");
    const { resetZonesCache } = await import("@/lib/zones/store");
    const { resetPortsCache } = await import("@/lib/x/porting");
    const { resetInfluenceCache } = await import("@/lib/influence/allowance");
    resetChromeCache();
    resetDeliveryCache();
    resetReadwiseStateCache();
    resetZonesCache();
    resetPortsCache();
    resetInfluenceCache();
    // PERSONA LAUNCH P1 (SIWF): the sealed accountLinks record, so accept-siwf can exercise its fail-closed cold read
    const { resetAccountLinksCache } = await import("@/lib/fc/siwf/links");
    resetAccountLinksCache();
    // PERSONA LAUNCH P2 (Bring your X, byx's line): the chunked X documents, so accept-x5 R7 re-reads from the validator
    const { resetXDocsCache } = await import("@/lib/vault/chunkedDoc");
    resetXDocsCache();
    return NextResponse.json({ ok: true, dropped: ["personaChrome", "deliveryTiers", "readwiseState", "scrollZones", "relationshipPorts", "influence", "accountLinks", "xDocs"] });
  }

  if (body.action === "corruptVaultCiphertext") {
    // CRYPTO PASS Gate 2 test hook: flip a byte inside ONE stored
    // ciphertext record on the validator (a server-side tamper), through
    // the app's SIGNED flush so the armed validator accepts it. The next
    // vaultReadback must drop that record — the fail-closed read gate.
    const ns = String(body.ns ?? "");
    const targetKey = String(body.key ?? "");
    const { isVaultNamespace } = await import("@/lib/vault/vault");
    const { flushVault } = await import("@/lib/adapters/mock/persist");
    if (!isVaultNamespace(ns)) return NextResponse.json({ error: `not a vault namespace: ${ns}` }, { status: 400 });
    const VBASE = validatorUrl();
    const stored = (await (await fetchState(ns)).json())?.entries ?? {};
    const key = targetKey || Object.keys(stored)[0];
    const rec = stored[key];
    if (!rec || typeof rec.ct !== "string") return NextResponse.json({ error: "no ciphertext record to corrupt" }, { status: 400 });
    // flip the first ciphertext byte (keep it valid hex, change the value)
    const flipped = (rec.ct[0] === "0" ? "1" : "0") + rec.ct.slice(1);
    stored[key] = { ...rec, ct: flipped };
    // ns is validated by isVaultNamespace above
    await flushVault(ns as Parameters<typeof flushVault>[0], stored); // signed; whole-namespace replace
    return NextResponse.json({ ok: true, corruptedKey: key });
  }

  if (body.action === "tamperState") {
    // CRYPTO PASS TEST HOOK — the adversary's hand. Replaces one record
    // in one namespace WHOLESALE, bypassing every signing path, exactly
    // what a compromised validator (or any party who can write
    // adapter_state) could do to persisted records. Tamper tests assert
    // the READ side treats the result as ABSENT. Dev-route-only, like
    // forgeEvent above it.
    const ns = String(body.ns ?? "");
    const key = String(body.key ?? "");
    if (!ns || !key || body.value === undefined) {
      return NextResponse.json({ error: "ns, key, value required" }, { status: 400 });
    }
    const { state, persistNs } = await import("@/lib/adapters/mock/store");
    const { hydrate } = await import("@/lib/adapters/mock/store");
    await hydrate();
    const s = state() as unknown as Record<string, Map<string, unknown>>;
    const map = s[ns];
    if (!(map instanceof Map)) return NextResponse.json({ error: `unknown map namespace ${ns}` }, { status: 400 });
    const before = map.get(key) ?? null;
    map.set(key, body.value);
    await persistNs(ns as never);
    return NextResponse.json({ ok: true, before });
  }

  if (body.action === "issueTestDelegation") {
    // CRYPTO PASS Gate 0/3 test hook: the seed-holding device authorizes
    // a TEST device key supplied by the suite. This is the dev console
    // playing the "authorize new device" role the real linking UI (Gate
    // 3) will own — the dev route is already the demo's operator seat
    // (resetSeed, viewAs), so authority here is not new. Returns the
    // delegation cert: public material (the test device's own pubkey,
    // scopes, and a signature).
    const devicePubKey = String(body.devicePubKey ?? "");
    const deviceId = String(body.deviceId ?? "");
    if (!/^[0-9a-f]{64}$/.test(devicePubKey) || !deviceId) {
      return NextResponse.json({ error: "devicePubKey (32-byte hex) and deviceId required" }, { status: 400 });
    }
    const { signAsDeviceAuth, deviceAuthPublicKey } = await import("@/lib/identity/keystore");
    const { delegationCanonical } = await import("@/lib/identity/deviceKeys");
    const base = {
      v: 1 as const,
      deviceId,
      devicePubKey,
      scopes: ["state-write"],
      issuedAt: Date.now(),
      expiresAt: body.expiresAt === undefined ? null : Number(body.expiresAt),
    };
    const delegation = { ...base, signature: signAsDeviceAuth(delegationCanonical(base)) };
    return NextResponse.json({ delegation, anchorPubKey: deviceAuthPublicKey() });
  }

  if (body.action === "revokeDevice") {
    // CRYPTO PASS test hook: sign a revocation for a device id with the
    // device-auth key. Forward-looking only, as everywhere.
    const deviceId = String(body.deviceId ?? "");
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    const { signAsDeviceAuth } = await import("@/lib/identity/keystore");
    const issuedAt = Date.now();
    const canonical = ["layers-device-revoke/1", deviceId, String(issuedAt)].join("|");
    return NextResponse.json({ deviceId, issuedAt, signature: signAsDeviceAuth(canonical) });
  }

  if (body.action === "setDataSource") {
    // FC Gate 2: live is a runtime switch. "seed"/"neynar" override the env
    // default; null clears back to it. Flipping the source must never touch
    // persona/grant/mode state — this writes ONE globalThis slot and clears
    // the live-content cache, nothing else.
    const s = body.source === "neynar" ? "neynar" : body.source === "seed" ? "seed" : null;
    setDataSourceOverride(s);
    clearNeynarCache();
    // registry included: the Developer pane's call() contract reads it back
    return NextResponse.json({ dataSource: dataSource(), registry: registrySnapshot() });
  }

  if (body.action === "expireNeynarCache") {
    // ages entries past the fresh TTL, keeping the stale shelf stocked —
    // the deterministic path into degrade-to-cache for the fc2 suite
    const { expireNeynarCache } = await import("@/lib/adapters/neynar/content");
    expireNeynarCache();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "forceNeynar429") {
    // FC Gate 2: arm N synthetic 429s on the live transport so the
    // degrade-to-cache path is provable, not probable.
    forceNeynar429(Number(body.count ?? 0));
    return NextResponse.json({ ok: true });
  }

  if (body.action === "forceFcPublishDrop") {
    // FC Gate 3: drop the next N fixture-publish RESPONSES post-commit —
    // the deterministic mid-publish kill for the check-before-retry test.
    const { forceFcPublishDrop } = await import("@/lib/adapters/devControls");
    forceFcPublishDrop(Number(body.count ?? 0));
    return NextResponse.json({ ok: true });
  }

  if (body.action === "fcSimNetwork") {
    // Test observability: what the fixture "network" actually holds —
    // the exactly-one-cast assertion reads THIS, not the ledger's claim.
    const { fcSimNetworkCasts } = await import("@/lib/fc/writes");
    return NextResponse.json({ casts: fcSimNetworkCasts() });
  }

  if (body.action === "maxLatency") {
    maxOutLatencyInjection(!!body.on);
  } else if (body.action === "setLatency") {
    setLatencyInjection(body.range ?? null);
    setFailureRateOverride(body.failureRate ?? null);
  } else if (body.action === "resetSeed") {
    // Reset must also disarm EVERY test-only injection knob, not just the
    // forced-failure budget: a maxed-out latency/failure-rate override left
    // on by an interrupted or manually-driven suite survives resetSeed
    // otherwise (these live in devControls' own globalThis state, entirely
    // outside the mock store resetState() replaces) and silently elevates
    // the synthetic failure rate for every suite that runs afterward in the
    // same long-lived server process — intermittent, looks like ordering,
    // isn't. Found via a real recurrence: a long interactive debugging
    // session left the rate elevated and b2's destination-list check
    // (which doesn't retry on an INCOMPLETE 200, only on a failed fetch)
    // intermittently saw one of two mock destinations silently dropped.
    forceFailNext("", 0);
    maxOutLatencyInjection(false);
    setLatencyInjection(null);
    setFailureRateOverride(null);
    // FC Gate 2/3 knobs are knobs too (the UX-pass lesson, applied on
    // arrival rather than after a debugging session pays for it again):
    // the runtime source override, the forced-429 budget, the live cache,
    // the publish-drop budget, and the fixture "network" all reset with
    // the seed.
    setDataSourceOverride(null);
    // Attestation pass: the chain-facts source and the honoured-issuer list
    // are runtime knobs too — a live-att1 run or a rig override must not
    // outlive the seed it was armed against
    const { setChainSourceOverride } = await import("@/lib/attest/chain/source");
    setChainSourceOverride(null);
    const { setHonoredIssuersOverride } = await import("@/lib/attest/subscriber");
    setHonoredIssuersOverride(null);
    // MULTI-FID Gate 0: the web-proof and fid-facts sources are knobs too
    const { setWebProofSourceOverride } = await import("@/lib/attest/webproof/source");
    setWebProofSourceOverride(null);
    const { setFidSourceOverride } = await import("@/lib/attest/fid/source");
    setFidSourceOverride(null);
    forceNeynar429(0);
    clearNeynarCache();
    const { forceFcPublishDrop } = await import("@/lib/adapters/devControls");
    forceFcPublishDrop(0);
    const { resetFcSimNetwork } = await import("@/lib/fc/writes");
    resetFcSimNetwork();
    // ZK PASS 1: the zk runtime knobs (rep binding override, gate fallback
    // override, relay override) reset with the seed too — same lesson.
    const { resetZkRuntimeOverrides } = await import("@/lib/zk/gate");
    await resetZkRuntimeOverrides();
    // ZK PASS 2 Gate 2: the in-process device-roster cache resets with the
    // seed too — the vault namespace it mirrors is wiped by resetState.
    const { resetRootRoster } = await import("@/lib/identity/rootRoster");
    resetRootRoster();
    // CONNECT MAIN review (UXC-13): the personas minted for FIXTURE main-account connections (nonce
    // "fixture-connect:…", lib/fc/connect.ts mintMainPersona) and the fixture network's simulated
    // signers are seed state — they go with the reset, or every rig run of the connect suite leaves
    // another "Fixture Main" in the switcher and the sealed roster. Purged BEFORE resetState, so
    // whatever the reset rebuilds from the keystore (the roster it re-syncs) no longer lists them.
    // A live connection's persona never carries the prefix and is never touched here.
    const { purgeFixtureConnectPersonas } = await import("@/lib/identity/keystore");
    purgeFixtureConnectPersonas();
    const { resetConnectFixture } = await import("@/lib/fc/connect");
    resetConnectFixture();
    // PERSONA LAUNCH P1 (SIWF): the personas minted by FIXTURE sign-ins (nonce "fixture-siwf:…", lib/fc/siwf/flow.ts)
    // and the fixture relay/chain and any sign-in in progress are seed state too — purged BEFORE resetState for the same
    // reason as the fixture connect's (the roster it re-syncs must not list them). A live sign-in's persona never
    // carries the prefix (and a live sign-in never runs on a server).
    const { purgeFixtureSiwfPersonas } = await import("@/lib/identity/keystore");
    purgeFixtureSiwfPersonas();
    const { resetSiwf } = await import("@/lib/fc/siwf/flow");
    resetSiwf();
    // CONNECTOR SETUP: the validator wipe takes the sealed "fcConnector" record with it (rig only; resetSeed is refused
    // on the owner service) — the in-process copy must not outlive it
    const { resetConnectorCache } = await import("@/lib/fc/connector.server");
    resetConnectorCache();
    // AWAITED. resetState is async — it re-seeds the grant graph and the
    // private world, purges forked personas, and wipes persisted namespaces.
    // Unawaited, this route returned 200 before any of that finished, so
    // every test that resets and then immediately asserts was racing an
    // unfinished reset. On a warm server the work landed inside the test's
    // wait; on a cold one it did not, which is why failures clustered in the
    // first sweep after a restart and vanished afterwards.
    //
    // Reporting success for work that has not happened is the same defect as
    // failing open, wearing different clothes.
    await resetState();
    resetMockBlocks();
    // Attestation pass /verify: the sealed attestation record is cached in
    // this process — resetState wiped the validator's copy, so the cache and
    // the proof-derived cache go with it (the seed never issued them). AFTER
    // the wipe, so a concurrent prefetch tick cannot reload the old record.
    const { resetAttestationVaultCache } = await import("@/lib/attest/vault");
    resetAttestationVaultCache();
    // MULTI-FID Gate 1: the persona ↔ fid record cache, the network mode and the custody kind
    // MEGA PASS 2 Gate 6: the sealed relationship-port record is cached in this process too
    const { resetPortsCache } = await import("@/lib/x/porting");
    resetPortsCache();
    // MEGA PASS 2 Gate 5: the inbox's session replies log and the per-mode DM cadence counters
    const { resetInboxReplies, resetDmCadence } = await import("@/lib/x/inbox");
    resetInboxReplies();
    resetDmCadence();
    // MEGA PASS 2 Gate 4: the in-process search index (re-derived from the vault), the model worker's override and
    // the fixture cloud-send log reset with the seed
    const { resetUnifiedIndex, resetCloudSends } = await import("@/lib/search/unified");
    resetUnifiedIndex();
    resetCloudSends();
    const { resetEmbedWorker } = await import("@/lib/search/embedWorker");
    resetEmbedWorker();
    // MEGA PASS 2 Gate 3: the sealed scroll-zone record too
    const { resetZonesCache } = await import("@/lib/zones/store");
    resetZonesCache();
    // POST-DEPLOY Gate 2: the sealed persona-chrome record (tints + the view scope).
    // It has to reset with the seed for the reason every other sealed cache does, and
    // one more: a compartment flag left ON in this process after the validator's copy
    // was wiped would be a protection nothing on disk agrees with, and the next save
    // would seal it back over an empty vault.
    const { resetChromeCache } = await import("@/lib/identity/chrome");
    resetChromeCache();
    // POST-DEPLOY Gate 3: the sealed delivery-tier map, same reasoning — a quiet
    // setting cached in this process after the validator's copy was wiped is a
    // setting the owner cannot see and cannot change.
    const { resetDeliveryCache } = await import("@/lib/delivery/tiers");
    resetDeliveryCache();
    // POST-DEPLOY Gate 4: the sealed readwise state (knobs, priority folders, the
    // dwell map and the bin) resets with the seed like every other sealed cache —
    // a bin cached in this process after the validator copy was wiped holds
    // chunks the owner can see listed and cannot restore.
    const { resetReadwiseStateCache } = await import("@/lib/readwise/state");
    resetReadwiseStateCache();
    // GATE 5 (attack-post-1 F-7): the acting-persona allowlist is process state derived from
    // a roster this reset wipes, so it goes with it.
    const { resetActable } = await import("@/lib/activePersona");
    resetActable();
    // GATE 5 (attack-post-3 F-11): two OLDER sealed caches had no reset function at all, so
    // their next write resurrected what this reset had just wiped — every anon-reveal secret,
    // and the handle -> root table. Out of this pass's own diff, but it is the same bug class
    // this pass keeps finding, and leaving it after a review named it would be a choice.
    const { resetAnonAttributionCache } = await import("@/lib/zk/anonAttribution");
    resetAnonAttributionCache();
    const { resetSessionHandlesCache } = await import("@/lib/identity/sessionHandles");
    resetSessionHandlesCache();
    // GATE 5 (attack-post-3 F-2, residual): the sealed persona-to-fid record and the device
    // roster are caches too. Under the old reload, root B ran on root A's fid map and the
    // first write sealed root A's fids, custody addresses and signer uuids into root B's
    // vault. The sealed-pin file is per-root as well.
    // CONNECT MAIN review (a PRE-EXISTING defect, fixed here): this used to call
    // forgetPersonaFids() with no mode and no await, AFTER resetState had restored the live
    // records (store.resetSeed reseeds them — attack-fid-3 #2: a real account's signer lives
    // nowhere else). With no mode it sealed an EMPTY personaFids document over that restored
    // copy, so a rig reset wiped every live persona record and the connected main record. What
    // must go is the in-process CACHE (resetPersonaFidCache, below, after the pins): the next
    // load re-reads the validator's restored copy instead of sealing emptiness over it.
    // resetSeed WIPES the validator's rows, so the pins are DELETED rather than merely
    // forgotten — a pin that outlived the rows it records would make every sealed namespace
    // refuse its next (legitimately empty) read.
    const { resetSealedPins } = await import("@/lib/vault/sealedPins");
    resetSealedPins();
    // MEGA PASS 2 Gate 1: the sealed influence record is cached in this process too
    const { resetInfluenceCache } = await import("@/lib/influence/allowance");
    resetInfluenceCache();
    const { resetPersonaFidCache } = await import("@/lib/fc/personaFid");
    resetPersonaFidCache();
    // PERSONA LAUNCH P1 (SIWF): the wipe took the sealed accountLinks record; the in-process copy goes with it (AFTER the
    // pins, so the next read is a legitimately empty one)
    const { resetAccountLinksCache } = await import("@/lib/fc/siwf/links");
    resetAccountLinksCache();
    // POST AS YOU: the sealed posting-key record and its approval memory go with the wipe too
    (await import("@/lib/fc/rootSigner/store")).resetRootSignerCache();
    (await import("@/lib/fc/rootSigner/flow")).resetRootPost();
    // FOLLOWING FROM THE HUB: the device's read cache and its pause (runtime-armed state: the reset contract)
    (await import("@/lib/fc/hubRead/read")).resetHubReads();
    // NOTIFICATIONS FROM FARCASTER: the sealed seen record went with the wipe; its in-process copy goes too
    (await import("@/lib/fc/hubRead/seen")).resetNotifSeenCache();
    // ADS, PHASE 1: the sealed hidden-ads record went with the wipe too
    (await import("@/lib/ads/hides")).resetAdHidesCache();
    // PERSONA LAUNCH P2 (Bring your X, byx's line): the chunked X documents' cache
    const { resetXDocsCache } = await import("@/lib/vault/chunkedDoc");
    resetXDocsCache();
    // BUILD A (post-box set): the rig-only fixture-delivery knob already auto-disarms when
    // resetState replaces the store object (fixtureDeliveryArmed compares state identity);
    // disarmed explicitly too, so the reset contract reads complete rather than relying on it.
    const { setFixtureDelivery } = await import("@/app/api/actions/farcasterDelivery");
    setFixtureDelivery(false);
    const { setNetworkModeOverride } = await import("@/lib/fc/networkMode");
    setNetworkModeOverride(null);
    const { setCustodyOverride } = await import("@/lib/fc/custody/source");
    setCustodyOverride(null);
    const { clearProvenAttestations } = await import("@/lib/attest/proven");
    clearProvenAttestations();
    // PERSONA LAUNCH P4 (rings): AFTER the wipe (resetState emptied the validator's "rings" namespace, so the document IS
    // the empty one — the next tick writes it): every rings cache in this process, and the drop's rows (on a rig every
    // row is test data; the validator mounts the reset only under dev hooks)
    const { resetRingsCaches } = await import("@/lib/rings/tick");
    await resetRingsCaches({ knownEmpty: true });
    try {
      await fetch(validatorUrl() + "/rings/dev/reset", { method: "POST", cache: "no-store" });
    } catch {
      /* the drop's rows expire on their own; a rig whose validator is down fails louder elsewhere */
    }
    // PERSONA LAUNCH P6 (the launch track's lines): the launch confirmations, the fixture chain's cache, the thin relay
    (await import("@/lib/launch/confirm")).resetLaunchCaches();
    (await import("@/lib/fc/chain/fixture")).resetChainFixtureCache();
    (await import("@/lib/fc/thinRelay")).resetThinRelay();
    // PERSONA LAUNCH P5 (the reach track's line): the reach buckets this root holds
    (await import("@/lib/reach/held")).resetReachCaches();
  } else if (body.action === "resetInboxCursor") {
    // MEGA PASS 2 Gate 7: re-read the fixture inbox from page 0 (the same-tweet, two-personas linkage rig)
    const { resetInboxCursor } = await import("@/lib/x/inbox");
    await resetInboxCursor();
  } else if (body.action === "fastForwardReadwise") {
    await adapters.feedHealth.fastForwardAll(activeSeedPersonaId());
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ registry: registrySnapshot() });
}
