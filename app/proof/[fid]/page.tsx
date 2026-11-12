// PERSONA LAUNCH P6 — /proof/<fid>: the PUBLIC proof of a launched account's batch reveal (the launch cast links here).
//
// WHY IT IS OUTSIDE app/(main) (the same reason as /help): on a public deployment every page in the app group mounts
// the visitor's browser device, and the device MINTS a root at boot when nothing is saved. A stranger following a
// launch cast's link must be able to check the proof without getting an identity, a mint against their address's cap,
// or a save nag. Out here the page is a server-rendered shell: no device, no mint, no keystore, no vault — it reads only
// public facts (the registrar's reveal batches, the simulated chain, the public anon list: lib/launch/history.ts
// proofFor) and computes the checks itself. On the owner service the middleware gates it like every page, and the owner
// cookie is checked here too (as /help does), failing closed without a gate-state source.
// On a public deployment the registrar does not run (launch isn't on there yet): it says so and reads nothing.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProofPage } from "@/components/launch/ProofPage";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Launch proof", robots: { index: false, follow: false } };

export default async function Proof({ params }: { params: { fid: string } }) {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  const fid = Number(params.fid);
  if (isPublicDeployment()) return <ProofPage fid={fid} proof={null} error="Launch proofs aren't on this preview yet." />;
  if (!Number.isInteger(fid) || fid <= 0) return <ProofPage fid={0} proof={null} error="That isn't an account number." />;
  try {
    const { proofFor } = await import("@/lib/launch/history");
    return <ProofPage fid={fid} proof={await proofFor(fid)} error={null} />;
  } catch (e) {
    return <ProofPage fid={fid} proof={null} error={"Couldn't read the proof right now (" + (e as Error).message + ")."} />;
  }
}
