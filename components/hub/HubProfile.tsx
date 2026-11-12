"use client";
// FOLLOWING FROM THE HUB — a Farcaster account opened from a hub card or from Find your people: /fc/profile#<fid> (the
// fid in the URL FRAGMENT, never sent to Totem's server). Its profile and newest casts, read by this tab from the node.
// The node keeps no follower counts, so none are shown (never a made-up number).
import { useCallback, useEffect, useRef, useState } from "react";
import type { HubProfileView } from "@/lib/fc/hubRead/copy";
import { parseHubProfileFragment } from "@/lib/fc/hubRead/copy";
import { CastCard, MediaImg, NetworkMarker } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";
import { hubCall } from "./hubCall";
import { useFragment } from "./HubThread";

export function HubProfile() {
  const target = useFragment(parseHubProfileFragment);
  const [view, setView] = useState<HubProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fid = target.value;
  const load = useCallback(async () => {
    if (!fid) return;
    const my = ++seq.current;
    setError(null);
    const r = await hubCall<HubProfileView>({ op: "profile", fid });
    if (my !== seq.current) return;
    if (r.ok) setView(r.data);
    else {
      setView(null);
      setError(r.error);
    }
  }, [fid]);
  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  if (target.read && !fid) {
    return (
      <p data-testid="hub-profile-bad-link" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        This link doesn&rsquo;t name a Farcaster account.
      </p>
    );
  }
  if (error) {
    return (
      <div data-testid="hub-profile-error" role="alert" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        {error}
        <button type="button" data-testid="hub-profile-retry" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
          Retry
        </button>
      </div>
    );
  }
  if (!view) {
    return (
      <div data-testid="hub-profile-loading" aria-busy="true">
        <TimelineSkeleton count={3} />
      </div>
    );
  }
  const u = view.user;
  return (
    <div data-testid="hub-profile" data-fid={u.fid} data-live="true">
      <div className="border-b border-x-border px-4 py-4">
        <MediaImg src={u.pfpUrl} network avatar className="h-20 w-20 rounded-full object-cover" placeholderClassName="h-20 w-20 rounded-full" />
        <p data-testid="hub-profile-name" className="mt-2 text-[20px] font-extrabold leading-6">
          {u.displayName}
        </p>
        <p data-testid="hub-profile-username" className="text-[15px] leading-5 text-x-sec">
          @{u.username}
        </p>
        <NetworkMarker className="mt-1" />
        {u.bio ? <p className="mt-2 text-[15px] leading-5">{u.bio}</p> : null}
      </div>
      {view.castsError ? (
        <p data-testid="hub-profile-casts-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] text-[#f4212e]">
          {view.castsError}
          <button type="button" onClick={() => void load()} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      ) : !view.casts.length ? (
        <p data-testid="hub-profile-no-casts" className="border-b border-x-border px-4 py-6 text-[15px] text-x-sec">
          No posts yet.
        </p>
      ) : null}
      <div data-testid="hub-profile-casts" data-count={view.casts.length}>
        {view.casts.map((c) => (
          <CastCard key={c.hash} cast={c} />
        ))}
      </div>
      {view.more ? <p className="border-b border-x-border px-4 py-3 text-[13px] text-x-sec">Showing the newest {view.casts.length} posts.</p> : null}
    </div>
  );
}
