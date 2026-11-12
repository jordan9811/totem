// PROD-LIVE (D-CU-0-4) — the slice of ZkStatus the /settings/zk page actually shows.
//
// The page used to read zkStatus() in a server component and render a few fields of it. Now the body is a client
// island (ZkStatusPane) fed by the server on the rig and by the browser device on a public deployment, and whatever
// crosses into it is serialized into the page. So only what is rendered crosses — never the whole status (it also
// carries the pins file path, the prefetch tick log and the full commitment, which the page never showed: the
// commitment is cut to the same 18 characters the page always displayed). No "use client" and no data access: the
// server page and the client island both import this.
import type { ZkStatus } from "@/lib/zk/status";

export interface ZkStatusView {
  mode: ZkStatus["mode"];
  /** the first 18 characters only — the page renders it followed by "…" */
  commitment: string;
  derivedTwiceIdentical: boolean;
  epoch: number | null;
  floor: number;
  registration: { registered: boolean; epochRegistered: number | null; activeFromEpoch: number | null; activeNow: boolean } | null;
  placement: { found: boolean; verified: boolean } | null;
  relay: { kind: ZkStatus["relay"]["kind"]; thirdPartyAttested: boolean };
  pow: { bits: number };
  jitter: { minMs: number; maxMs: number };
  queue: { queued: number; sent: number; refused: number; nextDueInMs: number | null };
  ceremony: { name: string; finalized: string; contributionsDepth20: number };
  vkeyPin: { ok: boolean; reason?: string };
  /** zkStatus()'s own report that the validator could not be read (registration/placement/epoch then unknown) */
  error?: string;
}

export function toZkStatusView(s: ZkStatus): ZkStatusView {
  return {
    mode: s.mode,
    commitment: String(s.commitment ?? "").slice(0, 18),
    derivedTwiceIdentical: s.derivedTwiceIdentical === true,
    epoch: s.epoch ?? null,
    floor: s.floor,
    registration: s.registration
      ? {
          registered: s.registration.registered,
          epochRegistered: s.registration.epochRegistered,
          activeFromEpoch: s.registration.activeFromEpoch,
          activeNow: s.registration.activeNow,
        }
      : null,
    placement: s.placement ? { found: s.placement.found, verified: s.placement.verified } : null,
    relay: { kind: s.relay.kind, thirdPartyAttested: s.relay.thirdPartyAttested },
    pow: { bits: s.pow.bits },
    jitter: { minMs: s.jitter.minMs, maxMs: s.jitter.maxMs },
    queue: { queued: s.queue.queued, sent: s.queue.sent, refused: s.queue.refused, nextDueInMs: s.queue.nextDueInMs },
    ceremony: { name: s.ceremony.name, finalized: s.ceremony.finalized, contributionsDepth20: s.ceremony.contributionsDepth20 },
    vkeyPin: s.vkeyPin.reason === undefined ? { ok: s.vkeyPin.ok } : { ok: s.vkeyPin.ok, reason: s.vkeyPin.reason },
    ...(typeof s.error === "string" && s.error ? { error: s.error } : {}),
  };
}
