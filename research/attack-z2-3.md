# ATTACK-Z2-3 — adversarial review, ZK Pass 2, lens: soundness of the new scopes and claim kinds

**Adversary:** the OPERATOR — runs the validator, hosts the trees and the
relay, holds the database and the process logs, sees request metadata and
timing. Where a finding is an integrity gap (a proof that proves less than
the record it writes) the forger is "any registered tier-T root", which
includes the operator's own leaves (C1) and any low-value account that
clears the gate tier.
**Goal of this pass:** link two personas of one root, link a forked persona
to its predecessor, or narrow a proof's candidate set below the floor —
without breaking cryptography; and, under this lens, find any envelope or
request the verifier accepts for the three claim kinds that proves less
than what `zk_fork_claims`, `zk_attestation_claims` or `zk_eligibility`
then asserts.
**Method:** read the verifier (`validator/zk.js`) field by field against the
client (`lib/zk/scopes.ts`, `lib/zk/prove.ts`, `lib/zk/gate.ts`,
`lib/zk/prefetch.ts`, `lib/zk/budget.ts`, `lib/zk/cohort.ts`,
`lib/zk/identity.ts`, `lib/zk/registration.ts`, the transports and the
prover worker), the key hierarchy (`lib/crypto/kdf.ts`,
`lib/identity/keystore.ts`), the device-state paths the fork touches
(`app/api/identity/fork/route.ts`, `lib/identity/roster.ts`,
`lib/identity/rootRoster.ts`, `lib/vault/vault.ts`,
`lib/adapters/mock/persist.ts`, `lib/adapters/mock/store.ts`), the schema
(`validator/migrations.js`, `validator/server.js`), the two Gate 3/4 suites
(`scripts/accept-z8.mjs`, `scripts/accept-z9.mjs`), SECURITY-POSTURE §10–§11
and REPORT-Z2. Every claim that could be checked against committed state
was checked against `validator/layers.db` read-only (`node:sqlite`,
`readOnly: true`; no key tables were read).
**Not done:** no servers run, no suites run, no timings measured, nothing
changed but this file. Line numbers as of this read (HEAD `4c09552`).

---

## Summary

The claim binding itself holds up. For all three kinds the verifier
re-derives `scope`, `challenge` and `message` from the public inputs it is
about to record against and refuses anything else before it looks at a
proof (`validator/zk.js:483-491`); the three scope feature strings differ,
so a proof of one kind cannot be re-labelled as another (the re-derived
scope differs and the circuit's `hash(scope)` signal is bound to the
nullifier); the message shapes differ in part count and in a kind-specific
prefix that the `gateId`/`personaId` charsets cannot imitate; the old and
new persona of a fork never share a nullifier; the "one active commitment
per root" index is real and the handler that relies on it is synchronous;
the mock issuer is unreachable without `ZK_DEV_HOOKS`; an empty attest tree
cannot be proven against; a revoked commitment cannot re-register. All of
that is in *Attacks that failed*, with the line that defeats each.

What does not hold up:

1. **The device publishes its keystore roster to the validator with
   PLAINTEXT persona-id addresses, device-signed, on the same request that
   performs a fork** — the exact defect this pass fixed for the `forks`
   record (`store.ts:419-426`, "linkage v2 caught it") three lines earlier
   on the same code path, and the exact defect attack-1 finding 1 named in
   Pass 1. Verified against the committed database: the forked persona in
   `zk_fork_claims` is the key of the `identityRoster` row written 8 ms
   after the sealed `forks` record. The linkage-v2 test is blind to it by
   construction (it inspects the `forks` row's *value* and never any
   namespace's *key*). (Finding 1 — HIGH.)
2. **The fork-continuity proof binds nothing about the OLD persona.** It is
   a tier-membership proof with a 64-hex label in the message. Any tier-T
   root can record a validator-verified "continuity" claim for any
   (old, new) pair it chooses, and §11's stated verification procedure
   ("open the commitment, read `/zk/fork-claim`") accepts it. What
   actually authenticates old → new is the forward pointer signed by the
   old persona's key — a persona-level signature the proof does not touch.
   The posture doc says "provably"; the circuit does not. (Finding 2 —
   MED.)
3. **The attestation claim re-creates the preparation burst that Gate 0
   retired.** The scheduled prefetch snapshots the gate tree only; an
   attestation proof is for `attest:<issuer>`, so `prepareAndProve` falls
   back to fetching that tree's leaves, history and anonymous head on the
   identified channel at the moment it is about to prove, then submits
   within the jitter window. (Finding 3 — MED.)
4. **Re-issuance rotates a branch of an unchanged seed.** A-Z3-REVOKE-EPOCH-
   GRACE bounds "a compromised secret" to one epoch plus grace; that is
   true of a leaked prover branch and false of a leaked seed, which
   derives every future index the moment the honest device publishes it.
   The recovery scan A-Z3-INDEX-FILE relies on has no implementation.
   (Finding 4 — MED.)

Plus three LOW findings (the fork-claim table is the one presence log that
is never pruned; the attestation scope omits the issuer, so a persona can
prove one attestation per epoch across all issuers; the proof-history
budget counts the fork's partition twice) and an INFO cluster.

Finding 1 is not a soundness gap in the new scopes — it is a device-state
leak — but it is grounded in the committed database, it defeats the
property this pass exists to deliver, and it was reachable from this lens
only because the fork route was read end to end. It leads.

---

## Findings

### 1. `identityRoster` is stored on the validator with plaintext persona-id addresses, device-signed, written on every fork

**Claim.** The vault seals record VALUES, not record ADDRESSES
(`lib/vault/vault.ts:88-98`: `out[id] = encryptRecord(key, ns, id,
record)` — the loop's output key is the plaintext id). This pass knew it:
the `forks` record was re-stored as ONE opaque record because "the fork
record used to be ADDRESSED by the old persona id — a plaintext 'this
persona forked at t' beside a fork-continuity claim arriving at t + jitter"
(`lib/adapters/mock/store.ts:419-426`), and `rootRoster` was designed as
one opaque padded record because "the addresses here would be root ids"
(`lib/identity/rootRoster.ts:19-25, 88-94`). The keystore roster was not:
`lib/identity/roster.ts:26` builds `doc[p.id] = p` for every keystore
persona and `roster.ts:27` flushes it as `encryptNamespace(NS, doc)` — the
persona ids are the document keys. The validator stores them verbatim
with a fresh `updated_at` (`validator/server.js:331-337`).

**When it is written.** `app/api/identity/fork/route.ts:173-178` calls
`syncRoster()` on every fork, after `persistNs("forks")` (line 166) and
`persistNs("grantsV3")` (line 167) — three PUTs on one request. The forked
persona is keystore-minted (`route.ts:102-111` →
`lib/adapters/mock/identity.ts:64-77` → `keystore.createPersona`,
`lib/identity/keystore.ts:295-313`), so it is in `rosterForRecovery()`
(`keystore.ts:376-378`) and therefore a key of the flushed document.
Under `LAYERS_REQUIRE_SIG=true` the PUT carries the device envelope
(`lib/adapters/mock/persist.ts:245-247` → `188-199`): the roster is not
merely co-located with the fork, it is cryptographically attributed to the
device.

**Evidence from the committed database** (`adapter_state`, read-only):

```
forks          | _                                  | updated_at 1788584601772   (sealed, opaque — the fix)
grantsV3       | g_2be5…, g_bb48…, … (6 rows)       | updated_at 1788584601765   (random ids — fine)
identityRoster | p_efd7be7ef55cb611d06dce1c4d43a91e | updated_at 1788584601780   (THE FORKED PERSONA, in the clear)
```

and in the zk tables:

```
zk_fork_claims  | fixture | p_efd7be7ef55cb611d06dce1c4d43a91e | tier-2 | 2 | epoch 82807
zk_eligibility  | fixture | p_efd7be7ef55cb611d06dce1c4d43a91e | foryou | 2 | epoch 82807
```

The only `identityRoster` key in the database IS the only `zk_fork_claims`
persona. (The fixture's seeded viewer personas are not in the keystore —
`adoptSeededPersona` at `keystore.ts:339-353` has no caller — which is the
only reason the row set has one key rather than the whole persona set.)

**Observation path, step by step.** (1) Diff the `identityRoster` key set
across PUTs (or just read it: `SELECT key, updated_at FROM adapter_state
WHERE namespace='identityRoster'`). A key that appears at time T is a
persona this device minted at T; under `REQUIRE_SIG` the envelope names
the device. (2) At the same instant the `forks` row's `updated_at`
advances (the `_` record is rewritten on every fork). So: "device D minted
persona N at T, and D forked at T". (3) Within [30 s, 15 min]
(`lib/zk/config.ts:58-59`) an anonymous `fork-continuity` proof for N lands
and `zk_fork_claims(N, H, tier-2, 2, E)` is written (`validator/zk.js:540-
545`). The anonymous channel's hygiene is irrelevant: N → D was handed
over on the identified channel, signed, before the proof was made.
(4) Every OTHER keystore persona of D is a sibling key in the same
document — two forks from one device, or a fork plus any persona minted
through the keystore binding, sit side by side in one signed write. The
predecessor O is among them whenever O was itself keystore-minted; when O
came through the signer flow it went to the opaque `rootRoster` instead
(`app/api/personas/route.ts:25-27`), and O → D is then only the
pre-existing identified-channel leak.

**What the suites see.** `scripts/accept-z9.mjs:259` restricts the
"ciphertext at rest" check to `zkProofBudget`, `zkRootAnchor`, `zkQueue`;
check 6 (`z9:385-389`) reads `forksState` rows with `SELECT key, value` and
then tests only `row.value` (`row.value.includes(ALT) ||
row.value.includes(NEW)`), never `row.key`, and never the `identityRoster`
namespace at all; the "no row pairs NEW with ALT" scan (`z9:377-381`) runs
over `view`, which has no roster query. The test that "caught" the `forks`
address cannot catch this one.

**Severity:** HIGH — LINKAGE OF SIBLINGS and NEW → DEVICE, exact, signed,
no analysis; the fork design's central promise ("what it never learns: the
old persona", SECURITY-POSTURE.md:488-490) is met at the proof layer and
undone eight milliseconds later on the same request.
**Confidence:** HIGH. Verified on disk.
**Already admitted?** NO. Not in §3, §10 or §11. attack-1 finding 1 named
the class in Pass 1; §9 credits the fix as "device-local pins"
(`lib/zk/localPins.ts`) and the vault comment (`vault.ts:59-67`) fixes
`zkQueue` only, six lines below the `identityRoster` entry (`vault.ts:58`).
**Fix.** Store the keystore roster exactly as `rootRoster` is stored: one
opaque record (`{ _: { m: doc, pad } }`, `rootRoster.ts:88-94`) and read
`plain["_"].m` in `recoverIdentity` (`roster.ts:39-58`) — a small change
with no protocol impact. Better: hash every vault address
(`HMAC(vaultKey, ns‖id)`) in `encryptNamespace` so the class cannot recur
(attack-1's fix #1, still unapplied). And make z9 check 6 assert on
`row.key` for every namespace in `VAULT_NAMESPACES`, not on one row's value.

---

### 2. The fork-continuity proof proves nothing about the old persona; "provably the account behind this new one" is false at the proof layer

**Claim.** A `fork-continuity` envelope is a Semaphore membership proof in
the gate's tier tree whose message binds `personaId | gateId |
fork:<forkCommit> | epoch-E | root` (`validator/zk.js:187-189`; client
`lib/zk/prove.ts:161-163`). `forkCommit` is a 64-hex string the verifier
only checks for shape (`zk.js:103, 478`) and re-derives the message from
(`zk.js:188`). Nothing relates its preimage `sha256("layers-fork-commit/1|
old|new|nonce")` (`app/api/identity/fork/route.ts:145-147`, computed on the
device from strings the device chooses) to any leaf, any root, or the
persona named in the proof. The verifier never checks persona ownership at
all (`zk.js:459-561` — A-PERSONA-ROOT-BINDING, SECURITY-POSTURE.md:119-125,
already says the circuit does not bind persona to root); the only
ownership check is client-side (`prove.ts:79-81`), i.e. the prover's own
restraint.

So the statement the validator verifies is exactly: *"some leaf of tier-T
authorizes persona N and chose to attach label H."* The statement §11 says
a holder may conclude is: *"the account behind the persona I trusted is,
provably, the account behind this new one, at tier T"*
(SECURITY-POSTURE.md:491-495). The scope registry's own linkage line
describes "a membership proof in the old persona's tier tree"
(`lib/zk/scopes.ts:92-94`); there is no such tree — the fork claim is made
in `gateTree()` = `tier-${ZK_GATE_TIER}` (`lib/zk/gate.ts:137`,
`lib/zk/config.ts:41`), whatever the old persona's tier was, so even the
"at tier T" is the gate threshold (2), not the predecessor's tier.

**The forged request, concretely.** Any root R holding a leaf in `tier-2`
(the operator's own decoys — `zk.js:870-894`; or a throwaway account that
earned tier 2) with a persona N it controls:

1. Pick a victim persona V (any id; `zk_fork_claims` has no foreign key to
   `personas`), a fresh `nonce`, and compute
   `H = sha256("layers-fork-commit/1|" + V + "|" + N + "|" + nonce)`.
2. Produce `prepareAndProve({ claimKind: "fork-continuity", tree: "tier-2",
   personaId: N, gateId: "foryou", forkCommit: H })` — from R's own client
   (the dev `prove` action `app/api/zk/route.ts:297-319` is only the
   convenient way; R runs its own app). The message binds H, the proof
   verifies, the root is the signed one, the nullifier is fresh.
3. Submit. The validator writes `zk_fork_claims(N, H, tier-2, 2, E)`
   (`zk.js:540-545`) and `zk_eligibility(N, foryou, 2, E)` (`zk.js:550-555`).
4. Hand `(V, N, nonce, H)` to V's audience out of band ("I'm V, I moved
   to N — check for yourself"). They compute the hash, see it equals H,
   query `GET /zk/fork-claim?personaId=N&forkCommit=H` (`zk.js:755-764`,
   public) and get `{ verified: true, tree: "tier-2", tier: 2, epoch: E }`.
   Following §11 to the letter, they conclude V's account is N's account.

Nothing in that request is refused by anything in `verifyAndRecord`; the
z8 binding check (`scripts/accept-z8.mjs:130-150`) tests a *tampered* H and
a stray H on a tier envelope, never an H whose preimage names a persona
the prover does not own — which is not a tamper, it is a valid proof.

**What actually authenticates old → new** is the forward pointer: a grant
signed by the OLD persona's key (`lib/identity/fork.ts:57-64`,
`signForPersona(g.fromPersona, …)`; issued at `fork.ts:74-94`; resolved
only for a named carried holder at `fork.ts:104-119` and handed out with
the nonce only through `app/api/identity/fork/route.ts:40-59`). That is a
persona-level signature the ZK layer neither strengthens nor replaces. The
proof's honest contribution is "N's prover holds a tier-T leaf this
epoch" — the same thing a tier-membership proof says — plus a label that
lets a pointer holder match the two records. Two consequences: a holder
who checks only the fork claim (the doc's procedure) is fooled by any
tier-T root; and even with the pointer, "same account" is still O's
assertion (O's owner can point at any N, including one owned by a
colluding higher-tier root that then proves "continuity" at that tier).

**Severity:** MED — an integrity overclaim in the posture doc and the
scope registry, exploitable as identity impersonation by anyone who
follows the stated check; not a privacy leak.
**Confidence:** HIGH on the verifier (every accepted field traced); the
narrative in step 4 is the doc's own procedure.
**Already admitted?** PARTIALLY. A-PERSONA-ROOT-BINDING (§3:119-125) states
the circuit does not bind persona to root; §11 nevertheless writes
"provably". A-Z3-FORK-COMMIT-SET (§3:527-531) is about enumerating the
preimage, not about what the proof binds.
**Fix.** State it: **A-Z3-FORK-CLAIM-IS-A-VOUCH** — "a verified fork claim
means a tier-T leaf vouched for N under H; it does not establish that H's
preimage names N's own root or the predecessor's root; continuity of
IDENTITY rests on the forward pointer signed by the old persona, and a
verifier must require the pointer AND the claim." Reword §11:491-495 and
`scopes.ts:92-94` (there is no "old persona's tier tree"). The in-circuit
fix is the persona↔commitment relation A-PERSONA-ROOT-BINDING already
defers (a custom circuit — F12's tax); until then the fork claim should be
documented as a tier proof with a label.

---

### 3. Attestation proofs re-create the preparation burst for the attest tree

**Claim.** Gate 0 retired A-PREPARE-BURST by proving from a fixed-schedule
snapshot (notes/reports/REPORT-Z2.md:14-31). The snapshot covers ONE tree: the tick calls
`prefetchOnce(mode, gateTree())` (`lib/zk/prefetch.ts:93-94`). An
attestation claim is wanted with `tree: "attest:" + issuer`
(`lib/zk/gate.ts:150`) and is proved with the gate-tree snapshot passed in
(`gate.ts:171`), which `prepareAndProve` discards because
`snapshot.tree !== req.tree` (`lib/zk/prove.ts:75`). Every fetch the
snapshot was built to remove then runs, on the identified channel, at the
moment this device is about to prove an attestation:

- `prove.ts:87` → `fetchEpoch(mode)`;
- `prove.ts:99` → `fetchMembers(mode, "attest:<issuer>")`
  (`lib/zk/validatorClient.ts:83-85`, plain `fetch`, `cache: "no-store"`,
  `validatorClient.ts:53-62`);
- `prove.ts:114` → `verifyRootAgainstHistory` (`lib/zk/rootHistory.ts:128-
  141`): `fetchValidatorKey()`, `fetchHistory(mode, "attest:<issuer>")`,
  `anonymousHead(mode, "attest:<issuer>")`.

Then `enqueueSubmission` (`gate.ts:174`) queues the proof for
[30 s, 15 min] later (`config.ts:58-59`). The scheduled tick never fetches
an attest tree, so `GET /zk/members?tree=attest:mock` from a client is,
unlike the gate-tree fetch, *only* ever the prelude to that client's
attestation proof.

**Operator's view.** Client C (its IP under `direct`; the same process that
signs its state writes) fetches `attest:mock` members + history at T.
An anonymous `attestation` proof for persona P lands in `attest:mock` at
T + U[30 s, 15 min]; `zk_attestation_claims(P, mock, E)` is written
(`zk.js:546-547`). P's candidate roots = the attested roots whose client
fetched `attest:mock` in the last 15 minutes — in the fixture exactly one
(the decoy crowd is envelopes, not clients: `scripts/accept-z9.mjs:229-234`
posts decoy attestation envelopes after one harness-side members read at
line 226); in a deployment, the clients that prepared that tree in the
window. This is attack-1 finding 3, verbatim, for the new claim kind.

**Severity:** MED — NARROWING to LINKAGE for the attestation claim; the
Gate 0 property ("the fetch cadence carries no information about proof
activity", `prefetch.ts:12-13`) is false for every tree but the gate's.
**Confidence:** HIGH on the code path (unambiguous); the candidate-set
arithmetic in a deployment is inference.
**Already admitted?** NO. §3's A-PREPARE-BURST (SECURITY-POSTURE.md:197-204)
still reads "a fixed-schedule prefetch … is the next step and is not
built" — stale for the gate tree and silent on attest trees; REPORT-Z2
claims every client fetches "the gate tree's leaves" on the cadence,
which is the point: only the gate tree's.
**Fix.** Prefetch every tree this device may prove against on the same tick
— the gate tree plus each `attest:<issuer>` the device holds an
attestation for (`GET /zk/attestations?commitment=` tells it which; or all
`attest:*` trees from `/zk/trees`, fetched by every client whether or not
attested, which is the property that matters) — and refuse to prove any
claim without a snapshot for its tree (fail closed; today the fallback is
silent). Name it until then: **A-Z3-ATTEST-PREPARE-BURST**.

---

### 4. Re-issuance rotates a branch of the same seed; the "compromised secret" bound holds only for a leaked branch, and the recovery scan it leans on does not exist

**Claim.** `zkIdentitySeedAt(seed, index)` = `HKDF(seed,
"zk-identity/1/reissue-<index>")` (`lib/crypto/kdf.ts:81-84`); the device
moves index by `setZkIdentityIndex(index + 1)` (`lib/zk/identity.ts:45-50`,
`lib/identity/keystore.ts:212-230`); `reissueIdentity` is revoke → bump →
register (`lib/zk/registration.ts:104-111`). The seed is unchanged. So the
statement "a compromised secret is therefore usable for at most the rest
of the epoch plus the grace" (A-Z3-REVOKE-EPOCH-GRACE,
SECURITY-POSTURE.md:532-536) is true of the material that actually leaves
the keystore module — the branch master that crosses the IPC pipe to the
prover (`lib/zk/transport/live.ts:108`, `zkMasterHexForProver()`,
`identity.ts:91-93`) and the secret scalar (`identity.ts:82-84`) — and false
of the seed (`.keystore/root.json`, `keystore.ts:31-32, 146-148`; the
passphrase-sealed escrow copy on the validator, A-ESCROW-BLAST-RADIUS
§3:290-294; the §8 topology). A seed holder derives index i+1 the moment
the honest device publishes it — `/zk/registration` and `/zk/members` are
public (`zk.js:660-672, 700-708`) — and proves as the root under the new
commitment indefinitely; the honest device cannot detect that its new
branch is shared, and "revoke again" only hands the attacker index i+2.
The doc states the derivation as a recovery feature ("indices derive
deterministically from the seed", §11:506-507) without its flip side.

**The scan.** A-Z3-INDEX-FILE (§3:541-545) says a device that loses the
index file "derives index 0 and will find its commitment revoked; the
recovery scan (bounded to 1024 indices) is the way back." There is no
scan: `zkCommitmentAt` (`identity.ts:52-55`, "Gate 3 recovery helper") has
no caller; the only `1024`s are the bound checks (`kdf.ts:82`,
`keystore.ts:224`); `lib/zk/status.ts` and `app/api/recovery/route.ts`
contain nothing that walks indices. A recovered device at index 0 gets
`409 this commitment was revoked … re-issue` from `register`
(`zk.js:401-403`) and stays there. (Repeated manual `reissue` calls would
walk the indices up by accident — `revoke` answers `existing` for an
already-revoked row, `zk.js:443-444`, and `register` answers `existing`
for the already-registered next commitment, `zk.js:401-404` — but nothing
does that, and the doc describes a scan.)

**Severity:** MED — a posture line that bounds the wrong thing, plus a
recovery mechanism that is described and absent. No new linkage.
**Confidence:** HIGH (derivation and absence of callers are both direct).
**Already admitted?** PARTIALLY. §8 says a seed holder can recompute every
past nullifier; the FORWARD consequence for re-issuance is not stated.
A-Z3-INDEX-FILE is stated and wrong about the mechanism.
**Fix.** **A-Z3-REISSUE-SCOPE**: "re-issuance is a branch rotation under an
unchanged seed; it addresses a leaked prover branch, not a leaked seed —
a seed compromise has no rotation story (a new seed is a new account)."
Either build the index scan (walk `zkCommitmentAt(i)` against
`/zk/registration` until an active one is found, then `setZkIdentityIndex`)
or drop the sentence from A-Z3-INDEX-FILE. If branches should survive a
seed leak, derive them with fresh vault-stored entropy instead — a design
choice with a recovery cost, to be made explicitly.

---

### 5. `zk_fork_claims` is the one presence log that is never pruned, and it tags the persona's kind

**Claim.** A-PRESENCE-LOG (§3:230-234) and A-ELIGIBILITY-VISIBLE say the
who-proved-what store is pruned to the current epoch and its grace.
`zk_eligibility` is (`zk.js:558`), `zk_attestation_claims` is (`zk.js:548`);
`zk_fork_claims` never is — no DELETE anywhere but the fixture reset
(`zk.js:903`) — and its primary key is (mode, persona, commit) with the
epoch as data (`validator/migrations.js:331-340`). `/zk/fork-claim` answers
for any epoch (`zk.js:761-763`). `zk_nullifiers.claim_kind` (`zk.js:526-
532`, also permanent by design) tags the same nullifier as `fork-continuity`.
The operator therefore holds, forever: "persona N is a fork, created at
epoch E, whose prover was in tier-T then" — for every fork ever made. With
Finding 1 that row is already attributed; without it, it is a permanent
"this persona started life as a fork at E" bit that the eligibility store
deliberately forgets after two epochs.

**Severity:** LOW — a permanence exception to a stated pruning discipline.
**Already admitted?** NO (the pruning statement implies the opposite).
**Fix.** Prune fork claims like eligibility, or keep them only as long as a
holder could reasonably check (a stated window) — and say so
(**A-Z3-FORK-CLAIM-PERMANENT** if kept).

---

### 6. The attestation scope omits the issuer: one attestation proof per persona per epoch, across all issuers

**Claim.** The `attestation` scope is `layers/zk-scope/v1|attestation|
<epoch>|<personaId>` — feature, epoch, persona (`lib/zk/scopes.ts:106-109`,
`validator/zk.js:163, 171-176, 198`); the issuer is in the message and the
tree, not the scope. The nullifier is therefore the same for `attest:A`
and `attest:B` in one epoch, and the replay store keys on the nullifier
alone (`zk.js:524-525`). The second issuer's proof is a 409 on the plain
door and a constant-shape `replay` on the anonymous one; the client's
queue treats `replay` as "already submitted" (`lib/zk/anon/queue.ts:131-
133`), so nothing surfaces. Meanwhile `zk_attestation_claims` is keyed
(mode, persona, issuer, epoch) (`migrations.js:351-358`) and
`requestAttestationProof` keys the wanted set by `personaId|attest:issuer`
(`gate.ts:147`) — both built for many issuers per epoch.

**Severity:** LOW — a functional gap in the scaffold, not a privacy hole
(it caps the per-epoch intersection at one issuer, if anything; but it
spreads a multi-issuer persona's proofs across epochs, one presence-log
row per issuer per epoch).
**Already admitted?** NO.
**Fix.** Put the issuer in this entry's scope string (a reviewed registry
change with its linkage line, duplicated in `validator/zk.js`) — or state
"one issuer per persona per epoch" as the semantic.

---

### 7. The proof-history budget counts the fork's partition twice

**Claim.** The budget predicate is `claimKind|tree|gateId`
(`lib/zk/budget.ts:27-29`). A fork claim is `fork-continuity|tier-2|foryou`
(`gate.ts:137`); the tier claim the next home render queues for the same
persona is `tier-membership|tier-2|foryou` (`gate.ts:125`; the render path
`app/(main)/home/page.tsx:76-79`; the "not downgraded" guard at
`gate.ts:122-124` protects only a *pending* fork claim, and once the tick
has consumed it the next render marks the persona wanted again). Same
tree, same gate, one partition visible to the operator — two of the
default two slots (`config.ts:38`). The persona's first epoch then refuses
any attestation proof at the budget stage (`prove.ts:136-141`).

**Severity:** LOW — a counting error in the F2b mitigation that fails
closed (it over-refuses, never under-refuses).
**Already admitted?** NO.
**Fix.** Reserve on `(tree, gateId)` for the two kinds that partition on
the tree, or treat `fork-continuity` and `tier-membership` on one tree as
one slot.

---

### 8. INFO — smaller observations, each grounded

- **No validator unit test covers Gate 3.** `validator/test/validator.test.js`
  contains no `fork-continuity`, `attestation` or `revoke` test (grep); the
  cross-kind substitutions in *Attacks that failed* are refused by the code
  but pinned by nothing — the "deliberate duplicate" of
  `expectedPublicValues` has no test that presents kind A's envelope as
  kind B.
- **The tree NAME is bound only through the root.** Neither the scope nor
  the message carries `p.tree` (`zk.js:189-195, 198`); the tree is checked
  by `hist.root === p.merkleTreeRoot` for the claimed tree
  (`zk.js:518-520`). Safe today because nested tier trees with an
  identical member set are the same set, and an attestation message
  carries `attest:<issuer>`; cheap to bind anyway.
- **The fork-claim upsert overwrites downward.** `ON CONFLICT … SET tree,
  tier, epoch, nullifier` (`zk.js:543`) records the LATEST proof's tier,
  where eligibility keeps `MAX(tier, …)` (`zk.js:554`). Self-inflicted
  only (the prover chooses the tree), but asymmetric.
- **A fork proof in a non-tier tree is accepted and records nothing.**
  `expectedPublicValues` does not require a tier tree for `fork-continuity`
  (`zk.js:187-189`); a proof in `valid` or `attest:*` passes, consumes the
  persona's fork nullifier for the epoch (`zk.js:526-532`), and writes no
  claim (`zk.js:540` requires `tierMatch`). Self-DoS only.
- **The attestation gateId is a free field.** `attest-<issuer>` is the
  client's convention (`gate.ts:150`); the verifier checks only the charset
  (`zk.js:475`) and records no gate for attestation claims. Harmless.
- **The fork route stamps the predecessor's proven tier on the new
  persona's in-memory record before any proof.** `route.ts:100`
  (`adapters.rep.tierFor(fromPersona)` — under zk, the old persona's
  proven tier) → `route.ts:124` (`tier` on the seeded map) → `route.ts:184`
  (returned). §11:493-495 ("the tier reaches the new persona ONLY through
  this proof") is true for the validator and the feed, not for the app's
  own summary (the A-ROOMS-SEED-TIER surface reads it).
- **A-PREPARE-BURST's text is stale** (§3:202-204 says the fixed-schedule
  prefetch "is not built"; Gate 0 built it for the gate tree).

---

## Attacks that failed

With the line that defeats each, for the rebuttal.

- **Presenting a `tier-membership` proof as `fork-continuity` (or the
  reverse).** The scope feature strings differ (`discovery-tier` vs
  `fork-continuity`, `zk.js:154-164`); the verifier re-derives the scope
  for the claimed kind and refuses on mismatch (`zk.js:198, 489`); in the
  live universe `hash(scope)` is a public signal the nullifier is bound
  to (`zk.js:219`, worker `semaphore-worker.mjs:114`), so the proof itself
  fails against the other scope. Fixture has no soundness by design
  (A-FIXTURE-SOUNDNESS) and is not evidence either way.
- **Presenting an `attestation` proof as a tier proof or vice versa.** Same
  scope argument; additionally the message carries `attest:<issuer>` in
  the third slot and the tree must be `attest:<issuer>` (`zk.js:190-193,
  479`), and a tier claim in an `attest:*` tree grants nothing
  (`zk.js:536, 550`).
- **Message collision across kinds.** Tier messages have 4 `|`-parts, fork
  and attestation 5; `personaId` is `[A-Za-z0-9_]` and `gateId`
  `[A-Za-z0-9_-]` (`zk.js:475`), so neither can contain `|`, `:` or forge a
  `fork:`/`attest:` slot; `fieldOf` domain-separates `scope` from `message`
  (`zk.js:165-170`, `lib/zk/hash.ts:77-79`).
- **Nullifier collision between the old and new persona of a fork, or
  between kinds for one persona.** Per-persona scopes with distinct
  feature strings (`scopes.ts:135-148`; `zk.js:171-176`); the in-process
  self-test iterates the whole registry including the two new entries
  (`lib/zk/selftest.ts:37-70`). Old and new differ in the persona slot;
  kinds differ in the feature slot.
- **Tampering `forkCommit`, `gateId`, `personaId`, `epoch` or `root` after
  proving.** All are inputs to the re-derived message/scope/challenge
  (`zk.js:178-202, 489`) and, for the root, to the signed-history check
  (`zk.js:518-520`); `accept-z8.mjs:130-150` exercises the forkCommit case.
- **Extra `forkCommit`/`issuer` on the wrong kind.** Refused before the
  binding (`zk.js:480-481`); z8 check 3 covers the tier+forkCommit case.
- **Proving against an empty attest tree (root "0").** Refused explicitly
  (`zk.js:522`); and infeasible in the live universe anyway, since a root
  of `0` would require a leaf of `0` (`zk.js:354-357`, LeanIMT root of an
  empty group) — Poseidon of a public key is not `0`.
- **Re-registering a revoked commitment; two active commitments per
  root.** `register` refuses the revoked row (`zk.js:400-405`) and any
  second active row (`zk.js:411-412`); the partial unique index
  (`migrations.js:359-361`, confirmed in the database's `sqlite_master`)
  backs it; the handler is synchronous end to end, so there is no check-
  then-insert race inside one process.
- **A revoked leaf proving past the boundary.** Excluded from the next
  epoch's registrations (`zk.js:259-266`) and the grace ends one epoch
  later (`zk.js:516-517`) — the bound A-Z3-REVOKE-EPOCH-GRACE states, for a
  leaked *branch* (Finding 4 is about the seed).
- **Reaching the mock issuer without `ZK_DEV_HOOKS`.** `POST /zk/dev/attest`
  is `devOnly` (`zk.js:793-794`); the app's `attest` action is in
  `DEV_ACTIONS` (`app/api/zk/route.ts:57, 76-78`); no other path inserts
  into `zk_attestations`.
- **An issuer name that collides with a tier tree or escapes the
  regexes.** `attest:` prefix plus `[a-z0-9-]{1,32}` (`zk.js:96-98`);
  `attest:tier-2` is a distinct tree from `tier-2`; the gateId
  `attest-<issuer>` fits the 40-char gateId charset.
- **Inserting an attestation mid-epoch to move a frozen tree.**
  `issued_epoch < epoch` (`zk.js:316`) batches it to the next epoch, and a
  frozen epoch is reconstructed from signed placements, never from
  `zk_attestations` (`zk.js:284-304`). (The `INSERT OR REPLACE` at
  `zk.js:805` can re-stamp `issued_epoch` on a re-attest, which only ever
  removes a leaf from a not-yet-built epoch — dev-hook only.)
- **Recovering old → new from the `forks` record's address.** Fixed in
  this pass: one opaque `_` record (`store.ts:419-426`; database row
  `forks | _`). The roster beside it is Finding 1.
- **Reading the fork nonce off the validator.** Only inside the sealed
  `forks` value; handed out only by the resolve path to a carried holder
  (`fork/route.ts:54`); z8 check 6 and z9 check 6 both look for it.
- **Persona ownership as a soundness check.** Absent on the validator by
  design (A-Z2-ROSTER-ASSERTED, A-PERSONA-ROOT-BINDING) — which is why
  Finding 2 is an overclaim rather than a bug.

---

## Suggested fixes (brief, not a design)

1. **Seal the roster's addresses** — `identityRoster` as one opaque record
   like `rootRoster`, or HMAC every vault address in `encryptNamespace`;
   assert on `row.key` for every vault namespace in z9. (Finding 1.)
2. **Rewrite §11's fork paragraph and `scopes.ts:92-94`**; add
   A-Z3-FORK-CLAIM-IS-A-VOUCH; make the holder-side check require the
   resolved forward pointer, never the claim alone. (Finding 2.)
3. **Snapshot every provable tree on the tick, and fail closed without a
   snapshot** — no fetch-fallback in `prepareAndProve` on the product path.
   (Finding 3.)
4. **A-Z3-REISSUE-SCOPE**, and either build the index scan or delete the
   sentence that describes it. (Finding 4.)
5. Prune `zk_fork_claims`, put the issuer in the attestation scope, and
   count the fork's partition once. (Findings 5–7.)
6. Add validator unit tests that present each kind's envelope as each
   other kind and assert the refusal reason. (INFO.)

---

## Verdict

The verifier's claim binding for the three kinds is correct and I could
not substitute, replay or relabel a proof across kinds, personas, epochs
or trees without the verifier refusing at a line I can cite; the
revocation index is real and the mock issuer is fenced. What is wrong is
one level up. The fork-continuity proof is a tier proof wearing a label —
sound as that, but §11 sells it as a proof of identity continuity, which
any tier-2 leaf can forge for any (old, new) pair a holder is told to
check; the attestation kind silently falls off the fixed-schedule prefetch
and brings the Gate 0 beacon back for its tree; re-issuance is a branch of
the seed it does not rotate, and the recovery scan it leans on is a
sentence. And the fork route — the feature whose whole point is that the
validator never learns old → new — hands the validator a device-signed
document whose plaintext keys are the device's minted personas, eight
milliseconds after the sealed fork record that this pass carefully
fixed, on the same request, unseen by the linkage test because it checks
values and not addresses. Finding 1 needs a fix before this pass can claim
its own property; Findings 2–4 need honest assumption lines; the rest are
housekeeping. The habit that caught the `forks` address should be applied
to every namespace once, mechanically, rather than one namespace per
review.
