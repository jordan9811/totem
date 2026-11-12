import "server-only";
// PERSONA LAUNCH P6 — THE LAUNCH REQUEST: what the device sends the Totem registrar (anonymously) to create a persona's
// own Farcaster account.
//
// WHAT IT CARRIES, AND NOTHING ELSE (R3): the persona's DERIVED custody address (kdf fc-custody/<nonce>: the account's
// owner), its DERIVED recovery address (fc-recovery/<nonce>: so the registrar that pays can never seize the account), its
// DERIVED Ed25519 signer key (fc-signer/<nonce>: added to the account in the same Bundler call, the account's
// self-custody key from then on), the name and profile it wants, the custody key's two EIP-712 signatures (IdGateway
// Register, KeyGateway Add) and the deadline those signatures carry — QUANTIZED TO A WEEK (the first 7-day boundary at
// least 4 days after the click's day, so the registrar's 2–48 h batch always lands before it; never the click time, nor
// since wave 3 the click's DAY, which a signature would publish forever — deadlineDayFor).
// Nothing in it names the root, a device, a persona id or another persona: every value is either derived one-way from
// the root for THIS persona alone or chosen by the owner to be public.
//
// CANONICAL FORM: JSON with a fixed key order (JSON.stringify of an object built in that order), at most 2048 bytes.
// launchCommit = sha256("layers-launch-request/1|" + request): the launch proof's message binds it (lib/zk/prove.ts), so
// the request cannot be swapped after the proof is made. DELIBERATE DUPLICATE of validator/registrar.js
// (canonicalLaunchRequest, launchCommitOf, the shape rules) and of the typed data validator/simchain.js recovers;
// scripts/unit-launch.mjs pins both pairs, one side against the other.
//
// THE ADD METADATA (A-LAUNCH-ADD-METADATA-ORDER): on the real chain the Add signature covers the registrar app's
// SignedKeyRequestMetadata — which the app must sign BEFORE the device signs Add (a second anonymous round trip, or a
// published vouch). The simulated chain takes the registrar app fid as one 32-byte word; the residual is in the posture.
import { createHash } from "@/lib/platform/crypto";

/** said on every launch screen (the owner rule: test data is never presented as live) */
export const SIMULATED_NOTICE = "This is a simulated registrar: nothing is created on Farcaster. The account, its chain and its $0 cost are test data.";
export const LAUNCH_TIMING_SENTENCE = "Your account appears within 2 to 48 hours at a random time.";
export const LAUNCH_PRICE_SENTENCE = "Price: not set up yet.";
/** PERSONA LAUNCH P6 (fix UX-L8): what the launch posts on Farcaster by itself, said BEFORE the confirm (lib/launch/tick.ts
 *  posts it automatically once the account exists: lib/launch/history.ts postLaunchHistory) */
export const LAUNCH_HISTORY_SENTENCE =
  "Once the account exists, it posts one launch cast linking its proof page, plus a quote of each post you tick below (at most 10). They are posted at that time, not at the original dates.";
/** the no-undo sentence — shown BEFORE the box the handle is typed into */
export function noUndoSentence(handle: string): string {
  // PERSONA LAUNCH P6 (fix UX-L1, launch's half): posts made while the launch is pending are revealed too — say so here
  return `Launching @${handle} is permanent. Every anonymous post @${handle} made, and any you post as @${handle} before its account appears, becomes public as @${handle}'s, all at once, and there is no undo.`;
}

export const LAUNCH_REQUEST_DOMAIN = "layers-launch-request/1|";
export const MAX_LAUNCH_REQUEST_BYTES = 2048;
/** the JSON-escaped request must fit the anonymous channel's constant 4096-byte body beside a LIVE proof envelope
 *  (scripts/unit-launch.mjs measures the worst case through lib/zk/anon/submit.ts paddedBody) */
export const LAUNCH_ENVELOPE_BUDGET_BYTES = 2300;
/** the Totem registrar's app fid on the simulated chain — DELIBERATE DUPLICATE of validator/simchain.js */
export const REGISTRAR_APP_FID = 7_000_000;
const DAY = 86_400_000;

/** Farcaster's IdGateway / KeyGateway / fname-server EIP-712 domains (Optimism; lowercase addresses) — DELIBERATE
 *  DUPLICATES of validator/simchain.js. VERIFY-YOURSELF before any live use (docs.farcaster.xyz reference). */
export const ID_GATEWAY_DOMAIN = { name: "Farcaster IdGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc25870c6ed6b6c7e41fb078b7656f69" } as const;
export const KEY_GATEWAY_DOMAIN = { name: "Farcaster KeyGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fc56947c7e7183f8ca4b62398caadf0b" } as const;
export const FNAME_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" } as const;
export const REGISTER_TYPES = {
  Register: [
    { name: "to", type: "address" },
    { name: "recovery", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const ADD_TYPES = {
  Add: [
    { name: "owner", type: "address" },
    { name: "keyType", type: "uint32" },
    { name: "key", type: "bytes" },
    { name: "metadataType", type: "uint8" },
    { name: "metadata", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const USERNAME_PROOF_TYPES = {
  UserNameProof: [
    { name: "name", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "owner", type: "address" },
  ],
} as const;

export interface LaunchProfile {
  displayName: string;
  bio: string;
  pfpUrl: string;
}
export interface LaunchRequest {
  v: 1;
  mode: "fixture" | "live";
  custody: string;
  recovery: string;
  signerKey: string;
  fname: string;
  profile: LaunchProfile;
  registerSig: string;
  addSig: string;
  deadlineDay: number;
}

/** the ONE canonical form — DELIBERATE DUPLICATE of validator/registrar.js canonicalLaunchRequest */
export function canonicalLaunchRequest(r: LaunchRequest): string {
  return JSON.stringify({
    v: r.v,
    mode: r.mode,
    custody: r.custody,
    recovery: r.recovery,
    signerKey: r.signerKey,
    fname: r.fname,
    profile: { displayName: r.profile.displayName, bio: r.profile.bio, pfpUrl: r.profile.pfpUrl },
    registerSig: r.registerSig,
    addSig: r.addSig,
    deadlineDay: r.deadlineDay,
  });
}

export function parseLaunchRequest(s: unknown): LaunchRequest | null {
  if (typeof s !== "string") return null;
  try {
    const o = JSON.parse(s) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) && (o as { profile?: unknown }).profile && typeof (o as { profile?: unknown }).profile === "object" ? (o as LaunchRequest) : null;
  } catch {
    return null;
  }
}

/** sha256("layers-launch-request/1|" + request) — DELIBERATE DUPLICATE of validator/registrar.js launchCommitOf */
export function launchCommitOf(request: string): string {
  return createHash("sha256").update(LAUNCH_REQUEST_DOMAIN + request, "utf8").digest("hex");
}

const chars = (s: string) => [...s].length;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export const FNAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;

/** the SHAPE rules — DELIBERATE DUPLICATE of validator/registrar.js launchRequestShapeProblem (the validator also checks
 *  the two signatures and refuses every universe but fixture). null = acceptable. */
export function launchRequestShapeProblem(request: unknown): string | null {
  if (typeof request !== "string" || !request) return "the launch request is missing";
  if (new TextEncoder().encode(request).length > MAX_LAUNCH_REQUEST_BYTES) return `the launch request is longer than ${MAX_LAUNCH_REQUEST_BYTES} bytes`;
  const r = parseLaunchRequest(request) as (LaunchRequest & Record<string, unknown>) | null;
  if (!r) return "the launch request is not a JSON object";
  if (r.v !== 1) return "the launch request's version is not 1";
  if (r.mode !== "fixture" && r.mode !== "live") return "the launch request's universe is not fixture or live";
  for (const k of ["custody", "recovery"] as const) if (typeof r[k] !== "string" || !/^0x[0-9a-f]{40}$/.test(r[k])) return `the launch request's ${k} address is malformed (0x + 40 lowercase hex)`;
  if (r.custody === r.recovery) return "the recovery address must differ from the custody address";
  if (typeof r.signerKey !== "string" || !/^[0-9a-f]{64}$/.test(r.signerKey)) return "the launch request's signer key is malformed";
  if (typeof r.fname !== "string" || !FNAME_RE.test(r.fname)) return "the name must be 1 to 16 lowercase letters, digits or hyphens, not starting with a hyphen";
  const p = r.profile as unknown as Record<string, unknown>;
  if (typeof p.displayName !== "string" || chars(p.displayName) > 32 || CONTROL_RE.test(p.displayName)) return "the display name is at most 32 characters";
  if (typeof p.bio !== "string" || chars(p.bio) > 256 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(p.bio)) return "the bio is at most 256 characters";
  if (typeof p.pfpUrl !== "string" || chars(p.pfpUrl) > 256 || (p.pfpUrl !== "" && !/^https:\/\/[^\s"<>]+$/.test(p.pfpUrl))) return "the picture must be an https address of at most 256 characters, or none";
  for (const k of ["registerSig", "addSig"] as const) if (typeof r[k] !== "string" || !/^0x[0-9a-f]{130}$/.test(r[k])) return `the launch request's ${k} is malformed`;
  if (!Number.isInteger(r.deadlineDay) || r.deadlineDay < 19_000 || r.deadlineDay > 100_000) return "the launch request's deadline day is implausible";
  if (canonicalLaunchRequest(r) !== request) return "the launch request is not in its canonical form";
  return null;
}

/**
 * the deadline the custody signatures carry, as a DAY number — QUANTIZED TO A WEEK (PERSONA LAUNCH wave 3, L8). It is
 * public calldata on the Bundler, forever. "The click's UTC day + 4" let anyone recover the click DAY (deadline − 4),
 * which cut the 2–48 h random registration cover to at most one UTC day and split every batch by click day. Now it is
 * the first 7-day boundary (days since 1970, a multiple of 7) at least 4 days after the click's day: every launch
 * clicked in the same 7-day stretch carries the SAME deadline, which still outlasts the 48-hour window by two days at
 * least (and is at most 10 days out). What remains: the deadline names the click's 7-day stretch, so a batch near a
 * stretch's edge can be split in two by it (A-LAUNCH-DEADLINE-WEEK, SECURITY-POSTURE). DELIBERATE DUPLICATE of the
 * registrar's check (validator/registrar.js deadlineIsQuantized), which refuses a deadline that is not a week boundary.
 */
export function deadlineDayFor(nowMs: number): number {
  return 7 * (Math.floor((Math.floor(nowMs / DAY) + 3) / 7) + 1);
}
export function deadlineSecondsOf(deadlineDay: number): number {
  return deadlineDay * 86_400;
}

/** the simulated chain's Add metadata: the registrar app fid as one 32-byte word (A-LAUNCH-ADD-METADATA-ORDER) */
export function addMetadataFor(appFid: number = REGISTRAR_APP_FID): `0x${string}` {
  return ("0x" + BigInt(appFid).toString(16).padStart(64, "0")) as `0x${string}`;
}

/** a Farcaster name from a Totem handle: lowercase, "_" and "." become "-", anything else dropped, at most 16 */
export function fnameFromHandle(handle: string): string {
  let s = String(handle || "")
    .toLowerCase()
    .replace(/[_.]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, 16);
  if (!s) s = "persona";
  return s;
}

export interface LaunchRequestInput {
  fname?: string;
  displayName?: string;
  bio?: string;
  pfpUrl?: string;
}

export type BuiltLaunchRequest = {
  ok: true;
  request: string;
  launchCommit: string;
  custody: string;
  recovery: string;
  signerKey: string;
  fname: string;
  profile: LaunchProfile;
  deadlineDay: number;
};

/** what the launch WOULD create (no signature, nothing written, nothing fetched) — the preview's account section */
export async function proposedAccount(personaId: string, input: LaunchRequestInput = {}): Promise<{ fname: string; profile: LaunchProfile }> {
  const { getPersona } = await import("@/lib/identity/keystore");
  const p = getPersona(personaId);
  const fname = typeof input.fname === "string" && input.fname ? input.fname.trim().toLowerCase().replace(/^@/, "") : fnameFromHandle(p?.handle ?? "");
  const avatar = p?.avatarUrl ?? "";
  return {
    fname,
    profile: {
      displayName: typeof input.displayName === "string" ? input.displayName.trim() : (p?.name ?? "").slice(0, 32),
      bio: typeof input.bio === "string" ? input.bio.trim() : (p?.bio ?? "").slice(0, 256),
      pfpUrl: typeof input.pfpUrl === "string" ? input.pfpUrl.trim() : /^https:\/\//.test(avatar) && avatar.length <= 256 ? avatar : "",
    },
  };
}

/**
 * BUILD AND SIGN the launch request for one of THIS device's personas — in memory; nothing is written or fetched. The
 * persona must be keystore-rooted (a seeded persona's keys come off a public constant: anyone could take its account,
 * D-FID-5-LIVE-KEYSTORE-ONLY), public, not the read-only public self, and own no account yet; the name must not share a
 * stem with the owner's main account (matching names link them publicly). Refusals are plain words.
 */
export async function buildLaunchRequest(personaId: string, input: LaunchRequestInput, mode: "fixture" | "live", now: number = Date.now()): Promise<BuiltLaunchRequest | { ok: false; reason: string }> {
  const { isKeystoreRootedPersona, fcCustodyAddressFor, fcRecoveryAddressFor, fcSignerPublicKeyFor, signCustodyTypedDataFor } = await import("@/lib/identity/keys");
  const { getPersona } = await import("@/lib/identity/keystore");
  const { kindOf } = await import("@/lib/identity/personaKind");
  const p = getPersona(personaId);
  const who = "@" + (p?.handle ?? "this persona");
  if (!p || !isKeystoreRootedPersona(personaId)) return { ok: false, reason: "Only a persona made on this device can be launched — a demo persona's keys are public, so anyone could take its account." };
  if (p.publicSelf === true) return { ok: false, reason: "Your own Farcaster account is already an account; there is nothing to launch." };
  if (kindOf(personaId) !== "public") return { ok: false, reason: `${who} is a private persona: private personas never get a Farcaster account.` };
  const { personaFidRecord, mainNameDerivation } = await import("@/lib/fc/personaFid");
  if (await personaFidRecord(personaId)) return { ok: false, reason: `${who} already has its own Farcaster account.` };
  const custody = fcCustodyAddressFor(personaId)?.toLowerCase() ?? null;
  const recovery = fcRecoveryAddressFor(personaId)?.toLowerCase() ?? null;
  const signerKey = fcSignerPublicKeyFor(personaId);
  if (!custody || !recovery || !signerKey) return { ok: false, reason: `This device can't make ${who}'s account keys (a linked device made before launch existed has no recovery key) — launch from the device that holds your root.` };
  const proposed = await proposedAccount(personaId, input);
  if (!FNAME_RE.test(proposed.fname)) return { ok: false, reason: "The name must be 1 to 16 lowercase letters, digits or hyphens, not starting with a hyphen." };
  const mainClash = await mainNameDerivation(proposed.fname);
  if (mainClash) return { ok: false, reason: mainClash };
  const deadlineDay = deadlineDayFor(now);
  const deadline = BigInt(deadlineSecondsOf(deadlineDay));
  const registerSig = await signCustodyTypedDataFor(personaId, {
    domain: ID_GATEWAY_DOMAIN,
    types: REGISTER_TYPES,
    primaryType: "Register",
    message: { to: custody, recovery, nonce: BigInt(0), deadline },
  });
  const addSig = await signCustodyTypedDataFor(personaId, {
    domain: KEY_GATEWAY_DOMAIN,
    types: ADD_TYPES,
    primaryType: "Add",
    message: { owner: custody, keyType: 1, key: "0x" + signerKey, metadataType: 1, metadata: addMetadataFor(), nonce: BigInt(0), deadline },
  });
  if (!registerSig || !addSig) return { ok: false, reason: `This device couldn't sign with ${who}'s account key.` };
  const req: LaunchRequest = { v: 1, mode, custody, recovery, signerKey, fname: proposed.fname, profile: proposed.profile, registerSig: registerSig.toLowerCase(), addSig: addSig.toLowerCase(), deadlineDay };
  const request = canonicalLaunchRequest(req);
  const shape = launchRequestShapeProblem(request);
  if (shape) return { ok: false, reason: shape.charAt(0).toUpperCase() + shape.slice(1) + "." };
  if (new TextEncoder().encode(JSON.stringify(request)).length > LAUNCH_ENVELOPE_BUDGET_BYTES) return { ok: false, reason: "The bio and picture address are too long to fit the anonymous request. Shorten the bio and try again." };
  return { ok: true, request, launchCommit: launchCommitOf(request), custody, recovery, signerKey, fname: proposed.fname, profile: proposed.profile, deadlineDay };
}
