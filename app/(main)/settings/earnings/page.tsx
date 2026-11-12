import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { EarningsPane, type EarningsInitial } from "@/components/settings/EarningsPane";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Earnings / X" };
export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4): adapters.settle.* for activeSeedPersonaId() is an identity read, and a public deployment's
// server has no identity — the page printed "Couldn't load earnings … refusing to mint" there. On a public
// deployment the server renders the header only and EarningsPane reads GET /api/earnings from the browser device.
// On the rig the read below is the page's former read (retried, the error caught and shown), handed to the island.
async function rigEarnings(): Promise<EarningsInitial> {
  const { adapters } = await import("@/lib/adapters/registry");
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const { retryAdapter } = await import("@/lib/adapters/retry");
  const personaId = activeSeedPersonaId();
  try {
    const [events, byCategory, total] = await Promise.all([
      retryAdapter(() => adapters.settle.listEvents(personaId)),
      retryAdapter(() => adapters.settle.earningsByCategory(personaId)),
      retryAdapter(() => adapters.settle.total(personaId)),
    ]);
    // only the rendered fields cross into the island
    const rows = events.map((e) => ({ id: e.id, kind: e.kind, note: e.note, amount: e.amount, createdAt: e.createdAt }));
    return { data: { events: rows, byCategory, total }, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

export default async function EarningsPage() {
  const initial = isPublicDeployment() ? null : await rigEarnings();
  return (
    <>
      <PageHeader back title="Earnings" />
      <EarningsPane initial={initial} />
    </>
  );
}
