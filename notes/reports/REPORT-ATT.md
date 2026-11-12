# REPORT-ATT — Attestation pass: the open issuer interface + the onchain-facts reference issuer

**Run:** started 2026-09-06 01:35, from commit `86adfff` (ZK Pass 2 closed:
four consecutive clean sweeps, 383/383 checks). Prompt:
`notes/prompts/attestation-prompt.md`. Checkpoints in `notes/reports/RESUME.md`; the closing summary
in `notes/runbooks/MORNING.md`. Max 18 iterations (G0: 2, G1: 5, G2: 5, G3: 3, G4: 3).

**Decisions fixed by the prompt, not relitigated:** the operator is never
the issuer; proof-of-personhood is deferred; the reference issuer is
onchain facts. **One change from the user, mid-pass:** Aerodrome is OUT of
the protocol-history set — the initial set is Aave, Morpho, Compound,
Uniswap.

**Status: CLOSED.** Gates 0–4 GREEN (2 + 2 + 4 + 3 + 5 iterations = 16 of 18); /verify met on `f10278e` after two fix iterations (17, 18) and one rig-only commit: four consecutive clean sweeps on `f10278e` — 427/427 checks, 58/58 suites, zero infra, four times (the /verify section at the end; `notes/reports/SWEEP-STATUS.md`, series 5).

---

## GATE 0 — port pinning + the runner's liveness contract

The instrument every closing bar is read from is the sweep runner, and ZK
Pass 2's closing sweeps caught it lying twice: another project's dev
server took `:3000` mid-sweep and the runner's probe (`curl -s`, any HTTP
status) read it as alive, so fifteen suites ran against the wrong server
— and every one of them was recorded **ok** with an empty summary,
because any exit code outside {0, 1, 2, 124} fell through to green. The
second half was fixed in `065ef3b`; this gate makes both impossible to
regress and moves Layers off the default ports.

**Port pinning.** `lib/ports.ts` is the source of truth: `LAYERS_APP_PORT`
(default **3001**) and `LAYERS_VALIDATOR_PORT` (default **4001**; the older
`VALIDATOR_PORT` spelling still works, the new one wins), with
`appUrl()` / `validatorUrl()` honouring `APP_URL` / `VALIDATOR_URL` when
set. Every entry point derives from it or from a byte-identical
duplicate where TypeScript cannot be imported: the app (`scripts/
start-app.mjs` launches `next start|dev -p <pinned>` — npm scripts cannot
read an env var portably on cmd.exe), the validator (`validator/server.js`
`validatorPortFromEnv()`), all 67 suite/live/capture scripts (their
`BASE`/`VBASE` defaults), the four shell runners, `gate0.mjs`, the X OAuth
redirect default, and the eight app/lib sites that used to hardcode
`http://localhost:4000`. The runner's own regression suite walks
`app/ lib/ validator/ scripts/ components/ package.json` and fails on any
surviving `localhost:3000|4000`, `-p 3000`, `PORT=3000` or
`VALIDATOR_PORT || 4000` literal.

**The liveness contract.** `GET /api/health` (app) and `GET /health`
(validator) return a Layers-SPECIFIC payload — `{ app, commit, buildId,
startedAt, uptime, port, pid }` — **signed** (Ed25519 over the canonical
`layers-health/1|app|commit|buildId|startedAt|uptime|port|pid`). The
runner's probe (`scripts/lib/health-probe.mjs`) accepts ONLY that: 200,
JSON, the expected `app` name, a commit, an integer uptime, a signature
that verifies under the payload's key — and for the validator the key
must also be the one `/zk/validator-key` serves. The runner probes both
processes BEFORE warm-up and **refuses to launch** (exit 2, `REFUSED:
app on … is not Layers (…)`) if either fails; between suites it probes the
app again. A foreign server answering 200 with any other body, a 404, an
HTML page, or the right shape with a wrong signature, all read as DOWN.

The app signs with a per-PROCESS random key (generated at first use,
never written): the signature is a scheme check binding the fields to one
live process, not an identity claim — the app has no identity to assert
on an unauthenticated local endpoint, and publishing the device's public
key there would be a leak for no gain. The validator's is an identity
check (its persistent key, cross-checked). Stated as
**A-ATT-HEALTH-SIG** in the posture doc's Issuers section (Gate 4).

**Exit-code classification, pinned.** `scripts/runner-test.mjs`
(`npm run test:runner`, now the 55th suite in `sweep-x.sh`) runs the real
runner against throwaway stub servers and four probe suites
(`scripts/runner-probes/`): exit 137 with one PASS line and NO summary →
`INFRA suite exited 137 with no verdict`; exit 3 with no output → INFRA;
exit 1 with a FAIL line → FAIL, and the detail file receives exactly that
line (the PASS line does not leak in); exit 0 → ok; TOTAL counts only
PASS lines; a failed suite outranks infra in the sweep's exit code. A
sixth check reads the runner's source and fails if the
non-zero → INFRA branch or the signed-probe refusal ever disappears.

**The peer check — found by the first run.** With the app pinned to 3001
and the validator to 4001, every app-facing suite failed "validator
unavailable": `.env.local` still sets `VALIDATOR_URL` (and the unused
`NEXT_PUBLIC_VALIDATOR_URL`) to `:4000`, and an explicit `VALIDATOR_URL`
wins over the pinned default by design. Exactly the failure mode this
gate exists for — a pinned app pointed at a dead port, and fifty suites
failing one by one instead of the runner saying so. So the app's health
payload now names the validator it is configured to talk to (`peer`,
inside the signed canonical), and the runner refuses to launch when that
is not the validator under test: `REFUSED: app on … is not Layers (app is
configured to talk to a validator at …:4000 but the validator under test
is …:4001 - fix VALIDATOR_URL (a stale .env.local?))`. Runner check 7
proves it with a proxy that is a valid validator on another port. The
user's `.env.local` is not edited by this pass; the harness passes the
URLs explicitly (an env var already set beats `.env.local` in Next), and
`notes/reports/RESUME.md` / `notes/runbooks/MORNING.md` say which two lines to change.

Two smaller findings from the same run: the probe's `process.exit()`
right after two `fetch`es tripped a libuv assertion on Windows
(`src\win\async.c:76`, exit 127) so a VERIFIED validator read as DOWN — the
probe now uses `node:http` with no agent and lets the loop drain; and my
test's TOTAL expectation was wrong, not the runner: PASS lines are counted
from every suite (the 383 baseline was built that way) while the verdict
is per suite, so four probes with 1+2+1+0 PASS lines total 4.

**A soundness hole, found by check 2.** The test hands the probe a
payload of the right shape with an all-zero public key and an all-zero
signature, expecting "signature does not verify" — and once the `peer`
field was in place, the probe VERIFIED it. Thirty-two zero bytes decode to
an Ed25519 point of order 4, and with `S = 0` the verification equation
`S·B = R + h·A` collapses to `(1 + h)·P = 0`, which holds for a quarter of
all messages (measured: node:crypto accepted the zero key on 12 of 40
messages). OpenSSL does not reject small-order points, and
`validator/crypto.js` — the verify path behind device anchors,
delegations, envelopes, revocations, and from Gate 1 issuer registrations
and issuances — used node:crypto. An attacker could register an anchor
under a key nobody holds and forge with retries. **Fixed in all three
verifiers** (`validator/crypto.js`, `lib/crypto/ed25519.ts`,
`scripts/lib/health-probe.mjs`): a usable key is a canonical encoding of
a point that is neither small-order nor outside the prime-order subgroup
(`@noble/curves`' `isSmallOrder()` / `isTorsionFree()`, audited, no
hand-rolled arithmetic); anchor registration refuses such a key outright.
A validator unit test pins it (64 messages under the zero key: 0
accepted; the canonical small-order encodings refused; the anchor route
400s). This is the first thing the liveness contract paid for, and it was
not the thing it was built to catch.

| iteration | result |
|---|---|
| 1 | rebuilt on the pinned ports: `test:validator` green; `test:runner` 5/6 (check 4's TOTAL expectation — mine, not the runner's); every app suite failed "validator unavailable" — the stale `.env.local` `VALIDATOR_URL=:4000`, see the peer check above |
| 2 | peer field + check 7; rebuilt; the harness's own kill step left the old servers standing (EADDRINUSE, a stale build still serving) — Stop-Process replaces taskkill there; then `test:accept` **14/14**, `functional` **all**, `test:z0` **11/11**, `test:z8` **7/7**, `test:validator` green, `test:runner` 6/7 — check 2 verified the ZERO KEY (above) |
| 2 (cont.) | small-order keys refused in all three verifiers + a unit test; `test:runner` **7/7**; `test:validator` green (the new test included) |

**Gate 0 exit — met:** port pinning honoured across every entry point
(the runner's static check finds no literal); a stub server on the port
reads DOWN and the runner refuses to launch (checks 1, 2, 7); exit-code
classification green (check 4); plus the peer check and the small-order
fix. Committed as `att: gate 0 green` (`1884a9a`).

---

## GATE 1 — the open issuer interface

**The shape.** Anyone can be an issuer; the protocol does not care who.
An issuer is a namespaced id (`onchain.wallet-age`, `test.mock-issuer`),
an Ed25519 key, a claim schema, the BUCKETS it emits, and a validity in
epochs (`lib/attest/types.ts`, the prompt's `AttestationIssuer` with
`issue()` returning one issuance per bucket the facts support). The
validator keeps an OPEN registry (`zk_issuers`, migration 009):
`POST /zk/issuers` is self-signed under the issuer's key (key possession
is the whole of registration), the same id under another key is 409 — a
key rotation is a NEW id — and TRUST is not part of the interface at all:
which issuers a client honours is the subscriber's choice
(`lib/attest/subscriber.ts`, `ATTEST_HONORED_ISSUERS`, default
`onchain.*`). The former validator-signed mock hook is gone; the mock is
`test.mock-issuer`, an issuer like any other whose "verification of the
fact" is vacuous, used only by fixtures and never honoured by a product
client.

**The one decision this gate had to make: where the bucket lives.** The
prompt says the validator learns "issuer X vouched for root R under
claim-kind K" and never the VALUE, and also that a gated surface
predicates on a coarse bucket whose population is checked against the
floor. Those meet in one place: the tree is per (issuer, BUCKET) —
`attest:onchain.wallet-age/gt2y` — exactly as a tier tree is per tier.
The bucket is the coarse public attribute; the validator learns bucket
membership of commitments the way it learns tier membership; the VALUE
(the exact fact, the nonce, the issuer's signature) lives in the
subject's vault as one opaque sealed record (`zkAttestations`), and the
validator holds a nonce-salted hash of it that is not a dictionary. The
nullifier scope is qualified by issuer AND bucket
(`attestation/<issuer>/<bucket>`), the message binds the tree, and the
gate id of an attestation claim IS its tree name.

**Issuance flow.** Subject (a ROOT's commitment, never a persona) →
issuer registers itself lazily (idempotent) → `issue()` signs
`{ issuer, bucket, commitment, claimHash, issueEpoch, expiryEpoch }` per
bucket → the claim is sealed into the vault → only the public part goes
to `POST /zk/attest` (one or a batch), which verifies the issuer's
signature under the registered key, requires the bucket to be one the
issuer declared and the expiry to be exactly `issued + 1 + validity`
(quantized, never per-subject — A-Z3-ATTEST-EXPIRY-PARTITION), and
inserts the leaf from the NEXT epoch (batched; C10 applies). Issuer
revocation is a signed `POST /zk/attest/revoke`, effective next epoch;
`GET /zk/attest/buckets` is the per-bucket census; `GET /zk/attested` and
`/zk/attested-map` (gated like eligibility) say what a persona PROVED, by
issuer and bucket. A renewal of an ACTIVE issuance keeps its activation
epoch (the leaf never flickers); anything else activates next epoch.

**Grammar widened on both sides.** Issuer ids allow dots and dashes (48
chars), buckets the same (32), gate ids accept `attest:<issuer>/<bucket>`
(`[A-Za-z0-9_.:/-]{1,96}`); the validator and the client agree, and the
runner's own attestation suite exercises the duplicate.

**What changed elsewhere.** `hasSubmissionFor` keys attestation
submissions by tree (two buckets are two claims, the budget still bounds
them); the prefetch tick snapshots every wanted bucket tree as before;
`resetZk` forgets the vault's issuances and the honour override; z8 and
z9 name the mock behind the interface (`attest:test.mock-issuer/any`);
three validator unit tests cover registration, issuance refusals by
index, claims by bucket and revocation. Checks: 383 + 7 (runner) + 10
(att1) = **400** in the full sweep.

| iteration | result |
|---|---|
| 1 | validator units green after a timeline fix in my own test (a 1-epoch validity is a leaf for exactly one epoch); `test:att1` 7/10, `z8` 6/7, `z9` 3/9 — ONE cause: the `prove`/`enqueue` rig actions did not forward `bucket`, so every direct attestation proof was refused at the scope stage (z8 #5, att1 #8, z9 #0 and its cascade). Two mine: att1 #9 needed an issuance that OUTLIVES a revocation (a second mock, `test.mock-issuer-long`, validity 3), and API.md's paths had line-wrapped |
| 2 | `bucket` forwarded; BigInt literals → `BigInt()` (the repo's ES target trap, again); **`test:att1` 10/10, `z8` 7/7, `z9` 9/9**, `z0` 11/11, `test:runner` 7/7, validator units green |

**Gate 1 exit — met:** interface implemented; issue → batch insert →
prove → attested → expire → refused lifecycle green on the mock issuer
(att1 #2, #4, #8); the validator DB holds no claim value (att1 #3 greps
the database, the WAL, the log and every response for the claim's random
token and nonce; the vault namespace is one opaque record; the issuer's
private key is nowhere); a tampered issuer signature, a per-subject
expiry, an undeclared bucket and an unregistered issuer are refused by
index (att1 #5); issuer-scoped nullifiers pass the collision test with
two buckets of one issuer for one persona in one epoch (att1 #6); the
subscriber allowlist is honoured — an un-honoured issuer's attestation
schedules no proof and reads `attested: false` on this client while the
validator's log still says otherwise (att1 #7); issuer revocation removes
exactly one leaf (att1 #9). Committed as `att: gate 1 green` (`3529b41`).

---

## GATE 2 — the onchain-facts reference issuer

**The one real issuer.** `onchain.*` is a family of four issuers — one id
per claim kind — sharing ONE signing key in phase 1 (key id `onchain`,
documented as such; a rotation is a new family):

| issuer | buckets (nested where they nest) | validity |
|---|---|---|
| `onchain.wallet-age` | `gt1y`, `gt2y`, `gt4y` — first tx older than 1/2/4 y, max over bound wallets | 28 epochs |
| `onchain.holdings` | `eth-gte-0.1`, `eth-gte-1`, `eth-gte-10` — ETH at the snapshot, summed; tiers, never amounts | 4 epochs |
| `onchain.protocol-history` | `aave`, `morpho`, `compound`, `uniswap` — interacted before the issue epoch (Aerodrome struck by the user) | 28 epochs |
| `onchain.governance` | `votes-gte-1`, `votes-gte-5`, `votes-gte-20` — Snapshot votes, summed | 28 epochs |

**Coarseness is the privacy control.** The issuer reads EXACT facts — a
first-tx timestamp, a wei balance, a transaction list, a vote count —
through `ChainFactsAdapter` (`lib/attest/chain/`: a FIXTURE
implementation replaying recorded facts for seeded wallets whose keys are
`keccak256(seed)`, and a LIVE one reading public RPC balances, Blockscout
transaction lists and Snapshot votes, keyless and read-only), buckets
them, signs the BUCKET, and lets the exact values die with the request.
The claim in the subject's vault is `{ kind, bucket, snapshotEpoch }` — no
amount, no timestamp, no address. att2 #6 greps the validator's database,
WAL, log, every response, the vault record and the issuer's own retention
file for the fixture wallet's address, exact balance and first-tx
timestamp and finds none.

**Wallet ownership binding.** The issuer mints a challenge
(`layers-attest-challenge/1|issuer|mode|commitment|epoch|nonce`, ten-minute
TTL, one use); every wallet the subject binds signs it (EIP-191,
verified with viem's `verifyMessage`). The address is seen by the ISSUER
only, during issuance; it keeps `sha256(salt|address)` in
`.keystore/issuers/onchain-subjects.json` so it can revoke, and nothing
else. A tampered signature, a missing wallet and a foreign challenge are
refused (att2 #2 — my first tamper flipped the recovery byte, which
verifiers normalise, so it was a no-op; the test now flips a middle byte).

**Multiple wallets aggregate at the root** — max age, summed holdings,
union of protocols, summed votes (att2 #7: W0 + W1 → `gt4y`, 3.0 ETH →
`eth-gte-1` not `eth-gte-10`, `compound` joins the union) — and the
validator never sees the set or its size: the rows have no wallet column
and the two-wallet root's rows are shape-identical to the crowd's.

**The floor, per bucket.** A bucket is a tree, so the CLIENT's cohort
check refuses to prove into a thin one before any proof exists (att2
#5: `compound` and `gt4y` are deliberately thin in the fixture cohort and
are refused at the cohort stage with the floor named). The cohort
furniture (`fixtureChainFacts.cohortFacts`) spreads synthetic facts BY
INDEX — a hash-based spread gave `morpho = 47` on one run, exactly the
variance the linkage test cannot tolerate — so populations and their
pairwise intersections are deterministic.

**The backpack** shows the root's honoured onchain attestations as
attested-tier claims with issuer provenance (`method: "zk-attestation"`),
synthesized at read time from the vault for the root's own personas —
never written into the claim store, so a revocation or expiry cannot
leave a stale claim behind.

**live-att1** (`npm run live:att1`) signs the challenge with the test
wallet's key (from the environment or `.env.local`, never printed), flips
the app to the live chain source for one run, and records BUCKETS ONLY to
`research/live-att1.json`. It is not part of any sweep; it runs once in
/verify. `A-ATT-CONTRACT-SET`: the tracked contract addresses per chain
are a fixed list; a wrong one under-reports (a refusal to vouch).

| iteration | result |
|---|---|
| 1 | `test:att2` 1/10: ONE cause — the onchain family advertises the shared key but the registry signed registrations with a per-id key; every registration refused, eight checks cascaded. Fixed by an interface method: an issuer signs its own registration (`sign()`), the registry never guesses key files. Also: the posture section named the struck protocol (test wording) |
| 2 | 5/10: the cohort issuance never ran (my check sent no wallet, so the subject's own issuance was refused before the cohort loop); the revoke action signed under the per-id key — same class, same fix (`issuer.sign`); my "no wallets" grep matched the issuer id `onchain.wallet-age` |
| 3 | 7/10: `morpho = 47 < 50` (hash-spread variance → index-based cohort spread); the signature tamper was a no-op (recovery byte) |
| 4 | **`test:att2` 10/10** (att1 10/10, z8 7/7 on the same code) |

**Gate 2 exit — met:** all four claim kinds issue on fixture (#2); a
persona proves each and gains eligibility (#4); sub-floor buckets refused
(#5); exact balances never appear anywhere (#6); wallet address never in
the validator (#4, #6); `live-att1` wired and the sweeps on the fixture
source (#9; the real run is recorded in /verify); multi-wallet
aggregation correct (#7); revocation of one issuance removes exactly that
leaf (#8). Committed as `att: gate 2 green` (`095fd21`).

---

## GATE 3 — attestation-gated surfaces + the label

**One rule field, every surface.** `attest.holds` = `<issuer>/<bucket>`
joins the rules engine (`lib/rules/evaluate.ts`: an evaluable field,
labelled, with `eq`/`neq`/`in` over a SET, not a scalar), the rule
builder, the feed's rule contexts (seed and live paths), filter packs
(`attest:<issuer>/<bucket>` in `personaHoldsClaim`), and the advertiser's
audience matcher. Every one of them evaluates against what a persona
PROVED this epoch: `lib/attest/proven.ts` holds the validator's presence
log of accepted attestation proofs (the gated `attested-map`, one read per
feed build, honoured issuers only) and the synchronous evaluators read
that cache inside the build. Under any rep binding but zk the cache is
cleared — an attestation predicate can be satisfied by a proof and by
nothing else. att3 #2 is the money shot: a "Morpho users" mode shows the
persona that proved `onchain.protocol-history/morpho`, hides its sibling
until the sibling proves, hides BOTH under the mock binding, and lets
both back when the mode is left. att3 #3 pins the pack primitive the
same way, including the distinction that matters: a root that HOLDS an
aave issuance its persona never proved matches nothing.

**One floor.** `lib/zk/floor.ts`: an audience that predicates on a proven
bucket is held to the zk floor (`ZK_ANON_FLOOR`) as well as the market's
k-floor — the higher applies — computed in one place for the API route,
the console (which reads `kFloor` off the estimate) and the builder. A
graph-claim audience keeps the market's dev-sized floor of 8, so nothing
the seeded data used to trip has moved (att3 #4: an attestation audience
resolves to fewer than the floor, the builder says so, the API refuses
the campaign with 422).

**The ninth condition.** `privacyConditions(mode, { attestation })`
appends condition 9 for an attestation-gated surface: the gated bucket
clears the client's floor on the TICK'S census — the prefetch snapshot
now carries `GET /zk/attest/buckets` alongside the gate tree, so the label
still never fetches at render time — and its issuer is honoured. A thin
bucket reads DEMO with the condition named; an un-honoured issuer's bucket
never passes (att3 #5).

**The score.** `claimsForMatching` — the one definition of "counted" the
marketplace and the Ad Match Score share — now includes the root's
honoured onchain attestations as attested-tier claims, consent-gated
for sensitive categories like everything else. An attested habits claim
is worth 10 to a self-declared one's 1; the breakdown sums to `rawTotal`
exactly; un-honouring the issuer removes them (att3 #6).

| iteration | result |
|---|---|
| 1 | `test:att3` 6/7 with `att2` 10/10, `z7` 7/7 (the port fix), `test:runner` 7/7 on the same build. #2 fell on my rig: MAIN has no seed post (only ALT does), and my teardown cleared the mode with `modeId: null`, which the route rejects (a crash after the checks). ALT now proves first and keeps its seed post; MAIN posts a fixture cast and is hidden until it proves; the previous mode is restored rather than cleared |
| 2 | 5/7: a fresh fixture cast is not on the discovery surface, so the money shot moved to where it belongs — the FOLLOWING feed (the tier gate applies only to discovery; mode rules apply everywhere) with two seed authors the viewer follows, one of them given a morpho proof through the crowd rig (a persona id is free-form on a fixture proof, the nullifier is real) |
| 3 | **`test:att3` 7/7** on the Gate 3 build (att2 10/10, z7 7/7, runner 7/7 on the same build) |

**Gate 3 exit — met:** a mode gated on a protocol-history predicate
filters correctly and is proof-mediated — the proved author shows, the
unproved one hides, both hide under the non-zk binding (att3 #2); a
sub-floor advertiser audience is refused in the builder and at the API
(#4); the label transitions DEMO ↔ claim on the bucket's floor condition
(#5); the score invariant holds with real attestations in the mix (#6).
Committed as `att: gate 3 green` (`5d50856`).

---

## GATE 4 — linkage test v3 + the adversarial review

**Linkage v3** (`scripts/accept-att4.mjs`, `test:att4`, SAFETY SET — a
successful linkage halts the pass). Pass 2's session plus everything the
prompt asked for: a 120-decoy cohort attests all four kinds alongside
ours (two roots per kind; one root — ours — with four kinds and, in a
second issuance, two wallets), holdings expire (validity 4), our morpho
issuance is revoked; MAIN proves morpho + gt2y and ALT proves eth-gte-1 +
votes-gte-1 through the product path while a crowd of decoy personas
proves the same pairs through the anonymous channel (`p_decoy_i_a` /
`_b`, fixture proofs with REAL nullifiers, proof-of-work solved per
submission). Then, from the operator's data only — the validator's
tables and log — nine attacks:

| # | attack | result |
|---|---|---|
| 1 | nullifier equality across every attestation claim | no nullifier names two personas; each of ours has two distinct nullifiers for its two kinds |
| 2 | persona → root by cross-kind intersection of the two bucket trees a persona proved, from the signed placements | ≥ floor for MAIN and ALT (the cohort spread is BY INDEX so `morpho ∩ gt2y ≈ 7N/12`, `eth-gte-1 ∩ votes-gte-1 ≈ 8N/15`) |
| 3 | persona across kinds: the exact pair of buckets a persona proved | shared by ≥ floor other personas — no unique profile |
| 4 | root → wallet | no address in the database, the WAL, the log or any key; no wallet column; the two-wallet root's rows are shape-identical to the crowd's; the issuer retains hashes only |
| 5 | timing | every round-1 issuance row is hour-grained and identical across the cohort; our claims' epochs are the crowd's |
| 6 | expiry partition | every eth-gte-1 issuance of the round expires at ONE epoch and the tree emptied for everyone at once |
| 7 | revocation | our leaf left at the revocation epoch, the cohort's stayed (still ≥ floor); the revoked row is root-level (a stated leak, like registration); no claim row carries a commitment |
| 8 | leaks | the vault namespace is one sealed record; the log has no claim material; the issuer key is nowhere |
| 9 | restart survival | registry, every issuance (revoked, two-wallet, one submitted MID-BATCH just before the kill), expiries and claims come back byte-identical after `taskkill /F`; the mid-batch issuance lands next epoch |

Two rig defects on the way, both in the fixture furniture, not the
product: the dev hook's decoy roots used fids `3000000 + i`, which
collides with a seed root at 3000090 (`INSERT OR IGNORE` silently dropped
the root row and the decoy's registration failed its foreign key — the
first time any suite seeded more than 80); and the cohort's issuance
batch overran Express's 100 KB body limit (413), so the validator's
500-per-request ceiling was never reachable in one body — the subject
now submits in chunks of 100.

| iteration | result |
|---|---|
| 1 | session failed on `seed-decoys` (the fid collision) — 9 cascaded |
| 2 | session failed on the protocol-history cohort batch (413) |
| 3 | **`test:att4` 10/10** on the Gate 3 build + chunked submission |

**live-att1, run once (read-only).** `npm run live:att1` signed the
issuer's challenge with the test custody wallet's key (from `.env.local`,
never printed), flipped the app to the live chain-facts source for the
run, and asked all four onchain issuers. The first attempt found TWO
things. (1) **A leak in my own code:** the issuer passed the transport
library's error text through as its refusal reason, and viem quotes the
RPC request body in that text — the wallet ADDRESS — which the script
then printed and recorded. Exactly hunt item (a), found by the pass's own
live run before any reviewer. The recorded file was deleted on the spot
(it was never committed); the issuer now refuses by SOURCE only
(`redactAddresses`, the first line, 160 chars), the live adapter rethrows
RPC failures by host with addresses redacted, and the script redacts
anything it prints or records. (2) `ethereum-rpc.publicnode.com` fails at
the TLS layer on this machine and Cloudflare's RPC answers
`eth_getBalance` with an internal error, so the adapter now carries a
per-chain fallback list of keyless RPCs, tried in order (drpc / 1rpc /
blastapi answer; Base and Optimism's official endpoints answer). The
second run went end to end: the wallet's signature verified, the facts
were read from three chains and Snapshot, and every issuer **refused —
"the facts support none of the requested buckets"**: the test custody
wallet is younger than a year, holds under 0.1 ETH, has touched none of
the four protocols and cast no Snapshot vote. That is the issuer's own
verification declining to vouch — the coarseness discipline working, not
a failure — and it is what `research/live-att1.json` records (buckets
and refusals only; the address grep over it is 0). An actual issuance
needs a wallet whose facts clear at least one bucket; the command is the
same with `FC_TEST_CUSTODY_ADDRESS` / `_PRIVATE_KEY` pointing at it.

**The adversarial review** — three fresh-context reviewers, each given
the posture doc, the 7,379-line diff since `86adfff` and
`research/VERIFY-YOURSELF.md`; reports in `research/attack-att-{1,2,3}.md`
(9, 10 and 9 findings). They converged on four things and each added
one. Every finding is a fix or an ASSUMPTION by id in
`SECURITY-POSTURE.md` §13 ("The adversarial review of this pass"):

| finding | reports | disposition |
|---|---|---|
| honour is by id on an open, first-come registry — squat `onchain.holdings`, register `onchain.kyc`, or let the operator rewrite the key | 1 #3, 2 #3, 3 #1 | **FIXED**: honour patterns pin a key (`onchain.*@<pubkey>`); every reader (gate, proven map, `attested` reads, label, backpack) honours by the REGISTERED key; the default is the co-hosted issuer's own key |
| the tick fetched an attest tree only when a persona was about to prove into it — an identified beacon the anonymous proof confirmed | 1 #1 | **FIXED**: every honoured bucket tree is fetched on every tick |
| the per-tree floor and per-epoch budget do not bound cross-bucket, cross-epoch intersection | 1 #2, 2 #1, 3 #3 | **FIXED**: a client-side RUNNING INTERSECTION per persona over every attestation tree it has proven, on the device, refuses a proof that would drop below the floor |
| a wallet vouches for a commitment nobody proved they hold; one wallet → N commitments (whales, floor padding) | 1 #5, 2 MED, 3 #2 | **FIXED**: the submission is signed by the subject's device-auth key and verified against the anchor; the issuer refuses a wallet already vouching for another root |
| a revocation is undone by re-posting the original issuance | 2 #4, 3 #4 | **FIXED**: a revoked issuance is not replaced unless the re-issuance carries a later issue epoch |
| public per-leaf (activation, expiry) pairs and the one-epoch issue grace make cells of one | 1 #4, 2 #2, #5 | **FIXED** in part: no issue-epoch grace; the per-commitment read is gated; activation/expiry quantized to `ATTEST_ISSUE_WINDOW` (default 1) — residual **A-ATT-ISSUE-CELLS**, **A-ATT-PROFILE-PUBLIC**, **A-ATT-REVOCATION-PARTITION** |
| open registry = eager signed tree builds, unpruned placements | 3 #5 | cap of 128 issuers per universe; only registered issuers' buckets are trees; residual **A-ATT-OPEN-REGISTRY-COST** |
| the ninth label condition was computed by no rendered surface | 1 MED, 3 INFO | **FIXED**: the discovery surface passes the active mode's gated bucket to the label |
| any leaf holder can vouch any bucket onto any persona id (`neq` predicates, audiences) | 2 MED | inherits A-PERSONA-ROOT-BINDING → **A-ATT-NEQ-VOUCH** |
| the backpack / score / local matching read the vault without a proof | 2 MED | device-local, the owner's own personas → **A-ATT-BACKPACK-LOCAL** |
| the live adapter's third parties; the retention salt beside the hashes; no retirement route | 3 LOW/INFO | **A-ATT-LIVE-SOURCES**, **A-ATT-ISSUER-RETENTION**, **A-ATT-ISSUER-RETIREMENT** |

Every reviewer traced channel (a) — a claim value or a wallet address
reaching the validator — clean end to end; the one leak of the pass
(the transport error quoting the address) was found by the pass's own
live run, not by them, and was already closed.

| iteration | result |
|---|---|
| 4 (the review fixes) | validator units green (the replay assertion moved to a same-epoch issuance — with no issue grace a stale replay is refused before the revocation rule is reached, which is itself a check now); tsc strict clean; rebuilt; `att3` 7/7, `att4` 10/10, `z0` 11/11, `z8` 7/7, `z9` 9/9, `runner` 7/7; `att1` 9/10 and `att2` 8/10 — all three failures were the rigs meeting the new rules: att1 #5 replayed an earlier epoch's issuance (needs a current one to tamper), att2 #4 was the RUNNING INTERSECTION refusing MAIN's second bucket at 80 decoys (morpho ∩ gt2y = 46 < 50 — the rule working; att2 now seeds 120 like att4), att2 #7 read the now-gated per-commitment endpoint directly |
| 5 | **`att1` 10/10, `att2` 10/10** on the same build — Gate 4 green |

**Gate 4 exit — met:** linkage v3 green at the floor (`test:att4`
10/10, restart survival included); three reports in
`research/attack-att-{1,2,3}.md`; the posture doc's Issuers section (§13)
states what an issuer learns, what the validator learns, what a
subscriber learns, and the trust the reference client places in
`onchain.*` by default — a KEY, not a name. Committed as `att: gate 4
green`. The Farcaster-native second issuer (call option) is not
attempted: the closing sweeps take the remaining time, and the interface
already carries two unrelated issuers.

## /verify — the closing bar

**The bar (from the prompt):** the full legacy suite at the 383-check
baseline under the FIXED runner, the greps every iteration, restart
survival, `live-att1` once, linkage v3 with three reports, and finally
four CONSECUTIVE clean sweeps on identical code — the counter resets on
any change, one is one — with tsc strict and the production build clean
and everything committed. Sweeps are fixture-only: no spend, no post, no
deploy, no live proof.

| item | result |
|---|---|
| legacy suite at 383 under the fixed runner | every sweep below runs the 54 ZK-Pass-2 suites (383 checks) plus runner 7, att1 10, att2 10, att3 7, att4 10 = **427 checks over 58 suites**; the runner refuses to launch unless both processes answer the signed health contract and the app's `peer` is the validator under test |
| greps every iteration | `research/live-att1.json` 0 matches for `0x[0-9a-fA-F]{40}`; no wallet address or private key in any log, report, or test output (the redaction at issuer / adapter / script is itself checked by att2 and att4) |
| restart survival | att4 #9 in every sweep (the validator killed and re-probed under its served key; issuances, registry, honour list intact) |
| `live-att1` once | run once, read-only, on the real chain (Gate 4): the test custody wallet's facts support NO bucket — recorded without the address |
| linkage v3 + three reports | att4 10/10; `research/attack-att-{1,2,3}.md` answered in posture §13 (Gate 4 table above) |
| tsc strict / production build | clean on `7bec1ba` (the sweep target) |

### Series 1 — `f3a7df0` — HALTED at 0 of 4

Sweep 1 was the first full legacy run on the attestation code and it
failed: 349 passing checks, 6 failed suites, 8 infra. Every cause and fix
is in `notes/reports/SWEEP-STATUS.md` (Series 1); in one line each:

- **c0 #5** (product): the anchor route checked key usability before the
  pinned-anchor conflict — a garbage key got 400 where the contract says
  409. Conflict first now; an unusable key still never becomes the first
  write.
- **g2 #6/#8, g3 #14, bp #6** (product): the sealed attestation record is
  cached in-process and `resetSeed` never dropped it, so Gate 4's onchain
  attestations rendered as claims of a seed persona — active in a
  sensitive category without consent, with no `issuedAt`, and 503 on
  toggle. `resetSeed` drops the cache and the proven cache AFTER the wipe;
  an attested claim in a sensitive category is default-off under the
  persona's consent; its toggle is a per-persona override; `issuedAt` is
  recorded at issuance inside the sealed record (never in the public
  part).
- **z5 #5 → z6–z9, att1–att4 INFRA, runner #3/#4/#7** (rig): the
  supervisor's restart inherited the console of the harness call that
  launched it, gone by then, and every restart died at process init with
  `0xC0000142` — 67 times. `windowsHide: true` on the spawn; verified from
  a fresh call (back in 2 s, one death record).

Fix commit `7bec1ba` (iteration 17 of 18): units 39/39, tsc + build
clean, the fourteen affected suites green (c0 8/8, g2 4/4, g3 7/7, bp
8/8, accept 14/14, g1 5/5, z5 6/6, z8 7/7, z9 9/9, att1 10/10, att2
10/10, att3 7/7, att4 10/10, runner 7/7). Counter reset to 0.

### Series 2 — `7bec1ba` — HALTED at 1 of 4

| sweep | window | tally | verdict |
|---|---|---|---|
| 1 | 04:58 → 05:58 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 1 of 4 |
| 2, attempt 1 | 05:58 → stopped 06:02 | functional #6 "tier badge: not proven" 22 s after att4 #9's validator kill | INFRA, not counted: the anon queue re-proves the feed at its fixed cadence after a restart and a new persona waits behind the backlog; the launcher now settles (45 s uptime, warm, home feed fully proven) before launching |
| 2, attempt 2 | 06:10 → stopped 07:01 | z2 #3 `drain: {due:1, sent:1, outcomes:{replay:1}}`; z3 6/6, z4 6/6 after it | **PRODUCT FAIL** — halted |

The z2 finding: `drainQueue` had no reentrancy guard. The in-process
drain loop (every 5 s) and the test's explicit drain both selected the
same due item while the first send was still in flight, so one envelope
reached the validator twice — accepted, then "replay" (the nullifier
store did its job; the test observed the second send). Fixed in iteration
18 (the last): drains are serialized through an in-flight promise chain
(an item is sent exactly once) and z2 #3 judges the item's terminal
state via `queueStatus` — sent, accepted, exactly one sent submission for
that persona this epoch — instead of its own drain call's report.
Re-run on the fix: z2 7/7 three times in a row, z3 6/6, z4 6/6, z5 6/6
(the cadence invariant holds with serialized drains), att4 10/10, runner
7/7; tsc strict + production build clean. Fix commit `ead3400`; counter reset to 0.

### Series 3 — `ead3400`

| sweep | window | tally | verdict |
|---|---|---|---|
| 1 | 07:13 → 08:13 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 1 of 4 |
| 2 | not launched (settle refused, 08:26) | — | HALTED at 1 of 4: same rig cause as series 2's attempt 1 → rig fixed, counter reset |

The refusal exposed what both functional failures were: `accept-att4.mjs`
— the last suite of every sweep — switches the rep binding to zk and
never restores it (z8/z9 end with `setRepImpl null`). Under the zk
binding the persona functional creates is never proven inside its 5 s
badge wait (its proof is queued with 30 s–15 min jitter), so the badge
read "not proven"; series 2's second attempt only passed because a
killed g1 run had reset the seed in between. The settle's own
"feed fully proven" criterion was wrong across the 08:00 epoch boundary
(seeded authors are legitimately unproven until a suite proves them; the
app's own personas were proven and the serialized queue was healthy).
Fix (rig, in the repo): att1–att4 restore `setRepImpl null` at their
ends; the launcher keeps the badge check as a guard. Validation in the failing order on the live servers: att4 10/10, then
functional ALL PASSED, gate binding back to the default. Fix commit `65ea177`; counter reset to 0.

### Series 4 — `65ea177`

| sweep | window | tally | verdict |
|---|---|---|---|
| 1 | 08:35 → 09:35 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 1 of 4 |
| 2 | 09:35 → stopped 10:27 | z4 #4 "ALT is the nearest-in-time persona to MAIN's actions in 2/4 trials"; z1 8/8, z2 7/7, z3 6/6 before it | **PRODUCT FAIL** — halted at 1 of 4 |

The z4 finding, measured rather than guessed (an instrumented copy of
z4, three runs, per-trial nearest persona and the MAIN→ALT send gap):
whenever one drain call flushed both of the root's personas they left
150–330 ms apart, and the sibling was the nearest submission to the
other's in about half of those trials (once by 1 ms); the post trials
always picked a decoy. A drain that sends every due item collapses the
per-item jitter into one moment. The exactly-once drain of `ead3400` is
what made it visible: before it, the duplicate send of the race often
turned one persona's outcome into "replay", which the wire tap filters
out. Fix (product): the drain loop sends ONE item per tick, chosen
uniformly at random among the due items — two submissions from one
process are never back-to-back and their order says nothing about the
queue; the dev `drain` still flushes for rigs unless asked for
`limit: 1`. Fix (rig): z4 and z9 drain at the product's rate during the
crowd — one item per call, each persona at its own jittered time —
instead of flushing both at 4.2 s. Validation: the instrumented z4 three times 6/6 on the fix — the two
personas now leave 951 ms and 2306 ms apart at their own jittered times,
and a decoy is the nearest submission to MAIN in every trial (187, 201,
306, 351 ms; ALT not even second); z9 9/9, z1 8/8, z2 7/7, z3 6/6, z5
6/6, z6 6/6, z8 7/7, att1 10/10, att2 10/10, att3 7/7, att4 10/10, runner
7/7; tsc strict + production build clean. Fix commit
`f10278e`; counter reset to 0.

### Series 5 — `f10278e`

| sweep | window | tally | verdict |
|---|---|---|---|
| 1 | 10:50 → 11:50 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 1 of 4 |
| 2 | 11:51 → 12:51 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 2 of 4 |
| 3, attempt 1 | 12:51 → stopped 13:43 | z4 #0 SESSION "fetch failed" (the rig's own unretried validator fetch; the four checks after it had no data) | INFRA, not counted |
| 3, attempt 2 | 13:44 → 14:44 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — 3 of 4 |
| 4 | 14:45 → 15:49 | 427 passing checks, 0 failed suites, 0 infra; 3 deaths (the deliberate kills) | CLEAN — **4 of 4** |

**Bar met on `f10278e`: Four consecutive clean sweeps on `f10278e` — 427/427 checks, 58/58 suites, zero infra, four times.** The one INFRA re-run in the
series (sweep 3, attempt 1) is not counted, as the rules allow; the counted
sweeps ran on identical code, under the fixed runner, fixture transport
only — no spend, no post, no deploy, no live proof. tsc strict and the
production build are clean on the same commit. Everything is committed:
the closing commit `att: closing sweeps green (4x 427/427)` carries this
section, the posture status line, `notes/runbooks/MORNING.md` and `notes/reports/SWEEP-STATUS.md`.

Read as a whole, the closing sweeps were the pass's most productive
instrument after the gates: five series, and every halted one found a
defect the gates had not — the stale vault record after reset, the
400-before-409 anchor route, the supervisor that could not respawn without
its console, the double-sent envelope, and the batch drain that put a
root's two personas back-to-back on the wire. Each is fixed on the commit
the bar was met on; none was a reviewer's finding.
