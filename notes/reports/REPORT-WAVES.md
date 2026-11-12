# Layers — Major Pass Report (Waves 1–3)

Adapter interfaces, deterministic seed engine, Identity & Modes,
Reputation & Rules, Feed Health, and a settings overhaul — built on top of
the phase-1 X-parity client. Phase-1 report: [notes/reports/REPORT.md](notes/reports/REPORT.md).
Layer boundaries: [ARCHITECTURE.md](ARCHITECTURE.md).

## Status: all suites green

| Suite | Result | Command |
|---|---|---|
| Wave 1–3 acceptance (12 spec tests + 2 UI) | **14/14 pass** | `npm run test:accept` |
| Phase-1 functional (validator-backed) | **11/11 pass** | `npm run functional` |
| Validator unit tests | **6/6 pass** | `npm run test:validator` |
| TypeScript strict | clean | `npx tsc --noEmit` |
| Production build | clean | `npm run build` |

Run everything: `npm run test:all` (25 checks). Acceptance was run 4×
consecutively at 14/14 to confirm the 2% synthetic failure rate isn't
masking flakes.

Screenshots: `/shots/iter-w1` (first pass), `/shots/iter-w2` (after fixes).

## Iteration log

| Iter | Result | What shipped / what broke | Fix |
|---|---|---|---|
| 1 | 10/14 | Adapters + seed + waves 1–3 + settings built. Block fan-out, facet follow, and attestation tier all returned empty — registry bound Persona/Rep to the **validator**, which has no knowledge of seeded personas. Mode pill invisible. | Registry defaults flipped to mock; mode pill moved out of the scrolling tab row |
| 2 | 11/14 | Block leaked 1 post, facet leaked 1 post — feed-health cards (corrections/sends/readwise) bypassed the eligibility filter entirely. Mode pill absent: ~15% of home loads died on unretried 2% mock failures. | Health cards run through the same `visible()` check; `withRetry` around feed fan-out |
| 3 | 13/14 | Mode pill menu wouldn't open under test — acceptance navigated with `domcontentloaded` and clicked before hydration. Verified manually that the menu opens correctly. | Test waits for `networkidle` + hydration beat |
| 4 | 14/14 | All green. Visual spot-check caught a preset rule labelled "Hide replies" that actually matched `has media is false`, and same-author post stacking in the ranked feed. | Bogus rule removed (Curate uses the `hideReplies` flag); author-diversity pass added to ranking |
| 5 | 14/14 ×4 | Two intermittent failures from fail-open error handling (see decision 3). | Shared `retryAdapter` across read routes; profile no longer fails open on block checks |

## What shipped

**Adapter layer (written first, before any feature code).**
`lib/adapters/types.ts` defines PersonaAdapter, RepAdapter,
DisclosureAdapter, ModeAdapter, RulesAdapter, AttestationAdapter, and
FeedHealthAdapter. No UI reaches around an adapter. Every mock method goes
through `withMockLatency()` — randomized 200–1500ms plus a 2% synthetic
failure rate — so every consuming surface was forced to have loading and
error states from the first render, not retrofitted.

**Seed engine.** `npm run seed` → `/seed/generate.mjs`, seeded mulberry32
PRNG, no `Date.now()`/`Math.random()` anywhere, verified byte-identical on
rerun. Produces 25 roots / 29 personas across 5 clusters (crypto, fantasy
football, amateur astronomy, restaurants, history), 400 posts, 5 community
notes, and the seeded test user. Includes 10 hand-written long-form posts
(810–909 words each) as Readwise-chunker anchors, 4+ deep reply chains and
argument threads per cluster, quote-post pairs, and a network-wide breaking
story with a later `is_update` post. Three roots carry a second persona in a
different cluster — that's what makes cross-persona blocking and facet
following genuinely testable rather than theoretically supported.

**Wave 1 — Identity & Modes.** Persona create/switch; disclosure grants
(public / followers / inner circle / hidden) with mock enforcement;
mutual-consent unlock with both-or-nothing reveal (seeded counterparties
auto-accept); layered facet following; and Modes as the centerpiece — a
mode bundles persona, ranking weights, filter rules, notification policy,
and action-button bindings. Four presets ship (Default, Work, Event Safe
Space, Curate), plus create/edit/duplicate/delete. The mode pill sits in
the timeline header, always visible, one tap to switch, feed re-ranks
immediately.

**Wave 2 — Reputation & Rules.** One rules engine (`lib/rules/evaluate.ts`)
— a serializable predicate over (post, author, viewer, context) with
AND/OR/NOT — consumed by modes, feed filters, and the rule builder alike.
No feature grew its own filter logic. The rule builder composes rules in
plain language with a live preview whose count is *exact*, because it runs
the same evaluator the timeline runs against the same deterministic seed.
Tier badges tap through to an explainer; cross-persona blocking fans out to
the root; graduation panel and a 3-issuer attestation catalogue where
connecting a credential visibly bumps the tier.

**Wave 3 — Feed Health.** Readwise-in-timeline (sentence-boundary-aware
~280-word chunking, sequenced back into the feed with progress, plus a
fast-forward dev control); send-to-timeline with a receiver permission gate;
topic saturation with an "I'm caught up" control where `is_update` posts
still break through; community-notes reinjection gated on note-author tier
≥ 3 **and** ≥ 2 endorsements; and a debunk indicator.

**Settings overhaul.** Seven sections (Account & Personas, Modes, Rules &
Filters, Feed Health, Privacy & Disclosure, Attestations, Developer). The
Developer pane shows which implementation each adapter resolves to, toggles
latency injection to its 1400–1500ms / 25%-failure setting, resets seed
state, and fast-forwards the readwise schedule.

## Decisions made without asking

1. **Adapter defaults are `mock`, not `validator`.** The ground rules say
   "Default mock" but also "wire persona + rep to the existing validator."
   Both can't hold for the seeded surface: seeded personas live in
   `/seed/data`, and the validator's SQLite has never heard of them —
   binding rep to the validator meant tiers came back null and blocks
   silently no-opped (this is exactly what failed in acceptance iteration 1).
   Resolution: registry defaults to mock; `ADAPTER_REP=validator` /
   `ADAPTER_PERSONA=validator` bind the real service; and the phase-1 routes
   (`/api/personas`, `/api/block`, `/api/signer`) still call the validator
   directly, so the validator path keeps full end-to-end coverage via
   `npm run functional`.
2. **The phase-1 fixture timeline is preserved at `/home?feed=classic`.**
   The seeded mode-aware feed is now the `/home` default. Rather than delete
   the validator-backed surface (and with it the phase-1 functional
   coverage), it stays reachable and tested. Without this the major pass
   would have silently regressed the persona→cast→block flow.
3. **Server-side retry on transient adapter failures, and never fail open.**
   With ~8 mock calls per feed build at 2% each, roughly 15% of home loads
   failed outright. Rather than weaken the failure injection (the spec
   requires it), reads retry up to 3× — what a real client does — and
   surface an error state only on persistent failure (`lib/adapters/retry.ts`).
   Two follow-on bugs surfaced from running the suite repeatedly rather than
   once: the profile page caught a failed block-check into `[]`, silently
   rendering a **blocked account as un-blocked**, and the attestation route
   caught a failed tier read into `null`, making a successful credential
   connection look like it did nothing. Both now retry, and the profile
   states plainly that it couldn't confirm block settings rather than
   guessing. Swallowing an adapter failure into a falsy value is the
   dangerous pattern here — the error state is the honest answer.
   Test 11 still asserts loading/error states under the 25%-failure setting.
4. **"Hide replies" is a mode flag, not a rule.** The rules engine evaluates
   a post's own fields; reply-ness is a property of the feed graph. A
   `rule_no_replies` preset would have had to match on an unrelated field
   and lie about what it does — it was caught in the visual spot-check
   rendering as "has media is false," and was removed in favor of the
   `hideReplies` flag Curate already used.
5. **Author diversity pass on ranking.** A pure score sort stacked four
   consecutive posts from the same prolific account, which no real timeline
   does. Posts are pushed down a slot if the same author occupies either of
   the previous two.
6. **Dicebear avatars by URL construction**, so seed generation has no
   runtime network dependency.
7. **Seeded post ages span ~3 days on a power curve.** The first
   implementation decremented a counter and bottomed out, piling 112 posts
   into a 10-minute window and starving story-tagged posts of feed
   placement — caught while verifying mode behavior.

## What is mocked vs validator-backed

| Capability | Implementation | Notes |
|---|---|---|
| Persona identity | **mock** (validator available) | Seeded personas live in `/seed`; validator impl real and exercised by `npm run functional` |
| Reputation tiers | **mock** (validator available) | Validator computes real percentile deciles over its own population |
| Root-level blocking | **mock** (validator available) | Both implementations fan out to the root identically |
| Disclosure grants | mock only | No real backend exists yet |
| Modes | mock only | Process-lifetime state; resets on server restart |
| Rules engine | **real, client-side** | `lib/rules/evaluate.ts` is genuine logic, not a stub — the mock only stores rules |
| Attestations | mock only | 3 mock issuers; no real credential verification |
| Feed health | mock only | Chunking is real logic; scheduling/permissions are in-memory |

## Known gaps

- **Mock state is process-lifetime.** Modes, rules, grants, blocks, and
  schedules live in memory and reset when the dev server restarts. The spec
  asked for SQLite-or-localStorage persistence; the adapter interfaces are
  shaped for it (every method is already async and failure-capable), but the
  mock implementations do not persist. This is the largest single gap.
- **Notification policy is stored, not enforced.** A mode's
  `notificationPolicy` is set, displayed, and round-tripped, but the
  notifications surface does not yet filter on it.
- **Action-button bindings are stored, not applied.** The composer and nav
  slots persist per mode; neither the composer nor the nav rail reads them
  back yet.
- **`hasMedia` is always false in seed data** (posts carry no image embeds),
  so rules on that field are structurally sound but currently inert.
- **Search does not filter blocked personas** — search executes no queries
  at all (inherited phase-1 gap). Acceptance test 3 verifies block fan-out
  across feed and profile, not search.
- Live Neynar mode remains implemented but unverified (no API key here).

## Adapter interfaces the real track must implement

Everything in `lib/adapters/types.ts`. The three the real track should
prioritize, in order of how much trust they currently absorb:

1. **`DisclosureAdapter`** — the phase-2 ZK work lands here. `canViewLinkage`
   is currently a server-side boolean over a server-visible mapping; the real
   version proves linkage visibility without the server holding the graph.
2. **`RepAdapter`** — `tierFor` must return a percentile tier without
   exposing raw scores (the validator contract already models this);
   `blockedFor` must fan out at the root without revealing which personas
   share a root.
3. **`FeedHealthAdapter`** — `reinjectionsFor` encodes the community-notes
   consensus gate (tier ≥ 3, ≥ 2 endorsements). The real version needs an
   actual endorsement/consensus mechanism behind the same call.

`ModeAdapter` and `RulesAdapter` need persistence, not cryptography — rules
are already evaluated client-side by real logic, which is the correct
long-term shape.
