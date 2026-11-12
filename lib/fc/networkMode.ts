import "server-only";
// MULTI-FID PASS Gate 1 — PERSONA_NETWORK_MODE.
//   per-persona-fid (default): every PUBLIC persona owns one Farcaster
//                    account and posts through its own signer; Warpcast
//                    sees a normal separate account, and only this client
//                    (for granted viewers) knows whose it is.
//   shared-fid:       the Pass-FC v0 — every public persona posts through
//                    ONE shared account and this client attributes them
//                    from the index. Kept behind the flag for the anon-post
//                    mode (Gate 4), where zero attribution is the point.
// The rig may override at runtime; resetSeed restores the env/default.

export type PersonaNetworkMode = "per-persona-fid" | "shared-fid";
const g = globalThis as unknown as { __layersNetworkModeOverride?: PersonaNetworkMode | null };

export function setNetworkModeOverride(mode: PersonaNetworkMode | null): void {
  g.__layersNetworkModeOverride = mode;
}

export function personaNetworkMode(): PersonaNetworkMode {
  const o = g.__layersNetworkModeOverride;
  if (o) return o;
  return process.env.PERSONA_NETWORK_MODE === "shared-fid" ? "shared-fid" : "per-persona-fid";
}
