<!-- uncited-ok: page — pre-existing audit ledger / design memo; claims are the report's, not the site's -->
# root-reads — every read of persona → root, and what happens to it

ZK Pass 2, Gate 1 contract. Written BEFORE any change (the prompt's rule);
Gate 2 may drop `personas.root_id` only when every read below has a
disposition that no longer needs it. Legend: **VALIDATOR** = a read the
validator answers from `personas.root_id` (must go); **DEVICE** = a read
answered from device-held material (keystore roster, seed grouping) —
allowed, it never asks a server for a root grouping; **ROOT-LEVEL** = a
table keyed by root that stays (reputation, registration, polling are
account facts the validator legitimately holds; C10); **PROOF** = under
the `zk` binding the read becomes "what has this persona PROVEN".

## A. The validator's schema and routes

| Where | Read | Kind | Disposition |
|---|---|---|---|
| `validator/db.js:18` `personas.root_id` | the column | VALIDATOR | **dropped by migration 006** (Gate 2), with a tested down-migration from a device-side roster export |
| `validator/server.js:42-51` `personaRow()` | returns `rootId` on the wire | VALIDATOR | field removed |
| `POST /personas` (`server.js:77`) | writes `root_id` | VALIDATOR | creation no longer takes a root; the persona is registered under its own record. (Persona creation authenticated by a proof of a valid root is Gate 3's continuity proof shape; in Gate 2 creation is device-signed.) |
| `GET /personas/root/:rootId` (`server.js:96`) | roster by root | VALIDATOR | **removed**; rosters are DEVICE (`lib/identity/keystore.ts` + the `identityRoster` vault namespace) |
| `GET /personas/by-fid/:fid` (`server.js:103`) | roster by fid via `roots` | VALIDATOR | **removed**; the phase-1 fid heuristic in `lib/policy.ts` is replaced by the attribution index + the device roster |
| `GET /personas/:personaId` (`server.js:112`) | persona + rootId | VALIDATOR | keeps the persona, drops `rootId` |
| `GET /rep/:personaId` (`server.js:124`) | tier via `p.root_id` | VALIDATOR | **removed**; tier is PROOF under zk (`/zk/eligibility`) and, for the legacy bindings, `GET /rep/root/:rootId/tier` answered with a ROOT handle the device supplies (never a persona) |
| `GET /rep/root/:rootId/tier` (`server.js:118`) | tier by root | ROOT-LEVEL | stays (the account's own reputation, asked with the account's own handle) |
| `POST /events` (`server.js:130`) | rep events by root | ROOT-LEVEL | stays |
| `POST /block` (`server.js:153`) | persona → root → `blocks(blocker_root, blocked_root)` | VALIDATOR | **persona-level** table `blocks_v2(blocker_persona, blocked_persona)`; no root join |
| `GET /blocked/:personaId` (`server.js:164`) | fan-out: blocked roots → all their personas | VALIDATOR | **regression, named**: returns persona-level blocks only; a blocked root's OTHER personas are not auto-blocked (SECURITY-POSTURE §"What zk cost us") |
| `validator/rep.js` `scoreForRoot/tierForRoot/tiersForRoots` | rep by root (`tiersForRoots`, persona launch wave 3: the same answer for many roots from one read of the scores) | ROOT-LEVEL | stays |
| `validator/poller.js` `poll_state.root_id` | poller by root | ROOT-LEVEL | stays |
| `validator/zk.js` `zk_registrations.root_id` | commitment ↔ root | ROOT-LEVEL | stays (C10: registration reveals commitment ↔ account; after 006 there is no root → personas table to join it to) |
| `validator/zk.js` `tiersForRoots(db, regs.map((r) => r.root_id))` (was `tierForRoot` per registration, before persona launch wave 3) | tier trees by registration root | ROOT-LEVEL | stays (tree membership is a root fact) |
| `validator/seed.js:25` | seeds personas with root_id | VALIDATOR | seed writes personas without a root; rep events stay root-keyed |
| `validator/test/validator.test.js` | asserts sibling personas share a tier via `/rep/:personaId` | VALIDATOR | test updated: tier is asked by root handle; "two personas of one root share a tier" is no longer a validator-answerable question — listed in REPORT-Z2 as a legitimately removed behaviour |

## B. The app's reads

| Where | Read | Kind | Disposition |
|---|---|---|---|
| `lib/validator.ts` `personasByFid`, `personasForRoot` | validator rosters | VALIDATOR | removed; callers use the device roster |
| `lib/validator.ts` `tierFor(personaId)` | `/rep/:personaId` | VALIDATOR | removed; callers use `adapters.rep.tierFor` (dispatching: mock / validator-by-root-handle / zk PROOF) |
| `lib/validator.ts` `blockedFor`, `blockPersona` | root fan-out | VALIDATOR | persona-level |
| `lib/validator.ts` `createPersona({rootId})` | writes root | VALIDATOR | no root in the body |
| `lib/adapters/validator/index.ts` `listForRoot`, `tierFor` | validator adapter | VALIDATOR | `listForRoot` answered from the device roster; `tierFor` by root handle (the device's own) — a persona of another root has no validator-answerable tier under the legacy binding: it renders unproven |
| `lib/session.ts` `personasForRoot(rootId)` / `personasByFid` | the session's persona list | VALIDATOR | the session's personas come from the device (`ownPersonaIds()` + the seed roster for the fixture self) |
| `lib/policy.ts` `personaFor` (by fid), `tierFor`, `blockedFor` | classic-feed persona layer | VALIDATOR | attribution index first (already), then the device roster; tier via `adapters.rep`; blocks persona-level |
| `app/(main)/layout.tsx` `tierFor` from `lib/validator` | badge tiers for the switcher | VALIDATOR | `adapters.rep.tierFor` |
| `app/(main)/[handle]/page.tsx` `personasByFid`, `tierFor`, `seeded.tier` | profile tier | VALIDATOR / seed | `adapters.rep.tierFor(persona)` for both the seeded and the phase-1 profile. **Moved (PROD-LIVE):** the page no longer reads any of these itself — the unchanged body lives in `lib/views/social.server.ts` `profileView` (section L), which the page calls on the rig and `/api/profile` answers inside the browser device |
| `app/api/personas/route.ts` `createPersona({rootId: session.rootId})` | creation | VALIDATOR | no root in the request |
| `app/api/identity/fork/route.ts:112` `rootId: source.rootId` | the mock persona adapter's create | DEVICE | stays (the app's own in-memory seed grouping; never sent to the validator) |
| `lib/adapters/mock/persona.ts` `rootId`, `listForRoot`, `seedSiblingIds` | the fixture grouping | DEVICE | stays — this IS the device-side roster for the fixture self |
| `lib/identity/ownership.ts` `ownSiblingIds` | keystore + seed grouping | DEVICE | stays |
| `lib/feed.ts:324-389,668` `facetScopedRoots` (author.rootId) | facet scoping by root | DEVICE | stays (mock persona summaries; app-side) |
| `lib/feed.ts:378,420,440,485-607` `author.tier`, `att.tier` | card tiers from seed / attribution | seed | **PROOF under zk**: `zkGate.provenTier(author)` (0 = unproven) on every surface |
| `lib/adapters/mock/rep.ts` `blockedFor` | pairwise blocks + resolvable siblings | DEVICE | stays (already persona-level) |
| `lib/identity/sessionHandles.ts` `handleFor(rootId)`, `rootForHandle` | opaque session handle ↔ root | DEVICE | stays (device-side map; the root never leaves) |
| `app/(main)/settings/account/page.tsx:41` `SEED_VIEWER.rootId` | shows the device's own root id to its owner | DEVICE | stays |
| `app/api/signer/route.ts` `registerRoot(fid, signerUuid)` | the account's root | ROOT-LEVEL | stays (the account is the account) |

## C. Where tier renders (every one shows "not proven" for tier 0 under zk)

`components/TierBadge.tsx` (the one badge: `tier === 0` → the unproven
chip, `data-tier="unproven"`, static explainer copy; `undefined` → no
badge), used by `CastCard`, `FeedCards` (highlights), `ProfileHeader`,
`RoomStage`, `AccountSwitcher`, `settings/PersonaSwitchList`,
`settings/AttestationPane`, `[handle]/page`, `[handle]/status/[hash]/page`,
`search/page`. `app/api/tier/route.ts` answers tier 0 with
`{ proven: false, percentile: "not proven this epoch", unlocks: [] }`.

Known gap, listed not hidden: `components/RoomStage.tsx` renders
`PersonaSummary.tier` from the mock persona adapter's summaries (seed
data). Under zk that summary tier is not proof-mediated; it is a fixture
rooms surface. Disposition: A-ROOMS-SEED-TIER in REPORT-Z2 unless Gate 1
has iterations to spare.

## D. The grep that closes Gate 1

Under `ADAPTER_REP=zk` no app module may import `tierFor`,
`personasForRoot` or `personasByFid` from `lib/validator.ts`; `lib/feed.ts`
stamps card tiers from the gate's proven map; `lib/adapters/zk/rep.ts`
contains no root-side lookup (Pass 1's grep). `test:z6` enforces all of it.

## E. Files the closing grep also names (Gate 1, iteration 3)

The self-consistency grep in `scripts/accept-z6.mjs` check 1 was VACUOUS in
iterations 1-2: its `2>/dev/null` made cmd.exe refuse the whole command, so
the grep never ran and "nothing missing" was reported for nothing found.
It runs now, and these files are named here so it stays honest:

| File | Why the grep names it | Disposition |
|---|---|---|
| `lib/adapters/types.ts` | the adapter contract: `PersonaAdapter.create({ rootId })`, `listForRoot(rootId)`, `RepAdapter.tierFor` | DEVICE-side contract; the validator implementation strips the root before the wire (Gate 2) |
| `lib/rep/personaTier.ts` | THE SWITCH: `tierFor` under zk is the PROOF (`adapters.rep.tierFor`), the caller's legacy read otherwise | PROOF under zk |
| `lib/search.ts` | `adapters.rep.blockedFor(viewer)` — the persona-level block list for search | DEVICE / persona-level |
| `validator/migrations.js` | `zk_registrations.root_id`, `rep_events.root_id` (ROOT-LEVEL tables that stay) and migration 006 | ROOT-LEVEL; 006 drops `personas.root_id` |
| `validator/export-roster.js` | the ONE-TIME pre-006 export of `personas.root_id` to the device (`.keystore/fixture-roster.json`) | DEVICE (run before the first boot on a 006 build; refuses on a post-006 db) |

## F. After Gate 2 — migration 006 applied

`personas.root_id` is gone; the validator has no persona → root read left.
What table A became, and the files Gate 2 added (all named so check 1 of
`scripts/accept-z6.mjs` and check 7 of `scripts/accept-z7.mjs` stay honest):

| File | Role after 006 | Kind |
|---|---|---|
| `validator/migrations.js` (006 `personas_without_root`) | drops the column (rebuilt table), `blocks` → `blocks_v2` (persona-level), keeps `blocks_legacy_export` for the rollback only; the ONLY migration with a `down()`, transactional | ROOT-LEVEL tables stay: `rep_events`, `poll_state`, `zk_registrations`, `roots` |
| `validator/export-roster.js` | the one-time pre-006 export to the DEVICE (`.keystore/fixture-roster.json`) | DEVICE |
| `validator/migrate-down.js` | the rollback from a device roster (`--orphans=quarantine`) | DEVICE-fed |
| `validator/test/migration006.test.js` | up → down → up round trip, refusals, quarantine | test |
| `validator/server.js` | `/personas/root/:rootId`, `/personas/by-fid/:fid`, `/rep/:personaId` answer 410 naming migration 006; `POST /personas` refuses a `rootId` (400); `/block` + `/blocked` are persona-level and say `fanout: "persona-level only"` | VALIDATOR |
| `validator/seed.js` | writes personas without a root | VALIDATOR |
| `lib/identity/rootRoster.ts` | THE DEVICE ROSTER: fixture export layer + vault-sealed layer (`rootRoster` namespace, one opaque record); `recordRoot`, `recordPersona`, `personaIdsForRoot`, `rootForFid`, `rootOfPersona`; `rosterExport` (dev-only) | DEVICE |
| `lib/validator.ts` | `personasForRoot` / `personasByFid` answered from the device roster, fleshed out by id; `tierFor` by ROOT handle for the device's own roots (null otherwise); `createPersona` sends no root; `blockedFor` persona-level | DEVICE / VALIDATOR-by-id |
| `lib/session.ts` | the session's personas = the device roster (signer roots) or the fixture export (the seeded self) | DEVICE |
| `lib/policy.ts` `personaFor` | marker → `getPersona(id)` first; by fid only through the device roster | DEVICE |
| `lib/adapters/validator/index.ts` | `create` strips the root before the wire and records the roster; `listForRoot` from the roster; `tierFor` by root handle | DEVICE |
| `lib/zk/registration.ts` | the device's own root handle from the roster (was `/personas/by-fid`) | DEVICE |
| `app/api/signer/route.ts`, `app/api/personas/route.ts` | record the root / the persona in the device roster at creation | DEVICE |
| `app/api/block/route.ts` | ONE validator row per block action (the acting persona); `GET /api/block` = the union of the session's own personas' lists, shared at read time (`fanout: "read-time, device-side"`) | DEVICE |
| `app/api/zk/route.ts` `rosterExport` | the rollback's input (dev hooks only) | DEVICE |
| `components/BlockPersonasButton.tsx` | "Block this persona"; names the sibling regression | UI |
| `scripts/accept-z7.mjs` | Gate 2's suite (schema, wire, roster, blocks, restart survival, rollback on a snapshot, greps) | test |
| `scripts/functional.mjs` | the sibling STAYS visible after a block (root-level fan-out removed by design) | test |
| `validator/test/validator.test.js` | tier-by-persona and root-level fan-out asserted as REMOVED; creation without root | test |

Known gap carried from Gate 1: A-ROOMS-SEED-TIER (RoomStage reads the seed
tier for its stage badge) — unchanged by Gate 2.

## G. Mega pass 2 — the reputation UBI (Gate 1)

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/influence/accrual.ts` | `settleStewardship` posts the epoch's stewardship count on the account's OWN root handle (`rootOfPersona` from the device roster → `POST /events {rootId}`) — the same device-side read the legacy tier uses (`lib/validator.ts` `tierFor`) | DEVICE → ROOT-LEVEL write | stays: reputation is an account fact the validator legitimately holds (C10); the persona → root question is answered on the device, never asked of the validator. Posted ONCE per evaluated epoch, hour-grained, as a coarse integer — its magnitude is the residual link named A-MEGA2-ACCRUAL-MAGNITUDE in the posture doc |
| `validator/stakes.js`, migration 14 `stakes` | per-PERSONA spend events: persona, cast, action, direction, amount, epoch, hour — the table has no root column | PERSONA-LEVEL | public by design (legibility); every row carries the persona's own signature and key |
| `validator/rep.js` `WEIGHTS.stewardship`, `validator/server.js` `/events` | the accrual's event type | ROOT-LEVEL | stays |
| `lib/influence/allowance.ts` | `ownTierNow()` reads `adapters.rep.tierFor` for each of the device's OWN personas — the dispatching rep adapter: PROOF under zk (what the persona proved this epoch, 0 = nothing), the legacy read otherwise — to size the epoch's allowance | PROOF under zk / DEVICE | stays: the allowance is computed on the device from the tier the persona can already show; no root is named and nothing is asked of the validator that it does not already answer for a tier badge |

## H. Browser keystore pass — the browser device (Gate 1 stage 3)

The device is the browser, so the modules that know "which root am I" moved
there. Both entries are the DEVICE's own root, held by the device that owns
it; neither reads another root, and neither reaches the validator for a
root-derived tier or roster.

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/device/entry.ts` | logs its own `info.rootId` to the browser console when the device boots — the visitor's own root, in the visitor's own devtools | DEVICE-LOCAL | stays |
| `lib/device/shims/session.ts` | the device's session: `SEED_VIEWER.rootId` is the root this browser minted, and the personas are the ones its keystore holds; the server's `lib/session.ts` (opaque cookie handle → `rootForHandle`) is not in the device bundle | DEVICE-LOCAL | stays |

## I. Browser keystore pass — onboarding and custody (Gate 2)

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/device/boot.ts` | the device's own root id, minted or restored by this browser, recorded in its own vault roster and handed to the page as public information | DEVICE-LOCAL | stays |
| `lib/device/custody/index.ts` | compares the root the device holds before and after an unlock or an import — its own root, twice | DEVICE-LOCAL | stays |
| `components/device/DeviceApp.tsx` | renders the visitor's own root id on the identity strip | DEVICE-LOCAL | stays |
| `validator/custody.js` | none of the root-derived reads: it stores method records (a public identifier → a root's ANCHOR) and ciphertext blobs; the grep matches the word in a comment | ROOT-LEVEL (anchor only) | stays |

## J. Browser keystore pass — device linking and root linking (Gate 3)

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/device/linking.ts` | the device holding the root names its own root id in the material it seals to a device it links (the id is public; the seed never travels); the linked device installs that id as its own | DEVICE-LOCAL | stays |
| `lib/device/rootlink.ts` | a pairwise grant names two root ids and two anchors — both already public on the validator — co-signed by both roots' device-auth keys and stored sealed in each vault; the validator relays it without a body that outlives the exchange | DEVICE-LOCAL (grant), ROOT-LEVEL (two public anchors) | stays |

## K. Post-deploy pass — per-account delivery tiers (Gate 3)

| Where | Read | Kind | Disposition |
|---|---|---|---|
| `lib/delivery/tiers.ts` | the module is named `tiers.ts` and its `tierFor(modeId, personaId)` reads the owner's own DELIVERY preference — where an account's posts show up — and never a reputation tier, a root or a roster. It asks the validator for nothing: the map is one opaque sealed vault record, keyed `modeId\|personaId`, read and written by the device. The grep that brought it onto this page matched the word `tierFor(`, which is exactly the confusion worth recording: two unrelated things in this codebase are called a tier. | NONE (no root read) | stays. The only root-shaped question it could ask — "which personas are mine" — it delegates to `visibleOwnPersonaIds()`, which is device-side, and the compiled rules name a tier string rather than an account so no persona id travels through the rules engine at all. |

## L. PROD-LIVE pass — page computations moved into view builders

On a public deployment the server holds no identity, so each identity-bearing page's inline computation moved,
unchanged, into a view builder the page calls on the rig and the browser device calls when it answers the matching
`/api/*` route. The reads moved with the code; none was added, and none now reaches a server that lacks the viewer's
identity.

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/views/social.server.ts` | `profileView` — the body `app/(main)/[handle]/page.tsx` used to run inline (section B's row): `personaTier(seeded.id, …)` for a seeded profile (PROOF under zk, the seed's tier otherwise); the phase-1 FIXTURE-profile tier, `personasByFid(user.fid)` from `lib/validator.ts` (answered from the device roster since migration 006, section F) then `personaTier(…, legacyValidatorTier)`; and the block check `mockRepAdapter.blockedFor(activeSeedPersonaId())` (persona-level, retried three times and never read as "not blocked" on failure). Called by the profile page on the rig and by `GET /api/profile` inside the browser device | DEVICE / PROOF under zk | stays: the same reads as before the move, run by the process that holds the viewer's identity — the rig's server, or the visitor's own device. No validator persona → root read (006 removed them all) |

## M. Persona launch pass — wave 1 (Sign in with Farcaster, post modes)

Both files below file a persona of THIS device under the device's own root in the device roster
(`lib/identity/rootRoster.ts`, section F). The root id is the session's own — minted or restored by the process that
holds the identity (the rig's server or the visitor's browser device) — and nothing is asked of the validator.

| File | Why the grep names it | Kind | Disposition |
|---|---|---|---|
| `lib/fc/siwf/flow.ts` | after a verified Sign in with Farcaster, the device files the read-only public self under its own `session.rootId` (`recordPersona`) so recovery (a passkey unlock or the 24 words) restores it. The Farcaster binding itself is a sealed `accountLinks` record, never a roots row | DEVICE-LOCAL | stays |
| `lib/identity/postMode.ts` | changing a persona's post mode re-files that persona's roster record: `rootOfPersona` from the device roster, else the session's own `rootId` (`ownRootId()` under `LAYERS_WORLD=empty`); a device that cannot say where the persona is filed changes nothing | DEVICE-LOCAL | stays |
