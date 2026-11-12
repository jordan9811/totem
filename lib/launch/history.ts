import "server-only";
// PERSONA LAUNCH P6 — THE LAUNCH HISTORY (D5) and THE PROOF.
//
// ON FARCASTER, at the CURRENT time (never backdated — backdating proves nothing, is pruned first and sits before the
// account's own registration, plan §8): ONE launch cast linking the proof page, and up to 10 QUOTE-casts of originals
// the owner picked in the preview — only from this launch's revealed batch (the self-link guard enforces it again at the
// write door: lib/fc/writes.ts, R9's one exception). All of it through the thin relay, signed by the account's own key.
//
// INSIDE LAYERS, the launched persona's profile shows its WHOLE revealed history at the ORIGINAL dates, each labelled
// "revealed from @anon" — a display inside Totem (C4), checked row by row against the chain: a row whose attributed key
// is not a registered key of the account is not shown at all (lib/fc/personaFid.ts publicProfileForFid, "chain").
//
// THE PROOF PAGE (app/proof/[fid]): the batch list, the signer key, the signature, and the key-registry check — computed
// here from PUBLIC reads only (the registrar's reveal batches, the simulated chain), so a page that renders it mints no
// root, boots no device and reads no vault.
import { verifyCanonical } from "@/lib/crypto/ed25519";
import { revealBatchCanonical } from "./reveal";

export const REVEALED_FROM_ANON = "revealed from @anon";
export const MAX_HISTORY_QUOTES = 10;

/** PERSONA LAUNCH P6 (fix UX-L8): the launch cast claims a reveal only when one happened — an account launched with no
 *  anonymous posts links its proof page without saying any were revealed */
export function launchCastText(fid: number, revealed: number, appUrl: string = process.env.APP_URL ?? ""): string {
  const proof = `${appUrl.replace(/\/$/, "")}/proof/${fid}`;
  return revealed > 0 ? `Launched. My anonymous posts are revealed, with proof: ${proof}` : `Launched. Proof of this account: ${proof}`;
}

interface AttributedPage {
  casts?: unknown;
  next?: unknown;
}

/**
 * PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): EVERY public anon row attributed to `fid` — the registrar's complete,
 * paged read (GET /registrar/anon-casts?attributedFid=), never the newest-200 feed list, which emptied a launched
 * account's history and proof as @anon kept posting. A public read naming the public account; retried; THROWS when it
 * cannot be read (the caller says so — a history that could not be read must not look empty). Fixture only this wave.
 */
export async function attributedRows(fid: number, mode: "fixture" | "live"): Promise<AnonRow[]> {
  if (mode !== "fixture") throw new Error("a launched account's revealed posts are read on the simulated registrar only this wave");
  const { validatorUrl } = await import("@/lib/ports");
  const out: AnonRow[] = [];
  let before: string | null = null;
  for (let page = 0; page < 10_000; page++) {
    let j: AttributedPage | null = null;
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${validatorUrl()}/registrar/anon-casts?mode=${mode}&attributedFid=${fid}${before ? "&before=" + encodeURIComponent(before) : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error("the registrar answered " + res.status);
        j = (await res.json()) as AttributedPage;
        if (!Array.isArray(j.casts)) throw new Error("the anon list is malformed");
        last = "";
        break;
      } catch (e) {
        last = (e as Error).message;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    if (last || !j) throw new Error(last || "the anon list could not be read");
    out.push(...(j.casts as AnonRow[]));
    before = typeof j.next === "string" && j.next ? j.next : null;
    if (!before) return out;
  }
  throw new Error("the anon list did not end");
}
export function quoteCastText(at: number): string {
  return `From my anonymous posts, ${new Date(at).toISOString().slice(0, 10)}.`;
}

interface AnonRow {
  hash: string;
  castHash: string;
  text: string;
  at: number;
  attributedFid: number | null;
  attributedAt: number | null;
  attributedSigner?: string | null;
  attributedBatch?: string | null;
}

/**
 * Post the history for one launched persona (fid). Returns what was posted; a failed quote is recorded and the rest go
 * on (the launch cast first: without it the quotes have no context). Throws nothing the caller must catch: a refusal
 * comes back as { ok: false, reason }.
 */
export async function postLaunchHistory(
  personaId: string,
  fid: number,
  mode: "fixture" | "live",
  picks: string[],
  already: { launchCastHash: string | null; quoted: string[] },
  revealed: number
): Promise<{ ok: boolean; launchCastHash: string | null; quoted: string[]; notes: string[]; reason?: string }> {
  const notes: string[] = [];
  const { publishFcCast } = await import("@/lib/fc/writes");
  let launchCastHash = already.launchCastHash;
  if (!launchCastHash) {
    try {
      launchCastHash = (await publishFcCast(launchCastText(fid, revealed), "cast", undefined, { personaId })).hash;
    } catch (e) {
      return { ok: false, launchCastHash: null, quoted: already.quoted, notes, reason: "the launch cast was not posted: " + (e as Error).message };
    }
  }
  const quoted = [...already.quoted];
  if (picks.length) {
    let rows: AnonRow[];
    try {
      // fix W2-LAUNCH-REVEAL-200: every row this account revealed, never the newest-200 feed list (an older pick was skipped)
      rows = await attributedRows(fid, mode);
    } catch (e) {
      return { ok: false, launchCastHash, quoted, notes, reason: "the anonymous posts could not be read to quote them: " + (e as Error).message };
    }
    for (const castHash of picks.slice(0, MAX_HISTORY_QUOTES)) {
      if (quoted.includes(castHash)) continue;
      const row = rows.find((r) => r.castHash === castHash);
      if (!row || row.attributedFid !== fid || !row.attributedBatch) {
        notes.push("skipped a pick that this launch did not reveal");
        continue;
      }
      try {
        await publishFcCast(quoteCastText(row.at), "cast", undefined, { personaId, quoteOf: row.hash });
        quoted.push(castHash);
      } catch (e) {
        notes.push("a quote was refused: " + (e as Error).message);
      }
    }
  }
  return { ok: true, launchCastHash, quoted, notes };
}

export interface RevealedHistoryItem {
  castHash: string;
  networkHash: string;
  text: string;
  /** the ORIGINAL date (when @anon posted it) */
  at: number;
  revealedAt: number | null;
  label: typeof REVEALED_FROM_ANON;
  checkable: "chain" | "own-device";
}

/** the launched account's WHOLE revealed history, at the original dates — every row checked against the chain; a row
 *  that does not check is left out (and counted) */
export async function revealedHistoryFor(fid: number, mode: "fixture" | "live"): Promise<{ items: RevealedHistoryItem[]; unchecked: number }> {
  const { publicProfileForFid } = await import("@/lib/fc/personaFid");
  // fix W2-LAUNCH-REVEAL-200: the COMPLETE set of rows attributed to the account (the newest-200 list emptied the
  // history as @anon kept posting)
  const rows = (await attributedRows(fid, mode)).filter((r) => r.attributedFid === fid);
  const items: RevealedHistoryItem[] = [];
  let unchecked = 0;
  for (const r of rows) {
    const p = await publicProfileForFid(fid, r.attributedSigner ?? null).catch(() => null);
    if (!p) {
      unchecked++;
      continue;
    }
    items.push({ castHash: r.castHash, networkHash: r.hash, text: r.text, at: r.at, revealedAt: r.attributedAt, label: REVEALED_FROM_ANON, checkable: p.checkable });
  }
  items.sort((a, b) => a.at - b.at);
  return { items, unchecked };
}

export interface ProofView {
  fid: number;
  mode: "fixture";
  simulated: true;
  account: { fid: number; custody: string; recovery: string; fname: string | null; registeredAt: number } | null;
  keys: Array<{ key: string; requestFid: number; active: boolean }>;
  batches: Array<{ batchHash: string; signer: string; signature: string; castHashes: string[]; revealedAt: number; signatureChecks: boolean; keyRegistered: boolean }>;
  /** the revealed rows the batches name, at their original dates */
  posts: Array<{ castHash: string; text: string; at: number }>;
}

/** THE PROOF, from public reads only: the registrar's reveal batches for the fid, the simulated chain's account and
 *  keys, the public anon list — and, computed here, whether each batch's signature verifies and its key is registered */
export async function proofFor(fid: number): Promise<ProofView | null> {
  if (!Number.isInteger(fid) || fid <= 0) return null;
  const { chainSource } = await import("@/lib/fc/chain/source");
  const chain = chainSource("fixture");
  const [account, keys] = await Promise.all([chain.account(fid), chain.keysOf(fid)]);
  if (!account) return null;
  const { validatorUrl } = await import("@/lib/ports");
  const res = await fetch(`${validatorUrl()}/registrar/reveal-batches?mode=fixture&fid=${fid}`, { cache: "no-store" });
  if (!res.ok) throw new Error("the reveal batches could not be read (" + res.status + ")");
  const j = (await res.json()) as { batches?: Array<{ batchHash: string; signer: string; signature: string; castHashes: string[]; revealedAt: number }> };
  const active = new Set(keys.filter((k) => k.removedAt === null).map((k) => k.key.toLowerCase()));
  const batches = (j.batches ?? []).map((b) => ({
    ...b,
    signatureChecks: verifyCanonical(b.signature, revealBatchCanonical("fixture", fid, b.signer, b.castHashes), b.signer),
    keyRegistered: active.has(String(b.signer).toLowerCase()),
  }));
  const named = new Set(batches.flatMap((b) => b.castHashes));
  // fix W2-LAUNCH-REVEAL-200: the batches' posts from the COMPLETE set attributed to the account (a batch's rows are
  // attributed to its fid in the same transaction), never the newest-200 feed list
  const posts = (await attributedRows(fid, "fixture")).filter((r) => named.has(r.castHash)).map((r) => ({ castHash: r.castHash, text: r.text, at: r.at })).sort((a, b) => a.at - b.at);
  return {
    fid,
    mode: "fixture",
    simulated: true,
    account: { fid: account.fid, custody: account.custody, recovery: account.recovery, fname: account.fname, registeredAt: account.registeredAt },
    keys: keys.map((k) => ({ key: k.key, requestFid: k.requestFid, active: k.removedAt === null })),
    batches,
    posts,
  };
}
