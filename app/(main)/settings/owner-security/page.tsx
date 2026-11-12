import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SettingsHeader } from "@/components/settings/Chrome";
import { OwnerSecurityPanel, type OwnerSecurityInitial } from "@/components/owner/OwnerSecurityPanel";
import {
  OWNER_COOKIE,
  OWNER_ENROLL_FRESH_MS,
  OWNER_HINT_COOKIE,
  OWNER_LOGIN_PATH,
  OWNER_PASSKEYS_MAX,
  OWNER_SECURITY_PATH,
  VIA_PASSPHRASE,
  currentOwnerSession,
  isPasskeySlot,
  ownerSessionDays,
  readOwnerSecret,
} from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { ownerPasskeyViews, ownerRelyingParty, type OwnerPasskeyView } from "@/lib/platform/owner-passkeys.server";

export const metadata: Metadata = { title: "Security / X" };
export const dynamic = "force-dynamic";

// OWNER PASSKEYS (D-OWNER-PASSKEYS) — Settings › Security, on the owner service only: how this device is signed in,
// "sign out of this device", the Face ID / fingerprint sign-ins (add for this device, rename, remove, "lost this
// device?") and "sign out everywhere". The page checks
// the session itself (statefully) before it reads the list — the (main) layout's backstop does not stop a page's own
// render (see that layout's note). It lists names and dates only: never a key, never a credential id. On the rig and
// the public preview (no OWNER_ACCESS_SECRET) there is nothing to manage and the page says so.
export default async function OwnerSecurityPage() {
  const secret = readOwnerSecret();
  if (!secret) {
    return (
      <>
        <SettingsHeader title="Security" back="/settings" />
        <p className="px-4 py-6 text-[15px] leading-5 text-x-sec" data-testid="owner-security-unconfigured">
          This deployment has no owner sign-in, so there is nothing to manage here.
        </p>
      </>
    );
  }
  const session = await currentOwnerSession(cookies().get(OWNER_COOKIE)?.value, secret, process.env, ownerGateStateSource);
  if (!session) redirect(`${OWNER_LOGIN_PATH}?next=${encodeURIComponent(OWNER_SECURITY_PATH)}`);

  let passkeys: OwnerPasskeyView[] = [];
  let readError: string | null = null;
  try {
    passkeys = (await ownerPasskeyViews(secret)).passkeys;
  } catch (e) {
    // review UX-15: plain words for the owner; the operator's detail (the state file on the volume) goes to the log
    console.error("[owner-gate] the Security page could not read the owner state on the volume (" + ((e as { kind?: string })?.kind ?? "error") + ")");
    readError = "Couldn't load your Face ID / fingerprint sign-ins. Reload the page.";
  }
  const hint = cookies().get(OWNER_HINT_COOKIE)?.value;
  const viaPasskey = session.via !== VIA_PASSPHRASE;
  const initial: OwnerSecurityInitial = {
    passkeys,
    thisDeviceSlot: isPasskeySlot(hint) ? hint : null,
    session: {
      via: viaPasskey ? "passkey" : "passphrase",
      passkeyName: viaPasskey ? passkeys.find((p) => p.slot === session.via)?.name ?? null : null,
      // review UX-9: the passkey this session signed in with — removing it signs this device out, and the confirm says so
      slot: viaPasskey ? session.via : null,
      expiresAt: session.exp,
      canEnroll: !viaPasskey && Date.now() - session.iat <= OWNER_ENROLL_FRESH_MS,
    },
    sessionDays: ownerSessionDays(),
    max: OWNER_PASSKEYS_MAX,
    passkeysAvailable: ownerRelyingParty() !== null,
    readError,
  };
  return (
    <>
      <SettingsHeader title="Security" back="/settings" />
      <OwnerSecurityPanel initial={initial} />
      <div className="h-24" />
    </>
  );
}
