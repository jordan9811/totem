// ZK PASS 1 Gate 1 — a minimal Oblivious HTTP RELAY for tests and demos.
//
// It forwards `message/ohttp-req` bodies to the gateway with NO client
// headers (the relay's whole job is to strip identity and forward
// ciphertext), and proxies the gateway's key configuration on GET /keys.
// It counts what it forwarded so a suite can assert the gateway was
// reached through it. Forwarding uses node:http with an explicit header
// set — never fetch/undici, which would add a user-agent the gateway's
// allowlist refuses.
//
// THIS RELAY IS OPERATOR-RUN. Running it next to the validator provides no
// privacy — see lib/zk/anon/README.md. It exists to exercise the framing.
//
// PERSONA LAUNCH P7: a BROWSER can use it too (the web channel's OHTTP adapter, lib/zk/anon/webChannel.ts): a POST of
// message/ohttp-req is not a CORS-simple request, so the relay answers the preflight and marks its answers readable
// cross-origin — exactly what a third-party relay serving browsers has to do. CORS is the BROWSER-facing side only:
// nothing from the client's request (origin, user-agent, cookies) is forwarded to the gateway, which still sees this
// relay's clean header set. stats.preflights counts the OPTIONS it answered.
import { createServer, request as httpRequest } from "node:http";

function cleanRequest(url, { method, headers = {}, body }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body) h["content-length"] = String(body.length);
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), contentType: res.headers["content-type"] }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

export function startRelay({ port = 0, gateway = `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}` } = {}) {
  const stats = { forwarded: 0, keyFetches: 0, lastStatus: null, preflights: 0 };
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" };
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        stats.preflights++;
        res.writeHead(204, CORS);
        return res.end();
      }
      if (req.method === "GET" && req.url === "/keys") {
        const r = await cleanRequest(gateway + "/zk/ohttp-keys", { method: "GET" });
        stats.keyFetches++;
        res.writeHead(r.status, { ...CORS, "content-type": r.contentType || "application/ohttp-keys", "content-length": r.buf.length });
        return res.end(r.buf);
      }
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        // forward with a CLEAN header set — nothing from the client survives
        const r = await cleanRequest(gateway + "/zk/anon/ohttp", { method: "POST", headers: { "content-type": "message/ohttp-req" }, body });
        stats.forwarded++;
        stats.lastStatus = r.status;
        res.writeHead(r.status, { ...CORS, "content-type": r.contentType || "message/ohttp-res", "content-length": r.buf.length });
        return res.end(r.buf);
      }
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, stats, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const { url } = await startRelay({ port: Number(process.env.RELAY_PORT || 4100), gateway: process.env.GATEWAY || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}` });
  console.log("[relay] listening on " + url + " (operator-run — NOT private)");
}
