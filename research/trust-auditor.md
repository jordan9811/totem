# Trust-Model & Soundness Auditor — ZK Research Committee

Role 4 of the committee. Written 2026-08-30. Independent findings; not
reconciled with the other roles.

Required reading completed: notes/reports/REPORT-CRYPTO.md (full, incl. SECURITY
POSTURE), notes/reports/REPORT-FC.md (attribution index + live Gate 4), notes/design/architecture-v3.md
(disclosure model, "What the real track must implement"), notes/reports/REPORT-MEGA.md
§"circuit spec" (grant canonical form, the three resolution predicates, fork
ops).

Verification discipline: every claim below is tagged **[WEB]** (verified on
the live web 2026-08-30, source in the Sources table) or **[MEM]** (from
model memory, unverified — treat as a lead, not a fact). Memory-only claims
about audits, soundness, or maintenance are additionally flagged in §7.

---

## 0. What this layer must compose with (the audit surface as-built)

From notes/reports/REPORT-CRYPTO.md, the parts that constrain the trust analysis:

- One 32-byte root seed; HKDF-SHA256 branches → per-nonce Ed25519 persona
  sign keys, an AES-256-GCM vault key, a device-auth key. Grants are
  Ed25519-signed over a frozen canonical form
  (`kind|from|to|audience|tier|issuedAt|revokedAt`), verified fail-closed at
  every decision gate. ~1.1–1.4 ms per Ed25519 verify.
- personaId = `"p_" + SHA256(rootSecret + ":" + nonce)` — SHA-256, NOT a
  ZK-friendly hash.
- Every validator write rides a **device-signed envelope** with a
  per-namespace monotonic counter, chained to a registered anchor key.
- The validator is trusted for availability + ordering only; it already
  sees metadata (sizes, timing, which namespaces change when).
- The remaining plaintext linkage: the FC attribution index
  (castHash → personaId) and the fact that the client evaluates disclosure
  predicates over a grant set it holds.

Three composition facts that are themselves trust-model findings:

1. **The submission channel is the first deanonymizer.** Any ZK proof
   submitted through the existing envelope-signed write path is linked to a
   device, hence to a root, by the envelope signature itself — before any
   circuit runs. A ZK layer here REQUIRES a second, unauthenticated,
   rate-limited submission path (plus IP hygiene), which cuts against the
   validator's current "every write is device-authorized" model. No circuit
   choice fixes this; it is an architecture requirement. (Analysis, not a
   library fact.)
2. **The verifier's seat matters.** If the validator is the only party that
   runs proof verification, then every OTHER client is trusting the
   validator's word that a proof existed — soundness protects the verifier,
   and the verifier is the party we call untrusted. Attribution/rep claims
   must either carry the proof so clients re-verify (proofs are small; Ed25519
   precedent in this repo says per-object verification at decision gates is
   affordable), or the validator quietly re-enters the TCB for integrity.
3. **Ed25519-in-circuit is the most dangerous road.** The existing
   signatures are over edwards25519; proving them inside a BN254 circuit
   means non-native big-integer emulation — precisely the circuit territory
   where the flagship historical under-constraint bugs live (circom-pairing
   BigLessThan, circom-bigint — see §5). A design that instead commits to
   grant/root material with a ZK-friendly hash (Poseidon) alongside the
   Ed25519 layer keeps circuits small and standard. From a soundness
   standpoint this is the single highest-leverage design choice available.

---

## 1. Per-family: SETUP reality

### 1.1 Groth16 / circom (snarkjs stack)

- **Setup: circuit-specific trusted setup.** Phase 1 is universal — the
  Perpetual Powers of Tau ceremony run by the Ethereum/PSE community;
  reusing its output is standard practice and the published transcripts are
  independently verifiable. **[WEB]** (privacy-ethereum/perpetualpowersoftau;
  ZoKrates docs describe exactly this reuse pattern; FC'25 SoK on
  powers-of-tau setups exists.)
- **Phase 2 is per-circuit and per-circuit-VERSION.** Every constraint
  change — even one — requires a fresh phase-2 ceremony. For this project
  (predicates still evolving: linkage, forward, audience, revocation,
  rep-threshold) that is a recurring operational tax, not a one-time event.
- **What running one actually takes (small team, 2026):** download the ptau
  for your circuit size; `snarkjs zkey new/contribute/verify`; recruit N
  genuinely independent contributors (one honest one suffices, but the
  INDEPENDENCE is the whole security claim — 3 laptops in one house is
  theater); finalize with a public random beacon; publish the transcript +
  r1cs + final zkey and the exact `snarkjs zkey verify` command. PSE's
  p0tion tooling automates coordination and has run 15+ ceremonies;
  phase 2 is reported ~4x faster / 3x lighter than phase 1. **[WEB]**
  (PSE p0tion retrospective on mirror.xyz; FC'25 SoK.) Realistic cost:
  days of coordination per circuit version, not months — but it recurs on
  every circuit change.
- **If skipped or faked:** whoever holds the phase-2 toxic waste can forge
  a valid proof for ANY statement in that circuit — forged "rep ≥ T",
  forged "same human", forged non-revocation — and, because proofs are
  zero-knowledge, **forgery is undetectable in principle, forever**. There
  is no on-chain anomaly, no double-spend artifact, nothing a sweep can
  see. A solo-dev setup means the dev (and anyone who ever compromises that
  machine) is a silent universal forger. A *faked* ceremony (published
  transcript that doesn't verify) is only caught if someone actually runs
  `snarkjs zkey verify` against the ptau + r1cs — which nobody does by
  default. Precedent that transcripts matter: the Zcash BCTV14
  counterfeiting flaw (Gabizon, 2018; disclosed 2019) was exploitable using
  elements recoverable *from the published ceremony transcript* —
  setup-adjacent flaws are not hypothetical. **[WEB]** (Electric Coin Co.
  remediation post; CVE-2019-7167.)
- **Stack maintenance:** snarkjs v0.7.6 released 2026-01-26; actively
  maintained; that release added public-input checks in the Groth16/Plonk/
  fflonk verifiers and moved to audited noble-hashes. License GPL-3.0.
  **[WEB]** (iden3/snarkjs releases.) GPL-3 in a shipped browser bundle is
  a real licensing decision for a product — flagged (§7 F14).

### 1.2 PLONK-family: UltraHonk / Noir (barretenberg)

- **Setup: universal SRS (KZG over BN254), circuit-independent.** One
  ceremony, reused for every circuit; circuit changes need NO new ceremony.
  This is a major operational advantage over Groth16 for a small team with
  evolving circuits.
- **SRS provenance:** the canonical BN254 universal SRS options are Aztec
  Ignition (completed Jan 2020, ~176–200 participants, publicly verifiable
  transcript; gnark and others independently consume it via
  gnark-ignition-verifier) and Perpetual Powers of Tau. Trusting either
  requires only ONE honest ceremony participant. Reasonable — with the
  caveat that you must verify the SRS bytes your prover actually downloads
  ARE the ceremony output (barretenberg fetches its SRS at setup; the
  binding between "the file bb downloaded" and "the Ignition transcript" is
  something to check once, explicitly). **[WEB]** (Aztec Ignition
  announcement; Consensys gnark-ignition-verifier.)
- **Soundness history — the live item:** Aztec's own 2026 pre-launch notes
  disclose a **critical vulnerability in the proving system found
  2026-07-27** (internal AI-assisted audit): an attacker could construct a
  proof that passes verification for a transaction the network should
  reject. Patched in their V6 circuits; no evidence of exploitation, but
  they state historical exploitation cannot be ruled out from data.
  A separate barretenberg vulnerability found by Consensys Diligence + TU
  Vienna is rated "critical for Noir". **[WEB]** (aztec.network Aztec 2.0
  pre-launch notes, fetched 2026-08-30.) Read: UltraHonk/barretenberg is a
  moving, actively-exploited-by-auditors codebase in 2026 — powerful, well
  resourced, NOT yet a frozen audited artifact. Aztec ran a three-firm
  comparative audit exercise (zkSecurity, Zellic, Spearbit) on the Bigfield
  primitive as mainnet prep. **[WEB]** (aztec.network blog.)
- Noir/bb browser proving is first-class (NoirJS, bb.js WASM) **[WEB]**,
  which matters here only insofar as the trust story: you are trusting a
  large C++/WASM codebase, its compiler (Noir → ACIR), and its backend, all
  under active churn. Every layer is a place a compiler bug can silently
  drop constraints (Noir has had exactly this class of bug — "critical for
  Noir" above).

### 1.3 halo2 (PSE fork / Zcash)

- **Setup:** the Zcash-original halo2 is transparent (IPA accumulation, no
  trusted setup); the PSE fork is KZG-based (universal SRS, same provenance
  story as §1.2). **[MEM]** on the IPA/KZG split — verify.
- **Maintenance reality 2026:** **PSE-halo2 has been in maintenance mode
  since January 2025** — no feature PRs reviewed; Axiom's fork recommended
  for new work. **[WEB]** (privacy-ethereum/halo2 repo notice.) Building a
  new privacy product on a library whose flagship fork is in maintenance
  mode is a trust-model negative regardless of the math.
- **Soundness history:** a "query collision" soundness bug affecting
  edge-case circuits was found (disclosed to Zcash, PSE, Axiom; all
  patched). **[WEB]** (search result summary; primary source not fetched —
  verify, §7 F15.) Kudelski and Trail of Bits have published substantive
  halo2 security analyses. **[WEB]** (links in Sources.)
- halo2 is also the hardest of the families to write circuits in (raw
  constraint system, rotation/region footguns) — auditor availability is
  thinner and per-circuit audit cost higher. **[MEM]**.

### 1.4 STARK / zkVM (RISC Zero, SP1, Plonky3-family)

- **Setup: transparent — no ceremony at all.** Hash-based, no toxic waste.
  This is the family's entire trust-model advantage.
- **What you pay instead:** (a) proof size (tens–hundreds of KB vs ~200 B
  Groth16) — for this project proofs live in HTTP bodies, so tolerable but
  metadata-relevant; (b) browser proving cost (role 3's domain); and
  crucially (c) **the soundness surface moves from your 500-line circuit to
  a 100k-line VM constraint system**, and 2025 was the year that surface
  visibly cracked:
  - **RISC Zero CVE-2025-52484** (found 2025-05-15): a missing constraint
    in the rv32im circuit let a malicious prover confuse rs1/rs2 register
    values for ANY 3-register instruction — a complete soundness
    compromise of risc0-zkvm 2.0.0–2.0.2. Patched. **[WEB]** (GitHub
    advisory GHSA-g3qg-6746-3mg9; HackenProof writeup.)
  - **SP1: a working exploit** from the interaction of two vulnerabilities,
    responsibly disclosed by LambdaClass + 3MI Labs + Aligned (malicious
    prover could produce invalid-but-accepted proofs via an unverified
    tracking list); plus a separate SP1 Hypercube bug found via the
    Ethereum Foundation's formal-verification effort; plus a public
    transparency debate about how Succinct handled disclosure. **[WEB]**
    (LambdaClass blog; zkevm.ethereum.foundation blog; Blockworks.)
  - Academic fuzzers are now finding zkVM soundness/completeness bugs
    systematically (ARGUZZ, USENIX Security '26 prepub). **[WEB]**
- Verdict-shaped observation: zkVMs remove the setup flag and the
  hand-written-circuit flag, and replace them with a "we trust a huge,
  young, actively-broken VM circuit" flag. For proofs as small as this
  project's predicates, that trade buys little.

### 1.5 Semaphore v4 (as protocol)

- **Setup:** circom/Groth16 underneath — but the setup is DONE and
  published: the v4 trusted-setup ceremony completed 2024-07-13 with 400+
  participants. Using stock Semaphore circuits means inheriting a real,
  large, verifiable ceremony instead of running one. **[WEB]**
  (docs.semaphore.pse.dev; ceremony attestation gist.)
- **Audit:** Semaphore 4.0.0 audited by PSE (Mridul, Yufei Li, Kyle
  Charbonnet), March 2024 — contracts, TypeScript, and the circom circuits.
  **[WEB]** (Semaphore_4.0.0_Audit.pdf on semaphore.pse.dev.) Audit
  quality/scope not independently assessed here — read the PDF (§7 F3).
- **Maintenance:** latest release v4.14.3 dated 08 Jul (year ambiguous on
  the fetched page — could be 2025; releases page shows steady activity
  through at least 2024; **verify current-year liveness directly**, §7
  F13). License MIT. **[MEM]** on license.
- **The catch for THIS project:** Semaphore's guarantees hold for its
  STOCK circuit (membership + scoped nullifier + signal). Layers needs
  rep-thresholds, revocation/blocking, and grant predicates — every one of
  those is a circuit modification or companion circuit, and **the moment
  you touch the circuit, the audit and the 400-participant ceremony no
  longer cover what you ship**. New circuit ⇒ new phase-2 ceremony ⇒ new
  audit. The "audited standard primitive" property is real but fragile;
  designs that compose stock Semaphore groups (e.g., one group per rep
  tier, membership proof against the tier group) keep the property; designs
  that edit the circuit lose it.
- Identity mismatch: Semaphore identities are EdDSA-BabyJubJub/Poseidon,
  not Ed25519. Deriving the Semaphore identity secret from the existing
  seed via a new HKDF branch (`layers/v1/zk-id/…`) composes cleanly with
  REPORT-CRYPTO's hierarchy; trying to reuse the Ed25519 keys in-circuit
  does not (see §0.3). **[MEM]** on Semaphore's identity scheme details.

### 1.6 RLN (Rate-Limiting Nullifier)

- **Setup:** circom/Groth16; Veridise audit (2023, 8 person-weeks, incl.
  formal verification of the circuits post-fix; no critical circuit bugs
  found) and a yAcademy/yAudit review exist. **[WEB]** (VAR-RLN.pdf;
  yAudit report repo.) Ceremony status for the exact deployed zkeys:
  not verified here — check which zkey you'd consume (§7 F10).
- **Trust-model specialty — slashing IS key leakage by design:** RLN
  enforces rate limits by making a second signal in an epoch reveal shares
  of the member's secret. If that secret were root-derived carelessly, a
  slash could burn more than the persona — it must be a dedicated leaf
  secret, never the root seed or a reusable branch. Scoping mistakes here
  are identity-destroying, not just linking.
- Fit note: RLN answers the per-persona ANTI-SPAM budget question, not the
  disclosure predicates. It is a good citizen for the anonymous submission
  channel from §0.1 (rate-limit the unauthenticated proof endpoint without
  identifying callers).

---

## 2. Anonymity failure modes — done wrong, in THIS system

These hold regardless of proof-system family. A perfectly sound circuit
loses to every one of them.

### 2.1 Small anonymity sets (~100 roots at launch)

A membership proof says "one of the leaves of tree version V". With 100
roots, every proof starts at k=100 and only shrinks:

- **Public-signal partitioning:** "rep ≥ Gold" restricts to leaves that
  could satisfy it. If 6 roots hold Gold, k=6. If the tier thresholds are
  public inputs (they will be — the verifier needs them), every proof
  partitions the set by every public input it carries.
- **Intersection over time:** the set of members satisfying successive
  proofs' public constraints intersects down. A persona that proves
  "Gold" today and "not-blocked-by-X" tomorrow is in the intersection of
  two subsets. With 100 roots, a handful of proofs can reach k=1 without
  any crypto failing.
- **Join-time correlation:** each leaf insertion is a validator-visible
  event. The first proof referencing tree version V, arriving minutes
  after V was created by one insertion, is the new member with high
  probability. Mitigations are operational: batched/epoch insertions,
  minimum delay before first proof, decoy churn — and honest UX copy that
  early-cohort privacy is weak. k-anonymity is a launch-sequencing
  property, not a circuit property.

### 2.2 Transport correlation at the relay

The validator (or any relay) sees IP, TLS session, cookies, timing, and —
per §0.1 — today would see a device-signed envelope. ZK proofs over an
authenticated channel are pseudonymous at best, deanonymized at worst.
Requirements: a submission path with NO session credentials, no envelope,
idempotent unauthenticated POSTs, RLN-or-PoW rate limiting, and ideally
OHTTP/mixnet-style IP decoupling for the proof endpoint. Also
same-connection correlation: submitting a persona-authored cast and a
root-membership proof over one HTTP/2 connection links them at the socket.

### 2.3 Nullifier scoping mistakes (the project-specific killer)

Nullifiers are deterministic functions of (identity secret, scope). Two
opposite failure modes:

- **Scope too coarse → cross-persona linkage.** If any two proofs made by
  DIFFERENT personas of the same root share (secret, scope), they emit the
  same nullifier, and the validator links the personas — reconstructing
  exactly the plaintext attribution table ZK exists to destroy, except now
  it's math instead of a breach. Concretely: a "not revoked" check with
  scope = "revocation-2026-08" proved once from persona A and once from
  persona B is a linkage oracle. Scope must include the persona context
  (or use per-persona derived ZK identities in per-context groups) whenever
  unlinkability BETWEEN SIBLINGS is required — which is this product's
  headline property.
- **Scope too fine → the property being proved evaporates.** "Same human
  as before" NEEDS nullifier equality across the two events; sybil
  resistance NEEDS one-nullifier-per-root-per-context. Fresh scopes per
  request destroy that.

Every proof type therefore needs an explicit, written nullifier-scope
table (proof type × scope derivation × what equality means × who may see
it), reviewed by a human. This is the single most likely place a subtle
design error silently inverts the privacy goal, and no test sweep will see
it — both scopings "work".

### 2.4 Public inputs / proof metadata leak more than intended

The proof reveals nothing beyond its public inputs — but the public inputs
are chosen by us, and they leak: tree root (⇒ epoch/join window), exact
threshold values (⇒ rep band), timestamps, context ids, message hashes.
Rules: buckets not values (prove ≥ tier, never emit the actual rep);
canonical shared epochs, never per-user freshness; and an explicit review
of every public signal asking "what does the population look like
partitioned by this value?" Also proof-request PATTERNS leak: per
REPORT-MEGA, "a proof system that reveals that a proof was attempted
reintroduces the oracle" — the negative case (viewer not in audience) must
be indistinguishable from no-grant-exists, including on the wire.

### 2.5 The validator's levers: split-view and update-timing

- **Split-view / tree tagging:** the validator serves each client a
  slightly different Merkle root; each proof then reveals which root it was
  built against ⇒ per-user tagging. Mitigations: globally published,
  signed, append-only root history (mirror it into the vault; cross-check
  across devices; or anchor roots on Farcaster/onchain), and clients
  refusing roots not in the published history. This must be designed in —
  it is the ZK-era analogue of the key-directory TOFU problem
  REPORT-CRYPTO already states honestly for pubkeys.
- **Update-timing correlation:** §2.1's join-time attack, plus
  revocation-timing (a block appears at t; the persona that stops proving
  non-revocation right after t is the blocked one).

---

## 3. Soundness failure modes (with the historical record)

### 3.1 Under-constrained circuits — the dominant real-world bug class

Circom's programming model computes witnesses with `<--` and constrains
with `===`; forgetting the constraint half compiles, proves, and verifies
honest inputs perfectly — and lets a malicious prover substitute anything.
The community-maintained 0xPARC zk-bug-tracker catalogs dozens of in-the-
wild instances; the canonical near-miss is **circom-pairing's
CoreVerifyPubkeyG1**: BigLessThan outputs were computed but never
constrained, so inputs ≥ the curve prime were accepted — a
"million-dollar bug" caught by Veridise pre-exploit. Veridise's circomlib
audit found 14 issues, 9 critical. The SoK "What don't we know?"
(arXiv 2402.15293) systematizes the class. **[WEB]** (0xPARC tracker;
Veridise circom-pairing writeup; Veridise circomlib audit page;
VAR-circom-bigint.pdf; arXiv.) Non-native big-integer arithmetic (which
Ed25519-in-circuit would force) is precisely where these live.

### 3.2 Missing range checks / aliasing → witness forgery

Field elements wrap mod p. Missing range checks let "x fits in 64 bits"
or "a < b" be violated by wraparound; the input-aliasing family
(x vs x+q) produced **CVE-2023-33252**: snarkjs ≤ 0.6.11 accepted public
signals ≥ the field modulus, enabling double-spend-style proof replay
with mutated-but-equivalent public inputs. Fixed by range-checking public
inputs; snarkjs 0.7.6 (2026) added further verifier-side public-input
checks. **[WEB]** (Acunetix CVE page; SECBIT input-aliasing writeup;
snarkjs releases; snarkjs issues #358/#383.) Layers-specific: timestamps
(`issuedAt`, `revokedAt > now`) and tier comparisons are exactly the
comparisons that need explicit range constraints in any custom predicate
circuit.

### 3.3 Proof malleability and context binding

Groth16 proofs are re-randomizable: a third party can take a valid proof
and produce a different valid proof of the same statement (snarkjs issues
#358/#383 document the double-spend consequence when systems key on proof
bytes). **[WEB]** Consequences here: never deduplicate or authorize by
proof-hash; bind every proof to its context by putting the
action/message/session hash INSIDE the public inputs (signal hashing,
as Semaphore does), otherwise a proof made for one context can be replayed
into another (e.g., a "rep ≥ T" proof captured from one gate replayed to a
different gate). Nullifiers stop double-USE only where a nullifier is
recorded — read-only gates need explicit context binding.

### 3.4 Fiat-Shamir done wrong — Frozen Heart

Trail of Bits' 2022 coordinated disclosure: weak Fiat-Shamir (challenge
not bound to the full statement + public inputs) allowed proof FORGERY in
multiple production implementations — including Dusk's PLONK, **iden3's
snarkjs**, and Consensys' gnark; a follow-up survey found 36 affected
implementations. All named parties patched in 2022. **[WEB]** (Trail of
Bits blog series.) Lesson for us: transcript-hashing bugs are
implementation bugs in LIBRARIES we would consume — a reason to pin
versions, watch advisories, and prefer implementations with post-2022
audit coverage of their transcripts.

### 3.5 Verifier-integration bugs (where sound circuits still lose)

- **Verifying-key/params swap:** the verifier checks "valid proof under
  THIS vkey". If the vkey the validator loads is attacker-influenced (file
  on the untrusted server, unpinned download), soundness is void — the
  attacker verifies proofs from their own circuit. The vkey must be pinned
  in the client/app build (and its hash published), never fetched from the
  validator it guards. Same for any SRS the verifier consumes.
- **Wrong-circuit acceptance:** several proof types will coexist
  (linkage, audience, rep, revocation). A verifier that dispatches on a
  client-supplied "type" field without binding type → vkey lets a proof of
  the cheap statement satisfy the expensive gate. Bind proof-type into
  public inputs AND the dispatch table.
- **Public-input count/order:** verifiers that don't pin the exact public
  signal layout accept permuted/truncated signal vectors (historical
  snarkjs-adjacent bugs; the 0.7.6 release adding "public inputs checks"
  is this class being fixed AGAIN in 2026). **[WEB]**
- **Fail-open on verifier error:** this repo's own "never fail open" rule
  applies verbatim — a throwing verifier must read as REJECT. The Ed25519
  `verifyCanonical` never-throws discipline from REPORT-CRYPTO is the
  right template.
- **The Zcash BCTV14 flaw** (§1.1) belongs here too: even a
  correctly-implemented verifier of a subtly-wrong PAPER accepted
  transformed proofs; it survived two audits and 3 years. **[WEB]**

### 3.6 Library-level history (the stack we'd consume)

| Library | Status 2026-08-30 | Known history |
|---|---|---|
| snarkjs | v0.7.6 (2026-01-26), active, GPL-3 **[WEB]** | CVE-2023-33252 aliasing; Frozen Heart 2022; malleability issues #358/#383; 0.7.6 adds verifier input checks **[WEB]** |
| circomlib | audited by Veridise (14 issues, 9 critical, fixed; 20k+ lines Coq) **[WEB]** | the audit exists BECAUSE the bugs did |
| circom compiler | active (iden3) **[WEB]** | compiler-introduced constraint bugs exist as a class **[MEM]** |
| barretenberg/bb.js | active, heavily funded; three-firm audit exercise; NOT frozen **[WEB]** | critical proving-system vuln found 2026-07-27 (patched); second vuln "critical for Noir" (Consensys Diligence + TU Vienna) **[WEB]** |
| halo2 (PSE) | **maintenance mode since 2025-01** **[WEB]** | query-collision soundness bug, patched (Zcash/PSE/Axiom) **[WEB-secondary; verify]** |
| risc0 | active | CVE-2025-52484 full soundness break in 2.0.0–2.0.2, patched **[WEB]** |
| SP1 | active | LambdaClass-disclosed exploit; Hypercube FV bug; disclosure-transparency controversy **[WEB]** |
| Semaphore v4 | audited 2024-03; ceremony 2024-07 (400+); release cadence needs a liveness check **[WEB]** | no public critical circuit bug found post-audit **[MEM]** |
| RLN circuits | Veridise 2023 audit + FV; yAudit review **[WEB]** | no critical circuit bugs in audit **[WEB]** |

---

## 4. THE BLUNT SECTION — what our test methodology cannot catch

This repo's evidence culture is behavioral: 42-suite sweeps, 4-consecutive-
clean gates, adversarial tamper tests driven through dev hooks, leak greps.
That methodology is excellent at what it measures — and it measures
**completeness and specific anticipated negatives only**. For a ZK layer:

1. **Soundness is behaviorally invisible.** A sweep proves "honest proofs
   verify" and "the specific forgeries we scripted are rejected". An
   under-constrained circuit satisfies BOTH: honest witnesses still
   satisfy the (too-few) constraints, and your scripted tamper cases fail
   for unrelated reasons. The forgery that kills you is a witness you
   didn't think to construct — by definition outside the suite. RISC Zero's
   CVE-2025-52484 shipped through that project's entire test apparatus;
   circom-pairing's bug survived its tests. Green sweeps are ZERO evidence
   of soundness. **The only real assurances:** independent expert audit of
   the circuits; formal tools (below); deliberate adversarial proving
   (a standing "forge harness" that mutates witnesses at every signal and
   asserts rejection — necessary, still insufficient); and time-in-
   production of UNMODIFIED audited circuits.
2. **Zero-knowledge-ness is behaviorally invisible.** No assertion can see
   that public inputs + nullifier scoping + timing jointly identify a
   root. Leakage is a property of the DISTRIBUTION of everything observable,
   not of any response body — our leak greps scan for known plaintext
   needles and would pass while §2.1–2.5 leak everything. Real assurances:
   a written leakage budget per proof type (every public signal enumerated
   and justified), the nullifier-scope table (§2.3) reviewed by a human,
   and adversarial traffic analysis — none of which is a test that can go
   green.
3. **Setup integrity is behaviorally invisible.** A backdoored zkey
   verifies every honest proof identically to an honest zkey. No sweep
   distinguishes them. Real assurances: run/verify the ceremony
   (`snarkjs zkey verify` against published ptau + r1cs), publish
   artifacts + instructions, use ceremonies with many independent
   participants (Semaphore's 400+; Ignition's ~200), or use a transparent
   system. "We generated the zkey on the dev laptop" is an unfalsifiable
   universal-forgery capability.
4. **Side-channel linkage is behaviorally invisible.** Envelope/IP/timing
   correlation (§2.2, §2.5), proving-time variation as a function of
   witness values (WASM provers are not constant-time **[MEM]**), and
   request-pattern oracles are all off-suite. Real assurances: transport
   architecture review, constant-shape responses on the negative path, and
   red-team traffic analysis.
5. **What the suites CAN and SHOULD still do:** completeness regression
   (honest flows never break), verifier fail-closed behavior, vkey pinning
   (assert the loaded vkey hash equals the built-in constant), nullifier
   uniqueness bookkeeping, replay/context-binding rejection with recorded
   vectors, and the forge harness of #1. These are worth building — as long
   as the report line says "completeness + pinned negatives", never
   "soundness verified".

**Formal-tool reality check (2026):** Circomspect (Trail of Bits) — static
analyzer/linter for circom, open-source, integrated into Sindri's CLI;
finds pattern-level under-constraints, not a proof of soundness. **[WEB]**
Picus/QED² (Veridise) — automated UNIQUENESS (strong-safety) verification
of circom/R1CS/gnark circuits, MIT-licensed, PLDI'23 paper; real
limitations self-documented: SMT timeouts ("unknown"), poor performance on
hash-heavy circuits, needs circuit-splitting. **[WEB]** Ecne (0xPARC) —
weak/strong safety checking; maintenance status unverified, likely
dormant. **[MEM]** Veridise's Coq-based circomlib proofs show machine-
checked circuit verification is possible but is a consulting engagement,
not a CI step. **[WEB]** Net: run Circomspect in CI, run Picus on every
custom circuit and treat "unknown" as un-shipped, and still buy the human
audit — the tools reduce, not replace, it.

---

## 5. Family verdicts from the trust seat only

(Fit/perf are other roles' calls; this is purely trust/soundness posture.)

- **Stock Semaphore v4 (unmodified circuits):** best available trust
  posture — audited artifact + completed 400-participant ceremony +
  MIT + small circuit. The posture DEGRADES TO GROTH16-CUSTOM the moment
  the circuit is edited. Composition via multiple stock groups preserves
  it; that constraint should shape the architecture.
- **Custom circom/Groth16 circuits:** highest soundness risk per line
  (under-constraint class) + recurring per-version ceremonies. Acceptable
  only with Picus + Circomspect + external audit + published ceremony per
  version. Budget accordingly or don't take this road.
- **Noir/UltraHonk:** no per-circuit ceremony (big win), good browser
  story, serious security investment — but an actively-churning stack with
  a critical 2026 proving-system bug on record and audits still rolling.
  Trust posture in 2026: promising, not settled. Pin versions, track
  advisories, treat compiler + backend as audit surface.
- **halo2:** PSE fork in maintenance mode; highest circuit-authoring
  difficulty; no advantage for this project's small predicates. Trust
  posture: avoid for new work here.
- **zkVMs (SP1/RISC Zero):** transparent setup, but 2025's record of full
  soundness breaks in both major zkVMs says the family's assurance story
  is younger than its marketing. Overkill surface for predicates this
  small.
- **RLN:** audited, narrow, the right tool for anonymous-endpoint rate
  limiting; its slashing-by-key-leakage semantics demand a dedicated leaf
  secret and careful epoch scoping.

Two cross-cutting requirements that outrank family choice:
(1) the anonymous submission channel (§0.1, §2.2) — without it every
family is equally deanonymized; (2) the nullifier-scope table (§2.3) —
without it every family can be made to link siblings.

---

## 6. Sources

| # | URL | What it established | Checked |
|---|---|---|---|
| 1 | github.com/iden3/snarkjs/releases | v0.7.6 2026-01-26; verifier public-input checks added; active; GPL-3 | 2026-08-30 |
| 2 | semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf | Semaphore 4.0.0 audit, PSE, March 2024 (contracts+TS+circuits) | 2026-08-30 |
| 3 | docs.semaphore.pse.dev (+ ceremony attestation gist) | v4 trusted-setup ceremony completed 2024-07-13, 400+ participants | 2026-08-30 |
| 4 | github.com/semaphore-protocol/semaphore/releases | latest v4.14.3 dated 08 Jul (year ambiguous on page) | 2026-08-30 |
| 5 | aztec.network/blog/aztec-2-0-pre-launch-notes | critical proving-system vuln found 2026-07-27 (AI-assisted internal audit), patched in V6; second bb vuln critical-for-Noir (Consensys Diligence + TU Vienna); no exploitation evidence but history not provable | 2026-08-30 |
| 6 | aztec.network/blog/security-of-the-aztec-network-audits-of-bigfield | three-firm comparative audit (zkSecurity, Zellic, Spearbit) as mainnet prep | 2026-08-30 |
| 7 | github.com/0xPARC/zk-bug-tracker | community catalog of real ZK bugs; under-constraint as dominant class | 2026-08-30 |
| 8 | medium.com/veridise/circom-pairing-a-million-dollar-zk-bug-caught-early | BigLessThan outputs unconstrained in CoreVerifyPubkeyG1 | 2026-08-30 |
| 9 | veridise.com/audits-archive/company/circomlib/ (+ VAR-circom-bigint.pdf) | circomlib audit: 14 issues, 9 critical; Coq proofs | 2026-08-30 |
| 10 | acunetix CVE-2023-33252 page; secbit.io input-aliasing post; github snarkjs issues #358, #383 | snarkjs ≤0.6.11 public-signal aliasing; Groth16 malleability double-spend reports | 2026-08-30 |
| 11 | blog.trailofbits.com Frozen Heart series (2022-04) | weak Fiat-Shamir forgery in Dusk PLONK, snarkjs, gnark; patched 2022 | 2026-08-30 |
| 12 | electriccoin.co/blog/zcash-counterfeiting-vulnerability-successfully-remediated | BCTV14 counterfeiting; exploitable from published ceremony transcript; CVE-2019-7167 | 2026-08-30 |
| 13 | github.com/advisories/GHSA-g3qg-6746-3mg9 (CVE-2025-52484); hackenproof writeup | RISC Zero rv32im missing constraint = full soundness break, 2.0.0–2.0.2 | 2026-08-30 |
| 14 | blog.lambdaclass.com SP1 responsible-disclosure post; zkevm.ethereum.foundation/blog/sp1-fv; blockworks.co/news/succinct-sp1-bug | SP1 exploit (two interacting vulns); Hypercube FV bug; disclosure debate | 2026-08-30 |
| 15 | mirror.xyz PSE p0tion retrospective; github.com/privacy-ethereum/perpetualpowersoftau; ZoKrates trusted-setup docs; FC'25 SoK (fc25.ifca.ai/preproceedings/159.pdf) | phase-1 reuse pattern; p0tion 15+ ceremonies; phase-2 cost profile | 2026-08-30 |
| 16 | aztec.network/blog/announcing-ignition; github.com/Consensys/gnark-ignition-verifier | Ignition ceremony Jan 2020, ~176–200 participants, independently verifiable/consumed | 2026-08-30 |
| 17 | github.com/privacy-ethereum/halo2 | PSE halo2 in maintenance mode since Jan 2025; Axiom fork recommended | 2026-08-30 |
| 18 | veridise.com VAR-RLN.pdf; hackmd yAcademy RLN review | RLN circuits audited (8 person-weeks + FV); no critical circuit bugs | 2026-08-30 |
| 19 | blog.trailofbits.com circomspect posts; docs.veridise.com/picus; github.com/Veridise/Picus | Circomspect maintained/integrated (Sindri); Picus MIT, PLDI'23, timeout/hash limitations self-documented | 2026-08-30 |
| 20 | arxiv.org/pdf/2402.15293 (SNARK vuln SoK); USENIX Sec'26 ARGUZZ prepub | systematization of SNARK bug classes; zkVM fuzzing finds soundness bugs | 2026-08-30 |

Repo sources: notes/reports/REPORT-CRYPTO.md, notes/reports/REPORT-FC.md, notes/design/architecture-v3.md,
notes/reports/REPORT-MEGA.md §"circuit spec" (all read in full or in the named
sections, 2026-08-30).

---

## 7. FLAGS — human verification required (over-inclusive by design)

Every entry: claim / why it matters / how to verify / confidence / what
changes it.

**F1 — Anonymous submission channel is a hard prerequisite.**
Claim: proofs sent via the existing device-envelope write path (or any
authenticated/IP-correlated channel) are deanonymized regardless of proof
system. Why: the envelope signature chains to the anchor → root; the
entire ZK property is void. Verify: have a systems-privacy-competent human
review the planned proof-submission transport (no envelope, no cookies,
RLN/PoW rate limit, IP mitigation, constant-shape negatives); confirm the
validator codebase cannot correlate the two channels by connection.
Confidence this is required: HIGH. Changes it: nothing — this is
structural.

**F2 — Nullifier-scope table must be human-reviewed.**
Claim: at least one natural scoping of "same-human"/"not-revoked" proofs
links sibling personas (§2.3). Why: silent inversion of the product's
headline guarantee; both scopings pass all tests. Verify: write the
proof-type × scope × equality-semantics table and have a ZK-competent
human adversarially derive what an observing validator learns from
nullifier equality across personas, contexts, and epochs. Confidence
that a mistake here is likely without review: HIGH. Changes it: a
reviewed, versioned scope spec with a written linkage argument.

**F3 — Semaphore v4 audit scope actually covers what we'd rely on.**
Claim: the March 2024 PSE audit covers the v4 circuits as shipped, and no
critical circuit bug has surfaced since. Why: the whole "audited standard
primitive" argument rests on it; the no-bugs-since half is [MEM]. Verify:
read Semaphore_4.0.0_Audit.pdf end-to-end (scope section + findings);
search the Semaphore repo/security advisories and PSE Discord for
post-2024 circuit issues; confirm the npm packages you'd install
correspond to the audited circuit commits and the ceremony zkeys.
Confidence: MEDIUM-HIGH on the audit's existence (fetched), LOW on
"nothing since" (memory). Changes it: the PDF + advisory search.

**F4 — Any modification of Semaphore circuits forfeits audit + ceremony.**
Claim: rep-thresholds/revocation as circuit edits produce an unaudited
custom Groth16 circuit needing its own phase-2 ceremony. Why: teams
routinely keep citing the upstream audit after forking; that would be a
false safety claim. Verify: ask a ZK auditor whether the planned design
uses stock circuits byte-for-byte (zkey hash equality against the
published ceremony artifacts is the test). Confidence: HIGH (structural).
Changes it: a design constrained to stock-circuit composition.

**F5 — Phase-2 ceremony execution and verification, per custom circuit.**
Claim: a skipped/faked/solo ceremony = undetectable universal forgery of
that circuit's statements, forever (§1.1). Why: silently destroys
soundness with zero behavioral signal; Zcash precedent shows even
transcript CONTENTS can be lethal. Verify: if any custom circuit ships —
run the ceremony with genuinely independent contributors (p0tion),
publish ptau/r1cs/zkey + transcript, and have a third party actually run
`snarkjs zkey verify`; record the zkey hash in the repo and assert it at
verifier load. Confidence: HIGH. Changes it: nothing; this is the Groth16
deal.

**F6 — Aztec/barretenberg 2026 vulnerability status.**
Claim: a critical proving-system vuln was found 2026-07-27 and patched in
their V6 circuits; a second bb vuln is "critical for Noir"; therefore
UltraHonk is not yet a settled audited artifact. Why: if Noir/UltraHonk is
chosen (the no-ceremony advantage is real), version choice and advisory
tracking become safety-critical. Verify: read the Aztec 2.0 pre-launch
notes and any linked advisories; check the exact bb/bb.js versions the
patches landed in; ask Aztec (or check their security page) whether the
Noir-critical issue affects standalone Noir+bb usage outside the Aztec
network. Confidence in the facts as fetched: MEDIUM-HIGH (single source,
their own blog); in the interpretation: MEDIUM. Changes it: primary
advisories + a maintainer answer.

**F7 — Anonymity set at launch is ~100 roots and shrinks under public
inputs; early cohort privacy is weak.**
Claim: with N≈100, intersection + join-timing + threshold partitioning
can reach k≈1 without breaking any crypto. Why: users would be sold
unlinkability the system cannot yet deliver. Verify: run the arithmetic
against real expected cohort sizes and tier distributions (a spreadsheet,
not a paper); decide and DOCUMENT minimum-set thresholds below which
proof features stay dark (e.g., a tier gate refuses to enable until ≥K
eligible members); have UX copy reviewed against it. Confidence: HIGH
(it's counting). Changes it: launch-cohort math showing larger sets.

**F8 — Split-view/tree-tagging defense must exist.**
Claim: a malicious validator serving per-user Merkle roots deanonymizes
every prover; a published signed append-only root history + client
cross-checks is required. Why: the operator is exactly the adversary in
scope. Verify: ZK-competent review of the tree-update protocol; check how
Semaphore deployments handle root freshness/history (docs + code);
decide where the root history is anchored (vault mirror, Farcaster cast,
chain). Confidence: HIGH that the attack exists; MEDIUM on best
mitigation choice. Changes it: reviewed protocol spec.

**F9 — Groth16 proof malleability / context binding.**
Claim: Groth16 proofs are re-randomizable; any gate keyed on proof bytes
or lacking message binding in public inputs is replayable (§3.3).
Why: cross-context replay of "rep ≥ T" proofs. Verify: auditor confirms
every proof type binds context/message in public inputs; test vectors for
replay-into-wrong-gate. Confidence: HIGH ([WEB] snarkjs issues + [MEM]
literature). Changes it: audit of the binding scheme.

**F10 — RLN zkey/ceremony provenance for the deployed artifact.**
Claim: RLN circuits were audited (Veridise 2023) but the ceremony status
of whichever zkey we'd consume was NOT verified here. Why: audited
circuit + unverified zkey still = forgeable. Verify: identify the exact
rln zkey artifact; find its ceremony transcript; run zkey verify.
Confidence in audit existence: HIGH (PDF found); in artifact provenance:
LOW. Changes it: the transcript check.

**F11 — RLN slashing secret must be a dedicated leaf, never root-derived
reusable material.**
Claim: RLN reveals identity-secret shares on rate violation by design; a
careless derivation burns more than intended. Why: identity-destroying
failure on a spam event. Verify: ZK-competent review of the key-derivation
branch feeding RLN (`layers/v1/...`), confirming compromise blast radius
is one persona-context. Confidence: HIGH that the property exists (audit
docs); design review still required. Changes it: the derivation spec.

**F12 — Formal tools are reducers, not verifiers.**
Claim: Circomspect is a linter; Picus proves uniqueness only, times out on
hash-heavy circuits, and "unknown" ≠ safe; Ecne's maintenance is
unverified. Why: a green tool run will be tempting to report as
"soundness verified" — it is not. Verify: run Picus on any custom circuit
and read its actual verdict per template; check Ecne's repo activity
before relying on it; budget a human audit regardless. Confidence: HIGH
on the limitation (self-documented [WEB]); LOW on Ecne status ([MEM]).
Changes it: nothing for the limitation; a repo check for Ecne.

**F13 — Semaphore maintenance liveness in 2026.**
Claim: latest release v4.14.3 shows "08 Jul" with the year ambiguous on
the fetched page; sustained 2025–2026 activity is UNCONFIRMED. Why: an
unmaintained protocol is a slow-motion trust failure (no advisory channel,
no fixes). Verify: open github.com/semaphore-protocol/semaphore — commit
dates, open-issue triage latency, PSE's current project status page.
Confidence: LOW either way. Changes it: five minutes on the repo.

**F14 — Licenses.**
Claim: snarkjs is GPL-3 [WEB]; circom compiler GPL-3 [MEM]; Semaphore MIT
[MEM]; Picus MIT [WEB]; barretenberg/bb.js license [MEM-unverified,
believed Apache-2.0]. Why: GPL-3 in a distributed browser bundle has
copyleft implications for a commercial product. Verify: read each LICENSE
file at the pinned version; counsel if commercial distribution planned.
Confidence: mixed as tagged. Changes it: the LICENSE files.

**F15 — halo2 query-collision bug details.**
Claim: a soundness bug ("query collision") existed in Zcash/PSE/Axiom
halo2 and was patched. Why: only material if halo2 is chosen (this report
recommends against); but it also illustrates that even mature PLONK
implementations had recent soundness bugs. Verify: locate the primary
disclosure (zkSecurity/Axiom/Zcash advisories) — my source was a search
summary, not the primary. Confidence: MEDIUM. Changes it: the primary
advisory.

**F16 — WASM prover side channels.**
Claim: browser provers are not constant-time; proving time/memory may
correlate with witness values (e.g., rep magnitude, tree position).
Why: a timing-observant validator could bucket provers. Verify: benchmark
proving time variance across witness values for the chosen circuit; ask
the proving-library maintainers about constant-time claims. Confidence:
LOW-MEDIUM ([MEM], plausible, unmeasured). Changes it: the benchmark.

**F17 — Poseidon (and any ZK-friendly hash we adopt) parameter and
implementation provenance.**
Claim: moving commitments to Poseidon for circuit-friendliness imports a
newer, less-cryptanalyzed hash plus parameter-generation trust. Why: the
commitment layer becomes load-bearing for both hiding and binding.
Verify: use only widely-deployed parameter sets (Semaphore/circomlib's),
check for post-2024 cryptanalysis of Poseidon instances, and note that
circomlib's Poseidon was in the audited set (Veridise). Confidence:
MEDIUM ([MEM] beyond the circomlib audit). Changes it: a literature check
by a cryptographer.

**F18 — Proofs must be client-verifiable, not validator-attested.**
Claim: any rep/attribution claim that other clients accept on the
validator's say-so re-centralizes integrity trust (§0.2). Why: the ZK
layer's point is removing the operator from the trust base; a
validator-attested "proof checked ✓" bit restores it invisibly. Verify:
architecture review — every proof-derived fact served to third parties
either carries the proof + public inputs for local verification (with the
pinned vkey), or is explicitly documented as validator-trusted. Confidence:
HIGH (structural). Changes it: the interface spec.

**F19 — The behavioral-test blind spot must be stated in every future
report.** Claim: green sweeps over the ZK layer will prove completeness
and pinned negatives ONLY; soundness, ZK-ness, setup integrity, and
side-channel linkage are untestable behaviorally (§4). Why: this
project's reporting culture (rightly) treats 4-consecutive-green as
closure evidence; for ZK that convention would silently overclaim.
Verify: n/a — adopt as a standing reporting rule; the closure bar for ZK
gates must name the external assurance (audit/ceremony-verify/formal run)
that stands in for the untestable property. Confidence: HIGH. Changes it:
nothing.
