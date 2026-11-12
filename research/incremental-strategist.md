# ZK Research Committee — Incremental-Path Strategist

Role: design the no-big-bang path from "validator holds a plaintext-readable
attribution path" to "linkage is mathematically unknowable to the operator."
Date: 2026-08-30. Inputs read in full: notes/reports/REPORT-CRYPTO.md (incl. SECURITY
POSTURE), notes/reports/REPORT-FC.md, notes/design/architecture-v3.md; notes/reports/REPORT-MEGA.md skimmed for grant
shapes, resolution checks, fork ops.

Verification discipline: every load-bearing external claim below is tagged
**[WEB-VERIFIED]** (URL + date checked = 2026-08-30 unless noted) or
**[MEMORY]** (unverified — see Flags). Repo claims cite the report they come
from.

---

## 0. Executive recommendation (one screen)

1. **First ZK feature: a root-tier membership gate on ONE discovery surface,
   built on stock Semaphore v4.** Tier ≥ T is encoded as membership in a
   validator-curated group ("roots at tier T or above"), so the first
   shipped proof is *pure group membership + nullifier* — **zero custom
   circuits**, an audited protocol, browser-viable proving, and the first
   real moment where the operator verifies a claim about a root without
   learning which root. Everything else stays validator-backed.
2. **Sequence after that:** same-root continuity for fork reputation-porting
   (step 2), revocation/blocking via **epoch re-issuance — exclusion by
   omission**, not non-membership circuits (step 3), attestation-holding as
   more groups (step 4). The bespoke "grant-resolution predicate in a
   circuit" is deliberately LAST and possibly never (step 5) — the Gate-2
   vault already removed the server's ability to read the grant set, so its
   marginal privacy value is lower than the roster's.
3. **TEE interim: SKIP for the attribution/linkage index.** The 2025 attack
   wave (Battering RAM, WireTap, TEE.fail — all physical-interposer breaks
   of SGX/TDX/SEV attestation, with Intel declaring physical access out of
   scope) means hardware attestation is no longer a "mathematically
   unknowable" story, and Nitro merely renames the trusted party to AWS.
   Details and the one narrow exception in §5.
4. **Do NOW (pure win under any primitive choice):** a `zk-identity` HKDF
   branch + dual-key (Baby Jubjub) registration, a Poseidon/LeanIMT
   commitment roster on the validator, frozen nullifier-scope strings,
   epoch/republish machinery, an anonymity-set counter in the dev pane, and
   a browser proving-time bench harness. Full list §6.

The single most consequential technical fact, verified: **Ed25519 cannot go
inside a browser circuit** (~2–2.5M R1CS constraints per signature
verification — [WEB-VERIFIED], Electron Labs ed25519-circom,
https://github.com/Electron-Labs/ed25519-circom and
https://ethresear.ch/t/efficient-ecdsa-signature-verification-using-circom/13629,
checked 2026-08-30). Every path below therefore assumes **dual-key
registration**: the existing Ed25519 hierarchy keeps doing what it does, and
a circuit-friendly identity (EdDSA over Baby Jubjub, Poseidon commitments —
what Semaphore v4 natively uses) is derived from the SAME seed as a new HKDF
branch. This is a bolt-on to REPORT-CRYPTO's tree, not a rework.

---

## 1. Baseline: what is already true (from the repo reports)

- The validator is already contractually untrusted and holds ciphertext +
  ordering only; grants/private posts/roster/session-map are vaulted
  (REPORT-CRYPTO Gates 1–2). The residual operator-visible linkage surface
  is: **metadata** (counts, sizes, timing, which namespaces change), the
  **FC attribution index** semantics (castHash → personaId recorded at the
  one write door, REPORT-FC Gate 4), and anything the validator must read
  to make decisions.
- The disclosure predicate is already "circuit-shaped": architecture-v3
  names the resolution check — "does a non-revoked grant exist from A to B
  with audience ∋ viewer" — as the thing to prove without revealing the
  grant set, and REPORT-CRYPTO's closing section says the canonical forms
  are frozen and signed, i.e. already specified as a circuit would need
  them.
- The adapter seam + fixture/live transport discipline is proven practice
  here (REPORT-FC ran entire write gates fixture-first, then flipped one
  env flag for ≤8 live writes). The ZK track must follow the same shape.
- Key hierarchy fact that makes dual-key clean: the keystore derives
  everything from one 32-byte seed via domain-separated HKDF branches, info
  strings frozen in ONE file (`lib/crypto/kdf.ts`), and total-loss recovery
  reconstructs bit-identically from the seed + vaulted roster (REPORT-CRYPTO
  Gates 0, 4). A `zk-identity` branch inherits all of that for free.

## 2. The primitive this path standardizes on (and why)

**Semaphore v4** (PSE): anonymous group membership with signals and
nullifiers. Identity = EdDSA keypair over Baby Jubjub + Poseidon commitment;
groups are Lean Incremental Merkle Trees; proofs are Groth16 via snarkjs.

- **[WEB-VERIFIED]** v4 exists and changed identities from raw Poseidon
  secrets to EdDSA (Baby Jubjub) and trees to LeanIMT:
  https://github.com/semaphore-protocol/semaphore/releases/tag/v4.0.0 and
  https://docs.semaphore.pse.dev/ (checked 2026-08-30).
- **[WEB-VERIFIED]** Actively maintained NOW: `@semaphore-protocol/core`
  v4.14.3 published ~7 days before 2026-08-30
  (https://www.npmjs.com/package/@semaphore-protocol/core). Not abandonware.
- **[WEB-VERIFIED, scope-limited]** A v4 audit exists: "Semaphore PSE audit,
  March 2024" (https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf). It was
  performed by PSE's own audit team at v4.0.0 — internal, and ~2.5 years and
  fourteen minor versions ago. See Flag F1.
- **[MEMORY — Flag F2]** Browser proving for a Semaphore membership proof is
  sub-second to low-single-digit seconds on laptop-class hardware and a few
  seconds on mid-range mobile; the docs' benchmark page exists but publishes
  charts, not numbers I could read
  (https://docs.semaphore.pse.dev/benchmarks names an M2 Pro / Chrome 139
  rig; the live benchmark app at semaphore-v3-v4-benchmarks.vercel.app
  requires interactive generation). This must be measured on OUR target
  devices before Step 1 ships — hence the bench harness in §6.

Why this and not Noir/circom-custom first: the hard constraints say audited
+ standard + browser + "Morpho not Aave." Semaphore is the general
membership primitive with the most production mileage (Worldcoin's original
protocol lineage, PSE maintenance), and — decisive for the incremental path
— **the first three steps need no circuit authoring at all**. Custom-circuit
tooling (Noir/UltraHonk, circom) enters only at step 5, if ever, and that
choice can be deferred until the committee's primitive-evaluation roles
report.

**The dual-key requirement, stated plainly:** Semaphore identities are NOT
Ed25519. The bridge is `HKDF(seed, "layers/v1/zk-identity/1") → Baby Jubjub
scalar → Semaphore Identity → Poseidon commitment`. Deterministic, so Gate-4
recovery reproduces it; one commitment per ROOT (not per persona), so
publishing the commitment roster does not link personas to each other. The
commitment is registered once, over the device-auth envelope channel that
already exists. What the validator learns at registration: commitment ↔
account (root-level fact it already effectively has). What it can never
learn from proofs: which commitment produced which persona's proof. That is
the honest unlinkability claim — persona→root becomes unknowable; the
existence of your account's commitment does not (Flag F6).

## 3. The smallest first feature — candidates evaluated, one picked

Scoring axes per the brief: value × smallness × how much stays
validator-backed.

### Candidate A — reputation-threshold proof gating ONE surface (PICKED)

Tier-gated discovery already exists as a validator-checked policy. Replace
ONE such check with: client proves "my root's commitment is in the
tier-≥T group" (Semaphore membership proof; message = personaId being
surfaced; scope = the gate's frozen scope string), validator verifies the
proof against the current group root instead of looking up the root's tier.

- **Value:** high and demonstrable. It is the exact key property in the
  brief ("reputation ≥ tier T without learning WHICH root") live on a real
  surface, and it produces the ZK equivalent of REPORT-FC's asymmetry demo:
  the same discovery slot, granted by a proof the operator verifiably
  cannot invert. It also exercises every piece of standing infrastructure
  the rest of the migration needs (roster, tree, epoch, nullifier
  bookkeeping, fixture/live prover transports) on the least dangerous
  surface — discovery degrades soft (you don't appear) rather than hard
  (you lose access to your data).
- **Smallness:** the smallest possible — stock Semaphore, zero custom
  circuits, group maintenance is a validator-side cron over data it already
  holds (tier assignments), verification is one library call behind the
  adapter seam.
- **Stays validator-backed:** everything else. Grants, attribution,
  blocking, private personas — untouched. Even this surface keeps its
  policy fallback: a persona that opts out of ZK (or an old client) can
  still be tier-checked the current way during the transition window.

### Candidate B — anonymous attribution for the shared-FID index (REJECTED as first)

Replacing `{castHash → personaId}` with a proof that "this cast's claimed
persona belongs to a registered root" is a *publish-time* proof on the write
path. Rejected as the opener for three reasons: (1) the index's linkage
risk is persona-level, not root-level — the crown-jewel secret (which
personas share a root) is not what the index stores, and Gate 1 already made
index tampering cryptographically detectable (REPORT-CRYPTO signature map
row 5); (2) the write path is the most dangerous place to put a novel
verifier — a proof failure there eats a real network write or strands a
cast; (3) timing metadata on a shared FID (persona A posts, then B, through
one signer) links regardless of what the index proves — ZK on the index
buys less than it appears until the metadata story (§6, batching/padding)
exists. It becomes step 4½ once the machinery is warm.

### Candidate C — same-human continuity for fork reputation-porting (REJECTED as first, becomes step 2)

Prove "the root behind new persona P′ is the same root that held reputation
R" without naming the root: this is ALSO pure Semaphore membership (group =
roots holding a reputation record; message = P′; nullifier prevents porting
the same standing twice per epoch). High conceptual value — it is the
"reputation lives on the ROOT" thesis made cryptographic — but forks are
rare events, so it exercises the infrastructure a handful of times a month
instead of continuously, and its failure mode (a fork that can't port) is
harsher than a discovery miss. It is the natural SECOND feature: same
primitive, zero new circuits, and by then the gate design has soaked on the
discovery surface.

### The nullifier-scope decision that Candidate A forces (important, easy to get wrong)

A Semaphore nullifier is `H(identity-secret, scope)`. If a gate's scope is
just the surface, two SIBLING personas of one root produce the SAME
nullifier — the gate's dedup store then links them ("second proof refused:
already used") — a **built-in sibling-linkage channel**. This is sometimes
the FEATURE (one-per-human anti-sybil: rewards, votes, one-account-per-human
gates) and sometimes a privacy hole (per-persona gates like discovery).
Rule to freeze now, in one module alongside kdf.ts's info strings:

- scope = `(feature, epoch)` → deliberately collides siblings → use ONLY for
  one-per-human semantics, and say so in the gate's name;
- scope = `(feature, epoch, personaId)` → per-persona, no cross-persona
  dedup, no sibling linkage → the default for everything else, including
  Candidate A.

Flag F7 covers verifying this reasoning against Semaphore v4's exact
nullifier formula before freezing.

## 4. The full migration, step by step

Each step: what ships / what proof goes live / what stays validator-backed /
how it verifies behind the seam.

| Step | Ships | Proof live | Stays validator-backed | Seam verification |
|---|---|---|---|---|
| 0 (now) | dual-key registration, roster tree, scope registry, epoch machinery, bench harness (§6) | none | everything | accept-z0: roster determinism, commitment-per-root uniqueness, leak-grep extension (zk secret joins the needle set) |
| 1 | tier-≥T membership gate on one discovery surface | Semaphore membership + nullifier | all other gates; this gate keeps a policy fallback for non-ZK clients during transition | fixture prover in sweeps; live prover in `live-z1` (below) |
| 2 | fork reputation-porting continuity | same primitive, new group ("roots with standing"), message = new persona id | fork mechanics, grant reissue (still signed grants) | accept-z2 extends the existing fork suite: port succeeds via proof, fails closed on tampered proof, and the OLD path is refused once armed |
| 3 | not-revoked / not-blocked | **no new proof type** — epoch re-issuance: each epoch the validator republishes groups EXCLUDING revoked roots; a proof against the current root IS the not-revoked proof | block lists themselves (pairwise persona blocks stay as-is per architecture-v3's "you cannot block what you cannot see") | accept-z3: revoke → next epoch → old member's proof fails against new root; stale-root grace window bounded and asserted |
| 4 | attestation-holding ("holds X") + optional publish-time attribution proof (Candidate B) | membership in per-attestation groups | attestation issuance (validator/issuer signs members in) | same fixture/live split; attribution version additionally asserts the REPORT-FC asymmetry demo end-to-end |
| 5 | (maybe never) grant-resolution predicate in ZK | first CUSTOM circuit (Noir or circom) — the architecture-v3 predicate | until then: vault-encrypted grant set + client-side signature checks, which already deny the server the plaintext | full committee review + external audit gate before any custom circuit ships — every novel circuit is a human-verification flag by the project's own rule |

Two design notes on the table:

- **Step 3's mechanism is chosen for philosophical fit, not just cost.**
  Exclusion-by-omission ("a revoked root simply isn't in the next epoch's
  tree") is the same shape as architecture-v3's "hidden = ABSENCE of a
  row." Non-membership proofs (sparse Merkle exclusion) are a heavier,
  circuit-bearing alternative that buys instant revocation; epoch
  re-issuance buys revocation-within-one-epoch using only machinery step 0
  builds. Pick the epoch length as product policy (hours, not weeks).
- **Step 5 is genuinely optional.** After Gate 2 of the crypto pass, the
  server never sees grant plaintext; the client checks signatures over data
  it can already decrypt. A grant-resolution circuit's residual value is
  (a) third-party verifiability of a disclosure decision and (b) removing
  the client's need to HOLD the set it evaluates. Neither is on the
  critical path of "operator cannot link personas." Do not let the
  prettiest circuit in the spec jump the queue.

### The fixture-prover discipline (mirroring the FC pass exactly)

One interface, two transports, chosen by the same runtime source-switch
pattern Gate 2 of the FC pass built:

- `ZkTransport.prove(claimKind, publicInputs, witnessRef) → {proof, publicSignals}` and
  `ZkTransport.verify(claimKind, proof, publicSignals) → boolean`.
- **Fixture transport:** "proof" = a deterministic tag over
  `canonical(claimKind|publicSignals)` keyed by a fixture constant (same
  spirit as the fixture-root signing world: fixture proofs are real
  computations in a toy scheme, public-by-construction, never a `valid:
  true` literal). Verify recomputes. Crucially it preserves EVERY failure
  mode the live path has: tampered public signals fail, wrong group root
  fails, replayed nullifier 409s, unknown claimKind fails closed — so
  sweeps exercise the fail-closed branches deterministically, the same way
  `tamperState` drives signature-tamper checks today.
- **Live transport:** real snarkjs/Semaphore proving + verification.
  Exercised in dedicated `live-z*` scripts (the `live-fc2`/`live:fc3`
  precedent): recorded runs, wall-clock proving times logged as first-class
  results, screenshots of the gated surface, never part of the 4-sweep
  loop (wasm proving in a 40-suite sweep is nondeterministic timing looking
  for a flake).
- **Universe scoping, learned the hard way (REPORT-FC's cap bug):** fixture
  and live proofs never share nullifier stores, group roots, or counters.
  `mode` rides every record; lookups default to the SAFE side.
- **Never fail open (project rule):** an unverifiable proof is ABSENT —
  same word, same semantics as unverifiable grants. A transport error
  during verify is a refusal, not a pass; a missing group root is a
  refusal; the policy fallback in step 1 is an explicit, logged, per-gate
  configuration — never an automatic downgrade when the verifier errors.

## 5. TEE interim — assessment and recommendation

**Question:** put the attribution/linkage index inside an enclave
(SGX/TDX/Nitro) as a stepping stone, so the operator provably can't read
it, then migrate to circuits later?

**Recommendation: SKIP the TEE as a linkage-index stepping stone.** Four
reasons, first one decisive:

1. **The attestation story broke in 2025, publicly and cheaply.**
   [WEB-VERIFIED, 2026-08-30, press + project sites — papers not yet read
   by me, Flag F8]:
   - **WireTap** (Georgia Tech/Purdue): passive DDR4 interposer under
     $1,000 extracts an SGX ECDSA **attestation key** from a machine in
     fully-trusted status — i.e. forged attestations, not just leaked data
     (https://wiretap.fail/, https://www.securityweek.com/wiretap-attack-breaks-intel-sgx-security/).
   - **Battering RAM** (KU Leuven/Birmingham): ~$50 active interposer,
     arbitrary read/write into SGX-protected memory; also hits AMD SEV
     (https://hacken.io/insights/wiretap-and-battering-ram-risks/).
   - **TEE.fail**: DDR5 bus probing extracts the **TDX provisioning
     certification key**, and touches SEV-SNP
     (https://cybersecurefox.com/en/tee-fail-ddr5-attack-intel-sgx-tdx-amd-sev-snp/).
   - Intel's response: physical interposers are **outside the threat
     model**, no CVE (https://www.intel.com/content/www/us/en/developer/articles/news/more-information-encrypted-memory-frameworks.html).
   The project's stated bar is "mathematically unknowable to the operator."
   An SGX/TDX enclave in a colo the operator (or their host) physically
   controls is now, on the public record, "unknowable unless someone with a
   screwdriver and $50–$1000 wants to know" — and the vendor calls that out
   of scope. That is not the claim Layers wants to make.
2. **Nitro renames the trusted party; it doesn't remove one.** Nitro
   Enclaves attestation roots in the AWS Nitro hypervisor PKI
   ([WEB-VERIFIED] https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html,
   https://github.com/aws/aws-nitro-enclaves-nsm-api/blob/main/docs/attestation_process.md).
   It genuinely protects against the parent-instance root user — i.e.
   against *Layers-the-operator* — which is real value, but the guarantee
   is "trust AWS's hypervisor and PKI," not math. For a project whose pitch
   is operator-unknowability, "we can't read it, but Amazon's stack vouches
   for that" is a materially weaker sentence than a verifier equation, and
   it is a sentence competitors will read aloud.
3. **The engineering is real and almost none of it is reusable.**
   Reproducible enclave builds, client-side attestation-document
   verification, PCR pinning, KMS policy plumbing, an ops runbook for
   enclave upgrades — comparable effort to standing up the entire step-0/1
   ZK path, and when the circuits arrive it is all discarded. The ZK
   step-0 work (roster, trees, epochs, scopes) is the end-state's
   foundation from day one.
4. **The permanence risk is the project's own documented failure mode.**
   This codebase's history (phase-1 compromises that lived until a pass
   forcibly retired them — the plaintext attribution path, the unsigned
   grant world) shows that a working interim IS the product until something
   breaks. A TEE that demos well removes the forcing function for the
   circuits indefinitely.

**The one narrow slot where a TEE could earn its keep later** (optional,
additive, not now): a **proving-delegation host** for weak mobile devices —
if step 1's bench harness shows mobile-web proving is genuinely broken
(>5–10s on target devices), a Nitro enclave that holds a witness for one
proof for one second is a bounded compromise: its blast radius is the
privacy of that single proof, not the roster; it sits BEHIND the same
ZkTransport seam as a third transport; and its failure or removal changes
nothing architecturally. Even then, prefer trying browser-side optimization
first. Do not build it speculatively.

**Also acceptable (near-zero effort only):** running the EXISTING untrusted
validator inside Nitro as silent defense-in-depth hardening of the status
quo — permitted precisely because it must never be marketed as the privacy
story, so it can't become the permanent substitute.

## 6. Do NOW — pre-ZK moves that are pure win under any primitive

Coordinated with what REPORT-CRYPTO already built (each item names its
anchor):

1. **`zk-identity` HKDF branch.** Add `"layers/v1/zk-identity/1"` to the
   ONE frozen info-string file (`lib/crypto/kdf.ts` discipline). Output: a
   root-level circuit-curve secret. Do NOT pick the final in-circuit format
   yet — deriving the 32 bytes is primitive-agnostic; the Baby
   Jubjub/Poseidon mapping is a pure function of it applied later.
   Recovery-wholeness falls out of Gate 4's seed-determinism for free; add
   the branch's existence to the vaulted roster so total-loss recovery
   knows to re-register.
2. **Dual-key registration seam.** Extend the existing validator `/keys`
   directory pattern (public material only, envelope-signed writes —
   REPORT-CRYPTO Gate 0) with a per-root **identity commitment** record.
   One commitment per root, registered over the device-auth channel, never
   from a persona context (a persona-context registration would timestamp-
   correlate the commitment with that persona — the exact leak class this
   layer exists to kill).
3. **Poseidon/LeanIMT roster infrastructure on the validator.** Groups as
   first-class validator objects: members (commitments), a published
   current root, an append/exclude API driven by existing tier data, and
   **epoch versioning** with signed root history. This is step 3's
   revocation machinery and step 1's anchor, and it is useful plumbing even
   if the committee switches proving systems — every candidate primitive
   consumes a commitment tree.
4. **Nullifier-scope registry.** One module, frozen strings, the
   per-gate `(feature, epoch[, personaId])` decision from §3 recorded as
   code + comment. Scope choice is a privacy decision; it must not be
   composed ad hoc at call sites (same rule as HKDF info strings).
5. **Leak-grep extension NOW.** The zk-identity secret and any future
   witness material join root-leak.mjs's needle classes the day the branch
   exists (the grep grew 2 → 6 classes in the crypto pass; this is class 7
   — cheaper to add before any code can leak it).
6. **Anonymity-set accounting in the product.** Group size surfaced in the
   dev pane and enforced as a gate precondition: a proof against a group of
   5 identifies you to within 5. Ship a minimum-set-size floor (config,
   loud refusal below it) before any ZK gate arms. Math cannot fix a small
   crowd; only the product can (seeding, launch sequencing) — this is a
   founder-level decision the code must surface, not hide (Flag F5).
7. **Metadata hygiene on the write/read paths that ZK will NOT fix.**
   Timing correlation (shared-FID publishes, group-update-then-first-proof
   patterns) survives every proof system. Cheap now, near-impossible
   retrofit: batch roster insertions per epoch (never insert-then-
   immediately-prove), pad/batch vault flush cadence where feasible, and
   record in the threat model that traffic analysis is out of scope until
   explicitly addressed (Flag F9).
8. **Bench harness before commitment.** `scripts/zk-bench.mjs` + a page
   that runs Semaphore v4 `generateProof` at realistic group sizes on real
   target hardware (mid-range Android, older iPhone, laptop), reporting
   wall-clock + memory. The 30s-is-broken UX line becomes a measured number
   per device class, and it settles Flag F2 empirically. Run it against the
   fixture group BEFORE any gate design finalizes.
9. **Bind the seam interface now.** Define `ZkTransport` (§4) and land the
   fixture transport with accept-z0-style checks even before any real
   circuit exists — the FC pass proved that building the whole feature
   against the fixture seam first is what makes the live flip a
   non-event.

## 7. Flags (over-flagged, per discipline)

**F1 — Semaphore v4 audit scope and staleness.** {claim: "Semaphore v4 is
audited"; why it matters: the whole incremental path leans on 'audited,
standard primitive' — if the audit doesn't cover the current 4.14.x
libraries, LeanIMT, or the JS proving stack, the premise weakens; verify:
read https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — check scope
(circuits? contracts? JS libs?), check it's PSE-internal vs independent, and
diff the audited tag against v4.14.x changelogs; ask PSE (Semaphore Discord/
PSE team) whether post-4.0 changes were re-reviewed; confidence the audit
EXISTS: high (fetched URL); confidence it covers what we need: **medium**;
would change it: an independent audit of the current line, or a material
un-audited change in the proof packages.}

**F2 — Browser/mobile proving time.** {claim: "Semaphore membership proof is
sub-second-to-seconds in browser, acceptable on mobile web"; source:
**MEMORY** — the official benchmarks page exists but I could not extract
numbers, and their rig is an M2 Pro, not a mid-range phone; why it matters:
proving time is a hard UX constraint ("a 30s proof is a broken feature");
verify: run item §6.8's harness on real target devices, and/or generate the
official benchmarks at https://semaphore-v3-v4-benchmarks.vercel.app/;
confidence: **medium** for laptop, **low** for low-end mobile; would change
it: measured numbers — if mobile is >5–10s, the TEE proving-delegation
exception in §5 or a different proving system re-enters.}

**F3 — Groth16 trusted setup provenance.** {claim: "Semaphore's Groth16
artifacts derive from the Perpetual Powers of Tau ceremony plus a
circuit-specific phase-2 with verifiable transcripts"; source: **MEMORY**;
why it matters: a compromised setup lets a prover forge membership — forged
tier claims, forged continuity; verify: Semaphore docs' trusted-setup
section + the published ceremony transcript/artifacts for the exact zkey
version shipped; pin artifact hashes in the repo the way noble versions are
pinned; confidence: medium; would change it: missing/unverifiable phase-2
transcript for the shipped zkey → treat as unaudited-primitive territory.}

**F4 — "Ed25519 in-circuit is impractical" in 2026.** {claim: ~2–2.5M
constraints per verification, hence dual-key is mandatory; source:
WEB-VERIFIED but the underlying work is ~2022-era (Electron Labs, ethresear.ch);
why it matters: if a 2025/26 system (e.g. Jolt-class zkVMs, folding schemes,
or Noir blackbox gadgets) made Ed25519 cheap client-side, the dual-key
registration step and its account↔commitment metadata could be skipped;
verify: ask the committee's primitive-evaluation role; benchmark a current
Noir/UltraHonk ed25519 gadget in-browser; confidence that dual-key is still
the right call: **high** (even 10x improvement leaves it heavy for mobile);
would change it: a demonstrated <2s browser proof of Ed25519 verify.}

**F5 — Anonymity-set size at launch.** {claim: early groups will be small
enough that membership proofs identify members to within a handful; why it
matters: shipping "ZK privacy" over a 5-member group is a false claim with
reputational blast radius; verify: none needed — it is arithmetic; the open
item is the PRODUCT decision (§6.6 floor value, launch sequencing);
confidence: high that this bites at launch; would change it: nothing —
mitigations only.}

**F6 — What registration reveals.** {claim: the validator learns
commitment↔account at registration, and the delivered property is
persona→root unlinkability, NOT account-existence privacy; why it matters:
marketing or docs that claim more than this are falsifiable; verify:
committee cross-check of the registration flow design in §2 and §6.2 —
specifically that no persona-context ever registers or updates the
commitment; confidence: high in the analysis; would change it: an
anonymous-enrollment design (e.g. blind-issued credentials), which is
step-6 territory, not now.}

**F7 — Nullifier formula and the sibling-collision channel.** {claim:
Semaphore v4 nullifier = hash(identity secret, scope), so a surface-only
scope collides siblings and LINKS them via the dedup store (§3); why it
matters: a wrong default silently builds a sibling-linkage oracle into a
privacy feature; verify: read the v4 circuit/spec (docs "How it works" +
the audited circuit) and confirm the nullifier's exact preimage; then
enforce the scope registry rule; confidence: **medium-high** (v3 was
external nullifier + identity nullifier; v4 restructured identities);
would change it: nothing structural — only the exact formula wording.}

**F8 — TEE attack characterization.** {claim: WireTap/Battering RAM/TEE.fail
break SGX/TDX/SEV attestation with cheap physical interposers and Intel
scopes it out; source: WEB-VERIFIED via project sites + reputable press
(wiretap.fail, SecurityWeek, Hacken, Kaspersky, Intel's own advisory page),
2026-08-30 — but I have NOT read the papers; why it matters: §5's
recommendation leans on it, and it will be repeated publicly; verify: read
the WireTap paper (wiretap.fail) and the Battering RAM/TEE.fail papers;
check whether 2026 brought mitigations (e.g. deprecation of affected DIMM
configs, ciphertext-hiding rollouts); confidence: high that the attacks are
real, medium on exact capability boundaries; would change it: a deployed,
attested mitigation class — which would still not change the §5 recommendation,
only soften its first argument.}

**F9 — Traffic analysis remains unaddressed.** {claim: timing/size metadata
(shared-FID publish ordering, roster-update-then-proof correlation, vault
flush patterns) can link personas regardless of proofs; why it matters: the
strongest practical deanonymization vector after this whole migration ships
is not cryptographic; verify: red-team exercise against the fixture world —
attempt sibling linkage from validator logs alone; confidence: high; would
change it: batching/padding/delay mitigations from §6.7 plus measurement.}

**F10 — snarkjs (the proving dependency under Semaphore).** {claim:
maintained and safe to pin; source: **MEMORY** (iden3 maintains it;
Semaphore 4.14.x depends on it, which is indirect evidence of currency);
why it matters: it is the actual wasm that runs in users' browsers —
supply-chain surface; verify: npm/GitHub activity check + pin exact
versions the way noble/scure are pinned (REPORT-CRYPTO's dedupe rationale
applies verbatim); confidence: medium; would change it: staleness or a
security advisory → Semaphore's own release channel would surface it.}

## 8. Sources

- notes/reports/REPORT-CRYPTO.md, notes/reports/REPORT-FC.md, notes/design/architecture-v3.md, notes/reports/REPORT-MEGA.md — repo,
  read 2026-08-30.
- https://github.com/semaphore-protocol/semaphore/releases/tag/v4.0.0 — v4
  identity/tree changes — LIVE-CHECKED 2026-08-30.
- https://www.npmjs.com/package/@semaphore-protocol/core — v4.14.3, published
  days ago — LIVE-CHECKED 2026-08-30.
- https://semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf — v4 audit (PSE,
  March 2024) — existence LIVE-CHECKED 2026-08-30; contents NOT read.
- https://docs.semaphore.pse.dev/benchmarks — benchmark rig named, numbers
  not extractable — LIVE-CHECKED 2026-08-30.
- https://github.com/Electron-Labs/ed25519-circom and
  https://ethresear.ch/t/efficient-ecdsa-signature-verification-using-circom/13629
  — Ed25519 ≈ 2–2.5M constraints — LIVE-CHECKED 2026-08-30 (work itself
  older).
- https://wiretap.fail/ , https://www.securityweek.com/wiretap-attack-breaks-intel-sgx-security/ ,
  https://hacken.io/insights/wiretap-and-battering-ram-risks/ ,
  https://cybersecurefox.com/en/tee-fail-ddr5-attack-intel-sgx-tdx-amd-sev-snp/ ,
  https://www.intel.com/content/www/us/en/developer/articles/news/more-information-encrypted-memory-frameworks.html
  — 2025 TEE interposer attacks + Intel scoping — LIVE-CHECKED 2026-08-30.
- https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html ,
  https://github.com/aws/aws-nitro-enclaves-nsm-api/blob/main/docs/attestation_process.md
  — Nitro attestation roots in AWS PKI — LIVE-CHECKED 2026-08-30.
