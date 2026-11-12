import "server-only";
// PERSONA LAUNCH P6 — the FIXTURE chain reader: the validator's simulated chain (validator/simchain.js) over plain public
// GETs — no device envelope, no cookies, nothing that names this device; each read names only the fid or the name it
// asks about, exactly what any client checking any account would send. Answers are cached for a few seconds (a feed
// build asks about the same fid once per card); resetChainFixtureCache() forgets them (resetSeed and reloadIdentity).
// A read that fails THROWS — never "no such key" (the caller then renders plain anon, which is the fail-closed answer).
import { validatorUrl } from "@/lib/ports";
import type { ChainAccount, ChainKey, ChainSource } from "./types";

const TTL_MS = 5_000;
const g = globalThis as unknown as { __layersChainFixtureCache?: Map<string, { at: number; value: unknown }> };
const cache = () => (g.__layersChainFixtureCache ??= new Map());

export function resetChainFixtureCache(): void {
  g.__layersChainFixtureCache = new Map();
}

async function getJson(path: string): Promise<{ status: number; json: unknown }> {
  const key = path;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as { status: number; json: unknown };
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(validatorUrl() + path, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.status !== 200 && res.status !== 404) throw new Error("the simulated chain answered " + res.status);
      const value = { status: res.status, json };
      cache().set(key, { at: Date.now(), value });
      if (cache().size > 500) cache().delete(cache().keys().next().value as string);
      return value;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw new Error("the simulated chain could not be read (" + ((last as Error)?.message ?? "unreachable") + ")");
}

export const fixtureChain: ChainSource = {
  kind: "fixture",
  async account(fid) {
    if (!Number.isInteger(fid) || fid <= 0) return null;
    const r = await getJson(`/sim-chain/fid?mode=fixture&fid=${fid}`);
    if (r.status === 404) return null;
    const j = r.json as Partial<ChainAccount> | null;
    if (!j || j.fid !== fid || typeof j.custody !== "string") throw new Error("the simulated chain's answer is malformed");
    return { fid, custody: j.custody, recovery: String(j.recovery ?? ""), registeredAt: Number(j.registeredAt ?? 0), storageUnits: Number(j.storageUnits ?? 0), fname: typeof j.fname === "string" ? j.fname : null };
  },
  async fidOfCustody(custody) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(custody)) return null;
    const r = await getJson(`/sim-chain/fid?mode=fixture&custody=${custody.toLowerCase()}`);
    if (r.status === 404) return null;
    const fid = Number((r.json as { fid?: unknown } | null)?.fid);
    if (!Number.isInteger(fid) || fid <= 0) throw new Error("the simulated chain's answer is malformed");
    return fid;
  },
  async keysOf(fid) {
    if (!Number.isInteger(fid) || fid <= 0) return [];
    const r = await getJson(`/sim-chain/keys?mode=fixture&fid=${fid}`);
    const keys = (r.json as { fid?: unknown; keys?: unknown } | null)?.keys;
    if (r.status !== 200 || !Array.isArray(keys)) throw new Error("the simulated chain's key list is malformed");
    return keys.map((k: Partial<ChainKey>) => ({ key: String(k.key ?? ""), keyType: Number(k.keyType ?? 0), requestFid: Number(k.requestFid ?? 0), addedAt: Number(k.addedAt ?? 0), removedAt: k.removedAt == null ? null : Number(k.removedAt) }));
  },
  async fidOfName(name) {
    if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(name)) return null;
    const r = await getJson(`/sim-chain/fname/${name}?mode=fixture`);
    if (r.status === 404) return null;
    const fid = Number((r.json as { fid?: unknown } | null)?.fid);
    return Number.isInteger(fid) && fid > 0 ? fid : null;
  },
};
