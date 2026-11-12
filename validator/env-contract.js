"use strict";
// BROWSER KEYSTORE PASS Gate 4 — the production environment contract, CJS copy for the validator (the source of
// truth is lib/platform/env-contract.ts; the two lists are asserted identical by scripts/accept-cu4.mjs).
const MUST_NOT_SHIP = [
  "NEYNAR_API_KEY",
  "NEYNAR_SIGNER_UUID",
  "NEYNAR_WALLET_ID",
  "FC_TEST_CUSTODY_PRIVATE_KEY",
  "FC_TEST_SIGNER_UUID",
  "X_LAYERS_INBOX_TOKEN",
  // PERSONA LAUNCH P2 (BYX G0): an X developer app's credentials never ship (same entries as the app's)
  "X_API_CLIENT_ID",
  "X_API_CLIENT_SECRET",
  // CONNECT MAIN (defence in depth): the connector account's custody key and fid never ship (same entry as the app's)
  "FC_CONNECT_APP_CUSTODY_KEY",
  "FC_CONNECT_APP_FID",
  "ENABLE_WRITE",
  "ENABLE_FC_WRITE",
  "ENABLE_X_WRITE",
  "ENABLE_X_READ",
  "FID_ACQUIRE_ENABLED",
  // FC-READ: an identity pointer (the owner's real fid would expose their graph through any read that honours it)
  "NEYNAR_VIEWER_FID",
  // PERSONA LAUNCH P6 (D6 / O1): the Totem registrar wallet's key never ships (same entry as the app's; nothing reads it)
  "LAYERS_REGISTRAR_PRIVATE_KEY",
  // PERSONA LAUNCH GO-LIVE: the owner-service-only live switches and credentials (same entries, same order, as the app's)
  "X_LAYERS_API_KEY", // PERSONA LAUNCH GO-LIVE: the @totem X app's consumer key
  "X_LAYERS_API_SECRET", // PERSONA LAUNCH GO-LIVE: its consumer secret
  "X_LAYERS_ACCESS_TOKEN", // PERSONA LAUNCH GO-LIVE: the @totem account's user access token
  "X_LAYERS_ACCESS_SECRET", // PERSONA LAUNCH GO-LIVE: its access token secret
  "X_LIVE", // PERSONA LAUNCH GO-LIVE: live X outbox switch
  "X_LIVE_REPLIES", // PERSONA LAUNCH GO-LIVE: live X replies switch
  "REGISTRAR_LIVE", // PERSONA LAUNCH GO-LIVE: live registrar switch
  "REGISTRAR_WINDOW", // PERSONA LAUNCH GO-LIVE: the live registrar's batch window
];
// FC-READ — VALIDATOR-ONLY REFUSALS. The public live-read relay's key belongs on the public APP service alone (its one
// reader is lib/fc/readRelay.server.ts); the validator has no read path at all, so on a public deployment the key's
// presence here can only mean a shared or project-level variable that reached the wrong service. The app does NOT
// refuse it, which is why this is a separate list: the app and validator lists above are asserted identical by
// scripts/accept-cu4.mjs (which slices this file's text at the first mention of the shared list's name, so this
// list's name must never contain it, and it must stay below that array).
const VALIDATOR_REFUSES = [
  "NEYNAR_READ_API_KEY",
];
// PUBLIC GO-LIVE (the relay track) — THE ONE RELAY CREDENTIAL THE PUBLIC VALIDATOR ACCEPTS. These names are deliberately on
// NEITHER list above: the public validator may hold exactly the anon agent's account (its fid, its signer, the key of a
// Neynar app that holds nothing else) and the relay's switch, and nothing else that writes (validator/anonpublic.js
// relayAccount refuses to arm beside NEYNAR_API_KEY or NEYNAR_SIGNER_UUID, which this contract refuses to boot with anyway).
// The public APP refuses the signer and the key outright (lib/platform/env-contract.ts APP_ONLY_REFUSES): the app server
// stays keyless. Exported for scripts/accept-cu4.mjs (the near misses, both ways) and validator/test/anonpublic.test.js;
// the list's name must never contain the shared list's name (accept-cu4 slices this file at it).
// THE HUB ROUTE: FC_ANON_SIGNER_KEY (the anon account's own Ed25519 signer key) is the hub transport's one relay credential, here too.
const RELAY_ACCEPTED = Object.freeze(["FC_ANON_FID", "FC_ANON_SIGNER_UUID", "FC_ANON_NEYNAR_KEY", "FC_ANON_SIGNER_KEY", "ZK_ANON_RELAY_LIVE"]);
// POST AS YOU — TOTEM'S APP ACCOUNT, ON THE PUBLIC VALIDATOR ONLY. FC_APP_CUSTODY_KEY signs SignedKeyRequests for visitors'
// own keys (validator/keyrequest.js) and nothing else here; this process holds no signer (the app account's one signer, the
// profile key behind @ontotem, stays on the owner's laptop), and the custody can never add a key to a visitor's account. The
// public APP refuses it at boot (lib/platform/env-contract.ts APP_ONLY_REFUSES); FC_APP_FID is a public account number.
// On NEITHER list above, like the relay's names (this list's name must never contain the shared list's name either).
const APP_ACCOUNT_ACCEPTED = Object.freeze(["FC_APP_FID", "FC_APP_CUSTODY_KEY", "FC_APP_SPONSOR", "FC_KEY_REQUEST_API_URL", "FC_KEY_REQUEST_TTL_SEC"]);
// SIGN IN WITH X — THE RELAY'S NAMES, ON THE PUBLIC VALIDATOR (validator/xsignin.js): X_CLIENT_ID (the X app's public OAuth 2.0
// client id), X_CLIENT_SECRET (only for a confidential X app; the public APP refuses it: lib/platform/env-contract.ts
// APP_ONLY_REFUSES), X_SIGNIN (the kill switch) and X_SIGNIN_API_URL (a test stub's base, loopback off a hosting platform).
// On NEITHER list above. Not the owner service's X_API_CLIENT_ID / X_API_CLIENT_SECRET, which stay must-not-ship everywhere
// public (this list's name must never contain the shared list's name either).
const X_SIGNIN_ACCEPTED = Object.freeze(["X_CLIENT_ID", "X_CLIENT_SECRET", "X_SIGNIN", "X_SIGNIN_API_URL"]);
const OFF = new Set(["", "false", "0", "no", "off"]);

function isPublicDeployment(env = process.env) {
  return env.NODE_ENV === "production" && env.ZK_DEV_HOOKS !== "true";
}
function contractViolations(env = process.env) {
  const out = [];
  for (const name of MUST_NOT_SHIP) {
    const v = env[name];
    if (v !== undefined && !OFF.has(String(v).trim().toLowerCase())) out.push(name);
  }
  // FC-READ: the validator-only list, same rule, names only
  for (const name of VALIDATOR_REFUSES) {
    const v = env[name];
    if (v !== undefined && !OFF.has(String(v).trim().toLowerCase())) out.push(name);
  }
  // PROD-LIVE (D-PRODLIVE-OWNER-SERVICE): "neynar" is the value that turns live content on (the app's
  // lib/adapters/neynar/mode.ts); the old check only knew "live". Both are refused, in both copies.
  const ds = String(env.DATA_SOURCE || "").trim().toLowerCase();
  if (ds === "live" || ds === "neynar") out.push("DATA_SOURCE=" + ds);
  // the MUST-BE-SET half (attack-custody-1 #5, -2 #6, -3 #3) and the rig-only fixture provider (attack-custody-1 #1)
  if (env.LAYERS_REQUIRE_SIG !== "true") out.push("LAYERS_REQUIRE_SIG!=true");
  if (String(env.CUSTODY_PROVIDER || "fixture").trim().toLowerCase() === "fixture" && env.CUSTODY_FIXTURE_PROVIDER === "allow") out.push("CUSTODY_FIXTURE_PROVIDER=allow");
  return out;
}

// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — a DEV_HOOKS validator on a hosting platform. The rig validator answers
// unsigned reads of state, unsigned rep events and unsigned root registration (validator/server.js: they resolve to
// the rig's own anchor) — which is exactly notes/runbooks/PREVIEW-READINESS.md §3's list of what makes a validator "not a public
// server". The owner service runs one anyway, because it is the rig; so on a hosted platform it boots only when the
// owner has declared it private (LAYERS_PRIVATE_NETWORK_ONLY=true: no public domain, reachable only by the owner app
// over the platform's private network) AND the platform itself reports no public domain or TCP proxy for it.
// DELIBERATE DUPLICATE of isHostedPlatform() in lib/platform/env-contract.ts.
function isHostedPlatform(env = process.env) {
  const railway = ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"].some((n) => !!String(env[n] || "").trim());
  return railway || String(env.LAYERS_HOSTED || "").trim().toLowerCase() === "true";
}
/** the reasons a rig-shaped validator on a hosted platform must not boot (names only, never values) */
function hostedRigViolations(env = process.env) {
  const out = [];
  if (env.LAYERS_PRIVATE_NETWORK_ONLY !== "true") out.push("LAYERS_PRIVATE_NETWORK_ONLY!=true (a hosted dev-hooks validator must be private-network only)");
  // the platform tells the service its own public exposure; either one means strangers can reach the dev hooks
  if (String(env.RAILWAY_PUBLIC_DOMAIN || "").trim()) out.push("RAILWAY_PUBLIC_DOMAIN is set (a public domain is attached to this validator — remove it)");
  if (String(env.RAILWAY_TCP_PROXY_DOMAIN || "").trim()) out.push("RAILWAY_TCP_PROXY_DOMAIN is set (a TCP proxy exposes this validator — remove it)");
  return out;
}

/** call at boot: refuses a public deployment with a poisoned environment (names only, never values) */
function enforceBootContract(log = console) {
  if (!isPublicDeployment()) {
    // attack-custody-2 #15: a production build WITH the dev hooks is a rig, and says so at boot — never silently
    if (process.env.NODE_ENV === "production") log.warn("[validator] RIG MODE: NODE_ENV=production with ZK_DEV_HOOKS=true — dev hooks are open, the environment contract is not enforced; this is not a public deployment");
    if (isHostedPlatform()) {
      const hosted = hostedRigViolations();
      if (hosted.length) {
        log.error("[validator] REFUSING TO START a dev-hooks validator on a hosted platform → " + hosted.join("; "));
        log.error("[validator] the owner validator gets NO public domain; set LAYERS_PRIVATE_NETWORK_ONLY=true once it has none (notes/runbooks/GO-LIVE-FARCASTER.md).");
        process.exit(78); // EX_CONFIG
      }
      log.log("[validator] OWNER SERVICE: hosted dev-hooks validator, private network only (D-PRODLIVE-OWNER-SERVICE)");
    }
    return;
  }
  const bad = contractViolations();
  if (bad.length === 0) {
    log.log("[validator] production environment contract: clean");
    return;
  }
  log.error("[validator] REFUSING TO START a public deployment: must-not-ship variables are set → " + bad.join(", "));
  process.exit(78);
}

// PROD-LIVE: `node validator/env-contract.js` runs the same check as a standalone step, so the owner validator's
// container refuses BEFORE the supervisor starts (the supervisor restarts on any exit, 78 included, so a refusal
// inside it would loop quietly instead of failing the deployment). Exit 0 = the environment may boot.
if (require.main === module) enforceBootContract(console);

module.exports = { MUST_NOT_SHIP, VALIDATOR_REFUSES, RELAY_ACCEPTED, APP_ACCOUNT_ACCEPTED, X_SIGNIN_ACCEPTED, isPublicDeployment, contractViolations, enforceBootContract, isHostedPlatform, hostedRigViolations };
