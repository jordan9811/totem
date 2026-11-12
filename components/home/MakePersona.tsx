"use client";
// PUBLIC GO-LIVE — MAKE A PERSONA, on the home feed's "Pick up where you left off" card (components/home/PickUp.tsx).
// It was the guided first run's last, forced step; the owner moved it here (2026-11-05): a persona is OPTIONAL — your
// Farcaster account is you, and a persona is another face you can add whenever you want.
//
// A name, a handle, a picture made on this device (lib/identity/localAvatar.ts: no third-party image host learns the
// handle), and where its posts go: through @anon by default (lib/identity/postMode.ts D2), or in Totem only. The ONE
// sentence about where its posts go is the anon route's own (GET /api/anon destinationSentence, the relay track's
// words, word for word; lib/onboarding/state.ts destinationSentenceOf) — this file writes none of its own. While the
// route cannot be read, the form says it could not check, never guesses.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/Providers";
import { localAvatar } from "@/lib/identity/localAvatar";
import { destinationSentenceOf, suggestHandle } from "@/lib/onboarding/state";

export function MakePersona({ onCreated }: { onCreated: (handle: string, warning: string | null) => void }) {
  const { makePersona } = useApp();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [salt, setSalt] = useState(0);
  const [mode, setMode] = useState<"anon" | "private">("anon");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [where, setWhere] = useState<string | null | undefined>(undefined);

  const effectiveHandle = handleTouched ? handle : suggestHandle(name);
  const picture = useMemo(() => localAvatar((effectiveHandle || name || "persona") + (salt ? "#" + salt : "")), [effectiveHandle, name, salt]);

  useEffect(() => {
    let alive = true;
    fetch("/api/anon", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (alive) setWhere(destinationSentenceOf(j));
      })
      .catch(() => {
        if (alive) setWhere(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await makePersona({ name: name.trim(), handle: effectiveHandle, avatarUrl: picture, postMode: mode });
    setBusy(false);
    if (!r.persona) {
      setError(r.error ?? "the persona was not created. Try again.");
      return;
    }
    onCreated(r.persona.handle, r.error);
  };

  const valid = name.trim().length > 0 && /^[a-z0-9_]{1,30}$/i.test(effectiveHandle);
  return (
    <div data-testid="make-persona" className="grid gap-3 pt-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-testid="make-persona-picture" src={picture} alt="" width={56} height={56} className="h-14 w-14 rounded-full" />
        <button type="button" data-testid="make-persona-shuffle" onClick={() => setSalt((s) => s + 1)} className="h-9 rounded-full border border-x-border-dark px-4 text-[14px] font-bold hover:bg-x-hover">
          Another picture
        </button>
      </div>
      <label className="grid gap-1 text-[14px] font-bold">
        Name
        <input
          data-testid="make-persona-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What people see"
          autoComplete="off"
          className="w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[16px] font-normal outline-none focus:border-x-blue"
        />
      </label>
      <label className="grid gap-1 text-[14px] font-bold">
        Handle
        <input
          data-testid="make-persona-handle"
          value={effectiveHandle}
          onChange={(e) => {
            setHandleTouched(true);
            setHandle(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30));
          }}
          placeholder="letters, digits, underscore"
          autoComplete="off"
          className="w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[16px] font-normal outline-none focus:border-x-blue"
        />
      </label>
      <fieldset data-testid="make-persona-mode" data-mode={mode} className="grid gap-2">
        <legend className="mb-1 text-[14px] font-bold">Where its posts go</legend>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="radio" name="make-persona-mode" data-testid="make-persona-mode-anon" checked={mode === "anon"} onChange={() => setMode("anon")} className="h-4 w-4 accent-x-blue" />
          Through @anon <span className="text-x-sec">(the default)</span>
        </label>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="radio" name="make-persona-mode" data-testid="make-persona-mode-private" checked={mode === "private"} onChange={() => setMode("private")} className="h-4 w-4 accent-x-blue" />
          In Totem only
        </label>
      </fieldset>
      {mode === "anon" ? (
      <p data-testid="make-persona-where" data-state={where === undefined ? "checking" : where === null ? "unknown" : "said"} className="text-[14px] leading-5 text-x-sec">
        {where === undefined ? "Checking where posts go on this site…" : where === null ? "We couldn't check where posts go on this site just now; the composer says it before you post." : where}
      </p>
      ) : null}
      {error ? (
        <p data-testid="make-persona-error" role="alert" className="text-[14px] text-[#f4212e]">
          Not created: {error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          data-testid="make-persona-create"
          disabled={busy || !valid}
          onClick={() => void create()}
          className="inline-flex h-10 items-center justify-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create persona"}
        </button>
      </div>
    </div>
  );
}
