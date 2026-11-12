"use client";
// Mock data imports. Deliberately multi-step with visible progress — an
// import that lands instantly reads as fake and hides where the data came
// from. Attested claims are marked with issuer + timestamp.
import { useCallback, useEffect, useState } from "react";
import type { ImportConnector, ImportJob } from "@/lib/adapters/types";

const STEP_LABEL = ["Connecting", "Authorizing", "Fetching records", "Previewing claims"];
// UX Gate 4: a platform export isn't individually signed the way a card
// import's attested claims are — same distinction claimsForMatching and
// the Ad Match Score both already carry, surfaced here in plain language.
const TRUST_LABEL: Record<"self" | "attested" | "x-inferred", string> = {
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
};

export function GraphImports({ onImportComplete }: { onImportComplete?: () => void } = {}) {
  const [connectors, setConnectors] = useState<ImportConnector[]>([]);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/graph/import");
      if (!res.ok) throw new Error((await res.json()).error ?? "connectors unavailable");
      setConnectors((await res.json()).connectors);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const start = async (connectorId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/graph/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "import failed to start");
        return;
      }
      let current: ImportJob = (await res.json()).job;
      setJob(current);
      // Walk the steps so progress is observable, and STOP at the preview —
      // nothing is written until the user confirms below.
      while (current.status !== "preview" && current.status !== "complete") {
        await new Promise((r) => setTimeout(r, 500));
        const next = await fetch("/api/graph/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: current.id }),
        });
        if (!next.ok) {
          setError("import stalled — try again");
          return;
        }
        current = (await next.json()).job;
        setJob(current);
      }
    } finally {
      setBusy(false);
    }
  };

  // The explicit commit — only NOW are claims written. No bulk import
  // bypasses this confirm step.
  const commit = async (jobId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/graph/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action: "commit" }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "commit failed");
        return;
      }
      setJob((await res.json()).job);
      onImportComplete?.();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setJob(null);
    setError(null);
  };

  return (
    <div data-testid="graph-imports" className="px-4 py-4">
      {error && (
        <p data-testid="import-error" className="mb-3 text-[13px] leading-4 text-x-sec">
          {error}
        </p>
      )}
      {connectors.map((c) => (
        <div
          key={c.id}
          data-testid="connector"
          data-connector={c.id}
          className="mb-3 rounded-2xl border border-x-border p-4"
        >
          <div className="flex items-start justify-between">
            <div className="min-w-0 pr-4">
              <p className="text-[15px] font-bold leading-5">{c.name}</p>
              <p className="mt-0.5 text-[15px] leading-5 text-x-sec">{c.description}</p>
              <p className="mt-1 text-[13px] leading-4 text-x-sec">Issued by {c.issuer}</p>
            </div>
            <button
              data-testid="start-import"
              data-connector={c.id}
              disabled={busy}
              onClick={() => start(c.id)}
              className="h-8 shrink-0 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
            >
              Import
            </button>
          </div>

          {job && job.connectorId === c.id && (
            <div data-testid="import-progress" data-status={job.status} data-step={job.step} className="mt-3">
              <div className="h-1 w-full overflow-hidden rounded-full bg-x-border">
                <div
                  className="h-full bg-x-blue transition-all"
                  style={{ width: `${(job.step / job.totalSteps) * 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-[13px] leading-4 text-x-sec">
                {job.status === "complete"
                  ? `Imported ${job.claimIds.length} ${TRUST_LABEL[c.trustSource ?? "attested"]} claims`
                  : job.status === "preview"
                    ? `Preview — nothing has been imported yet`
                    : `${STEP_LABEL[job.step - 1] ?? "Working"} · step ${job.step} of ${job.totalSteps}`}
              </p>

              {/* PREVIEW-BEFORE-COMMIT: exactly what will land, at what tier
                  and by what method, before anything is written. */}
              {job.status === "preview" && job.preview && (
                <div data-testid="import-preview" className="mt-3">
                  <p className="mb-2 text-[13px] font-bold leading-4">
                    These {job.preview.filter((p) => !p.withheld).length} claims will be added:
                  </p>
                  {job.preview.map((item) => (
                    <div
                      key={item.value}
                      data-testid="preview-item"
                      data-value={item.value}
                      data-tier={item.source}
                      data-method={item.method}
                      data-withheld={item.withheld ? "true" : "false"}
                      className={`mb-1.5 flex items-center justify-between rounded-xl border border-x-border px-3 py-2 ${item.withheld ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0 pr-3">
                        <p className="truncate text-[14px] leading-5">{item.label}</p>
                        <p className="text-[12px] leading-4 text-x-sec">
                          {TRUST_LABEL[item.source]} · {METHOD_LABEL[item.method] ?? item.method} · {item.issuer}
                        </p>
                      </div>
                      {item.withheld ? (
                        <span data-testid="preview-withheld" className="shrink-0 rounded-full bg-x-border px-2 py-0.5 text-[11px] font-bold text-x-sec">
                          held — opt in {item.category} first
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-x-blue/10 px-2 py-0.5 text-[11px] font-bold text-x-blue">
                          {TRUST_LABEL[item.source]}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <button
                      data-testid="confirm-import"
                      data-connector={c.id}
                      disabled={busy}
                      onClick={() => commit(job.id)}
                      className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
                    >
                      Confirm import
                    </button>
                    <button
                      data-testid="cancel-import"
                      disabled={busy}
                      onClick={cancel}
                      className="h-8 rounded-full border border-x-border px-4 text-[14px] font-bold hover:bg-x-hover disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
