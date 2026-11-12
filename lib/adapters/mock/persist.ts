import "server-only";
import { validatorUrl } from "@/lib/ports";
// Write-through persistence for mock adapter state, backed by the
// validator's adapter_state table (migration 002). Hydration happens once
// per process, inside withMockLatency(), so every mock adapter method picks
// it up without changing a single call site. Mutating methods call
// flush(ns) afterwards — awaited, not debounced, so a kill -9 immediately
// after a write can't lose it (the restart-survival test depends on this).
//
// CRYPTO PASS: when LAYERS_REQUIRE_SIG=true, every state write carries a
// device-signed envelope (x-layers-device / x-layers-counter /
// x-layers-sig) that the validator verifies against the registered
// device-auth anchor → delegation → device key chain. Bootstrap
// (anchor + self-delegation registration) happens lazily on the first
// signed write. Counters are per-namespace, based at Date.now() so a
// process restart is naturally monotonic without a sync read.
import { createHash } from "@/lib/platform/crypto";
import { storage } from "@/lib/platform/storage";

const BASE = validatorUrl();
const REQUIRE_SIG = () => process.env.LAYERS_REQUIRE_SIG === "true";

export type Namespace =
  | "grants"
  | "unlockRequests"
  | "followedFacets"
  | "modes"
  | "activeMode"
  | "rules"
  | "attestations"
  | "readwise"
  | "sends"
  | "receivePermission"
  | "saturation"
  | "likes"
  | "bookmarks"
  | "blocks"
  | "grantsV3"
  | "resolutionRequests"
  | "privatePosts"
  | "forks"
  | "channels"
  | "channelMembers"
  | "folders"
  | "folderFollows"
  | "rooms"
  | "highlights"
  | "graphClaims"
  | "graphConsent"
  | "imports"
  | "intents"
  | "bids"
  | "settlements"
  | "edgeEvents"
  | "algoCards"
  | "lastVisit"
  | "curatorSubs"
  | "refutationEdges"
  | "annotationVotes"
  | "curatorFeeds"
  | "annotationDrafts"
  | "xAttestations"
  | "xUnlinkedHandles"
  | "xImportSessions"
  | "xImportedPosts"
  | "xImportedPrivate"
  | "xMigrationSource"
  | "xSensitiveQueue"
  | "xSpend"
  | "xPublished"
  | "xSpendRun"
  | "xSyncCursor"
  | "personaDefaultMode"
  | "timelineUndoDepth"
  | "xMigrationPrefs"
  | "xMigrationNotices"
  | "strikeSettings"
  | "filterPacks"
  | "escrows"
  | "balances"
  | "readPrices"
  | "readRequests"
  | "dmPrices"
  | "dmRequests"
  | "pledges"
  | "tipEpochs"
  | "destinationBindings"
  | "crossposts"
  | "collapsePrefs"
  | "followDeltas"
  | "campaigns"
  | "coldResolved"
  | "altLinkAttempts"
  | "altLinkDisclaimerAcked"
  | "altXHandles"
  | "fcWrites"
  | "fcAttribution"
  // ZK PASS 1 (vaulted, ONE opaque sealed record): the jittered submission
  // queue. The proof budget and the root anchors are NOT persisted here —
  // they are device-local (lib/zk/localPins.ts): attack-1 finding 1 (the
  // vault seals values, not addresses) and attack-3 F-3 (the operator can
  // delete what it stores).
  | "zkQueue"
  // MEGA PASS 2 Gate 2: stored lenses (public artifacts; not vault material)
  | "lenses";

/** Namespaces persisted through flush() but NOT managed by store.ts's
 * serializer registry (they keep their own module-level state). */
export type ExtraNamespace = "sessionHandles" | "deviceLinks" | "identityRoster" | "seedEscrow" | "rootRoster" | "zkAttestations" | "personaFids" | "personaFidMap" | "anonAttribution" | "influence" | "scrollZones" | "relationshipPorts" | "rootLinks" | "personaChrome" | "deliveryTiers" | "readwiseState"
  // CONNECTOR SETUP: the sealed connector record (custody + recovery keys, fid, name) — lib/fc/connector.server.ts
  | "fcConnector"
  // PERSONA LAUNCH P1 (SIWF): the sealed Farcaster sign-in link — lib/fc/siwf/links.ts
  | "accountLinks"
  // POST AS YOU: the sealed posting key for the visitor's own Farcaster account — lib/fc/rootSigner/store.ts
  | "rootSigner"
  // PERSONA LAUNCH P4 (rings): ONE padded sealed record holding the owner side (rings, members, note keys, the rows this
  // device keeps on the drop) and the member side's addresses — written by EVERY device on its first tick, rings or not
  // (lib/rings/model.ts). What a member RECEIVES is memory-only and never lands here.
  | "rings"
  // NOTIFICATIONS FROM FARCASTER: when the root last saw its notifications, one padded record — lib/fc/hubRead/seen.ts
  | "fcNotifications"
  // ADS, PHASE 1: the ads and advertisers each identity hid, one padded record — lib/ads/hides.ts
  | "adHides";

/**
 * PERSONA LAUNCH P2 (BYX G2): the names of a module-owned CHUNKED document's pieces (lib/vault/chunkedDoc.ts) —
 * `xShelf.m`, `xShelf.g0.3`, ... They are generated, so they are not added to the unions above one by one; this
 * template type admits them to flushVault and nothing else. Every one starts with "x" (the X documents).
 */
export type ChunkNamespace = `x${string}.m` | `x${string}.g${number}.${number}`;

/**
 * PERSONA LAUNCH P2 (BYX G1) — THE STATE BODY LIMIT, a deliberate duplicate of validator/limits.js (a unit test asserts
 * the two are equal). A PUT bigger than this is refused HERE, before it is sent, with the namespace and the size —
 * the validator would answer 413 anyway, and the old client dropped that answer without a word.
 */
export const STATE_BODY_LIMIT_BYTES = 262144;

/** PERSONA LAUNCH P2 (BYX G1): a save that did not land. Carries the namespace, the HTTP status (0 = unreachable) and
 *  the body size, so every route can say what happened in plain words; nothing is marked saved behind it. */
export class PersistError extends Error {
  readonly ns: string;
  readonly status: number;
  readonly bytes: number;
  constructor(ns: string, status: number, bytes: number, message?: string) {
    const kb = (n: number) => Math.ceil(n / 1024);
    super(
      message ??
        (status === 413
          ? `couldn't save ${ns}: ${kb(bytes)} KB is over the ${kb(STATE_BODY_LIMIT_BYTES)} KB limit`
          : status === 0
            ? `couldn't save ${ns}: the validator could not be reached`
            : `couldn't save ${ns}: the validator answered ${status}`)
    );
    this.name = "PersistError";
    this.ns = ns;
    this.status = status;
    this.bytes = bytes;
  }
}

/** the byte length a body has on the wire (UTF-8), the measure the validator's body parser applies */
function wireBytes(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** the waits before the three retries of a failed save (a network error or a 5xx) */
export const FLUSH_RETRY_MS = [250, 500, 1000];

/**
 * PERSONA LAUNCH P2 (review W1-R4) — ONE NAMESPACE, ONE BODY IN FLIGHT. Every PUT of a namespace from this process
 * queues behind the previous one (sent, retried, answered or given up) before it is even signed. Without it, a save
 * whose first attempt met a 5xx was retried 250 ms later with a FRESH, higher counter — so the validator, which keeps
 * whichever body carries the highest counter, accepted the OLDER body after a newer save had landed (and a newer body
 * that overtook an older one in flight turned the older one into a "stale counter" 409 thrown at a caller whose data
 * the newer body already carried). In order, the newest call is always the last body to land, and a later body never
 * takes a counter before an earlier one is done. The slot is taken SYNCHRONOUSLY at the call (flush and flushVault
 * reserve it before their first await), so the order is the order the callers asked in.
 */
const putChains = (): Map<string, Promise<unknown>> =>
  ((globalThis as unknown as { __layersPutChains?: Map<string, Promise<unknown>> }).__layersPutChains ??= new Map<string, Promise<unknown>>());
function inNamespaceOrder<T>(ns: string, task: () => Promise<T>): Promise<T> {
  const chains = putChains();
  const prior = chains.get(ns) ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(task);
  chains.set(ns, run);
  const clear = () => {
    if (chains.get(ns) === run) chains.delete(ns);
  };
  run.then(clear, clear);
  return run;
}

/** the refusal's own words, and whether it is the envelope's "stale counter" (another signed request on the same
 *  namespace took a later counter and reached the validator first) */
async function refusalOf(res: Response): Promise<{ stale: boolean; named: string }> {
  let named = "";
  try {
    const j = (await res.json()) as { error?: unknown };
    if (typeof j?.error === "string") named = j.error;
  } catch {
    /* a body that is not JSON names nothing */
  }
  return { stale: res.status === 409 && /^stale counter/.test(named), named };
}

/**
 * PERSONA LAUNCH P2 (BYX G1): ONE write path for every namespace PUT, LOUD. The size is checked before sending (over
 * the limit = PersistError 413, nothing sent). A network rejection or a 5xx is retried three times (250/500/1000 ms) —
 * each attempt RE-SIGNED, because the validator consumes an envelope counter before it answers, so a resend with the
 * old counter would read as a replay — then thrown. A 409 STALE COUNTER is retried the same way (review W1-R4): the
 * namespace chain guarantees no later body of this namespace from this process exists yet, so the counter it lost to
 * belonged to a concurrent signed READ of the same name (reads and writes share the per-name counter), and this body
 * is still the newest; re-signed, it lands. Any other non-OK (a 4xx: a refused signature, a 413 the pre-check could not
 * foresee) is thrown at once. A 429 is waited out inside validatorFetch. Callers go through flush / flushVault, which
 * run this inside the namespace's chain.
 */
async function putState(ns: string, entries: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ entries });
  const bytes = wireBytes(body);
  if (bytes > STATE_BODY_LIMIT_BYTES) throw new PersistError(ns, 413, bytes);
  const entriesJson = REQUIRE_SIG() ? JSON.stringify(entries) : "";
  let last: PersistError | null = null;
  for (let attempt = 0; attempt <= FLUSH_RETRY_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, FLUSH_RETRY_MS[attempt - 1]));
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    if (REQUIRE_SIG()) headers = { ...headers, ...(await envelopeHeaders(ns, entriesJson)) };
    let res: Response;
    try {
      res = await validatorFetch(BASE + `/state/${ns}`, { method: "PUT", headers, body });
    } catch (e) {
      last = new PersistError(ns, 0, bytes, `couldn't save ${ns}: the validator could not be reached (${(e as Error).message})`);
      continue;
    }
    if (res.ok) return;
    if (res.status >= 500) {
      last = new PersistError(ns, res.status, bytes);
      continue;
    }
    const { stale, named } = await refusalOf(res);
    if (stale) {
      last = new PersistError(ns, res.status, bytes, `couldn't save ${ns}: the validator refused it (HTTP 409: ${named})`);
      continue;
    }
    throw new PersistError(ns, res.status, bytes, res.status === 413 ? undefined : `couldn't save ${ns}: the validator refused it (HTTP ${res.status}${named ? ": " + named : ""})`);
  }
  throw last ?? new PersistError(ns, 0, bytes);
}

/**
 * BROWSER KEYSTORE PASS Gate 6 (D-CU-6-A-429-MEANS-LATER) — one fetch to the validator, with the ONE refusal that
 * means "try again" honoured: a rate limit. Booting a device is a burst of a dozen calls (anchor, delegation, root,
 * then a namespace per vault), so a visitor who arrives when the per-address budget is momentarily empty would
 * otherwise get no identity at all — the failure `test:cu6` surfaced when it ran straight after Gate 4's bursts.
 * Bounded: four waits of at most eight seconds, taking the Retry-After the validator names. Every other status is
 * returned untouched, so nothing else about the fail-closed discipline changes.
 */
async function validatorFetch(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { cache: "no-store", ...init });
    if (res.status !== 429 || attempt >= 4) return res;
    const named = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(8000, Math.max(250, (Number.isFinite(named) && named > 0 ? named : 1) * 1000));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function vfetch(path: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await validatorFetch(BASE + path, init);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- signed-envelope client (crypto pass) ----------

interface EnvelopeState {
  bootstrapped: boolean;
  counters: Map<string, number>;
  /** PUBLIC GO-LIVE (final verify): bumped by every identity change (resetEnvelopeBootstrap); a registration that was in
   *  flight across a bump registered the identity BEFORE it, so it never sets `bootstrapped` (see ensureBootstrapped) */
  gen?: number;
  /** PUBLIC GO-LIVE (final verify): the ONE device registration in flight (a bootstrap or an enrollWithSeed) — they
   *  never overlap, so the last registration to reach the validator is the last one started */
  lane?: Promise<unknown>;
}
const g = globalThis as unknown as { __layersEnvelope?: EnvelopeState };
g.__layersEnvelope ??= { bootstrapped: false, counters: new Map() };
// self-heal across hot reloads (devControls lesson)
g.__layersEnvelope.counters ??= new Map();

/** Force the next signed write to re-run bootstrap (anchor + device
 * delegation registration). Called when the device identity changes out
 * from under us: device-loss simulation, and recovery onto a fresh
 * device. Without this, a new device.json is generated but never
 * registered, and every envelope write is refused as an unknown device. */
export function resetEnvelopeBootstrap(): void {
  const st = g.__layersEnvelope!;
  st.bootstrapped = false;
  st.gen = (st.gen ?? 0) + 1;
}

/** PUBLIC GO-LIVE (final verify): run one device registration after any other one has finished (answered or failed) */
function inRegistrationLane<T>(task: () => Promise<T>): Promise<T> {
  const st = g.__layersEnvelope!;
  const run = (st.lane ?? Promise.resolve()).catch(() => undefined).then(task);
  st.lane = run.catch(() => undefined);
  return run;
}

// ZK PASS 2 Gate 4 (attack-z2-1 finding 2): the counter used to BE the
// wall clock, and the validator keeps the last one per (device, namespace)
// forever — so a signed roster flush 3 ms after POST /personas paired the
// persona row with the device from the database alone. The counter is now
// a device-persisted monotonic integer (.keystore/envelope-counters.json):
// prev + 1, always. A fresh device (no file) starts from an HOUR-grain base
// far above any clock value ever sent, so it stays monotonic across the
// old scheme, restarts and a torn file — and carries nothing finer than
// the hour (the grain the zk rows already accept).
const COUNTER_FILE = () => {
  const dir = process.env.KEYSTORE_DIR || require("node:path").join(process.cwd(), ".keystore");
  return require("node:path").join(dir, "envelope-counters.json");
};
const COUNTER_BASE = 2 ** 52; // > any Date.now() for the next ~140,000 years
function loadCounters(): Map<string, number> {
  try {
    const raw = storage.readText(COUNTER_FILE());
    const j = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(j).filter(([, v]) => Number.isSafeInteger(v)));
  } catch {
    return new Map();
  }
}
function saveCounters(m: Map<string, number>): void {
  try {
    storage.writeText(COUNTER_FILE(), JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* an unwritable keystore dir: the in-memory counter still advances this process */
  }
}
function freshBase(): number {
  const hour = Math.floor(Date.now() / 3_600_000);
  return COUNTER_BASE + hour * 1_000_000 + Math.floor(Math.random() * 1_000_000);
}
function nextCounter(ns: string): number {
  const st = g.__layersEnvelope!;
  if (st.counters.size === 0) for (const [k, v] of loadCounters()) st.counters.set(k, v);
  const prev = st.counters.get(ns);
  const next = prev === undefined ? freshBase() : prev + 1;
  st.counters.set(ns, next);
  saveCounters(st.counters);
  return next;
}

/**
 * Ensure the anchor and this device's self-delegation are registered.
 * Idempotent (the validator's anchor registration is first-write-wins
 * and re-registering a delegation is an upsert). Lazy: runs on the
 * first signed write of the process.
 */
// PUBLIC GO-LIVE (final verify) — THE LATCH RACE. The bootstrap awaits two requests, and the identity can change while
// they are in flight: total device loss then recovery (the rig's dev hook, a recovery from the words), an unlock or a
// link in a tab (lib/device/boot.ts). The prefetch tick writes every few seconds, so its bootstrap regularly started
// under the OLD identity, then set `bootstrapped` AFTER the change's resetEnvelopeBootstrap() — and its late
// registration had moved this device back onto the old identity's anchor at the validator. Every later signed write
// then landed in the wrong tenant (the rig: z0's device loss left the server's roster, attestations and queue under a
// throwaway anchor, and z7, att4 and fid1 failed in three closing sweeps). Now registrations never overlap (one lane,
// enrollWithSeed in it too), and a bootstrap that ran across an identity change does not count: it registers again,
// for the identity that is current.
async function ensureBootstrapped(): Promise<void> {
  const st = g.__layersEnvelope!;
  for (let round = 0; !st.bootstrapped; round++) {
    if (round >= 4) throw new Error("persist: the device identity kept changing while it registered — refusing to sign under a registration that may name another identity");
    await inRegistrationLane(async () => {
      if (st.bootstrapped) return; // a registration ahead of this one in the lane already did it, for the current identity
      const gen = st.gen ?? 0;
      await bootstrapOnce();
      if ((st.gen ?? 0) === gen) st.bootstrapped = true; // else the identity changed in flight: the loop registers again
    });
  }
}

/** ONE registration of this device under the identity the keystore holds NOW (ensureBootstrapped decides if it counts) */
async function bootstrapOnce(): Promise<void> {
  const { deviceAuthPublicKey, signAsDeviceAuth } = await import("@/lib/identity/keystore");
  const { deviceIdentity, delegationCanonical } = await import("@/lib/identity/deviceKeys");
  const device = deviceIdentity();
  const anchor = await vfetch("/device/auth-anchor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: deviceAuthPublicKey() }),
  });
  const base = {
    v: 1 as const,
    deviceId: device.deviceId,
    devicePubKey: device.pubHex,
    scopes: ["state-write"],
    issuedAt: Date.now(),
    expiresAt: null,
  };
  // BROWSER KEYSTORE PASS Gate 3: a LINKED device holds no device-auth key; it registers the delegation the link
  // delivered for its own key instead of issuing one
  const { linkedDelegation } = await import("@/lib/identity/keystore");
  const delivered = linkedDelegation() as { devicePubKey?: string } | null;
  if (delivered && delivered.devicePubKey !== device.pubHex) throw new Error("persist: the linked delegation names another device key");
  const delegation = delivered ?? { ...base, signature: signAsDeviceAuth(delegationCanonical(base)) };
  // Gate 5 (attack-custody-1 #2): the registration carries proof of possession of the DEVICE key, so moving a
  // device between anchors (recovery, linking) is something only the device itself can do
  const { signAsDevice } = await import("@/lib/identity/deviceKeys");
  const regBody = JSON.stringify({ delegation, anchorPubKey: deviceAuthPublicKey() });
  const reg = await vfetch("/device/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-layers-device-proof": signAsDevice("layers/device-proof/v1|" + createHash("sha256").update(regBody).digest("hex")) },
    body: regBody,
  });
  if (!anchor || !reg) {
    // LOUD: a signed-write deployment that cannot bootstrap must not
    // quietly fall back to unsigned writes the validator will refuse
    // one by one. Fail here, once, with the real reason.
    throw new Error(
      "persist: signed-envelope bootstrap failed (anchor or delegation registration was refused/unreachable)"
    );
  }
}

async function envelopeHeaders(ns: string, bodyForHash: string): Promise<Record<string, string>> {
  await ensureBootstrapped();
  const { deviceIdentity, signEnvelope } = await import("@/lib/identity/deviceKeys");
  const device = deviceIdentity();
  const bodyHash = createHash("sha256").update(bodyForHash).digest("hex");
  const counter = nextCounter(ns);
  return {
    "x-layers-device": device.deviceId,
    "x-layers-counter": String(counter),
    "x-layers-sig": signEnvelope(device, ns, bodyHash, counter),
  };
}

/**
 * ZK PASS 1: the device-signed envelope for a READ the validator gates
 * when armed (the eligibility store — attack-1 finding 5). Same chain as
 * a write, over the empty body. Empty when the deployment is not armed.
 */
export async function signedReadHeaders(ns: string): Promise<Record<string, string>> {
  if (!REQUIRE_SIG()) return {};
  return envelopeHeaders(ns, "");
}

/** Raw namespace documents loaded at hydration, consumed by store.ts. */
/**
 * BROWSER KEYSTORE PASS Gate 1 stage 2: register this device under the anchor a CANDIDATE seed derives, so the
 * signed reads that follow resolve to that seed's tenant. Recovery calls it with the phrase's seed before reading
 * the roster; the validator stores the anchor on the device row, so every later envelope resolves there too.
 */
export async function enrollWithSeed(seedHex: string, opts: { createAnchor?: boolean } = {}): Promise<string> {
  // PUBLIC GO-LIVE (final verify): in the registration lane, so a bootstrap still in flight under the identity this
  // enrollment replaces can never land after it (see ensureBootstrapped)
  return inRegistrationLane(() => enrollWithSeedNow(seedHex, opts));
}
async function enrollWithSeedNow(seedHex: string, opts: { createAnchor?: boolean }): Promise<string> {
  const { deviceAuthPublicKeyFromSeed, signAsDeviceAuthWithSeed } = await import("@/lib/identity/keystore");
  const { deviceIdentity, delegationCanonical, signAsDevice } = await import("@/lib/identity/deviceKeys");
  const anchorPubKey = deviceAuthPublicKeyFromSeed(seedHex);
  const device = deviceIdentity();
  // a recovery PROBES (a wrong phrase leaves nothing behind); an explicit 24-word import CREATES the anchor if the
  // validator lost it, so the words remain the escape hatch with nothing else (attack-custody-2 #20)
  const anchor = await vfetch("/device/auth-anchor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: anchorPubKey, existingOnly: !opts.createAnchor }),
  });
  const base = {
    v: 1 as const,
    deviceId: device.deviceId,
    devicePubKey: device.pubHex,
    scopes: ["state-write"],
    issuedAt: Date.now(),
    expiresAt: null,
  };
  const delegation = { ...base, signature: signAsDeviceAuthWithSeed(seedHex, delegationCanonical(base)) };
  const regBody = JSON.stringify({ delegation, anchorPubKey });
  const reg = await vfetch("/device/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-layers-device-proof": signAsDevice("layers/device-proof/v1|" + createHash("sha256").update(regBody).digest("hex")) },
    body: regBody,
  });
  if (!anchor || !reg) throw new Error("enrollWithSeed: the validator refused this seed's anchor or delegation");
  const st = g.__layersEnvelope!;
  st.bootstrapped = true;
  return anchorPubKey;
}

export type LoadedState = Record<string, Record<string, unknown>>;

/**
 * PERSONA LAUNCH P4 (rings) — THE HYDRATE'S COPY of the namespaces a module reads WITHOUT a request. The whole-state read
 * below already carries every namespace of this anchor; lib/rings/model.ts needs its document on the composer path
 * (the ring note is made at compose time, where a signed read of /state/rings would be the beacon the prefetch schedule
 * exists to avoid). Recorded ONLY from a read that succeeded (a failed loadAll answers {} and must never read as "this
 * namespace is empty"); forgotten by the reset contract with the module's own cache. undefined = no successful
 * whole-state read since the last reset; null = the read succeeded and the namespace was absent.
 */
const HYDRATE_COPY_NAMESPACES = ["rings"] as const;
type HydrateCopyNamespace = (typeof HYDRATE_COPY_NAMESPACES)[number];
const hydrateCopy = (): Partial<Record<HydrateCopyNamespace, Record<string, unknown> | null>> =>
  ((globalThis as unknown as { __layersHydratedNs?: Partial<Record<HydrateCopyNamespace, Record<string, unknown> | null>> }).__layersHydratedNs ??= {});
/** PERSONA LAUNCH P4 (LP-2): WHEN the copy was read — a copy is only as fresh as its read, and the composer refuses a
 *  ring note from a document older than a few ticks (lib/rings/model.ts noteKeyForPost) */
const hydrateCopyAt = (): Partial<Record<HydrateCopyNamespace, number>> =>
  ((globalThis as unknown as { __layersHydratedNsAt?: Partial<Record<HydrateCopyNamespace, number>> }).__layersHydratedNsAt ??= {});
function recordHydrateCopy(state: LoadedState): void {
  const c = hydrateCopy();
  const at = hydrateCopyAt();
  const now = Date.now();
  for (const ns of HYDRATE_COPY_NAMESPACES) {
    c[ns] = state[ns] && typeof state[ns] === "object" ? state[ns] : null;
    at[ns] = now;
  }
}
export function hydratedNamespace(ns: HydrateCopyNamespace): Record<string, unknown> | null | undefined {
  return hydrateCopy()[ns];
}
/** when the hydrate's copy of `ns` was read (epoch ms), or undefined when there is none */
export function hydratedNamespaceAt(ns: HydrateCopyNamespace): number | undefined {
  return hydrateCopy()[ns] === undefined ? undefined : hydrateCopyAt()[ns];
}
export function forgetHydratedNamespace(ns: HydrateCopyNamespace): void {
  delete hydrateCopy()[ns];
  delete hydrateCopyAt()[ns];
}

export async function loadAll(): Promise<LoadedState> {
  const r = await vfetch("/state", { headers: await signedReadHeaders("*") });
  if (r && typeof r === "object" && r.state && typeof r.state === "object") recordHydrateCopy(r.state as LoadedState);
  return (r?.state as LoadedState) ?? {};
}

/**
 * LAYERS_WORLD=empty: the same read, FAIL CLOSED. loadAll() answers an unreachable or refusing validator with an
 * empty state, and every namespace write REPLACES the stored namespace — so a store hydrated from that empty answer
 * would, on its first write, delete whatever it could not read (the owner's real records and the hidden demo rows
 * alike). Under the flag an unread state is an error and the hydrate is retried on the next call, never run on {}.
 * The OWNER SERVICE reads this way whatever LAYERS_WORLD says (review WE-6; lib/world-flag.ts strictStateRead): rolling
 * the flag back must not reopen the fail-open read on a database that holds the owner's real data.
 */
export async function loadAllStrict(): Promise<LoadedState> {
  // review WE-6: a transient failure (a validator restart, a dropped connection) is retried here, bounded, before
  // it becomes the refusal — hydrate() forgets a failed attempt so the NEXT call retries too, but the first request
  // of a boot should not have to fail for a blip that clears in a second. A 429 is already waited out by
  // validatorFetch; everything else gets three tries, 300/600/900 ms apart.
  let last: string = "no answer";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await vfetch("/state", { headers: await signedReadHeaders("*") });
    if (r && typeof r === "object" && r.state && typeof r.state === "object") {
      recordHydrateCopy(r.state as LoadedState);
      return r.state as LoadedState;
    }
    last = r && typeof r === "object" ? "an answer without a state document" : "no answer (unreachable or refusing)";
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
  throw new Error(`hydrate: the validator did not answer the state read (${last}, 3 attempts) — refusing to run the store on an empty state (a write would replace what could not be read)`);
}

/** BROWSER KEYSTORE PASS Gate 1 stage 2: a namespace read the way the validator now wants it — signed, scoped to
 * this device's anchor. Response-shaped so the readers that called fetch() directly keep their control flow. */
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  const headers = await signedReadHeaders(ns);
  try {
    return await validatorFetch(BASE + `/state/${ns}`, { headers });
  } catch (e) {
    return { status: 0, ok: false, json: async () => ({ error: (e as Error).message }) };
  }
}

/** the device envelope for a write outside the state namespaces (rep events, root registration) */
export async function signedWriteHeaders(ns: string, bodyForHash: string): Promise<Record<string, string>> {
  if (!REQUIRE_SIG()) return {};
  return envelopeHeaders(ns, bodyForHash);
}

/**
 * PERSONA LAUNCH P4 (D8): the device envelope ALWAYS — for a route that refuses every unsigned write whatever the
 * deployment's LAYERS_REQUIRE_SIG says (the ring drop: a multi-writer surface on a public server, where an unsigned
 * write would let anyone fill it). Bootstraps the device's anchor and delegation on first use like any signed write.
 */
export async function deviceSignedWriteHeaders(ns: string, bodyForHash: string): Promise<Record<string, string>> {
  return envelopeHeaders(ns, bodyForHash);
}

/** Gate 5 (attack-custody-1 #14): the namespaces THIS device has written sealed. A plaintext shape for one of them
 *  on a later read is a hostile or corrupt validator, and hydrate refuses it. Kept beside the keystore, so it
 *  persists exactly when the identity does. */
const SEALED_FILE = () => keystoreDirForCounters() + "/sealed-namespaces.json";
function keystoreDirForCounters(): string {
  return process.env.KEYSTORE_DIR || require("node:path").join(process.cwd(), ".keystore");
}
let sealedCache: Set<string> | null = null;
export function sealedNamespaces(): Set<string> {
  if (sealedCache) return sealedCache;
  try {
    sealedCache = new Set(JSON.parse(storage.readText(SEALED_FILE())) as string[]);
  } catch {
    sealedCache = new Set();
  }
  return sealedCache;
}
/** PERSONA LAUNCH P2 (BYX G2): a chunked document's piece is this device's sealed write too — its reader refuses a
 *  plaintext shape for it exactly as hydrate does for a namespace (lib/vault/chunkedDoc.ts) */
export function markSealedName(ns: string): void {
  markSealed(ns);
}
function markSealed(ns: string): void {
  const s = sealedNamespaces();
  if (s.has(ns)) return;
  s.add(ns);
  try {
    storage.writeText(SEALED_FILE(), JSON.stringify([...s]));
  } catch {
    /* an unwritable keystore dir: the in-memory set still guards this process */
  }
}

export function flush(ns: Namespace | ExtraNamespace, entries: Record<string, unknown>): Promise<void> {
  // PERSONA LAUNCH P2 (review W1-R4): the namespace's slot is taken HERE, before the first await, so two flushes of
  // one namespace land in the order they were called
  return inNamespaceOrder(ns, async () => {
    // BROWSER KEYSTORE PASS Gate 1 stage 2: nothing reaches the validator in plaintext any more — the whole map is one
    // opaque sealed record (lib/vault/vault.ts sealWhole); entries a caller sealed itself pass through
    const { sealWhole } = await import("@/lib/vault/vault");
    const sealed = sealWhole(ns, entries);
    markSealed(ns);
    // PERSONA LAUNCH P2 (BYX G1): LOUD. This went through vfetch, which turns every failure into null, so a save over
    // the validator's body limit (or a validator restart mid-write) vanished without a word while memory said "saved".
    // It throws now (PersistError); store.ts persistNs marks a namespace flushed only after this returns.
    await putState(ns, sealed);
  });
}

/**
 * LOUD flush for vault namespaces. The default flush() swallows every
 * error (fail-open) — tolerable for demo likes, NOT for encrypted
 * private posts / grants / event log, where a silently-dropped write is
 * data loss the user cannot see (the "never fail open" rule, at the
 * persistence layer). Throws on any transport or server failure so the
 * caller surfaces it instead of diverging in-memory from disk.
 */
export function flushVault(
  ns: Namespace | ExtraNamespace | ChunkNamespace,
  entries: Record<string, unknown>
): Promise<void> {
  // PERSONA LAUNCH P2 (BYX G1): the same loud write path as flush() — the size checked before sending, a network
  // error or a 5xx retried (re-signed) then thrown, any other refusal thrown at once. The message keeps its old
  // prefix ("vault flush of") so every caller that matches on it keeps matching; the class is PersistError.
  // Review W1-R4: in the namespace's order, the slot taken at the call.
  return inNamespaceOrder(ns, () => putVault(ns, entries));
}

async function putVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  try {
    await putState(ns, entries);
  } catch (e) {
    if (e instanceof PersistError) {
      const why = e.status === 0 ? "failed to reach the validator" : e.status === 413 ? "is over the body limit" : `was refused by the validator: HTTP ${e.status}`;
      throw new PersistError(ns, e.status, e.bytes, `vault flush of "${ns}" ${why} (${e.message})`);
    }
    throw e;
  }
}

export async function wipeAll(): Promise<void> {
  let headers: Record<string, string> = {};
  if (REQUIRE_SIG()) {
    headers = await envelopeHeaders("*", "");
  }
  await vfetch("/state", { method: "DELETE", headers });
}
