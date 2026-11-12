import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DropCard } from "@/components/rings/DropCard";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { validatorUrl } from "@/lib/ports";

// PERSONA LAUNCH P4 — THE LINK-FRIEND CARD, at /d#<key> (DROP §4f). For someone without Totem whom a ring's owner sent
// a link. Like /help it sits OUTSIDE app/(main): no device boots, no root is minted, no identity is read or saved — the
// page is a static shell, and everything happens in the visitor's browser: the key lives in the URL FRAGMENT (which never
// reaches a server), the card reads the public drop, trial-opens it with keys derived from the fragment and shows what
// the note says. The server learns only that someone opened /d.
//
// The validator address is handed in the way the device's environment names it (NEXT_PUBLIC_VALIDATOR_URL, else the
// server's own setting — lib/device/deviceEnv.server.ts). On the owner service the page is behind the owner gate like
// every page, and unused.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "A private note",
  description: "Someone shared a private note with you on Totem.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function DropPage() {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  return <DropCard validator={process.env.NEXT_PUBLIC_VALIDATOR_URL || validatorUrl()} />;
}
