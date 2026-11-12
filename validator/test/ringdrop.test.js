"use strict";
// PERSONA LAUNCH P4 — the ring drop (validator/ringdrop.js), in-memory DB, real HTTP on an ephemeral loopback port.
// Device keys are minted with node:crypto's Ed25519 — a second implementation against the validator's verify path, as
// validator/test/device.test.js does — and the canonical forms are DELIBERATE DUPLICATES of validator/crypto.js.
// Every refusal below has its positive control (a correctly signed, correctly shaped batch IS accepted), so none of
// them can pass because the route refuses everything.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign: cryptoSign, createHash, randomBytes } = require("node:crypto");
// PERSONA LAUNCH P4 (W2-RINGS-DROP-FILL-DOS): the per-ADDRESS occupancy rule is keyed by the client address; behind a
// configured proxy that is X-Forwarded-For, so each case below writes from its own address and none shares a budget
// with the rows earlier cases left on the table. Set before the app mounts (ringdrop.js reads it at mount).
process.env.TRUST_PROXY = "true";
const { createApp } = require("../server");

let server;
let base;
let db;

before(async () => {
  const made = createApp(":memory:");
  db = made.db;
  await new Promise((resolve) => {
    server = made.app.listen(0, "127.0.0.1", resolve);
  });
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => server.close());

const CT_HEX = 8224;
const hex = (n) => randomBytes(n).toString("hex");
const nowHour = () => Math.floor(Date.now() / 3_600_000);
const delHashOf = (tokenHex) => createHash("sha256").update(Buffer.from(tokenHex, "hex")).digest("hex");
function mkKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}
const signHex = (canonical, privateKey) => cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");
const delegationCanonical = (d) => ["layers-device-delegation/1", d.deviceId, d.devicePubKey, d.scopes.join(","), String(d.issuedAt), String(d.expiresAt ?? "")].join("|");
const envelopeCanonical = (ns, bodyHash, counter) => ["layers-envelope/1", ns, bodyHash, String(counter)].join("|");

async function raw(method, path, bodyText, headers = {}) {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: bodyText });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** one registered device under its own anchor, with a monotonic envelope counter; `address` = the X-Forwarded-For it
 *  writes from (a fresh one per device unless a case shares it on purpose) */
async function device(address = "10." + [1, 2, 3].map(() => randomBytes(1)[0]).join(".")) {
  const anchor = mkKeys();
  const dev = mkKeys();
  const deviceId = "dev_ring_" + hex(4);
  assert.equal((await raw("POST", "/device/auth-anchor", JSON.stringify({ pubkey: anchor.pubHex }))).status, 201);
  const b = { v: 1, deviceId, devicePubKey: dev.pubHex, scopes: ["state-write"], issuedAt: Date.now(), expiresAt: null };
  const delegation = { ...b, signature: signHex(delegationCanonical(b), anchor.privateKey) };
  assert.equal((await raw("POST", "/device/register", JSON.stringify({ delegation, anchorPubKey: anchor.pubHex }))).status, 201);
  let counter = 1000;
  return {
    deviceId,
    address,
    put: async (body, opts = {}) => {
      const text = JSON.stringify(body);
      const bodyHash = createHash("sha256").update(opts.signOver ?? text).digest("hex");
      counter++;
      const headers = opts.unsigned ? {} : { "x-layers-device": deviceId, "x-layers-counter": String(counter), "x-layers-sig": signHex(envelopeCanonical(opts.ns ?? "rings:drop", bodyHash, counter), (opts.key ?? dev).privateKey) };
      return raw("PUT", "/rings/drop/batch", text, { ...headers, "x-forwarded-for": address });
    },
  };
}
/** run fn with env overrides, restoring them after */
async function withEnv(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function row(overrides = {}) {
  const token = hex(32);
  return { row: { id: hex(16), enc: hex(32), ct: hex(CT_HEX / 2), hint: hex(2), expiresHour: nowHour() + 72, delHash: delHashOf(token), ...overrides }, token };
}
const rows = (n, o) => Array.from({ length: n }, () => row(o));
const count = () => db.prepare("SELECT COUNT(*) AS n FROM ring_drop").get().n;

test("the table: exactly six columns and NO writer, device, anchor or mode column", () => {
  const cols = db.prepare("PRAGMA table_info(ring_drop)").all().map((c) => c.name).sort();
  assert.deepEqual(cols, ["ct", "del_hash", "enc", "expires_hour", "hint", "id"]);
});

test("a signed batch of 4 is accepted (the positive control) and served back with exactly five fields, no-store", async () => {
  const d = await device();
  const before_ = count();
  const four = rows(4);
  const r = await d.put({ rows: four.map((x) => x.row), deletes: [] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.inserted, 4);
  assert.equal(count(), before_ + 4);
  const g = await raw("GET", "/rings/drop");
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("cache-control"), "no-store");
  assert.equal(g.json.count, g.json.rows.length);
  for (const x of g.json.rows) assert.deepEqual(Object.keys(x).sort(), ["ct", "enc", "expiresHour", "hint", "id"]);
  const ids = new Set(g.json.rows.map((x) => x.id));
  for (const x of four) assert.ok(ids.has(x.row.id), "a row written is not served");
  // the drop never serves a delete hash
  assert.ok(!JSON.stringify(g.json).includes(four[0].row.delHash));
});

test("unsigned, wrongly signed, signed over another body or under another namespace: refused (401/403/409), nothing stored", async () => {
  const d = await device();
  const before_ = count();
  const body = { rows: rows(4).map((x) => x.row), deletes: [] };
  const unsigned = await d.put(body, { unsigned: true });
  assert.equal(unsigned.status, 401);
  const wrongKey = await d.put(body, { key: mkKeys() });
  assert.ok([401, 403].includes(wrongKey.status), "wrong key: " + wrongKey.status);
  const otherBody = await d.put(body, { signOver: JSON.stringify({ rows: [], deletes: [] }) });
  assert.ok([401, 403].includes(otherBody.status), "signed over another body: " + otherBody.status);
  const otherNs = await d.put(body, { ns: "custody" });
  assert.ok([401, 403].includes(otherNs.status), "another namespace: " + otherNs.status);
  assert.equal(count(), before_);
  // positive control on the same device
  assert.equal((await d.put(body)).status, 201);
});

test("rows come in multiples of 4 (3 and 5 refused, 8 accepted); every shape exact; the lease at most 72 hours plus 2 of clock slack", async () => {
  const d = await device();
  for (const n of [1, 3, 5, 6]) assert.equal((await d.put({ rows: rows(n).map((x) => x.row), deletes: [] })).status, 400, n + " rows");
  const bad = [
    { ct: hex(CT_HEX / 2 - 1) },
    { ct: hex(CT_HEX / 2) + "00" },
    { enc: hex(31) },
    { hint: "zzzz" },
    { id: hex(15) },
    { delHash: "x" },
    { expiresHour: nowHour() },
    { expiresHour: nowHour() + 75 },
    { expiresHour: nowHour() + 169 },
    { expiresHour: 1.5 },
    { extra: 1 },
  ];
  for (const o of bad) {
    const four = rows(4).map((x) => x.row);
    four[2] = { ...four[2], ...o };
    assert.equal((await d.put({ rows: four, deletes: [] })).status, 400, "bad shape accepted: " + Object.keys(o)[0]);
  }
  assert.equal((await d.put({ rows: rows(4).map((x) => x.row), deletes: [], more: 1 })).status, 400);
  assert.equal((await d.put({ rows: rows(8, { expiresHour: nowHour() + 74 }).map((x) => x.row), deletes: [] })).status, 201);
});

test("OCCUPANCY per device (W2-RINGS-DROP-FILL-DOS): past its share of LIVE rows a device is refused 429; the publisher's swap (as many out as in) fits; deletes free room; another device has its own share", async () => {
  await withEnv({ RING_DROP_MAX_LIVE_PER_DEVICE: "8" }, async () => {
    const d = await device();
    const gen1 = rows(8);
    assert.equal((await d.put({ rows: gen1.map((x) => x.row), deletes: [] })).status, 201, "positive control: 8 rows within the share");
    const over = await d.put({ rows: rows(4).map((x) => x.row), deletes: [] });
    assert.equal(over.status, 429, "a device kept more than its share live");
    assert.ok(Number(over.headers.get("retry-after")) > 0 && /as many rows on the ring drop as one device may/.test(over.json.error), JSON.stringify(over.json));
    const gen2 = rows(8);
    assert.equal((await d.put({ rows: gen2.map((x) => x.row), deletes: gen1.map((x) => x.token) })).status, 201, "the swap was refused");
    assert.equal((await d.put({ rows: [], deletes: gen2.slice(0, 4).map((x) => x.token) })).status, 201);
    assert.equal((await d.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 201, "room freed by a delete was not usable");
    assert.equal((await (await device()).put({ rows: rows(8).map((x) => x.row), deletes: [] })).status, 201, "another device does not have its own share");
  });
});

test("OCCUPANCY per address: identities minted from ONE address share its budget (429 past it), while another address is untouched", async () => {
  await withEnv({ RING_DROP_MAX_LIVE_PER_ADDRESS: "12" }, async () => {
    const addr = "10.200." + randomBytes(1)[0] + "." + randomBytes(1)[0];
    const e = await device(addr);
    const f = await device(addr);
    assert.equal((await e.put({ rows: rows(8).map((x) => x.row), deletes: [] })).status, 201, "positive control: the first device");
    assert.equal((await f.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 201, "positive control: a second device, under the address's budget");
    const over = await f.put({ rows: rows(4).map((x) => x.row), deletes: [] });
    assert.equal(over.status, 429, "a second identity from the same address added past the address's budget");
    assert.match(over.json.error, /as many rows on the ring drop as one address may/);
    const g = await device(addr);
    assert.equal((await g.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 429, "a freshly minted identity on the same address got a new budget");
    const h = await device("10.201." + randomBytes(1)[0] + "." + randomBytes(1)[0]);
    assert.equal((await h.put({ rows: rows(8).map((x) => x.row), deletes: [] })).status, 201, "positive control: another address has its own budget");
  });
});

test("rows per device per hour: a device past RING_DROP_ROWS_PER_HOUR is refused 429 even when it deletes as much as it adds", async () => {
  await withEnv({ RING_DROP_ROWS_PER_HOUR: "8" }, async () => {
    const d = await device();
    const a = rows(8);
    assert.equal((await d.put({ rows: a.map((x) => x.row), deletes: [] })).status, 201, "positive control");
    const swap = await d.put({ rows: rows(4).map((x) => x.row), deletes: a.slice(0, 4).map((x) => x.token) });
    assert.equal(swap.status, 429, "the hourly row budget was not enforced");
    assert.equal((await d.put({ rows: [], deletes: a.slice(0, 4).map((x) => x.token) })).status, 201, "a delete-only write counts no rows");
    assert.equal((await (await device()).put({ rows: rows(8).map((x) => x.row), deletes: [] })).status, 201, "another device does not have its own hourly budget");
  });
});

test("an id that exists is 409 (never overwritten) and the WHOLE batch is rolled back", async () => {
  const d = await device();
  const first = rows(4);
  assert.equal((await d.put({ rows: first.map((x) => x.row), deletes: [] })).status, 201);
  const before_ = count();
  const second = rows(4);
  second[3].row.id = first[0].row.id;
  const r = await d.put({ rows: second.map((x) => x.row), deletes: [] });
  assert.equal(r.status, 409);
  assert.equal(count(), before_, "a refused batch left rows behind");
  const kept = db.prepare("SELECT ct FROM ring_drop WHERE id = ?").get(first[0].row.id);
  assert.equal(kept.ct, first[0].row.ct, "the existing row was overwritten");
});

test("deletes by token in the signed body: the matching row goes, a wrong token deletes nothing, a repeat is idempotent; inserts and deletes are one swap", async () => {
  const d = await device();
  const gen1 = rows(4);
  assert.equal((await d.put({ rows: gen1.map((x) => x.row), deletes: [] })).status, 201);
  const wrong = await d.put({ rows: [], deletes: [hex(32)] });
  assert.equal(wrong.status, 201);
  assert.equal(wrong.json.deleted, 0);
  // generation 2 replaces generation 1 in ONE request
  const gen2 = rows(4);
  const swap = await d.put({ rows: gen2.map((x) => x.row), deletes: gen1.map((x) => x.token) });
  assert.equal(swap.status, 201);
  assert.equal(swap.json.deleted, 4);
  for (const x of gen1) assert.equal(db.prepare("SELECT 1 FROM ring_drop WHERE id = ?").get(x.row.id), undefined);
  for (const x of gen2) assert.ok(db.prepare("SELECT 1 FROM ring_drop WHERE id = ?").get(x.row.id));
  const again = await d.put({ rows: [], deletes: gen1.map((x) => x.token) });
  assert.equal(again.status, 201);
  assert.equal(again.json.deleted, 0);
  // a delete token in a malformed shape is refused
  assert.equal((await d.put({ rows: [], deletes: ["abc"] })).status, 400);
  // an empty write is refused
  assert.equal((await d.put({ rows: [], deletes: [] })).status, 400);
});

test("413 drop_full at RING_DROP_MAX_ROWS (counting the rows the same write deletes), then accepted once there is room", async () => {
  const d = await device();
  const prev = process.env.RING_DROP_MAX_ROWS;
  try {
    process.env.RING_DROP_MAX_ROWS = String(count() + 4);
    const a = rows(4);
    assert.equal((await d.put({ rows: a.map((x) => x.row), deletes: [] })).status, 201);
    const full = await d.put({ rows: rows(4).map((x) => x.row), deletes: [] });
    assert.equal(full.status, 413);
    assert.equal(full.json.code, "drop_full");
    // a swap that deletes as many as it adds fits
    assert.equal((await d.put({ rows: rows(4).map((x) => x.row), deletes: a.map((x) => x.token) })).status, 201);
  } finally {
    if (prev === undefined) delete process.env.RING_DROP_MAX_ROWS;
    else process.env.RING_DROP_MAX_ROWS = prev;
  }
});

test("more than 28 rows in one write is 413 (the body limit); the per-device hourly cap answers 429 with Retry-After", async () => {
  const d = await device();
  assert.equal((await d.put({ rows: rows(32).map((x) => x.row), deletes: [] })).status, 413);
  const prevPer = process.env.RING_DROP_MAX_ROWS_PER_WRITE;
  try {
    process.env.RING_DROP_MAX_ROWS_PER_WRITE = "8";
    assert.equal((await d.put({ rows: rows(12).map((x) => x.row), deletes: [] })).status, 413, "the route's own per-write cap");
    assert.equal((await d.put({ rows: rows(8).map((x) => x.row), deletes: [] })).status, 201);
  } finally {
    if (prevPer === undefined) delete process.env.RING_DROP_MAX_ROWS_PER_WRITE;
    else process.env.RING_DROP_MAX_ROWS_PER_WRITE = prevPer;
  }
  const prev = process.env.RING_DROP_WRITES_PER_HOUR;
  try {
    process.env.RING_DROP_WRITES_PER_HOUR = "2";
    const e = await device();
    assert.equal((await e.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 201);
    assert.equal((await e.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 201);
    const third = await e.put({ rows: rows(4).map((x) => x.row), deletes: [] });
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
    // another device has its own budget (the positive control)
    const f = await device();
    assert.equal((await f.put({ rows: rows(4).map((x) => x.row), deletes: [] })).status, 201);
  } finally {
    if (prev === undefined) delete process.env.RING_DROP_WRITES_PER_HOUR;
    else process.env.RING_DROP_WRITES_PER_HOUR = prev;
  }
});

test("the sweep: an expired row is neither served nor kept", async () => {
  const id = hex(16);
  db.prepare("INSERT INTO ring_drop (id, enc, ct, hint, expires_hour, del_hash) VALUES (?, ?, ?, ?, ?, ?)").run(id, hex(32), hex(CT_HEX / 2), hex(2), nowHour(), hex(32));
  const live = hex(16);
  db.prepare("INSERT INTO ring_drop (id, enc, ct, hint, expires_hour, del_hash) VALUES (?, ?, ?, ?, ?, ?)").run(live, hex(32), hex(CT_HEX / 2), hex(2), nowHour() + 1, hex(32));
  const g = await raw("GET", "/rings/drop");
  assert.ok(!g.json.rows.some((r) => r.id === id), "an expired row was served");
  assert.ok(g.json.rows.some((r) => r.id === live), "a live row was not served (the sweep is too eager)");
  assert.equal(db.prepare("SELECT 1 FROM ring_drop WHERE id = ?").get(id), undefined, "the expired row was kept");
});

test("the read is a shuffle: two reads of the same rows come back in different orders", async () => {
  const d = await device();
  for (let i = 0; i < 3; i++) await d.put({ rows: rows(8).map((x) => x.row), deletes: [] });
  const orders = new Set();
  for (let i = 0; i < 6; i++) orders.add((await raw("GET", "/rings/drop")).json.rows.map((r) => r.id).join(","));
  assert.ok(orders.size > 1, "six reads, one order");
});

test("the dev reset is mounted ONLY under dev hooks (this validator has none)", async () => {
  const r = await raw("POST", "/rings/dev/reset", "{}");
  assert.equal(r.status, 404);
});
