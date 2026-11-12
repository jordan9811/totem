"use client";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — "Add Face ID / fingerprint for this device": one button, one biometric prompt.
// The name defaults to the kind of device (iPhone, Mac, Windows PC, …); the owner can rename it in Settings › Security.
// Used by the post-sign-in offer (/owner-login/add-passkey) and by the Security page. On success the server has also
// signed this device in WITH the new passkey (review UX-1), so removing it later signs this device out.
//
// Review fixes here:
//   UX-3   "this device already has one" (the browser's InvalidStateError: his passkey synced from another device, or
//          one made here before) is good news, not a red error — the offer turns it into one tap that uses it, which
//          also tells the sign-in page to lead with it next time
//   UX-4   the offer says it is for the owner's OWN device, and "This isn't my device" ends this session within two
//          hours (and when the browser closes) instead of leaving a borrowed computer signed in for a month
//   UX-5   its own words: cancelling says "you're still signed in"; a slow prompt or a refused key says "try again";
//          a signed-out session gets a link back in
//   UX-7   "Not now" says the later route asks for the passphrase once more
//   UX-12  the button names this device's unlock (Face ID, Touch ID, Windows Hello, …) once mounted
import { useEffect, useState } from "react";
import {
  GENERIC_UNLOCK,
  OwnerPasskeyError,
  addPasskeyForThisDevice,
  guessDeviceName,
  ownerSecurityAction,
  platformPasskeyAvailable,
  signInWithPasskey,
  unlockName,
} from "@/lib/owner/passkeyClient";
import { OWNER_LOGIN_PATH, OWNER_SECURITY_PATH, OWNER_SHARED_SESSION_MS } from "@/lib/platform/owner-paths";
import { PasskeyGlyph } from "@/components/owner/OwnerSignIn";

function useUnlockName(): string {
  const [u, setU] = useState(GENERIC_UNLOCK);
  useEffect(() => setU(unlockName()), []);
  return u;
}

export function AddPasskeyButton({
  big = false,
  context = "add",
  onAdded,
  onExists,
  signInAgainNext = OWNER_SECURITY_PATH,
}: {
  big?: boolean;
  /** "offer" right after the passphrase sign-in (it has a "Not now"); "add" on the Security page */
  context?: "offer" | "add";
  onAdded: (p: { slot: string; name: string }) => void;
  /** this device can already sign in with a passkey for this service; without a handler it is said plainly */
  onExists?: () => void;
  signInAgainNext?: string;
}) {
  const unlock = useUnlockName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OwnerPasskeyError | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const p = await addPasskeyForThisDevice(guessDeviceName(), context);
      onAdded(p);
    } catch (e) {
      const err = e instanceof OwnerPasskeyError ? e : new OwnerPasskeyError("unavailable", "The service couldn't do that just now. Try again in a moment.");
      if (err.kind === "exists" && onExists) onExists();
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  const signInHref = `${OWNER_LOGIN_PATH}?next=${encodeURIComponent(signInAgainNext)}`;
  return (
    <div>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        data-testid="owner-add-passkey"
        className={
          big
            ? "flex w-full items-center justify-center gap-3 rounded-full bg-x-black-btn px-6 py-4 text-[18px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60"
            : "flex items-center gap-2 rounded-full bg-x-black-btn px-4 py-2 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60"
        }
      >
        <PasskeyGlyph size={big ? 24 : 18} />
        {busy ? `Waiting for ${unlock}…` : `Add ${unlock} for this device`}
      </button>
      {error ? (
        <p
          role="alert"
          className={`mt-3 text-[15px] leading-5 ${error.kind === "exists" ? "text-x-text" : "text-[#f4212e]"}`}
          data-testid="owner-add-passkey-error"
          data-kind={error.kind}
        >
          {error.message}
          {error.kind === "passphrase" || error.kind === "signed-out" ? (
            <>
              {" "}
              <a className="text-x-blue hover:underline" href={signInHref}>
                {error.kind === "passphrase" ? "Sign in with your passphrase" : "Sign in again"}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

const sharedHours = Math.round(OWNER_SHARED_SESSION_MS / 3_600_000);

/** the offer's choices (its "offer" state): who it is for, the button, "Not now", "This isn't my device" */
export function OfferChoices({
  next,
  busy,
  note,
  onAdded,
  onExists,
  onNotMine,
}: {
  next: string;
  busy: boolean;
  note: string | null;
  onAdded: (p: { slot: string; name: string }) => void;
  onExists: () => void;
  onNotMine: () => void;
}) {
  return (
    <div className="mt-6" data-testid="owner-offer">
      <p className="mb-4 text-[14px] leading-5 text-x-sec" data-testid="owner-offer-own-device">
        Only on your own phone or computer: anyone who can unlock this device would be able to sign in as you.
      </p>
      <AddPasskeyButton big context="offer" signInAgainNext={next} onAdded={onAdded} onExists={onExists} />
      {note ? (
        <p role="alert" className="mt-3 text-[15px] leading-5 text-[#f4212e]">
          {note}
        </p>
      ) : null}
      <div className="mt-5 flex items-center justify-between text-[15px]">
        <a href={next} className="text-x-blue hover:underline" data-testid="owner-offer-skip">
          Not now
        </a>
        <button type="button" onClick={onNotMine} disabled={busy} className="text-x-sec hover:underline disabled:opacity-60" data-testid="owner-offer-not-mine">
          This isn&apos;t my device
        </button>
      </div>
      <p className="mt-3 text-[13px] leading-4 text-x-sec" data-testid="owner-offer-later">
        You can add it later in Settings › Security. It will ask for your passphrase once more.
      </p>
    </div>
  );
}

/** the offer right after a passphrase sign-in. A device that cannot make a passkey is sent straight on to `next`. */
export function AddPasskeyOffer({ next }: { next: string }) {
  const unlock = useUnlockName();
  const [state, setState] = useState<"checking" | "offer" | "added" | "exists" | "shared">("checking");
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    platformPasskeyAvailable().then((ok) => {
      if (!live) return;
      if (ok) setState("offer");
      else window.location.replace(next);
    });
    return () => {
      live = false;
    };
  }, [next]);

  useEffect(() => {
    if (state !== "added") return;
    const t = setTimeout(() => window.location.assign(next), 1800);
    return () => clearTimeout(t);
  }, [state, next]);

  /** review UX-3: use the passkey this device already has — one tap; the sign-in sets this device's hint */
  async function useExisting() {
    setNote(null);
    setBusy(true);
    try {
      window.location.assign(await signInWithPasskey(next));
    } catch (e) {
      setBusy(false);
      setNote(e instanceof OwnerPasskeyError ? e.message : "That didn't work. Tap the button to try again.");
    }
  }

  /** review UX-4: a borrowed or shared computer — this session ends soon, and nothing is added here */
  async function notMine() {
    setNote(null);
    setBusy(true);
    try {
      await ownerSecurityAction({ action: "shared-device" }, "offer");
      setState("shared");
    } catch (e) {
      setNote(e instanceof OwnerPasskeyError ? e.message : "The service couldn't do that just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <p className="mt-6 text-[15px] text-x-sec" data-testid="owner-offer-checking">
        One moment…
      </p>
    );
  }
  if (state === "added") {
    return (
      <div className="mt-6" data-testid="owner-offer-added">
        <p className="rounded-xl border border-x-green px-3 py-2 text-[15px] leading-5 text-x-text">
          Done. <strong>{added}</strong> now signs in with {unlock}. Next time it&apos;s one tap.
        </p>
        <a href={next} className="mt-4 flex w-full items-center justify-center rounded-full bg-x-black-btn px-6 py-3 text-[17px] font-bold text-white hover:bg-x-black-btn-hover">
          Continue
        </a>
      </div>
    );
  }
  if (state === "shared") {
    return (
      <div className="mt-6" data-testid="owner-offer-shared">
        <p className="rounded-xl border border-x-border-dark px-3 py-2 text-[15px] leading-5 text-x-text">
          OK. This computer will sign you out within {sharedHours} hours, and usually when the browser is closed. When you&apos;re done, sign out yourself: Settings › Security › Sign out of this device.
        </p>
        <a href={next} className="mt-4 flex w-full items-center justify-center rounded-full bg-x-black-btn px-6 py-3 text-[17px] font-bold text-white hover:bg-x-black-btn-hover">
          Continue
        </a>
      </div>
    );
  }
  if (state === "exists") {
    return (
      <div className="mt-6" data-testid="owner-offer-exists">
        <p className="rounded-xl border border-x-green px-3 py-2 text-[15px] leading-5 text-x-text">
          Good news: this device can already sign in with {unlock}. Your passkey from another device of yours works here. Use it once now, and it will be the first choice next time.
        </p>
        <button
          type="button"
          onClick={useExisting}
          disabled={busy}
          data-testid="owner-offer-use-existing"
          className="mt-4 flex w-full items-center justify-center gap-3 rounded-full bg-x-black-btn px-6 py-4 text-[18px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60"
        >
          <PasskeyGlyph size={24} />
          {busy ? `Waiting for ${unlock}…` : `Use ${unlock} now`}
        </button>
        {note ? (
          <p role="alert" className="mt-3 text-[15px] leading-5 text-[#f4212e]">
            {note}
          </p>
        ) : null}
        <a href={next} className="mt-5 block text-center text-[15px] text-x-blue hover:underline" data-testid="owner-offer-skip">
          Not now
        </a>
      </div>
    );
  }
  return (
    <OfferChoices
      next={next}
      busy={busy}
      note={note}
      onAdded={(p) => {
        setAdded(p.name);
        setState("added");
      }}
      onExists={() => setState("exists")}
      onNotMine={() => void notMine()}
    />
  );
}
