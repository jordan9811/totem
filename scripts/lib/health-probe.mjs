#!/usr/bin/env node
// ATTESTATION PASS Gate 0 — THE RUNNER'S LIVENESS PROBE.
//
//   node scripts/lib/health-probe.mjs <baseUrl> <layers|layers-validator>
//
// Exit 0 and print `commit=… uptime=…s port=… pid=…` ONLY when the process
// on <baseUrl> answers the signed Totem health payload for the named
// app: HTTP 200, JSON, `app` equal to the expectation, a commit, an
// integer uptime, and an Ed25519 signature that verifies over the
// canonical form of exactly those fields under the payload's own key.
// For the validator the key must ALSO be the one /zk/validator-key
// serves. Anything else — a foreign server, a 404, an HTML page, the
// right shape with a wrong signature — is DOWN (exit 1, reason printed).
//
// The canonical form is a deliberate duplicate of lib/health.ts and
// validator/server.js; drift fails the probe, which is the point.
import { createPublicKey, verify } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

const DOMAIN = "layers-health/1";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const APPS = new Set(["layers", "layers-validator"]);

// SMALL-ORDER KEYS ARE NOT KEYS: the runner test's all-zero key + all-zero
// signature VERIFIED under node:crypto for a quarter of all messages (a
// point of order 4 with S = 0). Same check as validator/crypto.js.
const EdPoint = ed25519.Point ?? ed25519.ExtendedPoint;
function isUsablePubkey(pubHex) {
  try {
    if (!/^[0-9a-f]{64}$/.test(pubHex || "")) return false;
    const p = EdPoint.fromHex(pubHex);
    return !p.isSmallOrder() && p.isTorsionFree();
  } catch {
    return false;
  }
}

function verifyEd25519(sigHex, canonical, pubHex) {
  try {
    if (!isUsablePubkey(pubHex) || !/^[0-9a-f]{128}$/.test(sigHex || "")) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(sigHex, "hex"));
  } catch {
    return false;
  }
}

export function healthCanonical(f) {
  return [DOMAIN, f.app, f.commit, f.buildId ?? "-", String(f.startedAt), String(f.uptime), String(f.port), String(f.pid), f.peer ?? "-"].join("|");
}

/** do two base URLs name the same local endpoint? (localhost ≡ 127.0.0.1 ≡ [::1]) */
function samePeer(a, b) {
  try {
    const A = new URL(a);
    const B = new URL(b);
    const host = (u) => (["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname) ? "localhost" : u.hostname);
    const port = (u) => u.port || (u.protocol === "https:" ? "443" : "80");
    return host(A) === host(B) && port(A) === port(B);
  } catch {
    return false;
  }
}

/** pure: is this payload the Totem contract for `expectedApp`? */
export function verifyPayload(p, expectedApp) {
  if (!APPS.has(expectedApp)) return { ok: false, reason: `unknown expectation "${expectedApp}"` };
  if (!p || typeof p !== "object") return { ok: false, reason: "body is not a JSON object" };
  if (p.ok !== true) return { ok: false, reason: "payload does not say ok:true" };
  if (p.app !== expectedApp) return { ok: false, reason: `payload names app "${p.app}" - expected "${expectedApp}"` };
  if (typeof p.commit !== "string" || !p.commit) return { ok: false, reason: "no commit in the payload" };
  if (!Number.isInteger(p.uptime) || p.uptime < 0) return { ok: false, reason: "uptime is not a non-negative integer" };
  if (!Number.isInteger(p.startedAt) || !Number.isInteger(p.port) || !Number.isInteger(p.pid)) return { ok: false, reason: "startedAt/port/pid malformed" };
  if (p.buildId !== null && typeof p.buildId !== "string") return { ok: false, reason: "buildId malformed" };
  if (typeof p.peer !== "string" || !p.peer) return { ok: false, reason: "no peer in the payload" };
  const fields = { app: p.app, commit: p.commit, buildId: p.buildId, startedAt: p.startedAt, uptime: p.uptime, port: p.port, pid: p.pid, peer: p.peer };
  if (!verifyEd25519(p.sig, healthCanonical(fields), p.pubkey)) return { ok: false, reason: "signature does not verify over the canonical health fields" };
  return { ok: true, reason: "", summary: `commit=${p.commit.slice(0, 7)} uptime=${p.uptime}s port=${p.port} pid=${p.pid}${p.buildId ? " build=" + p.buildId : ""}${p.peer !== "-" ? " peer=" + p.peer : ""}` };
}

// node:http with NO agent (one socket per request, closed with the
// response) rather than fetch: undici's keep-alive socket plus an early
// process.exit trips a libuv assertion on Windows (src\win\async.c:76,
// exit 127) — the probe reported the validator DOWN after verifying it.
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", agent: false, headers: { accept: "application/json", connection: "close" } }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(buf);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, json });
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout after " + timeoutMs + " ms"), { name: "AbortError" })));
    req.on("error", reject);
    req.end();
  });
}

/**
 * `expectPeer`: for the APP, the validator base URL the runner is about to
 * test against. The app's payload names the validator it is configured to
 * talk to; when that is not the same endpoint the app is DOWN for this
 * run — a misconfigured app (a stale VALIDATOR_URL in .env.local) must
 * read as a runner refusal, never as fifty suites failing one by one.
 */
export async function probe(base, expectedApp, { timeoutMs = 15000, expectPeer = null } = {}) {
  const root = String(base || "").replace(/\/+$/, "");
  const url = root + (expectedApp === "layers-validator" ? "/health" : "/api/health");
  let r;
  try {
    r = await getJson(url, timeoutMs);
  } catch (e) {
    return { ok: false, reason: `unreachable: ${e && e.name === "AbortError" ? "timeout after " + timeoutMs + " ms" : (e && e.message) || String(e)}` };
  }
  if (r.status !== 200) return { ok: false, reason: `HTTP ${r.status} from ${url}` };
  const v = verifyPayload(r.json, expectedApp);
  if (!v.ok) return v;
  if (expectedApp === "layers" && expectPeer && !samePeer(r.json.peer, expectPeer)) {
    return { ok: false, reason: `app is configured to talk to a validator at ${r.json.peer} but the validator under test is ${expectPeer} - fix VALIDATOR_URL (a stale .env.local?)` };
  }
  if (expectedApp === "layers-validator") {
    // the validator's key is persistent and served separately: the health
    // signature must be under THAT key, not merely under a key it carries
    try {
      const k = await getJson(root + "/zk/validator-key", timeoutMs);
      if (k.status !== 200 || !k.json || k.json.pubkey !== r.json.pubkey) return { ok: false, reason: "health payload key is not the served validator key" };
    } catch (e) {
      return { ok: false, reason: "validator key unreachable: " + ((e && e.message) || String(e)) };
    }
  }
  return v;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, app, ...rest] = process.argv.slice(2);
  if (!base || !app) {
    console.error("usage: health-probe.mjs <baseUrl> <layers|layers-validator> [--peer=<validatorBaseUrl>]");
    process.exit(2);
  }
  const peerArg = rest.find((x) => x.startsWith("--peer="));
  const r = await probe(base, app, { expectPeer: peerArg ? peerArg.slice(7) : null });
  console.log(r.ok ? r.summary : "DOWN: " + r.reason);
  // exitCode, not exit(): let the loop drain (see getJson)
  process.exitCode = r.ok ? 0 : 1;
}
