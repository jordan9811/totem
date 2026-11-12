// PERSONA LAUNCH P8 — THE @totem X OUTBOX'S TEXT POLICY, the compose-time copy. DELIBERATE DUPLICATE of xPostShape /
// validateXText / xHashOf in validator/xoutbox.js: the composer refuses here, before anything is minted or proved, and
// the validator refuses the same texts again before any nullifier is consumed — neither side trusts the other.
// scripts/unit-x-outbox.mjs runs one corpus through both and requires byte-equal answers.
//
// Why these rules (the owner's rule for a PUBLIC anonymous account: X suspends an account that posts spam, and an
// article goes out as QUOTE-AND-LINK, never as a full repost):
//   • at most 280 weighted characters — X's own count: Latin script weighs 1, CJK and emoji 2, any link 23;
//   • at most ONE link, written in full with https:// (a bare domain is a link X makes anyway — refused, so the count
//     is never wrong);
//   • a post with a link keeps at most 200 of the poster's OWN characters beside it, and at least one;
//   • no @mention (a mention from a shared account is the pattern X suspends for, and a public edge from the account);
//   • at most two hashtags; one paragraph (no blank line: a pasted article is many);
//   • no control characters.
// Duplicates of a recent outbox row are the validator's to judge (only it holds the rows). PURE and browser-safe: no
// server-only import, no environment read, no fetch; the hash uses the platform's sha-256.
import { createHash } from "@/lib/platform/crypto";

export const X_MAX_WEIGHTED = 280;
export const X_URL_WEIGHT = 23;
export const X_QUOTE_MAX_CHARS = 200;
export const X_MAX_HASHTAGS = 2;
// the envelope rides a CONSTANT 4096-byte body on the anonymous channel (lib/zk/anon/submit.ts): the text's JSON-escaped size
// and a link's length are bounded so every copy the policy takes also fits (a link weighs 23 whatever its length)
export const X_MAX_TEXT_BYTES = 2048;
export const X_MAX_LINK_CHARS = 512;
const X_DOMAIN = "layers-x-anon/1|";
// a link: an address with a scheme, or a bare domain the network would turn into a link anyway
const X_LINK_RE = /\bhttps?:\/\/[^\s<>"]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|xyz|eth|app|co|me|dev|gg|so|ai|ly|tv|news|info|blog|link)\b(?:\/[^\s<>"]*)?/gi;
const X_MENTION_RE = /(^|[^A-Za-z0-9_])[@\uFF20][A-Za-z0-9_]/;
const X_HASHTAG_RE = /(^|[^A-Za-z0-9_&])[#\uFF03][A-Za-z0-9_\u00C0-\uFFFF]+/g;
const X_CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f\u{2028}\u{2029}]/u;
const X_PARAGRAPH_RE = /\n[ \t]*\n/;

export type XPostShape = { ok: true; kind: "post" | "quote-link"; url: string | null; weighted: number; text: string } | { ok: false; reason: string };

function xCharWeight(cp: number): number {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}
export function xWeigh(s: string): number {
  let n = 0;
  for (const ch of s) n += xCharWeight(ch.codePointAt(0) as number);
  return n;
}
/** trailing sentence punctuation is not part of a link */
function xTrimLink(u: string): string {
  return u.replace(/[.,;:!?)\]'"]+$/, "");
}

/** The shape of an X post, or the refusal in plain words. PURE. */
export function xPostShape(raw: unknown): XPostShape {
  if (typeof raw !== "string") return { ok: false, reason: "Write something to post." };
  const text = raw.normalize("NFC").trim();
  if (!text) return { ok: false, reason: "Write something to post." };
  if (X_CONTROL_RE.test(text)) return { ok: false, reason: "The post has a character X can't show." };
  if (new TextEncoder().encode(JSON.stringify(text)).length - 2 > X_MAX_TEXT_BYTES) return { ok: false, reason: "That's too long to send." };
  if (X_MENTION_RE.test(text)) return { ok: false, reason: "Posts to @totem on X can't mention anyone: a mention from a shared account reads as spam to X, and it would tie the account to that person." };
  const links: string[] = [];
  let last = 0;
  let weighted = 0;
  let quote = "";
  X_LINK_RE.lastIndex = 0;
  for (let m = X_LINK_RE.exec(text); m; m = X_LINK_RE.exec(text)) {
    const url = xTrimLink(m[0]);
    links.push(url);
    const before = text.slice(last, m.index);
    weighted += xWeigh(before) + X_URL_WEIGHT;
    quote += before;
    last = m.index + url.length;
    X_LINK_RE.lastIndex = last;
  }
  weighted += xWeigh(text.slice(last));
  quote += text.slice(last);
  if (links.some((u) => !/^https:\/\//i.test(u))) return { ok: false, reason: "Write the link in full, starting with https://." };
  if (links.length > 1) return { ok: false, reason: "A post to X can carry one link at most." };
  if (links.some((u) => [...u].length > X_MAX_LINK_CHARS)) return { ok: false, reason: "That link is too long to send." };
  const tags = text.match(X_HASHTAG_RE) || [];
  if (tags.length > X_MAX_HASHTAGS) return { ok: false, reason: "Use two hashtags at most." };
  if (X_PARAGRAPH_RE.test(text)) return { ok: false, reason: "One paragraph only: an article goes to X as a short quote and its link, never in full." };
  if (weighted > X_MAX_WEIGHTED) return { ok: false, reason: `That's too long for X: ${weighted} of ${X_MAX_WEIGHTED} (a link counts as ${X_URL_WEIGHT}).` };
  if (links.length === 1) {
    const own = quote.replace(/\s+/g, " ").trim();
    if (!own) return { ok: false, reason: "Add a few words of your own with the link." };
    if ([...own].length > X_QUOTE_MAX_CHARS) return { ok: false, reason: `With a link, keep your own words to ${X_QUOTE_MAX_CHARS} characters: quote it and link it, never paste it in full.` };
    return { ok: true, kind: "quote-link", url: links[0], weighted, text };
  }
  return { ok: true, kind: "post", url: null, weighted, text };
}

/** null when the text may go to the outbox; otherwise the refusal, in words */
export function validateXText(raw: unknown): string | null {
  const s = xPostShape(raw);
  return s.ok ? null : s.reason;
}

/** sha256("layers-x-anon/1|" + nonce + "|" + text) — the X copy's id; domain-separated from the cast hash */
export function xHashOf(text: string, nonce: string): string {
  return createHash("sha256").update(X_DOMAIN + String(nonce) + "|" + String(text), "utf8").digest("hex");
}
