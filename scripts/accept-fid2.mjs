// MULTI-FID PASS — Gate 2 acceptance (fixture): two persona accounts, the three-way view, act-as, the live command.
//   1. THE NETWORK VIEW: a persona's cast sits on the (sim) network under ITS fid — no persona anywhere in the record
//   2. OUR CLIENT, NON-GRANTED viewer: the bare persona (its own name/handle/avatar), nothing merged
//   3. OUR CLIENT, GRANTED viewer: merged identity — the persona linked to its sibling, split avatar data present
//   4. THE CAST CARD: as the granted viewer the timeline card shows the merged name and the split avatar; as a stranger neither
//   5. ACT-AS THROUGH THE WRITE DOOR: a reply as persona B to persona A's network cast goes out under B's fid, ledgered and attributed to B
//   6. ACT-AS OPTIONS: the picker lists the minted public persona too
//   7. CUSTODY SIGNING: the app signs an IdRegistry Transfer / SignedKeyRequest that recovers to the persona's own custody address; a foreign `to` is refused
//   8. THE LIVE COMMAND: scripts/fid-acquire.mjs dry-runs (cost sheet, no billable call) and aborts without credentials before any network call
//   9. FOLLOW / LIKE / DELETE as personas: a like under B's fid; A's delete under A's fid retracts the attribution (advisory)
//  10. THE LIVE RECORDER: scripts/live-fid2.mjs exists, is an npm script, and refuses without live records + ENABLE_FC_WRITE (no network)
// Fixture, pinned ports, no network, no spend.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { recoverTypedDataAddress } from "viem";
import { isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const MAIN = "persona_viewer_main"; // @yeak__ — whitelisted by the seed to see brothandbones ↔ linescoreluke
const STRANGER = "persona_acc_crypto_1";
const GRANTED = "persona_acc_food_2"; // @crustcritic — the seeded viewer our minted persona will whitelist
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const FORK_SOURCE = seedList.find((p) => p.handle === "brothandbones")?.id;
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
const write = (body) => api("POST", "/api/fc/write", body);
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const viewAs = async (personaId) => { const r = await retry(() => dev("viewAs", { personaId })); viewerCookie = personaId; return r; };
const attributions = async (hashes) => (await retry(() => api("GET", "/api/fc/attribution?hashes=" + hashes.map(encodeURIComponent).join(",")))).json.attributions;
const simCasts = async () => (await retry(() => dev("fcSimNetwork"))).json.casts;

await reset();
const forked = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fid2_pub_${Date.now().toString(36).slice(-4)}` }));
const PUB2 = forked.json.newPersona;
if (!PUB2) throw new Error("fork did not mint a persona");
const recMain = (await retry(() => persona("acquire", { personaId: MAIN }))).json.record;
// MULTI-FID Gate 3: the fork mints the new persona's fid itself (per-persona-fid mode); acquire only if it did not
const recPub = forked.json.newFid ? (await retry(() => api("GET", "/api/fc/persona"))).json.records.find((r) => r.personaId === PUB2) : (await retry(() => persona("acquire", { personaId: PUB2 }))).json.record;
if (!recPub?.fid) throw new Error("PUB2 owns no fid after the fork");
// the minted persona whitelists ONE seeded viewer to see it linked to MAIN (the sibling)
await retry(() => api("POST", "/api/identity/grant", { fromPersona: MAIN, toPersona: PUB2, tier: "whitelist", audienceMember: GRANTED }));
// a THIRD minted persona owns no fid: the live command's dry run is judged on it
// MULTI-FID Gate 3: minted under shared-fid mode so it owns NO fid (a per-persona-fid fork would mint one)
await retry(() => persona("setNetworkMode", { mode: "shared-fid" }));
let forked3;
try { forked3 = await retry(() => api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: `fid2_dry_${Date.now().toString(36).slice(-4)}` })); }
finally { await retry(() => persona("setNetworkMode", { mode: null })); }
const PUB3 = forked3.json.newPersona;
if (forked3.json.newFid) throw new Error("a shared-fid fork minted a fid");
const stamp = Date.now().toString(36);
let castA, castB;

// ---- 1. the network view ----
await check("1. THE NETWORK VIEW: a cast by the minted persona sits on the sim network under ITS fid, and the network record carries no persona id, handle or name — a normal separate account", async () => {
  castB = (await retry(() => write({ action: "cast", personaId: PUB2, text: `hello from a separate account ${stamp} [layers-test fixture]` }))).json;
  if (castB.fid !== recPub.fid) throw new Error("cast not under the persona's fid: " + JSON.stringify(castB));
  const sim = await simCasts();
  const rec = sim.find((c) => c.hash === castB.hash);
  if (!rec || rec.fid !== recPub.fid) throw new Error("sim network record: " + JSON.stringify(rec));
  const asText = JSON.stringify(rec);
  if (asText.includes(PUB2) || asText.includes(recPub.fname) || asText.includes("layers:persona")) throw new Error("the network record carries the persona: " + asText.slice(0, 200));
});

// ---- 2. non-granted viewer ----
await check("2. OUR CLIENT, NON-GRANTED viewer: the cast is attributed to the bare persona — its own name, handle and avatar — with nothing merged and no linked sibling", async () => {
  await viewAs(STRANGER);
  const att = (await attributions([castB.hash]))[castB.hash];
  await viewAs(null);
  if (!att || att.id !== PUB2) throw new Error("attribution: " + JSON.stringify(att));
  if (att.merged || att.linked) throw new Error("a stranger sees the merge: " + JSON.stringify(att));
  if (!att.handle || !att.name) throw new Error("bare persona incomplete: " + JSON.stringify(att));
});

// ---- 3. granted viewer ----
await check("3. OUR CLIENT, GRANTED viewer: the same cast resolves MERGED — the persona linked to MAIN (its sibling) at the whitelist tier, with both avatars for the split — and only for that viewer", async () => {
  await viewAs(GRANTED);
  const att = (await attributions([castB.hash]))[castB.hash];
  await viewAs(null);
  if (!att || att.id !== PUB2) throw new Error("attribution: " + JSON.stringify(att));
  if (att.merged !== true || att.linked?.personaId !== MAIN || att.linked?.tier !== "whitelist") throw new Error("not merged for the granted viewer: " + JSON.stringify(att));
  if (!att.linked.avatarUrl || !att.avatarUrl) throw new Error("split avatar needs both avatars: " + JSON.stringify(att));
  await viewAs(MAIN);
  const self = (await attributions([castB.hash]))[castB.hash];
  await viewAs(null);
  if (self?.merged) throw new Error("the sibling's own viewer context should not merge a grant it did not receive: " + JSON.stringify(self));
});

// ---- 4. the cast card ----
await check("4. THE CAST CARD: an act-as reply by the minted persona renders in the timeline; as the granted viewer the card shows the merged name (data-linked = MAIN's handle) and the split avatar; as a stranger it shows the bare persona and neither", async () => {
  const seedPost = (await retry(() => api("GET", "/api/feed2?surface=home"))).json.cards.find((c) => c.kind === "post" && c.cast?.hash && !String(c.cast.hash).startsWith("0x"));
  const target = seedPost?.cast?.hash ?? (await retry(() => api("GET", "/api/feed2?surface=home"))).json.cards.find((c) => c.kind === "post")?.cast?.hash;
  if (!target) throw new Error("no seed post to reply to");
  const r = (await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: target, text: `card check ${stamp}`, asPersonaId: PUB2 }))).json;
  if (!r.ok || !r.hash) throw new Error("act-as reply: " + JSON.stringify(r));
  const mainHandle = seedList.find((p) => p.id === MAIN)?.handle ?? "yeak__";
  const browser = await chromium.launch();
  try {
    for (const [viewer, expectMerged] of [[GRANTED, true], [STRANGER, false]]) {
      await viewAs(viewer);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([{ name: "layers_view_as", value: viewer, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(BASE + "/home?feed=classic", { waitUntil: "networkidle" });
      const card = page.locator("[data-testid='cast']", { hasText: `card check ${stamp}` }).first();
      await card.waitFor({ timeout: 8000 });
      const merged = await card.locator("[data-testid='cast-merged-identity']").count();
      const split = await card.locator("[data-testid='cast-split-avatar']").count();
      if (expectMerged && (merged !== 1 || split !== 1)) throw new Error(`granted viewer: merged=${merged} split=${split}`);
      if (expectMerged) {
        const linked = await card.locator("[data-testid='cast-merged-identity']").getAttribute("data-linked");
        if (linked !== mainHandle) throw new Error("linked handle: " + linked);
      }
      if (!expectMerged && (merged !== 0 || split !== 0)) throw new Error(`stranger: merged=${merged} split=${split}`);
      await ctx.close();
    }
  } finally {
    await viewAs(null);
    await browser.close();
  }
});

// ---- 5. act-as through the write door ----
await check("5. ACT-AS THROUGH THE WRITE DOOR: MAIN casts on the network; a reply AS the minted persona to that cast goes out under the minted persona's fid, is ledgered as a reply under that fid, and is attributed to it", async () => {
  castA = (await retry(() => write({ action: "cast", personaId: MAIN, text: `main on the network ${stamp} [layers-test fixture]` }))).json;
  if (castA.fid !== recMain.fid) throw new Error("MAIN's cast fid: " + castA.fid);
  const r = (await retry(() => api("POST", "/api/actions/act-as", { kind: "reply", targetHash: castA.hash, text: `reply as the other account ${stamp} [layers-test fixture]`, asPersonaId: PUB2 }))).json;
  if (r.network !== true || r.fid !== recPub.fid || !r.hash) throw new Error("act-as network reply: " + JSON.stringify(r));
  const ledger = (await retry(() => api("GET", "/api/fc/write"))).json.entries;
  const e = ledger.find((x) => x.castHash === r.hash);
  if (!e || e.kind !== "reply" || e.fid !== recPub.fid || e.status !== "sent") throw new Error("ledger: " + JSON.stringify(e));
  const att = (await attributions([r.hash]))[r.hash];
  if (att?.id !== PUB2) throw new Error("reply attribution: " + JSON.stringify(att));
});

// ---- 6. act-as options ----
await check("6. ACT-AS OPTIONS: the timeline picker lists the minted public persona beside the seeded ones", async () => {
  const opts = (await retry(() => api("GET", "/api/personas/act-as-options"))).json.options;
  if (!opts.some((o) => o.id === PUB2)) throw new Error("minted persona missing: " + JSON.stringify(opts.map((o) => o.id)));
  if (!opts.some((o) => o.id === MAIN)) throw new Error("MAIN missing");
});

// ---- 7. custody signing ----
await check("7. CUSTODY SIGNING: the app signs an IdRegistry Transfer and a SignedKeyRequest that recover to the persona's OWN custody address; a Transfer to another address is refused; a past deadline is refused", async () => {
  // MULTI-FID Gate 5 (attack-fid-3 #14): one persona, one fid — a persona that already owns one is refused a second Transfer, so the
  // signatures are exercised on the fid-less minted persona (PUB3) and the refusal on the one with a fid (PUB2)
  const probe = (await retry(() => persona("signerProbe", { personaId: PUB3 }))).json;
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const owns = await persona("custodySign", { personaId: PUB2, kind: "transfer", fid: 123456, to: (await retry(() => persona("signerProbe", { personaId: PUB2 }))).json.custodyAddress, nonce: 0, deadline });
  if (owns.status !== 400 || !/already owns a fid/.test(owns.json?.reason ?? "")) throw new Error("a persona that owns a fid was allowed a second Transfer: " + JSON.stringify(owns.json));
  // MULTI-FID Gate 5 (D-FID-5-LIVE-KEYSTORE-ONLY): the probe says which root the keys came from, and a fixture-rooted persona
  // (MAIN, seeded: its keys are public by construction) is refused a custody signature before anything could be registered
  if (probe.keystoreRooted !== true || probe.liveEligible !== true) throw new Error("the minted persona is not reported keystore-rooted/live-eligible: " + JSON.stringify(probe));
  const mainProbe = (await retry(() => persona("signerProbe", { personaId: MAIN }))).json;
  if (mainProbe.keystoreRooted !== false) throw new Error("the seeded persona is reported keystore-rooted");
  const seeded = await persona("custodySign", { personaId: MAIN, kind: "transfer", fid: 123456, to: mainProbe.custodyAddress, nonce: 0, deadline });
  if (seeded.status !== 400 || !/root phrase/.test(seeded.json?.reason ?? "")) throw new Error("a seeded persona was allowed a custody signature: " + JSON.stringify(seeded.json));
  const t = (await retry(() => persona("custodySign", { personaId: PUB3, kind: "transfer", fid: 123456, to: probe.custodyAddress, nonce: 0, deadline }))).json;
  if (!/^0x[0-9a-f]{130}$/i.test(t.signature ?? "")) throw new Error("transfer signature: " + JSON.stringify(t));
  const who = await recoverTypedDataAddress({
    domain: { name: "Farcaster IdRegistry", version: "1", chainId: 10, verifyingContract: "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" },
    types: { Transfer: [{ name: "fid", type: "uint256" }, { name: "to", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Transfer",
    message: { fid: 123456n, to: probe.custodyAddress, nonce: 0n, deadline: BigInt(deadline) },
    signature: t.signature,
  });
  if (who.toLowerCase() !== probe.custodyAddress.toLowerCase()) throw new Error("Transfer does not recover to the custody address");
  const k = (await retry(() => persona("custodySign", { personaId: PUB3, kind: "keyRequest", requestFid: 123456, deadline }))).json;
  if (k.key !== "0x" + probe.derivedPubHex) throw new Error("key request names a key that is not the derived signer: " + JSON.stringify(k));
  const who2 = await recoverTypedDataAddress({
    domain: { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" },
    types: { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] },
    primaryType: "SignedKeyRequest",
    message: { requestFid: 123456n, key: k.key, deadline: BigInt(deadline) },
    signature: k.signature,
  });
  if (who2.toLowerCase() !== probe.custodyAddress.toLowerCase()) throw new Error("SignedKeyRequest does not recover to the custody address");
  const foreign = await persona("custodySign", { personaId: PUB3, kind: "transfer", fid: 1, to: "0x" + "ab".repeat(20), nonce: 0, deadline });
  if (foreign.status !== 400 || !/own custody address/.test(foreign.json?.reason ?? "")) throw new Error("foreign `to` accepted: " + JSON.stringify(foreign.json));
  const stale = await persona("custodySign", { personaId: PUB3, kind: "transfer", fid: 1, to: probe.custodyAddress, nonce: 0, deadline: 1000 });
  if (stale.status !== 400) throw new Error("past deadline accepted");
});

// ---- 8. the live command ----
await check("8. THE LIVE COMMAND: scripts/fid-acquire.mjs is an npm script; a DRY RUN prints the itemized cost sheet under the $10 cap and makes no billable call; with the confirm flag but no Neynar credentials it aborts BEFORE any network call", async () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!existsSync("scripts/fid-acquire.mjs") || pkg.scripts["fid:acquire"] !== "node scripts/fid-acquire.mjs") throw new Error("fid:acquire not wired");
  const env = { ...process.env, BASE_URL: BASE };
  delete env.FID_ACQUIRE_CONFIRM;
  const dry = spawnSync(process.execPath, ["scripts/fid-acquire.mjs", PUB3], { env, encoding: "utf8", timeout: 60000 });
  const out = (dry.stdout || "") + (dry.stderr || "");
  if (dry.status !== 0 || !/COST SHEET/.test(out) || !/DRY RUN/.test(out) || !/cap: \$10\.00/.test(out)) throw new Error("dry run: status " + dry.status + " " + out.slice(0, 300));
  // INTEGRATION (registrant gate): armed WITHOUT the registrant word, the run stops at the warning before anything else
  const unacked = spawnSync(process.execPath, [process.cwd() + "/scripts/fid-acquire.mjs", PUB3], { env: { ...env, FID_ACQUIRE_CONFIRM: "yes", FID_REGISTRANT_ACK: "", NEYNAR_API_KEY: "", NEYNAR_WALLET_ID: "" }, encoding: "utf8", timeout: 60000, cwd: process.env.TEMP || process.cwd() });
  const out1 = (unacked.stdout || "") + (unacked.stderr || "");
  if (unacked.status === 0 || !/registrant warning above was not acknowledged/.test(out1) || !/No billable call was made/.test(out1)) throw new Error("armed without the registrant word did not stop at the warning: status " + unacked.status + " " + out1.slice(-300));
  // with the word given, the run goes on to the credential check and aborts there (no key) before any network call
  const armed = spawnSync(process.execPath, [process.cwd() + "/scripts/fid-acquire.mjs", PUB3], { env: { ...env, FID_ACQUIRE_CONFIRM: "yes", FID_REGISTRANT_ACK: "SIBLINGS", NEYNAR_API_KEY: "", NEYNAR_WALLET_ID: "" }, encoding: "utf8", timeout: 60000, cwd: process.env.TEMP || process.cwd() });
  const out2 = (armed.stdout || "") + (armed.stderr || "");
  if (armed.status === 0 || !/(NEYNAR_API_KEY is not set|already owns a fid|not answering)/.test(out2)) throw new Error("armed without credentials did not abort cleanly: status " + armed.status + " " + out2.slice(-300));
});

// ---- 9. follow / like / delete ----
await check("9. FOLLOW / LIKE / DELETE as personas: the minted persona likes MAIN's cast under its own fid; MAIN deletes its cast under MAIN's fid and the attribution row is retracted (advisory delete)", async () => {
  const like = (await retry(() => write({ action: "like", targetHash: castA.hash, personaId: PUB2 }))).json;
  if (like.fid !== recPub.fid) throw new Error("like fid: " + JSON.stringify(like));
  const del = (await retry(() => write({ action: "delete", hash: castA.hash }))).json;
  if (del.fid !== recMain.fid) throw new Error("delete fid: " + JSON.stringify(del));
  const att = (await attributions([castA.hash]))[castA.hash];
  if (att !== null) throw new Error("attribution not retracted: " + JSON.stringify(att));
  const ledger = (await retry(() => api("GET", "/api/fc/write"))).json.entries;
  if (!ledger.some((e) => e.kind === "delete" && e.castHash === castA.hash && e.fid === recMain.fid)) throw new Error("delete not ledgered under MAIN's fid");
});

// ---- 10. the live recorder ----
await check("10. THE LIVE RECORDER: scripts/live-fid2.mjs exists as npm script live:fid2 and refuses to run without ENABLE_FC_WRITE and live persona records — no network call", async () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!existsSync("scripts/live-fid2.mjs") || pkg.scripts["live:fid2"] !== "node scripts/live-fid2.mjs") throw new Error("live:fid2 not wired");
  const env = { ...process.env, BASE_URL: BASE };
  delete env.ENABLE_FC_WRITE;
  const r = spawnSync(process.execPath, ["scripts/live-fid2.mjs"], { env, encoding: "utf8", timeout: 60000 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status === 0 || !/(ENABLE_FC_WRITE|no live persona)/.test(out)) throw new Error("live recorder ran or failed for the wrong reason: status " + r.status + " " + out.slice(0, 300));
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Multi-FID Gate 2 (fixture) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
