"use client";
// NOTIFICATIONS FROM FARCASTER — the one test every root-only surface (the notifications page, the unread badge) asks
// before it reads anything as the root, the same test the Following tab makes (components/home/HomeFeed.tsx): the live
// site's browser device, the roster read, a Farcaster sign-in (the public self), and NO persona acting. While a persona
// acts the answer is "persona": the surface shows the persona's world and nothing is asked of the node as the root (the
// device refuses those reads too, acting_persona: this is the honest gate before the ask, never the only guard).
import { useApp } from "@/components/Providers";

export type RootReads = "loading" | "root" | "persona" | "none";

export function useRootReads(device: boolean): RootReads {
  const { publicLive, deviceIsThePage, rosterStatus, personas, actingPersonaId } = useApp();
  if (!device || !publicLive || !deviceIsThePage) return "none";
  if (rosterStatus === "loading") return "loading";
  if (rosterStatus !== "ready") return "none";
  const rootSignedIn = personas.some((p) => p.publicSelf === true);
  const acting = !!actingPersonaId && personas.some((p) => p.id === actingPersonaId && p.publicSelf !== true);
  if (acting) return "persona";
  return rootSignedIn ? "root" : "none";
}
