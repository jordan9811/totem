"use client";
// PROD-LIVE PASS (D-CU-0-4) — the notifications list, as a client island.
//
// Which notifications show is the ACTIVE MODE's call (notificationPolicy: all / mentions_only / muted), and the
// active mode is the acting persona's — identity the server does not hold on a public deployment. So:
//   * RIG: the server computes the list (lib/views/social.server.ts notificationsView) exactly as before and hands
//     it in as `initial`; nothing is fetched and the rows are the rows it always rendered;
//   * PUBLIC: this island fetches /api/notifications?tab=, which the browser device answers with the visitor's mode.
//
// Never fails open, and never silently: a mode that could not be read used to be treated as "all" without a word,
// so a muted mode was quietly ignored. The list still renders (a missed mention is a cost, not a leak), under a
// visible notice that the mode's setting could not be read and nothing was filtered, with a Retry.
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import type { NotificationRowView, NotificationsView } from "@/lib/views/social";
import { TimelineSkeleton } from "@/components/Skeletons";
import { GrokIcon, HeartFilled, KebabIcon, RepostIcon, VerifiedBadge } from "@/components/icons";

function ActorAvatars({ n }: { n: NotificationRowView }) {
  return (
    <div className="flex gap-2">
      {n.actors.map((a) => (
        <img key={a.fid} src={a.pfpUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
      ))}
    </div>
  );
}

function ActorNames({ n }: { n: NotificationRowView }) {
  const [first, second] = n.actors;
  return (
    <p className="mt-2 text-[15px] leading-5">
      <span className="font-bold hover:underline">{first.displayName}</span>
      {first.verified && <VerifiedBadge size={16} className="mx-0.5 inline-block align-text-bottom" />}
      {second && (
        <>
          <span> and </span>
          <span className="font-bold hover:underline">{second.displayName}</span>
          {second.verified && (
            <VerifiedBadge size={16} className="mx-0.5 inline-block align-text-bottom" />
          )}
        </>
      )}
      <span> {n.text}</span>
      <span className="text-x-sec"> · {n.when}</span>
    </p>
  );
}

function NotificationRow({ n, unread }: { n: NotificationRowView; unread: boolean }) {
  if (n.type === "reply") {
    const actor = n.actors[0];
    return (
      <div className={`flex cursor-pointer border-b border-x-border px-4 py-3 hover:bg-[#00000006] ${unread ? "bg-[#f7f7f7]" : ""}`}>
        <img src={actor.pfpUrl} alt="" className="mr-2 h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="flex min-w-0 items-center text-[15px] leading-5">
              <span className="truncate font-bold hover:underline">{actor.displayName}</span>
              {actor.verified && <VerifiedBadge size={18.75} className="ml-0.5 shrink-0" />}
              <span className="ml-1 truncate text-x-sec">@{actor.username}</span>
              <span className="mx-1 text-x-sec">·</span>
              <span className="shrink-0 text-x-sec">{n.when}</span>
            </p>
            <span className="flex items-start text-x-sec">
              <span className="-mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full hover:bg-[#1d9bf01a] hover:text-x-blue">
                <GrokIcon size={18.75} />
              </span>
              <span className="-mr-2 -mt-1 flex h-[34.75px] w-[34.75px] items-center justify-center rounded-full hover:bg-[#1d9bf01a] hover:text-x-blue">
                <KebabIcon size={18.75} />
              </span>
            </span>
          </div>
          <p className="text-[15px] leading-5 text-x-sec">
            Replying to <span className="text-x-blue">{n.replyingTo}</span>
          </p>
          <p className="mt-0.5 text-[15px] leading-5">{n.text}</p>
        </div>
      </div>
    );
  }

  const iconMap = {
    like: <HeartFilled size={30} className="text-x-pink" />,
    recast: <RepostIcon size={30} className="text-x-green" />,
    follow: (
      <svg viewBox="0 0 24 24" width={30} height={30} fill="#1d9bf0">
        <path d="M17.863 13.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44zM12 2C9.791 2 8 3.79 8 6s1.791 4 4 4 4-1.79 4-4-1.791-4-4-4z" />
      </svg>
    ),
    new_post: (
      <svg viewBox="0 0 24 24" width={30} height={30} fill="#1d9bf0">
        <path d="M11.996 2c-4.062 0-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958C19.48 5.017 16.054 2 11.996 2z" />
      </svg>
    ),
    mention: <HeartFilled size={30} className="text-x-pink" />,
  } as const;

  return (
    <div className={`flex cursor-pointer border-b border-x-border px-4 py-3 hover:bg-[#00000006] ${unread ? "bg-[#f7f7f7]" : ""}`}>
      <div className="mr-3 flex w-10 shrink-0 justify-end pt-0.5">{iconMap[n.type]}</div>
      <div className="min-w-0 flex-1">
        <ActorAvatars n={n} />
        {n.type === "new_post" ? (
          <p className="mt-2 text-[15px] leading-5">
            New post notifications for{" "}
            <span className="font-bold">{n.text.replace("New post notifications for ", "")}</span>
            <span className="text-x-sec"> · {n.when}</span>
          </p>
        ) : (
          <ActorNames n={n} />
        )}
        {n.preview && (
          <p className="clamp-2 mt-1 text-[15px] leading-5 text-x-sec" style={{ whiteSpace: "pre-line" }}>
            {n.preview}
          </p>
        )}
        {n.articleCard && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-x-border">
            <div className="relative border-b border-x-border">
              <img src={n.articleCard.image} alt="" className="w-full object-cover" style={{ aspectRatio: "2.43" }} />
              <span className="absolute bottom-3 left-3 flex items-center rounded-[4px] bg-[#000000c4] px-1.5 py-0.5 text-[13px] font-bold text-white">
                <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" className="mr-1">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Article
              </span>
            </div>
            <div className="px-3 py-3">
              <p className="text-[15px] font-bold leading-5">{n.articleCard.title}</p>
              <p className="clamp-3 mt-0.5 text-[15px] leading-5 text-x-sec">{n.articleCard.description}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NotificationsIsland({ tab: rawTab, initial }: { tab: string; initial: NotificationsView | null }) {
  // PROD-LIVE (review fix): normalised exactly as the page and /api/notifications normalise it (`|| "all"`) — an
  // empty tab used to be asked as "" and answered as "all", so the tab check below never matched and it spun forever
  const tab = rawTab || "all";
  const { deviceIsThePage, refresh } = useApp();
  const view = useApiJson<NotificationsView>(`/api/notifications?tab=${encodeURIComponent(tab)}`, { initial });
  // Retry re-runs the read (the island's fetch on a public deployment, the server render on the rig) — never a
  // document load, which would wipe an unsaved visitor identity.
  const retry = deviceIsThePage ? view.reload : refresh;
  // another tab's answer is not this tab's (useApiJson already drops an answer to another URL; this also covers
  // the server's copy on the rig)
  const data = view.data && view.data.tab === tab ? view.data : null;

  // PROD-LIVE (review fix): the error is checked before the data, so a failed re-read is never hidden behind an
  // answer from before it
  if (view.error || !data) {
    return (
      <div>
        {view.error ? (
          <p data-testid="notifications-error" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
            Couldn&rsquo;t load your notifications right now ({view.error}).
            <button type="button" data-testid="notifications-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
              Retry
            </button>
          </p>
        ) : (
          <div data-testid="notifications-loading" aria-busy="true">
            <TimelineSkeleton count={4} />
          </div>
        )}
        <div className="h-24" />
      </div>
    );
  }

  const { policy, policyError, notifications } = data;
  return (
    <div>
      {policyError && (
        <p data-testid="notifications-policy-error" className="border-b border-x-border px-4 py-3 text-[15px] leading-5 text-x-sec">
          Couldn&rsquo;t read your mode&rsquo;s notification setting, so nothing below was filtered — this may include
          notifications your mode would hide.
          <button type="button" data-testid="notifications-policy-retry" onClick={retry} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      )}
      {policy === "muted" && (
        <p data-testid="notifications-muted" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
          This mode mutes notifications. They are still being delivered — you
          are just not being interrupted by them. Switch modes to catch up.
        </p>
      )}
      {policy !== "muted" && notifications.length === 0 && (
        <p className="px-4 py-6 text-[15px] text-x-sec">Nothing here yet.</p>
      )}
      {notifications.map((n, i) => (
        <div key={n.id} data-testid="notification-row">
          <NotificationRow n={n} unread={i === 1} />
        </div>
      ))}
      <div className="h-24" />
    </div>
  );
}
