// LAYERS_WORLD — the FLAG half of lib/world.ts, with ONE import that itself imports nothing (lib/platform/publicLive.ts):
// instrumentation.ts reads it at boot, and the instrumentation hook is also compiled for the edge runtime, where
// lib/world.ts's keystore import (node:fs, node:path) cannot be bundled. lib/world.ts re-exports everything here; read
// that file for what the flag does.
//
// PUBLIC GO-LIVE (public live mode, lib/platform/publicLive.ts): the public site is the product, and in live mode it
// shows no demo world. Two places take the empty world's machinery there, both read at module load:
//   - THE VISITOR'S BROWSER DEVICE (window defined): isEmptyWorld() is true when the device env says PUBLIC_LIVE=on. The
//     device then runs exactly the empty world the owner service runs (it is the same rig-shaped code with a keystore):
//     the bank is not loaded, the demo seeders do not run, the stored-state partition hides every stored row that names
//     a persona this device's keystore did not mint (never deleted), and the state read is fail-closed. loadDevice.ts
//     declares the device env BEFORE device.js evaluates, so bank() below sees the flag at module load.
//   - THE PUBLIC SERVER (no window): isEmptyWorld() stays LAYERS_WORLD's (which a public deployment refuses), but bank()
//     takes the empty twin under isPublicLive(): the server-rendered right rail (trends, news, live rooms, who to follow)
//     then renders nothing from the fixture bank.
// With PUBLIC_LIVE off (the rig, the owner service, today's public preview, every existing suite) nothing here changes.
import { isPublicLive } from "./platform/publicLive";

export const WORLD_ENV = "LAYERS_WORLD";

/** The empty world is on: LAYERS_WORLD=empty on a server process, or (PUBLIC GO-LIVE) public live mode in the visitor's
 *  browser device. Read at call time (the flag is set per process; the device's env is fixed at its load). */
export function isEmptyWorld(): boolean {
  if (typeof window !== "undefined") return isPublicLive();
  return process.env.LAYERS_WORLD === "empty";
}

/** The world this process resolved to — what the boot line says (review WORLD-GUARD-6: always said, so a service its
 *  owner believes is clean but that booted the demo world shows it in its first lines). "demo" only when the variable
 *  is ABSENT; a set-but-wrong value is a boot refusal (worldProblem), never a world. */
export function worldMode(): "empty" | "demo" {
  return isEmptyWorld() ? "empty" : "demo";
}

/** A value the boot must refuse: anything set that is not "empty". A typo ("Empty", "none") must never silently
 *  leave the demo world showing on a service its owner believes is clean — and neither may a variable that is
 *  PRESENT BUT EMPTY (review WORLD-GUARD-6: `LAYERS_WORLD=` piped in from a missing local value read as "unset" and
 *  booted the demo world with no refusal and no boot line). Only an ABSENT variable means the demo world. */
export function worldProblem(): string | null {
  const v = process.env.LAYERS_WORLD;
  if (v === undefined || v === "empty") return null;
  if (v === "") return 'LAYERS_WORLD is set but EMPTY — delete the variable for the demo world, or set it to "empty"';
  return `LAYERS_WORLD must be "empty" or unset (got a value of ${v.length} character(s))`;
}

/** A RIG-shaped process (ZK_DEV_HOOKS=true: it holds a keystore) on a HOSTED platform — the owner service's shape
 *  (lib/platform/env-contract.ts isHostedPlatform, inlined here because this file may import nothing: Railway's own
 *  variables, or LAYERS_HOSTED=true anywhere else). Such a process cannot boot without the owner secret
 *  (instrumentation.ts), so this is a second, independent reading of the same fact — a belt for the secret's braces. */
export function isHostedRig(): boolean {
  if (typeof window !== "undefined") return false;
  if (process.env.ZK_DEV_HOOKS !== "true") return false;
  const hosted =
    ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"].some((n) => (process.env[n] ?? "").trim() !== "") ||
    (process.env.LAYERS_HOSTED ?? "").trim().toLowerCase() === "true";
  return hosted;
}

/**
 * The OWNER SERVICE: a server process behind the owner access gate (OWNER_ACCESS_SECRET set — a hosted rig refuses to
 * boot without it, instrumentation.ts), or a rig-shaped process on a hosted platform (isHostedRig — the same service
 * read from the other side). Its stored state is the owner's real root and vault, whatever LAYERS_WORLD says, so its
 * store reads FAIL CLOSED there too (review WE-6): rolling the flag back must not reopen the fail-open hydrate that a
 * failed state read turns into a namespace-replacing write. The rig and the public preview never set the secret on
 * the server that runs the store and are not hosted rigs, and are unchanged.
 */
export function isOwnerService(): boolean {
  if (typeof window !== "undefined") return false;
  return (process.env.OWNER_ACCESS_SECRET ?? "").trim() !== "" || isHostedRig();
}

/** The store's state read is fail-closed (lib/adapters/mock/store.ts hydrate): the empty world, or the owner service. */
export function strictStateRead(): boolean {
  return isEmptyWorld() || isOwnerService();
}

/** WHY the state read is fail-closed, for the boot line — or null on a laptop rig / the public preview, where the
 *  read keeps its fail-open shape (an unreachable validator there means the fixture seed, as every suite expects). */
export function strictStateReason(): string | null {
  if (isEmptyWorld()) return "LAYERS_WORLD=empty";
  if ((process.env.OWNER_ACCESS_SECRET ?? "").trim() !== "") return "owner service (OWNER_ACCESS_SECRET set)";
  if (isHostedRig()) return "owner service (rig-shaped on a hosted platform)";
  return null;
}

/** The bank or its empty twin. Called at module load by every reader of a bank file. PUBLIC GO-LIVE: the empty twin
 *  also on a public server in live mode (its right rail) and in a live visitor's device (isEmptyWorld above). */
export function bank<T>(demo: T, empty: T): T {
  return isEmptyWorld() || isPublicLive() ? empty : demo;
}
