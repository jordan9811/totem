# REPORT-CRYPTO — Persona Crypto + Custody + Vault Pass

Run started 2026-08-29. Spec: `notes/prompts/persona-crypto-prompt.md`. Prereqs read:
notes/reports/REPORT-FC.md (complete — all gates live on the real network) and
notes/design/architecture-v3.md, whose closing section ("What the real track must
implement") is the contract this pass fills: claim format → signed
grants, resolution check → verified predicates, fork ops → reissued
grant sets.

Sequencing note at start: the FC pass's final confirmation sweeps (3-4
of 4) are still running against the built servers, so this pass opens
with read-only recon + design; installs, rebuilds, and verification
wait for them to land. Sweeps 1-2 both returned 265/265 clean.

## Trust topology (stated up front, since every grep hangs on it)

The repo already has a two-party split, and the crypto pass makes it
load-bearing:

| Party | Role in this pass |
| --- | --- |
| Next app + `lib/identity/keystore.ts` | the CLIENT/DEVICE. The keystore file mocks a secure enclave (notes/design/architecture-v3.md says this explicitly: "the adapter seam is the real deliverable; the medium is not"). Seed, private keys, vault key, plaintext live here and ONLY here. |
| `validator/server.js` (:4000) | the UNTRUSTED SERVER. Stores ciphertext and ordering; verifies signatures against registered public keys; never sees seed, private keys, or vault plaintext. The vault-plaintext and key-material greps target ITS persisted state and responses. |

## Crypto discipline (restated as the working rules)

- Audited primitives only: Ed25519 via noble curves, HKDF, AES-256-GCM
  (platform) — no hand-rolled constructions.
- Key material never in any adapter response, log, or server record;
  the leak grep extends from root ids to key material + vault plaintext.
- Every former fake signature becomes a real verification that REJECTS
  on failure. Unverifiable = invalid = absent. Fail closed.

## Recon findings (Gate 0 groundwork)

First-hand reads (keystore.ts, grants.ts) — three design-shaping facts:

1. `signGrant`'s canonical form is already frozen
   (`kind|from|to|audience|tier|issuedAt|revokedAt`, grants.ts:84-92)
   with `kind` in it and the id content-addressed from the same string.
   Gate 1 is a true drop-in: Ed25519 over those bytes, same call shape.
2. Persona ids must remain stable (hundreds of checks + seeded data
   reference them), so the hierarchy ADDS `HKDF(seed, nonce)` → Ed25519
   keys per persona while `derivePersonaId` stays byte-identical.
   One nonce, two derivations: name and key.
3. The seeded-world trap: seeded grants are claims between personas
   that have NO keystore entry (they belong to fixture "other people").
   Fail-closed verification would destroy the seeded disclosure demo
   unless seed personas get deterministic FIXTURE ROOTS whose real keys
   sign the seeded grants at hydration. Decision: no unsigned/legacy
   tolerance path — the fixture world signs for real, from fixture
   seeds derived off a known constant. (A tolerance path would be the
   exact hole an attacker forges "legacy" objects through.)

Platform + library verification (probed directly, not from memory):

- Node v24.12.0: native Ed25519 sign/verify, `hkdfSync`, AES-256-GCM —
  all OpenSSL-backed platform primitives, verified by probe.
- Already on disk (transitive via viem), verified working by ESM probe:
  `@noble/curves` 1.9.1 (Ed25519 from raw 32-byte seeds — deterministic,
  probed twice → identical keys), `@noble/hashes` 1.8.0 (HKDF-SHA256),
  `@noble/ciphers` 1.3.0, `@scure/bip39` 1.6.0 (32-byte entropy ↔
  24-word mnemonic roundtrip verified). These are the independently
  audited noble/scure libraries the prompt names. The only "install" is
  promoting them from transitive to declared dependencies at the pinned
  on-disk versions, so npm dedupe can never silently move them.
- Gates 0-2 and the Gate 4 baseline need ZERO new packages. Only the
  Gate 4 stronger option (Shamir) may need one audited addition —
  decided at that gate.

## GATE 0 DESIGN — the key hierarchy

```
seed (32 bytes; keystore v4; expressible as a 24-word BIP39 mnemonic)
 ├─ persona sign keys : HKDF-SHA256(ikm=seed, info="layers/v1/persona-sign/"+nonce) → Ed25519
 ├─ vault key         : HKDF-SHA256(ikm=seed, info="layers/v1/vault/1") → AES-256-GCM key
 └─ device keys       : NOT derived from the seed — random per device,
                        authorized by a persona-signed delegation cert
```

Decisions, with reasons:

1. **The v3 root secret IS the seed.** `rootSecretHex` is already 32
   random bytes. v3→v4 migration keeps the bytes; existing personas keep
   their ids (`derivePersonaId` untouched — hundreds of checks and all
   seeded data reference those strings) and GAIN Ed25519 keys derived
   from the same seed+nonce. One nonce, two derivations: the name and
   the key. Zero identity churn, full continuity, and recovery
   determinism (Gate 4) falls out of HKDF being deterministic.
2. **Device keys are random, not derived** — a device must be able to
   act without the seed ever touching it, so its key cannot come from
   the seed. Authorization is a delegation object signed by the root's
   DEVICE-AUTH key (its own HKDF branch — NOT a persona key: see the
   Gate 0 build notes for why a persona-signed delegation would be a
   linkage leak); the validator verifies the chain (registered anchor
   pubkey → delegation → device signature) and honors revocation
   forward-only.
3. **Vault cipher: AES-256-GCM via node:crypto** (platform, audited,
   hardware-accelerated; the prompt explicitly blesses "AES-GCM with a
   proper KDF"). Per-record random 96-bit nonce; AAD binds
   namespace|recordId|version so a ciphertext cannot be replayed into a
   different slot. Ed25519 via @noble/curves (raw-seed keys make the
   HKDF derivation clean; node:crypto would need PKCS8 wrapping).
4. **Public-key directory on the validator**: personas register
   `{personaId, ed25519Pub}` (public material — fine on the untrusted
   server); verifiers fetch and cache. For the viewer's OWN personas the
   client cross-checks the directory against local derivation, so a
   malicious directory cannot swap keys under personas we hold. For
   others it is trust-on-first-use — stated honestly in the threat
   model rather than hand-waved.
5. **The seeded world signs for real.** Seeded accounts (fixture
   "other people") get deterministic fixture seeds:
   `HKDF(FIXTURE_MASTER_CONSTANT, accountId)`. Hydration signs their
   grants/edges with real keys derived from those. The fixture keys are
   public-by-construction and the report says so — the alternative, a
   "legacy unsigned" tolerance path, is precisely the hole a forger
   would walk through, so it does not exist.

Planned modules: `lib/crypto/{kdf,ed25519,vaultCipher}.ts`,
`lib/identity/{keys,deviceKeys,fixtureRoots}.ts`, keystore v4
migration, validator `/keys` directory + verification.

Two Gate 1 architecture decisions settled during recon:

1. **Signed at issuance, verified at the decision gate.** Verification
   runs wherever a decision is made from a signed object: the disclosure
   chokepoints (`resolveLinkage`, `canViewPrivate`), attribution render,
   refutation standing — Next-side — plus the validator for any write it
   accepts. Pubkey resolution: own personas → keystore; seeded accounts
   → fixture directory (deterministic); anything else → the validator
   key directory; unknown → null → invalid. Fail closed at every hop.
2. **Revocation re-signs.** `signGrant`'s canonical form already commits
   to `revokedAt` — that field is IN the signature precisely so the
   revoked state is itself a signed claim. Revoking a grant re-signs it
   with the same persona key (the revoker IS the issuer). No unsigned
   mutation of a signed object, no separate revocation-cert machinery.

Gate 0 code already landed (source only; build+verify wait on the FC
sweeps): `lib/crypto/kdf.ts` (domain-separated HKDF tree, fixture-root
derivation), `lib/crypto/ed25519.ts` (noble wrapper, hex codecs,
never-throwing verify), `lib/crypto/vaultCipher.ts` (AES-256-GCM,
per-record nonce, AAD binds ns|id|v so ciphertext is welded to its
address), and the keystore extension — `signAsPersona` /
`personaPublicKey` / `vaultKeyBytes` / `keyMaterialForLeakTest`, with
private key bytes derived, used, and dropped INSIDE the keystore so
they never cross the module boundary. tsc strict clean.

## Recon fleet results (8 agents, read-only, 0 errors — full transcripts
in the session workflow dir; the decisive facts below, each verified
with file:line by the finding agent)

**The signature map (Gate 1's complete target list):**

| # | Object | Today | Gate 1 |
| --- | --- | --- | --- |
| 1 | Grants (grantsV3, 3 kinds) | sha256 keyed by `rootHandle()` at 5 sites (adapter, fork.ts, seedGrants.ts, private/seed.ts, audience route); **`verifyGrant` has ZERO callers** — presence==validity | Ed25519 by `fromPersona`'s key; verify at every decision gate: `resolveLinkage`, `resolvableSiblings`, `resolveForwardPointer`, `audienceGrants`, resolver |
| 2 | AlgoArtifact / FilterPack | sha256 keyed by the PUBLIC persona id — **anyone can tamper + re-sign**; verification exists (import/preview) but only stops naive tampering | Ed25519 by author persona key; artifact ids derive from sig so id derivation moves with it |
| 3 | Curator annotations (+ embedded refutation-edge riders) | same public-id forgeability, per co-signer; verified at display/issuance chokepoints | per-curator Ed25519; threshold logic unchanged |
| 4 | Refutation author edges (the Tier B teeth) | **NO signature field exists** — a stored `verified` boolean from a one-time identity-equality check, trusted forever after | ADD signature by the from-cast author's persona key; re-verify at standing time, not at declare time |
| 5 | FC attribution index | **unsigned** `{castHash→personaId}` map, persisted to the validator — a validator-side tamper re-attributes casts | signed records; a forged attribution fails verification and is rejected |

**Validator (the untrusted server, 229 lines, 15 endpoints, no auth,
CORS `*`):** it verifies NOTHING today and holds exactly what the pass
must remove — the root→persona mapping in the clear (the documented
phase-1 compromise), plaintext `signer_uuid` bearer credentials,
private-post text, disclosure grants, AND `sessionHandles`: a
browser-handle→rootId session-deanonymization map written OUTSIDE
persist.ts's namespace union — **which the existing root-leak grep
misses** (its rootIds are bare map values, not `"rootId":` keys). CORS
`*` + no auth on `PUT /state/:ns` means any browser page on the machine
can clobber whole namespaces today. API.md freezes the HTTP surface, so
signatures ride OPTIONAL headers with env-gated enforcement
(`LAYERS_REQUIRE_SIG`) — additive, seam preserved, documented as a
contract amendment.

**Persistence rails (what the vault plugs into):** all five vault types
flush VERBATIM plaintext JSON to the validator's `adapter_state` table
via `PUT /state/:ns` — the choke point is exactly two functions
(store.ts `persistNs`/serializers + persist.ts `flush`). The recon
settles the Gate 2 seam decision: **decrypt-at-hydrate /
encrypt-at-flush** (zero read-site changes; the sync chokepoints
`visibility.ts` and `resolveIdentity` stay sync; per-record ciphertext
inside the namespace document keeps per-record LWW available). The
dirty-check must keep comparing PLAINTEXT (nondeterministic ciphertext
would defeat it and re-PUT every namespace every write — the exact
traffic that made the validator flaky once before).

**Traps the recon caught before they cost anything:**
- keystore `load()` FAILS OPEN: a corrupt root.json silently
  regenerates a blank root — today that orphans forks; post-crypto it
  would silently destroy every key and the vault. Becomes loud
  (corrupt → throw; only genuinely-missing creates). Persist becomes
  atomic (temp+rename) — bare `writeFileSync` mid-crash is the same
  hole.
- `persist.ts` vfetch swallows ALL flush errors (fail-open writes) —
  tolerable for demo likes, not for ciphertext. Crypto namespaces get a
  loud flush.
- Three DELIBERATE algorithm duplicates exist (substrate.test.js ×2,
  root-leak.mjs recomputes rootHandle) — extending crypto without
  updating them makes tests assert the wrong algorithm SILENTLY.
- Shallow-copy returns (`{...p}`) in listPersonas/getPersona would ship
  any stored key field to callers — the design stores NO key fields
  (derive-on-demand), so the trap is structurally avoided.
- THREE persona universes (seed / keystore / validator-SQLite). Signing
  covers seed (fixture roots) + keystore (real root). The
  validator-universe personas (AccountSwitcher furniture) are phase-1
  UI and out of Gate 1 scope — stated, not hidden.
- resetSeed contract for new namespaces, from the fcWrites precedent:
  vault contents of the seeded world RESET with it; deviceAuth +
  delegations for real devices SURVIVE (mode-flag pattern); the
  delegation purge joins the forked-persona purge block (a cert from a
  purged persona must not dangle); recoveryMeta SURVIVES — because the
  keystore root itself survives resetSeed (resetKeystore has zero
  callers), and wiping recovery material while keeping the root it
  recovers would be a silent fail-open.
- Leak-grep gaps to close: POST response bodies are never scanned;
  needles are single-encoding; ciphertext-only validation needs a
  PLANTED-CANARY check (assert a known plaintext canary does NOT
  appear in validator state) rather than derived needles alone;
  `sessionHandles` joins the vault set.

---

## GATE 0 — BUILT (source complete; validator chain unit-verified 7/7;
app-side acceptance queued behind the FC pass's final sweeps)

The hierarchy, exactly as designed, plus the recon's hardening list:

**Modules landed:**
- `lib/crypto/kdf.ts` — the domain-separated HKDF tree: persona-sign
  (per nonce), vault/1, device-auth/1, fixture-root branches. Info
  strings assembled in ONE file; a caller never concatenates its own.
- `lib/crypto/ed25519.ts` — noble wrapper; hex at every boundary;
  `verifyCanonical` never throws (every failure mode IS false).
- `lib/crypto/vaultCipher.ts` — AES-256-GCM, per-record 96-bit nonce,
  AAD welds ciphertext to `ns|id|v` so the server cannot rearrange
  meaning; decrypt failure throws and callers treat it as absent.
- `lib/identity/keystore.ts` — extended, not rewritten: signAsPersona /
  personaPublicKey (private key bytes never cross the module boundary),
  vaultKeyBytes, signAsDeviceAuth / deviceAuthPublicKey,
  keyMaterialForLeakTest. HARDENED per recon: corrupt keystore now
  THROWS (silently regenerating a blank root would destroy every key
  while presenting as a fresh boot); persist is atomic
  (temp+rename). Genuinely-missing still creates — first boot is real.
- `lib/identity/fixtureRoots.ts` — deterministic fixture keys,
  SCOPE-GUARDED to actual seed membership so the fixture path can never
  mint a key for an arbitrary id.
- `lib/identity/keys.ts` — THE resolution seam: keystore first (a
  fixture can never shadow a real persona), fixture second, null third.
  One rule for producers and verifiers both.
- `lib/identity/deviceKeys.ts` — random device keypairs (deliberately
  NOT seed-derived), delegation certs signed by the device-auth key,
  envelope signing. Same loud-load/atomic-write discipline.

**Why device-auth is its own HKDF branch, not a persona key:** a
persona-signed delegation would publicly bind every persona the device
acts for to one signer on the validator — recreating the linkage leak
the disclosure model exists to prevent. The envelope authenticates THE
DEVICE; persona signatures live inside the payloads (Gate 1).

**Validator (migration 003 + `/device/*`):** stores PUBLIC material
only — one first-write-wins device-auth anchor (a different key is 409:
the anchor never silently rotates), delegations verified BEFORE
storage, per-device-per-namespace monotonic envelope counters (what
"the validator owns ordering" now checkably means), forward-looking
revocation with PERMANENT device ids (re-registering a revoked id is
refused — revocation must not be a suggestion). Envelope enforcement on
`PUT /state/:ns` and `DELETE /state` is env-gated
(`LAYERS_REQUIRE_SIG=true`), so the phase-1 seam is untouched until a
deployment arms it; the armed config is this pass's verified config.
Verification uses node:crypto Ed25519 (OpenSSL) with the RFC 8410 SPKI
wrap — the validator gains ZERO dependencies and never holds a private
key.

**Next-side envelope client (persist.ts):** lazy bootstrap (anchor +
self-delegation) on first signed write, per-namespace counters based at
Date.now() so restarts are naturally monotonic, LOUD bootstrap failure
(a signed-write deployment must not quietly fall back to writes the
validator will refuse one at a time). `sessionHandles` now writes
through the same client — under an armed validator its old bare PUT
would have been silently refused, stranding every new session.

**Verified now (isolated from the running sweeps):**
- `validator/test/device.test.js` — **7/7**: anchor first-write-wins;
  tampered + expired delegations refused; unsigned writes refused when
  armed; envelope accept/replay-409/tamper-401/unknown-device-401;
  counters per-namespace; revocation forward-looking + id permanently
  burned + forged revocation (device key, not anchor) refused; DELETE
  /state enveloped. Keys minted with node:crypto native Ed25519 — a
  deliberate second implementation against the validator's verify path,
  and the canonical forms duplicated in-file so drift fails loudly.
- Legacy validator suite still 6/6 unarmed.
- tsc strict clean across all of it.

**Queued behind the FC sweeps (runs on the armed rebuild):**
`scripts/accept-c0.mjs` (8 checks, wired as test:c0 into sweep-x):
determinism via cryptoProbe, fixture keys vs independent in-script
derivation, key-material leak grep across app+validator surfaces
(needles re-derived with the suite's own noble imports — the
substrate.test.js deliberate-duplicate discipline), enforcement-armed
assertion, the full delegation chain against the REAL anchor, signed
write + replay + tamper refusals, seed-absent device context, and
revocation. root-leak.mjs extended: persona sign seeds, vault key,
device-auth seed, device private key, and the recovery MNEMONIC as
needles, plus the first POST-response scan (side-effect-free probe).
Dev-route test hooks added (cryptoProbe / issueTestDelegation /
revokeDevice — public material only, and the leak grep scans them like
everything else). noble/scure pinned in package.json at the exact
on-disk versions.

---

## GATE 0 — CLOSED (2026-08-29). 8/8, first run, ARMED.

Sequencing note, honestly: the FC pass's post-fix sweep chain ended at
2 clean of 4 — run 3 was killed by THIS pass editing sweep-x.sh (adding
test:c0) while the driver loop was executing it. Bash reads scripts
incrementally; the rewrite shifted its offset and run 3 died on a
phantom parse error. Self-inflicted, logged to ops memory ("never edit
a script a live driver is executing"). The remaining confirmation is
SUBSUMED, not skipped: this pass's /verify requires 4 consecutive clean
sweeps of the identical 37 legacy suites + c0, which is strictly
stronger evidence than finishing the FC chain first.

The armed rebuild: noble/scure pins recorded (versions unchanged on
disk — no drift), clean build, both processes started with
LAYERS_REQUIRE_SIG=true, migration 003 applied to the real layers.db.
The app's first flush bootstrapped the device chain unprompted: anchor
registered, self-delegation verified and stored, and resetSeed's
wipeAll went through the SIGNED path on the first try.

**accept-c0: 8/8.** Determinism (derive twice → identical), fixture
keys vs the suite's independent noble derivation (pins the canonical
forms), key-material leak grep across app + validator surfaces (6
needle classes), enforcement ARMED (unsigned PUT → 401), the delegation
chain against the REAL anchor (different anchor → 409; tampered
delegation → 403), device-signed write accepted with replay → 409 and
tampered body → 401, seed-absent device context, revocation
forward-looking with the id permanently burned.

**Legacy through the signed path, first confirmation:** validator 13/13
(6 legacy + 7 device-chain), substrate 9/9, root-leak CLEAN at 49
payloads with the needle set grown 2 → 6 classes (root secret, root
handle, vault key, device-auth seed, persona sign seeds, mnemonic +
device key when present), accept 14/14, g3 7/7, m3 17/17. Every one of
those suites' writes now rides a device-signed envelope the validator
verifies — transparently, which is the point of the seam.

Gate 0 exit criteria vs spec: re-derivation determinism PROVEN; a
device key signs an action the validator accepts via delegation with
the seed absent from that context PROVEN (and its refusal modes:
replay, tamper, revocation, forged revocation); key-material leak grep
CLEAN across adapter responses. Iterations used: 1 of 3 — 2 donate
forward.

---

## GATE 1 — BUILT (2026-08-29). Real Ed25519 at every signature site;
verification enforced at every decision gate. accept-c1 8/8.

The core (landed by hand, then 9 file-owned editors fanned out over the
producers/consumers with a shared contract):

**grants.ts — the atom, re-armed.** `signGrant`/`verifyGrant` (sha256,
zero real callers) removed. New: `grantCanonical`, `grantId` (hashes the
ISSUANCE canonical so revocation never changes a grant's id — forks,
UIs, tests keep their references), `signGrantWith(g, signer)` returning
null when the signer refuses (caller REFUSES, never stores unsigned),
`resignGrant` for revocation, `verifyGrantSig`. The signer is a closure
— key storage stays in keystore/keys.ts, so grants.ts has no import
cycle and no key material.

**The signing rule, one line everywhere: the issuer is `fromPersona`.**
It lands correctly by construction at every producer — forward pointers
sign as the mover (oldPersona), reissues sign as the fork (newPersona),
audience grants sign as the private persona (from===to), seeds sign as
the seeded author. No per-call-site logic.

**verifiedGrants.ts — the enforcement point.** Before this, presence in
the grantsV3 map WAS validity. Now every decision surface —
resolveIdentity, private-post `audienceGrants`, feed block fan-out, fork
`currentGrantHolders`/`resolveForwardPointer`/`reissueGrants`, the
identity adapter's own reads — consumes `verifiedGrants()`. An
unverifiable grant is ABSENT, matching how the model treats absence
everywhere. **Re-review fix:** the verify memo caches the
(canonical,signature,key) verdict — pure — but NOT the no-key-yet
branch, because "fromPersona has no resolvable key" is mutable process
state (mint the persona later and the grant becomes verifiable); caching
false there would pin a grant absent for the process lifetime.

**Revocation re-signs.** `revokedAt` is inside the canonical precisely
so the revoked state is itself a signed claim — revoking re-signs with
the issuer's key, same id, fresh signature. A revoked grant that kept
its issuance signature would fail verification and vanish entirely
instead of tombstoning; c1 test 4 pins this.

**The other four signature types, all swapped from public-id-keyed
sha256 (which anyone could re-sign) to author-key Ed25519:**
- Artifacts / filter packs: signed by the author persona's key; a
  tampered artifact is refused at preview AND import (its author's key
  no longer verifies the mutated canonical). c1 test 6.
- Curator annotations: per-co-signer Ed25519; an invalid co-sign does
  not count toward the multisig threshold. (a4 test 3, "signature
  verification is real", now runs against actual crypto.)
- Refutation author edges — the Tier B teeth: a `signature` field was
  ADDED (none existed — standing rested on a stored boolean). Standing
  now RE-VERIFIES the signature at read time (`authorEdgeSigVerifies`);
  the declare-time authorship-equality check stays as the authorship
  anchor. Curator-attested edges carry `signature: null` — their
  authority is the threshold-verified annotation. c1 test 8.
- FC attribution index: rows gained a `signature`; `attributionFor`
  verifies before rendering, failing closed to bare FID. Closes the
  validator-side reattribution vector permanently — the mega-pass bug's
  cryptographic fix. c1 test 7 (both attack shapes: reattribute-keeping-
  signature and forge-signature-keeping-persona).

**The seeded world signs for real** through fixture keys — no
unsigned/legacy tolerance path exists, so nothing renders "valid but
unverified". A seeded persona that couldn't sign THROWS at seed time
(loud, not a silent skip).

**accept-c1 (8 checks, wired as test:c1):** whole seeded grant world
verifies + per-signature cost reported (**~1.34ms/grant**, well under
the 5ms line); disclosure through verification; the audience-grant
tamper failing closed both ways (attacker gets nothing, victim's own
access is not collateral-damaged); issue+revoke re-sign; keyless-persona
issuance refused with nothing stored; artifact tamper; attribution
tamper (2 shapes); refutation-edge tamper losing standing at read time.
Every tamper drives the new `tamperState` dev hook — a wholesale record
replace exactly as a compromised validator could do.

**Regression:** c0 still 8/8; substrate 10/10 (its deliberate-duplicate
now signs with node:crypto Ed25519 and asserts the revocation re-sign
property); root-leak clean; accept 14/14; g1-g3, a4 (8/8, incl. the
now-real signature-verification test), b3, b4 all green through the
signed path. tsc strict clean. Per the plateau rule, Gate 1 closes on
the 4-sweep /verify — running next.

---

## GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7.

The untrusted validator held the FULL plaintext grant graph, private
posts, event log, and a session-deanonymization map. Now it holds
CIPHERTEXT and ordering only.

**Seam (settled by recon, held under build):** encrypt-at-flush /
decrypt-at-hydrate, injected into store.ts's `persistNs()` (encrypt
after the plaintext dirty-check) and `hydrate()` (decrypt before the
serializer). ZERO read-site changes — the sync disclosure chokepoints
(`visibility.ts`, `resolveIdentity`) still read plaintext Maps in
process memory; only the bytes crossing the wire to :4000 are
encrypted. The dirty-check stays on PLAINTEXT, because a fresh GCM nonce
per flush makes ciphertext nondeterministic and a ciphertext comparison
would re-PUT every namespace on every write — the traffic that made the
validator flaky before.

**`lib/vault/vault.ts`** — `encryptNamespace`/`decryptNamespace` over
`vaultCipher.ts` (AES-256-GCM, per-record nonce). Vault namespaces:
privatePosts, grantsV3, resolutionRequests, forks, edgeEvents,
graphClaims, graphConsent, imports, xImportedPrivate — the five debt
types plus the sensitive adjacents recon flagged. `sessionHandles`
(the deanonymization map the old leak grep MISSED) is vaulted in its
own bespoke read path.

**Fail-closed on read, every direction:** a record whose sealed (ns,id)
address does not match the slot it sits in is DROPPED (the moved-record
attack the AAD binding defeats, enforced at the read); a record that
fails to decrypt (tamper) is DROPPED, its neighbours unaffected; a
non-ciphertext record (legacy plaintext, server-side injection) is never
served as vault content; and if EVERY record in a namespace fails —
wrong key, not per-record tamper — it THROWS, because silently serving
an empty vault reads as "you have nothing" when you cannot read what you
have.

**`flushVault` is LOUD.** The default flush swallows every error
(fail-open, fine for demo likes); a vault write that silently fails is
invisible data loss. Vault namespaces throw on any transport or server
refusal — the "never fail open" rule, at the persistence layer.

**accept-c2 (7 checks, test:c2):** the cipher round-trips with no
plaintext in the ciphertext and rejects a wrong key AND a moved record;
a private post is ciphertext at rest (the validator never sees its
text); the author's client decrypts it back intact; grants and the
event log are ciphertext too; a server-side ciphertext tamper is dropped
by the read gate while the intact neighbour survives (per-record
fail-closed, driven by a real signed corruption of the validator's
stored bytes); a runtime post reconstructs from the validator's
ciphertext exactly as hydrate would rebuild it; and a broad grep finds
NO known vault plaintext anywhere in the validator's /state.

**root-leak.mjs extended** with vault-plaintext needles (the seeded
private-post texts + the canary) — the always-on tripwire, every
iteration. **restart-survival.mjs** gains a vault assertion: the private
post that survives a REAL process kill did so AS CIPHERTEXT, never
plaintext, on the validator.

### The regression the first sweep caught (and the fix)

Sweep 1 of the Gate 1 /verify failed a5/b0/b3 — refutation author edges.
Root cause: an edge is asserted by the from-cast's AUTHOR, and in this
app a cast is authored by a SESSION/account persona (the
validator-universe identity from /api/personas), which has no keystore
or fixture key — so `signForPersona` returned null and the edge was
refused. Before Gate 1, verification was just the authorship boolean, no
key needed.

**Fix — a distinct ACCOUNT key space** (`lib/identity/accountKeys.ts`):
refutation author edges sign/verify over a key that resolves
DETERMINISTICALLY for any persona id (keystore key if minted, else a
fixture-style key from the id alone). Two properties make this correct,
not a backdoor: (1) resolution is by id only — no registry, no process
state — so a signature verifies identically after a restart, which the
stored `verified` boolean can no longer be trusted to carry; (2) it
never gates authorship — WHO may hold standing is gated earlier by the
authorship-equality check (`castAuthor === assertedBy`), and the
signature only makes tampering detectable. Grants/attribution/
annotations keep keys.ts's STRICT resolution, so "issue as a persona
with no key" still refuses there (c1 test 5 stays green). This is the
three-persona-universe seam (seed / keystore / validator-session) made
explicit: disclosure objects sign in the persona space, account objects
in the account space.

Post-fix: a5 6/6, b0 3/3, b3 7/7, c0 8/8, c1 8/8, c2 7/7. tsc strict
clean. The real-restart vault proof (gate0.mjs, armed) and the 4-sweep
/verify are running.

---

## GATE 3 — DEVICE LINKING — BUILT (2026-08-29). accept-c3 5/5.

Multi-device without copying the seed. The core primitives (device
keypairs, delegation certs, envelope signing, forward-only revocation)
landed in Gate 0; Gate 3 adds the linking FLOW and the management
surface.

**What crosses the wire, and why it is not the seed** (`lib/linking/`):
the origin device seals a payload `{ deviceDelegation, vaultKey }` under
a fresh 32-byte linking secret (the QR/long code, carried out-of-band),
and stores only the CIPHERTEXT on the relay. The new device, given the
secret, opens it. The delegation authorizes the new device to write
(public material); the vault key lets it READ vault content. The seed,
the root secret, and every persona SIGNING key stay on the origin
device — a linked device can read the vault and make
envelope-authenticated writes, but cannot mint the root's disclosure
personas. That boundary is the honest one, and it is stated, not
hidden.

**`app/api/device`** — the management surface: GET lists authorized
devices (public: ids, pubkeys, status); POST `linkBegin` authorizes a
new device and returns `{ linkId, secret }` (secret shown as a QR,
never stored on the relay); POST `revoke` signs a revocation with the
device-auth key. Revocation is forward-looking — the UI says so.

**accept-c3 (5 checks) — the SUITE plays the new device**, an external
keypair the seed-holding server has never seen, so "the seed never
crosses" is checkable by construction: linkBegin stores ciphertext only
(no seed-derived material, not even the secret, on the relay); device B
opens the channel and finds a delegation + vault key but NEVER the seed
or a persona signing key (a wrong secret cannot open it); device B
registers its delegation and makes an envelope-signed write the
validator accepts; device B decrypts a vaulted private post with only
the transferred vault key (the money shot — a second device reading the
shared vault); revoking device B refuses its next write and marks it
revoked in the list. Deliberate-duplicate crypto (node:crypto) pins the
channel-seal and envelope formats across two implementations.

---

## GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7.

A lost device is not a death sentence. The gate makes the deliberate
call the whole project tabled.

**Baseline — the recovery phrase** (`lib/recovery/mnemonic.ts`): the
32-byte seed as a standard 24-word BIP39 mnemonic (@scure/bip39,
audited). Revealing it forces an explicit acknowledgment — the phrase
IS the identity: write it down, lose it and everything is gone, anyone
who holds it is you.

**Stronger option — encrypted passphrase escrow**
(`lib/recovery/escrow.ts`): the seed sealed under scrypt(passphrase) +
AES-256-GCM, stored as ciphertext the server cannot read. A wrong
passphrase yields NO seed (GCM auth fails), never a plausible-but-wrong
one.

**THE RECOVERY-OPTION DECISION, made and justified.** The spec's
nominal default is social recovery (Shamir M-of-N). I built escrow
instead, deliberately: the crypto discipline is absolute — audited
primitives only, no hand-rolled schemes — and there is no vetted Shamir
implementation on disk. Hand-rolling Shamir over GF(256) violates that
rule, and pulling in an unvetted secret-sharing dependency unattended is
exactly the supply-chain risk the rule exists to prevent. Escrow meets
the same "one stronger option" bar using only audited platform
primitives, needs zero new dependencies, and never exposes the seed to
the server. **Shamir / SLIP-39 social recovery is the documented next
step, once a library can be vetted** — the recovery seam
(`recoverIdentity(seed)`) is agnostic to how the seed was reconstituted,
so adding a third door is additive.

**The reconstruction is WHOLE, not just the seed.** Total device loss
destroys the keystore file — including each persona's nonce, without
which the seed re-derives keys but cannot enumerate the personas. So the
identity ROSTER (ids, nonces, display metadata) is mirrored into the
vault (`lib/identity/roster.ts`), encrypted under the vault key, on
every persona mint. Recovery: phrase/passphrase → seed → vault key →
decrypt the roster off the validator → rebuild the keystore. After that
every persona key, grant signature, and vault record reproduces
bit-identically, because the inputs are bit-identical.

**accept-c4 (7 checks):** the phrase is gated by a forced
acknowledgment (428 without it); a minted (forked) persona + a vaulted
private post are staged; the seed is escrowed under a passphrase (a
too-short passphrase is refused); after TOTAL device loss the vault is
genuinely LOCKED — a fresh blank root cannot open it (proving the
recovery that follows is meaningful, not vacuous); recovery from the
PHRASE restores the minted persona, re-verifies every grant, and
re-opens the vault; recovery from the ESCROW + passphrase does the same
after a second loss (a wrong passphrase recovers nothing); an invalid
phrase is rejected, never silently accepted.

### A real defect the gates surfaced (device re-enrollment)

Running c4 before other suites in one process broke them all: device-
loss simulation deletes `device.json`, the next write generates a fresh
device key, but the bootstrap latch said "already enrolled" — so the new
device was never registered and every envelope write was refused as an
unknown device, cascading into every suite that followed. The fix:
`resetEnvelopeBootstrap()` on both device-loss and recovery, so the next
signed write re-enrolls the device under the (recovered) anchor. This
is not just a test artifact — it is the real recovery-onto-a-new-device
path: recovery lands on a fresh device that must enroll before it can
write, and now does. Post-fix, c4 followed by c1 both stay green.

### THREAT MODEL (stated plainly, per the spec)

- **Seed compromise = full impersonation.** Anyone with the phrase (or
  the passphrase + escrow blob) IS you: they recover the seed, derive
  every key, decrypt the vault. There is no remote kill for a stolen
  seed. The only recourse is the FORK mechanic — abandon the compromised
  personas going forward — which limits future damage but cannot undo
  what a holder of the seed can already do.
- **The escrow trades a secret you keep for a secret you remember.** A
  weak passphrase makes the escrow blob an offline-guess target; scrypt
  (memory-hard, tuned cost) raises that cost but does not eliminate it.
  The phrase kept offline is stronger; escrow is the convenience option,
  labeled as such.
- **The validator remains untrusted throughout.** It stores the roster,
  the vault, and the escrow blob as ciphertext it cannot read. Losing
  the validator loses availability, not confidentiality.

---

## /VERIFY — the crypto pass, end to end

**Two full 42-suite 4-sweeps, zero product failures across all 8 runs;
every crypto suite (c0–c4) green in every run.** Totals: sweep A —
300 / 299 / 300 / 300; sweep B — 299 / 300 / 300 / 300. The only two
non-green results in all 8 runs were INFRA (could-not-test), not FAILED
product suites, and both were legacy PAGE/adapter harness flakes root-
caused and hardened:
- `accept-a1` test 2 forced `retryBudget − 1` record() failures, leaving
  ZERO margin against the mocks' designed 2% synthetic failure rate — a
  guaranteed ~2%/run flake. Hardened (and then, in a follow-up pass,
  fixed at the root: content-derived event ids make the client retry
  idempotent, closing the standing idempotency-key gap so the test can
  exhaust the whole internal budget and still see exactly one event).
- `accept-x3` test 6 clicked the composer after a flat `waitForTimeout`,
  which /home's retried adapter render outran under full-sweep load;
  a 30s click timeout then read as INFRA. Hardened to poll for the
  composer + toggle before acting (with a midway reload) — the
  "poll for settled content, not a flat wait" rule. x3 then ran 8/8
  three times.

Neither flake ever touched a crypto suite or product code (the a1 root
fix aside, which improves the event log). The product invariant — zero
FAILED suites — held in all 8 runs.

**Per-signature performance** (cryptoProbe, seeded grant world):
~1.1–1.4 ms/grant to verify — Ed25519 verification is not a feed-render
concern at this scale; the `verifiedGrants` memo makes repeat reads free.

## SECURITY POSTURE — what an attacker can and cannot do now

Stated plainly, because a security claim that isn't specific is
marketing.

**An attacker who fully controls the validator (the untrusted server)
CANNOT:**
- read a private post, a disclosure grant, the relationship event log,
  the context/backpack graph, imported private X content, the identity
  roster, the session→root map, or an escrow blob — all ciphertext, keyed
  off a seed the server never holds;
- forge a grant, an artifact, a curator annotation, a refutation author
  edge, or a cast attribution — each is Ed25519-signed and verified at
  the decision gate; a tampered or fabricated object fails verification
  and is treated as ABSENT;
- rearrange vault records across slots — the per-record AAD binds each
  ciphertext to its (namespace, id), and a moved record is dropped on
  read;
- accept a write it did not authorize — state writes require a device
  envelope signed by a delegation chaining to the registered anchor, with
  a monotonic per-namespace counter, so forged and replayed writes are
  refused;
- keep a revoked device working — revocation is enforced server-side and
  the device id is permanently burned.

**An attacker CAN still:**
- take the service DOWN — the validator is a single trusted-for-
  availability party; losing it loses availability, not confidentiality;
- see METADATA — record counts, sizes, timing, and which namespaces
  change when. The vault hides contents, not the shape of activity;
- fully impersonate a user IF they obtain that user's SEED (the recovery
  phrase, or the passphrase plus the escrow blob) — the seed is the whole
  identity, there is no remote kill for a stolen one, and the only
  recourse is forking away from the compromised personas going forward;
- brute-force a WEAK escrow passphrase offline against a stolen escrow
  blob — scrypt raises the cost, a strong passphrase or the offline
  phrase avoids it.

**What stands between here and the ZK membership layer:** the disclosure
predicates (`resolveLinkage`, `audienceOf`) are now real signature checks
over a plaintext grant set held in the client; the ZK track replaces
"the client holds the grant set and checks it" with "prove the predicate
without revealing the grant set." The grant canonical form, the
resolution predicate, and the fork reissue are all fixed and signed —
i.e. already specified as a circuit would need them. Social recovery
(Shamir / SLIP-39) is the other named follow-up, gated only on vetting an
audited secret-sharing library.

## Gate ledger

| Gate | Result | Suite |
| --- | --- | --- |
| 0 — key hierarchy + device delegation | CLOSED | c0 8/8, validator 13/13 |
| 1 — real signatures + verification | CLOSED | c1 8/8, substrate 10/10 |
| 2 — the vault | CLOSED | c2 7/7 |
| 3 — device linking | CLOSED | c3 5/5 |
| 4 — recovery | CLOSED | c4 7/7 |

Iterations used: G0 1/3, G1 ~1/4, G2 1/4, G3 1/3, G4 1/4 — every gate
closed well inside its budget. No crypto safety item is KNOWN-BROKEN.
KNOWN-BROKEN: none.
