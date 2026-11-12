# REPORT-X — X Interop Pass

## REALITY

| Signal | State | Consequence |
|--------|-------|-------------|
| X_API_* env vars | ABSENT | all live gates run FIXTURE-VERIFIED |
| /imports archive ZIP | ABSENT | Gate 2 constructs a fixture archive matching X's export structure |
| ENABLE_X_WRITE | unset (false) | live adapter publish() throws loudly; no live-write tests |

Nothing in this pass spent real money: **total real spend $0.00**.

## GATE 0 — put-by-id settlement records — CLOSED (4/4) — N/A live/fixture (mock-layer)

The Tier B filed limitation closed: settle.record accepts a client-supplied
`recordId`; the mock implements put-by-id (same id → same record, exactly
once). All InfoFi call sites derive ids from escrow + terminal state
(`rec_<escrowId>:<terminal>`, pot records `rec_pot:<chan>:<epoch>:<persona>`),
and every retry path RE-PUTS:

- recordDwell's idempotent path re-puts the read record
- sweepDms converges records for already-slashed DMs on later sweeps

Proven: persistent record failure (3 forced) → 503 loud, ledger settled,
zero records → later client retry → exactly ONE record; a further retry
stays at one. Transient recovery still exactly-once. Legacy no-recordId
call sites unchanged (minted ids). Money-invariant suite (b3) still 7/7.

Residual (logged): tip-epoch close records converge only within the call's
own retries — the epoch's 409-on-reclose contract (b3 t6) blocks a re-entry
path. Ids are deterministic, so a dev-tool re-put is safe if ever needed.

## GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED

OAuth 2.0 PKCE behind an adapter (lib/x/oauth.ts): fixture plays a recorded
exchange whose shapes match X API v2 (token response, users/me); live impl
hits real endpoints and constructs only when X_API_CLIENT_ID exists. Every
response carries its mode — test 1 asserts "fixture" so a silent
conflation is a FAILURE.

- Attestation: { platform:"x", handle, personaId, verifiedAt, method,
  proofRef } — proofRef is a REFERENCE (users/me:<id>), never token
  material (test-asserted).
- One persona per handle (409); private personas refused at the adapter
  (403, Tier B convention); unlink removes attestation + destination
  binding, restores the mock binding, frees the handle, and tombstones it
  so Gate 2 imports can render "source unlinked".
- Attested handle replaces x_mock with the real "x" destination for THAT
  persona only. The X destination adapter registered with honest
  capabilities; publish() THROWS while ENABLE_X_WRITE is unset. Costs come
  from lib/x/ratecard.json (one-edit updates, lastVerified carried).
- zkTLS upgrade path documented: method "oauth" | "web-proof" on the shape.
- Judgment call: fixtureHandle is a dev-only input simulating WHICH X
  account authorized; live mode ignores it.

Regression: b2 6/6 (binding interplay), root-leak clean over 37 payloads
(link surface included).

## GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED

No real archive in /imports; the constructed fixture matches X's export
structure exactly (data/ account.js, tweets.js, like.js, bookmark.js,
following.js, personalization.js in the window.YTD.<name>.partN format),
with account ids derived identically to the OAuth fixture so
attestation↔archive identity checks are real.

- Per-file streaming ingestion (client parses and posts file-by-file —
  archives run to hundreds of MB); sessions persist server-side, so refresh
  AND restart resume. The ZIP itself is never retained — only what the
  chosen lanes admitted.
- Preview counts === landed counts, asserted per lane (posts 5, likes 3,
  bookmarks 2, following 4, personalization 3 benign + 3 sensitive held).
- ORIGINAL timestamps preserved — the March 2022 post renders dated 2022 on
  the profile's "Imported from X" shelf; imports are HISTORY, never fresh
  feed content (adversarially asserted against the discovery feed).
- Verified badging is EARNED: archive handle must match the persona's OAuth
  attestation, else "unverified import" (self-supplied archives say so).
- Following list at rest: HASHED platform ids only — asserted by grepping
  the validator's actual SQLite state for the raw fixture ids.
- Sensitive personalization items (health/politics/finances classification,
  deliberately broad) queue behind the EXISTING per-category graph consent:
  they appear NOWHERE until opt-in, direct import without consent is a 409,
  and consenting to one category imports exactly that category.
- Benign interests land as claims with source "x-inferred" — a third
  provenance, never conflated with self-declared or attested.
- Bookmarks land in a real "X import" bookmark folder (the folder system
  already carries heterogeneous items; imported bookmarks ride the same
  slot as algo cards).
- Idempotent: re-importing the same archive lands zero new records
  (composite persona+platform-id keys — found and fixed a first-draft bug
  where two personas importing the same archive would fight over records).

Judgment calls: "imported from X tab" rendered as a clearly-headed profile
section rather than an interactive tab (X visual parity of the tab row
untouched); sensitive classification over-gates on purpose (one extra
opt-in click beats one silent sensitive import).

## GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)

THE SPEND LEDGER (lib/x/spend.ts) — the first file where a bug costs real
money, so the discipline is structural, mirror-image of the escrow ledger:
every costed call records through this one file (grep-pinned), caps check
BEFORE the call, refusals are loud 402s that never queue-and-retry.

- Caps: per-action confirm above $0.10 (the composer renders the confirm
  control; the server enforces regardless), per-day $2, per-run $1 — all
  env-overridable, all from one config.
- The adversarial 50-send loop: exactly 5 sends land before the $1 run cap
  (5 × $0.195), 45 loud refusals, ZERO sends after the first refusal; a
  fresh run frees the run cap but the day cap still binds at $2 exactly.
- Double-post guard: publish idempotency keys (x:castHash) with
  check-before-retry — injected failure + client retry converges to ONE
  external ref and ONE spend entry; a deliberate duplicate returns the SAME
  ref marked deduped. The dedup path also converges the crosspost record
  and event if the first attempt died between publish and logging.
- Rate card: lib/x/ratecard.json with lastVerified — updating rates is one
  edit, and the composer shows "(rates verified 2026-08-01)" on the
  estimate so a stale card is visible, not silent.
- ENABLE_X_WRITE gates REAL writes only: with credentials present and the
  flag off, publish throws loudly (Neynar write convention); fixture mode
  runs the full lifecycle so the contract stays testable without spending.
- Owned-reads sync: on-demand button (no background polling), incremental
  via cursor (second sync pulls zero), every request through the ledger at
  the read rate; refuses without a linked account.
- Collapse uses REAL overlap where the following import provides it: the
  viewer's hashed migration source contains the author's attested platform
  id → one copy + chip; no import → both copies. Verified through the
  exact rendering function the classic feed calls (decorateProbe dev hook —
  local casts author as session personas while attestations land on seeded
  personas, so page staging is unreachable; page-level chip rendering is
  covered in b2 t5). Judgment call, logged.
- Fixture spend entries run the identical ledger mechanics; the live total
  (mode:"live") is $0.00 and check 8 reports the live-write skip
  explicitly.

## GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED

- Matching consults ACCOUNT ATTESTATIONS only, keyed on hashed platform ids
  (X archives carry accountId, not handles — the Gate 1 judgment call pays
  off here). The adversarial test plants a self-declared handle as a graph
  claim and harvests exactly zero follows.
- Batch: "N of your X follows are here" → one confirm → follows executed,
  each an edge event with context "x-migration". Already-followed matches
  clear from pending without a duplicate edge.
- Non-matches stay a hashed pending list — asserted at rest (validator
  SQLite) AND on the wire (the migrate surface carries counts and handles,
  never hashes or raw ids).
- Deferred: a NEW attestation fires matching pending entries — the follower
  gets "@handle just joined — auto-followed from your X list", the joiner
  gets "N people were waiting for you" (count asserted exact), both through
  the injection queue as tenant "x_migration" with their own reserved floor
  (the Tier B reservation machinery, reused). Controls: deferred on/off and
  an excluded-handles list, both proven to suppress.
- Follows land via the same setFollowing + logEdgeEvent path as the follow
  button. Judgment calls: single-viewer shape (the follow delta is the seed
  viewer's — migration runs for the persona that imported); deferred
  defaults ON for the demo moment.

## THE DELTA LIST — what Instagram/TikTok adapters inherit vs must build

What the DestinationAdapter + this pass ABSORBED (write once, reuse):

- The destination contract itself (capabilities/publish/costEstimate) and
  the degradation preview === delivered discipline — proven against two
  mocks and the X adapter.
- The spend ledger, caps, confirm threshold, publish idempotency keys, and
  check-before-retry — lib/x/spend.ts is platform-generic in mechanics;
  only the rate card is X's.
- Account attestations (platform/handle/platformUserId/method/proofRef),
  one-persona-per-handle, private-persona refusal, unlink semantics with
  the source-unlinked tombstone. The `platform` field is already a
  discriminator; a second platform is a new value, not a new shape.
- The import session machinery: per-file streaming ingestion, resumable
  sessions, preview===landed counts, composite-key idempotency, verified
  badging against attestations, sensitive-item gating through per-category
  graph consent, hashed-only migration source.
- Follow migration + deferred auto-follow, including the injection-queue
  tenancy and the notices — keyed on hashed platform ids, platform-blind.

What is X-SPECIFIC (each new platform builds its own):

- OAuth endpoints/scopes and the users/me shape (lib/x/oauth.ts): Instagram
  is Meta Graph API OAuth with its own token exchange; TikTok is its own
  OAuth2 with open_id instead of numeric user ids.
- The archive parser (lib/x/archive.ts): window.YTD.*.partN is pure X.
  Instagram exports JSON-in-ZIP with a different tree; TikTok exports JSON
  or TXT. Each is ~one parser file mapping onto the SAME lane types.
- The rate card and its capabilities row (Instagram/TikTok currently price
  differently or not at all — the card structure carries them regardless).
- The sensitive-category mapping for each platform's ad-interest taxonomy.
- Overlap semantics: X overlap keys on the following import; Instagram
  would key on its own follow export; the viewerOverlaps hook takes a
  destination id and already branches per platform.

## KNOWN-BROKEN (X interop)

Nothing. All five gates closed green with no plateau invocations:
x0 4/4 · x1 8/8 · x2 8/8 · x3 8/8 · x4 6/6. Restart-survival 19/19
(attestations, committed + MID-FLIGHT imports, spend ledger with its
idempotency map converging across the restart, hashed pending list).
Root-leak clean over 40 payloads including every new X surface.

Design limitations logged (working as intended):

- Live-write path unreached: no credentials exist. The publish gate throws
  loudly if credentials appear without ENABLE_X_WRITE; the live fetch path
  itself is a stub behind that gate and is Gate-3-of-the-live-pass work.
- Real-overlap collapse is verified through the rendering function (the
  decorateProbe hook) rather than a full page walk — local casts author as
  session personas while attestations land on seeded personas, an identity
  split this pass does not bridge. Page-level chip rendering is covered by
  the Tier B suite.
- Single-viewer migration shape: the follow delta is the seed viewer's, so
  migration executes for the importing persona only. Multi-account follow
  graphs are clone-phase scope.

## TOTAL REAL SPEND

$0.00. Every ledger entry carries mode:"fixture"; the live total
(mode:"live") is zero, asserted in x3 check 8 and again in every sweep.

## FINAL VERIFICATION — THE RECORD

**4 consecutive clean sweeps, first attempt**: 187/187 · 187/187 · 187/187
· 187/187 across all 28 suites (the full legacy baseline through Tier B
plus x0–x4), warmed server, detail capture verified before run 1, sweeps
run with ENABLE_X_WRITE unset — nothing spent, nothing posted. tsc strict
clean, production build clean.

## X INTEROP — CLOSED

| Gate | Scope | Result | Mode |
|------|-------|--------|------|
| 0 | put-by-id settlement records | 4/4 | mock-layer |
| 1 | Account linking (OAuth PKCE → attestations) | 8/8 | FIXTURE-VERIFIED |
| 2 | Archive import (4 lanes + sensitive gate) | 8/8 | FIXTURE-VERIFIED |
| 3 | Live destination + spend controls (safety set) | 8/8 | FIXTURE-VERIFIED, live-write SKIPPED |
| 4 | Follow migration + deferred auto-follow | 6/6 | FIXTURE-VERIFIED |

Restart-survival: 19/19. Root-leak: clean, 40 payloads. KNOWN-BROKEN:
none. Iterations: 7 of 14 budgeted. **Total real spend: $0.00.**

Unlike Tier B's final verification (three sweep sets to get a clean four),
this set went clean on the first attempt — the reset contract, retry
discipline, zombie-server checks, and process-tree hygiene that pass paid
for are now just how the harness works.
