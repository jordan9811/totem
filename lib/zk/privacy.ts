import "server-only";
// ZK PASS 1 Gate 3 — THE COMPUTED PRIVACY LABEL. Never hardcoded, and
// never a caller's word: every condition below is computed by THIS
// process at read time (attack-2 finding 4 / attack-3 F-6 retired the
// build stamps a suite used to post).
//
// A gate may display a privacy claim ONLY when all EIGHT hold:
//   1. the relay adapter is ohttp or tor — not direct — AND the operator has
//      attested the relay is run by a non-colluding third party
//   2. the tier cohort — rebuilt from the served leaves to the SIGNED root —
//      clears the CLIENT's anonymity floor and has not rotated past the
//      continuity limit (attack-3 F-1/F-2)
//   3. jittered submission is on, the scheduler's in-process self-test
//      passes, and the validator's epoch is at least the client minimum
//   4. the scope-collision self-test passes now, on this root's secret
//   5. the verification key the verifiers USE is the build pin, and the
//      cached proving artifacts hash to their pins
//   6. the proof-history budget refuses on a reachable path
//   7. the universe is LIVE (the fixture "proof" is a public tag — attack-3 F-5)
//   8. the gate fallback is `none` (policy partitions the set — attack-3 F-5)
// Otherwise the surface says "DEMO — not yet private: <failing conditions>",
// non-dismissably. The private text is deliberately narrow.
//
// PERSONA LAUNCH P7 — the same label computed IN THE VISITOR'S BROWSER (the public preview's device). Two conditions
// read different evidence there, never a fetch at render: condition 1 names the browser's web channel (under direct the
// operator sees the visitor's IP and user-agent on every submission, A-WEB-CHANNEL-DIRECT-UA — DEMO, always), and
// condition 5 reads what this tab's Web Worker prover LAST VERIFIED (lib/zk/transport/browser.ts lastVerifiedPins:
// the bundled key and the served proving files, each checked against the ceremony pins) instead of a key file and an
// artifact cache the tab does not have.
import { ZK_ANON_FLOOR, ZK_EPOCH_MIN_MS, ZK_GATE_TIER, ZK_JITTER_MIN_MS, zkMode, type ZkMode } from "./config";
import { validBucket, validIssuer } from "@/lib/attest/ids";
import { isHonoredIssuer } from "@/lib/attest/subscriber";
import { relayConfig } from "./anon/relay";
import { jitterSelfTest } from "./anon/queue";
import { checkCachedArtifacts } from "./artifacts";
import { loadPinnedVkey } from "./ceremony";
import { checkCohort } from "./cohort";
import { gateFallback } from "./gate";
import { cachedSnapshot, ensurePrefetchLoop } from "./prefetch";
import { verifyRootAgainstHistoryWith } from "./rootHistory";
import { budgetSelfTest, scopeCollisionSelfTest } from "./selftest";

// the two strings live in lib/zk/labels.ts, which has no "server-only" and so can be read by the landing page and
// the browser; this module computes the verdict they name (BROWSER KEYSTORE PASS Gate 6)
export { DEMO_PREFIX, PRIVATE_LABEL } from "./labels";
import { DEMO_PREFIX, PRIVATE_LABEL } from "./labels";

export type PrivacyKey = "relay" | "floor" | "jitter" | "scopes" | "ceremony" | "budget" | "universe" | "fallback" | "attestation" | "anon-relay";

/** Attestation pass Gate 3: an attestation-GATED surface names the bucket it
 * gates on; the label then carries a ninth condition — that bucket clears the
 * client's floor on the tick's census and its issuer is honoured here. */
export interface PrivacyOptions {
  attestation?: { issuer: string; bucket: string };
  /** MULTI-FID Gate 5 (attack-fid-1 #3): the anon composer passes the validator's relay config; the tenth condition is then
   * computed — the anon account is a credential and a fid DISTINCT from this app's own Neynar identity */
  anon?: { liveRelay: boolean; fid: number; relayKeyFingerprint: string | null };
}

export interface PrivacyCondition {
  id: number;
  key: PrivacyKey;
  ok: boolean;
  detail: string;
}

export interface PrivacyVerdict {
  private: boolean;
  label: string;
  conditions: PrivacyCondition[];
  failing: string[];
  mode: ZkMode;
  computedAt: number;
}

/** what THIS app is, for condition 10: its own key's fingerprint, its throwaway fid, and every persona fid this device
 * holds (ALL records, compartment or not — R3-11); null personaFids when the record cannot be read (fail closed) */
export async function ownIdentityFacts(): Promise<import("./anon/relayAccount").OwnIdentityFacts> {
  const { keyFingerprint } = await import("./anon/relayAccount");
  const throwaway = Number(process.env.FC_TEST_FID ?? "");
  let personaFids: number[] | null = null;
  try {
    const { allPersonaFids } = await import("@/lib/fc/personaFid");
    personaFids = (await allPersonaFids()).map((r) => r.fid).filter((f) => Number.isInteger(f) && f > 0);
  } catch {
    personaFids = null;
  }
  return { ownKeyFingerprint: keyFingerprint(process.env.NEYNAR_API_KEY ?? ""), throwawayFid: Number.isInteger(throwaway) && throwaway > 0 ? throwaway : null, personaFids };
}

export async function privacyConditions(mode: ZkMode = zkMode(), opts: PrivacyOptions = {}): Promise<PrivacyVerdict> {
  const conditions: PrivacyCondition[] = [];

  // 1. relay
  const relay = relayConfig();
  const relayOk = relay.kind !== "direct" && relay.thirdPartyAttested;
  const inBrowser = typeof window !== "undefined";
  conditions.push({
    id: 1,
    key: "relay",
    ok: relayOk,
    detail: inBrowser
      ? relay.kind === "direct"
        ? "relay is direct — this browser's anonymous channel goes straight to the operator, who sees your IP and your browser's user-agent on every submission"
        : relay.thirdPartyAttested
          ? `relay ${relay.kind}: this browser encrypts each submission in the tab and sends it through a relay attested as third-party (an attestation, not a check)`
          : `relay ${relay.kind} from this browser but NOT attested as a non-colluding third party`
      : relay.kind === "direct"
        ? "relay is direct — the operator sees your IP on every submission"
        : relay.thirdPartyAttested
          ? `relay ${relay.kind}, attested third-party (an attestation, not a check)`
          : `relay ${relay.kind} but NOT attested as a non-colluding third party`,
  });

  // 2. floor + continuity + the second viewpoint, computed HERE from the
  //    PREFETCH SNAPSHOT — the label never fetches at render time
  ensurePrefetchLoop();
  let floorOk = false;
  let floorDetail = "cohort unknown";
  let epochMs: number | null = null;
  try {
    const tree = `tier-${ZK_GATE_TIER}`;
    const snap = cachedSnapshot(mode);
    if (!snap || snap.tree !== tree) {
      floorDetail = "no prefetch snapshot for this universe yet — the label never fetches at render time; the next scheduled tick fills it";
    } else if (snap.members.epoch !== snap.epoch.epoch) {
      floorDetail = "snapshot straddled an epoch boundary — next tick";
    } else {
      epochMs = snap.epoch.epochMs;
      const rc = verifyRootAgainstHistoryWith(mode, tree, snap.members.root, { pubkey: snap.validatorKey, entries: snap.history.entries, anonHead: snap.anonHead, anonHeadError: snap.anonHeadError });
      if (!rc.ok) {
        floorDetail = `served root refused: ${rc.reason}`;
      } else {
        const c = checkCohort(mode, tree, snap.epoch.epoch, snap.members.root, snap.members.members);
        floorOk = c.ok;
        const cont = c.continuity.firstSight
          ? "first sight of this cohort on this device"
          : c.continuity.churn === null
            ? "same epoch as the recorded cohort"
            : `${c.continuity.retained}/${c.continuity.previousSize} of the cohort last proved into (epoch ${c.continuity.previousEpoch}) retained`;
        floorDetail = c.ok
          ? `${tree} cohort ${c.size} (leaves rebuild to the signed root) vs the client's floor ${c.floor}; continuity: ${cont}; second viewpoint agrees (anonymous head = identified head, epoch ${snap.epoch.epoch}); snapshot ${Math.round((Date.now() - snap.fetchedAt) / 1000)} s old`
          : c.reason ?? "cohort refused";
      }
    }
  } catch (e) {
    floorDetail = "cohort check failed closed: " + (e as Error).message;
  }
  conditions.push({ id: 2, key: "floor", ok: floorOk, detail: floorDetail });

  // 3. jitter: on, self-test, epoch grain
  const jitterOn = ZK_JITTER_MIN_MS > 0;
  const jt = jitterSelfTest();
  const grainOk = epochMs !== null && Number.isFinite(epochMs) && epochMs >= ZK_EPOCH_MIN_MS;
  conditions.push({
    id: 3,
    key: "jitter",
    ok: jitterOn && jt.ok && grainOk,
    detail: !jitterOn
      ? "jittered submission is OFF"
      : !jt.ok
        ? `scheduler self-test FAILED: ${jt.detail}`
        : !grainOk
          ? `validator epoch length ${epochMs === null ? "unknown" : epochMs + " ms"} is below the client minimum ${ZK_EPOCH_MIN_MS} ms`
          : `jitter on; ${jt.detail}; epoch ${epochMs} ms ≥ client minimum (scheduler-level evidence, not wire timing)`,
  });

  // 4. scope collision, computed now
  let sc: { ok: boolean; detail: string };
  try {
    sc = scopeCollisionSelfTest();
  } catch (e) {
    sc = { ok: false, detail: "self-test errored: " + (e as Error).message };
  }
  conditions.push({ id: 4, key: "scopes", ok: sc.ok, detail: sc.ok ? `scope-collision self-test passed: ${sc.detail}` : `scope-collision self-test FAILED: ${sc.detail}` });

  // 5. ceremony: the key the verifiers USE + the cached artifacts
  if (inBrowser) {
    // PERSONA LAUNCH P7: what this tab's prover last verified — memory only, never a fetch at render
    const { lastVerifiedPins } = await import("./transport/browser");
    const { ARTIFACT_PINS, PINNED_DEPTH, VKEY_PIN } = await import("./ceremonyPins");
    const lp = lastVerifiedPins();
    const pins = ARTIFACT_PINS[PINNED_DEPTH];
    const keyOk = !!lp && lp.vkeySha256 === VKEY_PIN.sha256;
    const filesOk = !!lp && lp.wasmSha256 === pins.wasm.sha256 && lp.zkeySha256 === pins.zkey.sha256;
    conditions.push({
      id: 5,
      key: "ceremony",
      ok: keyOk && filesOk,
      detail: !lp
        ? "this tab's prover has not checked the verification key and the proving files against the ceremony pins yet — it does before its first real proof"
        : !keyOk
          ? "the verification key this tab's prover last used is NOT the ceremony pin"
          : !filesOk
            ? "this tab's prover checked the pinned verification key, but no proving files yet (they are checked before the first real proof)"
            : `this tab's prover checked the verification key ${VKEY_PIN.sha256.slice(0, 12)}… and the proving files against the ceremony pins (${new Date(lp.at).toISOString().slice(11, 16)} UTC)`,
    });
  } else {
    let pinOk = false;
    let pinDetail = "";
    try {
      const pin = loadPinnedVkey();
      pinOk = true;
      pinDetail = `vkey file ${pin.sha256.slice(0, 12)}… (${pin.bytes} B) is the build pin and is the key both verifiers use`;
    } catch (e) {
      pinDetail = (e as Error).message;
    }
    const cached = checkCachedArtifacts();
    const artifactsOk = cached !== null && cached.wasm && cached.zkey;
    conditions.push({
      id: 5,
      key: "ceremony",
      ok: pinOk && artifactsOk,
      detail: !pinOk
        ? pinDetail
        : cached === null
          ? "proving artifacts are not cached on this host — nothing to verify against the ceremony pins yet"
          : !artifactsOk
            ? "a cached proving artifact FAILS its ceremony pin"
            : `${pinDetail}; cached wasm+zkey hash to the ceremony pins (re-hashed now)`,
    });
  }

  // 6. budget refuses on a reachable path
  let bt: { ok: boolean; detail: string };
  try {
    bt = budgetSelfTest();
  } catch (e) {
    bt = { ok: false, detail: "budget self-test errored: " + (e as Error).message };
  }
  conditions.push({ id: 6, key: "budget", ok: bt.ok, detail: bt.detail });

  // 7. universe
  conditions.push({
    id: 7,
    key: "universe",
    ok: mode === "live",
    detail: mode === "live" ? "live universe (stock Semaphore v4 proofs)" : "fixture universe — the fixture 'proof' is a tag under a public key; nothing it passes is evidence of privacy",
  });

  // 8. fallback
  const fb = gateFallback();
  conditions.push({
    id: 8,
    key: "fallback",
    ok: fb === "none",
    detail: fb === "none" ? "gate fallback is none (proof-only)" : "gate fallback is policy — unproven personas are admitted by the root-linked legacy tier, which partitions the set",
  });

  // 9. an attestation-gated surface: the bucket clears the floor on the tick's census, and the issuer is honoured
  if (opts.attestation) {
    const { issuer, bucket } = opts.attestation;
    let ok = false;
    let detail: string;
    const snap = cachedSnapshot(mode);
    const regKey = snap?.issuers?.find((i) => i.id === issuer)?.pubkey ?? null;
    if (!validIssuer(issuer) || !validBucket(bucket)) detail = "malformed issuer/bucket";
    else if (!isHonoredIssuer(issuer, regKey)) detail = `issuer ${issuer} is not honoured by this client (by key) — its bucket proves nothing here`;
    else {
      if (!snap) detail = "no prefetch snapshot yet — the label never fetches at render time; the next tick fills it";
      else if (snap.bucketsError) detail = "bucket census unavailable on the last tick: " + snap.bucketsError;
      else {
        const b = snap.buckets.find((x) => x.issuer === issuer && x.bucket === bucket);
        const size = b ? b.size : 0;
        ok = size >= ZK_ANON_FLOOR;
        detail = ok
          ? `bucket ${issuer}/${bucket} has ${size} members on the tick's census vs the client's floor ${ZK_ANON_FLOOR}`
          : `bucket ${issuer}/${bucket} has ${size} members — below the client's floor ${ZK_ANON_FLOOR}; the surface stays dark`;
      }
    }
    conditions.push({ id: 9, key: "attestation", ok, detail });
  }

  if (opts.anon) {
    // ANON REVIEW (R1-09, A2-6, R3-10): ONE pure decision (lib/zk/anon/relayAccount.ts) shared with the compose gate
    // and the proving tick — the key fingerprint, the throwaway, fid 9152, AND every persona fid this device holds
    // (hidden siblings included); an unreadable own-account list is a refusal, never a pass
    const { relayAccountVerdict } = await import("./anon/relayAccount");
    const v = relayAccountVerdict({ mode, liveRelay: opts.anon.liveRelay, fid: opts.anon.fid, relayKeyFingerprint: opts.anon.relayKeyFingerprint }, await ownIdentityFacts());
    conditions.push({ id: 10, key: "anon-relay", ok: v.ok, detail: v.detail });
  }

  const failing = conditions.filter((c) => !c.ok).map((c) => `${c.key}: ${c.detail}`);
  const isPrivate = failing.length === 0;
  return {
    private: isPrivate,
    label: isPrivate ? PRIVATE_LABEL : `${DEMO_PREFIX}: ${failing.join("; ")}`,
    conditions,
    failing,
    mode,
    computedAt: Date.now(),
  };
}
