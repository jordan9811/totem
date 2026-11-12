// MULTI-FID PASS — Gate 3 acceptance (fixture): fork and disclosure over real fids.
//   1. FORK → NEW FID: forking a persona that owns a fid mints a FRESH persona with a FRESH fid; the old fid stays mapped (the decoy)
//   2. FORWARD POINTER: a carried holder resolves the move to the new persona AND its new fid + fname; a stranger learns neither
//   3. THE VALIDATOR: the plain map holds the new persona's fid as an entry unrelated to any other; the fid records, forks and grants
//      are ciphertext; no plaintext row anywhere in its state relates the new fid to the old persona
//   4. CONTINUITY under zk: the fork requests the continuity proof AND mints the fid; after the drain the fork claim verifies (z8's oracle)
//   5. BLOCKS STAY CLIENT-SIDE: blocking the new persona drops its cast from OUR feed; the sim network still holds its network cast
//   6. SURFACES in BOTH network modes: attribution, act-as options and the profile render the same persona chrome per-persona-fid vs shared-fid
//   7. SHARED-FID MODE: a fork mints no fid and reports nothing pending — the v0 path is what it was
// Fixture, pinned ports, no network, no spend.
import { readFileSync } from "node:fs";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main"; // @yeak__ — a seeded whitelist holder of brothandbones
const STRANGER = "persona_acc_crypto_1";
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

// "view as" is a request COOKIE (lib/activePersona.ts): every read after viewAs(x) carries it, like a browser would
let viewerCookie = null;
async function api(method, url, body) {
  const headers = { "content-type": "application/json" };
  if (viewerCookie) headers.cookie = "layers_view_as=" + viewerCookie;
  const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw last;
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const write = (body) => api("POST", "/api/fc/write", body);
const reset = () => retry(() => dev("resetSeed"));
const viewAs = async (personaId) => { const r = await retry(() => dev("viewAs", { personaId })); viewerCookie = personaId; return r; };
const attributions = async (hashes) => (await retry(() => api("GET", "/api/fc/attribution?hashes=" + hashes.map(encodeURIComponent).join(",")))).json.attributions;
const view = async () => (await retry(() => api("GET", "/api/fc/persona"))).json;
const fork = (fromPersona, carry, newHandle) => retry(() => api("POST", "/api/identity/fork", { fromPersona, carry, newHandle, newName: "Gate 3 " + newHandle }));
// the product's fname rule (lib/fc/acquire.ts fnameFromHandle), copied so the suite judges the record, not the helper
const FNAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;
const fnameOf = (handle) => { const s = handle.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 16).replace(/-+$/, ""); return FNAME_RE.test(s) ? s : null; };

await reset();
// MAIN owns its own fixture fid: the mode comparison (#6) is own-fid vs the shared account
const recMain = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
if (!recMain?.fid) throw new Error("MAIN owns no fid after acquisition");
// A persona of OURS that owns a fid and has a grant holder: brothandbones (seeded, holder MAIN) forked to PUB with MAIN carried.
// In per-persona-fid mode the fork itself mints PUB's fid (Gate 3) — the decoy the second fork leaves behind.
const stamp = Date.now().toString(36);
const SOURCE0 = idOf("brothandbones");
const h0 = (await retry(() => api("GET", `/api/identity/fork?personaId=${SOURCE0}`))).json;
if (!h0?.holders?.some((h) => h.audienceMember === MAIN)) throw new Error("seed changed: MAIN no longer holds a grant on brothandbones");
const pubRes = (await fork(SOURCE0, [MAIN], `fid3_pub_${stamp}`)).json;
const PUB = pubRes.newPersona;
if (!PUB) throw new Error("setup fork failed: " + JSON.stringify(pubRes).slice(0, 200));
if (!pubRes.newFid?.fid) {
  // the setup fork mints the decoy's fid on fixture; a rig that turned minting off gets it explicitly
  const r = (await retry(() => persona("acquire", { personaId: PUB }))).json;
  if (!r.record?.fid) throw new Error("PUB owns no fid: " + JSON.stringify(r).slice(0, 200));
}
const recPub = (await view()).records.find((r) => r.personaId === PUB);
if (!recPub) throw new Error("no record for PUB");
let NEW = null, recNew = null, forkRes = null;

await check("1. FORK → NEW FID: forking a persona that owns a fid mints a fresh persona with a FRESH fixture fid (its own fname from its handle, its own custody address, nothing shared with the old record); the OLD fid stays mapped as the decoy; registrant linkage still holds", async () => {
  forkRes = (await fork(PUB, [MAIN], `fid3_new_${stamp}`)).json;
  NEW = forkRes.newPersona;
  if (!NEW || !forkRes.newFid?.fid) throw new Error("fork did not mint a fid: " + JSON.stringify(forkRes).slice(0, 300));
  if (forkRes.fidPending !== false) throw new Error("fixture fork left the fid pending");
  const v = await view();
  recNew = v.records.find((r) => r.personaId === NEW);
  if (!recNew || recNew.fid !== forkRes.newFid.fid) throw new Error("record: " + JSON.stringify(recNew));
  if (recNew.fname !== fnameOf(`fid3_new_${stamp}`)) throw new Error("fname " + recNew.fname + " ≠ " + fnameOf(`fid3_new_${stamp}`));
  if (recNew.fid === recPub.fid || recNew.custodyAddress === recPub.custodyAddress) throw new Error("the new record shares a fid or custody address with the old one");
  const oldStill = v.records.find((r) => r.personaId === PUB);
  if (!oldStill || oldStill.fid !== recPub.fid) throw new Error("the old fid did not stay mapped: " + JSON.stringify(oldStill));
  if (v.map[PUB]?.fid !== recPub.fid || v.map[NEW]?.fid !== recNew.fid) throw new Error("plain map: " + JSON.stringify(v.map));
  const link = (await retry(() => persona("registrantLinkage"))).json;
  if (link.ok !== true) throw new Error("registrant linkage: " + JSON.stringify(link));
});

await check("2. FORWARD POINTER: the carried holder resolves the move to the new persona AND its new fid + fname (the account to follow now); a stranger learns neither the move nor any fid", async () => {
  const res = (await retry(() => api("GET", `/api/identity/fork?resolve=${PUB}&viewerPersonaId=${MAIN}`))).json;
  if (res.moved !== NEW) throw new Error("holder cannot resolve: " + JSON.stringify(res).slice(0, 200));
  if (res.movedFid?.fid !== recNew.fid || res.movedFid?.fname !== recNew.fname) throw new Error("holder did not learn the new fid: " + JSON.stringify(res.movedFid));
  const other = (await api("GET", `/api/identity/fork?resolve=${PUB}&viewerPersonaId=${STRANGER}`)).json;
  if (other?.moved || other?.movedFid) throw new Error("a stranger learned the move or the fid: " + JSON.stringify(other));
});

await check("3. THE VALIDATOR: no plain persona → fid map exists at all (D-FID-5-MAP-SEALED); the fid records, forks and grants are ciphertext if present at all; no plaintext row in its whole state carries the new fid beside the old persona id, a fork record or a registrant", async () => {
  const state = (await vapi("/state")).json?.state ?? {};
  // MULTI-FID Gate 5 (D-FID-5-MAP-SEALED): no plain persona → fid map on the validator at all
  if (state.personaFidMap && Object.keys(state.personaFidMap).length) throw new Error("a plain persona→fid map exists on the validator: " + JSON.stringify(state.personaFidMap).slice(0, 200));
  for (const ns of ["forks", "grantsV3", "personaFids"]) {
    for (const [k, v] of Object.entries(state[ns] ?? {})) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`${ns}/${k} is not ciphertext on the validator`);
  }
  for (const [ns, rows] of Object.entries(state)) {
    for (const [k, v] of Object.entries(rows)) {
      if (v && typeof v === "object" && typeof v.ct === "string") continue; // sealed
      const text = JSON.stringify(v);
      if (ns !== "personaFidMap" && text.includes(String(recNew.fid)) && (text.includes(PUB) || /forkedFrom|oldPersona|registrant/.test(text))) throw new Error(`plaintext row ${ns}/${k} relates the new fid to the old persona`);
      if (text.toLowerCase().includes(recNew.custodyAddress.toLowerCase())) throw new Error(`plaintext row ${ns}/${k} carries the new custody address`);
    }
  }
});

await check("4. CONTINUITY under zk: the fork requests the continuity proof AND mints the fid; after the tick and the drain the new persona's fork claim verifies at the gate tier (z8's oracle) — the validator learned a proven tier and a plain fid, never a relation between them", async () => {
  await retry(() => zk("resetZk"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  try {
    await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
    await retry(() => zk("seedDecoys", { count: 60 }));
    await retry(() => zk("register"));
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const TREE = (await retry(() => zk("gateStatus"))).json.tree;
    const T = Number(String(TREE).slice(5));
    const r = (await fork(NEW, [MAIN], `fid3_zk_${stamp}`)).json;
    if (r.continuity?.proofRequested !== true) throw new Error("no continuity proof requested under zk: " + JSON.stringify(r.continuity));
    if (!r.newFid?.fid || r.newFid.fid === recNew.fid) throw new Error("the zk-mode fork minted no fresh fid: " + JSON.stringify(r.newFid));
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    const claim = (await retry(() => zk("forkClaim", { personaId: r.newPersona, forkCommit: r.continuity.forkCommit }))).json;
    if (claim.verified !== true || claim.tier !== T) throw new Error("fork claim not verified at the gate tier: " + JSON.stringify(claim).slice(0, 200));
  } finally {
    await retry(() => zk("setRepImpl", { impl: null }));
  }
});

await check("5. BLOCKS STAY CLIENT-SIDE: the new persona replies in our timeline and casts on the network under its fid; blocking it drops its reply from OUR feed while the sim network still holds its cast — Farcaster has no block to propagate", async () => {
  const seedPost = (await retry(() => api("GET", "/api/feed2?surface=home"))).json.cards.find((c) => c.kind === "post" && c.cast?.hash);
  if (!seedPost) throw new Error("no seed post to reply to");
  const reply = (await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: seedPost.cast.hash, text: `block me ${stamp}`, asPersonaId: NEW }))).json;
  if (!reply.ok || !reply.hash) throw new Error("act-as reply: " + JSON.stringify(reply));
  const inFeed = async () => (await retry(() => api("GET", "/api/feed?tab=foryou"))).json.casts.find((c) => c.text.includes(`block me ${stamp}`));
  const before = await inFeed();
  if (!before || before.personaId !== NEW) throw new Error("the reply is not in the timeline as the new persona: " + JSON.stringify(before && { personaId: before.personaId, author: before.author?.username }));
  const cast = (await retry(() => write({ action: "cast", personaId: NEW, text: `network cast ${stamp} [layers-test fixture]` }))).json;
  if (cast.fid !== recNew.fid) throw new Error("network cast fid: " + JSON.stringify(cast));
  const blocked = await retry(() => api("POST", "/api/block", { personaId: NEW }));
  if (!blocked.json?.ok && blocked.json?.ok !== undefined) throw new Error("block: " + JSON.stringify(blocked.json));
  const after = await inFeed();
  if (after) throw new Error("the blocked persona's reply is still in our feed");
  const sim = (await retry(() => dev("fcSimNetwork"))).json.casts;
  if (!sim.some((c) => c.hash === cast.hash && c.fid === recNew.fid)) throw new Error("the sim network dropped the cast on a client-side block");
});

await check("6. SURFACES in BOTH network modes: attribution (name, handle), the act-as options and the profile are identical whether a persona is backed by its own fid or the shared one; only the fid under the cast changes", async () => {
  const snapshot = async () => {
    const cast = (await retry(() => write({ action: "cast", personaId: MAIN, text: `mode probe ${stamp} ${Date.now().toString(36)} [layers-test fixture]` }))).json;
    const att = (await attributions([cast.hash]))[cast.hash];
    const opts = (await retry(() => api("GET", "/api/personas/act-as-options"))).json.options.map((o) => o.id).sort();
    const profile = (await retry(() => api("GET", `/api/identity?personaId=${MAIN}`))).json;
    return { att: att && { id: att.id, handle: att.handle, name: att.name }, opts, profile: profile?.identity?.handle ?? null, fid: cast.fid };
  };
  const perPersona = await snapshot();
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  let shared;
  try { shared = await snapshot(); } finally { await retry(() => persona("setNetworkMode", { mode: null })); }
  if (!perPersona.att || JSON.stringify(perPersona.att) !== JSON.stringify(shared.att)) throw new Error("attribution differs by mode: " + JSON.stringify({ perPersona: perPersona.att, shared: shared.att }));
  if (JSON.stringify(perPersona.opts) !== JSON.stringify(shared.opts) || perPersona.profile !== shared.profile || !perPersona.profile) throw new Error("surfaces differ by mode: " + JSON.stringify({ perPersona, shared }).slice(0, 300));
  if (perPersona.fid !== recMain.fid) throw new Error("per-persona-fid mode did not cast under MAIN's own fid: " + perPersona.fid);
  if (shared.fid === recMain.fid) throw new Error("shared-fid mode cast under a persona's fid: " + shared.fid);
});

await check("7. SHARED-FID MODE: a fork mints no fid and reports nothing pending — the v0 path is what it was", async () => {
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    const r = (await fork(idOf("basisrisk") ?? SOURCE0, [], `fid3_shared_${stamp}`)).json;
    if (!r.newPersona) throw new Error("fork failed: " + JSON.stringify(r).slice(0, 200));
    if (r.newFid !== null || r.fidPending !== false) throw new Error("shared-fid fork minted or pended a fid: " + JSON.stringify({ newFid: r.newFid, fidPending: r.fidPending }));
    const v = await view();
    if (v.records.some((x) => x.personaId === r.newPersona)) throw new Error("a record exists for the shared-fid fork");
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 3 (fixture) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
