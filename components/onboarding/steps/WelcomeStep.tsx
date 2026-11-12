"use client";
// PUBLIC GO-LIVE — the guided first run, screen 0: the front door's own doors, for a visitor who opens /welcome itself
// (the landing's words, from components/onboarding/copy.ts): Sign in with Farcaster, Continue with X (shown, disabled,
// marked Soon, until the site carries an X app: then a real door to step 1), "I've used Totem before", and a link to get
// a Farcaster account.
//
// The way back for a returning visitor is an UNLOCK with the passkey they saved (window.__layersDevice.custody
// .unlockPasskey, the same call /device makes), with /device's "nothing is saved under that passkey" fork: start fresh
// here, or link a device that already holds the account. Sign in with Farcaster is NEVER offered as the way back: it
// shows which Farcaster account is yours, it cannot restore an identity (SECURITY-POSTURE.md §21). "Start without
// signing in" (the guest path) is a soft link to /home: everything stays available without an account.
//
// PUBLIC GO-LIVE (F8): in public LIVE mode /home has nothing for a guest (no demo world, and a guest's home feed is built
// only for a persona), so "look around first" led to an empty page whose one link came straight back here. There the
// guest door is the anonymous feed instead (/anon: readable with no account) and says so. The preview keeps /home.
import Link from "next/link";
import { useState } from "react";
import { XLogo } from "@/components/icons";
import { CONTINUE_WITH_X, FRONT_HEADLINE, FRONT_LINE, GET_FARCASTER_ASK, GET_FARCASTER_LINK, GET_FARCASTER_URL, SIGN_IN_FARCASTER, USED_BEFORE } from "../copy";

interface UnlockDevice {
  custody?: { unlockPasskey?: () => Promise<{ empty: boolean }> };
}

export function WelcomeStep({
  startOpen,
  live = false,
  xArmed = false,
  onNew,
  onUnlocked,
}: {
  /** open on the "used Totem before" half (/welcome#unlock) */
  startOpen: boolean;
  /** PUBLIC GO-LIVE (F8): public live mode (Providers.publicLive) — the guest door is the anonymous feed */
  live?: boolean;
  /** SIGN IN WITH X: the site carries an X app (the device env's X_SIGNIN=on) — Continue with X is a real door, to step 1,
   *  where the X card says who sees what before anything is sent. Without it: the disabled button marked Soon, as before. */
  xArmed?: boolean;
  onNew: () => void;
  /** an identity was unlocked into this tab */
  onUnlocked: () => void;
}) {
  const [returning, setReturning] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    setEmpty(false);
    try {
      const d = (window as unknown as { __layersDevice?: UnlockDevice }).__layersDevice;
      if (!d?.custody?.unlockPasskey) throw new Error("this page is still starting; try again in a moment.");
      const r = await d.custody.unlockPasskey();
      if (r.empty) {
        setEmpty(true);
        return;
      }
      onUnlocked();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // cancelling the OS prompt is not an error worth a paragraph
      setError(/not allowed|timed out|cancel|abort/i.test(msg) ? "The passkey was not used (cancelled or timed out)." : "Couldn't unlock: " + msg);
    } finally {
      setBusy(false);
    }
  };

  // SIGN IN WITH X: the armed door goes to step 1 (the X card there carries the disclosure and the request)
  const armedX = (
    <button
      type="button"
      data-testid="onboard-x"
      onClick={onNew}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-6 text-[17px] font-bold text-x-text hover:bg-x-hover"
    >
      <XLogo size={18} />
      {CONTINUE_WITH_X}
    </button>
  );
  const soonX = (
        <button
          type="button"
          data-testid="onboard-x-soon"
          disabled
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-6 text-[17px] font-bold text-x-text opacity-60"
        >
          {CONTINUE_WITH_X}
          <span className="rounded-full bg-x-pill px-2 py-0.5 text-[12px] font-bold text-x-sec">Soon</span>
        </button>
  );

  return (
    <section data-testid="onboard-step-welcome" data-step="welcome" className="px-4 pb-10 pt-6">
      <h1 className="text-[28px] font-extrabold leading-8 tracking-tight">{FRONT_HEADLINE}</h1>
      <p className="mt-2 text-[16px] leading-6 text-x-sec">{FRONT_LINE}</p>
      <div className="mt-6 grid gap-3">
        <button
          type="button"
          data-testid="onboard-new"
          onClick={onNew}
          className="inline-flex h-12 items-center justify-center rounded-full bg-x-black-btn px-6 text-[17px] font-bold text-white hover:bg-x-black-btn-hover"
        >
          {SIGN_IN_FARCASTER}
        </button>
        {xArmed ? armedX : soonX}
        <button
          type="button"
          data-testid="onboard-returning"
          aria-expanded={returning}
          onClick={() => setReturning((v) => !v)}
          className="inline-flex h-12 items-center justify-center rounded-full border border-x-border-dark bg-white px-6 text-[17px] font-bold text-x-text hover:bg-x-hover"
        >
          {USED_BEFORE}
        </button>
      </div>
      <p className="mt-3 text-center text-[15px]">
        <span className="text-x-sec">{GET_FARCASTER_ASK} </span>
        <a href={GET_FARCASTER_URL} target="_blank" rel="noopener noreferrer" data-testid="onboard-get-farcaster" className="font-bold text-x-blue hover:underline">
          {GET_FARCASTER_LINK}
        </a>
      </p>

      {returning ? (
        <div id="unlock" data-testid="onboard-unlock" className="mt-4 rounded-2xl border border-x-border p-4">
          <p className="text-[17px] font-bold leading-6">Unlock with your passkey</p>
          <p className="mt-1 text-[14px] leading-5 text-x-sec">Use the Face ID, fingerprint or passkey you saved Totem with. Signing in with Farcaster can&apos;t bring an identity back: only the passkey you saved it with can.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="onboard-unlock-passkey"
              disabled={busy}
              onClick={() => void unlock()}
              className="inline-flex h-10 items-center justify-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
            >
              {busy ? "Unlocking…" : "Unlock with a passkey"}
            </button>
            <Link href="/device" data-testid="onboard-link-device" className="text-[15px] font-bold text-x-blue hover:underline">
              Link a device instead
            </Link>
          </div>
          {empty ? (
            <div data-testid="onboard-unlock-empty" className="mt-3 rounded-xl border border-[#ffd40099] bg-[#ffd4000d] p-3">
              <p className="text-[15px] font-bold leading-5">Nothing is saved under that passkey yet.</p>
              <p className="mt-1 text-[14px] leading-5 text-x-sec">Start fresh here, or link a device that already holds your account.</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button type="button" data-testid="onboard-start-fresh" onClick={onNew} className="h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white">
                  Start fresh here
                </button>
                <Link href="/device" data-testid="onboard-fork-link" className="inline-flex h-9 items-center rounded-full border border-x-border-dark px-4 text-[14px] font-bold">
                  Link an existing device
                </Link>
              </div>
            </div>
          ) : null}
          {error ? (
            <p data-testid="onboard-unlock-error" role="alert" className="mt-3 text-[14px] text-[#f4212e]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {live ? (
        <p className="mt-6 text-center text-[15px]">
          <span className="text-x-sec">Just looking? </span>
          <Link href="/anon" data-testid="onboard-guest" data-mode="live" className="font-bold text-x-blue hover:underline">
            Read the anonymous feed
          </Link>
          <span className="text-x-sec">: no account needed. You can set up later.</span>
        </p>
      ) : (
        <p className="mt-6 text-center text-[15px]">
          <Link href="/home" data-testid="onboard-guest" className="font-bold text-x-blue hover:underline">
            Start without signing in
          </Link>
          <span className="text-x-sec">: look around first; you can set up later.</span>
        </p>
      )}
    </section>
  );
}
