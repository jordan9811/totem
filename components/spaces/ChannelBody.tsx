"use client";
// PROD-LIVE (D-CU-0-4): /channels/[channelId]. On a public deployment the server cannot read the channel or the
// visitor's membership (it used to 404 every channel there), so it passes the route param here and this island asks
// the browser device for GET /api/channels/view?channelId=; the device's 404 renders this island's own not-found
// state. On the rig the server computes the same view (lib/views/spaces.ts channelDetailView) and hands it over as
// `initial`; the markup below is the page's old markup.
//
// THE GATE is unchanged: posts render ONLY for a member, a membership check that errors renders LOCKED with the
// check-failed line, and a read that fails outright renders an error — never the posts.
import { useApiJson } from "@/lib/client/useApiJson";
import { VIEW_NOT_FOUND, type ChannelDetailView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { CastCard } from "@/components/CastCard";
import { JoinChannelButton } from "@/components/JoinChannelButton";
import { IslandError, IslandLoading, IslandNotFound, RetryButton } from "./IslandStatus";

export function ChannelBody({ channelId, initial }: { channelId: string; initial: ChannelDetailView | null }) {
  const clientFetched = initial === null;
  const { data, error, reload } = useApiJson<ChannelDetailView>(
    `/api/channels/view?channelId=${encodeURIComponent(channelId)}`,
    { initial }
  );

  if (error === VIEW_NOT_FOUND)
    return <IslandNotFound title="Channel" testid="channel-not-found" message="This channel doesn’t exist." />;
  if (error)
    return (
      <>
        <PageHeader back title="Channel" />
        <IslandError testid="channel-error" lead="Couldn’t load this channel." error={error} onRetry={reload} />
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader back title="Channel" />
        <IslandLoading testid="channel-loading" />
      </>
    );

  const { channel, isMember, checkFailed, memberCount, posts } = data;
  return (
    <>
      {/* Member count only for members. The roster is deliberately not
          fetched for non-members, so rendering "0 members" would be a false
          statement rather than a withheld one. */}
      <PageHeader back title={channel.name} subtitle={isMember ? `${memberCount} members` : undefined} />
      <div className="border-b border-x-border px-4 py-3">
        <p className="text-[15px] leading-5 text-x-sec">{channel.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[13px] font-bold leading-4 text-x-sec">
            {channel.policy === "open"
              ? "Anyone can join"
              : channel.policy === "request"
                ? "Request to join"
                : "Invite only"}
          </span>
          {!isMember && <JoinChannelButton channelId={channel.id} policy={channel.policy} />}
        </div>
      </div>

      {checkFailed && (
        <p data-testid="channel-check-failed" className="border-b border-x-border px-4 py-3 text-[15px] text-x-sec">
          {clientFetched ? (
            <>
              Couldn&rsquo;t confirm your membership, so this channel stays locked.
              <RetryButton onRetry={reload} testid="channel-check-retry" />
            </>
          ) : (
            <>Couldn&rsquo;t confirm your membership, so this channel stays locked. Reload to try again.</>
          )}
        </p>
      )}

      {isMember ? (
        <div data-testid="channel-posts">
          {posts.map((cast) => (
            <CastCard key={cast.hash} cast={cast} />
          ))}
          <div className="h-24" />
        </div>
      ) : (
        <div data-testid="channel-locked" className="px-8 py-12 text-center">
          <svg viewBox="0 0 24 24" width={40} height={40} fill="#536471" className="mx-auto">
            <path d="M12 1.75a5.25 5.25 0 0 0-5.25 5.25V9.5H5.5A1.5 1.5 0 0 0 4 11v9.25c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5V11a1.5 1.5 0 0 0-1.5-1.5h-1.25V7A5.25 5.25 0 0 0 12 1.75zm3.25 7.75h-6.5V7a3.25 3.25 0 1 1 6.5 0v2.5z" />
          </svg>
          <h2 className="mt-4 text-[20px] font-black leading-6">This channel is private</h2>
          <p className="mt-1 text-[15px] leading-5 text-x-sec">
            Posts here are only visible to members.
          </p>
        </div>
      )}
    </>
  );
}
