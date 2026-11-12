import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { HubPeople } from "@/components/hub/HubPeople";

// FOLLOWING FROM THE HUB — "Find your people": who your own Farcaster account follows, read by your browser from a
// Farcaster node. The server renders the shell only (this path carries no identifier); the island asks the device.
export const metadata: Metadata = { title: "Who you follow / Totem" };
export const dynamic = "force-dynamic";

export default function FarcasterFollowingPage() {
  return (
    <>
      <PageHeader back title="Who you follow on Farcaster" />
      <HubPeople />
    </>
  );
}
