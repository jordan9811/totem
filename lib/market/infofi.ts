import "server-only";
// THE INFOFI EXTENSIONS — four features, one discipline: every unit of mock
// money moves through the escrow ledger, every timer runs on the controllable
// clock, and every payout lands in the settle adapter so the earnings view
// stays the single money surface.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, personaById, SEED_PERSONAS, SEED_POSTS } from "@/lib/adapters/mock/store";
import { marketClock } from "@/lib/adapters/mock/clock";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { followingFor } from "@/lib/eventlog/log";
import { hold, resolve, resolvePot, getEscrow, isExpired } from "./escrow";

// ------------------------------------------------------------ classification

export type EntityClass = "mutuals" | "extended" | "randoms" | "businesses";

/** Seeded businesses: the accounts that ran ad campaigns in the market seed. */
const BUSINESS_HANDLES = new Set(["crustcritic", "aperture_annie"]);

/**
 * Coarse by design (judgment call, logged): the full graph exists only for
 * the seed viewer, so classes reduce to — business (ran ads), mutual (the
 * target follows them), extended (same cluster as someone the target
 * follows), randoms (everyone else).
 */
export function classify(requesterPersonaId: string, targetPersonaId: string): EntityClass {
  const requester = personaById.get(requesterPersonaId);
  if (requester && BUSINESS_HANDLES.has(requester.handle)) return "businesses";
  const following = followingFor(targetPersonaId);
  if (following.has(requesterPersonaId)) return "mutuals";
  if (requester?.cluster) {
    for (const f of following) {
      if (personaById.get(f)?.cluster === requester.cluster) return "extended";
    }
  }
  return "randoms";
}

// -------------------------------------------------------- request-priced reads

export const READ_WINDOW_MS = 60 * 60 * 1000; // 1h on the controllable clock
export const READ_DWELL_MS = 8000;

export interface ReadRequest {
  id: string;
  escrowId: string;
  fromPersona: string;
  toPersona: string;
  castHash: string;
  price: number;
  entityClass: EntityClass;
  createdAt: number;
  status: "pending" | "read" | "expired";
}

export const DEFAULT_READ_PRICES = { mutuals: 0, extended: 2, randoms: 5, businesses: 25 };

export function readPricesFor(personaId: string) {
  return state().readPrices.get(personaId) ?? { ...DEFAULT_READ_PRICES };
}

export async function setReadPrices(
  personaId: string,
  prices: { mutuals: number; extended: number; randoms: number; businesses: number }
) {
  state().readPrices.set(personaId, prices);
  await persistNs("readPrices");
}

function mintId(prefix: string, seed: string): string {
  return prefix + "_" + createHash("sha256").update(seed + ":" + state().seq++).digest("hex").slice(0, 12);
}

/** Requester pays; the post lands in the target's read inbox. */
export async function requestRead(input: {
  fromPersona: string;
  toPersona: string;
  castHash: string;
}): Promise<ReadRequest> {
  const cls = classify(input.fromPersona, input.toPersona);
  const price = readPricesFor(input.toPersona)[cls];
  if (price <= 0) throw new Error(`${cls} read is free for this account — no request needed`);
  const escrow = await hold({
    kind: "paid_read",
    fromPersona: input.fromPersona,
    amount: price,
    windowMs: READ_WINDOW_MS,
  });
  const req: ReadRequest = {
    id: mintId("read", input.castHash),
    escrowId: escrow.id,
    fromPersona: input.fromPersona,
    toPersona: input.toPersona,
    castHash: input.castHash,
    price,
    entityClass: cls,
    createdAt: marketClock.now(),
    status: "pending",
  };
  state().readRequests.set(req.id, req);
  await persistNs("readRequests");
  return req;
}

/** Lazy expiry sweep — any inbox fetch settles the clock's verdicts first. */
export async function sweepReadRequests(): Promise<void> {
  const s = state();
  for (const req of s.readRequests.values()) {
    if (req.status !== "pending") continue;
    const escrow = getEscrow(req.escrowId);
    if (escrow && escrow.status === "held" && isExpired(escrow)) {
      req.status = "expired";
      await resolve(req.escrowId, "refunded");
    }
  }
  await persistNs("readRequests");
}

export async function inboxFor(personaId: string): Promise<ReadRequest[]> {
  await sweepReadRequests();
  return [...state().readRequests.values()]
    .filter((r) => r.toPersona === personaId && r.status === "pending")
    .sort((a, b) => b.price - a.price);
}

/** Dwell past the threshold marks it read and settles to the target.
 * Reads are honored on rep, not proven — the requester's view says so. */
async function putReadRecord(req: ReadRequest): Promise<void> {
  // put-by-id: the record id derives from escrow + terminal, so any retry
  // — including a client retry AFTER a persistent failure — converges to
  // exactly one earnings record
  await retryAdapter(() =>
    adapters.settle.record({
      recordId: "rec_" + req.escrowId + ":settled",
      kind: "paid_read",
      personaId: req.toPersona,
      amount: req.price,
      category: "reads",
      note: `paid read from ${personaById.get(req.fromPersona)?.handle ?? req.fromPersona} (honored on rep, not proven)`,
    })
  );
}

export async function recordDwell(requestId: string, dwellMs: number): Promise<ReadRequest> {
  const s = state();
  const req = s.readRequests.get(requestId);
  if (!req) throw new Error("unknown read request");
  if (req.status === "read") {
    // idempotent under client retry — and the retry RE-PUTS the record, so
    // a record lost to a persistent failure lands now (put-by-id dedupes)
    await putReadRecord(req);
    return req;
  }
  if (req.status !== "pending") throw new Error(`request already ${req.status}`);
  if (dwellMs < READ_DWELL_MS) return req; // not yet — no state change
  req.status = "read";
  await resolve(req.escrowId, "settled", req.toPersona);
  await putReadRecord(req);
  await persistNs("readRequests");
  return req;
}

// ------------------------------------------------------------- pay-to-DM

export const DM_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_DM_PRICE = 3;

export interface DmRequest {
  id: string;
  escrowId: string | null; // null = mutual bypass, no money involved
  fromPersona: string;
  toPersona: string;
  text: string;
  createdAt: number;
  status: "pending" | "replied" | "slashed";
}

export function dmPriceFor(personaId: string): number {
  return state().dmPrices.get(personaId) ?? DEFAULT_DM_PRICE;
}

export async function setDmPrice(personaId: string, price: number) {
  state().dmPrices.set(personaId, price);
  await persistNs("dmPrices");
}

export async function sendDm(input: {
  fromPersona: string;
  toPersona: string;
  text: string;
}): Promise<DmRequest> {
  const mutual = followingFor(input.toPersona).has(input.fromPersona);
  let escrowId: string | null = null;
  if (!mutual) {
    const escrow = await hold({
      kind: "dm",
      fromPersona: input.fromPersona,
      amount: dmPriceFor(input.toPersona),
      windowMs: DM_WINDOW_MS,
    });
    escrowId = escrow.id;
  }
  const dm: DmRequest = {
    id: mintId("dm", input.fromPersona + input.toPersona),
    escrowId,
    fromPersona: input.fromPersona,
    toPersona: input.toPersona,
    text: input.text,
    createdAt: marketClock.now(),
    status: "pending",
  };
  state().dmRequests.set(dm.id, dm);
  await persistNs("dmRequests");
  return dm;
}

/** Read-and-reply refunds the sender. */
export async function replyDm(dmId: string): Promise<DmRequest> {
  const dm = state().dmRequests.get(dmId);
  if (!dm) throw new Error("unknown dm");
  if (dm.status === "replied") return dm; // idempotent under client retry
  if (dm.status !== "pending") throw new Error(`dm already ${dm.status}`);
  dm.status = "replied";
  if (dm.escrowId) await resolve(dm.escrowId, "refunded");
  await persistNs("dmRequests");
  return dm;
}

/** The spam slash: ignored past the window keeps the fee. Lazy, clock-driven. */
async function putSlashRecord(dm: DmRequest, amount: number): Promise<void> {
  await retryAdapter(() =>
    adapters.settle.record({
      recordId: "rec_" + dm.escrowId + ":settled",
      kind: "dm_slash",
      personaId: dm.toPersona,
      amount,
      category: "dm",
      note: `ignored DM fee kept (spam slash) from ${personaById.get(dm.fromPersona)?.handle ?? dm.fromPersona}`,
    })
  );
}

export async function sweepDms(): Promise<number> {
  const s = state();
  let slashed = 0;
  for (const dm of s.dmRequests.values()) {
    if (!dm.escrowId) continue;
    const escrow = getEscrow(dm.escrowId);
    if (!escrow) continue;
    if (dm.status === "slashed") {
      // converge: a slash whose record write failed persistently gets its
      // record on the next sweep — put-by-id makes this exactly-once
      await putSlashRecord(dm, escrow.amount);
      continue;
    }
    if (dm.status !== "pending") continue;
    if (escrow.status === "held" && isExpired(escrow)) {
      dm.status = "slashed";
      await resolve(dm.escrowId, "settled", dm.toPersona);
      await putSlashRecord(dm, escrow.amount);
      slashed++;
    }
  }
  await persistNs("dmRequests");
  return slashed;
}

// ------------------------------------------------------ pledge-to-action

export const PLEDGE_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface Pledge {
  id: string;
  escrowId: string;
  castHash: string;
  fromPersona: string;
  amount: number;
  createdAt: number;
  status: "open" | "awarded" | "lottery";
  winner?: string;
}

export async function createPledge(input: {
  fromPersona: string;
  castHash: string;
  amount: number;
}): Promise<Pledge> {
  const escrow = await hold({
    kind: "pledge",
    fromPersona: input.fromPersona,
    amount: input.amount,
    windowMs: PLEDGE_WINDOW_MS,
  });
  const pledge: Pledge = {
    id: mintId("pledge", input.castHash),
    escrowId: escrow.id,
    castHash: input.castHash,
    fromPersona: input.fromPersona,
    amount: input.amount,
    createdAt: marketClock.now(),
    status: "open",
  };
  state().pledges.set(pledge.id, pledge);
  await persistNs("pledges");
  return pledge;
}

/** The author awards a reply within the window. */
export async function awardPledge(pledgeId: string, winnerPersonaId: string): Promise<Pledge> {
  const pledge = state().pledges.get(pledgeId);
  if (!pledge) throw new Error("unknown pledge");
  if (pledge.status === "awarded" && pledge.winner === winnerPersonaId) return pledge; // idempotent
  if (pledge.status !== "open") throw new Error(`pledge already ${pledge.status}`);
  const escrow = getEscrow(pledge.escrowId);
  if (escrow && isExpired(escrow)) throw new Error("award window closed — the lottery decides now");
  pledge.status = "awarded";
  pledge.winner = winnerPersonaId;
  await resolve(pledge.escrowId, "settled", winnerPersonaId);
  await retryAdapter(() =>
    adapters.settle.record({
      recordId: "rec_" + pledge.escrowId + ":settled",
      kind: "pledge_award",
      personaId: winnerPersonaId,
      amount: pledge.amount,
      category: "pledges",
      note: `pledge on ${pledge.castHash} awarded`,
    })
  );
  await persistNs("pledges");
  return pledge;
}

/** Qualifying repliers: everyone who actually replied to the pledged cast —
 * seeded replies AND local casts made through the composer. Sorted, so the
 * deterministic draw indexes a stable pool. */
export async function qualifyingRepliers(castHash: string): Promise<string[]> {
  const seeded = SEED_POSTS.filter((p) => p.replyToHash === castHash).map((p) => p.authorPersonaId);
  // dynamic import: data.ts is a render-layer module and importing it
  // statically from here closes an import cycle through the store
  const { localRepliersTo } = await import("@/lib/data");
  return [...new Set([...seeded, ...localRepliersTo(castHash)])].sort();
}

/**
 * Window passed with no award → DETERMINISTIC lottery. The draw seeds from
 * the pledge id (fixed at creation), so re-running the sweep, restarting the
 * server, or replaying the test draws the SAME winner. No Math.random.
 */
export async function sweepPledges(): Promise<number> {
  const s = state();
  let drawn = 0;
  for (const pledge of s.pledges.values()) {
    if (pledge.status !== "open") continue;
    const escrow = getEscrow(pledge.escrowId);
    if (!escrow || escrow.status !== "held" || !isExpired(escrow)) continue;
    const pool = await qualifyingRepliers(pledge.castHash);
    if (pool.length === 0) {
      pledge.status = "lottery";
      pledge.winner = undefined;
      await resolve(pledge.escrowId, "refunded"); // nobody qualified: money home
    } else {
      const digest = createHash("sha256").update("lottery:" + pledge.id).digest();
      const winner = pool[digest.readUInt32BE(0) % pool.length];
      pledge.status = "lottery";
      pledge.winner = winner;
      await resolve(pledge.escrowId, "lottery", winner);
      await retryAdapter(() =>
        adapters.settle.record({
          recordId: "rec_" + pledge.escrowId + ":lottery",
          kind: "pledge_lottery",
          personaId: winner,
          amount: pledge.amount,
          category: "pledges",
          note: `pledge on ${pledge.castHash} went to lottery`,
        })
      );
    }
    drawn++;
  }
  await persistNs("pledges");
  return drawn;
}

// ------------------------------------------------------ tip-gated channels

export const TIP_EPOCH_MS = 24 * 60 * 60 * 1000;
export const CHANNEL_TIP_AMOUNT = 2;

export interface TipEpoch {
  channelId: string;
  epochStart: number;
  pot: number;
  escrowIds: string[];
  entries: { castHash: string; authorPersonaId: string }[];
  closed: boolean;
}

/** The seeded tip-gated channel. */
export const TIP_GATED_CHANNEL = "chan_openfloor";

export function epochFor(channelId: string): TipEpoch {
  const s = state();
  let epoch = s.tipEpochs.get(channelId);
  if (!epoch || epoch.closed) {
    epoch = {
      channelId,
      epochStart: marketClock.now(),
      pot: 0,
      escrowIds: [],
      entries: [],
      closed: false,
    };
    s.tipEpochs.set(channelId, epoch);
  }
  return epoch;
}

/**
 * Likes are read from the store AT EPOCH CLOSE, not at tip time — the split
 * rewards how the post actually performed, and nothing about the payout is
 * caller-supplied. Seeded posts carry counts; the viewer's own like adds one.
 */
function likesAtClose(castHash: string): number {
  const seeded = SEED_POSTS.find((p) => p.hash === castHash);
  const base = seeded?.likes ?? 0;
  return base + (state().likes.has(castHash) ? 1 : 0);
}

/** Tip to cast: the channel rule. The tip escrows into the epoch pot. */
export async function tipToCast(input: {
  channelId: string;
  authorPersonaId: string;
  castHash: string;
}): Promise<TipEpoch> {
  if (input.channelId !== TIP_GATED_CHANNEL)
    throw new Error("channel is not tip-gated");
  const escrow = await hold({
    kind: "channel_tip",
    fromPersona: input.authorPersonaId,
    amount: CHANNEL_TIP_AMOUNT,
    windowMs: TIP_EPOCH_MS,
  });
  const epoch = epochFor(input.channelId);
  epoch.pot += CHANNEL_TIP_AMOUNT;
  epoch.escrowIds.push(escrow.id);
  epoch.entries.push({ castHash: input.castHash, authorPersonaId: input.authorPersonaId });
  await persistNs("tipEpochs");
  return epoch;
}

/**
 * Epoch close: the pot distributes by QUADRATIC weighting on likes —
 * weight_i = sqrt(likes_i), share_i = pot * weight_i / Σweights. Shares are
 * rounded to 2dp; the rounding remainder goes to the highest-weighted entry
 * so the pot always sums exactly (conservation is not optional).
 */
export async function closeEpoch(channelId: string): Promise<{
  distributions: { personaId: string; amount: number }[];
}> {
  const s = state();
  const epoch = s.tipEpochs.get(channelId);
  if (!epoch || epoch.closed) throw new Error("no open epoch");
  if (marketClock.now() < epoch.epochStart + TIP_EPOCH_MS)
    throw new Error("epoch window still open");

  const likes = epoch.entries.map((e) => likesAtClose(e.castHash));
  const weights = likes.map((n) => Math.sqrt(n));
  const totalW = weights.reduce((a, b) => a + b, 0);

  const byPersona = new Map<string, number>();
  if (totalW > 0) {
    let allocated = 0;
    let maxIdx = 0;
    epoch.entries.forEach((e, i) => {
      if (weights[i] > weights[maxIdx]) maxIdx = i;
    });
    epoch.entries.forEach((e, i) => {
      const raw = (epoch.pot * weights[i]) / totalW;
      const share = Math.floor(raw * 100) / 100;
      allocated += share;
      byPersona.set(e.authorPersonaId, (byPersona.get(e.authorPersonaId) ?? 0) + share);
    });
    const remainder = Math.round((epoch.pot - allocated) * 100) / 100;
    if (remainder > 0) {
      const top = epoch.entries[maxIdx].authorPersonaId;
      byPersona.set(top, Math.round(((byPersona.get(top) ?? 0) + remainder) * 100) / 100);
    }
  }

  const distributions = [...byPersona.entries()].map(([personaId, amount]) => ({ personaId, amount }));
  if (distributions.length) {
    // the pot resolves as ONE conservation-checked split: recipients get
    // their exact quadratic shares, every escrow reaches its terminal state,
    // and if the shares failed to sum to the pot the resolution would throw
    // with nothing moved
    await resolvePot(
      epoch.escrowIds,
      distributions.map((d) => ({ to: d.personaId, amount: d.amount })),
      `pot:${channelId}`
    );
  } else {
    for (const escrowId of epoch.escrowIds) await resolve(escrowId, "refunded");
  }
  for (const d of distributions) {
    await retryAdapter(() =>
      adapters.settle.record({
        recordId: `rec_pot:${channelId}:${epoch.epochStart}:${d.personaId}`,
        kind: "tip_epoch",
        personaId: d.personaId,
        amount: d.amount,
        category: "channels",
        note: `quadratic share of ${channelId} epoch pot (${epoch.pot})`,
      })
    );
  }
  epoch.closed = true;
  await persistNs("tipEpochs");
  return { distributions };
}

// ---------------------------------------------------------------- seeding

/**
 * One read request mid-flight at boot: a business (crustcritic) has paid the
 * viewer's business rate to put a post in front of them. The reads inbox has
 * something real on first visit, and the request's window is live — settle
 * it or let it expire, both paths work from the UI.
 */
export async function seedInfoFi(): Promise<number> {
  const s = state();
  if (s.readRequests.size > 0) return 0;
  const byHandle = (h: string) => SEED_PERSONAS.find((p) => p.handle === h)?.id;
  const business = byHandle("crustcritic");
  const viewer = byHandle("yeak__");
  if (!business || !viewer) return 0;
  await requestRead({
    fromPersona: business,
    toPersona: viewer,
    castHash: "0xcr0011",
  });
  return 1;
}
