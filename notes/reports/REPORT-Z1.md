# REPORT-Z1 — ZK Pass 1: Foundation + First Private Gate

Implements `research/RECOMMENDATION.md` with the red-team corrections
C1–C10 as requirements. The eight calls in the prompt were built to, not
relitigated. Crypto gates ran single-threaded.

**Status (2026-09-04): ZK PASS 1 CLOSED.** Gates 0–4 BUILT, ARMED; three
adversarial reviews rebutted (26 findings fixed, the rest ASSUMPTION
lines); every gate suite, the linkage test, live-z2, root-leak and
restart-survival green on the rebuilt bundle; **four consecutive clean
cumulative sweeps (4 × 348 checks, 0 failed, 0 infra)** — see
Verification. The call option (revocation via epoch re-issuance) was NOT
exercised — the Gate 4 rebuttal consumed the iterations; it is
A-REVOCATION-NOT-BUILT.

---

## The finding that reshaped Gate 0 before it started

The ceremony-artifact verification (safety-set) turned up something the
research pass did not know: **the artifacts `@semaphore-protocol/proof`
ships are NOT from the July‑2024 "Semaphore V4 Ceremony" the docs link.**
They come from a **second ceremony — "Semaphore Binary Merkle Root Fix",
finalized 2025‑07‑23** — run after OtterSec reported (2025‑05‑28) an
under-constrained bug in zk-kit's `BinaryMerkleRoot`: missing binary
constraints on the `MultiMux1` selectors let a prover produce a valid
Semaphore V4 proof for a leaf that is NOT in the tree. Fixed in
`binary-merkle-root.circom` v2.0.0 (2025‑06‑30); Semaphore re-ran its
phase‑2 ceremony and shipped the new keys as artifact version `4.13.0`
(proof `4.13.0`, 2025‑08‑27).

Two consequences, both recorded in SECURITY-POSTURE.md:

1. F12 ("under-constrained circuits are the dominant real bug class") was
   not hypothetical for this exact primitive — the audited v4.0.0 circuit
   had a soundness hole for ~a year. The pins in this pass target the
   post-fix ceremony ONLY; a build that regressed to the 2024 artifacts
   would be pinned out.
2. The 2024 ceremony's own bucket no longer exists (`NoSuchBucket`), and
   the Hermez ptau hosts every snarkjs tutorial points at are now 403.
   Provenance of ZK artifacts rots; the record in
   `research/zk-ceremony-verification.json` is the pass's own anchor.

## What the ceremony check established (and what it could not)

Verified (all scripted, hashes in `research/zk-ceremony-verification.json`):

- The ceremony's **own published final zkey** (its S3 bucket, linked from
  ceremony.pse.dev, which the Semaphore docs link) is **byte-identical**
  to the CDN zkey the prover downloads — depth 20 (`33f9a067…`) and
  depth 1 (`471a9788…`).
- The zkey's **embedded transcript** (section 10, parsed with snarkjs's own
  layout): **386 contributions** for depth 20, ending in the coordinator's
  beacon (`mpc-dev-121107909`, beacon `633881ca…`); 1288 for depth 1. Both
  counts match the ceremony page's last-contributor files (`_00385`,
  `_01287`) + 1 beacon.
- An **independent contributor's public attestation** (qpzm, #87 on
  circuit 20, hash `eb516be3…`) appears **verbatim** in the shipped
  transcript.
- The **zkey-derived verification key equals the vkey bundled** in
  `@semaphore-protocol/proof` (α, β, γ, δ₂₀, IC₂₀ all equal) — the F5 pin.
- The ceremony's circuit commit (`3521c96b…`) is **byte-identical** to the
  installed `@semaphore-protocol/circuits@4.14.3/src/semaphore.circom`,
  with `@zk-kit/binary-merkle-root.circom@2.0.0` (the fixed template).
- The ceremony bucket's ptau (`ppot_0080_13`, `ccee2808…`) is byte-identical
  to the public PPOT file.

NOT closed — **ASSUMPTION A-ZKEY-VERIFY**: a completed `snarkjs zkey
verify r1cs ptau zkey`. The ceremony's r1cs is not public (403), and a WASM
circom compiled the identical source to 15,896 constraints where the
ceremony's fits pot 13 (≤8,192) — a different compiler/optimizer, so no
r1cs to verify against. What that leaves open, precisely: that the zkey's
embedded circuit hash corresponds to the audited source (a coordinator
could in principle finalize a key for a different circuit). Reproduction
steps are in the record and the posture doc.

**Judgment call:** the prompt says STOP the gate if hashes cannot be
verified against a published source. They were — against the ceremony's
own published outputs and a third party's published attestation — so the
gate proceeded, with the one un-mechanizable step written as an
assumption rather than a guarantee (F0).

## GATE 0 — BUILT + CLOSED. accept-z0 11/11 (first run, ARMED)

**Identity branch.** `layers/v1/zk-identity/1` in `lib/crypto/kdf.ts` →
32-byte master → stock `@semaphore-protocol/identity` (EdDSA-Poseidon
secret scalar, BabyJubJub key, `C_root = Poseidon(pubkey)`). One per ROOT;
there is deliberately no per-persona accessor. The master and every
encoding of the secret scalar are confined to `lib/zk/identity.ts` and
leak-grepped (`zkMaterialForLeakTest`: master hex, scalar dec + hex,
private-key export).

**The nullifier formula, from the audited circuit and nowhere else** (F10
closed): `nullifier <== Poseidon(2)([scope, secret])` where `scope` is the
circuit input `keccak256(toBeHex(scopeValue, 32)) >> 8n`. `lib/zk/
nullifier.ts` duplicates it with poseidon-lite (Semaphore's own Poseidon);
the bench harness asserts it against a REAL proof.

**A trap the prompt did not name, closed:** Semaphore's `toBigInt()` turns a
non-numeric string into `bytes32` — **max 31 chars, throws above**. Scope
strings are 60+ chars. So application values are hashed to a 248-bit field
element first (`lib/zk/hash.ts` `fieldOf`, domain-separated) and handed to
the prover as bigints. Without this, scopes would have silently been
`bytes32("layers/zk-scope/v1|discovery-tier…")` → a throw at best.

**Scope registry** (`lib/zk/scopes.ts`, frozen, versioned): per-persona
gates scope on `(feature, epoch, personaId)`; one-per-human entries must
declare `onePerHuman: true`; misuse fails closed in both directions (a
per-persona entry without a personaId would silently collide siblings).
Written linkage argument per entry. **Adversarial collision test:** for
every entry, two personas of one root → different nullifiers unless
onePerHuman (then equal — the disclosed semantic); two roots never collide;
epochs separate; the app's nullifiers equal the suite's independent
derivation.

**Registration** (`lib/zk/registration.ts`, validator `POST /zk/register`):
signed by the device-auth key over `layers-zk-register/1|mode|commitment|
rootId|issuedAt`, one per root, first-write-wins 409, idempotent for the
same pair. **Refused from a persona context** (view-as cookie or a
personaId in the body → 400). **Batched:** `active_from_epoch =
epoch_registered + 1`, never a leaf in the registration epoch. Residual
leak stated: the validator learns commitment ↔ account and join-epoch.

**Public trees on the validator** (`validator/zk.js`, migration 004):
`valid` + nested `tier-1..10` (rep ≥ T via the existing `tierForRoot`),
`attest:<issuer>` scaffolded; rebuilt per (mode, epoch) with stock
`@semaphore-protocol/group` (LeanIMT). Epoch length `ZK_EPOCH_MS` (6h).
Members are served whole so the client derives its **own** Merkle path
locally — "give me my path" would tell the validator which leaf asked.

**Signed placements + signed append-only root history** (F8): the
validator mints ONE Ed25519 signing key (node:crypto), signs every
placement (`layers-zk-placement/1|…`) and a hash-chained history entry per
(mode, tree, epoch). The client (`lib/zk/rootHistory.ts`) TOFU-pins the key,
verifies hash + signature + links, refuses a root outside the window (or
outside the one-epoch grace), and **anchors the newest chain hash in the
vault** (`zkRootAnchor`, ciphertext at rest) so a later fork is detected.

**Proof-history budget** (C3/F2b): `ZK_PROOF_BUDGET` distinct predicates per
(persona, epoch), reserved and persisted (vault) BEFORE proving, a hard
429, idempotent for a kind already counted.

**ZkTransport seam** (`lib/zk/transport/`): fixture = a deterministic tag
over the canonical public inputs + the REAL nullifier over the REAL secret
— never a `valid:true` literal. The toy scheme is forgeable BY DESIGN
(public constant), which is exactly what lets the suite forge a
wrong-root envelope and prove the validator's root check stands on its
own. Universe-scoped: `mode` rides every envelope, nullifier row, tree
root; a live envelope is refused by the fixture verifier and vice versa.
Unknown kind fails closed. Replay 409 at the validator's nullifier store.

**Live prover** (`lib/zk/transport/live.ts` + `lib/zk/prover/
semaphore-worker.mjs`): stock Semaphore in a `worker_threads` Worker from a
separate unbundled file — snarkjs (GPL-3) never enters the Next bundle,
verification included. Artifacts are fetched to `.zk-artifacts/`, re-hashed
on EVERY load against the build pins (sha256 + blake2b-512), refused on
mismatch; the vkey pin is checked before prove and verify. The proof is
self-verified before it exists outside the process (F5). Topology call:
in this codebase the device that holds the seed is the user-side Next
process, so the worker is a Node worker in that process and the secret
never crosses a network boundary; a browser Web Worker is the same code
path with the PoC's timings (mobile UNMEASURED-EXTRAPOLATED).

**Anonymity floor:** `ZK_ANON_FLOOR` (50) compared against each tree's
member count, exposed on `/zk/trees` and `/api/zk` for Gate 3's label.

**Bench (`npm run bench:zk`, this host — i7-14700F, node 24):** cold
**549 ms** including artifact load, warm **232–307 ms, median 287 ms**,
verify **12 ms**, proof 635 bytes, depth 20, 513-member group. Artifacts
downloaded from the CDN and hash-verified against the pins (1.9 s). The
harness asserted, against a REAL proof, that the circuit's nullifier
equals `Poseidon(hash(scope), secret)` — F10 closed at the live layer too.
Mobile: **UNMEASURED-EXTRAPOLATED** (`shots/zk-bench.json` says so).

**Leak grep:** `root-leak.mjs` gained the zk needle classes (master, scalar
dec/hex, private-key export) and scans `/api/zk` plus the validator's
`/zk/*` endpoints. Clean: 55 payloads, 9 root-material needles.

**Suites:** `test:z0` (11 checks, wired into `sweep-x.sh`), `validator/test/
zk.test.js` (7, in `test:validator` → 20/20), restart-survival gained a zk
check (registration, verified placement, chain continuous with the vault
anchor, budget, nullifier store), `bench:zk` (live, standalone).

### Judgment calls (logged, not asked)

- **Message binding's `challenge` is epoch-bound and derived locally**
  (`epoch-<n>`), not validator-issued: asking for a challenge is a
  "I am about to prove" signal the validator could correlate. Replay
  across epochs fails on the epoch component and the stale-root grace.
- **BigInt literals avoided** in `lib/zk` rather than bumping the
  project's `es2017` target mid-crypto-pass — the narrow change.
- **The validator now holds one signing key.** Its trust statement changes
  from "holds no private key" to "holds one key that attests its own
  statements"; it never touches user material. Stated in the posture doc.
- **OHTTP library (Gate 1):** `@hpke/core` is the only maintained JS HPKE;
  it passes RFC 9180 test vectors but is not formally audited. Decision for
  Gate 1: build the RFC 9458 framing behind the relay seam with it, and
  record the audit gap as an ASSUMPTION; the privacy condition set stays
  as specified (relay ≠ direct) with the operator's third-party attestation
  as an explicit, non-machine-checkable flag.

### KNOWN-BROKEN / not in scope (Gate 0)

- Nothing KNOWN-BROKEN. A-ZKEY-VERIFY is an assumption, not a break.

### Gate 0 cumulative sweep (all 45 suites then wired, ARMED)

44 suites green; `z0` reported 10/11 — its check 9 had been rewritten
mid-sweep to assert the frozen-epoch invariant that the still-running
(pre-fix) validator did not yet enforce; on the rebuilt servers it is
11/11 (below). Two operational lessons recorded in memory: never edit
`sweep-x.sh` while a sweep executes (bash reads the file incrementally;
the run's TOTAL line was lost to a byte-shift, the per-suite lines were
intact), and snarkjs's worker pool must be terminated explicitly or a
test/bench process never exits.

---

## GATE 1 — The anonymous submission channel (F1, the blocker) — BUILT

**Validator side (`validator/anon.js`, migration 005).** A separate,
unauthenticated endpoint (`POST /zk/anon/submit`) mounted BEFORE the JSON
body parser so a malformed body gets the same constant-shape answer as
everything else. The header set is an ALLOWLIST (`host, content-type,
content-length, transfer-encoding, connection, accept, accept-encoding,
x-zk-pow`); anything else — cookie, authorization, `x-layers-*`,
`x-forwarded-for`, user-agent, referer — is a refusal, and a refused
submission does not consume its nullifier. Rate limiting is a stateless
hashcash PoW bound to the body bytes (`ZK_POW_BITS`, 16): no per-root
state, no token, RLN nowhere near it (C2). Every outcome — accepted /
replay / refused / malformed — is a 256-byte body held to a
`ZK_ANON_RESPONSE_MS` floor. The module logs nothing; the tables the
channel writes were rebuilt `WITHOUT ROWID` and carry no timestamp, so
even arrival order is not kept at rest.

**OHTTP (RFC 9458).** The validator is the GATEWAY: it mints one X25519
key (persisted), serves the key configuration (`/zk/ohttp-keys`), and
decapsulates `message/ohttp-req` bodies (HPKE base mode, X25519 /
HKDF-SHA256 / AES-128-GCM, the RFC defaults) carrying a minimal RFC 9292
Binary HTTP request, handles it exactly like the direct endpoint, and
encapsulates the response under the exported response secret. A dirty
outer request yields an unopenable blob of the same size. The relay is a
separate process the operator must NOT run (`scripts/lib-ohttp-relay.mjs`
is the test relay and says so); `lib/zk/anon/README.md` names candidate
public relays and states the trust dependency plainly.

**Client side (`lib/zk/anon/`).** `client.ts` is the ISOLATED path:
`node:http` with `agent: false` (fresh socket, no pool, no keep-alive) and
an explicit header set; it imports neither the envelope client nor the
validator client, and the suite greps that it cannot. `relay.ts` is the
pluggable seam — `direct` (flagged non-private), `ohttp` (key config
fetched THROUGH the relay, then encapsulate → relay → decapsulate), `tor`
(stubbed: refuses rather than downgrading). `queue.ts` is the jittered,
vault-backed queue: a proof is queued with a CSPRNG-uniform delay in
`[ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS]` (clamped to the epoch window),
drained by an in-process loop, marked `sent` after the wire; a restart
resumes `queued` items and never re-sends `sent` ones.

**Judgment calls.** The HPKE library (`@hpke/core`) passes the RFC 9180
vectors but has no formal audit — recorded as A-HPKE-AUDIT, not hidden.
undici's `fetch` adds `user-agent`/`accept-language`/`sec-fetch-mode` on
its own, which the allowlist correctly refuses — so every clean client
in the repo (the app's, the relay's, the suites') is raw `node:http`.

**Suites:** `validator/test/anon.test.js` (7: direct + replay, header
rejection with non-consumption, PoW binding, constant shape ×4 outcomes,
a full OHTTP round trip with test-side encapsulation, bhttp codec,
operator discipline), `test:z1` (8: header rejection, PoW, constant
shape, isolation + static grep, jitter decorrelation + drain-once, relay
switching with a live relay, operator log/schema grep, precompute-only
grep), restart-survival gained "a queued submission survives the kill
still queued, then drains exactly once".

## GATE 2 — The tier-threshold membership gate on For You — BUILT

**Proof-mediated `tierFor`.** `ADAPTER_REP=zk` binds
`lib/adapters/zk/rep.ts`: `tierFor(personaId)` returns the tier the
persona PROVED this epoch (validator `/zk/eligibility`, current epoch or
the one-epoch grace), 0 otherwise — whatever its root's reputation. The
file contains no root id, no `/rep/` call, no `tierForRoot`; the suite
greps it and checks it behaviourally. The registry's `rep` slot is a
per-call dispatching proxy so suites can switch bindings at runtime;
`resetSeed` clears every zk runtime knob.

**The gate (`lib/zk/gate.ts` + `lib/feed.ts`).** One eligibility read per
feed build (`/zk/eligibility?gateId=foryou`); an author is a discovery
candidate iff its proven tier ≥ `ZK_GATE_TIER`, else — ONLY under the
explicit per-gate `ZK_GATE_FALLBACK=policy` — the legacy tier policy.
`none` is the default: unproven authors do not show. The README states
what `policy` costs: it partitions the anonymity set to "personas that
took the ZK path this epoch". Under the gate the "you always see your
own personas" exemption is the CURRENT viewer's own personas, not the
seed viewer's.

**The product trigger.** Rendering For You for one of OUR OWN personas
(never a view-as session) calls `requestEligibility(persona)`: prove at
idle, queue with jitter, drain later. Nothing on any action path imports
the prover or the channel (suite grep).

**Validator.** `verifyAndRecord` handles both universes: fixture = the
toy tag; live = stock `verifyProof` (snarkjs) after checking its own
bundled vkey against the recorded pin (a swapped dependency on the
validator side is caught too). An accepted `tier-membership` proof
against `tier-T` records eligibility `(persona, gate, T, epoch)`; a
`valid`-tree proof proves non-revocation only and grants no tier.

**The frozen-epoch invariant (found by a unit test, fixed).** Rebuilding
an epoch's tree after a membership change (the decoy dev hook used
`activeNow`) served a root that no longer matched the SIGNED history root.
Trees are now frozen per epoch: membership is computed once and persisted
as signed placements; any rebuild (cache miss, restart) reconstructs the
group FROM THOSE PLACEMENTS and refuses loudly (500) if the root differs.
Decoys batch to the next epoch like every registration.

**The seed.** The viewer personas had no seeded top-level post, so the
demo user's second persona (`backyard_scope`) gained one (`0xvw0001`),
appended after every RNG-driven pick in the generator and old enough
never to displace existing top-40 content.

**Suites:** `test:z2` (7: tierFor never root-side; discovery under
`none`/`policy` before any proof; the full lifecycle to "appears on
another viewer's For You"; tamper refused / replay; grace accepted, past
grace refused; budget exhaustion refused client-side; the product
trigger), `validator/test/zk.test.js` gained eligibility + grace tests and
a LIVE test that verifies a REAL Groth16 proof (skips without cached
artifacts), `live:z2` (real prover end to end with logged times and
screenshots — proves the gate WORKS, never that it is private).

## GATE 3 — The computed privacy label + SECURITY-POSTURE.md — BUILT

`lib/zk/privacy.ts` computes EIGHT conditions at read time, every one by
the app process itself (the first build of this gate used build-bound
"stamps" a suite posted through the route after running a check; the
adversarial review showed a stamp is a caller's claim, not evidence —
attack-2 #4 / attack-3 F-6 — and `lib/zk/stamps.ts` was deleted):
attested non-direct relay; the tier cohort rebuilt from the served
leaves to the signed root, ≥ the CLIENT's floor and within the
continuity limit; jitter on + the scheduler's in-process self-test (a
hostile epoch shape is refused) + the validator's epoch ≥ the client
minimum; the scope-collision self-test on this root's real secret; the
vkey file the verifiers USE is the pin + the cached artifacts hash to
theirs; the budget refusing on a reachable path; the LIVE universe; the
gate fallback `none`. `components/zk/PrivacyLabel.tsx` renders on the
discovery surface under the zk binding: "DEMO — not yet private:
<failing conditions>" (no dismiss control) or the exact narrow claim —
"your persona's root is hidden from this server at the proof layer".
`/settings/zk` shows the status, the eight conditions and the ceremony.

**Suite:** `test:z3` (6: DEMO by default naming relay/floor/universe while
the in-process conditions hold on their own; the conditions cannot be
written by a caller and the suite's own real-nullifier collision check
agrees with the app; the MONEY SHOT — live universe + a floor-clearing
cohort + attested ohttp relay + fallback none → the exact narrow text,
never "anonymous"/"untraceable"; each of direct / unattested / policy /
fixture / thin cohort flips back to DEMO and back; no label under the
legacy binding; the posture doc's sections, eight conditions, exact
label text and the review-forced assumption ids).

## GATE 4 — Operator-view linkage test + adversarial review — BUILT

`test:z4` seeds a session — our two personas plus a floor-plus crowd of
decoy roots (twenty with sibling personas of their own) posting, proving
and getting eligible across two epochs, with decoy submissions crafted
from real decoy secrets and interleaved on the wire — then becomes the
operator: only the validator's rows, the (non-existent) anon logs, and a
wire tap of arrival times. Attacks: nullifier equality across scopes,
join-epoch correlation, proof-history intersection, submission-timing
correlation. Each yields a candidate set for the sibling that must stay
at or above the floor; a successful linkage halts the pass. It also
asserts the validator's process log carries no persona ids, nullifiers
or peer addresses, that the zk vault namespaces are ciphertext, and that
the attribution index is persona-level only.

Three fresh-context adversarial reviewers (metadata/transport,
soundness/crypto, operator-with-DB) were given the posture doc, the code
and VERIFY-YOURSELF.md; their reports are `research/attack-{1,2,3}.md`.
Every surviving finding becomes a fix in this pass or an ASSUMPTION line
in the posture doc — nothing vanishes. The rebuttal follows.

## THE REBUTTAL — 34 findings, line by line

The reviews were run against the Gate 0–4 build after its own suites
were green (z0 11/11, z1 8/8, z4 6/6 — the linkage test passed). Their
verdict, which I accept: **the circuit-facing crypto held; the layer
lost where it measured itself against things the adversary controls.**
Attack-2 found the verifier did not enforce the binding the posture
claimed; attack-1 found the client's own persistence handed the operator
the sibling table; attack-3 found the client's defences were measured
against the operator's numbers and stored on the operator's disk. Those
are mine, not the library's. Dispositions:

### Fixed in this pass (the second Gate 4 iteration)

| Finding | Severity claimed | Verdict | Fix |
|---|---|---|---|
| attack-2 #1 — verifier never re-derives `scope`/`message`; persona and gate unbound | CRITICAL | **Correct.** The project's own live test enshrined the hole (`scope = 1234567n`). | `validator/zk.js` re-derives scope, challenge and message from (persona, gate, epoch, root) with deliberate duplicates of `fieldOf`/`scopeString` and refuses any envelope whose values differ, BEFORE the proof is read. Unit tests: proof for A named B → 400; fresh scope → 400; wrong challenge → 400; live: tampered message → binding refusal, tampered points → groth16 refusal. z0/z2 assert a re-labelled envelope is refused over the anonymous channel. Residual A-PERSONA-ROOT-BINDING (persona↔root is not in-circuit). |
| attack-2 #2 — vkey pin targets a file no verifier loads | HIGH | **Correct.** `verifyProof()` used a copy inlined in dist. | Neither verifier calls `verifyProof()`. The worker and the validator read the pinned file, hash the bytes they read, slice depth 20 from the same bytes and call `snarkjs.groth16.verify` directly (public signals computed with a duplicate of the library's keccak hash). `zk-ceremony-verification.json` corrected. |
| attack-2 #3 — replay keyed on the nullifier's string encoding | HIGH | **Correct** (78-digit regex vs a 77-digit field). | Canonical decimal only (`^(0\|[1-9][0-9]{0,76})$`) on every public value and the nullifier, both sides; the padded copy is refused and never inserted (unit test counts the rows). |
| attack-2 #4 / attack-3 F-6 — label evidence self-asserted over an unauthenticated route | HIGH | **Correct.** | `recordCheck` and `lib/zk/stamps.ts` deleted. Conditions 3–6 are in-process self-tests computed at read time (`lib/zk/selftest.ts`, `jitterSelfTest`). Every override / fabrication / pipeline-on-demand / oracle action on `/api/zk` is refused unless `ZK_DEV_HOOKS=true` (the validator's flag, now on the app too). |
| attack-2 #6 — universe switch remotely settable | MED-HIGH | Correct as reachability. | `setZkMode` dev-gated; condition 7 requires the live universe. |
| attack-2 #7 / attack-1 #4 — budget counts one claim kind; can never refuse | MEDIUM | **Correct** — mitigation theatre. | The budget counts the PARTITIONING predicate `(claimKind, tree, gateId)`; z2 exhausts it with three REAL proofs (valid, tier-1, tier-2); the label's self-test uses real partitions and states what it evidences. Epochs remain unbounded — stated. |
| attack-2 #8 — floor gates the label, not the feature | MEDIUM | Correct. | `cohort` stage in `prepareAndProve` refuses below the client's floor (z0 check 9 proves into tier-10 and is refused). |
| attack-2 #10 — `/zk/submit` bypasses Gate 1 | LOW-MED | Correct. | Dev-only (403 otherwise); the product submits only over the anonymous channel. PoW residual A-POW-COST. |
| attack-1 #1 — vault seals values, not addresses; budget key = `personaId:epoch` | LINKAGE | **Correct, verified against the DB.** The worst finding of the three for this layer's stated purpose. | The budget and the anchors are no longer persisted on the validator at all — device-local `lib/zk/localPins.ts`, beside the seed. The one remaining zk vault namespace (the queue) is ONE opaque sealed record padded to 1 KiB steps: no keys, no count, no per-item size. |
| attack-1 #2 — identified `PUT /state/zkQueue` ~150 ms after every anonymous send | LINKAGE | **Correct.** | The `sent` mark is persisted on its own CSPRNG delay from the jitter window, never at send time; z1 asserts `persistPending` after a drain. Cost: a crash in that window re-sends once → the validator answers `replay`. |
| attack-1 #3 — the prepare burst is unjittered and repeats per render | NARROWING→LINKAGE | Correct. | Once per (persona, epoch): a second `requestEligibility` in the same epoch is skipped (z2 check 7). The burst itself is stated: A-PREPARE-BURST. |
| attack-1 #5 / attack-3 F-9 — `/zk/eligibility` is a public, pollable arrival oracle | NARROWING | Correct. | Reads take the device-signed envelope when the deployment is armed (`mountZk(app, db, {requireSig, checkEnvelope})`; the app signs its reads); rows older than the grace are pruned on write. z2 asserts an unsigned read is 401. |
| attack-1 #6 — request unpadded; the relay's passive log joins by length | NARROWING | Correct. | Every submission is exactly 4096 bytes (`paddedBody`); an envelope that cannot fit is refused, never sent unpadded. Time-join residual A-RELAY-PASSIVE-JOIN. |
| attack-1 #7 — tree build inside the first submission's timing floor | weak | Correct. | Trees build on a 30 s timer, never inside a submission. Cold snarkjs load residual A-TIMING-FLOOR-ONE-SIDED. |
| attack-1 #8 — anchor address and write cadence observable | NARROWING | Correct. | Moot: the anchor never leaves the device now. |
| attack-1 #9 — the topology assumption is cited but not written | SOUNDNESS-of-claim | Correct — the code comment pointed at a paragraph that did not exist. | SECURITY-POSTURE.md §8, A-TOPOLOGY; A-ESCROW-BLAST-RADIUS flagged. |
| attack-1 #10 — `personas.root_id` is a foreign key the operator holds | CLAIM-SCOPE | Correct as a documentation gap; not a new capability. | Stated in §2 beside C5. |
| attack-3 F-1 — cohort rotation between epochs isolates a root with every defence green | CRITICAL | **Correct**, and the admitted form (static curation) was the weak one. | Cohort continuity on the device: refuse to prove into a cohort from which > 20% of the last-proved-into cohort is missing; a refused epoch never moves the baseline. Bounded, not closed — A-COHORT-ROTATION gives the arithmetic (≈28 epochs at 20% churn for a 500-leaf cohort). |
| attack-3 F-2 — the floor is a boolean the validator sends | CRITICAL (label) | **Correct.** | `lib/zk/cohort.ts`: leaves rebuilt to the signed root with a local LeanIMT, counted against the client's `ZK_ANON_FLOOR`; `clearsFloor` off the wire is never read. |
| attack-3 F-3 — anchor and budget stored on the adversary; "absent" is benign | HIGH-CRITICAL | **Correct.** | Device-local pins; a corrupt pins file is a loud refusal, never a re-TOFU; only a fresh device is a first sight (stated). |
| attack-3 F-4 — `{epochMs:0}` collapses jitter to a fixed +30 s; `null` suppresses forever | HIGH | Correct. | `jitterWindow()` validates the epoch shape (finite, ≥ `ZK_EPOCH_MIN_MS`, ≤ 7 d, remainder inside it) and refuses to schedule otherwise; a legitimate clamp keeps ≥ ¼ of the configured spread; the synthetic path goes through the same function. z1 probes the hostile shapes. |
| attack-3 F-5 — label omits `mode` and the fallback | HIGH | Correct. | Conditions 7 and 8. The z3 money shot now runs in the live universe. |
| attack-3 F-7 — TOFU per (mode, tree) | MED-HIGH | Correct. | One global validator-key pin on the device; a different key is a refusal, never a re-pin. |
| attack-3 F-10 — dev hooks: live epoch burn; fixture reset wipes live anchors | MEDIUM | Correct on the mode crossing. | `resetZk` is mode-scoped; the explicit `reanchor` ritual exists; `advance-epoch` stays a dev hook and the posture says the flag makes the validator a test rig. |
| attack-3 F-11 — placement "verified" with the key served in the same breath | LOW-MED | Correct. | Verified against the device-pinned key; status reports `keyPinned` / `servedKeyMatchesPin`. |
| attack-3 F-12 — eligibility is a permanent presence log at an operator-chosen grain | LOW-MED | Correct. | Pruned to current + grace; the client refuses an epoch shorter than `ZK_EPOCH_MIN_MS` (1 h). Residual A-PRESENCE-LOG. |

### Stood as ASSUMPTIONS (no fix possible in this pass; each is a line in SECURITY-POSTURE.md §3)

attack-2 #5 (one snarkjs for both verifications → A-VERIFIER-MONOCULTURE);
attack-2 #9 (one global device-auth anchor → A-SINGLE-TENANT-REGISTRATION);
attack-2 #11 (cwd resolution of the vkey path — the worker now hashes the
file it actually loads, so a divergent copy is a refusal, not a silent
swap; noted under A-HOST-INTEGRITY); attack-3 F-8 (the anchor commits to
the past; gaps are normal → A-HISTORY-COMMITS-TO-THE-PAST); attack-3 F-13
(revocation never written → A-REVOCATION-NOT-BUILT); attack-1 #4's second
half (the decorrelation evidence is scheduler-level →
A-DECORRELATION-IS-SCHEDULER-LEVEL); attack-1 #6's time join
(A-RELAY-PASSIVE-JOIN, A-GATEWAY-KEY-ROTATION); attack-1 #3's identified
preparation (A-PREPARE-BURST); attack-3 F-1's longitudinal residual
(A-COHORT-ROTATION); the presence log (A-PRESENCE-LOG); the public leaves
(A-MEMBERS-PUBLIC); the open demo console (A-DEV-SURFACE); the seed escrow
(A-ESCROW-BLAST-RADIUS).

### Where the reviewers overstated, and what I did not accept

- attack-1 #1's "this is worse than any admitted assumption": true for the
  ZK layer's own store, but in THIS deployment the operator already held
  `personas.root_id` (attack-1 #10), so the sibling table was never secret
  from it. The fix stands anyway because step 2 (fork continuity) removes
  that column and the vault leak would have outlived it.
- attack-2 #4 rated remote reachability MEDIUM (a local single-user Next
  process). Agreed — and gated anyway, because a CSRF from a visited page
  was a real vector (`req.json()` ignores Content-Type).
- attack-3 F-10's "advance-epoch should be fixture-only": not accepted —
  the one-time live demonstration needs it, and with the flag off it is a
  403 like every other hook. Stated instead.

### What the reviews could not break (their own lists, kept for scope)

Nullifier collision between siblings; poisoned epochs breaking the scope;
forking the history against an anchored client; serving a root outside
the history; learning the leaf index (the path is derived locally);
reading siblings out of the nullifier store; correlating the anonymous
and authenticated channels by request shape or socket; RLN-style
re-linking; tree/root confusion; depth downgrade; the empty-tree root;
server-supplied Merkle paths; cross-epoch replay; nullifier argument
order; hash-encoding drift; separator injection; extracting the secret
through the transports. Twenty-nine attempts, three reports, none of them
through the proof layer.

---

## VERIFICATION — the fix iteration, on the rebuilt armed bundle

Every number below is from the run after the rebuttal fixes, servers
restarted on the new build with `ZK_DEV_HOOKS=true LAYERS_REQUIRE_SIG=true`
on BOTH processes (the app's test-rig actions are now refused without the
flag, like the validator's hooks).

| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| `next build` (armed) | clean |
| validator unit tests (`zk.test.js` + `anon.test.js`, in-memory DB) | **18/18** — incl. the claim-binding test (proof for A named B → 400; fresh scope → 400; padded nullifier → 400 and NOT a new row), the live Groth16 test verifying against the pinned file (tampered message → binding refusal; tampered points → groth16 refusal; re-labelled persona → refusal; padded live nullifier → refusal), the dev-only plain door, and the armed eligibility read (401 without the envelope; trees/members stay public) |
| `test:z0` Gate 0 | **11/11** — anchors ON THE DEVICE and NO anchor namespace on the validator; the prove path refuses a thin cohort at the `cohort` stage; a re-labelled envelope refused by the validator's claim binding; a leading-zero nullifier refused |
| `test:z1` Gate 1 | **8/8** — constant 4096-byte requests; hostile epoch shapes `{epochMs:0}` and `{epochMs:null}` refused by the scheduler, a legitimate clamp keeps ≥ ¼ spread, the synthetic path goes through the same validation; the `sent` mark is NOT persisted at send time (`persistPending`) |
| `test:z2` Gate 2 | **7/7** — lifecycle over the anonymous channel; an unsigned eligibility read is 401; a proof re-labelled to the sibling is refused; the budget exhausted by three REAL partitions (valid, tier-1, tier-2) and idempotent on a counted one; a second trigger in the same epoch is skipped |
| `test:z3` Gate 3 | **6/6** — the MONEY SHOT in the LIVE universe: all eight conditions computed in-process → the exact narrow claim; direct / unattested / policy / fixture / thin cohort each flip it back; no caller can write a condition |
| `test:z4` Gate 4 linkage | **6/6** — nullifier equality, join epoch, proof-history intersection, submission timing: candidate sets never below the floor; operator artifacts clean |
| `live:z2` (once, never in sweeps) | **PASSED.** Live universe, tier-2 cohort 81 (client floor 50, continuity: not first sight). Real Semaphore v4 proof in the forked prover: **386 ms proving, 1271 ms wall** (fork + artifact re-hash + proof); tampered proof refused locally in 356 ms; clean verified in 315 ms; anonymous submission accepted (direct relay, 195 ms, PoW 22 ms, **4096 bytes**); validator verified against the pinned key → eligibility tier 2 → `tierFor` 2 → the persona's post on another viewer's For You (`shots/live-z2-foryou-before.png` / `-after.png`, `shots/live-z2.json`); replay → replay |
| `test:rootleak` | clean — 55 payloads, 10 root-material needles (zk master, secret scalar dec/hex, private-key export among them) |
| `restart-survival` write → hard kill both → verify | **31/31** — registration, signed placement, root history continuous with the DEVICE anchor, the key pin and the cohort record, the proof budget and the nullifier store survived; a queued jittered submission survived still QUEUED and drained exactly once |
| closing sweeps (4 consecutive, all 47 suites, fixture) | see below |

**Two things the fix iteration found on its own.** (1) live-z2 had never
actually proved through the Next server before this iteration (its
earlier run died on the tier-0 route bug before the prove step, and the
bench proves on the main thread): under `next start` the prover worker
died with "Worker is not a constructor" — snarkjs's thread pool is built
through the `web-worker` polyfill, which inside a `worker_threads` worker
mistakes itself for its own child, in both the ESM and CJS builds. The
prover is now a **child process** (`fork`, one job over IPC, killed on
report); the isolation and the GPL boundary are the same, and the secret
crosses an OS pipe rather than a thread boundary (§8 of the posture doc
says so). (2) The "17 unproven cards surviving fallback=none" from the
previous z2 run were the viewer's OWN posts — the gate exempts a viewer's
own root by design; the test now excludes own-root posts from the
candidate count.

### Closing sweeps

**First attempt (stopped).** Run 1 was clean — 50 suites, 348 passing
checks, 0 failed, 0 infra (~40 min). Run 2 stopped: `z3` 5/6 (check 4,
"surface did not return to private") and `z4` INFRA with no summary line.
Diagnosis, not assumption: the validator PROCESS had vanished — no
listener on :4000, its PID gone, its log ending at "listening" with no
stack, nothing in the Windows application log, its database last written
at 16:24:27, the z3 failure at 16:25:03. With the validator unreachable
the label's cohort condition fails closed (DEMO — correct behaviour) and
z4's server check refuses to run (INFRA — correct behaviour). No suite in
the sweep kills processes (the two scripts that do are not in `SUITES`),
nothing in the validator calls `process.exit`, and a re-run of the exact
sequence (the queued live proof draining into the validator's own Groth16
verification, then z3, then z4) passed 6/6 + 6/6 with the validator alive
throughout. The cause is therefore NOT established; it is recorded as an
infrastructure blemish, not rounded away. What changed for the second
attempt: the validator now logs its own exit, signals and uncaught errors
(`validator/server.js`, process lifecycle only — no request data), and the
sweeps run it under a supervisor that records the exit code and signal as
seen by the parent (which catches even a silent external termination) and
restarts it. If it dies again there will be a code.

**Second attempt (stopped, cause found and fixed).** The validator,
supervised, never died. Run 1 stopped on `x3` check 6 — an X-parity
crossposting suite, "crosspost toggle did not appear in the composer" —
with all six ZK suites green and 347 checks passing. Root cause, read
from the code rather than re-rolled: `GET /api/crosspost` estimates each
bound destination's cost with a single adapter call and silently omits the
destination when it throws — and the mock adapters fail 2% of calls BY
DESIGN (`lib/adapters/retry.ts`). One failed estimate blanks the price
panel, so the toggle never renders; x3 had passed in the three sweeps
before it (≈2% per attempt is one miss in ~5 runs). The route is the one
fan-out that never adopted the repo's own rule — retry adapter reads,
still fail closed after persistent failure — and now does
(`retryAdapter(() => dest.costEstimate(draft))`). Not a ZK change; a
legacy gap the closing bar happened to expose.

**Third attempt (interrupted by a power loss, not a failure).** On the
rebuilt bundle with the crosspost retry in place: run 1 **clean — 50
suites, 348 passing checks, 0 failed, 0 infra**; run 2 was 25/50 suites
in, all green, when the machine lost power and rebooted (18:58). The
supervised validator never died (its death log holds only the start
line). Counted as evidence, not as part of the four: the bar is four
CONSECUTIVE clean runs, and a reboot between runs is not that.

**Fourth attempt — THE BAR MET.** Same build (`.next/BUILD_ID`
`VSCG3G6375hj1xPXojoE_`, armed, crosspost retry in), servers restarted
after the reboot, validator supervised. Four consecutive sweeps of all
50 suites, fixture only, never proving live:

| run | ended | suites | passing checks | failed suites | infra |
|---|---|---|---|---|---|
| 1 | 19:58 | 50/50 | **348** | 0 | 0 |
| 2 | 20:48 | 50/50 | **348** | 0 | 0 |
| 3 | 21:38 | 50/50 | **348** | 0 | 0 |
| 4 | 22:27 | 50/50 | **348** | 0 | 0 |

The ZK lines were identical in every run — z0 11/11, z1 8/8, z2 7/7,
z3 6/6, z4 6/6, root-leak clean (55 payloads, 10 needles), validator
units 18/18 — and the validator's death log holds only its start line.
Counting the interrupted third attempt, that is six consecutive clean
full runs on this build (5 whole, 1 half) with zero product failures.

### Closure, stated exactly

- **Every gate suite green, four consecutive clean cumulative sweeps,
  `tsc` strict clean, production build clean** — the necessary bar.
- **The additional bar (F0):** ceremony-artifact hash verification (z0
  check 2 + `checkCachedArtifacts` re-hashed at every label read, every
  sweep); the scope-collision test on real nullifiers (z0 check 6, z3
  check 2, and the in-process self-test the label computes); the
  operator-view linkage test (z4, 6/6, four times); SECURITY-POSTURE.md
  listing every assumption by VERIFY-YOURSELF id and by review finding.
- **Safety set:** nothing KNOWN-BROKEN. Every safety item (ceremony hash
  verification, scope collision, identifying-header rejection, operator
  log grep, computed label correctness, operator-view linkage, key/secret
  leak grep) passed in every run.
- **Not done, said plainly:** the call option (revocation via epoch
  re-issuance) was not exercised — A-REVOCATION-NOT-BUILT; `snarkjs zkey
  verify` was not completed — A-ZKEY-VERIFY; the one silent validator
  death of the first sweep attempt has no established cause and is
  recorded as such.

## WHAT THE NEXT STEPS NEED — written from what this pass actually built

### Step 2 — fork continuity (and the end of the plaintext attribution index)

What this pass hands it: a verifier that binds a proof to the persona it
grants (the claim binding); device-local pins; a cohort floor and
continuity check the client computes itself; a submission channel with
constant-size requests and no identified write at send time; a label
that cannot be talked into "private" from the wire.

What it does NOT hand it, and step 2 must build:

1. **The persona↔root relation is still the operator's table.** Today
   `personas.root_id` is a foreign key and `tierFor` under the legacy
   binding reads the root's tier. The zk binding replaces that for ONE
   gate (For You discovery). Step 2 has to make every persona-level
   reputation read proof-mediated — every `adapters.rep.tierFor` call
   site, not one — before the `root_id` column can go. Until it goes,
   "hidden at the proof layer" is the whole claim (posture §2).
2. **A persona must be provably the prover's own — in-circuit.** The
   verifier binds persona → scope/nullifier; nothing binds persona →
   the leaf that proved except `isOwnPersona`, which the prover enforces
   on itself (A-PERSONA-ROOT-BINDING). Fork continuity ("this persona was
   forked from that one, by the same root") is exactly this relation.
   The conservative design that stays inside stock circuits: derive ONE
   Semaphore identity per persona from the root seed (a per-persona HKDF
   branch, the same discipline as `zk-identity/1`), register persona
   commitments BLIND (the validator must not learn which commitments
   share a root — which means the device-auth-signed registration of
   this pass cannot be reused as-is), and carry root-level reputation to
   persona-level leaves through an issuance the validator signs without
   seeing the link. That last clause is the placement-circuit problem in
   another form; if it cannot be done with a stock circuit it is a custom
   circuit and inherits F4/F7 (a new ceremony, a new audit) in full.
3. **The attribution index must become persona-signed AND root-blind.**
   It is persona-signed already (crypto pass); root-blind means the
   validator's `castHash → personaId` row must not sit beside a
   `personaId → rootId` row. Same dependency as (1).
4. **The preparation must stop being an identified beacon** (attack-1
   #3, A-PREPARE-BURST): a fixed-schedule prefetch of the epoch, the
   leaves and the history for every client whether or not it intends to
   prove, and proving from that cache. Cheap; not built here only because
   the iteration budget went to the rebuttal.
5. **Cohort rotation needs the placement circuit, not a tighter churn
   knob** (A-COHORT-ROTATION gives the arithmetic).

### Step 4 — attestations (`attest:<issuer>` trees)

What this pass scaffolded on purpose: the tree namespace (`attest:*`
listed, no issuers, so no such trees exist); the reserved
`one-human-attest` scope entry with `onePerHuman: true` and its linkage
argument written down (siblings collide BY DESIGN — a disclosed link,
C7's opt-in waiver); a proof-history budget that counts PARTITIONS
`(claimKind, tree, gateId)` — an attestation tree is a partition, so the
F2b intersection (tier ∩ attestation) is exactly what the budget will
start refusing.

What step 4 must add:

1. **Issuance records and an issuer key.** A validator table
   `(issuer, commitment, epoch_from, epoch_to, sig)`; `buildTrees`
   includes `attest:<issuer>` from it under the same frozen-epoch
   invariant and the same batching (active from the next epoch).
2. **A second claim kind.** `ClaimKind` gains `attestation-membership`;
   `SCOPE_FOR_CLAIM` maps it to a per-persona scope entry for gates (and
   ONLY to `one-human-attest` for counting features, at the point of use,
   with the waiver copy); `validator/zk.js`'s `SCOPE_FOR_CLAIM` duplicate
   gains the same row — the verifier's claim binding is per kind, so a
   kind the verifier does not know fails closed, as today.
3. **Expiry = revocation via epoch re-issuance** — the call option this
   pass did not exercise becomes mandatory: an attestation that cannot
   lapse is a permanent partition of the candidate set.
4. **The budget default must be re-decided.** With two claim kinds the
   refusal path is live in production for the first time; 2 partitions
   per persona per epoch means "a tier proof and one attestation, or two
   tiers, never all three". That is a product decision, made
   consciously, with the intersection cost in front of it.
5. **No label change.** The eight conditions already cover an
   attestation gate; condition 2 (floor + continuity) applies per tree,
   and an attestation tree will be SMALL — the floor will keep most
   attestation gates dark until they have fifty members, which is the
   correct behaviour and should be said in the product copy.
