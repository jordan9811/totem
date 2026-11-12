"use client";
// Backpack pass: per-claim provenance inspector. Every claim in the graph
// shown with its full provenance — trust tier, method, issuer, date —
// never a flat undifferentiated list. Attested/imported claims and
// self-declared claims are visually distinct, so where a claim CAME FROM
// is always legible.
import { useCallback, useEffect, useState } from "react";
import type { GraphClaim } from "@/lib/adapters/types";

const TRUST_LABEL: Record<GraphClaim["source"], string> = {
  self: "self-declared",
  attested: "attested",
  "x-inferred": "platform-inferred",
};
const METHOD_LABEL: Record<string, string> = {
  "self-declared": "self-declared",
  "w3c-vc": "W3C Verifiable Credential",
  "did-control": "DID control proof",
  "platform-export": "platform export",
  "x-archive": "X archive",
  "zk-attestation": "zk attestation (issuer-signed, bucketed)",
};
const TIER_STYLE: Record<GraphClaim["source"], string> = {
  attested: "bg-x-blue/10 text-x-blue",
  "x-inferred": "bg-amber-500/10 text-amber-600",
  self: "bg-x-border text-x-sec",
};

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

export function ClaimProvenance({ refreshKey }: { refreshKey?: number }) {
  const [claims, setClaims] = useState<GraphClaim[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error((await res.json()).error ?? "claims unavailable");
      setClaims((await res.json()).claims ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Attested first, then platform-inferred, then self-declared: provenance
  // strength descending, so the strongest evidence reads first.
  const order: Record<GraphClaim["source"], number> = { attested: 0, "x-inferred": 1, self: 2 };
  const sorted = [...claims].sort((a, b) => order[a.source] - order[b.source]);

  return (
    <div data-testid="claim-provenance" className="px-4 py-4">
      <p className="mb-1 text-[15px] font-bold leading-5">Where your data came from</p>
      <p className="mb-3 text-[13px] leading-4 text-x-sec">
        Every claim in your backpack, with its source and how it was established.
      </p>
      {error && (
        <p data-testid="provenance-error" className="text-[13px] leading-4 text-x-sec">
          {error}
        </p>
      )}
      {sorted.map((c) => (
        <div
          key={c.id}
          data-testid="provenance-claim"
          data-claim-id={c.id}
          data-tier={c.source}
          data-method={c.method ?? "self-declared"}
          className="mb-1.5 flex items-center justify-between rounded-xl border border-x-border px-3 py-2"
        >
          <div className="min-w-0 pr-3">
            <p className="truncate text-[14px] leading-5">{c.label}</p>
            <p className="text-[12px] leading-4 text-x-sec">
              {METHOD_LABEL[c.method ?? "self-declared"] ?? c.method}
              {c.issuer ? ` · ${c.issuer}` : ""} · {fmtDate(c.issuedAt)}
            </p>
          </div>
          <span
            data-testid="provenance-tier"
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TIER_STYLE[c.source]}`}
          >
            {TRUST_LABEL[c.source]}
          </span>
        </div>
      ))}
      {sorted.length === 0 && !error && (
        <p className="text-[13px] leading-4 text-x-sec">No claims yet — import or declare one above.</p>
      )}
    </div>
  );
}
