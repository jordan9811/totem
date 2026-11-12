// MULTI-FID PASS — the anoncast reveal pattern (fixture): prove ownership of a past anon post, at
// your own choice, and attribute it to one of your real accounts.
//   1. SEALED AT POST TIME: the queued envelope carries a 64-hex attributionCommitment distinct from
//      the cast hash and from sha256(text) — an independent value, bound into the message
//   2. TAMPER-EVIDENT: resubmitting the SAME proof with a swapped commitment is refused (the message
//      no longer matches the canonical derivation) before any nullifier is touched
//   3. WRONG SECRET refused; a persona NOT the device's own refused; a persona with no fid of its own
//      refused — nothing is attributed on any of these
//   4. CORRECT SECRET + an owned, fid-holding persona succeeds: the public anon-casts list now shows
//      attributedFid == that persona's fid, attributedAt hour-grained
//   5. ONE REVEAL, EVER: the same persona revealing again is a harmless no-op; a DIFFERENT persona is refused
//      (PERSONA LAUNCH P6: refused ON THE DEVICE now — only the persona that posted a cast may be named, so post 1 is made
//      AS the fid-holding persona; the validator's own first-reveal-wins 409 is pinned in validator/test/zk.test.js)
//   6. NOTHING AUTOMATIC: a second, distinct anon post's row stays attributedFid: null throughout
//   7. LEAKS: the raw secret and the attribution domain string appear nowhere in the validator's DB
//   8. THE CARD: once revealed, the timeline shows "anon · revealed as @handle"; before, "Prove this is
//      yours" is offered only on THIS device, only for a cast it holds the secret for
//   9. §14.2 A CLAIM IS NOT A FACT: an unsigned reveal is refused; and an attribution the VALIDATOR
//      carries but whose signer key is not that fid's key renders as plain anon, never as a name
//  10. ANON REVIEW (R1-01 / R3-07): NO DEVICE-SIGNED WRITE AT COMPOSE TIME — within the second POST /api/anon
//      answers 202, no adapter_state row on the validator changes: none under the retired anonAttribution
//      namespace (the reveal secret now rides the sealed zkQueue record on the queue's own deferred write), none at all
//  11. ANON REVIEW (A2-2 / R3-02): A REFUSED PROOF IS NEVER SILENT — a post the tick cannot prove (the device's
//      commitment revoked from this epoch) reads on GET /api/anon?castHash= as 'wanted' (or 'dropped') with the
//      outcome's lastStage and reason, never 'unknown'; nothing relayed, the post still listed as wanted
// Fixture, pinned ports, no network, no spend.
// (The reveal control itself — R3-05 — now requires a persona choice plus the data-testid='anon-reveal-understood'
// checkbox before its button enables; check 8 only asserts the start button, so a future Playwright reveal flow must
// tick that box and pick the persona first.)
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const STRANGER = "persona_acc_crypto_1";
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
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
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
const driveOnce = async () => { await retry(() => zk("prefetchNow")); await sleep(400); return (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json; };
const anonCasts = async () => (await vapi("/zk/anon-casts?mode=fixture")).json?.casts ?? [];
const post = async (text) => {
  // the once-per-window refusal is judged against the CACHED prefetch snapshot's epoch — after an
  // advanceEpoch the snapshot must catch up before the client will accept a post in the new window
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  const r = await api("POST", "/api/anon", { text });
  if (r.status !== 202) throw new Error("queue: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
  await driveOnce();
  const st = (await retry(() => api("GET", `/api/anon?castHash=${r.json.castHash}`))).json;
  if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(st.item));
  const networkHash = (await anonCasts()).find((c) => c.castHash === r.json.castHash)?.hash;
  if (!networkHash) throw new Error("not listed");
  return { castHash: r.json.castHash, networkHash };
};
const reveal = (castHash, personaId) => api("POST", "/api/anon", { action: "reveal", castHash, personaId });
// §14.2 — a reveal must be signed by the fid's own signer key. The suite carries a key of its own so
// it can probe the validator directly the way a caller who is NOT our app would.
const RIG_KP = generateKeyPairSync("ed25519");
const RIG_PUB = RIG_KP.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const revealCanonical = (mode, castHash, fid, pub) => ["layers-anon-reveal/1", mode, castHash, String(fid), pub].join("|");
const rigSign = (castHash, fid) => edSign(null, Buffer.from(revealCanonical("fixture", castHash, fid, RIG_PUB), "utf8"), RIG_KP.privateKey).toString("hex");
const vpost = async (p, body) => {
  const r = await fetch(VBASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const rowFor = (castHash) => anonCasts().then((rows) => rows.find((c) => c.castHash === castHash));
const fork = (fromPersona, newHandle) => retry(() => api("POST", "/api/identity/fork", { fromPersona, carry: [], newHandle }));
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;

const stamp = Date.now().toString(36);
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

  // a persona of ours that owns its own fid, to reveal AS — and one that does not, to prove that's refused
  const forked = (await fork(idOf("brothandbones"), `anonreveal_${stamp}`)).json;
  const OWN_WITH_FID = forked.newPersona;
  if (!forked.newFid?.fid) {
    const r = (await retry(() => persona("acquire", { personaId: OWN_WITH_FID }))).json;
    if (!r.record?.fid) throw new Error("setup: OWN_WITH_FID has no fid");
  }
  await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
  let OWN_NO_FID;
  try {
    OWN_NO_FID = (await fork(idOf("brothandbones"), `anonreveal_nofid_${stamp}`)).json.newPersona;
  } finally {
    await retry(() => persona("setNetworkMode", { mode: null }));
  }

  let envelope1 = null, castHash1 = null, networkHash1 = null, castHash2 = null;

  await check("1. SEALED AT POST TIME: the queued envelope carries a 64-hex attributionCommitment distinct from the cast hash and from sha256(text) — an independent value bound into the message", async () => {
    const text = `anon reveal me ${stamp} [layers-test fixture]`;
    // PERSONA LAUNCH P6: posted AS the persona that will reveal it (only the posting persona may be named)
    const r = await api("POST", "/api/anon", { text, personaId: OWN_WITH_FID });
    if (r.status !== 202) throw new Error("queue: " + r.status);
    castHash1 = r.json.castHash;
    await retry(() => zk("prefetchNow"));
    await sleep(400);
    const queued = (await retry(() => api("GET", `/api/anon?castHash=${castHash1}&envelope=1`))).json;
    envelope1 = queued.envelope;
    const commitment = envelope1?.publicInputs?.attributionCommitment;
    if (!/^[0-9a-f]{64}$/.test(commitment ?? "")) throw new Error("no 64-hex attributionCommitment on the envelope: " + JSON.stringify(envelope1?.publicInputs).slice(0, 200));
    if (commitment === castHash1) throw new Error("the commitment equals the cast hash");
    if (commitment === createHash("sha256").update(text).digest("hex")) throw new Error("the commitment is just sha256(text)");
    await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }));
    const st = (await retry(() => api("GET", `/api/anon?castHash=${castHash1}`))).json;
    if (st.item?.status !== "sent" || st.item?.outcome !== "accepted") throw new Error("not accepted: " + JSON.stringify(st.item));
    networkHash1 = (await anonCasts()).find((c) => c.castHash === castHash1)?.hash;
    if (!networkHash1) throw new Error("not listed");
  });

  await check("2. TAMPER-EVIDENT: resubmitting the same proof with a swapped commitment is refused before any nullifier is touched — the ORIGINAL commitment is what a reveal must match", async () => {
    const swapped = createHash("sha256").update("someone-elses-secret").digest("hex");
    const out = (await retry(() => zk("submit", { envelope: { ...envelope1, publicInputs: { ...envelope1.publicInputs, attributionCommitment: swapped } } }))).json;
    if (out.status !== 400) throw new Error("a swapped commitment was not refused: " + JSON.stringify(out).slice(0, 200));
    const untouched = await rowFor(castHash1);
    if (untouched.attributedFid !== null) throw new Error("the row was attributed by the tamper attempt");
  });

  const own = (await retry(() => api("GET", "/api/fc/persona"))).json;
  const OWN_FID = own.records.find((r) => r.personaId === OWN_WITH_FID)?.fid;
  if (!OWN_FID) throw new Error("setup: OWN_WITH_FID owns no fid");

  await check("3. WRONG SECRET refused (straight to the validator — the app never hands out a secret to guess with); a persona that is not the device's own refused; a persona with no fid of its own refused — nothing attributed on any of these", async () => {
    // signed with the rig's own key so the refusal is genuinely ABOUT the secret, not about the signature
    const wrongResp = await vpost("/zk/anon/reveal", { mode: "fixture", castHash: castHash1, secret: "ab".repeat(32), fid: OWN_FID, signerPubKey: RIG_PUB, signature: rigSign(castHash1, OWN_FID) });
    if (wrongResp.status !== 400 || !/commitment/.test(wrongResp.json?.error ?? "")) throw new Error("a wrong secret was not refused for the right reason: " + wrongResp.status + " " + JSON.stringify(wrongResp.json));
    const rNoise = await api("POST", "/api/anon", { action: "reveal", castHash: castHash1, personaId: "p_does_not_exist" });
    if (rNoise.status !== 403) throw new Error("an unowned/unknown persona was not refused: " + rNoise.status);
    const rNoFid = await reveal(castHash1, OWN_NO_FID);
    if (rNoFid.status !== 400 || !/no fid of its own/.test(rNoFid.json?.error ?? "")) throw new Error("a fid-less persona was not refused for the right reason: " + JSON.stringify(rNoFid.json));
    const direct = (await vapi(`/zk/anon-casts?mode=fixture`)).json.casts.find((c) => c.castHash === castHash1);
    if (direct.attributedFid !== null) throw new Error("attributed by a refused attempt: " + JSON.stringify(direct));
  });

  await check("4. CORRECT SECRET + an owned, fid-holding persona succeeds: the public list now shows attributedFid == that persona's fid, attributedAt hour-grained", async () => {
    const r = await reveal(castHash1, OWN_WITH_FID);
    if (r.status !== 200 || r.json.attributedFid !== OWN_FID) throw new Error("reveal: " + r.status + " " + JSON.stringify(r.json));
    const row = await rowFor(castHash1);
    if (row.attributedFid !== OWN_FID) throw new Error("public list did not update: " + JSON.stringify(row));
    if (row.attributedAt % 3_600_000 !== 0) throw new Error("attributedAt is finer than an hour");
    // §14.2 — the evidence is carried with the claim, and it is THIS persona's real signer key
    const probe = (await retry(() => persona("signerProbe", { personaId: OWN_WITH_FID }))).json;
    if (!/^[0-9a-f]{64}$/.test(probe?.derivedPubHex ?? "")) throw new Error("signerProbe gave no key: " + JSON.stringify(probe));
    if (row.attributedSigner !== probe.derivedPubHex) throw new Error("the row does not carry the fid's own signer key: " + JSON.stringify({ carried: row.attributedSigner, real: probe.derivedPubHex }));
  });

  await check("5. ONE REVEAL, EVER: the same persona revealing again is a harmless no-op; a DIFFERENT persona (one that did not post it) is refused before anything is sent", async () => {
    const again = await reveal(castHash1, OWN_WITH_FID);
    if (again.status !== 200 || again.json.alreadyAttributed !== true) throw new Error("same-persona re-reveal was not idempotent: " + JSON.stringify(again.json));
    // ALT is the seeded private persona — private personas never get a fid, so use the seed's own MAIN instead
    const mainAcq = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
    const other = await reveal(castHash1, MAIN);
    // PERSONA LAUNCH P6: refused before anything is signed or sent — MAIN did not post it (it owns a fid, so the refusal is
    // genuinely the posting-persona rule, not the no-fid one)
    if (!(other.status >= 400 && other.status < 500) || !/only the persona that posted it/.test(other.json?.error ?? "")) throw new Error("a different persona's reveal was not refused for the right reason: " + other.status + " " + JSON.stringify(other.json));
    if (!mainAcq?.fid) throw new Error("setup: MAIN owns no fid, so the refusal above proves nothing about the posting-persona rule");
    const row = await rowFor(castHash1);
    if (row.attributedFid !== OWN_FID) throw new Error("attribution changed: " + JSON.stringify(row));
    void mainAcq;
  });

  await check("6. NOTHING AUTOMATIC: a second, distinct anon post's row stays attributedFid: null throughout — revealing one post never touches another", async () => {
    await retry(() => zk("advanceEpoch")); // a fresh window — one anon post per root per window is a real rule, not this suite's to work around
    const second = await post(`anon never revealed ${stamp} [layers-test fixture]`);
    castHash2 = second.castHash;
    await sleep(50);
    const row = await rowFor(second.castHash);
    if (row.attributedFid !== null || row.attributedAt !== null) throw new Error("an untouched post got attributed: " + JSON.stringify(row));
  });

  await check("7. LEAKS: the raw secret and the attribution domain string appear nowhere in the validator's whole database — only the (public) commitment and the (public, post-reveal) fid ever land there", async () => {
    if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
    const commitment = envelope1.publicInputs.attributionCommitment;
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      for (const t of tables) {
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
          const s = JSON.stringify(row);
          if (s.includes("layers-anon-attribution")) throw new Error(`${t} row carries the attribution domain string`);
          if (t !== "zk_anon_casts" && s.includes(commitment)) throw new Error(`${t} row carries the commitment outside zk_anon_casts`);
        }
      }
      const anonRow = db.prepare("SELECT * FROM zk_anon_casts WHERE cast_hash = ?").get(castHash1);
      if (!("attribution_commitment" in anonRow) || !("attributed_fid" in anonRow) || !("attributed_at" in anonRow)) throw new Error("anon row missing the attribution columns: " + JSON.stringify(Object.keys(anonRow)));
    } finally {
      db.close();
    }
  });

  await check("8. THE CARD: once revealed, the timeline shows the handle; a fresh, un-revealed anon post offers 'Prove this is yours' only on THIS device, for THIS cast's hash, and only until revealed", async () => {
    await retry(() => zk("advanceEpoch")); // another fresh window
    const third = await post(`anon prove control ${stamp} [layers-test fixture]`);
    const profile = (await retry(() => api("GET", `/api/identity?personaId=${OWN_WITH_FID}`))).json?.identity;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const revealedCard = page.locator("[data-testid='cast']", { hasText: `anon reveal me ${stamp}` }).first();
      await revealedCard.waitFor({ timeout: 8000 });
      const badge = revealedCard.locator("[data-testid='cast-anon']").first();
      const badgeText = (await badge.textContent()) ?? "";
      // the badge names the persona's Farcaster fname when its record has one, else its handle (fname ?? handle, the
      // anon-apply merge) — read THIS persona's fname from its own fid record, so the expectation is exact
      const fidMap = (await retry(() => api("GET", "/api/fc/persona"))).json?.map ?? {};
      const expected = fidMap[OWN_WITH_FID]?.fname ?? profile?.handle;
      if (!expected) throw new Error("no fname or handle to expect for " + OWN_WITH_FID);
      if (!badgeText.includes("revealed as @" + expected + " ")) throw new Error("badge does not show the reveal as @" + expected + ": " + badgeText);
      const unrevealedCard = page.locator("[data-testid='cast']", { hasText: `anon prove control ${stamp}` }).first();
      await unrevealedCard.waitFor({ timeout: 8000 });
      const startBtn = unrevealedCard.locator("[data-testid='anon-reveal-start']").first();
      await startBtn.waitFor({ timeout: 8000 });
      if ((await revealedCard.locator("[data-testid='anon-reveal-start']").count()) !== 0) throw new Error("the already-revealed card still offers to reveal");
    } finally {
      await browser.close();
    }
    void third;
  });

  await check("9. §14.2 A CLAIM IS NOT A FACT: an unsigned reveal is refused outright; and an attribution the validator DOES carry, signed by a key that is not that fid's key, renders as plain anon — never as somebody's name", async () => {
    if (!castHash2) throw new Error("check 6 did not run — no second cast to work with");
    // (a) the endpoint no longer takes the fid on the caller's word
    const unsigned = await vpost("/zk/anon/reveal", { mode: "fixture", castHash: castHash2, secret: "cd".repeat(32), fid: OWN_FID });
    if (unsigned.status !== 400 || !/signer|signature/.test(unsigned.json?.error ?? "")) throw new Error("an unsigned reveal was not refused for the right reason: " + unsigned.status + " " + JSON.stringify(unsigned.json));
    // (b) the reader's own control. Rather than assume the validator is honest, take the validator's
    // storage away from it: write the row an attacker WANTS — this device's fid, attributed under a
    // key the attacker generated. The claim is now in the public list; the card must still say anon.
    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec("PRAGMA busy_timeout = 8000");
      db.prepare("UPDATE zk_anon_casts SET attributed_fid = ?, attributed_at = ?, attributed_signer = ? WHERE mode = 'fixture' AND cast_hash = ?")
        .run(OWN_FID, Math.floor(Date.now() / 3_600_000) * 3_600_000, RIG_PUB, castHash2);
    } finally {
      db.close();
    }
    const carried = await rowFor(castHash2);
    if (carried?.attributedFid !== OWN_FID || carried?.attributedSigner !== RIG_PUB) throw new Error("the forged claim did not land, so this check would prove nothing: " + JSON.stringify(carried));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + "/home", { waitUntil: "networkidle" });
      const card = page.locator("[data-testid='cast']", { hasText: `anon never revealed ${stamp}` }).first();
      await card.waitFor({ timeout: 8000 });
      const badge = card.locator("[data-testid='cast-anon']").first();
      const text = (await badge.textContent()) ?? "";
      if (/revealed as/.test(text)) throw new Error("an unverifiable claim was rendered as a reveal: " + text);
      if ((await badge.getAttribute("data-attributed")) != null) throw new Error("the card is marked attributed on an unverifiable claim");
      const body = await page.locator("body").innerText();
      if (body.includes(String(OWN_FID)) && /revealed/.test(body.split(String(OWN_FID))[0].slice(-80))) throw new Error("the fid was rendered as an attribution anyway");
    } finally {
      await browser.close();
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // ANON REVIEW closing checks (build B's two pins). Before the review, pressing Post flushed the reveal secret to the
  // validator at once, device-signed, under a namespace named in the URL (R1-01 / R3-07): an identified beacon that
  // tied every anon post to its root for the operator. And a proof the tick could not make simply vanished behind a
  // "Queued anonymously" toast (A2-2 / R3-02). Both are pinned here, on the rig, against the real validator DB.
  const stateRows = () => {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      try {
        db.exec("PRAGMA busy_timeout = 8000"); // the validator may be mid-write: wait, never read a locked DB as empty
      } catch {
        /* a connection setting; harmless if this build refuses it on a read-only handle */
      }
      const m = new Map();
      for (const r of db.prepare("SELECT anchor, namespace, key, value FROM adapter_state").all()) m.set(`${r.anchor}|${r.namespace}|${r.key}`, r.value);
      return m;
    } finally {
      db.close();
    }
  };
  const changedNamespaces = (before, after) => {
    const ns = new Set();
    for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) ns.add(k.split("|")[1]);
    for (const k of before.keys()) if (!after.has(k)) ns.add(k.split("|")[1]);
    return [...ns];
  };
  const persistPending = async () => (await retry(() => zk("queueStatus"))).json?.persistPending === true;
  let castHash10 = null;

  await check("10. NO DEVICE-SIGNED WRITE AT COMPOSE TIME: within the second POST /api/anon answers 202, no adapter_state row on the validator changes — none under the retired anonAttribution namespace, none at all (the secret rides the sealed zkQueue record on the queue's own deferred write)", async () => {
    if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
    // This post also serves check 11, which needs a proof the tick REFUSES: the device's commitment is revoked here
    // (the validator drops the leaf from the next epoch), the epoch advanced and the snapshot refreshed BEFORE the post.
    // The compose path never checks membership, so the 202 is unaffected — and a loop tick that lands between the two
    // checks refuses the proof rather than queueing it, so the order of ticks cannot turn check 11 into a pass-by-luck.
    const rv = (await retry(() => zk("revoke"))).json;
    if (rv?.ok !== true) throw new Error("setup: revoke: " + JSON.stringify(rv).slice(0, 200));
    await retry(() => zk("advanceEpoch"));
    await retry(() => zk("prefetchNow"));
    await sleep(300);
    // A queue persist that an EARLIER check's proof scheduled (30 s to 15 min after it was queued) is not a compose-time
    // write: give it up to 20 s to land first, and remember whether one was still pending when the post went in.
    let pendingBefore = await persistPending();
    for (let i = 0; i < 40 && pendingBefore; i++) {
      await sleep(500);
      pendingBefore = await persistPending();
    }
    const before = stateRows();
    for (const k of before.keys()) if (k.split("|")[1] === "anonAttribution") throw new Error("the retired anonAttribution namespace still holds rows on the validator before the post");
    const t0 = Date.now();
    const r = await api("POST", "/api/anon", { text: `anon no beacon ${stamp} [layers-test fixture]` });
    const after = stateRows();
    const t1 = Date.now();
    if (r.status !== 202) throw new Error("queue: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
    castHash10 = r.json.castHash;
    const changed = changedNamespaces(before, after);
    if (changed.includes("anonAttribution")) throw new Error("a device-signed PUT /state/anonAttribution landed at compose time — the reveal secret is a beacon again");
    if (changed.length) {
      // a persist timer that was pending before the post and fired inside the window explains a zkQueue-only change;
      // anything else is a write the compose path made
      const pendingAfter = await persistPending();
      if (pendingBefore && !pendingAfter && changed.every((ns) => ns === "zkQueue")) console.log("        (note: a queue persist scheduled by an earlier check fired inside the window — not a compose-time write)");
      else throw new Error(`device-signed state changed within ${t1 - t0} ms of the compose: namespace(s) ${changed.join(", ")}`);
    }
    if (t1 - t0 > 1000) console.log(`        (note: the compose took ${t1 - t0} ms, so the window measured here is longer than one second)`);
  });

  await check("11. A REFUSED PROOF IS NEVER SILENT: the tick cannot prove the post (the commitment is revoked from this epoch); GET /api/anon?castHash= says 'wanted' (or 'dropped') with the outcome's lastStage and reason — never 'unknown'; nothing relayed, the post still listed as wanted with its attempt counted", async () => {
    if (!castHash10) throw new Error("check 10 queued no post");
    const tick = (await retry(() => zk("prefetchNow"))).json?.tick;
    const st = (await retry(() => api("GET", `/api/anon?castHash=${castHash10}`))).json;
    if (!["wanted", "dropped"].includes(st?.status)) throw new Error("status " + JSON.stringify(st?.status) + " (item " + JSON.stringify(st?.item) + "; tick " + JSON.stringify(tick).slice(0, 200) + ")");
    const o = st.outcome;
    if (!o || !["retrying", "dropped"].includes(o.stage)) throw new Error("no refusal in the outcome log (stage " + JSON.stringify(o?.stage) + "): " + JSON.stringify(o).slice(0, 300));
    if (typeof o.lastStage !== "string" || !o.lastStage || o.lastStage === "wanted") throw new Error("outcome.lastStage names no refusing stage: " + JSON.stringify(o).slice(0, 300));
    if (typeof o.reason !== "string" || !o.reason) throw new Error("outcome.reason is empty: " + JSON.stringify(o).slice(0, 300));
    if (st.item) throw new Error("a refused proof still got a queue item: " + JSON.stringify(st.item));
    console.log(`        (refused at stage ${o.lastStage}: ${o.reason})`);
    if ((await anonCasts()).some((c) => c.castHash === castHash10)) throw new Error("a refused proof relayed a cast");
    if (st.status === "wanted") {
      const g = (await retry(() => api("GET", "/api/anon"))).json;
      if (!(g.wanted ?? []).some((w) => w.castHash === castHash10 && w.attempts >= 1)) throw new Error("the wanted list does not carry the post with its attempt: " + JSON.stringify(g.wanted));
    }
  });
} finally {
  await retry(() => zk("setRepImpl", { impl: null })).catch(() => {});
}

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Anon-reveal (anoncast pattern) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
