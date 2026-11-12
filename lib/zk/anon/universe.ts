// PUBLIC GO-LIVE (the relay track) — WHICH ANONYMOUS UNIVERSE THIS SITE'S TABS POST IN, AND WHERE A POST GOES.
//
// THE HINT. The public app's server holds no key and posts nothing; the visitor's tab proves and sends. So the app tells
// every tab, through the device environment (lib/device/deviceEnv.server.ts spreads anonUniverseHints() — CHECKED names and
// values only, never a key), whether the site's anonymous posts are LIVE: ZK_ANON_UNIVERSE=live on the app (set by
// scripts/owner/arm-public-anon.ps1 once the validator's relay is armed) forwards ZK_ANON_UNIVERSE=live and ZK_MODE=live, so
// every tab proves in the live universe, loads the pinned proving files at boot (lib/zk/transport/browser.ts) and registers
// its root there at boot — every tab, uniformly, whether or not it will ever post. A value that is neither unset nor "live"
// is forwarded as "invalid", which the tab reads as NOT live (never on a guess). Unset forwards nothing (today's preview).
//
// LIVE NEEDS BOTH (lib/zk/anon/availability.ts): the hint AND the last tick's /zk/anon-post/config?mode=live saying
// liveRelay: true. The hint alone (a relay that was disarmed since, a validator that never armed) keeps today's words.
//
// PUBLIC_LIVE (onboard's live product mode, lib/platform/publicLive.ts isPublicLive): in a live product the TEST universe is
// off for anonymous posting in a tab — a live product posts no test data. Read here from the device environment
// (PUBLIC_LIVE "true", "on" or "1"); a DELIBERATE DUPLICATE of onboard's reader, which may replace it by an exact diff.
//
// IMPORTS: NONE, on purpose — availability.ts imports this file, and scripts/unit-anon-slots / unit-reach / unit-launch
// bundle lib/zk/gate.ts (which imports availability.ts) with only the registry mocked.

/** the app server's hint for every tab (names and checked values only). Exported for lib/device/deviceEnv.server.ts and
 *  scripts/unit-anon-relay.mjs. */
export function anonUniverseHints(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const raw = String(env.ZK_ANON_UNIVERSE ?? "").trim().toLowerCase();
  if (raw === "") return {};
  if (raw === "live") return { ZK_ANON_UNIVERSE: "live", ZK_MODE: "live" };
  return { ZK_ANON_UNIVERSE: "invalid" };
}

/** in a tab (or a test): did the app say this site's anonymous posts are live? Only the exact forwarded value counts */
export function liveUniverseHinted(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.ZK_ANON_UNIVERSE ?? "") === "live";
}

/** onboard's PUBLIC_LIVE product mode, as the tab sees it (see the header) */
export function publicLiveHere(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.PUBLIC_LIVE ?? "").trim().toLowerCase();
  return v === "true" || v === "on" || v === "1";
}

/** a Farcaster link for a relayed cast's network hash (DELIBERATE DUPLICATE of validator/anonpublic.js castUrlFor) */
export function castUrlFor(networkHash: unknown): string | null {
  return typeof networkHash === "string" && /^0x[0-9a-f]{40}$/.test(networkHash) ? "https://farcaster.xyz/~/conversations/" + networkHash : null;
}

export type AnonDestination = "farcaster" | "layers" | "off";

/** the sentences, exported so the route, the composer, the /anon page and the suites say (and look for) the same words */
export const DESTINATION_FARCASTER = "This post goes to Farcaster from the shared @anon account. Anyone on Farcaster or in Totem can read it, and it names no one unless you choose to reveal it later.";
export const DESTINATION_LAYERS_PREVIEW = "This post stays inside Totem on this test preview: anyone using Totem here can read it in the anonymous feed, as @anon. Nothing is posted to Farcaster.";
export const DESTINATION_LAYERS_TEST = "This post stays in the test universe: it shows as @anon in this server's Totem feed, and nothing reaches Farcaster.";
export const DESTINATION_OFF = "Anonymous posting is off here, so nothing will be posted anonymously.";
export const POSTED_LAYERS_PREVIEW = "Posted as @anon in this preview's anonymous feed. Nothing went to Farcaster.";
export const POSTED_LAYERS_TEST = "Posted as @anon in the test universe. Nothing went to Farcaster.";
/** the toast after a live post is accepted: it is proved here, sent at a random moment, and relayed at the next slot */
export function postedFarcasterSentence(withinMinutes: number): string {
  const m = Number.isFinite(withinMinutes) && withinMinutes > 0 ? Math.ceil(withinMinutes / 5) * 5 : 75;
  return `Sent to @anon. It appears on Farcaster within about ${m} minutes, at a random moment, so its time doesn't point to you.`;
}

/**
 * PURE: where a post made here would go, in words, from what availability.ts decided and the host. `on`/`previewOnly`:
 * availability; `mode`: the universe; `host`: "tab" or "server"; `liveRelay`: the last read of the validator's config;
 * `reason`: availability's sentence when off; `withinMinutes`: the timing the toast names.
 */
export function anonDestinationFor(o: { on: boolean; previewOnly: boolean; mode: "fixture" | "live"; host: "tab" | "server"; liveRelay: boolean | null; reason: string | null; withinMinutes: number }): { destination: AnonDestination; destinationSentence: string; postedSentence: string | null } {
  if (!o.on) return { destination: "off", destinationSentence: o.reason && o.reason.trim() ? o.reason : DESTINATION_OFF, postedSentence: null };
  if (o.mode === "live" && o.liveRelay === true && !o.previewOnly) return { destination: "farcaster", destinationSentence: DESTINATION_FARCASTER, postedSentence: postedFarcasterSentence(o.withinMinutes) };
  if (o.mode === "live") return { destination: "off", destinationSentence: o.reason && o.reason.trim() ? o.reason : DESTINATION_OFF, postedSentence: null };
  if (o.host === "tab") return { destination: "layers", destinationSentence: DESTINATION_LAYERS_PREVIEW, postedSentence: POSTED_LAYERS_PREVIEW };
  return { destination: "layers", destinationSentence: DESTINATION_LAYERS_TEST, postedSentence: POSTED_LAYERS_TEST };
}
