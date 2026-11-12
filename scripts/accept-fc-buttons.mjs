// BUILD A — acceptance (rig, FIXTURE transport): THE APP'S BUTTONS REALLY POST TO FARCASTER.
//
// On the owner service, with real writes armed, Post / Reply / Like / Recast / Follow go through the one write door
// (lib/fc/writes.ts: identity rule, ledger-before-network, caps, check-before-retry) as the acting persona's OWN
// account, and the UI says what happened; everything else says "… in Totem only — <why>". A rig never arms real
// writes, so this suite arms the rig-only FIXTURE KNOB (POST /api/actions/delivery {action:"fixtureDelivery"}; refused
// unless ZK_DEV_HOOKS=true, refused beside armed writes, on the owner service, under LAYERS_WORLD=empty and under live
// content; a seed reset disarms it) and drives the SAME routes against the simulated network. Nothing here can reach
// Farcaster: the knob only ever selects the simulated network, and check 14 asserts every ledger row is fixture.
//
//    1. THE KNOB AND THE PRE-POST ANSWER: before arming, a persona with a fixture account says "Saved in Totem only —
//       Farcaster posting is off on this service"; armed, "Posts to Farcaster (simulated network) as @x — public"
//    2. POST: the Composer's route sends the cast through the door as the persona's own fid — on the sim network under
//       that fid, one fixture ledger row, attributed to the persona, a local copy under the network hash in the feed
//    3. THE SAME TEXT AGAIN: check-before-retry finds it — deduped, "Already on …", still one cast
//    4. REPLY to a Farcaster cast: a reply (parent carried), ledgered as a reply under the persona's fid
//    5. REPLY under a post that is NOT on Farcaster (a seed post): saved in Totem only, says so, no ledger row
//    6. LIKE a Farcaster cast: through the door; again → "Already liked" (no second row); un-like → 409
//       FC_UNDO_UNSUPPORTED, nothing changed
//    7. LIKE a seed post: Totem only ("that post isn't on Farcaster"), no ledger row
//    8. NEVER TWO OF YOUR ACCOUNTS: another persona liking / replying to / following the first one's account from the
//       buttons → 403 FC_SELF_LINK, no ledger row (Act as… keeps its waiver)
//    9. NO ACCOUNT: a persona without its own account → "Saved in Totem only — @x has no Farcaster account yet" + the
//       command that creates one; NOTHING reaches the door (no ledger row, nothing on the sim network) — never the
//       shared account
//   10. FOLLOW + THE FOLLOW BUDGET: a follow goes through the door with its target fid on the ledger row; again →
//       "Already following"; 10 a day, the 11th → 429 follows_per_day; un-follow → 409
//   11. ACT AS: a recast of a Farcaster cast goes through the door; a reply by a persona with no account stays in
//       Totem (network:false)
//   12. THE KNOB DISARMS: off → "Farcaster posting is off"; armed again, a seed reset disarms it
//   13. PAGE: the composer shows where the post goes BEFORE the click and the toast says where it went after —
//       "Posted to Farcaster (simulated network) as @x" armed, "Saved in Totem only — …" disarmed; the generic
//       "your post was sent" line appears nowhere
//   14. SWEEP SAFETY: writes are disarmed, the knob ends disarmed, and every ledger row this suite made is fixture
//
// Fixture, pinned ports, no network, no spend. Acts as a persona through the "view as" request cookie, the way the
// multi-fid suites do (lib/activePersona.ts).
//   node scripts/accept-fc-buttons.mjs         (the rig must be up: npm run dev / the sweep harness, ZK_DEV_HOOKS=true)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { assertServersUp, isInfraError, pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const FORK_SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;
const SEED_POST = "0xcr0011"; // a seeded post: in Totem, never on Farcaster

const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "view as" is a request COOKIE (lib/activePersona.ts): every request after as(x) carries it, like a browser would —
// and the action routes act as activeSeedPersonaId(), which honours it
let viewerCookie = null;
async function api(method, url, body) {
  const headers = { "content-type": "application/json" };
  if (viewerCookie) headers.cookie = "layers_view_as=" + viewerCookie;
  const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
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
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const as = async (personaId) => { await retry(() => dev("viewAs", { personaId })); viewerCookie = personaId; };
const knob = (on) => api("POST", "/api/actions/delivery", { action: "fixtureDelivery", on });
const where = async (q = "") => (await retry(() => api("GET", "/api/actions/delivery" + q))).json;
const cast = (body) => api("POST", "/api/actions/cast", body);
const react = (body) => api("POST", "/api/actions/react", body);
const follow = (body) => api("POST", "/api/actions/follow", body);
const ledger = async () => (await retry(() => api("GET", "/api/fc/write"))).json;
const simCasts = async () => (await retry(() => dev("fcSimNetwork"))).json.casts;
const attributions = async (hashes) => (await retry(() => api("GET", "/api/fc/attribution?hashes=" + hashes.map(encodeURIComponent).join(",")))).json.attributions;
const rowsOf = async (pred) => (await ledger()).entries.filter(pred);

await assertServersUp(BASE);
if (!FORK_SOURCE) throw new Error("no seeded fork source (brothandbones) in seed/data/accounts.json");

// ---- setup: two personas with their OWN (fixture) accounts, one with none ----
await reset();
const stamp = Date.now().toString(36);
const forkPub = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fcb_pub_${stamp.slice(-4)}` }));
const PUB = forkPub.json.newPersona;
const forkSib = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fcb_sib_${stamp.slice(-4)}` }));
const SIB = forkSib.json.newPersona;
// the fork mints the new persona's fixture account in per-persona-fid mode; acquire only if it did not
const records = async () => (await retry(() => api("GET", "/api/fc/persona"))).json.records;
for (const id of [PUB, SIB]) if (!(await records()).some((r) => r.personaId === id)) await retry(() => persona("acquire", { personaId: id }));
const recPub = (await records()).find((r) => r.personaId === PUB);
const recSib = (await records()).find((r) => r.personaId === SIB);
if (!recPub?.fid || !recSib?.fid || recPub.mode !== "fixture") throw new Error("setup: the forked personas own no fixture account: " + JSON.stringify({ recPub, recSib }));
// a third persona with NO account: forked under shared-fid mode, which mints none (the accept-fid2 PUB3 pattern)
await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
let forkNone;
try { forkNone = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fcb_none_${stamp.slice(-4)}` })); }
finally { await retry(() => persona("setNetworkMode", { mode: null })); }
const NONE = forkNone.json.newPersona;
if (!NONE || forkNone.json.newFid) throw new Error("setup: the no-account persona got an account");
// on Farcaster an account goes by its fname (the protocol grammar: "fcb_pub_x" registers as "fcb-pub-x"), and the
// sentences name it that way
const PUB_NAME = recPub.fname;
if (!PUB_NAME) throw new Error("setup: the fixture account has no fname: " + JSON.stringify(recPub));
let castA = null;

try {
  await check("1. THE KNOB AND THE PRE-POST ANSWER: disarmed, a persona with a fixture account says 'Saved in Totem only — Farcaster posting is off on this service'; armed, 'Posts to Farcaster (simulated network) as @x — public'", async () => {
    await as(PUB);
    const before = await where();
    if (before.delivery?.to !== "layers" || before.delivery.message !== "Saved in Totem only — Farcaster posting is off on this service") throw new Error("disarmed: " + JSON.stringify(before));
    const k = await knob(true);
    if (k.status !== 200 || k.json?.fixtureDelivery !== true) throw new Error("the knob did not arm (the rig needs ZK_DEV_HOOKS=true): " + k.status + " " + JSON.stringify(k.json));
    const after = await where();
    if (after.delivery?.to !== "farcaster" || after.delivery.mode !== "fixture" || after.delivery.fid !== recPub.fid) throw new Error("armed: " + JSON.stringify(after));
    if (after.delivery.message !== `Posts to Farcaster (simulated network) as @${PUB_NAME} — public`) throw new Error("armed sentence: " + after.delivery.message);
    return after.delivery.message;
  });

  await check("2. POST through the door as the persona's OWN fid: on the sim network under that fid, one fixture ledger row, attributed to the persona, and a local copy under the network hash in the feed", async () => {
    await as(PUB);
    const text = `fc buttons hello ${stamp} [layers-test fixture]`;
    const r = await retry(() => cast({ text }));
    castA = r.json;
    if (castA.delivery?.to !== "farcaster" || castA.delivery.fid !== recPub.fid || castA.delivery.mode !== "fixture") throw new Error("delivery: " + JSON.stringify(castA));
    if (castA.delivery.message !== `Posted to Farcaster (simulated network) as @${PUB_NAME}`) throw new Error("sentence: " + castA.delivery.message);
    if (!String(castA.hash).startsWith("0xfc")) throw new Error("not a sim-network hash: " + castA.hash);
    const sim = (await simCasts()).filter((c) => c.text === text);
    if (sim.length !== 1 || sim[0].fid !== recPub.fid || sim[0].hash !== castA.hash) throw new Error("sim network: " + JSON.stringify(sim));
    const rows = await rowsOf((e) => e.castHash === castA.hash);
    if (rows.length !== 1 || rows[0].kind !== "cast" || rows[0].fid !== recPub.fid || rows[0].mode !== "fixture" || rows[0].status !== "sent") throw new Error("ledger: " + JSON.stringify(rows));
    const att = (await attributions([castA.hash]))[castA.hash];
    if (att?.id !== PUB) throw new Error("attribution: " + JSON.stringify(att));
    const feed = await retry(() => api("GET", "/api/feed?tab=foryou"));
    const mine = (feed.json?.casts ?? []).find((c) => c.hash === castA.hash);
    if (!mine || !(mine.text ?? "").includes(`fc buttons hello ${stamp}`)) throw new Error("no local copy in the feed under the network hash");
    return castA.hash;
  });

  await check("3. THE SAME TEXT AGAIN: check-before-retry finds it — deduped, 'Already on Farcaster (simulated network) …', still one cast on the sim network", async () => {
    await as(PUB);
    const text = `fc buttons hello ${stamp} [layers-test fixture]`;
    const r = await retry(() => cast({ text }));
    if (r.json.delivery?.deduped !== true || r.json.hash !== castA.hash || !/^Already on Farcaster \(simulated network\) as @/.test(r.json.delivery.message)) throw new Error(JSON.stringify(r.json));
    const sim = (await simCasts()).filter((c) => c.text === text);
    if (sim.length !== 1) throw new Error("sim network holds " + sim.length);
  });

  await check("4. REPLY to a Farcaster cast: a reply through the door under the persona's fid (its own cast: no self-link)", async () => {
    await as(PUB);
    const r = await retry(() => cast({ text: `fc buttons reply ${stamp} [layers-test fixture]`, replyToHash: castA.hash }));
    if (r.json.delivery?.to !== "farcaster" || !/^Replied on Farcaster \(simulated network\) as @/.test(r.json.delivery.message)) throw new Error(JSON.stringify(r.json));
    const rows = await rowsOf((e) => e.castHash === r.json.hash);
    if (rows.length !== 1 || rows[0].kind !== "reply" || rows[0].fid !== recPub.fid) throw new Error("ledger: " + JSON.stringify(rows));
  });

  await check("5. REPLY under a post that is NOT on Farcaster (a seed post): 'Saved in Totem only — the post you replied to isn't on Farcaster', a local hash, no ledger row", async () => {
    await as(PUB);
    const before = (await ledger()).entries.length;
    const r = await retry(() => cast({ text: `fc buttons local reply ${stamp}`, replyToHash: SEED_POST }));
    if (r.json.delivery?.reason !== "target_local" || r.json.delivery.message !== "Saved in Totem only — the post you replied to isn't on Farcaster") throw new Error(JSON.stringify(r.json));
    if (!String(r.json.hash).startsWith("0xlocal")) throw new Error("hash " + r.json.hash);
    if ((await ledger()).entries.length !== before) throw new Error("a ledger row for a Totem-only reply");
  });

  await check("6. LIKE a Farcaster cast through the door; again → 'Already liked' (no second row); un-like → 409 FC_UNDO_UNSUPPORTED, nothing changed", async () => {
    await as(PUB);
    const r = await retry(() => react({ hash: castA.hash, kind: "like", on: true, authorFid: recPub.fid }));
    if (r.json.delivery?.to !== "farcaster" || !/^Liked on Farcaster \(simulated network\) as @/.test(r.json.delivery.message)) throw new Error(JSON.stringify(r.json));
    const likes = async () => rowsOf((e) => e.kind === "like" && e.castHash === castA.hash && e.fid === recPub.fid);
    if ((await likes()).length !== 1) throw new Error("like rows: " + (await likes()).length);
    const again = await retry(() => react({ hash: castA.hash, kind: "like", on: true }));
    if (again.json.delivery?.already !== true || (await likes()).length !== 1) throw new Error("again: " + JSON.stringify(again.json));
    const off = await react({ hash: castA.hash, kind: "like", on: false });
    if (off.status !== 409 || off.json?.code !== "FC_UNDO_UNSUPPORTED") throw new Error("un-like: " + off.status + " " + JSON.stringify(off.json));
    if ((await likes()).length !== 1) throw new Error("the un-like changed the ledger");
  });

  await check("7. LIKE a seed post: 'Liked in Totem only — that post isn't on Farcaster', no ledger row", async () => {
    await as(PUB);
    const before = (await ledger()).entries.length;
    const r = await retry(() => react({ hash: SEED_POST, kind: "like", on: true }));
    if (r.json.delivery?.reason !== "target_local" || r.json.delivery.message !== "Liked in Totem only — that post isn't on Farcaster") throw new Error(JSON.stringify(r.json));
    if ((await ledger()).entries.length !== before) throw new Error("a ledger row for a Totem-only like");
  });

  await check("8. NEVER TWO OF YOUR ACCOUNTS from a one-tap button: the second persona's like, reply and follow aimed at the first one's account → 403 FC_SELF_LINK, no ledger row", async () => {
    await as(SIB);
    const before = (await ledger()).entries.length;
    const like = await react({ hash: castA.hash, kind: "like", on: true });
    const reply = await cast({ text: `fc buttons sibling reply ${stamp}`, replyToHash: castA.hash });
    const fol = await follow({ targetFid: recPub.fid });
    for (const [n, r] of [["like", like], ["reply", reply], ["follow", fol]]) {
      if (r.status !== 403 || r.json?.code !== "FC_SELF_LINK") throw new Error(n + ": " + r.status + " " + JSON.stringify(r.json));
    }
    if ((await ledger()).entries.length !== before) throw new Error("a refused action left a ledger row");
    return like.json.error;
  });

  await check("9. NO ACCOUNT: 'Saved in Totem only — @x has no Farcaster account yet' + the command that creates one; nothing reaches the door — never the shared account", async () => {
    await as(NONE);
    const before = (await ledger()).entries.length;
    const simBefore = (await simCasts()).length;
    const r = await retry(() => cast({ text: `fc buttons no account ${stamp}` }));
    if (r.json.delivery?.reason !== "no_account" || !/^Saved in Totem only — @\S+ has no Farcaster account yet$/.test(r.json.delivery.message)) throw new Error(JSON.stringify(r.json));
    if (!(r.json.delivery.pointer ?? "").includes("acquire-fid.ps1 -PersonaId " + NONE)) throw new Error("pointer: " + r.json.delivery.pointer);
    if (!String(r.json.hash).startsWith("0xlocal")) throw new Error("hash " + r.json.hash);
    if ((await ledger()).entries.length !== before || (await simCasts()).length !== simBefore) throw new Error("something reached the write door");
    const fol = await follow({ targetFid: 3 });
    if (fol.status !== 409 || !/^Not followed — @\S+ has no Farcaster account yet$/.test(fol.json?.error ?? "")) throw new Error("follow: " + fol.status + " " + JSON.stringify(fol.json));
  });

  await check("10. FOLLOW + THE FOLLOW BUDGET: through the door with the target fid on the row; again → 'Already following'; 10 a day, the 11th → 429 follows_per_day; un-follow → 409", async () => {
    await as(PUB);
    // a target no configuration names (a rig's NEYNAR_VIEWER_FID would be refused as "your main account")
    const T0 = 1_000_000;
    const r = await retry(() => follow({ targetFid: T0, targetHandle: "fcb-target" }));
    if (r.json.delivery?.message !== `Following @fcb-target on Farcaster (simulated network) as @${PUB_NAME}`) throw new Error(JSON.stringify(r.json));
    const rows = await rowsOf((e) => e.kind === "follow" && e.fid === recPub.fid);
    if (rows.length !== 1 || rows[0].targetFid !== T0 || rows[0].mode !== "fixture") throw new Error("ledger: " + JSON.stringify(rows));
    const again = await retry(() => follow({ targetFid: T0 }));
    if (again.json.delivery?.already !== true) throw new Error("again: " + JSON.stringify(again.json));
    for (let i = 1; i < 10; i++) await retry(() => follow({ targetFid: T0 + i }));
    const l = await ledger();
    if (l.ledger.fixture.follows !== 10 || l.ledger.capFollows !== 10) throw new Error("budget count: " + JSON.stringify(l.ledger));
    const eleventh = await follow({ targetFid: 1_000_099 });
    if (eleventh.status !== 429 || eleventh.json?.cap !== "follows_per_day") throw new Error("11th: " + eleventh.status + " " + JSON.stringify(eleventh.json));
    if ((await rowsOf((e) => e.kind === "follow" && e.targetFid === 1_000_099)).length !== 0) throw new Error("the refused follow left a row");
    const off = await follow({ targetFid: T0, follow: false });
    if (off.status !== 409 || off.json?.code !== "FC_UNDO_UNSUPPORTED") throw new Error("un-follow: " + off.status + " " + JSON.stringify(off.json));
    return eleventh.json.error;
  });

  await check("11. ACT AS: a recast of a Farcaster cast through the door; a reply AS ANOTHER persona to a cast the Composer published (its local copy is found first) still goes out on the network under that persona's fid (the picker's waiver); a reply by a persona with no account stays in Totem (network:false)", async () => {
    viewerCookie = null;
    await retry(() => dev("viewAs", { personaId: null }));
    const rc = await retry(() => api("POST", "/api/actions/act-as", { kind: "recast", targetHash: castA.hash, asPersonaId: PUB }));
    if (rc.json.delivery?.to !== "farcaster" || rc.json.hash !== undefined) throw new Error("recast: " + JSON.stringify(rc.json));
    if ((await rowsOf((e) => e.kind === "recast" && e.castHash === castA.hash && e.fid === recPub.fid)).length !== 1) throw new Error("no recast row");
    const sib = await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: castA.hash, text: `fc buttons act-as sibling ${stamp} [layers-test fixture]`, asPersonaId: SIB }));
    if (sib.json.network !== true || sib.json.fid !== recSib.fid || sib.json.delivery?.to !== "farcaster") throw new Error("sibling act-as reply: " + JSON.stringify(sib.json));
    const rp = await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: castA.hash, text: `fc buttons act-as none ${stamp}`, asPersonaId: NONE }));
    if (rp.json.network === true || rp.json.delivery?.to !== "layers") throw new Error("no-account act-as reply: " + JSON.stringify(rp.json));
  });

  await check("12. THE KNOB DISARMS: off → 'Farcaster posting is off on this service'; armed again, a seed reset disarms it", async () => {
    await as(PUB);
    await retry(() => knob(false));
    const off = await where();
    if (off.delivery?.reason !== "writes_off" || off.fixtureDelivery !== false) throw new Error("off: " + JSON.stringify(off));
    await retry(() => knob(true));
    if ((await where()).fixtureDelivery !== true) throw new Error("did not re-arm");
    await reset();
    const afterReset = await retry(() => api("GET", "/api/actions/delivery"));
    if (afterReset.json?.fixtureDelivery !== false) throw new Error("the knob survived a seed reset: " + JSON.stringify(afterReset.json));
  });
} finally {
  await knob(false).catch(() => null);
}

// the page check runs on a fresh world: the reset above removed the forked personas, so fork one more
await check("13. PAGE: the composer says where the post goes BEFORE the click and the toast says where it went after — the simulated network armed, 'Saved in Totem only — …' disarmed; the old generic line nowhere", async () => {
  viewerCookie = null;
  const f = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fcb_page_${stamp.slice(-4)}` }));
  const PAGE = f.json.newPersona;
  if (!(await records()).some((r) => r.personaId === PAGE)) await retry(() => persona("acquire", { personaId: PAGE }));
  await as(PAGE);
  const browser = await chromium.launch();
  const seen = [];
  try {
    for (const armed of [true, false]) {
      await retry(() => knob(armed));
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([{ name: "layers_view_as", value: PAGE, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
      await page.getByTestId("nav-post-button").click();
      await page.waitForSelector("[data-testid='compose-modal']");
      const text = `fc buttons page ${armed ? "armed" : "off"} ${stamp}`;
      await page.getByTestId("composer-input").last().fill(text);
      const want = armed ? "farcaster" : "layers";
      // poll for the SETTLED answer, never a flat wait (the line renders after its own fetch)
      const settled = await pollUntil(async () => (await page.locator(`[data-testid='compose-modal'] [data-testid='composer-delivery'][data-delivery='${want}']`).count()) === 1, { tries: 25, delayMs: 300 });
      if (!settled) throw new Error(`the pre-post line never said '${want}'`);
      const line = (await page.locator("[data-testid='compose-modal'] [data-testid='composer-delivery']").innerText()).trim();
      if (armed ? !/^Posts to Farcaster \(simulated network\) as @\S+ — public$/.test(line) : line !== "Saved in Totem only — Farcaster posting is off on this service") throw new Error("pre-post line: " + line);
      await page.getByTestId("composer-submit").last().click();
      await page.waitForSelector("[data-testid='toast']", { timeout: 8000 });
      const toast = (await page.getByTestId("toast").first().innerText()).trim();
      if (armed ? !/^Posted to Farcaster \(simulated network\) as @\S+$/.test(toast) : toast !== "Saved in Totem only — Farcaster posting is off on this service") throw new Error("toast: " + toast);
      const body = await page.locator("body").innerText();
      if (/your post was sent/i.test(body)) throw new Error("the generic 'sent' line is on the page");
      seen.push(toast);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await knob(false).catch(() => null);
  }
  return seen.join(" | ");
});

await check("14. SWEEP SAFETY: real writes are disarmed, the knob ends disarmed, and every ledger row on this rig is fixture", async () => {
  const l = await ledger();
  if (l.writeEnabled !== false) throw new Error("writeEnabled is not false — sweeps must never run armed");
  const live = l.entries.filter((e) => e.mode !== "fixture");
  if (live.length) throw new Error(live.length + " non-fixture ledger rows");
  const w = await retry(() => api("GET", "/api/actions/delivery"));
  if (w.json?.fixtureDelivery !== false) throw new Error("the knob is still armed");
});

viewerCookie = null;
await retry(() => dev("viewAs", { personaId: null })).catch(() => null);
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\naccept-fc-buttons: ${results.length - failed - infra}/${results.length} passed${infra ? `, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
