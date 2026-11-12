# RED TEAM — PRIVACY / DEANONYMIZATION / METADATA lens

Adversarial review of `research/RECOMMENDATION.md` + `research/VERIFY-YOURSELF.md`.
Written 2026-08-30. Posture: I am the malicious validator operator. I host
the trees, I know `commitment ↔ account` from registration, I run the
transport, and I WANT to link personas to roots without breaking the crypto.
My question is not "is Semaphore sound" (it is) — it is "does anything the
crypto proves actually keep me from doing my job." Answer: mostly no, and
the recommendation's own cure for the transport hole (RLN) is one of my
best tools.

Claims tagged **LIVE-CHECKED** (web-verified this pass) or **MEMORY**.

---

## The boundary the synthesis draws, and where it actually holds

The recommendation's honest claim (TL;DR, §2.3, F9) is:
**"persona → root is hidden; account-existence is not."** It repeats a
stronger sentence in the TL;DR: the operator *"can never link a proof back
to a root or connect two personas of the same root."*

That stronger sentence is **false as written** for the adversary in scope.
"Never" is true only for *"link from the proof's cryptographic content
alone."* Every attack below links proofs to roots — and personas to each
other — with zero crypto broken, and every one of them is cheapest for
exactly the party the ZK layer names as the adversary. The recommendation
front-loads the provable half (the crypto) and files the deciding half
(metadata) as TIER 3 / out-of-scope. For a transport-controlling operator,
the metadata IS the security, so the priority ordering is backwards.

---

## ATTACKS

### A1 — RLN, the prescribed submission-channel fix, is itself a same-root cross-persona linkage oracle (the most dangerous unflagged item)

**What the synthesis says:** F1 and §6 prescribe RLN to rate-limit the
anonymous proof endpoint "without identifying callers" (audited 2023). The
only RLN caveat anywhere is F11 / trust-auditor §1.6: the slashing secret
must be a dedicated leaf, *not the root seed* — a **blast-radius** concern,
not a linkage concern.

**Why it's wrong/risky:** RLN's rate limit works by making a member's
identity secret leak across messages in an epoch. **LIVE-CHECKED**
(rate-limiting-nullifier.github.io/rln-docs, RLN-in-details): the *internal
nullifier* is `hash(a_1)` where `a_1 = hash(identity_secret,
external_nullifier)` and `external_nullifier = hash(epoch, rln_identifier)`
— and *"the internal nullifier remains the same across all messages in the
same epoch."* That sameness is the whole detection mechanism.

Now the fatal design tension the synthesis never states:

- If the RLN identity is **per-root** (it essentially must be — a per-persona
  RLN identity hands a root N personas' worth of rate budget, so Sybils
  defeat the rate limit the endpoint exists to enforce), then **every proof
  a root submits in one epoch carries the same RLN internal nullifier.** I,
  the operator, read the internal nullifier off each submission and group
  them: all these "anonymous" tier/attestation proofs came from ONE RLN
  membership leaf → one root. The Semaphore layer carefully unlinks the
  personas; the RLN layer wrapped around it re-links every one of them
  submitted in the same epoch.
- The only escape is to submit at most one proof per root per epoch — which
  forces serialization and turns proof-submission *cadence* into a per-root
  fingerprint (A8), and starves the interactive-gate UX the rec sells.

So the recommended transport fix reintroduces the exact
reconstruct-the-attribution-table outcome that F2 treats as the
project-specific killer — except F2 guards the *proof* nullifier and
nobody guards the *RLN* nullifier. This is a deanonymization vector **none
of F1–F20 names.**

**Correction:** The RLN membership/epoch design must be added to the F2
scope table as a first-class linkage surface. Either (a) the RLN identity
is rotated/scoped so per-epoch nullifiers do not group a root's submissions
(hard — it fights the rate-limit semantics), or (b) the rate-limit budget
is deliberately ≥ the max proofs a root will submit per epoch AND proofs
are spread across epochs with decorrelation, or (c) use a stateless
rate-limiter (PoW, or anonymous tokens / Privacy Pass) that carries no
stable per-root nullifier. The recommendation currently presents RLN as the
settled answer; it is a second nullifier-scope problem wearing a
rate-limiter's clothes.

### A2 — OHTTP is named as if it were a drop-in; its entire guarantee is a non-colluding third-party relay the operator does not have

**What the synthesis says:** F1 and §6 call for "IP decoupling
(OHTTP relay / mixnet-style)" as a mitigation, in the same breath as RLN,
as though it is a library to install.

**Why it's wrong/risky:** **LIVE-CHECKED** (RFC 9458; Mozilla/Cloudflare
OHTTP docs): OHTTP's privacy holds *only* if the **relay and the gateway
are operated by different, non-colluding parties** — *"if the relay and
gateway collude, they can correlate your IP with your request,"* and *"the
gateway is generally run by the same organization as the target."* In the
Layers deployment the operator runs the validator (target) and, by default,
the gateway. That leaves the relay: it must be a genuinely independent
organization the operator must find, fund, contract, and trust forever not
to collude — or the IP-decoupling is theater and the operator joins
IP → request directly. This is not a design detail; it is a **standing
external-party dependency and recurring cost** that appears nowhere in the
"effort read" ("weeks, mostly plumbing the project has patterns for").
F1 calls the transport "an architecture gap no library fixes" but frames
the fix as a one-time design, when it is an ongoing trust relationship on
the critical path of the headline claim.

**Correction:** Flag the OHTTP relay as a third-party non-collusion
dependency with its own trust assumption (equal in weight to the ceremony
trust in F4), name a candidate relay operator, and price it. Absent an
independent relay, do not claim IP unlinkability against the operator.

### A3 — The anonymity set is k NAMED accounts the operator can profile, not k anonymous strangers

**What the synthesis says:** F3 frames launch privacy as k-anonymity over
"~100 roots," mitigated by a minimum-set floor.

**Why it's wrong/risky:** The operator hosts the tier trees and knows
`C_root ↔ account` for every leaf (§2.3, and rep is operator-computed
anyway). So when a proof asserts membership in `zkTier[3]`, my candidate set
is not "100 unknown roots" — it is *the specific, named, fully-profiled
accounts I placed in `zkTier[3]`.* k-anonymity among strangers resists
auxiliary-info attacks; k-anonymity among named candidates I already run
analytics on does not. A persona that "sounds like" account X, posts in
X's timezone, and appears right after X goes quiet is deanonymized inside a
set of 50 the instant I have any side channel — and I have many. The F3
mitigation (a floor of K) is a floor on the *count* of named candidates,
which is a far weaker object than F3's "k-anonymity" language implies.

**Correction:** F3 must state that the anonymity set is
operator-de-anonymizable by identity, not just by count, and that the floor
K must be sized against *auxiliary-information* intersection, not raw set
size. This materially raises the required K and weakens the "unlinkable"
copy the floor is supposed to license.

### A4 — personaId is a PUBLIC signal in every gate proof, so longitudinal intersection needs no crypto and the min-set floor does nothing about it

**What the synthesis says:** §2.4 binds the signal to
`personaId ‖ gateId ‖ challenge ‖ treeRoot` for anti-replay. F3 acknowledges
"intersection over successive proofs drives k toward 1" but its *mitigation*
is the instantaneous min-set floor + batching + UX copy.

**Why it's wrong/risky:** Because personaId rides the signal **in the
clear**, I don't need nullifier analysis to intersect. I read personaId off
every proof and, for each persona, intersect the candidate root-sets across
*all* its proofs over its whole lifetime: tier-≥3 today (candidates = tier-3
accounts), tier-≥4 after a promotion next month (candidates = tier-4
accounts ⊂ tier-3), holds-attestation-from-I (candidates ∩ `zkAttest[I]`).
Each proof individually clears the ≥K floor; the *intersection* collapses to
one named account. The min-set floor is instantaneous; the attack is
longitudinal, and the public personaId is the join key that makes it free.
The floor mitigation is therefore **miscalibrated** against the very attack
F3's own claim text names.

**Correction:** A per-persona *proof-history* budget (how many distinct
partitioning public inputs a persona may ever emit before its candidate set
is assumed collapsed), not just an instantaneous floor. And an explicit
flag isolating "personaId-in-signal is the intersection join key" — right
now no flag names the public signal as the leak substrate.

### A5 — Separate trees per predicate means every second proof type is an instant intersection; the rec's "one proof serves N1+N3" pride does not extend to N4

**What the synthesis says:** §2.4/§2.5 celebrate that one Semaphore proof
covers rep-threshold + non-revocation at once (membership in `zkTier[T]`,
revocation = leaf removal). N4 (attestation) is a *separate* membership in
`zkAttest[issuer]`.

**Why it's wrong/risky:** The composition that saves a proof for N1+N3 does
NOT save one for N4 — attestation is a different tree with the SAME public
personaId signal. The moment a persona emits both a tier proof and an
attestation proof, I intersect `zkTier[T]`-accounts ∩ `zkAttest[I]`-accounts,
both of which I can enumerate by account. The architecture's tree-per-
predicate factoring is clean for the prover and a gift to the intersecting
operator. The rec never states that using ≥2 proof types on one persona is a
privacy event.

**Correction:** Treat "number of distinct trees a persona proves against"
as a privacy budget; document that N4 stacked on N1 is an intersection, not
a free composition.

### A6 — Fork reputation-porting (step 2) is a DELIBERATE persona→persona link handed to the operator, contradicting the "never connect two personas" headline

**What the synthesis says:** TL;DR: the operator "can never ... connect two
personas of the same root." Step 2 ships "fork reputation-porting
continuity" — prove "the root behind new persona P′ is the same root that
held reputation R," message = new persona id, via nullifier equality.

**Why it's wrong/risky:** Porting *is* the act of proving P′ inherits
standing that publicly belonged to a prior persona/root. Reputation is
surfaced on personas; the old standing R is associated with an observable
prior identity. So the port publishes "P′ shares a root with the thing that
had R" — a persona→persona link, by design, as the **second feature built.**
The N2 continuity primitive the rec praises as "user-chosen context" is,
in its first real use, an operator-visible delinking waiver. The headline
guarantee and the build sequence contradict each other, and the synthesis
never reconciles them.

**Correction:** State plainly that continuity/porting features are opt-in
*waivers* of the unlinkability guarantee for the specific personas involved,
carry their own user-facing disclosure, and must never be described by the
blanket "we can never connect your personas" claim. This is an overclaim the
synthesis makes against its own §5 table.

### A7 — Registration over the device-auth channel is presented as solved; the source report rated the anonymous-registration channel UNSOLVED, and device-auth leaks join-order + is session-correlatable

**What the synthesis says:** §2.3 resolves registration as "authenticated by
the root's Ed25519 device-auth key ... first-write-wins," with the single
caveat "must NOT ride a persona context." F9 echoes this as HIGH-confidence
analysis. The anonymous channel is demoted to Open Question #4.

**Why it's wrong/risky:** fit-architect F14 (confidence LOW,
*identified-unsolved*) said the opposite: *"registration must ride an
anonymous channel (fresh unlinkable token, or one-time mixnet/OHTTP
submission), not the device envelope"* — because the device identity is a
persistent per-root pseudonym, so "device D inserted leaf i" gives the
operator device → C_root directly, and device D is already the account.
The synthesis quietly **upgraded an unsolved leak into a solved step** and
kept only the weaker "not from a persona context" half. Registering over
device-auth is *consistent with* the stated boundary (account-existence not
hidden), but it leaks more than existence: it leaks each account's **join
order and join time** into the ZK set (feeding the F3 join-time correlation:
first proof against a new tree version ≈ the new member), and it is
correlatable with the account's other device-auth traffic on the same
connection/session. "Not from a persona context" is necessary, not
sufficient, and it is dressed as sufficient.

**Correction:** Restore fit-architect F14's severity: the anonymous
registration/enrollment channel is an UNSOLVED architecture gap, not a
resolved §2.3 step. Batched-epoch insertion with decorrelated timing is the
minimum; blind-issued enrollment is the real fix.

### A8 — Proof-submission timing vs persona-activity is the operator's cheapest deanonymizer, and it is filed TIER 3 / out-of-scope

**What the synthesis says:** F14 (traffic analysis) is TIER 3, "out of
scope, must be stated." §6's timing mitigation is about *roster insertion*
("batch per epoch, never insert-then-immediately-prove") — registration
timing, not proof timing.

**Why it's wrong/risky:** The F1 apparatus (unauth + RLN + OHTTP) protects
one submission's content and IP. It does nothing about *when* the submission
arrives relative to the persona's authenticated activity, which I see
because I run the validator: persona P posts a root-linked cast at T; an
"anonymous" tier proof lands at T+300ms. Correlation links them through
OHTTP, through RLN, through everything — the interactive gate proves *at the
moment you act*, so the proof is timing-bound to the action by construction.
Defeating it requires precompute + randomized delayed submission, which
breaks the "~200ms warm interactive" UX the rec advertises (§2.4). For a
transport-controlling adversary this is not a Tier-3 footnote; it is the
tallest pole, and it structurally conflicts with the product's own UX
claim. Ranking the strongest practical deanonymizer lowest is a severity
inversion.

**Correction:** Promote proof-vs-activity timing correlation to Tier 1.
Specify decorrelation (precompute at idle, submit on a jittered/batched
schedule decoupled from the triggering action) as a hard requirement of any
"unlinkable" gate, and acknowledge the UX cost honestly rather than selling
interactive latency and unlinkability as simultaneously achievable.

### A9 (meta) — "never link" overclaims relative to the project's own VERIFY-YOURSELF

VERIFY-YOURSELF §4/F0 correctly says ZK-ness and side-channel linkage are
behaviorally invisible and rest on external review. But the RECOMMENDATION's
prose ("can never link a proof back to a root") states an absolute a reader
will quote. A1–A8 each link without breaking crypto. A document whose own
companion says "small anonymity sets leak with zero failing assertions"
should not, three sections earlier, say the operator "can never" link.
The gap between the confident body and the honest appendix is itself a risk:
the body is what ships in a pitch deck.

---

## MISSING FLAGS (not in VERIFY-YOURSELF, or miscalibrated there)

1. **RLN per-epoch nullifier = same-root cross-persona linkage (A1).** NEW,
   HIGH. No flag names it; F11 covers only slashing blast-radius. Belongs in
   the F2 scope table as a second nullifier surface.
2. **OHTTP relay non-collusion is a standing third-party trust dependency
   and cost (A2).** F1 names OHTTP but not that its guarantee collapses if
   the operator runs the relay; missing from the effort read. HIGH.
3. **The anonymity set is operator-de-anonymizable by identity, not just
   count (A3).** F3 miscalibrated: min-set floor must be sized against
   auxiliary-info intersection over *named* candidates. Raise K materially.
4. **personaId is a public signal = the free intersection join key (A4).**
   No flag isolates the public signal as the leak substrate; F3's
   instantaneous floor does not touch longitudinal intersection. Needs a
   per-persona proof-history budget. HIGH.
5. **Tree-per-predicate ⇒ each extra proof type is an intersection (A5).**
   The "one proof serves N1+N3" composition does not extend to N4; using ≥2
   proof types on one persona is a privacy event. MED-HIGH, unflagged.
6. **Continuity/porting (step 2) is a deliberate persona→persona link and
   contradicts the headline (A6).** No flag frames continuity features as
   opt-in unlinkability *waivers*. HIGH; it is a live feature, not step 5.
7. **Registration-channel anonymity was downgraded from UNSOLVED (source
   fit-F14) to solved (§2.3) (A7).** Restore severity; join-order/time and
   session correlation leak past "account-existence." HIGH.
8. **Proof-vs-activity timing is Tier 1, not Tier 3, for this adversary, and
   conflicts with the interactive-UX claim (A8).** F14 severity inversion.

---

## STEELMAN OF THE ALTERNATIVE (the rec is wrong for THIS project)

The strongest honest case against shipping this: **at a ~100-account launch
where the operator already holds `commitment ↔ account`, the Semaphore layer
adds almost no privacy against the only adversary that matters, because
every practical deanonymizer routes around the crypto and every one is
cheapest for the operator** — RLN epoch nullifiers (A1), OHTTP with an
operator-run relay (A2), named-candidate intersection over the public
personaId (A3/A4/A5), proof-vs-activity timing (A8), and the porting feature
that links personas on purpose (A6). What the ZK layer *does* reliably
produce is the word "unlinkable" in marketing (the rec flags this as F6),
over a system that is linkable by metadata. A false unlinkability claim is
arguably **worse** than an honest "the operator can correlate your activity;
here is exactly what we log and how we minimize it," because it induces
users to behave as if unlinkable when they are not.

So the honest sequencing is the reverse of the recommendation. Build order
should be: **(1) metadata/transport decorrelation FIRST** — jittered/batched
proof submission decoupled from activity, a real third-party OHTTP relay, a
stateless (PoW / Privacy-Pass) rate-limiter with no stable per-root
nullifier, batched-epoch registration, honest logging posture; **(2)** run
the existing untrusted validator inside a Nitro enclave as
defense-in-depth (the rec already permits this as silent hardening, §3);
**(3)** add ZK membership only once the cohort is large enough AND the
metadata story exists that the crypto is the *binding* constraint rather
than the weakest link. The recommendation front-loads the easy provable
crypto (weeks of plumbing) and files the hard unprovable metadata as
TIER 3 / out-of-scope. For this adversary the metadata IS the security, so
arming any "unlinkable" gate before the metadata story is designed ships a
hole with a certificate of soundness stapled to it.

**Why I ultimately think the ARCHITECTURE still stands:** the crypto choices
are right — dual-key HKDF branch, Semaphore v4, out-of-circuit binding,
defer custom circuits. Nothing above argues for a different primitive; it
argues that the primitive is not where the risk lives, and that the
*claim* and the *build order* are miscalibrated for the privacy adversary.
The fix is not a different stack — it is: demote none of F1/A1/A2/A8 below
Tier 1, gate the "unlinkable" copy behind the metadata work, and never let
step 1 arm before the submission-channel + timing + RLN-linkage design has
had the same external review F4/F5 demand for the crypto.

---

## VERDICT

**The recommendation's cryptography survives; its privacy *claim* does not,
as written, and its *sequencing* is backwards for the stated adversary.**
The architecture (Semaphore + dual-key + out-of-circuit binding) is correct
and I would not change it. But VERIFY-YOURSELF, which is supposed to be the
thing standing between a confident-but-wrong recommendation and a hole, has
a hole of its own on the privacy axis: it exhaustively covers the crypto and
under-covers the metadata that actually defeats this adversary.

**Single most dangerous unaddressed thing:** the RLN rate-limiter that F1
prescribes as the fix for the deanonymizing submission channel is *itself* a
same-root cross-persona linkage oracle — its internal nullifier is, by
design, identical across all of a member's messages in an epoch
(LIVE-CHECKED), so a per-root RLN identity re-links every "anonymous" proof
a root submits in that epoch, reconstructing the exact attribution table the
whole layer exists to destroy. The cure for the transport hole reopens the
wound, and no flag names it. Runner-up: personaId travels in the proof
signal in the clear, so the operator's intersection deanonymization needs no
crypto break and the minimum-set floor — the one F3 mitigation — does
nothing about it.

---

## Sources (this pass)

- rate-limiting-nullifier.github.io/rln-docs (what_is_rln, rln_in_details);
  medium.com/privacy-scaling-explorations RLN explainer — internal nullifier
  = hash(identity_secret, epoch-derived external nullifier), *constant across
  all messages in one epoch*; slashing reconstructs the secret on
  over-limit. LIVE-CHECKED 2026-08-30.
- RFC 9458 (Oblivious HTTP); Mozilla OHTTP-explained; Cloudflare/Divvi Up
  OHTTP docs — privacy holds only if relay and gateway are non-colluding
  separate parties; gateway is typically the target's own org; colluding
  relay+gateway correlates IP ↔ request. LIVE-CHECKED 2026-08-30.
- Repo: research/RECOMMENDATION.md, research/VERIFY-YOURSELF.md,
  research/trust-auditor.md, research/incremental-strategist.md,
  research/fit-architect.md, research/curve-mismatch.md — read this pass.
