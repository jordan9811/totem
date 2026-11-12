# attack-fid-2 — the VALIDATOR OPERATOR's view of the Multi-FID pass (persona fids, fork → new fid, anon-post relay)

Reviewer: fresh context, read-only. Tree reviewed: working tree on `2995279` (Gate 3 green) plus the
uncommitted Gate 4 changes (`validator/zk.js`, `validator/migrations.js`, `lib/zk/*`, `app/api/anon`,
`scripts/accept-fid4.mjs`, `scripts/accept-fid5.mjs`, `scripts/live-fid4.mjs`). No servers started, no
scripts run; every claim below is a file:line the reader can open.

Threat model taken as given: I am the operator (or hold its database and request log). I see every row
of `validator/layers.db`, every request with its arrival time and source IP (the anon channel strips
headers, not the socket), the plaintext of every non-vault `adapter_state` namespace, the sealed
namespaces as ciphertext with hour-grained `updated_at`, and the public network (Farcaster hubs).

Severity legend: HIGH = links a persona to its root/sibling or an anon cast to a device with the
operator's data alone, or breaks a safety-set rule; MED = a real weakening that needs a stated
assumption or a small fix; LOW = residual worth a line; INFO = a doc/test gap.

---

## 1. HIGH — The plain `personaFidMap` namespace is ONE device-signed document listing every Farcaster account this root owns, and nothing in the product reads it

**WHAT.** D-FID-1-PLAIN-MAP puts `{ personaId → fid, fname }` for every fid-bearing persona into a
PLAIN namespace. The vault "seals values, not addresses" lesson was applied to the record
(`personaFids`) but the map is the address book itself: one namespace document, rewritten whole on
every save, under one device envelope. From the DB alone the operator reads the SET of public
Farcaster accounts belonging to one human — the exact linkage Gate 5's prompt says must fail
("link two persona FIDs to one root"). No timing, no proof, no correlation: `SELECT key, value FROM
adapter_state WHERE namespace = 'personaFidMap'`.

The justification ("a public persona's own public account is not a secret") is true of each pair
persona↔fid and false of the grouping. Each cast on the network is publicly fid F, and our client
publicly labels it persona P — so P↔F is public. What is NOT public anywhere else is
{F1, F2, F3, …} = one root. The plain map is that set.

**And it has no reader.** `personaFidMap()` and every product path (`transportFor`,
`assertOwnFidIdentity`, attribution, the fork's `movedFid`) read the in-process SEALED doc through
`load()`; the only consumers of the validator's plain copy are the test suites.

**EVIDENCE.**
- `lib/fc/personaFid.ts:76-79` — `// the PLAIN map: what the validator (and attribution rendering) learns — personaId → fid, fname` … `for (const r of doc.items) map[r.personaId] = { fid: r.fid, fname: r.fname }; await flush(MAP_NS, map);`
- `lib/fc/personaFid.ts:131-134` — `personaFidMap()` iterates `(await load()).items` — the sealed record, not the validator's plain namespace.
- Readers of `personaFidMap`/`MAP_NS` outside `personaFid.ts` (grep over `lib app components validator scripts`): `app/api/fc/persona/route.ts:34` (calls the in-process function), `scripts/accept-fid1.mjs:232`, `scripts/accept-fid3.mjs:115,125`, `scripts/accept-fid5.mjs:147,230,243`. No product read of `/state/personaFidMap` exists.
- `validator/server.js:380-410` — `PUT /state/:namespace` does `DELETE FROM adapter_state WHERE namespace = ?` then inserts every key with one `now = hourGrain(Date.now())`: the document is atomic and whole; `:348-351` records `envelope_counters(device_id, 'personaFidMap', counter)` — the device that owns the set; `lib/adapters/mock/persist.ts:232-236` puts `x-layers-device` on the PUT.
- `lib/vault/vault.ts:73-77` — `personaFids` is sealed; `personaFidMap` deliberately is not.
- `scripts/accept-fid5.mjs:228-233` (linkage v4 #3) — `for (const id of ownIds()) { if (!plain[id]) throw new Error("plain map lacks " + id); …}` — the linkage test REQUIRES the operator-visible map to contain every one of the device's personas. The suite enshrines the grouping it should be hunting.
- `SECURITY-POSTURE.md` §12 A-Z2-PLAINTEXT-MOCK-ADDRESSES — "while the mock adapter is the adapter, the device's persona set is readable from `adapter_state` keys" — scoped to demo furniture a production adapter replaces. The map is not furniture: it is a designed product namespace (REPORT-FID D-FID-1-PLAIN-MAP) whose VALUES are public network identities.

What the row metadata adds (Q1): `updated_at` is the hour of the LAST save for every row (the whole
namespace is rewritten), so it does not order the rows; the fixture fid `9,000,000 + n`
(`personaFid.ts:47,96-101`) does — the map is the root's persona creation order. The envelope counter
for `personaFidMap` advances twice per acquisition (`nextFixtureFid()` saves at `:96-101` before
`recordPersonaFid()` saves at `:104-110`), so `counter delta / 2` is a count of acquisitions — a
count oracle even after the map is gone.

**ATTACK.** Steal `layers.db` → `adapter_state` rows for `personaFidMap` → the fids → warpcast.com
profiles → every public persona of this user, named together. On live this is the total loss of the
pass's purpose with zero analysis. It survives the vault (it is not in it), survives migration 008
(hour grain does not matter), and survives A-PRESENCE-LOG (no proof needed).

**FIX.** Delete the plain namespace: remove `flush(MAP_NS, …)` from `save()`, remove `MAP_NS` from
`ExtraNamespace`, and change `accept-fid1`, `accept-fid3 #3`, `accept-fid5 #3` from "the map holds
only fid+fname" to "there is no plaintext namespace whose keys are persona ids and whose values are
fids". If a validator-side persona→fid ever becomes necessary for a reader that is not this device,
it must be per-cast (the attribution index already carries the persona; the fid is on the network
cast) — never a set. Until then this is NEW linkage introduced by this pass, not covered by any
existing assumption; if it is kept it needs an assumption id (proposed **A-FID-MAP-IS-THE-ROSTER**:
"the validator holds the root's fid set in plaintext; a stolen database names all of a user's public
accounts together").

---

## 2. HIGH — On live, the network timestamp of a relayed anon cast IS the submission time; the OHTTP relay (or any observer of the client's connection) links client IP → cast with public data only. The hour-grained row is moot.

**WHAT.** The validator relays the text to Neynar inside the request that carried the proof
(`fetch("https://api.neynar.com/v2/farcaster/cast")` before it answers). The cast's timestamp on
every hub is public to the second and equals the moment the submission arrived. So:
- the OHTTP relay, which sees `(client IP, time)` for every forwarded request, needs nothing from the
  gateway to join IP → cast: it reads the hubs. A-RELAY-PASSIVE-JOIN assumes the relay must get the
  gateway's plaintext to join; here the plaintext is the public network.
- any on-path observer of the client's TLS connection to the relay (ISP, VPN exit, the relay's host)
  gets the same join.
- the operator with the request log gets `(arrival time) = (cast time)` too, and on the direct relay
  the IP with it (documented as DEMO — but the point is the public event, not the IP).
- D-FID-4-COARSE-TIME ("the relayed cast's public time is hour-grained … so the row's timestamp does
  not resolve the jittered submission moment") is only true of the fixture, where "the row is the
  network". On live the network resolves it to the second.

The jitter decorrelates the submission from the COMPOSER action. It does nothing about the
submission ↔ PUBLICATION join, because publication happens synchronously inside the submission.

Two smaller wire markers ride along: (a) the anon response is held to a 150 ms FLOOR, not a constant,
and the live Neynar round trip is longer, so an anon-post submission is the slow one on the wire
(distinguishable from tier claims by latency at the relay); (b) a slow relay past the client's 30 s
`isolatedRequest` timeout is a `transport-error`, retried 1–30 s later (`queue.ts:284-287`), a second
constant-size request from the same source that the validator answers `replay` — a two-request
signature only anon posts produce.

**EVIDENCE.**
- `validator/zk.js:635-652` — the live branch: `res = await fetch("https://api.neynar.com/v2/farcaster/cast", …)` inside `verifyAndRecord`, before the row and before the response.
- `validator/zk.js:670` — `Math.floor(Date.now() / 3_600_000) * 3_600_000` on `relayed_at`: the hour grain, on the row only.
- `validator/anon.js:34,174` — `responseMs()` default 150; `await sleepUntil(t0 + responseMs())` — a floor.
- `lib/zk/anon/relay.ts:70-72` — the OHTTP path posts through `isolatedRequest(relayUrl, …)`: the relay sees the client socket.
- `lib/zk/anon/client.ts:46` — `timeout: opts.timeoutMs ?? 30_000`; `lib/zk/anon/queue.ts:284-287` — `if (r.outcome === "transport-error" && attempts < 3) … q.notBefore = now + uniformInt(1_000, 30_000)`.
- `SECURITY-POSTURE.md` §3 A-RELAY-PASSIVE-JOIN — "no collusion is needed for a relay's ordinary access log to join its `(client IP, time)` to the gateway's plaintext by time" — the gateway's plaintext is no longer required.
- REPORT-FID D-FID-4-COARSE-TIME (line 340) and D-FID-4-RELAY-RECORDS-NOTHING-IDENTIFYING (line 339, "On live the network write happens BEFORE the nullifier is consumed").

**ATTACK (relay operator, no collusion).** Log `(ip, t)` for every forwarded `/zk/anon/ohttp`.
Fetch the anon account's casts from any hub; for each cast at time `c`, the forwarded request with
`t ≈ c − relay latency` is its author's IP. With one anon post per root per window and a cast
timestamp at second precision, the join is exact.

**FIX.** Decouple relay from submission: the validator accepts and records the proof, then POSTS
the text at a time of ITS OWN choosing (a uniform draw inside a validator-side window, or a fixed
batch schedule, e.g. every N minutes all pending anon casts in random order). The nullifier is
consumed at acceptance (the current "relay-before-consume" ordering has to move: consume at
acceptance, relay later, and on relay failure record the failure and re-try — the user's window is
spent either way, which is the honest price of a store-and-forward relay). Then `relayed_at` at hour
grain means something, the response latency is constant, and the relay/observer join degrades to
the validator's own posting window. State the residual as **A-FID-ANON-PUBLICATION-TIME** ("the
public cast time is the validator's relay time; an observer of the submission channel joins it to
the client unless the validator delays/batches relays"). Until built, the label's condition 1 (relay)
is insufficient for anon posts even with an attested third-party relay.

---

## 3. HIGH — The proving tick makes an IDENTIFIED epoch fetch and a device-SIGNED `zkQueue` flush the moment a proof is queued; an anon submission follows from that device within the jitter window. The posture says the product never does this; the code does.

**WHAT.** `enqueueSubmission` runs `fetchEpoch(envelope.mode)` (identified GET) and
`persistNs("zkQueue")` (a device-signed PUT, the comment even says "identified") synchronously when
the tick has produced a proof. For tier claims this was tolerable: the presence log names the
persona anyway. For an anon post it is the ONLY identified event that says "this device just queued
a proof", and the ONLY anonymous event that follows is the anon submission, at
`T_tick + U[30 s, 15 min]`. The deferred `sent` persist (`schedulePersist`) then brackets it from the
other side. A-PREPARE-BURST (§3) claims the fixed-schedule prefetch retired this and that the
queued-item write is now only the dev `prove`/`enqueue` fallback "which suites use and the product
never does" — `runWantedProofs → enqueueSubmission` is the product path.

From the DB alone: `adapter_state.updated_at` for `zkQueue` is hour-grained, so it is "a device
flushed its queue in hour H" beside "an anon cast relayed in hour H" — the A-Z2-HOUR-GRAIN class,
trivially decisive in a low-traffic deployment. From the request log (the operator has it): a
signed PUT `/state/zkQueue` from device D at T, an anon submission at T + δ with δ inside the
window, and no other device flushing in that window → D. The jitter window is the whole defence,
and the prefetch cadence (10 min ± 25 %) is shorter than the window's top (15 min), so the set of
"devices that flushed zkQueue in the last window" is at most the active devices — see #10.

**EVIDENCE.**
- `lib/zk/anon/queue.ts:88-119` — `enqueueSubmission`: `:93 const e = await fetchEpoch(envelope.mode);` and `:114-117 // the QUEUED state is persisted at once … (This write is identified … A-PREPARE-BURST.) await persistNs("zkQueue");`
- `lib/zk/gate.ts:280-283` — `const item = await enqueueSubmission(out.envelope, …)` inside `runWantedProofs`, called from the tick at `lib/zk/prefetch.ts:135`.
- `lib/zk/anon/queue.ts:226-236` — `schedulePersist` defers the SENT mark on its own random delay — the asymmetry: the queued mark is not deferred.
- `lib/adapters/mock/persist.ts:226-237,257-268` — the PUT carries `x-layers-device / counter / sig`.
- `SECURITY-POSTURE.md:220-232` A-PREPARE-BURST — "this line now describes the dev `prove` / `enqueue` actions' fetch fallback, which suites use and the product never does."

**ATTACK.** Request log: `grep 'PUT /state/zkQueue'` with device id and time; for each anon
submission at `t`, the device whose zkQueue PUT landed in `[t − 15 min, t − 30 s]`. One device →
one root → `zk_registrations.root_id`.

**FIX.** (a) Persist the QUEUED state on its own random delay exactly like `sent` (a crash before
the deferred persist loses at most one queued item, which the next tick re-proves — cheaper than
the beacon), or persist it on the NEXT tick regardless of whether anything was queued (a uniform
write every tick carries no information); (b) drop `fetchEpoch` at enqueue — the tick's snapshot
already has the epoch shape (`snap.epoch.epochMs/msRemaining`); pass it in. (c) Correct
A-PREPARE-BURST: the queued-item write is on the product path today. Until fixed, state
**A-FID-ANON-ENQUEUE-BEACON** by id.

---

## 4. HIGH — A seeded persona's fid custody key and signer key derive from a PUBLIC constant, and the live acquisition path accepts seeded personas. Gate 2's plan creates real accounts whose owner key anyone can compute from the repo.

**WHAT.** Seeded personas (the fixture viewer MAIN included) have no keystore entry; every
derivation falls through to the fixture root, which is "derived off a public master constant …
anyone reading the repo can derive them". The Multi-FID pass extended that dispatch to the
Farcaster CUSTODY key and SIGNER key (`fcCustodyAddressFor`, `signCustodyTypedDataFor`,
`fcSignerPublicKeyFor`), and `recordLiveFid` admits any `isViewerPersona` — seeded ones included. The
prompt's Gate 2 says "Create FIDs for two seeded public personas"; REPORT-FID's own fid2 #8 dry-ran
the live command on MAIN. A live fid registered with `Transfer(to = fixture custody address)` is an
account whose custody private key is `fcCustodySeed(fixtureSeed(personaId), personaId)` — a
function of the repo. Anyone can transfer the fid, add signers through KeyGateway, and post as the
persona; the Neynar managed signer in the vault is irrelevant to ownership.

This is not the operator's angle, but it is the largest thing this pass could do wrong on the
network, and nothing refuses it.

**EVIDENCE.**
- `lib/identity/fixtureRoots.ts:9-16` — "a deterministic seed derived off a public master constant (`lib/crypto/kdf.ts fixtureSeed`) … These keys are public-by-construction: anyone reading the repo can derive them."
- `lib/identity/fixtureRoots.ts:61-66` — `fixtureSignCustodyTypedData`: `privateKeyToAccount("0x" + toHex(fcCustodySeed(fixtureSeed(personaId), personaId)))`; `:68-70` `fixtureFcCustodyAddress`; `:51-59` the fixture fc-signer.
- `lib/identity/keys.ts:48-49` — `fcCustodyAddressFor = fcCustodyAddress(personaId) ?? fixtureFcCustodyAddress(personaId)`; `:53-54` `signCustodyTypedDataFor` falls through to `fixtureSignCustodyTypedData`.
- `lib/fc/acquire.ts:123-136` — `recordLiveFid`: checks `isViewerPersona`, kind public, ≤ 2 live, and that the record's keys equal the DERIVED ones — which for a seeded persona are the fixture ones. No "keystore-rooted only" check.
- `lib/fc/custodySign.ts:60` — refuses only "not one of this device's personas — no custody key"; a seeded persona has one.
- `scripts/fid-acquire.mjs:111-114,138` — `signerProbe` (falls to fixture keys) then `custodySign` Transfer to that address.
- REPORT-FID Gate 1 iteration 1: "the seeded viewer persona's keys come off its FIXTURE root … not the keystore"; `notes/prompts/multi-fid-prompt.md:120` "Create FIDs for two seeded public personas"; REPORT-FID line 259 (fid2 #8 on MAIN).

**ATTACK.** Read `lib/crypto/kdf.ts` + `fixtureRoots.ts`, compute MAIN's custody key, watch the
IdRegistry for a `Transfer` to that address, then `transfer` the fid to yourself (or add your own
signer via KeyGateway) — the account is yours, permanently, with the persona's fname.

**FIX.** `recordLiveFid` and `custodySign` (live) must refuse any persona whose keys come from the
fixture dispatch (`getPersona(personaId) === undefined` → refuse on live); `fid-acquire.mjs` must
refuse a seeded persona id before any billable call; Gate 2's "two seeded public personas" must be
two KEYSTORE personas (mint them). Add the assertion to fid1/fid2: "a live record for a persona
without a keystore entry is refused". If a live account has already been created for a seeded
persona, treat its custody as compromised: transfer it to a keystore-derived address now.

---

## 5. MED — Anon posting has no anonymity set in the shipped topology: the anon account is the user's own throwaway by default, and the validator is single-tenant. State it by id.

**WHAT.** The anoncast pattern works because ONE relay account posts for MANY people. Here:
- `anonRelayAccount()` falls back from `FC_ANON_FID` to `FC_TEST_FID` — the same throwaway the
  app's private personas post through in shared-fid mode; `.env.example:42` says the anon signer IS
  "the throwaway's managed signer". So on the network the anon casts sit on an account whose other
  casts our client attributes (to granted viewers) to THIS user's private personas.
- the validator is single-tenant by construction: `PUT /state/:ns` replaces the whole namespace,
  `device_auth` has one row (`id = 1`), `zk_registrations` holds this root. A validator that serves one
  root relays for one human; the anon account's network-side anonymity set is 1.
- the tree floor (≥ 50 leaves) is met by the operator's own decoys; the crowd in fid5 #2 is forged
  through the plain door (notes/reports/RESUME.md:93). None of those leaves ever posts. Both the operator and any
  outside reader of the anon account know exactly who runs the validator whose account it is.

§8 says "in that topology nothing here is private" for the app-process-on-operator-host case; it
does not say the anon-post mode is anonymous only when the RELAY ACCOUNT is shared by many
validator tenants, which today it cannot be.

Secondary: if a `roots` row exists for the anon fid and the poller polls it (`fid < 1000000` is a
magnitude guard, not a role guard), anon casts' engagement accrues `rep_events` to that root —
"reputation accrues to no one" would be false in the very topology where that root is the user's.
Real fids today are > 1,000,000, so this is dormant.

**EVIDENCE.**
- `validator/zk.js:213-218` — `const fid = Number(process.env.FC_ANON_FID ?? process.env.FC_TEST_FID ?? "")`; `.env.example:41-43` — `# FC_ANON_FID= # defaults to FC_TEST_FID`, `# FC_ANON_SIGNER_UUID= # the throwaway's managed signer`.
- `lib/fc/writes.ts:55-59,312-314` — `throwawayCreds()` from `FC_TEST_FID`; the shared path for fid-less/private personas (REPORT-FID D-FID-1-WRITE-DOOR-OWN, D-FID-3-NO-FID-CASTS-SHARED).
- `validator/server.js:380-410` (namespace replace), `:226-246` (`device_auth … id = 1`, first-write-wins).
- `notes/prompts/multi-fid-prompt.md:171-172` — "the Pass-FC throwaway serves as fixture; a dedicated one is Call Option B".
- `validator/poller.js:10` — `SELECT id, fid FROM roots WHERE fid < 1000000`; `app/api/signer/route.ts:16` → `registerRoot(fid, signerUuid)`.

**FIX / ASSUMPTION.** Make Call Option B mandatory before any live anon relay: a dedicated anon fid
that is not any tenant's shared-fid account, with `FC_ANON_FID` REQUIRED on live (no fallback).
State **A-FID-ANON-ACCOUNT-SET**: "an anon cast's network-side anonymity set is the number of
roots whose validator relays through that account; with a self-hosted single-tenant validator it is
one, whatever the tree floor says. The anon-post guarantee holds only under a multi-tenant
validator, which the state store does not support today." The composer's label should carry it as a
tenth condition (relay account shared by ≥ floor roots — an operator attestation like condition 1).

---

## 6. MED — The "one anon post per WINDOW" rule is one per EPOCH: the onePerHuman scope string still contains the epoch, so the window qualifier changes nothing. D-FID-4-WINDOW's "the nullifier is constant across a window" is false for W > 1.

**WHAT.** Both `scopeString`s build the onePerHuman scope as `${SCOPE_DOMAIN}|anon-post/w<n>|<epoch>`.
For `ZK_ANON_POST_WINDOW_EPOCHS = 1` (the default, the only value the suites run) window = epoch and
the bug is invisible. For W = 4 a root's nullifier differs every epoch inside the window, so the
validator accepts four posts per window; only the client's courtesy check (`hasAnonPostInWindow`)
enforces the window, and REPORT-FID says the validator's refusal "is the rule, the client's a
courtesy" — the rule is not there. The unit test hard-codes the wrong shape
(`w${Math.floor(ep / 1)}|${ep}`), so it passes.

Also at W = 1: the one-epoch grace (`p.epoch === current − 1` accepted) lets a client that kept the
previous epoch's member list prove for E−1 during E and post twice in epoch E (an unused slot is
bankable for one epoch). Fine if stated; not "one per epoch" as written.

**EVIDENCE.**
- `validator/zk.js:231-234` — the anon branch sets `feature = anon-post/w<n>`; `:242` — `if (entry.onePerHuman) return `${SCOPE_DOMAIN}|${feature}|${epoch}`;`; `:274` — `anonPostWindowOf(p.epoch)` as the qualifier; `:208` — `"w" + Math.floor(epoch / anonPostWindowEpochs())`.
- `lib/zk/scopes.ts:182-185,189-193` — same construction on the client.
- `validator/zk.js:613-614` — the grace.
- `validator/test/zk.test.js:216` — `scope: fieldOf("scope", `layers/zk-scope/v1|anon-post/w${Math.floor(ep / 1)}|${ep}`)`.
- REPORT-FID D-FID-4-WINDOW (line 336) — "the nullifier is constant across a window and the validator's replay rule refuses the second post".

**FIX.** For `onePerHuman` entries the scope must be `${SCOPE_DOMAIN}|${feature}|${windowIndex}`
with NO epoch component (the window index IS the time component); keep the qualifier grammar. Then
the grace can only bank the PREVIOUS window's unused slot into the first epoch of the next window —
state that. Add a suite case at W = 2 (advance one epoch inside the window, force a second post,
expect `replay`).

---

## 7. MED — The cast hash is unsalted, the anon row is keyed on it, and `ON CONFLICT DO NOTHING` drops the second identical text after the nullifier is consumed and (on live) after the network post. The live cap counts distinct texts, not relays, and is read before an `await`.

**WHAT.** `castHash = sha256("layers-anon-cast/1|" + text)`; `zk_anon_casts` has `PRIMARY KEY (mode,
cast_hash)`. Two roots (or one root in two windows) posting the same text ("gm"): the second's proof
is verified, its nullifier is inserted, on live the cast is POSTED, and the row insert is silently
dropped. Consequences: (a) fixture — the second post vanishes and the poster's window is burned;
(b) live — the cast is on the network but never in our feed, and `relayed` (the cap counter,
`COUNT(*) FROM zk_anon_casts WHERE mode = 'live'`) does not grow: the same root can relay the same
text every window under `ZK_ANON_POST_LIVE_CAP = 1` forever; (c) griefing — whoever posts a common
phrase first (or the operator, who can insert rows) pre-empts it for everyone; (d) the cap check is
`relayed >= cap` read BEFORE the Neynar `await`: two concurrent anon posts with different nullifiers
both pass at `relayed = 0` and both post; the in-flight set is per nullifier, not a relay lock.
Also (e): if the DB transaction fails AFTER a successful network post (`:676-680`), the cast is
public, nothing is consumed, the client marks `refused`, `hasAnonPostInWindow` ignores refused, and
the user posts again — a second live cast in the window, cap unaffected.

**EVIDENCE.**
- `validator/zk.js:210` — `anonCastHash`; `validator/migrations.js:468-477` — `PRIMARY KEY (mode, cast_hash)`; `validator/zk.js:665` — `INSERT INTO zk_anon_casts … ON CONFLICT DO NOTHING`; `:663` the nullifier insert in the same transaction; `:637-638` — the cap count; `:641` the network post before the transaction; `:676-680` — `ROLLBACK … return { status: 500 …}`; `:630-631` in-flight per `env.nullifier`.
- `lib/zk/anon/queue.ts:146-157` — `hasAnonPostInWindow` counts `queued`, and `sent` with `accepted|replay` only.

**FIX.** Salt the hash: `castHash = sha256("layers-anon-cast/1|" + nonce + "|" + text)` with a
16-byte `nonce` in the payload (still exactly one text per proof), and key the row on
`(mode, network_hash)` — or refuse a duplicate `cast_hash` BEFORE consuming anything (409-class →
`replay` on the wire) so a window is never burned for nothing. Make the live cap a real lock: check
and reserve under one mutex/transaction that spans the network call, and count RELAYS (a separate
counter row incremented in the transaction) rather than distinct texts. For (e), consume the
nullifier at acceptance (see #2's store-and-forward).

---

## 8. MED — The spend ledger, the write ledger and the attribution index are PLAINTEXT with millisecond timestamps; the live spend note names persona AND fid; one `runId` groups the two live fids. A-Z2-HOUR-GRAIN is true of `updated_at` and false of the JSON inside; A-Z2-ATTRIBUTION-ACCOUNT-JOIN is no longer "moot".

**WHAT.** `xSpend`, `fcWrites`, `fcAttribution` are not vault namespaces. Their values carry
`at: Date.now()`. The live acquisition writes `id: fid:fname:<personaId>:<fname>` and
`note: "sponsored registration of fid <fid> for <personaId> — ESTIMATE …"` — persona↔fid in the
clear (redundant with #1, but it survives #1's fix), both entries under the same `runId`, seconds
apart. On fixture the fork's `fid:create:<newfid>` entry is millisecond-timed — the exact fork
moment beside `zk_fork_claims` (epoch) and the sealed `forks` flush (hour). `fcAttribution` is
`castHash → { personaId, at(ms), signature }` and `fcWrites` is `castHash → { fid, at(ms) }`; under
per-persona fids that is persona → account with a millisecond activity log in two tables, and for a
PRIVATE persona posting through the shared fid it is the private persona's entire cast history,
timed, in plaintext. Linkage v4 #4 checks "no single row holds both PUB and NEW" and EXCLUDES
`adapter_state` from the DB scan — the ledger holds both fids in two rows.

**EVIDENCE.**
- `lib/x/spend.ts:26-34` (`SpendEntry { at, runId, note }`), `:111` (`at: Date.now(), … runId: currentRunId()`), `:113` (`persistNs("xSpend")`); `scripts/fid-acquire.mjs:121` (`id: fid:fname:${personaId}:${fname}`), `:168` (`note: sponsored registration of fid ${fid} for ${personaId}`); `lib/fc/acquire.ts:115-118` (fixture entry).
- `lib/vault/vault.ts:44-78` — VAULT_NAMESPACES lacks `xSpend`, `fcWrites`, `fcAttribution`; `lib/adapters/mock/store.ts:243,561-562,630-634` — plain dumps.
- `lib/fc/writeLedger.ts:33-45` — `FcWriteEntry { castHash, fid, at }`.
- `scripts/accept-fid5.mjs:245-249` — per-row `both()`; `if (r.t !== "adapter_state" && both(r.s))`.
- `SECURITY-POSTURE.md` §12 A-Z2-ATTRIBUTION-ACCOUNT-JOIN — "Moot in v0 (one shared test FID …); the fix (drop `fid` from the ledger, hash `source_id`) is a follow-up."

**FIX.** Strip persona ids from spend ids/notes (`fid:fname:<fid>` is enough; the persona is in the
sealed record); hour-grain `at` in every plaintext ledger value, or seal `xSpend`/`fcWrites`/
`fcAttribution` (the attribution index is C5-plaintext by decision — then hour-grain its `at`).
Update A-Z2-ATTRIBUTION-ACCOUNT-JOIN from "moot" to "live". Make fid5 #4 scan values across a
namespace, not per row.

---

## 9. MED — `resetSeed` wipes ALL `adapter_state` — the LIVE persona-fid records (custody address, Neynar signer uuid) and the LIVE spend ledger included. Every suite run forgets the $10 cap's memory and the 2-live-fid limit.

**WHAT.** `resetState()` ends with `wipeAll()` → `DELETE /state` → `DELETE FROM adapter_state`
(no mode column exists). The sealed `personaFids` doc (fixture AND live records in one record) and
`xSpend` (fixture and live entries) go with it. `fidSpentLive()` and `MAX_LIVE_PERSONA_FIDS` read
those; after any sweep on a machine that has live records, the next `fid:acquire` sheet says "already
spent $0.00" and `live.length = 0`. The prompt's restart-survival exit ("persona↔FID map … spend ledger
survive a hard kill") is met for a kill and defeated by the reset every suite runs first. Recovery
re-derives keys, not the fid number, fname, or the managed-signer uuid (Neynar-side; recoverable only
through Neynar's API with the app key).

**EVIDENCE.**
- `lib/adapters/mock/store.ts:746,817` — `resetState()` … `await wipeAll()`; `lib/adapters/mock/persist.ts:302-308`; `validator/server.js:415-423` — `DELETE FROM adapter_state`.
- `app/api/dev/route.ts:459,468-469` — `await resetState(); … resetPersonaFidCache()`.
- `lib/fc/acquire.ts:129-130` (`live.length >= MAX_LIVE_PERSONA_FIDS`), `lib/x/spend.ts:127-136` (`fidSpentLive` from `xSpend`).
- `notes/prompts/multi-fid-prompt.md:262-265` — restart-survival requirement.

**FIX.** Reset by MODE: `wipeAll` must preserve entries with `mode: "live"` (the sealed record and
the ledger both carry it) — or store live fid records and the live spend ledger in a namespace the
reset never touches, with a `fidSpentLive()` that ALSO reads the on-disk receipt file the acquisition
script writes. Add a check: "resetSeed leaves live records and live spend entries intact".

---

## 10. MED — The effective anonymity set of an anon post is the set of ONLINE devices, not the tree: the fixed-schedule prefetch is an identified heartbeat.

**WHAT.** A device must be up to drain its queue; every device fetches `/zk/epoch`, `/zk/members`,
`/zk/history`, `/zk/validator-key` and the anon head every `ZK_PREFETCH_MS` (10 min ± 25 %) from its
own address (the prefetch is not anonymous; under OHTTP only the SUBMISSION is). So at any anon
submission time `t`, the candidates are "devices whose tick was seen in the last ~12 min", ∩ tree
members — in a small deployment a set of a few, and in the fixture exactly one (decoys never tick).
The floor counts leaves, not heartbeats. A-PRESENCE-LOG covers proofs that name personas; this is
liveness, which names devices. **Hypothesis on magnitude** (I did not measure a deployment); the
mechanism is in the code.

**EVIDENCE.** `lib/zk/prefetch.ts:77` (the identified fetch set per tick), `lib/zk/config.ts:83`
(`ZK_PREFETCH_MS` default 600 000), `lib/zk/anon/relay.ts:45-50` (direct relay = the operator sees
the source), `SECURITY-POSTURE.md` §3 A-PRESENCE-LOG / A-FALLBACK-PARTITION ("the effective
anonymity set is the ZK-path takers").

**FIX / ASSUMPTION.** State **A-FID-ANON-SET-IS-ONLINE-DEVICES** beside A-PRESENCE-LOG: "the
candidate set for an anon cast is the devices whose prefetch heartbeat the operator saw inside the
jitter window, bounded above by the tree". The store-and-forward relay of #2 (validator-side delay
longer than a prefetch period) widens it; running the prefetch through the anonymous channel too
(it is public material — the same OHTTP path serves `/zk/anon/head` already) removes the heartbeat's
address.

---

## 11. LOW — The operator reads texts it never relays

**WHAT.** The text is parsed and hashed BEFORE the replay check and the live-cap check. A forced
second post in a window (dev hooks), any post after the live cap is reached (503 → `refused`), a
post refused for tree/epoch — each hands the operator a text that never becomes public. After the
cap is reached every anon attempt is a silent disclosure: the client marks `refused`,
`hasAnonPostInWindow` ignores refused, the user is told "queued", nothing appears, and the next tick
can be asked again. Writing style is an identifier; an unpublished text is worse than a published
one for the author.

**EVIDENCE.** `validator/zk.js:569-572` (text validated) before `:621` (replay) and `:636-638` (cap);
`lib/zk/gate.ts:150-158` (`force`); `app/api/anon/route.ts:32` (`force` under `ZK_DEV_HOOKS`).

**FIX.** Order: nullifier/replay and cap checks first (they do not need the text); when the relay is
unavailable, answer `refused` before reading `payload` — or better, have the client refuse to
prove/submit when `GET /zk/anon-post/config` reports the cap reached or `liveRelay: false`. State in
the composer that a refused post's text was seen by the validator.

---

## 12. LOW — Relay integrity is the operator's word: nothing published lets a client verify a cast was proof-authorised, our feed renders the validator's text rather than the network's, and two crash windows produce a posted-but-unconsumed cast

**WHAT.** (a) The operator holds the anon signer; it can post anything as the anon account and add
any row to `zk_anon_casts` — no proof, commitment or signature accompanies a relayed cast, so a
reader cannot tell a proven cast from an operator-fabricated one. (b) Our feed builds cards from the
validator's `text`/`hash` (`/zk/anon-casts`), so the operator can show OUR users a different text
than the network has. (c) Network post succeeds, DB commit fails → cast public, nullifier free
(#7 e). (d) Validator crash between the Neynar POST and the commit → `inFlightNullifiers` (memory)
gone, nullifier free, the client's `transport-error` retry (1–30 s) re-submits, a second network
post. Honest-code replay, in-flight and tamper paths are sound (see the end).

**EVIDENCE.** `validator/zk.js:641-652,661-681`, `:220` (`const inFlightNullifiers = new Set()`),
`lib/feed.ts:634-646`, `lib/zk/anon/queue.ts:284-287`.

**FIX.** Publish a validator-SIGNED relay log entry per cast — `(mode, tree, epoch, castHash,
network_hash)` signed with the validator key (no nullifier: the row is already joinable by epoch
when counts are small, so omitting it buys nothing; keep it out anyway) — and have the client verify
the network cast's text hashes to `castHash`. For (c)/(d): consume at acceptance and relay
asynchronously with an idempotency key (the cast hash) checked against the network before re-posting.

---

## 13. LOW — Fork residuals: the fork moment is a burst of ~8 signed PUTs plus a millisecond-timed ledger row; fixture fids are creation-ordered; the anon row's `epoch` vs `relayed_at` straddle. Covered by A-Z2-HOUR-GRAIN / A-Z3-FORK-PRESENCE except the ledger millisecond (#8).

**WHAT (Q2).** What joins old → new at the validator: nothing by value (forks, grantsV3,
personaFids, rosters are ciphertext; `zk_fork_claims` names NEW + commitment; the `personas` table
never sees minted personas; the forward pointer is resolved app-side). What joins them by shape:
(i) the fork writes `personaFids`, `personaFidMap` ×2, `xSpend`, `forks`, `grantsV3`,
`identityRoster`/`rootRoster` in one burst — hour H in the DB, seconds in the request log;
(ii) `xSpend` `fid:create:<newfid>.at` is that second (#8); (iii) fixture fid `9,000,000 + n` orders
personas by creation, so the fork's persona is "the newest fid" — which the fork claim names anyway;
(iv) the OLD persona goes quiet (A-Z3-FORK-PRESENCE) and its `fcAttribution` rows stop at a
millisecond time (#8). The sponsor as registrant is sealed and is the same value for everyone — no
join. Nothing here is new beyond #8; noted for completeness with the request-log caveat: the
posture's hour-grain statements are about rows, and the operator also has the wire.

**EVIDENCE.** `app/api/identity/fork/route.ts:164-204`; `lib/fc/personaFid.ts:47,96-110`;
`validator/server.js:394-403`; `scripts/accept-fid5.mjs:241-256` (checks the fork claim's columns
and PUB's row value; not the burst, not the ledger).

**FIX.** #8's hour grain on ledger values; batch the fork's flushes onto the next prefetch tick
(the queue's Gate 0 pattern, as A-Z2-HOUR-GRAIN already suggests).

---

## 14. LOW — If `ZK_ANON_POST_TREE` is neither the gate tree nor an honoured bucket, the tick fetches it ONLY when an anon post is wanted — the attack-att-1 #1 beacon, reopened for anon posts

**EVIDENCE.** `lib/zk/prefetch.ts:124-134` — `uniform` = honoured bucket trees; `wantedTrees()` adds
the anon tree only while a wanted anon claim exists; `lib/zk/config.ts:93` — `ZK_ANON_POST_TREE`
may be any tree (`tier-5`, say). Default (`tier-${ZK_GATE_TIER}`) is the gate tree and safe.

**FIX.** Add the configured anon tree to the uniform set unconditionally (one more fetch per tick),
and refuse an anon tree that is not in the uniform set at config time.

---

## 15. LOW — The pass's own live recorders write persona→fid and the anon cast's hash+time into a tracked directory

**WHAT.** `research/live-fid2.json` holds `{ personaId, fid, fname }` for the user's personas;
`research/live-fid4.json` holds `{ at, castHash, networkHash, fid, text, url }` for the one real
anon cast. `research/live-att1.json` is already tracked; `.gitignore` excludes neither. Committing
them publishes, under the developer's name, exactly the persona→account map (fine for public
personas of the developer, but it is the map) and a self-attribution of the anon cast.

**EVIDENCE.** `scripts/live-fid4.mjs:61-62`, `scripts/live-fid2.mjs:69-70`, `.gitignore` (lines 5,
13 only: `.keystore/`, `.zk-artifacts/`), `git ls-files research` → `research/live-att1.json`.

**FIX.** Gitignore `research/live-*.json`; redact `text` and `at` from the anon record (keep the
network hash; it is public); say so in the recorder's header.

---

## 16. INFO — What the pass's own suites do NOT assert (Q: fid3/fid4/fid5)

- fid5 #3 asserts the plain map CONTAINS every own persona (`accept-fid5.mjs:230-232`) — it should assert the map does not exist (#1).
- fid5 #2's anon crowd is forged through the plain door (notes/reports/RESUME.md:93), so no suite exercises wire TIMING for anon posts: not the enqueue-time flush (#3), not submission-vs-publication (#2), not the retry pattern.
- fid5 #4 excludes `adapter_state` from the DB scan and checks per row, not per namespace (#8); fid4 #3 scans only for own ids and the cast's hashes/text/nullifier, so a millisecond `at` or a `runId` grouping passes.
- No suite runs `ZK_ANON_POST_WINDOW_EPOCHS > 1` (#6); the validator unit test encodes the epoch-in-scope shape (`zk.test.js:216`).
- No suite posts the same text twice (#7), or two anon posts concurrently, or checks the live cap arithmetic (fixture never reaches it); no suite checks that `resetSeed` preserves live fid records or live spend (#9).
- No suite asserts that a persona WITHOUT a keystore entry is refused by `recordLiveFid`/`custodySign` on live (#4); fid2 #8 dry-runs the live command on a minted persona precisely because MAIN "already owned a fixture fid", not because MAIN's keys are public.
- fid3 #3 / fid5 #3 assert "no plaintext row relates the new fid to the old persona" but never that no plaintext row relates a fid to ANY persona (the map does, by design).

## 17. INFO — The render path now makes a validator request

`lib/feed.ts:633-636` fetches `/zk/anon-casts` on every discovery feed build. Public read, no
viewer, uniform across devices — harmless for linkage — but it contradicts Pass 2's "the render
path makes no validator request" property (`requestCounts` at `validator/zk.js:765-768` counts it).
Serve it from the prefetch snapshot instead.

## 18. INFO — Doc state

- `SECURITY-POSTURE.md` has no "Network identities" section yet (Gate 5 exit); §3 A-PREPARE-BURST is contradicted by the code (#3); §12 A-Z2-ATTRIBUTION-ACCOUNT-JOIN says "moot" (#8); nothing states the single-tenant anon account (#5) or the publication-time join (#2).
- REPORT-FID D-FID-4-WINDOW and D-FID-4-COARSE-TIME state properties the code does not have (#6, #2).

---

## Checked and found sound

- **The anonymous channel** (`validator/anon.js`): header allowlist (`:42-47`), constant 256-byte response, 4096-byte constant request (`lib/zk/anon/submit.ts:33-40`, refuses rather than sends unpadded), PoW bound to the body, no logging in `anon.js`/`zk.js`, `WITHOUT ROWID` nullifier and anon tables (no arrival order). The `payload.text` fits the constant size at 320 chars (worst case ≈ 2.6 KB of 4 KB).
- **Claim binding for anon-post** (`validator/zk.js:566-588,264-269`): `personaId` must be the constant `anon` and is refused elsewhere; `castHash` only on anon-post; `payload` only on anon-post and only `text`; the text is re-hashed; the tree must be the validator's configured predicate; `scope`/`message` re-derived; the tag/Groth16 check before the replay check; the in-flight set closes the replay race for anon-post (`:630-631`); nullifier + row in one transaction (`:661-675`). No `zk_eligibility`, `zk_fork_claims` or `zk_attestation_claims` row is written for an anon post (`:689-710` are kind-gated).
- **The anon row and reads**: `zk_anon_casts` has no persona, root, nullifier, IP or device column (`migrations.js:468-477`); `/zk/anon-casts` and `/zk/anon-post/config` take no viewer (`zk.js:908-919`); the fixture network hash is a function of the cast hash only.
- **The scope registry**: `anon-post` is `onePerHuman: true` with a linkage line on both sides; the collision suite iterates it; the tier/fork/attestation scopes are untouched.
- **Act-as on the network path**: the reply goes through the write door and returns BEFORE the `layers:persona:` marker is composed (`app/api/actions/act-as/route.ts:101` vs `:107`) — no persona id rides a network cast's text.
- **The fork**: `forks`, `grantsV3`, `personaFids`, `identityRoster`, `rootRoster` are ciphertext; the fork claim names NEW and a 128-bit-nonce commitment; minted personas never reach the validator's `personas` table; the forward pointer's `movedFid` is served only to a carried holder (`fork/route.ts:55-61`); the blocked id is opaque (`server.js:203-207`).
- **The identity rule**: `recordLiveFid` pins origin, ≤ 2 live, derived signer and custody address to the persona's own (#4 is about WHICH derivation, not the check); `custodySign` accepts exactly two typed-data shapes with `to`/`key` pinned to the persona's own material (`custodySign.ts:54-92`); `assertOwnFidIdentity` refuses foreign fids/signers/origins.
- **Registrant linkage**: the sponsor is a constant, sealed; the assertion groups by non-sponsor registrant/funder and by custody address (`lib/fc/linkage.ts`).
- **Reset/migration hygiene**: `/zk/dev/reset` is fixture-only and deletes by `mode` (`zk.js:1249-1268`, `zk_anon_casts` included); migration 10's `down` drops only its own table; live anon rows survive fixture resets (so the live cap's memory does — unlike the app-side ledgers, #9).
- **The `force` hook and the once-per-window client check**: `force` is gated by `ZK_DEV_HOOKS` on the app (`app/api/anon/route.ts:32`) and the validator still refuses by nullifier; the client's early-return/hydrate difference in `requestAnonPost` is visible only to the app's caller (the user's browser), not to the validator.
- **The drain**: one random due item per 5 s tick; an anon item is not distinguishable in the queue's order; jitter window validated against the epoch shape.
- **The feed's anon card**: no persona layer, no tier, no merged identity, not an act-as option, not in followed-only modes.
