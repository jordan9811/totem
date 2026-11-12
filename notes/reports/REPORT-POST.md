# REPORT-POST — Post-deploy pass: persona ergonomics, readwise, hygiene

**Run:** started 2026-09-19, from `b8d2222` (the browser keystore pass closed: four consecutive clean
sweeps, 585 checks over 78 suites, the preview live and verified). Prompt: `notes/prompts/post-deploy-prompt.md`.
Checkpoints in `notes/reports/RESUME.md`; the closing summary in `notes/runbooks/MORNING.md`.

**Standing rules carry over unchanged**, including the one this pass exists to respect: where the
owner's intent is "the knob, not the model", build the knob and log the model as an idea.

---

## GATE 0 — Hygiene carried from prior passes

| id | decision |
|---|---|
| D-POST-0-SEALING-WAS-DONE-SO-PROVE-IT | The prompt asks for `rules`, `activeMode`, `folders` and `followedFacets` to be sealed, on the grounds that they are still plain persona-keyed records. They are not: the browser-keystore pass's Gate 1 stage 2 moved every non-vault write through `sealWhole()`, which seals the whole document into one opaque record, and the validator's own database confirms it. So this gate does not seal them again — it proves it, with a suite that writes all four through the product and then reads them back off the validator. Building a second sealing layer over a sealed namespace would have been motion, not work. |
| D-POST-0-THE-NEEDLE-IS-GENERAL-NOT-A-LIST | The prompt asks for a standing grep needle after the fourth persona-keyed leak. A needle naming those four namespaces would miss the fifth. The needle is therefore: NO key of any namespace is a persona id or handle of this root, and NO plaintext value anywhere names one. A namespace added by a future pass is covered without being listed, and the check reports how many rows it scanned so a shrinking haystack is visible. |
| D-POST-0-PROVING-A-HANDLE-EARNS-AN-OFFER | A pending relationship port no longer resolves into a disclosure grant when someone proves the handle it names. It moves to `awaiting-confirmation` and discloses nothing; the persona that ISSUED the port must confirm, a decline ends it for good, and a second answer on a settled offer is refused. The 30-day lapse stays as the offer's outer bound rather than as the safety mechanism it was being asked to be. |
| D-POST-0-BELOW-BAR-IS-A-LABEL-NOT-A-SILENCE | The anoncast reveal shipped after the Multi-FID pass closed, with its own suite and unit tests but without the three reviews and four sweeps everything else is held to. Running that bar now costs a night of sweeps for a feature this pass's own review gate already covers. It is labelled in the posture instead — in the section a reader of those protections actually reads, not in a footnote — and the review gate will retire the banner or replace it with findings. |

### What was built

`scripts/accept-pd0.mjs` (`npm run test:pd0`, four checks): the product writes all four preference
namespaces; each lands as ciphertext under one opaque address; no persona id or handle is a state key
anywhere; no plaintext value anywhere names a persona of this root.

`lib/x/porting.ts`: the `awaiting-confirmation` and `declined` states, `matchedAt`, and `confirmPort()`
— which refuses an expired offer, refuses a port that is not awaiting an answer, refuses anyone but the
issuing persona, and refuses a second answer once settled. `app/api/x/port/route.ts` gains the
issuer's answer as an action on the existing route rather than a new surface.

`scripts/accept-mega2-g6.mjs` check 2 now asserts the stronger contract end to end: proving the handle
raises an offer, the counterpart does NOT resolve the merged identity while it is unconfirmed, the
issuer's confirmation is what issues the grant, and a second confirmation is refused.

`SECURITY-POSTURE.md`: A-MEGA2-PORT-PENDING-TRUSTS-THE-HANDLE is **retired** and replaced by the
narrower A-POST-PORT-OFFER-NAMES-BY-HANDLE (the handle still decides who gets ASKED, and the cost of a
squatted handle is now a prompt rather than a disclosure); §14.1 carries the below-bar banner.

### What the measurement found

- Every row in the validator's `adapter_state` is ciphertext: **0 plaintext rows of 3,072**. The
  needle's haystack is currently empty, which is the strongest form of the claim and also the reason
  the needle reports its counts — a future plaintext row is a visible regression, not a silent one.
- Three of the four namespaces exercise through obvious routes; `followedFacets` only writes when the
  persona being viewed has facets, and a facet is a CLUSTER a root posts in, so the single-persona
  seeded accounts in the feed have none. The suite now probes the seeded viewer's own root, which
  does. Worth recording because "the check passed" and "the check reached the code" are different
  claims, and the first version of this suite would have made only the first one.

### Iterations

| iteration | result |
|---|---|
| 1 | The first version of the sealing check would have passed while proving nothing: three of the four namespaces write through obvious routes, and `followedFacets` only writes when the persona being VIEWED has facets — which the single-persona seeded feed accounts do not. It now probes a root that has them, and fails loudly if any of the four went unexercised. |
| 2 | Port re-confirmation broke the porting suite, correctly: its check 2 asserted the OLD contract (prove the handle, get the grant). Rewritten to the stronger one — offer raised, nothing disclosed, issuer confirms, second answer refused — and green at 8/8. |

---

## GATE 1 — Persona cloning

| id | decision |
|---|---|
| D-POST-1-COPY-ARTIFACTS-NOT-REFERENCES | A clone inherits its source's modes, rules and folders as NEW artifacts with new ids, never as references. Two personas that start identical have to be able to diverge; a shared reference would make "start from" mean "stay tied to", and the first edit would silently change a persona the owner was not looking at. Asserted by renaming the clone's copy and checking the source is untouched. |
| D-POST-1-A-COPIED-MODE-NEVER-ARRIVES-ARMED | A copied mode lands with its persona pin cleared and its auto-switch disabled. The source's pin names the SOURCE, so carrying it would make the clone's own mode switch away from the clone; an auto-switch that fires on arrival is a setting the owner never chose in this context. |
| D-POST-1-FOLLOWS-ARE-ONE-LIST | Follows are not copyable, and the reason is stated instead of hidden behind a disabled checkbox. In this codebase a follow belongs to the DEVICE: one set, every persona reads it. There is nothing to copy, nothing to withhold and nothing to partially copy, so the clone reports the count it SHARES. The correlation risk the prompt warns about is real but lives on the network, where a follow is an account's own action; it is recorded as A-POST-FOLLOWS-ARE-ONE-LIST rather than papered over with a control that does nothing. |
| D-POST-1-ONE-ROSTER-ONE-TRUTH | Three parts of this codebase disagreed about which personas are yours — the session roster, the rendering map, and the acting-persona resolver. All three now agree, because cloning made the disagreement load-bearing. |

### What was built

`lib/identity/clone.ts`: `cloneable()`, `copySettings(from, to, opts)` and `cloneEventId()`. Rules are
copied first so the id map exists before the modes that reference them; modes follow with
`pinnedPersonaId: null` and `activationEnabled: false`; folders last. The report carries `modes`,
`rules`, `folders` and `followsShared` — a count of what is SHARED, never of what was copied.

`app/api/identity/fork/route.ts` gained `startFrom` / `copy` and returns the clone report. It also
resolves `fromPersona` session-aware and records the new persona under the root the session actually
reads, which is where the roster disagreement lived.

`scripts/accept-pd1.mjs` (`npm run test:pd1`, six checks).

### The ground under Gate 1

A persona minted by a fork appeared in the account picker, could not be selected, could not be forked
from, and — the part that mattered — silently redirected every write to a DIFFERENT persona that
happened to share its handle. Four files now agree: `lib/validator.ts` registers a device-held roster
record where the rest of the app resolves ids; the fork route records under the session's root;
`app/api/seed-persona/route.ts` accepts any persona of that roster; `lib/activePersona.ts` honours a
persona this process minted. Writing to the wrong persona is worse than refusing, and this was doing it
quietly.

---

## GATE 2 — Persona tint + unified cross-persona view

| id | decision |
|---|---|
| D-POST-2-COLOUR-IS-A-SHORTCUT-NOT-A-SIGNAL | The tint makes the distinction FAST; the persona pill — the handle, in text — makes it CORRECT. The pill is rendered by the layout and by the left rail, never by a page, so a page that forgot it cannot exist; the mode rides the same element as a border TREATMENT (solid / dashed / dotted / double), a second channel that survives greyscale on its own. The suite asserts the pill on a page that is not `/home`, because the pre-existing persona-mode pill was home-only and would have left most of the app with colour as the only cue. |
| D-POST-2-THE-PALETTE-IS-A-MEASUREMENT | The first palette was picked by eye under a comment claiming the entries were far enough apart. The suite simulated them and found the product blue and a violet collapsing to a CIE76 distance of 4.3 under protanopia — a coin flip, in the exact place a wrong guess means posting as the wrong persona. It was replaced with eight accents holding a minimum pairwise distance of ~15 across normal vision, deuteranopia, protanopia and tritanopia, which is why they span lightness so widely: the red-green axis is the one that collapses, so lightness is what is left to carry the difference. |
| D-POST-2-A-COLLIDING-COLOUR-IS-REFUSED | The field accepts any hex, so a hand-picked colour could still land on a sibling's accent under protanopia and quietly undo the cue. `setTint` refuses it, and the refusal names the vision model and the distance. This is not paternalism about taste: the setting would be defeating its own purpose, and the message says exactly how. |
| D-POST-2-THE-SCOPE-IS-THE-INDEX-NOT-A-FILTER | With the cross-persona view off — the default, and what compartment mode forces — the search index is BUILT from one persona's records. Not a wider index filtered at the end: the sibling's records are never read, never embedded, and never in the process memory a screen-share could reach. The cache is keyed by scope, and every scope's index is dropped when the scope changes. |
| D-POST-2-COMPARTMENT-IS-ENFORCED-AT-THE-API | The account switcher, the act-as picker, the search index and a sibling's stake history all narrow at the route, not in the DOM. A suppression that only hides an element is one a view-source, a screen reader and a stale client cache all defeat. One chokepoint answers for all four: `viewScope()` in `lib/identity/chrome.ts`. |
| D-POST-2-LEAVING-COMPARTMENT-RESTORES-NOTHING | Entering compartment mode forces the cross-persona view off. Leaving does NOT turn it back on, and turning it on while compartment is held is refused with 409 rather than silently dropping the compartment. A protection you can lose by accident on the way out is not one. |
| D-POST-2-THE-TINT-FAILS-OPEN-AND-ONLY-THIS-FAR | An unreadable chrome record leaves the chrome UNTINTED and the pill unchanged: losing the shortcut is a degradation, losing the handle would be a lie. The SCOPE half never fails open — `viewScope` throws and the routes that enforce it answer 503, because a compartment that evaporates when the validator hiccups is not a compartment. |

### What was built

`lib/identity/chrome.ts` — one opaque padded sealed vault record (`personaChrome`, key `_`) holding the
per-persona tints, the cross-persona toggle and the compartment flag. Sealed whole for the same reason
`modes` is: a per-persona colour map keyed by persona id hands the operator this root's sibling set in
the record ADDRESSES even with every value encrypted. `tintsFor()` assigns distinct defaults across the
whole roster in one deterministic walk; `viewScope()` is the single chokepoint every cross-persona
surface asks.

`lib/identity/colorVision.ts` — Viénot–Brettel–Mollon dichromat simulation in linear sRGB plus CIE76
distance, behind the collision refusal. The suite carries its own independent copy on purpose: a suite
that imports the implementation it checks only proves the implementation equals itself.

`components/PersonaPill.tsx`, and the `persona-chrome` / `persona-mode-edge` classes on the left rail,
right rail, mobile tab bar and the sticky headers. The wash is painted as a background-IMAGE so it
layers over whatever background-color the chrome already has, and so a content card — which never
carries the class — keeps `background-image: none` for the suite to assert against.

`lib/search/unified.ts` — `SearchScope`, `currentScope()`, scope-keyed indexes, `browseAll()` (the
cross-persona VIEW, no query, newest first), and real attribution: likes and bookmarks are now
attributed to the persona that made them rather than lumped onto the first persona in the roster, which
is what "bookmarked as @fluffypanda69" actually requires.

`app/api/persona/chrome/route.ts`, `components/settings/PersonaTintPane.tsx`, and the scope controls in
`components/UnifiedSearch.tsx`. Compartment enforcement in `app/api/personas/route.ts`,
`app/api/personas/act-as-options/route.ts`, `app/api/influence/route.ts` and the app layout.

`scripts/accept-pd2.mjs` (`npm run test:pd2`, nine checks).

### Iterations

| iteration | result |
|---|---|
| 1 | The suite aborted: it read the roster from `/api/personas`, which on this rig holds ONE persona, while the tint, the search scope and the persona switch all live in the seeded track that holds two. The two identity universes again. It now reads the track the code under test actually reads, and check 7 asserts the act-as picker drops 2 → 1 rather than asserting a count that was already 1. |
| 2 | Scoping the switcher by the wrong track's active id would have EMPTIED the account switcher under compartment mode instead of narrowing it — the layout was passing the seeded acting id against the session roster. Compartment mode narrows a roster to its active persona; erasing it is a different bug wearing the same clothes. |
| 3 | The palette failed its own check, and the fix was the palette, not the threshold. See D-POST-2-THE-PALETTE-IS-A-MEASUREMENT. |
| 4 | Check 9 reported a product failure that was its own leftover: an earlier failing run had left a chosen tint in the vault, and the new collision rule then correctly refused the suite's hardcoded colour. The cleanup moved into a `finally`, and the test colour is now CHOSEN by the suite's own colour maths from whatever is free. A suite that dirties the rig on failure reports its leftovers as defects. |
| 5 | Check 9 also read the `envelope_counters` row — which legitimately names every namespace and holds no record — as an unencrypted `personaChrome` record. Scoped to `adapter_state`: the difference between checking the record and checking the word. |
| 6 | `test:m2g4` went 8/8 → 0/8, correctly: it asserts the one box over everything this ROOT touched, which this gate made opt-in. It now asserts the new default is OFF and then opts in, so the gate that made it default-off cannot silently un-make itself there. |
| 7 | The one that was not a suite problem. `test:pd1` went 6/6 → 4/6 on a COLD process only: a mode created right after a persona switch was being attributed to the seeded default instead. `/api/seed-persona` validates against the session roster, but `activeSeedPersonaId()` is synchronous and can only check the rendering MAP — which a cold process has not warmed for a roster persona. The accepted switch now registers the persona, so the cookie and the map cannot disagree in a later request; and pd1 asserts the write's attribution at the moment of the write rather than discovering it two checks later as "the clone copied zero modes". |

---

## GATE 3 — Per-account delivery tiers

| id | decision |
|---|---|
| D-POST-3-FIVE-RULES-NOT-ONE-PER-ACCOUNT | The tiers compile to ONE rule per non-normal tier, each matching a single new evaluator field (`delivery.tier`) whose value the feed resolves per post from the (account x mode) map. The account never enters a rule. A rule per account would grow the rule list with the follow graph and would carry account ids through every structure a rule passes through — the mode, the preview, the algo export. |
| D-POST-3-THE-TIER-IS-A-PAIR-NOT-A-PROPERTY | A tier is keyed `modeId\|personaId`, so "never miss in personal, quiet in work" is one setting on one account rather than two accounts. Every read and write names a mode, and the default is the mode the viewer is actually in — the control says which mode it is setting, because an owner who reads it as global will be surprised later. |
| D-POST-3-NORMAL-IS-THE-ABSENCE-OF-A-ROW | "Normal" is never stored. That makes the management screen the complete non-normal set BY CONSTRUCTION rather than by filtering something larger, and it stops the map growing with every account ever looked at. Setting a tier back to Normal removes the row; the suite asserts the list shrinks by exactly one. |
| D-POST-3-FACET-ONLY-IS-REFUSED-WITH-NO-FACET | "Facet only" with no facet selected would hide every post that account makes, which is not what anyone means by it. It is refused with the reason, and the tier is the EXISTING facet-follow presented as a tier rather than a second scoping mechanism. |
| D-POST-3-PIN-IS-ONE-POST-PER-ACCOUNT | Never-miss pins ONE post per account, capped at a quarter of the page. The first version pinned every post the account had on the page — nine of them — which is exactly what the author-diversity walk exists to prevent, and marking somebody never-miss is not a request to hear only from them. The rest of their posts rank normally. |
| D-POST-3-PIN-AND-BANNER-ARE-DEVICE-ONLY | `lib/algo/artifact.ts` still allowlists hide/downrank/flag, and now refuses `pin` and `banner` BY NAME. An imported algorithm that can pin an account to the top of somebody's timeline is an ad slot with extra steps; one that can banner an account is a push channel. |
| D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS | Pinning acts on the posts the feed already holds. On a fully exhausted feed — everything seen — a never-miss post does NOT come back above or below the caught-up banner; on a partial exhaust it pins above it. Both halves are asserted, because "nothing below the banner" passes trivially when the banner is the last card. |

### What was built

`lib/delivery/tiers.ts` — the sealed vault namespace `deliveryTiers` (one opaque padded record; which
accounts you never want to miss and which you have turned down is a map of what you care about, so the
addresses would say as much as the values), plus `compileDeliveryRules()`.

`lib/adapters/types.ts` — the `delivery.tier` rule field and the `pin` / `banner` actions.
`lib/rules/evaluate.ts` — the field, in the same pure evaluator every other filter uses.

`lib/feed.ts` — the compiled rules join the mode's own rules; the evaluation context carries the
author's tier; pin, banner and downrank are read off the SAME evaluation. The placement lands in the
feed's final ordering, not the corpus ordering.

`app/api/delivery/route.ts`, `components/DeliveryTierPicker.tsx` (in the cast menu),
`components/settings/DeliveryTiersPane.tsx` and `/settings/delivery` (the management screen),
`components/PreviewStrip.tsx` (the banner tier's surface, above the timeline, never a notification).

`scripts/accept-pd3.mjs` (`npm run test:pd3`, ten checks).

### Iterations

| iteration | result |
|---|---|
| 1 | Never-miss pinned every post the account had on the page. Fixed to one per account, capped at a quarter of the page — and the suite now asserts the count, because "it moved up" would have passed either way. |
| 2 | The pin did not survive. It was applied to the corpus ordering, and the feed's FINAL sort — a recency sort — put the post straight back where its timestamp said. The comment above that sort already recorded this trap, from when the demote feature hit it: it is the only place a position guarantee survives. The tiers now land there, deliberately BELOW the demote key, so a sunk author stays sunk and never-miss cannot overrule a curator flag. |
| 3 | Three checks asserted that pinning and bannering surface nothing outside the visible page. Wrong test: the strip and the pin draw from the build's ELIGIBLE set, which is wider than the page on purpose — a banner post that fell off the page still surfacing is the tier doing its job. Replaced with the claims that actually hold: the page does not grow, one post per pinned account, every strip item is a real post by the bannered account. |
| 4 | Two checks compared raw feed indexes across two MODES, which rank with different weights, so 22 versus 27 said nothing. Compared by pinned-ness instead, with the mode pinned down explicitly first. |
| 5 | Three checks left their tier set when they failed, and the next check then reported the leftover as a setting nothing had made. Cleanups moved into `finally` — the same lesson Gate 2 learned, one gate later. |
| 6 | The caught-up check passed while proving nothing: the banner was the last card, so "no posts below it" was a claim about an empty list. Split into a PARTIAL exhaust (the pin is above the banner, and is there) and a FULL exhaust (nothing at all comes back). |
| 7 | The no-parallel-path grep failed on the feed's own comment, and then on `"banner"` — which is an ACTION name as well as a tier name, and comparing the action IS the rules-engine path. It now strips comments, forbids only the two unambiguous tier literals, and asserts structurally that the resolved tier is called exactly once, to fill the evaluator context. |

---

## GATE 4 — Readwise: the knobs and the dwell mechanic

**The scope rule this gate exists to respect:** no retention model, no spaced
repetition, no forgetting curve, no difficulty estimate. The owner asked for the
KNOBS. A model would decide cadence and length FOR them, which is the opposite
of a knob, and a previous pass overbuilt exactly this. The long-term idea is a
note on the ideas page and nothing else. The suite greps `lib/readwise/` for the
vocabulary of that model and asserts zero hits, so the line holds after this
pass rather than only during it.

| id | decision |
|---|---|
| D-POST-4-THE-THRESHOLD-IS-ARITHMETIC-ON-LENGTH | A chunk counts as read when dwell passes `max(floor, words / 240wpm * 60s * 0.5)`. A FIXED threshold would make a forty-word chunk always-read and a four-hundred-word chunk never-read, which measures chunk size rather than reading. The floor exists so a two-word chunk cannot be read by a blink. That formula is the entire model, and the suite recomputes it independently rather than trusting the response. |
| D-POST-4-DWELL-NEVER-TOUCHES-AN-ADAPTER | Dwell is the most intimate thing readwise produces — how long this person looked at each paragraph — so it is written straight into a sealed vault record. No adapter method takes a dwell value, which means no adapter payload can carry one; the suite asserts that by grepping the adapter INTERFACE, not by watching traffic. |
| D-POST-4-DISMISSAL-IS-A-BIN-NOT-A-VOID | X-ing out a chunk buries it, with its text, into a browsable bin that restores. If dismissal were irreversible people stop dismissing, and then the queue never drains — the mechanic stalls on the exact action it depends on. |
| D-POST-4-UNREAD-MEANS-IT-KEEPS-COMING-BACK | There is no separate requeue structure. A chunk that surfaced and was not read simply keeps surfacing, because the schedule already holds it and the dwell map already knows it is unread; a read one stops. The requeue COUNT is kept so the UI can say "you have skipped this three times" instead of silently looping it forever. |
| D-POST-4-PRIORITY-IS-A-WEIGHT-NOT-A-SCORE | A priority folder's chunks are emitted FIRST, so when the cadence slider is low they are the ones that fit. That is the whole mechanism: no decay, no learning, no per-item estimate. |
| D-POST-4-RE-CUTTING-STATES-ITS-COST | Changing the chunk-width slider re-cuts the queue on request and SAYS how many pieces it re-cut. The boundaries move, so chunk-level read marks from the old width stop naming anything; position within each piece is carried proportionally rather than reset, because somebody three chunks into an essay has still read that much of it and resetting them would be the slider punishing them for touching it. |
| D-POST-4-PROGRESS-IS-ROOT-SCOPED-BY-CONSTRUCTION | The dwell map is keyed by CHUNK, not by (persona, chunk). One device, one vault, one person reading: a paragraph read as one persona has been read. Progress therefore carries across personas without anything being copied or reconciled — there was never a per-persona copy. The suite asserts it by reading the same post as two personas. |

### What was built

`lib/readwise/state.ts` — the sealed namespace `readwiseState`: per-mode knobs
(`perBuild`, `chunkWords`), the priority-folder list, the dwell map and the
recycle bin, in one opaque padded record. `dwellThresholdMs()` is the formula
above; `progressFor()` is the root-scoped read.

`lib/adapters/types.ts` / `lib/adapters/mock/feedHealth.ts` — `scheduleReadwise`
gains a `targetWords` argument (the caller knows the mode; the adapter has no
business reading a vault preference) and `rechunkReadwise` re-cuts an existing
schedule, carrying position proportionally.

`lib/injection.ts` — `injectIntoFeed` gains a per-build `caps` override, so the
cadence slider can re-point the readwise cap without removing the flood
protection the module-level caps exist for.

`lib/feed.ts` — read chunks stop surfacing, buried chunks are out, priority-folder
chunks are emitted first, and the cadence knob applies both to the injected feed
and to the list below the caught-up banner (a slider that stopped applying there
would quietly become "except when you are caught up").

`app/api/readwise/route.ts`, `components/ReadwiseChunk.tsx` (an
IntersectionObserver that clocks only while the card is at least half on screen
and flushes on exit — nothing is sent per tick, because a per-tick stream of
"still looking" is a surveillance feed even encrypted),
`components/settings/ReadwisePane.tsx` and `/settings/readwise`.

`scripts/accept-pd4.mjs` (`npm run test:pd4`).

---

## GATE 5 — Three adversarial reviews, and what they cost

Three fresh-context reviewers over the diff since the browser-keystore pass
closed, on deliberately disjoint angles:

| report | angle |
|---|---|
| `research/attack-post-1.md` | scope enforcement and cross-persona disclosure |
| `research/attack-post-2.md` | the feed, the rules engine, the caught-up contract, and what an imported algorithm can reach |
| `research/attack-post-3.md` | the vault seam, cache coherence, and fail-open behaviour |

**They found three criticals and eight highs, and two of the criticals were
introduced by this pass.** That is the gate doing its job, and the honest
summary is that Gates 1 through 3 were not finished when they were committed.
Each reviewer was also asked to say what it checked and found SOUND, so the
reports are a disposition of the claims rather than a list of complaints.

### The findings that mattered most

| id | what it was |
|---|---|
| attack-post-1 F-7 | **The acting-persona cookie.** Gate 1 widened its ownership check from the seeded snapshot to "any persona this process has rendered" — and that map holds every SEEDED ACCOUNT, not just this device's. A crafted cookie naming a stranger would have been honoured, on a WRITE path, with none of view-as's banner. It is now an explicit allowlist that the switch route adds to only after checking the session roster. |
| attack-post-1 F-1 / F-3 | **Six findings of one shape.** The route that IMPLEMENTS compartment mode ignored it and listed every sibling's id, handle and accent; five more surfaces never asked the chokepoint at all — the persona↔fid map, the relationship-port table, the disclosure panel, the bindings matrix, and the lens delta, which also echoed a CALLER-SUPPLIED persona set back. `viewScope()` was well built and calling it was OPTIONAL. There is now one helper a surface reaches for instead of the unscoped set, so the narrowing travels with the list rather than with the discipline of whoever wrote the route. |
| attack-post-1 F-4 | **The fork route never checked ownership.** `lib/identity/clone.ts` says in its own docstring that "the route checks that". It did not: the only gate was a signing refusal that `carry: []` skips. A stranger's rules, modes and folders could be copied onto a new persona of the caller's root. |
| attack-post-2 F-1 | **One preference blanked a live timeline.** The facet-only rule is the one compiled rule carrying an `author.cluster` clause, and it was compiled whenever ANY account held ANY non-normal tier — which made the feed's "does a hide rule reference the author" question true and dropped every live cast whose author it could not resolve. Marking one friend never-miss blanked the timeline in network mode. |
| attack-post-2 F-2 | **Quiet was a block wearing derank's label.** The penalty was applied in the CORPUS sort, over every eligible post, before the window is cut at forty — so a quieted author got zero cards. The comment two hundred lines below already recorded this trap from when the demote feature hit it: the final sort is the only place a position guarantee survives. One feature later, the same trap. |
| attack-post-2 F-3 | **Tiers were inert on live content**, so quiet failed OPEN — the one direction this setting must never fail. |
| attack-post-2 F-4 | **`/api/rules` passed its action through unchecked**, so two requests minted a universal `pin` rule. The importer refused `pin` and `banner` by name; this route was the other door, and Gate 3's own check tested only the importer. |
| attack-post-3 F-1 | **A corrupted vault read as an empty one.** `decryptNamespace` drops a record it cannot decrypt, so a deleted, truncated or plaintext `_` came back as an EMPTY document marked loaded — compartment silently off, every quiet setting gone — and the next write sealed that emptiness over the real record. Permanently. All three new namespaces now refuse a namespace that holds records and yields none. |
| attack-post-3 F-3 | **The colourblind arithmetic was wrong.** The deuteranopia matrix had `0.7` where the Viénot matrix has `0.375`, and an identity blue row instead of `[0, 0.3, 0.7]` — so the red-green axis never collapsed. `setTint` would have ACCEPTED a violet a deuteranope cannot separate from the product blue, at a true distance of 4.1. And the Gate 2 suite carried a copy-pasted copy of the same mistake, which is the honest limit of "an independent implementation": independent CODE is not independent ARITHMETIC. Both corrected; the shipped palette re-measured against the corrected matrices and still clears at 15.05. |
| attack-post-3 F-2 | **`reloadIdentity()` forgot every sealed cache.** Its own comment says it exists to "forget every cache that belongs to the previous root". Unlocking under a second seed ran root B on root A's compartment flag, tier map, reading progress and bin — and the first write sealed root A's document into root B's vault, which is the one direction of this mistake that is not recoverable. |
| attack-post-3 F-5 | **A ghost protection.** `save()` adopted the in-memory document before the flush resolved and never rolled back, so a failed flush left a compartment flag this process believed in and the vault had never heard of — one that evaporated at the next restart. |

### What else changed

The feed no longer 503s the entire timeline when the tier vault is unreadable
(it degrades to Normal delivery, which is what the posture already promised);
the preview strip no longer survives a fully exhausted feed; the auto-tint
de-dupes PERCEPTUALLY rather than by string, so choosing `#f4a525` can no longer
leave a sibling on `#f4a524`; a persona created after this gate PERSISTS the
accent it was assigned rather than having it drift when the roster changes; the
key separator is refused inside an id; and two OLDER sealed caches that had no
reset function at all now have one — their next write was resurrecting every
anon-reveal secret a seed reset had just wiped. That last one is outside this
pass's diff, and it is fixed anyway: it is the same bug class this pass keeps
finding, and leaving it after a review named it would have been a choice.

### The structural lesson

Three of the eleven high-or-critical findings are the same sentence: **a
protection that has to be invoked is a protection that will be forgotten.**
`viewScope()` was correct and optional; the rules-action allowlist was correct
and lived in one of two doors; the sealed-cache reset list was correct and had
to be extended by hand for every new namespace. Where it was cheap, the fix was
to move the check into the thing callers already reach for. Where it was not,
the reset lists are now named in a comment on each other, so the next namespace
that forgets is a diff a reader can see.

### Gate 5, second round: every finding re-checked by somebody who was not me

Writing fixes and then reporting them fixed is the failure mode this gate is
supposed to catch, so the fixes went back out for verification. Each of the 47
findings was handed to an INDEPENDENT verifier that did not have the report —
only a self-contained restatement of the claim — and was told to be adversarial
about any fix it found and to try to defeat it before calling it closed. The
full disposition is `research/attack-post-disposition.md`.

**The first round scored 4 FIXED, 24 PARTIAL, 19 OPEN.** The verifiers found
residual gaps inside my own fixes, and several were worse than the finding.

| what the verifiers found in the fixes | |
|---|---|
| The rollback was a no-op | `save()` captured `previous = g.__cache` while every mutator did `doc.field = x; save(doc)` on that very object — `previous` and `doc` were the same reference, so the rollback restored the mutation. Mutators now build a NEW document and `save()` throws if handed the cached one. |
| The empty-read case was untouched | The `!rec` guard only fires when records are PRESENT and unreadable. The validator answers a MISSING namespace with `200 {entries:{}}`, so an operator DELETING the rows still read as "never written" — and the next write sealed that emptiness over the real record. `lib/vault/sealedPins.ts` now keeps a device-side note of what has been sealed; an empty read for a pinned namespace is a refusal. The same remedy this project already used for the ZK anchors when the identical finding was raised against them. |
| Seven older namespaces had the same shape | The review named five; the verifier found two more. All ten sealed modules now carry the guard, not just the three this pass introduced. |
| The live-path delivery fix was half a fix | Giving the live evaluation a delivery context fixed `quiet` (decided after the live merge) and not `pin` or `banner` (frozen from the seeded corpus a hundred lines earlier) — a live cast matched the pin rule and was silently ignored. Half a fix reads exactly like a whole one from outside. |
| The caps were exhausted by invisible entries | On a live timeline the seeded posts filling `pinSet` and `previewStrip` are not on the page at all, so the back-fill broke on its first iteration: a banner account's live casts never reached the strip, and ten never-miss accounts made the pin key a no-op. Both are recomputed over the cards actually rendered. |
| "Never fail open" was verified by nothing | Neither suite had a single unreadable-vault check. The new one immediately found that the guarantee does not hold the way the module header claims: a process that has already decrypted a document does not re-read it, so corrupting the record changes nothing until the cache is cold. That is true of every sealed namespace and is now stated as A-POST-TAMPERING-IS-CAUGHT-AT-THE-NEXT-COLD-READ, with a rig hook so the cold path can be exercised at all. |

### The mistake I made three times

Three of my scope fixes were aimed at the wrong predicate, and the suites caught
each one:

- the fork check refused forking **any** persona you do not own — but the fixture
  fork demo deliberately forks a seeded ACCOUNT to show forward pointers and
  grant carry;
- the lens-delta check refused a caller-supplied persona set — but that
  parameter is an ANALYSIS input naming a coordinated cluster of other accounts,
  whose accruals are public validator rows;
- the linkage probe filtered to visible personas — but it is the safety set's
  own scanner, and the records it scans FOR are injected and foreign ones.

In every case the leak was narrower than the check: not "this persona is not
visible" but **"this is one of MY personas that the current scope hides"**.
Scoping by the broader predicate broke three suites and, worse, would have
disabled two of the product's own analysis surfaces while claiming to secure
them. The fixes are now aimed at the sibling set, and what a non-owned source
may hand you (its settings, its tier) is gated where it actually transfers.

### What is carried rather than fixed

Five residuals are recorded as assumptions by id rather than closed, because
they are inherent rather than unfinished: the 1 KiB padding step leaking a
MAGNITUDE (never a name), the pin file being a loud-refusal mechanism and not
integrity, the fixture fork being a demo affordance, the acting cookie still
being a cookie within its own root, and tampering being caught at the next cold
read. The low and nit-grade documentation residuals are listed in the
disposition with their evidence; they change no behaviour.

---

## /verify — the closing bar

**Four consecutive clean sweeps on identical code at `e2d909e`:**

| sweep | checks | failed | infra |
|---|---|---|---|
| 1 | 623 | 0 | 0 |
| 2 | 623 | 0 | 0 |
| 3 | 623 | 0 | 0 |
| 4 | 623 | 0 | 0 |

83 suites each, including `rootleak` and `substrate` (the leak greps),
`device-restart` (restart survival), `no-keystore`, and all five of this pass's
own. `tsc` clean, `docs:check` clean at 66 pages and 892 citations, the
secret-path guard at 4, the working tree clean.

The baseline moved 585 → 623 checks over the pass: 37 new checks across
`test:pd0` … `test:pd4`, plus the fail-closed check Gate 5 added to `test:pd2`.

### What the closing series cost, and what it found

Nine sweep series ran before four held in a row. **Not one reset came from the
product** — the code was clean in every sweep that reached it. They came from:

| | |
|---|---|
| orphaned validators holding `:4001` (×4) | the sweep's last suite kills the validator on purpose, and the child outlives its parent; a new supervisor then spawns children that can never bind |
| my own guard, twice | it counted supervisor PROCESSES, and a count cannot tell "the npm wrapper and its child" from "two unrelated lineages" — both are 2. The invariant is whether the `:4001` listener still has a live PARENT, and only the third version asked that |
| the tint-leak needle | `pd2` searched nine million characters of hex ciphertext for six bare hex digits; the expected number of chance hits is about one in two. It passed on a small database and failed on a full one |
| a transient `fetch failed` | `z4`'s session setup, cascading into four dependent checks that never ran |
| **97 accumulated block rows** | the last one, and the most interesting: `resetSeed` clears adapter state but not validator TABLES, so fifteen sweeps of block-testing suites had blocked nearly every author in the small phase-1 fixture cast set, and the classic feed rendered empty. The settle guard was right that a suite had left the app in a non-default state — the state had simply accumulated across sweeps rather than within one |

That last one is a real gap in the reset contract rather than a bad day: a
long-lived rig drifts, silently, into a state where a fixture surface renders
nothing. It is recorded as an open issue.

### The honest summary of this pass

Five gates shipped. Three adversarial reviews found 3 criticals and 8 highs,
**two of the criticals introduced by this pass**. Re-verifying those fixes with
independent verifiers found the first round had genuinely closed only 4 of 47
findings — including a rollback that was a no-op because `previous` and `doc`
were the same object reference.

Three of my scope fixes were aimed at the wrong predicate and were caught by
the suites: the leak was never "this persona is not visible" but "this is one
of MY personas that the current scope hides". And one review finding was
deliberately NOT taken — the fork's tier carry, because it is a contract this
product states and tests, and a finding outranks an unstated assumption rather
than a stated one.

Everything not fixed is carried as an assumption by id in SECURITY-POSTURE.md
§17, with its cost written down.

