# REPORT-Z2 — ZK Pass 2: the validator stops holding persona → root

**Run:** unattended, started 2026-09-04 23:05:09 (hard stop 08:05:09).
Prompt: `notes/prompts/zk-pass-2-overnight-prompt.md`. Checkpoints in `notes/reports/RESUME.md`;
the morning summary in `notes/runbooks/MORNING.md`. Baseline: commit `9d22619` (Pass 1
closed, 4 clean sweeps of 348 checks).

**Status:** Gate 0 in flight (iteration 1).

---

## GATE 0 — the cheap residuals from Pass 1's rebuttal

Three things Pass 1's reviews found and Pass 1 only wrote down:

1. **The preparation burst (A-PREPARE-BURST).** Every For You render under
   the zk binding fired the epoch, leaves, history and key fetches and the
   queued-item write on the identified channel — an "I am about to prove,
   at tier T" beacon at the moment of the motivating action. Now
   `lib/zk/prefetch.ts` runs a FIXED SCHEDULE (`ZK_PREFETCH_MS`, default
   10 min, ±25% CSPRNG jitter): every client fetches epoch, leaves, signed
   history, validator key and the anonymous second-viewpoint head on that
   cadence whether or not it intends to prove. The render path only marks
   a persona WANTED (`lib/zk/gate.ts::requestEligibility` — no fetch, no
   proof); the next tick proves wanted personas FROM ITS SNAPSHOT and
   enqueues them, so the queued-item write also lands on the schedule.
   The label reads only the snapshot (`lib/zk/privacy.ts` condition 2
   never fetches). Still identified at render time, and stated: the feed's
   own eligibility read (`/zk/eligibility`, envelope-gated) — that is the
   gate's data, read when the feed renders, and the operator already sees
   the render.
2. **The second viewpoint (A-SPLIT-VIEW, sharpened).** The client now
   fetches the newest history head over the ANONYMOUS path —
   `GET /zk/anon/head` on the validator's anon mount (allowlisted headers,
   no envelope, a fresh socket), through the OHTTP gateway when a relay is
   configured (the gateway routes the inner GET) — and refuses to prove
   unless it equals the head the identified path served. A validator
   forking the history per identity is caught; a missing second viewpoint
   is a refusal, never a pass. What it cannot catch: a fork by IP under
   `direct`, or a global lie told to everyone. A dev-only rig
   (`POST /zk/dev/split-view`) makes the anonymous view lie so the refusal
   is provable.
3. **The supervisor.** `npm run validator:supervised`
   (`scripts/validator-supervisor.mjs`) spawns the validator, keeps its
   last 50 log lines, and on ANY exit appends timestamp, exit code (hex
   too), signal, uptime and those lines to `validator/deaths.log`, then
   restarts with backoff. The silent death of Pass 1's first closing
   attempt cannot repeat silently: the parent observes the exit code even
   when the child could not print.

**Suite:** `test:z5` — render path adds no preparation requests beyond
the scheduled tick and the proof runs on the tick; tick cadence is the
same idle and under a hammer of eligibility requests; a forked anonymous
view is refused on the prove path and named on the label, an agreeing one
proves; the head rides through an OHTTP relay; a `/F`-killed validator
comes back on its own with a death record; structural greps.

*(results appended per iteration below)*

### Gate 0 — iteration 1 (rebuilt bundle, supervised validator, 3 s test cadence)

| suite | result |
|---|---|
| validator units (clean env) | 31/31 (the harness had leaked `LAYERS_REQUIRE_SIG=true` into the first unit run, so eligibility reads came back 401 — harness fixed, not the product) |
| `test:z5` | **5/6** — render path adds no preparation requests beyond the scheduled tick and the wanted persona is proved on the tick; tick cadence identical idle vs hammered; a forked anonymous view is refused at the `root` stage and named on the label, an agreeing one proves; the head rides through an OHTTP relay; a `/F`-killed validator returns in seconds with a death record carrying exit code and last lines. The one miss was the structural grep matching `ensurePrefetchLoop(` as a "fetch" — test regex tightened |
| `test:z0` / `z1` / `z2` / `z4` | 11/11, 8/8, 7/7 (the product trigger now waits for the scheduled tick), 6/6 |
| `test:z3` | 4/6 — a real wrinkle: a forced tick that arrived while the scheduled one was mid-flight was DROPPED ("tick already running"), so the live universe had no snapshot when the label was read. Ticks are now serialized on a promise chain: a scheduled tick and a forced one queue, neither is dropped. Iteration 2 re-runs z5/z3/z4/z2 on the rebuilt bundle |

### Gate 0 — iteration 2 (serialized ticks)

z3 **6/6** (the live-universe label read now always has a snapshot).
z5 5/6 — a new, real failure: `EPERM: rename .keystore/zk-pins.json.tmp
-> zk-pins.json`. The device pins file is rewritten on every tick, every
label read and every proof, and this repository lives in a OneDrive
folder whose sync client holds the target open for a moment; the throw
escaped through `reserveBudget` (the one prove-pipeline call not wrapped)
and the route answered a 500 page. Fixes: the pins save retries the rename
with backoff and falls back to an in-place write (a torn file is refused
loudly by the loader — never a silent first sight); no-op anchor writes
are skipped so the file is touched only when the anchor advances; the
prove path returns a JSON refusal on any pins error. This costs the one
spare iteration of the twenty (G0 was allotted 2); recorded as such.

## Gate 1 — every reputation read proof-mediated under zk

**Contract first:** `docs/root-reads.md` (tables A–D, now E) inventories
every read of a root-derived tier, roster or block before anything was
changed. **The switch:** `lib/rep/personaTier.ts` — under the zk binding a
tier is what the persona PROVED this epoch (`adapters.rep.tierFor`, 0 =
not proven); under the legacy binding the caller's phase-1 read. Every
surface routed through it: the switcher (layout), the classic-feed persona
layer (policy), the seeded and phase-1 profile pages, every card in
`lib/feed.ts` (a `tierOf` resolver over the gate's proven map — quoted
casts, highlights, resurfaced posts, live and private cards, fork cards
included), the seeded profile's own post cards, `/api/tier`. **"Unproven"
is a real state:** `TierBadge` renders tier 0 as a "not proven" chip
(`data-tier="unproven"`), `/api/tier` answers `{ tier: 0, proven: false,
percentile: "not proven this epoch" }`, never a default tier. The
discovery fallback rule (`fallback=policy`) keeps reading the LEGACY tier,
so the legacy discovery feed is byte-for-byte what it was. Budget
unchanged.

| iteration | result | what it found |
|---|---|---|
| 1 (rebuilt) | z6 4/6, z2 6/7, z3 6/6, functional, accept 14/14, g1 5/5, g2 4/4, z0 11/11 | quoted casts / highlights / resurfaced cards still read seed tiers (3 numeric badges under zk) → every `personaById…tier` in `lib/feed.ts` wrapped in `tierOf`; the `fallback=policy` rule received the PROVEN tier and hid nothing → it reads `legacyTier`; check 4 expected MAIN to stay unproven, but the home render in check 3 marks the active persona WANTED and the tick proves it — that IS the product path, so the check now requires only that a persona of ANOTHER root stays 0 |
| 2 (rebuilt; first build died on a OneDrive lock in `.next` — EINVAL readlink — cleared and rebuilt) | z6 4/6, z2 7/7, z3 6/6, z0 11/11, functional, accept 14/14, g1 5/5, g2 4/4 | the z6 rig read ALT's handle off a following-feed card and no card by ALT was in the page window (rig flake) → the handle comes from `seed/data/accounts.json` |
| 3 (no rebuild) | z6 4/6, z0 10/11, z2 7/7, z3 6/6, functional, accept 14/14, g1 5/5, g2 4/4, validator units pass | **check 1 had been VACUOUS**: its grep ran through cmd.exe with `2>/dev/null`, which cmd cannot resolve, so the command never executed and "nothing missing" was reported for nothing found (iterations 1–2). It runs now and named 5 undocumented files → `docs/root-reads.md` §E. The seeded PROFILE page builds its own cast cards with `tier: seeded.tier` (outside `lib/feed.ts`) → they carry `profileTier` (0 → "not proven"; the check mark follows it). z0 check 4 read the placement status before the scheduled tick had re-pinned the validator key after `resetZk` → the check waits for the pin (a freshly reset device honestly says "no pin yet"; not a product defect) |
| 4 (rebuilt) | z6 6/6, z0 11/11, z2 7/7, z3 6/6, functional, accept 14/14, g1 5/5, g2 4/4, validator units pass | **GREEN** |

Gate 1 used all four of its allotted iterations (two were rig/vacuity
fixes, not product fixes). Known gap carried: A-ROOMS-SEED-TIER (the
RoomStage badge reads the seed tier; named in `docs/root-reads.md` §C).


## Gate 2 — migration 006: the validator stops knowing persona → root

**Rollback first.** Before any code that applies 006 ever booted, the
roster left the validator ONCE: `node validator/export-roster.js
.keystore/fixture-roster.json` (pre-006 database; refuses on a post-006
one; refuses to write inside `validator/`) — 746 roots with personas, 945
personas, 881 fids. That file is the device's now (gitignored with the
keystore) and the only thing `validator/migrate-down.js` will accept.

**The migration** (`validator/migrations.js` 006 `personas_without_root`,
transactional): `personas` rebuilt without `root_id`; the root-level
`blocks` table replaced by the persona-level `blocks_v2`; the old block
pairs kept in `blocks_legacy_export` — read by nothing but the
down-migration (rule 4: no deletion without a rollback). `down(db, roster,
{orphans})` restores `root_id` EXACTLY from the roster, refuses an
incomplete roster, refuses an unknown root, and quarantines (never
deletes) unattributable personas only when told to. The bootstrap no
longer creates `blocks`. Unit test `validator/test/migration006.test.js`:
up → down → up round trip, refusals, quarantine (version-agnostic so 007
can follow).

**The validator after 006:** `/personas/root/:rootId`,
`/personas/by-fid/:fid`, `/rep/:personaId` answer 410 naming the
migration; `POST /personas` refuses a `rootId` (400); `/block` +
`/blocked` are persona-level and say `fanout: "persona-level only"`;
`seed.js` writes no root; `API.md` rewritten.

**The device after 006** (`lib/identity/rootRoster.ts`): the roster is
two layers — the fixture export and a vault-sealed record (`rootRoster`
namespace, ONE opaque value) of what the signer flow created. Everything
that used the column reads the roster: `lib/validator.ts`
(`personasForRoot`, `personasByFid`, `tierFor` by ROOT handle for the
device's own roots), `lib/session.ts`, the classic-feed persona layer
(`lib/policy.ts`: marker → by id first), the validator persona adapter
(`create` strips the root before the wire and records the roster),
`lib/zk/registration.ts` (the device's own root handle, no by-fid read),
the signer and persona routes (record at creation). Blocks:
`app/api/block/route.ts` writes ONE row (the acting persona) and the device
shares the block across the SESSION's own personas at read time
(`lib/policy.ts`, `GET /api/block`); `BlockPersonasButton` says "Block this
persona" and names the sibling regression.

**What zk cost us, named:** SECURITY-POSTURE.md §10 ("What zk cost us:
root-level block fan-out") + assumptions A-Z2-ROSTER-ASSERTED,
A-Z2-006-ORPHANS, A-Z2-FIXTURE-EXPORT, A-Z2-BLOCK-READ-TIME.
`docs/root-reads.md` §F lists every file.

**Legacy tests updated (each a behaviour removed BY DESIGN, not a
tolerance):**

| test | was | is |
|---|---|---|
| `scripts/functional.mjs` "ALL personas of the blocked root vanish" | A2 must vanish with A | "the blocked persona vanishes; its sibling STAYS" — fails if a server-side persona → root link ever returns |
| `validator/test/validator.test.js` "persona tier equals root tier for every persona of the root" | `/rep/:persona` == `/rep/root/:root/tier` | "tier by persona is GONE: 410; tier by root handle; nothing in the schema links a persona to a root; creation with a rootId is 400" |
| `validator/test/validator.test.js` "root-level block fan-out covers all personas, current and future" | fan-out both ends, future personas included | "blocks are PERSONA-LEVEL: no fan-out on either end, idempotent, named on the wire" |
| `validator/test/validator.test.js` validation test | `/rep/persona_nope` 404; creation with rootId | 410; creation without rootId (the test keeps its own grouping, as a device would) |

**Gate 2 suite** `scripts/accept-z7.mjs` (7 checks): schema grep (no
column/table/index links a persona to a root); the wire (410s, 400, no
rootId on a persona); the device roster (a signer device lists its
personas, a second device does not, the validator stores ciphertext);
persona-level blocks with the device's read-time share (one row per
action, no sibling row); RESTART SURVIVAL on
the new schema (killed validator comes back with the same rows and the
same roster ciphertext); the ROLLBACK END TO END ON A SNAPSHOT of the live
fixture db (refusal of an incomplete roster, quarantine of the
unattributable personas — the fixture's orphans are personas created
under signer sessions whose vault roster a later suite reset wiped — exact
restoration of `root_id` for every attributable persona and of the legacy
block pairs, then `migrate` re-applies 006); greps + docs.

| iteration | result |
|---|---|
| 1 (rebuilt on the 006 build; the first build attempt died on the OneDrive `.next` lock again — the harness now pre-clears `.next` with retries and retries once on EINVAL) | z7 **7/7**, validator units 35/35 (incl. migration006 ×4), functional, accept 14/14, g1 5/5, g2 4/4, **c4 recovery 7/7 on the migrated schema**, root-leak clean (55 payloads), z0 11/11, z6 6/6 — green on the first run |
| 2 (rebuilt) | **my own review of the block path found a signal**: the device fanned a block out as one validator row PER OWN PERSONA in a single burst — same target, adjacent rowids, same `created_at` — siblings side by side in operator-visible rows (attack-1 finding 2's class). Fixed before committing: ONE row per block action (the acting persona); the device shares the block across its own personas at READ time (`lib/policy.ts` unions the session personas' lists; `GET /api/block` exposes the union); z7 check 4 now asserts no sibling row exists and the read-time share works when acting as the sibling; posture §10 + A-Z2-BLOCK-READ-TIME. Results: functional, validator units 35/35, accept 14/14, z0 11/11, z6 6/6, root-leak clean, g1 5/5, g2 4/4, c4 7/7; z7 **5/7** — a rig defect of my own: creating b2 made it the ACTIVE persona (the persona route sets the cookie), so the block was written as b2 and check 4 looked for b1's row; check 5 inherited it. |
| 3 (no rebuild; the rig acts as b1 before blocking) | z7 **7/7** — **GREEN** (Gate 2 used 3 of its 6 iterations; one product fix from my own review, one rig fix) |

## Gate 3 — fork continuity as a proof, revocation via epoch re-issuance, attestation scaffolding

**Fork continuity** (`app/api/identity/fork/route.ts`, `lib/zk/gate.ts`
`requestForkContinuity`, `lib/zk/prove.ts`, `validator/zk.js`): the fork
mints `forkCommit = sha256("layers-fork-commit/1|old|new|nonce")`; the
nonce lives in the vault-sealed fork record and is handed ONLY to carried
holders through the forward-pointer resolution; the next prefetch tick
proves membership in the gate's tier tree with the MESSAGE binding
`fork:<forkCommit>` (scope registry entry `fork-continuity`, per-persona on
the NEW persona, linkage argued in `lib/zk/scopes.ts`); the validator
re-derives the message from the commitment, records `zk_fork_claims(new,
commitment, tree, tier, epoch, nullifier)` and grants the tier to the new
persona through the same eligibility path — the tier carries THROUGH the
proof; nothing else stamps it. `GET /zk/fork-claim` is the public check a
holder makes after opening the commitment.

**Revocation via epoch re-issuance** (`POST /zk/revoke` signed by the
device-auth anchor, append-only, effective next epoch; migration 007's
partial unique index "one ACTIVE commitment per root"; the device's
identity INDEX in `.keystore/zk-identity.json`, `zkIdentitySeedAt(seed, i)`
in `lib/crypto/kdf.ts`; `reissueIdentity` = revoke → bump → register).

**Attestation scaffolding** (`zk_attestations` with `issued_epoch` /
`expires_epoch`, trees `attest:<issuer>` built from unexpired attestations
on active registrations, claim kind `attestation` with the issuer bound in
the message, `zk_attestation_claims` pruned like eligibility, the MOCK
issuer behind `ZK_DEV_HOOKS` — `POST /zk/dev/attest`, which can attest the
decoy cohort so the tree clears the client floor). The real issuer is the
morning's decision (notes/runbooks/MORNING.md).

Posture: SECURITY-POSTURE.md §11 + A-Z3-FORK-COMMIT-SET,
A-Z3-REVOKE-EPOCH-GRACE, A-Z3-MOCK-ISSUER, A-Z3-INDEX-FILE,
A-Z3-REISSUE-JOIN.

**Gate 3 suite** `scripts/accept-z8.mjs` (7 checks): registry + duplicate
agreement; fork continuity end to end (commitment, disclosure to the
carried holder only, proof, recorded claim, the PROVEN tier on the new
persona); the binding (a tampered `forkCommit` refused, a tier envelope
carrying one refused); revocation (append-only, effective next epoch,
no re-registration of the revoked commitment, re-issuance to index 1 and
proving again); attestation (issue → tree next epoch → prove → attested →
expiry drops the leaf, proof refused, mark lapses); leaks (nonce and
pairing never on the validator); docs.

| iteration | result |
|---|---|
| 1 (rebuilt on the 007 build) | z8 **3/7**, validator units 35/35, z0 11/11, z6 6/6, z7 7/7, functional, accept 14/14, c4 7/7. Three rig defects and one real one: the suite never selected the zk binding (the env default is the mock binding; the fork route rightly requested no proof under it); the binding and revocation checks proved with personas that are not this root's (the `persona` stage refused them, correctly); and the REAL one — the attestation gate id was `attest:<issuer>`, which the gateId charset (`[A-Za-z0-9_-]`, both sides) refuses, so no attestation proof was ever queued (the tree, the mock issuer and the expiry were fine). Fixed: gate id `attest-<issuer>`; the `enqueue` dev action carries `forkCommit`/`issuer` like `prove` does. |
| 2 (rebuilt) | z8 **6/7** — fork continuity, the binding and the revocation ritual all green; the attestation check's LAST assertion expected the expired-tree proof to fail at the membership stage, but an emptied tree is refused one stage earlier, at the COHORT stage (`cohort 0 is below the client's anonymity floor 50`) — the design working; the check accepts either refusal. Everything else green (validator units, z0, z6, z7, functional, accept, c4). |
| 3 (no rebuild) | z8 **7/7** — **GREEN** (Gate 3 used 3 of its 4 iterations) |

## Gate 4 — linkage test v2 + three adversarial reviews

**Linkage test v2** (`scripts/accept-z9.mjs`, generated from the Pass 1
test by `scratchpad gate4/make-z9.cjs` so the two stay comparable): the
Pass 1 session (two personas of one root among a crowd of decoy roots,
crafted fixture proofs over the anonymous channel) re-run against the
migrated validator, over FOUR epochs, with — inside the recorded session —
a fork (ALT → NEW, the continuity proof), an attestation of the whole
cohort that expires (proofs at the active epoch, refusal after), a
revocation + re-issuance of our commitment, and a block by the session's
persona. The operator's attacks: nullifier equality across every claim
kind, join-epoch correlation (against the original registration; the
re-issued one joins alone — root-level, A-Z3-REISSUE-JOIN), proof-history
intersection (fork and attestation claims included; NEW ∩ ALT joint
candidates ≥ floor), submission timing, operator artifacts; NEW: the fork
pairing (no row holds both ids; the fork record is ciphertext; the claim
holds a commitment only), the revocation (fresh nullifiers, no persona row
names a commitment), the attestation cohort and the block row (one row,
no sibling row within its second).

| z9 run | result |
|---|---|
| 1 | 3/9 — the session aborted: the forked persona tried to POST through the fixture writer, which only writes as the seeded viewer personas (403). Rig fix: NEW proves (fork claim, then tier claims) but does not post. |
| 2 | **8/9 — THE SAFETY SET CAUGHT ONE**: every linkage attack failed (nullifier equality across all claim kinds, join-epoch, proof-history intersection incl. NEW ∩ ALT ≥ floor, timing, artifacts, revocation, attestation cohort, the block row) EXCEPT check 6: the vault-sealed fork record was ADDRESSED by the old persona id (`adapter_state` key `persona_viewer_alt`, sealed record `id` in the clear) — an operator-visible "ALT forked at t" beside NEW's fork-continuity claim arriving at t + jitter. The same class as attack-1 finding 1 (the vault seals values, not addresses). Fixed: the `forks` namespace is stored as ONE opaque sealed record like the zk queue (`lib/adapters/mock/store.ts`); posture §11 names it. |
| 3 (rebuilt) | **9/9 — GREEN** (the checkpoint commit `11a5738`). Siblings not linked below the floor by any attack; the forked persona not linked to its predecessor from server data; the revocation, the attestation expiry and the block inside the session leave no pairing. |
| 4 (reviewed build) | 8/9 — the rig's crafted decoy attestation envelopes still used the bare `attestation` scope after fix attack-z2-3 #6 qualified it by issuer (the validator rightly refused them: cohort of 1); rig fix in the generator. z0 10/11 for the mirror reason (the registry-level derivation must keep working without a qualifier — the product path qualifies, the validator requires it). |
| 5 (rebuilt) | **9/9 — GREEN**, with z0 11/11, z2 7/7, z3 6/6, z8 7/7, validator units, root-leak clean; z6 6/6, z7 7/7, functional, accept 14/14, c4 7/7, m2 7/7 on the same code one build earlier. |

**Three adversarial reviewers** (fresh context, read-only, no servers;
given SECURITY-POSTURE.md, the diff since 60818f7, docs/root-reads.md,
research/VERIFY-YOURSELF.md): `research/attack-z2-1.md` (a surviving
server-side persona → root path), `research/attack-z2-2.md` (does the
fork proof or the revocation leak the relation), `research/attack-z2-3.md`
(a soundness gap in the new scopes and claim kinds). Every finding, by id,
below — fixed or an ASSUMPTION line; nothing vanishes.

G4_FINDINGS_PLACEHOLDER

| report | # | severity | finding | disposition |
|---|---|---|---|---|
| attack-z2-1 | 1 | HIGH (§8 topology) | the device enumerated its own roster to the validator on every render: `GET /personas/<id>` per roster entry, `GET /blocked/<id>` per own persona, one device-SIGNED `GET /zk/eligibility?personaId=` per own persona from the switcher | **FIXED (two of three halves)**: the switcher reads the eligibility MAP once (`app/(main)/layout.tsx`); the session's persona records come from the device-held roster (`RosterDoc.personas`, recorded at creation — `lib/identity/rootRoster.ts`, `lib/validator.ts`). The block-list half → **A-Z2-ROSTER-ENUMERATED-ON-READ** |
| attack-z2-1 | 2 | HIGH (verified on disk) | `envelope_counters.counter` was `Date.now()`; the signed roster flush landed 3 ms after `POST /personas` → persona ⋈ device ⋈ root from the database alone | **FIXED**: device-persisted monotonic counter (`.keystore/envelope-counters.json`, never a clock); `personas.created_at`, `blocks_v2.created_at`, `adapter_state.updated_at`, `zk_registrations.registered_at/revoked_at` at HOUR grain. Residual → **A-Z2-HOUR-GRAIN** |
| attack-z2-1 | 3 | HIGH / MED | vault ADDRESSES were persona ids: `identityRoster` (per persona), `forks` at HEAD (the OLD persona); the mock adapter's plaintext persona-keyed namespaces | **FIXED** for `identityRoster` (one opaque sealed record; z9 check 6 now asserts sealed namespaces have the single address `_`), `forks` (Gate 4, before the reviews); the mock namespaces → **A-Z2-PLAINTEXT-MOCK-ADDRESSES** |
| attack-z2-1 | 4 | MED | fork residue: NEW bound to the device at fork time by the signed flushes; "tier-T persona goes quiet, tier-T persona with a fork claim appears" | flushes are hour-grain and address-sealed now; the presence signature → **A-Z3-FORK-PRESENCE** |
| attack-z2-1 | 5 | MED (hypothesis) | `fcAttribution` beside plaintext `fcWrites.fid` / `rep_events.source_id` → persona → account under per-account fids | **A-Z2-ATTRIBUTION-ACCOUNT-JOIN** (moot in v0's shared FID; follow-up named) |
| attack-z2-1 | 6 | LOW | `sessionHandles` keys were unsalted `sha256(rootId)` prefixes, invertible over `roots` | **FIXED**: one opaque sealed record (`lib/identity/sessionHandles.ts`) |
| attack-z2-1 | 7 | LOW (hypothesis) | attestation expiry partitions the attest tree per commitment | **A-Z3-ATTEST-EXPIRY-PARTITION** (issuer design input: quantize expiry) |
| attack-z2-1 | 8 | INFO | A-Z2-FIXTURE-EXPORT's "never copied back" contradicted by the rollback | **FIXED** (reworded) |
| attack-z2-2 | 1 | HIGH | `syncRoster()` published every keystore persona id as a plaintext vault address in the fork's own signed burst | **FIXED** (same as z2-1 #3: `identityRoster` opaque) |
| attack-z2-2 | 2 | HIGH → closed | the `forks` record was addressed by the OLD persona at HEAD; the guard checked values, not keys | **FIXED** before the review (linkage v2 caught it); z9 now asserts on KEYS |
| attack-z2-2 | 3 | MED | "device D forked at t" emitted synchronously and durably (signed flushes + the clock counter); the claim kind labels NEW | counters + timestamps fixed (above); the kind label and the concurrent-fork candidate set → **A-Z3-FORK-PRESENCE** |
| attack-z2-2 | 4 | MED | re-issuance switched branches mid-epoch; the root's not-yet-proved personas went dark until the boundary — a persona-level gap keyed to root-level ms clocks | **FIXED**: the re-issued branch is PENDING until its activation epoch (the tick promotes it; the old branch proves until then — `lib/zk/registration.ts`, `lib/zk/identity.ts`, `lib/zk/prefetch.ts`); registration clocks at hour grain; z8 check 4 asserts the pending state and the promotion |
| attack-z2-2 | 5 | LOW | the nonce's disclosure gate is a caller-supplied `viewerPersonaId`; cross-device delivery unbuilt | **A-Z3-FORWARD-POINTER-DELIVERY** |
| attack-z2-2 | 6 | INFO | re-issuance rotates the leaf, not the anchor; the recovery scan was a sentence | **A-Z3-REISSUE-SCOPE**; the scan is **BUILT** (`recoverIdentityIndex`, z8 check 4) |
| attack-z2-2 | 7 | INFO | the proof binds a prover-chosen hash, not OLD's root; §11 overstated | **A-Z3-FORK-CLAIM-IS-A-VOUCH**; §11 and the registry's linkage line rewritten |
| attack-z2-3 | 1 | HIGH | `identityRoster` plaintext persona-id keys, device-signed, on the fork request | **FIXED** (opaque record) |
| attack-z2-3 | 2 | MED | the fork-continuity proof is a tier proof with a label; any tier-2 root can vouch for any (old, new) pair; §11's "provably" was false at the proof layer | **A-Z3-FORK-CLAIM-IS-A-VOUCH**; docs rewritten; the holder-side check is "signed forward pointer + claim", never the claim alone |
| attack-z2-3 | 3 | MED | attestation proofs re-created the prepare burst (the tick snapshotted only the gate tree; attest trees fetched at prove time) | **FIXED**: every wanted tree is snapshotted on the tick; a claim without a snapshot is refused, never fetched (`lib/zk/prefetch.ts`, `lib/zk/gate.ts`); A-PREPARE-BURST's text corrected |
| attack-z2-3 | 4 | MED | re-issuance derives i+1 from the unchanged seed (the "compromised secret" bound covers a leaked branch only); the recovery scan did not exist | **A-Z3-REISSUE-SCOPE** (bound reworded); the scan is **BUILT** |
| attack-z2-3 | 5 | LOW | `zk_fork_claims` never pruned — a permanent kind-tagged presence row | **FIXED**: pruned like eligibility (epoch + grace); z9 tolerates the pruned row |
| attack-z2-3 | 6 | LOW | the attestation scope omitted the issuer → one attestation proof per persona per epoch across issuers (silent replay) | **FIXED**: qualified feature `attestation/<issuer>` on both sides; registry linkage line updated |
| attack-z2-3 | 7 | LOW | the fork's partition was counted twice against the proof-history budget | **FIXED**: a tier claim is skipped when the epoch's fork claim already carries the tier |
| attack-z2-3 | 8 | INFO | no validator unit test for Gate 3 cross-kind substitution; tree name bound via root only; fork-claim upsert overwrote downward; fork proofs in non-tier trees consumed the nullifier; the fork route stamps the predecessor's tier on the in-memory record; A-PREPARE-BURST stale | upsert keeps `MAX(tier)`, non-tier fork proofs refused, A-PREPARE-BURST corrected — **FIXED**; the cross-kind unit test and the in-memory tier stamp are named follow-ups (the feed and the validator never read that stamp under zk) |

**What the reviews changed, in one line each:** the counter is not a
clock any more and nothing persona-addressed on the validator carries a
time finer than the hour; every vault namespace this pass touches has ONE
opaque address; the switcher reads the map, not N signed persona reads;
the session's own persona records live on the device; attest trees ride
the fixed-schedule tick like the gate tree; fork claims are pruned; the
attestation scope names the issuer; a fork's proof counts once; a re-issued
branch waits for its activation epoch; the recovery scan exists; and the
fork claim is documented as the VOUCH it is, with continuity resting on the
old persona's signature. The reviewers were right that "the validator
stops knowing" held for the schema and not for the traffic and the
addresses; after this cycle the honest statement is in SECURITY-POSTURE.md
§12, with the residuals as assumptions by id.

**Gate 4 verification on the reviewed build:** z9 9/9 · z8 7/7 · z7 7/7 · z0 11/11 · z2 7/7 · z3 6/6 · z6 6/6 · validator units (incl. migration006) · functional · accept 14/14 · c4 recovery 7/7 · m2 7/7 · root-leak clean. Committed as `zk2: gate 4 green`.


## /verify — the closing sweeps, on the Gate 4 build

Every suite in `scripts/sweep-x.sh` (the Pass 1 SUITES plus `test:z7`,
`test:z8`, `test:z9`), run by `scratchpad z-sweeps.sh` against the
supervised validator and the production build of commit `34ca15c`
(`next build` clean — `scratchpad final-build.txt`; `tsc --noEmit -p
tsconfig.json` clean). The schema grep, the leak grep and the scope
collision test run inside every sweep (`test:z7` check 1, `test:rootleak`
+ `test:z4` check 5 + `test:z9` checks 5–6, `test:z0` check 6);
restart-survival on the new schema is `test:z7` check 5 and `test:z5`
check 5; total-device-loss recovery is `test:c4`.

| sweep | result |
|---|---|
| attempt 1, sweep 1 (01:41 → 02:35) | 53/54 — z9's session hit a transport error ("fetch failed") that the rig counted as a product failure → the sweeps stopped. Standalone z9 reran 8/9 (a pre-fix block row with a millisecond timestamp survived under ON CONFLICT DO NOTHING). Fixes: fetch-transport failures classify as INFRA; z9 retries its validator reads and blocks a fresh target; migration 008 coarsens the timestamps already on disk. Commit `44b1e1f`. |
| attempt 2, sweep 1 (02:43 → 03:38) | **54/54 suites, 383 checks, 0 failed, 0 infra — CLEAN** |
| attempt 2, sweep 2 (03:39 → 04:34) | 53/54 — z0 check 9 ("a thin tier-10 stays under the floor"): POPULATION DRIFT, not a product defect — the fixture had accumulated 800 zero-score signer-flow roots out of 961 over the marathon, so the decoy seeder's fixed score table put 50 of 90 decoys in the top decile (every positive score is above 83% of the population). Fix: the dev seeder places decoy i just above the CURRENT population's (tier-1)/10 quantile, so each decile holds ~count/10 decoys whatever the fixture grows into (`validator/zk.js` seed-decoys). That alone was not enough: with 83% of the population at zero, ANY positive score is above the 90th percentile once the decoys themselves are counted, so the decile model had collapsed for everyone. The rep model now says what the seed always intended: an account with NO rep is tier 1 by definition and the deciles are computed over accounts WITH rep (`validator/rep.js`, `validator/API.md`; the decile unit test is unchanged and green). |
| attempt 3, sweep 1 (04:41 → 05:35) | 52/54 — z4 and z9 check 3's last assertion ("our persona's candidate set does not differ from a decoy's — no distinguisher") failed because the comparison decoy `p_decoy_0_a` had become TIER 1 under the new spread (targets ran 1..10 with the decoy index), so it was in no gate tree and its proof history no longer matched ours (81 vs 91 candidates). Not a linkage: a rig premise (decoy 0 is a peer of ours) broken by the seeder change. Fix: target tiers run 10, 9, …, 1 with the index, so decoy 0 sits in every tier tree and the attest tree; the top decile still holds ~count/10 decoys. |
| attempt 4, sweep 1 (05:40 → 06:36) | **54/54 suites, 383 checks, 0 failed, 0 infra — CLEAN** (commit `0850453`) |
| attempt 4, sweep 2 | 53/54 suites — FAIL   7/9 ZK Pass 2 Gate 4 (linkage v2) checks passed, 2 FAILED |

**Closure bar NOT fully met at the hard stop (07:33): 1 consecutive clean sweep of the 4 required completed on the final code** (sweep 2 failed — see its row). The three earlier attempts each stopped on a rig or fixture-drift defect that was fixed and recorded above. In attempt 4, sweep 2 stopped because the linkage-v2 SESSION (check 0) could not get its own fork-continuity submission accepted — a session-setup failure: the VALIDATOR had in fact accepted it (the zk_fork_claims table holds the new persona's claim at the session's epoch, one fork nullifier recorded), so the session's own copy was reported as a REPLAY: the fork route marks the new persona wanted and the scheduled tick (3 s in the harness) had already proved and submitted an identical claim before the session's dev-enqueued copy went out — a duplicate of an accepted proof, not a verifier refusal and not a linkage (the same suite was 9/9 standalone four times and in attempt-4 sweep 1; after the stop the session was made to accept a replay of an accepted copy and to read the claim back from the validator, and passed 9/9 at 07:39 — `scripts/accept-z9.mjs`). No linkage attack succeeded in any sweep of any attempt. Every product suite that ran was green in every sweep.


## /verify — CLOSED: four consecutive clean sweeps (2026-09-05)

This supersedes the section above, which recorded the overnight run
stopping one sweep short. The bar is met.

Every suite in `scripts/sweep-x.sh` (the Pass 1 suites plus `test:z7`,
`test:z8`, `test:z9`), four times back to back, on identical code, with
the process tree checked for orphans between each:

| sweep | window | suites | checks | failed | infra | validator deaths |
|---|---|---|---|---|---|---|
| 1 | 17:09 → 18:04 | 54 of 54 | 383 | 0 | 0 | 2 (both deliberate) |
| 2 | 18:05 → 19:00 | 54 of 54 | 383 | 0 | 0 | 2 (both deliberate) |
| 3 | 19:01 → 19:56 | 54 of 54 | 383 | 0 | 0 | 2 (both deliberate) |
| 4 | 19:57 → 20:51 | 54 of 54 | 383 | 0 | 0 | 2 (both deliberate) |

The two validator deaths per sweep are the suites' own kills —
`accept-z5` check 5 (the supervisor restarts it and records the death)
and `accept-z7` check 5 (restart survival on the migrated schema). No
unexplained death, no orphaned suite process, and the working tree held
nothing but `notes/reports/SWEEP-STATUS.md` throughout, so all four ran on the same
code. The schema grep, the leak grep and the scope-collision test run
inside every sweep; total-device-loss recovery is `test:c4`.

**It took three earlier attempts, and both things that stopped them were
in the rig, not the product.** Both fixes are recorded in
`notes/reports/SWEEP-STATUS.md` with their evidence:

1. `accept-z5` check 2 compared prefetch tick COUNTS over about three
   jittered periods, with the idle window opening on the tick that had
   just proved a persona check 1 marked WANTED — so it measured proving
   cost as if it were fetch cadence. It now settles before each window,
   measures six periods, and compares mean gap spacing. The in-band gap
   assertion, which is what actually detects an activity-driven tick, is
   unchanged.
2. `sweep-x.sh` could report false green two ways: its liveness probe
   accepted any HTTP response (another project's dev server took port
   3000 mid-sweep and answered 404s, which read as "alive"), and any
   suite exit code outside {0,1,2,124} was recorded as `ok` — fifteen
   suites crashed against the dead port and were all marked ok with empty
   summaries. The probe now requires a 2xx and any other non-zero exit is
   INFRA with its code. **This is the more important of the two: it means
   earlier green sweeps in this project could have contained suites that
   never ran.** The four sweeps above were all run with the fix in place.

The app ran on port 3001 for these sweeps because the other project's
server holds 3000; the validator is unchanged on 4000, supervised.
