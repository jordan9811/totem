"use client";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the owner service's sign-in block: ONE TAP with Face ID / fingerprint, and the
// passphrase as the fallback. On a device that already has a passkey for this service (the server saw its hint
// cookie) the big button leads and the passphrase folds away under "Use your passphrase instead"; elsewhere the
// passphrase form leads and the passkey button sits under it (a passkey synced from another device of the owner's —
// iCloud Keychain, Google Password Manager — works there too). The 24 words never appear here: they are disaster
// recovery only.
//
// The passphrase form is a plain HTML POST (the session cookie is httpOnly; a form works with scripts off) — and so is
// the fold: a native <details>, so "Use your passphrase instead" opens with no script at all (review UX-11). The
// passkey button needs script, so it renders disabled until this component has mounted and checked the browser.
//
// Review fixes here:
//   UX-3   passkey AUTOFILL — the passphrase field is marked "current-password webauthn" and, where the browser has
//          conditional mediation, its suggestions include the owner's passkeys (lib/owner/passkeyClient.ts
//          startConditionalSignIn): an iPad or Mac with his iPhone's synced passkey signs in from the field, no paste.
//          The secondary button says it may work here too.
//   UX-7   a hidden username field ("owner"), so password managers save and fill the passphrase as a pair
//   UX-8   the form's own failures come back as words: a wrong passphrase, a service that could not finish, too many tries
//   UX-11  a cancelled Face ID prompt keeps the passphrase folded ("cancelled, tap to try again"); only a refusal or a
//          browser that cannot do it opens the fold
//   UX-12  the button names this device's unlock (Face ID, Touch ID, Windows Hello, …) once mounted
//   UX-13  a signed-in owner who lands here (from another site, a bookmark) is sent straight on
//   UX-15  no passkey button at all when the service has passkeys switched off (passkeysOn=false)
import { useEffect, useRef, useState } from "react";
import {
  GENERIC_UNLOCK,
  OwnerPasskeyError,
  conditionalMediationAvailable,
  ownerAlreadySignedIn,
  passkeysSupported,
  signInWithPasskey,
  startConditionalSignIn,
  unlockName,
  type ConditionalSignIn,
} from "@/lib/owner/passkeyClient";
import { OWNER_LOGIN_API } from "@/lib/platform/owner-paths";

export function PasskeyGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 11c0 3.5-1 6.5-2.6 9" />
      <path d="M8.5 7.6A4.5 4.5 0 0 1 16.5 11c0 1.4-.1 2.8-.4 4.1" />
      <path d="M5.2 9.4A7.5 7.5 0 0 1 19.5 11c0 .9 0 1.8-.1 2.7" />
      <path d="M8 12c0 2.4-.5 4.6-1.6 6.5" />
      <path d="M14 13.5c-.2 2.5-.9 4.7-2 6.5" />
      <path d="M7.4 4.6A10.5 10.5 0 0 1 21.6 7" />
    </svg>
  );
}

/** what went wrong on the passphrase form (the route and the middleware say it in /owner-login?error=) */
export type OwnerLoginError = "wrong" | "unavailable" | "busy" | null;

function loginErrorText(error: OwnerLoginError, passkeysOn: boolean): string | null {
  if (error === "wrong") return "That passphrase was not accepted.";
  if (error === "unavailable") return "The service couldn't finish signing you in. Wait a moment and try again.";
  if (error === "busy") return "Too many tries. Wait a minute, then try again" + (passkeysOn ? ", or use Face ID / fingerprint." : ".");
  return null;
}

export function OwnerSignIn({ next, error: loginError, hinted, passkeysOn }: { next: string; error: OwnerLoginError; hinted: boolean; passkeysOn: boolean }) {
  // null until mounted: the server cannot know whether this browser has WebAuthn
  const [supported, setSupported] = useState<boolean | null>(null);
  const [unlock, setUnlock] = useState(GENERIC_UNLOCK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** the "already signed in?" check has answered (autofill waits for it, so a signed-in visitor spends no challenge) */
  const [checked, setChecked] = useState(false);
  const [already, setAlready] = useState(false);
  const passkeyFirst = hinted && passkeysOn && !loginError;
  const [showPassphrase, setShowPassphrase] = useState(!passkeyFirst);
  /** bumped to (re)start passkey autofill after a button attempt */
  const [autofillRound, setAutofillRound] = useState(0);
  const autofill = useRef<ConditionalSignIn | null>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = passkeysSupported();
    setSupported(s);
    setUnlock(unlockName());
    if (!s) setShowPassphrase(true);
    let live = true;
    // review UX-13: already signed in (the cookie is sent on this same-origin call even when the page was reached from
    // another site, which SameSite=Strict kept it off) — go straight on
    void ownerAlreadySignedIn().then((yes) => {
      if (!live) return;
      setChecked(true);
      if (!yes) return;
      setAlready(true);
      window.location.replace(next);
    });
    return () => {
      live = false;
    };
  }, [next]);

  // review UX-3: passkey autofill on the passphrase field, while that field is shown
  useEffect(() => {
    if (!passkeysOn || supported !== true || !showPassphrase || !checked || already || busy) return;
    let live = true;
    void conditionalMediationAvailable().then((ok) => {
      if (!live || !ok) return;
      autofill.current = startConditionalSignIn(next, {
        onSignedIn: (to) => window.location.assign(to),
        onError: (e) => setError(e.message),
      });
    });
    return () => {
      live = false;
      autofill.current?.stop();
      autofill.current = null;
    };
  }, [passkeysOn, supported, showPassphrase, checked, already, busy, next, autofillRound]);

  async function onPasskey() {
    setError(null);
    // the browser runs one WebAuthn request at a time: the autofill one ends before the button's own begins
    autofill.current?.stop();
    autofill.current = null;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const to = await signInWithPasskey(next);
      window.location.assign(to);
    } catch (e) {
      setBusy(false);
      const kind = e instanceof OwnerPasskeyError ? e.kind : "unavailable";
      setError(e instanceof OwnerPasskeyError ? e.message : "Something went wrong. Try again, or use your passphrase.");
      // review UX-11: a cancelled prompt is one more tap away — the passphrase stays folded; a refusal, or a browser or
      // service that cannot do it, opens it
      if (kind === "refused" || kind === "unsupported" || kind === "off") setShowPassphrase(true);
      setAutofillRound((n) => n + 1);
    }
  }

  const label = busy ? `Waiting for ${unlock}…` : `Sign in with ${unlock}`;
  const passkeyButton = (primary: boolean) =>
    supported === false || !passkeysOn ? null : (
      <button
        type="button"
        onClick={onPasskey}
        disabled={supported !== true || busy || already}
        data-testid={primary ? "owner-passkey-signin" : "owner-passkey-signin-secondary"}
        className={
          primary
            ? "flex w-full items-center justify-center gap-3 rounded-full bg-x-black-btn px-6 py-4 text-[18px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60"
            : "flex w-full items-center justify-center gap-2 rounded-full border border-x-border-dark px-6 py-3 text-[16px] font-bold text-x-text hover:bg-x-hover disabled:opacity-60"
        }
      >
        <PasskeyGlyph size={primary ? 24 : 20} />
        {label}
      </button>
    );

  const errorNote = error ? (
    <p role="alert" className="mt-3 rounded-xl border border-[#f4212e] px-3 py-2 text-[15px] leading-5 text-[#f4212e]" data-testid="owner-passkey-error">
      {error}
    </p>
  ) : null;

  const alreadyNote = already ? (
    <p className="mt-4 rounded-xl border border-x-green px-3 py-2 text-[15px] leading-5 text-x-text" data-testid="owner-already-signed-in">
      You&apos;re already signed in. Continuing…
    </p>
  ) : null;

  const loginErrorMessage = loginErrorText(loginError, passkeysOn);
  const passphraseForm = (
    <>
      {loginErrorMessage ? (
        <p role="alert" className="mt-4 rounded-xl border border-[#f4212e] px-3 py-2 text-[15px] text-[#f4212e]" data-testid="owner-login-error" data-error={loginError ?? ""}>
          {loginErrorMessage}
        </p>
      ) : null}
      <form method="post" action={OWNER_LOGIN_API} className="mt-4 flex flex-col gap-3" data-testid="owner-login-form">
        <input type="hidden" name="next" value={next} />
        {/* review UX-7: a password manager saves and fills a username + password PAIR; a form with a password alone is
            often not offered for saving, or not filled. The name is fixed ("owner") and the route ignores it. */}
        <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden aria-hidden="true" tabIndex={-1} data-testid="owner-login-username" />
        <label className="flex flex-col gap-1 text-[15px] font-bold">
          Passphrase
          <input
            ref={passphraseRef}
            type="password"
            name="passphrase"
            required
            minLength={16}
            maxLength={1024}
            // review UX-3: "webauthn" lets the browser offer the owner's passkeys in this field's suggestions
            autoComplete="current-password webauthn"
            autoFocus={!passkeyFirst}
            className="rounded-md border border-x-border-dark px-3 py-2 text-[17px] font-normal outline-none focus:border-x-blue"
            data-testid="owner-login-passphrase"
          />
        </label>
        <button type="submit" className="rounded-full bg-x-black-btn px-6 py-3 text-[17px] font-bold text-white hover:bg-x-black-btn-hover" data-testid="owner-login-submit">
          Sign in with passphrase
        </button>
      </form>
    </>
  );

  const divider = (
    <div className="my-5 flex items-center gap-3 text-[13px] text-x-sec" aria-hidden="true">
      <span className="h-px flex-1 bg-x-border-dark" />
      or
      <span className="h-px flex-1 bg-x-border-dark" />
    </div>
  );

  if (passkeyFirst) {
    return (
      <div className="mt-6" data-testid="owner-signin" data-passkey-first="true">
        {alreadyNote}
        {passkeyButton(true)}
        {supported !== false ? <p className="mt-2 text-center text-[13px] text-x-sec">One tap. Your passphrase still works.</p> : null}
        {errorNote}
        {/* review UX-11: a native fold — it opens with no script, and script opens it only when the passphrase is needed */}
        <details
          className="mt-5"
          open={showPassphrase}
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setShowPassphrase(open);
            if (open) setTimeout(() => passphraseRef.current?.focus(), 0);
          }}
          data-testid="owner-passphrase-fold"
        >
          <summary className="cursor-pointer list-none text-center text-[15px] text-x-blue hover:underline" data-testid="owner-use-passphrase">
            Use your passphrase instead
          </summary>
          {passphraseForm}
        </details>
      </div>
    );
  }
  return (
    <div className="mt-2" data-testid="owner-signin" data-passkey-first="false">
      {alreadyNote}
      {passphraseForm}
      {supported !== false && passkeysOn ? (
        <>
          {divider}
          {passkeyButton(false)}
          {/* review UX-3: a device with no hint may still have his passkey — synced from his phone (iCloud Keychain,
              Google Password Manager) or made in another browser on this computer */}
          <p className="mt-2 text-center text-[13px] leading-4 text-x-sec" data-testid="owner-passkey-maybe">
            Already added Face ID / fingerprint on your phone? Try this first: it often works here too.
          </p>
          {errorNote}
        </>
      ) : null}
    </div>
  );
}
