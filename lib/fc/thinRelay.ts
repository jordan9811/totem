import "server-only";
// PERSONA LAUNCH P6 — THE THIN RELAY (fixture seam; live REFUSES this wave).
//
// A launched persona's account is SELF-CUSTODY: its signer is the persona's own derived Ed25519 key, registered on the
// account by the Bundler call that created it (validator/simchain.js). Nobody holds a managed signer for it — not
// Neynar, not Totem. So its writes are messages the DEVICE signs and a thin relay merely forwards to the network: the
// relay can drop a message, never forge or alter one (the network checks every signature against the KeyRegistry).
//
// On the fixture this module IS the relay and the hub's checks together: a message is accepted only when
//   - its signer key is an ACTIVE key the (simulated) KeyRegistry lists for its fid (lib/fc/chain/*) — a wrong key, a
//     removed key or a key of another fid is REFUSED;
//   - its Ed25519 signature verifies over the message's canonical form (below);
//   - its timestamp is within 10 minutes of now — never backdated (D5: the launch history is posted at the current
//     time; backdating proves nothing and is pruned first) and never ahead (the hub's clock-skew rule);
//   - the fid is under its daily message limit (Farcaster's own: 200 messages per storage unit per day — the binding
//     limit for a self-custody account, which spends no managed-signer budget; lib/fc/writes.ts routes it here).
// Accepted CastAdds land in the fixture network sim (lib/fc/writes.ts), tagged with the fid, so every reader of that sim
// (the self-link guard's castAuthor included) sees them; UserDataAdds land in this module's profile table; a fname proof
// (EIP-712 by the CUSTODY key) is forwarded to the simulated fname server on the validator, which checks it again.
//
// The canonical forms are this build's simulation of Farcaster's signed message bodies (the real ones are protobuf
// hashed with BLAKE3); what matters on the sim is the same property: the key the chain lists signs exactly these bytes.
import { createHash } from "@/lib/platform/crypto";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import { validatorUrl } from "@/lib/ports";

const SKEW_MS = 10 * 60 * 1000;
const DAY = 86_400_000;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export type UserDataField = "display" | "pfp" | "bio";

export interface ThinCastAdd {
  type: "CastAdd";
  fid: number;
  signerPubKey: string;
  timestamp: number;
  text: string;
  parentHash?: string | null;
  quoteHash?: string | null;
  signature: string;
}
export interface ThinUserDataAdd {
  type: "UserDataAdd";
  fid: number;
  signerPubKey: string;
  timestamp: number;
  field: UserDataField;
  value: string;
  signature: string;
}
export interface ThinReactionAdd {
  type: "ReactionAdd";
  fid: number;
  signerPubKey: string;
  timestamp: number;
  reaction: "like" | "recast";
  targetHash: string;
  signature: string;
}
export interface ThinLinkAdd {
  type: "LinkAdd";
  fid: number;
  signerPubKey: string;
  timestamp: number;
  targetFid: number;
  signature: string;
}
/** a name proof signed by the account's CUSTODY key (EIP-712 UserNameProof) — forwarded to the fname server */
export interface ThinUsernameProof {
  type: "UsernameProof";
  fid: number;
  name: string;
  owner: string;
  /** unix SECONDS (the fname server's unit) */
  timestamp: number;
  signature: string;
}
export type ThinMessage = ThinCastAdd | ThinUserDataAdd | ThinReactionAdd | ThinLinkAdd;
/** a message before it is signed (each member of the union without its signature) */
export type UnsignedThinMessage = ThinMessage extends infer T ? (T extends ThinMessage ? Omit<T, "signature"> & { signature?: string } : never) : never;
export type ThinResult = { ok: true; hash: string; deduped?: boolean } | { ok: false; code: "live" | "malformed" | "stale" | "wrong-key" | "bad-signature" | "rate-limit" | "chain" | "refused"; reason: string };

const DOMAIN = "layers-thin-relay/1";

/** what the signer signs — the message minus its signature */
export function thinCanonical(mode: "fixture" | "live", m: UnsignedThinMessage): string {
  switch (m.type) {
    case "CastAdd":
      return [DOMAIN, "CastAdd", mode, String(m.fid), m.signerPubKey, String(m.timestamp), sha(m.text), m.parentHash ?? "", m.quoteHash ?? ""].join("|");
    case "UserDataAdd":
      return [DOMAIN, "UserDataAdd", mode, String(m.fid), m.signerPubKey, String(m.timestamp), m.field, sha(m.value)].join("|");
    case "ReactionAdd":
      return [DOMAIN, "ReactionAdd", mode, String(m.fid), m.signerPubKey, String(m.timestamp), m.reaction, m.targetHash].join("|");
    case "LinkAdd":
      return [DOMAIN, "LinkAdd", mode, String(m.fid), m.signerPubKey, String(m.timestamp), "follow", String(m.targetFid)].join("|");
  }
}

/** the network hash of an accepted CastAdd (deterministic: the same signed cast is the same cast) */
export function thinCastHash(m: Pick<ThinCastAdd, "fid" | "text" | "parentHash" | "quoteHash">): string {
  return "0xfc" + sha(["thin-cast", String(m.fid), m.text, m.parentHash ?? "", m.quoteHash ?? ""].join("|")).slice(0, 38);
}

interface RelayState {
  /** every accepted message, newest last (in-process: the fixture network forgets with the process, like the sim) */
  log: Array<{ at: number; fid: number; type: ThinMessage["type"] | "UsernameProof"; hash: string; quoteHash?: string | null }>;
  /** the profile the fid's UserDataAdds set */
  userData: Map<number, Partial<Record<UserDataField, string>>>;
}
/** the relay's state lives on a global: lib/fc/personaFid.ts reads `userData` from it directly (it must not import this
 *  module, which reaches the write door) — keep the name and the shape */
const g = globalThis as unknown as { __layersThinRelay?: RelayState };
const st = (): RelayState => (g.__layersThinRelay ??= { log: [], userData: new Map() });

/** resetSeed and reloadIdentity: the fixture network's relay forgets everything (the sim network resets beside it) */
export function resetThinRelay(): void {
  g.__layersThinRelay = { log: [], userData: new Map() };
}

export function userDataFor(fid: number): Partial<Record<UserDataField, string>> {
  return { ...(st().userData.get(fid) ?? {}) };
}

/** the relay's accepted-message log for one fid (the launch status and the suites read it; public facts only) */
export function thinRelayLog(fid?: number): RelayState["log"] {
  return st().log.filter((e) => fid === undefined || e.fid === fid).map((e) => ({ ...e }));
}

/** how many CastAdds quoting something this fid has made through the relay (the self-link guard's bound reads it) */
export function quoteCastCount(fid: number): number {
  return st().log.filter((e) => e.fid === fid && e.type === "CastAdd" && !!e.quoteHash).length;
}

function shapeProblem(m: ThinMessage): string | null {
  if (!Number.isInteger(m.fid) || m.fid <= 0) return "fid malformed";
  if (!/^[0-9a-f]{64}$/.test(m.signerPubKey)) return "signer key malformed";
  if (!/^[0-9a-f]{128}$/.test(m.signature)) return "signature malformed";
  if (!Number.isInteger(m.timestamp)) return "timestamp malformed";
  if (m.type === "CastAdd") {
    if (typeof m.text !== "string" || new TextEncoder().encode(m.text).length > 1024) return "cast text malformed";
    if (m.parentHash != null && (typeof m.parentHash !== "string" || !m.parentHash)) return "parent malformed";
    if (m.quoteHash != null && (typeof m.quoteHash !== "string" || !m.quoteHash)) return "quote target malformed";
  } else if (m.type === "UserDataAdd") {
    if (!["display", "pfp", "bio"].includes(m.field) || typeof m.value !== "string" || [...m.value].length > 256) return "profile field malformed";
  } else if (m.type === "ReactionAdd") {
    if ((m.reaction !== "like" && m.reaction !== "recast") || typeof m.targetHash !== "string" || !m.targetHash) return "reaction malformed";
  } else if (m.type === "LinkAdd") {
    if (!Number.isInteger(m.targetFid) || m.targetFid <= 0) return "follow target malformed";
  } else return "unknown message type";
  return null;
}

/**
 * Accept or refuse one signed message (see the header). A refusal changes nothing. On the fixture an accepted CastAdd
 * is recorded in the fixture network sim under its fid.
 */
export async function submitThinMessage(mode: "fixture" | "live", m: ThinMessage, now: number = Date.now()): Promise<ThinResult> {
  if (mode !== "fixture") return { ok: false, code: "live", reason: "the thin relay has no live path in this build — a launched account's live writes come with the live registrar (O1)" };
  const shape = shapeProblem(m);
  if (shape) return { ok: false, code: "malformed", reason: shape };
  if (Math.abs(m.timestamp - now) > SKEW_MS) return { ok: false, code: "stale", reason: "the message's timestamp is not current (a launched account posts at the current time — nothing is backdated)" };
  const { chainSource } = await import("./chain/source");
  const { hasActiveKey } = await import("./chain/types");
  let keys;
  let account;
  try {
    const chain = chainSource(mode);
    [keys, account] = await Promise.all([chain.keysOf(m.fid), chain.account(m.fid)]);
  } catch (e) {
    return { ok: false, code: "chain", reason: "the account's keys could not be checked (" + (e as Error).message + ") — nothing was relayed" };
  }
  if (!account || !hasActiveKey(keys, m.signerPubKey)) return { ok: false, code: "wrong-key", reason: `that key is not a registered signer of fid ${m.fid} — refused` };
  if (!verifyCanonical(m.signature, thinCanonical(mode, m), m.signerPubKey)) return { ok: false, code: "bad-signature", reason: "the message's signature does not verify under its key — refused" };
  const s = st();
  const limit = 200 * Math.max(1, account.storageUnits);
  if (s.log.filter((e) => e.fid === m.fid && now - e.at < DAY).length >= limit) return { ok: false, code: "rate-limit", reason: `fid ${m.fid} has used its ${limit} messages for today (200 per storage unit) — try tomorrow` };
  let hash: string;
  let deduped = false;
  if (m.type === "CastAdd") {
    hash = thinCastHash(m);
    const { recordSimNetworkCast } = await import("./writes");
    deduped = recordSimNetworkCast({ hash, text: m.text, parent: m.parentHash ?? undefined, quote: m.quoteHash ?? undefined, fid: m.fid, at: now }).deduped;
  } else if (m.type === "UserDataAdd") {
    hash = "0xud" + sha(thinCanonical(mode, m)).slice(0, 38);
    s.userData.set(m.fid, { ...(s.userData.get(m.fid) ?? {}), [m.field]: m.value });
  } else {
    hash = "0x" + m.type.slice(0, 2).toLowerCase() + sha(thinCanonical(mode, m)).slice(0, 38);
  }
  if (!deduped) s.log.push({ at: now, fid: m.fid, type: m.type, hash, ...(m.type === "CastAdd" ? { quoteHash: m.quoteHash ?? null } : {}) });
  return { ok: true, hash, ...(deduped ? { deduped: true } : {}) };
}

/** forward a custody-signed fname proof to the simulated fname server (which verifies the custody signature itself) */
export async function submitUsernameProof(mode: "fixture" | "live", p: ThinUsernameProof): Promise<ThinResult> {
  if (mode !== "fixture") return { ok: false, code: "live", reason: "the thin relay has no live path in this build" };
  let res: Response;
  try {
    res = await fetch(validatorUrl() + "/sim-chain/fname", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, name: p.name, fid: p.fid, owner: p.owner, timestamp: p.timestamp, signature: p.signature }),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, code: "chain", reason: "the name server could not be reached (" + (e as Error).message + ")" };
  }
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  // PERSONA LAUNCH P6 (fix W2-LAUNCH-FNAME-TRANSIENT): ONLY a taken name (409) is "refused" — the one final answer the
  // launch tick accepts and moves on from (the account stays nameless). A 403 is the custody key's problem; anything
  // else — a 5xx ("name not recorded"), a 400 (a timestamp the server found stale), a 404 — is retryable ("chain"), so the
  // tick retries with a freshly signed proof instead of leaving the account nameless for good.
  if (!res.ok) return { ok: false, code: res.status === 409 ? "refused" : res.status === 403 ? "wrong-key" : "chain", reason: j?.error ?? "the name server refused (" + res.status + ")" };
  const hash = "0xun" + sha(["fname", p.fid, p.name].join("|")).slice(0, 38);
  st().log.push({ at: Date.now(), fid: p.fid, type: "UsernameProof", hash });
  return { ok: true, hash };
}
