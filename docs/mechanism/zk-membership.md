# ZK membership and tiers

Semaphore v4 proofs let a persona show "some registered root in tier T authorises me" without the validator learning which root. Today that hides nothing on any deployment.

::: danger Status: built, test data only
Stock Semaphore v4 proofs have run through the product path on the laptop rig, and both ZK passes closed after three adversarial reviews and four consecutive clean sweeps each. On the public preview the ZK universe is the fixture universe, where a "proof" is a tag under a public key, and the browser device has no live prover at all. The owner service could switch to the live universe, but that universe holds one root, under the floor of 50, and its operator holds the seed. The label reads DEMO everywhere. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'} {cite: notes/reports/REPORT-CUSTODY.md > "Stage 3 — the browser device — GREEN"}
:::

The verdict: the claim is narrow and the code enforces it carefully. A root registers one commitment. Each epoch the validator builds membership trees and signs their roots. A persona proves membership in a tree with a nullifier scoped to (feature, epoch, persona), so two personas of one root emit unrelated nullifiers, and the verifier re-derives every public input before it looks at the proof. What the proof hides is persona to root, at the proof layer, from the validator, and only when eight conditions hold. At least two fail on every deployment today: the third-party network relay (condition 1), and either a live universe (7, on the public preview) or a cohort of at least 50 roots (2, on the owner service). Topology, meaning that whoever holds the seed is not the validator's operator, is not one of the eight: nothing computes it. A one-person service whose operator set the relay's third-party flag and lowered the floor could show the label green while the claim is void. Everything else on this page is the parameters and what is left when the conditions do hold. {cite: SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"}

## At a glance

<ol class="flow">
  <li><strong>Register</strong>The root posts one commitment, signed by its device-auth anchor.</li>
  <li><strong>Trees</strong>At each 6-hour epoch the validator builds "valid", "tier-1" to "tier-10" and attestation trees, and signs their roots.</li>
  <li><strong>Snapshot</strong>Every device fetches the trees every 10 minutes, whether it will prove or not.</li>
  <li class="flow__us"><strong>Prove</strong>The message binds persona, gate, challenge and tree root; the nullifier is per persona per epoch.</li>
  <li><strong>Submit</strong>Padded to 4096 bytes, sent 30 seconds to 15 minutes later, with no cookie.</li>
</ol>
<p class="flow__note">On the public preview step 4 produces a fixture tag, not a Groth16 proof. The plumbing and the refusals are the same.</p>

## Parameters

| Parameter | Value | Set by |
|---|---|---|
| Circuit | Semaphore v4, Groth16 over BN254, tree depth 20 (up to 1,048,576 leaves) | `MERKLE_TREE_DEPTH` in `lib/zk/config.ts` |
| Setup | the 2025 re-ceremony after the BinaryMerkleRoot fix, 386 contributions; the verification key both verifiers use is pinned and hashed on load | `lib/zk/ceremony.ts` |
| Verifier | `snarkjs` 0.7.5 on the client and the validator | pinned dependency |
| Epoch | 6 hours on the validator; a client refuses any epoch under 1 hour | `ZK_EPOCH_MS`, `ZK_EPOCH_MIN_MS` |
| Grace | one epoch after the boundary (none for anon posts) | `validator/zk.js` |
| Root history | signed and hash-chained, 64 epochs kept | `ZK_HISTORY_WINDOW` |
| Floor | 50 roots per tree, counted by the client from the served leaves after rebuilding them to the signed root | `ZK_ANON_FLOOR` |
| Reach floor | 50 accounts in a reach tree before an anon post may prove it, and at least `ZK_ANON_FLOOR`; checked at the offer, the gate, the prover, the validator and the label ([Reach tiers](/mechanism/reach-tiers)) | `ZK_REACH_FLOOR` |
| Cohort churn | the client refuses if more than 20% of the cohort it last proved into is missing | `ZK_COHORT_MAX_CHURN` |
| Proof budget | 2 distinct predicates per persona per epoch, a hard refusal | `ZK_PROOF_BUDGET` |
| For You gate | tier 2 | `ZK_GATE_TIER` |
| Prefetch tick | every 600 seconds, plus or minus 25%, from a CSPRNG | `ZK_PREFETCH_MS` |
| Submission jitter | uniform between 30 and 900 seconds after queueing | `ZK_JITTER_MIN_MS`, `ZK_JITTER_MAX_MS` |
| Request, response | every request exactly 4096 bytes; every response 256 bytes, floor-timed | `ZK_SUBMIT_BYTES` |
| Rate control | 16-bit hashcash bound to the body bytes; no per-root state | `ZK_POW_BITS` |
| Drain | one due item per 5-second tick, chosen at random among the due items | `lib/zk/anon/queue.ts` |
| Re-issuance | identity branch index 0 to 1,024, deterministic from the seed; effective from the next epoch | `lib/crypto/kdf.ts` |

Sources for the security-relevant rows: the ceremony check and its gap, {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"} and the validator key. {cite: SECURITY-POSTURE.md > "7. Registration and the validator key, stated"}

## Nullifiers and scopes

`nullifier = Poseidon(scope, secret)`, with `scope = keccak256(toBeHex(x, 32)) >> 8`. For a per-persona claim, `x` encodes (feature, epoch, personaId): one persona emits one nullifier per feature per epoch, and two personas of one root emit two unrelated ones. The proof's message binds `personaId ‖ gateId ‖ challenge ‖ treeRoot`, and the validator re-derives scope, challenge and message from the persona, gate, epoch and root it is about to record, refusing any envelope that does not match before it verifies. Field elements are accepted only in canonical decimal form, so a nullifier string and its value are one-to-one. A nullifier is accepted once, ever, per universe. {cite: SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"}

The claim kinds are `tier-membership`, `fork-continuity`, `attestation` (scoped per issuer) and `anon-post`. The anon post is the one claim whose scope leaves the persona out and uses the posting window and a slot instead (`w<n>/s<i>`, persona launch P3), which makes it K per root per window: 4 by default, shared across personas. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"} The full table is rendered from source on [ZK scopes](/technical/scopes).

## Tiers

Reputation is root-level. The validator scores a root as the weighted sum of its reputation events: a cast created 1, a reply received 2, a like received 2, a recast received 3, a follow gained 5, a stewardship event 4. A root's tier is its decile, 1 to 10, among the roots with a positive score, ties rounding up; a root with no score is tier 1. The tree `tier-T` holds every active root at tier T or above, so the trees nest.

Under the ZK reputation binding (`ADAPTER_REP=zk`), a persona's tier anywhere in the app is the tier it proved this epoch, and 0, shown as "not proven", until a proof lands. The default binding is still the mock one.

**Who posts the events: the root's own device, and the score is self-asserted.** Every reputation event reaches the validator as `POST /events` from the root's device. The validator checks only that the signed envelope's anchor is the root's anchor. It accepts any of the six types with a count from 1 to 100, and a client-chosen `sourceId` that deduplicates only when present. A modified client can therefore award its own root any score, up to +500 a call with `follow_gained`, and reach tier 10, which unlocks For You, the anon tree (tier 2) and ad tier targeting. The ten-events-per-epoch stewardship cap is the client's, not the validator's. The fix is in code and not made: accept only `stewardship` from devices, cap its count at 10, and bind `sourceId` to the epoch. Not yet filed in the security posture. <!-- uncited-ok: read from validator/server.js POST /events and lib/influence/accrual.ts on 2026-10-07; the posture has no assumption id for it yet --> {cite: notes/reports/REPORT-Z2.md > "Gate 1 — every reputation read proof-mediated under zk"}

## What the validator learns, and what it does not

| It learns | Why |
|---|---|
| which anchor registered which commitment, and in which epoch | registration is signed by the root's device-auth anchor; insertion is batched to the next epoch so a newcomer's first proof does not stand out |
| the persona id on every proof, and which tree it proved, per epoch | the persona is in the clear in the message, and the eligibility store maps persona to proven tier because the feed needs it |
| which commitments sit in which tree | it builds the trees, and it can put any commitment anywhere |
| the submitting address, unless a non-colluding relay is in front | with the relay set to `direct`, the peer is the client |
| hour-grained timestamps on persona-addressed rows | coarsened from milliseconds after the envelope counter leaked creation order |

Sources: {cite: SECURITY-POSTURE.md > "2. What the operator can still do"} {cite: SECURITY-POSTURE.md > "Fixed in the pass"}

What it does not learn, when the eight conditions hold: which root produced a given persona's proof, from the proof alone, and whether two personas' nullifiers came from the same secret. That is the whole claim. Since migration 006 the validator also has no single table, column or index linking a persona to a root, and a check asserts it on every run. A join across tables remains: with the reputation poller on, `rep_events.source_id` (cast to root) joins the public cast-to-persona attribution index and `fcWrites.fid` (A-Z2-ATTRIBUTION-ACCOUNT-JOIN). The poller is off on both deployments. {cite: SECURITY-POSTURE.md > "10. What zk cost us: root-level block fan-out (ZK Pass 2, Gate 2)"}

## The label, and why it says DEMO

A surface may show the one-line claim "your persona's root is hidden from this server at the proof layer" only when all eight hold, computed in-process at read time: (1) a relay of type OHTTP or Tor attested as run by a non-colluding third party; (2) the cohort clears the client's floor and has not churned past the limit; (3) jitter is on, its self-test passes and the epoch is at least the client minimum; (4) the scope-collision self-test passes on this root's secret; (5) the verification key in use is the pinned one and the artifacts hash to their pins; (6) the proof budget refuses on a reachable path; (7) the universe is live; (8) the gate fallback is `none`. Attestation-gated surfaces add a ninth (the bucket clears the floor and its issuer is honoured) and the anon composer a tenth (the relay's Neynar key is distinct from the app's). Otherwise the surface shows the DEMO label, "not yet private", and names the failing conditions. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}

| Deployment | Fails at least | Even if they all passed |
|---|---|---|
| Public preview | 1 (no relay deployed) and 7 (fixture universe) | the seed is in the visitor's browser, which is the topology the claim needs |
| Owner service | 1, and 2 (one root in the live universe, under 50) | the operator holds the seed, so the claim is void by topology |

The owner service row is the honest summary of the ZK layer today: whoever holds the seed can recompute every nullifier for every (feature, epoch, persona) offline and match them against the stored ones, with no timing analysis. On a one-owner service the seed holder, the app and the validator are one person. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}

## Adversary model

**A curious validator** keeps the presence log: one row per persona per epoch in which it proved. Sibling personas driven by one person have correlated presence vectors. The proof budget bounds partitions per epoch, not epochs. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}

**A malicious validator** can curate the sets: add its own leaves (the floor then counts them), decline to revoke, or rotate a floor-clearing cohort between epochs to intersect one persona's proofs down to one root. Cohort continuity slows that to 20% churn per epoch, which still isolates one root of a 500-leaf cohort in about log(500)/log(1/0.8), roughly 28 epochs or one week at 6 hours, with the label green throughout. Placements and history are signed, so what it served is auditable; the contents are trusted. A device pins the validator's key and its own history anchor on first sight, so it detects a fork against what it saw, but not that another client is served a different history. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}

**A malicious client** can award its own root any reputation score, as described under Tiers, so tier entry is self-asserted. It can also make any persona id read as proven: the circuit binds the persona to the scope and the nullifier, not to the prover's root. An honest client refuses to prove for personas it does not hold; a modified one can vouch for anyone at its own tier. The 16-bit proof of work is a cost per submission, not a rate limit. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}

**A network observer** sees the submitting address without a relay. With OHTTP, the relay's own access log can still join address and time to the gateway's plaintext; OHTTP is not a mixnet. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}

## What this does not protect

- **Anything, on the owner service.** One root, and the operator holds the seed. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}
- **Soundness, on the public preview.** A fixture tag proves nothing; it exists to exercise the plumbing and the refusals.
- **The registration.** The link between a root's account and its commitment is permanent; a future break of any one proof links everything under that commitment, retroactively.
- **Set honesty.** Membership is trusted, auditable, not trustless. A placement circuit would change that; it is not built.
- **The setup.** `snarkjs zkey verify` against the ceremony's r1cs was not completed, and no third-party audit of the post-fix circuit was found. Both verifiers run the same `snarkjs`, so they are not independent evidence. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}
- **Blocking across personas.** Without a persona-to-root table, blocking `@a` does not block `@a2` of the same account. Any server that could fan the block out could also answer "are these two the same person". {cite: SECURITY-POSTURE.md > "10. What zk cost us: root-level block fan-out (ZK Pass 2, Gate 2)"}

## The obvious questions

### Can anyone link my personas today?

Yes: the operator can. On the public preview the proofs are fixture tags, no relay sits in front of the validator, and one device signs all of its personas' writes from one address, so an operator can group them by address and timing whatever the proofs say. On the owner service there is one root, and the operator holds it. The ZK layer hides nothing yet. The label says DEMO on both, and it is computed, not a stamp. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'} {cite: SECURITY-POSTURE.md > "Assumed, by id (this pass did not fix these; they are the honest state)"}

### Why a floor of 50?

Because the set is "named, profiled candidates the operator already runs analytics on", not anonymous strangers. Fifty is the smallest set the design will call private, and the client counts it itself from the leaves rather than trusting a flag from the validator.

### Why not a commitment per persona?

A per-persona commitment would put the persona-to-root grouping into the public trees. One commitment per root, with the persona inside the scope, is what keeps siblings unrelated.

### What would make the label honest-green?

A third-party OHTTP or Tor relay; a validator with at least 50 real roots in the live universe; a prover in the browser so the seed holder is the user (built in wave 3, test data only and not deployed: a Web Worker in the tab, whose real proofs need proving files a deployed build does not ship; on a server-side device the live prover is still a forked Node process); and the remaining conditions, which already pass on the rig. The multi-tenant validator is the piece that gives a crowd. {cite: notes/reports/REPORT-CUSTODY.md > "Stage 3 — the browser device — GREEN"}

## Where it lives in the code

- `lib/zk/config.ts`: every knob above. `lib/zk/privacy.ts`: the ten label conditions.
- `lib/zk/prefetch.ts`, `lib/zk/cohort.ts`, `lib/zk/gate.ts`: the tick, the floor and churn check, the For You gate.
- `lib/zk/transport/live.ts`, `lib/zk/prover/semaphore-worker.mjs`: the live prover, a forked child process.
- `validator/zk.js`: trees, epochs, history, verification, nullifiers. `validator/rep.js`: the score and the deciles.
- Design records: [ZK layer](/technical/zk-layer), [Memo: fan-out under zk](/fanout-under-zk), [Audit: root reads ledger](/root-reads).
