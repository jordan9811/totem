import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/data";
import { personaByHandle } from "@/lib/adapters/mock/store";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { profileView, relationshipHistoryView } from "@/lib/views/social.server";
import { ProfileIsland } from "@/components/profile/ProfileIsland";
import { RevealedHistory } from "@/components/launch/RevealedHistory";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  // Static seed + fixture lookups only — no identity read, so this is safe on a public deployment too (a handle the
  // server cannot know, like a persona the visitor's device minted, just gets the generic title).
  const seeded = personaByHandle.get(params.handle);
  if (seeded) return { title: `${seeded.name} (@${seeded.handle}) / X` };
  const user = await getProfile(params.handle);
  if (!user) return { title: "Profile / X" };
  return { title: `${user.displayName} (@${user.username}) / X` };
}

export default async function ProfilePage({ params }: { params: { handle: string } }) {
  // PROD-LIVE (D-CU-0-4): on a public deployment the server has no identity — no acting persona, no block list, no
  // relationship log, no store — and it has never heard of the personas the visitor's device minted, so it must not
  // notFound() a handle it cannot know (a visitor's own profile used to 404 here). It renders the island alone; the
  // device answers /api/profile and /api/eventlog/history in the browser.
  if (isPublicDeployment()) {
    return <ProfileIsland handle={params.handle} initial={null} initialHistory={null} />;
  }

  // RIG: computed exactly as before (lib/views/social.server.ts holds the unchanged body), handed to the same island.
  // PROD-LIVE (review fix): both props cross into this page's RSC payload (ProfileIsland is a client component), so
  // the relationship history handed over is the TEXT the tab draws — no event ids, no triggering-cast hashes, the
  // same material HEAD's server-rendered tab put in the HTML (lib/views/social.ts, RelationshipHistoryView).
  const view = await profileView(params.handle);
  if (!view) notFound();
  const initialHistory =
    view.kind === "seeded" && !view.isOwn ? await relationshipHistoryView(activeSeedPersonaId(), view.personaId) : null;
  // PERSONA LAUNCH P6 (D5): a LAUNCHED persona of this device shows its whole revealed history at the original dates,
  // "revealed from @anon" (components/launch/RevealedHistory.tsx — every row checked against the chain by its route).
  // Best effort: a vault that cannot be read leaves the profile exactly as it was, never broken.
  const launchedFid = await launchedFidForHandle(params.handle);
  return (
    <>
      <ProfileIsland handle={params.handle} initial={view} initialHistory={initialHistory} />
      {launchedFid ? <RevealedHistory fid={launchedFid} /> : null}
    </>
  );
}

/** the fid of this device's LAUNCHED persona with this handle, or null (no such persona, no launch, unreadable vault) */
async function launchedFidForHandle(handle: string): Promise<number | null> {
  try {
    const { listPersonas } = await import("@/lib/identity/keystore");
    const p = listPersonas().find((x) => x.handle === handle);
    if (!p) return null;
    const { personaFidRecord } = await import("@/lib/fc/personaFid");
    const rec = await personaFidRecord(p.id);
    return rec && rec.origin === "layers-launch" ? rec.fid : null;
  } catch {
    return null;
  }
}
