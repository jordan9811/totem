import "server-only";
// EPHEMERAL SESSION STATE — UX-only memory that lives for the server
// process's lifetime and NEVER round-trips through persist.ts or the
// validator. Same discipline as marketClock's offset: a globalThis
// singleton, gone on restart, gone on resetSeed (wired into resetState()).
//
// What belongs here: state whose whole point is "forgotten later" — an
// in-session override that should NOT survive a hard kill (Gate 2's undo
// stack explicitly must not enter restart-survival; Gate 1's mode-override
// marker is the same category, just smaller).
interface EphemeralState {
  /** UX Gate 1: personas with an EXPLICIT in-session mode pick. While a
   * persona is in this set, neither its default-mode binding nor a mode's
   * activation rule may override the user's own swipe/pick — "an explicit
   * in-session swipe beats a binding until the session ends." */
  modeOverrides: Set<string>;
}

const g = globalThis as unknown as { __layersEphemeral?: EphemeralState };

function state(): EphemeralState {
  g.__layersEphemeral ??= { modeOverrides: new Set() };
  return g.__layersEphemeral;
}

export function markModeOverride(personaId: string): void {
  state().modeOverrides.add(personaId);
}

export function hasModeOverride(personaId: string): boolean {
  return state().modeOverrides.has(personaId);
}

/** resetState() calls this — ephemeral state is scoped to a session, and a
 * reset starts a new one. */
export function resetEphemeralSession(): void {
  g.__layersEphemeral = { modeOverrides: new Set() };
}
