"use client";
import { useState } from "react";

/**
 * Follow/unfollow. When a personaId is supplied this is a REAL edge: it hits
 * /api/follow, which mutates the persisted following graph and writes the
 * relationship event log (with the triggering cast, when one exists).
 * Without a personaId — phase-1 fixture users that have no persona — it
 * stays what it always was, presentational chrome, rather than pretending an
 * edge was created that nothing recorded.
 */
export function FollowButton({
  large = false,
  personaId,
  initialFollowing = false,
  triggeringCastId,
  context = "profile",
}: {
  large?: boolean;
  personaId?: string;
  initialFollowing?: boolean;
  triggeringCastId?: string;
  context?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = large ? "h-9 px-4 text-[15px]" : "h-8 px-4 text-[14px]";

  async function toggle(next: boolean) {
    if (busy) return;
    // optimistic — but if the server (and therefore the log) refuses, the
    // button reverts rather than showing an edge that was never recorded
    setFollowing(next);
    if (!personaId) return; // chrome-only path for fixture users
    setBusy(true);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, follow: next, triggeringCastId, context }),
      });
      if (!res.ok) setFollowing(!next);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  if (following)
    return (
      <button
        data-testid="follow-button"
        data-following="true"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          toggle(false);
        }}
        className={`${base} shrink-0 rounded-full border font-bold transition-colors ${
          hover
            ? "border-[#fdc9ce] bg-[#f4212e1a] text-[#f4212e]"
            : "border-[#cfd9de] bg-white text-x-text"
        }`}
      >
        {hover ? "Unfollow" : "Following"}
      </button>
    );
  return (
    <button
      data-testid="follow-button"
      data-following="false"
      onClick={(e) => {
        e.stopPropagation();
        toggle(true);
      }}
      className={`${base} shrink-0 rounded-full bg-x-black-btn font-bold text-white hover:bg-x-black-btn-hover`}
    >
      Follow
    </button>
  );
}
