# Layers — Gated Pass Report (Gates 0–3)

Persistence + Waves 4–6 on the UI track. Prior reports:
[notes/reports/REPORT.md](notes/reports/REPORT.md) (phase 1, X parity), [notes/reports/REPORT-WAVES.md](notes/reports/REPORT-WAVES.md)
(Waves 1–3). Layer boundaries: [ARCHITECTURE.md](ARCHITECTURE.md).

**All four gates closed. 35/35 cumulative checks green, and 4/4 consecutive
full-suite runs fully green (140 checks, zero failures) — `npm run test:stability`.**

| Gate | Exit criteria | Iterations used / budget |
|---|---|---|
| 0 — Housekeeping | 25 legacy + 4 restart-survival | 1 / 3 |
| 1 — Wave 4 social surfaces | 5/5 (criteria 1–5) | 2 / 5 (+2 donated) |
| 2 — Wave 5 context graph | 4/4 (criteria 6–9) | 1 / 4 (+3 donated) |
| 3 — Wave 6 market layer | 6/6 (criteria 10–15) | 3 / 6 (+6 donated) |

7 of 18 budgeted iterations used. No feature was marked KNOWN-BROKEN, and
no fail-closed feature ever failed three consecutive iterations.

## Final verification

| Check | Result | Command |
|---|---|---|
| Validator unit tests | 6/6 | `npm run test:validator` |
| Phase-1 functional (validator-backed) | 11/11 | `npm run functional` |
| Waves 1–3 acceptance | 14/14 | `npm run test:accept` |
| Gate 1 acceptance | 5/5 | `npm run test:g1` |
| Gate 2 acceptance | 4/4 | `npm run test:g2` |
| Gate 3 acceptance | 6/6 | `npm run test:g3` |
| Restart-survival (post-Gate-3) | 5/5 | `npm run test:gate0` |
| TypeScript strict | clean | `npx tsc --noEmit` |
| Production build | clean | `npm run build` |

Everything: `npm run test:all` (35 checks).

### Stability across consecutive runs — the most instructive part of the pass

**Final result: 4/4 consecutive runs fully green — 140 checks, zero
failures** (`npm run test:stability`, fresh production server per run).

Getting there took five attempts and produced the most valuable findings of
the pass, so the path is recorded rather than just the number.

**Attempt 1** (one long-lived dev server): runs 1–2 green, runs 3–4 failed.
`POST /api/dev` began returning HTTP 500 with `TypeError: Cannot read
properties of null (reading 'useContext')` thrown from inside Next's own
`app-page.runtime.dev.js` → `ErrorBoundary` → `usePathname`.

**Attempt 2** (`scripts/stability.sh`, fresh dev server per run): **0/4
runs fully green.** Dominant failure was `ECONNREFUSED ::1:3000` mid-run —
the dev server becoming unreachable — plus repeated `EINVAL readlink` on
`.next/server/pages-manifest.json` at startup.

**Diagnosis: the `next dev` server is what is unstable here, not the
application.** The project lives in a OneDrive-synced directory, and the dev
server's file watcher and on-demand compiler contend with OneDrive for
handles on `.next` — hence `EINVAL readlink` at startup, hangs mid-run, and
eventually an unreachable server.

**A mitigation I tried and reverted, recorded because it looks reasonable
and is not:** junctioning `.next` to `C:\layers-next` (outside the synced
tree) via `mklink /J`. It moves the build output off OneDrive, but it also
breaks Node module resolution — webpack emits requires that resolve relative
to the output directory, so `C:\layers-next\server\pages\_document.js` cannot
walk up to the project's `node_modules` and every request dies with
`Cannot find module 'react/jsx-runtime'`. Stability went from bad to total
failure. The junction was removed.

**Resolution: the stability suite runs against a production server**
(`next build` + `next start`) rather than `next dev`. The acceptance suites
exercise the application, not Next's dev machinery — there is no HMR, no
on-demand compilation and no watcher holding file handles, which removes the
whole class of failure and tests a truer target. `npm run test:stability`
builds and then runs the complete suite 4× with a fresh server per run.

For day-to-day development in a synced folder, expect `next dev` to need an
occasional restart under sustained automated load.

### What the instability exposed in the product

Three defects surfaced only under repeated runs, and two are the kind this
pass exists to catch:

1. **A silent fail-open in mode filtering.** `buildFeed` resolved each of a
   mode's `ruleIds` and *skipped any it could not resolve*. A Work or Event
   Safe Space user would then be served an unfiltered feed with no
   indication anything was wrong — the mode would look active while doing
   nothing. It now throws and surfaces the feed error state instead. This
   was visible in a stability run as `outsideClusters=18` with
   `unfollowed=0`: the `followedOnly` flag applied, the rule silently did
   not.
2. **Hydration could drop preset rules.** The `rules` namespace loader
   replaced the whole map, which can discard presets already seeded in-process
   by the lazy `ensurePresetRules()`. It now merges, with persisted entries
   winning only for ids they define. This is the likely trigger for (1).
3. **Persistence made every read a write.** `mode.list` / `getActive` are
   marked as mutations because they seed presets on first call, so *every
   feed build* was PUT-ing whole namespaces to the validator over HTTP.
   `persistNs` now dirty-checks against the last flushed payload and skips
   identical writes.

### What the instability exposed in the tests

The suites were reporting infrastructure failures as safety violations —
"sensitive claim accepted without consent" was really a 503 that never
reached the handler, and "ads shown to a viewer whose graph matches nothing"
was really a failed graph-clearing setup step. **A false alarm about a
fail-open is its own kind of dangerous**, because it burns the credibility
of the check. Fixed by:

- `scripts/lib-health.mjs` — a pre-flight server-health gate (exit code 2 =
  "could not test", distinct from 1 = "invariant failed").
- Failures are now classified `FAIL` vs `INFRA`, and suite summaries report
  them separately.
- Safety assertions verify their preconditions before asserting. The consent
  check retries past 503s and only calls a fail-open when a request actually
  reached the handler and was *accepted*.

Screenshots: `/shots/iter-g1`, `/shots/iter-g2`, `/shots/iter-g3`.

---

## GATE 0 — Housekeeping — CLOSED

**Persistence.** Versioned in-place migrations on the validator's existing
SQLite file (`validator/migrations.js`) — no second database, phase-1 tables
untouched. Migration 002 adds `adapter_state(namespace, key, value,
updated_at)` plus `GET/PUT /state[/:ns]` and `DELETE /state`. Client side,
`mock/persist.ts` + `store.ts` hydrate once per process and write through
after every mutation.

Three choices worth recording:

1. **Hydration hooks into `withMockLatency()`**, which every mock method
   already funnels through. `state()` stays synchronous and all 44 existing
   call sites are untouched — the alternative was converting every reader to
   async for no behavioural gain.
2. **Write-through is declarative** (`mock/persisted.ts`): each adapter is
   wrapped once with a `method → namespace[]` map applied in the registry. A
   first attempt at regex-patching a flush into every mutating method
   silently patched *nothing* — it added imports, no calls, and still
   typechecked. The wrapper is less code and verifiable at a glance.
3. **Flushes are awaited, never debounced.** A debounce would lose the last
   write to a `kill -9`, which is exactly what the exit criterion tests
   (`taskkill /F`, not a graceful shutdown).

**Seed tagging.** `demoTags: string[]` on all 29 personas
(`seed/content/demoTags.mjs`) mapping existing accounts to what they
demonstrate (`multi-persona`, `cross-persona-block`, `tier-1`,
`note-gate-fail`, `room-host`, `public-folder`, …). No new accounts invented.

**`npm run seed` preserves user state** by default; `--wipe` clears it via
`DELETE /state`.

**Bugs found and fixed in this gate**

- `state()` now self-heals across hot reloads. The mutable-state object lives
  on `globalThis` and survives HMR, so an object created before a new field
  was added was missing it and threw on first access (`Cannot read
  properties of undefined (reading 'has')` on the new `blocks` map).
- Mock blocks moved out of a module-local `Map` into persisted state, and
  `/api/block-seed` re-pointed at the registry's wrapped rep adapter — it had
  been calling the raw mock directly, so blocks would not have persisted at
  all.

---

## GATE 1 — Wave 4: Social Surfaces — CLOSED (5/5)

**Narrowcast channels** built on the rules engine + disclosure primitives.
Three seeded channels (open / request / invite) with back-posts by existing
accounts. Enforcement lives in one place: `visibleChannelIds` gates the main
feed eligibility pass *and* the health-card `visible()` filter, so a channel
post cannot leak through a correction, a send, or a folder card.

**Public bookmark folders** with a Pinterest-style grid, follow-a-folder
(newest addition lands in the follower's timeline as a folder card), and a
seeded private folder as the negative control.

**Text spaces** with deterministic scripted liveness driven by the
controllable clock, host controls (pin / mute / mark-highlight), and an AV
stage that is an explicitly labelled stub slot.

**Highlight extraction** — host-marked highlights compile into a reel card
injected into topic-matched timelines. Every highlighted message carries
full attribution (avatar, display name, handle, tier badge), identical
treatment whether it came from the host or a tier-2 nobody. That is the
upward-mobility mechanic, so it is asserted explicitly in criterion 4.

**Unified injection queue** (`lib/injection.ts`), built proactively per the
gated-pass failure mode rather than after the first collision. One queue
handles readwise chunks, corrections, sends, folder cards, highlight reels
and (Gate 3) ads, with cross-type de-duplication by source hash and a
per-type cap per session. Dropped items are reported, never silently
truncated.

**Bug found:** the Wave 4 seed block initially ran *after* `posts.json` was
written, so channel posts existed in memory and never reached disk —
criterion 1 failed with "no seeded invite-channel posts". Moved above the
file writes.

---

## GATE 2 — Wave 5: Context Graph — CLOSED (4/4)

**Graph builder** with standard categories one-tap claimable and sensitive
categories (health, finances, politics) behind a visually distinct
per-category opt-in with explicit consent copy, default OFF. "Claim all"
only ever touches standard categories — asserted in criterion 6. Withdrawing
consent immediately deactivates that category's claims rather than just
hiding a toggle, and an import cannot act as a back door around the opt-in.

**Mock imports** (card spend, wearable, watch history) are multi-step with
visible progress and land attested claims marked with issuer + timestamp,
rendered distinctly from self-declared ones.

**"What ads would I see"** — the transparency screen. Live graph left,
matching campaigns right, per-match plain-language explanation
("matched: espresso + tier 4+"). Uses a match index precomputed at seed time
so a claim toggle recomputes without a spinner, per the stated failure mode.

**Earnings** reads mock settlement with a deterministic seeded history;
totals equal the exact sum of events (criterion 9 asserts equality, so
nothing rounds).

**Polish from the visual spot-check:** tier match reasons were rendering as
raw operator syntax (`tier gte 4`) and a claim held both self-declared and
attested rendered twice. Reasons are now phrased for humans, and
`claimsForMatching` collapses duplicates preferring the attested source.

---

## GATE 3 — Wave 6: Market Layer — CLOSED (6/6)

**Escrow intent auction.** Create-intent flow with escrow, pitch slots and a
live countdown; deterministic scripted advertiser bids arrive on the
controllable clock; both resolution paths (pick a winner, or let the window
lapse) fire settlement and update the earnings view.

**Advertiser console** whose audience builder *is* the rules engine —
same `RuleGroup` shape, same `describeGroup` helper the feed rule builder
uses. `graph.claim` was added as a first-class `RuleField` rather than
forking a parallel predicate type.

**k-floor invariant** enforced independently in both layers: the UI disables
submit and shows the reason, and `POST /api/market/campaign` re-checks and
returns 422 regardless of UI state. Criterion 12 asserts a forced API call
is rejected *and* that the gate isn't simply always-on.

**In-feed ad units** matching X's promoted-post anatomy plus a disclosure
label, with one working mini-app embed (simplified live-auction card). Ads
surface only for graph-matched viewers and only in modes that allow them —
Event Safe Space sets `allowAds: false`, which is a mode property the feed
reads, not a special case scattered through the UI.

**Measurement dashboard** exposes aggregates with deterministic seeded DP
noise. Criterion 15 asserts on the payload *shape* — an allow-list of keys
plus a scan for identifier-shaped substrings — and that two reads agree
exactly.

**Bugs found in this gate**

1. **Stale-count race in the audience estimator.** Two rapid audience
   changes fire two estimates; with 200–1500ms mock latency, responses can
   land out of order and a stale count could overwrite a fresh one — on the
   exact screen that must never show a stale count. Fixed with a sequence
   guard.
2. **A fail-open bug that probabilistic testing was passing on luck.**
   Criterion 13 originally relied on the random 25% injection and reported
   "invariant untested this run" when no failure happened to occur. Replaced
   with a deterministic `forceFail` dev control (force the next N calls with
   a matching label to fail). The deterministic version immediately caught a
   real stale count that the probabilistic one had passed. **A fail-closed
   criterion that only sometimes exercises its path is not a passing test.**
3. **Forced-failure budget leaked across runs**, breaking the next run's
   criterion 12. `resetSeed` now disarms forced failures, and the test
   disarms explicitly after use.

---

## Judgment calls (all gates)

1. **`adapter_state` is a namespaced document table, not per-entity tables.**
   The adapter owns the shape; the validator owns durability. Purpose-built
   tables would be premature for adapters whose real backend does not exist
   yet — when the real track implements one, it gets proper tables and drops
   its namespace here. Phase-1 tables (roots, personas, rep_events, blocks)
   were not touched.
2. **Gate 1's failure mode was pre-empted, not awaited.** The spec said to
   unify timeline injection "if you see even one collision"; five injectors
   writing into one array is a collision waiting to happen, so the queue was
   built up front.
3. **The controllable clock was built in Gate 1, not retrofitted in Gate 3.**
   Room liveness needed it first, and the spec's "retrofit at the first
   flake" instruction applies equally to room scripts.
4. **`graph.claim` extends `RuleField`** rather than living in a parallel
   audience-predicate type. That is what makes "the audience builder IS the
   rules engine UI" literally true rather than a claim.
5. **Test harnesses retry navigation.** A Next dev server aborts navigations
   while compiling a route (`ERR_ABORTED`); that is infrastructure noise, and
   a flaky harness makes the 4×-consecutive requirement meaningless.
6. **`gate0.mjs` waits 300s for servers**, not 90s. Cold start plus first
   compile on this OneDrive-backed working directory regularly exceeds 90s,
   and a short window produces a false "servers did not come back up".

---

## Known gaps — dispositions

| Gap | Status |
|---|---|
| Mock state process-lifetime | **CLOSED** (Gate 0) — persisted, restart-tested incl. market state |
| Notification policy stored but not enforced | **STILL OPEN.** Modes set and round-trip it; the notifications surface does not filter on it. Not on any gate's exit criteria |
| Action-button bindings stored but not applied | **STILL OPEN.** Same reason |
| `hasMedia` always false in seed data | **STILL OPEN.** No seeded post carries an image embed, so rules on that field are sound but inert |
| Search does not filter blocked personas | **STILL OPEN, re-logged with reason.** Gate 1 criterion 1 covers channel gating in the feed and on channel pages. Search executes no queries at all (inherited phase-1 gap), so there is no search surface to gate; closing this needs a real search implementation, which no gate required |
| Live Neynar mode unverified | **STILL OPEN.** No API key in this environment |
| Channel request/invite approval flow | **NEW.** `join` records `requested`/`invited` status, but there is no owner-side approval UI — a requested member stays requested. Enforcement is correct (non-members see nothing); the missing piece is the approval affordance |
| Advertiser console is single-clause | **NEW.** The audience builder exposes one claim + one tier clause. The underlying `RuleGroup` supports full AND/OR/NOT nesting (and the feed rule builder exposes it); the market UI does not yet |

---

## Adapter interfaces the real track must implement next

All in `lib/adapters/types.ts`. In priority order by how much trust each
currently absorbs:

1. **`GraphAdapter`** — `claimsForMatching` is the privacy boundary for the
   whole ad system. The real version must enforce per-category consent
   somewhere the client cannot bypass, and must keep the "sensitive excluded
   on error" behaviour that `sensitiveIncluded: false` currently signals.
2. **`MarketAdapter`** — `audienceSize` + `kFloor` are the k-anonymity
   guarantee. Today the floor is checked twice against a synthetic
   population; a real implementation needs a differentially-private audience
   estimate, since an exact count is itself a disclosure channel.
   `measurement` must keep returning aggregates that structurally cannot
   carry identifiers.
3. **`SettleAdapter`** — currently records events on its own authority. Real
   settlement needs actual escrow custody and an auditable ledger; the
   `intent_award` / `intent_refund` split is the shape to preserve.
4. **`SpaceAdapter`** — `isMember` and `canViewFolder` are the two
   fail-closed gates. A real implementation must make membership
   unforgeable client-side; today the client is trusted because the mock is
   the source of truth.
5. **`DisclosureAdapter`** (from Waves 1–3) — still the phase-2 ZK target:
   `canViewLinkage` is a server-side boolean over a server-visible mapping.

`ModeAdapter` and `RulesAdapter` need no cryptography — rules are already
evaluated client-side by real logic, which is the correct long-term shape.
