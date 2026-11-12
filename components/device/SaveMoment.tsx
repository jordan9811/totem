"use client";
// PERSONA LAUNCH P1 (SIWF) — THE SAVE MOMENT: the passkey offered at the first useful moment (passkey first, the owner's
// rule: no seed phrase in the consumer flow; the 24 words stay under Advanced on /device).
//
// An identity on the public site lives only in its tab until it is saved (D-CU-0-6). The strip says so all the time;
// this card says it ONCE, at the moment the visitor has something to lose: right after their first post, their first
// persona, a verified Sign in with Farcaster, or a landed X archive import (PERSONA LAUNCH P2, review UX-5). Those four
// surfaces dispatch a window `layers:moment` event (announceMoment) with detail.kind "post" | "persona" | "signed-in" |
// "import"; this card listens.
//
// Shown once per session (sessionStorage "layers-save-moment"), and only while the identity is tab-only (tabOnly()):
// a kept or saved identity never sees it. The save is INLINE: window.__layersDevice.custody.savePasskey(), the same
// call /device makes. A failed save stays on the card with its error (never fail open). "Not now" closes it for the
// session; the strip stays until the identity is saved.
//
// Mounted by components/device/IdentityNudge.tsx (the public app chrome) and by components/device/DeviceApp.tsx
// (/device, where a sign-in happens). It takes its callbacks as props: /device has no app Providers around it.
//
// PERSONA LAUNCH P1 (review UX-6, UX-15, UX-16) — three fixes that live here because every inline save shares them:
//   • THE GATE (UX-16): saveWithPasskey() asks custody.status() FIRST. custody.savePasskey() registers the OS passkey
//     before it reads the ways-in list, so a tap while that list is unreadable left an orphan "Totem identity" passkey
//     per tap; /device gates its button on !methodsUnknown, the inline saves did not. Unknown (or a status that cannot
//     be read) = "paused", never "go ahead" (never fail open); no WebAuthn = refused. Custody's errors are mapped to
//     plain words (plainSaveError) — "no PRF … use a social login" named jargon and a login the public site lacks.
//   • THE COPY (UX-15): a passkey "keeps it safe beyond this browser" (it does not "reach it anywhere": a wrap-path
//     passkey is bound to the device that saved it), and the wrap-path sentence sends the visitor to device linking,
//     never to the 24 words (the owner's rule: passkey + QR in consumer flows; the words stay under Advanced). The
//     strip's strings live here (KEEP_NOTE, KEEP_TOAST) so scripts/unit-siwf.mjs U13 reads the exact text shipped.
//   • THE WAY BACK (UX-6): a returning visitor (a new phone, cleared site data) lands on a FRESH identity whose strip
//     offered only "Save", which registers a SECOND passkey for a new root. UnlockLink is the "Already saved? Unlock"
//     soft link to /device#unlock (the unlock card, with the "nothing saved under that passkey" fork) — beside Save on
//     the strip at every width, and on this card. A soft link: a full load would wipe the identity in this tab.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DEVICE_EVENT, deviceBootState } from "@/lib/device/bootState";
import { welcomeHref } from "@/lib/onboarding/state";

export const MOMENT_EVENT = "layers:moment";
export type MomentKind = "post" | "persona" | "signed-in" | "import";
const MOMENT_KINDS: ReadonlySet<string> = new Set(["post", "persona", "signed-in", "import"]);
const SEEN_KEY = "layers-save-moment";

/** dispatch a first-useful-moment (a successful post, a new persona, a verified sign-in, a landed X import). Never throws. */
export function announceMoment(kind: MomentKind): void {
  try {
    window.dispatchEvent(new CustomEvent(MOMENT_EVENT, { detail: { kind } }));
  } catch {
    /* no window event support: the strip still says it */
  }
}

interface MomentDevice {
  info: { restored?: boolean; persistent?: boolean } | null;
  isPersistent?: () => boolean;
  custody?: {
    /** lib/device/custody/index.ts status(): methodsUnknown = the ways-in list could not be read */
    status?: () => Promise<{ methodsUnknown?: boolean; webauthn?: boolean }>;
    savePasskey?: () => Promise<{ methodId: string; path: "prf" | "wrap"; attached: boolean }>;
  };
}

/** the strip's "Keep in this browser" note and toast: honest about the one thing a keep does not do (UX-15) */
export const KEEP_NOTE = "kept in this browser only; a passkey keeps it safe beyond this browser";
export const KEEP_TOAST = "Kept in this browser only. A passkey keeps it safe beyond this browser.";
/** the sentences a save resolves to (shown after "Saved" in a toast or note) */
export const SAVED_SENTENCE = "Saved. Your passkey opens this identity here.";
export const SAVED_ATTACHED_SENTENCE = "Passkey added as another way in.";
export const WRAP_PATH_SENTENCE = " This passkey works on this device. To use Totem on another device, link it from Your device › Devices.";
/** the refusals and failures a save says after "Not saved: " (plain words; never custody's own message) */
export const SAVE_PAUSED = "saving is paused for a moment; try again shortly.";
export const SAVE_NOT_READY = "this page is still starting; try again in a moment.";
export const SAVE_NO_PASSKEY = "this browser can't make a passkey. Open Your device for other ways to keep it.";
export const SAVE_CANCELLED = "the passkey was not made (cancelled or timed out).";
export const SAVE_UNSUPPORTED = "this passkey can't hold your identity here. Try another passkey, or open Your device for other ways to keep it.";
export const SAVE_FAILED = "the passkey was not saved. Try again.";
/** where "Already saved? Unlock" goes: /device's unlock card (DeviceApp scrolls it into view) */
export const UNLOCK_HREF = "/device#unlock";
/** PUBLIC GO-LIVE: in public live mode, the guided first run's "I've used Totem before" (unlock with a passkey). F5: the
 *  run opens it as an explicit target, even for a visitor who is not fresh (lib/onboarding/state.ts welcomeHref) */
export const LIVE_UNLOCK_HREF = welcomeHref("unlock");

/** the sentence for a passkey save: the attach wording when the identity already had a way in, and the device-bound
 *  note on the wrap path (no 24 words: device linking is the consumer way to another device) */
export function passkeySavedSentence(r: { path: "prf" | "wrap"; attached?: boolean }): string {
  return (r.attached ? SAVED_ATTACHED_SENTENCE : SAVED_SENTENCE) + (r.path === "wrap" ? WRAP_PATH_SENTENCE : "");
}

/** custody's failure → plain words. Cancelling the OS prompt is NotAllowedError / AbortError; a passkey without PRF on a
 *  deployment with no wrap path is "unsupported"; a ways-in list that failed mid-save is "paused"; anything else is a
 *  generic retry (custody's own message carries jargon and status codes, never shown to a consumer) */
export function plainSaveError(e: unknown): string {
  const name = String((e as { name?: unknown })?.name ?? "");
  const msg = String((e as { message?: unknown })?.message ?? e ?? "");
  if (name === "NotAllowedError" || name === "AbortError" || /not allowed|timed out|cancel/i.test(msg)) return SAVE_CANCELLED;
  if (/no PRF|PRF-capable/i.test(msg)) return SAVE_UNSUPPORTED;
  if (/did not list this root's methods/i.test(msg)) return SAVE_PAUSED;
  return SAVE_FAILED;
}

export function momentDevice(): MomentDevice | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __layersDevice?: MomentDevice }).__layersDevice ?? null;
}

/** is this identity still only in this tab (not restored, not kept, not saved)? false until the device has booted */
export function tabOnly(): boolean {
  if (deviceBootState().state !== "ready") return false; // nothing to say until the device has an identity
  const d = momentDevice();
  if (!d || !d.info) return false;
  const kept = d.info.restored === true || d.info.persistent === true || (typeof d.isPersistent === "function" && d.isPersistent());
  return !kept;
}

export interface PasskeyCaps {
  webauthn: boolean;
  platform: boolean;
}

/** what this browser can do, read LOCALLY (no device call, no request): WebAuthn at all, and a built-in authenticator */
export function usePasskeyCaps(): PasskeyCaps | null {
  const [caps, setCaps] = useState<PasskeyCaps | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const PKC = (window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
      if (!PKC) {
        if (alive) setCaps({ webauthn: false, platform: false });
        return;
      }
      let platform = false;
      try {
        platform = typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable === "function" ? await PKC.isUserVerifyingPlatformAuthenticatorAvailable() : false;
      } catch {
        platform = false;
      }
      if (alive) setCaps({ webauthn: true, platform });
    })();
    return () => {
      alive = false;
    };
  }, []);
  return caps;
}

/** the passkey button's words: Face ID / fingerprint when the device has one built in, else a passkey; null = none */
export function passkeySaveLabel(caps: PasskeyCaps | null): string | null {
  if (!caps || !caps.webauthn) return null;
  return caps.platform ? "Save with Face ID / fingerprint" : "Save with a passkey";
}

/** the inline save every surface makes (the strip, this card, Settings › Account); resolves the sentence to show,
 *  THROWS a plain-words reason on failure. The status gate runs BEFORE anything reaches the OS passkey prompt (UX-16):
 *  a refusal here registers nothing. */
export async function saveWithPasskey(): Promise<string> {
  const d = momentDevice();
  if (!d || !d.custody || typeof d.custody.savePasskey !== "function" || typeof d.custody.status !== "function") throw new Error(SAVE_NOT_READY);
  let st: { methodsUnknown?: boolean; webauthn?: boolean } | null = null;
  try {
    st = await d.custody.status();
  } catch {
    st = null;
  }
  // never fail open: only a status that SAYS the list was read lets a save through
  if (!st || st.methodsUnknown !== false) throw new Error(SAVE_PAUSED);
  if (st.webauthn !== true) throw new Error(SAVE_NO_PASSKEY);
  let r: { path: "prf" | "wrap"; attached: boolean };
  try {
    r = await d.custody.savePasskey();
  } catch (e) {
    throw new Error(plainSaveError(e));
  }
  return passkeySavedSentence(r);
}

/** "Already saved? Unlock" — a SOFT link to /device's unlock card (a full load would wipe the identity in this tab) */
export function UnlockLink({ testid, className, short, href = UNLOCK_HREF }: { testid: string; className?: string; short?: boolean; href?: string }) {
  // PUBLIC GO-LIVE: in public live mode the way back is the guided first run's unlock (/welcome#unlock, LIVE_UNLOCK_HREF)
  return (
    <Link href={href} data-testid={testid} className={className ?? "font-bold text-x-blue underline"} title="Already saved an identity with a passkey? Unlock it">
      {short ? (
        <>
          <span className="sm:hidden">
            Unlock<span className="sr-only"> an identity you already saved</span>
          </span>
          <span className="hidden sm:inline">Already saved? Unlock</span>
        </>
      ) : (
        "Already saved? Unlock"
      )}
    </Link>
  );
}

export function SaveMoment({ onSaved }: { onSaved?: (sentence: string) => void }) {
  const caps = usePasskeyCaps();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onMoment = useCallback((e: Event) => {
    const kind = (e as CustomEvent<{ kind?: unknown }>).detail?.kind;
    if (typeof kind !== "string" || !MOMENT_KINDS.has(kind)) return;
    if (!tabOnly()) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      sessionStorage.setItem(SEEN_KEY, kind);
    } catch {
      /* storage unavailable: shown, and shown again next time — better than never */
    }
    setError(null);
    setShow(true);
  }, []);

  useEffect(() => {
    window.addEventListener(MOMENT_EVENT, onMoment);
    // a save elsewhere (the strip, /device) makes the identity no longer tab-only: the card goes
    const onDevice = () => {
      if (!tabOnly()) setShow(false);
    };
    window.addEventListener(DEVICE_EVENT, onDevice);
    return () => {
      window.removeEventListener(MOMENT_EVENT, onMoment);
      window.removeEventListener(DEVICE_EVENT, onDevice);
    };
  }, [onMoment]);

  if (!show) return null;
  const label = passkeySaveLabel(caps);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const sentence = await saveWithPasskey();
      setShow(false);
      onSaved?.(sentence);
    } catch (e) {
      setError((e as Error)?.message || "the passkey was not saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="save-moment"
      role="dialog"
      aria-label="Keep this identity"
      className="fixed bottom-24 left-1/2 z-[90] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-[#ffd40099] bg-white p-4 text-[#0f1419] shadow-[0_0_15px_rgba(101,119,134,0.25)]"
    >
      <p className="text-[17px] font-bold leading-6">Nice. Keep this identity so it is here tomorrow.</p>
      <p className="mt-1 text-[14px] leading-5 text-[#536471]">Right now it lives only in this tab. Closing the tab loses it.</p>
      {error ? (
        <p data-testid="save-moment-error" role="alert" className="mt-2 text-[13px] text-[#f4212e]">
          Not saved: {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {label ? (
          <button
            type="button"
            data-testid="save-moment-passkey"
            disabled={busy}
            onClick={save}
            className="h-9 rounded-full bg-[#0f1419] px-4 text-[14px] font-bold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : label}
          </button>
        ) : (
          // a SOFT navigation (next/link): a full load would itself wipe the identity this card is trying to keep
          <Link href="/device" data-testid="save-moment-more" className="text-[14px] font-bold text-[#1d9bf0] underline">
            See ways to save it
          </Link>
        )}
        <button
          type="button"
          data-testid="save-moment-dismiss"
          onClick={() => setShow(false)}
          className="h-9 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold"
        >
          Not now
        </button>
      </div>
      {/* UX-6: beside the passkey save, the way back for a visitor who saved before — never a second identity and a
          second passkey (without a passkey button, "See ways to save it" already goes to /device) */}
      {label ? (
        <p className="mt-2 text-[13px] text-[#536471]">
          <UnlockLink testid="save-moment-unlock" className="font-bold text-[#1d9bf0] underline" />
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// PUBLIC GO-LIVE — THE PASSKEY SAVE CARD, ONE IMPLEMENTATION IN TWO PLACES: /device's "Save with Face ID / fingerprint"
// card (skin "device", the page's black cards; data-testid save-passkey, data-order 1, as the custody suites expect)
// and the guided first run's Save step (skin "app"). The words are the same in both; the caller owns what a save does
// (/device runs it through its own run(), with its note and refresh; the guided run calls saveWithPasskey above, gate
// first). The 24 words are never offered here: they stay under Advanced on /device.
export interface PasskeySaveFacts {
  webauthn: boolean;
  platformAuthenticator: boolean;
  /** the identity already has a saved way in (the button then says "Add a passkey") */
  saved: boolean;
  /** the ways-in list was read (a save must know whether it attaches or starts one) */
  canSave: boolean;
}

/** the card's explanation, by what this device can do */
// PUBLIC GO-LIVE (verify): the /device skin's no-passkey sentence (which points at Advanced, where the written backup lives)
// is handed in by /device itself (components/device/DeviceApp.tsx, noPasskeyNote), so this consumer file names no written
// backup at all (scripts/accept-siwf.mjs R13, UX-15: consumer save copy never names it; /device's Advanced may).
export function passkeyCardSentence(f: Pick<PasskeySaveFacts, "webauthn" | "platformAuthenticator">, skin: "device" | "app" = "device", noPasskeyNote?: string): string {
  if (!f.webauthn) return skin === "app" ? "Passkeys are not available in this browser. You can keep going and save later from Settings › Account." : noPasskeyNote || "Passkeys are not available in this browser.";
  return f.platformAuthenticator
    ? "Your phone or computer unlocks it with your face, your fingerprint or its screen lock. Nothing to write down."
    : "A security key or a passkey saved in your password manager.";
}

export function PasskeySaveCard({
  skin = "device",
  facts,
  busy,
  onSave,
  noPasskeyNote,
}: {
  skin?: "device" | "app";
  facts: PasskeySaveFacts;
  busy: boolean;
  onSave: () => void;
  /** the device skin's sentence when this browser has no passkeys (/device names its own Advanced section) */
  noPasskeyNote?: string;
}) {
  const title = facts.platformAuthenticator ? "Save with Face ID / fingerprint" : "Save with a passkey";
  const button = facts.saved ? "Add a passkey" : title;
  const disabled = !facts.webauthn || busy || !facts.canSave;
  if (skin === "app") {
    return (
      <div data-testid="save-passkey" data-skin="app" className="rounded-2xl border border-x-border bg-white p-4 text-x-text">
        <p className="text-[17px] font-bold leading-6">{title}</p>
        <p className="mt-1 text-[14px] leading-5 text-x-sec">{passkeyCardSentence(facts, "app")}</p>
        <div className="mt-3">
          <button
            type="button"
            data-testid="onboard-save-passkey"
            disabled={disabled}
            onClick={onSave}
            className="inline-flex h-11 items-center justify-center rounded-full bg-x-black-btn px-5 text-[16px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : button}
          </button>
        </div>
      </div>
    );
  }
  const card: React.CSSProperties = { border: "1px solid #2f3336", borderRadius: 16, padding: 16, background: "#000", color: "#e7e9ea" };
  const btn: React.CSSProperties = { borderRadius: 9999, padding: "8px 16px", fontWeight: 700, border: "1px solid #536471", background: "#eff3f4", color: "#0f1419", cursor: "pointer" };
  const muted: React.CSSProperties = { color: "#71767b", fontSize: 13 };
  return (
    <div style={card} data-testid="save-passkey" data-order="1">
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={muted}>{passkeyCardSentence(facts, "device", noPasskeyNote)}</div>
      <div style={{ marginTop: 12 }}>
        <button style={btn} disabled={disabled} onClick={onSave}>
          {button}
        </button>
      </div>
    </div>
  );
}
