"use client";
// PUBLIC GO-LIVE — the guided first run, step 3 of 3: Keep your account.
//
// One button, the same inline save every surface makes (components/device/SaveMoment.tsx saveWithPasskey: the ways-in
// list is read FIRST, so a tap while it is unreadable registers nothing; custody's errors become plain words). No seed
// phrase here: the 24 words stay an optional backup under Advanced on /device. "Not now" is the quieter choice: it keeps
// the identity in this browser only (window.__layersDevice.persist()), and says so before it is pressed.
//
// A save that lands hands off to the home feed (the facts read after it say "saved"); its sentence is the toast, so a
// passkey that stays on this device ("This passkey works on this device. …") is still said.
import { useState } from "react";
import { KEEP_TOAST, saveWithPasskey, type PasskeySaveFacts } from "@/components/device/SaveMoment";
import { StepShell } from "../Progress";

/** step 3's one line (the owner's words) */
export const SAVE_LEAD = "One tap with Face ID. No password, nothing to write down. Works on your other devices too.";
/** said beside "Not now", before it is pressed */
export const NOT_NOW_NOTE = "Not now keeps it in this browser only.";

/** the button's words: Face ID where this device has a built-in authenticator, a passkey otherwise */
export function saveButtonLabel(facts: PasskeySaveFacts | null): string {
  return facts && !facts.platformAuthenticator ? "Save with a passkey" : "Save with Face ID";
}

export function SaveStep({
  facts,
  kept,
  onSaved,
  onNotNow,
  onNext,
  onBack,
}: {
  /** null while the ways-in list is being read (the button waits) */
  facts: PasskeySaveFacts | null;
  /** the identity is kept in this browser already (restored or persisted) */
  kept: boolean;
  onSaved: (sentence: string) => void;
  /** "Not now": the identity is kept in this browser (the sentence to say, or null when it already was) */
  onNotNow: (sentence: string | null) => void;
  /** already saved (a link to this step): Continue */
  onNext: () => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = facts?.saved === true;
  const canPasskey = !!facts && facts.webauthn && facts.canSave;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const sentence = await saveWithPasskey();
      onSaved(sentence);
    } catch (e) {
      setError("Not saved: " + ((e as Error)?.message || "the passkey was not saved"));
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (kept) {
      onNotNow(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = (window as unknown as { __layersDevice?: { persist?: () => Promise<void> } }).__layersDevice;
      if (!d?.persist) throw new Error("this page is still starting; try again in a moment.");
      await d.persist();
      onNotNow(KEEP_TOAST);
    } catch (e) {
      setError("Not kept: " + ((e as Error)?.message || "could not keep this identity"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell step="save" title="Keep your account" lead={SAVE_LEAD} onBack={onBack} onNext={saved ? onNext : undefined}>
      {saved ? (
        <p data-testid="onboard-saved" className="text-[15px] font-bold text-[#00ba7c]">
          Saved. Your passkey opens this identity here.
        </p>
      ) : facts === null ? (
        <p data-testid="onboard-save-reading" className="text-[14px] text-x-sec">
          Checking how this identity is saved…
        </p>
      ) : (
        <div className="grid gap-3">
          <button
            type="button"
            data-testid="onboard-save-passkey"
            disabled={busy || !canPasskey}
            onClick={() => void save()}
            className="inline-flex h-12 items-center justify-center rounded-full bg-x-black-btn px-6 text-[17px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : saveButtonLabel(facts)}
          </button>
          {!facts.webauthn ? (
            <p data-testid="onboard-save-no-passkey" className="text-[14px] leading-5 text-x-sec">
              This browser can&apos;t save a passkey.
            </p>
          ) : null}
          <button
            type="button"
            data-testid="onboard-keep"
            disabled={busy}
            onClick={() => void notNow()}
            className="inline-flex h-12 items-center justify-center rounded-full border border-x-border-dark bg-white px-6 text-[17px] font-bold text-x-text hover:bg-x-hover disabled:opacity-50"
          >
            Not now
          </button>
          <p data-testid="onboard-keep-note" className="text-center text-[14px] leading-5 text-x-sec">
            {NOT_NOW_NOTE}
          </p>
        </div>
      )}
      {error ? (
        <p data-testid="onboard-save-error" role="alert" className="text-[14px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
    </StepShell>
  );
}
