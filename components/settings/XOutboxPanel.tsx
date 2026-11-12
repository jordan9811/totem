"use client";
// PERSONA LAUNCH P8 — Settings › Totem on X: anonymous posts (TEST DATA everywhere: nothing reaches X).
//
// What it shows, from GET /api/x/outbox (this device's knowledge plus the outbox list its last check read — no extra
// validator read): whether copies to @totem on X can be sent here and why not; the outbox's queue counts; this device's
// own copies and where each one is; and the MODERATOR section. Nothing goes to X before a moderator approves it (the
// owner rule: X suspends a shared account that posts spam), so: on the moderator's device, the posts waiting for a
// decision with Approve / Not approve (signed on this device, verified by the validator against the moderator's PUBLIC
// key); on any other device, this device's moderator key and what it would take to make it one. A not-approved post is
// kept and hidden, never deleted. PERSONA LAUNCH wave 3 (UXH-7): "Not approve" asks first (one tap no longer decides),
// and the last 7 days' not-approved posts sit in a collapsed "Not approved" list with Approve — the validator lets a
// rejected copy be decided again until it is posted, so the panel does too (every decision is signed with a fresh nonce,
// validator/xoutbox.js moderate/2, so deciding the same row twice in one hour is never refused as a replay).
import { useCallback, useEffect, useState } from "react";

interface Copy {
  /** UXH-1: no personaId / copyOf — the view does not send them (it is scoped to the personas it may show) */
  xHash: string;
  state: string;
  sentence: string;
  text: string | null;
}
interface View {
  testData: true;
  offered: boolean;
  reason: string | null;
  devHooks?: boolean;
  slotsPerWindow?: number;
  outboxError?: string | null;
  config?: { xSlotsPerWindow: number; dailyCap: number; dailyUsed: number; postedToday: number; moderated: boolean } | null;
  counts?: { review: number; approved: number; posted: number; rejected: number; failed: number; total: number } | null;
  moderator?: { pubkey: string | null; isModerator: boolean; configured: boolean; error: string | null };
  items?: Copy[];
}
interface ReviewItem {
  id: string;
  text: string;
  kind: string;
  url: string | null;
  status: string;
}

export function XOutboxPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // UXH-7: the row whose "Not approve" is waiting for its confirmation (null = none)
  const [confirmReject, setConfirmReject] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/x/outbox", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as View | null;
      if (!j) setError("Couldn't read the @totem X outbox (test data).");
      else setView(j);
    } catch {
      setError("Couldn't read the @totem X outbox (test data).");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> | null }> => {
    setBusy(true);
    try {
      const r = await fetch("/api/x/outbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { ok: r.ok, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
    } finally {
      setBusy(false);
    }
  };
  const loadReview = async () => {
    const r = await act({ action: "review" });
    if (r.ok && Array.isArray(r.json?.items)) setReview(r.json!.items as ReviewItem[]);
    else setNote(typeof r.json?.error === "string" ? (r.json.error as string) : "Couldn't load the posts waiting for review.");
  };
  const decide = async (id: string, decision: "approve" | "reject") => {
    setConfirmReject(null);
    const r = await act({ action: "moderate", id, decision });
    setNote(r.ok ? (decision === "approve" ? "Approved — it goes out at the outbox's next slot (test data: nothing reaches X)." : "Not approved — it stays off X, kept and hidden (test data).") : typeof r.json?.error === "string" ? (r.json.error as string) : "The decision was not recorded.");
    await loadReview();
    await refresh();
  };
  const becomeTestModerator = async () => {
    const r = await act({ action: "registerModerator" });
    setNote(r.ok ? "This device is now a test moderator on this rig's validator. It shows up after the next check." : typeof r.json?.error === "string" ? (r.json.error as string) : "Refused.");
    await refresh();
  };

  return (
    <div data-testid="x-outbox-panel" className="px-4 pb-8">
      <p data-testid="x-outbox-test-data" className="my-3 rounded-xl border border-x-border p-3 text-[13px] leading-4 text-x-sec">
        <b>Test data.</b> Nothing here reaches X: the outbox posts through a test transport only, and a real @totem account on X is not set up yet.
      </p>
      {error ? <p data-testid="x-outbox-error" className="my-3 text-[15px] text-x-sec">{error}</p> : null}
      {view && !view.offered ? (
        <p data-testid="x-outbox-not-offered" className="my-3 text-[15px] leading-5 text-x-sec">
          {view.reason ?? "Copies to @totem on X aren't offered here."}
        </p>
      ) : null}
      {view ? (
        <>
          <section className="border-b border-x-border py-4">
            <h2 className="text-[17px] font-bold leading-6">How it works</h2>
            <p className="text-[13px] leading-4 text-x-sec">
              Tick &ldquo;Also post to @totem on X&rdquo; on an anonymous post and a copy waits here. A moderator reads every copy before anything goes out, because X suspends a shared account that posts spam. A post with a link goes as a short quote and the link, never in full. {(view.slotsPerWindow ?? 1) === 1 ? "One copy per window" : `${view.slotsPerWindow} copies per window`}, shared across your personas; at most {view.config?.dailyCap ?? 50} a day for everyone. Every word on this page is test data.
            </p>
          </section>
          <section className="border-b border-x-border py-4">
            <h2 className="text-[17px] font-bold leading-6">The outbox (test data)</h2>
            {view.counts ? (
              <p data-testid="x-outbox-counts" data-review={view.counts.review} data-approved={view.counts.approved} data-posted={view.counts.posted} data-rejected={view.counts.rejected} className="text-[13px] leading-4 text-x-sec">
                {view.counts.review} waiting for review · {view.counts.approved} approved · {view.counts.posted} posted (test data — nothing reached X) · {view.counts.rejected} not approved
              </p>
            ) : (
              <p data-testid="x-outbox-counts" className="text-[13px] leading-4 text-x-sec">
                {view.outboxError ? "The outbox couldn't be read on the last check (" + view.outboxError + ")." : "Not read yet."}
              </p>
            )}
          </section>
          <section className="border-b border-x-border py-4">
            <h2 className="text-[17px] font-bold leading-6">Your copies (test data)</h2>
            <ul data-testid="x-outbox-mine" data-count={view.items?.length ?? 0} className="mt-2 space-y-1 text-[13px]">
              {(view.items ?? []).map((c) => (
                <li key={c.xHash} data-testid="x-outbox-mine-item" data-x={c.xHash} data-state={c.state}>
                  <span className="font-mono">{c.xHash.slice(0, 10)}</span> · {c.sentence}
                  {c.text ? <span className="block text-x-sec">&ldquo;{c.text}&rdquo;</span> : null}
                </li>
              ))}
              {(view.items ?? []).length === 0 ? <li className="text-x-sec">No copies from this device.</li> : null}
            </ul>
          </section>
          <section className="py-4" data-testid="x-outbox-moderator" data-moderator={view.moderator?.isModerator ? "true" : "false"}>
            <h2 className="text-[17px] font-bold leading-6">Moderation (test data)</h2>
            {view.moderator?.isModerator ? (
              <>
                <p className="text-[13px] leading-4 text-x-sec">This device moderates the outbox. Nothing goes out until you approve it.</p>
                <button data-testid="x-outbox-load-review" disabled={busy} onClick={() => void loadReview()} className="mt-2 h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
                  Show posts waiting for review
                </button>
                {review ? (
                  <>
                    <ul data-testid="x-outbox-review" data-count={review.filter((r) => r.status !== "rejected").length} className="mt-3 space-y-3">
                      {review
                        .filter((r) => r.status !== "rejected")
                        .map((r) => (
                          <li key={r.id} data-testid="x-outbox-review-item" data-x={r.id} data-status={r.status} className="rounded-xl border border-x-border p-3 text-[15px] leading-5">
                            <p>{r.text}</p>
                            <p className="mt-1 text-[12px] text-x-sec">{r.kind === "quote-link" ? "a quote and its link" : "a post"} · {r.status === "approved" ? "approved, waiting for its slot" : "waiting for review"}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button data-testid="x-outbox-approve" disabled={busy || r.status === "approved"} onClick={() => void decide(r.id, "approve")} className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                                Approve
                              </button>
                              {confirmReject === r.id ? (
                                <>
                                  <span data-testid="x-outbox-reject-confirm-text" className="text-[13px] text-x-sec">
                                    Keep it off X? It is kept and hidden, and you can still approve it later.
                                  </span>
                                  <button data-testid="x-outbox-reject-confirm" disabled={busy} onClick={() => void decide(r.id, "reject")} className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                                    Yes, don&rsquo;t approve
                                  </button>
                                  <button data-testid="x-outbox-reject-cancel" disabled={busy} onClick={() => setConfirmReject(null)} className="h-8 rounded-full px-3 text-[13px] font-bold text-x-blue hover:underline disabled:opacity-50">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button data-testid="x-outbox-reject" disabled={busy} onClick={() => setConfirmReject(r.id)} className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                                  Not approve
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      {review.filter((r) => r.status !== "rejected").length === 0 ? <li className="text-[13px] text-x-sec">Nothing is waiting.</li> : null}
                    </ul>
                    {review.some((r) => r.status === "rejected") ? (
                      <details data-testid="x-outbox-rejected" className="mt-3">
                        <summary className="cursor-pointer text-[13px] font-bold text-x-sec">
                          Not approved ({review.filter((r) => r.status === "rejected").length}, last 7 days — test data)
                        </summary>
                        <ul className="mt-2 space-y-3">
                          {review
                            .filter((r) => r.status === "rejected")
                            .map((r) => (
                              <li key={r.id} data-testid="x-outbox-rejected-item" data-x={r.id} className="rounded-xl border border-x-border p-3 text-[15px] leading-5">
                                <p>{r.text}</p>
                                <p className="mt-1 text-[12px] text-x-sec">not approved · kept and hidden; approve it to send it at the next slot</p>
                                <button data-testid="x-outbox-reapprove" disabled={busy} onClick={() => void decide(r.id, "approve")} className="mt-2 h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                                  Approve
                                </button>
                              </li>
                            ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-[13px] leading-4 text-x-sec">
                  Only a moderator approves posts. {view.moderator?.configured ? "This device isn't one." : "No moderator is set up yet, so nothing is ever approved."}
                </p>
                {view.moderator?.pubkey ? (
                  <p className="mt-1 text-[12px] leading-4 text-x-sec">
                    This device&rsquo;s moderator key (public): <span data-testid="x-outbox-moderator-key" className="break-all font-mono">{view.moderator.pubkey}</span>. To make it the moderator, the owner adds this key to the validator&rsquo;s list of moderator keys.
                  </p>
                ) : null}
                {view.devHooks ? (
                  <button data-testid="x-outbox-dev-moderator" disabled={busy} onClick={() => void becomeTestModerator()} className="mt-2 h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                    Make this device a test moderator (test rig only)
                  </button>
                ) : null}
              </>
            )}
            {note ? <p data-testid="x-outbox-note" className="mt-2 text-[13px] text-x-sec">{note}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
