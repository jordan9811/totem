import "server-only";
// FC-READ — WHICH TARGETS ARE THE FARCASTER NETWORK'S, not this device's.
//
// Public live reads bring real Farcaster casts into the browser device through the read relay. Those casts are
// READ-ONLY here: no write key ships to a public deployment (MUST_NOT_SHIP), so a like, recast, reply, quote,
// act-as, follow, folder add, stake or send aimed at one could only ever be recorded LOCALLY — the exact "success
// toast, nothing happened" failure lib/adapters/neynar/mode.ts's guard exists to forbid (setReaction records any
// hash, lib/data.ts; the folder view silently drops unknown hashes, lib/views/spaces.ts). The refusal is PER TARGET,
// never the global isLiveContent() switch: that switch would refuse the visitor's own local posts too, and turn the
// Following round-trip (smoke-deployed check 4) into a 503 (D-FCREAD-PER-TARGET-WRITE-REFUSAL).
//
// A network cast is a hash of the wire's shape (0x + 40 lowercase hex) that no LOCAL store holds. Every local hash
// family has a different shape by construction — seed "0xcr0001", fixture "0xa1b2c301", local "0xlocal…", private
// "0xpriv…", sim-network "0xfc…" (16 hex), fixture anon "0xanon…" (32 hex) — but the stores are CHECKED rather than
// the shapes trusted: a live-universe anon cast carries a real 40-hex network hash, and an anon author opening their
// own post must never be classified as a stranger's cast (the read path uses this same answer to decide what goes to
// the relay — a relay lookup of one's own anon post would join the author's IP to it).
//
// Imported by the write routes (answered in the browser device on a public deployment, by the server on the rig) and
// by the read path. The store modules load LAZILY, at call time: lib/data.ts may import this module, and a static
// import back would be a cycle. `server-only` because every store here is: a client component asks the cast object
// (`network` / `live`), never this.
import raw from "@/lib/fixtures/data.json";
import { relayReads } from "@/lib/adapters/neynar/mode";
import { isPublicLive } from "@/lib/platform/publicLive";

/** the wire's cast-hash shape: 0x + 40 lowercase hex (the recorded corpus in fixtures/neynar never deviates) */
export const NETWORK_HASH_RE = /^0x[0-9a-f]{40}$/;

export function isNetworkHashShape(hash: string): boolean {
  return typeof hash === "string" && NETWORK_HASH_RE.test(hash);
}

/** the refusal every write route answers for a network target — one sentence, one code, 403 (it is not "try later") */
export const NETWORK_READ_ONLY = {
  code: "NETWORK_READ_ONLY",
  error: "Posting to Farcaster isn't on this preview yet. Reading is live; your own posts, folders and private posts still work.",
} as const;
/** PUBLIC GO-LIVE (onboard F11): the same refusal on the LIVE site (PUBLIC_LIVE), which is no preview. Same code, same 403 */
export const NETWORK_READ_ONLY_LIVE = {
  code: "NETWORK_READ_ONLY",
  error: "Liking, replying to or recasting Farcaster posts from Totem isn't on this site yet. Reading is live; your own posts, folders and private posts still work.",
} as const;
export type NetworkReadOnlyAnswer = typeof NETWORK_READ_ONLY | typeof NETWORK_READ_ONLY_LIVE;
/** PUBLIC GO-LIVE (F11): the refusal HERE — the live words in live mode (in a tab, isPublicLive reads the device env's
 *  PUBLIC_LIVE=on), the preview's otherwise, byte for byte */
export function networkReadOnlyAnswer(): NetworkReadOnlyAnswer {
  return isPublicLive() ? NETWORK_READ_ONLY_LIVE : NETWORK_READ_ONLY;
}

// ---------------------------------------------------------------------------------------------------- local stores

/** the fixture corpus (lib/fixtures/data.json): casts, the self's casts, thread keys + their replies, quoted casts */
let fixtureHashes: Set<string> | null = null;
function fixtureCastHashes(): Set<string> {
  if (fixtureHashes) return fixtureHashes;
  type RawCast = { hash?: string; embeds?: { type?: string; quote?: RawCast }[] };
  const out = new Set<string>();
  const add = (c: RawCast | undefined) => {
    if (!c || typeof c.hash !== "string") return;
    out.add(c.hash);
    for (const e of c.embeds ?? []) if (e && e.type === "quote") add(e.quote);
  };
  const r = raw as unknown as { casts?: RawCast[]; selfCasts?: RawCast[]; threads?: Record<string, RawCast[]> };
  for (const c of r.casts ?? []) add(c);
  for (const c of r.selfCasts ?? []) add(c);
  for (const [k, list] of Object.entries(r.threads ?? {})) {
    out.add(k);
    for (const c of list ?? []) add(c);
  }
  fixtureHashes = out;
  return out;
}

// The anon list is the validator's PUBLIC relayed-anon-cast list (no viewer on the request — the same read the feed
// builder makes). Cached briefly per zk mode: a like on a network cast should not cost a validator round trip per
// click, and a cast relayed within the last few seconds is not yet on anyone's screen to act on.
const ANON_TTL_MS = 15_000;
let anonCache: { mode: string; at: number; hashes: Set<string> } | null = null;

async function anonCastHashes(): Promise<Set<string>> {
  const { zkMode } = await import("@/lib/zk/config");
  const mode = zkMode();
  if (anonCache && anonCache.mode === mode && Date.now() - anonCache.at < ANON_TTL_MS) return anonCache.hashes;
  const { fetchAnonCasts } = await import("@/lib/zk/validatorClient");
  // NEVER FAIL OPEN: retried, then THROWN — an unreadable list is not an empty one (the caller decides what an
  // unanswerable question means for it: the write guard refuses, the read path must not relay)
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const casts = await fetchAnonCasts(mode);
      const hashes = new Set<string>();
      for (const a of casts) {
        if (a && typeof a.hash === "string" && a.hash) hashes.add(a.hash);
        if (a && typeof a.castHash === "string" && a.castHash) hashes.add(a.castHash);
      }
      anonCache = { mode, at: Date.now(), hashes };
      return hashes;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("the anon cast list could not be read");
}

/**
 * True when `hash` is a Farcaster NETWORK cast: the wire's shape, and held by NO local store — the fixture corpus,
 * the seed, this device's local (0xlocal) casts, private posts, the fc sim network, and the anon list.
 *
 * THROWS when a store cannot be read (the anon list is a validator read; the private store needs hydration). It never
 * answers "network" or "local" on a guess — a write guard that guessed "local" would fake-succeed, and a read path
 * that guessed "network" would relay a hash the device holds.
 */
export async function isNetworkCastTarget(hash: string): Promise<boolean> {
  if (!isNetworkHashShape(hash)) return false;
  if (fixtureCastHashes().has(hash)) return false;
  const store = await import("@/lib/adapters/mock/store");
  if (store.postByHash.has(hash)) return false;
  const { findLocalCast } = await import("@/lib/data");
  if (findLocalCast(hash)) return false;
  await store.hydrate();
  if (store.state().privatePosts.has(hash)) return false;
  const { fcSimNetworkCasts } = await import("@/lib/fc/writes");
  if (fcSimNetworkCasts().some((c) => c.hash === hash)) return false;
  if ((await anonCastHashes()).has(hash)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------- the write guard

/**
 * The guard is ARMED only where network casts can be on screen at all: the browser device of a public deployment
 * reading through the relay (the device env's FC_READ_RELAY hint, set by the server only while the relay is armed).
 * The rig and the owner service never set it, so their write semantics — including real Farcaster writes behind
 * ENABLE_FC_WRITE on live content — are exactly what they were; a deployment with no read key never sets it either.
 * The hint is captured when the device bundle loads (lib/device/shims/process.ts), so a tab opened before a kill
 * switch keeps refusing writes on the cached network casts it still shows — the safe direction.
 *
 * FC-READ: the SAME predicate the device's read path uses (mode.ts relayReads()) — one switch, so the guard can never
 * be off while network casts are being read in, nor on where none can be.
 */
export function networkWritesRefused(): boolean {
  return relayReads();
}

/**
 * The per-target refusal for a write: NETWORK_READ_ONLY when the guard is armed and ANY named target is a network
 * cast; null otherwise (local and seed targets proceed exactly as before). Blank targets are skipped — the route's own
 * validation answers those. A target whose locality cannot be established (a store unreadable after retries) is
 * REFUSED: an unanswerable question must not become a local fake success on what may be a network cast.
 */
export async function networkWriteRefusal(
  ...targets: (string | null | undefined)[]
): Promise<NetworkReadOnlyAnswer | null> {
  if (!networkWritesRefused()) return null;
  for (const t of targets) {
    if (typeof t !== "string" || !t) continue;
    if (!isNetworkHashShape(t)) continue; // no I/O for the local hash families
    try {
      if (await isNetworkCastTarget(t)) return networkReadOnlyAnswer();
    } catch {
      return networkReadOnlyAnswer();
    }
  }
  return null;
}

/**
 * The follow door (/api/fc/write action "follow") names an fid, not a cast. Under the armed guard, an fid no local
 * record carries — the seed's roots, the fixture corpus's users, this device's own self — is a live Farcaster account,
 * and a "follow" of it could only be a local sim record presented as a Farcaster follow.
 */
export async function networkFollowRefusal(fid: number): Promise<NetworkReadOnlyAnswer | null> {
  if (!networkWritesRefused()) return null;
  if (!Number.isInteger(fid) || fid <= 0) return null; // the route's own validation answers malformed fids
  const r = raw as unknown as { users?: { fid?: number }[]; self?: { fid?: number } };
  if ((r.users ?? []).some((u) => u && u.fid === fid)) return null;
  if (r.self && r.self.fid === fid) return null; // the device's self (setSelfForDevice mutates this same record)
  const { rootByFid } = await import("@/lib/adapters/mock/store");
  if (rootByFid.has(fid)) return null;
  return networkReadOnlyAnswer();
}
