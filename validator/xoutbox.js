"use strict";
// PERSONA LAUNCH P8 — THE @totem X OUTBOX, FIXTURE ONLY (a live transport does not exist: O4, the owner's X account and
// developer billing, is not set up, and nothing here can reach X — this module imports no socket, http or fetch).
//
// What it is for (plan §2.6): "also post to @totem on X" on an anon post. The device proves an `x-anon-post` claim (the
// SAME proof as an anon post, plain anon tree, its OWN slot: scope x-anon-post/w<n>/s<i>, i < K_X — validator/zk.js) and
// sends it over the anonymous channel; zk.js verifies it and calls enqueueX INSIDE the nullifier transaction (a throw
// here rolls the nullifier back: nothing is queued without its nullifier, no nullifier is spent without its row).
//
// THE OWNER RULE FOR A PUBLIC ANONYMOUS ACCOUNT: MODERATION BEFORE ANYTHING POSTS. X suspends a shared account that posts
// spam, and an anonymous outbox is a spam magnet, so every row arrives as 'review' and only a MODERATOR's signed
// decision moves it to 'approved'; the relay posts approved rows only. No moderator configured = nothing is ever
// approved (fail closed). The validator stays KEYLESS: a moderator is a PUBLIC key (X_OUTBOX_MODERATORS, comma
// separated 64-hex Ed25519 keys; the private half lives on the owner's device, HKDF branch "layers/x-moderator/1",
// lib/x/outbox/moderation.ts) — or, on a rig only (ZK_DEV_HOOKS=true), a key registered through the dev route.
// Articles are QUOTE-AND-LINK, never full reposts: the text policy below allows one https link with at most 200 of the
// poster's own characters, no paragraph breaks, no @mentions (a mention from a shared account is the spam pattern X
// suspends for, and it would be a public edge from the anonymous account), at most two hashtags, and no duplicate of a
// row from the last 7 days.
//
// STATES: review → approved → posted (or failed), review → rejected. A rejected row is KEPT (hide, never delete) and its
// text is shown to nobody but the moderator (the review read lists the last 7 days' not-approved rows, so the panel can
// approve one after all); it can be re-decided until it is posted. A POSTED row can never be re-decided. Every decision
// is kept signed in x_outbox_decisions; a signature is accepted once (a replay is refused), and every decision carries a
// fresh nonce (moderate/2), so two decisions are never the same signature.
//
// WHAT ANYONE SEES (GET /x/outbox): id (the xHash), status, an hour, and — only once posted — the text and the fixture
// post id. The moderator (a signed read, GET /x/outbox/review) sees the texts waiting for a decision: that is the
// residual A-X-MODERATOR-SEES-TEXT (the moderator reads every anonymous X text before X does; it never learns who wrote
// one — the row names nobody).
//
// THE RELAY: approved rows wait for the next relay slot (X_OUTBOX_RELAY_INTERVAL_MS, default an hour) and then for a
// CSPRNG moment inside X_OUTBOX_RELAY_SPREAD_MS (30 minutes on the public shape, 0 elsewhere), in random order, at most
// X_OUTBOX_DAILY_CAP (default 50) posts a day, through the FIXTURE transport only (x_fixture_posts, posted id
// "xfix_"+sha256). The same cap bounds how many submissions a day the outbox takes.
//
// DELIBERATE DUPLICATES (pinned by scripts/unit-x-outbox.mjs, one side against the other): xPostShape / validateXText ↔
// lib/x/outbox/policy.ts; xHashOf ↔ lib/x/outbox/policy.ts; moderateCanonical / reviewCanonical ↔
// lib/x/outbox/moderation.ts.
//
// LOGGING DISCIPLINE (like zk.js): this module logs nothing.
const { createHash, randomInt } = require("node:crypto");
const { verifyEd25519, isUsablePubkey } = require("./crypto");

const HOUR = 3_600_000;
const DAY = 86_400_000;
const hourGrain = (t) => Math.floor(t / HOUR) * HOUR;
const X_HASH_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const PUBKEY_RE = /^[0-9a-f]{64}$/;
const X_DOMAIN = "layers-x-anon/1|";
const DUPLICATE_WINDOW_MS = 7 * DAY;
const LIST_MAX = 200;
const NOT_BUILT = "X posting is not built: only test data, and nothing reaches X";

// a knob whose BLANK value means unset (DELIBERATE DUPLICATE of envInt in validator/zk.js and lib/zk/config.ts)
const envInt = (name, def, lo, hi) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : def;
};
const isPublicDeployment = () => require("./env-contract").isPublicDeployment();
const relayIntervalMs = () => envInt("X_OUTBOX_RELAY_INTERVAL_MS", 3_600_000, 1000, DAY);
const relaySpreadMs = () => envInt("X_OUTBOX_RELAY_SPREAD_MS", isPublicDeployment() ? 1_800_000 : 0, 0, DAY);
const dailyCap = () => envInt("X_OUTBOX_DAILY_CAP", 50, 0, 10_000);

// ------------------------------------------------------------------------------------------------ the text policy
// DELIBERATE DUPLICATE of lib/x/outbox/policy.ts (the compose-time copy). Plain JavaScript on both sides on purpose: the
// unit harness runs the same corpus through both and requires byte-equal answers.
const X_MAX_WEIGHTED = 280;
const X_URL_WEIGHT = 23;
const X_QUOTE_MAX_CHARS = 200;
const X_MAX_HASHTAGS = 2;
// the envelope rides a CONSTANT 4096-byte body on the anonymous channel (lib/zk/anon/submit.ts): the text's JSON-escaped size
// and a link's length are bounded so every copy the policy takes also fits (a link weighs 23 whatever its length)
const X_MAX_TEXT_BYTES = 2048;
const X_MAX_LINK_CHARS = 512;
// a link: an address with a scheme, or a bare domain the network would turn into a link anyway
const X_LINK_RE = /\bhttps?:\/\/[^\s<>"]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|xyz|eth|app|co|me|dev|gg|so|ai|ly|tv|news|info|blog|link)\b(?:\/[^\s<>"]*)?/gi;
const X_MENTION_RE = /(^|[^A-Za-z0-9_])[@\uFF20][A-Za-z0-9_]/;
const X_HASHTAG_RE = /(^|[^A-Za-z0-9_&])[#\uFF03][A-Za-z0-9_\u00C0-\uFFFF]+/g;
const X_CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f\u{2028}\u{2029}]/u;
const X_PARAGRAPH_RE = /\n[ \t]*\n/;
/** X's weighted length: most Latin-script characters weigh 1, everything else (CJK, emoji, …) weighs 2, a link 23 */
function xCharWeight(cp) {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}
function xWeigh(s) {
  let n = 0;
  for (const ch of s) n += xCharWeight(ch.codePointAt(0));
  return n;
}
/** trailing sentence punctuation is not part of a link */
function xTrimLink(u) {
  return u.replace(/[.,;:!?)\]'"]+$/, "");
}
/**
 * The shape of an X post, or the refusal in plain words. PURE. {ok:true, kind:'post'|'quote-link', url, weighted, text}
 * where `text` is the NFC form the network would count; {ok:false, reason} otherwise.
 */
function xPostShape(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "Write something to post." };
  const text = raw.normalize("NFC").trim();
  if (!text) return { ok: false, reason: "Write something to post." };
  if (X_CONTROL_RE.test(text)) return { ok: false, reason: "The post has a character X can't show." };
  if (new TextEncoder().encode(JSON.stringify(text)).length - 2 > X_MAX_TEXT_BYTES) return { ok: false, reason: "That's too long to send." };
  if (X_MENTION_RE.test(text)) return { ok: false, reason: "Posts to @totem on X can't mention anyone: a mention from a shared account reads as spam to X, and it would tie the account to that person." };
  const links = [];
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
/** null when the text may go to the outbox; otherwise the refusal, in words (the policy part — duplicates are per DB) */
function validateXText(raw) {
  const s = xPostShape(raw);
  return s.ok ? null : s.reason;
}
/** sha256("layers-x-anon/1|" + nonce + "|" + text) — domain-separated from the Farcaster cast hash ("layers-anon-cast/1") */
function xHashOf(text, nonce) {
  return createHash("sha256").update(X_DOMAIN + String(nonce) + "|" + String(text), "utf8").digest("hex");
}
/** two texts a reader would call the same words */
const sameWords = (s) => String(s).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

// ------------------------------------------------------------------------------------------------ the universe
function assertFixture(mode) {
  if (mode !== "fixture") throw Object.assign(new Error(NOT_BUILT), { status: 503 });
}

// ------------------------------------------------------------------------------------------------ the queue
/** today's UTC day [lo, hi) for an hour-grained clock */
function dayRange(now = Date.now()) {
  const lo = Math.floor(now / DAY) * DAY;
  return [lo, lo + DAY];
}
/** submissions the outbox took today (every status: a rejected one still came in) */
function submittedToday(db, mode, now = Date.now()) {
  const [lo, hi] = dayRange(now);
  return db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = ? AND created_hour >= ? AND created_hour < ?").get(mode, lo, hi).n;
}
function postedToday(db, mode, now = Date.now()) {
  const [lo, hi] = dayRange(now);
  return db.prepare("SELECT COUNT(*) AS n FROM x_outbox WHERE mode = ? AND status = 'posted' AND posted_hour >= ? AND posted_hour < ?").get(mode, lo, hi).n;
}
/** THE X DAILY CAP at submission — called by zk.js inside the record transaction, BEFORE the nullifier is consumed */
function assertDailyRoom(db, mode) {
  assertFixture(mode);
  if (submittedToday(db, mode) >= dailyCap()) throw Object.assign(new Error("the X outbox has taken today's posts — it opens again tomorrow"), { cap: true, status: 503 });
}
function recentDuplicate(db, mode, text, now = Date.now()) {
  const want = sameWords(text);
  return db
    .prepare("SELECT text FROM x_outbox WHERE mode = ? AND created_hour >= ?")
    .all(mode, hourGrain(now - DUPLICATE_WINDOW_MS))
    .some((r) => sameWords(r.text) === want);
}
/**
 * Called by zk.js INSIDE the nullifier transaction for an accepted x-anon-post proof. Never opens a transaction of its
 * own; any throw rolls the submission back. Refuses: any universe but fixture, a text the policy refuses, a payload that
 * does not hash to the proof's xHash, an xHash already in the outbox, and a duplicate of a row from the last 7 days.
 * The row is the text and its public shape, status 'review', the hour it arrived — nothing else.
 */
function enqueueX(db, mode, payload, xHash, epoch) {
  assertFixture(mode);
  void epoch; // the window is the proof's (its scope); the outbox keeps no epoch
  if (!payload || typeof payload !== "object" || typeof payload.text !== "string" || !NONCE_RE.test(String(payload.nonce))) throw Object.assign(new Error("the X post is malformed"), { status: 400 });
  if (!X_HASH_RE.test(String(xHash)) || xHashOf(payload.text, payload.nonce) !== xHash) throw Object.assign(new Error("the text does not hash to the proof's xHash"), { status: 400 });
  const shape = xPostShape(payload.text);
  if (!shape.ok) throw Object.assign(new Error("the outbox refused the text: " + shape.reason), { status: 400 });
  // the SAME copy again (its id is sha256 of its nonce and words): it IS in the outbox — a replay, like a spent nullifier
  if (db.prepare("SELECT 1 FROM x_outbox WHERE mode = ? AND id = ?").get(mode, xHash)) throw Object.assign(new Error("this post is already in the X outbox"), { status: 409 });
  // PERSONA LAUNCH wave 3 (W3-X-DUP-AS-REPLAY): repeated WORDS under a new copy are a CONTENT refusal — 400, never 409.
  // The anonymous channel maps 409 to 'replay' (validator/anon.js classify), and the device counts a replay as a held X
  // slot (lib/zk/anon/slots.ts slotHeld), so a 409 here burned the person's X slot for the window — the transaction rolled
  // the nullifier back, the slot was in fact free — and the status line said "this window's post to @totem on X was
  // already used", which was false. A 400 is 'refused': the slot stays free and the line says it was refused.
  if (recentDuplicate(db, mode, payload.text)) throw Object.assign(new Error("these words already went to the X outbox this week — X treats repeats as spam"), { status: 400 });
  db.prepare("INSERT INTO x_outbox (mode, id, text, kind, url, status, created_hour, decided_hour, due_at, posted_id, posted_hour, attempts) VALUES (?, ?, ?, ?, ?, 'review', ?, NULL, NULL, NULL, NULL, 0)").run(
    mode,
    xHash,
    payload.text,
    shape.kind,
    shape.url,
    hourGrain(Date.now())
  );
  return { status: "review" };
}

// ------------------------------------------------------------------------------------------------ moderation
/**
 * what a moderator signs to decide one row — DELIBERATE DUPLICATE of lib/x/outbox/moderation.ts moderateCanonical.
 * PERSONA LAUNCH wave 3 (W3-X-MOD-SAME-HOUR): /2 binds a FRESH 16-byte nonce into every decision. /1 covered (mode, id,
 * decision, issuedHour) only and Ed25519 signing is deterministic, so the same decision on the same row inside one hour
 * was byte-identical and refused as a replay: reject on the laptop, approve from a stale phone list, and the corrective
 * "not approve" then failed 409 — the row stayed approved and went out at the next slot. With a nonce every decision is
 * its own signature, and the replay check (one signature, once) still stands.
 */
const moderateCanonical = (mode, id, decision, issuedHour, nonce) => ["layers-x-moderate/2", mode, id, decision, String(issuedHour), String(nonce)].join("|");
const MOD_NONCE_RE = /^[0-9a-f]{32}$/;
/** what a moderator signs to read the texts waiting — DELIBERATE DUPLICATE of lib/x/outbox/moderation.ts reviewCanonical */
const reviewCanonical = (mode, issuedHour, pubkey) => ["layers-x-review/1", mode, String(issuedHour), pubkey].join("|");
/** the configured moderators: PUBLIC keys only (the validator never holds a private one) */
function configuredModerators() {
  return String(process.env.X_OUTBOX_MODERATORS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((k) => PUBKEY_RE.test(k) && isUsablePubkey(k));
}
/** every key that may decide here: the configured ones, plus the rig's dev-registered ones (dev hooks only) */
function moderatorsFor(db, mode, devHooks) {
  const out = new Set(configuredModerators());
  if (devHooks) for (const r of db.prepare("SELECT pubkey FROM x_outbox_moderators WHERE mode = ?").all(mode)) out.add(r.pubkey);
  return [...out].sort();
}
const hourNumber = (t = Date.now()) => Math.floor(t / HOUR);
/** the signed hour must be this hour or one either side (a decision is fresh, never a stored blank cheque) */
const freshHour = (h) => Number.isInteger(h) && Math.abs(h - hourNumber()) <= 1;

/**
 * POST /x/outbox/moderate {mode, id, decision, issuedHour, nonce, pubkey, sig}. Returns {status, json}. One transaction.
 * Order: universe, shape, a moderator exists at all (none = nothing is ever approved), the key is a moderator's, the
 * signature, the replay, the row (posted or failed = final), the decision's hour not older than the row's last one.
 */
function moderate(db, body, opts = {}) {
  const b = body || {};
  const mode = String(b.mode || "fixture");
  if (mode !== "fixture") return { status: 400, json: { error: NOT_BUILT } };
  const id = String(b.id || "");
  const decision = String(b.decision || "");
  const pubkey = String(b.pubkey || "").toLowerCase();
  const sig = String(b.sig || "").toLowerCase();
  const nonce = String(b.nonce || "").toLowerCase();
  const issuedHour = Number(b.issuedHour);
  if (!X_HASH_RE.test(id)) return { status: 400, json: { error: "id must be the post's 64-hex id" } };
  if (decision !== "approve" && decision !== "reject") return { status: 400, json: { error: "decision must be approve or reject" } };
  if (!freshHour(issuedHour)) return { status: 400, json: { error: "the decision's hour is not this hour — sign it again" } };
  if (!MOD_NONCE_RE.test(nonce)) return { status: 400, json: { error: "the decision must carry a fresh 32-hex nonce — sign it again" } };
  if (!PUBKEY_RE.test(pubkey) || !SIG_RE.test(sig)) return { status: 400, json: { error: "pubkey and sig are required" } };
  const mods = moderatorsFor(db, mode, opts.devHooks === true);
  if (mods.length === 0) return { status: 403, json: { error: "no moderator is set up on this validator, so nothing is ever approved" } };
  if (!mods.includes(pubkey)) return { status: 403, json: { error: "that key is not a moderator here" } };
  if (!verifyEd25519(sig, moderateCanonical(mode, id, decision, issuedHour, nonce), pubkey)) return { status: 403, json: { error: "the moderation signature does not verify" } };
  if (db.prepare("SELECT 1 FROM x_outbox_decisions WHERE mode = ? AND signature = ?").get(mode, sig)) return { status: 409, json: { error: "this signed decision was already used (a replay)" } };
  const row = db.prepare("SELECT status, decided_hour FROM x_outbox WHERE mode = ? AND id = ?").get(mode, id);
  if (!row) return { status: 404, json: { error: "no such post in the X outbox" } };
  if (row.status === "posted") return { status: 409, json: { error: "this post already went out — a posted post can't be decided again" } };
  if (row.status === "failed") return { status: 409, json: { error: "this post failed to go out — it can't be decided again" } };
  if (row.decided_hour !== null && row.decided_hour !== undefined && issuedHour * HOUR < row.decided_hour) return { status: 409, json: { error: "a newer decision exists for this post" } };
  const now = Date.now();
  const decidedHour = hourGrain(now);
  db.exec("BEGIN");
  try {
    if (decision === "approve") {
      // due at the next top of the hour at the earliest: the relay's slot and its spread decide the moment
      db.prepare("UPDATE x_outbox SET status = 'approved', decided_hour = ?, due_at = ? WHERE mode = ? AND id = ?").run(decidedHour, decidedHour + HOUR, mode, id);
    } else {
      db.prepare("UPDATE x_outbox SET status = 'rejected', decided_hour = ?, due_at = NULL WHERE mode = ? AND id = ?").run(decidedHour, mode, id);
    }
    db.prepare("INSERT INTO x_outbox_decisions (mode, id, decision, moderator_pubkey, signature, decided_hour) VALUES (?, ?, ?, ?, ?, ?)").run(mode, id, decision, pubkey, sig, decidedHour);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return { status: 500, json: { error: "decision not recorded: " + (e && e.message ? e.message : String(e)) } };
  }
  relayMoments.delete(mode + ":" + id);
  return { status: 200, json: { ok: true, id, status: decision === "approve" ? "approved" : "rejected", decidedHour } };
}

/** GET /x/outbox/review — the texts waiting for a decision, approved and not yet posted, and (PERSONA LAUNCH wave 3,
 *  UXH-7) NOT APPROVED: a rejected row is kept and may be re-decided until it is posted, so the moderator's panel lists it
 *  (collapsed) with Approve — the moderator already read it; nobody else ever sees its text. To a moderator's signed read. */
function review(db, q, opts = {}) {
  const mode = String(q.mode || "fixture");
  if (mode !== "fixture") return { status: 400, json: { error: NOT_BUILT } };
  const pubkey = String(q.pubkey || "").toLowerCase();
  const sig = String(q.sig || "").toLowerCase();
  const issuedHour = Number(q.issuedHour);
  if (!freshHour(issuedHour)) return { status: 400, json: { error: "the read's hour is not this hour — sign it again" } };
  const mods = moderatorsFor(db, mode, opts.devHooks === true);
  if (!mods.includes(pubkey)) return { status: 403, json: { error: mods.length ? "that key is not a moderator here" : "no moderator is set up on this validator" } };
  if (!verifyEd25519(sig, reviewCanonical(mode, issuedHour, pubkey), pubkey)) return { status: 403, json: { error: "the review signature does not verify" } };
  const rows = db
    // the rows waiting first (a pile of old rejections must never push a new copy out of the list), then approved, then
    // the not-approved rows decided in the last 7 days (older ones stay kept and hidden: hide, never delete)
    .prepare(
      "SELECT id, text, kind, url, status, created_hour, decided_hour FROM x_outbox WHERE mode = ? AND (status IN ('review', 'approved') OR (status = 'rejected' AND decided_hour >= ?)) " +
        "ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_hour ASC, id ASC LIMIT ?"
    )
    .all(mode, hourGrain(Date.now() - DUPLICATE_WINDOW_MS), LIST_MAX);
  return { status: 200, json: { mode, testData: true, items: rows.map((r) => ({ id: r.id, text: r.text, kind: r.kind, url: r.url ?? null, status: r.status, hour: r.decided_hour ?? r.created_hour })) } };
}

// ------------------------------------------------------------------------------------------------ the public list
/** latest 200 rows: id, status, an hour, and — ONLY once posted — the text and the fixture post id. A rejected row is
 *  listed as rejected (so its poster's device can say "not approved") and its text is never shown. */
function publicList(db, mode) {
  return db
    .prepare("SELECT id, status, created_hour, decided_hour, posted_id, posted_hour, text FROM x_outbox WHERE mode = ? ORDER BY created_hour DESC, id ASC LIMIT ?")
    .all(mode, LIST_MAX)
    .map((r) => ({
      id: r.id,
      status: r.status,
      hour: r.status === "posted" ? r.posted_hour : r.decided_hour ?? r.created_hour,
      postedId: r.status === "posted" ? r.posted_id : null,
      text: r.status === "posted" ? r.text : null,
    }));
}
function publicConfig(db, mode, devHooks) {
  let kx = 1;
  try {
    kx = require("./zk").xAnonPostSlots();
  } catch {
    kx = 1;
  }
  const mods = moderatorsFor(db, mode, devHooks);
  return {
    mode,
    testData: true,
    transport: "fixture",
    live: false,
    // the X slots per window (K_X) — named apart from the anon config's slotsPerWindow so no reader can mix the two
    xSlotsPerWindow: kx,
    dailyCap: dailyCap(),
    // public anyway: the list shows every row's hour
    dailyUsed: submittedToday(db, mode),
    postedToday: postedToday(db, mode),
    relayIntervalMs: relayIntervalMs(),
    relaySpreadMs: relaySpreadMs(),
    moderated: mods.length > 0,
    moderators: mods,
  };
}

// ------------------------------------------------------------------------------------------------ the transport
/** THE ONLY TRANSPORT: the fixture. It writes x_fixture_posts and nothing else — there is no live one to choose. */
const fixtureTransport = {
  destination: "fixture",
  post(db, mode, row) {
    const postedId = "xfix_" + createHash("sha256").update("layers-x-fixture-post/1|" + mode + "|" + row.id, "utf8").digest("hex").slice(0, 24);
    db.prepare("INSERT OR IGNORE INTO x_fixture_posts (mode, posted_id, text, posted_hour) VALUES (?, ?, ?, ?)").run(mode, postedId, row.text, hourGrain(Date.now()));
    return { postedId };
  },
};
function transportFor(mode) {
  assertFixture(mode);
  return fixtureTransport;
}

// ------------------------------------------------------------------------------------------------ the relay
/** "mode:id" → the CSPRNG moment inside the spread an approved row may go out at (in memory; drawn at its slot) */
const relayMoments = new Map();
/**
 * Post the approved rows whose moment has come, in random order, at most the daily cap a day, through the fixture
 * transport. `now: true` (the rig's relay-now) posts every approved row at once, ignoring its due hour and the spread —
 * never an unapproved one, never past the cap.
 */
function relayDue(db, mode, opts = {}) {
  const transport = transportFor(mode);
  const now = Date.now();
  let rows = db.prepare("SELECT id, text, due_at FROM x_outbox WHERE mode = ? AND status = 'approved'").all(mode);
  if (opts.now !== true) rows = rows.filter((r) => relayMoments.has(mode + ":" + r.id) && relayMoments.get(mode + ":" + r.id) <= now);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const report = { posted: 0, capped: 0, failed: 0, destination: transport.destination };
  let used = postedToday(db, mode, now);
  const cap = dailyCap();
  for (const r of rows) {
    if (used >= cap) {
      report.capped++;
      continue;
    }
    db.exec("BEGIN");
    try {
      const { postedId } = transport.post(db, mode, r);
      db.prepare("UPDATE x_outbox SET status = 'posted', posted_id = ?, posted_hour = ?, attempts = attempts + 1 WHERE mode = ? AND id = ? AND status = 'approved'").run(postedId, hourGrain(now), mode, r.id);
      db.exec("COMMIT");
      used++;
      report.posted++;
      relayMoments.delete(mode + ":" + r.id);
    } catch {
      db.exec("ROLLBACK");
      report.failed++;
    }
  }
  return report;
}
/** at a relay slot: every approved row whose due hour has come gets its moment inside the spread (CSPRNG) */
function drawMoments(db, mode, now = Date.now()) {
  const spread = relaySpreadMs();
  for (const r of db.prepare("SELECT id FROM x_outbox WHERE mode = ? AND status = 'approved' AND due_at <= ?").all(mode, now)) {
    const k = mode + ":" + r.id;
    if (!relayMoments.has(k)) relayMoments.set(k, now + (spread > 0 ? randomInt(0, spread + 1) : 0));
  }
}

/** the fixture universe forgets every X row, decision, dev moderator and fixture post */
function resetFixture(db, mode = "fixture") {
  if (mode !== "fixture") throw new Error("reset is fixture-only");
  for (const t of ["x_outbox", "x_outbox_decisions", "x_outbox_moderators", "x_fixture_posts"]) db.prepare(`DELETE FROM ${t} WHERE mode = ?`).run(mode);
  for (const k of [...relayMoments.keys()]) if (k.startsWith(mode + ":")) relayMoments.delete(k);
}

// ------------------------------------------------------------------------------------------------ routes
function mountXOutbox(app, db, opts = {}) {
  const devHooks = opts.devHooks === true;
  const fixtureOnly = (req, res) => {
    const mode = String((req.query && req.query.mode) || (req.body && req.body.mode) || "fixture");
    if (mode !== "fixture") {
      res.status(400).json({ error: NOT_BUILT });
      return null;
    }
    return mode;
  };
  const devOnly = (res) => {
    if (!devHooks) {
      res.status(403).json({ error: "X outbox dev hooks are disabled (ZK_DEV_HOOKS)" });
      return false;
    }
    return true;
  };
  // PUBLIC: every device that offers the outbox reads the whole list on its fixed schedule (never a per-id read)
  app.get("/x/outbox", (req, res) => {
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    res.json({ mode, testData: true, items: publicList(db, mode) });
  });
  app.get("/x/outbox/config", (req, res) => {
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    res.json(publicConfig(db, mode, devHooks));
  });
  app.get("/x/outbox/review", (req, res) => {
    const r = review(db, req.query || {}, { devHooks });
    res.status(r.status).json(r.json);
  });
  app.post("/x/outbox/moderate", (req, res) => {
    const r = moderate(db, req.body || {}, { devHooks });
    res.status(r.status).json(r.json);
  });
  // ---- the rig's hooks (ZK_DEV_HOOKS=true only) ----
  app.post("/x/outbox/dev/moderator", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const pubkey = String((req.body || {}).pubkey || "").toLowerCase();
    if (!PUBKEY_RE.test(pubkey) || !isUsablePubkey(pubkey)) return res.status(400).json({ error: "pubkey must be a usable 64-hex Ed25519 key" });
    db.prepare("INSERT OR IGNORE INTO x_outbox_moderators (mode, pubkey, added_hour) VALUES (?, ?, ?)").run(mode, pubkey, hourGrain(Date.now()));
    res.status(201).json({ ok: true, moderators: moderatorsFor(db, mode, true) });
  });
  app.post("/x/outbox/dev/relay-now", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    try {
      res.json({ ok: true, ...relayDue(db, mode, { now: true }) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.get("/x/outbox/dev/transport-log", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const rows = db.prepare("SELECT posted_id, text, posted_hour FROM x_fixture_posts WHERE mode = ? ORDER BY posted_hour, posted_id").all(mode);
    res.json({ mode, entries: rows.map((r) => ({ destination: "fixture", postedId: r.posted_id, text: r.text, hour: r.posted_hour })) });
  });
  app.post("/x/outbox/dev/reset", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    resetFixture(db, mode);
    res.json({ ok: true });
  });
  // THE RELAY LOOP: slots every X_OUTBOX_RELAY_INTERVAL_MS; between slots, a row whose spread moment has come goes out.
  // Fixture universe only; a broken table (before migration 26) is retried next round, silently (this module logs nothing).
  let nextSlot = 0;
  const timer = setInterval(() => {
    try {
      const now = Date.now();
      const iv = relayIntervalMs();
      if (nextSlot === 0) nextSlot = (Math.floor(now / iv) + 1) * iv;
      if (now >= nextSlot) {
        nextSlot = 0;
        drawMoments(db, "fixture", now);
      }
      if (relayMoments.size) relayDue(db, "fixture");
    } catch {
      /* retried next round */
    }
  }, 15_000);
  if (timer.unref) timer.unref();
}

module.exports = {
  mountXOutbox,
  xPostShape,
  validateXText,
  xHashOf,
  xWeigh,
  enqueueX,
  assertDailyRoom,
  recentDuplicate,
  moderate,
  review,
  moderateCanonical,
  reviewCanonical,
  configuredModerators,
  moderatorsFor,
  publicList,
  publicConfig,
  relayDue,
  drawMoments,
  resetFixture,
  transportFor,
  submittedToday,
  postedToday,
  dailyCap,
  relayIntervalMs,
  relaySpreadMs,
  X_MAX_WEIGHTED,
  X_URL_WEIGHT,
  X_QUOTE_MAX_CHARS,
  X_MAX_HASHTAGS,
  X_MAX_TEXT_BYTES,
  X_MAX_LINK_CHARS,
  NOT_BUILT,
};
