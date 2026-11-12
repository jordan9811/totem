// BROWSER KEYSTORE PASS Gate 4 — THE PRODUCTION ENVIRONMENT CONTRACT (the readiness audit's must-not-ship keys).
//
// A PUBLIC deployment is a production build without the dev hooks. In that shape the app server holds no identity
// and performs no live write, so every variable below is either a live credential the preview must not carry or a
// switch that would turn a live path on. The boot check (instrumentation.ts) refuses to start with any of them set;
// the validator has the same list in CJS (validator/env-contract.js). Names only — values are never logged.
export const MUST_NOT_SHIP: readonly string[] = [
  // live network credentials
  "NEYNAR_API_KEY",
  "NEYNAR_SIGNER_UUID",
  "NEYNAR_WALLET_ID",
  "FC_TEST_CUSTODY_PRIVATE_KEY",
  "FC_TEST_SIGNER_UUID",
  "X_LAYERS_INBOX_TOKEN",
  // PERSONA LAUNCH P2 (BYX G0): an X developer app's credentials. Nothing on a public deployment may hold them — live
  // X OAuth and live X sync are not built, and lib/x/sync.ts refuses to run at all while a client id is set.
  "X_API_CLIENT_ID",
  "X_API_CLIENT_SECRET",
  // CONNECT MAIN (defence in depth): the connector account's custody key and its fid (lib/fc/connect.ts reads both
  // by name on the owner service only). The connect route refuses on a public deployment anyway; a public process
  // that carries a custody key, or the pointer that says which account is Totem's connector, refuses to boot.
  "FC_CONNECT_APP_CUSTODY_KEY",
  "FC_CONNECT_APP_FID",
  // switches that turn a live path on
  "ENABLE_WRITE",
  "ENABLE_FC_WRITE",
  "ENABLE_X_WRITE",
  "ENABLE_X_READ",
  "FID_ACQUIRE_ENABLED",
  // FC-READ: an identity pointer, not a credential. With it set to the owner's real fid, any live read that honours it
  // (the following feed, notifications, viewer_fid) exposes the owner's graph, mutes and blocks to every visitor. The
  // public live-read relay never sends a fid it did not resolve itself, and this refuses the pointer outright on a
  // public deployment whatever fid it names; on the owner service (a rig shape) it stays legitimate and gated.
  "NEYNAR_VIEWER_FID",
  // PERSONA LAUNCH P6 (D6 / O1): the Totem registrar wallet's key — the account that will pay Farcaster's Bundler for
  // launched persona accounts. Nothing reads it this wave (the registrar is SIMULATED); a public process carrying it
  // refuses to boot, so the key can only ever live on the service the owner arms for it.
  "LAYERS_REGISTRAR_PRIVATE_KEY",
  // PERSONA LAUNCH GO-LIVE: the owner-service-only live switches and credentials of the live X transport and the live
  // registrar. PUBLIC GO-LIVE: both tracks are PARKED (SECURITY-POSTURE §29/§30): nothing in this build reads these names
  // and no script sets them. They stay here so a public process that carries any of them still refuses to boot (the
  // public server stays keyless, and nothing on it may turn a live path on). Same order in validator/env-contract.js
  // (scripts/accept-cu4.mjs asserts the two lists identical).
  "X_LAYERS_API_KEY", // PERSONA LAUNCH GO-LIVE: the @totem X app's consumer key (live X outbox)
  "X_LAYERS_API_SECRET", // PERSONA LAUNCH GO-LIVE: its consumer secret
  "X_LAYERS_ACCESS_TOKEN", // PERSONA LAUNCH GO-LIVE: the @totem account's user access token
  "X_LAYERS_ACCESS_SECRET", // PERSONA LAUNCH GO-LIVE: its access token secret
  "X_LIVE", // PERSONA LAUNCH GO-LIVE: the switch that sends approved X copies to the real X API
  "X_LIVE_REPLIES", // PERSONA LAUNCH GO-LIVE: the switch for live X replies
  "REGISTRAR_LIVE", // PERSONA LAUNCH GO-LIVE: the switch that lets the registrar submit real Bundler transactions
  "REGISTRAR_WINDOW", // PERSONA LAUNCH GO-LIVE: the live registrar's batch window (only meaningful once armed)
];

/**
 * PUBLIC GO-LIVE (the relay track) — THE APP-ONLY REFUSALS. The public @anon's ONE relay credential — the anon agent's
 * signer and the key of a Neynar app that holds nothing else — belongs on the public VALIDATOR alone (validator/anonpublic.js
 * relayAccount, armed by scripts/owner/arm-public-anon.ps1). The public APP server stays keyless, so a public app process
 * that carries either refuses to boot, named and never valued. The validator does NOT refuse them (it is where they live),
 * which is why this is its own list, below the shared one: scripts/accept-cu4.mjs slices this file at the shared list's name
 * (so this list's name must never contain it) and holds the shared lists of both files identical. FC_ANON_FID is not here:
 * it is a public account number, not a credential (the owner service's app keeps it for the main-vs-anon guard).
 */
export const APP_ONLY_REFUSES: readonly string[] = [
  "FC_ANON_SIGNER_UUID", // PUBLIC GO-LIVE: the anon agent's signer (validator only)
  "FC_ANON_NEYNAR_KEY", // PUBLIC GO-LIVE: the agent-only Neynar app's key (validator only)
  "FC_ANON_SIGNER_KEY", // THE HUB ROUTE: the anon account's own Ed25519 signer key (validator only)
  "FC_APP_CUSTODY_KEY", // POST AS YOU: Totem's app account custody key, which signs key requests (validator only)
  "X_CLIENT_SECRET", // SIGN IN WITH X: a confidential X app's client secret, used by the validator's relay only (X_CLIENT_ID is public and stays allowed)
];

/** values that mean "off" for a switch: unset, empty, "false", "0" */
const OFF = new Set(["", "false", "0", "no", "off"]);

export function isPublicDeployment(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && env.ZK_DEV_HOOKS !== "true";
}

/** the names (never the values) that violate the contract in this environment */
export function contractViolations(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const name of MUST_NOT_SHIP) {
    const v = env[name];
    if (v !== undefined && !OFF.has(v.trim().toLowerCase())) out.push(name);
  }
  // PUBLIC GO-LIVE: the app-only list, same rule, names only (the relay credential is the validator's, never the app's)
  for (const name of APP_ONLY_REFUSES) {
    const v = env[name];
    if (v !== undefined && !OFF.has(v.trim().toLowerCase())) out.push(name);
  }
  // PROD-LIVE (D-PRODLIVE-OWNER-SERVICE): the check named "live", but the value that turns live content on is
  // "neynar" (lib/adapters/neynar/mode.ts dataSource()), so DATA_SOURCE=neynar sailed through the contract. Both
  // spellings are refused now; the value is a mode name, not a secret, so naming it is safe.
  const ds = (env.DATA_SOURCE ?? "").trim().toLowerCase();
  if (ds === "live" || ds === "neynar") out.push("DATA_SOURCE=" + ds);
  // the MUST-BE-SET half (attack-custody-1 #5, -2 #6, -3 #3): signed envelopes are the whole validator posture, and
  // the fixture custody provider is a rig adapter whose key is a public function of the subject (attack-custody-1 #1)
  if (env.LAYERS_REQUIRE_SIG !== "true") out.push("LAYERS_REQUIRE_SIG!=true");
  if ((env.CUSTODY_PROVIDER || "fixture").trim().toLowerCase() === "fixture" && env.CUSTODY_FIXTURE_PROVIDER === "allow") out.push("CUSTODY_FIXTURE_PROVIDER=allow");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — THE OWNER SERVICE'S BOOT RULES.
//
// The owner service is the one named, scoped exception to D-CUSTODY-ONE-RULE: a SEPARATE app + validator pair in
// RIG shape (ZK_DEV_HOOKS=true: the server holds the owner's keystore on a volume, exactly as the rig laptop does)
// so the owner's personas can hold real Farcaster accounts and publish real casts. The rig shape on the open
// internet is precisely what notes/runbooks/PREVIEW-READINESS.md §1 measured as "every visitor IS the owner", so a rig process on a
// HOSTED platform is allowed to boot only when:
//   - OWNER_ACCESS_SECRET is set (16+ characters): middleware.ts then refuses every page and route to anyone without
//     the owner's session cookie (the "single-tester demo behind an access secret" notes/runbooks/PREVIEW-READINESS.md names);
//   - its validator is reached at a PRIVATE address (the owner validator has no public domain; the app reaches it
//     over the platform's private network), and the browser is never told a validator address at all.
// On the laptop rig nothing here applies: no hosting variable is set, so every suite runs exactly as before.

/** the minimum length of the owner's access passphrase (the runbook generates 32 random bytes, base64) */
export const OWNER_SECRET_MIN_LENGTH = 16;

/** true on a hosting platform: Railway injects its own variables into every deployment; LAYERS_HOSTED=true says so
 *  anywhere else. The laptop rig sets none of them. */
export function isHostedPlatform(env: Record<string, string | undefined> = process.env): boolean {
  const railway = ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"].some((n) => !!(env[n] ?? "").trim());
  return railway || (env.LAYERS_HOSTED ?? "").trim().toLowerCase() === "true";
}

/** what is wrong with the owner access secret, or null when it is usable (never the value — a length class only) */
export function ownerSecretProblem(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.OWNER_ACCESS_SECRET ?? "").trim(); // trimmed exactly as lib/platform/owner-access.ts reads it
  if (raw === "") return "OWNER_ACCESS_SECRET is unset";
  if (raw.length < OWNER_SECRET_MIN_LENGTH) return `OWNER_ACCESS_SECRET is shorter than ${OWNER_SECRET_MIN_LENGTH} characters`;
  return null;
}

/** a host that is only reachable from inside a private network: the platform's internal DNS, a single-label service
 *  name (compose/k8s), loopback, or an RFC 1918 / ULA literal. Anything else is treated as public — fail closed. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h.startsWith("127.")) return true;
  if (h.endsWith(".railway.internal") || h.endsWith(".internal")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // a single-label service name
  if (/^10\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // IPv6 unique-local
  return false;
}

/** the reasons a rig-shaped APP on a hosted platform must not boot (names and classes only, never values) */
export function hostedRigViolations(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const secret = ownerSecretProblem(env);
  if (secret) out.push(secret);
  const vurl = (env.VALIDATOR_URL ?? "").trim();
  if (!vurl) out.push("VALIDATOR_URL is unset (the owner app must name its private validator)");
  else {
    let host = "";
    try {
      host = new URL(vurl).hostname;
    } catch {
      out.push("VALIDATOR_URL is not a URL");
    }
    if (host && !isPrivateHost(host)) out.push("VALIDATOR_URL names a public host (the owner validator must be reached over the private network)");
  }
  if ((env.NEXT_PUBLIC_VALIDATOR_URL ?? "").trim()) out.push("NEXT_PUBLIC_VALIDATOR_URL is set (a hosted rig never tells the browser where its validator is)");
  return out;
}
