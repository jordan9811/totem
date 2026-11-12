import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { HubThread } from "@/components/hub/HubThread";

// FOLLOWING FROM THE HUB — a Farcaster post opened from your Following: /fc/cast#<fid>/<hash>. The fid and hash ride the
// URL fragment, which a browser never sends, so this server sees "/fc/cast" and nothing else; the island reads the
// fragment and asks the device, which reads the node directly (lib/fc/hubRead/read.ts hubThread).
export const metadata: Metadata = { title: "Post / Totem" };
export const dynamic = "force-dynamic";

export default function FarcasterCastPage() {
  return (
    <>
      <PageHeader back title="Post" />
      <HubThread />
    </>
  );
}
