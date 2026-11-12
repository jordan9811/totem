import "server-only";
// ADS, PHASE 1 — "HIDE THIS AD" AND "HIDE THIS ADVERTISER", KEPT ON THE DEVICE: the adHides namespace, one opaque
// sealed record (docs/roadmap/ad-auction.md §5).
//
// WHAT IT HOLDS: ONE record (key "_") sealed under the vault key, padded so its ciphertext is EXACTLY AD_HIDES_BYTES
// (4,096) long whatever it holds: {v: 1, by: {<identity id>: {lots: [lot ids], advertisers: [advertiser ids]}}}. Each
// identity's lists are its own: the root's hides are read only while the root acts, a persona's only while that persona
// acts (lib/ads/plan.ts keys every read and write by the ACTING identity, and refuses a hide aimed at an ad that was shown
// to another one). An identity with nothing hidden has no entry. At most AD_HIDES_MAX ids across every identity: past
// that a hide is REFUSED with a sentence, never written over an older one.
//
// WHY THE VAULT (not localStorage, not a server row): which ads someone turned away is a preference about what they
// will not look at, and an advertiser id under a persona would say something about that persona. The validator holds
// ciphertext of a fixed size; what it can see is that this root's record was rewritten at a time (SECURITY-POSTURE.md
// §41 A-ADS-HIDE-WRITE-TIMING), never which ad, which advertiser or which identity.
//
// UNIFORM PRESENCE: lib/device/boot.ts seals the EMPTY record for every root that never sealed it
// (ensureAdHidesNamespace), so the namespace's existence and size say nothing about who has hidden an ad.
//
// THE lib/fc/hubRead/seen.ts DISCIPLINE, rule for rule (never fail open): loadStrict reads with retries; a non-OK answer,
// an unreadable record, or an EMPTY/404 namespace this device sealed before (lib/vault/sealedPins.ts) THROWS (the plan
// then shows no ads and says why, never the ads this identity hid); only a read document (or one this process sealed)
// is cached; writes run one at a time on top of loadStrict(); a 409 re-reads FIRST.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";

export const AD_HIDES_NS = "adHides";
export const AD_HIDES_BYTES = 4096;
export const AD_HIDES_MAX = 48;
const PLAINTEXT_BYTES = AD_HIDES_BYTES - 16;
const WRAPPER_BYTES = 15;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const IDENTITY = /^[A-Za-z0-9_:.-]{1,96}$/;

export interface AdHidesEntry {
  lots: string[];
  advertisers: string[];
}
export interface AdHidesDoc {
  v: 1;
  by: Record<string, AdHidesEntry>;
}
interface Loaded {
  doc: AdHidesDoc;
  present: boolean;
}

export class AdHidesFull extends Error {
  constructor() {
    super(`You've hidden as many ads as this device keeps (${AD_HIDES_MAX}). Show some again in Settings, Modes, then hide this one.`);
    this.name = "AdHidesFull";
  }
}

const g = globalThis as unknown as { __layersAdHides?: Loaded | null; __layersAdHidesWrite?: Promise<unknown> };
const NS = AD_HIDES_NS as Parameters<typeof flushVault>[0];
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))] : []);

function readDoc(raw: unknown): AdHidesDoc {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1 || !r.by || typeof r.by !== "object" || Array.isArray(r.by))
    throw new Error("vault: adHides holds a record this device cannot read — refusing rather than guessing");
  const by: Record<string, AdHidesEntry> = {};
  for (const [who, e] of Object.entries(r.by as Record<string, unknown>)) {
    if (!IDENTITY.test(who) || !e || typeof e !== "object") continue;
    const entry = { lots: ids((e as Record<string, unknown>).lots), advertisers: ids((e as Record<string, unknown>).advertisers) };
    if (entry.lots.length || entry.advertisers.length) by[who] = entry;
  }
  return { v: 1, by };
}

async function loadStrict(): Promise<Loaded> {
  if (g.__layersAdHides) return g.__layersAdHides;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(AD_HIDES_NS);
      let loaded: Loaded = { doc: { v: 1, by: {} }, present: false };
      const { wasEverSealed } = await import("@/lib/vault/sealedPins");
      if (res.status === 404) {
        if (wasEverSealed(AD_HIDES_NS)) throw new Error("vault: adHides answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(AD_HIDES_NS, entries);
          const rec = plain["_"] as { m?: unknown } | undefined;
          if (!rec || !rec.m) throw new Error("vault: adHides holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one");
          loaded = { doc: readDoc(rec.m), present: true };
        } else if (wasEverSealed(AD_HIDES_NS)) {
          throw new Error("vault: adHides is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersAdHides = loaded;
      return loaded;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("the ads you've hidden could not be read (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than showing them again");
}

const total = (doc: AdHidesDoc) => Object.values(doc.by).reduce((n, e) => n + e.lots.length + e.advertisers.length, 0);
/** the document still fits one padded record (the id count is the usual limit; long identity ids are the other) */
const fits = (doc: AdHidesDoc) => utf8Bytes(JSON.stringify({ v: 1, by: doc.by })) <= PLAINTEXT_BYTES - WRAPPER_BYTES;

/** the sealed entries for `doc`: one record "_" whose ciphertext is EXACTLY AD_HIDES_BYTES long */
export function sealAdHidesDoc(doc: AdHidesDoc): Record<string, unknown> {
  const inner = JSON.stringify({ v: 1, by: doc.by });
  const pad = PLAINTEXT_BYTES - WRAPPER_BYTES - utf8Bytes(inner);
  if (pad < 0) throw new Error("internal: the adHides document is larger than one padded record");
  return encryptNamespace(AD_HIDES_NS, { _: { m: JSON.parse(inner), pad: " ".repeat(pad) } });
}

async function save(doc: AdHidesDoc): Promise<void> {
  if (!g.__layersAdHides) throw new Error("internal: adHides save() before any successful load");
  await flushVault(NS, sealAdHidesDoc(doc));
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(AD_HIDES_NS);
  g.__layersAdHides = { doc, present: true };
}
function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__layersAdHidesWrite ?? Promise.resolve()).then(fn, fn);
  g.__layersAdHidesWrite = run.catch(() => undefined);
  return run;
}
/** a 409 (another tab of this root wrote first) re-reads, then tries once more */
async function retrying<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!/HTTP 409\b/.test(String((e as Error)?.message ?? ""))) throw e;
    g.__layersAdHides = null;
    return attempt();
  }
}

/** what `identity` hid. THROWS when the record cannot be read (the caller shows no ads, never the hidden ones). */
export async function hiddenFor(identity: string): Promise<{ lots: Set<string>; advertisers: Set<string> }> {
  const { doc } = await loadStrict();
  const e = doc.by[identity];
  return { lots: new Set(e?.lots ?? []), advertisers: new Set(e?.advertisers ?? []) };
}

/** hide one lot, or every lot of one advertiser, for `identity`. Writes nothing when it is already hidden. THROWS when the
 *  record cannot be read or written, when it is full (AdHidesFull), or when `guard` throws (asked right before the
 *  write: an identity switched meanwhile stops it). */
export function hideForIdentity(identity: string, what: "lot" | "advertiser", id: string, guard: () => Promise<void> = async () => {}): Promise<"hidden" | "already"> {
  if (!IDENTITY.test(identity) || !ID.test(id)) return Promise.reject(new Error("internal: not an identity or an ad id"));
  return withWrite(() =>
    retrying(async () => {
      const cur = (await loadStrict()).doc;
      const e = cur.by[identity] ?? { lots: [], advertisers: [] };
      const list = what === "lot" ? e.lots : e.advertisers;
      if (list.includes(id)) return "already" as const;
      if (total(cur) >= AD_HIDES_MAX) throw new AdHidesFull();
      const next: AdHidesEntry = what === "lot" ? { lots: [...e.lots, id], advertisers: e.advertisers } : { lots: e.lots, advertisers: [...e.advertisers, id] };
      const doc: AdHidesDoc = { v: 1, by: { ...cur.by, [identity]: next } };
      if (!fits(doc)) throw new AdHidesFull();
      await guard();
      await save(doc);
      return "hidden" as const;
    })
  );
}

/** show again: one lot or advertiser (`id`), or everything `identity` hid (`id` null). Writes nothing when nothing changes. */
export function unhideForIdentity(identity: string, what: "lot" | "advertiser" | "all", id: string | null, guard: () => Promise<void> = async () => {}): Promise<"shown" | "none"> {
  if (!IDENTITY.test(identity)) return Promise.reject(new Error("internal: not an identity"));
  return withWrite(() =>
    retrying(async () => {
      const cur = (await loadStrict()).doc;
      const e = cur.by[identity];
      if (!e) return "none" as const;
      const next: AdHidesEntry =
        what === "all" ? { lots: [], advertisers: [] } : what === "lot" ? { lots: e.lots.filter((x) => x !== id), advertisers: e.advertisers } : { lots: e.lots, advertisers: e.advertisers.filter((x) => x !== id) };
      if (next.lots.length === e.lots.length && next.advertisers.length === e.advertisers.length) return "none" as const;
      await guard();
      const by = { ...cur.by };
      if (next.lots.length || next.advertisers.length) by[identity] = next;
      else delete by[identity];
      await save({ v: 1, by });
      return "shown" as const;
    })
  );
}

/** UNIFORM PRESENCE: seal the empty record for a root that never sealed it (boot). THROWS when it cannot be read. */
export function ensureAdHidesNamespace(): Promise<"sealed" | "present"> {
  return withWrite(async () => {
    const loaded = await loadStrict();
    if (loaded.present) return "present" as const;
    await save({ v: 1, by: {} });
    return "sealed" as const;
  });
}

/** reloadIdentity / resetSeed: forget the cached document (a different root, or a wiped validator) */
export function resetAdHidesCache(): void {
  g.__layersAdHides = null;
}
