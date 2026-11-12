"use client";
// OWNER PASSKEYS (review UX-14) — when the owner's session ends while a page is open (its 30 days ran out, or "sign
// out everywhere" on another device), the next API call is answered "owner login required". Without this, the owner
// saw only that feature's generic error. This says what happened and links back in, and leaves the page alone — a
// half-written post stays on screen. Rendered by app/(main)/layout.tsx only on the owner service.
import { useEffect, useState } from "react";
import { signInAgainHref, watchOwnerSession } from "@/lib/owner/sessionWatch";

export function OwnerSessionWatch() {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => watchOwnerSession(window, () => setSignedOut(true)), []);
  if (!signedOut) return null;
  const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/home";
  return (
    <div
      role="alert"
      data-testid="owner-session-ended"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b border-[#fdc9ce] bg-[#fff5f6] px-4 py-2.5 text-[15px] text-x-text"
    >
      <span>You&apos;ve been signed out on this device.</span>
      <a href={signInAgainHref(here)} className="font-bold text-x-blue hover:underline">
        Sign in again
      </a>
    </div>
  );
}
