// PERSONA LAUNCH P4 — RINGS AND RING NOTES, on the RIG (npm run test:rings once the verify agent adds the script;
// started by the scratch rig launcher att-run.sh, which runs the pair with ZK_DEV_HOOKS=true LAYERS_REQUIRE_SIG=true
// ZK_PREFETCH_MS=3000). Three kinds of device: the rig's own server device (the OWNER: it posts anonymously as two
// forked personas), and browser devices on /device/smoke.html (members and non-members; their DEBUG members force a
// rings tick and capture keys). Real browsers, the real validator, the real anon pipeline (fixture universe).
//
//   1  ADDRESSES AND A RING: three browser devices make private addresses (LP-3: after its first write, a device hands
//      one out with no PUT /state/rings); the owner makes a ring holding two of them, @alice at "posts", @bob at
//      "name"; GET /api/rings names members by a short reference only
//   2  PUBLISH: one signed write, a multiple of 4 rows of the fixed size, ring_drop exactly six columns; an unsigned
//      write is refused, a signed batch of 3 is refused, a signed batch of 4 accepted (the positive control)
//   3  NOTES: every anon post — before the share, @alice's after it, the sibling @bob's — carries a 512-hex note in the
//      validator's row and its public list; the envelopes differ by nothing but the words
//   4  MEMBERS SEE EXACTLY THE SHARED POSTS: both members' feed JSON carries ringShared (@alice, the label — never the
//      ring's own name, UX-R1) on @alice's
//      post after the share and on NOTHING else; the two non-members (an ungranted address, none) carry the key on no
//      card, their cards are identical to each other, and a member's card minus ringShared is identical too
//   5  REVOKE: the key rotates for future posts — the revoked member's CAPTURED keys open the post made before and not
//      the one after; its row is deleted at once and its record drops; the remaining member's pre-revoke keys do not
//      open the new post either, and it opens it once a publish has carried a key it did not hold before
//   5b PERSONA LAUNCH GO-LIVE (UXH-9) RECENTLY REMOVED → RESTORE: the member removed in 5 is KEPT (GET's recentlyRemoved
//      and the Settings › Rings page, with its plain sentence); a post made while it is removed stays closed to it; the
//      page's Restore button brings it back, and after the next publish its device opens ONLY posts made after the
//      restore; a deleted ring is listed and restored the same way (a fresh anon window first: K per window)
//   6  A FAILED DROP READ HIDES WITHOUT DROPPING ('unknown'); restoring the read shows the merge again with no publish
//   7  EVERY DEVICE READS THE DROP AND THE ANON LIST ON EVERY TICK, ring or not (the loop, observed on the wire), and
//      re-reads its own 'rings' document on each tick (LP-2: the same signed GET whether or not it holds a ring)
//   8  THE OWNER'S OWN PAGE (outerHTML): the server device's anon cards are byte-identical with no address and with an
//      ungranted address; once its own address is in the ring, a post made after shows cast-ring-shared and the
//      root-left / persona-right cast-split-avatar drawn inline, the other cards stay identical, and the page asks for
//      no image URL it did not ask for before
//   9  THE /d LINK CARD renders the note in a browser with no device: no root minted, no device booted
//   10 THE DB GREP: no persona id, persona handle, ring label, address id, PSK, inbox key, note key or drop token in any
//      validator table outside ring_drop.ct and zk_anon_casts.note
//   11 THE RESET CONTRACT: arm, resetSeed, every rings cache reads back empty and the drop is emptied
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(m); };

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a page */ }
  return { status: r.status, json, text };
}
async function vapi(p, init) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p, init); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? String(r.text ?? "").slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const rings = (action, extra = {}) => api("POST", "/api/rings", { action, ...extra });
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const dropRows = () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return db.prepare("SELECT id, ct, expires_hour FROM ring_drop").all().map((r) => ({ ...r })); } finally { db.close(); }
};
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(JSON.parse(readFileSync("seed/data/accounts.json", "utf8")));
const SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;

await assertServersUp(BASE);
console.log("\nPersona launch P4 — rings and ring notes (rig: app " + BASE + ", validator " + VBASE + ")");
if (!SOURCE) throw new Error("no seeded fork source (brothandbones) in seed/data/accounts.json");
if (!existsSync(DB_PATH)) throw new Error("INFRA: validator DB not found at " + DB_PATH);
{
  const probe = await vapi("/rings/drop");
  if (probe.status !== 200 || !Array.isArray(probe.json?.rows)) throw new Error("INFRA: the validator does not serve GET /rings/drop (migration 23 / the ringdrop mount): " + probe.status);
}

const stamp = Date.now().toString(36).slice(-5);
const RING_LABEL = "inner" + stamp;
let PA = null, PB = null, PA_HANDLE = null, PB_HANDLE = null;
const posts = {};
const browser = await chromium.launch();

/** a browser device on the smoke page, with a request log */
async function device(label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push({ at: Date.now(), method: r.method(), url: r.url() }));
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 160)));
  const d = { label, ctx, page, requests, info: null };
  await page.goto(BASE + "/device/smoke.html?validator=" + encodeURIComponent(VBASE), { waitUntil: "load" });
  d.info = await page.evaluate(() => window.__layersDevice.ready);
  d.api = (method, p, body) => page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, p, body });
  d.call = (fn, ...args) => page.evaluate(async ({ fn, args }) => {
    try { return { ok: true, value: await window.__layersDevice.rings[fn](...args) }; } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }, { fn, args });
  d.must = async (fn, ...args) => { const r = await d.call(fn, ...args); if (!r.ok) throw new Error(label + " rings." + fn + ": " + r.error); return r.value; };
  d.tick = async () => { const t = await d.must("tick", "fixture"); if (!t) throw new Error(label + ": the DEBUG tick is not available (LAYERS_DEVICE_DEBUG)"); return t; };
  /** the anon cards of this device's own feed, by cast hash */
  d.anonCards = async () => {
    for (let i = 0; i < 4; i++) {
      const r = await d.api("GET", "/api/feed2?surface=discovery");
      if (r.status === 200 && Array.isArray(r.json?.cards)) {
        const out = {};
        for (const c of r.json.cards) if (c.cast?.anon && c.cast.castHash) out[c.cast.castHash] = c;
        return out;
      }
      await sleep(400);
    }
    throw new Error(label + ": the feed did not answer");
  };
  d.needles = () => page.evaluate(() => window.__layersDevice.needles());
  return d;
}

/** prove what is wanted NOW, then send it; returns the relayed rows by cast hash */
async function drive(castHashes) {
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  for (const h of castHashes) {
    const s = (await retry(() => api("GET", `/api/anon?castHash=${h}&envelope=1`))).json;
    if (s?.outcome?.lastStage === "epoch-edge" && s.status === "wanted") throw new Error("INFRA: the rig's epoch ends inside the jitter window — re-run after the boundary");
    // the envelope exists while the post is QUEUED (the queue keeps no proof material after the send)
    if (posts[h] && s?.envelope) posts[h].env = s.envelope;
  }
  await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
  const listed = await anonCasts();
  const out = {};
  for (const h of castHashes) {
    const row = listed.find((c) => c.castHash === h);
    if (!row) throw new Error("the anon post " + h.slice(0, 10) + " was not relayed");
    out[h] = row;
  }
  return out;
}
async function post(personaId, text) {
  const r = await api("POST", "/api/anon", { text, personaId });
  if (r.status !== 202 || !/^[0-9a-f]{64}$/.test(String(r.json?.castHash))) throw new Error("anon post refused: " + r.status + " " + JSON.stringify(r.json).slice(0, 220));
  const p = { castHash: r.json.castHash, text, personaId, env: null };
  posts[p.castHash] = p;
  return p;
}

/** the server device's /home: each anon card's outerHTML (relative times blanked) by cast hash, and the image URLs */
async function homeSnapshot(hashes) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const images = new Set();
  page.on("request", (r) => { if (r.resourceType() === "image") images.add(r.url()); });
  try {
    const out = {};
    for (let attempt = 0; attempt < 6 && Object.keys(out).length < hashes.length; attempt++) {
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      for (const h of hashes) {
        if (out[h]) continue;
        const text = posts[h]?.text;
        const card = page.locator("[data-testid='cast']", { hasText: text }).first();
        if ((await card.count()) === 0) continue;
        out[h] = await card.evaluate((el) => {
          const c = el.cloneNode(true);
          for (const n of c.querySelectorAll("*")) if (n.children.length === 0 && /^(\d+[smh]|[A-Z][a-z]{2} \d{1,2}(, \d{4})?)$/.test((n.textContent || "").trim())) n.textContent = "T";
          return c.outerHTML;
        });
      }
      if (Object.keys(out).length < hashes.length) await sleep(800);
    }
    const missing = hashes.filter((h) => !out[h]);
    if (missing.length) throw new Error("the server's /home does not show the anon cards " + missing.map((h) => h.slice(0, 8)).join(", "));
    const ringShared = await page.evaluate(() => [...document.querySelectorAll("[data-testid='cast-ring-shared']")].map((e) => ({ persona: e.getAttribute("data-persona"), text: e.textContent })));
    const split = await page.evaluate(() => [...document.querySelectorAll("[data-testid='cast']")].filter((a) => a.querySelector("[data-testid='cast-ring-shared']")).map((a) => {
      const s = a.querySelector("[data-testid='cast-split-avatar']");
      return s ? { left: s.getAttribute("data-left"), right: s.getAttribute("data-right"), imgs: [...s.querySelectorAll("img")].map((i) => i.getAttribute("src") || "") } : null;
    }));
    return { cards: out, images: [...images], ringShared, split };
  } finally {
    await ctx.close();
  }
}

let M = null, M2 = null, N1 = null, N2 = null;
let ringId = null, memberM = null, memberM2 = null;
let baselineDom = null;
const devicesNeedles = [];
try {
  // ---------------------------------------------------------------- setup: two personas, the proof layer, a post BEFORE the share
  await retry(() => dev("resetSeed"));
  await retry(() => zk("resetZk"));
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    PA = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `ralice${stamp}` }))).json.newPersona;
    PB = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `rbob${stamp}` }))).json.newPersona;
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
  if (!PA || !PB) throw new Error("setup: the two personas were not minted");
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
  await retry(() => zk("seedDecoys", { count: 60 }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  const pane0 = (await retry(() => api("GET", "/api/rings"))).json;
  PA_HANDLE = pane0.admissible.find((p) => p.personaId === PA)?.handle;
  PB_HANDLE = pane0.admissible.find((p) => p.personaId === PB)?.handle;
  if (!PA_HANDLE || !PB_HANDLE) throw new Error("setup: the forked personas are not admissible ring subjects: " + JSON.stringify(pane0.admissible).slice(0, 300));
  const p0 = await post(PA, `before the share ${stamp} [layers-test fixture]`);
  posts[p0.castHash] = p0;
  posts.before = p0;
  await drive([p0.castHash]);

  await check("1. ADDRESSES AND A RING: three browser devices make private addresses (LR1.); the owner makes a ring holding two of them, @alice at 'posts' and @bob at 'name'; GET /api/rings names each member by a short reference and carries no address", async () => {
    M = await device("M");
    M2 = await device("M2");
    N1 = await device("N1");
    N2 = await device("N2");
    // PERSONA LAUNCH P4 (LP-3): once a device has made its first write (its first tick — spares included), handing out
    // an address sends NOTHING: no PUT /state/rings at the click or in the seconds after (the claim rides a deferred
    // write minutes to hours later), so the member's write can no longer be paired with the owner's add
    await M.tick();
    assert(M.requests.some((r) => r.method === "PUT" && r.url === VBASE + "/state/rings"), "M's first tick did not write its 'rings' document");
    const claimFrom = Date.now();
    const aM = await M.must("createAddress", null);
    await sleep(2500);
    const atClaim = M.requests.filter((r) => r.at >= claimFrom && r.method === "PUT" && r.url === VBASE + "/state/rings").length;
    assert(atClaim === 0, "making an address wrote M's 'rings' document at the handover (" + atClaim + " PUTs)");
    const aM2 = await M2.must("createAddress", null);
    const aN1 = await N1.must("createAddress", null);
    for (const a of [aM, aM2, aN1]) assert(/^LR1\.[A-Za-z0-9_-]{100,120}$/.test(a.address), "address shape: " + a.address);
    ringId = (await retry(() => rings("createRing", { label: RING_LABEL }))).json.id;
    memberM = (await retry(() => rings("addMember", { ringId, address: aM.address }))).json.memberId;
    memberM2 = (await retry(() => rings("addMember", { ringId, address: aM2.address }))).json.memberId;
    await retry(() => rings("setDepth", { ringId, personaId: PA, depth: "posts" }));
    await retry(() => rings("setDepth", { ringId, personaId: PB, depth: "name" }));
    const g = await retry(() => api("GET", "/api/rings"));
    const r = g.json.rings.find((x) => x.id === ringId);
    assert(r && r.members.length === 2 && r.personas.find((p) => p.personaId === PA)?.depth === "posts" && r.personas.find((p) => p.personaId === PB)?.depth === "name", "the ring: " + JSON.stringify(r));
    for (const a of [aM, aM2]) assert(!g.text.includes(a.address.slice(4)), "GET /api/rings carries a member's address");
    assert(r.members.every((m) => /^[0-9a-f]{8}$/.test(m.ref)), "members are not named by a short reference");
    // a non-admissible persona is refused (the rig's private seeded persona, if the pane lists one, is not admissible)
    const refused = await rings("setDepth", { ringId, personaId: "p_not_mine_" + stamp, depth: "name" });
    assert(refused.status >= 400, "a persona that is not this device's was accepted");
  });

  await check("2. PUBLISH: one signed write — rows a multiple of 4 (2 members → 4), every ct 8224 hex, ring_drop exactly six columns; an unsigned write 401, a signed batch of 3 refused, a signed batch of 4 accepted (the positive control)", async () => {
    const pub = (await retry(() => rings("publishNow"))).json;
    assert(pub.ok && pub.rows === 4 && pub.real === 2, "publish: " + JSON.stringify(pub));
    const rows = dropRows();
    assert(rows.length % 4 === 0 && rows.length >= 4 && rows.every((r) => r.ct.length === 8224), "the drop: " + rows.length + " rows");
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    let cols;
    try { cols = db.prepare("PRAGMA table_info(ring_drop)").all().map((c) => c.name).sort().join(); } finally { db.close(); }
    assert(cols === "ct,del_hash,enc,expires_hour,hint,id", "ring_drop columns: " + cols);
    const unsigned = await fetch(VBASE + "/rings/drop/batch", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: [], deletes: ["ab".repeat(32)] }) });
    assert(unsigned.status === 401, "an unsigned write: " + unsigned.status);
    const probe = (await retry(() => rings("dropProbe"))).json;
    assert(probe.unsigned === 401, "probe unsigned: " + probe.unsigned);
    assert(probe.three && probe.three.ok === false && probe.three.status === 400, "a signed batch of 3: " + JSON.stringify(probe.three));
    assert(probe.four?.ok === true && probe.cleanup?.ok === true, "the signed batch of 4 (positive control): " + JSON.stringify(probe.four));
  });

  await check("3. NOTES: @alice's post after the share and @bob's (sibling, name only) are relayed like the one before the share; every row's note is 512 hex in the validator's table and its public list; the queued envelopes differ by nothing but the words", async () => {
    const p1 = await post(PA, `alice after the share ${stamp} [layers-test fixture]`);
    const p2 = await post(PB, `bob the sibling ${stamp} [layers-test fixture]`);
    posts[p1.castHash] = p1; posts[p2.castHash] = p2; posts.alice = p1; posts.bob = p2;
    const rows = await drive([p1.castHash, p2.castHash]);
    const listed = await anonCasts();
    for (const p of [posts.before, p1, p2]) {
      const row = listed.find((c) => c.castHash === p.castHash);
      assert(row && /^[0-9a-f]{512}$/.test(String(row.note)), "the public list's note for " + p.castHash.slice(0, 8) + ": " + String(row?.note).slice(0, 20));
      p.note = row.note;
    }
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      for (const p of [posts.before, p1, p2]) {
        const n = db.prepare("SELECT note FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(p.castHash)?.note;
        assert(typeof n === "string" && n.length === 512, "the stored note for " + p.castHash.slice(0, 8) + " is " + String(n).length);
      }
    } finally { db.close(); }
    // VERIFY (wave 2, harness fix): a field element (the nullifier, the proof points) is a DECIMAL string whose digit
    // count varies from post to post (77 vs 76 digits, measured on the rig with two honest envelopes), and [0-9a-f]{16,}
    // matched it as hex and kept its length, so two envelopes differed in "shape" by chance. An all-digit string is one
    // token of any length; hex (the 512-hex note, the hashes) still keeps its exact length.
    const shape = (env) => JSON.stringify(env ?? {}).replace(/"text":"[^"]*"/, '"text":""').replace(/"\d+"/g, '"D"').replace(/[0-9a-f]{16,}/g, (h) => "x".repeat(h.length)).replace(/\d+/g, "0").length;
    assert(posts.before.env && p1.env, "no queued envelope to compare");
    assert(typeof posts.before.env.payload?.note === "string" && posts.before.env.payload.note.length === 512 && p1.env.payload?.note?.length === 512, "an envelope does not carry a 512-hex note");
    assert(shape(posts.before.env) === shape(p1.env), "a random-note envelope and a real-note envelope differ in shape");
    void rows;
  });

  await check("4. MEMBERS SEE EXACTLY THE SHARED POSTS: both members' cards carry ringShared (@alice, the label) on @alice's post after the share and on NOTHING else; the non-members (an ungranted address, none) carry the key on no card; their cards are identical, and a member's card minus ringShared is identical to theirs", async () => {
    for (const d of [M, M2, N1, N2]) await d.tick();
    const cards = {};
    for (const d of [M, M2, N1, N2]) cards[d.label] = await d.anonCards();
    const hs = [posts.before.castHash, posts.alice.castHash, posts.bob.castHash];
    for (const d of [M, M2]) {
      const c = cards[d.label];
      for (const h of hs) assert(c[h], d.label + " has no card for " + h.slice(0, 8));
      const rs = c[posts.alice.castHash].cast.ringShared;
      assert(rs && rs.persona.handle === PA_HANDLE, d.label + ": alice's post: " + JSON.stringify(rs));
      // UX-R1: members see the root's name, else "a friend" — NEVER the ring's own name (the pane says only the owner sees it)
      assert(rs.root.fname ? typeof rs.label === "string" && rs.label.length > 0 : rs.label === "a friend", d.label + ": the label " + rs.label);
      assert(rs.label !== RING_LABEL, d.label + ": a member was shown the ring's own name");
      assert(rs.persona.thumb === null || /^data:image\//.test(rs.persona.thumb), "a persona thumbnail that is not inline");
      assert(!("ringShared" in c[posts.before.castHash].cast), d.label + " sees the post made BEFORE the share");
      assert(!("ringShared" in c[posts.bob.castHash].cast), d.label + " sees the sibling's post");
    }
    for (const d of [N1, N2]) for (const h of hs) assert(cards[d.label][h] && !("ringShared" in cards[d.label][h].cast), d.label + " (not a member) carries ringShared on " + h.slice(0, 8));
    for (const h of hs) assert(JSON.stringify(cards.N1[h]) === JSON.stringify(cards.N2[h]), "an ungranted address and no address render different cards for " + h.slice(0, 8));
    const minus = JSON.parse(JSON.stringify(cards.M[posts.alice.castHash]));
    delete minus.cast.ringShared;
    assert(JSON.stringify(minus) === JSON.stringify(cards.N2[posts.alice.castHash]), "a member's card differs from a non-member's by more than ringShared");
    const st = await M.must("status");
    assert(st.rings.length === 1 && st.rings[0].state === "shown", "M's status: " + JSON.stringify(st).slice(0, 300));
  });

  await check("5. REVOKE rotates the key and deletes the row at once: the revoked member's CAPTURED keys open the post made before the revoke and NOT the one after; its record drops; the remaining member's pre-revoke keys do not open it either, and it opens it once a publish carries a new key", async () => {
    const captured = (await M.must("debugKeys")).map((k) => k.keyHex);
    assert(captured.length > 0, "M holds no keys to capture (LAYERS_DEVICE_DEBUG?)");
    // VERIFY (wave 2, harness fix): the remaining member's keys are captured BEFORE the revoke too. The publisher
    // publishes "at the next tick after a change" (lib/rings/publisher.ts isDue: dirty), and drive()'s prefetchNow IS
    // the owner's next tick (plus every browser device ticks itself at 1 s on smoke.html), so "M2 cannot open p3 before
    // a publishNow" raced the product's own designed publish and failed whenever that tick landed first. The property
    // ("the new post needs the NEW generation, which reaches the member only through a publish") is asserted on the
    // captured pre-revoke keys instead: they must NOT open p3 (rotation) and MUST open alice's earlier post (control).
    const capturedM2 = (await M2.must("debugKeys")).map((k) => k.keyHex);
    assert(capturedM2.length > 0, "M2 holds no keys to capture");
    const before = dropRows().length;
    const rv = (await retry(() => rings("revokeMember", { ringId, memberId: memberM }))).json;
    assert(rv.deleted === true, "the revoked member's row was not deleted: " + JSON.stringify(rv));
    assert(dropRows().length === before - 1, "the revoke deleted " + (before - dropRows().length) + " rows");
    const p3 = await post(PA, `alice after the revoke ${stamp} [layers-test fixture]`);
    posts[p3.castHash] = p3; posts.afterRevoke = p3;
    p3.note = (await drive([p3.castHash]))[p3.castHash].note;
    assert(/^[0-9a-f]{512}$/.test(String(p3.note)), "no note on the post after the revoke");
    assert((await M.must("tryOpen", p3.note, p3.castHash, captured)) === null, "the revoked member's captured keys open a post made AFTER the revoke");
    assert((await M.must("tryOpen", posts.alice.note, posts.alice.castHash, captured)) !== null, "positive control: the captured keys open the post made before the revoke");
    await M.tick();
    assert((await M.must("status")).rings.length === 0, "the revoked member's record survived a full read without its row");
    const mCards = await M.anonCards();
    assert(!("ringShared" in mCards[p3.castHash].cast) && !("ringShared" in mCards[posts.alice.castHash].cast), "the revoked member still renders a merge");
    assert((await M2.must("tryOpen", p3.note, p3.castHash, capturedM2)) === null, "the remaining member's keys from BEFORE the revoke open the post made after it (the revoke did not rotate)");
    assert((await M2.must("tryOpen", posts.alice.note, posts.alice.castHash, capturedM2)) !== null, "positive control: the remaining member's pre-revoke keys open alice's post made before the revoke");
    await retry(() => rings("publishNow"));
    await M2.tick();
    assert((await M2.anonCards())[p3.castHash].cast.ringShared?.persona.handle === PA_HANDLE, "the remaining member does not open the post made after the revoke");
    const fresh = (await M2.must("debugKeys")).filter((k) => !capturedM2.includes(k.keyHex));
    assert(fresh.length > 0, "the remaining member opened the new post with no key it did not already hold before the revoke");
  });

  await check("5b. RECENTLY REMOVED → RESTORE (PERSONA LAUNCH GO-LIVE, UXH-9): the removed member is KEPT under Settings › Rings › Recently removed (GET and the page, with the plain sentence); a post made while it is removed stays closed to it; the page's Restore brings it back, and after the next publish its device opens ONLY posts made after the restore (not the ones made while it was removed, nor the ones before); a deleted ring is listed and restored the same way", async () => {
    // the person removed in check 5 is kept, hidden — not erased (hide, never delete)
    const g0 = (await retry(() => api("GET", "/api/rings"))).json;
    const r0 = g0.rings.find((x) => x.id === ringId);
    assert(r0 && !r0.members.some((m) => m.id === memberM), "the removed member is still listed among the ring's people");
    const rm = (g0.recentlyRemoved?.members ?? []).find((m) => m.id === memberM);
    assert(rm && rm.ringId === ringId && /^[0-9a-f]{8}$/.test(rm.ref) && rm.hiddenAt > 0, "Recently removed does not list the removed member: " + JSON.stringify(g0.recentlyRemoved));
    // a fresh anon window (the persona budget, K per window, was spent by the posts above; check 8 advances again)
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const pRemoved = await post(PA, `alice while M is removed ${stamp} [layers-test fixture]`);
    posts[pRemoved.castHash] = pRemoved;
    pRemoved.note = (await drive([pRemoved.castHash]))[pRemoved.castHash].note;
    // the page: Settings › Rings › Recently removed, its sentence, and its Restore button (no confirm: nothing is lost)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + "/settings/rings", { waitUntil: "networkidle" });
      const row = page.locator(`[data-testid='removed-member-row'][data-member-id='${memberM}']`);
      await row.waitFor({ timeout: 30000 });
      const line = (await page.locator("[data-testid='rings-restore-line']").textContent())?.trim();
      assert(line === "They will see posts from now on, not the ones made while they were removed.", "the sentence beside Restore: " + line);
      await row.locator("[data-testid='member-restore']").click();
      await page.locator(`[data-testid='member-row'][data-member-id='${memberM}']`).waitFor({ timeout: 30000 });
      const note = (await page.locator("[data-testid='rings-note']").textContent()) ?? "";
      assert(/^Restored\. They will see posts from now on, not the ones made while they were removed\./.test(note.trim()), "the note after Restore: " + note);
      assert((await page.locator(`[data-testid='removed-member-row'][data-member-id='${memberM}']`).count()) === 0, "the restored member is still under Recently removed");
    } finally {
      await ctx.close();
    }
    const pAfter = await post(PA, `alice after M was restored ${stamp} [layers-test fixture]`);
    posts[pAfter.castHash] = pAfter;
    pAfter.note = (await drive([pAfter.castHash]))[pAfter.castHash].note;
    await retry(() => rings("publishNow"));
    await M.tick();
    const st = await M.must("status");
    assert(st.rings.length === 1 && st.rings[0].state === "shown", "the restored member's device does not hold the ring again: " + JSON.stringify(st).slice(0, 300));
    const mCards = await M.anonCards();
    assert(mCards[pAfter.castHash]?.cast.ringShared?.persona.handle === PA_HANDLE, "the restored member does not open the post made after the restore");
    assert(!("ringShared" in mCards[pRemoved.castHash].cast), "THE REMOVED WINDOW REOPENED: the restored member opens the post made while it was removed");
    assert(!("ringShared" in mCards[posts.alice.castHash].cast), "the restored member is shown a post from before its removal (it starts from the restore)");
    const keys = (await M.must("debugKeys")).map((k) => k.keyHex);
    assert(keys.length > 0 && (await M.must("tryOpen", pRemoved.note, pRemoved.castHash, keys)) === null, "the restored member's keys open the post made while it was removed");
    assert((await M.must("tryOpen", pAfter.note, pAfter.castHash, keys)) !== null, "positive control: the restored member's keys open the post made after the restore");
    await M2.tick();
    const m2Cards = await M2.anonCards();
    for (const p of [pRemoved, pAfter]) assert(m2Cards[p.castHash]?.cast.ringShared?.persona.handle === PA_HANDLE, "the member who stayed lost a post: " + p.castHash.slice(0, 8));
    // a deleted ring: hidden, listed, restored (an empty ring, so nothing else in this suite changes)
    const spare = (await retry(() => rings("createRing", { label: "spare" + stamp }))).json.id;
    await retry(() => rings("deleteRing", { ringId: spare }));
    const g1 = (await retry(() => api("GET", "/api/rings"))).json;
    assert(!g1.rings.some((x) => x.id === spare) && g1.recentlyRemoved.rings.some((x) => x.id === spare && x.label === "spare" + stamp), "the deleted ring is not under Recently removed: " + JSON.stringify(g1.recentlyRemoved.rings));
    const back = (await retry(() => rings("restoreRing", { ringId: spare }))).json;
    const g2 = (await retry(() => api("GET", "/api/rings"))).json;
    assert(back.restored === true && g2.rings.some((x) => x.id === spare) && !g2.recentlyRemoved.rings.some((x) => x.id === spare), "the ring did not come back: " + JSON.stringify(back));
    // the delete and the restore marked the rings changed: publish NOW, so the server's own next tick does not publish
    // in the middle of check 6 (which asserts that no publish happens while it runs)
    await retry(() => rings("publishNow"));
  });

  await check("6. A FAILED DROP READ hides the merge and KEEPS the record ('unknown'); restoring the read shows it again with NO new publish", async () => {
    const idsBefore = dropRows().map((r) => r.id).sort().join();
    await M2.page.route("**/rings/drop", (route) => route.abort());
    try {
      await M2.tick();
      const st = await M2.must("status");
      assert(st.lastTickOk === false && st.rings.length === 1 && st.rings[0].state === "unknown", "after a failed read: " + JSON.stringify(st).slice(0, 300));
      assert(!("ringShared" in (await M2.anonCards())[posts.alice.castHash].cast), "the merge still shows after a failed read");
    } finally {
      await M2.page.unroute("**/rings/drop");
    }
    await M2.tick();
    assert((await M2.anonCards())[posts.alice.castHash].cast.ringShared?.persona.handle === PA_HANDLE, "restoring the read did not restore the merge");
    assert(dropRows().map((r) => r.id).sort().join() === idsBefore, "a publish happened in between");
  });

  await check("7. EVERY DEVICE READS THE DROP AND THE ANON LIST ON EVERY TICK, ring or not: the prefetch loop, observed on the wire on a non-member and a member — both GETs on each tick, unsigned, and no write to the drop", async () => {
    const counts = {};
    for (const d of [N2, M2]) {
      const from = Date.now();
      await d.api("POST", "/api/zk", { action: "prefetchStatus", mode: "fixture" });
      await sleep(7000);
      const reqs = d.requests.filter((r) => r.at >= from);
      const drop = reqs.filter((r) => r.method === "GET" && r.url === VBASE + "/rings/drop").length;
      const anon = reqs.filter((r) => r.method === "GET" && r.url.startsWith(VBASE + "/zk/anon-casts")).length;
      const puts = reqs.filter((r) => r.url.includes("/rings/drop/batch")).length;
      // LP-2: the uniform re-read of the sealed document, one signed GET per tick on every device, ring or not
      const docReads = reqs.filter((r) => r.method === "GET" && r.url === VBASE + "/state/rings").length;
      counts[d.label] = { drop, anon, docReads };
      assert(drop >= 3 && anon >= 3, d.label + ": " + drop + " drop reads and " + anon + " anon-list reads in 7 s of 1 s ticks");
      assert(Math.abs(drop - anon) <= 1, d.label + ": the two reads are not made together (" + drop + " vs " + anon + ")");
      assert(docReads >= 3 && Math.abs(docReads - drop) <= 1, d.label + ": the 'rings' document is not re-read on every tick (" + docReads + " reads vs " + drop + " ticks)");
      assert(puts === 0, d.label + " wrote to the drop");
    }
    return JSON.stringify(counts);
  });

  await check("8. THE OWNER'S OWN PAGE: its anon cards are byte-identical with no address and with an ungranted one; once its own address is in the ring, a post made after it shows cast-ring-shared and the root-left / persona-right cast-split-avatar drawn inline, every other card stays identical, and the page asks for no image it did not ask for before", async () => {
    const hs = [posts.before.castHash, posts.alice.castHash, posts.bob.castHash, posts.afterRevoke.castHash];
    await retry(() => zk("prefetchNow"));
    baselineDom = await homeSnapshot(hs);
    assert(baselineDom.ringShared.length === 0, "the owner's page shows a ring merge with no address");
    const own = (await retry(() => rings("createAddress"))).json.address;
    await retry(() => zk("prefetchNow"));
    const ungranted = await homeSnapshot(hs);
    for (const h of hs) assert(ungranted.cards[h] === baselineDom.cards[h], "an ungranted address changed the card " + h.slice(0, 8));
    await retry(() => rings("addMember", { ringId, address: own.address }));
    await retry(() => rings("publishNow"));
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const p4 = await post(PA, `alice after the owner joined ${stamp} [layers-test fixture]`);
    posts[p4.castHash] = p4;
    await drive([p4.castHash]);
    await retry(() => zk("prefetchNow"));
    const after = await homeSnapshot([...hs, p4.castHash]);
    for (const h of hs) assert(after.cards[h] === baselineDom.cards[h], "a card the ring does not reveal changed: " + h.slice(0, 8));
    assert(/data-testid="cast-ring-shared"/.test(after.cards[p4.castHash]) && after.cards[p4.castHash].includes(`data-persona="${PA_HANDLE}"`), "the post after the owner joined shows no ring merge");
    const sp = after.split.find((s) => s && s.right === "@" + PA_HANDLE);
    assert(sp, "no root-left / persona-right split avatar: " + JSON.stringify(after.split));
    assert(sp.imgs.every((src) => src.startsWith("data:")), "a split-avatar half is a URL: " + JSON.stringify(sp.imgs));
    const fresh = after.images.filter((u) => !baselineDom.images.includes(u) && !u.startsWith("data:"));
    assert(fresh.length === 0, "the ring merge asked for new images: " + fresh.join(", "));
  });

  await check("9. THE /d LINK CARD: a link-friend's link opens a card listing @alice in a browser with NO device — no root minted, nothing booted, the key never in a request", async () => {
    const link = (await retry(() => rings("makeLink", { ringId }))).json.link;
    assert(/^\/d#[0-9a-f]{64}$/.test(link), "link: " + link);
    await retry(() => rings("publishNow"));
    const roots0 = (await vapi("/health")).json?.roots;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    try {
      await page.goto(BASE + link, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("[data-testid='drop-card']")?.getAttribute("data-state") !== "checking", null, { timeout: 30000 });
      const state = await page.getAttribute("[data-testid='drop-card']", "data-state");
      assert(state === "shown", "the card says " + state);
      assert((await page.locator(`[data-testid='drop-card-subject'][data-handle='${PA_HANDLE}']`).count()) === 1, "the card does not list @alice");
      assert(await page.evaluate(() => typeof window.__layersDevice === "undefined"), "a device booted on /d");
      const key = link.slice(3);
      assert(!urls.some((u) => u.includes(key)), "the key reached a request");
    } finally {
      await ctx.close();
    }
    assert((await vapi("/health")).json?.roots === roots0, "opening /d minted a root");
    // a link with no key: the honest incomplete state
    const ctx2 = await browser.newContext();
    try {
      const p2 = await ctx2.newPage();
      await p2.goto(BASE + "/d", { waitUntil: "load" });
      await p2.waitForFunction(() => document.querySelector("[data-testid='drop-card']")?.getAttribute("data-state") === "incomplete", null, { timeout: 15000 });
    } finally {
      await ctx2.close();
    }
  });

  await check("10. THE DB GREP: no persona id, persona handle, ring label, address id, PSK, inbox key, note key or drop token anywhere in the validator's tables outside ring_drop.ct and zk_anon_casts.note (the needles exist: a published drop, received keys)", async () => {
    const n = (await retry(() => rings("leakNeedles"))).json;
    for (const d of [M, M2, N1]) devicesNeedles.push(...(await d.needles()));
    const secrets = [...n.pskHex, ...n.noteKeys, ...n.tokens, ...n.inbox, ...n.receivedKeys, ...devicesNeedles].filter((x) => typeof x === "string" && x.length >= 32);
    const needles = [...new Set([...secrets, ...n.addrIds, PA, PB, PA_HANDLE, PB_HANDLE, RING_LABEL])];
    assert(n.tokens.length >= 4 && n.receivedKeys.length > 0 && secrets.length > 20, "too few needles to make the grep mean anything: " + secrets.length);
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const hits = [];
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
          const o = { ...row };
          if (name === "ring_drop") delete o.ct;
          if (name === "zk_anon_casts") delete o.note;
          const text = JSON.stringify(o);
          for (const x of needles) if (text.includes(x)) hits.push(name + ": " + x.slice(0, 16));
        }
      }
    } finally { db.close(); }
    assert(hits.length === 0, [...new Set(hits)].slice(0, 8).join("; "));
    return needles.length + " needles";
  });

  await check("11. THE RESET CONTRACT: armed (the document, received records, reveals, inbox keys, ticks) → resetSeed → every rings cache reads back empty and the drop is emptied", async () => {
    const armed = (await retry(() => rings("cacheProbe"))).json;
    assert(armed.docLoaded && armed.rings > 0 && armed.noteKeys > 0 && armed.received.records > 0 && armed.received.reveals > 0 && armed.inboxKeys > 0 && armed.ticks > 0, "not armed: " + JSON.stringify(armed));
    await retry(() => dev("resetSeed"));
    const after = (await retry(() => rings("cacheProbe"))).json;
    // the rig's own prefetch loop (3 s) may tick between the reset and this probe: a tick after the reset finds an empty
    // document and an empty drop, so what it may add is a tick record — never a ring, a key, an address or a reveal
    // (the full counters, ticks and the hydrate's copy included, are pinned by the unit harness's R1)
    // LP-3: such a tick may also write the NEW root's first document with fresh spare addresses (`spares`), never a
    // handed-out address, a claim or a scheduled upkeep of the old root's (the probe leaves the spares out of
    // `addresses` and `inboxKeys`; the unit harness's R1 pins the claims and the upkeep non-vacuously)
    assert(after.rings === 0 && after.noteKeys === 0 && after.addresses === 0 && after.liveRows === 0 && after.inboxKeys === 0 && after.received.records === 0 && after.received.reveals === 0 && after.ticks <= 2 && after.pendingClaims === 0 && after.upkeepScheduled === false, "after resetSeed: " + JSON.stringify(after));
    assert(dropRows().length === 0, "the drop still holds " + dropRows().length + " rows after the seed reset");
    const pane = (await retry(() => api("GET", "/api/rings"))).json;
    assert(pane.rings.length === 0 && pane.addresses.length === 0, "the pane after the reset: " + JSON.stringify(pane).slice(0, 200));
  });
} catch (e) {
  fail("setup", e.message);
} finally {
  for (const d of [M, M2, N1, N2]) await d?.ctx.close().catch(() => {});
  await browser.close();
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
  await retry(() => dev("resetSeed")).catch(() => {});
}

const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} rings checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
void createHash;
