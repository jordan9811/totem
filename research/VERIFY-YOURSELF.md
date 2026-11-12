# VERIFY-YOURSELF — human-verification flags for the ZK layer

The most important output of the research pass. Every judgment call the
committee made that (a) a subagent could be wrong about and (b) would be
catastrophic or expensive to get wrong. Consolidated and de-duplicated
from all seven role reports, ranked by blast radius.

**Read this before trusting one line of the recommendation.** The
project's evidence culture — 42-suite behavioral sweeps, 4-consecutive-
clean gates — is excellent at completeness and *cannot see soundness,
zero-knowledge-ness, trusted-setup integrity, or side-channel linkage*.
A sound-looking unsound circuit passes every green test. A backdoored
setup verifies every honest proof identically to an honest one. Small
anonymity sets leak with zero failing assertions. For this layer, "4
green sweeps" is NOT closure — the closure bar must name the external
assurance (audit / ceremony-verify / expert review) that stands in for
each untestable property. That standing rule is **F0** and it colors
everything below.

Confidence = the committee's confidence the CLAIM IS TRUE (so LOW
confidence = "we are guessing, check hard"). "Changes it" = what evidence
would move the verdict.

---

## TIER 1 — Get one of these wrong and the entire privacy guarantee is silently void

### F1 — The anonymous submission channel (HIGH confidence it's required; UNSOLVED)
**Claim:** A ZK proof submitted over the existing device-envelope write
path — or any authenticated/cookied/IP-stable channel — is linked to a
root by the envelope signature *before any circuit runs*. The whole
unlinkability property dies at transport, independent of proof system.
**Why it matters:** This is not a library gap you can patch later; it
contradicts the validator's current "every write is device-authorized"
model. If proofs ride the normal channel, the operator gets a
root↔proof table and the ZK layer is theater.
**Verify:** Have a *systems-privacy-competent human* (not an LLM) design
and review the proof-submission transport: no envelope, no session
cookies, RLN or PoW rate limiting, IP decoupling (OHTTP relay / mixnet),
constant-shape negative responses, and no same-connection correlation
(don't submit a persona cast and a root proof over one HTTP/2 socket).
Confirm in the validator code that the two channels cannot be correlated
by connection/timing.
**Confidence:** HIGH that it's required. **Changes it:** nothing —
structural. (Sources: trust-auditor F1/§0.1/§2.2, incremental §6.7.)

### F2 — The nullifier-scope table (HIGH; the project-specific killer)
**Claim:** A Semaphore nullifier is `H(secret, scope)`. If any two proofs
by DIFFERENT personas of the same root share `(secret, scope)`, they emit
the SAME nullifier and the validator links the personas — reconstructing
the exact attribution table ZK exists to destroy, now in math. Scope too
coarse → cross-persona linkage; scope too fine → the property being
proved (same-human, sybil-resistance) evaporates. Both the leaky and safe
designs pass every behavioral test identically.
**Why it matters:** One string decides it, at every gate. This is the
single most likely place a subtle design error silently *inverts* the
headline guarantee.
**Verify:** Write the full table (proof type × scope derivation × what
nullifier-equality means × who may observe it) and have a ZK-competent
human adversarially derive what an observing validator learns from
nullifier equality across personas, contexts, and epochs. Freeze the
scope-construction in ONE module with the same discipline as
`kdf.ts`'s info strings. The default for per-persona gates is
`(feature, epoch, personaId)`; `(feature, epoch)` deliberately collides
siblings and is ONLY for one-per-human semantics — and must be named as
such at the call site.
**Confidence:** HIGH a mistake is likely without review. **Changes it:** a
reviewed, versioned scope spec with a written linkage argument.
(Sources: trust-auditor F2/§2.3, fit-architect §5.6, incremental F7.)

### F3 — Launch anonymity set is ~100 roots and shrinks under public inputs (HIGH)
**Claim:** A membership proof over N≈100 roots starts at k=100 and only
shrinks: every public input (tier band, epoch, threshold) partitions the
set; intersection over successive proofs drives k toward 1; join-time
correlation (first proof after a tree insert = the new member) shrinks it
further — all with zero crypto failing.
**Why it matters:** Selling "unlinkable" over a set of 6 Gold-tier roots
is a false claim with reputational blast radius, and it is *arithmetic*,
not a bug.
**Verify:** Run the numbers against real expected cohort sizes and tier
distributions (a spreadsheet). Set and DOCUMENT a minimum-set floor below
which a proof feature stays dark (a tier gate refuses to arm until ≥K
eligible members). Batch/epoch roster insertions, add a minimum delay
before first proof, review UX copy against the real early-cohort math.
**Confidence:** HIGH (it's counting). **Changes it:** launch-cohort math
showing genuinely large sets. (Sources: trust-auditor §2.1/F7,
incremental F5, fit-architect §5.1.)
**RED-TEAM RECALIBRATION (raise K materially):** the set is not k anonymous
strangers — the operator hosts the trees and knows `C_root ↔ account` for
every leaf, so a proof's candidate set is *k specific, named, fully-
profiled accounts it already runs analytics on*. k-anonymity among named
candidates falls to any auxiliary side channel (timezone, posting cadence,
"goes quiet then persona appears"). AND the step-1 transition fallback adds
a partition F3 omits: the effective set is "tier-≥T roots **on a ZK client
who took the ZK path this epoch**," plausibly single digits at partial
launch adoption even when the tier isn't tiny. Size the floor K against
auxiliary-info intersection over named candidates including the ZK-adoption
partition — not raw set size. (Sources: redteam-privacy A3, redteam-
pragmatics A3/MF3.)

### F4 — Trusted-setup integrity, per circuit (HIGH; undetectable if wrong)
**Claim:** Stock Semaphore inherits a real completed ceremony (Jul 2024,
400+ participants); ANY custom circuit (step 5, or any edit to a
Semaphore circuit) needs its own phase-2 ceremony. Whoever holds a
circuit's phase-2 toxic waste can forge valid proofs for ANY statement in
that circuit — forged rep, forged same-human, forged non-revocation —
**undetectably, forever.** A solo-dev "we generated the zkey on my laptop"
setup is an unfalsifiable universal-forgery capability. Even a *faked*
transcript is caught only if someone actually runs `snarkjs zkey verify`.
**Why it matters:** No behavioral test, no sweep, no on-chain anomaly ever
reveals a backdoored setup. Precedent: Zcash BCTV14 counterfeiting was
exploitable from the *published* transcript and survived two audits + 3
years.
**Verify:** For stock Semaphore — locate the v4 ceremony transcript,
verify attestations, and hash-check the zkey artifacts the client loads
against ceremony output; pin the hash in the repo and assert it at
verifier load. For any custom circuit — run a real multi-contributor
ceremony (PSE p0tion) with genuinely independent participants, publish
ptau + r1cs + zkey + transcript, and have a third party run
`snarkjs zkey verify`. (Or choose Noir/UltraHonk to delete per-circuit
ceremonies — verify its universal SRS provenance instead.)
**Confidence:** HIGH (well-understood mechanism). **Changes it:** nothing —
this is the Groth16 deal. (Sources: trust-auditor §1.1/F5, incremental
F3, primitive-scout.)

### F5 — The verifier must be client-side, and vkey/params pinned (HIGH)
**Claim:** If the validator is the only party that verifies proofs, every
other client trusts the validator's word — re-centralizing exactly the
integrity trust the ZK layer removes. And a verifying-key or SRS the
verifier loads from the untrusted server (or an unpinned download) voids
soundness: the attacker verifies proofs from their own circuit.
**Why it matters:** A silent "proof checked ✓" bit from the validator, or
a swapped vkey, restores the operator to the trust base invisibly.
**Verify:** Architecture review — every proof-derived fact served to third
parties either carries the proof + public inputs for local verification
against a **build-pinned** vkey (whose hash is published), or is
explicitly documented as validator-trusted. Confirm the vkey is compiled
into the client/app build, never fetched from the validator it guards.
Bind proof-TYPE into public inputs and the dispatch table (a cheap-
statement proof must not satisfy an expensive gate). Verifier fails
CLOSED (a throw = reject, per REPORT-CRYPTO's `verifyCanonical` template).
**Confidence:** HIGH (structural). **Changes it:** the interface spec.
(Sources: trust-auditor §0.2/§3.5/F18.)

### F1b — RLN, the prescribed rate-limiter for the F1 channel, is ITSELF a same-root cross-persona linkage oracle (HIGH; added by red team — the single most dangerous non-obvious item)
**Claim:** RLN detects rate-limit violations by making a member's internal
nullifier *identical across all their messages in an epoch*
(LIVE-CHECKED: rln-docs — internal nullifier = `hash(hash(secret,
external_nullifier))`, constant per epoch). A per-root RLN identity — which
is forced, since a per-persona RLN identity hands a root N personas' worth
of rate budget and defeats the limit — therefore emits the SAME nullifier
on every "anonymous" proof a root submits in one epoch. The operator reads
it off and groups them: all these unlinked-by-Semaphore proofs came from
ONE root. **The cure F1 prescribes for the transport hole reopens the
exact linkage F2 exists to close.**
**Why it matters:** It silently reconstructs the attribution table, and no
prior flag names it — F11 covers only RLN's slashing blast-radius.
**Verify:** Add the RLN membership/epoch design to the F2 scope table as a
first-class linkage surface. Prefer a STATELESS rate-limiter for the proof
endpoint — PoW, or anonymous tokens / Privacy Pass (RFC 9578) which carry
no stable per-root nullifier. If RLN is used anyway, prove that its
per-epoch nullifier cannot group a root's submissions (hard — it fights
the rate-limit semantics).
**Confidence:** HIGH (the RLN mechanism is live-verified). **Changes it:**
a stateless rate-limiter, or an RLN scoping that provably doesn't group.
(Source: redteam-privacy A1.)

### F2b — personaId travels in the proof signal in the CLEAR — the free intersection join key (HIGH; added by red team)
**Claim:** The gate signal binds `personaId ‖ gateId ‖ challenge ‖
treeRoot` for anti-replay, so personaId is a public output of every proof.
The operator needs no nullifier analysis: it reads personaId off each proof
and intersects that persona's candidate root-set across ALL its proofs over
its lifetime (tier-3 today ∩ tier-4 after promotion ∩ holds-attestation-I),
collapsing to one *named, already-profiled* account. Each proof clears the
instantaneous F3 floor; the longitudinal intersection defeats it for free.
**Why it matters:** F3's minimum-set floor — the one mitigation offered —
does nothing about this. It's the operator's cheapest deanonymizer after
timing.
**Verify:** Add a per-persona *proof-history budget* (how many distinct
partitioning public inputs a persona may emit before its candidate set is
assumed collapsed), not just an instantaneous floor. Review whether
personaId must ride the signal in clear or can be replaced by a
per-proof-fresh binding. Treat "number of distinct trees/predicates a
persona proves against" as a privacy budget (using ≥2 proof types on one
persona is itself an intersection event).
**Confidence:** HIGH. **Changes it:** a design where the public signal is
not a stable cross-proof join key. (Sources: redteam-privacy A4/A5.)

### F1c — The anonymous submission channel is UNSCHEDULED, yet step 1 arms a live gate (HIGH; added by red team — scheduling hazard)
**Claim:** F1 says the channel is required; the §5 roadmap puts it in NO
step, while step 1 ships a live Semaphore proof gate. The only channel that
exists is the device-envelope path, which links every proof to a root by
its signature before any circuit runs. As scheduled, step 1 ships a gate
that is private in every screenshot and green `live-z1` run and is not —
theater with a certificate of soundness stapled to it, invisible to the
project's evidence culture (F0).
**Why it matters:** It's not just that the gap exists (F1) — it's that the
roadmap arms the privacy claim one full step before the fix is scheduled.
**Verify:** Make F1 a step-0 BLOCKING deliverable and treat it as a real
sub-project: an unauthenticated, IP-decoupled, stateless-rate-limited
endpoint with constant-shape negatives, PLUS a proof in the validator code
that the anonymous channel and the envelope channel cannot be correlated by
connection/timing. Step 1 must not arm on the live path until it exists
(fixture-only, or a loudly-labeled not-yet-private preview). Note OHTTP's
IP-decoupling needs a non-colluding third-party relay the operator does not
have — a standing external trust dependency and cost, not a library
(RFC 9458 LIVE-CHECKED).
**Confidence:** HIGH. **Changes it:** F1 scheduled as a blocking step-0
item with its relay dependency priced. (Sources: redteam-pragmatics A1/A2,
redteam-privacy A2.)

### F5b — Proof-vs-activity TIMING is Tier 1, not Tier 3, and conflicts with the interactive-UX claim (HIGH; added by red team — severity inversion)
**Claim:** An interactive gate proves *at the moment you act*, so an
"anonymous" tier proof landing at T+300ms is timing-bound to the
persona-authored action at T — correlatable by the transport-controlling
operator through RLN, OHTTP, and everything else, with no crypto broken.
The prior flag list files traffic analysis as Tier 3 and its timing
mitigation covers only *roster insertion*, not *proof* timing.
**Why it matters:** For the named adversary this is the tallest pole, and
it structurally conflicts with the "~200ms warm interactive" UX the
recommendation sells — unlinkability and interactive latency are not
simultaneously achievable here.
**Verify:** Require decorrelation — precompute the credential at idle,
submit on a jittered/batched schedule decoupled from the triggering action
— as a hard precondition of any "unlinkable" gate, and price the UX cost
honestly. Do not describe a gate as both interactive and unlinkable.
**Confidence:** HIGH. **Changes it:** nothing — it's structural; the fix is
honest sequencing + UX. (Source: redteam-privacy A8.)

### F5c — Set-contents integrity is a TRUSTED-VALIDATOR, unauditable property; "cannot forge membership" is misleading (HIGH; added by red team — the largest soundness gap)
**Claim:** Because "rep ≥ T", "not-revoked", and "holds-attestation" are
implemented as membership in validator-curated trees of OPAQUE
commitments, the operator decides who is tier-3 / unrevoked / attested. It
never fakes a Merkle path (true), but it inserts whatever leaves it wants —
so it can grant an unearned privilege, or decline to revoke a compromised
root, undetectably. The ZK layer removes persona→root LINKAGE, not the
operator's authority over what is TRUE about a root. This is invisible
because the leaves are opaque, and it is a *different* property from
verifier/vkey integrity (F5, F19 — proof checked against the *right
circuit*) which does not cover whether the *tree was honestly built*.
**Why it matters:** A reader concludes the operator is removed from the
trust base; it is not — only from the linkage. The fit-architect report
kept the predicate cryptographic via placement/attestation circuits (its
F3/F4); this synthesis dropped them and marked N1/N4 "No custom circuit."
**Verify:** Decide per predicate whether you need the *predicate itself*
trustless (a root proves its own rep in a placement circuit — re-incurs
per-circuit ceremony + audit) or only the *linkage* hidden (membership,
validator-trusted for contents). State the choice in user-facing copy;
"the operator can't see which root" is NOT "the operator can't decide your
tier." Also: a malicious operator can build a singleton/tiny group and
induce a target to prove against it, reaching k=1 with no crypto failing
(distinct from F8 split-view and F3 honest partitioning).
**Confidence:** HIGH (analysis, confirmed against the primitive).
**Changes it:** the predicate-trustlessness choice, made explicitly.
(Sources: redteam-soundness A1/A2/A4/A8/MF1.)

---

## TIER 2 — Wrong here and a feature is broken, a claim is false, or a leak opens

### F6 — Mid-range mobile proving time is unmeasured (MED; UX gate)
**Claim:** ~200ms desktop / ~0.9s flagship phone is MEASURED; ~3–8s
mid-range Android is EXTRAPOLATED (flagship × Pixel-6 ratios), not run.
**Why it matters:** If it's actually >10s on the target floor, the
interactive-gate verdict flips to precompute-only, and the TEE proving-
delegation exception (or a different stack) re-enters.
**Verify:** Run `research/poc/browser-timing.html` on a real Pixel-6 /
Galaxy-A-class device and an older iPhone (serve over LAN with
`research/poc/serve.mjs`). Also re-test bb.js iOS-Safari OOM if Noir is
ever considered — the one on-record data point (Hyli, Mar 2025) is stale.
**Confidence:** MED for laptop/flagship, LOW for mid mobile. **Changes
it:** measured numbers. (Sources: browser-perf F1/F3, incremental F2,
curve-mismatch.)

### F7 — Semaphore v4's audit is INTERNAL and its scope is unread (MED)
**Claim:** The only audit found is PSE's *internal* March-2024 audit of
v4.0.0. No third-party audit surfaced. Whether it covers the 4.14.x
libraries + LeanIMT + the JS proving stack we'd install is unverified, and
"no critical bug since" is from memory.
**Why it matters:** The whole "audited standard primitive" premise rests
on it; an internal audit has weaker independence, and the version we'd
ship is 14 minor releases past the audited one.
**Verify:** Read `semaphore.pse.dev/Semaphore_4.0.0_Audit.pdf` end to end
(scope + findings). Search the Semaphore repo / advisories / PSE Discord
for post-2024 circuit issues. Confirm the npm packages you'd install map
to the audited circuit commits and the ceremony zkeys. Ask PSE whether any
third-party firm reviewed v4 post-March-2024.
**Confidence:** MED-HIGH audit exists; LOW on scope/"nothing since."
**Changes it:** the PDF + an advisory search. (Sources: all five committee
reports flag this — primitive-scout F, fit-architect F2, trust-auditor F3,
browser-perf 8, incremental F1.)

### F8 — Split-view / tree-tagging by the validator (HIGH attack exists; MED best defense)
**Claim:** A malicious validator can serve each client a slightly
different Merkle root; each proof then reveals which root it was built
against → per-user tagging. The operator is exactly the adversary in scope.
**Why it matters:** Deanonymizes every prover without breaking any crypto.
**Verify:** ZK-competent review of the tree-update protocol. Require a
globally published, signed, append-only root history the client cross-
checks (mirror into the vault; cross-check across the user's devices; or
anchor roots on Farcaster/chain), and clients that refuse roots not in the
published history. Check how existing Semaphore deployments handle root
freshness.
**Confidence:** HIGH attack is real, MED on best mitigation. **Changes
it:** a reviewed protocol spec. (Sources: trust-auditor §2.5/F8.)

### F9 — What registration actually reveals (HIGH analysis; the honest-claim boundary)
**Claim:** The validator learns `commitment ↔ account` at registration.
The delivered property is `persona → root` unlinkability, NOT account-
existence privacy. Registration must never ride a persona context (that
timestamp-correlates the commitment to that persona).
**Why it matters:** Docs/marketing that claim more than "we can't link
your personas" are falsifiable. And a persona-context registration is a
direct leak.
**Verify:** Committee cross-check of the registration flow: one commitment
per root, registered over the device-auth channel, never from a persona
context, first-write-wins. State the exact claim in user-facing copy.
**Confidence:** HIGH in the analysis. **Changes it:** an anonymous-
enrollment design (blind-issued credentials) — later work, not now.
(Sources: curve-mismatch §2a, incremental F6, fit-architect §5.2/F14.)
**RED-TEAM RECALIBRATION (upgrade severity):** (1) `C_root ↔ account` is a
PERMANENT, unrotatable, 1:1 anchor — if the device-auth key is ever
compromised, the account ever deanonymized, or any single future proof
ever tied to `C_root`, that RETROACTIVELY deanonymizes *every* proof ever
associated with it. There is no rotation story. (2) The recommendation
(§2.3) presented the anonymous registration channel as SOLVED; the
underlying report (fit-architect F14) rated it UNSOLVED. Registering over
device-auth leaks each account's join-order/time into the ZK set (feeding
the join-time correlation attack) and is session-correlatable — "not from a
persona context" is necessary, not sufficient. Restore this to an OPEN
architecture gap; batched-epoch insertion is the minimum, blind-issued
enrollment the real fix. (Sources: redteam-soundness A6/A7, redteam-privacy
A7.)

### F10 — Exact Semaphore v4 nullifier preimage (MED; freezes F2)
**Claim:** v4 restructured identities from v3 (EdDSA-BabyJubJub now); the
scope-collision reasoning in F2 assumes the nullifier is `H(secret, scope)`
with a particular preimage.
**Why it matters:** The scope registry (F2) is frozen against this exact
formula; a wrong assumption bakes a linkage channel into the foundation.
**Verify:** Read the v4 circuit / spec ("How it works" + the audited
circuit source) and confirm the nullifier's exact preimage before freezing
the scope module.
**Confidence:** MED-HIGH. **Changes it:** the circuit source. (Sources:
incremental F7, fit-architect.)

### F11 — In-circuit Ed25519 is still impractical in 2026 (HIGH; the load-bearing assumption)
**Claim:** ~2.56M constraints (circom, archived + *provably unsound* per a
public exploit) / 228K gates (Noir, unaudited, author-discouraged) — so
the dual-key commitment sidestep is mandatory. The whole binding design
rests on this.
**Why it matters:** If a 2025/26 advance (folding schemes, Jolt-class,
a mature Noir gadget) made in-circuit Ed25519 cheap client-side, the
dual-key registration and its `commitment↔account` metadata could be
skipped.
**Verify:** Ask a ZK-competent human; benchmark a current Noir/UltraHonk
ed25519 gadget in-browser on target hardware. Abort the sidestep only on a
demonstrated <2s browser Ed25519-verify.
**Confidence:** HIGH the sidestep is still right (even 10× improvement
leaves it heavy for mobile). **Changes it:** a real <2s browser proof.
(Sources: curve-mismatch §1/F4, primitive-scout, browser-perf.)

### F12 — Under-constrained custom circuits (HIGH, but only bites at step 5)
**Claim:** Circom's compute/constrain split makes "forgot the constraint"
the dominant real-world ZK bug (circom-pairing's million-dollar
BigLessThan; circomlib's 9 criticals). Any custom predicate circuit
(step 5, or a Semaphore edit) inherits this risk; timestamp
(`revokedAt > now`) and tier comparisons are exactly the range-check-
dependent spots.
**Why it matters:** A too-few-constraints circuit satisfies honest
witnesses AND your scripted tamper cases — the forgery is a witness you
didn't script. Green sweeps are zero evidence.
**Verify:** For any custom circuit: Circomspect in CI, Picus on every
circuit (treat "unknown" as un-shipped), explicit range constraints on
every comparison, AND an external human circuit audit. A standing "forge
harness" (mutate every signal, assert rejection) is necessary and still
insufficient.
**Confidence:** HIGH the risk exists. **Changes it:** nothing — it's the
custom-circuit tax, which is why step 5 is deferred. (Sources: trust-
auditor §3.1-3.6/§4/F, fit-architect F1/F7.)

### F13 — Proof malleability / context binding (HIGH)
**Claim:** Groth16 proofs are re-randomizable; a gate keyed on proof bytes
or lacking message binding is replayable (a "rep ≥ T" proof captured at
one gate replayed to another). CVE-2023-33252 (public-input aliasing) and
Frozen Heart (weak Fiat-Shamir forgery in snarkjs itself, 2022) are the
library-level history.
**Why it matters:** Cross-context proof replay defeats read-only gates.
**Verify:** Confirm every proof type binds action/message/session hash
INSIDE its public inputs (Semaphore's signal mechanism does this); never
dedup or authorize by proof-hash; pin snarkjs ≥0.7.6; test replay-into-
wrong-gate vectors.
**Confidence:** HIGH. **Changes it:** an audit of the binding scheme.
(Sources: trust-auditor §3.3/§3.4/F9.)

---

## TIER 3 — Real, but lower blast radius or contingent on a later choice

### F9b — Steps 1–4 do NOT remove the operator's plaintext attribution index (HIGH; added by red team — charter-vs-delivery gap)
**Claim:** `castHash → personaId` (REPORT-FC Gate 4) stays in the
operator's plaintext store through the entire migration, guarded only by
its own `canViewPrivate` access-control check — not crypto. The only
linkage steps 1–4 destroy is persona→root at decision-READ points. The
charter's "kill the plaintext attribution linkage the validator holds" is
NOT delivered by steps 1–4; it needs the deferred anonymous-attribution
work (step 4½), which fc-prior-art/incremental say traffic analysis partly
defeats even when built.
**Why it matters:** A founder reading "the validator can never connect two
personas" concludes the operator can no longer see who posted what — false.
The honest boundary is narrower than the copy implies.
**Verify:** State plainly, in user-facing copy, that castHash→personaId
remains operator-visible (access-controlled, not encrypted) until anonymous
attribution ships, and that anonymous attribution is defeated by timing
metadata unless the C6/F5b decorrelation work exists. Decide whether
closing this is actually a priority (the committee argues persona→root is
the crown jewel and this is "only" persona-level — a real position, but
name it). **Confidence:** HIGH. (Sources: redteam-pragmatics A4/MF2.)

### F7b — Fork reputation-porting (step 2) is a DELIBERATE persona→persona link — an opt-in WAIVER (HIGH; added by red team)
**Claim:** Porting publishes "new persona P′ shares a root with the thing
that had reputation R" — a persona→persona link by design, shipped as the
SECOND feature. It contradicts any blanket "we never connect your personas"
claim.
**Why it matters:** Continuity/porting are useful and correct, but they are
consent-scoped disclosures; describing them under the blanket unlinkability
copy is an overclaim against the roadmap's own §5 table.
**Verify:** Frame continuity/porting features as explicit, per-instance
opt-in *waivers* of the unlinkability guarantee for the personas involved,
with their own user-facing disclosure. Never let the blanket claim cover
them. **Confidence:** HIGH. (Source: redteam-privacy A6.)

### F14 — Traffic analysis remains unaddressed after the whole migration (HIGH; out of scope, must be stated)
**Claim:** Timing/size metadata (shared-FID publish ordering, roster-
update-then-first-proof, vault flush cadence) can link personas regardless
of proofs — the strongest practical deanonymization vector after ZK ships.
**Verify:** Red-team the fixture world — attempt sibling linkage from
validator logs alone. Add batching/padding/delay mitigations (§6.7) and
record in the threat model that traffic analysis is explicitly out of
scope until addressed. **Confidence:** HIGH. (Sources: incremental F9,
trust-auditor §2.5.)

### F15 — snarkjs GPL-3 license in a shipped browser bundle (MED; legal, not technical)
**Claim:** snarkjs and circom are GPL-3.0; distributing them in a
commercial browser bundle has copyleft implications. Semaphore core is
MIT; barretenberg believed Apache-2.0 (unverified).
**Verify:** Read each LICENSE at the pinned version; get counsel if
commercial distribution is planned. **Confidence:** mixed. (Sources:
trust-auditor F14, browser-perf.)

### F16 — TEE attestation is broken (HIGH facts; supports the SKIP recommendation)
**Claim:** WireTap (~$1k, forges SGX attestation keys), Battering RAM
(~$50), TEE.fail (TDX/SEV) — 2025 physical-interposer breaks; Intel scopes
physical access OUT. Basis for skipping a TEE linkage-index interim.
**Verify:** Read the WireTap / Battering RAM / TEE.fail papers (committee
read press + project sites, not the papers); check for 2026 mitigations.
Note: even a mitigation wouldn't change the SKIP recommendation, only
soften its first argument. **Confidence:** HIGH attacks real, MED on exact
boundaries. (Sources: incremental §5/F8.)

### F17 — WASM prover side channels (LOW-MED; measure before worrying)
**Claim:** Browser provers aren't constant-time; proving time/memory may
correlate with witness values (rep magnitude, tree position), letting a
timing-observant validator bucket provers.
**Verify:** Benchmark proving-time variance across witness values for the
chosen circuit; ask the library maintainers about constant-time claims.
**Confidence:** LOW-MED (plausible, unmeasured). (Sources: trust-auditor
F16.)

### F18 — Poseidon parameter/implementation provenance (MED)
**Claim:** Moving commitments to Poseidon imports a newer, less-
cryptanalyzed hash + parameter-generation trust; the commitment layer is
load-bearing for hiding AND binding.
**Verify:** Use only widely-deployed parameter sets (Semaphore/circomlib's,
which were in the Veridise audit); check for post-2024 Poseidon
cryptanalysis; have a cryptographer confirm. **Confidence:** MED. (Sources:
trust-auditor F17.)

### F19 — Formal tools are reducers, not verifiers (HIGH; process guard)
**Claim:** Circomspect is a linter; Picus proves uniqueness only and times
out on hash-heavy circuits ("unknown" ≠ safe); Ecne's maintenance is
unverified. A green tool run is NOT "soundness verified."
**Verify:** Run Picus per custom circuit and read its per-template verdict;
check Ecne's repo activity before relying on it; budget the human audit
regardless. **Confidence:** HIGH on the limitation. (Sources: trust-auditor
§4/F12.)

### F20 — Library liveness spot-checks (LOW-MED; cheap to close)
**Claim:** A GitHub releases fetch for Semaphore returned internally
inconsistent dates this pass (v4.14.3 listed before v4.14.2); snarkjs
cadence is ~1 release/year; UniRep activity unverified past Feb 2025.
**Verify:** Five minutes each on the actual commit graphs (Semaphore,
snarkjs, zk-kit); confirm UniRep is design-inspiration only, never a
dependency. **Confidence:** LOW (fetch was unreliable). (Sources:
fit-architect F16, primitive-scout F, incremental F10.)

---

## The bottom line for the founder

The cryptography is the *easy* part here — the recommended stock-Semaphore
path is audited, ceremonied, browser-fast, and needs zero novel circuits
for the first four features. **A 3-lens red team confirmed the architecture
and then established the sharper, more uncomfortable truth: for the named
adversary (an operator who runs the transport and hosts the trees), the
METADATA — not the cryptography — is where privacy is won or lost.** The
Tier-1 items, none of which a green test suite can ever check, are:

- the submission channel, **and that it is currently unscheduled while
  step 1 arms a live gate** (F1 / F1c);
- the nullifier-scope table — **including that RLN, the prescribed
  rate-limiter, is itself a per-epoch same-root linkage oracle** (F2 /
  F1b);
- **personaId riding the proof signal in the clear as a free intersection
  join key** (F2b);
- the launch anonymity set — **sized as named, profiled candidates, not
  anonymous strangers** (F3);
- **proof-vs-activity timing, which is Tier-1 and conflicts with the
  interactive-latency UX claim** (F5b);
- setup integrity (F4); client-side verification with pinned keys (F5);
- **and set-contents integrity: the operator is trusted for WHAT IS TRUE
  about a root (your tier, your revocation), separate from hiding WHICH
  root — the ZK layer does not remove that authority** (F5c).

Two things follow. **First: do not describe step 1 as "unlinkable" until
the submission channel, the timing decorrelation, the RLN/nullifier
design, and the anonymity floor have all had the same external review the
crypto gets — and the cohort clears the floor.** A green `live-z1` proves
the gate works, never that it is private. **Second: seriously price the
cheaper start** — blind-signed anonymous tokens (Privacy Pass) deliver
step 1's exact win with no ceremony, no artifacts, and trivial mobile
verification; Semaphore's full tax is worth paying only to amortize the
tree/nullifier infrastructure that steps 2–3 force. Everything else on
this list is a spot-check or a step-5 concern.

## Multi-FID pass — additions (network identities; each is one lookup the founder can make)

### F21 — The registrant rule was never read from the chain (HIGH; one lookup decides it)
`registrant` / `funder` on every live fid record are the string `"neynar-sponsor"`, written by the
acquisition script (A-FID-REGISTRANT-BY-FIAT). What the chain records is unread: the sender of the
`IdGateway.register` / `registerFor` call that emitted `IdRegistry.Register(to, id, recovery)`, the
`StorageRegistry.Rent` payer, the `Transfer` `from`, and `IdRegistry.recoveryOf(fid)`. **Verify:** on
any Optimism explorer, take the throwaway fid 3348985 (and each persona fid once created) and read
those four addresses. If any is the App Wallet or an address that appears only for this developer's
registrations, every Layers account shares a developer-unique address on a public chain and the
rule is violated already; if all are Neynar-wide, the cluster is "everything Neynar sponsored" and
that is what the posture should say. Until read, the registrant-linkage assertion checks records the
pass wrote itself.

### F22 — Which fid requested the managed signer (HIGH; one decode decides it)
A managed signer lands on chain as `KeyRegistry.Add(fid, key, metadata)` whose
`SignedKeyRequestMetadata` carries `requestFid`. If that is the developer's app fid, every Layers
account is clustered on chain under it, independent of everything else. **Verify:** `keysOf(3348985)`,
decode the metadata, read `requestFid`; then the same for each persona fid.

### F23 — The sponsored registration's signer (MED; one response decides it)
The FC pass observed that `POST /v2/farcaster/user` "returned an approved signer anyway" when no
signer block was sent. The rewritten acquisition command records the signer THAT response reports; if
a future response reports none, the account exists without a usable signer (the command says so).
**Verify** on the first live run: the response body's `signer` / `signers[0]`, and
`GET /v2/farcaster/signer?signer_uuid=` → `status: approved`, `fid` = the new fid.

### F24 — Neynar's view is total under managed custody (HIGH; a fact, not a lookup)
One `NEYNAR_API_KEY` reserves and registers every persona fid, holds every managed signer, is on every
persona write, and — unless the anon relay account is a distinct credential — relays the anon cast
(A-FID-NEYNAR-SEES-ALL). The label's tenth condition shows whether the relay credential is distinct.
Nothing in this pass hides anything from Neynar; the anon guarantee is stated against hubs, other
clients, this client and the validator. The structural fix is Call Option A (self-custody signers,
direct hub submission) plus Call Option B (a dedicated anon account under a different credential).
