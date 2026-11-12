"use client";
// PERSONA LAUNCH P5 — "Boost as: 10k+ followers · 1k+ followers · no boost", inside the composer's anonymous panel.
//
// The options are EXACTLY the server's `reach.offered` (GET /api/anon): the reach tiers this root holds whose crowd is at
// least the floor in the last sync's census. A tier under the floor is never rendered here — not greyed out, not listed
// (lib/reach/trees.ts offeredAnonTrees decides; the post route refuses it anyway). "No boost" is always there: it proves
// the plain anonymous tree. When a tier this person holds is not offered, one plain sentence says why ("Not enough
// accounts are in the 100k+ tier yet, so your posts are boosted as 10k+.").
//
// What a boost means, said where it is chosen: inside Totem, For You shows the post a little higher with "posted by an
// account with 10k+ followers" — never which account. Other apps see plain @anon. And how big the chosen tier's crowd is
// (PERSONA LAUNCH wave 3, UXH-12: the default is the highest tier, the smallest crowd).
export interface ReachOption {
  tree: string;
  label: string;
  size: number;
}

const bucketOf = (tree: string) => tree.slice(tree.lastIndexOf("/") + 1);

export function ReachPicker({
  offered,
  value,
  plainTree,
  reason,
  onChange,
}: {
  offered: ReachOption[];
  /** the chosen tree (a reach tree, or the plain tree for no boost) */
  value: string;
  plainTree: string;
  reason: string | null;
  onChange: (tree: string) => void;
}) {
  if (offered.length === 0 && !reason) return null;
  const choices: Array<{ tree: string; label: string; testid: string }> = [
    ...offered.map((o) => ({ tree: o.tree, label: o.label, testid: "reach-option-" + bucketOf(o.tree) })),
    { tree: plainTree, label: "no boost", testid: "reach-option-none" },
  ];
  return (
    <div data-testid="composer-reach" data-value={value} className="mt-1 text-[13px] leading-4 text-x-sec">
      {offered.length > 0 && (
        <div role="radiogroup" aria-label="Boost this anonymous post" className="flex flex-wrap items-center gap-1">
          <span className="font-bold text-x-text">Boost as:</span>
          {choices.map((c, i) => (
            <span key={c.tree} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">·</span>}
              <button
                type="button"
                role="radio"
                aria-checked={value === c.tree}
                data-testid={c.testid}
                data-tree={c.tree}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(c.tree);
                }}
                className={`rounded-full px-2 py-0.5 ${value === c.tree ? "bg-x-black-btn font-bold text-white" : "hover:bg-x-hover"}`}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      )}
      {offered.length > 0 && value !== plainTree && (
        <p data-testid="composer-reach-note" className="mt-1">
          In Totem, For You shows this post a little higher, marked &ldquo;posted by an account with {offered.find((o) => o.tree === value)?.label ?? "followers"}&rdquo; — never which account. Other apps see @anon.
        </p>
      )}
      {/* PERSONA LAUNCH wave 3 (UXH-12, final verify): the boost picks the HIGHEST offered tier by default, which is also the
          smallest crowd the post can hide in, and the picker never said how small. The chosen tier's size from the last
          sync's census is said in plain words beside the choice (only a finite size: never a guessed number) */}
      {(() => {
        const chosen = value !== plainTree ? offered.find((o) => o.tree === value) : undefined;
        if (!chosen || typeof chosen.size !== "number" || !Number.isFinite(chosen.size)) return null;
        return (
          <p data-testid="composer-reach-crowd" data-size={chosen.size} className="mt-1">
            {chosen.size.toLocaleString("en-US")} accounts are in the {chosen.label} tier: anyone can tell this post came from one of them, never which one. Fewer accounts means a smaller crowd to hide in.
          </p>
        );
      })()}
      {reason && (
        <p data-testid="composer-reach-reason" className="mt-1">
          {reason}
        </p>
      )}
    </div>
  );
}
