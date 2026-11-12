// PERSONA LAUNCH P4 — YOUR PRIVATE ADDRESSES FOR RINGS (the member side's half of the sealed "rings" document).
//
// An address is what you hand someone who wants to put you in one of their rings: "LR1." + base64url(addrId | X25519
// public key | PSK). Its two secrets come off THIS root's seed (lib/crypto/kdf.ts ringInboxSeed / ringPskSeed, through
// lib/identity/keystore.ts ringInboxMaterial — memory only, never serialized), keyed by a random nonce the sealed
// document keeps; so the 24 words plus the vault recover every address, and nothing secret is stored beside the nonce.
// A LINKED device holds no seed and cannot hold an address in v1 ("open this on the device that holds your identity";
// delivering the material over the link is v1.1).
//
// LP-3 — MAKING AN ADDRESS NEVER WRITES AT THE HANDOVER. The first cut sealed the document the moment you made an
// address, and the owner sealed theirs the moment they added it: two anchors writing "rings" seconds apart, then a drop
// publish — the pairing received.ts exists to avoid. Now:
//   * SPARES: SPARE_ADDRESSES addresses are made AHEAD, inside writes that happen anyway — every device's first-tick
//     write (lib/rings/tick.ts → model.ensureRingsDocWritten(mintSparesInto)) and the deferred upkeep below. A spare is
//     trial-opened on every tick like any address, so it works the moment it is handed out, before anything is written.
//   * "Make a private address" CLAIMS a spare in memory only (model.addPendingClaim) — no request at all. The claim (its
//     name, that it was handed out) rides the next seal of any kind, or the UPKEEP: a write drawn at a uniformly random
//     moment 15 minutes to 3 hours after it is first needed, which also makes new spares. A restart before then loses
//     only the claim's name (the address stays a spare and keeps receiving; it may be offered again).
//   * No spare left → refused in plain words until the upkeep has made more (never a write at the click). A device that
//     has not ticked yet makes its one first write at the click instead of at its first tick (A-RINGS-FIRST-WRITE-AT-
//     CLAIM: the only case where an address and a write coincide, once per device).
//   The owner's addMember still seals at once: what it pairs with was the member's write, which no longer exists.
//
// UX-R4 — HIDE, NEVER DELETE: "Forget it" sets forgottenAt (the address stops being trial-opened and leaves the list;
// what was received through it goes at once), and "Use it again" clears it. At most 32 addresses in use and 64 records.
import { LABEL_MAX, addressString, inboxKeyFrom, plainText, type InboxKey } from "./envelope";
import {
  MAX_ADDRESSES,
  MAX_ADDRESS_RECORDS,
  SPARE_ADDRESSES,
  addPendingClaim,
  ensureRingsDocWritten,
  loadRingsDoc,
  mutateRingsDoc,
  newId16,
  pendingClaims,
  ringsDocUnsealed,
  setUpkeepDueAt,
  skipSeal,
  upkeepDueAt,
  type InboxEntry,
  type RingsDoc,
} from "./model";

export const LINKED_DEVICE_SENTENCE = "Open this on the device that holds your identity — a linked device can't keep a ring address yet.";
export const NO_SPARE_SENTENCE =
  "The addresses this device had ready are all handed out. Another is made in the background within a few hours (so the moment you make one can't be matched to the moment you hand it over); your other addresses keep working meanwhile.";
/** LP-3: the deferred upkeep write lands at a uniformly random moment in this window after it is first needed */
export const UPKEEP_MIN_MS = 15 * 60_000;
export const UPKEEP_MAX_MS = 3 * 3_600_000;

/** the keystore's ring material for one nonce (lib/identity/keystore.ts ringInboxMaterial: off the seed, memory only) */
async function material(nonce: string): Promise<{ ikm: Uint8Array; psk: Uint8Array }> {
  const ks = await import("@/lib/identity/keystore");
  if (ks.isLinkedDevice()) throw new Error(LINKED_DEVICE_SENTENCE);
  try {
    return ks.ringInboxMaterial(nonce);
  } catch (e) {
    if (/LINKED root/i.test((e as Error).message)) throw new Error(LINKED_DEVICE_SENTENCE);
    throw e;
  }
}

/** derived keys, memory only, one per (root, nonce) — forgotten by the reset contract */
const g = globalThis as unknown as { __layersRingInbox?: Map<string, InboxKey> };
const keyCache = (): Map<string, InboxKey> => (g.__layersRingInbox ??= new Map());

async function keyFor(nonce: string): Promise<InboxKey> {
  const hit = keyCache().get(nonce);
  if (hit) return hit;
  const m = await material(nonce);
  const k = await inboxKeyFrom(m.ikm, m.psk);
  keyCache().set(nonce, k);
  return k;
}

async function isLinked(): Promise<boolean> {
  return (await import("@/lib/identity/keystore")).isLinkedDevice();
}

const isActive = (e: InboxEntry): boolean => !e.forgottenAt;
/** handed out: sealed as claimed, or claimed in memory since the last seal */
const isClaimed = (addrId: string, e: InboxEntry, pend: Record<string, unknown>): boolean => !e.spare || !!pend[addrId];

/** the entry as the user sees it: a pending claim's name and moment overlaid on the sealed spare */
function shown(addrId: string, e: InboxEntry, pend: ReturnType<typeof pendingClaims>): InboxEntry {
  const p = pend[addrId];
  return p && e.spare ? { ...e, spare: false, label: p.label, createdAt: p.claimedAt } : e;
}

export interface AddressView {
  addrId: string;
  address: string;
  label: string | null;
  createdAt: number;
  qr: { viewBox: number; path: string };
}

async function viewOf(addrId: string, e: { nonce: string; label: string | null; createdAt: number }): Promise<AddressView> {
  const k = await keyFor(e.nonce);
  if (k.addrId !== addrId) throw new Error("vault: a ring address no longer derives from this identity's keys — refusing to show it");
  const address = addressString(k);
  const { qrSvgPath } = await import("@/lib/qr");
  return { addrId, address, label: e.label, createdAt: e.createdAt, qr: qrSvgPath(address) };
}

/** LP-3: fill a draft up to SPARE_ADDRESSES spares (within the caps). THROWS on a linked device or an unreadable keystore. */
export async function mintSparesInto(d: RingsDoc, now = Date.now()): Promise<number> {
  if (await isLinked()) throw new Error(LINKED_DEVICE_SENTENCE);
  const pend = pendingClaims();
  let made = 0;
  for (;;) {
    const entries = Object.entries(d.inbox);
    const active = entries.filter(([, e]) => isActive(e));
    const spares = active.filter(([id, e]) => e.spare && !pend[id]).length;
    if (spares >= SPARE_ADDRESSES || active.length >= MAX_ADDRESSES || entries.length >= MAX_ADDRESS_RECORDS) break;
    const nonce = newId16() + newId16();
    const k = await keyFor(nonce);
    d.inbox[k.addrId] = { nonce, label: null, createdAt: now, spare: true, forgottenAt: null };
    made++;
  }
  return made;
}

/** the upkeep's random moment, drawn once when a write is first needed (never moved earlier by later clicks) */
function scheduleUpkeep(now: number): void {
  if (upkeepDueAt() !== null) return;
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  setUpkeepDueAt(now + UPKEEP_MIN_MS + Math.floor((r[0] / 2 ** 32) * (UPKEEP_MAX_MS - UPKEEP_MIN_MS)));
}

/** does the document need the upkeep's write: a claim to keep, or spares to make? */
function upkeepNeeded(doc: RingsDoc): boolean {
  const pend = pendingClaims();
  if (Object.keys(pend).some((id) => doc.inbox[id]?.spare === true)) return true;
  const entries = Object.entries(doc.inbox);
  const active = entries.filter(([, e]) => isActive(e));
  const spares = active.filter(([id, e]) => e.spare && !pend[id]).length;
  return spares < SPARE_ADDRESSES && active.length < MAX_ADDRESSES && entries.length < MAX_ADDRESS_RECORDS;
}

/**
 * LP-3 — THE DEFERRED UPKEEP (lib/rings/tick.ts, every tick): when a claim waits to be kept or spares run short, ONE
 * write at the random moment drawn when the need appeared — the claims ride it (model.ts seal), new spares are made in
 * it. Nothing on a linked device (it holds no address). `now` is for the harness.
 */
export async function inboxUpkeep(now = Date.now()): Promise<"linked" | "none" | "scheduled" | "written"> {
  if (await isLinked()) {
    setUpkeepDueAt(null);
    return "linked";
  }
  const doc = await loadRingsDoc();
  if (!upkeepNeeded(doc)) {
    setUpkeepDueAt(null);
    return "none";
  }
  const due = upkeepDueAt();
  if (due === null) {
    scheduleUpkeep(now);
    return "scheduled";
  }
  if (now < due) return "scheduled";
  await mutateRingsDoc(async (d) => {
    await mintSparesInto(d, now);
  });
  setUpkeepDueAt(null);
  return "written";
}

/**
 * "Make a private address": hand out a spare. NO REQUEST — the claim is kept in memory and sealed later (header). A
 * device that has never written its document makes that one first write now (spares included).
 */
export async function createAddress(label?: string | null): Promise<AddressView> {
  const clean = label == null || label === "" ? null : plainText(label, LABEL_MAX);
  if (label != null && label !== "" && clean === null) throw new Error(`a name for an address is plain text, at most ${LABEL_MAX} characters`);
  if (await isLinked()) throw new Error(LINKED_DEVICE_SENTENCE);
  await loadRingsDoc();
  if (ringsDocUnsealed()) await ensureRingsDocWritten((d) => mintSparesInto(d));
  const doc = await loadRingsDoc();
  const pend = pendingClaims();
  const active = Object.entries(doc.inbox).filter(([, e]) => isActive(e));
  if (active.filter(([id, e]) => isClaimed(id, e, pend)).length >= MAX_ADDRESSES) throw new Error(`you already have ${MAX_ADDRESSES} ring addresses — forget one first`);
  const spare = active.filter(([id, e]) => e.spare && !pend[id]).sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
  const claimedAt = Date.now();
  if (!spare) {
    scheduleUpkeep(claimedAt);
    throw new Error(NO_SPARE_SENTENCE);
  }
  const [addrId, e] = spare;
  const view = await viewOf(addrId, { nonce: e.nonce, label: clean, createdAt: claimedAt });
  addPendingClaim(addrId, clean, claimedAt);
  scheduleUpkeep(claimedAt);
  return view;
}

/** the addresses you have handed out and not forgotten (spares are not listed) */
export async function listAddresses(): Promise<AddressView[]> {
  const doc = await loadRingsDoc();
  const pend = pendingClaims();
  const rows = Object.entries(doc.inbox)
    .filter(([id, e]) => isActive(e) && isClaimed(id, e, pend))
    .map(([id, e]) => [id, shown(id, e, pend)] as const)
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
  const out: AddressView[] = [];
  for (const [addrId, e] of rows) out.push(await viewOf(addrId, e));
  return out;
}

/** short summaries for a GET payload (never the full address): handed-out addresses, and forgotten ones */
export function addressSummaries(doc: RingsDoc): { active: { ref: string; label: string | null; createdAt: number }[]; forgotten: { ref: string; label: string | null; forgottenAt: number }[] } {
  const pend = pendingClaims();
  const entries = Object.entries(doc.inbox);
  return {
    active: entries
      .filter(([id, e]) => isActive(e) && isClaimed(id, e, pend))
      .map(([id, e]) => [id, shown(id, e, pend)] as const)
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .map(([id, e]) => ({ ref: id.slice(0, 8), label: e.label, createdAt: e.createdAt })),
    forgotten: entries
      .filter(([, e]) => !isActive(e))
      .sort((a, b) => (a[1].forgottenAt ?? 0) - (b[1].forgottenAt ?? 0))
      .map(([id, e]) => ({ ref: id.slice(0, 8), label: e.label, forgottenAt: e.forgottenAt as number })),
  };
}

/** the forgotten addresses, for "Use it again" (an id and a name — the address itself is not needed to restore it) */
export async function listForgottenAddresses(): Promise<{ addrId: string; label: string | null; createdAt: number; forgottenAt: number }[]> {
  const doc = await loadRingsDoc();
  return Object.entries(doc.inbox)
    .filter(([, e]) => !isActive(e))
    .sort((a, b) => (a[1].forgottenAt ?? 0) - (b[1].forgottenAt ?? 0))
    .map(([addrId, e]) => ({ addrId, label: e.label, createdAt: e.createdAt, forgottenAt: e.forgottenAt as number }));
}

/** "Forget it": HIDE the address (forgottenAt) — kept, so "Use it again" can bring it back; what was received through
 *  it goes at once. false when there was nothing to forget (no write). */
export async function forgetAddress(addrId: string): Promise<boolean> {
  const had = await mutateRingsDoc((d) => {
    const e = d.inbox[addrId];
    if (!e || e.forgottenAt) skipSeal(false);
    (e as InboxEntry).forgottenAt = Date.now();
    return true;
  });
  if (had) {
    const { dropReceivedForAddress } = await import("./received");
    dropReceivedForAddress(addrId);
  }
  return had as boolean;
}

/** "Use it again": the forgotten address is trial-opened again from the next tick */
export async function restoreAddress(addrId: string): Promise<boolean> {
  const done = await mutateRingsDoc((d) => {
    const e = d.inbox[addrId];
    if (!e) throw new Error("that address isn't one of yours (it may belong to an identity this device no longer holds)");
    if (!e.forgottenAt) skipSeal(false);
    if (Object.values(d.inbox).filter(isActive).length >= MAX_ADDRESSES) throw new Error(`you already have ${MAX_ADDRESSES} ring addresses in use — forget one first`);
    e.forgottenAt = null;
    return true;
  });
  return done as boolean;
}

/** how many addresses you have handed out and not forgotten (the device page's status) */
export function addressCount(doc: RingsDoc): number {
  return addressSummaries(doc).active.length;
}

/** every address's derived keys that are in use (spares included, forgotten ones not), for the tick's trial-open
 *  (THROWS on an unread document or a linked device) */
export async function activeInboxKeys(doc?: RingsDoc): Promise<InboxKey[]> {
  const d = doc ?? (await loadRingsDoc());
  const out: InboxKey[] = [];
  for (const [addrId, e] of Object.entries(d.inbox)) {
    if (!isActive(e)) continue;
    const k = await keyFor(e.nonce);
    if (k.addrId === addrId) out.push(k);
  }
  return out;
}

/** the leak tests: the derived inbox material of every address (ikm-derived pk is public; the PSK is the secret) */
export async function inboxMaterialForLeakTest(): Promise<string[]> {
  const doc = await loadRingsDoc().catch(() => null);
  if (!doc) return [];
  const nonces = Object.values(doc.inbox).map((e) => e.nonce);
  const ks = await import("@/lib/identity/keystore");
  const out = ks.isLinkedDevice() ? [] : ks.ringMaterialForLeakTest(nonces);
  for (const k of keyCache().values()) out.push(k.pskHex);
  return out;
}

export function resetInboxCache(): void {
  keyCache().clear();
}
