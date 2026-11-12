import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/inter";
import "./globals.css";
import { isPublicDeployment } from "@/lib/platform/env-contract";

// PUBLIC GO-LIVE: the tab says what the product is called (it said "X" / "It's what's happening / X", the clone's own
// words). No suite pins these; pages with their own title (the landing, /help, the docs) are unchanged.
export const metadata: Metadata = {
  title: "Totem",
  description: "Totem: one root identity, many personas, posting to Farcaster.",
  // FC-READ: noindex, nofollow on every document (app/robots.ts disallows crawling too) — live Farcaster content
  // under this brand is not for search engines, and a crawler following live links would spend read credits
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // PROD-LIVE (D-CU-0-4; D-CU-3-THE-FETCH-PATCH-HAS-AN-EARLY-HALF): on a PUBLIC deployment the browser device answers
  // /api/*, and boot.js must queue every /api/* fetch from BEFORE hydration until the device installs — otherwise a
  // client island's on-mount read lands on the keyless server. It lived in the (main) layout as a React <script>
  // element, which runs on a full load but NEVER on a soft navigation into the group (React does not execute scripts
  // it inserts during client rendering), and DeviceHostMount then skipped it because the tag existed. The root layout
  // is in every document from its first byte, and next/script "beforeInteractive" makes Next's runtime load and run
  // it before hydrating. boot.js guards against double installation; the landing and /device carry it too, harmlessly
  // (they make no /api/* read before their own device mount). The RIG never gets it: its server answers /api/*.
  const deviceIsThePage = isPublicDeployment();
  return (
    <html lang="en">
      <body>
        {deviceIsThePage ? <Script src="/device/boot.js" strategy="beforeInteractive" /> : null}
        {children}
      </body>
    </html>
  );
}
