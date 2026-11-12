"use client";
// PERSONA LAUNCH P8 — "Also post to @totem on X" in the composer (test data: nothing reaches X).
//
// Shown ONLY while "Post anonymously" is ticked and anonymous posting works here (the Composer decides that and passes
// `show`); it then asks GET /api/x/outbox once whether a copy can go to X HERE — never on the public browser device
// (D-X-PUBLIC-OFF), never in the live universe (no live transport exists) — and, when not, says why in one line instead
// of offering a box that cannot work. DEFAULT OFF, always: it is never ticked for the owner, and an answer of "not
// offered" unticks it. Before the box can be ticked it says what a copy costs, in plain words: the copy has the SAME
// WORDS as the anonymous post, so if this persona is launched the copy reads as theirs too (A-X-COPY-LINKED-BY-WORDS),
// while a launch itself never reveals a post to X (D-X-COPY-UNATTRIBUTED). Worded apart from the composer's existing
// "Also post to" crosspost panel, which posts to the owner's OWN X account under their name: this one posts through the
// shared @totem account with no name on it.
import { useEffect, useState } from "react";

export const X_TOGGLE_LABEL = "Also post to @totem on X — test data: nothing reaches X";
export const X_TOGGLE_NOTE = "A copy on X has the same words: if you launch this persona, it will read as yours too. Posts to X are never revealed by a launch.";

/** PERSONA LAUNCH wave 3 (UXH-5): `problem` — why the ticked copy's words can't go to X as written (the composer runs the
 *  outbox's rules on every edit and holds Post while there is one); shown under the box with the way out */
export function XOutboxToggle({ show, checked, onChange, problem = null }: { show: boolean; checked: boolean; onChange: (v: boolean) => void; problem?: string | null }) {
  const [status, setStatus] = useState<{ offered: boolean; reason: string | null } | null>(null);
  useEffect(() => {
    if (!show) return;
    let alive = true;
    fetch("/api/x/outbox", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { offered?: unknown; reason?: unknown } | null;
        if (!alive) return;
        setStatus({ offered: j?.offered === true, reason: typeof j?.reason === "string" && j.reason ? j.reason : null });
      })
      .catch(() => {
        // never a guess: a question that could not be asked is "not offered", said so
        if (alive) setStatus({ offered: false, reason: "Couldn't check whether a copy can go to @totem on X here." });
      });
    return () => {
      alive = false;
    };
  }, [show]);
  // an answer of "not offered" unticks a box ticked before it arrived
  useEffect(() => {
    if (status && !status.offered && checked) onChange(false);
  }, [status, checked, onChange]);
  if (!show) return null;
  if (!status) {
    return (
      <p data-testid="composer-x-pending" className="mt-1 text-[13px] leading-4 text-x-sec">
        Checking whether a copy can go to @totem on X…
      </p>
    );
  }
  if (!status.offered) {
    return (
      <p data-testid="composer-x-unavailable" className="mt-1 text-[13px] leading-4 text-x-sec">
        {status.reason ?? "A copy to @totem on X isn't offered here."}
      </p>
    );
  }
  return (
    <div data-testid="composer-x-panel" data-state={checked ? "on" : "off"} className="mt-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-[13px] leading-4">
        <input
          data-testid="composer-x-toggle"
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-x-blue"
        />
        <span data-testid="composer-x-label">{X_TOGGLE_LABEL}</span>
      </label>
      <p data-testid="composer-x-note" className="mt-0.5 pl-6 text-[12px] leading-4 text-x-sec">
        {X_TOGGLE_NOTE} A moderator reads it before anything goes out.
      </p>
      {checked && problem ? (
        <p data-testid="composer-x-problem" role="alert" className="mt-0.5 pl-6 text-[12px] leading-4 text-[#f4212e]">
          The copy to X can&rsquo;t go as written: {problem} Fix the words, or untick the box to post without the copy.
        </p>
      ) : null}
    </div>
  );
}
