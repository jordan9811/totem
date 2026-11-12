// PUBLIC PREVIEW Gate 5 (run as BROWSER KEYSTORE PASS Gate 6) — abuse caps where a stranger's cost lands.
//
//   new identities per address per day   POST /device/auth-anchor creations (201s) — VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY (100)
//   signed writes per device per hour    PUT /state/:ns, DELETE /state, POST /events — VALIDATOR_WRITES_PER_DEVICE_PER_HOUR (2000)
//
// Both refuse loudly (429 with a sentence and Retry-After), never queue, and are exempt on the rig (dev hooks).
// Counters are per process instance (A-CU-4-RATE-LIMIT-PER-INSTANCE) and reset on their window. Once a minute the
// module logs ONE aggregate line — counts only, never an address, never a device id (public-preview Gate 5,
// "observability without surveillance").
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * PERSONA LAUNCH GO-LIVE (A-WEB-PROXY-HOP-HEADERS) — THE ADDRESS A LIMIT KEYS ON, behind a declared proxy. Both limiters
 * (validator/server.js's token bucket and the per-address new-identity cap below) used to take the LEFT-most
 * X-Forwarded-For entry. That entry is whatever the client wrote: an edge that appends keeps it, so one client could
 * name a fresh address on every request and get a fresh bucket each time. Now, only under TRUST_PROXY=true:
 *   1. X-Real-IP — Railway documents its edge setting it to the client's address
 *      (docs.railway.com/networking/public-networking/specs-and-limits). Its RIGHT-most entry: should a client's own copy
 *      ever survive beside the edge's (a bug Railway has had), Node joins the two and the edge's comes last.
 *   2. else the RIGHT-most X-Forwarded-For entry — the hop the nearest proxy appended, never a client-chosen one.
 *   3. else (or without TRUST_PROXY) the socket's address, else "local".
 * Empty list entries are skipped. Nothing here is logged or echoed. DELIBERATE DUPLICATE of middleware.ts
 * edgeForwardedAddress (scripts/unit-prover.mjs G9 runs both over the same cases); validator/test/anonweb.test.js proves
 * on a real loopback validator that a forged left-most entry cannot choose its own bucket.
 */
function lastListEntry(v) {
  const parts = String(Array.isArray(v) ? v.join(",") : v == null ? "" : v).split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i].trim();
    if (s) return s;
  }
  return "";
}
function edgeClientAddress(req, trustProxy) {
  const h = (req && req.headers) || {};
  if (trustProxy) {
    const viaEdge = lastListEntry(h["x-real-ip"]) || lastListEntry(h["x-forwarded-for"]);
    if (viaEdge) return viaEdge;
  }
  return (req && req.socket && req.socket.remoteAddress) || "local";
}

function mountCaps(app, { devHooks, trustProxy, log = console } = {}) {
  const rootsPerDay = Number(process.env.VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY || 100);
  const writesPerHour = Number(process.env.VALIDATOR_WRITES_PER_DEVICE_PER_HOUR || 2000);
  const roots = new Map(); // address → { n, at }
  const writes = new Map(); // device id → { n, at }
  const refused = { roots: 0, writes: 0 };
  // PERSONA LAUNCH GO-LIVE: the edge-vouched hop, never the client-written left-most X-Forwarded-For entry
  const address = (req) => edgeClientAddress(req, trustProxy);
  const bucket = (map, key, windowMs) => {
    const now = Date.now();
    let b = map.get(key);
    if (!b || now - b.at >= windowMs) {
      b = { n: 0, at: now };
      map.set(key, b);
    }
    return b;
  };
  const sweep = () => {
    const now = Date.now();
    for (const [k, b] of roots) if (now - b.at >= DAY) roots.delete(k);
    for (const [k, b] of writes) if (now - b.at >= HOUR) writes.delete(k);
  };
  const report = () => {
    pendingReport = null;
    if (refused.roots || refused.writes) {
      log.log("[caps] " + (refused.roots + refused.writes) + " refusal(s) (new identities per address per day: " + refused.roots + ", writes per device per hour: " + refused.writes + ")");
      refused.roots = 0;
      refused.writes = 0;
    }
    sweep();
  };
  // one line per burst, not one per refusal: the first refusal schedules the line a second later, so the count it
  // carries is the burst's. Counts only — never an address, never a device id.
  let pendingReport = null;
  const scheduleReport = () => {
    if (pendingReport) return;
    pendingReport = setTimeout(report, 1000);
    if (pendingReport.unref) pendingReport.unref();
  };
  const timer = setInterval(report, 60_000);
  timer.unref();

  // new identities: count CREATIONS (201), refuse the attempt once the day's count is at the cap
  app.post("/device/auth-anchor", (req, res, next) => {
    if (devHooks) return next();
    const b = bucket(roots, address(req), DAY);
    if (b.n >= rootsPerDay) {
      refused.roots++;
      scheduleReport();
      const retry = Math.max(1, Math.ceil((b.at + DAY - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "daily cap on new identities from this address reached (" + rootsPerDay + " per day) — this preview refuses rather than queues; try again tomorrow or reuse a saved identity" });
    }
    res.on("finish", () => {
      if (res.statusCode === 201) b.n++;
    });
    next();
  });

  // signed writes: keyed by the device id the envelope names (checked downstream); the cap is a budget, not auth
  const writeCap = (req, res, next) => {
    if (devHooks) return next();
    const id = String(req.headers["x-layers-device"] || "");
    if (!id) return next(); // an unsigned write is refused downstream anyway
    const b = bucket(writes, id, HOUR);
    if (b.n >= writesPerHour) {
      refused.writes++;
      scheduleReport();
      const retry = Math.max(1, Math.ceil((b.at + HOUR - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "hourly write cap for this device reached (" + writesPerHour + " per hour) — this preview refuses rather than queues" });
    }
    b.n++;
    next();
  };
  app.put("/state/:ns", writeCap);
  app.delete("/state", writeCap);
  app.post("/events", writeCap);

  return { rootsPerDay, writesPerHour, report, stop: () => clearInterval(timer) };
}

module.exports = { mountCaps, edgeClientAddress, lastListEntry };
