# The Curve-Mismatch Crux — Ed25519 identity keys vs BN254 ZK circuits

Research pass 2026-08-30. Brief: decide whether Layers' ZK membership layer
must verify Ed25519 inside a circuit, or whether a sidestep keeps the whole
Ed25519 hierarchy (notes/reports/REPORT-CRYPTO.md) intact with zero in-circuit curve ops.

**Verdict up front: do NOT put Ed25519 in a circuit. Derive a parallel
circuit-friendly ZK identity from the same seed (a new HKDF branch →
Semaphore-v4-style BabyJubJub identity, Poseidon commitment), bind it to the
Ed25519 root by an Ed25519 signature verified OUTSIDE the circuit at
registration time. Four of our five proof needs never touch Ed25519; the
fifth (holds-attestation) is fixed by issuing attestations against the ZK
commitment going forward, not by in-circuit Ed25519.**

Every claim below is tagged LIVE-CHECKED (fetched 2026-08-30) or MEMORY.

---

## 1. In-circuit Ed25519 in 2026: still a non-starter for us

The problem is structural, not an engineering gap: Ed25519 lives over
GF(2^255-19) with scalars mod an ~2^252 group order, while circom/snarkjs
proves over BN254's ~254-bit scalar field. Every field op becomes chunked
bignum emulation ("non-native field arithmetic"), and EdDSA verification
also drags SHA-512 into the circuit. The 2026 state of each stack:

### circom (BN254, Groth16/Plonk via snarkjs/rapidsnark)

- **Electron-Labs/ed25519-circom** — the historical reference effort.
  LIVE-CHECKED: `verify.circom` is **2,564,061 constraints** per signature;
  the repo was **archived March 26, 2025** (read-only).
  (github.com/Electron-Labs/ed25519-circom)
- **It is not merely dead — it is broken.** LIVE-CHECKED: a public exploit
  writeup (gist.github.com/uvicorn/6758e70dbcd01bbc2ef1ffa959c7196d,
  written Nov 2024, bug used as a CrewCTF May-2024 challenge) shows
  `LessThanPower` uses an unconstrained assignment (`<--`) with only a
  binarity constraint on the output, so `ChunkedMul`/`ChunkedAdd`/
  `PointEqual`/`Ed25519Verifier` are all unsound: **valid-looking proofs
  can be forged for signatures never made, without the private key.
  Unfixed at archive time.** Anyone "just using the audited-ish circom
  ed25519" in 2026 is building on a known soundness hole.
- Even ignoring soundness: Electron Labs' own numbers were ~16 minutes
  proof generation initially, hoped-for ~90s, with multi-GB proving keys —
  server-class rapidsnark territory, never browser territory.
  (LIVE-CHECKED: medium.com/electron-labs zk-ed25519 posts + Electron SDK
  post.)

### Noir / Barretenberg (UltraHonk era)

- **willemolding/noir-ed25519** (with noir-edwards-bignum), posted for
  review on the Aztec forum **June 29, 2026** — this IS the current
  UltraHonk-era implementation the brief asked about. LIVE-CHECKED
  (github.com/willemolding/noir-ed25519 + forum.aztec.network thread
  8604): RFC-8032 compliant; **228,192 gates for a 32-byte message**
  (257,588 for 128 bytes; SHA-512 dominates); README says verbatim
  **"unaudited and not intended for production use"** and **"Ed25519 is
  not efficient for Barretenberg proving. If you can use another signature
  algorithm you should."** Five commits total.
- Browser context for that gate count: the Hyli-funded p256 benchmark
  (LIVE-CHECKED via search: blog.hyli.org benchmarking-in-browser-p256 +
  github.com/vladfdp/p256-proving-benchmark) proved one p256 ECDSA
  (~comparable non-native workload) in **<3s on an M1 MacBook Air with
  UltraHonk + multithreading**, while noting client-side proving routinely
  hits WASM RAM ceilings. So a single Ed25519 verify in-browser via Noir
  is plausibly ~3-10s on a good laptop — *technically* no longer absurd —
  but it is unaudited, brand-new, author-discouraged, and each additional
  signature in the statement adds ~230K gates. A membership proof that
  also verified even a handful of Ed25519 grant signatures blows straight
  past mobile browser memory.

### halo2

- **halo2-lib EdDSA/Ed25519** (Ayush Shukla @ Axiom, June 2023).
  LIVE-CHECKED (shuklaayu.sh/blog/axiom-ed25519): ~1.74M advice cells
  (~3.4x their secp256k1 ECDSA), **~8.3s proving** at degree 18, SHA-512
  done OUTSIDE the circuit (i.e. not even full EdDSA), explicitly "a proof
  of concept, not optimized," unaudited, no maintenance since. Dead end.

### zkVMs (STARK-family — where Ed25519 is "cheap")

- RISC Zero ships **patched curve25519-dalek 4.1.x / ed25519-dalek**
  precompiles (LIVE-CHECKED: dev.risczero.com/api/zkvm/precompiles), with
  an explicit caveat that precompiles don't guarantee constant-time
  behavior on private data. SP1 likewise patches curve25519-dalek and
  claims 5-10x cycle reductions (LIVE-CHECKED: Succinct blog).
- Proving-cost reality: SP1 Hypercube's 2025-11 headline is real-time
  Ethereum blocks in ~10s **on 16x RTX 5090s** (LIVE-CHECKED: Succinct
  blog + x.com). That is the hardware class where zkVM proving lives.
  **There is no credible in-browser/mobile zkVM prover in 2026**; a Vac
  Research zkVM evaluation measured tens of GB of prover RAM for
  wasm-targeted workloads (LIVE-CHECKED: research.logos.co/rlog/zkVM-testing).
- Server-side zkVM proving is not a privacy option for us anyway: the
  prover holds the witness, and our witness IS the persona→root linkage
  secret. Delegating proving = handing the deanonymization key to the
  delegate. Only acceptable with TEE/MPC delegation machinery we have no
  reason to take on.

### o1js (Mina)

- Same mismatch, different curve: Kimchi is native over Pallas/Vesta, not
  edwards25519. o1js exposes generic foreign-field arithmetic (<2^259)
  and a secp256k1 ECDSA gadget, but **no Ed25519 gadget exists**
  (LIVE-CHECKED: docs.minaprotocol.com/zkapps/o1js/foreign-fields). Also
  drags in the whole Mina proving stack for nothing we need.

**Verdict for section 1: verify-Ed25519-in-circuit remains a non-starter
for a browser/mobile product in 2026.** The only live implementation
(noir-ed25519) is weeks-old, unaudited, and self-described as the thing to
avoid; the circom path is archived AND unsound; halo2 is an abandoned PoC;
zkVMs moved the cost to datacenter GPUs, which our privacy model forbids.

---

## 2. Sidesteps, weighed

### (a) Commitment-based membership (the Semaphore pattern) — WINNER

The tree holds circuit-friendly commitments; the circuit proves knowledge
of a preimage + Merkle path. Zero curve ops from OUR key hierarchy appear
in-circuit.

Current-state facts (all LIVE-CHECKED, docs.semaphore.pse.dev +
github.com/semaphore-protocol):

- **Semaphore v4** identity = an EdDSA **BabyJubJub** keypair whose private
  key is an arbitrary byte string, commitment = **Poseidon(pubkey)**;
  groups are Lean Incremental Merkle Trees (dynamic depth 1-32).
  BJJ is BN254's embedded curve, so its in-circuit ops cost thousands of
  constraints, not millions — that's the entire reason it exists.
- **Audited + ceremonied**: PSE audit of Semaphore 4.0.0, March 2024
  (semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — contracts, circuits, TS;
  findings fixed); Groth16 trusted-setup ceremony completed **July 13,
  2024** with 400+ participants. This is exactly the "audited standard
  primitives" posture notes/reports/REPORT-CRYPTO.md demands — the same discipline that
  rejected hand-rolled Shamir rejects hand-rolled ed25519 circuits.
- Browser proving: snarkjs/Groth16 WASM is the mature browser path; PSE
  publishes v4 benchmarks (M2 Pro, Node 23 / Chrome 139) as charts. The
  old "~15s in an average browser" figure floating around is **V1-era
  docs**; modern depth-16-32 Semaphore proofs are commonly ~1-2s on
  laptops (MEMORY — flagged below; verify locally, it's an afternoon).

**How it plugs into our HKDF tree** (this is the key design move — the
seed already derives everything, so the ZK identity is just one more
branch):

```
seed
 ├─ persona sign keys : HKDF(seed, "layers/v1/persona-sign/"+nonce) → Ed25519   (unchanged)
 ├─ vault key         : HKDF(seed, "layers/v1/vault/1")                          (unchanged)
 └─ zk master         : HKDF(seed, "layers/v1/zk-identity/1") → 32 bytes
      └─ per-context Semaphore identity secret(s); commitment = Poseidon(BJJ pub)
```

HKDF-SHA256 runs ONCE, outside any circuit (it's circuit-hostile; never
re-derive it in-circuit). Anything that must be re-derived *inside* a
circuit (e.g. per-persona sub-identities for same-human proofs) must be a
**Poseidon** derivation from the zk master, not HKDF — Poseidon is native
to BN254 and is what Semaphore's own audit covers.

**Does it fully dodge the mismatch? Yes, in-circuit.** The remaining
question is the binding:

**What binds ZK identity ↔ Ed25519 identity, and must the binding be
PROVEN?** Binding is established at REGISTRATION, out-of-circuit: to
insert commitment C into the roots tree, the request `{C, rootAnchorPub}`
is signed by the root's existing Ed25519 device-auth/anchor key and the
validator verifies that signature with the machinery Gate 0 already built.
So the registry knows commitment↔root. That is fine — it's Semaphore's
trust shape: group membership is public, *which member produced a given
proof* is what stays hidden. Persona→commitment is protected by the ZK
proof, therefore persona→root is protected, even though commitment→root
is registry-visible. Nothing in our five predicates requires the binding
to be proven in zero knowledge; proving it in-circuit would actually be
self-defeating (the proof must NOT reveal which root). One rule falls out:
**one commitment per root may enter the tree** (anchor first-write-wins,
same 409 discipline as the device anchor), else a root Sybils the
anonymity set it's part of.

### (b) Dual-key certificate (BJJ pubkey certified by an Ed25519 sig,
verified outside the circuit)

Assessment: **this is not an alternative to (a) — it degenerates INTO
(a).** Once the Ed25519 signature over the BJJ key is verified outside the
circuit, the circuit only ever proves knowledge of the BJJ key — which is
exactly Semaphore v4's identity. The "certificate" is just (a)'s
registration step made explicit. The only distinct version — carrying the
cert as a witness and verifying it in-circuit — reimports the whole
Section-1 cost. Adopt the registration-signature form, skip the rest.

### (c) Curve-native stacks

Covered in Section 1: zkVMs make Ed25519 cheap per-cycle but proving is
server/GPU-class, and server-side proving hands the linkage witness to the
prover — architecturally disqualified, not just slow. o1js swaps BN254 for
Pallas/Vesta and keeps the identical mismatch. Neither survives contact
with "browser/mobile proving is a hard UX constraint."

---

## 3. Recommendation, with mechanism

**Adopt (a): a parallel `layers/v1/zk-identity/1` HKDF branch feeding a
Semaphore v4 identity (BJJ key → Poseidon commitment), registered into
validator-anchored LeanIMT groups under an Ed25519 registration signature.
No in-circuit Ed25519, ever.** It matches every constraint we have:
audited primitives (Semaphore v4 audit + ceremony vs "unaudited, don't
use this" for every Ed25519 gadget), browser proving (~seconds, snarkjs
WASM — the one mature client-side proving path), bolt-on (a new KDF branch
in `lib/crypto/kdf.ts` + registration endpoint behind the adapter seam;
zero changes to existing keys, ids, grants, vault).

### The five proof needs, mapped honestly

| # | Predicate | Needs Ed25519 in-circuit? | Mechanism under (a) |
| --- | --- | --- | --- |
| 1 | root-membership ("a persona of SOME registered root in good standing") | **No** | stock Semaphore proof against the roots tree |
| 2 | rep ≥ T | **No** | rep lives at root level and is asserted by the service anyway: tree per threshold-bucket (rep-≥-T group whose leaves the service adds/removes), or leaf = Poseidon(C, rep) + in-circuit comparison. Trust in the rep VALUE sits with whoever maintains the tree root — same party that computes reputation today; ZK hides which leaf, not who scores |
| 3 | not-revoked | **No** | Semaphore-native: revoke = remove leaf from the current tree (LeanIMT update); proof against the current root IS not-revoked. Forward-only, matching our revocation semantics |
| 4 | same-human (two personas, one root) | **No** | nullifier equality: Semaphore's nullifier = H(scope, secret); two personas run by the same root produce the SAME nullifier for the same scope. Publishing nullifiers for a shared pairwise scope proves same-human by construction, stock circuit, no custom crypto. (A custom "two commitments share a zk master via Poseidon" circuit is possible but means our own circuit + our own trusted setup + our own audit — do it later if pairwise-scope disclosure proves too coarse) |
| 5 | holds-attestation | **Only if attestations stay Ed25519-only objects** | change the ISSUANCE side, not the circuit: an attestation becomes (also) membership of the holder's commitment C in the issuer's attestation tree, or a circomlib BJJ-EdDSA signature over C (cheap in-circuit, audited via circomlib/Semaphore lineage). Proof = membership/sig-verify over BJJ, no Ed25519 |

**What is genuinely lost:** the ability to prove statements IN ZERO
KNOWLEDGE about *already-existing Ed25519-signed objects* — today's signed
grants, attribution records, refutation edges — without touching their
issuance. Under (a), any object that must later be provable-over gets a
circuit-friendly twin AT ISSUANCE (Poseidon commitment into a tree, or
BJJ co-signature) alongside its Ed25519 signature. For legacy objects the
options are re-issuance (the fork machinery already re-signs grant sets
wholesale, so a one-time "dual-commit re-issue" pass is in-pattern) or
accepting that pre-ZK objects are provable only by disclosure, not in ZK.
Given rows 1-4 need nothing from existing signed objects, this loss is
confined to future attestation/grant *provability* — an issuance-format
decision we control, not a cryptographic wall.

**Concrete next steps** (build order, smallest-risk first):
1. `kdf.ts`: add `layers/v1/zk-identity/1` branch (additive; no migration).
2. Prototype: `@semaphore-protocol/identity` + `group` + `proof` with the
   HKDF-derived secret as the identity private key; measure browser
   proof-gen on a mid laptop AND a phone (the one number this pass could
   not web-verify — see flags).
3. Validator: roots-tree registry namespace (public commitments; the tree
   is not secret), registration endpoint requiring the Ed25519 anchor
   signature, one-commitment-per-root 409.
4. Decide attestation dual-issuance format (tree-per-attestation-type is
   simpler than BJJ co-signatures; start there).

---

## Source ledger (all fetched 2026-08-30)

- github.com/Electron-Labs/ed25519-circom — 2,564,061 constraints; archived 2025-03-26
- gist.github.com/uvicorn/6758e70dbcd01bbc2ef1ffa959c7196d — soundness exploit writeup (Nov 2024), unfixed
- medium.com/electron-labs (zk-Ed25519 mathematics; Electron SDK) — 16min→90s proving trajectory, multi-GB zkeys, base-2^85 chunking
- forum.aztec.network/t/review-my-noir-ed25519-signature-verification/8604 (2026-06-29) + github.com/willemolding/noir-ed25519 — 228,192 gates @32B msg; unaudited; author discourages
- shuklaayu.sh/blog/axiom-ed25519 (2023-06-16) — halo2 PoC, ~1.74M advice cells, ~8.3s, SHA-512 out-of-circuit
- dev.risczero.com/api/zkvm/precompiles — patched curve25519-dalek/ed25519-dalek; non-constant-time caveat
- blog.succinct.xyz (introducing-sp1; sp1-testnet; real-time-proving-16-gpus) — precompile 5-10x cycle claims; Hypercube real-time Ethereum on 16x RTX 5090
- research.logos.co/rlog/zkVM-testing — zkVM prover RAM (tens of GB) for wasm workloads
- blog.hyli.org/benchmarking-in-browser-p256-ecdsa-proving-systems + github.com/vladfdp/p256-proving-benchmark — p256 <3s in-browser, UltraHonk, M1 Air; WASM RAM ceiling notes
- docs.semaphore.pse.dev (glossary; identities; benchmarks; V1/audit) + github.com/semaphore-protocol/semaphore/releases/tag/v4.0.0 — v4 identity schema (BJJ EdDSA + Poseidon commitment), LeanIMT depths 1-32, benchmark hardware
- semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — PSE audit, March 2024
- docs.semaphore.pse.dev trusted-setup pages — ceremony completed 2024-07-13, 400+ participants
- docs.minaprotocol.com/zkapps/o1js/foreign-fields — foreign-field <2^259; no ed25519 gadget
