"use client";
// "Block this persona" — ZK PASS 2 Gate 2. Blocking used to resolve to the
// ROOT server-side so every persona of the account vanished; that needed
// the validator to hold persona → root, which it no longer does (migration
// 006). Blocks are persona-level. Your OWN personas share the block (the
// device knows its siblings); the blocked account's other personas are not
// auto-blocked — the regression is named here and in SECURITY-POSTURE.md
// ("What zk cost us: root-level block fan-out").
//
// PROD-LIVE (D-CU-0-4): after the block the profile is re-read with useApp().refresh() — router.refresh() for the
// rig's server render plus a refetch of the profile island, which on a public deployment is the only copy of the
// block state (the browser device answers /api/profile).
import { useState } from "react";
import { useApp } from "@/components/Providers";

export function BlockPersonasButton({ personaId, handle }: { personaId: string; handle: string }) {
  const { refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/block-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "block failed");
      setDone(true);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p data-testid="block-confirmed" className="border-b border-x-border px-4 py-3 text-[15px] leading-5 text-x-sec">
        Blocked @{handle} for all of your personas. Sibling personas of that account are not auto-blocked: this server no longer knows which personas share an account.
      </p>
    );
  }

  return (
    <div className="border-b border-x-border px-4 py-3">
      <button
        data-testid="block-all-personas"
        onClick={block}
        disabled={busy}
        className="h-9 rounded-full border border-[#fdc9ce] px-4 text-[15px] font-bold text-[#f4212e] transition-colors hover:bg-[#f4212e0d] disabled:opacity-50"
      >
        {busy ? "Blocking…" : "Block this persona"}
      </button>
      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}
    </div>
  );
}
