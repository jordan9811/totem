"use client";
// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42) — "On Farcaster", the search page's section AFTER the device's own results.
//
// The browser device answers /api/search/network (app/api/search/network/route.ts): posts and people via Neynar only while
// the operator switched search to Neynar and the relay is armed, and never for a query that names one of this visitor's
// own accounts. Otherwise the answer says why nothing was sent ("isn't switched to Neynar", "not connected", "names one of
// your own accounts"), so an absent section is never mistaken for "nothing on Farcaster". Every result here is labelled
// "Via Neynar". The rig's server has no relay at all, so on the rig this renders nothing.
import Link from "next/link";
import type { Cast, User } from "@/lib/types";
import { useApiJson } from "@/lib/client/useApiJson";
import { useApp } from "@/components/Providers";
import { CastCard } from "@/components/CastCard";
import { TimelineSkeleton } from "@/components/Skeletons";
import { SourceLabel } from "@/components/source/SourceLabel";
import { normaliseSearchQuery, searchQueryAllowed } from "@/lib/fc/source/switch";

interface NetworkSearchAnswer {
  q: string;
  source: "neynar" | "network" | "unarmed" | "names_you";
  label: string;
  sentence?: string;
  state?: "live" | "stale";
  casts: Cast[];
  users: User[];
}

export function NetworkSearchIsland({ q }: { q: string }) {
  const { deviceIsThePage } = useApp();
  const norm = normaliseSearchQuery(q);
  const ask = deviceIsThePage && searchQueryAllowed(norm);
  const found = useApiJson<NetworkSearchAnswer>(ask ? `/api/search/network?q=${encodeURIComponent(norm)}` : null);
  if (!ask) return null;
  if (found.error) {
    return (
      <p data-testid="network-search-error" role="alert" className="border-b border-x-border px-4 py-4 text-[15px] leading-5 text-x-sec">
        {found.error}
        <button type="button" data-testid="network-search-retry" onClick={found.reload} className="ml-2 font-bold text-x-blue hover:underline">
          Retry
        </button>
      </p>
    );
  }
  const a = found.data && found.data.q === norm ? found.data : null;
  if (!a) {
    return (
      <div data-testid="network-search-loading" aria-busy="true">
        <TimelineSkeleton count={2} />
      </div>
    );
  }
  if (a.source !== "neynar") {
    return (
      <p data-testid="network-search" data-source={a.source} role="status" className="border-b border-x-border px-4 py-3 text-[13px] leading-4 text-x-sec">
        {a.sentence}
      </p>
    );
  }
  const none = a.casts.length === 0 && a.users.length === 0;
  return (
    <section data-testid="network-search" data-source="neynar" data-state={a.state ?? "live"} className="border-b border-x-border">
      <h2 className="flex items-baseline gap-2 px-4 pt-4 text-[20px] font-extrabold leading-6 text-x-text">
        On Farcaster
        <SourceLabel source="neynar" testid="network-search-label" className="text-[13px]" />
      </h2>
      {a.state === "stale" && <p className="px-4 pt-1 text-[13px] leading-4 text-x-sec">Showing a cached answer.</p>}
      {none && (
        <p data-testid="network-search-empty" className="px-4 py-4 text-[15px] leading-5 text-x-sec">
          Nothing on Farcaster matched <span className="font-bold text-x-text">{q}</span> via Neynar.
        </p>
      )}
      {a.users.map((u) => (
        <Link
          key={u.fid}
          href={"/" + u.username}
          prefetch={false}
          data-testid="network-search-person"
          data-via="neynar"
          data-fid={u.fid}
          className="flex items-center border-b border-x-border px-4 py-3 hover:bg-x-hover"
        >
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-5 text-x-text">{u.displayName}</p>
            <p className="truncate text-[15px] leading-5 text-x-sec">@{u.username} · Via Neynar</p>
          </div>
        </Link>
      ))}
      {a.casts.map((c) => (
        <div key={c.hash} data-testid="network-search-post" data-via="neynar" data-hash={c.hash}>
          <CastCard cast={c} />
        </div>
      ))}
    </section>
  );
}
