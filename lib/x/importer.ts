import "server-only";
// THE ARCHIVE IMPORTER — sessions, lanes, and the rules that keep an import honest.
//
// PERSONA LAUNCH P2 (BYX G3) rewrote it around one fact: the archive itself never reaches here. The browser page reads
// the ZIP or folder (lib/x/archiveZip.ts) and sends PARSED lanes — the account's four facts, posts, followed ids,
// likes, interest names — which STAGE in this process's memory under a session. Nothing raw is kept anywhere: a
// session record carries file NAMES and counts, never content (a session stored before the change had raw files,
// email and phone among them; store.ts drops them on load). On commit the lanes land in the sealed, chunked X
// documents (lib/x/shelf.ts xShelf + xArchive, lib/x/follows.ts xFollows) and in the graph (personalization).
//
// The rules, all kept from the first importer unless said otherwise:
//   * Preview counts are the commit counts: the preview is computed from the staged lanes, and commit writes exactly
//     those records (put-by-id per persona: a second import of the same archive lands zero new records).
//   * "Verified import" is EARNED: the archive's own account must match a VERIFYING link on the receiving persona —
//     a Farcaster verification of the same X account id (lib/x/identity.ts), or a real OAuth link (not built). A
//     fixture link is a TEST link and never verifies (BYX G0); everything else lands "self-supplied, unverified".
//   * The following lane needs the fingerprint warning ACKNOWLEDGED (a follow list says who you are), and a private
//     persona never takes it (private personas never follow anyone on Farcaster; they keep a shelf only).
//   * Caps: X_IMPORT_MAX_POSTS (20,000), X_IMPORT_MAX_FOLLOWS (10,000), X_IMPORT_MAX_LIKES (500; the likes lane is off
//     by default). Over a cap the lane is REFUSED with the number, unless the person chose "import the newest N";
//     nothing partial is kept.
//   * Sensitive personalization items NEVER auto-import: they queue behind the per-category graph consent, default off.
//   * The bookmarks lane is gone: no X archive source lists a bookmarks file.
//   * Staging is in memory: a session whose process restarted before Import has to be given the file again (the
//     page says so; nothing partial was kept). Sessions themselves persist, so the page can say exactly that.
import { createHash } from "@/lib/platform/crypto";
import { state, persistNs, hydrate } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import type { ClaimCategory } from "@/lib/adapters/types";
import { isPrivatePersona } from "@/lib/identity/personaKind";
import { attestationFor, attestationIsVerifying, isUnlinkedSource, type AccountAttestation } from "./attestations";
import {
  classifyInterest,
  parseAccount,
  parseFollowing,
  parseLikes,
  parsePersonalizationNames,
  parseTweetsDetailed,
  X_ID_RE,
  type ArchiveAccount,
  type ArchiveInterest,
  type ArchiveLike,
  type ArchiveTweet,
} from "./archiveParse";
import { loadShelf, postsOf, readablePersona, shelfSync, updateArchiveMeta, updateShelf, type ShelfPost } from "./shelf";
import { loadFollows, updateFollows } from "./follows";
import { UNCHANGED } from "@/lib/vault/chunkedDoc";

export const IMPORT_LANES = ["posts", "likes", "following", "personalization"] as const;
export type ImportLane = (typeof IMPORT_LANES)[number];

/** the per-lane caps (env, never below 1) */
export function importLimits(): { maxPosts: number; maxFollows: number; maxLikes: number } {
  const n = (name: string, dflt: number) => {
    const v = Number((process.env[name] ?? "").trim());
    return Number.isSafeInteger(v) && v > 0 ? v : dflt;
  };
  return { maxPosts: n("X_IMPORT_MAX_POSTS", 20000), maxFollows: n("X_IMPORT_MAX_FOLLOWS", 10000), maxLikes: n("X_IMPORT_MAX_LIKES", 500) };
}

/** staging is bounded even when "import the newest N" was chosen (the page sends only the newest N) */
const STAGE_CEILING = 250_000;
/** one call carries at most this many records (the page batches) */
export const BATCH_LIMITS = { posts: 500, following: 2000, likes: 500, interests: 2000 } as const;

export interface ImportCounts {
  posts: number;
  retweets: number;
  replies: number;
  following: number;
  likes: number;
  interests: number;
}

export interface ImportSession {
  id: string;
  /** the receiving persona chosen at begin (commit may name another of the viewer's own) */
  personaId: string;
  archiveHandle: string | null; // from account.js once staged
  archiveAccountId: string | null;
  /** the preview's answer: would this archive land as a VERIFIED import on its persona */
  verified: boolean;
  status: "staging" | "previewed" | "committed" | "discarded";
  /** the archive files the page read — NAMES only */
  filesSeen: string[];
  counts: ImportCounts;
  committedLanes: ImportLane[];
  createdAt: number;
  /** the rig's fixture archive (ingestFixture): its following lane also feeds the rig-only Totem-local matcher */
  fixture?: boolean;
}

/** LEGACY shape (the store namespace `xImportedPosts`, and what importedPostsFor answers) */
export interface ImportedPost {
  id: string; // x tweet id — the idempotency key
  personaId: string;
  text: string;
  createdAt: number; // ORIGINAL timestamp — always preserved, resurfacing never touches it
  replyToId: string | null;
  links: string[];
  favoriteCount: number;
  retweetCount: number;
  provenance: "x-archive";
  importedAt: number;
  archiveHandle: string;
  verified: boolean;
  /** UX Gate 0: default false. An import is history until the user
   * explicitly promotes it to post-as-new — never the reverse. */
  resurfaced: boolean;
  /** set when resurfaced === true: the FRESH timestamp it enters feeds
   * under. Distinct from createdAt, which stays the original X date. */
  resurfacedAt: number | null;
  /** PERSONA LAUNCH P2: "RT @…" */
  isRetweet?: boolean;
}

export interface ImportedPrivate {
  id: string; // `${kind}:${tweetId}` — idempotency key
  kind: "like" | "bookmark";
  personaId: string;
  tweetId: string;
  text: string;
  /** MEGA PASS 2 Gate 5: "x-dm" — a link DMed to the Totem account by this persona's linked X handle */
  provenance: "x-archive" | "x-sync" | "x-dm";
  importedAt: number;
}

export function hashPlatformId(accountId: string): string {
  return createHash("sha256").update("x-follow:" + accountId).digest("hex");
}

/** a refusal the route answers 409 with — the person's sentence, never a 503 */
export class ImportRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImportRefusal";
    this.code = code;
  }
}

// ------------------------------------------------------------------------------------------------ staging (memory)

interface Staged {
  account: ArchiveAccount | null;
  posts: Map<string, ArchiveTweet>;
  following: Set<string>;
  likes: Map<string, ArchiveLike>;
  interests: string[];
  /** what the page said each lane's archive total is (for the over-cap sentence) */
  totals: { posts: number; following: number; likes: number };
  newestOnly: { posts: boolean; following: boolean; likes: boolean };
}

const g = globalThis as unknown as { __layersXStaging?: Map<string, Staged> };
const staging = (): Map<string, Staged> => (g.__layersXStaging ??= new Map<string, Staged>());

/** forget every staged lane (the store's reset path; staged data is never persisted) */
export function resetImportStaging(): void {
  staging().clear();
}

const zeroCounts = (): ImportCounts => ({ posts: 0, retweets: 0, replies: 0, following: 0, likes: 0, interests: 0 });

function countsOf(st: Staged): ImportCounts {
  let retweets = 0;
  let replies = 0;
  for (const p of st.posts.values()) {
    if (p.isRetweet) retweets++;
    else if (p.replyToId) replies++;
  }
  return { posts: st.posts.size, retweets, replies, following: st.following.size, likes: st.likes.size, interests: st.interests.length };
}

function sessionOf(sessionId: string): ImportSession {
  const session = state().xImportSessions.get(String(sessionId));
  if (!session) throw new ImportRefusal("unknown_session", "unknown import session");
  return session;
}

function stagedOf(session: ImportSession): Staged {
  if (session.status === "committed") throw new ImportRefusal("committed", "session already committed");
  if (session.status === "discarded") throw new ImportRefusal("discarded", "this import was cancelled; start again by dropping the archive in");
  const st = staging().get(session.id);
  if (!st)
    throw new ImportRefusal(
      "staging_lost",
      "This import was started before Totem restarted, so its file has to be read again: drop the archive in once more. Nothing was kept."
    );
  return st;
}

async function touch(session: ImportSession, st: Staged): Promise<void> {
  session.counts = countsOf(st);
  if (session.status === "previewed") session.status = "staging";
  await persistNs("xImportSessions");
}

export async function newImportSession(personaId: string, opts: { fixture?: boolean } = {}): Promise<ImportSession> {
  await hydrate();
  const s = state();
  const session: ImportSession = {
    id: "ximp_" + createHash("sha256").update(personaId + ":" + s.seq++ + ":" + Date.now() + ":" + Math.random()).digest("hex").slice(0, 12),
    personaId,
    archiveHandle: null,
    archiveAccountId: null,
    verified: false,
    status: "staging",
    filesSeen: [],
    counts: zeroCounts(),
    committedLanes: [],
    createdAt: Date.now(),
    ...(opts.fixture ? { fixture: true } : {}),
  };
  s.xImportSessions.set(session.id, session);
  staging().set(session.id, {
    account: null,
    posts: new Map(),
    following: new Set(),
    likes: new Map(),
    interests: [],
    totals: { posts: 0, following: 0, likes: 0 },
    newestOnly: { posts: false, following: false, likes: false },
  });
  await persistNs("xImportSessions");
  return session;
}

/**
 * How an archive's account is linked to a persona, as the shelf says it: "verified" only through a VERIFYING link of
 * the same account (a Farcaster verification must name the same X account id); a fixture link reads "test link".
 */
export function linkStatusFor(personaId: string, account: { username: string; accountId: string } | null): {
  verified: boolean;
  verifiedBy: AccountAttestation["method"] | null;
  testLink: boolean;
} {
  const a = attestationFor(personaId);
  if (!a || !account || a.handle !== account.username.toLowerCase()) return { verified: false, verifiedBy: null, testLink: false };
  if (a.method === "fixture") return { verified: false, verifiedBy: null, testLink: true };
  if (!attestationIsVerifying(a)) return { verified: false, verifiedBy: null, testLink: false };
  if (a.method === "farcaster-verified" && (!account.accountId || a.platformUserId !== account.accountId)) return { verified: false, verifiedBy: null, testLink: false };
  return { verified: true, verifiedBy: a.method, testLink: false };
}

/** the four account facts, validated — nothing else is read from what the page sent */
function cleanAccount(raw: unknown): ArchiveAccount {
  const a = raw as Record<string, unknown> | null;
  const username = typeof a?.username === "string" ? a.username.trim().replace(/^@/, "") : "";
  const accountId = typeof a?.accountId === "string" ? a.accountId : "";
  if (!/^[A-Za-z0-9_]{1,50}$/.test(username)) throw new ImportRefusal("bad_account", "the archive's account name is not readable");
  if (!X_ID_RE.test(accountId)) throw new ImportRefusal("bad_account", "the archive's account id is not readable");
  const displayName = typeof a?.displayName === "string" ? a.displayName.slice(0, 100) : username;
  const createdAt = typeof a?.createdAt === "number" && Number.isFinite(a.createdAt) ? a.createdAt : null;
  return { username, accountId, displayName, createdAt };
}

function noteFile(session: ImportSession, name: string): void {
  const base = String(name).replace(/^.*[\\/]/, "").slice(0, 80);
  if (base && !session.filesSeen.includes(base) && session.filesSeen.length < 64) session.filesSeen.push(base);
}

export async function stageAccount(sessionId: string, raw: unknown, file = "account.js"): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  const account = cleanAccount(raw);
  st.account = account;
  session.archiveHandle = account.username.toLowerCase();
  session.archiveAccountId = account.accountId;
  session.verified = linkStatusFor(session.personaId, account).verified;
  noteFile(session, file);
  await touch(session, st);
  return session;
}

function cleanPost(raw: unknown): ArchiveTweet | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p.id !== "string" || !X_ID_RE.test(p.id)) return null;
  if (typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) return null;
  const text = typeof p.text === "string" ? p.text.slice(0, 25_000) : "";
  const replyToId = typeof p.replyToId === "string" && X_ID_RE.test(p.replyToId) ? p.replyToId : null;
  const links = Array.isArray(p.links) ? p.links.filter((l): l is string => typeof l === "string" && l.length <= 2048).slice(0, 20) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { id: p.id, text, createdAt: p.createdAt, replyToId, links, favoriteCount: num(p.favoriteCount), retweetCount: num(p.retweetCount), isRetweet: p.isRetweet === true || /^RT @/.test(text) };
}

function overCapSentence(lane: "posts" | "following" | "likes", total: number, cap: number): string {
  const what = lane === "posts" ? "posts" : lane === "following" ? "accounts you follow" : "likes";
  return `Your X archive has ${total.toLocaleString("en-US")} ${what}, more than the ${cap.toLocaleString("en-US")} this import takes. Nothing was kept. Choose "import the newest ${cap.toLocaleString("en-US")}" to bring in the most recent ones.`;
}

function capFor(lane: "posts" | "following" | "likes"): number {
  const l = importLimits();
  return lane === "posts" ? l.maxPosts : lane === "following" ? l.maxFollows : l.maxLikes;
}

/** the total the page names for a lane, and the newest-only choice; refused over the cap without that choice */
function admitTotal(st: Staged, lane: "posts" | "following" | "likes", total: unknown, newestOnly: unknown, stagedAfter: number): void {
  const t = typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : 0;
  if (t > st.totals[lane]) st.totals[lane] = t;
  if (newestOnly === true) st.newestOnly[lane] = true;
  const cap = capFor(lane);
  const claimed = Math.max(st.totals[lane], stagedAfter);
  if (claimed > cap && !st.newestOnly[lane]) throw new ImportRefusal("over_cap", overCapSentence(lane, claimed, cap));
  if (stagedAfter > STAGE_CEILING) throw new ImportRefusal("over_cap", overCapSentence(lane, stagedAfter, cap));
}

export async function stagePosts(sessionId: string, raw: unknown[], opts: { total?: unknown; newestOnly?: unknown; file?: string } = {}): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  if (!Array.isArray(raw)) throw new ImportRefusal("bad_batch", "posts must be a list");
  if (raw.length > BATCH_LIMITS.posts) throw new ImportRefusal("bad_batch", `at most ${BATCH_LIMITS.posts} posts per call`);
  const clean: ArchiveTweet[] = [];
  for (const r of raw) {
    const p = cleanPost(r);
    if (!p) throw new ImportRefusal("bad_batch", "a post in this batch is malformed (an X id must be a string of digits)");
    clean.push(p);
  }
  const after = new Set([...st.posts.keys(), ...clean.map((p) => p.id)]).size;
  admitTotal(st, "posts", opts.total, opts.newestOnly, after);
  for (const p of clean) st.posts.set(p.id, p);
  noteFile(session, opts.file ?? "tweets.js");
  await touch(session, st);
  return session;
}

export async function stageFollowing(sessionId: string, raw: unknown[], opts: { total?: unknown; newestOnly?: unknown } = {}): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  if (!Array.isArray(raw)) throw new ImportRefusal("bad_batch", "ids must be a list");
  if (raw.length > BATCH_LIMITS.following) throw new ImportRefusal("bad_batch", `at most ${BATCH_LIMITS.following} ids per call`);
  // X ids arrive as STRINGS; a number has already lost its low digits, so it is refused, never converted
  if (!raw.every((id) => typeof id === "string" && X_ID_RE.test(id))) throw new ImportRefusal("bad_batch", "an id in this batch is not an X id (a string of digits)");
  const after = new Set([...st.following, ...(raw as string[])]).size;
  admitTotal(st, "following", opts.total, opts.newestOnly, after);
  for (const id of raw as string[]) st.following.add(id);
  noteFile(session, "following.js");
  await touch(session, st);
  return session;
}

export async function stageLikes(sessionId: string, raw: unknown[], opts: { total?: unknown; newestOnly?: unknown } = {}): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  if (!Array.isArray(raw)) throw new ImportRefusal("bad_batch", "likes must be a list");
  if (raw.length > BATCH_LIMITS.likes) throw new ImportRefusal("bad_batch", `at most ${BATCH_LIMITS.likes} likes per call`);
  const clean: ArchiveLike[] = [];
  for (const r of raw) {
    const l = r as Record<string, unknown> | null;
    if (!l || typeof l.tweetId !== "string" || !X_ID_RE.test(l.tweetId)) throw new ImportRefusal("bad_batch", "a like in this batch is malformed");
    clean.push({ tweetId: l.tweetId, text: typeof l.text === "string" ? l.text.slice(0, 25_000) : "" });
  }
  const after = new Set([...st.likes.keys(), ...clean.map((l) => l.tweetId)]).size;
  admitTotal(st, "likes", opts.total, opts.newestOnly, after);
  for (const l of clean) st.likes.set(l.tweetId, l);
  noteFile(session, "like.js");
  await touch(session, st);
  return session;
}

export async function stageInterests(sessionId: string, raw: unknown[]): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  if (!Array.isArray(raw) || raw.length > BATCH_LIMITS.interests) throw new ImportRefusal("bad_batch", "interests must be a list of names");
  const names = raw.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 200);
  st.interests = [...new Set([...st.interests, ...names])];
  noteFile(session, "personalization.js");
  await touch(session, st);
  return session;
}

/**
 * THE RIG'S PATH (ingestFixture, and the legacy `ingest` action): a raw archive file, parsed HERE and staged like the
 * page's lanes; its content is dropped as soon as it is parsed (only its name is kept). The route allows it on the rig
 * only — elsewhere the page parses and the raw file never leaves the browser.
 */
export async function ingestFile(sessionId: string, name: string, content: string): Promise<ImportSession> {
  await hydrate();
  const base = String(name).replace(/^.*[\\/]/, "");
  const session = sessionOf(sessionId);
  stagedOf(session);
  if (base === "account.js") return stageAccount(sessionId, parseAccount(content), base);
  if (/^(tweets|tweet)(-part\d+)?\.js$/.test(base)) {
    const { tweets } = parseTweetsDetailed(content);
    let s = session;
    for (let i = 0; i < tweets.length; i += BATCH_LIMITS.posts) s = await stagePosts(sessionId, tweets.slice(i, i + BATCH_LIMITS.posts), { file: base });
    if (!tweets.length) noteFile(session, base);
    return s;
  }
  if (base === "following.js") {
    const ids = parseFollowing(content);
    let s = session;
    for (let i = 0; i < ids.length; i += BATCH_LIMITS.following) s = await stageFollowing(sessionId, ids.slice(i, i + BATCH_LIMITS.following));
    return s;
  }
  if (base === "like.js") {
    const likes = parseLikes(content);
    let s = session;
    for (let i = 0; i < likes.length; i += BATCH_LIMITS.likes) s = await stageLikes(sessionId, likes.slice(i, i + BATCH_LIMITS.likes));
    return s;
  }
  if (base === "personalization.js") return stageInterests(sessionId, parsePersonalizationNames(content));
  // anything else (bookmark.js, media, DMs) is not read — its name is noted so the page can say what it saw
  noteFile(session, base);
  await persistNs("xImportSessions");
  return session;
}

export interface LanePreview {
  lane: ImportLane;
  count: number;
  /** personalization only: how many are sensitive and held behind opt-in */
  sensitiveHeld?: number;
  /** posts only */
  retweets?: number;
  replies?: number;
  /** over this lane's cap (the commit refuses it unless "import the newest N" was chosen) */
  overCap?: { total: number; cap: number };
}

export function previewSession(sessionId: string): { session: ImportSession; lanes: LanePreview[]; staged: boolean } {
  const session = sessionOf(sessionId);
  const st = staging().get(session.id);
  if (!st) return { session, lanes: [], staged: false };
  const c = countsOf(st);
  const lanes: LanePreview[] = [];
  const over = (lane: "posts" | "following" | "likes", n: number) => {
    const total = Math.max(st.totals[lane], n);
    const cap = capFor(lane);
    return total > cap && !st.newestOnly[lane] ? { overCap: { total, cap } } : {};
  };
  if (c.posts) lanes.push({ lane: "posts", count: c.posts, retweets: c.retweets, replies: c.replies, ...over("posts", c.posts) });
  if (c.likes) lanes.push({ lane: "likes", count: c.likes, ...over("likes", c.likes) });
  if (c.following) lanes.push({ lane: "following", count: c.following, ...over("following", c.following) });
  if (c.interests) {
    const classified: ArchiveInterest[] = st.interests.map(classifyInterest);
    lanes.push({ lane: "personalization", count: classified.filter((i) => !i.sensitive).length, sensitiveHeld: classified.filter((i) => i.sensitive).length });
  }
  // pure read: preview is a GET surface and must not mutate the session
  return { session, lanes, staged: true };
}

export interface CommitOptions {
  personaId?: string;
  acknowledgedFingerprintWarning?: boolean;
}

/** Commit the selected lanes. Put-by-id per persona: a re-commit or a second import of the same archive converges. */
export async function commitSession(
  sessionId: string,
  lanes: ImportLane[],
  opts: CommitOptions = {}
): Promise<{ landed: Record<string, number>; heldSensitive: number; hidden: { retweets: number }; personaId: string }> {
  await hydrate();
  const s = state();
  const session = sessionOf(sessionId);
  const st = stagedOf(session);
  if (!st.account) throw new ImportRefusal("no_account", "account.js not ingested — the archive's identity is unknown");
  const personaId = opts.personaId || session.personaId;
  if (!readablePersona(personaId)) throw new ImportRefusal("not_yours", "that persona is not one of yours on this device");
  const want = new Set(lanes.filter((l) => (IMPORT_LANES as readonly string[]).includes(l)));
  if (want.size === 0) throw new ImportRefusal("no_lanes", "pick at least one thing to import");

  // ---- every refusal BEFORE anything is written: nothing partial is kept
  if (want.has("following")) {
    if (isPrivatePersona(personaId))
      throw new ImportRefusal("private_follows", "A private persona never follows anyone on Farcaster, so it does not take your X follow list. Pick a public persona for that, or skip it. Nothing was kept.");
    if (opts.acknowledgedFingerprintWarning !== true)
      throw new ImportRefusal("fingerprint_unacknowledged", "Tick the box that says you understand a follow list is a fingerprint, or skip the follow list. Nothing was kept.");
  }
  const lim = importLimits();
  const newest = <T,>(lane: "posts" | "following" | "likes", items: T[], cap: number): T[] => {
    const total = Math.max(st.totals[lane], items.length);
    if (total > cap && !st.newestOnly[lane]) throw new ImportRefusal("over_cap", overCapSentence(lane, total, cap));
    return items.slice(0, cap);
  };
  const posts = want.has("posts") ? newest("posts", [...st.posts.values()].sort((a, b) => b.createdAt - a.createdAt), lim.maxPosts) : [];
  // following.js lists the most recent follow first; "the newest N" keeps the archive's order
  const follows = want.has("following") ? newest("following", [...st.following], lim.maxFollows) : [];
  const likes = want.has("likes") ? newest("likes", [...st.likes.values()], lim.maxLikes) : [];

  // ---- read what is there (THROWS when unreadable — an unreadable shelf is never written over). Read BEFORE anything
  // is written, so an unreadable archive record or follow list refuses the whole commit, not its second half.
  const landed: Record<string, number> = {};
  const now = Date.now();
  await loadShelf();
  if (want.has("following") && follows.length > 0) await loadFollows();
  let heldSensitive = 0;

  // PERSONA LAUNCH P2 (review W1-R1): every write below is a MUTATION of this persona's entries, applied inside the
  // document's lock to what is stored at that moment — never a copy of the whole document taken above, which a
  // resurface toggle (or another persona's import) landing meanwhile would have been silently overwritten by. The
  // counts are computed inside the mutation, against that same stored copy (it may run twice: the last run counts).
  if (want.has("posts") || want.has("likes")) {
    await updateShelf((shelf) => {
      const nextShelf = { v: 1 as const, posts: shelf.posts, likes: shelf.likes };
      if (want.has("posts")) {
        const at = new Map(nextShelf.posts.map((p, i) => [p.personaId + ":" + p.id, i]));
        let n = 0;
        for (const t of posts) {
          const row: ShelfPost = { personaId, id: t.id, text: t.text, createdAt: t.createdAt, replyToId: t.replyToId, isRetweet: t.isRetweet, links: t.links, favoriteCount: t.favoriteCount, retweetCount: t.retweetCount, importedAt: now };
          const i = at.get(personaId + ":" + t.id);
          if (i === undefined) {
            at.set(personaId + ":" + t.id, nextShelf.posts.length);
            nextShelf.posts.push(row);
            n++;
          } else nextShelf.posts[i] = { ...row, importedAt: nextShelf.posts[i].importedAt };
        }
        landed.posts = n;
      }
      if (want.has("likes")) {
        const have = new Set(nextShelf.likes.map((l) => l.personaId + ":" + l.tweetId));
        let n = 0;
        for (const l of likes) {
          if (have.has(personaId + ":" + l.tweetId)) continue;
          have.add(personaId + ":" + l.tweetId);
          nextShelf.likes.push({ personaId, tweetId: l.tweetId, text: l.text, importedAt: now });
          n++;
        }
        landed.likes = n;
      }
      return nextShelf;
    });
  }

  // an archive that listed nobody (no following.js read) never REPLACES a list imported before with an empty one
  if (want.has("following") && follows.length === 0) landed.following = 0;
  if (want.has("following") && follows.length > 0) {
    await updateFollows((doc) => {
      const prev = new Set(doc.byPersona[personaId]?.ids ?? []);
      landed.following = follows.filter((id) => !prev.has(id)).length;
      // a SNAPSHOT of who you follow now (an account you unfollowed on X drops out); matches are kept by fid
      return { ...doc, byPersona: { ...doc.byPersona, [personaId]: { ids: follows, importedAt: now } } };
    });
    if (session.fixture) {
      // the rig's fixture archive also feeds the Totem-local matcher (lib/x/migration.ts, accept-x3/x4): hashed ids,
      // a handful — a real follow list never goes here (a 1,000-id list would not fit one namespace PUT)
      for (const id of follows) {
        const hashed = hashPlatformId(id);
        const key = personaId + ":" + hashed;
        if (!s.xMigrationSource.has(key)) s.xMigrationSource.set(key, { hashedId: hashed, personaId, importedAt: now, migrated: false, excluded: false });
      }
      await persistNs("xMigrationSource");
    }
  }

  if (want.has("personalization") && st.interests.length) {
    let n = 0;
    // one read, not one per interest — the mocks charge latency per call
    const existingClaims = await retryAdapter(() => adapters.graph.listClaims(personaId));
    for (const interest of st.interests.map(classifyInterest)) {
      if (interest.sensitive) {
        // NEVER auto-imported: queue behind the existing per-category explicit consent, default off
        const key = personaId + ":" + interest.category + ":" + interest.name.toLowerCase();
        if (!s.xSensitiveQueue.has(key)) s.xSensitiveQueue.set(key, { personaId, category: interest.category, name: interest.name, queuedAt: now });
        heldSensitive++;
        continue;
      }
      const label = "x-inferred: " + interest.name;
      if (!existingClaims.some((c) => c.label === label)) {
        await retryAdapter(() => adapters.graph.addClaim(personaId, interest.category, label, "true", "x-inferred"));
        n++;
      }
    }
    landed.personalization = n;
    await persistNs("xSensitiveQueue");
  }

  // the archive's four account facts and the lanes, per receiving persona — the resurface choices as stored NOW (a toggle
  // made while this import was saving is kept), every other persona's record untouched
  const account = st.account;
  await updateArchiveMeta((stored) => {
    const cur = stored.byPersona[personaId];
    return {
      v: 1,
      byPersona: {
        ...stored.byPersona,
        [personaId]: {
          account,
          importedAt: now,
          lanes: [...new Set([...(cur?.lanes ?? []), ...want])],
          resurfaced: cur?.resurfaced ?? {},
        },
      },
    };
  });

  session.status = "committed";
  session.personaId = personaId;
  session.committedLanes = [...want];
  session.verified = linkStatusFor(personaId, st.account).verified;
  staging().delete(session.id);
  await persistNs("xImportSessions");
  const hiddenRetweets = postsOf((await loadShelf()).shelf, personaId).filter((p) => p.isRetweet).length;
  return { landed, heldSensitive, hidden: { retweets: hiddenRetweets }, personaId };
}

/** cancel a staged import: the staged lanes are dropped, nothing was written */
export async function discardSession(sessionId: string): Promise<ImportSession> {
  await hydrate();
  const session = sessionOf(sessionId);
  if (session.status === "committed") throw new ImportRefusal("committed", "session already committed");
  staging().delete(session.id);
  session.status = "discarded";
  await persistNs("xImportSessions");
  return session;
}

/** Import a queued sensitive item — ONLY after per-category consent exists.
 * The consent check is the graph adapter's own (fail-closed). */
export async function importSensitiveItem(personaId: string, queueKey: string): Promise<void> {
  const s = state();
  const item = s.xSensitiveQueue.get(queueKey);
  if (!item || item.personaId !== personaId) throw new Error("unknown queued item");
  const consented = await retryAdapter(() =>
    adapters.graph.getConsent(personaId, item.category as ClaimCategory)
  );
  if (!consented)
    throw new Error(`category "${item.category}" requires explicit consent before import`);
  await retryAdapter(() =>
    adapters.graph.addClaim(personaId, item.category as ClaimCategory, "x-inferred: " + item.name, "true", "x-inferred")
  );
  s.xSensitiveQueue.delete(queueKey);
  await persistNs("xSensitiveQueue");
}

// ------------------------------------------------------------------------------------------------ the shelf, read

function asImportedPost(p: ShelfPost, handle: string, verified: boolean, resurfacedAt: number | undefined): ImportedPost {
  return {
    id: p.id,
    personaId: p.personaId,
    text: p.text,
    createdAt: p.createdAt,
    replyToId: p.replyToId,
    links: p.links,
    favoriteCount: p.favoriteCount,
    retweetCount: p.retweetCount,
    provenance: "x-archive",
    importedAt: p.importedAt,
    archiveHandle: handle,
    verified,
    resurfaced: typeof resurfacedAt === "number",
    resurfacedAt: typeof resurfacedAt === "number" ? resurfacedAt : null,
    isRetweet: p.isRetweet,
  };
}

function importedFrom(view: { shelf: import("./shelf").ShelfDoc; meta: import("./shelf").ArchiveMetaDoc }, personaId: string): ImportedPost[] {
  const m = view.meta.byPersona[personaId];
  const handle = m?.account.username.toLowerCase() ?? "";
  const verified = m ? linkStatusFor(personaId, m.account).verified : false;
  return postsOf(view.shelf, personaId).map((p) => asImportedPost(p, handle, verified, m?.resurfaced[p.id]));
}

/**
 * SYNC, from this process's cached shelf (the feed's resurfaced cards, the legacy GET): [] when the shelf has not
 * been read here yet. The profile awaits importedPostsForAsync instead, which reads (and THROWS when it cannot).
 */
export function importedPostsFor(personaId: string): ImportedPost[] {
  const view = shelfSync();
  return view ? importedFrom(view, personaId) : [];
}

export async function importedPostsForAsync(personaId: string): Promise<ImportedPost[]> {
  return importedFrom(await loadShelf(), personaId);
}

/** the archive likes a persona imported (private records; shown to their owner only) */
export function importedLikesFor(personaId: string): { id: string; kind: "like"; tweetId: string; text: string; importedAt: number }[] {
  const view = shelfSync();
  if (!view || !readablePersona(personaId)) return [];
  return view.shelf.likes.filter((l) => l.personaId === personaId).map((l) => ({ id: "like:" + l.tweetId, kind: "like" as const, tweetId: l.tweetId, text: l.text, importedAt: l.importedAt }));
}

/** UX Gate 0 — the resurface toggle. ON stamps a FRESH timestamp (the post enters feeds dated now); OFF clears it.
 *  createdAt (the original X date) is never touched. PERSONA LAUNCH P2: the choice lives in xArchive, so a click
 *  rewrites a small document, never the shelf. */
export async function setResurfaced(personaId: string, tweetId: string, on: boolean): Promise<ImportedPost> {
  await hydrate();
  const { shelf } = await loadShelf();
  const post = postsOf(shelf, personaId).find((p) => p.id === tweetId);
  if (!post) throw new Error("unknown imported post");
  // PERSONA LAUNCH P2 (review W1-R1): ONE post's choice, changed inside the lock on the record as stored now — two
  // toggles sent together (or an import of another persona landing meanwhile) both survive
  const now = Date.now();
  const meta = await updateArchiveMeta((stored) => {
    const m = stored.byPersona[personaId];
    if (!m) throw new Error("unknown imported post");
    if (!on && !(tweetId in m.resurfaced)) return UNCHANGED;
    const resurfaced = { ...m.resurfaced };
    if (on) resurfaced[tweetId] = now;
    else delete resurfaced[tweetId];
    return { v: 1, byPersona: { ...stored.byPersona, [personaId]: { ...m, resurfaced } } };
  });
  const m = meta.byPersona[personaId];
  return asImportedPost(post, m.account.username.toLowerCase(), linkStatusFor(personaId, m.account).verified, m.resurfaced[tweetId]);
}

/** Bulk resurface / un-resurface every imported post for a persona — each dated NOW, honestly, never backdated. */
export async function setAllResurfaced(personaId: string, on: boolean): Promise<number> {
  await hydrate();
  const { shelf, meta } = await loadShelf();
  const posts = postsOf(shelf, personaId);
  if (!meta.byPersona[personaId] || posts.length === 0) return 0;
  const now = Date.now();
  await updateArchiveMeta((stored) => {
    const m = stored.byPersona[personaId];
    if (!m) throw new Error("unknown imported post");
    const resurfaced: Record<string, number> = on ? Object.fromEntries(posts.map((p) => [p.id, now])) : {};
    return { v: 1, byPersona: { ...stored.byPersona, [personaId]: { ...m, resurfaced } } };
  });
  return posts.length;
}

export function importedPrivateFor(personaId: string): ImportedPrivate[] {
  return [...state().xImportedPrivate.values()].filter((p) => p.personaId === personaId);
}

export function sensitiveQueueFor(personaId: string) {
  return [...state().xSensitiveQueue.entries()]
    .filter(([, v]) => v.personaId === personaId)
    .map(([key, v]) => ({ key, category: v.category, name: v.name }));
}

export function sessionsFor(personaId: string): ImportSession[] {
  return [...state().xImportSessions.values()].filter((x) => x.personaId === personaId);
}

/** is this session's staged data still in this process? (false after a restart: the page asks for the file again) */
export function sessionStaged(sessionId: string): boolean {
  return staging().has(sessionId);
}

/** how big the shelf is, per readable persona (counts only) — THROWS when unreadable */
export async function shelfSummary(): Promise<{ count: number; byPersona: Record<string, number> }> {
  const { shelf } = await loadShelf();
  const byPersona: Record<string, number> = {};
  for (const p of shelf.posts) if (readablePersona(p.personaId)) byPersona[p.personaId] = (byPersona[p.personaId] ?? 0) + 1;
  return { count: Object.values(byPersona).reduce((a, b) => a + b, 0), byPersona };
}

/** the shelf's attribution for a persona: whose archive, and how it is linked (computed now, never stored) */
export async function shelfAttribution(personaId: string): Promise<{ handle: string; verifiedBy: AccountAttestation["method"] | null; testLink: boolean; unlinked: boolean } | null> {
  const { meta } = await loadShelf();
  const m = meta.byPersona[personaId];
  if (!m || !readablePersona(personaId)) return null;
  const handle = m.account.username.toLowerCase();
  const link = linkStatusFor(personaId, m.account);
  return { handle, verifiedBy: link.verifiedBy, testLink: link.testLink, unlinked: isUnlinkedSource(handle) };
}
