// PERSONA LAUNCH P6 — LAUNCH ON TEST DATA, on the rig (fixture universe, pinned ports, the SIMULATED registrar: no
// wallet, no chain, no network, $0). The plan's acceptance for P6, check by check:
//   1. NOTHING IS LINKED BEFORE THE CONFIRM: the preview lists exactly P's anon posts (positive control: read from the
//      launch tick's own-rows mirror of the complete anon list — the preview itself fetches nothing), and after it —
//      and after a refused near-miss confirm — the validator has no registrar row, no sim-chain account, no attribution
//      on P's rows; the vault namespaces are byte-unchanged; the validator's request log shows nothing naming P, its
//      custody address, its handle or its name
//   2. THE CLICK WRITES NOTHING: within the confirm's own request no adapter_state row changes and nothing naming P
//      reaches the validator (the launch record rides the sealed queue on its deferred schedule)
//   3. THE REQUEST CARRIES NO DEVICE HEADERS: the queued launch envelope, sent to /zk/anon/submit WITH an x-layers-device
//      header (and a valid proof of work), is REFUSED and queues nothing (negative control); the app's own drain then
//      sends it with only the allowlisted headers and the 4096-byte shape, and it is accepted; the registrar row holds
//      only the request's public fields — and NO arrival hour (review fix LP-6: requested_hour is NULL)
//   4. REGISTRATION LANDS 2 TO 48 HOURS AFTER THE CLICK (sim clock): nothing at +1 h 59 m; registered by +48 h, with the
//      persona's own key vouched by the registrar app fid; one $0 spend row (simulated) for the batch
//   5b. (review fix LP-1) FROM THE BATCH TO "done" the device never wrote personaFids (no PUT, its rows byte-unchanged)
//      and, before its batch reveal, read NOTHING about the new fid off the chain (no /sim-chain/ request at all) — the
//      launched account's record is its sealed launch record
//   5. EVERY anon post of P is revealed (attributed to the new fid, in one batch) and NONE of its sibling S's; the batch
//      signature checks under the key the simulated KeyRegistry lists; the feed card is attributed with checkable
//      "chain" and renders "revealed from @anon · @<fname>"
//   6. A FORGED REVEAL STILL RENDERS ANON: a row written straight into SQLite with an unregistered key, and a batch with
//      a bad signature (400), both leave the card plain anon
//   7. AFTER LAUNCH: the post mode is a REQUIRED choice (preset anon); 'direct' posts a CastAdd signed by the persona key
//      through the thin relay (a wrong key is refused); the launched fid is one of this device's own; a quote-cast of a
//      sibling's anon post is refused; own revealed originals are quoted up to 10 in all, an 11th is refused
//   8. THE PROOF PAGE renders the batch (signature checks, key registered) without minting a root; the launched profile
//      shows the WHOLE history at the original dates, labelled "revealed from @anon"
// Fixture, pinned ports (3001/4001: run through att-run.sh), no network, no spend. It restores what it mutates in
// `finally` (the rep binding, the registrar's fixture rows, the launch caches) and ends with setRepImpl null.
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";
import { request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const HOUR = 3_600_000;
const APP_FID = 7_000_000; // the registrar app fid on the simulated chain (validator/simchain.js)
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name + (typeof extra === "string" ? " — " + extra : "")); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), text: null };
}
async function vapi(method, p, body) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(VBASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw last;
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const launch = (action, extra = {}) => api("POST", "/api/launch", { action, ...extra });
const tickLaunch = () => retry(() => launch("tick", { now: Date.now() + 24 * HOUR }));
const regState = async () => (await retry(() => vapi("GET", "/registrar/dev/state?mode=fixture"))).json;
const anonCasts = async () => (await vapi("GET", "/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const fork = (fromPersona, newHandle) => retry(() => api("POST", "/api/identity/fork", { fromPersona, carry: [], newHandle }));
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;

const readDb = (fn) => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    try { db.exec("PRAGMA busy_timeout = 8000"); } catch { /* a read-only handle may refuse it */ }
    return fn(db);
  } finally {
    db.close();
  }
};
const stateRows = () => readDb((db) => { const m = new Map(); for (const r of db.prepare("SELECT anchor, namespace, key, value FROM adapter_state").all()) m.set(`${r.anchor}|${r.namespace}|${r.key}`, r.value); return m; });
const changedNamespaces = (before, after) => {
  const ns = new Set();
  for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) ns.add(k.split("|")[1]);
  for (const k of before.keys()) if (!after.has(k)) ns.add(k.split("|")[1]);
  return [...ns];
};
const persistPending = async () => (await retry(() => zk("queueStatus"))).json?.persistPending === true;
/** a write window: either nothing changed, or ONLY the sealed queue changed because a persist an EARLIER step scheduled
 *  fired inside it (pending before, not after) — anything else is a write the step itself made */
async function assertNoWriteIn(label, pendingBefore, before) {
  const changed = changedNamespaces(before, stateRows());
  if (!changed.length) return;
  const pendingAfter = await persistPending();
  if (pendingBefore && !pendingAfter && changed.every((ns) => ns === "zkQueue")) { console.log(`        (note: a queue persist an earlier step scheduled fired during ${label} — not a write ${label} made)`); return; }
  throw new Error(`${label} changed device-signed state: namespace(s) ${changed.join(", ")}`);
}
async function settlePersists() {
  for (let i = 0; i < 40 && (await persistPending()); i++) await sleep(500);
  return persistPending();
}
const requestLog = async (since) => (await retry(() => vapi("GET", "/dev/request-log?since=" + since))).json?.entries ?? [];
const naming = (entries, needles) => entries.filter((e) => needles.some((n) => n && ((e.url ?? "").toLowerCase().includes(n.toLowerCase()) || (e.body ?? "").toLowerCase().includes(n.toLowerCase()))));

// the anonymous channel's proof of work — DELIBERATE DUPLICATE of validator/anon.js powValid (h = sha256(sha256(body)hex|nonce))
function solvePow(body, bits) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  for (let n = 0; ; n++) {
    const nonce = "p" + n.toString(36);
    const h = createHash("sha256").update(bodyHash + "|" + nonce).digest();
    let z = 0;
    for (const b of h) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return nonce;
  }
}
/** the constant-size body lib/zk/anon/submit.ts sends (4096 bytes) */
function paddedBody(envelope) {
  const bare = JSON.stringify({ envelope, p: "" });
  return Buffer.from(JSON.stringify({ envelope, p: "x".repeat(4096 - Buffer.byteLength(bare, "utf8")) }), "utf8");
}
function rawPost(url, headers, body) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { host: u.host, "content-length": String(body.length), ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const ed = () => { const { publicKey, privateKey } = generateKeyPairSync("ed25519"); const spki = publicKey.export({ format: "der", type: "spki" }); return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") }; };
const edVerifyHex = (sigHex, canonical, pubHex) => edVerify(null, Buffer.from(canonical, "utf8"), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubHex, "hex")]), format: "der", type: "spki" }), Buffer.from(sigHex, "hex"));
const castListHash = (hs) => createHash("sha256").update([...hs].sort().join(","), "utf8").digest("hex");
const revealBatchCanonical = (mode, fid, key, hs) => ["layers-anon-reveal-batch/1", mode, String(fid), key, castListHash(hs)].join("|");

const stamp = Date.now().toString(36);
await retry(() => dev("resetSeed"));
await retry(() => zk("resetZk"));
await retry(() => zk("setRepImpl", { impl: "zk" }));
let P = null, S = null, handleP = null, fid = null, fname = null, custody = null, signerKey = null;
const postsP = [], postsS = [];
try {
  await retry(() => vapi("POST", "/registrar/dev/reset", { mode: "fixture" }));
  await retry(() => launch("reset"));
  await retry(() => zk("seedDecoys", { count: 60 }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  // P (to launch) and S (its sibling, same root): forks with NO account of their own (shared-fid mode: a fork mints no fid)
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    handleP = `lp_${stamp}`;
    P = (await fork(idOf("brothandbones"), handleP)).json.newPersona;
    S = (await fork(idOf("brothandbones"), `ls_${stamp}`)).json.newPersona;
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
  if (!P || !S) throw new Error("setup: the forks did not mint personas");
  const post = async (text, personaId) => {
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const r = await api("POST", "/api/anon", { text, personaId });
    if (r.status !== 202) throw new Error("anon post: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    await retry(() => zk("drain", { now: Date.now() + 24 * HOUR }));
    const row = (await anonCasts()).find((c) => c.castHash === r.json.castHash);
    if (!row) throw new Error("anon post not relayed: " + r.json.castHash);
    return row;
  };
  // K = 4 a window, shared by the person's personas: two as P, two as S
  postsP.push(await post(`launch me one ${stamp} [layers-test fixture]`, P));
  postsS.push(await post(`sibling one ${stamp} [layers-test fixture]`, S));
  postsP.push(await post(`launch me two ${stamp} [layers-test fixture]`, P));
  postsS.push(await post(`sibling two ${stamp} [layers-test fixture]`, S));
  // the launch tick (run by every prefetch tick) pages the COMPLETE anon list into this device's own-rows mirror; the
  // preview reads only that mirror (review fix W2-LAUNCH-REVEAL-200), so one tick after the last relay
  await retry(() => zk("prefetchNow"));
  await sleep(300);

  let t0 = 0, previewed = null, before = null, pendingBefore = false;
  await check("1. NOTHING IS LINKED BEFORE THE CONFIRM: the preview lists exactly P's anon posts (positive control); after it and a refused near miss, no registrar row, no sim-chain account, no attribution on P's rows, the vault byte-unchanged, and nothing naming P reached the validator", async () => {
    pendingBefore = await settlePersists();
    before = stateRows();
    t0 = Date.now();
    const pv = await retry(() => api("GET", `/api/launch?personaId=${P}`));
    previewed = pv.json;
    const listed = previewed.posts.map((p) => p.castHash).sort();
    if (JSON.stringify(listed) !== JSON.stringify(postsP.map((p) => p.castHash).sort())) throw new Error("the preview does not list exactly P's posts: " + JSON.stringify(previewed.posts.map((p) => p.text)));
    if (!/simulated registrar/.test(previewed.notice) || !/2 to 48 hours/.test(previewed.timing) || !/not set up yet/.test(previewed.price)) throw new Error("the preview's fixed sentences are missing");
    // a confirm with the wrong name is refused and does nothing
    const near = await api("POST", "/api/launch", { action: "confirm", personaId: P, typed: "@" + handleP + "x" });
    if (near.status !== 400 || near.json?.code !== "typed") throw new Error("a wrong typed name was not refused: " + near.status + " " + JSON.stringify(near.json));
    const st = await regState();
    if (st.queue.length !== 0) throw new Error("a registrar row exists before the confirm");
    if (st.chainFids.some((f) => f.fid !== APP_FID)) throw new Error("a sim-chain account exists before the confirm");
    const rows = await anonCasts();
    for (const p of [...postsP, ...postsS]) if (rows.find((r) => r.castHash === p.castHash)?.attributedFid !== null) throw new Error("an anon row is attributed before the confirm");
    await assertNoWriteIn("the preview", pendingBefore, before);
    return previewed.posts.length + " posts previewed";
  });

  let tC0 = 0, tC1 = 0;
  await check("2. THE CLICK WRITES NOTHING: within the confirm's own request no adapter_state row changes (the launch record rides the sealed queue's deferred write)", async () => {
    pendingBefore = await persistPending();
    before = stateRows();
    tC0 = Date.now();
    // review fix LP-4: when the preview could not count the crowd (or counted it under the floor) the confirm needs the
    // explicit acknowledgement — refused without it (and nothing written), accepted with it
    let ackNote = "no acknowledgement needed";
    if (previewed?.crowd?.needsAck === true) {
      const noAck = await api("POST", "/api/launch", { action: "confirm", personaId: P, typed: "@" + handleP, quoteOriginals: postsP.map((p) => p.castHash) });
      if (noAck.status !== 400 || noAck.json?.code !== "crowd") throw new Error("a confirm without the crowd acknowledgement was not refused: " + noAck.status + " " + JSON.stringify(noAck.json));
      ackNote = "the acknowledgement was required (refused without it)";
    }
    const r = await api("POST", "/api/launch", { action: "confirm", personaId: P, typed: "@" + handleP, quoteOriginals: postsP.map((p) => p.castHash), acknowledgeCrowd: previewed?.crowd?.needsAck === true });
    tC1 = Date.now();
    if (r.status !== 202) throw new Error("confirm: " + r.status + " " + JSON.stringify(r.json));
    fname = r.json.fname;
    await assertNoWriteIn("the confirm", pendingBefore, before);
    const again = await api("POST", "/api/launch", { action: "confirm", personaId: P, typed: "@" + handleP });
    if (again.status !== 409) throw new Error("a second launch of the same persona was not refused: " + again.status);
    const sib = await api("POST", "/api/launch", { action: "confirm", personaId: S, typed: "@" + `ls_${stamp}` });
    if (sib.status !== 409 || sib.json?.code !== "window") throw new Error("a second launch in the same window was not refused in plain words: " + sib.status + " " + JSON.stringify(sib.json));
    return `confirmed in ${tC1 - tC0} ms (${ackNote})`;
  });
  const devRec = async () => ((await retry(() => api("GET", "/api/launch?dev=1"))).json?.records ?? []).find((r) => r.personaId === P);
  {
    const rec = await devRec();
    custody = rec?.custody ?? null;
    signerKey = rec?.signerKey ?? null;
  }
  await check("1b. (completing 1 and 2) the validator's request log from the preview to the end of the confirm names neither P, nor its handle, nor its name, nor its custody address", async () => {
    if (!custody) throw new Error("no launch record to read the custody address from");
    const entries = await requestLog(t0);
    const hits = naming(entries.filter((e) => e.at <= tC1 + 50), [P, handleP, fname, custody]);
    if (hits.length) throw new Error("requests named the persona: " + JSON.stringify(hits.slice(0, 3)));
    return `${entries.filter((e) => e.at <= tC1 + 50).length} request(s) checked`;
  });

  let simAtClick = 0;
  let tBatch = 0;
  let rowsBeforeBatch = null;
  await check("3. THE REQUEST CARRIES NO DEVICE HEADERS: with an x-layers-device header (and a valid proof of work) the queued launch envelope is REFUSED and queues nothing; the app's own drain sends it with only the allowlisted headers at 4096 bytes and it is accepted; the registrar row holds only the request's public fields", async () => {
    simAtClick = (await regState()).simNow;
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    const env = (await retry(() => api("GET", `/api/launch?personaId=${P}&envelope=1`))).json;
    if (!env?.envelope) throw new Error("no queued launch envelope (status " + env?.status + ")");
    if (env.envelope.claimKind !== "persona-launch" || env.envelope.publicInputs?.personaId !== "anon") throw new Error("the envelope is not a constant-anon launch claim");
    for (const needle of [P, handleP]) if (JSON.stringify(env.envelope).includes(needle)) throw new Error("the envelope names " + needle);
    const body = paddedBody(env.envelope);
    if (body.length !== 4096) throw new Error("the padded body is not 4096 bytes");
    const pow = solvePow(body, 20);
    const refused = await rawPost(VBASE + "/zk/anon/submit", { "content-type": "application/json", "x-zk-pow": pow, "x-layers-device": "dev_" + stamp }, body);
    if (/accepted/.test(refused.body)) throw new Error("an envelope with a device header was ACCEPTED");
    if ((await regState()).queue.length !== 0) throw new Error("the refused submission queued a launch");
    const qs = (await retry(() => zk("queueStatus"))).json;
    await retry(() => zk("drain", { now: Date.now() + 24 * HOUR }));
    const last = (await retry(() => zk("lastAnon"))).json?.last;
    const allowed = new Set(["host", "content-type", "content-length", "transfer-encoding", "connection", "accept", "accept-encoding", "x-zk-pow"]);
    if (!last || last.headersSent.some((h) => !allowed.has(h)) || last.reusedSocket) throw new Error("the anonymous send carried headers outside the allowlist or reused a socket: " + JSON.stringify(last));
    const st = await regState();
    if (st.queue.length !== 1) throw new Error("the launch was not queued at the registrar (" + st.queue.length + " rows; queued items before the drain: " + qs?.queued + ")");
    const row = st.queue[0];
    const cols = Object.keys(row).sort().join(",");
    if (cols !== "batch_id,due_at,fid,id,launch_commit,mode,request,requested_hour,status") throw new Error("unexpected registrar columns: " + cols);
    const req = JSON.parse(row.request);
    if (Object.keys(req).sort().join(",") !== "addSig,custody,deadlineDay,fname,mode,profile,recovery,registerSig,signerKey,v") throw new Error("the registrar row's request carries other fields: " + Object.keys(req));
    for (const needle of [P, handleP, S]) if (row.request.includes(needle)) throw new Error("the registrar row names " + needle);
    if (req.custody !== custody) throw new Error("the registrar row is not this launch's");
    // review fix LP-6: the arrival hour is NEVER stored beside the future fid (it was kept forever and joined the click
    // hour to the account in any database snapshot)
    if (row.requested_hour !== null) throw new Error("the registrar row keeps the arrival hour (" + row.requested_hour + ")");
    return `sent ${last.headersSent.join(",")}`;
  });

  await check("4. REGISTRATION LANDS 2 TO 48 HOURS AFTER THE CLICK (sim clock): nothing at +1 h 59 m; registered by +48 h with the persona's own key vouched by the registrar app fid; one $0 simulated spend row", async () => {
    await tickLaunch(); // queued → waiting (the submission was accepted)
    let st = await regState();
    await retry(() => vapi("POST", "/registrar/dev/advance-clock", { mode: "fixture", ms: Math.max(0, simAtClick + 2 * HOUR - 60_000 - st.simNow) }));
    await retry(() => vapi("POST", "/registrar/dev/run-batch", { mode: "fixture" }));
    st = await regState();
    if (st.chainFids.some((f) => f.custody === custody)) throw new Error("registered before 2 hours");
    if (st.spend.length !== 0) throw new Error("a spend row before any batch");
    await retry(() => vapi("POST", "/registrar/dev/advance-clock", { mode: "fixture", ms: Math.max(0, simAtClick + 48 * HOUR - st.simNow) }));
    // review fix LP-1 (check 5b): everything from here on — the batch, the device noticing it (the rig's own 3-second
    // ticks may notice it first), the reveal, the name, the history — is in the window 5b reads
    tBatch = Date.now();
    rowsBeforeBatch = stateRows();
    await retry(() => vapi("POST", "/registrar/dev/run-batch", { mode: "fixture" }));
    st = await regState();
    const acct = st.chainFids.find((f) => f.custody === custody);
    if (!acct) throw new Error("not registered by 48 hours (due " + ((st.queue[0]?.due_at - simAtClick) / HOUR).toFixed(2) + " h after the click)");
    fid = acct.fid;
    const keys = st.chainKeys.filter((k) => k.fid === fid);
    if (keys.length !== 1 || keys[0].key !== signerKey || keys[0].request_fid !== APP_FID) throw new Error("the account's key is not the persona's, vouched by the app fid: " + JSON.stringify(keys));
    if (acct.registered_at - simAtClick < 2 * HOUR - 60_000 || acct.registered_at - simAtClick > 48 * HOUR) throw new Error("registered " + ((acct.registered_at - simAtClick) / HOUR).toFixed(2) + " h after the click");
    if (st.spend.length !== 1 || st.spend[0].usd_cents !== 0 || st.spend[0].simulated !== 1) throw new Error("the ledger is not one $0 simulated row: " + JSON.stringify(st.spend));
    return `fid ${fid}, ${((acct.registered_at - simAtClick) / HOUR).toFixed(1)} h after the click`;
  });

  await check("5. EVERY anon post of P is revealed in one batch and NONE of S's; the batch signature checks under the key the simulated KeyRegistry lists; the feed card is attributed (checkable 'chain') and renders 'revealed from @anon · @<fname>'", async () => {
    let stage = null;
    for (let i = 0; i < 10 && stage !== "done"; i++) {
      await tickLaunch();
      stage = (await devRec())?.stage;
      if (stage === "failed") throw new Error("the launch failed: " + (await devRec())?.reason);
    }
    if (stage !== "done") throw new Error("the launch did not finish: stage " + stage + " — " + (await devRec())?.reason);
    const db = readDb((d) => d.prepare("SELECT cast_hash, attributed_fid, attributed_batch, attributed_signer FROM zk_anon_casts WHERE mode = 'fixture'").all());
    for (const p of postsP) {
      const r = db.find((x) => x.cast_hash === p.castHash);
      if (r?.attributed_fid !== fid || !r.attributed_batch || r.attributed_signer !== signerKey) throw new Error("a post of P was not revealed in the batch: " + JSON.stringify(r));
    }
    for (const s of postsS) if (db.find((x) => x.cast_hash === s.castHash)?.attributed_fid !== null) throw new Error("a SIBLING's post was revealed");
    const batches = (await vapi("GET", `/registrar/reveal-batches?mode=fixture&fid=${fid}`)).json?.batches ?? [];
    if (batches.length !== 1) throw new Error(batches.length + " batches");
    const keys = (await vapi("GET", `/sim-chain/keys?mode=fixture&fid=${fid}`)).json?.keys ?? [];
    const b = batches[0];
    if (!keys.some((k) => k.key === b.signer && k.removedAt === null)) throw new Error("the batch signer is not a registered key of the account");
    if (!edVerifyHex(b.signature, revealBatchCanonical("fixture", fid, b.signer, b.castHashes), b.signer)) throw new Error("the batch signature does not verify");
    if (JSON.stringify([...b.castHashes].sort()) !== JSON.stringify(postsP.map((p) => p.castHash).sort())) throw new Error("the batch lists other casts");
    const feed = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json?.cards ?? [];
    const card = feed.find((c) => c.cast?.castHash === postsP[0].castHash);
    if (!card) throw new Error("the revealed post is not in the feed");
    if (card.cast.attributedTo?.checkable !== "chain" || card.cast.attributedTo?.fid !== fid || card.cast.attributedTo?.fname !== fname) throw new Error("the card is not chain-attributed: " + JSON.stringify(card.cast.attributedTo));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const c = page.locator("[data-testid='cast']", { hasText: postsP[0].text }).first();
      await c.waitFor({ timeout: 10_000 });
      const badge = c.locator("[data-testid='cast-revealed-from-anon']").first();
      await badge.waitFor({ timeout: 8000 });
      const t = (await badge.textContent()) ?? "";
      if (!t.includes("revealed from @anon · @" + fname)) throw new Error("the badge says: " + t);
    } finally {
      await browser.close();
    }
    return `fid ${fid} @${fname}`;
  });

  await check("5b. (review fix LP-1) FROM THE BATCH TO 'done' the device never wrote personaFids (no PUT; its rows byte-unchanged) and read NOTHING off the chain before its batch reveal (no /sim-chain/ request) — the launched account's record is its sealed launch record", async () => {
    if (!tBatch || !rowsBeforeBatch) throw new Error("check 4 did not run the batch, so this check would prove nothing");
    const entries = await requestLog(tBatch);
    const puts = entries.filter((e) => e.method === "PUT" && /\/state\/personaFids/.test(e.url ?? ""));
    if (puts.length) throw new Error("personaFids was written during the launch (" + puts.length + " PUT) — the immediate write at a launch step is the beacon");
    const after = stateRows();
    const changed = [...new Set([...after.keys(), ...rowsBeforeBatch.keys()])].filter((k) => k.split("|")[1] === "personaFids" && after.get(k) !== rowsBeforeBatch.get(k));
    if (changed.length) throw new Error("the personaFids rows changed during the launch: " + changed.length);
    const firstReveal = entries.find((e) => e.method === "POST" && (e.url ?? "").startsWith("/zk/anon/reveal"));
    if (!firstReveal) throw new Error("positive control: the batch reveal is not in the request log");
    const early = entries.filter((e) => e.at < firstReveal.at && /\/sim-chain\//.test(e.url ?? ""));
    if (early.length) throw new Error("the device read the new account off the chain before its reveal: " + early.slice(0, 3).map((e) => e.method + " " + e.url).join(", "));
    if (!entries.some((e) => (e.url ?? "").startsWith("/registrar/registrations"))) throw new Error("positive control: the uniform registrations read is not in the log");
    if (!entries.some((e) => e.at > firstReveal.at && /\/sim-chain\//.test(e.url ?? ""))) throw new Error("positive control: no chain read at all after the reveal (the thin relay's key check), so the log may not capture them");
    return `${entries.length} request(s) from the batch to done checked`;
  });

  await check("6. A FORGED REVEAL STILL RENDERS ANON: a row written straight into SQLite under an unregistered key, and a batch with a bad signature (400), both leave the card plain anon", async () => {
    const stray = ed();
    const sibling = postsS[0];
    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      db.prepare("UPDATE zk_anon_casts SET attributed_fid = ?, attributed_at = ?, attributed_signer = ?, attributed_batch = ? WHERE mode = 'fixture' AND cast_hash = ?").run(fid, Math.floor(Date.now() / HOUR) * HOUR, stray.pubHex, "f".repeat(64), sibling.castHash);
    } finally {
      db.close();
    }
    const carried = (await anonCasts()).find((c) => c.castHash === sibling.castHash);
    if (carried?.attributedFid !== fid) throw new Error("the forged row did not land, so this check would prove nothing");
    const bad = await vapi("POST", "/zk/anon/reveal", { batch: true, mode: "fixture", fid, signerPubKey: signerKey, castHashes: [postsS[1].castHash], secrets: [randomBytes(32).toString("hex")], signature: randomBytes(64).toString("hex") });
    if (bad.status !== 400) throw new Error("a batch with a bad signature answered " + bad.status);
    const feed = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json?.cards ?? [];
    for (const s of postsS) {
      const card = feed.find((c) => c.cast?.castHash === s.castHash);
      if (!card) throw new Error("a sibling post is missing from the feed, so this check would prove nothing");
      if (card.cast.attributedTo) throw new Error("a forged or refused reveal rendered a name: " + JSON.stringify(card.cast.attributedTo));
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const c = page.locator("[data-testid='cast']", { hasText: sibling.text }).first();
      await c.waitFor({ timeout: 10_000 });
      if ((await c.locator("[data-testid='cast-revealed-from-anon']").count()) !== 0) throw new Error("the forged row renders 'revealed from @anon'");
      if (/revealed/.test((await c.locator("[data-testid='cast-anon']").first().textContent()) ?? "")) throw new Error("the forged row renders a reveal");
    } finally {
      await browser.close();
    }
  });

  await check("7. AFTER LAUNCH: the post mode is a REQUIRED choice (preset anon); 'direct' posts a CastAdd signed by the persona key through the thin relay, a wrong key is refused; the launched fid is this device's own; a sibling's anon post cannot be quoted; own revealed originals are quoted up to 10 in all and an 11th is refused", async () => {
    const mv = (await retry(() => api("GET", `/api/personas/post-mode?personaId=${P}`))).json;
    if (mv.launched !== true || mv.choiceRequired !== true || mv.mode !== "anon" || !mv.options.includes("direct")) throw new Error("the post mode is not a required choice preset anon: " + JSON.stringify(mv));
    const set = await api("POST", "/api/personas/post-mode", { personaId: P, mode: "direct" });
    if (set.status !== 200 || set.json?.mode !== "direct" || set.json?.choiceRequired !== false) throw new Error("choosing direct: " + set.status + " " + JSON.stringify(set.json));
    const d = await api("POST", "/api/launch", { action: "directPost", personaId: P, text: `direct from my own account ${stamp}` });
    if (d.status !== 200 || d.json?.delivery?.to !== "farcaster" || d.json?.delivery?.mode !== "fixture" || d.json?.fid !== fid || !d.json?.hash) throw new Error("direct post: " + d.status + " " + JSON.stringify(d.json));
    const log = (await retry(() => api("GET", "/api/launch?dev=1"))).json?.relayLog ?? [];
    if (!log.some((e) => e.fid === fid && e.type === "CastAdd" && e.hash === d.json.hash)) throw new Error("the direct post is not a CastAdd on the thin relay's log");
    const wrong = await api("POST", "/api/launch", { action: "thinRelayProbe", fid, personaId: P, signWith: "wrong", text: "not my key" });
    if (wrong.status !== 422 || wrong.json?.code !== "wrong-key") throw new Error("a wrong key was not refused: " + wrong.status + " " + JSON.stringify(wrong.json));
    const right = await api("POST", "/api/launch", { action: "thinRelayProbe", fid, personaId: P, signWith: "persona", text: "my key " + stamp });
    if (right.status !== 200) throw new Error("the persona's own key was refused (so the refusal above proves nothing): " + JSON.stringify(right.json));
    const own = await api("POST", "/api/anon", { action: "ownFidCheck", fid });
    if (own.json?.own !== true) throw new Error("the launched fid is not one of this device's own: " + JSON.stringify(own.json));
    const sib = await api("POST", "/api/launch", { action: "quote", personaId: P, quoteOf: postsS[1].hash, text: "quoting a sibling " + stamp });
    if (sib.status !== 403 || !sib.json?.selfLink) throw new Error("a sibling's anon post was quoted: " + sib.status + " " + JSON.stringify(sib.json));
    const quotedSoFar = log.filter((e) => e.fid === fid && e.type === "CastAdd" && e.quoteHash).length;
    if (quotedSoFar !== 2) throw new Error("the history did not quote the two chosen originals (" + quotedSoFar + ")");
    for (let i = quotedSoFar; i < 10; i++) {
      const q = await api("POST", "/api/launch", { action: "quote", personaId: P, quoteOf: postsP[i % 2].hash, text: `from my anonymous posts, again ${i} ${stamp}` });
      if (q.status !== 200) throw new Error(`quote ${i + 1} of 10 was refused: ` + q.status + " " + JSON.stringify(q.json));
    }
    const eleventh = await api("POST", "/api/launch", { action: "quote", personaId: P, quoteOf: postsP[0].hash, text: `one too many ${stamp}` });
    if (eleventh.status !== 403 || !/at most 10/.test(eleventh.json?.error ?? "")) throw new Error("an 11th quote was not refused: " + eleventh.status + " " + JSON.stringify(eleventh.json));
  });

  await check("8. THE PROOF PAGE renders the batch (signature checks, key registered) without minting a root; the launched profile shows the WHOLE history at the original dates, labelled 'revealed from @anon'", async () => {
    const rootsBefore = (await vapi("GET", "/health")).json?.roots;
    const res = await fetch(BASE + "/proof/" + fid);
    const html = await res.text();
    if (res.status !== 200 || !/data-testid="proof-batch"/.test(html)) throw new Error("the proof page did not render a batch (" + res.status + ")");
    if (!/data-signature-checks="true"/.test(html) || !/data-key-registered="true"/.test(html)) throw new Error("the proof page's checks do not pass");
    if (!/Test data/.test(html)) throw new Error("the proof page is not labelled test data");
    if (/device\/boot\.js/.test(html)) throw new Error("the proof page boots a device");
    const rootsAfter = (await vapi("GET", "/health")).json?.roots;
    if (rootsBefore !== rootsAfter) throw new Error("rendering the proof page minted a root (" + rootsBefore + " → " + rootsAfter + ")");
    const h = (await retry(() => api("GET", `/api/launch?history=1&fid=${fid}`))).json;
    // VERIFY (wave 2, harness fix): check 6 leaves its FORGED row in the table (a sibling's post attributed to this fid
    // under an unregistered key), so the history read must leave exactly that row out and COUNT it as unchecked — the
    // old "unchecked === 0" only held when check 6 had not run. Stronger now: the forged rows are counted from the
    // public list, every one must be unchecked, and none may appear among the items.
    const forged = (await anonCasts()).filter((c) => c.attributedFid === fid && !postsP.some((p) => p.castHash === c.castHash)).map((c) => c.castHash);
    if ((h.items ?? []).some((x) => forged.includes(x.castHash))) throw new Error("a forged row is in the revealed history");
    if ((h.items ?? []).length !== 2 || h.unchecked !== forged.length) throw new Error("the revealed history is not P's two posts: " + JSON.stringify({ n: (h.items ?? []).length, unchecked: h.unchecked, forged: forged.length, items: (h.items ?? []).map((x) => ({ c: x.castHash.slice(0, 8), t: x.text.slice(0, 40), at: x.at, k: x.checkable })), want: postsP.map((p) => ({ c: p.castHash.slice(0, 8), at: p.at })) }));
    for (const p of postsP) {
      const it = h.items.find((x) => x.castHash === p.castHash);
      if (!it || it.at !== p.at || it.label !== "revealed from @anon" || it.checkable !== "chain") throw new Error("an item is not at its original date / labelled: " + JSON.stringify(it));
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/" + handleP, { waitUntil: "networkidle" });
      const items = page.locator("[data-testid='revealed-history-item']");
      for (let i = 0; i < 20 && (await items.count()) < 2; i++) await sleep(300);
      if ((await items.count()) !== 2) throw new Error("the profile shows " + (await items.count()) + " revealed posts");
      const labels = await page.locator("[data-testid='revealed-history-label']").allTextContents();
      if (!labels.every((l) => l === "revealed from @anon")) throw new Error("labels: " + labels.join(" / "));
      const ats = (await items.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-at"))))).sort();
      if (JSON.stringify(ats) !== JSON.stringify(postsP.map((p) => p.at).sort())) throw new Error("the profile's dates are not the original ones");
    } finally {
      await browser.close();
    }
  });
} catch (e) {
  fail("setup", e.message);
} finally {
  await retry(() => vapi("POST", "/registrar/dev/reset", { mode: "fixture" })).catch(() => {});
  await retry(() => launch("reset")).catch(() => {});
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await retry(() => dev("resetSeed")).catch(() => {});
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Launch (persona launch P6, simulated registrar) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
void existsSync;
