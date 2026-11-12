// BROWSER KEYSTORE PASS Gate 2 / Gate 5 — the custody-provider adapter (D-CU-0-9, D-CU-2-THE-PROVIDER-IS-AN-ADAPTER,
// and the Gate 5 rework after research/attack-custody-{1,2}.md finding 1).
//
// A provider (Farcaster, email, Google behind one embedded-wallet SDK) is a KEK SOURCE, never the root: its export
// goes through HKDF into a key that wraps the seed the device already holds.
//
// THE FIXTURE IS A RIG ADAPTER AND NOTHING ELSE. Its export is a public function of the subject, so a blob saved
// under it is recoverable by anyone who can name the subject. It therefore refuses to exist unless the page that
// booted the device declared CUSTODY_FIXTURE_PROVIDER=allow — which the app's page does only when the SERVER runs
// with ZK_DEV_HOOKS, and the harness's smoke page does on a loopback host. The real provider (a Privy-class SDK) is
// NOT in the tree (A-CU-2-REAL-PROVIDER-NOT-EXERCISED); without it, a public deployment has no social path and the
// picker says so. The boot contract refuses CUSTODY_FIXTURE_PROVIDER=allow on a public deployment outright, so the
// flag cannot reach a public page's device environment from the server side either.
import { createHash, sha256Bytes } from "@/lib/platform/crypto";

export type ProviderMethod = "farcaster" | "email" | "google";
export const PROVIDER_METHODS: ProviderMethod[] = ["farcaster", "email", "google"]; // Farcaster first (D-CU-0-9)

export interface ProviderLogin {
  /** the provider's stable identifier for this person under this method */
  subject: string;
  /** the provider's exported secret — a KEK source; 32 bytes or more */
  exported: Uint8Array;
}

export interface CustodyProviderAdapter {
  name: string;
  methods: ProviderMethod[];
  /** `hint` names the account on the fixture (there is no login screen); a real provider ignores it */
  login(method: ProviderMethod, hint?: string): Promise<ProviderLogin>;
}

const te = new TextEncoder();

export const fixtureProvider: CustodyProviderAdapter = {
  name: "fixture",
  methods: PROVIDER_METHODS,
  async login(method, hint) {
    const subject = (hint ?? "").trim();
    // no default account: an empty name would make every visitor "the same person" (attack-custody-1 #1)
    if (!subject) throw new Error("the fixture provider needs an account name — there is no login screen on the rig");
    return { subject, exported: sha256Bytes(te.encode("layers-fixture-provider|" + method + "|" + subject)) };
  },
};

export function fixtureAllowed(): boolean {
  return process.env.CUSTODY_FIXTURE_PROVIDER === "allow";
}

/** the adapter this device uses, or a refusal that says why there is none */
export function providerAdapter(): CustodyProviderAdapter {
  const which = (process.env.CUSTODY_PROVIDER || "fixture").toLowerCase();
  if (which === "fixture") {
    if (!fixtureAllowed()) throw new Error("no custody provider is configured on this deployment — social login is unavailable; use a passkey or the 24 words");
    return fixtureProvider;
  }
  throw new Error(`custody provider "${which}" is not installed in this build — the fixture is the only adapter in the tree (A-CU-2-REAL-PROVIDER-NOT-EXERCISED)`);
}

export function providerAvailable(): boolean {
  try {
    providerAdapter();
    return true;
  } catch {
    return false;
  }
}

/** the method id: the subject HASHED, so distinct subjects never collide and the identifier itself is not on the
 *  validator in the clear (attack-custody-2 #11, #12) */
export function providerMethodId(provider: string, method: ProviderMethod, subject: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  const h = createHash("sha256").update("layers/provider-subject/v1|" + provider + "|" + method + "|" + subject).digest("hex").slice(0, 32);
  return `pv:${safe(provider)}:${safe(method)}:${h}`;
}
