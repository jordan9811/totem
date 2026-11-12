import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { retryAdapter } from "@/lib/adapters/retry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const channelId = req.nextUrl.searchParams.get("channelId");
  try {
    if (channelId) {
      const [channel, members] = await Promise.all([
        retryAdapter(() => adapters.space.getChannel(channelId)),
        retryAdapter(() => adapters.space.members(channelId)),
      ]);
      if (!channel) return NextResponse.json({ error: "unknown channel" }, { status: 404 });
      // FAIL CLOSED: membership that can't be established is NOT membership.
      const isMember = await retryAdapter(() => adapters.space.isMember(channelId, personaId));
      return NextResponse.json({ channel, members, isMember });
    }
    const [channels, visible] = await Promise.all([
      retryAdapter(() => adapters.space.listChannels(personaId)),
      retryAdapter(() => adapters.space.visibleChannelIds(personaId)),
    ]);
    return NextResponse.json({ channels, visibleChannelIds: visible });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const channel = await retryAdapter(() =>
      adapters.space.createChannel({
        name: body.name,
        description: body.description ?? "",
        cluster: body.cluster ?? "crypto",
        policy: body.policy ?? "open",
        ownerPersonaId: activeSeedPersonaId(),
      })
    );
    return NextResponse.json({ channel });
  } catch (e) {
    return NextResponse.json({ error: (e as AdapterError).message }, { status: 503 });
  }
}
