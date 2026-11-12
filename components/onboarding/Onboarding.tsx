"use client";
// PUBLIC GO-LIVE — THE GUIDED FIRST RUN (/welcome), the owner's three steps (2026-11-05): Sign in with Farcaster → This is
// you → Keep your account → the home feed, signed in as that account, with "Pick up where you left off" above it (find
// your people, bring your X posts, make a persona: all optional — a persona is NEVER asked for here). Before step 1, the
// welcome screen (the landing's own doors). One screen per step, three dots, Back, mobile first, the app's own look,
// inside the app group (so the visitor's device boots here, as on every app page).
//
// Moving between steps is SOFT (state only, next/link out): an unsaved identity lives in this document alone, and a full
// page load would replace it. Where the visitor is comes from what the device holds — its public self, its saved ways in,
// its personas — through the pure step machine in lib/onboarding/state.ts; what was skipped is kept for this document
// only (a module variable, so a soft round trip to Settings › Import from X keeps it; a reload forgets it). Nothing about
// the flow is stored anywhere.
//
// THE RETURNING-VISITOR RULE: an identity restored from this browser at boot, or unlocked here, that already has someone
// to be (a Farcaster sign-in, or a persona made earlier), never sees the flow — it goes straight to /home. NEVER FAIL OPEN: a fact that cannot be read is an error with
// a Retry, never "not signed in" or "not saved".
//
// PUBLIC GO-LIVE (F5): AN EXPLICIT TARGET (lib/onboarding/state.ts readTarget / landingStep) — #farcaster, #profile,
// #save, #next or #unlock (read here: the app's own links put it in the hash, which never reaches the server), or a
// ?step= from the server's searchParams. It decides the first screen even for a returning visitor that is done and past
// this document's skips (Settings' Farcaster row, "Continue setting up", the composer's "sign in again", the nudge's
// Unlock all land where they said), and the first move spends it. A soft navigation to /welcome?step=… while this page is
// open takes the new one; a hash change does too.
//
// SIGN IN WITH X (2026-11-06): step 1 also offers "Continue with X" (components/x/XSignIn.tsx) once the site carries an X
// app (the device env's X_SIGNIN=on; without it the button says Soon, exactly as before). x.com replaces this document, so
// the X path comes back through /welcome/x (components/x/XCallback.tsx), which finishes the sign-in in the tab, notes it as
// made in this document (noteSignedInHere) and lands on This is you (#profile). For the step machine either account is
// "someone to be": its publicSelf fact is the Farcaster sign-in OR the X one.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/Providers";
import { DEVICE_EVENT, deviceBootState } from "@/lib/device/bootState";
import { usePasskeyCaps, type PasskeySaveFacts } from "@/components/device/SaveMoment";
import {
  NO_PROGRESS,
  confirmProfile,
  isPhoneLike,
  signedInHere,
  landingStep,
  previousStep,
  readTarget,
  skip,
  type OnboardingFacts,
  type OnboardingProgress,
  type OnboardingStep,
  type OnboardingTarget,
} from "@/lib/onboarding/state";
import { xSigninHinted } from "@/lib/x/signin/config";
import { Progress } from "./Progress";
import { WelcomeStep } from "./steps/WelcomeStep";
import { FarcasterStep } from "./steps/FarcasterStep";
import { SaveStep } from "./steps/SaveStep";
import { ProfileStep } from "./steps/ProfileStep";

/** what was skipped in THIS document (never stored): survives a soft navigation away and back, not a reload */
let documentProgress: OnboardingProgress = NO_PROGRESS;
let documentUnlocked = false;

/** SIGN IN WITH X: the callback page (/welcome/x, components/x/XCallback.tsx) finished a sign-in in THIS document before it
 *  hands off here with a soft navigation: a sign-in made here is not a returning visitor's, so This is you and Keep your
 *  account follow it (the identity was kept before x.com opened, so the boot counts it as restored) */
export function noteSignedInHere(): void {
  documentProgress = signedInHere({ ...documentProgress, started: true });
}

interface FlowDevice {
  info?: { restored?: boolean; persistent?: boolean } | null;
  isPersistent?: () => boolean;
  custody?: { status?: () => Promise<{ methods?: unknown[]; methodsUnknown?: boolean; webauthn?: boolean; platformAuthenticator?: boolean }> };
}
const flowDevice = (): FlowDevice | null => (typeof window === "undefined" ? null : ((window as unknown as { __layersDevice?: FlowDevice }).__layersDevice ?? null));

interface DeviceFacts {
  /** a Farcaster account is signed in on this identity */
  publicSelf: boolean;
  /** SIGN IN WITH X: an X account is signed in on this identity */
  x: boolean;
  save: PasskeySaveFacts;
  restored: boolean;
  kept: boolean;
  /** an identity was unlocked in this document BEFORE these facts were read (F10: with the restored flag, the facts that
   *  make a visitor "returning" — read together, so facts read before an unlock never count it as returning) */
  unlockedAtRead: boolean;
}

/** read the device's own facts (THROWS a plain reason when one cannot be read: never a falsy default) */
async function readDeviceFacts(): Promise<DeviceFacts> {
  const unlockedAtRead = documentUnlocked;
  const d = flowDevice();
  if (!d?.custody?.status) throw new Error("this page is still starting");
  const [st, ob] = await Promise.all([
    d.custody.status(),
    fetch("/api/onboarding", { cache: "no-store" }).then(async (r) => {
      const j = (await r.json().catch(() => null)) as { publicSelf?: unknown; xSignedIn?: unknown; error?: unknown } | null;
      if (!r.ok || !j || typeof j.publicSelf !== "boolean") throw new Error(j && typeof j.error === "string" ? j.error : "your Farcaster sign-in could not be checked (HTTP " + r.status + ")");
      // SIGN IN WITH X: the same answer says whether an X account is signed in (never read as "no" when it is missing)
      if (typeof j.xSignedIn !== "boolean") throw new Error("your X sign-in could not be checked (HTTP " + r.status + ")");
      return { fc: j.publicSelf, x: j.xSignedIn };
    }),
  ]);
  if (st.methodsUnknown !== false) throw new Error("your saved ways in could not be read just now");
  const saved = Array.isArray(st.methods) && st.methods.length > 0;
  const restored = d.info?.restored === true;
  const kept = restored || d.info?.persistent === true || (typeof d.isPersistent === "function" && d.isPersistent());
  return { publicSelf: ob.fc, x: ob.x, save: { webauthn: st.webauthn === true, platformAuthenticator: st.platformAuthenticator === true, saved, canSave: true }, restored, kept, unlockedAtRead };
}

export function Onboarding({ from, target: linkTarget = null }: { from: string | null; target?: OnboardingTarget | null }) {
  const app = useApp();
  const router = useRouter();
  const caps = usePasskeyCaps();
  const [ready, setReady] = useState(false);
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [progress, setProgressState] = useState<OnboardingProgress>(() => (from === "anon" ? { ...documentProgress, started: true } : documentProgress));
  const [pinned, setPinned] = useState<OnboardingStep | null>(null);
  const [phone, setPhone] = useState(false);
  // SIGN IN WITH X: the site's hint (UI only; the device's own gate decides whether a sign-in may start). Read after mount:
  // the server render has no tab env, and the steps render only once the device is up anyway.
  const [xArmed, setXArmed] = useState(false);
  // PUBLIC GO-LIVE (F5): the link's explicit target, until the first move spends it
  const [target, setTarget] = useState<OnboardingTarget | null>(linkTarget);
  // an unlock made on THIS page, waiting for the facts read after it (they spend the #unlock target)
  const unlockedHere = useRef(false);
  const setProgress = useCallback((p: OnboardingProgress) => {
    documentProgress = p;
    setProgressState(p);
  }, []);

  useEffect(() => {
    setPhone(isPhoneLike(navigator.userAgent, typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches));
    setXArmed(xSigninHinted());
    // F5: the hash carries the app's own targets (it never reaches the server); ?step= wins when both are there. Read now
    // and once more after this tick (a soft navigation may set the hash just after the page mounts), and on a hash change
    const readHash = () => {
      if (linkTarget) return;
      const fromHash = readTarget(null, window.location.hash);
      if (fromHash) setTarget(fromHash);
    };
    readHash();
    const later = window.setTimeout(readHash, 0);
    window.addEventListener("hashchange", readHash);
    const sync = () => setReady(deviceBootState().state === "ready");
    sync();
    window.addEventListener(DEVICE_EVENT, sync);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener(DEVICE_EVENT, sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F5: a soft navigation to /welcome?step=… while this page is open lands where the new link said
  useEffect(() => {
    if (!linkTarget) return;
    setTarget(linkTarget);
    setPinned(null);
  }, [linkTarget]);

  // the device facts, read once the device is up and again after anything changes (a sign-in, a save, a persona)
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    readDeviceFacts().then(
      (f) => {
        if (!alive) return;
        setFacts(f);
        setFactsError(null);
        // F5: an unlock spends the #unlock target once facts read after it have arrived
        if (f.unlockedAtRead && unlockedHere.current) {
          unlockedHere.current = false;
          setTarget((t) => (t === "unlock" ? null : t));
        }
      },
      (e) => {
        if (!alive) return;
        setFactsError(String((e as Error)?.message ?? e));
      }
    );
    return () => {
      alive = false;
    };
  }, [ready, tick, app.refreshTick]);

  const reread = useCallback(() => {
    setTick((t) => t + 1);
    app.refresh();
  }, [app]);

  const rosterReady = app.rosterStatus === "ready";
  const ownPersonas = app.personas.filter((p) => p.publicSelf !== true).length;
  // SIGN IN WITH X: the machine's "publicSelf" is the root's own account, signed in with Farcaster OR with X — either one is
  // someone to be, and This is you follows either (lib/onboarding/state.ts is unchanged: one fact, two ways to meet it)
  const machineFacts: OnboardingFacts | null =
    facts && rosterReady ? { publicSelf: facts.publicSelf || facts.x, saved: facts.save.saved, personas: ownPersonas, returning: facts.restored || facts.unlockedAtRead } : null;
  const computed = machineFacts ? landingStep(machineFacts, progress, target) : null;
  const step = pinned ?? computed;

  // the hand-off: the home feed, as the account just signed in (a soft navigation: the identity stays)
  useEffect(() => {
    if (step === "done") router.replace("/home");
  }, [step, router]);

  // every move spends the link's target (F5): from here on the machine's own rules decide
  const forward = (p: OnboardingProgress = progress) => {
    setTarget(null);
    setPinned(null);
    setProgress({ ...p, started: true });
  };
  const back = () => {
    setTarget(null);
    if (step) setPinned(previousStep(step, !!facts?.publicSelf || !!facts?.x));
  };
  const skipStep = (s: OnboardingStep) => {
    setTarget(null);
    setPinned(null);
    setProgress(skip(progress, s));
  };

  if (!ready || (!facts && !factsError) || (!rosterReady && app.rosterStatus !== "error")) {
    return (
      <div data-testid="onboard-loading" className="px-4 py-10">
        <p className="text-[20px] font-extrabold leading-6">One moment</p>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">Getting Totem ready in this browser. Nothing has been sent anywhere yet.</p>
      </div>
    );
  }
  if (factsError || app.rosterStatus === "error") {
    return (
      <div data-testid="onboard-facts-error" role="alert" className="px-4 py-10">
        <p className="text-[20px] font-extrabold leading-6">One moment</p>
        <p className="mt-2 text-[15px] leading-5 text-[#f4212e]">We couldn&apos;t check where you are in setting up: {factsError ?? app.rosterError ?? "your accounts could not be listed"}.</p>
        <button type="button" data-testid="onboard-retry" onClick={reread} className="mt-3 inline-flex h-10 items-center rounded-full bg-x-blue px-5 text-[15px] font-bold text-white">
          Try again
        </button>
      </div>
    );
  }
  if (!step || step === "done") {
    return (
      <div data-testid="onboard-done" className="px-4 py-10">
        <p className="text-[20px] font-extrabold leading-6">You&apos;re set up</p>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">Taking you to your home feed…</p>
      </div>
    );
  }

  const save: PasskeySaveFacts = facts ? { ...facts.save, webauthn: facts.save.webauthn || caps?.webauthn === true } : { webauthn: false, platformAuthenticator: false, saved: false, canSave: false };
  return (
    <div data-testid="onboarding" data-step={step} data-phone={phone ? "true" : "false"}>
      <Progress step={step} />
      {step === "welcome" ? (
        <WelcomeStep
          key={target === "unlock" ? "unlock" : "plain"}
          startOpen={target === "unlock"}
          live={app.publicLive}
          xArmed={xArmed}
          onNew={() => forward()}
          onUnlocked={() => {
            // the unlock target is spent by the facts read AFTER the unlock (below), so the screen does not change under the
            // visitor before those facts say where the unlocked identity is
            documentUnlocked = true;
            unlockedHere.current = true;
            reread();
          }}
        />
      ) : step === "farcaster" ? (
        <FarcasterStep
          signedIn={!!facts?.publicSelf}
          afterReload={!!facts?.restored && !facts?.publicSelf}
          xArmed={xArmed}
          phone={phone}
          onChanged={() => {
            // PUBLIC GO-LIVE (verify): stay on this step once the card has acted in this document, so a sign-in that just
            // verified is SHOWN ("signed in as @you", then Next) instead of the facts moving the visitor on unseen; Next
            // (or Skip) unpins it. A reload derives the step from the facts again (This is you, after a sign-in).
            setPinned("farcaster");
            // a sign-in made here is not a returning visitor's: This is you follows it (lib/onboarding/state.ts)
            setProgress(signedInHere(documentProgress));
            reread();
          }}
          onNext={() => forward()}
          onSkip={() => skipStep("farcaster")}
          onBack={back}
        />
      ) : step === "profile" ? (
        <ProfileStep
          onBack={back}
          onDone={() => {
            forward(confirmProfile(progress));
            reread();
          }}
        />
      ) : (
        <SaveStep
          facts={facts ? save : null}
          kept={!!facts?.kept}
          onSaved={(sentence) => {
            // the facts read after the save say "saved": the machine hands off to the home feed
            app.toast(sentence);
            setTarget(null);
            setPinned(null);
            reread();
          }}
          onNotNow={(sentence) => {
            if (sentence) app.toast(sentence);
            skipStep("save");
            reread();
          }}
          onNext={() => forward()}
          onBack={back}
        />
      )}
    </div>
  );
}
