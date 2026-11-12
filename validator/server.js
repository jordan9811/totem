"use strict";
const express = require("express");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { openDb, uid, singleAnchor, anchorOf } = require("./db");
const { scoreForRoot, tierForRoot } = require("./rep");
const { startPoller } = require("./poller");
const {
  verifyEd25519,
  isUsablePubkey,
  delegationCanonical,
  envelopeCanonical,
  revokeCanonical,
} = require("./crypto");

/** ZK PASS 2 Gate 4: the finest timestamp a persona-addressed row carries (attack-z2-1 #2) */
const hourGrain = (t) => Math.floor(t / 3_600_000) * 3_600_000;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// Crypto pass: when set to exactly "true", state writes require a
// device-signed envelope (registered delegation chain + monotonic
// counter). Off by default so the phase-1 seam is untouched until the
// deployment explicitly arms it.
const REQUIRE_SIG = process.env.LAYERS_REQUIRE_SIG === "true";
// BROWSER KEYSTORE PASS Gate 1 stage 2 (docs/custody-model.md D-CU-0-5): one device-auth anchor per root. A signed
// request carries its anchor through the device envelope (checkEnvelope stamps req.layersAnchor). Unsigned reads of
// state and the device list, unsigned rep events and unsigned root registration are allowed ONLY on a rig validator
// (ZK_DEV_HOOKS=true), where they resolve to the oldest registered anchor — the rig's own; a production validator
// (armed, no dev hooks) refuses them.
const DEV_HOOKS = process.env.ZK_DEV_HOOKS === "true";
const STRICT = REQUIRE_SIG && !DEV_HOOKS;
// BROWSER KEYSTORE PASS Gate 4: a public deployment (production, no dev hooks) refuses to start with a must-not-ship
// variable set — names only, never values (validator/env-contract.js)
require("./env-contract").enforceBootContract(console);
const EMPTY_BODY_HASH = createHash("sha256").update("").digest("hex");
const UNSIGNED_REFUSED = "signed envelope required (x-layers-device/counter/sig)";

// ATTESTATION PASS Gate 0 — PORT PINNING + THE LIVENESS CONTRACT. The port
// comes from LAYERS_VALIDATOR_PORT (VALIDATOR_PORT is the older spelling),
// default 4001 — a CJS duplicate of lib/ports.ts. /health answers a SIGNED
// Totem-specific payload under the validator's persistent key; the sweep
// runner's probe (scripts/lib/health-probe.mjs) accepts only that and
// cross-checks the key against /zk/validator-key. Canonical form: a
// deliberate duplicate of lib/health.ts.
const HEALTH_DOMAIN = "layers-health/1";
const HEALTH_APP_NAME = "layers-validator";
function validatorPortFromEnv() {
  // BROWSER KEYSTORE PASS Gate 6: PORT is the deployment host's assignment; the pinned names still win where set
  const n = Number(process.env.LAYERS_VALIDATOR_PORT ?? process.env.VALIDATOR_PORT ?? process.env.PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 4001;
}
function healthCanonical(f) {
  return [HEALTH_DOMAIN, f.app, f.commit, f.buildId ?? "-", String(f.startedAt), String(f.uptime), String(f.port), String(f.pid), f.peer ?? "-"].join("|");
}
/** the commit HEAD names, read from .git directly; "unknown" outside a checkout */
function gitHead(root = path.join(__dirname, "..")) {
  // BROWSER KEYSTORE PASS Gate 6: a deployed image carries no .git, so the deploy names the commit it was built
  // from. Without it a deployed service reports "unknown" and nothing can say which code is live.
  if (process.env.LAYERS_COMMIT) return process.env.LAYERS_COMMIT;
  try {
    const fs = require("node:fs");
    const head = fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5).trim();
    const loose = path.join(root, ".git", ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim();
    const packed = path.join(root, ".git", "packed-refs");
    if (fs.existsSync(packed)) {
      const line = fs.readFileSync(packed, "utf8").split(/\r?\n/).find((l) => l.endsWith(" " + ref));
      if (line) return line.split(" ")[0];
    }
  } catch {
    /* not a checkout */
  }
  return "unknown";
}
const PROCESS_STARTED_AT = Date.now();
const PROCESS_COMMIT = gitHead();

function createApp(dbPath) {
  const db = openDb(dbPath);
  const app = express();
  // Local trusted service; allow the Next dev server.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // BROWSER KEYSTORE PASS Gate 1 stage 3: the device lives in a browser now and signs cross-origin — the envelope
    // headers and the state verbs are allowed; the policy itself is unchanged (a public API whose auth is the signature)
    // x-layers-device-proof: the Gate 5 proof-of-device-key header (a browser preflights it; unlisted, every move fails)
    // PERSONA LAUNCH P2 (BYX G5-lite): If-None-Match lets the browser device re-check the keyless X index without
    // downloading it again (a conditional GET is preflighted cross-origin); ETag is exposed for the same reason
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-layers-device,x-layers-counter,x-layers-sig,x-layers-anon,x-layers-device-proof,If-None-Match");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  // PUBLIC PREVIEW Gate 5 (D-CU-6-THE-KILL-SWITCH-IS-AN-ENVIRONMENT-FLAG): one variable pauses every route but
  // liveness, on a restart and without a rebuild.
  app.use((req, res, next) => {
    if (String(process.env.LAYERS_MAINTENANCE || "").trim().toLowerCase() !== "true" || req.path === "/health") return next();
    res.setHeader("Retry-After", "300");
    res.status(503).json({ error: "maintenance", retryAfterSeconds: 300 });
  });
  // ZK PASS 1 Gate 1: the ANONYMOUS channel is mounted BEFORE the JSON
  // body parser — a malformed body must reach the endpoint and get the
  // same constant-shape response as everything else, never express's
  // default 400 HTML page. See validator/anon.js.
  // BROWSER KEYSTORE PASS Gate 4 — rate limiting on every route (the previous pass assumed it; it did not exist).
  // A token bucket per client address in this process's memory: 300 of burst, refilled at 5 per second, 429 with
  // Retry-After beyond that. The rig (ZK_DEV_HOOKS=true) is exempt; /health is never throttled (liveness).
  // Per-instance by design (A-CU-4-RATE-LIMIT-PER-INSTANCE).
  // FC-READ (lead fix) — a LOCAL-ONLY override, for the production-shaped test pair (scripts/run-prod-shape.sh): every
  // browser context of every local suite reaches this process from ONE loopback address, so one bucket stands in for
  // what a deployment gives each visitor separately, and a suite that boots a few dozen devices (a boot is ~49 calls)
  // drains it and fails on 429s the product would never meet. VALIDATOR_RL_CAPACITY / VALIDATOR_RL_REFILL_PER_SECOND
  // raise it there. They are IGNORED on a hosting platform (env-contract.js isHostedPlatform, the same detection the
  // owner-service guard uses): a deployment always runs the defaults below, whatever its variables say. Unset, empty
  // or malformed → the default. accept-cu4 measures the defaults on a throwaway validator that carries neither name.
  const { isHostedPlatform } = require("./env-contract");
  const rlOverride = (name, dflt) => {
    const raw = String(process.env[name] ?? "").trim();
    if (!raw) return dflt;
    if (isHostedPlatform()) {
      console.warn("[validator] " + name + " is IGNORED on a hosted platform (local test pair only) — the default " + dflt + " stands");
      return dflt;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const RL_CAPACITY = rlOverride("VALIDATOR_RL_CAPACITY", 300);
  const RL_REFILL_PER_SECOND = rlOverride("VALIDATOR_RL_REFILL_PER_SECOND", 5);
  if (RL_CAPACITY !== 300 || RL_REFILL_PER_SECOND !== 5) {
    console.warn("[validator] LOCAL rate-limit override: " + RL_CAPACITY + " burst, " + RL_REFILL_PER_SECOND + "/s refill per address (defaults 300, 5/s) — a test pair, never a deployment");
  }
  const rlBuckets = new Map();
  const { edgeClientAddress } = require("./caps");
  let rlSweptAt = Date.now();
  app.use((req, res, next) => {
    if (DEV_HOOKS || req.path === "/health" || req.method === "OPTIONS") return next();
    const now = Date.now();
    if (now - rlSweptAt > 60_000) {
      for (const [k, b] of rlBuckets) if (now - b.at > 120_000) rlBuckets.delete(k);
      rlSweptAt = now;
    }
    // attack-custody-3 #6: a forwarding header is honoured only behind a configured proxy (TRUST_PROXY=true).
    // PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS): and then only the hop the edge vouches for (X-Real-IP, else the
    // RIGHT-most X-Forwarded-For entry), never the client-written left-most entry — validator/caps.js edgeClientAddress
    const key = edgeClientAddress(req, process.env.TRUST_PROXY === "true");
    const b = rlBuckets.get(key) || { tokens: RL_CAPACITY, at: now };
    b.tokens = Math.min(RL_CAPACITY, b.tokens + ((now - b.at) / 1000) * RL_REFILL_PER_SECOND);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      rlBuckets.set(key, b);
      return next();
    }
    rlBuckets.set(key, b);
    const retry = Math.max(1, Math.ceil((1 - b.tokens) / RL_REFILL_PER_SECOND));
    res.setHeader("Retry-After", String(retry));
    res.status(429).json({ error: "rate limited", retryAfterSeconds: retry });
  });
  // PERSONA LAUNCH P6 — THE RIG'S REQUEST LOG (accept-launch: "nothing naming the persona, its custody address or its
  // handle reached the validator before the confirm"). In memory, the last 2000 requests: method, path, whether a device
  // envelope rode it, and (filled in after the JSON parser) the parsed body — never a reveal's body (its secrets: only
  // its key names are kept), never the anonymous channel's (it is consumed before the parser and recorded as a path).
  // ON ONLY ON A LAPTOP RIG: dev hooks AND not a hosting platform — the owner service runs the rig shape on Railway and
  // never keeps it. Read at GET /dev/request-log?since=<ms>. Nothing is printed.
  const REQUEST_LOG = DEV_HOOKS && !isHostedPlatform();
  const requestLog = [];
  if (REQUEST_LOG) {
    app.use((req, res, next) => {
      const entry = { at: Date.now(), method: req.method, url: req.originalUrl || req.url, device: !!req.headers["x-layers-device"], body: null };
      req.layersLogEntry = entry;
      requestLog.push(entry);
      if (requestLog.length > 2000) requestLog.shift();
      next();
    });
  }
  const { mountAnon } = require("./anon");
  mountAnon(app, db);
  // PERSONA LAUNCH P2 (BYX G1): a DELIBERATE body limit (validator/limits.js; the app's persist client carries the same
  // constant and refuses to send more), and a refusal in JSON that names it — express's default was 100 KB with an HTML
  // 413 the client dropped without a word ("Large saves vanish without a word").
  const { STATE_BODY_LIMIT_BYTES, bodyLimitErrorHandler } = require("./limits");
  app.use(express.json({ limit: STATE_BODY_LIMIT_BYTES }));
  app.use(bodyLimitErrorHandler);
  if (REQUEST_LOG) {
    app.use((req, res, next) => {
      const e = req.layersLogEntry;
      if (e && req.body && typeof req.body === "object" && Object.keys(req.body).length) {
        // a reveal carries secrets: its key names only; SIGN IN WITH X: so does a sign-in (a code and a PKCE verifier);
        // everything else as parsed, bounded
        e.body = req.path === "/zk/anon/reveal" || req.path === "/x/signin/exchange" ? JSON.stringify(Object.keys(req.body)) : JSON.stringify(req.body).slice(0, 16_384);
      }
      next();
    });
    app.get("/dev/request-log", (req, res) => {
      const since = Number(req.query.since || 0);
      res.json({ entries: requestLog.filter((e) => e.at >= since && e.url.indexOf("/dev/request-log") !== 0) });
    });
  }
  // PUBLIC PREVIEW Gate 5 (D-CU-6-CAPS-ARE-LOUD-AND-COUNTED-WHERE-THE-STATE-IS): in the browser topology a
  // stranger's cost lands on the validator, so the per-address and per-device caps live here. Mounted after the
  // body parser (the write cap reads the envelope's device header) and before the routes it bounds.
  const { mountCaps } = require("./caps");
  mountCaps(app, { devHooks: DEV_HOOKS, trustProxy: process.env.TRUST_PROXY === "true" });
  // POST AS YOU: Totem's app account signs a visitor's key request (FC_APP_FID + FC_APP_CUSTODY_KEY, this validator only),
  // creates it with Farcaster's API, and relays the visitor's already-signed messages to a Snapchain node
  // (validator/keyrequest.js). No new request header (the message rides an octet-stream body), so CORS is unchanged.
  require("./keyrequest").mountKeyRequest(app, { devHooks: DEV_HOOKS, trustProxy: process.env.TRUST_PROXY === "true" });
  // SIGN IN WITH X: the thin stateless relay a visitor's tab redeems its X sign-in code through (X answers no browser CORS),
  // armed by X_CLIENT_ID (+ X_CLIENT_SECRET for a confidential X app) on this validator only (validator/xsignin.js). JSON
  // body, Content-Type only, so CORS is unchanged.
  require("./xsignin").mountXSignin(app, { devHooks: DEV_HOOKS, trustProxy: process.env.TRUST_PROXY === "true" });
  // PERSONA LAUNCH P4 (rings' mount line, applied by launch — the server.js owner): the ring dead drop. No new request
  // header (delete tokens ride the signed body); one ever added must join the CORS Allow-Headers list above.
  const { mountRingDrop } = require("./ringdrop");
  mountRingDrop(app, db, { checkEnvelope, devHooks: DEV_HOOKS });
  // MEGA PASS 2 Gate 1: per-persona stake events (public, signed by the persona's key) — validator/stakes.js
  const { mountStakes } = require("./stakes");
  mountStakes(app, db);
  const { mountCustody, mountLinkRelay, mountRootLinkRelay } = require("./custody");
  mountCustody(app, db, { checkEnvelope, UNSIGNED_REFUSED });
  mountLinkRelay(app, db, { checkEnvelope, UNSIGNED_REFUSED });
  mountRootLinkRelay(app, db, { checkEnvelope, UNSIGNED_REFUSED });

  // ZK PASS 2 Gate 2: no rootId on the wire — the column is gone (006)
  const personaRow = (p) =>
    p && {
      id: p.id,
      name: p.name,
      handle: p.handle,
      avatarUrl: p.avatar_url,
      bio: p.bio,
      createdAt: p.created_at,
    };

  app.get("/health", (req, res) => {
    const personas = db.prepare("SELECT COUNT(*) AS n FROM personas").get().n;
    const roots = db.prepare("SELECT COUNT(*) AS n FROM roots").get().n;
    // the signed liveness contract (Attestation pass Gate 0)
    const { validatorKey } = require("./zk");
    const fields = {
      app: HEALTH_APP_NAME,
      commit: PROCESS_COMMIT,
      buildId: null,
      startedAt: PROCESS_STARTED_AT,
      uptime: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
      port: validatorPortFromEnv(),
      pid: process.pid,
      // the validator has no peer to name; the APP names the validator it talks to
      peer: "-",
    };
    const key = validatorKey(db);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...fields, personas, roots, pubkey: key.pubHex, sig: key.signHex(healthCanonical(fields)) });
  });

  app.post("/roots", (req, res) => {
    const { fid, signerUuid } = req.body || {};
    if (!Number.isInteger(fid) || typeof signerUuid !== "string" || !signerUuid)
      return res.status(400).json({ error: "fid (int) and signerUuid (string) required" });
    let anchor = null;
    if (REQUIRE_SIG && req.header("x-layers-device")) {
      const bad = checkEnvelope(req, "roots", createHash("sha256").update(JSON.stringify(req.body)).digest("hex"));
      if (bad) return res.status(bad.status).json({ error: bad.error });
      anchor = req.layersAnchor;
    } else if (STRICT) {
      return res.status(401).json({ error: UNSIGNED_REFUSED });
    }
    // attack-custody-1 #13: a device root's negative fid is computed HERE from the envelope's anchor (the same
    // derivation the device uses), so it is bound to the caller; an unsigned request cannot name one at all
    let boundFid = fid;
    if (fid < 0) {
      if (!anchor) return res.status(401).json({ error: "a device root needs the signed envelope" });
      boundFid = -((parseInt(anchor.slice(0, 8), 16) % 2147483646) + 1);
      if (boundFid !== fid) return res.status(403).json({ error: "the fid does not belong to this anchor" });
    }
    const existing = db.prepare("SELECT id, anchor FROM roots WHERE signer_uuid = ?").get(signerUuid);
    if (existing) {
      if (anchor && existing.anchor && existing.anchor !== anchor)
        return res.status(403).json({ error: "root belongs to another device-auth anchor" });
      if (anchor && !existing.anchor) db.prepare("UPDATE roots SET anchor = ? WHERE id = ?").run(anchor, existing.id);
      return res.status(200).json({ rootId: existing.id });
    }
    const byFid = db.prepare("SELECT id FROM roots WHERE fid = ?").get(fid);
    if (byFid) return res.status(409).json({ error: "fid already registered to another signer" });
    const id = uid("root");
    db.prepare("INSERT INTO roots (id, fid, signer_uuid, created_at, anchor) VALUES (?, ?, ?, ?, ?)").run(
      id,
      fid,
      signerUuid,
      Date.now(),
      anchor
    );
    res.status(201).json({ rootId: id });
  });

  // ZK PASS 2 Gate 2: a persona is created WITHOUT a root. The validator
  // learns that a persona exists; which account made it is the device's
  // knowledge (its roster). A rootId in the body is refused, not ignored.
  app.post("/personas", (req, res) => {
    const { rootId, name, handle, avatarUrl = null, bio = null } = req.body || {};
    if (rootId !== undefined) return res.status(400).json({ error: "persona creation takes no rootId (the validator does not hold persona → root; migration 006)" });
    if (!name || !handle) return res.status(400).json({ error: "name, handle required" });
    if (!HANDLE_RE.test(handle))
      return res.status(400).json({ error: "handle must match ^[A-Za-z0-9_]{1,15}$" });
    if (db.prepare("SELECT id FROM personas WHERE handle = ?").get(handle))
      return res.status(409).json({ error: "handle taken" });
    const id = uid("persona");
    // ZK PASS 2 Gate 4 (attack-z2-1 #2): hour-grain — a persona row must not pair with a device's flush by the millisecond
    db.prepare("INSERT INTO personas (id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, handle, avatarUrl, bio, hourGrain(Date.now()));
    res.status(201).json({ persona: personaRow(db.prepare("SELECT * FROM personas WHERE id = ?").get(id)) });
  });

  // /personas/root/:rootId and /personas/by-fid/:fid are GONE (006): the
  // validator has no table that groups personas by root or by account.
  app.get("/personas/root/:rootId", (req, res) => res.status(410).json({ error: "gone: the validator does not hold persona → root (migration 006)" }));
  app.get("/personas/by-fid/:fid", (req, res) => res.status(410).json({ error: "gone: the validator does not hold persona → account (migration 006)" }));

  app.get("/personas/:personaId", (req, res) => {
    const row = db.prepare("SELECT * FROM personas WHERE id = ?").get(req.params.personaId);
    if (!row) return res.status(404).json({ error: "unknown persona" });
    res.json({ persona: personaRow(row) });
  });

  app.get("/rep/root/:rootId/tier", (req, res) => {
    const root = db.prepare("SELECT id FROM roots WHERE id = ?").get(req.params.rootId);
    if (!root) return res.status(404).json({ error: "unknown root" });
    res.json({ tier: tierForRoot(db, root.id) });
  });

  // /rep/:personaId is GONE (006): tier by persona needed the root join.
  // Reputation is asked by ROOT handle (the account's own) or PROVEN (zk).
  app.get("/rep/:personaId", (req, res) => res.status(410).json({ error: "gone: tier by persona needed persona → root (migration 006); ask by root handle or prove it" }));

  app.post("/events", (req, res) => {
    // attack-custody-1 #11: a count is a small positive integer, never a rep-shaped number
    if (req.body && req.body.count !== undefined && (!Number.isInteger(req.body.count) || req.body.count < 1 || req.body.count > 100))
      return res.status(400).json({ error: "count must be an integer in [1, 100]" });
    const { rootId, type, count = 1, sourceId = null } = req.body || {};
    const VALID = [
      "cast_created",
      "like_received",
      "recast_received",
      "reply_received",
      "follow_gained",
      // MEGA PASS 2 Gate 1: the reputation UBI's accrual (validator/rep.js WEIGHTS.stewardship)
      "stewardship",
    ];
    if (!rootId || !VALID.includes(type))
      return res.status(400).json({ error: "rootId and valid type required" });
    const root = db.prepare("SELECT id, anchor FROM roots WHERE id = ?").get(rootId);
    if (!root) return res.status(404).json({ error: "unknown root" });
    // readiness finding 3 + D-CU-0-5: a rep event is the root's own device speaking, never an anonymous POST
    if (REQUIRE_SIG && req.header("x-layers-device")) {
      const bad = checkEnvelope(req, "events", createHash("sha256").update(JSON.stringify(req.body)).digest("hex"));
      if (bad) return res.status(bad.status).json({ error: bad.error });
      if (root.anchor && root.anchor !== req.layersAnchor)
        return res.status(403).json({ error: "root belongs to another device-auth anchor" });
      if (!root.anchor) db.prepare("UPDATE roots SET anchor = ? WHERE id = ?").run(req.layersAnchor, rootId);
    } else if (STRICT) {
      return res.status(401).json({ error: UNSIGNED_REFUSED });
    }
    try {
      db.prepare(
        "INSERT INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(rootId, type, count, sourceId, hourGrain(Date.now())); // attack-mega-1 F1: rep events carry the hour, like every other root-adjacent row
    } catch (e) {
      if (!String(e.message).includes("UNIQUE")) throw e; // dedupe on sourceId: no-op
    }
    res.status(201).json({ ok: true, score: scoreForRoot(db, rootId) });
  });

  // ZK PASS 2 Gate 2: blocks are PERSONA-LEVEL. Root-level fan-out ("block
  // one, block all their personas") needed persona → root; it is gone by
  // design and named in SECURITY-POSTURE.md ("What zk cost us"). The device
  // may fan out over ITS OWN personas (it knows them); it cannot reach a
  // blocked root's other personas, and the validator must not fake it.
  app.post("/block", (req, res) => {
    const { blockerPersona, blockedPersona } = req.body || {};
    const blocker = db.prepare("SELECT id FROM personas WHERE id = ?").get(blockerPersona);
    if (!blocker) return res.status(404).json({ error: "unknown persona" });
    // MULTI-FID Gate 3: the BLOCKED id is opaque. A persona this client minted (a fork) registers
    // nowhere on the validator, and a block is a read-time filter over ids in the blocker's own
    // client — never a fact about the target, never a network write (D-FID-3-BLOCK-TARGET-OPAQUE).
    if (typeof blockedPersona !== "string" || !/^[A-Za-z0-9_]{1,80}$/.test(blockedPersona)) return res.status(400).json({ error: "blockedPersona malformed" });
    db.prepare("INSERT INTO blocks_v2 (blocker_persona, blocked_persona, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(blocker.id, blockedPersona, hourGrain(Date.now()));
    res.status(201).json({ ok: true, fanout: "persona-level only" });
  });

  app.get("/blocked/:personaId", (req, res) => {
    const p = db.prepare("SELECT id FROM personas WHERE id = ?").get(req.params.personaId);
    if (!p) return res.status(404).json({ error: "unknown persona" });
    const rows = db.prepare("SELECT blocked_persona FROM blocks_v2 WHERE blocker_persona = ? ORDER BY created_at").all(p.id);
    res.json({ personaIds: rows.map((r) => r.blocked_persona), fanout: "persona-level only" });
  });

  // ---------- device auth (migration 003, crypto pass) ----------
  // The validator holds PUBLIC material only: one device-auth anchor,
  // device delegations, envelope counters. Trust chain for a write:
  // anchor pubkey → delegation cert → device envelope signature.

  // First-write-wins anchor registration (TOFU, stated honestly in the
  // threat model): re-registering the SAME key is idempotent; a
  // different key is refused — the anchor never silently rotates.
  app.post("/device/auth-anchor", (req, res) => {
    const { pubkey } = req.body || {};
    if (!/^[0-9a-f]{64}$/.test(pubkey || ""))
      return res.status(400).json({ error: "pubkey (32-byte hex) required" });
    // First-write-wins is decided BEFORE key validity: once an anchor is
    // pinned, ANY other 32-byte value is a conflict (409) — the c0 contract
    // ("the anchor never rotates silently") holds for garbage keys too.
    // BROWSER KEYSTORE PASS Gate 1 stage 2: an anchor IS a root's device-auth public key. Registering it proves
    // nothing — only a delegation signed by its private key can use it — so a stranger's anchor is their own root,
    // never a conflict with ours. Re-registering the same key is idempotent.
    const existing = db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(pubkey);
    if (existing) return res.json({ ok: true, existing: true });
    // recovery probes a candidate phrase's anchor: answer whether it exists, never create it (a wrong phrase would
    // otherwise leave a junk anchor row behind for every guess)
    if (req.body && req.body.existingOnly === true)
      return res.status(404).json({ error: "no identity is registered under that device-auth anchor" });
    // Attestation pass Gate 0: a small-order point is not a key (crypto.js)
    if (!isUsablePubkey(pubkey)) return res.status(400).json({ error: "pubkey is not a usable Ed25519 key (small-order or outside the prime-order subgroup)" });
    db.prepare("INSERT INTO device_auth (pubkey, registered_at) VALUES (?, ?)").run(pubkey, Date.now());
    res.status(201).json({ ok: true });
  });

  // Register a device by its delegation cert. The cert must verify
  // against the anchor BEFORE anything is stored — an unverifiable
  // delegation is not "pending", it is refused.
  app.post("/device/register", (req, res) => {
    const { delegation, anchorPubKey } = req.body || {};
    if (!delegation || typeof delegation !== "object")
      return res.status(400).json({ error: "delegation object required" });
    // BROWSER KEYSTORE PASS Gate 5 (attack-custody-2 #24): the device names its anchor — the app always does — and the
    // scan of every registered anchor (an O(anchors) Ed25519 amplifier per unauthenticated request) is gone.
    if (typeof anchorPubKey !== "string" || !/^[0-9a-f]{64}$/.test(anchorPubKey))
      return res.status(400).json({ error: "anchorPubKey (32-byte hex) required: the delegation names the anchor it was issued under" });
    const anchor = db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(anchorPubKey) || null;
    if (!anchor) {
      const any = db.prepare("SELECT COUNT(*) AS n FROM device_auth").get().n;
      if (any === 0) return res.status(409).json({ error: "no device-auth anchor registered" });
      return res.status(403).json({ error: "delegation does not verify against the anchor" });
    }
    if (delegation.expiresAt !== null && delegation.expiresAt !== undefined && delegation.expiresAt <= Date.now())
      return res.status(403).json({ error: "delegation expired" });
    if (!verifyEd25519(delegation.signature, delegationCanonical(delegation), anchor.pubkey))
      return res.status(403).json({ error: "delegation does not verify against the anchor" });
    const prior = db.prepare("SELECT revoked_at, anchor, pubkey FROM devices WHERE device_id = ?").get(delegation.deviceId);
    if (prior && prior.revoked_at)
      // Revocation is permanent for a device id: re-registering a
      // revoked device with a fresh delegation would make revocation a
      // suggestion. A genuinely re-authorized device gets a NEW id.
      return res.status(403).json({ error: "device id is revoked; a re-authorized device must use a new id" });
    // A device id is the device's OWN random value and the delegation must verify against the named anchor, so a
    // re-registration under a different anchor is the device moving (device loss then recovery re-anchors the same
    // device.json). What is refused is a HIJACK: a different key claiming a known id under a different anchor.
    if (prior && prior.anchor && prior.anchor !== anchor.pubkey && prior.pubkey !== delegation.devicePubKey)
      return res.status(403).json({ error: "device id is registered to another key under another device-auth anchor" });
    // attack-custody-1 #2: a public key is not proof of possession. A device MOVES between anchors only when the
    // request carries a signature by the device key itself (x-layers-device-proof) — recovery and device linking
    // have that key; a stranger who learned a (deviceId, devicePubKey) pair does not.
    if (prior && prior.anchor && prior.anchor !== anchor.pubkey) {
      const { deviceProofOk } = require("./custody");
      if (!deviceProofOk(req, prior.pubkey)) return res.status(403).json({ error: "moving a device between anchors needs proof of the device key (x-layers-device-proof)" });
    }
    db.prepare(
      "INSERT INTO devices (device_id, pubkey, delegation, registered_at, revoked_at, anchor) VALUES (?, ?, ?, ?, NULL, ?) " +
        "ON CONFLICT(device_id) DO UPDATE SET pubkey = excluded.pubkey, delegation = excluded.delegation, anchor = excluded.anchor"
    ).run(delegation.deviceId, delegation.devicePubKey, JSON.stringify(delegation), Date.now(), anchor.pubkey);
    res.status(201).json({ ok: true });
  });

  // Revoke: signed by the device-auth key, timestamped (a stale
  // revocation replay is a no-op — the device is already revoked).
  // Forward-looking only; what the device already wrote stands.
  app.post("/device/revoke", (req, res) => {
    const { deviceId, issuedAt, signature } = req.body || {};
    if (!deviceId || !Number.isFinite(issuedAt) || typeof signature !== "string")
      return res.status(400).json({ error: "deviceId, issuedAt, signature required" });
    const row = db.prepare("SELECT device_id, anchor FROM devices WHERE device_id = ?").get(deviceId);
    if (!row) return res.status(404).json({ error: "unknown device" });
    const anchor = row.anchor ? db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(row.anchor) : null;
    if (!anchor) return res.status(409).json({ error: "no device-auth anchor registered" });
    if (!verifyEd25519(signature, revokeCanonical(deviceId, issuedAt), anchor.pubkey))
      return res.status(403).json({ error: "revocation does not verify against the anchor" });
    db.prepare("UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?").run(
      Date.now(),
      deviceId
    );
    res.json({ ok: true });
  });

  // Device management surface (public material only — ids, pubkeys,
  // status). The UI's device list reads this.
  app.get("/device/list", (req, res) => {
    if (REQUIRE_SIG && req.header("x-layers-device")) {
      const bad = checkEnvelope(req, "devices", EMPTY_BODY_HASH);
      if (bad) return res.status(bad.status).json({ error: bad.error });
    } else if (STRICT) return res.status(401).json({ error: UNSIGNED_REFUSED });
    const rows = db
      .prepare("SELECT device_id, pubkey, registered_at, revoked_at FROM devices WHERE anchor = ? ORDER BY registered_at")
      .all(anchorOf(req, db));
    res.json({
      devices: rows.map((r) => ({
        deviceId: r.device_id,
        pubkey: r.pubkey,
        registeredAt: r.registered_at,
        revokedAt: r.revoked_at,
      })),
    });
  });

  /**
   * THE ENVELOPE CHECK for state writes. Verifies, in order: device is
   * registered and not revoked; its delegation still verifies against
   * the anchor (a swapped anchor invalidates everything downstream);
   * the envelope signature covers namespace|bodyHash|counter; the
   * counter is strictly greater than the last accepted one for
   * (device, namespace) — replays and reorders are refused, which is
   * what "the validator owns ordering" actually means.
   * Returns null if accepted, else {status, error}.
   */
  function checkEnvelope(req, ns, bodyHashHex) {
    const deviceId = req.header("x-layers-device");
    const counter = Number(req.header("x-layers-counter"));
    const sig = req.header("x-layers-sig");
    if (!deviceId || !Number.isFinite(counter) || !sig)
      return { status: 401, error: "signed envelope required (x-layers-device/counter/sig)" };
    const dev = db.prepare("SELECT pubkey, delegation, revoked_at, anchor FROM devices WHERE device_id = ?").get(deviceId);
    if (!dev) return { status: 401, error: "unknown device" };
    if (dev.revoked_at) return { status: 403, error: "device revoked" };
    const anchor = dev.anchor ? db.prepare("SELECT pubkey FROM device_auth WHERE pubkey = ?").get(dev.anchor) : null;
    if (!anchor) return { status: 409, error: "no device-auth anchor registered" };
    let delegation;
    try {
      delegation = JSON.parse(dev.delegation);
    } catch {
      return { status: 500, error: "stored delegation unreadable" };
    }
    if (!verifyEd25519(delegation.signature, delegationCanonical(delegation), anchor.pubkey))
      return { status: 403, error: "stored delegation no longer verifies against the anchor" };
    if (delegation.expiresAt !== null && delegation.expiresAt !== undefined && delegation.expiresAt <= Date.now())
      return { status: 403, error: "delegation expired" };
    if (!verifyEd25519(sig, envelopeCanonical(ns, bodyHashHex, counter), dev.pubkey))
      return { status: 401, error: "envelope signature does not verify" };
    const prev = db
      .prepare("SELECT counter FROM envelope_counters WHERE device_id = ? AND namespace = ?")
      .get(deviceId, ns);
    if (prev && counter <= prev.counter)
      return { status: 409, error: `stale counter (last accepted ${prev.counter})` };
    db.prepare(
      "INSERT INTO envelope_counters (device_id, namespace, counter) VALUES (?, ?, ?) " +
        "ON CONFLICT(device_id, namespace) DO UPDATE SET counter = excluded.counter"
    ).run(deviceId, ns, counter);
    req.layersAnchor = dev.anchor;
    return null;
  }

  // ---------- adapter state (migration 002) ----------
  // Durable storage for adapter state that has no real backend yet. The
  // adapter owns the document shape; the validator owns durability. This is
  // what makes modes/rules/grants/channels/graph/market survive a restart.

  app.get("/state", (req, res) => {
    if (REQUIRE_SIG && req.header("x-layers-device")) {
      const bad = checkEnvelope(req, "*", EMPTY_BODY_HASH);
      if (bad) return res.status(bad.status).json({ error: bad.error });
    } else if (STRICT) return res.status(401).json({ error: UNSIGNED_REFUSED });
    const rows = db.prepare("SELECT namespace, key, value FROM adapter_state WHERE anchor = ?").all(anchorOf(req, db));
    const out = {};
    for (const r of rows) {
      (out[r.namespace] ??= {})[r.key] = JSON.parse(r.value);
    }
    res.json({ state: out });
  });

  app.get("/state/:namespace", (req, res) => {
    if (REQUIRE_SIG && req.header("x-layers-device")) {
      const bad = checkEnvelope(req, req.params.namespace, EMPTY_BODY_HASH);
      if (bad) return res.status(bad.status).json({ error: bad.error });
    } else if (STRICT) return res.status(401).json({ error: UNSIGNED_REFUSED });
    const rows = db
      .prepare("SELECT key, value FROM adapter_state WHERE anchor = ? AND namespace = ?")
      .all(anchorOf(req, db), req.params.namespace);
    const entries = {};
    for (const r of rows) entries[r.key] = JSON.parse(r.value);
    res.json({ entries });
  });

  // Replace a whole namespace atomically — the client holds the authoritative
  // in-memory copy and flushes it after each mutation.
  app.put("/state/:namespace", (req, res) => {
    const { entries } = req.body || {};
    if (!entries || typeof entries !== "object")
      return res.status(400).json({ error: "entries object required" });
    const ns = req.params.namespace;
    if (REQUIRE_SIG) {
      // Body hash covers the entries document. Both sides hash
      // JSON.stringify(entries) — string-keyed insertion order survives
      // a parse/stringify round trip, which is what makes the recompute
      // byte-stable here.
      const bodyHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
      const bad = checkEnvelope(req, ns, bodyHash);
      if (bad) return res.status(bad.status).json({ error: bad.error });
    }
    const anchor = anchorOf(req, db);
    const now = hourGrain(Date.now()); // Gate 4: state rows carry the hour, not the millisecond
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM adapter_state WHERE anchor = ? AND namespace = ?").run(anchor, ns);
      const ins = db.prepare(
        "INSERT INTO adapter_state (anchor, namespace, key, value, updated_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const [key, value] of Object.entries(entries)) {
        ins.run(anchor, ns, key, JSON.stringify(value), now);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: e.message });
    }
    res.json({ ok: true, count: Object.keys(entries).length });
  });

  // Wipe all adapter state (`npm run seed --wipe`, dev reset). Under
  // REQUIRE_SIG this is the most destructive call on the surface, so it
  // takes the same envelope (namespace "*", empty-body hash).
  app.delete("/state", (req, res) => {
    if (REQUIRE_SIG) {
      const bodyHash = createHash("sha256").update("").digest("hex");
      const bad = checkEnvelope(req, "*", bodyHash);
      if (bad) return res.status(bad.status).json({ error: bad.error });
    }
    db.prepare("DELETE FROM adapter_state WHERE anchor = ?").run(anchorOf(req, db));
    // attack-custody-2 #8: the shared fixture rows (anon casts, stakes) reset ONLY on the rig, where DELETE /state is
    // the seed reset; on a public deployment a visitor wipes their own namespaces and nothing else
    if (!DEV_HOOKS) return res.json({ ok: true });
    // PERSONA LAUNCH wave 3 (W3-BLOCKS-WIPE-OWNER): ZK_DEV_HOOKS alone does not make this the rig. The OWNER service's
    // validator runs with dev hooks ON (railway/Dockerfile.owner-validator) and LAYERS_WORLD=empty, and its rows are the
    // owner's own — persona blocks, the test-universe posts, launches and X copies they tried. The app refuses the seed
    // reset under the empty world (lib/adapters/mock/store.ts resetState), but that guard lives in the APP: any other
    // signed DELETE /state reaching this validator (a maintenance script, a new wipeAll caller, a regression of the app's
    // guard) hard-deleted every one of them, which breaks "hide, never delete". So the seed-reset branch below runs only
    // where LAYERS_WORLD is UNSET (the demo world, the rig's) — any value at all (the empty world; a blank one, which the
    // boot already refuses) keeps it off: the caller's own namespaces above are all a reset wipes there.
    if (process.env.LAYERS_WORLD !== undefined) return res.json({ ok: true });
    // MULTI-FID /verify (closing series 3, a3 #1): the seed baseline has no anon casts. A FIXTURE anon cast relayed by an
    // earlier suite in the same server session carried a wall-clock (hour-grained) time later than the seed's boot-relative
    // clock, surfaced in the feed after a seed reset, and moved the caught-up banner's newest-post cutoff. The fixture
    // rows reset with the seed; LIVE rows are real relays and stay.
    try {
      db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
      // MEGA PASS 2 Gate 1: fixture stake rows are seed state too (the app re-seeds them after the wipe)
      db.prepare("DELETE FROM stakes WHERE mode = 'fixture'").run();
      // PERSONA LAUNCH P6: the simulated registrar's fixture rows (queue, sim chain, $0 ledger, sim clock, reveal
      // batches) are seed state too — a launch from an earlier suite must not survive the seed reset
      require("./registrar").resetFixture(db, "fixture");
      // PERSONA LAUNCH P8: the X outbox's fixture rows (the queue, the signed decisions, the rig's dev moderators, the
      // fixture transport's posts) are seed state too — an X copy from an earlier suite must not survive the seed reset
      require("./xoutbox").resetFixture(db, "fixture");
    } catch {
      /* before migration 10 the table does not exist */
    }
    // PERSONA LAUNCH wave 3 (verify, rig drift): persona-level blocks are seed state on the rig too. They were never reset,
    // so every block a suite made survived every seed reset — accept-z9 deliberately blocks a NEW fixture persona as the
    // seeded self on every run — and by the wave-3 build sweep (2026-10-13) the seeded self had blocked the authors of all
    // 15 fixture casts: its For You and Following pages came back empty with a next page every time, the timeline paged
    // forever, and every suite that loads /home with networkidle timed out. The seed baseline has no blocks (seed.js
    // writes none), so the rig's seed reset clears them. Never on a public deployment or the owner service: this branch
    // runs only under ZK_DEV_HOOKS AND with LAYERS_WORLD unset (both returned above otherwise — the owner validator has
    // dev hooks on, so the world check is the one that keeps its blocks; the app's own empty-world refusal is a second,
    // independent guard, not this one).
    try {
      db.prepare("DELETE FROM blocks_v2").run();
    } catch {
      /* before migration 006 the table does not exist */
    }
    res.json({ ok: true });
  });

  app.get("/schema", (req, res) => {
    const rows = db.prepare("SELECT version, name, applied_at FROM schema_version ORDER BY version").all();
    res.json({ migrations: rows });
  });

  // ZK PASS 1: the public zk surface (trees, epochs, signed placements and
  // root history, registration). Additive HTTP, same env-gated contract-
  // amendment pattern as LAYERS_REQUIRE_SIG. See validator/zk.js.
  const { mountZk } = require("./zk");
  mountZk(app, db, { requireSig: REQUIRE_SIG, checkEnvelope });
  // PUBLIC GO-LIVE (the relay track): the public @anon relay's safety — reports, the moderators' takedown queue (signed),
  // the one-cast read, the fid gate's join, the public status, and the bounded Farcaster delete loop (validator/anonpublic.js).
  // No new request header (signatures ride the JSON body or the query), so the CORS Allow-Headers list is unchanged.
  require("./anonpublic").mountAnonPublic(app, db, { devHooks: DEV_HOOKS });

  // PERSONA LAUNCH P6: the SIMULATED chain (validator/simchain.js: IdRegistry/KeyRegistry/StorageRegistry/fname reads,
  // the simulated fname server) and the SIMULATED Totem registrar (validator/registrar.js: the batch loop on its own sim
  // clock, the public registrations read every device's tick makes, the reveal batches, dev hooks under ZK_DEV_HOOKS).
  // Fixture only — no live branch exists in either, nothing here opens a socket or spends.
  const registrar = require("./registrar");
  const { mountSimChain } = require("./simchain");
  mountSimChain(app, db);
  registrar.mountRegistrar(app, db, { devHooks: DEV_HOOKS });
  // PERSONA LAUNCH P8: the @totem X OUTBOX (validator/xoutbox.js) — FIXTURE ONLY: the moderation queue, the public list and
  // config every offering device reads on its tick, the moderator's signed decide/review, the relay loop through the
  // fixture transport, and the rig's dev hooks under ZK_DEV_HOOKS. No live transport exists; nothing here opens a socket.
  // No new request header (the moderation signature rides the JSON body), so CORS Allow-Headers is unchanged.
  require("./xoutbox").mountXOutbox(app, db, { devHooks: DEV_HOOKS });

  // PERSONA LAUNCH P2 (BYX G4): the keyless X → Farcaster index (validator/xindex.js). The routes are always mounted —
  // with the job off (the default) GET /x/fc-index answers 503 "index not built", never an empty index; the job starts
  // only with VALIDATOR_X_INDEX=on; the rig (dev hooks) also gets the loopback-only build route its suite drives.
  const { mountXIndex } = require("./xindex");
  mountXIndex(app, db, { devHooks: DEV_HOOKS, dbPath });

  return { app, db };
}

if (require.main === module) {
  const dbPath = process.env.VALIDATOR_DB || path.join(__dirname, "layers.db");
  const { app, db } = createApp(dbPath);
  const port = validatorPortFromEnv();
  app.listen(port, () =>
    console.log("[validator] listening on :" + port + " (db: " + dbPath + ")")
  );
  startPoller(db);
  // PUBLIC PREVIEW Gate 3: scheduled dumps of the volume's database (no directory configured = no schedule, which
  // is the rig). Restore: node scripts/validator-restore.mjs <backup.db>
  const { startBackups } = require("./backup");
  const backups = startBackups(db);
  if (backups) console.log("[validator] backups every " + Math.round(backups.everyMs / 60000) + " min into " + backups.dir + " (keeping " + backups.keep + ")");
  // PROCESS LIFECYCLE ONLY (no request data — the anon module's logging
  // discipline is untouched): a validator that dies must say how. Found
  // necessary when a sweep's validator vanished with an empty stderr.
  const stamp = () => new Date().toISOString();
  process.on("exit", (code) => process.stderr.write(`[validator] ${stamp()} exit code ${code}\n`));
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"]) {
    try {
      process.on(sig, () => {
        process.stderr.write(`[validator] ${stamp()} received ${sig}, exiting\n`);
        process.exit(128);
      });
    } catch {
      /* a signal this platform does not have */
    }
  }
  process.on("uncaughtException", (e) => {
    process.stderr.write(`[validator] ${stamp()} uncaughtException: ${e && e.stack ? e.stack : String(e)}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    process.stderr.write(`[validator] ${stamp()} unhandledRejection: ${e && e.stack ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}

module.exports = { createApp };
