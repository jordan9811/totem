"use client";
// FOLLOWING FROM THE HUB — "Find your people": who the visitor's own Farcaster account follows, most recently followed
// first, read by this tab from a Farcaster node (POST /api/fc/hub {op:"people"}), 50 at a time. Each row opens the
// account (/fc/profile#<fid>). A read that failed is an error with Retry, never an empty list; a profile that could not
// be read shows the account's number and is counted.
// WHO IS ON TOTEM is not marked: the only public signal that would not need Totem to learn which persona or identity is
// whose (a Totem-requested key on the account, in Farcaster's KeyRegistry) is one more node read per account and marks
// only people who let Totem post as them, so it is left for later (SECURITY-POSTURE.md §36).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { HubPeopleView, HubPersonRow } from "@/lib/fc/hubRead/copy";
import { HUB_WHO_SEES, followsCountSentence, hubProfileHref } from "@/lib/fc/hubRead/copy";
import { MediaImg } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";
import { useApp } from "@/components/Providers";
import { welcomeHref } from "@/lib/onboarding/state";
import { hubCall } from "./hubCall";

const PAGE = 50;

export function HubPeople() {
  const { publicLive, deviceIsThePage, personas, rosterStatus } = useApp();
  const root = personas.find((p) => p.publicSelf === true) ?? null;
  const ready = deviceIsThePage && rosterStatus === "ready";
  const [rows, setRows] = useState<HubPersonRow[]>([]);
  const [head, setHead] = useState<Omit<HubPeopleView, "rows"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (offset: number, retry = false) => {
    const my = ++seq.current;
    setBusy(true);
    setError(null);
    const r = await hubCall<HubPeopleView>({ op: "people", offset, limit: PAGE, retry });
    if (my !== seq.current) return;
    setBusy(false);
    if (!r.ok) {
      // the error replaces the list: never a list nobody can tell is stale or partial
      setRows([]);
      setHead(null);
      setError(r.error);
      return;
    }
    const { rows: got, ...rest } = r.data;
    setHead(rest);
    setRows((prev) => (offset === 0 ? got : [...prev, ...got.filter((g) => !prev.some((p) => p.fid === g.fid))]));
  }, []);
  useEffect(() => {
    if (ready && root) void load(0);
  }, [ready, root, load]);

  if (!ready) {
    return (
      <div data-testid="hub-people-loading" aria-busy="true">
        <TimelineSkeleton count={4} />
      </div>
    );
  }
  if (!publicLive || !root) {
    return (
      <div data-testid="hub-people-signed-out" className="border-b border-x-border px-4 py-6 text-[15px] leading-5 text-x-sec">
        Sign in with Farcaster to see the people you follow there.{" "}
        <Link href={welcomeHref("farcaster")} className="font-bold text-x-blue hover:underline">
          Sign in with Farcaster
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div data-testid="hub-people-error" role="alert" className="border-b border-x-border px-4 py-6">
        <p className="text-[15px] leading-5 text-x-sec">{error}</p>
        <button type="button" data-testid="hub-people-retry" onClick={() => void load(0, true)} className="mt-3 inline-flex h-9 items-center rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover">
          Retry
        </button>
      </div>
    );
  }
  if (!head) {
    return (
      <div data-testid="hub-people-loading" aria-busy="true">
        <TimelineSkeleton count={4} />
      </div>
    );
  }
  return (
    <div data-testid="hub-people" data-count={head.count}>
      <div className="border-b border-x-border px-4 py-3">
        <p data-testid="hub-people-count" data-count={head.count} className="text-[17px] font-bold leading-6">
          {followsCountSentence(head.count, head.truncated)}
        </p>
        <p className="text-[13px] leading-4 text-x-sec">
          @{root.handle}&rsquo;s follows, most recent first, read from Farcaster&rsquo;s network by this browser. Their posts are in{" "}
          <Link href="/home?tab=following" className="font-bold text-x-blue hover:underline">
            Following
          </Link>
          .
        </p>
      </div>
      {head.stale ? (
        <p data-testid="hub-people-stale-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] text-[#f4212e]">
          Couldn&rsquo;t re-read who you follow just now; showing the list read earlier.
        </p>
      ) : null}
      {head.profilesFailed ? (
        <p data-testid="hub-people-profiles-error" role="alert" className="border-b border-x-border px-4 py-2 text-[13px] text-[#f4212e]">
          {head.profilesFailed.sentence}
          <button type="button" onClick={() => void load(0, true)} className="ml-2 font-bold text-x-blue hover:underline">
            Retry
          </button>
        </p>
      ) : null}
      <ul data-testid="hub-people-list">
        {rows.map((r) => (
          <li key={r.fid} data-testid="hub-person" data-fid={r.fid} data-profile={r.profile} className="border-b border-x-border">
            <Link href={hubProfileHref(r.fid)} prefetch={false} className="flex items-start gap-3 px-4 py-3 hover:bg-x-hover">
              <MediaImg src={r.user.pfpUrl} network avatar className="h-10 w-10 shrink-0 rounded-full object-cover" placeholderClassName="h-10 w-10 shrink-0 rounded-full" />
              <span className="min-w-0">
                <span data-testid="hub-person-name" className="block truncate text-[15px] font-bold leading-5">
                  {r.user.displayName}
                </span>
                <span data-testid="hub-person-username" className="block truncate text-[15px] leading-5 text-x-sec">
                  @{r.user.username}
                </span>
                {r.user.bio ? <span className="clamp-2 mt-0.5 block text-[14px] leading-5">{r.user.bio}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {head.more ? (
        <button type="button" data-testid="hub-people-more" disabled={busy} onClick={() => void load(rows.length)} className="block w-full border-b border-x-border px-4 py-4 text-left text-[15px] text-x-blue hover:bg-x-hover disabled:opacity-60">
          {busy ? "Reading…" : "Show more"}
        </button>
      ) : null}
      <p className="px-4 py-3 text-[13px] leading-4 text-x-sec">
        Following people you follow on X?{" "}
        <Link href="/settings/import-x?return=/home#x-people" data-testid="hub-people-x-link" className="font-bold text-x-blue hover:underline">
          See which of them are on Farcaster
        </Link>
        , from your X archive.
      </p>
      <p data-testid="hub-who-sees" className="px-4 pb-4 text-[12px] leading-4 text-x-sec">
        {HUB_WHO_SEES}
      </p>
    </div>
  );
}
