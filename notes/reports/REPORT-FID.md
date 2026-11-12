# REPORT-FID — Multi-FID pass: one real Farcaster account per persona + anon posting

**Run:** started 2026-09-08 19:30, from commit `7fc5d14` (attestation pass
closed: four consecutive clean sweeps, 427/427 checks). Prompt:
`notes/prompts/multi-fid-prompt.md`. Checkpoints in `notes/reports/RESUME.md`; the closing summary in
`notes/runbooks/MORNING.md`. Max 20 iterations (G0: 3, G1: 5, G2: 3, G3: 3, G4: 4, G5: 2).

**Decisions fixed by the prompt, not relitigated:** hard cap $10 real
spend, at most TWO persona FIDs created live, dry-run cost sheet before any
creation; the identity rule extends to the FIDs this pass creates; the
onchain protocol-history set is Aave, Morpho, Compound, Uniswap.

**Decisions this pass makes, by id (the more conservative option, written
down):**

| id | decision |
|---|---|
| D-FID-0-VPN | `x.account-region` REFUSES when X flags the location with a VPN caveat — a weak fact is not signed at all (not a caveated bucket) |
| D-FID-0-RENAMED | `x.account-age` supports NO bucket for an account that ever changed its username — "zero username changes" is part of the claim, so a renamed account is not an older account with a footnote |
| D-FID-0-REGION-DISAGREE | two bound X accounts that map to different macro-regions yield no region bucket (the narrower claim), never the first one's |
| D-FID-0-AGE-FAMILY | the prompt's OR-gate names "X account age ≥ N with zero username changes", which is not a region fact: it is issued by a sibling id `x.account-age` in the same `x.*` family (same web-proof source, same key), not folded into `x.account-region` |
| D-FID-0-SIGNER-VOUCH | `neynar.score` on live vouches for a fid's signer only when THIS client registered that signer for one of its own persona fids (Gate 1); any other fid is refused — a KeyRegistry lookup is a later pass (A-FID-SIGNER-LOOKUP) |
| D-FID-0-WEBPROOF-LIVE | the live web-proof adapter is a refusal until a verifier exists (zkTLS or the extension) — nothing is issued from a fact nobody verified (A-FID-WEBPROOF-LIVE) |
| D-FID-0-ONBOARDING-EFFECT | clearing the OR-gate makes a persona ELIGIBLE for the gated discovery surface below the gate tier; it does not change the tier shown (a badge is a proof or nothing) |
| D-FID-0-BOOT-LOCAL | the boot check refuses a port disagreement only for a LOCAL validator URL (localhost / 127.0.0.1 / ::1); a remote validator's port is its own |

**Status:** Gate 0 GREEN (`0b9b219`, 2 iterations) · Gate 1 GREEN (`cb7f06e`, 3 iterations) · Gate 2 GREEN on fixture (3 iterations; the live half awaits the user's command) · Gate 3 GREEN on fixture (2 iterations) · Gate 4 GREEN on fixture (2 iterations; full sweep 467 checks, z3 rig state re-run clean, z9 finding → Gate 5) · Gate 5 GREEN (2 iterations) · **/verify CLOSED — bar met on `526addf`: four consecutive clean sweeps, 478/478 checks, 64/64 suites, zero infra, four times.**

---

## GATE 0 — Housekeeping + onboarding issuers

**Built (iteration 1):**

- `.env.local`: `VALIDATOR_URL` / `NEXT_PUBLIC_VALIDATOR_URL` → `:4001`
  (the MORNING item; two lines, values never echoed). **Boot check**
  (`scripts/start-app.mjs`): the launcher reads the env and `.env.local`,
  and refuses to start (exit 2, named reason) when a local validator URL's
  port disagrees with `LAYERS_VALIDATOR_PORT`; `LAYERS_BOOT_CHECK_ONLY=1`
  runs the check without spawning Next (the suite's oracle);
  `LAYERS_ENV_FILE` points it at another env file (the suite's stale-file
  case).
- **Demo wallet:** on FIXTURE chain facts, `requestIssuance` with
  `demoWallet: true` binds the seeded wallet `ATTEST_DEMO_WALLET_SEED`
  (default `layers-chain-wallet/0`: first tx 2019, 2.5 ETH, Aave/Morpho/
  Uniswap, 7 votes) by minting the issuer's challenge and signing it
  server-side — the reference issuer demonstrably issues without a browser
  wallet. Refused on live chain facts. Thresholds untouched.
- **Protocol set:** `TRACKED_PROTOCOLS` reads `ATTEST_PROTOCOLS` (comma
  list) with the default Aave, Morpho, Compound, Uniswap; Aerodrome was
  already out.
- **Shared issuer plumbing:** `lib/attest/challenge.ts` (the issuer-minted,
  single-use, ten-minute challenge every identity-binding issuer uses) and
  `lib/attest/retention.ts` (salted-hash retention per family, one identity
  → one root) moved out of the onchain issuer; onchain's behaviour, file
  and hash domain are unchanged.
- **Web-proof seam** (`lib/attest/webproof/*`): `WebProofAdapter`
  (`xAbout(proof)` → based-in at the owner's granularity, VPN caveat, join
  date, username changes; fixture cohort facts by index). Fixture replays
  `seed/data/x-about.json` for a proof of the form
  `fixture-webproof/1|<handle>`; live refuses (D-FID-0-WEBPROOF-LIVE).
- **FID-facts seam** (`lib/attest/fid/*`): `FidFactsAdapter` (`facts(fid)`
  → Neynar score; `signerPublicKey(fid)` → the key the adapter vouches
  for; fixture cohort scores by index). Fixture: scores from
  `fixtures/neynar/user-bulk.json`, a signer per fid derived from a fixture
  constant (`sha256("layers-fid-signer/<fid>")`). Live: the Neynar user
  lookup (read-only), signer vouching through the persona ↔ FID map hook
  Gate 1 installs (D-FID-0-SIGNER-VOUCH).
- **Issuers, behind the existing `AttestationIssuer` interface:**
  * `x.account-region` (key `x`): buckets `americas | europe |
    asia-pacific | africa-middle-east` from X's "based in" at either
    granularity (a country→macro-region table; unknown values refuse);
    refuses on a VPN caveat; the claim value keeps granularity, value and
    caveat. Validity 28 epochs.
  * `x.account-age` (key `x`): `gte-1y-stable | gte-2y-stable |
    gte-4y-stable` (nested) — join date AND zero username changes;
    several accounts aggregate to the oldest stable one. Validity 28.
  * `neynar.score` (key `neynar`): `score-gte-0.7 | score-gte-0.9`
    (nested); the fid's signer signs the challenge (Ed25519, small-order
    keys refused); several fids aggregate to the max score. Validity 4.
  All three: one identity → one root (retention), cohort furniture on
  fixture for the decoy crowd, honoured by KEY by default
  (`x.*@<key>`, `neynar.*@<key>`), rendered in the backpack as attested
  claims (region → demographics; age and score → ownership).
- **OR-gate onboarding** (`lib/attest/onboarding.ts`): a disjunction over
  (issuer pattern, buckets) — default `x.account-age/gte-2y-stable+`,
  `neynar.score/score-gte-0.7+`, `onchain.wallet-age/gt2y+`, `pop.*/any`;
  `ONBOARDING_GATE` (JSON) overrides. `clearsOnboarding(proven)` reads the
  PROVEN attestation list (honoured issuers, this epoch, floor-checked
  before the proof was built) and the discovery gate's `isEligible` honours
  it below the gate tier (D-FID-0-ONBOARDING-EFFECT). Probes:
  `onboardingProbe`, `eligibilityProbe`, `attestConfig`.
- Suite `scripts/accept-fid0.mjs` (`test:fid0`, 8 checks); joined the
  sweep list.

| iteration | result |
|---|---|
| 1 | tsc strict clean, build clean; `test:fid0` **6/8** — checks 1–6 green on the first run (boot check, config, demo wallet, both X issuers, the Neynar score issuer). #7/#8 failed for two RIG reasons, found with probes against the live servers: (a) the suite seeded its 120 decoys and issued the cohort in the same epoch, but decoys join the `valid` tree NEXT epoch, so every cohort issuance found no crowd (`cohortAttested: 0`) and the x buckets held one leaf — att2 advances an epoch after seeding; the suite now does too; (b) `onboardingProbe` read the proven-attestation cache without refreshing it (the feed build refreshes; the probe did not) — `onboardingStatusFor` now makes the same fresh gated read first |
| 2 | rebuilt; `test:fid0` **8/8** — after the advance the census shows gte-1y-stable 79, gte-2y-stable 55 (both above the floor of 50), gte-4y-stable 13 (thin, by design), MAIN's proofs into both stable-age buckets accepted, nullifiers distinct per bucket and per issuer, MAIN clears the OR-gate by `x.account-age/gte-2y-stable` and is discovery-eligible at tier 0, ALT is neither. Regression set (att1–att4, z0, z8, z9, runner, bp, g2) run before the gate commit |

**Gate 0 exit — met:** the boot check refuses a mismatched port (env
and `.env.local`, exit 2, named reason); the fixture demo wallet issues
three wallet-age buckets and two holdings buckets; `x.account-region`,
`x.account-age` and `neynar.score` issue on fixture and their scopes
collide with nothing; the OR-gate tests are green. Committed as
`fid: gate 0 green (8/8)` = `0b9b219`.

---

## GATE 1 — Persona ↔ FID model + signer custody

**Decisions, by id:**

| id | decision |
|---|---|
| D-FID-1-LIVE-CREATION-BY-USER | creating a real Farcaster account is the USER's action: this pass ships the capped, dry-run-first, one-command path (`scripts/fid-acquire.mjs`, Gate 2) and the app seals the receipt; the app never creates an account and never spends by itself |
| D-FID-1-ONCHAIN-FALLBACK-NEVER | the onchain registration fallback is a chain transaction from a funded key — never executed by this session; if Neynar sponsorship is unavailable the question goes to notes/runbooks/MORNING.md, as the prompt allows |
| D-FID-1-CUSTODY-KEY-DERIVED | a persona's fid CUSTODY key is derived from the root (`fc-custody/<nonce>`), like its signer (`fc-signer/<nonce>`): recovery re-derives both; the address is public material, the private key is derived, used and dropped |
| D-FID-1-PLAIN-MAP | the validator learns `{ personaId → fid, fname }` in a PLAIN namespace (a public persona's own public account is not a secret); everything else about the account — custody address, signer reference, registrant, funder — is one sealed, padded vault record |
| D-FID-1-PRIVATE-FIRST | acquisition refuses a private persona AS PRIVATE before it checks ownership: the network never learns a private persona exists, whoever holds it |
| D-FID-1-WRITE-DOOR-OWN | the write door admits any persona this device holds (a minted one too); a PRIVATE persona never gets its own fid but still posts through the SHARED account exactly as in the FC pass (the network sees only that account, attribution stays disclosure-gated — "unchanged"); a persona this device does not hold is refused. An earlier reading refused private personas at the door and broke the FC pass's own suites (fc4 #1/#2, fc5) — reverted |
| D-FID-1-SECOND-PUBLIC-PERSONA | the seeded viewer's second persona (ALT, `backyard_scope`) is PRIVATE by seed, so the fixture's second public account is a minted persona (a fork carrying nothing), exactly as the crypto pass's recovery rig mints one |

**Built (iteration 1):**

- `PERSONA_NETWORK_MODE = per-persona-fid | shared-fid` (default
  per-persona-fid; `lib/fc/networkMode.ts`; rig override; resets with
  the seed). shared-fid is the Pass-FC v0 kept for anon-post mode.
- **The persona ↔ fid map** (`lib/fc/personaFid.ts`): vault namespace
  `personaFids` (one sealed, padded record: fid, fname, origin, custody
  address, signer reference, registrant, funder, mode) + plain namespace
  `personaFidMap` (`{ personaId → fid, fname }`, D-FID-1-PLAIN-MAP). One
  persona ↔ one fid enforced on write. Fixture fids are `9,000,000 + n`.
- **Signer derivation** (`lib/crypto/kdf.ts`, `lib/identity/keystore.ts`):
  `fcSignerSeed` (`fc-signer/<nonce>`, Ed25519 — Farcaster signers are
  Ed25519, no curve mismatch) and `fcCustodySeed` (`fc-custody/<nonce>`,
  secp256k1 via viem); `fcSignerPublicKey`, `signAsFcSigner`,
  `fcCustodyAddress` derive-use-drop inside the keystore; both private
  seeds joined the leak-test needles.
- **`SignerCustodyAdapter`** (`lib/fc/custody/*`): `neynar-managed`
  (fixture: a simulated managed signer per fid; the documented
  compromise text is the adapter's own `compromise` field) and
  `self-custody` (fixture: a simulated KeyGateway add of the DERIVED key,
  flagged simulated; live is Call Option A, a chain transaction this
  build refuses to send). `FC_SIGNER_CUSTODY` selects; rig override.
- **Acquisition** (`lib/fc/acquire.ts`): the cost sheet (per persona:
  fname availability 1 credit, managed signer 2 credits, sponsored
  registration $0.90 assumed — the top of REPORT-FC's measured
  $0.35–$0.90; `FID_CREATE_USD_ESTIMATE`), the pass cap
  `FID_SPEND_CAP_USD` (10) checked against the SAME spend ledger
  (`lib/x/spend.ts` gained `fid_create | fid_signer | fid_fname` kinds,
  `recordFidSpend`, `fidSpentLive`, `assertFidSpendAllowed`; fixture
  entries are $0 by construction with the estimate in the note); fixture
  acquisition mints the fid, fname from the handle (protocol grammar),
  registrant = funder = the sponsor; `recordLiveFid` validates a live
  receipt (origin `layers-fid-pass`, ≤ 2 live fids, the derived signer
  key and custody address must be this persona's) before sealing it.
- **Registrant-linkage assertion** (`lib/fc/linkage.ts`, safety set): no
  two persona fids share a registrant, funder or custody address that is
  not the sponsor; findings by kind and fids.
- **The identity rule, extended** (`assertOwnFidIdentity` in
  `lib/fc/writes.ts`): allowed = the throwaway ∪ persona fids whose
  record origin is this pass's path (fixture, layers-fid-pass); a fid
  named with the wrong signer, a record of foreign origin, a persona
  named with another persona's fid, and a foreign signer in env are all
  refused. The write module's `transportFor(personaId)`: in
  per-persona-fid mode a persona with a fid posts as itself (fixture: the
  sim network tags the cast with its fid; live: Neynar's managed signer
  for that fid), otherwise the shared path exactly as before; the write
  ledger records the acting fid; `reactFc`/`deleteFcCast` take the
  persona too (a delete goes out under the attributed persona's fid).
  Also normalized here: the content-hash separator that had been a raw
  NUL byte in the source since the first commit (byte-identical as an
  escape; the file is text again).
- **The write door** (`app/api/fc/write/route.ts`): D-FID-1-WRITE-DOOR-OWN-PUBLIC.
- **The persona surface** (`app/api/fc/persona/route.ts`): GET (mode,
  custody, the plain map, records with the signer uuid redacted);
  product actions `costSheet`, `signerProbe`, `registrantLinkage`,
  `identityProbe`; rig actions `acquire` (fixture), `forget`,
  `setNetworkMode`, `setCustody`, `recordLiveFid`, `recordFidSpend`,
  `injectFidRecord` (negative cases only).
- Suite `scripts/accept-fid1.mjs` (`test:fid1`, 10 checks); joined the
  sweep list.

| iteration | result |
|---|---|
| 1 | tsc strict clean, build clean; `test:fid1` **2/10** — one substantive cause and one rig cascade. Substantive: the seeded viewer persona's keys come off its FIXTURE root (`lib/identity/fixtureRoots.ts`, nonce = the persona id), not the keystore, so `fcSignerPublicKey(MAIN)` returned null and `isOwnPersona(MAIN)` was false — acquisition refused MAIN as "not one of this root's personas". Fixed by dispatching the new derivations exactly as persona sign keys are dispatched (`fcSignerPublicKeyFor` / `fcCustodyAddressFor` in `lib/identity/keys.ts`: keystore, else fixture root) and by an `isViewerPersona` test (keystore-minted, or one of the seeded viewer's own). Rig: check 5 threw before recovery ran (a null-equals-null false alarm), which left the device wiped for every later check (500s and "signed-envelope bootstrap failed"); the recovery check now runs `recover` in a `finally` and judges the ROOT-derived minted persona, with the seeded persona's fixture-root keys asserted stable instead |
| 2 | rebuilt; the first re-run crashed in the prelude: `resetSeed` 500 with "signed-envelope bootstrap failed" — iteration 1's crashed device-loss check had left a NEW blank root on disk (`root.json`/`device.json` re-minted) whose device-auth anchor the validator refuses, first-write-wins (the c0 contract doing its job), with the old root's sealed namespaces unreadable. Rig repair, validator stopped: cleared `device_auth` (1), `devices` (191), `envelope_counters` (4110), `adapter_state` (8); restarted. `test:fid1` **10/10**: two distinct fixture fids for MAIN and a minted public persona, the private persona refused as private, deterministic signers and custody addresses (MAIN's off its fixture root, the minted persona's off the phrase), total-device-loss recovery reproducing the minted persona's keys and the map, custody switching (self-custody = a simulated KeyGateway add of the derived key), registrant linkage clean and flagged on injection, the identity rule refusing a third-party fid / a foreign signer / a foreign-origin record / a persona named with another's fid, the write door posting under each persona's own fid and refusing the private persona, the validator's plain map holding only fid + fname while the record namespace is ciphertext, the reset contract. Regression (functional, fc2–fc5, c0–c4, x1–x4, fid0, runner): two findings, below |
| 3 | Regression findings. (a) fc4 #1/#2 and fc5 #1: the FC pass's own suites cast as the PRIVATE persona through the shared account, which my write door had started refusing — the wrong reading of "unchanged": a private persona never gets its OWN fid (acquisition refuses it) but still posts through the shared account, the network seeing only that account and attribution staying disclosure-gated. Refusal removed (D-FID-1-WRITE-DOOR-OWN), fid1 #9 re-judged. (b) fid0 #3–#8: every identity-binding issuer refused with "already vouches for another root" — the retention files (salted identity → commitment bindings, 28-epoch validity) still bound the fixture wallet, the X handles and fid 3 to the OLD root's commitment after the rig repair re-minted the root. In a sweep the root is constant; but `resetZk` says the universe forgot every commitment, so the bindings are moot with it: `clearRetention()` now runs in the resetZk hook. Rebuilt; re-run: **fid0 8/8, fid1 10/10, fc4 6/6, fc5 6/6** — with the earlier functional, fc2, fc3, c0–c4, x1–x4 and runner, the regression is green; tsc strict + build clean |

**Gate 1 exit — met (fixture):** two personas map to two distinct fids;
signer derivation deterministic and recovery-reproducible; the custody
adapter switches by config; the registrant-linkage assertion is green;
the identity rule refuses a third-party fid's credential. Committed as
`fid: gate 1 green (10/10)` = `cb7f06e`.

---

## GATE 2 — Live: two real persona accounts

**The shape of this gate under this session's rules.** Creating a real
Farcaster account is the user's action (D-FID-1-LIVE-CREATION-BY-USER), so
Gate 2 ships everything up to that line and everything after it:

- `scripts/fid-acquire.mjs` (`npm run fid:acquire <personaId> [<personaId>]`)
  — the user's command. Dry run by default: prints the itemized cost
  sheet from the app's own ledger view (fname availability 1 credit,
  managed signer 2 credits, sponsored registration $0.90 assumed per
  persona) and makes no billable call. `FID_ACQUIRE_CONFIRM=yes` creates:
  fname availability → reserve a fresh fid (10-minute window) → the app
  signs the IdRegistry `Transfer` for the persona's OWN derived custody
  address (`custodySign`; the key never leaves the app) → a Neynar managed
  signer → `POST /v2/farcaster/user` sponsored registration (Neynar is the
  registrant and funder for everyone — the registrant-linkage rule holds
  by construction) → the receipt handed to `recordLiveFid` (validated:
  origin `layers-fid-pass`, ≤ 2 live, the derived keys must be this
  persona's) and the spend itemized through `recordFidSpend` — with the
  ETH figure recorded as the sheet's estimate and marked as such (the
  exact number lives only on dev.neynar.com; REPORT-FC found the same).
  Aborts above the cap, before any network call without credentials, and
  when the reservation is about to lapse.
- `lib/fc/custodySign.ts` + the `custodySign` action: EIP-712 signatures
  by the persona's custody key, pinned to two shapes only — a `Transfer`
  to THIS persona's own custody address, a `SignedKeyRequest` for THIS
  persona's own derived signer key (Call Option A); everything else
  refused. Signing itself lives in the keystore (`signCustodyTypedData`,
  derive-use-drop) with the fixture-root twin for seeded personas.
- **The three-way view.** (a) the network: a persona's cast sits under
  ITS fid with no persona in the record (fixture: the sim network; live:
  farcaster.xyz). (b) our client, non-granted viewer: the bare persona.
  (c) our client, granted viewer: the MERGED identity — `mergedAuthorFor`
  (the same `resolveIdentity` the profile page uses, whitelist/opt-in
  tiers only) rides the attribution payload (`merged`, `linked`) and is
  applied in one final pass over every persona-authored feed card and in
  the classic persona layer; `CastCard` draws a split avatar
  (`cast-split-avatar`) and "name / linked" (`cast-merged-identity`).
- **Act-as from the timeline:** a reply as persona B to a NETWORK cast
  (sim or live) goes through the FC write door under B's own fid
  (`publishFcCast` with the persona), is ledgered and attributed to B;
  the picker lists minted personas too. Seed/local targets keep the
  local path.
- **Follow** joined the write door (`followFc`, kind `follow`, counted
  against the actions cap; live = Neynar follow under the acting
  persona's managed signer).
- `scripts/live-fid2.mjs` (`npm run live:fid2`) — the live recorder, run
  once by hand after the user's acquisition: refuses without
  `ENABLE_FC_WRITE=true` and two live records; then one labeled test
  cast per persona, the three-way screenshots (`shots/fid-live-*.png`),
  follow, like, the act-as reply, deletes (advisory), everything itemized
  in `research/live-fid2.json` (hashes, URLs, fids, fnames — no keys).
- Suite `scripts/accept-fid2.mjs` (`test:fid2`, 10 checks, fixture; in
  the sweep list): the network view, both viewer contexts, the cast card
  under Playwright, the write-door act-as, the picker, custody signatures
  recovered to the custody address, the live command's dry run and its
  credential-less abort, follow/like/delete, the recorder's refusal.

| iteration | result |
|---|---|
| 1 | tsc strict clean, build clean; `test:fid2` **7/10** — three RIG defects, no product ones: (a) the suite's fetch helper carried no cookie, and "view as" is a request cookie (`lib/activePersona.ts`), so every viewer-scoped read ran as the default persona: the granted-viewer merge (#3) could not fire and the cast card (#4) was judged in the wrong seat — the helper now sends the `layers_view_as` cookie after each `viewAs`, as the FC suite does through Playwright's request context; (b) #4 also hit a product corner: act-as routed EVERY reply by a persona with a fid through the write door, seed-post targets included, so the local timeline never saw the reply — now only NETWORK targets (sim or live) take the write door; (c) #8 dry-ran the live command on MAIN, which already owned a fixture fid, and the command correctly refused — a third minted persona without a fid is the subject now |
| 2 | `test:fid2` **9/10** — one PRODUCT defect, found by the cast-card check once the viewer cookie reached it: the classic timeline resolves a cast's persona marker through the validator only (`personaFor` in `lib/policy.ts`), and the validator never learns a persona this client MINTED (a fork registers in the client's own registry and hands the validator a commitment, never the persona) — so a minted persona's local act-as reply rendered unresolved: no persona id, the marker leaking into the text, no merge for anyone. The resolver now consults the client's own persona registry first (projected to the route-handler shape, no rootId) and asks the validator only for an id the client does not hold. Attribution (#3) had been right all along because it never goes through that resolver |
| 3 | tsc strict clean, build clean; `test:fid2` **10/10**. Regression on the same build: functional ALL, fc2 7/7, fc3 7/7, fc5 6/6, fid0 8/8, fid1 10/10, c0 8/8, c4 7/7, g1 5/5, g2 4/4, g3 7/7, z8 7/7, runner 7/7; fc4 5/6 → its #4 enumerates the attribution payload's display keys and predates `merged`/`linked` — the check now admits the two display fields and asserts an UNGRANTED viewer receives `merged: false, linked: null` (re-run on the same servers: fc4 6/6) |

**Gate 2 exit — met on fixture; the live half is the user's action.** Everything the
gate names is built and asserted against the fixture universe: the network view
(a persona's cast under its own fid, a normal separate account), both viewer
contexts (bare for strangers, merged for the granted viewer, on the attribution
payload AND the rendered cast card), act-as through the write door under the
acting persona's fid, follow/like/delete as personas, custody signatures that
recover to the persona's own custody address, the capped one-command acquisition
(dry run: cost sheet, no billable call; armed without credentials: aborts before
any network call), and the live recorder's refusal without live records. The
two real accounts and the three-way screenshots are produced by the USER
(D-FID-1-LIVE-CREATION-BY-USER): `npm run fid:acquire <personaA> <personaB>`
(dry run first, then with `FID_ACQUIRE_CONFIRM=yes`), then
`ENABLE_FC_WRITE=true npm run live:fid2`. Total live spend so far: **$0.00**
(nothing created).

## GATE 3 — Fork → new FID, surface regression in both modes

**Decisions**

| id | decision |
|---|---|
| D-FID-3-FORK-MINTS | In per-persona-fid mode a fork mints the NEW persona's fid through the same spend-capped path the persona route uses: on fixture the fork itself mints (`acquireFixtureFid` for the new persona; `newFid` in the response), on live the new persona is `fidPending` until the user's `npm run fid:acquire` (`PERSONA_FID_LIVE_ONLY=true` forces pending on any rig). The OLD fid stays live as the decoy — no transfer, no rename, no key rotation between the two: any onchain relation between the old and the new account is exactly the linkage the fork exists to break. |
| D-FID-3-FORWARD-POINTER-CARRIES-FID | The forward pointer a carried holder resolves (`/api/identity/fork?resolve=`) now answers `movedFid` (fid + fname) beside the new persona — the account the holder should follow on the network. A dropped holder and a stranger learn neither the move nor any fid; the network sees two unrelated accounts. |
| D-FID-3-VALIDATOR-LEARNS-ONE-ENTRY | The validator's plain map gains `{ newPersona → fid, fname }` and nothing else — the fork record, the grants and the fid records stay sealed; no plaintext row relates the new fid to the old persona (asserted over its whole state). |
| D-FID-3-BLOCKS-CLIENT-SIDE | A block is a client-side read filter over persona ids (the classic feed's policy and the seeded feed's block set), never a network write: Farcaster has no block that a hub read honours, and a block that reached the network would itself be an attributable action by the blocker's account. The sim network keeps every cast a blocked persona made. |
| D-FID-3-SHARED-FID-UNCHANGED | Under `shared-fid` a fork mints nothing and pends nothing — the v0 path byte-for-byte; the surfaces (attribution, act-as options, profile) render identical persona chrome in both modes, only the fid under a cast changes. |
| D-FID-3-BLOCK-TARGET-OPAQUE | The validator's block row takes the BLOCKED id as an opaque string: the blocker must be a persona it holds, the target need only be well-formed. A persona this client minted (a fork) registers nowhere on the validator, and a block is a read-time filter in the blocker's own client — never a fact about the target, never a network write. (Iteration 1 finding: the validator answered 404 for a minted target.) |
| D-FID-3-NO-FID-CASTS-SHARED | A persona WITHOUT a fid record — private, or public before its acquisition / while a live acquisition is pending — casts through the SHARED account in either mode: the v0 path with disclosure-gated attribution, never under another persona's fid. The record decides; nothing is refused and nothing is guessed. The comment on `assertOwnFidIdentity` had claimed a fid-less public persona "cannot write at all" in per-persona-fid mode — the code never did that (the FC suites cast as fid-less seeded personas), so the comment now states the rule the code enforces. |

**Built**

- `app/api/identity/fork/route.ts`: the fork mints the new persona's fixture
  fid in per-persona-fid mode (`newFid` / `fidPending` on the response); the
  resolve branch answers `movedFid` to a carried holder.
- `scripts/accept-fid2.mjs` adapts: a fork now mints, so the suite acquires
  only when the fork did not; the dry-run subject (a persona WITHOUT a fid)
  is forked under `shared-fid` — the product's own fid-less path — instead
  of relying on a fork that mints nothing.
- Suite `scripts/accept-fid3.mjs` (`test:fid3`, 7 checks, fixture; in the
  sweep list): fork → fresh fid with the old one still mapped and registrant
  linkage intact; the forward pointer's fid for a carried holder and nothing
  for a stranger; the validator's whole state scanned for an old↔new
  relation in the clear; continuity under the zk binding (the fork requests
  the proof AND mints; the claim verifies at the gate tier); blocks
  client-side against the sim network; the surfaces in both network modes;
  the shared-fid fork minting nothing.

| iteration | result |
|---|---|
| 1 | tsc strict clean, build clean; `test:fid3` **5/7** (fid2 10/10 with the fork now minting, z8 7/7 on the same build). #5: the validator's `/block` required BOTH personas in its table and answered 404 for the minted target → the blocked id is opaque now (D-FID-3-BLOCK-TARGET-OPAQUE). #6: MAIN owned no fid in this suite, so both modes cast through the shared account and the "fid changes with the mode" assertion was vacuous — a RIG gap (MAIN acquires its fixture fid at setup) that also exposed a LYING COMMENT on the identity rule (D-FID-3-NO-FID-CASTS-SHARED); no code path changed. **Harness fault, recorded:** iteration 2 was launched while this run's last two suites were still going; its rebuild and port kill landed under g3 (#16: an estimate that never rendered) and the runner (#2/#3/#4/#7: `fetch failed`, `unreachable`, `HTTP 502`) — INFRA by cause, both re-run clean below, and the rule for the rest of the pass is one harness at a time, launched only after HARNESS_EXIT |
| 2 | tsc strict clean, validator syntax clean, build clean; `test:fid3` **7/7**; on the same build: functional ALL, a1 11/11, z7 7/7 (the block paths), fid2 10/10, runner 7/7. fid1 6/10 — the Gate 1 suite's mint helper forked in per-persona-fid mode and then ASSERTED an empty map and a first acquisition, both of which the minting fork now pre-empts: the helper forks under `shared-fid` (the product's fid-less path, as fid2's dry-run subject does) and asserts the fork minted nothing — every Gate 1 assertion verbatim. Re-run on the same servers: fid1 **10/10**, fid3 **7/7**, g3 **7/7** (clean) |

**Gate 3 exit — met on fixture.** A fork of a persona with a fid mints a
fresh persona with a fresh fid (its own fname, its own custody address,
registrant linkage intact) and leaves the old fid live as the decoy; the
forward pointer hands a carried holder the new fid and fname and nobody
else anything; the validator's plain map gains one unrelated entry and its
whole state holds no old↔new relation in the clear (forks, grants and fid
records sealed); under the zk binding the fork requests the continuity
proof AND mints, and the claim verifies at the gate tier; a block drops the
persona's reply from our feed while the sim network keeps its cast; the
surfaces render identical persona chrome in both network modes with only
the fid under the cast changing; a shared-fid fork mints nothing. The live
half (a real fork → a real new fid) is the user's `npm run fid:acquire`
for the forked persona, inside the same $10 cap and two-account limit.

## GATE 4 — Anon-post mode (the anoncast pattern, inside Layers)

**Decisions**

| id | decision |
|---|---|
| D-FID-4-ANON-IDENTITY-IS-THE-ROOT | An anon post is the ROOT's membership proof in the configured gate tree. The public signal carries the constant `anon` where a persona id would be (the validator requires exactly that for the kind and refuses it for every other kind); the scope omits the persona (`onePerHuman: true`), so a root — all its personas together — posts anonymously once per window. Nothing about a persona is proven, sent or stored. |
| D-FID-4-WINDOW | The window is `ZK_ANON_POST_WINDOW_EPOCHS` epochs (default 1): the scope is qualified by `w<floor(epoch / W)>` on both sides, so the nullifier is constant across a window and the validator's replay rule refuses the second post (409 → the constant-shape `replay` outcome on the wire). The client refuses a second post in the window BEFORE proving; the validator's refusal is the rule, the client's a courtesy. |
| D-FID-4-MESSAGE-BINDS-THE-CAST | The message is `anon \| gateId \| cast:<sha256("layers-anon-cast/1"\|text)> \| challenge \| root` and the cast hash rides the canonical public signal; the envelope's payload carries the text; the validator recomputes the hash and refuses a mismatch. A proof authorises exactly one text — a tampered payload, a re-hashed cast, a foreign tree or a persona on the signal is refused before any nullifier is consumed. |
| D-FID-4-GATE-TREE-IS-THE-VALIDATOR'S | The predicate is the tree the proof lives in — the discovery gate tree by default, or `attest:<issuer>/<bucket>` — and the VALIDATOR enforces its own configured copy (`ZK_ANON_POST_TREE`): the relay's predicate is the relay's rule, never the client's claim. |
| D-FID-4-RELAY-RECORDS-NOTHING-IDENTIFYING | The validator relays through ITS shared anon account (its own throwaway on live: `FC_ANON_FID` + `FC_ANON_SIGNER_UUID` + `NEYNAR_API_KEY` in the validator's env, never a persona's signer, never the app's) and records `zk_anon_casts (mode, cast_hash, text, epoch, hour-grained relayed_at, network_hash, fid)` — no persona, no root, no nullifier, no IP on that row; the nullifier row holds (nullifier, kind, tree, epoch) as for every claim. The app writes no attribution-index entry, no edge event, no ledger row: there is no one to attribute to. On live the network write happens BEFORE the nullifier is consumed (a relay that cannot post consumes nothing); a live cap (`ZK_ANON_POST_LIVE_CAP`, default 1) bounds what this pass will ever relay. |
| D-FID-4-COARSE-TIME | The relayed cast's public time is hour-grained (the validator's convention for every row), so the row's timestamp does not resolve the jittered submission moment. |
| D-FID-4-ANON-TREATMENT | Our client renders relayed anon casts (the validator's PUBLIC `/zk/anon-casts` list — no viewer on the read) as posts by the shared anon account with a visible `anon` badge and NO persona layer (no tier, no persona id, nothing to block, follow or demote; KOTH does not sink them); other clients see the throwaway account. Reputation accrues to no one by construction. |
| D-FID-4-QUEUED-NOT-POSTED | The composer's anon toggle never posts: the text waits in the gate's wanted set, the next prefetch tick proves it from the fixed-schedule snapshot, the drain sends it at a jittered time; the composer says "queued", the post appears when relayed. The toggle shows the COMPUTED privacy label (DEMO with a direct relay; a claim of privacy only when every Pass-1 condition holds) and states "one per window" at the point of use (the C7 waiver for a one-per-human scope). |
| D-FID-4-NEEDS-THE-ZK-BINDING | Anon posting refuses (503) under any rep binding but zk: the proof layer is what makes it anonymous; there is no "anon" without it. |

**Built**

- `lib/zk/scopes.ts` — `anon-post` (onePerHuman, window-qualified) with its
  linkage line; `lib/zk/transport/types.ts` — the claim kind, `castHash` on
  the public inputs (canonical signal), `payload.text` on the envelope;
  `lib/zk/prove.ts` — the anon branch (constant `anon`, the window scope,
  the cast-bound message); `lib/zk/gate.ts` — `requestAnonPost` (the
  composer's trigger: no request, no proof; refused under a non-zk binding,
  over the length, or twice in a window), the tick proving anon claims and
  attaching the text; `lib/zk/anon/queue.ts` — `hasAnonPostInWindow`,
  `anonPostItems`; `lib/zk/config.ts` — `ZK_ANON_POST_TREE`,
  `ZK_ANON_POST_WINDOW_EPOCHS`, `ZK_ANON_POST_MAX_CHARS`.
- `validator/zk.js` — the claim kind on the validator's side (the
  DELIBERATE DUPLICATES: canonical signal, scope, message), the anon shape
  rules both ways, the relay (fixture: the row is the network; live: the
  validator's own throwaway through Neynar, before the nullifier), the
  transaction that records the nullifier and the cast together, the public
  reads `GET /zk/anon-casts` and `GET /zk/anon-post/config`, the dev reset;
  `validator/migrations.js` — migration 10 `zk_anon_casts`.
- `app/api/anon/route.ts` — POST (queue), GET (the privacy verdict, the
  relay config, this device's items; `?castHash=`; `&envelope=1` under dev
  hooks for the leak grep); `lib/zk/validatorClient.ts` — `fetchAnonCasts`,
  `fetchAnonPostConfig`; `lib/feed.ts` — anon cards; `components/CastCard.tsx`
  — the `cast-anon` badge in place of a tier; `components/Composer.tsx` —
  the anon toggle, the computed label, the audience line.
- `scripts/live-fid4.mjs` (`npm run live:fid4`) — the USER's one real anon
  cast: refuses without `ENABLE_FC_WRITE=true`, a LIVE zk universe and a
  validator that reports a live relay; records `research/live-fid4.json`
  (hashes, fid, time — no keys, no persona).
- Suite `scripts/accept-fid4.mjs` (`test:fid4`, 8 checks, fixture; in the
  sweep list).

| iteration | result |
|---|---|
| 1 | tsc strict clean, validator syntax clean, build clean; `test:fid4` **2/8** with z0 11/11, z1 8/8, z8 7/7, runner 7/7 on the same build (the new onePerHuman scope passes the collision suite; the anon channel and the fork claim are untouched). ONE product defect behind five of the six: the validator's `scopeString` fell through my anon-post branch into the attestation branch's `else if (qualifier !== undefined) throw "this scope takes no qualifier"` — the drain sent the envelope and the validator refused it (found through the plain door: "claim binding: this scope takes no qualifier"); with nothing accepted, the window check let a second post through (#4), the envelope reads had nothing to tamper with (#5) and the feed had no card (#7 INFRA). Fixed: the branches are exclusive. Two RIG faults: the suite read the envelope AFTER the drain (the queue keeps no proof material once sent) — it reads it while queued now; the live recorder's `process.exit(2)` during an in-flight fetch fail-fasted on Windows (exit 0xC0000409 with the right refusal on stderr) — it sets the exit code and lets the loop drain. Also: the validator unit suite had one test asserting Gate 3's OLD block contract (unknown target → 404; it had not been run at the Gate 3 commit) — updated to the opaque-target contract (201 / malformed 400 / unknown blocker 404), and an anon-post unit test added (accepted + relayed row shape + replay + four refusals): 40/40 |
| 2 | validator restarted on the fix (no app change); `test:fid4` **8/8**: the anon post queued (202, castHash = sha256 of the text), proved at the tick, sent over the anon channel and accepted; the validator's public list holds it under an `0xanon…` hash; our feed shows it as the shared anon account with the `anon` badge and no persona; the attribution index answers null, the event log holds nothing, every row of the validator's DB that mentions the cast is the anon row alone with exactly (mode, cast_hash, text, epoch, relayed_at, network_hash, fid) and an hour-grained time, the nullifier row carries no persona, the envelope on the wire names no persona and no root; the second post in the window refused by the client (409) and, forced past it, by the validator (replay); a changed text, a re-hashed cast, a foreign tree, a persona on the signal and a plain claim carrying a payload each refused before any nullifier, the untouched envelope a replay; the label DEMO with the direct relay and the relay condition holding under an attested ohttp relay; the composer's toggle rendering the computed label and "attributed to no one"; the anon card with its badge and no tier, no merged identity, no act-as option; the live recorder refusing (exit 2) without the flag and on the fixture universe. Validator units 40/40. Regression: a FULL sweep on this build (below) |
| sweep | the full sweep on this build (64 suites): **467 passing checks, 2 failed suites, 0 infra.** (a) **z3** 4/6 — RIG STATE: the live-universe registration for the demo's root id was made by an earlier keystore seed (Gate 1 iteration 1's crash re-minted the root; the repair restored the validator's device tables but not the zk LIVE universe), so z3's live register answered 409 "this root already has an active registered commitment"; the live universe is test furniture in this topology, so its rows were dropped with the validator stopped (`$SCRATCH/fix-live-universe.mjs`, mirroring the fixture reset for mode=live) and the device's live pins cleared with the app stopped (the pinned history hash was then absent from the served window — the client REFUSED, correctly, fail closed) — z3 **6/6** on re-run, same tree. (b) **z9** 8/9 — a REAL finding by the safety-set suite: "a persona id is a plaintext state address: personaFidMap/<new persona>" — Gate 3's fork now mints a fid for the new persona, so Gate 1's plain persona → fid map puts the forked persona's id on the validator as a plaintext address, exactly the operator linkage the three adversarial reviews put first. The plain map is removed in Gate 5 (D-FID-5-MAP-SEALED); this commit records the finding as KNOWN and open until the next commit |

## GATE 5 — Linkage test v4 + three adversarial reviews + posture "Network identities"

**The reviews.** Three fresh-context reviewers, one angle each, read the
spec, this report, the posture, VERIFY-YOURSELF and the pass's code:
`research/attack-fid-1.md` (the NETWORK / ONCHAIN observer — 17 findings,
7 HIGH), `research/attack-fid-2.md` (the VALIDATOR OPERATOR — 18 findings,
4 HIGH), `research/attack-fid-3.md` (the CODE-LEVEL adversary — 19
findings, 5 HIGH). The three HIGHs every reviewer put first agree: a live
account for a SEEDED persona would be owned by a custody key anyone can
derive from the repository (the seeded viewer's Farcaster keys come off
the fixture root, a public constant); the plain persona → fid map was one
device-signed document listing every account of a root (the persona → root
grouping migration 006 removed, reintroduced); and the anon "window" was
one-per-EPOCH, because the window qualifier had been appended beside the
epoch instead of replacing it. Every finding is answered in
`SECURITY-POSTURE.md` §14 ("Network identities"): a fix in this gate, or
an assumption by id.

**Decisions**

| id | decision |
|---|---|
| D-FID-5-LIVE-KEYSTORE-ONLY | A LIVE account (recordLiveFid, both custody signatures, the acquisition command) only for a persona whose Farcaster keys come off the ROOT PHRASE. A seeded viewer persona's keys are public by construction and are refused before any billable call; `signerProbe` reports `keystoreRooted` / `liveEligible`. The Gate 2 plan's "two seeded public personas" is corrected: the two live accounts are keystore-minted personas (a fork of a seeded one is). |
| D-FID-5-MAP-SEALED | No plain persona → fid map on the validator. Nothing in the product read it; the fid ↔ persona relation resolves from the sealed record. (Reverses Gate 1's plain map.) |
| D-FID-5-WINDOW-IS-THE-SCOPE | For the window-qualified one-per-human scope the window index REPLACES the epoch in the scope string on both sides, and the validator refuses the grace epoch for anon posts — one nullifier per root per window, enforced by the validator's replay rule. |
| D-FID-5-STORE-AND-FORWARD | On live the validator never posts at submission time: the accepted row is PENDING and the validator relays pending rows at the top of its own interval (`ZK_ANON_RELAY_INTERVAL_MS`, default an hour), in random order. The network timestamp is the slot. A relay that fails stays pending; the window was consumed at acceptance. On fixture the row is the network, relayed at once. |
| D-FID-5-RELAY-IDENTITY-RULE | The validator's relay obeys the identity rule the app's writer does: the anon account is named explicitly (no fallback to the app's throwaway), the validator is armed by its own `ENABLE_FC_WRITE`, the signer must be approved for exactly that fid (checked against Neynar before any relay, cached), a foreign signer credential in the validator's env refuses everything, the network's reported author must be the configured fid, the live cap is counted inside the recording transaction, every numeric knob is finite and clamped. |
| D-FID-5-SALTED-CAST-HASH | The cast hash is sha256 over a per-post 16-byte nonce and the text; the payload carries both; two identical texts are two posts. |
| D-FID-5-RESET-KEEPS-MONEY | A seed reset reads the live fid spend entries and the live fid records BEFORE the wipe and re-seals them after it; a reset that cannot read them is refused. The $10 cap is a ceiling no env line raises. The live-money actions are armed by `FID_ACQUIRE_ENABLED`, apart from the rig flag. Forgetting a live record needs `confirmLive: true`. |
| D-FID-5-ONE-PER-RUN | The acquisition command creates ONE account per invocation, checks the IdRegistry for an existing fid under the persona's custody address first (RESUME records it, never re-creates), ledgers the registration's estimate BEFORE the billable call keyed by the custody address, records the signer the network reports, and sends the persona's own profile — refusing any profile string that names this client. |
| D-FID-5-NO-CLIENT-FINGERPRINT | No fallback fname begins with `layers-`; a fork in per-persona-fid mode gets a neutral default handle and name, copies neither avatar nor bio, refuses a handle derived from the old one (prefix / suffix / trailing-digit stem) when the source already owns an account; a PRIVATE source forks into a PRIVATE persona (no account, no fid — the continuity machinery keeps working); the live recorders carry no shared marker; their output is gitignored. |
| D-FID-5-QUIET-TICK | The product path queues a proof from the tick's own snapshot (no identified epoch fetch) and persists the queued state on the queue's random delay (no device-signed write at prove time); the anon tree is in the uniform fetch set. Rigs and the restart-survival suite keep "persist now". |
| D-FID-5-RE-DERIVE-AT-WRITE | The identity rule checks a persona's fid record against the keys derived for it at write time; an injected rig record is fixture-only and never carries the pass's own origin. |

**Built**

- Fixes across `lib/identity/keys.ts`, `lib/fc/{acquire,custodySign,writes,writeLedger,personaFid}.ts`,
  `lib/x/spend.ts`, `lib/adapters/mock/store.ts`, `lib/zk/{scopes,gate,prefetch,privacy,validatorClient}.ts`,
  `lib/zk/anon/queue.ts`, `app/api/{fc/persona,fc/write,dev,anon,identity/fork}/route.ts`,
  `components/{Composer,ActAsPicker}.tsx`, `validator/zk.js` (+ migration 11 `status`),
  `scripts/fid-acquire.mjs` (rewritten), `scripts/live-fid{2,4}.mjs`, `.gitignore`, `.env.example`;
  the fid1–fid4 suites and the validator unit test adapted to the new contracts.
- **Linkage test v4** — `scripts/accept-fid5.mjs` (`test:fid5`, 8 checks, fixture, SAFETY SET, in
  the sweep list): a session with two persona fids, a fork to a new fid (continuity proved), an
  act-as reply across accounts, our anon post inside a crowd of ≥ floor decoy anon posts (forged
  by the rig through the plain door, in the same window); then, from the operator's data only:
  anon → persona/root by nullifier (none; no joining column; crowd ≥ floor), anon → submitter by
  row shape (identical fid, hour, columns across the crowd), fid map → root (no plain map; no
  custody/signer/registrant anywhere), old ↔ new (no row relates them; the fork claim names NEW
  and a commitment; the sealed fid namespace is one row before and after), act-as across personas
  (public accounts, no root; the reply latency MEASURED and reported — A-FID-SELF-GRAPH), the wire
  (the anon envelope fits the constant body), leaks (log + whole DB clean beside every cast).
- **Posture** — `SECURITY-POSTURE.md` §14 "Network identities": the observer table (hub / Neynar /
  validator / this client), the fixes, the assumptions by id (A-FID-NEYNAR-SEES-ALL,
  A-FID-REGISTRANT-BY-FIAT, A-FID-SIGNER-LOOKUP, A-FID-SELF-GRAPH, A-FID-LIVE-PAIR-IS-FURNITURE,
  A-FID-FORK-AUDIENCE-GRAPH, A-FID-CREATION-TIMING, A-FID-ANON-CROWD, A-FID-ANON-TIMING,
  A-FID-ANON-SET-IS-ONLINE-DEVICES, A-FID-ANON-RELAY-HOLDS-THE-TEXT, A-FID-CAP-IS-THE-SCRIPT'S,
  A-FID-LEDGER-MS, A-FID-RENT-PAYER, A-FID-FORK-NAMING-IS-THE-USER'S, A-FID-DEV-SURFACE-LIVE);
  `research/VERIFY-YOURSELF.md` F21–F24 (the one chain lookup that decides the registrant rule,
  the signer's requestFid, the sponsored register response's signer, the Neynar cluster).

| iteration | result |
|---|---|
| 1 | tsc strict clean, validator syntax clean, build clean, validator units 40/40 (the anon-post unit test now encodes the window scope, the nonce and the status column). **Linkage v4 `test:fid5` 8/8 on its first run**; fid3 7/7, z0 11/11, z1 8/8, z3 6/6, z8 7/7, fc2 7/7, fc3 7/7, fc4 6/6, fc5 6/6, functional ALL, runner 7/7. Four suites tripped on the NEW contracts, none on a product defect: fid1 9/10 — `forget` re-sealed a document it had built by hand, which the new "never seal an unloaded record" guard refused (the forgotten document keeps its loaded flag now); fid2 9/10 — the suite signed a Transfer for a persona that already owned a fid, which the new one-persona-one-fid rule refuses (the signatures now exercise the fid-less minted persona and the refusal is asserted on the one with a fid); fid4 7/8 — the anon row's new `status` column (admitted); z9 3/9 — its session forks the seeded PRIVATE persona and the new rule refused it outright, breaking every later attack; the rule is now the reviewer's other option — a private source forks into a PRIVATE persona (no account, no fid, the continuity machinery intact) |
| 2 | rebuilt; every suite green: **fid5 8/8, fid1 10/10, fid2 10/10, fid3 7/7, fid4 8/8, z0 11/11, z1 8/8, z3 6/6, z8 7/7, z9 9/9** (the plain-map finding of the Gate 4 sweep closed — no persona id is a plaintext state address any more), fc2 7/7, fc3 7/7, fc4 6/6, fc5 6/6, functional ALL, runner 7/7; tsc strict + production build clean; validator units 40/40 |

**Gate 5 exit — met.** Linkage v4 green at the floor on the operator's own data (the anon crowd, the fid records, the fork, the act-as pair, the wire, the log and the whole DB); the three adversarial reviews answered — every finding a fix in this gate or an assumption by id in `SECURITY-POSTURE.md` §14 "Network identities"; the earlier gates' suites re-adapted to the new contracts and green; the one finding the Gate 4 sweep's safety-set suite raised (z9 #6) closed by the same fix the reviewers asked for. What this gate could not do: read the chain (VERIFY-YOURSELF F21/F22 are the user's lookups) and make the two live accounts (the user's command, one persona per run, keystore-rooted only).

---

## /verify — the closing bar

**The bar (from the prompt):** the full legacy suite at the 427-check
baseline under the fixed runner, the greps every iteration (root
material, signer keys, vault plaintext, persona ids or roots near anon
cast hashes), restart survival, total-device-loss recovery, the live
gates once (the user's action), linkage v4 with three reports, and
finally four CONSECUTIVE clean sweeps on identical code — the counter
resets on any change, one is one — with tsc strict and the production
build clean and everything committed. Sweeps are fixture-only: no spend,
no post, no deploy, no live proof.

| item | result |
|---|---|
| legacy suite at the 427 baseline | every sweep ran the attestation pass's 58 suites (427 checks) plus fid0 8, fid1 10, fid2 10, fid3 7, fid4 8, fid5 8 = **478 checks over 64 suites**; the runner refuses to launch unless both processes answer the signed health contract and the app's `peer` is the validator under test |
| greps every iteration | repo-level: no credential, signer uuid, wallet id, custody private key or root secret in any tracked file; no anon cast hash in any tracked document (confirmed clean on the closing commit). Per sweep: fid4 #3 and fid5 #1–#3/#7 grep the validator's whole database, its process log and the envelope on the wire for a persona id, a root, a custody address, a signer reference or a nullifier beside every cast of the session; att4 #8 and z9 #5 keep the attestation- and zk-era needles — clean in all four closing sweeps |
| restart survival | att4 #9 in every sweep (the validator killed and re-probed under its served key; issuances, registry, honour list intact) — 4/4 |
| total-device-loss recovery | fid1 #5 in every sweep (device wiped; the 24-word phrase brings the minted persona's signer key, custody address and the persona ↔ fid records back bit for bit) — 4/4 |
| live gates once | the USER's action, by decision (D-FID-1-LIVE-CREATION-BY-USER; D-FID-5-LIVE-KEYSTORE-ONLY) — not run by this session. Total spend this pass: **$0.00**; no live artifacts exist (`research/live-fid*.json` absent) |
| linkage v4 + three reports | fid5 8/8 in every sweep; `research/attack-fid-{1,2,3}.md` (17/18/19 findings) answered in `SECURITY-POSTURE.md` §14 "Network identities" |
| tsc strict / production build | clean on `526addf` (the closing commit) |

### Closing series — five attempts, one real code fix each time the sweeps found something

Every series but the last halted on its FIRST sweep, at a genuine finding
— never patched blind, never restarted on a guess. Each finding is
recorded in `notes/reports/SWEEP-STATUS.md` with its root cause; none was a security
hole, and none survived past the sweep that found it.

| series | target commit | result |
|---|---|---|
| 1 | `4e6f676` | halted at 0 of 4 — m2 #1–6: the fork's new name-stem rule refused every derived-handle fork, including the product's own recovery flow forking a persona with no account. Fixed (`52795bd`): the rule applies only when the source already owns a fid record. |
| 2 | `52795bd` | halted at 0 of 4 — x3 #7: the reset's live-spend restore wrote `xSpend.set(` from `lib/adapters/mock/store.ts`, outside the ledger's own pinned module. Fixed (`f875b60`): the restore moved into `lib/x/spend.ts`. |
| 3 | `f875b60` | attempt 1 INFRA by cause (x3 #2 straddled midnight — the day cap restarted between its two runs; not counted). Attempt 2 halted at 0 of 4 — a3 #1: a FIXTURE anon cast relayed by an earlier suite survived `resetSeed` with a wall-clock time later than the server's boot, moving the caught-up banner's cutoff. Fixed (`c19c7aa`): the seed reset clears fixture anon rows on the validator. |
| 4 | `c19c7aa` | sweeps 1–3 clean (a session boundary interrupted the code's own first sweep-3 attempt at 28/64 suites with zero failures; re-run in full, not counted). Sweep 4 halted at 3 of 4 — z2 #7: SPLIT VIEW BY IDENTITY. Root cause: the fixed-schedule prefetch snapshot fetches identified history and the anonymous head as two separate round trips (an inherent straddle window on every tick); z2 alone calls `advanceEpoch` six times within under a minute, more than any other suite, and its own wait-for-tick loop treated the first attempt as final whatever the outcome. Not a security hole — the split-view detector did exactly its job — a test-robustness gap. Fixed (`526addf`): the suite re-triggers and retries on that specific refusal, bounded to three attempts; verified 7/7 three times against the live servers before the fresh series. |
| **5** | **`526addf`** | **four consecutive clean sweeps, 478/478 checks, 0 infra, four times. MET.** |

### Series 5 — `526addf` (the closing series)

| sweep | window | tally | verdict |
|---|---|---|---|
| 1 | 11:38 → 12:24 | 478 passing checks, 0 failed suites, 0 infra | **CLEAN** — 1 of 4 |
| 2 | 12:24 → 13:26 | 478 passing checks, 0 failed suites, 0 infra | **CLEAN** — 2 of 4 |
| 3 | 13:26 → 14:29 | 478 passing checks, 0 failed suites, 0 infra | **CLEAN** — 3 of 4 |
| 4 | 14:29 → 15:31 | 478 passing checks, 0 failed suites, 0 infra | **CLEAN** — 4 of 4 |

**/verify CLOSED.** Every gate is green on fixture; the closing sweeps'
own instruments found and fixed four defects across the four preceding
series — a test rule too strict, a ledger write outside its pinned
module, a reset that missed one table, and a test's own retry gap — none
of them security holes, all of them exactly what a marathon verification
pass exists to surface. The live half of the pass (two real persona
accounts, one real anonymous cast) is the user's own action, at zero
spend so far, gated by `D-FID-1-LIVE-CREATION-BY-USER` and
`D-FID-5-LIVE-KEYSTORE-ONLY`. See `notes/runbooks/MORNING.md` for the exact commands.

---

## ADDITION (after the pass closed) — anon-post ATTRIBUTION: the anoncast reveal pattern

Asked for after `/verify` closed: *"if I do full anonymous, I'd like to do the
thing anoncast does where you can prove ownership with a secret key later and
attribute it to one of your personas."* Gate 4 shipped anon posting that was
unlinkable **by construction and forever** — nothing was kept that could tie a
post back to its author even if the author wanted to. This adds the missing
half: a commitment made at post time that only its holder can ever open.

**Decisions**

| id | decision |
|---|---|
| D-FID-6-COMMIT-AT-POST-TIME | Every anon post mints a fresh 32-byte secret on the posting device BEFORE anything leaves the process, seals it in the vault under the cast hash, and binds only `sha256("layers-anon-attribution/1"‖secret)` into the proof's message. The commitment is 256 random bits behind a hash: it says nothing about who posted, and it is authenticated by the same proof that authorises the cast, so neither the relaying validator nor an interceptor can swap it for one they can open. |
| D-FID-6-SECRET-NEVER-TRANSMITTED | The secret itself is never sent anywhere at post time — not to the validator, not in the payload, not to the browser. Its only trace on the wire is the commitment. A stolen validator dump can neither deanonymize a past anon post nor forge a reveal. The vault namespace `anonAttribution` is sealed like every other secret store, with the same fail-closed read discipline as `personaFids` (a failed read is a refusal, never an empty document a later write could seal over — losing a secret means losing the only proof of authorship that ever existed). |
| D-FID-6-REVEAL-IS-THE-OWNER'S-ALONE | Nothing reveals automatically, on a schedule, or under anyone else's control. A reveal happens only when the device holding the secret asks for it, naming one of its OWN personas (the same ownership rule every other persona action uses) that owns a real fid of its own — attributing to the shared/throwaway account would say nothing. Possession of the secret is the authority, exactly as in any commit-reveal scheme. |
| D-FID-6-ONE-REVEAL-EVER | First reveal wins, permanently: the same persona revealing again is a harmless no-op, a DIFFERENT persona is refused (409). A reveal is public and irreversible by design — that is what makes it worth anything to a reader. |
| D-FID-6-PUBLIC-AFTER-THE-FACT | The validator records `attributed_fid` and an hour-grained `attributed_at` on the cast's own row and serves both on the public anon-casts list. Our client renders the card as it always was — the shared anon account — with "anon · revealed as @handle" appended; every other client still sees the shared account, because that IS who posted it. |

**Built**

- `lib/zk/anonAttribution.ts` — the sealed per-cast secret store (fail-closed
  reads, padded sealed record) and the reveal orchestration.
- `lib/zk/gate.ts` — `requestAnonPost` mints and seals the secret before
  queueing and threads the commitment into the claim; `lib/zk/prove.ts`,
  `lib/zk/transport/types.ts` — `attributionCommitment` on the anon-post public
  inputs, in the message (`anon | gateId | cast:<hash> | attr:<commitment> |
  challenge | root`) and in the canonical signal, mirrored exactly in
  `validator/zk.js` (the DELIBERATE DUPLICATE discipline).
- `validator/zk.js` — migration 12's three columns written at relay time;
  `POST /zk/anon/reveal` (a real product endpoint, not a dev hook: the
  hash-preimage check and the one-way record); `GET /zk/anon-casts` serves
  `attributedFid` / `attributedAt`.
- `app/api/anon/route.ts` — `action: "reveal"`, and `revealable` on the GET so
  the UI knows which anon casts THIS device can still prove.
- `components/AnonRevealControl.tsx` + `CastCard` — "Prove this is yours" on an
  anon cast this device holds the secret for, a persona picker, and the
  "revealed as @handle" treatment once done. The secret never reaches the
  browser: the button sends a cast hash and a persona id, nothing more.
- Suite `scripts/accept-anon-reveal.mjs` (`test:anon-reveal`, 8 checks,
  fixture): sealed-at-post-time and independent of the cast hash;
  tamper-evidence (a swapped commitment is refused before any nullifier moves);
  a wrong secret, an unowned persona and a fid-less persona all refused with
  nothing attributed; the correct reveal landing on the public row; one reveal
  ever; a second post untouched throughout; the secret and its domain string
  absent from the validator's whole database; and the card's two states.

| iteration | result |
|---|---|
| 1 | tsc strict clean, validator syntax clean, build clean; `test:anon-reveal` **6/8** — two RIG faults, no product ones: both extra posts in the suite tripped the real one-anon-post-per-window rule, and the client judges that window against its CACHED prefetch snapshot, so an `advanceEpoch` alone was not enough — the suite refreshes the snapshot before posting now. Two existing suites needed the same kind of update, both because the new column and the new required field are real contract changes: fid4's exact-column assertion on the anon row (now admits the three attribution columns AND asserts they stay null when nobody reveals), and fid5's forged decoy envelopes (now carry their own commitment, excluded from the row-shape comparison since it is unique per post by construction). The validator unit test likewise. |
| 2 | `test:anon-reveal` **8/8**; fid4 8/8, fid5 8/8 (linkage v4 still green at the floor with the crowd's commitments in place); validator units **40/40**, now covering the reveal endpoint end to end (wrong secret, right secret, second persona, idempotent repeat) |

**Not done, deliberately:** this addition did NOT re-run the pass's full closing
bar (three adversarial reviews plus four consecutive clean sweeps). It ships
with its own suite, the regression set above, and the unit tests. If it should
be held to the same bar as the gates, that is a closing series to run on
request.

### ADDITION 2 — the reveal is signed (posture §14.2)

Found while writing §14.1, before the first commit landed, and fixed
immediately after it: the reveal endpoint took the `fid` on the caller's
word. Our app checked persona ownership first, but this codebase treats the
validator as a shared service and an observer — that is why Gate 5 removed
the persona→fid map from it — so "the app checked" is not a control against a
caller who is not our app. A person holding a post's secret could have it
recorded against **someone else's** fid. Our client would not render it, but
`GET /zk/anon-casts` served the row, and unrenderable is not refused.

| id | decision |
|---|---|
| D-FID-6-REVEAL-IS-SIGNED | A reveal carries a signature by the attributing fid's OWN Farcaster signer key over `layers-anon-reveal/1\|<mode>\|<castHash>\|<fid>\|<signerPubKey>` — every swappable part bound, so a signature cannot be lifted onto another cast, fid, universe, or key. Unsigned or unverifiable is refused (400) before the row is even read. |
| D-FID-6-VALIDATOR-CARRIES-EVIDENCE | The validator verifies the preimage AND the signature, then stores and serves the key it verified under (`attributed_signer`, migration 13). It does not decide whose key that is — it holds no fid→key binding and must not. It carries evidence; it is not an authority on identity. |
| D-FID-6-READER-CHECKS-THE-KEY | Rendering "@x posted this" is the READER's assertion, so the reader ties the key to the fid — own registration here, the Farcaster KeyRegistry on live (F25, not built). No answer, no attribution: the cast stays plain `anon`. The old fallback that rendered a bare fid when the profile would not resolve is deleted: "we could not check this" must never look like a weaker "@x said this". |

Suite check 9 proves the reader's half adversarially: it takes the
validator's storage away from it and writes the row an attacker would want (a
real fid of ours, attributed under a key the rig generated), confirms the
public list serves the forged claim, then asserts the card still says `anon`
with no `data-attributed`. Check 3's wrong-secret probe now signs correctly
first, so its refusal is genuinely about the secret and not about the missing
signature. `test:anon-reveal` is 9 checks.
