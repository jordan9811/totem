"use client";
// UX GATE 0 — the resurface toggle. Default off, always: an import is
// history until the user explicitly promotes it. Per-post and bulk, both
// here so the profile's imported shelf stays a plain list and this client
// island owns only the mutation + refresh.
//
// PERSONA LAUNCH P2 (BYX G3): relabelled to say what it does and where — it shows the post as new in THIS person's
// Totem feed and posts nothing anywhere (re-posting to Farcaster is a separate, later step). The mechanics and the
// testids are unchanged.
//
// PROD-LIVE (D-CU-0-4): after the write the profile is re-read with useApp().refresh() — router.refresh() for the
// rig's server render PLUS a refetch of the profile island, which on a public deployment is the only copy of the
// data (the browser device answers /api/profile). A refused write is said out loud (a toast), not refreshed over as
// if it had landed.
import { useState } from "react";
import { useApp } from "@/components/Providers";

async function postImport(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/x/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error((j && j.error) || `HTTP ${res.status}`);
  }
}

export function ResurfaceToggle({ tweetId, resurfaced }: { tweetId: string; resurfaced: boolean }) {
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await postImport({ action: "resurface", tweetId, on: !resurfaced });
      refresh();
    } catch (e) {
      toast(`Couldn't change that post: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      data-testid="resurface-toggle"
      data-resurfaced={resurfaced ? "true" : "false"}
      disabled={busy}
      onClick={toggle}
      className={`h-7 rounded-full px-3 text-[12px] font-bold ${
        resurfaced
          ? "bg-x-black-btn text-white"
          : "border border-[#cfd9de] text-x-sec hover:bg-x-hover"
      }`}
    >
      {resurfaced ? "Shown as new in my Totem feed" : "Show as new in my Totem feed"}
    </button>
  );
}

export function ResurfaceAllControl({ anyResurfaced }: { anyResurfaced: boolean }) {
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const setAll = async (on: boolean) => {
    setBusy(true);
    try {
      await postImport({ action: "resurfaceAll", on });
      refresh();
    } catch (e) {
      toast(`Couldn't change your imported posts: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      data-testid="resurface-all"
      disabled={busy}
      onClick={() => setAll(!anyResurfaced)}
      className="h-7 rounded-full border border-[#cfd9de] px-3 text-[12px] font-bold text-x-sec hover:bg-x-hover"
    >
      {anyResurfaced ? "Back to history only" : "Show all as new in my Totem feed"}
    </button>
  );
}
