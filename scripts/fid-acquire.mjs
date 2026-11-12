#!/usr/bin/env node
/**
 * MULTI-FID PASS Gate 2 / Gate 5 — THE USER'S LIVE ACQUISITION COMMAND (one persona per run).
 *
 *   node scripts/fid-acquire.mjs <personaId>                          dry run: cost sheet only
 *   FID_ACQUIRE_CONFIRM=yes node scripts/fid-acquire.mjs <personaId>  create the account
 *
 * Creates ONE real Farcaster account for the named persona through Neynar's sponsored registration, with the
 * persona's OWN derived custody address as the fid's owner and the managed signer Neynar reports for it. The app
 * signs the IdRegistry Transfer (the key never leaves the app: POST /api/fc/persona custodySign), receives the
 * receipt (recordLiveFid) and the itemized spend (recordFidSpend), and seals both.
 *
 * MONEY RULES (the pass's, not negotiable):
 *   - prints an itemized cost sheet BEFORE any billable call
 *   - hard-aborts unless the sheet is established under the $10 cap net of what the ledger already recorded
 *   - does NOTHING billable unless FID_ACQUIRE_CONFIRM=yes
 *   - at most TWO persona fids live in this pass (the app enforces it too)
 *   - LEDGER BEFORE NETWORK: the registration's estimate is recorded before the billable call
 *   - CHECK BEFORE RETRY: if the persona's custody address already owns a fid on the network, that fid is RECORDED,
 *     never a second one created (Gate 5, attack-fid-1 #12 / attack-fid-3 #3)
 *   - ONE persona per invocation (Gate 5, attack-fid-1 #8): two registrations minutes apart are a public pair
 *   - never runs in a sweep; the app must be up with ZK_DEV_HOOKS=true AND FID_ACQUIRE_ENABLED=true
 *
 * IDENTITY RULES (Gate 5): only a persona whose keys come off the ROOT PHRASE may own a live account — a seeded
 * persona's keys are public by construction and are refused before any billable call (D-FID-5-LIVE-KEYSTORE-ONLY).
 * The network profile is the persona's own (name, bio, avatar); nothing in it names this client.
 *
 * Needs in .env.local: NEYNAR_API_KEY, NEYNAR_WALLET_ID (a funded App Wallet on Optimism). Optional OP_RPC_URL
 * (recommended: a private endpoint — the nonce read is a third-party observation of a fresh address).
 * Prints no private key, ever; the signer uuid goes to the app, not to stdout.
 *
 * PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — AGAINST THE HOSTED OWNER SERVICE. The app this command talks to may be the
 * owner service on Railway instead of the laptop rig:
 *
 *   $env:APP_URL = "https://<owner-app>.up.railway.app"
 *   $env:OWNER_ACCESS_SECRET = (Get-Content "$HOME\.layers\owner-secret" -Raw).Trim()  # never on a command line
 *   node scripts/fid-acquire.mjs <personaId>                                            # dry run, as always
 *
 * With OWNER_ACCESS_SECRET in this shell the command logs in first (POST /api/owner-login, JSON) and carries the
 * session cookie on every call to the app; it refuses to send the passphrase over plain http to anything but
 * loopback, and prints neither the passphrase nor the cookie. The TARGET comes from this shell only (BASE_URL, then
 * APP_URL), never from .env.local — a stray line in a file must not point a billable command somewhere else. The
 * Neynar calls still run HERE, with this machine's NEYNAR_API_KEY / NEYNAR_WALLET_ID; the owner app only signs with
 * the persona's custody key and seals the receipt — every guard above is unchanged.
 *
 * CAPS: two accounts and $10 by default. LAYERS_MAX_LIVE_PERSONA_FIDS / LAYERS_FID_SPEND_CAP_USD raise them, within
 * hard bounds (20 accounts, $25), and they must be raised in BOTH places: this shell, and the app's environment
 * (the app enforces its own copy; this command refuses when the app reports a higher cap than it would allow).
 * A "connected" record (the owner's own main account, lib/fc/connect.ts) was never created here and never counts.
 *
 * REGISTRANT (CONNECT MAIN research, chain read 2026-10-07): the IdGateway.register sender of every account made
 * here is the App Wallet behind NEYNAR_WALLET_ID — the developer's own, not Neynar's. The owner's current wallet is
 * the one that registered the Totem-named test account and the fids pre-registered beside it, so a persona made
 * through it is that account's onchain sibling (same sender, minutes apart, a next-door fid), whatever the record's
 * "registrant: neynar-sponsor" says (that value is by fiat: A-FID-REGISTRANT-BY-FIAT, lib/fc/linkage.ts). The cost
 * sheet says so BEFORE the dry run, and the confirmed run refuses unless THIS shell carries FID_REGISTRANT_ACK=SIBLINGS
 * (the current wallet, knowingly) or FID_REGISTRANT_ACK=FRESH (a NEYNAR_WALLET_ID set in this shell that differs from
 * .env.local's: a wallet the owner says never registered or funded the test account). Both are read BEFORE .env.local
 * is loaded, so a line in that file can neither acknowledge the warning nor pass as a wallet "set in this shell";
 * scripts/owner/acquire-fid.ps1 sets them from what the owner typed (-WalletId). A wallet id is never printed beyond
 * its last 4 characters.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const NEYNAR_BASE = "https://api.neynar.com";
// PROD-LIVE (caps): DELIBERATE DUPLICATE of boundedEnvNumber() and the bounds in lib/x/spend.ts / lib/fc/acquire.ts
// (a script cannot import TypeScript). Defaults stay the prompt's: $10 and two accounts.
const FID_SPEND_CAP_HARD_MAX_USD = 25;
const MAX_LIVE_PERSONA_FIDS_HARD_MAX = 20;
function boundedEnvNumber(raw, def, max, { integer = false, floor = 0 } = {}) {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n) || n <= 0) return def;
  const v = integer ? Math.floor(n) : n;
  if (v <= 0) return def;
  return Math.min(max, Math.max(floor, v));
}
let CAP_USD = 10; // the prompt's ceiling unless raised in BOTH places; the app clamps its own knob to the same bound
let MAX_LIVE = 2;
// the target is read BEFORE .env.local is loaded, on purpose (see the header)
const BASE = (process.env.BASE_URL || process.env.APP_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`).replace(/\/+$/, "");
const OWNER_COOKIE = "__Host-layers-owner";
let sessionCookie = "";
const ID_REGISTRY_ADDRESS = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b";
const ID_REGISTRY_ABI = [
  { name: "nonces", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "idOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
];
const FNAME_RE = /^[a-z0-9][a-z0-9-]{0,15}$/;
const CLIENT_NEEDLES = [/layers/i, /totem/i, /\[layers-test/i];
/** REGISTRANT: a wallet id is never printed beyond its last 4 characters */
const last4 = (s) => { const v = String(s ?? "").trim(); return v.length >= 4 ? v.slice(-4) : "????"; };
/** one value from .env.local WITHOUT touching process.env — the registrant comparison needs the FILE's wallet even
 *  when this shell overrides it (loadEnvLocal fills unset names only) */
function envLocalValue(name) {
  const f = path.join(process.cwd(), ".env.local");
  if (!existsSync(f)) return null;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] !== name) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return null;
}

class Stop extends Error {}
function die(...lines) {
  for (const l of lines) console.error(l);
  throw new Stop("stop");
}
function loadEnvLocal() {
  const f = path.join(process.cwd(), ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
const neynarHeaders = (extra = {}) => ({ "x-api-key": process.env.NEYNAR_API_KEY, "Content-Type": "application/json", ...extra });
async function fetchJson(label, url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    die(`ABORT at "${label}": network request failed before any response.`, `  ${err?.message ?? String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) die(`ABORT at "${label}": HTTP ${res.status}.`, `  Response body: ${text ? text.slice(0, 1500) : "(empty)"}`);
  try {
    return JSON.parse(text);
  } catch {
    die(`ABORT at "${label}": expected JSON, got: ${text.slice(0, 300)}`);
  }
}
const isLoopback = (u) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
/** PROD-LIVE: log in to an owner service (when this shell carries OWNER_ACCESS_SECRET) and keep the session cookie */
async function ownerLogin() {
  const secret = process.env.OWNER_ACCESS_SECRET;
  if (!secret) return false;
  let target;
  try {
    target = new URL(BASE);
  } catch {
    die(`ABORT: the target ${BASE} is not a URL.`);
  }
  if (target.protocol !== "https:" && !isLoopback(target)) die(`ABORT: refusing to send the owner passphrase over plain http to ${target.host} — use the service's https:// URL.`);
  let res;
  try {
    res = await fetch(BASE + "/api/owner-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase: secret }) });
  } catch (err) {
    die(`ABORT: the owner login at ${target.host} failed before any response: ${err?.message ?? String(err)}`);
  }
  if (res.status === 404) return false; // no gate configured on that app (the laptop rig): carry on without a session
  if (res.status === 429) die("ABORT: the owner login is rate limited — wait a few minutes and re-run. Nothing billable was called.");
  if (!res.ok) die(`ABORT: the owner service refused the passphrase (HTTP ${res.status}). Nothing billable was called.`);
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const pair = raw.map((c) => String(c).split(";")[0].trim()).find((p) => p.startsWith(OWNER_COOKIE + "="));
  if (!pair) die("ABORT: the owner login answered without a session cookie. Nothing billable was called.");
  sessionCookie = pair;
  console.log(`owner service: signed in at ${target.host} (session held in memory for this run only)`);
  return true;
}
/** every call to the APP goes through here: the session cookie rides along, and a gate we are not signed in to is a
 *  loud stop — never read as "no records" (a 401 body parsed as a view would have skipped the already-owns check) */
async function appFetch(p, init = {}) {
  let r;
  try {
    r = await fetch(BASE + p, sessionCookie ? { ...init, headers: { ...(init.headers ?? {}), cookie: sessionCookie } } : init);
  } catch {
    return null;
  }
  if (r.status === 401) {
    const j = await r.clone().json().catch(() => null);
    if (j?.code === "owner_login_required")
      die(`ABORT: ${BASE} is an owner service behind a passphrase and this run is not signed in — put OWNER_ACCESS_SECRET in this shell (read from a file, never typed on a command line; notes/runbooks/GO-LIVE-FARCASTER.md) and re-run. Nothing billable was called.`);
  }
  return r;
}
async function app(action, body = {}) {
  const r = await appFetch("/api/fc/persona", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  if (!r) return { status: 0, json: null };
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
/** the persona's own profile for the network — never a client string */
function profileFor(record, fallbackName) {
  const name = String(record?.name ?? fallbackName ?? "").slice(0, 64) || fallbackName;
  const bio = String(record?.bio ?? "").slice(0, 256);
  const pfp = typeof record?.avatarUrl === "string" && /^https?:\/\//.test(record.avatarUrl) ? record.avatarUrl : undefined;
  const meta = { display_name: name, bio, ...(pfp ? { pfp_url: pfp } : {}) };
  for (const v of Object.values(meta)) for (const n of CLIENT_NEEDLES) if (n.test(String(v))) die(`ABORT: the network profile would name this client (${JSON.stringify(v)}) — set the persona's name/bio to something of its own first.`);
  return meta;
}

async function main() {
  // REGISTRANT: both read BEFORE .env.local is loaded — a line in that file can neither acknowledge the warning nor
  // pass as "a wallet set in this shell" (the SEC-2 lesson, applied to the new gate)
  const walletFromShell = typeof process.env.NEYNAR_WALLET_ID === "string" && process.env.NEYNAR_WALLET_ID.trim() ? process.env.NEYNAR_WALLET_ID.trim() : null;
  const registrantAck = (process.env.FID_REGISTRANT_ACK ?? "").trim();
  loadEnvLocal();
  const personas = process.argv.slice(2).filter((x) => /^[A-Za-z0-9_]{1,80}$/.test(x));
  if (personas.length !== 1) die("usage: node scripts/fid-acquire.mjs <personaId>   (ONE persona per invocation — two registrations minutes apart are a public pair; run again later for the second)");
  const personaId = personas[0];
  const confirm = process.env.FID_ACQUIRE_CONFIRM === "yes";
  // REGISTRANT: which wallet registers the account, and whether it is the one that registered the test account
  // (.env.local's) or one this shell named instead — "fresh" is the OWNER's claim, typed as FRESH; the command can
  // only see that the ids differ
  const walletFromFile = envLocalValue("NEYNAR_WALLET_ID");
  const walletFresh = walletFromShell !== null && walletFromShell !== String(walletFromFile ?? "").trim();
  const expectedAck = walletFresh ? "FRESH" : "SIBLINGS";
  // PROD-LIVE (caps): read after .env.local, so the laptop rig's app (which loads the same file) and this command agree
  CAP_USD = boundedEnvNumber(process.env.LAYERS_FID_SPEND_CAP_USD, 10, FID_SPEND_CAP_HARD_MAX_USD);
  MAX_LIVE = boundedEnvNumber(process.env.LAYERS_MAX_LIVE_PERSONA_FIDS, 2, MAX_LIVE_PERSONA_FIDS_HARD_MAX, { integer: true });
  if (CAP_USD !== 10 || MAX_LIVE !== 2) console.log(`caps RAISED in this shell: at most ${MAX_LIVE} live persona accounts, $${CAP_USD.toFixed(2)} total (hard bounds ${MAX_LIVE_PERSONA_FIDS_HARD_MAX} / $${FID_SPEND_CAP_HARD_MAX_USD}); the app must carry the same values`);

  // PROD-LIVE: say which app this run drives before anything else, then sign in if it is an owner service (a no-op
  // against the laptop rig, which has no gate)
  console.log(`target app: ${BASE}`);
  await ownerLogin();

  // 0. the app must be up, with the rig actions this command uses
  const viewRes = await appFetch("/api/fc/persona");
  const view = viewRes && viewRes.ok ? await viewRes.json().catch(() => null) : null;
  if (!view || !Array.isArray(view.records)) die(`ABORT: the app is not answering at ${BASE}${viewRes ? " (HTTP " + viewRes.status + ")" : ""} — start it first (npm run start).`);
  // CONNECT MAIN review: the cap counts accounts this pass CREATED — a "connected" record is the owner's existing main
  // account (lib/fc/acquire.ts recordLiveFid applies the same filter)
  const liveNow = (view.records ?? []).filter((r) => r.mode === "live" && r.origin !== "connected");
  if (liveNow.length + 1 > MAX_LIVE) die(`ABORT: ${liveNow.length} persona fid(s) already created live in this pass; the cap is ${MAX_LIVE} (LAYERS_MAX_LIVE_PERSONA_FIDS raises it, up to ${MAX_LIVE_PERSONA_FIDS_HARD_MAX}, in this shell AND on the app).`);
  if (view.map?.[personaId]) die(`ABORT: ${personaId} already owns a fid (${view.map[personaId].fid}).`);

  // 1. the persona's OWN keys (public material) — and WHICH root they come from
  const probe = (await app("signerProbe", { personaId })).json;
  if (!probe?.custodyAddress || !probe?.derivedPubHex) die(`ABORT: the app has no keys for ${personaId} (not one of this device's personas?).`);
  if (probe.keystoreRooted !== true) die(`ABORT: ${personaId}'s keys come off the FIXTURE root (public by construction) — a live account for it could be taken by anyone with the repo (D-FID-5-LIVE-KEYSTORE-ONLY). Fork or mint a persona and run this for that persona.`);
  // CONNECT MAIN review (PL-4): the app names its reason when it has one (a handle sharing a stem with your main account)
  if (probe.liveEligible !== true) die(typeof probe.refusal === "string" && probe.refusal ? `ABORT: ${probe.refusal} No billable call was made.` : `ABORT: ${personaId} is not a public keystore-rooted persona.`);
  const custody = probe.custodyAddress;
  console.log(`persona ${personaId}: custody address ${custody} (derived from the root phrase; the key stays in the app)`);

  // REGISTRANT — stated plainly BEFORE the cost sheet and the dry run (CONNECT MAIN research: the chain's sender is the
  // developer's App Wallet, not Neynar; the fid pool 3348983-3348991 and the test account share this owner's wallet)
  const walletShown = "..." + last4(process.env.NEYNAR_WALLET_ID) + " (NEYNAR_WALLET_ID from " + (walletFromShell !== null ? "this shell" : ".env.local") + ")";
  const testFid = /^[1-9]\d{0,9}$/.test(String(process.env.FC_TEST_FID ?? "").trim()) ? String(process.env.FC_TEST_FID).trim() : null;
  console.log(`\nREGISTRANT — read this before the cost sheet`);
  console.log(`  Every account this command creates is registered onchain by the App Wallet behind NEYNAR_WALLET_ID ${walletShown}:`);
  console.log(`  the developer's own wallet is the IdGateway.register sender, not Neynar (chain read 2026-10-07).`);
  if (!walletFresh) {
    console.log(`  That is the wallet that registered the Totem-named test account${testFid ? " (FC_TEST_FID " + testFid + ")" : ""} and the fids pre-registered`);
    console.log(`  beside it (the 3348983-3348991 pool), in one burst. On the chain a persona made through it is that account's`);
    console.log(`  SIBLING: the same sender, minutes apart, a next-door fid. Nothing later undoes that; the record's`);
    console.log(`  "registrant: neynar-sponsor" is by fiat (A-FID-REGISTRANT-BY-FIAT). A fresh Neynar app with its own App Wallet`);
    console.log(`  that never touched the test account avoids it (the personas made through THAT wallet still share it with each`);
    console.log(`  other). To create the account through this wallet anyway, the confirmed run needs FID_REGISTRANT_ACK=SIBLINGS.`);
  } else {
    console.log(`  It is not the wallet in .env.local (...${last4(walletFromFile)}), the one that registered the test account. That only`);
    console.log(`  helps if this wallet and the Neynar app it belongs to never registered or funded the test account or a persona,`);
    console.log(`  which only you can know. The personas made through it still share it with each other. The confirmed run needs`);
    console.log(`  FID_REGISTRANT_ACK=FRESH: your word that it never touched them.`);
  }

  // 2. THE COST SHEET — before anything billable, from the app's own ledger view
  const sheet = (await app("costSheet", { personas: 1 })).json;
  if (!sheet?.rows) die("ABORT: the app did not return a cost sheet.");
  console.log(`\nCOST SHEET — 1 persona fid via Neynar sponsored registration`);
  for (const r of sheet.rows) console.log(`  ${r.item.padEnd(62)} ${r.usd === null ? "not established" : "$" + r.usd.toFixed(2)}  ${r.credits ? r.credits + " credit(s)" : ""}  [${r.source}]`);
  console.log(`  total (USD, estimate): $${sheet.totalUsd.toFixed(2)}; already spent this pass: $${sheet.spentSoFar.toFixed(2)}; cap: $${sheet.capUsd.toFixed(2)}`);
  if (!(sheet.capUsd <= CAP_USD)) die(`ABORT: the app reports a fid spend cap of $${Number(sheet.capUsd).toFixed(2)}, above this command's $${CAP_USD.toFixed(2)} — raise LAYERS_FID_SPEND_CAP_USD in BOTH the app's environment and this shell, or in neither. No billable call was made.`);
  if (!sheet.established || !sheet.underCap) die("ABORT: the expected cost is not established under the cap. No billable call was made.");
  const record = (view.records ?? []).find((r) => r.personaId === personaId) ?? null;
  const identityRes = await appFetch("/api/identity?personaId=" + encodeURIComponent(personaId));
  const personaMeta = (identityRes && identityRes.ok ? await identityRes.json().catch(() => null) : null)?.identity ?? null;
  const profile = profileFor({ name: personaMeta?.displayName, bio: personaMeta?.bio ?? "", avatarUrl: personaMeta?.avatarUrl }, probe.fname);
  console.log(`network profile: ${JSON.stringify(profile)}`);
  if (!confirm) {
    console.log(`\nDRY RUN — nothing billable was called. Re-run with FID_ACQUIRE_CONFIRM=yes and FID_REGISTRANT_ACK=${expectedAck} (this shell, never .env.local) to create the account.`);
    return;
  }
  // REGISTRANT: the warning above must be acknowledged for THIS wallet, in this shell, before any billable call
  if (registrantAck !== expectedAck)
    die(`ABORT: the registrant warning above was not acknowledged for this wallet: the confirmed run needs FID_REGISTRANT_ACK=${expectedAck} in THIS shell (never in .env.local; scripts/owner/acquire-fid.ps1 sets it from what you type). No billable call was made.`);
  for (const n of ["NEYNAR_API_KEY", "NEYNAR_WALLET_ID"]) if (!process.env[n]) die(`ABORT: ${n} is not set (.env.local).`);
  if (process.env.FID_ACQUIRE_ENABLED !== "true") console.warn("NOTE: the APP must run with FID_ACQUIRE_ENABLED=true for the receipt to be recorded (this process's env is not the app's).");

  const { createPublicClient, http } = await import("viem");
  const { optimism } = await import("viem/chains");
  if (!process.env.OP_RPC_URL) console.warn("NOTE: OP_RPC_URL is unset — viem's public Optimism RPC will see this fresh address queried before it appears on chain (A-FID-CREATION-TIMING).");
  const publicClient = createPublicClient({ chain: optimism, transport: http(process.env.OP_RPC_URL) });

  // 3. CHECK BEFORE RETRY: does this custody address already own a fid on the network? Then RECORD it, never re-create.
  let existingFid = 0;
  try {
    existingFid = Number(await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: "idOf", args: [custody] }));
  } catch (err) {
    die("ABORT: could not read IdRegistry.idOf from Optimism RPC.", `  ${err?.message ?? String(err)}`, "Set OP_RPC_URL to a working Optimism mainnet RPC and re-run.");
  }
  const resumeFid = Number(process.env.FID_RESUME_FID ?? 0);
  if (existingFid > 0 || resumeFid > 0) {
    const fid = existingFid > 0 ? existingFid : resumeFid;
    if (existingFid > 0 && resumeFid > 0 && existingFid !== resumeFid) die(`ABORT: FID_RESUME_FID=${resumeFid} but the custody address owns fid ${existingFid}.`);
    console.log(`the custody address already owns fid ${fid} on the network — RESUME: recording it, creating nothing.`);
    const user = await fetchJson("user lookup", `${NEYNAR_BASE}/v2/farcaster/user/bulk?fids=${fid}`, { headers: neynarHeaders() });
    const u = user?.users?.[0];
    if (!u || String(u.custody_address ?? "").toLowerCase() !== custody.toLowerCase()) die(`ABORT: Neynar's record for fid ${fid} does not name this persona's custody address — not recording.`);
    const fname = String(u.username ?? "").toLowerCase();
    const rec = await app("recordLiveFid", { record: { personaId, fid, fname: FNAME_RE.test(fname) ? fname : null, origin: "layers-fid-pass", custodyAddress: custody, signer: { kind: "neynar-managed", uuid: "", derivedPubHex: probe.derivedPubHex, derivedRegistered: false }, registrant: "neynar-sponsor", funder: "neynar-sponsor", createdAt: Date.now(), mode: "live" } });
    if (!rec.json?.ok) die(`ABORT: the app refused the resumed receipt: ${rec.json?.reason ?? JSON.stringify(rec.json)}`);
    console.log(`recorded (resumed): ${personaId} → fid ${fid}. NOTE: no signer uuid is known for a resumed account — writes as this persona need a managed signer approved for it (Call Option A / the Neynar dashboard).`);
    return;
  }

  // 4. fname: the persona's handle, protocol grammar; availability = 1 credit
  const desired = String(probe.fname || personaId).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 16);
  const fname = FNAME_RE.test(desired) ? desired : "u" + Math.floor(Math.random() * 1e9).toString(36);
  for (const n of CLIENT_NEEDLES) if (n.test(fname)) die(`ABORT: the fname "${fname}" names this client.`);
  const avail = await fetchJson("fname availability", `${NEYNAR_BASE}/v2/farcaster/fname/availability?fname=${encodeURIComponent(fname)}`, { headers: neynarHeaders() });
  if (avail?.available !== true) die(`ABORT: fname "${fname}" is not available. Rename the persona's handle and re-run (1 credit spent).`);
  await app("recordFidSpend", { mode: "live", entry: { id: `fid:fname:${fname}`, kind: "fid_fname", amount: 0, note: `fname availability check (1 credit)` } });

  // 5. LEDGER BEFORE NETWORK: the registration's estimate is on the ledger before the billable call, keyed by the custody
  //    address (a re-run after an ambiguous failure never double-counts, and the RESUME path above never re-creates)
  const estimate = sheet.rows.find((r) => /sponsored registration/.test(r.item))?.usd ?? 0.9;
  const ledgered = await app("recordFidSpend", { mode: "live", entry: { id: `fid:create:${custody.toLowerCase()}`, kind: "fid_create", amount: estimate, note: `sponsored registration — ESTIMATE recorded BEFORE the call (the exact ETH figure is on dev.neynar.com → App Wallet)` } });
  if (!ledgered.json?.ok) die(`ABORT: the app refused to ledger the registration before the call: ${ledgered.json?.error ?? JSON.stringify(ledgered.json)} — is the app running with FID_ACQUIRE_ENABLED=true?`);

  // 6. reserve a fresh fid (10-minute window)
  const fidBody = await fetchJson("fetch fresh FID", `${NEYNAR_BASE}/v2/farcaster/user/fid`, { headers: neynarHeaders({ "x-wallet-id": process.env.NEYNAR_WALLET_ID }) });
  const fid = Number(fidBody?.fid);
  if (!Number.isInteger(fid) || fid <= 0) die("ABORT: no fid in the reservation response.");
  const reservedAt = Date.now();
  console.log(`fresh fid reserved: ${fid}`);

  // 7. the IdRegistry Transfer, signed BY THE APP with the persona's custody key (a fresh address: nonce 0 by construction; read anyway, from OP_RPC_URL)
  let nonce;
  try {
    nonce = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: "nonces", args: [custody] });
  } catch (err) {
    die("ABORT: could not read IdRegistry.nonces from Optimism RPC.", `  ${err?.message ?? String(err)}`, "Set OP_RPC_URL to a working Optimism mainnet RPC and re-run (the reservation lapses in 10 minutes).");
  }
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signed = (await app("custodySign", { personaId, kind: "transfer", fid, to: custody, nonce: Number(nonce), deadline })).json;
  if (!signed?.signature) die(`ABORT: the app refused to sign the Transfer: ${signed?.reason ?? JSON.stringify(signed)}`);

  // 8. register — no signer block (the FC pass found the self-owned block cannot validate before the fid exists and that
  //    Neynar returns an approved managed signer with the registration); the signer THE NETWORK REPORTS is what is recorded
  if ((Date.now() - reservedAt) / 60000 > 9) die("ABORT: the fid reservation is about to lapse; re-run.");
  const registerBody = { fid, signature: signed.signature, requested_user_custody_address: custody, deadline, fname, metadata: profile };
  const regRes = await fetch(`${NEYNAR_BASE}/v2/farcaster/user`, { method: "POST", headers: neynarHeaders({ "x-wallet-id": process.env.NEYNAR_WALLET_ID }), body: JSON.stringify(registerBody) }).catch((err) =>
    die("ABORT: the register call failed before any response — OUTCOME UNKNOWN.", `  ${err?.message ?? String(err)}`, "Re-run this command: it checks the network first and RECORDS an account that exists instead of creating another.")
  );
  const regText = await regRes.text();
  let reg = null;
  try { reg = regText ? JSON.parse(regText) : null; } catch { /* below */ }
  if (!regRes.ok || !reg || reg.success !== true) {
    die(`ABORT: registration failed (HTTP ${regRes.status}).`, `  Response body: ${regText ? regText.slice(0, 1500) : "(empty)"}`, "The estimate stays on the ledger (conservative). Re-run: check-before-retry records the account if it was created anyway.");
  }
  const reported = reg.signer ?? (Array.isArray(reg.signers) ? reg.signers[0] : null) ?? null;
  const signerUuid = reported && typeof reported.signer_uuid === "string" ? reported.signer_uuid : "";
  if (!signerUuid) console.warn("NOTE: the registration response reported no signer — the account exists but the app cannot write as it until a managed signer is approved for it.");
  else console.log("managed signer reported by the network (uuid withheld from output; it goes to the app's vault)");

  // 9. hand the receipt to the app: it validates the keys are this persona's, then seals it
  const rec = await app("recordLiveFid", {
    record: { personaId, fid, fname, origin: "layers-fid-pass", custodyAddress: custody, signer: { kind: "neynar-managed", uuid: signerUuid, derivedPubHex: probe.derivedPubHex, derivedRegistered: false }, registrant: "neynar-sponsor", funder: "neynar-sponsor", createdAt: Date.now(), mode: "live" },
  });
  if (!rec.json?.ok) die(`ABORT: the app refused the receipt: ${rec.json?.reason ?? JSON.stringify(rec.json)} — fid ${fid} exists on the network; re-run: check-before-retry records it.`);
  console.log(`recorded: ${personaId} → fid ${fid} (@${fname}), custody ${custody}, registrant/funder recorded as neynar-sponsor BY FIAT — the chain's sender is the App Wallet behind NEYNAR_WALLET_ID ...${last4(process.env.NEYNAR_WALLET_ID)}, acknowledged ${registrantAck} (A-FID-REGISTRANT-BY-FIAT, lib/fc/linkage.ts)`);
  console.log("\nDone. The spend ledger holds the itemized entries (GET /api/fc/persona, action fidSpend). Run again LATER (hours, not minutes) for a second persona.");
}

main().catch((e) => {
  if (!(e instanceof Stop)) console.error(e?.stack ?? String(e));
  process.exitCode = 1;
});
