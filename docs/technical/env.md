# Environment variables

Every variable the code reads, by name only, grouped by the process that reads it and by what the public boot contract says about it. No values appear on this page, and none belong in a doc, a log or a command line.

::: info Status
Collected from the source at commit `48d0edf`, plus the working tree of 2026-10-08 (`LAYERS_WORLD`, the owner passkeys, the follow budget, the connect flow and the anon relay's retry knobs) and the persona launch pass's first wave of 2026-10-10 (Sign in with Farcaster, Bring your X v1, persona-scoped anon posting), deployed on 2026-10-11, the second wave of 2026-10-12 (rings, reach tiers, launch), deployed on 2026-10-12, and the public go-live build of 2026-10-17 (live mode, the guided start, the public @anon relay with its fid gate, filter and takedowns, the Farcaster Mini App, the public site's anonymous tree and proxy setting), not deployed yet. The two lists the processes enforce are code, not this page: `MUST_NOT_SHIP` in `lib/platform/env-contract.ts` and its CommonJS copy in `validator/env-contract.js`, which `test:cu4` asserts are identical. If this page and those files disagree, the files win.
:::

## At a glance

<ol class="flow">
<li><strong>Process starts</strong><code>instrumentation.ts</code> on the app, <code>validator/env-contract.js</code> on the validator.</li>
<li class="flow__us"><strong>Shape decided</strong>Public when <code>NODE_ENV=production</code> and <code>ZK_DEV_HOOKS</code> is not <code>true</code>.</li>
<li><strong>Public: the contract</strong>Any must-not-ship name set, or a must-be-set name missing, exits with code 78.</li>
<li><strong>Hosted rig: the owner rules</strong>A passphrase and a private validator, or exit 78.</li>
<li><strong>Boot line</strong>The log names what was refused, by name, not by value.</li>
</ol>
<p class="flow__note">A switch counts as off when it is unset, empty, <code>false</code>, <code>0</code>, <code>no</code> or <code>off</code>.</p>

## The public contract

These rules apply on a public deployment, on both the app and the validator. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

| Class | Names | What happens |
|---|---|---|
| **Must not ship**: live credentials | `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `NEYNAR_WALLET_ID`, `FC_TEST_CUSTODY_PRIVATE_KEY`, `FC_TEST_SIGNER_UUID`, `X_LAYERS_INBOX_TOKEN`, `FC_CONNECT_APP_CUSTODY_KEY`, `FC_CONNECT_APP_FID`, `X_API_CLIENT_ID`, `X_API_CLIENT_SECRET` | exit 78 if set |
| **Must not ship**: switches that turn a live path on | `ENABLE_WRITE`, `ENABLE_FC_WRITE`, `ENABLE_X_WRITE`, `ENABLE_X_READ`, `FID_ACQUIRE_ENABLED` | exit 78 if on |
| **Must not ship**: an identity pointer | `NEYNAR_VIEWER_FID` | exit 78 if set: on a process strangers reach, it would show them that account's feed and notifications |
| **Must not ship**: the Totem registrar's key | `LAYERS_REGISTRAR_PRIVATE_KEY` | exit 78 if set, on both halves. Nothing reads it this wave: the registrar is simulated. It is the wallet that will pay Farcaster's Bundler for launched accounts (the owner's O1) |
| **Must not ship**: names reserved for the parked live X and live registrar | `X_LAYERS_API_KEY`, `X_LAYERS_API_SECRET`, `X_LAYERS_ACCESS_TOKEN`, `X_LAYERS_ACCESS_SECRET`, `X_LIVE`, `X_LIVE_REPLIES`, `REGISTRAR_LIVE`, `REGISTRAR_WINDOW` | exit 78 if set (an off value boots), on both halves. Nothing in the build reads them: the code that would was parked on 2026-10-17. They stay on the list: a public process that carries one refuses to boot |
| **Refused values** | `DATA_SOURCE=neynar` or `live`; `LAYERS_WORLD=empty` (app) | exit 78 |
| **Must be set** | `LAYERS_REQUIRE_SIG=true`; `CUSTODY_FIXTURE_PROVIDER` not `allow` while `CUSTODY_PROVIDER` is the fixture | exit 78 otherwise |
| **Validator only** | `NEYNAR_READ_API_KEY` | the validator exits 78 if it holds the read key; the app may |
| **App refuses** (the public validator's credentials) | `FC_ANON_SIGNER_UUID`, `FC_ANON_NEYNAR_KEY`, `FC_ANON_SIGNER_KEY`, `FC_APP_CUSTODY_KEY` | the app exits 78 if it holds one; the public validator is where they live |

`LAYERS_WORLD` set to anything but `empty` or nothing is refused on every shape, so a typo does not leave the demo world showing.

`X_API_CLIENT_ID` and `X_API_CLIENT_SECRET` joined the list in the persona launch pass (Bring your X G0), closing the gap this page used to name; no X credential exists anywhere. The persona launch pass's Sign in with Farcaster added no must-not-ship name: the public server holds nothing new for it. Its second wave added one, `LAYERS_REGISTRAR_PRIVATE_KEY`, so the key that will pay for launched accounts can only ever live on a service the owner arms for it; rings, reach tiers and launch hold no other secret, and the ring drop has no write token. The go-live run of 2026-10-17 added eight more (the row above) for a live X transport and a live registrar on the owner's service; both were then parked, and the names stay refused on a public process.

## The owner-service rules

A rig-shaped process on a hosting platform is the owner service. The platform is detected from any of `RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, or `LAYERS_HOSTED=true` elsewhere. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

| Process | Must hold | Must not hold |
|---|---|---|
| owner app | `OWNER_ACCESS_SECRET` of 16 or more characters; `VALIDATOR_URL` naming a private host | `NEXT_PUBLIC_VALIDATOR_URL` |
| owner validator | `LAYERS_PRIVATE_NETWORK_ONLY=true` | a public domain or TCP proxy (`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_TCP_PROXY_DOMAIN`, both set by the platform) |

## App server

**Shape, boot and routing**

| Name | Notes |
|---|---|
| `NODE_ENV`, `ZK_DEV_HOOKS` | Together they decide the shape. The owner images bake `ZK_DEV_HOOKS=true` in. |
| `LAYERS_REQUIRE_SIG` | `true` makes every validator write carry a signed envelope. |
| `LAYERS_WORLD` | `empty` hides the demo world on the owner service. Deployed there on 2026-10-10; any other value, including an empty string, refuses to boot. |
| `LAYERS_MAINTENANCE` | `true` serves a static 503 on every route but liveness. Read per request. |
| `LAYERS_COMMIT` | The commit the signed health payload names; a deployed image has no `.git`. |
| `LAYERS_APP_PORT`, `PORT` | The pinned port wins; `PORT` is the platform's. |
| `LAYERS_ENV_FILE`, `LAYERS_BOOT_CHECK_ONLY` | The launcher's port check: which env file it reads, and a check-only mode. |
| `TRUST_PROXY` | `true` honours the forwarding header for rate limits; set only behind a proxy that sets it. `true` on both public services on Railway (go-live build): the public validator's anonymous web route accepts the platform edge's hop headers only under it, so without it every browser's anonymous post is refused; the rate limit then keys on the hop the edge itself added, not a forwarding entry the client wrote. |
| `APP_URL` | The app's own origin. The passkey RP id and origin come from it: the save passkey on the public preview, and the owner's Face ID / fingerprint sign-in on the owner app (unset there, passkeys are off and the passphrase still works). Public go-live: the Farcaster Mini App manifest is built from it, and the public VALIDATOR reads it too (the domain a Farcaster sign-in must name to join the live crowd). Set it to the final domain on both public services, before anyone saves a passkey. |
| `PUBLIC_LIVE` | Public go-live: `true` on both public services is live mode: no demo people, posts, trends, curators or desks; the home feed is live reads, the visitor's personas' posts and @anon posts, and the anonymous test universe is off in a tab. `false` or unset leaves it off; any other value refuses boot (the name and a length class only). On the rig and the owner service it is only a boot warning. Forwarded to the browser device as `PUBLIC_LIVE=on` only while the server's own check is true. |
| `ADS` | Ads, Phase 1, public app only: `on` turns on the house ads each visitor's device places in their Following (`lib/ads/switch.ts`). Unset, empty or `off` is DORMANT, the default a deploy ships with: no ad on any feed, and Settings, Modes says "Ads aren't running on Totem yet." beside each mode's ad setting (still editable); `/ads/lots.json` is served either way. Any other value stays off and the boot log names the variable and a length class, not the value. Forwarded to the browser device as `ADS=on` only while the server's own value is on. Before switching it on: edit `public/ads/lots.json`, sign it with `npm run ads:approve -- --new-reviewer --yes`, deploy (notes/runbooks/OWNER-CHECKLIST.md, Ads). |
| `MINIAPP_ACCOUNT_ASSOCIATION_HEADER`, `MINIAPP_ACCOUNT_ASSOCIATION_PAYLOAD`, `MINIAPP_ACCOUNT_ASSOCIATION_SIGNATURE` | Public go-live, public app only: the Farcaster Mini App's account association, a signature over the site's domain by the account that owns the Mini App. PUBLIC values that grant nothing; set by `scripts/owner/arm-miniapp.ps1`. Unset, or signed for another domain, `/.well-known/farcaster.json` is served without it and the server logs why. |
| `VALIDATOR_URL`, `NEXT_PUBLIC_VALIDATOR_URL` | Where the validator is; the second is what the browser device is told. |
| `NEXT_PUBLIC_DOCS_URL` | Leave unset. The app serves the docs at `/docs`, and the landing's docs door, Help's docs link and the banner's "what this means" point there. A value overrides `/docs`, for a future custom docs domain. Read at request time. |
| `OWNER_ACCESS_SECRET` | The owner service's passphrase. Owner app only. Rotating it ends every session and retires every passkey. |
| `OWNER_SESSION_DAYS` | Owner app: how long a browser sign-in lasts per device, in whole days. Default 30, capped at 90; a malformed value is the default. A script's sign-in lasts 24 hours whatever this says. |
| `OWNER_PASSKEYS_FILE` | Owner app, optional: where the session epoch and the passkey records live. Default beside `KEYSTORE_DIR`, so `/data/owner-passkeys.json` on Railway. No private key is in it. |
| `KEYSTORE_DIR` | Where a rig keeps its keystore; a volume path on the owner app. |

**Custody**

| Name | Notes |
|---|---|
| `CUSTODY_RELEASE_SECRET` | The public app's one custody secret: the passkey wrap path derives release keys from it. |
| `CUSTODY_ALLOWED_ORIGINS` | Extra origins allowed to ask for a release. |
| `CUSTODY_PROVIDER`, `CUSTODY_FIXTURE_PROVIDER` | The social-login adapter. Only the rig fixture exists. |

**Adapters and content**

| Name | Notes |
|---|---|
| `ADAPTER_PERSONA`, `ADAPTER_REP`, `ADAPTER_IDENTITY` | Registry bindings; all default to mock. `ADAPTER_REP=zk` makes For You eligibility proof-based. |
| `DATA_SOURCE` | `neynar` for live content on a rig or the owner service. Seed otherwise. |

**Membership proofs (app side)**

| Name | Notes |
|---|---|
| `ZK_MODE` | `fixture` or `live`: which universe proofs are made in. |
| `ZK_GATE_TIER`, `ZK_GATE_FALLBACK` | The tier the For You gate asks for; whether unproven personas fall back to policy. |
| `ZK_ANON_FLOOR`, `ZK_COHORT_MAX_CHURN` | The anonymity floor and how far a cohort may change between proofs. |
| `ZK_PROOF_BUDGET`, `ZK_EPOCH_MIN_MS`, `ZK_PREFETCH_MS` | Distinct predicates a persona may prove per epoch; the shortest epoch the client accepts from a validator; the prefetch cadence (a value of 0 clamps to 1 second; it is not off). |
| `ZK_RELAY`, `ZK_RELAY_URL`, `ZK_RELAY_THIRD_PARTY` | The anonymous channel's transport: direct, OHTTP or Tor. |
| `ZK_POW_BITS`, `ZK_JITTER_MIN_MS`, `ZK_JITTER_MAX_MS` | Proof of work and submission jitter. |
| `ZK_ANON_POST_TREE`, `ZK_ANON_POST_WINDOW_EPOCHS`, `ZK_ANON_POST_MAX_CHARS` | Anonymous posts: the tree, the window, the length. Tree and window must match the validator's. The public site runs `ZK_ANON_POST_TREE=valid` on its app and its validator (go-live build, D-PUBLIC-ANON-TREE: every registered identity, so a new one joins the crowd at the next 6-hour mark after it registers), forwarded to the browser device so the tab and the validator agree; the owner service sets `valid` through `arm-anon.ps1`. |
| `ZK_ANON_POST_SLOTS` | Persona launch P3: anonymous posts per person per window, shared across that root's personas. Default 4, an integer from 1 to 16; blank means unset (not 0). It MUST be the same on the app and the validator, or anon posting pauses and says so; the app does not adopt the validator's number for its own slot choice. |
| `ZK_REACH_FLOOR` | Persona launch P5: the crowd floor of a reach tier. Default 50, and at least `ZK_ANON_FLOOR` whatever it is set to, so the owner service's `ZK_ANON_FLOOR=1` offers no tier of one. Read the same way by the validator. Leave it unset. |
| `RINGS_PUBLISH_MS` | Persona launch P4: how often a device re-seals its rings (default one hour, with ±25 % jitter; at least one minute, so a one-minute setting can fire at 45 seconds). A test knob that nothing limits to the rig: leave it unset on a deployment. |
| `ZK_ANON_WANTED_MAX_TICKS` | How many prefetch ticks an anonymous post stays wanted through retryable stages (default 150) before it is dropped and its reveal secret discarded. |
| `ZK_ARTIFACT_DIR` | Where verified proving artifacts are cached. The build also reads it (default `.zk-artifacts`) to copy the pinned files into `public/device/zk/` for the browser prover, only when present and verified. Before the public go-live a deployed image had none; the go-live build ships them (the app's image no longer excludes `.zk-artifacts`). |
| `REQUIRE_ZK_ARTIFACTS`, `ZK_ARTIFACT_FETCH` | Public go-live, the public app's BUILD: `1` makes the build fail when the pinned proving files are absent or off-pin (bytes, sha256 and blake2b-512 against `lib/zk/ceremonyPins.ts`), so a live build stops without them; `ZK_ARTIFACT_FETCH=1` fetches them first from the pinned ceremony host when the upload did not carry them (they are gitignored). Public files, nothing secret. |
| `ZK_ANON_UNIVERSE` | Public go-live, public app: `live` tells every tab that the site's anonymous posts are live (forwarded with `ZK_MODE=live`, so every tab proves in the live universe and loads the pinned proving files at boot); a tab believes it only while the validator's config also says its relay is live. Any other value is forwarded as `invalid` and reads as not live. Set by `scripts/owner/arm-public-anon.ps1` once the validator's relay is armed. |
| `ZK_ANON_POST` | Persona launch P7 (D-ANON-SWITCH): `on` or `off`. `off` turns anonymous posting off on this app's server and in every visitor's tab (forwarded to the browser device; any other value is forwarded as `invalid` and reads as off). Unset: the public site's tabs post on test data, preview only, and the rig and the owner service keep the old rule (on only with `ADAPTER_REP=zk`). |
| `ZK_X_ANON_POST_SLOTS` | Persona launch P8: anonymous X copies per person per window, default 1, an integer from 1 to 4. It MUST equal the validator's. |

**Sign in with Farcaster** (Persona launch P1; read by the server only to build the device env's hints; the server does not verify sign-ins)

| Name | Notes |
|---|---|
| `FC_SIWF` | `off` (or any off value) hides the card. Default on. The device sees a hint, not this value: `on`, `off`, `fixture` (the rig), `owner` (the owner service, which refuses) or `bad_config`. |
| `FC_SIWF_RELAY_URL` | Farcaster's sign-in relay. Default `https://relay.farcaster.xyz`; another value is honoured only as an http(s) loopback URL, and on a hosting platform no override is forwarded at all. |
| `FC_SIWF_RPC_URL` | The Optimism node the browser checks a sign-in through. Default `https://mainnet.optimism.io`; honoured only as a bare https origin (no user, query or path) or loopback, so a keyed provider URL is refused by name and kept out of the page. |

**Post as you** (2026-11-05, built, test data only; read by the server only to build the device env's hint)

| Name | Notes |
|---|---|
| `FC_ROOT_HUB_URL` | The Snapchain node the browser reads to check its own posting key (`GET /v1/onChainSignersByFid`). Default `https://snap.farcaster.xyz:3381`. Forwarded to the device only when set AND allowed: a bare origin, https or loopback http, never on a hosting platform (there only the default). A refused value forwards `FC_ROOT_POST=bad_config` and no address, and the tab says the feature is misconfigured. The app does NOT hold `FC_APP_CUSTODY_KEY`: it refuses to boot with it. {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"} |

**Farcaster writes and accounts** (rig and owner service only)

| Name | Notes |
|---|---|
| `NEYNAR_API_KEY` | The owner's Neynar key. |
| `ENABLE_FC_WRITE`, `ENABLE_WRITE` | Real Farcaster writes; the general live-write switch. |
| `FC_TEST_FID`, `FC_TEST_SIGNER_UUID`, `FC_TEST_CUSTODY_PRIVATE_KEY`, `FC_TEST_FNAME`, `FC_TEST_ORIGIN`, `FC_TEST_CUSTODY_ADDRESS`, `FC_TEST_SIGNER_PUBLIC_KEY` | The shared throwaway account writes fall back to. |
| `NEYNAR_SIGNER_UUID` | A retired direct-publish path; its presence makes the cast route refuse. |
| `NEYNAR_VIEWER_FID` | Whose feed and notifications live content shows. Owner app only. |
| `FC_CASTS_PER_DAY`, `FC_FOLLOWS_PER_DAY`, `FC_ACTIONS_PER_DAY` | The write ledger's caps: 10 casts, 10 follows (capped by the actions cap) and 30 actions a day, per mode, shared by every account. A value that does not parse keeps the default. |
| `FID_ACQUIRE_ENABLED` | Arms account creation, only while creating. |
| `LAYERS_MAX_LIVE_PERSONA_FIDS`, `LAYERS_FID_SPEND_CAP_USD`, `FID_SPEND_CAP_USD`, `FID_CREATE_USD_ESTIMATE` | Account and spend caps, clamped to hard bounds. |
| `PERSONA_NETWORK_MODE`, `PERSONA_FID_LIVE_ONLY`, `FC_SIGNER_CUSTODY` | One account per persona or one shared; whether a new persona waits for a real account; managed or self-custody signers. |
| `FC_ANON_FID` | The anon account's fid, so the app's buttons and the write door count it as one of your own accounts (while `ZK_MODE=live` it is also read from the ZK snapshot). Owner app only. |
| `FC_RESERVED_FIDS`, `FC_LAYERS_ADDRESSES` | Further fids that are Totem's own, and Totem-controlled addresses (the Neynar App Wallet first), comma-separated: refused as a connector, and the fids as targets of a persona's one-tap actions. |
| `FC_CONNECT_APP_FID`, `FC_CONNECT_APP_CUSTODY_KEY` | The connector account for "Connect your Farcaster account", named by hand. Must not ship. The connector the owner service creates and seals itself (`lib/fc/connector.server.ts`) is the alternative; when both exist the environment wins and the sealed one refuses to be created. |
| `FC_CONNECT_RPC_URL`, `FC_CONNECT_RELAYERS`, `FC_CONNECT_SPONSOR` | The Optimism JSON-RPC (https only; default `mainnet.optimism.io`) the connect flow's chain checks and the connector setup read through, read-only except for the one `IdGateway.register` transaction the connector setup sends; a replacement list of the Farcaster relayer addresses a key add must come from; `none` makes the owner pay the key-add fee in the Farcaster app instead of Neynar sponsoring it. |

**Farcaster reads** (public app only)

| Name | Notes |
|---|---|
| `NEYNAR_READ_API_KEY` | The second Neynar app's key. Read by `lib/fc/readRelay.server.ts` alone. |
| `FC_READ_FIDS`, `FC_READ_HOUSE_FID` | The discovery source: exactly one of them. |
| `FC_READ_DAILY_CREDITS`, `FC_READ_MIN_SCORE`, `FC_READ_DENY` | Budget per instance per day; author score floor; operator denylist. |
| `FC_READ` | `off` disarms the relay and keeps the key. |
| `FC_READ_RIG`, `NEYNAR_READ_BASE_URL` | Tests only: the loopback stub. The relay refuses to arm with a base URL on a hosting platform. |
| `FC_SOURCE_FOLLOWING`, `FC_SOURCE_NOTIFICATIONS` | Neynar as a switch (`lib/fc/source/switch.ts`, built, ships unset): where Following and notifications read from. `network` only: `neynar` or `auto` is refused at boot with the sentence "would hand your account to Totem's server" and read as network (the boot goes on). Never forwarded to the browser device. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} |
| `FC_SOURCE_FORYOU` | `network` (unset, the default): the signed-in root's own For You comes from Farcaster's network and nobody else's For You reads Neynar. `neynar`: a persona's or a signed-out visitor's For You (and Explore) is the read relay's discovery list; the root's own stays on the network. `auto` = `neynar` here (the node cannot answer that For You at all). With no read key, `neynar` is off and says so. An armed `NEYNAR_READ_API_KEY` alone no longer puts Neynar on For You. Forwarded to the device only as `neynar` or `auto`. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} |
| `FC_SOURCE_SEARCH` | `network` (unset, the default): search reads the device only (the node has no search). `neynar` or `auto`: after the device's results, posts and people through the relay's search ops, labelled Via Neynar; the query only, never a fid, a persona or a list, and a query that names one of the visitor's own accounts is never sent. Off with no read key, said. Forwarded to the device only as `neynar` or `auto`. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} |
| `FC_SOURCE_COUNTS` | Like and recast totals: network only, where there are none (unavailable). `neynar` or `auto` is refused at boot: a count read names the posts on the visitor's screen. Posts that arrive via Neynar carry Neynar's totals in the same answer. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} |
| `FC_SOURCE_CHANNELS` | Channels are not built (coming soon): read and shown in Settings › Developer, off whatever it says. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} |

**X** (**Built, test data only**: none of these is set anywhere)

| Name | Notes |
|---|---|
| `X_IMPORT_MAX_POSTS`, `X_IMPORT_MAX_FOLLOWS`, `X_IMPORT_MAX_LIKES` | Bring your X caps: 20,000 posts, 10,000 follows, 500 likes (the likes lane is off by default). Over a cap, the wizard offers "import the newest N". |
| `X_INDEX_MAX_AGE_MS` | How old the downloaded list of Farcaster-verified X accounts may get before the device downloads it again. Default 86,400,000 (a day). |
| `X_API_CLIENT_ID`, `X_API_CLIENT_SECRET`, `X_API_REDIRECT_URI` | An X developer app. The id and the secret are must-not-ship; with an id set, sync refuses to run rather than label test pages live. |
| `ENABLE_X_READ`, `ENABLE_X_WRITE`, `X_LAYERS_INBOX_TOKEN` | Must not ship. |
| `X_SPEND_RUN_CAP`, `X_SPEND_DAY_CAP`, `X_SPEND_CONFIRM_ABOVE` | The X spend ledger's caps. |

**Attestations**

| Name | Notes |
|---|---|
| `ATTEST_FID_SOURCE`, `ATTEST_CHAIN_SOURCE`, `ATTEST_WEBPROOF_SOURCE` | Fixture by default; `live` opts in per source. |
| `ATTEST_CHAINS`, `ATTEST_RPC_ETHEREUM`, `ATTEST_RPC_BASE`, `ATTEST_RPC_OPTIMISM` | Which chains the onchain issuer reads, and through which endpoints. |
| `ATTEST_PROTOCOLS`, `ATTEST_HONORED_ISSUERS`, `ONBOARDING_GATE` | Protocol buckets, which issuers count, the onboarding rule. |
| `ATTEST_ISSUE_WINDOW` | Must agree on the app and the validator. |
| `ATTEST_DEMO_WALLET_SEED` | The fixture world's demo wallet. |

## Validator

| Name | Notes |
|---|---|
| `NODE_ENV`, `ZK_DEV_HOOKS`, `LAYERS_REQUIRE_SIG`, `LAYERS_MAINTENANCE`, `LAYERS_COMMIT`, `TRUST_PROXY` | As on the app. |
| `LAYERS_VALIDATOR_PORT`, `VALIDATOR_PORT`, `PORT` | The pinned port; the older spelling; the platform's. |
| `LAYERS_PRIVATE_NETWORK_ONLY` | Required for a dev-hooks validator on a hosting platform. |
| `VALIDATOR_DB`, `VALIDATOR_DEATHS_LOG` | The database file; the supervisor's death log. Volume paths on Railway. |
| `VALIDATOR_BACKUP_DIR`, `VALIDATOR_BACKUP_EVERY_MS`, `VALIDATOR_BACKUP_KEEP` | Scheduled `VACUUM INTO` dumps. |
| `VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY`, `VALIDATOR_WRITES_PER_DEVICE_PER_HOUR` | The abuse caps. Do not raise them on a deployment. |
| `VALIDATOR_RL_CAPACITY`, `VALIDATOR_RL_REFILL_PER_SECOND` | The token bucket, local tests only; ignored on a hosting platform. |
| `VALIDATOR_POLLER` | `off` keeps the reputation poller from spending Neynar credits whenever a key is present. |
| `NEYNAR_API_KEY`, `ENABLE_FC_WRITE`, `FC_ANON_FID`, `FC_ANON_SIGNER_UUID`, `NEYNAR_SIGNER_UUID` | The anonymous relay account, owner service only. Its key must differ from the app's. |
| `FC_ANON_FID`, `FC_ANON_SIGNER_UUID`, `FC_ANON_NEYNAR_KEY`, `ZK_ANON_RELAY_LIVE` | Public go-live, the PUBLIC validator's one relay credential: the public @anon agent's fid and signer uuid, the key of a Neynar app that holds nothing else, and the relay's own switch (`on`). With the key set, the relay refuses to arm while `NEYNAR_API_KEY` or a foreign `NEYNAR_SIGNER_UUID` sits beside it, while the switch is off, or while `ZK_ANON_POST_LIVE_CAP` is unset (required on this path, at most 1,000,000). Without the key the owner-service path above is unchanged. The public APP refuses `FC_ANON_SIGNER_UUID`, `FC_ANON_NEYNAR_KEY` and `FC_ANON_SIGNER_KEY`. Set by `scripts/owner/arm-public-anon.ps1`, keys on stdin only. |
| `FC_ANON_SIGNER_KEY` | The hub route: the @anon account's own Ed25519 signer PRIVATE key (64 hex), the hub transport's one relay credential, PUBLIC validator only (the public app refuses it at boot). Made by `scripts/owner/make-anon-account.ps1` (saved in `%USERPROFILE%\.totem-anon\anon-account.json`, never printed), set on stdin by `arm-public-anon.ps1 -Transport hub`. Only its public half and a fingerprint of that ever appear in an answer. {cite: SECURITY-POSTURE.md > "34. The hub route for @anon (no Neynar)"} |
| `ANON_MODERATORS` | Public go-live: comma-separated Ed25519 PUBLIC keys (64 hex) whose signed reads and REMOVE / KEEP decisions the takedown queue honours. The owner copies his saved identity's key from Settings › Moderation: it is derived from the identity, so every device that unlocks or links that identity shows the same key. Without one, nothing can be taken down. |
| `ANON_FILTER_SCAM_DOMAINS` | Public go-live: extra host names the anonymous text filter refuses as scam links, comma separated, validator only (the tab knows only the built-in rule, so a host on this list is refused after the click, in the same words). |
| `ANON_FID_RPC_URL`, `ZK_ANON_FID_GATE` | Public go-live, the fid gate: the Optimism node a Farcaster sign-in's address is checked against (https only; default a public node; chain id 10 checked), and `on` to run the gate on a rig (it is always on on the public shape). |
| `ZK_ANON_TRANSPORT`, `FC_HUB_URL` | Public go-live: `neynar` (the default: the agent from a Neynar app) or `hub` (the hub route, no Neynar: casts and takedowns are signed on the validator with `FC_ANON_SIGNER_KEY` and sent to `FC_HUB_URL`'s `POST /v1/submitMessage`). On `hub` the relay arms with `FC_ANON_FID`, `FC_ANON_SIGNER_KEY`, `FC_HUB_URL`, the switch and the lifetime cap, and refuses `FC_ANON_NEYNAR_KEY` or `NEYNAR_API_KEY` beside them. `FC_HUB_URL` is a Snapchain node's HTTP API, https only (a Neynar address is refused; loopback http only off a hosting platform, for tests); the arm script's default is the public node `https://snap.farcaster.xyz:3381`, which accepts submits. It also serves @anon's casts to the anon pages (`/zk/anon/network-casts`) and the fid gate's custody check. Built, on test data only, until the first real post. Post as you: the same `FC_HUB_URL` is where the validator's thin relay (`POST /fc/hub/submit`) sends a visitor's already-signed posts; for that path an unset value means the public node `https://snap.farcaster.xyz:3381`. |
| `FC_ANON_NEYNAR_BASE_URL` | Tests only: a loopback stand-in for Neynar on the agent path; refused on a hosting platform. |
| `FC_APP_FID`, `FC_APP_CUSTODY_KEY` | Post as you: Totem's app account, PUBLIC validator only. The fid every SignedKeyRequest names (a public account number) and its custody PRIVATE key (0x + 64 hex), which the validator uses to sign key requests and nothing else: the validator holds no signer, so the key cannot post as any visitor. The public APP refuses `FC_APP_CUSTODY_KEY` at boot; the validator accepts both. Made by `scripts/owner/make-app-account.ps1` (saved in `%USERPROFILE%\.totem-app\app-account.json`, never printed), set by `scripts/owner/arm-app-account.ps1`, the key on stdin only. The same make-app run names the account @ontotem: its profile key (Ed25519, `profileKey` in the same file) is added with `KeyGateway.addFor` and signs the name, "Totem", "ontotem.com" and the picture; it is never an environment variable and never leaves the owner's laptop. `make-app-account.ps1` takes `-PfpUrl` (default `https://ontotem.com/brand/totem.png`), `-Hub` (default `https://snap.farcaster.xyz:3381`), `-Fnames` (default `https://fnames.farcaster.xyz`) and `-NoProfile` (a bare account, one transaction). Both unset, `GET /fc/app-account` answers `ready: false` with the missing names, and key requests and the relay answer 503. The app fid must not be `FC_ANON_FID`. {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"} |
| `FC_APP_SPONSOR` | Post as you: `on` adds the app account's sponsorship to every key request, so the visitor's Farcaster app shows the network fee as paid by Totem. Off by default; Farcaster refuses it until the app account is signed up in the Farcaster app with at least 100 warps. A value other than on or off is named as a problem and keeps the account from arming. |
| `FC_KEY_REQUEST_API_URL` | Post as you: Farcaster's client API. Default `https://api.farcaster.xyz`; https only, loopback http only off a hosting platform (the tests' stand-in); a Neynar address is refused. |
| `FC_KEY_REQUEST_TTL_SEC` | Post as you: how long a signed key request is valid. Default 900 seconds (15 minutes), an integer from 600 to 86,400; anything else is named as a problem and keeps the account from arming. |
| `ZK_EPOCH_MS`, `ZK_HISTORY_WINDOW`, `ZK_ANON_FLOOR`, `ZK_POW_BITS`, `ZK_ANON_RESPONSE_MS` | Epoch length, root history kept, floor, proof of work, the response timing floor. |
| `ZK_ANON_POST_TREE`, `ZK_ANON_POST_WINDOW_EPOCHS`, `ZK_ANON_POST_LIVE_CAP`, `ZK_ANON_RELAY_INTERVAL_MS`, `ZK_ANON_RELAY_SPREAD_MS`, `ZK_ANON_RELAY_MAX_ATTEMPTS` | Anonymous posts: tree and window (match the app); the lifetime live cap (pending and relayed rows; `failed` rows stop counting), which defaults to 1 on every non-public shape even when unset or blank, and on the public shape applies only when set; the relay interval and spread, whose defaults depend on the shape (public: 1,800,000 and 1,800,000; rig and owner service: 3,600,000 and 0; the environment overrides either); and how many slots a refused row is retried before it is `failed` (default 6). |
| `ZK_ANON_POST_SLOTS` | As on the app, and it must be equal there (default 4). |
| `ZK_ANON_POST_DAILY_CAP` | Persona launch P3: every anon post this validator accepts in a day, for everyone in one universe, pending and relayed together. Default 500. |
| `ZK_REACH_FLOOR` | As on the app (default 50, and at least `ZK_ANON_FLOOR`): the validator refuses a reach tree whose frozen size is under it, before any nullifier. |
| `ZK_X_ANON_POST_SLOTS` | As on the app, and it must be equal there (default 1). |
| `X_OUTBOX_MODERATORS` | Persona launch P8: comma-separated PUBLIC Ed25519 keys (64 hex) whose signed decisions the X outbox honours. Without one nothing is ever approved. The owner copies a device's key from Settings › Totem on X. |
| `X_OUTBOX_DAILY_CAP`, `X_OUTBOX_RELAY_INTERVAL_MS`, `X_OUTBOX_RELAY_SPREAD_MS` | Persona launch P8: copies taken and posts made per day (default 50); the relay slot (an hour); the random spread after it (30 minutes on the public shape, 0 elsewhere). Fixture transport only. |
| `ZK_ANON_REACH_ISSUERS` | Persona launch P5: which reach issuers an anon post may prove, by id. Default `fc.reach,x.reach`; blank means the default; `none` accepts none. Served as `reachIssuers` on `/zk/anon-post/config`. |
| `RING_DROP_MAX_ROWS`, `RING_DROP_MAX_ROWS_PER_WRITE`, `RING_DROP_WRITES_PER_HOUR`, `RING_DROP_ROWS_PER_HOUR`, `RING_DROP_MAX_LIVE_PER_DEVICE`, `RING_DROP_MAX_LIVE_PER_ADDRESS` | Persona launch P4: the ring drop's cap (default 4,096 rows, about 34 MB per read at the cap; a full drop answers 413), rows per signed write (28, a multiple of 4), and the occupancy limits, counted in memory: 120 writes and 2,048 rows per device per hour, 1,024 live rows per device, 2,048 live rows per address. Do not raise them casually. |
| `VALIDATOR_X_INDEX` | Persona launch P2: `on` builds the list of Farcaster-verified X accounts, 60 seconds after boot and then every `VALIDATOR_X_INDEX_EVERY_MS`. Default off: `GET /x/fc-index` answers 503 and the panel says the list is not available. It reads `api.farcaster.xyz`, a beta endpoint, and `fnames.farcaster.xyz`. Public go-live: the guided start's X step looks the signed-in account up in this list; off, the step says it could not check. |
| `PUBLIC_LIVE`, `APP_URL` | As on the app. The validator's seed refuses a value of `PUBLIC_LIVE` other than true, false or unset, and refuses `--force` under live mode. On a public validator a value other than unset, empty or `false` also closes the anonymous web door to test-universe posts (a misspelt value counts as live there: the public validator's container does not run the seed); `APP_URL` is the domain the fid gate checks a sign-in against. |
| `VALIDATOR_X_INDEX_EVERY_MS`, `VALIDATOR_X_INDEX_DIR`, `VALIDATOR_X_INDEX_FNAME_PAGES_PER_RUN` | Default 86,400,000 (nightly, with jitter); default `<db dir>/x-index`; default 1,500 username pages per run. |
| `VALIDATOR_X_INDEX_SOURCE_URL`, `VALIDATOR_X_INDEX_FNAMES_URL` | Local test overrides only, for a stub; ignored on a hosting platform. |
| `ATTEST_ISSUE_WINDOW` | As on the app. |

## The browser device

The device does not read the server's environment. `lib/device/deviceEnv.server.ts` builds one object per page and the bundle reads it once at load. It sets `NODE_ENV=production`, the validator address, `KEYSTORE_DIR=/keystore`, `LAYERS_REQUIRE_SIG`, `ZK_MODE`, `ZK_PREFETCH_MS` (ten minutes), `CUSTODY_PROVIDER`, and every write switch empty. `FC_READ_RELAY=on` is added only while the relay is armed; it is a hint that picks UI and grants nothing. Sign in with Farcaster adds `FC_SIWF` (the hint above), `FC_SIWF_RELAY_URL` and `FC_SIWF_RPC_URL` (only when a local override passed the rules; blank by name otherwise), and `FC_SIWF_BAD`, the NAME of a refused variable, not its value. Persona launch P7 adds the anonymous-posting switch and relay hints: `ZK_ANON_POST` (`on`, `off` or `invalid`), the go-live build adds `ZK_ANON_POST_TREE` (so the tab proves the tree the validator checks), and under `ZK_RELAY=ohttp` the relay URL only when it is https with no userinfo, query or fragment, plus `ZK_RELAY_THIRD_PARTY`. Post as you adds `FC_ROOT_HUB_URL` only when a local override passed the rule above, or `FC_ROOT_POST=bad_config` when one did not. Ads add `ADS=on` only while the app's `ADS` is on; dormant, the name is absent. Neynar as a switch adds `FC_SOURCE_FORYOU` and `FC_SOURCE_SEARCH` only when the app's switch is `neynar` or `auto` (never one for Following, notifications, counts or channels); unset, the names are absent. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"} On a rig the object also carries `LAYERS_DEVICE_DEBUG=1` and `CUSTODY_FIXTURE_PROVIDER=allow`, for the leak greps and the fixture provider.

## Railway

| Name | Notes |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | Selects `Dockerfile.validator` or one of the `railway/Dockerfile.owner-*` images. New Railway services do not adopt config-as-code files. |
| `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_TCP_PROXY_DOMAIN` | Set by the platform; the owner validator refuses to boot with either. |

## Commands and tests

These belong to a shell, not a service.

| Name | Read by |
|---|---|
| `BASE_URL`, `APP_URL`, `VALIDATOR_URL`, `EXPECT_FC_READ` | `smoke-deployed.mjs`, `accept-prodlive.mjs` |
| `OWNER_ACCESS_SECRET`, `FID_ACQUIRE_CONFIRM`, `FID_REGISTRANT_ACK`, `OP_RPC_URL` | `fid-acquire.mjs`, through the environment only. `FID_REGISTRANT_ACK` is the word the owner types at `acquire-fid.ps1`'s registrant step, passed on to the command's shell: `SIBLINGS` for `.env.local`'s wallet, `FRESH` for a `-WalletId` that differs. Both the word and the wallet are read before `.env.local` is loaded, so a line in that file is inert, and the script refuses to run while one is there. |
| `PRODLIVE_ROOTS_PER_DAY`, `PRODLIVE_RL_CAPACITY`, `PRODLIVE_RL_REFILL`, `PRODLIVE_FC_READ`, `PRODLIVE_FC_READ_SOURCE`, `PRODLIVE_STUB_PORT`, `NEYNAR_STUB_URL` | `run-prod-shape.sh` and the suites it runs |
| `SUITES_OVERRIDE`, `DETAIL` | `sweep-x.sh` |
| `SHOW_INTERNAL`, `LAYERS_DOCS_PORT` | the docs build; the docs suite's port |
| `PRODLIVE_SIWF`, `PRODLIVE_SIWF_STUB_PORT`, `SIWF_STUB_URL` | `run-prod-shape.sh` under `PRODLIVE_SIWF=stub` starts the loopback relay-and-chain stub (`scripts/lib/siwf-stub.mjs`, port 4321 by default) and hands its address to `accept-siwf-prod.mjs` |
| `PRODLIVE_ADS`, `EXPECT_ADS` | `run-prod-shape.sh` under `PRODLIVE_ADS=on` gives the app `ADS=on` (default: blanked by name, so the pair is dormant as a deploy ships), asserts the `/welcome` hint both ways and hands `EXPECT_ADS=on\|off` to `accept-ads-prod.mjs`, which runs Phase 1 switched on, or checks that nothing shows |
| `PRODLIVE_FC_SOURCES`, `EXPECT_FC_SOURCES` | `run-prod-shape.sh`: a comma list of `surface=value` (`following`, `notifications`, `foryou`, `search`, `counts`, `channels`) given to the app as `FC_SOURCE_*` (default: all six blanked by name, network everywhere); asserts the `/welcome` hints both ways and hands the list to the suites as `EXPECT_FC_SOURCES` (`accept-fc-source-prod.mjs`, run with every switch `neynar` and with none; `accept-fcread.mjs` needs `foryou=neynar`) |
| `EXPECT_SIWF_RELAY_HOST`, `EXPECT_SIWF_RPC_HOST` | `smoke-deployed.mjs` check 9: the relay and node hosts the deployed device should report |
| `EXPECT_X_INDEX` | `smoke-x.mjs`: `built` or `absent`, what the deployment's list should be |
| `ANON_PROD_VALIDATOR_PORT` | `accept-anon-prod.mjs`: the port of the throwaway production-shaped validator it starts (default 4063, not one of the pinned ports) |
| `LAYERS_DEVICE_OUT` | `build-device.mjs`: build the device and prover bundles into another directory, so a size check leaves alone what a running pair serves |

## Constants, not variables

| Name | Value | Where |
|---|---|---|
| `STATE_BODY_LIMIT_BYTES` | 262,144 (256 KiB), every JSON route on the validator | `validator/limits.js` and `lib/adapters/mock/persist.ts`, asserted equal |
| `CHUNK_PLAINTEXT_BYTES` | 98,304 (96 KiB) of plaintext per sealed piece | `lib/vault/chunkedDoc.ts` |
| `ACCOUNT_LINKS_BYTES` | 1,024: the sealed `accountLinks` record, with or without a link | `lib/fc/siwf/links.ts` |

## Handling values

- Secrets go to Railway on stdin (`railway variable set --stdin`), not on a command line, and are read back and compared in memory.
- `railway variables` and `railway variable list` print values in every output format. For names only, read the JSON keys.
- `.env.local` is gitignored, and `railway up` honours `.gitignore`, so it stays on the machine. `.env.example` and `.env.production.example` list names only.
- On Windows PowerShell 5.1, piped stdin starts with a byte-order mark unless the encoding is set first; see [Deploying](./deploy.md).
