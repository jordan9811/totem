"use client";
// PROD-LIVE (D-CU-0-4): the /channels list. Which channels are unlocked is a fact about the visitor's memberships,
// and on a public deployment only the browser device knows them — so the server renders the header and this island
// asks the device for GET /api/channels/view. On the rig the server computes the same view (lib/views/spaces.ts) and
// hands it over as `initial`; the markup below is the page's old markup, unchanged.
//
// FAIL CLOSED: memberships that could not be read show no channel as open — the rig's error line, or on a public
// deployment an error with a Retry (in place: a full reload would mint the visitor a new identity).
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import type { ChannelsView } from "@/lib/views/types";
import { IslandLoading, RetryButton } from "./IslandStatus";

const POLICY_LABEL = {
  open: "Anyone can join",
  request: "Request to join",
  invite: "Invite only",
} as const;

export function ChannelsList({ initial, serverError }: { initial: ChannelsView | null; serverError: string | null }) {
  const { data, error, reload } = useApiJson<ChannelsView>("/api/channels/view", {
    initial,
    enabled: serverError === null,
  });
  const failed = serverError !== null || !!error;
  if (!failed && !data) return <IslandLoading testid="channels-loading" />;
  const channels = failed ? [] : data?.channels ?? [];

  return (
    <>
      {failed && (
        <p data-testid="channels-error" className="border-b border-x-border px-4 py-3 text-[15px] text-x-sec">
          {serverError !== null ? (
            <>Couldn&rsquo;t confirm your memberships, so channels are shown locked. Reload to try again.</>
          ) : (
            <>
              Couldn&rsquo;t load channels or confirm your memberships, so none is shown open. {error}
              <RetryButton onRetry={reload} testid="channels-retry" />
            </>
          )}
        </p>
      )}
      <div>
        {channels.map((c) => (
          <Link
            key={c.id}
            href={`/channels/${c.id}`}
            data-testid="channel-row"
            data-channel={c.id}
            data-unlocked={c.unlocked ? "true" : "false"}
            className="flex items-start border-b border-x-border px-4 py-3 hover:bg-[#00000006]"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center text-[15px] font-bold leading-5">
                {c.name}
                {!c.unlocked && (
                  <span className="ml-2 flex items-center rounded-full bg-x-pill px-2 py-0.5 text-[11px] font-bold text-x-sec">
                    <svg viewBox="0 0 24 24" width={11} height={11} fill="currentColor" className="mr-1">
                      <path d="M12 1.75a5.25 5.25 0 0 0-5.25 5.25V9.5H5.5A1.5 1.5 0 0 0 4 11v9.25c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5V11a1.5 1.5 0 0 0-1.5-1.5h-1.25V7A5.25 5.25 0 0 0 12 1.75zm3.25 7.75h-6.5V7a3.25 3.25 0 1 1 6.5 0v2.5z" />
                    </svg>
                    Locked
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[15px] leading-5 text-x-sec">{c.description}</p>
              <p className="mt-1 text-[13px] leading-4 text-x-sec">
                {POLICY_LABEL[c.policy]} · run by @{c.ownerHandle}
              </p>
            </div>
          </Link>
        ))}
        <div className="h-24" />
      </div>
    </>
  );
}
