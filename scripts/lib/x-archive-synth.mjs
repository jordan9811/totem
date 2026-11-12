// PERSONA LAUNCH P2 (BYX G7) — A SYNTHETIC X ARCHIVE, deterministic from a seed, for every BYX test.
//
// Shape (the 2026 X archive as the spec read it): data/*.js wrapped `window.YTD.<name>.partN = [...]`, a big account's
// tweets split across tweets.js + tweets-part1.js, an optional manifest.js, and a legacy-naming variant (tweet.js +
// tweet-part1.js, global `tweet`). Every number below is PLANTED so the tests can assert it exactly:
//   account.js     username synth_yeak, a 19-digit account id, AND a planted email + phone (proved dropped)
//   tweets         3,000 unique = 1,800 in tweets.js + 1,200 in tweets-part1.js (BOM on part1); 400 "RT @…", 600 replies;
//                  every text carries the canary TWEET_CANARY (the at-rest checks grep for it); some carry emoji/CJK
//   like.js        1,000
//   following.js   1,000 ids: the three REAL Farcaster-verified X ids probed 2026-10-08 (dwr 9615352, varunsrin
//                  21711443, mirceap 11813582) + 4 PLANTED ids that only the stub index knows + 993 that match nothing
//   personalization.js  5 interests, 2 of them sensitive
//   the ZIP        all of the above + 20 MB of incompressible junk under data/tweets_media/ (never to be read)
// Nothing here touches the network; files go where the caller says (a temp dir).
import { deflateRawSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TWEET_CANARY = "qzvkcanary";
export const PLANT = {
  account: {
    username: "synth_yeak",
    accountId: "1500000000000000001",
    accountDisplayName: "Synth Yeak",
    createdAt: "2014-03-01T12:00:00.000Z",
    email: "planted.email.7f3c@example.invalid",
    phoneNumber: "+15550109876",
  },
  /** the three real X ids (strings!) and the fids the stub gives them (dwr is fid 3 and varunsrin fid 2 as probed; the
   *  third's fid here is a stub value — the real one is not asserted anywhere) */
  realFollows: [
    { xid: "9615352", fid: 3, xu: "dwr", fname: "dwr.eth" },
    { xid: "21711443", fid: 2, xu: "varunsrin", fname: "v" },
    { xid: "11813582", fid: 2433, xu: "mirceap", fname: "mirceap" },
  ],
  /** ids only the stub index knows; the last one's fid is the "own account" in the unit harness */
  fakeFollows: [
    { xid: "1600000000000000001", fid: 900101, xu: "planted_one", fname: "planted-one" },
    { xid: "1600000000000000002", fid: 900102, xu: "planted_two", fname: "" },
    { xid: "1600000000000000003", fid: 900103, xu: "planted_three", fname: "planted-three" },
    { xid: "1600000000000000004", fid: 900104, xu: "planted_four", fname: "planted-four" },
  ],
  counts: { tweetsMain: 1800, tweetsPart1: 1200, posts: 3000, retweets: 400, replies: 600, likes: 1000, following: 1000, interests: 5, sensitive: 2 },
};

/** mulberry32: a tiny seeded PRNG */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
/** X's created_at: "Sat Mar 12 18:01:00 +0000 2022" */
export function xDate(ms) {
  const d = new Date(ms);
  return `${WD[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

/** a 19-digit id string above 2^53 (a Number() would corrupt it): base + i, in BigInt */
export const bigId = (base, i) => (BigInt(base) + BigInt(i)).toString();

const ytd = (name, part, rows, bom = false) => (bom ? "﻿" : "") + `window.YTD.${name}.part${part} = ` + JSON.stringify(rows, null, 2);

/** the 3,000 tweets, in archive order (newest first), with their planted kinds */
export function synthTweets(seed = 7) {
  const r = rng(seed);
  const out = [];
  const start = Date.UTC(2015, 0, 1);
  const span = Date.UTC(2025, 0, 1) - start;
  for (let i = 0; i < PLANT.counts.posts; i++) {
    const id = bigId("1700000000000000000", i * 7 + 3);
    const created = start + Math.floor((span * (PLANT.counts.posts - i)) / PLANT.counts.posts) + Math.floor(r() * 3_600_000);
    const kind = i % 15 < 2 ? "rt" : i % 5 === 2 ? "reply" : "post"; // 2/15 of 3,000 = 400 RTs; 1/5 = 600 replies (disjoint)
    const flavour = i % 97 === 0 ? " 日本語のテキスト 🚀🔥 \"quoted\" back\\slash" : "";
    const text =
      kind === "rt"
        ? `RT @someone_${i % 50}: synthetic retweet ${i} ${TWEET_CANARY}`
        : `${kind === "reply" ? "@friend_" + (i % 30) + " " : ""}synthetic post ${i} about restaking and rollups ${TWEET_CANARY}${flavour}`;
    out.push({
      tweet: {
        id_str: id,
        id: id,
        full_text: text,
        created_at: xDate(created),
        entities: { urls: i % 11 === 0 ? [{ url: "https://t.co/x" + i, expanded_url: "https://example.org/synth/" + i }] : [] },
        favorite_count: String(Math.floor(r() * 500)),
        retweet_count: String(Math.floor(r() * 50)),
        in_reply_to_status_id_str: kind === "reply" ? bigId("1690000000000000000", i) : null,
      },
      kind,
    });
  }
  return out;
}

/** the following ids (strings): the 7 planted matches spread through 993 that match nothing */
export function synthFollowing(seed = 7) {
  const r = rng(seed + 1);
  const ids = [];
  for (let i = 0; i < PLANT.counts.following - 7; i++) ids.push(bigId("1800000000000000000", i * 13 + Math.floor(r() * 7)));
  const planted = [...PLANT.realFollows, ...PLANT.fakeFollows].map((f) => f.xid);
  planted.forEach((id, k) => ids.splice(50 + k * 130, 0, id));
  return ids;
}

/**
 * The archive files, keyed by archive path ("data/tweets.js"). `legacy` names the tweet files tweet.js/tweet-part1.js
 * with the `tweet` global and omits the manifest.
 */
export function makeArchiveFiles({ seed = 7, legacy = false, manifest = true } = {}) {
  const tweets = synthTweets(seed).map((t) => ({ tweet: t.tweet }));
  const main = tweets.slice(0, PLANT.counts.tweetsMain);
  const part1 = tweets.slice(PLANT.counts.tweetsMain);
  const tName = legacy ? "tweet" : "tweets";
  const files = {
    "data/account.js": ytd("account", 0, [{ account: { ...PLANT.account, createdVia: "web" } }]),
    [`data/${tName}.js`]: ytd(tName, 0, main),
    [`data/${tName}-part1.js`]: ytd(tName, 1, part1, true),
    "data/like.js": ytd(
      "like",
      0,
      Array.from({ length: PLANT.counts.likes }, (_, i) => ({ like: { tweetId: bigId("1650000000000000000", i), fullText: `a liked post ${i} ${TWEET_CANARY}`, expandedUrl: "https://x.com/i/web/status/" + bigId("1650000000000000000", i) } }))
    ),
    "data/following.js": ytd("following", 0, synthFollowing(seed).map((accountId) => ({ following: { accountId, userLink: "https://twitter.com/intent/user?user_id=" + accountId } }))),
    "data/personalization.js": ytd("personalization", 0, [
      {
        p13nData: {
          interests: {
            interests: [
              { name: "Technology", isDisabled: false },
              { name: "Cryptocurrencies", isDisabled: false },
              { name: "Cycling", isDisabled: false },
              { name: "Mental health awareness", isDisabled: false },
              { name: "Personal finance and investing", isDisabled: false },
              { name: "Disabled interest", isDisabled: true },
            ],
          },
        },
      },
    ]),
    // files the importer must never read
    "data/direct-messages.js": ytd("dmConversation", 0, [{ dmConversation: { conversationId: "1-2", messages: [{ messageCreate: { text: "a private DM " + TWEET_CANARY } }] } }]),
    "data/follower.js": ytd("follower", 0, [{ follower: { accountId: "1999999999999999999" } }]),
  };
  if (manifest && !legacy) {
    files["data/manifest.js"] =
      "window.__THAR_CONFIG = " +
      JSON.stringify({
        userInfo: { accountId: PLANT.account.accountId, userName: PLANT.account.username },
        dataTypes: {
          tweets: { files: [{ fileName: "data/tweets.js", globalName: "YTD.tweets.part0", count: String(main.length) }, { fileName: "data/tweets-part1.js", globalName: "YTD.tweets.part1", count: String(part1.length) }] },
        },
      });
  }
  return files;
}

/** a ZIP (deflate for text, STORE for the junk), central directory and all. Junk: `junkMB` MB of random bytes. */
export function makeZip(files, { junkMB = 20, seed = 7 } = {}) {
  const r = rng(seed + 2);
  const entries = [];
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    entries.push({ name, raw, data: deflateRawSync(raw, { level: 6 }), method: 8 });
  }
  for (let k = 0; k < junkMB; k++) {
    const raw = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < raw.length; i += 4) raw.writeUInt32LE((r() * 4294967296) >>> 0, i);
    entries.push({ name: `data/tweets_media/${bigId("1700000000000000000", k)}-junk${k}.jpg`, raw, data: raw, method: 0 });
  }
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x5821, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, e.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x5821, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    e.offset = offset;
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...chunks, cd, end]);
  return { zip, entries: entries.map((e) => ({ name: e.name, offset: e.offset, compSize: e.data.length, size: e.raw.length, method: e.method })) };
}

/** write the ZIP, the extracted folder and the legacy-naming ZIP under `dir`; returns their paths */
export function writeSynthArchive(dir, { seed = 7, junkMB = 20 } = {}) {
  mkdirSync(dir, { recursive: true });
  const files = makeArchiveFiles({ seed });
  const { zip } = makeZip(files, { junkMB, seed });
  const zipPath = path.join(dir, "twitter-synth.zip");
  writeFileSync(zipPath, zip);
  const folder = path.join(dir, "twitter-synth");
  for (const [name, text] of Object.entries(files)) {
    const f = path.join(folder, name);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  const legacy = makeZip(makeArchiveFiles({ seed, legacy: true }), { junkMB: 1, seed }).zip;
  const legacyZipPath = path.join(dir, "twitter-synth-legacy.zip");
  writeFileSync(legacyZipPath, legacy);
  return { zipPath, folder, legacyZipPath, zipBytes: zip.length };
}

/** the stub index's rows for this archive: the 7 planted matches plus `noise` rows that match nothing */
export function synthIndexRows({ noise = 2400, extra = [] } = {}) {
  const rows = [];
  const at0 = Math.floor(Date.UTC(2025, 2, 1) / 1000);
  [...PLANT.realFollows, ...PLANT.fakeFollows].forEach((f, k) => rows.push({ fid: f.fid, platform: "x", platformId: f.xid, platformUsername: f.xu, verifiedAt: at0 + k * 86400, fname: f.fname }));
  for (let i = 0; i < noise; i++) rows.push({ fid: 100000 + i, platform: "x", platformId: bigId("1900000000000000000", i), platformUsername: "noise_" + i, verifiedAt: at0 - i * 60, fname: i % 3 === 0 ? "" : "noise-" + i });
  for (const e of extra) rows.push({ platform: "x", ...e });
  return rows;
}
