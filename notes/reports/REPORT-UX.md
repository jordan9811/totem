# REPORT-UX — Experimental + UX Pass

## Judgment calls (standing, this pass)

- Read notes/reports/REPORT-X.md and notes/reports/REPORT-B.md first, per the prompt. DestinationAdapter,
  attestation shapes, and the import/spend/migration machinery from those
  passes are reused verbatim wherever this pass touches X interop, never
  re-derived.
- "roadmap-v4 missing → the prompt is the operative spec" (carried forward
  from Tier A/B): same stance here — this file's gates are read as complete
  and authoritative.

---

## GATE 0 — Import behavior fix — CLOSED (6/6)

**Premise correction (logged, not silently ignored):** the prompt's framing
("imported X posts currently may surface as fresh feed content") does not
match the codebase — the X pass built imports as history-only from the
start (lib/feed.ts's buildFeed never read xImportedPosts; x2 test 2
adversarially asserted zero feed leakage). The actual gap was the missing
half: no resurface toggle existed at all. Built that half, plus the
adversarial proof the prompt asks for.

- `ImportedPost` gains `resurfaced: boolean` (default false) and
  `resurfacedAt: number | null`. `createdAt` (the original X date) is never
  touched by resurfacing in either direction — the "Imported from X" shelf
  is provably unaffected.
- Resurfacing rides the SAME injection-queue mechanism as "sent" cards: a
  new FeedCard kind `"resurfaced"`, its own tenant (`x_resurfaced`), capped
  at 3 per build so a resurfacing spree can't become the whole timeline.
  Rendered with an explicit "Resurfaced from your X import" attribution
  line — the pass's provenance-never-silently-blended discipline extended
  inline instead of confined to the profile shelf.
- Per-post and bulk toggle (`ResurfaceToggle`, `ResurfaceAllControl`),
  owner-only. Idempotent against re-import: re-importing the identical
  archive preserves whatever resurface state the user already chose
  (found and fixed in the first draft — the naive idempotent-write would
  have silently reset it).
- **Bug found and fixed, unrelated to the feature itself**: `isOwn` on the
  profile page was computed from `SEED_VIEWER.personas.includes(seeded.id)`
  — a fixed root-family membership check that ignores View-As entirely.
  Visiting yeak__'s own profile while viewing-as ANY other persona still
  read `isOwn=true`, incorrectly hiding FacetFollow/BlockPersonasButton
  (and now the resurface controls) from an acting persona that should see
  them. Not a leak (the API layer keys on `activeSeedPersonaId()`
  regardless, so no wrong-account mutation was possible — only UI
  clutter/suppression), but a real correctness bug in the disclosure
  model's core interaction. Fixed to `seeded.id === activeSeedPersonaId()`
  — the same identity View-As already governs everywhere else. Found by
  the Gate 0 visitor-sees-no-controls adversarial check; regression-swept
  clean (x2, x4, legacy accept, functional all still green).

Exit criteria: import→zero feed entries (asserted against BOTH discovery
and following) ✓; resurface→exactly one entry at current timestamp ✓;
original history view unaffected (createdAt never mutates) ✓.


## GATE 1 — Persona × mode matrix, act-as-any-persona — CLOSED (13/13)

**Premise correction (logged)**: the prompt frames the "hexagon-menu
interaction" as "already prototyped" — it does not exist anywhere in the
codebase (grepped for hexagon/long-press, zero hits). Built the act-as
affordance as a new item in the existing cast kebab menu (`···` →
"Act as…") instead — "long-press" is a mobile gesture with no clean desktop
equivalent anyway; a menu item is the honest analog. Money-shot screenshot
target unaffected (the picker itself is what's being shown, not the
trigger gesture).

### The two binding directions

- **Mode swipe, no persona switch**: active-mode tracking was ALREADY keyed
  per-persona (`activeModeByPersona`, from the mega-pass) — the missing
  piece was purely the UI. `ModePill` grew swipe arrows that cycle a
  FILTERED set: the current persona's own modes, MINUS any pinned to a
  DIFFERENT persona (those stay reachable from the existing dropdown, where
  picking one is a deliberate mode-AND-persona choice, never a same-persona
  swipe). The header shows "@handle · ModeName" together, always.
- **Mode → forced persona**: `pinnedPersonaId` already existed
  (mega-pass) with enforcement in `/api/modes/active`. Extended: the
  pinned persona is now ALSO marked as having an explicit override for
  that mode, so switching away and back can't let their own default-mode
  binding silently displace the mode the user just deliberately picked.
- **Persona → default mode**: new (`personaDefaultMode` map). Applied
  ONLY on an explicit persona switch (`/api/seed-persona`), never on a
  read — same "applied once, at the deliberate moment" discipline the
  pin enforcement already established.
- **"More specific wins"**: a new ephemeral (non-persisted, `globalThis`-
  scoped, cleared by resetState — same discipline as marketClock's offset)
  session module tracks personas with an explicit in-session mode pick.
  While marked, NEITHER the default-mode binding NOR an activation rule
  may override the user's own choice, for the rest of the session.
- **Time/context auto-switch**: reuses the EXISTING rules evaluator
  verbatim (ARCHITECTURE.md's "no feature grows its own bespoke filter
  logic") — one new field, `clock.hourUTC`, reads `marketClock.now()`
  (the same controllable clock every timed feature in this project uses).
  Off by default even when a rule is saved (`activationEnabled` is a
  separate switch). No background scheduler exists anywhere in this app
  (on-demand-first is standing policy), so the rule is checked lazily, at
  the one point that already runs on every feed load — the top of
  `buildFeed`, skipped entirely when previewing a candidate mode (a preview
  must render exactly the candidate, never an auto-switched substitute).

### Act-as-any-persona

- **The trust boundary**: `/api/actions/act-as` accepts `asPersonaId` in
  the body but validates it against `SEED_VIEWER.personas` — the EXACT
  allowlist `/api/seed-persona` already uses for real persona-switching.
  Documented explicitly, matching the existing cast/private-post routes'
  own stated threat model ("who is acting is decided server-side, never
  from the request body") — widening WHICH of your own personas can act
  per-request is not the same as trusting the client's account of who it
  is. Adversarial test: a persona outside that allowlist is refused (403),
  zero side effects, zero log entries.
- **Picker data comes from a DEDICATED seeded-system route**
  (`/api/personas/act-as-options`), never `useApp()`'s persona context —
  that context is the PHASE-1 fixture/validator-backed identity track, a
  completely different system from the seeded personas everything else in
  Tier A/B/X/UX is built on. Reusing it would have been the
  two-identity-universes trap this project keeps re-finding, a fourth
  sighting caught before it shipped rather than after.
- **Reply/quote/recast**, each logged to the relationship event log with
  the ACTING persona (not whoever was active) and a `viaActAs` marker when
  they differ. Quote and recast are deliberate closed-union extensions
  (mirroring crosspost's precedent exactly — recast previously logged
  NOTHING at all, even outside act-as).
- **Private personas**: picker shows the same unmistakable chrome as the
  private composer ("Only N people can see this. Not on the public
  timeline.") — non-dismissable, no state gates it. Quoting from a private
  persona is refused outright (private posts have no embed slot).
- **Destination binding respected**: act-as resolves bound destinations
  from the ACTING persona, not whoever is active — a persona without an X
  attestation can't quote-to-X through the picker any more than through
  the ordinary composer.

### Bugs found and fixed en route

1. **`getCast` doesn't resolve private-post hashes at all** — a reply
   targeting a visible private post 404'd unconditionally. Fixed: the
   route tries public resolution first, falls back to
   `visiblePrivatePost` for replies only (quote/recast stay
   public-target-only, so a private post's existence is never confirmed
   to a persona that shouldn't see it — the SAME 404 either way).
2. **A quote of a private post via a public persona** would have leaked
   the private post's existence/content onto the public timeline if
   naively resolved — refused with a 404 identical to "the post doesn't
   exist," never a distinguishable "found but refused" response.
3. **Initial picker selection could default to a persona not in the
   options list** — a View-As lens makes `activeSeedPersonaId()` return
   the View-As target, which is never one of `SEED_VIEWER.personas` and so
   never appears in the picker; pre-selecting it produced dead initial
   state (nothing visibly selected, submit would 403). Fixed: default
   selection falls back to the first real option when the "active" id
   isn't actually offered.

### Testing note

Added `jumpToClock` (absolute epoch-ms jump, vs. the existing relative
`advanceClock`) to the market clock's dev surface — the activation-rule
test needs a KNOWN UTC hour, and the wall clock's actual current hour is
neither controllable nor safe to assume across a long-lived dev-server
session accumulating drift from earlier suites' relative advances.


## HARNESS FIX (cross-cutting, found during Gate 1 regression)

`resetSeed` disarmed the forced-failure budget (a Tier B fix) but not its
two siblings — `failureRateOverride` and `latencyInjection`/`maxOutLatency`
— which live in devControls' own `globalThis` state, entirely outside the
mock store `resetState()` replaces. A long interactive debugging session
(or an interrupted suite) that ever turned max-latency on leaves the
SYNTHETIC FAILURE RATE elevated for every suite that runs afterward in the
same long-lived dev-server process — intermittently, since it is a
probability, not a deterministic trigger. It looked exactly like
suite-ordering flakiness (test:b2 failed once, passed clean on an
immediate re-run) until traced to this. Fixed: resetSeed now disarms all
three knobs. Verified directly: turned max-latency on, called resetSeed,
sampled the destination-list endpoint 20 times — 0/20 incomplete
(previously the exact failure mode). Full regression swept clean
afterward. Same category as the Tier B lesson it extends: a reset that
leaves ANY test-only knob armed is reporting a clean slate it hasn't
actually provided.


Two more suites (accept.mjs test 2, functional.mjs's block-visibility check)
showed the same one-chain-only symptom during this diagnostic session —
both clean on standalone reruns against the fixed server, neither touches
anything Gate 0/1 changed (breaking-news saturation, block fan-out). Not
chased further mid-pass: ad-hoc diagnostic chains (especially ones
following an extended interactive debugging session) aren't the rigor
standard this project holds itself to — that's the 4-consecutive-clean-sweep
protocol reserved for /verify at the end of the WHOLE pass, same as every
prior tier. Flagged here for that final sweep to either confirm-clean or
catch for real.


## GATE 2 — Timeline refresh undo — CLOSED (8/8)

- Client-side (sessionStorage, keyed per mode.id — which already encodes
  its owning persona, so per-(persona,mode) isolation is structural, not
  an extra thing to get right). Explicit refresh pushes `{cards, scrollY}`
  onto a stack, depth-capped (default 3, configurable 1-10 per persona via
  the same settings matrix Gate 1 built), before swapping in fresh content.
  "Restore previous (N)" and Ctrl-Z both pop the stack and restore BOTH the
  card set and the exact scroll position.
- "N new posts — tap to keep, or undo": count is genuinely new cards (hash
  diff against the prior set, not just "did anything change"), stays up
  until an explicit Keep/Undo tap OR the user scrolls past a threshold
  (implicit "seen it, moving on" — matches the spirit of "explicit rather
  than silent" without demanding an extra tap from someone already reading).
- Session-scoped, proven three ways: (1) a fresh browser context in the
  same suite run shows no undo state, (2) restart-survival's own two-phase
  design (separate chromium process per phase) makes server-restart
  survival structurally impossible for sessionStorage — added an explicit
  negative assertion there anyway rather than relying on the absence of a
  positive one, (3) resetState clears the SAME ephemeral session module
  Gate 1's mode-override tracking already uses.

**Real product bug found and fixed via this gate's own test friction**:
the refresh/undo control sat at a plain top-of-timeline position (not
sticky). A user scrolled deep into their timeline — the exact scenario
this whole feature exists for — would have to scroll BACK to the top to
reach the refresh control at all, defeating the feature's own purpose
before it could even run. Playwright's actionability click (which
auto-scrolls a target into view) surfaced this immediately; a real user
would hit the identical problem, just without an error message. Fixed:
the control bar is now `sticky top-[53px]` (matching X's home-tab header
height), reachable from anywhere in the scroll, same as the rest of X's
own chrome.

**Test bugs found and fixed (not product bugs)**: comparing full rendered
`innerText` instead of the stable `data-hash` attribute produced a false
failure when a relative-timestamp string ("·3m" → "·4m") ticked over a
minute boundary mid-test; a blind `waitForTimeout` after a click raced
`/api/feed2`'s six-way parallel adapter fan-out under mock latency on a
freshly-launched (cold) chromium instance — both fixed to poll for the
actual confirmed outcome, the same discipline already used everywhere
else in this project's suites.

## HARNESS OBSERVATION (not chased further mid-pass)

`/api/crosspost` GET (and likely a few sibling multi-destination or
multi-adapter-fanout routes) silently drops a destination for ONE call
when that destination's own `costEstimate()` hits the mocks' natural 2%
synthetic failure — deliberate, documented product behavior ("an
unreachable destination is simply not offered this round"). But several
EXISTING accept-*/restart-survival checks (predating this pass) accept
the first 2xx response without checking content-completeness, so this
occasionally surfaces as a spurious failure unrelated to the feature
under test. Found and fixed for restart-survival's X-attestation check
(content-aware retry added); a SECOND, structurally identical flake hit
the (Tier B, untouched this session) mid-flight-escrow check on
re-verification — not investigated further, since: the underlying
feature is independently proven by test:b3 (7/7) and test:x3 (8/8), which
already retry correctly; and chasing every such gap mid-pass isn't this
project's rhythm — the 4-consecutive-clean-sweep protocol at the very end
of the whole UX pass is where this either confirms clean or gets caught
for real. Worth a dedicated harness-hardening pass at some point:
audit every accept-*/restart-survival check that reads a multi-adapter
fan-out response for content-aware retry, not just status-code retry.

## GATE 3 — Selective bookmark / thread resolution — CLOSED (9/9)

**The architectural question this gate turned on**: the prompt requires
resolved items to flow into "the existing readwise chunking + timeline
populator... not a parallel system." lib/feed.ts's readwiseCards loop
resolves a schedule's content via `postByHash.get(schedule.postHash)` —
hard-coupled to the seeded-post universe. Cold bookmarks/DM messages are
X-side content, not seeded posts, so integrating for real (not just in
spirit) meant answering: can a non-seeded item satisfy that lookup without
touching the loop itself?

It can. `scheduleReadwise(postHash, personaId, fullText)` (the same
adapter method the existing "bookmark a long post" feature already calls,
app/api/feed-health/route.ts) takes arbitrary text — it's not restricted
to seeded content at the chunking layer, only the CARD-BUILDING loop's
lookup is. So a resolved cold item gets a minimal synthetic SeedPost
(hash `cold:<itemId>`, authored by the RESOLVING persona rather than a
fabricated external one — these are real X authors/correspondents, not
Layers personas, and self-authorship keeps every personaById/visibility
check trivially valid with zero special-casing) injected into the SAME
postByHash Map, then calls scheduleReadwise unmodified. The chunker, the
loop, the card renderer: zero changes. lib/x/coldstore.ts is the entire
feature; lib/feed.ts gained four lines (a label lookup for attribution
copy, additive and optional).

**The persistence problem this created, and its fix**: postByHash is a
plain module Map built once from SEED_POSTS — never itself persisted. A
real restart would silently lose every synthetic entry, and with it every
resolved item's card, while the (separately, already persisted) readwise
schedule survived pointing at nothing. Persisting the synthetic posts
themselves would have duplicated content that already lives in this
file's static fixtures. Instead: persist only `coldResolved` (which item
ids are resolved, and when — a few dozen bytes per item), and replay the
synthesis on every hydration from that plus the static fixture text. This
is the exact same shape of problem store.ts already solves for forked
personas leaking into personaById/personaByHandle across a reset, and the
fix follows the same two-part pattern: a replay hook in hydrate()'s
existing seed sequence, and a purge hook (tracking exactly which hashes
this process injected) in resetState()'s existing purge sequence. Proven
by restart-survival, not just asserted: the write phase resolves Longform
and surfaces one chunk, a real `kill` + `next start` cycle follows (PID
confirmed changed), and the verify phase — a separate process, same as
every other restart-survival check — reads the resolved count back intact
AND confirms the card still renders in the feed, which is the one thing
that would silently break if the replay hook were missing or wrong (the
persisted resolved-count would still read back fine either way; only the
rendered card depends on postByHash having been repopulated). 23/23,
including this one.

**Atomicity and idempotency**: resolving computes the pending (not-yet-
resolved) item set FIRST, then runs the whole batch through
lib/x/spend.ts's existing guardedRead — one cap check over the WHOLE
batch's cost, before any item is marked resolved or scheduled. A cap miss
throws before touching anything, so a refused resolve is truly all-or-
nothing, never a partial one. An empty pending set (everything already
resolved) short-circuits before the ledger is touched at all — zero calls,
zero cost, zero new ledger entries — which is what makes re-resolving
provably idempotent rather than merely idempotent-by-convention.

**Fixture data, sized to prove the cap path for real**: two bookmark
folders (Longform: 40 items, one a genuine ~500-word multi-paragraph
piece to prove the chunker runs on real content and not a stub; Everything:
3,000 items, deliberately priced above the $1 default per-run cap at
$0.0004/read so the refusal path is exercised by realistic data rather
than a test-only env override) and two DM threads (12 and 9 items).
Attribution copy distinguishes source kind ("your bookmarks · Longform"
vs. "your DM with @rivqueen") via an optional `readwiseSource` field on
the existing readwise FeedCard — absent (falls back to the pre-existing
"your bookmarks" copy) for every ordinary, non-cold-store readwise card.

**Real bug found and fixed**: the hand-written Longform seed item and the
placeholder generator's own first item both produced the id
`cold_bf_longform_0` — the generator wasn't told to skip index 0.
40 array entries, one silent id collision: the second `scheduleReadwise`
call for that key was swallowed by its OWN idempotency guard (existing,
correct behavior — "put-by-id" is the house rule), so 40 resolved items
quietly produced only 39 unique schedules. Caught by test 4's exact count
assertion ("expected 40, found 39"), not by inspection. Fixed by giving
the hand-written item an id the generator's pattern can never produce.

**Test bug found and fixed (not a product bug)**: an early version of
test 7 resolved a 40-item bookmark folder and a 12-item DM thread in the
same session, fast-forwarded both, and expected a rendered card from each
in ONE feed fetch. It failed — correctly. lib/injection.ts caps `readwise`
at 4 cards per feed build ("prevents a user with 40 bookmarked chunks from
seeing nothing but their own reading queue"), a pre-existing, deliberate
cap that Longform's 40 schedules (inserted first, so first in line) will
always exhaust before a smaller, later-inserted source gets a slot. That's
the cap working exactly as designed — my test's assumption that both
sources would coexist in one capped view was the bug. Split into two
gates each behind its own reset, so neither source competes with the
other for the same 4 slots.

**A second test bug, found by the pass's final sweep, not during the
gate's own build**: sweep 3 of the final 4-consecutive-clean-sweep pass
failed test 9 with "UI resolved count '0', expected 9". Root cause:
ColdStorePanel's `resolve()` calls `refresh()` fire-and-forget (unawaited)
inside its `finally` block, so the result message can render a tick
before the count's own re-fetch lands — the test polled for the message,
then read the count with no further wait, catching the gap between two
separate state updates rather than a broken feature. The product's
eventual-consistency here is fine for a real user (the confirmation
message IS the immediate feedback; the count catches up within one
network round trip, well under human perception) — fixed by polling for
the count itself, not the message, matching this pass's own established
discipline everywhere else. Reset the 4-consecutive-sweep count to
restart from sweep 1 after the fix, per this project's standing rule that
any failure — test or product — breaks the streak.

**Judgment call**: cold-source fixture data lives on the seed viewer's
primary persona only (matching every other X-interop fixture — attestations,
import sessions — being demo'd against one persona rather than fanned
across both). Nothing about the design is single-persona-only; a second
persona simply has zero cold sources today, which the API and panel both
render as an empty, non-broken state.

## GATE 4 — Data backpack + Ad Match Score — CLOSED (7/7)

**Reused, not parallel-built**: Wave 5 already shipped the entire
"backpack" mechanism this gate needed — `ImportConnector`/`ImportJob`,
`listConnectors`/`startImport`/`advanceImport`, a working multi-step
progress UI (components/settings/GraphImports.tsx), sensitive-category
consent gating enforced INSIDE the import's own claim-creation loop
("an import cannot be a back door around the sensitive opt-in" — a
pre-existing comment, not one I added), and `claimsForMatching()`'s
fail-closed, dedup'd, consent-gated claim set already feeding the ad
marketplace. Three of this gate's four source types (W3C VC, DID,
platform export) landed as three new entries in `seed/data/graph.json`'s
`connectors` array — zero new import-flow code. The fourth
(self-declared) was already a one-call feature (`POST /api/graph` with no
`action`, defaulting to `source: "self"`); it only needed its own compact
entry point on the backpack page. The only structural addition:
`ImportConnector` gained an optional `trustSource?: "attested" |
"x-inferred"` (default "attested", so the original 3 connectors are
byte-for-byte unchanged) so a platform export — issuer-backed but not
individually signed — can land at the middle trust tier instead of being
forced into "attested" alongside a cryptographically-signed VC or DID.

**The score, in one paragraph**: `lib/graph/score.ts` reads
`claimsForMatching(personaId)` — the SAME call the ad marketplace itself
uses — never `listClaims`, so a claim that wouldn't count toward an ad
match can't count toward the score either; there is exactly one
definition of "counted," not two that could quietly disagree. Each
counted claim scores `round(CATEGORY_BASE[category] * TRUST_PERCENT[source]
/ 100)`, summed and capped at 100. TRUST_PERCENT is `{self: 10,
x-inferred: 50, attested: 100}` — a flat 10x gap between the two named
extremes, which IS the anti-gaming property, not a side effect of one.
Suggestions are computed the same way: for every connector with at least
one yield this persona doesn't hold, the achievable point delta (a
sensitive yield the user hasn't consented to is excluded from the
suggestion's own math too — promising points an import wouldn't actually
pay out would be a dark pattern by another name).

**Anti-gaming invariant, tested as an exact number, not a direction**:
self-declaring one demographics claim moves the score by exactly 1
(12 × 10%, rounded); importing one DID (ownership, attested) moves it by
exactly 10 (10 × 100%). Both numbers are asserted literally in
scripts/accept-ux4.mjs test 3, not just "self < attested" — a formula
that happened to produce the right ORDER but the wrong magnitude would
still fail this test.

**Composes with the k-floor without touching it**: the k-floor/audience-
size check lives entirely in `POST /api/market/campaign`, keyed off the
CAMPAIGN's audience predicate against the population fixture — it has
never read anything about the persona creating the campaign, score
included. So "a higher score doesn't bypass the audience floor" isn't a
new guard this gate added; it's true because the score has no wire into
that code path at all, proven by test 6 (a high-scoring persona's
tiny-audience campaign still gets refused, same 422 anyone would get) and
by test 5 (importing claims that unlock two new campaigns in the ad-match
preview — a real "richer profile, more matches" demonstration — through
the exact same `matchingCampaigns()` the marketplace already used, no new
matching logic).

**Honesty guardrails**: the backpack page states, in the same view as the
score itself (not a separate, skippable disclosure screen), that this is
an ad-targeting-value score rather than a trustworthiness or
attractiveness-of-person score, that a higher number means more/
better-priced ad inventory pointed at the user, and that every counted
input is something the user chose to share. No urgency or loss-framing
copy anywhere in the suggestion list — deltas are stated as plain facts
("Connect X: +12"), not warnings.

**Bugs found and fixed (both test bugs, not product bugs)**: (1) an early
version of the PAGE reactivity test self-declared a "politics" claim to
prove the score updates live — politics is one of the three sensitive
categories, so the fresh, unconsented persona correctly got refused (403)
and the score correctly never moved; the test was asserting the wrong
thing, not exercising a bug. Switched to "habits" (non-sensitive) to test
plain reactivity, which is all that check was ever meant to prove. (2) a
manual regression pass ran five older suites (a1, g2, g3, x2, x4) back to
back against one long-lived server process without an explicit reset
between them; test:x4's tests 3-4 failed with a stale-content shape
("attested match not surfaced," "card not rendered"). Re-running test:x4
alone, immediately after an explicit resetSeed, passed clean 6/6 — this
is the same class of cross-suite state/timing sensitivity already
documented as a HARNESS OBSERVATION earlier in this file, not a Gate 4
regression: nothing in x4's domain (follow migration) shares a single
code path with anything this gate touched (lib/graph/score.ts,
lib/adapters/mock/graph.ts, seed/data/graph.json, the backpack
components). Logged here for the same reason as the earlier observation —
confirm clean or catch for real at the pass's final 4-consecutive-sweep
verification, not chased mid-gate.

**A real (small) performance bug, found by the final sweep**: sweep 1 of
the pass's second 4-consecutive-clean-sweep attempt failed ux4 test 7
("score did not update after a self-declared claim was added") even with
a 6s poll budget. Root cause was in the product, not the test:
`computeScore`'s consent check looped over the 3 sensitive categories
SEQUENTIALLY (`for...await`), each an independently-retriable mock call at
up to 1500ms — up to 4.5s just for that loop, stacked on top of the
self-declare's own retried latency, comfortably able to exceed a 6s
budget on an unlucky run. The three reads are independent; there was no
reason for them to be sequential. Fixed with `Promise.all` (a real latency
improvement on every score read, not just a test workaround) and widened
the test's poll budget to match this pass's usual margin for chained
retried calls. Reset the sweep count again after this fix, per the same
standing rule.

**Judgment call**: no per-category anti-spam cap on the score (e.g. ten
self-declared claims in one category currently outscore one attested
claim there). The exit criterion is a single-add marginal-delta test,
which the design satisfies exactly and exclusively; hardening against
claim-spam wasn't asked for and would have added real complexity (a
cap interacts with the "breakdown sums to the score exactly" requirement)
for a property nothing in this pass's scope tests. Worth a follow-up if
richness scoring becomes a real incentive surface rather than a preview.

## CALL OPTION A — X alt linking — OPENED, CLOSED (9/9)

Gates 0-4 all closed well inside their allocated budgets (G3 and G4 each
landed clean without needing their full 3-iteration allowance), banking
well over the 3 iterations the call option needed to open.

**A real architectural pivot, found at the very first test run, not
designed around in advance**: the natural reading of the prompt — link
TWO of the user's own Layers personas, each attested to a different X
handle — doesn't fit this fixture's viewer roster. `SEED_VIEWER.personas`
has exactly one PUBLIC persona; the other is private, and private personas
are correctly barred from carrying ANY external account attestation
elsewhere in this codebase (`lib/x/attestations.ts`'s own rule 2 — a
private persona linking to a public X handle is the exact linkage leak
that rule exists to prevent). The first real test run refused with
`"private personas cannot carry external account attestations"` before I
'd even gotten to the feature logic. Adding a second public viewer persona
to route around it was rejected as too invasive this late: Gate 1's own
tests hardcode `SEED_VIEWER.personas.length === 2` in two places (the
act-as persona list, the settings matrix row count) and would have broken
for a reason unrelated to anything this option touches.

Redesigned instead around what the feature actually needs: ONE persona's
regular attested X handle plus a SEPARATELY linked "alt handle" — a
second account the same person controls, linked through its own
lightweight fixture-OAuth step (`altXHandles`, distinct from
`xAttestations`' one-handle-per-persona slot). This is arguably the more
realistic shape of "link my X alt" anyway (a main and a side account run
by the same person), needs no second persona, and touches zero code any
other gate's tests depend on.

**The real disclosure, reusing what already exists**: the grant is issued
through `adapters.identity.issueGrant` — the exact same call every other
disclosure feature in this app uses, not a parallel mechanism. Since the
claim here is about one persona's two X handles rather than a pair of
personas, `fromPersona === toPersona` — which isn't a workaround, it's the
shape `lib/identity/grants.ts` already documents for exactly this case
("An audience grant sets fromPersona === toPersona: it is not a claim
about a PAIR, it is a claim about one persona and one viewer"). The grant
lands in the persona's real, existing grant list
(`GET /api/identity/grant`), visible and revocable through the same
surface as any other disclosure — proven in test 4 by reading it back
from there, not just trusting the POST response.

**The delay, and why there's no real timer**: fixture mode never contacts
real X, so there is nothing to actually DO at t+delay — both like
timestamps (`likedAt: [now, now+delayMs]`) are computed and recorded
synchronously at request time, with "scheduled" vs "completed" derived
purely from wall-clock time against them on read. `delayMs` is
`3000 + random(9000)` — always in [3000, 12000), never 0 — tested as an
exact range check plus an explicit non-zero assertion, not just "delay
exists."

**Safety set, all tested**: disclaimer required before first use (412
`disclaimer_required` on any run attempt beforehand; the modal itself has
exactly one button — no close control, no backdrop dismiss); daily cap of
3 refuses a 4th run (429 `rate_limited`) with NOTHING issued on the
refused attempt (no new grant, no new attempt record — checked by exact
count, before vs. after); never a batch (the endpoint has no array
parameter at all — an array `altHandle` is refused as an unrecognized
value, not expanded); fixture-only (no `X_API_CLIENT_ID` anywhere in this
pass). The daily cap is also the one Call-Option-A property carried into
restart-survival, since "alt-link rate limit + delay" is explicitly named
in this pass's safety set: a restart that reset the day's attempt count
would silently double every account's daily allowance, so `altLinkAttempts`
persists through the same namespace mechanism as everything else, proven
by a real kill + restart, not just code inspection.

**Judgment call**: the "extension-connected" half of "both must be
OAuth-linked or extension-connected" wasn't built — this pass's X-interop
foundation (from notes/reports/REPORT-X.md) only ever implemented OAuth, so there was
no existing extension-linking concept to plug an alt handle into. Treated
as out of scope rather than inventing a second, parallel linking
mechanism with no other consumer in the app.

---

# HARNESS FIX (final) — content-aware retry, the observation finally closed

Twice during this pass I logged a "HARNESS OBSERVATION": several
pre-existing suites read a multi-adapter fan-out response and accept the
first 2xx without checking whether the response is *complete*. Both times
I deferred it to the final sweep verification rather than chase it
mid-gate. The final sweeps caught it for real, exactly as predicted, so
it's now fixed rather than logged a third time:

- **accept-b2.mjs** (`/api/crosspost` GET). The route calls
  `costEstimate()` per destination inside its own try/catch — a
  destination whose estimate hits the mocks' natural 2% synthetic failure
  is silently dropped from an otherwise-200 response. That is deliberate,
  documented product behavior ("don't offer it this round"), so the fix
  belongs in the TEST, not the route. Added a `crosspostFull()` helper
  that retries on CONTENT, and routed three checks through it. Two of
  those three were latent crashes waiting to happen, not just wrong
  assertions: `destinations.find(d => d.id === "x_mock").cost` and
  `.degradation` both throw outright when the destination is missing,
  which is why this surfaced once as "got x_mock" and once as
  "Cannot read properties of undefined".
- **accept-a3.mjs / accept-a4.mjs** (PAGE renders). Both did
  `goto(networkidle)` → flat `waitForTimeout(800)` → assert. `/home` fans
  out across many retried mock adapter calls, so 800ms holds in isolation
  (both passed 6/6 and 8/8 when re-run alone) and does not hold under
  full-sweep load. Replaced with polling plus one reload midway, covering
  both "render still in flight" and "state landed after the render began".

Worth stating plainly: **all three were test bugs, not product bugs.** The
product behavior each one tripped over is correct and deliberate in every
case. What was wrong was tests asserting on a snapshot they hadn't
established was final — the same defect class this project has hit
repeatedly, and the reason "poll for the confirmed outcome, never a flat
wait" is a standing rule here.

---

# KNOWN-BROKEN

**None.** Every gate closed on its exit criteria, and no feature was
shipped in a degraded state.

Two things were deliberately NOT built, and are judgment calls rather than
breakage — both recorded in full above:

- **Extension-connected alt linking** (Call Option A). The prompt allows
  "OAuth-linked or extension-connected"; only OAuth exists in this
  codebase, so building a second parallel linking mechanism with no other
  consumer was out of scope.
- **Per-category anti-spam cap on the Ad Match Score.** Ten self-declared
  claims in one category currently outscore one attested claim there. The
  stated exit criterion is a single-add marginal-delta invariant, which
  the design satisfies exactly; a cap also interacts awkwardly with the
  "breakdown sums to the score exactly" requirement.

The safety set never tripped: import-not-feed default, private-persona
chrome in act-as, score anti-gaming invariant, sensitive-consent gate,
audience-floor-not-bypassed, spend caps on resolution, and alt-link rate
limit + delay all passed on every run, and none ever hit a plateau.

---

# WHAT THE VAULT MUST HOLD

Updated for the UX pass. Ordered by blast radius — what a disclosure
would actually cost the user:

1. **Alt-link records** (NEW — straight to the top, above even the event
   log). `AltLinkAttempt` holds `personaId`, BOTH X handles, the audience
   member disclosed to, and the grant id. A leak here doesn't degrade
   privacy, it *ends* it: it deanonymizes someone's alt account outright
   AND exposes who they chose to tell. `altXHandles` is the same hazard in
   smaller form. This is the single most sensitive record the product has
   ever created, and it exists because Call Option A is fundamentally a
   feature for making a linkage — which is exactly why the disclosure it
   issues is a real, revocable grant rather than an ambient fact.
2. **The relationship event log.** Every follow, block, strike, reply,
   like, and now quote/recast with its triggering cast, plus the
   `viaActAs` flag — which reveals that a post was made on behalf of a
   persona other than the active one.
3. **The context graph — now including backpack claims** (per this pass's
   requirement). Claims, consent state, sensitive categories, and each
   claim's provenance (issuer, method, date) and trust tier. The backpack
   makes this materially richer: a W3C VC or DID carries a real-world
   credential, not just an inferred interest.
4. **Private posts** — including replies, likes, bookmark marks.
5. **Grants** — linkage, forward, audience. Each is a disclosure decision.
6. **Resolved cold-storage items** (NEW). `coldResolved` records which
   bookmark folders and DM threads a user chose to pay to resolve. That's
   a precise reading-interest fingerprint, and in production the resolved
   *content* joins it (in this pass the text is static fixture data).
7. **Persona↔mode bindings** (NEW). `personaDefaultMode` and any mode
   activation rule reveal which persona you use for what, and a
   `clock.hourUTC` rule additionally leaks your daily routine.
8. **Follow deltas + last-visit + strike settings.**
9. **Curator subscriptions + annotation votes.**
10. **Imported algorithms with provenance.**

**Explicitly NOT vault material**, and each for a real reason:

- **The timeline undo stack.** Never persisted at all — sessionStorage
  only, cleared by `resetState`, and restart-survival asserts its ABSENCE
  after a hard restart. Ephemeral UX, not data.
- **The Ad Match Score.** Derived, never stored — recomputed from claims
  and consent on every read. There is no score record to leak, only the
  claims underneath it (already #3).
- **`timelineUndoDepth`.** A persisted setting, but it's a preference
  integer with no behavioral content.
- Algo cards you PUBLISHED, curator feeds, refutation edges — public by
  intent.

---

# PRODUCT BUG FOUND BY THE FINAL SWEEPS — duplicate block events

Sweeps 1 and 2 were clean (239/239 each). Sweeps 3 and 4 both failed the
SAME Tier A Gate 1 check: `expected 1 block event, got 2`. Not a timing
flake — a real violation of the relationship event log's own stated
invariant ("keyed by id so writes are idempotent and therefore retry-safe;
exactly-one is an exit criterion").

**The mechanism**, in `/api/block-seed`:

1. `block()` succeeds.
2. `logEdgeEvent()` succeeds — event #1 written.
3. `blockedFor()` — a **bare adapter read with no `retryAdapter`** — hits
   the mocks' natural 2% synthetic failure.
4. The catch returns **503**, even though the block and its log entry both
   already landed.
5. The caller retries the POST.
6. `mintId()` derives event ids with `randomBytes(8)`, so the retry mints a
   **new** id and writes event #2.

Two standing rules broken in one code path: *retry adapter reads*, and
*never report failure for work that succeeded*. The 2% probability is why
it took until sweeps 3 and 4 to fire.

**The fix**: retry the read, and — critically — do not let its failure fail
the request. On exhausted retries the route now returns `200` with
`blockedPersonaIds: null, listUnavailable: true`. That is deliberately
`null` and flagged, never `[]`: an empty array here would read as "nobody
is blocked", which is the fail-open shape this project forbids.

**The deeper gap, documented rather than fixed:** event ids are random, so
the log's idempotency holds for *in-process* retries (`retryAdapter`
around `record()`, which is what a1 test 2 actually proves via `forceFail`)
but NOT for *client-level* HTTP retries. The real fix is caller-supplied
idempotency keys, exactly as `lib/x/spend.ts` already does with
`idempotencyKey`. Deferred deliberately: it touches every `logEdgeEvent`
call site, and changing dedup semantics during final verification risks
collapsing legitimately distinct events (a re-block after an unblock
should stay two events). Worth a dedicated pass.

**`/api/follow` audited and deliberately left alone.** It has the same
shape — `resolveFirstInteraction()` runs after the log write and can fail
the request — but its exposure is roughly 2500x lower: that call already
retries internally AND is idempotent via an explicit already-resolved
check. More importantly, making it best-effort would be a REGRESSION: today
a transient failure returns 503, the caller retries, and the co-interaction
resolves. Swallowing it would convert a retry-and-succeed into a silent
skip, making the co-interaction behavior less reliable, not more. Failing
loudly is correct there.

---

# /VERIFY — FINAL RESULTS

**4 consecutive clean sweeps: 239/239 passing checks, 0 failed suites, 0
infra, on every run.** Failure-detail capture was verified writable before
run 1 and finished empty. Server warmed before the first sweep; listening
PID confirmed changed after every restart.

| Requirement | Result |
|---|---|
| All gate exit tests as Playwright specs, cumulative | ✓ 32 suites |
| Full legacy suite green (187-check X-pass baseline) | ✓ 239 checks |
| Leak greps every iteration | ✓ root-leak clean, 46 payloads |
| Restart-survival: bindings, resolved bookmarks, backpack claims + score | ✓ 25/25 |
| Undo stack explicitly does NOT survive restart | ✓ asserted absent |
| ENABLE_X_WRITE unset — nothing spends or posts | ✓ live spend $0.00 |
| tsc strict | ✓ clean |
| Production build | ✓ clean |

### Gate results

| Gate | Result | Checks |
|---|---|---|
| 0 — Import behavior fix | CLOSED | 6/6 |
| 1 — Persona × mode matrix, act-as | CLOSED | 13/13 |
| 2 — Timeline refresh undo | CLOSED | 8/8 |
| 3 — Selective bookmark/thread resolution | CLOSED | 9/9 |
| 4 — Data backpack + Ad Match Score | CLOSED | 7/7 |
| Call Option A — X alt linking | OPENED, CLOSED | 9/9 |

**Call option opened because** gates 0-4 all closed inside their allocated
budgets, with G3 and G4 each landing without needing their full
3-iteration allowance — leaving well over the 3 iterations the option
required.

### What the sweeps actually earned

The 4-consecutive protocol paid for itself twice on this pass, and both
finds were invisible to isolated suite runs:

1. **A real product bug** — duplicate block events from an un-retried
   adapter read returning 503 after the write had already landed (full
   writeup above). It needed the 2% synthetic failure to fire on one
   specific call; it survived every isolated run of that suite and only
   appeared on sweeps 3 and 4.
2. **A real performance bug** — `computeScore` reading three sensitive-
   category consents sequentially instead of in parallel, adding up to
   4.5s to every score read.

Plus four test-harness defects of the same recurring class: asserting on a
snapshot before establishing it was final (flat waits instead of polls),
and status-only retries accepting a content-incomplete 200. The
content-aware-retry gap had been logged as a HARNESS OBSERVATION twice
during this pass with the explicit plan of "confirm clean or catch it for
real at final verification" — it got caught for real, and is now fixed
rather than logged a third time.
