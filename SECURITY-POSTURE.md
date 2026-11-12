# SECURITY-POSTURE — the ZK layer, in plain language

This document says exactly what the ZK layer hides, what the operator can
still do, what is assumed rather than verified, and what the word
"private" means when the product shows it. Anything unverifiable is written
as an ASSUMPTION, never as a guarantee. It is updated every gate; the Gate
3 label logic computes the same conditions this document describes.

**Status (2026-09-06, ATTESTATION PASS CLOSED — verification bar met):**
the open issuer interface is the architecture (issuers register
themselves, buckets are membership trees, issuance is issuer-signed and
device-submitted, the validator never learns a claim value, a subscriber
honours an issuer by KEY) and `onchain.*` is the one working reference
issuer (wallet age, coarse holdings, protocol history, governance; fixture
+ live chain facts; one wallet → one root). Gates 0–4 built and verified,
linkage test v3 green at the floor, three adversarial reviews
(`research/attack-att-{1,2,3}.md`) answered in §13. **Four consecutive clean sweeps on `f10278e` — 427/427 checks, 58/58 suites, zero infra, four times** — see
`notes/reports/REPORT-ATT.md` /verify and `notes/reports/SWEEP-STATUS.md`; the closing sweeps
themselves found five defects the gates had not (a vault record that
survived reset, a 400-before-409 anchor route, a supervisor that could not
respawn without its console, a double-sent envelope, and a batch drain
that put a root's two personas back-to-back on the wire) — all fixed on
the commit the bar was met on. ZK Pass 2's bar (2026-09-05) was four clean
sweeps at 383/383 with `research/attack-z2-{1,2,3}.md` answered in §12;
Pass 1's (2026-09-04) likewise with `research/attack-{1,2,3}.md` rebutted
in `notes/reports/REPORT-Z1.md`. The privacy label is DEMO — not yet private —
until the eight conditions in §4 hold; in this repository's demo
topology it can only hold in the local validator's live universe with an
operator-seeded cohort (§2, C1) and an attested relay — which is the
honest state of a layer whose set contents are trusted.

---

## 1. What is now mathematically hidden (given the conditions in §4)

**persona → root, at the proof layer.** A Semaphore v4 membership proof
shows "some registered root in `zkTier[T]` authorizes this persona" without
revealing which root, from the proof's cryptographic content alone. The
proof binds `personaId ‖ gateId ‖ challenge ‖ treeRoot` in its message and
emits a nullifier `Poseidon(hash(scope), secret)` where the scope is
`(feature, epoch, personaId)` — so two personas of one root emit two
unrelated nullifiers, and the same persona emits one per epoch.

**And the verifier enforces that binding.** The validator re-derives
`scope`, `challenge` and `message` from the persona, gate, epoch and root
it is about to record eligibility against, and refuses any envelope whose
values are not exactly that derivation — before it looks at the proof.
Until the adversarial review (attack-2, finding 1) it did not: a proof
over opaque field elements proved only "some leaf produced this", and the
persona it granted was prover-chosen. Field elements are accepted only in
their canonical decimal encoding, so a nullifier's string and its value
are one-to-one (attack-2, finding 3).

That is the whole claim at the proof layer. Everything below is what the
proof layer does NOT decide.

## 2. What the operator can still do

- **Curate the sets (C1) — including fabricate them.** The validator
  decides which commitments go into `valid`, `tier-T`, `attest:*`. Leaves
  are opaque; a corrupt operator can place any commitment in tier-10,
  decline to revoke a compromised root, or pad a tree with leaves it
  minted itself, undetectably. A floor computed over such a tree counts
  the operator's own leaves. Placements and the root history are SIGNED,
  so what it served is auditable — but the contents are TRUSTED. Making
  the predicate itself trustless needs a placement circuit (a later step).
  The DYNAMIC form — rotating a floor-clearing cohort between epochs to
  intersect a persona's proofs down to one root — is bounded, not closed:
  see A-COHORT-ROTATION.
- **See the plaintext attribution index (C5), and persona → root as a
  foreign key.** `castHash → personaId` from the FC pass stays in the
  operator's store under access control, not crypto — and so does
  `personas.root_id`, the phase-1 column that maps every persona to its
  root outright. The ZK layer changes neither, and says so: "hidden at
  the proof layer" is the exact scope of §1. Removing the attribution
  index is step 2 (fork continuity), not this pass.
- **Observe account-existence and join-epoch (C10).** Registration is
  authenticated by the device-auth key over the normal channel: the
  validator learns `commitment ↔ account` and the epoch it joined.
  Insertion is batched to the next epoch so "first proof after an insert"
  cannot single out the newcomer; the join itself is visible.
- **Read the persona on every proof (F2b), and keep a presence log.**
  `personaId` is in the clear in the proof's message, and the eligibility
  store records which personas proved what, per epoch. The store is
  pruned to the current epoch and its grace and is served only under the
  device-signed envelope when the deployment is armed — but the operator
  reads its own table. The proof-history budget bounds how many
  PARTITIONS a persona proves per epoch; it does not bound epochs. See
  A-PRESENCE-LOG and A-COHORT-ROTATION.
- **See the preparation.** Before a proof exists the client fetches the
  epoch, the leaves and the signed history and writes the queued item —
  on the identified channel, at the time of the motivating render. Once
  per persona per epoch. See A-PREPARE-BURST.
- **Run the transport.** Until a non-colluding relay is configured (§4
  condition 1), the operator sees the submitting IP.
- **Use the dev surface, if it is left on.** With `ZK_DEV_HOOKS=true` the
  validator is a test rig (epoch clock, decoy cohorts, resets) and the
  app's test-rig actions (overrides of relay / universe / rep binding /
  fallback, pipeline-on-demand, nullifier oracle) answer to anyone who can
  reach the app. See A-DEV-SURFACE.

## 3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review

Format: flag → mechanical mitigation applied in this pass → residual.

- **F4 (setup integrity) → A-ZKEY-VERIFY.** Applied: the ceremony's own
  published final zkey is byte-identical to the CDN zkey (depths 1, 20);
  the embedded transcript (386 contributions, coordinator beacon) is
  parsed and matches the ceremony page; an independent contributor's
  published hash is present verbatim; the zkey-derived vkey equals the
  pinned vkey file; the ceremony circuit commit equals the installed
  source. And the pinned vkey file is now the key both verifiers USE (the
  worker and the validator read it, hash the bytes they read, and call
  snarkjs directly — attack-2 finding 2 found the pin covered a file the
  library's verifier never loaded). Residual: `snarkjs zkey verify` was
  NOT completed — the r1cs is not public and a WASM circom produces a
  different constraint count. To close: compile `semaphore.circom` @
  `3521c96b` with the ceremony's compiler version, then `snarkjs zkey
  verify main.r1cs ppot_0080_13.ptau semaphore-20.zkey` → expect `ZKey
  Ok!` with the 386-entry transcript.
- **A-VERIFIER-MONOCULTURE.** The client's self-verification and the
  validator's verification now both use the pinned key, but both run the
  same `snarkjs@0.7.5` on the same host class. They are not independent
  evidence against a tampered snarkjs or a circuit under-constraint; a
  second Groth16 verifier implementation is not shipped.
- **F7 (audit scope) → A-AUDIT-SCOPE.** PSE's internal audit covered
  v4.0.0. The BinaryMerkleRoot under-constraint bug (reported 2025‑05‑28,
  fixed 2025‑06‑30, re-ceremony 2025‑07‑23) was found AFTER that audit, by
  a third party. The shipped circuit is the post-fix one; no third-party
  audit of the fixed circuit was located. Residual: a further
  under-constraint in the current circuit would pass every test here.
- **A-PERSONA-ROOT-BINDING.** The verifier binds the persona to the scope
  and the nullifier (one persona per proof per epoch, and a proof for A
  cannot be re-labelled B). It does NOT bind the persona to the prover's
  ROOT in-circuit — that a persona belongs to the root whose leaf proved
  is the client's own restraint (`isOwnPersona`) plus the operator's
  `personas.root_id` table. A persona↔commitment relation in the circuit
  is a later step.
- **F8 (split view) → applied:** signed hash-chained history, ONE
  validator key pinned on first sight on the DEVICE, client-side chain
  verification, a per-tree anchor on the device, refusal of roots outside
  the window/grace. attack-3 F-3 found the anchor used to live in a vault
  namespace on the validator, which the operator could delete to make
  every client a first-run client; it now lives beside the seed
  (`.keystore/zk-pins.json`). **A-SPLIT-VIEW residual:** the client
  detects a fork against its OWN anchor; it cannot see that other clients
  are served the same history; a fresh device after total loss re-TOFUs
  the key and the history. **A-HISTORY-COMMITS-TO-THE-PAST:** the anchor
  commits to what the client saw, never to the future — the operator can
  rewrite epochs after a client's anchor until that client next verifies,
  and gaps in the lazily-written history are indistinguishable from
  suppression. "Append-only" means "as far as an anchored client can
  enforce". Re-anchoring is an explicit user act (`reanchor`), never
  implicit; a validator key change is never accepted implicitly.
- **F9 (registration reveals) → stated in §2.** A-ROOT-ANCHOR residual:
  `C_root ↔ account` is permanent and unrotatable; a future deanonymization
  of any proof retroactively links everything under that commitment.
  **A-SINGLE-TENANT-REGISTRATION:** registration is authenticated by the
  account's single device-auth anchor; a multi-account validator needs a
  per-root binding, which is not built. **A-REVOCATION-NOT-BUILT:**
  `revoked_from_epoch` is read and never written by any endpoint; a root
  that vanishes from the trees has no client-visible reason (the call
  option — epoch re-issuance — was not exercised in this pass).
- **F5c (set contents) → stated in §2.** Trusted, auditable, not trustless.
- **F10 (nullifier preimage) → CLOSED** from the pinned circuit source:
  `Poseidon(2)([scope, secret])`, scope = `keccak256(toBeHex(x,32)) >> 8`.
- **F13 (malleability / context binding) → applied:** message binds
  personaId ‖ gateId ‖ challenge ‖ treeRoot AND the verifier re-derives
  it; nullifier store keyed on the canonical nullifier, never on proof
  bytes; snarkjs 0.7.5 (proof 4.14.3's pin — A-SNARKJS-PIN: the
  recommendation asked for ≥0.7.6; the dependency the audited package pins
  is 0.7.5, left as pinned rather than overridden).
- **F6 (mobile proving) → UNMEASURED-EXTRAPOLATED.** `bench:zk` measures
  this host only and says so in its report.
- **F1 (submission channel) → applied (Gate 1):** a separate
  unauthenticated endpoint with a header ALLOWLIST (`host`,
  `content-type`, `content-length`, `transfer-encoding`, `connection`,
  `accept`, `accept-encoding`, `x-zk-pow`) — a cookie, an authorization
  header, `x-layers-*`, `x-forwarded-for`, a user-agent or a referer is a
  refusal; constant-size (256 B) and floor-timed responses for every
  outcome; constant-size (4096 B) requests; the client sends on a fresh
  non-pooled socket with exactly `host, content-type, content-length,
  x-zk-pow, connection`; the validator's anon module logs nothing and its
  tables are `WITHOUT ROWID` with no timestamps; the plain door
  (`/zk/submit`) is a dev-only error oracle. **A-TRAFFIC residual:** the
  validator's HTTP server still sees the peer IP in-process (it is not
  stored); with `direct` that peer is the client. Only a non-colluding
  relay removes it. **A-TIMING-FLOOR-ONE-SIDED:** the response floor is a
  floor, not a cap — the first live verification after a restart (snarkjs
  cold load) exceeds it and is distinguishable; tree builds no longer
  happen inside a submission (they run on a timer).
- **F1b (rate limiter re-links) → applied:** stateless hashcash PoW bound
  to the body bytes; no per-root state, no token, RLN not used.
  **A-POW-COST:** 16-bit PoW is a cost per submission, not a rate limit;
  solutions are precomputable offline.
- **F1c (channel scheduled before the gate arms) → applied:** Gate 1 lands
  before Gate 2; the label (Gate 3) refuses any privacy claim under
  `direct`.
- **F5b (timing) → applied:** precompute-only; queued submissions are sent
  at a CSPRNG-uniform time in a window; the window's epoch clamp is
  validated (an implausible epoch is a refusal to schedule, never a
  collapse to a fixed offset — attack-3 F-4); the `sent` mark is persisted
  on its own random delay, never at send time (attack-1 finding 2: it used
  to be an identified write ~150 ms after every anonymous send).
  **A-TIMING residual:** the window is a product parameter (defaults 30 s
  – 15 min). **A-DECORRELATION-IS-SCHEDULER-LEVEL:** the in-process
  self-test and accept-z1 evidence the scheduler's offsets, not wire
  timing; the operator-view linkage test (accept-z4) is the only wire-level
  check, and it is a session, not a longitudinal profile. The
  attestation pass's closing sweeps (series 4, accept-z4 #4) found the one
  place the scheduler's offsets were being undone: a drain that flushed
  every due item sent a root's two personas 150–330 ms apart on the wire —
  the per-item jitter collapsed into one moment, and the sibling was the
  nearest-in-time submission in about half of those trials. BUILT: the
  drain loop sends ONE item per tick, chosen uniformly at random among the
  due items, so two submissions from one process are never back-to-back
  and their order says nothing about the queue (the 5 s tick is far below
  the window; the rate is unchanged). Residual: what the operator can still
  do with the tick's granularity is the same A-TIMING window statement.
- **A-PREPARE-BURST.** The preparation — `/zk/epoch`, `/zk/members`,
  `/zk/history` and the queued-item write — is identified and happens at
  the motivating render. The operator learns "root R prepared a tier-T
  proof at time T", once per persona per epoch (a second render in the
  same epoch is skipped). The link from that event to the anonymous
  submission is bounded only by the jitter window. ZK Pass 2 BUILT the
  fixed-schedule prefetch (Gate 0: the gate tree; Gate 4, attack-z2-3 #3:
  every tree a wanted claim names, attest trees included, on the same
  tick) — the product path proves only from a tick's snapshot and refuses
  a claim whose tree has none; this line now describes the dev `prove` /
  `enqueue` actions' fetch fallback, which suites use and the product
  never does.
- **A-HPKE-AUDIT.** OHTTP encapsulation uses `@hpke/core` (X25519 /
  HKDF-SHA256 / AES-128-GCM). It passes the RFC 9180 test vectors and is
  actively maintained; it has NO formal third-party audit on record. The
  response-side HKDF/AES-GCM uses node:crypto. Until an audited HPKE is
  available, an OHTTP deployment's confidentiality against the RELAY rests
  on this library. **A-GATEWAY-KEY-ROTATION:** one long-lived gateway key,
  no rotation path; retained ciphertext is decryptable on its compromise.
- **A-RELAY-THIRD-PARTY.** Whether the configured relay colludes with the
  operator is not machine-checkable. `ZK_RELAY_THIRD_PARTY=true` is an
  operator attestation, listed as such wherever the label reads private.
  **A-RELAY-PASSIVE-JOIN:** no collusion is needed for a relay's ordinary
  access log to join its `(client IP, time)` to the gateway's plaintext by
  time — requests are now one constant size, but OHTTP is not a mixnet and
  this design adds no batching or reordering at the relay.
- **A-KEYCONFIG-VIA-RELAY.** The gateway key configuration is fetched
  through the relay, not directly; a malicious relay could substitute its
  own key and read submissions (the classic OHTTP relay/gateway split
  assumes key configs are obtained from a trusted source). Residual until
  the key config is pinned out of band.
- **A-ELIGIBILITY-VISIBLE (Gate 2).** The validator's eligibility store
  maps `personaId → proven tier` per epoch, because the feed needs it. It
  is no longer a public feed (the read takes the device-signed envelope
  when armed — attack-1 finding 5 / attack-3 F-9 found it was a
  world-readable, pollable arrival oracle), and it is pruned to the current
  epoch and its grace — but the operator reads its own table.
  **A-PRESENCE-LOG:** a row exists iff that persona proved in that epoch;
  sibling personas driven by one human have correlated presence vectors;
  the epoch grain is the validator's, bounded below by the client
  (`ZK_EPOCH_MIN_MS`, default 1 h — a validator announcing a finer epoch is
  refused).
- **A-MEMBERS-PUBLIC.** `/zk/members` and `/zk/registration` are public by
  design (the client derives its Merkle path from the leaves; commitments
  are public material). An outside observer can archive every epoch's
  cohort; combined with the operator's presence log that is the
  longitudinal dataset of A-COHORT-ROTATION.
- **A-FALLBACK-PARTITION (Gate 2).** `ZK_GATE_FALLBACK=policy` lets
  unproven personas appear via the legacy tier policy. A persona that
  needed the fallback is thereby identifiable as one that did NOT take the
  ZK path this epoch; the effective anonymity set is the ZK-path takers.
  Default is `none`; `policy` fails label condition 8.
- **A-LINKAGE-TEST-SCOPE (Gate 4).** The operator-view linkage test covers
  the obvious attacks (nullifier equality, join epoch, proof-history
  intersection, submission timing) against operator-visible artifacts in a
  fixture session where every party shares one host. It cannot exercise
  IP-based linkage (all parties are 127.0.0.1) — that is precisely the
  relay's job — nor a long longitudinal profile. The three adversarial
  reports (`research/attack-{1,2,3}.md`) and their rebuttal in REPORT-Z1
  extend it; everything they found that stands is listed here.
- **F3 (anonymity set) → applied:** a floor of 50 per tree, computed BY
  THE CLIENT over the served leaves after rebuilding them to the signed
  root, against the client's own constant — never a boolean off the wire
  (attack-3 F-2); enforced as a REFUSAL on the prove path, not only on the
  label (attack-2 finding 8); a cohort below it keeps the feature dark.
  Residual: "named, profiled candidates", and the leaves may be the
  operator's own (C1).
- **A-COHORT-ROTATION (attack-3 F-1).** Applied: cohort continuity — the
  client remembers the cohort it last proved into (per mode and tree, on
  the device) and refuses to prove into a cohort from which more than
  `ZK_COHORT_MAX_CHURN` (default 20%) of that cohort is missing; additions
  never count, removals do; a refused epoch never moves the baseline.
  Residual, stated plainly: an operator that rotates 20% per epoch still
  shrinks the intersection geometrically — a 500-leaf cohort isolates one
  root in roughly log(500)/log(1/0.8) ≈ 28 epochs (one week at 6 h) with
  the label green throughout, and every proved/not-proved bit per epoch is
  its data (A-PRESENCE-LOG). The continuity check makes the attack slow
  and visible in the served history; only the placement circuit (step 5)
  makes set membership trustless.
- **A-HOST-INTEGRITY.** The artifact CDN publishes no checksums and its repo
  says so; the pins here are the only integrity check and are enforced.
  Tampering with `node_modules` on the host (snarkjs, ffjavascript, the
  packages the pins do not cover) is out of scope.
- **A-FIXTURE-SOUNDNESS.** The fixture transport has NO soundness by design
  (a public tag key). It exercises plumbing and refusal paths; nothing it
  passes is evidence of privacy or soundness — which is why the label's
  condition 7 requires the live universe, and why the universe switch is a
  dev-only action.
- **A-DEV-SURFACE.** The app has no authentication of its own: `/api/dev`
  is an open demo console by design, and the zk test-rig actions
  (overrides, pipeline-on-demand, decoys, resets, the nullifier oracle)
  are refused unless `ZK_DEV_HOOKS=true` on the app. A deployment must
  leave that flag off and put the demo console behind its own access
  control; the stamps a caller used to write were removed entirely —
  every label condition is computed by the process at read time.
- **A-TOPOLOGY.** See §8. Everything in §1 is void wherever the operator
  runs the process that holds the seed.
- **A-ESCROW-BLAST-RADIUS.** The recovery flow stores a passphrase-sealed
  copy of the seed on the validator (scrypt + AES-256-GCM). It is offline-
  grindable; its compromise deanonymizes the entire nullifier history
  retroactively — strictly more than A-ROOT-ANCHOR's "the commitment is
  permanent". Not audited in this pass; flagged.

## 4. What "private" means on the label, exactly

The label may show a privacy claim ONLY when all of these hold (Gate 3
computes them in-process at read time; none is hardcoded, none is a stored
claim a caller can write):

1. the relay adapter is `ohttp` or `tor` — not `direct` — AND the operator
   has attested the relay is run by a non-colluding third party
   (`ZK_RELAY_THIRD_PARTY=true`; an attestation, not a check);
2. the tier cohort — the served leaves, rebuilt to the signed root —
   clears the CLIENT's anonymity floor and has not rotated past the
   continuity limit since this client last proved into it;
3. jittered submission is on, the scheduler's self-test passes (a hostile
   epoch shape is refused, the spread cannot collapse), and the
   validator's epoch is at least the client minimum;
4. the scope-collision self-test passes now, on this root's secret;
5. the verification key the verifiers USE is the build pin and the cached
   proving artifacts hash to the ceremony pins;
6. the proof-history budget refuses on a reachable path (partitions per
   persona per epoch);
7. the universe is LIVE (the fixture "proof" is a tag under a public key);
8. the gate fallback is `none` (policy partitions the set).

Otherwise the surface says **"DEMO — not yet private: <failing
conditions>"**, non-dismissably. When it does show the claim, the text is
deliberately narrow — exactly this, on one line:

**your persona's root is hidden from this server at the proof layer**

— never "anonymous", never "untraceable". And "this server" means the
validator; it says nothing about the process the seed lives in (§8).

## 5. The GPL-3 note

snarkjs (GPL-3.0) is executed in three places: `lib/zk/prover/
semaphore-worker.mjs`, a separate, unbundled prover file forked as a child
process of a server-side device (proving AND the client's verification; one
job over IPC, killed when it reports), `validator/zk.js` (the validator's own
verification, a separate process), and, since Persona launch P7,
`public/device/prover.js`, the browser prover the public site SERVES to every
visitor whose tab makes a proof (§27). The Next.js server bundle does not
contain it, and neither does `public/device/device.js`, the bundle every app
page loads: `scripts/build-device.mjs` fails the build if `device.js` carries
a snarkjs or ffjavascript marker string.

**The distribution duty (Persona launch P7, 2026-10-13).** Serving
`prover.js` distributes GPL-3.0 code to strangers. It bundles snarkjs 0.7.5,
ffjavascript 0.3.1, wasmcurves, wasmbuilder, fastfile, r1csfile and
@iden3/binfileutils, all GPL-3.0, so the file as a whole is distributed under
GPL-3.0. Its banner names the upstream sources (github.com/iden3/snarkjs
v0.7.5, github.com/iden3/ffjavascript v0.3.1) and Layers' own worker sources
it carries (`lib/zk/prover/browser-worker.ts` with `lib/zk/ceremonyPins.ts`,
`lib/zk/transport/fixtureCore.ts`, `lib/zk/hash.ts` and
`lib/zk/transport/types.ts`); `/device/prover.js.LICENSE.txt` carries the
notice, the bundled packages' own license comments and the full GPL-3.0 text
(snarkjs's `COPYING`), and the build fails without it.
**A-GPL-SOURCE-OFFER, resolved (PUBLIC GO-LIVE, 2026-10-17; the owner's decision J: publish).** The site serves the
corresponding source beside the program, from the same place and at no charge (GPL-3.0 section 6(d)), generated on
every build from the committed files (`scripts/lib/gpl-source.mjs`, called by `scripts/build-device.mjs`; the folder is
gitignored and never hand-copied):

- `/device/source/`: a notice page (plain HTML, no script, no style) that links everything below;
- `/device/source/manifest.json`: every Layers file the bundle was built from, read from esbuild's metafile for that
  very build (today the five named above), each with its byte count and sha256; the three files that control the build
  (`scripts/build-device.mjs`, `scripts/lib/gpl-source.mjs`, `tsconfig.json`); every bundled package with its version
  and licence; snarkjs and ffjavascript with links to their tagged upstream source
  (`https://github.com/iden3/snarkjs/tree/v<version>`, `https://github.com/iden3/ffjavascript/tree/v<version>`); the
  esbuild version; and the commit;
- `/device/source/<path>.txt`: each of those files byte for byte (for example
  `/device/source/lib/zk/prover/browser-worker.ts.txt`; `.txt` because a static `.ts` file would be served as video);
- `/device/source/GPL-3.0.txt`: the licence text (snarkjs's `COPYING`).

`prover.js`'s banner and `/device/prover.js.LICENSE.txt` name `/device/source/`, and Help links it ("Source code of the
browser prover (GPL-3.0)"). The build fails, and deletes `prover.js` and its LICENSE file, when the GPL text is missing,
a file cannot be read, a served copy differs from its committed source or from its hash, the banner names a snarkjs or
ffjavascript version the bundle does not carry, or the bundle's Layers inputs differ from the ones the banner names:
`prover.js` never ships without its offer. Measured by `scripts/unit-prover.mjs` G1 to G8 (a real prover build with the
build's own options, one mutation per guard) and, on every deployment, by `scripts/smoke-deployed.mjs` check 11 (every
served file answers and hashes to its manifest entry, exactly the five Layers files, the GPL text, the banner, Help's
link; a doctored manifest must be caught). What remains: the manifest names the commit from `LAYERS_COMMIT` (a
container has no `.git`; the deploy sets it before each upload) and says `unknown` if a build ran without it; a sixth
Layers file in the bundle is offered automatically but fails check 11 until that check's list is reviewed; and counsel
review before commercial distribution is still the recommendation (F15). The owner can still choose a written offer
instead, before the go-live deploy publishes this one (`notes/runbooks/GO-LIVE-TODAY.md` step 2). **A-GPL-OFFER-IS-THE-BUILD** — the
offer is the source of the build that served it; the bundled GPL packages are offered by name, version and upstream
link, not copied, which is the usual reading of section 6 for unmodified upstream code but not a lawyer's.

## 6. Mobile proving

UNMEASURED-EXTRAPOLATED. Host numbers (`shots/zk-bench.json`, i7-14700F,
main thread): cold 549 ms, warm median 287 ms, verify 12 ms. Through the
product path (`shots/live-z2.json`: a forked prover process, artifacts
re-hashed on every load): 386 ms proving, 1.27 s wall from request to
self-verified envelope; local verification 315 ms including the fork.
Research PoC: ~0.9 s on a flagship phone (measured), ~3–8 s mid-range
Android (extrapolated). Precompute-only by design, so this is a
battery/idle cost, not an interaction latency.

**In a browser (Persona launch P7, measured 2026-10-13 on a desktop and a
throttled stand-in; no real phone measured).** `scripts/accept-anon-prod.mjs`
check 8, recorded in `shots/p7-browser-prover.json`: one real Groth16 proof
(Semaphore v4, depth 20) at a time, each verified by the validator's own
verifier. On a desktop, in the browser prover's Web Worker: 112 ms to
fetch and check the proving files (5,738,124 bytes), 1.24 s to prove, 10 ms
to verify, 1.41 s in all. Chromium's CPU throttle reaches only a page's own
thread (a dedicated worker refuses it), so the phone stand-in runs the same
prover code on a throttled page thread under a Pixel 5 profile: 4× slower,
5.6 s to prove and 6.6 s in all; 6× slower, 9.5 s and 10.6 s. A proof is
made at idle on the prefetch tick, never at the tap, and the worker's budget
for one real proof is 5 minutes (§27).

## 7. Registration and the validator key, stated

The validator holds ONE Ed25519 signing key. It signs placements and
the root history — the validator's own statements about what it served.
It protects clients from a man-in-the-middle between validator and client;
it is not a secret that protects any user, and it never touches user
material. The client pins it ONCE, on first sight, on the device (TOFU,
like the device anchor) — one pin for every tree and both universes, not
one first sight per tree (attack-3 F-7). A different key is a refusal,
never a re-pin; the only way past it is a device reset.

## 8. Topology — the assumption everything rests on

The "client" in this codebase is the Next.js server process: it holds the
seed (`.keystore/root.json`), derives the zk secret from it, proves in a
child process on the same host (the secret crosses an OS pipe to it, never
a network boundary), keeps the device pins beside the seed, and runs the
vault cipher. Every privacy statement in this document assumes **that process
is the user's** — on the user's own device, or on a host the operator of
the validator does not control.

Whoever holds the seed can recompute every nullifier for every
`(feature, epoch, personaId)` offline and match them against
`zk_nullifiers` and the eligibility store, attributing the entire
historical proof record with no timing analysis at all. In a deployment
where the validator's operator also runs the app process — one hosted
demo, say — nothing here is private, the label's claim included; the
label reads "hidden from this server", and in that topology "this server"
and "the process holding the seed" are the same party.

A browser-side prover (the same snarkjs code path in a Web Worker, the
seed in the browser's storage) is the topology the research recommends
for a product. Since Persona launch P7 (built, test data only, not deployed
as of 2026-10-13) the public site's browser device makes every proof in a
Web Worker (§27). The public site runs the test universe, so those are test
proofs; a real proof in a browser needs proving files a deployed build does
not ship (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY), and its timings are measured
on a desktop and a throttled stand-in, not a phone (§6).

## 9. The adversarial reviews

Three fresh-context reviews (`research/attack-1.md` metadata/transport,
`attack-2.md` soundness/crypto, `attack-3.md` the operator) were run
against the Gate 0–4 build and rebutted line by line in `notes/reports/REPORT-Z1.md`.
Nine findings became fixes in this pass (the claim binding, the vkey the
verifiers use, canonical nullifiers, device-local pins, the client-computed
floor and cohort continuity, the validated jitter window, the deferred
`sent` persist, the in-process label conditions, the eligibility envelope,
constant-size requests, once-per-epoch triggering, dev-gated actions);
everything else that stood is an assumption line in §3. Nothing was
allowed to vanish.

## 10. What zk cost us: root-level block fan-out (ZK Pass 2, Gate 2)

Until migration 006 the validator held `personas.root_id`. That one column
made three things cheap: "which personas does this account have" (the
switcher, the classic feed's persona skin by fid), "what tier is this
persona" (a root join), and **root-level block fan-out** — blocking one
persona blocked every persona of that account, current and future, on
both ends, resolved server-side.

The column is gone (`validator/migrations.js` 006: `personas` rebuilt
without it, the root-level `blocks` table replaced by the persona-level
`blocks_v2`). The validator has no table, column or index that links a
persona to a root; `scripts/accept-z7.mjs` check 1 and
`validator/test/migration006.test.js` assert that on every run. What each
of the three reads became:

| Read | Before 006 | After 006 |
|---|---|---|
| my personas | `GET /personas/root/:rootId` (validator) | the DEVICE roster (`lib/identity/rootRoster.ts`: the vault-sealed record of what this device created + the one-time pre-006 export it holds) |
| a persona's tier | `GET /rep/:personaId` (root join) | PROVEN through the zk binding (0 = "not proven", rendered honestly); the legacy binding asks by ROOT handle only for the device's OWN roots |
| block | root ↔ root, fan-out both ways, future personas included | persona ↔ persona: ONE validator row per block action (the acting persona). The DEVICE shares the block across ITS OWN personas at read time (it knows them; a fan-out WRITE would seat siblings side by side in operator-visible rows — refused, iteration 2). Nothing can reach the blocked account's other personas. |

**The regression, named.** A user who blocks `@a` no longer blocks the same
account's `@a2`, and a persona the blocked account creates tomorrow is not
blocked. The UI says so at the moment of blocking ("Sibling personas of
that account are not auto-blocked: this server no longer knows which
personas share an account") and `POST /block` says so on the wire
(`fanout: "persona-level only"`). `scripts/functional.mjs` asserts the
sibling STAYS visible — a check that fails if a server-side persona → root
link ever comes back. This is not a bug to fix later with a smarter join:
any server that can fan a block out over an account's personas can also
answer "are these two personas the same person", which is the linkage
the whole zk layer exists to deny the operator. The call options for
recovering some of the lost coverage without that link are in
`docs/fanout-under-zk.md` (call option B) — cohort-level and
attestation-level blocks, each with a stated cost.

**The rollback (rule 4).** 006 deletes nothing without a way back:
`validator/export-roster.js` (run once, on the pre-006 database, before
the first boot on a 006 build) writes the roster to the device
(`.keystore/fixture-roster.json`, gitignored); root-level block pairs are
kept in `blocks_legacy_export`, read by nothing but the down-migration;
`validator/migrate-down.js <roster>` restores the column EXACTLY from the
device roster and refuses an incomplete one (`--orphans=quarantine` moves
the unattributable personas to `personas_orphaned_on_rollback` instead of
guessing — moved, never deleted). `scripts/accept-z7.mjs` check 6 runs the
whole rollback on a snapshot of the live fixture database and migrates it
up again.

### Assumptions added by Gate 2 (by id)

- **A-Z2-ROSTER-ASSERTED** — persona ownership is ASSERTED by the device
  roster, not verified by the validator. `POST /block` from persona `p`
  succeeds for whichever device says `p` is its own. This is the pre-006
  situation too (the validator never authenticated a blocker beyond the
  app server's envelope); 006 moves the roster, it does not weaken the
  check. Verify yourself: `validator/server.js` `/block`.
- **A-Z2-006-ORPHANS** — a persona whose device forgot it (a wiped vault
  roster, a lost phone without recovery) is UNATTRIBUTABLE forever after
  006: no rollback can restore its root, by design. The rollback refuses
  unless told to quarantine. In the fixture, orphans accumulate because
  every suite reset wipes the vault roster; `accept-z7` check 6 reports
  the count it quarantined.
- **A-Z2-FIXTURE-EXPORT** — in fixture mode the app server holds the
  pre-006 export for EVERY fixture account (it is every fixture account's
  device, exactly as `seed/data/accounts.json` already makes it). In
  production each device exports only its own roots; the export is never
  produced on the validator and never returns to it EXCEPT by the rollback
  itself — `validator/migrate-down.js` is the operator re-learning the
  roster by the user's act (`validator/export-roster.js` refuses to write
  inside `validator/`; attack-z2-1 #8).
- **A-Z2-BLOCK-READ-TIME** — the device applies the union of its own
  personas' block lists at read time (`lib/policy.ts`, `GET /api/block`),
  so a persona created later shares the block at once; the validator holds
  one row per block action, so the blocker persona ↔ target pair is
  operator-visible exactly as it was before 006 (the target's siblings are
  not, and the blocker's siblings are not). Verify yourself:
  `app/api/block/route.ts`, `scripts/accept-z7.mjs` check 4.

## 11. Fork continuity as a proof, revocation via epoch re-issuance, attestation scaffolding (ZK Pass 2, Gate 3)

**Fork continuity.** A fork used to carry the old persona's tier to the new
one through a root read (`adapters.rep.tierFor(old)` → stamped on the new
record). Under zk that read is gone (Gate 1), so continuity is a PROOF:
the fork route mints `forkCommit = sha256("layers-fork-commit/1|old|new|
nonce")` with a fresh 16-byte nonce, keeps the nonce in the vault-sealed
fork record, hands it ONLY to carried grant holders through the
disclosure-gated forward pointer (`GET /api/identity/fork?resolve=…`), and
asks the next prefetch tick for a `fork-continuity` proof: a membership
proof in the gate's tier tree whose MESSAGE binds `personaId | gateId |
fork:<forkCommit> | challenge | root` (scope registry entry
`fork-continuity`, per-persona on the NEW persona; the validator
re-derives the message from the commitment it is handed — `validator/
zk.js` `expectedPublicValues`). What the validator records
(`zk_fork_claims`): the new persona, the commitment, the tree, the tier,
the epoch, the nullifier. What it never learns: the old persona. WHAT
THE PROOF PROVES, exactly (attack-z2-3 #2, attack-z2-2 #7): "a leaf of the
gate's tier tree authorises the NEW persona and attached this
commitment" — a tier proof carrying a label, a VOUCH by that root. It does
NOT prove the old persona's root is the same root; that would need the
validator to see the two personas share a secret, which is the linkage
this layer denies. Identity continuity old → new rests on the FORWARD
POINTER signed by the OLD persona's key (`lib/identity/fork.ts`), handed
only to carried holders with the nonce; a holder checks BOTH — the signed
pointer names the commitment, and `GET /zk/fork-claim` says a tier-T root
proved the new persona under it (A-Z3-FORK-CLAIM-IS-A-VOUCH). The tier
reaches the new persona's eligibility ONLY through this proof (it doubles
as the epoch's eligibility proof for the gate); until it lands the new
persona is "not proven". Claims are pruned like eligibility (the epoch and
its grace — attack-z2-3 #5): a holder checks at fork time.

The fork record itself is stored as ONE opaque sealed value: the linkage
test v2 (`scripts/accept-z9.mjs` check 6) caught its first form, a record
ADDRESSED by the old persona id — plaintext "this persona forked at t"
beside a fork-continuity claim arriving at t + jitter — and it was fixed
before Gate 4 closed (the vault seals values, not addresses: attack-1
finding 1's lesson, learned twice).

**Revocation via epoch re-issuance (F9 had no rotation story).** `POST
/zk/revoke` is signed like a registration (the root's device-auth anchor),
append-only (a revoked row stays revoked; `revoke` again answers
`existing`), and effective from the NEXT epoch — this epoch's trees are
frozen (the invariant), so a revoked leaf still proves until the boundary
and then never again. The device moves to the next zk-identity branch
(`zkIdentitySeedAt(seed, index)`, index kept in `.keystore/zk-identity.json`)
and registers the new commitment; the validator's unique index is now
"one ACTIVE commitment per root", so the old row's revocation and the new
row coexist. Recovery: indices derive deterministically from the seed; a
recovered device that revoked before scans indices against `/zk/registration`.
Eligibility marks already granted to the root's personas this epoch are
NOT withdrawn (the validator cannot tell which personas are the root's —
migration 006); they lapse with the epoch grace.

**Attestation scaffolding.** `zk_attestations(issuer, commitment,
issued_epoch, expires_epoch, sig)`; trees `attest:<issuer>` built per
epoch from the active registrations holding an attestation with
`issued < epoch < expires` (batched like registration; expiry drops the
leaf, so proofs stop at the expiry epoch and the `attested` mark lapses
after the one-epoch grace); claim kind `attestation` (scope entry
`attestation`, per-persona; the message binds the issuer so an attestation
proof is not a tier proof). The issuer today is a **MOCK issuer** behind
`ZK_DEV_HOOKS` (`POST /zk/dev/attest`, signing with the validator's own key
as a stand-in). Which real issuer, with which key, what the attestation
means and how the issuer itself revokes, is the decision recorded in
notes/runbooks/MORNING.md — the code has the slot, not the answer.

### Assumptions added by Gate 3 (by id)

- **A-Z3-FORK-COMMIT-SET** — the nonce hides the old persona from the
  validator only as long as candidate pairs are not enumerable: the
  commitment is a hash over (old, new, nonce) with a 128-bit nonce, so the
  operator cannot test a guessed pair. The forward pointer that carries the
  nonce is disclosure-gated exactly as before (attack surface unchanged).
- **A-Z3-REVOKE-EPOCH-GRACE** — a revoked root proves until the epoch
  boundary (frozen trees) and its personas' eligibility marks lapse with
  the grace; a compromised PROVER BRANCH (the secret scalar / the branch
  master that crosses to the prover) is therefore usable for at most the
  rest of the epoch plus the grace. Shortening that needs an epoch
  shortening, not a code change. See A-Z3-REISSUE-SCOPE for what this does
  NOT cover.
- **A-Z3-REISSUE-SCOPE** (attack-z2-3 #4, attack-z2-2 #6) — re-issuance
  is a BRANCH rotation under an unchanged seed: index i+1 derives from the
  same seed as index i. It addresses a leaked prover branch, not a leaked
  seed (the phrase, the escrow): a seed holder derives i+1 the moment the
  honest device publishes it. A seed compromise has no rotation story here
  — a new seed is a new account. Making branches survive a seed leak would
  need fresh vault-stored entropy per branch, a design choice with a
  recovery cost, not made tonight.
- **A-Z3-MOCK-ISSUER** — the attestation path is exercised only with the
  validator signing as the issuer. Nothing in the client verifies an
  issuer signature yet (there is no issuer key to pin). The trees, expiry,
  proof and mark are real; the trust in the issuer is not yet a thing.
- **A-Z3-INDEX-FILE** — the identity index is device-local state outside
  the keystore file; a device that loses it derives index 0 and will find
  its commitment revoked; the recovery scan
  (`recoverIdentityIndex` in `lib/zk/registration.ts`, the
  `recoverIdentityIndex` action on `/api/zk`; walks `zkCommitmentAt(i)`
  against `/zk/registration`, bounded to 1024) is the way back —
  exercised by `accept-z8` check 4 (attack-z2-3 #4 found it described but
  absent). Total-device-loss recovery (`accept-c4`) still runs at index 0
  in the fixture. A re-issued branch is PENDING until its activation epoch
  (the tick promotes it); the old branch keeps proving until then
  (attack-z2-2 #4).
- **A-Z3-REISSUE-JOIN** — a root that revokes and re-issues mid-epoch is
  the ONLY new registration of that epoch (in the fixture; in a deployment,
  one of few). The operator pairs the old and new commitments at the ROOT
  level through `zk_registrations.root_id` — which it already knew for
  both (registration is root-level, the stated leak of Pass 1). At the
  PERSONA level nothing pairs the personas that proved under the old
  commitment with those proving under the new one except what the epoch
  already gave: fresh nullifiers, the same cohort. `scripts/accept-z9.mjs`
  check 7 asserts that; a join cohort of one for the re-issued commitment
  is a root-level fact, not a persona linkage.

## 12. The second adversarial review (ZK Pass 2, Gate 4): what it found, what changed, what is now assumed

Three reviewers with fresh context (`research/attack-z2-1.md`, `-2.md`,
`-3.md`). Every finding is either FIXED (named here with what changed) or
an ASSUMPTION by id. The rebuttal table with the reviewers' own ids is in
`notes/reports/REPORT-Z2.md`.

### Fixed in the pass

- **The envelope counter was the wall clock** (attack-z2-1 #2, HIGH,
  verified on disk: a signed roster flush landed 3 ms after
  `POST /personas`, and `envelope_counters(device, namespace, counter)` is
  never pruned — `personas.created_at ⋈ envelope_counters.counter` paired
  persona → device → root from the database alone). The counter is now a
  device-persisted monotonic integer (`.keystore/envelope-counters.json`,
  `prev + 1`, a fresh device starts from an hour-grain base above any clock
  value), and the validator stamps `personas.created_at`,
  `blocks_v2.created_at` and `adapter_state.updated_at` at HOUR grain —
  nothing persona-addressed carries a finer time than the epoch grain the
  zk rows already accept (`validator/server.js` `hourGrain`;
  `zk_registrations.registered_at/revoked_at` likewise, `validator/zk.js`).
  Migration 008 coarsened every row that was already on disk (the
  millisecond was the leak; nothing legitimate read it — no rollback).
- **Vault addresses that were persona ids** (attack-z2-1 #3, HIGH; #6,
  LOW): `identityRoster` (one sealed record per keystore persona, keyed by
  the persona id — the freshly forked persona's key appeared beside the
  fork record's, 11 ms apart) and `sessionHandles` (keys were unsalted
  `sha256(rootId)` prefixes, invertible over `roots`) are each ONE opaque
  sealed record now, padded like the zk queue. With `rootRoster`, `forks`
  and `zkQueue` that is every vault namespace this pass touches.
- **The switcher enumerated the device's personas to the validator on
  every render, signed** (attack-z2-1 #1, HIGH in the §8 topology): the
  layout read `GET /zk/eligibility?personaId=<own>` once PER OWN PERSONA
  under the device envelope. It reads the gate's eligibility MAP once (the
  read the feed build already makes) and indexes it locally. The session's
  persona records come from the device-held roster (`RosterDoc.personas`,
  recorded at creation) instead of `GET /personas/<id>` per roster entry.
- **A-Z2-FIXTURE-EXPORT** said the export is "never copied back"; the
  rollback is exactly that, by the user's act — reworded (attack-z2-1 #8).

### Assumed, by id (this pass did not fix these; they are the honest state)

- **A-Z2-ROSTER-ENUMERATED-ON-READ** (attack-z2-1 #1, the remaining half)
  — the read-time union of the device's own personas' block lists is one
  `GET /blocked/<id>` per own persona in a burst (`lib/policy.ts`,
  `GET /api/block`), and the persona records of the FIXTURE export's ids
  are fetched by id once per process. In the §8 topology the peer is the
  device; the set of ids in one burst is the roster. The fix is
  device-held block lists (the vault), which changes the block contract
  again; it is not done tonight. Verify yourself: `lib/policy.ts`
  `applyFeedPolicy`, `lib/validator.ts` `personasForRoot`.
- **A-Z2-HOUR-GRAIN** (attack-z2-1 #2, residual) — persona creation, the
  roster flush that records it, a fork's three vault flushes, and a block
  and its edge-event flush still land inside ONE hour bucket; the operator
  can pair "personas created in hour H" with "devices that flushed in hour
  H". In a low-traffic deployment that is a small set. The scheduled
  flush (the queue's Gate 0 pattern) would break the bucket too; not done
  tonight.
- **A-Z2-PLAINTEXT-MOCK-ADDRESSES** (attack-z2-1 #3, the demo half) —
  the mock adapter's persisted namespaces (`activeMode`, `attestations`,
  `saturation`, `blocks`, `readwise`, `graphConsent`, `folderFollows`,
  `destinationBindings`, `xSyncCursor`, `personaDefaultMode`,
  `timelineUndoDepth`; `modes` values) are persona-keyed PLAINTEXT under
  the device envelope. They are the demo's fixture furniture — a
  production adapter replaces them — but while the mock adapter is the
  adapter, the device's persona set is readable from `adapter_state` keys.
- **A-Z3-FORK-PRESENCE** (attack-z2-1 #4) — a fork is visible as "a
  tier-T persona goes quiet while a tier-T persona with a fork claim
  appears"; the commitment hides WHICH predecessor, the presence log bounds
  how many candidates. The fork's own vault flushes are hour-grain now
  (A-Z2-HOUR-GRAIN), not batched onto the tick.
- **A-Z2-ATTRIBUTION-ACCOUNT-JOIN** (attack-z2-1 #5, hypothesis) — the
  attribution index (cast → persona, plaintext by C5) sits beside
  `fcWrites.fid` (cast → fid, plaintext) and, with the poller on,
  `rep_events.source_id` (cast → root). Under per-account fids that is
  persona → account in three plaintext tables. Moot in v0 (one shared test
  FID; poller off in the fixture); the fix (drop `fid` from the ledger,
  hash `source_id`) is a follow-up.
- **A-Z3-ATTEST-EXPIRY-PARTITION** (attack-z2-1 #7, hypothesis) — an
  issuer that attests at different times partitions the attest tree by
  expiry epoch: the commitment whose leaf drops is public and root-level,
  and the persona whose claims stop that epoch is its. The issuer design
  (notes/runbooks/MORNING.md) should quantize expiry to shared boundaries.
- **A-Z3-FORK-CLAIM-IS-A-VOUCH** (attack-z2-3 #2, attack-z2-2 #7) — the
  fork-continuity proof proves "a leaf of the gate's tier tree authorises
  the new persona and attached this commitment". Any tier-T root can make
  such a claim for any (old, new, nonce) it names; the proof does not tie
  the old persona's root to the new one (that would need the validator to
  see two personas share a secret — the linkage this layer denies).
  Identity continuity rests on the forward pointer SIGNED BY THE OLD
  PERSONA'S KEY, handed only to carried holders; the claim adds the tier
  carry and the root's vouch. §11 now says exactly that; the registry's
  linkage line too.
- **A-Z3-FORWARD-POINTER-DELIVERY** (attack-z2-2 #5) — the nonce's
  disclosure gate is the `viewerPersonaId` the resolving caller supplies;
  cross-device delivery of the forward pointer to a holder's device is not
  built (the demo topology is one process). A-DEV-SURFACE's class.

### Also fixed in this review cycle (attack-z2-2 / -3)

- attestation trees are snapshotted on the same tick as the gate tree
  (attack-z2-3 #3): a claim whose tree has no snapshot is refused on the
  product path, never fetched at prove time (`lib/zk/prefetch.ts`,
  `lib/zk/gate.ts`);
- `zk_fork_claims` is pruned like eligibility, the upsert keeps
  `MAX(tier)`, and a fork proof outside a tier tree is refused instead of
  consuming the nullifier for nothing (attack-z2-3 #5, #8);
- the attestation scope is qualified by the issuer —
  `attestation/<issuer>` — so two issuers' proofs never collide
  (attack-z2-3 #6);
- a fork-continuity claim counts once against the budget partition it
  shares with the tier claim (attack-z2-3 #7);
- re-issuance is PENDING until the new leaf's activation epoch; the old
  branch keeps proving until then (attack-z2-2 #4);
- the recovery scan exists (`recoverIdentityIndex`; attack-z2-3 #4,
  attack-z2-2 #6).

## 13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn

Pass 2 left a slot; this pass fills it with an OPEN interface and one real
issuer. Anyone can register an issuer on the validator (a namespaced id,
an Ed25519 key, a claim schema, the BUCKETS it emits, a validity in
epochs); the key is the identity and a rotation is a new id. Trust is not
part of the interface: which issuers a client honours is the subscriber's
choice (`ATTEST_HONORED_ISSUERS`, default `onchain.*`); an un-honoured
issuer's attestation proves nothing on that client. This section is
completed by the Gate 4 review (assumptions by id, below).

**What an ISSUER learns.** At issuance, the subject's commitment and — for
the onchain family — the wallet addresses that signed its challenge and
the EXACT facts behind them (a first-transaction timestamp, a wei balance,
a transaction list, a vote count). It keeps a salted hash of each address
(`.keystore/issuers/onchain-subjects.json`) so it can revoke, and nothing
else; the exact values are not written anywhere.

**What the VALIDATOR learns.** That issuer I vouched for commitment C
under bucket B, from epoch E until epoch X (`zk_attestations`: issuer,
bucket, commitment, a nonce-salted claim hash, epochs, the issuer's
signature) — and, when a persona proves, that persona P proved bucket B of
issuer I this epoch (`zk_attestation_claims`). Never the claim value,
never a wallet address, never how many wallets a root bound. The claim
hash is over a 32-byte nonce the subject holds, so the tiny value space
is not a dictionary.

**What a SUBSCRIBER learns.** Only what the persona PROVED: that a persona
is in bucket B of an honoured issuer this epoch — the coarse attribute,
and only if the bucket clears the anonymity floor.

**Bucket boundaries (coarseness is a privacy control).** An exact balance,
a first-tx timestamp or a vote count is a fingerprint; a bucket shared by
fifty roots is a set. The onchain family emits ONLY these, all nested where
they nest:
- `onchain.wallet-age`: `gt1y`, `gt2y`, `gt4y` — first transaction older
  than 1 / 2 / 4 years (max over bound wallets);
- `onchain.holdings`: `eth-gte-0.1`, `eth-gte-1`, `eth-gte-10` — ETH held
  at the snapshot, summed over bound wallets; tiers, never amounts;
- `onchain.protocol-history`: `aave`, `morpho`, `compound`, `uniswap` —
  interacted before the issue epoch (the initial set, four protocols — a
  fifth named in the original prompt was struck from it by the user
  mid-pass and is not tracked);
- `onchain.governance`: `votes-gte-1`, `votes-gte-5`, `votes-gte-20` —
  Snapshot votes, summed over bound wallets.
Expiry is the issuer's DECLARED validity, quantized to the issue epoch
(wallet age, protocol history, governance: 28 epochs; holdings: 4), so
all issuances of an epoch expire together (A-Z3-ATTEST-EXPIRY-PARTITION).

**The floor arithmetic (the k-floor and the attestation floor are one
invariant).** A bucket is a tree `attest:<issuer>/<bucket>`, built per
epoch like a tier tree. The CLIENT counts the served leaves, rebuilds the
signed root from them, and refuses to prove into any bucket with fewer
than `ZK_ANON_FLOOR` (default 50) members — the same cohort check, the
same churn limit, as the tier gate (`lib/zk/cohort.ts`). A gated surface
therefore never sees a proof from a thin bucket; the label's condition and
the audience builder read the same count. A bucket below the floor is
honoured NOWHERE — not by the feed, not by a mode, not by an advertiser
audience — and the validator's own `clearsFloor` opinion is never what
decides it.

**Topology, stated.** In this repository the reference issuers run as
modules inside the Next process — a demo of a SEPARATE party — with their
signing keys beside the user's keystore (`.keystore/issuers/`). In a
product the issuer's key lives on the issuer's host and the subject only
ever holds the issuer's PUBLIC key from the validator's registry
(**A-ATT-ISSUER-COHOSTED**). The four onchain issuers share ONE key in
phase 1 (key id `onchain`), documented as such; a rotation is a new
family. The tracked contract addresses per chain are a fixed list in
`lib/attest/chain/live.ts` (**A-ATT-CONTRACT-SET**): a wrong or missing
address under-reports a protocol — a refusal to vouch — never
over-reports.

**The surfaces (Gate 3).** Modes, filter packs, channel gates and the
advertiser's audience builder predicate on attestations through one rule
field, `attest.holds` = `<issuer>/<bucket>` (packs: `attest:<issuer>/
<bucket>`). Every one of them evaluates against what a persona PROVED this
epoch — the validator's presence log of accepted proofs, read once per
feed build through the gated map and cached for that build
(`lib/attest/proven.ts`) — never against the validator's trees: a root
that holds an issuance whose persona never proved it matches nothing, and
under any rep binding but zk the map is empty. An audience that names a
proven bucket is held to the zk floor (`ZK_ANON_FLOOR`) as well as the
market's k-floor — the higher applies (`lib/zk/floor.ts`) — and is refused
in the builder and at the API alike. An attestation-gated surface carries
a ninth label condition: the gated bucket clears the floor on the tick's
census and its issuer is honoured here; otherwise the surface is DEMO with
that condition named.

### The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed

Three fresh-context reviewers were given this document, the diff since
`86adfff` and `research/VERIFY-YOURSELF.md` (reports in
`research/attack-att-{1,2,3}.md`). Every finding is a fix named here or
an ASSUMPTION by id; the linkage test v3 (`test:att4`) and the pass's own
live run (`live:att1`) found two more before the reviewers did.

**Fixed in this pass:**

- **Honour by KEY, never by id** (att-1 #3, att-2 #3, att-3 #1). The
  registry is open and first-come, so an id proves nothing. An honour
  pattern may be pinned — `onchain.*@<pubkey>` — and a pinned pattern
  matches only when the issuer's REGISTERED key (read from the registry on
  the same tick, the same build, or the vault record) is the pin; the
  reference client's DEFAULT is the onchain family under the key its own
  co-hosted issuer holds. Every reader honours by key: the gate, the
  proven-map refresh, the `attested` reads, the label, the backpack.
- **Uniform bucket prefetch** (att-1 #1). Fetching an attest tree only on
  the tick a persona would prove into it was an identified beacon that
  the anonymous proof then confirmed; every honoured bucket tree is now
  fetched on every tick, like the gate tree.
- **The running intersection** (att-1 #2, att-2 #1, att-3 #3). The
  per-tree floor and the per-epoch budget do not bound what an operator
  learns by intersecting every tree a persona has proven into, across
  buckets and epochs. The client now keeps, per persona, the intersection
  of every attestation tree it has proven (on the device, like the
  budget) and REFUSES an attestation proof that would shrink it below
  the floor. Tier trees keep their existing assumption (A-PRESENCE-LOG).
- **One wallet, one root; the submission is device-signed** (att-1 #5,
  att-2 #6, att-3 #2). The issuer refuses a wallet already vouching for
  another root; the batch a subject submits to `/zk/attest` is signed by
  its device-auth key and verified against the anchor, so a stranger
  cannot enter an issuance for a commitment it does not hold
  (single-tenant, like registration — A-SINGLE-TENANT-REGISTRATION).
- **Revocation cannot be replayed away** (att-2 #4, att-3 #4): a revoked
  issuance is not undone by re-posting the original signature; a
  re-issuance must carry a later issue epoch.
- **No issue-epoch grace; the per-commitment read is gated; the issue
  window is a knob** (att-1 #4, att-2 #2, #5). A late submission was a
  cell of one by construction — `issuedEpoch` must be the current epoch;
  `GET /zk/attestations?commitment=` (a per-leaf activation/expiry pair)
  now takes the device-signed envelope like eligibility; activation and
  expiry are quantized to `ATTEST_ISSUE_WINDOW` epochs on both processes
  (default 1 — see A-ATT-ISSUE-CELLS).
- **The label's ninth condition is rendered** (att-1 MED, att-3 INFO): the
  discovery surface passes the active mode's gated bucket to the label.
- **Only a registered issuer's buckets are trees; the registry has a
  size** (att-3 #5, INFO): scaffold rows of an unregistered issuer no
  longer build a tree; registration is refused past 128 issuers per
  universe.
- **An address never rides an error** (found by `live-att1`): the issuer
  refuses by source only, the live adapter redacts, the script redacts.

**Assumed, by id (the honest state after this pass):**

- **A-ATT-ISSUER-COHOSTED** — the reference issuers run inside the Next
  process with their keys beside the user's keystore; a product client
  ships the issuer's public key and pins it. The default pin is therefore
  THIS process's key: another device's onchain issuer is a different
  issuer here.
- **A-ATT-CONTRACT-SET** — the tracked contract addresses per chain are a
  fixed list; a wrong or missing address under-reports, never
  over-reports.
- **A-ATT-LIVE-SOURCES** (att-3 LOW) — the live adapter trusts Blockscout,
  Snapshot and keyless public RPCs (env-overridable, with fallback lists)
  as read; it sends the wallet address to those third parties from the
  issuer's host. A self-hosted node/indexer is the product answer.
- **A-ATT-ISSUER-RETENTION** (att-1 #5, att-3 LOW) — the issuer keeps
  `sha256(salt|address) → issuances` with the salt beside it: whoever holds
  the issuer's host holds address → commitment for the wallets it bound.
  That is the issuer's knowledge by construction; it never reaches the
  validator.
- **A-ATT-PROFILE-PUBLIC** (att-2 #2) — a bucket's member list is public
  (the client's cohort check needs the leaves), so a COMMITMENT's full
  bucket profile is public: which bands of which kinds it holds. The
  commitment is a root-level pseudonym; persona → commitment is what the
  floor, the budget and the running intersection guard. Gating member
  lists is a topology change (an identified read for the client, which it
  already is) not made here.
- **A-ATT-ISSUE-CELLS** (att-1 #4, att-2 #5) — at `ATTEST_ISSUE_WINDOW=1`
  (the fixture's arithmetic) every issuance of an epoch activates and
  expires together but an epoch with few issuances is a small cell; a
  deployment raises the window (both processes) to merge cells. The
  linkage test runs at 1.
- **A-ATT-REVOCATION-PARTITION** (att-2 #5) — an issuer revocation drops
  exactly one leaf at the next epoch (the prompt's semantics); the
  persona whose claims stop that epoch is the same class of leak as
  A-Z3-REVOKE-EPOCH-GRACE. "Revocation as no-renewal" (the leaf leaves
  with its window's cohort) is the quieter design, not built.
- **A-ATT-NEQ-VOUCH** (att-2 MED) — an attestation proof binds a persona id
  the PROVER chooses (A-PERSONA-ROOT-BINDING), so any leaf holder can
  make any persona id read "attested". A `neq` attestation predicate, and
  an audience built on one, is therefore advisory; `eq` predicates are
  what a persona can only satisfy for itself by proving.
- **A-ATT-BACKPACK-LOCAL** (att-2 MED) — the backpack, the Ad Match Score
  and the marketplace's local campaign matching read the root's OWN
  vault issuances for the root's own personas, device-side, without a
  proof; nothing leaves the device as a claim. The proof-mediated rule
  governs what OTHER parties can predicate on.
- **A-ATT-OPEN-REGISTRY-COST** (att-3 #5) — registration is free below the
  cap and each registered bucket with an issuance is a per-epoch signed
  tree build; no proof-of-work on registration, no pruning of placements.
- **A-ATT-ISSUER-RETIREMENT** (att-3 #1) — an issuer cannot retire an id or
  announce a compromised key at the protocol level; a subscriber un-pins
  the key. A signed retirement route is the obvious next step.
- **A-ATT-HEALTH-SIG** (Gate 0) — the app's health signature is a scheme
  check under a per-process key, not an identity claim; the validator's is
  an identity check under its persistent key.

## 14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts

The Multi-FID pass made each public persona a SEPARATE real Farcaster
account (its own fid, fname, custody key and managed signer) and added an
anon-post mode: a text relayed through a shared account, authorised by a
one-per-root-per-window membership proof and attributed to no one. Three
fresh-context reviewers (`research/attack-fid-{1,2,3}.md`: the network
observer, the validator operator, the code-level adversary) and the
pass's own linkage test v4 (`test:fid5`) shaped what follows. Every
finding is a fix named here or an assumption by id.

### What is hidden, from whom

| observer | learns | does not learn |
|---|---|---|
| a hub / another client | each persona is an ordinary account: its casts, follows, likes, replies, fname, custody address, registration time; the anon account's casts as that account's | which accounts share a root — unless the root publishes the link itself (see A-FID-SELF-GRAPH, A-FID-FORK-AUDIENCE-GRAPH, A-FID-CREATION-TIMING); which root wrote an anon cast |
| Neynar (managed custody) | everything above, PLUS the join: one API key reserved and registered every persona fid, holds every managed signer, is on every persona write, and — unless the anon relay account is a distinct credential — relayed the anon cast. **A-FID-NEYNAR-SEES-ALL.** | nothing is hidden from Neynar under managed custody; the anon guarantee is stated against hubs, other clients, this client and the validator only |
| the validator | the sealed fid records (ciphertext), the anon nullifier rows (kind, tree, epoch — no persona), the anon cast rows (text, hash, epoch, hour, the shared fid — no persona, root or nullifier), the fork-claim rows (the NEW persona + a commitment) | which persona a fid belongs to (no plain map — D-FID-5-MAP-SEALED); which root posted an anon cast (the nullifier is one of ≥ floor in the window, on fixture; see A-FID-ANON-CROWD for live) |
| this client | everything — it holds the vault | — |

### Fixed by the pass, after the reviews (Gate 5)

- **The live path is keystore-only** (attack-fid-1 #1, -2 #4, -3 #1 — the
  one finding all three reviewers put first). A seeded viewer persona's
  Farcaster keys come off the FIXTURE root, a public constant; a live
  account owned by that custody key could be transferred or re-keyed by
  anyone with the repository. `recordLiveFid`, both custody signatures and
  the acquisition command now refuse any persona whose keys do not come
  off the root phrase; `signerProbe` says which root the keys came from.
  **D-FID-5-LIVE-KEYSTORE-ONLY.** (The Gate 2 plan's "two seeded public
  personas" is therefore wrong as written: the two live accounts must be
  keystore-minted personas — a fork of a seeded one is.)
- **No plain persona → fid map on the validator** (attack-fid-1 #11,
  -2 #1, -3 #16). One device-signed document listing every account of a
  root was the persona → root grouping migration 006 removed; nothing in
  the product ever read it. Deleted; fid ↔ persona resolves from the
  sealed record. **D-FID-5-MAP-SEALED.**
- **The anon window is the scope's epoch** (attack-fid-2 #6, -3 #7). The
  window qualifier had been appended beside the epoch, so a window longer
  than one epoch was one-per-epoch; the window now REPLACES the epoch in
  the scope on both sides, the validator refuses the grace epoch for anon
  posts, and the nullifier is one per root per window by construction.
- **Store-and-forward on live** (attack-fid-2 #2, -1 #10). A live relay
  no longer posts at submission time (which made the network timestamp
  the submission moment, joinable to the client's connection by anyone who
  saw it); the row is PENDING and the validator relays pending rows at the
  top of its own interval, in random order. **D-FID-5-STORE-AND-FORWARD.**
  The cost: a relay that fails then stays pending; the window was consumed
  at acceptance.
- **The relay has an identity rule** (attack-fid-3 #5, #8). The anon
  account must be named explicitly (no fallback to the app's throwaway),
  the validator must be armed (`ENABLE_FC_WRITE`), the configured signer
  must be approved for exactly that fid (checked against Neynar before any
  relay), a foreign signer credential in the validator's env refuses
  everything, the network's reported author must be the configured fid,
  the live cap is counted inside the transaction, and every numeric knob
  is finite and clamped.
- **The cast hash is salted** (attack-fid-2 #7): two identical texts are
  two posts, on the row and on the wire.
- **The money counters survive a reset** (attack-fid-2 #9, -3 #2): live
  fid spend entries and live fid records are read before a seed reset and
  re-sealed after it; a reset that cannot read them is refused; forgetting
  a live record needs a second explicit flag; the $10 figure is a ceiling
  an env line cannot raise; the live-money actions are armed by their own
  flag (`FID_ACQUIRE_ENABLED`), apart from the rig's.
- **Check-before-retry and ledger-before-network in the live command**
  (attack-fid-1 #12, -3 #3): the command reads the custody address's fid
  on the IdRegistry first and RECORDS an existing account instead of
  creating another; the registration's estimate is on the ledger before
  the billable call; the signer recorded is the one the network reports;
  one persona per invocation.
- **No client fingerprint on the network** (attack-fid-1 #4, #5, #6,
  -3 #13): the network profile is the persona's own (name, bio, avatar; a
  refusal if any of it names this client), no fallback fname starts with
  `layers-`, a fork in per-persona-fid mode gets a neutral default handle
  and name, copies neither avatar nor bio, refuses a handle derived from
  the old one when the source already owns an account, and a PRIVATE source forks into a PRIVATE persona (no account); the live recorders carry no
  shared marker; the recorders' output is gitignored.
- **The record is re-derived at write time** (attack-fid-3 #4): the
  identity rule checks the record's signer key and custody address
  against the keys derived for the persona, and an injected rig record
  is fixture-only.
- **Fail-closed reads and writes** (attack-fid-3 #6, #10, #11, #15): a
  failed read of the fid records is a refusal (never an empty set that the
  next save would seal over the vault); the same text under two fids is
  two casts; a fixture or pending record under live content refuses
  rather than writing to the sim; a delete needs the acting persona to be
  the viewer's own; a custody private key in the app's env refuses writes.
- **The proving tick is quiet** (attack-fid-2 #3): the product path
  queues from the tick's own snapshot and persists the queued state on the
  queue's random delay — no identified fetch and no device-signed write at
  prove time (A-PREPARE-BURST now says what the code does); the anon tree
  is in the uniform fetch set (attack-fid-2 #14).
- **The label's tenth condition** (attack-fid-1 #3): the anon composer's
  label is DEMO unless the validator's relay credential is a fingerprint
  distinct from the app's own Neynar key and the anon fid is not the app's
  throwaway; the composer says what the anon mode does not hide (Neynar).

### Assumed, by id (the honest state; not fixed by this pass)

- **A-FID-NEYNAR-SEES-ALL** — under managed custody one developer
  credential creates, signs for and writes as every persona account, and
  relays the anon cast unless the relay account is a distinct credential.
  Neynar (its logs, a breach, a subpoena) joins all of it. The structural
  fix is self-custody signers with direct hub submission (Call Option A)
  and an anon account created and operated by a credential that is not
  the personas' (Call Option B).
- **A-FID-REGISTRANT-BY-FIAT** (attack-fid-1 #2) — **REFUTED ONCHAIN,
  2026-10-07** (the connect-main research read the chain). `registrant`
  and `funder` on a live record are the acquisition script's assertion
  ("neynar-sponsor"), and the chain says more than the record: the
  Register sender for the throwaway (fid 3348985) and for all eight fids
  pre-registered beside it in one burst on 2026-08-29 is this developer's
  own Neynar App Wallet (`0x60a5…`), developer-unique, not a shared
  sponsor; the signer request fid is 6131 (@neynar), shared by every
  Neynar-registered account across many developers, so it fingerprints
  nothing; the recovery address is shared with other developers. What
  links the accounts is therefore the registrant and fid adjacency: a
  persona fid drawn from that wallet's pool is an onchain sibling of the
  Layers-named test account (same sender, same minutes). Consequences:
  `lib/fc/linkage.ts` still treats "neynar"/"neynar-sponsor" as a
  non-attributable registrant (its header claim is wrong and is a pending
  code change; registrant and funder "owner" must count as
  user-attributable, and a `requestFid` finding kind is still to add); the
  owner decides BEFORE the first persona acquisition (`notes/runbooks/GO-LIVE-MORNING.md`
  step 0) whether to accept that siblinghood, acquire through a fresh
  Neynar app and wallet that never touched the throwaway (the personas
  would then share that new wallet with each other), or fund per-persona
  burners. `recoveryOf(fid)` for a persona fid, and the rent payer, are
  still unread (VERIFY-YOURSELF F21).
- **A-FID-MAIN-SEPARATION-BY-VIEWER-FID** (connect-main review PUB-3,
  PL-1, PL-3; built 2026-10-08, not yet on the deployed service) — before
  the owner's main account is connected, `NEYNAR_VIEWER_FID` on the owner
  app is what names "main" on the real network, and the app's buttons and
  the write door (`lib/fc/writes.ts`, `FcMainUnknownError`) refuse every
  real-network interaction by a persona (reply, like, recast, follow,
  @mention) while NEITHER a connected record nor that variable exists;
  plain posts still go out. With it set, a persona's reply, like, recast
  or follow aimed at main, at another own persona from a one-tap button,
  at the shared test account or at the anon account is refused
  (`FC_SELF_LINK`); an @mention is judged by a live name-to-fid lookup
  that is refused when it fails; the anon fid comes from `FC_ANON_FID` or
  the ZK prefetch snapshot and the action is refused while it cannot be
  known under `ZK_MODE=live`. What this does not cover: quote-casts and
  embeds (the write door has none), anything the owner does directly in a
  Farcaster app, timing and behaviour patterns, and a variable set to the
  wrong fid (a safe-direction false positive: it refuses interacting with
  that account). A connected main shares the daily caps with the personas
  (10 casts, 10 follows, 30 actions). The "Act as" sibling waiver
  (A-FID-SELF-GRAPH) still lets two own personas interact on purpose from
  that picker.
- **A-CONNECTOR-FUNDER-BY-WORD** (connector setup, built 2026-10-08, never
  run against the real chain) — the connector account that QR connect
  signs with is created, funded, registered and named by one command
  (`scripts/owner/arm-connector.ps1` driving `lib/fc/connector.server.ts`
  on the owner service). The rule that its address is funded from an
  EXCHANGE withdrawal, never from the Neynar App Wallet, main's wallet or
  a persona, is the owner's word: a plain RPC cannot show who funded an
  address, and nothing in code verifies it (the module states the rule in
  words and refuses only KNOWN addresses, `FC_LAYERS_ADDRESSES`, every
  persona's custody and main's custody, as the connector's custody or
  recovery address). A funder that is one of Layers' own wallets would tie
  the connector, and so main, to the personas onchain for good. Also
  recorded: the connector's custody key sits sealed in the owner service's
  vault (namespace `fcConnector`, ciphertext on the validator), so a
  compromised owner service could sign key requests as the connector, the
  same exposure the environment key (`FC_CONNECT_APP_CUSTODY_KEY`) had;
  adding a key to main still needs an approval in the owner's own
  Farcaster app, which the connector cannot give.
- **A-FID-SIGNER-LOOKUP** (attack-fid-1 #13) — `neynar.score` on live
  vouches for a fid's DERIVED signer key from the app's own record; no key
  on the KeyRegistry is checked. Control is asserted by this process, not
  proven on the network.
- **A-FID-SELF-GRAPH** (attack-fid-1 #6, -3 #19) — a root that interacts
  across its own accounts (act-as replies, follows, likes) publishes that
  edge on hubs; the act-as picker says so at the point of use. The two
  live persona fids the gate's recorder exercises are burned as personas
  by that recording: **A-FID-LIVE-PAIR-IS-FURNITURE** — test furniture,
  never real personas.
- **A-FID-FORK-AUDIENCE-GRAPH** (attack-fid-1 #9) — a carried holder who
  follows the new account at once publishes the edge; the fork's
  protection is against the dropped holder and the operator, not the
  follow graph. (Mitigations named, not built: a randomized delay between
  fork and acquisition, a jittered forward-pointer delivery.)
- **A-FID-CREATION-TIMING** (attack-fid-1 #8) — a sponsored registration
  is timestamped on chain and in the fname registry; the crowd is Neynar's
  volume in that window; a public RPC sees the fresh custody address
  queried before it exists. One persona per invocation, hours apart, and
  a private RPC narrow it.
- **A-FID-ANON-CROWD** (attack-fid-1 #10, -2 #5) — on the network the
  anonymity set of an anon cast is the set of roots posting through this
  validator's shared account; in the demo topology that is one. The
  floor-sized crowd the linkage test asserts is the VALIDATOR's view.
- **A-FID-ANON-TIMING** — the relay slot, not the submission moment, is
  the network time (store-and-forward); session-level correlation between
  the anon cast's slot and the root's persona activity is bounded by the
  interval, not eliminated. **A-FID-ANON-SET-IS-ONLINE-DEVICES**
  (attack-fid-2 #10) — the effective set is the devices online in the
  window, not the tree.
- **A-FID-ANON-RELAY-HOLDS-THE-TEXT** (attack-fid-2 #11, #12) — the
  validator reads every submitted text, relayed or refused, and its relay
  log is its own word; a validator-signed relay log is a later pass.
- **A-FID-CAP-IS-THE-SCRIPT'S** (attack-fid-1 #12, -3 #18) — the $10 cap
  counts `FID_CREATE_USD_ESTIMATE` per registration; the true ETH figure
  is reconciled by hand on dev.neynar.com after each live run.
- **A-FID-LEDGER-MS** (attack-fid-2 #8) — the write ledger, the spend
  ledger and the attribution index are persona-keyed plaintext under the
  device envelope with millisecond timestamps (A-Z2-HOUR-GRAIN is true of
  `updated_at`, not of the JSON inside); the fid on every write-ledger row
  makes A-Z2-ATTRIBUTION-ACCOUNT-JOIN live rather than moot. Persona ids
  were removed from the fid spend rows; the rest is the mock adapter's
  furniture (A-DEV-SURFACE).
- **A-FID-RENT-PAYER** (attack-fid-1 #17) — Call Option C must not renew
  every persona's storage from one wallet in one batch.
- **A-FID-FORK-NAMING-IS-THE-USER'S** — the fork refuses a derived handle
  and defaults to a neutral one; a user who names the new account after
  the old one publishes the fork themselves.
- **A-FID-DEV-SURFACE-LIVE** (attack-fid-3 #12) — the live acquisition
  runs with the rig flag on (the app must expose `custodySign`); the
  money-relevant actions have their own flag, and the rig actions are
  refused on a production build without the rig flag, but a host that
  runs the live command is a host with the rig surface open for that
  session.

### 14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs

Added after the pass closed. Anon posting was unlinkable forever; this makes
it unlinkable *until the author chooses otherwise*. The threat model changes
in exactly one direction, and it is worth being blunt about which.

> **BELOW THE CLOSING BAR — labelled deliberately (post-deploy pass, Gate 0).**
> Everything else in this codebase has been through three fresh-context
> adversarial reviews and four consecutive clean sweeps before it was called
> done. This feature has not. It shipped with its own nine-check suite, the
> surrounding regression set and the validator's unit tests, all green, and
> `notes/reports/REPORT-FID.md` says so plainly — but no reviewer has attacked it and no
> sweep series has run on it as a closing bar. The two follow-on fixes it
> needed were both found by the author rather than by a reviewer, which is
> exactly the pattern reviews exist to break. Treat the protections below as
> asserted by tests, not as reviewed. The post-deploy pass's own review gate
> covers this area and will retire this banner, or replace it with findings.

**What is protected**

- **P-FID-ATTR-COMMITMENT-IS-BLIND** — the value that goes on the wire and
  into the validator's row is `sha256("layers-anon-attribution/1"‖secret)`
  over 32 fresh random bytes. It is unlinkable to the author, to their other
  posts, and to their other commitments; it is not derived from the cast, the
  persona, the fid, the device, or the time. An observer with every anon row
  ever written learns nothing from the column but that a column exists.
- **P-FID-ATTR-COMMITMENT-IS-AUTHENTICATED** — the commitment is inside the
  proof's message, so a relaying validator or a network attacker cannot
  substitute one they can open. Changing it invalidates the proof; the cast
  is rejected before any nullifier is spent (`accept-anon-reveal` #2).
- **P-FID-ATTR-SECRET-NEVER-LEAVES-IN-THE-CLEAR** (corrected by the anon
  review, R1-01) — the secret exists in plaintext only in the memory of the
  device that posted, until its holder reveals it. It is not in the payload,
  not in the proof, and never in the browser (the reveal control sends a cast
  hash and a persona id; the secret is read server-side). It IS stored on the
  validator — sealed under the device's vault key inside the device's own
  `zkQueue` record (lib/zk/anon/queue.ts, claimKind `anon-attribution`),
  ciphertext the validator holds and cannot read — which is what the earlier
  wording "in the vault on the device … and nowhere else" glossed over. The
  full-database grep (`accept-anon-reveal` #7) asserts the plaintext and the
  domain string are absent, not that the ciphertext is.
- **P-FID-ATTR-SEAL-IS-NOT-A-BEACON** (anon review R1-01 / R3-07) — the secret
  used to be flushed to a namespace of its own (`anonAttribution`) with a
  device-signed PUT the moment Post was pressed, before the once-per-window
  refusal: the one row in the validator's database that joined an anonymous
  compose to a root, and a time the operator could line up with the anonymous
  submission that followed. It is now minted in memory, after every refusal,
  and persisted only with the queue's deferred write (30 s to 15 min after the
  proof is queued), in a namespace whose name announces nothing. The cost: a
  crash inside that window after the send loses the reveal secret, and that
  post stays anonymous forever. PRIV-3: the record's SIZE says nothing either.
  An anon submission is pruned once its window has closed and its outcome is
  final (the outcome is kept on its reveal record), and the zkQueue is padded
  to ONE constant size, 64 KiB of plaintext (wave 3, L4: the power-of-two
  classes from 16 KiB stepped with LIFETIME posts, because reveal records are
  never pruned — at roughly 20, 40 and 80 of them), so neither one post nor
  thirty change the stored ciphertext's length (accept-linkage6 checks 8 and
  9). A reveal record keeps no text either: a 128-bit hash of its words, for
  the replay guard, and nothing else of the post.
  **A-ZKQUEUE-CAPACITY** — one 64 KiB chunk is also the most the validator's
  256 KiB body limit takes (it seals to about 128 KiB), so a device past about
  ninety lifetime anonymous posts can no longer persist its sealed queue. The
  way past it is the queue split over several fixed-size records written on
  one schedule (the store's follow-up); until then the ceiling stands, and is
  reached later than before (the old classes hit it sooner, with the text).
- **P-FID-ATTR-REVEAL-IS-VOLUNTARY** — nothing reveals on a timer, on a
  threshold, at another user's request, or as a side effect of any other
  action. The suite asserts a second anon post is still unattributed after
  its sibling was revealed.

**What a reveal actually costs — this is the honest part**

- **A-FID-ATTR-IRREVERSIBLE** — a reveal is permanent, and public in this
  sense: every reader of the Layers server that holds the row sees "revealed
  as" (on the owner service, the owner). Nothing is posted to Farcaster, where
  the cast stays the anonymous account's, and the claim is checkable inside
  Layers only until the persona's derived key is registered on its fid
  (A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY, §14.2). There is no
  un-reveal, and one is not merely missing: a claim a reader could see
  retracted would be worth nothing. Anyone who saw the attribution keeps it.
- **A-FID-ATTR-IS-A-DEANONYMIZATION-KEY** — the sealed secret is exactly the
  material that links a persona to an anon post. Before this feature no such
  material existed anywhere; now it exists on the posting device. An attacker
  who compromises the vault does not merely read the user's data — they can
  attribute that user's past anon posts to a persona of their choosing among
  the user's own. This is the price of the feature and it is not reducible:
  proving authorship later requires keeping something that proves authorship.
  Users who want the old, absolute guarantee should not keep the secret; a
  purge of the sealed record that holds it (the device's `zkQueue` record
  since the anon review; the retired `anonAttribution` namespace for posts
  made before it) restores it exactly.
- **A-FID-ATTR-EXISTENCE-IS-VISIBLE** — the validator can tell a revealed
  cast from an unrevealed one, and *when* the reveal happened to the hour
  (`attributed_at`, A-Z2-HOUR-GRAIN). A reveal timed close to some other
  observable act of that persona is a correlation the user is choosing to
  publish. The cast's own timestamp is unchanged and still hour-grained.
- **A-FID-ATTR-CROWD-OF-ONE** — a reveal removes that cast from the anon
  crowd for everyone else's purposes: the remaining unrevealed casts in a
  window are a smaller set. In a window with two casts, one reveal is close
  to identifying the other. The window sizing note in §14 applies with more
  force once reveals are in play.
- **A-FID-ATTR-CLAIM-IS-ABOUT-THE-CAST-NOT-THE-TEXT** — the commitment binds
  to the cast hash, which binds the text; a reveal therefore proves the
  holder posted *that* text. It does not prove the holder wrote it, and it
  does not prove the persona is a person.
- **A-FID-ATTR-CLAIM-IS-NOT-YET-SELF-AUTHENTICATING** (found while writing
  this section, before the feature was committed) — the reveal endpoint takes
  the `fid` on the caller's word. The APP checks the caller owns that
  persona, but this codebase's own threat model treats the validator as a
  shared service and an observer (that is why §14 removed the persona→fid
  map from it), so "the app checked it" is not a control against a caller who
  is not our app. The holder of a secret can therefore ask the validator to
  record their anon post against SOMEONE ELSE's fid. Our client does not
  render that — `attributedTo` resolves only through this device's own
  persona↔fid records, so a foreign fid shows as plain `anon` — but the row
  is served publicly by `GET /zk/anon-casts`, and a naive reader would
  believe it. Being unrenderable is not the same as being refused.
  **FIXED in the next commit — see §14.2.**

### 14.2 A reveal is a claim, and a claim travels with its evidence

The reveal in §14.1 proved one thing well (the revealer holds the secret
behind this cast's commitment) and one thing not at all (that the fid they
named is theirs). The second half was left to the app, which is not a control
in this threat model: the validator is a shared service, and any caller can
speak to it. So the fid half of a reveal is now signed too.

- **P-FID-ATTR-REVEAL-IS-SIGNED** — a reveal carries a signature by the
  attributing fid's own Farcaster signer key over
  `layers-anon-reveal/1|<mode>|<castHash>|<fid>|<signerPubKey>`. Every part
  that could be swapped is bound: a signature cannot be lifted onto another
  cast, another fid, another universe, or re-labelled with another key. An
  unsigned or unverifiable reveal is refused (400) before the row is read.
- **P-FID-ATTR-VALIDATOR-VERIFIES-AND-CARRIES** — the validator checks the
  preimage and the signature, stores the key it verified under
  (`attributed_signer`, migration 13), and serves it. It does NOT decide
  whose key that is: it holds no fid→key binding and must not (§14 took the
  persona→fid map off it for exactly this reason). It is a carrier of
  evidence, not an authority on identity.
- **P-FID-ATTR-READER-DOES-THE-LAST-CHECK** — rendering "@x posted this"
  is the *reader's* assertion, so the reader ties the key to the fid. This
  client can do that for fids it registered itself; for anything else it
  refuses and the cast stays plain `anon`. The old fallback that rendered a
  bare fid when the profile would not resolve is gone: "we could not check
  this" must never look like a weaker version of "@x said this". The
  acceptance suite proves it the hard way — it takes the validator's storage
  away from it, writes the row an attacker would want (a real fid of ours,
  attributed under a key the rig generated), confirms the public list serves
  the forged claim, and asserts the card still says `anon`.
- **A-FID-ATTR-LIVE-KEY-REGISTRY** (VERIFY-YOURSELF F25) — on live, "is this
  key one of that fid's keys?" is a Farcaster KeyRegistry lookup, and this
  build does not do it yet: it answers only for fids this device registered.
  A live reader looking at someone else's reveal therefore sees plain `anon`,
  which is the safe direction to be wrong in, but it is not the finished
  feature.
- **A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY** (corrected by the anon
  review, R1-07 / R3-06) — the key that signs a reveal is the persona's
  root-derived `fc-signer` key. On every live account the current acquisition
  path creates, that key is NOT registered on the fid (`derivedRegistered:
  false`; Neynar's managed signer is the only key the network knows), so the
  earlier claim that it is "the same key that authorizes that account's
  casts" was false on live, and so was the module comment that "any reader
  can check" a reveal: a third party doing the KeyRegistry check finds the key
  absent and must render plain `anon`. Today a reveal is checkable INSIDE
  LAYERS ONLY, by a client holding this device's own persona↔fid record, and
  the reveal panel says so. It becomes checkable by anyone only once the
  self-custody pass registers the derived key on the fid. What does hold: a
  signer key alone reveals nothing (the secret is a separate compromise),
  which is why both halves are required; and once the derived key is
  registered, compromise of it is also enough to attribute an anon post the
  attacker holds the secret for.

## 15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary

Gate 1 (the reputation UBI) is written here now; Gate 4 adds the search
boundary to this same section; Gate 7's reviews revise it.

### What the validator learns from stakes — and does not

| datum | where it lives | what the validator sees |
|---|---|---|
| the allowance (per root, per epoch: allowance, remaining, the tier it came from) | the vault, ONE opaque padded sealed record (`influence`) | ciphertext of a fixed 1 KiB step — never the balance, never the tier |
| a stake (persona, cast, action, direction, amount, epoch, nonce) | the validator's `stakes` table, per PERSONA, signed by the persona key, hour-grained, WITHOUT ROWID | all of it — that is the public half of the mechanic (legibility) |
| the owner's own stake history | mirrored in the sealed record for the owner's view and for recovery | nothing beyond the public rows it already holds |
| the per-action defaults and directions | the sealed record | nothing |
| a settled accrual | ONE `stewardship` rep event per evaluated epoch, posted with the account's own root handle, integer count, hour-grained | `(root, stewardship, count, epoch-stamped source id)` — a root-level reputation fact, as every rep event is |

**Protected, by construction**

- **P-MEGA2-NO-TRANSFER** — influence never moves between accounts. The
  adapter contract has no such method; `lib/influence/types.ts` asserts it
  at the type level; the suite greps it. A transfer would be the one thing
  that turns a reputation allowance into a currency.
- **P-MEGA2-NEVER-OVERDRAWN** — a stake above the remaining balance is
  refused (409) with the balance untouched; the balance is reserved before
  the send and refunded on a refusal; it recharges to exactly the allowance
  once per epoch on the validator's clock, and a balance stamped ahead of
  that clock is reset, never honoured.
- **P-MEGA2-ALLOWANCE-FROM-PROOF** — under zk the allowance derives from the
  tier the persona PROVED this epoch (nothing proven → nothing to spend);
  under the legacy bindings, the legacy tier. The rep path is the existing
  one: the accrual is a rep event, the tier trees rebuild from rep, the
  persona proves the higher tier the way it proves any tier. No new claim
  kind, scope or primitive was added.
- **P-MEGA2-STAKES-VERIFY-AT-THE-READER** — the validator verifies a stake
  under the key it is handed and carries that key; every reader re-verifies
  each row against the key it resolves for the persona and treats an
  unverifiable row as absent (the refutation-edge discipline). A row signed
  by a foreign key claiming a persona is stored (the validator cannot know
  whose key it is) and excluded by every honest read.
- **P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL** — a persona's history is
  served to its owner always and to anyone else only if the persona's
  EXISTING disclosure grant admits them; a failed disclosure read refuses.

**Assumed, by id (the honest state)**

- **A-MEGA2-STAKE-ROWS-ARE-PUBLIC** — per-cast stake rows name the persona
  and are served to anyone. Disclosure governs the app's per-persona HISTORY
  view, not the validator's per-cast table: a persona's staking record is
  reconstructible from public rows by anyone who cares to, at the
  granularity of an hour. That is the legibility the mechanic wants, and it
  is a fingerprint the same way any public action is.
- **A-MEGA2-ACCRUAL-MAGNITUDE** — the accrual lands on the ROOT once per
  epoch as a coarse count while the stakes that earned it are per-PERSONA
  rows. An operator who can see a root's stewardship count rise in an
  epoch where a particular persona's confirmed stakes rose can correlate the
  two. Mitigations in this build: the count is a coarse integer (five
  weighted points per event, capped at ten per epoch), posted once, one
  epoch late, hour-grained; a root's count aggregates all its personas'
  stakes. Not a mitigation: nothing hides which epoch it was. This is the
  residual persona ↔ root link the reputation mechanic reintroduces by
  design, and Gate 7's linkage test v5 must bound it.
- **A-MEGA2-VALIDATOR-CANNOT-SEE-OVERDRAW** — the validator holds no
  balance and cannot tell an over-spent stake from an honest one. A hostile
  client can post stakes beyond its allowance; the amount per event is
  bounded at 50, readers see the per-persona pattern, and a lens may weight
  against it. Enforcement of the allowance is the device's, not the
  network's.
- **A-MEGA2-NO-DWELL** — the prompt lists dwell among the accrual's
  confirmation signals and among a lens's ranking signals. The relationship
  event log bars dwell/impression events by construction (a closed union a
  suite greps); this build does not record attention anywhere. Accrual
  confirms on non-retraction, community notes and standing. Where a lens
  says `dwell` it means the reading-time DEMAND of the content (its
  length), never measured viewer attention
  (A-MEGA2-DWELL-IS-CONTENT-NOT-BEHAVIOUR, Gate 2).
- **A-MEGA2-EARLY-CURVE-IS-CONFIG** — `// TUNE: owner has unresolved design
  intent here`. The early-to-content term is one weighted curve with a
  conservative default, and the creator-economy tie-in it is meant to feed
  is unspecified; both are on the docs site's open-issues page.
- **A-MEGA2-COORDINATION-IS-LEGIBLE-NOT-ENFORCED** — clusters are detected
  from public rows and shown; nothing here refuses or punishes. A lens may
  weight against it (the seeded slow-reads lens does, by half).

### The search boundary (Gate 4)

| datum | where it lives | what the validator sees |
|---|---|---|
| the unified index (posts, private posts, DMs, likes, bookmarks, stakes, relationship events, imports) | the app process's memory, rebuilt from the decrypted vault when the record set changes | nothing — no query, no index, no endpoint; the validator has no search route over vault types (grepped) and a search answers with its port closed |
| a keyword or semantic query | the app process | nothing |
| the local model | a worker thread in the app process (a synonym-cluster embedding shipped in-repo) | nothing |
| a cloud query, with consent | the (fixture) provider path, in-process | nothing; in a build with a real provider, exactly the N snippets the consent named |

- **P-MEGA2-SEARCH-NEVER-LEAVES** — the index is derived in the process that
  holds the vault and is never persisted anywhere; the validator never
  receives a query over private data or a private index. Survives a
  restart by being re-derived, never by being stored.
- **P-MEGA2-SEARCH-SINGLE-ROOT** — only this device's own personas' records
  are indexed; another root's private post a grant lets this viewer read is
  not "something this user touched" and is not searchable here.
- **P-MEGA2-CLOUD-CONSENT-IS-PER-QUERY-AND-NAMED** — the cloud path is off by
  default; a query is answered with "send these N snippets to <provider>?"
  and the exact preview; only a consent matching provider, count and query
  hash runs it. Never silent.
- **A-MEGA2-EMBEDDING-IS-A-LEXICON** — the local model is a synonym-cluster
  embedding, not a neural encoder: it finds a paraphrase only where the
  lexicon knows the words are kin. Honest, small, and replaceable behind
  the same interface; shipping a real model means shipping weights.
- **A-MEGA2-CLOUD-IS-A-FIXTURE** — no real provider is wired. With one, the
  consented snippets are private content leaving the device: the label must
  say so on the consent card, and a provider's retention is beyond this
  posture's reach (the same class as A-FID-NEYNAR-SEES-ALL).
- **A-MEGA2-SEARCH-IS-A-FINGERPRINT-ON-THE-DEVICE** — the index is the most
  complete map of what this person touched that exists anywhere; it lives
  only in memory, but a device compromise reads it whole. That is the price
  of "everything from one box" and it is not reducible.

### What linkage v5 measured (Gate 7)

The operator-view linkage test v5 (`scripts/accept-mega2-g7.mjs`) runs the
session this pass made possible — two proven personas of one root stake in
the same hour on different casts, one switches its lens, the device saves a
reading layout, the private persona writes a post that the device then
searches by keyword and by paraphrase, one persona lands a DM through the
@layers hook, the other links a second X handle and the first ports the
relationship to a counterpart — and then judges only from the validator's
rows, its state namespaces, its log and the timing of its own writes.

- **A-MEGA2-STAKE-COTIMING** — stakes are public rows with an hour-grained
  `created_at`. Two personas of one root that stake in the same hour are
  co-timed, and co-timing is a behavioural link the validator can compute.
  The test does not hide it; it MEASURES the candidate set (every persona
  with a stake in that hour) and refuses to pass if the set is smaller
  than 3. On the fixture universe the set was 10 personas. Real traffic
  makes the set larger, not smaller; a quiet hour makes it smaller, and a
  persona that is the only staker in an hour is alone in it. The
  mitigation is the grain (hours, not seconds) and the public nature of the
  rows — a lens can weight against co-timed stakes, and an owner can see
  their own pattern in the influence layer. Same class as
  A-FID-BEHAVIOURAL-LINK.
- **Byte-identical across the searches** — per-table hashes of every row
  before and after a keyword search and a semantic (paraphrase) search were
  equal, the validator's log gained no bytes, and no query or private text
  appears in any row afterwards. That is the whole of the evidence for
  P-MEGA2-SEARCH-NEVER-LEAVES on this build, and it is re-run on every
  sweep.
- **What the DM and the port leave behind** — one attestation per persona
  (public by design, as before), a page cursor, a private folder row whose
  entry is the opaque `dm:` hash, and ciphertext; the tweet id, the DM text
  and the unlinked sender appear nowhere. No row joins the two personas by
  id or by handle after the port; the port and the grant it issued are
  ciphertext.
- **The floor held** — the two personas' eligibility rows carry distinct
  nullifiers at the same epoch inside a cohort of 121 registrations.

### After the three reviews (Gate 7, part 2): what changed, what is now assumed

Three reviewers (Sonnet, fresh context, one focus each; `research/attack-mega-{1,2,3}.md`)
read the diff since `d9105d5` against this section. Every finding above LOW
was either fixed in code with a check that would go red on regression, or
written down here by id. Corrections to claims made earlier in this section:

- The `stewardship` rep event was described above as hour-grained. It was
  not — `/events` stamped every rep row with the millisecond (attack-mega-1
  F1). It is now: `rep_events.created_at` carries the hour like every other
  root-adjacent row — at `/events`, in the seed and in the poller — and
  migration 15 coarsened the rows already on disk; linkage v5 asserts it on
  every `stewardship` row.
  What remains is the table's insertion order (an AUTOINCREMENT rowid), named
  below as an assumption.
- `P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL` holds at the APP's own query
  path. The validator's per-persona `GET /stakes?personaId=` is public by
  design — the same fact as `A-MEGA2-STAKE-ROWS-ARE-PUBLIC` from the other
  side (attack-mega-1 F2). The app's disclosure gate is what a Layers client
  shows; it is not what an operator with the port is limited to.
- The `modes` namespace was plain. A mode is a persona's reading
  configuration — its rules, ranking weights, filter packs, the lens pin and,
  since Gate 3, its button bindings — and two personas of one root with the
  same unusual configuration were a habit fingerprint the operator could
  cluster with no cryptography (attack-mega-2 F1). `modes` is now ONE opaque
  sealed record, like the zk queue and the zone layouts; linkage v5 asserts
  the namespace is ciphertext and that no mode field appears in plaintext.
- The DM bookmark's opaque hash was salted with the ROOT's vault key, so two
  personas of one root that bookmarked the same tweet produced the same
  hash, joinable through the plain folder rows (attack-mega-3 F1 — the one
  CRITICAL of the three reviews, and exactly the join
  D-MEGA2-7-OPAQUE-MEANS-NOT-DERIVABLE-FROM-WHAT-THE-OPERATOR-HOLDS claimed to
  rule out). The hash now folds the persona id into the keyed message, and
  the `readwise` queue — whose per-record addresses were
  `persona:postHash` in plaintext even though its values were sealed — is
  one opaque record too. Linkage v5 now has both personas land the SAME
  tweet and asserts their hashes differ and that no `dm:` hash sits under two
  personas anywhere.
- The unlinked-sender hash in the session replies log was unkeyed
  (attack-mega-3 F3); it is now keyed with the vault key. The log stays
  in-process and never reaches the validator.
- Device loss (`simulateDeviceLoss`) now clears the in-process caches this
  pass added — the search index and its worker, the influence allowance,
  the zone layouts, the port record — so recovery rebuilds them from the
  vault rather than inheriting a warm cache (attack-mega-2 F2).

**Assumed, by id (added by the reviews)**

- **A-MEGA2-REP-EVENTS-KEEP-ORDER** — `rep_events` is an AUTOINCREMENT
  table; even at hour grain the rowid preserves insertion order across
  roots. A stewardship row names its root in the clear (rep has always been
  root-addressed), so order adds nothing persona-level, but a root's accrual
  cadence is visible in sequence. Rebuilding the table `WITHOUT ROWID` is a
  migration for a later pass (attack-mega-1 F1, residual).
- **A-MEGA2-PORT-PENDING-TRUSTS-THE-HANDLE — RETIRED** (post-deploy pass,
  Gate 0). The assumption was that proving an X handle was *authorisation*:
  a pending port resolved into a real disclosure grant the moment any
  persona attested the handle it named, so its safety rested on that handle
  never changing hands, being mistyped or being squatted first, with a
  30-day lapse as the only bound. That is no longer how it works. Proving
  the handle now raises an OFFER and discloses nothing; the port sits in
  `awaiting-confirmation` until the persona that issued it confirms, and a
  decline ends it for good. What remains assumed is narrower and is stated
  as its own line below.
- **A-POST-PORT-OFFER-NAMES-BY-HANDLE** — the handle still decides WHO gets
  offered the confirmation. Someone who squats or takes over the handle can
  therefore raise an offer the owner did not expect, and the owner's only
  evidence that it is the right person is the handle itself plus whatever
  they know out of band. The cost of being wrong is now a prompt rather
  than a disclosure, and the offer lapses with the port's own window.
- **A-MEGA2-BREADCRUMB-IS-PUBLIC-ON-X** — the synchronized-like breadcrumb
  (two likes on one old post, 3 to 12 s apart, from the root's two X
  accounts) is visible to X and to anyone reading both accounts' public like
  activity; alt-linking has always made it, and porting now makes it for a
  counterpart. It is a deliberate, deniable, user-initiated self-link — the
  posture never claimed X cannot see it, and now says so (attack-mega-3 F4).
- **A-MEGA2-UNLINKED-SENDER-LOG-IS-A-SESSION-LOG** — the replies log lists
  every unlinked sender the Layers account was DMed by, as a keyed hash, to
  any caller of the inbox route in this process. It is not persona-scoped
  because the inbox is the Layers account's, not a persona's; it is not
  persisted. In a deployment where the app is shared, the route needs an
  owner check (attack-mega-3 F3, residual).
- **A-MEGA2-PREFERENCE-NAMESPACES-STILL-PLAIN** — `rules`, `activeMode`,
  `folders`, `followedFacets` and the other per-persona preference
  namespaces are still plain, as they have been since the first pass. Each
  is a smaller fingerprint than a mode definition, and each names one
  persona, never a root; sealing them is the same one-line change per
  namespace and is on the open-issues page (attack-mega-2 F1, scope note).
- **A-MEGA2-INDEX-HAS-NO-OWNER-KEY** — the search index and the embedding
  worker live in the app process with no owner key of their own; they are
  as private as the process. That is section 8's topology restated for this
  feature, not a new exposure (attack-mega-2 F3).


## 16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do

**The one rule.** The server never holds a root, a seed, a vault key or a
persona private key — not per tenant, not sealed, not in a TEE. The server
holds ciphertext, commitments, public keys and public state; the browser
holds everything else (docs/custody-model.md). A production server refuses
to open or write a keystore at all; `scripts/probe-no-keystore.mjs` starts
one on an empty directory and asserts it stays empty.

**What the browser holds.** The 32-byte seed (memory only until the
visitor saves; then wrapped under each method's key in IndexedDB and, for
the PRF and provider paths, as a blob on the validator); the vault key and
the device-auth key (derived, in memory); persona private keys (derived,
used, dropped); the device key; the zk identity; every nullifier secret;
the vault plaintext; the search index. A device that was LINKED rather than
minted holds the vault key, the zk master and per-persona key leaves as
values, plus a delegation for its own device key — and no seed, so it can
act as every persona and open the vault, and cannot mint a persona, export
the 24 words, or authorise another device.

**What the server holds.** The validator: one device-auth anchor per root
(a public key), device public keys and delegations, envelope counters,
every namespace as ONE opaque sealed record per namespace keyed by anchor,
zk commitments and trees, custody method records (a public identifier — a
credential id or a provider subject — bound to an anchor, with the
credential's SPKI key for passkeys) and wrapped-seed blobs (ciphertext),
short-lived link and root-link relays (device keys, HPKE public keys,
ciphertext, two public anchors). The app server: the public corpus, the X
OAuth client secret (a server credential), and ONE custody secret from
which wrap-path release keys derive — the single place a server holds a
key, and it is not a root, a seed, a vault key or a persona key.

**What each save path trusts.**
- *Passkey, PRF path:* the authenticator's PRF output for a fixed salt is
  the KEK source; the same synced passkey yields the same KEK on any
  device, and the blob is on the validator, so the root follows the
  passkey. Trusts the platform's passkey sync and WebAuthn.
- *Passkey, wrap path (no PRF):* the KEK is HMAC(server secret, credential
  id), released after the app server verifies a WebAuthn assertion (no
  CBOR, no attestation; Ed25519 or ES256 via WebCrypto, challenge with a
  two-minute TTL spent once, origin, RP id hash, user-present). The blob
  lives only in the browser: the account is device-bound. Trusts the
  server not to release without an assertion, and the release secret's
  continuity (A-CU-2-RELEASE-SECRET-ROTATION).
- *Social login:* the provider's exported secret is a KEK source through
  HKDF; the provider never sees a Layers key. Trusts the provider's
  export determinism. The real provider is NOT in the tree; the fixture
  is the only adapter (A-CU-2-REAL-PROVIDER-NOT-EXERCISED).
- *The 24 words:* the seed itself, shown in the browser, never
  transmitted. Trusts the person.
- *Common to all:* a method id belongs to the first anchor that wrote it;
  a stranger cannot overwrite a blob; a login that finds nothing is an
  empty account and never creates.

**What root linking does and does not do.** It stores a pairwise grant,
signed by both roots' device-auth keys on the devices that hold them,
sealed in each vault; each client then presents the other root's personas
beside its own, with the sentence "linked, not merged — reputation does not
combine". It does not merge personas, nullifiers or reputation; a device
cannot act as a linked root's persona (it holds no key for it); search over
a linked root's vault is not built (A-CU-3-UNIFIED-SEARCH-IS-PRESENTATION-ONLY).
The validator relays two public anchors and learns nothing it did not
already hold.

**What is measured, every sweep.** `scripts/device-smoke.mjs`,
`scripts/accept-cu2.mjs`, `scripts/accept-cu3.mjs` and
`scripts/accept-cu4.mjs` grep the validator's database, its log and the
app's log for every seed, KEK, PRF output, provider export, persona key
leaf and device key the devices under test used, and assert the readiness
audit's findings flipped on a production-shaped pair.

**Gate 5 — what three adversarial reviews changed in this section**
(`research/attack-custody-{1,2,3}.md`; every finding fixed or an
assumption by id in notes/reports/REPORT-CUSTODY.md, Gate 5).

- *What the server holds, corrected.* A provider method record names a
  HASH of the provider subject, never the subject; the public projection
  of any method record carries its kind, SPKI and algorithm and no
  anchor, so the validator is not a subject → anchor oracle. The root-link
  relay holds anchors, root ids, ephemeral X25519 public keys, HPKE
  ciphertext and signatures — never a persona roster (v2: each side's
  roster is sealed to the other side's ephemeral key and the co-signatures
  commit to the rosters' hashes). A `root_link_grants` table records the
  two anchors of every completed grant so revocation and the revoked-probe
  are scoped to its parties. The device-link relay's public row omits the
  approving anchor and root id. Seeded roots carry the anchor `seed`;
  no root is anchorless.
- *The social path, corrected.* The fixture provider is a rig adapter:
  it exists in a device only when the page declared
  `CUSTODY_FIXTURE_PROVIDER=allow`, which the app's page does only on a
  server running with the dev hooks and the smoke page does only on a
  loopback host; it takes no default subject; the boot contract refuses
  the flag on a public deployment. A public deployment without a real
  provider has no social path and the picker says so (the real provider
  is still not in the tree: A-CU-2-REAL-PROVIDER-NOT-EXERCISED).
- *The wrap path, corrected.* The release fails closed: 503 when the
  validator errors or is unreachable; the caller's key is accepted only
  on a confirmed 404 (the first save of a wrap-path passkey, whose blob
  never leaves the device). Allowed origins come from `APP_URL` and
  `CUSTODY_ALLOWED_ORIGINS`; loopback is allowed only off a public
  deployment; the RP id is `APP_URL`'s host. The validator refuses a blob
  under a wrap-path record. `unwrapSeed` is told which method it expects.
- *Linking, corrected.* Both link flows show a fingerprint on the device
  that will receive and require it typed on the device that grants, before
  anything is sealed (D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES); the
  approving screen states what is granted. A linked root is installed only
  after its delegation verifies against the anchor the material names.
  Moving a device between anchors requires a signature by the device's
  own key (`x-layers-device-proof`); `/device/register` requires the
  anchor to be named. Open link offers are capped per address and swept.
- *Envelopes, corrected.* The custody namespace is split by operation
  class (`custody`, `custody:delete`, `custody:revoke`), so a captured
  envelope of one class cannot be replayed as another
  (A-CU-5-ENVELOPE-BINDS-NAMESPACE-NOT-PATH for what remains). `/roots`
  binds the pseudo-fid to the caller's anchor; `/events` bounds its count;
  a signed `DELETE /state` touches shared fixture rows only on a rig.
- *The public deployment, corrected.* The environment contract has a
  must-be-set half: `LAYERS_REQUIRE_SIG=true`, checked at boot on both
  processes. Both rate limiters key on the socket address and honour a
  forwarding header only under `TRUST_PROXY=true` (A-CU-5-TRUST-PROXY);
  the validator's limiter is mounted ahead of the anonymous channel. A
  production build with the dev hooks prints a rig banner at boot
  (A-CU-5-PRODUCTION-IS-NODE_ENV-PRODUCTION). The debug accessors the leak
  greps use exist in the device only under `LAYERS_DEVICE_DEBUG=1`, which
  a public page never declares; the smoke page boots only on loopback and
  Gate 6 excludes it from the deployment. `/api/recovery` and the dev
  route refuse on a production server before reading a body.
- *The device, stated plainly.* The device runs in the page: any script
  on the origin can do what the page can (A-CU-5-THE-PAGE-IS-THE-DEVICE),
  as with any client-side wallet; the origin's defences — no third-party
  script, a strict CSP — are Gate 6's. The device's wipe drains its mirror
  queue before clearing; a namespace the device once sealed is refused
  as plaintext on hydrate; a method the validator no longer records while
  the device still holds its blob is a loud error, not an empty account;
  importing the 24 words creates the anchor the validator lacks
  (D-CU-5-THE-24-WORDS-ARE-THE-ESCAPE-HATCH).
- *Still assumed, by id.* A-CU-5-THE-PAGE-IS-THE-DEVICE, A-CU-5-TRUST-PROXY,
  A-CU-5-CHALLENGE-REPLAY-PER-INSTANCE, A-CU-5-PROVIDER-SUBJECT-PROOF,
  A-CU-5-ENVELOPE-BINDS-NAMESPACE-NOT-PATH, A-CU-5-PRODUCTION-IS-NODE_ENV-PRODUCTION,
  A-CU-5-AUDIT-DEVICE-MEASURES-THE-SMOKE-PAGE, A-CU-5-PSEUDO-FID-IS-32-BITS-OF-THE-ANCHOR,
  A-CU-5-ANCHOR-CREATION-IS-OPEN-UNDER-THE-LIMIT, A-CU-5-PER-RECORD-NAMESPACES-KEEP-ADDRESSES,
  A-CU-5-ROUTE-ERRORS-ARE-MESSAGES. Deferred by decision to Gate 6:
  D-CU-5-THE-ROOT-LAYOUT-MOUNT-IS-GATE-6, D-CU-5-THE-SMOKE-PAGE-IS-A-RIG-SURFACE.
- *What is measured, extended.* `scripts/accept-cu4.mjs` (nine checks on
  the production-shaped pair) starts a public deployment without
  `LAYERS_REQUIRE_SIG` and one allowing the fixture provider and asserts
  both refuse naming the variable, and sends bursts with distinct
  forwarding headers to both processes and asserts they are still limited;
  `scripts/accept-cu3.mjs` refuses a wrong fingerprint on both link flows
  and greps the root-link relay row mid-exchange for either roster;
  `scripts/accept-cu2.mjs` adds every browser console line to the leak
  grep's haystacks.

**Gate 6 — what a public deployment changes, and what it does not**
(notes/reports/REPORT-CUSTODY.md Gate 6; the preview is live at the URLs notes/runbooks/MORNING.md
names.)

- *Who answers the app's API.* On a PUBLIC deployment every page under the
  app group runs the visitor's own device, and `/api/*` is answered in that
  page — the deployed app server holds no identity to answer with. On the
  RIG the server still answers, because that is the topology the legacy
  suites measure; the two are distinguished by the same predicate the boot
  contract uses (production without the dev hooks). The landing page at `/`
  is outside that boundary and reads nothing at all.
- *What the deployed server holds.* The app server holds two secrets, each
  a platform variable on the app service and never in the repository: the
  wrap-path release key, and — once the owner sets it — the Neynar READ key
  (§19, D-FCREAD-KEY-SERVER-ONLY), which one server-only module reads, which
  unlocks reads and never a write, a signer or a wallet, and which the
  validator refuses to boot with. Without the read key the relay reports
  `no_key` and nothing else changes. The validator holds its SQLite database on a mounted volume:
  the same ciphertext namespaces, public keys, commitments and relay rows
  as ever, plus scheduled `VACUUM INTO` dumps of the same file beside it.
  A backup is not a new exposure class — it holds exactly what the live
  database holds — but it is a second copy, so the volume is the boundary.
- *What the platform sees.* Its edge terminates TLS and sets the
  forwarding header both services now trust (`TRUST_PROXY=true`), so it
  sees every request's address and path, as any host would. That is the
  honest reading of A-CU-5-TRUST-PROXY for this deployment: rate limits
  and the per-address caps are per visitor only if the edge SETS that
  header rather than appending to one the client sent, and that is
  unmeasured on this platform — its own staff answers conflict
  (A-FCREAD-FORWARDING-HEADER). Until a header-echo measurement, per-address
  keying is best-effort and the global buckets, which do not read the
  header, are the bound. The platform itself is in the trust base for
  metadata — never for content, because what it forwards to the validator
  is ciphertext and public state.
- *What is off, by contract rather than by promise.* Both processes refuse
  to start if any must-not-ship name is set or if signed envelopes are not
  required; both refuse every dev surface, including the live diagnostic;
  the fixture custody provider is refused outright, so the deployment has
  NO social login and the picker says so. Live writes and live proving
  are off, and a public deployment cannot turn them on without failing its
  own boot check. One spend path exists, bounded and metered: the read
  relay (§19), which spends Neynar credits on cache misses only, under a
  per-instance daily credit budget, arms only with its own key on a public
  deployment, and stays unarmed — never refusing to boot — when anything
  about it is misconfigured.
- *The abuse bounds.* New identities per address per day and signed writes
  per device per hour, on the validator, where a stranger's cost lands;
  a 429 with a sentence, never a queue. The device treats a 429 as "later"
  and retries within a bounded window, because onboarding is a burst of
  signed writes and the first thing an exhausted budget breaks is getting
  an identity at all.
- *What the logs hold.* Counts and outcomes. The caps and the limiter emit
  one aggregate line per burst with no address and no id; the Gate 6 suite
  greps both process logs for a persona id, a 64-hex key and any
  non-loopback address before it will pass.
- *What a visitor is told.* The landing page states the preview's status in
  the posture document's own narrow words, and the banner inside the app
  renders the label the device computed — DEMO with the failing conditions
  named, or the private sentence only when every condition holds. A
  verdict that cannot be computed renders as NOT private. Neither is a
  constant, and `test:cu6` compares the banner's numbers against the
  device's own verdict rather than trusting the text.
- *Where the docs are served (D-DOCS-UNDER-APP, the owner's decision of
  2026-10-10, superseding D-CU-6's "the app never builds or serves
  docs/").* The docs are no longer a separate service on an origin of
  their own. `npm run build` builds them from the committed source, with
  `SHOW_INTERNAL` removed from the build's environment, into a folder the
  app serves at `/docs` (`app/docs/[[...slug]]/route.ts`), and the same
  build fails when that output holds an internal page, the internal
  section's path, the internal roadmap's data, a platform app hostname or
  a link that leaves `/docs/` (`scripts/docs-guard.mjs`). The app's own
  code still imports nothing from `docs/`.
  **The accepted risk, stated plainly:** the docs' client scripts now run
  on the app's origin, where every visitor's browser keeps its
  non-extractable wrapping key in IndexedDB, and any script on that
  origin can use what the origin holds (A-CU-5-THE-PAGE-IS-THE-DEVICE).
  A defect in the docs' framework code, or a script a docs page carried,
  would have the same reach as the app's own code. The mitigations:
  every docs page is authored in this repository (no user content, no
  third-party script, nothing fetched at run time); the site is built
  from the committed source by the deployment itself, never uploaded
  from a laptop; and every `/docs` document carries a content security
  policy that runs only the site's own script files and the inline
  scripts whose hashes it names (computed from the page being served),
  loads only from this origin, connects nowhere but this origin, and
  cannot be framed. What the policy does not do: it narrows what an
  injected script could load and where it could send what it read, but
  it does not stop a script the build itself shipped, and
  `connect-src 'self'` still reaches the app's own API
  (A-DOCS-UNDER-APP-SHARES-THE-KEY-ORIGIN). The owner took that over a
  second origin. Two smaller changes come with it: the app's kill
  switch now pauses the docs too, and a docs edit ships only with an app
  deploy.
- *What is still assumed.* Everything in the Gate 5 list, unchanged, plus:
  the platform is trusted for metadata and availability
  (A-CU-6-THE-PLATFORM-SEES-METADATA); a passkey is bound to the host that
  saved it, so moving to a custom domain orphans passkeys saved under the
  platform subdomain (A-CU-6-RP-ID-IS-THE-HOST); the app's own pages have
  no content security policy yet beyond `frame-ancestors 'none'` (added for
  the read relay, §19, which limits who may frame a page and nothing about
  what a page may load or run), so the "any script on the origin can do
  what the page can" assumption (A-CU-5-THE-PAGE-IS-THE-DEVICE) is
  mitigated on those pages only by the app serving no third-party script
  (A-CU-6-NO-CSP-YET); and the docs share that origin under the policy
  above (A-DOCS-UNDER-APP-SHARES-THE-KEY-ORIGIN).

---

## 17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader

This pass built things people TOUCH — a clone, a colour, a toggle, a hard
scope — and the honest statement about each of them is about what a cue can
and cannot do, not about cryptography. Nothing here changes what the
validator learns; the vault records this pass adds (`personaChrome`) are
sealed whole like `modes`, one opaque padded record under one opaque key, so
the operator cannot even read the ADDRESSES as a sibling set.

### What the persona cue is

Every surface under the app group carries, at every width: the active
persona's HANDLE in text (the pill), a per-persona accent wash on the chrome
only, and the active mode as a border treatment. Three channels, two of them
independent of colour.

The palette is chosen by measurement rather than by taste. Its eight accents
hold a minimum pairwise CIE76 distance of about 15 under normal vision,
deuteranopia, protanopia and tritanopia (Viénot–Brettel–Mollon simulation in
linear sRGB), and a hand-picked colour that would collapse onto a sibling's
under any of those models is refused with the model and the distance named.
The first version of the palette failed this check at a distance of 4.3, and
the palette was what changed.

### What compartment mode does

One tap scopes the device to the active persona. Four surfaces narrow AT THE
API, not in the DOM: the search index (which is BUILT from one persona's
records, not filtered afterwards), the account switcher, the act-as picker,
and a sibling's stake history. Turning the cross-persona view on while
compartment mode is held is refused; leaving compartment mode does not turn
that view back on.

### What a delivery tier is, and what it is not

A tier is a property of the PAIR (account, mode): never-miss in one mode and
quiet in another is one setting on one account. The map is sealed whole in the
vault for the same reason the tints are — which accounts you never want to miss
and which you have quietly turned down is a map of what you care about, and the
record ADDRESSES would say as much as the values.

The tiers are compiled into ordinary rules and evaluated by the same evaluator
modes, packs, lenses and channel gates use. There is no second filtering path
for them to live in, and the account never enters a rule: one rule per
non-normal tier matches a single field whose value the feed resolves per post.

Two of the five actions a rule may now carry — `pin` and `banner` — are
DEVICE-ONLY. An imported algorithm is still allowlisted to hide, downrank and
flag, and an import naming either of the new two is refused by name. An
imported algorithm that could pin an account to the top of somebody's timeline
is an ad slot with extra steps; one that could banner an account is a push
channel.

The tiers change PLACEMENT, never membership. Pinning reorders what the feed
already holds: on a fully exhausted feed a never-miss post does not come back,
above or below the caught-up banner, and the banner tier's strip is drawn from
the same eligible set the timeline was built from. The delivery keys also sit
BELOW the demote key in the feed's final ordering, so a sunk or curator-flagged
author stays sunk — never-miss is the owner ordering their own timeline, not a
way to overrule a flag on the author.

### What readwise records about the reader

Dwell — how long a paragraph was on screen — is the most intimate thing this
product measures, because it is a record of attention rather than of action. It
is written DIRECTLY into a sealed vault record and never through an adapter: no
adapter method takes a dwell value, so no adapter payload can carry one, and the
Gate 4 suite asserts that against the adapter INTERFACE rather than by watching
traffic. The validator holds ciphertext under one opaque key and learns neither
what was read nor how long anything was looked at.

Nothing is sent per tick. The card clocks time locally while it is at least half
on screen and flushes an accumulated total when it leaves; a per-tick stream of
"this person is still looking" would be a surveillance feed even encrypted.

The read threshold is arithmetic on the chunk's own length — words over a
reading rate, with a floor — and that is the whole of the model. There is no
retention estimate, no spaced repetition and no difficulty score, deliberately;
the suite greps for that vocabulary and asserts zero hits so the line holds
after this pass rather than only during it.

Reading progress is ROOT-scoped by construction: the dwell map is keyed by
chunk, not by (persona, chunk), because one device holds one vault and one
person is reading. That is also the honest statement of its limit — progress
cannot be per-persona here, so a persona used by a second person on the same
device would share it.

### Assumptions added by this pass (by id)

- **A-POST-FOLLOWS-ARE-ONE-LIST** — in this codebase a follow belongs to the
  DEVICE, not to a persona: one set, every persona reads it. A clone
  therefore cannot copy, withhold or partially copy follows, and reports the
  count it SHARES instead of offering a control that would do nothing. The
  correlation risk lives one layer out, on the NETWORK, where a follow is an
  action by a persona's own account and two accounts following the same set
  are comparable by anyone. Nothing in this pass creates or prevents that.
- **A-POST-TINT-IS-A-CUE-NOT-A-CONTROL** — the tint makes the acting persona
  fast to read. It does not gate anything: a person who ignores both the wash
  and the pill can still post as the wrong persona, and the product does not
  block a post on the grounds that the colour looked wrong. The cue's job is
  to make the mistake unlikely, not impossible.
- **A-POST-TINT-IS-PER-DEVICE** — tints live in this root's vault and travel
  with the vault, not with the persona. A persona opened on a device that
  cannot read the vault renders untinted, and the pill is what carries the
  identity there. This is deliberate: the tint fails open (degrading to no
  colour) so that a validator hiccup costs the shortcut and never the handle.
- **A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC** — compartment mode narrows what
  the APP shows and indexes. It does not erase what is already outside the
  app: browser history, the OS screenshot store, a recording in progress, a
  cached page in another tab, or the validator's own ciphertext rows. It is
  also one tap to leave, by anyone holding the unlocked device. It is a
  shoulder-surfing and screen-share control, not a duress control.
- **A-POST-UNIFIED-INDEX-LIVES-IN-ONE-PROCESS** — with the cross-persona view
  ON, one process holds every own persona's records in memory at once, which
  is exactly what the view is for. Entering compartment mode drops every
  scope's index, so the records leave memory — but a memory capture taken
  while the view was on still has them, and anything already rendered on
  screen is already out.
- **A-POST-ATTRIBUTION-IS-DEVICE-TRUTH** — "bookmarked as @fluffypanda69" is
  what THIS device recorded about its own action. Nothing on the network
  attests it, the validator is never asked, and a device that lost its vault
  loses the attribution with it. It is mental accounting for the owner, not
  evidence for anyone else.
- **A-POST-DELIVERY-IS-ATTENTION-NOT-ACCESS** — a tier decides where an
  account's posts appear for THIS viewer. It is not a block, not a mute with
  receipts, and not a disclosure control: a quiet account is deranked and still
  present, and "facet only" scopes to the facets the viewer already follows.
  Nothing about a tier reaches the account it is set on, and nothing about it
  changes what that account can see or do.
- **A-POST-FACET-ONLY-IS-THE-EXISTING-SCOPE** — "facet only" is the existing
  facet-follow presented as a tier, so it inherits that feature's properties
  exactly, including the fact that the scope is a CLUSTER of a root and not a
  per-post judgement. It is refused when no facet is followed, because a scope
  with nothing selected would silently mean "hide everything".
- **A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE** — the map is vault
  data, so the validator holds ciphertext under one opaque key and learns
  neither the accounts nor the tiers. It is still a behavioural record about the
  owner, kept because the feature cannot work without it; it travels with the
  vault, and a device that cannot read the vault delivers everything Normally
  rather than guessing.
- **A-POST-UNIFIED-AND-COMPARTMENT-ARE-NOT-SYMMETRIC** — the cross-persona
  view is a toggle over ONE surface (the search index and the browse view it
  feeds). Compartment mode is a hard scope over MANY: the search index, the
  account switcher, the act-as picker, the persona↔fid map, the relationship
  ports, the disclosure panel, the bindings matrix, the lens delta, a sibling's
  stake history and the tint routes. Turning the unified view off is not a
  compartment, and §17 previously described the two as if they were the same
  kind of control.
- **A-POST-TAMPERING-IS-CAUGHT-AT-THE-NEXT-COLD-READ** — every sealed module
  caches its decrypted document in the process. A record corrupted, deleted or
  replaced on the validator is therefore invisible to a process that has
  already read it, and is refused at the next COLD read — a restart, an
  identity reload, or a seed reset. The fail-closed guarantee is about what
  happens when the record is READ, not about continuous verification, and the
  Gate 2 suite exercises it by forgetting the decrypted documents first. A
  long-lived server can run for its whole life on a document the validator no
  longer holds.
- **A-POST-SEALED-LENGTH-LEAKS-A-MAGNITUDE** — the sealed records are padded to
  a 1 KiB step, so their ciphertext LENGTH reveals which step the plaintext is
  in. For `deliveryTiers` that is roughly "more than 21 non-normal settings,
  more than 43, more than 65…", and each step change is pinned to a single
  observable write. For `readwiseState` it is coarser and grows with the actual
  article text in the queue and the bin. The operator learns a magnitude, never
  a name; fixing it properly means a fixed-size record or a size-hiding
  scheme, which is a change to the vault format rather than to these features.
- **A-POST-A-PIN-FILE-IS-NOT-INTEGRITY** — `lib/vault/sealedPins.ts` records
  which namespaces this device has sealed, so that a namespace the operator
  DELETED is refused instead of read as "never written". It converts a silent
  wrong answer into a loud refusal. It does not protect the bytes: an operator
  who deletes a namespace still deletes it, and a device that cannot persist
  the pin file (an ephemeral in-tab device) degrades to the old behaviour for
  that namespace.
- **A-POST-THE-FIXTURE-FORK-IS-A-DEMO** — the fork route deliberately lets you
  fork from a persona you do not own, because the fixture demo forks a seeded
  ACCOUNT to show forward pointers and grant carry. Its SETTINGS are gated —
  `startFrom` refuses a source you do not own, so a stranger's rules, modes and
  folders cannot be copied onto your persona. Its TIER is NOT gated: the new
  persona inherits the source's standing, because "the new persona inherits the
  tier immediately" is a contract this product states and tests, and the review
  that raised this was closing a fixture-only exposure rather than a production
  one. Against real accounts the affordance would not exist at all; in the
  fixture it means forking a seeded account hands you that account's tier.
- **A-POST-THE-ACTING-COOKIE-IS-STILL-A-COOKIE** — `layers_seed_persona` names
  the persona to act as and is not itself authenticated. It is now honoured only
  for the seeded self, for personas this device's keystore minted, and for a
  persona a session ACCEPTED under the root handle that session presented — so
  it no longer carries to a browser that sends nothing else. It remains a
  cookie: anyone who can set cookies in the owner's own browser can still use it
  within that root, which is the same standing the seeded view-as cookie has had
  since the fixture was built.
- **A-POST-DWELL-IS-A-RECORD-OF-ATTENTION** — the dwell map is behavioural data
  about the owner, kept because the read/requeue mechanic cannot work without
  it. It is sealed and adapter-free, but it is not minimised: the accumulated
  milliseconds per chunk persist until the vault does. Anyone who can decrypt
  the vault can reconstruct what was read and roughly how carefully.
- **A-POST-READWISE-PROGRESS-CANNOT-BE-PER-PERSONA** — progress carries across
  personas because there is one reader per vault, which is the feature and also
  the limit. A device shared between two people, or a persona operated by
  someone else on the owner's device, shares reading progress with no way to
  separate it.
- **A-POST-THE-BIN-IS-NOT-A-DELETE** — a dismissed chunk is retained in full,
  with its text, until the owner acts. That is deliberate (a dismissal that is a
  void stops people dismissing), but it means "I got rid of that" leaves the
  content in the vault rather than removing it.

## 18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts

**Decision D-PRODLIVE-OWNER-SERVICE** (notes/runbooks/PREVIEW-READINESS.md, addendum; runbook `notes/runbooks/GO-LIVE-FARCASTER.md`). To give the
owner's personas real Farcaster accounts and real casts, a SEPARATE app + validator pair runs on Railway in rig shape
(`ZK_DEV_HOOKS=true`): the app holds the owner's root seed on a volume, derives each persona's custody and signer
keys, and posts through Neynar managed signers, as the rig laptop always has. It is the one named, scoped override of
**D-CUSTODY-ONE-RULE** and **D-CUSTODY-RIG-KEEPS-THE-DEV-KEYSTORE**. The public preview is unchanged: keyless,
multi-tenant, no live write; its boot contract now also refuses `DATA_SOURCE=neynar` (it checked only `live`, which
is not the value that arms live content).

**§8 applied to this topology.** §8 says every privacy statement assumes the process holding the seed is the user's.
Here the user is the owner, the seed-holding process is the owner's, and so is the validator: there is no third-party
operator for the label to be "hidden from". What changes is the HOST: the seed now sits on a platform's volume
instead of the owner's laptop. That is an assumption, not a guarantee (below). The privacy label's conditions (§4)
are not met on this deployment either; it is a live-posting tool for its owner, not a privacy demonstration.

**What the gate protects, and how.**

- Every page and every `/api/*` route answers only to a request with a LIVE owner session cookie (`middleware.ts`).
  Pages redirect to `/owner-login`; routes answer 401. Exempt, each by exact path: `/api/health`, the login page and
  route, the passkey sign-in's two routes (`POST /api/owner-login/passkey/options` and `.../passkey/verify`, metered
  like the passphrase), and the icon. `GET /api/owner-login/state` answers only a request carrying the internal
  token the middleware derives from the passphrase, over the server's own loopback: that is how the middleware, which
  has no file access, learns the volume's current session epoch and passkey list before it admits a cookie. The
  middleware runs on every path except the build's `/_next/static/` chunks and the `/_next/image` optimizer, both
  anchored. The first matcher excluded `favicon.ico` unescaped and unanchored, so `/favicon.ico/status/<hash>` skipped
  the gate and rendered the rig layout, owner roster included, to anyone. It is fixed and tested against Next's own
  matcher compiler. As defence in depth, the `(main)` layout, `/device` and `/help` verify the session themselves
  (`ownerSessionRefused` with the volume as its explicit state source: the same MAC, epoch and passkey checks) and
  redirect to the login page, so a future matcher mistake cannot put the roster, the tier map or the private
  validator address in a payload. Stated limit: the App Router renders a page in parallel with its layout, so what a
  PAGE computes server-side is still protected by the middleware alone.
- **The cookie (owner passkey build, D-OWNER-PASSKEYS).** It holds
  `v2.<issued>.<expiry>.<epoch>.<method>.<nonce>.<HMAC>` under a key derived from the passphrase
  (`lib/platform/owner-access.ts`); it is `__Host-` prefixed, httpOnly, Secure and SameSite=Strict. Page script cannot
  read it; a cross-site request never carries it, so the gate doubles as the service's CSRF defence; a login form
  posted from another origin is refused. A cookie is live only while all of these hold: its MAC verifies, it has not
  expired, it was not issued in the future or for longer than this deployment now allows, its epoch is the volume's
  CURRENT epoch, and, for a passkey session, that passkey is still registered under the current passphrase. The v1
  cookie (`v1.<expiry>.<nonce>.<HMAC>`, valid a day, no epoch) is gone: a v1 value is refused.
- **Lifetimes.** A browser sign-in (the form, or a passkey) lasts `OWNER_SESSION_DAYS` per device: default 30 days,
  capped at 90, a malformed value is the default. A script's sign-in (a JSON `POST /api/owner-login`, the owner scripts
  and `check-anon-live.mjs`) lasts at most 24 hours, in the cookie's own expiry and in its `Max-Age`, and the answer
  says so (`expiresInSeconds` 86400). "This isn't my device", offered beside "Add Face ID / fingerprint", mints a
  2-hour session in a cookie with no `Max-Age` (a browser-session cookie; Chrome and Edge can restore such cookies
  after a restart, so the server's 2-hour expiry is the real bound). Sessions are not renewed while in use: a renewal
  would reset the issue time and reopen the 30-minute add-a-passkey window to a stolen passphrase session.
- The passphrase is compared in constant time (both sides MACed under a fresh random key, digests XOR-compared).
  Attempts are metered before the route runs: 10 per address refilled one a minute, 30 across all addresses refilled
  one per ten seconds (at most ~360 guesses an hour against 32 random bytes), plus a 400 ms delay per failure. The
  two passkey routes are metered the same way.
- **Passkey sign-in (WebAuthn).** A discoverable credential with no `allowCredentials` (the route is open to
  strangers and must not reveal which credentials exist), user verification required, RP ID and origin exactly
  `APP_URL`'s host and origin (unset `APP_URL`: passkeys off, the passphrase still works), a server-stored single-use
  challenge with a 2-minute lifetime, the signature counter strictly increasing (0 to 0 allowed, for authenticators
  that keep none), the backup-eligible flag fixed at registration, backup-state implying backup-eligible, and the
  owner's user handle. After a passkey sign-in the browser is told the live passkey list (the WebAuthn Signal API), so a
  removed passkey disappears from the platform's picker. The passphrase field offers passkey autofill.
- **Registration.** "Add Face ID / fingerprint for this device" works only from a PASSPHRASE session at most 30
  minutes old (a passkey session cannot add another passkey; neither can a session that was signed out while the
  prompt was open); a platform authenticator; attestation `none` (the trust comes from the passphrase session; the SPKI
  key comes from `getPublicKey()`, per D-CU-2-NO-CBOR-NO-ATTESTATION, no CBOR parsed); credential ids shorter than 16
  bytes refused; at most 5 passkeys; names up to 40 code points. A successful registration signs the adding device in
  with the NEW passkey, so removing that passkey also ends that device's session. The "this device has a passkey" hint
  cookie is set only when the browser reports the passkey lives on the device (a phone used over the QR code sets
  none, so the laptop still gets the offer).
- **Storage.** `/data/owner-passkeys.json` beside `KEYSTORE_DIR` (`OWNER_PASSKEYS_FILE` overrides): the session epoch,
  the passphrase binding tag and the passkey records (credential id, SPKI key, counter, name, dates). No private key is
  in it. Every write is parsed back with the reader's own parser before it lands, and refused if it would not read
  back (nothing is written); each rename is followed by a best-effort fsync of the directory on Linux (an `EINVAL` is
  logged once, never reported as "nothing changed").
- **Revocation.** Settings › Security: "Sign out of this device" clears this device's cookie; "Remove" on a passkey
  ends every session made with it; "Lost this device?" removes that passkey AND draws a new session epoch in one
  write (so every device is signed out, even if the passkey was already removed); "Sign out everywhere" draws a new
  epoch. A new passphrase (`OWNER_ACCESS_SECRET` rotated) ends every session and retires every passkey: each passkey
  carries a 128-bit tag of the passphrase it was registered under, and the next passphrase sign-in prunes the rest. The
  24 words are never needed to sign in, and nothing here touches the root.
- The process cannot boot open: on a hosted platform a rig-shaped app exits 78 without a 16+ character
  `OWNER_ACCESS_SECRET`, with a public-looking `VALIDATOR_URL`, or with `NEXT_PUBLIC_VALIDATOR_URL` set; a dev-hooks
  validator exits 78 unless `LAYERS_PRIVATE_NETWORK_ONLY=true` and the platform reports no public domain or TCP proxy.
  The validator supervisor (`scripts/validator-supervisor.mjs`, which both validator images run) passes a child's
  exit 78 through and stops, where it used to restart it on a backoff forever, so a refused configuration ends the
  container, where the platform reports it, instead of hiding behind a supervisor that looks alive.

**Assumptions, by id.**

- **A-PRODLIVE-THE-HOST-HOLDS-THE-SEED** — the owner's root seed, device key and envelope counters live on a Railway
  volume. The platform operator, and anyone who compromises the owner's Railway account, can read them and act as
  every persona, including the live accounts. This is the trust the laptop rig placed in the laptop, moved to a host.
  The volume is not encrypted by this codebase.
- **A-PRODLIVE-THE-PASSPHRASE-IS-THE-ACCOUNT** — whoever holds the passphrase can post as every persona, reveal the
  24 words (`/api/recovery`), and use the rig's developer controls (`/api/dev`). So can anyone who can unlock a device
  that holds one of the owner's Face ID / fingerprint sign-ins, until it is removed (Settings › Security › Lost this
  device?). The passphrase and a registered passkey are ALTERNATIVES, not two factors: either one alone opens the
  account. What the passkey build changed: enrolment is per device (at most 5), a passkey is added only from a fresh
  passphrase session, and rotating the passphrase is still the whole-account revocation: every session ends and every
  passkey is retired (the binding tag), so the owner adds Face ID / fingerprint again afterwards.
- **A-PRODLIVE-THE-COOKIE-IS-A-BEARER-TOKEN** — for up to `OWNER_SESSION_DAYS` (30 by default, 90 at most) on a
  browser, 24 hours for a script, 2 hours for "This isn't my device". There is still no per-session list: a stolen
  cookie works until it expires, or until the volume's epoch moves ("Sign out everywhere", "Lost this device?", a new
  passphrase), or, for a passkey session, until that passkey is removed. A stolen PASSPHRASE session cannot be ended
  on its own: the only levers are the epoch and the passphrase, both of which end every session. Stated limits, by
  design: a refused passkey sign-in never clears a stale "this device has a passkey" hint, because that route is open
  to strangers and an answer that depended on the volume would let anyone test whether a passkey is still registered
  (the hint is cleared after a passphrase sign-in and after any successful passkey sign-in instead); and the
  directory fsync after a write is best effort, so on a filesystem that cannot fsync a directory a crash right after
  a revocation could undo it, exactly as before the build. Not yet exercised in a real browser on the deployed
  service: passkey autofill, the Signal API call and the native details fold were checked against a fake browser in
  node (46 checks, 20 mutations killed); the device words (Face ID versus Touch ID versus Windows Hello) are best-effort
  guesses from the user agent, with "Face ID / fingerprint" as the fallback.
- **A-PRODLIVE-THE-GATE-STATE-IS-A-FILE** — the session epoch and the passkey list live in `/data/owner-passkeys.json`
  on the app volume (A-PRODLIVE-THE-HOST-HOLDS-THE-SEED applies to it: whoever reads the volume reads the public keys
  and the epoch; whoever writes it can draw an epoch, which only ever signs the owner OUT). The middleware reads that
  state over the server's own loopback with a token derived from the passphrase; a state read that fails is no session
  (fail closed), so a broken volume locks the owner out rather than letting a cookie through unchecked.
- **A-PRODLIVE-LOGIN-LIMITS-ARE-PER-INSTANCE** — the buckets live in process memory, restart empty, and multiply with
  instances (the same shape as A-CU-4-RATE-LIMIT-PER-INSTANCE). The global bucket can be drained on purpose to lock the
  login out for minutes; issued sessions keep working. Per-address keying needs `TRUST_PROXY=true` behind the
  platform's edge (A-CU-5-TRUST-PROXY); the global bucket does not depend on it.
- **A-PRODLIVE-PRIVATE-NETWORK-IS-THE-VALIDATOR-GATE** — the owner validator runs with its dev routes open; its only
  protection is being unreachable. Anything else deployed into the same Railway project and environment can reach it
  over the private network, so the owner project must hold these two services and nothing else. The public-domain
  check runs at boot, so a domain attached to a running validator is invisible until its next deploy; the runbook's
  rule is "never attach one".
- **A-PRODLIVE-UNGATED-STATIC-ASSETS** — the build's static output (`/_next/static/` chunks and the `/_next/image`
  optimizer) and `/api/health` answer without a session: the app's code and the signed health payload (app name,
  commit, uptime) are visible to anyone who finds the URL. They carry no secret (the secrets audit covers the build),
  and the same code is already public on the preview. The health payload's `peer` field reads `private` on this
  service (`lib/health.ts`); it used to name the validator's `*.railway.internal` address. The image optimizer's
  upstream fetch of a local `?url=` goes back through the router, and so through the gate, with no cookie, so it
  cannot fetch a gated page or route. `favicon.ico` is no longer exempt: `app/favicon.ico` serves it as a static
  file, gated here like every other path.
- **A-PRODLIVE-NEYNAR-HOLDS-THE-SIGNERS** — every live write goes through a Neynar managed signer (§14): Neynar, and
  anyone with the API key, can write as each persona account. Self-custody of the signer key is the next pass.
- **A-PRODLIVE-THE-VOLUME-IS-THE-ONLY-COPY** — until the owner writes down the 24 words, the app volume is the only
  copy of the root that owns every persona account. The runbook makes that step come before the first account.
- **A-PRODLIVE-ONE-HOME-PER-ROOT** — the laptop's root and the owner service's root are different roots. A persona
  account created from one can only be driven from it; moving the phrase moves keys, not the sealed records (the
  roster and the account records live in the vault on that device's own validator).
- **A-PRODLIVE-CAPS-NEED-TWO-HANDS** — raising the account and spend caps takes the same override on the app and in
  the acquisition command's shell, each clamped to 20 accounts / $25; a value that does not parse keeps the default.
  The per-account ledger estimate can be raised but never set below the measured $0.90.
- **A-PRODLIVE-THE-POLLER-SPENDS** — closed by `VALIDATOR_POLLER=off`. A Neynar key on the validator (needed only for
  the anon relay) also starts the reputation poller, which reads the fixture world's one real-range account every
  minute: up to ~4.4M credits a month. `validator/poller.js` now keeps the poller off when `VALIDATOR_POLLER=off` is
  set, whatever key is present, and logs that it did. The runbook sets it on owner-validator in the same block as the
  key (`notes/runbooks/GO-LIVE-FARCASTER.md` §(f)). What is still assumed: that it stays set. Deleting it and redeploying brings the
  cost back.
- **A-PRODLIVE-CONFIG-IS-VARIABLES** — Railway no longer lets new services adopt config-as-code files, so the owner
  services are defined by two Dockerfiles (`railway/Dockerfile.owner-app`, `railway/Dockerfile.owner-validator`,
  chosen with `RAILWAY_DOCKERFILE_PATH`), variables and volumes. A setting changed in the dashboard is not in the repo.

## 19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs

**What changed.** A public deployment can now show real Farcaster casts, read-only. They come through ONE server
route, `POST /api/fc/read`, whose upstream module `lib/fc/readRelay.server.ts` is the only code in the repository that
reads `NEYNAR_READ_API_KEY`. In the browser device this is a THIRD content source, "relay", beside seed and neynar:
`isLiveContent()` is still true only for `DATA_SOURCE=neynar`, so the laptop rig, the owner service (§18) and every
global write guard keep exactly the meaning they had. The relay arms only when the process is a public deployment
(production without the dev hooks), or for tests with `FC_READ_RIG=stub` and a loopback `NEYNAR_READ_BASE_URL`; it is
dormant on the rig and on the owner service, both of which hold the owner's write key. Deploying without the key
changes no read: the relay reports `no_key`, `/api/feed` and `/api/feed2` report `liveSource.source: "seed"`, and only
the labels are new. What reads through the relay: the discovery timeline (home For You, classic For You and Explore
share one cached call: a general feed of the authors the operator chose, not of channels; the operator chooses them
from exactly one of two sources, a list of fids or the accounts a "house" Farcaster account follows,
D-FCREAD-HOUSE-ACCOUNT), and profile and thread pages for Farcaster usernames and hashes the device does not already
hold. What never does: Following,
notifications, history, search, channel tabs (preview content, D-FCREAD-NO-CHANNELS-IN-V1), the right rail, and
everything the server renders.

**The relay, as a contract.**

- Five operations, a closed table: `status` (no upstream call); `discovery` (ONE upstream call from the ONE configured
  source, `with_recasts=false`, `limit=25`, no cursor: in list mode a `/feed/` call with
  `feed_type=filter&filter_type=fids` over the server-held author list `FC_READ_FIDS`, 1 to 100 fids; in house mode a
  `/feed/following/` call for the server-held house account `FC_READ_HOUSE_FID`, one fid); `thread` (`0x` + 40
  lowercase hex; one `/cast/conversation` call,
  which already carries the root cast); `user` and `user-casts` (a Farcaster username; the fid for the casts call is
  resolved on the server from the cached username lookup). There is no `channel` operation
  (D-FCREAD-NO-CHANNELS-IN-V1): a request naming one is `bad_op`, and no channel id reaches the relay. Upstream calls
  are GET, `no-store` (so the framework's fetch cache cannot keep them outside the budget), one in flight per key,
  with parameters the relay fixes: the client never supplies an fid, a `viewer_fid`, a cursor, a provider or a limit,
  `/notifications` is never called, and no following feed is called but the house account's one pinned request. That
  rule is checked against each upstream path and its parameter NAMES when the call is built, before any token or
  credit is taken, never against an argument's value: a Farcaster user called `cursor`, `following` or
  `notifications` is looked up like anyone else. Discovery shares the `/feed/` pathname with the following feed (which
  is what an absent `feed_type` means upstream), so for that path the check also requires and pins the VALUES
  `feed_type=filter`, `filter_type=fids` and `with_recasts=false`, as it pins `limit`: no table entry can send
  `feed_type=following` down it, in either mode. The refusal of following-feed paths stays in force for every shape
  but one (D-FCREAD-HOUSE-ACCOUNT): in house mode the check admits exactly `/feed/following/` with `fid` pinned to the
  server's `FC_READ_HOUSE_FID`, `with_recasts=false` and `limit=25`, all three required and nothing else; another
  fid, a `viewer_fid`, a cursor, or any following path in list mode is refused before any token or credit is taken.
- Answers carry casts and users already mapped by the pure mapper through a field allowlist, never raw Neynar JSON, so
  no upstream metadata passes through and an answer weighs a fraction of the ~180 KB of a raw 25-cast page.
- Refusals are fixed codes, and the device treats every one as final, never retried: 503 `fc_read_off`,
  `fc_read_budget`, `fc_read_unarmed` or `fc_read_upstream` (the provider did not answer, or a failure cooldown holds);
  429 `fc_read_rate` with `Retry-After` (a rate bucket, or one address's daily lookup share, until UTC midnight); 400
  `bad_op`; 404 `not_found` (negative-cached). An upstream error's text is never echoed or logged. A thread or profile
  page whose read was refused shows a paused line with the refusal's fixed sentence and a Retry, never an error block.
- The route requires the header `x-layers-relay: 1` and refuses `Sec-Fetch-Site: cross-site`. A custom header makes a
  browser send a CORS preflight the route never approves, so another website's own page cannot call the relay with an
  image, a form or a no-cors fetch. Every document the app serves answers `Content-Security-Policy: frame-ancestors
  'none'` and `X-Frame-Options: DENY`, so another website cannot frame a preview page to make the preview do the
  lookups for it, and a device that finds itself inside a frame anyway makes no lookup at all. Top-level visits are
  not closed (A-FCREAD-BUDGET-DOS). The relay call carries its handle or hash in the POST body, not the URL; the PAGE
  a visitor opens does not — `/<fname>` and `/<fname>/status/<hash>` are request paths the platform logs
  (A-FCREAD-OPERATOR-SEES-READS).
- How a miss is paid for. A miss is charged once, before its first attempt; its two retries are not charged again.
  A failed miss (429, 5xx, a network error or a timeout through every attempt) puts its key on a 45-second cooldown,
  and five failed misses in a row open a 60-second breaker for every key; while either holds, the answer is the
  discovery shelf or `fc_read_upstream`, with no upstream call and no charge. Lookups (`thread`, `user`,
  `user-casts`) may spend at most 70% of the day, so they can never starve discovery, and one address at most 5% of
  the day. Each lookup request, hit or miss, takes a token from its address's bucket before the cache is consulted,
  and a refused lookup is never answered from the stale shelf (A-FCREAD-SHARED-CACHE-OBSERVABLE). Negative answers
  live in their own bounded map and can never evict a cached answer; the discovery answer is kept outside the
  evictable cache, so its 24-hour shelf survives any amount of lookup traffic.
- `status` answers `{armed, reason, state}`, the reason one of `armed`, `no_key`, `bad_key`, `off`, `not_public`,
  `bad_base_url`, `bad_config` (a discovery source that is not exactly one of `FC_READ_FIDS` and `FC_READ_HOUSE_FID` —
  both set, neither set, a list that is not 1 to 100 fids, a house fid that is not one positive integer — or a budget,
  score floor or denylist that does not parse; the server's `[fc-read]` log line names the variable, never its value),
  and never a budget number, any part of the key, which discovery source is configured, or any fid. A
  misconfiguration — a key that is not one key-shaped line, `FC_READ=off`, a base-URL override on a hosted platform
  or off loopback, a discovery source that breaks the one-source rule — DISARMS the relay with that named reason; it
  never exits the process. The public app has no healthcheck path, so a refused boot there would likely take the
  whole preview down rather than fail one rollout (PLAUSIBLE, not tested); exit 78 stays reserved for the
  must-not-ship names.
- A content floor, because the preview now shows arbitrary Farcaster text under its own name: discovery reads only the
  authors the operator chose (the `FC_READ_FIDS` list, or the accounts the house account follows), only their own
  top-level casts (no recasts are asked for, and any cast with a parent is dropped on the server, since whether either
  feed returns replies is unverified), and an author whose Neynar user score in the payload is below
  `FC_READ_MIN_SCORE` (default 0.5), or who carries no score, is hidden. The operator denylist (`FC_READ_DENY`) still
  applies on top, in both modes.

**What a visitor is told.** The landing page says that live Farcaster posts, when shown, are fetched through the
preview's server, and what that server then sees. The in-app banner appends that Farcaster reads are relayed through
the preview's server whenever the device runs in relay mode; it is a disclosure next to the computed label, not a new
label condition — the device's verdict (§4) is unchanged by this pass, and the label on this deployment is DEMO either
way. Every network card, the root post of a network thread and a network profile's header carry a small visible
"Farcaster · read-only" marker, so a real Farcaster post says so wherever it is met, not only under a timeline's
chip. The chip on a relayed timeline reads "Live from Farcaster · read-only", "Showing cached Farcaster posts" when
stale and "Live Farcaster posts paused — showing preview content" when off or out of budget; a thread or profile page
whose content came through the relay carries the same chip, live or cached. A mode that hides accounts it cannot rate
(an `author.*` hide rule such as Event Safe Space's tier rule: every network author is an unrated stranger to it)
shows the preview's own posts under "This mode hides accounts it can't rate — showing preview posts", rather than an
empty timeline under a live label.

**Decisions, by id.**

- **D-FCREAD-KEY-SERVER-ONLY** — The read key lives in the public app server's environment, as a service variable on
  `app` (never a shared variable; the validator's boot refuses the name), and exactly one server-only module reads it.
  The route that imports it is on the device's server-only route list, so the browser bundle never contains it. The
  device receives a mode hint (`FC_READ_RELAY: "on"`), computed per request while the relay is armed, never the key.
  The key is trimmed and shape-checked when the relay arms: on Node 24 a header value with an interior line break
  makes `fetch` throw an error whose message quotes the value, so a key pasted with a stray newline would otherwise
  write itself into a log or a response. Why the server at all: Neynar cannot scope a key (no read-only key, no origin
  or address restriction) and answers every origin, so a key that reaches any browser works from anywhere. *Costs:*
  the app server holds a second secret (§16, amended); every live read passes the operator
  (A-FCREAD-OPERATOR-SEES-READS); the operator pays for every read.
- **D-FCREAD-SERVER-STAYS-SEED** — Everything the server renders stays seed: the right rail, a profile page's
  metadata, the explore page's server render. The server's own `DATA_SOURCE` stays seed (the boot contract still
  refuses `neynar` and `NEYNAR_API_KEY`), and the server-side content adapter never reads the read key. Why: page
  renders are not rate-limited (the limiter meters `/api/*` only), so one live read inside a render would be an
  unmetered spend path that any GET of `/<anyhandle>` could trigger. *Costs:* a live profile's page title and the right
  rail show preview content beside live content, and Following, notifications, history and search stay preview
  content.
- **D-FCREAD-PER-TARGET-WRITE-REFUSAL** — Writes are refused per TARGET, not by the global switch. A network cast is a
  hash of the form `0x` + 40 lowercase hex that is in no local store (seed, fixture, the device's `0xlocal` posts,
  private posts, the anon list); no seed or fixture hash has that form. A like, recast, reply, quote, act-as, a follow
  of its live author, a folder add, a stake or a send that targets one answers 403 `NETWORK_READ_ONLY` with one fixed
  sentence ("Posting to Farcaster isn't on this preview yet. Reading is live; your own posts, folders and private
  posts still work."), and the card reverts its optimistic state instead of pretending. The bindable extras that
  would carry a network hash into another page's path — marking a refutation, concurring with a note, a custom-rule
  trigger — are disabled on network casts with the same sentence (A-FCREAD-OPERATOR-SEES-READS). Local and seed
  actions are unchanged. Why not flip the device to `DATA_SOURCE=neynar`: the global guard would refuse the visitor's
  own posts, the Following tab would become a network feed, and the feed would drop its Layers cards. Why not a separate
  flag with no refusal: a like on a network cast would be recorded locally and look as if it had worked. *Costs:*
  Layers' own overlays (folders, stakes) do not reach real Farcaster posts on the preview; refusing stakes is a
  product decision still to confirm.
- **D-FCREAD-FOLLOWING-STAYS-LOCAL** — Following is the visitor's own world. The relay never reads a VISITOR's
  following feed or any endpoint bound to a visitor's fid, and the device's own fid is never sent: it is derived from
  the root's anchor and registered in the validator's roots table (A-CU-5-PSEUDO-FID-IS-32-BITS-OF-THE-ANCHOR), so
  forwarding it would let the operator join reads to a root. A `viewer_fid` is refused outright, not stripped. The
  `fids` the discovery call carries are the operator's author list, and the one following feed the relay may read is
  the house account's (D-FCREAD-HOUSE-ACCOUNT): both are server constants, the same for every visitor, never a
  viewer's, and neither ever travels as a `viewer_fid`. For the same reason the public
  boot contract refuses `NEYNAR_VIEWER_FID` whatever its value: on a process strangers reach, it would show them that
  account's following feed, mutes and notifications. (On the owner service it is legitimate and behind the gate, §18.
  The fixture world's fid 9152 is the real @warpcast account the seed borrowed, not the owner.) *Costs:* no "your
  Farcaster following" on the preview; on the discovery surface, followed-only lenses exclude network casts and no
  lens reorders them.
- **D-FCREAD-NO-CHANNELS-IN-V1** — Channels are not an emphasis in v1: discovery is a general feed; there is no
  per-channel live read. (The owner's decision, 2026-09-25.) Discovery is ONE call, in list mode
  `GET /v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25`, over a
  server-held list of 1 to 100 author fids (in house mode, the house account's following feed:
  D-FCREAD-HOUSE-ACCOUNT); no cursor is followed. There is no `channel` operation, and a channel tab,
  wherever the interface shows one, stays seed or fixture content, exactly as a tab outside the old allowlist did.
  Why this endpoint: Neynar's published contract has no general ranked feed left. OAS spec v3.182.0 (2026-08-04)
  dropped `/feed/for_you`, and v3.183.0 (2026-08-07) dropped `/feed/trending` and the `global_trending` filter, with
  nothing added in their place; a keyless probe of `/feed/trending` on 2026-09-25 answered 401, the same as a made-up
  route. `/feed/` with the fids filter is the one in-contract feed that is neither per-viewer nor channel-based and
  whose quality can be controlled (apart from a following feed pinned to one account the operator controls, the
  second source, D-FCREAD-HOUSE-ACCOUNT); the only uncurated one left (`filter_type=embed_types`) is a firehose whose bot
  authors the score floor cannot hold back (Neynar's score documentation notes that some bots score high). And the
  channel endpoint's `members_only` flag is itself marked deprecated. The fids feed returns the same `FeedResponse` as
  the recorded following feed (`fixtures/neynar/feed-following.json`: 25 casts, all 25 authors scored, no replies),
  with the author score already in the payload, and it needs no `viewer_fid`. *Costs:* this is curation by AUTHOR, not
  by channel and not by the network's ranking: discovery shows what the chosen accounts post and nothing from anyone
  else, and whoever sets the source (edits `FC_READ_FIDS`, or controls the house account) decides whose posts the
  preview shows under its own name. Whether the fids filter returns replies is unverified, so the relay drops any
  cast with a parent on the server. A quiet or low-score list can leave fewer than 25 cards. The first real arming
  counts the casts that survive, and if fewer than about 20 do, the page size rises to 40 to 50 (160 to 200 credits a
  miss, at most 28,800 a day, still inside discovery's 30% share of the default budget); it does not start following
  a cursor. Channel tabs show preview content next to a live For You.
- **D-FCREAD-HOUSE-ACCOUNT** — Discovery has TWO possible sources, and exactly one is configured. List mode:
  `FC_READ_FIDS`, 1 to 100 author fids, the `/feed/` fids filter above; the owner edits the list, and a change takes a
  variable set and a redeploy. House mode: `FC_READ_HOUSE_FID`, one positive integer fid of a "house" Farcaster
  account whose FOLLOWS are the curation list; discovery is that account's following feed, `GET
  /v2/farcaster/feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25` (in Neynar's spec v3.184.0,
  unchanged by the August removals; `limit` at most 100; "4 × page limit" on Neynar's price table, so 100 credits a
  miss, the same as list mode), and the owner curates by following and unfollowing from that account in any Farcaster
  client, with no redeploy and no 100-account cap. The one-source rule is enforced when the relay arms: both variables
  set, neither set (a blank value counts as unset), or a malformed value leaves the relay unarmed with `bad_config`,
  and the log names the variable, never its value; the relay never picks a source for the operator. House mode changes
  nothing else: the same single page and no cursor, the same reply drop, score floor and denylist, the same cache
  lifetime and cost accounting (4 × limit credits a miss, charged once), and `status` does not say which mode is
  configured. The house fid is a server constant: the path check pins `fid` to it (the configured value, handed to
  the check from the armed configuration rather than read off the path being checked), no client value can reach it, it is
  never sent as a `viewer_fid` (so that account's mutes and blocks are not relied on: unfollowing is how the owner
  removes someone, and `FC_READ_DENY` is how the operator blocks a post or an author outright), and the only following
  feed the relay can reach is this one request (the contract above). It is not `NEYNAR_VIEWER_FID`, which stays
  refused on the public app: that variable makes the rig's adapter read an account's feed AS that account, with its
  mutes, its `viewer_context` and its notifications; the house fid names one public curation list and nothing else.
  Why a house account (the assistant's recommendation; the owner chooses): the owner curates with the tool every
  Farcaster user already has, a change shows within about a quarter of an hour (the relay's 600-second discovery
  lifetime plus a tab's own two minutes, once Neynar has indexed the follow) without a redeploy, which also means no
  day's budget is reset, and the list can grow past 100 (bounded by the account's Farcaster storage for follows, not
  by the relay). *Costs:* the house account's follow list is public on Farcaster by nature, so anyone can read exactly
  whose posts the preview shows; a list in `FC_READ_FIDS` is visible too, author by author, on every card, but not as
  one published list tied to a name. Whoever controls that account (its custody key, its recovery address, or any app
  it has granted a signer, such as the Farcaster client used to follow) curates the preview's public discovery
  timeline, with no redeploy and nothing in the relay's log; the score floor, the denylist and the reply drop still
  apply to whatever it follows. Losing control of the account means losing curation, not keys: the relay holds no key
  or signer for it, the READ key is unrelated, and nothing of Layers' custody is involved; the remedy is
  `FC_READ=off`, or switching to list mode or to a new house account (one variable, one redeploy). A dedicated
  account, signed into as few Farcaster apps as possible (each holds a signer that can change its follows), is the
  sound choice: a personal account's follows would put the owner's own social graph on the preview, and a persona's
  would tie the curation list to that persona. Whether the house account's own casts appear in its following feed is
  unverified; a house account that does not post makes the question moot.

**Assumptions, by id.**

- **A-FCREAD-OPERATOR-SEES-READS** — The device answers the app's own API in the visitor's page (§16, Gate 6), but the
  relay is a server route: every relayed read reaches the app server, which sees the address, the time and the
  operation with its argument (which thread, which profile; discovery carries none). The platform's HTTP log sees more
  than the relay call. The call itself is `POST /api/fc/read` with its argument in the body; but opening a live
  profile or thread is a page request — `/<fname>` or `/<fname>/status/<hash>`, as a full load or as the client-side
  navigation's server request, both rendered on demand — and the platform's HTTP log records that path next to the
  address for every live profile and thread a visitor opens. So the operator can read, from the platform's log alone,
  which real Farcaster accounts and casts each address looked at. The same operator runs the validator, so reads can
  be joined to a root's signed traffic by address and time. Mitigations: `credentials: "omit"`, no referrer, no device
  header on the relay call, counts-only logging in the app, a shared cache (a hit spends nothing upstream, but it
  still reaches the app), and the extras that would put a network hash into yet another page's path (refute, note, a
  custom-rule trigger) disabled on network casts. Moving live permalinks to an identifier-free path (the identifier
  only in the page's fragment, read by the island) would keep it out of that log; this pass did not. Neynar sees the
  app's aggregate cache misses, never a visitor's address. *Cost:* a new class of metadata about visitors — which real
  accounts and casts each address opened — disclosed on the landing page and in the banner; it is the price of showing
  live posts without handing the key to browsers.
- **A-FCREAD-SHARED-CACHE-OBSERVABLE** — The relay's cache is shared by every visitor, so an answer can say whether
  someone else asked for the same key recently: a fresh hit comes back without an upstream call's latency. A visitor
  who opens a given profile or thread can tell, from timing alone, that some other visitor opened it within its fresh
  lifetime (15 minutes for a thread, 30 for a profile, an hour for a not-found). What the review closed: a refused
  lookup is never answered from the stale shelf, so a rate or budget refusal reads the same whether or not the key is
  cached; and every lookup request, hit or miss, takes a token from the asking address's bucket (20 per 10 minutes)
  before the cache is consulted, so probing costs the prober exactly what reading does. What remains is the timing of
  an answered lookup, bounded by those tokens, which are per address only as far as the forwarding header is honest
  (A-FCREAD-FORWARDING-HEADER). *Cost:* visitors are not hidden from other visitors at the grain of "someone opened
  this, recently"; the relay never says who, and the discovery answer, identical for everyone, reveals nothing.
- **A-FCREAD-THIRD-PARTY-MEDIA** — A live cast's avatar and image embeds load from hosts its author chose, so any
  Farcaster user can plant an image that tells its host which addresses viewed the cast, and when. The preview's only
  content security policy is `frame-ancestors 'none'`; nothing limits image hosts (A-CU-6-NO-CSP-YET). What this pass
  specifies for live cards: `referrerPolicy="no-referrer"`, lazy loading, and click-to-load for hosts outside a fixed
  allowlist. The seed already loads a few fixed third-party image hosts; author-chosen hosts are the new class.
  *Cost:* an allowlisted host still sees each viewer's address, and any live image rendered without those attributes
  is a leak to a host an author picked.
- **A-FCREAD-KEY-IS-UNSCOPED** — A Neynar key has no scopes. The READ key belongs to a second Neynar app with no
  signers, no App Wallet, no webhooks and no bans, so a leaked key cannot post as any persona (managed signers are
  paired with the key that made them) or register an account (that needs the app's wallet id). It can still read,
  create and sponsor signers of its own on the account's credits, create webhooks, ban fids from the read app's
  feeds, and burn credits fast: at the Free plan's 1,000 requests a minute across all endpoints, the 2,000-credit hub
  calls empty 10M credits in about five minutes. The relay's budget limits only the relay. *Cost:* the only kill switch
  for a LEAKED key is rotating or deleting it at dev.neynar.com; `FC_READ=off` stops our use, not theirs.
- **A-FCREAD-CREDITS-POOLED** — Assumed from the plan text ("10M credits/month … 5 apps"): one credit pool and one set
  of per-endpoint rate limits per Neynar account, shared by every app in it. Public reads therefore draw on the same
  pool as the owner's writes (about 195k credits a month for three personas), any live testing on the laptop rig, and
  the validator poller if it were ever left on (up to ~4.4M a month; `VALIDATOR_POLLER=off`). What happens at zero
  credits — requests refused, or overage billed — is undocumented; the docs say only that going over credits does not
  trigger rate limits. The owner confirms both on the usage and billing pages before arming (notes/runbooks/GO-LIVE-FARCASTER.md
  §(i)). *Cost:* a read spike can starve the owner's posting; the daily budget is sized to leave room
  (C-FCREAD-NEYNAR-CREDITS), and real isolation would take a separate Neynar account.
- **A-FCREAD-BUDGET-PER-INSTANCE** — The daily credit budget is counted per UTC day, in process memory, per instance
  (the shape of A-CU-4-RATE-LIMIT-PER-INSTANCE). It restarts empty on every restart and every redeploy — including
  every `railway variable set` that does not pass `--skip-deploys` — and it multiplies with instances. Credits are
  counted on cache misses from a per-operation price table: documented prices for the feed and cast endpoints, assumed
  prices for the three endpoints the relay calls that Neynar's table does not list (`/cast/conversation`,
  `/feed/user/casts`, `/user/by_username`), until one measured run. *Cost:* the real daily ceiling
  is the budget × (redeploys that day + 1) × instances; the runbook keeps it to one redeploy per change.
- **A-FCREAD-BUDGET-DOS** — Anyone can spend the day's lookup budget on purpose. Random hashes and usernames are
  guaranteed cache misses, so the negative cache does not help. The per-address bucket (20 lookup requests, hits
  included, per 10 minutes) and the per-address daily share (5% of the day) are best-effort
  (A-FCREAD-FORWARDING-HEADER). The global miss bucket (60 a minute) does not depend on the address and bounds the
  RATE, not the total: at roughly 40 credits a thread miss, visitors with many addresses (or one that can choose its
  forwarding header) empty the 70,000-credit lookup share of a 100,000-credit day in about half an hour. The lookup
  share is a ceiling, so the discovery timeline keeps the rest of the day and stays live. What is closed: another
  website's own page cannot call the relay (the custom header forces a preflight that is never approved, and
  `Sec-Fetch-Site: cross-site` is refused), and it cannot FRAME a preview page to make the preview do the lookups:
  every document answers `frame-ancestors 'none'` and `X-Frame-Options: DENY`, and a device inside a frame makes no
  lookup. What is NOT closed: another site can still send its visitors to preview pages top level — a link, a
  redirect, a popup — and each of those is the preview's own page looking up the hash or name in its path, from that
  visitor's address. That amplifier is bounded only by the global miss bucket, the 70% lookup share and the
  per-address daily share. A crawler that runs JavaScript spends like any visitor and counts against the same budget.
  When the budget is spent the discovery timeline serves what the relay already holds, labelled as cached, or the
  preview shows its own content under "Live Farcaster posts paused"; a thread or profile page shows a paused line.
  *Cost:* live profile and thread pages can be denied to every visitor for the rest of the UTC day; nothing else on
  the preview is affected, and the relay spends no credit beyond the budget.
- **A-FCREAD-FORWARDING-HEADER** — Per-address limits key on the leftmost `X-Forwarded-For` entry under
  `TRUST_PROXY=true` (`middleware.ts`; the validator's caps do the same). The app's limiter and the relay normalise it
  first: an IPv6 address counts as its /64, an IPv4-mapped one as the plain IPv4, anything unparseable as one shared
  bucket, so rotating addresses inside one IPv6 prefix buys no fresh buckets. Railway's staff answers conflict on
  whether its edge appends to a header the client sent (then the leftmost entry is the client's choice), sets it, or
  strips it, and its documentation says nothing; it has not been measured on this deployment. *Cost:* until a
  header-echo measurement, a client may choose its own bucket, so every per-address limit — the relay's per-address
  bucket and daily lookup share, and the existing per-address caps (§16, amended) — is best-effort; the global
  buckets, the lookup share and the daily budget are what bound spend.

**Costs, by id.**

- **C-FCREAD-NEYNAR-CREDITS** — Credits are spent on cache misses only, at these prices (documented = Neynar's price
  table; assumed = not listed there, priced like the feed family until the first measured run):

  | operation | upstream call | credits per miss | cache lifetime | most it can cost a day |
  |---|---|---|---|---|
  | `discovery`, list mode | `/feed/`, `feed_type=filter&filter_type=fids`, `FC_READ_FIDS` (1 to 100 author fids), no recasts, limit 25, one page | 100 (documented, 4 × limit) | 600 s | 14,400 |
  | `discovery`, house mode | `/feed/following/`, `fid` = `FC_READ_HOUSE_FID` (the house account; whoever it follows), no recasts, limit 25, one page | 100 (documented, 4 × limit) | 600 s | 14,400 |
  | a channel tab | none: no relay call, preview content (D-FCREAD-NO-CHANNELS-IN-V1) | 0 | — | 0 |
  | `thread` | `/cast/conversation`, reply depth 2, limit 10 | ~40 (assumed, 4 × limit) | 900 s | visitor-driven |
  | `user` | `/user/by_username` | ~2 (assumed) | 1,800 s | visitor-driven |
  | `user-casts` | `/feed/user/casts`, limit 10 | ~40 (assumed, 4 × limit) | 1,800 s | visitor-driven |
  | an unknown hash or name | the miss that found it | — | 3,600 s (negative) | — |
  | `status` | none | 0 | — | 0 |

  Discovery is the only fixed key, and it costs one miss per 600 s at most: 86,400 / 600 = 144 misses × 100 = 14,400
  credits a day, whatever the length of the author list or the number of accounts the house account follows, and the
  same in either mode (the price is 4 × the page limit, not per fid; only one source is ever configured). If the first
  real arming finds fewer than about 20 of 25 casts surviving the score floor, the denylist and the reply drop, the
  page size rises to 40 to 50 rather than following a cursor: 160 to 200 credits a miss, at most 23,040 to 28,800 a
  day, still inside the 30% of the default budget that lookups cannot take. Lookups — `thread`, `user`,
  `user-casts` — may spend at most 70% of the day (70,000 of the default 100,000), so they can never starve
  discovery; one address may spend at most 5% of the day on lookups (5,000 credits, about 125 thread misses; never
  less than one thread miss, so the 2,000-credit smoke budget can still read one of each), and past that it is refused
  429 `fc_read_rate` until UTC midnight. A miss is charged once, before its first attempt, not once per retry. A
  failed miss puts its key on a 45-second cooldown and five failures in a row open a 60-second breaker for every key,
  during which nothing is called and nothing is charged: a Neynar outage costs a handful of charged misses, not the
  day. 100,000 a day is about 3M a month, 30% of the Free plan's 10M. Past the budget, the discovery answer's stale
  shelf of at most 24 hours is served, labelled; lookups have no shelf. The first arming runs under a 2,000-credit
  budget, which also measures the three assumed prices and counts the discovery casts that survive; the budget rises
  only after a week of usage-page numbers.
  Platform egress stays small because answers are mapped payloads, not raw Neynar JSON.

**What must be measured before the claims above count as verified.** Against a loopback stub that records exact
query strings, enforces the documented maxima, accepts only GET and fails on `/notifications` — never against the real
API — each check asserting its own precondition first (a live card must have rendered before a refusal on it means
anything): with no key, the status is `no_key`, the stub sees no call and seed cards render; with the stub, network
cards render and no page request goes to Neynar or to the stub's origin; the stub's fake key appears nowhere in page
HTML, the RSC payload, the device bundle, relay answers or the app log; the stub saw no `viewer_fid` or cursor, and no
fid but the server's own (the `user-casts` fid it resolved, and in house mode the house fid);
a second browser profile gets the same discovery cards with the stub's hit count unchanged; a like on a live card
answers 403 with the sentence and restores the count while a like on a seed card still succeeds; a post round-trips
on Following with the relay on; a 1-credit budget gives `fc_read_budget` (not `no_key`) with hits frozen;
`FC_READ=off` gives `fc_read_off`; a request without the header, or marked cross-site, is refused with hits frozen;
server-rendered pages cause no stub hit; a random hash is negative-cached. After the review, also
(`scripts/accept-fcread.mjs`): every document carries both framing headers and a preview page framed by another site
is blocked, and with those headers stripped a framed page's device still makes no lookup while the same page opened
top level does; every live card, a live thread's root and a live profile's header show the "Farcaster · read-only"
marker, and a fixture profile shows none; a live thread and profile carry the chip, live, and stale when the answer
is; a thread or profile refused for the budget shows the paused line with a Retry, not an error block; Event Safe
Space shows preview posts under the "filtered" chip, never an empty live timeline; refute, note and custom-rule are
disabled on a live card; the discovery call carries `feed_type=filter`, `filter_type=fids`, the configured fids,
`with_recasts=false` and `limit=25` and nothing else, a cast with a parent in its answer never reaches a card, an
configuring neither source, or both (`FC_READ_FIDS` and `FC_READ_HOUSE_FID`), leaves the relay `bad_config` with no stub call (a malformed value is covered by the relay's unit harness, `npm run test:fcread-unit`), a channel tab makes no relay call
and a request for op `channel` is `bad_op` with no stub call; and users named `cursor`,
`following` and `notifications` are looked up once each. For the house source (D-FCREAD-HOUSE-ACCOUNT), also: in
house mode the discovery call is `/feed/following/` carrying exactly `fid` = the configured house fid,
`with_recasts=false` and `limit=25` and nothing else, and a cast with a parent in its answer never reaches a card
(check 24); both variables set, neither set, and a malformed `FC_READ_HOUSE_FID` (zero, a leading zero, a list, a
non-integer) each leave the relay `bad_config` with no stub call (checks 24c and 24d on side apps; the full malformed
matrix, fourteen values, in-process in check 25); the path check itself, called directly because the relay only ever
builds the one correct path and no end-to-end check can see a refusal (check 25, `scripts/unit-fcread-relay.mjs`),
refuses every other following shape — another fid or a leading-zero spelling of the house fid, an added `viewer_fid`
or cursor, a missing trailing slash or an added suffix, `/feed/?feed_type=following`, the house path for any
operation but discovery, and any following path at all in list mode; and the status body is exactly `{armed, reason,
state}` and identical in both modes (checks 19 and 25). In either source, a cast dated more than 10 minutes ahead of
the server's clock (the network carries some, dated decades ahead, and the device orders the feed by recency) never
reaches the discovery answer, a card or its author's profile, and as a thread it answers `not_found` (checks 5d, 15c
and 24; 5d reads the profile, after showing the stub's answer carried the cast). Still to measure on the deployment
itself, before per-address limits or the assumed prices are relied on: a header echo on Railway (and whether its
edge takes IPv6, whose addresses the limits now group by /64), and one real read run under the 2,000-credit budget,
which in house mode also shows whether the following feed returns replies or the house account's own casts.

## 20. The anon account on the owner service: an unnamed extra account, not a crowd

**Decision D-ANON-OWNER-SERVICE-UNNAMED-ACCOUNT** (runbook `notes/runbooks/GO-LIVE-FARCASTER.md` §(f); the one command is
`scripts/owner/arm-anon.ps1`). The anon relay of §14 (D-FID-4, D-FID-5-STORE-AND-FORWARD) may be armed on the owner
service (§18), and when it is, the product, the runbook and the docs call the anon account what it is there: **an
extra Farcaster account with no name on it.** Not a crowd. The owner service's live universe holds one root, so the
membership proof an anon post carries proves membership of a set of size one; the client floor is set to 1 on purpose
(`ZK_ANON_FLOOR=1`: the default of 50 would refuse forever, and seeding decoys through the dev hook would be cosmetic,
since a decoy's secret is public), and the computed label (§4) therefore stays `DEMO` on this deployment, with the
failing conditions listed. Nothing on the owner service ever reads "private". What the account's separateness from
the owner and the personas rests on is four facts outside the proof, three of which the arm script checks before it
sets a variable: (1) **a credential of its own**: the relay key belongs to a THIRD Neynar app with no wallet and no
other signers, so condition 10 (`lib/zk/privacy.ts`: the relay credential's fingerprint differs from the app's and the
fid is not the throwaway) holds, and the script refuses the app's key, the read key, the throwaway, fid 9152 and every
persona fid, compared in memory; (2) **its own creation**: a Neynar "Create Agent" registration under that app, paid by
Neynar, with a profile that names nothing (the script refuses one that contains "layers"); (3) **the relay's timing**:
the network time of every anon cast is the validator's slot (the top of the next relay interval plus up to ten
minutes, in random order, hour-grained in the row), never the moment it was written; (4) **the text**, which is the
owner's conduct and no code's. What it is NOT: not hidden in a crowd (A-FID-ANON-CROWD, with the number one); not hidden
from Neynar (A-FID-NEYNAR-SEES-ALL narrows from "one key on every write" to "three keys under one developer account");
not hidden from the operator, who on this topology is the author; and not a reliability guarantee (the cap, below).
*Costs the owner accepts, stated before the typed confirmation:* `ADAPTER_REP=zk` makes every persona's discovery tier
what it has proved, else 0; `ZK_MODE=live` moves every ZK surface to the live universe; 150 credits a cast and about
20,000 a month while the agent's signer is active; `VALIDATOR_POLLER=off` stays set (A-PRODLIVE-THE-POLLER-SPENDS).
The reveal half (§14.1, §14.2) stays off: it needs a persona that owns a live fid, it is below the closing bar, and a
reveal is permanent and visible to every reader of this server (A-ANON-REVEAL-STAYS-OFF below: nothing changes on
Farcaster). The kill switch is `arm-anon.ps1 -Disarm`.

**Assumptions, by id.** Each was checked against the code by the liveness and deanonymisation review of 2026-10-07
(the file and line beside each is the evidence); none is fixed by arming, and the runbook states every one of them.

- **A-ANON-SET-OF-ONE** — the proof is sound and says nothing: one registered root in the live universe, floor 1
  (`lib/zk/config.ts` `ZK_ANON_FLOOR`, clamped to at least 1; `lib/zk/cohort.ts` refuses below it). The anonymity set
  on the network is the set of roots posting through this validator's account (A-FID-ANON-CROWD), which is one.
  *Cost:* the label never reads private here; the composer, the runbook and the docs say "an extra account with no
  name on it".
- **A-ANON-COVER-IS-OUT-OF-BAND** — the account's unlinkability to the owner rests on facts the proof does not touch:
  the third app's key (condition 10, `lib/zk/privacy.ts`), the Create Agent registration, the profile text, the relay
  slot (`validator/zk.js` `relayPending`: the top of the next interval plus up to ten minutes, random order) and the
  owner's writing. After arming, code keeps checking only condition 10 and the signer's approval for exactly
  `FC_ANON_FID`; the rest is conduct. The config endpoint's sensitive half (the fid, the arming state, the key
  fingerprint, the counts) is served only to a device-signed reader when `LAYERS_REQUIRE_SIG=true`; unsigned readers
  get the tree and window shape alone.
- **A-ANON-NEYNAR-JOINS-BY-ACCOUNT** — a third app narrows Neynar's join, it does not remove it: the ANON key, the
  write key and the read key sit under one developer account, every relayed text passes through Neynar as a cast
  request under the ANON key, and Neynar's logs, a breach or a subpoena join the three. (A-FID-NEYNAR-SEES-ALL,
  restated for this topology.)
- **A-ANON-REQUESTFID-UNREAD** — VERIFY-YOURSELF F22 stands: which fid Neynar wrote as `requestFid` into the agent's
  onchain signer key, and into each persona's, is undecoded. A shared developer-unique `requestFid` links the agent
  to the personas on chain regardless of everything above. The owner decodes it (the hub's `onChainSignersByFid`)
  before relying on the account's separateness.
- **A-ANON-TIMING-IS-THE-SLOT** — correlation between the owner's persona activity and an anon cast is bounded by the
  relay interval (an hour) and the window (one epoch: six hours, or one with `ZK_EPOCH_MS=3600000`, the client
  minimum), not eliminated (A-FID-ANON-TIMING). With one device, A-FID-ANON-SET-IS-ONLINE-DEVICES is moot: the set is
  one whether or not the device is online.
- **A-ANON-OPERATOR-IS-THE-AUTHOR** — the validator holds the text of every submission (A-FID-ANON-RELAY-HOLDS-THE-TEXT)
  and the ANON credential. Here the operator is the author, so the row's lack of a persona, root or nullifier protects
  against a later reader of the volume, not against the operator; and whoever can read the owner project's volumes
  and variables (A-PRODLIVE-THE-HOST-HOLDS-THE-SEED) can post as the anon account and read every anon text.
- **A-ANON-TIERS-BECOME-PROVEN-OR-ZERO** — `ADAPTER_REP=zk` (`lib/adapters/zk/rep.ts`): a persona's discovery tier is
  what it proved this epoch, else 0, so a persona that never proves is unranked for For You on the owner service;
  `ZK_MODE=live` (`lib/zk/config.ts`) moves registration, tiers, attestations and the queue to the live universe, one
  universe per process. Both are printed to the owner before the typed `ANON`.
- **A-ANON-CAP-IS-A-ROW-COUNT** — `ZK_ANON_POST_LIVE_CAP` counts the live rows the validator holds (`validator/zk.js`,
  the count inside the insert transaction: pending and relayed rows; a row the relay gave up on after
  `ZK_ANON_RELAY_MAX_ATTEMPTS` (6) slots is `failed` and stops counting), never a daily allowance; a row stuck pending
  keeps its slot until it is relayed or fails.
  The cap is the only bound on what a stuck queue, a bug or a stolen passphrase can publish under the agent's name;
  raising it is a typed, deliberate step after the first cast is seen on the network.
  (Persona launch P3, §23: this cap now defaults to 1 on every non-public shape even when the variable is unset or
  blank, and a global daily cap, `ZK_ANON_POST_DAILY_CAP`, sits beside it; on the public shape the daily cap is the
  limit and this one applies only when set.)
- **A-ANON-RELAY-RETRIES-WITHOUT-IDEMPOTENCY** — `relayPending` now runs one row at a time, sends every cast with an
  `idem` key derived from the row's cast hash, bounds each request at 30 seconds, and retries a refused or timed-out
  row once per slot for at most `ZK_ANON_RELAY_MAX_ATTEMPTS` (6) slots, then marks it `failed`. The remaining
  assumption is Neynar's documented `idem` semantics (a retry with the same key returns the original cast, not a
  duplicate), unverified until the first live relay: the owner looks at the agent's casts after each slot and deletes
  an extra by hand. A sent-unconfirmed state confirmed by lookup before any re-send (the stronger fix) is queued for
  after the first cast.
- **A-ANON-REVEAL-STAYS-OFF** — the reveal is unusable on the owner service until a persona owns a live fid, it stays
  below the closing bar (§14.1's banner stands), and a reveal is permanent and visible to every reader of this server
  (A-FID-ATTR-IRREVERSIBLE): nothing changes on Farcaster, where the post stays the anonymous account's, and the claim
  is checkable inside Layers only until the persona's derived key is registered on its account. The runbook says to
  leave the control alone even once a persona has an account.
- **A-ANON-DISARM-DOES-NOT-DRAIN** — `-Disarm` deletes the key, the signer and the write switch on the validator and
  the universe and rep bindings on the app, and redeploys both; pending rows stay on the validator's volume and go out
  at the first slot after the next arming, so arming again is also sending them. Stopping the app (`railway down`) does
  not stop the relay: it runs inside the validator, and the shortest stop is deleting `ENABLE_FC_WRITE` there and
  redeploying it.
- **A-ANON-NEVER-RUN-LIVE** — until the first `-FirstCast` is confirmed on the network, every statement about the live
  relay in this section is fixture-verified, not observed (there is no `live-fid4.json` in `research/`); the first
  live post is a gate-level event, with the cap at one.

## 21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn

**Status (PERSONA LAUNCH P1, 2026-10-10): built, test data only.** It has never run against Farcaster's real sign-in
relay or the real Optimism chain. The rig runs an in-process fixture relay and fixture chain; the production-shaped
suite runs a loopback stub of both (`scripts/lib/siwf-stub.mjs`). The first real sign-in is the owner's, on the
deployed public site (`notes/runbooks/OWNER-CHECKLIST.md`), and the status row stays "Built, test data only" until it has happened.
The design is `research/spec-siwf-passkey-first-2026-10-08.txt`; the decisions are D-SIWF-1 to D-SIWF-4 in
`docs/custody-model.md`.

**Decision: identity, not custody.** A sign-in proves "the human in this tab controls Farcaster account M right now"
and binds M to the tab's root as one sealed record plus a read-only "public self" persona. It is not a way to save an
identity: a sign-in yields no stable secret to derive a key-encryption key from, and a record on the validator keyed
by the account number would be an account-to-anchor table the operator could read (account numbers are small
integers, so hashing them hides nothing). So the save picker is passkey first, Sign in with Farcaster second, and the
24 words under Advanced. The card says so before anything else: "This shows which Farcaster account is yours. It does
not save your identity: save with a passkey first."

**Where it runs.** Entirely in the browser device (D-SIWF-1). The device creates the relay channel, shows the QR code,
polls the relay, parses and verifies the signed sign-in message itself, and checks the account against Optimism's
IdRegistry (`idOf`) or KeyRegistry (`keyDataOf`) with `eth_call` from the browser, through the unpatched `fetch` with
credentials omitted and no referrer. A 65-byte signature is recovered locally with no chain call; only a contract
wallet's signature goes through the ERC-6492 validator over the node. The public app server receives nothing: a
request for `/api/fc/siwf` that reaches it on a public deployment is refused `404 device_only` before its body is read.
The owner service does not offer it ("Use Settings > Connect your Farcaster account on this service"); the rig answers
with the fixture network only.

**What the visitor is told, before the first request** (`components/device/FarcasterSignIn.tsx`, verbatim; `{rpcHost}`
is the node the device env names, `mainnet.optimism.io` by default): "Farcaster's sign-in service will see that you
signed in to Layers, and your internet address. Your browser then checks the account on the Optimism blockchain
through {rpcHost}, which sees your internet address too. Layers' server sees nothing."

**What each party learns from one sign-in.**

| Party | Learns | Never learns |
|---|---|---|
| Farcaster's sign-in relay (`relay.farcaster.xyz`) | the app's domain and sign-in address (so "Layers"), the nonce, the visitor's IP address and user agent at channel creation and at every poll, then the completed record: the account number, username, display name, picture, custody address, verifications, the signed message and its signature. "Account M signed in to Layers at time T from address X." | the root, the personas, anything the validator holds |
| The chain node (`mainnet.optimism.io` by default) | "Address X asked `idOf` for M's custody address (or `keyDataOf` for M and an auth key) at time T" | anything else; the device sends it nothing else |
| The Layers public app server | nothing: no request is made to it | the account, the time |
| The validator | one signed, sealed write of the `accountLinks` namespace, padded to exactly 1,024 bytes, from the device's address. Every root writes the same namespace at boot (an empty record when it never signs in), so its presence and its size carry no bit. PUBLIC GO-LIVE: in the LIVE universe (the public @anon armed, §31) the sign-in also sends the fid gate's join, and only after the sign-in is sealed (PRIV-LIVE-3): the account number, the signed message, and a dedicated crowd commitment that no table ties to a root (PRIV-LIVE-1), from the device's address at time T | outside the live universe: the account number, the username, that a sign-in happened; in it: which root signed in (no table says; the address and the hour are A-ANON-PAGE-SAME-ADDRESS) |
| The picture's host | when the avatar renders: "address X loaded M's picture", with no referrer; off-allowlist hosts are held behind the existing tap-to-load rule | the root |
| Other visitors | nothing | everything |

**What is stored, and what is not (D-SIWF-2, D-SIWF-4).** One sealed record, `accountLinks`: the account number, the
username, display name, picture address and bio as the relay reported them, the persona id, the auth method, the
signer address, the SHA-256 of the nonce and of the message, the time it was verified, the node's host, and the
disconnect time. Not stored: the signature, the raw message, the relay's IP address and user agent, the custody and
verified addresses, the channel token. A signature is a transferable proof that M signed in to this domain; keeping it
would widen what a vault compromise leaks for no product value.

**What it enables, and what it refuses (D-SIWF-3).** A read-only public self: the switcher lists it with a "Farcaster ·
read-only" chip and opens its profile instead of switching to it; its profile shows the "that's me" badge. Posting,
replying, liking, recasting, following or acting as it through the PERSONA routes on the public site is refused with
`403 PUBLIC_SELF_READ_ONLY` and the sentence "Persona actions never act as your Farcaster account. To act as yourself,
choose You in the account menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your
account, once you allow Totem to post as you. To do this as a persona, switch to one of your personas." (POST AS YOU,
2026-11-05: posting as the account itself has its own door and its own key, §35; acting as yourself, "You" in the
account menu on the live site, makes no persona the acting identity, §35; the public self still never acts as a
persona.)
Forking from it is refused: "Your Farcaster account can't be forked: a fork carries a proof back to where it came from,
which would publicly link the new persona to your Farcaster account." One account per root; a disconnect leaves a
tombstone, and only the same account may sign in again; no other persona of the root may share a name stem with the
account's username. "Show my Farcaster posts here" is a button, never automatic, and it says what it costs: "This
reads them through this preview's server, which then sees that this profile was opened from your internet address."
(2026-11-07, §42: RETIRED. A Neynar read may name no visitor, and this one named the root's own account; the button is
gone, `live=1` answers 409 `names_you`, and the root's posts are read from Farcaster's network on `/fc/profile`.)

**Assumptions, by id.**

- **A-SIWF-COLLUSION-IP-TIME** — the Layers operator together with the relay's operator, or together with the chain
  node's, can join address X and time T to the root's own signed validator traffic and learn which root belongs to
  account M. Outside the live universe the Layers operator alone cannot: it receives no request carrying M. In the live
  universe (PUBLIC GO-LIVE, §31) the join IS the validator's own view of the sign-in (account M, from address X at time
  T), sent only after the sign-in is recorded (PRIV-LIVE-3), so the operator alone can make that same join of X and T to
  the root's signed traffic (A-ANON-PAGE-SAME-ADDRESS). The card says so before the request (`SIWF_SERVER_SEES_LIVE`).
- **A-SIWF-OWN-PROFILE-READ** — pressing "Show my Farcaster posts here" sends a read of @username through the read
  relay from address X at time T, which the operator alone can join to the root's traffic
  (A-FCREAD-OPERATOR-SEES-READS). So it is never automatic, the button says what it reveals, and the sealed facts
  render without it. CLOSED 2026-11-07 (§42): the read is retired; no request names the root's account to the relay.
- **A-SIWF-RELAY-TRUSTED-FOR-LIVENESS** — the relay can withhold or delay a completed sign-in. It cannot forge one: the
  device trusts the signature and the chain check, not the relay's word.
- **A-SIWF-NAMESPACE-NAME-VISIBLE** — the validator sees the name `accountLinks` under each anchor
  (A-CU-NAMESPACE-NAMES-VISIBLE). Its presence is uniform (every root seals it at boot) and its ciphertext is exactly
  1,024 bytes with or without a link (`scripts/unit-siwf.mjs` U9, `scripts/accept-siwf-prod.mjs` P7).
- **A-SIWF-PAGE-IS-THE-DEVICE** — A-CU-5 restated: a script on the app's origin can start a sign-in. It cannot point
  the device at another relay or node: an override is honoured only as the default, an http(s) loopback address, or
  (the node only) a bare https origin with no user, query or path; anything else is refused by name
  (`[siwf] bad_config (FC_SIWF_RPC_URL)`) and no request is made, and on a hosting platform the server forwards no
  override at all. A keyed provider address can therefore never sit in the page.
- **A-SIWF-PUBLIC-RPC-CORS-AND-LIMITS** — unverified until the first real run: that `mainnet.optimism.io` answers
  browser `eth_call`s with CORS headers and at a usable rate. It fails closed either way: an unreachable or unreadable
  node is "could not check the account" (`siwf_chain_unavailable`), retryable without a new approval until the
  ten-minute deadline, never a pass.
- **A-SIWF-RELAY-CORS** — the official AuthKit library makes the same relay calls from browsers, so the relay is
  expected to answer CORS preflights for the `Authorization` header; unverified here until the first real run.
- **A-SIWF-PROFILE-FROM-RELAY** — only the account number is proven (the signed `farcaster://fid/N` resource, plus
  `idOf` or `keyDataOf` on the chain). The username, display name and picture are the relay's unsigned metadata, so a
  dishonest relay could name the wrong username for the right account. The card and the profile show what the relay
  said.
- **A-SIWF-STRICTER-THAN-REFERENCE** — the verifier refuses the legacy statement "Farcaster Connect", a sign-in address
  off this page's origin, an `issuedAt` outside [now − 10 min, now + 2 min], and an expiry past the device's ten-minute
  deadline; the reference library accepts some of these. A real Farcaster app that differs is refused (it fails
  closed, never open), and the first real run is the test.
- **A-CU-6-RP-ID-IS-THE-HOST**, now urgent — passkey-first puts a passkey in front of every new visitor, and a passkey
  is bound to the host that saved it. Moving the app to a custom domain after strangers have saved would strand every
  passkey; the 24 words would still work. The address is the owner's decision, before strangers save.

**Measured by:** `scripts/unit-siwf.mjs` (node-only, a fake relay and chain in-process, the reference library as a
cross-check), `scripts/accept-siwf.mjs` (the rig) and `scripts/accept-siwf-prod.mjs` (the production shape, loopback
stub), plus `scripts/smoke-deployed.mjs` check 9 against a deployment (the route answers `404 device_only`; the device
reports the relay and node hosts without making a request).

## 22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import

**Status (PERSONA LAUNCH P2, 2026-10-10): built, test data only.** Tested with a synthetic 3,000-post archive
(`scripts/lib/x-archive-synth.mjs`) and the rig's small fixture, never with a real X archive; the list of
Farcaster-verified X accounts has been built only from a local stand-in (`scripts/lib/x-index-stub.mjs`), and
`VALIDATOR_X_INDEX` is off on every deployment. Following matched people from Layers (the follow queue) is a later
wave. The design is `research/spec-bring-your-x-2026-10-08.txt`.

**Where each step runs.** The browser PAGE reads the archive (a ZIP, or its extracted folder) and parses the few files
the importer needs; only parsed lanes leave the reader: posts, who you follow, likes (off by default, at most 500) and
ad interests. The account file's email and phone are dropped inside the parser; message and media files are listed and
never read. The device (on the public site) or the owner app's server seals and saves what was kept, as chunked sealed
documents. The validator builds the index when `VALIDATOR_X_INDEX=on` and serves it whole. The device downloads the
whole index and matches locally. Nothing calls X. The wizard says it first, and says what does leave: "The archive file
never leaves this browser.", then that only the parts picked are saved, sealed (by the device on the public site, by
the owner's service on the private one). Review UX-10 retired the earlier "Nothing is uploaded", because the parsed
lanes do leave the page.

**The fingerprint warning** (required before the follow lane imports; `components/settings/XImportWizard.tsx`,
verbatim): "Importing who you follow into @persona ties it to @xhandle: a follow list is a fingerprint. If @persona is
not meant to be your X self, pick another persona or skip this lane."

**What each party learns** (the leak predicate: a thing T is hidden from a party when that party's observations are
identical whether or not T exists). Let F be the follow list, M the matched set, A the X identity, S the shelf and P
the persona that received the import.

| Party | Learns | Never learns |
|---|---|---|
| The validator operator | the document names under each anchor (`xArchive`, `xShelf`, `xFollows`, each a manifest plus numbered pieces) and their padded sizes, so "this anchor imported an X archive" and a size class of S and F; each `GET /x/fc-index` by address and time, so "this address opened Find your people" | F, M, A, S, P: they are sealed, and the names are per root, never per persona |
| The app server operator (public site) | the page view `/settings/import-x` | any X data: the import routes are answered in the tab |
| Farcaster (`api.farcaster.xyz`, `fnames.farcaster.xyz`) | a validator's nightly crawl, from one address: "a Layers validator mirrors the list" | any user |
| The read relay, when armed | a matched profile opened by a click, like any other profile read (A-FCREAD-OPERATOR-SEES-READS) | the list: it is never resolved through the relay |
| X | nothing: no X API is called | everything |
| Other visitors | nothing | everything |

**Decisions and assumptions, by id.**

- **A-X-NAMESPACE-SIZE-CLASS** — a chunked document's piece count and padded size are visible, so the operator learns
  a size class of the shelf and the follow list (pieces of 96 KiB of plaintext; 1 KiB padding steps).
- **A-X-INDEX-FETCH-IS-A-PAGE-VIEW** — downloading the index is visible per address and time: "this address opened
  Find your people". Only the import page and the identity read fetch it, at most daily (`X_INDEX_MAX_AGE_MS`), and
  the download is the same whole file for everyone, so it says nothing about who matched.
- **A-X-NO-LIST-RESOLUTION** — the matched list is never looked up profile by profile through the read relay; a
  profile is read only when the person opens it, and that read is an ordinary relay read.
- **A-X-FOLLOW-GRAPH-IS-A-FINGERPRINT** — following the same people from a persona as from an X account ties the
  persona to that X self, on Farcaster in public and for Neynar. The warning, the choice of persona and the daily
  follow budget slow it; they do not prevent it.
- **A-X-EXTERNAL-LINKS-ARE-CLICKS** — the panel's links to x.com and farcaster.xyz open those sites in a new tab; the
  person's browser then talks to them directly.
- **A-X-ARCHIVE-IS-SELF-SUPPLIED** — an archive proves nothing about who you are: anyone can drop in any file. Only a
  persona's own Farcaster account's X verification earns "verified on Farcaster"; a test link says "test link, not
  verified".
- **A-X-INDEX-SOURCE-IS-BETA** — the index is built from `api.farcaster.xyz/fc/account-verifications`, a beta endpoint
  with no stated terms; it may change or close without notice.
- **A-X-INDEX-DRIFT** — that endpoint pages by page number, newest first, so page boundaries drift while a crawl runs;
  a run can miss or repeat rows near a boundary until the next night.
- **A-X-FNAME-COVERAGE-RAMPS** — the account-number-to-username mirror backfills about 1,500 pages a night, so early
  rows can lack a username; the panel then shows the account number.
- **D-X-IDS-SEALED-NOT-HASHED** — X account ids are stored raw inside the sealed document. The old per-id hash protected
  a plaintext namespace that no longer exists; sealing the whole document hides names and values alike, and matching
  is then a plain intersection on the device.
- **A-X-DOC-ROLLBACK** — the operator can serve an older COMPLETE copy of a chunked document (an older manifest with its
  own pieces) to a fresh process, which cannot tell it from the newest. Within one process an older generation than
  the one it last read or wrote is refused.
- **D-X-SLOT-NAMES** — a document's pieces live in two slots (`<name>.g0.<i>`, `<name>.g1.<i>`), not one name per
  generation: two slots are enough for the torn-write rule (a save never writes the slot the live manifest points at),
  and they keep the device's envelope counters, its sealed-name list and the validator's counter table bounded. The
  generation number is inside the manifest and every piece.
- **D-X-ZIP-CENTRAL-DIRECTORY** — no ZIP library: the reader uses the archive's central directory and random access
  (at most 8 MiB per read), inflates with the browser's own `DecompressionStream`, reads only the wanted entries and
  checks every entry's CRC-32. An archive of 4 GB or more is refused with the instruction to extract it and pick the
  data folder; an entry over 512 MiB is refused with its size.
- **A-X-INDEX-BUILD-RIG-ONLY** — the routes that build and clear the index on demand are developer hooks only (refused
  on a deployment), and a build takes loopback sources only; the source overrides `VALIDATOR_X_INDEX_SOURCE_URL` and
  `VALIDATOR_X_INDEX_FNAMES_URL` are ignored on a hosting platform.
- **A-STATE-BODY-LIMIT** — every JSON route on the validator now accepts up to 256 KiB (`STATE_BODY_LIMIT_BYTES =
  262144`, `validator/limits.js`) instead of Express's default 100 KB; the rate limits are unchanged. A save over the
  limit is refused out loud: the app's persist client checks the size before sending and names the namespace and its
  size, and the validator answers `413` in JSON naming the limit and the namespace. This closes the board issue
  "Large saves vanish without a word".

**Measured by:** `scripts/unit-x-v1.mjs` (node-only), `scripts/unit-namespace-sizes.mjs` (every namespace sealed under
the limit with headroom), `scripts/accept-x5.mjs` (the rig), `scripts/smoke-x.mjs` (the production shape),
`validator/test/limits.test.js` and `validator/test/xindex.test.js`.

## 23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says

**Status (PERSONA LAUNCH P3, 2026-10-10): built, test data only.** Everything in §14, §14.1 and §20 about the relay,
the reveal and the owner service still holds; this section is what changed. No live anon cast has been made.

**What changed.** An anonymous post is now made AS one of the root's personas (D2: a persona without its own account
posts through @anon by default; its post mode is `anon`, `private` for Layers only, or, after a launch, `direct`). The
persona rides only inside the sealed reveal record on the device (`AttributionRecord.personaId` in the sealed `zkQueue`
namespace), never in the envelope, the signal or the wire, so a later launch can reveal exactly one persona's posts.
The budget is the PERSON's: up to K posts per window, shared across all of that root's personas (D4: K = 4, a 6-hour
window). Each post proves under the indexed scope `anon-post/w<n>/s<i>` for a slot i < K, so there is one nullifier
per (person, window, slot): two posts of one person in one window carry different nullifiers, and a (K+1)th post has
no free slot. The bare-window scope of §14 is refused on both sides. The device draws the slot uniformly from its free
slots, never lowest-first, and never adopts the validator's K for its own choice: it only refuses to post when the two
disagree. The relay cadence is set by the shape: on the public shape 30-minute slots with each post spread at random
over the next 30 minutes (visible within about 75 minutes); on the rig and the owner service the hourly slot as
before. A global daily cap (`ZK_ANON_POST_DAILY_CAP`, default 500) bounds everything the validator accepts in a day;
the lifetime cap of §20 (`ZK_ANON_POST_LIVE_CAP`) stays 1 by default on every non-public shape, even when the variable
is unset or blank, and applies on the public shape only when set. Migration 21 adds a `tree` column (the tree a post
proved, read by the later reach-tier boost) and a `note` column reserved for the ring note, NULL on every row until
then. The composer says: "Posting as @x through @anon — attributed to no one by hubs, other clients, this client or
the validator; not hidden from Neynar under managed custody. Up to 4 every 6 hours, shared across your personas."

**Assumptions, by id.**

- **A-ANON-SLOT-INDEX-VISIBLE** — the slot index rides the wire and is never stored. One person's posts in one window
  never share a slot, so a pair of one window's posts that DO share a slot is proven to be two people; a pair in
  different slots becomes K/(K−1) times likelier to be one person (about 1.33 at K = 4) than without the index.
  `test:linkage6` check 7 measures and prints this. The uniform draw makes any single post's index carry nothing
  beyond "a free slot".
- **A-ANON-SLOT-COLLISION-ACROSS-DEVICES** — two devices of one root keep separate queues. If both draw the same slot
  in one window, the second post is a replay at the validator: not relayed, and the slot spent. The validator has now
  seen those words under the earlier post's nullifier, so they are never sent again. The status line says the post is
  not confirmed (the public list holds only relayed rows, the newest 200: it can confirm a post but never prove one
  missing) and "Don't post the same words again". The client refuses the same words (case and spacing aside) with 409
  replayed before anything is minted, also after the submission is pruned (PRIV-1; unit-anon-slots R1/R2,
  accept-anon-slots check 3).
- **A-ANON-DAILY-CAP-IS-GLOBAL** — `ZK_ANON_POST_DAILY_CAP` is one budget for everyone in a universe per day, so heavy
  posters can use up a day for all. The per-person limit is the K slots; Sybil resistance comes from the tree (one
  attested account vouches for one root), not from the cap.

**Measured by:** `scripts/unit-anon-slots.mjs` (node-only), `scripts/accept-anon-slots.mjs` (the rig: K posts in a
window give K distinct nullifiers and the K+1th is refused), `scripts/accept-linkage6.mjs` (the operator-view linkage
test, linkage v6, including the slot residual) and `validator/test/anonslots.test.js`.

## 24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn

**Status (PERSONA LAUNCH P4, 2026-10-12): built, test data only.** Tested on the laptop rig, on the production shape
(browser devices booted on the loopback test page, with its debug hooks and a 1-second tick, publishing as strangers'
devices would, and the `/d` card) and node-only; never on a deployed site, and no anonymous post with a real ring note
has reached the network. No suite drives the Settings › Rings page in a browser, and the production-shape suite shows
no card merge. On the public site a ring works only as text: anonymous posting is not there yet (P7), so the "posts"
depth has nothing to show, and public personas have no fid, so no card merges; a member sees the shared personas under
"Rings you are in". (Wave 3, 2026-10-13: anonymous posting from the public site is now built, test data only and not
deployed, §27; each such post carries the note like any other, and every device's tick reads the public anon list, but
no suite has yet shown a ring member opening one on the production shape.) The design is `research/spec-friend-whitelist-2026-10-08.txt`
(DROP), adapted from the owner service's "friends" to every device's "rings" and made multi-writer by D8
(`research/plan-persona-launch-2026-10-10.md` R8, D8). §14, §14.1, §20 and §23 still hold; this section is what rings
add.

**What is built.**

- **Rings** (`lib/rings/model.ts`, `lib/rings/outbound.ts`). A root keeps up to 16 named rings of up to 32 members
  each. A member is a private address another person handed over (`LR1.` + an address id, an X25519 public key and a
  PSK, derived from THAT person's root, at most 32 per root) or a link for someone without Layers (`/d#<key>`). A
  member is a recipient, never an identity: the owner's device learns an address, not who holds it. For each ring and
  each of this device's own PUBLIC personas there is a depth: "name" (the ring learns that @persona is this root: the
  half-and-half avatar, root on the left, persona on the right) or "posts" (also which @anon posts it wrote). Private
  personas and the read-only public self are refused as subjects; a persona whose fid is one of Layers' own accounts
  (`FC_TEST_FID`, the anon account, `FC_RESERVED_FIDS`) is shared without that fid, and no typed fid is ever accepted
  (a persona id is accepted only when it is one of this device's own public personas); the main account appears only
  as the envelope's root, read through `rootHeadshot()`.
- **The envelope** (`lib/rings/envelope.ts`). HPKE (RFC 9180) in PSK mode, X25519 + HKDF-SHA256 + AES-256-GCM, the
  suite root linking already ships. One fixed plaintext size, 4,096 bytes: a statement that does not fit is refused at
  seal, never truncated, so every row's ciphertext is exactly 8,224 hex, real or dummy, one subject or ten. A 2-byte
  hint keyed by the PSK lets a member's device skip rows cheaply; dummies are byte-shaped like real rows (a real
  ephemeral key, CSPRNG ciphertext, a random hint). No signature anywhere: a member who passes a note on passes on a
  claim, not a proof.
- **The ring note** (`lib/rings/note.ts`). Every anon post carries exactly 256 bytes: REAL (a 12-byte nonce and
  AES-256-GCM of a padded 228-byte plaintext, with the post's cast hash as associated data, under the persona's note
  key) or RANDOM (when no ring holds the persona at "posts"). `sha256(note)` is bound into the anon-post proof's
  message beside the attribution commitment (`lib/zk/prove.ts`, `lib/zk/gate.ts`, `validator/zk.js`), so a note cannot
  be swapped after proving, and a real note copied onto another cast opens under no key. One note per post, never one
  per ring: the key is per (persona, generation), shared by every ring that holds the persona at "posts", so a note
  says nothing about how many rings see it. The generations form one-way chains (fix W2-RINGS-KEEP3-HISTORY-LOSS): when
  the audience GROWS (a member added, a ring raised to "posts") the next generation is one HKDF step along the current
  chain, so everyone already in the audience steps forward from the key it holds and loses nothing, and the newcomer,
  sealed the new key, cannot step back to posts made before it joined; when the audience SHRINKS (a member revoked, a
  ring lowered or deleted) a fresh random chain starts that nobody outside the remaining audience can reach. A member is
  sealed, per chain that overlaps its time in the audience, the key of its first generation and a step count rounded up
  to 4, never a generation number (fix LP-5). The rounding hides only where the member's own stretch starts and ends,
  not what happens between two notes it can open: a member derives every later step from the key it holds, so a
  modified client sees which step opens each note, and the difference between two notes' steps is the EXACT number of
  times that persona's audience grew in between, in every ring that holds the persona at "posts", the member's own or
  not; a new stretch in its envelope brackets a revoke, a lowering or a delete (A-RING-NOTE-INDEX-COUNTS-JOINS, wave 3
  review, below). History therefore survives every add and is bounded only by two revokes or
  lowerings (or about 64 adds) since the member joined, which the fixed 4,096-byte envelope cannot carry beyond. The
  composer does the same work with or without a ring (a throwaway key when there is none), and a rings document it
  cannot read refuses the post with the words kept in the box: a post never goes out without its note.
- **The drop** (`validator/ringdrop.js`, migration 23). `PUT /rings/drop/batch` is device-signed (the envelope over the
  body, namespace `rings:drop`; an unsigned or badly signed write is refused whatever `LAYERS_REQUIRE_SIG` says). Rows
  come in multiples of 4 (at most 28 per write), every shape exact, an expiry within the publisher's own 72-hour lease
  (plus 2 hours of clock slack), never an overwrite; the table is capped (`RING_DROP_MAX_ROWS`, default 4,096; full
  answers 413). Occupancy is bounded, not just the write count (fix W2-RINGS-DROP-FILL-DOS: the first cut let one fresh
  device fill the table in about 75 minutes): per device at most `RING_DROP_WRITES_PER_HOUR` writes (120) and
  `RING_DROP_ROWS_PER_HOUR` rows (2,048) an hour, and at most `RING_DROP_MAX_LIVE_PER_DEVICE` live rows (1,024, two
  full generations of the largest publisher); per client address at most `RING_DROP_MAX_LIVE_PER_ADDRESS` live rows
  (2,048), so minting device identities from one address does not multiply it (the client address is the socket's
  unless `TRUST_PROXY=true`, A-CU-5-TRUST-PROXY). Each limit is a 429 with a sentence and
  Retry-After, counted per process in memory by hour bucket, never a row id and never at rest. A write's inserts and its deletes of the
  previous generation (by token, inside the signed body) run in ONE transaction, so a member's full read never sees a
  gap between them (one exception, under Publishing). `GET /rings/drop` is open and no-store and returns every live row in a crypto shuffle, each exactly `{id, enc,
  ct, hint, expiresHour}`. The table has six columns (`id, enc, ct, hint, expires_hour, del_hash`) and no writer,
  device, anchor or mode column. It logs aggregate counts once a minute, never a row, a device or an address.
- **Publishing** (`lib/rings/publisher.ts`). On the prefetch tick when due (hourly, ±25 %, or the next tick after a
  change): one envelope per (ring, member) with a 72-hour lease that every re-seal renews, padded with dummies to a
  multiple of 4, in writes of at most 28 rows; the previous generation is deleted with the last of them. A failed
  envelope seal or a failed write deletes nothing: the previous generation stays live until its lease. One case leaves a
  gap: when every write landed (so the previous generation is gone) and the "rings" document then fails to save, or
  another device saved first, the new rows are withdrawn too (their tokens would otherwise be lost and outlive a
  revoke), and members' next full read drops the record until the next publish. A device with nobody in a ring writes
  nothing to the drop. One ring never blocks the others (fix W2-RINGS-ONE-RING-BLOCKS-ALL): a member, a link or a depth
  that would make a ring's statement too big for the envelope at its worst case is refused when it is added, and a ring
  that stops fitting later (a persona renamed) keeps its last notes and is named in the error while every other ring
  publishes.
- **Reading** (`lib/rings/tick.ts`, `fetch.ts`, `received.ts`). Every device, on every tick, rings or not, makes the
  same two unsigned reads, the whole drop and the public anon list, and the same signed re-read of its own "rings"
  document. It trial-opens rows (hint first) and every note,
  and keeps what it received in MEMORY only: a vault write on change would follow the owner's hourly re-seal and pair
  the two devices for anyone watching write times. A FAILED read hides merges without dropping them; a FULL read that
  no longer carries a member's envelope drops that record (revoked, or not renewed); expired records are dropped.
- **Rendering** (`lib/rings/merge.ts`). From memory only: no fetch and no decrypt at render. A merge is shown only while
  its record is renewed and the last read was full; compartment mode, or a chrome document this process has not read
  yet, hides every ring merge. A card with no merge is byte-identical to a non-member's.
- **The "rings" namespace.** One sealed document holds the owner side and the member side's address nonces. Every
  device writes it once on its first tick, padded to 8 KiB steps, so its existence and size class say nothing; after
  that only on a user action, a publish, or the deferred upkeep below. An address's two secrets come off the root's
  seed, so the 24 words plus the vault recover every address. A linked device holds no seed and cannot hold an address
  in v1 ("Open this on the device that holds your identity").
- **Several devices, one document** (fix LP-2). A root's devices share the namespace, and the validator's state PUT
  replaces it whole, so the document carries a monotonic revision and a per-seal id: every tick re-reads it and adopts a
  newer copy, every change re-reads it first, and a seal re-reads it again just before writing and refuses (nothing
  written, the newer copy adopted) when another device sealed in between, so a stale device can neither re-seal to a
  member another device revoked nor overwrite that revoke. The composer refuses a REAL note from a copy not re-checked
  within `RINGS_NOTE_MAX_AGE_MS` (two and a half prefetch ticks, at least five minutes), with no read on the composer
  path. That bound is also the revoke's reach on the root's OTHER devices: a revoke rotates the chain on the device where
  it is clicked, and a sibling adopts the rotation at its next refresh, so a sibling that refreshed shortly before the
  revoke and posts before its next refresh still seals under the old chain, which the revoked member holds, for up to
  `RINGS_NOTE_MAX_AGE_MS` after that refresh: about 25 minutes at the default 10-minute tick
  (A-RING-REVOKE-SIBLING-WINDOW, wave 3 review, below).
- **Making an address writes nothing at the handover** (fix LP-3; `lib/rings/inbox.ts`). Three spare addresses are made ahead, inside writes
  that happen anyway (the first-tick write and a deferred upkeep); a spare is trial-opened like any address, so it works
  the moment it is handed out. "Make a private address" claims a spare in memory only; the claim's name rides the next
  seal of any kind, or the upkeep, drawn at a uniformly random moment 15 minutes to 3 hours after it is first needed. No
  spare left is refused in plain words until the upkeep has made more. "Forget it" hides an address (it stops being
  trial-opened and what came through it goes at once) and "Use it again" restores it; nothing is deleted. At most 32
  addresses in use and 64 records.
- **The `/d` card** (`app/d/page.tsx`, `components/rings/DropCard.tsx`). Outside the app group: no device boots and no
  root is minted. The key lives in the URL fragment, which no server receives; the card reads the public drop and opens
  it in the visitor's browser. The app server learns that someone opened `/d`. Making a `/d` link is refused on the
  owner service, where `/d` sits behind the owner gate.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The validator operator | at write time, which registered device publishes, when (about hourly) and its padded row count (a bucket of 4); at rest, which registered devices (so which anchors) have ever written the drop, through the envelope counter (A-RING-WRITER-IS-THE-DEVICE); a revoke as one delete at click time; fixed-size ciphertext, hints and hour-grained expiries; every reader's internet address and time; each anon post's 256-byte note, as opaque bytes | a persona, an fid, a handle, a ring label, which rows belong to one member, whether a reader holds an address, which anon posts have an audience |
| A ring member's device | the personas that ring was given, at its depth, and (at "posts") which of their anon posts they wrote, from the generations it was sent, while its record is renewed; the name the owner chose to be shown as (fix UX-R1: the ring's "share as" name, else the root's name as `rootHeadshot()` gives it, else "a friend"; never the ring's own label) and the root's picture; between two notes it opens, the exact number of times that persona's audience grew, in any ring, and that a revoke or lowering happened (A-RING-NOTE-INDEX-COUNTS-JOINS) | other rings' members or labels, posts its ring was not given, posts made before it was shared at "posts", posts made after it was revoked (except, for up to about 25 minutes, a post from another of the root's devices that has not refreshed since the revoke: A-RING-REVOKE-SIBLING-WINDOW), the root's other personas |
| Everyone outside your rings (other Layers users, other Farcaster apps, the hubs) | plain @anon, with 256 random-looking bytes | any link |
| The app server (public site) | page views, including `/d` and `/settings/rings` | an address, a key, a note |

**Assumptions carried over from DROP, by id.**

- **A-DROP-COUNT-REVEALS-FRIENDS** — the number of rows a device publishes says roughly how many ring members it has,
  per publishing device, bucketed to 4.
- **A-DROP-RESERVED-ENVELOPE** — a deleted but unexpired row that the operator re-serves stays valid until its lease;
  the sequence number stops it overriding a newer one.
- **A-DROP-NO-FORWARD-SECRECY** — the inbox key and PSK are static per address. To rotate, forget the address and make
  a new one; forgetting drops what was received through it at once.
- **A-DROP-REVOKE-IS-VISIBLE** — a revoke deletes one row at the moment of the click, which the operator sees.
- **A-DROP-OWNER-HOLDS-FRIEND-PSK** — the owner's vault holds each member's PSK, so a compromised owner vault can write
  deniable notes to members until they forget the address.
- **A-DROP-HINT-IS-A-PRF** — the 2-byte hint is HKDF under the PSK with the fresh `enc` as salt; it links nothing across
  generations unless that is wrong.
- **A-DROP-LINK-IS-THE-CHANNEL** — a `/d` link's key is in the URL fragment and in the browser's history. Whoever holds
  the link reads what it shows; send it over Signal or in person.

**New, by id.**

- **A-NOTE-RING-CAN-FORGE** — anyone holding K(persona, generation) can seal a note naming that persona onto their OWN
  anon post, for every other holder of that key. The note carries no signature, so it also proves nothing to an
  outsider. Designated-verifier tags are v1.1.
- **A-RING-WRITER-IS-THE-DEVICE** — the drop write is device-signed (D8), so at write time the operator sees which
  registered device publishes, when (roughly hourly) and its padded row count. The rate and occupancy counts are in
  memory, and the drop table has no writer column, but the envelope check keeps one row per (device, `rings:drop`) in
  `envelope_counters`, never pruned: at rest the database says which registered devices, and so which anchors, have
  ever written the drop (a refused write included, once its signature verifies), and the counter's value dates each
  device's first drop write to the hour. Proof-authorized anonymous writes are v1.1.
- **A-RING-DROP-SCALE** — every device downloads the whole drop on every tick. At the 4,096-row cap that is about 34 MB
  per read; the hint keeps the CPU cost low, but the bandwidth grows with the drop.
- **A-RING-DROP-READ-IP** — the drop read shows every device's internet address on every tick. The anonymous channel's
  OHTTP gateway serves only `/zk/anon/head` and `/zk/anon/submit` this wave, so the drop read goes direct, like the
  anon cast list.
- **A-RING-REVOKED-KEEP-OLD-KEYS** — a revoked member keeps the keys of the generations it was given, and can open those
  posts' notes from any saved copy. Layers' own render hides them once its record drops.
- **A-RING-OWNER-SERVICE-DROP** — the owner service publishes to and reads from its OWN validator, so its rings do not
  reach members on the public site. That needs the drop on the public validator plus the owner's device registered
  there: the next pass.
- **A-RING-MAIN-HAS-NO-FID** — `rootHeadshot()` carries no fid, so cards posted by the main account itself do not merge;
  persona cards do.
- **A-RING-DROP-SYBIL** — the occupancy limits are per device and per address; many addresses times many device
  identities still add up to the table's cap. Proof-authorized writes are v1.1. Dummy rows look like real ones by
  design, so no rule may single them out.
- **A-RINGS-LAST-WRITE-RACE** — two seals from two devices whose pre-write reads both land before either write (a window
  of one request) still end with the last write winning; the other device adopts it at its next refresh. Closing it
  needs a compare-and-swap on the validator's state PUT.
- **A-RINGS-FIRST-WRITE-AT-CLAIM** — a device that has not ticked yet makes its one first write when its first address
  is claimed: the only case where handing out an address and a write coincide, once per device.

**Added by the wave 3 review (2026-10-13; a correction of what this section claimed, no code changed).**

- **A-RING-NOTE-INDEX-COUNTS-JOINS** — the note-key chain takes one step per audience growth (`advance()` in
  `lib/rings/model.ts`, called when a member is added or a ring is raised to "posts") and starts a fresh chain on every
  revoke, lowering or delete (`rotate()`). A member derives every later step from the key it holds, so a modified
  client sees which step opens each note: the difference in step between two notes it can open is the exact number of
  joins in between, across every ring that holds the persona at "posts", including rings the member is not in, and a
  new stretch in its envelope brackets a revoke. Rounding the step count to 4 hides only the member's own join point.
  The earlier wording here (and the comment in `lib/rings/envelope.ts`) said a member never learns an exact count of
  audience changes; that was wrong. Closing it needs the chain decoupled from membership events (a step on a fixed
  schedule, a rotation on a fixed cadence or with dummy rotations): a code change with no owner in wave 3.
- **A-RING-REVOKE-SIBLING-WINDOW** — a revoke rotates the chain only on the device where it is clicked; the root's
  other devices adopt it at their next refresh. Until then a sibling may seal a REAL note under the old chain, which the
  revoked member holds, for up to `RINGS_NOTE_MAX_AGE_MS` after its last refresh (`max(5 min, 2.5 × ZK_PREFETCH_MS)`,
  about 25 minutes at the default 10-minute tick). With one device there is no window. The Remove and Delete ring
  confirmations say so (`components/settings/RingsPane.tsx`, wave 3 final verify); tightening the bound for real notes
  to under one tick would trade it for more "rings are stale" refusals.

**UXH-9 resolved: hide, never delete (PERSONA LAUNCH GO-LIVE, 2026-10-17).** The wave 3 review found that Remove and
Delete ring erased the owner's own records from the sealed rings document (`lib/rings/outbound.ts` revokeMember /
deleteRing), which broke this project's hide-never-delete rule. They now set `hiddenAt` on the record and keep it
(label, address, key material, inside the same sealed document the validator cannot read); Settings › Rings ›
Recently removed lists them ("People you removed and rings you deleted are kept here, not erased, so you can bring
them back.") and Restore brings them back (`restoreMember` / `restoreRing`). What a removal does to the AUDIENCE is
unchanged: every chain the ring holds at "posts" rotates, the person's rows on the drop are deleted at the click
(A-DROP-REVOKE-IS-VISIBLE still holds: that is the drop's row, not the owner's record), the next publish seals a hidden
person nothing, and a removed person keeps what it already saw (A-RING-REVOKED-KEEP-OLD-KEYS). A restore is a JOIN: one
chain step per persona at "posts", and the restored person starts there, never at a generation from before or during
the removal, so it cannot open what was posted while it was removed. Kept records count against two record bounds
(`MAX_RING_RECORDS` 32 rings, `MAX_MEMBER_RECORDS_PER_RING` 64 people a ring, in use or hidden), and a full bound is
refused in plain words that point at Recently removed. The operator learns nothing new: the sealed document is padded
as before, and a restore looks like a join on the drop. Measured by `scripts/unit-rings.mjs` group H (with a mutation
per guard) and `scripts/accept-rings.mjs`.

**Measured by:** `scripts/unit-rings.mjs` (node-only, with a mutation for each guard), `scripts/accept-rings.mjs` (the
rig: members see exactly the shared posts and a non-member's cards are byte-identical; revoke rotates the key; a failed
read hides without dropping; the database grep finds no persona or ring material), `scripts/accept-rings-prod.mjs` (the
production shape: a stranger's device-signed publish, the `/d` card, no write token anywhere),
`validator/test/ringdrop.test.js` and the ring section of `scripts/root-leak.mjs`.

## 25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor

**Status (PERSONA LAUNCH P5, 2026-10-12): built, test data only, tested on the laptop rig; deployed to both sites on
2026-10-12.** No live follower count has been read, no reach tier has been issued on a deployed service, and anonymous
posting from the public site is a later step (P7), so no boosted post exists anywhere. On the public site the reach
issuers also refuse to run in the visitor's browser (D-REACH-ISSUER-HOST-ONLY, below). On the owner service no tier can
reach its crowd floor: with one owner, none is offered there.

**What is built.**

- **Two issuers** behind the open interface (§13), sharing one family key, `reach`, and each honoured by its EXACT id
  plus that key (`fc.reach@<reach key>`, `x.reach@<reach key>`): the open registry is first-come, so an id alone proves
  nothing.
  - `fc.reach` (`lib/attest/issuers/fcReach.ts`): followers of the root's OWN main Farcaster account, read where the
    device keeps it (the Sign in with Farcaster link, or the owner service's connected public self), read-only, never
    an fid taken from a request. Nested buckets `gte-1k` ⊃ `gte-10k` ⊃ `gte-100k` (a 100k account is issued all three),
    never the count. Entry needs a Neynar score of 0.7 or more; below it nothing is issued, in plain words. One account
    per root: the retention family `fc.reach` remembers a salted hash of the fid and the commitment it vouched for, and
    a second root binding the same account is refused while the first issuance is unexpired. Valid 8 epochs (two days).
    Facts come through the fid-facts seam: the fixture in sweeps; live is the existing Neynar user lookup
    (`ATTEST_FID_SOURCE=live` and `NEYNAR_API_KEY` read credits, the owner's O3), never in a sweep.
  - `x.reach` (`lib/attest/issuers/xReach.ts`): fixture only. The X handle that main account verified on Farcaster; on
    live facts it refuses in plain words and issues nothing (a live X follower count needs the owner's xAI key, O5).
- **What an anon post proves.** The plain anon tree OR one reach tree. The tree is NOT in the scope
  (`anon-post/w<n>/s<i>`): the K slots are the person's whatever tree a post proves, and a slot re-used under another
  tree is a replay. The validator records the tree and the size of the frozen tree at the post's epoch (`tree_size`,
  migration 24) and serves both on `/zk/anon-casts`; `/zk/anon-post/config` serves `reachIssuers`
  (`ZK_ANON_REACH_ISSUERS`, default `fc.reach,x.reach`; `none` accepts none).
- **The crowd floor** (R6). `ZK_REACH_FLOOR`, default 50, never below `ZK_ANON_FLOOR`, so the owner service's
  `ZK_ANON_FLOOR=1` never offers a tier of one. It is enforced five times: at the offer (the census SIZE of the last
  tick, never the validator's `clearsFloor`), at the compose gate (before anything is minted or written), at the
  prover's cohort stage, at the validator (the frozen tree's size, before any nullifier) and at the label. The tiers a
  root holds are read from its own attestation vault and cached at moments that are not a compose; an empty cache, or
  an issuance whose window has ended, refuses a reach tree (the cache's age itself is not checked), and the compose
  gate never fetches.
- **The crowd across posts** (fix LP-4, `lib/zk/gate.ts`). A launch later joins all of a persona's anon posts, so the
  tick keeps, on the device only and never sent, the running intersection of the members of every tree each persona's
  anon posts were proved in, with the list of posts it covers. A boosted post whose tree would narrow that crowd to
  fewer than `ZK_REACH_FLOOR` accounts is refused at the tick, before the prover, for good and in plain words ("Post it
  again with a lower boost or no boost"); a post with no boost is never refused by it, and a boost whose tree holds the
  whole crowd narrows nothing, so it is not refused even when a plain post already took the crowd under the floor (the
  launch preview then asks for the acknowledgement). The narrowing is recorded before the post is queued, so a failed
  write queues nothing.
- **The default.** The composer defaults to the HIGHEST offered tier (the spec), which narrows that post's crowd from the
  whole anon tree to that tier. The highest held tier that is under the floor, when it ranks above every offered one, is
  said in words: "Not enough accounts are in the 100k+ tier yet, so your posts are boosted as 10k+."
- **The head start is For You only** (`lib/reach/boost.ts`). The label "posted by an account with 10k+ followers" names
  the tier, never the account. It shows only when the row's tree is a reach tree this client knows, its issuer is
  honoured by key, the recorded tree size is at least the client's floor and, for an epoch whose census the client
  holds, that census agrees with the recorded size; otherwise the card is plain anon. The label shows wherever the anon
  card shows, Following included. Only on For You does a labelled card sort as if it were newer by 1 hour (1k+), 2 hours
  (10k+) or 4 hours (100k+), below the demote, pin and quiet keys of the final sort; Following gets no head start. On
  every surface a tie between two anon cards breaks on the cast hash, so their order is the same on every device; any
  other tie keeps the order it came in.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The reach issuer (co-hosted with the device, A-ATT-ISSUER-COHOSTED) | at issuance, fid → commitment, so who is in each tier | which anon post any member made |
| The validator operator, the relay and every reader | each anon post's tree, so its tier, and that tier's size at the post's epoch | which member of the tier wrote it |
| Neynar, when `fc.reach` reads live facts | a user lookup of the main account's fid at issuance | the commitment, any post |

**Assumptions, by id.**

- **A-REACH-ISSUER-SEES-MEMBERS** — the issuer sees fid → commitment at issuance, so it knows who is in each reach tree;
  it never learns which post. A launched persona's tier narrows it to that tier's crowd (A-LAUNCH-TIER-NARROWS, §26).
- **A-REACH-TREE-ON-EVERY-POST** — every anon post shows the tree it proved to the validator, the relay and every
  reader, so a boosted post's anonymity set is the tier, not the whole anon tree. The device budget no longer counts
  the anon tree as a partition, because "anon" names no persona.
- **A-REACH-ACTIVE-CROWD** — the floor counts accounts ISSUED into a tier, not accounts that actually post boosted, so
  the effective crowd of a boosted post in one window can be far below 50. Not measured.
- **A-REACH-LABEL-TRUSTS-TREE-SIZE** — for epochs the client never read, the label trusts the validator's recorded
  `tree_size`; the client cross-checks only the epochs whose census it holds.
- **THE BAND RULE (wave 3, L3).** The default is the highest tier offered, so a post at a lower tier comes from that
  tier's BAND (its members who hold no offered tier above it): 55 in gte-1k with 52 of them in gte-10k made every gte-1k
  post one of three accounts while both trees cleared the floor. A tier is now offered (and accepted by the validator,
  on the frozen epoch's sizes) only while it holds the floor AND leaves the floor in the band below it, the plain anon
  tree being the bottom rung. A launched persona's device-local crowd narrows to the band of each post made at its
  default tier, and a single reach crowd is only an upper bound in the launch preview.
- **A-REACH-BANDS-PER-ISSUER** — bands are judged within one issuer's chain (fc.reach, x.reach). A root holding tiers of
  both issuers defaults across them; the cross-issuer band is not judged. x.reach is fixture-only this wave.
- **A-REACH-BANDS-BY-SIZE** — the rule compares SIZES. When some reach members are not in the plain anon tree (it is the
  gate tier tree on a rig), the plain rung is under-counted and a tier can be withheld that would have been safe. It
  errs toward less, never more.

**Also stated.** Control of the main account is the device's own sealed sign-in record, read by a co-hosted issuer
(A-ATT-ISSUER-COHOSTED), not a fresh proof at issuance. A renewal can read as not yet held for one epoch, which refuses
the tier for that epoch (toward less, never more). A root that re-issues its zk identity is refused `fc.reach` for up
to 9 epochs, because the account stays bound to the old commitment until that issuance expires.

**D-REACH-ISSUER-HOST-ONLY (2026-10-12, the lead, at wave 2's close).** The reach issuers sign the tiers every reader's
label and For You order rely on, so they run only on a host Layers runs. In the public site's browser device the issuer
key would be the visitor's own: the open registry is first-come (A-ATT-OPEN-REGISTRY-COST), so the first visitor to
register `fc.reach` (or `x.reach`) on the public validator would squat that id, and could then issue themselves any
tier. So in the browser device both refuse before anything is sent: `issuerUnavailableHere` over `HOST_ONLY_ISSUERS`
(`lib/attest/registry.ts`) makes `ensureRegistered` answer `403 issuer_not_here` without asking the validator, and
`requestIssuance` (`lib/attest/subject.ts`) refuses before it registers, in plain words: "Reach tiers aren't available
on the public site yet: they need an issuer Layers runs, not one in your browser." Other issuers are unchanged, and the
owner service and the rig host the reach issuers server-side as before (A-ATT-ISSUER-COHOSTED). Reach tiers on the
public site therefore need an issuer Layers runs (a later step) as well as the browser prover (P7). Measured by
`scripts/unit-reach.mjs` check I3, with a mutation that drops the refusal.

**Measured by:** `scripts/unit-reach.mjs` (node-only, with a mutation for most guards; none yet for `x.reach`'s refusal
on live facts, the label's honour-by-key check or the held tiers' expiry), `scripts/accept-reach.mjs` (the
rig: 49 in a tier is never offered and 50 is; a refused tier is refused before anything is minted; K posts over
different trees use K slots, and a re-used slot under another tree is a replay; the label and the boost order follow
the rule, against rows forged into the database) and `validator/test/reach.test.js`.

## 26. Launch (Persona launch P6): a persona's own account, on test data

**Status (PERSONA LAUNCH P6, 2026-10-12): built, test data only, on the laptop rig, against a SIMULATED registrar.**
Nothing is created on Farcaster, nothing is spent ($0 rows only) and no network is called. On the public site it says
"Launch isn't on this preview yet." (anonymous proving in the browser comes first, P7); on the owner service's live
universe it says "Launch needs the Layers registrar, which isn't set up yet." (the owner's O1). The decisions are D3,
D5, D6 and D7 of `research/plan-persona-launch-2026-10-10.md`; its privacy rules R1 to R3, R7 and R9 are the controls
below.

**Controls.**

- **The launch request is anonymous** (R3; `lib/launch/request.ts`). It is proved as one launch per person per window
  (claim kind `persona-launch`) and sent over `/zk/anon/submit` at the constant 4,096-byte shape through the header
  allowlist; a submission carrying a device header is refused and queues nothing. It names only the persona's derived
  custody, recovery and signer keys, the chosen name and profile, and two EIP-712 signatures by the custody key
  (IdGateway Register, KeyGateway Add) whose deadline is quantized to a 7-day boundary at least 4 days after the click's
  day (wave 3, L8) — never the click time, nor its day, and the registrar refuses any other deadline. It
  never names the root, a device, a persona id or a sibling. `sha256("layers-launch-request/1|" + its canonical form)` is bound into the proof's
  message, so it cannot be swapped after proving. The validator queues it inside the nullifier's transaction: nothing
  is queued without its nullifier, and no nullifier is spent without its queue row, except a repeat for a custody the
  registrar already holds (queued, registered or owning an account), which is accepted with no new row (fix
  W2-LAUNCH-NO-ADOPTION; only that custody's key can sign it).
- **Nothing happens at the click** (`lib/launch/confirm.ts`). The request is built in memory; the pending launch rides
  the sealed `zkQueue` on that namespace's own deferred write, like an anon post's reveal secret, and that sealed record
  IS the launched account's record afterwards (fix LP-1: no separate account-map write at a launch step). The preview
  writes and fetches nothing: it joins this device's sealed reveal records to the own-rows mirror of the complete public
  anon list that every device's tick keeps (fix W2-LAUNCH-REVEAL-200: the newest-200 list it first read left older posts
  out), and a mirror that has not finished its first complete read refuses rather than show a partial list. Previewing
  and walking away leaves no trace. The typed confirmation (`@` and the handle; spaces trimmed, case ignored) comes after the no-undo sentence is on
  screen, and needs a preview opened in the last 30 minutes in this process.
- **The crowd, said before the confirm** (fix LP-4). After a launch anyone can join the persona's posts, and anyone who
  knows each post's tree and epoch can intersect those crowds (two crowds of 60 can overlap in a handful). The preview
  reports the intersection: exact where the device's own running count (§25, "The crowd across posts") covers every
  relayed post of the persona, or where there is a single public tree size; otherwise "at most N, possibly far fewer"
  (a post proved on another device of the root, or before the count was kept, makes it unknown). Below the floor, or
  unknown, the confirm needs an explicit acknowledgement of the preview's verdict, held in memory.
- **Registration timing** (R2; `validator/registrar.js`). Each request is due at a registrar batch moment inside
  [arrival + 2 h, arrival + 47.5 h], chosen uniformly with a CSPRNG. Batch moments are one a simulated day, 12 to 36
  hours apart, at an hour keyed by an HMAC of the validator's private signing key (the derived schedule key is never
  stored or served, so nobody outside the operator can predict a batch hour; the signing key itself sits in the
  database, `zk_validator_key`, so whoever holds a database snapshot can recompute the batch hours). With the device's jittered send, the account appears 2 to 48 hours
  after the click. No arrival hour is stored with the request (fix LP-6: a stored arrival hour beside the registered fid would have let a
  database snapshot join the click to the account); the due time comes from the arrival in memory. The launch's
  nullifier row keeps its 6-hour epoch, as every claim's does, but not beside the fid. The sim clock is the
  real clock plus its own offset; a rig walks it with dev hooks only.
- **The uniform reads** (`lib/launch/tick.ts`). On every tick every device that runs the test universe (the server
  device of the rig or of a service on test data), launch or not, makes the same two public reads over an isolated
  socket with no device headers: the registrar's registrations list (each account's custody, recovery, fid, hour and
  active signer keys) and the complete public anon list, paged. A browser device, where launch is not offered, and a
  live universe, where it is refused, make neither. A device looks for its own custody address and keys locally and
  never asks about one account to spot its registration (fix LP-1: a per-fid chain read at the moment of registration
  would have been the first read anyone made about that fid); after the reveal it does read per account (the thin
  relay's key check, the history and the R9 guard). Past the 48 hours promised a launch keeps watching rather than
  failing; once it has waited 72 hours after the registrar took it with no account, the owner may launch again, and the
  registrar takes a repeat for the same custody without a second row (fix W2-LAUNCH-NO-ADOPTION).
- **The Bundler call is simulated** (D6, R1; `validator/simchain.js`). One call per account: the registration to the
  persona's custody address with its recovery address, the persona's self-custody signer key added, one storage unit.
  The two EIP-712 signatures are verified as the contracts would. ONE registrar app fid (7,000,000 on the simulated
  chain) vouches every key, so "made by Layers" is the uniform fingerprint; the registrar refuses to register (at each
  batch with work due, and again in the Bundler call) if that fid equals `FC_TEST_FID`, `FC_ANON_FID` or
  `FC_CONNECT_APP_FID`. It is not a boot check: requests are still accepted and wait, so that misconfiguration stalls
  launches silently. The recovery address is a second root-derived key, so the registrar that pays can never seize an
  account. One $0 simulated spend row per batch that registered an account (`registrar_spend`, `usd_cents` always 0).
- **The batch reveal is all or nothing** (D7, R7; `lib/launch/reveal.ts`, `revealBatch`). Once the persona's key is on
  the account, the device reveals EVERY anon post that persona made, in one request signed by that registered key (up
  to 1,500 posts a request; more go as consecutive parts, fix W2-LAUNCH-REVEAL-200), and none of its siblings'. It waits
  up to a day for posts still being relayed; a post the channel or the validator refused was never posted, stays private
  and is reported as left out. The validator checks that the signature verifies and that the signer is an ACTIVE key of
  the fid on the simulated KeyRegistry, then, in one transaction, each secret against its row's commitment; the first
  account to reveal a row keeps it (a later batch from the same account re-stamps the row's batch). It stores the batch
  in `zk_reveal_batches` and its hash on every row (`zk_anon_casts.attributed_batch`).
- **The reader checks the chain** (`lib/fc/chain/*`, `lib/fc/personaFid.ts`). A card renders "revealed from @anon ·
  @fname" (checkable, `chain`) only when the signer is a registered key of that fid on the chain. Otherwise the
  own-device rule applies, else plain anon. A chain read that fails falls back to the same rule: on the launching
  device the card reads "anon · revealed as @name (inside Layers only)", and on every other device it is plain anon. A
  row forged straight into SQLite renders anon.
- **A single reveal may name only the persona that posted the cast** (a post from before P3, whose sealed record names
  no persona, keeps the old rule: any of the root's personas with its own account). A launched account never reveals one post at a
  time (fix UX-L2, D7): the single reveal refuses it before anything is signed or sent, and the reveal picker does not
  offer it.
- **Posting while a launch is pending** (fix UX-L1; `lib/zk/gate.ts`). From the confirm until the batch reveal lands,
  the composer says that an anonymous post as that persona will become public as its own with the rest, and the post is
  bound to what the line said: a post whose line and the launch state disagree is refused before anything is minted
  (409, nothing sent), and an unreadable launch state refuses rather than reads as "no launch". The no-undo sentence
  before the typed confirmation says the same.
- **R9's one exception** (`lib/fc/writes.ts`). A launched account may quote only its OWN revealed originals, at most 10.
  A sibling's anon post, an unrevealed own post and an 11th quote are refused (the count is the thin relay's in-memory
  log, so a restart resets it). The guard reads every row the launched
  account revealed, paged, and refuses when that read fails (fix W2-LAUNCH-SELFLINK-FAILOPEN: the newest-200 list alone
  let an older own post through as nobody's). The history is posted at the CURRENT
  time (D5): one launch cast linking the proof page, then the chosen quotes; inside Layers the profile shows the whole
  revealed history at the original dates, labelled "revealed from @anon", row by row only where a check passes: the
  chain check, or on the launching device the own-device rule.
- **After launch** (`lib/identity/postMode.ts`). The post mode is preset anon and the choice is required. `direct` posts
  go through the thin relay (`lib/fc/thinRelay.ts`), signed by the account's own key: a wrong key, a removed key, a bad
  signature or a timestamp more than 10 minutes from now (backdated or ahead) is refused.
- **The proof page** (`app/proof/[fid]`). The batch, the signer key, the signature and the key-registry check, computed
  from public reads only (the registrar's reveal batches, the public anon list and the simulated chain): rendering it mints no root, boots no
  device and reads no vault.
- **No live path exists anywhere.** The registrar is the owner's O1, the live key-registry read is F25, and the thin
  relay refuses live. `LAYERS_REGISTRAR_PRIVATE_KEY` is in `MUST_NOT_SHIP` on both halves, and nothing reads it this
  wave. (§29, a live registrar for the owner service written on 2026-10-17, is PARKED: none of it ships, so this
  bullet holds everywhere.)

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The validator operator (the registrar, this wave) | the request's public fields (custody, recovery and signer keys, name, profile) as it arrives, with no arrival hour stored; the batch it was registered in; the reveal batch, and the device's internet address on the reveal (A-LAUNCH-REVEAL-IP) | the root, which device asked, the persona id, the siblings |
| Farcaster hubs and other apps (once live) | the new account, its creation time, the registrar app fid that vouched its key, its launch cast and quotes | the root, the other personas, the main account |
| Everyone who reads the account | every anon post it revealed, with their dates, windows and reach tiers | the root's other anon posts |

**Assumptions, by id.**

- **A-LAUNCH-WINDOW-OCCUPANCY** — revealing a persona's posts shows which windows it posted in, and in those windows the
  root's other personas had fewer of the K slots left. The preview says so.
- **A-LAUNCH-REVEAL-IP** — the batch reveal POST and the per-tick registrations GET go direct, over an isolated socket
  with no identifying headers; the fname proof goes over the app's ordinary pooled connection. None goes through OHTTP.
  The operator sees the device's internet address on the reveal. The registrations read is the same on every device
  that runs the test universe, launch or not.
- **A-LAUNCH-ADD-METADATA-ORDER** — on the real chain the Add signature covers the registrar app's
  SignedKeyRequestMetadata, which the app must sign BEFORE the device signs Add. That needs a second anonymous round
  trip or a published vouch, and is not built. The simulated chain takes the app fid as one 32-byte word.
- **A-LAUNCH-BATCH-OF-ONE** — in a quiet week a batch holds one launch, and its registration time then narrows to that
  batch.
- **A-LAUNCH-DEADLINE-WEEK** — the custody signatures' deadline is public calldata forever. It names the click's 7-day
  stretch (not its day, since wave 3), so a batch whose 2–48 h window crosses a stretch's edge can be split in two by it.
- **A-LAUNCH-TIER-NARROWS** — the reach tier of the revealed posts tells everyone the launched account is in that tier's
  crowd. The preview says so.
- **A-LAUNCH-THIN-RELAY-CAP** — a launched account's writes are bounded by the network's per-fid limit (200 messages per
  storage unit per day), not by the managed-signer daily cap `FC_CASTS_PER_DAY`.

**Closed on the simulated chain only:** A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY (§14.1). The batch reveal is
signed by a key the simulated KeyRegistry lists for the account. On the real network it stays open until the live key
registry read (F25) exists.

**Rig-only instrument.** The laptop rig's `GET /dev/request-log` (the validator's last 2,000 requests, in memory, so the
suite can show that nothing naming the persona arrived before the confirm) runs only with dev hooks on and never on a
hosting platform, so the owner service, which runs the rig shape on Railway, never keeps it. It never keeps a reveal's
body, only its key names.

**Measured by:** `scripts/unit-launch.mjs` (node-only; it pins each deliberate duplicate, one side against the other),
`scripts/accept-launch.mjs` (the rig: nothing linked before the confirm, the click writes nothing, no device header on
the request, registration 2 to 48 hours after the click on the sim clock, every post of the persona revealed and none
of its sibling's, a forged reveal still renders anon, the post-launch rules, the proof page) and
`validator/test/registrar.test.js`.

## 27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees

**Status (PERSONA LAUNCH P7, 2026-10-13): built, test data only, not deployed.** Tested node-only
(`scripts/unit-prover.mjs`) and on the production shape (`scripts/accept-anon-prod.mjs`, against a throwaway
production-shaped validator whose crowd the suite writes straight into its database: 70 decoy registrations, over the
floor), never on a deployed site. A stranger's anonymous post on the public site is a TEST-UNIVERSE post: in that
universe the validator's row is the whole network (it reads as relayed at once), it stays inside the preview, every
card says so, and nothing a browser sends reaches Farcaster. The live universe is refused in the browser and again at the validator's
web route. §14, §14.1, §23, §24 and §25 still hold; this section is what P7 adds. How big the deployed public
validator's test crowd is has not been checked. PUBLIC GO-LIVE (2026-10-17, built, test data only, not deployed): strangers prove the plain tree `valid` (every registered browser identity) in this test universe, a fresh visitor is joined to it by the composer and hears when it can post, the edge's documented headers pass the web routes behind `TRUST_PROXY=true`, and the prover's source is served beside it (§5). The LIVE public tree, for posts that reach Farcaster, is a separate decision, D-PUBLIC-LIVE-TREE (§31).

**PUBLIC GO-LIVE (2026-10-17): what changes here, built and not deployed.** §31 adds the public @anon relay: the
validator's web door accepts a LIVE envelope from a browser only while the public relay (the agent path,
`validator/anonpublic.js` `liveWebDoorOpen`) is ready, never on the owner-service path and never unarmed, and a tab
proves in the live universe only while the app hints it (`ZK_ANON_UNIVERSE=live`) AND the validator's own config says
its relay is live. Unarmed, every refusal below holds word for word. The live crowd is the fid gate's (§31,
D-PUBLIC-LIVE-TREE), not every registered root. The pinned proving files now ship with the public app's build
(A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY, below), and the GPL source offer is published (A-GPL-SOURCE-OFFER, below, and §5).
In live mode (§32) the test universe is off in a tab, and at the validator's web door (ASM-2B): a test envelope's proof is a public hash anyone can compute and an attacker skips the tab, so validator/anon.js webEnvelopeUniverseOk refuses one before it is verified (nothing consumed, no row) once the validator is the live product (PUBLIC_LIVE on a public deployment; a misspelt value counts as live, since the public validator's container never runs the seed that refuses one) or its public relay is armed. The rig, the owner service and the unarmed preview are unchanged; a throw while reading those rules is a refusal (it used to fall into the body parse's catch and answer ok). PRIV-LIVE-2: a TAB's status read of a refused post never asks the validator for the refusal's reason (that read is device-signed and names the post's cast hash, so it would tell the validator which device sent the post it just refused); the only remaining reader of `/zk/anon-post/config?castHash=` is a server-side device (the owner service), and a tab shows the generic refusal line.

**What is built.**

- **One switch (D-ANON-SWITCH; `lib/zk/anon/availability.ts`).** Whether anonymous posting is on is decided in one
  function, for the gate (`lib/zk/gate.ts`) and the composer's route (`app/api/anon/route.ts`) alike. `ZK_ANON_POST=off`
  (an app variable) turns it off on the app's server and in every visitor's tab: `lib/device/deviceEnv.server.ts`
  forwards only `on` or `off` to the browser device, and any other value as `invalid`, which reads as off. In the browser device the server's reputation binding
  (`ADAPTER_REP`) is never asked: the live universe is off ("Anonymous posting to Farcaster isn't on this preview
  yet."), the test universe is on and preview-only, and a root whose commitment is not a leaf of the plain anon tree in
  the last check is off for now, and the composer says when it can post (D-PUBLIC-ANON-TREE, below); a leaf in a crowd still under the floor is off for now as well, saying how many people the crowd needs and has; a crowd no check has read yet is off too ("Checking whether you can
  post anonymously from here…", code `checking`: unknown is not yes; the composer runs one check at once), before
  anything is minted. On a
  server-side device (the rig, the owner service) the old rule holds: `ZK_ANON_POST=on` turns it on, and unset it is on
  only when `ADAPTER_REP=zk`. A public deployment's server holds no identity and answers off. Anything that cannot be
  read is off. The crowd sentence is advice; the guard is the prover's membership stage (`lib/zk/prove.ts`), which
  never proves for a commitment that is not a leaf.
- **What a stranger proves (D-PUBLIC-ANON-TREE, revised by PUBLIC GO-LIVE on 2026-10-17, for the test universe).** The plain tree `valid`: every browser identity registered on the site. Both public services run `ZK_ANON_POST_TREE=valid` (`.env.production.example`). The app forwards the value to every tab, checked against the tree-name grammar (`lib/device/deviceEnv.server.ts`; a malformed value goes as `invalid`, which the tab reads as off), and the tab compares it with the validator's own anon config on every check: if the two services name different trees, anonymous posting is off on the site, in plain words ("…the site and its server don't agree on which crowd posts come from."), because every proof would be refused there. Under `tier-2`, the old default, a fresh identity never had the reputation to be a member, so every stranger was refused. A visitor outside the crowd is joined to it by the composer's first read in the tab (one test-universe registration, signed by the tab's own device, active from the NEXT 6-hour epoch because the validator batches new members), and the composer names the clock time it can post from; a failed join is said. A member posts only while the crowd holds at least the client's floor (`ZK_ANON_FLOOR`, 50; the tab is never told a lower value, and a value that is not a number reads as 50, never as no floor); until then the composer says how many people the crowd needs and has, and the prover's cohort stage refuses below it either way. The plain tree keeps no validator floor (§25), so the client floor is the control. This is the PREVIEW universe: these posts stay inside the preview. The live public tree is D-PUBLIC-LIVE-TREE (§31, gated on a Farcaster sign-in). No reach tier is offered in the browser (D-REACH-ISSUER-HOST-ONLY, §25). The K slots of §23, the ring note of §24 and the reveal secret of §14.1 ride the post exactly as on a server-side device. The four copies of the tree's name (`lib/zk/config.ts`, `lib/zk/anon/availability.ts`, `validator/zk.js`, and the tab's, through `deviceEnv.server.ts`) are held together by `scripts/unit-prover.mjs` V2, V3 and E2 under every environment, and on a deployment by `scripts/smoke-deployed.mjs` check 10. Each copy trims the value, so a stray space in a deployment variable cannot split them.
- **The prover in a Web Worker** (`lib/zk/prover/browser-worker.ts`, built into `public/device/prover.js`; the bridge
  is `lib/zk/transport/browser.ts`). Every tab loads `prover.js` at boot (and, in the live universe, the proving
  files), whether or not it will prove, and starts each one-job worker from a Blob URL of those bytes, so no proof
  makes a request (L1: a load at proof time was a timed request to the app server per anonymous post). It posts each
  worker ONE job: the public inputs, the tree's members, this root's commitment and, for that one job, its secret
  scalar as a decimal string. That is a message inside the tab, never a request. The worker answers public values only
  and is terminated when it answers, fails or outlives its job's budget (30 seconds for a test proof, 5 minutes for a
  real one). A browser that cannot start a worker is refused in plain words; the proof never falls back to the page's
  own thread. For a real proof the tab hands the boot-loaded files (fetched only from this site's `/device/zk/`) to the
  worker in the job, and the worker refuses each unless its
  byte length, sha256 and blake2b-512 equal the pins bundled into `prover.js` (`lib/zk/ceremonyPins.ts`), never the
  served manifest's; the verification key is bundled as text and hashed against its pin before use; every proof is
  verified before it leaves the worker; and the worker makes no request at all: its own fetch refuses. snarkjs runs single-threaded there.
  Test proofs need no files. The browser device makes every proof this way, in both universes.
- **The web channel** (`lib/zk/anon/webChannel.ts`, the only module that sends anything for the anonymous path from a
  tab). Every request sets `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"`,
  `redirect: "error"` and no keepalive, and exactly one header, `content-type: text/plain;charset=UTF-8`, which keeps
  it a CORS simple request (no preflight, so the validator's allowed headers are unchanged). The body is exactly 4,096
  bytes, an allowlist of the envelope's fields (L2: no proving time or other timing rides it), and the proof of work rides the query string (`?pow=`). Plain http is refused except to a loopback host. The
  validator's web routes (`POST /zk/anon/web`, `GET /zk/anon/web/head`, `validator/anon.js`) tolerate exactly the
  headers a browser adds on its own (user-agent, origin, accept-language, priority, pragma, cache-control, dnt,
  sec-gpc, `sec-ch-ua*`, `sec-fetch-*`) and refuse a cookie, an authorization, a proxy-authorization, a referer or any
  `x-layers-*` header whatever else holds; proxy hop headers are tolerated only under `TRUST_PROXY=true`: `x-forwarded-*`, `x-real-ip`, `forwarded`, `via`, `x-request-id`, `x-request-start` and, since PUBLIC GO-LIVE, `x-railway-*` (Railway's edge adds `X-Railway-Edge` and `X-Railway-Request-Id`), except `x-railway-debug`, which a client sends and which is refused like a cookie. A body of any
  other size is malformed, and a live envelope is refused before it is verified or recorded, so it consumes nothing.
  Behind the door the path is the strict route's own: the same proof of work over the same bytes, the same
  verification, the same constant 256-byte answer after the same response floor, and nothing logged. The strict
  `/zk/anon/submit` route and the OHTTP gateway are unchanged.
- **OHTTP-ready.** With `ZK_RELAY=ohttp` the tab encapsulates the request itself (HPKE, `lib/zk/anon/ohttp.ts` and
  `bhttp.ts`), fetches the gateway's key configuration through the relay, and sends only ciphertext to the relay; the
  inner request is the strict channel's, exactly. The relay URL reaches the page only when it is https with no
  userinfo, query or fragment; without one the tab refuses, never falling back to direct. The relay must answer CORS
  for a browser (the test relay, `scripts/lib-ohttp-relay.mjs`, does). Tor stays refused. No third-party relay exists
  (the plan's O8), so the label stays DEMO.
- **Preview labels.** On the public deployment's test universe every anon card carries "Preview only · not on
  Farcaster" (`lib/feed.ts`, `components/CastCard.tsx`); the composer says "Preview only: your anonymous post stays
  inside this test preview. Nothing is posted to Farcaster."; an accepted post's status line says it stays inside the
  preview and is never posted to Farcaster.
- **What a tab cannot keep.** A post still waiting for its proof lives only in the open tab, and a post proved for a
  window that ends while the tab is closed is refused when the reopened tab sends it. Both are said in plain words
  (`components/AnonPostStatus.tsx`).
- **Where proofs are made, said in Settings › ZK privacy layer**: "Your proofs are made in this browser, in a separate
  background worker. Your secret never leaves this tab.", with how long the last one took.

**The bundle budget (D-PROVER-BUNDLE-BUDGET).** `scripts/build-device.mjs` fails the build when `device.js`, the bundle
every app page loads, is over 4,718,592 bytes (4.5 MiB; 4,264,079 before this pass) or carries any snarkjs or
ffjavascript marker string, or when `prover.js` is over 1,572,864 bytes (1.5 MiB). Built on 2026-10-13 (wave 3 final
verify): `device.js` 4,370,917 bytes, `prover.js` 441,369 bytes. Every app page fetches `prover.js` once at boot,
whether or not it will prove (L1: a fetch at proof time was a timed request per anonymous post). The proving files
(`semaphore-20.wasm`, 1,847,949 bytes, and `semaphore-20.zkey`, 3,890,175 bytes) are fetched at boot too, but only
in the live universe (a test proof needs none, so the public preview fetches nothing from `/device/zk/`), and the build copies them to `/device/zk/` only when they are present in `ZK_ARTIFACT_DIR` (default `.zk-artifacts`)
and match their pins; it downloads them only when a build asks with `ZK_ARTIFACT_FETCH=1` (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY). `prover.js` is GPL-3.0 and its distribution duty is §5.

**Phone proving time** is §6: measured on a desktop and on a throttled stand-in, not on a phone (1.41 s for one real
proof in the worker on a desktop; 6.6 s and 10.6 s on a page thread slowed 4× and 6×).

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The validator operator, under the direct relay | each submission's internet address, the browser's user-agent, client hints and accept-language, its time, a 4,096-byte body with the proof-of-work nonce in the URL, and the test-universe envelope inside it (proof, nullifier, text, tree, ring note, attribution commitment); and, from each visitor's first composer read, that browser identity's test commitment (a registration, at hour grain) | the root, the persona, the secret; which member of the tree sent a valid proof, given a crowd |
| The validator operator, under OHTTP | the relay's address and the strict channel's exact headers | the tab's address and browser headers |
| An OHTTP relay | the tab's address and browser headers, the time and the ciphertext's size | the content |
| The public app server | page views; nothing about the post (the browser device answers `/api/anon` and `/api/zk` in the tab: `accept-anon-prod` check 4 counts zero such requests reaching it) | the text, the proof, the secret |
| Farcaster and Neynar | nothing: no anonymous post from the public site is relayed to Farcaster | everything about it |

**Assumptions, by id.**

- **A-WEB-CHANNEL-DIRECT-UA** — under the direct relay the operator sees the visitor's internet address AND the
  browser's user-agent and client hints on every anonymous submission, and a page cannot choose the browser's
  connection pooling. The label stays DEMO under direct.
- **A-WEB-TAB-CLOSED-POST-EXPIRES** — a post still waiting for its proof lives only in the open tab; one proved for a
  window that ends while the tab is closed is EXPIRED on the device and never sent (wave 3, L7: sending it only handed
  the validator its words and arrival time for a refusal), and may be posted again. Both are said in plain words. Words
  the validator DID receive and refuse are refused on the device afterwards: posting them again would link the two.
  The drain loop restarts at every tick when a queued item is waiting (wave 3), and a reopened tab's re-jitter keeps a
  no-grace item inside its epoch.
- **A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY** — until the public go-live, `.zk-artifacts` was excluded from container
  images (`.dockerignore`) and never downloaded, so a deployed build shipped no proving files (its manifest said
  `present: false`) and a real proof in a browser refused plainly ("The proving files aren't on this site yet…"). The
  go-live build no longer excludes them from the app's image: the build checks them against their pins (bytes, sha256,
  blake2b-512) and copies them to `/device/zk/`; with `REQUIRE_ZK_ARTIFACTS=1` a build without them, or with an
  off-pin file, fails, and `ZK_ARTIFACT_FETCH=1` fetches them first from the pinned ceremony host when the upload did not
  carry them. They are public ceremony files. Test proofs need none. Every tab of a live site loads them at boot (about
  5.7 MB), whether or not it will post.
- **A-WEB-LIVE-REFUSAL-CLIENT-SIDE-UNDER-OHTTP** — the web route refuses live envelopes, but under OHTTP the gateway
  cannot tell a tab from a server device (that is what OHTTP is for), so there the tab's own refusal
  (`lib/zk/anon/submit.ts`) is what holds.
- **A-TEST-UNIVERSE-STRICT-ROUTE** — the ASM-2B refusal of test envelopes on a live or armed validator is the WEB door's.
  The strict /zk/anon/submit and the OHTTP gateway share classify() and do not apply it. Behind Railway's edge both are
  unreachable (the edge's hop headers refuse every strict or outer request), so on the deployed shape the web door is the
  only door; on a platform whose edge adds no header they would accept a forged test envelope on a live product.
- **A-WEB-PROXY-HOP-HEADERS** — updated by PUBLIC GO-LIVE (2026-10-17). Railway documents the headers its edge adds to every request (docs.railway.com/networking/public-networking/specs-and-limits, read 2026-10-17): `X-Real-IP`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Request-Start`, `X-Railway-Edge` and `X-Railway-Request-Id`. The two `X-Railway-*` names would have refused every browser submission on the public validator, so the web routes now accept the `x-railway-` prefix too. That is still only with `TRUST_PROXY=true`, and never logged or echoed (the routes log nothing and answer a constant shape). `x-railway-debug`, which a client sends, stays refused, as do cookie, authorization, proxy-authorization, referer and `x-layers-*`, whatever else holds. Any other edge header still refuses every web submission (fail closed). `TRUST_PROXY=true` is required on BOTH public services: without it on the validator, every browser's anonymous post is refused. The documented set is a test fixture (`validator/test/fixtures/railway-hop-headers.json`: documented, not recorded; X-Forwarded-For is not on Railway's page but is tolerated by the `x-forwarded-` prefix). `validator/test/anonweb.test.js` replays it: accepted behind the proxy, refused without it, refused with a cookie or a client's `x-railway-debug`, refused when the prefix is removed. What the real edge adds is checked on each deployment by `scripts/smoke-deployed.mjs` check 10 (a head read and a short POST through the edge must pass the header door; the same with a cookie must not). The rate limits behind the edge now key on the hop the edge vouches for: `X-Real-IP` (its right-most entry), else the right-most `X-Forwarded-For` entry, never the left-most entry a client writes. That is `validator/caps.js` edgeClientAddress for the validator's token bucket and new-identity cap, and `middleware.ts` for the app; `anonweb.test.js` proves on a loopback validator that a forged left-most entry cannot pick its own bucket. That trusts Railway to set `X-Real-IP` itself; a platform that passed a client's `X-Real-IP` through would hand the client its bucket again. The strict route has the same header exposure. The custody offers, the ring drop and the live-read relay key the same way.
- **A-WEB-FIRST-TICK** — before a tab's first check (about every 10 minutes on the public site) membership cannot be
  judged, so the composer offers the switch; a post from a root that is not in the crowd is then refused at the tick,
  never sent, and its status line says why.
- **A-GPL-SOURCE-OFFER** — resolved (PUBLIC GO-LIVE, 2026-10-17, the owner's decision J: publish): the site serves the prover's corresponding source at `/device/source/`, generated by every build; §5 lists what is served and what fails the build.
- **A-PUBLIC-ANON-JOIN-WAIT** — a fresh visitor's identity joins the crowd at the next 6-hour mark, so it waits up to 6 hours before its first anonymous post, and the composer says until when. A refused join is retried at most every 30 seconds and said in plain words.
- **A-PUBLIC-ANON-JOIN-ON-READ** — the join happens at the composer's first read, for every visitor whose composer opens, not when someone posts, so a registration says nothing about who posts anonymously. What it does tell the validator is what any registration tells it: this browser identity holds this commitment, from that hour (the ZK pass's root-to-commitment residual).
- **A-PUBLIC-ANON-CROWD-IS-IDENTITIES** — the floor counts registered browser identities, not people. In the test universe anyone can make many identities (one per browser profile, up to `VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY` per address, 100 by default), so one person could fill the crowd to 50 alone. How many the deployed site's crowd holds has not been checked, and a fresh deployment starts at none. The stakes are a preview: these posts never reach Farcaster.

**Decisions.** D-ANON-SWITCH, D-PUBLIC-ANON-TREE (revised for the test universe by PUBLIC GO-LIVE: `valid`, with the join) and D-PROVER-BUNDLE-BUDGET, above; the live public tree is D-PUBLIC-LIVE-TREE (§31); recorded with the plan's decisions
in `research/plan-persona-launch-2026-10-10.md`.

**Measured by:** `scripts/unit-prover.mjs` (node-only, with a mutation for every guard: the channel's request, relay
selection, the availability matrix, the test core's parity with the validator, a real Groth16 proof from the pinned
files and the refusal of tampered files, the worker bridge, a real HPKE round trip through the test OHTTP relay, the
web route's guards, the build budget), `scripts/accept-anon-prod.mjs` (the production shape: the two bundles and the
license file, a stranger outside the crowd refused with nothing minted, a stranger in the crowd posting from the worker
over exactly one web request, no secret in any request or log, the preview label on the card, the live universe
refused, the doors, the phone stand-in) and `validator/test/anonweb.test.js`. PUBLIC GO-LIVE adds: `scripts/unit-prover.mjs` V3, V4 and E2 (the tree's four copies, the floor, the join's words), A1 (Railway's headers, x-railway-debug), G1 to G9 (the source offer, the rate-limit key) and U1 (the route's join); `validator/test/anonweb.test.js` RAILWAY and RATE KEY; `scripts/accept-anon-prod.mjs` checks 2 and 2b (the join, the first window under the floor) on the production shape; and `scripts/smoke-deployed.mjs` checks 10 and 11 against each deployment.

## 28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport

**Status (PERSONA LAUNCH P8, 2026-10-13): built, test data only; deployed to the owner service on 2026-10-13, not to
the public site.** No Layers account on X exists and no X developer billing is set up (the plan's O4). (§30, a live X
transport for the owner service written on 2026-10-17, is PARKED: none of it ships, so what follows holds everywhere.)
The only transport is a fixture that writes a row (`x_fixture_posts`);
the outbox module imports no socket, http or fetch and names no X API host, and `scripts/accept-x-outbox.mjs` check 8
runs the whole path under a network guard. It is offered only on a server-side device (the rig, the owner service)
where anonymous posting is on, in the test universe; not in the public site's browser device (D-X-PUBLIC-OFF). The
plan is §2.6 and P8 of `research/plan-persona-launch-2026-10-10.md`. §23 and §25 still hold.

**What is built.**

- **The toggle** (`components/XOutboxToggle.tsx`). "Also post to @layers on X — test data: nothing reaches X", shown
  only while "Post anonymously" is ticked and works here; never pre-ticked; unticked when "Post anonymously" is unticked
  or when the device answers that copies are not offered. Before it can be ticked it says: "A copy on X has the same
  words: if you launch this persona, it will read as yours too. Posts to X are never revealed by a launch. A moderator
  reads it before anything goes out." The copy is requested only after its anonymous post was accepted.
- **The claim** (`x-anon-post`; `lib/zk/gate.ts` `requestXAnonPost` and `proveXAnonPost`, `validator/zk.js`). The same
  proof as an anonymous post, over the PLAIN anon tree (a copy is never boosted), under its own scope
  `x-anon-post/w<n>/s<i>` with i < K_X, so an X nullifier never equals an anon-post nullifier. The signal carries the
  constant "anon"; the message binds `x:<xHash>`, where `xHash = sha256("layers-x-anon/1|" + nonce + "|" + text)`,
  never the copied post's cast hash; the payload is exactly `{text, nonce}`. Every refusal (availability, the universe,
  the browser device, the persona, the text policy, the X slots, the daily cap as the last tick read it) comes before
  anything is minted or written. The tick proves the copy from its own snapshot with a uniform free X slot and queues
  it with its own jitter, never batched with its Farcaster sibling, and it leaves over the anonymous channel with no
  device envelope. Which persona sent it and which anon post it copies ride only the sealed X record on the device.
- **The X slots (D-X-SLOTS).** One copy per person per window by default (`ZK_X_ANON_POST_SLOTS`, an integer from 1 to
  4, set the same on the app and the validator), shared across that root's personas and apart from the anon-post
  slots: a used X slot never stops a Farcaster anon post. The device picks with its own K_X and only compares the one
  the validator serves.
- **The text policy** (`lib/x/outbox/policy.ts` and `validator/xoutbox.js`, a deliberate duplicate pair that the unit
  harness holds byte-equal on one corpus). The owner's rule for a public anonymous account: X suspends an account that
  posts spam, and an article goes out as a quote and a link, never in full. At most 280 weighted characters (X's own
  count: a link weighs 23); at most one link, written in full with https://; beside a link, 1 to 200 of the poster's
  own characters; no @mention (a mention from a shared account reads as spam, and is a public edge from it); at most
  two hashtags; one paragraph; no control characters; and, at the validator, no repeat of a text from the last 7 days.
- **Moderation before anything posts** (`validator/xoutbox.js`; migration 26 adds `x_outbox`, `x_outbox_decisions`,
  `x_outbox_moderators` and `x_fixture_posts`). The validator queues a copy inside the nullifier's transaction, as
  `review`: nothing is queued without its nullifier, and no nullifier is spent without its row. Only a moderator's
  signed decision moves it to `approved` or `rejected`, and the relay posts approved rows only. A moderator is a PUBLIC
  Ed25519 key listed in `X_OUTBOX_MODERATORS`; its private half is the HKDF branch `layers/x-moderator/1` of the
  owner's vault key, on the owner's device, and Settings › Layers on X shows the public half to copy. On a rig only
  (`ZK_DEV_HOOKS`) a dev route registers one. No moderator configured means nothing is ever approved (fail closed),
  and the validator stays keyless. Every decision is kept signed, a signature is accepted once, and a posted or failed
  row cannot be decided again. A rejected copy is kept and hidden: its text is never shown again.
- **The relay.** Approved rows wait for the next relay slot (`X_OUTBOX_RELAY_INTERVAL_MS`, an hour) and then a CSPRNG
  moment inside `X_OUTBOX_RELAY_SPREAD_MS` (30 minutes on the public shape, 0 elsewhere), in random order, through the
  fixture transport only (a post id `xfix_` + sha256). `X_OUTBOX_DAILY_CAP` (default 50) bounds both the copies the
  outbox takes and the posts it makes in a day.
- **What is public.** `GET /x/outbox` lists each copy's id, status and hour, and its text and fixture post id only once
  posted; `GET /x/outbox/config` serves K_X, the daily cap and its use. The moderator's signed `GET /x/outbox/review`
  lists the texts waiting for a decision.
- **Settings.** Settings lists, under Layers on X, "Layers on X: anonymous posts (test data)" (the queue's counts, this
  device's copies and where each one is, and the moderator section) and the DM inbox, "DM a tweet to @layers to save
  it (test data: no DM is read from X yet)." (`lib/x/inbox.ts` `inboxStatus()`); the DM hook page adds "Test data: no
  DM is read from X yet." Neither is listed on the public site.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The moderator (the owner) and the operator's database | every copy's text, rejected ones included (kept and hidden), its hour and its status; the decisions, each signed by a moderator's key | who wrote a copy, which persona, which anon post it copies |
| Everyone reading the public list | each copy's id, status and hour, and its text once posted | who wrote it |
| X, once a live transport exists (not built) | the @layers account's posts | who submitted one |
| Anyone comparing texts | that a copy and the Farcaster anon post with the same words came from the same person (A-X-COPY-LINKED-BY-WORDS) | which persona, until a launch reveals the Farcaster post |

**Assumptions, by id.**

- **A-X-COPY-LINKED-BY-WORDS** — an X copy has the same words as its Farcaster sibling, so anyone can pair the two. If
  the persona is launched, the sibling is revealed and the copy reads as the persona's. The copy's tree is folded into
  the persona's crowd count (`lib/zk/gate.ts` `proveXAnonPost`, the device-local intersection the launch preview reads),
  and the toggle says this before it can be ticked. A standalone X post, with no Farcaster sibling, is not folded.
- **A-X-SLOT-INDEX-VISIBLE** — the X slot index rides the wire, as the anon-post slot does (A-ANON-SLOT-INDEX-VISIBLE,
  §23). At K_X = 1 it is always 0.
- **A-X-MODERATOR-SEES-TEXT** — the moderator, and the operator's database, hold every copy's text, rejected ones
  included (kept and hidden). Neither ever learns who wrote one. The moderator's review read lists the last 7 days'
  not-approved copies, so one can be approved after all; every decision is signed with a fresh nonce (moderate/2), so a
  corrective decision in the same hour is never refused as a replay (wave 3).
- **Wave 3, the outbox's answers.** A copy is offered only where the outbox has a moderator (none: nothing would ever go
  out). Repeated words are a REFUSAL (400), never a replay: a replay holds the person's X slot, a refusal frees it. The
  view of one's own copies is scoped like every own-data view (compartment mode shows the active persona's alone).
- **A-X-FIXTURE-ROWS-ON-PUBLIC** — test proofs can be forged, so anyone can push rows into the public validator's test
  outbox. They stay in review forever (no moderator is configured there), at most 50 a day.

**Decisions.**

- **D-X-SLOTS** — K_X = 1 per person per window on both sides (`ZK_X_ANON_POST_SLOTS`, 1 to 4), under its own scope
  feature, so an X nullifier never equals an anon-post nullifier. A daily cap of 50 for both copies taken and posts made
  (`X_OUTBOX_DAILY_CAP`). An hourly relay slot (`X_OUTBOX_RELAY_INTERVAL_MS`) with a random spread
  (`X_OUTBOX_RELAY_SPREAD_MS`: 30 minutes on the public shape, 0 elsewhere).
- **D-X-COPY-UNATTRIBUTED** — a launch never reveals an X copy. It carries no reveal secret, no attribution commitment
  and no ring note.
- **D-X-PUBLIC-OFF** — not offered in the public site's browser device this wave (the toggle, the route and the tick's
  read). The public validator mounts the routes but has no moderator, so nothing is ever approved there.

**Measured by:** `scripts/unit-x-outbox.mjs` (node-only, with a mutation for every guard: the policy on both sides, the
hash, scope and message, the claim binding on the real validator, the refusals before any mint, the tick, the queue,
moderation, migration 26, the source rules, the constant request size), `scripts/accept-x-outbox.mjs` (the rig: the
toggle, a copy into review, no moderation means no post, approve and reject, one X slot a window, the policy at both
ends, nothing leaving the machine, the operator's view, Settings, the resets) and `validator/test/xoutbox.test.js`.

## 29. The live Layers registrar on the owner service (parked)

**Status (2026-10-17): PARKED. Nothing of it is in the build.** The stopped go-live run wrote a live Layers registrar for
the owner's private service (a wallet the service makes and seals, a registrar app fid, real `Bundler.register` calls
under dollar caps, a live key read and a thin relay to a Farcaster hub). The owner then redirected the go-live to the
public site ("the public site is the product"; no new owner-only flows), so the code was taken out of the tree and kept
as a patch outside the repository (the session scratchpad's `parked-registrar.patch`; this section's full earlier text,
and that of `notes/runbooks/GO-LIVE-FARCASTER.md` (l), are in `parked-registrar-docs.patch`, whose §29/§30 hunk is shared with
`parked-xlive-docs.patch`). Migration 27 (`launch_registrar_live`) is reserved for it and never applied; no deployed service ever
ran any of it, and no variable it read is set anywhere. §26 holds unchanged: launch runs on the simulated registrar on
every site, and the public site refuses live launches. To revive it: apply the patch, re-run its suites, re-review it
against §26, and restore this section's text from the patch; the section number stays.

## 30. Live posting to @layers on X from the owner service (parked)

**Status (2026-10-17): PARKED. Nothing of it is in the build.** The stopped go-live run wrote a live X transport for the
owner's private service (OAuth 1.0a posting of moderator-approved outbox copies, an on-demand DM read, dollar caps and a
sending ledger). With the go-live redirected to the public site it was taken out of the tree and kept as a patch outside
the repository (the session scratchpad's `parked-xlive.patch`; this section's full earlier text, and that of
`notes/runbooks/GO-LIVE-FARCASTER.md` (m), are in `parked-xlive-docs.patch`).
Migration 28 (`x_live`) is reserved for it and never applied; nothing has ever been posted to X. §28 holds unchanged:
the outbox's only transport is the fixture, and the public site does not offer it (D-X-PUBLIC-OFF). The must-not-ship
names the run added for it (`X_LAYERS_API_KEY`, `X_LAYERS_API_SECRET`, `X_LAYERS_ACCESS_TOKEN`,
`X_LAYERS_ACCESS_SECRET`, `X_LIVE`, `X_LIVE_REPLIES`, and for §29 `REGISTRAR_LIVE`, `REGISTRAR_WINDOW`) stay on both
lists: a public process that carries one still refuses to boot. To revive it: apply the patch, re-run its suites,
re-review it against §28, and restore this section's text from the patch; the section number stays.

## 31. The public @anon relay (Public go-live)

**Status (PUBLIC GO-LIVE, 2026-10-17): built and tested against stand-ins (a loopback stand-in for Neynar, a stand-in
chain and hub, throwaway validators on the test machine), armed only by the owner, not deployed, never run live.** The
owner's direction that day made the public site the product: persona posts reach Farcaster through ONE public anonymous
account, and the safety that has to exist before strangers post publicly ships with it. The code is
`validator/anonpublic.js` (mounted by one line in `validator/server.js`), `validator/anon-filter.js`, migration 29
(`anon_public_safety`), `lib/zk/anon/*` (the filter's tab copy, moderation, the Farcaster join, the universe the composer's
route reads) and the owner's one command, `scripts/owner/arm-public-anon.ps1` (`notes/runbooks/GO-LIVE-TODAY.md` step 3). §14, §14.1,
§20, §23, §24 and §27 still hold; this section is what going live adds.

**What is built.**

- **One relay credential on the public validator, and only there.** The public validator may hold exactly one write
  credential: the agent signer of a Neynar app that holds nothing else (`FC_ANON_FID`, `FC_ANON_SIGNER_UUID`,
  `FC_ANON_NEYNAR_KEY`), behind its own switch (`ZK_ANON_RELAY_LIVE=on`) and an explicit lifetime cap
  (`ZK_ANON_POST_LIVE_CAP`, required on this path: unset, the relay refuses to arm; at most 1,000,000). Every other write
  credential stays refused on a public process (§16's must-not-ship list: `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`,
  `ENABLE_FC_WRITE`, ...), and the relay refuses to arm when one of them sits beside the agent key. The public APP refuses
  the agent's key and signer outright: the app server stays keyless, and the only process that ever posts is the
  validator's relay. This is the one exception to a keyless public server, and it is the existing one (the anon relay
  was always the validator's). The owner-service path (`NEYNAR_API_KEY` + `ENABLE_FC_WRITE`, §20) is unchanged word for
  word.
- **The transport seam.** Neynar is the only transport built (the signer check, `POST /v2/farcaster/cast` to publish,
  `DELETE /v2/farcaster/cast` for a takedown). `ZK_ANON_TRANSPORT=hub`, posting through a Farcaster hub of Layers' own
  (`FC_HUB_URL`), is named and refused in plain words ("not built yet"): the relay stays off rather than guessing.
- **The fid gate (D-PUBLIC-LIVE-TREE).** On the public shape the LIVE crowd ("valid") is one commitment per Farcaster
  account, joined with a verified Sign in with Farcaster: the device presents the signed sign-in message with its
  commitment and a salt; the message's nonce must bind that commitment and salt (so a relay or app that saw the signed
  message cannot join a different commitment with it), its domain must be the site's (`APP_URL`, which the validator now
  reads too), it must be fresh (issued within the last 10 minutes) and unused (a replay set in memory), and it must be
  signed by the account's custody address or one of its auth addresses, read keylessly from Optimism (`ANON_FID_RPC_URL`,
  default a public node, chain id checked) or, for custody, a Farcaster hub (`FC_HUB_URL`). A smart-contract wallet's
  signature is refused in plain words. A newer sign-in replaces the account's commitment from the next 6-hour window, so
  a lost passkey is not a lockout; one commitment belongs to one account. A new member is a leaf from the NEXT window,
  and the client's floor (`ZK_ANON_FLOOR`, 50) counts only this crowd, so posting opens when 50 Farcaster-verified people
  have joined, and each person's first post waits for the window after they join. Joins are budgeted at 20 an hour per
  address, in memory.
- **The automatic text filter** (`validator/anon-filter.js`, and word for word in the tab, so the plain words show before
  the click). It runs on a verified post before anything is stored and before the slot is spent (a refused post costs
  nothing), and catches the obvious only: a short list of unambiguous slurs (stored as salted hash prefixes, so the
  repository carries no slur text), phone numbers, email addresses, street addresses, and scam links (a wallet or
  Farcaster brand joined to an airdrop or claim word, plus `ANON_FILTER_SCAM_DOMAINS` on the validator). A refusal is
  logged as its rule and the hour, never the text and never who sent it.
- **Reports.** A Report button on every @anon card sends the post and a reason from a fixed list (spam, harassment,
  hate, doxxing, violence, illegal, scam, other) and nothing else: no reporter, no note. Twelve reports an hour per
  address, counted in memory only.
- **The takedown queue.** Moderators are `ANON_MODERATORS` on the validator: Ed25519 PUBLIC keys whose private half is
  derived on the owner's own browser device from his identity's vault key (its own HKDF branch,
  `layers/anon-moderator/1`) and shown in Settings › Moderation. The key is the identity's, not the device's: every
  device that unlocks or links that identity derives the same key (a linked device receives the vault key), so a lost
  device that held the identity is answered with a NEW identity's key in `ANON_MODERATORS` alone
  (`notes/runbooks/GO-LIVE-TODAY.md` step 9). A moderator's signed read lists the reported posts; a signed REMOVE hides the post in
  Layers at once (the row is KEPT, with the hour it was hidden: hide, never delete) and, in the live universe, deletes it
  from Farcaster through the agent's signer, tried at most five times; an outcome that cannot be confirmed is shown as
  such, never as removed. A signed KEEP dismisses the reports so far. Removed is final. A post removed before its relay slot is
  never relayed.
- **The owner's one command** (`scripts/owner/arm-public-anon.ps1`, in the `scripts/owner/lib/OwnerCommon.ps1` style:
  `-WhatIf`, hidden prompts, typed confirmations, idempotent, `-Disarm`). Before it asks for anything it checks the
  deployed site is ready for strangers: `/terms` answers, the pinned proving files are shipped, the fid gate is deployed
  and on, the anon tree is `valid`, and it prints the live crowd as "N of 50". It refuses an app that holds an agent
  secret and a validator that holds a second write credential; takes the signer uuid and the agent-only key at hidden
  prompts (shape-checked; the key's fingerprint compared in memory with the public site's read key and the owner's local
  keys), behind a typed `THIRD`; asks Neynar (`scripts/owner/check-public-anon.mjs`, the key on its stdin) whether the
  signer is approved for exactly that fid and whether the profile names Layers; and, behind a typed `ANON`, sets the
  validator (the credential on stdin and read back, `FC_ANON_FID`, `ANON_MODERATORS`, the caps `ZK_ANON_POST_DAILY_CAP`
  500 and `ZK_ANON_POST_LIVE_CAP` 20 by default, the switch last), redeploys it once, sets `ZK_ANON_UNIVERSE=live` on
  the app, redeploys it once, and verifies the relay is ready on the agent path, the moderator listed and the fid gate on
  the site's domain. `-FirstCast` (a typed `ANON`) watches the first post the owner makes from `/anon` reach the network
  (only once the crowd has 50); `-RaiseCap N` (a typed `RAISE`) only raises; `-Disarm` deletes the key, the signer and
  the switch from the validator and redeploys it (posts already on Farcaster stay).
- **Posting rules and the kill switches.** A post leaves the validator exactly once, at a 30-minute relay slot with a
  30-minute spread, under the agent's fid; a hidden (removed) row is never relayed. The caps are counted inside the
  insert's own transaction: 500 a day (`ZK_ANON_POST_DAILY_CAP`), K=4 per person per 6 hours (§23) and the lifetime
  cap. The public app refuses the agent's signer and key at boot (`lib/platform/env-contract.ts` `APP_ONLY_REFUSES`).
  Two kill switches: `ZK_ANON_POST=off` on the app (every tab stops offering anonymous posting) and
  `arm-public-anon.ps1 -Disarm` (the key, the signer and the switch leave the validator). A removal made while the relay
  is disarmed hides the post at once and waits (`waiting`) to be deleted from Farcaster until the relay is armed again.
- **The terms** (`/terms`), linked from the anon page's header always and from the composer while anonymous posting
  is open to the visitor (not before the crowd reaches the floor): what the anonymous account is for, what is removed
  and how to report. The owner reads and approves them before the first live post (`notes/runbooks/GO-LIVE-TODAY.md` step 6).
- **Live only when both halves say so.** The app tells every tab that the site's anonymous posts are live
  (`ZK_ANON_UNIVERSE=live` on the app, set by the arm script once the validator's relay is armed; the tab then proves in
  the live universe and loads the pinned proving files at boot, every tab alike, whether or not it will post), and the
  tab believes it only while the validator's own config, read on its tick, says its relay is live. Either half missing
  keeps today's words. In live mode (§32) the test universe is off for anonymous posting, so an unarmed live site says
  "Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously right now."; a preview
  without live mode keeps §27 unchanged ("Preview only · not on Farcaster").
- **What the site says.** The composer's route renders where a post goes in one set of sentences shared by the route,
  the composer, the anon page and the suites (`lib/zk/anon/universe.ts`): live, "This post goes to Farcaster from the
  shared @anon account. Anyone on Farcaster or in Layers can read it, and it names no one unless you choose to reveal it
  later.", and after the send, "Sent to @anon. It appears on Farcaster within about 75 minutes, at a random moment, so its
  time doesn't point to you." A signed-out tab hears "To post anonymously to Farcaster, sign in with Farcaster on this
  device first. The anonymous crowd counts one person per Farcaster account, and it never shows which one posted."

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| Everyone on Farcaster | each relayed post, from the one @anon account, at its relay slot | who wrote it, which persona, whether two posts share a writer |
| Neynar (runs the agent account) | every relayed post's text and time, every takedown | who wrote it (A-FID-NEYNAR-SEES-ALL, narrowed to one app that holds nothing else) |
| The Layers operator (the public validator) | which Farcaster account joined the crowd, with which commitment, and the joining request's address (R6); every post's text and hour, each post's reports and reasons, every moderator decision; each anonymous post's address and browser while no outside relay exists (§27) | from the proof alone: which member wrote which post, which persona, who reported (the address is A-ANON-PAGE-SAME-ADDRESS) |
| A moderator | the reported posts' text and their reasons | who wrote or reported them |

**Review fixes (PUBLIC GO-LIVE, 2026-10-18).** ASM-1: on the fid-gated public shape a live anon post may prove only the
gated plain tree, which must also be the configured anon tree; anything else (a self-issued reach tree) is refused 400
`gated-tree` before the binding and before the nullifier is consumed, the live config serves `reachIssuers: []` and
`liveTreeOnly: true`, and `POST /zk/issuers` refuses `fc.reach` and `x.reach` in the live universe. ASM-2: the share page
`/anon/p/<hash>` reads only the live universe on a live site (a test-universe post is a 404 there). ASM-2C: a moderator
can name the universe of a pasted hash, signed into the decision. ASM-3: a relay that is not ready (switch off or key
revoked) marks waiting live posts `failed` at boot and at every slot, so re-arming publishes nothing that waited. ASM-4:
removals need only the credential: `-Disarm` deletes only `ZK_ANON_RELAY_LIVE` (removals still reach Farcaster), and
`-Disarm -RevokeKey` (a leaked key) deletes the key and the signer too (removals then wait); `public-status` says which
(`relay.deletesReady`). ASM-5: a leave signed by the crowd identity drops its leaf from the next epoch. PRIV-LIVE-3: the
join is sent only after the sign-in is sealed. PRIV-LIVE-5: inside the Farcaster phone app the anon page says the host
runs the page and knows the account, with an "Open in browser" button.

**Assumptions, by id.**

- **A-ANON-RELAY-KEY-ON-THE-PUBLIC-VALIDATOR** — the agent's key sits on a process strangers reach. A compromise of the
  public validator can post as @anon, up to the lifetime cap, until the owner rotates the key at Neynar and disarms. The
  key reaches Railway on stdin only (the arm script), is never printed, and the app process refuses to hold it.
- **A-ANON-FID-GATE-JOIN-LINK** — the validator learns fid -> commitment at join (and the join's address and hour), as the
  plan's R6 says of every issuer. PRIV-LIVE-1: the commitment is a DEDICATED crowd identity (`lib/zk/anon/fcJoin.ts`,
  derived from the zk master on its own branch), never the root's registered commitment, so no table ties the fid to a
  root; from the proof alone it never learns who posted. A Farcaster account is one member however many identities it
  signs in from.
- **A-ANON-PAGE-SAME-ADDRESS** — PRIV-LIVE-4: the join, the posts and the reports reach the validator from the visitor's
  one address while `ZK_RELAY` is direct (no outside relay yet), so the operator could match them by address and hour.
  The anon page and the report button say so in plain words, and posting from a different network than the one the
  visitor signed in on avoids it.
- **A-ANON-LEAVE-REPLAY** — a leave (`POST /zk/anon/fid-leave`, ASM-5) is signed for this hour or the last and carries no
  nonce, so a captured leave could be replayed within about an hour of a rejoin with the same crowd commitment.
- **A-ANON-LEAVE-AT-REVOCATION** — ASM-5: a live root revocation sends the crowd's leave first (the crowd commitment is
  never registered, so a root revocation cannot reach it). The leave and the revocation reach the validator together,
  from one address, so the operator can tie that one crowd commitment, and its fid, to the root at revocation time: the
  same address join as A-ANON-PAGE-SAME-ADDRESS, made once more.
- **A-ANON-FID-GATE-CHAIN-READ** — whether an address controls an account is read from a public Optimism node (or a hub)
  the operator chooses; a lying node could admit an address that does not control the account. Chain id 10 is checked.
- **A-ANON-FILTER-IS-SHALLOW** — the filter catches the obvious and nothing subtler; everything else rests on reports and
  the owner's takedowns. A takedown removes the post from Farcaster through the agent, but cannot recall copies others
  made or clients that already cached it.
- **A-ANON-MODERATOR-IS-VISIBLE** — the moderator keys are public (the validator lists them), and the operator sees the
  address a moderator reads and decides from. The moderator key is its own branch of the owner's root, so it links to no
  other key the owner holds.
- **A-ANON-MAIN-APP-MAY-HIDE-IT** — Farcaster's new owner moderates its own app; it may hide or limit an anonymous account
  there. Posts stay on the network and show in Layers.
- **A-ANON-NEYNAR-FUTURE** — the only built transport is Neynar's, whose API future after the Network School acquisition is
  unannounced; the hub path is named, not built.

**Measured by:** `validator/test/anonpublic.test.js`, `scripts/unit-anon-relay.mjs` (node-only, a loopback Neynar stand-in,
one mutation per guard), the armed section of `scripts/accept-anon-prod.mjs`, `scripts/owner/test/cases-public-anon.mjs`
(the arm script), and `scripts/smoke-deployed.mjs` check 14 (the deployed relay's armed state, no post).

## 32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks

**Status (PUBLIC GO-LIVE, 2026-10-17): built, test data only.** It has run on the production-shaped local pair with the
Sign in with Farcaster stub (`scripts/accept-onboard-prod.mjs`), never on the deployed site; statuses stay "fixture"
until the owner walks it there. §16 (custody), §21 (Sign in with Farcaster) and §22 (Bring your X) still hold; this
section is what live mode and the guided first run add.

**The switch.** `PUBLIC_LIVE=true` on the public app (and its validator) turns public live mode on
(`lib/platform/publicLive.ts`). `"false"`, empty or unset is off; any other value refuses boot by name and length only (a
typo must never leave the demo world showing on a site its owner believes is live). A rig-shaped process ignores it and
says so. The app forwards `PUBLIC_LIVE=on` to each tab only while the server itself is live; a page script can set it in
its own tab, which only hides that tab's own demo world (A-LIVE-HINT-IS-PAGE-SETTABLE).

**What live mode changes, and what it never does.** The server-rendered right rail reads the empty twin of the fixture
bank. In the tab the device runs the empty world (section 18's partition, run in the browser): the bank is not loaded,
no demo seeder runs, every stored row that names a persona this device's keystore did not mint is hidden, kept verbatim
and merged back into every write, and the state read is fail-closed. Nothing is deleted: a validator database that
already holds the demo world keeps it byte for byte (validator/seed.js seeds nothing new and refuses `--force` under the
flag). No starter personas are minted; the acting persona is never the read-only public self. In live mode the
anonymous TEST universe is off in a tab (§31): a live product posts no test data, so until the owner arms the public
@anon the composer says anonymous posting isn't switched on for this site yet.

**The guided first run** (`/welcome`): Welcome, Sign in with Farcaster (section 21), Save with Face ID (passkey; the 24
words stay an optional backup on Your device), X, the first persona. Its progress is DERIVED from what the device already
holds (the public self, the saved ways in, the personas) plus what was skipped in this document; nothing about the flow
is written anywhere, so the validator sees no new namespace name and no "onboarding finished" bit. A returning visitor
(restored from this browser, or unlocked) who already has a persona never sees the flow. A saved identity without a
persona skips the welcome screen, and a step whose fact is already met (signed in, saved) does not come up. The flow's
own route (`/api/onboarding`) is answered in the visitor's tab; a request that reaches a public server is refused
before anything is read.

**Before the phone's app switch.** On a phone, Sign in with Farcaster opens the Farcaster app and the browser may reload
the tab. Before the request starts (so before any deep link exists) the identity is kept in this browser: IndexedDB,
under a non-extractable key (section 16). The card says so in one sentence first. A keep that fails stops the sign-in.

**No third-party avatars.** A persona's default picture is drawn on the device (`lib/identity/localAvatar.ts`, an inline
data URI): no image host learns a handle. The public self's picture is the relay's, held behind the tap-to-load rule;
in the app's own chrome (the account button, the phone drawer, the composer) a picture from a host outside the
held-media list is drawn on the device instead (`components/CastCard.tsx` `chromeAvatarSrc`), so signing in never makes
the chrome fetch from the host that Farcaster account chose.

**The X step.** The signed-in account's Farcaster-verified X handle is looked up in the WHOLE keyless index the device
downloads (`lib/onboarding/xHandle.ts`); the account number never leaves the tab and is never resolved through the read
relay. The step is a third trigger of A-X-INDEX-FETCH-IS-A-PAGE-VIEW (only when signed in). An index that is not built,
or a failed download, says "couldn't check here", never "no X account".

| Party | Learns | Never learns |
|---|---|---|
| The public app server | page views of `/welcome` (and `/welcome?from=anon`, the anon page's click-through) by address and time | any identity fact; the flow's answers are the tab's |
| The validator | what section 21 and section 16 already say (the padded accountLinks write, the passkey method); the whole-index download | which step a visitor is on, that a step was skipped, which X account matched |
| Farcaster's sign-in relay, the chain node | section 21, unchanged | anything else |
| Image hosts | nothing from a persona's picture | the handle |

The Farcaster sign-in, when it happens after the public @anon is armed, also joins the live crowd: that join is §31's
(A-ANON-FID-GATE-JOIN-LINK).

**Where a link sends you (F5).** The guided run's explicit target rides the URL's hash (`/welcome#farcaster`, `#next`,
`#unlock`), which the browser never sends, so the server's request log never learns which step a visitor jumped to;
`?step=` is honoured for hand-typed links.

**Assumptions, by id.**
- **A-ONBOARD-PAGE-VIEWS** — `/welcome?from=anon` tells the app server's log that an address came from the anon page.
- **A-ONBOARD-SIWF-SESSION-IS-MEMORY-ONLY** — the identity survives a phone reload during the app switch; the pending
  sign-in request does not, so it must be started again.
- **A-ONBOARD-KEEP-IS-THIS-BROWSER** — the keep before the deep link holds the identity in this browser only; clearing
  site data loses it; a passkey keeps it beyond.
- **A-ONBOARD-DEMO-ROWS-STAY-STORED** — hidden, never deleted: the operator still holds the old preview rows.
- **A-LIVE-HINT-IS-PAGE-SETTABLE** — see the switch above; it grants nothing.
- **A-LIVE-MODE-IS-PRESENTATION** — live mode hides demo rows in each tab; it does not delete them, and a tab running an
  old bundle could still show them until it reloads.
- **A-ONBOARDING-SKIPS-ARE-SEEN-BY-NOBODY** — a skipped step lives in the open document only; after a reload it comes
  back once. Nothing records that a visitor skipped saving, so nothing can nag or count it either.
- **A-X-STEP-NEEDS-THE-LIST** — with `VALIDATOR_X_INDEX` off, the X step can only say it could not check; turning it on
  makes the validator read a beta Farcaster endpoint nightly (§22).

**Measured by:** `scripts/unit-onboarding.mjs` (node only; 10 checks and 12 mutations), `scripts/accept-onboard-prod.mjs`
(production shape, desktop + Pixel 5 + iPhone, the SIWF stub, a closed network), and `scripts/smoke-deployed.mjs` check
16.

## 33. The native anon page and the Farcaster Mini App (Public go-live)

**Status (PUBLIC GO-LIVE, 2026-10-17): built, tested against stand-ins (`scripts/unit-miniapp.mjs` node-only,
`scripts/accept-anon-page-prod.mjs` on the production shape, `scripts/owner/test/cases-miniapp.mjs` for the arm
script), not deployed; the Mini App is not signed for any domain and has never opened inside Farcaster.** The owner
asked for an anoncast-style door that Farcaster users can use without the rest of Layers, with a page of its own and a
click-through to the Layers client. §31 is the relay underneath; this section is what the door adds.

**What is built.**

- **The anon page (`/anon`, `app/anon/AnonApp.tsx`, `components/anon/*`).** Outside the app's chrome, one column,
  mobile first. It boots the same browser device as `/device`, makes a light ROOT with no persona (the root's commitment
  is the crowd's leaf), signs in with Farcaster through the same verified flow as everywhere (a QR on a computer, "Open in
  the Farcaster app" on a phone, after keeping the identity in this browser first), and posts as that root (`postAs:
  "root"`) through the composer's route: proved in the tab's worker, sent over the web channel, relayed from @anon under
  §31's caps, filter, Report button and terms. Before the first request it says who sees what, in the page's own words.
  The server that renders it holds no key and hears nothing about a post.
- **The share page (`/anon/p/<hash>`).** A server page that reads the validator's public one-post read (no viewer, no
  header that names one) and prints the Mini App embed. A post that was taken down or never existed is a 404, a
  validator it cannot read is said in plain words (never "not found"), a test post is labelled "Preview only · not on
  Farcaster", and a "View on Farcaster" link appears only for the Farcaster web client's own hosts.
- **The Mini App manifest (`/.well-known/farcaster.json`, `lib/miniapp/manifest.ts`).** Built from `APP_URL` and three
  PUBLIC app variables (`MINIAPP_ACCOUNT_ASSOCIATION_HEADER`, `_PAYLOAD`, `_SIGNATURE`), checked against the Mini App
  schema the Farcaster clients use (`@farcaster/miniapp-core` 0.6.0, read 2026-10-17). Unsigned, or signed for another
  domain, it is served WITHOUT the association and the server's log says why: Farcaster refuses an unsigned app, and a
  manifest that looked signed would be a lie. The owner signs it in the Farcaster app's developer tools and runs
  `scripts/owner/arm-miniapp.ps1` (a typed `SIGN`; the domain must equal the site's host exactly, or nothing changes;
  `-Disarm` makes it unsigned again).
- **The embed.** The anon page and each share page print `fc:miniapp` (and the older `fc:frame`), so a cast that links
  them shows a "Post anonymously" button that opens the page inside Farcaster.
- **The SDK, bundled and inert outside a client (`lib/miniapp/sdk.ts`).** The official `@farcaster/miniapp-sdk` at a
  pinned version (0.3.0), compiled into the page's own chunks, so the page fetches nothing from a third party. It is not
  even evaluated unless the page could be inside a client (framed, or in a WebView), and nothing else is called until the
  host confirms it. Inside Farcaster the sign-in goes through the SDK's own sign-in over the device's nonce, and the
  device verifies the signature and the chain itself, never trusting the host's answer as sent; the host-reported
  username and picture only name the account. Without the package the page works as an ordinary web page.
- **The one framing exception (`middleware.ts`).** `/anon` and `/anon/p/<hash>`, and only these, may be framed, and only
  by the Farcaster web client's origins (the Mini App opens in an iframe on the web); their content security policy
  allows scripts, styles and fonts from the site only, images from the site and the app's own media hosts (the list
  the Layers app loads pictures from directly, `lib/miniapp/manifest.ts` `ANON_MEDIA_HOSTS`, because Open Layers
  continues the Layers session in this same document), and connections to the site, its validator and the sign-in
  services the page names. Every other document stays unframeable, `/home` and `/welcome` included.
- **Open Layers.** On the site, a soft move to `/welcome?from=anon` in the same document, so the root and the sign-in
  come along. Inside a Mini App, Layers opens in the browser, which keeps separate storage; the page says so ("Layers
  opens in your browser, where you sign in again: what you did here stays inside Farcaster.").
- **Share.** Composing a cast that links a post, from the sharer's own account, after the page says what it costs
  ("Sharing posts this from your own Farcaster account. If you share a post you just wrote, people may guess it was
  you.").

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The Farcaster client hosting the Mini App | that its user opened Layers Anon, the sign-in it asked them to approve, a cast they chose to share | the cross-origin WEB client: the proof, which post was theirs. A native phone host runs the page itself (A-MINIAPP-PHONE-HOST-RUNS-THE-PAGE) |
| The Mini App's owner account | named in public as the Mini App's maker (the signature) | anything about its users |
| The Layers operator | what §31 says, plus the share page's reads (which post was viewed, from which address) | who wrote a post |
| A cast's readers, on a Share | that the sharer chose to share that post | who wrote it, unless the sharer wrote it moments before (the page warns) |

**Assumptions, by id.**

- **A-MINIAPP-PHONE-HOST-RUNS-THE-PAGE** — PRIV-LIVE-5: inside the Farcaster phone app the page runs in the host's
  WebView, which knows the account and could read what is typed into the composer. `/anon` says so above the sign-in and
  the composer, with an "Open in browser" button that opens the page outside the host.
- **A-MINIAPP-HOST-SEES-THE-OPEN** — inside Farcaster, the client knows its user opened the Mini App and when; a post made
  right after an open narrows the crowd for anyone who can see both, the client first.
- **A-MINIAPP-FRAME-ORIGINS** — the Farcaster web client's framing origins are a list in code; the specification names
  none. The first real run inside Farcaster on the web confirms it (VERIFY-YOURSELF), and a new origin is added by name.
- **A-MINIAPP-SDK-SHIPPED** — the page ships a third-party package (the Mini App SDK, pinned) to every visitor of `/anon`;
  it is inert outside a Farcaster client, but its code is Farcaster's.
- **A-MINIAPP-OWNER-NAMED** — the signing account is public as the Mini App's maker; signing with the owner's main
  account names him as the person behind Layers Anon.
- **A-SHARE-POINTS-AT-THE-SHARER** — a Share posts from the sharer's own account; sharing one's own fresh post can give
  it away.
- **A-MINIAPP-SDK-POSTS-TO-PARENT** — the SDK talks to its host with `postMessage` to `window.parent` with target origin
  `"*"` (comlink's default) and listens to messages from any origin. What keeps that parent a Farcaster client is
  `frame-ancestors` (only the Farcaster web origins may frame `/anon`); on a phone the host is the Farcaster app's own
  WebView. Nothing the host answers is trusted as sent: a sign-in is verified by its signature and the chain, the host's
  username and picture only name the account, and `ready()`, `composeCast` and `openUrl` carry no secret.
- **A-MINIAPP-NO-XFO** — `/anon` and `/anon/p/<hash>` carry no X-Frame-Options (it cannot name an allowed framer, and DENY
  would block the Mini App where a browser honours it). A browser without CSP level 2 `frame-ancestors` could frame them
  from anywhere; every current browser enforces it. Every other document keeps both headers.
- **A-ANON-PAGE-INLINE-SCRIPT** — the page's policy allows `'unsafe-inline'` scripts (Next's inline bootstrap) and
  `'wasm-unsafe-eval'` (the prover's WebAssembly): it stops third-party script, font and connection loads, and images from
  any host outside the app's media hosts, not an injected inline script; the page renders no visitor HTML (a post is a text node). A browser without
  `'wasm-unsafe-eval'` (Safari before 16) refuses a real proof under this policy, and the post fails closed with the
  prover's plain error.
- **A-MINIAPP-SIGNIN-DIFF** — signing in from inside a Farcaster client uses the device's Mini App steps
  (`lib/fc/siwf/flow.ts` startMiniAppSiwf / finishMiniAppSiwf, and the `miniappStart` / `miniappFinish` actions of
  `app/api/fc/siwf/route.ts`): the host's signed answer goes through the same verification and record as a relay
  completion. A build without them says "Signing in from inside Farcaster isn't ready on this site yet. Open this page in
  your browser to sign in."
- **A-MINIAPP-READY-BEFORE-BOOT** — `ready()` (which hides Farcaster's splash) is called once the page has drawn its first
  screen, before the browser device has finished booting, so the splash never waits on the 5 MB download; the page
  shows its own "Starting…" line.
- **A-ANON-PAGE-JOIN-AT-OPEN** — on the test preview the page's first read joins this browser's root to the test crowd
  (the same uniform join the Layers composer makes on every visit, §27), whether or not the visitor signs in or posts.
- **A-SHARE-PAGE-READS** — `/anon/p/<hash>` is rendered by the app server, which reads the validator's one-post read for
  it (live first, then the test universe): the operator learns that the post was viewed, as a page request, never who
  wrote it.

**Measured by:**
- `scripts/unit-miniapp.mjs`: 30 checks and 23 mutations, covering the manifest schema rules, the association's domain
  rule, the embeds, the images, the middleware framing, the route, the SDK's inertness, the share page and a Mini App
  sign-in against the device's own verifier.
- `scripts/accept-anon-page-prod.mjs`: P1–P11 on the production shape, including real-browser framing and zero
  third-party requests, plus B1, the live armed path against relay's Neynar stub.
- `scripts/owner/test/cases-miniapp.mjs`: 9 cases.
- `scripts/smoke-deployed.mjs` check 15.

## 34. The hub route for @anon (no Neynar)

Built on test data only: no real @anon post has gone out this way yet (`validator/hubmessage.js`,
`validator/anonpublic.js` transport `hub`, `scripts/owner/make-anon-account.mjs`, `scripts/owner/check-hub-signer.mjs`).

- **Keys.** The account's custody key (secp256k1) and signer key (Ed25519) are made on the owner's laptop and saved in
  `%USERPROFILE%\.totem-anon\anon-account.json` with owner-only permissions; neither is ever printed. The custody key never
  leaves the laptop. The signer key is the hub transport's one relay credential, on the PUBLIC validator only
  (`FC_ANON_SIGNER_KEY`); the public app refuses it at boot, and a Neynar key beside it counts as two credentials and the
  relay refuses to arm. Whoever controls the validator can post as @anon, as with the Neynar key before it. A leaked signer
  key is removed with `KeyRegistry.remove` from the custody; that is not automated.
- **Spending.** The account script reads the live price, refuses a total over its cap ($10 by default), sends nothing
  until the owner types CONFIRM, and saves each signed transaction before broadcasting it, so a re-run re-sends the same
  bytes and cannot pay twice.
- **Fail closed.** Before posting, the relay checks the key is an active signer of the fid on the hub. A submit the hub
  refuses keeps the post pending and then marks it failed after six slots; the hub's words show in
  `/zk/anon/public-status` and `arm-public-anon.ps1 -Status`, never dropped silently. A hub that cannot be read is said in
  plain words on the anon page, never shown as "no posts".
- **What it does not hide.** The hub operator sees each post as it arrives, from the validator's address (public a moment
  later anyway). The custody address and its funding (a Coinbase withdrawal) are onchain and tie @anon to the owner by
  design: @anon is the site's account. A retry signs the same timestamp only until a redeploy clears that memory, so a
  redeploy mid-retry could post a cast twice.

## 35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees

**Status (2026-11-05): deployed and switched on; the first real approval is not done yet.** Totem's app account
(@ontotem, fid 3358029) has been armed on the live public validator since 2026-11-05: its `GET /fc/app-account`
answered `ready: true`, `sponsored: false` (read 2026-11-05). No real key request has been approved and no real cast,
like, recast or reply has been posted this way yet, so "working" is not claimed. Every test runs against loopback stubs:
`scripts/lib/farcaster-api-stub.mjs` (Farcaster's signed key request API) and `scripts/lib/farcaster-protocol-stub.mjs`
(a Snapchain node and the chain it reads). The owner's first real approval and post on ontotem.com is the test that turns
this into "working". The hub-card writes and acting as yourself, below, are built on test data only and not deployed.

**What it is.** A signed-in visitor (Sign in with Farcaster, §21) can press "Allow Totem to post as you". Their browser
makes a fresh Ed25519 key, seals it in their own vault, and asks Farcaster to add it to their account; they approve in
the Farcaster app; from then on the Post box posts as their own account (casts, replies, likes, recasts and deletes are
built; the Post box offers casts and deletes; the cards read from a Farcaster node, §36, offer replies, likes, recasts,
their undo, and Delete on the root's own casts). No Neynar, no managed signer, no server-held key. The code:
`lib/fc/rootSigner/{flow,store,config,copy}.ts`, `lib/fc/hub/message.ts`, `app/api/fc/root/route.ts`,
`components/root/RootPost.tsx`, `validator/keyrequest.js`, `validator/eip712.js`.

**Keys.**

- **The visitor's posting key** (Ed25519) is random, made in the tab, and sealed in the `rootSigner` vault namespace
  (one record, padded to exactly 1,024 ciphertext bytes, with or without a key; every root seals the empty record at
  boot, so the namespace's presence carries no bit). The validator holds ciphertext only. It is NOT derived from the
  seed and shares no derivation with any persona key, so posting as the root can never use or reveal a persona's key;
  the root's messages are signed inside `lib/fc/rootSigner/store.ts` and nothing else reads the private half. It is
  sealed BEFORE the validator hears of it, so an approval can never land for a key the device lost. A doctored record
  (its public key not its private key's) is refused, never posted with. An unsaved identity loses the key with the tab
  (the key stays active on the account until removed in the Farcaster app).
- **Totem's app account** (the `requestFid` that every SignedKeyRequest names; named **@ontotem**) has its own custody
  key, made by `scripts/owner/make-app-account.mjs` on the owner's laptop and kept in
  `%USERPROFILE%\.totem-app\app-account.json`. Its registration is paid by the @anonwire custody
  (`IdGateway.registerFor`, about $0.20); no ETH moves between the wallets. Besides that file, the custody key goes to
  the PUBLIC validator only (`FC_APP_CUSTODY_KEY`, set by `scripts/owner/arm-app-account.ps1`); the public app refuses it
  at boot (`APP_ONLY_REFUSES`). **The validator uses it to sign key requests and nothing else**: the validator holds no
  signer of any account, so whoever holds the validator's key cannot post as any visitor, and a key request is useless
  without the visitor's own approval in the Farcaster app. (As the fid's custody, the key could ADD a signer of its own
  to the app account and so post as @ontotem; it can never add one to a visitor's account.)
- **The app account's profile key** (2026-11-05) is the app account's ONE signer: a fresh Ed25519 key made by the same
  run and kept in the same state file (`profileKey`), added with `KeyGateway.addFor` (the app custody signs a
  SignedKeyRequest for its own fid and the EIP-712 `Add` message; the @anonwire custody sends it and pays the gas, under
  a tenth of a cent). It exists because the Farcaster app's approval screen shows the requesting app's profile: it
  signed that profile, the name @ontotem (the fname itself is registered with the custody's UserNameProof), the display
  name "Totem", the bio "ontotem.com" and the picture, so approving reads as approving Totem, not a number. **It stays
  on the owner's laptop**: no script puts it on a server, and `arm-app-account.ps1` reads only the custody key from the
  file (the owner harness checks that the profile key is set, sent and shown nowhere). **It can** post, reply, react and
  change the profile AS @ontotem. **It cannot** touch any visitor: each visitor's posting key is the visitor's own,
  added to the visitor's account by the visitor's approval, and the profile key is a signer of the app fid only; nor can
  it sign key requests (that is the custody's EIP-712 signature, not a signer's) or move the fid. **To remove it**:
  `KeyRegistry.remove(key)` from the app custody, or `KeyRegistry.removeFor` signed by the app custody and sent by any
  wallet (not automated; the key's public half is in the state file and the run's output). The nodes then drop every
  message it signed, so the profile goes with it, and a removed key can never be added to that fid again. A bare
  account without it: `make-app-account.ps1 -NoProfile`.
- **Rotation.** A leaked app custody key lets its holder attribute new keys to Totem, add a signer of its own and post
  as @ontotem (and, as the custody, transfer or recover the app fid). Rotate by making a new app account
  (`make-app-account.ps1` with a new state file and a new name) and arming it with `arm-app-account.ps1 -Replace`; keys
  already approved keep working (an approval binds the visitor's key to the visitor's account, not to the app's
  custody). A leaked profile key alone posts as @ontotem and nothing more: remove it as above, then a new profile key
  (not automated). Moving the app fid itself to a fresh custody is `IdRegistry.transfer` and is not automated.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| Totem's validator (the operator) | the public key of every key request, the time and the visitor's internet address; while the browser waits, each poll's state and, once approved, the account number (`userFid`); every message it relays (casts, deletes, likes, recasts: public moments later anyway) with the address and time | the private key, the root, the personas, which vault holds the key |
| Farcaster's API (`api.farcaster.xyz`) | the public key, Totem's app fid, the request's deadline and signature, from the VALIDATOR's address (the browser never calls it); then, from the visitor's Farcaster app, who approved | the visitor's internet address via Totem, the root, anything Totem holds |
| The onchain KeyRegistry (everyone) | that account M added a key requested by Totem's app fid, and when: **using Totem becomes a public fact about M** | which Totem identity or persona M has |
| The Snapchain node the tab reads (`snap.farcaster.xyz:3381` by default) | the visitor's internet address asking whether account M lists key K (once per check), and, through the validator's relay, each message (the same node also serves a signed-in visitor's Following: §36) | the root, the personas |
| The Totem public app server | nothing: the route runs in the tab and refuses any server with `404 device_only` before reading the body | everything here |

**On hub cards (2026-11-05; built, test data only, not deployed).** A card read from a Farcaster node (§36) replies,
likes, recasts, undoes either, and deletes the root's own cast, through the same device route (`/api/fc/root`, answered
in the tab) and the same relay. From these writes the validator learns which Farcaster post the root acted on (the
target's fid and hash are in the signed bytes) with the visitor's address and the time, as for any root post: public on
the network moments later anyway. The node receives each message from the validator's address, not the browser's.
Totem's app server learns nothing (the route runs in the tab); Neynar nothing; everyone else sees a public like, recast
or reply by the root's account, at that time. To show which cards are already pressed, the tab reads the root's own
newest 200 likes and 200 recasts from the node, naming only the root's fid (§36, A-HUBREAD-REACTIONS-WINDOW). A card is
pressed only after the node accepted the message; a refusal is a sentence on the card with the node's words.

**Acting as yourself (2026-11-05; built, test data only, not deployed).** On the live site the visitor's own account is
a switch target: "You" in the account menu (the phone drawer too) makes NO persona the tab's acting identity
(`lib/device/actingRoot.ts`): the device jar's persona cookie goes and a marker keeps boot from naming one again during
the tab's life (the jar is tab memory: a reload starts over on the first persona, the safe direction, and the menu says
so). While the root acts, Following is the hub's, the composer is the root's (posting as yourself, or the Allow panel),
and hub cards like, recast and reply. The acting-persona resolver answers the public self, never the first persona an
empty jar used to fall back to, and the device's request host splits every write (the same rule for a visitor with no
persona at all, the default path, since personas are optional):

- **The root's own writes go through, keyed to the root or its public self exactly as before** (`ROOT_WRITES` in
  `lib/device/actingRoot.ts`), across all three dials. Who I am: post as you and the hub reads, sign-in, switching to
  or making a persona, the first run, custody, the crowd's account-level membership, the chrome's scope. The anoncast
  foundation: the root's anonymous post (`/api/anon` with `postAs: "root"`, whose proof is the root's crowd membership
  and names no persona), leaving the crowd, a reveal naming the root's own account, the root's reach tiers, an @anon
  report, a moderator's decision. What I see: modes, rules, lenses, zones, readwise, delivery tiers, feed health,
  algorithm previews, imports and exports, filter-pack exports, unified search, subscribing to a curator desk. Your own
  data: the X archive import, its cold storage and Find your people, the backpack import (sealed in the root's vault).
  Who sees me: rings ("works with zero personas").
- **Persona actions are refused** (`409 NO_ACTING_PERSONA`, one sentence, before the route runs): anything that
  publishes, or acts toward other people or a network, AS a persona, or writes a persona-linked record the validator can
  see. Casting, reacting, following, act-as, blocking, Farcaster writes and persona accounts, crossposts, stakes,
  refutations, strikes, votes, private posts, disclosure grants, forks, launches, the market, rooms, channels, folders,
  publishing an algorithm, the X outbox and account links, signers, the graph's consent and connectors, persona
  bindings; also, by the same test, sending a post to someone (`feed-health/send`: it acts toward them as a persona)
  and connecting an attestation issuer (`attestations`: bound to the acting identity on the validator). Two routes are
  split by their body: an `/api/anon` post that names a persona, or names no `postAs` (the route would pick a default
  posting persona), and a reveal naming a persona, are persona actions; drafting or signing a curator desk's annotation
  is publishing, while subscribing to a desk is not.

Why the split: refusing every write while no persona acted (this guard's first version) took the root's own dials
away from the default path, which contradicts the principle that personas are optional; refusing nothing would let a
route quietly act as some default persona. The test is whether the write speaks AS a persona, so neither happens.
`scripts/unit-acting-root.mjs` AR2 classifies every write route the device serves against its own copy of the split
(a route moved either way, or an unclassified new one, fails it), and `scripts/accept-hub-read-prod.mjs` HR18 and HR19
show a mode, a rule, a ring and an X import working with no persona and as You, and a persona cast refused;
`scripts/accept-anon-page-prod.mjs` in the live shape shows the root's anonymous post going through. Choosing a persona again names it and the root goes quiet:
the separation guards re-check the jar as each read and write leaves, so one already queued stops (one already in flight
at the relay completes). What each party sees does not change: the validator, the node, the app server and Neynar see
exactly what this section and §36 already list for the root's reads and writes, and nothing while a persona acts. What
acting as yourself adds is the CHOICE of when the root is active, so A-HUBREAD-PERSONA-SEPARATION (a), the timing
residual, now applies to the moments the visitor switches: the node and the relay see the root's browser go quiet, then
a persona post through Totem's server, as before. `scripts/unit-acting-root.mjs` (AR1–AR5, 18 mutations, each caught)
and `scripts/accept-hub-read-prod.mjs` HR17–HR19.

**Fail closed, never silent.** The key is enabled only when the account that approved it IS the signed-in account (an
approval from another account in the visitor's Farcaster app is refused and the key forgotten) AND the node the tab
reads lists it as an active signer of that account; a node that never lists it is refused after five minutes. The
device checks the validator's answer too: its own key, the app fid the validator publishes, a deadline in the future and
at most a day away, and an approval link on the Farcaster app's own scheme or hosts; anything else is refused and no link
is shown. A post the node refuses is an error with the node's own words, never a silent drop.

**Disconnect** forgets the key on this identity (the sealed record keeps only its public half) and says how to remove
it: in the Farcaster app, Settings, Connected apps. **Only that stops the key**: a copy of the vault from before the
disconnect, opened with the seed, still holds it. (Snapchain's newer `KEY_REMOVE` message can revoke a key by its own
signature; it is not used here until it is verified on mainnet.)

**Who pays to add the key.** The Farcaster app sends the transaction that adds it. Farcaster's documentation says an app
"can sponsor a signer so that the user doesn't need to pay" when the app is signed up in the Farcaster app with at least
100 warps; Totem's app account has a profile (@ontotem) but is not signed up there, so the visitor's Farcaster app may
ask the VISITOR for the network fee, and the panel says so before the request. The gas itself is under a tenth of a
cent on OP Mainnet; whatever the Farcaster app charges on top is its own and is not published. Sponsorship is built
behind `FC_APP_SPONSOR=on` for when the app account is signed up.

**Assumptions, by id.**

- **A-ROOTPOST-SAME-ADDRESS** — the key request, the polls and every relayed post reach the validator from the
  visitor's one address, and so do their anonymous posts while no outside relay exists (A-ANON-PAGE-SAME-ADDRESS). The
  operator can therefore match an anonymous post to the visitor's own account by address and hour, and every root post
  gives it a fresh match. The panel says so before the first request ("post those from another network if you want them
  kept apart").
- **A-ROOTPOST-PUBLIC-USE** — adding the key publishes, onchain, that account M uses Totem. The anonymous crowd is
  everyone who signed in, so this narrows nothing the crowd did not already show, but it is public and permanent.
- **A-ROOTPOST-NODE-HONEST** — the tab trusts the node it reads to say whether the key is listed; a lying node can at
  worst enable a key the network refuses (every post then fails loudly) or keep a good key off.
- **A-ROOTPOST-MAIN-APP-HIDES** — since Network School's "social contract", the main Farcaster app hides new posts
  from accounts that have not accepted its rules; the composer says so. Other Farcaster apps show them.
- **A-ROOTPOST-APPROVAL-IN-APP** — unverified until the first real run: that the Farcaster app still opens
  `farcaster://signed-key-request` links (and their QR codes) and approves requests from an app account that is not
  signed up in it, and that its approval screen shows the app account's published profile (@ontotem, "Totem", the
  picture) rather than its number. The profile is published by `make-app-account.ps1`; what the app does with it is
  not.
- **A-APPACCOUNT-PROFILE-KEY-LAPTOP** — the profile key sits in the owner's state file beside the custody key,
  protected by that file's owner-only permissions and nothing else: whoever reads the file can post as @ontotem (and,
  with the custody key, more). It never posts for a visitor.
- **A-APPACCOUNT-PFP-HOSTED** — the picture is a URL (default `https://ontotem.com/brand/totem.png`, `-PfpUrl`); the
  protocol holds the URL, not the image, so until that file is served the profile shows no picture.
- **A-ROOTPOST-CORS** — the public node answered browser reads with `Access-Control-Allow-Origin: *` on 2026-11-05 and
  refuses browser submits (`OPTIONS` 404, `Content-Type` must be `application/octet-stream`), hence the validator's relay.
- **A-ROOTPOST-BORROWED-REQUEST** — `POST /fc/key-request` signs a request for ANY usable public key, and the approval
  link goes to whoever asked. Someone can therefore make a request for a key THEY hold and send the link (or its QR) to
  someone else: if that person approves it in the Farcaster app, believing it is their own Totem connection, the
  sender's key can post as them, straight to the network, past every check in this tab. This is inherent to a
  self-custodied key (the key is made where the visitor is, so the request cannot be tied to a session the validator
  trusts), and the Farcaster app's own approval screen is the defence. What narrows it here: a request lives 15 minutes
  by default (`FC_KEY_REQUEST_TTL_SEC`), six per address an hour, and the panel tells visitors to approve only a request
  they started on ontotem.com. The fix, if it is abused: remove the key in the Farcaster app (Settings, Connected apps).
- **A-ROOTPOST-RELAY-CAPS** — the relay's per-account day (500 messages) is spent only by messages the node ACCEPTED:
  anyone can sign junk naming any account with a key of their own, the node refuses it, and it costs that account
  nothing (`validator/test/keyrequest.test.js`, with a mutation). The per-address hour (240) is spent by every attempt.
- **A-ROOTPOST-PERSONA-SEPARATION** — no write as the root while a persona is the tab's acting identity, and none that
  targets one of the visitor's own persona accounts (a like's or recast's target, a reply's parent). Refused in the
  device, before anything is signed (`separatedWrite` in `lib/fc/rootSigner/flow.ts`: `acting_persona`, `own_persona`),
  with the acting check repeated as the last word before the bytes leave; an unreadable acting answer counts as acting,
  and an unreadable persona list refuses any write that names another account. The cards and the composer say it before
  the click, and the composer no longer offers "Post as @you instead" while a persona acts. To act as their own account
  a visitor with personas chooses "You" in the account menu (acting as yourself, above), which makes no persona the
  acting identity; there is no state in which both act. What it does not remove:
  (a) the address and timing residuals of A-ROOTPOST-SAME-ADDRESS and A-HUBREAD-PERSONA-SEPARATION (a); (b) a persona
  whose fid this vault does not hold is not known to be own, and the anon account is in the set only when known (so,
  when known, the root cannot react to @anon posts either); (c) the approval itself is not gated: Settings › Account can
  still start and poll a key request while a persona acts, and each poll reads the node's signer list for the root's
  fid. `scripts/unit-root-post.mjs` R12 (6 mutations, each caught) and `scripts/accept-hub-read-prod.mjs` HR16 (a real
  browser: six root writes refused while a persona acts, nothing at the relay).

**Measured by:** `scripts/unit-root-post.mjs` (the device flow end to end against the real validator and the stubs, the
message port byte-identical to `validator/hubmessage.js`, and mutations of every guard), `validator/test/keyrequest.test.js`
(the EIP-712 signer byte-identical to viem's, the key request and relay routes, the wrong requestFid and expired deadline
refused by the stub Farcaster API), `scripts/unit-app-account.mjs` and the owner harness (the app account and its arming;
the profile: `addFor` checked by the stub protocol's own EIP-712 recovery, the fname, the profile messages, a resume
after each step, @ontotem taken by someone else refused before anything is spent, and a mutation of every guard).

## 36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees

**Status (2026-11-05): built, test data only, not deployed.** The node's behaviour below was measured read-only against
the real public node; the timeline itself has run only against the loopback stub (`scripts/lib/farcaster-protocol-stub.mjs`).

**What it is.** On the live site, a visitor signed in with Farcaster (§21) sees their OWN Farcaster graph: the Following
tab is the accounts their account follows and those accounts' posts, newest first; "Find your people" on the home card
gives the count and opens the list (`/fc/following`); a post opens as a thread (`/fc/cast`) and an author as a profile
(`/fc/profile`). No Neynar. The visitor's tab reads a Snapchain node directly with plain GETs (`linksByFid`,
`castsByFid`, `userDataByFid`, `castById`, `castsByParent`, and, once Totem may post as the visitor, `reactionsByFid` for
the root's own newest likes and recasts): no custom header, no cookie, no referrer, so the browser
never preflights and the node's `Access-Control-Allow-Origin: *` answers. The node is the one post-as-you checks its key
on (§35; `FC_ROOT_HUB_URL`, the public node by default). The code: `lib/fc/hubRead/{read,copy}.ts`,
`app/api/fc/hub/route.ts` (a device route: any server answers `404 device_only` before reading the body),
`components/hub/*`, `app/(main)/fc/{following,cast,profile}/page.tsx`.

**Which source wins.** Following, for a signed-in visitor on the live site: the hub, always, with or without a Neynar
read key. The read relay (§19) has no following op by design, because it would hand the visitor's fid to Totem's app
server. For You stays the relay when its key is set. A thread or profile opened from a hub card is read from the hub;
one opened from a relay card, from the relay.

**What the real node did (read-only, 2026-11-05, one address).** A root following 111 accounts: 223 requests (follows,
casts and a profile per account), 1.3 MB, 1.4 s at 8 requests in flight, the first 20 posts after 0.33 s; per request
p50 34 ms, p99 178 ms. A root following 965: 1,933 requests, 11.5 MB, 9.5 s at 8 in flight (2.6 s at 32), the first 20
posts after 1.1 s; p50 32 ms, p90 42 ms, p99 108 ms. No 429 in about 4,100 requests, including 1,933 in 2.6 s. The node
honours a page size of 5,000, speaks HTTP/2, answers a preflight `OPTIONS` with 404, lists self-follows, and holds casts
dated decades ahead (one, from fid 347, is dated 2066).

**The design those led to.** At most 8 requests in flight from a tab (the visitor's own reads first). A fan-out cap: the
timeline reads the root and the 1,000 accounts it followed most recently (the follow list is read up to 10,000); past
that the page says how many it reads. Profiles only for what is on screen, so the 965-follow root costs about 1,100
requests, not 1,933. Each account's newest 10 posts, merged in exact reverse-chronological order down to a horizon (the
newest "oldest post read" of any account with more), so no account's older post jumps above another's newer unread one;
"Show older posts" pages the accounts at the horizon, and those accounts are paged while the rest still loads.
Progressive: the page shows what is in while the rest is read, and keeps on screen what it has shown until everything is
read. Measured the same way on the real node, the design itself: 965 follows took 1,096 requests, showed 50 posts after
0.8 s and had read everything after 5.0 s; 110 follows took 171 requests and 1.0 s; 1,854 follows (capped at 1,000)
took 1,101 requests and 5.3 s; every answer 200, none 429. A cache in the tab's memory only, with an incremental refresh (each account re-read on its own clock: one that posted ten
minutes ago is due in a minute, one quiet for a day in four hours, never more than six). A 429 pauses every read for
the node's Retry-After (at most 60 s) and says so. Casts dated more than 10 minutes ahead are left out of the order.

**Fail loudly, never empty.** A follows read that failed is an error with Retry ("Couldn't read who you follow … this is
not an empty list"), never "You don't follow anyone"; a timeline whose every read failed is an error, never "No posts
yet"; accounts whose posts could not be read are counted on the page; a profile that could not be read shows the
account's number and is counted. The two empty states are said only after reads that worked. A thread the node does
not hold says so; a thread read that failed is an error, never "not found".

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The Farcaster node the tab reads (`snap.farcaster.xyz:3381`, run by Farcaster, since October 2026 Network School) | this browser's internet address and user agent, its `Origin` header (the Totem page's origin), the time, and every read: the root's own fid first (its follow list), then each followed account's posts and profile, each thread and profile opened. So it can tie the address to the visitor's Farcaster account and see that they use Totem | the visitor's vault and anything Totem holds. Their personas: no read names one, and nothing is read while one acts (A-HUBREAD-PERSONA-SEPARATION); what remains is the timing guess that assumption states, so "never" is not claimed |
| Totem's app server | nothing new: no read passes through it. The pages these reads open carry no identifier (the fid and hash ride the URL fragment, which a browser never sends), so it sees an address open `/fc/cast` or `/fc/profile` at a time, never which post or account | the visitor's graph, the posts and accounts they open |
| Totem's validator | nothing new: no read passes through it | the graph |
| Neynar | nothing: it is not used | everything here |
| Hosts of pictures and links in posts | as §19 (A-FCREAD-THIRD-PARTY-MEDIA): Farcaster's usual image hosts load directly with no referrer; any other host waits for a click | the visitor's graph |
| Someone else using this browser later | nothing from these reads: the graph is kept in the tab's memory only and goes with a reload or a closed tab | the graph |

**Persona separation (the 2026-11-05 review: the first version of this section said the node "never learns the
visitor's personas", which was too strong).** The node ties this browser's address to the root, so two things in the
first build could hand it a persona: (1) a read NAMING one of the visitor's own personas: opening the persona's
profile or one of its posts, a quote of one, an ancestor by one, or the root following its own persona, which tells
the node "the root's browser checked @persona's post seconds after it went up"; (2) reads while a persona acts, so the
node saw the root's browser active at the moment the persona posted through Totem's server. Both are closed in the
device (`lib/fc/hubRead/read.ts`, `lib/fc/hubRead/separation.ts`): every read passes one guard that refuses any path
naming an own fid (the persona records and the anon account when known, `ownAccountFids`; no set loaded = no read)
and any read while the device's acting persona is set, including a read queued before a switch; the callers skip own
fids, show the persona's name from its vault record, and the thread and profile pages refuse (`own_persona`); every op
refuses `acting_persona` while a persona acts; Following and the home card show the persona's world, not the root's.
`scripts/unit-hub-read.mjs` H15 (6 mutations, each caught) and `scripts/accept-hub-read-prod.mjs` HR12 (a real
browser: zero node reads while a persona acts). The writes from these cards follow the same rule (§35,
A-ROOTPOST-PERSONA-SEPARATION): the device sends nothing as the root while a persona acts, and nothing as the root
targets an own persona's cast, which the card marks (`hubOwn`) and keeps disabled. Acting as yourself (§35, "You" in
the account menu) is how a visitor with personas gets these reads at all: they run only while no persona acts, and
stop, queued reads included, the moment a persona is chosen again; what the node learns from them is unchanged. While
no persona acts, the root keeps all three dials (its modes, rules, lenses and feed settings, its rings, its own data and
its own anonymous posts); only writes that speak AS a persona are refused (§35, the split).

**Your mode on this timeline (spec A, 2026-11-06: built, test data only, not deployed): nothing new leaves the device.**
While no persona acts, the root's active mode decides this timeline, in the tab (`lib/fc/hubRead/mode.ts`,
`lib/fc/hubRead/modeSource.ts`): its rules through the one evaluator (`lib/rules/evaluate.ts` `ruleActions`, the same
per-post decision the sample feed takes, with a new `post.text contains` field for a muted word), the mode's or an
attached pack's lens, and delivery tiers the root sets per Farcaster account from a hub card's menu, keyed `fc:<fid>`
in the existing sealed `deliveryTiers` record. The mode, its rules, packs and lenses are read from the tab's own memory,
keyed exactly as the mode routes key them (the public self while no persona acts); the tier record is read by the same
signed GET of the device's own sealed namespace the sample feed and the delivery screen make, once per tab (for a root
with no persona this can now be the first thing in a tab to make it; it carries the namespace name and nothing else),
and a tier set from a card is a write of that same sealed, padded record, so the validator never sees a fid. The mode
is applied AFTER the page is read, to the page as read: which accounts, posts, profiles and quoted posts are read from
the node is the same under every mode, so the node cannot tell one mode from another, and the mode orders the page
rather than choosing a different one (the sample feed lets its ranking pick its window from posts it already holds;
here that would mean reading other profiles). No mode data reaches Totem's app server (the timeline is a device-only
route), the node or Neynar; a mode switch writes the sealed modes record exactly as it always has. What a Farcaster post
cannot carry (like, recast and reply counts; a Totem tier, topic, attestation, standing or story) is listed on the page
as not available, never counted as 0, and a hide rule on the author's Totem fields hides every post (hide-when-unsure,
as for an unresolvable network author). A mode that cannot be read, or a rule it names that cannot be resolved or
walked, shows nothing rather than the unfiltered page; an unreadable tier record means Normal for every account, said
on the page. Separation is unchanged: the mode is not read while a persona acts, and an answer put together while one
is being chosen is refused (`acting_persona`). Not in v1: a mode's time-based auto-switch (it would write at read
time), and never-miss reaching past the page already read. Measured by `scripts/unit-hub-read.mjs` H17 and H18 (22
mutations, each caught; zero node reads across every mode) and `scripts/accept-hub-read-prod.mjs` HR20 (the real
pill, a word muted, never-miss from a card, a mode hiding everything, back to Default newest first, zero node reads).

**Assumptions, by id.**

- **A-HUBREAD-PERSONA-SEPARATION** — what the guard does NOT remove: (a) TIMING ACROSS SESSIONS: the node saw this
  address as the root earlier; a persona's post leaves from Totem's server, shared by every visitor, so while Totem has
  few active users "the root's browser was active, then went quiet, then a persona posted through Totem" narrows the
  guess. It fades as the crowd grows; a random delay on persona posts would blur it (not built: it costs instant
  posting). (b) PUBLIC FACTS: a root that follows its own persona, or a persona whose writing, topics or schedule match
  the root's, is linkable by anyone from public data; the guard only stops this browser adding to it. (c) A persona
  whose fid this vault does not hold (made elsewhere) is not known to be own. (d) The anon account is in the set only
  when this app knows its fid; it is one shared account every visitor reads, so a read of it names no one.
- **A-HUBREAD-NODE-SEES-GRAPH** — the node's operator can tie this browser's internet address to the visitor's own
  Farcaster account (the first read names it), to everyone they follow and to every post they open. That is the price
  of reading without Neynar and without routing reads through Totem; another node (`FC_ROOT_HUB_URL`) moves it to that
  node's operator, not away.
- **A-HUBREAD-ORIGIN** — a browser adds `Origin` to every cross-origin read and Totem cannot remove it, so the node
  sees that the reads come from Totem's pages. The referrer is withheld (`no-referrer`), so it never sees which page.
- **A-HUBREAD-NODE-HONEST** — the tab trusts the node's answers: the node's JSON is not the signed message bytes, so
  posts are not re-verified in the browser, and a lying node could hide or invent posts. Same node, same trust as
  A-ROOTPOST-NODE-HONEST.
- **A-HUBREAD-NO-LIMIT-SEEN** — no 429 was seen on 2026-11-05; if the node starts limiting, every read waits out its
  Retry-After and the page says so. There is no second node to fall back on yet.
- **A-HUBREAD-CAP** — past 1,000 follows, the posts of the accounts followed longest ago are not in Following (they are
  in the list); the page says how many it reads.
- **A-HUBREAD-TAB-MEMORY** — nothing is written to disk, so each reload re-reads (about a second to the first posts for
  a root following 1,000, measured): privacy on a shared computer over speed.
- **A-HUBREAD-FUTURE-DATED** — casts dated more than 10 minutes ahead are left out of the order (counted), so a bogus
  timestamp cannot pin the top of Following.
- **A-HUBREAD-NO-COUNTS** — the node keeps no like, recast or reply counts, so hub cards show none (never a 0).
- **A-HUBREAD-ACTIONS** — (corrected 2026-11-05: hub cards were read-only.) A hub card's Reply, Like and Recast (and
  their undo) act as the visitor's own account once Totem may post as them (§35), through §35's relay like any root
  post, never while a persona acts and never on a card by one of their personas (A-ROOTPOST-PERSONA-SEPARATION);
  otherwise the three are disabled with the one-line reason. The root's own casts offer Delete. The bindable extras
  stay disabled with the read-only sentence.
- **A-HUBREAD-REACTIONS-WINDOW** — which cards show as already liked or recast comes from ONE page of the root's newest
  200 likes and 200 recasts (`GET /v1/reactionsByFid?fid=<root>&reaction_type=Like|Recast&pageSize=200&reverse=true`,
  the root's fid only, through the same limiter and separation guard; cached 10 minutes; measured read-only on the
  public node on 2026-11-05: about 110 KB a page, spanning 6 weeks to 14 months for fids 2, 3 and 194; Snapchain refuses
  the hub-style `REACTION_TYPE_LIKE` with a 400). When the root has more, a card older than the oldest reaction read is
  shown unpressed with "Totem couldn't tell whether you already liked this", never as not liked, which assumes a
  reaction is never timestamped before the post it targets. A failed read is the same "couldn't tell". This tab's own
  likes and recasts apply at once. The node already sees these reactions as public data; the read adds that this
  browser asked for them.
- **A-HUBREAD-NOT-MARKED-ON-TOTEM** — who you follow is not marked "on Totem". The only public signal that needs no
  link between a root and a persona (a key requested by Totem's app fid, the onchain fact A-ROOTPOST-PUBLIC-USE
  describes) costs one more node read per account and marks only accounts that allowed post-as-you; left for later.

**Measured by:** `scripts/unit-hub-read.mjs` (the device's reads end to end against the loopback stub: plain GETs only,
the follows paging, the timeline equal to the stub's ground truth for 50 and 400 posts with a prolific account and a
cast dated ahead, the 1,000-account cap and at most 8 in flight with 1,500 follows, progressive answers in which
nothing on screen blinks out, every failure loud, true empties, a 429's pause, the incremental refresh, the root's own post through the real post-as-you flow,
threads, profiles, mentions, identity resets; and a mutation of each guard) and `scripts/accept-hub-read-prod.mjs` (the
production shape: the home card's count, the timeline against the stub's ground truth while it fills, a reply opening
its thread, an author's profile, the list, the root's own post on top, the error states and Retry, and that neither the
app server nor the validator saw a followed fid or a cast hash).

## 37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node

**Status (2026-11-06): built, test data only, not deployed.** The node's behaviour below was measured read-only against
the real public node; the notifications themselves have run only against the loopback stub
(`scripts/lib/farcaster-protocol-stub.mjs`), which now answers the by-target reads per shard as the real node does.

**What it is.** On the live site, a visitor signed in with Farcaster (§21) who acts as themselves (no persona acting:
"You" in the account menu, or no persona at all, §35) sees their OWN Farcaster notifications on `/notifications`: who
followed them, the posts that mention them, and the replies, likes and recasts on their newest posts, grouped the way X
groups them ("Alice, Bob and 12 others liked your post", follows per day, each group split at the last time they were
seen), newest first, with the page's All, Priority and Mentions tabs (Priority leaves out likes and recasts; Mentions is
mentions and replies). A reply or a mention is a hub card, so Reply, Like and Recast work on it as the visitor's own
account through §35's relay, exactly as on Following (§36, A-HUBREAD-ACTIONS). An unread badge sits on the Notifications
entry of the left rail and the phone tab bar. No Neynar. The code: `lib/fc/hubRead/notifications.ts` (the reads, the
groups, the clocks), `lib/fc/hubRead/seen.ts` (the sealed seen record), the hub route's `notifications`, `unread` and
`seen` ops (`app/api/fc/hub/route.ts`, a device route), `components/hub/HubNotifications.tsx`,
`components/hub/HubUnreadBadge.tsx`, `components/notifications/NotificationsBody.tsx`.

**The reads (each a plain GET through §36's one limiter, 429 pause and separation guard; each names the root only).**
`GET /v1/linksByTargetFid?target_fid=<root>&link_type=follow&pageSize=50&reverse=true` (who followed),
`GET /v1/castsByMention?fid=<root>&pageSize=50&reverse=true`, `GET /v1/castsByFid?fid=<root>&pageSize=25&reverse=true`
(the root's newest 25 posts), then for each of those: `GET /v1/castsByParent?fid=<root>&hash=<h>&pageSize=50&reverse=true`
and `GET /v1/reactionsByCast?target_fid=<root>&target_hash=<h>&reaction_type=Like|Recast&pageSize=100&reverse=true`; and
`GET /v1/userDataByFid` only for the first five accounts of each group on screen (cached an hour, §36). The badge's
count reads no profile at all.

**What the real node did (read-only, 2026-11-06, one address).** Every by-target index (`linksByTargetFid`,
`castsByMention`, `castsByParent`, `reactionsByCast`) answers PER SHARD: a page size of 5 returned up to 10, each of two
shards giving its own newest 5, concatenated, so a page is not in order across shards. Their page tokens cannot be
trusted: `castsByParent` always returns a token, even with no replies, and following it starts the list over (3 replies
came back in each of 12 pages); `reactionsByCast` pages repeated items across shards (114 items, 65 distinct). Without a
page size, `linksByTargetFid` answered 10,000 per shard (9.9 MB in 12 s for fid 194). Snapchain wants `reaction_type`
`Like` or `Recast` (`REACTION_TYPE_LIKE` is a 400 "unknown variant") and `target_fid` + `target_hash` (`fid` + `hash`
is a 400 "missing field `target_fid`"). The whole fan-out for five real roots: 78 node reads before profiles (3 heads
and 3 per post) for any root with 25 posts; with the profiles on screen 224 to 284 reads, 0.65 to 3.0 MB, 1.0 to 1.6 s at
8 in flight (fid 194: 270 reads, 1.3 MB, 1.6 s; fid 3: 284 reads, 3.0 MB, 1.5 s, 16 of its 25 posts at a page cap; fid
14871: 224 reads, 0.65 MB, 1.0 s); an account with one follower and no posts, 4 reads in 61 ms. Per request p50 30-33 ms,
p99 52-174 ms. Every answer 200, none 429.

**The design those led to.** ONE page of each read, merged across shards, keeping the exact newest 50 followers, 50
mentions, 50 replies and 100 likes or recasts per post; no page token is ever followed, and "there may be more" is only
"a page was full", said as "and at least N others". The window is said on the page: "your newest 50 followers and 50
mentions, and the replies, likes and recasts on your newest 25 posts"; the list holds at most 100 notifications.
Incremental: the three head reads at most once a minute (twice a minute for "Check now"), each post's replies and
reactions on its own clock (a tenth of its age, between 1 and 30 minutes), so an open tab costs about 4 reads a minute
once read, not 78; the page asks every minute while the tab is visible, the badge every 2 minutes, both again when the
tab regains focus, never while it is hidden. A cache in tab memory only. Events dated more than 10 minutes ahead are left
out (counted), so one cannot sit on top for ever or mark everything below it seen.

**Unread, and where "seen" lives.** The badge counts the groups newer than the last time this root's notifications were
seen; viewing the page (any of its tabs, as on X) marks everything up to the newest notification read as seen (never
back, never past now plus 10 minutes, never while a persona acts: asked again right before the write) and the badge clears
at once. That time is ONE record in the vault namespace `fcNotifications` (`lib/fc/hubRead/seen.ts`): sealed under the
vault key, padded to exactly 256 bytes of ciphertext whatever it holds, holding `{fid, seenAt}` (a record for another
Farcaster account reads as never seen); every device seals the empty record at boot (uniform presence), so the
namespace's existence and size say nothing; the accountLinks discipline applies (an unreadable or vanished record this
device sealed before is a refusal, never "never seen"). It is per root, so seen on one of the root's devices is seen on
all of them after a reload. No plaintext server row, no localStorage.

**Fail loudly, never empty.** Nothing read and a read failed is an error with Retry ("Couldn't read your notifications
… Nothing was read, so this is not an empty list"), never "No notifications yet"; a failed read beside ones that worked
is counted on the page ("Couldn't read your mentions just now, so some notifications may be missing"), and an earlier
good read stays shown; "No notifications yet" only after every read worked. A seen record that cannot be read is said
("Couldn't read which notifications you've already seen, so none are marked new") and the badge then shows a dot that
says it cannot tell, never 0; a seen write that fails is said too.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The Farcaster node the tab reads (`snap.farcaster.xyz:3381`, run by Farcaster, since October 2026 Network School) | as §36, plus: this browser's address asked, by the root's fid, who follows the root, which posts mention it, and the replies, likes and recasts on its newest 25 posts, about once a minute while a tab is open on the live site as the root. So it sees when the root's browser is open and looking, and that it cares who reacts | the vault, the seen time, anything Totem holds. Who the root's personas are: no read names one, what a persona did is left out without a read, and nothing is read while a persona acts (A-NOTIF-PERSONA-SEPARATION) |
| Totem's app server | nothing new: no read passes through it; `/notifications` carries no identifier; a hub card's like or reply goes through §35's relay as before | the followers, mentions, reactions, and when they were seen |
| Totem's validator | that this root's `fcNotifications` record was rewritten, at a time, as 256 bytes of ciphertext (A-NOTIF-SEEN-WRITE-TIMING) | the seen time itself, who followed or reacted, which posts |
| Neynar | nothing: it is not used | everything here |
| Someone using this browser later | nothing from the reads (tab memory); the seen time is sealed in the vault, readable only with this identity's vault key | the notifications |

**Persona separation.** The node already ties this browser's address to the root (§36), so the rule is the same, and the
guard is the same code: every read passes `hubGet`'s separation guard, which refuses any path naming an own fid, now in
`target_fid=` as well as `fid=` (the by-target reads), and any read while a persona acts, a read queued before a switch
included; every op (`notifications`, `unread`, `seen`) refuses `acting_persona` while a persona acts, so the seen record
is never written then either. What an own persona did (followed the root, mentioned it, replied to it, liked or recast
it) arrives in the root's own answers as a fid; it is LEFT OUT: never shown on the root's screen and its profile never
read. While a persona acts, `/notifications` and the badge are the persona's world, exactly as before this pass (the
persona has no badge), and nothing is read as the root. `scripts/unit-hub-notifications.mjs` N8 (zero reads naming the
persona, its six actions left out, three ops refused, zero queued reads after a switch, `target_fid` guarded; mutations
of each, caught) and `scripts/accept-hub-notifications-prod.mjs` HN11 (a real browser: zero node reads while the persona
acts, no badge, the persona's page; You reads the root's again; the persona again: zero).

**Assumptions, by id.**

- **A-NOTIF-PERSONA-SEPARATION** — what the guard does NOT remove: (a) TIMING, as A-HUBREAD-PERSONA-SEPARATION (a):
  the root's browser polls about once a minute while it is open as the root and goes quiet when a persona is chosen; a
  persona's post then leaves from Totem's server. While Totem has few users the gap narrows the guess. (b) PUBLIC FACTS:
  a persona that follows, mentions or likes its own root does so in public; anyone reading the network sees it, and
  leaving it off the root's screen does not hide it. (c) A persona this vault does not hold (made elsewhere) is not
  known to be own, so what it did is shown like anyone's.
- **A-NOTIF-NODE-SEES-INTEREST** — the node learns, beyond §36, that this address checks who reacts to the root, and
  roughly how often a tab is open: the price of reading notifications without Neynar and without routing them through
  Totem. Another node (`FC_ROOT_HUB_URL`) moves it, not away.
- **A-NOTIF-SEEN-WRITE-TIMING** — the validator sees the `fcNotifications` record rewritten when the root views new
  notifications (at most once per new notification shown), a time it can tie to the root's vault. It cannot read the
  time inside, and the write happens only while no persona acts.
- **A-NOTIF-WINDOW** — notifications outside the window are not shown: a follower beyond the newest 50, a mention
  beyond the newest 50, and replies, likes and recasts on posts older than the root's newest 25 (its replies count as
  posts). Past a full page the count says "at least". Quote-casts of the root's posts are not read (no by-quote index
  was measured). The page says what the window is.
- **A-NOTIF-NODE-HONEST** — as A-HUBREAD-NODE-HONEST: the answers are JSON, not re-verified signatures, so a lying node
  could hide or invent a notification; every record is rebuilt field by field and one of another kind, post or target
  is dropped.
- **A-NOTIF-POLICY** — the active mode's notification setting (muted, mentions only) does not filter the root's
  Farcaster notifications yet; the Priority and Mentions tabs do.

**Measured by:** `scripts/unit-hub-notifications.mjs` (npm run test:hub-notif-unit: the device's reads end to end against
the loopback stub, plain GETs naming the root only with the measured page sizes, the groups and their order and
sentences, the shard merge, castsByParent read once per post, "at least", unread and the sealed 256-byte record, every
failure loud, true empties, the clocks, persona separation, a 429's pause, the badge's no-profile count, identity resets,
doctored records dropped; 29 mutations, each caught) and `scripts/accept-hub-notifications-prod.mjs` (the production
shape: the badge counting unread and clearing on view, the planted notifications grouped and newest first, the seen
record across a reload and a new follower after it, the tabs, the hub pages by fragment, a like from a reply card at the
relay, the error and Retry, that neither the app server nor the validator saw a follower's fid or a post's hash, plain
reads at the node, and zero reads while a persona acts).

## 38. Sign in with X: what X, the app server and the validator learn

**Status (2026-11-06): built, test data only; not deployed; dormant until armed.** No X developer app exists for Totem
yet, so no real sign-in has happened. Without `X_CLIENT_ID` on the public app the tab is handed no hint and every
"Continue with X" is the disabled button marked Soon, exactly as before; without it on the validator the relay answers
`503 not_armed`. Every test runs against `scripts/lib/x-api-stub.mjs`, a loopback stand-in for X's consent page, token,
`/2/users/me` and revoke endpoints that checks PKCE S256, one-shot 30-second codes, exact callbacks and the fields asked;
the real X API is never called by a test. The owner arms it with `scripts/owner/arm-x-signin.ps1` (notes/runbooks/OWNER-CHECKLIST.md,
"Sign in with X"). X's documentation and pricing as read on 2026-11-06 are in docs/mechanism/sign-in-with-x.md.

**What it is.** A visitor presses "Continue with X" (the landing, /welcome and its step 1, beside Sign in with
Farcaster). The tab keeps the identity in this browser (x.com replaces the page), draws a PKCE verifier and a state into
THIS TAB's sessionStorage, and goes to `https://x.com/i/oauth2/authorize` asking for `users.read tweet.read` with an S256
challenge. The visitor approves on X; X sends the tab back to `<origin>/welcome/x?state=…&code=…`. There the device reads
and REMOVES the stored request (one shot), checks the state, and hands `{code, verifier, redirect_uri, client_id}` to the
validator's thin relay, which redeems the code, reads `GET /2/users/me?user.fields=profile_image_url,verified,verified_type`,
revokes the token, and answers the profile alone. The device records the X account as one more link in the same sealed
`accountLinks` record (§21) and the root's read-only public self: minted from the X profile when the root has none, or
the one Sign in with Farcaster minted, which the X account then joins (and the reverse: Sign in with Farcaster on an
X-first root joins the X public self). One identity, both accounts. It saves nothing: a passkey does. The code:
`lib/x/signin/{pkce,config,flow}.ts`, `app/api/x/signin/route.ts`, `app/(main)/welcome/x/page.tsx`,
`components/x/{XSignIn,XCallback,ConnectFarcaster}.tsx`, `validator/xsignin.js`.

**Why a relay at all.** X's token endpoint and API answer no browser CORS for a third-party origin. Measured read-only on
2026-11-06 with `Origin: https://ontotem.com`: `OPTIONS https://api.x.com/2/oauth2/token` answered 404 and `OPTIONS
https://api.x.com/2/users/me` 405, neither with an `Access-Control-*` header (the same preflight from `https://x.com`
answered 200 with `access-control-allow-origin: https://x.com`). So one step must run off the browser. It runs on the
VALIDATOR, like the hub relay (§35), never on the public app server, and it is stateless: no table, no file, no cache,
and no log line with a code, a verifier, a token, an account or an address (its one log line is a count every ten
minutes). It forwards only the client id it is armed with and only to an https Totem callback (`…/welcome/x`, no
query). With a public X app (a "Single page App", the recommended setup) there is no client secret anywhere; with a
confidential one, `X_CLIENT_SECRET` lives on the validator only and the public app refuses it at boot
(`APP_ONLY_REFUSES`).

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| X | that this X account signed in to Totem (the app's name and callback are on X's consent page and in its records), the visitor's internet address and browser on its consent page, the time; then, from the validator's address, the code's redemption, one `/2/users/me` read and the revoke | the root's other accounts, its personas, anything Totem holds |
| The Totem public app server | the callback page's request: `GET /welcome/x?state=…&code=…` from the visitor's address (a page load, before the tab removes the query) | the X account: the code is useless without the PKCE verifier, which never leaves the tab, and it dies at its first use or after 30 seconds |
| The validator (the operator) | in the relay's memory for the length of one request: the code, the verifier, the access token and the visitor's PUBLIC X profile (id, username, name, picture address, verified flags), with the visitor's address and the time | which root or anchor the request belongs to (the relay request is unsigned and carries no device header), any persona |
| Everyone else | nothing from the sign-in | everything here |

The tab never holds an access token, and nothing keeps one: the relay revokes it the moment the profile is read, whether
or not that read succeeded. The sealed link keeps the X id, username, name, picture address, the verified flags, the
persona id and two times; never the code, the verifier, the state, a token, or any count X could answer.

**Assumptions.**

- **A-XSI-RELAY-SEES-PROFILE** — the validator's relay process sees the visitor's public X profile and could be changed
  to log it. Today it logs nothing identifying (`validator/test/xsignin.test.js`; a mutation that logs the code fails it),
  but "the operator could" is the honest bound. The profile is the root's PUBLIC identity (the visitor chose to sign in
  as it); personas are never in the request.
- **A-XSI-COLLUSION-IP-TIME** — the Totem operator can match the relay request's address and time to the root's own
  signed vault traffic from the same address, and so learn "anchor A is X account N". The same join already exists for
  a Farcaster sign-in through the relay or node operators (A-SIWF-COLLUSION-IP-TIME); for X the operator needs no second
  party. It does not reach personas: their posts carry no root (§10), and their network view is §27's open item (an
  outside OHTTP relay hides the address; the X relay request would need it too, not built). Like Sign in with
  Farcaster, the sign-in is not refused while a persona is the tab's acting identity (the page load back from X names
  the first persona at boot, as every load does), so the relay request can share a tab, an address and a few seconds
  with that persona's own traffic: the same §27 gap, with the root's X account named on one side of it.
- **A-XSI-RELAY-TRUSTED-FOR-PROFILE** — X's OAuth 2.0 issues no signed identity token a browser could check, so the tab
  trusts the relay's word for which X account signed in. A dishonest validator could bind the wrong X account to a
  root; it cannot sign in as anyone (the code needs the verifier), and the sealed link is the visitor's own.
- **A-XSI-CALLBACK-QUERY** — X answers in the query string (no fragment response mode is documented), so the app server
  sees the callback's request. The tab strips the query from the address bar at once, the page sends no Referer
  (`referrer: no-referrer`), and a replay of that URL is refused before any request (the stored request is gone).
- **A-XSI-CODE-30S** — X's code lives 30 seconds. The callback hands it to the device at once (boot.js queues the
  request until the device is up); a device that takes longer to boot gets "X refused the sign-in code … Start again",
  never a partial link. Measured on the production shape only (desktop, loopback): unverified on a slow phone.
- **A-XSI-SAME-TAB** — the verifier and the state live in the starting tab's sessionStorage, so the callback must land
  in that same tab. On a phone with the X app installed, X may open the consent in its app and send the visitor back
  to another browser context; that callback is refused (xsi_no_request) and nothing is linked. Unverified on real
  phones.
- **A-XSI-PAGE-IS-THE-DEVICE** — a script on the page can start or finish a sign-in, as the page can. It cannot point the
  tab at another authorize page (only X's own, or a loopback stub off a hosting platform) or another relay (the
  validator the tab already uses).
- **A-XSI-ONE-PER-ROOT** — one X account per root, kept as a tombstone after a disconnect (only the same X account may
  sign in again), as for Farcaster. The stem rule applies both ways: no persona may share a name stem with the X
  username, at sign-in and whenever a persona is created (`lib/identity/mainName.ts`).
- **A-XSI-NO-FOLLOWS-READ** — Totem does not read the X following list from X's API (`GET /2/users/:id/following` costs
  $0.010 per account returned under pay-per-use, and needs `follows.read`; X's Developer Policy also asks for express
  opt-in before matching X data to another service's identities). Find your people uses the X archive the visitor
  imports (which never leaves their browser) against the Farcaster-verified X index, as before.
- **A-XSI-POLICY-CONSENT** — X's Developer Policy says signing in is not by itself consent to off-X matching. Totem
  matches nothing from X's API; the X account is shown as the visitor's own account on their own profile, and This is
  you's Show toggle hides it.

**Measured by:** `scripts/unit-x-signin.mjs` (PKCE and the authorize URL, the positive control through the real relay
against the stub, replay, the state, expiry, dormancy and the server hints, no secret in any answer or log, one X per
root and the stem rule, both orders of Farcaster and X on one root, the padded record with both links at 1,024 bytes,
the route's server refusal, the card and the doors; 20 bundle mutations and 8 relay mutations, each caught),
`validator/test/xsignin.test.js` (the relay in-process against the stub: dormant, public and confidential exchanges,
replay, PKCE, the client id and callback rules, revoke even when users/me fails, the cap, the base rules, the logs, the
env contract) and `scripts/accept-x-signin-prod.mjs` (the production shape with live mode on: the landing's door, the X
path to This is you and the home feed, what each party saw, the X-only root's Farcaster notices, every refusal, Farcaster
added to the same root, and zero non-loopback requests).

## 39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees

**Status (2026-11-07): built, test data only; not deployed.** Every test runs against the loopback Snapchain stand-in
(`scripts/lib/farcaster-protocol-stub.mjs`) and, for sends, the production shape's own validator and ring drop; nothing
here has run on ontotem.com. Desk notes on real posts cannot happen on the live site at all yet: the live site runs the
empty world (lib/world.ts), which has no desk to subscribe to (desks are seeded demo data, and a desk's signatures verify only for
personas a device holds or the seed's fixtures), so that part is checked through the engine only
(`scripts/unit-hub-read.mjs` H20), never on the production shape.

**What it is.** On the live site, while a visitor acts as themselves, the real Following (§36, under the root's mode,
spec A) now carries the extras the sample feed always had, through the same machinery: one module
(`lib/fc/hubRead/extras.ts`, pure), its loader (`lib/fc/hubRead/extrasSource.ts`), the one injection queue
(`lib/injection.ts`: a post already on the page owns its hash, first writer wins across types by priority, every type
keeps its cap), and the island (`components/hub/HubFollowing.tsx`).

1. **Reading pieces (readwise).** A Farcaster post is a reading piece when it holds at least 80 words (the shortest piece
   the piece-length slider allows, `LIMITS.chunkWords[0]`; in practice a long cast, since a 320-byte cast holds about 55)
   or carries a link that is not a picture (`isHubReadingPiece`, the same picture rule the card draws with). It is ONE
   piece, `<cast hash>#chunk1`, in the same sealed `readwiseState` record as a sample chunk (§17): the card adds up the
   time it is at least half on screen and seals the total when it leaves (nothing per tick), crossing the length-scaled
   threshold (half the words at 240 a minute, 1.5 s floor) marks it read; an unfinished piece that has left the page
   comes back through the queue ("Back in your reading queue"), capped by the mode's cadence knob, pieces from a
   priority folder first, a read one never; the × puts it in the bin, where Settings lists it with its words, and
   Restore brings it back. The route (`/api/readwise`, answered by the tab) takes the piece's words from the cast this
   browser ALREADY HOLDS for the Following (`lib/fc/hubRead/read.ts hubHeldPiece`), never from the request and never
   from a read of the node; a cast it does not hold, or one that is not a piece, is an unknown chunk.
2. **Desk notes (correction cards).** A desk annotation names a Farcaster post as `fc:<fid>:<hash>` inside the body its
   curators sign (`lib/fc/hubRead/copy.ts hubCastTargetId`). A VALID note (`subscribedAnnotations`: sub-threshold ones
   never reach here) from a desk the root subscribes to shows on that post when it is on the page, matched by author
   AND hash; a noted post the root liked or recast, off the page, comes back with the note (the owner's "community notes
   resurfacing": the post reappears instead of a notification). "Liked or recast" is what this browser already read for
   the cards' pressed state (post as you on hub cards: two reads naming the root, at most the newest 200 of each); when it has not read
   them, nothing resurfaces. The vote row is left off (voting is a persona's act). A desk's demote and auto-block are
   not applied to Farcaster accounts yet, and the page says so.
3. **Close-friend sends.** `/api/feed-health/send` cannot reach anyone on the live site: it is a persona action (refused
   while no persona acts, lib/device/actingRoot.ts), and its `toPersonaId` resolves only in the SENDER's own vault (the
   `sends` namespace is each visitor's own), so a send was recorded on the sender's device and read by nobody. The
   smallest safe version rides the encrypted ring mailbox that already exists (§24): `POST /api/rings {action:"send",
   ringId, target:{fid, hash}}` (`lib/rings/outbound.ts sendToRing`) puts a Farcaster post, by its id only (fid, hash and
   the minute it was sent), on one of the root's rings. It rides the ring's next sealed statement to every person in it
   (the fixed 4,096-byte plaintext of every envelope; after the pictures, the sends are what is dropped before a note would stop fitting),
   at most 4 per ring, for 3 days. A member's device opens it on its ordinary tick (memory only,
   `lib/rings/received.ts receivedSends`), and the root's Following shows it, "Sent to you by <the name the owner chose to
   be shown by>", spliced through the queue or, when the post is already on the page, on it. A sent post this browser
   has not read for the Following is NOT shown and NOT read: the page says how many it left out. Refused unless the root
   acts (409 `acting_persona`; only the live site has acting as yourself, so a send is always refused on the rig and the
   owner service) and for a post by one of the sender's own personas (403 `own_persona`).

**Persona separation.** Everything here exists only on the hub timeline, which answers only while no persona acts and
names no own persona in any read (§36). Nothing in this section makes a read of Farcaster's node: no piece, note or send
is fetched, no profile or quote is read for a spliced card (its author shows from profiles already read, or as its
account number). While a persona acts, a piece's dwell, bin and restore are refused (409, nothing written) and a
persona's Settings pane does not list the root's pieces in the bin; a send is refused; received sends are held in memory
and shown nowhere. A ring address belongs to the root (it comes off the root's seed, §24), so a send lands in the root's
Following only, and the sender learns nothing back: no receipt, no read, no reaction is caused by it.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| Farcaster's node | nothing new: the Following's own reads, as §36 says, whatever is a piece, noted or sent | which posts are reading pieces, how long anything was on screen, what a desk noted, that a post was sent or to whom |
| Totem's app server | nothing: every route here is answered by the visitor's tab | a hash, a fid, a dwell time, a desk, a ring |
| The validator (the operator) | the sealed `readwiseState` record's writes (one each time a piece leaves the screen, and on a bin or restore) and its size class (1 KiB steps); for a send, the sender's device re-sealing its ring rows at its next tick, the fixed-size envelopes it always publishes | the hash, the words, the time on screen, which ring, whom a send reached, that a row carries a send |
| The ring's other people | each person in the ring sees the same sends, under the name the owner chose | who else is in the ring, whether anyone's browser showed the post |
| The sender | that the send was sealed for the ring's people | whether it reached anyone's Following, whose, or when |
| Neynar | nothing: none of this uses it | everything here |

**Assumptions.**

- **A-HUBX-DWELL-WRITE-TIMING** — the validator sees a sealed write of the root's `readwiseState` record each time a
  reading piece leaves the screen: that the root is reading now, never what or for how long. The same as a sample
  chunk's (§17); a write is never made while a persona acts.
- **A-HUBX-RECORD-SIZE** — the sealed record's size class (1 KiB steps) grows with the pieces measured and the bin, so
  the operator can tell a heavy reader from a light one over time. Unchanged from §17.
- **A-HUBX-SEND-PUBLISH-TIMING** — a send marks the ring changed, so the sender's device re-seals at its next tick
  rather than on its hourly schedule: the operator sees an off-schedule publish from that device, as for adding a
  person (§24), and nothing about what was sent or to whom.
- **A-HUBX-SEND-NOT-HELD** — a sent post the recipient's browser has not read for its Following (an account it does not
  follow, or a post older than what was read) is not shown, by design: reading it because of the send would let the
  sender, with the node's operator, learn which browser holds the address. Said on the page, with the count.
- **A-HUBX-SEND-RING-WIDE** — a send reaches everyone in the ring, never one chosen person (v1). The ring's people do not
  learn of each other.
- **A-HUBX-SEND-IDS-ONLY** — a send carries the post's id, never its words or author's name, so a friend cannot put
  words in someone's mouth: the recipient shows its OWN copy, read from the node for the Following, or nothing.
- **A-HUBX-SEND-OLD-CODE** — a member device running code from before this section ignores sends (the statement
  validator does not refuse unknown fields); an owner device running older code drops them at its next re-seal.
- **A-HUBX-ENGAGED-WINDOW** — resurfacing knows only the reactions the cards read (the newest 200 likes and 200 recasts),
  and only after they have been read in this tab; an older like does not bring its noted post back.
- **A-HUBX-NO-DESK-LIVE** — no desk exists on the live site, and a desk made elsewhere cannot be verified there; desk
  notes on real posts are proven through the engine only until desks can be published to the live site.
- **A-HUBX-QUEUE-NO-PROFILE-READ** — a spliced card's author is drawn from the profiles this tab already read (it may
  be stale, or shown as the account's number), because reading it would be a node read caused by the extra.
- **A-HUBX-TICK-FROM-FOLLOWING** — what a ring sends arrives on the device's background tick (lib/zk/prefetch.ts: every
  device's same reads of the validator, rings or not), and a live tab used to start that tick only from a few surfaces
  (the privacy label, the anonymous composer, a few panes), so a root who only reads Following would never receive one.
  The Following now starts it (`POST /api/zk {action:"prefetchStatus"}`, answered in the tab). From then on the
  validator sees this tab's ordinary tick reads, the same ones every ticking device makes; nothing in them names the
  root, a persona, a ring or a post, and nothing goes to Farcaster's node.
- **A-HUBX-ADDRESS-SPARES** (found while testing; §24's mechanism, not changed here) — a root's private ring addresses
  are made ahead as spares inside the rings document's FIRST write (the first tick) or the deferred upkeep (15 minutes
  to 3 hours after one is needed). A root whose document was first written by a change (a ring made before its first
  tick) holds no spare, so "Make a private address" is refused in plain words until the upkeep runs. With the Following
  starting the tick, a root who opens Following before Settings › Rings gets its spares first; the other order still
  waits.

**Measured by:** `scripts/unit-hub-read.mjs` H19 (the piece rule and its constant, dwell through the real route into
the real sealed record with nothing in the clear and no request, the threshold, the requeue through the queue with the
cadence knob and the priority folder, a finished piece never back, the bin and Restore, the mode's hide, refusals while a
persona acts including Restore and the persona's pane, an unreadable state and unreadable folders said, zero node reads),
H20 (notes on the page by author and hash, resurfacing only what was liked or recast and is held, nothing before the
reactions are read, the mode's hide, desk actions and an unreadable desk list said, the root's own subscriptions, zero
node reads) and H21 (the real send, statement, seal, open and member inbox: the refusals with nothing written, ids only
under the share-as name, on the page and spliced, one not held said, another author's hash, six malformed sends refused,
sends dropped before a note stops fitting, three days on both sides, a failed drop read, one card for one post's three
extras, zero node reads); 31 bundle mutations, each caught. `scripts/accept-hub-read-prod.mjs` HR21 (a long real-shaped
cast is a piece; read after it stays on screen past its threshold; the dwell left the tab only inside the sealed record;
the bin and Restore; zero node reads) and HR22 (a second visitor, signed in with Farcaster, sends through his ring; his
tick publishes, her next tick opens it, and her Following, already on screen, splices it in and says the post she never
read is not shown; no read names a sent post; no request of either tab carries the sent post's hash or fid in the clear).
A live tab ticks about every 10 minutes (and once at once on the composer's first check of a page load, which both tabs
use there), so on the live site a send reaches a Following within about 10 minutes of the sender's next tick.

## 40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees

**Status (2026-11-07): built, test data only, not deployed.** The node's behaviour below was measured read-only against
the real public node; the feed itself has run only against the loopback stub (`scripts/lib/farcaster-protocol-stub.mjs`,
which now plants a 2-hop graph and computes what For You should show from its own state).

**What it is.** On the live site, a visitor signed in with Farcaster (§21) who acts as themselves (no persona acting: §35,
"You" in the account menu, or a visitor with no persona at all) gets For You from their own Farcaster graph, with no
Neynar: posts the people they follow liked or recast lately, and recent posts from accounts several of the people they
follow follow, ordered by their active mode (spec A's shaper, §36). Each card says why it is there ("Liked by Alice and 2
others you follow", "Followed by 9 people you follow"), and the page says what was read ("From 40 people you follow who
liked a post in the last 3 days, and 30 accounts several of them follow."). Every read goes through the hub read core of
§36 (the same node, the 8-in-flight limiter, the 429 pause, plain GETs with credentials omitted and no referrer, the
separation guard). The code: `lib/fc/hubRead/forYou.ts` (the engine), `lib/fc/hubRead/mode.ts` (the follow-based
signals), `lib/fc/hubRead/copy.ts`, `app/api/fc/hub/route.ts` (`op: "foryou"`, a device route: any server answers
`404 device_only` before reading the body), `components/hub/HubForYou.tsx`, `components/home/HomeFeed.tsx`.

**Which source wins.** For You, for a signed-in root acting as itself on the live site: the hub, always, whether or not
a Neynar read key is set (FC-READ, §19), for consistency with Following and because Neynar's future is a dependency
risk since Farcaster's sale. The read relay stays For You's source for everyone else (a persona acting, or a visitor
with no Farcaster sign-in), unchanged: its discovery op is one server-held author list (`FC_READ_FIDS` or the house
account's follows) and names no visitor's fid, so it hands the root's fid to nobody. It is never the root's fallback
when a hub read fails: that would swap sources silently at the moment of a failure, so the failure is said, with Retry.
(2026-11-07, §42: the relay is that source only while the operator sets `FC_SOURCE_FORYOU=neynar` or `auto`; unset, an
armed read key alone puts nothing from Neynar on anyone's For You.)

**What the real node did (read-only, 2026-11-07, one address, 8 in flight).**

- `reactionsByFid` needs `reaction_type`: without it the node answers 400 "missing field `reaction_type`", so a follow's
  likes and recasts are two reads. `linksByFid` with `reverse=true` answers the newest follows first.
- The follows a root followed MOST RECENTLY are a poor sample of who is active: for fid 2 (1,854 follows) only 6 of the
  40 most recently followed had liked anything in a week, while the 40 most recently ACTIVE (by newest like) had all
  liked within 17 hours. A one-like check costs ~607 bytes, p50 31 ms. Finding 40 active: fid 194 (1,284 follows) in 120
  checks (0.66 s), fid 2 in 440 (2.0 s); fid 99 (3,131 follows) found 30 in 1,000 checks (4.6 s); fid 3 (78 follows) 24
  in 78 (0.46 s).
- A follow's newest 1,000 follows weigh ~365 KB (14.6 MB for 40), the newest 50 ~24 KB. Ranking by whole follow lists
  picked long-dormant famous accounts (fid 3: the top 30's median newest post was 148 days old, 4 had posted in 3 days);
  by the newest 50 (about 10 months of following), 13 to 20 of the top 30 had posted in the last week.
- In 72 hours the sample liked 39 to 179 distinct posts by accounts the root does not follow; most are liked by one of
  the sampled follows (the most shared, by 2 to 4).
- The whole design, four real roots (fids 2, 194, 3, 99), phases in sequence: 304 to 1,214 node reads, 1.7 to 2.6 MB,
  1.7 to 5.7 s, 103 to 150 posts to show. p50 29 to 54 ms, p99 37 to 196 ms; every answer 200, none 429 in about 3,500
  reads.

**The design those led to.** The root's follow list is Following's own read (shared, cached). Then, most recently
followed first and 40 at a time, each follow's newest like (pageSize 1) is checked until 40 liked a post in the last 72
hours or 1,000 were checked: the SAMPLE (own personas the root follows are never checked). For each sampled follow, as
soon as it is found: its newest 25 likes and 25 recasts and its newest 50 follows. Each sampled follow brings in at most
2 posts, its newest reactions of the window, by eligible accounts (at most 80 a load, `castById`). Once the sample's
follows are in, the accounts at least 2 of them follow, most-followed first, the top 30 eligible ones: their newest 5
posts (those of the last 7 days are shown). Names: the profiles of every candidate's author, of the first two people who
liked or recast it, and of eligible accounts a candidate replies to or mentions; quoted posts the same way. ELIGIBLE: not
the root, not an account it follows (that is Following), never an own persona, and in the keyed half below. Every
candidate's reads are made whatever the mode, and the mode orders and filters afterwards, so the node cannot tell one
mode from another. Progressive: the page shows what is in while the rest is read, and what is on screen stays (newer
candidates slot in by the mode's order; only a mode switch re-orders from scratch). Casts dated more than 10 minutes
ahead are left out (counted). A cache in tab memory only. A refresh ("Check for new posts" at most once a minute; on focus
or every two minutes while visible, at most every 10 minutes) re-reads the sample's newest reactions and the accounts'
newest posts; the activity check and the follows of the follows are redone after 30 minutes.

**The keyed half (the 2026-11-07 check against personas: a skipped read is a signal).** Which accounts For You reads is
otherwise a deterministic function of public data (the root's follows, their reactions and follows), so the node could
recompute it and notice the one account it should have read and did not: the root's own persona, liked or followed by
the root's follows. Skipping it (the separation guard must) would itself name it. So every account beyond the root's
follows passes a keyed coin first: HMAC-SHA256, under a key derived with HKDF from this vault's key (info
`totem/foryou-half/1`, never stored, never sent), of the account's fid; it is eligible only when the first byte is below
128. The coin is the same in every tab and on every device of this vault, so an account that is never read is "out" for
the same reason as half of all accounts, every time: its absence is at most 2:1 evidence that it is the root's, however
many sessions the node watches. The same coin gates the secondary reads (profiles of accounts a candidate replies to or
mentions, quoted posts) for accounts the root does not follow; one it does not admit shows its number, never a guess.
The cost: about half the candidates are never shown to this root.

**Your mode on this feed.** The root's active mode, read from the tab's memory exactly as for Following (§36, spec A):
its rules through the one evaluator, delivery tiers keyed `fc:<fid>`, the mode's or a pack's lens. For You has counts
Following does not, and they mean one narrow thing each, said on the page: the mode's engagement weight reads
`lib/feed.ts`'s engagement curve over the people you follow who liked or recast a post (calm ranking damps it), the
lens's likes and recasts signals read the same two counts, and author affinity is the share of the sampled follows who
follow the author. None of them is a network total (the node keeps none). What still cannot be carried (a Totem tier,
topic, attestation, standing or story) is listed as not available. A mode that cannot be read shows nothing.

**Fail loudly, never empty.** A follows read that failed is an error with Retry (and is not re-read before Retry); a feed
with nothing to show after any read failed is an error ("Couldn't read For You … Nothing was read, so this is not an
empty feed."), never an empty state; reads that failed beside ones that worked are counted on the page ("Couldn't read
what 1 person you follow liked or follow and the newest posts of 1 account just now"); the three empty states (you
follow nobody; nobody you follow liked anything in 3 days, with how many were checked; what they liked is all by people
you already follow) are said only after reads that all worked.

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The Farcaster node the tab reads (`snap.farcaster.xyz:3381`, run by Farcaster, since October 2026 Network School) | what it learns from Following (§36), and now also that this browser asked, as the root, for the newest like of up to 1,000 of the accounts the root follows, the likes, recasts and newest follows of up to 40 of them, and the posts and profiles of up to 30 accounts the root does NOT follow plus the posts its follows liked: the accounts and posts For You put in front of the root, an interest profile beyond the follow list. Roughly when a tab is open on For You. | the vault, the mode, which posts the mode put on top. The root's personas: no read names one, nothing is read while one acts, and which accounts beyond the follows are skipped is decided by a coin keyed to the vault (A-FORYOU-HALF), so "never" is not claimed |
| Totem's app server | nothing new: no read passes through it, and the For You tab is `/home` with no identifier | the graph, the candidates, the mode |
| Totem's validator | nothing new: no read passes through it (the mode and its tier record are read as for Following, §36) | the graph |
| Neynar | nothing: it is not used for the root's For You | everything here |
| Hosts of pictures and links in posts | as §19 (A-FCREAD-THIRD-PARTY-MEDIA) | the graph |
| Someone else using this browser later | nothing from these reads: tab memory only | the graph |

**Persona separation.** The op is admitted like every hub read: refused `acting_persona` while a persona acts, so a
persona acting means ZERO node reads from For You (and the home island does not mount it: For You is then the persona's
world exactly as before); the own set loaded or nothing is read; no read names an own persona (the core's guard on every
path, and For You never selects one); an answer put together while a persona is being chosen is refused; a load a
persona's switch interrupted is run again, from the start, once the root acts again. Measured by
`scripts/unit-hub-foryou.mjs` F11 (zero requests while acting, none after a mid-load switch) and
`scripts/accept-hub-foryou-prod.mjs` FY9 (a real browser: zero node reads on For You and Following while a persona acts).

**Assumptions, by id.**

- **A-FORYOU-HALF** — the keyed coin bounds what a skipped account says to 2:1 per account, not to nothing. It does not
  hide (a) an account whose relationship to the root is public anyway (A-HUBREAD-PERSONA-SEPARATION (b)); (b) a persona
  the root follows (that omission is Following's, already public: the root's follow list names it); (c) anything a node
  learns by combining many such accounts with other data. A new vault key (a fresh identity) draws new coins. The coin
  is checked to be about half (1,940 of 4,000 fids under the test key) and stable across tabs.
- **A-FORYOU-OMISSION-ELSEWHERE** — the same omission signal exists, unchanged by this section, in Following's and
  Notifications' secondary reads: a quoted post, an ancestor or a mentioned account that is an own persona is skipped
  there deterministically (§36, §37). Not fixed here; flagged for a follow-up (the same keyed coin would apply).
- **A-FORYOU-NODE-SEES-BEYOND** — For You's reads tell the node more than Following's: which accounts beyond the follows
  the root is shown, and which of its follows are active. That is the price of discovery without Neynar and without a
  server-side index; another node (`FC_ROOT_HUB_URL`) moves it to that node's operator.
- **A-FORYOU-SAMPLE** — activity is a follow's newest LIKE: a follow that only recasts is not found active; follows past
  the 1,000 most recently followed are never checked; the sample is the first 40 found, in follow order, not the 40 most
  active of all.
- **A-FORYOU-PROOF-FLOOR** — "Liked by 2 people you follow" counts the sampled follows' newest 25 likes and recasts;
  "Followed by 9" counts their newest 50 follows. Both are floors, never a network total.
- **A-FORYOU-GRAPH-LOCAL** — there is no network-wide ranking (the node keeps no counts), so For You is what the root's
  own graph surfaces; a root with few or quiet follows sees little, and the page says how many it checked.
- **A-FORYOU-COST** — a full load costs up to about 1,200 node reads and 2.6 MB for a large, quiet graph (measured); a
  light refresh about 2 reads per sampled follow plus 1 per account, and posts newly liked.
- **A-FORYOU-RELAY-NOT-FALLBACK** — when the read relay is armed, the root's For You still comes from the hub; a root
  who wants the relay's curated author list has no switch for it in v1.
- **A-FORYOU-TAB-MEMORY** — as A-HUBREAD-TAB-MEMORY: each reload reads again.

**Measured by:** `scripts/unit-hub-foryou.mjs` (13 checks and 38 bundle mutations, each caught: the exact reads and page
sizes; the candidates equal to the stub's ground truth for the keyed half, with their proofs; never the root, a followed
account or an own persona (two of them, one the root follows), never named in a read; the activity check's stop and cap,
8 in flight, 30 accounts; the keyed half's derivation, stability and reach into secondary reads; the mode's order under
recency, engagement, affinity and a lens, a muted word, hide-all, the gaps, an unreadable mode, zero node reads across
eight switches; progressive with nothing blinking out; every failure loud, partials counted, Retry; true empties; 429;
the light and full refresh; persona separation; identity; injected records dropped, a post dated 40 years ahead left
out) and `scripts/accept-hub-foryou-prod.mjs` (the production shape: For You filling progressively with candidates only,
each proof exact, never by an account the root follows or by the root; the coverage sentence equal to what the node was
asked; the real pill's recency-only and engagement-only modes in order with zero node reads; what the app server, the
validator and the node saw; a failed read as an error and Retry; zero node reads while a persona acts).

## 41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode

**Status (2026-11-07): built, test data only, not deployed; ships DORMANT.** No money, no auction clock, no advertiser
but the house: those are Phases 2 to 5 of `docs/roadmap/ad-auction.md`. The only ad that exists is the owner's house
placeholder, reviewed and signed in `public/ads/lots.json`.

**The switch.** Ads run only while the public app has `ADS=on` (`lib/ads/switch.ts`); the app then hands every tab
`ADS=on` with the other device hints (`lib/device/deviceEnv.server.ts`). Unset, empty or `off` (the default a deploy
ships with) is dormant: the plan places no ad on any feed and says "Ads aren't running on Totem yet.", which Settings,
Modes shows beside each mode's ad setting (still editable); `/ads/lots.json` is still served. Any other value stays off,
and the boot log names the variable, never the value. A page script that sets the hint in its own tab only shows itself
the house ads anyone can read at `/ads/lots.json`: it grants nothing. Everything below describes ads switched on.

**What it is.** On the live site, the real Following (§36) carries a promoted post at position 5 and then every 15th
position (5, 20, 35, 50 …), never as the last row, never in a thread, a profile or any other page, and never in Event
Safe Space. Which ad goes there is decided by the visitor's own tab: the ad dial of the mode the page was shaped under
(No ads, Generic ads only, or Matched to this mode), the lots in the shipped list that passed review, and what this
identity hid. Each ad is labelled "House ad" (or "Ad") with "Why this ad?" ("Shown because you're in Sports mode.", or
"Shown to everyone who has ads on. Nothing about you or your mode picked it."), "Hide this ad" and "Hide ads from …",
and an Undo on the line a hide leaves; Settings, Modes lists what was hidden and shows it all again. The code:
`lib/ads/` (lots and the review check, the dial, matching and placements, the plan, the sealed hides, the policy and the
pinned reviewers), `lib/injection.ts` (fixed slots), `app/api/ads/route.ts` (a device route), `components/ads/`,
`components/hub/HubFollowing.tsx`, the dial in `components/settings/ModeBuilder.tsx` and `PATCH /api/modes`, and
`scripts/ads-approve.mjs` (the review).

**The lot list.** `public/ads/lots.json` is ONE list, the same for everyone, shipped inside the app's device bundle and
served read-only at `/ads/lots.json` so anyone can read it. A lot is one placement (Following, or For You once For You
reads from the hub: the same plan with `placement: "forYou"`, slots at 3, 18, 33 …) × one audience (generic, or the
words of a mode name such as "Sports"; no tier, attestation, graph fact or anything about a person) with the advertiser,
the creative (body, headline, an https link, a button) and a house mark. The tab never fetches it: it is part of the code
it already loaded, so no request says that the tab looked at ads, let alone which one it showed.

**Creative review.** A lot is listed only when its `review` is an approval under the current policy
(`totem-ad-policy/1`, the spec's suggested bans: scams or fraud, unlicensed financial offers, political ads, adult
content), by an Ed25519 key pinned in `lib/ads/reviewers.json`, whose signature verifies over the line
`layers-ad-review/1|<policy>|<lot id>|<sha256 of the lot's terms>|<decision>|<day>` (`lib/ads/canonical.mjs`, the same
code in the tab and in the signing script). So an edit to any word after review, a change of policy, a rejection, an
unknown or small-order key, a malformed lot, a link that is not https or a repeated id is never shown. The reviewer's
private key is a random seed on the reviewer's own machine (`.keystore/ad-reviewer.json`, gitignored); only its public
half is in the repository. This is an owner-signed list, not the anon moderators' device-derived keys (§31): those
live in a browser vault, and this list is signed where it is edited, on the owner's machine.

**The dial, per mode, sealed with the mode.** `ModeDefinition.adDial` (`none`, `generic`, `matched`) is a field of the
mode, so it is sealed exactly as modes are (the `modes` namespace, one opaque record) and belongs to the identity that
owns the mode. With no setting: generic in a public identity's modes, none in a private persona's, none when the owner
cannot be placed. A mode with `allowAds === false` (Event Safe Space and its copies) is none whatever is stored, and
`PATCH /api/modes` refuses to set it to anything else (400 `ads_forced_off`), refuses a word that is not a setting
(400 `bad_ad_dial`) and refuses to set a mode of another identity (409 `other_identity`). The dial is a viewer's
preference, not part of an algorithm: an exported algo or lens does not carry it. The sample world's own test-data ads
(the Wave 6 market demo, graph-matched) are switched off by "No ads" too, and are not part of this phase.

**Hidden ads, sealed.** "Hide this ad" and "Hide ads from …" are kept in ONE record of the vault namespace `adHides`
(`lib/ads/hides.ts`), sealed under the vault key and padded to exactly 4,096 bytes of ciphertext whatever it holds,
holding each identity's hidden lot ids and advertiser ids under that identity's id; at most 48 ids in all, and past that
a hide is refused with a sentence, never written over an older one. Every device seals the empty record at boot
(uniform presence). The seen-record discipline applies (§37): an unreadable record, or one that vanished after this
device sealed it, means NO ads on the page, said ("Couldn't read the ads you've hidden, so no ads are shown here"), never
the ads this identity hid.

**Identity.** Ads are decided for the acting identity only. The plan takes the id of the mode the page was shaped
under and refuses (409 `identity_changed`) when that mode is not the acting identity's own, so a page made for the root
never gets a persona's ads, or the other way round; on Following that is always the root, since §36's reads stop while a
persona acts. Hides are read and written under the acting identity's id only, so a persona's hidden ads never apply to
the root and the root's never to a persona. A hide must carry back the opaque tag of the identity its ad was shown to (a
per-tab salted hash, never sent anywhere), and the identity is asked again right before the write: a switch in between
writes nothing. Matching reads the mode's NAME and nothing else about the viewer: the same mode name gives the same ads
to any identity. `/api/ads` is on the root's own write list (`lib/device/actingRoot.ts`, "what I see").

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| Totem's app server | that the app (and `/ads/lots.json`) was downloaded, as for anyone; the Settings page's own refreshes, as before | which ad any tab showed, the dial, what was hidden, Why this ad, a tap: the plan runs in the tab and makes no request |
| Totem's validator | that this root's `adHides` record and its `modes` record were rewritten, at a time, as fixed-size ciphertext (A-ADS-HIDE-WRITE-TIMING) | which ad, advertiser, mode or identity; the dial's value |
| The Farcaster node the tab reads | nothing new: placing, explaining, hiding and showing ads again cause zero node reads | that ads exist |
| The advertiser (the house today) | on a tap only: that this browser's address opened its page, at a time, with no Referer and nothing added to the address (A-ADS-CLICK) | who tapped, which identity, which mode, that the ad was shown without a tap |
| Neynar | nothing: it is not used | everything here |
| Someone looking at the screen | the ad, and in Why this ad the mode's name and its dial: what the screen already shows | other identities' dials or hides |

**Measurement.** None. No impression and no click is counted or reported by anyone, Totem included: Phase 4 brings
anonymous impression tokens over an outside relay and noisy totals. Until then an advertiser, the house included, gets
no numbers at all.

**Assumptions, by id.**

- **A-ADS-HIDE-WRITE-TIMING** — the validator sees the `adHides` record rewritten when an identity of this root hides an
  ad or shows one again, and the `modes` record when a dial changes: a time it can tie to the root's vault. It cannot
  read which ad, advertiser, mode or identity, and the record's size never changes.
- **A-ADS-SAME-LIST** — the list is the same for everyone only as far as the app is the same for everyone: whoever
  serves the app could serve one person a different bundle (and then different code, too). The review check means a
  lot nobody with a pinned key approved is refused even if a list is swapped; it does not stop the build's author from
  pinning another key. Phase 2's daily list, served by the validator, is checked against the keys pinned in the app.
- **A-ADS-REVIEWER-KEY** — the review is one owner-held key. Whoever holds `.keystore/ad-reviewer.json` can approve any
  lot; losing it means making a new one (`npm run ads:approve -- --new-reviewer`), which replaces the pinned key, so
  every lot needs approving again. The key that signed the shipped house lots was made in the build worktree and is
  not kept: the owner's first edit of the house ad makes and pins his own.
- **A-ADS-CLICK** — a tap opens the advertiser's page in a new tab with `rel="noopener noreferrer"` and
  `referrerpolicy="no-referrer"`; the advertiser's own site then sees the visitor's address and browser like any visit.
  The link is reviewed as part of the lot (https only); what the advertiser's page does after that is its own. No
  identity rides a tap, but a tap made as the root and one made as a persona from the same browser arrive from the
  same address, which is the network-level link §27's outside relay exists for: an advertiser that sees both can tie
  the two taps together, not to a name.
- **A-ADS-ONLOOKER** — an ad matched to a mode says the mode's name to anyone who sees it ("Shown because you're in
  Sports mode"), which the mode pill already shows. Tier and attestation targeting, which would say more, stays off
  until Phase 4, behind the floor.
- **A-ADS-NO-FLOOR-YET** — the spec's floor (a lot's audience must clear 8 expected daily viewers, or 50 with an
  attestation) is not checked in Phase 1, because no audience is personal: a generic lot goes to everyone with ads on,
  and a mode lot to every mode with that word in its name. The floor comes with Phase 2's lots, which have supply.

**Measured by:** `scripts/unit-ads.mjs` (npm run test:ads-unit: the placements over 13 page sizes and both feeds, never
last, a thread refused, the route device-only; the one injection queue; the dial per mode and its defaults; Event Safe
Space forced and the route's refusals; the review check over ten kinds of lot, a small-order key, unreadable lists and
the SHIPPED list; contextual matching by whole words and Why this ad; hides sealed in one 4,096-byte record that survives
a reload, Undo, show all, a 409, a full record and an unreadable one; identity separation both ways, a stale tag and a
switch before the write; zero network requests; uniform presence; dormant under every value but `on`; 39 mutations, each
caught) and `scripts/accept-ads-prod.mjs`, run twice (dormant: the tab handed no hint and zero ad rows in the real
Following, with the dial saved; and with `PRODLIVE_ADS=on`, the production shape with live mode on: the house ad at rows 5, 20, 35 and 50 of the real
Following with the node's ground truth between them, set to Generic in Settings; Why this ad's lines and the link with
no Referer; hide, Undo, a hidden advertiser surviving a reload, Settings' list and Show them all again, each write one
sealed 4,096-byte record; No ads; Event Safe Space forced off; no request naming an ad, no other host, and zero node
reads from the in-tab ad actions).

## 42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar

**Status (2026-11-07): built, test data only, not deployed. It ships with Neynar OFF on every surface and no spend; the
shape waits for the owner's OK (notes/runbooks/MORNING-NOV-7.md §6).** Measured against the loopback Neynar stub and the loopback
Snapchain stub only; no real Neynar key was used and no real Neynar endpoint was called.

**What it is.** One switch per Farcaster surface, set by the operator as a variable on the public app (never by a
visitor): `FC_SOURCE_FOLLOWING`, `FC_SOURCE_NOTIFICATIONS`, `FC_SOURCE_FORYOU`, `FC_SOURCE_SEARCH`, `FC_SOURCE_COUNTS`,
`FC_SOURCE_CHANNELS`, each `network` (Farcaster's own node; the default, and what unset or blank means), `neynar` (through
the server-side read relay of §19, the one reader of `NEYNAR_READ_API_KEY`) or `auto` (network first; Neynar only for a
read the node cannot answer at all: a capability, never a failure, so a node read that fails is said with Retry and is
never swapped for Neynar at that moment). The code: `lib/fc/source/switch.ts` (the parsing, the hard rule, the boot
lines, the device hints, the labels and the search guard; it imports nothing), `instrumentation.ts` (the boot lines),
`lib/device/deviceEnv.server.ts` (the hints), `lib/fc/readRelay.server.ts` (the gate and the two search ops),
`lib/adapters/neynar/content.ts`, `lib/data.ts` and `lib/feed.ts` (the device's side), `app/api/search/network/route.ts`
and `components/search/NetworkSearchIsland.tsx` (search via Neynar), `components/settings/FcSourcesPanel.tsx` and
`app/(main)/settings/developer/page.tsx` (Settings › Developer), `components/source/SourceLabel.tsx` (the labels).

**What each value does on each surface.**

| Surface | `network` (default) | `neynar` | `auto` |
|---|---|---|---|
| Following | the hub, read by the visitor's browser (§36) | REFUSED at boot, read as network | REFUSED at boot, read as network |
| Notifications | the hub (§37) | REFUSED at boot, read as network | REFUSED at boot, read as network |
| For You | the root's own: the hub (§40); a persona's or a signed-out visitor's: no Neynar | the root's own: still the hub; everyone else: the relay's discovery list (one server-held author list) | = `neynar` (the node cannot answer a For You for a persona, whose reads are never made, or for a visitor with no Farcaster account) |
| Search | the device only (the node has no search) | the device first, then posts and people via the relay's search ops | = `neynar` (the node has no search at all) |
| Like and recast totals | unavailable on posts read from the node (it keeps none) | REFUSED at boot, unavailable | REFUSED at boot, unavailable |
| Channels | not built (coming soon) | not built, off | not built, off |

With no read key (the relay unarmed), `neynar` and `auto` behave as off and say so, at boot ("… but the Neynar read relay
is not armed (no read key): Search via Neynar is OFF"), in Settings › Developer ("Switched to Neynar, but Neynar isn't
connected on this site (no read key), so it is off") and on the page (search: "Search via Neynar is switched on, but
Neynar isn't connected on this site (no read key), so only your device was searched."), never as an empty list that reads
as "nothing on Farcaster". An armed key with every switch at its default reads NOTHING through Neynar: the relay answers
every op `503 fc_source_off` before any token, credit or upstream call.

**The hard rule, and why each decision is what it is.**

- **Following and notifications never go through Neynar or Totem's server, whatever the switch says.** Each is a read of
  one account's own graph; through the relay it would hand that account to Totem's server, and for a persona tie it to
  the address its root reads from. `neynar`/`auto` is refused at boot with the sentence ("Following stays on Farcaster's
  network: read through Neynar, it would hand your account to Totem's server.") and read as network. The relay has no op
  for either (its path check refuses `/notifications` and every following feed but the house account's, §19), the device
  is never handed a hint for them, and `deviceNeynarOn` refuses them by name even if a page script forges one.
- **Refused at boot means said and not honoured, not a refused boot.** A refused boot on the public app is an outage (it
  has no healthcheck path: the relay's own `relayConfig` convention, §19), and the value cannot be honoured anyway: there
  is no Neynar path for those surfaces to fall into. The must-not-ship class (exit 78) is for values some code would act
  on. An unknown value (a typo) likewise reads as network, said once by the variable's name and a length class, never
  the value: network is the safe side.
- **Counts are network-only (decided).** A like or recast total is asked for a cast the visitor is looking at, so the set
  of hashes one tab asks for is that tab's screen; for Following, a fingerprint of the root's follow list, which names
  the root as surely as its fid. Batching and a shared cache change how often the server is asked, not who asked for
  which set: only an outside relay (§27) would break that join, and none runs for reads. The node keeps no totals, so
  totals are unavailable on posts the tab read from the node (the pages already say so, §36). Posts that arrive VIA
  Neynar (For You's discovery list, a Neynar search, a thread opened from one) already carry Neynar's totals in the one
  answer every visitor gets: no count read is ever made. `FC_SOURCE_COUNTS=neynar`/`auto` is refused at boot like
  Following's.
- **For You via Neynar is never the root's own graph** (§40's decision, kept): the relay's discovery op names no visitor
  (a server-held list), so it may serve a persona acting or a signed-out visitor; the signed-in root acting as itself
  keeps the hub's For You whatever the switch says, and the relay is never its fallback. What changed: the relay is
  that source only while `FC_SOURCE_FORYOU` asks for Neynar. Before this pass an armed key alone put discovery on every
  non-root For You (and Explore); now it does not.
- **Search sends a query, never a visitor.** The relay's `search-casts` and `search-users` ops take ONE argument, the
  query, normalised (NFKC, lower case, single spaces; 2 to 64 characters; no control characters), and build
  `/cast/search/?q=<query>&limit=10` and `/user/search/?q=<query>&limit=5`: the path check admits `q` and the server's
  `limit` and nothing else (`viewer_fid`, `author_fid`, `fid`, `cursor`, `channel_id` and `parent_url` are refused by
  name), the route still refuses any body key but `op` and `arg`. The device adds the one guard the relay cannot: a query
  that names one of this visitor's own accounts (a persona's handle, a persona account's fname or fid, the root's fname
  or fid; whole tokens, so `@alice`, `alice` and `alice's` name alice and `malice` does not) is NEVER sent: Totem's
  server would see that name from this browser's address. An own set that cannot be read refuses the send (fail closed)
  and says so. Results pass the same score floor, denylist and field allowlist as discovery, and every one is labelled
  "Via Neynar".
- **Lookups follow the Neynar surfaces.** A thread or profile lookup through the relay is how a card that came via Neynar
  opens, so it is answered only while For You or search is switched to Neynar. With both on the network, the relay
  answers nothing at all. A card read from the node opens from the node (§36), as before.
- **"Show my Farcaster posts here" is retired** (§21, A-SIWF-OWN-PROFILE-READ closed). It was a relay lookup of the
  visitor's OWN fname: a read naming the root. The button is gone, `GET /api/profile?live=1` answers `409 names_you`
  whatever any switch says, and the profile says the account's posts are read from Farcaster's network instead.
- **Not a user toggle (for now).** Most people cannot judge "Neynar or the network" as a privacy choice, so a wrong pick
  would leak quietly; the operator decides per surface, and a later user toggle could cover only the safe surfaces.

**Every feed and result says where it came from.** "From Farcaster's network" (the hub feeds: Following, For You for the
root, Notifications, each with a `data-source="network"` marker), "Via Neynar" (the relay timeline's chip, "Live from
Farcaster · Via Neynar · read-only", and every Neynar search result), "From your device" (the device's own search
results). A persona's For You with the relay armed but the switch on the network says "For You via Neynar is switched off
on this site, so nothing here comes from Neynar." (liveSource `seed`/`network`).

**Settings › Developer** shows each surface's source and why, on every shape, read-only for everyone (no control, no
request: the app server renders it from its own env and the relay's armed boolean, never the key; an unknown value is
shown as "not a value this switch takes", never echoed).

**What each party learns.**

| Party | Learns | Never learns |
|---|---|---|
| The Farcaster node the tab reads | exactly what §36, §37 and §40 say: no switch changes a node read | anything new |
| Totem's app server (the relay) | default: nothing new, the relay answers no op. Search on: each query text sent, the time, and the visitor's address (the buckets keep a salted hash; the platform's logs see the address, A-FCREAD-OPERATOR-SEES-READS); a Neynar result opened as a thread or profile names that hash or handle (§19 A-FCREAD-SHARED-CACHE-OBSERVABLE). For You on: that a tab asked for the shared discovery list (A-SOURCE-DISCOVERY-NOT-ROOT) | a fid, a persona, the root's fname (the guard), a follow list, a screen's hashes (no count op exists) |
| Neynar | the search queries and the discovery request, from Totem's server's address, with Totem's read key | any visitor's address, fid, `viewer_fid` or list |
| Totem's validator | nothing: no source read passes through it | everything here |
| Someone looking at the screen | the labels | which switch the operator chose beyond what the labels say |

**Persona separation.** A persona acting reads nothing from the node (§36). Its For You may read the shared discovery list
(switch on), which names nobody. Its searches go through the relay like the root's, naming nobody, with its own handle
and the root's names caught by the guard. The server sees the same address for the root's tab and a persona's: the
network-level link of §27, unchanged by this section.

**Assumptions, by id.**

- **A-SOURCE-QUERY-IS-INTEREST** — a Neynar search says what the visitor is interested in: to Totem's server, with the
  visitor's address and the time; to Neynar, from Totem's address. It never carries who they are, but the server can join
  queries by address with anything else that address does (§27) until reads go through an outside relay.
- **A-SOURCE-GUARD-WHOLE-NAMES** — the guard catches whole-token handles, fnames and fids of the accounts this vault holds;
  a nickname, a display name, a misspelling or a description of oneself is what the visitor typed, and is sent.
- **A-SOURCE-DISCOVERY-NOT-ROOT** — with `FC_SOURCE_FORYOU=neynar`, the discovery list is read only by tabs where no
  signed-in root acts, so a discovery read says "no root was acting in this tab then": weaker than the address link of
  §27, and only when the operator switched it on. The fix, if it matters: the root's tab reads the list too (uniform
  presence), shown or not.
- **A-SOURCE-SEARCH-COST-ASSUMED** — `/v2/farcaster/user/search` is 10 credits (Neynar's compute-units page, read
  2026-11-07); `/v2/farcaster/cast/search` is not on that page and is ASSUMED 4 × limit = 40 until the first real arming
  measures it. Both are lookups: the 70% lookup reserve, the 5% per-address daily share and the per-request token of §19
  bound them.
- **A-SOURCE-SEARCH-SHAPE-UNVERIFIED** — the search answers (`result.casts`, `result.users`) and the trailing-slash paths
  are the documented ones, served by the stub; a real answer has not been read. An unreadable shape is an upstream failure
  (fc_read_upstream), never an empty result.
- **A-SOURCE-HINT-PAGE-SETTABLE** — the device hints are page-settable like every device hint; a forged
  `FC_SOURCE_SEARCH=neynar` makes the tab ask, and the relay answers `503 fc_source_off` with no upstream call. A forged
  hint for Following or notifications does nothing (no path reads it).
- **A-SOURCE-COUNTS-NONE** — posts read from the node have no network totals; ranking by likes or recasts on Following
  stays unavailable (§36), on For You it counts only the people you follow (§40).

**Measured by:** `scripts/unit-fc-source.mjs` (npm run test:fc-source-unit: 10 checks and 28 mutations, each caught: the parsing over 14 values on 6 surfaces; the hard rule under every value, armed and not, with a forged device hint; For You and search armed and unarmed; the hints; the relay obeying the server's switch with zero upstream fetches by default; a search as one GET of q and limit, one upstream read for three spellings, 11 path shapes and 7 arguments refused, the score floor; the own-account guard over 15 own and 10 near-miss queries; the labels; the wiring) and
`scripts/accept-fc-source-prod.mjs` (npm run test:fc-source-prod, run twice on the production shape with the relay armed
on the stub: every switch `neynar`, and every switch unset: 10 of 10 each. Every switch neynar: the tab handed exactly the For You and search hints; the boot refusing Following, notifications and counts with the sentence; Settings › Developer; the real Following (79 node reads) and Notifications (13) with zero Neynar requests and zero relay reads; a search answered device first, then 1 post and 1 person Via Neynar, the relay sent {op, arg} only and the stub q and limit only; 5 own-account queries kept on the device; a persona's For You via Neynar, live; live=1 409 names_you; 5 upstream requests in all, 0 violations, none naming the root or her persona. Unset: no hint, network everywhere, "isn't switched to Neynar" on search, the persona's For You saying Neynar is switched off, and ZERO upstream requests and ZERO relay reads over the whole run), with `scripts/unit-fcread-relay.mjs`
and `scripts/accept-fcread.mjs` (now run with `PRODLIVE_FC_SOURCES=foryou=neynar`) unchanged otherwise, and
`scripts/accept-siwf-prod.mjs` P11 (the retired button: no lookup of the fname, `409 names_you`).
