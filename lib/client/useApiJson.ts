"use client";
// PROD-LIVE PASS (D-CU-0-4, built): the one way a page island reads identity-bearing data.
//
// On a PUBLIC deployment the server holds no identity at all, so a server component cannot read a visitor's
// personas, modes, folders or feed — every such read reaches for a device key the server refuses to mint. Those
// pages render a shell on the server and fetch here instead; the browser device answers the /api/* route
// in-process (lib/device/host.ts), so the fetch never leaves the tab.
//
// On the RIG the server still holds the seeded keystore and hands the island its data as `initial`. The island is
// the same component in both shapes; only the source differs. When `initial` is supplied the hook never fetches
// on its own and follows the prop — router.refresh() re-renders the server and hands it a new one. When it is
// `null`/`undefined` (the server could not read it), the hook fetches on mount and again whenever the chrome's
// refresh signal changes (a new server render nonce, or an explicit `refresh()` from Providers), so the writes
// that end in router.refresh() still show up on a keyless server.
//
// It never fails OPEN: a failed read is `error`, never an empty list rendered as if it were the truth.
//
// PROD-LIVE (review fix, "stale data hides errors"): the first version kept its last answer through everything —
// a refetch that FAILED left the previous answer in `data` beside the new `error`, and every island checks `error`
// only when `data` is null, so after a failed refetch (a persona switch, a block, a Retry) the page went on drawing
// the previous persona's / previous query's answer with no error at all. Two rules now, enforced here so no island
// has to remember them:
//   1. an answer belongs to the question it answered — the URL asked, and the ACTING persona it was asked as. A new
//      URL (another profile, another query, another tab) or a switch to another persona never shows the old answer
//      while the new one loads: `data` is null (loading) until the new question is answered. A refetch of the SAME
//      question (a like, a follow, a router.refresh()) keeps the answer on screen while it revalidates.
//   2. a refetch that fails REPLACES the answer: `data` is null and `error` is set, so the error wins. A Retry
//      clears the error back to loading while it re-reads, rather than leaving the old failure on screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/Providers";

export interface ApiJson<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** refetch now (no-op while `initial` drives the data) */
  reload: () => void;
}

export async function readApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/** one settled read: the question it answered (url + the acting-persona epoch it was asked in) and its outcome */
interface Answer<T> {
  url: string;
  epoch: number;
  data: T | null;
  error: string | null;
}

export function useApiJson<T>(
  url: string | null,
  opts: { initial?: T | null; init?: RequestInit; enabled?: boolean } = {}
): ApiJson<T> {
  const { refreshTick, renderNonce, actingPersonaId } = useApp();
  const serverSupplied = opts.initial !== undefined && opts.initial !== null;
  const enabled = !serverSupplied && opts.enabled !== false && !!url;
  const initRef = useRef(opts.init);
  initRef.current = opts.init;

  // PROD-LIVE (review fix): which acting persona an answer was asked as, as an EPOCH that moves only on a switch
  // from one known persona to another. null -> A is the roster arriving after boot (the answer already in hand was
  // asked as A, so it stays); A -> B is a persona switch (the answer in hand is A's, so it is dropped and re-read).
  // Derived state, updated during render (React's "storing information from previous renders" pattern) so the very
  // render that sees B already refuses A's answer — an effect would paint one frame of A's data as B's.
  const [persona, setPersona] = useState<{ id: string | null; epoch: number }>(() => ({ id: actingPersonaId, epoch: 0 }));
  let epoch = persona.epoch;
  if (actingPersonaId !== null && actingPersonaId !== persona.id) {
    epoch = persona.id === null ? persona.epoch : persona.epoch + 1;
    setPersona({ id: actingPersonaId, epoch });
  }

  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !url) {
      // nothing is being asked (the server's copy drives the island, or there is no question): drop any answer
      // held from before, so a later re-enable never shows an answer from an earlier life of this island
      setAnswer(null);
      setInFlight(false);
      return;
    }
    let alive = true;
    // (a committed render always has epoch === persona.epoch: a render that moved it re-renders before committing)
    const askedIn = persona.epoch;
    setInFlight(true);
    // a re-read after a FAILURE shows loading, not the old failure; a re-read of a good answer keeps it on screen
    setAnswer((a) => (a && a.error !== null ? null : a));
    readApiJson<T>(url, initRef.current).then(
      (d) => {
        if (!alive) return;
        // never fail open: a 200 whose body could not be read is not an answer
        if (d === null || d === undefined) setAnswer({ url, epoch: askedIn, data: null, error: "the answer could not be read" });
        else setAnswer({ url, epoch: askedIn, data: d, error: null });
        setInFlight(false);
      },
      (e: unknown) => {
        if (!alive) return;
        // rule 2: the failure REPLACES the answer — the previous data must not outlive a failed re-read
        setAnswer({ url, epoch: askedIn, data: null, error: (e as Error)?.message || "request failed" });
        setInFlight(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [url, enabled, persona.epoch, refreshTick, renderNonce, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // the server's copy wins whenever it has one (rig; every router.refresh() hands a fresh one) — nothing is fetched
  if (serverSupplied) return { data: opts.initial as T, error: null, loading: false, reload };
  if (!enabled) return { data: null, error: null, loading: false, reload };
  // rule 1: an answer to another question (another URL, or asked as another persona) is no answer to this one
  const current = answer && answer.url === url && answer.epoch === epoch ? answer : null;
  return {
    data: current ? current.data : null,
    error: current ? current.error : null,
    loading: current === null || inFlight,
    reload,
  };
}
