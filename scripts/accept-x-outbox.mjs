// PERSONA LAUNCH P8 — acceptance (fixture rig): THE @totem X OUTBOX. Test data only: no X call leaves the fixture.
//   0. NO MODERATOR, NO COPY (wave 3, UXH-6): before a moderator key exists the outbox is not offered and a copy is
//      refused with nothing minted; a registered key turns it on
//   1. THE TOGGLE: with "Post anonymously" ticked in the fixture universe, "Also post to @totem on X — test data: nothing
//      reaches X" is offered, DEFAULT OFF, with the same-words sentence; in the live universe it is not offered and the
//      server says why
//   2. A COMPOSER POST WITH THE TOGGLE → the anonymous post AND an X copy (the copy names its sibling only on this
//      device); the tick proves x-anon-post over the PLAIN tree with exactly {text, nonce}; the drain sends it over the
//      ANONYMOUS channel (no device envelope); the validator's row is 'review'; the public list shows id + status + hour
//      and NO text; the composer's line says "Waiting for review (test data)"
//   3. NO MODERATION, NO POST: relay-now twice leaves it in review; the fixture transport log stays empty
//   4. MODERATION: a forged signature, an unregistered key and a signature for another id are refused; this device,
//      registered as the rig's moderator, approves → relay-now → 'posted' through the FIXTURE transport (exactly one log
//      entry, destination fixture) and the composer's line says nothing reached X
//   5. REJECT: a rejected copy never posts; its row is kept (text in the database, never shown) and the device says
//      "Not approved"
//   6. ONE X SLOT A WINDOW (K_X = 1): a second copy in the window is refused at compose with nothing minted; a FORCED one
//      (dev hooks) re-uses the slot and the VALIDATOR answers replay; Farcaster anon posts in the same window still go; the
//      X nullifier differs from every anon-post nullifier of the window
//  6b. THE COMPARTMENT (wave 3, UXH-1): a sibling persona's copy is listed while every persona is visible and absent
//      under compartment mode (list and single read); the view carries no personaId / copyOf (the rig reads the sealed
//      record through the envelope read)
//   7. THE POLICY at compose AND at the validator: two links, an @mention, > 280, a full repost refused at both; a
//      quote-and-link accepted at both
//  7b. THE COPY FIRST (wave 3, UXH-5): an over-length ticked copy shows the reason under the box and holds Post — nothing
//      is sent; unticking releases Post
//   8. NOTHING LEAVES THE MACHINE: every page request of this suite's browser is loopback or a fixture avatar image (no
//      API call, script or document leaves); a guarded rig-shaped validator on :4057 (temp DB, the network guard
//      preloaded, its network-reaching subsystems off by their own switches) runs submit → moderate → relay → posted
//      with an EMPTY guard log beside the guard's recorded positive control; and a static grep: validator/xoutbox.js and
//      lib/x/outbox/** import no socket/http/fetch and name no X API host
//   9. THE OPERATOR'S VIEW: x_outbox, its decisions and the fixture posts hold no persona id, root id, nullifier, slot or
//      device id; the X row id differs from the copied post's cast hash; every time is hour-grained
//  10. SETTINGS: /settings lists the X outbox and the DM inbox as test data; /settings/x-outbox renders; /settings/dm-hook
//      keeps dm-hook-mode == "fixture" and shows dm-hook-test-data
//  11. RESETS: resetZk and resetSeed wipe the fixture outbox and the dev moderators
// Fixture, pinned ports, no network, no spend. Goes INFRA near a 6-hour epoch boundary like every anon-posting suite (a
// proof is deferred to the next epoch): re-run it after the boundary. Run with the rig up (the harness's ports):
//   bash <scratchpad>/att-run.sh scripts/accept-x-outbox.mjs        (npm run test:x-outbox once the verify agent adds it)
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const GUARD_PORT = 4057;
const MAIN = "persona_viewer_main";
const HOUR = 3_600_000;
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(method, p, body, base = VBASE) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
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
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const xo = (body) => api("POST", "/api/x/outbox", body);
const xView = async (xHash, envelope = false) => (await retry(() => api("GET", "/api/x/outbox" + (xHash ? `?xHash=${xHash}${envelope ? "&envelope=1" : ""}` : "")))).json;
const anonStatus = async (castHash, envelope = false) => (await retry(() => api("GET", `/api/anon?castHash=${castHash}${envelope ? "&envelope=1" : ""}`))).json;
const publicList = async () => (await vapi("GET", "/x/outbox?mode=fixture")).json.items;
const transportLog = async () => (await vapi("GET", "/x/outbox/dev/transport-log?mode=fixture")).json.entries;
const relayNow = () => retry(() => xo({ action: "relayNow" }));
const drain = () => retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
/** one tick NOW (prefetch + the outbox read + the wanted proofs), reporting an epoch-edge deferral as the rig condition it is */
async function tick({ anon = [], x = [] } = {}) {
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  for (const h of anon) {
    const s = await anonStatus(h);
    if (s?.outcome?.lastStage === "epoch-edge" && s.status === "wanted") throw new Error("INFRA: the rig's epoch ends inside the jitter window — the post is deferred to the next epoch; re-run after the boundary");
  }
  for (const h of x) {
    const v = await xView(h);
    if (v?.item?.lastStage === "epoch-edge" && v.item.state === "deferred") throw new Error("INFRA: the rig's epoch ends inside the jitter window — the X copy is deferred to the next epoch; re-run after the boundary");
  }
}
/** the rig's own outbox read now (the composer line and the device view read the last tick's list) */
const readOutbox = () => retry(() => xo({ action: "readOutbox" }));
const db = () => {
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try { d.exec("PRAGMA busy_timeout = 8000"); } catch { /* read-only handle */ }
  return d;
};
const edKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, pubHex: spki.subarray(spki.length - 32).toString("hex") };
};
const signHex = (c, k) => cryptoSign(null, Buffer.from(c, "utf8"), k.privateKey).toString("hex");
const hourNow = () => Math.floor(Date.now() / HOUR);
// PERSONA LAUNCH wave 3 (W3-X-MOD-SAME-HOUR): moderate/2 signs a fresh 32-hex nonce into every decision
const moderateBody = (k, id, decision, issuedHour = hourNow(), nonce = randomBytes(16).toString("hex")) => ({ mode: "fixture", id, decision, issuedHour, nonce, pubkey: k.pubHex, sig: signHex(["layers-x-moderate/2", "fixture", id, decision, String(issuedHour), nonce].join("|"), k) });
const vz = require(path.join(ROOT, "validator", "zk.js"));
/** an x-anon-post envelope as lib/zk/prove.ts builds it, for the validator's dev door (its refusal reasons are the oracle) */
function xEnvelope(o) {
  const nonce = o.nonce ?? randomBytes(16).toString("hex");
  const xHash = vz.xAnonHash(o.text, nonce);
  const scopeStr = `layers/zk-scope/v1|x-anon-post/${vz.anonPostWindowOf(o.epoch)}/s0`;
  const scope = vz.fieldOf("scope", scopeStr);
  const challenge = "epoch-" + o.epoch;
  const message = vz.fieldOf("message", ["anon", "x-anon-post", "x:" + xHash, challenge, o.root].join("|"));
  const pub = { mode: "fixture", claimKind: "x-anon-post", tree: o.tree, epoch: o.epoch, merkleTreeRoot: o.root, scope, message, personaId: "anon", gateId: "x-anon-post", challenge, xHash, slot: 0 };
  const nullifier = vz.fieldOf("accept-x-outbox-nullifier", scopeStr + "|" + (o.person ?? randomBytes(6).toString("hex")));
  return { v: 1, mode: "fixture", claimKind: "x-anon-post", publicInputs: pub, nullifier, proof: { scheme: "layers-zk-fixture/1", tag: vz.fixtureTag(vz.canonicalPublicInputs(pub), nullifier) }, payload: { text: o.text, nonce } };
}

await assertServersUp(BASE);
console.log("\nPersona launch P8 — the @totem X outbox (test data: nothing reaches X)");
if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);

const stamp = Date.now().toString(36);
let TREE = null;
let browser = null;
let page = null;
const pageRequests = []; // every request this suite's browser made: { url, type }
const S = { xHash: null, castHash: null, text: null, xHash2: null, castHash2: null, nullifiers: { x: [], anon: [] } };
// PERSONA LAUNCH wave 3 (UXH-1): a SIBLING persona of this root (a shared-fid fork: no account of its own, so it posts
// anonymously), whose X copy the compartment view must hide
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(JSON.parse(readFileSync(path.join(ROOT, "seed/data/accounts.json"), "utf8")));
const SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;
let P2 = null;

await retry(() => dev("resetSeed"));
await retry(() => zk("resetZk"));
try {
  // the sibling, minted under the mock binding before the proof layer is armed (as accept-anon-slots does)
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    const f = await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `xout_sib_${stamp.slice(-4)}` }));
    P2 = f.json?.newPersona ?? null;
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("seedDecoys", { count: 60 }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  TREE = (await vapi("GET", "/zk/anon-post/config?mode=fixture")).json?.tree;
  if (!TREE) throw new Error("the validator names no anon tree");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // NOTHING LEAVES: every request this browser makes is recorded; a non-loopback one is aborted (it never leaves) and
  // judged in check 8 (a fixture avatar image is the rig's seed content; anything else is a failure)
  await context.route("**/*", (route) => {
    const req = route.request();
    pageRequests.push({ url: req.url(), type: req.resourceType() });
    let host = "";
    try { host = new URL(req.url()).hostname; } catch { host = ""; }
    if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(host) || req.url().startsWith("data:") || req.url().startsWith("blob:")) return route.continue();
    return route.abort();
  });
  page = await context.newPage();

  await check("0. NO MODERATOR, NO COPY (UXH-6): before any moderator is set up the outbox is not offered — GET says so in plain words and a copy is refused 503 'unavailable' with nothing minted (a copy would wait for review forever); once a moderator key is registered and the outbox read, it is offered", async () => {
    await readOutbox();
    const v = await xView(null);
    if (v.offered !== false || v.reason !== "No moderator is set up for @totem on X yet, so a copy would never go out." || v.config?.moderated !== false) throw new Error("not offered without a moderator: " + JSON.stringify({ offered: v.offered, reason: v.reason, moderated: v.config?.moderated }));
    const before = v.items?.length ?? 0;
    const r = await xo({ text: `no moderator ${stamp}` });
    if (r.status !== 503 || r.json?.code !== "unavailable" || !/No moderator is set up/.test(r.json?.error ?? "")) throw new Error("a copy was taken with no moderator: " + r.status + " " + JSON.stringify(r.json));
    if (((await xView(null)).items?.length ?? 0) !== before) throw new Error("the refused copy minted a record");
    // the rig's moderator: a key of its own (this device registers its own in check 4)
    const k = edKey();
    if ((await vapi("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex })).status !== 201) throw new Error("setup: the rig's moderator key did not register");
    await readOutbox();
    const after = await xView(null);
    if (after.offered !== true || after.config?.moderated !== true) throw new Error("still not offered with a moderator: " + JSON.stringify({ offered: after.offered, reason: after.reason }));
  });

  await check("1. THE TOGGLE: with 'Post anonymously' ticked (the fixture universe) the X box is offered, DEFAULT OFF, labelled 'test data: nothing reaches X', with the same-words sentence; in the live universe the server says it is not offered and why, and the composer offers no X box", async () => {
    await page.goto(BASE + "/home", { waitUntil: "networkidle" });
    await page.locator("[data-testid='composer-input']").first().click();
    const anon = page.locator("[data-testid='composer-anon']").first();
    await anon.waitFor({ timeout: 15000 });
    let on = false;
    for (let i = 0; i < 40 && !on; i++) { on = await anon.isChecked(); if (!on) await sleep(300); }
    if (!on) throw new Error("setup: 'Post anonymously' is not on for MAIN (anon mode) under the proof layer");
    const xbox = page.locator("[data-testid='composer-x-toggle']").first();
    await xbox.waitFor({ timeout: 15000 }); // the settled answer (the pending placeholder has another testid)
    if (await xbox.isChecked()) throw new Error("the X box is ticked by default");
    if ((await page.locator("[data-testid='composer-x-panel']").first().getAttribute("data-state")) !== "off") throw new Error("the X panel is not 'off'");
    const label = (await page.locator("[data-testid='composer-x-label']").first().textContent()) ?? "";
    if (label !== "Also post to @totem on X — test data: nothing reaches X") throw new Error("label: " + label);
    const note = (await page.locator("[data-testid='composer-x-note']").first().textContent()) ?? "";
    if (!note.startsWith("A copy on X has the same words: if you launch this persona, it will read as yours too. Posts to X are never revealed by a launch.")) throw new Error("note: " + note);
    // unticking 'Post anonymously' takes the X box away
    await anon.uncheck();
    await sleep(300);
    if ((await page.locator("[data-testid='composer-x-toggle']").count()) !== 0) throw new Error("the X box shows without 'Post anonymously'");
    await anon.check();
    await xbox.waitFor({ timeout: 15000 });
    // the live universe.
    // PERSONA LAUNCH wave 3 (verify, rig pollution): the rig's prefetch tick proves whatever is WANTED in whichever
    // universe it runs in (lib/zk/gate.ts keeps one wanted set), and rendering /home under the zk rep binding marks MAIN
    // wanted (app/(main)/home/page.tsx requestEligibility). So a /home render inside this live window, or MAIN still wanted
    // from the /home render above, let a live-mode tick prove MAIN's For You eligibility and record a LIVE zk_eligibility
    // row naming persona_viewer_main — live rows are never reset on the rig, and accept-linkage6 check 4 then failed on it
    // (wave-3 sweep 2, 2026-10-13). So: settle the wanted set in the TEST universe first, render the composer through the
    // compose modal on /notifications (a page that asks for no eligibility), and prove nothing was attempted while live.
    await retry(() => zk("prefetchNow"));
    const liveFrom = Date.now();
    await retry(() => zk("setZkMode", { zkMode: "live" }));
    try {
      const v = await xView(null);
      if (v.offered !== false || !/test data only/.test(v.reason ?? "") || v.testData !== true) throw new Error("live: " + JSON.stringify({ offered: v.offered, reason: v.reason, testData: v.testData }));
      const p2 = await context.newPage();
      try {
        await p2.goto(BASE + "/notifications", { waitUntil: "networkidle" });
        await p2.locator("[data-testid='nav-post-button']").first().click();
        await p2.locator("[data-testid='composer-input']").first().click();
        // the anon panel settles one way or the other; either way no X box is offered
        await p2.locator("[data-testid='composer-anon-panel']").first().waitFor({ timeout: 15000 });
        await sleep(2500);
        if ((await p2.locator("[data-testid='composer-x-toggle']").count()) !== 0) throw new Error("the live universe offers the X box");
        const said = (await p2.locator("[data-testid='composer-x-unavailable']").count()) ? (await p2.locator("[data-testid='composer-x-unavailable']").first().textContent()) : "(anonymous posting itself is not offered in the live universe here)";
        // nothing was PROVED while the universe was live (a proof attempt records a stage other than "wanted"); read
        // before the universe is switched back, so a tick that is still running live is caught too
        const gs = (await retry(() => zk("gateStatus"))).json;
        if (!Array.isArray(gs?.attempts)) throw new Error("the gate status has no attempts list: " + JSON.stringify(gs).slice(0, 160));
        const provedLive = gs.attempts.filter((a) => a.at >= liveFrom && a.stage !== "wanted");
        if (provedLive.length) throw new Error("a proof was attempted while the universe was live: " + JSON.stringify(provedLive.slice(0, 3)));
        return "default off; live: " + v.reason + " — composer: " + said + " — nothing proved while live";
      } finally {
        await p2.close();
      }
    } finally {
      await retry(() => zk("setZkMode", { zkMode: null }));
      await retry(() => zk("prefetchNow"));
    }
  });

  await check("2. A COMPOSER POST WITH THE TOGGLE: the anonymous post AND an X copy (the copy's sibling known only to this device); the tick proves x-anon-post over the plain tree with exactly {text, nonce}; the drain sends it over the anonymous channel (no device envelope); the validator's row is 'review'; the public list shows id + status + hour with NO text; the composer's line says 'Waiting for review (test data)'", async () => {
    await readOutbox();
    S.text = `a copy for X ${stamp} [layers-test fixture]`;
    const before = (await xView(null)).items?.length ?? 0;
    await page.locator("[data-testid='composer-input']").first().fill(S.text);
    await page.locator("[data-testid='composer-x-toggle']").first().check();
    await page.locator("[data-testid='composer-submit']").first().click();
    await page.locator("[data-testid='anon-post-status']").first().waitFor({ timeout: 15000 });
    await page.locator("[data-testid='x-outbox-status']").first().waitFor({ timeout: 15000 });
    const v = await xView(null);
    if ((v.items?.length ?? 0) !== before + 1) throw new Error("not exactly one new X copy on this device: " + JSON.stringify(v.items));
    const mine = v.items[0];
    S.xHash = mine.xHash;
    // UXH-1: the product view carries neither the persona nor the copied post — the RIG reads them off the sealed record
    if ("personaId" in mine || "copyOf" in mine) throw new Error("the X view carries personaId / copyOf: " + JSON.stringify(mine));
    const rec = (await xView(S.xHash, true)).record;
    S.castHash = rec?.copyOf ?? null;
    if (!/^[0-9a-f]{64}$/.test(S.xHash ?? "") || !/^[0-9a-f]{64}$/.test(S.castHash ?? "") || rec?.personaId !== MAIN) throw new Error("the copy's sealed record: " + JSON.stringify(rec));
    const a = await anonStatus(S.castHash);
    if (!["wanted", "queued"].includes(a.status)) throw new Error("the anonymous post itself is not on its way: " + a.status);
    await tick({ anon: [S.castHash], x: [S.xHash] });
    const ev = (await xView(S.xHash, true)).envelope;
    if (!ev || ev.status !== "queued") throw new Error("the X copy was not queued at the tick: " + JSON.stringify((await xView(S.xHash)).item));
    const e = ev.envelope;
    if (e.claimKind !== "x-anon-post" || e.publicInputs.tree !== TREE || e.publicInputs.personaId !== "anon" || e.publicInputs.slot !== 0 || e.publicInputs.xHash !== S.xHash) throw new Error("the X envelope: " + JSON.stringify(e.publicInputs));
    if (JSON.stringify(Object.keys(e.payload).sort()) !== JSON.stringify(["nonce", "text"]) || e.payload.text !== S.text) throw new Error("the X payload is not exactly {text, nonce}: " + JSON.stringify(Object.keys(e.payload)));
    const bare = JSON.stringify(e);
    if (bare.includes(MAIN) || bare.includes(S.castHash)) throw new Error("the X envelope carries the persona or its sibling's cast hash");
    S.nullifiers.x.push(String(e.nullifier));
    const an = (await anonStatus(S.castHash, true)).envelope;
    if (an?.nullifier) S.nullifiers.anon.push(String(an.nullifier));
    const since = Date.now();
    await drain();
    const after = (await xView(S.xHash, true)).envelope;
    if (!after || after.status !== "sent" || after.outcome !== "accepted") throw new Error("the X copy was not accepted: " + JSON.stringify(after && { status: after.status, outcome: after.outcome }));
    const log = (await vapi("GET", "/dev/request-log?since=" + since)).json?.entries ?? [];
    const anonSends = log.filter((x) => x.method === "POST" && x.url.startsWith("/zk/anon/"));
    if (anonSends.length < 2 || anonSends.some((x) => x.device)) throw new Error("the sends did not go over the anonymous channel without a device envelope: " + JSON.stringify(anonSends));
    if (log.some((x) => x.url.startsWith("/zk/submit"))) throw new Error("something used the dev door during the drain");
    const row = (await publicList()).find((r) => r.id === S.xHash);
    if (!row || row.status !== "review" || row.text !== null || row.postedId !== null || row.hour % HOUR !== 0) throw new Error("the public row: " + JSON.stringify(row));
    await readOutbox();
    const it = (await xView(S.xHash)).item;
    if (it.state !== "review" || !/^Waiting for review \(test data\)/.test(it.sentence)) throw new Error("the device's status: " + JSON.stringify(it));
    let line = "";
    for (let i = 0; i < 30 && !/Waiting for review \(test data\)/.test(line); i++) { line = (await page.locator("[data-testid='x-outbox-status']").first().textContent()) ?? ""; if (!/Waiting for review/.test(line)) await sleep(500); }
    if (!/Waiting for review \(test data\)/.test(line)) throw new Error("the composer's line: " + line);
    return "xHash " + S.xHash.slice(0, 10) + "… review; the line: " + line.slice(0, 80);
  });

  await check("3. NO MODERATION, NO POST: relay-now twice leaves the copy in review and the fixture transport log empty", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await relayNow();
      if (r.json.posted !== 0) throw new Error("relay-now posted an unapproved copy: " + JSON.stringify(r.json));
    }
    if ((await transportLog()).length !== 0) throw new Error("the fixture transport logged a post nobody approved");
    if ((await publicList()).find((r) => r.id === S.xHash)?.status !== "review") throw new Error("the copy left review without a decision");
  });

  await check("4. MODERATION: a forged signature, an unregistered key and a signature for another id are refused (403); this device, registered as the rig's moderator, approves → relay-now → 'posted' through the FIXTURE transport (one log entry, destination fixture); the composer's line says nothing reached X", async () => {
    const stranger = edKey();
    const un = await vapi("POST", "/x/outbox/moderate", moderateBody(stranger, S.xHash, "approve"));
    if (un.status !== 403) throw new Error("an unregistered key's decision: " + un.status + " " + JSON.stringify(un.json));
    // a key the rig registers, to prove the signature binds the id and is checked
    const rigKey = edKey();
    if ((await vapi("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: rigKey.pubHex })).status !== 201) throw new Error("setup: the rig's key did not register");
    const forged = moderateBody(rigKey, S.xHash, "approve");
    forged.sig = forged.sig.slice(0, 20) + (forged.sig[20] === "0" ? "1" : "0") + forged.sig.slice(21);
    const f = await vapi("POST", "/x/outbox/moderate", forged);
    if (f.status !== 403) throw new Error("a forged decision: " + f.status);
    const other = await vapi("POST", "/x/outbox/moderate", { ...moderateBody(rigKey, "f".repeat(64), "approve"), id: S.xHash });
    if (other.status !== 403) throw new Error("a decision signed for another id: " + other.status);
    if ((await publicList()).find((r) => r.id === S.xHash)?.status !== "review") throw new Error("a refused decision moved the copy");
    // this device as the moderator (its key is the HKDF branch of its vault key; the validator holds the public half)
    const reg = await retry(() => xo({ action: "registerModerator" }));
    if (!Array.isArray(reg.json?.moderators) || reg.json.moderators.length < 2) throw new Error("the device's moderator key did not register: " + JSON.stringify(reg.json));
    await readOutbox();
    const mv = (await xView(null)).moderator;
    if (!mv?.isModerator || !/^[0-9a-f]{64}$/.test(mv.pubkey ?? "")) throw new Error("the device does not see itself as the moderator: " + JSON.stringify(mv));
    const rv = await retry(() => xo({ action: "review" }));
    if (!(rv.json?.items ?? []).some((x) => x.id === S.xHash && x.text === S.text)) throw new Error("the moderator's review read does not show the copy's text: " + JSON.stringify(rv.json).slice(0, 300));
    const ap = await retry(() => xo({ action: "moderate", id: S.xHash, decision: "approve" }));
    if (ap.json?.status !== "approved") throw new Error("approve: " + JSON.stringify(ap.json));
    const rel = await relayNow();
    // (the outbox's own hourly slot may have taken it a moment earlier: the transport log is the record either way)
    if (rel.json.destination !== "fixture" || rel.json.posted > 1) throw new Error("relay-now: " + JSON.stringify(rel.json));
    const log = await transportLog();
    if (log.length !== 1 || log[0].destination !== "fixture" || log[0].text !== S.text || !/^xfix_[0-9a-f]{24}$/.test(log[0].postedId)) throw new Error("the transport log: " + JSON.stringify(log));
    const row = (await publicList()).find((r) => r.id === S.xHash);
    if (row?.status !== "posted" || row.text !== S.text || row.postedId !== log[0].postedId) throw new Error("the public row once posted: " + JSON.stringify(row));
    await readOutbox();
    const it = (await xView(S.xHash)).item;
    if (it.state !== "posted" || it.sentence !== "Posted (test data — nothing reached X).") throw new Error("the device's status: " + JSON.stringify(it));
    let line = "";
    for (let i = 0; i < 30 && !/nothing reached X/.test(line); i++) { line = (await page.locator("[data-testid='x-outbox-status']").first().textContent()) ?? ""; if (!/nothing reached X/.test(line)) await sleep(500); }
    if (!/Posted \(test data — nothing reached X\)/.test(line)) throw new Error("the composer's line: " + line);
    return "one fixture post " + log[0].postedId;
  });

  await check("5. REJECT: in a new window a second copy is rejected by the moderator; relay-now never posts it; its row is kept (the text in the database, never shown: rejected, text null in the list) and this device says 'Not approved'", async () => {
    await retry(() => zk("advanceEpoch"));
    await tick();
    const t2 = `a copy nobody approves ${stamp} [layers-test fixture]`;
    const a = await retry(() => api("POST", "/api/anon", { text: t2 }));
    S.castHash2 = a.json.castHash;
    const x = await retry(() => xo({ text: t2, copyOf: S.castHash2 }));
    if (x.status !== 202 || !/^[0-9a-f]{64}$/.test(x.json?.xHash ?? "")) throw new Error("the second copy: " + x.status + " " + JSON.stringify(x.json));
    S.xHash2 = x.json.xHash;
    await tick({ anon: [S.castHash2], x: [S.xHash2] });
    const ev = (await xView(S.xHash2, true)).envelope;
    if (!ev || ev.status !== "queued") throw new Error("the second copy was not queued: " + JSON.stringify((await xView(S.xHash2)).item));
    S.nullifiers.x.push(String(ev.envelope.nullifier));
    const an = (await anonStatus(S.castHash2, true)).envelope;
    if (an?.nullifier) S.nullifiers.anon.push(String(an.nullifier));
    await drain();
    if ((await publicList()).find((r) => r.id === S.xHash2)?.status !== "review") throw new Error("the second copy is not in review");
    const rj = await retry(() => xo({ action: "moderate", id: S.xHash2, decision: "reject" }));
    if (rj.json?.status !== "rejected") throw new Error("reject: " + JSON.stringify(rj.json));
    for (let i = 0; i < 2; i++) if ((await relayNow()).json.posted !== 0) throw new Error("relay-now posted a rejected copy");
    if ((await transportLog()).length !== 1) throw new Error("the transport log grew after a rejection");
    const row = (await publicList()).find((r) => r.id === S.xHash2);
    if (row?.status !== "rejected" || row.text !== null || row.postedId !== null) throw new Error("the rejected row in the public list: " + JSON.stringify(row));
    const d = db();
    try {
      const kept = d.prepare("SELECT status, text FROM x_outbox WHERE mode = 'fixture' AND id = ?").get(S.xHash2);
      if (!kept || kept.status !== "rejected" || kept.text !== t2) throw new Error("the rejected row was not kept: " + JSON.stringify(kept && { ...kept }));
    } finally {
      d.close();
    }
    await readOutbox();
    const it = (await xView(S.xHash2)).item;
    if (it.state !== "rejected" || !/^Not approved \(test data\)/.test(it.sentence)) throw new Error("the device's status: " + JSON.stringify(it));
  });

  await check("6. ONE X SLOT A WINDOW (K_X = 1): a second copy in this window is refused 409 at compose with nothing minted; Farcaster anon posts in the same window still go; a FORCED copy (dev hooks) re-uses the X slot — the same nullifier — and the validator answers replay; the X nullifier differs from every anon-post nullifier of the window", async () => {
    const cfg = (await vapi("GET", "/x/outbox/config?mode=fixture")).json;
    if (cfg.xSlotsPerWindow !== 1) throw new Error("the rig's K_X is not 1: " + cfg.xSlotsPerWindow);
    const before = await xView(null);
    const r = await xo({ text: `one too many for X ${stamp}` });
    if (r.status !== 409 || r.json?.code !== "window") throw new Error("the second copy in the window: " + r.status + " " + JSON.stringify(r.json));
    const after = await xView(null);
    if ((after.items?.length ?? 0) !== (before.items?.length ?? 0)) throw new Error("the refused copy minted a record");
    // a Farcaster anon post in the same window still goes
    const a = await retry(() => api("POST", "/api/anon", { text: `still an anon post ${stamp} [layers-test fixture]` }));
    const ch = a.json.castHash;
    await tick({ anon: [ch] });
    const ae = (await anonStatus(ch, true)).envelope;
    if (!ae) throw new Error("the anon post was not queued at the tick");
    S.nullifiers.anon.push(String(ae.nullifier));
    // forced past the client: the validator answers replay
    const f = await retry(() => xo({ text: `forced past the client ${stamp}`, force: true }));
    const fx = f.json.xHash;
    await tick({ x: [fx] });
    const fe = (await xView(fx, true)).envelope;
    if (!fe || fe.status !== "queued") throw new Error("the forced copy was not queued");
    if (String(fe.envelope.nullifier) !== S.nullifiers.x[1]) throw new Error("the forced copy did not re-use the window's X slot (another nullifier)");
    await drain();
    const anonDone = await anonStatus(ch);
    if (anonDone.item?.outcome !== "accepted") throw new Error("the Farcaster anon post in the X-spent window was not accepted: " + JSON.stringify(anonDone.item));
    const fd = (await xView(fx, true)).envelope;
    if (!fd || fd.status !== "sent" || fd.outcome !== "replay") throw new Error("the forced copy was not a validator replay: " + JSON.stringify(fd && { status: fd.status, outcome: fd.outcome }));
    if ((await publicList()).some((r2) => r2.id === fx)) throw new Error("the replayed copy got a row");
    const xs = new Set(S.nullifiers.x);
    const clash = S.nullifiers.anon.filter((n) => xs.has(n));
    if (S.nullifiers.anon.length < 2 || clash.length) throw new Error("an X nullifier equals an anon-post nullifier (or too few compared): " + JSON.stringify({ anon: S.nullifiers.anon.length, clash }));
    return `refused at compose; the anon post accepted; the forced copy a replay; ${S.nullifiers.x.length} X vs ${S.nullifiers.anon.length} anon nullifiers, none equal`;
  });

  await check("6b. UXH-1 THE COMPARTMENT HIDES A SIBLING'S COPY: a copy sent as a sibling persona is listed while every persona is visible (the control) and is ABSENT under compartment mode — from the list and from the single read, which answers it exactly like a hash this device never sent; no item carries personaId or copyOf", async () => {
    if (!P2) throw new Error("setup: the sibling persona was not made");
    // forced past the spent X slot (the rig's door: the validator will answer it a replay — beside the point here)
    const sc = await retry(() => xo({ text: `the sibling's copy ${stamp}`, personaId: P2, force: true }));
    const sx = sc.json?.xHash;
    if (!/^[0-9a-f]{64}$/.test(sx ?? "")) throw new Error("setup: the sibling's copy: " + JSON.stringify(sc.json));
    const all = await xView(null);
    if (!(all.items ?? []).some((i) => i.xHash === sx)) throw new Error("control: the sibling's copy is not listed with every persona visible");
    if ((all.items ?? []).some((i) => "personaId" in i || "copyOf" in i)) throw new Error("an item carries personaId / copyOf");
    const on = await retry(() => api("POST", "/api/persona/chrome", { action: "compartment", on: true }));
    if (on.json?.scope?.compartment !== true) throw new Error("compartment mode did not take: " + JSON.stringify(on.json));
    try {
      const scoped = await xView(null);
      if ((scoped.items ?? []).some((i) => i.xHash === sx)) throw new Error("the compartment view lists the sibling's copy");
      if (!(scoped.items ?? []).some((i) => i.xHash === S.xHash)) throw new Error("control: the active persona's own copy vanished under the compartment");
      const one = (await xView(sx)).item;
      const never = (await xView("9".repeat(64))).item;
      if (one?.state !== "unknown" || one.sentence !== never?.sentence || one.lastStage !== null) throw new Error("the single read tells the sibling's copy apart: " + JSON.stringify({ one, never }));
      if (JSON.stringify(scoped).includes(P2)) throw new Error("the compartment view names the sibling persona");
    } finally {
      await retry(() => api("POST", "/api/persona/chrome", { action: "compartment", on: false }));
    }
    // PERSONA LAUNCH wave 3 (final verify, harness): settle the forced sibling copy in THIS window. Left wanted, check 7's
    // advanceEpoch + tick proved it in the NEW window, where it spent that window's one X slot and check 7's own
    // quote-and-link compose was refused 409 'window' (first rig run of this check, 2026-10-13). That is an ordering
    // artifact of this check, not a product fault: a copy is proved at the tick after its compose, and one deferred past
    // its window's edge spends the next window's slot by design.
    await tick({ x: [sx] });
    await drain();
    const settled = (await xView(sx, true)).envelope;
    if (!settled || settled.status !== "sent") throw new Error("setup: the sibling's forced copy did not settle in its own window: " + JSON.stringify(settled && { status: settled.status, outcome: settled.outcome }));
    return `the sibling's copy ${sx.slice(0, 10)}… listed unscoped, absent under the compartment (then settled in its window: ${settled.outcome})`;
  });

  await check("7. THE POLICY at compose AND at the validator: two links, an @mention, > 280 and a full repost are refused at both (nothing minted at compose, nothing recorded at the validator); a quote-and-link is accepted at both", async () => {
    const bad = [
      ["two links", "one https://a.example.org two https://b.example.org", /one link/],
      ["an @mention", "agree with @someone", /mention/],
      ["over 280", "z".repeat(281), /too long for X/],
      ["a full repost", "the first paragraph of it\n\nand the second paragraph", /One paragraph/],
    ];
    await retry(() => zk("advanceEpoch"));
    await tick();
    const before = (await xView(null)).items?.length ?? 0;
    for (const [name, text, re] of bad) {
      const r = await xo({ text });
      if (r.status !== 400 || r.json?.code !== "bad-text" || !re.test(r.json?.error ?? "")) throw new Error(`compose, ${name}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    if (((await xView(null)).items?.length ?? 0) !== before) throw new Error("a refused text minted a record");
    const m = (await vapi("GET", "/zk/members?mode=fixture&tree=" + encodeURIComponent(TREE))).json;
    const rowsBefore = (await publicList()).length;
    for (const [name, text, re] of bad) {
      const r = await vapi("POST", "/zk/submit", { envelope: xEnvelope({ text, epoch: m.epoch, root: m.root, tree: TREE }) });
      if (r.status !== 400 || !re.test(r.json?.error ?? "")) throw new Error(`validator, ${name}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    if ((await publicList()).length !== rowsBefore) throw new Error("a refused text left a row");
    const quote = `worth reading, the short version ${stamp} https://example.org/article`;
    const okv = await vapi("POST", "/zk/submit", { envelope: xEnvelope({ text: quote, epoch: m.epoch, root: m.root, tree: TREE }) });
    if (okv.status !== 200) throw new Error("validator, quote-and-link: " + okv.status + " " + JSON.stringify(okv.json));
    const okc = await retry(() => xo({ text: `the gist ${stamp} https://example.org/other` }));
    if (okc.status !== 202) throw new Error("compose, quote-and-link: " + okc.status);
    const d = db();
    try {
      const k = d.prepare("SELECT kind, url FROM x_outbox WHERE mode = 'fixture' AND text = ?").get(quote);
      if (!k || k.kind !== "quote-link" || k.url !== "https://example.org/article") throw new Error("the quote-and-link row: " + JSON.stringify(k && { ...k }));
    } finally {
      d.close();
    }
  });

  await check("7b. UXH-5 THE COPY'S WORDS ARE CHECKED BEFORE THE ANONYMOUS POST: in the composer, with the X box ticked, 300 characters (fine for an anonymous post, over X's 280) show the outbox's reason under the box and HOLD Post — no anonymous post and no X copy is made; unticking the box releases Post (the control)", async () => {
    await page.goto(BASE + "/home", { waitUntil: "networkidle" });
    await page.locator("[data-testid='composer-input']").first().click();
    const anon = page.locator("[data-testid='composer-anon']").first();
    await anon.waitFor({ timeout: 15000 });
    let on = false;
    for (let i = 0; i < 40 && !on; i++) { on = await anon.isChecked(); if (!on) await sleep(300); }
    if (!on) throw new Error("setup: 'Post anonymously' is not on");
    const before = { x: (await xView(null)).items?.length ?? 0, anon: ((await retry(() => api("GET", "/api/anon"))).json?.revealable ?? []).length };
    const words = `too long for X ${stamp} ` + "x".repeat(300 - 16 - stamp.length);
    await page.locator("[data-testid='composer-input']").first().fill(words);
    const box = page.locator("[data-testid='composer-x-toggle']").first();
    await box.waitFor({ timeout: 15000 });
    await box.check();
    const problem = page.locator("[data-testid='composer-x-problem']").first();
    await problem.waitFor({ timeout: 15000 });
    const why = (await problem.textContent()) ?? "";
    if (!/too long for X: 300 of 280/.test(why) || !/untick the box to post without the copy/.test(why)) throw new Error("the reason under the box: " + why);
    const submit = page.locator("[data-testid='composer-submit']").first();
    if (!(await submit.isDisabled())) throw new Error("Post is not held while the copy's words fail");
    await sleep(1500);
    const mid = { x: (await xView(null)).items?.length ?? 0, anon: ((await retry(() => api("GET", "/api/anon"))).json?.revealable ?? []).length };
    if (mid.x !== before.x || mid.anon !== before.anon) throw new Error("something was sent with the over-length copy ticked: " + JSON.stringify({ before, mid }));
    // the control: untick the box — Post is released (the post itself is not sent here)
    await box.uncheck();
    let free = false;
    for (let i = 0; i < 20 && !free; i++) { free = !(await submit.isDisabled()); if (!free) await sleep(250); }
    if (!free) throw new Error("control: Post stayed held with the X box unticked");
    await page.locator("[data-testid='composer-input']").first().fill("");
    return "the reason shown, Post held, nothing sent; unticked → Post released";
  });

  await check("8. NOTHING LEAVES THE MACHINE: this browser's requests are loopback (a non-loopback one is only ever a fixture avatar IMAGE, aborted); a guarded rig-shaped validator on :4057 (temp DB, the network guard preloaded, its network subsystems off) runs submit → moderate → relay → posted with an EMPTY guard log beside the recorded positive control; validator/xoutbox.js and lib/x/outbox/** import no socket/http/fetch and name no X API host", async () => {
    // (a) the page
    const off = pageRequests.filter((r) => { try { const h = new URL(r.url).hostname; return !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(h) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"); } catch { return false; } });
    const notImages = off.filter((r) => r.type !== "image");
    if (pageRequests.length < 20) throw new Error("the browser made too few requests to judge (" + pageRequests.length + ")");
    if (notImages.length) throw new Error("a non-loopback request that is not an image: " + JSON.stringify(notImages.slice(0, 5)));
    if (off.some((r) => /(^|\.)(x|twitter)\.com$/i.test(new URL(r.url).hostname))) throw new Error("a request to an X host");
    // (b) the guarded validator
    const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-x-guard-"));
    const guardLog = path.join(tmp, "guard.log");
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(NEYNAR_|FC_|X_|ENABLE_|VALIDATOR_|LAYERS_|RAILWAY_|ZK_|TRUST_PROXY|NODE_ENV|PORT$)/.test(k)) delete env[k];
    Object.assign(env, {
      NODE_OPTIONS: "--require ./scripts/lib/net-guard.cjs",
      NET_GUARD_LOG: guardLog,
      NET_GUARD_SELFTEST: "1",
      LAYERS_VALIDATOR_PORT: String(GUARD_PORT),
      VALIDATOR_DB: path.join(tmp, "v.db"),
      ZK_DEV_HOOKS: "true",
      ZK_ANON_POST_TREE: "valid",
      // its network-reaching subsystems, off by their own switches (the rep poller; the X index job is off unless asked)
      VALIDATOR_POLLER: "off",
    });
    const child = spawn(process.execPath, ["validator/server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    const GB = "http://127.0.0.1:" + GUARD_PORT;
    let controlN = 0;
    try {
      let up = false;
      for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(GB + "/health")).ok; } catch { await sleep(500); } }
      if (!up) throw new Error("INFRA: the guarded validator did not come up on :" + GUARD_PORT + " — " + out.slice(-300));
      await vapi("POST", "/zk/dev/seed-decoys", { mode: "fixture", count: 5 }, GB);
      await vapi("POST", "/zk/dev/advance-epoch", { mode: "fixture" }, GB);
      const gm = (await vapi("GET", "/zk/members?mode=fixture&tree=valid", undefined, GB)).json;
      const text = `guarded copy ${stamp}`;
      const env1 = xEnvelope({ text, epoch: gm.epoch, root: gm.root, tree: "valid" });
      const sub = await vapi("POST", "/zk/submit", { envelope: env1 }, GB);
      if (sub.status !== 200) throw new Error("guarded submit: " + sub.status + " " + JSON.stringify(sub.json));
      const k = edKey();
      await vapi("POST", "/x/outbox/dev/moderator", { mode: "fixture", pubkey: k.pubHex }, GB);
      const mod = await vapi("POST", "/x/outbox/moderate", moderateBody(k, env1.publicInputs.xHash, "approve"), GB);
      if (mod.status !== 200) throw new Error("guarded moderate: " + mod.status + " " + JSON.stringify(mod.json));
      const rel = await vapi("POST", "/x/outbox/dev/relay-now", { mode: "fixture" }, GB);
      if (!(rel.json?.posted <= 1) || rel.json.destination !== "fixture") throw new Error("guarded relay: " + JSON.stringify(rel.json));
      const row = (await vapi("GET", "/x/outbox?mode=fixture", undefined, GB)).json.items.find((r) => r.id === env1.publicInputs.xHash);
      if (row?.status !== "posted") throw new Error("guarded row: " + JSON.stringify(row));
      await sleep(1500); // any background attempt the relay or a timer made would be in the log by now
      const lines = existsSync(guardLog) ? readFileSync(guardLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      const control = lines.filter((l) => l.selftest === true);
      const real = lines.filter((l) => l.selftest !== true);
      if (control.length < 2) throw new Error("the guard's positive control was not recorded (was the guard loaded?): " + JSON.stringify(lines));
      if (real.length) throw new Error("the guarded validator reached for the network: " + JSON.stringify(real));
      controlN = control.length;
    } finally {
      child.kill();
      await sleep(500);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a locked WAL file on Windows: the OS temp sweep takes it */ }
    }
    // (c) the static grep
    const listFiles = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? listFiles(path.join(dir, n)) : [path.join(dir, n)]));
    const files = [path.join(ROOT, "validator", "xoutbox.js"), ...listFiles(path.join(ROOT, "lib", "x", "outbox"))];
    for (const f of files) {
      const raw = readFileSync(f, "utf8");
      const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
      if (/require\(\s*["'](node:)?(https?|net|tls|dgram|http2|undici)["']\s*\)|from\s+["'](node:)?(https?|net|tls|dgram|http2|undici)["']|\bfetch\s*\(/.test(code)) throw new Error(path.relative(ROOT, f) + " reaches the network");
      if (/(?:^|[^a-z0-9.-])(?:api\.)?(?:x|twitter)\.com\b/i.test(raw)) throw new Error(path.relative(ROOT, f) + " names an X API host");
    }
    return `${pageRequests.length} page requests (${off.length} fixture images aborted); guard: ${controlN} control entries, 0 real; ${files.length} files clean`;
  });

  await check("9. THE OPERATOR'S VIEW: x_outbox, its decisions and the fixture posts hold no persona id, root id, nullifier, slot or device id; the X row id differs from the copied post's cast hash; every time is hour-grained", async () => {
    const d = db();
    try {
      const rows = [
        ...d.prepare("SELECT * FROM x_outbox WHERE mode = 'fixture'").all(),
        ...d.prepare("SELECT * FROM x_outbox_decisions WHERE mode = 'fixture'").all(),
        ...d.prepare("SELECT * FROM x_fixture_posts WHERE mode = 'fixture'").all(),
        ...d.prepare("SELECT * FROM x_outbox_moderators WHERE mode = 'fixture'").all(),
      ].map((r) => ({ ...r }));
      if (rows.length < 4) throw new Error("too few rows to judge (" + rows.length + ")");
      const hay = JSON.stringify(rows);
      const personas = (await retry(() => api("GET", "/api/personas"))).json?.personas?.map((p) => p.id) ?? [];
      const needles = [
        ...[MAIN, ...personas].map((v) => ["persona", v]),
        ...d.prepare("SELECT id FROM roots WHERE id NOT LIKE 'root_zkdecoy_%'").all().map((r) => ["root", r.id]),
        ...d.prepare("SELECT device_id FROM devices").all().map((r) => ["device", r.device_id]),
        ...S.nullifiers.x.map((v) => ["nullifier", v]),
        ...S.nullifiers.anon.map((v) => ["nullifier", v]),
        ...[S.castHash, S.castHash2].filter(Boolean).map((v) => ["cast hash", v]),
      ].filter(([, v]) => typeof v === "string" && v.length >= 8);
      if (needles.length < 6) throw new Error("too few needles to judge: " + needles.length);
      const found = needles.filter(([, v]) => hay.includes(v));
      if (found.length) throw new Error("the operator's X rows hold " + found.map(([k, v]) => k + " " + v.slice(0, 12)).join(", "));
      for (const t of ["x_outbox", "x_outbox_decisions", "x_fixture_posts", "x_outbox_moderators"]) {
        const cols = d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        if (cols.some((c) => /persona|root|nullifier|slot|device|cast|epoch/.test(c))) throw new Error(t + " has a column it must not: " + cols.join(","));
      }
      if (S.xHash === S.castHash || S.xHash2 === S.castHash2) throw new Error("an X row id equals its sibling's cast hash");
      const times = rows.flatMap((r) => ["created_hour", "decided_hour", "due_at", "posted_hour", "added_hour"].filter((k) => r[k] !== null && r[k] !== undefined).map((k) => [k, r[k]]));
      const fine = times.filter(([, v]) => Number(v) % HOUR !== 0);
      if (times.length < 6 || fine.length) throw new Error("a time finer than the hour: " + JSON.stringify(fine.slice(0, 5)) + " (" + times.length + " times)");
      return `${rows.length} rows, ${needles.length} needles absent, ${times.length} times hour-grained`;
    } finally {
      d.close();
    }
  });

  await check("10. SETTINGS: /settings lists 'Totem on X: anonymous posts (test data)' and 'DM a tweet to save it (test data)'; /settings/x-outbox renders with its test-data line and the counts; /settings/dm-hook keeps dm-hook-mode exactly 'fixture' and shows dm-hook-test-data", async () => {
    await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
    const outRow = page.locator("[data-testid='settings-x-outbox']").first();
    await outRow.waitFor({ timeout: 20000 });
    if (!/Totem on X: anonymous posts \(test data\)/.test((await outRow.textContent()) ?? "")) throw new Error("the outbox row: " + (await outRow.textContent()));
    const dmRow = page.locator("[data-testid='settings-x-dm-inbox']").first();
    if (!/DM a tweet to save it \(test data\)/.test((await dmRow.textContent()) ?? "")) throw new Error("the DM row: " + (await dmRow.textContent()));
    await outRow.click();
    await page.waitForURL((u) => new URL(u).pathname === "/settings/x-outbox", { timeout: 30000 });
    await page.locator("[data-testid='x-outbox-test-data']").first().waitFor({ timeout: 20000 });
    const counts = page.locator("[data-testid='x-outbox-counts']").first();
    await counts.waitFor({ timeout: 20000 });
    let posted = null;
    for (let i = 0; i < 20 && posted === null; i++) { posted = await counts.getAttribute("data-posted"); if (posted === null) await sleep(300); }
    if (Number(posted) < 1) throw new Error("the panel's counts: " + (await counts.textContent()));
    await page.goto(BASE + "/settings/dm-hook", { waitUntil: "networkidle" });
    await page.locator("[data-testid='dm-hook-mode']").waitFor({ timeout: 15000 });
    if ((await page.locator("[data-testid='dm-hook-mode']").textContent()) !== "fixture") throw new Error("dm-hook-mode is not exactly 'fixture'");
    const td = (await page.locator("[data-testid='dm-hook-test-data']").first().textContent()) ?? "";
    if (td !== "Test data: no DM is read from X yet.") throw new Error("dm-hook-test-data: " + td);
  });

  await check("11. RESETS: resetZk wipes the fixture outbox, its decisions, the fixture posts and the dev moderators; so does resetSeed", async () => {
    const n = () => { const d = db(); try { return ["x_outbox", "x_outbox_decisions", "x_outbox_moderators", "x_fixture_posts"].map((t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE mode = 'fixture'`).get().n); } finally { d.close(); } };
    const before = n();
    if (before[0] < 1 || before[2] < 1) throw new Error("setup: nothing to wipe " + JSON.stringify(before));
    await retry(() => zk("resetZk"));
    if (JSON.stringify(n()) !== "[0,0,0,0]") throw new Error("resetZk left X rows: " + JSON.stringify(n()));
    await retry(() => xo({ action: "registerModerator" }));
    if (n()[2] !== 1) throw new Error("setup: the moderator did not register again");
    await retry(() => dev("resetSeed"));
    if (JSON.stringify(n()) !== "[0,0,0,0]") throw new Error("resetSeed left X rows: " + JSON.stringify(n()));
  });
} catch (e) {
  fail("setup", e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  await retry(() => zk("setZkMode", { zkMode: null })).catch(() => {});
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await retry(() => dev("resetSeed")).catch(() => {});
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Persona launch P8 (X outbox) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
