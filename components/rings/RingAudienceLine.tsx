"use client";
// PERSONA LAUNCH P4 — THE COMPOSER'S RING LINE, under "Posting as @x through @anon" (components/Composer.tsx, applied by
// the reach track): which of your rings will see that THIS anon post was you, from GET /api/anon `postAs.rings` (the
// labels of the rings that hold the persona at depth "posts", read from memory — lib/rings/model.ts ringsSeeingPosts).
// Plain words; an unread rings document says so (the post itself is refused rather than sent without its note).
export function RingAudienceLine({ rings, error, ownerService = false }: { rings: string[]; error: string | null; ownerService?: boolean }) {
  if (error) {
    return (
      <p data-testid="ring-audience-line" data-state="unknown" className="mt-1 text-[13px] leading-4 text-x-sec">
        {error.charAt(0).toUpperCase() + error.slice(1)} — so this post won&rsquo;t be sent until they can be.
      </p>
    );
  }
  if (!rings.length) {
    return (
      <p data-testid="ring-audience-line" data-state="none" className="mt-1 text-[13px] leading-4 text-x-sec">
        None of your rings will see that this post is yours.
      </p>
    );
  }
  const names = rings.length === 1 ? rings[0] : rings.slice(0, -1).join(", ") + " and " + rings[rings.length - 1];
  // PERSONA LAUNCH P7 (UXH-8): on the owner service a ring publishes to that service's own validator, which no device
  // outside it reads — the ring is SET to see the post is yours and reaches nobody yet (Settings › Rings says the same)
  if (ownerService) {
    return (
      <p data-testid="ring-audience-line" data-state="owner-service" data-rings={rings.length} className="mt-1 text-[13px] leading-4 text-x-sec">
        Your {rings.length === 1 ? "ring" : "rings"} <span className="font-bold text-x-text">{names}</span> {rings.length === 1 ? "is" : "are"} set to see that this post is yours, but rings made on this owner site don&rsquo;t reach anyone else yet. Everyone sees @anon.
      </p>
    );
  }
  return (
    <p data-testid="ring-audience-line" data-state="rings" data-rings={rings.length} className="mt-1 text-[13px] leading-4 text-x-sec">
      Your {rings.length === 1 ? "ring" : "rings"} <span className="font-bold text-x-text">{names}</span> will see that this post is yours. Everyone else sees @anon.
    </p>
  );
}
