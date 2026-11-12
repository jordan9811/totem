// BROWSER KEYSTORE PASS Gate 2 — the device's client for the validator's custody records and blobs, plus the local
// mirror (D-CU-0-7: a copy of every blob in the browser; for the wrap path the ONLY copy).
import { validatorUrl } from "@/lib/ports";
import { signedReadHeaders, signedWriteHeaders } from "@/lib/adapters/mock/persist";
import { storage } from "@/lib/platform/storage";
import { keystoreDir } from "@/lib/identity/keystore";
import type { WrappedSeed } from "@/lib/device/custody/wrap";

export type MethodKind = "passkey-prf" | "passkey-wrap" | "provider";
export interface MethodRecord {
  method_id: string;
  kind: MethodKind;
  created_at: number;
}
export interface MethodRecordFull extends MethodRecord {
  anchor: string;
  pubkey_spki: string | null;
  alg: number | null;
}

const orig = (): typeof fetch => ((globalThis as unknown as { __layersOrigFetch?: typeof fetch }).__layersOrigFetch ?? fetch);
const base = () => validatorUrl();

export async function getMethod(id: string): Promise<MethodRecordFull | null> {
  const r = await orig()(`${base()}/custody/method/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`custody: method lookup ${r.status}`);
  return ((await r.json()) as { method: MethodRecordFull }).method;
}

export async function putMethod(id: string, rec: { kind: MethodKind; pubkeySpki?: string | null; alg?: number | null }): Promise<void> {
  const body = JSON.stringify({ kind: rec.kind, pubkeySpki: rec.pubkeySpki ?? null, alg: rec.alg ?? null });
  const r = await orig()(`${base()}/custody/method/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(await signedWriteHeaders("custody", body)) },
    body,
  });
  if (!r.ok) throw new Error(`custody: method record refused (${r.status}): ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? ""}`);
}

export async function getBlob(id: string): Promise<WrappedSeed | null> {
  const r = await orig()(`${base()}/custody/blob/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`custody: blob lookup ${r.status}`);
  return ((await r.json()) as { blob: WrappedSeed }).blob;
}

export async function putBlob(id: string, blob: WrappedSeed): Promise<void> {
  const body = JSON.stringify({ blob });
  const r = await orig()(`${base()}/custody/blob/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(await signedWriteHeaders("custody", body)) },
    body,
  });
  if (!r.ok) throw new Error(`custody: blob refused (${r.status}): ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? ""}`);
}

/** throws when the validator does not answer: a list that silently came back empty would mislabel a first save
 *  and an attach (attack-custody-2 #19, the never-fail-open rule) */
export async function listMethods(): Promise<MethodRecord[]> {
  const r = await orig()(`${base()}/custody/methods`, { cache: "no-store", headers: await signedReadHeaders("custody") });
  if (!r.ok) throw new Error(`custody: the validator did not list this root's methods (${r.status})`);
  return ((await r.json()) as { methods: MethodRecord[] }).methods ?? [];
}

/** signed under the operation-class namespace, so a captured read envelope cannot become a delete (attack-custody-2 #14) */
export async function deleteMethod(id: string): Promise<void> {
  const r = await orig()(`${base()}/custody/method/${encodeURIComponent(id)}`, { method: "DELETE", headers: await signedReadHeaders("custody:delete") });
  if (!r.ok && r.status !== 404) throw new Error(`custody: delete refused (${r.status})`);
}

// ---- the local mirror: lives beside the keystore, so it persists exactly when the identity does
const localPath = (id: string) => keystoreDir() + "/custody/" + id.replace(/[^A-Za-z0-9._-]/g, "_") + ".json";
export function mirrorBlob(id: string, blob: WrappedSeed): void {
  storage.writeText(localPath(id), JSON.stringify(blob));
}
export function localBlob(id: string): WrappedSeed | null {
  const p = localPath(id);
  if (!storage.exists(p)) return null;
  try {
    return JSON.parse(storage.readText(p)) as WrappedSeed;
  } catch {
    return null;
  }
}
export function forgetLocalBlob(id: string): void {
  storage.remove(localPath(id));
}
