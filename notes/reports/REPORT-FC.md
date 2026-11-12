# REPORT-FC — Real Farcaster Pass

Run started 2026-08-27, user AFK — standing instruction: judgment calls,
table blockers, keep building. A 5-hour resume heartbeat (cron `671ddea8`)
is armed for the whole run.

## Env contract, verified at start

- `NEYNAR_API_KEY`: present, **verified live** — `GET /v2/farcaster/user/bulk?fids=3`
  returns real network data (probe run 2026-08-27, HTTP 200)
- `OP_BURNER_PRIVATE_KEY`: **absent** — the onchain Gate 1 fallback is
  unavailable by construction
- `ENABLE_FC_WRITE`: unset (= false). Every sweep in this pass runs with it
  false; nothing writes, nothing spends

Real spend so far: **$0.00**. Network writes so far: **0**.

---

## GATE 1 — Throwaway FID acquisition — TABLED (money decision, per protocol)

Probed before building anything, cheapest-first:

1. **Neynar-sponsored creation**: `GET /v2/farcaster/user/fid` with this
   API key returns `400 {"code":"BadRequest","message":"Missing required
   header: x-wallet-id"}`. Per the Neynar docs (verified via the MCP, not
   memory), account registration — and even the fresh-FID fetch — requires
   an **onchain wallet configured in the Neynar developer portal**
   (docs.neynar.com/docs/managing-onchain-wallets), whose id goes in the
   `x-wallet-id` header and through which the real Optimism costs bill
   (FID registration + first storage unit; the docs' own cost table puts
   FID registration ~$0.20, order-of-a-dollar total — comfortably under
   the $10 abort line IF the wallet exists).
2. **Onchain fallback**: requires `OP_BURNER_PRIVATE_KEY`; absent.

The pass prompt is explicit that this exact fork is the ONE thing that is
not a judgment call: *"if Gate 1 requires choosing between a Neynar plan
upgrade and waiting for a funded burner, stop and ask — that is a money
decision."* User is AFK, so the question is TABLED HERE and the pass
continues in **fixture-write mode with read gates fully live**, exactly as
the prompt prescribes for this branch.

**QUESTION FOR THE USER (answer either, then Gate 1 completes in minutes):**

- **Option A**: log into dev.neynar.com → set up an onchain wallet
  (portal: Managing Onchain Wallets) so the API key can register accounts;
  put the wallet id in `.env.local` as `NEYNAR_WALLET_ID`. Costs bill
  through that wallet (~$1-3 expected, $10 abort line enforced).
- **Option B**: fund a burner EOA with a few dollars of ETH **on
  Optimism** and put its private key in `.env.local` as
  `OP_BURNER_PRIVATE_KEY`. The pass registers the FID directly via the
  IdGateway (addresses verified against current docs at execution time,
  not memory).

Everything downstream (Gates 3-4) is built against the write seam with a
fixture transport, so either answer converts to live writes without
rework: acquire FID → flip `ENABLE_FC_WRITE=true` for the one scripted
live-check invocation → run the recorded live checks.

---

## GATE 0 — Land the UX pass properly — IN PROGRESS

- notes/reports/REPORT-UX.md was closed out at the end of the UX pass (4x239 clean, its
  final-results section written). This gate's remaining substance is the
  systemic fix the prompt names: ONE shared content-completeness retry
  helper, adopted by every suite that has the gap — not the per-suite
  patches b2/a3/a4 got in the interrupted session.
- `scripts/lib-health.mjs` (already imported by every suite) gained two
  primitives: `retryContent(fn, complete, attempts)` — re-run until the
  response HAS the needed content, returning the last result so genuine
  failures still surface through the caller's own assertion — and
  `pollUntil(pred, {tries, delayMs, midway})` — poll-for-confirmed-outcome
  with an optional halfway reload hook.
- A 35-file parallel audit (18 agents, every accept-*/functional/
  restart-survival/root-leak suite read end-to-end, run twice for part of
  the set after a usage-limit interruption — the two independent audits of
  the same files found DIFFERENT subsets, so results were UNION-merged by
  (pattern, line±3) rather than last-write-wins) found **257 candidate
  defects across 30 of 35 files**. Five files came back clean: gate0,
  accept-x0, accept-m4, accept-ux4, root-leak. The audit was spot-verified
  by hand (two findings read against source: both real) before adoption.
- Finding classes, all instances of the same root defect — asserting on a
  snapshot not yet established as final: content-gap (status-only retry
  accepting an incomplete 200 from a per-item-try/catch fan-out route),
  flat-wait (fixed sleep then assert), unchecked-find (latent crash
  dereferencing a dropped item), exact-status asserts unretried (a 2%
  transient 500 read as a privacy leak).
- Adoption: 30 parallel surgical editors, one per flagged file, each
  instructed to VERIFY every finding in situ before applying (skipping a
  wrong finding counts as success), never weaken an assertion (settle the
  data, then run the ORIGINAL assertion), convert the earlier per-suite
  local patches (b2's crosspostFull, a3/a4/ux3 inline polls) to the shared
  helpers, and pass node --check. In flight as of this entry.
- Scripts dir snapshotted to scratchpad (`scripts-backup-gate0`) before
  any refactor — no git in this repo, so the snapshot is the rollback.
- Then: grep-verified adoption, one smoke sweep, then 4 consecutive clean
  sweeps at the 239-check baseline.

---

## GATE 2 — Live reads — BUILT (verification follows Gate 0 sweeps + rebuild)

Implementation landed (source only; the server still runs the pre-Gate-2
build until Gate 0's sweeps bank — `next start` serves the compiled build,
so source edits during sweeps are inert by construction):

- **Runtime source switch**: `setDataSourceOverride` (globalThis, devControls
  discipline), `/api/dev {action:"setDataSource"}`, a Developer-pane toggle
  ("Content source"), `dataSource` surfaced in the registry snapshot.
  resetSeed clears the override, the forced-429 knob, AND the live cache —
  knobs-are-knobs, applied on arrival this time.
- **Degrade, never blank**: the one live transport (`content.ts get()`) now
  does bounded backoff (300/900ms) on 429/5xx/network, then serves from a
  never-evicted stale shelf with an explicit `stale` flag — threaded through
  `LiveResult<T>`, `buildFeed → contentStale`, `/api/feed2`, and a visible
  stale-content banner in the timeline. Definitive 4xx (404) throws
  immediately: an answer is not a hiccup, and stale must not mask it.
- **Coverage**: liveCast, liveConversation (defensive about the
  doc-ambiguous ancestor placement), liveNotifications (no signer needed —
  the phase-1 comment claiming otherwise predated the current API),
  liveChannelFeed, liveTrending, liveChannelList, liveUserByUsername — all
  through the cached/backoff transport, all mapped by the fixture-tested
  contentPure mappers.
- **TWO-LIVE-UNIVERSES TRAP, found and retired**: lib/data.ts still carried
  its own phase-1 Neynar path — a separate fetch (no cache, no backoff, no
  stale), separate duplicate mappers, and a `liveMode` CONST frozen at
  module load that the runtime switch could never reach. All six call sites
  now route through the adapter layer; the 74-line duplicate block is
  deleted; `liveMode` is a function.
- **SAFETY-SET FIND (the sharpest thing this gate turned up)**: the phase-1
  cast route carried a LIVE WRITE path — a raw fetch publishing with
  WHATEVER `NEYNAR_SIGNER_UUID` the env carried: no write ledger, no caps,
  no ENABLE_FC_WRITE check, no throwaway-FID identity check. Exactly what
  the HARD IDENTITY RULE exists to forbid, sitting in a route since phase 1.
  Retired outright with a loud 403 naming the Gate 3 seam as the only door.
- **Mode layer over live**: live casts run through THE rules engine (no
  bespoke filter) with sentinel author fields whose comparisons are all
  false — tier NaN means "a clause about an unknowable field is
  unsatisfied", and a NEGATED author clause therefore hides
  unknown-author casts: hide-when-unsure, the fail-closed direction.
  Mode ranking (recency/engagement weights, calm damping, longform boost)
  reorders live casts with the fields they actually have. Blocklists over
  live arrive with Gate 4 attribution (judgment call logged in the design
  section above).
- **Suite**: `scripts/accept-fc2.mjs` (test:fc2) — 7 checks, sweep-safe:
  the forced-429 knob consumes BEFORE any network call, so the degrade
  paths are deterministic; the one real warm-read is a read (INFRA-classed
  if the network is absent), never a write or spend. Joins the sweep list
  after the Gate 2 rebuild.

### Original design notes

Recon findings (the mega pass left more seam than expected):
- `lib/adapters/neynar/mode.ts`: DATA_SOURCE env switch + `assertWriteAllowed`
  (loud throw, never silent no-op) already exist. Gate 2 adds a RUNTIME
  override (devControls-style globalThis state, cleared by resetSeed per
  ops-discipline rule 4) + a Developer-pane toggle, so live is a session
  switch, not an env restart.
- `lib/adapters/neynar/content.ts`: liveFeed/liveUserCasts/liveUsers/
  liveChannels exist with a 60s TTL cache; 429 currently THROWS with no
  backoff and no stale fallback. Gate 2: bounded backoff on 429, stale
  entries retained for the process lifetime and served on failure with an
  explicit `stale` flag threaded up to a UI indicator — degrade to cache,
  never to a blank feed. Forced-429 test knob goes in devControls (and
  therefore into resetSeed's disarm list — the UX-pass lesson).
- `lib/feed.ts` live branch already composes: live casts as the base,
  private posts/injection queue/moved cards on top. Gate 2 threads mode
  RULES + ranking over live cards: text/engagement/recency fields evaluate
  normally; fields that don't exist for live authors (tier, graph claims)
  evaluate null → clause-not-satisfied, same fail-closed-null semantics the
  evaluator already has. Blocklists-over-live arrive via Gate 4 attribution
  (a blocked persona's ATTRIBUTED casts hide) — a fid-level block of
  arbitrary live strangers would be a new feature invented mid-pass, not
  composition (judgment call, logged).
- Coverage to add: single cast + conversation (thread page), notifications,
  channel feed, trending, user-by-username (profiles). Contracts verified
  and recorded in notes/runbooks/NEYNAR-CONTRACT.md §"Gate 2 additions" (agent-verified
  against Neynar MCP docs 2026-08-28); three ambiguities flagged there need
  one live probe each before coding: conversation cursor placement,
  notifications `priority_mode`, trending `time_window` enums.
- Env naming: this pass's contract says ENABLE_FC_WRITE; the existing seam
  checks ENABLE_WRITE, and accept-m4-runtime greps the refusal message for
  /ENABLE_WRITE/ — which is NOT a substring of ENABLE_FC_WRITE. Decision:
  `writeEnabled()` honors either flag; the refusal message names both.

---

## GATE 3 — Real writes — BUILT, FIXTURE-VERIFIED (live half awaits Gate 1)

The full machinery exists and is under test; only the transport behind the
seam changes when the throwaway FID arrives.

- **The write ledger** (`lib/fc/writeLedger.ts`, safety-set, mirror of the
  X spend ledger): every outbound write opens a PENDING entry before any
  network attempt; outcomes settle it sent/failed. Caps — 10 casts/day, 30
  actions/day, env-overridable — are checked BEFORE the ledger entry
  opens, and a cap hit refuses loudly with zero network attempts after it.
  Refused writes never consume budget (a cap that self-tightens on
  refusals would be its own bug). Persisted namespace: restart-survival
  covers it.
- **HARD IDENTITY RULE** (`assertThrowawayIdentity`): refuses any
  explicitly named fid/signer that is not the Gate 1 throwaway; refuses
  live writes when NO throwaway is configured; and refuses the whole live
  path when a FOREIGN signer credential merely EXISTS in env (a leftover
  NEYNAR_SIGNER_UUID that isn't the throwaway) — a loaded gun nearby is a
  refusal, not a convenience. Tested adversarially via a zero-network
  identity probe.
- **Check-before-retry**: an ambiguous failure leaves the pending entry;
  the NEXT attempt for the same content QUERIES (by content hash within
  the test FID's recent casts) before any second send. The fixture
  transport makes this provable: it COMMITS to a sim "network" first, then
  can be forced to drop the response (`forceFcPublishDrop`) — the exact
  ambiguity a real network produces. The exactly-one assertion reads the
  sim NETWORK, never the ledger's claim about itself.
- **Eventual-consistency + delete**: delete wired and ledgered (advisory —
  hubs/indexers may retain, per the spec's own note). The publish-poll
  "publishing…" UI state belongs to the live transport's first real run.
- Suite: `scripts/accept-fc3.mjs` (test:fc3), 7 checks, all fixture, all
  deterministic.

## GATE 4 — Persona attribution — BUILT, FIXTURE-VERIFIED (live demo awaits Gate 1)

- **The index**: `{castHash → personaId}` recorded AT PUBLISH TIME on the
  one write door (attribution is a fact about a publish, not a separately
  mutable table); retracted on delete; persisted; restart-survival covers
  it resolving after a hard kill.
- **Disclosure gates attribution through the SAME chokepoint as private
  posts** (`canViewPrivate` — one rule, not two): a private-tier persona's
  attribution renders only for granted viewers; a stranger sees the bare
  FID identity even in OUR client. Fail closed in every direction: no
  index row, unknown persona, or a throwing lookup all render the bare
  FID — attribution never guesses.
- **Blocklists compose through attribution**: in the live feed path, an
  attributed cast whose persona the viewer blocked is dropped — the one
  honest way a persona blocklist can apply to live strangers (delivering
  the judgment call Gate 2 logged).
- **Render integration at both layers**: `buildFeed`'s live branch
  decorates attributed casts with persona identity (name/avatar/tier — the
  existing persona chrome, X parity untouched), and `attachPersonaLayer`
  (the classic thread/permalink path) consults the index ahead of its
  phase-1 marker heuristics.
- **Leak surface pinned**: the attribution payload is exactly
  {id, handle, name, avatarUrl, tier, private} — asserted key-for-key in
  the suite, and the route joined root-leak's grep list.
- Suite: `scripts/accept-fc4.mjs` (test:fc4), 6 checks, all fixture.

**What v0 punts to the real anoncast-fork phase** (the delta list, per the
spec): multi-FID; a real signer-per-persona (here one sim/live signer
signs and attribution is index-only — the second signature layer from the
architecture memo is NOT yet built); attribution index as an independent
service (here it lives in the app's validator-persisted store); public
verifiability of attribution (censor-but-not-forge needs the persona
content-signature, which arrives with the persona-key layer).

---

## GATE 0 sweep findings (running log)

- Smoke sweep run 1: **238/239, one failure — and it named a defect
  SUBCLASS the audit's vocabulary missed**: b2's composer cost-note check
  polled for the note element's EXISTENCE, then asserted on its text — but
  the element exists while it still reads "Estimating cost…" (the panel's
  own honest never-show-stale-prices behavior, built in Tier B). Poll-for-
  existence is still a flat-wait in disguise; the rule is poll for the
  SETTLED CONTENT the assertion needs. Fixed with pollUntil over the
  content match; b2 6/6 in isolation; the 4-consecutive count restarted
  from zero per the standing rule. Every other refactored suite passed on
  its first full-sweep outing — 32/33 suites, including m3 (23 findings
  applied) and the twice-audited b4 (15 applied).

---

## LIVE VERIFICATION — Gate 2 (recorded run, reads only)

Run 2026-08-29T06:08Z, `node scripts/live-fc2.mjs`, ENABLE_FC_WRITE unset.
**7/7.** Evidence: `shots/fc-live-home.png`, `fc-live-profile.png`,
`fc-live-thread.png`, `fc-live-notifications.png`, `fc-live-explore.png`.

- Transport probe: real current casts (sample hash
  `0x804d72b42c28c9258919a36df3f8ca72cf2f935d` by @cassie).
- /home rendered 40 live casts with the (persona, mode) header intact;
  live profile, live permalink + conversation, live notifications and
  explore all rendered without blanking or layout breakage.
- Mode-layer-over-live proven via a hideReplies probe mode (membership
  semantics — see the ranking-as-selection note below); the current live
  window carried no replies, so the invariant held vacuously and the run
  says so rather than claiming more than it showed.
- Flip back to seed: persona/grant/mode state untouched.

## THE REVIEW → FIX → RE-REVIEW CYCLE (agent-assisted, all confirmed by code)

A five-lens adversarial review of the untested FC code (findings verified
by skeptic pairs) plus a five-cluster re-review of the fix batch produced
**39 raw findings → ~20 distinct real defects, all fixed** before the
final verification chain. The ones that mattered most:

- **Deduped publish reattributed an existing cast** to whoever asked
  second — including flipping a disclosure-gated PRIVATE attribution
  public. Fixed twice over: the route only writes attribution for
  non-deduped publishes (first-writer-wins, so an ambiguous-failure retry
  can still claim its own cast), and concurrent same-content followers are
  marked deduped at the source.
- **The ledger could report success for a cast the network no longer
  holds** (publish-after-delete; post-restart fixture sim). Fixed:
  a sent-entry dedupe ALWAYS verifies against the network, mode-scoped so
  a preserved live receipt is never "verified" against the fixture sim.
- **The live verify window is bounded** — "not in the window" now REFUSES
  rather than settling a live receipt failed and re-publishing (the
  duplicate the mechanism exists to prevent).
- **A failing verify read fails CLOSED**: the live findByContentHash
  throws on non-OK instead of returning null-as-absence; the publish
  refuses to re-send until the check itself succeeds.
- **Writes armed without identity refuses**: ENABLE_FC_WRITE=true with no
  throwaway creds (or live content with writes off, or a foreign
  NEYNAR_SIGNER_UUID in env) throws loudly on every op — never a fixture
  fake-success.
- **Post-restart ledger reads hydrate first** (the write route read
  state() before any adapter call had hydrated it — empty-ledger caps and
  blind retries).
- **resetSeed preserves live-mode ledger entries** (calendar-day facts
  about real casts) while wiping fixture ones; **definitive 404s evict**
  the stale-cache shelf; **caps are NaN-proof** against typo'd env
  overrides; ambiguous reaction failures hold their cap budget
  (definitive refusals free it).
- **Rendering hardening** (0 crashes found, 6 high silent-wrongness):
  images classified by URL when embed metadata arrives unresolved
  (`{_status:"PENDING"}` — every recorded image embed), quote-cast embeds
  mapped one level deep (dehydrated deleted-cast quotes skipped),
  avatar-less accounts get a self-contained placeholder instead of
  `<img src="">`, live reply rows carry the reply text (not the verb
  phrase), `parentHash` restores hideReplies over live data, and the
  phase-1 persona heuristic gates on per-cast wire provenance
  (`cast.live`) — no more fid-collision re-skinning of real accounts, no
  more marker leaks on fixture fallbacks.
- **Mode ranking over live is WINDOW SELECTION**, matching seeded
  semantics exactly (the demote/recency pass is the one final ordering) —
  the re-review caught the first implementation's ranking being dead code
  and the fix makes the weights decide window membership.

Every fix is pinned by `scripts/accept-fc5-regressions.mjs` (test:fc5,
6/6 + 1 explicit skip: the definitive-404 eviction path needs a live 404
no fixture knob can honestly construct).

## RESTART-SURVIVAL — 27/27

Full write → hard-kill → restart → verify cycle on the final build. The
two new FC checks: the write ledger's sent entry AND the attribution
index resolve after restart; a mid-flight (response-dropped) publish
RESUMES check-before-retry post-restart — pending receipt intact, no
blind retry, exactly one cast for the resumed content.

## GATE 1 PACK — ready for the user's answer

`scripts/gate1-acquire-fid.mjs` (node --check clean, dry-run by default,
$10 hard abort, GATE1_CONFIRM=yes required for anything billable) +
`notes/runbooks/GATE1-RUNBOOK.md` (doc-verified endpoints, contract addresses with
sources, the 10-minute FID reservation rule, per-option user steps).
Notable: the doc-verification discipline caught a wrong from-memory
StorageRegistry address. viem is absent from node_modules — the script
detects and instructs rather than hand-rolling EIP-712 crypto.

---

# /VERIFY — FINAL RESULTS

**4 consecutive clean sweeps: 265/265 passing checks, 0 failed suites, 0
infra, every run.** Failure-detail capture verified writable before run 1
and finished empty. 37 suites (the 33-suite UX baseline + fc2/fc3/fc4/fc5),
fixture mode, ENABLE_FC_WRITE unset throughout. tsc strict clean;
production build clean.

| Gate | Result |
|---|---|
| 0 — Land the UX pass (shared retry helper, 30 suites adopted, grep-verified) | CLOSED |
| 1 — Throwaway FID | TABLED on the user's money answer (the pass's one designated ask); execution pack staged |
| 2 — Live reads first-class | CLOSED — fc2 7/7 fixture + LIVE 7/7 with screenshot evidence |
| 3 — Real writes | CLOSED IN FIXTURE-WRITE MODE — fc3 7/7; ledger/caps/identity/check-before-retry fully proven; live transport staged behind the same seam |
| 4 — Persona attribution | CLOSED IN FIXTURE MODE — fc4 6/6; live side-by-side demo awaits Gate 1 |
| Regression pins | fc5 6/6 (+1 explicit honest skip) |
| Restart-survival | 27/27 |

**Total real spend: $0.00. Total network writes: 0.** Every network
interaction this pass made was a read.

### What runs the moment the user answers Gate 1's question
1. `node scripts/gate1-acquire-fid.mjs neynar` (or `onchain`) — dry-run
   cost sheet, then GATE1_CONFIRM=yes to execute; $10 hard abort.
2. `ENABLE_FC_WRITE=true` for ONE scripted live-check invocation: the
   Gate 3 lifecycle (cast → read-path appearance → reply → like → recast
   → delete, all ledgered, ≤6 writes, run-marker labeled) and the Gate 4
   money shot (two personas' casts side-by-side: our client attributed,
   the public Warpcast URLs bare-FID).
3. Both are additive: nothing in the verified fixture behavior changes.

KNOWN-BROKEN: none. The safety set (identity rule, write ledger + caps,
check-before-retry, labeled test casts, attribution fail-closed, leak
greps) never tripped and nothing shipped degraded.

---

## GATE 1 — CLOSED (2026-08-29). Real FID acquired.

The pass's one tabled money decision is resolved. The user funded a Neynar
app wallet on Optimism and authorized the acquisition; it executed on the
`neynar` path.

**Result — a real, registered Farcaster account:**

| field | value |
| --- | --- |
| FID | `3348985` |
| fname | `layers-test-852c` |
| custody | `0x1683b8556504541ce66544cbc1eeacfcb9184aa1` (throwaway, generated in-script) |
| signer | approved, uuid persisted |
| origin | neynar (sponsored registration) |
| profile | display name "Layers dev test", bio marks it a test account |

Credentials are in `.env.local` (`FC_TEST_*`), private keys written but
never echoed to any log or transcript.

**Spend:** ~$0.35-$0.90 in ETH billed to the app wallet by Neynar, plus 1
credit for the fname check. Under the $10 abort line. Exact ETH figure is
only visible on dev.neynar.com -> App Wallet; this script cannot read that
ledger and does not guess at it.

### What it took — three real defects, two of them mine

1. **Wrong wallet id / wrong-chain funding (user-side, resolved).** An
   initial wallet id mismatch produced `403 Wallet does not belong to this
   app` before any billable call. Funding also had to be on **Optimism**
   specifically (docs: "$5+ ETH on Optimism"); the portal's "Protocol:
   Ethereum" column labels the asset, not the chain, which is a real
   footgun.

2. **A Neynar-side incident.** `GET /v2/farcaster/user/fid` returned the
   same `404 "Account creation has been triggered, retry in 60-90 seconds"`
   on **7 consecutive attempts across hours** — far past the documented
   ~1 minute cold start. Retrying was the wrong instinct; escalating was
   right. Confirmed as an incident by Neynar (rish) in their Slack
   #support-apis-sdks. Cleared on their end, worked on the next attempt.
   **Lesson: an identical error repeated past its own documented window is
   a signal to escalate, not to retry harder.**

3. **`signed_key_request_metadata_signature` was sending the bare
   signature** (my bug). Despite the field name, Neynar wants the
   **ABI-encoded `SignedKeyRequestMetadata` struct** (`requestFid`,
   `requestSigner`, `signature`, `deadline`), which is what
   `getSignedKeyRequestMetadata` returns. The `onchain` path in this same
   script already encoded it correctly at its KeyGateway call — the
   `neynar` path did not. Fixed by mirroring that encoding.
   Error moved `Invalid ... signature format` -> a semantic check, proving
   the encoding was now being parsed.

4. **The chicken-and-egg the fix then exposed.** With valid encoding,
   Neynar rejected `Metadata requestSigner does not match app custody
   address`: the self-owned form (`app_fid` = the new fid) cannot validate
   because that fid does not exist onchain yet, so there is no custody
   address to match. Resolved via the fallback the script already
   documented — register without the signer block. Neynar returned an
   **approved signer anyway**, so no follow-up attach was needed.

5. **Windows/libuv crash-on-exit** (my bug, cosmetic). A synchronous
   `process.exit()` while a `fetch` socket was still closing tripped
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and reported
   exit 127 *after* the real error had already printed. Replaced with a
   `Stop` sentinel + `process.exitCode` so the loop drains naturally.

### Verification

A second read (`gate1-acquire-fid.mjs verify`) confirms the account
settled correctly. Worth noting: the read taken immediately at
registration showed a **different custody address** — Neynar's own,
mid-transfer — and only converged to ours on the follow-up read, along
with the display name. **A single post-write read is not proof of final
state on a network with transfer + indexing lag; re-read until settled.**
This is the same "poll for settled content, not existence" rule this pass
already learned, now confirmed against the real network.

### Still open

Gate 1 delivered the credentials. The **live write verification** (the one
scripted ≤6-write cast -> read -> reply -> like -> recast -> delete
lifecycle, plus the Gate 4 two-personas-one-FID attribution demo against a
public Warpcast URL) has **not been run** — `ENABLE_FC_WRITE` remains
unset and the network write count for this pass is still **0**. That is
the next and final step.

---

## GATES 3 & 4 — LIVE ON THE REAL NETWORK (2026-08-29). Pass complete.

`ENABLE_FC_WRITE=true`, throwaway fid `3348985` (@layers-test-852c).
**8 real network writes total**, every one ledgered before it was sent.

### Gate 3 — the full lifecycle, live (`npm run live:fc3`) — 9/9

6 writes: cast -> reply -> like -> recast -> delete reply -> delete cast.

| check | result |
| --- | --- |
| publish a real cast | `0xa96f540a…` mode=**live** |
| appears in the live read path | polled the network until genuinely present, never assumed from a 200 |
| exactly one cast per run marker | 1, no duplicate |
| our client renders it at its permalink | screenshot |
| reply carries a real parent hash | `0xa7837b9c…` -> parent `0xa96f540a…`, verified on the network |
| like / recast | accepted, mode=live |
| delete both (advisory) | accepted |
| ledger | 6 entries, all `mode=live`, none left pending |

The mid-publish-kill adversarial test stayed **fixture-only** by decision:
it is proven in `accept-fc3.mjs` where an induced duplicate costs nothing,
and running it against the public network would risk minting the very
stray cast it exists to disprove.

### Gate 4 — the attribution asymmetry, live (`npm run live:fc4`) — 9/9

2 writes, one per persona, through the ONE shared FID. **Left up
deliberately** — their public URLs are the evidence.

The same cast hash, two identities:

| | persona A cast | persona B cast |
| --- | --- | --- |
| **our client** | **@yeak__** | **@backyard_scope** (tier badge, private) |
| **farcaster.xyz (public)** | `layers-test-852c` | `layers-test-852c` |

Public URLs (both resolve to the one bare fid):
`farcaster.xyz/layers-test-852c/0xb1d02078` and `…/0xa9c86414`

Disclosure held in both directions: viewing as A, persona B's private
attribution returned **null — bare FID even inside our own client**;
viewing as B, it disclosed. Unknown hash -> null, never a guess.

Screenshots: `shots/fc-live-attr-{ours,public}-{a,b}-*.png`.

### Three defects this leg found

1. **Replies were published as top-level casts (live only).** The live
   transport never passed a `parent`, so `publishFcCast(text, "reply")`
   produced a standalone cast that returned 200 and looked like success.
   Invisible to every fixture test because **no suite exercised `reply`
   at all**. Fixed: `parent` threaded through the transport, the route
   now 400s on a reply with no `parentHash`, and the live check asserts
   the landed cast's `parent_hash` rather than trusting the response.

2. **Reply content-hashing collided.** Dedupe keyed on text alone, so the
   same words replied under two different parents would hash identically
   and the second would be silently "deduped" into the first and never
   posted. Fixed with `fcContentHash(text, parent)`; the live verify
   recomputes each candidate's hash from ITS OWN `parent_hash` so a reply
   matches the reply and not a same-text top-level cast.

3. **Two suites asserted the absence of credentials.** Written pre-Gate-1,
   `accept-fc3` and `accept-fc5` asserted `throwawayConfigured === false`.
   Gate 1 legitimately made that false. The safety invariant for sweeps is
   that writes are **disarmed** (`writeEnabled === false`), NOT that
   credentials are absent — creds-present + writes-disabled is the correct
   post-Gate-1 state. Assertions corrected to test the property that
   actually guards anything; the identity-rule test now adapts to either
   environment and additionally pins the unconditional half (a foreign fid
   or foreign signer always refuses).

### Two vacuity traps caught in my own tests, before trusting them

Both are the same lesson this pass keeps re-learning — *poll for settled
content, and make sure a passing assertion could actually have failed*:

- **A9 could have passed on a 404.** "The public page contains no persona
  handle" is trivially true of an error page. It now asserts the run marker
  and the shared fname are ON the page *before* asserting the absence of
  the persona handle.
- **A8 screenshotted without asserting.** It now requires each cast to
  render its own persona and the two to differ.
- **A7 was a false positive, not a leak.** The substring scan flagged
  `"seed"` — from `dicebear.com/…?seed=yeakmain`, a public avatar-generator
  parameter. Replaced with a key allowlist (which also catches any *future*
  field added to the payload) plus a key-material value scan.

### Final state

- Server **disarmed** after the run: `writeEnabled=false`, credentials
  retained. Creds-present + writes-disabled is the intended resting state.
- The write ledger **survived the restart** carrying its real live
  receipts: `today=10, casts=6` of caps 30/10.
- Deletes are advisory: hubs and indexers may retain the Gate 3 content
  regardless of the accepted delete calls. Reported, not claimed away.

---

## THE BUG THE SWEEP FOUND — shared cap budget across two universes

Every FC suite passed **individually** after the live run. The full sweep
then failed three of them. That gap is the whole argument for the
4-consecutive-sweep protocol: the defect only exists once real live
receipts are on disk, which had never been true before today.

**What happened.** `resetState()` deliberately preserves `mode:"live"`
ledger entries across `resetSeed` — they are calendar-day facts about the
real public network and destroying them would free real cap budget and
lose receipts for casts still standing publicly. Correct on its own. But
cap accounting was **unscoped**, so the 6 real casts and 10 real actions
from the live run permanently occupied today's budget:

```
fc3  expected 1 sent cast entry, got 6
fc3  429 daily cast cap: 10 of 10 used
fc4  429 daily cast cap: 10 of 10 used
fc5  ledger counts 8 casts, expected 2
```

Fixture tests were being refused by a cap that real writes had already
spent — and worse, a day of ordinary live use would have starved the
fixture write path entirely.

**The fix: mode-scope the caps**, the same universe-scoping rule already
established in this codebase for check-before-retry (`prior.mode ===
t.mode`). The cap exists to bound writes to the REAL public network; a
fixture write reaches no network at all, so counting it against the live
budget protected nothing while quietly consuming it.

- `countedToday(mode?)` and `assertFcWriteAllowed(kind, mode)` are scoped.
- The mode parameter **defaults to `"live"`** — a caller that forgets is
  capped, never uncapped. Fail closed.
- `ledgerSummary()` now reports `fixture` and `live` counts separately,
  because one total cannot describe what is actually allowed next.
- Live writes remain capped exactly as before: 10 casts / 30 actions.

**A test got stronger, not weaker.** fc5's reset test asserted that ALL
ledger entries vanish, and carried a note saying the live-preservation
half "cannot be exercised without live credentials, which this sweep
environment must never hold." Gate 1 made that untrue. Rather than relax
the assertion to tolerate surviving entries, it now asserts **both** halves
of the reset contract: fixture entries wiped, live receipts preserved in
exact count. A contract that was a written note for the whole pass is
finally a real assertion.

Suites that read ledger counts were pointed at `ledger.fixture.*`, and
entry filters scoped to `mode === "fixture"` — they were always asking
about the fixture universe, they had simply never had another one to be
confused by.
