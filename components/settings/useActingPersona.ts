"use client";
// PROD-LIVE (D-CU-0-4) — "which persona am I acting as", for a pane that operates on exactly one of your personas
// (the fork wizard, the influence layer).
//
// On the RIG the server knows: it passes activeSeedPersonaId() and this returns it unchanged. On a PUBLIC deployment
// the server must NOT pass it — its activeSeedPersonaId() is the rig's fixture persona, so a pane handed that id
// forks or reads the FIXTURE (the fork route answers 403 not_own; the influence pane shows the fixture's stakes as
// "yours"). There the answer is the browser device's, published by the chrome as useApp().actingPersonaId once
// /api/persona/chrome has answered; until then the pane waits rather than guessing, and if the chrome could not
// read the roster it is an error with a Retry, never a default.
//
// LAYERS_WORLD=empty (review F6): the owner service renders on the server ("server" roster) and, with no persona yet,
// names NO acting persona — nothing is coming, so waiting would be "Loading…" forever. That is the state "none": the
// pane says there is no persona yet and points at Settings › Account & Personas.
import { useApp } from "@/components/Providers";

export interface ActingPersona {
  personaId: string | null;
  state: "ready" | "loading" | "error" | "none";
  error: string | null;
  retry: () => void;
}

export function useActingPersona(serverPersonaId: string | null): ActingPersona {
  const { actingPersonaId, rosterStatus, rosterError, refresh, emptyWorld } = useApp();
  if (serverPersonaId) return { personaId: serverPersonaId, state: "ready", error: null, retry: refresh };
  if (actingPersonaId) return { personaId: actingPersonaId, state: "ready", error: null, retry: refresh };
  if (rosterStatus === "error") {
    return { personaId: null, state: "error", error: rosterError ?? "could not tell which persona you are acting as", retry: refresh };
  }
  // the device answered, and named no acting persona: say so rather than wait forever
  if (rosterStatus === "ready") {
    return { personaId: null, state: "error", error: "this identity has no persona to act as yet", retry: refresh };
  }
  // the server rendered the answer, and it is "no persona yet" (the empty world): nothing more is coming
  if (rosterStatus === "server" && emptyWorld) {
    return { personaId: null, state: "none", error: null, retry: refresh };
  }
  return { personaId: null, state: "loading", error: null, retry: refresh };
}
