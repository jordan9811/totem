import "server-only";
// ZK PASS 1 Gate 1 — submit ONE envelope over the anonymous channel:
// serialize → PAD TO A CONSTANT SIZE → proof of work bound to the bytes →
// relay adapter → parse the constant-shape outcome. No envelope, no
// session, no cookie, no identifying header is ever attached — the header
// set is exactly {host, content-type, content-length, x-zk-pow} (+ what
// node adds for a non-keep-alive socket: connection).
//
// attack-1 finding 6: the response was constant-shape, the REQUEST was
// not — a relay's passive log could join submissions 1:1 by byte length.
// Every request is now exactly ZK_SUBMIT_BYTES long; an envelope that
// would not fit is refused here, never sent unpadded.
//
// PERSONA LAUNCH P7 — the same function in the BROWSER DEVICE. The padding is built with TextEncoder (the same utf-8
// bytes Buffer produced, and no Buffer: the tab has none of its own), the PoW is solved in the tab, and relay.ts hands
// the bytes to the web channel (lib/zk/anon/webChannel.ts). The diagnostics say which channel carried it ("node" or
// "web"); agentFalse/reusedSocket keep their node meaning, and on the web channel reusedSocket is null (a page cannot see
// the browser's connection pool — A-WEB-CHANNEL-DIRECT-UA). The browser carries TEST-UNIVERSE envelopes only this wave:
// a live one is refused here, before any byte leaves (the validator's web route refuses one too; under OHTTP the gateway
// cannot tell a tab from a server device, so this check is the one that holds there).
import { ZK_POW_BITS, ZK_SUBMIT_BYTES } from "../config";
import type { ProofEnvelope } from "../transport/types";
import { recordAnonSubmission } from "./client";
import { solvePow } from "./pow";
import { currentRelay, relayChannel, relayConfig } from "./relay";
import { liveUniverseHinted } from "./universe";

export type AnonOutcome = "accepted" | "replay" | "refused" | "malformed" | "transport-error";

export interface AnonSubmitResult {
  outcome: AnonOutcome;
  relay: string;
  ms: number;
  powMs: number;
  reusedSocket: boolean | null;
  headersSent: string[];
  bytes: number;
  /** PERSONA LAUNCH P7: which channel carried it — "node" (an isolated socket) or "web" (the browser's channel) */
  channel?: "node" | "web";
  note?: string;
}

const te = new TextEncoder();

/** PERSONA LAUNCH P7 (L2): the ONLY envelope fields that go on the anonymous wire — ProofEnvelope's own keys, in order */
export const WIRE_ENVELOPE_KEYS = Object.freeze(["v", "mode", "claimKind", "publicInputs", "nullifier", "proof", "payload"] as const);

/**
 * PERSONA LAUNCH P7 (L2) — what is serialized is an ALLOWLIST of the envelope, never the object as it happens to be.
 * A live transport used to hang `provingMs` (its prover's wall time) on the envelope, and the whole object went into the
 * padded body: a per-device timing fingerprint on the channel built to hide who sent what. Any field a future caller
 * adds to the in-memory envelope (a timing, a debug note) now stays in memory; a missing payload stays absent.
 */
export function wireEnvelope(envelope: ProofEnvelope): Record<string, unknown> {
  const src = envelope as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of WIRE_ENVELOPE_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** The constant-size request body, or null if the envelope cannot fit. */
export function paddedBody(envelope: ProofEnvelope): Uint8Array | null {
  const wire = wireEnvelope(envelope);
  const bare = te.encode(JSON.stringify({ envelope: wire, p: "" }));
  const padLen = ZK_SUBMIT_BYTES - bare.length;
  if (padLen < 0) return null;
  const body = te.encode(JSON.stringify({ envelope: wire, p: "x".repeat(padLen) }));
  if (body.length !== ZK_SUBMIT_BYTES) return null; // never send a non-constant size
  return body;
}

/** PERSONA LAUNCH P7: the browser device sends test-universe envelopes only (see the header) */
export const BROWSER_LIVE_REFUSAL = "a browser on this site sends test-universe proofs only — a live-universe envelope never leaves this tab";

/**
 * PUBLIC GO-LIVE (the relay track): a LIVE envelope may leave a tab only while BOTH hold — the app handed this tab the live
 * universe (lib/zk/anon/universe.ts, ZK_ANON_UNIVERSE=live) AND the last tick's live config said the validator's relay is
 * armed (liveRelay: true, read from the snapshot this tab already holds: the prefetch state on globalThis, no import and no
 * fetch). Anything else is the old refusal, word for word, before any byte leaves. The validator's web door asks its own
 * question (validator/anonpublic.js liveWebDoorOpen) and refuses a live envelope while its relay is not armed.
 */
export function liveEnvelopeMayLeaveTab(): boolean {
  if (!liveUniverseHinted()) return false;
  const snaps = (globalThis as unknown as { __layersZkPrefetch?: { snapshots?: Record<string, { mode?: unknown; anonConfig?: { liveRelay?: unknown } | null } | undefined> } }).__layersZkPrefetch?.snapshots;
  const live = snaps?.live;
  return !!live && live.mode === "live" && live.anonConfig?.liveRelay === true;
}

export async function submitAnonymous(envelope: ProofEnvelope): Promise<AnonSubmitResult> {
  const channel = relayChannel();
  const agentFalse = channel === "node";
  const liveArmed = envelope?.mode === "live" && envelope?.publicInputs?.mode === "live" && liveEnvelopeMayLeaveTab();
  if (channel === "web" && (envelope?.mode !== "fixture" || envelope?.publicInputs?.mode !== "fixture") && !liveArmed) {
    const r: AnonSubmitResult = { outcome: "refused", relay: relayConfig().kind, ms: 0, powMs: 0, reusedSocket: null, headersSent: [], bytes: 0, channel, note: BROWSER_LIVE_REFUSAL };
    recordAnonSubmission({ at: Date.now(), relay: r.relay, channel, agentFalse, reusedSocket: null, headersSent: [], outcome: r.outcome, ms: 0, powMs: 0, powAttempts: 0 });
    return r;
  }
  const body = paddedBody(envelope);
  if (!body) {
    const r: AnonSubmitResult = { outcome: "transport-error", relay: relayConfig().kind, ms: 0, powMs: 0, reusedSocket: false, headersSent: [], bytes: 0, channel, note: "envelope exceeds the constant request size — refused, never sent unpadded" };
    recordAnonSubmission({ at: Date.now(), relay: r.relay, channel, agentFalse, reusedSocket: false, headersSent: [], outcome: r.outcome, ms: 0, powMs: 0, powAttempts: 0 });
    return r;
  }
  const pow = solvePow(body, ZK_POW_BITS);
  const relay = currentRelay();
  const t0 = performance.now();
  let outcome: AnonOutcome = "transport-error";
  let reusedSocket: boolean | null = channel === "web" ? null : false;
  let headersSent: string[] = [];
  try {
    const r = await relay.send(body, { "content-type": "application/json", "x-zk-pow": pow.nonce });
    reusedSocket = r.reusedSocket;
    headersSent = r.headersSent;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(r.body)) as { outcome?: string };
      const o = parsed.outcome;
      outcome = o === "accepted" || o === "replay" || o === "refused" || o === "malformed" ? o : "transport-error";
    } catch {
      outcome = "transport-error";
    }
  } catch {
    outcome = "transport-error";
  }
  const ms = performance.now() - t0;
  recordAnonSubmission({
    at: Date.now(),
    relay: relayConfig().kind,
    channel,
    agentFalse,
    reusedSocket,
    headersSent,
    outcome,
    ms,
    powMs: pow.ms,
    powAttempts: pow.attempts,
  });
  return { outcome, relay: relay.kind, ms, powMs: pow.ms, reusedSocket, headersSent, bytes: body.length, channel };
}
