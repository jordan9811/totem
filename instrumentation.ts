// BROWSER KEYSTORE PASS Gate 4 — the app server's boot check (the production environment contract).
//
// Runs once when the Next server starts (next.config enables the instrumentation hook). A PUBLIC deployment — a
// production build without the dev hooks — refuses to start if any must-not-ship variable is set: a live network
// credential the preview must not carry, or a switch that would turn a live path on. It names the variables and
// never their values, then exits non-zero so the deployment fails loudly instead of serving with a key on board.
//
// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE): a RIG-shaped server (ZK_DEV_HOOKS=true: it holds the owner's keystore) on a
// HOSTED platform is the owner service, and it refuses to start unless it can never come up open — an owner access
// secret for middleware.ts's gate, and a validator reached at a private address (lib/platform/env-contract.ts
// hostedRigViolations). The laptop rig sets no hosting variable, so it boots exactly as before.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // OWNER PASSKEYS (D-OWNER-PASSKEYS): load the owner gate's volume-backed state source once, at boot, so it is
  // registered for every server component and route in this process (ownerSessionRefused reads it when a caller
  // passes none — app/help/page.tsx does). A POSITIVE runtime check of its own, so the Edge build of this file drops
  // the import (and its node:fs) entirely, whatever the early return above compiles to. Inert without a secret.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const store = await import("./lib/platform/owner-store.server");
    const { ownerSessionDays, readOwnerSecret } = await import("./lib/platform/owner-access");
    const { ownerRelyingParty } = await import("./lib/platform/owner-passkeys.server");
    if (readOwnerSecret()) {
      const rp = ownerRelyingParty();
      console.log(
        `[boot] OWNER GATE: sessions last ${ownerSessionDays()} days per device; Face ID / fingerprint sign-in ` +
          (rp ? `on (RP ID ${rp.rpId}); passkeys kept at ${store.ownerStateFile()}` : "OFF — APP_URL is unset or not an https address (the passphrase still works)")
      );
    }
  }
  const { contractViolations, hostedRigViolations, isHostedPlatform, isPublicDeployment, ownerSecretProblem } = await import("./lib/platform/env-contract");
  // LAYERS_WORLD (lib/world.ts): "empty" or unset, nothing else — a typo must never leave the demo world showing on a
  // service its owner believes is clean. On a PUBLIC deployment the flag is refused outright: the server holds no
  // identity there and the browser device never reads it, so it would be a silent no-op that claims otherwise.
  const { worldProblem, strictStateReason } = await import("./lib/world-flag");
  const badWorld = worldProblem();
  if (badWorld) {
    console.error("[boot] REFUSING TO START → " + badWorld);
    process.exit(78); // EX_CONFIG
  }
  // review WE-6: the state read's shape is said with the world — fail-closed on the owner service whatever the flag
  // says (rolling the flag back keeps it), fail-open to the fixture seed on a laptop rig and the public preview
  const strict = strictStateReason();
  const reads = strict ? `; state reads FAIL CLOSED (${strict})` : "; state reads fall back to the fixture seed when the validator cannot be read (laptop rig / public preview)";
  // PUBLIC GO-LIVE (lib/platform/publicLive.ts): PUBLIC_LIVE is "true", "false" or unset on a public deployment — any
  // other value refuses boot (names and a length class only), exactly like LAYERS_WORLD; on a rig-shaped process (the
  // laptop rig, the owner service) it is ignored, and said
  const { publicLiveBootProblem, isPublicLive, PUBLIC_LIVE_WORLD_LINE } = await import("./lib/platform/publicLive");
  const liveProblem = publicLiveBootProblem();
  if (liveProblem && "refuse" in liveProblem) {
    console.error("[boot] REFUSING TO START → " + liveProblem.refuse);
    process.exit(78); // EX_CONFIG
  }
  if (liveProblem && "warn" in liveProblem) console.warn("[boot] " + liveProblem.warn);
  // ADS, PHASE 1 (lib/ads/switch.ts): ads ship dormant. ADS=on turns them on; anything but on/off/unset stays OFF, said
  // by name and a length class only
  const { adsBootWarning, adsSwitchValue } = await import("./lib/ads/switch");
  const adsWarn = adsBootWarning(process.env);
  if (adsWarn) console.warn("[boot] " + adsWarn);
  else console.log("[boot] ADS: " + (adsSwitchValue(process.env) === "on" ? "on (house ads placed by each visitor's device)" : "off (dormant: no ad on any feed)"));
  // NEYNAR AS A SWITCH (lib/fc/source/switch.ts, SECURITY-POSTURE.md §42): where each Farcaster surface reads from. A
  // refused value (neynar/auto for Following, notifications or counts: the hard rule) and an unknown one are said here by
  // name and value class (an unknown value by its length only), and read as network; the boot goes on (never an outage)
  // (a POSITIVE runtime check, like the owner store's above: the relay module reads node:crypto, so the Edge build of this
  // file must drop the import entirely)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { fcSourceBootLines } = await import("./lib/fc/source/switch");
    const { relayArmed } = await import("./lib/fc/readRelay.server");
    const fcSources = fcSourceBootLines(process.env, relayArmed());
    for (const w of fcSources.warn) console.warn("[boot] " + w);
    console.log("[boot] " + fcSources.info);
  }
  if (process.env.LAYERS_WORLD === "empty" && isPublicDeployment()) {
    // checked BEFORE the live line: PUBLIC_LIVE=true never excuses LAYERS_WORLD=empty on a public deployment
    console.error("[boot] REFUSING TO START a public deployment with LAYERS_WORLD=empty — the empty world is a rig-shaped (owner service) mode; the public device's world is the visitor's own already");
    process.exit(78); // EX_CONFIG
  }
  if (isPublicLive()) {
    // the server holds no identity here: the device in each visitor's tab runs the empty world (lib/world-flag.ts)
    console.log(PUBLIC_LIVE_WORLD_LINE);
  } else if (process.env.LAYERS_WORLD === "empty") {
    console.log("[boot] WORLD: empty (LAYERS_WORLD=empty) — no seed/fixture personas, posts, feeds or demo content are shown; stored demo rows are hidden, never deleted" + reads);
  } else {
    // review WORLD-GUARD-6: the resolved mode is ALWAYS said — on every shape of server, so a service its owner believes
    // is clean but that booted the demo world shows it in the first boot line, not only in what it renders
    console.log("[boot] WORLD: demo (LAYERS_WORLD absent) — the seeded demo world is shown" + reads);
  }
  if (!isPublicDeployment()) {
    // attack-custody-2 #15: a production build WITH the dev hooks is a rig, and says so at boot — never silently
    if (process.env.NODE_ENV === "production") console.warn("[boot] RIG MODE: NODE_ENV=production with ZK_DEV_HOOKS=true — dev hooks are open, the environment contract is not enforced; this is not a public deployment");
    if (isHostedPlatform()) {
      const hosted = hostedRigViolations();
      if (hosted.length) {
        console.error("[boot] REFUSING TO START a rig-shaped server on a hosted platform → " + hosted.join("; "));
        console.error("[boot] a hosted rig is the owner service: it needs OWNER_ACCESS_SECRET (16+ characters) and a private validator (notes/runbooks/GO-LIVE-FARCASTER.md). Values were not read beyond presence and length.");
        process.exit(78); // EX_CONFIG
      }
      console.log("[boot] OWNER SERVICE: hosted rig, owner access gate armed, validator on the private network (D-PRODLIVE-OWNER-SERVICE)");
    }
    return;
  }
  const bad = contractViolations();
  // PROD-LIVE: an owner gate may also front a PUBLIC deployment (a preview behind a passphrase). A secret that is set
  // but too short would arm a gate no passphrase can open — refuse that loudly rather than serve a locked door.
  const owner = process.env.OWNER_ACCESS_SECRET ? ownerSecretProblem() : null;
  if (owner) bad.push(owner);
  if (bad.length === 0) {
    console.log("[boot] production environment contract: clean");
    return;
  }
  console.error("[boot] REFUSING TO START a public deployment: must-not-ship variables are set → " + bad.join(", "));
  console.error("[boot] unset them (or run with ZK_DEV_HOOKS=true on a rig). Values were not read beyond presence.");
  process.exit(78); // EX_CONFIG
}
