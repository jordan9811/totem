"use client";
// PUBLIC GO-LIVE — the guided first run, step 1 of 3: Sign in with Farcaster. The account you sign in with IS you in
// Totem (your root): the next step shows it back to you. A quiet Skip stays (the owner's runbook saves an identity
// before signing in); Back goes to the welcome screen.
//
// The SAME card /device shows (components/device/FarcasterSignIn.tsx, skin "app"): QR on a computer, "Open in the
// Farcaster app" on a phone, run in this tab against Farcaster's sign-in service and the Optimism chain (the server
// sees nothing). A verified sign-in makes the Farcaster account this identity's read-only public self: Totem shows it
// as yours; it never posts as it from here (that needs a write signer the public site does not have).
// On a phone the card keeps the identity in this browser BEFORE the request starts (keepFirst), so the app switch,
// which may reload this tab, loses nothing.
//
// PUBLIC GO-LIVE (F10): what the keep cannot save is the sign-in itself — a request waiting on the Farcaster app lives in
// the tab's memory, so a reload during the app switch ends it. A kept identity that comes back here with no sign-in
// (`afterReload`: restored at boot, no public self) hears that once, above the card, until the card is used.
//
// SIGN IN WITH X (2026-11-06): once the site carries an X app (xArmed), the step is "Sign in" and "Continue with X"
// (components/x/XSignIn.tsx) sits beside the Farcaster card; x.com replaces this page, and the X path comes back through
// /welcome/x to This is you. Without an X app the step is exactly what it was.
import { useState } from "react";
import { FarcasterSignIn } from "@/components/device/FarcasterSignIn";
import { XSignIn } from "@/components/x/XSignIn";
import { StepShell } from "../Progress";

/** step 1's one line (the owner's words) */
export const FARCASTER_LEAD = "Approve in the Farcaster app. We only read your public profile.";

/** F10: the one sentence a restored identity with no sign-in hears on this step */
export const SIGN_IN_AGAIN_AFTER_RELOAD =
  "If you were approving a sign-in in the Farcaster app when this page reloaded, start it again here: a sign-in that was still waiting doesn't survive a reload. Your identity was kept.";

export function FarcasterStep({
  signedIn,
  afterReload = false,
  xArmed = false,
  phone,
  onChanged,
  onNext,
  onSkip,
  onBack,
}: {
  signedIn: boolean;
  /** F10: a restored (kept) identity with no sign-in — say once that a waiting sign-in must be started again */
  afterReload?: boolean;
  /** SIGN IN WITH X: the site carries an X app — the X card sits beside the Farcaster one (the step is then "Sign in") */
  xArmed?: boolean;
  phone: boolean;
  onChanged: () => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [acted, setActed] = useState(false);
  return (
    <StepShell
      step="farcaster"
      title={xArmed ? "Sign in" : "Sign in with Farcaster"}
      lead={FARCASTER_LEAD}
      onBack={onBack}
      onSkip={signedIn ? undefined : onSkip}
      onNext={signedIn ? onNext : undefined}
    >
      {afterReload && !acted && !signedIn ? (
        <p data-testid="onboard-farcaster-after-reload" className="text-[14px] leading-5 text-x-sec">
          {SIGN_IN_AGAIN_AFTER_RELOAD}
        </p>
      ) : null}
      <FarcasterSignIn
        publicDeployment
        skin="app"
        phone={phone}
        keepFirst={phone}
        onChange={() => {
          setActed(true);
          onChanged();
        }}
      />
      {xArmed ? (
        <div data-testid="onboard-x-signin" className="grid gap-2">
          <p className="text-[14px] font-bold leading-5 text-x-sec">Or use your X account</p>
          <XSignIn onChange={onChanged} />
        </div>
      ) : null}
    </StepShell>
  );
}
