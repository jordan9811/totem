// ZK PASS 1 Gate 3 — the label's MARKUP, and nothing else.
//
// PROD-LIVE (D-CU-0-4): the label used to compute its verdict and render it in one server component. On a public
// deployment the server holds no identity, so it cannot compute the verdict (the scope self-test runs on this
// root's secret) — the browser device computes it instead, and a client island renders it. This file is the one
// piece both shapes share: no "use client", no data access, so the server label (PrivacyLabel.tsx, the rig and
// the discovery surface) and the client label (PrivacyLabelClient.tsx, ZkStatusPane.tsx) emit the same DOM from
// the same verdict. The DEMO band still has no dismiss control, by design.
import type { PrivacyVerdict } from "@/lib/zk/privacy";

export function PrivacyLabelView({ verdict: v }: { verdict: PrivacyVerdict }) {
  if (v.private) {
    return (
      <div
        data-testid="zk-privacy-label"
        data-state="private"
        className="border-b border-x-border bg-[#00ba7c0d] px-4 py-2 text-[13px] leading-4 text-[#00ba7c]"
      >
        <span data-testid="zk-privacy-text" className="font-bold">
          {v.label}
        </span>
        <span className="ml-2 text-x-sec">— all {v.conditions.length} conditions hold this build</span>
      </div>
    );
  }
  return (
    <div
      data-testid="zk-privacy-label"
      data-state="demo"
      role="status"
      aria-live="polite"
      className="border-b border-x-border bg-[#f4212e0d] px-4 py-2 text-[13px] leading-4"
    >
      <span data-testid="zk-privacy-text" className="font-bold text-[#f4212e]">
        DEMO — not yet private
      </span>
      <ul data-testid="zk-privacy-failing" className="mt-1 list-disc pl-5 text-x-sec">
        {v.conditions
          .filter((c) => !c.ok)
          .map((c) => (
            <li key={c.key} data-condition={c.key}>
              {c.detail}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * PROD-LIVE (D-CU-0-4): what a label shows when its verdict could not be computed. NEVER FAIL OPEN — an unknown
 * verdict is never rendered as private: it takes the DEMO band's colours and says why, and offers a retry that
 * re-reads the verdict (never a full page load, which on a public deployment would mint a new identity).
 */
export function PrivacyLabelUnavailable({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div
      data-testid="zk-privacy-label"
      data-state="unavailable"
      role="status"
      aria-live="polite"
      className="border-b border-x-border bg-[#f4212e0d] px-4 py-2 text-[13px] leading-4"
    >
      <span data-testid="zk-privacy-text" className="font-bold text-[#f4212e]">
        DEMO — not yet private
      </span>
      <span className="ml-2 text-x-sec">the privacy conditions could not be computed: {error}</span>
      {onRetry ? (
        <button onClick={onRetry} className="ml-2 font-bold text-x-blue hover:underline" data-testid="zk-privacy-retry">
          Retry
        </button>
      ) : null}
    </div>
  );
}
