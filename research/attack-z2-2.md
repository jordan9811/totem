# ATTACK-Z2-2 — adversarial review, lens: does the fork proof or the revocation leak the relation?

**Adversary:** the OPERATOR. Runs the validator, hosts the trees and the
relay, holds `validator/layers.db` and the process logs, sees request
metadata and timing.
**Goal of this pass:** link a forked persona to its predecessor, link two
personas of one root through the fork or the re-issuance, or narrow a
proof's candidate set below the anonymity floor — without breaking any
cryptography.
**Method:** read the fork path end to end (route → gate → prefetch →
prove → queue → anonymous channel → validator) and the re-issuance path
(registration → identity/kdf → validator), then checked what could be
checked against `validator/layers.db` read-only.
**Tree under review:** HEAD `4c09552` (gate 3 green) PLUS the uncommitted
Gate 4 edits on disk at the time of reading: `lib/adapters/mock/store.ts`
(the `forks` record re-keyed to one opaque sealed value),
`scripts/accept-z9.mjs` (NEW's tier proof moved to round 3), and a new
paragraph in `SECURITY-POSTURE.md` at 497–503. Line numbers are the
working tree's as of this read; where HEAD differs I say so.
**Database caveat:** a suite was writing the database while I read it —
the `forks` namespace went 0 → 1 → 0 rows across three reads inside four
minutes. Every row I quote carries the `Date.now()` of the read that saw
it. The SHAPES are the evidence; the rows are illustrations.
**Not done:** no servers run, no suites run, no timing measured, nothing
changed except this file. No key material printed.

---

## Summary

The cryptographic half of §11 holds. The commitment is a domain-separated
SHA-256 over `old|new|nonce` with a 16-byte CSPRNG nonce; the nonce rides
no response, no log and no plaintext value; the validator re-derives the
message from the commitment it is handed and records only the NEW
persona; NEW's fork nullifier, NEW's tier nullifier and OLD's nullifiers
are pairwise unrelated by construction; re-issuance yields fresh
nullifiers under a fresh secret, batched to the next epoch, with the old
leaf frozen in place until then. I could not recover OLD from anything
the fork PROOF produces, and I could not pair old-commitment personas to
new-commitment personas through anything the REVOCATION produces at the
proof layer (see *Attacks that failed*).

The relation leaks around the proof, in what the fork route writes on
the identified channel in the same breath, and in what the re-issuance
does to the device's own behaviour:

1. **The fork route's last act, `syncRoster()`, PUTs the `identityRoster`
   vault namespace ADDRESSED BY PERSONA ID** — every keystore persona (in
   this codebase, every fork this device ever made) as a plaintext key,
   device-signed, 11 ms after the sealed fork record. `zk_fork_claims`
   then names the same id. NEW → root is an SQL join, and every forked
   persona of one device sits beside every other. This is attack-1
   finding 1's mechanism in the one vault namespace that neither the
   Pass 1 rebuttal nor the Gate 4 fix counted. (Finding 1, HIGH.)
2. **At HEAD the `forks` record itself was addressed by OLD.** The pass's
   own linkage test caught it at Gate 4; the working-tree fix is correct.
   (Finding 2, HIGH at HEAD, closed pending commit.)
3. **Even with every address sealed, "device D forked at t" is still a
   certain, synchronous, DURABLE event**: `PUT /state/forks` has exactly
   one writer, it is awaited on the action path, and the envelope
   counter that authenticates it is the client's wall clock, stored per
   (device, namespace) in a table nothing prunes. NEW's fork-continuity
   claim — labelled by kind — lands inside a bounded window after it.
   (Finding 3, MED.)
4. **Re-issuance mid-epoch silences the root's not-yet-proved personas
   for the rest of the epoch**: the device abandons the old branch at
   once while the new leaf is not yet in the tree, so a persona-level gap
   is keyed to a root-level event whose millisecond timestamps the
   operator stores. (Finding 4, MED; magnitude a hypothesis.)
5. The nonce's "disclosure gate" is a query parameter, and a holder on
   another device has no delivery path at all. (Finding 5, LOW.)
6. Re-issuance rotates the leaf, not the account anchor, and the recovery
   scan it leans on is a sentence, not code. (Finding 6, INFO.)
7. Outside this lens: the proof does not bind OLD's root. (Finding 7,
   INFO.)

Findings 1 and 3 are the ones that matter for this lens: finding 1 alone
links every forked persona to its root by one query; finding 3 survives
the fix of finding 1. `research/attack-z2-1.md` (findings 2, 3, 4) reaches
the roster-address and wall-clock-counter observations from the metadata
lens; I found them independently from the fork path, and they should be
counted once.

---

## Findings

### 1. `syncRoster()` publishes every keystore persona id as a plaintext vault address, inside the fork's own signed write burst

**Claim.** The fork route seals the fork record (Gate 4) and then, as its
next statement, mirrors the keystore roster into the `identityRoster`
vault namespace — one record PER PERSONA, addressed by the persona id.
The vault seals values, not addresses (attack-1 finding 1; the pass's own
words in `lib/vault/vault.ts:58-67`). The keys of that namespace are the
device's forked personas, side by side, in one device-signed PUT, on the
identified channel, at fork time. `zk_fork_claims.persona_id` is the same
string. NEW → root is a join; every forked persona of a root is a sibling
of every other by construction.

**Code evidence.**
- `app/api/identity/fork/route.ts:166-167` — `persistNs("forks")`,
  `persistNs("grantsV3")`; then `:173-175` — `syncRoster()` (best-effort,
  but attempted on every fork).
- `lib/identity/roster.ts:23-28` — `for (const p of roster) doc[p.id] = p;
  await flushVault(NS, encryptNamespace(NS, doc, vaultKeyBytes()))`.
- `lib/vault/vault.ts:88-98` — `out[id] = encryptRecord(key, ns, id,
  record)`: the loop's output key is the plaintext id.
- `lib/crypto/vaultCipher.ts:39-46` — the stored object is `{ v, ns, id,
  nonce, ct }`: the id is ALSO repeated inside the value, in the clear
  (it is the AAD).
- `lib/adapters/mock/persist.ts:240-262` — `flushVault` → `PUT
  /state/identityRoster`, signed with `x-layers-device / counter / sig`
  under `LAYERS_REQUIRE_SIG` (the harness sets it: scratchpad
  `z2-run.sh:11`).
- `validator/server.js:314-344` — `INSERT INTO adapter_state (namespace,
  key, value, updated_at)` with `key` = the id.
- Which personas are in the keystore: `lib/identity/keystore.ts:295-313`
  mints them; the only product caller of `adapters.identity.createPersona`
  is the fork route (`route.ts:102-112` → `lib/adapters/mock/identity.ts:
  64-76`); `adoptSeededPersona` (`keystore.ts:339-353`) has no caller, so
  the seeded viewer personas are NOT in the keystore; the signer flow
  creates personas on the validator, not in the keystore
  (`app/api/personas/route.ts:25-27`). Hence, in this codebase, the key
  set of `identityRoster` is exactly the set of forked personas of this
  device — the personas the feature exists to protect.
- `lib/zk/gate.ts:134-141` and `validator/zk.js:540-545` — the
  fork-continuity claim is requested for `created.id` and recorded as
  `zk_fork_claims.persona_id`: the same string as the roster key.

**Evidence from the database** (read at `1788584780516`, mid-suite):

```
adapter_state  identityRoster  key = p_0183d56cf8b5c73ff9e1f872b9b77a87   updated_at 1788584776551   (value: {v,ns,id,nonce,ct}, id = the key)
adapter_state  forks           key = _                                    updated_at 1788584776540   (the Gate 4 opaque form)
adapter_state  grantsV3        six keys g_…                               updated_at 1788584776527
envelope_counters  dev_6b1e36af47a84f30  grantsV3 1788584776520 | forks 1788584776535 | identityRoster 1788584776547
```

Three signed writes, 27 ms apart, one of them keyed by the forked
persona's id. (A read ten seconds later found the namespace emptied by
the running suite's reset; the fork claims in `zk_fork_claims` at that
moment — `p_616b0d5a…` and `persona_viewer_main`, epoch 82805 — were from
an earlier cycle, so the row-level join could not be reproduced inside
one snapshot. The join is code-level: the roster key and the claim's
`persona_id` are the same `created.id`.)

**Why the suites did not see it.** `scripts/accept-z9.mjs:259,267` —
`operatorView()` reads only `zkProofBudget / zkRootAnchor / zkQueue` and
`forks` out of `adapter_state`; check 6 (`:377-389`) therefore cannot see
`identityRoster` at all. `scripts/accept-z8.mjs:233-235` — check 6 greps
the whole `/state` dump for the nonce and for `source … NEW` within 200
characters; a sealed record's `ct` is longer than that, so two adjacent
plaintext keys never match the regex.

**Attack narrative.** `SELECT key FROM adapter_state WHERE namespace =
'identityRoster'` → the device's forked persona ids. Join
`envelope_counters(device_id, namespace='identityRoster')` → the device →
`devices.delegation` → the device-auth anchor → the root (single-tenant:
one anchor). `SELECT persona_id FROM zk_fork_claims` confirms each is a
fork. No timing, no relay assumption, no nullifier analysis. With the
`forks` record sealed (finding 2) OLD is no longer an address — unless OLD
is itself a fork (a fork of a fork), in which case both ends are keys;
otherwise OLD ↔ NEW needs finding 3's event join or the presence log.

**Severity:** HIGH — persona → root for every forked persona, offline,
one query; sibling linkage among a root's forks. **Confidence:** HIGH
(code and rows).
**Fix.** Store `identityRoster` as ONE opaque padded record, exactly the
pattern already used by `rootRoster` (`lib/identity/rootRoster.ts:88-94`)
and by `zkQueue`/`forks` (`store.ts:423-426, 649-654`); `recoverIdentity`
(`roster.ts:39-58`) unwraps `_`. And extend `operatorView()` in
`accept-z9.mjs` to EVERY `adapter_state` namespace, asserting that no key
and no embedded `id` matches a persona-id pattern — the regression guard
that would have caught this. If not fixed, the honest line is a new
assumption: *A-Z3-ROSTER-ADDRESS — the recovery roster is addressed by
persona id; a device that forks publishes its forked persona set to the
operator in one signed write.*
**Already admitted?** NO. `notes/reports/REPORT-Z1.md:404` closes attack-1 #1 with "the
one remaining zk vault namespace (the queue) is ONE opaque sealed record"
— `identityRoster` is not a zk namespace, so it fell outside that frame.
The new posture paragraph (`SECURITY-POSTURE.md:497-503`) says the lesson
was "learned twice"; the same route's next statement teaches it a third
time. `attack-z2-1.md` finding 3 reaches the same table from the metadata
lens.

---

### 2. At HEAD the fork record was addressed by the OLD persona — caught by the pass at Gate 4, fixed in the working tree, not yet committed

**Claim.** At `4c09552` the `forks` map is keyed by `fromPersona` and
dumped with `mapDump`, so `adapter_state(namespace='forks').key` was the
OLD persona id in plaintext, device-signed, written at fork time —
"persona X forked at t" beside a fork-continuity claim for NEW arriving
at t + jitter. That is the exact pairing the commitment exists to deny.

**Code evidence.**
- HEAD `lib/adapters/mock/store.ts:419` — `forks: { dump: (s) =>
  mapDump(s.forks) … }`; `:358` — `mapDump = Object.fromEntries`;
  `route.ts:156` — `state().forks.set(fromPersona, …)`.
- Working tree `store.ts:423-426` — `opaqueDump(Object.fromEntries(
  s.forks))`, one record `_` padded to 1 KiB steps (`:649-654`).
- DB: `forks` key `_` at `1788584776540` — the running app carries the
  fix.
- The guard that caught it: `accept-z9.mjs:388` — `row.value.includes(ALT)`.
  Note WHY it fires: `encryptRecord` echoes the id into the value
  (`vaultCipher.ts:46`); `row.key` is never inspected. A serializer that
  stopped echoing the id would slip past the guard.

**Severity:** HIGH at HEAD; CLOSED in the working tree. **Confidence:**
HIGH.
**Residual.** Land the fix in the commit; make the guard assert on
`row.key` as well as `row.value`. Product note, not a leak: because the
map is keyed by `fromPersona`, forking the same persona twice overwrites
the first record and its nonce (`route.ts:156-165`).
**Already admitted?** YES — `SECURITY-POSTURE.md:497-503` (working tree).

---

### 3. "Device D forked at t" is still emitted three ways, synchronously and durably — and the fork-continuity claim is labelled by kind

**Claim.** Sealing the addresses removed the persona from the fork-time
write; it did not remove the write. The `forks` namespace has one writer,
the write is awaited on the action path, and the envelope counter that
authenticates it is a client wall clock persisted in a table no reset
touches. The claim that follows is labelled `fork-continuity` and names
NEW. The join is by time and count, and the bound on NEW's candidate set
is the number of concurrent forks — not the tier cohort, not the floor.

**Code evidence.**
- One writer: `route.ts:166` is the only `persistNs("forks")` in the
  tree (the other references read the map: `route.ts:44`,
  `lib/feed.ts:924`). A `PUT /state/forks` IS a fork.
- On the action path: `route.ts:156-178` — `persistNs("forks")`,
  `persistNs("grantsV3")`, `syncRoster()` are all awaited before the
  response. Offset 0 from the user's action — the A-PREPARE-BURST shape
  (`SECURITY-POSTURE.md:197-204`) that Pass 2 Gate 0 retired for tier
  proofs (`lib/zk/prefetch.ts` header) and did not retire here.
- Three clocks: `adapter_state.updated_at` (`server.js:328-336`; the
  namespace is rewritten whole, so its rows share the fork's timestamp);
  `envelope_counters.counter` = `Date.now()` on the client
  (`persist.ts:137-144`), upserted per (device, namespace)
  (`server.js:277-286`); and the request itself.
- Durable: `DELETE /state` deletes `adapter_state` only
  (`server.js:349-357`); `/zk/dev/reset` deletes `zk_*` only
  (`validator/zk.js:897-916`). Nothing prunes `envelope_counters`.
- The label: `zk_nullifiers.claim_kind = 'fork-continuity'`
  (`zk.js:526-532`) and `zk_fork_claims.persona_id` (`:540-545`).
- The window: `requestForkContinuity` marks wanted (`gate.ts:134-141`);
  the next tick proves (`prefetch.ts:112-129`: `ZK_PREFETCH_MS` ±25%,
  default 10 min, `config.ts:82`); `enqueueSubmission` draws `notBefore`
  from `[ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS]` = [30 s, 15 min]
  (`queue.ts:98-106`, `config.ts:58-59`). NEW's claim lands in
  (0, ~27.5 min] after the burst.
- Amplifier (INFO): a forked persona is the only kind that emits TWO
  proofs in its first epoch — the fork claim, then, once the tick has
  consumed the wanted entry (`gate.ts:163-164`), the home render marks it
  for tier-membership (`gate.ts:119-128`, `home/page.tsx:77-80`);
  `hasSubmissionFor` is per kind (`queue.ts:124-136`) and the budget
  counts two predicates (`budget.ts:27-29, 58-71`; `ZK_PROOF_BUDGET` = 2,
  `config.ts:38`). It adds no linkage beyond the claim row; it does
  exhaust NEW's budget for the epoch.

**Evidence from the database** (`1788584780516`): 32 devices carry a
(`grantsV3`, `forks`, `identityRoster`) counter triple within ~15 ms —
e.g. `dev_6b1e36af47a84f30`: `…776520 / …776535 / …776547`. Two
`fork-continuity` nullifiers at epoch 82805, both named in
`zk_fork_claims`.

**Attack narrative.** For each fork-continuity arrival at t, list the
devices whose `forks` counter (or `updated_at`) moved in [t − 27.5 min,
t]. With one fork in the window: NEW ↔ device ↔ root. OLD is then one of
that root's personas — the roster keys (finding 1), or the presence log.
With F concurrent forks, NEW's candidate set is F devices; the floor of
50 is not the bound, and no cohort is consulted.

**Severity:** MED — narrowing to the concurrent-fork count; HIGH in a
small deployment. **Confidence:** HIGH on the mechanism; the join is
arithmetic.
**Fix.** (a) Flush nothing on the fork path: mark the record in memory
and let the next scheduled tick, or the queue's own random-delay persist
(`queue.ts:188-198` pattern), carry `forks`/`grantsV3`/`identityRoster`.
(b) Make the envelope counter a per-namespace monotonic integer, not
`Date.now()`, so a durable table never holds wall-clock. (c) Failing
both, state it: *A-Z3-FORK-EVENT — the fork's identified writes are on
the action path; the operator learns that a device forked and when, and
pairs that with the fork-continuity claim by time.*
**Already admitted?** PARTIALLY. The new paragraph (`:497-503`) says the
record no longer says "this persona forked at t" — true — and "this
device forked at t" is still said, three times. A-Z3-FORK-COMMIT-SET
(`:534`) speaks only to the commitment's preimage. `attack-z2-1.md`
findings 2 and 4 reach the counter and the residue independently.

---

### 4. Re-issuance mid-epoch: the device abandons the old branch before the new leaf exists, so the root's not-yet-proved personas go dark for the rest of the epoch — a persona-level gap keyed to a root-level, millisecond-stamped event

**Claim.** `reissueIdentity` revokes, bumps the index and registers in one
call at time T inside epoch E. The old commitment stays a valid leaf of
E's frozen tree until E+1, and the new one becomes a leaf only at E+1 —
but the device switches to the new branch immediately and never proves
with the old one again. So every persona of that root whose proof for E
had not yet been made at T is refused at the membership stage for the
rest of E and reappears at E+1. The operator holds T to the millisecond,
at root level, and the presence log per persona. That pairs personas to
the root through their silence.

**Code evidence.**
- `lib/zk/registration.ts:104-111` — revoke → `reissueZkIdentity()` →
  register, in sequence, now.
- `validator/zk.js:445-447` — `revoked_from_epoch = E+1`; `:413-418` —
  the new commitment `active_from_epoch = E+1`; `:259-266, 279-304` —
  the E tree (frozen, reconstructed from signed placements) contains the
  old leaf and not the new one.
- `lib/zk/identity.ts:45-50` — the index bumps and the cache drops at
  once; `:41-44` — "the old branch is never proved with again";
  `keystore.ts:228-230` — `zkMasterBytes()` defaults to the current index.
- `lib/zk/prove.ts:129-132` — `members.members.includes(zkCommitment())`
  is false for the new commitment for the rest of E → `membership`
  refusal. `gate.ts:163-165, 171, 179-181` — the wanted mark is consumed
  before the attempt; a refusal records `ok:false` and queues nothing;
  the persona proves only when re-marked in E+1.
- `app/(main)/home/page.tsx:65-80` — only the ACTIVE persona is marked
  wanted per render, so a root's other personas prove only when the user
  switches to them: the "not yet proved at T" set is real.
- Root-level clocks: `zk_registrations.registered_at / revoked_at` are
  milliseconds (`migrations.js:99-108`; `zk.js:417, 446`).
- `SECURITY-POSTURE.md:230` A-PRESENCE-LOG — "a row exists iff that
  persona proved in that epoch".
- Not exercised: `accept-z9.mjs:163-170` enqueues MAIN/ALT's proofs, then
  `:236` re-issues, then `:241` advances the epoch; the working-tree edit
  puts NEW's tier proof in round 3, after the advance. Check 7
  (`:400-413`) asserts rows exist for epochs > revokeEpoch and that
  nullifiers do not repeat (`:405-408`); it never asks whether a persona
  of the re-issued root is MISSING from the revocation epoch.

**Evidence from the database** (`1788584780516`): root
`root_f2ff6cb2ba08e465`, fixture — old commitment `registered_at
1788584686129`, `revoked_at 1788584691576`, `revoked_from_epoch 82806`;
new commitment `registered_at 1788584693840`, `active_from_epoch 82807`.
Two rows, one root, 2.3 s apart, to the millisecond.

**Attack narrative.** From `zk_registrations`, (R, T, E). From the
operator's own snapshots of `zk_eligibility` (it prunes to the grace, but
the operator reads its table whenever it likes — A-ELIGIBILITY-VISIBLE),
the personas with rows at E−1 and E+1 and none at E are candidates for
R's late personas, and each such gap coincides with T. A root that
re-issues more than once (the feature exists to be used after a
compromise) intersects its candidate sets. The old leaf was valid the
whole time; the gap is a design choice.

**Severity:** MED — narrowing; the magnitude (how many personas are
dormant in a given epoch anyway) is a HYPOTHESIS, the mechanism is not.
**Confidence:** HIGH on the mechanism.
**Fix.** Defer the branch switch to the epoch boundary: keep proving under
the old commitment until `revoked_from_epoch` (it is a leaf the validator
accepts; `zk.js:513-520`), then switch — the revocation is already
effective only from E+1, so nothing is lost. Or state it in
A-Z3-REISSUE-JOIN, which currently claims "at the PERSONA level nothing
pairs the personas that proved under the old commitment with those
proving under the new one except what the epoch already gave"
(`:553-560`).
**Already admitted?** NO. A-Z3-REVOKE-EPOCH-GRACE (`:539`) is about the
compromised secret's usability, not the honest device's silence;
A-Z3-REISSUE-JOIN denies a persona-level pairing.

---

### 5. The nonce's "disclosure gate" is a caller-supplied query parameter, and a holder on another device has no delivery path at all

**Claim.** The forward-pointer resolution — the ONLY path by which the
nonce leaves the device in the clear — decides who is asking from a
query string. The posture's "hands it ONLY to carried grant holders
through the disclosure-gated forward pointer" (`SECURITY-POSTURE.md:481`)
describes the demo's single process; the cross-device holder is not
designed.

**Code evidence.**
- `app/api/identity/fork/route.ts:33-37` — `viewer` is `viewerPersonaId`
  when supplied (`idOf` accepts a handle); `:40-59` — returns `moved` and
  `continuity: { forkCommit, forkNonce, personaId }` when
  `resolveForwardPointer(old, viewer, forwardIds)` names that viewer.
- `lib/identity/fork.ts:104-119` — the check is `g.audienceMember ===
  viewer`: who the caller CLAIMS to be, not who is calling.
- `SECURITY-POSTURE.md:281` A-DEV-SURFACE — the app has no authentication
  of its own; `:360-368` §8 — the app is the user's own process.
- `validator/zk.js:755-764` — the confirmation read is public and needs
  only the commitment.
- Clean elsewhere: the POST response omits the nonce (`route.ts:180-190`;
  `accept-z8.mjs:104`); the route logs nothing; the value is sealed
  (`vault.ts:94-95`, `vaultCipher.ts:39-46`); `zk.js`/`anon.js` log
  nothing.

**Attack narrative.** Whoever can reach the app — in the hosted topology,
the operator; in the device topology, only the user — asks
`GET /api/identity/fork?resolve=<OLD handle>&viewerPersonaId=<any carried
holder's handle>` and receives NEW and the nonce; opens the commitment;
confirms at `/zk/fork-claim`. The stronger point is the converse: a real
carried holder on ANOTHER device has no route to this endpoint, so when
delivery is built it must transit the validator or a relay, and §11 does
not say how the nonce will be sealed to the holder on the way.

**Severity:** LOW — subsumed by A-TOPOLOGY / A-DEV-SURFACE in the hosted
case and unreachable in the device case; the finding is claim-scope.
**Confidence:** HIGH.
**Fix / honest statement.** Say in §11 that the forward pointer's nonce is
disclosed by the app to whoever names a holder, that the app's access
control is the device's, and that cross-device holder delivery is
unbuilt (its design is the place the nonce would next transit the
operator).
**Already admitted?** PARTIALLY (A-DEV-SURFACE, A-TOPOLOGY); the
cross-device gap is not named.

---

### 6. Re-issuance rotates the leaf, not the account anchor; the recovery scan it leans on is not implemented (INFO)

- `validator/zk.js:443-447` — append-only; both rows keep `root_id`
  forever (the pair in finding 4). `C_root ↔ account` now has two
  members per re-issuance, never fewer. A-ROOT-ANCHOR
  (`SECURITY-POSTURE.md:142-144`) and "F9 had no rotation story" (`:504`)
  should say: the story rotates the LEAF against a leaked master or
  scalar (the prover child receives the master, `lib/zk/transport/
  live.ts:108`); it does not touch the account binding.
- `lib/crypto/kdf.ts:81-84` — every branch is HKDF off the same seed. A
  seed or escrow compromise (A-ESCROW-BLAST-RADIUS, `:290`) now
  deanonymizes every branch's nullifier history; re-issuance adds no
  forward secrecy against it.
- `lib/zk/identity.ts:53-55` `zkCommitmentAt` has no caller.
  A-Z3-INDEX-FILE (`:548-552`) promises "the recovery scan (bounded to
  1024 indices) is the way back"; a recovered device derives index 0,
  registers the revoked commitment and receives 409 (`zk.js:402-403`).
  Availability, not linkage — but the assumption line cites code that
  does not exist.

**Severity:** INFO (claim scope). **Already admitted?** PARTIALLY.

---

### 7. Outside this lens: the fork proof does not bind OLD's root (INFO)

`lib/zk/prove.ts:161-163` / `validator/zk.js:187-189` — the message binds
`fork:<hex>`, a string the prover chose. The proof establishes that NEW's
root is in tier-T and that this prover bound this commitment. OLD-side
truth rests on the forward pointer signed AS OLD (`lib/identity/fork.ts:
57-64, 74-94`), not on the circuit. `SECURITY-POSTURE.md:492` — "the
account behind the persona I trusted is, provably, the account behind
this new one" — overstates: it is provably a tier-T account that bound
this commitment, vouched for by OLD's persona signature. Reviewer 3's
territory; one line so it is not lost.

---

## Attacks that failed

- **Recovering OLD from the commitment.** `route.ts:145-147` —
  `sha256("layers-fork-commit/1|old|new|nonce")` with `randomBytes(16)`
  from `node:crypto`: 128 bits of CSPRNG, domain-separated. Candidate
  pairs cannot be tested. The validator re-derives the message from the
  commitment it is handed (`zk.js:187-189, 483-491`) and never holds a
  preimage; a tampered commitment is refused (`accept-z8.mjs:130-150`).
- **The nonce on the wire or in a log.** Not in the fork POST response
  (`route.ts:180-190`; `accept-z8.mjs:104`); only inside the AES-GCM
  sealed value (`vault.ts:94-95`, `vaultCipher.ts:39-46`); no `console`
  in the fork route; `validator/zk.js` and `validator/anon.js` log
  nothing (`zk.js:23-24`, `anon.js:23-26`). The only clear-text exit is
  finding 5's resolution response.
- **Nullifier equality across OLD, NEW-fork and NEW-tier.** The
  `fork-continuity` feature string differs from `discovery-tier`, and
  the personaId is in every per-persona scope (`lib/zk/scopes.ts:87-105,
  135-148`; `zk.js:154-176`). NEW's fork nullifier ≠ NEW's tier
  nullifier ≠ OLD's; `accept-z9.mjs:275-288` asserts it across all
  kinds. The linkage argument in `scopes.ts:91-104` is correct for the
  stock preimage.
- **Arrival order of fork claims at rest.** `zk_fork_claims` is `WITHOUT
  ROWID`, keyed `(mode, persona_id, fork_commit)`, no timestamp
  (`migrations.js:331-340`). The operator learns order only from the
  identified side (finding 3).
- **OLD going dark at the fork.** The wizard does not switch the active
  persona (`components/settings/ForkWizard.tsx:84-100` only `setDone`),
  and the home render marks only the active persona
  (`home/page.tsx:65-80`), so OLD keeps proving while the user keeps
  using it; no forced presence gap. (A user who stops using OLD creates
  one — A-PRESENCE-LOG, admitted.)
- **NEW's first cast against OLD's last.** HYPOTHESIS only: the fixture
  writer never casts as NEW (working-tree comment at
  `accept-z9.mjs:168-170`), so it is untested here; it is C5 plus
  A-PRESENCE-LOG territory, not the fork proof's.
- **Re-issuance at the nullifier layer.** A new secret gives fresh
  nullifiers; none repeats (`accept-z9.mjs:405-408`); registration is
  batched to E+1 (`zk.js:413-418`); the old leaf stays in the frozen E
  tree, so cohort continuity does not flinch at E+1 (one removal of 61,
  `lib/zk/cohort.ts:78-92`).
- **A stale secret after re-issuance.** `identity.ts:48` drops the cache;
  `keystore.ts:228-230` derives the current index by default; the live
  worker receives the current master (`live.ts:108`) and the fixture
  nullifier uses the current scalar (`fixture.ts:55`). Queue items
  proved under the old commitment before T drain after T and are accepted
  within the grace (`queue.ts:203-226`; `zk.js:513-520`) — exactly
  A-Z3-REVOKE-EPOCH-GRACE, and they single out nothing: the E tree has
  the whole cohort.
- **Registering the new commitment under another root, or the old one
  again.** `zk.js:399-412` — commitment-first lookup, then the partial
  unique index (`migrations.js:359-361`); a revoked commitment answers
  409 with its revocation epoch.
- **`GET /zk/fork-claim` as an oracle.** Returns `{verified, tree, tier,
  epoch}` and requires the commitment (`zk.js:755-764`); the OLD persona
  never appears (`accept-z8.mjs:243-244`).
- **Other fork-time addresses.** `grantsV3` ids are `g_ + sha256(
  canonical)[:24]` (`lib/identity/grants.ts:97-99`) — the COUNT written
  (2 × carried holders; six rows in the snapshot) is visible, the persona
  is not. `rootRoster` is one opaque record (`rootRoster.ts:88-94`).
  `zkQueue` is one opaque record (`store.ts:636-646`). Only
  `identityRoster` (finding 1) and, at HEAD, `forks` (finding 2) carry a
  persona id as an address.

---

## Verdict

The fork-continuity proof and the epoch re-issuance are, at the proof
layer, what §11 says they are: the commitment hides OLD from the
verifier, the nullifiers do not collide across kinds or personas, and the
new commitment's proofs are unrelated to the old one's. What the pass
did not close is the same class of thing Pass 1's first review found:
the client tells the operator the relation itself, on the identified
channel, in addresses and timestamps, at the moment of the action. The
fork route seals its record and then publishes every forked persona of
the device as a plaintext vault address in the next statement (finding
1), which alone links every forked persona to its root by one query; and
even with every address sealed, "this device forked at t" remains a
synchronous, durable, wall-clock-stamped event paired to a claim the
validator labels by kind (finding 3). The re-issuance adds a quieter
version of the same shape — a persona-level gap keyed to a root-level
timestamp (finding 4). Findings 1 and 4 are code-and-row grounded and
not admitted anywhere; finding 3 is half-admitted by the working-tree
paragraph. Gate 4 should not close with finding 1 open: it is the fork
feature's own privacy claim, falsified by the fork route.
