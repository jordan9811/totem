// BROWSER KEYSTORE PASS Gate 2 — ephemeral onboarding + passkey + social login, end to end in real browsers.
//
// Runs against the app on localhost (WebAuthn refuses an IP as a relying-party id) and the validator, through the
// page's own fetch, with Chromium's virtual authenticator over CDP standing in for Touch ID / a synced passkey.
//   1. EPHEMERAL: a fresh context mints a root; a second context mints another; closing the tab loses it and the
//      next visit mints fresh; nothing the unsaved visitor typed reaches the validator
//   2. PASSKEY (PRF): save → record + blob on the validator (ciphertext); forget the device → a fresh root; unlock
//      with the same passkey → the SAME root, commitment, personas and private post
//   3. THE SAME SYNCED PASSKEY ON A NEW DEVICE: the credential moved to a second context's authenticator unlocks
//      the same root there, vault included
//   4. PASSKEY (WRAP): an authenticator without PRF takes the wrap path — record on the validator, blob NOT on the
//      validator (device-bound); a reload of the same device unlocks; a new device with the same credential is
//      refused as device-bound
//   5. SOCIAL LOGIN (fixture provider): save → forget → unlock → the same root; a login nobody saved under is
//      reported EMPTY, not created
//   6. ATTACH: a passkey-saved root gains a social method → two records, ONE anchor; unlock via social on a new
//      device → the same root and commitment the passkey gives
//   7. THE 24 WORDS: export → forget → import → the same root, personas and private post
//   8. LEAKS: every seed, KEK, PRF output and provider export the devices used is absent from the validator's
//      database, its log and the app's log
//   9. THE PAGE: /device renders the strip as unsaved with both paths as equals; a save through the UI flips it
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);
const needles = new Set();
const consoleLines = []; // every console line the devices under test printed — a haystack for check 8 (attack-custody-2 #24)

function db() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const methods = d.prepare("SELECT method_id, kind, anchor, pubkey_spki, alg FROM custody_methods").all();
    const blobs = d.prepare("SELECT method_id, anchor, blob FROM custody_blobs").all();
    const everything = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) everything.push({ t, s: JSON.stringify(row) });
    }
    return { methods, blobs, everything };
  } finally { d.close(); }
}

console.log("\nGate 2 — ephemeral onboarding + passkey + social login (app " + BASE + ", validator " + VBASE + ")");
const browser = await chromium.launch();

/** a browser context with its own virtual authenticator = one device */
async function device(label, { hasPrf = true, credentials = [] } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 160)));
  page.on("console", (m) => consoleLines.push("[" + label + "] " + m.text()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf, automaticPresenceSimulation: true },
  });
  for (const c of credentials) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: c });
  const d = { label, ctx, page, cdp, authenticatorId, info: null };
  d.load = async () => {
    await page.goto(BASE + "/device/smoke.html?validator=" + encodeURIComponent(VBASE), { waitUntil: "load" });
    d.info = await page.evaluate(() => window.__layersDevice.ready);
    return d.info;
  };
  d.api = (method, p, body) => page.evaluate(async ({ method, p, body }) => {
    const r = await fetch(p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  }, { method, p, body });
  d.custody = (fn, ...args) => page.evaluate(async ({ fn, args }) => {
    try { return { ok: true, value: await window.__layersDevice.custody[fn](...args) }; } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }, { fn, args });
  d.must = async (fn, ...args) => {
    const r = await d.custody(fn, ...args);
    if (!r.ok) throw new Error(fn + ": " + r.error);
    // an unlock answers { info }, an import answers the info itself: either way the device's identity moved
    if (r.value && r.value.info) d.info = r.value.info;
    else if (r.value && r.value.rootId && r.value.personaIds) d.info = r.value;
    return r.value;
  };
  d.harvest = async () => { for (const n of await page.evaluate(async () => [...(await window.__layersDevice.needles()), ...window.__layersDevice.custody.secrets()])) needles.add(n); };
  d.commitment = async () => { const r = await d.api("GET", "/api/zk?mode=fixture"); const m = JSON.stringify(r.json).match(/"commitment":"([0-9a-fx]+)"/); return m ? m[1] : null; };
  d.asPrivate = async () => { const r = await d.api("POST", "/api/seed-persona", { personaId: d.info.personaIds[1] }); if (r.status !== 200) throw new Error("persona switch " + r.status); };
  d.forget = async () => { await d.harvest(); await page.evaluate(() => window.__layersDevice.wipe()); return d.load(); };
  d.credentials = async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
  d.close = async () => { await d.harvest().catch(() => {}); await ctx.close(); };
  return d;
}

// ---------------------------------------------------------------- 1. ephemeral
let A = null;
await check("1. EPHEMERAL: fresh contexts mint fresh roots; closing the tab loses the identity; the unsaved visitor's handle reaches no table", async () => {
  A = await device("A");
  const r1 = await A.load();
  const B = await device("B");
  const r2 = await B.load();
  if (r1.rootId === r2.rootId || r1.anchor === r2.anchor) throw new Error("two fresh contexts share a root");
  const per = (await B.api("GET", "/api/personas")).json;
  const handle = per.personas[0].handle;
  await B.close();
  const B2 = await device("B2");
  const r3 = await B2.load();
  if (r3.rootId === r2.rootId) throw new Error("a closed tab's identity came back in a new context");
  if (r3.restored) throw new Error("a fresh context claims to have restored");
  for (const row of db().everything) if (row.s.includes(handle)) throw new Error("the unsaved visitor's handle is in " + row.t);
  await B2.close();
});

// ---------------------------------------------------------------- 2. passkey PRF
let R1 = null, C1 = null, personasA = null, aCreds = null;
const privA = "gate2 private " + stamp + " by A";
await check("2. PASSKEY (PRF): save, forget the device, unlock with the same passkey → the same root, commitment, personas and private post", async () => {
  R1 = A.info.rootId;
  C1 = await A.commitment();
  personasA = A.info.personaIds.slice();
  await A.asPrivate();
  const w = await A.api("POST", "/api/private/posts", { text: privA });
  if (![200, 201].includes(w.status)) throw new Error("private post " + w.status);
  const s = await A.must("savePasskey");
  if (s.kind !== "passkey-prf" || s.path !== "prf" || s.attached) throw new Error("save: " + JSON.stringify(s));
  const rec = db().methods.find((m) => m.method_id === s.methodId);
  if (!rec || rec.kind !== "passkey-prf" || rec.anchor !== A.info.anchor) throw new Error("no PRF record under A's anchor: " + JSON.stringify(rec));
  if (!rec.pubkey_spki || (rec.alg !== -8 && rec.alg !== -7)) throw new Error("the record carries no verifiable public key");
  const blob = db().blobs.find((b) => b.method_id === s.methodId);
  if (!blob) throw new Error("no blob on the validator for a PRF passkey");
  const parsed = JSON.parse(blob.blob);
  if (parsed.v !== 1 || parsed.method !== s.methodId || !/^[0-9a-f]{80,}$/.test(parsed.ct)) throw new Error("blob is not the wrapped-seed shape");
  aCreds = await A.credentials();
  if (aCreds.length !== 1) throw new Error("expected one credential in the authenticator, got " + aCreds.length);
  const fresh = await A.forget();
  if (fresh.rootId === R1) throw new Error("forgetting the device did not mint a fresh root");
  const u = await A.must("unlockPasskey");
  if (u.empty) throw new Error("unlock found no identity under the passkey");
  if (u.info.rootId !== R1) throw new Error("unlock resolved to a different root");
  if ((await A.commitment()) !== C1) throw new Error("the commitment changed across the unlock");
  if (JSON.stringify(u.info.personaIds) !== JSON.stringify(personasA)) throw new Error("personas differ after unlock: " + JSON.stringify(u.info.personaIds));
  await A.asPrivate();
  const r = await A.api("GET", "/api/private/posts");
  if (!JSON.stringify(r.json).includes(privA)) throw new Error("the private post did not come back after unlock (" + r.status + ")");
});

// ---------------------------------------------------------------- 3. the credential on a new device
// The fixture cannot carry a credential's PRF material between contexts (CDP exports credentialId, privateKey,
// userHandle and counters — no hmac-secret key: A-CU-2-SYNCED-PASSKEY-PRF-NOT-SIMULABLE). A real synced passkey
// carries it. What CAN be asserted: the moved credential resolves the SAME method record on the validator, and a
// device whose authenticator evaluates no PRF fails CLOSED — it never yields a wrong root. Check 2 already proved the
// blob is fetched from the validator (the wipe removed the local copy); check 6 proves cross-device unlock end to end.
let C = null;
await check("3. THE CREDENTIAL ON A NEW DEVICE: resolves the same record; with no PRF material to evaluate it fails closed, never a wrong root", async () => {
  C = await device("C", { hasPrf: true, credentials: aCreds });
  const r = await C.load();
  if (r.rootId === R1) throw new Error("a new device already had the root before unlocking");
  const b64url = (s) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // CDP exports standard base64; method ids are base64url
  const rec = db().methods.find((m) => m.method_id === "pk:" + b64url(aCreds[0].credentialId));
  if (!rec || rec.anchor !== A.info.anchor) throw new Error("the moved credential does not resolve to A's record");
  const u = await C.custody("unlockPasskey");
  if (u.ok) {
    if (u.value.empty || u.value.info.rootId !== R1) throw new Error("the moved credential unlocked a DIFFERENT root");
    console.log("        (this authenticator could evaluate PRF for the moved credential: unlocked the same root)");
    C.info = u.value.info;
  } else {
    if (!/saved with PRF/.test(u.error)) throw new Error("wrong refusal: " + u.error);
    if (C.info.rootId === R1) throw new Error("a refused unlock changed the root");
  }
});

// ---------------------------------------------------------------- 4. passkey wrap path
await check("4. PASSKEY (WRAP): no PRF → record on the validator, blob only on the device; a reload unlocks; a new device is refused as device-bound", async () => {
  const D = await device("D", { hasPrf: false });
  const r0 = await D.load();
  const s = await D.must("savePasskey");
  if (s.kind !== "passkey-wrap" || s.path !== "wrap") throw new Error("expected the wrap path: " + JSON.stringify(s));
  const rec = db().methods.find((m) => m.method_id === s.methodId);
  if (!rec || rec.kind !== "passkey-wrap") throw new Error("no wrap record: " + JSON.stringify(rec));
  if (db().blobs.find((b) => b.method_id === s.methodId)) throw new Error("a wrap-path blob reached the validator (it must stay on the device)");
  await D.harvest();
  await D.page.reload({ waitUntil: "load" });
  const r1 = await D.page.evaluate(() => window.__layersDevice.ready);
  D.info = r1;
  if (!r1.restored || r1.rootId !== r0.rootId) throw new Error("the wrap-path save did not persist the identity locally: " + JSON.stringify(r1).slice(0, 120));
  // a memory-fresh unlock on the same device: the local blob + the server's release after a verified assertion
  const u = await D.must("unlockPasskey");
  if (u.empty || u.info.rootId !== r0.rootId) throw new Error("wrap-path unlock on the same device failed: " + JSON.stringify(u).slice(0, 160));
  const creds = await D.credentials();
  const E = await device("E", { hasPrf: false, credentials: creds });
  await E.load();
  const ue = await E.custody("unlockPasskey");
  if (ue.ok) throw new Error("a wrap-path passkey unlocked on a device that never held the blob");
  if (!/device-bound/i.test(ue.error)) throw new Error("the refusal does not say device-bound: " + ue.error);
  await E.close();
  await D.close();
});

// ---------------------------------------------------------------- 5. social login (fixture)
await check("5. SOCIAL LOGIN (fixture): save, forget, unlock → the same root; a login nobody saved under is EMPTY, not created", async () => {
  const F = await device("F");
  const r0 = await F.load();
  const s = await F.must("saveProvider", "farcaster", "alice-" + stamp);
  if (s.kind !== "provider" || s.attached) throw new Error("save: " + JSON.stringify(s));
  const rec = db().methods.find((m) => m.method_id === s.methodId);
  if (!rec || rec.kind !== "provider" || rec.anchor !== r0.anchor) throw new Error("no provider record under F's anchor");
  const fresh = await F.forget();
  if (fresh.rootId === r0.rootId) throw new Error("forget did not mint fresh");
  const nobody = await F.must("unlockProvider", "farcaster", "bob-" + stamp);
  if (!nobody.empty) throw new Error("a login nobody saved under produced an identity");
  if (F.info.rootId !== fresh.rootId) throw new Error("an empty login changed the device's root");
  if (db().methods.find((m) => m.method_id === nobody.methodId)) throw new Error("an empty login CREATED a method record");
  const u = await F.must("unlockProvider", "farcaster", "alice-" + stamp);
  if (u.empty || u.info.rootId !== r0.rootId) throw new Error("social unlock resolved to a different root");
  await F.close();
});

// ---------------------------------------------------------------- 6. attach a second method
await check("6. ATTACH: passkey root + social method → two records, one anchor; social unlock on a new device gives the passkey's root and commitment", async () => {
  const s = await A.must("saveProvider", "google", "carol-" + stamp);
  if (!s.attached) throw new Error("attaching to a saved identity reported a first save");
  const mine = db().methods.filter((m) => m.anchor === A.info.anchor);
  if (mine.length !== 2 || new Set(mine.map((m) => m.kind)).size !== 2) throw new Error("expected passkey-prf + provider under one anchor, got " + JSON.stringify(mine.map((m) => m.kind)));
  const roots = new Set(mine.map((m) => m.anchor));
  if (roots.size !== 1) throw new Error("two anchors for one person");
  const G = await device("G");
  await G.load();
  const u = await G.must("unlockProvider", "google", "carol-" + stamp);
  if (u.empty || u.info.rootId !== R1) throw new Error("social unlock of the attached method gave a different root");
  if ((await G.commitment()) !== C1) throw new Error("commitment via social differs from via passkey");
  await G.close();
});

// ---------------------------------------------------------------- 7. the 24 words
await check("7. THE 24 WORDS: export → forget → import → the same root, personas and private post", async () => {
  const H = await device("H");
  const r0 = await H.load();
  const words = await H.must("exportPhrase");
  if (words.trim().split(/\s+/).length !== 24) throw new Error("not 24 words");
  await H.asPrivate();
  const text = "gate2 phrase " + stamp;
  const w = await H.api("POST", "/api/private/posts", { text });
  if (![200, 201].includes(w.status)) throw new Error("private post " + w.status);
  const personas = r0.personaIds.slice();
  const fresh = await H.forget();
  if (fresh.rootId === r0.rootId) throw new Error("forget did not mint fresh");
  const info = await H.must("importPhrase", words);
  if (info.rootId !== r0.rootId || info.anchor !== r0.anchor) throw new Error("import resolved to a different root");
  if (JSON.stringify(info.personaIds) !== JSON.stringify(personas)) throw new Error("personas differ after import");
  await H.asPrivate();
  const p = await H.api("GET", "/api/private/posts");
  if (!JSON.stringify(p.json).includes(text)) throw new Error("the private post did not come back after import");
  await H.close();
});

// ---------------------------------------------------------------- 8. leaks
await check("8. LEAKS: no seed, KEK, PRF output or provider export from any device is on the server side", async () => {
  for (const d of [A, C]) await d.harvest();
  const all = [...needles].filter((n) => typeof n === "string" && n.length >= 32);
  if (all.length < 12) throw new Error("only " + all.length + " needles — the grep would be weak");
  const hay = [["validator.db", db().everything.map((r) => r.s).join("\n")], ["browser console (" + consoleLines.length + " lines)", consoleLines.join("\n")]];
  for (const f of [process.env.TEMP + "/layers-validator.log", process.env.TEMP + "/layers-app.log"]) if (f && existsSync(f)) hay.push([f, readFileSync(f, "latin1")]);
  for (const n of all) for (const [name, h] of hay) if (h.includes(n)) throw new Error("a " + n.length + "-char needle appears in " + name);
  console.log("        " + all.length + " needles absent from " + hay.length + " haystacks");
});

// ---------------------------------------------------------------- 9. the page
await check("9. THE PAGE: /device renders the strip as unsaved with both paths; a save through the UI flips it to saved", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [page pageerror] " + String(e).slice(0, 160)));
  await page.goto(BASE + "/device", { waitUntil: "load" });
  await page.getByTestId("identity-strip").waitFor({ timeout: 30000 });
  const strip = await page.getByTestId("identity-strip").innerText();
  if (!/Unsaved/.test(strip)) throw new Error("strip is not unsaved: " + strip.slice(0, 80));
  if (!(await page.getByTestId("save-passkey").isVisible()) || !(await page.getByTestId("save-social").isVisible())) throw new Error("both save paths are not shown");
  await page.getByPlaceholder("account (fixture)").fill("ui-" + stamp); // the fixture's subject IS the account
  await page.getByRole("button", { name: /Save with Farcaster/ }).click();
  await page.getByText(/Saved — 1 way/).waitFor({ timeout: 30000 });
  await ctx.close();
});

await A.close();
await C.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 2 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
