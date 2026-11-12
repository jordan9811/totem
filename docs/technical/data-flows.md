# Data flows

Eleven paths through the system, step by step, with what each party sees on the way.

::: info Status
Flow 1 **works live** on the public preview. Flow 2's local half works everywhere. Its Farcaster half: on the deployed owner service today only the owner's scripts reach it, as the shared test account, and no cast from that service is on record; the buttons build of 2026-10-08, which sends the app's own Post, Reply, Like, Recast and Follow through the write door as a persona with its own account, is **Built, test data only**, deployed to the owner service on 2026-10-10 and not yet used for a real post. "Act as" replies publish only once a persona has its own account, and none has one. Flow 3 is built and **Off on purpose** until the owner arms it. Flow 4 is built and, as of 2026-10-07, has not created an account on the owner service. Flow 5 is **Built, test data only** and has not run live yet. Flow 6 is **Built, test data only**: it is checked against a fake chain and fake registries, and no connector account has been created on the owner service. Flows 7 and 8, and flow 5's persona-scoped slots, are the persona launch pass's first wave: **Built, test data only**, deployed on 2026-10-11. Flows 9 to 11 (rings, a boosted anon post, a launch) are its second wave: **Built, test data only**, deployed on 2026-10-12; flow 11 runs against a SIMULATED registrar and chain.
:::

The six flows: [a request through the browser device](#_1-a-request-through-the-browser-device), [a post](#_2-a-post), [a live read through the relay](#_3-a-live-read-through-the-relay), [creating a persona's Farcaster account](#_4-creating-a-persona-s-farcaster-account), [an anonymous post](#_5-an-anonymous-post), [setting up the connector account](#_6-setting-up-the-connector-account), [Sign in with Farcaster](#_7-sign-in-with-farcaster), [bringing your X archive](#_8-bringing-your-x-archive), [a ring, published and read](#_9-a-ring-published-and-read), [a boosted anon post](#_10-a-boosted-anon-post), [a launch](#_11-a-launch), [a copy to @totem on X](#_12-a-copy-to-totem-on-x) and [your Following, read from the hub](#_13-your-following-read-from-the-hub) (flow 13: **Built, test data only**, not deployed).

## 1. A request through the browser device

<ol class="flow">
<li><strong>Island asks</strong>A component calls <code>fetch("/api/feed2?…")</code> through <code>useApiJson</code>.</li>
<li class="flow__us"><strong>The tab answers</strong><code>lib/device/host.ts</code> matches the route table and calls the handler in the page.</li>
<li><strong>Adapters run</strong>The handler reads the session from the device's cookie jar and calls the adapters; state is in memory.</li>
<li><strong>A write is sealed</strong><code>persistNs()</code> seals the whole namespace and signs an envelope with the device key.</li>
<li><strong>Validator stores</strong><code>PUT /state/:ns</code>, checked against the device's delegation and its anchor.</li>
</ol>
<p class="flow__note">After boot, reads are answered from memory in the tab. Writes travel, and only as ciphertext.</p>

- **At boot** the device restores its seed from IndexedDB or mints one, registers its device key under the root's anchor, and hydrates its namespaces with signed reads of `GET /state`. A full page load by a visitor who has not saved mints a new root each time.
- **What the validator sees:** the anchor (a public key), the device key, the namespace name, the size of the sealed record padded to 1 KB steps, and when the write happened. It caps signed writes at 2,000 per device per hour.
- **What the app server sees:** the page request and its path. Nothing under `/api/*` reaches it except the six server-only routes.
- **Where a read fails:** `useApiJson` turns a failed read into an error state, not into an empty list drawn as if it were the truth. A 429 from the validator means "later": the device waits the named `Retry-After`, up to four times, then fails loudly.
- **Saves are loud (persona launch P2, test data only):** `flush()` checks a sealed body against `STATE_BODY_LIMIT_BYTES` (256 KiB) before sending and throws a `PersistError` naming the namespace and its size; a network failure or 5xx is retried three times, then thrown; the validator answers an oversized body `413` in JSON. Documents bigger than one PUT go through `lib/vault/chunkedDoc.ts` (flow 8). This was deployed to both sites on 2026-10-11, replacing the old quiet flush and the 100 KB limit there. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
- **Code:** `lib/client/useApiJson.ts`, `lib/device/host.ts`, `lib/device/boot.ts`, `lib/adapters/mock/persist.ts`, `lib/vault/vault.ts`, `validator/server.js`.

The validator holds one sealed record per namespace per anchor and no persona-to-root map. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## 2. A post

<ol class="flow">
<li><strong>You type</strong>The composer picks a door: public, private persona, or anonymous.</li>
<li class="flow__us"><strong><code>/api/actions/cast</code></strong>Checks the acting persona is public and yours, then decides where the post goes (<code>farcasterDelivery.ts</code>).</li>
<li><strong>Totem only</strong>Writes off, or a persona without its own account: a local cast with a <code>0xlocal…</code> hash and a persona marker, in the answering process.</li>
<li class="flow__soon"><strong>Farcaster</strong>Writes armed and the persona owning a live account: through the write door below, as that account. Built, test data only; not yet run on the deployed service.</li>
<li><strong>Shown</strong>Your timeline renders it, and the toast is the server's own sentence: "Posted to your Totem preview, not to Farcaster", "Saved in Totem only — why", or "Posted to Farcaster as @name" with a link.</li>
</ol>
<p class="flow__note">On the public preview, and in every rig suite, only the Totem-only branch runs. The dashed step was deployed to the owner service on 2026-10-10 and waits for a persona with its own account and a first real post.</p>

- **Local posts are not saved.** The local cast store in `lib/data.ts` lives in process memory and is not written to the validator. On the public preview a post is gone after a reload; on the owner service, after a restart.
- **A private persona** goes to `/api/private/posts` instead: the post is sealed in the vault and shown only to the persona's audience. The public door refuses a private persona at the adapter layer, not just in the UI.
- **Every answer carries `delivery`.** `{to: "farcaster" | "layers", message, url?}`: the toast is the server's sentence, not the client's guess, and the old "Your post was sent." no longer exists. The public preview always says "Posted to your Totem preview, not to Farcaster". On the owner service the line under the Post box asks `GET /api/actions/delivery` first, the post carries that line back as `expect`, and the server decides again: anything different is refused with 409 `FC_DELIVERY_CHANGED` and nothing is sent. Built, test data only (`scripts/unit-fc-buttons.mjs`, 48 checks against a fake Neynar); not yet run on the deployed service.
- **What goes to Farcaster, exactly.** Only when writes are armed, the acting persona is one of the device's own public personas, it owns its own live account with a usable managed signer (the shared test account is refused), and the door's identity check passes. Replies, likes and recasts go out only for casts that are on Farcaster; local, seeded, private and anonymous posts stay in Totem. From a one-tap button a persona is refused any interaction with another of the owner's own personas, the shared test account, the anon account or the owner's main account (`FC_SELF_LINK`); with neither a connected main nor `NEYNAR_VIEWER_FID` set, a persona's reply, like, recast, follow or @mention on the real network is refused outright (`FC_MAIN_UNKNOWN`). Undo (un-like, un-recast, un-follow) answers 409 `FC_UNDO_UNSUPPORTED`. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

**The Farcaster half: the write door.** Real writes go through `POST /api/fc/write` on the owner service or the laptop rig. On the public preview the route is bundled into the device too, but with the write switches off by contract it reaches only the in-tab fixture network, and a write aimed at a real Farcaster cast or account is refused with 403 `NETWORK_READ_ONLY`.

<ol class="flow">
<li><strong>Caller</strong>The app's own buttons (the buttons build, test data only), the owner's PowerShell commands, or an "act as" reply to a live cast (only from a persona with its own account; none has one yet).</li>
<li><strong>Identity rule</strong><code>lib/fc/writes.ts</code>: the persona is yours, and signs with its own account or the throwaway.</li>
<li class="flow__us"><strong>Ledger first</strong><code>writeLedger.ts</code> opens a pending entry and checks the caps: 10 casts, 10 follows, 30 actions a day.</li>
<li><strong>Publish</strong>Neynar managed signer, or the fixture network on a rig. After an ambiguous failure, it checks the network before any retry.</li>
<li><strong>Attribute</strong>The cast hash is recorded against the persona, signed, in the sealed attribution index.</li>
</ol>

- **What Neynar sees:** every persona's write, under one API key, so it can join every persona account to the others (A-FID-NEYNAR-SEES-ALL). {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}
- **What the network sees:** an ordinary account posting. Two of your accounts interacting with each other is public (A-FID-SELF-GRAPH). From the app's one-tap buttons the door now refuses it (`FC_SELF_LINK`, built on test data); the act-as menu keeps its sibling waiver, and what you do in a Farcaster app is yours.
- **Code:** `components/Composer.tsx`, `components/CastCard.tsx`, `app/api/actions/cast/route.ts`, `react/route.ts`, `follow/route.ts`, `delivery/route.ts`, `act-as/route.ts`, the decision in `app/api/actions/farcasterDelivery.ts`, `app/api/private/posts`, `app/api/fc/write/route.ts`, `lib/fc/writes.ts`, `lib/fc/writeLedger.ts`.

## 3. A live read through the relay

<ol class="flow">
<li><strong>Device needs content</strong>The discovery timeline, or a Farcaster profile or thread it does not hold.</li>
<li><strong>Asks the server</strong><code>POST /api/fc/read</code> with header <code>x-layers-relay: 1</code>; the handle or hash rides in the body.</li>
<li class="flow__us"><strong>Relay checks</strong>A closed table of 5 operations, a per-address bucket, the daily credit budget, the cache.</li>
<li><strong>One upstream call</strong>A GET to Neynar with parameters the relay fixes; the client supplies no fid, cursor or limit.</li>
<li><strong>Mapped answer</strong>Casts and users through a field allowlist, cached, drawn with a "Farcaster · read-only" marker.</li>
</ol>
<p class="flow__note">Notifications, search, channel tabs and everything the server renders stay preview content even when the relay is armed. The relay has no Following read: for a visitor signed in with Farcaster, Following is flow 13 (the browser reads the node itself).</p>

- **The operations:** `status`, `discovery`, `thread`, `user` and `user-casts`. Discovery reads one configured source: a list of 1 to 100 author fids (`FC_READ_FIDS`), or the accounts one "house" account follows (`FC_READ_HOUSE_FID`). Exactly one must be set; there is no default.
- **The budget:** 100,000 credits a day per instance by default, charged once per cache miss. Lookups may spend at most 70% of the day and one address at most 5%. A failed miss puts its key on a 45-second cooldown; five in a row open a 60-second breaker for all keys.
- **Refusals are final:** `fc_read_off`, `fc_read_budget`, `fc_read_unarmed`, `fc_read_upstream`, `fc_read_rate` (with `Retry-After`), `bad_op`, `not_found`. The device shows a paused line with a Retry button, not an error block.
- **What the operator sees:** every relayed read, and the request paths of the pages a visitor opens (`/<fname>`, `/<fname>/status/<hash>`), which the platform logs (A-FCREAD-OPERATOR-SEES-READS).
- **Arming:** `NEYNAR_READ_API_KEY` from a second Neynar app with no signers, plus one discovery source, set on the public `app` service only by `scripts/owner/arm-live-reads.ps1`. Without the key the relay reports `no_key` and nothing else changes.
- **Code:** `lib/fc/readRelay.server.ts`, `app/api/fc/read/route.ts`, `lib/fc/networkTarget.ts`, `scripts/lib/neynar-stub.mjs` (the test stand-in).

{cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## 4. Creating a persona's Farcaster account

<ol class="flow">
<li><strong>Arm</strong><code>acquire-fid.ps1 -PersonaId p_…</code> sets <code>FID_ACQUIRE_ENABLED=true</code> on the owner app and waits for the boot line.</li>
<li><strong>Dry run</strong><code>fid-acquire.mjs</code> signs in with the passphrase from the environment and prints an itemized cost sheet.</li>
<li class="flow__us"><strong>SPEND</strong>Ledger first, then a check that this persona's custody address owns no account yet, then Neynar's sponsored registration.</li>
<li><strong>Sign and seal</strong>The app signs the registry transfer with the persona's derived custody key and seals the receipt in its vault.</li>
<li><strong>Disarm</strong>The script confirms the record and offers to delete the switch and redeploy.</li>
</ol>
<p class="flow__note">The Neynar key and wallet stay on the owner's laptop; the persona's custody key stays in the owner app. Neither travels to the other.</p>

- **Who qualifies:** only a persona whose keys come off the root phrase. Seeded personas are refused before any billable call, because their keys are public by construction (D-FID-5-LIVE-KEYSTORE-ONLY). One persona per run, so two registrations do not land minutes apart as a visible pair.
- **Caps:** 2 accounts and $10 of creation spend by default, checked by the command and again by the app, on a ledger that survives resets. Both can be raised, in two places at once, up to 20 accounts and $25.
- **Cost:** about $0.35 to $0.90 of ETH per account from a Neynar app wallet on Optimism, which does not allow withdrawals, plus 1 credit for the name check.
- **What the network sees:** a new account whose profile is the persona's own; nothing in it names Totem. The chain says more than the record (read 2026-10-07): the throwaway and the seven fids pre-registered beside it were registered by this developer's own Neynar App Wallet in one burst on 2026-08-29, so persona accounts drawn from that pool sit next to the Totem-named test account (same sender, same minutes). Their signer request fid is 6131 (@neynar), shared by every Neynar-registered account, and their recovery address is shared with other developers. The registrant is developer-unique, not a shared sponsor; this replaces the acquisition script's assertion (A-FID-REGISTRANT-BY-FIAT). The rent payer is still unread (VERIFY-YOURSELF F21). The owner decides before the first account: `acquire-fid.ps1` states the sibling link and asks for a typed `SIBLINGS` (the current wallet) or `FRESH` (`-WalletId`, a wallet that has not touched the test account). Neynar sees them all either way.
- **Until a persona has an account,** owner-service casts go out through the shared throwaway account.
- **Code:** `scripts/owner/acquire-fid.ps1`, `scripts/fid-acquire.mjs`, `lib/fc/acquire.ts`, `lib/fc/personaFid.ts`, `lib/fc/custodySign.ts`, `app/api/fc/persona`.

{cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(d) FULL FID PERSONAS — one real account per persona"}

## 5. An anonymous post

<ol class="flow">
<li><strong>Queue</strong>The composer's anonymous toggle posts to <code>/api/anon</code>. Nothing is sent yet.</li>
<li><strong>Prove</strong>At the next prefetch tick the device proves its root is in the anonymous tree, bound to a hash of the text, under the scope of a free slot <code>w&lt;n&gt;/s&lt;i&gt;</code>: K = 4 per person per window, shared across personas. The message also binds the hash of the post's 256-byte ring note, and the tree is the plain anon tree or a reach tree (flows 9 and 10).</li>
<li class="flow__us"><strong>Send</strong>After a random wait of 30 seconds to 15 minutes, over the unauthenticated channel, with a proof of work.</li>
<li><strong>Verify</strong>The validator checks the proof, records the nullifier and a row with no persona and no root.</li>
<li><strong>Relay</strong>Live only: at the next slot (hourly plus up to 10 minutes on the rig and owner service; every 30 minutes with a 30-minute spread on the public shape), shuffled, cast by the shared anonymous account.</li>
</ol>
<p class="flow__note">On the public preview and on test data, step 5 is a public list inside Totem. Nothing reaches Farcaster.</p>

- **The channel:** a header allowlist (any cookie, auth, origin or forwarding header is a refusal), hashcash proof of work of 16 bits bound to the body, the same response size for every outcome, a 150 ms floor, and no logging. OHTTP through a third-party relay is built; the default transport is direct.
- **The window and the slots:** one epoch by default; the validator's epoch is 6 hours. Persona launch P3: each person has K slots per window (`ZK_ANON_POST_SLOTS`, default 4, equal on both sides), each with its own nullifier; the bare-window scope is refused. The device draws a free slot uniformly. The post is made as a persona (`POST /api/anon {text, personaId?}`, the acting one by default); the persona is written only into the sealed `AttributionRecord`, never into the envelope. A global daily cap (`ZK_ANON_POST_DAILY_CAP`, 500) is counted inside the insert transaction. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}
- **To run it live** the validator needs `FC_ANON_FID`, `FC_ANON_SIGNER_UUID`, its own Neynar key (a third app's), `ENABLE_FC_WRITE=true`, `ZK_ANON_POST_TREE=valid` and the cap; the owner app needs `ZK_MODE=live`, `ADAPTER_REP=zk`, `ZK_ANON_FLOOR=1` and the same tree, then a live registration that takes effect at the next epoch. `ZK_ANON_POST_LIVE_CAP` (default 1) counts pending and relayed live rows; a row the relay gave up on after six slots is `failed` and stops counting. The runbook's section (f) and `scripts/owner/arm-anon.ps1` set all of it in one run, behind a typed confirmation, with `-Disarm` as the kill switch.
- **What it hides on the owner service:** little. The anonymity floor defaults to 50 members, and the owner's live universe holds one root, so there is no crowd to hide in. There, the anonymous account is an extra account with no name on it; its cover is how it was created, a separate Neynar key, the hourly relay timing and what the owner writes. A real crowd needs a validator many people share.
- **The reveal** (prove a past anonymous post was yours: permanent, visible to every reader of this Totem server, nothing changes on Farcaster) is built and has not passed its closing bar of three adversarial reviews and four clean sweeps.
- **From a browser (Persona launch P7, built on test data, not deployed).** On the public site the same steps run in the tab: step 2 in a Web Worker (`public/device/prover.js`), step 3 over the browser's channel to `POST /zk/anon/web?pow=` (a 4,096-byte `text/plain` body, no cookie, no referrer, no device header) or through an OHTTP relay from the tab. Only the test universe: the tab and the web route both refuse a live envelope, and the card says "Preview only · not on Farcaster". `ZK_ANON_POST=off` stops it on the server and in every tab. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **Code:** `app/api/anon/route.ts`, `lib/zk/prefetch.ts`, `lib/zk/anon/*` (including `slots.ts`, `availability.ts` and `webChannel.ts`), `lib/zk/gate.ts`, `lib/zk/anonAttribution.ts`, `lib/zk/prover/browser-worker.ts`, `lib/zk/transport/browser.ts`, `lib/identity/postMode.ts`, `app/api/personas/post-mode/route.ts`, `validator/anon.js`, `validator/zk.js`.

{cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"} {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"}

## 6. Setting up the connector account

<ol class="flow">
<li><strong>Create</strong><code>arm-connector.ps1</code> asks the owner service for a connector (typed CREATE). The service makes a custody key and a separate recovery key, seals both in its vault, and answers with the custody address only.</li>
<li><strong>Fund</strong>The owner sends about 0.0005 ETH on Optimism to that address from an exchange withdrawal. The script watches the balance; the service reads it and <code>IdGateway.price()</code> over a read-only RPC.</li>
<li class="flow__us"><strong>REGISTER</strong>Typed. The service signs <code>IdGateway.register(recovery)</code> with the custody key, seals the transaction hash before sending it, waits for the receipt, reads <code>IdRegistry.idOf</code> and seals the fid.</li>
<li><strong>Name</strong>Optional and free: a <code>UserNameProof</code> signed by the custody key, sent to the fname registry. A name that says "layers" or resembles one of the owner's accounts is refused.</li>
<li><strong>Connect</strong><code>lib/fc/connect.ts</code> signs every QR key request with the sealed connector whenever <code>FC_CONNECT_APP_FID</code> is unset; the environment pair wins when it is set.</li>
</ol>
<p class="flow__note">The owner handles an address and two typed words. No key is shown, typed, or kept on the laptop.</p>

- **Why a connector:** Farcaster records, publicly and for good, which app asked for every connection (the `requestFid` in the key's metadata). The shared requester, Sign In with Neynar, closed on 2026-08-14, so main's QR connect needs an account of its own to be that app, one that nothing else uses. The public then sees that main uses a private app, not which other accounts the owner has.
- **Where it runs:** the owner service only, with Farcaster writes armed and a live owner session (the route re-checks the session itself, after the middleware). The public preview, the browser device and the laptop rig refuse every action; the rig's connect flow keeps its fixture connector.
- **What it refuses:** registering while the balance is short of the price plus a gas margin (judged against a fixed margin first, then against a live gas estimate); an RPC that answers for another chain; a custody or recovery address that is a Totem address, a persona's custody or main's custody; a name with "layers" in it, the shared test account's stem, a persona's name or main's stem. A vault read that fails refuses rather than letting a second key be sealed over the first; a namespace whose records are all unreadable is treated as corrupted, not empty.
- **Resuming:** the hash is sealed before the send, so a crash between the send and the receipt is finished from the receipt; a transaction with no receipt after 15 minutes is re-sent once; an fid already onchain is adopted. Create and register are idempotent, and a second create generates nothing.
- **What the chain sees:** a fresh address funded by an exchange, one `register` call, and later the connector as the `requestFid` of main's signer. Nothing in that names Totem, the Neynar app wallet or a persona, which is why the funding source matters; it is the owner's rule, stated in words, since a plain RPC does not show who funded an address.
- **Cost:** the registry price (77,733,916,415,441 wei, about 0.0000777 ETH, read 2026-10-07) plus Optimism gas of a few cents; the exchange withdrawal dominates, about $1 to $5 in practice. The name is free.
- **Code:** `lib/fc/connector.server.ts`, `app/api/fc/connector/route.ts`, `scripts/owner/arm-connector.ps1`, `scripts/unit-connector.mjs` (a fake RPC, fname registry and Neynar, in-process; 52 checks), `lib/fc/connect.ts` (the sealed source and its refusals).

## 7. Sign in with Farcaster

<ol class="flow">
<li><strong>Start</strong>On the public site the device route <code>/api/fc/siwf</code> runs in the tab: a 16-character nonce, then <code>POST relay/v1/channel</code> for this page's origin, ten minutes.</li>
<li><strong>Approve</strong>The QR code (or the phone button) opens the Farcaster app; the person approves there.</li>
<li class="flow__us"><strong>Poll and verify</strong>The tab polls the relay every 1.5 seconds, then verifies the signed message and its signature itself (<code>lib/fc/siwf/verify.ts</code>).</li>
<li><strong>Chain check</strong>One <code>eth_call</code> from the browser to the Optimism node: <code>idOf</code> or <code>keyDataOf</code>.</li>
<li><strong>Seal</strong>The sealed <code>accountLinks</code> record (1,024 bytes) through <code>flushVault</code>, and a read-only public self persona.</li>
</ol>
<p class="flow__note">The relay and node calls use the page's unpatched fetch, credentials omitted, no referrer. The app server is not on this path.</p>

- **Where it runs:** the browser device on the public site; the rig's server with an in-process fixture relay and chain (for the suites); the owner service refuses. A request that reaches a public server is answered `404 device_only` before its body is read.
- **What each party sees:** the relay, the account and the visitor's address; the node, a query about that account from that address; the validator, one sealed write of a namespace every root writes at boot (and, once the public @anon is on, the crowd's join after the sign-in is sealed: the account and a crowd commitment no table ties to a root, from the visitor's address); the app server, nothing. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
- **Refusals:** fixed codes (`siwf_message`, `siwf_signature`, `siwf_chain_unavailable` which is retryable, `siwf_fid_mismatch`, `siwf_one_main`, `siwf_handle_stem`, `siwf_linked_device`, `siwf_seal`, `siwf_expired`); nothing is recorded on a refusal, and no token, signature, message or address appears in an error.
- **Afterwards:** the public self never acts as a persona (`403 PUBLIC_SELF_READ_ONLY` on every persona write route; fork refused); on the live site it is the account menu's "You", which makes no persona the acting identity and refuses every persona write in the device (`409 NO_ACTING_PERSONA`, built on test data only); posting as it has its own door, `/api/fc/root`, with its own key ([Post as you](/mechanism/post-as-you), built, test data only); "Show my Farcaster posts here", once an explicit read of your own account through the read relay (flow 3), is retired (built on test data 2026-11-07): `live=1` answers `409 names_you`, because a Neynar read may name no visitor (SECURITY-POSTURE.md §42). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
- **Code:** `lib/fc/siwf/{verify,flow,links}.ts`, `app/api/fc/siwf/route.ts`, `components/device/FarcasterSignIn.tsx`, `lib/device/deviceEnv.server.ts` (the hints), `lib/device/boot.ts` (the empty record at boot).

## 8. Bringing your X archive

<ol class="flow">
<li><strong>Read</strong>The browser page reads the ZIP by its central directory (only wanted files, CRC-checked) or the picked folder (<code>lib/x/archiveZip.ts</code>, <code>archiveParse.ts</code>).</li>
<li><strong>Hand over</strong>Parsed lanes only, in batches, to the device-answered <code>/api/x/import</code>: account, posts, following, likes, ad interests.</li>
<li class="flow__us"><strong>Seal in pieces</strong>On commit, the device (public site) or the owner app's server writes <code>xArchive</code>, <code>xShelf</code> and <code>xFollows</code> as chunked sealed documents, the manifest last.</li>
<li><strong>Index</strong>With <code>VALIDATOR_X_INDEX=on</code>, the validator crawls Farcaster's X verifications nightly into one gzip file, <code>GET /x/fc-index</code>.</li>
<li class="flow__us"><strong>Match</strong>The device downloads the whole file and intersects it with the sealed follow list, locally.</li>
</ol>
<p class="flow__note">The raw archive stays in the page: only parsed lanes reach the import route. Following matches from Totem is a later wave.</p>

- **What each party sees:** the validator, the document names per anchor, their piece counts and padded sizes, and each index download by address and time; the app server on the public site, the page view; Farcaster, a validator's nightly crawl; X, nothing. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
- **Torn writes:** the pieces of the new generation go to the slot the live manifest does not point at, then the manifest; a crash leaves the previous complete save. A missing or mismatched piece throws and blocks writes until a read succeeds.
- **The fingerprint warning:** the follow lane imports only with `acknowledgedFingerprintWarning: true`; staged lanes live in memory only, so after a restart the import asks for the file again and keeps nothing partial.
- **Code:** `lib/x/archiveZip.ts`, `lib/x/archiveParse.ts`, `lib/x/importer.ts`, `lib/x/shelf.ts`, `lib/x/follows.ts`, `lib/x/indexClient.ts`, `lib/x/match.ts`, `lib/x/identity.ts`, `lib/vault/chunkedDoc.ts`, `validator/xindex.js`, `validator/limits.js`, `components/settings/XImportWizard.tsx`, `components/settings/XPeoplePanel.tsx`.

## 9. A ring, published and read

<ol class="flow">
<li><strong>Address</strong>A member's device makes a private address in Settings › Rings (<code>LR1.</code>, derived from its root) and hands it over out of band.</li>
<li><strong>Ring</strong>The owner's device adds it to a ring and sets each public persona's depth; one mutation of the sealed <code>rings</code> namespace, nothing else sent.</li>
<li class="flow__us"><strong>Publish</strong>At a tick when due (hourly ±25 %, or after a change): one 4,096-byte HPKE envelope per (ring, member), padded with dummies to a multiple of 4, in device-signed <code>PUT /rings/drop/batch</code> writes of at most 28 rows, the last of which also deletes the previous generation in the same transaction.</li>
<li class="flow__us"><strong>Read</strong>Every device, every tick: <code>GET /rings/drop</code> and <code>GET /zk/anon-casts</code>, unsigned; trial-open rows (hint first) and every anon post's note, in memory.</li>
<li><strong>Render</strong>From memory only: "@persona · shared with you by" the name the owner chose to be shown as (not the ring's own label), and the root-left, persona-right avatar.</li>
</ol>
<p class="flow__note">A failed read hides merges and drops nothing; a revoke deletes the member's row at once and rotates the persona's note key for future posts; the root's other devices adopt the new key at their next refresh, up to about 25 minutes later.</p>

- **What each party sees:** the validator, which registered device writes, when and how many rows (a multiple of 4), and at rest which devices have ever written (the envelope counter), a revoke as one delete, every reader's address, and fixed-size rows with no writer column; members, what their ring was given; everyone else, plain @anon.
- **The note:** 256 bytes on every anon post, AES-256-GCM under K(persona, generation) with the cast hash as associated data when a ring holds the persona at "posts", random bytes otherwise; `sha256(note)` is in the proof's message.
- **Code:** `lib/rings/*`, `validator/ringdrop.js`, `app/api/rings/route.ts`, `components/settings/RingsPane.tsx`, `app/d/page.tsx`, `lib/zk/prefetch.ts` (the tick).

{cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## 10. A boosted anon post

<ol class="flow">
<li><strong>Issue</strong><code>fc.reach</code> reads the follower count of the root's own main account (score 0.7 or more to enter) and issues every nested bucket it clears, valid 8 epochs.</li>
<li><strong>Offer</strong>The composer offers the held tiers whose census at the last tick has at least 50 accounts and leaves at least 50 in the band below (the band rule, wave 3); the default is the highest.</li>
<li class="flow__us"><strong>Prove</strong>The post proves a free slot under <code>w&lt;n&gt;/s&lt;i&gt;</code>, member of the chosen tree; the tree is not in the scope.</li>
<li><strong>Accept</strong>The validator refuses a reach tree under the floor, or one that would leave fewer than the floor in the tier below it, on the frozen trees' sizes, before any nullifier, and records <code>tree</code> and <code>tree_size</code>.</li>
<li><strong>Label</strong>"posted by an account with 10k+ followers" on any surface; on For You only, a head start of 1, 2 or 4 hours, below demote, pin and quiet.</li>
</ol>
<p class="flow__note">The label is checked against the client's own census for the epochs it read; otherwise the card is plain anon. Following shows the label but gives no head start.</p>

- **Where the issuer runs:** server-side on the owner service and the rig. In the public site's browser device `fc.reach` and `x.reach` refuse to register or issue (D-REACH-ISSUER-HOST-ONLY, `lib/attest/registry.ts`, `lib/attest/subject.ts`), so this flow does not run there until an issuer Totem runs exists.
- **What each party sees:** the issuer, fid to commitment at issuance; the validator, the relay and every reader, the tree a post proved and its size; Neynar on live facts, a lookup of the main account.
- **Code:** `lib/attest/issuers/fcReach.ts`, `lib/attest/issuers/xReach.ts`, `lib/reach/*`, `lib/zk/gate.ts`, `lib/zk/prove.ts`, `validator/zk.js`, `components/ReachPicker.tsx`, `lib/feed.ts`.

{cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## 11. A launch

<ol class="flow">
<li><strong>Preview</strong>Device-local: the persona's sealed reveal records joined to the own-rows mirror of the complete public anon list; writes and fetches nothing; reports the crowd the posts narrow to.</li>
<li><strong>Confirm</strong>The typed handle; the request is built and signed in memory by the persona's derived custody key; the pending launch rides the sealed <code>zkQueue</code> on its deferred write.</li>
<li class="flow__us"><strong>Request</strong>At a later tick: a <code>persona-launch</code> proof over <code>/zk/anon/submit</code>, 4,096 bytes, header allowlist; the registrar queues it inside the nullifier's transaction.</li>
<li class="flow__us"><strong>Register</strong>The simulated registrar's batch, 2 to 48 hours after the click: one Bundler call per account, one $0 spend row per batch that registered one, no arrival hour stored with the request; every test-universe device's tick reads the registrations list and the complete anon list.</li>
<li><strong>Reveal</strong>One batch reveal signed by the registered key, all or nothing; then the fname and profile, the launch cast and up to 10 quotes through the thin relay.</li>
</ol>
<p class="flow__note">Fixture only. The public site refuses at the confirm; the owner service's live universe refuses until the Totem registrar (O1) exists.</p>

- **What each party sees:** the validator as registrar, the request's public fields as it arrives (no arrival hour is stored), the batch, and the device's address on the reveal; readers, every revealed post with its date, window and tier, checked against the key registry.
- **Code:** `lib/launch/*`, `validator/registrar.js`, `validator/simchain.js`, `lib/fc/chain/*`, `lib/fc/thinRelay.ts`, `app/api/launch/route.ts`, `app/proof/[fid]`.

{cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## 12. A copy to @totem on X

<ol class="flow">
<li><strong>Tick</strong>"Also post to @totem on X" under an anonymous post; the copy is requested only after the anonymous post was accepted. Every refusal (the text rules, the X slot, the daily cap) comes first.</li>
<li><strong>Prove</strong>At the next tick: the plain anon tree, scope <code>x-anon-post/w&lt;n&gt;/s&lt;i&gt;</code> with a free X slot (one per person per window by default), the message bound to the copy's hash; its own jitter, apart from its sibling.</li>
<li class="flow__us"><strong>Queue</strong>The validator verifies, spends the nullifier and stores the copy as <code>review</code> in one transaction.</li>
<li class="flow__us"><strong>Moderate</strong>A moderator signs approve or reject; nothing is approved without one.</li>
<li class="flow__soon"><strong>Relay</strong>The next hourly slot plus a random spread, through a test transport. No X call exists.</li>
</ol>
<p class="flow__note">Built on test data on the rig, not deployed; not offered on the public preview. Which persona sent a copy, and which post it copies, stay in a sealed record on the device.</p>

- **What is public:** `GET /x/outbox` lists each copy's id, status and hour, and its text only once posted. The moderator's signed read lists the texts waiting.
- **What it costs:** the words pair a copy with its Farcaster sibling, so a launch makes the copy read as the persona's, and the device folds the copy into that persona's crowd count; the moderator reads every copy, rejected ones included.
- **Code:** `components/XOutboxToggle.tsx`, `app/api/x/outbox/route.ts`, `lib/x/outbox/*`, `lib/zk/gate.ts` (`requestXAnonPost`, `proveXAnonPost`), `validator/zk.js`, `validator/xoutbox.js`.

{cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## 13. Your Following, read from the hub

<ol class="flow">
<li class="flow__us"><strong>Follows</strong>The device route <code>/api/fc/hub</code> runs in the tab: <code>GET node/v1/linksByFid?fid=&lt;you&gt;&amp;link_type=follow</code>, 1,000 a page, up to 10,000.</li>
<li class="flow__us"><strong>Posts</strong><code>GET node/v1/castsByFid?fid=&lt;f&gt;&amp;reverse=true&amp;pageSize=10</code> for you and the 1,000 accounts you followed most recently, at most 8 at a time.</li>
<li class="flow__us"><strong>Merge</strong>Newest first, exact down to the horizon; "Show older posts" reads 25 more from the accounts at the horizon.</li>
<li class="flow__us"><strong>Names</strong><code>GET node/v1/userDataByFid</code> for the authors on screen, the accounts they reply to and mention.</li>
<li class="flow__us"><strong>Open</strong>A post: <code>/fc/cast#&lt;fid&gt;/&lt;hash&gt;</code> (<code>castById</code> up the chain, <code>castsByParent</code> for replies); an author: <code>/fc/profile#&lt;fid&gt;</code>.</li>
<li class="flow__us"><strong>Act</strong>Once Totem may post as you: <code>GET node/v1/reactionsByFid?fid=&lt;you&gt;&amp;reaction_type=Like|Recast&amp;pageSize=200&amp;reverse=true</code> for which cards are pressed; Reply, Like, Recast and their undo go through <code>/api/fc/root</code> and the validator's relay, as any post as you.</li>
</ol>
<p class="flow__note">Plain GETs with the page's unpatched fetch, credentials omitted, no referrer, so the browser makes no preflight. The app server and the validator are not on this path; the fid and hash ride the URL fragment.</p>

- **Where it runs:** the browser device on the live public site, for a visitor signed in with Farcaster; any server answers the route `404 device_only` before reading the body. The node is `FC_ROOT_HUB_URL` (the public node by default), the one post-as-you checks its key on.
- **Measured (read-only, 2026-11-05):** a root following 965, read naively (every profile): 1,933 requests at 8 in flight in 9.5 s, p99 108 ms, no 429. The design, on the same node: 1,096 requests, 50 posts on screen after 0.8 s, everything read after 5.0 s. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}
- **What each party sees:** the node, this browser's address, the page's origin, your own account first and every account and post read; the app server and the validator, nothing new from the reads; Neynar, nothing. A reply, like or recast from a card goes through the validator's relay like any post as you, so the validator sees which post you acted on, with your address and the time. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"} {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}
- **Personas:** no read names one of your personas and nothing is read while one acts; nothing is written as you while one acts, and nothing as you targets a persona's post (`acting_persona`, `own_persona`, refused in the device). {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}
- **Refusals and failures:** fixed codes (`follows_unreadable`, `casts_unreadable`, `cast_unreadable`, `not_found`, `profile_unreadable`, `not_signed_in`, `disconnected_account`, `bad_config`); a 429 pauses every read for its Retry-After; accounts that could not be read are counted; an empty timeline is shown only after reads that worked.
- **Which wins:** Following is the hub for a signed-in visitor, with or without the read relay's key (flow 3 has no following read); For You stays flow 3 when it is on.
- **Code:** `lib/fc/hubRead/{read,copy}.ts`, `app/api/fc/hub/route.ts`, `components/hub/*`, `components/home/HomeFeed.tsx`, `components/home/PickUp.tsx`, `app/(main)/fc/*`.
