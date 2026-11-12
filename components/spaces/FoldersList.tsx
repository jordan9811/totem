"use client";
// PROD-LIVE (D-CU-0-4): the /folders list. On a public deployment the server has no identity (it cannot know whose
// folders these are, or which ones this persona follows), so it renders only the header and this island asks the
// browser device for GET /api/folders/view. On the rig the server computes the same view (lib/views/spaces.ts) and
// hands it over as `initial`, and the markup below is the page's old markup, unchanged.
import Link from "next/link";
import { useApiJson } from "@/lib/client/useApiJson";
import type { FoldersView } from "@/lib/views/types";
import { FollowFolderButton } from "@/components/FollowFolderButton";
import { IslandError, IslandLoading } from "./IslandStatus";

export function FoldersList({ initial, serverError }: { initial: FoldersView | null; serverError: string | null }) {
  const { data, error, reload } = useApiJson<FoldersView>("/api/folders/view", {
    initial,
    enabled: serverError === null,
  });

  // the rig's failure line, exactly as the server page always rendered it
  if (serverError !== null) {
    return (
      <p data-testid="folders-error" className="px-4 py-6 text-[15px] text-x-sec">
        Couldn&rsquo;t load folders. {serverError}
      </p>
    );
  }
  // never fail open: an unread list is an error with a Retry, not an empty shelf
  if (error) return <IslandError testid="folders-error" lead="Couldn’t load folders." error={error} onRetry={reload} />;
  if (!data) return <IslandLoading testid="folders-loading" />;

  return (
    <div className="p-4">
      {data.folders.map((f) => (
        <div
          key={f.id}
          data-testid="folder-row"
          data-folder={f.id}
          data-public={f.isPublic ? "true" : "false"}
          className="mb-4 overflow-hidden rounded-2xl border border-x-border"
        >
          <div className="flex items-start justify-between px-4 pt-3">
            <div className="min-w-0">
              <Link href={`/folders/${f.id}`} className="text-[17px] font-black leading-6 hover:underline">
                {f.name}
              </Link>
              <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
                {f.postCount} posts · curated by @{f.ownerHandle}
                {!f.isPublic && " · private"}
              </p>
            </div>
            {f.canFollow && <FollowFolderButton folderId={f.id} initialFollowing={f.following} />}
          </div>
          {/* Pinterest-style grid preview */}
          <div className="grid grid-cols-2 gap-px bg-x-border p-3 pt-3">
            {f.preview.map((p, i) =>
              p ? (
                <div key={i} className="bg-white p-3">
                  <p className="text-[13px] font-bold leading-4 text-x-sec">@{p.authorHandle}</p>
                  <p className="clamp-3 mt-1 text-[15px] leading-5">{p.text}</p>
                </div>
              ) : null
            )}
          </div>
        </div>
      ))}
      <div className="h-24" />
    </div>
  );
}
