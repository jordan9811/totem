import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { HubProfile } from "@/components/hub/HubProfile";

// FOLLOWING FROM THE HUB — a Farcaster account opened from your Following or Find your people: /fc/profile#<fid> (the
// fid in the fragment, never sent to this server); the island asks the device, which reads the node directly.
export const metadata: Metadata = { title: "Profile / Totem" };
export const dynamic = "force-dynamic";

export default function FarcasterProfilePage() {
  return (
    <>
      <PageHeader back title="Profile" />
      <HubProfile />
    </>
  );
}
