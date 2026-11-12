// ATTESTATION PASS Gate 0 — PORT PINNING. Totem runs on EXPLICIT ports
// from the environment: LAYERS_APP_PORT (default 3001) and
// LAYERS_VALIDATOR_PORT (default 4001). Every entry point — the app, the
// validator, the sweep runner, the live scripts, the supervisor — derives
// its port and its peer's URL from HERE (or from the byte-identical
// shell/CJS duplicates that cannot import TypeScript), never from a
// literal. The closing sweeps of ZK Pass 2 lost a run when another
// project's dev server took :3000 mid-sweep; a pinned, non-default port
// plus the signed liveness contract (lib/health.ts) is what makes a
// foreign server on the port read as DOWN instead of alive.
//
// No "server-only": this module is pure and may be imported anywhere.
// BASE_URL / VALIDATOR_URL / APP_URL still win when set — a sweep against
// a remote host, a tunnel — but their DEFAULTS are the pinned ports.

export const DEFAULT_APP_PORT = 3001;
export const DEFAULT_VALIDATOR_PORT = 4001;

function portOf(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

/** the port the Next app is pinned to */
export function appPort(): number {
  return portOf(process.env.LAYERS_APP_PORT, DEFAULT_APP_PORT);
}

/** the port the validator is pinned to (VALIDATOR_PORT is the pre-pass
 * spelling; LAYERS_VALIDATOR_PORT wins when both are set) */
export function validatorPort(): number {
  return portOf(process.env.LAYERS_VALIDATOR_PORT ?? process.env.VALIDATOR_PORT, DEFAULT_VALIDATOR_PORT);
}

export function appUrl(): string {
  return process.env.APP_URL || `http://localhost:${appPort()}`;
}

export function validatorUrl(): string {
  return process.env.VALIDATOR_URL || `http://localhost:${validatorPort()}`;
}
