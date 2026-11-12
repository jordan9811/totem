// PERSONA LAUNCH P3 — acceptance (fixture rig): PERSONA-SCOPED ANON POSTING, K SLOTS PER WINDOW, THE POST MODE.
//   1. D2 DEFAULTS: a persona without its own account defaults to 'anon', one with an account to 'direct'; the composer's
//      status read (GET /api/anon postAs) says who a post would be made as and that it may go through @anon
//   2. K PER PERSON, SHARED ACROSS PERSONAS (D4): K anon posts made as two different personas in one window are accepted
//      — K distinct slots, K distinct nullifiers, K relayed rows; the (K+1)th, from the persona that has used fewer, is
//      refused 409 BEFORE any proof: no reveal secret minted, no wanted entry, no device-signed write
//   3. FORCED PAST THE CLIENT (dev hooks) the extra post re-uses a spent slot and the VALIDATOR answers replay; nothing
//      more is relayed. PRIV-1: those words are then REFUSED device-locally ('replayed', 409) — plain, forced or re-cased
//      — before any secret or wanted entry: sending them again would let the validator link the posts
//   4. THE PERSONA IS SEALED, AND SURVIVES A RESTART: the envelopes and the validator's rows name no persona; the ONE
//      sealed zkQueue record, read back cold (what a restart reconstructs), holds each post's persona and shows none
//   5. EXPLICIT 'private' (Totem only) is enforced server-side: /api/anon refuses 409, the composer read says it may not
//      post anonymously, 'direct' without an own account is refused, and the mode survives a restart and a recovery
//      (keystore file, sealed identityRoster, sealed rootRoster — read back cold); for a persona WITH an account the
//      Farcaster buttons answer "Saved in Totem only — @x is set to post in Totem only"; 'direct' leaves the answer as
//      it was; PRIV-2: an EXPLICIT 'anon' keeps it OFF its own account ("… is set to post through @anon"), and a plain
//      post made anyway is saved in Totem only
//   6. THE COMPOSER: under the proof layer the anon toggle is ON by default for a persona in 'anon' mode, the line reads
//      "Posting as @x through @anon — attributed to no one … Up to K every 6 hours, shared across your personas.", the
//      picker shows the mode; PRIV-4: an anonymous post fires NO save moment (a plain post does); UX-3: without the proof
//      layer (deployment-wide) the toggle is not offered, one plain sentence says anonymous posting is off on this server,
//      the "by default" note is NOT shown, the picker shows the persona's posts going "in Totem only", and the delivery
//      line is kept
//   7. PERSONA LAUNCH P6 (UX-L1) — A POST DURING A LAUNCH: with a launch of MAIN under way (a rig-planted record at stage
//      'waiting' — /api/zk launchProbe; no request made, nothing sent) GET /api/anon says postAs.launchPending with the
//      plain "will become public as @main's" sentence (P3, not launching, does not; positive control before the plant);
//      a post whose line said "attributed to no one" is refused 409 'launch' with no secret and no wanted entry; the
//      acknowledged post is accepted (202, launchPending, the note says it will be revealed); the composer's line says so
//      instead of "attributed to no one" and the ring line's "Everyone else sees @anon." is not shown; once the launch is
//      no longer under way, the composer's stale line is refused AT THE CLICK, read again ("attributed to no one"), and
//      the words stay in the box
// Fixture, pinned ports, no network, no spend. Run with the rig up (the harness's ports):
//   bash <scratchpad>/att-run.sh scripts/accept-anon-slots.mjs        (npm run test:anon-slots once the verify agent adds it)
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const anonStatus = async (castHash, envelope = false) => (await retry(() => api("GET", `/api/anon?castHash=${castHash}${envelope ? "&envelope=1" : ""}`))).json;
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const as = async (personaId) => { await retry(() => dev("viewAs", { personaId })); viewerCookie = personaId; };
const knob = (on) => api("POST", "/api/actions/delivery", { action: "fixtureDelivery", on });
const postMode = (personaId, mode) => api("POST", "/api/personas/post-mode", { personaId, mode });
const getMode = async (personaId) => (await retry(() => api("GET", "/api/personas/post-mode?personaId=" + encodeURIComponent(personaId)))).json;
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(JSON.parse(readFileSync("seed/data/accounts.json", "utf8")));
const SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;
/** prove what is wanted NOW (one tick), reporting an epoch-edge deferral as the rig condition it is */
async function tick(castHashes) {
  await retry(() => zk("prefetchNow"));
  await sleep(400);
  for (const h of castHashes) {
    const s = await anonStatus(h);
    if (s?.outcome?.lastStage === "epoch-edge" && s.status === "wanted") throw new Error("INFRA: the rig's epoch ends inside the jitter window — the post is deferred to the next epoch; re-run after the boundary");
  }
}
const drain = () => retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
const stateRows = () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    try { db.exec("PRAGMA busy_timeout = 8000"); } catch { /* read-only handle */ }
    const m = new Map();
    for (const r of db.prepare("SELECT anchor, namespace, key, value FROM adapter_state").all()) m.set(`${r.anchor}|${r.namespace}|${r.key}`, r.value);
    return m;
  } finally { db.close(); }
};
const changedNamespaces = (before, after) => {
  const ns = new Set();
  for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) ns.add(k.split("|")[1]);
  for (const k of before.keys()) if (!after.has(k)) ns.add(k.split("|")[1]);
  return [...ns];
};

await assertServersUp(BASE);
console.log("\nPersona launch P3 — persona-scoped anon posting, K slots per window, the post mode");
if (!SOURCE) throw new Error("no seeded fork source (brothandbones) in seed/data/accounts.json");
if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);

const stamp = Date.now().toString(36);
let K = 4, P2 = null, P3 = null, P3_HANDLE = null, P2_HANDLE = null, MAIN_HANDLE = null;
const ours = []; // { castHash, personaId, envelope }

await reset();
await retry(() => zk("resetZk"));
try {
  // two personas of this root: P2 with NO account (shared-fid fork, minted under the mock binding), P3 WITH a fixture one
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  try {
    const f = await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `aslots_two_${stamp.slice(-4)}` }));
    P2 = f.json.newPersona;
    if (!P2 || f.json.newFid) throw new Error("setup: P2 got an account");
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }
  const f3 = await retry(() => api("POST", "/api/identity/fork", { fromPersona: SOURCE, carry: [], newHandle: `aslots_three_${stamp.slice(-4)}` }));
  P3 = f3.json.newPersona;
  const records = async () => (await retry(() => api("GET", "/api/fc/persona"))).json.records;
  if (!(await records()).some((r) => r.personaId === P3)) await retry(() => persona("acquire", { personaId: P3 }));
  if (!(await records()).some((r) => r.personaId === P3 && r.mode === "fixture")) throw new Error("setup: P3 owns no fixture account");
  // the proof layer, a crowd and our registration
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setHonoredIssuers", { issuers: ["test.mock-issuer"] }));
  await retry(() => zk("seedDecoys", { count: 60 }));
  await retry(() => zk("register"));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  K = Number((await vapi("/zk/anon-post/config?mode=fixture")).json?.slotsPerWindow);
  if (!Number.isInteger(K) || K < 2) throw new Error("the validator reports no K: " + K);

  await check("1. D2 DEFAULTS: a persona without its own account is 'anon' (not explicit), one with an account is 'direct' (and may choose 'direct'), the seeded self is 'anon'; GET /api/anon names the persona a post would be made as, its mode, and that it may post anonymously", async () => {
    const m2 = await getMode(P2);
    if (m2.mode !== "anon" || m2.explicit !== false || m2.ownAccount !== false || JSON.stringify(m2.options) !== JSON.stringify(["anon", "private"]) || m2.settable !== true) throw new Error("P2: " + JSON.stringify(m2));
    const m3 = await getMode(P3);
    if (m3.mode !== "direct" || m3.ownAccount !== true || !m3.options.includes("direct")) throw new Error("P3: " + JSON.stringify(m3));
    const mm = await getMode(MAIN);
    if (mm.mode !== "anon" || mm.settable !== false) throw new Error("MAIN: " + JSON.stringify(mm));
    P2_HANDLE = m2.handle; P3_HANDLE = m3.handle; MAIN_HANDLE = mm.handle;
    const g = (await retry(() => api("GET", "/api/anon"))).json;
    if (g.postAs?.personaId !== MAIN || g.postAs?.mode !== "anon" || g.postAs?.available !== true) throw new Error("postAs: " + JSON.stringify(g.postAs));
    if (g.slotsPerWindow !== K || g.windowHours !== 6) throw new Error("cadence: " + JSON.stringify({ k: g.slotsPerWindow, h: g.windowHours }));
    if (g.available !== true) throw new Error("anon posting is not available on the zk rig: " + g.unavailableReason);
    const unknown = await api("GET", "/api/personas/post-mode?personaId=p_not_mine_" + stamp);
    if (unknown.status !== 403) throw new Error("a stranger's post mode was answered: " + unknown.status);
    return `P2 anon, P3 direct, K = ${K}`;
  });

  await check("2. K PER PERSON, SHARED ACROSS PERSONAS: K posts made as MAIN, P2, MAIN, P2 are queued (202, each answering the persona it was made as); the (K+1)th, as P2 (which has used only two), is refused 409 'window' with the plain sentence — no secret minted, no wanted entry, no device-signed write; the tick gives the K posts K distinct slots and K distinct nullifiers, all accepted and relayed", async () => {
    const who = [MAIN, P2, MAIN, P2, MAIN, P2, MAIN, P2].slice(0, K);
    for (const [i, p] of who.entries()) {
      const r = await api("POST", "/api/anon", { text: `slots ${i} ${stamp} [layers-test fixture]`, personaId: p });
      if (r.status !== 202 || r.json?.personaId !== p) throw new Error(`post ${i + 1} as ${p}: ` + r.status + " " + JSON.stringify(r.json).slice(0, 200));
      ours.push({ castHash: r.json.castHash, personaId: p, envelope: null });
    }
    // the (K+1)th, before any tick: everything waiting counts
    // PERSONA LAUNCH wave 3 (final verify, harness): the rig ticks on its own every ~3 s (ZK_PREFETCH_MS=3000), and a
    // scheduled tick landing between g0 and g1 moves our K wanted posts into the queue — the old count comparison then
    // read "minted a wanted entry" with nothing minted (wave-3 step-5 run, 2026-10-13; passed alone right after). So the
    // refusal is judged by IDENTITY: every cast hash g1 knows (wanted, queued, revealable) must already be ours or known
    // to g0 — the refused post's entry, had one been minted, is the one hash that is not; and when no tick landed in
    // between, the exact counts are still required as before.
    const lastTickAt = async () => {
      const t = (await retry(() => zk("prefetchStatus"))).json?.ticks ?? [];
      return t.length ? t[t.length - 1].at : 0;
    };
    const hashesOf = (g) => new Set([...(g.wanted ?? []).map((w) => w.castHash), ...(g.revealable ?? []), ...(g.items ?? []).map((i) => i.castHash)].filter((h) => typeof h === "string" && h));
    const tick0 = await lastTickAt();
    const t0 = Date.now();
    const g0 = (await retry(() => api("GET", "/api/anon"))).json;
    const pendingBefore = (await retry(() => zk("queueStatus"))).json?.persistPending === true;
    const before = stateRows();
    const r = await api("POST", "/api/anon", { text: `one too many ${stamp} [layers-test fixture]`, personaId: P2 });
    const after = stateRows();
    const pendingAfter = (await retry(() => zk("queueStatus"))).json?.persistPending === true;
    if (r.status !== 409 || r.json?.code !== "window") throw new Error("the (K+1)th was not refused 409 window: " + r.status + " " + JSON.stringify(r.json));
    if (r.json.error !== `You have used all ${K} anonymous posts for this 6-hour window. They are shared across your personas.`) throw new Error("sentence: " + r.json.error);
    const g1 = (await retry(() => api("GET", "/api/anon"))).json;
    const t1 = Date.now();
    const tick1 = await lastTickAt();
    const known = hashesOf(g0);
    for (const o of ours) known.add(o.castHash);
    const minted = [...hashesOf(g1)].filter((h) => !known.has(h));
    if (minted.length) throw new Error("the refused post minted a secret or a wanted entry: " + minted.map((h) => h.slice(0, 12)).join(", "));
    if (!(hashesOf(g0).size >= 1 && ours.every((o) => hashesOf(g1).has(o.castHash)))) throw new Error("vacuity: the reads do not list our K posts (" + JSON.stringify({ g0: hashesOf(g0).size, g1: hashesOf(g1).size }) + ")");
    // PUBLIC GO-LIVE (final verify, harness): "no tick in between" must count a tick that was IN PROGRESS across g0..g1 —
    // a tick is logged only when it ENDS, and one that started before g0 and ended after tick1 moved wanted posts into
    // the queue unseen (closing sweep 5, 2026-10-19: counts moved, identity check clean, tick0 === tick1). Ticks run one
    // at a time, so once a tick that STARTED after g1 has ended, every tick that overlapped [g0, g1] has ended too: wait
    // for one (bounded), then judge the counts strictly unless a logged tick overlapped the window. If none is seen in
    // time, the old rule (no new tick logged) stands, exactly as strict as before.
    let ticksSeen = null;
    for (let i = 0; i < 40; i++) {
      const tl = (await retry(() => zk("prefetchStatus"))).json?.ticks ?? [];
      if (tl.some((t) => Number(t.at) - Number(t.ms ?? 0) > t1)) { ticksSeen = tl; break; }
      await sleep(500);
    }
    const overlapped = ticksSeen ? ticksSeen.some((t) => Number(t.at) >= t0 && Number(t.at) - Number(t.ms ?? 0) <= t1) : tick1 !== tick0;
    if (!overlapped && (g1.revealable.length !== g0.revealable.length || g1.wanted.length !== g0.wanted.length)) throw new Error("the refused post minted a secret or a wanted entry (the counts moved with no tick in between)");
    const changed = changedNamespaces(before, after);
    // a queue persist an EARLIER suite scheduled (30 s – 15 min after its proof) may fire inside the window: that is
    // the queue's own deferred write, not this compose's (accept-anon-reveal check 10 reads it the same way)
    if (changed.length && !(pendingBefore && !pendingAfter && changed.every((ns) => ns === "zkQueue"))) throw new Error("a device-signed write landed at the refused compose: " + changed.join(","));
    // the tick
    await tick(ours.map((o) => o.castHash));
    for (const o of ours) {
      const q = await anonStatus(o.castHash, true);
      if (q.item?.status !== "queued" || !q.envelope) throw new Error("not queued after the tick: " + JSON.stringify({ item: q.item, outcome: q.outcome }));
      o.envelope = q.envelope;
    }
    const slots = ours.map((o) => o.envelope.publicInputs.slot);
    if (new Set(slots).size !== K || !slots.every((s) => Number.isInteger(s) && s >= 0 && s < K)) throw new Error("not K distinct slots: " + JSON.stringify(slots));
    if (new Set(ours.map((o) => String(o.envelope.nullifier))).size !== K) throw new Error("not K distinct nullifiers");
    await drain();
    for (const o of ours) {
      const st = await anonStatus(o.castHash);
      if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(st.item));
    }
    const listed = new Set((await anonCasts()).map((c) => c.castHash));
    if (!ours.every((o) => listed.has(o.castHash))) throw new Error("not every post was relayed");
    const again = await api("POST", "/api/anon", { text: `still too many ${stamp} [layers-test fixture]`, personaId: MAIN });
    if (again.status !== 409 || again.json?.code !== "window") throw new Error("after the tick the window took another post: " + again.status);
    return `slots ${JSON.stringify(slots)}`;
  });

  await check("3. FORCED PAST THE CLIENT (dev hooks): the extra post re-uses a SPENT slot and the validator answers replay — nothing more is relayed; PRIV-1: those words are then refused 409 'replayed' (plain, forced, re-cased) with no secret or wanted entry, while different words are still taken", async () => {
    const spent = ours.map((o) => o.envelope?.publicInputs?.slot);
    const relayed = (await anonCasts()).length;
    const f = await api("POST", "/api/anon", { text: `forced ${stamp} [layers-test fixture]`, personaId: P2, force: true });
    if (f.status !== 202) throw new Error("forced post not queued: " + f.status + " " + JSON.stringify(f.json));
    await tick([f.json.castHash]);
    const q = await anonStatus(f.json.castHash, true);
    if (q.item?.status !== "queued" || !spent.includes(q.envelope?.publicInputs?.slot)) throw new Error("the forced post did not take a spent slot: " + JSON.stringify({ slot: q.envelope?.publicInputs?.slot, spent }));
    await drain();
    const st = await anonStatus(f.json.castHash);
    if (st.item?.outcome !== "replay") throw new Error("the validator did not answer replay: " + JSON.stringify(st.item));
    if ((await anonCasts()).length !== relayed) throw new Error("the forced post was relayed");
    // A-ANON-SLOT-COLLISION-ACROSS-DEVICES: this replay is a slot another post spent — the status says NOT posted
    if (st.relayed !== false) throw new Error("the status read does not say the replayed post was never relayed: " + JSON.stringify({ relayed: st.relayed }));
    // and an ordinary accepted post's status carries no replay verdict
    if ((await anonStatus(ours[0].castHash)).relayed !== null) throw new Error("an accepted post carries a replay verdict");
    // PRIV-1: the replayed words are never sent again — refused on this device before anything is minted or wanted,
    // forced or not, re-cased too (the guard runs before the budget check, so 'window' cannot be what refuses them)
    const g0 = (await retry(() => api("GET", "/api/anon"))).json;
    for (const [text, force] of [[`forced ${stamp} [layers-test fixture]`, false], [`forced ${stamp} [layers-test fixture]`, true], [`  FORCED ${stamp.toUpperCase()}   [LAYERS-TEST FIXTURE] `, false]]) {
      const again = await api("POST", "/api/anon", { text, personaId: MAIN, force });
      if (again.status !== 409 || again.json?.code !== "replayed" || !/link/.test(String(again.json?.error))) throw new Error(`the replayed words were taken again (force ${force}): ` + again.status + " " + JSON.stringify(again.json));
    }
    const g1 = (await retry(() => api("GET", "/api/anon"))).json;
    if (g1.revealable.length !== g0.revealable.length || g1.wanted.length !== g0.wanted.length) throw new Error("a refused replayed-words post minted a secret or a wanted entry");
    // non-vacuity: different words, forced past the full window, are still taken by the client (it is the WORDS it refuses)
    const diff = await api("POST", "/api/anon", { text: `different words ${stamp} [layers-test fixture]`, personaId: P2, force: true });
    if (diff.status !== 202) throw new Error("different words were refused too: " + diff.status + " " + JSON.stringify(diff.json));
  });

  await check("4. THE PERSONA IS SEALED, AND SURVIVES A RESTART: no envelope and no validator row names a persona; GET /api/anon lists each post with its persona (device-local); the ONE sealed zkQueue record, persisted and read back COLD, holds each post's persona — and its stored bytes show none", async () => {
    const ids = [MAIN, P2, P3];
    for (const o of ours) {
      const s = JSON.stringify(o.envelope);
      if (ids.some((id) => s.includes(id)) || o.envelope.publicInputs.personaId !== "anon") throw new Error("an envelope names a persona");
    }
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      for (const o of ours) {
        const row = db.prepare("SELECT * FROM zk_anon_casts WHERE mode = 'fixture' AND cast_hash = ?").get(o.castHash);
        if (!row) throw new Error("no row for " + o.castHash);
        if (ids.some((id) => JSON.stringify(row).includes(id))) throw new Error("an anon row names a persona");
        // PERSONA LAUNCH P4: the row stores the post's 256-byte ring note (real or random — the same size either way)
        if (typeof row.note !== "string" || !/^[0-9a-f]{512}$/.test(row.note) || typeof row.tree !== "string" || !row.tree) throw new Error("tree/note: " + JSON.stringify({ tree: row.tree, note: String(row.note).slice(0, 40) }));
      }
    } finally { db.close(); }
    const items = (await retry(() => api("GET", "/api/anon"))).json.items;
    for (const o of ours) if (items.find((i) => i.castHash === o.castHash)?.personaId !== o.personaId) throw new Error("the status read does not name the persona of " + o.castHash.slice(0, 10));
    const rb = (await retry(() => zk("anonQueueReadback", { personaIds: ids }))).json;
    if (rb.rows?.length !== 1 || !rb.rows[0].ciphertext) throw new Error("the sealed queue is not ONE ciphertext record: " + JSON.stringify(rb.rows));
    if ((rb.plaintextHits ?? []).length) throw new Error("the stored queue shows " + rb.plaintextHits.join(","));
    for (const o of ours) if (!rb.records.some((r) => r.castHash === o.castHash && r.personaId === o.personaId && r.hasSecret)) throw new Error("the cold read lost the persona or the secret of " + o.castHash.slice(0, 10));
    return `${rb.records.length} sealed reveal records, one ${rb.rows[0].ctBytes}-byte ciphertext row`;
  });

  await check("5. EXPLICIT 'private' IS ENFORCED SERVER-SIDE AND SURVIVES: P2 set to Totem only → /api/anon refuses 409 post-mode, the composer read says P2 may not post anonymously; 'direct' without an account is refused; the mode reads back cold from the keystore file, the sealed identityRoster and the sealed rootRoster; P3 (with an account) set private answers the Farcaster buttons 'Saved in Totem only — @x is set to post in Totem only', 'direct' leaves the answer as before, and (PRIV-2) an explicit 'anon' answers 'Saved in Totem only — @x is set to post through @anon' and a plain post is saved in Totem only", async () => {
    // a fresh window, so the budget cannot be the reason for any refusal below
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const set = await postMode(P2, "private");
    if (set.status !== 200 || set.json?.mode !== "private" || set.json?.explicit !== true) throw new Error("set private: " + set.status + " " + JSON.stringify(set.json));
    const r = await api("POST", "/api/anon", { text: `layers only ${stamp} [layers-test fixture]`, personaId: P2 });
    if (r.status !== 409 || r.json?.code !== "post-mode" || !/set to post in Totem only/.test(String(r.json?.error))) throw new Error("/api/anon for a Totem-only persona: " + r.status + " " + JSON.stringify(r.json));
    const g = (await retry(() => api("GET", "/api/anon?personaId=" + P2))).json;
    if (g.postAs?.personaId !== P2 || g.postAs?.mode !== "private" || g.postAs?.available !== false) throw new Error("postAs: " + JSON.stringify(g.postAs));
    const d = await postMode(P2, "direct");
    if (d.status !== 409 || d.json?.code !== "no_account") throw new Error("'direct' without an account: " + d.status + " " + JSON.stringify(d.json));
    const rb = (await retry(() => zk("postModeReadback", { personaId: P2 }))).json;
    if (rb.keystore !== "private" || rb.identityRoster !== "private" || rb.rootRoster !== "private") throw new Error("the mode did not survive a cold read: " + JSON.stringify(rb));
    // the Farcaster buttons (the fixture knob sends them through the write door on the SIMULATED network)
    const k = await knob(true);
    if (k.status !== 200 || k.json?.fixtureDelivery !== true) throw new Error("the knob did not arm: " + JSON.stringify(k.json));
    try {
      await as(P3);
      const base = (await retry(() => api("GET", "/api/actions/delivery"))).json.delivery;
      if (base?.to !== "farcaster") throw new Error("P3's default answer is not Farcaster: " + JSON.stringify(base));
      if ((await postMode(P3, "private")).status !== 200) throw new Error("could not set P3 private");
      const lo = (await retry(() => api("GET", "/api/actions/delivery"))).json.delivery;
      const name = P3_HANDLE;
      if (lo?.to !== "layers" || lo.reason !== "post_mode_private" || lo.message !== `Saved in Totem only — @${name} is set to post in Totem only`) throw new Error("P3 private: " + JSON.stringify(lo));
      // 'direct' is the account's answer, as before
      if ((await postMode(P3, "direct")).status !== 200) throw new Error("could not set P3 direct");
      const dir = (await retry(() => api("GET", "/api/actions/delivery"))).json.delivery;
      if (dir?.to !== "farcaster" || dir.message !== base.message) throw new Error("P3 direct changed the answer: " + JSON.stringify(dir));
      // PRIV-2: an EXPLICIT 'anon' keeps P3 OFF its own account — the anon toggle is the only way its words leave Totem
      if ((await postMode(P3, "anon")).status !== 200) throw new Error("could not set P3 anon");
      const an = (await retry(() => api("GET", "/api/actions/delivery"))).json.delivery;
      if (an?.to !== "layers" || an.reason !== "post_mode_anon" || an.message !== `Saved in Totem only — @${name} is set to post through @anon`) throw new Error("PRIV-2: P3 set to anon still reaches its own account: " + JSON.stringify(an));
      // and a plain post made anyway (the toggle unticked, or a failed status read) is decided again by the cast route:
      // saved in Totem only, nothing on the (simulated) network
      const cast = await api("POST", "/api/actions/cast", { text: `plain while anon ${stamp} [layers-test fixture]`, expect: { to: "layers", personaId: P3, fid: null } });
      if (cast.status !== 200 || cast.json?.delivery?.to !== "layers" || cast.json?.delivery?.reason !== "post_mode_anon") throw new Error("PRIV-2: a plain post from P3 in 'anon' mode: " + cast.status + " " + JSON.stringify(cast.json).slice(0, 300));
    } finally {
      await knob(false).catch(() => {});
      await as(null).catch(() => {});
      viewerCookie = null;
    }
  });

  await check("6. THE COMPOSER: under the proof layer the anon toggle is ON by default for a persona in 'anon' mode, the line names the persona and the cadence, the picker shows the mode and the delivery line hides; PRIV-4: an anonymous post fires no save moment (a plain post does); unticked, the delivery line returns. UX-3: without the proof layer the toggle is not offered, one plain sentence says anonymous posting is off on this server, no 'by default' note, the picker shows the persona's posts going in Totem only", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      await page.locator("[data-testid='composer-input']").first().click();
      const toggle = page.locator("[data-testid='composer-anon']").first();
      await toggle.waitFor({ timeout: 10000 });
      let on = false;
      for (let i = 0; i < 30 && !on; i++) { on = await toggle.isChecked(); if (!on) await sleep(300); }
      if (!on) throw new Error("the anon toggle is not on by default for a persona in 'anon' mode");
      const audience = (await page.locator("[data-testid='composer-audience']").first().textContent()) ?? "";
      if (!/Posting as @\S+ through @anon/.test(audience) || !/attributed to no one/.test(audience) || !audience.includes(`Up to ${K} every 6 hours, shared across your personas.`)) throw new Error("audience line: " + audience);
      if (MAIN_HANDLE && !audience.includes("@" + MAIN_HANDLE)) throw new Error("the line does not name the acting persona @" + MAIN_HANDLE + ": " + audience);
      const picker = page.locator("[data-testid='composer-post-mode']").first();
      await picker.waitFor({ timeout: 8000 });
      if ((await picker.getAttribute("data-mode")) !== "anon") throw new Error("picker mode: " + (await picker.getAttribute("data-mode")));
      if ((await page.locator("[data-testid='composer-delivery']").count()) !== 0) throw new Error("the delivery line shows while posting anonymously");
      // PRIV-4: an anonymous post fires NO save moment (the passkey save's device-signed writes would follow the compose)
      await page.evaluate(() => { window.__moments = []; window.addEventListener("layers:moment", (e) => window.__moments.push(e.detail ?? null)); });
      await page.locator("[data-testid='composer-input']").first().fill(`no moment ${stamp} [layers-test fixture]`);
      await page.locator("[data-testid='composer-submit']").first().click();
      await page.locator("[data-testid='anon-post-status']").first().waitFor({ timeout: 10000 });
      await sleep(500);
      const anonMoments = await page.evaluate(() => window.__moments.length);
      if (anonMoments !== 0) throw new Error("PRIV-4: an anonymous post dispatched " + anonMoments + " layers:moment event(s)");
      await page.locator("[data-testid='composer-input']").first().fill("a draft");
      await toggle.uncheck();
      await page.locator("[data-testid='composer-delivery']").first().waitFor({ timeout: 8000 });
      if (await toggle.isChecked()) throw new Error("the default re-ticked the toggle over the owner's own click");
      // non-vacuity: the same listener DOES hear a plain post's moment
      await page.locator("[data-testid='composer-submit']").first().click();
      await page.locator("[data-testid='composer-result']").first().waitFor({ timeout: 10000 });
      let plainMoments = 0;
      for (let i = 0; i < 10 && plainMoments === 0; i++) { plainMoments = await page.evaluate(() => window.__moments.length); if (!plainMoments) await sleep(200); }
      if (plainMoments < 1) throw new Error("the listener heard no moment from a plain post either — the PRIV-4 assertion above would be vacuous");
      // without the proof layer: not offered, and said
      await retry(() => zk("setRepImpl", { impl: null }));
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p2.goto(BASE + "/home", { waitUntil: "networkidle" });
      await p2.locator("[data-testid='composer-input']").first().click();
      const un = p2.locator("[data-testid='composer-anon-unavailable']").first();
      await un.waitFor({ timeout: 10000 });
      const t = (await un.textContent()) ?? "";
      // UX-3: deployment-wide — one plain sentence; nothing claims the persona "posts through @anon by default" here
      if ((await un.getAttribute("data-scope")) !== "deployment" || !t.startsWith("Anonymous posting is off on this server.")) throw new Error("unavailable sentence: " + JSON.stringify({ scope: await un.getAttribute("data-scope"), t }));
      if (/reputation binding|proof layer/.test(t.split("why")[0])) throw new Error("the jargon reason is the sentence, not the detail: " + t);
      if ((await p2.locator("[data-testid='composer-anon-default-note']").count()) !== 0 || /by default/.test(t)) throw new Error("UX-3: the 'posts through @anon by default' note shows where nothing posts through @anon");
      if ((await p2.locator("[data-testid='composer-anon']").count()) !== 0) throw new Error("the toggle is offered without the proof layer");
      const pk = p2.locator("[data-testid='composer-post-mode']").first();
      await pk.waitFor({ timeout: 8000 });
      if ((await pk.getAttribute("data-mode")) !== "anon" || (await pk.getAttribute("data-effective")) !== "layers") throw new Error("the picker: " + JSON.stringify({ mode: await pk.getAttribute("data-mode"), effective: await pk.getAttribute("data-effective") }));
      const opts = await pk.locator("option").evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled, selected: o.selected })));
      const sel = opts.find((o) => o.selected);
      if (!sel || !/in Totem only/.test(sel.text) || /through @anon/.test(sel.text)) throw new Error("UX-3: the picker shows the persona going through @anon where it can't: " + JSON.stringify(opts));
      if (opts.some((o) => o.value === "anon" && !o.disabled)) throw new Error("UX-3: 'through @anon' is offered where anonymous posting is off: " + JSON.stringify(opts));
      await p2.locator("[data-testid='composer-input']").first().fill("a draft");
      await p2.locator("[data-testid='composer-delivery']").first().waitFor({ timeout: 8000 });
    } finally {
      await browser.close();
      await retry(() => zk("setRepImpl", { impl: "zk" })).catch(() => {});
    }
  });

  await check("7. UX-L1 — A POST DURING A LAUNCH: with a launch of MAIN under way (rig-planted, nothing sent) GET /api/anon says postAs.launchPending with the plain sentence (P3 does not; control before the plant); a post whose line said 'attributed to no one' is refused 409 'launch' with no secret and no wanted entry; the acknowledged post is accepted (202, the note says it will be revealed); the composer says so instead of 'attributed to no one' and hides the ring line's 'Everyone else sees @anon.'; once the launch is no longer under way the composer's stale line is refused at the click, read again, and the words stay in the box", async () => {
    // a fresh window, so the budget is never the reason for anything below
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    const anonGet = async (q = "") => (await retry(() => api("GET", "/api/anon" + q))).json;
    // POSITIVE CONTROL: no launch yet — the line's facts say so
    const g0 = await anonGet();
    if (g0.postAs?.personaId !== MAIN || g0.postAs.launchPending !== false || g0.postAs.launchNotice !== null) throw new Error("before the launch: " + JSON.stringify(g0.postAs));
    const plant = (await retry(() => zk("launchProbe", { op: "plant", personaId: MAIN }))).json;
    if (!/^[0-9a-f]{64}$/.test(String(plant?.launchCommit))) throw new Error("the probe did not plant a launch record: " + JSON.stringify(plant));
    let ended = false;
    const endProbe = async () => {
      if (ended) return;
      await retry(() => zk("launchProbe", { op: "end", launchCommit: plant.launchCommit }));
      ended = true;
    };
    try {
      const h = MAIN_HANDLE ?? plant.handle;
      const sentence = `@${h} is being launched, so this post will become public as @${h}'s, with every other anonymous post @${h} made, shortly after its account appears.`;
      const g = await anonGet();
      if (g.postAs?.launchPending !== true || g.postAs.launchNotice !== sentence) throw new Error("during the launch: " + JSON.stringify({ launchPending: g.postAs?.launchPending, launchNotice: g.postAs?.launchNotice }));
      if (g.postAs.available !== true) throw new Error("MAIN may not post during its launch (posting is not paused by a launch): " + JSON.stringify(g.postAs));
      const g3 = await anonGet("?personaId=" + P3);
      if (g3.postAs?.personaId !== P3 || g3.postAs.launchPending !== false) throw new Error("P3 (not launching) reads as launching: " + JSON.stringify(g3.postAs));
      // a post whose line said "attributed to no one": refused before anything is minted
      const before = { revealable: g.revealable.length, wanted: g.wanted.length };
      const stale = await api("POST", "/api/anon", { text: `during the launch, unaware ${stamp} [layers-test fixture]`, personaId: MAIN });
      if (stale.status !== 409 || stale.json?.code !== "launch" || !String(stale.json?.error).startsWith(sentence) || !/Nothing was sent\./.test(String(stale.json?.error))) throw new Error("an unacknowledged post during the launch: " + stale.status + " " + JSON.stringify(stale.json));
      const mid = await anonGet();
      if (mid.revealable.length !== before.revealable || mid.wanted.length !== before.wanted) throw new Error("the refused post minted a secret or became wanted: " + JSON.stringify({ before, after: { revealable: mid.revealable.length, wanted: mid.wanted.length } }));
      // the acknowledged one: accepted, and the answer says it will be revealed
      const acked = await api("POST", "/api/anon", { text: `during the launch, knowingly ${stamp} [layers-test fixture]`, personaId: MAIN, launchPending: true });
      if (acked.status !== 202 || acked.json?.launchPending !== true || !/revealed as this persona's with its other anonymous posts/.test(String(acked.json?.note))) throw new Error("the acknowledged post: " + acked.status + " " + JSON.stringify(acked.json));
      // THE COMPOSER
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(BASE + "/home", { waitUntil: "networkidle" });
        await page.locator("[data-testid='composer-input']").first().click();
        const toggle = page.locator("[data-testid='composer-anon']").first();
        await toggle.waitFor({ timeout: 10000 });
        let on = false;
        for (let i = 0; i < 30 && !on; i++) { on = await toggle.isChecked(); if (!on) await sleep(300); }
        if (!on) throw new Error("the anon toggle is not on for MAIN during its launch");
        const audience = page.locator("[data-testid='composer-audience']").first();
        let launchAttr = null;
        for (let i = 0; i < 30 && launchAttr !== "pending"; i++) { launchAttr = await audience.getAttribute("data-launch"); if (launchAttr !== "pending") await sleep(300); }
        const t = (await audience.textContent()) ?? "";
        if (launchAttr !== "pending" || !t.includes(sentence) || /attributed to no one/.test(t) || !/Until then everyone sees @anon\./.test(t)) throw new Error("the composer's line during the launch: " + JSON.stringify({ launchAttr, t }));
        if ((await page.locator("[data-testid='ring-audience-line']").count()) !== 0) throw new Error("the ring line ('Everyone else sees @anon.') shows during the launch");
        // the launch is no longer under way (it failed, or its reveal landed) while this composer still shows the launch line
        await endProbe();
        const words = `stale line ${stamp} [layers-test fixture]`;
        await page.locator("[data-testid='composer-input']").first().fill(words);
        const beforeStale = await anonGet();
        await page.locator("[data-testid='composer-submit']").first().click();
        // refused at the click; the line is read again and says "attributed to no one"; the words stay in the box
        let again = "";
        for (let i = 0; i < 40; i++) { again = (await audience.textContent()) ?? ""; if (/attributed to no one/.test(again)) break; await sleep(300); }
        if (!/attributed to no one/.test(again) || (await audience.getAttribute("data-launch")) === "pending") throw new Error("the composer's line was not read again after the stale click: " + again);
        if ((await page.locator("[data-testid='composer-input']").first().inputValue()) !== words) throw new Error("the refused words were cleared from the box");
        const afterStale = await anonGet();
        if (afterStale.revealable.length !== beforeStale.revealable.length || afterStale.wanted.length !== beforeStale.wanted.length) throw new Error("the stale click minted a secret or queued a post");
        if ((await page.locator("[data-testid='anon-post-status']").count()) !== 0) throw new Error("the stale click mounted a post status line (as if it were queued)");
      } finally {
        await browser.close();
      }
      const gAfter = await anonGet();
      if (gAfter.postAs?.launchPending !== false || gAfter.postAs.launchNotice !== null) throw new Error("the ended launch still reads as under way: " + JSON.stringify(gAfter.postAs));
      return "refused unaware, accepted acknowledged, the composer said so, the stale line was refused and read again";
    } finally {
      await endProbe().catch(() => {});
    }
  });
} catch (e) {
  fail("setup", e.message);
} finally {
  await knob(false).catch(() => {});
  viewerCookie = null;
  await retry(() => dev("viewAs", { personaId: null })).catch(() => {});
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Persona launch P3 (anon slots) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
