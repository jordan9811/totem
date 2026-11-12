"use client";
// PERSONA LAUNCH P3 (D2) — "Posts from @persona go: …", inside the composer. The persona's post mode in plain words:
//   through @anon      (anon: the default for a persona without its own account)
//   in Totem only     (private)
//   to its own account (direct: offered only when the persona has one)
// Changing it saves the choice on the persona (POST /api/personas/post-mode) — the keystore, the root roster and the
// sealed identity roster, so it survives a restart and a recovery — and the composer asks again where the next post
// goes. A save that does not fully land is shown as the server's own sentence, never as a quiet success. The server
// decides what is allowed (a private persona offers only "Totem only"; "direct" needs an account); this only shows it.
//
// PERSONA LAUNCH P6 (D2): a LAUNCHED persona must choose. With no choice made yet (choiceRequired) the picker shows a
// REQUIRED state — an empty "Choose…" option selected, a plain sentence asking — and the composer keeps Post disabled
// until a choice is saved (the server presets anon: the reversible choice). On a launched persona the picker also says,
// beside "to its own account", that going back to anon after posting directly is weak.
import { useState } from "react";

export type PostModeOption = "anon" | "private" | "direct";

const LABEL: Record<PostModeOption, string> = {
  anon: "through @anon",
  private: "in Totem only",
  direct: "to its own account",
};

/** PERSONA LAUNCH P3 (UX-3): where anonymous posting does not exist on this deployment (the public preview, a server
 *  without the proof layer), "anon" is never OFFERED, and a persona already in "anon" mode is shown going where its
 *  posts really go here — as a disabled option, so the choice is not re-made by accident and not shown as live */
export const ANON_OFF_LABEL = "in Totem only (anonymous posting isn't on here yet)";

/** PERSONA LAUNCH P6 — DELIBERATE DUPLICATE of lib/identity/postMode.ts DIRECT_IS_ONE_WAY_SENTENCE (a client component
 *  cannot import that server-only module); scripts/unit-launch.mjs pins the two equal */
export const DIRECT_IS_ONE_WAY_SENTENCE = "Going back to anon after posting directly is weak: your writing style is public now.";

export function PostModePicker({
  personaId,
  handle,
  mode,
  options,
  settable,
  anonOff = false,
  choiceRequired = false,
  launched = false,
  onChanged,
}: {
  personaId: string;
  handle: string | null;
  mode: PostModeOption;
  options: PostModeOption[];
  settable: boolean;
  /** UX-3: anonymous posting is off on this whole deployment */
  anonOff?: boolean;
  /** PERSONA LAUNCH P6 (D2): a launched persona that has not chosen yet — the picker asks (preset anon) */
  choiceRequired?: boolean;
  /** PERSONA LAUNCH P6: the persona has its own launched account (the "direct" note shows) */
  launched?: boolean;
  /** called with the new mode once the server saved it */
  onChanged?: (mode: PostModeOption) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = "@" + (handle ?? "this persona");
  const offered = anonOff ? options.filter((m) => m !== "anon") : options;
  // the current mode always has an option to show it (disabled when it is not offered here)
  const choices: PostModeOption[] = offered.includes(mode) ? offered : [mode, ...offered];
  const labelOf = (m: PostModeOption) => (anonOff && m === "anon" ? ANON_OFF_LABEL : LABEL[m]);
  const change = async (next: PostModeOption) => {
    // a required choice saves even the preset (anon): choosing it IS the answer the composer is waiting for
    if ((next === mode && !choiceRequired) || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/personas/post-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaId, mode: next }) });
      const j = (await r.json().catch(() => null)) as { mode?: unknown; error?: unknown } | null;
      if (r.ok && j && (j.mode === "anon" || j.mode === "private" || j.mode === "direct")) onChanged?.(j.mode);
      else setError(j && typeof j.error === "string" && j.error ? j.error : "Couldn't save that. Try again.");
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      data-testid="composer-post-mode"
      data-mode={mode}
      data-effective={anonOff && mode === "anon" ? "layers" : mode}
      data-choice-required={choiceRequired ? "true" : undefined}
      className="mt-1 text-[13px] leading-4 text-x-sec"
    >
      {choiceRequired && (
        <p data-testid="composer-post-mode-required" className="mb-1 font-bold text-x-text">
          {who} has its own account now. Choose where its posts go before you post.
        </p>
      )}
      <label className="flex flex-wrap items-center gap-1.5">
        <span>Posts from {who} go</span>
        <select
          data-testid="composer-post-mode-select"
          value={choiceRequired ? "" : mode}
          disabled={!settable || saving || (!choiceRequired && offered.filter((m) => m !== mode).length < 1)}
          onChange={(e) => {
            if (e.target.value) void change(e.target.value as PostModeOption);
          }}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md border border-x-border bg-transparent px-1.5 py-0.5 text-[13px] text-x-text disabled:opacity-60"
        >
          {choiceRequired && (
            <option value="" disabled>
              Choose…
            </option>
          )}
          {choices.map((m) => (
            <option key={m} value={m} disabled={!offered.includes(m)}>
              {labelOf(m)}
            </option>
          ))}
        </select>
      </label>
      {launched && (choiceRequired || mode === "direct") && (
        <p data-testid="composer-post-mode-direct-note" className="mt-1">
          {DIRECT_IS_ONE_WAY_SENTENCE}
        </p>
      )}
      {error && (
        <p data-testid="composer-post-mode-error" role="status" className="mt-1 text-[#f4212e]">
          {error}
        </p>
      )}
    </div>
  );
}
