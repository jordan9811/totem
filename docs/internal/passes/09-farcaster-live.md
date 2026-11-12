---
title: "Real Farcaster Pass"
pass: 09-farcaster-live
report: notes/reports/REPORT-FC.md
date: 2026-08-29
status: SHIPPED
---

# Real Farcaster Pass

> Written from `notes/reports/REPORT-FC.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Gate 0: a shared content-completeness retry helper (`retryContent`, `pollUntil`) adopted across 30 of 35 accept-*/functional/restart-survival/root-leak suites, replacing earlier per-suite local patches. {cite: notes/reports/REPORT-FC.md > "GATE 0 — Land the UX pass properly — IN PROGRESS"}
- **[SHIPPED]** Gate 2: live reads promoted to first-class — a runtime data-source override that is a session switch rather than an env restart, bounded backoff plus a never-evicted stale shelf with an explicit `stale` flag, and coverage across live casts, conversations, notifications, channel feed, trending, channel list, and user-by-username. {cite: notes/reports/REPORT-FC.md > "GATE 2 — Live reads — BUILT (verification follows Gate 0 sweeps + rebuild)"}
- **[SHIPPED]** The mega pass's duplicate phase-1 Neynar path — a separate fetch with no cache, no backoff, and a `liveMode` const frozen at module load — was found and retired; all six call sites now route through one adapter layer. {cite: notes/reports/REPORT-FC.md > "GATE 2 — Live reads — BUILT (verification follows Gate 0 sweeps + rebuild)"}
- **[SHIPPED]** Live casts run through the same rules engine and mode ranking as seeded content, with sentinel author fields evaluating false so an unsatisfiable clause hides unknown-author casts — the fail-closed direction. {cite: notes/reports/REPORT-FC.md > "GATE 2 — Live reads — BUILT (verification follows Gate 0 sweeps + rebuild)"}
- **[SHIPPED-FIXTURE]** Gate 3: a write ledger mirroring the X spend ledger (pending-before-network, settle sent/failed, caps checked before the ledger opens), a HARD IDENTITY RULE refusing any non-throwaway fid/signer or a merely-present foreign signer credential, and check-before-retry via content-hash query. {cite: notes/reports/REPORT-FC.md > "GATE 3 — Real writes — BUILT, FIXTURE-VERIFIED (live half awaits Gate 1)"}
- **[SHIPPED-FIXTURE]** Gate 4: a `{castHash → personaId}` attribution index recorded at publish time, disclosure gated through the same `canViewPrivate` chokepoint as private posts, and blocklists composing through attribution in the live feed. {cite: notes/reports/REPORT-FC.md > "GATE 4 — Persona attribution — BUILT, FIXTURE-VERIFIED (live demo awaits Gate 1)"}
- **[SHIPPED]** Gate 1 closed: a real, registered Farcaster account acquired live (FID 3348985, fname layers-test-852c) via Neynar-sponsored registration, credentials written to `.env.local`, private keys never echoed to any log or transcript. {cite: notes/reports/REPORT-FC.md > "GATE 1 — CLOSED (2026-08-29). Real FID acquired."}
- **[SHIPPED]** Gate 3 live: the full 6-write lifecycle (cast, reply, like, recast, delete reply, delete cast) run against the real network, 9/9, with the reply's real parent hash verified on the network. {cite: notes/reports/REPORT-FC.md > "Gate 3 — the full lifecycle, live (`npm run live:fc3`) — 9/9"}
- **[SHIPPED]** Gate 4 live: two personas' casts published live through the one shared throwaway FID, the client showing attributed identities while the public Warpcast/farcaster.xyz URLs both show the bare fid — disclosure held correctly in both directions. {cite: notes/reports/REPORT-FC.md > "Gate 4 — the attribution asymmetry, live (`npm run live:fc4`) — 9/9"}
- **[SPECCED]** What v0 punts to the real anoncast-fork phase: multi-FID support, a real signer-per-persona (a second signature layer), an independent attribution-index service, and public verifiability of attribution. {cite: notes/reports/REPORT-FC.md > "GATE 4 — Persona attribution — BUILT, FIXTURE-VERIFIED (live demo awaits Gate 1)"}
- **[KNOWN-BROKEN]** none — the safety set (identity rule, write ledger and caps, check-before-retry, labeled test casts, fail-closed attribution, leak greps) never tripped, and nothing shipped degraded. {cite: notes/reports/REPORT-FC.md > "/VERIFY — FINAL RESULTS"}

## What it found

- A 35-file parallel audit (18 agents, two independent passes union-merged) found 257 candidate defects across 30 of 35 files, all of one root class: asserting on a snapshot not yet established as final. {cite: notes/reports/REPORT-FC.md > "GATE 0 — Land the UX pass properly — IN PROGRESS"}
- A phase-1 cast route carried a live write path with no ledger, no caps, no `ENABLE_FC_WRITE` check, and no identity check — exactly what the hard identity rule exists to forbid, sitting in a route since phase 1. {cite: notes/reports/REPORT-FC.md > "GATE 2 — Live reads — BUILT (verification follows Gate 0 sweeps + rebuild)"}
- A five-lens adversarial review plus a five-cluster re-review of the fix batch produced 39 raw findings collapsing to about 20 distinct real defects, all fixed before final verification. {cite: notes/reports/REPORT-FC.md > "THE REVIEW → FIX → RE-REVIEW CYCLE (agent-assisted, all confirmed by code)"}
- Deduped publish could reattribute an existing cast to whoever asked second, including flipping a disclosure-gated private attribution public. {cite: notes/reports/REPORT-FC.md > "THE REVIEW → FIX → RE-REVIEW CYCLE (agent-assisted, all confirmed by code)"}
- The ledger could report success for a cast the network no longer holds (publish-after-delete, post-restart fixture sim); fixed by always verifying a dedupe against the network. {cite: notes/reports/REPORT-FC.md > "THE REVIEW → FIX → RE-REVIEW CYCLE (agent-assisted, all confirmed by code)"}
- Neynar's `GET /v2/farcaster/user/fid` returned the same "retry in 60-90 seconds" 404 on 7 consecutive attempts across hours, past its own documented window — confirmed as a real incident by Neynar support, not something retrying harder would fix. {cite: notes/reports/REPORT-FC.md > "What it took — three real defects, two of them mine"}
- `signed_key_request_metadata_signature` was sending the bare signature instead of the ABI-encoded `SignedKeyRequestMetadata` struct Neynar actually wants. {cite: notes/reports/REPORT-FC.md > "What it took — three real defects, two of them mine"}
- A single post-write read showed a different, Neynar-owned mid-transfer custody address than the final one — proof that one read is not proof of final state on a network with transfer and indexing lag. {cite: notes/reports/REPORT-FC.md > "Verification"}
- Replies were published as top-level casts in live mode only, because the live transport never passed a `parent` — invisible to every fixture test since no suite exercised `reply` at all. {cite: notes/reports/REPORT-FC.md > "Three defects this leg found"}
- Reply content-hashing keyed on text alone, so identical reply text under two different parents would collide, and the second reply would be silently deduped away and never posted. {cite: notes/reports/REPORT-FC.md > "Three defects this leg found"}
- Two suites asserted the absence of credentials rather than the disarming of writes, which Gate 1 legitimately broke; corrected to test the property that actually guards anything. {cite: notes/reports/REPORT-FC.md > "Three defects this leg found"}
- The full sweep found a shared cap budget across two universes: `resetState()` correctly preserves live-mode ledger entries across reset, but cap accounting was unscoped, so 6 real live casts permanently occupied the fixture suites' daily cap and would have starved ordinary fixture testing. {cite: notes/reports/REPORT-FC.md > "THE BUG THE SWEEP FOUND — shared cap budget across two universes"}

## Judgment calls

- Env naming: this pass's contract says `ENABLE_FC_WRITE` while the existing seam checked `ENABLE_WRITE`; `writeEnabled()` now honors either flag and the refusal message names both. {cite: notes/reports/REPORT-FC.md > "Original design notes"}
- A fid-level block of arbitrary live strangers would be a new feature invented mid-pass, not composition, so blocklists over live only hide a blocked persona's attributed casts. {cite: notes/reports/REPORT-FC.md > "Original design notes"}
- The mid-publish-kill adversarial test stayed fixture-only by decision, since running it against the public network would risk minting the very stray cast it exists to disprove. {cite: notes/reports/REPORT-FC.md > "Gate 3 — the full lifecycle, live (`npm run live:fc3`) — 9/9"}
- The cap-scoping fix defaults the mode parameter to `"live"`, so a caller that forgets to scope is capped, never uncapped — fail closed. {cite: notes/reports/REPORT-FC.md > "THE BUG THE SWEEP FOUND — shared cap budget across two universes"}

## Verification result

- 4 consecutive clean sweeps: 265/265 passing checks, 0 failed suites, 0 infra, every run, across 37 suites; tsc strict clean, production build clean. {cite: notes/reports/REPORT-FC.md > "/VERIFY — FINAL RESULTS"}
- Live verification of Gate 2 (reads only): 7/7, with screenshot evidence across home, profile, thread, notifications, and explore. {cite: notes/reports/REPORT-FC.md > "LIVE VERIFICATION — Gate 2 (recorded run, reads only)"}
- Restart-survival 27/27, including a mid-flight, response-dropped publish resuming check-before-retry post-restart with exactly one cast for the resumed content. {cite: notes/reports/REPORT-FC.md > "RESTART-SURVIVAL — 27/27"}
- Live Gate 3: 9/9, 6 real network writes, all ledgered `mode=live`, none left pending. {cite: notes/reports/REPORT-FC.md > "Gate 3 — the full lifecycle, live (`npm run live:fc3`) — 9/9"}
- Live Gate 4: 9/9, 2 real network writes, disclosure held correctly in both directions when viewing as either persona. {cite: notes/reports/REPORT-FC.md > "Gate 4 — the attribution asymmetry, live (`npm run live:fc4`) — 9/9"}
- Total real spend: ~$0.35-$0.90 in ETH billed for the one Gate 1 FID acquisition, under the $10 abort line; every other network interaction this pass made was a read. {cite: notes/reports/REPORT-FC.md > "GATE 1 — CLOSED (2026-08-29). Real FID acquired."}
- Final state: the server was disarmed after the live run (`writeEnabled=false`, credentials retained); the write ledger survived restart carrying real live receipts (today=10, casts=6, of caps 30/10). {cite: notes/reports/REPORT-FC.md > "Final state"}

## Assumptions and open items

- `OP_BURNER_PRIVATE_KEY` is absent, so the onchain Gate 1 fallback is unavailable by construction; the Neynar-sponsored path was used instead once the user answered the money question. {cite: notes/reports/REPORT-FC.md > "Env contract, verified at start"}
- Gate 1 was tabled as the pass's one designated money decision per protocol, with two options (a Neynar app wallet vs. a funded burner) staged so either answer converts to live writes without rework. {cite: notes/reports/REPORT-FC.md > "GATE 1 — Throwaway FID acquisition — TABLED (money decision, per protocol)"}
- Deletes are advisory: hubs and indexers may retain content regardless of the accepted delete calls. {cite: notes/reports/REPORT-FC.md > "Final state"}
- The live half of Gate 4 — the two-personas-one-fid attribution demo against a public Warpcast URL — was staged behind Gate 1 and required the user's funding answer to proceed. {cite: notes/reports/REPORT-FC.md > "Still open"}
- fc5's one explicit honest skip: the definitive-404 cache-eviction path needs a live 404 that no fixture knob can honestly construct. {cite: notes/reports/REPORT-FC.md > "THE REVIEW → FIX → RE-REVIEW CYCLE (agent-assisted, all confirmed by code)"}
