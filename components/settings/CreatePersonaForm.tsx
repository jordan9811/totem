"use client";
// LAYERS_WORLD=empty (lib/world.ts) — the plain "create persona" a device with no personas needs.
//
// The fork (/settings/identity/fork, linked from Settings › Account & Personas once a persona exists) makes a new
// persona FROM one you already act as; a service whose demo world is hidden starts with none, so there is nothing to
// fork. This form mints one through POST /api/personas, which under the flag mints it in this device's keystore
// (adapters.identity.createPersona: its own keys, its own p_ id) and makes it the persona you act as. A refusal is
// said, never swallowed; the name and handle stay in the form, so submitting again finishes a half-done create.
//
// PUBLIC GO-LIVE: the same form on the public site's Settings › Account (public live mode), with a PICTURE made on this
// device (lib/identity/localAvatar.ts: no third-party image host learns the handle; "Another picture" draws a new one)
// and WHERE ITS POSTS GO: through @anon (the default, lib/identity/postMode.ts D2) or in Totem only. The create is
// Providers.makePersona (the guided first run's own), so a refusal is the route's own sentence.
import { useMemo, useState } from "react";
import { useApp } from "@/components/Providers";
import { localAvatar } from "@/lib/identity/localAvatar";

export function CreatePersonaForm({ first }: { first: boolean }) {
  const { makePersona } = useApp();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [salt, setSalt] = useState(0);
  const [mode, setMode] = useState<"anon" | "private">("anon");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const picture = useMemo(() => localAvatar((handle || name || "persona") + (salt ? "#" + salt : "")), [handle, name, salt]);

  async function submit() {
    setBusy(true);
    setErr(null);
    setWarn(null);
    try {
      const r = await makePersona({ name: name.trim(), handle, avatarUrl: picture, postMode: mode });
      if (!r.persona) throw new Error(r.error || "could not create the persona");
      setMade(r.persona.handle);
      if (r.error) setWarn(r.error);
      setName("");
      setHandle("");
    } catch (e) {
      setErr((e as Error).message || "could not create the persona");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="world-create-persona" className="px-4 py-3">
      <p className="mb-2 text-[15px] font-bold leading-5">{first ? "Create your first persona" : "Create a persona"}</p>
      <div className="mb-2 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-testid="world-create-picture" src={picture} alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
        <button type="button" data-testid="world-create-shuffle" onClick={() => setSalt((s) => s + 1)} className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover">
          Another picture
        </button>
      </div>
      <input
        data-testid="world-create-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        className="mb-2 w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
      />
      <input
        data-testid="world-create-handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30))}
        placeholder="Handle (letters, digits, underscore)"
        className="mb-2 w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
      />
      <fieldset data-testid="world-create-mode" data-mode={mode} className="mb-2 flex flex-wrap gap-4 text-[14px]">
        <legend className="sr-only">Where its posts go</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="world-create-mode" checked={mode === "anon"} onChange={() => setMode("anon")} className="h-4 w-4 accent-x-blue" />
          Posts through @anon (default)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="world-create-mode" checked={mode === "private"} onChange={() => setMode("private")} className="h-4 w-4 accent-x-blue" />
          In Totem only
        </label>
      </fieldset>
      {err && (
        <p data-testid="world-create-error" role="alert" className="mb-2 text-[13px] text-[#f4212e]">
          Couldn&rsquo;t create it: {err}
        </p>
      )}
      {made && (
        <p data-testid="world-create-done" className="mb-2 text-[13px] text-[#00ba7c]">
          Created @{made} — you are now acting as it.
        </p>
      )}
      {warn && (
        <p data-testid="world-create-warning" role="status" className="mb-2 text-[13px] text-x-sec">
          {warn}
        </p>
      )}
      <button
        type="button"
        data-testid="world-create-submit"
        disabled={busy || !name.trim() || !handle}
        onClick={submit}
        className="h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create persona"}
      </button>
    </div>
  );
}
