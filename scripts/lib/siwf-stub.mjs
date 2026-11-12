// PERSONA LAUNCH P1 (SIWF) — A LOOPBACK FARCASTER SIGN-IN RELAY + OPTIMISM JSON-RPC, for the production-shaped suites.
// research/spec-siwf-passkey-first-2026-10-08.txt TESTS C.
//
// Sign in with Farcaster runs IN THE VISITOR'S BROWSER: the device creates the relay channel, polls it and checks the
// account on the chain with eth_call, all from the tab. On the production-shaped pair (scripts/run-prod-shape.sh
// under PRODLIVE_SIWF=stub) the app hands the page FC_SIWF_RELAY_URL / FC_SIWF_RPC_URL = this stub (loopback: the
// only non-default value the device honours), so the whole flow runs against it and nothing reaches Farcaster or
// Optimism. Because the requests come from a BROWSER on another origin (the app is http://localhost:3001), the stub
// answers CORS like the real relay must (preflights for content-type and Authorization).
//
// The contract it serves (the device must keep to it — anything else is a VIOLATION, and the launcher fails the run
// on any violation, even when every suite passed):
//   POST /v1/channel                    {siweUri, domain, nonce, expirationTime, acceptAuthAddress} → {channelToken, url, nonce}
//   GET  /v1/channel/status             Authorization: Bearer <channelToken> → 202 pending | 200 completed
//   POST /v1/channel/authenticate       the SUITE acting as the wallet: {channelToken, message, signature, fid,
//                                       username, displayName, pfpUrl, bio, authMethod} (never the device)
//   POST /                              JSON-RPC: eth_chainId; eth_call IdRegistry.idOf / KeyRegistry.keyDataOf
//   GET  /__stub/state | POST /__stub/reset | POST /__stub/force {rpcDown, relayDown} | POST /__stub/shutdown
// VIOLATIONS: a request carrying a Cookie, a Referer, any x-layers-* header or a device anchor; a channel token in a
// URL; a path or method outside the contract; a channel created without an expirationTime at most ten minutes out;
// a status read without the Bearer token; a JSON-RPC method other than eth_chainId / eth_call; a batched JSON-RPC.
//
// Its accounts are TEST constants (keys derived from fixed strings — they control nothing anywhere):
//   STUB_ACCOUNTS.alice  custody of fid 990777 ("stubalice")    STUB_ACCOUNTS.aliceAuth  her auth address (keyType 2, state 1)
//   STUB_ACCOUNTS.bob    custody of fid 990778 ("stubbob")
// Loopback only; default port 4321; never a port the pairs or other stubs use. Used two ways:
//   * as a process — `node scripts/lib/siwf-stub.mjs serve --port 4321` (run-prod-shape.sh under PRODLIVE_SIWF=stub);
//   * in-process — `startSiwfStub({ port: 0 })`.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
const viem = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

/** ports the stub must never take: the pinned pairs, accept-cu4's probes, the owner-service rig, the M4 live suites,
 *  the Neynar stub */
export const FORBIDDEN_PORTS = new Set([3001, 4001, 3009, 3029, 3011, 3091, 3100, 3101, 4091, 4319]);
export const STUB_DEFAULT_PORT = 4321;
export const TOKEN_PREFIX = "siwf-stub-token-";
/** the Farcaster contracts the device reads (lib/fc/siwf/verify.ts) */
export const ID_REGISTRY = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b";
export const KEY_REGISTRY = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e";
const ID_ABI = [{ type: "function", name: "idOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "fid", type: "uint256" }] }];
const KEY_ABI = [
  {
    type: "function",
    name: "keyDataOf",
    stateMutability: "view",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "key", type: "bytes" },
    ],
    outputs: [{ name: "", type: "tuple", components: [{ name: "state", type: "uint8" }, { name: "keyType", type: "uint32" }] }],
  },
];

const testKey = (label) => viem.keccak256(viem.toBytes("layers-siwf-stub/" + label));
const account = (label) => {
  const key = testKey(label);
  return { key, address: privateKeyToAccount(key).address };
};
export const STUB_ACCOUNTS = {
  alice: { ...account("custody/990777"), fid: 990777, username: "stubalice", displayName: "Stub Alice", pfpUrl: "https://pfp.example.invalid/stubalice.png" },
  aliceAuth: { ...account("auth/990777"), fid: 990777, username: "stubalice", displayName: "Stub Alice", pfpUrl: "https://pfp.example.invalid/stubalice.png" },
  bob: { ...account("custody/990778"), fid: 990778, username: "stubbob", displayName: "Stub Bob", pfpUrl: null },
};

/** the stub's world: custody → fid, and the active auth addresses */
function chainOf() {
  const custody = new Map([
    [STUB_ACCOUNTS.alice.address.toLowerCase(), 990777],
    [STUB_ACCOUNTS.bob.address.toLowerCase(), 990778],
  ]);
  const keyData = new Map([[990777 + "|" + STUB_ACCOUNTS.aliceAuth.address.toLowerCase(), { state: 1, keyType: 2 }]]);
  return { custody, keyData };
}

export function createSiwfStub({ log = (s) => console.log("[siwf-stub] " + s), onShutdown = () => {} } = {}) {
  const chain = chainOf();
  const st = { startedAt: Date.now(), requests: [], violations: [], channels: new Map(), force: { rpcDown: 0, relayDown: 0 }, n: 0 };
  const reset = () => {
    st.requests = [];
    st.violations = [];
    st.channels = new Map();
    st.force = { rpcDown: 0, relayDown: 0 };
  };
  const counts = () => {
    const c = { channelPosts: 0, statusGets: 0, authenticates: 0, chainId: 0, idOf: 0, keyDataOf: 0, otherCalls: 0, preflights: 0 };
    for (const r of st.requests) {
      if (r.kind === "channel") c.channelPosts++;
      else if (r.kind === "status") c.statusGets++;
      else if (r.kind === "authenticate") c.authenticates++;
      else if (r.kind === "rpc" && r.what === "eth_chainId") c.chainId++;
      else if (r.kind === "rpc" && r.what === "idOf") c.idOf++;
      else if (r.kind === "rpc" && r.what === "keyDataOf") c.keyDataOf++;
      else if (r.kind === "rpc") c.otherCalls++;
      else if (r.kind === "preflight") c.preflights++;
    }
    return c;
  };
  const snapshot = () => ({
    ok: true,
    startedAt: st.startedAt,
    counts: counts(),
    requests: st.requests.map((r) => ({ ...r })),
    violations: st.violations.map((v) => ({ ...v })),
    // the newest first; the token is a TEST token (this stub's own), served so the suite can act as the wallet
    channels: [...st.channels.entries()].reverse().map(([token, c]) => ({ token, nonce: c.nonce, domain: c.domain, siweUri: c.siweUri, expirationTime: c.expirationTime, createdAt: c.createdAt, completed: !!c.completed })),
    force: { ...st.force },
  });
  const violation = (entry, kind, detail) => {
    st.violations.push({ n: entry.n, kind, path: entry.path, detail: detail ?? null });
    log(`VIOLATION #${entry.n} ${kind} — ${entry.method} ${entry.path}${detail ? " (" + detail + ")" : ""}`);
  };

  function cors(req) {
    const origin = req.headers.origin;
    return origin
      ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600", vary: "origin" }
      : {};
  }
  const send = (req, res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text), ...cors(req) });
    res.end(text);
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let t = "";
      req.on("data", (b) => (t += b));
      req.on("end", () => resolve(t));
    });
  const parse = (t) => {
    try {
      return t ? JSON.parse(t) : {};
    } catch {
      return null;
    }
  };

  /** what no request from the device may carry (the device's validator headers, cookies, its page address) */
  function hygiene(req, entry, u) {
    if (req.headers.cookie) violation(entry, "cookie");
    if (req.headers.referer) violation(entry, "referer", "the device sends no-referrer");
    for (const h of Object.keys(req.headers)) if (h.startsWith("x-layers-")) violation(entry, "x-layers-header", h);
    if (/anchor|device-proof/i.test(Object.keys(req.headers).join(","))) violation(entry, "device-anchor");
    const q = u.search + u.pathname;
    if (q.includes(TOKEN_PREFIX)) violation(entry, "token-in-url");
  }

  async function rpc(req, res, entry) {
    const body = parse(await readBody(req));
    if (Array.isArray(body)) {
      violation(entry, "rpc-batch");
      return send(req, res, 400, { error: "no batches" });
    }
    if (!body || typeof body.method !== "string") return send(req, res, 400, { error: "not JSON-RPC" });
    const id = body.id ?? null;
    let what = body.method;
    if (body.method === "eth_call") {
      const call = (body.params ?? [])[0] ?? {};
      const to = String(call.to ?? "").toLowerCase();
      if (to === ID_REGISTRY.toLowerCase()) what = "idOf";
      else if (to === KEY_REGISTRY.toLowerCase()) what = "keyDataOf";
      else what = "eth_call:other";
    } else if (body.method !== "eth_chainId") {
      violation(entry, "rpc-method", body.method);
    }
    entry.kind = "rpc";
    entry.what = what;
    if (st.force.rpcDown > 0) {
      st.force.rpcDown--;
      return send(req, res, 503, { error: "forced down" });
    }
    if (body.method === "eth_chainId") return send(req, res, 200, { jsonrpc: "2.0", id, result: "0xa" });
    if (what === "idOf") {
      try {
        const d = viem.decodeFunctionData({ abi: ID_ABI, data: body.params[0].data });
        const fid = chain.custody.get(String(d.args[0]).toLowerCase()) ?? 0;
        return send(req, res, 200, { jsonrpc: "2.0", id, result: viem.encodeFunctionResult({ abi: ID_ABI, functionName: "idOf", result: BigInt(fid) }) });
      } catch {
        return send(req, res, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "bad idOf call" } });
      }
    }
    if (what === "keyDataOf") {
      try {
        const d = viem.decodeFunctionData({ abi: KEY_ABI, data: body.params[0].data });
        const fid = Number(d.args[0]);
        const address = "0x" + String(d.args[1]).toLowerCase().slice(-40);
        const kd = chain.keyData.get(fid + "|" + address) ?? { state: 0, keyType: 0 };
        return send(req, res, 200, { jsonrpc: "2.0", id, result: viem.encodeFunctionResult({ abi: KEY_ABI, functionName: "keyDataOf", result: kd }) });
      } catch {
        return send(req, res, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "bad keyDataOf call" } });
      }
    }
    // no contract wallets here: a deployless ERC-6492 call reverts (the device reads that as "not valid")
    return send(req, res, 200, { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted" } });
  }

  async function relay(req, res, entry, u) {
    if (req.method === "POST" && u.pathname === "/v1/channel") {
      entry.kind = "channel";
      const b = parse(await readBody(req));
      if (!b || typeof b.nonce !== "string" || typeof b.domain !== "string" || typeof b.siweUri !== "string") return send(req, res, 400, { error: "bad channel request" });
      const exp = Date.parse(String(b.expirationTime ?? ""));
      if (!Number.isFinite(exp) || exp > Date.now() + 10 * 60_000 + 5_000 || exp <= Date.now()) violation(entry, "channel-expiration", "expirationTime must be present and at most ten minutes out");
      if (b.acceptAuthAddress !== true) violation(entry, "channel-accept-auth-address");
      if (st.force.relayDown > 0) {
        st.force.relayDown--;
        return send(req, res, 503, { error: "forced down" });
      }
      const token = TOKEN_PREFIX + randomBytes(12).toString("hex");
      st.channels.set(token, { nonce: b.nonce, domain: b.domain, siweUri: b.siweUri, expirationTime: b.expirationTime, createdAt: Date.now(), completed: null });
      return send(req, res, 201, { channelToken: token, url: "https://farcaster.xyz/~/siwf?channelToken=" + token, nonce: b.nonce });
    }
    if (req.method === "GET" && u.pathname === "/v1/channel/status") {
      entry.kind = "status";
      const auth = String(req.headers.authorization ?? "");
      if (!auth.startsWith("Bearer ")) {
        violation(entry, "status-without-bearer");
        return send(req, res, 401, { error: "no token" });
      }
      if (st.force.relayDown > 0) {
        st.force.relayDown--;
        return send(req, res, 503, { error: "forced down" });
      }
      const c = st.channels.get(auth.slice(7));
      if (!c) return send(req, res, 401, { error: "unknown channel" });
      if (!c.completed) return send(req, res, 202, { state: "pending", nonce: c.nonce });
      return send(req, res, 200, c.completed);
    }
    if (req.method === "POST" && u.pathname === "/v1/channel/authenticate") {
      entry.kind = "authenticate";
      const b = parse(await readBody(req));
      const c = b && st.channels.get(String(b.channelToken ?? ""));
      if (!c) return send(req, res, 404, { error: "unknown channel" });
      c.completed = {
        state: "completed",
        nonce: c.nonce,
        message: b.message,
        signature: b.signature,
        authMethod: b.authMethod ?? "custody",
        fid: b.fid,
        username: b.username,
        displayName: b.displayName ?? null,
        pfpUrl: b.pfpUrl ?? null,
        bio: b.bio ?? null,
        custody: STUB_ACCOUNTS.alice.address,
        verifications: [],
        metadata: { ip: "127.0.0.1", userAgent: "siwf-stub" },
      };
      return send(req, res, 200, { ok: true });
    }
    violation(entry, "off-contract", req.method + " " + u.pathname);
    return send(req, res, 404, { error: "not in the contract" });
  }

  async function control(req, res, u) {
    const p = u.pathname.slice("/__stub".length);
    if (req.method === "GET" && p === "/state") return send(req, res, 200, snapshot());
    if (req.method === "POST" && p === "/reset") {
      await readBody(req);
      reset();
      return send(req, res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/force") {
      const b = parse(await readBody(req)) ?? {};
      const n = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 50 ? v : 0);
      st.force = { rpcDown: n(b.rpcDown), relayDown: n(b.relayDown) };
      return send(req, res, 200, { ok: true, force: st.force });
    }
    if (req.method === "POST" && p === "/shutdown") {
      send(req, res, 200, { ok: true });
      setTimeout(onShutdown, 50);
      return;
    }
    return send(req, res, 404, { error: "unknown control" });
  }

  return {
    async handle(req, res) {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname.startsWith("/__stub/")) return control(req, res, u);
      const entry = { n: ++st.n, method: req.method, path: u.pathname, kind: "unknown", at: Date.now() };
      st.requests.push(entry);
      if (st.requests.length > 2000) st.requests.splice(0, st.requests.length - 2000);
      if (req.method === "OPTIONS") {
        // a CORS preflight is the browser's, not the device's: answered, counted, never a violation
        entry.kind = "preflight";
        res.writeHead(204, cors(req));
        return res.end();
      }
      hygiene(req, entry, u);
      if (req.method !== "GET" && req.method !== "POST") {
        violation(entry, "method", req.method);
        return send(req, res, 405, { error: "GET and POST only" });
      }
      if (req.method === "POST" && (u.pathname === "/" || u.pathname === "")) return rpc(req, res, entry);
      if (u.pathname.startsWith("/v1/")) return relay(req, res, entry, u);
      violation(entry, "off-contract", req.method + " " + u.pathname);
      return send(req, res, 404, { error: "not in the contract" });
    },
    snapshot,
    reset,
  };
}

export async function startSiwfStub({ port = STUB_DEFAULT_PORT, log } = {}) {
  if (port && FORBIDDEN_PORTS.has(port)) throw new Error("siwf-stub: port " + port + " belongs to a pair or another stub");
  let server;
  const stub = createSiwfStub({ log, onShutdown: () => server && server.close() });
  server = http.createServer((req, res) => {
    stub.handle(req, res).catch(() => {
      try {
        res.writeHead(500);
        res.end();
      } catch {
        /* closed */
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actual = server.address().port;
  return { url: "http://127.0.0.1:" + actual, port: actual, stub, close: () => new Promise((r) => server.close(() => r())) };
}

/** for the suites: a SIWE message for the newest channel, signed by a stub account (the suite acts as the wallet) */
export async function signForChannel(channel, who, { fid = who.fid, issuedAt = new Date() } = {}) {
  const { createSiweMessage } = require("viem/siwe");
  const message = createSiweMessage({
    domain: channel.domain,
    address: who.address,
    statement: "Farcaster Auth",
    uri: channel.siweUri,
    version: "1",
    chainId: 10,
    nonce: channel.nonce,
    issuedAt,
    expirationTime: new Date(channel.expirationTime),
    resources: [`farcaster://fid/${fid}`],
  });
  const signature = await privateKeyToAccount(who.key).signMessage({ message });
  return { message, signature };
}

/** a short fingerprint for logs (never the value) */
export const fingerprint = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8);

// ------------------------------------------------------------------------------------------------ CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === "serve") {
    const i = process.argv.indexOf("--port");
    const port = i > 0 ? Number(process.argv[i + 1]) : STUB_DEFAULT_PORT;
    if (!Number.isSafeInteger(port) || port <= 0 || FORBIDDEN_PORTS.has(port)) {
      console.log("[siwf-stub] refusing port " + process.argv[i + 1] + " (a pinned or another stub's port)");
      process.exit(1);
    }
    const s = await startSiwfStub({ port });
    console.log("[siwf-stub] listening on " + s.url + " (loopback relay + JSON-RPC; test accounts only)");
  } else {
    console.log("usage: node scripts/lib/siwf-stub.mjs serve --port 4321");
    process.exit(1);
  }
}
