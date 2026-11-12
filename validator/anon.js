"use strict";
// ZK PASS 1 Gate 1 — THE ANONYMOUS SUBMISSION CHANNEL (F1 / C4).
//
// A proof submitted over the device-envelope path is linked to a root by
// its signature before any circuit runs. This endpoint is the other
// channel: UNAUTHENTICATED — no envelope, no session, no cookies, no auth
// headers — and it REFUSES (fail closed) any request that carries an
// identifying header at all: the header set is an ALLOWLIST, not a
// blocklist. Rate limiting is STATELESS proof-of-work bound to the body
// bytes (hashcash-style): no per-root state, nothing that could re-link a
// root's submissions (C2 — RLN is banned here). Every outcome —
// accepted, replay, refused, malformed — returns the SAME body size and
// is held to the SAME timing floor, so "no proof" is indistinguishable
// from "not attempted" on the wire.
//
// OHTTP (RFC 9458): the validator is the GATEWAY. A relay the operator
// does NOT run forwards encapsulated requests; the gateway decapsulates
// (HPKE, X25519/HKDF-SHA256/AES-128-GCM), handles the inner Binary HTTP
// request exactly like the direct endpoint, and encapsulates the response
// under the exported response key. The relay sees ciphertext and the
// client's IP; the gateway sees plaintext and the relay's IP.
//
// LOGGING DISCIPLINE — this module logs NOTHING. No IPs, no timestamps
// finer than the epoch, no request ordering (the nullifier store is a
// WITHOUT ROWID table keyed on the nullifier, so even insertion order is
// not kept). The Gate 1 suite greps this file and the schema.
const express = require("express");
const { createHash, randomBytes, hkdfSync, createCipheriv, timingSafeEqual } = require("node:crypto");
const { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes128Gcm } = require("@hpke/core");
const bhttp = require("./bhttp");
const { verifyAndRecord, anonHead } = require("./zk");

const powBits = () => Math.max(0, Math.min(40, Number(process.env.ZK_POW_BITS || 16)));
const responseMs = () => Math.max(0, Number(process.env.ZK_ANON_RESPONSE_MS || 150));
const BODY_BYTES = 256; // constant-shape inner/direct body
const OUTER_BYTES = 16 + BODY_BYTES + 16; // response_nonce + ciphertext + tag
const MAX_BODY = 64 * 1024;

/** The ONLY headers a submission may carry. Everything else — cookie,
 * authorization, x-layers-*, x-forwarded-for, user-agent, referer, origin,
 * accept-language … — is identifying, and its presence is a refusal. */
const ALLOWED_HEADERS = new Set(["host", "content-type", "content-length", "transfer-encoding", "connection", "accept", "accept-encoding", "x-zk-pow"]);

function hasOnlyAllowedHeaders(headers) {
  for (const k of Object.keys(headers || {})) if (!ALLOWED_HEADERS.has(k.toLowerCase())) return false;
  return true;
}

// ---------- PERSONA LAUNCH P7: the BROWSER channel's header policy ----------
// Why a second policy: a browser cannot send the strict channel's exact header set. fetch() always adds a user-agent,
// an origin on a cross-origin POST, accept-language, the sec-fetch-* and (Chromium) sec-ch-ua* client hints, and with
// cache "no-store" a pragma/cache-control pair. Those are the SAME for every visitor of a given browser build (that is
// the residual A-WEB-CHANNEL-DIRECT-UA, said plainly in lib/zk/anon/README.md), so the web routes tolerate exactly
// them and nothing else. What a page script COULD add on purpose — a cookie, an authorization, any x-layers-* device
// header, a referer — stays a refusal here whatever else holds: those are the headers that name a person.
// Proxy hop headers are added by a hosting platform's edge, not by the browser: they are tolerated only when the
// operator declared the proxy (TRUST_PROXY=true, the same flag the rate limiter honours), otherwise their presence
// is a refusal like any unknown header. (A platform that adds a hop header not on this list refuses every web
// submission: fail closed, and the list grows by a reviewed edit.)
const WEB_BROWSER_HEADERS = new Set(["user-agent", "origin", "accept-language", "priority", "pragma", "cache-control", "dnt", "sec-gpc"]);
const WEB_BROWSER_PREFIXES = ["sec-ch-ua", "sec-fetch-"];
// PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS): + the "x-railway-" prefix. Railway's edge documents the headers it adds
// to every request (docs.railway.com/networking/public-networking/specs-and-limits, read 2026-10-17): X-Real-IP,
// X-Forwarded-Proto, X-Forwarded-Host, X-Request-Start, X-Railway-Edge and X-Railway-Request-Id (and, in practice,
// X-Forwarded-For). Without the prefix the two x-railway-* names refused EVERY browser submission on the public validator.
// Still only under TRUST_PROXY=true; still never logged and never echoed (this module logs nothing and answers a constant
// shape); cookie / authorization / proxy-authorization / referer / x-layers-* stay refused whatever else holds. No cf-*:
// Railway documents none. validator/test/fixtures/railway-hop-headers.json is that documented set (documented, not
// recorded); validator/test/anonweb.test.js replays it, and scripts/smoke-deployed.mjs check 10 re-checks the real edge
// on every deploy (an undocumented header the edge adds would refuse every web submission — fail closed — and check 10
// says so).
const WEB_PROXY_HEADERS = new Set(["x-real-ip", "forwarded", "via", "x-request-id", "x-request-start"]);
const WEB_PROXY_PREFIXES = ["x-forwarded-", "x-railway-"];
/** refused on the web routes REGARDLESS of anything else (they are what would name a person). PUBLIC GO-LIVE: and
 *  x-railway-debug — the one x-railway-* name Railway documents as sent BY A CLIENT (it asks the edge for debug response
 *  headers), never added by the edge, so the hop prefix above must not let it in (re-read 2026-10-17, the same page) */
const WEB_REFUSED_HEADERS = new Set(["cookie", "authorization", "proxy-authorization", "referer", "x-railway-debug"]);
const trustProxy = () => process.env.TRUST_PROXY === "true";

/** the web routes' allowlist: the strict set + the browser-forced set (+ the proxy hop set behind a declared proxy) */
function webHeaderAllowed(name) {
  const k = String(name).toLowerCase();
  if (WEB_REFUSED_HEADERS.has(k) || k.startsWith("x-layers-")) return false;
  if (ALLOWED_HEADERS.has(k) || WEB_BROWSER_HEADERS.has(k) || WEB_BROWSER_PREFIXES.some((p) => k.startsWith(p))) return true;
  if (trustProxy() && (WEB_PROXY_HEADERS.has(k) || WEB_PROXY_PREFIXES.some((p) => k.startsWith(p)))) return true;
  return false;
}
function hasOnlyWebAllowedHeaders(headers) {
  for (const k of Object.keys(headers || {})) if (!webHeaderAllowed(k)) return false;
  return true;
}
/** the request body the browser sends is ALWAYS this size (lib/zk/config.ts ZK_SUBMIT_BYTES — DELIBERATE DUPLICATE):
 *  attack-1 finding 6's padding, enforced at the door of the web route — a body of any other size is malformed */
const WEB_BODY_BYTES = 4096;
/** PERSONA LAUNCH P7 (the browser channel carries the TEST universe only this wave): a stranger's tab may never put an
 *  envelope of the live universe through this door — a live anon post would reach Farcaster through the validator's
 *  relay, and the public anonymous account (O2) is the owner's, not built. Checked BEFORE the envelope is verified or
 *  recorded, so a live envelope consumes nothing. (Under OHTTP the gateway cannot tell a browser from a server device —
 *  that is the point of OHTTP — so there the browser refuses on its own side: lib/zk/anon/submit.ts.) */
function webEnvelopeUniverseOk(bodyBytes) {
  let parsed;
  try {
    parsed = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    return true; // not JSON at all: classify answers "malformed" exactly as the strict route does
  }
  // PUBLIC GO-LIVE (ASM-2B): only the PARSE is caught above. The universe rules below read the environment, and before this
  // fix a throw in them fell into the parse's catch and answered "ok" (fail open); now a throw reaches the route's own catch,
  // which answers "refused"
  const env = parsed && parsed.envelope;
  if (!env || !env.publicInputs || env.mode !== env.publicInputs.mode) return false;
  // PUBLIC GO-LIVE (ASM-2B): the TEST universe's proof is a public hash anyone can compute (validator/zk.js fixtureTag), so a
  // test envelope proves nothing about who sent it. It passed this door unconditionally, and a tab's own refusal of test posts
  // in a live product (lib/zk/anon/availability.ts) is the client's side only: an attacker skips the client. Now the door
  // refuses it, BEFORE verification (nothing is consumed or stored), once this validator is the live product (PUBLIC_LIVE on a
  // public deployment, publicLiveValidator below) or its PUBLIC relay is armed (liveWebDoorOpen). The rig, the owner service
  // and the unarmed preview are unchanged.
  if (env.mode === "fixture") return !(require("./anonpublic").liveWebDoorOpen() || publicLiveValidator());
  // PUBLIC GO-LIVE (the relay track): a LIVE envelope from a browser only while the PUBLIC relay is ready here (the agent path
  // armed: FC_ANON_* + ZK_ANON_RELAY_LIVE=on) — never on the owner path, never unarmed (validator/anonpublic.js liveWebDoorOpen)
  return env.mode === "live" && require("./anonpublic").liveWebDoorOpen();
}

/** PUBLIC GO-LIVE (ASM-2B): is this validator the LIVE product? A public deployment (production without the dev hooks:
 *  validator/env-contract.js isPublicDeployment, the shape validator/seed.js calls publicShape) whose PUBLIC_LIVE is on.
 *  The reading is seed.js's and lib/platform/publicLive.ts's ("true" on; unset, "" or "false" off) with ONE difference, and
 *  it fails closed: those two REFUSE any other value at boot, but the public validator's container never runs seed.js
 *  (Dockerfile.validator starts the supervisor directly), so nothing refuses a misspelt "True", "yes" or "on" here. Such a
 *  value counts as LIVE: a typo closes the test door, it never leaves it open. On a rig-shaped process (the rig, the owner
 *  service: ZK_DEV_HOOKS=true) it is always false, as seed.js ignores the variable there. */
function publicLiveValidator(env = process.env) {
  if (!require("./env-contract").isPublicDeployment(env)) return false;
  const v = env.PUBLIC_LIVE;
  return !(v === undefined || v === "" || v === "false");
}

// ---------- proof of work (hashcash-style, bound to the body bytes) ----------
function leadingZeroBits(buf) {
  let n = 0;
  for (const b of buf) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}
/** DELIBERATE DUPLICATE of lib/zk/anon/pow.ts: h = sha256(sha256(body) | "|" | nonce). */
function powValid(bodyBytes, nonce, bits) {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) return false;
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  const h = createHash("sha256").update(bodyHash + "|" + nonce).digest();
  return leadingZeroBits(h) >= bits;
}

// ---------- constant-shape responses ----------
function shapedBody(outcome) {
  const base = JSON.stringify({ outcome, pad: "" });
  const padLen = BODY_BYTES - Buffer.byteLength(base);
  if (padLen < 0) throw new Error("outcome too long for the constant shape");
  return Buffer.from(JSON.stringify({ outcome, pad: "x".repeat(padLen) }));
}
const sleepUntil = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - Date.now())));

/** The core: raw body bytes + lowercased headers → outcome word. */
async function classify(db, bodyBytes, headers) {
  if (!hasOnlyAllowedHeaders(headers)) return "refused";
  if (!bodyBytes || bodyBytes.length === 0 || bodyBytes.length > MAX_BODY) return "malformed";
  if (!powValid(bodyBytes, headers["x-zk-pow"], powBits())) return "refused";
  let parsed;
  try {
    parsed = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    return "malformed";
  }
  const r = await verifyAndRecord(db, parsed && parsed.envelope);
  if (r.status === 200) return "accepted";
  if (r.status === 409) return "replay";
  return "refused";
}

// ---------- OHTTP gateway ----------
const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0001;
const NK = 16;
const NN = 12;
const NENC = 32;
let gatewayPromise = null;

async function gateway(db) {
  if (gatewayPromise) return gatewayPromise;
  gatewayPromise = (async () => {
    let row = db.prepare("SELECT key_id, priv_hex, pub_hex FROM zk_ohttp_key WHERE id = 1").get();
    if (!row) {
      const kp = await suite.kem.generateKeyPair();
      const priv = Buffer.from(await suite.kem.serializePrivateKey(kp.privateKey)).toString("hex");
      const pub = Buffer.from(await suite.kem.serializePublicKey(kp.publicKey)).toString("hex");
      const keyId = randomBytes(1)[0];
      db.prepare("INSERT INTO zk_ohttp_key (id, key_id, priv_hex, pub_hex, created_at) VALUES (1, ?, ?, ?, ?)").run(keyId, priv, pub, Date.now());
      row = { key_id: keyId, priv_hex: priv, pub_hex: pub };
    }
    const privateKey = await suite.kem.deserializePrivateKey(new Uint8Array(Buffer.from(row.priv_hex, "hex")).buffer);
    const pub = Buffer.from(row.pub_hex, "hex");
    // RFC 9458 §3: key config = key_id(1) kem_id(2) pubkey(Npk) sym_len(2) [kdf_id(2) aead_id(2)]
    const cfg = Buffer.alloc(1 + 2 + pub.length + 2 + 4);
    let o = 0;
    cfg.writeUInt8(row.key_id, o); o += 1;
    cfg.writeUInt16BE(KEM_ID, o); o += 2;
    pub.copy(cfg, o); o += pub.length;
    cfg.writeUInt16BE(4, o); o += 2;
    cfg.writeUInt16BE(KDF_ID, o); o += 2;
    cfg.writeUInt16BE(AEAD_ID, o);
    return { keyId: row.key_id, privateKey, keyConfig: cfg };
  })();
  return gatewayPromise;
}

/** RFC 9458 §4.3 request decapsulation → { plaintext, respond(bytes) } */
async function decapsulate(gw, encRequest) {
  const buf = Buffer.from(encRequest);
  if (buf.length < 7 + NENC + 16) throw new Error("short");
  const hdr = buf.subarray(0, 7);
  if (hdr.readUInt8(0) !== gw.keyId || hdr.readUInt16BE(1) !== KEM_ID || hdr.readUInt16BE(3) !== KDF_ID || hdr.readUInt16BE(5) !== AEAD_ID) throw new Error("unknown key config");
  const enc = buf.subarray(7, 7 + NENC);
  const ct = buf.subarray(7 + NENC);
  const info = Buffer.concat([Buffer.from("message/bhttp request", "utf8"), Buffer.from([0]), hdr]);
  const ctx = await suite.createRecipientContext({ recipientKey: gw.privateKey, enc: new Uint8Array(enc).buffer, info: new Uint8Array(info).buffer });
  const pt = Buffer.from(await ctx.open(new Uint8Array(ct).buffer, new ArrayBuffer(0)));
  const secret = Buffer.from(await ctx.export(new Uint8Array(Buffer.from("message/bhttp response", "utf8")).buffer, NK));
  return {
    plaintext: pt,
    // RFC 9458 §4.4 response encapsulation
    respond(responseBytes) {
      const responseNonce = randomBytes(Math.max(NK, NN));
      const salt = Buffer.concat([enc, responseNonce]);
      const key = Buffer.from(hkdfSync("sha256", secret, salt, "key", NK));
      const nonce = Buffer.from(hkdfSync("sha256", secret, salt, "nonce", NN));
      const c = createCipheriv("aes-128-gcm", key, nonce);
      const out = Buffer.concat([c.update(Buffer.from(responseBytes)), c.final(), c.getAuthTag()]);
      return Buffer.concat([responseNonce, out]);
    },
  };
}

// ---------- mount (BEFORE express.json(): malformed bodies must reach us) ----------
function mountAnon(app, db) {
  const raw = express.raw({ type: () => true, limit: MAX_BODY });

  app.post("/zk/anon/submit", raw, async (req, res) => {
    const t0 = Date.now();
    let outcome;
    try {
      outcome = await classify(db, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers);
    } catch {
      outcome = "refused";
    }
    const body = shapedBody(outcome);
    await sleepUntil(t0 + responseMs());
    res.status(200).set("Content-Type", "application/json").set("Content-Length", String(body.length)).end(body);
  });

  /** THE SECOND VIEWPOINT (Pass 2 Gate 0): the newest signed history
   * head, to an UNIDENTIFIED caller (allowlisted headers only, no
   * envelope). Public material; the point is WHO may ask, not what. */
  app.get("/zk/anon/head", (req, res) => {
    if (!hasOnlyAllowedHeaders(req.headers)) return res.status(200).set("Content-Type", "application/json").end(JSON.stringify({ error: "refused" }));
    const h = anonHead(db, String(req.query.mode || ""), String(req.query.tree || ""));
    res.status(h ? 200 : 404).set("Content-Type", "application/json").end(JSON.stringify(h || { error: "unknown" }));
  });

  // ---------- PERSONA LAUNCH P7: THE BROWSER CHANNEL (lib/zk/anon/webChannel.ts is its only client) ----------
  // Why new routes and not a looser /zk/anon/submit: the strict route's exact-header contract is what the node device
  // (and accept-z1) relies on, and it stays byte-for-byte as it was. A browser reaches these instead, as a CORS SIMPLE
  // request — a text/plain body and no custom header, the proof of work in the QUERY — so no preflight is needed and
  // validator/server.js's Access-Control-Allow-Headers is unchanged. Everything after the door is the strict route's own
  // path: the same powValid bound to the same body bytes, the same classify → verifyAndRecord, the same 256-byte answer
  // held to the same ZK_ANON_RESPONSE_MS floor, and nothing logged (no IP, no time, no order — accept-z1 check 7 greps
  // this file). The query string is the only new thing a log line could hold, and it holds only the PoW nonce.
  app.post("/zk/anon/web", raw, async (req, res) => {
    const t0 = Date.now();
    let outcome;
    try {
      const bodyBytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const pow = typeof req.query.pow === "string" ? req.query.pow : "";
      if (!hasOnlyWebAllowedHeaders(req.headers)) outcome = "refused";
      else if (bodyBytes.length !== WEB_BODY_BYTES) outcome = "malformed";
      else if (!powValid(bodyBytes, pow, powBits())) outcome = "refused";
      else if (!webEnvelopeUniverseOk(bodyBytes)) outcome = "refused";
      // the strict core, handed exactly the strict header set (the browser's own headers were judged above)
      else outcome = await classify(db, bodyBytes, { "content-type": "application/json", "x-zk-pow": pow });
    } catch {
      outcome = "refused";
    }
    const body = shapedBody(outcome);
    await sleepUntil(t0 + responseMs());
    res.status(200).set("Content-Type", "application/json").set("Content-Length", String(body.length)).end(body);
  });

  /** the second viewpoint for a BROWSER: the same public head as /zk/anon/head, behind the web header policy */
  app.get("/zk/anon/web/head", (req, res) => {
    if (!hasOnlyWebAllowedHeaders(req.headers)) return res.status(200).set("Content-Type", "application/json").end(JSON.stringify({ error: "refused" }));
    const h = anonHead(db, String(req.query.mode || ""), String(req.query.tree || ""));
    res.status(h ? 200 : 404).set("Content-Type", "application/json").end(JSON.stringify(h || { error: "unknown" }));
  });

  app.get("/zk/ohttp-keys", async (req, res) => {
    const gw = await gateway(db);
    res.status(200).set("Content-Type", "application/ohttp-keys").end(gw.keyConfig);
  });

  app.post("/zk/anon/ohttp", raw, async (req, res) => {
    const t0 = Date.now();
    let outer;
    try {
      // the outer request comes from the relay; it too must be clean
      if (!hasOnlyAllowedHeaders(req.headers)) throw new Error("identifying header");
      const gw = await gateway(db);
      const { plaintext, respond } = await decapsulate(gw, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      const inner = bhttp.decodeRequest(plaintext);
      let innerRes;
      if (inner.method === "GET" && inner.path.startsWith("/zk/anon/head")) {
        // the second viewpoint through the gateway: same allowlist on the inner headers
        const q = new URL("http://x" + inner.path).searchParams;
        const h = hasOnlyAllowedHeaders(inner.headers) ? anonHead(db, String(q.get("mode") || ""), String(q.get("tree") || "")) : null;
        innerRes = bhttp.encodeResponse({ status: h ? 200 : 404, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(h || { error: "unknown" })) });
      } else {
        let outcome;
        if (inner.method !== "POST" || inner.path !== "/zk/anon/submit") outcome = "refused";
        else outcome = await classify(db, Buffer.from(inner.body), inner.headers);
        innerRes = bhttp.encodeResponse({ status: 200, headers: { "content-type": "application/json" }, body: shapedBody(outcome) });
      }
      outer = respond(innerRes);
    } catch {
      // undecapsulatable / dirty outer request: a constant-shape blob the
      // client cannot open (it reads as "refused"); no error text on the wire
      outer = randomBytes(OUTER_BYTES + bhttp.encodeResponse({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(0) }).length + 4);
      outer = outer.subarray(0, outerLength());
    }
    await sleepUntil(t0 + responseMs());
    res.status(200).set("Content-Type", "message/ohttp-res").set("Content-Length", String(outer.length)).end(outer);
  });
}

/** the exact outer response length (nonce + AEAD(bhttp(200, ct-json, 256 B))) */
function outerLength() {
  const innerLen = bhttp.encodeResponse({ status: 200, headers: { "content-type": "application/json" }, body: shapedBody("refused") }).length;
  return 16 + innerLen + 16;
}

module.exports = {
  mountAnon,
  ALLOWED_HEADERS,
  powValid,
  leadingZeroBits,
  shapedBody,
  BODY_BYTES,
  outerLength,
  KEM_ID,
  KDF_ID,
  AEAD_ID,
  // PERSONA LAUNCH P7: the browser channel's policy, for validator/test/anonweb.test.js and scripts/unit-prover.mjs
  webHeaderAllowed,
  WEB_BROWSER_HEADERS,
  WEB_REFUSED_HEADERS,
  WEB_PROXY_HEADERS,
  // PERSONA LAUNCH GO-LIVE: the hop-header prefixes (x-forwarded-, x-railway-), for the hop-header replay test
  WEB_PROXY_PREFIXES,
  WEB_BODY_BYTES,
  webEnvelopeUniverseOk,
  // PUBLIC GO-LIVE (ASM-2B): the live-product reading the web door's test-universe rule asks, for validator/test/anonweb.test.js
  publicLiveValidator,
};
