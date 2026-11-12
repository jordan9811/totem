import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { deviceEnv } from "@/lib/device/deviceEnv.server";
import { embedMeta } from "@/lib/miniapp/manifest";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused, publicOrigin } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { AnonApp } from "./AnonApp";

// PUBLIC GO-LIVE — /anon, the native anon page for Farcaster users (app/anon/AnonApp.tsx says what it does). A server
// component only to hand the browser device the environment it boots with (lib/device/deviceEnv.server.ts, the one
// builder /device and the app group share) and to print the Farcaster embed: <meta name="fc:miniapp"> (and the legacy
// fc:frame) so a cast linking this page shows a button that opens it inside Farcaster as a Mini App
// (lib/miniapp/manifest.ts embedMeta). Nothing here reads a key; the server has none.
//
// Outside the (main) group: no Totem chrome, and middleware.ts lets ONLY this page and /anon/p/* be framed (by the
// Farcaster web client's origins), with a content security policy that allows no third-party script, image or
// connection. The owner service gates it like every page (the same session check app/device/page.tsx makes).

export const dynamic = "force-dynamic";

const originNow = () => publicOrigin(headers() as unknown as Headers);

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Anon · Totem",
    // PUBLIC GO-LIVE (PRIV-LIVE-4): no "nobody learns which posts are yours, Totem included" (components/anon/AnonExplainer.tsx)
    description: "Post on Farcaster from one shared account, with no name on your posts.",
    other: embedMeta(originNow()),
  };
}

export default async function AnonPage() {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  return <AnonApp env={deviceEnv()} origin={originNow()} />;
}
