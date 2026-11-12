"use client";
// PROD-LIVE (D-CU-0-4) — the unsaved-identity nudge in the public chrome.
//
// D-CU-0-6 (EPHEMERAL FIRST): a first visit's identity lives in tab memory only, and "a persistent strip says: this
// identity lives in this tab; save it to keep it." That strip lived on /device alone, so a visitor who never opened
// that page never learned that closing or reloading the tab loses everything. This carries the same statement into
// the app chrome.
//
// PERSONA LAUNCH P1 (SIWF): PASSKEY FIRST. The strip's primary action is now the passkey save ITSELF, inline, no
// navigation: "Save with Face ID / fingerprint" where the device has a built-in authenticator, "Save with a passkey"
// where only WebAuthn exists, hidden where neither does. It calls window.__layersDevice.custody.savePasskey() (the
// same call /device makes) and says what happened; a failed save stays on the strip with its error (never fail open).
// "Keep in this browser" is the secondary action (below); "More options" is a soft link (next/link — a full load
// would itself wipe the identity) to /device, where Sign in with Farcaster and, under Advanced, the 24 words are.
// The strip mounts the Save moment (SaveMoment.tsx): the passkey offered once, right after a first post, persona or
// sign-in.
//
// "Keep in this browser" (identity-keep) calls window.__layersDevice.persist(): D-CU-3-STORAGE-IS-EPHEMERAL-UNTIL-
// THE-VISITOR-SAYS-OTHERWISE (notes/reports/REPORT-CUSTODY.md) is exactly this action — a NON-EXTRACTABLE AES-256-GCM key minted
// inside WebCrypto, kept in IndexedDB, every entry mirrored as ciphertext under it. Its copy is honest about the one
// thing it does not do: it keeps the identity in THIS browser only — clearing site data loses it; a passkey keeps it
// safe beyond this browser (review UX-15: never "reaches it anywhere" — a wrap-path passkey is bound to its device —
// and never the 24 words, which stay under Advanced on /device). The strings are KEEP_NOTE / KEEP_TOAST in SaveMoment.
//
// PERSONA LAUNCH P1 (review UX-6): wherever Save is offered, "Already saved? Unlock" (identity-unlock, UnlockLink) is
// beside it at EVERY width — on a phone the one word "Unlock". Before, the only link to /device ("More options") was
// `hidden` below `sm` whenever Save showed, so a returning visitor on a phone (a fresh identity in a new browser) could
// only tap Save, which registers a SECOND passkey for a NEW root. It soft-links to /device#unlock (the unlock card and
// its "nothing saved under that passkey" fork). "More options" stays from `sm` up (and at every width when Save is not
// offered): the strip always has a way to /device.
//
// Hidden once the identity is no longer tab-only: restored from this browser at boot, persisted by a save or by the
// button (the device announces both on the `layers:device` event, and isPersistent() is read live). Dismissible for
// the session.
//
// PROD-LIVE (mobile): below `sm` the strip is ONE line — "Unsaved · Save · Keep · Unlock" and the dismiss — and the
// full sentence rides the strip's title and a screen-reader-only span; from `sm` up the copy is in full.
//
// PUBLIC GO-LIVE (public live mode, Providers.publicLive): "More options" (/device) becomes "Finish setting up" (/welcome,
// the guided first run: Sign in with Farcaster, Save with Face ID, X, your first persona), and "Already saved? Unlock"
// goes to the guided run's unlock (/welcome#unlock). The strip is not drawn ON /welcome (the flow says the same thing,
// one step at a time). /device stays for recovery, devices and the 24 words. With the flag off nothing here changes.
// PUBLIC GO-LIVE (F5): "Finish setting up" lands past the welcome screen on the first step not met yet (/welcome?step=next),
// and the Unlock opens the guided run's unlock even for a visitor who is not fresh (the run reads #unlock as an explicit
// target, lib/onboarding/state.ts readTarget).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { DEVICE_EVENT } from "@/lib/device/bootState";
import { KEEP_NOTE, KEEP_TOAST, LIVE_UNLOCK_HREF, SaveMoment, UnlockLink, momentDevice, passkeySaveLabel, saveWithPasskey, tabOnly, usePasskeyCaps } from "./SaveMoment";
import { welcomeHref } from "@/lib/onboarding/state";

interface NudgeDevice {
  info: { restored?: boolean; persistent?: boolean } | null;
  persist: () => Promise<void>;
  isPersistent?: () => boolean;
}

const KEY = "layers-identity-nudge";

function device(): NudgeDevice | null {
  return (momentDevice() as unknown as NudgeDevice | null) ?? null;
}

const FULL = "This identity lives only in this tab — closing or reloading it loses it.";

export function IdentityNudge() {
  const { toast, refresh, publicLive } = useApp();
  const pathname = usePathname();
  const caps = usePasskeyCaps();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"save" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(KEY) === "dismissed";
    } catch {
      /* storage unavailable: the nudge simply shows */
    }
    setShow(!dismissed && tabOnly());
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(DEVICE_EVENT, sync);
    return () => window.removeEventListener(DEVICE_EVENT, sync);
  }, [sync]);

  const saved = (sentence: string) => {
    setShow(false);
    toast(sentence);
    // every island that shows the saved state (/settings/account's "Saved" row and callout) re-reads it
    refresh();
  };

  // PUBLIC GO-LIVE: on /welcome the guided first run IS the strip's message (and its Save step is the save moment), step
  // by step — neither is drawn twice there
  const onWelcome = publicLive && !!pathname?.startsWith("/welcome");
  const moment = onWelcome ? null : <SaveMoment onSaved={saved} />;
  if (!show || onWelcome) return moment;

  const label = passkeySaveLabel(caps);

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      saved(await saveWithPasskey());
    } catch (e) {
      // never fail open: a save that did not happen is said, and the strip stays (the reason is already plain words:
      // saveWithPasskey maps custody's errors, and refuses BEFORE the OS prompt while the ways-in list is unreadable)
      setError("Not saved: " + ((e as Error)?.message || "the passkey was not saved"));
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    const d = device();
    if (!d) return;
    setBusy("keep");
    setError(null);
    try {
      await d.persist();
      setShow(false);
      toast(KEEP_TOAST);
      // PROD-LIVE: the keep only hid THIS nudge, so the account page went on saying "Unsaved" about a kept identity
      refresh();
    } catch (e) {
      setError("Not kept: " + ((e as Error)?.message || "could not keep this identity"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div
        data-testid="identity-unsaved"
        role="status"
        title={FULL}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-x-border bg-[#ffd4001a] px-4 py-1.5 text-[13px] leading-4 text-x-text sm:gap-x-3 sm:py-2"
      >
        <span className="font-bold">
          <span className="sm:hidden">
            Unsaved<span className="sr-only">: {FULL}</span>
          </span>
          <span className="hidden sm:inline">{FULL}</span>
        </span>
        {label ? (
          <>
            <span aria-hidden className="text-x-sec sm:hidden">
              ·
            </span>
            <button
              type="button"
              data-testid="identity-save-passkey"
              disabled={busy !== null}
              onClick={save}
              title={label}
              className="rounded-full bg-x-black-btn px-3 py-0.5 text-[12px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60"
            >
              {busy === "save" ? (
                "Saving…"
              ) : (
                <>
                  <span className="sm:hidden">
                    Save<span className="sr-only"> {label.replace(/^Save /, "")}</span>
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              )}
            </button>
          </>
        ) : null}
        <span aria-hidden className="text-x-sec sm:hidden">
          ·
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            data-testid="identity-keep"
            disabled={busy !== null}
            onClick={keep}
            title={"Keep in this browser — " + KEEP_NOTE}
            className="rounded-full border border-x-border-dark bg-white px-3 py-0.5 text-[12px] font-bold text-x-text hover:bg-x-hover disabled:opacity-60"
          >
            {busy === "keep" ? (
              "Keeping…"
            ) : (
              <>
                <span className="sm:hidden">
                  Keep<span className="sr-only"> in this browser</span>
                </span>
                <span className="hidden sm:inline">Keep in this browser</span>
              </>
            )}
          </button>
        </span>
        {/* UX-6: wherever Save is offered, Unlock is beside it at EVERY width (no `hidden` on it): a returning visitor's
            way back. Where Save is not offered, "More options" is visible at every width instead — so the strip always
            has a way to /device. */}
        {label ? (
          <>
            <span aria-hidden className="text-x-sec sm:hidden">
              ·
            </span>
            <UnlockLink testid="identity-unlock" short className="font-bold text-x-blue underline" {...(publicLive ? { href: LIVE_UNLOCK_HREF } : {})} />
          </>
        ) : null}
        {publicLive ? (
          <Link href={welcomeHref("next")} data-testid="identity-finish-setup" className="font-bold text-x-blue underline">
            Finish setting up
          </Link>
        ) : (
          <Link href="/device" data-testid="identity-more-options" className={(label ? "hidden sm:inline " : "") + "font-bold text-x-blue underline"}>
            More options
          </Link>
        )}
        {error ? (
          <span data-testid="identity-keep-error" role="alert" className="order-last basis-full text-[#f4212e] sm:order-none sm:basis-auto">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem(KEY, "dismissed");
            } catch {
              /* nothing to remember in */
            }
            setShow(false);
          }}
          className="ml-auto rounded-full px-2 text-[15px] leading-4 text-x-sec hover:bg-x-hover"
          aria-label="Hide this notice for this session"
        >
          ×
        </button>
      </div>
      {moment}
    </>
  );
}
