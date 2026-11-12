import "server-only";
// DATA_SOURCE and ENABLE_WRITE.
//
// Content comes from Neynar or from the seed. Personas, grants and modes are
// OUR layer and are unaffected by this switch — they live in the keystore,
// the local store and the validator, none of which Neynar knows about. That
// separation is asserted by the gate: flipping DATA_SOURCE must not touch
// persona, grant or mode state.

export type DataSource = "seed" | "neynar";

// FC pass Gate 2: live is a RUNTIME switch (Developer pane), not an env
// restart. Same globalThis discipline as devControls — and therefore the
// same reset contract: resetSeed clears the override (ops rule: if a knob
// can be armed at runtime, resetSeed must disarm it).
const g = globalThis as unknown as { __layersDataSourceOverride?: DataSource | null };

export function setDataSourceOverride(source: DataSource | null): void {
  g.__layersDataSourceOverride = source;
}

export function dataSourceOverride(): DataSource | null {
  return g.__layersDataSourceOverride ?? null;
}

/** Seed by default. Live data is opt-in, never the thing you get by accident.
 * Precedence: runtime override (Developer pane) > env > seed. */
export function dataSource(): DataSource {
  const o = g.__layersDataSourceOverride;
  if (o) return o;
  return process.env.DATA_SOURCE === "neynar" ? "neynar" : "seed";
}

export function isLiveContent(): boolean {
  return dataSource() === "neynar";
}

// FC-READ — the THIRD content source, and deliberately not a DataSource value.
//
// "relay" exists only inside the browser device on a public deployment whose server holds an ARMED read relay
// (/api/fc/read, lib/fc/readRelay.server.ts): the page's device env carries FC_READ_RELAY="on" and never the key.
// It is kept out of dataSource()/isLiveContent() on purpose. isLiveContent() arms the GLOBAL write guard below
// (every cast, like and act-as answers 503, the visitor's own local posts included), makes getFeed("following")
// return the viewer's following feed (trending until Neynar removed /feed/trending), and makes buildFeed drop its
// injection cards — none of which is true of a preview that READS the network and still WRITES its own local world. Writes on a network cast are refused per TARGET instead
// (lib/fc/networkTarget.ts, 403 NETWORK_READ_ONLY), so the rig's and the owner service's semantics — which key on
// isLiveContent() — do not move at all.
export type ContentSource = "seed" | "neynar" | "relay";

/** FC-READ: true only inside the browser device (a server render never relays — page loads are not metered, see
 *  middleware.ts) and only when the page that booted it said the relay was armed. The flag is a HINT the page can
 *  set for itself (lib/device/shims/process.ts reads a page-settable global): the relay route enforces the kill
 *  switch, the allowlist and the budget, so a forged "on" buys a visitor nothing but refusals. */
export function relayReads(): boolean {
  return process.env.FC_READ_RELAY === "on" && typeof window !== "undefined";
}

/** FC-READ: the one question every read call site asks. neynar (the rig/owner direct path) outranks relay, so a
 *  runtime override on the rig can never be shadowed by a stray device flag. */
export function contentSource(): ContentSource {
  if (isLiveContent()) return "neynar";
  return relayReads() ? "relay" : "seed";
}

/**
 * Writes are OFF unless explicitly enabled. Note the shape of the check:
 * only the exact string "true" enables it, so an empty value, a typo, or an
 * unset variable all mean off.
 *
 * FC pass: ENABLE_FC_WRITE is the canonical flag per the pass env contract;
 * ENABLE_WRITE (the mega-pass name) still honored so nothing that armed the
 * old flag silently loses its meaning.
 */
export function writeEnabled(): boolean {
  return process.env.ENABLE_FC_WRITE === "true" || process.env.ENABLE_WRITE === "true";
}

export class WriteDisabledError extends Error {
  readonly code = "WRITE_DISABLED";
  constructor(operation: string) {
    // Message names BOTH flags on purpose: accept-m4-runtime greps the
    // refusal for /ENABLE_WRITE/, which is NOT a substring of
    // ENABLE_FC_WRITE — dropping the old name would break that check while
    // the behavior stayed correct.
    super(
      `${operation} refused: writes are disabled (ENABLE_FC_WRITE=${process.env.ENABLE_FC_WRITE ?? "unset"}, ` +
        `ENABLE_WRITE=${process.env.ENABLE_WRITE ?? "unset"}, ` +
        `DATA_SOURCE=${dataSource()}). This build is read-only against live Farcaster data.`
    );
    this.name = "WriteDisabledError";
  }
}

/**
 * Guard every write path in live mode.
 *
 * THROWS. It does not return false, and it does not quietly no-op. A silent
 * no-op on a write is the worst available behaviour: the UI shows a success
 * toast, the user believes they posted, and nothing happened. Failing loudly
 * costs one visible error; failing quietly costs the user's trust in every
 * post they have ever made here.
 */
export function assertWriteAllowed(operation: string): void {
  if (isLiveContent() && !writeEnabled()) throw new WriteDisabledError(operation);
}
