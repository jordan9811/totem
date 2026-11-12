"use strict";
// PERSONA LAUNCH P6 — THE LAYERS REGISTRAR, SIMULATED (fixture only, $0; a live mode does not exist — any non-fixture
// call throws or answers 400).
//
// What it is for (D6 / R1–R3): a launched persona's Farcaster account is created by LAYERS, not by the user's wallet,
// so nothing onchain joins the persona to the person (no funder trace, no sibling registrant, no click-time block).
// The device builds a LAUNCH REQUEST — the persona's derived custody address, its derived recovery address, its derived
// self-custody signer key, the name and profile it wants, and two EIP-712 signatures by the custody key (IdGateway
// Register, KeyGateway Add) with a deadline quantized to a 7-DAY boundary (wave 3, L8: a day-quantized deadline published
// the click's day) — and sends it over the ANONYMOUS channel inside a
// one-launch-per-person-per-window proof (zk.js: claim kind "persona-launch"). The request names no root, no device, no
// persona id and no other persona. zk.js calls enqueueLaunch INSIDE the nullifier transaction (a throw rolls the whole
// submission back: nothing is queued without its nullifier, no nullifier is spent without its queue row).
//
// TIMING (R2, the 2–48 h promise): every request is DUE at one of the registrar's batch moments that falls inside
// [arrival + 2 h, arrival + 47.5 h] on the SIM CLOCK, chosen uniformly with a CSPRNG. Batch moments are one a day at a
// keyed-random hour in [06:00, 18:00) of the simulated day (an HMAC keyed by scheduleSeed(): itself an HMAC of the
// validator's signing key in zk_validator_key, per universe — never stored on its own, but anyone holding a database
// snapshot can recompute the batch hours, SECURITY-POSTURE's launch section), so two consecutive
// batches are 12 to 36 hours apart and the 45.5-hour window always holds at least one. The device's jittered send adds
// at most ~30 minutes between the click and the arrival, so registration lands 2 to 48 hours after the click. A batch
// registers every item due at its moment in ONE simulated Bundler call each (validator/simchain.js) and writes ONE $0
// registrar_spend row (simulated gas; usd_cents is 0, always). A batch of one in a quiet week is the residual
// A-LAUNCH-BATCH-OF-ONE.
//
// THE SIM CLOCK is the real clock plus registrar_clock.offset_ms (its own offset, separate from the zk epoch clock), so a
// rig can walk 48 hours in a second (dev hooks only: advance-clock, run-batch, reset). THE SCHEDULE'S KEY is derived
// from the validator's own private signing key (HMAC, domain-separated per universe): stable across restarts, never
// stored or served, and unknowable outside the operator — so nobody can predict a batch hour.
//
// THE BATCH REVEAL (D7 / R7): once the signer key is on the account, the device reveals EVERY anon post the persona made
// in one request signed by that key. revealBatch is all-or-nothing (one transaction): each secret is checked against
// its row's commitment, the key must be an ACTIVE key of the fid on the (simulated) KeyRegistry, the signature must
// verify over the canonical below, and first-reveal-wins holds per row. It stores the batch (signature + list) in
// zk_reveal_batches and the batch hash on every row (zk_anon_casts.attributed_batch).
//
// DELIBERATE DUPLICATES (pinned by scripts/unit-launch.mjs, one side against the other): canonicalLaunchRequest /
// launchCommitOf / the shape rules ↔ lib/launch/request.ts; revealBatchCanonical / castListHash ↔ lib/launch/reveal.ts.
//
// LOGGING DISCIPLINE (like zk.js): this module logs nothing.
const { createHash, createHmac, randomBytes, randomInt } = require("node:crypto");
const { verifyEd25519 } = require("./crypto");
const simchain = require("./simchain");

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN_DELAY_MS = 2 * HOUR;
const MAX_DELAY_MS = 47.5 * HOUR;
const MAX_REQUEST_BYTES = 2048;
const LAUNCH_DOMAIN = "layers-launch-request/1|";
const REVEAL_BATCH_DOMAIN = "layers-anon-reveal-batch/1";
// PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): 1,500 items is ~200 KB of JSON (two 64-hex strings and their quotes
// each), inside the validator's 256 KiB body limit (validator/limits.js STATE_BODY_LIMIT_BYTES). A persona with more is
// revealed in several signed batches sent back to back (lib/launch/reveal.ts revealParts — DELIBERATE DUPLICATE of
// REVEAL_BATCH_MAX_ITEMS there, pinned by scripts/unit-launch.mjs). It was 500: a persona past 500 posts could not be
// revealed at all.
const MAX_BATCH_ITEMS = 1500;
/** PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the complete anon-list read's page size (GET /registrar/anon-casts) */
const ANON_PAGE_MAX = 500;
/** PERSONA LAUNCH P6 (fix W2-LAUNCH-NO-ADOPTION): the registrations read returns the NEWEST rows first, at most this
 *  many — a full window drops its oldest rows, never the newest (the old oldest-first LIMIT 2000 dropped the newest) */
const REGISTRATIONS_MAX = 5000;
const hourGrain = (t) => Math.floor(t / HOUR) * HOUR;
const CAST_HASH_RE = /^[0-9a-f]{64}$/;

// ------------------------------------------------------------------------------------------------ the request
/** the ONE canonical form (fixed key order, JSON.stringify spacing) — DELIBERATE DUPLICATE of lib/launch/request.ts */
function canonicalLaunchRequest(r) {
  return JSON.stringify({
    v: r.v,
    mode: r.mode,
    custody: r.custody,
    recovery: r.recovery,
    signerKey: r.signerKey,
    fname: r.fname,
    profile: { displayName: r.profile.displayName, bio: r.profile.bio, pfpUrl: r.profile.pfpUrl },
    registerSig: r.registerSig,
    addSig: r.addSig,
    deadlineDay: r.deadlineDay,
  });
}
function parseLaunchRequest(s) {
  if (typeof s !== "string") return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" && !Array.isArray(o) && o.profile && typeof o.profile === "object" ? o : null;
  } catch {
    return null;
  }
}
/** sha256("layers-launch-request/1|" + request) — what the launch proof's message binds */
function launchCommitOf(request) {
  return createHash("sha256").update(LAUNCH_DOMAIN + String(request), "utf8").digest("hex");
}
const chars = (s) => [...String(s)].length;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
/** the SHAPE rules — DELIBERATE DUPLICATE of lib/launch/request.ts launchRequestShapeProblem */
function launchRequestShapeProblem(request) {
  if (typeof request !== "string" || !request) return "the launch request is missing";
  if (Buffer.byteLength(request, "utf8") > MAX_REQUEST_BYTES) return `the launch request is longer than ${MAX_REQUEST_BYTES} bytes`;
  const r = parseLaunchRequest(request);
  if (!r) return "the launch request is not a JSON object";
  if (r.v !== 1) return "the launch request's version is not 1";
  if (r.mode !== "fixture" && r.mode !== "live") return "the launch request's universe is not fixture or live";
  for (const k of ["custody", "recovery"]) if (typeof r[k] !== "string" || !/^0x[0-9a-f]{40}$/.test(r[k])) return `the launch request's ${k} address is malformed (0x + 40 lowercase hex)`;
  if (r.custody === r.recovery) return "the recovery address must differ from the custody address";
  if (typeof r.signerKey !== "string" || !/^[0-9a-f]{64}$/.test(r.signerKey)) return "the launch request's signer key is malformed";
  if (typeof r.fname !== "string" || !/^[a-z0-9][a-z0-9-]{0,15}$/.test(r.fname)) return "the name must be 1 to 16 lowercase letters, digits or hyphens, not starting with a hyphen";
  const p = r.profile;
  if (typeof p.displayName !== "string" || chars(p.displayName) > 32 || CONTROL_RE.test(p.displayName)) return "the display name is at most 32 characters";
  if (typeof p.bio !== "string" || chars(p.bio) > 256 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(p.bio)) return "the bio is at most 256 characters";
  if (typeof p.pfpUrl !== "string" || chars(p.pfpUrl) > 256 || (p.pfpUrl !== "" && !/^https:\/\/[^\s"<>]+$/.test(p.pfpUrl))) return "the picture must be an https address of at most 256 characters, or none";
  for (const k of ["registerSig", "addSig"]) if (typeof r[k] !== "string" || !/^0x[0-9a-f]{130}$/.test(r[k])) return `the launch request's ${k} is malformed`;
  if (!Number.isInteger(r.deadlineDay) || r.deadlineDay < 19_000 || r.deadlineDay > 100_000) return "the launch request's deadline day is implausible";
  if (canonicalLaunchRequest(r) !== request) return "the launch request is not in its canonical form";
  return null;
}
/**
 * null when the request is acceptable; otherwise the refusal, in words. Shape first, then THE LIVE REFUSAL (the
 * registrar has no live mode: O1), then the two custody signatures (EIP-712 recover, validator/simchain.js). Pure.
 */
function validateLaunchRequest(request) {
  const shape = launchRequestShapeProblem(request);
  if (shape) return shape;
  const r = parseLaunchRequest(request);
  if (r.mode !== "fixture") return "a live launch needs the Totem registrar, which isn't set up yet (O1)";
  return simchain.launchSignaturesProblem(r);
}

// ------------------------------------------------------------------------------------------------ the sim clock
function assertFixture(mode) {
  if (mode !== "fixture") throw new Error("the launch registrar has no live mode — a live launch needs the Totem registrar, which isn't set up yet (O1)");
}
function clockRow(db, mode) {
  assertFixture(mode);
  let r = db.prepare("SELECT offset_ms, next_batch_at FROM registrar_clock WHERE mode = ?").get(mode);
  if (!r) {
    db.prepare("INSERT OR IGNORE INTO registrar_clock (mode, offset_ms, next_batch_at) VALUES (?, 0, NULL)").run(mode);
    r = db.prepare("SELECT offset_ms, next_batch_at FROM registrar_clock WHERE mode = ?").get(mode);
  }
  return { offset_ms: Number(r.offset_ms || 0), next_batch_at: r.next_batch_at ?? null, seed: scheduleSeed(db, mode) };
}
/** the batch schedule's key: HMAC of the validator's private signing key (validator/zk.js validatorKey makes it on first
 *  use) under a per-universe domain — a secret only this validator holds, never written anywhere new */
function scheduleSeed(db, mode) {
  let row = db.prepare("SELECT pkcs8_hex FROM zk_validator_key WHERE id = 1").get();
  if (!row) {
    require("./zk").validatorKey(db);
    row = db.prepare("SELECT pkcs8_hex FROM zk_validator_key WHERE id = 1").get();
  }
  if (!row || !row.pkcs8_hex) throw new Error("the validator has no signing key to key the registrar's schedule with");
  return createHmac("sha256", Buffer.from(String(row.pkcs8_hex), "hex")).update("layers-registrar-schedule/1|" + mode, "utf8").digest("hex");
}
function simNow(db, mode) {
  return Date.now() + Number(clockRow(db, mode).offset_ms || 0);
}
function advanceClock(db, mode, ms) {
  const n = Math.floor(Number(ms));
  if (!Number.isFinite(n) || n < 0 || n > 30 * DAY) throw new Error("advance by 0 to 30 days of milliseconds");
  const r = clockRow(db, mode);
  db.prepare("UPDATE registrar_clock SET offset_ms = ? WHERE mode = ?").run(Number(r.offset_ms || 0) + n, mode);
  return simNow(db, mode);
}

// ------------------------------------------------------------------------------------------------ the schedule (pure)
/** the batch moment of simulated day `day`: 06:00 + a keyed-random offset in [0, 12 h) — so consecutive batches are 12
 *  to 36 hours apart (PURE: the seed is the universe's CSPRNG secret, so the hours are unpredictable from outside) */
function batchMoment(seedHex, day) {
  const h = createHmac("sha256", Buffer.from(String(seedHex), "hex")).update("layers-registrar-batch/1|" + day).digest();
  const r = h.readUIntBE(0, 6) / 2 ** 48; // [0, 1)
  return day * DAY + 6 * HOUR + Math.floor(r * 12 * HOUR);
}
/** every batch moment in [lo, hi] (PURE) */
function batchMomentsBetween(seedHex, lo, hi) {
  const out = [];
  for (let d = Math.floor(lo / DAY) - 1; d <= Math.floor(hi / DAY) + 1; d++) {
    const t = batchMoment(seedHex, d);
    if (t >= lo && t <= hi) out.push(t);
  }
  return out;
}
/** THE DUE TIME: a batch moment in [arrival + 2 h, arrival + 47.5 h], chosen uniformly (CSPRNG; `pick` is for tests).
 *  Never empty by construction (gaps ≤ 36 h < 45.5 h); a schedule that broke that throws rather than registering late. */
function assignDueAt(seedHex, arrivalMs, pick = randomInt) {
  const c = batchMomentsBetween(seedHex, arrivalMs + MIN_DELAY_MS, arrivalMs + MAX_DELAY_MS);
  if (!c.length) throw new Error("the registrar's schedule has no batch inside the 2 to 48 hour window — refusing rather than registering late");
  return c[pick(0, c.length)];
}

// ------------------------------------------------------------------------------------------------ the queue
/**
 * Called by zk.js INSIDE the nullifier transaction for an accepted persona-launch proof. Never opens a transaction of
 * its own; any throw rolls the submission back. Refuses: any universe but fixture (no live mode), a request that does
 * not validate or does not hash to the proof's launchCommit, and a deadline that cannot outlast the 48-hour window.
 * A custody address that already has a launch (queued or registered) or an account is ACCEPTED with no new row
 * (idempotent — see below); returns {due, existing?}.
 */
/** PERSONA LAUNCH wave 3 (L8): a deadline day the registrar publishes — a 7-day boundary (days since 1970, a multiple of 7) */
function deadlineIsQuantized(deadlineDay) {
  return Number.isInteger(deadlineDay) && deadlineDay % 7 === 0;
}
function enqueueLaunch(db, mode, request, launchCommit, epoch) {
  assertFixture(mode);
  const problem = validateLaunchRequest(request);
  if (problem) throw new Error(problem);
  if (launchCommitOf(request) !== launchCommit) throw new Error("the launch request does not hash to the proof's launchCommit");
  void epoch; // the window is the proof's (its scope); the registrar keeps no epoch
  const r = parseLaunchRequest(request);
  const now = simNow(db, mode);
  if (r.deadlineDay * DAY < now + 48 * HOUR) throw new Error("the launch request's deadline does not outlast the 48-hour window");
  // PERSONA LAUNCH wave 3 (L8): the deadline is public calldata on the real Bundler, forever. One that is not a 7-day
  // boundary names the day its launch was clicked (the old client's "click day + 4") — the registrar refuses to publish
  // it, so every request in a batch carries one of the few week deadlines (DELIBERATE DUPLICATE of lib/launch/request.ts
  // deadlineDayFor, which builds them)
  if (!deadlineIsQuantized(r.deadlineDay)) throw new Error("the launch request's deadline is not a 7-day boundary — it would publish the day the launch was clicked");
  // PERSONA LAUNCH P6 (fix W2-LAUNCH-NO-ADOPTION) — IDEMPOTENT PER CUSTODY. A device that lost its launch record (a
  // restart inside the deferred-persist window), or that re-proved a record persisted before its envelope existed, asks
  // again for the SAME custody address. Refusing that (a plain throw → a 500 → the device marked its launch failed) left
  // the persona unlaunchable for good while the first request still registered. Now a custody that already owns an
  // account, or already has a queued or registered launch, is ACCEPTED with no new row and the existing due time: the
  // device then finds the account in the uniform registrations read (or adopts it, lib/launch/tick.ts) exactly as if its
  // first request had been the only one. Only the custody key can sign Register for that address, so the second request
  // is the same persona's by construction; nothing about it is stored.
  if (simchain.fidOfCustody(db, mode, r.custody) !== null) return { due: null, existing: "registered" };
  const prior = db
    .prepare("SELECT request, due_at, status FROM launch_queue WHERE mode = ? AND status IN ('queued', 'registered')")
    .all(mode)
    .find((x) => (parseLaunchRequest(x.request) || {}).custody === r.custody);
  if (prior) return { due: prior.due_at, existing: prior.status };
  const due = assignDueAt(clockRow(db, mode).seed, now);
  // PERSONA LAUNCH P6 (fix LP-6): NO ARRIVAL HOUR is stored. requested_hour was written beside the registered fid and
  // kept forever, so a database snapshot joined the arrival (the click plus at most the drain's jitter) to the fid — the
  // very join the 2–48 h random batch exists to hide; nothing read it. The column stays (reach owns
  // validator/migrations.js) and is always NULL; the due time comes from the in-memory arrival only.
  // The SAME request again after the simulated chain refused it (a launch tried again in the same 7-day stretch rebuilds
  // the identical request: the deadline is quantized to a week and the signatures are deterministic) is re-queued in place —
  // launch_commit is UNIQUE, so a second INSERT would throw.
  const same = db.prepare("SELECT id FROM launch_queue WHERE mode = ? AND launch_commit = ?").get(mode, launchCommit);
  if (same) {
    db.prepare("UPDATE launch_queue SET request = ?, requested_hour = NULL, due_at = ?, status = 'queued', fid = NULL, batch_id = NULL WHERE id = ?").run(request, due, same.id);
  } else {
    db.prepare("INSERT INTO launch_queue (id, mode, launch_commit, request, requested_hour, due_at, status, fid, batch_id) VALUES (?, ?, ?, ?, NULL, ?, 'queued', NULL, NULL)").run(
      "lq_" + randomBytes(12).toString("hex"),
      mode,
      launchCommit,
      request,
      due
    );
  }
  db.prepare("UPDATE registrar_clock SET next_batch_at = (SELECT MIN(due_at) FROM launch_queue WHERE mode = ? AND status = 'queued') WHERE mode = ?").run(mode, mode);
  return { due };
}

/**
 * Run every batch whose moment has come (`now` on the sim clock): the queued items due at one moment form one batch —
 * one simulated Bundler call per item, one $0 spend row per batch — in one transaction each. An item the simulated
 * chain refuses is marked failed (it never retries into a later, off-schedule batch).
 */
function runDueBatches(db, mode, now = simNow(db, mode)) {
  assertFixture(mode);
  const due = db.prepare("SELECT id, launch_commit, request, due_at FROM launch_queue WHERE mode = ? AND status = 'queued' AND due_at <= ? ORDER BY due_at, id").all(mode, now);
  // an idle registrar touches nothing (the batch loop runs on every validator, the public one included)
  if (due.length) simchain.ensureRegistrarApp(db, mode);
  const groups = new Map();
  for (const it of due) {
    if (!groups.has(it.due_at)) groups.set(it.due_at, []);
    groups.get(it.due_at).push(it);
  }
  const report = { batches: 0, registered: 0, failed: 0, spendRows: 0 };
  for (const [at, items] of groups) {
    const batchId = "rb_" + randomBytes(10).toString("hex");
    db.exec("BEGIN");
    try {
      let ok = 0;
      for (const it of items) {
        const req = parseLaunchRequest(it.request);
        const res = req ? simchain.bundlerRegister(db, mode, req, batchId, at) : { error: "unreadable request" };
        if (res.fid) {
          db.prepare("UPDATE launch_queue SET status = 'registered', fid = ?, batch_id = ? WHERE id = ?").run(res.fid, batchId, it.id);
          ok++;
        } else {
          db.prepare("UPDATE launch_queue SET status = 'failed', batch_id = ? WHERE id = ?").run(batchId, it.id);
          report.failed++;
        }
      }
      // ONE simulated transaction per batch: gas is simulated (a nominal 400k gas per item at 0.001 gwei), and the
      // dollars are ZERO — always. Nothing here can spend: there is no wallet, no key and no network.
      if (ok > 0) {
        db.prepare("INSERT INTO registrar_spend (id, mode, batch_id, items, usd_cents, gas_wei, simulated, created_hour) VALUES (?, ?, ?, ?, 0, ?, 1, ?)").run(
          "rs_" + randomBytes(10).toString("hex"),
          mode,
          batchId,
          ok,
          String(BigInt(ok) * 400_000n * 1_000_000n),
          hourGrain(at)
        );
        report.spendRows++;
      }
      db.exec("COMMIT");
      report.batches++;
      report.registered += ok;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  db.prepare("UPDATE registrar_clock SET next_batch_at = (SELECT MIN(due_at) FROM launch_queue WHERE mode = ? AND status = 'queued') WHERE mode = ?").run(mode, mode);
  return report;
}

/**
 * PUBLIC, for every device's uniform tick read: each registered account's custody, recovery, fid, hour (hour-grained)
 * and ACTIVE signer keys — NEWEST FIRST, at most REGISTRATIONS_MAX (no persona, nothing else).
 *
 * PERSONA LAUNCH P6 (fix LP-1): the recovery address and the keys ride the list so a device checks "this account carries
 * exactly my persona's key and recovery" LOCALLY. It used to read GET /sim-chain/fid?fid=F and /sim-chain/keys?fid=F the
 * moment it noticed its registration — the first reads anyone made about F, before the public batch reveal gave anyone
 * a reason to: a beacon naming the new account. Both are public chain facts (IdRegistry's Register event, KeyRegistry's
 * Add event), and every device receives every row alike.
 * (fix W2-LAUNCH-NO-ADOPTION): newest first — the old oldest-first LIMIT 2000 cut the NEWEST rows off a busy week.
 */
function registrations(db, mode, sinceHour) {
  assertFixture(mode);
  const since = Number.isInteger(sinceHour) && sinceHour >= 0 ? sinceHour * HOUR : 0;
  const keysOfFid = db.prepare("SELECT key FROM sim_chain_keys WHERE mode = ? AND fid = ? AND removed_at IS NULL ORDER BY key");
  return db
    .prepare("SELECT custody, recovery, fid, registered_at FROM sim_chain_fids WHERE mode = ? AND fid != ? AND registered_at >= ? ORDER BY registered_at DESC, fid DESC LIMIT ?")
    .all(mode, simchain.REGISTRAR_APP_FID, since, REGISTRATIONS_MAX)
    .map((r) => ({ custody: r.custody, recovery: r.recovery, fid: r.fid, hour: Math.floor(r.registered_at / HOUR), keys: keysOfFid.all(mode, r.fid).map((k) => k.key) }));
}

// ------------------------------------------------------------------------------------------------ the complete anon list
/**
 * PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200) — THE COMPLETE PUBLIC ANON LIST, paged. validator/zk.js serves GET
 * /zk/anon-casts as the NEWEST 200 relayed rows (a feed's read), and the launch used that list as its oracle for "is this
 * post relayed": an older post of a persona fell out of the one-time batch reveal (D7), the preview, the history and the
 * proof. This read is complete and names nothing a feed read does not:
 *   ?sinceHour=H        rows relayed at or after hour H (every device's uniform tick read: lib/launch/tick.ts)
 *   ?attributedFid=F    the rows attributed to account F (a launched account's history and proof: public facts)
 *   ?before=<at>.<hash> the keyset cursor of the next page (relayed_at DESC, cast_hash ASC: the zk.js order)
 * at most ANON_PAGE_MAX rows a page; `next` is the following page's cursor, or null. The row shape is zk.js's. (Reach owns
 * validator/zk.js; this read lives with the registrar because only the launch needs the list complete.)
 */
function anonCastsPage(db, mode, q) {
  assertFixture(mode);
  const where = ["mode = ?", "status = 'relayed'"];
  const args = [mode];
  if (q.attributedFid !== undefined && q.attributedFid !== null) {
    where.push("attributed_fid = ?");
    args.push(q.attributedFid);
  } else {
    where.push("relayed_at >= ?");
    args.push((Number(q.sinceHour) || 0) * HOUR);
  }
  if (q.before) {
    where.push("(relayed_at < ? OR (relayed_at = ? AND cast_hash > ?))");
    args.push(q.before.at, q.before.at, q.before.hash);
  }
  const limit = Math.max(1, Math.min(ANON_PAGE_MAX, Number(q.limit) || ANON_PAGE_MAX));
  const rows = db
    .prepare(
      `SELECT cast_hash, text, epoch, relayed_at, network_hash, fid, attributed_fid, attributed_at, attributed_signer, tree, tree_size, attributed_batch FROM zk_anon_casts WHERE ${where.join(" AND ")} ORDER BY relayed_at DESC, cast_hash ASC LIMIT ?`
    )
    .all(...args, limit);
  const last = rows[rows.length - 1];
  return {
    casts: rows.map((r) => ({
      hash: r.network_hash,
      castHash: r.cast_hash,
      text: r.text,
      at: r.relayed_at,
      fid: r.fid,
      epoch: r.epoch,
      attributedFid: r.attributed_fid ?? null,
      attributedAt: r.attributed_at ?? null,
      attributedSigner: r.attributed_signer ?? null,
      tree: r.tree ?? null,
      treeSize: r.tree_size ?? null,
      attributedBatch: r.attributed_batch ?? null,
    })),
    next: rows.length === limit && last ? `${last.relayed_at}.${last.cast_hash}` : null,
  };
}
/** "<relayed_at>.<cast hash>" → {at, hash}, or null when malformed */
function parseAnonCursor(s) {
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(String(s || ""));
  return m ? { at: Number(m[1]), hash: m[2] } : null;
}

// ------------------------------------------------------------------------------------------------ the batch reveal
/** sha256 of the cast hashes, sorted, joined by "," — DELIBERATE DUPLICATE of lib/launch/reveal.ts castListHash */
function castListHash(castHashes) {
  return createHash("sha256").update([...castHashes].sort().join(","), "utf8").digest("hex");
}
/** what the registered signer signs — DELIBERATE DUPLICATE of lib/launch/reveal.ts revealBatchCanonical */
function revealBatchCanonical(mode, fid, signerPubKey, castHashes) {
  return [REVEAL_BATCH_DOMAIN, mode, String(fid), signerPubKey, castListHash(castHashes)].join("|");
}

/**
 * POST /zk/anon/reveal {batch: true, mode, fid, signerPubKey, castHashes[], secrets[], signature} (zk.js hands the body
 * here). Returns {status, json}. ALL OR NOTHING: one bad item refuses the whole batch and writes nothing.
 */
function revealBatch(db, b) {
  b = b || {};
  const mode = String(b.mode || "fixture");
  if (mode === "live") return { status: 400, json: { error: "a live batch reveal needs the live key registry, which this build does not read (F25)" } };
  if (mode !== "fixture") return { status: 400, json: { error: "mode invalid" } };
  const fid = Number(b.fid);
  const signerPubKey = String(b.signerPubKey || "");
  const signature = String(b.signature || "");
  const castHashes = Array.isArray(b.castHashes) ? b.castHashes.map(String) : null;
  const secrets = Array.isArray(b.secrets) ? b.secrets.map(String) : null;
  if (!Number.isInteger(fid) || fid <= 0) return { status: 400, json: { error: "fid required" } };
  if (!/^[0-9a-f]{64}$/.test(signerPubKey)) return { status: 400, json: { error: "signerPubKey malformed" } };
  if (!/^[0-9a-f]{128}$/.test(signature)) return { status: 400, json: { error: "signature malformed" } };
  if (!castHashes || !secrets || castHashes.length === 0 || castHashes.length !== secrets.length || castHashes.length > MAX_BATCH_ITEMS)
    return { status: 400, json: { error: `castHashes and secrets: 1 to ${MAX_BATCH_ITEMS} of each, the same number` } };
  if (new Set(castHashes).size !== castHashes.length) return { status: 400, json: { error: "a cast appears twice in the batch" } };
  for (let i = 0; i < castHashes.length; i++) {
    if (!CAST_HASH_RE.test(castHashes[i])) return { status: 400, json: { error: "castHash malformed" } };
    if (!CAST_HASH_RE.test(secrets[i])) return { status: 400, json: { error: "secret malformed" } };
  }
  const canonical = revealBatchCanonical(mode, fid, signerPubKey, castHashes);
  if (!verifyEd25519(signature, canonical, signerPubKey)) return { status: 400, json: { error: "the batch signature does not verify under the signer key given" } };
  // the key must be one the (simulated) KeyRegistry lists for this fid, now — the reveal is checkable by anyone, so a
  // key the chain does not list is refused here too (the reader checks it again; never trust one side alone)
  if (!simchain.isActiveKey(db, mode, fid, signerPubKey)) return { status: 400, json: { error: "that key is not a registered signer of the account" } };
  const batchHash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const done = db.prepare("SELECT fid FROM zk_reveal_batches WHERE mode = ? AND batch_hash = ?").get(mode, batchHash);
  if (done) return { status: 200, json: { ok: true, alreadyRevealed: true, batchHash, fid: done.fid } };
  // PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): EVERY item without a relayed row is named in the refusal (not only the
  // first one met), so a device learns in one round which of its posts are not relayed yet — still all or nothing:
  // nothing is written while any is missing
  const relayedRow = db.prepare("SELECT 1 FROM zk_anon_casts WHERE mode = ? AND cast_hash = ? AND status = 'relayed'");
  const notRelayed = castHashes.filter((h) => !relayedRow.get(mode, h));
  if (notRelayed.length) return { status: 404, json: { error: `${notRelayed.length} post(s) in the batch have no relayed anon row — nothing was revealed`, notRelayed } };
  const attributedAt = hourGrain(Date.now()); // coarse, like every other anon-cast timestamp
  const fail = (status, error) => Object.assign(new Error(error), { status });
  db.exec("BEGIN");
  try {
    let revealed = 0;
    for (let i = 0; i < castHashes.length; i++) {
      const row = db.prepare("SELECT attribution_commitment, attributed_fid FROM zk_anon_casts WHERE mode = ? AND cast_hash = ? AND status = 'relayed'").get(mode, castHashes[i]);
      if (!row) throw fail(404, "no relayed anon cast with hash " + castHashes[i].slice(0, 12) + "… — nothing was revealed");
      if (createHash("sha256").update("layers-anon-attribution/1|" + secrets[i], "utf8").digest("hex") !== row.attribution_commitment) throw fail(400, "a secret does not match its cast's commitment — nothing was revealed");
      if (row.attributed_fid !== null && row.attributed_fid !== undefined && row.attributed_fid !== fid) throw fail(409, "a cast in the batch is already attributed to a different account — one reveal, ever; nothing was revealed");
      db.prepare("UPDATE zk_anon_casts SET attributed_fid = ?, attributed_at = COALESCE(attributed_at, ?), attributed_signer = COALESCE(attributed_signer, ?), attributed_batch = ? WHERE mode = ? AND cast_hash = ?").run(
        fid,
        attributedAt,
        signerPubKey,
        batchHash,
        mode,
        castHashes[i]
      );
      revealed++;
    }
    db.prepare("INSERT INTO zk_reveal_batches (mode, batch_hash, fid, signer, signature, cast_hashes, revealed_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      mode,
      batchHash,
      fid,
      signerPubKey,
      signature,
      JSON.stringify([...castHashes].sort()),
      attributedAt
    );
    db.exec("COMMIT");
    return { status: 200, json: { ok: true, batchHash, fid, revealed, attributedAt, attributedSigner: signerPubKey } };
  } catch (e) {
    db.exec("ROLLBACK");
    return { status: e && e.status ? e.status : 500, json: { error: e && e.status ? e.message : "reveal not recorded: " + (e && e.message) } };
  }
}

function revealBatchesFor(db, mode, fid) {
  return db
    .prepare("SELECT batch_hash, fid, signer, signature, cast_hashes, revealed_at FROM zk_reveal_batches WHERE mode = ? AND fid = ? ORDER BY revealed_at, batch_hash")
    .all(mode, fid)
    .map((r) => ({ batchHash: r.batch_hash, fid: r.fid, signer: r.signer, signature: r.signature, castHashes: JSON.parse(r.cast_hashes), revealedAt: r.revealed_at }));
}

/** the fixture universe forgets every launch, the simulated chain, the spend rows, the clock and the reveal batches */
function resetFixture(db, mode = "fixture") {
  if (mode !== "fixture") throw new Error("reset is fixture-only");
  for (const t of ["launch_queue", "registrar_spend", "registrar_clock", "zk_reveal_batches"]) db.prepare(`DELETE FROM ${t} WHERE mode = ?`).run(mode);
  simchain.resetSimChain(db, mode);
  db.prepare("UPDATE zk_anon_casts SET attributed_batch = NULL WHERE mode = ?").run(mode);
}

// ------------------------------------------------------------------------------------------------ routes
function mountRegistrar(app, db, opts = {}) {
  const devHooks = opts.devHooks === true;
  const fixtureOnly = (req, res) => {
    const mode = String((req.query && req.query.mode) || (req.body && req.body.mode) || "fixture");
    if (mode !== "fixture") {
      res.status(400).json({ error: "the launch registrar has no live mode — a live launch needs the Totem registrar, which isn't set up yet (O1)" });
      return null;
    }
    return mode;
  };
  const devOnly = (res) => {
    if (!devHooks) {
      res.status(403).json({ error: "registrar dev hooks are disabled (ZK_DEV_HOOKS)" });
      return false;
    }
    return true;
  };
  app.get("/registrar/config", (req, res) => {
    res.json({ mode: "fixture", simulated: true, appFid: simchain.REGISTRAR_APP_FID, minDelayHours: 2, maxDelayHours: 48, usdCentsPerLaunch: 0 });
  });
  // every device reads this on EVERY tick with the same parameters (no device headers): a launched persona's device
  // learns its fid from it without ever asking about its own custody address
  app.get("/registrar/registrations", (req, res) => {
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const sinceHour = req.query.sinceHour === undefined ? 0 : Number(req.query.sinceHour);
    if (!Number.isInteger(sinceHour) || sinceHour < 0) return res.status(400).json({ error: "sinceHour must be a whole hour number" });
    res.json({ mode, simulated: true, registrations: registrations(db, mode, sinceHour) });
  });
  // PERSONA LAUNCH P6 (fix W2-LAUNCH-REVEAL-200): the COMPLETE public anon list, paged (anonCastsPage above)
  app.get("/registrar/anon-casts", (req, res) => {
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const q = { sinceHour: 0, attributedFid: null, before: null, limit: ANON_PAGE_MAX };
    if (req.query.attributedFid !== undefined) {
      q.attributedFid = Number(req.query.attributedFid);
      if (!Number.isInteger(q.attributedFid) || q.attributedFid <= 0) return res.status(400).json({ error: "attributedFid must be a positive whole number" });
    } else if (req.query.sinceHour !== undefined) {
      q.sinceHour = Number(req.query.sinceHour);
      if (!Number.isInteger(q.sinceHour) || q.sinceHour < 0) return res.status(400).json({ error: "sinceHour must be a whole hour number" });
    }
    if (req.query.before !== undefined) {
      q.before = parseAnonCursor(req.query.before);
      if (!q.before) return res.status(400).json({ error: "before must be <relayed_at>.<cast hash>" });
    }
    if (req.query.limit !== undefined) {
      q.limit = Number(req.query.limit);
      if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > ANON_PAGE_MAX) return res.status(400).json({ error: `limit must be 1 to ${ANON_PAGE_MAX}` });
    }
    res.json({ mode, simulated: true, ...anonCastsPage(db, mode, q) });
  });
  app.get("/registrar/reveal-batches", (req, res) => {
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const fid = Number(req.query.fid);
    if (!Number.isInteger(fid) || fid <= 0) return res.status(400).json({ error: "fid required" });
    res.json({ mode, simulated: true, fid, batches: revealBatchesFor(db, mode, fid) });
  });
  app.post("/registrar/dev/advance-clock", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    try {
      res.json({ ok: true, simNow: advanceClock(db, mode, (req.body || {}).ms) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/registrar/dev/run-batch", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    try {
      res.json({ ok: true, simNow: simNow(db, mode), ...runDueBatches(db, mode) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post("/registrar/dev/reset", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    resetFixture(db, mode);
    res.json({ ok: true });
  });
  app.get("/registrar/dev/state", (req, res) => {
    if (!devOnly(res)) return;
    const mode = fixtureOnly(req, res);
    if (!mode) return;
    const clock = clockRow(db, mode);
    res.json({
      mode,
      simNow: simNow(db, mode),
      offsetMs: clock.offset_ms,
      nextBatchAt: clock.next_batch_at,
      queue: db.prepare("SELECT * FROM launch_queue WHERE mode = ? ORDER BY due_at").all(mode),
      spend: db.prepare("SELECT * FROM registrar_spend WHERE mode = ? ORDER BY created_hour").all(mode),
      chainFids: db.prepare("SELECT * FROM sim_chain_fids WHERE mode = ? ORDER BY fid").all(mode),
      chainKeys: db.prepare("SELECT * FROM sim_chain_keys WHERE mode = ? ORDER BY fid").all(mode),
      fnames: db.prepare("SELECT * FROM sim_chain_fnames WHERE mode = ? ORDER BY fid").all(mode),
      revealBatches: db.prepare("SELECT batch_hash, fid, cast_hashes FROM zk_reveal_batches WHERE mode = ?").all(mode),
    });
  });
  // THE BATCH LOOP: on the sim clock, every 15 seconds — a batch whose moment has come registers its items. Fixture
  // universe only; a broken table (before migration 25) is retried next round, silently (this module logs nothing).
  const timer = setInterval(() => {
    try {
      runDueBatches(db, "fixture");
    } catch {
      /* retried next round */
    }
  }, 15_000);
  if (timer.unref) timer.unref();
}

module.exports = {
  mountRegistrar,
  canonicalLaunchRequest,
  parseLaunchRequest,
  launchCommitOf,
  launchRequestShapeProblem,
  validateLaunchRequest,
  enqueueLaunch,
  deadlineIsQuantized,
  runDueBatches,
  registrations,
  anonCastsPage,
  parseAnonCursor,
  revealBatch,
  revealBatchCanonical,
  castListHash,
  revealBatchesFor,
  resetFixture,
  simNow,
  advanceClock,
  batchMoment,
  batchMomentsBetween,
  assignDueAt,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  MAX_REQUEST_BYTES,
  MAX_BATCH_ITEMS,
  ANON_PAGE_MAX,
  REGISTRATIONS_MAX,
  LAUNCH_DOMAIN,
};
