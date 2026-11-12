"use client";
// /settings/porting — the roster the relationship-porting flow offers, and the persona it ports FROM.
//
// PROD-LIVE (D-CU-0-4): the page used to build the roster on the server (SEED_VIEWER.personas + the keystore's
// ownPersonaIds()) and pass activeSeedPersonaId() as the persona to port from. On a public deployment the server
// holds no keystore — that read threw and the page 500'd — and its "active seed persona" is the rig's fixture, not
// the visitor. Now:
//   • on the RIG the server builds the roster exactly as before and hands it over as `initial`;
//   • on a PUBLIC deployment the island reads GET /api/personas/act-as-options from the browser device — the SEEDED
//     acting roster (the same track the port route authorises against), each with its public/private kind, scoped
//     by compartment mode, and `activeId`, the device's acting persona.
// NEVER FAIL OPEN: an unread roster is an error with a Retry, never an empty "graduate them to" list.
import { useApiJson } from "@/lib/client/useApiJson";
import { ErrorNote, LoadingRows } from "./Chrome";
import { RelationshipPortFlow, type PortPersona } from "./RelationshipPortFlow";

export interface PortingInitial {
  personaId: string;
  personas: PortPersona[];
}

interface ActAsOptions {
  options: { id: string; handle: string; kind: "public" | "private" }[];
  activeId: string;
}

export function PortingPane({ initial }: { initial: PortingInitial | null }) {
  const remote = useApiJson<ActAsOptions>(initial ? null : "/api/personas/act-as-options");
  if (initial) return <RelationshipPortFlow personaId={initial.personaId} personas={initial.personas} />;
  // PROD-LIVE (review fix): the error wins over any data — it was checked only when there was no data, so a failed
  // re-read (after a persona switch) left the PREVIOUS persona's roster and port-from persona on screen, silently
  if (remote.error) {
    return <ErrorNote error={`Couldn't load your personas. ${remote.error}`} onRetry={remote.reload} />;
  }
  if (!remote.data) return <LoadingRows count={3} />;
  // an answer without a roster is not "no personas" and not "still loading" — it is a failed read (never fail open)
  if (!Array.isArray(remote.data.options) || typeof remote.data.activeId !== "string") {
    return <ErrorNote error="Couldn't load your personas. The device answered without a roster." onRetry={remote.reload} />;
  }
  const personas: PortPersona[] = remote.data.options.map((o) => ({
    id: o.id,
    handle: o.handle,
    // anything not positively public is treated as private: private personas are never ported
    kind: o.kind === "public" ? "public" : "private",
  }));
  // keyed by the acting persona: the flow's "graduate them to" default is chosen from the roster at mount
  return <RelationshipPortFlow key={remote.data.activeId} personaId={remote.data.activeId} personas={personas} />;
}
