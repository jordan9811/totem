"use client";
// SIGN IN WITH X (2026-11-06) — which of the root's OWN accounts are signed in on this device: its Farcaster account, its X
// account, or both (GET /api/onboarding, answered in the tab from the sealed accountLinks record; the server never sees
// it). The home feed, Pick up where you left off and the account menu ask it, so a root that signed in with X only is told
// plainly which parts need a Farcaster account (and offered Connect Farcaster) instead of meeting a Farcaster read that
// fails. null while reading or when it could not be read: NEVER "no account" on a failed read.
import { useEffect, useState } from "react";

export interface RootAccounts {
  farcaster: boolean;
  x: boolean;
}

export function useRootAccounts(enabled: boolean, tick = 0): RootAccounts | null {
  const [accounts, setAccounts] = useState<RootAccounts | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/onboarding", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { publicSelf?: unknown; xSignedIn?: unknown } | null;
        if (!alive) return;
        setAccounts(r.ok && j && typeof j.publicSelf === "boolean" && typeof j.xSignedIn === "boolean" ? { farcaster: j.publicSelf, x: j.xSignedIn } : null);
      })
      .catch(() => {
        if (alive) setAccounts(null);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);
  return accounts;
}
