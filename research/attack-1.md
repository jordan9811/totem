# ATTACK-1 — adversarial review, lens: metadata & transport linkage

**Adversary:** the OPERATOR. Runs the validator, hosts the trees, runs the
transport, and (per the deployment as coded) runs the Next process too.
**Goal of this pass:** link two personas of one root, or narrow a proof's
candidate set below the anonymity floor, without breaking any cryptography.
**Method:** read the paths end to end; where the claim was checkable against
committed state, I checked it against `validator/layers.db` (read-only).
**Not done:** no servers run, no timings measured, nothing fixed, no code
changed. Line numbers are as of this read.

---

## Summary

The proof layer is sound as described. The scope registry is correct, the
nullifier construction does not collide siblings, the constant-shape
response is genuinely constant on every path including the
decapsulation-failure path, the header allowlist is a real allowlist, and
the submission socket is genuinely isolated. I tried to break those and
could not (see *Attacks that failed*).

The privacy dies somewhere else, three times over, and none of the three is
in SECURITY-POSTURE.md:

1. **The ZK layer's own client-side private state is persisted to the
   validator with PLAINTEXT record addresses, and the address of the
   proof-history budget IS the personaId.** Two personas of one root sit
   side by side, in the clear, in `adapter_state`, in the same SQLite file
   as `zk_nullifiers` — written in a single device-signed request. This is
   verified against the committed database, not inferred. No timing
   analysis, no IP, no relay assumption required. (Finding 1.)
2. **Every anonymous submission is bracketed by an identified,
   device-signed write from the same root, ~150 ms later**, because
   `drainQueue` flushes the queue namespace immediately after
   `submitAnonymous` returns and the anon endpoint's own response floor
   fixes the ordering. The jitter, the relay, and OHTTP are all bypassed by
   a signal the client itself emits on the authenticated channel.
   (Finding 2.)
3. **The whole preparation burst rides the identified channel at offset ~0
   from the motivating action**, while only the submission is jittered.
   `prove.ts` names this exact hazard for the challenge value and then
   commits it with four other calls. (Finding 3.)

Plus: the mitigation the posture doc credits for F2b (the proof-history
budget) does not bind the thing F2b describes (Finding 4), and the anon
channel's output is a public, cross-origin-readable, pollable feed
(Finding 5).

Findings 1–3 are each independently sufficient to link siblings. Finding 1
requires nothing but a SQL query.

---

## Findings

### 1. The vault encrypts values, not addresses — and `zkProofBudget`'s address is `personaId:epoch`

**Claim.** The operator can link every persona of a root by reading one
plaintext column of its own database. The ZK layer's private client state
is stored on the validator "encrypted", but only the record *values* are
sealed; the record *ids* are preserved verbatim as the storage key, and the
proof-history budget's id is `${personaId}:${epoch}`. All of a root's
personas arrive in one `PUT`, which under `LAYERS_REQUIRE_SIG=true` is
signed by that root's device-auth chain — so the grouping is not merely
co-located, it is cryptographically attributed to the root.

**Observation path.**
`SELECT key FROM adapter_state WHERE namespace='zkProofBudget'` — or just
read the `value` blob, which repeats the id in cleartext.

**Code evidence.**
- `lib/zk/budget.ts:16-18` — `budgetKey = \`${personaId}:${epoch}\``.
- `lib/zk/budget.ts:55-56` — `state().zkProofBudget.set(key, …)` then
  `await persistNs("zkProofBudget")` — written on the prove path, before
  any proof exists.
- `lib/adapters/mock/store.ts:639-641` — `dump: (s) =>
  Object.fromEntries(s.zkProofBudget)`; the map key becomes the document key.
- `lib/vault/vault.ts:44-67` — `zkProofBudget`, `zkRootAnchor`, `zkQueue`
  are VAULT_NAMESPACES; the comment at 57-66 states the intent exactly:
  *"The budget maps which persona proved which predicate (the exact
  intersection data F2b warns about) … None of it may sit in plaintext on
  the operator's disk."*
- `lib/vault/vault.ts:87-97` — `encryptNamespace`: `for (const [id, record]
  of Object.entries(plaintext)) out[id] = encryptRecord(key, ns, id, record)`.
  **The id is the loop's output key, unencrypted.**
- `lib/crypto/vaultCipher.ts:39-47` — `encryptRecord` returns
  `{ v: 1, ns, id, nonce, ct }`. `ns` and `id` are cleartext fields of the
  stored object (they are the AAD, and the AAD is not secret).
- `lib/adapters/mock/persist.ts:229-251` — `flushVault` PUTs
  `{entries}` to `/state/${ns}`, with `x-layers-device` /
  `x-layers-counter` / `x-layers-sig` when `LAYERS_REQUIRE_SIG=true`
  (`persist.ts:183-197`).
- `validator/server.js:332-361` — `PUT /state/:namespace` →
  `INSERT INTO adapter_state (namespace, key, value, updated_at)` with
  `key` = the plaintext id.

**Evidence from the committed database** (`validator/layers.db`, read-only
byte scan):

```
zkProofBudget | persona_viewer_alt:82803  | {"v":1,"ns":"zkProofBudget","id":"persona_viewer_alt:82803","nonce":"7eacb480…"
zkProofBudget | persona_viewer_main:82803 | {"v":1,"ns":"zkProofBudget","id":"persona_viewer_main:82803","nonce":"940308d8…"
```

`seed/data/viewer.json` gives `rootId: "root_viewer"`, personas
`["persona_viewer_main", "persona_viewer_alt"]` — the two rows above are
the two personas of one root, at the same epoch. Further rows carry
`persona_viewer_main:82804 … :82813`, so the grouping is longitudinal
across epochs, not a single-epoch accident. `zkRootAnchor` keys are
`fixture:valid` (mode:tree, also plaintext). `zkQueue` keys are random
(`zkq_<hex>`), so that namespace leaks only the row count and the flush
time — see Finding 2.

**Severity:** LINKAGE OF SIBLINGS — complete, offline, no analysis needed.
**Confidence:** HIGH. Verified against on-disk state, not inferred.
**Already admitted?** NO — and the code comment at `vault.ts:57-66` asserts
the opposite. SECURITY-POSTURE §2's list of what the operator can still do
does not contain it.

**Why this is worse than any admitted assumption.** Every admitted residual
(C1 curation, C5 attribution index, C10 join-epoch, A-TRAFFIC, F2b) is a
statement about what the operator observes *at or around a proof*. This is
the client handing the operator the persona-grouping table directly, on the
authenticated channel, at prove time, in the namespace whose stated purpose
is to prevent exactly that. The anon channel's careful hygiene — no logs,
`WITHOUT ROWID`, no timestamps finer than the epoch (`migrations.js:146-188`)
— is measuring the wrong table.

---

### 2. Every anonymous submission is bracketed by an identified, device-signed write from the same root

**Claim.** The operator does not need the client's IP, the relay's
cooperation, or the jitter window. For each anonymous submission at time
S, the same root emits an identified `PUT /state/zkQueue` at ≈ S + 150 ms.
Pairing them is a timestamp join.

**Observation path.** Watch `POST /zk/anon/submit` (or the OHTTP gateway)
and `PUT /state/zkQueue` on the same validator process. The anon endpoint's
fixed 150 ms response floor makes the ordering deterministic rather than
racy: the client cannot flush until its send resolves.

**Code evidence.**
- `lib/zk/anon/queue.ts:111-127` — `drainQueue`: `for (const q of due) {
  const r = await submitAnonymous(q.envelope) … }` then, after the loop,
  `if (due.length) await persistNs("zkQueue")`.
- `lib/adapters/mock/store.ts:661-674` — `persistNs` → `flushVault` for
  vault namespaces.
- `lib/adapters/mock/persist.ts:229-251` — `flushVault` → `PUT /state/zkQueue`
  on the ordinary pooled `fetch`, device-signed under `LAYERS_REQUIRE_SIG`.
- `validator/anon.js:34, 174` — `responseMs()` default 150;
  `await sleepUntil(t0 + responseMs())` before responding. Every anon
  request occupies ≥150 ms, so the flush lands after it, reliably.
- `lib/zk/anon/queue.ts:64-65` — the *enqueue* side flushes too, so there is
  a second identified write at prove time (Finding 3).

The queue namespace is vaulted, so the operator does not read the envelope
from it. It does not need to: it reads the *event*. The row count for
`namespace='zkQueue'` is monotonic (drained items are never deleted —
`queue.ts:118-125` mutates `status` and re-`set`s), so the count is the
root's lifetime proof count, and `updated_at` (rewritten on every row by
the delete-then-insert at `server.js:349-354`) is the timestamp of the most
recent send.

**Severity:** LINKAGE OF SIBLINGS. Two personas of one root produce two
anon submissions; both are bracketed by writes from the same signed device.
**Confidence:** HIGH on the mechanism (the code is unambiguous). MED on the
exact clock skew — I did not measure it; the 150 ms floor bounds it from
below and the flush is a single small local PUT.
**Already admitted?** NO. SECURITY-POSTURE §4 condition 3 credits jittered
submission; A-TIMING's residual is about the *window size*, not about the
client emitting a signed beacon at send time. `lib/zk/anon/README.md:45-52`
("the relay hides *who*, the jitter hides *when*") is falsified by this
path: the client tells the operator both, itself, on the other channel.

---

### 3. The preparation burst is unjittered, on the identified channel, at offset ~0 from the motivating action

**Claim.** The jitter decorrelates the *submission*. It does not touch the
*preparation*, which is 4–7 identified requests fired synchronously with
the motivating render. The operator therefore holds two point processes —
"root R prepared a tier-T proof at T" and "persona P claimed tier-T at
T + U[30 s, 15 min]" — that are the same process shifted by a bounded
random delay. Cross-correlation over hours resolves P→R; and two personas
of one root emit their prepare bursts from the same source, so they group
even before R is resolved.

**Observation path.** Per motivating action, on the ordinary channel:
`GET /zk/epoch`, `GET /zk/validator-key`, `GET /zk/history?tree=tier-T`,
`GET /zk/members?tree=tier-T` (the entire leaf list, `cache: "no-store"`),
`GET /state` on the first hydrate, then `PUT /state/zkProofBudget`,
`PUT /state/zkRootAnchor`, `PUT /state/zkQueue`. The three PUTs are
device-signed.

**Code evidence.**
- `app/(main)/home/page.tsx:67-81` — every For You render for one of the
  account's own personas calls `requestEligibility(personaId)`.
- `lib/zk/gate.ts:92-119` — `setTimeout(…, 0)` then `prepareAndProve`
  immediately; `inFlight` prevents concurrency only, not repetition.
- `lib/zk/prove.ts:63-89` — `fetchEpoch`, `fetchMembers`,
  `verifyRootAgainstHistory`, `reserveBudget`, in that order, all before
  any proof exists.
- `lib/zk/rootHistory.ts:124-125, 133-142` — `fetchValidatorKey` +
  `fetchHistory`, then the anchor persist.
- `lib/zk/validatorClient.ts:53-62, 83-85` — every one of these is
  `cache: "no-store"`; nothing is reused across proofs.
- `lib/zk/prove.ts:98-101` — the authors' own words: *"The challenge is
  epoch-bound and derived locally: asking the validator for a challenge
  would be a 'I am about to prove' signal it could correlate."* The hazard
  is correctly identified and then committed four more times.

**Amplifier — the rate channel.** There is no "already proven this epoch"
check anywhere on the trigger path. `reserveBudget` returns `ok: true` for
a claim kind already counted (`budget.ts:47`), so every home render
produces a fresh proof, a fresh queue item, and a fresh anon submission;
the validator answers `409 replay` (`validator/zk.js:320-322`) and records
nothing new. The consequence is that **the arrival rate of persona P's anon
submissions equals the prepare-burst rate of root R**, indefinitely. Rate
correlation does not need a single clean match; it accumulates.

**What the design does right here, and why it isn't enough.** The Merkle
path is derived locally from the full member list rather than fetched per
commitment (`prove.ts:68-73`, `transport.prove(…, { members })`), so there
is no `GET /zk/placement?commitment=C` on the prove path — that endpoint
exists (`validator/zk.js:457-471`) but only `lib/zk/status.ts:88-89` calls
it, on the settings surface. Good. But `GET /zk/members?tree=tier-T` is
itself the "I am about to prove, at tier T" signal, and it is large,
distinctive, uncacheable, and on the identified channel.

**Severity:** NARROWING → LINKAGE. Instantaneous narrowing to "roots that
prepared in the last 15 minutes"; linkage under longitudinal correlation.
**Confidence:** HIGH on the mechanism. MED on how small the candidate set
gets in a large live cohort — that is arithmetic against real activity
rates I cannot compute here.
**Already admitted?** NO. A-TRAFFIC admits the peer IP *on the submission
path* under `direct`. F5b/A-TIMING is about the submission's offset from
the action. Neither covers traffic that is not on the anon channel at all.

---

### 4. The proof-history budget counts claim kinds, not partitions, and resets every epoch — so it does not bound the intersection it is credited with bounding

**Claim.** SECURITY-POSTURE §2 states the budget "bounds how many
candidate-set intersections a persona hands over." It does not. It counts
distinct `claimKind` strings per (persona, epoch), and there is exactly one
claim kind in the system.

**Code evidence.**
- `lib/zk/prove.ts:89` — `reserveBudget(req.personaId, epoch, req.claimKind)`.
- `lib/zk/budget.ts:43-57` — the counter is over distinct `claimKind`.
- `validator/zk.js:64` — `CLAIM_KINDS = ["tier-membership"]`;
  `lib/zk/prove.ts:36` — one entry in `SCOPE_FOR_CLAIM`. **The budget
  currently refuses nothing the system can produce.**
- `tree` and `gateId` are free parameters of `prepareAndProve`
  (`prove.ts:38-44`; `app/api/zk/route.ts:127-133`) and they are the
  *actual* partitioning public inputs: `validator/zk.js:323-339` records
  `tree` per nullifier and `tier` per (persona, gate, epoch). Proving
  `tier-2`, `tier-5` and `tier-9` for one persona is three distinct
  candidate-set partitions and **one** budget slot.
- `lib/zk/budget.ts:16` — the key includes `epoch`, and
  `validator/zk.js:59` sets the epoch to 6 h by default. The budget resets
  four times a day; F2b's attack is explicitly lifetime-longitudinal.
- `lib/zk/privacy.ts:98-117` — label condition 6 certifies the budget with
  a self-test on a synthetic persona (`__zk_privacy_selftest__`, epoch -1)
  and fabricated kinds `selftest-1..3`. It proves the counter counts. It
  cannot prove the counter bounds a partition, because no real partition
  passes through it.

**Related test vacuity.** Label condition 3 ("decorrelation test passed
this build", `privacy.ts:74-82`) is stamped by `scripts/accept-z1.mjs:159-168`,
which calls `enqueueSynthetic` with test-supplied `motivatedAts` and
measures `notBefore - motivatedAt`. Synthetic items are created with
`status: "refused"` so `drainQueue` never sends them
(`lib/zk/anon/queue.ts:71-95, 109`). The test therefore measures the RNG's
spread, never the wire, and by construction cannot see the prepare burst at
offset 0 (Finding 3) or the post-send flush (Finding 2).

**Severity:** SOUNDNESS OF A CLAIMED MITIGATION → NARROWING.
**Confidence:** HIGH.
**Already admitted?** NO — worse than admitted. The posture doc presents
the budget as the applied mitigation for F2b, with a specific number
("2 distinct predicates per persona per epoch, hard refusal").

---

### 5. `/zk/eligibility` without a personaId is an unauthenticated, `Access-Control-Allow-Origin: *` dump of persona → proven tier, and polling it is a submission-arrival oracle

**Claim.** The anonymous channel's output is world-readable at whatever
time resolution the observer chooses to poll. A third party — not just the
operator — learns the roster of personas that proved this epoch and the
arrival time of each anonymous submission. That is the quantity the jitter
exists to hide, published.

**Code evidence.**
- `validator/zk.js:425-431` — `GET /zk/eligibility` with no `personaId`
  returns `eligibilityMap`, i.e. `{ epoch, tiers: { personaId: tier } }`
  for every persona (`zk.js:354-362`).
- `validator/server.js:26-32` — `Access-Control-Allow-Origin: *` on every
  route, set before the anon mount and before `express.json()`. Any page
  the user visits can read this cross-origin if the validator is reachable.
- `validator/zk.js:433-440` — `GET /zk/members` likewise returns the full
  commitment list for any tree, unauthenticated.

The stored row has only epoch granularity (`migrations.js:175-186`), which
is the right discipline *at rest* — but a poller does not need the stored
timestamp; the transition from absent to present is the timestamp.

**Severity:** NARROWING, and a claim-scope problem: the design treats
"personaId is visible to the validator" as the admitted cost, and then
makes it visible to everyone with a fine-grained clock attached.
**Confidence:** HIGH on the endpoint behaviour; MED on impact, which
depends on whether the validator is publicly reachable in the intended
deployment.
**Already admitted?** PARTIALLY. §2 (F2b) admits the validator reads
personaId on every proof. It does not admit a public, pollable,
cross-origin-readable feed of the results.

---

### 6. Constant-shape is applied to the response only; the request is unpadded and the relay does no mixing

**Claim.** A-RELAY-THIRD-PARTY is admitted as "collusion is not
machine-checkable." The stronger true statement is that **no active
collusion is required**: an ordinary access log of `(client IP, timestamp,
byte length)` at the relay joins 1:1 against the gateway's plaintext
record, because the design contributes no padding, no batching and no
reordering to make the join ambiguous.

**Code evidence.**
- `lib/zk/anon/submit.ts:26` — the body is
  `JSON.stringify({ envelope })`, unpadded. Proof points, root, scope,
  message and nullifier are variable-length decimal strings, so the length
  is effectively a per-submission serial number.
- `lib/zk/anon/ohttp.ts:70-75` — the encapsulated request is
  `hdr ‖ enc ‖ ct`, and AEAD preserves length + 16. The exact size crosses
  the relay.
- `scripts/lib-ohttp-relay.mjs:40-50` — the reference relay forwards each
  POST immediately, individually, one request in / one request out.
  (It is honestly labelled operator-run and non-private at lines 11-12.)
  A real third-party OHTTP relay behaves the same way — OHTTP is not a mixnet.
- `validator/anon.js:106-131` + `migrations.js:155-163` — one long-lived
  X25519 gateway key, `id = 1`, no rotation path. Retained ciphertext is
  retrospectively decryptable on key compromise.

Note the asymmetry: 256-byte constant responses and a 150 ms floor protect
the leg the operator already knows the answer to; the leg the relay sees is
left variable.

**Severity:** NARROWING; a materially worse framing of an admitted
assumption.
**Confidence:** HIGH on the code, MED on operational impact.
**Already admitted?** PARTIALLY — the *conclusion* ("only a non-colluding
relay removes the IP") is admitted; the *threshold* (a passive log
suffices, no collusion needed) is not.

---

### 7. The response timing floor is one-sided, and two deterministic paths blow past it

**Claim.** `sleepUntil(t0 + 150)` is a floor, never a cap. Two code paths
exceed it predictably, making those requests distinguishable on the wire
from every other outcome.

**Code evidence.**
- `validator/anon.js:77, 174` — `sleepUntil` clamps to `Math.max(0, …)`;
  work longer than the floor is simply served late.
- `validator/zk.js:314` — `verifyAndRecord` calls `currentTrees(db, mode)`
  inside the request. On a per-epoch cache miss this builds 11 trees and
  Ed25519-signs one placement per member per tree
  (`zk.js:198-217`) — O(11·N) signatures, synchronously, on the **first
  submission of every epoch**.
- `validator/zk.js:299` — LIVE `verifyProof` cold-loads snarkjs and the
  artifacts on the first call after a restart.

**Severity:** NARROWING (weak — it marks an epoch boundary, not a user).
**Confidence:** MED-HIGH on the mechanism; magnitude unmeasured.
**Already admitted?** NO, but low value.

---

### 8. The split-view anchor is stored on the server it exists to catch, and its write cadence is observable

**Claim.** The anchor value is encrypted, but its address and its write
time are not, so the operator learns which trees each root anchors and
exactly when it last advanced — i.e. the freshness boundary inside which a
forked history still satisfies `anchorSeen`.

**Code evidence.**
- `lib/zk/rootHistory.ts:100-102` — `anchorKey = \`${mode}:${tree}\``, the
  plaintext record id (confirmed in the DB as `zkRootAnchor | fixture:valid`).
- `lib/zk/rootHistory.ts:133-142` — the anchor is advanced and persisted on
  every successful root check, i.e. on every prove attempt.
- `lib/zk/rootHistory.ts:87-96` — detection requires the served window to
  contain the anchored hash; the operator knows when the anchor last moved,
  which bounds how far it can rewrite undetected.

**Severity:** NARROWING; strengthens the A-SPLIT-VIEW residual.
**Confidence:** HIGH on the observable, MED on exploitability (the anchored
*hash* stays encrypted).
**Already admitted?** PARTIALLY — A-SPLIT-VIEW admits the client only
checks its own anchor. It does not admit the anchor's storage location and
write cadence are the operator's.

---

### 9. Structural: the "client" is server-side, and the topology assumption that makes any of this private is not in SECURITY-POSTURE.md — though the code says it is

**Claim.** Every module in the ZK layer is `import "server-only"`, and the
root seed sits in plaintext on the same host. Whoever holds
`.keystore/root.json` can recompute, offline and retroactively, the
nullifier for every `(feature, epoch, personaId)` and match it against
`zk_nullifiers` / `zk_eligibility`, attributing the entire historical proof
record with no timing analysis at all. In a hosted deployment that party is
the operator. Whether the deployment is hosted is the single most
load-bearing assumption in the design, and it is asserted only in a code
comment that cites a document not containing it.

**Code evidence.**
- `lib/zk/prove.ts:1`, `lib/zk/identity.ts:1`, `lib/zk/anon/*.ts:1` —
  `import "server-only"` throughout.
- `lib/identity/keystore.ts:30-31` — `.keystore/root.json`;
  `keystore.ts:55-60` — `rootSecretHex` stored as plaintext JSON.
- `lib/identity/keystore.ts:200-206` → `lib/zk/identity.ts:60-62` —
  seed → `zkMasterBytes` → Semaphore `secretScalar`.
- `lib/zk/scopes.ts:16-30` — the nullifier is
  `Poseidon(hash(scopeValue), secret)` with `scopeValue` derived from
  entirely public inputs. Given the secret, the whole nullifier space is
  enumerable.
- `lib/identity/keystore.ts:116-122` — `derivePersonaId(rootSecretHex,
  nonce)`; the nonces are in the same file, so the persona set to enumerate
  is right there.
- `lib/zk/transport/live.ts:9-14` — *"TOPOLOGY NOTE (the conservative call,
  stated in SECURITY-POSTURE.md): in this codebase the 'device' that holds
  the seed is the user-side Next process."* **SECURITY-POSTURE.md contains
  no such statement** — a grep for `topolog|user-side|device that holds the
  seed|browser` returns nothing.
- Secondary: `app/api/recovery/route.ts:83-99` stores a passphrase-sealed
  copy of that same seed **on the validator** (`flush("seedEscrow", …)`).
  The sealing is scrypt + AES-256-GCM (`lib/recovery/escrow.ts:20-46`), so
  this is an offline-grindable copy, not a plaintext one — but its
  compromise retroactively deanonymizes the entire nullifier history, which
  is a strictly larger blast radius than F9's admitted
  "`C_root ↔ account` is permanent and unrotatable." I did not audit the
  escrow flow this pass; flagging the pointer.

**Severity:** SOUNDNESS of the entire claim under a hosted deployment; and,
regardless of deployment, a documentation gap on the assumption everything
else rests on.
**Confidence:** HIGH that the code is as described; the finding is "the
assumption is unstated and mis-cited", not "the assumption is false."
**Already admitted?** NO.

---

### 10. `personas.root_id` — the operator already holds persona → root as a foreign key

**Claim.** Not a new capability, but it makes the threat model incoherent
unless stated. Linking two personas of one root is
`SELECT root_id, id FROM personas` — one column, phase-1 schema, no ZK
layer involved.

**Code evidence.** `validator/db.js:16-24` — `personas(id, root_id TEXT NOT
NULL REFERENCES roots(id), …)`; `roots(id, fid, signer_uuid, …)` maps
straight to the Farcaster account.

The label text is narrow enough to survive this — "your persona's root is
hidden from this server **at the proof layer**" (`lib/zk/privacy.ts:22`) —
and SECURITY-POSTURE §1 says "That is the whole claim at the proof layer."
But §2's enumeration of what the operator can still do names the
`castHash → personaId` index (C5) and omits the stronger
`personaId → rootId` column that sits next to it. A reader who has been
told about the weaker leak reasonably infers the stronger one is gone.

**Severity:** NONE as a new capability; CLAIM-SCOPE gap.
**Confidence:** HIGH.
**Already admitted?** NO (C5 is adjacent but different).

---

## Attacks that failed

Scoped for the rebuttal — these are the ones I tried and could not make
work, with what defeated them.

- **Nullifier collision across siblings.** `lib/zk/scopes.ts:101-114`
  builds the scope in one place, requires a `personaId` for per-persona
  entries and *refuses* one for `onePerHuman` entries, in both directions.
  The linkage argument at `scopes.ts:16-30` is correct for the stock
  Semaphore preimage. `one-human-attest` is registered but unused, and its
  collision is documented as the feature. No path constructs a scope
  outside this module.
- **Constant-shape response, including the failure path.** I computed the
  byte lengths. `shapedBody` is exactly 256 for every outcome word
  (`anon.js:71-76`). The bhttp response is 293 (`1 + 2 + 31 + 258 + 1`),
  the outer is `16 + 293 + 16 = 325`. The decapsulation-failure branch
  allocates `randomBytes(288 + 36 + 4) = 328` and truncates to
  `outerLength() = 325` (`anon.js:198-212`) — **the lengths match**. This
  is correct and it is the kind of thing that is usually wrong.
- **Sneaking an identifying header past the gateway.** `ALLOWED_HEADERS` is
  a genuine allowlist applied with `toLowerCase()`
  (`anon.js:42-47`), and it is applied to the OHTTP *outer* request too
  (`anon.js:188`), not just the inner one. A browser-originated cross-origin
  POST — which CORS `*` would otherwise permit — carries `origin` and
  `user-agent` and is refused.
- **Cross-channel socket correlation.** `lib/zk/anon/client.ts:29-68` uses
  `node:http` with `agent: false` and an explicit header map; the module
  imports neither `persist.ts` nor `validatorClient.ts` by design
  (`client.ts:9-11`). I found no path that shares a connection between the
  anon submission and the envelope channel. (The *correlation* in Finding 2
  is temporal, not connection-level.)
- **RLN-style rate-limiter linkage (F1b).** Genuinely avoided. The PoW is
  stateless and bound only to the body bytes (`lib/zk/anon/pow.ts:30-34`,
  duplicated at `validator/anon.js:62-68`); there is no token, no per-root
  state, no second nullifier.
- **Insertion-order recovery from the nullifier / eligibility stores.**
  `migrations.js:164-186` rebuilds both `WITHOUT ROWID` keyed on the
  nullifier, and neither table carries a timestamp finer than the epoch.
  The claim in the module header is accurate for those two tables. (It is
  `adapter_state` that undoes it — Findings 1 and 2.)
- **`commitment → root` from a public endpoint.** `GET /zk/registration`
  deliberately returns registration status and epochs and never `root_id`
  (`validator/zk.js:396-408`).
- **"Give me my Merkle path" as a prove-time commitment ping.** The path is
  derived locally from the full member list (`prove.ts:68-73`);
  `/zk/placement?commitment=` is called only from the settings status
  surface (`lib/zk/status.ts:88-89`), not the prove path.
- **Mid-epoch tree mutation to move a root under an anchored client.** The
  frozen-epoch invariant reconstructs from signed placements and *throws*
  rather than serving a divergent root (`validator/zk.js:160-183`).
- **Registration from a persona context.** Refused on two independent
  signals — a view-as cookie or a `personaId` in the body
  (`app/api/zk/route.ts:36-43`) — and the registration is signed by the
  device-auth anchor, never a persona key (`lib/zk/registration.ts:56-61`).
- **Epoch tagging as a per-client watermark.** The operator controls the
  epoch clock (`validator/zk.js:127-135`), but `verifyAndRecord` accepts
  only `current` or `current - 1` (`zk.js:315-316`), so epoch-based tagging
  yields at most one bit. Not useful on its own.
- **Sub-floor proving as a permanent record.** Worth noting even though it
  is not a break: `prepareAndProve` does not check the anonymity floor —
  the floor is only a *label* condition (`privacy.ts:60-72`). A deployment
  below the floor still emits and permanently records proofs
  (`zk_nullifiers`, `zk_eligibility`) that are k-small by construction, and
  those rows survive into the period when the label later reads private.
  The label is honest about the present; the store is not scrubbed of the
  past. I file this as a design note rather than a finding because
  SECURITY-POSTURE §4 is explicit that the claim does not arm below the
  floor.

---

## Suggested fixes (brief, not a design)

1. **Hash the vault record addresses.** `encryptNamespace` should store
   `HMAC(vaultKey, ns‖id)` as the document key and carry the real `id`
   *inside* the sealed record (it is already the AAD; bind the hashed
   address instead). That closes Finding 1 with no protocol change and no
   read-site change, and it fixes `zkRootAnchor` and every other vaulted
   namespace at the same time.
2. **Never flush a vault namespace on the send path.** Mark the queue item
   sent in memory and flush on the next unrelated flush, or on a fixed
   heartbeat that is independent of send times. Anything that couples an
   identified write to an anonymous send re-creates Finding 2.
3. **Jitter the preparation, not just the submission** — or make it
   indistinguishable: fetch `/zk/members` and `/zk/history` on a fixed
   schedule for every client whether or not it intends to prove, cache them
   for the epoch, and prove from the cache. Right now the prepare burst is
   both unjittered and unnecessary-per-proof.
4. **Count partitions, not claim kinds.** The budget should reserve on
   `(personaId, tree, gateId)` — the actual public inputs that partition
   the candidate set — and it should accumulate across epochs, since the
   attack it is named for is longitudinal.
5. **Require a `personaId` on `/zk/eligibility`.** The unfiltered map is a
   convenience for one feed build; make it an authenticated, batched query
   for the caller's own visible personas, or accept that the anon channel's
   output is public and say so in the posture doc.
6. **Add the topology statement to SECURITY-POSTURE.md**, since
   `lib/zk/transport/live.ts:9-14` already tells readers it is there. State
   plainly: the process holding `.keystore/root.json` can recompute every
   nullifier and deanonymize the entire proof history offline; the privacy
   claim is void wherever the operator runs that process.
7. **Add `personaId → rootId` to §2's list** of what the operator can still
   do, next to C5. The narrow label survives it; the omission does not.
