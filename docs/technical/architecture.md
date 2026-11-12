# Architecture

One codebase runs in three shapes. Which machine holds the root seed decides everything else.

::: info Status
This page was first written against the public preview at commit `48d0edf` and the owner service at `e749cc9`. Five builds of 2026-10-08 went out to both sites with `fe780a2` on 2026-10-10: the empty world (`LAYERS_WORLD=empty`), the owner's Face ID / fingerprint sign-in, the app's buttons going to Farcaster, the QR connect flow and the anon arm script; each stays **Built, test data only** until the owner has looked at it on the deployed service. The persona launch pass's first wave (2026-10-10: Sign in with Farcaster with Face ID first, Bring your X v1, persona-scoped anon posting) was deployed to both sites on 2026-10-11, still **Built, test data only**. Its second wave (2026-10-12: rings, reach tiers, launch on a simulated registrar) was deployed to both sites on 2026-10-12, still **Built, test data only**. Status words follow the site legend: **Works live**, **Built, test data only**, **Designed**, **Off on purpose**, **Coming soon**, **Not offered here**.
:::

## At a glance

<ol class="flow">
<li><strong>A page loads</strong>The server sends a shell. On the public preview it has no identity to fill it with.</li>
<li class="flow__us"><strong>The device boots in the tab</strong><code>device.js</code> restores your root from IndexedDB, or mints a fresh one in memory.</li>
<li><strong>The page calls <code>/api/*</code></strong>A patched <code>fetch</code> hands the request to the same route handler, running inside the tab.</li>
<li><strong>State is sealed</strong>Each namespace leaves the tab as one encrypted record under a signed envelope.</li>
<li><strong>The validator stores it</strong>Ciphertext, public keys, commitments and membership trees, keyed by your root's public anchor.</li>
</ol>
<p class="flow__note">This is the public preview. On the owner service and the laptop rig, step 2 happens in the server process, and the server answers <code>/api/*</code> itself.</p>

<figure style="margin:28px auto 8px;max-width:460px">
<svg viewBox="0 0 440 470" width="100%" role="img" aria-label="Request path on the public preview: the page calls the device in the same tab; the device writes sealed state to the validator; only live reads go through the app server to Farcaster." style="color:var(--vp-c-text-1);font-family:inherit">
<defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--vp-c-text-3)"/></marker></defs>
<rect x="10" y="10" width="420" height="208" rx="12" style="fill:none;stroke:var(--vp-c-divider);stroke-dasharray:5 4"/>
<text x="24" y="31" font-size="11.5" letter-spacing="0.06em" style="fill:var(--vp-c-text-2)">YOUR BROWSER TAB</text>
<rect x="30" y="42" width="380" height="58" rx="10" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-divider)"/>
<text x="46" y="66" font-size="15" font-weight="600" fill="currentColor">The page</text>
<text x="46" y="87" font-size="12.5" style="fill:var(--vp-c-text-2)">server-rendered shell; islands call fetch('/api/…')</text>
<line x1="220" y1="100" x2="220" y2="128" stroke-width="1.5" style="stroke:var(--vp-c-text-3)" marker-end="url(#arch-arrow)"/>
<text x="230" y="119" font-size="11.5" style="fill:var(--vp-c-text-2)">answered in the tab</text>
<rect x="30" y="132" width="380" height="72" rx="10" stroke-width="1.6" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-brand-1)"/>
<text x="46" y="156" font-size="15" font-weight="600" fill="currentColor">The device (device.js)</text>
<text x="46" y="176" font-size="12.5" style="fill:var(--vp-c-text-2)">keystore, vault, adapters, and</text>
<text x="46" y="194" font-size="12.5" style="fill:var(--vp-c-text-2)">107 of the 119 API route handlers</text>
<line x1="112" y1="204" x2="112" y2="268" stroke-width="1.5" style="stroke:var(--vp-c-text-3)" marker-end="url(#arch-arrow)"/>
<text x="120" y="242" font-size="11.5" style="fill:var(--vp-c-text-2)">signed envelopes</text>
<line x1="327" y1="204" x2="327" y2="268" stroke-width="1.5" style="stroke:var(--vp-c-text-3)" marker-end="url(#arch-arrow)"/>
<text x="335" y="242" font-size="11.5" style="fill:var(--vp-c-text-2)">POST /api/fc/read</text>
<rect x="10" y="272" width="205" height="86" rx="10" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-divider)"/>
<text x="26" y="296" font-size="15" font-weight="600" fill="currentColor">Validator</text>
<text x="26" y="318" font-size="12.5" style="fill:var(--vp-c-text-2)">sealed state, public keys,</text>
<text x="26" y="336" font-size="12.5" style="fill:var(--vp-c-text-2)">trees and commitments</text>
<rect x="225" y="272" width="205" height="86" rx="10" style="fill:var(--vp-c-bg-soft);stroke:var(--vp-c-divider)"/>
<text x="241" y="296" font-size="15" font-weight="600" fill="currentColor">App server</text>
<text x="241" y="318" font-size="12.5" style="fill:var(--vp-c-text-2)">pages, liveness, passkey</text>
<text x="241" y="336" font-size="12.5" style="fill:var(--vp-c-text-2)">release, the read relay</text>
<line x1="327" y1="358" x2="327" y2="398" stroke-width="1.5" style="stroke:var(--vp-c-text-3)" marker-end="url(#arch-arrow)"/>
<rect x="225" y="402" width="205" height="58" rx="10" style="fill:none;stroke:var(--vp-c-divider);stroke-dasharray:5 4"/>
<text x="241" y="426" font-size="15" font-weight="600" fill="currentColor">Farcaster, via Neynar</text>
<text x="241" y="446" font-size="12.5" style="fill:var(--vp-c-text-2)">read-only, when armed</text>
<text x="18" y="420" font-size="12" style="fill:var(--vp-c-text-2)">No line goes from the tab</text>
<text x="18" y="438" font-size="12" style="fill:var(--vp-c-text-2)">to Farcaster: the preview</text>
<text x="18" y="456" font-size="12" style="fill:var(--vp-c-text-2)">publishes nothing.</text>
</svg>
<figcaption style="font-size:13px;color:var(--vp-c-text-2);text-align:center">The public preview's request path. The dashed outline is your tab; the dashed box at the bottom is the Farcaster network, reached only through the read relay.</figcaption>
</figure>

## Three shapes

| | Public preview | Owner service | Laptop rig |
|---|---|---|---|
| What it is for | strangers try Totem with an identity of their own | the owner posts to real Farcaster | development and the test sweeps |
| Railway project | `layers-preview`: `app` and `validator` | `layers-owner`: `owner-app` and `owner-validator` | none |
| Who holds the root seed | the visitor's browser tab | the owner app, on a Railway volume | the server process, in `.keystore/` |
| Who answers `/api/*` | the device in the tab | the server | the server |
| Who can reach it | anyone with the URL | the owner, behind a passphrase | localhost |
| Content | the demo corpus; live Farcaster reads are built and **Off on purpose** until the owner arms them | the empty world (`LAYERS_WORLD=empty`, deployed 2026-10-10, not yet looked at); live content optional | the demo corpus |
| Writes to Farcaster | none: the boot contract refuses every write switch | through one write door, armed on 2026-10-07; the app's Post, Like, Recast and Follow buttons go through it in the buttons build (test data only, deployed 2026-10-10, not yet used) | the fixture transport, unless live keys sit in `.env.local` |
| Status | **Works live** at `48d0edf` | **Works live** for its one user at `e749cc9`; persona accounts **Built**, none created yet | works on any machine with Node 24 |

One function decides which shape a process is in: `isPublicDeployment()` in `lib/platform/env-contract.ts`, with a CommonJS copy in `validator/env-contract.js`. It is true when `NODE_ENV=production` and `ZK_DEV_HOOKS` is not `true`. True means the public shape: the server holds no identity, the boot contract runs, and the device takes over. False means the rig shape: the server holds a keystore. A rig-shaped process on a hosting platform is the owner service, and it boots only behind a passphrase and a private validator. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"} {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## The public preview: your browser is the device

The rule this shape exists to enforce: the server holds no root, seed, vault key or persona private key, for anyone. Ciphertext, commitments, public keys and public state are the server's; everything else lives in the tab. {cite: docs/custody-model.md > "The one rule"}

Three decisions from the browser keystore pass make that work without rewriting the app. {cite: docs/custody-model.md > "Where things live"}

- **The device is the browser (D-CU-0-2).** The adapters, the store, the vault, persona signing, the ZK client, feed building and search all run in the tab. `scripts/build-device.mjs` bundles them with esbuild into `public/device/device.js`, behind small shims for `next/server`, `next/headers`, `server-only`, `react` and `node:*`.
- **The browser serves its own API (D-CU-0-3).** `lib/device/host.ts` patches `window.fetch`, so a same-origin request under `/api/` goes to the bundled route handler in the tab. The route table (`lib/device/routes.generated.ts`) is generated from the filesystem, so a new route is picked up by the next build. Eight entries stay on the server, each covering its subtree: `health`, `dev/live`, `custody/passkey/challenge`, `custody/passkey/release`, `owner-login` (which keeps `owner-login/passkey/options`, `passkey/verify`, `security` and `state` out of the bundle too), `fc/read`, `fc/connect` and `fc/connector` (the connector-account setup: its signing code stays out of the public bundle; the rule is exact-or-child, so `fc/connect` does not cover it and it is named). That leaves 111 of the 123 handlers in the tab (the persona launch pass added device routes such as `fc/siwf`, `personas/post-mode`, `x/identity`, `x/match`, `rings`, `reach` and `launch`, and in wave 3 `x/outbox`, which answers "not on this preview" in the tab).
- **The server renders public state only (D-CU-0-4, built in the prod-live pass).** Pages under `app/(main)` render a shell. Anything that needs your identity is a client island that reads through `lib/client/useApiJson.ts`. On the rig the server passes the same island its data as `initial`, so the 83 rig suites still exercise the components.

The app server keeps two secrets, each a platform variable: `CUSTODY_RELEASE_SECRET`, from which the passkey wrap path derives release keys, and `NEYNAR_READ_API_KEY` once the owner arms live reads. The validator keeps one anchor per root, device public keys and delegations, one sealed record per namespace per anchor, the ZK trees, and the custody and linking relay rows. It caps new identities at 100 per address per day and signed writes at 2,000 per device per hour. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The owner service: a hosted rig for one person

The owner service is a second app and validator pair on Railway, in rig shape on purpose. The app holds the owner's seed on a volume, derives each persona's Farcaster custody and signer keys, and publishes through Neynar managed signers. It is the one named exception to the one-rule above, decision D-PRODLIVE-OWNER-SERVICE. {cite: notes/runbooks/PREVIEW-READINESS.md > "Addendum (2026-09-23) — D-PRODLIVE-OWNER-SERVICE: the honest substitute, built for one person"}

- **Images.** `railway/Dockerfile.owner-app` bakes `ZK_DEV_HOOKS=true` in at build time and at run time, so the image is rig-shaped by construction. `railway/Dockerfile.owner-validator` runs the boot contract as its own step, seeds an empty database once, then starts the supervised validator.
- **The gate.** `middleware.ts` answers every page and route only to a request carrying a live owner session cookie: `__Host-` prefixed, httpOnly, `v2.<issued>.<expiry>.<epoch>.<method>.<nonce>.<HMAC>` under a key derived from the passphrase, good for `OWNER_SESSION_DAYS` (default 30, cap 90) per device for a browser sign-in and 24 hours for a script's, and live only while its epoch is the volume's current one and, for a passkey session, that passkey is still registered. The owner signs in with the passphrase or, once added on that device after a passphrase sign-in, with Face ID / fingerprint (a WebAuthn passkey); Settings › Security removes a passkey, signs out one device or every device. Exempt by exact path: `/api/health`, the login page and route, the two passkey sign-in routes (metered like the passphrase) and the icon; `GET /api/owner-login/state` answers only the middleware's own loopback read. The passkey build was deployed on 2026-10-10 and has not been used there yet.
- **The boot refusals.** On a hosting platform the app exits with code 78 without an `OWNER_ACCESS_SECRET` of at least 16 characters, with a public-looking `VALIDATOR_URL`, or with `NEXT_PUBLIC_VALIDATOR_URL` set. The validator exits 78 unless `LAYERS_PRIVATE_NETWORK_ONLY=true` and the platform reports no public domain or TCP proxy for it.
- **Writes.** Every Farcaster write goes through `lib/fc/writes.ts` and the ledger in `lib/fc/writeLedger.ts`: ledger before network, check before retry, 10 casts and 30 actions a day by default.
- **What it is not.** The privacy label's conditions are not met on this deployment. It is a posting tool for its owner, not a privacy demonstration. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

**The empty world.** `LAYERS_WORLD=empty` on the owner app hides the demo world without deleting it, in three layers. The demo data files are not loaded (each reader takes an empty twin through `bank()`). The demo seeders in `hydrate()` and `validator/seed.js` do not run. Stored demo rows are partitioned when the store hydrates: an entry stays visible only if every persona it names is one the keystore minted (`p_` plus 32 hex), and hidden rows are merged back into every write so they survive byte for byte. A public deployment refuses the flag at boot. Status: built with `scripts/accept-world-empty.mjs` (its review's fixes in), deployed to the owner service on 2026-10-10 and not yet looked at there. Under it the owner's first persona is made in Settings › Account & Personas, and the validator's fixture roster is not needed.

## Persona launch, wave 1: where each new piece runs

Built on test data, 2026-10-10. The rule the public shape exists for still decides the placement: anything that needs a key or a user's identity runs in the device, and the public server holds nothing new.

- **Sign in with Farcaster** runs entirely in the browser device on the public site: the device opens the relay channel, verifies the signed message, checks the account on Optimism with one `eth_call`, and seals the binding into `accountLinks`, a namespace every root writes at boot at exactly 1,024 bytes. The public server answers its route `404 device_only` before reading a body; the owner service refuses it; the rig serves a fixture relay and chain. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
- **Bring your X** splits three ways: the browser PAGE reads the archive (only parsed lanes leave the reader); the device (or the owner app's server) seals what is kept as chunked documents, under the new 256 KiB body limit; the VALIDATOR builds the keyless list of Farcaster-verified X accounts nightly when `VALIDATOR_X_INDEX=on` and serves it whole, and the device matches locally. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
- **Persona-scoped anon posting** changes the scope on both sides to `anon-post/w<n>/s<i>` (a DELIBERATE DUPLICATE in `lib/zk/scopes.ts` and `validator/zk.js`), keeps the persona inside the sealed reveal record only, adds the post mode to the keystore and rosters, and sets the relay cadence by shape. Migration 21 adds `tree` and a reserved `note` column; migration 22 adds the index's tables. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

## Persona launch, wave 2: where each new piece runs

Built on test data and deployed to both sites on 2026-10-12, only run on test data so far. The same placement rule holds, and the public server still holds no key.

- **Rings** run in every device (the browser device on the public site, the server on the rig and the owner service): the device keeps the sealed `rings` namespace (every device writes it once, padded), seals HPKE envelopes and publishes them device-signed, padded to multiples of 4, to the VALIDATOR's ring drop (`validator/ringdrop.js`, migration 23), and on every prefetch tick reads the whole drop and the public anon list, unsigned, keeping what it received in memory only. Every anon post carries a 256-byte ring note, bound into the proof. The `/d` link card sits outside the app group, like `/help`: no device boots. On the owner service the drop is that service's own validator. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **Reach tiers** are two issuers on the device's co-hosted issuer path (`fc.reach`, `x.reach`; fixture facts in sweeps), a pure module that decides what to offer and how to label (`lib/reach/trees.ts`, `lib/reach/boost.ts`, browser-safe for the later in-tab prover), the gate and prover refusing a tier under the floor, and the VALIDATOR refusing it again on the frozen tree's size and recording `tree_size` (migration 24). The For You boost is computed in `lib/feed.ts` from public rows. In the public site's browser device both issuers refuse to register or issue (D-REACH-ISSUER-HOST-ONLY: `HOST_ONLY_ISSUERS` and `issuerUnavailableHere` in `lib/attest/registry.ts`, checked first in `lib/attest/subject.ts`), because there the issuer key would be the visitor's own; reach tiers on the public site wait for an issuer Totem runs. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
- **Launch** runs in the device (the preview, the confirm, the request signed by the persona's derived keys, the tick that walks a launch to the end) and in the VALIDATOR's simulated registrar and chain (`validator/registrar.js`, `validator/simchain.js`, migration 25), which take the request inside the anon-submit nullifier transaction and batch it on their own sim clock. The thin relay (`lib/fc/thinRelay.ts`) and the chain reader (`lib/fc/chain/*`) are fixture seams that refuse live. The public site refuses launch ("Launch isn't on this preview yet."); the owner service's live universe refuses it until the registrar exists. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## Persona launch, wave 3: where each new piece runs

Built on test data on 2026-10-13, not deployed yet. The placement rule still holds: the public server holds no key, and what a stranger proves is proved in the stranger's tab.

- **The browser prover** runs in a second bundle, `public/device/prover.js` (built by `scripts/build-device.mjs` from `lib/zk/prover/browser-worker.ts`), as a same-origin module Web Worker, one job per worker (`lib/zk/transport/browser.ts`). Every tab loads `prover.js` at boot (and, in the live universe, the proving files), whether or not it will prove, and starts each worker from a Blob URL of those bytes, so no proof makes a request; a real proof gets the boot-loaded files in its job, and the worker pin-checks them while its own fetch refuses. `lib/zk/transport/index.ts` picks it whenever the device runs in a browser, in both universes; a server-side device keeps the forked child for live proofs. `device.js` never carries snarkjs, and the build enforces a size budget on both bundles (D-PROVER-BUNDLE-BUDGET). The pinned proving files are copied to `/device/zk/` at build only when present and verified; a deployed build has none (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY). {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **The browser anonymous channel** (`lib/zk/anon/webChannel.ts`) is what `lib/zk/anon/relay.ts` picks in a tab: the browser's own request with its identifying parts pinned off, to the validator's web routes (`POST /zk/anon/web`, `GET /zk/anon/web/head` in `validator/anon.js`), or OHTTP encapsulated in the tab. The device's `node:http` shim still refuses, on purpose: a path that reaches it in a tab fails loudly. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **One switch** (`lib/zk/anon/availability.ts`) answers "is anonymous posting on here?" for the gate and the route, with three host shapes: the browser device (test universe on, preview only; live off), a server-side device (`ZK_ANON_POST`, else `ADAPTER_REP=zk`), and a public deployment's server (off: it holds no identity). `lib/device/deviceEnv.server.ts` forwards the switch and the relay hints to the tab. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **The X outbox** runs on a server-side device and in the VALIDATOR (`validator/xoutbox.js`, migration 26): the device proves an `x-anon-post` claim and sends it over the anonymous channel; the validator queues it for a moderator and relays approved copies through a fixture transport. Not offered in the public site's browser device (D-X-PUBLIC-OFF). {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

The next seams: the drop on the public validator for owner-service rings (A-RING-OWNER-SERVICE-DROP), an issuer Totem runs for reach tiers on the public site, a public @anon for strangers' live posts (O2), a live X transport (O4), and the live registrar, key-registry read and thin relay (O1, F25).

## The laptop rig

The original shape. The Next server holds `.keystore/`, the mock adapters add 200 to 1,500 ms of latency and fail 2% of calls on purpose, and every network transport defaults to a deterministic fixture. The 83 suites of the closing sweep measure this shape; the production-shaped suites measure the other one ([Testing](./testing.md)). With live keys in `.env.local`, the rig can publish real casts through the same write door the owner service uses.

## The layers inside one process

Read outside to in. The adapter seam from the v2 architecture still holds; what changed is where it runs. {cite: ARCHITECTURE.md > "Layers, outside → in"}

| Layer | What it does |
|---|---|
| `app/(main)/**` | Pages. On the public preview, shells plus client islands. |
| `components/**` | Client components. Islands read identity-bearing data through `useApiJson`, which turns a failed read into an error, not an empty list. |
| `app/api/**/route.ts` | 119 route handlers. The same modules run in Node (rig, owner service) or in the tab (public preview). |
| `lib/adapters/types.ts` | The contract. UI code depends only on these interfaces. |
| `lib/adapters/registry.ts` | Binds each slot by environment: `ADAPTER_PERSONA` (mock or validator), `ADAPTER_REP` (mock, validator or zk), `ADAPTER_IDENTITY`. Everything defaults to mock. |
| `lib/adapters/mock/*` | The working implementations. `store.ts` holds state in memory; `persist.ts` flushes namespaces to the validator. |
| `lib/vault/vault.ts` | Seals each namespace whole, padded, before it leaves the process. |
| `validator/` | Express and `node:sqlite`: multi-anchor state, ZK trees and the anonymous channel, custody records, caps, backups. |

The registry binding is chosen per process and defaults to mock, because the seeded personas live in the seed files, not in the validator's database. {cite: ARCHITECTURE.md > "Registry"} The generated [adapters page](./adapters.md) lists every interface from source.

## The identity model, in one screen

The v3 architecture states four invariants: posts are public, linkage is private, disclosure is consent, betrayal is survivable. {cite: notes/design/architecture-v3.md > "The thesis, stated as invariants"}

- **The grant is the atom.** Every disclosure reduces to a signed pairwise grant from one persona to a sibling, with an audience. Public is one grant to everyone, opt-in is one grant that resolves on request, whitelist is one grant per named viewer, and hidden is the absence of any grant. {cite: notes/design/architecture-v3.md > "The grant is the atom"}
- **Three account types.** A public persona can post to Farcaster. A private persona writes to the local store only, refused at the adapter layer. The root posts nothing and is rendered nowhere. {cite: notes/design/architecture-v3.md > "Three account types"}
- **Blocks are pairwise.** A block names two personas, not two roots, and fans out only to siblings the viewer can resolve through grants. {cite: notes/design/architecture-v3.md > "Blocking, without roots"}
- **One identity renderer.** Every surface that draws an identity goes through `PersonaResolver` (`lib/identity/resolver.ts`), which falls back to the bare persona when a grant check errors. {cite: notes/design/architecture-v3.md > "One identity renderer"}

Since v3, three things moved. The keystore left the server for the browser (above). Migration 006 removed the validator's persona-to-root map, and tier membership is proven with Semaphore v4 proofs ([ZK layer](./zk-layer.md), [the fan-out memo](/fanout-under-zk)). And grants still resolve only inside the process that holds the issuer's vault, so a whitelist works within one deployment; the cross-deployment version is **Designed**. Keys and derivations are on the [key hierarchy](./key-hierarchy.md) page and in the [custody model](/custody-model).

## Known gaps

- **Saves could fail without a sound (fixed, deployed 2026-10-11, test data only).** `flush()` used to go through `vfetch`, which returns null on any non-OK answer, under `express.json()`'s default 100 KB limit. Now the limit is 256 KiB on every JSON route, the client checks a body's size before sending and throws a `PersistError` naming the namespace, and the validator answers `413` in JSON. Deployed to both sites on 2026-10-11; it has not yet met a real archive. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
- **The owner app's buttons have not posted for real.** The composer, likes, recasts and follows now go through the write door for a persona with its own account and say where each post went (`app/api/actions/farcasterDelivery.ts`); the build is **Built, test data only** (48 node-only checks against a fake Neynar), was deployed to the owner service on 2026-10-10, and waits for a persona with its own account and a first real post. Until then a post from the app says "Saved in Totem only", and the other way out is `/api/fc/write`, which only scripts call. Undo on Farcaster (un-like, un-recast, un-follow) is not wired.
- **No content security policy on the app's own pages** beyond `frame-ancestors 'none'`, so the "any script on the origin can do what the page can" assumption rests on the app serving no third-party script (A-CU-6-NO-CSP-YET). The docs, which the app serves at `/docs`, carry a strict policy of their own and share the origin (A-DOCS-UNDER-APP-SHARES-THE-KEY-ORIGIN). {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Passkeys are bound to the host that saved them** (A-CU-6-RP-ID-IS-THE-HOST). Moving the preview to a custom domain orphans every passkey saved on the platform subdomain.
- **No social login on the public preview.** The only custody provider in the tree is the rig fixture, which the boot contract refuses. Sign in with Farcaster (built, test data only) is an identity link, not a custody provider: it saves nothing. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The obvious questions

### Why does the browser answer the API instead of the server?

Because a server that decrypts your vault per request holds your vault key for that request, on a host you do not control. The fetch patch kept every component's `fetch("/api/…")` call as it was. A service worker was the alternative, and it does not control the page that registered it until the next navigation, so the first data fetch would race its install. {cite: docs/custody-model.md > "Where things live"}

### Does the public server see my seed?

No. The seed is generated in the tab and stays in memory until you save it; saving wraps it under a passkey or shows it to you as 24 words. A production server refuses to open or write a keystore at all, and a probe in the test suite asserts it stays empty. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Then why may the owner service hold a seed?

It is one person's own seed on one person's own pair, a scoped exception with its costs written down: the platform operator, or anyone who takes over the owner's Railway account, can read the volume (A-PRODLIVE-THE-HOST-HOLDS-THE-SEED), and the passphrase, or a Face ID / fingerprint sign-in added from it, is the whole account: alternatives, not two factors (A-PRODLIVE-THE-PASSPHRASE-IS-THE-ACCOUNT). {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

### Can the public preview post to Farcaster?

No. Both processes exit with code 78 if `NEYNAR_API_KEY`, `ENABLE_FC_WRITE` or any other must-not-ship name is set ([Environment variables](./env.md)). A like, recast, reply or follow aimed at a real Farcaster cast answers 403 `NETWORK_READ_ONLY` with one fixed sentence. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

### Is this the architecture strangers will post through?

Not yet. Posting as a persona's own account from the public site needs onchain account registration and a decision on who pays for it; that pass is **Designed**, not built. Posting as your OWN existing account is deployed and switched on, with no real approval yet (2026-11-05): the browser signs with a key from your vault and the validator's thin relay passes each message to a Farcaster node unchanged ([Post as you](/mechanism/post-as-you)). {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"} Anonymous posting is the other exception being built: a stranger's tab proves and sends it itself (wave 3, test data only, not deployed), and its posts stay inside the preview until a public @anon exists. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(h) The public site: what it does now, and what comes next for strangers"}

## Where it lives in the code

- [Code map](./code-map.md): every directory and the modules that matter, one line each.
- [Data flows](./data-flows.md): a request through the device, a post, a relay read, an account acquisition, an anonymous post.
- [Adapters](./adapters.md), [Data model](./data-model.md) and [ZK scopes](./scopes.md): generated from source on every docs build.
- [Running it](./running.md), [Testing](./testing.md), [Deploying](./deploy.md), [Environment variables](./env.md).
- [Tradeoffs](./tradeoffs.md): the major decisions, with the options that lost.
- [Custody model](/custody-model), [Root reads ledger](/root-reads), [Fan-out under ZK](/fanout-under-zk).
