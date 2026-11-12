import "server-only";
// OWNED-READS SYNC — incremental pull of the linked account's new bookmarks
// and follow changes. ON-DEMAND only this pass (a button, no background
// polling), every request through the spend ledger, incremental via a
// cursor so a second sync pulls only what is new.
//
// Fixture shapes match X API v2 (GET /2/users/:id/bookmarks, follow deltas
// derived from GET /2/users/:id/following) — FIXTURE-VERIFIED, and the
// response says which mode ran.
import { state, persistNs } from "@/lib/adapters/mock/store";
import { withMockLatency } from "@/lib/adapters/mockUtils";
import { attestationFor } from "./attestations";
import { hashPlatformId } from "./importer";
import { guardedRead } from "./spend";

/** Recorded fixture deltas, cursor-indexed: page 0 has new items, later
 * pages are empty — the incremental contract in miniature. */
const FIXTURE_BOOKMARK_PAGES: { tweetId: string; text: string }[][] = [
  [
    { tweetId: "1960000000000000001", text: "synced: the sequencer decentralization postmortem" },
    { tweetId: "1960000000000000002", text: "synced: LRT risk dashboards compared" },
  ],
];
const FIXTURE_FOLLOW_PAGES: string[][] = [["1100999888777666555"]];

export interface SyncResult {
  /** PERSONA LAUNCH P2 (BYX G0): only ever "fixture" — live owned-reads sync is not built */
  mode: "fixture";
  kind: "bookmarks" | "follows";
  newItems: number;
  cost: number;
  cursor: number;
}

export async function syncOwnedReads(
  personaId: string,
  kind: "bookmarks" | "follows"
): Promise<SyncResult> {
  const attestation = attestationFor(personaId);
  if (!attestation) throw new Error("owned-reads sync requires a linked X account");
  const s = state();
  const cursorKey = personaId + ":" + kind;
  const cursor = s.xSyncCursor.get(cursorKey) ?? 0;
  // PERSONA LAUNCH P2 (BYX G0, the honesty gate): this used to report "live" whenever X_API_CLIENT_ID was set — while
  // still serving the FIXTURE pages below. Live sync is not built, so a configured client id is a refusal, never a
  // live label over recorded data (X_API_CLIENT_ID is also on the must-not-ship list of a public deployment).
  if (process.env.X_API_CLIENT_ID)
    throw new Error("live X sync is not built - refusing to run fixture pages under a live label");
  const mode: SyncResult["mode"] = "fixture";

  // the costed read happens FIRST and through the ledger — if the cap
  // refuses, nothing is fetched and the cursor does not move
  const { cost } = await guardedRead({
    idempotencyKey: `sync:${cursorKey}:${cursor}`,
    requests: 1,
    note: `owned-reads sync (${kind}) page ${cursor} for @${attestation.handle}`,
  });

  let newItems = 0;
  if (kind === "bookmarks") {
    const page = await withMockLatency(() => FIXTURE_BOOKMARK_PAGES[cursor] ?? [], {
      label: "x.sync.bookmarks",
    });
    for (const b of page) {
      const id = "bookmark:" + b.tweetId;
      const key = personaId + ":" + id;
      if (!s.xImportedPrivate.has(key)) {
        s.xImportedPrivate.set(key, {
          id,
          kind: "bookmark",
          personaId,
          tweetId: b.tweetId,
          text: b.text,
          provenance: "x-sync",
          importedAt: Date.now(),
        });
        newItems++;
      }
    }
    await persistNs("xImportedPrivate");
  } else {
    const page = await withMockLatency(() => FIXTURE_FOLLOW_PAGES[cursor] ?? [], {
      label: "x.sync.follows",
    });
    for (const accountId of page) {
      const hashed = hashPlatformId(accountId);
      const key = personaId + ":" + hashed;
      if (!s.xMigrationSource.has(key)) {
        s.xMigrationSource.set(key, {
          hashedId: hashed,
          personaId,
          importedAt: Date.now(),
          migrated: false,
          excluded: false,
        });
        newItems++;
      }
    }
    await persistNs("xMigrationSource");
  }

  s.xSyncCursor.set(cursorKey, cursor + 1);
  await persistNs("xSyncCursor");
  return { mode, kind, newItems, cost, cursor: cursor + 1 };
}
