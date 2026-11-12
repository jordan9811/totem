import type { Metadata } from "next";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { channelsView } from "@/lib/views/spaces";
import type { ChannelsView } from "@/lib/views/types";
import { PageHeader } from "@/components/PageHeader";
import { ChannelsList } from "@/components/spaces/ChannelsList";

export const metadata: Metadata = { title: "Channels / X" };
export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server holds no identity, so it cannot read memberships (it
  // used to print "Couldn't confirm your memberships" to every visitor). It renders the header; ChannelsList asks the
  // browser device for GET /api/channels/view. On the rig: the same view, computed here as it always was.
  let initial: ChannelsView | null = null;
  let error: string | null = null;
  if (!isPublicDeployment()) {
    const personaId = activeSeedPersonaId();
    try {
      initial = await channelsView(personaId);
    } catch (e) {
      // FAIL CLOSED: if membership couldn't be read, every channel renders
      // locked rather than open.
      error = (e as AdapterError).message;
    }
  }

  return (
    <>
      <PageHeader back title="Channels" />
      <ChannelsList initial={initial} serverError={error} />
    </>
  );
}
