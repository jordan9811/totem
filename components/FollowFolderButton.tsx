"use client";
import { useState } from "react";
import { useApp } from "@/components/Providers";

export function FollowFolderButton({
  folderId,
  initialFollowing,
}: {
  folderId: string;
  initialFollowing: boolean;
}) {
  // PROD-LIVE (D-CU-0-4): refresh() is router.refresh() (the rig's server re-render, unchanged) PLUS a refetch of
  // every island — on a public deployment the folders list is the device's answer, and it must be re-asked
  const { refresh } = useApp();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  return (
    <button
      data-testid="follow-folder"
      data-following={following ? "true" : "false"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const next = !following;
        try {
          const res = await fetch("/api/folders/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId, follow: next }),
          });
          if (res.ok) {
            setFollowing(next);
            refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
      className={`h-8 shrink-0 rounded-full px-4 text-[14px] font-bold ${
        following
          ? "border border-[#cfd9de] bg-white text-x-text"
          : "bg-x-black-btn text-white hover:bg-x-black-btn-hover"
      } disabled:opacity-50`}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
