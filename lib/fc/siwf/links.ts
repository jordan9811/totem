import "server-only";
// PERSONA LAUNCH P1 (SIWF) Gate 1d: THE accountLinks NAMESPACE, the sealed record of the visitor's own Farcaster
// account (the "public self") on the public site.
//
// WHAT IT HOLDS: ONE opaque record (key "_") sealed under the vault key, padded so its ciphertext is EXACTLY
// ACCOUNT_LINKS_BYTES (1,024) long whether it holds no link or one: {v: 1, links: [{kind: "farcaster", fid, fname,
// displayName, pfpUrl, bio, personaId, authMethod, signer, nonceHash, messageHash, verifiedAt, verifier: {rpcHost},
// disconnectedAt}]}. NOT stored: the signature, the raw message, the relay's metadata (ip, user agent), the custody
// and verified addresses the relay reports, the channel token (a signature is a transferable proof that fid M
// signed into this domain; keeping it widens what a vault compromise leaks for no product value, D-SIWF-4).
//
// UNIFORM PRESENCE (D-SIWF-2): lib/device/boot.ts seals the EMPTY record for every root that has never sealed it
// (ensureAccountLinksNamespace), so the namespace's existence on the validator says nothing, and its padded size is
// the same with or without a link. The validator learns the NAME "accountLinks" (A-SIWF-NAMESPACE-NAME-VISIBLE,
// under A-CU-NAMESPACE-NAMES-VISIBLE), never a fid.
//
// THE rootRoster / chrome.ts DISCIPLINE, copied rule for rule (never fail open):
//   - loadStrict reads with retries; a non-OK answer, an unreadable record, records none of which this device can
//     read, or an EMPTY/404 namespace this device has sealed before (lib/vault/sealedPins.ts) THROWS: a deleted-but-
//     pinned namespace is refused, never read as "no link";
//   - only a document READ from the validator (or one this process sealed) is cached; a seal adopts the cache only
//     after flushVault succeeds, and pins the namespace (markEverSealed);
//   - writes run one at a time and each builds on loadStrict(); a refused seal (a 409: someone sealed a newer copy)
//     re-reads FIRST and applies the change to what the validator now holds, never sealing over it.
//
// SIGN IN WITH X (2026-11-06): the same ONE record also holds the root's X account, when the visitor signed in with X
// (lib/x/signin/flow.ts): {kind: "x", xid, username, name, pfpUrl, verified, verifiedType, personaId, verifiedAt,
// disconnectedAt}. At most ONE link of each kind (one Farcaster account and one X account per root, each kept as a
// tombstone after a disconnect), in a fixed order (Farcaster first), and the WHOLE document still pads to the same 1,024
// ciphertext bytes, so the validator cannot tell zero, one or two links apart (fitDoc trims optional fields in a fixed
// order when both are long). NOT stored for X: the authorization code, the PKCE verifier, the state, the access token
// (the relay revokes it and never returns it), X's follower counts or anything else /2/users/me could answer.
// mainLink() is still the FARCASTER link only (every existing caller means Farcaster); xLink() is the X one.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";

export const ACCOUNT_LINKS_NS = "accountLinks";
/** the sealed record's ciphertext length (AES-GCM: plaintext + a 16-byte tag), the same for 0 and 1 links */
export const ACCOUNT_LINKS_BYTES = 1024;
/** the plaintext {"m":<doc>,"pad":"…"} is padded to ACCOUNT_LINKS_BYTES - 16 bytes; its wrapper costs 15 */
const PLAINTEXT_BYTES = ACCOUNT_LINKS_BYTES - 16;
const WRAPPER_BYTES = 15;
export const MAX_DOC_BYTES = PLAINTEXT_BYTES - WRAPPER_BYTES;

export interface AccountLink {
  kind: "farcaster";
  fid: number;
  fname: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
  /** the keystore persona minted for this account (publicSelf: true) */
  personaId: string;
  authMethod: "custody" | "authAddress";
  /** the address that signed (custody or auth address), lowercase */
  signer: string;
  /** sha256 hex of the sign-in's nonce and of the signed message: what was verified, never the message itself */
  nonceHash: string;
  messageHash: string;
  verifiedAt: number;
  verifier: { rpcHost: string };
  /** a disconnect TOMBSTONES the link (the persona is kept and shown "disconnected"); the same fid re-arms in place */
  disconnectedAt: number | null;
}

/** SIGN IN WITH X: the root's X account, as X's GET /2/users/me answered through the validator's stateless relay */
export interface XAccountLink {
  kind: "x";
  /** X's numeric user id (a decimal string: it does not fit a double) */
  xid: string;
  /** the @username X reported (1 to 15 letters, digits or underscores), as X cased it */
  username: string;
  name: string | null;
  /** https only, X's own image host only (lib/x/signin/pkce.ts readXUser), or null */
  pfpUrl: string | null;
  /** X's legacy `verified` flag and its `verified_type` (blue, business, government, none), as X reported them */
  verified: boolean;
  verifiedType: string | null;
  /** the root's public self persona (the one Sign in with X minted, or the one Sign in with Farcaster minted first) */
  personaId: string;
  verifiedAt: number;
  /** a disconnect TOMBSTONES the link; only the same X account may sign in again on this identity */
  disconnectedAt: number | null;
}

export type AnyAccountLink = AccountLink | XAccountLink;

export interface AccountLinksDoc {
  v: 1;
  links: AnyAccountLink[];
}

const isFc = (l: AnyAccountLink): l is AccountLink => l.kind === "farcaster";
const isX = (l: AnyAccountLink): l is XAccountLink => l.kind === "x";

interface Loaded {
  doc: AccountLinksDoc;
  /** the namespace held a record when it was read (false = never sealed: genuinely empty) */
  present: boolean;
}

const g = globalThis as unknown as {
  /** only a document READ from the validator, or one this process sealed: never the stand-in of a failed read */
  __layersAccountLinks?: Loaded | null;
  /** one writer at a time: every seal builds on the document the previous seal left */
  __layersAccountLinksWrite?: Promise<unknown>;
};

const NS = ACCOUNT_LINKS_NS as Parameters<typeof flushVault>[0]; // byx adds "accountLinks" to ExtraNamespace; the cast keeps tsc order-free

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function cloneLink<T extends AnyAccountLink>(l: T): T {
  return isFc(l) ? ({ ...l, verifier: { ...l.verifier } } as T) : ({ ...l } as T);
}
function cloneDoc(d: AccountLinksDoc): AccountLinksDoc {
  return { v: 1, links: d.links.map(cloneLink) };
}

/** SIGN IN WITH X: an X link read back from the vault, every field shaped, or the record is refused as unreadable */
function readXLink(r: Record<string, unknown>): XAccountLink {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (typeof r.xid !== "string" || !/^[0-9]{1,20}$/.test(r.xid) || typeof r.username !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(r.username) || typeof r.personaId !== "string")
    throw new Error("vault: accountLinks holds an X link this device cannot read — refusing rather than guessing");
  return {
    kind: "x",
    xid: r.xid,
    username: r.username,
    name: str(r.name),
    pfpUrl: str(r.pfpUrl),
    verified: r.verified === true,
    verifiedType: str(r.verifiedType),
    personaId: r.personaId,
    verifiedAt: Number.isFinite(r.verifiedAt) ? (r.verifiedAt as number) : 0,
    disconnectedAt: Number.isFinite(r.disconnectedAt) ? (r.disconnectedAt as number) : null,
  };
}

/** a link read back from the vault: every field shaped, or the record is refused as unreadable */
function readLink(raw: unknown): AnyAccountLink {
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (r && typeof r === "object" && r.kind === "x") return readXLink(r);
  if (!r || typeof r !== "object" || r.kind !== "farcaster" || !Number.isSafeInteger(r.fid) || (r.fid as number) <= 0 || typeof r.personaId !== "string")
    throw new Error("vault: accountLinks holds a link this device cannot read — refusing rather than guessing");
  return {
    kind: "farcaster",
    fid: r.fid as number,
    fname: str(r.fname),
    displayName: str(r.displayName),
    pfpUrl: str(r.pfpUrl),
    bio: str(r.bio),
    personaId: r.personaId as string,
    authMethod: r.authMethod === "authAddress" ? "authAddress" : "custody",
    signer: str(r.signer) ?? "",
    nonceHash: str(r.nonceHash) ?? "",
    messageHash: str(r.messageHash) ?? "",
    verifiedAt: Number.isFinite(r.verifiedAt) ? (r.verifiedAt as number) : 0,
    verifier: { rpcHost: str((r.verifier as { rpcHost?: unknown } | undefined)?.rpcHost) ?? "" },
    disconnectedAt: Number.isFinite(r.disconnectedAt) ? (r.disconnectedAt as number) : null,
  };
}

async function loadStrict(): Promise<Loaded> {
  if (g.__layersAccountLinks) return g.__layersAccountLinks;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(ACCOUNT_LINKS_NS);
      let loaded: Loaded = { doc: { v: 1, links: [] }, present: false };
      if (res.status === 404) {
        // the validator answers a missing namespace with 200 {entries:{}}; a 404 is a proxy, a wrong address or a lost
        // table: "never sealed" only if this device never sealed it
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(ACCOUNT_LINKS_NS))
          throw new Error("vault: accountLinks answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(ACCOUNT_LINKS_NS, entries); // throws on the wrong key: loud
          const rec = plain["_"] as { m?: { v?: unknown; links?: unknown } } | undefined;
          if (!rec || !rec.m || rec.m.v !== 1 || !Array.isArray(rec.m.links))
            throw new Error(
              "vault: accountLinks holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
            );
          const read = rec.m.links.map(readLink);
          // SIGN IN WITH X: at most one link of each kind (one Farcaster account and one X account per identity)
          if (read.filter(isFc).length > 1 || read.filter(isX).length > 1 || read.length > 2)
            throw new Error("vault: accountLinks holds more than one link of a kind (Totem keeps one Farcaster account and one X account per identity) — refusing");
          loaded = { doc: { v: 1, links: canonical(read) }, present: true };
        } else {
          const { wasEverSealed } = await import("@/lib/vault/sealedPins");
          if (wasEverSealed(ACCOUNT_LINKS_NS))
            throw new Error("vault: accountLinks is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersAccountLinks = loaded;
      return loaded;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("your linked accounts could not be read (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating them as none");
}

/** a link trimmed so the WHOLE document always fits one padded record: caps first, then the optional display fields
 *  are dropped in a fixed order (bio, picture, display name) until it fits. Deterministic. */
export function fitLink(link: AccountLink): AccountLink {
  const cap = (s: string | null, n: number) => (s === null ? null : s.length > n ? s.slice(0, n) : s);
  const l: AccountLink = {
    ...link,
    fname: link.fname && link.fname.length <= 64 ? link.fname : null,
    displayName: cap(link.displayName, 64),
    pfpUrl: link.pfpUrl && link.pfpUrl.length <= 256 && /^https:\/\//.test(link.pfpUrl) ? link.pfpUrl : null,
    bio: cap(link.bio, 160),
    verifier: { rpcHost: link.verifier.rpcHost.slice(0, 64) },
  };
  const fits = (x: AccountLink) => utf8Bytes(JSON.stringify({ v: 1, links: [x] })) <= MAX_DOC_BYTES;
  if (fits(l)) return l;
  l.bio = null;
  if (fits(l)) return l;
  l.pfpUrl = null;
  if (fits(l)) return l;
  l.displayName = null;
  if (fits(l)) return l;
  throw new Error("internal: an accountLinks record cannot be fitted to one padded record");
}

/** SIGN IN WITH X: the links in their fixed order (Farcaster first, then X): the same document always seals the same way */
function canonical(links: AnyAccountLink[]): AnyAccountLink[] {
  return [...links.filter(isFc), ...links.filter(isX)];
}

/** SIGN IN WITH X: an X link capped field by field (the fixed caps; the document-level fit is fitDoc's) */
export function capXLink(link: XAccountLink): XAccountLink {
  return {
    ...link,
    name: link.name === null ? null : link.name.slice(0, 50),
    pfpUrl: link.pfpUrl && link.pfpUrl.length <= 200 && /^https:\/\//.test(link.pfpUrl) ? link.pfpUrl : null,
    verifiedType: link.verifiedType && /^[a-z_]{1,16}$/.test(link.verifiedType) ? link.verifiedType : null,
  };
}

/**
 * SIGN IN WITH X: the WHOLE document fitted to one padded record. Each link is capped first (a Farcaster link exactly as
 * fitLink fits it alone); while the pair is still too long, optional display fields go in a FIXED order: the Farcaster
 * bio, the X name, the Farcaster picture, the X picture, the Farcaster display name (with today's caps the worst-case pair
 * fits after the fourth: scripts/unit-x-signin.mjs X10; the fifth is the net under a future field). The account ids,
 * usernames, persona ids and times are never dropped. Deterministic.
 */
export function fitDoc(doc: AccountLinksDoc): AccountLinksDoc {
  const links = canonical(doc.links).map((l) => (isFc(l) ? fitLink(l) : capXLink(l)));
  const fits = () => utf8Bytes(JSON.stringify({ v: 1, links })) <= MAX_DOC_BYTES;
  if (fits()) return { v: 1, links };
  const fc = links.find(isFc) ?? null;
  const x = links.find(isX) ?? null;
  const steps: Array<() => void> = [
    () => fc && (fc.bio = null),
    () => x && (x.name = null),
    () => fc && (fc.pfpUrl = null),
    () => x && (x.pfpUrl = null),
    () => fc && (fc.displayName = null),
  ];
  for (const step of steps) {
    step();
    if (fits()) return { v: 1, links };
  }
  throw new Error("internal: an accountLinks document cannot be fitted to one padded record");
}

/** the sealed entries for `doc`: one record "_" whose ciphertext is EXACTLY ACCOUNT_LINKS_BYTES long (pure + the key) */
export function sealAccountLinksDoc(doc: AccountLinksDoc): Record<string, unknown> {
  const inner = JSON.stringify(doc);
  const pad = PLAINTEXT_BYTES - WRAPPER_BYTES - utf8Bytes(inner);
  if (pad < 0) throw new Error("internal: the accountLinks document is larger than one padded record");
  return encryptNamespace(ACCOUNT_LINKS_NS, { _: { m: doc, pad: " ".repeat(pad) } });
}

async function save(doc: AccountLinksDoc): Promise<void> {
  if (g.__layersAccountLinks && doc === g.__layersAccountLinks.doc) throw new Error("internal: accountLinks save() was handed the cached document — build a new one");
  if (!g.__layersAccountLinks) throw new Error("internal: accountLinks save() before any successful load — a seal must build on the document the validator holds");
  const sealed = sealAccountLinksDoc(doc);
  await flushVault(NS, sealed);
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(ACCOUNT_LINKS_NS);
  g.__layersAccountLinks = { doc, present: true };
}

function withLinksWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__layersAccountLinksWrite ?? Promise.resolve()).then(fn, fn);
  g.__layersAccountLinksWrite = run.catch(() => undefined);
  return run;
}

/**
 * Apply `mutate` to the document the validator holds and seal the result. The mutator may throw to refuse (nothing
 * is sealed). A refused seal (a 409 means a newer copy exists) re-reads FIRST and applies the change again to that
 * copy, once; any other failure is loud. Returns the sealed document.
 */
export function updateAccountLinks(mutate: (doc: AccountLinksDoc) => AccountLinksDoc): Promise<AccountLinksDoc> {
  return withLinksWrite(async () => {
    const attempt = async () => {
      const next = mutate(cloneDoc((await loadStrict()).doc));
      if (next.links.filter(isFc).length > 1) throw new Error("internal: Totem keeps one Farcaster account per identity");
      if (next.links.filter(isX).length > 1) throw new Error("internal: Totem keeps one X account per identity");
      if (next.links.some((l) => !isFc(l) && !isX(l))) throw new Error("internal: an accountLinks link of an unknown kind");
      const fitted: AccountLinksDoc = fitDoc(next);
      await save(fitted);
      return fitted;
    };
    try {
      return await attempt();
    } catch (e) {
      if (!/HTTP 409\b/.test(String((e as Error)?.message ?? ""))) throw e;
      g.__layersAccountLinks = null; // a newer copy is on the validator: read it, never seal over it
      return attempt();
    }
  });
}

/** the visitor's one Farcaster link (live or tombstoned), or null when there is none. THROWS when it cannot be read.
 *  SIGN IN WITH X: the Farcaster link only, whatever else the record holds (every caller means Farcaster). */
export async function mainLink(): Promise<AccountLink | null> {
  const { doc } = await loadStrict();
  const fc = doc.links.find(isFc) ?? null;
  return fc ? cloneLink(fc) : null;
}

/** SIGN IN WITH X: the visitor's one X link (live or tombstoned), or null when there is none. THROWS when it cannot be read. */
export async function xLink(): Promise<XAccountLink | null> {
  const { doc } = await loadStrict();
  const x = doc.links.find(isX) ?? null;
  return x ? cloneLink(x) : null;
}

/** SIGN IN WITH X: both, from ONE read of the record (never one read per kind: the two answers describe one document) */
export async function rootLinks(): Promise<{ farcaster: AccountLink | null; x: XAccountLink | null }> {
  const { doc } = await loadStrict();
  const fc = doc.links.find(isFc) ?? null;
  const x = doc.links.find(isX) ?? null;
  return { farcaster: fc ? cloneLink(fc) : null, x: x ? cloneLink(x) : null };
}

/**
 * UNIFORM PRESENCE (D-SIWF-2): seal the empty record for a root that has never sealed it, so every device's vault
 * holds one padded accountLinks record whether or not it ever signs in. A no-op when the namespace is present.
 * THROWS when the namespace cannot be read (the caller decides whether that may stop it; boot logs and goes on).
 */
export function ensureAccountLinksNamespace(): Promise<"sealed" | "present"> {
  return withLinksWrite(async () => {
    const loaded = await loadStrict();
    if (loaded.present) return "present" as const;
    await save({ v: 1, links: [] });
    return "sealed" as const;
  });
}

/**
 * The public self's facts for its profile (ProfileView.seeded.publicSelf): its fname, when it was verified and
 * whether it is disconnected. NEVER the fid. null for any persona that is not this device's publicSelf persona (no
 * vault read at all for them). THROWS when a publicSelf persona's link cannot be read.
 */
export async function publicSelfFacts(
  personaId: string
): Promise<{ fname: string; verifiedAt: number; disconnected: boolean; xShown?: string; via?: "x"; x?: { username: string; disconnected: boolean } } | null> {
  let persona: { publicSelf?: boolean; handle: string; xShown?: string | null } | null = null;
  try {
    const { getPersona } = await import("@/lib/identity/keystore");
    persona = getPersona(personaId);
  } catch {
    persona = null; // no keystore in this process (a public server): no public self can exist here
  }
  if (!persona || persona.publicSelf !== true) return null;
  // SIGN IN WITH X: one read of the record for both accounts
  const { farcaster: link, x } = await rootLinks();
  const ownX = x && x.personaId === personaId ? { x: { username: x.username, disconnected: x.disconnectedAt !== null } } : {};
  if (!link || link.personaId !== personaId) {
    // SIGN IN WITH X: a root that signed in with X only — its public self is the X account's (fname is Totem's own handle)
    if (!x || x.personaId !== personaId) return null;
    const shown = typeof persona.xShown === "string" && persona.xShown ? { xShown: persona.xShown } : {};
    return { fname: persona.handle, verifiedAt: x.verifiedAt, disconnected: x.disconnectedAt !== null, via: "x", ...shown, ...ownX };
  }
  // PUBLIC GO-LIVE (This is you): the X account its Farcaster account verifies, when the owner chose Show
  const xShown = typeof persona.xShown === "string" && persona.xShown ? { xShown: persona.xShown } : {};
  return { fname: link.fname ?? persona.handle, verifiedAt: link.verifiedAt, disconnected: link.disconnectedAt !== null, ...xShown, ...ownX };
}

/** resetSeed and reloadIdentity: forget the cached document (a different root, or a wiped validator) */
export function resetAccountLinksCache(): void {
  g.__layersAccountLinks = null;
}
