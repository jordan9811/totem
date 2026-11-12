"use client";
// PROD-LIVE (D-CU-0-4): the loading / error / not-found states of the space islands (folders, channels, rooms, the
// algo preview, the market lists). These only ever render on a PUBLIC deployment — on the rig the server hands every
// island its data, so none of these states appear there and the DOM the suites read is unchanged.
//
// NEVER FAIL OPEN: a failed read is a visible error with a Retry that refetches IN PLACE (useApiJson's reload). It is
// never a full page load: an unsaved visitor identity lives only in this tab's memory, and a document load mints a
// brand-new one.
import { PageHeader } from "@/components/PageHeader";
import { CastSkeleton } from "@/components/Skeletons";

export function IslandLoading({ testid, rows = 3 }: { testid: string; rows?: number }) {
  return (
    <div data-testid={testid} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <CastSkeleton key={i} />
      ))}
    </div>
  );
}

export function RetryButton({ onRetry, testid }: { onRetry: () => void; testid: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onRetry}
      className="ml-2 h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold text-x-text hover:bg-x-hover"
    >
      Retry
    </button>
  );
}

/** a read the device could not answer: the message, and a Retry that refetches in place */
export function IslandError({
  testid,
  lead,
  error,
  onRetry,
}: {
  testid: string;
  lead: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div data-testid={testid} className="flex flex-wrap items-center border-b border-x-border px-4 py-6">
      <p className="text-[15px] text-x-sec">
        {lead} {error}
      </p>
      <RetryButton onRetry={onRetry} testid={`${testid}-retry`} />
    </div>
  );
}

/**
 * the island's OWN not-found: the device answered 404 (nothing here, or nothing this persona may see). It says what
 * the rig's server-side notFound() page says, so the two shapes read the same — and so a detail page reached from a
 * list link that nonetheless resolves to nothing is caught by the same "could not be found" check either way.
 */
export function IslandNotFound({ title, testid, message }: { title: string; testid: string; message: string }) {
  return (
    <>
      <PageHeader back title={title} />
      <div data-testid={testid} className="px-8 py-12 text-center">
        <h2 className="text-[20px] font-black leading-6">This page could not be found</h2>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">{message}</p>
      </div>
    </>
  );
}
