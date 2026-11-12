"use client";
// MEGA PASS 2 Gate 4 — ONE BOX over everything this root touched. Keyword by
// default; "AI" runs the local model in a worker and says so when the device
// cannot; the cloud option is OFF by default and asks, per query, exactly
// what would be sent ("send these N snippets to <provider>?") before anything
// moves. Results are grouped by type; a private record wears private chrome.
//
// PROD-LIVE (D-CU-0-4): every read here goes to /api/search/unified, which the browser device answers on a public
// deployment (the index is built from the visitor's own vault, in the tab). Two fixes for that world: a failed STATUS
// read used to be stored as the status itself (`{error}`), and the first render of `status.semantic` then threw and
// took the whole search page down — it is now an error line with a Retry, and the scope panel says the scope could
// not be read instead of letting unchecked boxes pass for "off"; and a hit's internal link is a client-side
// navigation (next/link), because a full document load wipes an unsaved visitor identity.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Mode = "keyword" | "semantic" | "cloud";
interface Hit { id: string; type: string; personaId: string; as: string; private: boolean; title: string; snippet: string; at: number; href?: string; score: number; why: string[] }
interface Result {
  q: string;
  mode: Mode;
  degraded?: { from: Mode; to: Mode; reason: string };
  needsConsent?: { provider: string; snippets: number; queryHash: string; preview: string[] };
  sent?: { provider: string; snippets: number; fixture: true };
  groups: { type: string; hits: Hit[] }[];
  total: number;
  indexed: number;
  types: string[];
  scope?: Scope;
}

/** POST-DEPLOY Gate 2: the scope every answer is computed under, reported by
 *  the route so the UI states the truth instead of guessing at it. */
interface Scope { unified: boolean; compartment: boolean; activePersonaId: string; personaIds: string[] }

const TYPE_LABEL: Record<string, string> = { cast: "Posts", privatePost: "Private posts", dm: "Messages", like: "Likes", bookmark: "Bookmarks", stake: "Stakes", relationship: "Relationship events", import: "Imported archives" };

export function UnifiedSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [mode, setMode] = useState<Mode>("keyword");
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<{ semantic: { available: boolean; reason: string | null }; indexed: number; types: string[]; scope?: Scope } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    fetch("/api/search/unified?status=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        // never store an error body AS the status: its missing fields crashed the render
        if (!r.ok || !j || !j.semantic) throw new Error((j && j.error) || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        setStatus(j);
        setStatusError(null);
      })
      .catch((e) => {
        setStatus(null);
        setStatusError((e as Error).message || "status unavailable");
      });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  /** The cross-persona toggle and the one-tap hard scope. Both are stored
   *  (vault-local) rather than component state: a scope that resets on reload
   *  is not a scope, and the screen being shared is the reload. */
  const setScope = useCallback(
    async (action: "unified" | "compartment", on: boolean) => {
      setScopeBusy(true);
      setScopeError(null);
      try {
        const r = await fetch("/api/persona/chrome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, on }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "scope change failed");
        setResult(null);
        loadStatus();
      } catch (e) {
        setScopeError((e as Error).message);
      } finally {
        setScopeBusy(false);
      }
    },
    [loadStatus]
  );

  const run = useCallback(async (consent?: { provider: string; snippets: number; queryHash: string }) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const useMode: Mode = mode === "cloud" && !cloudEnabled ? "keyword" : mode;
      const url = `/api/search/unified?q=${encodeURIComponent(q)}&mode=${useMode}${consent ? `&consent=${encodeURIComponent(JSON.stringify(consent))}` : ""}`;
      const r = await fetch(url).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [q, mode, cloudEnabled]);

  /** The cross-persona VIEW: no query, everything the current scope can see,
   *  newest first, each row saying which persona it belongs to. Read-only. */
  const browse = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/search/unified?browse=1", { cache: "no-store" }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="unified-search" className="px-4 pb-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex items-center gap-2 py-3"
      >
        <input
          data-testid="unified-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything you've touched"
          className="h-10 flex-1 rounded-full border border-x-border bg-x-hover px-4 text-[15px] outline-none focus:border-x-blue focus:bg-white"
        />
        <button data-testid="unified-search-go" disabled={busy} className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          Search
        </button>
        <button
          type="button"
          data-testid="unified-browse"
          disabled={busy}
          onClick={() => void browse()}
          className="h-9 rounded-full border border-x-border px-4 text-[15px] font-bold disabled:opacity-50"
        >
          Browse everything
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2 pb-3 text-[13px]">
        {(["keyword", "semantic"] as const).map((m) => (
          <button key={m} data-testid={`unified-mode-${m}`} onClick={() => setMode(m)} className={`h-7 rounded-full border px-3 font-bold ${mode === m ? "border-x-blue text-x-blue" : "border-x-border text-x-sec"}`}>
            {m === "keyword" ? "Keyword" : "AI (local)"}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-x-sec">
          <input data-testid="unified-cloud-toggle" type="checkbox" checked={cloudEnabled} onChange={(e) => { setCloudEnabled(e.target.checked); if (e.target.checked) setMode("cloud"); else if (mode === "cloud") setMode("keyword"); }} />
          cloud model (asks before every send; off by default)
        </label>
        {status ? (
          <span data-testid="unified-status" data-semantic={status.semantic.available ? "1" : "0"} data-indexed={status.indexed} data-types={status.types.length} className="ml-auto text-x-sec">
            {status.indexed} records · {status.types.length} types · local model {status.semantic.available ? "ready" : "unavailable"}
          </span>
        ) : statusError ? (
          <span data-testid="unified-status-error" className="ml-auto text-x-sec">
            Couldn&rsquo;t read the index status ({statusError}).
            <button type="button" data-testid="unified-status-retry" onClick={loadStatus} className="ml-1 font-bold text-x-blue hover:underline">
              Retry
            </button>
          </span>
        ) : null}
      </div>

      <div
        data-testid="unified-scope"
        data-unified={status?.scope?.unified ? "1" : "0"}
        data-compartment={status?.scope?.compartment ? "1" : "0"}
        data-personas={status?.scope?.personaIds.length ?? 0}
        className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-x-border px-3 py-2 text-[13px]"
      >
        <label className="flex items-center gap-1 font-bold">
          <input
            data-testid="unified-cross-persona-toggle"
            type="checkbox"
            disabled={scopeBusy || !!status?.scope?.compartment}
            checked={!!status?.scope?.unified}
            onChange={(e) => void setScope("unified", e.target.checked)}
          />
          Search across all my personas
        </label>
        <span className="text-x-sec">
          Off by default. A unified view puts an anonymous persona next to a work one on the same
          screen — which is a hazard a shared screen creates and no encryption removes.
        </span>
        <button
          data-testid="unified-compartment"
          disabled={scopeBusy}
          onClick={() => void setScope("compartment", !status?.scope?.compartment)}
          className={`ml-auto h-7 rounded-full border px-3 font-bold ${status?.scope?.compartment ? "border-x-blue bg-x-blue text-white" : "border-x-border text-x-text"}`}
        >
          {status?.scope?.compartment ? "Leave compartment mode" : "Compartment mode"}
        </button>
        {status?.scope?.compartment ? (
          <p data-testid="unified-compartment-note" className="w-full text-x-sec">
            Compartment mode is on: this device is scoped to the active persona. Every cross-persona
            surface — this search, the account switcher, the act-as picker, a sibling&rsquo;s stake
            history — answers for the active persona only, at the API, not by hiding a menu.
          </p>
        ) : null}
        {statusError ? (
          <p data-testid="unified-scope-unknown" className="w-full text-x-sec">
            Your current search scope couldn&rsquo;t be read, so the settings above may not reflect it.
          </p>
        ) : null}
        {scopeError ? <p data-testid="unified-scope-error" className="w-full text-[#f4212e]">{scopeError}</p> : null}
      </div>

      {error ? <p data-testid="unified-error" className="py-2 text-[15px] text-x-sec">{error}</p> : null}

      {result?.degraded ? (
        <p data-testid="unified-degraded" data-from={result.degraded.from} className="rounded-2xl border border-x-border px-3 py-2 text-[13px] text-x-sec">
          This device can&rsquo;t run the local model right now ({result.degraded.reason}) — showing keyword results instead.
        </p>
      ) : null}

      {result?.needsConsent ? (
        <div data-testid="unified-consent" data-snippets={result.needsConsent.snippets} data-provider={result.needsConsent.provider} className="rounded-2xl border border-x-border p-3 text-[15px]">
          <p className="font-bold">Send these {result.needsConsent.snippets} snippets to {result.needsConsent.provider}?</p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-x-sec">
            {result.needsConsent.preview.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p className="mt-1 text-[13px] text-x-sec">Nothing has been sent. The snippets above are exactly what would leave this device.</p>
          <div className="mt-2 flex gap-2">
            <button data-testid="unified-consent-yes" onClick={() => void run({ provider: result.needsConsent!.provider, snippets: result.needsConsent!.snippets, queryHash: result.needsConsent!.queryHash })} className="h-8 rounded-full bg-x-blue px-3 text-[13px] font-bold text-white">Send them</button>
            <button data-testid="unified-consent-no" onClick={() => setResult({ ...result, needsConsent: undefined })} className="h-8 rounded-full border border-x-border px-3 text-[13px] font-bold">Keep it local</button>
          </div>
        </div>
      ) : null}

      {result?.sent ? (
        <p data-testid="unified-sent" data-snippets={result.sent.snippets} className="py-1 text-[13px] text-x-sec">Sent {result.sent.snippets} snippets to {result.sent.provider} (a fixture in this build — nothing left the device).</p>
      ) : null}

      {result ? (
        <div data-testid="unified-results" data-mode={result.mode} data-total={result.total} data-groups={result.groups.length} data-unified={result.scope?.unified ? "1" : "0"} data-compartment={result.scope?.compartment ? "1" : "0"} data-scope-personas={result.scope?.personaIds.length ?? 0}>
          {result.groups.length === 0 && !result.needsConsent ? <p className="py-3 text-[15px] text-x-sec">Nothing matched.</p> : null}
          {result.groups.map((gp) => (
            <section key={gp.type} data-testid="unified-group" data-type={gp.type} className="border-t border-x-border py-2">
              <h3 className="text-[15px] font-bold">{TYPE_LABEL[gp.type] ?? gp.type} <span className="font-normal text-x-sec">· {gp.hits.length}</span></h3>
              <ul className="mt-1 space-y-2">
                {gp.hits.map((h) => (
                  <li key={h.id} data-testid="unified-hit" data-type={h.type} data-persona={h.personaId} data-as={h.as} data-private={h.private ? "1" : "0"} className={`rounded-xl border px-3 py-2 ${h.private ? "border-dashed border-x-sec bg-x-hover" : "border-x-border"}`}>
                    {h.private ? <p data-testid="unified-private-chrome" className="text-[12px] font-bold text-x-sec">Private · only you</p> : null}
                    <p data-testid="unified-hit-attribution" className="text-[12px] font-bold text-x-sec">as @{h.as}</p>
                    <p className="text-[15px] font-bold">
                      {h.href ? (
                        h.href.startsWith("/") && !h.href.startsWith("//") ? (
                          <Link href={h.href} className="hover:underline">{h.title}</Link>
                        ) : (
                          <a href={h.href} className="hover:underline">{h.title}</a>
                        )
                      ) : (
                        h.title
                      )}
                    </p>
                    <p className="text-[15px] leading-5">{h.snippet}</p>
                    <p className="text-[12px] text-x-sec">{h.why.length ? "matched: " + h.why.join(", ") : ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
