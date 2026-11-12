// PERSONA LAUNCH P2 (BYX G3) — X ARCHIVE PARSING, PURE (no "server-only": the browser page runs it on the file the
// person dropped in, and the rig's server runs it on the fixture archive — the same code, so the two cannot drift).
//
// The data/*.js format, as X exports it: `window.YTD.<name>.part<N> = [ ...records ]`, with a UTF-8 byte-order mark on
// some files. Big accounts split tweets across `tweets.js` + `tweets-part1.js`, `tweets-part2.js` (older archives:
// `tweet.js` + `tweet-part1.js`, global `tweet`). A file that does not match its documented shape is a LOUD per-file
// error, never a silent skip.
//
// THE PRIVACY BOUNDARY IS THE RETURN TYPE. account.js carries the account's email address and phone number;
// parseAccount returns EXACTLY {username, accountId, displayName, createdAt} and nothing else crosses out of this
// module. X ids (tweet ids, account ids, followed ids) are 19-digit numbers that do not fit a JavaScript number:
// they stay STRINGS here and everywhere after — nothing in Totem ever Number()s an X id.
import { SENSITIVE_CATEGORIES, type ClaimCategory } from "@/lib/adapters/types";

export interface ArchiveTweet {
  /** id_str, kept as a string */
  id: string;
  text: string;
  /** the ORIGINAL timestamp (ms), preserved */
  createdAt: number;
  replyToId: string | null;
  links: string[];
  favoriteCount: number;
  retweetCount: number;
  /** "RT @…": a retweet, shown on the shelf only when asked for */
  isRetweet: boolean;
}

export interface ArchiveLike {
  tweetId: string;
  text: string;
}

/** EXACTLY these four keys — the archive's email and phone never leave parseAccount */
export interface ArchiveAccount {
  username: string;
  accountId: string;
  displayName: string;
  createdAt: number | null;
}

export interface ArchiveInterest {
  name: string;
  /** which claim category this maps to; sensitive categories gate the import */
  category: ClaimCategory;
  sensitive: boolean;
}

/** an X id: digits only (a tweet id is 19 today); anything else is not an id */
export const X_ID_RE = /^\d{1,25}$/;

const YTD_RE = /^﻿?\s*window\.YTD\.([A-Za-z0-9_]+)\.part(\d+)\s*=\s*/;

/**
 * Strip the YTD wrapper and parse the array. `name` is the global the file must carry, or a list of acceptable ones
 * (tweets come as `tweets` or, in older archives, `tweet`). A UTF-8 BOM is tolerated.
 */
export function parseYtd(name: string | readonly string[], content: string): unknown[] {
  const names = typeof name === "string" ? [name] : name;
  const m = YTD_RE.exec(content);
  if (!m || !names.includes(m[1])) throw new Error(`${names[0]}.js does not match the archive format (window.YTD.${names[0]}.partN = …)`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(m[0].length).replace(/;\s*$/, ""));
  } catch (e) {
    throw new Error(`${names[0]}.js is not readable (${(e as Error).message})`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${names[0]}.js body is not an array`);
  return parsed;
}

/** the global a YTD file carries and its part number, or null when it is not a YTD file */
export function ytdGlobal(content: string): { name: string; part: number } | null {
  const m = YTD_RE.exec(content);
  return m ? { name: m[1], part: Number(m[2]) } : null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseAccount(content: string): ArchiveAccount {
  const [rec] = parseYtd("account", content) as { account?: Record<string, unknown> }[];
  const a = rec?.account;
  const username = str(a?.username);
  if (!a || !username) throw new Error("account.js carries no username");
  const accountId = str(a.accountId);
  if (!accountId || !X_ID_RE.test(accountId)) throw new Error("account.js carries no account id");
  const created = str(a.createdAt);
  const createdAt = created ? Date.parse(created) : NaN;
  // the four keys, built field by field: a spread of `a` here would carry the email and phone out
  return {
    username,
    accountId,
    displayName: str(a.accountDisplayName) ?? username,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
  };
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/**
 * X's created_at, "Sat Mar 12 18:01:00 +0000 2022" (RFC 2822-like, year last). Parsed by hand: Date.parse accepts it
 * in V8 but not in every browser engine, and the page that parses an archive is whatever browser the person has.
 */
export function parseXDate(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(s);
  if (m && m[1] in MONTHS) {
    const utc = Date.UTC(Number(m[9]), MONTHS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
    const offsetMin = (Number(m[7]) * 60 + Number(m[8])) * (m[6] === "-" ? -1 : 1);
    return utc - offsetMin * 60_000;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Tweets from one tweets(-partN).js / tweet(-partN).js file. Records come wrapped ({tweet:{…}}) or bare. A record
 * without a string id_str is dropped (a numeric `id` has lost its low digits already); `skipped` says how many.
 */
export function parseTweetsDetailed(content: string): { tweets: ArchiveTweet[]; skipped: number } {
  const rows = parseYtd(["tweets", "tweet"], content) as Record<string, unknown>[];
  const tweets: ArchiveTweet[] = [];
  let skipped = 0;
  for (const row of rows) {
    const t = (row && typeof row === "object" && "tweet" in row ? (row as { tweet: unknown }).tweet : row) as Record<string, unknown> | null;
    const id = str(t?.id_str) ?? (typeof t?.id === "string" ? (t.id as string) : null);
    const createdAt = parseXDate(t?.created_at);
    if (!t || !id || !X_ID_RE.test(id) || createdAt === null) {
      skipped++;
      continue;
    }
    const text = str(t.full_text) ?? str(t.text) ?? "";
    const replyTo = str(t.in_reply_to_status_id_str);
    const urls = ((t.entities as Record<string, unknown> | undefined)?.urls ?? []) as { expanded_url?: unknown; url?: unknown }[];
    tweets.push({
      id,
      text,
      createdAt,
      replyToId: replyTo && X_ID_RE.test(replyTo) ? replyTo : null,
      links: (Array.isArray(urls) ? urls : []).map((u) => str(u?.expanded_url) ?? str(u?.url) ?? "").filter(Boolean),
      favoriteCount: count(t.favorite_count),
      retweetCount: count(t.retweet_count),
      isRetweet: /^RT @/.test(text),
    });
  }
  return { tweets, skipped };
}

export function parseTweets(content: string): ArchiveTweet[] {
  return parseTweetsDetailed(content).tweets;
}

/** the parts of one archive's tweets, merged: concatenated, deduplicated by id (first wins), newest first */
export function mergeTweetParts(parts: ArchiveTweet[][]): ArchiveTweet[] {
  const byId = new Map<string, ArchiveTweet>();
  for (const part of parts) for (const t of part) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function parseLikes(content: string): ArchiveLike[] {
  const rows = parseYtd("like", content) as { like?: Record<string, unknown> }[];
  const out: ArchiveLike[] = [];
  for (const r of rows) {
    const id = str(r?.like?.tweetId);
    if (id && X_ID_RE.test(id)) out.push({ tweetId: id, text: str(r.like?.fullText) ?? "" });
  }
  return out;
}

/** following.js: the followed accounts' ids, as strings, deduplicated */
export function parseFollowing(content: string): string[] {
  const rows = parseYtd("following", content) as { following?: { accountId?: unknown } }[];
  const out = new Set<string>();
  for (const r of rows) {
    const id = str(r?.following?.accountId);
    if (id && X_ID_RE.test(id)) out.add(id);
  }
  return [...out];
}

/**
 * Map X ad-interest names onto the claim taxonomy. Sensitive mapping is
 * deliberately BROAD (a health-adjacent phrase classifies as health): the
 * cost of over-gating is one extra opt-in click; the cost of under-gating
 * is a sensitive inference imported silently.
 */
export function classifyInterest(name: string): ArchiveInterest {
  const n = name.toLowerCase();
  let category: ClaimCategory = "interests";
  if (/health|medical|wellness|therapy|mental/.test(n)) category = "health";
  else if (/politic|election|partisan|activis/.test(n)) category = "politics";
  else if (/finance|investing|credit|loan|debt|income/.test(n)) category = "finances";
  return { name, category, sensitive: SENSITIVE_CATEGORIES.includes(category) };
}

/** personalization.js: the enabled interest NAMES (classification happens where they land: classifyInterest) */
export function parsePersonalizationNames(content: string): string[] {
  const rows = parseYtd("personalization", content) as {
    p13nData?: { interests?: { interests?: { name?: unknown; isDisabled?: unknown }[] } };
  }[];
  const interests = rows[0]?.p13nData?.interests?.interests ?? [];
  return (Array.isArray(interests) ? interests : [])
    .filter((i) => i && i.isDisabled !== true && typeof i.name === "string" && i.name.length > 0 && i.name.length <= 200)
    .map((i) => i.name as string);
}

export function parsePersonalization(content: string): ArchiveInterest[] {
  return parsePersonalizationNames(content).map(classifyInterest);
}

/**
 * manifest.js (`window.__THAR_CONFIG = {…}`): when present and well-formed, its list of tweet files wins over the
 * file-name glob. Not confirmed by any source read for the spec (VERIFY on a real archive), so anything unexpected
 * here returns null and the glob is used.
 */
export function parseManifestTweetFiles(content: string): string[] | null {
  const m = /^﻿?\s*window\.__THAR_CONFIG\s*=\s*/.exec(content);
  if (!m) return null;
  try {
    const cfg = JSON.parse(content.slice(m[0].length).replace(/;\s*$/, "")) as {
      dataTypes?: Record<string, { files?: { fileName?: unknown }[] }>;
    };
    const files = cfg?.dataTypes?.tweets?.files ?? cfg?.dataTypes?.tweet?.files;
    if (!Array.isArray(files) || files.length === 0) return null;
    const names = files.map((f) => (typeof f?.fileName === "string" ? f.fileName : "")).filter((n) => /(^|\/)tweets?(-part\d+)?\.js$/.test(n));
    return names.length === files.length ? names : null;
  } catch {
    return null;
  }
}

/** the archive files the importer reads, by base name (media, DMs and everything else are never read) */
export const WANTED_FILE_RE = /^(account|following|like|personalization|manifest|tweets|tweet|tweets-part\d+|tweet-part\d+)\.js$/;
export const TWEET_FILE_RE = /^(tweets|tweet)(-part\d+)?\.js$/;

/**
 * Is this archive path one the importer reads? `data/<wanted>.js` at any depth, or a bare file name (a person who
 * picked the .js files themselves). A file in a sub-folder of data/ (tweets_media/…) is never wanted.
 */
export function wantedArchivePath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  if (!WANTED_FILE_RE.test(base)) return false;
  if (parts.length === 1) return true;
  return parts[parts.length - 2] === "data";
}
