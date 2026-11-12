# attack-fid-3 — the code-level adversary against the multi-FID pass (identity rule, money rule, custody signing, anon relay, key leaks, fail-closed)

**Reviewer:** fresh context, read-only. **Tree reviewed:** HEAD `2995279` (Gate 3 green) plus the uncommitted Gate 4 working tree (`git status`: `app/api/anon/`, `scripts/live-fid4.mjs`, `scripts/accept-fid4.mjs`, `validator/zk.js`, `lib/zk/*` modified). Line numbers below are from that working tree. No server was started, no script was run; evidence is file reads and greps only.

**Angle:** a malicious request to the app's routes, a malicious response from Neynar or the validator, a compromised environment variable, a second device, a rig hook left on. Goals (a)–(g) from the brief; the checklist at the end names, for each goal, the line that refuses it where the code is sound.

**Ground truth I relied on:** the identity rule ("this pass may only ever write as FIDs it created itself — the throwaway plus the two it creates; any credential for any other FID must be refused"), the money rule ("hard cap $10 total, at most TWO persona FIDs created live, dry-run cost sheet before any creation, all through the spend ledger"), and the /verify line "a mid-creation FID acquisition resumes with check-before-retry, never double-creates".

Severity is about what the finding does to those three rules, not about how exotic the precondition is. Where a precondition is a dev flag, note that **the user's live acquisition command itself requires `ZK_DEV_HOOKS=true` on the app** (`scripts/fid-acquire.mjs:23`, `app/api/fc/persona/route.ts:85-97`), so "needs dev hooks" is the state the live run is in by construction, not a hypothetical.

---

## Findings

### 1. HIGH — A live FID for a SEEDED persona gets a custody key and a signer key that anyone can derive from the repo (goal c, then a)

**WHAT.** The seeded viewer persona (`persona_viewer_main`, the Gate 2 plan's "seeded public persona") is not in the keystore: `adoptSeededPersona` (`lib/identity/keystore.ts:418-432`) is never called anywhere (grep: zero callers). Its Farcaster keys therefore come off the FIXTURE root, whose master is a public string constant. `recordLiveFid`, `custodySign` and `signerProbe` all accept that persona as a live subject.

**EVIDENCE.**
- `lib/crypto/kdf.ts:111-114` — `const FIXTURE_MASTER = te.encode("layers-fixture-master/v1"); fixtureSeed(accountId) = hkdf(sha256, FIXTURE_MASTER, …, DOMAIN + "fixture-root/" + accountId)`. Public by construction, as the file says.
- `lib/identity/fixtureRoots.ts:69-73` — `fixtureFcCustodyAddress(personaId)`: `privateKeyToAccount(toHex(fcCustodySeed(fixtureSeed(personaId), personaId)))`; `:62-66` `fixtureSignCustodyTypedData` signs with that same key; `:51-58` the signer key likewise.
- `lib/identity/keys.ts:48-50` — `fcCustodyAddressFor = fcCustodyAddress(personaId) ?? fixtureFcCustodyAddress(personaId)`; `:53-55` `signCustodyTypedDataFor` falls through to the fixture twin; `:58-60` `isViewerPersona = isOwnPersona || SEED_VIEWER.personas.includes`.
- `lib/fc/acquire.ts:125,131-134` — `recordLiveFid` admits the persona via `isViewerPersona` and requires exactly the fixture-derived `derivedPubHex` / `custodyAddress`.
- `lib/fc/custodySign.ts:59-72` — signs the IdRegistry `Transfer` to that address with that key.
- `notes/reports/REPORT-FID.md:187-188` records the dispatch ("MAIN's off its fixture root") as the fix for a rig failure; no D-/A- id names the consequence for a LIVE account. `lib/identity/fixtureRoots.ts:13-19` explicitly scopes the "public by construction" acceptability to "demo furniture".

**ATTACK.** After the user runs `FID_ACQUIRE_CONFIRM=yes npm run fid:acquire persona_viewer_main …`: anyone with the repository computes `fcCustodySeed(fixtureSeed("persona_viewer_main"), "persona_viewer_main")`, has the fid's custody private key, and can (i) `KeyGateway.add` their own signer and post as the persona, (ii) `IdRegistry.transfer` the fid away, (iii) compute the persona's derived Ed25519 signer and sign the `neynar.score` challenge (`lib/attest/issuers/neynar.ts:82-84`) as that fid. The identity rule is then broken from outside the app: a third party writes as a FID the pass created.

**FIX.** Refuse a LIVE acquisition (and `custodySign`) for any persona whose keys resolve through `fixtureRoots.ts`: in `recordLiveFid` and both `custodySign` shapes, require `isOwnPersona(personaId)` (keystore-minted) — or adopt the seeded viewer personas into the keystore under the real root before Gate 2 live (that is what `adoptSeededPersona` was written for). `signerProbe` should say which root the address came from. Until then, the live command must only ever be run on minted (`p_…`) personas; write that down as an assumption if adoption is deferred.

---

### 2. HIGH — `resetSeed` wipes the spend ledger and the live persona↔fid records: the two money-rule counters reset, and the sealed signer uuids are destroyed (goals b, g)

**WHAT.** The FC pass preserved LIVE write-ledger entries across a seed reset precisely so caps and receipts survive (`lib/adapters/mock/store.ts:747-755, 818-821`). The multi-FID pass added two more live facts — the fid spend entries (`xSpend`, kinds `fid_*`) and the sealed `personaFids` records — and neither is preserved. `resetSeed` is on the ungated `/api/dev` route (no `ZK_DEV_HOOKS` check anywhere in `app/api/dev/route.ts`) and is a Developer-pane button.

**EVIDENCE.**
- `lib/adapters/mock/store.ts:753-755` — only `fcWrites` with `mode === "live"` are kept; `:817` `await wipeAll()`; `:818-821` only `fcWrites` restored.
- `lib/adapters/mock/persist.ts:302-308` — `wipeAll` → `DELETE /state`; `validator/server.js:415-423` — `DELETE FROM adapter_state` (every namespace, `xSpend`, `personaFids`, `personaFidMap` included).
- `app/api/dev/route.ts:459,468-469` — `await resetState()` then `resetPersonaFidCache()` so the in-process record cache is dropped and the next `load()` reads the now-empty validator namespace (`lib/fc/personaFid.ts:50-68`).
- `lib/x/spend.ts:127-129` — `fidSpentLive()` reads `state().xSpend`, which is `freshState()` after the reset. `lib/fc/acquire.ts:129-130` — the "≤ 2 live" count reads `allPersonaFids()`, now empty. `scripts/fid-acquire.mjs:87-89,96-97` — the command's pre-checks read the same two sources through `GET /api/fc/persona` and `costSheet`.

**ATTACK.** Create two live fids (ledger $1.80, 2 live records). Press "reset seed" (or `POST /api/dev {action:"resetSeed"}` from anything on the host). Run `npm run fid:acquire` again: the cost sheet prints `already spent this pass: $0.00`, `liveNow.length === 0`, the app's `recordLiveFid` sees 0 live → two more real accounts are created. Repeat. The $10 cap and the two-account limit are exactly as durable as a button. Side effect: the sealed records holding the Neynar signer uuids for the first two fids are gone, so the app can never post as (or delete the test casts of) those accounts again — the live recorder `scripts/live-fid2.mjs:60-64` will refuse ("no live persona records").

**FIX.** Mirror the FC-pass rule: before `wipeAll()`, retain every `xSpend` entry with `mode === "live"` and every `personaFids` item with `mode === "live"` (plus their plain-map rows), and re-flush them after the wipe. Better still, make the LIVE counters independent of the app's state: the acquisition command should also count live fids from Neynar (`GET /v2/farcaster/user/bulk?fids=` over the recorded fids, or the app wallet's registration history) before any billable call. Also gate `resetSeed` on `ZK_DEV_HOOKS` or make it refuse while live records exist.

---

### 3. HIGH — `fid-acquire.mjs` has no check-before-retry; `FID_RESUME_FID` is printed but never read; an ambiguous registration failure and a re-run is a second real account (goals b, g)

**WHAT.** The /verify line promises "a mid-creation FID acquisition resumes with check-before-retry, never double-creates". The script's own abort text tells the user to "re-run with FID_RESUME_FID=<fid>" — no code reads that variable (grep over `scripts lib app`: the only two hits are the two `die` messages). A re-run reserves a fresh fid and registers again. Ledger-before-network is also violated on the one billable step.

**EVIDENCE.**
- `scripts/fid-acquire.mjs:160` — `fetch(POST /v2/farcaster/user).catch((err) => die("ABORT: register call failed before any response."…))` — a timeout/ECONNRESET after the request left is exactly the outcome-unknown case and is treated as "did not happen".
- `:164-166` — on non-2xx / non-JSON: `die(…"If the fid was created anyway, re-run with FID_RESUME_FID=<fid> to record it (check-before-retry).")`. No reader of `FID_RESUME_FID` exists.
- `:124-128` — every run calls `GET /v2/farcaster/user/fid` for a NEW fid; nothing looks up whether the persona's custody address already owns a fid (`IdRegistry.idOf(custody)` / Neynar `user/custody-address`) before reserving.
- `:168` — the `fid:create` spend (the only USD row) is recorded AFTER the registration succeeded; `:142-145` the signer is created before the registration — on an ambiguous registration failure the ledger holds `$0.00` for an account that may exist.
- `lib/fc/writes.ts:11-17,409-439` show the discipline the write path has and this script lacks.

**ATTACK.** Neynar returns 504 (or the socket drops) after the IdRegistry transaction is submitted. The script dies with the misleading hint. The user re-runs: fid N+1 is reserved, a second `Transfer` is signed for the same custody address, registration is attempted — it either creates a second account (if Neynar sponsors a fresh fid per request; then the app's `recordLiveFid` refuses the third when the count reaches 2 — after the money was spent) or reverts on-chain because the custody address already has an id (`HasId`), which the script again reports as "No record was persisted". Either way: a real fid exists that no record and no ledger row knows about, and the cap counted $0 for it.

**FIX.** Before reserving, read the persona's custody address on the network (`IdRegistry.idOf(custody)` via the already-created `publicClient`, or Neynar's custody-address lookup); if a fid exists, skip creation and go straight to signer + `recordLiveFid` (that is the resume). Record a PENDING `fid_create` entry (estimate) BEFORE the registration call and settle it after, put-by-id on `fid:create:<custody>` not `<fid>`. Implement `FID_RESUME_FID` or delete the hint.

---

### 4. HIGH (needs `ZK_DEV_HOOKS=true`, which the live run has) — `injectFidRecord` writes an unvalidated record; the identity rule then trusts the record's `origin` string, and the app posts with an arbitrary signer uuid as an arbitrary fid (goal a)

**WHAT.** `assertOwnFidIdentity` admits a persona's fid when the vault record's `origin` is `"fixture"` or `"layers-fid-pass"` and hands back whatever `signer.uuid` the record holds. `injectFidRecord` stores any record shape for any persona id, skipping every check `recordLiveFid` performs — including `mode`, `origin`, the derived-key binding and the live count. The write path then uses `rec.mode === "live"` to pick the live transport.

**EVIDENCE.**
- `app/api/fc/persona/route.ts:134-142` — `injectFidRecord`: only `PERSONA_RE` on `personaId`, then `recordPersonaFid({...rec, createdAt})`. The comment says "NEGATIVE cases only", the code does not enforce it (no `mode !== "live"`, no `origin` restriction).
- `lib/fc/writes.ts:121-129` — `OWN_ORIGINS = {"fixture","layers-fid-pass"}`; `if (rec && OWN_ORIGINS.has(rec.origin)) { … uuid = rec.signer.uuid …; return { fid: rec.fid, signerUuid: uuid, … } }`. No re-derivation of `rec.signer.derivedPubHex` / `rec.custodyAddress` against the persona at write time.
- `lib/fc/writes.ts:306-308` — `transportFor`: `if (writeEnabled() && rec.mode === "live" && creds.signerUuid) return liveTransport({fid, signerUuid})`.
- `lib/fc/writes.ts:222-238` — `liveTransport.publish` sends `{ signer_uuid: creds.signerUuid, text }` under `NEYNAR_API_KEY`.
- Ownership at the door (`app/api/fc/write/route.ts:82-84`) checks only that the PERSONA is the viewer's; the fid comes from the record.

**ATTACK.** With `ENABLE_FC_WRITE=true`, `NEYNAR_API_KEY` set and `ZK_DEV_HOOKS=true` (the live run's state):
```
POST /api/fc/persona
{"action":"injectFidRecord","record":{"personaId":"persona_viewer_main","fid":3,"fname":"x",
 "origin":"layers-fid-pass","custodyAddress":"0x0000000000000000000000000000000000000001",
 "signer":{"kind":"neynar-managed","uuid":"<any signer uuid this NEYNAR_API_KEY controls>","derivedPubHex":"00","derivedRegistered":false},
 "registrant":"neynar-sponsor","funder":"neynar-sponsor","createdAt":1,"mode":"live"}}
POST /api/fc/write {"action":"cast","personaId":"persona_viewer_main","text":"…"}
```
`identityProbe {fid:3}` now answers `allowed:true`, and the cast goes out through the injected signer. Neynar scopes managed signers to the API key, so the practical reach is "any signer this app's key holds" — in the demo that is the throwaway's and the two personas'; in any deployment where users have approved signers through this app (SIWN), it is every one of them. The identity rule is meant to be absolute regardless. Note `origin:"fixture"` + `mode:"live"` also reaches the live transport (`:306-308` keys on `mode`, `:121` on origin).

**Related weakness in the honest path.** `recordLiveFid` (`lib/fc/acquire.ts:123-137`) binds the record to the persona only through PUBLIC material (`derivedPubHex`, `custodyAddress`, both handed to anyone by `signerProbe`, `app/api/fc/persona/route.ts:55-64`) plus two strings (`origin`, `mode`). Nothing binds `fid` or `signer.uuid` to "we created this": a caller (or a tampered script, or a malicious Neynar response at `fid-acquire.mjs:125,143`) can record any fid with any uuid.

**FIX.** (1) `injectFidRecord`: force `mode: "fixture"`, refuse `origin === "layers-fid-pass"`, and tag injected records with an origin outside `OWN_ORIGINS` (e.g. `"injected"`) so the identity rule refuses them by construction — the fid1 negative cases only need linkage flags and a refusal. (2) `assertOwnFidIdentity`: re-derive at write time — `rec.signer.derivedPubHex === fcSignerPublicKeyFor(personaId)` and `rec.custodyAddress === fcCustodyAddressFor(personaId)` — before returning creds. (3) `recordLiveFid` on live: verify on the network that `custody_address(fid)` equals the persona's derived custody address (Neynar `user/bulk` or `IdRegistry.custodyOf`) and that the signer uuid is approved for that fid (`GET /v2/farcaster/signer?signer_uuid=`): an unforgeable "this fid is ours".

---

### 5. HIGH/MED — The validator's anon relay has no identity rule: it posts with whatever `FC_ANON_SIGNER_UUID` is in its env, records the env's `FC_ANON_FID` (defaulting to the app's `FC_TEST_FID`), never checks the network's answer, and has no arming flag (goals a, d, g)

**WHAT.** The app's write module refuses a foreign signer in env and refuses to write when the throwaway is not configured (`lib/fc/writes.ts:338-362`). The validator process, which now makes real network writes, has none of that: presence of three env values IS the arming, the recorded fid is a number typed by the operator, and the cast author Neynar returns is discarded.

**EVIDENCE.**
- `validator/zk.js:213-218` — `anonRelayAccount(): fid = Number(FC_ANON_FID ?? FC_TEST_FID ?? ""), signerUuid = FC_ANON_SIGNER_UUID ?? "", apiKey = NEYNAR_API_KEY`.
- `:636` — the only gate: `if (!acct.fid || !acct.signerUuid || !acct.apiKey) return 503`.
- `:640-652` — `fetch("https://api.neynar.com/v2/farcaster/cast", { body: { signer_uuid: acct.signerUuid, text } })`; `hash = j.cast.hash`; `anonRelay = { hash, fid: acct.fid }` — `j.cast.author.fid` is never compared to `acct.fid`.
- `:665-673` — the row stores `anonRelay.fid` (the env number). `:908-913` the public list serves it; `lib/feed.ts:644` renders `author.fid = a.fid`; `scripts/live-fid4.mjs:61` records `fid: cast.fid` as the evidence of "through the throwaway".
- No `ENABLE_FC_WRITE` anywhere in `validator/`; `scripts/live-fid4.mjs:33` checks `ENABLE_FC_WRITE` in ITS OWN process only; `app/api/anon/route.ts` / `lib/zk/gate.ts:142-162` never consult `writeEnabled()`.
- `.env.example:40-42` documents `FC_ANON_FID` as "defaults to FC_TEST_FID" and `FC_ANON_SIGNER_UUID` as "the throwaway's managed signer" — a second copy of the throwaway's secret in a second process, without the loaded-gun rule that protects the first copy.

**ATTACK (env).** Put a signer uuid for fid X (any account whose signer this Neynar key holds) in `FC_ANON_SIGNER_UUID` and leave `FC_ANON_FID` unset with a shared env file: the validator relays as X and records the throwaway's fid on the row; every consumer (feed, live-fid4 record, REPORT) believes the anon cast went through the throwaway. The identity rule is broken in the process that has the fewest checks.

**ATTACK (no arming).** `ZK_MODE=live` on the app (or the dev `setZkMode` override) plus the three validator env values → every composer "Post anonymously" reaches the real network. Nothing in that request path is `ENABLE_FC_WRITE`-gated; the app's rule that live writes are opt-in via one flag does not cover this write. The live cap (finding 8) is the only bound.

**FIX.** In the validator: require `FC_ANON_FID` explicitly (drop the `FC_TEST_FID` fallback); at boot (and on `/zk/anon-post/config`) resolve the signer once — `GET /v2/farcaster/signer?signer_uuid=` — and refuse the relay unless `status === "approved"` and its `fid === FC_ANON_FID`; after the relay, refuse to record (and log loudly) if `j.cast.author.fid !== acct.fid`; require `ENABLE_FC_WRITE=true` in the validator's env for `mode === "live"`; refuse if a legacy `NEYNAR_SIGNER_UUID` differing from `FC_ANON_SIGNER_UUID` is present (the app's loaded-gun rule). In the app: `requestAnonPost` refuses when `zkMode() === "live"` and `!writeEnabled()`.

---

### 6. MED — `personaFid.load()` turns "validator down" and "wrong vault key" into an EMPTY record set, caches it for the process, and the next `save()` overwrites the vault namespace with it (goals g, b, then a-adjacent)

**WHAT.** The vault module is fail-closed on wrong key (`lib/vault/vault.ts:140-146` throws). The persona↔fid module catches that throw, and any transport failure, into "no records" and caches the result. Subsequent behaviour: the live count reads 0 (finding 2's counter, without the button), a persona that owns a live fid silently posts through the throwaway, and any mutation seals the empty document over the real one.

**EVIDENCE.**
- `lib/fc/personaFid.ts:50-68` — `try { fetch(/state/personaFids) … decryptNamespace(…) } catch { /* validator down or a foreign vault key: … (empty, never wrong) */ } g.__layersPersonaFids = doc;` — the comment asserts "never wrong"; the fetch is unretried and unsigned (`:54`), unlike the store's `retryAdapter` discipline.
- `:70-80` — `save()` re-encrypts `doc` and `flushVault` REPLACES the namespace (`validator/server.js:380-412` deletes then inserts); the plain map is replaced too (`:79`).
- `:96-102` — `nextFixtureFid()` saves on every fixture mint, so a fork (`app/api/identity/fork/route.ts:171-181`) is enough to trigger the overwrite.
- `lib/fc/writes.ts:305-315` — `rec` null → `transport()` → the throwaway, no error; the write route then attributes the cast to the persona as if it had posted from its own account.
- `lib/fc/acquire.ts:129-130` — the live count from the same empty doc.

**ATTACK.** Restart the app while the validator is briefly unreachable (the supervisor restarts it in ~2 s — `7bec1ba`'s own story); the first `personaFidRecord()` call caches `{items: []}`. Every later cast by a persona with a live fid goes out under the THROWAWAY (wrong account, silently), `recordLiveFid` accepts up to two more live fids, and the first fork/acquire seals the empty doc over the validator's copy — the Neynar signer uuids of the real accounts are lost for good (the vault is the only place they live).

**FIX.** Same rule as the store: retry the read, and on failure THROW (or mark the module "unavailable" so `transportFor` refuses with `FcIdentityError` instead of falling back to the throwaway). Never cache an empty doc obtained from a failed read; never `save()` over a namespace that was not successfully loaded (keep a `loadedFromValidator` flag; refuse `save()` without it). The wrong-key throw must stay loud.

---

### 7. MED — "One anon post per root per window" is NOT enforced by the validator for windows longer than one epoch: the scope string still carries the epoch, so each epoch inside a window has a fresh nullifier (goal d — "a forced second post")

**WHAT.** D-FID-4-WINDOW says the nullifier is constant across a window and the validator's replay rule refuses the second post. Both scope derivations qualify the feature with `w<n>` and then append `epoch` anyway. With the default `ZK_ANON_POST_WINDOW_EPOCHS=1` this is invisible (window = epoch); with any larger window only the client's courtesy check stands, and that check is bypassable by `force` (dev) or by a second device whose queue has not yet seen the first device's deferred `sent` persist.

**EVIDENCE.**
- `validator/zk.js:231-234` — `feature = "anon-post/" + qualifier` (the window); `:242` — `if (entry.onePerHuman) return \`${SCOPE_DOMAIN}|${feature}|${epoch}\``.
- `lib/zk/scopes.ts:182-185,189-193` — identical on the client: `return \`${SCOPE_DOMAIN}|${feature}|${epoch}\``.
- `lib/zk/prove.ts:181-183` — `scopeString("anon-post", epoch, undefined, anonPostWindowOf(epoch))`.
- The nullifier is `Poseidon(hash(scope), secret)` (`lib/zk/scopes.ts:15-16`): different epoch → different scope → different nullifier → `validator/zk.js` replay check (≈`:619-621`) does not fire.
- Client-side only: `lib/zk/gate.ts:150-156` (skipped under `force`), `:260-263` (skipped under `force`); `lib/zk/anon/queue.ts:146-157` reads the vault queue, which is persisted on a deferred random delay (`:228-236`), so a second device can race it.
- Grace: `validator/zk.js` accepts `p.epoch === current - 1`; a proof prepared against the previous epoch's snapshot has yet another nullifier — two posts in one wall-clock epoch at the boundary even with W=1 (a modified client; the product path proves only from the current snapshot).

**ATTACK.** Set `ZK_ANON_POST_WINDOW_EPOCHS=4` on both processes. Post at epoch 8 (w2). At epoch 9 (still w2) `POST /api/anon {text, force:true}` under dev hooks — or from a second linked device — and the validator ACCEPTS: different epoch component, new nullifier, relayed. The documented "the validator's refusal is the rule, the client's a courtesy" is inverted.

**FIX.** For `onePerHuman` scopes that carry a window qualifier, the epoch component must be the WINDOW index, not the epoch: `${SCOPE_DOMAIN}|anon-post/w<n>` (or `|w<n>` in place of `|epoch`) on both sides, with the z0 collision suite extended to assert equality of nullifiers across the epochs of one window. Reject `p.epoch` in the grace epoch for anon-post if it falls in the previous window and the current window already has a relay (or simply disallow grace for this kind).

---

### 8. MED — The live relay cap is a read-then-write across an awaited network call: concurrent submissions exceed it; a NaN env value disables it; `ON CONFLICT DO NOTHING` under-counts; a rollback after the network write leaves an uncounted cast (goals d, g)

**EVIDENCE.**
- `validator/zk.js:637-638` — `relayed = COUNT(*) … WHERE mode='live'; if (relayed >= anonLiveCap()) return 503;` then `:640` `await fetch(neynar)`. Two envelopes with DIFFERENT nullifiers (two roots; or one root across epochs per finding 7) both read `relayed = 0` before either inserts. The `inFlightNullifiers` set (`:220,630`) is keyed by nullifier and does not serialize this.
- `:219` — `anonLiveCap = Math.max(0, Number(process.env.ZK_ANON_POST_LIVE_CAP ?? 1))`: `Number("one")` is `NaN`, `Math.max(0, NaN)` is `NaN`, `relayed >= NaN` is `false` → unlimited live relays. Same shape at `:209` (`anonPostMaxChars`) → no length limit. Contrast `lib/fc/writeLedger.ts:20-26`, which NaN-proofs its caps for exactly this reason.
- `validator/migrations.js:468-477` — `PRIMARY KEY (mode, cast_hash)`; `validator/zk.js:665` `INSERT … ON CONFLICT DO NOTHING`: the same text relayed twice (finding 7 across epochs, or after a partial failure) posts twice to the network and counts once.
- `:661-680` — the network write (`:640`) precedes `BEGIN`; on `ROLLBACK` the cast exists, no row, cap unchanged.

**ATTACK.** `ZK_ANON_POST_LIVE_CAP=1`. Two anon submissions land within one Neynar round-trip (two roots on a shared validator is the ordinary case): both relay. Or misspell the env once and the "one live relay this pass will ever make" becomes unbounded.

**FIX.** Reserve the slot before the network call inside a transaction (insert a `pending` row keyed by `(mode, nullifier)`, count pending+relayed against the cap, settle after), or a process-level mutex around the live branch. `Number.isFinite` guards with the documented defaults for every numeric env read in `zk.js` (`:206-209,219`, also `anonFloor` at `:83`). Key `zk_anon_casts` on `(mode, nullifier)` or `(mode, network_hash)` so every relay is a row.

---

### 9. MED — The "$10 hard cap" is an environment knob with no ceiling and a NaN fail-open on the app side (goal b)

**EVIDENCE.**
- `lib/x/spend.ts:119` and `lib/fc/acquire.ts:26` — `FID_SPEND_CAP_USD = Number(process.env.FID_SPEND_CAP_USD ?? 10)` — any value, no clamp.
- `lib/x/spend.ts:132-136` — `if (fidSpentLive() + amount > FID_SPEND_CAP_USD) throw` — with `NaN` the comparison is always false: `recordFidSpend(mode:"live")` never refuses.
- `scripts/fid-acquire.mjs:33,97` — `CAP_USD` from the same env; `sheet.capUsd > CAP_USD` compares a value to itself; `!sheet.underCap` does abort on NaN (because `x <= NaN` is false), so the dry run is safe — the app-side gate is not, and `recordFidSpend` accepts any `amount`/`mode` from the caller (`app/api/fc/persona/route.ts:123-130`).

**ATTACK.** `FID_SPEND_CAP_USD=100` in `.env.local` (a "compromised environment variable" is one line in a file the pass edits) raises the pass's hard cap silently; nothing pins it to the prompt's 10. Or `FID_SPEND_CAP_USD=` (empty string → `Number("")` = 0 → every live record refused: safe) versus `FID_SPEND_CAP_USD=ten` (NaN → never refused).

**FIX.** `const FID_SPEND_CAP_USD = Math.min(10, isFinite(n) && n > 0 ? n : 10)` — the prompt's figure as a ceiling, never a default; the script should refuse if the app reports `capUsd > 10`.

---

### 10. MED — The content-hash identity ignores the acting fid: in per-persona-fid mode a second persona posting the same text is either silently folded into the first persona's cast (fixture) or refused forever (live) (goals e, g)

**WHAT.** `fcContentHash(text, parent)` was designed for ONE account. With one fid per persona, the same words under two fids are two distinct network casts, but the ledger, the in-flight map and the sim network all key on the fid-less hash.

**EVIDENCE.**
- `lib/fc/writes.ts:42-44` — `fcContentHash(text, parent)`; `:376-386` — `inFlight` keyed on it: a concurrent same-text publish by persona B returns A's result with `deduped: true` (and A's `fid`), and the route then stores no attribution for B (`app/api/fc/write/route.ts:102-122`).
- `:409-424` — `priorWriteFor(contentHash)` is not fid-scoped; fixture `findByContentHash` (`:198-201`) hits A's cast → B's request returns A's hash, `deduped: true`; the route answers `attributionUnchanged: true, personaId: A`.
- `:426-435` — live: `findByContentHash` scans B's fid (`:240`), A's cast is not there → "a prior live receipt exists … refusing to re-publish" — B can never post that text while A's `sent` entry exists (live entries are preserved forever by design).
- `:183-197` — the sim map is keyed by `contentHash`; `fixtureTransportAs` (`:318-328`) re-tags the SAME entry with the new fid, so on fixture A's cast is silently re-attributed to B on the "network".

**ATTACK (live DoS / misreport).** Post "gm" as persona A. Persona B posts "gm": 502 "refusing to re-publish" — permanently. On fixture, B's "gm" returns 200 with A's hash and the sim now says B posted A's cast.

**FIX.** Include the acting fid in the identity: `fcContentHash(text, parent, fid)`; key `inFlight`, the ledger's `contentHash` and the sim map on it; `findByContentHash` already scans per fid.

---

### 11. MED — The "fixture write under live content is a silent no-op" guard does not cover the per-persona path: a forked persona's FIXTURE fid record routes to the sim while writes are armed; a live record without a usable signer uuid also falls to the sim (goal g)

**EVIDENCE.**
- `app/api/identity/fork/route.ts:171-181` — in per-persona-fid mode a fork mints a FIXTURE fid on every deployment unless `PERSONA_FID_LIVE_ONLY=true` (default false, `.env.example:34`) — no dev gate on the fork route.
- `lib/fc/writes.ts:306-309` — `if (writeEnabled() && rec.mode === "live" && creds.signerUuid) live… ; return { t: fixtureTransportAs(creds.fid), creds }` — a fixture record, or a live record whose `signer.uuid` is empty/undefined (a `self-custody` record on live, or a record injected/handed without `uuid`), goes to the sim regardless of `isLiveContent()`/`writeEnabled()`.
- `lib/fc/writes.ts:346-351` — the existing guard fires only for the throwaway path (`isLiveContent() && !writeEnabled()`), and `transportFor` never consults `isLiveContent()`.
- `app/api/fc/write/route.ts:120` — the response carries `mode: "fixture"`, but the composer does not surface it; the attribution row is written as for a real publish.

**ATTACK.** Live deployment (`DATA_SOURCE=neynar`, `ENABLE_FC_WRITE=true`). The user forks a persona (product action). The new persona casts: the UI toasts success, the attribution index records it, nothing reached the network — the exact failure the FC pass named "the worst available behaviour".

**FIX.** In `transportFor`: if `isLiveContent()` and the record's `mode !== "live"` (or a live record lacks a usable signer), throw `FcIdentityError` ("this persona's account is fixture/pending — refusing a sim write under live content") or route through the SHARED throwaway with attribution (D-FID-3-NO-FID-CASTS-SHARED already prescribes that for fid-less personas; a fixture-fid persona on live is the same case). Default `PERSONA_FID_LIVE_ONLY` to `true` when `DATA_SOURCE=neynar`.

---

### 12. MED — The live acquisition needs `ZK_DEV_HOOKS=true` on the app, which opens every rig action; `/api/dev` is never gated at all; nothing considers `NODE_ENV` (goal d — "a dev hook in production")

**EVIDENCE.**
- `app/api/fc/persona/route.ts:85` — one gate for `custodySign`, `acquire`, `forget`, `setNetworkMode`, `setCustody`, `recordLiveFid`, `recordFidSpend`, `fidSpend`, `injectFidRecord`. The three the user's command needs (`:87-97,116-130`) are behind the same flag as the four that subvert the rules (`:98-115,134-142`).
- `scripts/fid-acquire.mjs:23` — "the app must be up with ZK_DEV_HOOKS=true"; `scripts/live-fid2.mjs:4` likewise.
- `app/api/dev/route.ts:18-19` — no flag check: `resetSeed` (finding 2), `tamperState` (`:292-314` — can rewrite `xSpend`/`fcAttribution`/`fcWrites` rows), `setDataSource` (`:354-364` — flips to live content at runtime), `issueTestDelegation` (`:316-341` — signs a device delegation for any supplied key: a second device in one request), `simulateDeviceLoss` (`:176-201`).
- `app/api/zk/route.ts:35,91-93` and `validator/zk.js:84` — plain string equality, no `NODE_ENV === "production"` refusal; a `next build && next start` with the flag set serves all of it.
- `SECURITY-POSTURE.md` A-DEV-SURFACE covers "one user on one host"; it did not contemplate that the live-money command REQUIRES the surface open.

**FIX.** Split the gate: a distinct `FID_ACQUIRE_ENABLED=true` (or a one-time token the app prints at boot and the script must present) for `custodySign`/`recordLiveFid`/`recordFidSpend`; keep `ZK_DEV_HOOKS` for the rig; refuse `ZK_DEV_HOOKS` when `NODE_ENV === "production"` on both processes; gate `resetSeed`/`tamperState`/`issueTestDelegation` behind the rig flag.

---

### 13. MED/LOW — Forking a PRIVATE persona mints a PUBLIC persona with a fid whose fname is derived from the private handle (goal e — "get a private persona a fid")

**EVIDENCE.**
- `app/api/identity/fork/route.ts:93-104` — no `kindOf(fromPersona)` check; `:110-119` — `kind: "public"` hard-coded, `handle: body.newHandle ?? \`${source.handle}_2\``, `bio`, `avatarUrl`, `cluster` copied from the source.
- `:171-177` — `acquireFixtureFid(created.id)` → `lib/fc/acquire.ts:105` `fname: fnameFromHandle(handleOf(created.id))` → `<privatehandle>-2`; the live command's `signerProbe` (`app/api/fc/persona/route.ts:62-63`) derives the same default fname.
- `lib/identity/keystore.ts:374-391` — the new persona is a real own persona; its `forkedFrom` (the private one) is owner-only, but the fname and bio are network-public.

**ATTACK.** Fork `persona_viewer_alt` (private, `backyard_scope`): a public account `@backyard-scope-2` with the private persona's bio appears on the network, and "the network never learns a private persona exists" (D-FID-1-PRIVATE-FIRST) is contradicted by its own fork.

**FIX.** Refuse to fork a private persona into a public one in per-persona-fid mode (or mint the fork `private`, no fid); never default a fork's fname/bio from a private source.

---

### 14. LOW — `custodySign` will sign a `Transfer` for ANY `fid` and `nonce` with a deadline up to 7 days; a `SignedKeyRequest` for any `requestFid` (goal c — sound on `to`/`key`, loose elsewhere)

**EVIDENCE.** `lib/fc/custodySign.ts:61` pins `to` to the persona's own address (sound); `:62-64` `fid`/`nonce` are only shape-checked, `deadline ≤ now + 7d` (the script uses 1 h, `fid-acquire.mjs:137`); `:80-91` pins `key` to the persona's own signer (sound), `requestFid` free — harmless because the on-chain validator binds the request signer to `custodyOf(requestFid)`.

**ATTACK (hypothesis, chain-level).** IdRegistry allows one fid per address. With dev hooks, obtain `signCustodyTransfer(persona, {fid: X, …})` for a fid X the attacker owns and execute `transfer(X, custody, deadline, sig)` on-chain: the persona's custody address now holds X, the persona's own sponsored registration will revert (`HasId`), and `recordLiveFid` would accept X as the persona's fid (finding 4's binding gap) — the app then treats a fid it did not create as its own. Low because it needs an attacker fid, gas, and dev hooks; listed because the signature is the only thing the app contributes and it is unconstrained.

**FIX.** Refuse `signCustodyTransfer` when the persona already has a fid record; cap `deadline` to 1 h; optionally require the `fid` to match a value the app itself reserved (move the reservation into the app so the signature is minted against a fid the app asked for).

---

### 15. LOW — `delete` on the write door has no persona ownership check; an act-as reply by a fid-less persona to a NETWORK target takes the local door and never reaches the network (goals e, g)

**EVIDENCE.** `app/api/fc/write/route.ts:144-155` — `deleteFcCast(hash, { personaId: attributed ?? body.personaId })` with no `SEED_VIEWER`/`isOwnPersona` check (cast/like/follow have one at `:82-84,129,139`); the record decides the fid, so reach is bounded by findings 4/6. `app/api/actions/act-as/route.ts:89-105` — the write door only for a persona WITH a fid record; `:107,174-193` — otherwise a local cast with a text marker, `ok: true`, for a target that is a real network cast — a fid-less (pending-live) persona's reply silently never posts, while the same persona's top-level cast goes through the shared account (D-FID-3-NO-FID-CASTS-SHARED). Also `app/api/fc/write/route.ts:152-153` deletes the attribution row for an ADVISORY delete (a hub may retain the cast; our index forgets who wrote it).

**FIX.** Ownership check on `delete`; route fid-less personas' network replies through the shared account like their casts (or refuse with a reason).

---

### 16. LOW (cross-cutting; the operator-view reviewers' territory) — the validator sees every persona↔fid pair of a root in ONE device-signed plain document, readable by anyone

**EVIDENCE.** `lib/fc/personaFid.ts:76-79` — `flush(MAP_NS, map)` writes `{ personaA: {fid}, personaB: {fid}, … }` as one namespace; `lib/adapters/mock/persist.ts:257-268` — under `LAYERS_REQUIRE_SIG` the PUT carries `x-layers-device`; `validator/server.js:369-377` — `GET /state/:namespace` has no gate, so `GET /state/personaFidMap` hands the table to any caller. `fcAttribution` (`persist.ts:96`, not in `VAULT_NAMESPACES`) is likewise plain and device-signed. D-FID-1-PLAIN-MAP argues each pair is public; the DOCUMENT is per device (= per root), so the operator links the two live fids to one root before any proof machinery runs — the thing Gate 5's linkage v4 must fail to do. Not new to this pass (the FC pass's attribution table had the same shape), but this pass puts real Farcaster accounts into it.

**FIX.** Either seal the map (attribution rendering can read it client-side like every other vault fact) or write one record per persona through the anonymous channel / per-persona envelope; gate `GET /state/:ns` for plain namespaces the way `/zk/eligibility` is gated.

---

### 17. INFO — Key-material leak review (goal f): the pass is clean on the paths I could trace; three notes

- `redact()` (`app/api/fc/persona/route.ts:24-27`) replaces the uuid with `"<vault>"` for `neynar-managed`; `GET`, `acquire`, `recordLiveFid` all go through it. `identityProbe` returns fid/persona only. `signerProbe` returns public material. The uuid rides only `POST recordLiveFid` (script → app, plaintext HTTP on `BASE`, `fid-acquire.mjs:35,73` — an env `APP_URL`/`BASE_URL` pointing elsewhere sends the uuid there; LOW). Ledger notes carry text prefixes and fids, never uuids (`lib/fc/writes.ts:447,466,493,519`). Live transport errors carry status codes only (`:235,247`). `keyMaterialForLeakTest` includes both new branches (`lib/identity/keystore.ts:337-339`).
- `.env.local` (names only) contains `FC_TEST_CUSTODY_PRIVATE_KEY`: the throwaway's raw custody key sits in the APP process environment (Next loads `.env.local`), read by nothing in the app (`grep`: only `scripts/live-att1.mjs:24-32`, `scripts/gate1-acquire-fid.mjs`). Harmless today; it is a second loaded gun beside `NEYNAR_SIGNER_UUID` that `assertFcWritePreconditions` does not look for. Move it out of the app's env file.
- `GET /api/fc/persona` (`:29-37`) hands the whole persona→fid→custody-address→registrant table (uuid excepted) to any unauthenticated caller; `GET /api/anon?castHash=&envelope=1` (`app/api/anon/route.ts:46,54-58`) hands the nullifier (a linkage handle) under dev hooks. Both under A-DEV-SURFACE.
- `throwawayCreds()` (`lib/fc/writes.ts:55-60`) accepts a non-integer `FC_TEST_FID` (`Number("3.5")`); cosmetic — use `Number.isInteger`.

---

### 18. INFO — The ledger records the ESTIMATE, not the bill; `established` is tautological

`scripts/fid-acquire.mjs:168` records `sheet.rows[…].usd ?? 0.9` with the note "ESTIMATE"; `lib/fc/acquire.ts:74` `established: rows.every(r => r.usd !== null)` is always true because the register row's `usd` is the estimate number. The $10 cap is therefore enforced on paper against a figure the pass cannot read (REPORT-FC found the same). ASSUMPTION worth an id: "the cap counts `FID_CREATE_USD_ESTIMATE` per registration; the true ETH figure is reconciled by hand on dev.neynar.com after each live run".

---

### 19. INFO — The pass's own live script publishes permanent public edges between the two persona fids

`scripts/live-fid2.mjs:130-153` — B follows A, B likes A's cast, B replies to A's cast; `:155-162` deletes are advisory (follows and likes are not deleted at all). These are exactly the "follow graph, cast timing" signals linkage v4 lists as operator-visible AND public-network data. The other two reviewers own this; noting that the code creates the linkage deliberately.

---

## Checklist — goals (a)–(g)

| goal | verdict | the line that refuses it (where sound) / the finding (where not) |
|---|---|---|
| (a) write as a fid the app did not create | **NOT SOUND** under the live run's own preconditions | Sound for a plain request: `lib/fc/writes.ts:134-139` (fid without a record → refused), `:131` (foreign origin → refused), `:126,128,141` (fid/signer mismatch → refused), `:112-118,339-345` (foreign `NEYNAR_SIGNER_UUID` in env → every write refused). Broken by finding 4 (`injectFidRecord` + origin-string trust), finding 5 (the validator relays with any env signer, no rule at all), finding 1 (a seeded persona's real fid is writable by anyone with the repo), finding 6 (a lost record silently downgrades a persona to the throwaway). |
| (b) spend past $10 / third live fid | **NOT SOUND** | Sound for a single honest run: `scripts/fid-acquire.mjs:81,88-89,97-98` (arg count, live count, sheet under cap, dry run by default), `lib/fc/acquire.ts:129-130` (≤ 2 live at record time), `lib/x/spend.ts:132-136` (cap at record time). Broken by finding 2 (`resetSeed` zeroes both counters), finding 3 (no check-before-retry: a re-run double-creates; spend recorded after the call), finding 9 (cap is an unclamped env knob, NaN fail-open). |
| (c) custody signature to an address the persona does not own | **SOUND** | `lib/fc/custodySign.ts:61` (`to` must equal the persona's derived address; the signature is then built over `addr`, not the input), `:85` (`key` is the persona's own derived signer key). Loose: finding 14 (`fid`, `nonce`, 7-day deadline); and finding 1 means "the persona's own address" can be a public-constant address for seeded personas. |
| (d) unauthorised anon cast | **MOSTLY SOUND**, two gaps | Tampered payload: `validator/zk.js:571` (re-hash mismatch → 400). Re-hashed cast: `:264-269` + `:587-594` (message binds `cast:<castHash>`; the proof/tag covers it). Persona on the signal: `:567` and `:574`. Foreign tree: `:268`. Client-supplied persona id: none — `app/api/anon/route.ts:28-33` takes only `text`; `lib/zk/prove.ts:90-96` enforces the constant. `force`: `app/api/anon/route.ts:32` dev-only, and `:619-621` refuses the second by nullifier — **only within one epoch** (finding 7). Live cap: `:637-638` — racy and NaN-open (finding 8). No arming flag on the relay path (finding 5). Dev hooks in a production build: finding 12. |
| (e) private persona gets a fid / cast under another persona's fid / act-as through the wrong door | **SOUND** for the direct cases | Private: `lib/fc/acquire.ts:93` (refused as private before ownership), `:126` (live). Another persona's fid: `lib/fc/writes.ts:305-309` (the acting persona's OWN record decides), `:126` (a named fid must be that persona's). Act-as door: `app/api/actions/act-as/route.ts:64-66` (allowlist), `:89-92` (own fid via `publishFcCast({personaId: asPersonaId})`). Gaps: finding 13 (a fork of a private persona is public with a private-derived fname), finding 10 (same text → folded into the other persona's cast on fixture), finding 15 (fid-less reply to a network target goes local). |
| (f) key material leak | **SOUND** on the paths traced | `app/api/fc/persona/route.ts:24-27` (`redact`), `lib/identity/keystore.ts:181-225` (derive-use-drop, keys never cross the module), `:337-339` (both new seeds in the leak needles), `scripts/fid-acquire.mjs:27,145` (uuid withheld from stdout). Notes in finding 17. |
| (g) fail-closed | **NOT SOUND** | Sound: `lib/fc/writes.ts:338-362` (write preconditions), `:412-421` (a failed verify never re-sends), `:426-435` (a live receipt outside the window refuses), `lib/vault/vault.ts:140-146` (wrong key throws), `lib/fc/writeLedger.ts:20-26` (NaN-proof caps). Broken by finding 6 (`personaFid.load` swallows failure into an empty cached doc that later overwrites the vault), finding 11 (fixture/pending records and live records without a signer fall to the sim under live content), findings 8/9 (NaN env → cap disabled), finding 3 (ambiguous registration → double create), finding 2 (reset → counters open). |

**Top five, in order:** 1 (public custody key on a real fid for seeded personas), 2 (`resetSeed` erases the money-rule counters and the sealed uuids), 3 (no check-before-retry in the live command; `FID_RESUME_FID` is fiction), 4 (`injectFidRecord` + origin-string trust lets the app write with any signer the key holds, under the flag the live run requires), 5 (the validator relay has no identity rule, no author check, no arming flag).
