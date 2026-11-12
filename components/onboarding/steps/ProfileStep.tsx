"use client";
// PUBLIC GO-LIVE — the guided first run, step 2 of 3: This is you.
//
// The account you signed in with IS you in Totem (your root): its picture, name and username, filled in from Farcaster
// (GET /api/onboarding?profile=1, answered in this tab) and editable here. The username is Totem's own name for you; it
// defaults to your Farcaster username, and when that is already someone else's inside Totem the step says so and offers
// three free alternatives (and that your Farcaster username stays what it is). Your Farcaster-verified X account is a
// row with a Show toggle (GET /api/onboarding?x=1: the whole downloaded X index, never a per-account request); no
// verified X account, no row. One Continue writes it all (POST /api/onboarding).
//
// The Farcaster picture is held until asked when its host is not one the app loads by itself (the profile page's
// held-media rule: loading it tells that host this address viewed it); a picture made on this device needs no host.
// NEVER FAIL OPEN: a profile that cannot be read is an error with Retry; an X check that fails says so with Check again.
//
// SIGN IN WITH X (2026-11-06): a root that signed in with X only is filled in from X the same way (via "x": its X name,
// username and picture, "Your X username stays @u on X"), and any root that signed in with X shows that account as its X
// row ("@u · Signed in with X", with Show) instead of the Farcaster-verified lookup.
import { useCallback, useEffect, useMemo, useState } from "react";
import { mediaHostAllowed } from "@/components/CastCard";
import { isLocalAvatar, localAvatar } from "@/lib/identity/localAvatar";
import { readXHandleAnswer, type XHandleAnswer } from "@/lib/onboarding/xHandle";
import { StepShell } from "../Progress";

export interface RootProfile {
  name: string;
  handle: string;
  avatarUrl: string | null;
  farcasterPfp: string | null;
  fname: string | null;
  wanted: string;
  taken: boolean;
  suggestions: string[];
  xShown: string | null;
  /** SIGN IN WITH X: which account filled this in ("x" for a root that signed in with X only) */
  via: "farcaster" | "x";
  /** SIGN IN WITH X: the X account this root signed in with, when it did */
  xUsername: string | null;
  /** SIGN IN WITH X: that account's picture (X's own image host) */
  xPfp: string | null;
}

/** the words for a taken username (the owner's) */
export function takenSentence(wanted: string): string {
  return `@${wanted} is taken on Totem. These are free:`;
}
export function fnameStaysSentence(fname: string): string {
  return `Your Farcaster username stays @${fname} on Farcaster. This only changes your name inside Totem.`;
}
/** SIGN IN WITH X: the same promise for an X username */
export function xUsernameStaysSentence(username: string): string {
  return `Your X username stays @${username} on X. This only changes your name inside Totem.`;
}

function readProfile(j: unknown): RootProfile | null {
  const p = j && typeof j === "object" ? (j as { profile?: unknown }).profile : null;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.handle !== "string" || typeof o.wanted !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    name: o.name,
    handle: o.handle,
    avatarUrl: str(o.avatarUrl),
    farcasterPfp: str(o.farcasterPfp),
    fname: str(o.fname),
    wanted: o.wanted,
    taken: o.taken === true,
    suggestions: Array.isArray(o.suggestions) ? (o.suggestions as unknown[]).filter((s): s is string => typeof s === "string") : [],
    xShown: str(o.xShown),
    via: o.via === "x" ? "x" : "farcaster",
    xUsername: str(o.xUsername),
    xPfp: str(o.xPfp),
  };
}

export function ProfileStep({ onDone, onBack }: { onDone: (sentence: string | null) => void; onBack: () => void }) {
  const [profile, setProfile] = useState<RootProfile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [taken, setTaken] = useState<{ wanted: string; suggestions: string[] } | null>(null);
  const [useLocal, setUseLocal] = useState(false);
  const [salt, setSalt] = useState(0);
  const [showHeld, setShowHeld] = useState(false);
  const [x, setX] = useState<XHandleAnswer | null>(null);
  const [xTick, setXTick] = useState(0);
  const [showX, setShowX] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReadError(null);
    fetch("/api/onboarding?profile=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        const p = r.ok ? readProfile(j) : null;
        if (!p) {
          setReadError((j && typeof j.error === "string" && j.error) || "your profile could not be read (HTTP " + r.status + ")");
          return;
        }
        setProfile(p);
        setName(p.name);
        setHandle(p.handle);
        setTaken(p.taken ? { wanted: p.wanted, suggestions: p.suggestions } : null);
        setUseLocal(!!p.avatarUrl && p.avatarUrl !== (p.via === "x" ? p.xPfp : p.farcasterPfp));
        // SIGN IN WITH X: the Show toggle starts where the profile stands (the sign-in shows it; This is you can hide it)
        if (p.xUsername) setShowX(p.xShown === p.xUsername);
      })
      .catch(() => {
        if (alive) setReadError("the request could not be made");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    let alive = true;
    setX(null);
    fetch("/api/onboarding?x=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        // a refused or unreadable answer is "unknown" — never "none"
        setX(r.ok ? readXHandleAnswer(j) : { state: "unknown", reason: (j && typeof j.error === "string" && j.error) || "HTTP " + r.status });
      })
      .catch(() => {
        if (alive) setX({ state: "unknown", reason: "the request could not be made" });
      });
    return () => {
      alive = false;
    };
  }, [xTick]);

  const localPic = useMemo(() => localAvatar((handle || "you") + (salt ? "#" + salt : "")), [handle, salt]);
  // SIGN IN WITH X: the account picture is the X one for a root that signed in with X only
  const viaX = profile?.via === "x";
  const fcPic = (viaX ? profile?.xPfp : profile?.farcasterPfp) ?? null;
  const accountWord = viaX ? "X" : "Farcaster";
  // the picture to save: the Farcaster one, or one made on this device (a picture saved earlier is kept until changed)
  const keptLocal = salt === 0 && profile?.avatarUrl && isLocalAvatar(profile.avatarUrl) ? profile.avatarUrl : null;
  const chosen = !useLocal && fcPic ? fcPic : (keptLocal ?? localPic);
  // a Farcaster picture on a host the app does not load by itself waits until asked (a blank circle until then)
  const held = !!chosen && !mediaHostAllowed(chosen) && !showHeld;

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), handle, avatarUrl: chosen, showX: (!!profile?.xUsername || x?.state === "connected") && showX }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        if (j && j.code === "handle_taken") setTaken({ wanted: handle, suggestions: Array.isArray(j.suggestions) ? j.suggestions : [] });
        setError((j && typeof j.error === "string" && j.error) || "your profile was not saved (HTTP " + r.status + ")");
        return;
      }
      onDone(null);
    } catch {
      setError("your profile was not saved: the request could not be made");
    } finally {
      setBusy(false);
    }
  }, [name, handle, chosen, x, showX, onDone, profile]);

  if (readError) {
    return (
      <StepShell step="profile" title="This is you" onBack={onBack}>
        <div data-testid="onboard-profile-error" role="alert">
          <p className="text-[15px] leading-5 text-[#f4212e]">We couldn&apos;t read your profile: {readError}.</p>
          <button type="button" data-testid="onboard-profile-retry" onClick={() => setTick((t) => t + 1)} className="mt-3 inline-flex h-10 items-center rounded-full bg-x-blue px-5 text-[15px] font-bold text-white">
            Try again
          </button>
        </div>
      </StepShell>
    );
  }
  if (!profile) {
    return (
      <StepShell step="profile" title="This is you" onBack={onBack}>
        <p data-testid="onboard-profile-reading" className="text-[14px] text-x-sec">
          Reading your profile…
        </p>
      </StepShell>
    );
  }

  const validHandle = /^[a-z0-9_]{1,30}$/.test(handle);
  const stillTaken = !!taken && taken.wanted === handle;
  return (
    <StepShell step="profile" title="This is you" onBack={onBack} onNext={() => void save()} nextLabel={busy ? "Saving…" : "Continue"} nextDisabled={busy || !name.trim() || !validHandle || stillTaken}>
      <div data-testid="onboard-profile" data-handle={handle} className="flex items-center gap-3">
        {held ? (
          <span data-testid="onboard-profile-picture" data-held="true" aria-hidden="true" className="h-16 w-16 shrink-0 rounded-full bg-x-pill" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img data-testid="onboard-profile-picture" src={chosen} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-full object-cover" />
        )}
        <div className="grid min-w-0 flex-1 gap-1">
          <input
            data-testid="onboard-profile-name"
            aria-label="Name"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            className="w-full rounded-md border border-transparent px-1 py-0.5 text-[20px] font-extrabold leading-6 outline-none hover:border-[#cfd9de] focus:border-x-blue"
          />
          <label className="flex items-center px-1 text-[15px] text-x-sec">
            <span aria-hidden="true">@</span>
            <input
              data-testid="onboard-profile-handle"
              aria-label="Username"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30))}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-transparent px-0.5 py-0.5 outline-none hover:border-[#cfd9de] focus:border-x-blue"
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <button
          type="button"
          data-testid="onboard-profile-shuffle"
          onClick={() => {
            setUseLocal(true);
            setSalt((s) => s + 1);
          }}
          className="h-8 rounded-full border border-x-border-dark px-3 font-bold hover:bg-x-hover"
        >
          Another picture
        </button>
        {fcPic && useLocal ? (
          <button type="button" data-testid="onboard-profile-fc-picture" onClick={() => setUseLocal(false)} className="h-8 rounded-full border border-x-border-dark px-3 font-bold hover:bg-x-hover">
            Use my {accountWord} picture
          </button>
        ) : null}
        {held ? (
          <button type="button" data-testid="onboard-profile-show-held" onClick={() => setShowHeld(true)} className="font-bold text-x-blue hover:underline">
            Show my {accountWord} picture
          </button>
        ) : null}
      </div>

      {taken ? (
        <div data-testid="onboard-profile-taken" data-picked={handle} className={"rounded-2xl border p-3 " + (stillTaken ? "border-[#ffd40099] bg-[#ffd4000d]" : "border-x-border")}>
          <p className="text-[15px] font-bold leading-5">{takenSentence(taken.wanted)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {taken.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                data-testid="onboard-profile-suggestion"
                aria-pressed={s === handle}
                onClick={() => setHandle(s)}
                className={"h-9 rounded-full border px-4 text-[15px] font-bold " + (s === handle ? "border-x-blue bg-[#1d9bf01a] text-x-blue" : "border-x-border-dark bg-white hover:bg-x-hover")}
              >
                @{s}
              </button>
            ))}
          </div>
          {profile.fname ? <p className="mt-2 text-[13px] leading-4 text-x-sec">{fnameStaysSentence(profile.fname)}</p> : null}
          {viaX && profile.xUsername ? <p className="mt-2 text-[13px] leading-4 text-x-sec">{xUsernameStaysSentence(profile.xUsername)}</p> : null}
        </div>
      ) : null}

      {profile.xUsername ? (
        // SIGN IN WITH X: the X account this root signed in with (X itself said so), with the same Show toggle
        <label data-testid="onboard-x-row" data-state="signed-in" className="flex items-center gap-3 rounded-2xl border border-x-border p-3">
          <span className="min-w-0 flex-1 text-[15px] leading-5">
            <span data-testid="onboard-x-signed-in" className="font-bold">
              @{profile.xUsername}
            </span>
            <span className="text-x-sec"> · Signed in with X</span>
          </span>
          <span className="text-[14px] font-bold">Show</span>
          <input type="checkbox" role="switch" data-testid="onboard-x-show" checked={showX} onChange={(e) => setShowX(e.target.checked)} className="h-5 w-5 accent-x-blue" />
        </label>
      ) : x === null ? (
        <p data-testid="onboard-x-row" data-state="checking" className="text-[13px] text-x-sec">
          Checking for an X account on your Farcaster profile…
        </p>
      ) : x.state === "connected" ? (
        <label data-testid="onboard-x-row" data-state="connected" className="flex items-center gap-3 rounded-2xl border border-x-border p-3">
          <span className="min-w-0 flex-1 text-[15px] leading-5">
            <span data-testid="onboard-x-connected" className="font-bold">
              @{x.handle}
            </span>
            <span className="text-x-sec"> · Verified on your Farcaster account</span>
          </span>
          <span className="text-[14px] font-bold">Show</span>
          <input type="checkbox" role="switch" data-testid="onboard-x-show" checked={showX} onChange={(e) => setShowX(e.target.checked)} className="h-5 w-5 accent-x-blue" />
        </label>
      ) : x.state === "unknown" ? (
        <p data-testid="onboard-x-row" data-state="unknown" className="text-[13px] text-x-sec">
          We couldn&apos;t check for an X account on your Farcaster profile just now.{" "}
          <button type="button" data-testid="onboard-x-retry" onClick={() => setXTick((t) => t + 1)} className="font-bold text-x-blue hover:underline">
            Check again
          </button>
        </p>
      ) : null}

      {error ? (
        <p data-testid="onboard-profile-save-error" role="alert" className="text-[14px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
    </StepShell>
  );
}
