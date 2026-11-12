---
title: "X Interop Pass"
pass: 07-x-interop
report: notes/reports/REPORT-X.md
date: 2026-08-26
status: SHIPPED-FIXTURE
---

# X Interop Pass

> Written from `notes/reports/REPORT-X.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Gate 0: put-by-id settlement records — `settle.record` accepts a client-supplied `recordId`, every InfoFi call site derives ids deterministically, and every retry path re-puts, proven exactly-once under three forced persistent failures. {cite: notes/reports/REPORT-X.md > "GATE 0 — put-by-id settlement records — CLOSED (4/4) — N/A live/fixture (mock-layer)"}
- **[SHIPPED-FIXTURE]** Gate 1: account linking via OAuth 2.0 PKCE behind an adapter — the fixture plays a recorded exchange matching real X API v2 shapes; the live implementation exists but requires `X_API_CLIENT_ID`, which is absent. {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** The attestation shape `{platform, handle, personaId, verifiedAt, method, proofRef}`, where `proofRef` is a reference (`users/me:<id>`), never token material; one persona per handle; private personas refused at the adapter. {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED-FIXTURE]** Gate 2: archive import across all four X export lanes (account, tweets, likes, bookmarks, following, personalization) via per-file streaming ingestion with resumable sessions; no real archive exists, so a constructed fixture matches X's export structure exactly. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Original timestamps preserved on import, so imports render as history and never as fresh feed content — adversarially asserted against the discovery feed. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** The following list is hashed-only at rest, verified by grepping the validator's actual SQLite state for the raw fixture ids. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Sensitive personalization items queue behind the existing per-category graph consent — nowhere until opt-in, and a direct import without consent is a 409. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED-FIXTURE]** Gate 3: live X destination + spend controls — a spend ledger with per-action, per-day and per-run caps, a double-post guard via publish idempotency keys, and a rate card with `lastVerified`, all FIXTURE-VERIFIED; live-write SKIPPED, real spend $0.00. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED]** An adversarial 50-send loop lands exactly 5 sends before the $1 run cap, produces 45 loud refusals, and zero sends after the first refusal. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED]** An attested handle replaces the mock X destination with the real "x" destination for that persona only, and a zkTLS upgrade path is documented on the attestation's `method` field (`"oauth" | "web-proof"`). {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Unlinking removes the attestation and destination binding, restores the mock binding, frees the handle, and tombstones it so a later archive import can render "source unlinked." {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Verified badging is earned, not assumed: an archive's handle must match the persona's OAuth attestation, or the import renders "unverified import." {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Bookmarks land in a real "X import" bookmark folder riding the same slot as algo cards, and benign interests land as claims with source "x-inferred" — a third provenance, never conflated with self-declared or attested. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Re-importing the same archive is idempotent, landing zero new records via composite persona+platform-id keys. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED]** A double-post guard uses publish idempotency keys (`x:castHash`) with check-before-retry: an injected failure plus a client retry converges to one external ref and one spend entry, and a deliberate duplicate returns the same ref marked deduped. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED]** Owned-reads sync runs on-demand only (no background polling), incremental via cursor so a second sync pulls zero, and refuses without a linked account. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED]** The rate card (`lib/x/ratecard.json`) carries `lastVerified`, and the composer shows "(rates verified 2026-08-01)" on the estimate so a stale card is visible rather than silent. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED]** Gate 4: follow migration + deferred auto-follow — matching consults account attestations only (hashed platform ids), a single confirm executes the whole batch ("N of your X follows are here"), and already-followed matches clear from pending without a duplicate edge. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}
- **[SHIPPED]** Non-matches stay a hashed pending list, asserted at rest in the validator's SQLite and on the wire — the migrate surface carries counts and handles, never hashes or raw ids. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}
- **[SHIPPED]** A deferred auto-follow, controllable on/off with an excluded-handles list, fires through the injection queue with its own reserved floor when a new attestation matches a pending entry. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}
- **[SPECCED]** The delta list: what a second platform adapter (Instagram/TikTok) inherits verbatim (the destination contract, the spend ledger, account attestations, the import session machinery, follow migration) versus what it must build itself (OAuth endpoints, the archive parser, the rate card, sensitive-category mapping, overlap semantics). {cite: notes/reports/REPORT-X.md > "THE DELTA LIST — what Instagram/TikTok adapters inherit vs must build"}
- **[KNOWN-BROKEN]** none — all five gates closed green with no plateau invocations; the live-write path is unreached only because no credentials exist, a design limitation rather than breakage. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"}

## What it found

- A first-draft bug let two personas importing the same archive fight over records; fixed via composite persona+platform-id keys. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- Real-overlap collapse is verified only through the exact rendering function the classic feed calls, not a full page walk, because local casts author as session personas while attestations land on seeded personas — an identity split this pass does not bridge. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- Single-viewer migration shape: the follow delta is the seed viewer's only, so migration executes for the importing persona alone. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}

## Judgment calls

- `fixtureHandle` is a dev-only input simulating which X account authorized; live mode ignores it entirely. {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- "Imported from X" renders as a clearly-headed profile section rather than an interactive tab, leaving X's visual parity of the tab row untouched. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- Sensitive classification over-gates on purpose — one extra opt-in click beats one silent sensitive import. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- Real-overlap collapse is verified through the exact rendering function the classic feed calls, since local casts and attestations sit in different persona universes on this fixture; logged explicitly as a judgment call. {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- The follow-migration delta is scoped to a single viewer, and deferred auto-follow defaults ON for the demo moment. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}

## Verification result

- 4 consecutive clean sweeps, first attempt: 187/187 across all 28 suites, ENABLE_X_WRITE unset, tsc strict clean, production build clean. {cite: notes/reports/REPORT-X.md > "FINAL VERIFICATION — THE RECORD"}
- Restart-survival 19/19; root-leak clean over 40 payloads including every new X surface. {cite: notes/reports/REPORT-X.md > "X INTEROP — CLOSED"}
- Total real spend: $0.00 — every ledger entry carries `mode:"fixture"`, and the live total is asserted zero in Gate 3 check 8 and in every sweep. {cite: notes/reports/REPORT-X.md > "TOTAL REAL SPEND"}
- Iterations: 7 of 14 budgeted. Unlike Tier B's final verification, which needed three sweep sets, this set went clean on the first attempt. {cite: notes/reports/REPORT-X.md > "X INTEROP — CLOSED"}

## Assumptions and open items

- `X_API_*` env vars, the `/imports` archive ZIP, and `ENABLE_X_WRITE` are all absent or unset, so every live gate runs FIXTURE-VERIFIED and the live adapter's `publish()` throws loudly rather than silently no-op'ing. {cite: notes/reports/REPORT-X.md > "REALITY"}
- Live-write path unreached: no credentials exist, and the live fetch path is a stub behind the same gate that throws loudly if credentials appear without `ENABLE_X_WRITE`. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"}
- Real-overlap collapse is verified via the `decorateProbe` dev hook rather than a full page walk, because local casts and attestations sit in different persona universes this pass does not bridge. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"}
- Single-viewer migration shape is explicit: multi-account follow graphs are clone-phase scope. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"}
- Tip-epoch close records converge only within a call's own retries, because of the epoch's 409-on-reclose contract; logged as residual, with deterministic ids making a dev-tool re-put safe if ever needed. {cite: notes/reports/REPORT-X.md > "GATE 0 — put-by-id settlement records — CLOSED (4/4) — N/A live/fixture (mock-layer)"}
