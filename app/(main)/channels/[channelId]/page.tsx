import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { channelDetailView } from "@/lib/views/spaces";
import type { ChannelDetailView } from "@/lib/views/types";
import { ChannelBody } from "@/components/spaces/ChannelBody";

export const metadata: Metadata = { title: "Channel / X" };
export const dynamic = "force-dynamic";

export default async function ChannelPage({ params }: { params: { channelId: string } }) {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server has no persona to check membership for, and its store
  // cannot hydrate without a device key — so it must not look the channel up (it used to 404 every channel there).
  // It passes the param on; ChannelBody asks the browser device, which runs the same gate for the visitor.
  let initial: ChannelDetailView | null = null;
  if (!isPublicDeployment()) {
    const personaId = activeSeedPersonaId();
    // the old page, unchanged: an unreadable channel is a 404; THE GATE (membership that errors renders locked)
    // lives in the builder
    initial = await channelDetailView(params.channelId, personaId).catch(() => null);
    if (!initial) notFound();
  }

  return <ChannelBody channelId={params.channelId} initial={initial} />;
}
