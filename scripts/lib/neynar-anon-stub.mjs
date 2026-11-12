// PUBLIC GO-LIVE (the relay track) — A LOOPBACK NEYNAR AND OPTIMISM RPC for the public @anon relay's tests: the validator's
// agent transport (validator/anonpublic.js anonTransport: the signer lookup, POST /v2/farcaster/cast, DELETE
// /v2/farcaster/cast) and the fid gate's keyless chain read (eth_chainId, IdRegistry.idOf, KeyRegistry.keyDataOf).
//
// Why a stub: the relay's whole contract is about WHAT LEAVES THE VALIDATOR — a post exactly once, after its slot, under the
// agent's signer and key, never from the app server; a takedown's DELETE exactly once — and only a server that records
// every request can see that. So this stub:
//   * answers the three Neynar endpoints the relay uses, shaped as the documented responses (docs.neynar.com publish-cast:
//     { success, cast: { hash, author: { fid }, text } }; delete-cast: { success, message }; lookup signer: { status, fid });
//   * REFUSES (401) any request whose x-api-key is not the key it was started with, and records keyOk on every call (a
//     length is never logged, the value never); a signer uuid that is not configured is a 404, an unapproved one says so;
//   * dedupes publishes by their idempotency key (the same idem → the same cast hash, counted as a repeat) and records
//     every call: method, path, the signer uuid's match, the text (it is test text), the target hash, the time;
//   * answers JSON-RPC: eth_chainId (0xa unless told otherwise) and eth_call to the two Farcaster registries from the maps
//     it was given (custody address → fid; fid + auth address → keyData) — anything else is a JSON-RPC error;
//   * can be told to answer the next N requests of a kind with a forced status (a 500, a 404, a timeout) to drive the
//     relay's bounded retries and the takedown's "unknown".
// Loopback only, port 0 by default, never a pinned port. Two ways to use it:
//   * in-process — const stub = await startNeynarAnonStub({ key, signers, custody }); stub.baseUrl / stub.rpcUrl /
//     stub.calls() / stub.failNext(kind, status, n) / stub.close() (validator/test/anonpublic.test.js,
//     scripts/unit-anon-relay.mjs, scripts/accept-anon-prod.mjs's armed section);
//   * as a process — node scripts/lib/neynar-anon-stub.mjs serve --port <p> --key <fake key> --signer <uuid>:<fid>
//     [--custody <0xaddress>:<fid>], steered over HTTP: GET /__stub/state (the call log), POST /__stub/reset,
//     POST /__stub/fail {kind, status, n} (anonpage's suite reuses it this way).
// The fake key must start "anonstub-" so a real key can never be served back by accident.
import http from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PORTS = new Set([3001, 4001, 3023, 3029, 3011, 4319, 4321, 4057, 4063, 3091, 4091, 3009, 4009]);
export const ID_REGISTRY = "0x00000000fc6c5f01fc30151999387bb99a9f489b";
export const KEY_REGISTRY = "0x00000000fc1237824fb747abde0ff18990e59b7e";
/** the 4-byte selectors (keccak256 of the function signature; node's sha3-256 is not keccak, so they are pinned here and
 *  validator/test/anonpublic.test.js checks them against validator/anonpublic.js and viem) */
export const SELECTOR_ID_OF = "0xd94fe832"; // idOf(address)
export const SELECTOR_KEY_DATA_OF = "0xac34cc5a"; // keyDataOf(uint256,bytes)

function readBody(req) {
  return new Promise((res) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => res(Buffer.concat(c).toString("utf8")));
  });
}

/**
 * Start the stub. `signers`: { uuid: { fid, status? } } (status defaults to "approved"); `custody`: { "0xaddr": fid };
 * `authKeys`: { "<fid>:0xaddr": { state, keyType } }; `chainId`: the hex chain id eth_chainId answers ("0xa").
 */
export async function startNeynarAnonStub({ port = 0, key, signers = {}, custody = {}, authKeys = {}, chainId = "0xa", log = null } = {}) {
  if (typeof key !== "string" || !key.startsWith("anonstub-") || !/^[A-Za-z0-9-]{16,80}$/.test(key)) throw new Error("the stub's fake key must start 'anonstub-' and be key-shaped (16-80 of A-Z a-z 0-9 -)");
  if (FORBIDDEN_PORTS.has(port)) throw new Error("port " + port + " is reserved for the pair or another suite");
  const calls = [];
  const fails = []; // { kind, status, n }
  const casts = new Map(); // hash -> { text, fid, deleted }
  const byIdem = new Map(); // idem -> hash
  let seq = 0;
  const forced = (kind) => {
    const f = fails.find((x) => (x.kind === kind || x.kind === "*") && x.n > 0);
    if (!f) return null;
    f.n--;
    return f.status;
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const raw = await readBody(req);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    // ---- steering
    if (url.pathname === "/__stub/state") return json(res, 200, { calls, casts: [...casts.entries()].map(([hash, c]) => ({ hash, ...c })) });
    if (url.pathname === "/__stub/reset" && req.method === "POST") {
      calls.length = 0;
      fails.length = 0;
      casts.clear();
      byIdem.clear();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__stub/fail" && req.method === "POST") {
      fails.push({ kind: String(body?.kind || "*"), status: Number(body?.status || 500), n: Number(body?.n || 1) });
      return json(res, 200, { ok: true });
    }
    // ---- JSON-RPC (the chain): POST / or /rpc
    if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/rpc") && body && body.jsonrpc === "2.0") {
      const entry = { at: Date.now(), kind: "rpc", method: "POST", path: url.pathname, rpc: body.method };
      calls.push(entry);
      const f = forced("rpc");
      if (f) return json(res, f, { error: "forced" });
      if (body.method === "eth_chainId") return json(res, 200, { jsonrpc: "2.0", id: body.id, result: chainId });
      if (body.method === "eth_call") {
        const to = String(body.params?.[0]?.to || "").toLowerCase();
        const data = String(body.params?.[0]?.data || "").toLowerCase();
        if (to === ID_REGISTRY && data.startsWith(SELECTOR_ID_OF)) {
          const addr = "0x" + data.slice(10 + 24, 10 + 64);
          const fid = custody[addr] ?? custody[addr.toLowerCase()] ?? 0;
          entry.call = "idOf";
          return json(res, 200, { jsonrpc: "2.0", id: body.id, result: "0x" + BigInt(fid).toString(16).padStart(64, "0") });
        }
        if (to === KEY_REGISTRY && data.startsWith(SELECTOR_KEY_DATA_OF)) {
          const fid = Number(BigInt("0x" + data.slice(10, 74)));
          const addr = "0x" + data.slice(10 + 64 * 3 + 24, 10 + 64 * 4);
          const kd = authKeys[fid + ":" + addr] ?? { state: 0, keyType: 0 };
          entry.call = "keyDataOf";
          return json(res, 200, { jsonrpc: "2.0", id: body.id, result: "0x" + BigInt(kd.state).toString(16).padStart(64, "0") + BigInt(kd.keyType).toString(16).padStart(64, "0") });
        }
        return json(res, 200, { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "execution reverted" } });
      }
      return json(res, 200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } });
    }
    // ---- Neynar
    const keyOk = req.headers["x-api-key"] === key;
    const entry = { at: Date.now(), kind: "neynar", method: req.method, path: url.pathname, keyOk };
    calls.push(entry);
    if (log) log(req.method + " " + url.pathname + (keyOk ? "" : " (wrong key)"));
    if (!keyOk) return json(res, 401, { code: "Unauthorized", message: "Invalid API key" });
    if (url.pathname === "/v2/farcaster/signer" && req.method === "GET") {
      const uuid = url.searchParams.get("signer_uuid") || "";
      entry.signerKnown = !!signers[uuid];
      const f = forced("signer");
      if (f) return json(res, f, { message: "forced" });
      const s = signers[uuid];
      if (!s) return json(res, 404, { code: "NotFound", message: "Signer not found" });
      const status = s.status || "approved";
      return json(res, 200, { signer_uuid: uuid, public_key: "0x" + "cd".repeat(32), status, fid: status === "approved" ? s.fid : undefined });
    }
    if (url.pathname === "/v2/farcaster/cast" && req.method === "POST") {
      const uuid = String(body?.signer_uuid || "");
      const text = String(body?.text ?? "");
      const idem = typeof body?.idem === "string" ? body.idem : null;
      Object.assign(entry, { op: "publish", signerKnown: !!signers[uuid], text, idem });
      const f = forced("publish");
      if (f) return json(res, f, { message: "forced" });
      const s = signers[uuid];
      if (!s || (s.status || "approved") !== "approved") return json(res, 403, { code: "Forbidden", message: "signer not approved" });
      if (idem && byIdem.has(idem)) {
        entry.repeat = true;
        const h = byIdem.get(idem);
        return json(res, 200, { success: true, cast: { hash: h, author: { fid: casts.get(h).fid }, text: casts.get(h).text } });
      }
      const hash = "0x" + createHash("sha256").update("anonstub|" + ++seq + "|" + text).digest("hex").slice(0, 40);
      casts.set(hash, { text, fid: s.fid, deleted: false });
      if (idem) byIdem.set(idem, hash);
      entry.hash = hash;
      return json(res, 200, { success: true, cast: { hash, author: { fid: s.fid }, text } });
    }
    if (url.pathname === "/v2/farcaster/cast" && req.method === "DELETE") {
      const uuid = String(body?.signer_uuid || "");
      const target = String(body?.target_hash || "");
      Object.assign(entry, { op: "delete", signerKnown: !!signers[uuid], target });
      const f = forced("delete");
      if (f) return json(res, f, { message: "forced" });
      const c = casts.get(target);
      if (!c || c.deleted) return json(res, 404, { code: "NotFound", message: "Cast not found" });
      c.deleted = true;
      return json(res, 200, { success: true, message: "Cast deleted" });
    }
    return json(res, 404, { code: "NotFound", message: "not in the stub" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const actual = server.address().port;
  if (FORBIDDEN_PORTS.has(actual)) {
    await new Promise((r) => server.close(r));
    return startNeynarAnonStub({ port: 0, key, signers, custody, authKeys, chainId, log });
  }
  const base = "http://127.0.0.1:" + actual;
  return {
    port: actual,
    baseUrl: base,
    rpcUrl: base + "/rpc",
    key,
    calls: () => calls.map((c) => ({ ...c })),
    casts: () => [...casts.entries()].map(([hash, c]) => ({ hash, ...c })),
    failNext: (kind, status, n = 1) => fails.push({ kind, status, n }),
    setSigner: (uuid, s) => {
      signers[uuid] = s;
    },
    reset: () => {
      calls.length = 0;
      fails.length = 0;
      casts.clear();
      byIdem.clear();
    },
    close: () => new Promise((r) => {
      server.closeAllConnections?.();
      server.close(r);
    }),
  };
}

// ---- as a process
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === String(process.argv[1]).toLowerCase()) {
  const args = process.argv.slice(2);
  if (args[0] !== "serve") {
    console.log("usage: node scripts/lib/neynar-anon-stub.mjs serve --port <p> --key anonstub-... --signer <uuid>:<fid> [--custody 0x<addr>:<fid>]");
    process.exit(2);
  }
  const opt = (name) => {
    const out = [];
    for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[i + 1]);
    return out;
  };
  const signers = {};
  for (const s of opt("--signer")) {
    const [uuid, fid] = s.split(":");
    signers[uuid] = { fid: Number(fid) };
  }
  const custody = {};
  for (const c of opt("--custody")) {
    const [addr, fid] = c.split(":");
    custody[addr.toLowerCase()] = Number(fid);
  }
  const stub = await startNeynarAnonStub({ port: Number(opt("--port")[0] || 0), key: opt("--key")[0], signers, custody, log: (l) => console.log("[neynar-anon-stub] " + l) });
  console.log("[neynar-anon-stub] listening on " + stub.baseUrl + " (rpc " + stub.rpcUrl + ")");
}
