import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { threadView } from "@/lib/views/social.server";
import { PageHeader } from "@/components/PageHeader";
import { ThreadIsland } from "@/components/thread/ThreadIsland";

export const metadata: Metadata = { title: "Post / X" };
export const dynamic = "force-dynamic";

export default async function PermalinkPage({
  params,
}: {
  params: { handle: string; hash: string };
}) {
  // PROD-LIVE (D-CU-0-4): every read on this page is the viewer's — the persona layer (attribution, a granted
  // viewer's merged identity), the curator refutations from the feeds THIS persona subscribes to, and the local
  // casts, which on a public deployment exist only in the visitor's browser (a visitor's own fresh cast is unknown
  // to the server, so it must not notFound() it). On a public deployment the server renders the header and the
  // island; the device answers /api/thread in the browser. On the rig the thread is computed exactly as before.
  const pub = isPublicDeployment();
  const initial = pub ? null : await threadView(params.hash);
  if (!pub && !initial) notFound();

  return (
    <>
      <PageHeader back title="Post" />
      <ThreadIsland hash={params.hash} initial={initial} />
    </>
  );
}
