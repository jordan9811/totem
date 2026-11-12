---
title: "Build Report (phase 1: X visual parity)"
pass: 01-build
report: notes/reports/REPORT.md
date: 2026-08-18
status: SHIPPED-FIXTURE
---

# Build Report (phase 1: X visual parity)

> Written from `notes/reports/REPORT.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** A Farcaster client with X visual parity plus a persona/reputation layer via a local trusted validator, as phase 1 of a larger protocol. {cite: notes/reports/REPORT.md > "Layers — Build Report (phase 1: X visual parity)"}
- **[SHIPPED]** Every graded surface built light-mode-first (refs are logged-in and entirely light mode), with a dark theme left as a token swap not part of the graded build. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** 2026-style nav (Home, Explore, Notifications, Chat, SuperGrok, Premium+, Money, History, Creator Studio, Articles, Profile, More), with SuperGrok/Premium+/Money/etc. as stub surfaces. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** SQLite via `node:sqlite` (built into Node 24) instead of a native npm binding, to avoid native-build risk on Windows; Express as specified. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** Handle rules relaxed to `^[A-Za-z0-9_]{1,15}$` (X-style mixed case) to match mixed-case handles shown in refs. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** Dev identity seeded as jordan/@yeak__ (fid 9152) matching the logged-in refs; personas resolve through the validator like any other root, with the first persona auto-selected and no login wall on reads. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** Tier-1 discovery filter exempts the viewer's own persona so a fresh account can still see its own posts in For You. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED-FIXTURE]** Fixture authors seeded as validator roots/personas (one root per fixture account, rep scaled to follower counts, @tier1grinder pinned to tier 1) so tier badges and discovery filtering are live end-to-end in fixture mode. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED]** Casts publish under the root signer with a trailing `layers:persona:<id>` marker that the client resolves and strips at render (phase 2 moves this into signed cast metadata). {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[SHIPPED-FIXTURE]** The Neynar client (`lib/data.ts`) implements real v2 endpoints (trending feed, user, cast, conversation, channels, cast publish via managed signer), but this build ran entirely on the fixture dataset (`lib/fixtures/data.json`) because no `NEYNAR_API_KEY` was available in this environment. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[KNOWN-BROKEN]** Live-mode Neynar code paths are written but unverified against the real API. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- **[KNOWN-BROKEN]** Grok/Premium/Money/Chat/Articles/Creator Studio are stub pages, out of phase-1 scope (nav parity only); search executes no queries (visual parity only); mobile drawer nav is simplified vs X's full drawer. {cite: notes/reports/REPORT.md > "Known gaps"}

## What it found

- Iteration 1 (score 76, FAIL) found a critical mobile profile banner/avatar oversizing bug plus missing Grok+kebab icon pairs on cards and a wrongly saturated unfocused composer. {cite: notes/reports/REPORT.md > "Iteration log"}
- Iteration 2 (score 85, FAIL) found the Grok glyph read as a "prohibition" sign rather than X's slash-over-broken-circle, wrong Live pill styling, and a too-dark/cold modal scrim. {cite: notes/reports/REPORT.md > "Iteration log"}
- Iteration 3 (score 86, FAIL) found home-mobile fixed elements displaced twice (CRITICAL) by tab-row overflow expanding the layout viewport, plus a straight apostrophe in "What's happening". {cite: notes/reports/REPORT.md > "Iteration log"}
- Iteration 4 (score 86, FAIL) found the Grok glyph still wrong and settled on a single long slash through a full circle, plus icon and spacing fixes across Creator Studio, Money, Articles, and the composer. {cite: notes/reports/REPORT.md > "Iteration log"}
- Iteration 5 (score 85, FAIL) was the first run with zero CRITICAL findings; all remaining findings were micro-spacing issues, and the grader's closing note confirmed colors, column geometry, type metrics, letterforms, icon set, permalink anatomy, and mobile chrome survived pixel-level hostile inspection. {cite: notes/reports/REPORT.md > "Loop status"}
- The 86 to 85 step between iterations 4 and 5 is grader-to-grader noise, not a regression. {cite: notes/reports/REPORT.md > "Loop status"}
- The pre-grade self-review pass already caught missing floating Grok/chat quick-action buttons (present in every ref), a malformed Premium+ icon, and a wrapped mobile "For you" tab before iteration 1 was even graded. {cite: notes/reports/REPORT.md > "Iteration log"}

## Judgment calls

- The written spec's pure-black dark mode requirement was set aside in favor of light mode because /refs — declared ground truth over the spec — is entirely light mode, logged in. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- The spec's older "Messages, omit Grok" nav list was set aside in favor of the 2026 nav shown in the refs. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}
- Fixture authors were seeded as validator roots/personas rather than left as plain fixture data, specifically so tier badges and discovery filtering could be exercised end-to-end in fixture mode. {cite: notes/reports/REPORT.md > "Decisions made without asking (spec ambiguities & conflicts)"}

## Verification result

- `node scripts/functional.mjs` (validator + dev server running), first run, all green (2026-08-18): 11 PASS lines covering signer connect, persona creation, cast publish/toast, timeline identity, optimistic like, second persona, tier badge rendering, cross-context Following visibility pre-block, block API, root-level block fan-out across all personas, and one-directional block behavior. {cite: notes/reports/REPORT.md > "Functional verification"}
- Validator unit tests (`npm run test:validator`): 6/6 pass, covering rep accrual weights + sourceId dedupe, percentile decile assignment with upward tie resolution, persona tier == root tier, root-level block fan-out including personas created after the block, and validation errors. {cite: notes/reports/REPORT.md > "Functional verification"}
- Cross-context visibility is asserted on the Following feed (the contractually unfiltered surface) because fresh roots are tier 1 by design; the run verifies both Following and For You (tier-1-filtered) behavior implicitly. {cite: notes/reports/REPORT.md > "Functional verification"}
- The visual-parity grading loop was paused by the user after iteration 5 (session limit), before the 15-iteration cap and before the iteration 5-to-8 plateau guard could trigger; trajectory was 76 to 85 to 86 to 86 to 85. {cite: notes/reports/REPORT.md > "Loop status"}

## Assumptions and open items

- Everything still open at pause time was single-property spacing (four MAJOR findings), described as small and mechanical for the next iteration. {cite: notes/reports/REPORT.md > "Loop status"}
- To resume: run `npm run validator` + `npm run dev`, then per iteration `node scripts/capture.mjs <N>` and re-run the grader prompt from the one-shot spec (fresh agent, /refs + UI spec + /shots/iter-N only), applying CRITICAL/MAJOR findings and repeating; iteration history is preserved in /shots. {cite: notes/reports/REPORT.md > "Loop status"}
- The validator database contains the root-to-persona mapping in cleartext, so whoever runs the validator can deanonymize every persona. {cite: notes/reports/REPORT.md > "Phase-1 trust compromises (stated plainly)"}
- Rep events are asserted by the validator's poller, not proven. {cite: notes/reports/REPORT.md > "Phase-1 trust compromises (stated plainly)"}
- Root-level block fan-out makes persona linkage observable by timing. {cite: notes/reports/REPORT.md > "Phase-1 trust compromises (stated plainly)"}
- All three trust compromises are stated as the documented cost of shipping phase 1 with a trusted service, with the HTTP contract in validator/API.md marked as the seam a ZK validator later replaces without client changes. {cite: notes/reports/REPORT.md > "Phase-1 trust compromises (stated plainly)"}
- Live Neynar mode is implemented but untested since no API key was available in this environment. {cite: notes/reports/REPORT.md > "Known gaps"}
- The report notes it is "superseded in part": the major pass (Waves 1-3) is documented separately, `/home` now serves the seeded mode-aware feed, and the phase-1 fixture timeline described in this report is preserved at `/home?feed=classic`, still covered by `npm run functional`. {cite: notes/reports/REPORT.md > "Layers — Build Report (phase 1: X visual parity)"}
