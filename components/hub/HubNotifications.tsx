"use client";
// NOTIFICATIONS FROM FARCASTER — the notifications page for a visitor signed in with Farcaster on the live site, while
// they act as themselves (no persona acting: components/hub/rootActs.ts). Their real Farcaster notifications, read by
// THIS TAB straight from a Farcaster node (lib/fc/hubRead/notifications.ts; no Neynar, nothing through Totem's servers):
// new followers, mentions, and the replies, likes and recasts on their newest posts, grouped the way X groups them
// ("Alice, Bob and 12 others liked your post"), newest first. A reply or a mention is a hub card, so Reply, Like and
// Recast work on it as the visitor's own account (components/hub/HubWrite.tsx). Accounts open their profile and posts
// open their thread on the hub pages, by fragment (the server never learns which).
//
// UNREAD: what is newer than the last time they were seen (a sealed record in the vault, lib/fc/hubRead/seen.ts).
// Viewing this page (any tab, as on X) marks everything up to the newest notification as seen (op "seen") and the badge
// follows at once; the rows that were new
// when the page opened stay marked while it is open.
// PROGRESSIVE and REFRESHED: the device answers a snapshot and keeps reading; while it says `loading` this island asks
// again. Every minute while the tab is visible, and when it regains focus, it asks the device to re-read what is due.
// NEVER FAIL OPEN: nothing read and a read failed is an error with Retry, never "no notifications"; reads that failed
// beside ones that worked are counted with Retry; "No notifications yet" only after every read worked.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { HubNotificationItem, HubNotificationsView } from "@/lib/fc/hubRead/copy";
import { NOTIF_EMPTY_SENTENCES, hubCastHref, hubProfileHref, notifCoverageSentence, notifSentence } from "@/lib/fc/hubRead/copy";
import { relativeTime } from "@/lib/format";
import { CastCard, MediaImg } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";
import { HeartFilled, RepostIcon } from "@/components/icons";
import { ROOT_CAST_EVENT, hubCall } from "./hubCall";
import { noteHubUnread } from "./HubUnreadBadge";

const FollowGlyph = () => (
  <svg viewBox="0 0 24 24" width={30} height={30} fill="#1d9bf0" aria-hidden="true">
    <path d="M17.863 13.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44zM12 2C9.791 2 8 3.79 8 6s1.791 4 4 4 4-1.79 4-4-1.791-4-4-4z" />
  </svg>
);

function GroupRow({ item, fresh }: { item: HubNotificationItem; fresh: boolean }) {
  const icon = item.kind === "like" ? <HeartFilled size={30} className="text-x-pink" /> : item.kind === "recast" ? <RepostIcon size={30} className="text-x-green" /> : <FollowGlyph />;
  const sentence = notifSentence(item);
  const [first, second] = item.actors;
  // the sentence with the first two names as links to their profiles (the rest of it is plain words)
  const lead = first ? (first.displayName || "@" + first.username) : "";
  const secondName = second ? (second.displayName || "@" + second.username) : "";
  let rest = sentence;
  if (lead && rest.startsWith(lead)) rest = rest.slice(lead.length);
  let mid: string | null = null;
  if (second && secondName) {
    const sep = item.count === 2 ? " and " : ", ";
    if (rest.startsWith(sep + secondName)) {
      mid = sep;
      rest = rest.slice(sep.length + secondName.length);
    }
  }
  return (
    <div data-testid="hub-notif" data-kind={item.kind} data-id={item.id} data-count={item.count} data-unread={fresh ? "1" : "0"} className={`flex border-b border-x-border px-4 py-3 ${fresh ? "bg-[#f7f9f9]" : ""}`}>
      <div className="mr-3 flex w-10 shrink-0 justify-end pt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-1.5">
          {item.actors.map((a) => (
            <Link key={a.fid} href={hubProfileHref(a.fid)} prefetch={false} data-testid="hub-notif-actor" data-fid={a.fid} title={a.displayName}>
              <MediaImg src={a.pfpUrl} network avatar className="h-8 w-8 rounded-full object-cover" placeholderClassName="h-8 w-8 rounded-full" />
            </Link>
          ))}
        </div>
        <p data-testid="hub-notif-text" className="mt-2 text-[15px] leading-5">
          {first ? (
            <Link href={hubProfileHref(first.fid)} prefetch={false} className="font-bold hover:underline">
              {lead}
            </Link>
          ) : null}
          {mid !== null && second ? (
            <>
              {mid}
              <Link href={hubProfileHref(second.fid)} prefetch={false} className="font-bold hover:underline">
                {secondName}
              </Link>
            </>
          ) : null}
          <span>{rest}</span>
          <span className="text-x-sec"> · {relativeTime(item.at)}</span>
        </p>
        {item.target ? (
          <Link href={hubCastHref(item.target.fid, item.target.hash)} prefetch={false} data-testid="hub-notif-target" data-hash={item.target.hash} className="clamp-2 mt-1 block text-[15px] leading-5 text-x-sec hover:underline" style={{ whiteSpace: "pre-line" }}>
            {item.target.text || "Your post"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function HubNotifications({ tab: rawTab }: { tab: string }) {
  const tab = rawTab === "mentions" || rawTab === "priority" ? rawTab : "all";
  const [view, setView] = useState<HubNotificationsView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [seenLine, setSeenLine] = useState<string | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  /** the seen time when this page opened: the rows newer than it stay marked new while the page is open */
  const opened = useRef<{ seenAt: number | null } | null>(null);
  /** the newest time this page has marked seen (never asked twice for the same) */
  const marked = useRef(0);

  const markSeen = useCallback(async (v: HubNotificationsView) => {
    if (v.seenError || v.newestAt === null || v.state !== "ready") return;
    if (v.seenAt !== null && v.newestAt <= v.seenAt) return;
    if (v.newestAt <= marked.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    marked.current = v.newestAt;
    const r = await hubCall<{ seenAt: number | null }>({ op: "seen", upTo: v.newestAt });
    if (!alive.current) return;
    if (r.ok) {
      setSeenLine(null);
      noteHubUnread({ unread: 0, seenAt: r.data.seenAt, newestAt: v.newestAt });
    } else {
      marked.current = 0;
      setSeenLine(r.error);
    }
  }, []);

  const ask = useCallback(
    async (opts: { refresh?: "auto" | "manual"; retry?: boolean; waitMs?: number } = {}) => {
      const my = ++seq.current;
      window.clearTimeout(timer.current);
      const r = await hubCall<HubNotificationsView>({ op: "notifications", tab, waitMs: opts.waitMs ?? 1500, refresh: opts.refresh, retry: opts.retry === true });
      if (!alive.current || my !== seq.current) return; // an answer to an older question never lands over a newer one
      if (!r.ok) {
        // the failure REPLACES what was shown: never an old list under an error nobody sees
        setView(null);
        setFailure(r.error);
        return;
      }
      setFailure(null);
      setView(r.data);
      if (r.data.state !== "error" && r.data.state !== "not_signed_in" && !r.data.seenError && opened.current === null) opened.current = { seenAt: r.data.seenAt };
      if (r.data.loading) timer.current = window.setTimeout(() => void ask(), 300);
      else void markSeen(r.data);
    },
    [tab, markSeen]
  );

  useEffect(() => {
    alive.current = true;
    void ask({ refresh: "auto", waitMs: 1500 });
    const onFocus = () => void ask({ refresh: "auto", waitMs: 300 });
    const onRootCast = () => void ask({ waitMs: 600 });
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible") void ask({ refresh: "auto", waitMs: 300 });
    }, 60_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener(ROOT_CAST_EVENT, onRootCast);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      window.clearInterval(every);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ROOT_CAST_EVENT, onRootCast);
    };
  }, [ask]);

  const retryButton = (testid: string) => (
    <button type="button" data-testid={testid} onClick={() => void ask({ retry: true, waitMs: 2500 })} className="ml-2 font-bold text-x-blue hover:underline">
      Retry
    </button>
  );
  const errorBox = (reason: string, code: string) => (
    <div data-testid="hub-notifs-error" data-code={code} role="alert" className="border-b border-x-border px-4 py-6">
      <p className="text-[17px] font-bold leading-6">Couldn&rsquo;t read your notifications</p>
      <p className="mt-1 text-[15px] leading-5 text-x-sec">{reason}</p>
      <button type="button" data-testid="hub-notifs-retry" onClick={() => void ask({ retry: true, waitMs: 2500 })} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
        Retry
      </button>
    </div>
  );

  if (failure) return errorBox(failure, "device");
  if (!view) {
    return (
      <div data-testid="hub-notifs-loading" aria-busy="true">
        <TimelineSkeleton count={4} />
      </div>
    );
  }
  if (view.state === "not_signed_in") {
    return (
      <div data-testid="hub-notifs-signed-out" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        {view.reason}
      </div>
    );
  }
  if (view.state === "error") return errorBox(view.reason ?? "", view.code ?? "");

  const fresh = (it: HubNotificationItem) => (opened.current ? opened.current.seenAt === null || it.at > opened.current.seenAt : it.unread);
  return (
    <div data-testid="hub-notifs" data-state={view.state} data-tab={view.tab} data-count={view.items.length} data-unread={view.unread ?? ""}>
      <div data-testid="hub-notifs-status" role="status" data-state={view.loading ? "loading" : "ready"} className="flex flex-wrap items-center gap-x-2 border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
        {/* NEYNAR AS A SWITCH (§42): the sentence opens with its source; the marker says it to a machine (network-only) */}
        <span data-testid="hub-notifs-coverage" data-source="network">{notifCoverageSentence(view.coverage)}</span>
        <button type="button" data-testid="hub-notifs-refresh" onClick={() => void ask({ refresh: "manual", waitMs: 2000 })} className="ml-auto font-bold text-x-blue hover:underline">
          Check now
        </button>
      </div>
      {view.paused ? (
        <p data-testid="hub-notifs-paused" role="status" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-x-sec">
          {view.paused.sentence}
        </p>
      ) : null}
      {view.partial ? (
        <p data-testid="hub-notifs-partial-error" data-failed={view.partial.failed} role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.partial.sentence}
          {retryButton("hub-notifs-partial-retry")}
        </p>
      ) : null}
      {view.seenError ? (
        <p data-testid="hub-notifs-seen-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.seenError}
          {retryButton("hub-notifs-seen-retry")}
        </p>
      ) : null}
      {seenLine ? (
        <p data-testid="hub-notifs-seen-save-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {seenLine}
        </p>
      ) : null}
      {view.profilesFailed ? (
        <p data-testid="hub-notifs-profiles-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] leading-4 text-[#f4212e]">
          {view.profilesFailed.sentence}
          {retryButton("hub-notifs-profiles-retry")}
        </p>
      ) : null}
      {view.empty ? (
        <p data-testid="hub-notifs-empty" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          {NOTIF_EMPTY_SENTENCES[view.tab]}
        </p>
      ) : null}
      <div data-testid="hub-notifs-list" data-count={view.items.length}>
        {view.items.map((it) =>
          it.cast ? (
            <div key={it.id} data-testid="hub-notif" data-kind={it.kind} data-id={it.id} data-count={it.count} data-unread={fresh(it) ? "1" : "0"} className={fresh(it) ? "bg-[#f7f9f9]" : ""}>
              <CastCard cast={it.cast} />
            </div>
          ) : (
            <GroupRow key={it.id} item={it} fresh={fresh(it)} />
          )
        )}
      </div>
      {view.loading && view.items.length === 0 ? <TimelineSkeleton count={3} /> : null}
      <div className="h-24" />
    </div>
  );
}
