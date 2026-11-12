---
title: "Major Pass Report (Waves 1–3)"
pass: 03-waves
report: notes/reports/REPORT-WAVES.md
date: 2026-08-20
status: SHIPPED
---

# Major Pass Report (Waves 1–3)

> Written from `notes/reports/REPORT-WAVES.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Adapter interfaces, a deterministic seed engine, Identity & Modes, Reputation & Rules, Feed Health, and a settings overhaul, built on top of the phase-1 X-parity client. {cite: notes/reports/REPORT-WAVES.md > "Layers — Major Pass Report (Waves 1–3)"}
- **[SHIPPED]** The adapter layer (`lib/adapters/types.ts`) was written first, before any feature code, defining PersonaAdapter, RepAdapter, DisclosureAdapter, ModeAdapter, RulesAdapter, AttestationAdapter, and FeedHealthAdapter, with no UI reaching around an adapter. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED-FIXTURE]** Every mock adapter method goes through `withMockLatency()` (randomized 200-1500ms plus a 2% synthetic failure rate), forcing every consuming surface to have loading and error states from first render. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** A seed engine (`npm run seed` -> `/seed/generate.mjs`) using a seeded mulberry32 PRNG with no `Date.now()`/`Math.random()` anywhere, verified byte-identical on rerun, producing 25 roots / 29 personas across 5 clusters, 400 posts, 5 community notes, and the seeded test user. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** Wave 1 (Identity & Modes) — persona create/switch; disclosure grants (public/followers/inner circle/hidden) with mock enforcement; mutual-consent unlock with both-or-nothing reveal; layered facet following; and Modes bundling persona, ranking weights, filter rules, notification policy, and action-button bindings, with four presets (Default, Work, Event Safe Space, Curate) plus create/edit/duplicate/delete. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** Wave 2 (Reputation & Rules) — one rules engine (`lib/rules/evaluate.ts`), a serializable predicate over (post, author, viewer, context) with AND/OR/NOT, consumed identically by modes, feed filters, and the rule builder; tier badges tap through to an explainer; cross-persona blocking fans out to the root; a graduation panel; a 3-issuer attestation catalogue. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** Wave 3 (Feed Health) — readwise-in-timeline with sentence-boundary-aware ~280-word chunking and a fast-forward dev control; send-to-timeline with a receiver permission gate; topic saturation with an "I'm caught up" control where `is_update` posts still break through; community-notes reinjection gated on note-author tier >= 3 and >= 2 endorsements; a debunk indicator. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** A settings overhaul with seven sections (Account & Personas, Modes, Rules & Filters, Feed Health, Privacy & Disclosure, Attestations, Developer), the Developer pane showing which implementation each adapter resolves to and toggling latency injection, seed reset, and readwise fast-forward. {cite: notes/reports/REPORT-WAVES.md > "What shipped"}
- **[SHIPPED]** The phase-1 fixture timeline is preserved and reachable at `/home?feed=classic`, kept alive rather than deleted so the validator-backed persona-to-cast-to-block flow does not silently regress. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- **[SHIPPED]** Server-side retry (up to 3x) on transient adapter failures, surfacing an error state only on persistent failure (`lib/adapters/retry.ts`), rather than weakening the required 2% synthetic failure injection. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- **[SHIPPED]** "Hide replies" implemented as a mode flag rather than a rule, since the rules engine evaluates a post's own fields and reply-ness is a property of the feed graph. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- **[SHIPPED]** An author-diversity pass on ranking, pushing a post down a slot if the same author occupies either of the previous two slots. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- **[SHIPPED]** Dicebear avatars built by URL construction so seed generation has no runtime network dependency. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- **[KNOWN-BROKEN]** Mock state is process-lifetime: modes, rules, grants, blocks, and schedules live in memory and reset when the dev server restarts, even though the spec asked for SQLite-or-localStorage persistence and every adapter method is already async and failure-capable. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- **[KNOWN-BROKEN]** Notification policy is stored, displayed, and round-tripped by a mode, but the notifications surface does not yet filter on it. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- **[KNOWN-BROKEN]** Action-button bindings persist per mode in the composer and nav slots, but neither the composer nor the nav rail reads them back yet. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- **[KNOWN-BROKEN]** `hasMedia` is always false in seed data (posts carry no image embeds), so rules on that field are structurally sound but currently inert. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- **[KNOWN-BROKEN]** Search does not filter blocked personas because search executes no queries at all (inherited phase-1 gap); acceptance test 3 verifies block fan-out across feed and profile, not search. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- **[KNOWN-BROKEN]** Live Neynar mode remains implemented but unverified (no API key available). {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}

## What it found

- Iteration 1 (10/14): block fan-out, facet follow, and attestation tier all returned empty because the registry bound Persona/Rep to the validator, which has no knowledge of seeded personas; the mode pill was also invisible. {cite: notes/reports/REPORT-WAVES.md > "Iteration log"}
- Iteration 2 (11/14): block leaked 1 post, facet leaked 1 post, because feed-health cards (corrections/sends/readwise) bypassed the eligibility filter entirely; about 15% of home loads also died on unretried 2% mock failures with the mode pill absent. {cite: notes/reports/REPORT-WAVES.md > "Iteration log"}
- Iteration 3 (13/14): the mode pill menu would not open under test because acceptance navigated with `domcontentloaded` and clicked before hydration; manually verified the menu opens correctly, then fixed the test to wait for `networkidle` plus a hydration beat. {cite: notes/reports/REPORT-WAVES.md > "Iteration log"}
- Iteration 4 (14/14): the visual spot-check caught a preset rule labelled "Hide replies" that actually matched `has media is false`, and same-author post stacking in the ranked feed; the bogus rule was removed and an author-diversity pass added. {cite: notes/reports/REPORT-WAVES.md > "Iteration log"}
- Iteration 5 (14/14 x4): two intermittent failures traced to fail-open error handling; fixed with a shared `retryAdapter` across read routes, and the profile page no longer fails open on block checks. {cite: notes/reports/REPORT-WAVES.md > "Iteration log"}
- The profile page had been catching a failed block-check into `[]`, silently rendering a blocked account as un-blocked, and the attestation route had been catching a failed tier read into `null`, making a successful credential connection look like it did nothing. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- Seeded post ages originally span ~3 days on a power curve; the first implementation decremented a counter and bottomed out, piling 112 posts into a 10-minute window and starving story-tagged posts of feed placement, caught while verifying mode behavior. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}

## Judgment calls

- Adapter defaults are `mock`, not `validator`, because the seeded surface's personas live in `/seed/data` and the validator's SQLite has never heard of them; `ADAPTER_REP=validator`/`ADAPTER_PERSONA=validator` bind the real service, and the phase-1 routes still call the validator directly for full end-to-end coverage via `npm run functional`. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- Swallowing an adapter failure into a falsy value was named as the dangerous pattern; the error state is treated as the honest answer, and test 11 still asserts loading/error states under the 25%-failure setting. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}
- "Hide replies" being caught rendering as "has media is false" in the visual spot-check led to removing the bogus rule in favor of the `hideReplies` flag Curate already used, rather than fixing the rule's match condition. {cite: notes/reports/REPORT-WAVES.md > "Decisions made without asking"}

## Verification result

- Wave 1-3 acceptance (12 spec tests + 2 UI): 14/14 pass; phase-1 functional (validator-backed): 11/11 pass; validator unit tests: 6/6 pass; TypeScript strict: clean; production build: clean. {cite: notes/reports/REPORT-WAVES.md > "Status: all suites green"}
- Everything runs via `npm run test:all` (25 checks); acceptance was run 4x consecutively at 14/14 to confirm the 2% synthetic failure rate isn't masking flakes. {cite: notes/reports/REPORT-WAVES.md > "Status: all suites green"}
- Screenshots recorded at `/shots/iter-w1` (first pass) and `/shots/iter-w2` (after fixes). {cite: notes/reports/REPORT-WAVES.md > "Status: all suites green"}

## Assumptions and open items

- Mock state being process-lifetime is called out as the largest single gap of the pass. {cite: notes/reports/REPORT-WAVES.md > "Known gaps"}
- `DisclosureAdapter` is the top adapter priority for the real track: `canViewLinkage` is currently a server-side boolean over a server-visible mapping, and the real version must prove linkage visibility without the server holding the graph. {cite: notes/reports/REPORT-WAVES.md > "Adapter interfaces the real track must implement"}
- `RepAdapter`'s `tierFor` must return a percentile tier without exposing raw scores (the validator contract already models this), and `blockedFor` must fan out at the root without revealing which personas share a root. {cite: notes/reports/REPORT-WAVES.md > "Adapter interfaces the real track must implement"}
- `FeedHealthAdapter`'s `reinjectionsFor` encodes the community-notes consensus gate (tier >= 3, >= 2 endorsements); the real version needs an actual endorsement/consensus mechanism behind the same call. {cite: notes/reports/REPORT-WAVES.md > "Adapter interfaces the real track must implement"}
- `ModeAdapter` and `RulesAdapter` need persistence, not cryptography, since rules are already evaluated client-side by real logic. {cite: notes/reports/REPORT-WAVES.md > "Adapter interfaces the real track must implement"}
- Persona identity, reputation tiers, and root-level blocking are each mock-implemented with a validator-backed alternative available and exercised by `npm run functional`; disclosure grants, modes, attestations, and feed health remain mock-only; the rules engine is real client-side logic, not a stub. {cite: notes/reports/REPORT-WAVES.md > "What is mocked vs validator-backed"}
