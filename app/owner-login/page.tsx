// PROD-LIVE (D-PRODLIVE-OWNER-SERVICE) — the owner service's sign-in page. Outside the (main) group on purpose: it
// renders no chrome, reads no identity, no keystore, no vault and no validator — only whether a gate is configured
// (the presence of OWNER_ACCESS_SECRET, never its value), whether passkeys are switched on (APP_URL gives a relying
// party — not a secret) and whether this device carries the "has a passkey" hint cookie. middleware.ts lets this path
// through without a session and sends every other page here.
//
// OWNER PASSKEYS (D-OWNER-PASSKEYS): the page offers ONE TAP — "Sign in with Face ID / fingerprint" — with the
// passphrase as the fallback (components/owner/OwnerSignIn.tsx). A device that already has a passkey here gets the big
// button first and the passphrase folded away; any other device gets the passphrase first (whose field also offers
// the owner's passkeys as autofill suggestions) and the passkey button beneath it. Nothing on this page reveals
// whether any passkey is registered: the hint is this device's own cookie and only its SHAPE is checked here (a page a
// stranger can load must not lay itself out by what the volume holds), and the sign-in options the button fetches are
// the same whatever the volume holds.
//
// The passphrase form is a plain HTML POST to /api/owner-login, not a fetch: the session cookie is httpOnly, so the
// browser has to receive it on a navigation, and a form works with scripts off. This is a FULL page load, which is
// harmful on the public preview (an unsaved in-tab identity would be lost) and harmless here: the owner service is
// rig-shaped, its identity lives on the server's volume, and there is no in-tab identity to lose.
//
// Review fixes here: UX-6 — no "Sign out" footer (a signed-in owner never sees this page; signing out of one device
// is in Settings › Security); UX-8 — ?error= names what went wrong (a wrong passphrase, a service that could not
// finish, too many tries); UX-15 — no passkey button when the service has passkeys switched off.
import Link from "next/link";
import { cookies } from "next/headers";
import { OWNER_HINT_COOKIE, OWNER_LOGIN_ERRORS, isPasskeySlot, ownerSessionDays, readOwnerSecret, safeNextPath } from "@/lib/platform/owner-access";
import { ownerRelyingParty } from "@/lib/platform/owner-passkeys.server";
import { OwnerSignIn, type OwnerLoginError } from "@/components/owner/OwnerSignIn";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Totem — owner sign-in",
  robots: { index: false, follow: false },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function loginError(raw: string | undefined): OwnerLoginError {
  if (raw === OWNER_LOGIN_ERRORS.wrong) return "wrong";
  if (raw === OWNER_LOGIN_ERRORS.unavailable) return "unavailable";
  if (raw === OWNER_LOGIN_ERRORS.busy) return "busy";
  return null;
}

export default function OwnerLoginPage({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const gated = readOwnerSecret() !== null;
  const next = safeNextPath(first(searchParams.next));
  const error = loginError(first(searchParams.error));
  const passkeysOn = gated && ownerRelyingParty() !== null;
  let hinted = false;
  if (gated) {
    try {
      hinted = isPasskeySlot(cookies().get(OWNER_HINT_COOKIE)?.value);
    } catch {
      hinted = false; // no hint is only a layout choice: the passphrase leads
    }
  }
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[420px] flex-col px-4 py-12 text-x-text" data-testid="owner-login">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={32} height={32} className="rounded-full" />
        <span className="text-[20px] font-bold">Totem</span>
        <span className="ml-auto rounded-full border border-x-border-dark px-3 py-0.5 text-[12px] font-bold text-x-sec">owner service</span>
      </header>

      {gated ? (
        <>
          <h1 className="mt-8 text-[23px] font-extrabold leading-7">Sign in</h1>
          <p className="mt-2 text-[15px] leading-5 text-x-sec">
            This is the owner&apos;s own Totem, running on a server. It posts to Farcaster as you, so it opens only for you
            {passkeysOn ? ": with Face ID / fingerprint, or with your passphrase." : ", with your passphrase."}
          </p>
          <OwnerSignIn next={next} error={error} hinted={hinted && passkeysOn} passkeysOn={passkeysOn} />
          <p className="mt-6 text-[13px] leading-4 text-x-sec">
            Each device stays signed in for {ownerSessionDays()} days. Your 24 words are never needed to sign in — they are only for recovering the service if its server is lost.
          </p>
          <div className="mt-6 text-[15px]">
            {/* SameSite=Strict keeps the session cookie off a navigation that ARRIVED from another site, so an owner
                who is signed in can land here from a link; a same-site click carries it (and the sign-in block checks
                by itself and goes on — review UX-13) */}
            <Link href={next} className="text-x-blue hover:underline" data-testid="owner-login-continue">
              Already signed in? Continue
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-[23px] font-extrabold leading-7">No owner gate here</h1>
          <p className="mt-2 text-[15px] leading-5 text-x-sec" data-testid="owner-login-unconfigured">
            This deployment has no owner passphrase configured, so there is nothing to sign in to.
          </p>
          <Link href="/home" className="mt-6 text-[15px] text-x-blue hover:underline">
            Go to the app
          </Link>
        </>
      )}
    </main>
  );
}
