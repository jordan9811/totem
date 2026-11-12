# RED TEAM — SOUNDNESS & CRYPTO CORRECTNESS

Adversarial review of `research/RECOMMENDATION.md` + `VERIFY-YOURSELF.md`,
2026-08-30. Lens: is the crypto actually sound, and is the "stock Semaphore =
zero custom circuits" promise true need-by-need? Checked against the committee
sources (primitive-scout, fit-architect, trust-auditor, curve-mismatch).

Fact tags: **LIVE-CHECKED** (web-verified this pass) vs **FROM-SOURCE** (carried
from a committee report's own web-check) vs **ANALYSIS** (my reasoning).

---

## Bottom line

The architecture SURVIVES. The commitment sidestep, no-Ed25519-in-circuit,
stock-Semaphore-for-membership, and defer-custom-circuits calls are sound and
faithfully carried. Two specific "is it really stock?" claims I pressure-tested
hold up:

- **Nested tier-groups ARE stock** (ANALYSIS + LIVE-CHECKED): "tier-3 root in
  trees 1,2,3" is just insertion into N independent LeanIMT groups; each proof
  is membership in ONE group. No multi-group circuit, no edit. The
  recommendation gets this right.
- **Revocation-by-omission IS stock** (LIVE-CHECKED): Semaphore v4
  `Group.removeMember` exists; it zeroes the leaf and needs the operator to pass
  the Merkle siblings. Root changes → old-root proofs go stale after the
  root-history window. No non-membership circuit required. Correct.

But it survives carrying ONE dangerous, self-contradicting overstatement at its
center, plus several dropped caveats. The recommendation repeatedly implies the
operator "cannot forge membership" and that a single stock proof *enforces*
rep≥T / non-revocation / attestation-holding. For N1/N3/N4 it does not: the
proof enforces set-INCLUSION; the predicate is only as true as the validator
that populated the set. The ZK layer removes persona↔root LINKAGE — it does
**not** remove the operator's authority over what is TRUE about a root, and that
trusted-validator property is unflagged in all five Tier-1 items.

---

## ATTACKS

### A1 — "N1 rep≥T: No custom circuit" silently forfeits the source's placement circuit and moves rep-integrity into blind validator trust
- **Synthesis says** (§2.5 table): N1 needs **No** custom circuit — "membership
  in `zkTier[T]`."
- **Why it's risky:** fit-architect (the source) marks N1 **CUSTOM (small)**
  and built a tier-*placement* circuit (§5.2, FLAG F3, ~100–500k constraints)
  precisely so a root proves its OWN rep≥T and the validator *cannot forge
  placement*. curve-mismatch agreed with the no-circuit path but stated the
  price out loud: "Trust in the rep VALUE sits with whoever maintains the tree
  root … ZK hides which leaf, not who scores." The synthesis kept the
  no-circuit CONCLUSION and dropped the CAVEAT. Under the shipped design the
  validator populates `zkTier[T]` from its plaintext `C_root↔account↔rep`
  knowledge; a corrupt validator can place any commitment into tier-5, or keep
  an over-rank root there, **undetectably** — leaves are opaque commitments, so
  no third party can audit that tier-5's members actually clear tier 5.
- **Correction:** state that N1-as-membership makes tier placement a validator
  plaintext operation, that the validator is therefore trusted for set-CONTENTS
  integrity (not just availability), and that the placement circuit is the only
  design that makes rep≥T cryptographic — which is exactly the custom-circuit
  work deferred to "step 5, maybe never."

### A2 — §2.2 "the validator … cannot forge membership (Merkle)" is false as a predicate-security claim
- **Synthesis says** (§2.2): the validator "cannot forge membership (Merkle) or
  learn root↔persona links."
- **Why it's wrong (ANALYSIS):** it conflates two different properties. Merkle
  soundness stops the validator faking a membership *path* (true). It does
  nothing about what LEAVES the validator inserts — and the validator controls
  every insertion into `zkValidRoots`, `zkTier[T]`, `zkAttest[issuer]`. It never
  needs to forge a proof; it just puts whatever commitment it wants into a
  privileged set. "Cannot forge membership" reads as "cannot grant an unearned
  privilege," which is exactly what it CAN do.
- **Correction:** honest claim is "the validator cannot fake a Merkle proof, but
  it is trusted to populate the sets honestly; a membership proof attests
  set-inclusion, not the predicate the set is named for."

### A3 — "N4 holds-attestation: No custom circuit" lists a custom in-circuit EdDSA verify as if it were stock
- **Synthesis says** (§2.5 N4): **No** custom circuit — "membership in
  `zkAttest[issuer]`, **or** a circomlib BabyJubJub-EdDSA co-signature over
  `C_root` — both cheap in-circuit."
- **Why it's wrong (FROM-SOURCE):** the second mechanism is EdDSA verification
  *inside the circuit*. fit-architect marks the attestation circuit
  **CUSTOM (small)** (FLAG F4: "EdDSA + Merkle + equality"). Any in-circuit
  EdDSA verify is a custom Groth16 circuit that forfeits the Semaphore audit AND
  ceremony (VERIFY-YOURSELF F4's own rule). Only the per-issuer-group variant is
  genuinely stock. Listing both under a single "No" is an overstatement of the
  audit posture.
- **Correction:** N4 has a stock path (per-issuer membership groups) — use only
  that if "zero custom circuits" is the constraint; the EdDSA-co-signature
  variant carries the full custom-circuit ceremony+audit tax.

### A4 — "zero custom circuits until step 5" is true only because predicate logic is relocated into trusted validator plaintext — it is not eliminated
- **Synthesis frames** (TL;DR, §2.4): "one stock Semaphore proof serves
  rep-threshold + non-revocation + continuity at once."
- **Why it misleads (ANALYSIS):** for N1/N3/N4 the proof proves "member of a set
  the validator curated." The rep-threshold, revocation, and attestation
  SEMANTICS are enforced by the validator populating trees from plaintext it is
  permitted to see — not by the proof. A reader of the §2.5 table will believe
  the proof cryptographically enforces rep≥T; it enforces membership. The two
  headline selling points — "no custom circuits" and "operator removed from the
  trust base" — are in direct tension and cannot both be fully true. You buy
  "zero custom circuits" with "validator trusted for all set-contents
  integrity."
- **Correction:** name the trade explicitly wherever the "one stock proof does
  it all" claim appears.

### A5 — Revocation-by-omission is stock, but the recommendation is muddled about the mechanism and understates that removal is a validator plaintext act
- **Synthesis says** two different things: §2.5 N3 "revoke = remove leaf" (in
  place, instant); step-3 row "epoch re-issuance excludes revoked roots"
  (periodic rebuild, epoch-latency). These are different revocation-latency
  contracts presented interchangeably.
- **Fact (LIVE-CHECKED):** `removeMember` zeroes the leaf (tree keeps growing;
  removed slot → 0) and requires the operator to supply Merkle siblings. So
  in-place removal works, but only the party holding the full tree (the
  validator) can perform it — and it can equally *decline* to remove a
  compromised/revoked root (an unauditable INTEGRITY failure to third parties,
  not merely censorship/availability).
- **Correction:** pick ONE revocation contract; state that removal is
  validator-performed and that "keep a revoked root live" is an integrity
  violation, distinct from the availability attacks already in the threat model.

### A6 — The dual-key binding assumes the operator FORGETS its pre-ZK persona↔root table; the migration never says so
- **Synthesis says** persona→root is hidden because `C_root` never enters a
  proof's public inputs.
- **Why it's incomplete (ANALYSIS):** every source states the ZK layer's job is
  to make the operator "mathematically unable to link a persona to its root"
  (fit-architect §1). But in the *current* system that linkage is
  known/derivable to the operator (REPORT-FC's plaintext castHash→personaId
  index; rep is root-bound). The recommendation adds unlinkability for FUTURE
  proofs and is silent on deleting the operator's EXISTING linkage table. If the
  validator keeps it, persona→root is still known for every pre-migration
  persona and the ZK layer is theater for them.
- **Correction:** the migration must specify that the operator destroys / never
  receives the persona↔root mapping going forward, and that pre-ZK personas stay
  permanently linked. This is a missing flag (MF2).

### A7 — `C_root↔account` is a permanent, unrotatable correlation anchor with retroactive-deanonymization risk
- **Synthesis says** (§2.3, F9): registration reveals `commitment↔account`;
  delivered property is persona→root unlinkability, not account-existence
  privacy.
- **Why it's under-flagged (ANALYSIS):** one-commitment-per-root + first-write-
  wins makes `C_root↔account` a PERMANENT 1:1 map the validator holds forever,
  with no rotation story. If the device-auth key is ever compromised, the
  account is ever deanonymized, OR any single future side-channel ties one proof
  to `C_root`, then `C_root↔account` retroactively deanonymizes every proof ever
  associated with that `C_root`. F9 frames this as a static honest-claim
  boundary; it does not flag the permanence/retroactivity.

### A8 — Malicious set-composition is a deanonymization lever distinct from split-view (F8) and unflagged
- **Why (ANALYSIS):** because the validator chooses which commitments populate
  each tree, it can construct a singleton or tiny tier/attestation group and
  induce a target to prove against it, reaching k=1 with no crypto failing and
  WITHOUT serving inconsistent roots. F8 covers serving different ROOTS of one
  tree; F3 covers HONEST public-input partitioning. Neither covers a validator
  that maliciously curates set MEMBERSHIP to tag provers. The minimum-set floor
  (F3) only partially mitigates and must be enforced against validator-chosen
  composition, not just cohort size.

---

## MISSING FLAGS (not in VERIFY-YOURSELF, or miscalibrated)

- **MF1 (should be TIER 1) — Set-contents integrity is a trusted-validator,
  unauditable property, and §2.2 misrepresents it.** No flag says the validator
  is trusted to honestly populate `zkTier`/`zkAttest`/`zkValidRoots`, that
  membership proves inclusion NOT the predicate, and that this is invisible
  because leaves are opaque commitments. F5/F18 cover verifier-side / vkey
  integrity (that a proof is checked against the RIGHT circuit) — a DIFFERENT
  property from whether the TREE was honestly built. This is the single largest
  gap.
- **MF2 (HIGH) — The operator's pre-existing persona↔root linkage must be
  destroyed; migration is silent** (A6). Without it the layer is theater for all
  pre-migration personas.
- **MF3 (recalibrate F9 up) — Permanent, unrotatable `C_root↔account` anchor
  with retroactive deanonymization** (A7). F9 undersells permanence.
- **MF4 (new) — Malicious set-composition / singleton-group tagging** (A8).
  Distinct from F8; currently uncovered.
- **MF5 (calibration) — The §2.5 "No custom circuit" cells for N1 and N4, and
  the "zero custom circuits until step 5" headline, are presented as settled but
  are contingent.** F4 (any circuit edit forfeits audit+ceremony) exists but is
  never connected to the N1/N4 "No" claims. A reader trusting the table won't
  see that choosing the integrity-preserving design flips several "No"s to
  "Yes."
- **MF6 (recalibrate F10) — I LIVE-CHECKED the v4 nullifier: `Poseidon(scope,
  secret)` with a SINGLE identity secret** (v4 collapsed v3's trapdoor+nullifier
  into one). Because the base design uses ONE zk secret per ROOT (shared by all
  its personas), scope is the SOLE barrier between siblings — there is no
  per-persona secret underneath. This CONFIRMS F2 and makes it sharper: F10
  should move from "MED, verify preimage" to "confirmed — and it means a single
  coarse scope string fully links a root's personas, because nothing else
  separates them." F2 stays correctly HIGH.

---

## STEELMAN OF AN ALTERNATIVE (the strongest case the recommendation is WRONG here)

The layer's stated purpose is to remove the operator from the trust base. But as
A1–A4 show, for 4 of 5 needs it does NOT remove the operator from the INTEGRITY
trust base — the operator still decides who is tier-3, who is revoked, who holds
attestation X, and curates the sets accordingly, unauditably. The ONLY thing the
stock-Semaphore path removes is the operator's ability to LINK persona→root.

If the operator is trusted for set-contents integrity anyway, then N1/N3/N4
could deliver the SAME guarantee (persona→root unlinkability, operator-trusted
predicates) with a far lighter primitive than Semaphore + per-artifact ceremony
verification + an anonymous submission channel + a 5.7MB artifact + mobile-
proving risk + GPL/legal exposure — e.g. operator-issued anonymous credentials /
per-epoch blind-signed tokens (VOPRF / Privacy-Pass shape). Those give "some root
in good standing authorizes me" with a smaller soundness surface and no Groth16
trusted setup.

Semaphore's one irreplaceable feature over Privacy-Pass is the deterministic
cross-context nullifier (same-human continuity, N2). But N2 is ALSO the single
most dangerous feature in the whole design (F2 — the linkage killer) and is
arguably what the product should ship LAST, not build the foundation on. So the
steelman bites twice: (1) step 1 (the rep-gate) is sold as "exercises every
piece of infrastructure," but the rep-gate needs NONE of Semaphore's nullifier
machinery and could ship without ZK at all under the same trust model — it is
infrastructure-building dressed as a feature; (2) the recommendation front-loads
the heavy audited-ceremony stack whose only distinctive capability is also its
most hazardous.

**Why the recommendation still stands anyway:** nullifiers ARE the eventual
product need (continuity, sybil-resistance, cross-persona same-human), Semaphore
is the audited/ceremonied way to get them, and a lighter Privacy-Pass scheme
would have to be ripped out and replaced when N2 arrives. Building the substrate
once is defensible. But the honest framing is "we are building the eventual
nullifier substrate early," NOT "step 1 proves a rep claim the operator can't
cheat." The latter is false (A1/A2).

---

## VERDICT

**Survives.** The crypto-architecture choices are sound and faithfully carried
from the sources; the two stock-vs-custom claims I stress-tested hardest
(nested tier-groups, revocation-by-omission) are genuinely stock, LIVE-CHECKED.
The F4 setup-integrity story ("stock inherits the ceremony; ANY edit forfeits
it") is correct, and the recommended N1–N3 path does stay inside stock circuits
— but ONLY by paying for it in validator-trusted set integrity.

**Single most dangerous unaddressed thing:** set-contents integrity is an
unflagged trusted-validator property. The layer removes persona↔root linkage but
NOT the operator's authority over what is true about a root, and §2.2's "cannot
forge membership" actively misrepresents this. None of the five Tier-1 flags
covers it, and the one design that would make the predicates cryptographic —
per-root placement/predicate circuits — is exactly the custom-circuit work the
recommendation defers to "step 5, maybe never." Add MF1 as a Tier-1 flag and
rewrite §2.2's "cannot forge membership" before anyone reads the table as
"operator can't cheat."

---

## SOURCES

LIVE-CHECKED 2026-08-30:
- Semaphore v4 nullifier = hash(scope, identity secret); v4 replaced v3's two
  secrets (trapdoor+nullifier) with a single secret; Poseidon in-circuit —
  docs.semaphore.pse.dev / nkapolcs.dev Semaphore v4 writeup / Semaphore
  research repo.
- Semaphore v4 `Group.removeMember` (zeroes leaf, needs Merkle siblings) /
  `updateMember` — docs.semaphore.pse.dev/guides/groups;
  js.semaphore.pse.dev Group class.

FROM-SOURCE (committee web-checks, re-read this pass): fit-architect F3/F4
(N1 placement circuit, N4 attestation circuit both CUSTOM); curve-mismatch §2a
+ row-2 (rep trust "sits with whoever maintains the tree root"); trust-auditor
§2.3/§2.5/F4/F5/F18; barretenberg critical vuln 2026-07-27 (aztec.network);
Electron-Labs ed25519-circom 2.56M constraints + archived + unsound;
noir-ed25519 228k gates unaudited.

Repo files read first-hand: research/RECOMMENDATION.md, research/
VERIFY-YOURSELF.md, research/primitive-scout.md, research/fit-architect.md,
research/trust-auditor.md, research/curve-mismatch.md.
