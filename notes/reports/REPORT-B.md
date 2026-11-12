# Layers — Tier B Report

Five gates: cleanup (safety-set), network-state filter packs, the crosspost
composer, InfoFi market extensions, curator issuance. Prior pass:
[notes/reports/REPORT-A.md](notes/reports/REPORT-A.md).

Budget: 14 iterations (G0: 2, G1: 3, G2: 3, G3: 4, G4: 2; early closes
donate forward).

## Judgment calls made before building

1. **`notes/design/roadmap-v4.md` still does not exist.** Same situation as Tier A, same
   resolution: the prompt fully specifies every gate and is treated as the
   operative spec.
2. **"Enforce in the validator" for refutation authorship** is read as the
   evaluation layer — `declareEdge` resolves and stamps authorship, and
   `holdsStanding` refuses unverified author edges — not the phase-1
   validator service, which has no knowledge of edges. The enforcement point
   is where standing is computed, which is the place a hostile client cannot
   route around.
3. **The starvation fix is per-TENANT, not per-type.** Community notes and
   curator annotations share the `correction` card type — a per-type floor
   cannot distinguish them, which is exactly how Tier A's starvation
   happened. Injection items gain a `tenant` (defaulting to their type), and
   every distinct tenant with queued items is guaranteed its first slot
   before any tenant takes a second.

---

## GATE 0 — Cleanup — IN PROGRESS

**Gate 0 closed: 3/3** (1 iteration, 1 donated).

- **Authorship** enforced in `declareEdge`/`holdsStanding`: an author edge
  verifies only when the declarer IS the from-cast's author (seed authorship
  from the corpus; local casts from their persona marker). Unverified edges
  remain recorded — testimony someone gave — but never touch standing. The
  adversarial test forges an edge from someone else's cast and proves both
  halves: forgery never affects standing, genuine authorship still verifies.
  En route this caught the cast route asserting edges as the SEED viewer
  while stamping casts with the SESSION persona — the two-identity-universes
  trap, third sighting.
- **Reservations**: the injection queue now guarantees every distinct TENANT
  its first slot before any tenant takes a second. Community notes and
  curator annotations are separate tenants of the shared `correction` type —
  which is exactly the distinction the per-type cap couldn't see when Tier A
  starved the curator card. The correction cap went back DOWN to 3, making
  the reservation load-bearing: the test replays the starvation scenario
  under the tight cap and all four cards render.

---

## GATE 1 — Network-state filter packs — CLOSED (5/5)

- **Seeded pack**: "Longform Standard" by footnote_feiler, on the algo shelf
  as a normal artifact card. Import stores it as a PACK (no mode is created);
  attachment to a mode is a separate explicit act — packs are default-OFF and
  the suite proves the feed is untouched until attachment.
- **Per-mode**: Work runs its attached pack while Default doesn't, same feed,
  same import. Round-trip: builder export → preview (exact hide counts vs the
  live 40-card window) → import, byte-stable through the sanitizer.
- **Hostile pack**: all four Tier A import guardrails hold on the pack path,
  plus the new predicate-shape refusal (a predicate carrying anything beyond
  claim+mode kills the import — "a new capability is a design change, not an
  import").
- **Bug found by the suite**: the import route treated `!result.mode` as
  refusal; a successful pack import deliberately returns `mode: null` +
  `pack`, so every legitimate pack import 422'd. Fix: refusal is
  `!mode && !pack`.

The read API contract (for the report's downstream-apps spec):

```
GET /api/packs                          → { packs: [{id, name, authorHandle, algoVersion}] }
GET /api/packs?packId=X&personaId=Y     → { packId, personaId, pass: boolean }
```

`pass` is the entire answer. No reason, no matched predicate, identical
response shape for pass and fail — disclosure wins, and a WHY field would
turn every pack into an oracle over private graph facts.


---

## GATE 2 — Crosspost composer — CLOSED (6/6)

- Binding follows the ACTIVE persona; the private persona binds nothing by
  construction (an external account attestation on a private persona is a
  linkage leak waiting to happen); unbound publish is a server-side 403.
- Cost estimate: $0.015 plain, $0.195 link (exactly 13x) — surfaced in the
  composer BEFORE send. Three-decimal rounding after 2dp turned the rate card
  itself into a bug (0.015 → 0.02 is a silent 33% repricing).
- Degradation preview === what the mock destination actually received,
  asserted against the destination's own record, not the preview describing
  itself. The published draft IS the degraded draft.
- The crosspost lands in the relationship event log with its external ref —
  a deliberate closed-union extension: publishing is an action taken, the
  opposite of the impressions the union exists to bar.
- Collapse: overlapping viewer sees one copy + "probably seen there" chip;
  non-overlapping viewer sees original + attributed mirror; viewer pref
  disables collapsing entirely.
- **Bug found by the suite**: the composer's cost estimate had no sequence
  guard, so under 200-1500ms mock latency an EARLIER draft's estimate could
  land after the current one and show a stale price (0.015 on a link post).
  Fix: out-of-order responses are dropped and the panel shows "Estimating
  cost…" while a fetch is in flight — a wrong number on a money surface is
  worse than no number. The mocks lying about cost is exactly what surfaced
  this.

## GATE 3 — InfoFi market extensions — CLOSED (7/7)

All four features ride ONE escrow ledger (lib/market/escrow.ts) and the
controllable market clock. The money invariant is structural, not promised:

- funds move only through hold()/resolve()/resolvePot() — a grep in the
  safety test pins balance mutation to the one file;
- resolve() THROWS on a second resolution;
- resolvePot() (tip epochs) refuses any distribution that does not sum to
  the pot to the cent — nothing moves on a mismatch;
- conservation identity asserted across every suite:
  Δ(balances + held) === 1000 × Δ(accounts).

Features, each with a full lifecycle on the controllable clock:

1. **Request-priced reads** — per-entity-class rate card (mutuals 0 /
   extended 2 / randoms 5 / businesses 25 default), seeded mid-flight
   request from a business in the viewer's inbox at boot. Dwell past 8s
   settles to the reader; unread past 1h refunds. "Reads are honored on
   rep, not proven" is on the surface. recordDwell is idempotent under
   client retry — no double credit.
2. **Pay-to-DM** — non-mutuals escrow the recipient's price; a reply
   refunds; ignored past the window the fee is KEPT (spam slash, settles to
   the recipient). Mutuals bypass with no escrow at all.
3. **Pledge-to-action** — award a qualifying replier inside the 2h window;
   after it closes the award path refuses BY NAME ("the lottery decides
   now") and the sweep draws deterministically: sha256("lottery:"+pledgeId)
   mod the sorted replier pool — the suite recomputes the draw independently
   and matches. No repliers → refund, never an invented winner.
4. **Tip-gated channels** — chan_openfloor. Tips escrow into the epoch pot;
   likes are read from the store AT CLOSE (nothing about the payout is
   caller-supplied); quadratic split, floor-2dp with the remainder to the
   highest weight. The suite's hand-computed split (pot 6 over likes
   30/46/21 → 1.95 / 2.42 / 1.63) matches exactly.

Safety test (money invariant, safety-set): forced `settle.record` failures
via the deterministic forceFail control — transient (2 < 3 retries) recovers
with exactly one credit; persistent (3 ≥ 3) fails LOUDLY with the ledger
already consistent, and the client retry converges with no re-slash and no
second movement. Full-ledger audit: every escrow in exactly one of
held/settled/refunded/lottery, no negative balances, conservation exact.

**Known limitation (records, not money)**: if settle.record fails
persistently AFTER an escrow resolves, the earnings-record entry for that
settlement is lost while the ledger stays correct — the ledger is
authoritative. The mock's failure semantics are fail-before-mutate, which is
what makes retrying settle.record safe at all; a real settlement adapter
must expose put-by-id so the record path can be retried idempotently too.
Logged for the interop pass.

### Judgment calls (Gate 3)

- One action-switched route (/api/market/infofi) instead of four route
  files: four thin features over one ledger read better as one surface.
- Entity classification is coarse by design: business = ran ads in the seed,
  mutual = target follows requester, extended = shares a cluster with
  someone the target follows, randoms = rest. The full graph only exists for
  the seed viewer; the classes are honest to that.
- Tip-epoch likes resolve at close (seeded count + the viewer's own like),
  not at tip time — the split rewards how the post performed, and removes a
  caller-supplied-likes cheat seam that was in the first draft.

### Ops lesson (cost: ~40 minutes)

A killed `next start` left a ZOMBIE server owning :3000; the replacement
start died with EADDRINUSE inside a backgrounded subshell, and every
"post-fix" test run was actually hitting the old build. The tell was an
impossible response shape (422 with empty violations). New rule, now in the
restart sequence: after any server start, grep the server log for EADDR and
confirm the LISTENING PID on :3000 changed before trusting a single result.


## GATE 4 — Curator issuance — CLOSED (7/7)

The display side already enforced "below threshold renders NOWHERE" (a4).
Gate 4 is the other half — draft → invite co-signers → collect → threshold →
live — with the mirror-image rule: a DRAFT is visible only to its author and
invited co-signers. Not to the desk's other members, not to subscribers, not
to an adversarial fetch with the right feed id.

- **Issuance**: creating a draft signs it as its author (you sign what you
  write, when you write it); the canonical body is frozen at creation so
  every signature signs the same bytes; forged/off-desk signatures never
  count toward threshold (same validator the display side uses — belt and
  braces: an annotation that would not render is not issued at all). At
  exactly threshold the annotation appends into the feed's list and every
  existing surface picks it up with ZERO new display code. 1-of-1 desks
  issue at creation. Signing is idempotent; signing an issued draft is a
  no-op, not an error.
- **Adversarial visibility test**: off-desk curator sees nothing, civilian
  sees nothing, the claim text appears in no non-invited payload, and an
  uninvited sign attempt is a 403 that leaves the draft untouched.
- **Curate AS personas**: the desk page carries "Curating as @handle" chrome
  (the private-persona-composer pattern); payloads carry persona ids and
  handles only. The root-leak grep now scans /api/curators (plus the pack,
  crosspost, and InfoFi surfaces) — 36 payloads, clean.
- **Accuracy record**: the curator's public record (desks, annotations
  issued with their signature, community concur/dispute verdicts) rides the
  Tier A annotationVotes tallies — surfaced, not invented. Issuing the
  mid-flight draft moves the author's issued count by exactly one.
- **Seeded money shot**: todayinruins drafted a Records Desk annotation and
  signed it; marginalia_mo and archive_annette are invited; the desk page
  shows "1 of 2 signatures — awaiting @marginalia_mo, @archive_annette" and
  ONE click of Sign as an invited co-signer issues it live. The page test
  drives exactly that moment.
- **Persistence change (judgment call)**: curatorFeeds was seed-derived and
  unpersisted; issued annotations are user-made state, so BOTH curatorFeeds
  and annotationDrafts persist now. Persisted state wins over seed on boot,
  same as every other namespace.

## RESTART-SURVIVAL — EXTENDED (15/15)

The Tier A 11 plus four Tier B checks, across a real server kill/restart:

- **Filter pack**: survived, still ATTACHED to its mode, still filtering.
- **Crosspost record**: survived with its external ref intact in the
  relationship log.
- **Mid-flight escrow**: a read request whose window was OPEN at the kill
  came back HELD (payer still debited, nothing quietly refunded by the
  restart), and the window RESUMED — advancing the clock past expiry still
  reached the refund terminal with the payer made whole. The clock offset
  deliberately dies with the process; windows tick on wall time, so a
  restart cannot strand or double-pay an escrow.
- **Curator draft**: survived pending with its one signature, still
  invisible to non-invited viewers, and still ACTIONABLE — the invited
  co-signer took it to threshold post-restart.


## THE DESTINATION ADAPTER SPEC (the interop pass implements against this)

Verbatim from lib/crosspost/destinations.ts — the composer knows only
capabilities, costs, and refs; everything protocol-specific lives behind it:

```ts
interface DestinationAdapter {
  id: string;                       // stable, e.g. "x_mock"
  displayName: string;
  capabilities: {
    maxLength: number;              // hard cap, chars
    media: boolean;                 // accepts media attachments
    links: boolean;                 // allows URLs in the body
    threads: boolean;               // accepts multi-part posts
  };
  publish(post: CrosspostDraft): Promise<{ externalRef: string }>;  // throws on refusal
  costEstimate(post: CrosspostDraft): Promise<{ amount: number; currency: string }>;
    // deterministic for a given post shape; USD dollars in the mock
}

interface CrosspostDraft {
  text: string;
  hasMedia: boolean;
  links: string[];   // URLs detected in the body
}
```

Contract notes the mocks enforce and the tests pin:

- `degradeFor(dest, draft)` computes the DELIVERED draft (links stripped
  where unsupported, truncation to maxLength) BEFORE send; the preview IS
  the contract — the server publishes the degraded draft, and the suite
  asserts preview === what the destination received.
- Cost estimates surface in the composer before send; the X mock's rate
  card (link posts 13x) is the 2026 shape being rehearsed.
- Publish returns an opaque externalRef; it lands in the relationship event
  log on the `crosspost` event.
- A real settlement/records adapter must expose put-by-id so record writes
  can retry idempotently (see the Gate 3 records-vs-ledger note).

## KNOWN-BROKEN (Tier B)

Nothing. All five gates closed green with no plateau invocations:
b0 3/3 · b1 5/5 · b2 6/6 · b3 7/7 · b4 7/7, restart-survival 15/15,
root-leak clean over the extended surface set.

Design limitations logged (working as intended, not broken):

- Earnings RECORDS can be lost if settle.record fails persistently after an
  escrow resolves; the ledger is authoritative and stays correct (Gate 3
  section has the full note). Interop requirement filed: put-by-id.
- Broken filter packs fail OPEN at the feed layer by design (a pack that
  cannot evaluate filters nothing) — packs are a curation convenience, not
  a safety surface; the SAFETY direction (disclosure-wins pass/fail API,
  import guardrails) fails closed and is tested adversarially.
- Entity classification for read pricing is coarse (see Gate 3 judgment
  calls) pending a real graph for non-viewer personas.


## FINAL VERIFICATION LOG

- **Sweep set 1 (aborted at run 1, suite 15/23)**: two findings, both fixed:
  1. run1 m3 check 13: INFRA — `mode.create` hit the 2% synthetic failure
     past the test's retries. Correctly classified could-not-test, zero
     product failures. No action.
  2. run1 a2 check 6: the shelf-count assertion went stale a SECOND time —
     "3 algo cards" predates Gate 1 filing the seeded pack card on the same
     shelf. Deterministic, not a flake (the assertion's own comment now
     documents both stalenesses). Fixed to 4 AND the pack card is asserted
     by name, so the count carries meaning instead of being a number that
     rots.
- While stopped, the queued Gate 4 exit-line check landed: b4 t6 now casts
  a fresh dispute vote on a live desk annotation and asserts the curator's
  accuracy record moves by exactly one and the percentage recomputes.
  a2 7/7 and b4 7/7 verified green before relaunch.
- **Sweep set 2**: 4 consecutive 23-suite runs, warmed, detail capture
  verified writing before run 1. Results below when complete.

### Ops lesson (harness)

Stopping a background driver kills the TOP shell only — the sweep bash it
spawned, the npm wrapper, and the node suite all kept running and advanced
two suites past the kill. Orphan checks after any driver stop must walk the
whole tree: driver bash → sweep bash → npm wrapper → node suite, and the
next phase must not start until the node count is back to baseline
(validator + server only).

- **Sweep set 2, run 2**: m3 check 14 FAILED with a TypeError — the check
  creates two modes with UNRETRIED api() calls, and mode.create drew the 2%
  synthetic failure, leaving `.json.mode` undefined. Same root cause as set
  1's check-13 INFRA (also an unretried mode.create, which at least failed
  clean). Harness fragility to the designed failure rate, not a product
  defect — the retry discipline the suites' own helper exists for. Queued:
  wrap both creates in retry() after run 4, then one confirmation sweep.

- **Sweep set 2, run 2 (second finding — REAL BUG)**: b2 check 5 failed:
  the overlapping viewer saw 2 copies of the collapse subject. Root cause:
  resetSeed NEVER CLEARED LOCAL CASTS — data.ts's fixture store
  (extraCasts, in its own global) is untouched by resetState, so
  composer-made casts accumulate for the server process's lifetime across
  every reset. Run 1's fixed-text test cast was still in the feed when run
  2 created its own. The reset route's own comment names this defect class:
  "reporting success for work that has not happened." Every prior suite
  dodged it with unique text or single-run casts; b2 t5 is the first check
  sensitive to process-lifetime accumulation — exactly what consecutive
  sweeps exist to catch. Fix queued (reset clears the fixture store), plus
  the m3 retry fix; then rebuild and a fresh 4-run set.

- **Fixes applied after set 2 (both proven in isolation before set 3)**:
  1. resetState now clears the render layer's fixture store (local casts,
     reaction toggles) via resetLocalStore() — probe: a composer cast is on
     the classic feed, then GONE after reset. The reset contract now means
     what it says.
  2. accept-m3 gained a retryApi() helper; all four unretried mode-create
     sites (checks 13, 14 ×2, 15) and their activates now retry, with a
     loud "failed persistently" error if 4 attempts exhaust. b2 6/6 and
     m3 17/17 on the rebuilt server.
- **Sweep set 3**: 4 consecutive 23-suite runs, launched clean. Set 2's
  run 1 stands as evidence of a full clean sweep (153/153); set 3 is the
  4-consecutive record.

- **Sweep set 3 — THE RECORD: 4 consecutive clean sweeps.**
  153/153 · 153/153 · 153/153 · 153/153 — zero failed suites, zero infra,
  empty failure-detail file, warmed server, detail capture verified before
  run 1. tsc strict clean, production build clean.

## TIER B — CLOSED

| Gate | Scope | Result |
|------|-------|--------|
| 0 | Refutation authorship + per-tenant reservations (safety set) | 3/3 |
| 1 | Network-state filter packs | 5/5 |
| 2 | Crosspost composer | 6/6 |
| 3 | InfoFi market extensions (money invariant, safety set) | 7/7 |
| 4 | Curator issuance (sub-threshold invisibility, safety set) | 7/7 |

Restart-survival extended: 15/15. Root-leak over the extended surface set:
clean. Final verification: 4 consecutive 153-check sweeps, all green.
KNOWN-BROKEN: none. Iterations used: 9 of 14 budgeted.

What the consecutive-sweep discipline earned this pass: a reset-contract
bug (local casts surviving resetSeed — invisible to any single run) and a
harness-fragility class (unretried adapter-backed creates in the m-series
suites). Both fixed, both proven, both now in the ops memory for the next
pass.
