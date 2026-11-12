// PERSONA LAUNCH P4 — THE RINGS PART OF EVERY PREFETCH TICK (lib/zk/prefetch.ts runTick calls it for EVERY device,
// every tick, rings or not — the fetch pattern carries no information about who holds an address or a ring).
//
//   1. the "rings" document: on a device's FIRST tick written padded (empty but for this device's spare addresses —
//      every device holds one), then RE-READ (LP-2: one signed read, every tick, every device, rings or none — a newer
//      copy another device of this root sealed is adopted before anything below uses it)
//   2. GET /rings/drop (plain, unsigned) → applyFetch: FULL or FAILED, exactly as lib/rings/received.ts says
//   3. GET the public /zk/anon-casts list → trial-open each row's note with every received key → castHash → reveal
//   4. the chrome document (compartment mode) read on the schedule, so the render seams never fetch
//   5. the inbox upkeep (LP-3, lib/rings/inbox.ts): at its random moment, one write keeps claimed addresses and makes
//      spares — never at the moment an address is handed out
//   6. publish if due (lib/rings/publisher.ts)
//
// It NEVER throws into the tick: every step's failure is recorded here (the panes show it) and the next tick retries.
// Every device makes the same three reads; only a device that holds a ring member ever writes to the drop.
import type { ZkMode } from "@/lib/zk/config";

export interface RingsTickReport {
  at: number;
  mode: ZkMode;
  doc: "ok" | "written" | "refreshed" | string;
  drop: "full" | string;
  anonList: "ok" | string;
  opened: number;
  dropped: number;
  matched: number;
  inbox: string;
  publish: string;
  ms: number;
}

const g = globalThis as unknown as { __layersRingsTicks?: RingsTickReport[]; __layersRingsTickChain?: Promise<unknown> };
export function ringsTickLog(): RingsTickReport[] {
  return [...(g.__layersRingsTicks ?? [])];
}
export function resetRingsTickLog(): void {
  g.__layersRingsTicks = [];
}


/** ONE rings tick at a time in a process: the schedule's tick, a rig's forced tick and a device's DEBUG tick queue behind
 *  each other (two concurrent reads of the drop would interleave their record updates) */
export function ringsTick(mode: ZkMode): Promise<RingsTickReport> {
  const prior = g.__layersRingsTickChain ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(() => ringsTickOnce(mode));
  g.__layersRingsTickChain = run.catch(() => undefined);
  return run;
}

async function ringsTickOnce(mode: ZkMode): Promise<RingsTickReport> {
  const t0 = Date.now();
  const report: RingsTickReport = { at: t0, mode, doc: "ok", drop: "not read", anonList: "not read", opened: 0, dropped: 0, matched: 0, inbox: "not run", publish: "not due", ms: 0 };
  const model = await import("./model");
  const received = await import("./received");
  // 1. the document: the first-tick write (with this device's spares), then the uniform re-read (LP-2)
  let doc: import("./model").RingsDoc | null = null;
  try {
    const { mintSparesInto } = await import("./inbox");
    const wrote = await model.ensureRingsDocWritten(async (d) => {
      // spares ride the one write every device makes; a linked device (no seed) or a keystore that cannot answer
      // writes the same padded document without them (the upkeep makes them later)
      await mintSparesInto(d).catch(() => 0);
    });
    const r = await model.refreshRingsDoc();
    doc = r.doc;
    report.doc = wrote ? "written" : r.adopted ? "refreshed" : "ok";
  } catch (e) {
    report.doc = "unreadable: " + (e as Error).message;
  }
  // 2. the drop — fetched WHETHER OR NOT the document could be read (the read pattern never depends on local state)
  try {
    const { fetchRingDrop } = await import("./fetch");
    const result = await fetchRingDrop();
    if (doc) {
      let keys: import("./envelope").InboxKey[] = [];
      let keysError: string | null = null;
      try {
        const { activeInboxKeys } = await import("./inbox");
        keys = await activeInboxKeys(doc);
      } catch (e) {
        keysError = (e as Error).message;
      }
      if (keysError) {
        // no keys this tick (a linked device, an unreadable keystore): nothing is opened, nothing is dropped
        await received.applyFetch({ full: false, error: keysError, at: result.at }, []);
        report.drop = "keys: " + keysError;
      } else {
        const r = await received.applyFetch(result, keys);
        report.drop = r.full ? "full" : (result as { error?: string }).error ?? "failed";
        report.opened = r.opened;
        report.dropped = r.dropped;
      }
    } else {
      await received.applyFetch({ full: false, error: "your rings could not be read", at: result.at }, []);
      report.drop = result.full ? "read, not applied (document unread)" : (result as { error: string }).error;
    }
  } catch (e) {
    report.drop = "error: " + (e as Error).message;
  }
  // 3. the anon list, every tick, and the trial-open of every note
  try {
    const { fetchAnonCasts } = await import("@/lib/zk/validatorClient");
    let casts: { castHash: string; note?: string | null }[] | null = null;
    let err: string | null = null;
    try {
      casts = (await fetchAnonCasts(mode)) as unknown as { castHash: string; note?: string | null }[];
    } catch (e) {
      err = (e as Error).message;
    }
    const r = received.applyAnonList(mode, casts, err);
    report.anonList = casts ? "ok" : (err ?? "failed");
    report.matched = r.matched;
  } catch (e) {
    report.anonList = "error: " + (e as Error).message;
  }
  // 4. compartment mode, read on the schedule (the render seams read the in-process copy and never fetch)
  try {
    const { viewScope } = await import("@/lib/identity/chrome");
    await viewScope("", []);
  } catch {
    /* unread: the seams treat an unread chrome document as compartment ON (no merge shown) */
  }
  // 5. the inbox upkeep, at its random moment (LP-3)
  if (doc) {
    try {
      const { inboxUpkeep } = await import("./inbox");
      report.inbox = await inboxUpkeep();
    } catch (e) {
      report.inbox = "error: " + (e as Error).message;
    }
  }
  // 6. publish if due
  if (doc) {
    try {
      const { publishOnce } = await import("./publisher");
      const p = await publishOnce();
      report.publish = p.skipped ? p.skipped : p.ok ? `published ${p.rows} rows (${p.real} real)` : "failed: " + p.error;
    } catch (e) {
      report.publish = "error: " + (e as Error).message;
    }
  }
  report.ms = Date.now() - t0;
  const log = (g.__layersRingsTicks ??= []);
  log.push(report);
  if (log.length > 30) log.shift();
  return report;
}

/**
 * THE RESET CONTRACT (lib/device/boot.ts reloadIdentity, app/api/dev/route.ts resetSeed): every rings cache in this
 * process — the sealed document, the hydrate's copy of it, the derived inbox keys, what was received, the reveal map,
 * the publish status, the tick log. A cache left behind would run the next root on the previous root's rings and the
 * next write would seal them into the new root's vault (the root-mixing bug). `knownEmpty`: the seed reset just wiped
 * the validator's copy, so the document IS the empty one (the next tick writes it).
 */
export async function resetRingsCaches(opts: { knownEmpty?: boolean } = {}): Promise<void> {
  (await import("./model")).resetRingsDocCache(opts);
  (await import("@/lib/adapters/mock/persist")).forgetHydratedNamespace("rings");
  (await import("./inbox")).resetInboxCache();
  (await import("./received")).resetReceived();
  (await import("./publisher")).resetPublishStatus();
  resetRingsTickLog();
}
