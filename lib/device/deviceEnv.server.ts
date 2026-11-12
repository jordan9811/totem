import "server-only";
// FC-READ — THE ENVIRONMENT THE BROWSER DEVICE BOOTS WITH, built in ONE place.
//
// app/(main)/layout.tsx (publicDeviceEnv, the public app group) and app/device/page.tsx (the device's own page) each
// used to spell this object out, identically. It is a client prop, so it is serialized into every page: the two
// copies had to agree forever by hand, and the relay hint below is exactly the kind of line one copy would gain and
// the other would not. Both now call deviceEnv().
//
// Every value is unchanged from those two copies (Gate 5/6, PROD-LIVE) but one: FC_READ_RELAY is "on" ONLY while the
// live-read relay is armed at this request (lib/fc/readRelay.server.ts relayArmed(): a public deployment with a
// well-formed NEYNAR_READ_API_KEY and no FC_READ=off). It is a MODE HINT, never the key: the device reads through
// POST /api/fc/read, and the server enforces the kill switch, the budget and the limits whatever a page script sets
// here (the device env is a page-settable global — the hint chooses UI, it grants nothing). DATA_SOURCE stays "": the
// relay is a third content source, not DATA_SOURCE=neynar (isLiveContent() and the rig's write guards unchanged).
// Deploying without the key leaves this object exactly as it was.
//
// PERSONA LAUNCH P1 (SIWF): siwfDeviceHints() (lib/fc/siwf/flow.ts) adds the Sign in with Farcaster hints below.
//
// The two rig flags — the debug members that expose key material to the leak greps, and the fixture provider — are
// declared only when the SERVER is a rig (research/attack-custody-1.md #1, #7; attack-custody-2.md #2). The (main)
// layout only renders this on a public deployment (never a rig); /device renders it on both.
//
// PERSONA LAUNCH P7: anonymous posting now runs IN the visitor's tab (a Web Worker proves, the web channel sends), so the
// tab must be told the deployment's two anonymous-posting facts: the switch (ZK_ANON_POST — only "on"/"off" are
// forwarded; any other value is forwarded as "invalid", which lib/zk/anon/availability.ts reads as off, never as on) and
// the relay hints (anonRelayHints below). Hints, not secrets, and CHECKED before they are served to every visitor: an
// OHTTP relay URL is forwarded only when it is https with no userinfo and no query — a URL carrying a credential or a
// token would otherwise be printed into every page.
//
// PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): and the plain anonymous tree (ZK_ANON_POST_TREE). The public preview runs
// "valid" on the app AND its validator, and the tab must prove into the tree the validator accepts — so the app forwards
// its own value, checked against the tree-name grammar (lib/zk/config.ts isPlainTreeName): a malformed value goes as
// "invalid" (the tab reads it as off, in plain words), unset sends nothing (the tab's default is the validator's default,
// tier-<ZK_GATE_TIER>). A mismatch the two services still manage (each set differently) is caught in the tab against the
// validator's own anon config (lib/zk/anon/availability.ts ANON_OFF_TREE_MISMATCH) and by smoke-deployed check 10.
// The crowd FLOOR is deliberately NOT forwarded: the tab keeps its own default (50), so no server variable can lower
// a visitor's floor.
//
// PUBLIC GO-LIVE (lib/platform/publicLive.ts): PUBLIC_LIVE=on, ONLY while this server's own isPublicLive() holds (a public
// deployment with PUBLIC_LIVE=true). The tab then runs the empty world (lib/world-flag.ts): no demo bank, the stored-state
// partition, no auto-minted personas (lib/device/boot.ts). A mode hint, never a key; absent everywhere else, so a page
// built with the flag off is byte for byte what it was.
//
// PUBLIC GO-LIVE (F1, the anonymous universe hint): anonUniverseHints() (lib/zk/anon/universe.ts) — ZK_ANON_UNIVERSE=live on
// the app (scripts/owner/arm-public-anon.ps1 sets it once the validator's @anon relay is armed) forwards ZK_ANON_UNIVERSE=live
// AND ZK_MODE=live to every tab, so every tab proves in the live universe, registers its root there at boot, and a Sign in
// with Farcaster binds the live crowd (lib/fc/siwf/flow.ts). It is spread AFTER the ZK_MODE line on purpose: its ZK_MODE
// "live" must win over the app's own ZK_MODE (fixture on the public site). This spread was missing: the hint existed, the
// arm script checked for it, and no page ever carried it (the suites injected it themselves). Unset forwards nothing (the
// object is byte for byte what it was); any other value forwards ZK_ANON_UNIVERSE=invalid (the tab reads it as NOT live).
// Checked names and values only, never a key. scripts/unit-onboarding.mjs U11 (and its mutations) and
// scripts/accept-onboard-prod.mjs O14 (the production shape, NO injection) test it.
import { validatorUrl } from "@/lib/ports";
import { relayArmed } from "@/lib/fc/readRelay.server";
import { siwfDeviceHints } from "@/lib/fc/siwf/flow";
import { isPlainTreeName } from "@/lib/zk/config";
import { publicLiveDeviceHints } from "@/lib/platform/publicLive";
import { anonUniverseHints } from "@/lib/zk/anon/universe";
import { rootPostDeviceHints } from "@/lib/fc/rootSigner/config";
import { isHostedPlatform } from "@/lib/platform/env-contract";
import { xSigninDeviceHints } from "@/lib/x/signin/config";
import { adsDeviceHints } from "@/lib/ads/switch";
import { fcSourceDeviceHints } from "@/lib/fc/source/switch";

/** SIGN IN WITH X: a refused variable's NAME is said once per process, never per page */
const xsiSaid = new Set<string>();
const sayOnce = (line: string) => {
  if (xsiSaid.has(line)) return;
  xsiSaid.add(line);
  console.warn(line);
};

/** PERSONA LAUNCH P7: the anonymous-posting switch and relay hints the browser device may be given (names + checked
 *  values only). Exported for scripts/unit-prover.mjs. */
export function anonRelayHints(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const sw = String(env.ZK_ANON_POST ?? "").trim().toLowerCase();
  if (sw === "on" || sw === "off") out.ZK_ANON_POST = sw;
  else if (sw !== "") out.ZK_ANON_POST = "invalid";
  const kind = String(env.ZK_RELAY ?? "").trim().toLowerCase();
  if (kind === "ohttp") {
    const raw = String(env.ZK_RELAY_URL ?? "").trim();
    let ok = false;
    try {
      const u = new URL(raw);
      ok = u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
    } catch {
      ok = false;
    }
    // no usable URL: the hint still says ohttp, with no URL — the tab then REFUSES to send (never a fallback to direct)
    out.ZK_RELAY = "ohttp";
    if (ok) out.ZK_RELAY_URL = raw;
    if (String(env.ZK_RELAY_THIRD_PARTY ?? "").trim() === "true") out.ZK_RELAY_THIRD_PARTY = "true";
  } else if (kind === "tor") out.ZK_RELAY = "tor";
  // anything else is "direct", exactly as lib/zk/config.ts reads it on the server (and the label then says DEMO)
  // PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the plain anonymous tree, checked (see the header)
  const tree = String(env.ZK_ANON_POST_TREE ?? "").trim();
  if (tree) out.ZK_ANON_POST_TREE = isPlainTreeName(tree) ? tree : "invalid";
  return out;
}

export function deviceEnv(): Record<string, string> {
  const rig = process.env.ZK_DEV_HOOKS === "true";
  return {
    ...(rig ? { LAYERS_DEVICE_DEBUG: "1", CUSTODY_FIXTURE_PROVIDER: "allow" } : {}),
    NODE_ENV: "production",
    VALIDATOR_URL: process.env.NEXT_PUBLIC_VALIDATOR_URL || validatorUrl(),
    KEYSTORE_DIR: "/keystore",
    LAYERS_REQUIRE_SIG: process.env.LAYERS_REQUIRE_SIG || "true",
    ZK_MODE: process.env.ZK_MODE || "fixture",
    // PUBLIC GO-LIVE (F1): the anonymous universe hint, AFTER ZK_MODE so its ZK_MODE "live" wins (see the header)
    ...anonUniverseHints(),
    // PROD-LIVE: "0" never meant off — lib/zk/config.ts clamps it to a ONE-SECOND cadence, and every tick is 12+
    // validator reads, in every open tab. The documented production default.
    ZK_PREFETCH_MS: "600000",
    ZK_DEV_HOOKS: "",
    ENABLE_WRITE: "",
    ENABLE_FC_WRITE: "",
    ENABLE_X_WRITE: "",
    ENABLE_X_READ: "",
    DATA_SOURCE: "",
    FID_ACQUIRE_ENABLED: "",
    CUSTODY_PROVIDER: process.env.CUSTODY_PROVIDER || "fixture",
    ...(relayArmed() ? { FC_READ_RELAY: "on" } : {}),
    // PERSONA LAUNCH P7: the anonymous-posting switch and the relay hints (checked: see anonRelayHints)
    ...anonRelayHints(),
    // PERSONA LAUNCH P1 (SIWF): Sign in with Farcaster runs in the tab, so the page is told how: FC_SIWF ("on", "off",
    // "fixture" on the rig, "owner" on the owner service, "bad_config" + FC_SIWF_BAD naming the refused variable) and,
    // only when set AND allowed, FC_SIWF_RELAY_URL / FC_SIWF_RPC_URL (a loopback stub, or a bare https RPC origin).
    // NAMES and checked values only: a refused value (a keyed provider URL, userinfo, a query, anything non-default on
    // a hosted platform) is never forwarded — the page is a page-settable global served to every visitor.
    ...siwfDeviceHints(),
    // PUBLIC GO-LIVE: the live-mode hint (PUBLIC_LIVE=on), only while this public server is live
    ...publicLiveDeviceHints(),
    // POST AS YOU: the Snapchain node the tab reads to check its own posting key (FC_ROOT_HUB_URL), forwarded only when
    // set AND allowed (a loopback stub or a bare https origin off a hosting platform; on one, only the default); a
    // refused value forwards FC_ROOT_POST=bad_config and no URL (lib/fc/rootSigner/config.ts rootPostDeviceHints)
    ...rootPostDeviceHints(process.env, isHostedPlatform(process.env)),
    // SIGN IN WITH X: X_SIGNIN ("on", "off", "bad_config" + X_SIGNIN_BAD naming the refused variable), the X app's PUBLIC
    // client id, and only off a hosting platform a loopback authorize URL (the tests' stub). Unset X_CLIENT_ID forwards
    // NOTHING (lib/x/signin/config.ts): the object is byte for byte what it was, and "Continue with X" says Soon.
    ...xSigninDeviceHints(process.env, sayOnce),
    // ADS, PHASE 1 (lib/ads/switch.ts): ADS=on only while this app's own ADS is on; off (the default) forwards NOTHING, so
    // the object is byte for byte what it was and no ad is placed in any tab
    ...adsDeviceHints(process.env),
    // NEYNAR AS A SWITCH (lib/fc/source/switch.ts, SECURITY-POSTURE.md §42): FC_SOURCE_FORYOU / FC_SOURCE_SEARCH, only when
    // the app's own switch asks for Neynar (neynar or auto). Following, notifications, counts and channels are never
    // forwarded: the tab has no Neynar path for them to choose. Every switch at its default forwards NOTHING (the object is
    // byte for byte what it was). A hint chooses what the tab asks for; the relay route enforces the server's own value.
    ...fcSourceDeviceHints(process.env),
  };
}
