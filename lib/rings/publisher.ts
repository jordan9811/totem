// PERSONA LAUNCH P4 — THE PUBLISHER (owner side; D8: every device that holds a ring publishes, DEVICE-SIGNED).
//
// publishOnce, on the tick when due (hourly ±25%, or at the next tick after a change): seal one envelope per
// (ring, member) — a 72-hour lease, renewed by every re-seal — pad the batch with dummies to a multiple of 4, PUT the
// new generation and, in the SAME signed request as the last batch, delete every row of the previous generation by
// its token (an atomic swap on the validator: a member's FULL read never sees a gap, and a failed PUT changes nothing).
// The operator learns: this device publishes, about how many rows (a bucket of 4), hourly; never which rows are whose.
//
// FAILURE KEEPS THE OLD ROWS. An unreadable root headshot, a refused or failed PUT: nothing of the previous generation
// is deleted, it stays live until its lease, and lastError says what happened. A partial publish (an earlier batch
// landed, a later one failed) WITHDRAWS what landed at once (it duplicates the still-live generation; left there it
// would pile up against this device's occupancy on the drop); only when that withdrawal fails is the document written,
// so the next publish deletes them. Writes go through flushVault only (never flush).
//
// ONE RING NEVER BLOCKS THE OTHERS (W2-RINGS-ONE-RING-BLOCKS-ALL): a ring whose statement no longer fits the envelope
// (a persona renamed after the up-front check, lib/rings/outbound.ts assertRingFits) is SKIPPED — its rows from the last
// publish are kept (left out of the swap's deletes, kept in `live`), the error names it — and every other ring
// publishes. The first cut threw for the whole publish, every tick, until every ring's notes lapsed at 72 hours.
//
// SEVERAL DEVICES (LP-2): the mutation re-reads the document before building (lib/rings/model.ts), and re-checks it
// right before the first PUT (assertRingsDocCurrent) — a device holding a copy another device has replaced sends
// nothing. If the seal itself is then refused (another device sealed during the PUTs) or fails, the rows this publish
// landed are deleted again by their tokens (which would otherwise be lost with the unsaved document and outlive a
// revoke for up to 72 hours).
//
// PERSONA LAUNCH GO-LIVE (UXH-9): only rings IN USE and people IN USE are sealed an envelope (lib/rings/model.ts
// visibleRings / visibleMembers) — a deleted ring and a removed person stay in the document (hide, never delete) and
// are sent NOTHING, so they count toward no row, no padding bucket and no audience. No ring this publish skips keeps
// their old rows, so the swap deletes whatever a failed delete at the removal left behind.
import { delHashOf, hourOf, newRowId, newToken, sealStatement, dummyRowParts, RingStatementTooLarge } from "./envelope";
import { DEFAULT_LEASE_HOURS, RINGS_PUBLISH_MS, assertRingsDocCurrent, loadRingsDoc, mutateRingsDoc, visibleMembers, visibleRings, type LiveRow, type RingsDoc } from "./model";

/** a DELIBERATE DUPLICATE of validator/ringdrop.js: rows per signed write (a multiple of 4 that fits the body limit) */
export const RING_DROP_ROWS_PER_WRITE = 28;
export const RING_DROP_DELETES_PER_WRITE = 256;
export const COUNT_BUCKET = 4;
export const DROP_NS = "rings:drop";

export interface PublishStatus {
  lastAttemptAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  lastRows: number;
  lastDeleted: number;
}
const g = globalThis as unknown as { __layersRingsPublish?: PublishStatus };
const pst = (): PublishStatus => (g.__layersRingsPublish ??= { lastAttemptAt: null, lastOkAt: null, lastError: null, lastRows: 0, lastDeleted: 0 });
export const publishStatus = (): PublishStatus => ({ ...pst() });
export function resetPublishStatus(): void {
  g.__layersRingsPublish = undefined;
}

export function jitteredPublishMs(base = RINGS_PUBLISH_MS): number {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return Math.round(base * (0.75 + 0.5 * (r[0] / 2 ** 32)));
}

/** pad n real rows to the next multiple of 4 (0 stays 0: a device with nothing to say publishes nothing) */
export function paddedCount(n: number): number {
  return n <= 0 ? 0 : COUNT_BUCKET * Math.ceil(n / COUNT_BUCKET);
}

/** someone IN USE in a ring IN USE (UXH-9: a deleted ring or a removed person is nobody's audience) */
export function hasAudience(d: RingsDoc): boolean {
  return visibleRings(d).some((r) => visibleMembers(r).length > 0);
}

export function isDue(d: RingsDoc, now = Date.now()): boolean {
  if (!hasAudience(d) && d.live.length === 0) return false;
  return d.publish.dirty || d.publish.nextDueAt === null || now >= d.publish.nextDueAt;
}

// ------------------------------------------------------------------------------------------------ the drop client

async function dropBase(): Promise<string> {
  const { validatorUrl } = await import("@/lib/ports");
  return validatorUrl();
}

interface WireRow {
  id: string;
  enc: string;
  ct: string;
  hint: string;
  expiresHour: number;
  delHash: string;
}

/** ONE signed write: new rows and/or delete tokens. Re-signed and retried twice on a network error or a 5xx. */
export async function putDropBatch(rows: WireRow[], deletes: string[]): Promise<{ ok: true; inserted: number; deleted: number } | { ok: false; status: number; error: string }> {
  if (rows.length % COUNT_BUCKET !== 0) return { ok: false, status: 0, error: "internal: a ring batch is not a multiple of 4" };
  return putDropRaw(rows, deletes);
}

/** the signed write itself, WITHOUT the client's own multiple-of-4 guard — for the rig's probe that the VALIDATOR
 *  refuses a batch the client would never send (app/api/rings dropProbe, dev hooks only) */
export async function putDropRaw(rows: WireRow[], deletes: string[]): Promise<{ ok: true; inserted: number; deleted: number } | { ok: false; status: number; error: string }> {
  const body = JSON.stringify({ rows, deletes });
  const { deviceSignedWriteHeaders } = await import("@/lib/adapters/mock/persist");
  let last: { ok: false; status: number; error: string } = { ok: false, status: 0, error: "not sent" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    let res: Response;
    try {
      const headers = { "content-type": "application/json", ...(await deviceSignedWriteHeaders(DROP_NS, body)) };
      res = await fetch((await dropBase()) + "/rings/drop/batch", { method: "PUT", headers, body, cache: "no-store" });
    } catch (e) {
      last = { ok: false, status: 0, error: "the ring drop could not be reached (" + (e as Error).message + ")" };
      continue;
    }
    let j: { inserted?: number; deleted?: number; error?: string } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* a body that is not JSON names nothing */
    }
    if (res.ok) return { ok: true, inserted: Number(j.inserted ?? rows.length), deleted: Number(j.deleted ?? 0) };
    last = { ok: false, status: res.status, error: `the ring drop refused it (${res.status}${j.error ? ": " + j.error : ""})` };
    if (res.status < 500 && !(res.status === 409 && /stale counter/.test(String(j.error ?? "")))) break;
  }
  return last;
}

/** delete rows by token now (a revoke). null = done; else the reason (the next publish retries) */
export async function deleteFromDrop(tokens: string[]): Promise<string | null> {
  for (let i = 0; i < tokens.length; i += RING_DROP_DELETES_PER_WRITE) {
    const r = await putDropBatch([], tokens.slice(i, i + RING_DROP_DELETES_PER_WRITE));
    if (!r.ok) return r.error;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ publish

export interface PublishResult {
  ok: boolean;
  skipped?: "not-due" | "nothing";
  rows?: number;
  real?: number;
  deleted?: number;
  error?: string;
  /** rings left out of this publish (their notes did not fit): their previous rows stay up */
  skippedRings?: string[];
}

/**
 * Publish if due (or `force`). Never throws: every failure is a result and the publish status.
 * `now` and `leaseHours` are for the harness; the tick passes nothing.
 */
export async function publishOnce(opts: { force?: boolean; now?: number; leaseHours?: number } = {}): Promise<PublishResult> {
  const status = pst();
  let doc: RingsDoc;
  try {
    doc = await loadRingsDoc();
  } catch (e) {
    status.lastError = (e as Error).message;
    return { ok: false, error: status.lastError };
  }
  const now0 = opts.now ?? Date.now();
  if (!opts.force && !isDue(doc, now0)) return { ok: true, skipped: "not-due" };
  if (!hasAudience(doc) && doc.live.length === 0) return { ok: true, skipped: "nothing" };
  status.lastAttemptAt = now0;
  // everything that can refuse BEFORE the network does so here (nothing sent, nothing written)
  let root;
  let admissible;
  try {
    const out = await import("./outbound");
    root = await out.rootForStatement();
    admissible = await out.admissiblePersonas();
  } catch (e) {
    status.lastError = "couldn't read your account's public face or your personas (" + (e as Error).message + ") — the rings were not re-sealed; the previous notes stay up until they expire";
    return { ok: false, error: status.lastError };
  }
  // the rows this publish landed on the drop, and whether its mutation got as far as the seal (LP-2 cleanup)
  let landedTokens: string[] = [];
  let reachedSeal = false;
  try {
    return await mutateRingsDoc(async (d) => {
      const now = opts.now ?? Date.now();
      const lease = opts.leaseHours ?? DEFAULT_LEASE_HOURS;
      const expiresHour = hourOf(now + lease * 3_600_000);
      const gen = d.publish.gen + 1;
      const { buildStatement } = await import("./outbound");
      const wire: WireRow[] = [];
      const fresh: LiveRow[] = [];
      const seqs: { ringId: string; memberId: string; seq: number }[] = [];
      const skipped: { id: string; label: string; error: string }[] = [];
      // UXH-9: rings in use only, people in use only — a hidden record is sealed nothing
      for (const r of visibleRings(d)) {
        // one ring at a time: a ring whose note does not fit is left out WHOLE (its last rows stay up), never the publish
        const ringWire: WireRow[] = [];
        const ringFresh: LiveRow[] = [];
        const ringSeqs: { ringId: string; memberId: string; seq: number }[] = [];
        let tooLarge: RingStatementTooLarge | null = null;
        for (const m of visibleMembers(r)) {
          const stmt = buildStatement(d, r, m, root ?? null, admissible ?? [], now, lease);
          let sealed;
          try {
            sealed = await sealStatement(stmt, m);
          } catch (e) {
            if (e instanceof RingStatementTooLarge) {
              tooLarge = e;
              break;
            }
            throw e;
          }
          const id = newRowId();
          const token = newToken();
          ringWire.push({ id, enc: sealed.enc, ct: sealed.ct, hint: sealed.hint, expiresHour, delHash: delHashOf(token) });
          ringFresh.push({ rowId: id, tokenHex: token, gen, owner: r.id + "|" + m.id, expiresHour });
          ringSeqs.push({ ringId: r.id, memberId: m.id, seq: stmt.seq });
        }
        if (tooLarge) {
          skipped.push({ id: r.id, label: r.label, error: tooLarge.message });
          continue;
        }
        wire.push(...ringWire);
        fresh.push(...ringFresh);
        seqs.push(...ringSeqs);
      }
      // PERSONA LAUNCH GO-LIVE (UXH-9): a skipped ring keeps the rows of the people IN USE in it only — a removed person's
      // row left behind by a failed delete is never "kept for" its ring (the first cut kept every row under the ring's
      // prefix, so a removal whose delete failed lasted as long as the ring kept failing to fit)
      const skippedOwners = new Set(skipped.flatMap((x) => visibleMembers(d.rings[x.id]).map((m) => x.id + "|" + m.id)));
      const keptForSkipped = (x: LiveRow) => x.owner !== null && skippedOwners.has(x.owner);
      const skippedError = skipped.length
        ? `${skipped.map((x) => `"${x.label}"`).join(", ")} can't fit what ${skipped.length === 1 ? "it shows" : "they show"} in one sealed note any more — share fewer personas with ${skipped.length === 1 ? "it" : "them"}; ${skipped.length === 1 ? "its" : "their"} people keep the last note until it runs out, and every other ring was sent`
        : null;
      const real = wire.length;
      for (let i = real; i < paddedCount(real); i++) {
        const dm = await dummyRowParts();
        const id = newRowId();
        const token = newToken();
        wire.push({ id, ...dm, expiresHour, delHash: delHashOf(token) });
        fresh.push({ rowId: id, tokenHex: token, gen, owner: null, expiresHour });
      }
      // a crypto shuffle so the order of a batch says nothing about which row is real (the drop shuffles on read too)
      for (let i = wire.length - 1; i > 0; i--) {
        const r = new Uint32Array(1);
        globalThis.crypto.getRandomValues(r);
        const j = r[0] % (i + 1);
        [wire[i], wire[j]] = [wire[j], wire[i]];
        [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
      }
      // the swap deletes the previous generation EXCEPT the rows of a ring left out above (they stay up until it fits)
      const kept = d.live.filter(keptForSkipped);
      const old = d.live.filter((x) => !keptForSkipped(x)).map((x) => x.tokenHex);
      const batches: WireRow[][] = [];
      for (let i = 0; i < wire.length; i += RING_DROP_ROWS_PER_WRITE) batches.push(wire.slice(i, i + RING_DROP_ROWS_PER_WRITE));
      if (batches.length === 0 && old.length > 0) batches.push([]);
      // LP-2: the last look before anything leaves — a copy another device replaced since the re-read sends nothing
      await assertRingsDocCurrent();
      const landed: LiveRow[] = [];
      let deleted = 0;
      for (let b = 0; b < batches.length; b++) {
        const last = b === batches.length - 1;
        // the old generation leaves with the LAST batch, in the same signed request (deletes beyond 256 follow it)
        const res = await putDropBatch(batches[b], last ? old.slice(0, RING_DROP_DELETES_PER_WRITE) : []);
        if (!res.ok) {
          // nothing of the old generation was deleted. The rows that DID land duplicate it (the previous generation is
          // still live), so they are withdrawn at once — a half-landed publish never piles up on the drop (where it
          // would count against this device's occupancy, validator/ringdrop.js) — and nothing is written. Only when the
          // withdrawal fails are they kept in the document, for the next publish to delete.
          if (landed.length > 0 && (await deleteFromDrop(landed.map((x) => x.tokenHex))) === null) {
            landedTokens = [];
            throw new PublishAbort(res.error + " (the part that went out was withdrawn again; the previous notes stay up)");
          }
          d.live = [...d.live, ...landed];
          d.publish.lastError = res.error;
          status.lastError = res.error;
          if (landed.length === 0) throw new PublishAbort(res.error);
          reachedSeal = true;
          return { ok: false, error: res.error, rows: landed.length, real, deleted: 0 };
        }
        landed.push(...fresh.slice(b * RING_DROP_ROWS_PER_WRITE, b * RING_DROP_ROWS_PER_WRITE + batches[b].length));
        landedTokens = landed.map((x) => x.tokenHex);
        if (last) deleted += res.deleted;
      }
      let leftover: string[] = [];
      if (old.length > RING_DROP_DELETES_PER_WRITE) {
        const rest = old.slice(RING_DROP_DELETES_PER_WRITE);
        const err = await deleteFromDrop(rest);
        if (err) leftover = rest;
      }
      d.live = [...landed, ...kept, ...d.live.filter((x) => leftover.includes(x.tokenHex))];
      for (const s of seqs) {
        const m = d.rings[s.ringId]?.members[s.memberId];
        if (m) m.seq = s.seq;
      }
      d.publish = { gen, lastPublishAt: now, nextDueAt: now + jitteredPublishMs(), dirty: false, lastError: skippedError, lastRows: wire.length };
      status.lastOkAt = now;
      status.lastError = skippedError;
      status.lastRows = wire.length;
      status.lastDeleted = deleted;
      reachedSeal = true;
      return { ok: true, rows: wire.length, real, deleted, ...(skipped.length ? { error: skippedError as string, skippedRings: skipped.map((x) => x.label) } : {}) };
    });
  } catch (e) {
    let msg = (e as Error).message;
    // LP-2: the document did not save (another device sealed during the PUTs, or the vault refused) — the rows this
    // publish landed are deleted again rather than left on the drop with their tokens lost (they would outlive a revoke)
    if (reachedSeal && landedTokens.length) {
      const err = await deleteFromDrop(landedTokens);
      msg += err ? ` (the notes just sent could not be withdrawn: ${err}; they run out within ${DEFAULT_LEASE_HOURS} hours)` : " (the notes just sent were withdrawn again)";
    }
    status.lastError = msg;
    return { ok: false, error: msg };
  }
}

/** a publish that sent nothing: thrown inside the mutation so the document is NOT written (nothing changed) */
class PublishAbort extends Error {}

/** the pane's line: when the next re-seal is due and how the last one went (no tokens, no keys) */
export async function publishView(): Promise<{ lastPublishAt: number | null; nextDueAt: number | null; dirty: boolean; lastError: string | null; lastRows: number; leaseHours: number; liveRows: number }> {
  const d = await loadRingsDoc();
  return { lastPublishAt: d.publish.lastPublishAt, nextDueAt: d.publish.nextDueAt, dirty: d.publish.dirty, lastError: pst().lastError ?? d.publish.lastError, lastRows: d.publish.lastRows, leaseHours: DEFAULT_LEASE_HOURS, liveRows: d.live.length };
}
