// One status, as a chip. The label is always written out, so the colour is never the only cue. Colours are the app's
// own palette (green for live, the X blue for coming soon, grey for off, outline only for not offered here); the page is
// light-only like the app.
import { legendOf, type StatusId, type SurfaceId } from "@/lib/status/features";

const TONE: Record<StatusId, string> = {
  live: "bg-[#00ba7c1a] text-[#006b45] ring-[#00ba7c59]",
  fixture: "bg-[#ffd4001f] text-[#6b5200] ring-[#d9b40066]",
  designed: "bg-[#7856ff14] text-[#4b31c4] ring-[#7856ff47]",
  off: "bg-[#eff3f4] text-[#536471] ring-[#cfd9de]",
  soon: "bg-[#1d9bf014] text-[#0a6aa6] ring-[#1d9bf047]",
  na: "bg-white text-[#536471] ring-[#cfd9de]",
};

export function StatusChip({ status, surface, testid = "status-chip" }: { status: StatusId; surface?: SurfaceId; testid?: string }) {
  return (
    <span
      data-testid={testid}
      data-status={status}
      data-surface={surface}
      className={"inline-flex shrink-0 items-center whitespace-nowrap rounded-full align-[1px] px-2 py-0.5 text-[12px] font-bold leading-4 ring-1 ring-inset " + TONE[status]}
    >
      {legendOf(status).label}
    </span>
  );
}
