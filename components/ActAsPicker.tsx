"use client";
// ACT-AS-ANY-PERSONA — reply / quote / recast on a cast, from any persona
// you control, without leaving the timeline or switching your active
// persona. Defaults to the active persona; picking another is one tap. A
// chosen PRIVATE persona carries the same unmistakable chrome as the
// private composer — "Only N people can see this" — never softened here.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cast } from "@/lib/types";
import { actAsOutcome, type ActAsOutcome } from "./deliveryLine";

interface ActAsOption {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  kind: "public" | "private";
  audienceCount: number | null;
  destinationIds: string[];
}

export function ActAsPicker({
  cast,
  initialKind,
  onClose,
}: {
  cast: Cast;
  initialKind: "reply" | "quote" | "recast";
  onClose: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<ActAsOption[]>([]);
  const [kind, setKind] = useState(initialKind);
  // Resolved ENTIRELY from the seeded-system fetch below, never from
  // useApp() — that context is the phase-1 fixture identity track, a
  // different universe from the seeded personas this picker operates on.
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [asPersonaId, setAsPersonaId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // BUILD A review (PUB-4, UXC-05): what the route said happened — "Recast on Farcaster as @x" with its address, or
  // "Quoted in Totem only — <why>" — never a fixed "Posted as @x." that claims a send that may not have happened
  const [done, setDone] = useState<ActAsOutcome | null>(null);

  useEffect(() => {
    fetch("/api/personas/act-as-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const opts: ActAsOption[] = j.options ?? [];
        setOptions(opts);
        // activeId can be a View-As target, which is never one of
        // SEED_VIEWER's own personas and so never appears in opts — default
        // selection falls back to the first real option rather than
        // pre-selecting an id that isn't clickable and would just 403.
        const activeIsOffered = opts.some((o) => o.id === j.activeId);
        setActivePersonaId(activeIsOffered ? j.activeId : null);
        setAsPersonaId(activeIsOffered ? j.activeId : opts[0]?.id ?? null);
      })
      .catch(() => setError("Couldn't load your personas."));
  }, []);

  const chosen = options.find((o) => o.id === asPersonaId);
  const isViaActAs = asPersonaId !== null && asPersonaId !== activePersonaId;

  const submit = async () => {
    if (!asPersonaId) return;
    if (kind !== "recast" && !text.trim()) return;
    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      const res = await fetch("/api/actions/act-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, targetHash: cast.hash, text, asPersonaId }),
      });
      const j = await res.json().catch(() => null);
      const outcome = actAsOutcome(res.ok, j, chosen?.handle ?? null);
      if (outcome.tone === "error") {
        setError(outcome.message);
        setErrorDetail(outcome.detail);
        return;
      }
      setDone(outcome);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16" onClick={onClose}>
      <div
        data-testid="act-as-picker"
        className="w-[500px] max-w-[92vw] rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-extrabold">Act as</p>
          <button data-testid="act-as-close" onClick={onClose} className="text-[15px] text-x-sec">
            Close
          </button>
        </div>

        <div className="mt-3 flex gap-1.5">
          {(["reply", "quote", "recast"] as const).map((k) => (
            <button
              key={k}
              data-testid={`act-as-kind-${k}`}
              onClick={() => setKind(k)}
              className={`h-8 rounded-full px-3 text-[13px] font-bold capitalize ${
                kind === k ? "bg-x-black-btn text-white" : "border border-[#cfd9de] text-x-sec"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <p className="mt-3 text-[13px] font-bold text-x-sec">Post as</p>
        {/* MULTI-FID Gate 5 (attack-fid-1 #6, A-FID-SELF-GRAPH): the waiver at the point of use */}
        <p data-testid="act-as-waiver" className="mb-1 text-[12px] leading-4 text-x-sec">
          Replying as another of your personas publishes that edge on the network — two of your accounts interacting is public, and stays public.
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5" data-testid="act-as-persona-list">
          {options.map((o) => (
            <button
              key={o.id}
              data-testid={`act-as-persona-${o.handle}`}
              data-selected={o.id === asPersonaId ? "true" : "false"}
              data-persona-kind={o.kind}
              onClick={() => setAsPersonaId(o.id)}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold ${
                o.id === asPersonaId ? "border-x-blue bg-[#1d9bf01a] text-x-blue" : "border-[#cfd9de]"
              }`}
            >
              @{o.handle}
              {o.kind === "private" && (
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                  <path d="M8 10.5V7.6a4 4 0 018 0v2.9" />
                </svg>
              )}
              {o.id === activePersonaId && <span className="text-[11px] font-normal text-x-sec">(active)</span>}
            </button>
          ))}
        </div>

        {/* PRIVATE CHROME — unmistakable, non-dismissable, identical language
            to the private composer. Never softened for act-as. */}
        {chosen?.kind === "private" && (
          <p
            data-testid="act-as-private-chrome"
            className="mt-2 rounded-lg bg-[#f7f9f9] px-3 py-2 text-[13px] font-bold text-x-text"
          >
            Only {chosen.audienceCount ?? 0} {chosen.audienceCount === 1 ? "person" : "people"} can see this. Not on
            the public timeline.
          </p>
        )}
        {isViaActAs && (
          <p className="mt-1.5 text-[12px] text-x-sec" data-testid="act-as-via-note">
            Posting as @{chosen?.handle} — your active persona stays @
            {options.find((o) => o.id === activePersonaId)?.handle ?? "…"}.
          </p>
        )}

        {kind === "recast" ? (
          <p className="mt-3 text-[15px] text-x-sec">Recasts the post as-is — no text needed.</p>
        ) : (
          <textarea
            data-testid="act-as-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "quote" ? "Add a comment" : "Post your reply"}
            className="mt-2 h-20 w-full resize-none rounded-lg border border-[#cfd9de] p-2 text-[15px] outline-none"
          />
        )}

        {kind === "quote" && (
          <div className="mt-2 rounded-lg border border-x-border p-2 text-[13px] text-x-sec">
            Quoting @{cast.author.username}: {cast.text.slice(0, 80)}
            {cast.text.length > 80 ? "…" : ""}
          </div>
        )}

        {error && (
          <p data-testid="act-as-error" className="mt-2 text-[13px] text-[#f4212e]">
            {error}
            {errorDetail && <span className="mt-0.5 block text-[12px] text-x-sec">{errorDetail}</span>}
          </p>
        )}
        {done ? (
          <p
            className={`mt-3 text-[15px] ${done.tone === "farcaster" ? "font-bold text-[#00ba7c]" : "text-x-text"}`}
            data-testid="act-as-done"
            data-delivery={done.tone}
            role="status"
          >
            {done.message}
            {done.url && (
              <>
                {" · "}
                <a
                  data-testid="act-as-done-link"
                  href={done.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-x-blue hover:underline"
                >
                  view it on Farcaster
                </a>
              </>
            )}
            {done.detail && <span className="mt-0.5 block text-[12px] font-normal text-x-sec">{done.detail}</span>}
          </p>
        ) : (
          <button
            data-testid="act-as-submit"
            disabled={busy || !asPersonaId || (kind !== "recast" && !text.trim())}
            onClick={submit}
            className="mt-3 h-9 w-full rounded-full bg-x-black-btn text-[15px] font-bold text-white disabled:opacity-50"
          >
            {kind === "recast" ? "Recast" : kind === "quote" ? "Post quote" : "Post reply"}
          </button>
        )}
      </div>
    </div>
  );
}
