"use client";
// FOLLOWING FROM THE HUB — a Farcaster thread opened from a hub card, by its protocol id: /fc/cast#<fid>/<hash>. The
// fid and hash ride the URL FRAGMENT, which the browser never sends, so Totem's app server only ever sees "/fc/cast";
// this island reads the fragment and asks the device (POST /api/fc/hub {op:"thread"}), which reads the node directly.
// Shown: the posts it replies to (oldest first, joined by the thread line), the cast, and its direct replies. The node's
// own NotFound says "isn't on Farcaster's network"; a read that failed is an error with Retry, never "not found"; a
// failed ancestor or replies read is said beside what could be read.
// REPLY AS YOU: once Totem may post as the visitor's own account (POST AS YOU, components/root/RootPost.tsx), no persona
// is acting and the cast is not one of their personas', a reply box posts a real Farcaster reply (parent = this cast's
// fid + hash) through the same device route; otherwise the page says why (and, when the key is what is missing, links
// to allowing it). Every card here likes, recasts and replies the same way (components/hub/HubWrite.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Cast } from "@/lib/types";
import type { HubThreadView } from "@/lib/fc/hubRead/copy";
import { parseHubCastFragment } from "@/lib/fc/hubRead/copy";
import { CastCard } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";
import { ALLOW_LABEL, hubWritesNeedKey } from "@/lib/fc/rootSigner/copy";
import { hubCall } from "./hubCall";
import { HubReplyComposer, useHubWriteGate } from "./HubWrite";

/** the page's fragment, parsed, kept current (hashchange); `read` once it has been looked at */
export function useFragment<T>(parse: (h: string) => T | null): { value: T | null; read: boolean } {
  const [state, setState] = useState<{ value: T | null; read: boolean }>({ value: null, read: false });
  useEffect(() => {
    const read = () => {
      const v = parse(window.location.hash);
      // an inert in-page link ("#") never blanks what is shown
      setState((s) => (v === null && s.value !== null && window.location.hash.length <= 1 ? s : { value: v, read: true }));
    };
    read();
    const later = window.setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener("hashchange", read);
    };
  }, [parse]);
  return state;
}

/** the thread page's reply box, under the cast: the same gate and composer as a card's Reply (components/hub/HubWrite.tsx) */
function ReplyAsRoot({ cast, onPosted }: { cast: Cast; onPosted: () => void }) {
  const gate = useHubWriteGate(cast);
  if (!gate.hub || !gate.handle) return null;
  if (!gate.ok) {
    const needsKey = gate.reason === hubWritesNeedKey(gate.handle);
    return (
      <p data-testid="hub-reply-needs-key" data-reason={needsKey ? "key" : "off"} className="border-b border-x-border px-4 py-3 text-[14px] leading-5 text-x-sec">
        {gate.reason}
        {needsKey ? (
          <>
            {" "}
            <Link href="/settings/account#post-as-you" className="font-bold text-x-blue hover:underline">
              {ALLOW_LABEL}
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  return <HubReplyComposer parent={{ fid: cast.author.fid, hash: cast.hash }} handle={gate.handle} testid="hub-reply" onPosted={onPosted} />;
}

export function HubThread() {
  const target = useFragment(parseHubCastFragment);
  const [view, setView] = useState<HubThreadView | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const seq = useRef(0);
  const key = target.value ? target.value.fid + "/" + target.value.hash : null;

  const load = useCallback(async () => {
    if (!target.value) return;
    const my = ++seq.current;
    setError(null);
    const r = await hubCall<HubThreadView>({ op: "thread", fid: target.value.fid, hash: target.value.hash });
    if (my !== seq.current) return;
    if (r.ok) setView(r.data);
    else {
      setView(null);
      setError({ message: r.error, code: r.code });
    }
    // key, not target.value: a re-render with the same fragment is not a new question
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  if (target.read && !target.value) {
    return (
      <p data-testid="hub-thread-bad-link" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        This link doesn&rsquo;t name a Farcaster post.{" "}
        <Link href="/home?tab=following" className="font-bold text-x-blue hover:underline">
          Back to Following
        </Link>
      </p>
    );
  }
  if (error) {
    if (error.code === "not_found") {
      return (
        <div data-testid="hub-thread-not-found" className="px-8 py-10">
          <p className="text-[24px] font-extrabold leading-8">This post isn&rsquo;t on Farcaster</p>
          <p className="mt-2 text-[15px] leading-5 text-x-sec">{error.message}</p>
        </div>
      );
    }
    return (
      <div data-testid="hub-thread-error" role="alert" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        {error.message}
        <button type="button" data-testid="hub-thread-retry" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
          Retry
        </button>
      </div>
    );
  }
  if (!view || !target.value) {
    return (
      <div data-testid="hub-thread-loading" aria-busy="true">
        <TimelineSkeleton count={3} />
      </div>
    );
  }
  const { cast, ancestors, replies } = view;
  return (
    <div data-testid="hub-thread" data-hash={cast.hash}>
      {view.ancestorMissing ? (
        <p data-testid="hub-thread-ancestor-missing" className="border-b border-x-border px-4 py-2 text-[13px] text-x-sec">
          {view.ancestorMissing}
        </p>
      ) : null}
      {view.ancestorsError ? (
        <p data-testid="hub-thread-ancestors-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] text-[#f4212e]">
          {view.ancestorsError}
          <button type="button" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      ) : null}
      <div data-testid="hub-thread-ancestors">
        {ancestors.map((a, i) => (
          <CastCard key={a.hash} cast={a} connectorAbove={i > 0} connectorBelow />
        ))}
      </div>
      <div data-testid="hub-thread-cast">
        <CastCard cast={cast} connectorAbove={ancestors.length > 0} selected />
      </div>
      <ReplyAsRoot cast={cast} onPosted={() => void load()} />
      {view.repliesError ? (
        <p data-testid="hub-thread-replies-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] text-[#f4212e]">
          {view.repliesError}
          <button type="button" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      ) : null}
      <div data-testid="hub-thread-replies" data-count={replies.length}>
        {replies.map((r) => (
          <CastCard key={r.hash} cast={r} />
        ))}
      </div>
      {view.moreReplies ? (
        <p className="border-b border-x-border px-4 py-3 text-[13px] text-x-sec">Showing the first {replies.length} replies.</p>
      ) : null}
      <div className="h-32" />
    </div>
  );
}
