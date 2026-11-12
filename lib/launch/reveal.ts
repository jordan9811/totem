import "server-only";
// PERSONA LAUNCH P6 — THE BATCH REVEAL (D7 / R7): once the launched account exists with the persona's own key on it,
// reveal EVERY anon post that persona made, in ONE request signed by that registered key — and none of its siblings'.
//
//   canonical = "layers-anon-reveal-batch/1|<mode>|<fid>|<signerPubKey>|sha256(sorted cast hashes joined by ',')"
//
// signed with the persona's derived signer (lib/identity/keys.ts signAsFcSignerFor) — exactly the key the Bundler added
// to the account, so ANYONE can check the reveal against the (simulated) KeyRegistry: this closes
// A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY on the simulated chain. DELIBERATE DUPLICATE of validator/registrar.js
// (revealBatchCanonical, castListHash); scripts/unit-launch.mjs pins the pair.
//
// The items are EVERY cast hash this device holds a reveal secret for AS this persona (the sealed records name the
// persona; siblings' records name theirs), each with its secret. The request goes as ONE POST {batch: true, …} to
// /zk/anon/reveal over an ISOLATED socket (lib/zk/anon/client.ts isolatedRequest: a fresh connection, no pool, no
// cookies, no device envelope, an explicit minimal header set) — the reveal is public by design, but nothing on it
// should tie the request to this device's identified traffic. The validator checks all of it or records none of it.
import { createHash } from "@/lib/platform/crypto";

/** sha256 of the cast hashes, sorted, joined by "," — DELIBERATE DUPLICATE of validator/registrar.js castListHash */
export function castListHash(castHashes: string[]): string {
  return createHash("sha256").update([...castHashes].sort().join(","), "utf8").digest("hex");
}

/** what the registered signer signs — DELIBERATE DUPLICATE of validator/registrar.js revealBatchCanonical */
export function revealBatchCanonical(mode: string, fid: number, signerPubKey: string, castHashes: string[]): string {
  return ["layers-anon-reveal-batch/1", mode, String(fid), signerPubKey, castListHash(castHashes)].join("|");
}

/** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the most posts ONE signed batch may carry — DELIBERATE DUPLICATE of
 *  validator/registrar.js MAX_BATCH_ITEMS (~200 KB of JSON, inside the validator's 256 KiB body limit) */
export const REVEAL_BATCH_MAX_ITEMS = 1500;

/**
 * PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the reveal's PARTS. Up to REVEAL_BATCH_MAX_ITEMS posts go as the one
 * batch D7 asks for; a persona with more is revealed as consecutive full batches, each signed by the registered key and
 * sent back to back in the same step (the validator's body limit bounds one request). Sorted by cast hash first, so a
 * retried step rebuilds the SAME parts (each one already recorded answers alreadyRevealed — idempotent). PURE.
 */
export function revealParts<T extends { castHash: string }>(items: T[], max: number = REVEAL_BATCH_MAX_ITEMS): T[][] {
  if (!Number.isInteger(max) || max < 1) throw new Error("revealParts: max must be a positive whole number");
  const sorted = [...items].sort((a, b) => (a.castHash < b.castHash ? -1 : a.castHash > b.castHash ? 1 : 0));
  const out: T[][] = [];
  for (let i = 0; i < sorted.length; i += max) out.push(sorted.slice(i, i + max));
  return out;
}

export interface BatchRevealResult {
  ok: boolean;
  status: number;
  batchHash?: string;
  revealed?: number;
  alreadyRevealed?: boolean;
  reason?: string;
  /** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the posts the validator has no relayed row for (a 404 names them all) */
  notRelayed?: string[];
}

/** the body the batch reveal sends (PURE: built from the items and a signer — exported for the unit harness) */
export function batchRevealBody(mode: "fixture" | "live", fid: number, signerPubKey: string, items: Array<{ castHash: string; secret: string }>, signature: string) {
  return { batch: true as const, mode, fid, signerPubKey, castHashes: items.map((i) => i.castHash), secrets: items.map((i) => i.secret), signature };
}

/**
 * Reveal `items` (this persona's own anon posts, each with its secret) as `fid`, signed by the persona's registered key.
 * The caller (lib/launch/tick.ts) chose the items: EVERY sealed record of this persona whose cast is relayed.
 */
export async function sendBatchReveal(personaId: string, fid: number, mode: "fixture" | "live", items: Array<{ castHash: string; secret: string }>): Promise<BatchRevealResult> {
  if (mode !== "fixture") return { ok: false, status: 0, reason: "a live batch reveal needs the live key registry, which this build does not read (F25)" };
  if (!items.length) return { ok: true, status: 200, revealed: 0 };
  if (items.length > REVEAL_BATCH_MAX_ITEMS) return { ok: false, status: 0, reason: `one batch carries at most ${REVEAL_BATCH_MAX_ITEMS} posts — split it (revealParts)` };
  const { fcSignerPublicKeyFor, signAsFcSignerFor } = await import("@/lib/identity/keys");
  const signerPubKey = fcSignerPublicKeyFor(personaId);
  if (!signerPubKey) return { ok: false, status: 0, reason: "this device holds no signer key for that persona" };
  const signature = signAsFcSignerFor(personaId, revealBatchCanonical(mode, fid, signerPubKey, items.map((i) => i.castHash)));
  if (!signature) return { ok: false, status: 0, reason: "this device could not sign as that persona" };
  const body = new TextEncoder().encode(JSON.stringify(batchRevealBody(mode, fid, signerPubKey, items, signature)));
  const { isolatedRequest } = await import("@/lib/zk/anon/client");
  const { VALIDATOR_URL } = await import("@/lib/zk/config");
  let res: { status: number; body: Uint8Array };
  try {
    res = await isolatedRequest(VALIDATOR_URL + "/zk/anon/reveal", { method: "POST", headers: { "content-type": "application/json" }, body });
  } catch (e) {
    return { ok: false, status: 0, reason: "the validator could not be reached (" + (e as Error).message + ")" };
  }
  let j: { ok?: boolean; error?: string; batchHash?: string; revealed?: number; alreadyRevealed?: boolean; notRelayed?: unknown } | null = null;
  try {
    j = JSON.parse(new TextDecoder().decode(res.body));
  } catch {
    j = null;
  }
  if (res.status !== 200 || !j?.ok)
    return {
      ok: false,
      status: res.status,
      reason: j?.error ?? "the validator refused the reveal (" + res.status + ")",
      ...(Array.isArray(j?.notRelayed) ? { notRelayed: (j!.notRelayed as unknown[]).filter((h): h is string => typeof h === "string") } : {}),
    };
  return { ok: true, status: 200, batchHash: j.batchHash, revealed: j.revealed ?? (j.alreadyRevealed ? items.length : 0), alreadyRevealed: !!j.alreadyRevealed };
}
