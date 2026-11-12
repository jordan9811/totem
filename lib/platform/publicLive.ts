// PUBLIC GO-LIVE — THE PUBLIC SITE IS THE PRODUCT: the "live" mode switch.
//
// The owner's direction (2026-10-17): the public site is where people sign in with Farcaster, save with a passkey,
// make personas and post. In live mode the public site shows no demo world: no fixture people, posts, trends, curators
// or desks. The home feed is live Farcaster reads (the read relay, when the owner has armed it), the visitor's own
// personas' posts and the @anon posts. Nothing is deleted: stored demo rows are hidden (lib/world.ts's partition, run in
// the visitor's tab), and a database that is already seeded is never rewritten (validator/seed.js).
//
// Where the flag is read, and what it means there:
//   - THE PUBLIC SERVER (a production build without the dev hooks): PUBLIC_LIVE=true turns it on. PUBLIC_LIVE=false or
//     an empty or absent variable leaves it off. ANY OTHER VALUE refuses boot (instrumentation.ts), with the variable's
//     NAME and a length class only, like LAYERS_WORLD: a typo ("True", "yes", "on") must never leave the demo world
//     showing on a site its owner believes is live.
//   - THE VISITOR'S BROWSER DEVICE: the device env value PUBLIC_LIVE === "on". lib/device/deviceEnv.server.ts forwards it
//     only while the server's own isPublicLive() is true, so a page script cannot turn the server's mode on (it can
//     only hide its own demo world from itself, which grants nothing).
//   - THE RIG AND THE OWNER SERVICE (ZK_DEV_HOOKS=true): always false. A set variable there is a boot WARNING, never a
//     mode: every rig suite and the owner's service keep running exactly as before.
//
// This file imports NOTHING: lib/world-flag.ts reads it, and the instrumentation hook (compiled for the edge runtime
// too) reads that. isPublicShape below is a DELIBERATE DUPLICATE of lib/platform/env-contract.ts isPublicDeployment
// (that file is server-only in spirit and grows); scripts/unit-onboarding.mjs pins the two equal over a matrix.

type Env = Record<string, string | undefined>;

export const PUBLIC_LIVE_ENV = "PUBLIC_LIVE";
/** the device env value the server forwards while live (never "true": the two halves are told apart in a log) */
export const PUBLIC_LIVE_DEVICE_VALUE = "on";

/** DELIBERATE DUPLICATE of lib/platform/env-contract.ts isPublicDeployment (pinned by scripts/unit-onboarding.mjs) */
export function isPublicShape(env: Env): boolean {
  return env.NODE_ENV === "production" && env.ZK_DEV_HOOKS !== "true";
}

function processEnv(): Env {
  // the browser device's process shim (lib/device/shims/process.ts) or Node's; a Next client bundle has an empty one
  try {
    return (typeof process !== "undefined" && process.env ? process.env : {}) as Env;
  } catch {
    return {};
  }
}

/**
 * Is public live mode on HERE? The server: a public deployment with PUBLIC_LIVE=true. The browser device: the env the
 * server handed it says PUBLIC_LIVE=on. A Next client component reads false (its process.env carries no such name):
 * client components take the mode as a prop from their server render instead (the (main) layout hands it to Providers).
 */
export function isPublicLive(env: Env = processEnv()): boolean {
  if (typeof window !== "undefined") return (env.PUBLIC_LIVE ?? "") === PUBLIC_LIVE_DEVICE_VALUE;
  return isPublicShape(env) && env.PUBLIC_LIVE === "true";
}

/** the variable's value class: unset/empty/"false" = off, "true" = on, anything else = refused */
export function publicLiveValue(env: Env = processEnv()): "off" | "on" | "bad" {
  const v = env.PUBLIC_LIVE;
  if (v === undefined || v === "" || v === "false") return "off";
  if (v === "true") return "on";
  return "bad";
}

/**
 * What the boot must say about PUBLIC_LIVE on this server process (names and a length class only, never the value):
 *   { refuse } — a public deployment with a value other than true/false/empty: boot stops (exit 78, EX_CONFIG);
 *   { warn }   — a rig-shaped process (the laptop rig, the owner service) with the variable set: it is ignored there;
 *   null       — nothing to say.
 */
export function publicLiveBootProblem(env: Env = processEnv()): { refuse: string } | { warn: string } | null {
  const cls = publicLiveValue(env);
  const v = env.PUBLIC_LIVE;
  if (!isPublicShape(env)) {
    if (v === undefined || v === "") return null;
    return { warn: "PUBLIC_LIVE is set on a rig-shaped process (ZK_DEV_HOOKS=true); it is ignored here: live mode is for the public site only" };
  }
  if (cls === "bad") return { refuse: `PUBLIC_LIVE must be "true", "false" or unset (got a value of ${String(v).length} character(s))` };
  return null;
}

/** the boot line for the world this public process shows (instrumentation.ts) */
export const PUBLIC_LIVE_WORLD_LINE =
  "[boot] WORLD: live (PUBLIC_LIVE=true): no demo people, posts, trends, curators or desks on this site; the home feed is live Farcaster reads (when armed), the visitor's own personas' posts and @anon posts; stored demo rows are hidden in each visitor's tab, never deleted";

/** what the server forwards to every visitor's browser device: PUBLIC_LIVE=on while live, nothing otherwise */
export function publicLiveDeviceHints(env: Env = processEnv()): Record<string, string> {
  return isPublicLive(env) ? { PUBLIC_LIVE: PUBLIC_LIVE_DEVICE_VALUE } : {};
}
