import "server-only";
import { validatorUrl } from "@/lib/ports";
// ZK PASS 2 Gate 2 — THE DEVICE-SIDE ROOT ROSTER.
//
// After migration 006 the validator has no table that groups personas by
// root or by account. The knowledge "these personas are mine" lives where
// it always should have: on the device. Three sources feed it —
//   • the keystore (personas this device minted) via lib/identity/ownership,
//   • THE FIXTURE EXPORT (.keystore/fixture-roster.json): the one-time
//     pre-006 export (validator/export-roster.js) — the last time the
//     validator answered persona → root. In fixture mode this device IS
//     every fixture account's device, exactly as seed/data/accounts.json
//     already makes it; in production each device exports only its own.
//   • THE VAULT ROSTER: personas created through the signer flow
//     (`POST /api/personas` for a signer-registered root) — recorded here
//     at creation, keyed by the root the session resolved, plus the
//     root's fid so "my own casts" resolve without asking the validator
//     who owns a fid.
//
// STORAGE of the vault roster: a vault namespace (`rootRoster`) stored as
// ONE opaque sealed record — the vault seals values, not addresses
// (attack-1 finding 1), and the addresses here would be root ids. The
// validator stores the ciphertext; it cannot read which root has which
// personas, and a wiped namespace makes the roster EMPTY, never wrong
// (fail closed: a persona that cannot be attributed to a root is simply
// not listed for it).
//
// REVIEW WE-2 — THE WRITE PATH FAILS CLOSED. A write re-seals the WHOLE namespace (flushVault replaces it), so a
// document built on a read that failed — a validator restart, 429s past the retries, a non-OK answer, an unreadable
// record — sealed a near-empty roster over the real one: every root's persona list and display records gone, and the
// empty document stayed cached for the process, so every later record sealed over it again. Now:
//   - recordRoot / recordPersona build on loadStrict(): retried, and a non-OK answer, an unreadable namespace, or an
//     EMPTY one this device has sealed before (lib/vault/sealedPins.ts) is a REFUSAL — the write throws, nothing is
//     sealed. A 404, or an empty namespace never sealed here, is genuinely empty.
//   - only a document READ from the validator (or one this process sealed) is cached; a seal adopts the cache only
//     after the flush succeeds, and pins the namespace (markEverSealed).
//   - the stored display records (`personas`) are carried through a load — the old load dropped them, so every write
//     after a restart sealed a document holding only the newest persona's record.
//   - READS keep their documented answer to an unreadable roster — EMPTY for that call (a persona that cannot be
//     attributed to a root is not listed for it; fail closed for attribution) — but it is never cached: the next
//     read asks again, and no write can be built on it.
//
// REVIEW WORLD-ID-2 / F4 — THE SERVICE'S OWN ROOT (LAYERS_WORLD=empty). The pre-flag create and fork routes filed a
// new persona under rootForFid(getSelf().fid), and getSelf().fid is still the seed self's 9152: the fixture export
// maps it to the seeded self's root, so every real persona carried the demo account's seeded reputation (tier 10)
// and accrued on its root. Under the flag the device's roots are the ones it REGISTERED itself: ownRootId() registers
// this device's own root under its anchor-derived pseudo-fid (the way lib/device/boot.ts and lib/zk/registration.ts
// ensureOwnRoot do — the same row, found by the same fid), real personas are filed under it, and a persona the device
// holds that was filed only under a fixture root (a pre-flag fork) or nowhere (a create whose roster write failed)
// is re-filed there on the first load that knows the root (migrateFixtureFilings). The fixture filing is not removed:
// the demo world reads it again when the flag is unset.
import { storage } from "@/lib/platform/storage";
import path from "node:path";
import { deviceAuthPublicKey, keystoreDir } from "@/lib/identity/keystore";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { isEmptyWorld } from "@/lib/world-flag";
import { realPersonaIds } from "@/lib/world";

const NS = "rootRoster";
const VBASE = validatorUrl();

export interface RosterPersona {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: number;
  /** PERSONA LAUNCH P1 (SIWF): the persona is the visitor's own Farcaster account (read-only public self). recordPersona
   *  stores the record as given; any reader that whitelists fields must keep this one. */
  publicSelf?: boolean;
  /** PERSONA LAUNCH P3 (anon's diff): the persona's post mode, stored as given (see lib/identity/postMode.ts) */
  postMode?: import("./keystore").PostMode;
}
export interface RosterDoc {
  /** rootId -> persona ids, in creation order */
  roots: Record<string, string[]>;
  /** fid -> rootId (the signer flow registers both at once) */
  fids: Record<string, string>;
  /** Gate 4 (attack-z2-1 #1): the display record of every persona this
   * device created, so listing its own personas never asks the validator
   * for them by id (a per-render roster enumeration) */
  personas?: Record<string, RosterPersona>;
}

const g = globalThis as unknown as {
  /** only a document READ from the validator, or one this process sealed — never the empty stand-in of a failed read */
  __layersRootRoster?: RosterDoc | null;
  __layersFixtureRoster?: RosterDoc | null;
  __layersRootRosterReadWarned?: boolean;
  /** review WORLD-ID-2: what the filing migration has run for in this process — the own root AND the real personas it
   *  saw (migrationKey), so a persona minted later in this process (a fork) is filed by the next read that sees it */
  __layersRootRosterMigrated?: string | null;
  __layersRootRosterMigrateFailedAt?: number;
  /** review WORLD-ID-2: the last background own-root registration attempt (ensureOwnRootSoon) */
  __layersOwnRootAttemptAt?: number;
  __layersOwnRootWarned?: boolean;
  /** one writer at a time: every seal builds on the document the previous seal left (loadStrict's cache) */
  __layersRootRosterWrite?: Promise<unknown>;
};

/** DELIBERATE DUPLICATE of lib/zk/registration.ts pseudoFidOfAnchor (and lib/device/boot.ts pseudoFid, validator/
 * server.js POST /roots): the NEGATIVE fid a root with no network identity is registered under, derived from its
 * device-auth anchor. Kept here so the roster never imports the ZK module (which imports the roster). */
function pseudoFidOfAnchor(anchorPubHex: string): number {
  return -((parseInt(anchorPubHex.slice(0, 8), 16) % 2147483646) + 1);
}

/** this device's own pseudo-fid, or null when this process holds no device identity (no keystore to derive from) */
function ownPseudoFid(): number | null {
  try {
    return pseudoFidOfAnchor(deviceAuthPublicKey());
  } catch {
    return null;
  }
}

/** writes run one at a time (review WORLD-ID-2): a create's display record and the background migration must not
 *  build on the same cached document and seal each other's additions away */
function withRosterWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__layersRootRosterWrite ?? Promise.resolve()).then(fn, fn);
  g.__layersRootRosterWrite = run.catch(() => undefined);
  return run;
}

/** Where the pre-006 export lives on this device (gitignored). */
export function fixtureRosterPath(): string {
  return path.join(keystoreDir(), "fixture-roster.json");
}

function fixture(): RosterDoc {
  if (g.__layersFixtureRoster) return g.__layersFixtureRoster;
  let doc: RosterDoc = { roots: {}, fids: {} };
  try {
    const f = fixtureRosterPath();
    if (storage.exists(f)) {
      const j = JSON.parse(storage.readText(f)) as Partial<RosterDoc>;
      doc = { roots: j.roots ?? {}, fids: j.fids ?? {} };
    }
  } catch {
    /* unreadable export: an EMPTY fixture layer, never a wrong one */
  }
  g.__layersFixtureRoster = doc;
  return doc;
}

/** A root of the fixture export — the seeded demo world's (fid 9152 → the seeded self's root, carrying its seeded
 *  reputation). Under LAYERS_WORLD=empty such a root is never one of this device's (review WORLD-ID-2 / F4). */
export function isFixtureRoot(rootId: string): boolean {
  const f = fixture();
  return Object.prototype.hasOwnProperty.call(f.roots, rootId) || Object.values(f.fids).includes(rootId);
}

/** The vault roster, read FAIL CLOSED (review WE-2; the personaChrome / readwise pattern). Throws rather than answer
 *  a read it could not make; caches only what it read. */
async function loadStrict(): Promise<RosterDoc> {
  if (g.__layersRootRoster) return g.__layersRootRoster;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(NS);
      let doc: RosterDoc = { roots: {}, fids: {} };
      if (res.status === 404) {
        // the validator answers a MISSING namespace with 200 {entries:{}} (never 404), so a 404 is a proxy, a wrong
        // address or a validator that lost the table — "never sealed" only if this device never sealed it; otherwise
        // the same deleted-namespace refusal as an empty answer (lib/attest/vault.ts reads its 404 the same way)
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(NS))
          throw new Error("vault: rootRoster answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(NS, entries); // throws on the wrong key: loud, never empty-as-success
          const rec = plain["_"] as { m?: RosterDoc } | undefined;
          // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
          // namespace whose records are all unreadable — deleted, truncated, plaintext, or
          // sealed under a different key — became an EMPTY document marked loaded, and the next
          // write sealed that emptiness over the real record. Records present with none readable
          // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
          if (!rec)
            throw new Error(
              "vault: rootRoster holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
            );
          if (rec.m && typeof rec.m === "object")
            doc = { roots: rec.m.roots ?? {}, fids: rec.m.fids ?? {}, ...(rec.m.personas && typeof rec.m.personas === "object" ? { personas: rec.m.personas } : {}) };
        } else {
          // an EMPTY namespace is benign only if this device never sealed it — the validator answers a deleted one
          // the same way (lib/vault/sealedPins.ts)
          const { wasEverSealed } = await import("@/lib/vault/sealedPins");
          if (wasEverSealed(NS))
            throw new Error("vault: rootRoster is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersRootRoster = doc;
      g.__layersRootRosterReadWarned = false;
      return doc;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("root roster unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault roster as empty");
}

/** READS: an unreadable roster answers EMPTY for this call (attribution fails closed — nothing is listed for a root it
 *  cannot read), never cached, said once in the server log until a read succeeds again */
async function load(): Promise<RosterDoc> {
  try {
    return await loadStrict();
  } catch (e) {
    if (!g.__layersRootRosterReadWarned) {
      g.__layersRootRosterReadWarned = true;
      console.error("[roster] " + (e as Error).message + " — reads answer an empty roster until it can be read; writes are refused");
    }
    return { roots: {}, fids: {} };
  }
}

function cloneDoc(d: RosterDoc): RosterDoc {
  return {
    roots: Object.fromEntries(Object.entries(d.roots).map(([r, ids]) => [r, [...ids]])),
    fids: { ...d.fids },
    ...(d.personas ? { personas: { ...d.personas } } : {}),
  };
}

/** Seal a NEW document (built from a loadStrict() result, never the cached object). The cache adopts it only once the
 *  flush succeeded, and the namespace is pinned as sealed by this device. */
async function save(doc: RosterDoc): Promise<void> {
  if (doc === g.__layersRootRoster) throw new Error("internal: rootRoster save() was handed the cached document — build a new one");
  // a seal REPLACES the namespace, so it may only follow a document this process READ (or sealed): the empty stand-in
  // of a failed read is never cached, and a writer that skipped loadStrict() is refused here rather than trusted
  if (!g.__layersRootRoster) throw new Error("internal: rootRoster save() before any successful load — a seal must build on the document the validator holds");
  const inner = JSON.stringify(doc);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(NS, { _: { m: doc, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  await flushVault(NS, sealed);
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(NS);
  g.__layersRootRoster = doc;
}

/** fixture layer + vault layer; the vault wins on a fid, lists are unioned in order */
async function merged(): Promise<RosterDoc> {
  const f = fixture();
  let v = await load();
  if (isEmptyWorld()) {
    // review WORLD-ID-2: the first load under the flag that knows this device's own root files the personas the
    // device holds under it (a pre-flag fork sat under the fixture root; see migrateFixtureFilings). A read never
    // throws: a migration that cannot seal is said once and tried again later, and this read answers what it has.
    const ownFid = ownPseudoFid();
    const ownRoot = ownFid === null ? null : v.fids[String(ownFid)] ?? null;
    if (ownRoot && g.__layersRootRosterMigrated !== migrationKey(ownRoot) && Date.now() - (g.__layersRootRosterMigrateFailedAt ?? 0) > 30_000) {
      try {
        await migrateFixtureFilings(ownRoot);
        v = g.__layersRootRoster ?? v;
      } catch (e) {
        g.__layersRootRosterMigrateFailedAt = Date.now();
        console.error("[roster] could not file this device's personas under its own root: " + (e as Error).message + " — tried again on a later read");
      }
    }
    // LAYERS_WORLD=empty (review WORLD-ID-2): this device's roots are the ones it REGISTERED (recordRoot, the signer
    // flow — the vault's fids). The fixture export is the seeded demo world's (fid 9152 → the seeded self's root and
    // its seeded reputation), and a vault list filed under a fixture root (a pre-flag fork recorded there) is bank
    // too: a real persona must never resolve to the seeded self's root, its tier or its accrual. Nothing is deleted —
    // the vault document keeps every list, and the demo world reads them again when the flag is unset.
    const fixtureRoots = new Set([...Object.keys(f.roots), ...Object.values(f.fids)]);
    const own = new Set(Object.values(v.fids).filter((r) => !fixtureRoots.has(r)));
    const roots: Record<string, string[]> = {};
    for (const [r, ids] of Object.entries(v.roots)) if (own.has(r)) roots[r] = [...ids];
    const fids: Record<string, string> = {};
    for (const [fid, r] of Object.entries(v.fids)) if (own.has(r)) fids[fid] = r;
    return { roots, fids };
  }
  const roots: Record<string, string[]> = {};
  for (const [r, ids] of Object.entries(f.roots)) roots[r] = [...ids];
  for (const [r, ids] of Object.entries(v.roots)) {
    const list = (roots[r] ??= []);
    for (const id of ids) if (!list.includes(id)) list.push(id);
  }
  return { roots, fids: { ...f.fids, ...v.fids } };
}

export function recordRoot(rootId: string, fid: number): Promise<void> {
  return withRosterWrite(async () => {
    const doc = cloneDoc(await loadStrict());
    doc.fids[String(fid)] = rootId;
    doc.roots[rootId] ??= [];
    await save(doc);
  });
}

export function recordPersona(rootId: string, personaId: string, record?: RosterPersona): Promise<void> {
  return withRosterWrite(async () => {
    const doc = cloneDoc(await loadStrict());
    const list = (doc.roots[rootId] ??= []);
    if (!list.includes(personaId)) list.push(personaId);
    if (record) (doc.personas ??= {})[personaId] = record;
    await save(doc);
  });
}

/**
 * review WORLD-ID-2: FILE EVERY REAL PERSONA UNDER THE OWN ROOT, once per process under the flag. A persona this
 * device's keystore minted before the flag was recorded under the seeded self's fixture root (rootForFid(9152) was
 * the only root the pre-flag create and fork routes knew), and merged() drops that filing under the flag — so the
 * owner's existing forked persona resolved to no root at all. One minted while the roster was unreadable (a refused
 * create, finished on retry) may be recorded nowhere. Both are filed under the own root here. Nothing is removed:
 * the vault keeps the fixture filing, and the demo world reads it again when the flag is unset (there the fixture
 * root still answers first). Idempotent; a changed document is sealed once. FAIL CLOSED: an unreadable roster
 * throws, and nothing is sealed on a guess. "Once" is per (own root, real-persona set): a persona the keystore
 * mints later in this process — a fork, whose route files it by its own path — is filed by the next read that sees
 * the set change, not left until the next restart.
 */
function migrationKey(ownRoot: string): string {
  return ownRoot + "\n" + [...realPersonaIds()].sort().join(",");
}

function migrateFixtureFilings(ownRoot: string): Promise<void> {
  const key = migrationKey(ownRoot);
  if (g.__layersRootRosterMigrated === key) return Promise.resolve();
  return withRosterWrite(async () => {
    if (g.__layersRootRosterMigrated === key) return;
    const doc = cloneDoc(await loadStrict());
    const list = (doc.roots[ownRoot] ??= []);
    let changed = false;
    for (const id of realPersonaIds()) {
      if (list.includes(id)) continue;
      list.push(id);
      changed = true;
    }
    if (changed) await save(doc);
    g.__layersRootRosterMigrated = key;
  });
}

/**
 * THE SERVICE'S OWN ROOT (review WORLD-ID-2 / F4): the root this device registered on the validator under its
 * anchor-derived pseudo-fid over the signed envelope (the validator binds the row to the signing anchor and checks
 * the fid against it), recorded in the vault roster by that fid. It is the root the ZK registration addresses
 * (lib/zk/registration.ts ensureOwnRoot resolves the same row through rootForFid) and, under LAYERS_WORLD=empty,
 * the root every real persona is filed under — never the seeded self's fixture root. Registered on first need;
 * idempotent (the validator answers the existing row for the same signer id). FAIL CLOSED: a roster that cannot be
 * read throws before anything is registered or sealed, and so does a refused registration. SERVER-INTERNAL: a root
 * id never reaches a client (the root-leak grep).
 */
export async function ownRootId(): Promise<string> {
  const anchor = deviceAuthPublicKey();
  const fid = pseudoFidOfAnchor(anchor);
  let rootId: string | null = (await loadStrict()).fids[String(fid)] ?? null;
  if (!rootId) {
    const { registerRoot } = await import("@/lib/validator");
    rootId = await registerRoot(fid, "device:" + anchor);
    if (!rootId)
      throw new Error("the validator refused to register this device's own root (a device root needs the signed envelope — LAYERS_REQUIRE_SIG=true on both sides — and a reachable validator)");
    await recordRoot(rootId, fid);
  }
  if (isEmptyWorld()) await migrateFixtureFilings(rootId);
  return rootId;
}

/**
 * review WORLD-ID-2 ("migrate on first load"): register the own root and file the device's personas under it in the
 * background, once per process (a failure is said once and retried a minute later) — called from the session under
 * the flag, so the owner's pre-flag fork is filed on the first request after the deploy rather than at the next
 * create. Never blocks or fails the caller: a session lists the keystore's personas whether or not the roster could
 * be sealed, and the create and fork routes call ownRootId() themselves, loudly.
 */
export function ensureOwnRootSoon(): void {
  if (!isEmptyWorld()) return;
  const now = Date.now();
  if (now - (g.__layersOwnRootAttemptAt ?? 0) < 60_000) return;
  g.__layersOwnRootAttemptAt = now;
  void ownRootId().then(
    () => {
      g.__layersOwnRootWarned = false;
    },
    (e: unknown) => {
      if (g.__layersOwnRootWarned) return;
      g.__layersOwnRootWarned = true;
      console.error("[roster] this device's own root is not registered yet: " + (e as Error).message + " — the first create or fork registers it");
    }
  );
}

/** the device-held display record of one of its own personas, if recorded */
export async function personaRecord(personaId: string): Promise<RosterPersona | null> {
  return (await load()).personas?.[personaId] ?? null;
}

export async function personaIdsForRoot(rootId: string): Promise<string[]> {
  return [...((await merged()).roots[rootId] ?? [])];
}

export async function rootForFid(fid: number): Promise<string | null> {
  return (await merged()).fids[String(fid)] ?? null;
}

export async function rootOfPersona(personaId: string): Promise<string | null> {
  const m = await merged();
  for (const [rootId, ids] of Object.entries(m.roots)) if (ids.includes(personaId)) return rootId;
  return null;
}

/** The roster export a migration-006 rollback needs: { personaId: rootId }
 * for every persona this device can attribute (fixture export + vault
 * roster). Root material — DEV ONLY (ZK_DEV_HOOKS), never a product read. */
export async function rosterExport(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const m = await merged();
  for (const [rootId, ids] of Object.entries(m.roots)) for (const id of ids) out[id] = rootId;
  return out;
}

/** Counts only — safe to show an operator. */
export async function rosterStatus(): Promise<{ fixtureFile: boolean; fixtureRoots: number; fixturePersonas: number; vaultRoots: number; vaultPersonas: number }> {
  const f = fixture();
  const v = await load();
  const count = (d: RosterDoc) => Object.values(d.roots).reduce((n, ids) => n + ids.length, 0);
  return {
    fixtureFile: storage.exists(fixtureRosterPath()),
    fixtureRoots: Object.keys(f.roots).length,
    fixturePersonas: count(f),
    vaultRoots: Object.keys(v.roots).length,
    vaultPersonas: count(v),
  };
}

export function resetRootRoster(): void {
  g.__layersRootRoster = null;
  g.__layersFixtureRoster = null;
  g.__layersRootRosterMigrated = null;
  g.__layersRootRosterMigrateFailedAt = 0;
  g.__layersOwnRootAttemptAt = 0;
}
