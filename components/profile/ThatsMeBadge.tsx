"use client";
// PERSONA LAUNCH P1 (SIWF) — "That's me": the badge beside the name on the visitor's OWN Farcaster account's profile
// (the read-only public self a Sign in with Farcaster minted). It says what the sign-in proved — this browser's
// identity signed in as @fname — and nothing it did not: it is not a Farcaster verification, and it is shown only
// on this device (the facts are sealed in this identity's vault; no other visitor sees them). "disconnected" after
// a disconnect.
export function ThatsMeBadge({ fname, verifiedAt, disconnected }: { fname: string; verifiedAt: number; disconnected: boolean }) {
  const when = Number.isFinite(verifiedAt) && verifiedAt > 0 ? new Date(verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  return (
    <span
      data-testid="thats-me-badge"
      data-state={disconnected ? "disconnected" : "signed-in"}
      title={
        disconnected
          ? `You disconnected @${fname} from this identity. Only this same account can sign in here again.`
          : `You signed in as @${fname}${when ? " on " + when : ""}. Only you see this.`
      }
      className={`ml-1 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[12px] font-bold leading-4 ${
        disconnected ? "border-[#cfd9de] text-[#536471]" : "border-[#00ba7c66] text-[#00ba7c]"
      }`}
    >
      {disconnected ? "disconnected" : "that's me"}
    </span>
  );
}
