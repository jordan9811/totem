import "server-only";
// THE ONLY MODULE THAT TOUCHES ROOT MATERIAL — and, since the crypto
// pass, the only module that touches persona PRIVATE KEYS. Signing
// happens in here (`signAsPersona`); key bytes never cross the module
// boundary. What leaves: public keys, signatures, and (for the vault
// module only) the symmetric vault key — each with its own confinement
// rule, all fed to the leak grep.
//
// Root secret lives here and nowhere else. Personas are derived
// personaId = sha256(rootSecret + ":" + nonce), which is genuinely one-way:
// holding persona A tells you nothing about persona B of the same root
// unless you hold the secret. That is the property the entire disclosure
// model rests on, so it is computed rather than asserted.
//
// THE ROOT SECRET IS THE SEED. It was always 32 random bytes; the crypto
// pass reads it as the HKDF seed for the whole key hierarchy
// (lib/crypto/kdf.ts), so existing personas keep their ids AND gain real
// Ed25519 keys derived from the same (seed, nonce) pair — the id and the
// key are two derivations of one fact. No on-disk migration: derived
// keys are recomputed on demand, which is also what makes seed-phrase
// recovery reconstruct the identity exactly (Gate 4).
//
// Storage is a local file, mocking a device keystore / secure enclave. The
// adapter seam is the real deliverable; the medium is not.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import { deviceAuthSeed, fcCustodySeed, fcRecoverySeed, fcSignerSeed, personaSignSeed, ringInboxSeed, ringPskSeed, vaultKey as deriveVaultKey, zkIdentitySeedAt } from "@/lib/crypto/kdf";
import { privateKeyToAccount } from "viem/accounts";
import { publicKeyOf, signCanonical, toHex } from "@/lib/crypto/ed25519";

const KEYSTORE_DIR = process.env.KEYSTORE_DIR || path.join(process.cwd(), ".keystore");
const KEYSTORE_FILE = path.join(KEYSTORE_DIR, "root.json");

/** The device-local directory that holds the seed. ZK PASS 1 keeps its
 * split-view anchors, validator key pin, cohort records and proof budget
 * beside it (lib/zk/localPins.ts) — on the device, never on the validator. */
export function keystoreDir(): string {
  return KEYSTORE_DIR;
}

export type PersonaKind = "public" | "private";

/** PERSONA LAUNCH P3 (anon track's diff, landed by siwf STEP 0): how a persona's posts leave Totem. "anon" = through
 *  the shared @anon account with a reveal secret only the root holds (D2: the default for a persona without its own
 *  account); "private" = Totem only; "direct" = straight to the persona's own launched account (after launch, P6). */
export type PostMode = "anon" | "private" | "direct";

export interface KeystorePersona {
  id: string;
  nonce: string;
  kind: PersonaKind;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  cluster: string | null;
  createdAt: number;
  /** set when this persona was created by forking another (owner-only) */
  forkedFrom: string | null;
  /** PERSONA LAUNCH P3: absent = the default for the persona's situation (lib/identity/postMode.ts decides). */
  postMode?: PostMode;
  /** PERSONA LAUNCH P1 (SIWF): this persona IS the visitor's own Farcaster account, minted by a verified Sign in with
   *  Farcaster on the public site. Read-only: never an acting target (seed-persona, the action routes and fork refuse
   *  it with PUBLIC_SELF_READ_ONLY), never forked from. Carried through rosterForRecovery into the sealed identityRoster,
   *  so a passkey unlock or the 24 words restore it. The link facts (fname, pfp) live in the sealed accountLinks
   *  namespace (lib/fc/siwf/links.ts), never here: the keystore holds the persona, the vault holds the link. */
  publicSelf?: boolean;
  /** PUBLIC GO-LIVE (This is you): on the public self only — the X handle its Farcaster account verifies, shown on its
   *  Totem profile because the owner said Show (null/absent: not shown). Set by POST /api/onboarding, which looks the
   *  handle up again in the whole downloaded X index; never taken from a page. */
  xShown?: string | null;
}

/** BROWSER KEYSTORE PASS Gate 3 (D-CU-3-THE-KEYSTORE-HAS-A-LINKED-MODE): a root WITHOUT a seed — what device
 * linking delivers. Every per-persona key the seed would derive arrives as a leaf; the vault key, the anchor and the
 * zk master arrive as values; the delegation is the one the root's device-auth key issued for THIS device's key. */
export interface LinkedRoot {
  anchorPubHex: string;
  rootId: string;
  vaultKeyHex: string;
  zkMasterHex: string | null;
  delegation: unknown;
  /** per persona id: the key leaves (hex seeds). PERSONA LAUNCH P6: `fcRecovery`, the launched account's recovery key —
   *  optional because a link made before P6 never carried it (such a device cannot launch; it says so, it never guesses) */
  personaKeys: Record<string, { sign: string; fcSigner: string; fcCustody: string; fcRecovery?: string }>;
}

interface KeystoreFile {
  version: 3;
  /** empty on a linked device (the seed never crossed the channel) */
  rootSecretHex: string;
  personas: KeystorePersona[];
  linked?: LinkedRoot | null;
}

function isLinkedFile(f: KeystoreFile): boolean {
  return !!f.linked && typeof f.linked.anchorPubHex === "string" && /^[0-9a-f]{64}$/.test(f.linked.vaultKeyHex ?? "");
}
const hexBytes = (h: string) => new Uint8Array(Buffer.from(h, "hex"));

const g = globalThis as unknown as { __layersKeystore?: KeystoreFile };

function blank(): KeystoreFile {
  return { version: 3, rootSecretHex: randomBytes(32).toString("hex"), personas: [] };
}

/**
 * BROWSER KEYSTORE PASS Gate 1 stage 4 — THE ONE RULE, ENFORCED AT THE DOOR (docs/custody-model.md, "The one rule").
 *
 * A production server process may not open a keystore. The device is the browser; a Next server that holds a seed is
 * the topology SECURITY-POSTURE.md §8 says makes every privacy claim void. The rig runs its production build WITH
 * ZK_DEV_HOOKS and is unaffected, and the browser (which has a window and whose storage is its own) is the device
 * this rule exists to protect.
 *
 * Recorded deviation (docs/custody-model.md): the server BUNDLE still contains this module, because the rig is the
 * same build — the refusal is at the door rather than at compile time, and scripts/probe-no-keystore.mjs proves a
 * production server leaves an empty KEYSTORE_DIR empty.
 */
function refuseOnAProductionServer(op: string): void {
  const isBrowser = typeof window !== "undefined";
  const hooks = process.env.ZK_DEV_HOOKS === "true";
  if (!isBrowser && process.env.NODE_ENV === "production" && !hooks) {
    throw new Error(
      `keystore: refusing to ${op} on a production server. The device is the browser; the server holds no seed, no vault key and no persona key (docs/custody-model.md, the one rule).`
    );
  }
}

function load(): KeystoreFile {
  if (g.__layersKeystore) return g.__layersKeystore;
  refuseOnAProductionServer("open a keystore");
  let file: KeystoreFile;
  if (storage.exists(KEYSTORE_FILE)) {
    // CRYPTO PASS HARDENING: a corrupt keystore THROWS. The old path
    // silently regenerated a blank root — before real keys that merely
    // orphaned forked personas; now it would destroy every persona
    // signing key and the vault key while presenting as a fresh boot.
    // Losing key material must look like losing key material.
    // (Recovery from a genuinely lost file is Gate 4's job — a mnemonic
    // restore writes a new file through recoverFromSeed, deliberately.)
    let raw: string;
    try {
      raw = storage.readText(KEYSTORE_FILE);
    } catch (e) {
      throw new Error(`keystore: cannot read ${KEYSTORE_FILE}: ${(e as Error).message}`);
    }
    try {
      file = JSON.parse(raw) as KeystoreFile;
    } catch {
      throw new Error(
        `keystore: ${KEYSTORE_FILE} is corrupt (unparseable JSON). Refusing to regenerate a blank root over what may be recoverable key material. Restore the file or recover from the seed phrase.`
      );
    }
    if (!(isLinkedFile(file) || /^[0-9a-f]{64}$/.test(file.rootSecretHex ?? "")) || !Array.isArray(file.personas)) {
      throw new Error(
        `keystore: ${KEYSTORE_FILE} failed validation (rootSecretHex must be 64 hex chars). Refusing to regenerate. Restore the file or recover from the seed phrase.`
      );
    }
  } else {
    // Genuinely missing is the one case where minting a fresh root is
    // correct — first boot on a new "device".
    file = blank();
    persist(file);
  }
  g.__layersKeystore = file;
  return file;
}

function persist(file: KeystoreFile) {
  refuseOnAProductionServer("write a keystore");
  // Atomic on Node (write-temp-then-rename inside the storage layer): a crash mid-write must never leave a
  // half-written root.json — with the loud load() above, a torn file would brick the keystore instead of silently
  // regenerating. In the browser the same call lands the wrapped blob in IndexedDB (lib/platform/storage.ts).
  storage.writeText(KEYSTORE_FILE, JSON.stringify(file, null, 2) + "\n");
  g.__layersKeystore = file;
}

// ---------- derivation ----------

/** personaId = sha256(rootSecret : nonce). One-way by construction. */
export function derivePersonaId(rootSecretHex: string, nonce: string): string {
  return (
    "p_" +
    createHash("sha256").update(rootSecretHex).update(":").update(nonce).digest("hex").slice(0, 32)
  );
}

/**
 * Internal grouping handle for "personas of this root". NEVER serialized —
 * the root-leak test greps every outward payload for this value.
 */
export function rootHandle(): string {
  const f = load();
  return createHash("sha256").update("root:").update(f.linked ? "anchor:" + f.linked.anchorPubHex : f.rootSecretHex).digest("hex").slice(0, 24);
}

/** Root material, for the leak test to search for. Never send this anywhere. */
export function rootMaterialForLeakTest(): string[] {
  const f = load();
  if (f.linked) return [rootHandle()]; // a linked device holds no seed to grep for
  return [f.rootSecretHex, rootHandle()];
}

// ---------- crypto pass: the key hierarchy, confined ----------

function seedBytes(): Uint8Array {
  const f = load();
  if (f.linked) throw new Error("keystore: this device holds a LINKED root and no seed — that operation needs a device that holds the root");
  return new Uint8Array(Buffer.from(f.rootSecretHex, "hex"));
}

/** a persona's key leaf: derived from the seed where there is one, delivered by the link otherwise */
function personaLeaf(p: KeystorePersona, kind: "sign" | "fcSigner" | "fcCustody" | "fcRecovery"): Uint8Array {
  const f = load();
  if (f.linked) {
    const leaves = f.linked.personaKeys[p.id];
    const hex = leaves ? leaves[kind] : undefined;
    if (!leaves || !/^[0-9a-f]{64}$/.test(hex ?? "")) throw new Error(`keystore: the link delivered no ${kind} key for persona ${p.id}`);
    return hexBytes(hex as string);
  }
  if (kind === "sign") return personaSignSeed(seedBytes(), p.nonce);
  if (kind === "fcSigner") return fcSignerSeed(seedBytes(), p.nonce);
  // PERSONA LAUNCH P6 (D6): the launched account's recovery key — its own branch, never the custody key
  if (kind === "fcRecovery") return fcRecoverySeed(seedBytes(), p.nonce);
  return fcCustodySeed(seedBytes(), p.nonce);
}

export function isLinkedDevice(): boolean {
  return !!load().linked;
}

/** the delegation the link delivered for THIS device's key, when this is a linked device */
export function linkedDelegation(): unknown | null {
  return load().linked?.delegation ?? null;
}

/** what a device that holds the root sends to a device it links (D-CU-3-THE-PAYLOAD-IS-THE-MATERIAL-A-DEVICE-NEEDS) */
export function linkMaterial(): { vaultKeyHex: string; zkMasterHex: string | null; personas: KeystorePersona[]; personaKeys: LinkedRoot["personaKeys"] } {
  const f = load();
  if (f.linked) throw new Error("keystore: a linked device cannot link another — that needs a device that holds the root");
  const personaKeys: LinkedRoot["personaKeys"] = {};
  for (const p of f.personas) {
    personaKeys[p.id] = {
      sign: toHex(personaSignSeed(seedBytes(), p.nonce)),
      fcSigner: toHex(fcSignerSeed(seedBytes(), p.nonce)),
      fcCustody: toHex(fcCustodySeed(seedBytes(), p.nonce)),
      // PERSONA LAUNCH P6: a linked device can name (and later use) the launched account's recovery address too
      fcRecovery: toHex(fcRecoverySeed(seedBytes(), p.nonce)),
    };
  }
  let zkMasterHex: string | null = null;
  try {
    zkMasterHex = toHex(zkMasterBytes());
  } catch {
    zkMasterHex = null;
  }
  return { vaultKeyHex: toHex(vaultKeyBytes()), zkMasterHex, personas: f.personas.map((p) => ({ ...p })), personaKeys };
}

/** install a linked root: the keystore becomes this root's, without its seed */
export function installLinkedRoot(linked: LinkedRoot, personas: KeystorePersona[]): void {
  if (!/^[0-9a-f]{64}$/.test(linked.anchorPubHex) || !/^[0-9a-f]{64}$/.test(linked.vaultKeyHex)) throw new Error("installLinkedRoot: malformed material");
  persist({ version: 3, rootSecretHex: "", personas: personas.map((p) => ({ ...p })), linked });
}

/**
 * Ed25519 public key for one of OUR personas — null for anything the
 * keystore does not hold. Public material; safe to serialize, register
 * in the validator's key directory, and hand to verifiers.
 */
export function personaPublicKey(personaId: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  return publicKeyOf(personaLeaf(p, "sign"));
}

/**
 * Sign a canonical string as one of our personas. The private key is
 * derived, used, and dropped INSIDE this call — key bytes never cross
 * the module boundary. Returns null for a persona we do not hold:
 * "cannot sign" is an answer, not an error, and the caller's
 * verification layer treats an unsigned object as invalid anyway.
 */
export function signAsPersona(personaId: string, canonical: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  return signCanonical(canonical, personaLeaf(p, "sign"));
}

/**
 * MULTI-FID PASS Gate 1: the persona's Farcaster SIGNER public key (Ed25519,
 * kdf branch fc-signer/<nonce>) — null for a persona we do not hold.
 * Deterministic: same (seed, nonce) → same key, on every device and after
 * total-device-loss recovery.
 */
export function fcSignerPublicKey(personaId: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  return publicKeyOf(personaLeaf(p, "fcSigner"));
}

/** sign a canonical string with the persona's Farcaster signer — derive, use, drop, inside this call */
export function signAsFcSigner(personaId: string, canonical: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  return signCanonical(canonical, personaLeaf(p, "fcSigner"));
}

/**
 * MULTI-FID PASS Gate 1: the persona's fid CUSTODY address (secp256k1, kdf
 * branch fc-custody/<nonce>). The ADDRESS is public material; the private
 * key is derived, used to compute it, and dropped here.
 */
export function fcCustodyAddress(personaId: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  const priv = personaLeaf(p, "fcCustody");
  return privateKeyToAccount(("0x" + toHex(priv)) as `0x${string}`).address;
}

/**
 * PERSONA LAUNCH P6 (D6 / R1): the persona's fid RECOVERY address (secp256k1, kdf branch fc-recovery/<nonce>). A
 * launched account names it on the IdRegistry, so the account can be recovered by the root's holder alone — never by
 * the Totem registrar that paid for it. The ADDRESS is public material; the key is derived, used and dropped here.
 * Nothing in this pass signs with it (recovery is a later, user-run action).
 */
export function fcRecoveryAddress(personaId: string): string | null {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  return privateKeyToAccount(("0x" + toHex(personaLeaf(p, "fcRecovery"))) as `0x${string}`).address;
}

/** the typed-data shape viem signs (domain, types, primaryType, message) — validated by lib/fc/custodySign.ts */
export interface CustodyTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * MULTI-FID PASS Gate 2: an EIP-712 signature by the persona's fid CUSTODY key
 * (secp256k1, kdf branch fc-custody/<nonce>) — derive, sign, drop, inside this
 * call. The caller (lib/fc/custodySign.ts) has already pinned the typed data
 * to the two shapes this pass knows. Null = not a persona we hold.
 */
export async function signCustodyTypedData(personaId: string, typed: CustodyTypedData): Promise<string | null> {
  const p = load().personas.find((x) => x.id === personaId);
  if (!p) return null;
  const account = privateKeyToAccount(("0x" + toHex(personaLeaf(p, "fcCustody"))) as `0x${string}`);
  return account.signTypedData(typed as unknown as Parameters<typeof account.signTypedData>[0]);
}

/**
 * The symmetric vault key. The ONE piece of derived key material that
 * leaves this module, because bulk encrypt/decrypt belongs in the vault
 * module, not here. Confinement rule: server memory only — never
 * serialized, never in a response, never logged. The leak grep hunts
 * its hex alongside the root material.
 */
export function vaultKeyBytes(): Uint8Array {
  const f = load();
  if (f.linked) return hexBytes(f.linked.vaultKeyHex);
  return deriveVaultKey(seedBytes());
}

/**
 * Device-auth: the root-level key that authorizes devices. Same
 * confinement as persona signing — derive, use, drop, all inside this
 * module. The PUBLIC key is registered with the validator as the trust
 * anchor for this root's device delegations.
 */
/** BROWSER KEYSTORE PASS Gate 1 stage 2: the device-auth public key a CANDIDATE seed would have — used by recovery
 * to enroll this device under the anchor the phrase implies, before the keystore is touched. Pure derivation. */
export function deviceAuthPublicKeyFromSeed(seedHex: string): string {
  return publicKeyOf(deviceAuthSeed(new Uint8Array(Buffer.from(seedHex, "hex"))));
}

/** the same, for signing the enrollment delegation under a candidate seed */
export function signAsDeviceAuthWithSeed(seedHex: string, canonical: string): string {
  return signCanonical(canonical, deviceAuthSeed(new Uint8Array(Buffer.from(seedHex, "hex"))));
}

export function deviceAuthPublicKey(): string {
  const f = load();
  if (f.linked) return f.linked.anchorPubHex;
  return publicKeyOf(deviceAuthSeed(seedBytes()));
}

export function signAsDeviceAuth(canonical: string): string {
  return signCanonical(canonical, deviceAuthSeed(seedBytes()));
}

/**
 * ZK PASS 1: the zk-identity master (HKDF branch "zk-identity/1"). Leaves
 * this module ONLY for lib/zk/identity.ts, which turns it into a Semaphore
 * identity and confines the secret scalar exactly as this module confines
 * persona keys: server memory only, never serialized, never logged, never
 * in a response. Leak-grepped alongside the vault key (see
 * keyMaterialForLeakTest below and lib/zk/identity.ts).
 */
/** ZK PASS 2 Gate 3: which zk-identity branch this device is on (0 = the
 * original). Bumped by re-issuance after a revocation. Device-local
 * (.keystore/zk-identity.json, gitignored with the keystore); absent or
 * unreadable reads as 0 — a recovered device that revoked before scans
 * indices against the validator's registration state. */
const zkIndexFile = () => path.join(keystoreDir(), "zk-identity.json");
export function zkIdentityIndex(): number {
  try {
    const f = zkIndexFile();
    if (!storage.exists(f)) return 0;
    const j = JSON.parse(storage.readText(f)) as { index?: number };
    return Number.isInteger(j.index) && (j.index as number) >= 0 ? (j.index as number) : 0;
  } catch {
    return 0;
  }
}
export function setZkIdentityIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > 1024) throw new Error("zk identity index must be an integer in [0, 1024]");
  storage.writeText(zkIndexFile(), JSON.stringify({ index, pending: null, updatedAt: Date.now() }));
}
/** Gate 4 (attack-z2-2 #4): a re-issued branch is PENDING until its leaf is
 * active — the old branch keeps proving until then (the epoch it is revoked
 * from is the epoch the new one activates). */
export interface PendingZkIdentity {
  index: number;
  activeFromEpoch: number;
}
export function zkIdentityPending(): PendingZkIdentity | null {
  try {
    const f = zkIndexFile();
    if (!storage.exists(f)) return null;
    const j = JSON.parse(storage.readText(f)) as { pending?: PendingZkIdentity | null };
    const p = j.pending;
    return p && Number.isInteger(p.index) && Number.isInteger(p.activeFromEpoch) ? p : null;
  } catch {
    return null;
  }
}
export function setZkIdentityPending(pending: PendingZkIdentity | null): void {
  const index = zkIdentityIndex();
  storage.writeText(zkIndexFile(), JSON.stringify({ index, pending, updatedAt: Date.now() }));
}
export function zkMasterBytes(index: number = zkIdentityIndex()): Uint8Array {
  const f = load();
  if (f.linked) {
    if (!f.linked.zkMasterHex) throw new Error("keystore: the link delivered no zk identity for this device");
    return hexBytes(f.linked.zkMasterHex);
  }
  return zkIdentitySeedAt(seedBytes(), index);
}

/** Same derivation from an EXPLICIT seed — for the recovery-determinism
 * probe, which must compute "what commitment would this phrase's seed
 * produce" without touching (or trusting) the live keystore. */
export function zkMasterBytesFromSeedHex(seedHex: string, index: number = zkIdentityIndex()): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error("zkMaster: seed must be 32-byte hex");
  return zkIdentitySeedAt(new Uint8Array(Buffer.from(seedHex, "hex")), index);
}

/**
 * EVERYTHING the key-material leak grep must hunt: root secret, root
 * handle, every persona private-key seed (hex), the vault key, and the
 * device-auth private seed. Any of these appearing in an adapter
 * response, page payload, persisted server record, or validator state
 * is a failed gate, full stop.
 */
/** the secrets that must NEVER travel on a linking channel: the seed and the device-auth key. Empty on a linked
 *  device, which holds neither. For the payload grep in scripts/accept-cu3.mjs. */
export function rootOnlyMaterialForLeakTest(): string[] {
  const f = load();
  if (f.linked) return [];
  return [f.rootSecretHex, toHex(deviceAuthSeed(seedBytes()))];
}
export function keyMaterialForLeakTest(): string[] {
  const f = load();
  if (f.linked) {
    // a linked device: the vault key, the zk master and every persona leaf it was given
    const out = [f.linked.vaultKeyHex, ...(f.linked.zkMasterHex ? [f.linked.zkMasterHex] : [])];
    for (const leaves of Object.values(f.linked.personaKeys)) {
      out.push(leaves.sign, leaves.fcSigner, leaves.fcCustody);
      if (leaves.fcRecovery) out.push(leaves.fcRecovery); // PERSONA LAUNCH P6
    }
    return out;
  }
  const out = [
    f.rootSecretHex,
    rootHandle(),
    toHex(vaultKeyBytes()),
    toHex(deviceAuthSeed(seedBytes())),
    // ZK PASS 1: the zk-identity master is key material like any other
    // branch. (The Semaphore secret scalar / private-key encodings derived
    // from it are added by lib/zk/identity.ts's own needle list.)
    toHex(zkMasterBytes()),
  ];
  for (const p of f.personas) {
    out.push(toHex(personaSignSeed(seedBytes(), p.nonce)));
    // MULTI-FID PASS Gate 1: the Farcaster signer and custody private keys are key material too
    out.push(toHex(fcSignerSeed(seedBytes(), p.nonce)));
    out.push(toHex(fcCustodySeed(seedBytes(), p.nonce)));
    // PERSONA LAUNCH P6: the launched account's recovery key is key material like the custody key it stands beside
    out.push(toHex(fcRecoverySeed(seedBytes(), p.nonce)));
  }
  return out;
}

// ---------- PERSONA LAUNCH P4 (rings' diff, applied by launch — the keystore owner) ----------

/**
 * A ring's inbox material, per ring nonce: the HPKE input key material and the PSK, each off its own kdf branch
 * (lib/crypto/kdf.ts ringInboxSeed / ringPskSeed). MEMORY ONLY: returned to lib/rings/* for the call that needs it,
 * never serialized, never in a response, never logged — and leak-grepped (ringMaterialForLeakTest). A linked device
 * holds no seed and THROWS (seedBytes): rings are managed from a device that holds the root.
 */
export function ringInboxMaterial(nonce: string): { ikm: Uint8Array; psk: Uint8Array } {
  if (typeof nonce !== "string" || !nonce) throw new Error("keystore: a ring nonce is required");
  const seed = seedBytes();
  return { ikm: ringInboxSeed(seed, nonce), psk: ringPskSeed(seed, nonce) };
}

/** the ring material the leak grep must hunt: hex of the IKM and the PSK for each ring nonce (a linked device: none) */
export function ringMaterialForLeakTest(nonces: string[]): string[] {
  if (load().linked) return [];
  const out: string[] = [];
  for (const n of nonces) {
    if (typeof n !== "string" || !n) continue;
    const m = ringInboxMaterial(n);
    out.push(toHex(m.ikm), toHex(m.psk));
  }
  return out;
}

// ---------- persona management ----------

export function listPersonas(): KeystorePersona[] {
  return load().personas.map((p) => ({ ...p }));
}

export function getPersona(personaId: string): KeystorePersona | null {
  const found = load().personas.find((p) => p.id === personaId);
  return found ? { ...found } : null;
}

export function isOwnPersona(personaId: string): boolean {
  return load().personas.some((p) => p.id === personaId);
}

export function ownPersonaIds(): string[] {
  return load().personas.map((p) => p.id);
}

export interface CreatePersonaInput {
  name: string;
  handle: string;
  kind?: PersonaKind;
  avatarUrl?: string | null;
  bio?: string | null;
  cluster?: string | null;
  nonce?: string;
  forkedFrom?: string | null;
  /** PERSONA LAUNCH P3: copied only when given (absent keeps the record byte-identical to a pre-P3 persona) */
  postMode?: PostMode;
  /** PERSONA LAUNCH P1: copied only when true (absent keeps the record byte-identical to a pre-P1 persona) */
  publicSelf?: boolean;
}

export function createPersona(input: CreatePersonaInput): KeystorePersona {
  const file = load();
  if (file.linked) throw new Error("keystore: a linked device holds no root — mint personas on a device that does");
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const persona: KeystorePersona = {
    id: derivePersonaId(file.rootSecretHex, nonce),
    nonce,
    kind: input.kind ?? "public",
    name: input.name,
    handle: input.handle,
    avatarUrl: input.avatarUrl ?? null,
    bio: input.bio ?? null,
    cluster: input.cluster ?? null,
    createdAt: Date.now(),
    forkedFrom: input.forkedFrom ?? null,
    ...(input.postMode ? { postMode: input.postMode } : {}),
    ...(input.publicSelf === true ? { publicSelf: true } : {}),
  };
  file.personas.push(persona);
  persist(file);
  return { ...persona };
}

/**
 * Drop every persona minted by a fork, returning their ids.
 *
 * Used only by the demo reset. Forks are real personas in a real keystore, so
 * "reset the seed" has to unmake them explicitly — otherwise each demo run
 * leaves another abandoned identity behind and the fixture drifts.
 */
export function purgeForkedPersonas(): string[] {
  const file = load();
  const removed = file.personas.filter((p) => p.forkedFrom).map((p) => p.id);
  if (removed.length) {
    file.personas = file.personas.filter((p) => !p.forkedFrom);
    persist(file);
  }
  return removed;
}

/** CONNECT MAIN — the nonce prefix of a persona minted for a FIXTURE (laptop-rig) main-account connection
 *  (lib/fc/connect.ts mintMainPersona). A live connection's persona never carries it. */
export const FIXTURE_CONNECT_NONCE_PREFIX = "fixture-connect:";

/**
 * CONNECT MAIN review (UXC-13) — drop every persona minted for a FIXTURE main-account connection, returning their ids.
 * Used only by the demo reset (which is refused on the owner service): the fixture connection's record is seed state
 * and goes with the reset, so the persona minted for it must go too, or every rig run of the connect suite leaves
 * another "Fixture Main" in the switcher and the sealed roster. A live connection's persona never matches.
 */
export function purgeFixtureConnectPersonas(): string[] {
  const file = load();
  const removed = file.personas.filter((p) => typeof p.nonce === "string" && p.nonce.startsWith(FIXTURE_CONNECT_NONCE_PREFIX)).map((p) => p.id);
  if (removed.length) {
    file.personas = file.personas.filter((p) => !(typeof p.nonce === "string" && p.nonce.startsWith(FIXTURE_CONNECT_NONCE_PREFIX)));
    persist(file);
  }
  return removed;
}

/** PERSONA LAUNCH P1 (SIWF): the nonce prefix of a persona minted by a FIXTURE (laptop-rig) Sign in with Farcaster
 *  (lib/fc/siwf/flow.ts, nonce "fixture-siwf:siwf-main/v1|<fid>"). A live sign-in's persona never carries it. */
export const FIXTURE_SIWF_NONCE_PREFIX = "fixture-siwf:";

/**
 * PERSONA LAUNCH P1 (SIWF), the purgeFixtureConnectPersonas twin: drop every persona minted by a FIXTURE sign-in,
 * returning their ids. Used only by the demo reset (refused on the owner service and on a public server): the fixture
 * sign-in's sealed link goes with the reset (resetAccountLinksCache + the seed's namespace wipe), so its persona must go
 * too, or every rig run of accept-siwf leaves another "Fixture Main" in the switcher and the sealed roster. A live
 * sign-in's persona never matches the prefix.
 */
export function purgeFixtureSiwfPersonas(): string[] {
  const file = load();
  const hit = (p: KeystorePersona) => typeof p.nonce === "string" && p.nonce.startsWith(FIXTURE_SIWF_NONCE_PREFIX);
  const removed = file.personas.filter(hit).map((p) => p.id);
  if (removed.length) {
    file.personas = file.personas.filter((p) => !hit(p));
    persist(file);
  }
  return removed;
}

/**
 * Adopt a pre-existing persona id into the keystore (seed migration only).
 * Seeded personas were minted before this substrate existed; rather than
 * renaming them everywhere and breaking 140 checks, we record the id and
 * the nonce that would derive it. Flagged so the leak test and the
 * uncomputability test can exclude legacy ids from derivation assertions.
 */
export function adoptSeededPersona(
  persona: Omit<KeystorePersona, "nonce"> & { nonce?: string }
): KeystorePersona {
  const file = load();
  if (file.personas.some((p) => p.id === persona.id)) {
    return { ...file.personas.find((p) => p.id === persona.id)! };
  }
  const adopted: KeystorePersona = {
    ...persona,
    nonce: persona.nonce ?? "seeded:" + persona.id,
  };
  file.personas.push(adopted);
  persist(file);
  return { ...adopted };
}

export function updatePersona(
  personaId: string,
  // PUBLIC GO-LIVE (This is you): "handle" and "xShown" for the public self's profile (POST /api/onboarding). A persona's
  // keys derive from (seed, nonce), never from its handle, so a new username changes no key.
  patch: Partial<Pick<KeystorePersona, "name" | "handle" | "avatarUrl" | "bio" | "cluster" | "postMode" | "xShown">>
): KeystorePersona | null {
  const file = load();
  const idx = file.personas.findIndex((p) => p.id === personaId);
  if (idx === -1) return null;
  file.personas[idx] = { ...file.personas[idx], ...patch };
  persist(file);
  return { ...file.personas[idx] };
}

/** Dev/test reset. Drops the root secret and every derived persona. */
/** BROWSER KEYSTORE PASS Gate 2: the device replaced root.json in storage (unlock, import); forget the cached copy */
export function forgetCachedKeystore(): void {
  g.__layersKeystore = undefined;
}

export function resetKeystore() {
  persist(blank());
}

/** The recoverable roster: persona metadata minus nothing (ids + nonces +
 * display fields). Mirrored to the vault so recovery can rebuild the
 * keystore. NOT secret on its own — a nonce is useless without the seed —
 * but it is vaulted anyway, since it maps a root's persona set. */
export function rosterForRecovery(): KeystorePersona[] {
  return load().personas.map((p) => ({ ...p }));
}

/**
 * GATE 4 RECOVERY. Rebuild the keystore from a recovered seed + the roster
 * decrypted out of the vault. This is the ONE sanctioned way a blank/
 * missing keystore is repopulated (load() otherwise refuses to invent a
 * root over a corrupt file). After this, every persona key re-derives from
 * (seed, nonce), the vault key re-derives from the seed, and every
 * signature that was valid before is valid again — because the inputs are
 * bit-identical.
 */
export function restoreFromRecovery(seedHex: string, personas: KeystorePersona[]): void {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error("restore: seed must be 32-byte hex");
  persist({ version: 3, rootSecretHex: seedHex, personas: personas.map((p) => ({ ...p })) });
}

/**
 * Proof of sibling-uncomputability, exercised by the Gate 0 test: deriving
 * persona B's id requires the secret. Given only A's id and B's nonce, the
 * best you can do is guess.
 */
export function canDeriveWithoutSecret(personaAId: string, nonceB: string): boolean {
  const guess =
    "p_" + createHash("sha256").update(personaAId).update(":").update(nonceB).digest("hex").slice(0, 32);
  const actual = derivePersonaId(load().rootSecretHex, nonceB);
  return guess === actual;
}
