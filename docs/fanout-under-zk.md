<!-- uncited-ok: page — pre-existing audit ledger / design memo; claims are the report's, not the site's -->
# Restoring block fan-out under zk — design memo (call option B)

*ZK Pass 2, written after Gate 2 (migration 006). No code. A morning-decision
input, not a feature.*

**What was lost.** Before 006 the validator held `personas.root_id`, so
"block @a" blocked every persona of @a's account, current and future, on
both ends, resolved server-side. After 006 blocks are persona ↔ persona
(one row per action; the device shares the block across its OWN personas
at read time). The blocked account's other personas are not reached. That
is not a bug: any server that can fan a block out over an account's
personas can answer "are these two personas the same person" — the
linkage the whole zk layer denies the operator.

**The shape of any fix.** Fan-out needs someone to evaluate "is persona P
a sibling of the persona I blocked" at feed-filter time. The evaluator can
be (1) the validator (rejected: it is the linkage oracle), (2) the VIEWER's
device, or (3) the BLOCKED account's device (cooperative). Options:

| option | mechanism | what it costs | verdict |
|---|---|---|---|
| **B1. Viewer-side blocklist tree** | the viewer keeps a private Semaphore-style set of blocked ROOT commitments? — impossible: the viewer never learns the blocked persona's root commitment (that is the point). Variant: the viewer keeps blocked PERSONA ids only (today). | nothing new; no fan-out | this IS the current state |
| **B2. Per-viewer non-membership proofs** | each persona proves, to the viewer, "my root is NOT in this viewer's blocked-root set" (a non-membership / exclusion proof over a viewer-published set of blocked commitments). Needs: the viewer to learn a blocked persona's ROOT COMMITMENT at block time (a persona would have to reveal its root's commitment to anyone who blocks it — a linkage handle for everyone), a new circuit (non-membership), and a proof per (persona, viewer) pair. | new circuit (forbidden this pass); per-pair proofs scale as personas × viewers; the disclosed commitment is a permanent pairing key | **no** — it recreates the persona → root handle it removes, at every viewer |
| **B3. Cooperative fan-out** | when @a is blocked by V, @a's OWN device (which knows its siblings) records "hidden from V" for all its personas and honours it when its personas post/reply toward V (self-censorship by the blocked party; the viewer's feed cannot verify it). | works only for a cooperative account — the case where blocking matters least; unverifiable | **partial at best**; honest framing: "the blocked account is asked to stay away", not "blocked" |
| **B4. Cohort-level blocks** | block the anonymity COHORT (tier tree / attest tree) the persona proved membership in — hides every persona that proves from that tree. | collateral: hides ~floor innocent accounts; trivially evaded by proving from another tree | **no** for blocking; maybe for muting a whole cohort by choice |
| **B5. Attestation-level blocks** | block by an issuer attestation ("everything attested by issuer I") — an issuer-defined group, not an account. | needs real issuers (the morning's decision); still not per-account | a different feature (group mute), not fan-out |
| **B6. Root-level blocks re-introduced at the validator, under a proof** | the blocked persona proves "my root = R" to the validator once… | that is exactly 006 undone | **no** |

**Verdict.** Under the pass's invariant (the validator never holds a
persona → root link, and no server-visible handle pairs two personas of a
root) full block fan-out is not recoverable without handing every viewer a
persona → root pairing key (B2) or trusting the blocked party (B3). The
honest product statement stays: *"Block this persona. Sibling personas of
that account are not auto-blocked."* If the product must promise more, the
cheapest honest addition is B3 framed as "asked to stay away" plus a
report-and-review path for evasion — a moderation feature, not a privacy
mechanism. Decide that in daylight; nothing here should be built tonight.
