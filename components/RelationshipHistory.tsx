"use client";
// CALL OPTION B — the relationship history tab.
//
// Gate 1's log, rendered where it belongs: on the profile of the account it
// is about. Why you follow them (the triggering cast, shown), your first
// interaction, how much you have engaged, and the strike/mute history with
// every receipt. Backfilled entries are visually marked — "this edge
// predates the log" is an honest answer and it looks different from "we
// know exactly why".
//
// PROD-LIVE (D-CU-0-4): this was a server component that read adapters.eventLog itself. On a public deployment the
// server holds no identity, so that read threw and every seeded profile said "Couldn't read your relationship
// history". It now only DRAWS a RelationshipHistoryView (lib/views/social.ts): computed by the server on the rig
// (same read, same order), and by the browser device on a public deployment via /api/eventlog/history. The DOM is
// the one the server component rendered; the failure state gained a Retry.
//
// PROD-LIVE (review fix): it draws from rendered text only. The view it is handed no longer carries event ids or
// triggering-cast hashes (on the rig it rides the profile page's RSC payload): each event arrives with its receipt
// already resolved, an unresolvable cast arrives as the 10-character prefix this tab prints, and strikes are keyed
// by position. The DOM is unchanged.
import type { HistoryReceipt, RelationshipHistoryView } from "@/lib/views/social";

function ReceiptCast({ receipt }: { receipt: HistoryReceipt }) {
  if (receipt.kind === "unresolved") return <span className="text-x-sec">cast {receipt.hashPrefix}…</span>;
  return (
    <span data-testid="history-receipt" className="mt-1 block rounded-xl border border-x-border p-2.5">
      <span className="block text-[13px] font-bold leading-4 text-x-sec">@{receipt.handle}</span>
      <span className="mt-0.5 block text-[14px] leading-5 text-x-text">{receipt.text}</span>
    </span>
  );
}

/** the tab's failure state: visible, never an empty history, with a Retry that re-runs the read (not a page load) */
export function RelationshipHistoryError({ onRetry }: { onRetry?: () => void }) {
  return (
    <p data-testid="relationship-history-error" className="border-b border-x-border px-4 py-3 text-[13px] text-x-sec">
      Couldn&rsquo;t read your relationship history right now.
      {onRetry && (
        <button
          type="button"
          data-testid="relationship-history-retry"
          onClick={onRetry}
          className="ml-2 font-bold text-x-blue hover:underline"
        >
          Retry
        </button>
      )}
    </p>
  );
}

export function RelationshipHistory({
  view,
  onRetry,
}: {
  view: RelationshipHistoryView;
  onRetry?: () => void;
}) {
  if (view.status === "error") return <RelationshipHistoryError onRetry={onRetry} />;
  if (view.empty) return null;

  const { follow, backfilledFollow, firstInteraction, engagements, strikes, muted, strikesOn, strikeThreshold } = view;
  const receipt = (e: { receipt: HistoryReceipt | null }) => (e.receipt ? <ReceiptCast receipt={e.receipt} /> : null);

  return (
    <section data-testid="relationship-history" className="border-b border-x-border px-4 py-3">
      <h2 className="text-[15px] font-extrabold leading-5 text-x-text">Your history</h2>

      {follow && (
        <div data-testid="history-follow" className="mt-2">
          <p className="text-[13px] leading-4 text-x-sec">
            You followed <span className="font-bold">{follow.when}</span>
            {follow.context !== "profile" ? ` from the ${follow.context.replace("_", " ")}` : ""}
            {follow.receipt ? " because of this post:" : "."}
          </p>
          {receipt(follow)}
        </div>
      )}
      {!follow && backfilledFollow && (
        <p data-testid="history-backfilled" className="mt-2 text-[13px] leading-4 text-x-sec">
          <span className="rounded bg-[#f7f9f9] px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide">
            backfilled
          </span>{" "}
          You were already following before the relationship log existed — no origin recorded.
        </p>
      )}

      {firstInteraction && (
        <div data-testid="history-first-interaction" className="mt-3">
          <p className="text-[13px] leading-4 text-x-sec">First interaction:</p>
          {receipt(firstInteraction)}
        </div>
      )}

      {engagements > 0 && (
        <p data-testid="history-engagements" data-count={engagements} className="mt-3 text-[13px] leading-4 text-x-sec">
          <span className="font-bold text-x-text">{engagements}</span> recorded interaction
          {engagements === 1 ? "" : "s"} (replies and likes).
        </p>
      )}

      {strikes.length > 0 && (
        <div data-testid="history-strikes" data-count={strikes.length} className="mt-3">
          <p className="text-[13px] font-bold leading-4 text-x-text">
            {strikes.length} strike{strikes.length === 1 ? "" : "s"}
            {strikesOn ? ` of ${strikeThreshold}` : " (auto-mute off)"}
            {muted && (
              <span data-testid="history-muted" className="ml-2 rounded-full bg-[#f4212e1a] px-2 py-0.5 text-[11px] font-bold text-[#f4212e]">
                auto-muted
              </span>
            )}
          </p>
          {strikes.map((s, i) => (
            // keyed by position: the log's event id is not shipped (the list is replaced whole, never reordered)
            <div key={i} className="mt-1">
              <p className="text-[13px] leading-4 text-x-sec">
                {s.when} · from the {s.context.replace("_", " ")}:
              </p>
              {receipt(s)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
