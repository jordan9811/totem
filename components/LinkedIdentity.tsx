"use client";
// Merged identity rendering. Everything here is downstream of PersonaResolver
// — this component only draws what it was handed, and is never the thing that
// decides whether a viewer may see a linkage.
import { useState } from "react";
import type { ResolvedIdentity } from "@/lib/identity/resolver";
import { Face, SplitAvatar as RingSplitAvatar } from "@/components/rings/SplitAvatar";

const TIER_COPY: Record<string, string> = {
  public: "Publicly linked",
  opt_in: "Linked — you asked to see this",
  whitelist: "Linked — shared with you",
};

/**
 * Split avatar: a real composite, half one pfp and half the other. Signals
 * "two identities, one person" without needing a caption.
 */
export function SplitAvatar({
  left,
  right,
  size = 40,
}: {
  left: string;
  right: string;
  size?: number;
}) {
  return (
    <span
      data-testid="split-avatar"
      className="relative inline-block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <img
        src={left}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: "polygon(0 0, 50% 0, 50% 100%, 0 100%)" }}
      />
      <img
        src={right}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" }}
      />
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70"
        aria-hidden="true"
      />
    </span>
  );
}

/** Hover card revealing the linkage and the tier that authorised it. */
export function LinkageHoverCard({ identity }: { identity: ResolvedIdentity }) {
  if (!identity.linked) return null;
  return (
    <div
      data-testid="linkage-card"
      data-tier={identity.linked.tier}
      className="absolute left-0 top-full z-40 mt-1 w-[300px] cursor-default rounded-2xl bg-white p-4 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]"
    >
      <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
        {TIER_COPY[identity.linked.tier] ?? "Linked"}
      </p>
      <div className="mt-3 flex items-center">
        <SplitAvatar left={identity.avatarUrl} right={identity.linked.avatarUrl} size={44} />
        <div className="ml-3 min-w-0">
          <p className="truncate text-[15px] font-bold leading-5">{identity.displayName}</p>
          <p className="truncate text-[13px] leading-4 text-x-sec">
            @{identity.handle} · @{identity.linked.handle}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-4 text-x-sec">
        {identity.linked.tier === "public"
          ? "This person links these accounts publicly."
          : "You can see this because they granted it to you. Others cannot."}
      </p>
    </div>
  );
}

/** Name row with optional merged treatment. */
export function IdentityName({
  identity,
  className = "",
}: {
  identity: ResolvedIdentity;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <span
      className={`relative ${className}`}
      data-testid="identity-name"
      data-merged={identity.merged ? "true" : "false"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="font-bold">{identity.displayName}</span>
      {identity.merged && (
        <span
          data-testid="merged-badge"
          className="ml-1 inline-flex items-center rounded-[3px] border border-[#cfd9de] px-1 align-[1px] text-[10px] font-medium leading-[14px] text-x-sec"
          title="Linked identities — visible to you"
        >
          linked
        </span>
      )}
      {hover && identity.linked && <LinkageHoverCard identity={identity} />}
    </span>
  );
}

/** "Linked identities" section for a profile — public tier only. */
export function LinkedIdentitiesSection({ identity }: { identity: ResolvedIdentity }) {
  if (!identity.linked) return null;
  return (
    <section
      data-testid="linked-identities"
      data-tier={identity.linked.tier}
      className="border-b border-x-border px-4 py-3"
    >
      <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
        Linked identities
      </p>
      <div className="mt-2 flex items-center">
        <SplitAvatar left={identity.avatarUrl} right={identity.linked.avatarUrl} size={40} />
        <div className="ml-3 min-w-0">
          <p className="truncate text-[15px] font-bold leading-5">{identity.linked.name}</p>
          <p className="truncate text-[15px] leading-5 text-x-sec">@{identity.linked.handle}</p>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-4 text-x-sec">
        {identity.linked.tier === "public"
          ? "Publicly linked by this account."
          : "Shared with you. This is not public."}
      </p>
    </section>
  );
}

/** PERSONA LAUNCH P4: what a ring told THIS device about the account behind a profile (GET /api/rings?fid=), names only */
export interface RingSharedView {
  label: string;
  root: { fname: string | null; displayName: string; thumb: string | null };
  persona: { handle: string; displayName: string; depth: string };
  others: { handle: string; displayName: string }[];
  expiresAt: number;
}

/**
 * "Shared with you by <label>" on a profile — drawn ONLY from what this device's rings received (memory, no fetch): the
 * root on the left, this account on the right, both inline (no request for either picture). The other accounts are
 * names, never links that would load them; opening one is the visitor's own choice, and the line says what it shows.
 */
export function RingSharedSection({ shared }: { shared: RingSharedView }) {
  const rootName = shared.root.fname ? "@" + shared.root.fname : shared.root.displayName;
  return (
    <section data-testid="profile-ring-shared" data-label={shared.label} data-persona={shared.persona.handle} className="border-b border-x-border px-4 py-3">
      <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">Shared with you by {shared.label}</p>
      <div className="mt-2 flex items-center">
        <RingSplitAvatar
          testid="profile-ring-split-avatar"
          left={<Face thumb={shared.root.thumb} name={shared.root.displayName} />}
          right={<Face thumb={null} name={shared.persona.displayName} />}
          leftName={rootName}
          rightName={"@" + shared.persona.handle}
        />
        <div className="ml-3 min-w-0">
          <p className="truncate text-[15px] leading-5">
            <span className="font-bold">@{shared.persona.handle}</span> is {shared.root.displayName}
            {shared.root.fname ? <span className="text-x-sec"> (@{shared.root.fname})</span> : null}
          </p>
          {shared.others.length > 0 && <p className="truncate text-[13px] leading-4 text-x-sec">Also shared with you: {shared.others.map((o) => "@" + o.handle).join(", ")}</p>}
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-4 text-x-sec">
        Only you see this — it isn&rsquo;t public and no other app shows it. Opening their other accounts from here lets this site&rsquo;s server see you looked at both.
      </p>
    </section>
  );
}
