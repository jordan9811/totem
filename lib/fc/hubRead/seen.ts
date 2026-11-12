import "server-only";
// NOTIFICATIONS FROM FARCASTER — WHEN THE ROOT LAST SAW THEM: the fcNotifications namespace, one opaque sealed record.
//
// WHAT IT HOLDS: ONE record (key "_") sealed under the vault key, padded so its ciphertext is EXACTLY NOTIF_SEEN_BYTES
// (256) long whatever it holds: {v: 1, fid: the root's Farcaster account | null, seenAt: epoch ms | null}. The unread
// badge counts the notifications newer than seenAt; viewing the page moves it forward (never back). It is the root's
// own record: written only while no persona acts (the op's admission refuses otherwise), and a record for another fid
// (the visitor signed in with a different Farcaster account) reads as "never seen".
//
// WHY THE VAULT (not localStorage, not a server row): the time someone last looked at their notifications is behaviour,
// so it is never plaintext at rest anywhere. The validator holds ciphertext of a fixed size; what it can see is that
// this root's record was rewritten at a time (SECURITY-POSTURE.md §37 A-NOTIF-SEEN-WRITE-TIMING). Sealed per root, so
// "seen" on one of the root's devices is seen on all of them (after a reload; a tab reads it once).
//
// UNIFORM PRESENCE: lib/device/boot.ts seals the EMPTY record for every root that never sealed it
// (ensureNotifSeenNamespace), so the namespace's existence and size say nothing about who uses notifications.
//
// THE accountLinks DISCIPLINE, rule for rule (never fail open): loadStrict reads with retries; a non-OK answer, an
// unreadable record, or an EMPTY/404 namespace this device sealed before (lib/vault/sealedPins.ts) THROWS (the badge then
// says it cannot tell, never 0); only a read document (or one this process sealed) is cached; writes run one at a time on
// top of loadStrict(); a 409 re-reads FIRST.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";

export const NOTIF_SEEN_NS = "fcNotifications";
export const NOTIF_SEEN_BYTES = 256;
const PLAINTEXT_BYTES = NOTIF_SEEN_BYTES - 16;
const WRAPPER_BYTES = 15;

export interface NotifSeenDoc {
  v: 1;
  fid: number | null;
  seenAt: number | null;
}
interface Loaded {
  doc: NotifSeenDoc;
  present: boolean;
}
const g = globalThis as unknown as { __layersNotifSeen?: Loaded | null; __layersNotifSeenWrite?: Promise<unknown> };
const NS = NOTIF_SEEN_NS as Parameters<typeof flushVault>[0];
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const okNum = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function readDoc(raw: unknown): NotifSeenDoc {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1 || !("seenAt" in r)) throw new Error("vault: fcNotifications holds a record this device cannot read — refusing rather than guessing");
  return { v: 1, fid: okNum(r.fid) ? r.fid : null, seenAt: okNum(r.seenAt) ? r.seenAt : null };
}

async function loadStrict(): Promise<Loaded> {
  if (g.__layersNotifSeen) return g.__layersNotifSeen;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(NOTIF_SEEN_NS);
      let loaded: Loaded = { doc: { v: 1, fid: null, seenAt: null }, present: false };
      const { wasEverSealed } = await import("@/lib/vault/sealedPins");
      if (res.status === 404) {
        if (wasEverSealed(NOTIF_SEEN_NS)) throw new Error("vault: fcNotifications answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(NOTIF_SEEN_NS, entries);
          const rec = plain["_"] as { m?: unknown } | undefined;
          if (!rec || !rec.m) throw new Error("vault: fcNotifications holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one");
          loaded = { doc: readDoc(rec.m), present: true };
        } else if (wasEverSealed(NOTIF_SEEN_NS)) {
          throw new Error("vault: fcNotifications is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersNotifSeen = loaded;
      return loaded;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("when you last saw your notifications could not be read (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating it as never");
}

/** the sealed entries for `doc`: one record "_" whose ciphertext is EXACTLY NOTIF_SEEN_BYTES long */
export function sealNotifSeenDoc(doc: NotifSeenDoc): Record<string, unknown> {
  const inner = JSON.stringify({ v: 1, fid: doc.fid, seenAt: doc.seenAt });
  const pad = PLAINTEXT_BYTES - WRAPPER_BYTES - utf8Bytes(inner);
  if (pad < 0) throw new Error("internal: the fcNotifications document is larger than one padded record");
  return encryptNamespace(NOTIF_SEEN_NS, { _: { m: JSON.parse(inner), pad: " ".repeat(pad) } });
}

async function save(doc: NotifSeenDoc): Promise<void> {
  if (!g.__layersNotifSeen) throw new Error("internal: fcNotifications save() before any successful load");
  await flushVault(NS, sealNotifSeenDoc(doc));
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(NOTIF_SEEN_NS);
  g.__layersNotifSeen = { doc, present: true };
}
function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__layersNotifSeenWrite ?? Promise.resolve()).then(fn, fn);
  g.__layersNotifSeenWrite = run.catch(() => undefined);
  return run;
}

/** when `fid`'s notifications were last seen (null: never, or the record is another account's). THROWS when unreadable. */
export async function notifSeenAt(fid: number): Promise<number | null> {
  const { doc } = await loadStrict();
  return doc.fid === fid ? doc.seenAt : null;
}

/** move `fid`'s seen time forward to `at` (never back: a later time already recorded wins). Writes nothing when nothing
 *  changes. Returns the seen time now recorded. THROWS when the record cannot be read or written, or when `guard` throws
 *  (asked right before the write: a persona chosen meanwhile stops it). */
export function markNotifSeen(fid: number, at: number, guard: () => Promise<void> = async () => {}): Promise<number | null> {
  return withWrite(async () => {
    const attempt = async () => {
      const cur = (await loadStrict()).doc;
      const prev = cur.fid === fid ? cur.seenAt : null;
      if (prev !== null && prev >= at) return prev;
      await guard();
      await save({ v: 1, fid, seenAt: at });
      return at;
    };
    try {
      return await attempt();
    } catch (e) {
      if (!/HTTP 409\b/.test(String((e as Error)?.message ?? ""))) throw e;
      g.__layersNotifSeen = null;
      return attempt();
    }
  });
}

/** UNIFORM PRESENCE: seal the empty record for a root that never sealed it (boot). THROWS when it cannot be read. */
export function ensureNotifSeenNamespace(): Promise<"sealed" | "present"> {
  return withWrite(async () => {
    const loaded = await loadStrict();
    if (loaded.present) return "present" as const;
    await save({ v: 1, fid: null, seenAt: null });
    return "sealed" as const;
  });
}

/** reloadIdentity / resetSeed: forget the cached document (a different root, or a wiped validator) */
export function resetNotifSeenCache(): void {
  g.__layersNotifSeen = null;
}
