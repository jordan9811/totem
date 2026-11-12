// ANON REVIEW (R1-06) — what the relay would publish verbatim. Neynar's cast endpoint resolves @mentions into
// protocol-level mention edges (a notification to the mentioned fid, `mentioned_profiles` on every index), and clients
// attach previews to links. One slip — "@<my persona> is right" — is a permanent edge from the anon account to a
// persona. So the compose gate REFUSES a mention of any of this device's own account names, and WARNS (in the 202
// body, shown by the composer status line) about any other mention and any link. Pure; the harness imports it.
//
// PUBLIC GO-LIVE (the relay track) — anonFilterRefusal, below: the automatic text filter, in the tab, so its plain words
// show BEFORE the click. A DELIBERATE DUPLICATE of validator/anon-filter.js checkAnonFilter with the built-in rules only
// (the operator's ANON_FILTER_SCAM_DOMAINS list lives on the validator alone); scripts/unit-anon-relay.mjs runs one corpus
// through both and requires the same answer. Conservative: slurs (a hashed list — no slur text in this file), phone
// numbers, email addresses, street addresses, scam links. The validator runs its own copy before it stores anything.
import { sha256 } from "@noble/hashes/sha2";

export interface AnonTextCheck {
  ok: boolean;
  reason?: string;
  warnings: string[];
}

// a name: Farcaster fnames [a-z0-9-], ENS names with dots, Totem handles with underscores
const MENTION_RE = /(^|[^A-Za-z0-9_.\-])@([A-Za-z0-9][A-Za-z0-9_.\-]{0,62})/g;
const URL_RE = /https?:\/\/[^\s]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|eth|app|co|me|dev|gg|so|ai)\b(?:\/[^\s]*)?/gi;

function normalizeName(n: string): string {
  return n.trim().replace(/^@+/, "").toLowerCase();
}

/** CONNECT MAIN review (PL-6) — every name one captured "@token" could reach. The capture keeps "." "-" "_" (ENS names
 *  have dots, handles underscores), so a mention that ends a sentence arrives as "pub-one." and matched no own name:
 *  the token itself, the token without trailing punctuation, and each prefix at a "." boundary ("@pub-one.Next" reads
 *  as "pub-one" to a parser that stops at the dot; "@jordan.eth" also reaches "jordan"). Over-matching only ever
 *  refuses an anonymous post (the safe side); under-matching publishes a permanent edge. */
export function mentionCandidates(raw: string): string[] {
  const base = normalizeName(raw);
  const trimmed = base.replace(/[._-]+$/, "");
  const out = new Set<string>([base, trimmed].filter(Boolean));
  const parts = trimmed.split(".");
  for (let i = 1; i < parts.length; i++) {
    const p = parts.slice(0, i).join(".").replace(/[._-]+$/, "");
    if (p) out.add(p);
  }
  return [...out];
}

/** `ownNames`: every handle and Farcaster fname this device knows as its own (keystore personas, persona fid map) */
export function checkAnonText(text: string, ownNames: ReadonlyArray<string>): AnonTextCheck {
  const own = new Set(ownNames.map(normalizeName).filter(Boolean));
  const warnings: string[] = [];
  const mentioned: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const names = mentionCandidates(m[2]);
    if (!names.length) continue;
    const hit = names.find((n) => own.has(n));
    if (hit) {
      return { ok: false, reason: `the text mentions @${hit}, one of your own accounts — a mention is a public edge from the anonymous account to it, forever`, warnings: [] };
    }
    const shown = normalizeName(m[2]).replace(/[._-]+$/, "") || names[0]; // without the sentence's punctuation
    if (!mentioned.includes(shown)) mentioned.push(shown);
  }
  if (mentioned.length) warnings.push(`mentions ${mentioned.map((n) => "@" + n).join(", ")}: Neynar turns a mention into a public notification from the anonymous account`);
  const links = [...text.matchAll(URL_RE)].map((m) => m[0]);
  if (links.length) warnings.push(`contains a link (${links.length}): clients may attach a preview, and a link only you share is a fingerprint`);
  return { ok: true, warnings };
}

// ---------------------------------------------------------------------------------------------- PUBLIC GO-LIVE: the filter
// DELIBERATE DUPLICATE of validator/anon-filter.js (every constant, regex and sentence below is that file's, byte for byte;
// scripts/unit-anon-relay.mjs F1 holds the two together over one corpus).

/** the slur list, as sha256("layers-anon-filter/1|" + word) truncated to 20 hex — "layersfiltercanary" is the test token */
const SLUR_HASHES = new Set([
  "04ac8c50f89cf49f81ff", "15f6a5d6b3e59326c2bb", "1cd762ad39e25b676751", "25ccb9b13804f64a1029", "27b4c1f99bf46f6a69bd",
  "2e5528bb8cf7f63d6fbb", "319e76f6b22d5769fef8", "3d56ac7d2add0fddcf7e", "460d5e137c7ca988ca8f", "4b923268c272f876ca40",
  "4fb152d188e1317bd440", "50de3f925009c1181f1e", "52f79a372be9168db779", "556d1df1839d53f6d6a2", "83933a8f8343386d207a",
  "85ee813c3c566bd85d70", "87a86a95ea9fedd1886d", "8e634c318ab383bf6209", "9c716576b5c72b2314be", "9f238d7a34f943d85124",
  "a79b3b994082a9476a63", "ada50d0a68f4d3c67400", "b620e0725c23eebeb4fa", "bc735368ab18bd108930", "c4ce2707b4558851f6c1",
  "cb9d6bb4982fbe2d9333", "cbcdb28484a74a4fede5", "cc7e5301c9b0121d7abc", "f9187d94a00af4f12e8e", "fb80e5cf52621460e82f",
]);
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const HEX = "0123456789abcdef";
function slurHash(word: string): string {
  const d = sha256(new TextEncoder().encode("layers-anon-filter/1|" + word));
  let out = "";
  for (let i = 0; i < 10; i++) out += HEX[d[i] >> 4] + HEX[d[i] & 15];
  return out;
}
function normalizedWords(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text).toLowerCase().matchAll(/[a-z0-9@$!]+/g)) {
    const w = m[0].replace(/[013457@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, "");
    if (w) out.push(w);
  }
  return out;
}
const SCAM_BRANDS = ["warpcast", "farcaster", "neynar", "coinbase", "metamask", "uniswap", "opensea", "phantom", "rainbow", "base"];
const SCAM_WORDS = ["airdrop", "airdrops", "claim", "claims", "reward", "rewards", "giveaway", "bonus", "freemint", "drop"];
const BUILTIN_SCAM_RE = new RegExp("(?:^|[.-])(?:" + SCAM_BRANDS.join("|") + ")[a-z0-9]*[.-](?:" + SCAM_WORDS.join("|") + ")(?:[.-]|$)|(?:^|[.-])(?:" + SCAM_WORDS.join("|") + ")[.-](?:" + SCAM_BRANDS.join("|") + ")[a-z0-9]*(?:[.-]|$)");
function linkHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const m of String(text).matchAll(/\bhttps?:\/\/([^\s/?#<>"'\\]+)/gi)) hosts.push(m[1]);
  for (const m of String(text).matchAll(/(?:^|[\s(<"'])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?=$|[\s/?#)>"',.!:;])/gi)) hosts.push(m[1]);
  return [...new Set(hosts.map((h) => h.toLowerCase().replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "")).filter(Boolean))];
}
const PHONE_CANDIDATE_RE = /\+?\(?\d[\d\s().-]{7,}\d/g;
const NANP_RE = /^(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}$/;
function hasPhone(text: string): boolean {
  for (const m of String(text).matchAll(PHONE_CANDIDATE_RE)) {
    const c = m[0].trim();
    const digits = c.replace(/\D/g, "").length;
    if (c.startsWith("+") && digits >= 9 && digits <= 15) return true;
    if (NANP_RE.test(c)) return true;
  }
  return false;
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,24}))\b/g;
function hasEmail(text: string): boolean {
  for (const m of String(text).matchAll(EMAIL_RE)) if (m[2].toLowerCase() !== "eth") return true;
  return false;
}
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Z][A-Za-z'.-]*\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Terrace|Ter|Way|Highway|Hwy|Parkway|Pkwy|Circle|Cir)\b/;

export type AnonFilterRule = "slur" | "phone" | "email" | "address" | "scam-url";
/** the filter's sentences, said to the visitor as they are (validator/anon-filter.js FILTER_RULES) */
export const ANON_FILTER_SENTENCES: Readonly<Record<AnonFilterRule, string>> = Object.freeze({
  slur: "This post uses a slur, so it can't be posted anonymously here.",
  phone: "This post looks like it has a phone number in it. Anonymous posts can't share anyone's contact details, yours included.",
  email: "This post looks like it has an email address in it. Anonymous posts can't share anyone's contact details, yours included.",
  address: "This post looks like it has a street address in it. Anonymous posts can't share where anyone lives or works.",
  "scam-url": "This post links to a site on the list of known scam sites, so it can't be posted.",
});

/** PUBLIC GO-LIVE: null when the text may be posted anonymously, else the rule and its plain sentence (built-in rules only) */
export function anonFilterRefusal(text: string): { rule: AnonFilterRule; sentence: string } | null {
  if (typeof text !== "string") return { rule: "slur", sentence: ANON_FILTER_SENTENCES.slur };
  for (const w of normalizedWords(text)) if (SLUR_HASHES.has(slurHash(w))) return { rule: "slur", sentence: ANON_FILTER_SENTENCES.slur };
  if (hasPhone(text)) return { rule: "phone", sentence: ANON_FILTER_SENTENCES.phone };
  if (hasEmail(text)) return { rule: "email", sentence: ANON_FILTER_SENTENCES.email };
  if (ADDRESS_RE.test(text)) return { rule: "address", sentence: ANON_FILTER_SENTENCES.address };
  for (const h of linkHosts(text)) if (BUILTIN_SCAM_RE.test(h)) return { rule: "scam-url", sentence: ANON_FILTER_SENTENCES["scam-url"] };
  return null;
}
