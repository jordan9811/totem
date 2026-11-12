"use strict";
// PUBLIC GO-LIVE (the relay track) — THE PUBLIC @anon RELAY: persona posts reach Farcaster through the public site's
// anonymous account, and the safety that has to exist BEFORE strangers post publicly. Mounted by ONE line in
// validator/server.js (mountAnonPublic); validator/zk.js keeps its relay and calls the small hooks below.
//
// 1. THE ONE RELAY CREDENTIAL (relayAccount). The public validator may hold exactly ONE write credential: the anon agent's
//    signer from a Neynar app that holds nothing else — FC_ANON_FID, FC_ANON_SIGNER_UUID, FC_ANON_NEYNAR_KEY — and the
//    switch ZK_ANON_RELAY_LIVE=on. The environment contract still refuses every other write credential on a public process
//    (NEYNAR_API_KEY, NEYNAR_SIGNER_UUID, ENABLE_FC_WRITE, …) and the public APP refuses the agent's key and signer outright
//    (lib/platform/env-contract.ts APP_ONLY_REFUSES): the app server stays keyless; the only process that ever posts is this
//    one. The OWNER SERVICE path (NEYNAR_API_KEY + ENABLE_FC_WRITE, armed by scripts/owner/arm-anon.ps1) is unchanged word
//    for word: it is what relayAccount answers whenever FC_ANON_NEYNAR_KEY is absent.
// 2. THE TRANSPORT SEAM (anonTransport). "neynar" is built: the signer lookup, POST /v2/farcaster/cast (publish) and DELETE
//    /v2/farcaster/cast (a takedown). ZK_ANON_TRANSPORT=hub — THE HUB ROUTE, built: no Neynar at all after the Network
//    School acquisition. The account is our own (scripts/owner/make-anon-account.mjs made it on the protocol); its Ed25519
//    signer key FC_ANON_SIGNER_KEY signs each cast (CastAdd) and takedown (CastRemove) here (validator/hubmessage.js) and
//    they go to a Snapchain node's POST /v1/submitMessage (FC_HUB_URL; the public https://snap.farcaster.xyz:3381 accepts
//    submits). The same node answers @anon's casts for the /anon pages (networkCasts / networkCast below).
//    FC_ANON_NEYNAR_BASE_URL is a TEST-ONLY loopback override of the Neynar base (scripts/lib/neynar-anon-stub.mjs),
//    refused on a hosting platform.
// 3. THE FID GATE (D-PUBLIC-LIVE-TREE). On the public shape (or ZK_ANON_FID_GATE=on) membership in the LIVE public tree
//    ("valid") is one commitment per Farcaster account, proven by a verified Sign in with Farcaster: the device presents the
//    signed SIWF message with its commitment and a salt; the message's nonce must be joinNonce(commitment, salt) (so a relay
//    or app that saw the signed message cannot join a different commitment with it), the domain must be APP_URL's host, the
//    times fresh, the signature must recover to the message's address, and that address must be the fid's custody address
//    (IdRegistry.idOf) or an auth address on it (KeyRegistry.keyDataOf keyType 2, state 1), read keylessly from a public
//    Optimism RPC (ANON_FID_RPC_URL, https only) or, for custody, a Farcaster hub (FC_HUB_URL). A newer sign-in replaces the
//    fid's commitment from the NEXT epoch (a lost passkey is not a lockout). The census and the client's crowd floor count
//    only this tree. The residual, named (R6): the validator learns fid -> commitment at join (and the join request's
//    address), never who posted. PRIV-LIVE-1: that commitment is the device's DEDICATED identity for this tree
//    (lib/zk/anon/fcJoin.ts, HKDF branch "layers/anon-fid-tree/1"), never registered under a root, so no table here joins a
//    fid to a root. ASM-5: it leaves the tree by a LEAVE signed with its own key (3b below), never by a root revocation.
//    ASM-1: a live anon post on this shape proves this tree and nothing else (validator/zk.js verifyAndRecord), and the
//    reach issuer ids cannot be registered in the live universe here (issuerRegistrationRefusal).
// 4. REPORTS (POST /zk/anon/report): a reason from a fixed list, the cast, the hour — no reporter identity is stored; a
//    per-address limit lives in memory only.
// 5. THE TAKEDOWN QUEUE: moderators are ANON_MODERATORS (comma separated Ed25519 PUBLIC keys; the private half is derived on
//    the owner's own browser device, HKDF branch "layers/anon-moderator/1", lib/zk/anon/moderation.ts). A moderator's SIGNED
//    read lists the reported casts; a signed REMOVE hides the cast at once (hidden_at — the row is KEPT: hide, never
//    delete), and in the live universe deletes it from Farcaster through the agent signer, retried a bounded number of times;
//    an outcome that cannot be confirmed is said as such. A signed KEEP dismisses the reports so far.
// 6. THE ONE-CAST READ (GET /zk/anon-cast?mode=&hash=): one relayed, non-hidden cast for the share page's server render; 404
//    when hidden or unknown.
//
// LOGGING DISCIPLINE (like zk.js and anon.js): this module logs nothing — no address, no time finer than the hour, no text.
const { createHash, randomBytes } = require("node:crypto");
const { verifyEd25519, isUsablePubkey } = require("./crypto");
const { edgeClientAddress } = require("./caps");

const HOUR = 3_600_000;
const hourGrain = (t) => Math.floor(t / HOUR) * HOUR;
const hourNumber = (t = Date.now()) => Math.floor(t / HOUR);
const CAST_HASH_RE = /^[0-9a-f]{64}$/;
const NETWORK_HASH_RE = /^0x[0-9a-f]{40}$/;
const PUBKEY_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const KEY_SHAPE = /^[A-Za-z0-9-]{16,80}$/;
const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const isField = (s) => typeof s === "string" && /^(0|[1-9][0-9]{0,76})$/.test(s) && BigInt(s) < FIELD;
const MODES = ["fixture", "live"];
const isMode = (m) => MODES.includes(m);
const envMod = () => require("./env-contract");
const fp = (k) => createHash("sha256").update(k).digest("hex").slice(0, 12);

/** the reasons a Report may give (DELIBERATE DUPLICATE of lib/zk/anon/moderation.ts REPORT_REASONS) */
const REPORT_REASONS = Object.freeze(["spam", "harassment", "hate", "doxxing", "violence", "illegal", "scam", "other"]);
/** a Farcaster link for a relayed cast (DELIBERATE DUPLICATE of lib/zk/anon/universe.ts castUrlFor) */
const castUrlFor = (networkHash) => (typeof networkHash === "string" && NETWORK_HASH_RE.test(networkHash) ? "https://farcaster.xyz/~/conversations/" + networkHash : null);

// ------------------------------------------------------------------------------------------------ 1. the relay account
const isLoopbackHost = (h) => {
  const x = String(h).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x === "::1" || /^127\.\d+\.\d+\.\d+$/.test(x);
};
const NEYNAR_REAL = "https://api.neynar.com";
/** the Neynar base the AGENT path talks to: the real one, or (tests only) a loopback override never honoured when hosted */
function neynarBase(env = process.env) {
  const raw = String(env.FC_ANON_NEYNAR_BASE_URL ?? "").trim();
  if (!raw) return { base: NEYNAR_REAL, error: null };
  if (envMod().isHostedPlatform(env)) return { base: null, error: "FC_ANON_NEYNAR_BASE_URL is set on a hosting platform (it is a test-only override)" };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { base: null, error: "FC_ANON_NEYNAR_BASE_URL is not a URL" };
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !isLoopbackHost(u.hostname) || u.username || u.password || u.search || u.hash) return { base: null, error: "FC_ANON_NEYNAR_BASE_URL is not a loopback http(s) address" };
  return { base: u.origin + u.pathname.replace(/\/+$/, ""), error: null };
}
/** the transport kind: "neynar" (the agent's Neynar signer) or "hub" (THE HUB ROUTE: the account's own Ed25519 signer,
 *  messages signed here and submitted to a Snapchain node, FC_HUB_URL — no Neynar at all) */
function transportKind(env = process.env) {
  const t = String(env.ZK_ANON_TRANSPORT ?? "").trim().toLowerCase();
  if (t === "" || t === "neynar") return { kind: "neynar", error: null };
  if (t === "hub") return { kind: "hub", error: null };
  return { kind: null, error: "ZK_ANON_TRANSPORT is neither neynar nor hub" };
}
const hubMod = () => require("./hubmessage");
/** the hub the relay posts to and reads from: FC_HUB_URL, https (loopback http only off a hosting platform: tests) */
function relayHub(env = process.env) {
  return hubMod().hubBaseOf(env.FC_HUB_URL, envMod().isHostedPlatform(env));
}
/**
 * THE HUB ROUTE — the account on ZK_ANON_TRANSPORT=hub: FC_ANON_FID + FC_ANON_SIGNER_KEY (the account's Ed25519 PRIVATE
 * key, the one write credential; only its public half and a fingerprint of that ever leave this function) + FC_HUB_URL,
 * the switch and the explicit lifetime cap. Refused beside any Neynar write credential (two relay credentials).
 */
function hubAccount(env, fid, foreignSigner) {
  const problems = [];
  const key = String(env.FC_ANON_SIGNER_KEY ?? "").trim();
  const pub = key ? hubMod().signerPublicKey(key) : null;
  if (!fid) problems.push("FC_ANON_FID is not a positive whole number");
  if (!key) problems.push("FC_ANON_SIGNER_KEY is unset (the anon account's own Ed25519 signer key)");
  else if (!pub) problems.push("FC_ANON_SIGNER_KEY is not a 64-hex Ed25519 private key");
  const h = relayHub(env);
  if (h.error) problems.push(h.error);
  const sw = String(env.ZK_ANON_RELAY_LIVE ?? "").trim().toLowerCase();
  if (sw !== "on") problems.push(sw ? "ZK_ANON_RELAY_LIVE is not on" : "ZK_ANON_RELAY_LIVE is unset (the relay's switch)");
  if (String(env.NEYNAR_API_KEY ?? "").trim()) problems.push("NEYNAR_API_KEY is set beside FC_ANON_SIGNER_KEY (two relay credentials)");
  if (String(env.FC_ANON_NEYNAR_KEY ?? "").trim()) problems.push("FC_ANON_NEYNAR_KEY is set beside FC_ANON_SIGNER_KEY (two relay credentials: the hub route needs no Neynar key)");
  if (foreignSigner) problems.push("NEYNAR_SIGNER_UUID is set (a signer that is not the anon account's)");
  if (agentLifetimeCap(env) === null) problems.push("ZK_ANON_POST_LIVE_CAP is unset (the public relay needs an explicit lifetime cap)");
  return { kind: "agent", transport: "hub", fid, signerUuid: "", signerPub: pub || "", apiKey: "", hubBase: h.base, armed: problems.length === 0, foreignSigner, keyFingerprint: pub ? fp(pub) : null, problems };
}
/** the lifetime cap of the AGENT path: required, explicit (the arm script sets it; -RaiseCap raises it), 0..1,000,000 */
function agentLifetimeCap(env = process.env) {
  const raw = env.ZK_ANON_POST_LIVE_CAP;
  if (raw === undefined || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1_000_000, Math.max(0, Math.floor(n))) : null;
}

/**
 * The account the validator relays through, and whether it is armed. The AGENT path (the public site) when
 * FC_ANON_NEYNAR_KEY is set; otherwise the OWNER-SERVICE path, byte for byte what validator/zk.js anonRelayAccount answered
 * before this pass. `problems`: names and plain reasons only, never a value.
 */
function relayAccount(env = process.env) {
  const fidN = Number(env.FC_ANON_FID ?? "");
  const fid = Number.isInteger(fidN) && fidN > 0 ? fidN : 0;
  const signerUuid = env.FC_ANON_SIGNER_UUID ?? "";
  const legacy = env.NEYNAR_SIGNER_UUID ?? "";
  const foreignSigner = !!legacy && legacy !== signerUuid;
  // THE HUB ROUTE: ZK_ANON_TRANSPORT=hub is the public relay's path whatever else is set (it refuses a Neynar key beside it)
  if (transportKind(env).kind === "hub") return hubAccount(env, fid, !!legacy);
  const agentKey = String(env.FC_ANON_NEYNAR_KEY ?? "").trim();
  if (agentKey) {
    const problems = [];
    if (!KEY_SHAPE.test(agentKey)) problems.push("FC_ANON_NEYNAR_KEY is not key-shaped");
    if (!fid) problems.push("FC_ANON_FID is not a positive whole number");
    if (!UUID_RE.test(String(signerUuid).trim())) problems.push("FC_ANON_SIGNER_UUID is not a uuid");
    const sw = String(env.ZK_ANON_RELAY_LIVE ?? "").trim().toLowerCase();
    if (sw !== "on") problems.push(sw ? "ZK_ANON_RELAY_LIVE is not on" : "ZK_ANON_RELAY_LIVE is unset (the relay's switch)");
    if (String(env.NEYNAR_API_KEY ?? "").trim()) problems.push("NEYNAR_API_KEY is set beside FC_ANON_NEYNAR_KEY (two relay credentials)");
    if (foreignSigner) problems.push("NEYNAR_SIGNER_UUID is set (a signer that is not the anon account's)");
    if (agentLifetimeCap(env) === null) problems.push("ZK_ANON_POST_LIVE_CAP is unset (the public relay needs an explicit lifetime cap)");
    const b = neynarBase(env);
    if (b.error) problems.push(b.error);
    const t = transportKind(env);
    if (t.error) problems.push(t.error);
    return { kind: "agent", fid, signerUuid: String(signerUuid).trim(), apiKey: agentKey, armed: problems.length === 0, foreignSigner, keyFingerprint: fp(agentKey), problems };
  }
  // the OWNER-SERVICE path (unchanged: validator/zk.js anonRelayAccount before PUBLIC GO-LIVE)
  const apiKey = env.NEYNAR_API_KEY ?? "";
  const armed = env.ENABLE_FC_WRITE === "true";
  return { kind: "owner", fid, signerUuid, apiKey, armed, foreignSigner, keyFingerprint: apiKey ? fp(apiKey) : null, problems: [] };
}
/** is the relay READY on this validator: an account named, armed, no foreign signer (the caller still checks the signer) */
const relayReady = (acct) => (acct.transport === "hub" ? !!(acct.fid && acct.signerPub && acct.hubBase && acct.armed && !acct.foreignSigner) : !!(acct.fid && acct.signerUuid && acct.apiKey && acct.armed && !acct.foreignSigner));
/**
 * PUBLIC GO-LIVE (ASM-4) — may a TAKEDOWN reach Farcaster? On the AGENT path the delete is gated on the CREDENTIAL alone:
 * the agent's fid, a uuid-shaped signer, a key-shaped key, no foreign signer, no second relay credential, a usable Neynar
 * base and transport. The switch (ZK_ANON_RELAY_LIVE) and the lifetime cap are IGNORED here: the kill switch stops new
 * posts, never the removal of one already on Farcaster (arm-public-anon.ps1 -Disarm deletes only the switch; -RevokeKey,
 * the leaked-key case, deletes the key and the signer, and only then do removals wait). The OWNER path is unchanged: it
 * deletes only while armed, exactly as before.
 */
function deleteCredentialReady(acct, env = process.env) {
  if (acct.kind !== "agent") return relayReady(acct);
  // THE HUB ROUTE: the account's signer key, a usable hub, no Neynar credential beside it (the switch and cap ignored)
  if (acct.transport === "hub") return !!(acct.fid && acct.signerPub && acct.hubBase && !acct.foreignSigner && !String(env.NEYNAR_API_KEY ?? "").trim() && !String(env.FC_ANON_NEYNAR_KEY ?? "").trim());
  if (!acct.fid || !UUID_RE.test(String(acct.signerUuid || "")) || !KEY_SHAPE.test(String(acct.apiKey || "")) || acct.foreignSigner) return false;
  if (String(env.NEYNAR_API_KEY ?? "").trim()) return false;
  if (neynarBase(env).error || transportKind(env).error) return false;
  return true;
}
/**
 * PUBLIC GO-LIVE (ASM-3) — does a relay that is NOT ready DROP the live posts still waiting for their slot? Yes on the
 * public shape and on the agent path (the public @anon): a disarm (the switch off, or the key revoked) marks them 'failed'
 * — the existing "the relay gave up" state: never relayed, never counted against a cap, already explained to posters — so
 * re-arming never publishes a backlog no moderator could see (a pending row cannot be reported). The owner service's path
 * (kind owner, not the public shape) is unchanged: its pending rows wait.
 */
function dropPendingOnDisarm(acct, env = process.env) {
  return !relayReady(acct) && (envMod().isPublicDeployment(env) || acct.kind === "agent");
}
/** the web door's universe rule (validator/anon.js webEnvelopeUniverseOk asks it): a LIVE envelope from a browser only while
 *  the PUBLIC relay (the agent path) is ready here — never on the owner path, never unarmed */
function liveWebDoorOpen(env = process.env) {
  const a = relayAccount(env);
  return a.kind === "agent" && relayReady(a);
}

// ------------------------------------------------------------------------------------------------ 2. the transport
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
/**
 * The transport for an account. Owner path: the real Neynar base, exactly the requests zk.js made before. Agent path: the
 * base neynarBase() allows. Every request is bounded; nothing here retries (the callers own their bounded retries).
 */
function anonTransport(acct, env = process.env) {
  if (acct.transport === "hub") return hubTransport(acct, env);
  const base = acct.kind === "agent" ? neynarBase(env).base : NEYNAR_REAL;
  const t = acct.kind === "agent" ? transportKind(env) : { kind: "neynar", error: null };
  const refused = (why) => ({ ok: false, refused: why });
  return {
    kind: t.kind,
    error: t.error || (base ? null : "the Neynar address is not usable"),
    /** is the signer approved for exactly this fid under this key? */
    async signerStatus() {
      if (t.error || !base) return refused(t.error || "no usable Neynar address");
      const res = await fetch(base + "/v2/farcaster/signer?signer_uuid=" + encodeURIComponent(acct.signerUuid), { headers: { "x-api-key": acct.apiKey }, signal: AbortSignal.timeout(20_000) });
      const j = await readJson(res);
      return { ok: !!(res.ok && j && j.status === "approved" && Number(j.fid) === acct.fid), status: res.status };
    },
    /** publish one cast; the idempotency key makes a retry after a lost answer safe */
    async publish(text, idem) {
      if (t.error || !base) return refused(t.error || "no usable Neynar address");
      const res = await fetch(base + "/v2/farcaster/cast", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": acct.apiKey },
        body: JSON.stringify({ signer_uuid: acct.signerUuid, text, idem }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await readJson(res);
      const hash = j && j.cast && typeof j.cast.hash === "string" ? j.cast.hash : null;
      const author = j && j.cast && j.cast.author ? Number(j.cast.author.fid) : NaN;
      return { ok: res.ok && !!hash, status: res.status, hash, author };
    },
    /** delete one cast this account published (a takedown) — documented: DELETE /v2/farcaster/cast {signer_uuid, target_hash} */
    async remove(targetHash) {
      if (t.error || !base) return refused(t.error || "no usable Neynar address");
      const res = await fetch(base + "/v2/farcaster/cast", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-api-key": acct.apiKey },
        body: JSON.stringify({ signer_uuid: acct.signerUuid, target_hash: targetHash }),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await readJson(res);
      return { ok: res.ok && (!j || j.success !== false), status: res.status };
    },
  };
}

/**
 * THE HUB ROUTE — the transport on ZK_ANON_TRANSPORT=hub: each cast is a CastAdd and each takedown a CastRemove, built and
 * signed HERE with the account's own Ed25519 key (read from FC_ANON_SIGNER_KEY at call time, never kept on the account
 * object, never logged) and submitted to FC_HUB_URL's POST /v1/submitMessage. FAIL CLOSED: a refused or unanswered
 * submit is { ok: false } with the node's own words, recorded for the public status (lastSubmitError, hour-grained) — the
 * relay keeps the row pending (bounded) and never marks it relayed. A RETRY of the same post (the same idempotency key)
 * re-signs the SAME timestamp, so it is the same message and the same hash: a node that already merged it answers
 * "duplicate", taken here as the success it is (memory only: after a redeploy a retry is a new message).
 */
const hubTimestamps = new Map(); // idem -> the first attempt's timestamp (bounded)
let lastSubmitError = null; // { hour, words }
let lastHubTs = 0;
function noteSubmitError(words) {
  lastSubmitError = { hour: hourGrain(Date.now()), words: String(words || "").slice(0, 240) };
}
const DUPLICATE_RE = /duplicate|already been merged|already exists/i;
function hubTransport(acct, env) {
  const h = relayHub(env);
  const key = () => String(env.FC_ANON_SIGNER_KEY ?? "").trim();
  const refused = (why) => ({ ok: false, refused: why });
  const usable = () => (h.error ? h.error : !acct.fid || !acct.signerPub || hubMod().signerPublicKey(key()) !== acct.signerPub ? "the hub signer key is not usable" : null);
  async function send(body, timestampMs) {
    let msg;
    try {
      msg = hubMod().makeMessage({ fid: acct.fid, timestampMs, body, privateKey: key() });
    } catch (e) {
      noteSubmitError(e.message);
      return { ok: false, status: 0, hash: null, error: e.message };
    }
    let r;
    try {
      r = await hubMod().submitMessage(h.base, msg);
    } catch (e) {
      r = { ok: false, status: 0, hash: null, error: "the hub did not answer (" + (e && e.name ? e.name : "error") + ")" };
    }
    if (!r.ok && r.status >= 400 && r.status < 500 && DUPLICATE_RE.test(r.error || "")) r = { ok: true, status: r.status, hash: msg.hash, error: null, duplicate: true };
    if (!r.ok) noteSubmitError(r.error || "HTTP " + r.status);
    return { ...r, msgHash: msg.hash };
  }
  return {
    kind: "hub",
    error: h.error,
    /** is the signer ACTIVE for exactly this fid (GET /v1/onChainSignersByFid)? an unread node is not ok */
    async signerStatus() {
      const why = usable();
      if (why) return refused(why);
      try {
        return { ok: (await hubMod().signerActive(h.base, acct.fid, acct.signerPub)) === true, status: 200 };
      } catch (e) {
        noteSubmitError(e.message);
        return { ok: false, status: 0 };
      }
    },
    /** publish one cast as a signed CastAdd; the author is the fid the message is signed for */
    async publish(text, idem) {
      const why = usable();
      if (why) return refused(why);
      const k = String(idem || "");
      let ts = k ? hubTimestamps.get(k) : undefined;
      if (ts === undefined) {
        // a NEW post gets a Farcaster second of its own (strictly after the last one handed out), so two different posts
        // with the same text are never the same message (Farcaster time is whole seconds)
        ts = Math.max(Date.now(), lastHubTs + 1000);
        lastHubTs = ts;
        if (k) {
          hubTimestamps.set(k, ts);
          while (hubTimestamps.size > 2000) hubTimestamps.delete(hubTimestamps.keys().next().value);
        }
      }
      const r = await send({ type: "CastAdd", text: String(text) }, ts);
      return { ok: r.ok && !!r.hash, status: r.status, hash: r.ok ? r.hash : null, author: r.ok ? acct.fid : NaN, error: r.error || null };
    },
    /** a takedown: a signed CastRemove of a cast this account published. A node that says the cast is not there is a 404 */
    async remove(targetHash) {
      const why = usable();
      if (why) return refused(why);
      const r = await send({ type: "CastRemove", targetHash: String(targetHash).toLowerCase() }, Date.now());
      if (!r.ok && /not.?found/i.test(r.error || "")) return { ok: false, status: 404 };
      return { ok: r.ok, status: r.status };
    },
  };
}

// ------------------------------------------------------------------------------------------------ the network reads
/**
 * THE HUB ROUTE — @anon's casts AS THE PROTOCOL HAS THEM (GET /v1/castsByFid, /v1/castById on FC_HUB_URL, keyless), for
 * the /anon page and its share pages: they show whatever the Farcaster app decides to hide. A cast a moderator removed
 * (hidden_at) is left out even before its CastRemove lands; each cast carries the relay's own castHash when it is one of
 * ours (so Report and Share work). Needs FC_HUB_URL and FC_ANON_FID only (it reads; it never needs the signer or the
 * switch). NEVER FAIL OPEN: an unread node is an error, never an empty list.
 */
function networkSource(env = process.env) {
  const fidN = Number(env.FC_ANON_FID ?? "");
  const fid = Number.isInteger(fidN) && fidN > 0 ? fidN : 0;
  const h = relayHub(env);
  if (!fid || h.error) return { ok: false, error: !fid ? "FC_ANON_FID is not set on this validator" : h.error };
  return { ok: true, fid, base: h.base };
}
function joinRows(db, casts) {
  const row = db.prepare("SELECT cast_hash, hidden_at FROM zk_anon_casts WHERE mode = 'live' AND network_hash = ?");
  const out = [];
  for (const c of casts) {
    const r = row.get(c.hash);
    if (r && r.hidden_at !== null) continue;
    out.push({ hash: c.hash, castHash: r ? r.cast_hash : null, text: c.text, at: c.at, reply: c.reply, castUrl: castUrlFor(c.hash) });
  }
  return out;
}
async function networkCasts(db, q = {}, env = process.env) {
  const src = networkSource(env);
  if (!src.ok) return { status: 501, json: { error: "@anon's network reads are not set up here: " + src.error, code: "network-reads-off" } };
  let casts;
  try {
    casts = await hubMod().castsByFid(src.base, src.fid, Number(q.limit) || 50);
  } catch {
    try {
      casts = await hubMod().castsByFid(src.base, src.fid, Number(q.limit) || 50);
    } catch (e) {
      return { status: 503, json: { error: "the Farcaster hub could not be read just now (" + e.message + ")" } };
    }
  }
  return { status: 200, json: { source: "hub", fid: src.fid, casts: joinRows(db, casts.filter((c) => !c.reply)) } };
}
async function networkCast(db, q = {}, env = process.env) {
  const hash = String(q.hash || "").toLowerCase();
  if (!NETWORK_HASH_RE.test(hash)) return { status: 400, json: { error: "hash must be a 0x network hash" } };
  const src = networkSource(env);
  if (!src.ok) return { status: 501, json: { error: "@anon's network reads are not set up here: " + src.error, code: "network-reads-off" } };
  let c;
  try {
    c = await hubMod().castById(src.base, src.fid, hash);
  } catch {
    try {
      c = await hubMod().castById(src.base, src.fid, hash);
    } catch (e) {
      return { status: 503, json: { error: "the Farcaster hub could not be read just now (" + e.message + ")" } };
    }
  }
  const joined = c ? joinRows(db, [c]) : [];
  if (!joined.length) return { status: 404, json: { error: "no @anon post with that hash is on Farcaster (or it was removed)" } };
  return { status: 200, json: { source: "hub", fid: src.fid, cast: joined[0] } };
}

// ------------------------------------------------------------------------------------------------ 3. the fid gate
/** is the fid gate on: always on the public shape; elsewhere only when ZK_ANON_FID_GATE=on (a rig that tests it) */
function fidGateOn(env = process.env) {
  return envMod().isPublicDeployment(env) || String(env.ZK_ANON_FID_GATE ?? "").trim().toLowerCase() === "on";
}
/** the LIVE public tree's members for an epoch when the gate is on (each fid's commitment, a leaf from the epoch AFTER it
 *  joined, until the epoch it LEFT — ASM-5: a leave signed by the commitment's own identity), else null —
 *  validator/zk.js buildTrees asks this for the "valid" tree */
function fidGateMembers(db, mode, epoch, env = process.env) {
  if (mode !== "live" || !fidGateOn(env)) return null;
  return db.prepare("SELECT commitment FROM zk_anon_fid_members WHERE mode = 'live' AND joined_epoch < ? AND (left_epoch IS NULL OR left_epoch > ?) ORDER BY joined_epoch, commitment").all(epoch, epoch).map((r) => r.commitment);
}
/** PUBLIC GO-LIVE (ASM-1): the reach issuer ids a gated validator refuses to REGISTER in the live universe — the open
 *  registry is first-come, so on the public shape nobody may claim the reach ids there (a live anon post proves the gated
 *  plain tree only: validator/zk.js verifyAndRecord) */
const RESERVED_LIVE_ISSUERS = Object.freeze(["fc.reach", "x.reach"]);
function issuerRegistrationRefusal(mode, id, env = process.env) {
  if (mode === "live" && fidGateOn(env) && RESERVED_LIVE_ISSUERS.includes(String(id))) return "the reach issuer ids are reserved on this site's live crowd: a live anonymous post proves the Farcaster-joined crowd only";
  return null;
}
const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** the SIWF nonce that binds a commitment (DELIBERATE DUPLICATE of lib/zk/anon/fcJoin.ts joinNonceFor): 16 base62 characters
 *  of sha256("layers-anon-fid-join/1|" + commitment + "|" + salt) */
function joinNonceFor(commitment, salt) {
  const d = createHash("sha256").update("layers-anon-fid-join/1|" + commitment + "|" + salt, "utf8").digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += B62[d[i] % 62];
  return out;
}
const SIWF_STATEMENT = "Farcaster Auth";
const ID_REGISTRY = "0x00000000fc6c5f01fc30151999387bb99a9f489b";
const KEY_REGISTRY = "0x00000000fc1237824fb747abde0ff18990e59b7e";
const ISSUED_PAST_MS = 10 * 60_000;
const ISSUED_FUTURE_MS = 2 * 60_000;
const DEFAULT_RPC = "https://mainnet.optimism.io";

/** PURE: the EIP-4361 message the Farcaster relay hands back, parsed strictly; null when it is not one */
function parseSiwe(message) {
  if (typeof message !== "string" || message.length < 32 || message.length > 4096) return null;
  const lines = message.split("\n");
  const m0 = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0] || "");
  if (!m0) return null;
  const address = lines[1] || "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  if (lines[2] !== "") return null;
  let i = 3;
  let statement = null;
  if (lines[i] !== undefined && !/^URI: /.test(lines[i])) {
    statement = lines[i];
    i++;
    if (lines[i] !== "") return null;
    i++;
  }
  const out = { domain: m0[1], address: address.toLowerCase(), statement, resources: [] };
  const fields = { "URI: ": "uri", "Version: ": "version", "Chain ID: ": "chainId", "Nonce: ": "nonce", "Issued At: ": "issuedAt", "Expiration Time: ": "expirationTime", "Not Before: ": "notBefore", "Request ID: ": "requestId" };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === "Resources:") {
      for (i = i + 1; i < lines.length; i++) {
        const r = /^- (.+)$/.exec(lines[i]);
        if (!r) return null;
        out.resources.push(r[1]);
      }
      break;
    }
    const k = Object.keys(fields).find((p) => l.startsWith(p));
    if (!k) return null;
    if (out[fields[k]] !== undefined) return null;
    out[fields[k]] = l.slice(k.length);
  }
  if (!out.uri || !out.version || !out.chainId || !out.nonce || !out.issuedAt) return null;
  return out;
}
/** the address an EIP-191 personal_sign signature over `message` recovers to (lowercase), or null */
function recoverPersonalSign(message, signature) {
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
    const { secp256k1 } = require("@noble/curves/secp256k1");
    const { keccak_256 } = require("@noble/hashes/sha3");
    const body = Buffer.from(message, "utf8");
    const h = keccak_256(Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n" + body.length, "utf8"), body]));
    const b = Buffer.from(signature.slice(2), "hex");
    let rec = b[64];
    if (rec >= 27) rec -= 27;
    if (rec !== 0 && rec !== 1) return null;
    const sig = secp256k1.Signature.fromCompact(b.subarray(0, 64)).addRecoveryBit(rec);
    const pub = sig.recoverPublicKey(h).toRawBytes(false);
    return "0x" + Buffer.from(keccak_256(pub.subarray(1))).subarray(12).toString("hex");
  } catch {
    return null;
  }
}
const selector = (sig) => Buffer.from(require("@noble/hashes/sha3").keccak_256(Buffer.from(sig, "utf8"))).subarray(0, 4).toString("hex");
const word = (hexNoPrefix) => hexNoPrefix.padStart(64, "0");
/** IdRegistry.idOf(address) and KeyRegistry.keyDataOf(fid, abi.encode(address)) call data (verified against viem in
 *  validator/test/anonpublic.test.js — the same bytes lib/fc/siwf/verify.ts sends) */
function idOfCallData(address) {
  return "0x" + selector("idOf(address)") + word(address.slice(2).toLowerCase());
}
function keyDataOfCallData(fid, address) {
  return "0x" + selector("keyDataOf(uint256,bytes)") + word(BigInt(fid).toString(16)) + word("40") + word("20") + word(address.slice(2).toLowerCase());
}
/** where the chain is read: { rpc, hub } — https only (a loopback http address is allowed off a hosting platform: tests) */
function chainSource(env = process.env) {
  const ok = (raw) => {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.username || u.password || u.hash) return null;
      if (u.protocol === "https:") return u.origin + u.pathname.replace(/\/+$/, "");
      if (u.protocol === "http:" && isLoopbackHost(u.hostname) && !envMod().isHostedPlatform(env)) return u.origin + u.pathname.replace(/\/+$/, "");
      return null;
    } catch {
      return null;
    }
  };
  const rpcRaw = String(env.ANON_FID_RPC_URL ?? "").trim();
  const hubRaw = String(env.FC_HUB_URL ?? "").trim();
  return { rpc: rpcRaw ? ok(rpcRaw) : DEFAULT_RPC, rpcBad: !!rpcRaw && !ok(rpcRaw), hub: hubRaw ? ok(hubRaw) : null, hubBad: !!hubRaw && !ok(hubRaw) };
}
let chainIdChecked = false;
async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error("rpc http " + res.status);
  const j = await readJson(res);
  if (!j || j.error || typeof j.result !== "string") throw new Error("rpc answer unreadable");
  return j.result;
}
/** does `address` control `fid` the way `authMethod` says? true / false; throws when the chain could not be read */
async function chainSaysControls(fid, address, authMethod, env = process.env) {
  const src = chainSource(env);
  if (authMethod === "custody" && src.hub) {
    const res = await fetch(src.hub + "/v1/onChainIdRegistryEventByAddress?address=" + address, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error("hub http " + res.status);
    const j = await readJson(res);
    if (!j || !Number.isFinite(Number(j.fid))) throw new Error("hub answer unreadable");
    return Number(j.fid) === fid;
  }
  if (!src.rpc) throw new Error("no usable chain address");
  if (!chainIdChecked) {
    const id = await rpcCall(src.rpc, "eth_chainId", []);
    if (parseInt(id, 16) !== 10) throw new Error("the chain is not Optimism");
    chainIdChecked = true;
  }
  if (authMethod === "custody") {
    const r = await rpcCall(src.rpc, "eth_call", [{ to: ID_REGISTRY, data: idOfCallData(address) }, "latest"]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(r)) throw new Error("idOf answer unreadable");
    return BigInt(r) === BigInt(fid);
  }
  if (authMethod === "authAddress") {
    const r = await rpcCall(src.rpc, "eth_call", [{ to: KEY_REGISTRY, data: keyDataOfCallData(fid, address) }, "latest"]);
    if (!/^0x[0-9a-fA-F]{128}$/.test(r)) throw new Error("keyDataOf answer unreadable");
    const state = Number(BigInt("0x" + r.slice(2, 66)));
    const keyType = Number(BigInt("0x" + r.slice(66, 130)));
    return state === 1 && keyType === 2;
  }
  return false;
}
/** the plain refusals of a join (fixed sentences: never a value from the request) */
const JOIN_SENTENCES = Object.freeze({
  off: "Joining the anonymous crowd with Farcaster isn't on here.",
  mode: "Only the live crowd is joined with Farcaster.",
  shape: "That sign-in can't be used to join the anonymous crowd. Sign in with Farcaster again.",
  contract: "A smart-contract wallet signature can't be checked here yet, so it can't join the anonymous crowd.",
  site: "This server doesn't know the site's address (APP_URL), so it can't check a Farcaster sign-in.",
  message: "The signed message doesn't match this site or this sign-in. Sign in with Farcaster again.",
  stale: "That sign-in is too old to join the anonymous crowd. Sign in with Farcaster again.",
  replay: "That sign-in was already used. Sign in with Farcaster again.",
  signature: "The signature doesn't check out.",
  account: "That signature doesn't belong to this Farcaster account.",
  chain: "Couldn't check your Farcaster account on the Optimism blockchain just now. Try again in a moment.",
  taken: "This identity already joined the anonymous crowd with another Farcaster account.",
  rate: "Too many tries from here. Try again later.",
});
const seenJoinMessages = new Map(); // sha256(message) -> expiry (memory: the freshness window bounds it)

/** POST /zk/anon/fid-join — returns {status, json} */
async function fidJoin(db, body, env = process.env, now = Date.now()) {
  const b = body || {};
  const no = (status, key) => ({ status, json: { error: JOIN_SENTENCES[key], code: "fid-join-" + key } });
  if (!fidGateOn(env)) return no(404, "off");
  if (String(b.mode || "live") !== "live") return no(400, "mode");
  const fid = Number(b.fid);
  const commitment = String(b.commitment || "");
  const salt = String(b.salt || "").toLowerCase();
  const message = typeof b.message === "string" ? b.message : "";
  const signature = typeof b.signature === "string" ? b.signature : "";
  const authMethod = b.authMethod === "custody" || b.authMethod === "authAddress" ? b.authMethod : null;
  if (!Number.isSafeInteger(fid) || fid <= 0 || !isField(commitment) || !NONCE_RE.test(salt) || !authMethod || !message) return no(400, "shape");
  if (/^0x[0-9a-fA-F]+$/.test(signature) && signature.length > 132) return no(400, "contract");
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return no(400, "shape");
  let site;
  try {
    site = new URL(String(env.APP_URL || ""));
  } catch {
    return no(503, "site");
  }
  const m = parseSiwe(message);
  if (!m) return no(400, "message");
  if (m.statement !== SIWF_STATEMENT || m.version !== "1" || m.chainId !== "10" || m.domain !== site.host) return no(400, "message");
  let uriOrigin = "";
  try {
    uriOrigin = new URL(m.uri).origin;
  } catch {
    return no(400, "message");
  }
  if (uriOrigin !== site.origin) return no(400, "message");
  const fc = m.resources.filter((r) => /^farcaster:/i.test(r.trim()));
  const rm = fc.length === 1 ? /^farcaster:\/\/fid\/([1-9]\d*)\/?$/.exec(fc[0].trim()) : null;
  if (!rm || Number(rm[1]) !== fid) return no(400, "message");
  if (m.nonce !== joinNonceFor(commitment, salt)) return no(400, "message");
  const issued = Date.parse(m.issuedAt);
  if (!Number.isFinite(issued) || issued < now - ISSUED_PAST_MS || issued > now + ISSUED_FUTURE_MS) return no(400, "stale");
  if (m.expirationTime !== undefined) {
    const exp = Date.parse(m.expirationTime);
    if (!Number.isFinite(exp) || exp <= now) return no(400, "stale");
  }
  if (m.notBefore !== undefined) {
    const nbf = Date.parse(m.notBefore);
    if (!Number.isFinite(nbf) || nbf > now) return no(400, "stale");
  }
  const mh = createHash("sha256").update(message, "utf8").digest("hex");
  for (const [k, exp] of seenJoinMessages) if (exp <= now) seenJoinMessages.delete(k);
  if (seenJoinMessages.has(mh)) return no(409, "replay");
  const recovered = recoverPersonalSign(message, signature);
  if (!recovered || recovered !== m.address) return no(400, "signature");
  let controls;
  try {
    controls = await chainSaysControls(fid, m.address, authMethod, env);
  } catch {
    return no(503, "chain");
  }
  if (!controls) return no(403, "account");
  seenJoinMessages.set(mh, now + ISSUED_PAST_MS + ISSUED_FUTURE_MS);
  const { epochInfo } = require("./zk");
  const { epoch } = epochInfo(db, "live", now);
  const holder = db.prepare("SELECT fid FROM zk_anon_fid_members WHERE mode = 'live' AND commitment = ?").get(commitment);
  if (holder && holder.fid !== fid) return no(409, "taken");
  const row = db.prepare("SELECT commitment, joined_epoch, left_epoch FROM zk_anon_fid_members WHERE mode = 'live' AND fid = ?").get(fid);
  // ASM-5: a row that LEFT (a leave signed by its identity) is joined again only by a fresh sign-in like this one — the
  // marker is cleared (the row was kept: hide, never delete) and it is a leaf again from the NEXT epoch
  const left = !!row && row.left_epoch !== null && row.left_epoch !== undefined;
  if (row && row.commitment === commitment && !left) return { status: 200, json: { ok: true, existing: true, activeFromEpoch: row.joined_epoch + 1 } };
  if (row) db.prepare("UPDATE zk_anon_fid_members SET commitment = ?, joined_epoch = ?, left_epoch = NULL WHERE mode = 'live' AND fid = ?").run(commitment, epoch, fid);
  else db.prepare("INSERT INTO zk_anon_fid_members (mode, fid, commitment, joined_epoch) VALUES ('live', ?, ?, ?)").run(fid, commitment, epoch);
  return { status: 201, json: { ok: true, replaced: !!row && row.commitment !== commitment, rejoined: left && row.commitment === commitment, activeFromEpoch: epoch + 1 } };
}

// ------------------------------------------------------------------------------------------------ 3b. leaving the crowd
// PUBLIC GO-LIVE (ASM-5) — REVOCATION OF A FARCASTER-JOINED COMMITMENT. The commitment the fid gate holds is the device's
// DEDICATED identity for the live crowd (lib/zk/anon/fcJoin.ts, HKDF branch "layers/anon-fid-tree/1": never registered
// under a root, so no table here joins it to one — PRIV-LIVE-1). A root revocation (POST /zk/revoke) therefore cannot reach
// it; the device sends a LEAVE instead, signed by that identity's own EdDSA-Poseidon key: the validator checks that the
// public key hashes to the commitment (Poseidon, as Semaphore does) and that the signature is over this leave, then marks
// the row left from the NEXT epoch (this epoch's tree is frozen). The row is KEPT (hide, never delete); only a fresh Sign in
// with Farcaster by the fid joins it again (fidJoin above). Idempotent; hour-fresh; no address or time finer than the hour
// is stored.
/** the field element a leave signs (DELIBERATE DUPLICATE of lib/zk/anon/fcJoin.ts fidLeaveMessage):
 *  sha256("layers-anon-fid-leave/1|" + mode + "|" + commitment + "|" + issuedHour) >> 8 */
function fidLeaveMessage(mode, commitment, issuedHour) {
  const h = createHash("sha256").update(["layers-anon-fid-leave/1", mode, commitment, String(issuedHour)].join("|"), "utf8").digest("hex");
  return BigInt("0x" + h) >> 8n;
}
const LEAVE_SENTENCES = Object.freeze({
  off: "Leaving the anonymous crowd isn't needed here: it isn't joined with Farcaster on this site.",
  mode: "Only the live crowd is left this way.",
  shape: "That request to leave the anonymous crowd wasn't understood.",
  stale: "That request to leave is too old. Try again.",
  signature: "That request to leave isn't signed by the identity that joined.",
  unknown: "That identity isn't in the anonymous crowd.",
  rate: "Too many tries from here. Try again later.",
});
/** POST /zk/anon/fid-leave {mode, commitment, publicKey: [x, y], signature: {R8: [x, y], S}, issuedHour} — {status, json} */
function fidLeave(db, body, env = process.env, now = Date.now()) {
  const b = body || {};
  const no = (status, key) => ({ status, json: { error: LEAVE_SENTENCES[key], code: "fid-leave-" + key } });
  if (!fidGateOn(env)) return no(404, "off");
  if (String(b.mode || "live") !== "live") return no(400, "mode");
  const commitment = String(b.commitment || "");
  const pk = Array.isArray(b.publicKey) ? b.publicKey.map((x) => String(x)) : [];
  const sg = b.signature && typeof b.signature === "object" ? b.signature : {};
  const r8 = Array.isArray(sg.R8) ? sg.R8.map((x) => String(x)) : [];
  const S = String(sg.S ?? "");
  const issuedHour = Number(b.issuedHour);
  if (!isField(commitment) || pk.length !== 2 || !pk.every(isField) || r8.length !== 2 || !r8.every(isField) || !isField(S)) return no(400, "shape");
  if (!Number.isInteger(issuedHour) || Math.abs(issuedHour - hourNumber(now)) > 1) return no(400, "stale");
  let ok = false;
  try {
    const { Identity } = require("@semaphore-protocol/identity");
    const pub = pk.map((x) => BigInt(x));
    ok = Identity.generateCommitment(pub).toString(10) === commitment && Identity.verifySignature(fidLeaveMessage("live", commitment, issuedHour), { R8: r8.map((x) => BigInt(x)), S: BigInt(S) }, pub) === true;
  } catch {
    ok = false;
  }
  if (!ok) return no(403, "signature");
  const row = db.prepare("SELECT left_epoch FROM zk_anon_fid_members WHERE mode = 'live' AND commitment = ?").get(commitment);
  if (!row) return no(404, "unknown");
  if (row.left_epoch !== null && row.left_epoch !== undefined) return { status: 200, json: { ok: true, existing: true, leftFromEpoch: row.left_epoch } };
  const { epochInfo } = require("./zk");
  const { epoch } = epochInfo(db, "live", now);
  db.prepare("UPDATE zk_anon_fid_members SET left_epoch = ? WHERE mode = 'live' AND commitment = ?").run(epoch + 1, commitment);
  return { status: 200, json: { ok: true, leftFromEpoch: epoch + 1 } };
}

// ------------------------------------------------------------------------------------------------ the filter's log
/** a filter refusal, recorded as its rule id and the hour — never the text (validator/zk.js calls this) */
function recordFilterRefusal(db, mode, rule) {
  try {
    db.prepare("INSERT INTO zk_anon_filter_log (id, mode, rule, created_hour) VALUES (?, ?, ?, ?)").run(randomBytes(12).toString("hex"), mode, String(rule).slice(0, 32), hourGrain(Date.now()));
  } catch {
    /* a log row that cannot be written never turns a refusal into an acceptance */
  }
}

// ------------------------------------------------------------------------------------------------ 5. moderation
/** what a moderator signs to decide one cast (DELIBERATE DUPLICATE of lib/zk/anon/moderation.ts takedownCanonical) */
const takedownCanonical = (mode, castHash, decision, issuedHour, nonce) => ["layers-anon-takedown/1", mode, castHash, decision, String(issuedHour), String(nonce)].join("|");
/** what a moderator signs to read the reported casts (DELIBERATE DUPLICATE of lib/zk/anon/moderation.ts reviewCanonical) */
const reviewCanonical = (mode, issuedHour, pubkey) => ["layers-anon-review/1", mode, String(issuedHour), pubkey].join("|");
const freshHour = (h) => Number.isInteger(h) && Math.abs(h - hourNumber()) <= 1;
const devModerators = new Set(); // a rig's test moderators (dev hooks only; memory)
/** the moderators: ANON_MODERATORS (usable Ed25519 PUBLIC keys only), plus a rig's dev-registered keys */
function moderators(env = process.env, devHooks = false) {
  const out = new Set(
    String(env.ANON_MODERATORS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((k) => PUBKEY_RE.test(k) && isUsablePubkey(k))
  );
  if (devHooks) for (const k of devModerators) out.add(k);
  return [...out].sort();
}
/** the moderator's signed read: the reported casts (reports since the last KEEP), and the removed ones of the last 7 days */
function review(db, q, opts = {}) {
  const env = opts.env || process.env;
  const mode = String(q.mode || "live");
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture or live" } };
  const pubkey = String(q.pubkey || "").toLowerCase();
  const sig = String(q.sig || "").toLowerCase();
  const issuedHour = Number(q.issuedHour);
  if (!freshHour(issuedHour)) return { status: 400, json: { error: "the read's hour is not this hour — sign it again" } };
  const mods = moderators(env, opts.devHooks === true);
  if (!mods.includes(pubkey)) return { status: 403, json: { error: mods.length ? "that key is not a moderator here" : "no moderator is set up on this validator" } };
  if (!verifyEd25519(sig, reviewCanonical(mode, issuedHour, pubkey), pubkey)) return { status: 403, json: { error: "the review signature does not verify" } };
  const reported = db
    .prepare(
      "SELECT r.cast_hash AS castHash, r.reason AS reason, COUNT(*) AS n, MAX(r.created_hour) AS lastHour FROM zk_anon_reports r LEFT JOIN zk_anon_takedowns t ON t.mode = r.mode AND t.cast_hash = r.cast_hash " +
        "WHERE r.mode = ? AND (t.cast_hash IS NULL OR (t.decision = 'keep' AND r.created_hour > t.decided_hour)) GROUP BY r.cast_hash, r.reason"
    )
    .all(mode);
  const byCast = new Map();
  for (const r of reported) {
    const e = byCast.get(r.castHash) || { castHash: r.castHash, reasons: {}, reports: 0, lastHour: 0 };
    e.reasons[r.reason] = r.n;
    e.reports += r.n;
    e.lastHour = Math.max(e.lastHour, r.lastHour);
    byCast.set(r.castHash, e);
  }
  const castRow = db.prepare("SELECT cast_hash, text, network_hash, status, relayed_at, hidden_at FROM zk_anon_casts WHERE mode = ? AND cast_hash = ?");
  const items = [];
  for (const e of byCast.values()) {
    const c = castRow.get(mode, e.castHash);
    if (!c || c.hidden_at !== null) continue;
    items.push({ ...e, text: c.text, status: c.status, hour: c.relayed_at, castUrl: castUrlFor(c.network_hash) });
  }
  items.sort((a, b) => b.reports - a.reports || b.lastHour - a.lastHour || (a.castHash < b.castHash ? -1 : 1));
  const removed = db
    .prepare("SELECT t.cast_hash AS castHash, t.decided_hour AS hour, t.delete_state AS deleteState, t.attempts AS attempts, c.text AS text, c.network_hash AS networkHash FROM zk_anon_takedowns t JOIN zk_anon_casts c ON c.mode = t.mode AND c.cast_hash = t.cast_hash WHERE t.mode = ? AND t.decision = 'remove' AND t.decided_hour >= ? ORDER BY t.decided_hour DESC LIMIT 100")
    .all(mode, hourGrain(Date.now() - 7 * 24 * HOUR))
    .map((r) => ({ castHash: r.castHash, hour: r.hour, deleteState: r.deleteState, attempts: r.attempts, text: r.text, castUrl: castUrlFor(r.networkHash) }));
  return { status: 200, json: { mode, items: items.slice(0, 200), removed } };
}
/** the most attempts a Farcaster delete gets before its outcome is said to be unknown (bounded: never endless) */
const DELETE_MAX_ATTEMPTS = 5;
/**
 * POST /zk/anon/moderation {mode, castHash, decision, issuedHour, nonce, pubkey, sig}. REMOVE: hidden at once (the row is
 * kept), and — live — queued for a Farcaster delete through the agent signer (deleteDue below). KEEP: the reports so far are
 * dismissed. A decision on a removed cast is refused (removed is final). Returns {status, json}.
 */
function decide(db, b0, opts = {}) {
  const env = opts.env || process.env;
  const b = b0 || {};
  const mode = String(b.mode || "live");
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture or live" } };
  const castHash = String(b.castHash || "").toLowerCase();
  const decision = String(b.decision || "");
  const pubkey = String(b.pubkey || "").toLowerCase();
  const sig = String(b.sig || "").toLowerCase();
  const nonce = String(b.nonce || "").toLowerCase();
  const issuedHour = Number(b.issuedHour);
  if (!CAST_HASH_RE.test(castHash)) return { status: 400, json: { error: "castHash must be the post's 64-hex hash" } };
  if (decision !== "remove" && decision !== "keep") return { status: 400, json: { error: "decision must be remove or keep" } };
  if (!freshHour(issuedHour)) return { status: 400, json: { error: "the decision's hour is not this hour — sign it again" } };
  if (!NONCE_RE.test(nonce)) return { status: 400, json: { error: "the decision must carry a fresh 32-hex nonce — sign it again" } };
  if (!PUBKEY_RE.test(pubkey) || !SIG_RE.test(sig)) return { status: 400, json: { error: "pubkey and sig are required" } };
  const mods = moderators(env, opts.devHooks === true);
  if (mods.length === 0) return { status: 403, json: { error: "no moderator is set up on this validator" } };
  if (!mods.includes(pubkey)) return { status: 403, json: { error: "that key is not a moderator here" } };
  if (!verifyEd25519(sig, takedownCanonical(mode, castHash, decision, issuedHour, nonce), pubkey)) return { status: 403, json: { error: "the decision signature does not verify" } };
  const c = db.prepare("SELECT status, network_hash, hidden_at FROM zk_anon_casts WHERE mode = ? AND cast_hash = ?").get(mode, castHash);
  if (!c) return { status: 404, json: { error: "no anonymous post with that hash" } };
  const prev = db.prepare("SELECT decision, delete_state FROM zk_anon_takedowns WHERE mode = ? AND cast_hash = ?").get(mode, castHash);
  if (prev && prev.decision === "remove") return { status: 409, json: { error: "this post was already removed", deleteState: prev.delete_state } };
  const decidedHour = hourGrain(Date.now());
  if (decision === "keep") {
    db.prepare("INSERT INTO zk_anon_takedowns (mode, cast_hash, decision, decided_hour, moderator_key, delete_state, attempts) VALUES (?, ?, 'keep', ?, ?, 'none', 0) ON CONFLICT(mode, cast_hash) DO UPDATE SET decision = 'keep', decided_hour = excluded.decided_hour, moderator_key = excluded.moderator_key, delete_state = 'none', attempts = 0").run(mode, castHash, decidedHour, pubkey);
    return { status: 200, json: { ok: true, castHash, decision: "keep" } };
  }
  // REMOVE: a fixture post never reached Farcaster; a live one that was never relayed has nothing to delete (the relay
  // skips a hidden row); a relayed one is queued for the delete
  const state = mode !== "live" ? "not-on-network" : c.status === "relayed" && c.network_hash ? "pending" : "never-posted";
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE zk_anon_casts SET hidden_at = ? WHERE mode = ? AND cast_hash = ? AND hidden_at IS NULL").run(decidedHour, mode, castHash);
    db.prepare("INSERT INTO zk_anon_takedowns (mode, cast_hash, decision, decided_hour, moderator_key, delete_state, attempts) VALUES (?, ?, 'remove', ?, ?, ?, 0) ON CONFLICT(mode, cast_hash) DO UPDATE SET decision = 'remove', decided_hour = excluded.decided_hour, moderator_key = excluded.moderator_key, delete_state = excluded.delete_state, attempts = 0").run(mode, castHash, decidedHour, pubkey, state);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return { status: 500, json: { error: "the decision was not recorded: " + (e && e.message ? e.message : String(e)) } };
  }
  return { status: 200, json: { ok: true, castHash, decision: "remove", hidden: true, deleteState: state } };
}
/**
 * One pass of the Farcaster deletes that are due (live only): each removed, relayed cast in 'pending' or 'retrying' gets ONE
 * attempt through the agent transport; success → 'deleted', a 404 → 'not-found' (Farcaster says it is not there), anything
 * else → 'retrying' until DELETE_MAX_ATTEMPTS, then 'unknown' (said to the moderator as "couldn't confirm", never "removed").
 * A row removed before it was relayed and relayed anyway (a race with the relay) is moved to 'pending'. Never throws.
 * PUBLIC GO-LIVE (ASM-4): a delete needs the agent's CREDENTIAL only (deleteCredentialReady), never the switch or the cap:
 * a disarmed relay (ZK_ANON_RELAY_LIVE off) still takes a removed post off Farcaster. While the credential itself is
 * absent (the key revoked: arm-public-anon.ps1 -Disarm -RevokeKey) nothing is attempted and no attempt is counted — the
 * due rows become 'waiting' and are tried once the key is back, so a revoked key never burns the bounded attempts into a
 * false 'unknown'.
 */
async function deleteDue(db, env = process.env) {
  const out = { tried: 0, deleted: 0 };
  try {
    db.prepare("UPDATE zk_anon_takedowns SET delete_state = 'pending' WHERE mode = 'live' AND decision = 'remove' AND delete_state = 'never-posted' AND cast_hash IN (SELECT cast_hash FROM zk_anon_casts WHERE mode = 'live' AND status = 'relayed' AND network_hash LIKE '0x%')").run();
    const due = db.prepare("SELECT t.cast_hash AS castHash, t.attempts AS attempts, c.network_hash AS networkHash FROM zk_anon_takedowns t JOIN zk_anon_casts c ON c.mode = t.mode AND c.cast_hash = t.cast_hash WHERE t.mode = 'live' AND t.decision = 'remove' AND t.delete_state IN ('pending', 'retrying', 'waiting')").all();
    if (!due.length) return out;
    const acct = relayAccount(env);
    const tr = deleteCredentialReady(acct, env) ? anonTransport(acct, env) : null;
    if (!tr) {
      db.prepare("UPDATE zk_anon_takedowns SET delete_state = 'waiting' WHERE mode = 'live' AND decision = 'remove' AND delete_state IN ('pending', 'retrying')").run();
      out.waiting = due.length;
      return out;
    }
    for (const d of due) {
      out.tried++;
      let r = null;
      try {
        r = tr && NETWORK_HASH_RE.test(d.networkHash || "") ? await tr.remove(d.networkHash) : null;
      } catch {
        r = null;
      }
      const attempts = d.attempts + 1;
      let state;
      if (r && r.ok) state = "deleted";
      else if (r && r.status === 404) state = "not-found";
      else state = attempts >= DELETE_MAX_ATTEMPTS ? "unknown" : "retrying";
      if (state === "deleted") out.deleted++;
      db.prepare("UPDATE zk_anon_takedowns SET delete_state = ?, attempts = ? WHERE mode = 'live' AND cast_hash = ? AND decision = 'remove'").run(state, attempts, d.castHash);
    }
  } catch {
    /* tried again on the next pass */
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ 4. reports
const REPORTS_PER_ADDRESS_PER_HOUR = 12;
const reportBuckets = new Map(); // address -> { n, at, casts:Set } (memory only; never stored, never logged)
function report(db, b0, address, now = Date.now()) {
  const b = b0 || {};
  const mode = String(b.mode || "live");
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture or live" } };
  const castHash = String(b.castHash || "").toLowerCase();
  const reason = String(b.reason || "");
  if (!CAST_HASH_RE.test(castHash)) return { status: 400, json: { error: "castHash must be the post's 64-hex hash" } };
  if (!REPORT_REASONS.includes(reason)) return { status: 400, json: { error: "the reason must be one of " + REPORT_REASONS.join(", ") } };
  for (const [k, v] of reportBuckets) if (now - v.at >= HOUR) reportBuckets.delete(k);
  let bucket = reportBuckets.get(address);
  if (!bucket) {
    bucket = { n: 0, at: now, casts: new Set() };
    reportBuckets.set(address, bucket);
  }
  if (bucket.casts.has(mode + ":" + castHash)) return { status: 200, json: { ok: true, already: true } };
  if (bucket.n >= REPORTS_PER_ADDRESS_PER_HOUR) return { status: 429, json: { error: "Too many reports from here this hour. Try again later." } };
  const c = db.prepare("SELECT 1 FROM zk_anon_casts WHERE mode = ? AND cast_hash = ? AND status = 'relayed' AND hidden_at IS NULL").get(mode, castHash);
  if (!c) return { status: 404, json: { error: "no anonymous post with that hash is showing" } };
  db.prepare("INSERT INTO zk_anon_reports (id, mode, cast_hash, reason, created_hour) VALUES (?, ?, ?, ?, ?)").run(randomBytes(16).toString("hex"), mode, castHash, reason, hourGrain(now));
  bucket.n++;
  bucket.casts.add(mode + ":" + castHash);
  return { status: 201, json: { ok: true } };
}

// ------------------------------------------------------------------------------------------------ 6. the one-cast read
function oneCast(db, q) {
  const mode = String(q.mode || "live");
  const hash = String(q.hash || "").toLowerCase();
  if (!isMode(mode)) return { status: 400, json: { error: "mode must be fixture or live" } };
  const byCast = CAST_HASH_RE.test(hash);
  const byNetwork = NETWORK_HASH_RE.test(hash);
  if (!byCast && !byNetwork) return { status: 400, json: { error: "hash must be a 64-hex cast hash or a 0x network hash" } };
  const r = db
    .prepare("SELECT cast_hash, text, epoch, relayed_at, network_hash, fid, tree FROM zk_anon_casts WHERE mode = ? AND status = 'relayed' AND hidden_at IS NULL AND " + (byCast ? "cast_hash = ?" : "network_hash = ?"))
    .get(mode, hash);
  if (!r) return { status: 404, json: { error: "no anonymous post with that hash is showing" } };
  return { status: 200, json: { cast: { castHash: r.cast_hash, hash: r.network_hash, text: r.text, at: r.relayed_at, fid: r.fid, tree: r.tree ?? null, castUrl: mode === "live" ? castUrlFor(r.network_hash) : null } } };
}

// ------------------------------------------------------------------------------------------------ the public status
/** the public half of the relay's state (names and booleans only — never a value, never a count that is an oracle) */
function publicStatus(db, mode, env = process.env, devHooks = false) {
  const acct = relayAccount(env);
  const ready = relayReady(acct);
  let domain = null;
  try {
    domain = new URL(String(env.APP_URL || "")).host || null;
  } catch {
    domain = null;
  }
  const src = chainSource(env);
  return {
    mode,
    // PUBLIC GO-LIVE (ASM-4): whether a moderator's removal can reach Farcaster right now (the credential alone — true while
    // the relay's switch is off, false once the key is revoked)
    // THE HUB ROUTE: on the hub transport also the node's host and the last submit the node refused (its own words, the
    // hour) — so a failed post is visible to the owner (-Status), never silent; never the key, only its public fingerprint
    relay: {
      kind: acct.kind,
      ready: mode === "live" ? ready : true,
      transport: transportKind(env).kind,
      problems: acct.kind === "agent" ? acct.problems : [],
      deletesReady: mode === "live" ? deleteCredentialReady(acct, env) : true,
      ...(acct.transport === "hub" ? { hub: acct.hubBase ? new URL(acct.hubBase).host : null, signerFingerprint: acct.keyFingerprint, lastSubmitError } : {}),
    },
    fidGate: { on: fidGateOn(env), domain, chain: src.rpcBad || src.hubBad ? "bad_config" : src.hub ? "hub+rpc" : "rpc" },
    moderated: moderators(env, devHooks).length > 0,
    moderators: moderators(env, devHooks),
    filter: "on",
    reportReasons: REPORT_REASONS,
  };
}
/** the extra fields /zk/anon-post/config carries (validator/zk.js adds them to its public shape) */
function configFields(db, mode, env = process.env, devHooks = false) {
  return { fidGate: fidGateOn(env), moderated: moderators(env, devHooks).length > 0, filter: "on", relayKind: relayAccount(env).kind };
}

// ------------------------------------------------------------------------------------------------ the routes
function mountAnonPublic(app, db, opts = {}) {
  const devHooks = opts.devHooks === true;
  const trustProxy = () => process.env.TRUST_PROXY === "true";
  const addressOf = (req) => edgeClientAddress(req, trustProxy());
  const send = (res, r) => res.status(r.status).json(r.json);
  app.get("/zk/anon-cast", (req, res) => send(res, oneCast(db, req.query || {})));
  // THE HUB ROUTE: @anon's casts as the protocol has them (keyless reads of FC_HUB_URL), hidden rows left out
  app.get("/zk/anon/network-casts", async (req, res) => send(res, await networkCasts(db, req.query || {})));
  app.get("/zk/anon/network-cast", async (req, res) => send(res, await networkCast(db, req.query || {})));
  app.get("/zk/anon/public-status", (req, res) => {
    const mode = String((req.query || {}).mode || "live");
    if (!isMode(mode)) return res.status(400).json({ error: "mode must be fixture or live" });
    res.json(publicStatus(db, mode, process.env, devHooks));
  });
  app.get("/zk/anon/moderators", (req, res) => res.json({ moderators: moderators(process.env, devHooks) }));
  app.post("/zk/anon/report", (req, res) => send(res, report(db, req.body, addressOf(req))));
  app.get("/zk/anon/moderation", (req, res) => send(res, review(db, req.query || {}, { devHooks })));
  app.post("/zk/anon/moderation", (req, res) => send(res, decide(db, req.body, { devHooks })));
  // the fid gate's join: a per-address budget (memory only) on top of the validator's own token bucket
  const joinBuckets = new Map();
  app.post("/zk/anon/fid-join", async (req, res) => {
    const now = Date.now();
    const a = addressOf(req);
    for (const [k, v] of joinBuckets) if (now - v.at >= HOUR) joinBuckets.delete(k);
    const bk = joinBuckets.get(a) || { n: 0, at: now };
    if (bk.n >= 20) return res.status(429).json({ error: JOIN_SENTENCES.rate, code: "fid-join-rate" });
    bk.n++;
    joinBuckets.set(a, bk);
    send(res, await fidJoin(db, req.body, process.env, now));
  });
  // ASM-5: leaving the crowd (signed by the joined identity), with its own per-address budget (memory only)
  const leaveBuckets = new Map();
  app.post("/zk/anon/fid-leave", (req, res) => {
    const now = Date.now();
    const a = addressOf(req);
    for (const [k, v] of leaveBuckets) if (now - v.at >= HOUR) leaveBuckets.delete(k);
    const bk = leaveBuckets.get(a) || { n: 0, at: now };
    if (bk.n >= 20) return res.status(429).json({ error: LEAVE_SENTENCES.rate, code: "fid-leave-rate" });
    bk.n++;
    leaveBuckets.set(a, bk);
    send(res, fidLeave(db, req.body, process.env, now));
  });
  // ---- the rig's hooks (ZK_DEV_HOOKS=true only) ----
  app.post("/zk/anon/dev/moderator", (req, res) => {
    if (!devHooks) return res.status(403).json({ error: "anon dev hooks are disabled (ZK_DEV_HOOKS)" });
    const pubkey = String((req.body || {}).pubkey || "").toLowerCase();
    if (!PUBKEY_RE.test(pubkey) || !isUsablePubkey(pubkey)) return res.status(400).json({ error: "pubkey must be a usable 64-hex Ed25519 key" });
    devModerators.add(pubkey);
    res.status(201).json({ ok: true, moderators: moderators(process.env, true) });
  });
  app.post("/zk/anon/dev/delete-now", async (req, res) => {
    if (!devHooks) return res.status(403).json({ error: "anon dev hooks are disabled (ZK_DEV_HOOKS)" });
    res.json({ ok: true, ...(await deleteDue(db)) });
  });
  // THE DELETE LOOP: every minute, the deletes that are due (bounded attempts per row; nothing is ever retried forever)
  let inFlight = null;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = deleteDue(db).finally(() => {
      inFlight = null;
    });
  }, 60_000);
  if (timer.unref) timer.unref();
}

/** a rig reset forgets the fixture universe's reports, decisions and filter log (validator/zk.js /zk/dev/reset calls it) */
function resetFixture(db, mode = "fixture") {
  for (const t of ["zk_anon_reports", "zk_anon_takedowns", "zk_anon_filter_log", "zk_anon_fid_members"]) db.prepare(`DELETE FROM ${t} WHERE mode = ?`).run(mode);
  devModerators.clear();
}

module.exports = {
  mountAnonPublic,
  relayAccount,
  relayReady,
  deleteCredentialReady,
  dropPendingOnDisarm,
  liveWebDoorOpen,
  anonTransport,
  neynarBase,
  transportKind,
  relayHub,
  networkCasts,
  networkCast,
  agentLifetimeCap,
  fidGateOn,
  fidGateMembers,
  joinNonceFor,
  parseSiwe,
  recoverPersonalSign,
  idOfCallData,
  keyDataOfCallData,
  chainSource,
  fidJoin,
  JOIN_SENTENCES,
  fidLeave,
  fidLeaveMessage,
  LEAVE_SENTENCES,
  RESERVED_LIVE_ISSUERS,
  issuerRegistrationRefusal,
  recordFilterRefusal,
  takedownCanonical,
  reviewCanonical,
  moderators,
  review,
  decide,
  deleteDue,
  DELETE_MAX_ATTEMPTS,
  report,
  REPORT_REASONS,
  REPORTS_PER_ADDRESS_PER_HOUR,
  oneCast,
  publicStatus,
  configFields,
  castUrlFor,
  resetFixture,
  // tests only: forget the process-memory state (the replay set, the report budgets, the chain-id latch)
  __resetForTests() {
    seenJoinMessages.clear();
    reportBuckets.clear();
    devModerators.clear();
    chainIdChecked = false;
    hubTimestamps.clear();
    lastSubmitError = null;
  },
};
