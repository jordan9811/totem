"use client";
// PROD-LIVE (D-CU-0-4): /folders/[folderId]. On a public deployment the server cannot answer "may this persona see
// this folder?" (it has no persona), so it does not call notFound() — it passes the route param here and this island
// asks the browser device for GET /api/folders/view?folderId=. The device answers 404 for a folder that does not
// exist AND for a private folder this persona does not own (FAIL CLOSED — the two are indistinguishable, on purpose),
// and the island renders its own not-found state. On the rig the server computes the same view and 404s exactly as
// it always did; the markup below is the page's old markup.
import { useApiJson } from "@/lib/client/useApiJson";
import { VIEW_NOT_FOUND, type FolderDetailView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { CastCard } from "@/components/CastCard";
import { AlgoCardView } from "@/components/AlgoCardView";
import { IslandError, IslandLoading, IslandNotFound } from "./IslandStatus";

export function FolderBody({ folderId, initial }: { folderId: string; initial: FolderDetailView | null }) {
  const { data, error, reload } = useApiJson<FolderDetailView>(
    `/api/folders/view?folderId=${encodeURIComponent(folderId)}`,
    { initial }
  );

  if (error === VIEW_NOT_FOUND)
    return (
      <IslandNotFound
        title="Folder"
        testid="folder-not-found"
        message="This folder doesn’t exist, or it isn’t shared with you."
      />
    );
  if (error)
    return (
      <>
        <PageHeader back title="Folder" />
        <IslandError testid="folder-error" lead="Couldn’t load this folder." error={error} onRetry={reload} />
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader back title="Folder" />
        <IslandLoading testid="folder-loading" />
      </>
    );

  const { folder } = data;
  return (
    <>
      <PageHeader back title={folder.name} subtitle={`${folder.postCount} posts · @${folder.ownerHandle}`} />
      <div data-testid="folder-detail" data-folder={folder.id}>
        {data.algoCards.map((card) => (
          <AlgoCardView key={card.id} card={card} />
        ))}
        {data.importedBookmarks.map((b) => (
          <div key={b.id} data-testid="imported-bookmark" className="border-b border-x-border px-4 py-3">
            <p className="text-[15px] leading-5">{b.text}</p>
            <p className="mt-1 text-[13px] text-x-sec">bookmarked on X · imported from archive</p>
          </div>
        ))}
        {data.casts.map((cast) => (
          <CastCard key={cast.hash} cast={cast} />
        ))}
        <div className="h-24" />
      </div>
    </>
  );
}
