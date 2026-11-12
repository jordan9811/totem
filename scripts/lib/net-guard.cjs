"use strict";
// PERSONA LAUNCH P8 — THE NETWORK GUARD, a `--require` preload for a test process (never a deployment).
//
//   NODE_OPTIONS="--require ./scripts/lib/net-guard.cjs" NET_GUARD_LOG=<file> [NET_GUARD_SELFTEST=1] node validator/server.js
//
// What it is for: scripts/accept-x-outbox.mjs runs a rig-shaped validator through the whole X outbox flow (submit →
// moderate → relay → posted) and must show that NOTHING left the machine — not "no X call was seen in our code", but no
// non-loopback connection of any kind from that process. So every way a Node process reaches the network is wrapped here
// BEFORE the process's own code loads: net.Socket.prototype.connect (every TCP socket — net.connect, http, https and
// undici's fetch all end there), tls.connect, globalThis.fetch and dns.lookup. A destination that is not loopback is
// RECORDED (one JSON line in NET_GUARD_LOG: kind, host, port, the time) and REFUSED (the socket is destroyed with an error
// on the next tick, the fetch rejects, the lookup fails) — the process keeps running, so a subsystem that tried to reach
// out is caught in the log rather than crashing the run. Loopback (127.0.0.0/8, ::1, localhost) and local IPC paths pass.
//
// THE POSITIVE CONTROL: with NET_GUARD_SELFTEST=1 the guard, on load, tries one socket and one fetch to TEST-NET-3
// (203.0.113.7, a documentation address that routes nowhere) and records both with selftest: true. A suite that reads the
// log requires those entries — proof that the guard was loaded and records — and requires NOTHING else.
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const fs = require("node:fs");

const LOG = process.env.NET_GUARD_LOG || "";
const entries = [];
let selftesting = false;

function isLoopbackHost(host) {
  if (host === undefined || host === null || host === "") return true; // node's default host is localhost
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}
function record(kind, host, port) {
  const e = { kind, host: String(host), port: port === undefined ? null : port, at: Date.now(), pid: process.pid, selftest: selftesting };
  entries.push(e);
  if (LOG) {
    try {
      fs.appendFileSync(LOG, JSON.stringify(e) + "\n");
    } catch {
      /* the in-memory list still has it */
    }
  }
  return e;
}
const refusal = (kind, host) => Object.assign(new Error(`net-guard: refused a non-loopback ${kind} to ${host}`), { code: "ENETGUARD" });

/** the (host, port, path) a Socket#connect call names, whatever form its arguments take */
function destinationOf(args) {
  let a = args;
  // net.connect hands Socket#connect node's normalized form: [[options, cb], ...] with an internal marker
  if (Array.isArray(a[0])) a = a[0];
  const first = a[0];
  if (first && typeof first === "object") return { host: first.host ?? first.hostname, port: first.port, path: first.path };
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) return { host: typeof a[1] === "string" ? a[1] : undefined, port: Number(first), path: undefined };
  if (typeof first === "string") return { host: undefined, port: undefined, path: first }; // an IPC path
  return { host: undefined, port: undefined, path: undefined };
}

// ---- every TCP socket
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const d = destinationOf(args);
  if (d.path === undefined && !isLoopbackHost(d.host)) {
    record("socket", d.host, d.port);
    process.nextTick(() => this.destroy(refusal("socket", d.host)));
    return this;
  }
  return origConnect.apply(this, args);
};

// ---- tls.connect (it builds its socket itself; refused before it does)
const origTlsConnect = tls.connect;
tls.connect = function guardedTlsConnect(...args) {
  const o = args[0] && typeof args[0] === "object" ? args[0] : typeof args[0] === "number" ? { port: args[0], host: typeof args[1] === "string" ? args[1] : undefined } : {};
  const host = o.host ?? o.servername;
  if (!o.socket && !o.path && !isLoopbackHost(host)) {
    record("tls", host, o.port);
    const s = new net.Socket();
    process.nextTick(() => s.destroy(refusal("tls", host)));
    return s;
  }
  return origTlsConnect.apply(this, args);
};

// ---- globalThis.fetch (undici's, which would end at Socket#connect anyway: refused here with a clearer error)
if (typeof globalThis.fetch === "function") {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    let host = "";
    try {
      const u = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      host = u.hostname;
    } catch {
      host = "";
    }
    if (host && !isLoopbackHost(host)) {
      record("fetch", host, undefined);
      return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: refusal("fetch", host) }));
    }
    return origFetch.call(this, input, init);
  };
}

// ---- name lookups (a lookup of a public name is a packet to a resolver: refused and recorded too)
const origLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, options, callback) {
  const cb = typeof options === "function" ? options : callback;
  if (!isLoopbackHost(hostname)) {
    record("dns", hostname, undefined);
    process.nextTick(() => cb(refusal("dns lookup", hostname)));
    return {};
  }
  return origLookup.apply(this, arguments);
};
if (dns.promises && typeof dns.promises.lookup === "function") {
  const origP = dns.promises.lookup;
  dns.promises.lookup = function guardedLookupP(hostname, options) {
    if (!isLoopbackHost(hostname)) {
      record("dns", hostname, undefined);
      return Promise.reject(refusal("dns lookup", hostname));
    }
    return origP.call(this, hostname, options);
  };
}

globalThis.__netGuard = { entries, isLoopbackHost };

// ---- the positive control
if (process.env.NET_GUARD_SELFTEST === "1") {
  selftesting = true;
  try {
    const s = net.connect({ host: "203.0.113.7", port: 9 });
    s.on("error", () => {});
    if (typeof globalThis.fetch === "function") globalThis.fetch("http://203.0.113.7/net-guard-selftest").catch(() => {});
  } finally {
    selftesting = false;
  }
}

module.exports = { entries, isLoopbackHost, destinationOf };
