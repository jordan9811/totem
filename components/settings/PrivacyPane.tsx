"use client";
// /settings/privacy — the personas whose linkage visibility you set, then the disclosure pane over them.
//
// PROD-LIVE (D-CU-0-4): the page read visibleOwnPersonaIds() on the server — a keystore read a public deployment's
// server cannot make — and turned the failure into "Couldn't load your personas", so DisclosurePane never mounted
// there. Now:
//   • on the RIG the server reads exactly as before and hands the list over as `initial` (an empty list is still
//     the rig's "couldn't load" state, rendered exactly as it was);
//   • on a PUBLIC deployment the island reads GET /api/personas from the browser device — the visitor's roster,
//     already scoped by compartment mode at the route — then mounts DisclosurePane over it.
// NEVER FAIL OPEN: a failed read is an error with a Retry that re-reads (the rig's "Reload the page" advice would,
// on a public deployment, discard an unsaved identity and mint a new one).
import type { PersonaSummary } from "@/lib/adapters/types";
import { useApiJson } from "@/lib/client/useApiJson";
import { ErrorNote, LoadingRows } from "./Chrome";
import { DisclosurePane } from "./DisclosurePane";

export function PrivacyPane({ initial }: { initial: PersonaSummary[] | null }) {
  const server = initial !== null;
  const remote = useApiJson<{ personas: PersonaSummary[] }>(server ? null : "/api/personas");

  if (server) {
    return initial.length === 0 ? (
      <p className="px-4 py-6 text-[15px] text-x-sec">
        Couldn&rsquo;t load your personas. Reload the page to try again.
      </p>
    ) : (
      <DisclosurePane personas={initial} />
    );
  }

  // PROD-LIVE (review fix): the error wins over any data — it was checked only when there was no data, so a failed
  // re-read (after a persona switch) left the PREVIOUS roster's disclosure pane mounted, silently
  if (remote.error) {
    return <ErrorNote error={`Couldn't load your personas. ${remote.error}`} onRetry={remote.reload} />;
  }
  if (!remote.data) return <LoadingRows count={3} />;
  const personas = Array.isArray(remote.data.personas) ? remote.data.personas : null;
  if (!personas) return <ErrorNote error="Couldn't load your personas. The device answered without a roster." onRetry={remote.reload} />;
  if (personas.length === 0) {
    return <p className="px-4 py-6 text-[15px] text-x-sec">This identity has no personas yet.</p>;
  }
  return <DisclosurePane personas={personas} />;
}
