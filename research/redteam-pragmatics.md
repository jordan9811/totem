# RED-TEAM — Build Pragmatics, UX & Strategy lens

Adversarial review of `research/RECOMMENDATION.md` + `VERIFY-YOURSELF.md`
against the underlying role reports (incremental-strategist, browser-perf-realist,
fc-prior-art) and the repo (REPORT-FC, REPORT-CRYPTO composition claims).
Date 2026-08-30. Factual claims labeled LIVE-CHECKED or MEMORY. I attack the
plan, not the math.

Verdict up front: the crypto choice survives; the **roadmap and the effort
read do not**. The recommendation sequences a live privacy gate (step 1)
ahead of the one thing it calls most important (the anonymous submission
channel, F1), which appears in **no step of the build table at all**, and it
prices "step 0 ≈ one crypto-pass gate" by quietly excluding that channel plus
the signed-root-history protocol. Two of the three headline attacks below are
scheduling/where-the-work-hides failures the math-focused committee waved past.

---

## ATTACKS

### A1 — F1 (the anonymous submission channel) is in NO step of the build sequence, yet step 1 ships a live proof gate that is theater without it. (HIGHEST)

**What the synthesis says:** F1 is "the single most important item" (§6),
"an architecture gap no library fixes" (TL;DR verify-item 1). Step 1 (§5
table) ships "tier-≥T membership gate on ONE discovery surface / Proof live:
Semaphore membership + nullifier." Step 0's shipped list (§5) is: HKDF branch,
registration, LeanIMT trees + epoch/signed-root-history, scope registry,
ZkTransport seam + fixture prover, leak-grep, bench harness, anonymity-set
floor. **F1 is not in step 0's list, and not in step 1's, and not anywhere in
the §5 table.**

**Why it's wrong/risky:** the only submission channel that exists in the repo
is the device-envelope write path (REPORT-CRYPTO Gate 0; every write is
device-authorized). F1's own claim: a proof over that path "is linked to a
root by the envelope signature *before any circuit runs*... the ZK layer is
theater." So step 1 as scheduled ships a live Semaphore proof whose transport
deanonymizes it — a gate that *looks* private in every screenshot and green
`live-z1` run and is not. The project's evidence culture cannot see this (F0),
and the roadmap's step-1 "seam verification" column is fixture+live-timing
checks that all pass on the theater version. This is the single most dangerous
unaddressed thing in the plan: **the roadmap arms the privacy claim one full
step before the transport that could honor it is even scheduled.**

**Correction:** F1 is a Step-0 (or Step-0.5) *blocking* deliverable, not a §6
essay. It is a real sub-project — an unauthenticated, IP-decoupled
(OHTTP/mixnet), RLN/PoW-rate-limited endpoint with constant-shape negatives,
plus a proof in the validator code that the anonymous channel and the envelope
channel cannot be correlated by connection/timing. Until it exists, step 1
must not arm on the live path (fixture-only, or a loudly-labeled
"not-yet-private" preview). VERIFY-YOURSELF should state that F1 gates step 1,
not merely that it is "required."

### A2 — "Effort ≈ one crypto-pass gate, weeks not months, mostly plumbing" understates step 0 by omitting its two hardest, review-bearing pieces.

**What the synthesis says:** TL;DR "Effort read": the do-now foundation "is
comparable to one crypto-pass gate — weeks, not months, and it's mostly
plumbing the project has patterns for."

**Why it's wrong:** two step-0 items are not plumbing-the-project-has-patterns-for:
1. **Signed append-only root history / split-view defense** (F8, HIGH attack
   exists). This is a novel distributed-systems protocol (globally published,
   signed, append-only root log; clients that refuse roots not in the
   published history; cross-device/vault/chain anchoring). The repo has no
   pattern for it — it is genuinely new, and it needs ZK-competent review, not
   a sweep.
2. **The fixture-prover toy scheme** (see A5) that must reproduce *every* live
   failure mode in a real (not `valid:true`) computation. The FC pass shows
   this class of work is where vacuity traps breed (REPORT-FC caught A8/A9
   himself).
And F1 (A1), if honestly folded into step 0, is alone larger than a gate.
"Comparable to one crypto-pass gate" is the FC-pass mental model (build
against a fixture seam, flip one flag) — but the FC pass had no anonymity
property to protect at transport, no signed-root equivocation defense, and no
untestable soundness/ZK obligations. **The analogy imports the effort estimate
from a pass whose hard parts were categorically easier.**

**Correction:** price step 0 as: plumbing (HKDF/registration/scope/leak-grep/
floor — genuinely gate-sized) **plus** two review-bearing sub-projects
(anonymous channel, signed-root-history) that each carry an external-review
gate. Weeks for the plumbing; the assurance items set the real calendar, which
the synthesis actually concedes in the *next sentence* ("the gating cost is
external assurance") — but then the one-gate headline is what a founder
budgets against.

### A3 — Step 1's privacy value is undercut on day one, and the recommendation's own step-0 floor means step 1 may be un-armable at launch — so "the first feature to build" is misleading.

**What the synthesis says:** "The first feature to build: a reputation-threshold
membership gate... the first real moment the operator verifies a claim about a
root without learning which root." Step 0 ships an "anonymity-set floor" gate
that refuses to arm below K.

**Why it's wrong/risky — two compounding cuts F3 does not fully count:**
1. **The transition fallback shrinks the set below the tier cohort.** Step 1
   "keeps a policy fallback for non-ZK clients during transition" (§5). So a
   step-1 proof's anonymity set is not "all tier-≥T roots" — it is "tier-≥T
   roots running a ZK-capable client who took the ZK path this epoch." At
   launch, with partial ZK adoption over N≈100 roots partitioned by tier band,
   that intersection is plausibly single digits even when the tier itself is
   not tiny. F3 counts the tier/epoch/intersection partitions but **not** the
   ZK-adoption partition the transition window introduces.
2. **The floor makes the flagship demo un-shippable at launch.** Step 0's
   minimum-set floor (correctly) keeps the gate dark until ≥K eligible
   ZK-adopting members exist. For any selective/high tier that is months away.
   So the "first real moment the operator verifies without learning which
   root" — the asymmetry money-shot the incremental report sells (§3
   Candidate A) — **cannot run at launch.** The honest description is "first
   feature to build the *machinery* for; arm once the cohort clears the floor,"
   which is a materially weaker and later claim than "the first feature to
   build."

**Correction:** state that step 1 ships privacy *iff* (a) F1 exists (A1) and
(b) the eligible ZK-adopting cohort at the chosen tier clears the floor; until
both hold, step 1 is a plumbing/demo milestone, not a live privacy guarantee.
Add the ZK-adoption partition to F3's shrink analysis.

### A4 — Deferring N5 to "maybe never" is defensible, but the recommendation leaves the operator's *actual* plaintext persona-level linkage — the attribution index — standing after steps 1-4, and never flags it.

**What the synthesis says:** N5 (selective disclosure / grant-resolution) is
"LAST, maybe never," because "Gate 2's vault already denies the server the
grant plaintext, so its marginal value is low." Honest claim: "persona→root
unlinkability, NOT account-existence privacy" (§2.3, F9).

**What the repo actually holds (LIVE, REPORT-FC Gate 4):** the attribution
index `{castHash → personaId}` is recorded at publish time on the one write
door, persisted, and gated only by `canViewPrivate` — an **operator-enforced
access-control rule, not cryptography.** It is exactly a plaintext,
persona-level linkage the operator holds. The incremental report *rejected*
touching it as the first feature (Candidate B) and pushed anonymous
attribution to "step 4½"; even at step 4 the recommendation makes it optional
and notes timing metadata links regardless.

**Why it's under-flagged:** the committee is *right* that persona→root (the
crown jewel) is the priority and that the attribution index is persona-level.
But the boundary is stated as "account-existence privacy" (F9), which is not
the same gap. A founder reading "the validator can never link a proof back to
a root or connect two personas" (TL;DR) can easily conclude the operator can
no longer see who posted what — **false.** castHash→personaId stays in the
operator's plaintext store through step 4, protected only by the operator's own
`canViewPrivate` check, and **no step in the roadmap removes it** (step 4 is
optional and, per the incremental report, undercut by timing metadata even if
built). The "kill the plaintext attribution linkage the validator holds"
framing in the original charter is **not delivered by steps 1-4**; it needs the
deferred Candidate-B/N-adjacent work, and the recommendation does not say so
plainly.

**Correction:** add a flag: "Steps 1-4 do NOT remove the plaintext
castHash→personaId attribution index; it remains operator-visible, guarded by
access control, not crypto. The only linkage steps 1-4 destroy is
persona→root at *decision-read* points. Anonymous attribution is deferred and,
per fc-prior-art/incremental, is partly defeated by traffic analysis even when
built." State this in user-facing copy, not just internals.

### A5 — The fixture-prover is a vacuity trap in a project whose stated closure bar is "4 green sweeps," and the roadmap operationalizes fixture-green as per-step verification.

**What the synthesis says:** fixture transport is "a real computation in a toy
scheme, never a `valid:true` literal, preserving *every* failure mode"
(§5). Each step's "seam verification" column is `accept-z0..z4` fixture checks.

**Why it's risky:** the fixture recomputes a tag over
`canonical(claimKind|publicSignals)`. That catches tampered signals, wrong
root, replayed nullifier, unknown kind — i.e. **dispatch/plumbing** failure
modes. It structurally CANNOT catch the failures that are the entire point:
under-constrained soundness (a witness that satisfies the circuit but not the
intended statement), a leaky nullifier scope (F2 — "both leaky and safe pass
every behavioral test identically," the synthesis' own words), split-view
tagging (F8), or any zero-knowledge/unlinkability defect. The fixture's
"failure modes" are precisely the author's *enumerated* list, which by
construction excludes the untestable properties. "Never a `valid:true`
literal" defeats the crudest vacuity; it does nothing about the subtle one.
This team has a *demonstrated* tendency here: REPORT-FC caught two of its own
vacuity traps in this exact idiom (A9 "could have passed on a 404," A8
"screenshotted without asserting"). Put a fixture-green column next to every
step in a culture where "4 consecutive clean sweeps" is CLOSED, and the
predictable outcome is a step marked done on evidence that cannot see whether
the privacy property holds.

**Correction:** F0 already says "4 green sweeps is NOT closure" — make it
operational: the §5 table needs a second verification column per step naming
the *external assurance* that stands in for the untestable property (scope-table
human review for F2, ceremony/hash-pin for F4, channel review for F1,
root-history review for F8). A step is not shippable on its `accept-z*` column
alone. The fixture is for plumbing regression only and must be labeled as such
everywhere it appears, so it is never mistaken for evidence about soundness or
unlinkability.

### A6 — The §3 alternatives table never considers blind-signed tokens / Privacy Pass, the one primitive that delivers step 1's exact win far cheaper. (see STEELMAN)

**What the synthesis says:** §3 compares Semaphore against Ed25519-in-circuit,
Noir-now, custom-circom, BBS+, and TEE — and dismisses BBS+ as "wrong-shaped
(deliberately unlinkable — the opposite of continuity)." Privacy Pass / VOPRF
anonymous tokens are absent entirely.

**Why it's a gap:** the BBS dismissal conflates step 1 (needs NO continuity)
with steps 2/N2 (need nullifier equality). For the FIRST feature specifically,
unlinkable single-show is *exactly* the right shape, and that is what an
anonymous token gives. Not evaluating it means the committee never priced the
cheaper path against the heavier one. Details and honest counter in STEELMAN.

---

## MISSING FLAGS (not in VERIFY-YOURSELF, or miscalibrated)

- **MF1 (should be TIER 1): F1 gates step 1; it is unscheduled.** VERIFY-YOURSELF
  F1 says the channel is "required / UNSOLVED" but does not say the §5 roadmap
  arms a live gate (step 1) before F1 appears in any step. The scheduling
  hazard — not just the existence of the gap — is the load-bearing omission.
  (Attack A1.)

- **MF2 (new): Steps 1-4 leave castHash→personaId (the attribution index)
  as operator-plaintext, guarded by access control not crypto.** F9 flags
  registration-reveal (commitment↔account) but nothing flags that the
  persona-level attribution linkage the operator already holds (REPORT-FC
  Gate 4) survives the whole migration and is defeated only by the deferred/
  optional step 4 (itself undercut by traffic analysis). A founder will
  overclaim without this. (Attack A4.)

- **MF3 (new): the transition policy-fallback is an anonymity-set partition
  F3 omits.** The step-1 fallback makes the effective set "tier-≥T roots on a
  ZK client who used the ZK path," not "tier-≥T roots." F3 must count the
  ZK-adoption partition, and step 1's floor must be evaluated against that
  smaller number. (Attack A3.)

- **MF4 (miscalibrated): "membership class is UX-viable EVERYWHERE" (§6) is
  contradicted three clauses later ("precompute-recommended on mid-range
  Android") and rests on an EXTRAPOLATED number.** browser-perf's own verdict
  is that on the mid-phone floor the interactive gate "needs either
  optimistic-post... or precomputation" — i.e. NOT viable as a naive
  interactive gate. "Everywhere" should read "interactive on desktop/flagship;
  precompute-only on the mid-range floor, pending the F4/F6 real-device
  measurement." Open-question #1 already admits >10s flips the verdict — so
  "UX-viable everywhere" is stated with more confidence than the report it
  summarizes. (Faithfully carried the browser-perf TL;DR wording, but the
  synthesis kept the headline and buried the caveat.)

- **MF5 (new, low): the fixture-prover cannot regression-test the anonymity-set
  floor or the scope registry's linkage semantics** — the two most
  project-specific privacy controls — because both are properties of
  aggregate/plaintext-observer state, not of a single proof's public signals.
  Their tests are separate and must not be counted under the `accept-z*`
  fixture columns. (Attack A5.)

---

## STEELMAN OF AN ALTERNATIVE — ship step 1 on blind-signed anonymous tokens, not Semaphore

The strongest honest case that the recommended approach is wrong *for this
project's smallest first feature*:

The step-1 win is precisely: "the operator verifies rep≥T about a root without
learning which root, and cannot cheat the verification." That is the textbook
Privacy Pass shape. The validator already knows every root's tier (it assigns
it). Have it **blind-sign a token** — "tier≥T, epoch E" — to each root over the
existing authenticated device-auth channel; the persona later presents the
unblinded token at the gate. The operator cannot link redemption to issuance
(that is the blind-signature guarantee), so it gets the identical unlinkable
tier-proof property. What this buys over Semaphore, at step 1:

- **No trusted setup, no per-circuit ceremony** — deletes F4 (setup integrity,
  the "undetectable universal forgery" flag) for step 1 entirely.
- **No 5.7 MB artifacts, no browser SNARK proving, no Web Worker, no COOP/COEP,
  no mobile-proving risk** — deletes the entire F6 "unmeasured mid-range
  Android" UX gate for step 1. Verification is one signature check (sub-ms),
  vs the 150×-5000× cost browser-perf measured for a ZK gate over plain
  Ed25519 verify.
- **No F7 audit-scope exposure to a 14-minor-version-stale internal audit** —
  the primitives are IETF RFCs with independent analysis (below).
- **A nullifier-like rate limit is native** (one token per epoch), and an
  anonymous-rate-limited-credential variant exists for the same ecosystem.

LIVE-CHECKED 2026-08-30: Privacy Pass issuance is **RFC 9578**; it instantiates
on **VOPRF (RFC 9497)** and **blind RSA (RFC 9474)**, with the HTTP auth scheme
in **RFC 9577**; there is a 2026 IETF draft for *anonymous rate-limited
credentials* (draft-yun-privacypass-arc) — i.e. the nullifier/continuity need —
and a 2025 ACM CCS security analysis of the privately-verifiable variant. The
whole family is deployed at Cloudflare scale and is the ecosystem OHTTP (the
exact IP-decoupling transport F1 wants) already lives in. **The committee's own
F1 fix and my proposed step-1 primitive come from the same standards family,
yet §3 never lists it.**

The critical observation: the committee anchored on Semaphore because it
composes across *all five* needs (N1-N5), then paid Semaphore's full tax —
ceremony, artifacts, mobile-proving risk, F4/F7 — **at step 1**, to amortize
tree/epoch/nullifier-equality infrastructure whose need first materializes at
**steps 2-3** and which the roadmap itself says may never fully ship. That is
the "don't let the prettiest circuit jump the queue" anti-pattern the
incremental report warns about — applied one level up, to the tree machinery
instead of a circuit. A leaner sequence: ship step 1 on blind-signed tokens
(cheap, no ceremony, trivial mobile, standards-grade), and introduce Semaphore
only when step 2's cross-persona continuity/nullifier-equality actually forces
a primitive that tokens can't do.

**Honest counter (why the recommendation probably still stands):**
1. **Two crypto systems, two audit surfaces.** Shipping VOPRF *and* later
   Semaphore doubles the review load and the supply chain; a single primitive
   spanning N1-N5 is a real simplicity win for a solo/small team.
2. **The privately-verifiable token re-centralizes verification** (the
   validator holds the issuer key; other clients trust its word) — the same
   F5 concern the ZK path escapes with a build-pinned client-side vkey. The
   publicly-verifiable variant fixes this but adds its own key-distribution.
3. **The tree/epoch/root-history infra (step 0) is needed for revocation
   (step 3) regardless**, so some of Semaphore's "tax" is not wasted even if
   step 1 used tokens.
4. **F1 is orthogonal** — tokens do NOT save you the anonymous submission
   channel; a token redeemed over the envelope path is just as deanonymized.
   (This actually *reinforces* A1: F1 is primitive-independent and still
   unscheduled.)

Net: the steelman does not overturn the crypto recommendation, but it exposes
that §3's "why this beats the alternatives" is **incomplete** — the cheapest
credible path to the *first* feature's exact win was never on the table, and
the reusability argument that justifies the heavier choice is doing more work
than the document admits.

---

## VERDICT

**The recommendation survives on cryptographic substance and dies on
sequencing honesty.** Semaphore-v4-commitment-sidestep is the right primitive;
the curve-mismatch reasoning is sound; the TEE-skip is well-argued; the
alternatives (except tokens) are fairly dispatched. But the *plan* — the part
this lens owns — has three defects that a confident-but-wrong synthesis
smoothed over:

1. **The single most dangerous unaddressed thing: F1 (the anonymous submission
   channel) is in no step of the build table, yet step 1 arms a live proof
   gate.** As scheduled, step 1 ships a privacy gate that the transport
   deanonymizes before any circuit runs — theater that passes every green
   sweep and every `live-z1` screenshot. F1 must be a step-0 *blocking*
   deliverable, and it is a real sub-project, not a §6 essay.
2. **The "≈ one crypto-pass gate" effort read is wrong** because it prices out
   F1 and the signed-root-history protocol — the two hardest, review-bearing
   pieces — and imports an estimate from a pass (FC) whose hard parts were
   categorically easier (no transport-level anonymity, no equivocation
   defense, no untestable soundness).
3. **The roadmap overstates what steps 1-4 deliver:** step 1's privacy is
   contingent on F1 *and* a cohort that clears the floor (so it is not
   launch-shippable), and the operator's plaintext attribution index
   (castHash→personaId) survives the entire migration guarded only by access
   control — a persona-level linkage the charter's "kill the plaintext
   attribution linkage" language implies is closed and isn't.

Fix: put F1 and signed-root-history in step 0 with named external-review gates;
add a second "external assurance" column to the §5 table so no step closes on
fixture-green alone; recount F3 with the ZK-adoption partition; and add the
attribution-index-survives flag to VERIFY-YOURSELF. Do those and the plan is as
strong as its math. Ship it as written and the first live gate is a privacy
claim the transport cannot honor.

## SOURCES
- Repo, read 2026-08-30: research/RECOMMENDATION.md, research/VERIFY-YOURSELF.md,
  research/incremental-strategist.md, research/browser-perf-realist.md,
  research/fc-prior-art.md, notes/reports/REPORT-FC.md, REPORT-CRYPTO composition claims (via
  the other reports' citations).
- LIVE-CHECKED 2026-08-30: Privacy Pass RFC 9578 (issuance), RFC 9497 (VOPRF),
  RFC 9474 (blind RSA), RFC 9577 (HTTP auth); draft-yun-privacypass-arc-02
  (anonymous rate-limited credentials, 2026); ACM CCS 2025 "Security Analysis
  of Privately Verifiable Privacy Pass"; Cloudflare Privacy Pass standard blog.
  (rfc-editor.org, ietf.org, dl.acm.org, blog.cloudflare.com)
