import "server-only";
// ATTESTATION PASS Gate 1 — where the claim VALUE lives: the subject's
// vault, as ONE opaque sealed record (the vault seals values, not
// addresses — attack-1 finding 1; same pattern as identityRoster and
// zkQueue). The validator stores this namespace as ciphertext under the
// single address "_" and can neither read a value nor tell how many
// issuances are inside (the record is padded to a 1 KiB boundary).
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { validatorUrl } from "@/lib/ports";
import type { IssuedAttestation } from "./types";

export const NS = "zkAttestations";
interface Doc {
  items: IssuedAttestation[];
}
const g = globalThis as unknown as { __layersZkAttestations?: Doc; __layersZkAttestationsReadWarned?: boolean };

// Review WE-5 (the vault half): a write here re-seals the WHOLE namespace, and the old load() turned an unreachable
// or refusing validator into a cached EMPTY document — so a storeIssued/forgetIssued after a failed read sealed an
// empty (or one-item) record over every stored issuance. WRITES now build on loadStrict(): retried, a non-OK answer,
// an unreadable namespace, or an EMPTY one this device sealed before (lib/vault/sealedPins.ts) is a REFUSAL; only a
// document actually read (or sealed by this process) is cached; a seal is adopted only after the flush succeeds.
// READS (myAttestations) keep their answer to an unreadable record — none, for that call — never cached.
async function loadStrict(): Promise<Doc> {
  if (g.__layersZkAttestations) return g.__layersZkAttestations;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(NS);
      let doc: Doc = { items: [] };
      if (res.status === 404) {
        // Review WE-5: the validator answers a MISSING namespace with 200 {entries:{}} (never 404), so a 404 here is a
        // proxy, a wrong address or a validator that lost the table — "never sealed" only if this device never sealed
        // it; otherwise it is the same deleted-namespace refusal as an empty answer, never a fresh start.
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(NS))
          throw new Error("vault: zkAttestations answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(NS, entries); // throws on the wrong key: loud, never empty-as-success
          const rec = plain["_"] as { m?: Doc } | undefined;
          // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record it cannot read, so a
          // namespace whose records are all unreadable — deleted, truncated, plaintext, or
          // sealed under a different key — became an EMPTY document marked loaded, and the next
          // write sealed that emptiness over the real record. Records present with none readable
          // is a CORRUPTED vault, and it is refused in the same voice as an unreachable one.
          if (!rec)
            throw new Error(
              "vault: zkAttestations holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
            );
          if (rec.m && Array.isArray(rec.m.items)) doc = { items: rec.m.items };
        } else {
          const { wasEverSealed } = await import("@/lib/vault/sealedPins");
          if (wasEverSealed(NS))
            throw new Error("vault: zkAttestations is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersZkAttestations = doc;
      g.__layersZkAttestationsReadWarned = false;
      return doc;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("attestation record unavailable (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating the vault as empty");
}

async function load(): Promise<Doc> {
  try {
    return await loadStrict();
  } catch (e) {
    if (!g.__layersZkAttestationsReadWarned) {
      g.__layersZkAttestationsReadWarned = true;
      console.error("[attest] " + (e as Error).message + " — reads answer no attestations until it can be read; writes are refused");
    }
    return { items: [] };
  }
}

async function save(doc: Doc): Promise<void> {
  if (doc === g.__layersZkAttestations) throw new Error("internal: zkAttestations save() was handed the cached document — build a new one");
  const inner = JSON.stringify(doc);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(NS, { _: { m: doc, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  await flushVault(NS, sealed);
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(NS);
  g.__layersZkAttestations = doc;
}

/** keep the newest issuance per (mode, issuer, bucket) */
export async function storeIssued(items: IssuedAttestation[]): Promise<void> {
  const doc = await loadStrict();
  const key = (a: IssuedAttestation) => `${a.mode}|${a.issuerId}|${a.bucket}`;
  const keep = new Map(doc.items.map((a) => [key(a), a]));
  for (const a of items) keep.set(key(a), a);
  await save({ items: [...keep.values()] });
}

export async function myAttestations(mode?: string): Promise<IssuedAttestation[]> {
  const doc = await load();
  return doc.items.filter((a) => !mode || a.mode === mode);
}

export async function forgetIssued(mode: string, issuerId?: string, bucket?: string): Promise<void> {
  const doc = await loadStrict();
  await save({ items: doc.items.filter((a) => !(a.mode === mode && (!issuerId || a.issuerId === issuerId) && (!bucket || a.bucket === bucket))) });
}

/** resetZk (fixture): the universe forgot every commitment, so the issuances are moot */
export async function forgetAllIssued(mode: string): Promise<void> {
  await forgetIssued(mode);
}

/** resetSeed: the validator's copy of this namespace was just wiped — the
 * in-process record must not outlive it. (Closing sweep 1 of the
 * attestation pass: the record cached at boot survived every reset, and
 * five legacy suites saw attestations the seed never issued.) */
export function resetAttestationVaultCache(): void {
  g.__layersZkAttestations = undefined;
}
