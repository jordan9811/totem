import "server-only";
// MEGA PASS 2 Gate 5 — @totem ON X: THE DM-TO-BOOKMARK HOOK.
//
// A user DMs a tweet link to the Totem X account. The inbox adapter reads
// the account's DMs (on demand — never a background poll; every read
// through the spend ledger at the read rate, ≤ $1 live, fixture otherwise),
// resolves the SENDER's linked, attested X handle → their persona → their
// vault, and lands the tweet in their cross-platform bookmarks under a
// "From X DM" folder, from where the readwise populator drips it into
// their feed at the cadence their mode sets.
//
// UNLINKED SENDERS get a reply telling them to link their X account first
// (fixture: recorded, never sent; live: this pass is READ-ONLY on X, so the
// reply is recorded as "would send", named as such) and NOTHING is stored
// for them — not the DM, not the handle, not the link.
//
// PRIVACY: the validator holds sender-handle → persona only as the EXISTING
// attestation (xAttestations); the DM's content is written straight into
// the recipient's vault (xImportedPrivate, a sealed namespace) and never
// persisted server-side in plaintext (the Gate 5 suite greps the DB).
import { createHash } from "@/lib/platform/crypto";
import fixtureDmsBank from "@/fixtures/x-dms.json";
import { bank } from "@/lib/world";
// LAYERS_WORLD=empty (lib/world.ts): the fixture inbox's DMs are bank content — none under the flag
const fixtureDms = bank(fixtureDmsBank as unknown, { pages: [] } as unknown);
import { vaultKeyBytes } from "@/lib/identity/keystore";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaById, persistNs, postByHash, state, type SeedPost } from "@/lib/adapters/mock/store";
import { withMockLatency } from "@/lib/adapters/mockUtils";
import { attestationByHandle, attestationFor, canonicalHandle } from "./attestations";
import { guardedRead } from "./spend";
import type { ImportedPrivate } from "./importer";

export interface InboundDm {
  id: string;
  senderHandle: string;
  text: string;
  at: number;
  tweetUrl: string | null;
  tweetId: string | null;
  tweetAuthor: string | null;
  tweetText: string | null;
}

/** THE ADAPTER: the Totem account's inbox, read on demand. */
export interface LayersInboxAdapter {
  mode: "fixture" | "live";
  /** one page of DM events after `cursor`; `requests` is what the read cost in API calls */
  poll(cursor: number): Promise<{ dms: InboundDm[]; cursor: number; requests: number; exhausted: boolean }>;
  /** the reply to an unlinked sender — recorded, never sent in this pass */
  reply(dmId: string, text: string): Promise<{ recorded: true; sent: false }>;
}

export const DM_FOLDER_NAME = "From X DM";
export const UNLINKED_REPLY = "This is the Totem bookmark hook. Link your X account in Totem first (Settings → Import from X), then send me links and they'll land in your bookmarks.";
export const INBOX_CURSOR_KEY = "layers-inbox";
/** the synthetic post hash a DM-sourced item lives under. OPAQUE: salted with this device's vault key, so the folder
 * row and the schedule row the validator holds in plain namespaces name a tweet the operator cannot identify —
 * the tweet id itself is public on X, and "this persona was DMed that tweet" would be a reading-interest
 * fingerprint. Only the vault record (sealed) carries the id and the text. */
export function dmPostHash(tweetId: string, personaId: string): string {
  // attack-mega-3 F1: PERSONA-scoped. The vault key is root-scoped, so without the persona in the message two personas
  // of one root that bookmark the same tweet would share a hash — and the plain folder rows would join them by it.
  return "dm:" + createHash("sha256").update("layers-dm-item/1|" + personaId + "|" + tweetId + "|").update(vaultKeyBytes()).digest("hex").slice(0, 16);
}


/** live = the Totem account's own read token exists; otherwise the recorded shapes */
export function inboxMode(): "fixture" | "live" {
  return process.env.X_API_CLIENT_ID && process.env.X_LAYERS_INBOX_TOKEN && process.env.ENABLE_X_READ === "true" ? "live" : "fixture";
}

/** fixture only: the $LINKED sender is the ACTIVE persona's own linked handle when it has one (so a second persona
 * of the root can exercise the same page — the linkage rig), else the first handle attested in this device's state */
async function firstAttestedHandle(): Promise<string | null> {
  try {
    const { activeSeedPersonaId } = await import("@/lib/activePersona");
    const mine = linkedHandleFor(activeSeedPersonaId());
    if (mine) return mine;
  } catch {
    /* no request context (replay at boot) — fall through */
  }
  for (const a of state().xAttestations.values()) return a.handle;
  return null;
}

export const fixtureInbox: LayersInboxAdapter = {
  mode: "fixture",
  async poll(cursor) {
    const pages = (fixtureDms as unknown as { pages: InboundDm[][] }).pages;
    const page = pages[cursor] ?? [];
    const linked = await firstAttestedHandle();
    const dms = page.map((d) => ({ ...d, senderHandle: d.senderHandle === "$LINKED" ? (linked ?? "unlinked-tester") : d.senderHandle }));
    return withMockLatency(() => ({ dms, cursor: cursor + 1, requests: 1, exhausted: cursor + 1 >= pages.length }), { label: "x.inbox.poll" });
  },
  async reply() {
    return { recorded: true, sent: false };
  },
};

/** the live adapter: X API v2 dm_events, READ-ONLY. Replies are never sent by this pass. */
export function liveInbox(): LayersInboxAdapter {
  const token = process.env.X_LAYERS_INBOX_TOKEN ?? "";
  return {
    mode: "live",
    async poll(cursor) {
      const url = new URL("https://api.x.com/2/dm_events");
      url.searchParams.set("dm_event.fields", "id,text,created_at,sender_id,referenced_tweets");
      url.searchParams.set("expansions", "sender_id,referenced_tweets.id");
      url.searchParams.set("user.fields", "username");
      url.searchParams.set("tweet.fields", "text,author_id");
      url.searchParams.set("max_results", "20");
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!res.ok) throw new Error(`X inbox read refused: HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { id: string; text: string; created_at: string; sender_id: string; referenced_tweets?: { id: string }[] }[]; includes?: { users?: { id: string; username: string }[]; tweets?: { id: string; text: string; author_id: string }[] } };
      const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));
      const tweets = new Map((json.includes?.tweets ?? []).map((t) => [t.id, t]));
      const dms: InboundDm[] = (json.data ?? []).map((e) => {
        const ref = e.referenced_tweets?.[0]?.id ?? null;
        const t = ref ? tweets.get(ref) : undefined;
        const m = e.text.match(/https?:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/);
        return {
          id: e.id,
          senderHandle: users.get(e.sender_id) ?? e.sender_id,
          text: e.text,
          at: Date.parse(e.created_at),
          tweetUrl: m ? m[0] : null,
          tweetId: ref ?? (m ? m[2] : null),
          tweetAuthor: t ? (users.get(t.author_id) ?? null) : m ? m[1] : null,
          tweetText: t?.text ?? null,
        };
      });
      return { dms, cursor: cursor + 1, requests: 1, exhausted: dms.length === 0 };
    },
    async reply() {
      return { recorded: true, sent: false };
    },
  };
}

export function inbox(): LayersInboxAdapter {
  return inboxMode() === "live" ? liveInbox() : fixtureInbox;
}

/** PERSONA LAUNCH P8 — the inbox's status for Settings, READ-ONLY: which mode it runs in and the plain sentence for it.
 *  Never reads the inbox, never touches the ledger or a cursor. In the fixture mode every word says it is test data (the
 *  owner rule: never present test data as live); "live" is said only when the read token and the arming flag are set. */
export function inboxStatus(): { mode: "fixture" | "live"; testData: boolean; sentence: string } {
  const mode = inboxMode();
  return mode === "live"
    ? { mode, testData: false, sentence: "DM a tweet to @totem to save it: reads from X, on demand, read-only." }
    : { mode, testData: true, sentence: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." };
}

// ------------------------------------------------------------ the replies log (session only)

export interface ReplyRecord {
  dmId: string;
  /** the sender, HASHED — nothing is stored about an unlinked sender, not even the handle */
  senderHash: string;
  kind: "unlinked";
  text: string;
  at: number;
  sent: false;
}
const g = globalThis as unknown as { __layersInboxReplies?: ReplyRecord[] };
const replies = (): ReplyRecord[] => (g.__layersInboxReplies ??= []);
export function inboxReplies(): ReplyRecord[] {
  return [...replies()];
}
export function resetInboxReplies(): void {
  g.__layersInboxReplies = [];
}
/** dev rig: read the fixture inbox from page 0 again (the same-tweet, two-personas linkage check) */
export async function resetInboxCursor(): Promise<void> {
  state().xSyncCursor.delete(INBOX_CURSOR_KEY);
  await persistNs("xSyncCursor");
}
// attack-mega-3 F3: keyed with the vault key — an unkeyed hash over a 15-character handle space is a dictionary away
const senderHash = (h: string) => createHash("sha256").update("layers-inbox-sender/1|" + canonicalHandle(h) + "|").update(vaultKeyBytes()).digest("hex").slice(0, 12);

// ------------------------------------------------------------ synthetic posts for the readwise/folder slots

const injected = new Set<string>();
function injectDmPost(item: ImportedPrivate, author: string | null): void {
  const hash = dmPostHash(item.tweetId, item.personaId);
  const post: SeedPost = {
    hash,
    authorAccId: "",
    authorPersonaId: item.personaId,
    text: item.text,
    minutesAgo: Math.max(1, Math.round((Date.now() - item.importedAt) / 60_000)),
    replyToHash: null,
    quoteOfHash: null,
    storyId: null,
    isUpdate: false,
    truncate: item.text.length > 280,
    replies: 0,
    likes: 0,
    recasts: 0,
    views: 0,
  };
  void author;
  postByHash.set(hash, post);
  injected.add(hash);
}
/** restart-survival replay: DM-sourced items live in the vault (xImportedPrivate); postByHash is rebuilt from the seed */
export function replayDmPosts(): void {
  for (const item of state().xImportedPrivate.values()) if (item.provenance === "x-dm") injectDmPost(item, null);
}
export function purgeDmPosts(): void {
  for (const h of injected) postByHash.delete(h);
  injected.clear();
}
/** the tweet author a DM-sourced item came from — for the readwise attribution line */
export function dmSourceLabelForHash(hash: string): string | null {
  if (!hash.startsWith("dm:")) return null;
  const item = state().xImportedPrivate.get(hash);
  const author = item?.id.split("|")[1];
  return author ? `X DM · @${author}` : "X DM";
}

// ------------------------------------------------------------ ingestion

export interface IngestResult {
  mode: "fixture" | "live";
  cost: number;
  polled: number;
  landed: { dmId: string; personaId: string; hash: string; folderId: string }[];
  replied: { dmId: string }[];
  skipped: { dmId: string; reason: string }[];
  cursor: number;
  exhausted: boolean;
}

/** ONE on-demand poll of the Totem inbox: every read through the ledger; linked senders' links land in their vault
 * folder and their readwise queue; unlinked senders get the (recorded) reply and nothing is stored. Idempotent by
 * tweet id — the same DM polled twice lands once. */
export async function ingestInbox(): Promise<IngestResult> {
  const ad = inbox();
  const s = state();
  // LAYERS_WORLD=empty (review WE-4): this cursor is read WHOLE — xSyncCursor is never partitioned (lib/world.ts
  // WHOLE_NAMESPACES). Its key names no persona, so the partition hid it, this read fell back to 0, the ledger's
  // idempotency key below became one it had already recorded (a live read went uncounted), and the write at the end
  // put the rewound value over the stored one. A receipt cursor must always be the stored one.
  const cursor = s.xSyncCursor.get(INBOX_CURSOR_KEY) ?? 0;
  // the costed read happens FIRST and through the ledger — if the cap refuses, nothing is fetched and the cursor stays
  const { cost } = await guardedRead({ idempotencyKey: `inbox:${INBOX_CURSOR_KEY}:${cursor}`, requests: 1, note: `@totem inbox poll page ${cursor} (${ad.mode})` });
  const page = await ad.poll(cursor);
  const out: IngestResult = { mode: ad.mode, cost, polled: page.dms.length, landed: [], replied: [], skipped: [], cursor: page.cursor, exhausted: page.exhausted };
  for (const dm of page.dms) {
    const att = attestationByHandle(dm.senderHandle);
    if (!att) {
      // the funnel: tell them to link, store nothing
      await ad.reply(dm.id, UNLINKED_REPLY);
      replies().push({ dmId: dm.id, senderHash: senderHash(dm.senderHandle), kind: "unlinked", text: UNLINKED_REPLY, at: Date.now(), sent: false });
      out.replied.push({ dmId: dm.id });
      continue;
    }
    if (!dm.tweetId) {
      out.skipped.push({ dmId: dm.id, reason: "no tweet link" });
      continue;
    }
    const personaId = att.personaId;
    const hash = dmPostHash(dm.tweetId, personaId);
    if (!s.xImportedPrivate.has(hash)) {
      const item: ImportedPrivate = {
        id: `dm:${dm.tweetId}|${dm.tweetAuthor ?? ""}`,
        kind: "bookmark",
        personaId,
        tweetId: dm.tweetId,
        text: dm.tweetText ?? dm.text,
        provenance: "x-dm",
        importedAt: Date.now(),
      };
      // keyed by the synthetic post hash so the folder, the schedule and the vault record all name one thing
      s.xImportedPrivate.set(hash, item);
      await persistNs("xImportedPrivate");
      injectDmPost(item, dm.tweetAuthor);
    }
    // the folder: this persona's "From X DM", created on first use, private
    const folders = await retryAdapter(() => adapters.space.listFolders(personaId));
    let folder = folders.find((f) => f.ownerPersonaId === personaId && f.name === DM_FOLDER_NAME);
    if (!folder) folder = await retryAdapter(() => adapters.space.createFolder({ name: DM_FOLDER_NAME, ownerPersonaId: personaId, isPublic: false, postHashes: [] }));
    if (!folder.postHashes.includes(hash)) await retryAdapter(() => adapters.space.addToFolder(folder!.id, hash));
    // the readwise queue: the tweet's text, chunked and dripped at the mode's cadence
    const existing = await retryAdapter(() => adapters.feedHealth.getReadwiseSchedules(personaId));
    if (!existing.some((r) => r.postHash === hash)) await retryAdapter(() => adapters.feedHealth.scheduleReadwise(hash, personaId, postByHash.get(hash)?.text ?? dm.text));
    out.landed.push({ dmId: dm.id, personaId, hash, folderId: folder.id });
  }
  s.xSyncCursor.set(INBOX_CURSOR_KEY, page.cursor);
  await persistNs("xSyncCursor");
  return out;
}

// ------------------------------------------------------------ cadence (per mode)

export interface DmReadwiseSettings {
  /** surface a DM-sourced chunk every N feed builds (1 = every build) */
  every: number;
  appearance: "chunk" | "full";
}
export const DEFAULT_DM_READWISE: DmReadwiseSettings = { every: 1, appearance: "chunk" };

const ticks = new Map<string, number>();
/** counts feed builds per (persona, mode); DM-sourced readwise cards surface when the count hits the mode's `every` */
export function dmCadenceDue(personaId: string, modeId: string, every: number): boolean {
  const key = personaId + "|" + modeId;
  const n = (ticks.get(key) ?? 0) + 1;
  ticks.set(key, n);
  const e = Math.max(1, Math.min(20, Math.floor(every || 1)));
  return n % e === 0;
}
export function resetDmCadence(): void {
  ticks.clear();
}

/** the linked handle for the settings page's own explanation */
export function linkedHandleFor(personaId: string): string | null {
  return attestationFor(personaId)?.handle ?? null;
}
export { personaById };
