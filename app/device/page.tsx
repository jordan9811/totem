import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deviceEnv } from "@/lib/device/deviceEnv.server";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { DeviceApp } from "@/components/device/DeviceApp";

export const dynamic = "force-dynamic";

// BROWSER KEYSTORE PASS Gate 2 — the device's own page: the identity strip, the save picker, unlock, and the
// settings (methods, the 24 words, forget). A server component only to hand the client the environment the device
// boots with; nothing here reads a key — the server has none (docs/custody-model.md, the one rule).
export default async function DevicePage() {
  // PROD-LIVE (D-PRODLIVE-OWNER-SERVICE; review: the favicon matcher bypass) — DEFENCE IN DEPTH, as in the (main)
  // layout: on the owner service the environment below names the PRIVATE validator address (the hosted rig sets no
  // NEXT_PUBLIC_VALIDATOR_URL, so VALIDATOR_URL falls through to validatorUrl()), so the page verifies the owner's
  // session cookie itself — the same readOwnerCookie + ownerSessionLive middleware.ts runs — before building it. This page is the
  // whole render (outside the (main) group; the root layout reads nothing), so here the redirect does stop
  // everything. A no-op without OWNER_ACCESS_SECRET: the rig and the public preview never read the cookie store.
  // OWNER PASSKEYS: a LIVE session (current epoch, its passkey still registered), read from the volume
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  // Gate 5 (research/attack-custody-1.md #1, #7; attack-custody-2.md #2): the fixture provider and the debug members
  // exist in the device only when the SERVER is a rig. A public deployment never hands the page these two flags, so
  // the bundle it serves has no "anyone who names the subject" login and no key-material accessors. FC-READ: the
  // object is built by lib/device/deviceEnv.server.ts, shared with the (main) layout so the two can never drift.
  const env: Record<string, string> = deviceEnv();
  return <DeviceApp env={env} publicDeployment={isPublicDeployment()} />;
}
