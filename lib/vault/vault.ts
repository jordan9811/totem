import "server-only";
// THE VAULT — client-side encryption for everything that was
// "device-held, server-blind". The untrusted validator stores CIPHERTEXT
// and ordering only; it can never read a private post, a disclosure
// grant, a relationship event, or a context/backpack claim.
//
// SEAM (settled by recon): encrypt-at-flush / decrypt-at-hydrate, inside
// store.ts's persistNs()/hydrate(). Zero read-site changes — the sync
// disclosure chokepoints (visibility.ts, resolveIdentity) keep reading
// plaintext Maps in process memory; only the bytes that cross the wire
// to the validator are encrypted. The dirty-check stays on PLAINTEXT (compare
// before encrypt), because a fresh GCM nonce per flush makes ciphertext
// nondeterministic and would defeat a ciphertext comparison — re-PUTing
// every namespace on every write, the traffic that made the validator
// flaky before.
//
// FAIL CLOSED on read, every direction:
//   - a record that is not ciphertext-shaped (legacy plaintext, or a
//     forged plaintext record injected server-side) is DROPPED, never
//     served as if it were vault content;
//   - a record whose embedded (ns,id) does not match the slot it sits in
//     is DROPPED — this is the moved-record attack the AAD binding
//     exists to defeat, enforced here at the read;
//   - a record that fails to decrypt (tamper, truncation) is DROPPED;
//   - if EVERY record in a non-empty namespace fails, that is a
//     wrong-key condition (not per-record tamper) and THROWS loudly —
//     silently serving an empty vault would read as "you have nothing"
//     when in fact you cannot read what you have.
import { decryptRecord, encryptRecord, type VaultCiphertext } from "@/lib/crypto/vaultCipher";
import { vaultKeyBytes } from "@/lib/identity/keystore";

/**
 * The namespaces whose records are encrypted at rest on the validator.
 * The five debt types the spec names, plus the sensitive adjacents recon
 * flagged as equally-exposed plaintext today:
 *   private posts            → privatePosts
 *   disclosure grants        → grantsV3, resolutionRequests, forks
 *   relationship event log   → edgeEvents
 *   context graph + backpack → graphClaims, graphConsent, imports
 *   (adjacent) imported private X content → xImportedPrivate
 * sessionHandles is ALSO sensitive but has a bespoke read path outside
 * store.ts's hydrate — it is vaulted in its own module.
 */
export const VAULT_NAMESPACES: ReadonlySet<string> = new Set([
  "privatePosts",
  "grantsV3",
  "resolutionRequests",
  "forks",
  "edgeEvents",
  "graphClaims",
  "graphConsent",
  "imports",
  "xImportedPrivate",
  // Gate 4 recovery: the persona roster (ids, nonces, display metadata)
  // lives in the keystore FILE, which total device loss destroys. Mirror
  // it here encrypted so a seed/phrase recovery can rebuild the keystore —
  // the seed derives the vault key, the vault key decrypts the roster.
  "identityRoster",
  // ZK PASS 1: the jittered submission queue (which persona will submit,
  // and when), stored as ONE opaque sealed record because this vault
  // seals record VALUES, not record ADDRESSES (attack-1 finding 1: the
  // proof budget's addresses were `personaId:epoch`, siblings side by
  // side in plaintext). The budget and the root anchors are no longer
  // stored on the validator at all — encryption hides them from the
  // operator but nothing stops the operator DELETING them, and "absent"
  // was the benign first-run state (attack-3 F-3). They live on the
  // device: lib/zk/localPins.ts.
  "zkQueue",
  // ATTESTATION PASS Gate 1: the claim VALUES behind this root's attestations
  // (value, nonce, issuer signature) — one opaque sealed record, padded;
  // the validator holds only nonce-salted hashes (lib/attest/vault.ts).
  "zkAttestations",
  // MULTI-FID PASS Gate 1: the persona ↔ fid RECORDS (custody address, signer
  // reference — a Neynar signer uuid is a secret —, registrant, funder): one
  // sealed, padded record. The validator learns { personaId → fid, fname }
  // through the PLAIN namespace personaFidMap and nothing more.
  "personaFids",
  // MULTI-FID PASS — the anon-post ATTRIBUTION secrets (the anoncast reveal pattern): one 32-byte
  // secret per anonymous cast this device made, kept ONLY so its owner can later choose to reveal it
  // and attribute the post to a real persona. Only the COMMITMENT (its hash) is ever public — sealing
  // the secret itself means a stolen validator dump can neither deanonymize a past anon post nor
  // forge someone else's reveal.
  "anonAttribution",
  // MEGA PASS 2 Gate 1: the influence ALLOWANCE (per-root, per-epoch balance), the per-action stake settings, the
  // owner's own stake history and settled accruals — one opaque padded sealed record. The validator sees only the
  // per-persona spend events (its `stakes` table), never the balance, the root, or the tier it was computed from.
  "influence",
  // MEGA PASS 2 Gate 3: this device's SCROLL ZONES (where a wheel reads the article and where it moves the
  // feed) — per device, one opaque padded sealed record. A layout is a fingerprint of a hand and a habit.
  "scrollZones",
  // MEGA PASS 2 Gate 5: the READWISE queue — the chunks of what this person is reading (a DM-sourced item's
  // text among them) — is content, and content is never plaintext at rest on the validator
  "readwise",
  // MEGA PASS 2 Gate 6: RELATIONSHIP PORTS — which counterpart was told which two personas are one person, from which
  // two X handles, and the pending ones waiting on a handle to link. Alt-link material of the most sensitive kind.
  "relationshipPorts",
  // attack-mega-2 F1: a mode is a persona's reading configuration — bindings, rules, ranking weights, the lens pin —
  // and identical unusual configurations across two personas are a habit fingerprint. Sealed as one opaque record.
  "modes",
  // POST-DEPLOY Gate 2: the per-persona TINT and the cross-persona view scope.
  // A per-persona colour map keyed by persona id would hand the operator this
  // root's sibling set in the record ADDRESSES even with every value encrypted,
  // so it is sealed whole as one opaque padded record like modes.
  "personaChrome",
  // POST-DEPLOY Gate 3: the per-(account, mode) DELIVERY TIERS. Which accounts
  // you never want to miss and which you have quietly turned down is a map of
  // what you care about; the addresses would say as much as the values, so the
  // whole map is one opaque padded record.
  "deliveryTiers",
  // POST-DEPLOY Gate 4: the readwise knobs, the priority folders, the RECYCLE BIN
  // and the DWELL map. Dwell is how long this person looked at each paragraph —
  // the most intimate thing readwise produces — so it is written straight here
  // and never through an adapter, and the whole document is one opaque record.
  "readwiseState",
  // CONNECTOR SETUP: the connector account's custody and recovery keys, its fid
  // and name — one opaque padded sealed record (lib/fc/connector.server.ts); the
  // validator holds ciphertext only.
  "fcConnector",
  // PERSONA LAUNCH P1 (SIWF, applied by the byx track that owns this file): the sealed Farcaster sign-in link, one
  // padded record every device writes (lib/fc/siwf/links.ts)
  "accountLinks",
  // POST AS YOU: the visitor's own posting key for their own Farcaster account (a random Ed25519 key, never seed-derived)
  // and its approval state — one padded record every device writes (lib/fc/rootSigner/store.ts)
  "rootSigner",
  // PERSONA LAUNCH P4 (rings): one padded sealed record — the owner's rings, members, note keys and drop tokens, and this
  // device's ring addresses (lib/rings/model.ts)
  "rings",
  // NOTIFICATIONS FROM FARCASTER: when the root last saw its notifications (the unread badge) — one padded record every
  // device writes (lib/fc/hubRead/seen.ts); when someone looks at their notifications is behaviour, never plaintext
  "fcNotifications",
  // ADS, PHASE 1: the ads and advertisers each identity hid — one padded record every device writes (lib/ads/hides.ts);
  // what someone turned away from is a preference about them, never plaintext
  "adHides",
]);

export function isVaultNamespace(ns: string): boolean {
  return VAULT_NAMESPACES.has(ns);
}

function looksLikeCiphertext(v: unknown): v is VaultCiphertext {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as VaultCiphertext).v === 1 &&
    typeof (v as VaultCiphertext).ct === "string" &&
    typeof (v as VaultCiphertext).nonce === "string"
  );
}

/** Plaintext namespace document → ciphertext document. Each record is
 * sealed to its (ns, id) address so the server cannot rearrange records
 * across slots or namespaces without the read below rejecting them. */
export function encryptNamespace(
  ns: string,
  plaintext: Record<string, unknown>,
  key: Uint8Array = vaultKeyBytes()
): Record<string, VaultCiphertext> {
  const out: Record<string, VaultCiphertext> = {};
  for (const [id, record] of Object.entries(plaintext)) {
    out[id] = encryptRecord(key, ns, id, record);
  }
  return out;
}

/** Ciphertext namespace document → plaintext, fail-closed per the header.
 * An explicit key is used by recovery, where the vault key comes from the
 * RECOVERED seed rather than the (wiped) keystore. */
export function decryptNamespace(
  ns: string,
  stored: Record<string, unknown>,
  key: Uint8Array = vaultKeyBytes()
): Record<string, unknown> {
  const ids = Object.keys(stored);
  if (ids.length === 0) return {};
  const out: Record<string, unknown> = {};
  let attempted = 0;
  let recovered = 0;
  for (const id of ids) {
    const rec = stored[id];
    if (!looksLikeCiphertext(rec)) {
      // Not vault ciphertext: legacy plaintext or a server-side plaintext
      // injection. Never served as vault content. (A migration boot wipes
      // adapter_state first, so this should not occur in practice.)
      continue;
    }
    attempted++;
    // The slot must match the sealed address, or the record was moved.
    if (rec.ns !== ns || rec.id !== id) continue;
    try {
      out[id] = decryptRecord(key, rec);
      recovered++;
    } catch {
      // tamper / truncation on this one record — drop it, keep the rest
    }
  }
  if (attempted > 0 && recovered === 0) {
    // Every ciphertext record failed: not per-record tamper but the wrong
    // key (a different root, a corrupt seed). Loud, never a silent empty.
    throw new Error(
      `vault: all ${attempted} ciphertext records in "${ns}" failed to decrypt — wrong vault key or corrupt store`
    );
  }
  return out;
}

/** For the Gate 2 grep: a canary that must survive a flush→server→hydrate
 * round trip encrypted, and whose PLAINTEXT must never appear in the
 * server's stored bytes. */
export const VAULT_CANARY = "layers-vault-canary-9c3f1a";

/** BROWSER KEYSTORE PASS Gate 1 stage 2 (docs/custody-model.md D-CU-0-5): EVERY namespace the validator holds is one
 * opaque, padded, sealed record. Once state is keyed by anchor, a plaintext namespace that names a persona would join
 * the anchor (which signs the zk registration) to the persona — persona → root through two hops. Sealing the whole
 * map under the address "__whole" hides keys and values alike; only the namespace's NAME and its padded size remain
 * visible (A-CU-NAMESPACE-NAMES-VISIBLE). Entries a caller already sealed itself pass through untouched. */
export const WHOLE_RECORD_ID = "__whole";

export function sealWhole(ns: string, entries: Record<string, unknown>, key: Uint8Array = vaultKeyBytes()): Record<string, unknown> {
  const values = Object.values(entries);
  if (values.length > 0 && values.every((v) => looksLikeCiphertext(v))) return entries;
  const inner = JSON.stringify(entries);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const doc = { m: entries, pad: " ".repeat(Math.max(0, target - inner.length - 48)) };
  return { [WHOLE_RECORD_ID]: encryptRecord(key, ns, WHOLE_RECORD_ID, doc) };
}

/** the inverse for whatever shape the validator holds: a whole-sealed record, per-record ciphertext (a vault
 * namespace sealed before this change, or by a caller that seals itself), or legacy plaintext */
export function unsealAny(ns: string, stored: Record<string, unknown>, key: Uint8Array = vaultKeyBytes()): Record<string, unknown> {
  const whole = stored[WHOLE_RECORD_ID];
  if (looksLikeCiphertext(whole) && whole.ns === ns && whole.id === WHOLE_RECORD_ID) {
    const doc = decryptRecord<{ m?: Record<string, unknown> }>(key, whole);
    return doc && typeof doc === "object" && doc.m && typeof doc.m === "object" ? doc.m : {};
  }
  if (isVaultNamespace(ns)) return decryptNamespace(ns, stored, key);
  return stored;
}
