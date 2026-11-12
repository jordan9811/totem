# REPORT-MEGA2 — "The rails are open": reputation UBI, lenses, modular UI, interop hooks, the docs site

Prompt: `notes/prompts/mega-pass-2-prompt.md`. Started 2026-09-15 from `9d809bc` (Multi-FID
pass closed on `526addf`; the anoncast reveal on top). Orchestrator: Fable 5.1;
subagents (Gate 7 reviewers, Gate 8 page-writers only) on Opus/Sonnet with
the model set explicitly. Fixture, pinned ports, fixed runner. Live spend
allowed only in Gate 5, read-only, ≤ $1, only if X credentials exist.

## Standing judgment calls (this pass)

- **The early-to-content curve is config, not mechanic.** Everywhere the
  prompt's design intent is fuzzy (the curve, the creator-economy tie-in),
  the build is the conservative parameterized version, marked
  `// TUNE: owner has unresolved design intent here`, and listed on the
  docs site's open-issues page (Gate 8).
- **No dwell.** The prompt names dwell among the confirmation signals for
  accrual. The relationship event log bars dwell/impression events by
  construction (a closed union, grepped by a suite); rewarding "how long
  people looked" would need the surveillance that log exists to refuse.
  Accrual uses non-retraction, community notes and standing instead, and
  says so (A-MEGA2-NO-DWELL).
- **Less claimed, more refused, more logged by id.** Where anything else
  was undecidable.

---

## GATE 1 — Reputation UBI (the backbone; single-threaded)

**The mechanic.** Every root receives a recurring, non-transferable
allowance of influence per epoch. Acting (recast, like, note, refute,
curate) spends some of it as a STAKE on that content — a signed, public,
per-persona event carrying a DIRECTION on a spectrum (`good`,
`worth-reading`, `wrong`, `misleading`, `note-worthy`). Stakes a delayed
evaluation later confirms accrue reputation on the ROOT through the
existing rep machinery, which raises the next epoch's allowance. Influence
is monetizable only downstream; there is no transfer, and the type system
says so.

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-1-ALLOWANCE-IN-THE-VAULT | The balance is ONE opaque padded sealed vault record (`influence` namespace: `{epoch, allowance, remaining, tier}` + per-action settings + the owner's own stake mirror + settled accruals). The validator never sees a balance, a root beside a stake, or the tier the allowance came from. Fail-closed reads like every sealed record: a read that fails is a refusal, never an empty document a later save could seal over. |
| D-MEGA2-1-NO-TRANSFER-BY-TYPE | The `InfluenceAdapter` contract has `allowance / stake / historyFor / stakesForCast / setSettings` and nothing that names a second account. `lib/influence/types.ts` carries `INFLUENCE_HAS_NO_TRANSFER: [Extract<keyof InfluenceAdapter, "transfer" \| "send" \| "move" \| …>] extends [never] ? true : never = true` — adding such a method fails `tsc` before it fails a test. The suite greps the contract, the modules and the API too. |
| D-MEGA2-1-ALLOWANCE-FROM-THE-PROVEN-TIER | `allowanceForTier(tier) = 10 + 4·tier` (`// TUNE`), computed at recharge from the HIGHEST tier any of the root's personas holds: under zk, what it PROVED this epoch (0 = nothing yet → no allowance until the first proof lands — an unproven persona has no tier at all); under the legacy bindings, the legacy tier. An unreachable rep adapter throws rather than granting an allowance on a guess. |
| D-MEGA2-1-RECHARGE-PER-EPOCH-NEVER-FRONT-LOADED | The epoch is the validator's (`fetchEpoch`), the same clock every proof uses. A balance stamped with an earlier epoch recharges to exactly the allowance; one stamped AHEAD of the validator's clock is corruption or front-loading and is reset to the current epoch's allowance, never honoured. Nothing adds to a balance inside an epoch. |
| D-MEGA2-1-RESERVE-THEN-SEND-THEN-REFUND | A stake is reserved from the balance BEFORE the send and refunded if the validator refuses — the balance never goes negative and never pays for a stake the network did not take. An overdraw is a typed refusal (`overdraw`, HTTP 409), never a negative number. |
| D-MEGA2-1-STAKE-IS-A-PERSONA-SIGNED-PUBLIC-EVENT | A stake is signed with the persona's EXISTING key over `layers-stake/1\|mode\|persona\|cast\|action\|direction\|amount\|epoch\|nonce` (a DELIBERATE DUPLICATE in `validator/stakes.js`), stored per persona with its key, hour-grained, WITHOUT ROWID. The validator verifies the signature under the key it is given and CARRIES it; the reader re-verifies every row against the key it resolves for the persona (`publicKeyForPersona`) and treats an unverifiable row as absent — exactly the refutation-edge discipline. The validator cannot tell an over-spent stake from an honest one and does not try (A-MEGA2-VALIDATOR-CANNOT-SEE-OVERDRAW). |
| D-MEGA2-1-ACTION-STANDS-WHATEVER-THE-STAKE-SAYS | A like/recast/refute/note carries the user's default stake for that action (`DEFAULT_STAKE`, settable per action, zero = none; `stake: null` opts out per call). The stake result is REPORTED beside the action's own success; a refused stake is never a failed like. |
| D-MEGA2-1-SPECTRUM-ROUTES-ADDITIVELY | `note-worthy` stakes count as stake-backed endorsements toward the community-notes two-endorsement gate (`feedHealth.reinjectionsFor`, reason names them); `wrong`/`misleading` land on the refutation surface (`GET /api/refute` carries the aggregate) and on the correction card (`stakeWrong`). The STANDING rule is untouched — volume still counts for nothing there; stakes are additive signal, not a gate. |
| D-MEGA2-1-ACCRUAL-IS-A-PURE-FUNCTION-OVER-PUBLIC-ROWS | `evaluateStakes(rows, ctx, curves)` is pure and runs on the validator's public rows, so anyone can compute any persona's accrual under any curve set — that is the legibility the mechanic promises, and it is what a lens's `influenceDistribution` plugs into (Gate 2). Confirmation: `good`/`worth-reading` → no qualifying note AND standing held; `wrong`/`misleading` → a qualifying note OR standing lost (or the cast retracted); `note-worthy` → a qualifying note. The early curve is one weighted term (rank among the cast's stakers, halving every `halfLifeRank`), `// TUNE`. |
| D-MEGA2-1-ACCRUAL-LANDS-ON-THE-ROOT-THROUGH-REP | `settleStewardship()` evaluates the PREVIOUS epoch only (the window must close), posts `POST /events {rootId, type: "stewardship", count, sourceId: "stewardship:<epoch>"}` with the account's OWN root handle (the same device-side read the legacy tier uses), idempotent by sourceId on both sides. `validator/rep.js` gains `stewardship: 4` (`// TUNE`). The tier trees rebuild from rep at the next epoch, so under zk the persona proves the new tier the way it proves any tier — no new claim kind, no new scope, no new primitive. |
| D-MEGA2-1-HISTORY-AT-THE-EXISTING-DISCLOSURE-LEVEL | A persona's stake history is served to its owner always and to anyone else only if the persona's EXISTING disclosure grant admits them (`disclosure.canViewLinkage` — one level, not a second setting). A disclosure read that fails is a refusal (503), never the rows. Per-cast rows are public by design (A-MEGA2-STAKE-ROWS-ARE-PUBLIC): disclosure governs the app's history view, not the validator's per-cast table. |
| D-MEGA2-1-COORDINATION-IS-DETECTABLE-NOT-ENFORCED | `detectClusters(rows)`: ≥3 personas sharing ≥3 casts with the same direction in one epoch, connected components — pure, on the public rows, rendered in the influence layer. Nothing refuses, weights or punishes here; a lens may. |
| D-MEGA2-1-SEEDS-THROUGH-THE-PRODUCT-PATH | Seeded history is signed by the fixture personas' own keys and posted to the real `/stakes` endpoint — no seed-only door. Deterministic nonces make ids stable; re-seeding is a no-op. The seed avoids note_5 (one endorsement) so stake-backed endorsements never flip a seeded baseline older suites assert. |
| D-MEGA2-1-CARD-STAYS-PARITY | The stake summary rides the cast card as a HIDDEN, assertable span; the default UI keeps the spectrum quiet. The influence layer (`/settings/influence`) is where it shows. |

### Built

`lib/influence/{types,allowance,stakes,accrual,clusters,seed}.ts`,
`lib/adapters/mock/influence.ts` + the `InfluenceAdapter` contract and
registry slot, vault namespace `influence`, `validator/stakes.js` +
migration 14 (`stakes`), `rep.js` `stewardship`, `/events` VALID,
`app/api/influence` (views allowance/history/cast/clusters/accruals/
evaluate; actions stake/setSettings/settle), stakes on the react / refute /
annotations-vote routes, stake-backed endorsements in
`feedHealth.reinjectionsFor`, summaries on cards + `stakeWrong` on
correction cards, `/settings/influence` (`InfluencePane`), the seed,
`docs/root-reads.md` §G, suite `scripts/accept-mega2-g1.mjs` (`test:m2g1`,
8 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | tsc strict clean, validator units 40/40 with migration 14; `test:m2g1` **7/8** — the one failure was real: the accrual named the seed's INTERNAL root id (`root_viewer`) while the validator knows the account by the id it minted at registration (`root_<hex>`, fid 9152) — the same handle the zk registration resolves through `rootForFid(getSelf().fid)`. Fixed to resolve the root exactly as registration does; the suite reads the root from the operator's own `roots` table (as the operator would) instead of assuming the seed's name |
| 2 | **7/8** — check 5 (accrual through rep, proven under zk) now green end to end: a proven persona stakes from its allowance, the closed window settles a `stewardship` event on the validator-minted root, the root moves a tier, the persona proves it. The one failure was the RIG: check 5's `resetZk` moves the epoch clock, and check 6's reset re-seeds the coordinated cluster relative to the epoch current THEN, so the epoch recorded at suite start no longer held it. The suite now reads the epoch when it looks |
| 3 | **8/8** (suite fix only; no product change) |

**Exit (Gate 1):** allowance recharges per epoch and never overdraws (adversarial, check 2); no transfer method exists (grep + the type-level assertion, check 1); stake events sign/verify and a foreign-key row is excluded by the verified read (check 3); spectrum directions route into the notes and refutation surfaces (check 4); accrual moves root rep through the existing path and a persona proves the new tier under zk on the fixture universe (check 5); stake history renders at the owner's disclosure level and nowhere else, fail-closed (check 6); the coordinated cluster is visible in the influence layer (check 7); the sealed namespace is ciphertext and no balance touches the validator (check 8). Regression set before the commit (18 suites, all green): z6 6/6 (after naming `lib/influence/allowance.ts` in `docs/root-reads.md` — its `adapters.rep.tierFor` read is the proof-mediated one, and the register must list every module that makes it; the first run caught the omission), rootleak clean (55 payloads), z0 11/11, functional, accept 14/14, g1 5/5, g2 4/4, g3 7/7, a4 8/8, a5 6/6, a6 7/7, c4 7/7 (total-device-loss recovery with the new sealed namespace), x3 8/8, fid4 8/8, fid5 8/8 (linkage v4 still at the floor with stake rows in the DB), z9 9/9, att4 10/10, runner 7/7. `test:m2g1` joins `sweep-x.sh`: baseline 495 checks / 66 suites.

---

## GATE 2 — Lenses: the algo through different curves (single-threaded)

**What a lens is.** A named weighting over the same canonical signals —
not just what is ranked, but how influence is counted. It is serializable,
signed and shareable through the EXISTING portable-algorithm pipeline: a
lens IS an `AlgoArtifact` (`kind: "lens"`) carrying a `lens` section
(`signals` + `influenceDistribution`). Same signature, same mandatory
preview, same guardrails, same provenance chain. Modes gain a `lens` field;
a filter pack may pin one.

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-2-CANONICAL-IS-THE-IDENTITY | The canonical lens has every signal weight 0 and the canonical curves, so the feed under it is byte-for-byte the feed without one. "View the global algo through a different lens" is literally switching `mode.lens`; nothing about the default changed. The mode's own `ranking`/rules stay the base; a lens ADDS terms over the canonical signals. |
| D-MEGA2-2-A-LENS-IS-AN-ARTIFACT | `AlgoArtifact.kind` gains `"lens"`; `lens?: LensSpec` rides the artifact (inside the signature: `canonicalForm` includes it); `sanitizeArtifact` whitelists it through `lib/lens/sanitize.ts`. Export (`GET /api/lenses?export=`), preview (`/api/algo/preview`) and import (`/api/algo/import`) are the existing routes. An algo that carries a lens section pins that lens on the mode it becomes; a pack that carries one pins it on any mode that runs the pack and has no lens of its own (the mode's own pin always wins). |
| D-MEGA2-2-GUARDRAILS-BY-NAME-FATAL | Inside the lens section, a key that reaches for the destination indicator, correction cards, disclosure, the k-floor or the allowance overdraw rule (`LENS_PROTECTED_KEYS`, matched by name) is REFUSED and kills the whole import; any other unknown key or out-of-range weight is STRIPPED and REPORTED. The existing rule/flag guardrails still apply to the rest of the artifact. |
| D-MEGA2-2-STRIPPED-IS-NOT-SIGNED | A lens section that had to be stripped no longer matches what its author signed: the import refuses on the signature. The preview still reports every stripped field by name, so "why won't this import" is never a mystery. |
| D-MEGA2-2-PREVIEW-SHOWS-INFLUENCE-TOO | A lens preview is the SAME feed ranked without and with the lens — the identical `buildFeed` path activation uses (`lensOverride`), so the counts are exact — plus the influence delta: this root's accrual last epoch under the lens's `influenceDistribution` vs the canonical curves, computed by the same pure `evaluateStakes`. |
| D-MEGA2-2-EVALUATE-IS-THE-RANKING | `GET /api/lenses/:id/evaluate?castId=` returns the mode's own ranking terms (`baseRankTerms`, which `rankScore` is now defined as the sum of) and the lens terms; the breakdown sums to the score exactly because the feed ranks with exactly these numbers. No black box. |
| D-MEGA2-2-DWELL-IS-CONTENT-NOT-BEHAVIOUR | The `dwell` signal is the reading-time DEMAND of the content (its length, plus the long-form flag), never measured viewer attention: the relationship event log bars dwell/impression events by construction and this build honours that. The seeded "dwell-heavy, early-curve-off" lens ("Slow reads") weights long reads and worth-reading stakes up, quick engagement down, turns the early curve off, and discounts coordinated staking by half. |
| D-MEGA2-2-COORDINATION-DISCOUNT-IS-THE-LENS-AUTHOR'S | `InfluenceCurves.coordination {enabled, penalty}`: a lens may discount stakes inside a detected cluster (`detectClusters`, Gate 1). Canonical: off. Legibility made actionable by whoever writes the lens — never enforced by the platform. |
| D-MEGA2-2-LENSES-ARE-PUBLIC-STATE | Stored lenses (`lenses` namespace) are public artifacts like filter packs and algo cards — not vault material. A mode's `lens` pin is mode state (persisted with the mode). |

### Built

`lib/lens/{types,signals,sanitize,service}.ts`, `lib/influence/curves.ts`
(the curve set, pure; `accrual.ts` re-exports it and applies the
coordination discount), `AlgoArtifact.lens` + `kind: "lens"` through
`lib/algo/artifact.ts` and `lib/algo/service.ts` (export / preview with the
influence delta / import + pin), `ModeDefinition.lens`, `buildFeed`'s
`lensOverride` + lens terms in the ranking + `baseRankTerms`/`tierResolver`
exports, `lenses` store namespace + seeding, `GET/POST /api/lenses`
(list / export / delta / preview / apply), `GET /api/lenses/:id/evaluate`,
packs pin a lens (`exportPack.lens`, `/api/packs/export {lensId}`),
`/settings/lenses` (`LensPane`: pick, side-by-side re-rank preview with
the influence delta, apply, share, import), suite
`scripts/accept-mega2-g2.mjs` (`test:m2g2`, 7 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | tsc strict clean; validator units 40/40; `test:m2g2` **6/7** — six of seven green on the first run (round trip with exact counts + the influence delta, measurable re-rank with canonical as the identity, the evaluate breakdown summing exactly, the cluster's accrual reduced under the dwell-heavy lens, a pack pinning a lens, stripped-never-silent). The one failure was the RIG: my probe for the composer destination indicator read raw SSR HTML for a public persona; the indicator renders client-side for a PRIVATE persona (the Tier A hostile-artifact check probes it that way). The hostile lens itself was refused with all five guardrails named |
| 2 | **7/7** (probe fix only; no product change) |

**Exit (Gate 2):** lens round-trips through the algo pipeline with exact preview counts AND the influence delta (check 1); switching lens on a mode re-ranks the seeded feed measurably and canonical is byte-for-byte the identity (check 2); hostile lens refused on all five guardrails by name with the five surfaces intact (check 3); the evaluate API breakdown sums to the score (check 4); the dwell-heavy lens reduces the coordinated cluster's accrual — the legibility test (check 5); a pack pins a lens, the mode's pin wins (check 6). Regression set before the commit (18 suites, all green): m2g1 8/8, a2 7/7 (portable algorithms — the artifact pipeline the lens rides), a1 11/11, a3 6/6, b1 5/5, b2 6/6 (filter packs), ux1 13/13 (modes), ux3 9/9, g1 5/5, g2 4/4, g3 7/7, functional, accept 14/14, z6 6/6, rootleak clean (55 payloads), c4 7/7, fid4 8/8, runner 7/7. `test:m2g2` joins `sweep-x.sh`: baseline 502 checks / 67 suites.

---

## GATE 3 — Scroll zones + configurable action buttons

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-3-ZONES-ARE-LAYOUT-CONFIG-THE-CARDS-CONSUME | A zone config is `{layout, zones[], insetPx, viewport}` with rects in PERCENT of the viewport; the base is always the timeline. Under a reading layout a long-form card renders its article in a `data-scroll-target="longform"` container that owns its scroll; the `ScrollZoneShell` routes wheel/touch by a pure hit-test (`lib/zones/types.ts`) — inside a reading zone the container under the pointer scrolls, everywhere else the browser scrolls the timeline as it always did. No zones → no listener attached (X parity). |
| D-MEGA2-3-ZONES-ARE-VAULT-DATA-PER-DEVICE | One opaque padded sealed record (`scrollZones`) keyed by the device-auth public key. A layout is a fingerprint of a hand and a habit; the validator sees ciphertext. |
| D-MEGA2-3-EDGE-BANDS-REFUSED-BY-NAME | A non-timeline zone that enters the OS edge-gesture band (inset default 20 px, 0..120 configurable; a px check on the calibrated viewport) is refused at save with the edge named, by the API and by the pane (which also warns live while dragging). |
| D-MEGA2-3-DRAWN-NOT-TYPED | Calibration is a live scaled preview of the user's own screen: drag the zone body to move, a corner handle to resize, a hit-test overlay says what each point would scroll, the inset bands are hatched. Presets: default, reading, left-handed, right-handed. |
| D-MEGA2-3-MOBILE-UNMEASURED | Playwright's synthetic wheel/touch is what the suite drives. Real-device behaviour is UNMEASURED; tuning on a phone is required and listed on the open-issues page. |
| D-MEGA2-3-ROW-BOUND-PER-MODE-DEFAULT-IS-X | `actionButtonSlots.cast` (one action id per slot) rides the mode; `castRowFor()` returns X's row exactly when a mode has none. The card renders the bound row with the SAME components; the Default row's DOM (tags, attributes, inline SVG) is asserted identical to a baseline captured from the pre-Gate-3 build (`scripts/fixtures/action-row-baseline.html`, `scripts/capture-action-row.mjs`). |
| D-MEGA2-3-LONG-PRESS-BINDS | 550 ms press (or right-click on desktop) on any button opens that slot's picker; the tap that ends a long-press is swallowed so rebinding never fires the button. The pick is a PATCH on the mode, validated by name on the route (unknown or duplicated actions refused). The mode builder edits the same row with per-slot selects. |
| D-MEGA2-3-EXTRA-BINDINGS-ARE-HONEST | Bindable ids: recast, like, stake-as, bookmark-to-folder, send-to-friend, mark-caught-up, act-as, refute, note, custom-rule (plus X's reply / views / bookmark / share). One-tap where a one-tap API exists (`stake-as` → a `curate` stake; `mark-caught-up` → the story's saturation); the relevant SURFACE otherwise (`bookmark-to-folder` → folders, `send-to-friend` → feed health, `refute`/`note` → the thread, `custom-rule` → rules; `act-as` → the card's ··· menu). Named here rather than faked as one-taps. |
| D-MEGA2-3-CURATE-SEEDS-A-DIFFERENT-ROW | The Curate preset carries `bookmark-to-folder` and `stake-as`; Default is untouched. |

### Built

`lib/zones/{types,store}.ts`, `app/api/zones` (get / save / preset /
hitTest), `components/ScrollZoneShell.tsx`, the reading-layout long-form
body in `CastCard`, `components/settings/ScrollZonesPane.tsx` +
`/settings/zones`, `lib/actions/bindings.ts`, `ActionRowContext` +
`ActionBindingPicker`, the bindable `ActionRow`, the mode route's row
validation, the mode builder's cast-row editor, `SeededTimeline` providing
the binding + shell, the parity baseline fixture, suite
`scripts/accept-mega2-g3.mjs` (`test:m2g3`, 8 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | tsc strict clean; `test:m2g3` **7/8** — parity (the Default row's DOM identical to the pre-Gate-3 baseline), bindings per mode with duplicate/unknown refused by name, the long-press picker, calibration by drawing (a dragged handle saves and reloads), and the edge-band refusal all green on the first run. The one failure was the RIG: check 6 looked for a long-form article in the DEFAULT window, and the seed's ten articles are old — none rank into it. Under a long-form-weighted mode (Curate) all ten render with their own scroll body; the suite now reads under that mode, which is what a reading session is |
| 2 | **8/8** (rig fix only; no product change) |

**Exit (Gate 3):** the reading layout scrolls the article in the center band while the outer band scrolls the timeline, with synthetic wheel AND touch at coordinates (check 6); calibration saves and reloads per device, including a DRAWN change (check 4); an edge-band overlap is refused with the edge named, by the API and by the pane (check 5); button bindings persist per mode and the Default row is DOM-identical to the pre-Gate-3 baseline (checks 1–3); no zones → no router, the article stays clamped with Show more (check 8); zones are ciphertext (check 7). Mobile behaviour: UNMEASURED. Regression set before the commit (19 suites, all green): m2g1 8/8, m2g2 7/7, ux0 6/6, ux1 13/13, ux2 8/8, a3 6/6, a5 6/6, b2 6/6, g1 5/5, g2 4/4, g3 7/7, functional, accept 14/14, z6 6/6, rootleak clean (55 payloads), c4 7/7 (device-loss recovery with the sealed zone namespace), fc4 6/6, fid4 8/8, runner 7/7. `test:m2g3` joins `sweep-x.sh`: baseline 510 checks / 68 suites.

---

## GATE 4 — Unified search (vault-local, keyword + AI)

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-4-THE-INDEX-IS-THE-DEVICE'S | The index is built in the process that holds the decrypted vault, from the vault-backed stores (own casts, private posts, DMs, likes, bookmarks, stakes, relationship events, imported archives), and never leaves it: no query over private data and no private index is ever sent to the validator, which has no search endpoint touching vault types (the suite greps it) and whose database never carries a query. It is re-derived on demand (a change to the record set rebuilds it) and never stored plaintext anywhere — that is how it survives a restart. Searches keep answering with the validator's port closed once the vault is in memory (the suite kills the validator and searches). |
| D-MEGA2-4-SINGLE-ROOT-BY-CONSTRUCTION | Every indexed record belongs to one of THIS device's own personas. Other roots' private posts a grant lets this viewer read are not "things this user touched" and are not indexed. |
| D-MEGA2-4-BM25-NOT-A-DEPENDENCY | The full-text engine is a dependency-free inverted index with BM25 and light stemming (`lib/search/index.ts`) — the honest equivalent of "a WASM FTS engine" without shipping one. Results are grouped by type; matched terms ride each hit. |
| D-MEGA2-4-THE-LOCAL-MODEL-IS-A-LEXICON | AI search is local-first and the "model" is a synonym-cluster embedding shipped in-repo (`lib/search/lexicon.ts` + `embed.ts`, 512 dims), run in a worker thread (`embedWorker.ts`, a DELIBERATE DUPLICATE the suite pins to the in-process arithmetic). It finds a paraphrase where the lexicon knows the words are kin and says which meanings matched. It is NOT a neural model; a MiniLM-class encoder is a drop-in behind the same `embed(text) → vector` interface, and shipping one means shipping weights, which this pass does not do (A-MEGA2-EMBEDDING-IS-A-LEXICON). |
| D-MEGA2-4-DEGRADE-AND-SAY-SO | If the device cannot run the model (the worker fails, times out, or is forced unavailable by the rig), semantic search answers by keyword with `degraded {from, to, reason}` and the page says so in words. |
| D-MEGA2-4-CLOUD-OFF-NAMED-CONSENT-FIXTURE | The cloud path is OFF by default. A cloud query first returns `needsConsent {provider, snippets: N, queryHash, preview[]}` — "send these N snippets to <provider>?" — and sends nothing; only a consent that matches the provider, the count AND the query hash runs the provider, which in this build is a FIXTURE reranker: nothing leaves the process even after consent, and the suite asserts what would have (`cloudSends`). |
| D-MEGA2-4-PRIVATE-CHROME | A private record (a private post, a DM, anything by a private persona) carries `private: true` and renders with the private chrome ("Private · only you", dashed) in the results. The public search above the box is unchanged. |

### Built

`lib/search/{index,lexicon,embed,embedWorker,unified}.ts`,
`GET/POST /api/search/unified` (status / search / dev hooks),
`components/UnifiedSearch.tsx` on `/search` under the existing public
search, the dev reset hooks, suite `scripts/accept-mega2-g4.mjs`
(`test:m2g4`, 8 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | 7/8 — check 3 failed on the RIG, not the product: the paraphrase shared a stem (loan / loans) with the canary, so keyword already found the private post and the semantic test proved nothing. Paraphrase changed to words the lexicon knows as kin but the tokenizer does not (credit / affordable / currently). |
| 2 | 8/8. |

**Exit (Gate 4):** one box over at least five record types, grouped by type (check 1); private chrome, and every indexed record belongs to one of this device's own personas (check 2); a paraphrase finds the private post through the local model with the shared meanings named while keyword finds nothing, and the worker embedding equals the in-process one (check 3); when the model is unavailable the box answers by keyword and says so (check 4); cloud off by default, an exact named consent hands the fixture provider N snippets, a mismatched consent sends nothing (check 5); network level: no search endpoint on the validator, keyword AND semantic answer with the validator port closed, no query or private text in its DB (check 6); the index survives a drop by re-derivation and the vault namespace is ciphertext (check 7); the search page renders the one box with grouped results (check 8). Regression set before the commit (19 suites, all green): m2g1 8/8, m2g2 7/7, m2g3 8/8, ux0 6/6, ux1 13/13, ux3 9/9, a3 6/6, b2 6/6, g1 5/5, g2 4/4, g3 7/7, functional, accept 14/14, z6 6/6, rootleak clean (55 payloads), c4 7/7, fid4 8/8, fid5 8/8 (linkage v4 unchanged with the index in memory), runner 7/7. `test:m2g4` joins `sweep-x.sh`: baseline 518 checks / 69 suites.

---

## GATE 5 — @layers on X: the DM-to-bookmark hook

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-5-INBOX-IS-AN-ADAPTER-READ-ON-DEMAND | `LayersInboxAdapter { poll(cursor), reply(dmId, text) }` — fixture (recorded DM shapes in `fixtures/x-dms.json`, paged by cursor) or live (X API v2 `dm_events`, read-only, only with `X_API_CLIENT_ID` + `X_LAYERS_INBOX_TOKEN` + `ENABLE_X_READ=true`). Polling is on demand — a button, an API action, never a background loop — and every poll is ONE costed read through the existing spend ledger (`guardedRead`, the read rate, the $1 run cap). |
| D-MEGA2-5-SENDER-RESOLVES-THROUGH-THE-ATTESTATION | The sender's handle → persona resolution is the EXISTING X attestation (`attestationByHandle`), nothing new is stored on the validator to make it work. The fixture's `$LINKED` sender is whichever handle this device attested, so the linked path exercises a real attestation. |
| D-MEGA2-5-LINKED-LANDS-IN-THE-VAULT-AND-THE-QUEUE | A linked sender's link lands as an `xImportedPrivate` record with `provenance: "x-dm"` (a SEALED namespace), keyed by the synthetic post hash `dm:<tweetId>` so the private "From X DM" folder, the readwise schedule and the vault record all name one thing; the synthetic post is rebuilt from the vault on hydrate (`replayDmPosts`) and purged on reset, like cold-store items. Idempotent by tweet id. |
| D-MEGA2-5-UNLINKED-GETS-THE-FUNNEL-AND-NOTHING-IS-KEPT | An unlinked sender gets the reply ("link your X account first") — recorded in a session-only log with the sender HASHED, never sent by this pass (read-only on X, said as such) — and nothing is stored: not the DM, not the handle, not the link. Linking is the funnel. |
| D-MEGA2-5-CADENCE-IS-THE-MODE'S | `mode.dmReadwise { every, appearance }`: DM-sourced readwise items surface every N feed builds for that (persona, mode) — one tick per build — as a chunk or in full. "Eventually they'll read it unless they remove it." |
| D-MEGA2-5-LIVE-IS-THE-USER'S | `scripts/live-m2g5.mjs` is the one real DM read, itemized; it refuses without the credentials and makes no network call when it refuses. No credentials exist in this environment: fixture-verified, live skipped, $0.00. |

### Built

`lib/x/inbox.ts`, `fixtures/x-dms.json`, `GET/POST /api/x/inbox`,
`/settings/dm-hook` (`DmHookPanel`), `ImportedPrivate.provenance` gains
`"x-dm"`, `ModeDefinition.dmReadwise`, the feed's DM cadence, the
hydrate/reset replay, `scripts/live-m2g5.mjs` (`live:m2g5`), suite
`scripts/accept-mega2-g5.mjs` (`test:m2g5`, 7 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | 5/7 + validator units 40/40 — both failures on the RIG: check 4 read the active mode id BEFORE the reset it then performed (the seed re-mints modes, so setCadence answered 403 for a mode that no longer belonged to anyone); check 5 asserted that a fixture read carries a cost above zero, which the rate card does not price (reads are itemized at the rate card, and the fixture rate for a read is 0). Suite fixed: mode read after the reset; a poll entry must be an itemized read_sync in fixture mode with a non-negative amount. |
| 2 | 7/7. |

**Exit (Gate 5):** a linked sender's DM lands its link in the persona's From X DM folder and the readwise queue and drips into the feed attributed to the tweet author (check 1); an unlinked sender gets the recorded, never-sent reply and nothing is stored, not the DM, not the handle (check 2); the tweet and the DM text appear nowhere in the validator's database and the vault namespace is ciphertext (check 3); the per-mode frequency changes the cadence measurably, every 3 loads shows the card on exactly 2 of 6 builds and every 1 on every build, and the setting persists on the mode (check 4); the next page lands its link and skips the link-less DM, an exhausted inbox lands nothing, every poll is one itemized read in the spend ledger (check 5); the live recorder refuses without the Layers account credentials and makes no network call (check 6); the pane renders mode, handle, folder, recorded replies and the per-mode cadence (check 7). Live spend this gate: $0.00 (no X credentials on this machine; fixture). Regression set before the commit (23 suites, all green — readwise is now a sealed namespace, so the import, bookmark, cold-store and device-loss suites were in the set): m2g1 8/8, m2g2 7/7, m2g3 8/8, m2g4 8/8, ux0 6/6, ux1 13/13, ux3 9/9, ux4 7/7, a3 6/6, b2 6/6, x2 8/8, x3 8/8, g1 5/5, g2 4/4, g3 7/7, functional, accept 14/14, z6 6/6, rootleak clean (55 payloads), c4 7/7, fid4 8/8, fid5 8/8, runner 7/7. `test:m2g5` joins `sweep-x.sh`: baseline 525 checks / 70 suites.

---

## GATE 6 — Relationship porting on X (extends alt-linking)

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-6-A-GRANT-NOT-A-SELF-CLAIM | Alt-linking's grant was `from === to` (a self-claim to one audience member). A port issues the REAL linkage grant `from → to`, whitelisted to the counterpart's persona — the same `issueGrant` every disclosure uses — so their client resolves the merged identity through the ordinary resolver. |
| D-MEGA2-6-PENDING-RESOLVES-ON-LINK | A counterpart named by an X handle nobody has attested gets a PENDING port, sealed in the vault (`relationshipPorts`, one opaque record); `attestHandle` resolves every pending port waiting on that handle the moment a persona links it (an own persona linking it does not count). The X breadcrumb is the only thing they see until then. |
| D-MEGA2-6-THE-BREADCRUMB-REUSES-ALT-LINKING | The synchronized-like signal (a like on a deep old post of theirs from both of this root's X accounts, 3–12 s apart) uses the alt-link scheduler's constants, its disclaimer, and shares its daily cap (alt-links and ports together). Fixture only: recorded, never sent to X. |
| D-MEGA2-6-BOTH-HANDLES-ARE-THIS-ROOT'S | The source persona must be OAuth-linked; the second handle is the target persona's attestation or an alt handle of the source — both this root's by construction (own personas share the root); they must differ. The counterpart must be someone else. |
| D-MEGA2-6-PRIVATE-NEVER-PORTED | A private persona is refused in either role: a private persona's linkage is never carried anywhere, by anything. |
| D-MEGA2-6-NO-NEW-CRYPTO | Grants, the resolver, the alt-link scheduler, the rate limit, the disclaimer. Nothing new is signed. |

### Built

`lib/x/porting.ts`, `GET/POST /api/x/port`, `/settings/porting`
(`RelationshipPortFlow`), the `attestHandle` hook, vault namespace
`relationshipPorts`, suite `scripts/accept-mega2-g6.mjs` (`test:m2g6`,
8 checks).

### Iterations

| iteration | result |
|---|---|
| 1 | 8/8, first run. |

**Exit (Gate 6):** a port to a linked counterpart issues the disclosure grant, the counterpart renders the merged identity and a stranger sees nothing (check 1); a port to an unattested X handle waits and resolves into a grant when a persona attests that handle (check 2); both likes are scheduled with a non-zero delay inside 3 to 12 s from this root's two handles (check 3); alt-links and ports share the daily cap and over-frequency is refused, not queued (check 4); a private persona is refused in either role (check 5); both X accounts must be this root's and the counterpart must be someone else (check 6); porting spends nothing, calls nothing, and the port record is sealed in the vault (check 7); the flow renders the ports and their states (check 8). Regression set before the commit (25 suites, all green — the attestation hook and the shared alt-link cap put the X linking, alt-link and attestation suites in the set): m2g1 8/8, m2g2 7/7, m2g3 8/8, m2g4 8/8, m2g5 7/7, ux0 6/6, ux1 13/13, ux4 7/7, calla 9/9, x1 8/8, x4 6/6, a3 6/6, b2 6/6, g1 5/5, g2 4/4, g3 7/7, functional, accept 14/14, z6 6/6, rootleak clean (55 payloads), c4 7/7, fid4 8/8, fid5 8/8, att4 10/10 (linkage v3), runner 7/7. `test:m2g6` joins `sweep-x.sh`: baseline 533 checks / 71 suites.

---

## GATE 7 — Linkage test v5 + adversarial review

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-7-THE-OPERATOR-IS-THE-DB-PLUS-THE-LOG | The v5 session (two proven personas of one root, stakes in the same hour, a lens switch, a zone save, a private post searched by keyword and by paraphrase, a DM landed, a relationship ported) is judged only from what the operator holds: every row of every table, the state namespaces, the validator's log, and the timing of its own writes. Nothing the app returns to the device counts as evidence either way. |
| D-MEGA2-7-COTIMING-IS-MEASURED-NEVER-SUPPRESSED | Two personas of one root staking in the same hour is a behavioural link. The test does not try to hide it: it computes the co-timing candidate set (every persona with a stake in PUB's hour), prints it, and fails only if the set is smaller than 3 — i.e. if the two personas would be alone in their hour. The posture records it as A-MEGA2-STAKE-COTIMING with the measured size. Hour grain is the validator's, not the test's. |
| D-MEGA2-7-SEARCH-LEAVES-NO-TRACE-IS-A-BYTE-COMPARISON | "The search never touches the validator" is asserted the only way it can be: per-table sha256 of every row before and after the two searches, equal; the validator's log gains zero bytes; no query text and no private text in any row afterwards. A background write during the window would name the table that changed, so a flake is diagnosable rather than hidden. |
| D-MEGA2-7-OPAQUE-MEANS-NOT-DERIVABLE-FROM-WHAT-THE-OPERATOR-HOLDS | The DM bookmark's post hash is checked for shape (dm: + 16 hex) and against the tweet id and the DM text; the folder row, the cursor and the attestation are the only plain rows the DM path may add. A hash the operator could brute-force from tweet ids alone would fail the intent even if it passed the regex — hence the vault-key salt in the derivation (Gate 5), and reviewer focus (c) is pointed at exactly this. |
| D-MEGA2-7-THREE-REVIEWERS-ONE-FOCUS-EACH | Three reviewers on Sonnet, fresh context, the same bounded brief (posture §15, VERIFY-YOURSELF, the diff since d9105d5, the v5 suite as the floor) with one focus each: (1) allowance/stake data linking roots + lens import bypassing a guardrail, (2) search or index leakage server-side + the zone/binding records, (3) DM ingest exposing sender → persona beyond the attestation + relationship ports. Report shape fixed (verdict, findings with severity/claim/where/how/evidence/fix, what was checked and found sound). |
| D-MEGA2-7-FIX-OR-ASSUME-BY-ID | Every surviving finding is either fixed in code with a check added to a suite, or written into the posture as an A-MEGA2-* assumption with the reviewer's finding id beside it. A finding the orchestrator disagrees with is rebutted in the report with the line numbers, never silently dropped. |

### Built

`scripts/accept-mega2-g7.mjs` (`test:m2g7`, session + 8 checks), three
reviewer reports `research/attack-mega-{1,2,3}.md`, the fixes and
assumptions they produced, posture §15 final.

### Iterations

| iteration | result |
|---|---|
| 1 | 0/9 — the session never proved MAIN: a proof is only WANTED once the persona has demanded a gated surface, and the v5 rewrite had dropped the home-feed visit the Gate 1 suite makes between prefetch and drain. Rig, not product: the visit restored (as the forked persona, through the view-as cookie). |
| 2 | 8/9 — check 3 demanded a ciphertext length of at least 1024 bytes; the record is padded so it lands just UNDER the KiB step (1019 bytes: the JSON wrapper and the GCM tag sit inside the step). Rig: the assertion now checks the step, not a floor of 1024. |
| 3 | 9/9. Measured: the co-timing candidate set for the forked persona's hour was 10 personas; the cohort 121 registrations; both personas' eligibility rows at the same epoch with distinct nullifiers; per-table hashes and the log byte-identical across the two searches. Reviewers spawned (three, Sonnet, one focus each); results below. |

**Exit (Gate 7), part 1:** linkage v5 green (9/9, `test:m2g7` joins `sweep-x.sh`: baseline 542 checks / 72 suites); posture §15 gains A-MEGA2-STAKE-COTIMING and the v5 measurements. Part 2 (the three reports, fixes or assumptions by id) follows.

**Part 2 — the three reviews (Sonnet, fresh context, one focus each), every finding above LOW fixed or assumed by id:**

| report | finding | severity | disposition |
|---|---|---|---|
| attack-mega-1 | F1 `stewardship` rep events stamped with the millisecond and kept in insertion order, while the posture said hour-grained | MEDIUM | FIXED: `/events` stamps `hourGrain(Date.now())` (validator/server.js), the seed and the poller stamp the hour too, and migration 15 coarsens the rows already on disk (the first run of the fixed suite failed on seven legacy rows — the table, not the new write, is the claim); linkage v5 check 1 asserts every `stewardship` row is on the hour. Insertion order stays → A-MEGA2-REP-EVENTS-KEEP-ORDER. |
| attack-mega-1 | F2 P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL overstates: the validator's own `GET /stakes?personaId=` is ungated | LOW | POSTURE CORRECTED: the gate is the app's query path; the validator's read is public by design (A-MEGA2-STAKE-ROWS-ARE-PUBLIC from the other side). |
| attack-mega-2 | F1 `actionButtonSlots.cast` (and the whole mode definition) is a plaintext, persona-keyed habit fingerprint the operator can cluster across a root's personas | HIGH | FIXED: `modes` is a sealed namespace, ONE opaque padded record (`opaqueDump`), like `scrollZones`; linkage v5 check 2 asserts ciphertext and no plaintext mode field. Other preference namespaces → A-MEGA2-PREFERENCE-NAMESPACES-STILL-PLAIN + open issue. |
| attack-mega-2 | F2 `simulateDeviceLoss` leaves this pass's in-process caches warm | LOW | FIXED: device loss clears the index, the worker, the allowance, the zones and the ports caches. |
| attack-mega-2 | F3 the index and worker have no owner key | INFO | ASSUMED: A-MEGA2-INDEX-HAS-NO-OWNER-KEY (section 8 restated). |
| attack-mega-3 | F1 the DM hash is root-salted: two personas bookmarking the same tweet share a hash, joinable in the plain folder rows and in readwise's plaintext record keys | CRITICAL | FIXED: `dmPostHash(tweetId, personaId)` folds the persona into the keyed message; `readwise` is ONE opaque record. Linkage v5 gains check 9: both personas land the SAME tweet, hashes differ, no `dm:` hash under two personas, readwise one record. The fixture's `$LINKED` sender is now the active persona's handle so the rig can do it; `resetInboxCursor` dev hook. |
| attack-mega-3 | F2 a pending port resolves to whoever later attests the handle, no re-confirmation, no expiry | HIGH | FIXED (partly) + ASSUMED: pending ports carry `expiresAt` (30 days, `PENDING_PORT_TTL_MS`) and lapse to `expired`, never resolving after; the re-confirmation step is an open issue; A-MEGA2-PORT-PENDING-TRUSTS-THE-HANDLE. |
| attack-mega-3 | F3 the unlinked-sender hash is unkeyed and the replies log is served unscoped | MEDIUM | FIXED (hash keyed with the vault key) + ASSUMED (the log is the Layers account's session log, not persisted; owner check needed in a shared deployment): A-MEGA2-UNLINKED-SENDER-LOG-IS-A-SESSION-LOG. |
| attack-mega-3 | F4 the synchronized-like breadcrumb has no assumption line | MEDIUM | ASSUMED: A-MEGA2-BREADCRUMB-IS-PUBLIC-ON-X. |

Not chased: nothing above LOW was left without a fix or an id. Rebuttals: none needed — every finding read correctly.

**Exit (Gate 7), part 2:** three reports in `research/`; the fixes above; linkage v5 re-run on the fixed build (10 checks including the new same-tweet check); posture §15 final with the corrections and seven new assumptions; the regression set green on the fixed build (below).

---

## GATE 8 — Docs site: scaffold, sections, piping, historical pages

### Decisions (by id)

| id | decision |
|---|---|
| D-MEGA2-8-VITEPRESS | VitePress (1.6.4): markdown-native so the check tooling and the site read the same `/docs` tree; one dev dependency; Vue only where the roadmap needs buttons (one component); own pinned port 3011 with strictPort; no deploy. mdBook would need a Rust toolchain the machine does not have; Docusaurus is a second React app. |
| D-MEGA2-8-THE-CITE-TOKEN-IS-THE-CONTRACT | A citation is `{cite: FILE > "Heading"}` with the heading VERBATIM from the report (single quotes allowed when the heading contains double quotes). Three tools read the same token: docs:check (the cite must resolve), docs:sync (the section under the heading is hashed into `docs/.cite-lock.json`), and the site's markdown renderer (the token becomes a small reference chip). A heading that moves breaks the cite loudly; a section that changes flags drift. |
| D-MEGA2-8-CLAIMS-NEED-CITES | docs:check fails a paragraph that uses a strong-claim keyword (never / cannot / impossible / unlinkable / guarantee / zero-knowledge / fail-closed / does not learn …) without a cite in that paragraph or an `<!-- uncited-ok -->` marker; page-level markers are allowed only for indexes, the mission pages, the two pre-existing audit docs, and generated pages. The keyword list is deliberately about CLAIMS, not topics ("private persona" is a feature name, not a claim). |
| D-MEGA2-8-RENDERED-FROM-SOURCE | The adapters page (every `*Adapter` interface and method, the registry bindings, the method → namespace persistence map), the zk scopes page (the claim → scope registry), the data-model page (sealed vs plain namespaces, validator tables), the roadmap data and the KNOWN-BROKEN outline are generated by `scripts/docs-generate.mjs` at every docs build and carry a banner; the Gate 8 suite asserts their counts equal the source's. Hand-written prose cites; generated pages do not. |
| D-MEGA2-8-HISTORY-BY-SUBAGENTS-WITH-A-TEMPLATE | Fourteen historical pass pages were written by three Sonnet subagents with a bounded brief: one fixed template, the status vocabulary, the cite token with verbatim headings, no claim stronger than the report's, 60–200 lines. The orchestrator assembled, ran docs:check over them (747 citations resolved on the first pass; three failures were the orchestrator's own pages), and locked the cites. The Multi-FID pass and this pass are STUB pages with a visible banner, per the brief. |
| D-MEGA2-8-ROADMAP-IS-DERIVED | The roadmap's items are every `**[STATUS]**` bullet on the pass pages plus a seeded JSON of SPECCED / IDEA / UNCLEAR items with their source named; the counts on the page are computed from that data and the Gate 8 suite recounts the bullets independently and compares. Areas come from a keyword map and are marked as a heuristic; the "distance to end product" view counts items per core concept the same way. |
| D-MEGA2-8-INTERNAL-BY-SRCEXCLUDE | `SHOW_INTERNAL=1` adds the internal section to nav, sidebar and the build; without it `internal/**` is excluded from the source set and the suite asserts no emitted HTML links into `/internal/`. Public pages are forbidden (by docs:check) from linking into internal, so hiding is clean rather than a 404. |
| D-MEGA2-8-OPEN-ISSUES-SEEDED-PLUS-GENERATED | The open-issues page opens with the owner decisions this pass surfaced (the early curve, the creator-economy tie-in, search follow-ups, mobile calibration, the live DM read, the untaken call options) and then includes a generated outline of every KNOWN-BROKEN section across every report and every notes/runbooks/MORNING.md item, each cited. |

### Built

`docs/` (VitePress config + theme + one Vue component; mission ×2,
concepts ×6, features ×12, privacy ×6, technical ×9 of which 3
generated, internal ×5 + 16 pass pages of which 14 full and 2 stubs),
`scripts/docs-{generate,check,sync}.mjs`, `docs/.cite-lock.json`,
`notes/runbooks/CONTRIBUTING-DOCS.md`, `scripts/accept-mega2-g8.mjs` (`test:m2g8`,
8 checks), package.json `docs:*` scripts.

### Iterations

| iteration | result |
|---|---|
| build 1 | the VitePress config failed to load: the cite-renderer regexes had lost a level of backslash escaping on their way through two template literals. Scaffold fixed (backslashes doubled where the config body is generated). |
| build 2 | the build failed on the first cite token: VitePress ships markdown-it-attrs, which eats a trailing `{...}` as an attribute block. `markdown.attrs.disable = true`; the token is text and the renderer turns it into a reference chip. Public build green in 3.1 s. |
| 1 | 5/8 — docs:sync reported drift (REPORT-MEGA2 Gate 3 exit line had been extended after the lock — real drift, re-read and re-locked); the internal build failed on YAML frontmatter (twelve subagent-written titles carried an unquoted colon-space); the roadmap check depended on that build. Titles quoted; the generator strips the quotes. |
| 2 | 8/8. Money shot captured: `shots/mega2-roadmap.png` (SHIPPED toggled off). |

**Exit (Gate 8):** the site builds and serves on 3011 (check 6); every section exists, stubbed where deferred with the banner visible in the built HTML (checks 2, 6); the roadmap filters work in a real browser and every count on the page equals an independent recount of the tagged bullets (check 7); docs:check green and not vacuous, it fails a planted uncited claim (check 4); docs:sync clean and it detects a deliberately edited section (check 5); historical pass pages exist for every prior report, citing it, with the Multi-FID pass and this pass as stubs (check 3); the from-source pages name every adapter interface, claim kind and sealed namespace the source declares (check 1); the internal flag hides the internal pages and no public page links into them (check 6); the app is untouched (check 8, plus the closing sweeps). `test:m2g8` joins `sweep-x.sh`: baseline 550 checks / 73 suites.

---

## /verify — the closing bar

| item | result |
|---|---|
| Full legacy suite at the current baseline (fixture, pinned ports, fixed runner) | 73 suites / 551 checks per sweep, every exit code classified; the docs gate left app behaviour byte-identical (Gate 8 check 8 + the sweeps) |
| Greps every iteration | `test:rootleak` (55 payloads, 10 root-material needles) and linkage v5 checks 3–8 (vault plaintext incl. zone configs, the search index, DM content, allowance balances; stake → root adjacency; key material) on every sweep |
| Restart-survival | 36/36 across a hard kill + rebuild, now including allowance + stake history, the lens pin, button bindings, the zone layout, the DM-sourced bookmark with the search index re-derived, and a pending relationship port that resolves after the restart |
| Total-device-loss recovery | `test:c4` 7/7 in every sweep; device loss now clears this pass's caches so recovery rebuilds from the vault (attack-mega-2 F2) |
| Linkage v5 + three attack reports | `test:m2g7` 10/10 in every sweep; `research/attack-mega-{1,2,3}.md`, every finding above LOW fixed or assumed by id (Gate 7 part 2) |
| `docs:check` and `docs:sync` green; site builds | inside `test:m2g8` on every sweep (check + planted-claim negative; sync + planted-drift negative; public and internal builds; roadmap filters in a browser) |
| tsc strict, production build | clean at every gate's build; the closing series ran on the production build of `55b25da` |
| 4 consecutive clean sweeps on identical code | series 1 halted at 0 of 4 on a rig collision (below); series 2 on `55b25da`: 4 of 4 clean, 551/551 checks, 73/73 suites, 0 infra — bar met |
| All committed | every gate at green; the review fixes; the series-1 fix; this closing commit |

**Series 1 (target `2221dbf`) halted at 0 of 4.** Sweep 1: 550 passing, one failed suite — `m2g1` check 5 found no NEW `stewardship` row. The zk dev reset rewinds the epoch clock, and the validator had kept stewardship rows from every earlier run of the day, so the per-root-per-epoch dedupe (`source_id = stewardship:<epoch>`, the product rule) swallowed the replayed accrual (the rig's replayed epochs). `/zk/dev/reset` now clears stewardship rows; validator units, Gate 1, linkage v5, z6 and att4 green on the fix; committed as `55b25da`; counter reset.

**Series 2 (target `55b25da`):** four consecutive clean sweeps — 1: 16:14:51 → 17:29:43, 2: 17:30:15 → 18:45:16, 3: 18:45:44 → 20:00:37, 4: 20:01:05 → 21:17:07; each 551 passing checks, 0 failed suites, 0 infra, orphans after 0. **CLOSED.**

**Spend this pass: $0.00.** No FID created; no post, deploy or live write; the one permitted live read (Gate 5) never ran for want of credentials.

**Iterations used (suite runs, of the 24 budgeted):** G1 3/4 · G2 2/4 · G3 2/3 · G4 2/3 · G5 2/2 · G6 1/2 · G7 3/2 — one over: the first run was a rig omission (the wanted-set visit), the second a rig assertion (the KiB step); plus 2 fix builds after the reviews, charged here honestly · G8 2/4 suite runs plus 2 build-only iterations. 17 suite iterations of 24; the 3 over-budget runs were all rig, none product. Call options A/B/C not opened.
