import "server-only";
// ZK PASS 2 Gate 0 — THE FIXED-SCHEDULE PREFETCH (retires A-PREPARE-BURST).
//
// Pass 1's preparation — epoch, leaves, signed history, the queued-item
// write — rode the identified channel at the moment of the motivating
// render: an "I am about to prove, at tier T" beacon the operator could
// correlate with the anonymous submission that followed. Now:
//
//   • a timer, cadence ZK_PREFETCH_MS (±25% CSPRNG jitter), fetches the
//     epoch, the gate tree's leaves, the signed history, the validator key
//     AND the anonymous second-viewpoint head, for every client, whether
//     or not it intends to prove — the fetch cadence carries no
//     information about proof activity;
//   • a render only marks a persona WANTED (no network); the next tick
//     proves wanted personas from ITS snapshot and enqueues them, so the
//     queued-item write also lands on the schedule;
//   • the label reads the same snapshot and never fetches at render time.
//   • PERSONA LAUNCH P4: every tick also runs the rings part (lib/rings/tick.ts) for every device — the ring drop and
//     the anon-cast list are read whether or not this device holds an address or a ring, the notes are trial-opened
//     into memory (no decrypt and no fetch at render), and a due publish goes out on the tick, never on a click.
//
// The snapshot is consistent (one tick, one epoch); a proof from it is
// refused by the usual gates if the epoch moved (grace bound). Ticks are
// recorded (time, mode, ok) for the cadence-independence assertion.
import { randomBytes } from "@/lib/platform/crypto";
import { ZK_PREFETCH_MS, zkMode, type ZkMode } from "./config";
import { anonymousHead, type AnonHead } from "./anon/relay";
import { fetchAnonPostConfig, fetchAttestBuckets, fetchEpoch, fetchHistory, fetchIssuers, fetchMembers, fetchValidatorKey, type AnonPostConfig, type XOutboxConfig, type XOutboxRow, type ZkBucketCensus, type ZkEpochInfo, type ZkHistoryEntry, type ZkIssuer, type ZkMembers } from "./validatorClient";
import { isHonoredIssuer } from "@/lib/attest/subscriber";
import { attestTreeName } from "@/lib/attest/ids";
import { announceZkTick } from "@/lib/device/bootState";

export interface PrefetchSnapshot {
  mode: ZkMode;
  tree: string;
  epoch: ZkEpochInfo;
  members: ZkMembers;
  history: { pubkey: string; entries: ZkHistoryEntry[] };
  validatorKey: string;
  /** the second viewpoint: the history head as served over the anonymous path (null = unavailable) */
  anonHead: AnonHead | null;
  anonHeadError: string | null;
  /** Attestation pass Gate 3: the per-bucket census, on the same tick — the
   * label's bucket-floor condition reads it, never fetching at render time */
  buckets: ZkBucketCensus[];
  bucketsError: string | null;
  /** Gate 4: the issuer registry as read on the same tick — honour is decided by KEY (attack-att-1 #3) */
  issuers: ZkIssuer[];
  /** ANON REVIEW (A2-6): the validator's anon relay config as read on the same tick, so the compose gate and the
   * proving tick judge condition 10 (the relay account is distinct from this app) WITHOUT a fetch at compose time
   * (a compose-time request would be the beacon the wanted set exists to avoid); null = unreadable this tick */
  anonConfig: AnonPostConfig | null;
  anonConfigError: string | null;
  fetchedAt: number;
  ms: number;
  /** PERSONA LAUNCH wave 3 (L3): the plain anon tree's size on the same tick (stamped by runTick; undefined/null = not
   *  read — the reach offer then offers nothing) */
  plainSize?: PlainTreeSize | null;
}

export interface PrefetchTick {
  at: number;
  mode: ZkMode;
  ok: boolean;
  ms: number;
  error?: string;
  proofsRun: number;
  /** PERSONA LAUNCH P4: the rings part of this tick (lib/rings/tick.ts) — the drop read, the anon-list read, the publish */
  rings?: { drop: string; anonList: string; publish: string };
}

/** PERSONA LAUNCH P8: the @totem X outbox as read on a tick — its config and the WHOLE public list (never one id) */
export interface XOutboxSnapshot {
  mode: ZkMode;
  config: XOutboxConfig | null;
  list: XOutboxRow[] | null;
  error: string | null;
  fetchedAt: number;
}

/** PERSONA LAUNCH wave 3 (L3): the PLAIN anon tree's size as read on a tick (its epoch, its member count) */
export interface PlainTreeSize {
  mode: ZkMode;
  tree: string;
  epoch: number;
  size: number;
}

interface PrefetchState {
  snapshots: Partial<Record<ZkMode, PrefetchSnapshot>>;
  /** PERSONA LAUNCH P8: the X outbox read of the last tick, per universe (fixture only this wave) */
  x?: Partial<Record<ZkMode, XOutboxSnapshot>>;
  ticks: PrefetchTick[];
  timer: NodeJS.Timeout | null;
  /** ticks are SERIALIZED: a scheduled tick and a forced one never run
   * concurrently, and neither is ever dropped — the later one queues */
  chain: Promise<unknown>;
}
const g = globalThis as unknown as { __layersZkPrefetch?: PrefetchState };
const st = (): PrefetchState => (g.__layersZkPrefetch ??= { snapshots: {}, ticks: [], timer: null, chain: Promise.resolve() });

function jittered(ms: number): number {
  const r = randomBytes(4).readUInt32BE(0) / 2 ** 32; // [0,1)
  return Math.round(ms * (0.75 + 0.5 * r));
}

/** ONE prefetch of everything a proof and the label need, for `mode`. PUBLIC GO-LIVE (final verify): `publish: false`
 *  returns the snapshot without making it cachedSnapshot()'s answer — runTick publishes its tick's snapshot ONCE, after
 *  stamping it (below), so no reader ever sees a half-built tick. */
export async function prefetchOnce(mode: ZkMode, tree: string, opts: { publish?: boolean } = {}): Promise<PrefetchSnapshot> {
  const t0 = performance.now();
  const [epoch, members, history, validatorKey] = await Promise.all([fetchEpoch(mode), fetchMembers(mode, tree), fetchHistory(mode, tree), fetchValidatorKey()]);
  let anonHead: AnonHead | null = null;
  let anonHeadError: string | null = null;
  try {
    anonHead = await anonymousHead(mode, tree);
  } catch (e) {
    anonHeadError = (e as Error).message;
  }
  let buckets: ZkBucketCensus[] = [];
  let bucketsError: string | null = null;
  let issuers: ZkIssuer[] = [];
  try {
    buckets = (await fetchAttestBuckets(mode)).buckets;
    issuers = (await fetchIssuers(mode)).issuers;
  } catch (e) {
    bucketsError = (e as Error).message;
  }
  // the anon relay config rides every tick, for every tree, whether or not anything wants it (uniform fetch pattern)
  let anonConfig: AnonPostConfig | null = null;
  let anonConfigError: string | null = null;
  try {
    anonConfig = await fetchAnonPostConfig(mode);
  } catch (e) {
    anonConfigError = (e as Error).message;
  }
  const snap: PrefetchSnapshot = { mode, tree, epoch, members, history, validatorKey, anonHead, anonHeadError, buckets, bucketsError, issuers, anonConfig, anonConfigError, fetchedAt: Date.now(), ms: performance.now() - t0 };
  if (opts.publish !== false) st().snapshots[mode] = snap;
  return snap;
}

export function cachedSnapshot(mode: ZkMode): PrefetchSnapshot | null {
  return st().snapshots[mode] ?? null;
}

/**
 * PERSONA LAUNCH P8 — THE X OUTBOX READ, on the fixed schedule. Every device that OFFERS the outbox (a server-side device
 * — the rig and the owner service — in the fixture universe) reads the outbox's config and its WHOLE public list on
 * every tick, whether or not it ever sent an X copy: the read pattern carries nothing about who sent one, and the status
 * line, the compose gate's cap and K_X checks judge from it without a fetch at compose or render time. Never a per-id
 * read. Not in the public browser device's tick this wave (D-X-PUBLIC-OFF: the outbox is not offered there). Never throws:
 * an unreadable outbox is recorded as such (the compose gate then refuses — fail closed).
 */
export async function xOutboxOnce(mode: ZkMode): Promise<XOutboxSnapshot | null> {
  if (typeof window !== "undefined" || mode !== "fixture") return null;
  const { fetchXOutboxConfig, fetchXOutboxList } = await import("./validatorClient");
  let snap: XOutboxSnapshot;
  try {
    const [config, list] = await Promise.all([fetchXOutboxConfig(mode), fetchXOutboxList(mode)]);
    snap = { mode, config, list, error: null, fetchedAt: Date.now() };
  } catch (e) {
    snap = { mode, config: null, list: null, error: (e as Error).message, fetchedAt: Date.now() };
  }
  const s = st();
  (s.x ??= {})[mode] = snap;
  return snap;
}
/** the X outbox as read on the last tick (null = not read yet, or not offered here) */
export function cachedXOutbox(mode: ZkMode): XOutboxSnapshot | null {
  return st().x?.[mode] ?? null;
}

/**
 * PUBLIC GO-LIVE (the relay track) — EVERY TAB REGISTERS ITS ROOT IN THE LIVE UNIVERSE, ONCE, when the app hands it the
 * live universe (lib/zk/anon/universe.ts: ZK_ANON_UNIVERSE=live, which also makes this tab's ZK_MODE live). Uniform: every
 * tab of the site does it at boot (lib/device/entry.ts calls this once the device is ready) and, as the fallback, on its
 * first tick — whether or not it will ever post, so a registration says nothing about who posts. What the validator learns is
 * what any registration tells it: this root holds this commitment, at hour grain (the ZK pass's root ↔ commitment residual).
 * The LIVE public anonymous tree itself is the fid gate's (one commitment per Farcaster account, joined with a verified
 * sign-in: lib/zk/anon/fcJoin.ts); this registration places the root in the live universe's other trees (the For You tiers).
 * Never throws; a refusal is kept for the debug reader (liveRegistrationStatus) and tried again at most twice, a minute apart.
 */
interface LiveRegState {
  started: boolean;
  outcome: { at: number; ok: boolean; status: number; error: string | null } | null;
}
const gl = globalThis as unknown as { __layersLiveReg?: LiveRegState };
export function liveRegistrationStatus(): LiveRegState["outcome"] {
  return gl.__layersLiveReg?.outcome ?? null;
}
export async function startLiveUniverseAtBoot(): Promise<void> {
  if (typeof window === "undefined") return;
  const r = (gl.__layersLiveReg ??= { started: false, outcome: null });
  if (r.started) return;
  try {
    const { liveUniverseHinted } = await import("./anon/universe");
    if (!liveUniverseHinted() || zkMode() !== "live") return;
  } catch {
    return;
  }
  r.started = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { registerCommitment } = await import("./registration");
      const res = await registerCommitment("live");
      r.outcome = { at: Date.now(), ok: res.ok === true, status: res.status, error: res.ok ? null : String(res.error ?? "refused").slice(0, 200) };
      // registered now, already registered, or a refusal that waiting will not change (a 4xx other than 429)
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return;
    } catch (e) {
      r.outcome = { at: Date.now(), ok: false, status: 0, error: String((e as Error)?.message ?? e).slice(0, 200) };
    }
    await new Promise((res) => setTimeout(res, 60_000));
  }
}

/** A tick: prefetch for the CURRENT universe, then prove whatever is
 * wanted from that snapshot (the gate module owns the wanted set). */
async function runTick(mode: ZkMode): Promise<PrefetchTick> {
  const s = st();
  const t0 = performance.now();
  let tick: PrefetchTick;
  // PUBLIC GO-LIVE: the live registration's fallback trigger (a no-op unless this tab was handed the live universe)
  void startLiveUniverseAtBoot().catch(() => undefined);
  // PUBLIC GO-LIVE (final verify): THE TICK PUBLISHES ONCE. Each tree's snapshot used to become cachedSnapshot()'s answer as
  // it was read, before the plain tree's size was stamped on it below, so a read landing mid-tick (the composer, GET
  // /api/reach, GET /api/anon) met a snapshot with no plain size and offered no reach tier at all ("checked at the next
  // sync") until the tick finished — after every epoch edge, for as long as the tick's reads took (accept-reach check 3
  // caught it under load). Now the tick's snapshots are read unpublished and the LAST one read (what the cache held at the
  // end of a tick before) is published once, stamped. A tick that throws on the way publishes what it has, as before.
  let unpublished: PrefetchSnapshot | null = null;
  try {
    const { gateTree, runWantedProofs, wantedTrees, anonPostTree } = await import("./gate");
    const snap = await prefetchOnce(mode, gateTree(), { publish: false });
    unpublished = snap;
    // Gate 4 (attack-z2-2 #4): a PENDING re-issued identity becomes the proving
    // identity on the tick that sees its activation epoch — never mid-epoch
    const { promotePendingIdentity } = await import("./identity");
    promotePendingIdentity(snap.epoch.epoch);
    // Gate 4 (attack-z2-3 #3): every tree a wanted claim names is snapshotted
    // on THIS tick too (attest trees included), so no claim ever fetches at
    // prove time — a claim whose tree has no snapshot is refused, not fetched.
    // Gate 4 (attack-att-1 #1): the tree fetch is IDENTIFIED. Fetching an attest tree only on the
    // tick a persona will prove into it was a beacon — "this device is about to prove into
    // attest:I/B" — that the anonymous proof then confirmed within the jitter window. So EVERY
    // honoured bucket tree is fetched on EVERY tick, whether or not anything wants it: the fetch
    // pattern carries no information about proof activity, exactly like the gate tree.
    const extra: Record<string, PrefetchSnapshot> = {};
    const keyOf = new Map(snap.issuers.map((i) => [i.id, i.pubkey]));
    // MULTI-FID Gate 5 (attack-fid-2 #14): the anon tree is in the uniform set too — fetched on every tick, wanted or not
    const uniform = [...snap.buckets.filter((b) => isHonoredIssuer(b.issuer, keyOf.get(b.issuer) ?? null)).map((b) => attestTreeName(b.issuer, b.bucket)), anonPostTree()];
    for (const tree of [...new Set([...uniform, ...wantedTrees()])]) {
      if (tree === snap.tree || extra[tree]) continue;
      try {
        extra[tree] = await prefetchOnce(mode, tree, { publish: false });
        unpublished = extra[tree];
      } catch {
        /* refused below, never fetched live */
      }
    }
    // PERSONA LAUNCH wave 3 (L3): the plain anon tree's size, from the snapshot this tick already holds (no extra read),
    // stamped on EVERY snapshot of this tick (cachedSnapshot answers whichever tree was read last) — the reach offer's
    // BAND rule reads it (lib/zk/gate.ts reachOfferInputFor → lib/reach/trees.ts). A tick that could not read it stamps
    // null: the band rule never judges from a stale size (nothing is offered until a tick reads it)
    {
      const plain = snap.tree === anonPostTree() ? snap : extra[anonPostTree()];
      const p: PlainTreeSize | null = plain ? { mode, tree: plain.tree, epoch: plain.epoch.epoch, size: plain.members.members.length } : null;
      for (const one of [snap, ...Object.values(extra)]) one.plainSize = p;
    }
    // PUBLIC GO-LIVE (final verify): published once, stamped (above)
    s.snapshots[mode] = unpublished;
    unpublished = null;
    // PERSONA LAUNCH P8: the X outbox read rides every tick before the proofs (the X copies' slot and cap checks read it)
    await xOutboxOnce(mode);
    const proofsRun = await runWantedProofs(snap, extra);
    // PERSONA LAUNCH P6 (the launch track's line): the uniform registrations read, every tick, every device
    try {
      await (await import("@/lib/launch/tick")).launchTick(mode);
    } catch {
      /* launchTick records its own errors */
    }
    tick = { at: Date.now(), mode, ok: true, ms: performance.now() - t0, proofsRun };
  } catch (e) {
    tick = { at: Date.now(), mode, ok: false, ms: performance.now() - t0, error: (e as Error).message, proofsRun: 0 };
    // PUBLIC GO-LIVE (final verify): a tick that threw before publishing leaves what it read as the answer, as before
    if (unpublished) s.snapshots[mode] = unpublished;
  }
  // PERSONA LAUNCH P4 — RINGS, for EVERY device on EVERY tick, rings or not, and whether or not the zk part above
  // succeeded: GET /rings/drop (plain, unsigned) and the public /zk/anon-casts list, every note trial-opened with the
  // keys this device received, and a publish when one is due. The read pattern is identical on a device with no ring,
  // no address and no persona, so the fetch cadence says nothing about who is in whose ring. Never throws into the tick.
  try {
    const r = await (await import("@/lib/rings/tick")).ringsTick(mode);
    tick.rings = { drop: r.drop, anonList: r.anonList, publish: r.publish };
  } catch (e) {
    tick.rings = { drop: "error: " + (e as Error).message, anonList: "not read", publish: "not run" };
  }
  s.ticks.push(tick);
  if (s.ticks.length > 50) s.ticks.shift();
  // PERSONA LAUNCH wave 3 (final verify): tell this document's surfaces that judge from the snapshot (the preview
  // banner's privacy label) that a tick landed — in a browser only, no value carried, nothing fetched
  announceZkTick();
  return tick;
}

export function prefetchTick(mode: ZkMode = zkMode()): Promise<PrefetchTick> {
  const s = st();
  const next = s.chain.then(() => runTick(mode));
  s.chain = next.catch(() => undefined);
  return next;
}

/** Start the loop once. Each tick re-arms itself with a fresh jittered
 * delay, so the cadence is a random variable around ZK_PREFETCH_MS with
 * no component that depends on renders, proofs or submissions. */
export function ensurePrefetchLoop(): void {
  const s = st();
  if (s.timer) return;
  const arm = () => {
    s.timer = setTimeout(() => {
      prefetchTick()
        .catch(() => {
          /* recorded in the tick log */
        })
        .finally(arm);
    }, jittered(ZK_PREFETCH_MS));
    s.timer.unref?.();
  };
  arm();
}

export interface PrefetchStatus {
  cadenceMs: number;
  loopRunning: boolean;
  ticks: PrefetchTick[];
  snapshot: { mode: ZkMode; tree: string; epoch: number; members: number; historyEntries: number; anonHead: AnonHead | null; anonHeadError: string | null; fetchedAt: number; ms: number } | null;
}

export function prefetchStatus(mode: ZkMode = zkMode()): PrefetchStatus {
  const s = st();
  const snap = s.snapshots[mode] ?? null;
  return {
    cadenceMs: ZK_PREFETCH_MS,
    loopRunning: s.timer !== null,
    ticks: [...s.ticks],
    snapshot: snap
      ? { mode: snap.mode, tree: snap.tree, epoch: snap.epoch.epoch, members: snap.members.members.length, historyEntries: snap.history.entries.length, anonHead: snap.anonHead, anonHeadError: snap.anonHeadError, fetchedAt: snap.fetchedAt, ms: snap.ms }
      : null,
  };
}

/** resetSeed / resetZk: forget snapshots (a new universe or a wiped one). */
export function resetPrefetch(): void {
  st().snapshots = {};
  st().x = {};
}
