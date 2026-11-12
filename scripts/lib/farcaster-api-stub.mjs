// POST AS YOU — A LOOPBACK FARCASTER CLIENT API for tests: the signed key request endpoints the validator calls
// (validator/keyrequest.js), checking what the real service would, independently of the code under test. Nothing here
// touches the real api.farcaster.xyz, a real chain or a real node; every port is loopback, never a pinned one.
//
//   POST /v2/signed-key-requests { key, requestFid, signature, deadline, sponsorship? }
//        key 0x + 64 hex; requestFid registered on the protocol stub's chain; deadline in the future; signature = the
//        EIP-712 SignedKeyRequest (Farcaster SignedKeyRequestValidator, chain 10) recovering to requestFid's CUSTODY on the
//        protocol stub (viem's own recoverTypedDataAddress, not the validator's code); a sponsorship's EIP-191 signature
//        over the raw key request signature must recover to the sponsor fid's custody, and the sponsor must be one the
//        test marked "signed up" → { result: { signedKeyRequest: { token, deeplinkUrl, key, state: "pending" } } }
//        Refusals are shaped like the live service's: 400 { errors: [{ message }] }.
//   GET  /v2/signed-key-request?token=…   the request's state (pending | approved | completed) and userFid once approved
// Steering (tests, in-process): stub.approve(token | "latest", { userFid, complete = true, addKey = true }) — the visitor
// approving in their Farcaster app: with addKey the key becomes ACTIVE for userFid on the protocol stub's chain, so its hub
// lists it (GET /v1/onChainSignersByFid) and accepts messages it signs; addKey false models an approval whose key never
// reached the chain (the device must refuse to enable it). stub.markSponsor(fid), stub.failNext(status, n), stub.requests,
// stub.calls, stub.close().
//
// CLI (the production-shaped pair, scripts/run-prod-shape.sh PRODLIVE_ROOTPOST=stub):
//   node scripts/lib/farcaster-api-stub.mjs serve --port <api port> --hub-port <hub port> --app-fid <fid>
//        starts THIS stub and scripts/lib/farcaster-protocol-stub.mjs (the hub) together; the app account (fid, custody =
//        the PUBLIC test constant TEST_APP_CUSTODY_KEY below) and the SIWF stub's two accounts are seeded on its chain.
//        HTTP steering: POST /__stub/approve { token?, userFid, complete?, addKey? }, POST /__stub/remove-key and
//        /__stub/add-key { userFid, key } (the user removing / re-adding the key in the Farcaster app), GET /__stub/state
//        (requests, calls, the hub's casts and reactions, violations), POST /__stub/shutdown.
//        FOLLOWING FROM THE HUB: `--graph default` plants HUB_DEFAULT_GRAPH (below: @stubalice follows three stub accounts
//        with a handful of casts, a reply among them; @stubbob follows nobody), and the hub's reads are steered over HTTP:
//        POST /__stub/hub/plant { synthetic | profile | cast | follows | follow | reaction | unreact | twoHop }, GET
//        /__stub/hub/foryou-truth?root=&own= (SPEC B: what For You may show under any keyed half), POST /__stub/hub/steer
//        { delayMs?, fail?, rate?, shardedParents?, clear? }, GET /__stub/hub/reads (the read log, the most in flight at once,
//        preflights), POST /__stub/hub/reads/reset,
//        GET /__stub/hub/truth?root=&limit= (the ground-truth timeline), POST /__stub/hub/remove { hash }.
//   node scripts/lib/farcaster-api-stub.mjs app-key       prints TEST_APP_CUSTODY_KEY (a PUBLIC test constant, reaches nothing)
// A violation is anything the design forbids reaching this API: a browser Origin header (the browser never calls it; the
// validator does) or a request that names no key.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { recoverTypedDataAddress, recoverMessageAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { startProtocolStub, FORBIDDEN_PORTS } from "./farcaster-protocol-stub.mjs";

const SKR_DOMAIN = { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" };
const SKR_TYPES = { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] };
/** a PUBLIC test constant: the stub app account's custody key. It signs test key requests that reach nothing. */
export const TEST_APP_CUSTODY_KEY = keccak256(toBytes("totem-test-app-account-custody/v1"));
export const TEST_APP_FID = 990900;
/** the SIWF stub's accounts (scripts/lib/siwf-stub.mjs): the visitors a production-shaped suite signs in as */
export const SIWF_STUB_FIDS = Object.freeze([990777, 990778]);
const lc = (s) => String(s).toLowerCase();

/** FOLLOWING FROM THE HUB — the default graph a SIWF-stub pair's hub holds (`serve --graph default`): @stubalice follows
 *  three stub accounts (the most recently followed last), @stubbob follows nobody. The fids sit below the protocol stub's
 *  registrations (991500 on) and away from the app account (990900). */
export const HUB_DEFAULT_GRAPH = Object.freeze({
  root: 990777,
  empty: 990778,
  people: Object.freeze([
    Object.freeze({ fid: 991101, username: "stubcarol", display: "Stub Carol" }),
    Object.freeze({ fid: 991102, username: "stubdave", display: "Stub Dave" }),
    Object.freeze({ fid: 991103, username: "stubeve", display: "Stub Eve" }),
  ]),
});
export function plantDefaultGraph(protocol, nowMs = Date.now()) {
  const G = HUB_DEFAULT_GRAPH;
  protocol.plantProfile(G.root, { username: "stubalice", display: "Stub Alice", bio: "stub account" });
  protocol.plantProfile(G.empty, { username: "stubbob", display: "Stub Bob", bio: "stub account" });
  for (const p of G.people) protocol.plantProfile(p.fid, { username: p.username, display: p.display, bio: "a stub account on the stub hub" });
  protocol.plantFollows(G.root, G.people.map((p, i) => ({ fid: p.fid, ts: nowMs - (G.people.length - i) * 86_400_000 })));
  const at = (minutesAgo) => {
    const v = nowMs - minutesAgo * 60_000;
    return v - (v % 1000);
  };
  const [carol, dave, eve] = G.people.map((p) => p.fid);
  const first = protocol.plantCast({ fid: carol, ts: at(120), text: "hello from the stub hub", seed: "default:carol:1" });
  protocol.plantCast({ fid: dave, ts: at(90), text: "a post with a link", embeds: [{ url: "https://example.org/a" }], seed: "default:dave:1" });
  const reply = protocol.plantCast({ fid: eve, ts: at(30), text: "replying to carol", parent: { fid: carol, hash: first }, seed: "default:eve:1" });
  protocol.plantCast({ fid: carol, ts: at(10), text: "thanks eve", parent: { fid: eve, hash: reply }, seed: "default:carol:2" });
  return { root: G.root, follows: G.people.length };
}

export async function startFarcasterApiStub({ protocol, port = 0, now = () => Date.now(), control = null } = {}) {
  if (!protocol) throw new Error("startFarcasterApiStub needs the protocol stub (its chain is where custody and keys live)");
  if (FORBIDDEN_PORTS.has(port)) throw new Error("port " + port + " is reserved");
  const requests = []; // { token, key, requestFid, deadline, state, userFid, sponsored, createdAt }
  const calls = [];
  const violations = [];
  const sponsors = new Set();
  const fails = [];
  const forced = () => {
    const f = fails.find((x) => x.n > 0);
    if (!f) return null;
    f.n--;
    return f.status;
  };
  const refuse = (message, status = 400) => ({ status, body: { errors: [{ message }] } });
  const view = (r) => ({ token: r.token, deeplinkUrl: r.deeplinkUrl, key: r.key, state: r.state, ...(r.userFid ? { userFid: r.userFid } : {}) });

  async function create(b) {
    if (!b || typeof b !== "object") return refuse("Invalid body");
    const { key, requestFid, signature, deadline, sponsorship } = b;
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) return refuse("Invalid key");
    if (!Number.isSafeInteger(requestFid) || requestFid <= 0) return refuse("Invalid requestFid");
    const custody = protocol.state.custodyOf.get(requestFid);
    if (!custody) return refuse("requestFid " + requestFid + " is not registered");
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(now() / 1000)) return refuse("Signed key request deadline has passed");
    let rec;
    try {
      rec = lc(await recoverTypedDataAddress({ domain: SKR_DOMAIN, types: SKR_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: BigInt(requestFid), key: lc(key), deadline: BigInt(deadline) }, signature }));
    } catch {
      return refuse("Invalid signature");
    }
    if (rec !== custody) return refuse("Invalid signature: it does not recover to the requestFid's custody address");
    let sponsored = false;
    if (sponsorship !== undefined) {
      const sf = sponsorship && sponsorship.sponsorFid;
      const sc = Number.isSafeInteger(sf) ? protocol.state.custodyOf.get(sf) : null;
      if (!sc) return refuse("Invalid sponsorship: unknown sponsor");
      let srec;
      try {
        srec = lc(await recoverMessageAddress({ message: { raw: signature }, signature: sponsorship.signature }));
      } catch {
        return refuse("Invalid sponsorship signature");
      }
      if (srec !== sc) return refuse("Invalid sponsorship signature");
      if (!sponsors.has(sf)) return refuse("The sponsoring account is not signed up or has fewer than 100 warps");
      sponsored = true;
    }
    const token = "0x" + randomBytes(12).toString("hex");
    const r = { token, deeplinkUrl: "farcaster://signed-key-request?token=" + token, key: lc(key), requestFid, deadline, state: "pending", userFid: null, sponsored, createdAt: now() };
    requests.push(r);
    return { status: 200, body: { result: { signedKeyRequest: view(r) } } };
  }

  const readBody = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
  const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
  const api = {
    requests, calls, violations,
    approve(token, { userFid, complete = true, addKey = true } = {}) {
      const r = token === "latest" ? requests[requests.length - 1] : requests.find((x) => x.token === token);
      if (!r) throw new Error("no such key request in the stub");
      if (!Number.isSafeInteger(userFid) || userFid <= 0) throw new Error("approve needs a userFid");
      r.userFid = userFid;
      r.state = complete ? "completed" : "approved";
      if (addKey && complete) protocol.state.keys.set(userFid + ":" + r.key.slice(2), { state: 1, keyType: 1, at: now() });
      return view(r);
    },
    /** the user removed the key in the Farcaster app (KeyRegistry.remove): the hub stops listing it */
    removeKey(userFid, key) { protocol.state.keys.delete(userFid + ":" + lc(key).replace(/^0x/, "")); },
    markSponsor(fid) { sponsors.add(fid); },
    failNext(status, n = 1) { fails.push({ status, n }); },
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const raw = await readBody(req);
    const p = url.pathname;
    const log = (status, extra = {}) => calls.push({ method: req.method, path: p, status, origin: req.headers.origin ?? null, at: now(), ...extra });
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" }); return res.end(); }
    // the CLI's steering paths (never part of the API; never logged as calls)
    if (control && p.startsWith("/__stub/")) return control(req, res, url, raw, send);
    if (p.startsWith("/v2/") && req.headers.origin) violations.push({ kind: "browser-origin", path: p, detail: "the Farcaster API was called from a page (origin " + req.headers.origin + "); only the validator calls it" });
    const f = p.startsWith("/v2/") ? forced() : null;
    if (f) { log(f); return send(res, f, { errors: [{ message: "the stub was told to fail" }] }); }
    if (p === "/v2/signed-key-requests" && req.method === "POST") {
      let b;
      try { b = JSON.parse(raw.toString("utf8")); } catch { log(400); return send(res, 400, { errors: [{ message: "Invalid JSON" }] }); }
      if (!b || typeof b.key !== "string") violations.push({ kind: "no-key", path: p, detail: "a key request named no key" });
      const r = await create(b);
      log(r.status, { refusal: r.status === 200 ? null : r.body.errors[0].message });
      return send(res, r.status, r.body);
    }
    if (p === "/v2/signed-key-request" && req.method === "GET") {
      const token = url.searchParams.get("token") || "";
      const r = requests.find((x) => x.token === token);
      if (!r) { log(400); return send(res, 400, { errors: [{ message: "No signed key request found with token " + token.slice(0, 40) }] }); }
      log(200);
      return send(res, 200, { result: { signedKeyRequest: view(r) } });
    }
    log(404);
    return send(res, 404, { errors: [{ message: "Not found in the stub" }] });
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((r, j) => { server.once("error", j); server.listen(port, "127.0.0.1", () => { server.off("error", j); r(); }); });
    if (!FORBIDDEN_PORTS.has(server.address().port)) break;
    await new Promise((r) => server.close(r));
  }
  api.base = "http://127.0.0.1:" + server.address().port;
  api.server = server;
  api.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return api;
}

/** the protocol stub with the stub app account (TEST_APP_FID, custody TEST_APP_CUSTODY_KEY) and the SIWF stub's accounts */
export async function startRootPostStubs({ apiPort = 0, hubPort = 0, appFid = TEST_APP_FID, appKey = TEST_APP_CUSTODY_KEY, onShutdown = null, graph = null } = {}) {
  const protocol = await startProtocolStub({ port: hubPort, firstFid: 991500 });
  protocol.seedAccount(appFid, privateKeyToAccount(appKey).address);
  for (const fid of SIWF_STUB_FIDS) protocol.seedAccount(fid, "0x" + fid.toString(16).padStart(40, "0"));
  if (graph === "default") plantDefaultGraph(protocol);
  let apiStub = null;
  const hubState = () => ({
    casts: [...protocol.state.casts.entries()].map(([hash, c]) => ({ hash, fid: c.fid, text: c.text, removed: c.removed, parent: c.parent ?? null })),
    reactions: [...(protocol.state.reactions ?? new Map()).values()].map((r) => ({ fid: r.fid, kind: r.kind === 1 ? "like" : "recast", target: r.target })),
    keys: [...protocol.state.keys.entries()].map(([k, v]) => ({ fidKey: k, state: v.state })),
    submits: protocol.calls.filter((c) => c.path === "/v1/submitMessage").map((c) => ({ status: c.status, submit: c.submit })),
    signerReads: protocol.calls.filter((c) => c.path === "/v1/onChainSignersByFid").length,
  });
  /** the HTTP steering paths (the production-shaped suites drive the stub from another process) */
  const control = async (req, res, url, raw, send) => {
    const body = () => JSON.parse(raw.toString("utf8") || "{}");
    try {
      if (url.pathname === "/__stub/state") return send(res, 200, { appFid, requests: apiStub.requests.map((r) => ({ token: r.token, key: r.key, requestFid: r.requestFid, state: r.state, userFid: r.userFid, sponsored: r.sponsored })), calls: apiStub.calls, violations: apiStub.violations, hub: hubState() });
      if (url.pathname === "/__stub/approve" && req.method === "POST") {
        const b = body();
        return send(res, 200, apiStub.approve(b.token || "latest", { userFid: b.userFid, complete: b.complete !== false, addKey: b.addKey !== false }));
      }
      if (url.pathname === "/__stub/remove-key" && req.method === "POST") {
        const b = body();
        apiStub.removeKey(b.userFid, b.key);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/__stub/add-key" && req.method === "POST") {
        const b = body();
        if (!Number.isSafeInteger(b.userFid) || typeof b.key !== "string" || !/^0x[0-9a-f]{64}$/i.test(b.key)) return send(res, 400, { error: "add-key needs userFid and key" });
        protocol.state.keys.set(b.userFid + ":" + b.key.toLowerCase().slice(2), { state: 1, keyType: 1, at: Date.now() });
        return send(res, 200, { ok: true });
      }
      // FOLLOWING FROM THE HUB: the browser's reads, planted and steered from another process
      if (url.pathname === "/__stub/hub/plant" && req.method === "POST") {
        const b = body();
        if (b.synthetic) return send(res, 200, protocol.plantSynthetic(b.synthetic));
        if (b.profile) return send(res, 200, { ok: true, set: protocol.plantProfile(b.profile.fid, b.profile) ?? true });
        if (b.follows) return send(res, 200, { ok: true, set: protocol.plantFollows(b.follows.fid, b.follows.targets) ?? true });
        if (b.cast) return send(res, 200, { hash: protocol.plantCast({ ts: Date.now() - (Date.now() % 1000), ...b.cast }) });
        // POST AS YOU ON HUB CARDS: a like or recast the account already made elsewhere (the cards' pressed state)
        if (b.reaction) return send(res, 200, { ok: true, set: protocol.plantReaction(b.reaction) ?? true });
        // NOTIFICATIONS FROM FARCASTER: a follower of the root (added to what it follows), and a reaction taken back
        if (b.follow) return send(res, 200, { ok: true, set: protocol.plantFollow(b.follow) ?? true });
        if (b.unreact) return send(res, 200, { ok: true, removed: protocol.removeReaction(b.unreact) });
        // SPEC B (For You from the hub): a deterministic 2-hop graph around a root
        if (b.twoHop) return send(res, 200, protocol.plantTwoHop(b.twoHop));
        return send(res, 400, { error: "plant needs synthetic, profile, follows, follow, cast, reaction, unreact or twoHop" });
      }
      if (url.pathname === "/__stub/hub/steer" && req.method === "POST") {
        const b = body();
        if (b.clear) protocol.clearHubSteering();
        if (Number.isFinite(b.delayMs)) protocol.hubRead.delayMs = b.delayMs;
        if (b.fail) protocol.hubRead.fails.push({ path: b.fail.path ?? "*", fid: b.fail.fid ?? "*", status: b.fail.status ?? 500, n: b.fail.n ?? 1e9 });
        if (b.rate) protocol.hubRead.rate = { n: b.rate.n ?? 1, retryAfter: b.rate.retryAfter ?? 1 };
        if (typeof b.shardedParents === "boolean") protocol.hubRead.shardedParents = b.shardedParents;
        return send(res, 200, { ok: true, delayMs: protocol.hubRead.delayMs, fails: protocol.hubRead.fails.length, rate: protocol.hubRead.rate });
      }
      if (url.pathname === "/__stub/hub/reads") {
        const r = protocol.hubRead;
        return send(res, 200, { reads: r.reads, maxInFlight: r.maxInFlight, inFlight: r.inFlight, preflights: r.preflights });
      }
      if (url.pathname === "/__stub/hub/reads/reset" && req.method === "POST") {
        protocol.resetHubReads();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/__stub/hub/truth") {
        const root = Number(url.searchParams.get("root"));
        return send(res, 200, { casts: protocol.truth(root, { limit: Number(url.searchParams.get("limit") || 100) }) });
      }
      // SPEC B: what For You can show for `root` under ANY keyed half (the tab's is drawn under its vault key, which a
      // suite cannot know): a true superset, each proof exact. `allIn`: the posts it would pick were every account in the
      // half, which is NOT a superset (a half reaches posts it never picks: farcaster-protocol-stub.mjs forYouTruth)
      if (url.pathname === "/__stub/hub/foryou-truth") {
        const root = Number(url.searchParams.get("root"));
        const own = new Set(String(url.searchParams.get("own") || "").split(",").filter(Boolean).map(Number));
        return send(res, 200, { ...protocol.forYouTruth(root, { own, anyHalf: true }), allIn: protocol.forYouTruth(root, { own }).posts.map((p) => p.hash) });
      }
      if (url.pathname === "/__stub/hub/remove" && req.method === "POST") {
        return send(res, 200, { removed: protocol.removeCast(body().hash) });
      }
      if (url.pathname === "/__stub/shutdown" && req.method === "POST") {
        send(res, 200, { ok: true });
        setTimeout(() => (onShutdown ? onShutdown() : null), 50);
        return;
      }
    } catch (e) {
      return send(res, 400, { error: String(e && e.message ? e.message : e) });
    }
    return send(res, 404, { error: "not a stub control path" });
  };
  apiStub = await startFarcasterApiStub({ protocol, port: apiPort, control });
  return { protocol, api: apiStub, appFid, appKey, hubState, close: async () => { await apiStub.close(); await protocol.close(); } };
}

// ---------------------------------------------------------------------------------------------- the CLI
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n, d) => {
    const i = rest.indexOf(n);
    return i >= 0 ? rest[i + 1] : d;
  };
  if (cmd === "app-key") process.stdout.write(TEST_APP_CUSTODY_KEY);
  else if (cmd === "app-fid") process.stdout.write(String(TEST_APP_FID));
  else if (cmd === "serve") {
    let s = null;
    s = await startRootPostStubs({
      apiPort: Number(arg("--port", 0)),
      hubPort: Number(arg("--hub-port", 0)),
      appFid: Number(arg("--app-fid", TEST_APP_FID)),
      graph: arg("--graph", null),
      onShutdown: async () => {
        await s.close();
        process.exit(0);
      },
    });
    console.log("farcaster api stub: " + s.api.base + "  hub stub: " + s.protocol.hubUrl + "  app fid " + s.appFid);
  } else {
    console.error("usage: farcaster-api-stub.mjs serve --port <p> --hub-port <p> [--app-fid <fid>] | app-key | app-fid");
    process.exit(2);
  }
}

