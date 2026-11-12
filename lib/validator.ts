import { validatorUrl } from "@/lib/ports";
// Client for the trusted validator (/validator). The app NEVER computes rep
// locally, and — after ZK Pass 2 Gate 2 (migration 006) — the validator
// never resolves persona→root at all: it has no table for it. Rosters are
// the device's (lib/identity/rootRoster.ts + the keystore); reputation is
// asked by ROOT handle (the account's own) or PROVEN (the zk binding).
import { cache } from "react";
import type { Persona } from "./types";

const BASE = validatorUrl();

async function vfetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, { cache: "no-store", ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Validator down → degrade gracefully: no badges, no filtering.
    return null;
  }
}

export const getPersona = cache(async (personaId: string): Promise<Persona | null> => {
  const r = await vfetch<{ persona: Persona }>(`/personas/${personaId}`);
  return r?.persona ?? null;
});

/**
 * The personas of a root — answered from the DEVICE roster, then fleshed
 * out by id from the validator (which knows personas, not their roots).
 * A root this device never registered has no answer: an empty list, not a
 * guess. (`/personas/root/:rootId` is gone — migration 006.)
 */
export const personasForRoot = cache(async (rootId: string): Promise<Persona[]> => {
  const { personaIdsForRoot, personaRecord } = await import("./identity/rootRoster");
  let ids = await personaIdsForRoot(rootId);
  // LAYERS_WORLD=empty (lib/world.ts): a roster read answers with REAL personas only — the fixture export's
  // validator personas (the seeded self "jordan" and the fixture accounts) are bank, wherever a root lookup reaches
  const { isEmptyWorld, realPersonaIds } = await import("./world");
  if (isEmptyWorld()) {
    const real = new Set(realPersonaIds());
    ids = ids.filter((id) => real.has(id));
  }
  const out: Persona[] = [];
  for (const id of ids) {
    // Gate 4 (attack-z2-1 #1): the device's own record first — asking the
    // validator for each own persona by id, back to back, enumerated the
    // roster to the operator on every render. Only a persona this device
    // holds no record for (the fixture export's ids) is fetched.
    const rec = await personaRecord(id);
    if (rec) {
      out.push({ id: rec.id, name: rec.name, handle: rec.handle, avatarUrl: rec.avatarUrl, bio: rec.bio, createdAt: rec.createdAt });
      // POST-DEPLOY Gate 1 (D-POST-1-ONE-ROSTER-ONE-TRUTH): a persona the DEVICE holds must also be one the rest
      // of the app can find by id. The roster and the rendering map were two sources of truth: a keystore-minted
      // persona appeared in the picker and was invisible to everything that resolves an id — the fork route
      // refused it, the persona switch refused it, and a clone of it landed under the wrong root. Registering the
      // device's own record here costs nothing on a hit and makes the two agree.
      const { personaById, personaByHandle } = await import("./adapters/mock/store");
      if (!personaById.has(rec.id)) {
        personaById.set(rec.id, { id: rec.id, rootId, name: rec.name, handle: rec.handle, avatarUrl: rec.avatarUrl ?? "", bio: rec.bio ?? "", cluster: "", tier: 1, demoTags: ["roster"] } as unknown as NonNullable<ReturnType<typeof personaById.get>>);
        if (!personaByHandle.has(rec.handle)) personaByHandle.set(rec.handle, personaById.get(rec.id)!);
      }
      continue;
    }
    const p = await getPersona(id);
    if (p) out.push(p);
  }
  return out;
});

/**
 * The personas of an account (fid) — answered from the DEVICE roster only
 * (the vault roster for signer-registered roots; the one-time pre-006
 * fixture export for the fixture accounts this device stands in for). An
 * account this device holds no root for has no answer: an empty list,
 * not a guess. (`/personas/by-fid/:fid` is gone — migration 006.)
 */
export const personasByFid = cache(async (fid: number): Promise<Persona[]> => {
  const { rootForFid } = await import("./identity/rootRoster");
  const rootId = await rootForFid(fid);
  if (!rootId) return [];
  return personasForRoot(rootId);
});

/**
 * Tier by ROOT — the account's own reputation, asked with the root handle
 * this device holds for the persona. A persona this device cannot
 * attribute to one of its roots has no legacy tier (null): the validator
 * cannot be asked "what is this persona's tier" any more. (`/rep/:personaId`
 * is gone — migration 006.)
 */
export const tierFor = cache(async (personaId: string): Promise<number | null> => {
  const { rootOfPersona } = await import("./identity/rootRoster");
  const rootId = await rootOfPersona(personaId);
  if (!rootId) return null;
  const r = await vfetch<{ tier: number }>(`/rep/root/${rootId}/tier`);
  return r?.tier ?? null;
});

/** Persona-level blocks (migration 006): what THIS persona blocked. No
 * root fan-out — the validator cannot reach a blocked root's other
 * personas, and must not pretend to. */
export const blockedFor = cache(async (personaId: string): Promise<string[]> => {
  const r = await vfetch<{ personaIds: string[] }>(`/blocked/${personaId}`);
  return r?.personaIds ?? [];
});

export async function registerRoot(fid: number, signerUuid: string): Promise<string | null> {
  const { signedWriteHeaders } = await import("@/lib/adapters/mock/persist");
  const body = JSON.stringify({ fid, signerUuid });
  const r = await vfetch<{ rootId: string }>("/roots", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await signedWriteHeaders("roots", body)) },
    body,
  });
  return r?.rootId ?? null;
}

/** Create a persona WITHOUT telling the validator which root made it. */
export async function createPersona(input: {
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
}): Promise<Persona | null> {
  const r = await vfetch<{ persona: Persona }>("/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return r?.persona ?? null;
}

export async function blockPersona(blockerPersona: string, blockedPersona: string): Promise<boolean> {
  const r = await vfetch<{ ok: boolean }>("/block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockerPersona, blockedPersona }),
  });
  return !!r?.ok;
}
