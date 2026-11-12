# FIT ARCHITECT — ZK primitive families mapped onto Layers' five needs

Role: Fit Architect, ZK research committee. Research-and-decision pass, 2026-08-30.
No production code. Inputs read first-hand: notes/reports/REPORT-CRYPTO.md (security posture,
key hierarchy), notes/reports/REPORT-FC.md (attribution index), notes/design/architecture-v3.md (disclosure
model, resolution predicate), notes/reports/REPORT-MEGA.md §"THE CIRCUIT SPEC",
`lib/identity/grants.ts` (canonical form + `resolveLinkage` reference
implementation), `lib/adapters/types.ts` + `lib/adapters/registry.ts` (the seam).

Every factual claim below is tagged **[WEB]** (verified this pass, URL in
Sources) or **[MEM]** (model memory, unverified — and if it is about audits,
soundness, maintenance, or performance, it also appears in the FLAGS section).

---

## 0. Verdict in three sentences

The strongest fit is the **Semaphore v4 family (Poseidon + BabyJubJub EdDSA
identities, LeanIMT membership trees, Groth16 via circom/snarkjs)** as the
identity/membership substrate, with **three small custom circuits** (rep
threshold, attestation-holding, grant-set resolution) built from the same
audited component library (circomlib / zk-kit), and the **curve mismatch solved
by dual-key registration** (a new HKDF branch mints a BabyJubJub "zk identity"
per root; the Ed25519 world is bound to proofs via the proof's public message,
never inside the circuit). **Noir + Barretenberg/UltraHonk is the named
second track** — it erases the per-circuit trusted-setup problem and its
browser proving is now competitive, but Noir 1.0 was still in pre-release with
compiler audits in progress as of March 2026 **[WEB]**, so it is the forward
path, not today's default. BBS+/anonymous-credential systems are wrong-shaped
for the set-membership half of this project and only earn a role if the
attestation feature later needs multi-show unlinkability; zkVMs (SP1, RISC
Zero) fail the browser-proving constraint outright.

---

## 1. What the ZK layer must compose with (the fixed ground)

From notes/reports/REPORT-CRYPTO.md and the code, these are already REAL and must not move:

- **One 32-byte seed**; HKDF-SHA256 branches with frozen info strings
  (`layers/v1/persona-sign/<nonce>`, `layers/v1/vault/1`,
  `layers/v1/device-auth/1`) → Ed25519 persona keys (@noble/curves), AES-256-GCM
  vault key. `personaId = "p_" + sha256(rootSecret + ":" + nonce)` — byte-frozen,
  hundreds of checks reference the ids.
- **Grants**: Ed25519-signed by `fromPersona` over the canonical
  `kind|from|to|audience|tier|issuedAt|revokedAt`, id = hash of the issuance
  canonical, revocation re-signs (revokedAt is inside the signed bytes).
  Hidden = absence of a row. `resolveLinkage` (grants.ts:150) is the named
  circuit target.
- **The validator is untrusted for confidentiality, trusted for
  availability/ordering** — it already hosts public material (key directory,
  device anchors, envelope counters) and ciphertext. Hosting *public tree
  roots/commitments* there is squarely inside its existing role.
- **The plaintext linkage the ZK layer exists to kill**: today rep lives on the
  root and the client/validator can evaluate predicates because someone holds
  the grant set and (in the FC index) a plaintext castHash→personaId path. ZK's
  job: the *operator* must be mathematically unable to link a persona to its
  root or siblings, while personas can still prove root-level facts.

Key derivation fact that shapes everything: **the persona keys are Ed25519 and
the entire signed-object world (grants, artifacts, attribution, envelopes) is
Ed25519**, while every practical browser SNARK stack natively speaks
**BabyJubJub/Poseidon** (circom world) or Grumpkin/Poseidon2 (Aztec world).
Section 4 weighs the bridge options.

---

## 2. The five needs, stated as provable predicates

| # | Need | Predicate (against repo reality) | Shape |
|---|---|---|---|
| N1 | Reputation threshold | "the root behind this persona has aggregate rep ≥ tier T" — rep is root-bound (REPORT-MEGA §4: `tier(newPersona)=tier(root)`) | credential + comparison, or set membership in a tier-bucketed set |
| N2 | Same-human / continuity | "this persona is controlled by the same root as an earlier action in scope S" — without revealing which root | deterministic **nullifier** per (root, scope) |
| N3 | Non-revoked / non-blocked | "my root is not in the revoked set" (root-level revocation, e.g. compromised/forked-away roots) | set NON-membership — or membership in a curated *valid* set |
| N4 | Attestation-holding | "my root holds attestation X from issuer I" (X-import / context-graph claims, `GraphClaim.source: "attested"`) | signature-verification-in-circuit over a hidden subject |
| N5 | Selective disclosure | `resolveLinkage(grants, requests, from, to, viewer)` ≠ null — "a live, signed, kind=linkage grant covering this pair authorizes this viewer" — without revealing the grant set (architecture-v3 names this THE circuit spec) | membership in a *private, per-root* committed set, plus grant-validity checks |

Cross-cutting constraint from REPORT-MEGA §3: **the negative case must be
silent**. A system where a failed/absent proof is itself an observable object
reintroduces the oracle. Concretely: absence of proof = absence of fact; no
verifier-side "proof attempted and failed" record on disclosure paths.

---

## 3. Candidate families

### Family A — Semaphore v4 + circom/Groth16 ecosystem (zk-kit, circomlib, snarkjs)

What it is: PSE's anonymous-signaling protocol. v4 identities are **EdDSA
keypairs on BabyJubJub**, identity commitment = Poseidon of the public key;
groups are **LeanIMT** incremental Merkle trees (dynamic depth 1–32); proofs
are Groth16 via snarkjs, generated in the browser **[WEB —
docs.semaphore.pse.dev; github.com/semaphore-protocol/semaphore]**. A proof
asserts: "a member of group G signs message M, with nullifier
H(scope, secret)". Semaphore 4.0.0 has a published audit (PSE audit, March
2024, semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf) **[WEB — existence
verified; contents not reviewed this pass — FLAG F2]**. snarkjs is actively
maintained: v0.7.6 released 2026-01-26, recently switched internal hashes to
audited noble-hashes **[WEB — github.com/iden3/snarkjs/releases]**. zk-kit
(PSE monorepo: LeanIMT, sparse Merkle trees with non-membership proofs,
EdDSA-Poseidon, poseidon-lite) is the maintained component library **[WEB —
github.com/privacy-scaling-explorations/zk-kit; zkkit.pse.dev]**. PSE also
published **LeanIMT+ — a LeanIMT variant supporting membership AND
non-membership proofs** — directly relevant to N3 **[WEB — pse.dev blog,
"LeanIMT+: Efficient Merkle Tree for Membership and Non-Membership Proofs";
maturity/audit status unchecked — FLAG F6]**.

| Need | Coverage | Notes |
|---|---|---|
| N2 continuity | **NATIVE** | This is literally what Semaphore is: scoped deterministic nullifiers. Zero custom circuit work. |
| N3 non-revocation | **NATIVE (as membership)** / custom (as non-membership) | Model revocation as *deletion from the valid-roots tree*: proofs are plain Semaphore membership against the current root — nothing custom. The non-membership formulation (revoked-set + SMT exclusion proof) is a custom circuit over zk-kit SMT/LeanIMT+ (FLAG F6). |
| N1 rep threshold | **CUSTOM (small)** — FLAG F3 | Two viable shapes, §5.3. The gate-time proof can reduce to native membership (tier-bucketed trees); the *placement* proof is custom. |
| N4 attestation | **CUSTOM (small)** — FLAG F4 | EdDSA-Poseidon verify (circomlib template, ~O(10³) constraints [MEM — FLAG F5]) + membership. The standard anon-credential-in-circom pattern. |
| N5 resolveLinkage | **CUSTOM (the flagship circuit)** — FLAG F1 | Merkle-committed grant set + in-circuit predicate mirroring grants.ts:150. §5.5. |
| Ed25519-in-circuit | **WRONG-SHAPED** | ~2M constraints per Ed25519 verification in circom **[WEB — github.com/Electron-Labs/ed25519-circom; ethresear.ch]** — a browser non-starter. Solved outside the circuit (§4). |

Costs of family A: Groth16 needs a **per-circuit phase-2 trusted setup** for
every custom circuit (FLAG F7); circom is low-level (every custom circuit is a
correctness surface); Semaphore ships its own ceremony artifacts for the stock
circuit only [MEM — FLAG F2].

Production pedigree: Semaphore-lineage circuits are the most battle-tested
anonymous-membership primitives in the ecosystem (World ID runs a
Semaphore-derived design at very large scale) [MEM — FLAG F8].

### Family B — Noir + Barretenberg (UltraHonk, bb.js)

What it is: Aztec's Rust-like circuit language compiling to ACIR, proven by
Barretenberg (UltraHonk) in-browser via WASM (bb.js). **No per-circuit trusted
setup** — one universal KZG SRS [MEM — FLAG F9]. Browser proving is a
first-class target ("stabler, faster ZK applications in the browser" — Noir
beta announcement) and third-party benchmarks put moderate circuits (e.g. a
p256 signature verify) at ~<3 s in-browser with multithreading **[WEB —
aztec.network blog; hyli.ghost.io in-browser p256 benchmark;
github.com/weijiekoh/noir_ultrahonk_benchmarks]**. **Noir 1.0 is in
pre-release with internal and external compiler/toolchain audits in progress
(as of March 2026)** **[WEB — aztec.network "Noir 1.0 Pre-Release";
blockeden.xyz Mar 2026]**. PSE has an official **Semaphore-Noir** effort with
test-vector parity against the circom implementation and UltraHonk verifiers
**[WEB — noir-lang discussion #7523 (HashCloak roadmap, 2025)]** — completion
and audit state unverified (FLAG F10).

| Need | Coverage | Notes |
|---|---|---|
| N2 | NATIVE-ish via Semaphore-Noir (pending its maturity) or ~50 lines of Noir | nullifier = poseidon2(scope, secret) |
| N3 | same as A: membership natively; non-membership = small custom Noir |
| N1, N4, N5 | CUSTOM, but authored in a high-level language with stdlib EdDSA/Poseidon/Merkle — meaningfully lower authoring risk per circuit than circom, and **no ceremony per circuit** |
| Ed25519-in-circuit | still wrong-shaped (foreign-field arithmetic; better than circom but not gate-time browser material) [MEM — FLAG F5] |

Costs: the compiler/prover are younger and their audits were literally still
running at last verification (FLAG F9/F10); pulls the project into the Aztec
toolchain's release cadence; verifier-side libraries for a plain TS validator
exist (bb.js verify) but are less boring than snarkjs.

**Fit verdict: the correct second track.** Everything in the §5 architecture
is expressible 1:1 in Noir; "go Noir later" changes the circuit artifacts and
prover/verifier bindings, not the architecture, trees, or adapter seam.

### Family C — BBS+/anonymous credentials (and why it loses here)

BBS signatures give native selective disclosure and unlinkable multi-show of
issuer-signed attribute bundles — no circuits at all for N4-shaped statements
[MEM]. But the project's core predicates are **set-shaped, not
credential-shaped**: N2 needs deterministic nullifiers (BBS presentations are
deliberately unlinkable — the exact opposite), N3 needs set
(non-)membership with operator-updatable sets, and N5's "hidden = absence of a
row" semantics is a Merkle-set property. Range/threshold (N1) needs
ZK-extensions to BBS that are far less standardized than a Groth16 comparator
[MEM]. Grafting BBS in would add a second cryptographic universe (BLS12-381
pairings) next to Ed25519 AND BabyJubJub. **Rejected as the base; noted as a
future option only if attestations (N4) later need multi-show unlinkability
toward many verifiers.** (Sismo, the historical "ZK badges" product in this
space, appears inactive — could not confirm current status either way this
pass [MEM/WEB-inconclusive — FLAG F11].)

### Family D — zkVMs (SP1, RISC Zero) — dismissed

They could execute the literal `resolveLinkage` TypeScript-equivalent, but
proving is minutes-to-hours-class on consumer browser hardware or requires
delegated proving — and delegating the proof hands the witness (the grant set,
the root binding) to a prover service, recreating the trusted operator [MEM —
FLAG F12]. Fails the hard "30s proof is a broken feature" constraint. Not
mapped further.

---

## 4. The curve mismatch: binding a proof to an Ed25519 persona key

Three options weighed, per the brief:

1. **Signature-verification-in-circuit (verify the Ed25519 persona key inside
   the proof)** — REJECTED. ~2M constraints per verification in circom
   **[WEB — Electron-Labs/ed25519-circom]**; tens of seconds to minutes in a
   browser, and every gate proof pays it.

2. **Key-derivation-in-circuit (prove HKDF-SHA256(seed, info) → key)** —
   REJECTED as the per-proof mechanism. HKDF-SHA256 is several SHA-256
   compressions (~25–30k constraints each in circom [MEM — FLAG F5]); worse,
   it puts the **master seed in the witness of every routine proof** —
   maximally sensitive material handled at maximal frequency. Acceptable ONLY
   inside the rare one-time registration/placement proofs (§5.2), never at
   gate time.

3. **Dual-key registration (RECOMMENDED)** — add one HKDF branch to the
   existing tree, exactly in the pattern Gate 0 established:

   ```
   zkSecret  = HKDF-SHA256(ikm=seed, info="layers/v1/zk-identity/1")   → BabyJubJub scalar
   zkId      = Semaphore v4 identity from zkSecret
   C_root    = Poseidon(zkId.publicKey)        # the root's ONE public commitment
   ```

   One commitment per ROOT (not per persona — a per-persona commitment would
   just rebuild the linkage table). `C_root` is what enters every public tree.
   The Ed25519 world is bound to a proof through the **message/signal**, not
   the circuit: a gate proof signs `M = H(personaEd25519Pub ‖ gateId ‖
   serverChallenge ‖ treeRoot)` inside the Semaphore proof, and the request
   itself is Ed25519-signed by the persona key as usual. The verifier checks
   both. Nobody — including the verifier — can connect `C_root` to any
   persona, because `C_root` never appears in a proof's public inputs (only
   the tree root does); the proof says "*some* registered root authorizes
   persona P at gate G".

   Key wrapping (registering the BabyJubJub key Ed25519-signed by a persona)
   is a trap: any public certificate linking a persona key to `C_root` IS the
   linkage leak. The zk identity must be registered **anonymously or
   root-pseudonymously** (e.g. inserted with a registration proof, §5.2),
   never via a persona-signed cert.

   Curve-native proving (a proof system whose native field hosts Ed25519
   cheaply) exists in research but has no audited, browser-ready, maintained
   implementation I would bet this layer on [MEM — FLAG F13].

---

## 5. Candidate architecture (Family A, composed with what exists)

### 5.1 Public commitments — where the trees live

The **validator hosts all public tree state** — it already serves the
public-key directory and device anchors, and tree roots/leaves here are public
by construction (commitments, not identities). New validator namespaces (all
PUBLIC, none vaulted):

- `zkValidRoots` — LeanIMT of `C_root` for all registered, non-revoked roots.
- `zkTier[T]` — LeanIMT per tier bucket T (nested: a root in tier 3 is in
  trees 1,2,3). See 5.3.
- `zkAttest[issuer]` — per-issuer LeanIMT of `Poseidon(C_root, claimHash)`
  leaves, OR nothing at all if the signed-credential shape is used (5.4).
- `zkRootHistory` — the last N accepted roots per tree with timestamps (the
  standard root-history window; proofs verify against any root in the window).

The validator can censor/refuse updates (availability attack — already in the
threat model) but cannot forge membership (Merkle) or learn root↔persona links
(it only ever sees commitments and anonymous proofs).

### 5.2 Registration and the placement proofs (rare, allowed to be slow)

- **Root registration**: client inserts `C_root` into `zkValidRoots`. To stop
  spam/Sybil floods, insertion is gated by the things the project already has:
  a device-envelope-signed request (authenticates *a* customer without naming
  the root — note: the envelope's device identity is itself pseudonymous but
  persistent; if the validator can correlate "device D inserted leaf i", the
  device→root link exists at the operator. **This is the single most
  important leak to design out: registration must ride an anonymous channel
  (fresh unlinkable token, or a one-time mixnet/OHTTP-style submission), not
  the device envelope.** FLAG F14.)
- **Tier placement** (N1's heavy half): a root proves, occasionally and in
  the background, that its aggregate rep clears tier T, and is inserted into
  `zkTier[T]`. The placement circuit is the one place per-persona→root
  derivation runs in-circuit: for k personas, verify k validator-EdDSA
  rep credentials `(personaId, score, epoch)` (public facts the validator
  already knows), prove each personaId = "p_"+SHA256(seed‖":"‖nonce) from the
  committed seed, sum scores ≥ T, and bind to `C_root` derived from the same
  seed. Cost: k×(SHA-256 ≈ 2 blocks ≈ 50–60k) + k×EdDSA(≈5k) + comparator
  [MEM constraint counts — FLAG F5]; at k≤8 this is plausibly a
  100–500k-constraint circuit — a background proof of seconds-to-tens-of-
  seconds, which is acceptable because it is NOT at gate time. FLAG F3.
- **Why two tiers of proof**: gate-time UX gets the cheap native membership
  proof; the expensive root-binding math runs rarely, off the interaction
  path, and its output (a tree leaf) is reusable until rep or revocation
  changes it.

### 5.3 Gate-time proofs (the hot path — must be sub-second-to-~2s)

One proof shape serves N1/N2/N3 simultaneously — a stock Semaphore v4 proof:

- membership in `zkTier[T]` ⟹ rep ≥ T **and** implicitly non-revoked, IF
  revocation also removes the root from every tier tree (one revocation op
  updates all trees — the validator does the deletions; membership-as-
  non-revocation, no exclusion circuit needed).
- nullifier = Poseidon(scope, zkSecret) covers N2: scope choice is the whole
  design (5.6).
- message binds persona key + gate + challenge + root (anti-replay, §4).

Browser cost: Semaphore v4 Groth16 proof generation at depth ≤32; PSE
publishes browser benchmarks (Chrome, M2 Pro) — the docs page charts them but
numbers were not machine-readable this pass; order-of-magnitude expectation
from the ecosystem is sub-second to low-single-digit seconds [MEM — **FLAG
F15: run the official benchmark app / semaphore-benchmarks repo on target
mobile hardware before committing**].

### 5.4 Attestation proofs (N4)

Preferred shape: **signed-credential, no per-issuer tree.** Import flow
(X-import etc.) ends with the issuer (or the validator as re-signer) issuing a
BabyJubJub-EdDSA credential over `(C_root, claimHash, expiry)` — delivered to
the client, stored in the VAULT (it names `C_root`, so it is linkage-sensitive
material — vault it like grants). Gate proof: verify EdDSA in-circuit
(circomlib EdDSAPoseidonVerifier), prove the credential's `C_root` equals the
`C_root` whose membership in `zkValidRoots` is proven in the same circuit,
reveal claimHash + issuer. Custom circuit ≈ EdDSA + Merkle + equality — small.
FLAG F4. Caveat: the ISSUER knows `C_root` ↔ the import session; issuers are
chosen counterparties, not the operator — state this in the threat model
rather than hiding it. (If issuer-side linkage is unacceptable later, this is
exactly where a BBS-style blind issuance upgrade slots in.)

### 5.5 Selective disclosure — resolveLinkage in ZK (N5, the flagship custom circuit)

Observation that shrinks the problem: **whitelist and audience grants are
pairwise and DELIVERED** — handing the named `audienceMember` the signed grant
already discloses exactly one link to exactly the right party; no ZK needed
for the happy path. What ZK adds:

1. **Prove properties about the issuer** of a grant you hold: "the root
   behind `fromPersona` is unrevoked / tier ≥ T / same-root-as this other
   grant" — those are N1–N3 proofs bound to a grant hash in the message. No
   new circuit.
2. **Open-audience tiers (`public`, `opt_in`, audience `"*"`) and
   third-party verification**: prove "a live linkage grant covering pair
   (A,B) authorizing viewer V exists in my committed grant set" without
   revealing the set. Circuit mirrors grants.ts:150 exactly:
   - private inputs: grant leaf fields, Merkle path in the root's private
     grant tree `G_root` (a per-root LeanIMT over
     `Poseidon(kind, from, to, audience, tier, issuedAt, revokedAt)` leaves,
     committed to the validator as a single opaque root — absence stays
     absence: an empty/absent commitment proves nothing and leaks nothing);
   - constraints: kind==linkage; pair matches (either orientation);
     revokedAt==0 ∨ revokedAt>now (now as public input, granularity-bucketed
     to avoid timing fingerprints); audience==viewer ∨ audience=="*" with
     tier logic (opt_in additionally requires a resolved-request leaf —
     second tree or second leaf type);
   - public: `G_root` commitment? **No** — publishing a per-root grant-tree
     commitment tags the root; instead the commitment itself is proven to
     belong to the root inside the proof (leaf `Poseidon(C_root, G_root)` in
     a global tree), or the grant-set commitment is delivered pairwise to the
     viewer. This choice (global-tree vs pairwise-delivered commitment) is
     the one genuinely open design point — FLAG F1.
   - The Poseidon-leaf grant tree is a SECOND commitment of the same grant
     the Ed25519 signature covers; the client maintains both and consistency
     between them is a client-side invariant (the circuit proves the
     Poseidon world; the Ed25519 world remains authoritative outside ZK).
     The negative case stays silent: no proof is ever emitted for a
     non-resolving query — fail closed, absence semantics preserved.

### 5.6 Nullifier scoping — the linkage-leak / double-proof design table

Rule: **same (zkSecret, scope) ⟹ same nullifier ⟹ verifier-visible
same-root linkage.** So scope IS the disclosure policy:

| Use | scope | effect |
|---|---|---|
| Gate checks (rep/revocation/attestation) | `Poseidon(gateId, personaId, epoch)` | unique per persona per epoch — siblings NEVER collide → zero cross-persona linkage; epoch bound gives replay window |
| Continuity (N2, chosen disclosure) | `Poseidon(contextId)` where the USER opts the context in (a thread, a pairwise relationship, a recurring pseudonymous column) | stable pseudonymous root-tag within that context only — "same human as before" by construction, invisible outside the context |
| One-per-human actions (votes, claims, airdrops) | `Poseidon(actionId)` | classic Semaphore Sybil-bound: one nullifier per root per action |

Two hard rules: (1) a gate must never silently use a persona-independent
scope — that is the exact linkage leak, and it is one string away, so the
scope-construction function must live in ONE module with the same discipline
as `lib/crypto/kdf.ts`'s info strings; (2) nullifier double-show at
one-per-human scopes is an ERROR to count, not to store-and-link — the
verifier stores nullifiers per scope only, never joins across scopes.

### 5.7 Revocation flow and the latency window

Revoke root (compromise/fork-abandon): validator deletes `C_root` from
`zkValidRoots` and every `zkTier[T]`, publishes new roots immediately.
Window: verifiers accept tree roots from `zkRootHistory` no older than W;
until W expires a freshly-revoked root can still prove against a pre-deletion
root. Policy: W_default ≈ minutes-to-an-hour for feed-grade gates (proofs
cacheable, cheap); W=0 (current root only) for high-stakes gates (fork
forward-pointer resolution, escrowed actions). This is a **stated latency
contract, not a hidden weakness** — same posture the device-revocation
("forward-looking") section of REPORT-CRYPTO takes. Note the flip side: every
tree update invalidates in-flight proofs built on the old root; the window W
is also what makes UX survive that.

### 5.8 Exactly which adapter interfaces a ZK implementation stands behind

From `lib/adapters/types.ts` / `registry.ts` (read this pass):

- **`IdentityAdapter`** (types.ts:384) — the primary seam. A `zkIdentityAdapter`
  implements the SAME interface: `resolveLinkage(from,to,viewer)` verifies a
  submitted/locally-generated proof instead of evaluating the plaintext set
  (types.ts:419 already carries the comment "The predicate the real track must
  prove"); `resolvableSiblings`, `issueGrant`/`revokeGrant` (adds: update the
  Poseidon grant tree alongside the Ed25519 signing that exists),
  `listGrantsFor`, `requestResolution`/`whoAsked` (opt-in request leaves),
  `visiblePrivatePosts`/`audienceFor` (audience grants — pairwise-delivered,
  ZK only for issuer-property proofs).
- **`RepAdapter`** (types.ts:436) — `tierFor(personaId)` becomes
  proof-mediated: the ZK impl returns the tier the persona can currently
  PROVE (cached placement leaf + fresh membership proof), never a root-side
  lookup. `blockedFor`/`block` stay pairwise-persona (architecture-v3's
  blocking model is persona-pairwise; the ROOT-level revocation lives in the
  valid-roots tree, surfaced via `resolveLinkage`-gated fan-out exactly as
  today).
- **`AttestationAdapter`** (types.ts:478) — `connect()` ends in credential
  issuance (5.4); `listConnections` reads vaulted credentials.
  **`GraphAdapter.claimsForMatching`** (types.ts:543) is where
  attestation-backed claims get proof-gated for the ad/market layer (the
  k-floor logic in `MarketAdapter.audienceSize` composes unchanged —
  proofs only change *how* a claim is known true).
- **`DisclosureAdapter`** (types.ts:443) — the v2-era surface
  (`canViewLinkage`, unlock requests); it delegates to the same predicate;
  no interface change.
- **Registry**: add `"zk"` to the impl unions — `identity: "mock" | "zk"`,
  `rep: "mock" | "validator" | "zk"`, `attestation: "mock" | "zk"` — bound by
  `ADAPTER_IDENTITY=zk` etc. in registry.ts, and `AdapterRegistrySnapshot`
  (types.ts:618) widens the same way. The validator gains public tree
  endpoints (additive HTTP surface, same env-gated-contract-amendment pattern
  as `LAYERS_REQUIRE_SIG`). **No page or UI code changes — that is the "go ZK
  is a swap" test, and the interfaces above pass it.** One honest caveat:
  proof GENERATION is client-side work, so the swap adds a client proving
  module (a web worker + WASM artifacts) that the adapter impls call — new
  code behind the seam, no new seam.

### 5.9 Trust-setup and artifact plan

Groth16: stock Semaphore circuits ship with their own ceremony artifacts [MEM
— FLAG F2]; the three custom circuits (placement, attestation, grant-resolve)
each need a phase-2 ceremony over a public Powers-of-Tau (FLAG F7). This is
the strongest single argument for the Noir track (universal SRS, no
per-circuit ceremony) — revisit the A-vs-B choice when Noir 1.0's audits land
(they were in progress March 2026 [WEB]).

---

## 6. FLAGS (over-flagged deliberately, per discipline)

| # | Claim | Why it matters | How to verify | Conf. |
|---|---|---|---|---|
| F1 | The grant-resolution circuit (5.5) is sound & leak-free as sketched — in particular the grant-set-commitment publication choice | This is the flagship NOVEL circuit; a leak here re-links personas | Formal spec + external circuit audit; adversarial review of the commitment-publication options; test vectors from grants.ts | LOW (design sketch) |
| F2 | Semaphore 4.0.0 audit covers the pieces we use (circuits + JS libs + LeanIMT), and current v4.x releases are still within audited scope; ceremony artifacts are legit | Audited-primitives-only rule | Read semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf end-to-end; diff audited commit vs pinned release; verify ceremony transcript provenance | MED (audit exists [WEB]; scope unread) |
| F3 | Tier-placement circuit (k×SHA-256 derivation + k×EdDSA + sum) is provable in acceptable background time on mobile browsers | If wrong, N1 needs a different aggregation design (or operator-side blinded aggregation, weaker privacy) | Prototype the circuit at k=4,8; benchmark snarkjs prove on a mid-tier Android; abort line: >60 s background | MED |
| F4 | Attestation circuit is "small custom" (EdDSA+Merkle+equality) | A per-gate proof; must stay hot-path cheap | Same prototype pass; circomlib EdDSAPoseidonVerifier constraint count | MED |
| F5 | Constraint-count figures: SHA-256 ≈25–30k/block, EdDSA-Poseidon ≈O(10³), circom Ed25519 ≈2M (this one WEB-verified), Noir foreign-field Ed25519 infeasible-for-gate-time | Sizing decisions ride on them | `circom --r1cs` on the actual templates; Noir `nargo info` | Ed25519: HIGH [WEB]; others MED [MEM] |
| F6 | LeanIMT+/zk-kit SMT non-membership circuits are maintained and audited enough to use if the exclusion-proof formulation of N3 is chosen | Non-membership is the fallback if membership-as-revocation proves operationally bad | Read the PSE LeanIMT+ post + repo; check audit status; else stick to membership-only design | LOW |
| F7 | Per-circuit Groth16 phase-2 ceremonies are operationally manageable for 3 custom circuits | A skipped/faked ceremony = forgeable proofs | snarkjs ceremony docs; budget a public multi-contributor phase-2 per circuit; or choose Noir/UltraHonk to delete the issue | HIGH (well-understood) |
| F8 | World ID / large-scale production use of Semaphore-lineage circuits | Pedigree argument only | Worldcoin/World ID docs & audits | MED [MEM] |
| F9 | UltraHonk needs only a universal KZG SRS (no per-circuit setup); bb.js browser proving of our circuit sizes <3 s | Decides the A-vs-B tradeoff | Barretenberg docs; run weijiekoh/noir_ultrahonk_benchmarks + bb-bench on target hardware | MED (browser perf [WEB] for p256-class circuits; SRS detail [MEM]) |
| F10 | Semaphore-Noir is complete with test-vector parity and usable | Shortens the Noir path enormously | github.com/semaphore-protocol / noir-lang discussion #7523 current state; ask PSE | LOW |
| F11 | Sismo is defunct (offered only as why it's not a candidate) | Minor | Check sismo.io / their X account | LOW [MEM] |
| F12 | zkVM browser/delegated proving fails the latency-or-privacy bar for this use | Dismissal justification | SP1/RISC Zero 2026 client-proving benchmarks | MED [MEM] |
| F13 | No audited, maintained, browser-ready curve-native (Ed25519-friendly) proving stack exists in 2026 | If one exists, the dual-key design simplifies | Survey: e.g. proving systems over Curve25519-friendly cycles; ask ZK researchers | MED [MEM] |
| F14 | Anonymous registration channel (breaking device-envelope↔leaf-insertion correlation) is achievable within the validator design | If registration is linkable, the operator gets a root↔device table — most of the privacy claim dies at birth | Design review: one-time tokens / OHTTP relay / batched-epoch insertion; this is an ARCHITECTURE gap, not a library gap | LOW (identified, unsolved) |
| F15 | Semaphore v4 gate-proof generation is sub-2s on target mobile browsers | The entire hot-path UX claim | Run docs.semaphore.pse.dev/benchmarks app + semaphore-benchmarks repo on real low-end devices | MED |
| F16 | Semaphore repo actively maintained in 2026 | Bolt-on longevity | The releases-page fetch this pass returned internally inconsistent dates (listed v4.14.3 "Jul 2024" *after* v4.14.2 "Jan 2024", both post-dating v4.0.0 oddly) — treat as unverified; check github.com/semaphore-protocol/semaphore commit graph by hand | LOW (fetch unreliable) |
| F17 | Timestamp/`now` handling in the grant circuit (bucketed public input) doesn't create a fingerprinting channel | Subtle leak class | Include in F1's circuit audit scope | LOW |

---

## 7. Sources

Web-verified this pass (2026-08-30):
- https://docs.semaphore.pse.dev/ and /benchmarks — v4 design (LeanIMT, EdDSA identities, depths 1–32), benchmark environments (M2 Pro, Chrome 139); numeric timings are charts, not text.
- https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — Semaphore 4.0.0 audit (PSE, March 2024) — existence confirmed.
- https://github.com/iden3/snarkjs/releases — snarkjs v0.7.6, 2026-01-26; noble-hashes migration; active maintenance.
- https://github.com/Electron-Labs/ed25519-circom + https://ethresear.ch/t/verify-ed25519-signatures-cheaply-on-eth-using-zk-snarks/13139 — ~2M constraints per Ed25519 verification in circom.
- https://aztec.network/blog/the-future-of-zk-development-is-here-announcing-the-noir-1-0-pre-release (+ blockeden.xyz 2026-03-13 coverage) — Noir 1.0 pre-release; compiler/toolchain audits in progress.
- https://aztec.network/blog/announcing-noir-beta-stabler-faster-zk-applications-in-the-browser ; https://hyli.ghost.io/benchmarking-in-browser-p256-ecdsa-proving-systems/ ; https://github.com/weijiekoh/noir_ultrahonk_benchmarks — bb.js/UltraHonk browser proving state (~<3 s p256-class with multithreading).
- https://github.com/orgs/noir-lang/discussions/7523 — Semaphore-Noir roadmap (HashCloak/PSE, 2025) with circom test-vector parity target.
- https://github.com/privacy-scaling-explorations/zk-kit + https://zkkit.pse.dev/ — zk-kit monorepo (LeanIMT, SMT with non-membership, poseidon-lite).
- https://pse.dev/blog/lean-imt-plus-efficient-merkle-tree-for-membership-and-non-membership-proofs — LeanIMT+ non-membership work.
- https://github.com/semaphore-protocol/semaphore/releases — fetched; dates internally inconsistent, flagged F16.

Repo files (first-hand): notes/reports/REPORT-CRYPTO.md, notes/reports/REPORT-FC.md, notes/design/architecture-v3.md,
notes/reports/REPORT-MEGA.md §"THE CIRCUIT SPEC", lib/identity/grants.ts,
lib/adapters/types.ts, lib/adapters/registry.ts.

Model-memory claims are tagged [MEM] inline and flagged above.
