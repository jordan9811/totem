"use client";
import { useState } from "react";
import type { MembershipPolicy } from "@/lib/adapters/types";
import { useApp } from "@/components/Providers";

export function JoinChannelButton({
  channelId,
  policy,
}: {
  channelId: string;
  policy: MembershipPolicy;
}) {
  // PROD-LIVE (D-CU-0-4): refresh() is router.refresh() (the rig's server re-render, unchanged) PLUS a refetch of
  // every island — on a public deployment the channel view is the device's answer, and it must be re-asked
  const { refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const label = policy === "open" ? "Join" : policy === "request" ? "Request to join" : "Invite only";

  if (result) {
    return (
      <span data-testid="join-result" className="text-[13px] font-bold leading-4 text-x-sec">
        {result}
      </span>
    );
  }

  return (
    <button
      data-testid="join-channel"
      disabled={busy || policy === "invite"}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch("/api/channels/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId }),
          });
          const data = await res.json();
          if (!res.ok) {
            setResult(res.status === 403 ? "Invite only" : "Couldn't join — try again");
            return;
          }
          if (data.membership.status === "member") {
            // Joining an open channel must reveal its posts without a manual
            // reload (acceptance criterion 1).
            refresh();
          } else {
            setResult("Request sent");
          }
        } finally {
          setBusy(false);
        }
      }}
      className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
    >
      {busy ? "…" : label}
    </button>
  );
}
