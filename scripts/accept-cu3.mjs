// BROWSER KEYSTORE PASS Gate 3 — the empty-account fork, device linking, root linking. Real browsers on localhost.
//   1. THE FORK renders on an empty login on two contexts with different user agents — the same fork, from one signal
//   2. DEVICE LINK (new-device entry point): offer → approve → accept; the new device holds the same root, reads the
//      vault, acts as a persona; the validator lists it under the root's anchor
//   3. PAYLOAD GREP: the opened link material carries the vault key and a delegation and NOT the seed nor the
//      device-auth key; the relay row is ciphertext; nothing of either reaches any validator table
//   4. A LINKED DEVICE HOLDS NO ROOT: it cannot export the 24 words or mint a persona, and says which device can
//   5. THE OLD-DEVICE ENTRY POINT through the page: one device shows a code, the other enters it, the first flips
//   6. REVOCATION still reaches a linked device: revoked by the root, its next signed write is refused
//   7. ROOT LINK: two roots on two devices co-sign a grant through the relay; each presents the other's personas;
//      reputation stays per root; unlink is symmetric
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://127.0.0.1:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);

function db() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const offers = d.prepare("SELECT code, device_id, sealed, anchor FROM link_offers").all();
    const devices = d.prepare("SELECT device_id, anchor, revoked_at FROM devices").all();
    const everything = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) everything.push({ t, s: JSON.stringify(row) });
    }
    return { offers, devices, everything };
  } finally { d.close(); }
}

console.log("\nGate 3 — the fork, device linking, root linking (app " + BASE + ", validator " + VBASE + ")");
const browser = await chromium.launch();

async function device(label, { userAgent } = {}) {
  const ctx = await browser.newContext(userAgent ? { userAgent } : {});
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   [" + label + " pageerror] " + String(e).slice(0, 160)));
  const d = { label, ctx, page, info: null };
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
  d.call = (ns, fn, ...args) => page.evaluate(async ({ ns, fn, args }) => {
    try { return { ok: true, value: await window.__layersDevice[ns][fn](...args) }; } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  }, { ns, fn, args });
  d.must = async (ns, fn, ...args) => {
    const r = await d.call(ns, fn, ...args);
    if (!r.ok) throw new Error(ns + "." + fn + ": " + r.error);
    if (r.value && r.value.rootId && r.value.personaIds) d.info = r.value;
    else if (r.value && r.value.info) d.info = r.value.info;
    return r.value;
  };
  d.asPrivate = async () => { const r = await d.api("POST", "/api/seed-persona", { personaId: d.info.personaIds[1] }); if (r.status !== 200) throw new Error("persona switch " + r.status); };
  d.needles = () => page.evaluate(() => window.__layersDevice.needles());
  d.rootOnly = () => page.evaluate(() => window.__layersDevice.rootOnly());
  d.close = () => ctx.close();
  return d;
}

// ---------------------------------------------------------------- 1. the fork, two user agents
await check("1. THE FORK renders on an empty login for two different user agents — one signal, no heuristics", async () => {
  const uas = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ];
  for (const ua of uas) {
    const ctx = await browser.newContext({ userAgent: ua });
    const page = await ctx.newPage();
    await page.goto(BASE + "/device", { waitUntil: "load" });
    await page.getByTestId("identity-strip").waitFor({ timeout: 30000 });
    await page.getByPlaceholder("account (fixture)").fill("nobody-" + stamp);
    await page.getByRole("button", { name: /Unlock with social login/ }).click();
    await page.getByTestId("fork").waitFor({ timeout: 30000 });
    const text = await page.getByTestId("fork").innerText();
    if (!/New here, or already have an account/.test(text)) throw new Error("fork text: " + text.slice(0, 80));
    let enabled = false;
    for (let i = 0; i < 40 && !enabled; i++) { enabled = await page.getByTestId("fork-link").isEnabled(); if (!enabled) await new Promise((r) => setTimeout(r, 250)); }
    if (!enabled) throw new Error("the link entry on the fork never became enabled");
    await ctx.close();
  }
});

// ---------------------------------------------------------------- 2. device link, new-device entry point
let O = null, N = null, linkedDeviceId = null;
const privO = "gate3 private " + stamp + " by O";
await check("2. DEVICE LINK: the new device offers, the root's device approves, the new device holds the same root, vault and personas", async () => {
  O = await device("O");
  await O.load();
  await O.asPrivate();
  const w = await O.api("POST", "/api/private/posts", { text: privO });
  if (![200, 201].includes(w.status)) throw new Error("private post " + w.status);
  await O.page.evaluate(() => window.__layersDevice.persist());
  N = await device("N");
  const before = await N.load();
  if (before.rootId === O.info.rootId) throw new Error("the new device already had the root");
  const offer = await N.must("linking", "offer");
  if (!/^[A-Z2-9]{10}$/.test(offer.code)) throw new Error("bad code: " + offer.code);
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(offer.fingerprint ?? "")) throw new Error("the offer carries no fingerprint: " + offer.fingerprint);
  const acceptP = N.call("linking", "accept", { timeoutMs: 60000 });
  await new Promise((r) => setTimeout(r, 300));
  // D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES: a fingerprint that does not match the offer is refused before anything is sealed
  const wrong = await O.call("linking", "approve", offer.code, "0000-0000");
  if (wrong.ok || !/fingerprint/.test(wrong.error)) throw new Error("approve with the wrong fingerprint was not refused: " + JSON.stringify(wrong).slice(0, 120));
  const ap = await O.must("linking", "approve", offer.code, offer.fingerprint);
  if (!/^dev_/.test(ap.deviceId ?? "")) throw new Error("approve returned no device id");
  linkedDeviceId = ap.deviceId;
  const acc = await acceptP;
  if (!acc.ok) throw new Error("accept: " + acc.error);
  N.info = acc.value;
  if (N.info.rootId !== O.info.rootId || N.info.anchor !== O.info.anchor) throw new Error("the linked device holds a different root");
  if (JSON.stringify(N.info.personaIds) !== JSON.stringify(O.info.personaIds)) throw new Error("personas differ on the linked device");
  await N.asPrivate();
  const p = await N.api("GET", "/api/private/posts");
  if (!JSON.stringify(p.json).includes(privO)) throw new Error("the linked device cannot read the vault (" + p.status + ")");
  const pub = await N.api("POST", "/api/seed-persona", { personaId: N.info.personaIds[0] });
  if (pub.status !== 200) throw new Error("switch to public persona " + pub.status);
  const cast = await N.api("POST", "/api/actions/cast", { text: "gate3 cast from the linked device " + stamp });
  if (![200, 201].includes(cast.status)) throw new Error("the linked device cannot act as a persona: " + cast.status + " " + JSON.stringify(cast.json).slice(0, 120));
  const row = db().devices.find((x) => x.anchor === O.info.anchor && x.device_id !== undefined && x.revoked_at === null);
  if (!row) throw new Error("no device row under the root's anchor");
});

// ---------------------------------------------------------------- 3. the payload grep
await check("3. PAYLOAD GREP: the material carries the vault key and a delegation, never the seed or the device-auth key; the relay holds ciphertext", async () => {
  const payload = await N.page.evaluate(() => window.__layersDevice.linking.lastPayload());
  if (!payload) throw new Error("no payload recorded on the new device");
  if (!payload.includes("vaultKeyHex") || !payload.includes("delegation") || !payload.includes("personaKeys")) throw new Error("the payload lacks the material a device needs");
  const rootOnly = await O.rootOnly();
  if (rootOnly.length < 2) throw new Error("the root device reported " + rootOnly.length + " root-only secrets");
  for (const n of rootOnly) if (payload.includes(n)) throw new Error("a root-only secret (" + n.length + " chars) crossed the linking channel");
  const state = db();
  const offer = state.offers.find((o) => o.anchor === O.info.anchor);
  if (offer) {
    const sealed = JSON.parse(offer.sealed);
    if (!/^[0-9a-f]+$/.test(sealed.ct) || sealed.ct.length < 200) throw new Error("the relay row is not ciphertext");
  }
  const all = [...rootOnly, ...(await O.needles())].filter((n) => typeof n === "string" && n.length >= 32);
  for (const row of state.everything) for (const n of all) if (row.s.includes(n)) throw new Error(row.t + " carries key material");
});

// ---------------------------------------------------------------- 4. a linked device holds no root
await check("4. A LINKED DEVICE HOLDS NO ROOT: it cannot export the 24 words or mint a persona, and says which device can", async () => {
  const ex = await N.call("custody", "exportPhrase");
  if (ex.ok) throw new Error("a linked device exported a phrase");
  if (!/LINKED root/.test(ex.error)) throw new Error("the refusal does not say why: " + ex.error);
  const fork = await N.api("POST", "/api/identity/fork", { fromPersona: N.info.personaIds[0], carry: [], newHandle: "linked_" + stamp, newName: "should fail" });
  if (fork.status < 400) throw new Error("a linked device minted a persona (" + fork.status + ")");
  const rootOnlyN = await N.rootOnly();
  if (rootOnlyN.length !== 0) throw new Error("a linked device reports root-only secrets");
});

// ---------------------------------------------------------------- 5. the old-device entry point through the page
// PERSONA LAUNCH P1 (SIWF): /device is passkey first now, and the device-link controls sit under the COLLAPSED Advanced
// section (with the 24 words). Opening it is an added step only: every control and assertion below is unchanged.
async function openAdvanced(p) {
  const open = await p.getByTestId("advanced").evaluate((el) => el.open).catch(() => null);
  if (open === null) throw new Error("/device has no Advanced section (data-testid=advanced)");
  if (!open) await p.getByTestId("advanced-toggle").click();
}
await check("5. THE OLD-DEVICE ENTRY POINT through the page: one device shows a code, a saved device enters it, the first flips to the same root", async () => {
  const ctxNew = await browser.newContext();
  const pNew = await ctxNew.newPage();
  await pNew.goto(BASE + "/device", { waitUntil: "load" });
  await pNew.getByTestId("identity-strip").waitFor({ timeout: 30000 });
  const stripBefore = await pNew.getByTestId("identity-strip").innerText();
  await openAdvanced(pNew);
  await pNew.getByRole("button", { name: /Show a link code/ }).click();
  await pNew.getByTestId("link-code").waitFor({ timeout: 30000 });
  const code = (await pNew.getByTestId("link-code").innerText()).trim();
  const fp = (await pNew.getByTestId("link-fingerprint").innerText()).trim();
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(fp)) throw new Error("the page shows no fingerprint beside the code: " + fp);
  const ctxOld = await browser.newContext();
  const pOld = await ctxOld.newPage();
  await pOld.goto(BASE + "/device", { waitUntil: "load" });
  await pOld.getByTestId("identity-strip").waitFor({ timeout: 30000 });
  await pOld.getByPlaceholder("account (fixture)").fill("old-" + stamp);
  await pOld.getByRole("button", { name: /Save with Farcaster/ }).click();
  await pOld.getByText(/Saved — 1 way/).waitFor({ timeout: 30000 });
  const oldRoot = (await pOld.getByTestId("identity-strip").innerText()).match(/root (root_[0-9a-f]+)/)?.[1];
  await openAdvanced(pOld);
  await pOld.getByPlaceholder("code", { exact: true }).fill(code);
  await pOld.getByPlaceholder("fingerprint", { exact: true }).fill(fp);
  await pOld.getByRole("button", { name: /^Approve$/ }).click();
  await pOld.getByText(/Device dev_\w+ linked/).waitFor({ timeout: 30000 });
  await pNew.getByText(/Linked\. This device now holds your identity/).waitFor({ timeout: 60000 });
  const stripAfter = await pNew.getByTestId("identity-strip").innerText();
  if (!oldRoot || !stripAfter.includes(oldRoot)) throw new Error("the new device's strip does not show the old root: " + stripAfter.slice(0, 120));
  if (stripBefore.includes(oldRoot)) throw new Error("the new device had the root before linking");
  await ctxNew.close();
  await ctxOld.close();
});

// ---------------------------------------------------------------- 6. revocation reaches a linked device
await check("6. REVOCATION: revoked by the root's device, the linked device's next signed write is refused", async () => {
  if (!linkedDeviceId) throw new Error("no linked device id from the approval");
  const row = db().devices.find((x) => x.device_id === linkedDeviceId);
  if (!row || row.anchor !== O.info.anchor || row.revoked_at !== null) throw new Error("the linked device is not a live row under the root: " + JSON.stringify(row));
  const rv = await O.api("POST", "/api/device", { action: "revoke", deviceId: linkedDeviceId });
  if (rv.status !== 200) throw new Error("revoke " + rv.status + " " + JSON.stringify(rv.json).slice(0, 120));
  await N.asPrivate();
  const w = await N.api("POST", "/api/private/posts", { text: "after revocation " + stamp });
  if (w.status < 400) throw new Error("the revoked linked device still wrote (" + w.status + ")");
});

// ---------------------------------------------------------------- 7. root linking: the missed-fork scenario
await check("7. ROOT LINK (the missed fork): passkey on one device, social on another, two roots; link → each presents the other's personas, reputation per root; unlink is symmetric", async () => {
  const A = await device("A-root");
  await A.load();
  await A.must("custody", "saveProvider", "email", "missed-fork-a-" + stamp); // a saved root on device A
  const B = await device("B-root");
  await B.load();
  await B.must("custody", "saveProvider", "google", "missed-fork-b-" + stamp); // a SECOND root on device B — the missed fork
  if (A.info.rootId === B.info.rootId) throw new Error("the two devices share a root");
  const ownB = (await B.api("GET", "/api/personas")).json.personas.map((p) => p.handle);
  const ownA = (await A.api("GET", "/api/personas")).json.personas.map((p) => p.handle);
  const { code } = await A.must("rootlink", "propose");
  if ((await A.must("rootlink", "proposalFingerprint")) !== null) throw new Error("a fingerprint exists before the other root answered");
  const { fingerprint } = await B.must("rootlink", "answer", code);
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(fingerprint ?? "")) throw new Error("answer returned no fingerprint: " + fingerprint);
  // mid-exchange the relay row holds anchors, root ids, ephemeral keys, ciphertext and signatures — never a persona
  // handle (attack-custody-3 #1: the v1 relay carried the answering roster in the clear)
  for (const row of db().everything) if (row.t === "root_link_offers" && (row.s.includes(ownA[0]) || row.s.includes(ownB[0]))) throw new Error("a persona handle is on the relay in the clear");
  if ((await A.must("rootlink", "proposalFingerprint")) !== fingerprint) throw new Error("the two devices derive different fingerprints");
  // D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES: the proposer completes only with the fingerprint the other device shows
  const wrong = await A.call("rootlink", "complete", code, "0000-0000", { timeoutMs: 60000 });
  if (wrong.ok || !/fingerprint/.test(wrong.error)) throw new Error("complete with the wrong fingerprint was not refused: " + JSON.stringify(wrong).slice(0, 120));
  const finishP = B.call("rootlink", "finish", { timeoutMs: 60000 });
  const viewA = await A.must("rootlink", "complete", code, fingerprint, { timeoutMs: 60000 });
  const fin = await finishP;
  if (!fin.ok) throw new Error("finish: " + fin.error);
  const viewB = fin.value;
  if (viewA.rootId !== B.info.rootId || viewB.rootId !== A.info.rootId) throw new Error("the grants name the wrong roots");
  if (viewA.grantId !== viewB.grantId) throw new Error("the two sides hold different grants");
  const la = await A.must("rootlink", "linked");
  const lb = await B.must("rootlink", "linked");
  if (la.length !== 1 || lb.length !== 1) throw new Error("linked lists: " + la.length + "/" + lb.length);
  const handlesA = la[0].personas.map((p) => p.handle), handlesB = lb[0].personas.map((p) => p.handle);
  if (JSON.stringify(handlesA) !== JSON.stringify(ownB) || JSON.stringify(handlesB) !== JSON.stringify(ownA)) throw new Error("each side does not present the other's personas");
  // link, not merge: the linked root's personas are PRESENTED beside this root's, never folded into its own roster —
  // a device acts only as the personas whose keys it holds. (Per-root reputation under the zk gate follows from
  // that: a linked persona has no proof on this device. The fixture rep adapter answers a default tier for ANY id,
  // so a tier read here would not be evidence either way: A-CU-3-PER-ROOT-REP-UNDER-FIXTURE-REP.)
  for (const h of handlesA) if (ownA.includes(h)) throw new Error("a linked persona was folded into this root's own roster: " + h);
  for (const h of handlesB) if (ownB.includes(h)) throw new Error("a linked persona was folded into this root's own roster: " + h);
  const asLinked = await A.api("POST", "/api/seed-persona", { personaId: la[0].personas[0].id }); // B's persona, as A sees it
  if (asLinked.status !== 400) throw new Error("this device switched to a linked root's persona (" + asLinked.status + ") — it holds no key for it");
  // the grant is sealed in each vault: no persona handle of the other root appears in a plain validator row
  const state = db();
  for (const row of state.everything) if (row.t === "adapter_state" && (row.s.includes(ownA[0]) || row.s.includes(ownB[0]))) throw new Error("a persona handle is in a plain validator row");
  // unlink from B; A drops its copy on its next read
  await B.must("rootlink", "unlink", lb[0].grantId);
  if ((await B.must("rootlink", "linked")).length !== 0) throw new Error("B still lists the link after unlinking");
  if ((await A.must("rootlink", "linked")).length !== 0) throw new Error("A still lists the link after B unlinked");
  await A.close();
  await B.close();
});

await O.close();
await N.close();
await browser.close();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 3 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
