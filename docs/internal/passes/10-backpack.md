---
title: "Data Backpack + Selective Resolution Pass"
pass: 10-backpack
report: notes/reports/REPORT-BACKPACK.md
date: 2026-08-30
status: SHIPPED
---

# Data Backpack + Selective Resolution Pass

> Written from `notes/reports/REPORT-BACKPACK.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Gate 0 selective resolution confirmed already done by the UX pass — no new code, recon confirmed the gate's requirements were already met. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 0 — Selective resolution — ALREADY DONE (UX pass)"}
- **[SHIPPED]** Gate 1: a preview step before commit — `advanceImport` now lands on a `preview` status and writes nothing, and a new `commitImport(jobId)` is the only thing that writes claims, re-deriving the preview against consent as of commit time. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED]** `commitImport` is idempotent (a completed job returns unchanged) and refuses to commit a job that isn't in preview. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED]** Per-claim provenance: `GraphClaim` gained a `method` field, and a new `ClaimProvenance` component shows every claim with tier, method, issuer, and date, sorted attested to inferred to self. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED]** Imported claims flush to the vault as ciphertext on commit. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED]** Trust topology: three provenance tiers (self at 10%, x-inferred at 50%, attested at 100%) act as a straight multiplier — the anti-gaming property made literal, tested as an exact marginal delta. {cite: notes/reports/REPORT-BACKPACK.md > "Trust topology (every grep hangs on it)"}
- **[SHIPPED]** Gate 2: `rawTotal` is surfaced so the breakdown sums to it exactly and `score = min(100, rawTotal)`, making the 100-point cap a real, disclosed clamp rather than a silent one. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}
- **[SHIPPED]** Honest suggestions: each connector's suggested delta excludes any un-consented sensitive yield and is clamped to the remaining headroom below 100. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}
- **[SHIPPED]** The k-floor still holds regardless of score — a k-floor-violating audience is refused with a 422 no matter how high the creating persona's score is. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}
- **[SHIPPED]** A claim carries `method` (`self-declared`, `w3c-vc`, `did-control`, `platform-export`, `x-archive`) and an `issuer` — the how and who of provenance, kept separate from the trust-tier multiplier. {cite: notes/reports/REPORT-BACKPACK.md > "Trust topology (every grep hangs on it)"}
- **[SHIPPED]** The preview UI walks to a preview state before showing a confirm/cancel panel; each preview row exposes its value, tier, method, and withheld state, and withheld sensitive rows are called out explicitly. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED]** Suggestions are ranked by delta descending, and a wholly-sensitive connector doesn't appear at all until its category is opted in. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}
- **[KNOWN-BROKEN]** none beyond the pass's explicit out-of-scope items — crypto transfers remain out of scope and non-executable by the assistant per the standing safety set. {cite: notes/reports/REPORT-BACKPACK.md > "KNOWN-BROKEN / not in scope"}

- **[SHIPPED]** The suite (`accept-bp`, 8 checks) asserts: nothing written until commit and preview matches what lands exactly; a sensitive yield stays withheld until opted in; per-claim provenance is inspectable and rendered; the anti-gaming marginal delta holds at explicit thresholds; the breakdown sums to `rawTotal` exactly with the cap disclosed; suggestions never surface an un-opted sensitive category; a high score cannot bypass the k-floor; and an imported claim is ciphertext on the validator, never plaintext. {cite: notes/reports/REPORT-BACKPACK.md > "Suite"}

## What it found

- Moving claim-writing from `advanceImport` to `commitImport` stranded the persistence trigger — the write-through map still listed the old function and had no entry for the new one, so committed claims lived only in the in-process Map and never flushed to the validator. {cite: notes/reports/REPORT-BACKPACK.md > "The regression the suite caught (and the fix)"}
- `accept-bp` check 8 caught the regression precisely because it's non-vacuous: it imports a claim, then greps the validator's namespace and asserts records actually exist as ciphertext, not just that no plaintext needle is present. {cite: notes/reports/REPORT-BACKPACK.md > "The regression the suite caught (and the fix)"}
- The recon flagged a false-green trap: some plausible root-leak needles (like "Espresso" or "Amateur astronomy") are seed self-claims that live in a read-time overlay and never persist to `graphClaims`, so testing their absence would prove nothing. {cite: notes/reports/REPORT-BACKPACK.md > "The false-green trap the recon flagged (and how the needles dodge it)"}
- The full sweep showed 3 suites (m2, a6, b2) reporting INFRA with 0 FAILED — Playwright's 30s default timeout exceeded on heavy pages under the mocks' injected latency — confirmed as pre-existing cold-render/latency flakiness rather than a regression from this pass. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}

## Judgment calls

- The pass's scope was reconciliation, not a rebuild: a four-agent recon found the UX and crypto passes had already built the backpack import UI, self-declare flow, Ad Match Score, k-floor, and vault namespaces, so this pass closed only the gaps between what exists and what the three gates actually require. {cite: notes/reports/REPORT-BACKPACK.md > "The call up front: reconcile, don't rebuild"}
- Two seed connectors carry explicit methods (`w3c-vc`, `did-control`); the rest default to `platform-export`. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- The score's category base values and the k-floor are fixture constants, not tuned economic parameters, left for a real deployment to calibrate. {cite: notes/reports/REPORT-BACKPACK.md > "KNOWN-BROKEN / not in scope"}

## Verification result

- `accept-bp`: 8/8 standalone, all ARMED (`LAYERS_REQUIRE_SIG=true`, production build). {cite: notes/reports/REPORT-BACKPACK.md > "Suite"}
- Full sweep across all 46 suites: 305 total passing checks, 0 failed suites; `test:bp` newly wired into `sweep-x.sh`. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}
- restart-survival: 29/29, including two checks that directly validate this pass's fix under a real dual-server restart. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}
- Regression on the shared `registry.ts` change: `ux4` 7/7, `g2` 4/4, root-leak clean. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}
- tsc: clean. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}

## Verification result (detail)

- The one blemish in the full sweep — INFRA with 0 FAILED on `m2`, `a6`, and `b2` — was confirmed by standalone re-runs to be the same render-timeout pattern each time, not a regression from this pass since none of those three suites were touched by it. {cite: notes/reports/REPORT-BACKPACK.md > "Verification"}

## Assumptions and open items

- Crypto transfers remain out of scope and non-executable by the assistant, per the standing safety set. {cite: notes/reports/REPORT-BACKPACK.md > "KNOWN-BROKEN / not in scope"}
- Gate 0 selective resolution was pre-existing; this pass did not extend it beyond confirming coverage. {cite: notes/reports/REPORT-BACKPACK.md > "KNOWN-BROKEN / not in scope"}
- The score's category base values and the k-floor are fixture constants, not tuned economic parameters, pending real-deployment calibration. {cite: notes/reports/REPORT-BACKPACK.md > "KNOWN-BROKEN / not in scope"}
- `graphClaims`, `graphConsent`, and `imports` remain the backpack's vault namespaces; `graphClaims` is the sensitive one and now flushes as ciphertext on commit — the gap this pass closed. {cite: notes/reports/REPORT-BACKPACK.md > "What the vault must hold (updated)"}
