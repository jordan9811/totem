"use client";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — Settings › Security on the owner service: how this device is signed in and for
// how long, "Sign out of this device", the Face ID / fingerprint sign-ins (add for this device, rename, remove, "Lost
// this device?"), and "sign out everywhere". Everything it changes goes through POST /api/owner-login/security, which
// re-checks the session itself; "Sign out of this device" is a plain form POST to /api/owner-login (no script needed).
// The list comes from the server render (router.refresh() re-reads it after a change). Dates are drawn after mount,
// in the owner's own time zone (the server's would differ, and a hydration mismatch is not worth a date).
//
// Review fixes here:
//   UX-1   every passkey row has "Lost this device?": ONE action that removes its passkey AND signs out every device
//          (the only thing that is enough for a lost phone); Remove's confirm says what it does not do, and warns that
//          a synced passkey also stops working on the owner's other devices that share it
//   UX-2   the hint reads "used on this device" (a synced passkey can be used here without being made here), and a
//          hint never hides "Add … for this device" from a fresh passphrase session — a real duplicate is caught by
//          the browser (excludeCredentials) and said plainly
//   UX-5   no "Something went wrong." in front of messages that already explain; a passkey removed elsewhere meanwhile
//          is "already removed" and the list refreshes; no Add button on a device with no Face ID, fingerprint or
//          Windows Hello
//   UX-6   "Sign out of this device", for a borrowed or shared computer
//   UX-9   the sign-out-everywhere note says how THIS device gets back in (one tap, or the passphrase); every sign-out
//          comes back to this page after signing in; removing the passkey this session signed in with says so first
//   UX-15  no server jargon (APP_URL, "volume") in anything the owner reads
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Row, SettingsGroup } from "@/components/settings/Chrome";
import { AddPasskeyButton } from "@/components/owner/AddPasskey";
import { GENERIC_UNLOCK, OwnerPasskeyError, ownerSecurityAction, platformPasskeyAvailable, unlockName } from "@/lib/owner/passkeyClient";
import { OWNER_LOGIN_API, OWNER_LOGIN_PATH, OWNER_PASSKEY_NAME_MAX, OWNER_SECURITY_PATH } from "@/lib/platform/owner-paths";

export interface OwnerSecurityInitial {
  passkeys: { slot: string; name: string; createdAt: number; lastUsedAt: number | null; synced: boolean }[];
  /** the slot this device's hint cookie names, if any */
  thisDeviceSlot: string | null;
  session: {
    via: "passphrase" | "passkey";
    passkeyName: string | null;
    /** the passkey this session signed in with (null for a passphrase session) */
    slot: string | null;
    expiresAt: number;
    canEnroll: boolean;
  };
  sessionDays: number;
  max: number;
  /** the service has Face ID / fingerprint switched on (a usable APP_URL): passkeys can be added at all */
  passkeysAvailable: boolean;
  /** the list could not be read */
  readError: string | null;
}

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** where every sign-out lands: the sign-in page, then back here */
export const BACK_HERE = `${OWNER_LOGIN_PATH}?next=${encodeURIComponent(OWNER_SECURITY_PATH)}`;

/** Remove's confirm, after "Remove <name>?" (review UX-1, UX-9): what it ends, what it does not, what to use instead */
export function removeConfirmTail(isThisSession: boolean, synced: boolean): string {
  return (
    (isThisSession ? "This device signs in with it, so you'll be signed out now." : "Devices signed in with it are signed out.") +
    (synced ? " It also stops working on your other devices that share it through iCloud Keychain or your Google account." : "") +
    " Lost or stolen? Use “Lost this device?” instead: it also signs out every other device."
  );
}

/** "Lost this device?"'s confirm, after "Lost <name>?" (review UX-1): it is the one action enough for a lost device */
export function lostConfirmTail(backIn: "one tap" | "your passphrase"): string {
  return `This removes its Face ID / fingerprint sign-in and signs out every device, this one too. You'll sign back in here with ${backIn}. If you can, also erase the lost device (Find My on an iPhone or iPad).`;
}

/** the sign-out-everywhere note (review UX-9): how THIS device gets back in */
export function everywhereNote(backIn: "one tap" | "your passphrase"): string {
  return (
    "Signs out every device, this one included. Face ID / fingerprint sign-ins stay, so " +
    (backIn === "one tap"
      ? "getting back in here is one tap."
      : "they still work on the devices that have them. This device has none yet, so you'll need your passphrase to get back in here.") +
    " Lost a device that never added Face ID / fingerprint? Use this."
  );
}

const linkBtn = "text-[14px] hover:underline disabled:opacity-60";

export function OwnerSecurityPanel({ initial }: { initial: OwnerSecurityInitial }) {
  const router = useRouter();
  const mounted = useMounted();
  const [error, setError] = useState<string | null>(initial.readError);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<{ slot: string; what: "remove" | "lost" } | null>(null);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unlock, setUnlock] = useState(GENERIC_UNLOCK);
  /** null until checked: does this device have Face ID, a fingerprint reader or Windows Hello at all? */
  const [platformOk, setPlatformOk] = useState<boolean | null>(null);

  useEffect(() => {
    setUnlock(unlockName());
    let live = true;
    void platformPasskeyAvailable().then((ok) => {
      if (live) setPlatformOk(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const { passkeys, thisDeviceSlot, session } = initial;
  const thisDevicePasskey = thisDeviceSlot ? passkeys.find((p) => p.slot === thisDeviceSlot) ?? null : null;
  const thisDeviceHasOne = thisDevicePasskey !== null;

  async function run(key: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      return await ownerSecurityAction(body);
    } catch (e) {
      const err = e instanceof OwnerPasskeyError ? e : null;
      if (err?.kind === "signed-out") {
        window.location.assign(BACK_HERE);
        return null;
      }
      if (err?.kind === "gone") {
        // removed from another device meanwhile: say so, and show the list as it is now
        setRenaming(null);
        setConfirm(null);
        setNotice(err.message);
        router.refresh();
        return null;
      }
      setError(err?.message ?? "The service couldn't do that just now. Try again in a moment.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function rename(slot: string) {
    const r = await run("rename:" + slot, { action: "rename", slot, name: draft });
    if (r) {
      setRenaming(null);
      router.refresh();
    }
  }

  async function remove(slot: string) {
    const r = await run("remove:" + slot, { action: "remove", slot });
    if (!r) return;
    setConfirm(null);
    if (r.signedOut === true) {
      window.location.assign(BACK_HERE);
      return;
    }
    router.refresh();
  }

  async function lost(slot: string) {
    const r = await run("lost:" + slot, { action: "lost", slot });
    if (r) window.location.assign(BACK_HERE);
  }

  async function everywhere() {
    const r = await run("everywhere", { action: "signout-everywhere" });
    if (r) window.location.assign(BACK_HERE);
  }

  const via =
    session.via === "passphrase" ? "your passphrase" : session.passkeyName ? `Face ID / fingerprint (${session.passkeyName})` : "Face ID / fingerprint";
  /** how this device gets back in after a sign-out (`removing`: a passkey that goes with it) */
  const backInHere = (removing: string | null): "one tap" | "your passphrase" => (thisDevicePasskey && thisDevicePasskey.slot !== removing ? "one tap" : "your passphrase");

  return (
    <div data-testid="owner-security">
      {error ? (
        <p role="alert" className="mx-4 my-3 rounded-2xl border border-[#fdc9ce] bg-[#f4212e0d] p-3 text-[15px] leading-5 text-[#f4212e]" data-testid="owner-security-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mx-4 my-3 text-[15px] text-x-text" data-testid="owner-security-notice">
          {notice}
        </p>
      ) : null}

      <SettingsGroup title="This device">
        <Row
          testid="owner-security-session"
          label={`Signed in with ${via}`}
          sub={
            (mounted ? `Stays signed in until ${day(session.expiresAt)}. ` : "") +
            `Each device stays signed in for ${initial.sessionDays} days. ` +
            (thisDeviceHasOne ? "Signing in again here is one tap." : "Signing in again here needs your passphrase until this device has Face ID / fingerprint.")
          }
        />
        {/* review UX-6: a plain form (works with no script) — the passphrase route clears this device's cookie and
            lands on the sign-in page; nothing else is signed out */}
        <form method="post" action={OWNER_LOGIN_API} className="border-t border-x-border px-4 py-3" data-testid="owner-signout-this-device-form">
          <input type="hidden" name="logout" value="1" />
          <button type="submit" className="text-[15px] font-bold text-[#f4212e] hover:underline" data-testid="owner-signout-this-device">
            Sign out of this device
          </button>
          <p className="mt-1 text-[13px] leading-4 text-x-sec">On a borrowed or shared computer, do this when you&apos;re done.</p>
        </form>
      </SettingsGroup>

      <SettingsGroup
        title={`Face ID / fingerprint (${passkeys.length} of ${initial.max})`}
        note="Sign in with one tap instead of typing the passphrase. The passphrase still works everywhere, and your 24 words are only for disaster recovery."
      >
        {passkeys.length === 0 ? <Row label="None yet" sub="Add one on each device you use: your phone, your laptop." /> : null}
        {passkeys.map((p) => {
          const isThisSession = session.slot === p.slot;
          return (
            <div key={p.slot} className="border-b border-x-border px-4 py-3 last:border-b-0" data-testid="owner-passkey-row" data-slot={p.slot}>
              {renaming === p.slot ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(p.slot);
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={OWNER_PASSKEY_NAME_MAX}
                    autoFocus
                    aria-label="Name"
                    className="min-w-0 flex-1 rounded-md border border-x-border-dark px-3 py-1.5 text-[15px] outline-none focus:border-x-blue"
                    data-testid="owner-passkey-name"
                  />
                  <button type="submit" disabled={!draft.trim() || busy !== null} className="rounded-full bg-x-black-btn px-4 py-1.5 text-[14px] font-bold text-white disabled:opacity-60">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="px-2 text-[14px] text-x-sec hover:underline">
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <p className="text-[15px] leading-5" data-testid="owner-passkey-label">
                    {p.name}
                    {p.slot === thisDeviceSlot ? <span className="text-x-sec"> · used on this device</span> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
                    {mounted ? `Added ${day(p.createdAt)}${p.lastUsedAt ? ` · last used ${day(p.lastUsedAt)}` : " · not used yet"} · ` : ""}
                    {p.synced ? "synced passkey (works on your other devices signed in to the same account)" : "this device only"}
                  </p>
                  {confirm?.slot === p.slot && confirm.what === "remove" ? (
                    <div className="mt-2" data-testid="owner-passkey-remove-confirm-panel">
                      <p className="text-[15px] leading-5">
                        Remove <strong>{p.name}</strong>? {removeConfirmTail(isThisSession, p.synced)}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void remove(p.slot)}
                          disabled={busy !== null}
                          className="rounded-full bg-[#f4212e] px-4 py-1.5 text-[14px] font-bold text-white disabled:opacity-60"
                          data-testid="owner-passkey-remove-confirm"
                        >
                          Remove
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className="px-2 text-[14px] text-x-sec hover:underline">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : confirm?.slot === p.slot && confirm.what === "lost" ? (
                    <div className="mt-2" data-testid="owner-passkey-lost-confirm-panel">
                      <p className="text-[15px] leading-5">
                        Lost <strong>{p.name}</strong>? {lostConfirmTail(backInHere(p.slot))}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void lost(p.slot)}
                          disabled={busy !== null}
                          className="rounded-full bg-[#f4212e] px-4 py-1.5 text-[14px] font-bold text-white disabled:opacity-60"
                          data-testid="owner-passkey-lost-confirm"
                        >
                          Remove it and sign out everywhere
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className="px-2 text-[14px] text-x-sec hover:underline">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(p.name);
                          setRenaming(p.slot);
                          setConfirm(null);
                        }}
                        className={`${linkBtn} text-x-blue`}
                        data-testid="owner-passkey-rename"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirm({ slot: p.slot, what: "remove" });
                          setRenaming(null);
                        }}
                        className={`${linkBtn} text-[#f4212e]`}
                        data-testid="owner-passkey-remove"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirm({ slot: p.slot, what: "lost" });
                          setRenaming(null);
                        }}
                        className={`${linkBtn} text-[#f4212e]`}
                        data-testid="owner-passkey-lost"
                      >
                        Lost this device?
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="px-4 py-3" data-testid="owner-add-area">
          {!initial.passkeysAvailable ? (
            <p className="text-[14px] leading-5 text-x-sec" data-testid="owner-passkeys-off">
              Face ID / fingerprint sign-in isn&apos;t switched on for this service yet. Ask Claude to finish setting it up.
            </p>
          ) : passkeys.length >= initial.max ? (
            <p className="text-[14px] leading-5 text-x-sec">That&apos;s the most this service keeps. Remove one to add another.</p>
          ) : session.canEnroll ? (
            platformOk === false ? (
              <p className="text-[14px] leading-5 text-x-sec" data-testid="owner-no-platform">
                This device has no Face ID, fingerprint or Windows Hello set up, so it can&apos;t add one.
              </p>
            ) : (
              <>
                {thisDevicePasskey ? (
                  <p className="mb-2 text-[14px] leading-5 text-x-sec" data-testid="owner-enroll-despite-hint">
                    This device is set to sign in with {thisDevicePasskey.name}. If that didn&apos;t work here, add {unlock} for this device:
                  </p>
                ) : null}
                <AddPasskeyButton
                  onAdded={(p) => {
                    setNotice(`${p.name} now signs in with ${unlock}.`);
                    router.refresh();
                  }}
                  onExists={() => setNotice(`This device can already sign in with ${unlock}. Next time, choose it on the sign-in page.`)}
                />
              </>
            )
          ) : thisDevicePasskey ? (
            <p className="text-[14px] leading-5 text-x-sec" data-testid="owner-this-device-has-one">
              This device signs in with Face ID / fingerprint ({thisDevicePasskey.name}).
            </p>
          ) : (
            <p className="text-[14px] leading-5 text-x-sec" data-testid="owner-enroll-needs-passphrase">
              To add Face ID / fingerprint for this device,{" "}
              <a className="text-x-blue hover:underline" href={BACK_HERE}>
                sign in with your passphrase
              </a>{" "}
              first. (It keeps a stolen session from adding its own way back in.)
            </p>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Sign out everywhere" note={everywhereNote(backInHere(null))}>
        <div className="px-4 py-3">
          {confirmEverywhere ? (
            <div>
              <p className="text-[15px] leading-5">Sign out every device now, including this one?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void everywhere()}
                  disabled={busy !== null}
                  className="rounded-full bg-[#f4212e] px-4 py-1.5 text-[14px] font-bold text-white disabled:opacity-60"
                  data-testid="owner-signout-everywhere-confirm"
                >
                  Sign out everywhere
                </button>
                <button type="button" onClick={() => setConfirmEverywhere(false)} className="px-2 text-[14px] text-x-sec hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEverywhere(true)}
              className="rounded-full border border-[#fdc9ce] px-4 py-2 text-[15px] font-bold text-[#f4212e] hover:bg-[#f4212e0d]"
              data-testid="owner-signout-everywhere"
            >
              Sign out everywhere
            </button>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}
