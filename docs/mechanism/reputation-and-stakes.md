# Reputation, influence and stakes

Reputation lives on the root. Each epoch the root gets a non-transferable allowance of influence, its personas spend it as public, signed stakes on casts, and stakes that a delayed check confirms raise the root's reputation.

::: warning Status: built, test data only, no money
Every mechanic runs on the seeded world and the sweeps. The allowance is not a token: it has no transfer operation and cannot be cashed out. Real Farcaster authors get no tier, and the public preview refuses stakes on real Farcaster casts. The curve values are marked TUNE in the code because the owner has not settled them. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}
:::

The verdict: this is a reputation-weighted attention budget, not a currency, and the design leans on legibility rather than enforcement. Stakes are public rows signed by persona keys, so anyone can recompute any persona's accrual under any lens. The allowance is enforced by the device, which holds it sealed in the vault; the validator never sees a balance and so cannot catch an overspend. The privacy cost is real and named: accrual lands on the root as a count while the stakes that earned it are per persona, which gives an operator a correlation to work with. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}

## At a glance

<ol class="flow">
  <li><strong>Recharge</strong>Each epoch the root's allowance resets to 10 + 4 × its proven tier.</li>
  <li><strong>Stake</strong>A like, recast, note, refute or curate spends points, signed by the persona.</li>
  <li><strong>Wait</strong>One epoch later each stake is checked against notes, retraction and standing.</li>
  <li class="flow__us"><strong>Accrue</strong>Confirmed points become stewardship events on the root, at most 10 an epoch.</li>
  <li><strong>Prove</strong>The higher tier is proved next epoch, the same way as any tier.</li>
</ol>
<p class="flow__note">Nothing in the loop is new cryptography: the accrual is a reputation event, and the tier comes back through the existing membership proofs.</p>

## The reputation score and the tier

A root's score is the weighted sum of its reputation events: a cast created 1, a reply received 2, a like received 2, a recast received 3, a follow gained 5, a stewardship event 4. Its tier is its decile, 1 to 10, among roots with a positive score; a root with no score is tier 1. Under the ZK binding a persona's tier is what it proved this epoch, and 0 until it proves. See [ZK membership and tiers](/mechanism/zk-membership#tiers). {cite: notes/reports/REPORT-Z2.md > "Gate 1 — every reputation read proof-mediated under zk"}

## The allowance

| Rule | Value |
|---|---|
| Per-epoch allowance | 0 at tier 0; otherwise `10 + 4 × min(10, tier)`: 14 at tier 1, 30 at tier 5, 50 at tier 10 |
| Scope | per root, shared by its personas |
| Recharge | exactly to the allowance, once per epoch on the validator's clock; a balance stamped ahead of that clock is reset, never honoured {cite: SECURITY-POSTURE.md > "What the validator learns from stakes — and does not"} |
| Overdraw | refused (409) with the balance untouched; reserved before the send, refunded on a refusal |
| Transfer | none; the adapter contract has no such method and a type-level assertion makes adding one a compile error |
| Storage | one sealed record in the vault, padded to 1 KiB steps |

Source: {cite: SECURITY-POSTURE.md > "What the validator learns from stakes — and does not"}

## Stakes

| Action | Default stake | Default direction |
|---|---|---|
| like | 1 | good |
| recast | 2 | good |
| note | 2 | note-worthy |
| refute | 3 | wrong |
| curate | 2 | worth-reading |

Any stake is at most 50 points and may name an epoch up to 3 behind the current one, never ahead. Each is a row on the validator: persona, cast, action, direction, amount, epoch, nonce, signed by the persona's key, hour-grained, in a table without row ids. The validator verifies the signature under the key it is handed and stores the key; every reader re-verifies against the key it resolves for the persona and treats an unverifiable row as absent. {cite: SECURITY-POSTURE.md > "What the validator learns from stakes — and does not"}

## Accrual

A stake placed in epoch E is evaluated in epoch E + 1:

| Direction | Confirmed when |
|---|---|
| good, worth-reading | the cast still exists, no qualifying community note stands against it, and it holds standing under the refutation rules |
| wrong, misleading | a qualifying note stands, or the cast lost standing, or the cast was retracted |
| note-worthy | a qualifying note landed |

Each stake's weight is `amount × base × (1 + early) × coordination`, where `base` is 1 if confirmed and 0 if not, `early = 0.5 × 0.5^(rank / 3)` with rank 0 for the first staker on that cast (so the first staker gets at most +50%, halving every three ranks), and `coordination` is 1 unless a lens chooses to discount stakes inside a detected cluster. The epoch's events are `min(10, floor(total weight / 5))`, posted once by the root's own device as one `stewardship` reputation event on the root, one epoch late, hour-grained. The cap of 10 is computed and enforced on the device; the validator does not check it. Dwell is deliberately not a signal: the event log refuses dwell and impression events by construction. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}

**A worked example.** A tier-3 root has 22 points this epoch. One persona refutes five casts at 3 points each, as the second staker every time (rank 1, so early is 0.5 × 0.5^(1/3), about 0.397). All five later get a qualifying note, so each weighs 3 × 1 × 1.397, about 4.19, for a total of about 20.95. That is floor(20.95 / 5) = 4 stewardship events, worth 4 × 4 = 16 on the root's score, for 15 points spent. Whether that moves the root up a decile depends on everyone else's scores.

A lens can carry its own curves within fixed ranges: early weight 0 to 5, half-life rank 1 to 100, confirmed and unconfirmed weights 0 to 10, points per event 1 to 1,000, a per-epoch cap of 0 to 1,000, and a coordination penalty of 0 to 1. A malformed set is refused. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}

## What the validator sees

| Datum | Where it lives | What the validator sees |
|---|---|---|
| the allowance | the vault, one padded sealed record | ciphertext of a fixed 1 KiB step; never the balance or the tier {cite: SECURITY-POSTURE.md > "What the validator learns from stakes — and does not"} |
| a stake | the `stakes` table, per persona | all of it: this is the public half of the mechanic |
| a settled accrual | one `stewardship` event per evaluated epoch, posted with the root's own handle | a root-level reputation fact, like every reputation event |

Source: {cite: SECURITY-POSTURE.md > "What the validator learns from stakes — and does not"}

## Adversary model

- **A hostile client can award itself reputation.** Reputation events reach `POST /events` from the root's own device, and the validator checks only that the signed envelope's anchor is the root's. It accepts any of six types (`cast_created`, `like_received`, `recast_received`, `reply_received`, `follow_gained`, `stewardship`) with a count from 1 to 100 and a client-chosen `sourceId`, so a modified device can post `follow_gained` × 100 (+500) as often as it likes and reach tier 10. Tiers, and with them For You, the allowance, the anon tree and ad tier targeting, are self-asserted today. The fix is in code and not made: accept only `stewardship` from devices, cap its count at 10, and bind `sourceId` to the epoch. <!-- uncited-ok: read from validator/server.js POST /events and lib/influence/accrual.ts on 2026-10-07; not yet an assumption id in the posture -->
- **A hostile client** can also post stakes beyond its allowance, because the validator holds no balance. Each event is capped at 50, readers see the per-persona pattern, and a lens may weight against it. Enforcement is the device's. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}
- **A curious operator** can watch a root's stewardship count rise in the epoch after one persona's confirmed stakes rose, and link the two. The count is coarse (5 weighted points per event, at most 10), late by one epoch and hour-grained, and it aggregates all the root's personas; which epoch it was is not hidden. Rows in `rep_events` also keep insertion order. {cite: SECURITY-POSTURE.md > "After the three reviews (Gate 7, part 2): what changed, what is now assumed"}
- **Co-timing.** Two personas of one root that stake in the same hour are co-timed. The linkage test measures the candidate set (every persona with a stake in that hour) and fails below 3; on the fixture world it was 10. A quiet hour makes it smaller. {cite: SECURITY-POSTURE.md > "What linkage v5 measured (Gate 7)"}
- **Sybils.** There is no proof of personhood. New identities are bounded per address per day on the validator, and an unproven persona has tier 0 and an allowance of 0 under the ZK binding, but a new root can raise its own tier with self-posted events, as above. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Coordination** is detected from public rows and shown, never punished; a lens may discount it. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

## What this does not protect

- **Your staking record.** Stake rows name the persona and are served to anyone, at hour granularity. The app's disclosure gate governs its own history view, not the validator's table. {cite: SECURITY-POSTURE.md > "After the three reviews (Gate 7, part 2): what changed, what is now assumed"}
- **Any value.** No money moves anywhere in this loop, and no economic security is claimed.
- **Real Farcaster content.** A live author has no root in Totem, so it gets no tier and no persona layer, and stakes on network casts are refused on the public preview. {cite: notes/reports/REPORT-MEGA.md > "Incomplete"} {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## The obvious questions

### Is this money, or a token?

No. It is a per-epoch allowance of influence with no transfer operation. A transfer is the one thing that would turn it into a currency, and the code makes adding one a compile error.

### Who decides that a stake was right?

Community notes, the refutation rules and retraction, read one epoch later, under the active lens. The evaluation of each stake is a pure function over public rows, so anyone can rerun it per persona. The root-level stewardship count is another matter: stake rows are per persona and persona-to-root is hidden by design, so only the root's own device can recompute that count, and the validator takes its word for it.

### What are the TUNE values waiting for?

The owner's call on the early-to-content curve, the allowance per tier, the default stake per action, and what stewardship is worth against a follow. The creator-economy tie-in the early curve is meant to feed is not specified.

## Where it lives in the code

- `lib/influence/types.ts`: actions, directions, default stakes, the allowance formula, the 50-point cap.
- `lib/influence/allowance.ts`: the sealed balance, recharge, refusal.
- `lib/influence/accrual.ts`, `lib/influence/curves.ts`: confirmation rules, weights, the canonical curves.
- `lib/influence/clusters.ts`: coordination detection.
- `validator/rep.js`: the score weights and the deciles.
