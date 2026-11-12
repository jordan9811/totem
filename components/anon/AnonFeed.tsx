"use client";
// PUBLIC GO-LIVE — RECENT @anon POSTS on /anon, from the relay's public list.
//
// The read is relay's contract, answered by the browser device in this tab: GET /api/anon?recent=1&casts=1 (FEED_URL) ->
// {universe, casts: [{castHash, text, at, castUrl}]}, the validator's public list with hidden (taken-down) rows already
// left out — so a removed post is simply absent here. Every card carries Report (relay's AnonReportButton: a fixed list of
// reasons, no reporter identity stored) and Share (components/anon/ShareToFarcaster.tsx), and "View on Farcaster" only when
// castUrl is an https link on the Farcaster web client's hosts.
//
// NEVER FAIL OPEN: a read that fails — the request, or the relay's own "casts: null" with its castsError — is retried twice,
// then said as an error with a Try again, never shown as "no posts yet". An answer without the `casts` field at all (a
// device older than the contract) says the list isn't available here, never "empty". Times are the list's own
// (hour-grained, as the validator records them).
import { useCallback, useEffect, useRef, useState } from "react";
import { AnonReportButton } from "@/components/zk/AnonReportButton";
import { CAST_HASH_RE, isFarcasterWebUrl } from "@/lib/miniapp/manifest";
import { ShareToFarcaster } from "./ShareToFarcaster";

/** relay's list (GET /api/anon?recent=1 answers { universe, casts, castsError }). The extra casts=1 asks for the PUBLIC list
 *  explicitly, so the route can keep the composer's own 20-second ?recent=1 poll (components/AnonPostStatus.tsx) memory-only
 *  and read the validator only for this feed (a route that ignores it answers the same) */
export const FEED_URL = "/api/anon?recent=1&casts=1";

export interface FeedCast {
  castHash: string;
  text: string;
  at: number | null;
  castUrl: string | null;
}
type FeedState = { kind: "loading" } | { kind: "ok"; universe: string; casts: FeedCast[] } | { kind: "error"; text: string } | { kind: "unsupported" };

/** the relay's answer, read defensively (exported for scripts/unit-miniapp.mjs): only well-formed rows survive; the relay's
 *  "casts: null" + castsError (the list could not be read) is an ERROR, never an empty list; no `casts` field = null */
export function parseFeed(j: unknown): { universe: string; casts: FeedCast[] } | { error: string } | null {
  if (!j || typeof j !== "object") return null;
  const o = j as { universe?: unknown; mode?: unknown; casts?: unknown; castsError?: unknown };
  if (o.casts === null) return { error: typeof o.castsError === "string" && o.castsError ? o.castsError.slice(0, 200) : "the list could not be read" };
  if (!Array.isArray(o.casts)) return null;
  const universe = typeof o.universe === "string" ? o.universe : typeof o.mode === "string" ? o.mode : "fixture";
  const casts: FeedCast[] = [];
  for (const c of o.casts as unknown[]) {
    if (!c || typeof c !== "object") continue;
    const x = c as { castHash?: unknown; text?: unknown; at?: unknown; castUrl?: unknown };
    if (typeof x.castHash !== "string" || !CAST_HASH_RE.test(x.castHash) || typeof x.text !== "string") continue;
    casts.push({ castHash: x.castHash, text: x.text, at: typeof x.at === "number" && Number.isFinite(x.at) ? x.at : null, castUrl: isFarcasterWebUrl(x.castUrl) ? x.castUrl : null });
  }
  return { universe, casts };
}

/** THE HUB ROUTE: @anon's posts as the Farcaster protocol has them (GET /api/anon/network: the validator's castsByFid read
 *  of its hub). The Farcaster app may hide the account; the protocol does not. */
export const NETWORK_URL = "/api/anon/network";
export interface NetworkCast {
  hash: string;
  castHash: string | null;
  text: string;
  at: number | null;
}
type NetworkState = { kind: "none" } | { kind: "ok"; hashes: string[]; extra: NetworkCast[] } | { kind: "error"; text: string };
const NET_HASH_RE = /^0x[0-9a-f]{40}$/;
/** the network hash a feed card's Farcaster link names (lib/zk/anon/universe.ts castUrlFor's shape), or null */
export const networkHashOf = (castUrl: string | null) => {
  const m = castUrl ? /\/(0x[0-9a-f]{40})$/.exec(castUrl) : null;
  return m ? m[1] : null;
};
/**
 * PURE (exported for scripts/unit-miniapp.mjs-style checks): join the relay's list with the protocol's. Returns the
 * network hashes the protocol confirms and the protocol's casts the relay's list does not show (a post relayed before
 * this device's list, or one the list dropped), newest first. A malformed answer is null (never "nothing on Farcaster").
 */
export function joinNetwork(feed: FeedCast[], j: unknown): { hashes: string[]; extra: NetworkCast[] } | null {
  if (!j || typeof j !== "object" || !Array.isArray((j as { casts?: unknown }).casts)) return null;
  const net: NetworkCast[] = [];
  for (const c of (j as { casts: unknown[] }).casts) {
    const x = (c ?? {}) as { hash?: unknown; castHash?: unknown; text?: unknown; at?: unknown };
    if (typeof x.hash !== "string" || !NET_HASH_RE.test(x.hash) || typeof x.text !== "string") continue;
    net.push({ hash: x.hash, castHash: typeof x.castHash === "string" && CAST_HASH_RE.test(x.castHash) ? x.castHash : null, text: x.text, at: typeof x.at === "number" && Number.isFinite(x.at) ? x.at : null });
  }
  const shownCast = new Set(feed.map((f) => f.castHash));
  const shownNet = new Set(feed.map((f) => networkHashOf(f.castUrl)).filter(Boolean) as string[]);
  return { hashes: net.map((n) => n.hash), extra: net.filter((n) => !shownNet.has(n.hash) && !(n.castHash && shownCast.has(n.castHash))) };
}

const when = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnonFeed({ origin, inMiniApp, refreshKey, previewOnly }: { origin: string; inMiniApp: boolean; refreshKey: number; previewOnly: boolean }) {
  const [state, setState] = useState<FeedState>({ kind: "loading" });
  const [network, setNetwork] = useState<NetworkState>({ kind: "none" });
  const inflight = useRef(false);
  // THE HUB ROUTE: the live list is checked against the protocol (one read per load; a site without a hub answers 501 and
  // the feed stays as it was). A failed read is SAID ("couldn't check"), never shown as "not on Farcaster".
  const loadNetwork = useCallback(async (feed: FeedCast[]) => {
    try {
      const r = await fetch(NETWORK_URL, { cache: "no-store" });
      if (r.status === 501) return setNetwork({ kind: "none" });
      const j = (await r.json().catch(() => null)) as unknown;
      const joined = r.ok ? joinNetwork(feed, j) : null;
      if (joined) return setNetwork({ kind: "ok", ...joined });
      const why = j && typeof j === "object" && typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : "the list answered " + r.status;
      setNetwork({ kind: "error", text: why.slice(0, 200) });
    } catch (e) {
      setNetwork({ kind: "error", text: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }, []);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(800 * attempt);
        try {
          const r = await fetch(FEED_URL, { cache: "no-store" });
          const j = (await r.json().catch(() => null)) as unknown;
          if (!r.ok) {
            lastError = (j && typeof j === "object" && typeof (j as { error?: unknown }).error === "string" ? (j as { error: string }).error : "the list answered " + r.status).slice(0, 200);
            continue;
          }
          const parsed = parseFeed(j);
          if (!parsed) {
            setState({ kind: "unsupported" });
            return;
          }
          if ("error" in parsed) {
            lastError = parsed.error;
            continue;
          }
          setState({ kind: "ok", ...parsed });
          if (parsed.universe === "live") void loadNetwork(parsed.casts);
          return;
        } catch (e) {
          lastError = String((e as Error)?.message ?? e).slice(0, 200);
        }
      }
      setState({ kind: "error", text: lastError || "the list could not be read" });
    } finally {
      inflight.current = false;
    }
  }, [loadNetwork]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  return (
    <section data-testid="anon-feed" data-state={state.kind} aria-label="Recent anonymous posts" className="rounded-2xl border border-x-border-dark">
      <h2 className="border-b border-x-border px-4 py-3 text-[17px] font-extrabold">Recent posts from @anon</h2>
      {state.kind === "loading" ? <p className="px-4 py-3 text-[15px] text-x-sec">Loading recent posts…</p> : null}
      {state.kind === "error" ? (
        <div data-testid="anon-feed-error" role="alert" className="px-4 py-3 text-[15px]">
          <p className="text-[#f4212e]">Couldn&rsquo;t load recent posts ({state.text}).</p>
          <button type="button" data-testid="anon-feed-retry" onClick={() => void load()} className="mt-2 font-bold text-x-blue hover:underline">
            Try again
          </button>
        </div>
      ) : null}
      {state.kind === "unsupported" ? (
        <p data-testid="anon-feed-unsupported" className="px-4 py-3 text-[15px] text-x-sec">
          The list of anonymous posts isn&rsquo;t available on this site yet.
        </p>
      ) : null}
      {state.kind === "ok" && state.casts.length === 0 ? (
        <p data-testid="anon-feed-empty" className="px-4 py-3 text-[15px] text-x-sec">
          No anonymous posts yet. Yours could be the first.
        </p>
      ) : null}
      {state.kind === "ok" ? (
        <ul>
          {state.casts.map((c) => (
            <li key={c.castHash} data-testid="anon-feed-item" data-cast-hash={c.castHash} className="border-b border-x-border px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-2 text-[13px] text-x-sec">
                <span className="font-bold text-x-text">@anon</span>
                {c.at !== null ? <span>· {when(c.at)}</span> : null}
                {previewOnly || state.universe === "fixture" ? (
                  <span data-testid="anon-feed-preview" className="rounded-full bg-x-pill px-2 text-[12px]">
                    Preview only · not on Farcaster
                  </span>
                ) : null}
                {network.kind === "ok" && network.hashes.includes(networkHashOf(c.castUrl) ?? "") ? (
                  <span data-testid="anon-feed-onnet" className="text-[12px]">· on the Farcaster network</span>
                ) : null}
              </div>
              <p data-testid="anon-feed-text" className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-5">
                {c.text}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                {c.castUrl ? (
                  <a data-testid="anon-feed-cast-link" href={c.castUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-[13px] text-x-sec hover:text-x-blue hover:underline">
                    View on Farcaster
                  </a>
                ) : null}
                <ShareToFarcaster castHash={c.castHash} origin={origin} inMiniApp={inMiniApp} compact />
                <AnonReportButton castHash={c.castHash} universe={state.universe} />
              </div>
            </li>
          ))}
          {network.kind === "ok"
            ? network.extra.map((n) => (
                <li key={n.hash} data-testid="anon-feed-network-item" data-network-hash={n.hash} className="border-b border-x-border px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-2 text-[13px] text-x-sec">
                    <span className="font-bold text-x-text">@anon</span>
                    {n.at !== null ? <span>· {when(n.at)}</span> : null}
                    <span className="text-[12px]">· on the Farcaster network</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-5">{n.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <a href={"/anon/p/" + n.hash} className="text-[13px] text-x-sec hover:text-x-blue hover:underline">
                      Open
                    </a>
                  </div>
                </li>
              ))
            : null}
        </ul>
      ) : null}
      {state.kind === "ok" && network.kind === "error" ? (
        <p data-testid="anon-feed-network-error" className="border-t border-x-border px-4 py-2 text-[13px] text-x-sec">
          Couldn&rsquo;t check these posts on the Farcaster network just now ({network.text}).
        </p>
      ) : null}
    </section>
  );
}
