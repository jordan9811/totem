"use client";
// Category browser for claimable attributes. Standard categories are
// one-tap. Sensitive categories live behind their own visually distinct
// opt-in with explicit per-category consent copy, default OFF, and are
// deliberately excluded from "Claim all" — that button only ever touches
// standard categories.
import { useCallback, useEffect, useState } from "react";
import type { GraphClaim } from "@/lib/adapters/types";

interface Payload {
  claims: GraphClaim[];
  catalogue: Record<string, { label: string; value: string }[]>;
  sensitiveCategories: string[];
  consent: Record<string, boolean>;
}

const CATEGORY_LABEL: Record<string, string> = {
  interests: "Interests",
  demographics: "Demographics",
  ownership: "Ownership",
  habits: "Habits",
  health: "Health",
  finances: "Finances",
  politics: "Politics",
};

const CONSENT_COPY: Record<string, string> = {
  health:
    "Health claims describe your body and habits. Sharing them can make you identifiable even in aggregate. Off by default, and never included when you claim everything else at once.",
  finances:
    "Financial claims describe your income and holdings. Advertisers pay more for them, and they carry more risk to you than any other category. Off by default.",
  politics:
    "Political claims are protected in many jurisdictions and are the easiest category to use against you. Off by default, and never bundled with anything else.",
};

export function GraphBuilder() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error((await res.json()).error ?? "graph unavailable");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claimed = new Map((data?.claims ?? []).map((c) => [c.value, c]));

  const toggleClaim = async (category: string, label: string, value: string) => {
    setBusy(value);
    try {
      const existing = claimed.get(value);
      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: existing
          ? JSON.stringify({ action: "toggle", claimId: existing.id, active: !existing.active })
          : JSON.stringify({ category, label, value }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "couldn't update that claim");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const setConsent = async (category: string, consented: boolean) => {
    setBusy(category);
    try {
      const res = await fetch("/api/graph/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, consented }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "couldn't update consent");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error && !data)
    return (
      <p data-testid="graph-error" className="px-4 py-6 text-[15px] text-x-sec">
        Couldn&rsquo;t load your graph. {error}
      </p>
    );
  if (!data) return <p className="px-4 py-6 text-[15px] text-x-sec">Loading your graph…</p>;

  const standard = Object.keys(data.catalogue).filter(
    (c) => !data.sensitiveCategories.includes(c)
  );
  const sensitive = data.sensitiveCategories;

  return (
    <div data-testid="graph-builder">
      {error && (
        <p className="border-b border-x-border bg-[#f7f9f9] px-4 py-2 text-[13px] text-x-sec">{error}</p>
      )}

      {standard.map((category) => (
        <section key={category} data-testid="graph-category" data-category={category} className="border-b border-x-border px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-black leading-6">{CATEGORY_LABEL[category]}</h3>
            <button
              data-testid="claim-all"
              data-category={category}
              onClick={async () => {
                for (const item of data.catalogue[category]) {
                  if (!claimed.get(item.value)?.active) {
                    await toggleClaim(category, item.label, item.value);
                  }
                }
              }}
              className="text-[13px] font-bold text-x-blue hover:underline"
            >
              Claim all
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.catalogue[category].map((item) => {
              const claim = claimed.get(item.value);
              const on = !!claim?.active;
              return (
                <button
                  key={item.value}
                  data-testid="claim-chip"
                  data-value={item.value}
                  data-active={on ? "true" : "false"}
                  data-source={claim?.source ?? "none"}
                  disabled={busy === item.value}
                  onClick={() => toggleClaim(category, item.label, item.value)}
                  className={`flex h-8 items-center rounded-full border px-3 text-[14px] font-bold transition-colors disabled:opacity-50 ${
                    on
                      ? "border-x-blue bg-[#1d9bf01a] text-x-blue"
                      : "border-[#cfd9de] bg-white text-x-text hover:bg-x-hover"
                  }`}
                >
                  {claim?.source === "attested" && (
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className="mr-1">
                      <path d="M12 1.75l2.6 1.9 3.2-.1 1 3.05 2.6 1.85-1 3.05 1 3.05-2.6 1.85-1 3.05-3.2-.1-2.6 1.9-2.6-1.9-3.2.1-1-3.05L2.2 14.5l1-3.05-1-3.05 2.6-1.85 1-3.05 3.2.1 2.6-1.9zm-1.3 12.6l5-5-1.4-1.4-3.6 3.6-1.6-1.6-1.4 1.4 3 3z" />
                    </svg>
                  )}
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* Sensitive categories — visually distinct, per-category consent. */}
      <section data-testid="sensitive-section" className="border-t-4 border-[#f4212e1a] px-4 py-4">
        <h3 className="flex items-center text-[17px] font-black leading-6">
          <svg viewBox="0 0 24 24" width={18} height={18} fill="#f4212e" className="mr-2">
            <path d="M12 1.75a5.25 5.25 0 0 0-5.25 5.25V9.5H5.5A1.5 1.5 0 0 0 4 11v9.25c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5V11a1.5 1.5 0 0 0-1.5-1.5h-1.25V7A5.25 5.25 0 0 0 12 1.75zm3.25 7.75h-6.5V7a3.25 3.25 0 1 1 6.5 0v2.5z" />
          </svg>
          Sensitive categories
        </h3>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">
          Each of these is a separate decision. Nothing here is ever included when you claim a
          standard category, and all of it is off until you turn it on.
        </p>

        {sensitive.map((category) => {
          const consented = data.consent[category] === true;
          return (
            <div
              key={category}
              data-testid="sensitive-category"
              data-category={category}
              data-consented={consented ? "true" : "false"}
              className="mt-4 rounded-2xl border border-[#f4212e33] p-4"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 pr-4">
                  <h4 className="text-[15px] font-bold leading-5">{CATEGORY_LABEL[category]}</h4>
                  <p className="mt-1 text-[13px] leading-4 text-x-sec">{CONSENT_COPY[category]}</p>
                </div>
                <button
                  data-testid="sensitive-consent-toggle"
                  data-category={category}
                  disabled={busy === category}
                  onClick={() => setConsent(category, !consented)}
                  className={`h-8 shrink-0 rounded-full px-4 text-[14px] font-bold disabled:opacity-50 ${
                    consented
                      ? "border border-[#cfd9de] bg-white text-x-text"
                      : "bg-x-black-btn text-white hover:bg-x-black-btn-hover"
                  }`}
                >
                  {consented ? "Turn off" : "Turn on"}
                </button>
              </div>

              {consented && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(data.catalogue[category] ?? []).map((item) => {
                    const claim = claimed.get(item.value);
                    const on = !!claim?.active;
                    return (
                      <button
                        key={item.value}
                        data-testid="claim-chip"
                        data-value={item.value}
                        data-active={on ? "true" : "false"}
                        data-sensitive="true"
                        disabled={busy === item.value}
                        onClick={() => toggleClaim(category, item.label, item.value)}
                        className={`h-8 rounded-full border px-3 text-[14px] font-bold disabled:opacity-50 ${
                          on
                            ? "border-x-blue bg-[#1d9bf01a] text-x-blue"
                            : "border-[#cfd9de] bg-white hover:bg-x-hover"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <div className="h-24" />
    </div>
  );
}
