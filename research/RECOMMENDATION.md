# ZK MEMBERSHIP/ATTRIBUTION LAYER — RECOMMENDATION

Synthesized 2026-08-30 from seven independent committee reports
(primitive-scout, fit-architect, browser-perf-realist, trust-auditor,
incremental-strategist, fc-prior-art, curve-mismatch). This is the
reconciliation pass — single-threaded by design. Nothing here is built.
The companion `VERIFY-YOURSELF.md` carries the human-verification flags
and MUST be read alongside this; several claims below are load-bearing
and un-affirmable by an LLM.

---

## TL;DR (one page)

**The approach: a parallel ZK identity derived from the same root seed,
proven with stock Semaphore v4, never touching Ed25519 inside a circuit.**

Add one HKDF branch — `layers/v1/zk-identity/1` — to the existing key
hierarchy. It produces a BabyJubJub identity (Semaphore v4's native
identity type) whose Poseidon commitment, **one per root**, is registered
into public Merkle trees the validator hosts. A persona then proves
"some registered root in good standing authorizes me" with a stock
Semaphore membership + nullifier proof. The proof never reveals which
root **from its cryptographic content alone**. That is the precise and
limited guarantee — read §0 immediately below: the red team established
that the operator can still link personas to roots through *metadata*
(nullifier reuse, the public personaId signal, submission timing, the
rate-limiter itself), and that it remains *trusted for what it puts in
the trees*. The crypto removes persona→root linkage at the proof layer;
it does NOT by itself make the operator unable to correlate your
activity, and it does NOT remove the operator's authority over what is
true about a root. The entire existing Ed25519 world — persona
keys, signed grants, the vault, device delegation — stays exactly as
REPORT-CRYPTO built it, untouched. The ZK layer is a **bolt-on
identity branch plus a set of public trees**, not a rework.

**Why this and not the alternatives** (detailed in §3): verifying the
existing Ed25519 keys in-circuit is a non-starter — 2.56M constraints in
circom (and that reference is both archived and *provably unsound*), 228K
gates in the only 2026 Noir implementation (unaudited, its own author
says "don't"). The commitment sidestep dodges the curve mismatch
completely, and it is exactly the pattern Semaphore, 33bits, and every
survivor in the Farcaster anon ecosystem converged on. Semaphore v4 is
the one audited, actively-maintained, browser-viable membership primitive
whose shape *is* Layers' core predicate — the "Morpho not Aave" minimal
general primitive the project's philosophy asks for.

**The first feature to build: a reputation-threshold membership gate on
one discovery surface.** "My root is in the tier-≥T group" as a stock
Semaphore proof — zero custom circuits, the least dangerous surface
(discovery degrades soft: you don't appear, you don't lose data), and the
first real moment the operator verifies a claim about a root without
learning which root. It also exercises every piece of infrastructure the
rest of the migration reuses.

**The things you must personally verify before trusting any of it** (the
red team compressed these to one theme — *the metadata, not the crypto, is
where privacy is won or lost against an operator who runs the transport*):

1. **The anonymous submission channel — AND that it is scheduled before
   any live gate.** Every proof over the existing device-envelope path is
   linked to a root by the envelope signature *before any circuit runs*.
   It is unscheduled while step 1 arms a live gate — theater that passes
   every green run. A real unauthenticated, IP-decoupled, rate-limited
   channel is a step-0 blocking sub-project. (F1 / F1c.)
2. **The rate-limiter must not itself relink.** RLN — the prescribed
   rate-limiter — emits the *same* nullifier for all of a root's messages
   in an epoch, re-linking every "anonymous" proof it just unlinked. Use a
   stateless limiter (PoW / tokens). (F1b.)
3. **The nullifier-scope table AND the public personaId signal.** A scope
   `H(secret, scope)` one string too coarse links siblings; and personaId
   rides the proof signal in the clear, so the operator intersects a
   persona's candidate root-sets over time to one *named, profiled*
   account with no crypto broken. Human-review the scope table; budget the
   proof-history. (F2 / F2b.)
4. **The launch anonymity set is named, profiled candidates — not
   strangers** — and shrinks further under the ZK-adoption partition and
   longitudinal intersection. Size the floor against auxiliary-info, and
   don't call step 1 "unlinkable" until it clears. (F3.)
5. **What the layer does NOT do:** it hides *which* root, not *what is true
   about* a root (the operator still assigns your tier and decides your
   revocation — F5c); and it does not remove the plaintext
   castHash→personaId attribution index, which survives the whole
   migration under access control, not crypto (F9b). Setup integrity (F4)
   and client-side pinned-key verification (F5) round out the crypto half.

**Effort read (corrected per C8):** the pure plumbing (HKDF branch,
registration, validator trees, scope registry, fixture-prover seam, bench
harness, leak-grep, floor) is genuinely gate-sized — weeks, patterns the
project has. But step 0 ALSO carries two review-bearing sub-projects with
no repo precedent — the F1 anonymous submission channel (a real endpoint
with its own third-party-relay trust dependency) and the signed-root-
history/split-view defense (a novel distributed-systems protocol) — and
each of those, plus the scope-table review, is where the real calendar
lives. The "one crypto-pass gate" analogy imports an estimate from a pass
(FC) whose hard parts were categorically easier: it had no transport-level
anonymity to protect, no equivocation defense, and no untestable
soundness/ZK obligations. The dangerous, expensive circuit work is
deferred to step 5 and may never be needed. **The gating cost is not the
engineering — it is the external assurance** (audit, ceremony
verification, and expert review of the submission channel, the nullifier-
scope table, and the root-history protocol) that behavioral testing
cannot substitute for. Before committing to Semaphore at step 1
specifically, weigh the cheaper blind-token path (C8) — it may let the
first feature ship without any ceremony or mobile-proving risk.

---

## 0. RED-TEAM CORRECTIONS (read before the body)

A 3-lens adversarial panel (soundness / privacy / pragmatics) attacked
this document against its own source reports and live-verified the
load-bearing claims. **The architecture survived intact — Semaphore v4 +
the commitment sidestep + out-of-circuit binding + defer-custom-circuits
is right, and no lens argued for a different primitive.** But the panel
found the *framing, claims, and build sequence* overstated in ways a
confident-but-wrong synthesis smoothed over. The corrections below
override anything later in this document that contradicts them, and each
is now a flag in `VERIFY-YOURSELF.md`. Full attacks:
`research/redteam-{soundness,privacy,pragmatics}.md`.

**C1 — Membership proves INCLUSION, not the predicate. The validator is
TRUSTED for set contents (new Tier-1 flag, MF-INTEGRITY).** When "rep ≥ T"
becomes "membership in `zkTier[T]`", the validator decides which
commitments go in that tree — and the leaves are opaque, so a corrupt
operator can place any commitment in tier-5 undetectably. The ZK layer
removes persona→root *linkage*; it does NOT remove the operator's
authority over *what is true about a root*. §2.2's "the validator cannot
forge membership (Merkle)" is misleading: it cannot fake a Merkle *path*,
but it curates every *leaf*. The honest claim is "cannot fake a proof, but
is trusted to populate the sets honestly." The fit-architect report kept
this cryptographic (a root proves its *own* rep in a placement circuit,
its F3); this synthesis dropped that circuit and the caveat while keeping
the "No custom circuit" conclusion. If you want the predicate itself to be
trustless (not just the linkage hidden), N1 and N4 need the custom
placement/attestation circuits — which flips their §2.5 "No" to "Yes" and
re-incurs ceremony+audit. That is a real product choice, stated here, not
settled.

**C2 — RLN, the prescribed submission-channel rate-limiter, is ITSELF a
same-root cross-persona linkage oracle (new Tier-1 flag).** LIVE-CHECKED:
an RLN member's internal nullifier is identical across all their messages
in an epoch (that sameness is how the rate limit detects over-use). A
per-root RLN identity (required — a per-persona one hands a root N
personas' rate budget) therefore re-links every "anonymous" proof a root
submits in one epoch, rebuilding the exact attribution table F2 exists to
destroy. The cure for the transport hole reopens the wound. RLN's epoch
identity must enter the F2 scope table as a first-class linkage surface,
or use a stateless rate-limiter (PoW / anonymous tokens) with no stable
per-root nullifier.

**C3 — personaId travels in the proof signal in the CLEAR, so the operator
intersects without breaking crypto (new Tier-1 flag).** §2.4 binds
`personaId ‖ gateId ‖ challenge ‖ treeRoot` for anti-replay — but that
makes personaId the free join key: the operator reads it off every proof
and intersects a persona's candidate root-sets over its lifetime (tier-3
today ∩ tier-4 after promotion ∩ holds-attestation-I), collapsing to one
*named, already-profiled* account. The F3 minimum-set floor is
instantaneous and does nothing about this longitudinal attack. Needs a
per-persona proof-history budget, and F3's anonymity set must be sized as
"named candidates the operator profiles," not "k anonymous strangers."

**C4 — The anonymous submission channel (F1) is UNSCHEDULED, yet step 1
arms a live gate that the transport deanonymizes before any circuit runs
(new Tier-1 flag).** F1 is the "most important item" but appears in NO step
of the §5 table. The only channel that exists is the device-envelope path,
which links every proof to a root by its signature. As sequenced, step 1
ships a gate that looks private in every screenshot and green `live-z1`
run and is not. **F1 is a step-0 BLOCKING deliverable and a real
sub-project** (unauthenticated + IP-decoupled + stateless-rate-limited +
constant-shape negatives + a proof the two channels can't be correlated),
not a §6 essay. Related: OHTTP's IP-decoupling only holds with a
non-colluding third-party relay the operator does not have — a standing
external dependency, not a library.

**C5 — Steps 1–4 do NOT remove the operator's plaintext attribution index
(new flag).** `castHash → personaId` (REPORT-FC Gate 4) stays in the
operator's plaintext store through the whole migration, guarded only by
the operator's own `canViewPrivate` access-control check — not crypto. The
charter's "kill the plaintext attribution linkage the validator holds" is
NOT delivered by steps 1–4; that needs the deferred anonymous-attribution
work (step 4½), which traffic analysis partly defeats even when built.
The honest boundary is narrower than "the operator can no longer see who
posted what."

**C6 — Proof-vs-activity TIMING is Tier 1, not Tier 3, and conflicts with
the interactive-UX claim.** An interactive gate proves *at the moment you
act*, so an "anonymous" proof at T+300ms is timing-bound to the
persona-authored action at T — correlatable through RLN, OHTTP, and
everything else. Defeating it needs precompute + jittered/delayed
submission, which breaks the "~200ms warm interactive" UX §2.4 sells.
Unlinkability and interactive latency are not simultaneously achievable
for this adversary; the document must not sell both.

**C7 — Fork reputation-porting (step 2) is a DELIBERATE persona→persona
link, an opt-in WAIVER of the guarantee — not covered by any blanket "we
never connect your personas" copy.** Continuity/porting features publish
"P′ shares a root with the thing that had reputation R." They are useful
and correct, but they are consent-scoped disclosures and must be described
as such.

**C8 — The effort read is understated; the tokens alternative was never
priced.** "≈ one crypto-pass gate" excludes F1 and the signed-root-history
protocol (two review-bearing sub-projects with no repo precedent) and
imports an estimate from a pass (FC) whose hard parts were categorically
easier. Separately, §3 never evaluated **blind-signed anonymous tokens
(Privacy Pass — RFC 9578/9497/9474; anonymous-rate-limited-credentials
draft 2026)**, which deliver step 1's *exact* win with no ceremony, no
artifacts, and trivial mobile verification — because the committee
anchored on Semaphore to amortize tree/nullifier infra whose need first
appears at steps 2–3. The honest counter (a single primitive across
N1–N5 halves the audit surface, and the tree infra is needed for
revocation regardless) is why the recommendation probably still stands —
but §3's "why this beats the alternatives" is incomplete, and a
leaner start (tokens for step 1, Semaphore when step-2 continuity forces
it) deserves real consideration. Note F1 is primitive-independent — tokens
don't save you the submission channel either.

**C9 — "UX-viable everywhere" (§6) overstates the browser-perf report**,
which says the interactive gate is precompute-only on the mid-range
Android floor and rests on an *extrapolated* number. Read it as
"interactive on desktop/flagship; precompute-only on the mid floor pending
real-device measurement."

**C10 — Registration leaks more than account-existence, and its anonymous
channel is UNSOLVED, not solved (§2.3 overstated it).** Registering over
device-auth leaks each account's join-order/time into the ZK set (feeding
the join-time correlation) and is session-correlatable; "not from a
persona context" is necessary, not sufficient. Restore this to an open
architecture gap.

**Meta:** all three lenses independently concluded the same thing — *the
metadata, not the cryptography, is where this system's privacy is won or
lost, and this document front-loaded the provable crypto while filing the
deciding metadata as lower-tier.* For a transport-controlling operator
(the named adversary), that ordering is backwards. The single most
dangerous item across the whole review: **C2 (RLN re-links) tied with C4
(F1 unscheduled)** — the prescribed transport fix reintroduces the linkage,
and the gate arms before the fix is even scheduled.

---

## 1. What this composes with (the fixed ground, from the repo)

Read first-hand this pass from notes/reports/REPORT-CRYPTO.md and the code:

- **One 32-byte seed; HKDF-SHA256 branches with frozen info strings**
  (`lib/crypto/kdf.ts`): `layers/v1/persona-sign/<nonce>` → Ed25519,
  `layers/v1/vault/1` → AES key, `layers/v1/device-auth/1` → Ed25519.
  Adding `layers/v1/zk-identity/1` is exactly the established move; it
  inherits Gate-4 recovery determinism for free (phrase → seed → every
  branch, bit-identical).
- **`personaId = "p_" + sha256(rootSecret + ":" + nonce)`** — byte-frozen,
  hundreds of checks reference the ids. Untouched by this layer.
- **Grants**: Ed25519-signed over `kind|from|to|audience|tier|issuedAt|
  revokedAt`, verified fail-closed at decision gates. Untouched.
- **The validator is untrusted for confidentiality, trusted for
  availability/ordering.** It already hosts *public* material (key
  directory, device anchors, envelope counters) and ciphertext. Hosting
  *public tree roots and commitments* is squarely inside that role.
- **The adapter seam** (`lib/adapters/types.ts`, `registry.ts`): the ZK
  layer stands behind the SAME interfaces (§4). `IdentityAdapter.
  resolveLinkage` already carries the comment "the predicate the real
  track must prove." Note one shape the committee flagged: `RepAdapter.
  blockedFor()` returns an *enumerated sibling list* — that is a
  validator-era shape, and under unlinkability root-level revocation moves
  into the valid-roots tree while persona-pairwise blocking stays as-is
  (architecture-v3's "you cannot block what you cannot see").
- **The fixture/live transport discipline** the FC pass proved: build the
  whole feature against a deterministic fixture transport so sweeps stay
  green, exercise the real prover only in dedicated `live-*` scripts. The
  ZK track follows this exactly (§5).

---

## 2. The recommended architecture

### 2.1 The identity branch (dodges the curve mismatch entirely)

```
seed
 ├─ persona sign keys : HKDF(seed,"layers/v1/persona-sign/"+nonce) → Ed25519   (unchanged)
 ├─ vault key         : HKDF(seed,"layers/v1/vault/1")                          (unchanged)
 ├─ device-auth key   : HKDF(seed,"layers/v1/device-auth/1") → Ed25519         (unchanged)
 └─ zk master         : HKDF(seed,"layers/v1/zk-identity/1") → 32 bytes
       └─ Semaphore v4 identity (BabyJubJub); commitment C_root = Poseidon(pubkey)
```

`C_root` is **one commitment per ROOT** (never per persona — a per-persona
commitment just rebuilds the linkage table). HKDF runs once, out of
circuit (it is circuit-hostile). Anything that must be re-derived *inside*
a circuit (per-persona sub-identities for same-human proofs) derives via
**Poseidon** from the zk master, never HKDF.

### 2.2 Public trees on the validator (all PUBLIC, none vaulted)

- `zkValidRoots` — LeanIMT of `C_root` for registered, non-revoked roots.
- `zkTier[T]` — a group per reputation tier (nested: tier-3 root is in
  trees 1,2,3). Membership in `zkTier[T]` proves rep ≥ T.
- `zkAttest[issuer]` — per-issuer groups for attestation-holding.
- `zkRootHistory` — signed, append-only recent-root window per tree
  (the split-view defense, §6 / F8).

The validator cannot fake a Merkle *path* and cannot learn root↔persona
links from a proof's cryptographic content. But it CURATES every leaf —
it decides which commitments populate `zkTier[T]`, `zkAttest[issuer]`, and
`zkValidRoots`, and the leaves are opaque, so "membership" attests
*inclusion in a set the operator built*, not the predicate itself. It is
therefore **trusted for set-contents integrity** (it can grant an unearned
tier, or decline to revoke a compromised root — an unauditable *integrity*
failure distinct from the availability attacks) and it can still refuse
updates (availability). See §0 C1. Making the predicate itself trustless
requires the placement/attestation circuits (§2.5 N1/N4), at the cost of
their ceremony + audit.

### 2.3 Registration (the binding, out of circuit)

To insert `C_root`, the client sends `{C_root}` authenticated by the
root's Ed25519 device-auth key — the machinery Gate 0 already built —
**one commitment per root, first-write-wins (the 409 discipline the
device anchor uses)**. The validator learns `C_root ↔ account`; it never
learns `C_root ↔ which persona proved`. So `persona → root` is hidden even
though `commitment → account` is registry-visible. This is Semaphore's
exact trust shape and it is the honest privacy claim: **persona→root
unlinkability, NOT account-existence privacy.** Marketing that claims more
is falsifiable (F6). Crucially — registration must NOT ride a persona
context, or the commitment gets timestamp-correlated to that persona
(§6, F1-adjacent).

### 2.4 Gate-time proof (the hot path)

One stock Semaphore proof serves rep-threshold + non-revocation +
continuity at once: membership in `zkTier[T]` ⟹ rep ≥ T **and** (because
revocation removes the root from every tier tree) non-revoked; nullifier
= `Poseidon(scope, zkSecret)` for continuity/sybil; the signal binds
`personaId ‖ gateId ‖ challenge ‖ treeRoot` for anti-replay and to tie
the Ed25519 persona request to the anonymous proof without putting Ed25519
in the circuit. **Measured cost (browser-perf PoC, real headless
Chromium): ~200ms warm, ~1.8s cold with a one-time 5.7MB cacheable
artifact download; ~0.9s on a flagship phone, ~3–8s extrapolated on a
mid-range Android** (F for the mobile number — measure on real devices).

### 2.5 The five needs, mapped

**Read this table with C1/F5c: "No custom circuit" means the LINKAGE is
hidden, NOT that the predicate is trustless — for N1/N3/N4 the validator is
trusted to populate the sets honestly (it can grant an unearned tier or
decline to revoke). Making the predicate itself trustless flips the "No"s
to "Yes" and re-incurs ceremony + audit.**

| # | Need | Custom circuit for LINKAGE-hiding? | Mechanism | Predicate trust |
|---|---|---|---|---|
| N1 rep ≥ T | **No** | membership in `zkTier[T]` | validator-trusted set contents; trustless needs a placement circuit (root proves own rep) — **Yes**, + ceremony |
| N2 same-human | **No** | nullifier equality at a user-chosen context scope | this is a deliberate opt-in LINK (see C7) |
| N3 non-revoked/blocked | **No** | exclusion-by-omission: revoke = remove leaf; proof against the current root IS non-revocation (root-level). Persona-pairwise blocking stays as-is. **Pick ONE latency contract — instant remove-leaf vs epoch re-issuance — the synthesis muddled them.** | validator-trusted to actually remove; declining-to-revoke is an unauditable integrity failure |
| N4 holds-attestation | **No** *only* via per-issuer membership groups; the "BabyJubJub-EdDSA co-signature in-circuit" variant IS a custom circuit (forfeits the Semaphore audit+ceremony — use groups if "zero custom" is the constraint) | membership in `zkAttest[issuer]` | validator/issuer-trusted set contents |
| N5 selective disclosure | **LAST, maybe never** | the flagship custom circuit mirroring `resolveLinkage`. Gate 2's vault already denies the server the grant plaintext, so its marginal value is low. Deferred to step 5. | — |

What is genuinely lost by staying out-of-circuit: the ability to prove in
ZK about *already-existing Ed25519-signed objects* without re-issuing
them. N1–N4 need nothing from existing signed objects; only future
attestation/grant provability is affected, and that is an issuance-format
choice we control (add a Poseidon twin at issuance) — not a wall.

---

## 3. Why this beats the alternatives, for THIS project

- **vs. Ed25519-in-circuit:** rejected by every angle. circom: 2.56M
  constraints, repo archived 2025-03, and a public exploit shows its core
  gadget is under-constrained (forgeable). Noir: 228K gates, five commits
  old, unaudited, author says "if you can use another signature algorithm
  you should." halo2: abandoned 2023 PoC. zkVM: cheap per-cycle but
  proving is 16×-RTX-5090 datacenter class — and server-side proving hands
  the linkage witness to the prover, *architecturally* disqualified. The
  commitment sidestep makes the whole question moot.
- **vs. Noir/UltraHonk as the base now:** Noir's no-per-circuit-ceremony
  property is a real advantage and it is the right **second track** for
  when custom circuits arrive (step 5) — everything here is expressible
  1:1 in Noir, so "go Noir later" changes artifacts, not architecture. But
  in 2026 Noir 1.0 is still pre-release with audits *in progress*, and
  barretenberg had a **critical proving-system vuln disclosed 2026-07-27**.
  For the stock-membership steps (1–4), Semaphore's Groth16 gives us an
  already-completed 400-participant ceremony and a shipped audit for free.
  Take the settled artifact now; revisit the custom-circuit stack when
  Noir's audits land.
- **vs. custom circom/Groth16 for everything:** highest soundness risk per
  line (the under-constraint bug class is the dominant real-world ZK
  failure) plus a recurring per-circuit-version phase-2 ceremony.
  Acceptable only behind Picus + Circomspect + external audit + a
  published ceremony — which is exactly why we *defer* all custom circuits
  to step 5 and lean on stock Semaphore until then.
- **vs. BBS+/anonymous credentials:** wrong-shaped for the *full* N1–N5
  set — the core predicates are set-membership and deterministic-nullifier;
  BBS presentations are deliberately *unlinkable* (the opposite of
  continuity) and would add a third curve universe (BLS12-381). Pocket it
  only if attestations later need multi-show unlinkability toward many
  verifiers.
- **vs. blind-signed anonymous tokens (Privacy Pass) for STEP 1 ONLY
  (added by red team, C8):** the step-1 win is exactly "prove rep ≥ T
  without the operator learning which root" — the textbook Privacy Pass
  shape, since the operator already assigns tiers. It would have the
  validator blind-sign a "tier ≥ T, epoch E" token to each root over the
  existing channel; the persona redeems it unlinkably at the gate.
  Advantages over Semaphore *at step 1*: no trusted setup / no per-circuit
  ceremony (deletes F4), no 5.7MB artifacts / no browser SNARK / no mobile-
  proving risk (deletes F6), verification is a sub-ms signature check,
  standards-grade primitives (RFC 9578/9497/9474; anonymous-rate-limited-
  credentials draft 2026, LIVE-CHECKED). **The committee never priced
  this** because it anchored on Semaphore to amortize tree/nullifier infra
  whose need first materializes at steps 2–3. Honest counters (why
  Semaphore probably still wins overall): (1) two crypto systems = double
  the audit surface and supply chain for a small team; (2) the
  privately-verifiable token re-centralizes verification (validator holds
  the issuer key, others trust its word — the F5 concern the ZK path
  escapes with a build-pinned client vkey; the publicly-verifiable variant
  fixes this at a key-distribution cost); (3) the step-0 tree/epoch/root-
  history infra is needed for revocation (step 3) regardless, so Semaphore's
  "tax" isn't wasted; (4) F1 is primitive-independent — tokens don't save
  you the submission channel. **Net: seriously consider tokens for the
  first feature** (ship privacy without a ceremony or mobile risk), and
  introduce Semaphore when step-2 cross-persona continuity forces a
  primitive tokens can't do.
- **vs. TEE interim for the linkage index:** skip it. The 2025 attack wave
  (WireTap ~$1k forges SGX attestation keys; Battering RAM ~$50; TEE.fail
  on TDX/SEV — Intel scopes physical interposers *out*) means hardware
  attestation is no longer a "mathematically unknowable" story; Nitro just
  renames the trusted party to AWS. The engineering is real and almost
  none of it survives the migration to circuits, and — per this project's
  own documented history — a working interim becomes permanent and removes
  the forcing function. Narrow exception: a Nitro enclave as a *proving-
  delegation host* for genuinely-broken mobile devices is a bounded,
  behind-the-seam, opt-in downgrade, and only if the bench harness proves
  mobile proving is unworkable. Running the existing untrusted validator
  inside Nitro as silent defense-in-depth is fine *only if never marketed
  as the privacy story*.
- **The Farcaster prior art confirms the shape.** anoncast (the closest
  living system, shared-FID + server signer + client ZK gate — our exact
  Gate-4 transport) and 33bits (commit-a-ZK-hash-and-prove-preimage,
  explicitly to avoid EdDSA-in-circuit) both converged here. Neither ever
  shipped nullifiers, revocation, reputation thresholds, or cross-persona
  unlinkability — that design load is genuinely ours, and it falls on the
  Semaphore-family + epoch-root machinery, not on anything forkable. And
  our problem is *strictly easier* than theirs everywhere they fought
  foreign data structures: we mint our own tree, so Poseidon leaves are
  chosen at mint time — no storage proofs, no ecrecover, no KeyRegistry
  mirroring.

---

## 4. Which adapter interfaces change ("go ZK is a swap")

From `lib/adapters/types.ts` / `registry.ts`:

- **`IdentityAdapter`** — the primary seam. A `zkIdentityAdapter`
  implements the same interface: `resolveLinkage` verifies a proof instead
  of evaluating a plaintext set; `issueGrant`/`revokeGrant` additionally
  maintain a Poseidon commitment alongside the Ed25519 signing that exists;
  `resolvableSiblings`, `requestResolution`/`whoAsked` unchanged in shape.
- **`RepAdapter`** — `tierFor(personaId)` becomes proof-mediated (returns
  the tier the persona can currently *prove*, from a cached placement leaf
  + fresh membership proof), never a root-side lookup. `blockedFor`/`block`
  stay persona-pairwise; root-level revocation lives in `zkValidRoots`.
- **`AttestationAdapter` / `GraphAdapter.claimsForMatching`** — issuance
  ends in a group insertion or BabyJubJub credential; the market-layer
  k-floor logic composes unchanged (proofs change only *how* a claim is
  known true).
- **Registry**: add `"zk"` to the impl unions (`identity`, `rep`,
  `attestation`), env-bound like `ADAPTER_IDENTITY=zk`; the validator gains
  public tree endpoints (additive HTTP, the same env-gated contract-
  amendment pattern as `LAYERS_REQUIRE_SIG`). **No page/UI code changes.**
  One honest caveat: proof *generation* is new client-side work (a web
  worker + WASM artifacts the adapter calls) — new code behind the seam,
  no new seam.

---

## 5. The incremental build sequence

| Step | Ships | Proof live | Stays validator-backed | Seam verification |
|---|---|---|---|---|
| **0 (now)** | zk-identity HKDF branch; per-root registration; validator LeanIMT trees + epoch/signed-root-history; frozen nullifier-scope registry; `ZkTransport` seam + fixture prover; leak-grep extension; bench harness; anonymity-set floor. **PLUS two BLOCKING review-bearing sub-projects: (a) the F1 anonymous submission channel — see C4; (b) the signed append-only root-history / split-view defense — see F8.** Neither is "plumbing the project has patterns for." | none | everything | `accept-z0`: roster/commitment determinism, one-commitment-per-root, scope-registry discipline, leak grep gains the zk secret as a needle class, fixture-prover fail-closed branches. **PLUS external review of the submission channel, the scope table, and the root-history protocol — none of which `accept-z0` can verify (F0).** |
| **1** | tier-≥T membership gate on ONE discovery surface — **arms as a live PRIVACY guarantee only when (a) the F1 channel exists AND (b) the eligible ZK-adopting cohort at that tier clears the anonymity floor; until both hold it is a plumbing/demo milestone, loudly labeled not-yet-private (C4, C9, MF-COHORT)** | Semaphore membership + nullifier | all other gates; this gate keeps a policy fallback for non-ZK clients during transition — **note the fallback itself partitions the anonymity set to "tier-≥T roots on a ZK client who took the ZK path this epoch"** | fixture prover in sweeps; real prover in `live-z1` with logged proving times + screenshots — **but green `live-z1` proves the gate WORKS, never that it is PRIVATE (the transport/timing/metadata review is the privacy assurance)** |
| **2** | fork reputation-porting continuity | same primitive, "roots with standing" group, message = new persona id | fork mechanics + grant reissue (still signed) | `accept-z2` extends the fork suite: port via proof, fail-closed on tamper, old path refused once armed |
| **3** | not-revoked / not-blocked | **no new proof type** — epoch re-issuance excludes revoked roots; a current-root proof IS non-revocation | pairwise persona blocks as-is | `accept-z3`: revoke → next epoch → old proof fails against new root; bounded stale-root grace asserted |
| **4** | attestation-holding (+ optional publish-time attribution proof) | membership in per-attestation groups | attestation issuance | fixture/live split; attribution version asserts the REPORT-FC asymmetry demo end-to-end |
| **5** | *(maybe never)* grant-resolution predicate in ZK | first CUSTOM circuit (Noir or circom — decide when Noir's audits land) | until then: vaulted grant set + client signature checks (server already can't read plaintext) | full committee review + external audit gate before any custom circuit ships |

Two notes: step 3's exclusion-by-omission matches architecture-v3's
"hidden = ABSENCE of a row" (instant-revocation non-membership circuits
are the heavier alternative; epoch length is a product policy — hours, not
weeks). Step 5 is genuinely optional — don't let the prettiest circuit in
the spec jump the queue.

### The fixture-prover discipline (mirrors the FC pass)

`ZkTransport.prove(claimKind, publicInputs, witnessRef)` /
`.verify(claimKind, proof, publicSignals)`. **Fixture transport**: a
deterministic tag over `canonical(claimKind|publicSignals)` keyed by a
fixture constant — a real computation in a toy scheme, never a
`valid:true` literal, preserving *every* failure mode (tampered signals
fail, wrong root fails, replayed nullifier 409s, unknown kind fails
closed). **Live transport**: real snarkjs/Semaphore, only in `live-z*`
scripts, never in the 4-sweep loop (WASM proving timing in a 40-suite
sweep is a flake generator). **Universe-scoped** (the FC cap-bug lesson):
fixture and live proofs never share nullifier stores, roots, or counters;
`mode` rides every record; lookups default to the safe side. **Never fail
open**: an unverifiable proof is ABSENT, a verify error is a refusal, the
policy fallback is explicit per-gate config, never an auto-downgrade.

---

## 6. Browser proving budget & the metadata that ZK does NOT fix

**Proving (measured + web-verified):** the membership class (Merkle-20 +
Poseidon + nullifier, ~5–15k constraints, Groth16/snarkjs WASM) is
UX-viable everywhere — interactive-gate viable on desktop and flagship
phones, precompute-recommended on mid-range Android. Signature-in-circuit
(~2M constraints) is unusable as an interactive gate in any stack and is
avoided by construction. **Rules that fall out:** proving always in a Web
Worker; if Noir/bb.js ever enters, COOP/COEP cross-origin isolation is a
deployment decision with embed/miniapp side effects (without it bb.js is
3–4× slower); precompute the session credential at idle and cache the
5.7MB artifacts; delegate-to-server is a privacy downgrade, named as such,
never a silent fallback.

**What no proof system fixes** (must be designed, or the whole layer
leaks around the crypto):
- **Submission channel** (F1) — the single most important item. Proofs
  over the authenticated envelope path are deanonymized before any circuit
  runs. Needs an unauthenticated, RLN/PoW-rate-limited, IP-decoupled
  (OHTTP/mixnet-style) channel, plus constant-shape negatives so
  "no grant" is indistinguishable from "not attempted."
- **Nullifier scoping** (F2) — the project-specific killer; §2.4 + the
  scope registry.
- **Small anonymity set** (F3) — a minimum-set floor gate + launch
  sequencing + honest UX copy.
- **Split-view / tree-tagging** (F8) — signed append-only root history the
  client cross-checks (anchor it in the vault, or on Farcaster/chain).
- **Timing correlation** — batch roster insertions per epoch (never
  insert-then-immediately-prove), and state in the threat model that
  traffic analysis is out of scope until explicitly addressed.

RLN is the right tool for rate-limiting that anonymous endpoint without
identifying callers (audited 2023; its slashing-reveals-secret-shares
semantics demand a *dedicated leaf secret*, never the root seed).

---

## 7. Dependency / library status (web-verified 2026-08-30, see role reports for URLs)

| Library | Status | Audit | License | Note |
|---|---|---|---|---|
| Semaphore v4 (`@semaphore-protocol/*`) | active, v4.14.3 (2026-07-08) | PSE **internal** audit v4.0.0 Mar 2024; ceremony Jul 2024, 400+ | MIT | audit is internal not third-party (F); modifying the circuit forfeits both audit and ceremony (F) |
| zk-kit (LeanIMT, eddsa-poseidon, SMT) | active through 2026 | within Semaphore v4 audit scope | MIT/Apache | the parts bin |
| snarkjs | v0.7.6 (2026-01) active, slow cadence | CVE-2023-33252 + Frozen Heart, both patched; 0.7.6 adds verifier input checks | **GPL-3.0** | GPL-3 in a shipped browser bundle is a real product decision (F) |
| circomlib | circuits frozen; npm 2.0.5 (2022) | Veridise (14 findings, 9 critical, fixed) | GPL-3 | audited-but-unmaintained, stated honestly |
| RLN (circuits / zerokit) | zerokit active (Vac, Waku prod); circom-rln dormant since 2024-07 | Veridise + yAudit 2023 | — | for the rate-limit endpoint only |
| Noir + Barretenberg (2nd track) | very active (bb.js nightlies) | 1.0 audits **in progress**; critical bb vuln disclosed 2026-07-27, patched | permissive | the forward path for custom circuits; not yet a frozen artifact |
| UniRep | **do not depend** | — | — | mine the epoch-key design; maintenance unverified past Feb 2025, omitted from PSE's Sept-2025 production-ready list |
| halo2 (PSE), o1js, zkVMs | rejected for this use | — | — | maintenance-mode / wrong-ecosystem / browser-infeasible respectively |

Formal tools (reducers, not verifiers): **Circomspect** in CI + **Picus**
on every custom circuit (treat "unknown" as un-shipped) — and still buy
the human audit.

---

## 8. Open questions the committee could not resolve internally

1. **Mid-range mobile proving time** — extrapolated (~3–8s), not measured
   on a real Pixel-6/Galaxy-A-class device. Flips the interactive-gate
   verdict to precompute-only if it's >10s. → bench harness on real
   hardware (VERIFY-YOURSELF F4).
2. **The grant-resolution circuit (step 5) design** — the grant-set-
   commitment publication choice (global tree vs pairwise-delivered) is a
   genuine open design point with a linkage risk either way; only relevant
   if step 5 is ever built (F, low priority now).
3. **Semaphore v4 audit *scope* and post-4.0 re-review** — the audit's
   existence is verified; whether it covers the 4.14.x libraries + LeanIMT
   + the JS proving stack we'd install is not (F).
4. **The registration channel's anonymity** — one-time tokens vs OHTTP
   relay vs batched-epoch insertion; identified as required, not resolved.
5. **Exact Semaphore v4 nullifier preimage** — v4 restructured identities
   from v3; the scope-collision reasoning must be checked against the
   actual v4 circuit before the scope registry is frozen (F).
6. **Whether a 2025/26 advance (folding schemes, Jolt-class) made
   in-circuit Ed25519 cheap enough to skip dual-key** — committee says no
   with high confidence, but it's the assumption the whole binding rests
   on (F).

---

*Companion document: `VERIFY-YOURSELF.md` — the human-verification flags,
over-inclusive by design. Every "we think X is fine" about soundness,
setup, anonymity-set size, or a library's audit status is there. That
document is what stands between a confident-but-wrong recommendation and
shipping a hole.*
