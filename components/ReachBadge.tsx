// PERSONA LAUNCH P5 — THE REACH LABEL on an anonymous card: "posted by an account with 10k+ followers". The TIER the
// post proved, never which account. The card carries `reach` only when lib/reach/boost.ts reachLabelFor judged it from
// the row and the client's own snapshot (the issuer honoured by key, a crowd of at least the floor, the size agreeing
// with the client's census); everything else renders plain "anon". Shown inside Totem only — other clients see @anon.
export function ReachBadge({ reach }: { reach: { issuer: string; bucket: string; label: string; treeSize: number } }) {
  return (
    <span
      data-testid="cast-reach"
      data-issuer={reach.issuer}
      data-bucket={reach.bucket}
      className="ml-1 truncate text-[13px] text-x-sec"
      title={`Whoever posted this proved they are one of the ${reach.treeSize} accounts in this tier when it was posted. It never says which one. Only Totem shows this.`}
    >
      · {reach.label}
    </span>
  );
}
