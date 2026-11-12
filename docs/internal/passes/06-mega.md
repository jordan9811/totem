---
title: "Mega Pass — The Disclosure Model"
pass: 06-mega
report: notes/reports/REPORT-MEGA.md
date: 2026-08-22
status: SHIPPED
---

# Mega Pass — The Disclosure Model

> Written from `notes/reports/REPORT-MEGA.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Gate 0: identity substrate rework — a root-confined keystore, persona derivation via real SHA-256, and the grant as the atom of disclosure across four tiers (public, opt-in, whitelist, hidden-as-absence). {cite: notes/reports/REPORT-MEGA.md > "GATE 0 — Identity substrate rework — **CLOSED** (1 iteration, 3 donated)"}
- **[SHIPPED]** Blocking reworked to pairwise persona-to-persona records, fanned out at read time only over the siblings a viewer can actually resolve through grants. {cite: notes/reports/REPORT-MEGA.md > "The substantive semantic change: blocking"}
- **[SHIPPED]** Gate 1: PersonaResolver renders merged identity and fails closed to the bare persona on any error, plus `viewAs` to occupy another seeded persona's seat for demo and page-level testing. {cite: notes/reports/REPORT-MEGA.md > "GATE 1 — Disclosure tiers — **CLOSED** (2 iterations, 3 donated forward)"}
- **[SHIPPED]** Gate 2: a fork wizard and a "moved card" in the injection queue, with forward pointers resolving only when both a `kind` field and membership in the fork's recorded id set hold. {cite: notes/reports/REPORT-MEGA.md > "GATE 2 — Forking — **CLOSED** (2 iterations, 2 donated forward)"}
- **[SHIPPED]** Gate 3: private personas as a product — private posts reachable through exactly one chokepoint (`lib/private/visibility.ts`), `notificationPolicy` and `actionButtonSlots` enforced, a mode-pinned persona, and search made to never distinguish "no results" from "not permitted." {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}
- **[SHIPPED]** Gate 4: live read-only Neynar integration — `buildFeed` sources real casts, the fabricated `views` field is dropped (Farcaster has no impression metric), and `power_badge` is no longer treated as verification. {cite: notes/reports/REPORT-MEGA.md > "GATE 4 — Neynar read-only — **CLOSED** (2 iterations) — **LIVE**, not fixture-verified"}
- **[SHIPPED-FIXTURE]** Gate 4's verified fallback: with the API key removed, the same 10/10 mapping suite runs against recorded fixture responses and labels itself FIXTURE-VERIFIED rather than claiming an unearned pass. {cite: notes/reports/REPORT-MEGA.md > "GATE 4 — Neynar read-only — **CLOSED** (2 iterations) — **LIVE**, not fixture-verified"}
- **[SPECCED]** The circuit spec: persona derivation, the grant's canonical signing form, the three resolution predicates (linkage, forward, audience), and fork operations, each stated as the exact predicate a future ZK circuit must prove. {cite: notes/reports/REPORT-MEGA.md > "THE CIRCUIT SPEC"}
- **[KNOWN-BROKEN]** No zero-knowledge anything — the server evaluates every disclosure predicate in the clear and is trusted. {cite: notes/reports/REPORT-MEGA.md > "Deliberately not built (crypto deferred, per standing direction)"}
- **[KNOWN-BROKEN]** Grant signatures are `H(key ‖ canonical)`, not a real signature scheme, and `verifyGrant` has zero callers today. {cite: notes/reports/REPORT-MEGA.md > "Deliberately not built (crypto deferred, per standing direction)"}
- **[KNOWN-BROKEN]** Live mode maps only image and link embeds; frames, videos and quoted casts are skipped rather than mapped badly. {cite: notes/reports/REPORT-MEGA.md > "Incomplete"}
- **[KNOWN-BROKEN]** No persona layer exists on live authors — real Farcaster accounts get no grant or linkage resolution, so the two halves of the product sit side by side rather than fused. {cite: notes/reports/REPORT-MEGA.md > "Incomplete"}
- **[KNOWN-BROKEN]** The k-anonymity floor logic is real, but the audience estimate it checks against is a mock. {cite: notes/reports/REPORT-MEGA.md > "Sharp edges"}

## What it found

- The grant graph never re-seeded after a reset, because `resetState()` marked hydration already complete — every seeded linkage silently became hidden. {cite: notes/reports/REPORT-MEGA.md > "Bugs found in this gate"}
- A legacy test asserted `signerBody.rootId` existed, encoding the leak into the test itself rather than the product. {cite: notes/reports/REPORT-MEGA.md > "Bugs found in this gate"}
- Two doors, one tested: acceptance tests drove `/api/identity` directly while pages resolved through `activeSeedPersonaId()`, so a non-granted viewer's screenshot showed the linkage even though every API-level test passed. {cite: notes/reports/REPORT-MEGA.md > "The most important finding of this gate"}
- Forward pointers stored as ordinary grants were picked up by the linkage resolver, merging a fork's old and new persona into one displayed identity and crowding out the real sibling grant. {cite: notes/reports/REPORT-MEGA.md > "The bug this gate found: two claims sharing one table"}
- An intermittent failure in the advertiser console (a stale audience count shown while a new estimate was in flight, with submit still enabled) turned out to be a real fail-open, not flake — found by a test that failed once, then passed six times. {cite: notes/reports/REPORT-MEGA.md > "A second, unrelated fail-open — found by a flaky test"}
- `signGrant`'s canonical form omitted `kind`, so a signature over "same person" was byte-identical to one over "moved accounts" — latent, not reachable through the current fork flow, but the exact file the real circuit gets specified from. {cite: notes/reports/REPORT-MEGA.md > "Bugs found in this gate"}
- Seeded private posts were dated in the past, so they sank below every seeded post in recency order and were never visible on screen despite being asserted by the tests. {cite: notes/reports/REPORT-MEGA.md > "Two defects the screenshot found that the tests did not"}
- Enforcing `actionButtonSlots` amputated the sidebar for everyone, because presets shared a `base` nav array that was written before anything read the field. {cite: notes/reports/REPORT-MEGA.md > "Two defects the screenshot found that the tests did not"}
- The Neynar contract contradicts training-data assumptions in six places, three of which were live defects in the phase-1 mapper, including a fabricated `views` count and `power_badge` treated as verification. {cite: notes/reports/REPORT-MEGA.md > "The MCP server became available mid-pass"}
- `DATA_SOURCE`/`liveMode` used to just mean "an API key exists," with no way to explicitly ask for seed data. {cite: notes/reports/REPORT-MEGA.md > "DATA_SOURCE was not actually a switch"}
- A runtime test passed while `/home` was still silently serving seeded data instead of live data — the assertion was satisfied by the exact thing it was meant to rule out. {cite: notes/reports/REPORT-MEGA.md > "The bug the screenshot caught, which the test did not"}
- A masked exit code (`npm run test:gate0 | tail -22`) reported a failing script as a pass, which cascaded into a dev-build artifact colliding with the production build. {cite: notes/reports/REPORT-MEGA.md > "A note on how two of these results were nearly mis-reported"}
- `resetSeed` returned success before its own async reset finished, racing every suite that resets and then immediately asserts. {cite: notes/reports/REPORT-MEGA.md > "The four consecutive runs, and what they caught"}
- A "recompute under 1s" timing test was actually measuring the mocks' own deliberate 200–1500ms latency rather than the recompute it named. {cite: notes/reports/REPORT-MEGA.md > "The ninth defect, and the one that matters most about method"}

## Judgment calls

- `notes/design/architecture-v3.md` did not exist at pass start; it was written as Gate 0's first deliverable and treated as authoritative from there. {cite: notes/reports/REPORT-MEGA.md > "Judgment calls made before building"}
- The Neynar MCP server was unavailable for Gates 0–2, so Gate 4 discovered the real API contract by calling it directly and recording fixtures instead. {cite: notes/reports/REPORT-MEGA.md > "Judgment calls made before building"}
- A public link renders as a "Linked identities" section, not a merged card, because merged rendering implies a personal disclosure that a public-tier link overstates. {cite: notes/reports/REPORT-MEGA.md > "JUDGMENT CALLS"}
- Grants got a `kind` field, not in the spec, so linkage, forward, and audience claims never share one resolver. {cite: notes/reports/REPORT-MEGA.md > "JUDGMENT CALLS"}
- `viewAs` exists at all, though not in the spec, because disclosure can only be demonstrated and page-tested from the other viewer's seat. {cite: notes/reports/REPORT-MEGA.md > "JUDGMENT CALLS"}
- `actionButtonSlots` and notification policy deliberately fail OPEN rather than closed, because failing closed on a toolbar or a mention is a bug wearing a safeguard's clothes, not a disclosure risk. {cite: notes/reports/REPORT-MEGA.md > "JUDGMENT CALLS"}
- A 404, never a 403, on private posts — a 403 would itself be the disclosure that the post exists. {cite: notes/reports/REPORT-MEGA.md > "JUDGMENT CALLS"}

## Verification result

- Gate 0: 140/140 legacy suites green, root-leak clean over 28 payloads, 8/8 substrate property tests. {cite: notes/reports/REPORT-MEGA.md > "GATE 0 — Identity substrate rework — **CLOSED** (1 iteration, 3 donated)"}
- Gate 1: 7/7, legacy suite still 140/140, root-leak clean. {cite: notes/reports/REPORT-MEGA.md > "GATE 1 — Disclosure tiers — **CLOSED** (2 iterations, 3 donated forward)"}
- Gate 2: 7/7 (up from 6), full regression intact, root-leak clean. {cite: notes/reports/REPORT-MEGA.md > "GATE 2 — Forking — **CLOSED** (2 iterations, 2 donated forward)"}
- Gate 3: 16/16, full regression intact, root-leak clean. {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}
- Gate 4: 10/10 mapping plus 5/5 runtime, both live and FIXTURE-VERIFIED modes run. {cite: notes/reports/REPORT-MEGA.md > "GATE 4 — Neynar read-only — **CLOSED** (2 iterations) — **LIVE**, not fixture-verified"}
- Final stability: 82 checks per run; clean-environment runs 1–3 at 82/82 with 0 failed and 0 infra; after the timing-bug fix, `g2` ran 5/5 across consecutive runs. {cite: notes/reports/REPORT-MEGA.md > "Final stability"}
- Fixtures (`fixtures/neynar/*.json`, 296KB) are real captured API responses, and the app's actual mapping functions run against them rather than a re-implementation. {cite: notes/reports/REPORT-MEGA.md > "Fixtures"}

## Assumptions and open items

- The keystore is a JSON file (`.keystore/root.json`, gitignored) standing in for a device secure enclave. {cite: notes/reports/REPORT-MEGA.md > "Deliberately not built (crypto deferred, per standing direction)"}
- Mock adapters inject 2% synthetic failure by design; occasional INFRA results in a suite run are the harness working, reported separately from FAIL. {cite: notes/reports/REPORT-MEGA.md > "Incomplete"}
- `viewAs` outranks a mode's persona pin, so an operator who leaves view-as on will not see a pin take effect. {cite: notes/reports/REPORT-MEGA.md > "Sharp edges"}
- Deletion is real only for private posts; public casts go to the network and delete is a request, not a guarantee. {cite: notes/reports/REPORT-MEGA.md > "Sharp edges"}
- The gap to a real cryptographic track is exactly one substitution: replace `signGrant`/`verifyGrant` with a real scheme and prove the three predicates in a circuit; the data model, canonical form, evaluation order, and negative cases do not move. {cite: notes/reports/REPORT-MEGA.md > "5. What is mocked, and what is real"}
- Five harness mistakes of the builder's own (a masked exit code, editing a script mid-loop, a readiness probe misdiagnosing a slow-but-fine server, orphaned processes, and a taskkill that could kill the user's own browser) cost more wall-clock than the nine product defects found. {cite: notes/reports/REPORT-MEGA.md > "What was mine, and what was the product's"}
