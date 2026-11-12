import "server-only";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the owner gate's state, on the owner app's VOLUME. Server-only by nature: the
// Edge middleware never imports this file (it asks OWNER_STATE_API instead), the browser device never bundles it
// (scripts/device-routes.mjs keeps every /api/owner-login route server-only), and the validator never sees any of it.
//
// One small JSON file, beside the keystore on the same volume (KEYSTORE_DIR=/data/keystore → /data/owner-passkeys.json;
// OWNER_PASSKEYS_FILE overrides). It holds:
//   * epoch     — the session epoch every live cookie must carry; "sign out everywhere" draws a new one
//   * userHandle — the WebAuthn user.id of "the owner" (random, stable; it names no one)
//   * passkeys  — at most OWNER_PASSKEYS_MAX registered credentials: an opaque slot id (what a session cookie carries),
//                 the credential id, a name, the SPKI public key, its algorithm, the signature counter, the
//                 backup flags, the transports, when it was added and last used, and which passphrase it was added
//                 under (ownerPasskeyBinding — a passkey from an earlier passphrase is retired)
// No private key, no passphrase, no session cookie is ever stored here.
//
// Concurrency: every read-modify-write is SYNCHRONOUS (withOwnerState) — nothing else in this process runs between its
// read and its atomic write (temp file, fsync, rename) — so two concurrent sign-ins cannot both pass one counter
// value, and a removal cannot be lost under a rename. One process serves the owner service (a single instance).
//
// Failure is never a default: a file that exists but cannot be read or does not parse THROWS, and every caller turns
// that into a refusal (the gate stays shut, a passkey sign-in is refused). Only the passphrase path may replace an
// unreadable file — moved aside under a name that says so, never deleted — because the passphrase is the root of trust
// and a fresh state (new epoch, no passkeys) signs everything out.
//
// Review PK-1/PK-2: the writer and the reader can never disagree again. writeOwnerState parses what it is about to
// write with the reader's own parser first and refuses the write when it would not read back (nothing is written; the
// caller answers 400/503) — a name or a credential id the reader rejects can no longer reach the volume and turn the
// whole gate into a 503 whose only way out (a passphrase sign-in) forgets every passkey. Review PK-5: a write is made
// DURABLE, not only atomic — after the rename, the directory itself is fsynced (POSIX), so a host crash just after
// "sign out everywhere" or "remove passkey" cannot bring the old epoch or the removed passkey back.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  OWNER_PASSKEYS_MAX,
  OWNER_PASSKEY_NAME_MAX,
  isOwnerEpoch,
  isPasskeySlot,
  ownerPasskeyBinding,
  registerOwnerStateSource,
  type OwnerGateState,
} from "@/lib/platform/owner-access";

export interface StoredPasskey {
  /** opaque, random — what a passkey session cookie names; never derived from the credential */
  slot: string;
  /** the WebAuthn credential id, base64url */
  id: string;
  name: string;
  /** SPKI DER, hex */
  publicKey: string;
  /** COSE algorithm: -7 ES256, -8 EdDSA, -257 RS256 */
  alg: number;
  signCount: number;
  /** BE at registration: a syncable passkey (iCloud Keychain, Google Password Manager, …); fixed for its lifetime */
  backupEligible: boolean;
  /** BS at its last use: currently synced */
  backupState: boolean;
  transports: string[];
  aaguid: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** ownerPasskeyBinding(passphrase) when it was added */
  binding: string;
}

export interface OwnerState {
  v: 1;
  epoch: string;
  epochAt: number;
  /** the WebAuthn user.id, base64url of 16 random bytes */
  userHandle: string;
  passkeys: StoredPasskey[];
}

export class OwnerStateError extends Error {
  constructor(
    /** "rejected": a write refused because what it would store does not read back (nothing was written) */
    readonly kind: "unreadable" | "malformed" | "absent" | "unwritable" | "rejected",
    message: string
  ) {
    super(message);
    this.name = "OwnerStateError";
  }
}

/** Where the state lives. OWNER_PASSKEYS_FILE wins; otherwise BESIDE the keystore, on its volume
 *  (/data/keystore → /data/owner-passkeys.json), or inside the keystore directory when that is a filesystem root's
 *  direct child; with no KEYSTORE_DIR (the rig), inside .keystore/ — gitignored, never the repo root. */
export function ownerStateFile(env: Record<string, string | undefined> = process.env): string {
  const explicit = (env.OWNER_PASSKEYS_FILE ?? "").trim();
  if (explicit) return path.resolve(explicit);
  const ks = (env.KEYSTORE_DIR ?? "").trim();
  if (!ks) return path.join(process.cwd(), ".keystore", "owner-passkeys.json");
  const dir = path.resolve(ks);
  const parent = path.dirname(dir);
  return parent === path.parse(dir).root ? path.join(dir, "owner-passkeys.json") : path.join(parent, "owner-passkeys.json");
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
const B64URL_ID = /^[A-Za-z0-9_-]{16,1366}$/; // ≤ 1023 bytes, the spec's cap
const HEX_KEY = /^[0-9a-f]{64,2048}$/;
const TRANSPORT = /^[a-z-]{1,32}$/;
const ALGS = new Set([-7, -8, -257]);

/** Review PK-1 — THE one rule for a stored name, shared by the cleaner (what may be written) and the parser (what is
 *  read back): 1 to OWNER_PASSKEY_NAME_MAX code points. An astral character (an emoji, a flag half) is two UTF-16
 *  units, so the UTF-16 bound is twice the code-point bound — the old reader capped UTF-16 at 64 while the cleaner
 *  allowed 40 code points (up to 80 units), and one emoji-heavy rename locked the gate. */
export function passkeyNameFits(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= OWNER_PASSKEY_NAME_MAX * 2 && Array.from(v).length <= OWNER_PASSKEY_NAME_MAX;
}

function parsePasskey(v: unknown): StoredPasskey {
  const o = (v ?? {}) as Record<string, unknown>;
  const ok =
    isPasskeySlot(o.slot) &&
    isStr(o.id, B64URL_ID) &&
    passkeyNameFits(o.name) &&
    isStr(o.publicKey, HEX_KEY) &&
    typeof o.alg === "number" &&
    ALGS.has(o.alg) &&
    isInt(o.signCount, 0, 0xffffffff) &&
    typeof o.backupEligible === "boolean" &&
    typeof o.backupState === "boolean" &&
    Array.isArray(o.transports) &&
    o.transports.length <= 8 &&
    o.transports.every((t) => isStr(t, TRANSPORT)) &&
    isStr(o.aaguid, /^[0-9a-f]{32}$/) &&
    isInt(o.createdAt, 0, Number.MAX_SAFE_INTEGER) &&
    (o.lastUsedAt === null || isInt(o.lastUsedAt, 0, Number.MAX_SAFE_INTEGER)) &&
    isStr(o.binding, /^[0-9a-f]{32}$/);
  if (!ok) throw new OwnerStateError("malformed", "a passkey record in the owner state does not have the expected shape");
  return {
    slot: o.slot as string,
    id: o.id as string,
    name: o.name as string,
    publicKey: o.publicKey as string,
    alg: o.alg as number,
    signCount: o.signCount as number,
    backupEligible: o.backupEligible as boolean,
    backupState: o.backupState as boolean,
    transports: [...(o.transports as string[])],
    aaguid: o.aaguid as string,
    createdAt: o.createdAt as number,
    lastUsedAt: o.lastUsedAt as number | null,
    binding: o.binding as string,
  };
}

function parseState(text: string): OwnerState {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new OwnerStateError("malformed", "the owner state file is not JSON");
  }
  const o = (j ?? {}) as Record<string, unknown>;
  if (o.v !== 1 || !isOwnerEpoch(o.epoch) || !isInt(o.epochAt, 0, Number.MAX_SAFE_INTEGER) || !isStr(o.userHandle, /^[A-Za-z0-9_-]{22}$/) || !Array.isArray(o.passkeys)) {
    throw new OwnerStateError("malformed", "the owner state file does not have the expected shape");
  }
  if (o.passkeys.length > 64) throw new OwnerStateError("malformed", "the owner state file lists too many passkeys");
  const passkeys = o.passkeys.map(parsePasskey);
  const slots = new Set(passkeys.map((p) => p.slot));
  const ids = new Set(passkeys.map((p) => p.id));
  if (slots.size !== passkeys.length || ids.size !== passkeys.length) throw new OwnerStateError("malformed", "the owner state file repeats a passkey");
  return { v: 1, epoch: o.epoch as string, epochAt: o.epochAt as number, userHandle: o.userHandle as string, passkeys };
}

/** The state on the volume: null when there is no file yet (no passphrase sign-in has ever written one); THROWS an
 *  OwnerStateError when the file exists but cannot be read or does not parse — never a silent default. */
export function readOwnerState(env: Record<string, string | undefined> = process.env): OwnerState | null {
  const file = ownerStateFile(env);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new OwnerStateError("unreadable", "the owner state file cannot be read (" + ((e as NodeJS.ErrnoException)?.code ?? "error") + ")");
  }
  return parseState(text);
}

const dirSyncWarned = new Set<string>();
/** Review PK-5: make a rename DURABLE — fsync the directory that holds the entry (POSIX; a rename lives in its
 *  directory, and on ext4 an unsynced one can be undone by a crash within the journal's commit interval). Windows
 *  cannot open a directory for fsync (NTFS journals the rename itself), so nothing is attempted there. Best effort:
 *  the rename has already happened and is what every reader sees, so a filesystem that cannot fsync a directory
 *  (EINVAL on some network and FUSE mounts) is logged once and never turned into a "nothing changed" refusal. */
export function syncOwnerStateDirectory(dir: string): void {
  if (process.platform === "win32") return;
  let fd: number | null = null;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? "error";
    if (!dirSyncWarned.has(code)) {
      dirSyncWarned.add(code);
      console.warn("[owner-gate] the owner state's directory could not be fsynced (" + code + "); the write stands, but a host crash in the next few seconds could undo it");
    }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** atomic AND durable: a temp file beside the target, written, fsynced, renamed over it, then the directory fsynced —
 *  a crash leaves the old file or the new one, never half of either, and an answered write stays written. Owner-only
 *  permissions where the filesystem has them. What is written is first parsed back with the reader's own parser: a
 *  state the reader would reject is never written (OwnerStateError "rejected", the file untouched). */
function writeOwnerState(state: OwnerState, env: Record<string, string | undefined>): void {
  const file = ownerStateFile(env);
  const text = JSON.stringify(state, null, 2) + "\n";
  try {
    parseState(text);
  } catch (e) {
    throw new OwnerStateError("rejected", "the owner state was not written: it would not read back (" + ((e as Error)?.message ?? "error") + ")");
  }
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        renameSync(tmp, file);
        lastErr = null;
        break;
      } catch (e) {
        // Windows (the rig laptop): a concurrent reader can hold the destination for a moment
        lastErr = e;
        const until = Date.now() + 20 * (attempt + 1);
        while (Date.now() < until) {
          /* wait */
        }
      }
    }
    if (lastErr) throw lastErr;
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    throw new OwnerStateError("unwritable", "the owner state could not be written to the volume (" + ((e as NodeJS.ErrnoException)?.code ?? "error") + ")");
  }
  syncOwnerStateDirectory(path.dirname(file));
}

function freshState(now: number): OwnerState {
  return { v: 1, epoch: randomBytes(16).toString("hex"), epochAt: now, userHandle: b64url(randomBytes(16)), passkeys: [] };
}

/**
 * A synchronous read-modify-write. `fn` sees the current state, may change it in place, and says whether to write.
 * No await can sit between the read and the write, so no other request in this process interleaves. Throws when
 * there is no state yet (absent) or it cannot be read; `fn` throwing aborts with nothing written.
 */
export function withOwnerState<T>(fn: (s: OwnerState) => { write: boolean; result: T }, env: Record<string, string | undefined> = process.env): T {
  const s = readOwnerState(env);
  if (!s) throw new OwnerStateError("absent", "there is no owner state on the volume yet — sign in with the passphrase first");
  const { write, result } = fn(s);
  if (write) writeOwnerState(s, env);
  return result;
}

/**
 * THE PASSPHRASE PATH (POST /api/owner-login): afterwards a state exists and the session can be minted for its epoch.
 * A missing file is created (a fresh epoch, a fresh user handle, no passkeys). An unreadable or malformed one is MOVED
 * ASIDE (owner-passkeys.json.unreadable-<ms>) and replaced: the passphrase is the root of trust, and a fresh state signs
 * every device out and forgets every passkey — the owner adds Face ID / fingerprint again. Passkeys registered under
 * an earlier passphrase (their binding is not `binding`) are pruned. A volume that cannot be written throws.
 */
export function ensureOwnerStateForPassphrase(binding: string, env: Record<string, string | undefined> = process.env, now = Date.now()): OwnerState {
  let s: OwnerState | null;
  try {
    s = readOwnerState(env);
  } catch (e) {
    if (!(e instanceof OwnerStateError) || e.kind !== "malformed") throw e;
    const file = ownerStateFile(env);
    try {
      renameSync(file, `${file}.unreadable-${now}`);
    } catch {
      throw new OwnerStateError("unwritable", "the unreadable owner state could not be moved aside");
    }
    syncOwnerStateDirectory(path.dirname(file));
    console.warn("[owner-gate] the owner state file did not parse; it was moved aside and a fresh state started (every device is signed out, every passkey forgotten)");
    s = null;
  }
  if (!s) {
    const fresh = freshState(now);
    writeOwnerState(fresh, env);
    return fresh;
  }
  const kept = s.passkeys.filter((p) => p.binding === binding);
  if (kept.length !== s.passkeys.length) {
    s.passkeys = kept;
    writeOwnerState(s, env);
  }
  return s;
}

/** the passkeys registered under the CURRENT passphrase (a retired one is invisible everywhere) */
export function livePasskeys(s: OwnerState, binding: string): StoredPasskey[] {
  return s.passkeys.filter((p) => p.binding === binding);
}

/** a slot id no passkey has */
export function newPasskeySlot(s: OwnerState): string {
  for (;;) {
    const slot = randomBytes(8).toString("hex");
    if (!s.passkeys.some((p) => p.slot === slot)) return slot;
  }
}

/** sign out everywhere: a new epoch — every cookie issued before this instant is no longer live */
export function rotateOwnerEpoch(s: OwnerState, now = Date.now()): void {
  let epoch = randomBytes(16).toString("hex");
  while (epoch === s.epoch) epoch = randomBytes(16).toString("hex");
  s.epoch = epoch;
  s.epochAt = now;
}

/** THE GATE'S STATE, for the Node side and for OWNER_STATE_API: the current epoch and the live passkey slots. A file
 *  that cannot be read throws — the callers refuse. */
export async function readOwnerGateState(secret: string, env: Record<string, string | undefined> = process.env): Promise<OwnerGateState> {
  const binding = await ownerPasskeyBinding(secret);
  const s = readOwnerState(env);
  if (!s) return { epoch: null, slots: [] };
  return { epoch: s.epoch, slots: livePasskeys(s, binding).map((p) => p.slot) };
}

/** the source ownerSessionRefused / currentOwnerSession read when no other is passed */
export const ownerGateStateSource = (secret: string): Promise<OwnerGateState> => readOwnerGateState(secret);
registerOwnerStateSource(ownerGateStateSource);

// built from a string: the project's TypeScript target (es2017) predates regex property escapes, Node does not
const UNPRINTABLE = new RegExp("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", "gu");

/** a passkey name as the owner typed it: control and format characters (bidi overrides included) removed, whitespace
 *  collapsed, at most OWNER_PASSKEY_NAME_MAX characters (code points: an emoji counts as one); null when nothing is
 *  left. Its result always satisfies passkeyNameFits — the reader's own rule (review PK-1). */
export function cleanPasskeyName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 400) return null;
  const s = raw.normalize("NFC").replace(UNPRINTABLE, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const name = Array.from(s).slice(0, OWNER_PASSKEY_NAME_MAX).join("").trim();
  return passkeyNameFits(name) ? name : null;
}

// ------------------------------------------------------------------------------------------------ challenges
// Server-stored, single-use, short-lived. In this process's memory (one instance serves the owner service), held on
// globalThis so every route module shares one table whatever the bundler does. A challenge is spent by its FIRST
// presentation, whatever the outcome; a sign-in challenge cannot serve a registration or the reverse; a registration
// challenge belongs to the session that asked for it. The table is capped — beyond it, new ones are refused (the
// middleware's login budget keeps a stranger far below the cap).

export type OwnerChallengePurpose = "login" | "register";
interface PendingChallenge {
  purpose: OwnerChallengePurpose;
  exp: number;
  bind: string | null;
}
export const OWNER_CHALLENGE_TTL_MS = 120_000;
export const OWNER_CHALLENGES_MAX = 64;
const CHALLENGES = Symbol.for("layers.owner.challenges");

function challengeTable(): Map<string, PendingChallenge> {
  const g = globalThis as unknown as Record<symbol, Map<string, PendingChallenge> | undefined>;
  return (g[CHALLENGES] ??= new Map());
}

/** a fresh challenge (base64url of 32 random bytes), or null when too many are outstanding */
export function issueOwnerChallenge(purpose: OwnerChallengePurpose, bind: string | null = null, now = Date.now()): string | null {
  const table = challengeTable();
  for (const [k, p] of table) if (p.exp <= now) table.delete(k);
  if (table.size >= OWNER_CHALLENGES_MAX) return null;
  const challenge = b64url(randomBytes(32));
  table.set(challenge, { purpose, exp: now + OWNER_CHALLENGE_TTL_MS, bind });
  return challenge;
}

/** true once, for a challenge this server issued for this purpose (and session), unexpired; it is spent either way */
export function takeOwnerChallenge(challenge: unknown, purpose: OwnerChallengePurpose, bind: string | null = null, now = Date.now()): boolean {
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const table = challengeTable();
  const p = table.get(challenge);
  if (!p) return false;
  table.delete(challenge);
  return p.purpose === purpose && p.exp > now && p.bind === bind;
}

/** the number of registered passkeys a new one would join (for the cap) */
export function passkeyRoom(s: OwnerState, binding: string): number {
  return Math.max(0, OWNER_PASSKEYS_MAX - livePasskeys(s, binding).length);
}
