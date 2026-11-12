// The shareable algo card — a distinct post type: name, author, one-line
// summary, provenance. Tapping it goes to the MANDATORY preview; there is no
// activate control here at all, so skipping the preview is not a UI state.
//
// PROD-LIVE (D-CU-0-4): it takes the card's rendered summary (lib/views/spaces.ts algoCardSummary) instead of
// reading the store itself, so the folder island can render it in the browser — on a public deployment the store
// lives in the device, and the author's name is resolved there.
import Link from "next/link";
import type { AlgoCardSummary } from "@/lib/views/types";

export function AlgoCardView({ card }: { card: AlgoCardSummary }) {
  return (
    <Link
      href={`/algo/${card.id}`}
      data-testid="algo-card"
      data-algo={card.id}
      className="block border-b border-x-border px-4 py-3 hover:bg-x-hover"
    >
      <div className="flex items-center">
        <span className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-x-border text-x-sec">
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 6h16M4 12h10M4 18h13" strokeLinecap="round" />
            <circle cx="19" cy="12" r="2.2" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="flex items-center truncate text-[15px] font-bold leading-5 text-x-text">
            {card.name}
            <span className="ml-2 rounded-full bg-[#1d9bf01a] px-2 py-0.5 text-[11px] font-bold text-x-blue">
              {card.kind === "filter_pack" ? "Filter pack" : "Algorithm"}
            </span>
          </p>
          <p className="truncate text-[13px] leading-4 text-x-sec">
            by {card.authorName} @{card.authorHandle} · v{card.algoVersion}
            {card.forkedFrom && (
              <span data-testid="algo-provenance">
                {" "}
                · modified from @{card.forkedFrom.authorHandle}&rsquo;s algo v{card.forkedFrom.algoVersion}
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[15px] leading-5 text-x-text">{card.summary}</p>
      <p className="mt-1 text-[13px] leading-4 text-x-sec">
        Tap to preview what this changes before it can run.
      </p>
    </Link>
  );
}
