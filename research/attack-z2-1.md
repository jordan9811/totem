# ATTACK-Z2-1 — adversarial review of ZK Pass 2, lens: a surviving server-side persona → root path

**Adversary:** the OPERATOR. Runs the validator, holds `validator/layers.db`,
sees every request's peer, headers and timing in-process, and (per
SECURITY-POSTURE §8) does NOT run the Next process — the "device" is the
user's. Where the fixture collapses that (one app process is every fixture
account's device, A-Z2-FIXTURE-EXPORT), I say so per finding.
**Goal of this pass:** after migration 006, find anything on the validator —
table, column, index, route, log or persisted record — that still answers
"which root is behind this persona" or "are these two personas one
account", or that pairs a forked persona with its predecessor, without
breaking cryptography.
**Method:** read the pass end to end (`60818f7..4c09552` and the files it
names), then checked every claim I could against `validator/layers.db`
read-only (`node:sqlite`, `readOnly: true`). The database is gitignored
(`.gitignore:10`) and a suite was running while I read: I read it twice
(the second time `blocks_v2` had 12 rows, `adapter_state` had turned over);
every row I cite carries the timestamp I read. Line numbers are as of my
read of HEAD `4c09552`, except where I name the uncommitted working tree.
**Not done:** no servers run, no suites run, no timings measured, nothing
fixed, no file changed but this one, `.keystore/` / `.zk-artifacts/` /
`.env.local` untouched, no key material printed (device ids are truncated,
nullifiers are prefixes).

---

## Summary

The schema claim is true and the content claim is not. `personas.root_id`
is gone, no table pairs a persona column with a root column, `blocks_v2` is
persona-level, `zk_fork_claims` never holds the old persona, and the zk
tables are epoch-grain `WITHOUT ROWID`. I tried to join through the
nullifier, the epoch, the placement, the rowid and the re-issuance and got
nothing the posture doc does not already own (see *Attacks that failed*).

The validator can still answer persona → root, three ways, none of which
touches a proof, a tree or the anonymous channel:

1. **In the §8 topology the device enumerates its own roster to the
   validator, by persona id, on every render** — `GET /personas/<id>` per
   roster entry, `GET /blocked/<id>` per own persona, and under the zk
   binding one `GET /zk/eligibility?personaId=<id>` per own persona
   carrying the device-signed envelope (`x-layers-device`). The storage of
   the roster moved to the device; its use is a per-request broadcast of
   the roster to the operator. Invisible in the fixture, where every device
   is one host, and outside what `accept-z9` taps. (Finding 1.)
2. **The envelope counter is a wall clock, and the database alone pairs
   persona rows to the device that made them.** `envelope_counters.counter`
   is `Date.now()` at write time; the vault-sealed roster flush lands 3 ms
   after `POST /personas`. Verified in the database: 8 persona rows pair
   with a `rootRoster` counter at 3–73 ms, including FOUR personas created
   by one device in one 73 ms burst — a sibling set from one SQL join, no
   logs. Device → root is the anchor. (Finding 2.)
3. **Vault addresses are still persona ids.** `identityRoster` is one
   ciphertext record PER persona, keyed by the persona id in plaintext, and
   it is flushed by the fork route 8–11 ms after the `forks` record — which
   at HEAD is keyed by the OLD persona id. Old → new, in two plaintext
   keys, one device, 11 ms apart, on disk. The Gate 4 linkage test v2 caught
   and sealed the `forks` half in the uncommitted working tree while I was
   reading; the `identityRoster` half is still there, and so is a class of
   non-vault namespaces keyed by persona id (`activeMode`, `attestations`,
   `saturation`, `blocks`, …) under one device envelope. (Finding 3.)

Findings 1–3 are each independently a persona → root oracle. Finding 2
requires nothing but one SQL query on the operator's own database.

Plus: the fork's metadata residue after the address fix (Finding 4), the
FC attribution index joining to the account through `fcWrites.fid` /
`rep_events.source_id` (Finding 5, production hypothesis), invertible
`sessionHandles` keys (Finding 6), attestation expiry as a partition
(Finding 7, hypothesis), and a posture line contradicted by its own
rollback (Finding 8).

---

## Findings

### 1. The device enumerates its own roster to the validator, by id, on every render — and signs the eligibility half

**Claim.** After 006 the roster lives on the device (`lib/identity/
rootRoster.ts`). Every use of it turns it into a burst of persona-addressed
validator requests from the device: the persona records themselves, the
block lists, and the proven tiers. In the §8 topology the peer is the user's
device and, when the deployment is armed (`LAYERS_REQUIRE_SIG=true`, the
harness default per `notes/reports/RESUME.md`), the eligibility reads carry
`x-layers-device`. The operator learns "device D's personas are {a, b, c}"
on every page load, and D → root is the anchor it already holds.

**Code evidence.**
- `lib/session.ts:36-41` — every `getSession()` resolves the session's
  personas via `personasForRoot(rootId)` (signer sessions) or
  `personasByFid(getSelf().fid)` (the fixture self).
- `lib/validator.ts:33-42` — `personasForRoot`: the device roster's ids,
  then `getPersona(id)` for EACH id, sequentially, `cache: "no-store"`
  (`:11-25`) → `GET /personas/<id>` × N (`validator/server.js:98-102`).
  Unsigned, but from the same peer, in roster order, back to back.
- `app/(main)/layout.tsx:21-24` — the switcher loops `session.personas` and
  asks `personaTier(p.id, …)` per persona → `lib/rep/personaTier.ts:19-21`
  → under zk `lib/adapters/zk/rep.ts:20-23` → `lib/zk/validatorClient.ts:
  125-129` `fetchEligibility` = `GET /zk/eligibility?…&personaId=<p>`
  through `vgetSigned` (`:112-123`), whose headers are
  `signedReadHeaders("zk:eligibility")` (`lib/adapters/mock/persist.ts:
  206-209` → `envelopeHeaders`, `:188-199`: `x-layers-device`,
  `x-layers-counter`, `x-layers-sig`). One signed, device-named request
  PER OWN PERSONA per layout render. The validator verifies the device and
  records its counter (`validator/zk.js:691-697`; `server.js:254-286`).
  Note the signature covers `namespace|bodyHash|counter` only
  (`server.js:275`), never the query — the persona id rides beside the
  device id unsigned, which changes nothing for the operator.
- `lib/policy.ts:85-92` — `applyFeedPolicy` fans `blockedFor(id)` over the
  viewer, its keystore siblings AND `opts.own` (the session personas) in a
  `Promise.all` → `GET /blocked/<id>` × N in one burst
  (`server.js:151-156`). `app/api/block/route.ts:47-58` does the same for
  the whole session on `GET /api/block`.
- Under the legacy validator binding the burst also names the root:
  `lib/validator.ts:65-71` `tierFor(personaId)` → `rootOfPersona` →
  `GET /rep/root/<rootId>/tier` (`server.js:104-108`) — the root id in a
  URL, in the same request window as the `/personas/<id>` calls.
- Device → root: `devices.delegation` verifies against the ONE anchor
  (`server.js:189-194, 263-272`), and the same anchor signs
  `layers-zk-register/1|mode|commitment|rootId|issuedAt`
  (`validator/zk.js:110-111, 395-398`) — the anchor is a root's device-auth
  key by construction (`lib/crypto/kdf.ts:49-58`); A-SINGLE-TENANT-
  REGISTRATION says one anchor slot = one root.

**Attack narrative.** The operator does nothing but watch its own Express
process. Per request from device D (its `x-layers-device` on the
eligibility reads, or its peer address for the rest): the set of persona
ids in `/personas/<id>`, `/zk/eligibility?personaId=`, `/blocked/<id>` for
that request window IS the roster. Two personas of one root are two ids in
one burst. Root identity is the anchor D chains to. No timing analysis, no
relay, no tree.

**What the fixture and the suites see.** Nothing: the app process is every
account's device (A-Z2-FIXTURE-EXPORT), so every burst spans every account.
`scripts/accept-z9.mjs` taps only anonymous submissions and posts
(`wire`, `:115`, `:165`, `:202`, `:217`) and reads a curated database view
(`operatorView()`, `:250-272`); identified GETs are not part of the
operator's view it models.

**Severity:** HIGH in the §8 topology (complete sibling linkage, per page
load); NONE in the fixture. **Confidence:** HIGH on the code path; the
topology is the posture doc's own.
**Already admitted?** NO. A-ELIGIBILITY-VISIBLE and A-PRESENCE-LOG admit
the STORE; REPORT-Z2 Gate 0 admits "the feed's own eligibility read … the
operator already sees the render" — that is the one-call MAP read
(`fetchEligibilityMap`, `validatorClient.ts:133-136`), not N per-persona
reads from the switcher. A-Z2-BLOCK-READ-TIME admits the read-time union
and then says "the blocker's siblings are not [operator-visible]" — the
`GET /blocked/{a,b,c}` burst that implements the union is exactly the
sibling list. A-TRAFFIC admits the peer IP on the SUBMISSION path only.
**Fix or assumption.** The device must never ask the validator about its
own personas as a set: read the eligibility MAP once (it exists) and index
it locally for the switcher; keep persona display records on the device
(the vault roster already holds the ids — hold name/handle/avatar too) or
fetch the persona directory whole; read block lists as one map; and never
attach a device envelope to a persona-addressed read. Otherwise an
ASSUMPTION line: **A-Z2-ROSTER-ENUMERATED-ON-READ** — "in the device
topology, every render sends the validator the device's persona ids as a
group, signed on the eligibility reads; the roster is hidden at rest and
broadcast in use."

---

### 2. The envelope counter is a wall clock; the database alone pairs a persona row to the device that created it

**Claim.** `envelope_counters.counter` is `Date.now()` at the time of the
signed write. Persona creation is `POST /personas` (unsigned, no root in
the body — correct) immediately followed by the vault-sealed roster flush
(signed). The two land 3 ms apart. So `personas.created_at ⋈
envelope_counters(namespace='rootRoster').counter` pairs each persona to the
device that recorded it — persisted, surviving restarts, needing no request
log — and device → root is Finding 1's anchor chain. The same coupling
exists on the fork route and on the block route.

**Code evidence.**
- `lib/adapters/mock/persist.ts:137-144` — `nextCounter`: `base =
  Date.now(); next = base > prev ? base : prev + 1`. The counter IS the
  timestamp unless two writes share a millisecond.
- `persist.ts:188-199` — `envelopeHeaders` sends it as `x-layers-counter`;
  `validator/server.js:277-285` — `checkEnvelope` upserts it into
  `envelope_counters(device_id, namespace)`.
- `app/api/personas/route.ts:25-27` — `createPersona` (→ `POST /personas`,
  `server.js:88-89`: `created_at = Date.now()`) then `recordPersona` →
  `lib/identity/rootRoster.ts:116-121` → `save` (`:88-94`) →
  `flushVault("rootRoster")` (`persist.ts:240-262`, signed). Same sequence
  in `lib/adapters/validator/index.ts:44-53`.
- `app/api/identity/fork/route.ts:167-176` — `persistNs("forks")`,
  `persistNs("grantsV3")`, `syncRoster()` (`lib/identity/roster.ts:23-28`)
  — three signed vault flushes in one request.
- `app/api/block/route.ts:25-37` — `blockPersona` (unsigned `POST /block`,
  `server.js:147`: `created_at = Date.now()`) then `logEdgeEvent` →
  `lib/eventlog/log.ts:100-114` `persistNs("edgeEvents")` (signed).

**Evidence from the database** (`validator/layers.db`, read-only, first
read):

```
envelope_counters(rootRoster).counter  personas.created_at             dt
dev_f00a0c23…  1788582201585           persona_dee3c09f2edf9c3b  …582    3 ms
dev_21b08d03…  1788582836697           persona_6c9202bb807475d0  …694    3 ms
dev_1e05cca9…  1788583382100           persona_bcff4e2d1e5a9ca4  …027   73 ms
dev_1e05cca9…  1788583382100           persona_abf79ace2b0062ae  …042   58 ms
dev_1e05cca9…  1788583382100           persona_3163eb90f374d398  …084   16 ms
dev_1e05cca9…  1788583382100           persona_9f33176cdf81c849  …097    3 ms
dev_96b4aa6c…  1788583576564           persona_a6a3be75724af1a3  …561    3 ms
dev_1e725a02…  1788583914722           persona_d855133462850070  …719    3 ms
```

Eight of the nine `rootRoster` counters pair with a persona at ≤ 73 ms; one
device pairs with FOUR personas created in one burst — a sibling set of
four, from two tables, one join. The fork burst is the same shape (second
read): device `dev_6b1e36af…` has `forks` at −4 ms, `grantsV3` at +2 ms and
`identityRoster` at +8 ms around the `forks` row's `adapter_state.
updated_at` — one device, one fork, three timestamped writes.
`envelope_counters` holds 1982 rows over 76 namespaces; the table is never
pruned. Its `rootRoster`, `forks`, `identityRoster` rows are 5, 31 and 31.

**Limits, stated.** The upsert keeps only the LAST counter per (device,
namespace), so the durable pairing is "the most recent persona this device
created"; the request stream carries all of them live (Finding 1). Block
rows did not pair within 3 s in the current database (the `edgeEvents`
flush is asynchronous relative to the block write in the suites' traffic);
the mechanism is identical and I file the block half as MED-confidence.

**Attack narrative.** `SELECT e.device_id, p.id FROM envelope_counters e
JOIN personas p ON abs(e.counter - p.created_at) < 100 WHERE e.namespace =
'rootRoster'`. Then device → anchor → `zk_registrations.root_id`. Done —
and every row survives a validator restart.

**Severity:** HIGH — verified against on-disk state, offline, no analysis.
**Confidence:** HIGH.
**Already admitted?** NO. attack-1 finding 2 (the identified flush bracketing
an anonymous send) was fixed for the zk queue only (REPORT-Z1 rebuttal:
deferred `sent` persist). The same identified-write-after-identified-row
coupling exists on persona creation, forking and blocking, and the
`envelope_counters` table is a durable artifact no assumption names.
**Fix or assumption.** Counters must not be timestamps (a per-namespace
monotonic integer from a random base, or `prev + 1` always); the roster
flush must not be synchronous with persona creation (batch it onto the
prefetch tick, as Gate 0 already did for the queue write — `lib/zk/
prefetch.ts:14-17`); `personas.created_at` and `blocks_v2.created_at`
coarsened to the epoch. Otherwise **A-Z2-ENVELOPE-CLOCK** — "every signed
write stamps `(device, namespace, ms)` into a durable table; persona
creation and forking are each followed within milliseconds by such a
write; the operator can pair the persona to the device from the database
alone."

---

### 3. Vault ADDRESSES are still persona ids — `identityRoster` (every keystore persona), `forks` at HEAD (the OLD persona), and the plaintext mock namespaces

**Claim.** The vault seals values, not addresses (attack-1 finding 1,
`lib/vault/vault.ts:88-98`: `out[id] = encryptRecord(key, ns, id,
record)` — the plaintext id is the document key, and `server.js:335-336`
stores it as `adapter_state.key`). Pass 2 fixed this for the roster
(`rootRoster` is ONE record `_`, `rootRoster.ts:88-94`) and the queue
(`store.ts:643-647` `opaqueDump`). It did not fix `identityRoster`, and at
HEAD not `forks` — and the two are written together by the fork route,
which makes old → new a pair of plaintext keys 11 ms apart.

**Code evidence.**
- `lib/identity/roster.ts:23-28` — `syncRoster`: `for (const p of roster)
  doc[p.id] = p; flushVault(NS, encryptNamespace(NS, doc, …))` — one
  ciphertext record per keystore persona, ADDRESSED by the persona id.
  `rosterForRecovery()` is every keystore persona
  (`lib/identity/keystore.ts:377-379`). Called on every fork
  (`app/api/identity/fork/route.ts:174-176`) and by `syncRoster`
  (`app/api/recovery/route.ts:69-70`). `identityRoster` is in
  `VAULT_NAMESPACES` (`vault.ts:58`) — values sealed, keys not.
- `lib/adapters/mock/store.ts:419` at HEAD — `forks: { dump: (s) =>
  mapDump(s.forks) }` with the map keyed by `fromPersona`
  (`fork/route.ts:157`): the OLD persona id as the plaintext key.
  **Working tree as of my read:** `store.ts:423-426` now `opaqueDump`s it
  (uncommitted; `SECURITY-POSTURE.md` §11 gained a paragraph saying the
  linkage test v2 caught it). The `identityRoster` half is unchanged.
- Non-vault namespaces keyed by persona id, flushed under the device
  envelope (`persist.ts:219-230`) as PLAINTEXT: `store.ts:373-376`
  `activeMode` (`activeModeByPersona: Map<personaId, modeId>`, `:110`);
  `:387-390` `attestations` keyed `${personaId}:${issuerId}`; `:397-400`
  `saturation` keyed `${personaId}:${storyId}:…`; `:409-412` `blocks`
  keyed by blocker persona; `:391` `readwise` (`${personaId}:${postHash}`,
  `:113`); `:443` `graphConsent` (`${personaId}:${category}`, `:135`);
  `:433` `folderFollows` (`:130`); `:497` `destinationBindings` (`:159`);
  `:573` `xSyncCursor` (`:181`); `:577` `personaDefaultMode` (`:184`);
  `:581` `timelineUndoDepth` (`:188`). None is in `VAULT_NAMESPACES`
  (`vault.ts:44-69`). `modes` (`:372`) is keyed by mode id but every value
  carries `"personaId"` in the clear.

**Evidence from the database.**
- First read: `forks | persona_viewer_alt | CIPHERTEXT ns=forks
  id=persona_viewer_alt` at `updated_at 1788584221685`, and
  `identityRoster | p_d5bc98f60046cabf44c6d21be2ba1dce | CIPHERTEXT` at
  `1788584221696` — the OLD persona's key and the NEW persona's key, 11 ms
  apart, written by one device (Finding 2's counters: `forks` −4 ms,
  `grantsV3` +2 ms, `identityRoster` +8 ms). `zk_fork_claims` names
  `p_d5bc98…` (tree `tier-2`, tier 2, epoch 82807), and `zk_eligibility`
  names it at epoch 82808. So the validator held, in plaintext keys: "the
  persona that forked" and "the persona that was minted 11 ms later and
  then proved continuity". That is the pairing §11 says it never learns.
- Second read (after the working-tree fix): `forks | _` — sealed; but
  `identityRoster | p_0b181d94f55221466a63e3a0cef05203` — still the
  freshly forked persona, keyed in plaintext, 6 ms after the `forks` row.
- Second read, plaintext mock namespaces right now: `activeMode |
  persona_acc_food_2`, `activeMode | persona_acc_food_4`, and six `modes`
  rows whose values say `"personaId":"persona_acc_food_2"` / `_4`. In the
  fixture those two are DIFFERENT roots (`seed/data/accounts.json:414-415,
  445-446`) because the one app process is every account's device — the
  rows show the mechanism (two personas' state under one device envelope),
  not a sibling pair. In the §8 topology one device's key set is one root's
  persona set. `envelope_counters` shows 47 signed `activeMode` writes, 27
  `attestations`, 27 `saturation`, 29 `blocks`, 22 `personaDefaultMode`.

**Why the pass's own tests did not see it.** `scripts/accept-z8.mjs:235`
looks for OLD and NEW within 200 characters of one line of the state dump;
the v2 test `scripts/accept-z9.mjs:380-381` asserts "no ROW holds both
ids", and its `operatorView()` (`:250-272`) reads only the `zkProofBudget`,
`zkRootAnchor`, `zkQueue`, `fcAttribution` and `forks` namespaces — never
`identityRoster`, never `activeMode` and friends, never
`envelope_counters`, never `updated_at`. Two rows in two namespaces, 11 ms
apart, pass both by construction.

**Attack narrative.** `SELECT namespace, key, updated_at FROM adapter_state
WHERE key LIKE 'p\_%' OR key LIKE 'persona\_%' ORDER BY updated_at` — the
device's persona ids, by name, with the time each was last touched; join
`envelope_counters` for the device, then the anchor for the root. For a
fork: the `identityRoster` key that appears at the fork time is the NEW
persona; at HEAD the `forks` key beside it was the OLD one.

**Severity:** HIGH for `identityRoster` + `forks`@HEAD (verified old → new
pairing on disk); MED for the plaintext mock namespaces (mechanism
verified; the current rows span roots because of the fixture topology).
**Confidence:** HIGH.
**Already admitted?** PARTIALLY, and only just: the uncommitted §11
paragraph admits the `forks` half ("the vault seals values, not addresses
… learned twice"). It does not mention `identityRoster` or the plaintext
namespaces. REPORT-Z1's rebuttal of attack-1 #1 ("the one remaining zk
vault namespace is ONE opaque sealed record") is true of the zk namespaces
and silent about the rest of `adapter_state`. §10's sentence "the validator
has no table, column or index that links a persona to a root" is true of
the schema and false of the content.
**Fix or assumption.** Seal addresses everywhere: the document key becomes
`HMAC(vaultKey, ns‖id)` and the real id rides inside the sealed record
(attack-1's fix #1, still not applied generally) — or store `identityRoster`
as one opaque record like `rootRoster`. Move every persona-keyed mock
namespace behind the vault or an `opaqueDump`. Otherwise
**A-Z2-PLAINTEXT-ADDRESSES** — "`identityRoster` is one sealed record per
persona keyed by the persona id; the demo's mock adapter state is
persona-keyed plaintext; both are written under the device envelope; the
device's persona set is readable from `adapter_state` keys."

---

### 4. The fork's metadata residue after the address fix — NEW is bound to the device at fork time, and OLD's presence vector stops where NEW's starts

**Claim.** With `forks` sealed (working tree), the fork still emits, in one
device-signed request: the `identityRoster` write keyed by NEW (Finding 3),
`grantsV3` re-issues (opaque ids, but the row count = carried holders), and
the `envelope_counters` stamps (Finding 2). So NEW ↔ device is known at the
moment of the fork, independent of the continuity proof. Pairing NEW with
OLD then needs only the presence log: `zk_fork_claims(new, tier T, epoch
E)` (`validator/zk.js:540-545`) says NEW's root was tier-T at E; OLD was a
tier-T persona of the same device whose `zk_eligibility` rows stop being
refreshed after E if the user retires it (the product intent of a fork,
`lib/identity/fork.ts:2-8`). The candidate set is "tier-T personas that
went quiet at E" — how small that is in a live cohort is arithmetic against
activity rates I cannot compute here.

**Code evidence.** `app/api/identity/fork/route.ts:141-176`;
`validator/zk.js:536-559` (fork claims and eligibility share the epoch and
tier); `zk.js:558` (pruning keeps the current epoch and its grace, so the
"went quiet" bit is visible for two epochs, longer in any log);
`lib/zk/gate.ts:332-340` (`requestForkContinuity` marks NEW wanted at the
fork; proved on the next tick, jittered — good).

**Severity:** MED. **Confidence:** HIGH on the mechanism; the narrowing
magnitude is a HYPOTHESIS.
**Already admitted?** PARTIALLY. A-Z3-FORK-COMMIT-SET admits the hash is
unguessable; A-PRESENCE-LOG admits correlated presence vectors in general.
Neither says the fork itself binds NEW to the device on the identified
channel at the fork time, nor that "one persona stops, one starts, same
tier, same epoch" is the fork's own signature.
**Fix or assumption.** Batch the fork's vault writes onto the prefetch
tick with the proof; seal `identityRoster`; state
**A-Z3-FORK-PRESENCE** — "the fork is visible as a persona of tier T going
quiet while a persona of tier T with a fork claim appears; the commitment
hides which, the presence log bounds how many."

---

### 5. The attribution index joins to the account through `fcWrites.fid` and `rep_events.source_id` — plaintext, three tables

**Claim.** C5 admits `castHash → personaId` stays plaintext. Beside it sit
`fcWrites` (`castHash → fid`, plaintext) and `rep_events` (`root_id,
source_id = castHash`, written by the poller) — so `persona → castHash →
fid → roots.fid → root_id` and `persona → castHash → rep_events.root_id`
are two plaintext joins to the account.

**Code evidence.** `lib/adapters/mock/store.ts:623-629` — both namespaces
dump verbatim; neither is in `VAULT_NAMESPACES`. `lib/fc/writeLedger.ts:139`
records `fid` on every ledger entry; `app/api/fc/write/route.ts:95-112`
writes `fcAttribution[castHash] = { personaId, at, signature }`.
`validator/poller.js:41-50` inserts `rep_events(root_id, 'cast_created',
source_id = cast.hash)` per root's fid. `server.js:59-75` — `roots(fid)`
is per account once the signer flow registers real fids
(`app/api/signer/route.ts:16`).

**Evidence from the database.** `fcWrites | fcw_…6bh1s → { castHash:
0xfc14a4de81238b2be8, fid: 3348985 }` and `fcAttribution |
0xfc14a4de81238b2be8 → { personaId: persona_viewer_main }`;
`0xfc009e1947f24c7fb1 → fid 3348985 / persona_viewer_alt`. Both viewer
personas are attributed to one fid in plaintext. Today that fid is the ONE
shared test FID of the FC v0 design (`lib/fc/attribution.ts:2-6`) and
`roots` has no row for it (only fid 9152) — so in v0 the join lands on "the
app's FID", not a root, and the poller is off in the fixture
(`rep_events.source_id` patterns: `seed:*`, `zk-decoy-seed:*` only).

**Severity:** MED in a deployment with per-account fids and the poller on
— a HYPOTHESIS grounded on code, not on a current row; INFO today.
**Already admitted?** PARTIALLY (C5). The posture names the persona half of
the index and not the account half stored next to it.
**Fix or assumption.** Drop `fid` from the ledger entry (the write door
knows it; the record does not need it) or vault `fcWrites`; hash
`source_id` in `rep_events` (the dedupe only needs equality); or
**A-Z2-ATTRIBUTION-ACCOUNT-JOIN** — "the attribution index is plaintext and
so are the cast → fid and cast → root records beside it; under per-account
fids the operator joins persona to account through the cast hash."

---

### 6. `sessionHandles` keys are `sha256(rootId ‖ ":session")[:24]` — invertible over the `roots` table

**Code evidence.** `lib/identity/sessionHandles.ts:16-18` — the handle is a
deterministic unsalted hash of the root id; `:42-58` — the WHOLE map is
re-sealed and re-PUT (signed) on every signer connect
(`app/api/signer/route.ts:24`), with the handles as plaintext keys
(`encryptNamespace(NS, Object.fromEntries(map))`, values sealed, keys not).
The operator holds every root id (`roots`) and can compute every handle.

**What it reveals.** The set of roots that ever opened a session through
this app process, and when (`envelope_counters(sessionHandles)`: 29
writes). In the §8 topology that is the device's own root — nothing new;
in any multi-root process it is the login roster. Also noted:
`signer/route.ts:27` sets a `layers_fid` cookie in the clear — to the app,
not the validator.

**Severity:** LOW. **Confidence:** HIGH.
**Already admitted?** NO (the module's own comment calls the map "a
session-deanonymization table" and vaults the values; the keys were
overlooked, the same address lesson as Finding 3).
**Fix.** Key the map by `HMAC(vaultKey, rootId)` or store it as one opaque
record.

---

### 7. Attestation expiry is a per-commitment partition — the leaf that drops names the persona that stops (HYPOTHESIS)

**Code evidence.** `validator/zk.js:314-318` — `attest:<issuer>` membership
is `issued_epoch < epoch AND expires_epoch > epoch`; `:767-775` —
`/zk/attestations?commitment=` publishes each commitment's expiry; `:546-548`
— `zk_attestation_claims` per persona per epoch. Distinct expiry epochs per
commitment (a real issuer attests at different times) mean that at each
boundary the commitments leaving the tree are public and root-level, and
the personas whose claims stop that epoch are theirs. The client's cohort-
continuity check (A-COHORT-ROTATION) protects a prover that continues; it
says nothing for the persona that just lost its leaf. In the fixture the
mock issuer attests the whole cohort with one shared expiry (`zk.js:804,
812`), so `accept-z8` check 5 cannot see it.

**Severity:** LOW (a narrowing at expiry boundaries, proportional to how
few commitments expire together). **Confidence:** MED — HYPOTHESIS on
magnitude. **Already admitted?** NO (A-Z3-MOCK-ISSUER is about issuer
trust). **Fix.** Quantize expiry to shared boundaries (issue in cohorts),
or state it.

---

### 8. The rollback contradicts A-Z2-FIXTURE-EXPORT's "never copied back" (INFO)

A-Z2-FIXTURE-EXPORT: the export "must never be produced on, or copied back
to, the validator". `validator/migrate-down.js:26-36` reads the roster on
the validator host by design, and `scripts/accept-z7.mjs:208-260` feeds the
device's export to a validator-side process on every run (on a snapshot).
This is rule 4 working as intended; the posture line should say "except the
rollback, which is the operator re-learning the roster by the user's act".
`rosterExport` on `/api/zk` (`app/api/zk/route.ts:442-448`) is correctly
dev-gated; `rosterStatus` exposes counts only (`rootRoster.ts:148-159`).

---

## Attacks that failed

What the design defeats, with the reason.

- **A schema-level join.** `personas` has no root column
  (`validator/migrations.js:216-227`); `blocks_v2` is persona ↔ persona
  (`:228-233`); no index pairs a persona column with a root column
  (`accept-z7.mjs:58-76` checks it on every run; I re-ran the schema dump
  read-only and it holds).
- **`zk_fork_claims` → the old persona.** The row is `(mode, persona_id =
  NEW, fork_commit, tree, tier, epoch, nullifier)` (`zk.js:541-544`); the
  message binds `fork:<commit>` and the validator re-derives it from the
  commitment (`zk.js:187-189`); the nonce is 16 random bytes in the sealed
  fork record and the forward pointer only (`fork/route.ts:146-166,
  51-55`). A-Z3-FORK-COMMIT-SET is correct as far as it goes.
- **Joining the zk tables through the nullifier.** `zk_nullifiers` (no
  persona), `zk_eligibility`, `zk_fork_claims` and `zk_attestation_claims`
  share the nullifier, but every table with a persona already names it;
  the join adds nothing. All four are `WITHOUT ROWID`, epoch-grain, no
  timestamps (`migrations.js:170-192, 331-358`).
- **Placement order after re-issuance.** The new registration is the last
  leaf (`zk.js:262-263`, `ORDER BY registered_at`), but the leaf index is
  not a public input, and the personas prove with fresh per-persona
  nullifiers under the new leaf (`lib/zk/scopes.ts:135-148`, `zk.js:
  171-176`). A-Z3-REISSUE-JOIN honestly names the root-level pairing the
  registration rows give; `accept-z9` check 7 covers the persona level.
- **`GET /zk/registration` / `/zk/attestations` / `/zk/fork-claim` as
  root oracles.** Registration status never returns `root_id`
  (`zk.js:665-671`); attestations are by commitment (`:767-775`); the fork
  claim read returns only what the validator already recorded (`:755-764`).
- **The roster's CONTENT.** `rootRoster` is ONE sealed record `_` padded to
  1 KiB steps (`rootRoster.ts:88-94`) — nothing about which ids it holds is
  readable, and the fixture export never leaves `.keystore/` except by the
  rollback (Finding 8). The `zkQueue` is likewise opaque (`store.ts:643-
  647`).
- **Registration or revocation from a persona context.** Refused on the
  view-as cookie and on a `personaId` in the body (`app/api/zk/route.ts:
  81-95, 99-106`); both are signed by the device-auth anchor, never a
  persona key (`lib/zk/registration.ts:57-62, 85-90`).
- **`POST /personas` carrying the root.** A `rootId` in the body is a 400
  (`server.js:80-82`). The root arrives 3 ms later as Finding 2's
  timestamp, not in the body.
- **`personas.created_at` vs `roots.created_at`.** The seed writes both
  with one `now` (`validator/seed.js:22-41`), so seeded rows do not pair by
  time; only signer-flow creations do, through Finding 2.
- **The block WRITE seating siblings.** One row per action
  (`app/api/block/route.ts:25`, `server.js:142-149`); the current database
  shows no sibling pair among 12 `blocks_v2` rows, and the read-time union
  is device-side — the leak is the read burst (Finding 1), not the rows.
- **The poller as a root oracle in the fixture.** Off without
  `NEYNAR_API_KEY` (`poller.js:59-63`); `poll_state` is empty; production
  is Finding 5's hypothesis.

---

## Verdict

Migration 006 did what it says to the schema, and the Gate 3 additions —
the fork commitment, the append-only revocation, the attestation trees —
do not by themselves hand the operator a persona → root row; I could not
recover one from the zk tables, the nullifiers, the placements or the
re-issuance. But "the validator stops knowing" is not true of the validator
as a whole. It still learns which personas share a device three ways that
need no cryptography and no anonymous channel: the device tells it, by id,
on every render (Finding 1, the §8 topology); its own envelope-counter
table timestamps every signed flush, and persona creation and forking each
flush within milliseconds of the persona-keyed row they follow (Finding 2,
verified on disk); and the vault still seals values, not addresses, so
`identityRoster` — and, at HEAD, `forks` — name the personas in plaintext
keys, with the demo's persona-keyed mock namespaces beside them (Finding 3,
verified on disk; the `forks` half sealed in the working tree while I
read). The pass's own linkage tests could not see any of this because their
operator view is a curated subset of the database and taps no identified
request. The fixes are mechanical and already exist in the codebase as
patterns — the opaque record, the scheduled flush, the one-call map read —
they just were not applied to the roster's USE and to its SHADOWS. Until
they are, or until three assumption lines say so, §10's "no table, column,
index, route, log or persisted record" should read "no schema column".
