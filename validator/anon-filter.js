"use strict";
// PUBLIC GO-LIVE (the relay track) — THE AUTOMATIC TEXT FILTER for anonymous posts, before a stranger's words reach
// Farcaster through the public @anon. It runs on the validator BEFORE the row is inserted (validator/zk.js, after the
// proof is verified and before the nullifier is consumed: a refused post consumes nothing) and, word for word, in the
// visitor's tab (lib/zk/anon/textCheck.ts anonFilterRefusal — a DELIBERATE DUPLICATE: scripts/unit-anon-relay.mjs runs one
// corpus through both and requires the same answer), so the plain words show BEFORE the click.
//
// CONSERVATIVE BY DESIGN. It catches the obvious and nothing else; everything subtler is the Report button and the
// owner's takedown queue (validator/anonpublic.js). Five rules, each with an id and a plain sentence:
//   slur      a whole word (after lower-casing and the common digit/symbol swaps: 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i)
//             on a short list of unambiguous slurs. The list is stored as salted sha256 prefixes, so this repository
//             carries no slur text; `node validator/anon-filter.js --check <word>` says whether a word is on it. One
//             harmless token, "layersfiltercanary", is on the list so the tests can exercise the rule without a slur.
//   phone     a phone number: a +international number of 9 to 15 digits, or a North American 3-3-4 number written with
//             separators or brackets (a bare run of digits, a date, a price is not caught)
//   email     an email address (an ENS name like vitalik.eth after an @ is not one)
//   address   a street address: a house number, one to three Capitalized words, then a street word (Street, Ave, Rd, …)
//   scam-url  a link whose host is on the scam-domain list: the built-in rule (a wallet or Farcaster brand joined to an
//             airdrop / claim / reward word, e.g. warpcast-airdrop.xyz — the brands' own sites are never caught) plus
//             ANON_FILTER_SCAM_DOMAINS on the VALIDATOR only (comma separated host names; the tab knows only the built-in
//             rule, so a host on the operator's list is refused at the validator, in the same words, after the click)
//
// LOGGED, NEVER THE TEXT: a refusal is recorded as its rule id and the hour (zk_anon_filter_log) — never the refused words,
// never who sent them. This module itself logs nothing and stores nothing.
const { createHash } = require("node:crypto");

/** the slur list, as sha256("layers-anon-filter/1|" + word) truncated to 20 hex (see the header) */
const SLUR_HASHES = new Set([
  "04ac8c50f89cf49f81ff", "15f6a5d6b3e59326c2bb", "1cd762ad39e25b676751", "25ccb9b13804f64a1029", "27b4c1f99bf46f6a69bd",
  "2e5528bb8cf7f63d6fbb", "319e76f6b22d5769fef8", "3d56ac7d2add0fddcf7e", "460d5e137c7ca988ca8f", "4b923268c272f876ca40",
  "4fb152d188e1317bd440", "50de3f925009c1181f1e", "52f79a372be9168db779", "556d1df1839d53f6d6a2", "83933a8f8343386d207a",
  "85ee813c3c566bd85d70", "87a86a95ea9fedd1886d", "8e634c318ab383bf6209", "9c716576b5c72b2314be", "9f238d7a34f943d85124",
  "a79b3b994082a9476a63", "ada50d0a68f4d3c67400", "b620e0725c23eebeb4fa", "bc735368ab18bd108930", "c4ce2707b4558851f6c1",
  "cb9d6bb4982fbe2d9333", "cbcdb28484a74a4fede5", "cc7e5301c9b0121d7abc", "f9187d94a00af4f12e8e", "fb80e5cf52621460e82f",
]);
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };
/** the hash a normalized word is listed under */
const slurHash = (word) => createHash("sha256").update("layers-anon-filter/1|" + word, "utf8").digest("hex").slice(0, 20);
/** every whole word of the text, normalized (lower case, the digit/symbol swaps, letters only) */
function normalizedWords(text) {
  const out = [];
  for (const m of String(text).toLowerCase().matchAll(/[a-z0-9@$!]+/g)) {
    const w = m[0].replace(/[013457@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, "");
    if (w) out.push(w);
  }
  return out;
}

// the brands a scam site borrows, and the words it pairs them with (the host must carry both, joined by - or .)
const SCAM_BRANDS = ["warpcast", "farcaster", "neynar", "coinbase", "metamask", "uniswap", "opensea", "phantom", "rainbow", "base"];
const SCAM_WORDS = ["airdrop", "airdrops", "claim", "claims", "reward", "rewards", "giveaway", "bonus", "freemint", "drop"];
const BUILTIN_SCAM_RE = new RegExp("(?:^|[.-])(?:" + SCAM_BRANDS.join("|") + ")[a-z0-9]*[.-](?:" + SCAM_WORDS.join("|") + ")(?:[.-]|$)|(?:^|[.-])(?:" + SCAM_WORDS.join("|") + ")[.-](?:" + SCAM_BRANDS.join("|") + ")[a-z0-9]*(?:[.-]|$)");
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** the operator's own list (validator only): valid host names, lower case, without a leading "www." or "*." */
function operatorScamDomains(env = process.env) {
  return String(env.ANON_FILTER_SCAM_DOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\*\./, "").replace(/^www\./, ""))
    .filter((h) => HOST_RE.test(h));
}
/** the hosts of every link in the text: http(s) links and bare domains (lower case, no port, no leading "www.") */
function linkHosts(text) {
  const hosts = [];
  for (const m of String(text).matchAll(/\bhttps?:\/\/([^\s/?#<>"'\\]+)/gi)) hosts.push(m[1]);
  for (const m of String(text).matchAll(/(?:^|[\s(<"'])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?=$|[\s/?#)>"',.!:;])/gi)) hosts.push(m[1]);
  return [...new Set(hosts.map((h) => h.toLowerCase().replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "")).filter(Boolean))];
}

const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s().-]{7,}\d/g;
const NANP_RE = /^(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}$/;
function hasPhone(text) {
  for (const m of String(text).matchAll(PHONE_CANDIDATE_RE)) {
    const c = m[0].trim();
    const digits = c.replace(/\D/g, "").length;
    if (c.startsWith("+") && digits >= 9 && digits <= 15) return true;
    if (NANP_RE.test(c)) return true;
  }
  return false;
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,24}))\b/g;
function hasEmail(text) {
  for (const m of String(text).matchAll(EMAIL_RE)) if (m[2].toLowerCase() !== "eth") return true;
  return false;
}
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Z][A-Za-z'.-]*\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Terrace|Ter|Way|Highway|Hwy|Parkway|Pkwy|Circle|Cir)\b/;

/** the rules, in the order they are asked; each sentence is said to the visitor as is */
const FILTER_RULES = Object.freeze([
  { id: "slur", sentence: "This post uses a slur, so it can't be posted anonymously here." },
  { id: "phone", sentence: "This post looks like it has a phone number in it. Anonymous posts can't share anyone's contact details, yours included." },
  { id: "email", sentence: "This post looks like it has an email address in it. Anonymous posts can't share anyone's contact details, yours included." },
  { id: "address", sentence: "This post looks like it has a street address in it. Anonymous posts can't share where anyone lives or works." },
  { id: "scam-url", sentence: "This post links to a site on the list of known scam sites, so it can't be posted." },
]);
const RULE_BY_ID = Object.fromEntries(FILTER_RULES.map((r) => [r.id, r]));

/**
 * The filter's answer: null when the text may be posted, else { rule, sentence }. PURE given `env` (the operator's scam
 * list is read from it; pass {} for the built-in rules alone — what the tab knows). Never throws: a text that is not a
 * string is refused as the earlier checks would refuse it anyway, never waved through.
 */
function checkAnonFilter(text, env = process.env) {
  if (typeof text !== "string") return { rule: "slur", sentence: RULE_BY_ID.slur.sentence };
  for (const w of normalizedWords(text)) if (SLUR_HASHES.has(slurHash(w))) return { rule: "slur", sentence: RULE_BY_ID.slur.sentence };
  if (hasPhone(text)) return { rule: "phone", sentence: RULE_BY_ID.phone.sentence };
  if (hasEmail(text)) return { rule: "email", sentence: RULE_BY_ID.email.sentence };
  if (ADDRESS_RE.test(text)) return { rule: "address", sentence: RULE_BY_ID.address.sentence };
  const listed = operatorScamDomains(env);
  for (const h of linkHosts(text)) {
    if (BUILTIN_SCAM_RE.test(h)) return { rule: "scam-url", sentence: RULE_BY_ID["scam-url"].sentence };
    if (listed.some((d) => h === d || h.endsWith("." + d))) return { rule: "scam-url", sentence: RULE_BY_ID["scam-url"].sentence };
  }
  return null;
}

// `node validator/anon-filter.js --check <word>`: is this word on the hashed list? (no other output, nothing stored)
if (require.main === module) {
  const i = process.argv.indexOf("--check");
  if (i < 0 || !process.argv[i + 1]) {
    console.log("usage: node validator/anon-filter.js --check <word>");
    process.exit(2);
  }
  const words = normalizedWords(process.argv[i + 1]);
  const hit = words.some((w) => SLUR_HASHES.has(slurHash(w)));
  console.log(hit ? "on the list" : "not on the list");
  process.exit(hit ? 0 : 1);
}

module.exports = { checkAnonFilter, FILTER_RULES, SLUR_HASHES, slurHash, normalizedWords, linkHosts, operatorScamDomains, hasPhone, hasEmail, BUILTIN_SCAM_RE, ADDRESS_RE };
