// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42): every feed and result says where it came from. One label, one vocabulary
// (lib/fc/source/switch.ts FC_SOURCE_LABELS): "From Farcaster's network" (read by this browser from a Farcaster node),
// "Via Neynar" (through Totem's server-side read relay), "From your device" (this browser's own records). Static: it
// renders the same wherever it is mounted, server or client, and reads nothing.
import { FC_SOURCE_LABELS, type FcSourceLabel } from "@/lib/fc/source/switch";

export function SourceLabel({ source, testid = "feed-source", className = "" }: { source: FcSourceLabel; testid?: string; className?: string }) {
  return (
    <span data-testid={testid} data-source={source} className={`font-bold text-x-sec ${className}`.trim()}>
      {FC_SOURCE_LABELS[source]}
    </span>
  );
}
