"use client";
// MULTI-FID PASS — the anoncast reveal pattern, the UI side. Shown ONLY on an anon cast this DEVICE
// itself holds a reveal secret for (checked server-side, per cast, never guessed from the cast's
// content — nothing about the text or the network hash reveals who posted it). Picking a persona and
// confirming sends {castHash, personaId} to the app, which recovers the secret and asks the
// validator to check it — nothing is proved or sent from here directly, so the secret never touches
// the browser.
//
// ANON REVIEW (R3-05, R3-06, R3-12, R3-17, R3-18, R3-22): no account is pre-selected, the owner must tick that it
// cannot be undone, the copy says what "public" means here (readers of THIS server; nothing changes on Farcaster;
// on a one-owner service that reader is you) and that the claim is checkable inside Totem only; the candidate list
// is the accounts of THIS universe (a test account never names a live post); the picker shows the Farcaster name
// the claim will carry; and each card asks one cheap question (?revealable=1) instead of the full verdict.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Candidate {
  personaId: string;
  fid: number;
  fname: string | null;
  mode: "fixture" | "live";
}

export function AnonRevealControl({ castHash }: { castHash: string }) {
  const router = useRouter();
  const [revealable, setRevealable] = useState(false);
  const [mode, setMode] = useState<"fixture" | "live">("fixture");
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/anon?revealable=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setRevealable(Array.isArray(j?.revealable) && j.revealable.includes(castHash));
        if (j?.mode === "live" || j?.mode === "fixture") setMode(j.mode);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [castHash]);

  const startReveal = async () => {
    setError(null);
    setChosen("");
    setUnderstood(false);
    setOpen(true);
    try {
      const r = await fetch("/api/fc/persona", { cache: "no-store" });
      const j = await r.json();
      const own: Candidate[] = (j?.records ?? [])
        // PERSONA LAUNCH P6 (fix UX-L2): a LAUNCHED account reveals its anonymous posts together, at launch — never offered here
        .filter((rec: { fid?: number; mode?: string; origin?: string }) => typeof rec.fid === "number" && rec.fid > 0 && rec.mode === mode && rec.origin !== "layers-launch")
        .map((rec: { personaId: string; fid: number; fname: string | null; mode: "fixture" | "live" }) => ({ personaId: rec.personaId, fid: rec.fid, fname: rec.fname, mode: rec.mode }));
      setCandidates(own);
    } catch {
      setError("could not load your persona list");
    }
  };

  const confirmReveal = async () => {
    if (!chosen || !understood) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/anon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reveal", castHash, personaId: chosen }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error ?? "reveal refused");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!revealable) return null;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="anon-reveal-start"
        onClick={(e) => {
          e.stopPropagation();
          void startReveal();
        }}
        className="mt-1 text-[13px] font-bold text-x-blue hover:underline"
      >
        Prove this is yours
      </button>
    );
  }

  const chosenName = candidates.find((c) => c.personaId === chosen);
  return (
    <div data-testid="anon-reveal-panel" className="mt-1 flex flex-col gap-1 rounded-xl border border-x-border p-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-[13px] leading-4 text-x-sec">
        This writes the Farcaster name you pick on this post for anyone who reads this server. It cannot be undone. Nothing changes on
        Farcaster: there the post stays under the anonymous account. The claim is checkable inside Totem only (your account&apos;s
        signing key is not registered on Farcaster yet). Revealing one post also makes your other anonymous posts easier to guess.
      </p>
      {candidates.length === 0 ? (
        <p className="text-[13px] text-x-sec">{mode === "live" ? "none of your personas owns a real Farcaster account yet" : "no persona of yours has its own account in this universe yet"}</p>
      ) : (
        <select
          data-testid="anon-reveal-persona"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded-full border border-x-border bg-transparent px-2 py-1 text-[13px]"
        >
          <option value="">choose an account…</option>
          {candidates.map((c) => (
            <option key={c.personaId} value={c.personaId}>
              Farcaster @{c.fname ?? c.fid} · fid {c.fid}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-start gap-2 text-[13px] leading-4 text-x-sec">
        <input type="checkbox" data-testid="anon-reveal-understood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
        <span>I understand this cannot be undone{chosenName ? ` and names @${chosenName.fname ?? chosenName.fid}` : ""}.</span>
      </label>
      {error && <p className="text-[13px] text-[#f4212e]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="anon-reveal-confirm"
          disabled={busy || !chosen || !understood}
          onClick={() => void confirmReveal()}
          className="rounded-full bg-x-blue px-3 py-1 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Revealing…" : "Reveal, permanently"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-[13px] font-bold text-x-sec">
          Cancel
        </button>
      </div>
    </div>
  );
}
