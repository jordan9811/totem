import { NextRequest, NextResponse } from "next/server";
import { MANIFEST_PATH, buildManifest } from "@/lib/miniapp/manifest";
import { publicOrigin } from "@/lib/platform/owner-access";

// PUBLIC GO-LIVE — THE FARCASTER MINI APP MANIFEST at /.well-known/farcaster.json (Next 14 serves a dot-folder route:
// its app-path collector skips only "_" folders — next/dist/build/index.js collect-app-paths, ignorePartFilter). Built by
// lib/miniapp/manifest.ts buildManifest from APP_URL and the three MINIAPP_ACCOUNT_ASSOCIATION_* app variables, which
// are PUBLIC values (a signature over {"domain": …} by the account that owns the Mini App; they grant nothing). The
// SERVER answers it (it is not under /api, so the browser device never sees it) and holds no key for it.
//
// Unsigned (the variables unset) or signed for another domain, the manifest is served WITHOUT accountAssociation and the
// reason is logged once per process, by name: Farcaster refuses an unsigned Mini App, and the page must never look armed
// when it is not. The owner signs it for the final domain in the Farcaster app (Developer Tools' manifest tool), then
// runs scripts/owner/arm-miniapp.ps1, which sets the three variables, redeploys and reads this route back.
//
// Headers: JSON with nosniff; cacheable for five minutes (Farcaster reads it when an app is added or opened, and a
// re-signed manifest is picked up within that); any origin may read it (public, no credentials).

export const dynamic = "force-dynamic";

let logged = "";

export async function GET(req: NextRequest) {
  const built = buildManifest(process.env, publicOrigin(req.headers));
  const line = built.flags.join(" | ");
  if (line && line !== logged) {
    logged = line;
    console.warn("[miniapp] " + MANIFEST_PATH + ": " + line);
  }
  return NextResponse.json(built.manifest, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
