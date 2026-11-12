# PRIMITIVE SCOUT — ZK membership / reputation / attribution options, as of 2026-08-30

Role: survey the real option space for the Layers ZK layer. Independent
findings; a synthesis pass reconciles. Every claim is tagged
**[WEB-VERIFIED <date>]** (checked live this pass, URL given) or
**[MEMORY]** (model training data, unverified — treat as a lead, not a fact).

Read against: notes/reports/REPORT-CRYPTO.md (Ed25519/HKDF hierarchy + vault + device
delegation, all real), notes/reports/REPORT-FC.md (the live castHash→personaId index ZK
must harden), notes/design/architecture-v3.md + notes/reports/REPORT-MEGA.md §"THE CIRCUIT SPEC"
(the three grant predicates, persona derivation, fork ops).

---

## 0. Executive summary

**The single most important scouting finding is architectural, not a
library pick: we almost certainly do NOT need Ed25519 verification inside
a circuit — and every path that does need it is bad in 2026.**

Layers controls its own key derivation (one 32-byte seed, HKDF branches,
REPORT-CRYPTO Gate 0). That means the ZK layer can add a *sibling HKDF
branch* (e.g. `layers/v1/zk-identity/<nonce>`) that derives a
circuit-friendly identity (Semaphore-style EdDSA/BabyJubJub, or a plain
Poseidon commitment) from the SAME root, per persona or per root. The
binding between the existing Ed25519 persona key and the ZK identity is
then established ONCE, outside the circuit, by an Ed25519-signed
registration statement (verified by the validator exactly like every
other signed object it already verifies) — and all subsequent proofs are
cheap native-field Merkle-membership + nullifier proofs. Ed25519-in-circuit
(the ~2M-constraint monster) is only forced on you if you must prove
statements about *existing* Ed25519 signatures with no opportunity to
co-register a ZK identity. We have that opportunity. This is the
"compose, don't verify-in-circuit" seam, and it converts the curve
mismatch from a blocker into a one-time registration step.

Given that, the field sorts cleanly:

| Option | Verdict | One-line reason |
|---|---|---|
| **Semaphore v4** | **FITS (base layer)** | Audited (PSE 2024), MIT, actively maintained (v4.14.3, 2026-07-08), browser-first Groth16, exactly our predicate shape: anonymous membership + scoped nullifier + signal |
| **zk-kit** (LeanIMT, eddsa-poseidon, poseidon) | **FITS (toolbox)** | The maintained PSE component library Semaphore itself is built from; audited-in-context via the Semaphore v4 audit |
| **RLN (circom-rln / zerokit)** | **FITS (rate-budget angle)** | Audited circuits (yAcademy + Veridise 2023); the per-epoch rate-limit + slashing mechanism is the persona-budget primitive; circuits dormant-but-done, Rust impl (zerokit) actively maintained by Vac/Waku |
| **UniRep** | **PARTIAL — adopt the design, flag the dependency** | Mechanism is nearly our spec (anonymous per-epoch keys, reputation attested to a hidden identity, prove "rep ≥ T"); maintenance post-PSE-pivot is uncertain |
| **Sismo-style attestations** | **NO as a product (Sismo is dead); the pattern collapses into Semaphore-style membership** | Sismo wound down (reported Nov 2023); 2026 successors (zkTLS, zkEmail, zkPassport-class) solve web2-data import, not our root-linkage problem |
| **circom + snarkjs (Groth16)** | **FITS (as Semaphore's substrate)** | Most battle-tested browser stack; smallest proofs; cost: per-circuit trusted setup + GPL-3 snarkjs license + circom DSL foot-guns for any NOVEL circuit |
| **Noir + Barretenberg (UltraHonk)** | **FITS (best for the custom grant-predicate circuits)** | No per-circuit ceremony, Apache/MIT, ~1–3 s browser proving for signature-scale circuits, Aztec-funded and very active; younger audit surface than circom/Groth16 |
| **o1js (Mina)** | PARTIAL — browser-native TS + audited (Veridise 2024) but Mina-shaped (Pasta curves, Kimchi); poor fit for our Poseidon/BN254 neighbours | |
| **gnark** | NO for client proving (Go→server-side); fine as a server-side verifier/prover if ever needed. Apache-2.0, v0.15.0 (2026-05) | |
| **halo2 (PSE fork)** | **NO for new work** — PSE fork in maintenance mode since Jan 2025; Axiom fork for features; high circuit-dev cost; known (patched) query-collision soundness bug history | |
| **STARK family (Stwo/Cairo)** | PARTIAL/WATCH — transparent (no setup), real browser/WASM demos, S-two live on Starknet mainnet; but audit reports not yet published and proofs are large; ecosystem pull toward Starknet | |
| **zkVMs (SP1, RISC Zero)** | **NO for our client-side private-witness proofs** — proving is not browser-feasible, and delegated proving hands the WITNESS (the root secret's derivatives) to the proving network, which reintroduces the exact linkage leak ZK exists to remove. Keep on the shelf for server-side proofs over public data | |
| **Ed25519-in-circuit libs** | **AVOID** — circom impl unaudited + ~2M constraints; Noir impl community-new (2026) and unaudited; the registration-binding design makes them unnecessary | |

License gotcha worth stating up front: **snarkjs is GPL-3** (circom the
compiler too). Semaphore itself is MIT, but its browser prover bundles
snarkjs — shipping that in a commercial client is a licensing question a
human should answer (flag F9).

---

## 1. What the circuit must actually prove (recap, from the repo)

From REPORT-MEGA §CIRCUIT SPEC + architecture-v3:

- **P1 — persona derivation:** `personaId = H(rootSecret, nonce)` for a
  committed root, without revealing the root. (Standard preimage.)
- **P2 — grant possession:** "I hold a signed, unrevoked grant of kind K
  naming me" without revealing which grant, and *the negative case leaks
  nothing* (hidden = absence of a row).
- **P3 — root-level predicates:** "reputation(root) ≥ T", "same human as
  before" (persistent nullifier), "root not revoked/blocked", "root holds
  attestation X" — all without identifying the root among its siblings.
- **Binding:** all of it must compose with Ed25519 persona keys derived
  by HKDF from the same seed (REPORT-CRYPTO Gate 0 tree).

Every option below is judged against P1–P3 + the binding + browser
proving + audit status.

---

## 2. The curve question, settled first

Our keys are **Ed25519 over Curve25519** (noble/curves, REPORT-CRYPTO).
Virtually every browser-practical ZK gadget signs/verifies **EdDSA over
BabyJubJub** (a curve embedded in BN254's scalar field, so in-circuit
operations are native and cheap). These are *different curves*; an
Ed25519 signature cannot be verified by a BabyJubJub gadget, period.

Three ways out, in order of sanity:

1. **Bind at derivation, not in-circuit (RECOMMENDED).** Add an HKDF
   branch deriving a ZK identity secret per persona (or per root) from
   the same seed. Publish `commitment = Poseidon(zkSecret)` (or a
   Semaphore v4 EdDSA identity commitment) in a registration object
   *signed by the persona's Ed25519 key* — the validator already
   verifies signed registrations (the `/keys` directory, REPORT-CRYPTO
   Gate 0 decision 4). The circuit then only ever touches Poseidon /
   BabyJubJub — native-field, fast, audited gadgets. Cost: one more
   public registration row per persona; the Ed25519↔ZK binding is a
   signed claim, not a proof. Determinism and recovery (Gate 4) fall out
   of HKDF for free, same as every other branch.
2. **Ed25519 verification in-circuit.** Electron Labs' `ed25519-circom`:
   ~2M constraints per signature, README says NOT audited / not
   production-ready; historical proving 16 min → ~90 s targets, nowhere
   near browser [WEB-VERIFIED 2026-08-30, github.com/Electron-Labs/ed25519-circom
   + medium.com/electron-labs]. A Noir RFC-8032 implementation
   (noir-ed25519 over noir-bignum) surfaced on the Aztec forum June 2026
   — new, community, unaudited [WEB-VERIFIED 2026-08-30,
   forum.aztec.network/t/review-my-noir-ed25519-signature-verification/8604].
   Non-native-field arithmetic makes this permanently expensive.
3. **zkVM precompiles.** SP1 and RISC Zero both accelerate ed25519
   verification [WEB-VERIFIED 2026-08-30, succinct blog]. But zkVM
   proving is not browser-feasible, and outsourcing it leaks the witness
   (see §5.6). Dead end for private-witness client proofs.

Option 1 wins. It is also the only one that keeps the "audited, standard
primitives" rule intact.

---

## 3. The Semaphore family

### 3.1 Semaphore v4 — VERDICT: FITS (the base membership layer)

**What it proves.** A member of a group (a Merkle tree of identity
commitments) proves membership and broadcasts a signal (arbitrary
message) with a **nullifier** scoped to an external "scope" value —
one nullifier per (identity, scope), so the verifier can detect
double-signaling within a scope without ever learning which member
signed. v4 identities are **EdDSA (BabyJubJub, eddsa-poseidon)** key
pairs; groups are **LeanIMT** incremental Merkle trees; proofs are
**Groth16 via snarkjs**, generated in browser or Node
[WEB-VERIFIED 2026-08-30, docs.semaphore.pse.dev + audit PDF; the
EdDSA/LeanIMT structure also MEMORY-corroborated].

Mapped to our predicates: group = "all registered roots (or personas) at
rep-tier ≥ T", "all not-revoked roots", "holders of attestation X";
scope = the Farcaster cast context / epoch / gate id; nullifier = "same
human as before" persistence and one-persona-per-context budgets; signal
= the castHash or grant-request being attributed. This is P2/P3 almost
verbatim. P1 (persona = H(root, nonce)) needs a small custom circuit or
happens implicitly by deriving the ZK identity from the root branch.

**Maturity / audit.** PSE audit, March 2024, covering v4.0.0 contracts,
circuits, and TS libraries, including zk-kit LeanIMT components; findings
fixed (e.g. missing admin check in `_addMember`, PR 702)
[WEB-VERIFIED 2026-08-30, semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf].
Auditor is PSE's internal security team (Mridul, Yufei Li, Kyle
Charbonnet) — an internal audit, not a third-party firm; flag F1.
Groth16 requires a trusted setup: v4 ran its own ceremony [MEMORY —
verify artifacts; flag F2].

**Maintenance.** Latest release v4.14.3 published **2026-07-08**
[WEB-VERIFIED 2026-08-30, api.github.com/repos/semaphore-protocol/semaphore/releases/latest;
npm dist-tag latest = 4.14.3]. PSE's Sept-2025 "Privacy Stewards of
Ethereum" reorg names Semaphore among its production-ready pieces
[WEB-VERIFIED 2026-08-30, theblock.co + pse.dev roadmap coverage].
Also shipped in Rust (semaphore-rs) for native iOS/Android [MEMORY-corroborated
by search snippet; verify — flag F3].

**Browser proving.** Runs fully in-browser (snarkjs WASM). The docs
publish benchmark charts but as images; exact ms numbers could not be
extracted this pass [WEB-VERIFIED 2026-08-30, docs.semaphore.pse.dev/benchmarks
— page fetched, numbers are in PNGs]. From memory, v4 proof generation
for realistic group sizes is sub-second to low seconds in a desktop
browser, faster than v3 because LeanIMT gives dynamic (shallow) depth
[MEMORY — flag F4: run the benchmark on target hardware; the
browser-perf role should own this].

**License.** MIT (protocol libraries) [MEMORY — high confidence, verify
in repo]; but the proving path bundles GPL-3 snarkjs (flag F9).

**Fit notes / gaps.** Native Semaphore gives set-membership + nullifier +
signal. It does NOT natively give: range proofs over reputation values
(you get it by *group construction* — one group per tier threshold,
updated by the rep engine — or by a custom circuit reading a rep leaf),
revocation as exclusion (you get it by removing members from the tree —
LeanIMT supports updates — or by a separate exclusion set), or the
pairwise-grant predicate P2 (custom circuit territory; Semaphore's
gadgets and zk-kit trees are the right parts bin). "Groups as tier
buckets" is the unopinionated-rails move: general primitive, no bespoke
protocol.

### 3.2 zk-kit — VERDICT: FITS (the parts bin)

PSE's monorepo of reusable ZK components: LeanIMT (TS/Solidity/circom),
IMT, **eddsa-poseidon** (BabyJubJub EdDSA — the Semaphore v4 identity
scheme), Poseidon implementations, plus Rust ports (zk-kit.rust).
Actively maintained: PRs/releases from late 2024 through 2026
[WEB-VERIFIED 2026-08-30, github.com/privacy-scaling-explorations/zk-kit
releases + pulls]. eddsa-poseidon and LeanIMT were inside the Semaphore
v4 audit scope [WEB-VERIFIED, same audit PDF]. MIT [MEMORY — verify].
This is where the HKDF→ZK-identity branch would source its primitives
(derive 32 bytes via our existing kdf.ts, feed eddsa-poseidon's
key-from-seed path).

### 3.3 RLN — VERDICT: FITS the per-persona/rate-budget angle

**What it proves.** Rate-Limiting Nullifier: a member of a Semaphore-style
group signals with a nullifier per (epoch, message-counter); exceeding
the rate budget in an epoch forces publishing two evaluations of a
degree-1 polynomial whose secret is the member's identity key — i.e.
**spam mathematically self-doxxes (and can be slashed)**, while everyone
under budget stays anonymous. RLN-v2 generalizes to per-member
configurable rate limits and multi-message-id burns
[WEB-VERIFIED 2026-08-30, rfc.vac.dev/vac/32/rln-v1 + vac.dev/rln +
github.com/vacp2p/zerokit].

Mapped to Layers: "a root gets N anonymous personas / N posts per epoch"
— the exact anti-Sybil budget the persona model needs, with the elegant
property that the *punishment for cheating is the linkage itself*.
This composes with Semaphore (same identity commitments, same trees).

**Maturity / audit.** circom-rln circuits reviewed mid-2023 by yAcademy
(yAudit) and Veridise; no critical circuit bugs; findings fixed
[WEB-VERIFIED 2026-08-30, github.com/yAudit/RLN-audit-report +
veridise.com VAR-RLN.pdf]. The circom-rln repo's last push is
**July 2024** — dormant, in the "finished artifact" sense
[WEB-VERIFIED 2026-08-30, api.github.com/repos/rate-limiting-nullifier/circom-rln].
The production-grade implementation is **zerokit** (Rust, Vac/Waku),
actively maintained and running in Waku's live RLN relay
[WEB-VERIFIED 2026-08-30, github.com/vacp2p/zerokit + vac.dev/rlog].
zerokit compiles to WASM for browser use [MEMORY — verify; flag F5].
Licenses: MIT/Apache dual for zerokit [MEMORY — verify].

**Fit notes.** Not a membership/attribution system by itself — it is the
rate-budget attachment to one. Adopt if/when the persona-budget feature
ships; the audited circuits + maintained Rust/WASM library make it the
lowest-novelty path for that specific feature.

### 3.4 UniRep — VERDICT: PARTIAL — the design is our spec; the dependency is a risk

**What it proves.** Anonymous, per-epoch ephemeral keys derived from a
persistent identity secret; attesters give reputation (arbitrary signed
data) to a user's epoch key; the user later proves statements over their
accumulated data — including **"my reputation ≥ T"** — from a fresh
epoch key that no one can link to prior keys. State lives in Merkle
trees (state/epoch/data); proofs are circom/Groth16; identities are
Semaphore-compatible. This is the closest existing system to "reputation
lives on the ROOT and ports across personas without linking them" —
epoch keys ≈ personas, attester data ≈ our rep engine
[MEMORY for mechanism detail — the protocol docs corroborate the outline;
verify against developer.unirep.io before depending on specifics].

**Maturity / audit / maintenance.** Repos under the Unirep org showed
active updates through **Feb 2025**; docs current at 2.1.x
[WEB-VERIFIED 2026-08-30, github.com/Unirep/Unirep + developer.unirep.io].
BUT: PSE's Sept-2025 reorg listed Semaphore and MACI as production-ready
and did not name UniRep; whether UniRep has a funded maintainer in 2026
is unestablished [WEB-VERIFIED that the roadmap coverage omits it;
the inference is mine — flag F6]. Audit status of UniRep v2 circuits:
I could not verify a third-party audit this pass [MEMORY says a PSE
audit existed for v2; UNVERIFIED — flag F6]. GPL/MIT status unverified.

**Fit call.** Steal the architecture (epoch-key derivation, data trees,
the "prove rep ≥ T from an unlinkable key" circuit shape) — it is a
published, reviewed design that matches P3. Adopting the npm packages
wholesale gets ~40k-constraint-class circuits and a protocol surface
sized for a generic attestation network we don't need, with maintenance
risk on top. If the fit-architect role wants it anyway, F6 must clear
first.

### 3.5 Sismo and its successors — VERDICT: NO (and nothing to replace it with, on purpose)

Sismo (ZK badges: prove facts about one wallet from another, unlinkably)
ran into trouble and was reported shutting down in **Nov 2023**
[WEB-VERIFIED 2026-08-30, thebigwhale.io "Sismo in difficulty, could
soon be shut down"; exact wind-down date not re-verified — flag F7].
Its code (Hydra-S1 circuits etc.) is open source but unmaintained
[MEMORY]. The 2026 attestation landscape moved to: **zkTLS** (Reclaim,
zkPass — prove web2 account facts), **zkEmail**, document-identity
systems (zkPassport/Self-class), and plain **EAS** attestations with
custom proofs on top [WEB-VERIFIED 2026-08-30 that these are the cited
successors in 2025 landscape pieces, e.g. Modulo Labs "State of ZK
Applications in 2025"; individual project states not deep-verified].

For Layers this whole category answers a question we don't have: *import
a fact from an external source*. Our attestations originate inside our
own system (rep engine, grants), already signed by keys we control. The
"holds attestation X" predicate is just Merkle membership over
commitments in a tree we operate — Semaphore-shaped, no Sismo-successor
dependency needed. Where external attestations become a roadmap item
(e.g. "prove a Neynar score band"), zkTLS is the aisle to revisit.

---

## 4. Proving stacks for the custom circuits (P1, P2, and any bespoke rep predicate)

Whatever base system we adopt, the pairwise-grant predicate (P2) and the
persona-preimage binding (P1) are **novel circuits** — every one a
human-verification flag by the project's own rule. The stack choice
determines browser reality and audit posture.

### 4.1 circom + snarkjs (Groth16) — FITS as substrate, with known costs

The most battle-tested browser proving path in existence; Semaphore,
RLN, UniRep, Tornado-lineage all live here. snarkjs v0.7.6 released
**2025-01-26**, maintained by iden3; works in Node and directly in the
browser [WEB-VERIFIED 2026-08-30, github.com/iden3/snarkjs releases].
Groth16 gives the smallest proofs (~200 bytes) and fastest verification;
cost: **per-circuit trusted setup** (Powers of Tau + circuit-specific
phase 2 — every circuit revision needs a new ceremony or a
publicly-verifiable setup process; flag F2), and the circom DSL's
under-constraint foot-guns (the classic source of sound-looking unsound
circuits — the trust-auditor role's territory). **License: GPL-3 for
snarkjs and the circom compiler** [WEB-VERIFIED 2026-08-30, github
README states GPL-3] — bundling snarkjs into a distributed client app
has copyleft implications a human should assess (flag F9). Compiled
circuit artifacts (wasm witness generators, zkeys) are our own works
[MEMORY — the licensing of *outputs* is generally considered clean, but
this is a lawyer question, not a crypto question].

Browser reality: witness gen + Groth16 prove in WASM; for
Semaphore-sized circuits (tens of thousands of constraints) this is
sub-second-to-seconds on desktop, several× slower on mid mobile
[MEMORY — flag F4, benchmark].

### 4.2 Noir + Barretenberg (UltraHonk) — FITS; best 2026 choice for NOVEL circuits

Aztec's Rust-like circuit language over the Barretenberg C++ backend,
exposed to browsers via **bb.js** (WASM, multithreaded). UltraHonk needs
**no per-circuit trusted setup** (universal SRS) — that alone removes an
entire ceremony-integrity flag class for every circuit revision. Recent
public benchmarks: UltraHonk browser benchmark suites exist
(weijiekoh/noir_ultrahonk_benchmarks); an in-browser signature
verification (p256 ECDSA) proved in **< 3 s on an M1 Air with
multithreading** in Hyli's 2025 cross-system benchmark, with Noir
5–50× faster than Groth16 counterparts on proof generation in Base's
passkey benchmark [WEB-VERIFIED 2026-08-30, hyli.ghost.io in-browser
p256 benchmark + blog.base.dev benchmarking-zkp-systems +
github.com/weijiekoh/noir_ultrahonk_benchmarks]. Proofs are larger than
Groth16 (KB-class, log-scaling) — fine for a validator verifier, dearer
onchain [MEMORY + L2BEAT barretenberg entry].

Audit posture: Barretenberg/UltraHonk and the Noir compiler have been
under audit as part of Aztec's mainnet push [MEMORY — Aztec published
audits circa 2024–2026; I did not pin the specific reports this pass —
flag F8: locate and read the actual Barretenberg + Noir audit reports
before trusting]. Licenses: Apache-2.0/MIT [MEMORY — high confidence].
Maintenance: very active through 2026 (Aztec mainnet ecosystem; noir-lang
org shipping) [WEB-VERIFIED via active 2026 discussions in noir-lang org].

Fit: write P1/P2 in Noir, verify with bb.js in the validator (or a
Solidity/UltraHonk verifier later). A Poseidon/LeanIMT-compatible
Merkle gadget exists in Noir's stdlib/ecosystem [MEMORY — verify
hash-compatibility with zk-kit trees; a mismatch forces a parallel tree;
flag F10].

### 4.3 o1js (Mina) — PARTIAL

TypeScript-embedded circuits, browser-native by design, recursion
(Pickles) built in; **audited: Veridise, 39 person-weeks, Mar–Jun 2024,
all medium+ findings fixed** [WEB-VERIFIED 2026-08-30,
veridise.com o1js-2024-08-27 + medium highlights]. Apache-2.0 [MEMORY].
Why only partial: it lives on Mina's Pasta curves and Kimchi proof
system — its hashes/curves don't interoperate with the
BN254/Poseidon/BabyJubJub world Semaphore/zk-kit/RLN inhabit, so
choosing o1js means choosing a parallel primitive universe and losing
the audited membership stack. Ed25519 would again be foreign-field.
Only attractive if the whole design were rebuilt around o1js recursion,
which contradicts "bolt-on, not greenfield".

### 4.4 gnark — NO for client proving

Go library, Apache-2.0, v0.15.0 released **2026-05-13**, actively
maintained by Consensys (Linea's stack); audits referenced in its
changelog [WEB-VERIFIED 2026-08-30, github.com/Consensys/gnark +
pkg.go.dev]. Go does not produce browser-practical provers (WASM
binaries + memory profile; no serious in-browser gnark proving story)
[MEMORY]. Useful someday as a server-side prover/verifier or for an
EdDSA-over-BN254 gadget on the backend; not for our client-side
private-witness proofs.

### 4.5 halo2 — NO for new work here

The PSE fork — the one with community features and KZG — entered
**maintenance mode January 2025** ("feature PRs will not be reviewed;
use Axiom's fork") [WEB-VERIFIED 2026-08-30,
github.com/privacy-scaling-explorations/halo2 README]. The Zcash
implementation is audited; the PSE fork's own audit status differs; a
**query-collision soundness bug** affecting Zcash/PSE/Axiom versions was
found and patched [WEB-VERIFIED 2026-08-30, kudelskisecurity.com halo2
analysis + Trail of Bits Axiom deep-dive]. Halo2's raw-plonkish circuit
dev cost is famously high. No trusted setup with IPA (Zcash flavor) /
universal with KZG (PSE flavor). Browser WASM proving is possible and
was used by zk-email-class projects, but heavy [MEMORY]. Nothing here
beats Noir or circom for our shapes in 2026.

### 4.6 STARK family — Stwo / Cairo — PARTIAL, WATCH

StarkWare's next-gen Circle-STARK prover **S-two is open source
(Apache-2.0 [MEMORY]) and live proving Starknet mainnet blocks**;
WASM/WebGPU targets are real (browser demos exist: stwo-wasm-demo,
stwo-web-stark), and client-side proving is an explicit roadmap pillar
[WEB-VERIFIED 2026-08-30, starkware.co s-two posts + starknet.io +
github.com/starkware-libs/stwo + AbdelStark/stwo-wasm-demo].
Transparent — **no trusted setup at all**, which deletes flag-class F2.
BUT: the repo says external audit reports "will be linked as published"
— i.e., **no published audit found this pass** [WEB-VERIFIED 2026-08-30,
stwo repo security section]; proofs are tens-of-KB+; hash-based
primitives (M31 field) don't share gadgets with the Poseidon/BN254
membership ecosystem, so the audited Semaphore/RLN stack doesn't come
along. Verdict: the strongest transparent-setup browser story to
re-evaluate in 12 months; not the 2026 pick for this bolt-on.

### 4.7 zkVMs — SP1, RISC Zero — NO for the core property (with one sharp caveat)

**SP1 (Succinct):** Rust-to-RISC-V zkVM with precompiles including
**ed25519 signature verification**; SP1 Hypercube (2025) proves >93% of
Ethereum blocks under 12 s — on serious server hardware; Hypercube's
audit was announced as upcoming at launch [WEB-VERIFIED 2026-08-30,
succinct blog posts; earlier SP1 versions have published audits —
MEMORY: Veridise/Cantina/KALOS 2024 — verify in succinctlabs/sp1-audits
if adopted]. MIT/Apache [MEMORY].
**RISC Zero:** the most audit-mature zkVM — Veridise ran a 96
person-week two-phase audit of the V2 zkVM (Jul–Dec 2024), and Picus
formal verification of circuit determinism runs in their CI
[WEB-VERIFIED 2026-08-30, veridise.com risc0 reports + risc0/rz-security].
Apache-2.0 [MEMORY]. Also has an ed25519 accelerator [MEMORY].

Why NO anyway: **proving does not run in a browser** at our latency
budget (the browser story for both is verification, not proving), and
the standard workaround — delegate proving to a GPU network (Succinct
Prover Network, Boundless/Bonsai) — means **shipping the private witness
(root-secret derivatives, the grant set) to a third-party prover**. That
re-creates the "operator can see the linkage" hole with a different
operator. The caveat: for *server-side* proofs over data the validator
already legitimately holds (e.g. proving to USERS that the validator
computed reputation honestly — an integrity proof, not a privacy proof),
a zkVM with an ed25519 precompile is the cheapest engineering path, and
composes with our Ed25519 objects natively. That's a different feature
from the unlinkability layer; note it and move on.

---

## 5. Cross-cutting table — browser proving reality (2026)

| Stack | Browser prover | Time scale (signature/membership-class circuit) | Trusted setup | Proof size |
|---|---|---|---|---|
| snarkjs Groth16 (Semaphore v4) | WASM, mature | sub-second–seconds desktop; slower mobile [MEMORY, F4] | Per-circuit (v4 ceremony) | ~200 B |
| Barretenberg UltraHonk (Noir) | WASM + threads, mature | ~1–3 s (M1, p256 sig benchmark) [WEB-VERIFIED] | Universal SRS only | KB-class |
| o1js | Native TS/WASM | seconds–tens of seconds [MEMORY] | None (Kimchi/IPA) | KB-class |
| halo2 | WASM, heavy | tens of seconds historically [MEMORY] | Flavor-dependent | KB-class |
| Stwo | WASM/WebGPU, emerging | demos only at our shapes; fast trajectory [WEB-VERIFIED demos exist] | None | tens of KB |
| SP1 / RISC Zero | Not practical | N/A client-side | None (STARK→SNARK wrap for onchain) | varies |

The 30-second-proof-is-broken constraint rules nothing *in* — it rules
zkVMs and heavyweight halo2 circuits *out*, and it makes Groth16/UltraHonk
membership proofs the only shapes that comfortably fit mobile web today.
Precompute/off-main-thread (web worker) is table stakes regardless;
the browser-perf role owns exact numbers (F4).

---

## 6. Scouting recommendation (for the synthesis pass)

1. **Base layer: Semaphore v4 + zk-kit** (audited, maintained, MIT-core,
   browser-proven, mechanism-exact for membership + nullifier). Groups
   as tier buckets / revocation sets = P3 with zero novel circuits.
2. **Bind to the Ed25519 hierarchy at derivation** (new HKDF branch →
   eddsa-poseidon identity; Ed25519-signed registration binds the two).
   No Ed25519-in-circuit anywhere.
3. **Novel circuits (P1 preimage binding, P2 grant predicate): author in
   Noir/UltraHonk** — no per-circuit ceremony, best 2026 browser
   numbers, permissive license —*unless* the synthesis pass prices
   staying single-stack (circom) above the ceremony + GPL costs.
   Hash-compatibility between zk-kit trees and Noir gadgets must be
   pinned first (F10).
4. **RLN (zerokit)** when the persona-rate-budget feature ships.
5. **UniRep**: mine the design for the reputation-epoch circuits; do not
   take the dependency without clearing F6.
6. Re-evaluate **Stwo** in ~12 months for a transparent-setup migration;
   keep **zkVMs** for server-side integrity proofs only.

---

## 7. FLAGS (over-inclusive, per discipline)

- **F1 — Semaphore v4's audit is internal (PSE), not third-party.**
  Why it matters: the entire membership layer's soundness rides on it;
  an internal audit has different incentives. Verify: read
  https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf end-to-end; check
  whether any third-party audit (e.g. Veridise/zkSecurity) covered v4
  after March 2024; ask in the PSE Discord. Confidence the audit exists
  and findings were fixed: HIGH (fetched). Confidence it is *sufficient*:
  MEDIUM.
- **F2 — Groth16 trusted-setup ceremony for Semaphore v4 (and any circom
  circuit we ship).** Why: a compromised phase-2 setup silently breaks
  soundness (forgeable proofs) with no behavioral symptom — our sweeps
  can never catch it. Verify: locate the v4 ceremony transcript/
  attestations (semaphore-protocol GitHub / p0tion ceremony records),
  confirm the artifact hashes our client would load match the ceremony
  output. Confidence a ceremony happened: MEDIUM [MEMORY]. What changes
  it: the transcript URL in hand.
- **F3 — semaphore-rs native mobile support.** Verify repo existence,
  maintenance, and whether proofs interop with the TS artifacts.
  Confidence: MEDIUM.
- **F4 — Browser/mobile proving times are NOT pinned by this pass.**
  The Semaphore docs' numbers are images; my sub-second claims are
  memory. Why it matters: the 30s-is-broken constraint is the UX gate.
  Verify: run @semaphore-protocol/proof generateProof in Chrome desktop +
  a mid-tier Android on a 2^16-member group; run the
  noir_ultrahonk_benchmarks suite. (This is role 3's job; the poc/
  quarantine exists for it.) Confidence in the order of magnitude: MEDIUM-HIGH.
- **F5 — zerokit WASM/browser support for RLN.** Verify zerokit's wasm
  feature actually ships and its license. Confidence: MEDIUM.
- **F6 — UniRep 2026 maintenance + audit status.** Why: adopting an
  unmaintained protocol for the reputation core is a supply-chain trap.
  Verify: commit activity at github.com/Unirep/Unirep since mid-2025;
  ask PSE whether UniRep has a funded maintainer post-reorg; locate the
  v2 circuit audit (if any). Confidence UniRep is safe to depend on: LOW.
- **F7 — Sismo's exact wind-down and code status.** Minor (we recommend
  against it anyway). Verify via sismo-core GitHub archive status.
  Confidence it is effectively dead: HIGH.
- **F8 — Barretenberg/UltraHonk + Noir compiler audit reports.** Why: if
  we author the novel grant-predicate circuits in Noir, its compiler and
  backend are in the TCB. Verify: Aztec's published audit list
  (aztec.network / their GitHub audits repos), which components + which
  versions; note that a compiler bug can under-constrain YOUR circuit
  invisibly. Confidence audits exist: MEDIUM [MEMORY]. Confidence in
  specific coverage: LOW until read.
- **F9 — snarkjs + circom are GPL-3.** Why: bundling snarkjs in a
  distributed commercial client raises copyleft questions; artifacts
  (zkeys/wasm) are probably fine but that is a legal read, not a
  technical one. Verify: counsel, or swap the proving path to a
  permissive stack (bb.js). Confidence in the license fact: HIGH
  (repo README). Confidence in the implication: LOW (not a lawyer).
- **F10 — Hash/tree compatibility between zk-kit LeanIMT (Poseidon/BN254)
  and Noir's gadgets.** Why: a silent parameter mismatch (Poseidon
  round constants, arity) forks the Merkle world and every proof fails —
  or worse, gets re-implemented by hand. Verify: test vector — build a
  LeanIMT in zk-kit, verify a membership path in a toy Noir circuit.
  Confidence they can be made to match: MEDIUM.
- **F11 — The registration-binding design (Ed25519-signed ZK-identity
  registration) is MY synthesis, not an audited pattern.** Why it
  matters: if the binding is weak (e.g. a validator can register a
  commitment for a persona it doesn't own, or the same ZK identity
  across personas becomes a correlator), unlinkability degrades without
  any circuit being wrong. Verify: put the exact registration statement
  + its uniqueness/anti-correlation rules in front of a ZK-competent
  human; check how Semaphore's own docs recommend binding external
  identities. Confidence the approach is sound in outline: MEDIUM-HIGH;
  in detail: needs the fit-architect + human review.
- **F12 — "Proof attempted" metadata leakage.** REPORT-MEGA's negative
  case: hidden must stay indistinguishable from never-asked. No
  primitive here solves traffic-analysis of *when proofs are requested* —
  that is a protocol-design property (batching, cover traffic, fixed
  polling). Verify: make it an explicit requirement in the synthesis
  architecture. Confidence this is currently unhandled: HIGH.

---

## 8. Sources

LIVE-CHECKED this pass (2026-08-30):
- https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — PSE internal audit of v4.0.0 (March 2024), circuits+contracts+TS, findings fixed
- https://api.github.com/repos/semaphore-protocol/semaphore/releases/latest — v4.14.3 published 2026-07-08
- https://registry.npmjs.org/@semaphore-protocol/proof — npm latest 4.14.3
- https://docs.semaphore.pse.dev/benchmarks — benchmarks exist but numbers are in images (not extracted)
- https://github.com/privacy-scaling-explorations/zk-kit (+ releases/pulls) — active through 2026; eddsa-poseidon audited in Semaphore v4 scope
- https://github.com/yAudit/RLN-audit-report and https://veridise.com/wp-content/uploads/2023/09/VAR-RLN.pdf — RLN circuit audits, 2023, no criticals
- https://api.github.com/repos/rate-limiting-nullifier/circom-rln — last push 2024-07-13, not archived
- https://github.com/vacp2p/zerokit + https://vac.dev/rln — maintained Rust RLN (RLNv2), Waku production use
- https://github.com/Unirep/Unirep + https://developer.unirep.io — activity through Feb 2025; docs at 2.1.x
- https://en.thebigwhale.io/article-en/exclusive-sismo-in-difficulty-could-soon-be-shut-down — Nov 2023
- https://github.com/iden3/snarkjs (releases) — v0.7.6, 2025-01-26; GPL-3
- https://hyli.ghost.io/benchmarking-in-browser-p256-ecdsa-proving-systems/ + https://blog.base.dev/benchmarking-zkp-systems + https://github.com/weijiekoh/noir_ultrahonk_benchmarks — Noir/UltraHonk browser numbers (<3 s sig proof, M1, threaded)
- https://forum.aztec.network/t/review-my-noir-ed25519-signature-verification/8604 — community Noir ed25519 (June 2026, unaudited)
- https://github.com/Electron-Labs/ed25519-circom + Electron Labs Medium posts — ~2M constraints/sig, NOT audited, not production-ready
- https://veridise.com/audits-archive/company/o1-labs/o1js-2024-08-27/ — o1js v1 audit, 39 person-weeks, medium+ fixed
- https://github.com/Consensys/gnark + pkg.go.dev — Apache-2.0, v0.15.0 (2026-05-13)
- https://github.com/privacy-scaling-explorations/halo2 — PSE fork maintenance mode since Jan 2025; https://kudelskisecurity.com/research/on-the-security-of-halo2-proof-system + Trail of Bits Axiom deep-dive — query-collision bug (patched)
- https://starkware.co/blog/s-two-prover/ + https://www.starknet.io/blog/s-two-is-live-on-starknet-mainnet... + https://github.com/starkware-libs/stwo + https://github.com/AbdelStark/stwo-wasm-demo — S-two live on mainnet, WASM demos, audits "to be linked"
- https://blog.succinct.xyz/sp1-hypercube/ + succinct.xyz blog — SP1 ed25519 precompile; Hypercube audit "upcoming" at announcement
- https://veridise.com/audits-archive/company/risc-zero/zkvm-2025-02-24/ + https://github.com/risc0/rz-security — 96 person-week V2 zkVM audit (2024), Picus formal verification in CI
- https://www.theblock.co/news/ecosystems/2025-09-13-ethereum-foundation-sets-end-to-end-privacy-roadmap... + pse.dev — PSE → Privacy Stewards of Ethereum reorg (Sept 2025); Semaphore/MACI named production-ready

MEMORY (unverified — flagged where load-bearing): Semaphore/zk-kit MIT
licensing; v4 ceremony existence (F2); semaphore-rs (F3); precise browser
proving times (F4); zerokit WASM (F5); UniRep v2 audit (F6); Aztec audit
specifics (F8); o1js/gnark/stwo/risc0 license details; zkVM delegated-
proving witness exposure (mechanism-certain, product-details memory).
