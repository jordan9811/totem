// PUBLIC PREVIEW Gate 1 (run as BROWSER KEYSTORE PASS Gate 6) — the front door at `/`, with the app at `/home`.
// A static server component: no validator call, no vault read, no persona context, no device. It renders for a
// visitor with nothing (the Gate 6 suite serves it from a throwaway app pointed at a dead validator).
import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";
import { isPublicLive } from "@/lib/platform/publicLive";

// rendered per request, so the docs door reflects the deployment's own configuration rather than the build
// machine's; it still reads no validator, no vault, no persona and no device
export const dynamic = "force-dynamic";

// PUBLIC GO-LIVE: in public live mode the front door describes the product, not a preview (lib/platform/publicLive.ts);
// otherwise exactly the old title and description
export function generateMetadata(): Metadata {
  if (isPublicLive()) {
    return {
      title: "Totem — one you, many personas",
      description: "Your Farcaster account, plus as many other faces as you want. You decide who sees which one is you. Your keys stay in your browser.",
    };
  }
  return {
    title: "Totem — one root, many personas",
    description: "A preview of Totem: one root identity held in your own browser, any number of personas derived from it, and a server that holds ciphertext rather than keys.",
  };
}

export default function Index() {
  return <Landing />;
}
