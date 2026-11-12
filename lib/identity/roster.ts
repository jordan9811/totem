import "server-only";
import { validatorUrl } from "@/lib/ports";
// THE IDENTITY ROSTER, vaulted — the bridge that makes recovery
// reconstruct the WHOLE identity, not just the seed.
//
// The keystore FILE holds each persona's nonce; total device loss
// destroys it. The seed alone re-derives KEYS but cannot enumerate which
// personas exist. So the roster (ids, nonces, display metadata) is
// mirrored into the vault, encrypted under the vault key — which derives
// from the seed. Recovery: phrase → seed → vault key → decrypt roster →
// rebuild the keystore. Everything else (persona keys, grant signatures,
// vault contents) then reproduces bit-identically.
import { rosterForRecovery, restoreFromRecovery, vaultKeyBytes } from "@/lib/identity/keystore";
import { vaultKey as deriveVaultKey } from "@/lib/crypto/kdf";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";

const NS = "identityRoster";
const VBASE = validatorUrl();

/** Mirror the current keystore roster into the vault. Called after any
 * persona mint. LOUD flush — a lost roster write is a recovery that will
 * silently miss personas. */
export async function syncRoster(): Promise<void> {
  const roster = rosterForRecovery();
  const doc: Record<string, unknown> = {};
  for (const p of roster) doc[p.id] = p;
  // ZK PASS 2 Gate 4 (attack-z2-1 #3): ONE opaque sealed record — the
  // vault seals values, not addresses, and the addresses here were the
  // persona ids (the freshly forked persona's key appeared beside the
  // fork record's, 11 ms apart). Padded to 1 KiB steps like the zk queue.
  const inner = JSON.stringify(doc);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  await flushVault(NS, encryptNamespace(NS, { _: { m: doc, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } }, vaultKeyBytes()));
}

/** the roster document out of a sealed namespace — the opaque shape, or the legacy per-persona shape */
function unwrapRoster(plain: Record<string, unknown>): Record<string, unknown> {
  const rec = plain["_"] as { m?: Record<string, unknown> } | undefined;
  if (rec && typeof rec === "object" && rec.m && typeof rec.m === "object") return rec.m;
  return plain;
}

/**
 * Recover the identity from a seed. Derives the vault key from the seed
 * ALONE (the keystore is gone), decrypts the roster off the validator,
 * and rebuilds the keystore. Returns the recovered persona ids.
 *
 * A wrong seed cannot half-succeed: decryptNamespace throws if every
 * record fails (the whole-namespace wrong-key signal), so a mistyped
 * phrase reports loudly instead of silently restoring an empty identity.
 */
/** A REFUSED recovery must leave the device where it was: enrollWithSeed moved it to the candidate phrase's
 *  anchor, and leaving it parked there would point every later read and write at an empty tenant. */
async function unenroll(priorSeed: string | null, candidateSeed: string): Promise<void> {
  const { enrollWithSeed, resetEnvelopeBootstrap } = await import("@/lib/adapters/mock/persist");
  if (priorSeed && priorSeed !== candidateSeed) {
    try {
      await enrollWithSeed(priorSeed);
    } catch {
      /* the validator will re-enroll on the next signed write */
    }
  }
  resetEnvelopeBootstrap();
}

export async function recoverIdentity(seedHex: string, opts: { createAnchor?: boolean } = {}): Promise<string[]> {
  const key = deriveVaultKey(new Uint8Array(Buffer.from(seedHex, "hex")));
  // BROWSER KEYSTORE PASS Gate 1 stage 2: the SEED chooses the tenant. Enroll this device under the anchor this
  // phrase derives BEFORE reading, or the read resolves to whatever anchor the (blank, post-loss) keystore had.
  const { enrollWithSeed } = await import("@/lib/adapters/mock/persist");
  const { rootMaterialForLeakTest, isLinkedDevice } = await import("@/lib/identity/keystore");
  // attack-custody-2 #24: on a LINKED device the first root-material entry is a root handle, not a seed — the undo
  // path must not feed it to enrollWithSeed
  const priorSeed = isLinkedDevice() ? null : (rootMaterialForLeakTest()[0] ?? null);
  await enrollWithSeed(seedHex, opts);
  let stored: Record<string, unknown> = {};
  try {
    const res = await fetchState(NS);
    stored = (await res.json())?.entries ?? {};
  } catch (e) {
    await unenroll(priorSeed, seedHex);
    throw new Error(`recovery: could not read the roster from the validator: ${(e as Error).message}`);
  }
  // A wrong phrase enrolls under an anchor that holds nothing: an empty roster is a REFUSAL, never a silent
  // "recovered an empty identity" (the wrong-key throw below only fires when there IS ciphertext to fail on).
  // An EMPTY roster is not a refusal: a root that never minted a persona has none to restore, and recovering it
  // yields an empty list. The wrong-phrase signal is the anchor probe above (a phrase nobody ever wrote under has no
  // anchor registered, and enrollWithSeed refuses); a wrong phrase whose anchor DOES hold ciphertext still throws at
  // the decrypt below.
  let roster: Record<string, unknown>;
  try {
    roster = unwrapRoster(decryptNamespace(NS, stored, key)); // throws on wrong seed
  } catch (e) {
    await unenroll(priorSeed, seedHex);
    throw e;
  }
  const personas = Object.values(roster) as Parameters<typeof restoreFromRecovery>[1];
  restoreFromRecovery(seedHex, personas);
  // Recovery lands on a device that is (in the real flow) fresh and (in
  // the demo) had its device.json wiped — its delegation is not
  // registered. Force re-enrollment on the next signed write, under the
  // now-recovered device-auth anchor.
  const { resetEnvelopeBootstrap } = await import("@/lib/adapters/mock/persist");
  resetEnvelopeBootstrap();
  return personas.map((p) => p.id);
}

/** For the recovery UI/probe: whether the current seed's vault key can
 * decrypt the stored roster (i.e. recovery would succeed). */
export async function rosterHealthy(): Promise<boolean> {
  try {
    const res = await fetchState(NS);
    const stored = (await res.json())?.entries ?? {};
    if (Object.keys(stored).length === 0) return true; // nothing to recover is not unhealthy
    decryptNamespace(NS, stored, vaultKeyBytes());
    return true;
  } catch {
    return false;
  }
}
