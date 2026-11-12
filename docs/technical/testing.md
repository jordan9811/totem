# Testing

Totem is verified by acceptance suites that drive the running app and validator over HTTP and in a real browser, plus greps over the validator's database and every log for what must not be there. A pass closes on four consecutive clean full sweeps on identical code.

::: info Status
The sweep baseline is **623 checks over 83 suites**, set when the post-deploy pass closed on `e2d909e`. Persona launch wave 2's full sweep on `cfdc017` ran 1,069 checks with no failed suite; wave 3 adds three suites to the sweep and one outside it. The prod-live and FC-READ passes added suites that run outside the sweep, against the production-shaped pair or against fakes; they are listed below. Everything here runs on fixtures and loopback stand-ins. A green suite says the code does what the test asks on test data; it is not evidence that a feature works live.
:::

## At a glance

<ol class="flow">
<li><strong>Start the pair</strong>App on 3001 and validator on 4001, rig-shaped or production-shaped.</li>
<li><strong>Run one suite</strong><code>npm run test:&lt;id&gt;</code> prints <code>N/M … passed</code> and exits 1 on any failure.</li>
<li class="flow__us"><strong>Sweep</strong><code>scripts/sweep-x.sh</code> runs all 83 rig suites, one comparable line each.</li>
<li><strong>Repeat</strong>Four clean sweeps in a row on the same commit. Any code change resets the count.</li>
<li><strong>Measure the other shape</strong>The production-shaped suites and the deployed smoke, on the same commit.</li>
</ol>
<p class="flow__note">An attempt that could not measure anything (the machine asleep, the server unreachable) is recorded as infrastructure and counts neither way.</p>

## The suites

| Family | Scripts | What they cover |
|---|---|---|
| Phase 1 and gated | `test:validator`, `functional`, `test:accept`, `test:g1` to `test:g3` | The validator's contract, the original X-parity surfaces. |
| Identity substrate | `test:substrate`, `test:rootleak`, `test:m1` to `test:m4` | Derivation, root confinement, grants, the content switch leaving persona state untouched. |
| Waves and tiers | `test:a1` to `test:a6`, `test:b0` to `test:b4` | Social surfaces, the event log, money surfaces on the mock ledger. |
| X interop | `test:x0` to `test:x4` | Linking, archive import, crosspost, migration. **Fixture only.** |
| UX and Farcaster | `test:ux0` to `test:ux4`, `test:calla`, `test:fc2` to `test:fc5` | The UX pass; the write door, ledger and check-before-retry against the fixture network. |
| Persona crypto | `test:c0` to `test:c4`, `test:bp` | Real signatures, the vault, device linking, recovery; the data backpack. |
| ZK | `test:z0` to `test:z9`, `test:runner` | Membership proofs, the anonymous channel, migration 006, fork continuity, the runner's own liveness rules. |
| Attestation and accounts | `test:att1` to `test:att4`, `test:fid0` to `test:fid5`, `test:anon-reveal` | Issuers, persona accounts, anonymous posts and the reveal. |
| Mega pass 2 | `test:m2g1` to `test:m2g8` | Reputation and stakes, lenses, zones, search, the DM hook, porting, linkage v5, the docs site. |
| Browser keystore | `test:cu2`, `test:cu3`, `test:device`, `test:no-keystore`, `test:device-restart` | Saving and recovering identity, linking, the device bundle, the empty keystore on a production server, restart survival. |
| Post-deploy | `test:pd0` to `test:pd4` | Hygiene, cloning, tint and compartment mode, delivery tiers, readwise. |
| Persona launch, wave 1 | `test:siwf`, `test:siwf-unit`, `test:x5`, `test:x-unit`, `test:ns-sizes`, `test:anon-slots`, `test:anon-slots-unit`, `test:linkage6` | Sign in with Farcaster on the rig's fixture relay and chain (`accept-siwf.mjs`: the passkey-first picker, the read-only public self, the refusals, a leak grep, the save moment) and node-only (`unit-siwf.mjs`: the refusal matrix, zero chain calls for a plain signature, no value in an error, the reference library as a cross-check, the uniform 1,024-byte record); Bring your X on a synthetic 3,000-post archive (`accept-x5.mjs`, `unit-x-v1.mjs`: the ZIP read, the dropped email and phone, chunked documents and torn writes) and every namespace sealed under the 256 KiB limit with headroom (`unit-namespace-sizes.mjs`); K anon posts in a window giving K distinct nullifiers and the K+1th refused (`accept-anon-slots.mjs`, `unit-anon-slots.mjs`), and the operator-view linkage test v6 with the slot residual measured (`accept-linkage6.mjs`). **Test data only.** |
| Persona launch, wave 2 | `test:rings`, `test:rings-unit`, `test:reach`, `test:reach-unit`, `test:launch`, `test:launch-unit` | Rings on the rig (`accept-rings.mjs`, 11 checks: members see exactly the shared posts and a non-member's cards are byte-identical; a revoke rotates the key and deletes the row; a failed drop read hides without dropping; every device reads the drop and the anon list on every tick; the `/d` card mints no root; a database grep finds no persona or ring material) and node-only (`unit-rings.mjs`, with a mutation per guard); reach tiers (`accept-reach.mjs`: 49 in a tier is not offered and 50 is, a refusal before anything is minted, K posts over different trees, the label and the boost order against rows forged into the database; `unit-reach.mjs`); launch on the simulated registrar (`accept-launch.mjs`: nothing linked before the confirm, the click writes nothing, no device header on the request, registration 2 to 48 hours after the click on the sim clock, every post of the persona revealed and none of its sibling's, a forged reveal renders anon, the post-launch rules, the proof page; `unit-launch.mjs` pins each deliberate duplicate one side against the other). Validator unit tests: `validator/test/ringdrop.test.js`, `reach.test.js`, `registrar.test.js`. **Test data only.** |
| Persona launch, wave 3 | `test:prover-unit`, `test:x-outbox`, `test:x-outbox-unit` | The browser prover and channel node-only (`unit-prover.mjs`, a mutation per guard: the channel's request, relay selection, the availability matrix, the test core's parity with the validator, a real Groth16 proof from the pinned files and tampered files refused, the worker bridge, a real HPKE round trip, the web route's guards, the build budget; since the wave 3 review also the prover loaded at every tab's boot with Blob-URL workers and no request at proof time (L1), the padded body as an allowlist with no timing on it (L2), unknown crowd as "checking" and the in-tab membership ending (UXH-2), the keep-the-tab-open and reopened-status lines (UXH-3), the owner-service ring line (UXH-8), the crowd sentence (UXH-11) and the preview banner computing the label again on every tick: 85 checks); the @totem X outbox on the rig (`accept-x-outbox.mjs`, 14 checks: no moderator no copy, the toggle, a copy into review, no moderation no post, approve and reject, one X slot a window, a sibling persona's copy hidden under the compartment, the policy at both ends, the copy's words checked before the anonymous post, nothing leaving the machine under a network guard, the operator's view, Settings, the resets) and node-only (`unit-x-outbox.mjs`). Validator unit tests: `validator/test/anonweb.test.js`, `xoutbox.test.js`, `seedreset.test.js`, `reptiers.test.js`. **Test data only.** |

Run one with the pair up: `npm run test:m2g7`. Most suites drive the rig's `/api/dev` controls (reset, view-as, failure injection), so they need the dev hooks: `ZK_DEV_HOOKS=true` on both processes.

## Outside the sweep

These suites measure the shape the rig does not: a production build with the dev hooks off, where the server holds no identity.

| Suite | Runs against | Checks |
|---|---|---|
| `test:cu4` | the production-shaped pair only; it aborts on a rig | 13: the two must-not-ship lists identical, the readiness audit driven through the page, the secrets audit, rate limits that a spoofed header does not widen, boot refusals on both processes (the read key on the validator, the viewer fid on the app), a misconfigured relay disarming rather than exiting |
| `test:cu6` | the production-shaped pair | 11: the landing page with no validator (the docs door to `/docs`, and `/docs/` served by that same validator-less app), an explicit docs address overriding the door, the banner's computed label, a hand-authored page surviving the docs scripts, the docs under the app (no docs source in the Next bundle; the served build is the guarded one and an internal build fails the guard; one policy per page with hashes that match it, the internal pages 404, path traversal refused, assets immutable), a real browser load of `/docs/`, the deploy config, the kill switch (the docs included), the identity cap, a log grep for ids, keys and addresses, the deployed smoke |
| `scripts/accept-prodlive.mjs` (`test:prodlive`) | the production-shaped pair, or Railway | a route walk of about 70 pages with a content check on each, plus the docs at `/docs` (every page reachable by its own links, and a browser walk), settings reachable by clicking, no fixture identity in the chrome, persistence, at most 3 roots minted |
| `scripts/accept-fcread.mjs` (`test:fcread`) | the pair in stub mode only | 43: the read relay's operations, budgets, refusals, both discovery sources; the stub fails the run on any forbidden upstream request |
| `test:fcread-unit` | nothing running | 8: the relay's pure functions, including the two copies of the address-keying code |
| `test:owner-passkeys` (`scripts/unit-owner-passkeys.mjs`) | nothing running | 70: the owner gate's cookie, passkey registration and sign-in against a software authenticator (`scripts/lib/soft-authenticator.mjs`), revocation, the Security page as served, the arm script's words; `--mutate` weakens each control in the bundle and every mutation must turn a check red |
| `test:connector-unit` (`scripts/unit-connector.mjs`) | nothing running | 52: the connector account's setup (`lib/fc/connector.server.ts` and its route, bundled with esbuild) against a fake chain, a fake vault and a fake Neynar: every shape but the armed owner service refuses, the environment pair wins, create is idempotent across a restart, the stage follows the balance, register refuses a shortfall and sends one transaction at most, a name that says layers or looks like an own account is refused |
| `test:fc-buttons-unit` (`scripts/unit-fc-buttons.mjs`) | nothing running | 48: the real cast, react, follow, delivery and act-as routes bundled with esbuild against a fake Neynar, a fake vault and fake keys: writes off makes no call, an armed persona posts with its own signer, the shared test account is refused, and the line under the Post box is decided again on the server |
| `test:rings-prod` (`scripts/accept-rings-prod.mjs`) | the production-shaped pair only; it aborts on a rig | 4: a fresh device's first tick reads the drop and the anon list unsigned and writes its padded `rings` namespace once; a stranger's ring publishes device-signed (an unsigned write is refused); the `/d` card renders with no device and no new root; no ring-drop write token anywhere |
| `test:anon-prod` (`scripts/accept-anon-prod.mjs`) | the production-shaped pair only, after a build; it aborts on a rig and starts its own throwaway validator (port 4063, a temp database with 70 decoy registrations) | 8: the bundle budgets and the GPL notice, the prover loaded at boot in every tab (L1), a fresh stranger told "checking" before the first check and then the crowd sentence (UXH-2, UXH-11), a stranger outside the crowd refused with nothing minted, a stranger in the crowd posting from the worker over exactly one web request, no secret in any request or log, the preview label on the card, the live universe refused, the doors, and the phone stand-in measurement (`shots/p7-browser-prover.json`) |
| `test:siwf-prod` (`scripts/accept-siwf-prod.mjs`) | the production-shaped pair under `PRODLIVE_SIWF=stub` | Sign in with Farcaster in a real browser against a loopback relay-and-chain stub that records every request and fails the run on a violation: the server answers `404 device_only`, a custody and an auth-address sign-in verify with exactly the expected chain calls, a wrong account and a down node seal nothing, the validator's record is 1,024 bytes for a signed-in profile and one that did not sign in alike, persistence through a passkey save and the 24 words, the override rule, and no account number, name, address or token in any log |
| `scripts/smoke-x.mjs` | the production-shaped pair, or a deployment (`EXPECT_X_INDEX=built` or `absent`) | Bring your X on the public shape: the list's state matches the expectation, a fresh browser imports the synthetic archive in the tab, Keep survives a reload, a follow is refused on the preview, and the browser requests nothing from Farcaster's own servers |
| `npm run smoke:deployed` | real URLs (`BASE_URL`, `VALIDATOR_URL`, `EXPECT_FC_READ`, `EXPECT_SIWF_RELAY_HOST`, `EXPECT_SIWF_RPC_HOST`) | numbered checks, now 9 (check 9: the deployed server answers Sign in with Farcaster `404 device_only`, and the booted device reports the relay and node hosts without calling either): landing (with the docs door to `/docs`), a cold device boot, a persona, a post round trip, the docs at `/docs` (the HTTP contract, light, and a browser load with no console error or policy violation), signed liveness, dev routes refused, two independent roots; plus page content and the relay's expected state |
| `test:owner-scripts` | fakes only | the owner's PowerShell scripts end to end in Windows PowerShell 5.1, against a fake Railway CLI first on `PATH`, fake apps on free loopback ports and a fake `.env.local`. The console starts with a byte-order mark, as the owner's does, to prove the scripts strip it. |

The overnight builds of 2026-10-08 add rig suites for the sweep: `test:world-empty` (`accept-world-empty.mjs`, 36 checks, run on the rig), and `test:fc-buttons` and `test:connect` (`accept-fc-buttons.mjs`, `accept-connect-main.mjs`: written, not yet run). How to start the production-shaped pair is on [Running it](./running.md).

## The closing bar

A pass is closed when the full sweep is clean four consecutive times on identical code, `tsc` is clean, the production build is clean, and the production-shaped suites and the deployed smoke pass on the same commit. A product failure halts the series and is recorded, not patched blind. A fix to the test harness restarts the series on the fix commit. {cite: notes/reports/REPORT-CUSTODY.md > "/verify — the closing bar"}

| Pass | Closing commit | Sweep |
|---|---|---|
| Browser keystore | `7e621ba` | 585 checks over 78 suites, four times |
| Post-deploy | `e2d909e` | 623 checks over 83 suites, four times |

{cite: notes/reports/REPORT-POST.md > "/verify — the closing bar"}

The harness that restarts the pair between sweeps, waits for both signed liveness probes and guards against orphaned processes lives outside the repository; `scripts/sweep-x.sh` is the sweep itself. Each closing pass also gets three adversarial reviews by reviewers who did not write the code, and since the post-deploy pass every fix is re-verified by someone who has not read the report. On the first round, the verifiers scored the 47 findings 4 fixed, 24 partial and 19 open. {cite: notes/reports/REPORT-POST.md > "Gate 5, second round: every finding re-checked by somebody who was not me"}

## What the leak greps look for

- **Every sweep** greps the validator's whole database, both process logs, the envelope on the wire and every line the browser device printed, for each seed, key-encryption key, PRF output, provider export, persona key leaf and device key the devices under test used. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Linkage tests, v1 to v5,** assert from the validator's data alone that personas of one root are not joined. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- **`test:no-keystore`** starts a production server on an empty directory and asserts it stays empty.
- **`scripts/audit-secrets.mjs`**, inside `test:cu4`, reads every value in `.env.local` and searches the built output and `public/device/device.js` for it. With nothing to search for, it says COULD NOT RUN or NOT AUDITED rather than passing.
- **The root reads ledger** lists every read of persona to root and is closed by a grep that fails when a new module reads a root without a ledger entry. {cite: docs/root-reads.md > "D. The grep that closes Gate 1"}
- **Restart survival** kills both servers as a process tree, restarts them and checks that state, the vault, personas and the saved identity came back; total device loss is re-run for each recovery path. {cite: notes/reports/REPORT-B.md > "RESTART-SURVIVAL — EXTENDED (15/15)"}

## Rules the harness learned the hard way

- **Pinned ports and signed liveness.** Another project's dev server once took port 3000 in the middle of a sweep. The app and validator now run on 3001 and 4001 and answer a signed health payload, so a stranger on the port reads as down. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- **Retry writes through adapters.** The mocks fail 2% of calls by design. A test that creates state must retry, and must retry on content, not only on status: a fan-out route can return a valid 200 that is missing one item.
- **Poll for settled content.** A placeholder can be byte-identical to a real state. Fold the assertion into the poll.
- **Ask what would make a check go red.** An absence check passes on a 404; a screenshot proves nothing without an assertion; a denylist misses fields added later, so prefer an allowlist.
- **Orphaned validators.** The sweep's last suite kills the validator, and its child can outlive the parent and hold port 4001. Check that the listener has a live parent before trusting a run.
- **Reset does not clear validator tables.** `resetSeed` clears adapter state but not, for example, `blocks_v2`. Rows piled up over 15 sweeps and emptied a fixture feed. Purge before a closing series.
- **One harness at a time,** launched only after the previous one has printed its exit. Reading a partial log as a final one killed a sweep in flight.
- **Keep the machine awake.** A sleeping laptop shows up as `net::ERR_NETWORK_IO_SUSPENDED`.
- **Read the per-suite lines.** `run-prod-shape.sh` exits 0 even when a suite fails, and a piped exit code is the last command's.
- **Windows.** `2>/dev/null` inside a Node `execSync` string fails in `cmd.exe`, and with an empty-output fallback the check passes over nothing.

## The docs are tested too

`npm run docs:check` fails a paragraph that makes a privacy claim without a citation, a citation whose heading does not exist, and any public link into the internal section. `npm run docs:sync` hashes every cited section and fails on drift until someone re-reads the citing page and re-locks. `test:m2g8` builds the site and checks that no internal page leaks into it. `npm run build` runs the same kind of guard on the build the app serves, and fails on an internal page, the internal section's path, a platform hostname or a link that leaves `/docs/`. `test:cu6` checks that nothing from `docs/` reaches the Next bundle and that `/docs` keeps its contract; the shared probes are in `scripts/lib/docs-probe.mjs`.
