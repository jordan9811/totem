# attack-att-2 — Adversarial review of the Attestation pass (reviewer 2 of 3)

Scope: diff `86adfff..HEAD` (the attestation pass), read against
`SECURITY-POSTURE.md` §13/§12/§11 and `research/VERIFY-YOURSELF.md`.
Emphasis, as assigned: (b) bucket boundaries that fingerprint. (a), (c), (d)
where found. Everything marked "verified on code" was confirmed by reading
the file and line named; "hypothesis" means the mechanism is on the code but
the consequence depends on a deployment or a population I could not observe.

Numbers used below: `ZK_ANON_FLOOR` = 50 (`lib/zk/config.ts:35`),
`ZK_PROOF_BUDGET` = 2 (`:39`), `ZK_COHORT_MAX_CHURN` = 0.2 (`:71`), epochs of
6 h, holdings validity 4 epochs, the other three 28.

---

## 1. The floor is per bucket; a persona's proofs intersect across buckets, kinds and epochs, and no code floors the intersection  — severity HIGH  — confidence: verified on code

**Where:** `lib/zk/cohort.ts:63-77` (floor and churn are computed per `(mode, tree)` only); `lib/zk/budget.ts:58-62` (budget is per `(mode, persona, epoch)`, never across epochs, keyed on the device in `lib/zk/localPins.ts` `budget[...]` which is never pruned); `validator/zk.js` `/zk/members` (line 744 of the current file: full member list per tree, public); `scripts/accept-att4.mjs:140-180, 251-271` (what the linkage test asserts).

**Attack:** The operator reads `zk_attestation_claims` (persona, issuer, bucket, epoch) — its own table — and, for each claim, the PUBLIC member list of that bucket tree at that epoch (`zk_placements` / `/zk/members`). It intersects.

- Intra-epoch: the budget allows two partitions per persona per epoch. In the fixture MAIN proves `protocol-history/morpho` and `wallet-age/gt2y` in one epoch (att2 #4, att4 #0). Each tree clears 50. The candidate set is `|morpho ∩ gt2y|`, which nothing computes on the prove path: `checkCohort` sees one tree at a time, `reserveBudget` counts partitions, not people. The fixture's own comment (`lib/attest/chain/fixture.ts:52-55`) puts `morpho ∩ gt2y` at `7N/12` — 46 for att2's N = 80, under the floor; att4 raises N to 120 so the same pair lands at 70. That is the test being sized to the pair, not the code flooring it.
- Cross-epoch: the budget resets every epoch and remembers nothing (`budgetKey` includes the epoch; `reserveBudget` reads only that key). A persona that needs a morpho-gated mode, an eth-gte-1 audience and a gt2y channel proves one new bucket per epoch after the tier slot and never trips anything. Before this pass the only partitions were NESTED tier trees, so an extra proof added no information (`tier-3 ∩ tier-4 = tier-4`). The onchain family adds thirteen buckets across four INDEPENDENT attributes; every new bucket proven multiplies the candidate set by roughly `|bucket| / |population|`. With the fixture spreads (morpho 2/3, eth-gte-1 4/5, gt2y 7/8, votes-gte-1 2/3, uniswap 3/4) five proofs over five epochs leave `≈ 0.31 × population`; in a real population where `gt4y`, `eth-gte-10`, `votes-gte-20`, `compound` are the interesting buckets, two proofs are typically enough to reach one commitment.
- What the linkage test checks (att4 #2, #3): ONE epoch, ONE pair, against a crowd of decoy personas that the test scripts to prove "the same pairs" (`plan.push(...)` for every decoy whose commitment sits in both trees). A real population does not prove pairs on cue; the "no unique profile" property is furniture.

**What it learns / breaks:** persona → commitment (and commitment → root is already the validator's, `zk_registrations.root_id`). This is F2b made concrete: the posture doc says the budget "bounds how many partitions a persona proves per epoch; it does not bound epochs" — true, and it did not matter while partitions were nested. It matters now.

**Fix or assumption:** The client already holds everything needed to refuse: every partition this persona has ever proven (`localPins.budget`, all epochs) and the served member lists (the prefetch snapshots, `extra[w.tree]`). Add a CUMULATIVE INTERSECTION FLOOR to `prepareAndProve` after the cohort stage: `|∩ members(tree_i, epoch_i) over every partition this persona has proven, plus the one requested| ≥ ZK_ANON_FLOOR`, else refuse at a new stage `intersection`; treat nested buckets of one issuer as one attribute (the tightest) so `gt1y`+`gt2y` costs nothing extra. Until then the posture doc must carry **A-ATT-INTERSECTION-UNFLOORED**: the floor is per bucket; the operator's candidate set for a persona is the intersection of every bucket it ever proved, and nothing bounds it below the floor except the budget's two-per-epoch pace.

---

## 2. The per-commitment attestation profile is public, nested buckets all fire, and bucket transitions date threshold crossings — the wallet is recoverable from public chain data  — severity HIGH  — confidence: verified on code (the chain-data match is a hypothesis about population size)

**Where:** `lib/attest/issuers/onchain.ts:65-96` (`bucketsFor`: a 5-year wallet gets `gt1y`, `gt2y` AND `gt4y`; holdings and governance likewise; protocol-history is the exact subset) and `:270` (`wanted = supported` unless the subject asks for less — nothing in the product asks for less); `validator/zk.js:963` (`GET /zk/attestations?commitment=` is public and returns every `(issuer, bucket, issuedEpoch, activeFromEpoch, expiresEpoch, revokedFromEpoch, claimHash)` for a commitment); `/zk/members` and `/zk/attest/buckets` (`:948`) public.

**Attack:** No proof, no operator table needed. Anyone reads, per commitment, the full bucket set. Because nested buckets all fire, the set encodes the FINEST band the issuer can express, not the coarse one the subject later proves: `{gt1y, gt2y} \ {gt4y}` = first tx 2–4 years old; `{eth-gte-0.1, eth-gte-1} \ {eth-gte-10}` = 1–10 ETH; `{votes-gte-1, votes-gte-5} \ {votes-gte-20}` = 5–19 Snapshot votes; protocol-history = exactly `{aave, morpho, uniswap}`. That is up to 3 × 3 × 3 × 16 = 432 cells over the registered population. Then the transitions: `bucketsFor` uses `now = Date.now()` at each issuance, so the epoch at which a commitment's `wallet-age` set gains `gt2y` (`active_from_epoch` of the new row, public) says its first transaction happened `2 y ± one renewal period (28 epochs = 7 days)` before that epoch; the epoch `votes-gte-5` appears dates the fifth Snapshot vote to a week; `eth-gte-1` flickering at the 4-epoch cadence tracks balance crossings. All of this is a query over public chain data: "wallets whose first tx falls in a given week of 2022, holding 1–10 ETH, that touched exactly Aave + Uniswap among the tracked four, with 5–19 votes on hub.snapshot.org". That returns a handful of addresses.

**What it learns / breaks:** commitment → small wallet candidate set, for the public; the operator adds commitment → root → device → persona-creation hours. The posture doc's "never a wallet address" holds literally and fails in effect: no address reaches the validator, a description of the address does, and it is published. att2 #6 and att4 #4 grep for the ADDRESS and the exact values, which is the wrong needle.

**Fix or assumption:** (1) Issue only what will be proven: default `subject.buckets` to the single bucket a surface asked for, and have the issuer emit the TOP nested bucket only (a `gt4y` issuance implies the rest for any verifier that wants to reason; a tree per bucket can still be built by nesting on the validator, `gt2y` tree := `gt2y ∪ gt4y` rows, so a subject in `gt4y` proves `gt2y` without a `gt2y` row). (2) Gate `GET /zk/attestations?commitment=` behind the device envelope — only the owner needs its own list; the census and the member lists are already enough for the client. (3) State **A-ATT-PROFILE-CELL**: the cross-bucket profile of a commitment is public and is a coarse description of the wallet; and **A-ATT-TRANSITION-DATES**: a bucket gained at renewal dates a threshold crossing to one validity period. The structural fix is a per-`(issuer, bucket)` blinded leaf (an HKDF branch of the identity per tree, the dual-key design from the ZK research pass) so trees cannot be joined on the leaf; that is a Semaphore-identity change, not tonight's.

---

## 3. Open registration plus an id-only honour list makes the validator's registry the trust anchor, first come first served  — severity HIGH  — confidence: verified on code

**Where:** `lib/attest/subscriber.ts:13,30` (`DEFAULT_PATTERNS = ["onchain.*"]`, honour is by id); `lib/attest/ids.ts:40-42` (`issuerMatches` for `"ns.*"` is `startsWith("ns.")`); `validator/zk.js:852-876` (`POST /zk/issuers`: any key, self-signed; same id + other key → 409; `ON CONFLICT DO UPDATE` under the same key changes `buckets_json`, `validity_epochs`, `schema_json` at will); `lib/attest/issuerKey.ts:47` (each host mints its OWN random key per issuer id); `lib/attest/registry.ts` `ensureRegistered` (each device registers lazily with its own key).

**Attack:** In the §8 topology the peer is the device and the validator is shared. Every device runs the `onchain.*` modules with a key it generated itself. The FIRST device to call `requestIssuance` in a universe registers `onchain.wallet-age` under its key; every later device gets 409 and its `requestIssuance` refuses — so only one user can ever issue, and that user's key is what `ATTEST_HONORED_ISSUERS=onchain.*` trusts on EVERY client. That user (or anyone who reaches the validator first, in `live` mode, before the "real" issuer deploys) signs `eth-gte-10`, `gt4y`, `votes-gte-20` for any registered commitment with no chain read at all: `POST /zk/attest` verifies only the signature under the registered key and that the bucket is one the issuer declared. Also: nothing pins a key on the subscriber side, so a malicious operator rewrites `zk_issuers.pubkey` in its own database and becomes every honoured issuer — the posture's "trust is never the validator's" is not what the code does; the client fetches the key it trusts from the validator.

**What it learns / breaks:** soundness of every attestation-gated surface on every client: modes, packs, channel gates, audiences (the audience floor does not help — the forged bucket can be padded to 50 with the forger's own issuances for decoys it controls, and C1 already admits the operator pads trees). A-ATT-ISSUER-COHOSTED says the key "lives beside the keystore in this repository" and does not say the honour list carries no key.

**Fix or assumption:** Honour entries carry a key: `ATTEST_HONORED_ISSUERS=onchain.*@<64-hex pubkey>` (a family shares one key, so one fingerprint covers the four); `isHonoredIssuer(id, pubkey)` compares against the registry's `pubkey` at the read in `proven.ts`, the gate, the label and `attestedClaimsFor`. The validator's registry then is a directory, not an anchor. Until then: **A-ATT-REGISTRY-IS-KEY-ANCHOR** — which key an id means is whatever the validator's `zk_issuers` row says, and the row belongs to whoever registered first.

---

## 4. A revoked issuance is un-revoked by re-submitting the issuer's original signature  — severity MED  — confidence: verified on code

**Where:** `validator/zk.js:890` (the upsert is `INSERT OR REPLACE ... revoked_from_epoch ... VALUES (..., NULL, ...)`), `:905` (`issuedEpoch` may be `epoch` or `epoch - 1`), `:917` (`prevActive` is true while `revoked_from_epoch > epoch`, so the activation epoch is even kept). The subject holds the issuer's signature in its vault (`lib/attest/types.ts` `IssuedAttestation.sig`; `lib/attest/vault.ts` `storeIssued`), and `POST /zk/attest` takes no envelope (`lib/zk/validatorClient.ts` `vpost`).

**Attack:** Issuer issues at epoch E. Issuer revokes at E (`revoked_from_epoch = E + 1`). Subject re-posts the identical `{issuer, bucket, commitment, claimHash, issuedEpoch: E, expiresEpoch, sig}` — accepted (`issuedEpoch === epoch`), the row is replaced with `revoked_from_epoch = NULL`, `active_from_epoch` unchanged. Same at E + 1 (`issuedEpoch === epoch - 1`): the row comes back with `active_from_epoch = E + 2`. The window is the issuance epoch and the next; that is exactly when a fraud revocation happens (the issuer discovers a stolen wallet after issuing).

**What it learns / breaks:** issuer revocation is not append-only for two epochs, unlike root revocation (§11: "a revoked row stays revoked"). att1 #9 and att4 #7 revoke and never replay.

**Fix or assumption:** `INSERT ... ON CONFLICT(mode, issuer, bucket, commitment) DO UPDATE SET ... revoked_from_epoch = zk_attestations.revoked_from_epoch` (never cleared by an issuance), or refuse an issuance whose `issuedEpoch <= revoked_from_epoch - 1` for that key. Ten lines; no assumption needed after it.

---

## 5. Expiry is quantized to the ISSUE epoch, which in a real population is per subject; a revocation is a partition of one  — severity MED  — confidence: verified on code (the persona-cessation half is a hypothesis: no product code re-proves per epoch yet)

**Where:** `validator/zk.js:906` (the validator REQUIRES `expiresEpoch === issuedEpoch + 1 + validity`, i.e. it enforces the per-issue-epoch partition), `:905` (two issue epochs accepted per submission epoch → two expiry classes per activation epoch), `:871` (`validity_epochs` may be changed by the issuer at any time; later issuances get a different class); `:926-945` (revocation drops exactly one leaf at `epoch + 1`); `scripts/accept-att4.mjs:301-311` (check 6 asserts one expiry epoch for a cohort that was issued in ONE epoch by the test).

**Attack:** Subjects request issuance when they want a surface — different epochs. Holdings has validity 4, so at any moment the `eth-gte-1` tree is the union of up to five expiry classes; the operator (and the public, via `/zk/attestations`) sees each commitment's `expires_epoch`. A commitment that goes quiet drops at its own epoch; the persona whose `attest` claims stop that epoch (the presence log) is in the drop set of that epoch. A-Z3-ATTEST-EXPIRY-PARTITION said the design "should quantize expiry to shared boundaries"; the pass quantized to the issue epoch and declared it done. Revocation is worse: it is always one leaf, `active` until `E + 1` and gone after (att4 #7 shows exactly one leaf leaving). If the persona re-proves that bucket each epoch — which any attestation-gated mode will require once a UI drives `requestAttestation` — its claims stop at the same epoch the leaf drops. One drop, one cessation, one link. The cohort-continuity check does not fire (one leaf of fifty is 2 % churn).

**What it learns / breaks:** persona → commitment for the revoked or expired subject, by the epoch of cessation; the posture calls the revocation row "a root-level leak like registration" and asserts "no persona-level trace" — the trace is the absence.

**Fix or assumption:** Put expiry on a GLOBAL grid, validator-enforced: `expiresEpoch === (floor((issuedEpoch + 1) / V) + 2) × V` (everything issued within a V-window expires at the same boundary; the effective validity is V..2V). Make revocation "no renewal": `revoked_from_epoch := expires_epoch` (the leaf leaves with its grid cohort), with a single documented exception for emergency revocation that names the cost. Freeze `validity_epochs` after the first issuance (a change is a new issuer id, like a key rotation). Assumptions to carry until then: **A-ATT-EXPIRY-PER-SUBJECT** and **A-ATT-REVOCATION-SINGLETON**.

---

## 6. The persona id in an attestation proof is a free-form public input: any leaf holder vouches any bucket onto any persona  — severity MED  — confidence: verified on code (the mechanism); the marketplace consequence is a hypothesis

**Where:** `validator/zk.js:591` (`INSERT OR REPLACE INTO zk_attestation_claims` keyed on the persona id the PROVER typed); `verifyAndRecord` checks that the message binds `personaId` but nothing binds `personaId` to the prover (migration 006 made that impossible by design); `lib/rules/evaluate.ts` `attest.holds` `eq`/`neq`/`in`; `lib/adapters/mock/market.ts` `audienceSize`. REPORT-ATT Gate 3 iteration 2 uses exactly this: "a persona id is free-form on a fixture proof".

**Attack:** A root with an `eth-gte-10` leaf proves `attest:onchain.holdings/eth-gte-10` with `personaId = <victim>`. From the next feed build the victim's posts are hidden by every mode whose rule is `hide if attest.holds eq eth-gte-10` (or shown in "whales only" modes it never asked for), the victim counts in an advertiser's `attest.holds` audience, and the victim's own `attested` read says true for a bucket it never held. A second proof from the same leaf, another persona: the leaf is a vending machine for "proven" status — one scope per (persona, issuer, bucket, epoch), and the attacker chooses the persona. §12 admits the vouch shape for fork claims (A-Z3-FORK-CLAIM-IS-A-VOUCH); for attestation it is the same fact with a surface that now acts on it.

**What it learns / breaks:** integrity of what a persona "proved", not privacy; it also pollutes the operator's presence log in a way the linkage test reads as noise.

**Fix or assumption:** Bind the persona to the envelope: the persona already has an Ed25519 key in the keystore (`lib/identity`); require `personaSig = sign_persona(nullifier | message)` in the envelope and verify it against the persona's registered key. That adds no linkage (the persona id is already in the clear in the same message). Until then: **A-ATT-PERSONA-VOUCH** — a proven bucket on a persona means "some member of that bucket vouched this persona id", and rules with `neq` should be described as unsafe against that.

---

## 7. "Proof-mediated on every surface" is not true for the marketplace path: the root's vault issuances are stamped onto every own persona  — severity MED  — confidence: verified on code

**Where:** `lib/adapters/mock/graph.ts:81-105` (`attestedClaimsFor` reads `myAttestations()` — the ROOT's vault — for any own persona and `SEED_VIEWER.personas`, and returns one claim per issuance with `value = bucket`); `:122-126` (`claimsForMatching` includes them); `lib/adapters/mock/market.ts:126-139` (`matchingCampaigns` matches `graph.claim` clauses against `claims: [...held]` and passes NO `attestations`, so `attest.holds` never matches there while `graph.claim == "morpho"` matches by the vault); `lib/feed.ts:863` (ad insertion uses `matchingCampaigns`).

**Attack:** Two divergent evaluators for one attribute. An advertiser who writes `graph.claim == "morpho"` (k-floor 8, no zk floor since `audienceHasAttestPredicate` only looks for `attest.holds`) reaches every persona of a root that merely HOLDS a morpho issuance — no proof, no floor, all siblings at once; the same advertiser writing `attest.holds == onchain.protocol-history/morpho` is held to 50 and to proofs. The sibling personas carry byte-identical synthetic claim ids (`att_onchain_protocol_history_morpho`); any surface that ever exports a persona's claim list (a disclosure grant, a backpack share) exports the root's fingerprint under every persona.

**What it learns / breaks:** §13 "Every one of them evaluates against what a persona PROVED this epoch" (att3 #7 tests that the DOC says it, not that the code does). Device-local in this topology, so LOW as linkage today, MED because the invariant the doc rests on is contradicted by the score path the same gate added.

**Fix or assumption:** In `matchingCampaigns`, pass `attestations: provenAttestationsFor(personaId)` and drop `zk-attestation`-method claims from `held` before `graph.claim` matching; keep them in `claimsForMatching` for the score display only, or state **A-ATT-SCORE-IS-ROOT-LEVEL**: the Ad Match Score and campaign matching count what the root holds, for every persona, proof or not.

---

## 8. Open per-issuer surfaces that the honour list does not reach  — severity LOW  — confidence: verified on code

**Where:** `validator/zk.js` `gatedRead` (no-op unless `LAYERS_REQUIRE_SIG=true`) on `/zk/attested` and `/zk/attested-map` (`:1005`); `lib/attest/proven.ts:45` (honour filtered at REFRESH time only, into a `globalThis` cache shared by every request and both modes); `lib/zk/gate.ts:189` (`wanted.delete(key)` — a wanted attestation proof is one-shot; the honour check runs when it is scheduled, not when it is proven).

**Attack:** (i) Unarmed deployment: `GET /zk/attested-map` is a public persona → `{issuer/bucket}` feed, honoured or not (A-ELIGIBILITY-VISIBLE covers the tier map; this is the richer one). (ii) The un-honoured issuer's claims ARE in the validator's log and in the anonymous submission stream; `proven.ts` hides them from this client only. (iii) A dev-override of the honour list (`setHonoredIssuers`) or an env change between a refresh and a build serves the previous list's answer; the cache is not keyed by mode, so a fixture build followed by a live build with a failed refresh reads an empty map — fail-closed, fine — but a successful fixture refresh followed by a live build that does NOT refresh (any non-gate path calling `provenAttestationsFor`) reads fixture claims for live personas.

**Fix or assumption:** Key the cache by mode and honour-list hash; extend A-ELIGIBILITY-VISIBLE to name `zk_attestation_claims`.

---

## 9. The issuer's retention file is a dictionary with its own key beside it; the challenge carries the commitment in the clear to the wallet  — severity LOW  — confidence: verified on code (the wallet-tooling half is a hypothesis)

**Where:** `lib/attest/issuers/onchain.ts:137-146` (`onchain-subjects.json` = `{ salt, subjects: { sha256(salt|address): [{commitment, issuer, buckets, issuedEpoch}] } }` — the salt is IN the file), `:157` (`retain` appends per issuance); `:117` (the challenge string the WALLET signs by EIP-191 contains `subject.commitment`).

**Attack:** Whoever reads the file (co-hosted with the user's keystore here, A-ATT-ISSUER-COHOSTED) hashes any candidate address with the salt beside it and gets wallet → commitment → bucket history with epochs. Separately, the personal_sign payload `layers-attest-challenge/1|onchain.wallet-age|live|<commitment>|0|<nonce>` passes through wallet software, WalletConnect relays and hardware-wallet companions that keep signing logs; each holds a wallet → commitment binding signed by the wallet.

**Fix or assumption:** HMAC the address under the issuer's private key (the key file, not the subjects file) so the subjects file is not self-inverting; put `sha256(commitment)` or an opaque issuer token in the challenge rather than the commitment. State **A-ATT-CHALLENGE-BINDS-COMMITMENT-IN-WALLET-LOGS** until then.

---

## 10. Smaller items  — severity LOW/INFO  — confidence: verified on code unless marked

- **Vault size leaks the issuance count (LOW).** `lib/attest/vault.ts:42` pads to the next 1 KiB; an `IssuedAttestation` is ~650 bytes (128-hex sig, 64-hex hash and nonce, JSON value), so `adapter_state.zkAttestations` length steps with roughly every 1.5 issuances; the flush lands in the same hour as the `/zk/attest` POST for the commitment. Root-level. Pad to a fixed 16 KiB.
- **Issuer key has no revocation (LOW).** "A rotation is a new id" leaves the old id registered under a leaked key for up to 28 epochs of valid issuances, revocable only by the same leaked key (and un-revocable per #4). Add self-signed `POST /zk/issuers/revoke` that drops every leaf of the id at the next grid boundary.
- **Chain-facts sources learn wallet → client IP → time (INFO, hypothesis).** `lib/attest/chain/live.ts` sends the address to `ATTEST_RPC_*` (env-configurable), Blockscout and hub.snapshot.org from the device; an operator that runs or observes the RPC endpoint pairs the address with the `/zk/attest` POST that follows within seconds. **A-ATT-FACTS-SOURCE**.
- **The fixture's operator distinguishes decoys by name (INFO).** `root_zkdecoy_%` (`validator/zk.js:1092-1124`): the one real registration is identifiable in every linkage test; every "candidate set ≥ floor" in att4 is therefore a count the operator would not need. Already implied by A-Z3-REISSUE-JOIN; worth saying once in §13.

---

## Verdict

After this pass the operator — and for most of it, the public — can still do the following, none of which §13 admits. Read a commitment's full bucket set (nested buckets all fire, `/zk/attestations` is open) and the epochs at which buckets appeared, which together describe the wallet finely enough to look it up on chain (#2). Intersect a persona's attestation proofs across buckets, kinds and epochs against public member lists, with no floor on the intersection and a budget that forgets every epoch (#1); the linkage test passes because the fixture's cohort spread and its decoy personas are built to share the tested pair. Watch a single leaf drop at revocation or at a per-subject expiry and read the persona whose claims stop that epoch (#5). Treat the validator's first-come registry as the key behind `onchain.*` on every client, or become that issuer by registering first (#3), and keep a revoked issuance alive by replaying its signature for two epochs (#4). Vouch any bucket onto any persona id (#6). Match advertisers to the root's unproven issuances through `graph.claim` on every sibling persona (#7). The two things that would change the picture most are cheap and client-side: a cumulative-intersection floor before any attestation proof, and issuing only the bucket that will be proven; the two that are validator-side and small: preserve `revoked_from_epoch` on upsert, and put expiry on a global grid. Everything else above is an honest assumption the posture doc should carry by id.
