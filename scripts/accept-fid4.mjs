// MULTI-FID PASS — Gate 4 acceptance (fixture): anon-post mode, the anoncast pattern inside Totem.
//   1. REGISTRY: `anon-post` is a onePerHuman scope with a linkage line on the client; the validator's duplicate agrees; CLAIM_KINDS agree
//   2. PROVE → SUBMIT → RELAY: an anon post is queued, proved at the tick, sent over the anon channel, relayed by the validator,
//      and appears in OUR feed as the shared anon account with the "anon" treatment
//   3. NO ATTRIBUTION ANYWHERE: the attribution index, the event log, the validator's whole DB and the envelope on the wire carry no
//      persona id and no root near the cast — the anon row holds exactly (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status)
//      plus the reveal columns and (PERSONA LAUNCH P3, migration 21) the tree it proved and a NULL note — never a slot
//   4. K PER WINDOW (PERSONA LAUNCH P3, D4): K posts per person per window are accepted (K distinct slots, K distinct nullifiers);
//      the (K+1)th is refused by the client (409); forced past the client it re-uses a spent slot and the VALIDATOR refuses it
//      by nullifier (replay) and relays nothing
//   5. TAMPERED: a changed text, a re-hashed cast, a foreign tree, a persona on the signal — each refused before any nullifier; the
//      untouched envelope resubmitted is a replay
//   6. THE LABEL: DEMO with a direct relay (the relay condition fails); with an attested ohttp relay the relay condition holds;
//      the composer's anon toggle shows the computed label and says "attributed to no one"
//   7. NO REPUTATION, NO PERSONA CHROME: the anon card has no persona id, no tier, no block target; the event log holds nothing for it
//   8. THE LIVE RECORDER: scripts/live-fid4.mjs is an npm script and refuses without ENABLE_FC_WRITE and a live universe — no network call
// Fixture, pinned ports, no network, no spend.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
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
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const reset = () => retry(() => dev("resetSeed"));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
// MULTI-FID Gate 5 (attack-fid-2 #7): salted with the per-post nonce the payload carries
const castHashOf = (text, nonce) => sha("layers-anon-cast/1|" + nonce + "|" + text);
const anonStatus = async (castHash, envelope = false) => (await retry(() => api("GET", `/api/anon?castHash=${castHash}${envelope ? "&envelope=1" : ""}`))).json;
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const feedAnonCards = async () => ((await retry(() => api("GET", "/api/feed2?surface=discovery"))).json.cards ?? []).filter((c) => c.anon === true || c.cast?.anon === true);
const driveOnce = async () => { await retry(() => zk("prefetchNow")); await sleep(400); return (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json; };
// every id that names one of THIS device's personas or roots — none may appear near the cast anywhere
const ownIds = async () => {
  const opts = (await retry(() => api("GET", "/api/personas/act-as-options"))).json.options.map((o) => o.id);
  return [...new Set([MAIN, ...opts])];
};

const stamp = Date.now().toString(36);
const text1 = `anon says hi ${stamp} [layers-test fixture]`;
let castHash1 = null, network1 = null, envelope1 = null;

// ---- setup: a fresh fixture universe under the zk binding, our commitment a leaf of the gate tree ----
await reset();
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

  await check("1. REGISTRY: `anon-post` is a onePerHuman scope with a linkage line naming the window; the validator's duplicate agrees; CLAIM_KINDS agree on both sides", async () => {
    const scopes = readFileSync("lib/zk/scopes.ts", "utf8");
    if (!/id: "anon-post",\s*feature: "anon-post",\s*onePerHuman: true,\s*linkage:/.test(scopes)) throw new Error("scopes.ts lacks a onePerHuman `anon-post` entry with a linkage argument");
    if (!/anon-post[\s\S]{0,1400}window/i.test(scopes)) throw new Error("the anon-post linkage line does not name the window");
    const vz = readFileSync("validator/zk.js", "utf8");
    if (!/"anon-post": \{ feature: "anon-post", onePerHuman: true \}/.test(vz)) throw new Error("validator SCOPE_FOR_CLAIM lacks the onePerHuman anon-post entry");
    const client = /CLAIM_KINDS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(readFileSync("lib/zk/transport/types.ts", "utf8"))?.[1];
    const server = /const CLAIM_KINDS = \[([^\]]*)\]/.exec(vz)?.[1];
    const norm = (s) => (s || "").replace(/\s|"/g, "");
    if (!client || norm(client) !== norm(server) || !norm(client).includes("anon-post")) throw new Error(`CLAIM_KINDS differ or lack anon-post: client [${client}] validator [${server}]`);
    const cfg = (await vapi("/zk/anon-post/config?mode=fixture")).json;
    if (cfg?.tree !== TREE) throw new Error("the validator's anon tree " + cfg?.tree + " is not the gate tree " + TREE + " (rig assumption: the default predicate)");
  });

  await check("2. PROVE → SUBMIT → RELAY: the anon post is queued (202, castHash = sha256 of the text), proved at the tick, sent over the anon channel and accepted; the validator's public list holds it; OUR feed shows it as the shared anon account with the anon treatment and no persona", async () => {
    const r = await api("POST", "/api/anon", { text: text1 });
    if (r.status !== 202 || !/^[0-9a-f]{64}$/.test(String(r.json?.castHash))) throw new Error("queue: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
    castHash1 = r.json.castHash;
    // the tick proves and queues; the envelope is read while it is QUEUED (the queue keeps no proof
    // material after the send), then the drain sends it over the anonymous channel
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    const queued = await anonStatus(castHash1, true);
    if (queued.item?.status !== "queued") throw new Error("not queued after the tick: " + JSON.stringify(queued.item) + " attempts=" + JSON.stringify((await retry(() => zk("gateStatus"))).json.attempts?.filter((a) => a.personaId === "anon")).slice(0, 300));
    envelope1 = queued.envelope;
    if (!envelope1 || envelope1.publicInputs?.personaId !== "anon" || envelope1.payload?.text !== text1) throw new Error("the queued envelope is not an anon envelope with the text: " + JSON.stringify(envelope1).slice(0, 200));
    if (!/^[0-9a-f]{32}$/.test(String(envelope1.payload?.nonce)) || castHashOf(text1, envelope1.payload.nonce) !== castHash1) throw new Error("the cast hash is not sha256 of the nonce-salted text");
    const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
    const st = await anonStatus(castHash1);
    if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(st.item) + " drain=" + JSON.stringify(d).slice(0, 200));
    const listed = (await anonCasts()).find((c) => c.castHash === castHash1);
    if (!listed || listed.text !== text1 || !/^0xanon[0-9a-f]{32}$/.test(listed.hash)) throw new Error("validator list: " + JSON.stringify(listed));
    network1 = listed.hash;
    const card = (await feedAnonCards()).find((c) => c.cast?.text === text1);
    if (!card) throw new Error("the anon cast is not in our feed");
    if (card.cast.author?.username !== "anon" || card.cast.author?.anon !== true) throw new Error("author is not the shared anon account: " + JSON.stringify(card.cast.author));
    if (card.cast.personaId || card.cast.tier !== undefined) throw new Error("the anon card carries a persona layer: " + JSON.stringify({ personaId: card.cast.personaId, tier: card.cast.tier }));
    if (card.cast.hash !== network1) throw new Error("the card's hash is not the network hash");
  });

  await check("3. NO ATTRIBUTION ANYWHERE: the attribution index answers null for the cast; the event log holds nothing for it; every row of every table in the validator's DB that mentions the cast is the anon row alone — exactly (mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status) — and no row near it, nor the nullifier row, nor the envelope on the wire, carries a persona id or a root", async () => {
    const att = (await retry(() => api("GET", "/api/fc/attribution?hashes=" + encodeURIComponent(network1)))).json.attributions;
    if (att[network1] !== null && att[network1] !== undefined) throw new Error("the cast is attributed: " + JSON.stringify(att));
    const ev = (await retry(() => api("GET", "/api/eventlog?target=" + encodeURIComponent(network1)))).json;
    if ((ev.events ?? []).length) throw new Error("event log has entries for the anon cast: " + JSON.stringify(ev.events).slice(0, 200));
    const ids = await ownIds();
    const nullifier = String(envelope1.nullifier);
    const leaks = (s) => ids.filter((id) => s.includes(id)).concat(/root_[a-z0-9]/i.test(s) ? ["root_*"] : []).concat(/rootId/.test(s) ? ["rootId"] : []);
    const envLeak = leaks(JSON.stringify(envelope1));
    if (envLeak.length) throw new Error("the envelope on the wire names " + envLeak.join(","));
    if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      const hits = [];
      for (const t of tables) {
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
          const s = JSON.stringify(row);
          if (s.includes(castHash1) || s.includes(network1) || s.includes(text1) || s.includes(nullifier)) hits.push({ t, row });
        }
      }
      const anonRows = hits.filter((h) => h.t === "zk_anon_casts");
      const nullRows = hits.filter((h) => h.t === "zk_nullifiers");
      const others = hits.filter((h) => h.t !== "zk_anon_casts" && h.t !== "zk_nullifiers");
      if (others.length) throw new Error("other tables mention the cast or its nullifier: " + others.map((h) => h.t + ":" + JSON.stringify(h.row).slice(0, 120)).join(" | "));
      if (anonRows.length !== 1) throw new Error("expected one anon row, got " + anonRows.length);
      const keys = Object.keys(anonRows[0].row).sort();
      // the anoncast reveal pattern (MULTI-FID PASS): attribution_commitment is public but reveals nothing on its
      // own (a hash of a secret only the poster holds); attributed_fid/attributed_at stay NULL unless the poster
      // later chooses to reveal — this suite never does, so they hold no persona/root either way
      // (§14.2: attributed_signer is the key that reveal's signature verified under, NULL until then)
      // PERSONA LAUNCH P3 (migration 21): + tree (the predicate the post proved — the configured tree) and note (P4's ring
      // note, NULL until then); still no slot, no persona, no root, no nullifier
      // PERSONA LAUNCH wave 2 (verify): + tree_size (migration 24, P5: the proved tree's FROZEN size at the post's epoch,
      // served publicly as treeSize for the reach label) and attributed_batch (migration 25, P6: the launch batch reveal
      // that attributed the row, NULL until a launch); the note is now ALWAYS 256 bytes (P4: random without a ring)
      // PUBLIC GO-LIVE (verify): + hidden_at (migration 29, anon_public_safety: the hour a moderator's REMOVE hid the post —
      // hide, never delete), a moderation timestamp that names no persona and no root; NULL here (nothing was removed),
      // asserted below so the column can never carry anything else unseen
      if (keys.join(",") !== "attributed_at,attributed_batch,attributed_fid,attributed_signer,attribution_commitment,cast_hash,epoch,fid,hidden_at,mode,network_hash,note,relayed_at,status,text,tree,tree_size") throw new Error("the anon row holds more than the network shows plus the (unrevealed) attribution columns, the tree, its size, the note and the moderation hour: " + keys.join(","));
      if (anonRows[0].row.hidden_at !== null) throw new Error("nothing was removed, yet the row has a hidden_at: " + anonRows[0].row.hidden_at);
      if (!/^[0-9a-f]{512}$/.test(String(anonRows[0].row.note))) throw new Error("the note column is not the 256-byte note every anon post carries (P4): " + String(anonRows[0].row.note).slice(0, 40));
      if (!Number.isInteger(anonRows[0].row.tree_size) || anonRows[0].row.tree_size < 1) throw new Error("the row records no frozen tree size: " + anonRows[0].row.tree_size);
      if (anonRows[0].row.attributed_batch !== null) throw new Error("this suite never launched, yet the row names a launch batch: " + anonRows[0].row.attributed_batch);
      if (anonRows[0].row.tree !== TREE) throw new Error("the row's tree " + anonRows[0].row.tree + " is not the configured anon tree " + TREE);
      if (anonRows[0].row.attributed_fid !== null || anonRows[0].row.attributed_at !== null || anonRows[0].row.attributed_signer !== null) throw new Error("this suite never revealed, yet the row is attributed: " + JSON.stringify(anonRows[0].row));
      if (anonRows[0].row.relayed_at % 3_600_000 !== 0) throw new Error("relayed_at is finer than an hour");
      if (nullRows.length !== 1 || nullRows[0].row.claim_kind !== "anon-post") throw new Error("nullifier row: " + JSON.stringify(nullRows.map((h) => h.row)));
      for (const h of hits) { const l = leaks(JSON.stringify(h.row)); if (l.length) throw new Error(`${h.t} row near the cast names ${l.join(",")}`); }
    } finally {
      db.close();
    }
  });

  await check("4. K PER WINDOW (PERSONA LAUNCH P3, D4): the K-1 further anon posts of the window are accepted, each in its own slot with its own nullifier (K accepted, K listed); the (K+1)th is refused by the client (409) before any proof; forced past the client (dev hooks) it re-uses a spent slot and the VALIDATOR refuses it by nullifier — outcome replay — and relays nothing (K casts listed, K cards in the feed)", async () => {
    // K is the validator's public number; the client's must match it (lib/zk/gate.ts refuses otherwise), so either reads it
    const K = Number((await vapi("/zk/anon-post/config?mode=fixture")).json?.slotsPerWindow);
    if (!Number.isInteger(K) || K < 2) throw new Error("the validator reports no K (slotsPerWindow): " + K);
    const more = [];
    for (let i = 1; i < K; i++) {
      const r = await api("POST", "/api/anon", { text: `anon again ${i} ${stamp} [layers-test fixture]` });
      if (r.status !== 202) throw new Error(`post ${i + 1} of ${K} in the window was refused: ` + r.status + " " + JSON.stringify(r.json).slice(0, 160));
      more.push(r.json.castHash);
    }
    // the envelopes are read while QUEUED (the tick proves every wanted post from one snapshot): K distinct slots
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    const envs = [envelope1];
    for (const h of more) {
      const q = await anonStatus(h, true);
      if (q.item?.status !== "queued" || !q.envelope) throw new Error("not queued after the tick: " + JSON.stringify(q.item) + " " + JSON.stringify(q.outcome));
      envs.push(q.envelope);
    }
    const slots = envs.map((e) => e.publicInputs?.slot);
    if (new Set(slots).size !== K || !slots.every((s) => Number.isInteger(s) && s >= 0 && s < K)) throw new Error("the window's posts did not get K distinct slots: " + JSON.stringify(slots));
    if (new Set(envs.map((e) => String(e.nullifier))).size !== K) throw new Error("the window's posts do not carry K distinct nullifiers");
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    for (const h of more) {
      const st = await anonStatus(h);
      if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("a post of the window was not accepted: " + JSON.stringify(st.item));
    }
    // the (K+1)th
    const extra = `anon one too many ${stamp} [layers-test fixture]`;
    const r = await api("POST", "/api/anon", { text: extra });
    if (r.status !== 409 || r.json?.code !== "window" || !/shared across your personas/.test(String(r.json?.error))) throw new Error(`post ${K + 1} in the window was not refused: ` + r.status + " " + JSON.stringify(r.json).slice(0, 200));
    const f = await api("POST", "/api/anon", { text: extra, force: true });
    if (f.status !== 202) throw new Error("forced extra post not queued: " + f.status + " " + JSON.stringify(f.json).slice(0, 160));
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    const fq = await anonStatus(f.json.castHash, true);
    if (fq.item?.status !== "queued" || !slots.includes(fq.envelope?.publicInputs?.slot)) throw new Error("the forced post did not re-use a spent slot: " + JSON.stringify({ item: fq.item, slot: fq.envelope?.publicInputs?.slot, spent: slots }));
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    const st = await anonStatus(f.json.castHash);
    if (st.item?.status !== "sent" || st.item?.outcome !== "replay") throw new Error("the validator did not answer replay: " + JSON.stringify(st.item));
    const listed = await anonCasts();
    if (listed.length !== K || !listed.some((c) => c.castHash === castHash1) || listed.some((c) => c.castHash === f.json.castHash)) throw new Error("the validator relayed the wrong set: " + JSON.stringify(listed.map((c) => c.castHash)).slice(0, 300));
    if ((await feedAnonCards()).length !== K) throw new Error("the feed does not show exactly K anon cards");
    return `K = ${K}, slots ${JSON.stringify(slots)}`;
  });

  await check("5. TAMPERED: a changed text (hash mismatch), a re-hashed cast (message mismatch), a foreign tree and a persona on the signal are each refused (400) before any nullifier; the untouched envelope resubmitted is a replay (409); a plain claim carrying a payload is refused", async () => {
    const submit = async (envelope) => (await retry(() => zk("submit", { envelope }))).json;
    const E = envelope1;
    const relayedBefore = (await anonCasts()).length; // K after check 4 (PERSONA LAUNCH P3): nothing below may add one
    const a = await submit({ ...E, payload: { text: E.payload.text + "!", nonce: E.payload.nonce } });
    if (a.status !== 400 || !/tamper|hash/i.test(String(a.response?.error))) throw new Error("changed text: " + JSON.stringify(a).slice(0, 200));
    const other = `anon swapped ${stamp}`;
    const b = await submit({ ...E, publicInputs: { ...E.publicInputs, castHash: castHashOf(other, E.payload.nonce) }, payload: { text: other, nonce: E.payload.nonce } });
    if (b.status !== 400) throw new Error("re-hashed cast: " + JSON.stringify(b).slice(0, 200));
    const c = await submit({ ...E, publicInputs: { ...E.publicInputs, tree: "valid" } });
    if (c.status !== 400) throw new Error("foreign tree: " + JSON.stringify(c).slice(0, 200));
    const d = await submit({ ...E, publicInputs: { ...E.publicInputs, personaId: MAIN } });
    if (d.status !== 400 || !/anon/i.test(String(d.response?.error))) throw new Error("persona on the signal: " + JSON.stringify(d).slice(0, 200));
    const e = await submit(E);
    if (e.status !== 409) throw new Error("untouched resubmission is not a replay: " + JSON.stringify(e).slice(0, 200));
    const g = await submit({ ...E, claimKind: "tier-membership", publicInputs: { ...E.publicInputs, claimKind: "tier-membership" } });
    if (g.status !== 400) throw new Error("a plain claim with a payload was not refused: " + JSON.stringify(g).slice(0, 200));
    if ((await anonCasts()).length !== relayedBefore) throw new Error("a tampered submission relayed something");
    // PERSONA LAUNCH P3: a slot outside 0..K-1 and the bare-window scope are refused before any nullifier too
    const g2 = await submit({ ...E, publicInputs: { ...E.publicInputs, slot: 99 } });
    if (g2.status !== 400) throw new Error("a slot outside 0..K-1 was not refused: " + JSON.stringify(g2).slice(0, 200));
    const g3 = await submit({ ...E, publicInputs: { ...E.publicInputs, slot: undefined } });
    if (g3.status !== 400) throw new Error("an anon envelope without a slot was not refused: " + JSON.stringify(g3).slice(0, 200));
  });

  await check("6. THE LABEL: with the direct relay the privacy verdict is DEMO and the relay condition fails; with an attested ohttp relay the relay condition holds; the composer's anon toggle shows the computed label (data-state demo, text starting DEMO) and the audience line says attributed to no one", async () => {
    const v = (await retry(() => zk("privacyConditions"))).json;
    const relay = (v.conditions ?? []).find((c) => c.key === "relay");
    if (v.private !== false || !String(v.label).startsWith("DEMO") || !relay || relay.ok !== false) throw new Error("direct relay verdict: " + JSON.stringify({ private: v.private, label: v.label, relay }));
    await retry(() => zk("setRelay", { kind: "ohttp", url: VBASE + "/zk/anon/submit", thirdParty: true }));
    try {
      const v2 = (await retry(() => zk("privacyConditions"))).json;
      const relay2 = (v2.conditions ?? []).find((c) => c.key === "relay");
      if (!relay2 || relay2.ok !== true) throw new Error("attested ohttp relay: the relay condition still fails: " + JSON.stringify(relay2));
    } finally {
      await retry(() => zk("setRelay", { kind: null }));
    }
    const g = (await retry(() => api("GET", "/api/anon"))).json;
    if (g.privacy?.private !== false || g.config?.tree !== TREE) throw new Error("composer status route: " + JSON.stringify({ privacy: g.privacy?.private, config: g.config }));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      await page.locator("[data-testid='composer-input']").first().click();
      const toggle = page.locator("[data-testid='composer-anon']").first();
      await toggle.waitFor({ timeout: 8000 });
      await toggle.check();
      const label = page.locator("[data-testid='composer-anon-label'][data-state='demo']").first();
      await label.waitFor({ timeout: 8000 });
      const txt = (await label.textContent()) ?? "";
      if (!txt.startsWith("DEMO")) throw new Error("label text: " + txt);
      const audience = (await page.locator("[data-testid='composer-audience']").first().textContent()) ?? "";
      if (!/attributed to no one/.test(audience)) throw new Error("audience line: " + audience);
    } finally {
      await browser.close();
    }
  });

  await check("7. NO REPUTATION, NO PERSONA CHROME: the anon card renders with the anon badge and no tier; it has no persona id to block, follow or demote; the event log names nothing for it; the anon account is not an act-as option", async () => {
    const opts = (await retry(() => api("GET", "/api/personas/act-as-options"))).json.options;
    if (opts.some((o) => o.id === "anon" || o.handle === "anon")) throw new Error("the anon account is an act-as option");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const card = page.locator("[data-testid='cast']", { hasText: text1 }).first();
      await card.waitFor({ timeout: 8000 });
      if ((await card.locator("[data-testid='cast-anon']").count()) !== 1) throw new Error("no anon badge on the card");
      if ((await card.locator("[data-testid='tier-badge']").count()) !== 0) throw new Error("a tier badge on an anon card");
      if ((await card.locator("[data-testid='cast-merged-identity']").count()) !== 0) throw new Error("a merged identity on an anon card");
    } finally {
      await browser.close();
    }
    const ev = (await retry(() => api("GET", "/api/eventlog?target=" + encodeURIComponent(network1)))).json;
    if ((ev.events ?? []).length) throw new Error("event log has entries for the anon cast");
  });

  await check("8. THE LIVE RECORDER: scripts/live-fid4.mjs is the npm script live:fid4; without ENABLE_FC_WRITE it refuses (exit 2) naming the flag; with the flag against the fixture universe it refuses naming the universe — no network write either way", async () => {
    if (!existsSync("scripts/live-fid4.mjs")) throw new Error("scripts/live-fid4.mjs missing");
    const relayedAtCheck8 = (await anonCasts()).length;
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    if (pkg.scripts?.["live:fid4"] !== "node scripts/live-fid4.mjs") throw new Error("live:fid4 npm script missing");
    const env = { ...process.env, BASE_URL: BASE, VALIDATOR_URL: VBASE };
    delete env.ENABLE_FC_WRITE;
    const a = spawnSync(process.execPath, ["scripts/live-fid4.mjs"], { env, encoding: "utf8", timeout: 60000 });
    if (a.status !== 2 || !/ENABLE_FC_WRITE/.test(a.stderr + a.stdout)) throw new Error("no flag: exit " + a.status + " " + (a.stderr + a.stdout).slice(0, 200));
    const b = spawnSync(process.execPath, ["scripts/live-fid4.mjs"], { env: { ...env, ENABLE_FC_WRITE: "true" }, encoding: "utf8", timeout: 60000 });
    if (b.status !== 2 || !/universe/.test(b.stderr + b.stdout)) throw new Error("fixture universe: exit " + b.status + " " + (b.stderr + b.stdout).slice(0, 200));
    if ((await anonCasts()).length !== relayedAtCheck8) throw new Error("the recorder relayed something on the fixture");
  });
} finally {
  await retry(() => zk("setRelay", { kind: null })).catch(() => {});
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 4 (fixture) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
