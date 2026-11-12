# Code map

Where things are, one line each. Start with the six files in the first table; the rest is reference.

::: info Status
Written against commit `48d0edf` plus the working tree of 2026-10-08 (the empty world, the owner passkeys, the Farcaster buttons, the connect flow, the anon arm script and the Help page), all of it deployed with `fe780a2` on 2026-10-10. Three pages on this site are generated from source and stay current by construction: [Adapters](./adapters.md), [Data model](./data-model.md) and [ZK scopes](./scopes.md). This page is written by hand and can lag.
:::

## At a glance

<ol class="flow">
<li><strong>Page</strong><code>app/(main)/…/page.tsx</code> renders a shell, or the whole page on a rig.</li>
<li><strong>Island</strong><code>components/…</code> reads <code>/api/*</code> through <code>lib/client/useApiJson.ts</code>.</li>
<li class="flow__us"><strong>Route</strong><code>app/api/…/route.ts</code>, in Node or in the tab.</li>
<li><strong>Adapter</strong><code>lib/adapters/registry.ts</code> picks the implementation; the store holds state.</li>
<li><strong>Validator</strong><code>validator/server.js</code> keeps the sealed copy.</li>
</ol>
<p class="flow__note">A request follows this path in every shape. Only where step 3 runs changes.</p>

## Read these first

| File | Why |
|---|---|
| `lib/platform/env-contract.ts` | `isPublicDeployment()` decides the shape; the must-not-ship list and the owner-service boot rules live here. |
| `lib/identity/keystore.ts` | The one module that touches root material. |
| `lib/crypto/kdf.ts` | The derivation tree: every key comes off the seed here. |
| `lib/adapters/types.ts` | The contract every adapter implements; UI code depends on nothing else. |
| `lib/device/host.ts` | The fetch patch that lets the tab answer its own `/api/*`. |
| `lib/fc/writes.ts` | The single seam for Farcaster writes, and its identity rule. |

## Top level

| Path | What it holds |
|---|---|
| `app/` | Next.js App Router: the landing page (`page.tsx`), the app group `(main)`, the device page `device/`, the Help page `help/`, the docs route `docs/`, the owner login `owner-login/` (with `add-passkey/`), and `api/`. |
| `components/` | React components: about 46 at the top level, plus one folder per surface, among them `help/` (the in-app explainer, fed by `lib/status/features.ts`) and `owner/` (the owner's sign-in, Add Face ID / fingerprint, the Security panel). |
| `lib/` | Everything that is not a page or a component. Most of the product is here. |
| `validator/` | The untrusted state and membership service: Express, `node:sqlite`, CommonJS. |
| `scripts/` | Acceptance suites (`accept-*.mjs`), sweeps, launchers, docs tooling, live and owner scripts. |
| `seed/` | The deterministic corpus generator (`generate.mjs`, mulberry32) and its output in `seed/data/`. |
| `fixtures/` | Recorded test data: a hand-made X archive, recorded Neynar answers, X DMs. |
| `public/device/` | `boot.js` (the early bootstrap) and `device.js` (built, untracked). `smoke.html` is a rig-only test page. |
| `railway/` | The two owner-service Dockerfiles. The public validator's is `Dockerfile.validator` at the root. |
| `docs/` | This site's source. The app's code imports nothing from it; `npm run build` builds it into `.docs-site/` (gitignored), which the app serves at `/docs`. |
| `research/` | Adversarial reviews (`attack-*.md`), the ZK research, `VERIFY-YOURSELF.md`, the pinned ceremony record. |
| Root `*.md` | Reports per pass (`REPORT-*.md`), `SECURITY-POSTURE.md`, runbooks (`GO-LIVE-*.md`, `notes/runbooks/OWNER-CHECKLIST.md`), architecture notes. Unpublished; the docs cite them. |

## `app/`

| Path | What it holds |
|---|---|
| `app/page.tsx` | The landing page. A server component with no data access, so it renders with nothing. |
| `app/(main)/layout.tsx` | The app chrome. On a public deployment it mounts the device; on the owner service it checks the session cookie itself as a second line behind the middleware. |
| `app/(main)/home`, `explore`, `notifications`, `search`, `[handle]`, `settings`, … | The X-shaped surfaces. `[handle]` catches any unknown path. `/help` is a static route outside the app group (`app/help/page.tsx`), so it renders the explainer, not a profile, and mounts no device. |
| `app/(main)/grok`, `premium`, `money`, `creator-studio`, `articles` | Placeholders that say "Nothing to see here". |
| `app/docs/[[...slug]]/route.ts` | This site, served at `/docs` from `.docs-site/`: clean URLs, the site's own 404 page, path traversal refused, and a content security policy per page whose script hashes come from the page itself. No device and no identity. |
| `app/device/page.tsx` | "Your device": the identity strip, the save picker (Face ID first), Sign in with Farcaster, and under Advanced the 24 words, restore, keep in this browser, devices and linked accounts. |
| `app/api/**/route.ts` | 119 route handlers. 107 run in the tab on a public deployment; the rest are the server-only prefixes `health`, `dev/live`, `custody/passkey/*`, `owner-login/*`, `fc/read`, `fc/connect` and `fc/connector`. |
| `app/api/actions/*` | The app's own buttons: `cast` (post, reply), `react` (like, recast), `follow`, `act-as`, and `delivery` ("where would this go?"), with the decision in `actions/farcasterDelivery.ts`. The Farcaster half is **Built, test data only**. |
| `app/api/owner-login/*` | The owner's passphrase sign-in, the passkey `options` / `verify` pair, the Security actions and the gate-state read the middleware makes over loopback. Server-only. |
| `app/api/fc/connect`, `app/api/fc/connector` | Connect your main account by QR (server-only), and the connector account's own setup: create, register, name. **Built, test data only**; `scripts/owner/arm-connector.ps1` drives the setup (its node harness `scripts/unit-connector.mjs`, 52 checks); nothing has run live. |
| `app/api/fc/read` | The live-read relay. Server-only; holds the read key. |
| `app/api/fc/write` | The Farcaster write door: cast, reply, like, recast, follow, delete. |
| `app/api/fc/persona` | Persona account records, custody signing for account creation. |
| `app/api/anon` | Queue an anonymous post as a persona (K slots per person per window); reveal one. |
| `app/api/personas/post-mode` | A persona's post mode: through @anon, Totem only, or its own account (after a launch, a required choice preset to anon). **Built, test data only.** |
| `app/api/rings`, `app/(main)/settings/rings` | Rings: make up to 16, add members by address or link, set each persona's depth, revoke; your own private addresses; what this device received. A device route on the public site. **Built, test data only.** |
| `app/d/page.tsx` | The `/d#<key>` link card for a ring member without Totem: outside the app group, no device boots, the key stays in the fragment. **Built, test data only.** |
| `app/api/reach` | The reach tiers this root holds and is offered, and the rig's fixture overrides behind `ZK_DEV_HOOKS`. **Built, test data only.** |
| `app/api/launch`, `app/(main)/launch/[personaId]` | Launch: the preview, the typed confirm, the status of a launch under way, the history quotes; refused on a public deployment and on the live universe. **Built, test data only, simulated registrar.** |
| `app/proof/[fid]` | A launched account's proof page, from public reads only: mints no root, boots no device. **Built, test data only.** |
| `app/api/fc/siwf` | Sign in with Farcaster: a device route; a public server answers `404 device_only`. **Built, test data only.** |
| `app/api/zk` | Membership registration, proof status, rig hooks. |
| `app/api/custody/*` | Save and unlock methods; `passkey/challenge` and `passkey/release` stay on the server. |
| `app/api/dev` | Rig controls (view-as, reset, failure injection). Refused on a public deployment. |
| `app/api/x/*` | X interop: import (parsed lanes, chunked saves), match (find your people), identity (the "verified on Farcaster" badge), link, migrate (rig only), sync, spend. **Built, test data only.** |
| `middleware.ts` | Rate limit (200 burst, 3 a second per address, rig exempt), the maintenance switch, the owner gate, and the trailing-slash redirect for every path but `/docs` (Next's own is off, because the docs' section pages live at a trailing slash). |
| `instrumentation.ts` | The boot check: contract violations, hosted-rig rules, the `LAYERS_WORLD` value. |

## `lib/` by job

**Shape, platform and boot**

| Module | One line |
|---|---|
| `platform/env-contract.ts` | Shape predicate, must-not-ship names, hosted-rig rules. |
| `platform/owner-access.ts` | The owner cookie (v2: issued, expiry, epoch, method) and the session checks, shared by the middleware, the layouts and the routes. |
| `platform/owner-paths.ts`, `owner-store.server.ts`, `owner-passkeys.server.ts` | The state file's path and the session lifetimes; the volume-backed gate state (epoch, passkey records) with its read-back guard and directory fsync; WebAuthn registration and assertion checks. |
| `owner/passkeyClient.ts`, `owner/sessionWatch.ts` | The browser half of the passkey sign-in (and the Signal API call); the watcher that sends a signed-out tab back to the login page. |
| `status/features.ts` | The one status list the Help page and the docs' "What works today" table both read. |
| `platform/maintenance.ts` | The static 503 page for `LAYERS_MAINTENANCE=true`. |
| `platform/preview.ts` | The docs URL and posture link, read at request time. |
| `platform/crypto.ts` | One crypto implementation for Node and the browser. |
| `platform/storage.ts`, `storage.browser.ts` | Where the device keeps small files; IndexedDB under a non-extractable wrapping key in the browser. |
| `ports.ts`, `health.ts` | Pinned ports; the signed liveness payload, which names the commit from `LAYERS_COMMIT`. |
| `world.ts`, `world-flag.ts` | The empty world: the flag, `bank()`, the persona allowlist and the stored-state partition. Deployed on the owner service on 2026-10-10. |

**The browser device**

| Module | One line |
|---|---|
| `device/entry.ts` | The bundle's entry: boot, install the host, expose `window.__layersDevice`. |
| `device/boot.ts` | Storage, root, device key and envelope, root row, first personas, viewer rewrite. |
| `device/host.ts` | The `fetch` patch and the early-request queue. |
| `device/routes.generated.ts` | Generated route table; do not edit. |
| `device/deviceEnv.server.ts` | The environment the device boots with, built once on the server. |
| `device/custody/*` | Save paths: passkey PRF, passkey wrap, provider, the 24 words. |
| `device/linking.ts`, `rootlink.ts` | Linking a second device; linking two roots (link, not merge). |
| `device/shims/*` | Browser stand-ins for `next/server`, `next/headers`, `node:*` and friends. |
| `client/useApiJson.ts` | The one way an island reads identity-bearing data. |

**Identity, keys and the vault**

| Module | One line |
|---|---|
| `identity/keystore.ts` | Root material and persona derivation; refuses to open on a production server. |
| `identity/keys.ts` | Which public key speaks for a persona; derived Farcaster custody and signer keys. |
| `identity/deviceKeys.ts` | Device keys and their delegations. |
| `identity/grants.ts`, `verifiedGrants.ts` | The grant format and its verification gate. |
| `identity/resolver.ts` | `PersonaResolver`: the one place identity becomes pixels. |
| `identity/fork.ts`, `clone.ts` | Forking (recover from a leaked link) and cloning (copy settings). |
| `identity/chrome.ts` | Persona tint and compartment mode's single chokepoint, `visibleOwnPersonaIds()`. |
| `identity/postMode.ts` | A persona's post mode and the refusals that run before anything is minted. |
| `identity/mainName.ts`, `handleStem.ts` | One main account per root, read from the connected record (server) or `accountLinks` (device); the name-stem rule; the public self's fixed sentences. |
| `identity/rootHeadshot.ts` | The root's picture from a signed-in account: the left half of the half-and-half avatar, and a ring envelope's `root` (the only way rings read the main account). |
| `crypto/kdf.ts`, `ed25519.ts`, `vaultCipher.ts` | HKDF tree, signatures (`@noble/curves`), AES-256-GCM (`@noble/ciphers`). |
| `vault/vault.ts` | `sealWhole`: one padded sealed record per namespace; the sealed namespace list. |
| `vault/chunkedDoc.ts` | Documents bigger than one PUT: sealed pieces of 96 KiB, a manifest written last, two slots, refuse-to-write until read. |
| `recovery/mnemonic.ts`, `escrow.ts` | Seed to 24 words and back; passphrase escrow. |
| `custody/release.ts`, `webauthn.ts` | The passkey wrap path's server half: assertion check and release key. |

**Membership proofs (ZK)**

| Module | One line |
|---|---|
| `zk/config.ts` | Every knob, with its default: floor 50, gate tier 2, jitter 30 s to 15 min, prefetch 10 min. |
| `zk/prove.ts`, `scopes.ts`, `nullifier.ts` | The prove pipeline, the frozen scope registry, the nullifier formula. |
| `zk/gate.ts`, `cohort.ts` | The tier gate on For You; the anonymity floor and cohort continuity check. |
| `zk/prefetch.ts`, `queue.ts` | The fixed-schedule prefetch tick and the jittered submission queue. |
| `zk/anon/*` | The anonymous channel client (proof of work, OHTTP, Binary HTTP), the anon queue, the per-cast outcome log, condition 10 as one decision (`relayAccount.ts`), the own-handle text check, the epoch-edge deferral, and `slots.ts`: the K-slot accounting and the indexed scope, pure and browser-safe. |
| `zk/registration.ts` | Registering a root in a universe, including the owner service's own root (`D-ANON-OWNER-ROOT`). |
| `zk/anonAttribution.ts` | The commit-reveal design for revealing an anonymous post. |
| `zk/anon/availability.ts` | Persona launch P7 (D-ANON-SWITCH): the one answer to "is anonymous posting on here?", for the gate and the route; the browser, a server-side device and a public server each have their rule. |
| `zk/anon/webChannel.ts` | Persona launch P7: the browser's anonymous channel, the only module that sends anything for the anonymous path from a tab (direct to `/zk/anon/web`, or OHTTP from the tab). |
| `zk/prover/browser-worker.ts`, `zk/transport/browser.ts`, `zk/transport/fixtureCore.ts`, `zk/ceremonyPins.ts` | Persona launch P7: the Web Worker prover (built into `public/device/prover.js`, GPL-3.0), the device's bridge to it (one job per worker), the test proof core shared by the node and browser transports, and the one copy of the proving files' pins. |
| `zk/config.ts` `ZK_REACH_FLOOR` | The reach-tier crowd floor (50, and at least `ZK_ANON_FLOOR`), a deliberate duplicate of `reachFloor()` in `validator/zk.js`. |
| `zk/privacy.ts`, `labels.ts` | The computed privacy label and its two strings. |
| `zk/ceremony.ts`, `artifacts.ts` | Pinned artifact and verification-key hashes; the verified artifact cache. |

**Farcaster**

| Module | One line |
|---|---|
| `fc/writes.ts` | Publish, react, follow, delete; the identity rule; check before retry. |
| `fc/writeLedger.ts` | Ledger before network; 10 casts, 10 follows and 30 actions a day by default. |
| `fc/acquire.ts`, `personaFid.ts` | Account creation (fixture half and caps); the sealed persona-to-account map. |
| `fc/custodySign.ts`, `custody/*` | Typed-data signatures by a persona's custody key; managed and self-custody signer sources. |
| `fc/readRelay.server.ts` | The public read relay: operation table, budgets, cache, mapper. |
| `fc/siwf/verify.ts`, `flow.ts`, `links.ts` | Sign in with Farcaster: the pure verifier, the flow and its fixture network, the sealed `accountLinks` record. |
| `fc/thinRelay.ts` | The thin relay for a launched (self-custody) account: forwards device-signed messages after the key-registry, signature, 10-minute timestamp and per-fid daily checks. Fixture only; refuses live. |
| `fc/chain/*` | The chain reader seam: which fid a custody address owns, a fid's signer keys, its fname. Fixture reads the validator's simulated chain; live refuses (F25), so a reveal it is unable to check renders plain anon. |
| `fc/networkTarget.ts` | Which targets belong to the network, so writes to them can be refused per target. |
| `fc/attribution.ts`, `linkage.ts` | Attribution index for published casts; the registrant-linkage assertion (its sponsor exemption is refuted onchain; the typed `SIBLINGS` / `FRESH` choice lives in `scripts/owner/acquire-fid.ps1`). |
| `fc/connect.ts`, `fc/connector.server.ts` | Connecting the owner's main account by QR, with the self-link guard the write door calls; the connector account the owner service creates and seals (custody and recovery keys in the vault, `IdGateway.register` from the custody key). |
| `adapters/neynar/*` | Content source switch (`DATA_SOURCE`) and the Neynar content mapper. |

**Adapters and state**

| Module | One line |
|---|---|
| `adapters/types.ts`, `registry.ts` | The contract and its environment binding. |
| `adapters/mock/store.ts` | In-memory state, `hydrate()`, `persistNs()`. |
| `adapters/mock/persist.ts` | Flush to the validator under a signed envelope; the 429 retry. |
| `adapters/zk/rep.ts` | The proof-mediated reputation adapter (`ADAPTER_REP=zk`). |
| `feed.ts`, `data.ts`, `session.ts`, `activePersona.ts` | The feed pipeline, the content layer, session resolution, view-as. |
| `rules/evaluate.ts` | The one predicate evaluator modes, filters and gates all call. |

**Features**

| Folder | One line |
|---|---|
| `x/` | Bring your X: `archiveZip.ts` and `archiveParse.ts` (the archive read in the page), `importer.ts`, `shelf.ts`, `follows.ts`, `indexClient.ts`, `match.ts`, `identity.ts`; plus OAuth (fixture), migration (rig only), alt-link, porting, spend. **Built, test data only.** |
| `attest/` | The open issuer interface, the onchain-facts reference issuer, and the reach issuers `issuers/fcReach.ts` and `issuers/xReach.ts` (fixture only). |
| `x/outbox/` | Persona launch P8: the @totem X outbox's device half: `policy.ts` (the text rules, a deliberate duplicate of the validator's), `request.ts` (offered here? submit, view), `moderation.ts` (the moderator key and signed decisions), `status.ts`. **Built, test data only.** |
| `rings/` | Rings: `model.ts` (the sealed document, note keys), `envelope.ts` (HPKE, the fixed 4,096-byte statement, addresses and links), `note.ts` (the 256-byte ring note), `outbound.ts` (the owner's actions), `publisher.ts` (device-signed, padded publishing), `inbox.ts`, `fetch.ts`, `received.ts` (member side, memory only), `merge.ts` (the render seams), `tick.ts` (every device, every tick). **Built, test data only.** |
| `reach/` | Reach tiers: `trees.ts` (pure: buckets, the offer, every sentence), `held.ts` (the tiers this root holds, from its own vault), `boost.ts` (pure: the For You label and head start). **Built, test data only.** |
| `launch/` | Launch: `preview.ts`, `confirm.ts`, `request.ts` (the anonymous request and its canonical form), `reveal.ts` (the batch reveal), `history.ts` (the launch cast, quotes, the proof), `tick.ts` (the uniform registrations read and the steps). **Built, test data only, simulated registrar.** |
| `influence/`, `market/`, `graph/` | Stewardship accrual and stakes; the escrow ledger; the Ad Match Score. **Simulated money.** |
| `lens/`, `algo/`, `zones/`, `actions/` | Lenses, portable algorithms, scroll zones, configurable action buttons. |
| `readwise/`, `delivery/` | Readwise knobs and dwell; per-account delivery tiers. |
| `search/` | Search over what the device holds; the local embedding is a stand-in for a real model. |
| `eventlog/`, `refutation/`, `curators/`, `packs/`, `private/`, `crosspost/` | Relationship log, refutation edges, curator feeds, filter packs, private posts, crossposting. |
| `views/` | Builders behind pages that render through islands on a public deployment. |

## `validator/`

| File | One line |
|---|---|
| `server.js` | Routes, signed-envelope checks, per-address token bucket (300 burst, 5 a second), maintenance. |
| `db.js`, `migrations.js` | SQLite through `node:sqlite`; versioned in-place migrations (21: the anon row's `tree` and `note`; 22: the X index's tables; 23: the ring drop; 24: the anon row's `tree_size`; 25: the simulated registrar, chain, spend ledger, sim clock and reveal batches; 26: the X outbox's four tables). |
| `ringdrop.js` | The ring dead drop: a device-signed PUT in multiples of 4 that swaps generations atomically, an open shuffled GET, six columns and no writer column. |
| `registrar.js` | The SIMULATED Totem registrar: the launch queue (taken inside the anon-submit nullifier transaction), the 2 to 48 hour batch on its own sim clock, the $0 spend ledger, the all-or-nothing batch reveal, the public registrations read. No live mode. |
| `simchain.js` | The SIMULATED chain: IdRegistry, KeyRegistry, StorageRegistry and the fname server, one Bundler call verifying the custody key's EIP-712 signatures, one registrar app fid. No live mode. |
| `limits.js` | `STATE_BODY_LIMIT_BYTES` (256 KiB) and the JSON 413 for an oversized body. |
| `xindex.js` | The keyless list of Farcaster-verified X accounts: the nightly crawl (`VALIDATOR_X_INDEX=on`), the gzip file, `GET /x/fc-index` and `/meta`. |
| `custody.js` | Custody method records, wrapped-seed blobs, device-link and root-link relays. |
| `zk.js` | Membership trees, registration, proof verification, the anonymous post rows and their relay (one row at a time, an `idem` key per cast, bounded retries, then `failed`), the K-slot scope, the daily cap and the relay cadence by shape. |
| `anon.js`, `bhttp.js` | The unauthenticated anonymous channel and its OHTTP gateway, and (Persona launch P7) the browser's web routes `/zk/anon/web` and `/zk/anon/web/head` with their own header policy. Logs nothing. |
| `xoutbox.js` | Persona launch P8: the @totem X outbox, fixture only: the moderation queue, signed decisions, the public list, the hourly relay through a test transport. No socket, http or fetch. Logs nothing. |
| `caps.js` | New roots per address per day (100), signed writes per device per hour (2,000). |
| `backup.js` | `VACUUM INTO` dumps every 6 hours, newest 28 kept. |
| `rep.js`, `stakes.js`, `poller.js` | Reputation model, stake events, the Neynar poller (`VALIDATOR_POLLER=off` stops it). |
| `env-contract.js` | The boot contract, CommonJS copy, plus the validator-only refusal of the read key. |
| `seed.js` | The fixture world, inserted once into an empty database. |
| `API.md` | The HTTP contract. |

## `scripts/`

| Path | One line |
|---|---|
| `accept-*.mjs` | One acceptance suite per gate, run as `npm run test:<id>`. |
| `sweep-x.sh` | One full sweep, one comparable line per suite (87 suites at the persona launch pass's start; wave 2 adds the rings, reach and launch suites and their unit harnesses). |
| `run-prod-shape.sh` | The production-shaped pair on the pinned ports. |
| `smoke-deployed.mjs` | The post-deploy check against real URLs. |
| `build-device.mjs`, `device-routes.mjs` | Build the device bundle and (Persona launch P7) the browser prover `public/device/prover.js` with its license file, stage the pinned proving files, enforce both bundles' size budgets; generate the route table. |
| `build-docs.mjs`, `docs-guard.mjs` | Build the public docs into `.docs-site/` with `SHOW_INTERNAL` removed; fail the app build on anything internal, a platform hostname or a link outside `/docs/`. Both run inside `npm run build`. |
| `start-app.mjs`, `validator-supervisor.mjs` | The app launcher with its port check; the validator supervisor with its death log. |
| `audit-secrets.mjs`, `root-leak.mjs`, `probe-no-keystore.mjs` | Leak and custody measurements. |
| `fid-acquire.mjs`, `live-*.mjs` | Live commands for the owner. They spend, and they print a cost sheet first. |
| `owner/*.ps1`, `owner/lib/OwnerCommon.ps1`, `owner/test/`, `owner/check-anon-live.mjs` | The owner's one-command scripts (`arm-owner-service`, `acquire-fid`, `arm-live-reads`, `arm-anon`, `arm-connector`), their shared preflight, their fake-only test harness, and the owner-session check of a live anon cast. |
| `unit-*.mjs`, `lib/soft-authenticator.mjs` | Node-only harnesses that run with nothing listening: `unit-owner-passkeys.mjs` (the owner gate against a software WebAuthn authenticator; `--mutate` weakens each control and every mutation must turn a check red), `unit-fc-buttons.mjs` (the real action routes bundled with esbuild against a fake Neynar), `unit-fcread-relay.mjs`, and the persona launch pass's `unit-siwf.mjs`, `unit-x-v1.mjs`, `unit-namespace-sizes.mjs`, `unit-anon-slots.mjs`, `unit-rings.mjs`, `unit-reach.mjs`, `unit-launch.mjs`, `unit-prover.mjs` and `unit-x-outbox.mjs`. `lib/net-guard.cjs` records any network call a guarded process makes. |
| `docs-generate.mjs`, `docs-check.mjs`, `docs-sync.mjs`, `docs-summary.mjs` | The docs tooling. |
| `lib/siwf-stub.mjs`, `lib/x-index-stub.mjs`, `lib/x-archive-synth.mjs` | The loopback sign-in relay and chain, the stand-in X index, and the deterministic synthetic X archive. |
| `lib/neynar-stub.mjs`, `lib/health-probe.mjs`, `lib/page-health.mjs`, `lib/docs-probe.mjs` | The loopback Neynar, the signed liveness probe, page-level health checks, and the probes of the docs at `/docs` (HTTP contract, link walk, browser walk). |

## Generated files: edit the source, not these

- `lib/device/routes.generated.ts`, from `scripts/device-routes.mjs`.
- `public/device/device.js`, `public/device/prover.js`, `public/device/prover.js.LICENSE.txt` and `public/device/zk/*`, from `scripts/build-device.mjs`.
- `seed/data/*.json`, from `seed/generate.mjs`.
- `docs/technical/adapters.md`, `scopes.md`, `data-model.md`, and the internal roadmap data, from `scripts/docs-generate.mjs`.

Every module that reads a persona's root is listed, with what it does with the answer, in the [root reads ledger](/root-reads).
