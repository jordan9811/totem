# Sign in with Farcaster

Identity, not custody: a sign-in proves that the person in this tab controls a Farcaster account right now, and binds that account to the tab's root as one sealed record. It saves nothing; a passkey does.

::: warning Status: built, test data only
<span class="st st--test">Built, test data only</span> on the public preview: verified against an in-process fixture relay and chain on the rig, and against a loopback stub of both on a local production-shaped copy. It has never run against Farcaster's real sign-in relay or the real Optimism chain; it was deployed on 2026-10-11 and has not been used there yet. <span class="st st--na">Not offered here</span> on the owner's private service, which connects a main account with a posting key instead. Posting as the signed-in account from the public site is <span class="st st--test">Built, test data only</span> and not deployed yet: [Post as you](/mechanism/post-as-you). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
:::

The verdict: the browser device does the whole sign-in and the public app server sees none of it. The two outside parties a sign-in needs, Farcaster's sign-in relay and an Optimism node, each learn "account M signed in to Totem from address X at time T"; neither learns the root. The validator learns one more sealed, padded record that every root writes anyway. Once the public @anon is on (the live universe), the sign-in also sends the validator the anonymous crowd's join, and only after the sign-in is sealed: the account number and a dedicated crowd commitment that no table ties to a root, from the visitor's address; the card says so before the request. The residual is a join: the Totem operator together with the relay or the node could match the address and the time to the root's own traffic. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

## At a glance

<ol class="flow">
  <li><strong>Start</strong>The device opens a channel on Farcaster's relay with a 16-character nonce it drew itself, for this page's own origin, valid ten minutes.</li>
  <li><strong>Approve</strong>You scan the QR code with the Farcaster app, or tap through on a phone, and approve.</li>
  <li class="flow__us"><strong>Verify</strong>The device parses the signed message and checks every field, then the signature, with no server involved.</li>
  <li class="flow__us"><strong>Check the chain</strong>One <code>eth_call</code> from the browser: <code>IdRegistry.idOf</code> for a custody signer, <code>KeyRegistry.keyDataOf</code> for an auth address.</li>
  <li><strong>Seal</strong>One sealed <code>accountLinks</code> record, 1,024 bytes, plus a read-only public self persona.</li>
</ol>
<p class="flow__note">Every failure is a fixed sentence and records nothing. An unreadable node is "could not check", retryable until the ten-minute deadline, and it does not count as a pass.</p>

## Why it is not a save method

Every way to save wraps the same seed under a key-encryption key that the method supplies (D-CU-0-7). A Farcaster sign-in yields no stable secret to derive such a key from: the signature changes with every nonce. And a record on the validator keyed by the account number would be an account-to-anchor table the operator can read, since account numbers are small integers and hashing them hides nothing. So the save picker is passkey first, Sign in with Farcaster second, and the 24 words under Advanced. The card says it before anything else: "This shows which Farcaster account is yours. It does not save your identity: save with a passkey first." {cite: custody-model.md > "Sign in with Farcaster (Persona launch pass, P1)"}

## What the device checks

The signed message is a Sign-In with Ethereum text that Farcaster fixes. The device refuses it unless all of these hold:

| Field | Required |
|---|---|
| statement | exactly "Farcaster Auth" (the legacy "Farcaster Connect" is refused) |
| version, chain id | `1`, `10` |
| domain, uri | this page's host, and a uri on this page's origin |
| nonce | the device's own, in both the message and the relay's status |
| resources | exactly one, `farcaster://fid/N`, and N equals the account the relay reports |
| issuedAt | within [now − 10 min, now + 2 min] |
| expirationTime, notBefore | when present: in the future and not past the device's deadline; in the past |

A 65-byte signature is recovered locally with no chain call; anything longer is a contract wallet, checked through viem's ERC-6492 validator with one call to the node. Then the account: a custody signer needs `IdRegistry.idOf(signer) == N`; an auth address needs `KeyRegistry.keyDataOf(N, key)` to report key type 2, state 1. The node must answer for chain `0xa`. The verifier is stricter than Farcaster's reference library on purpose, so a real Farcaster app that differs is refused rather than accepted (A-SIWF-STRICTER-THAN-REFERENCE); the first real run is the test. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

## Who learns what

| Party | Learns | Kept from it |
|---|---|---|
| Farcaster's sign-in relay | the app's domain, the nonce, your IP address and user agent at every poll, then the account, its username, display name, picture, custody address, verifications, the message and the signature | the root and the personas |
| The Optimism node (`mainnet.optimism.io` by default) | your address asked about account M's custody or auth key at time T | anything else |
| The Totem public app server | nothing: no request reaches it | the account and the time |
| The validator | one signed, sealed `accountLinks` write, exactly 1,024 bytes, which every root makes at boot | the account number and that a sign-in happened |

{cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

The card says this before the first request, in these words: "Farcaster's sign-in service will see that you signed in to Totem, and your internet address. Your browser then checks the account on the Optimism blockchain through mainnet.optimism.io, which sees your internet address too. Totem's server sees nothing." (The host is whatever node the deployment names; that is the default.)

## The read-only public self

A verified sign-in mints one persona for the account, marked `publicSelf`. On the preview it is listed in the switcher with a "Farcaster · read-only" chip and opens its profile instead of switching; on the live site (built on test data, not deployed) it is the switcher's "You": choosing it makes no persona the acting identity, so you act as your own account. The profile shows "that's me". Posting, replying, reacting, following and acting as it through the persona routes are refused on the public site with "Persona actions never act as your Farcaster account. To act as yourself, choose You in the account menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your account, once you allow Totem to post as you. To do this as a persona, switch to one of your personas." Posting as the account itself has its own door and its own key, deployed and switched on, the first real approval not done yet: [Post as you](/mechanism/post-as-you). Forking from it is refused, because a fork carries a continuity proof back to its source and would publicly link the new persona to the account. One account per root: a disconnect leaves a tombstone, and only the same account may sign in again. No other persona of the root may share a name stem with the account's username, in either direction. {cite: custody-model.md > "Sign in with Farcaster (Persona launch pass, P1)"}

"Show my Farcaster posts here" is retired (built on test data 2026-11-07, not deployed): it read your own account through the preview's read relay, which named you to Totem's server. Your posts are read from Farcaster's network on your Farcaster profile instead, and the profile says so. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"}

## What is stored

One record: the account number; the username, display name, picture address and bio as the relay reported them; the persona id; the auth method; the signer address; the SHA-256 of the nonce and of the message; when it was verified; the node's host; and the disconnect time. Not the signature, the raw message, the relay's IP and user-agent metadata, the custody and verified addresses, or the channel token. A signature is a transferable proof that the account signed in to this domain, and keeping it would widen what a vault compromise leaks. {cite: custody-model.md > "Sign in with Farcaster (Persona launch pass, P1)"}

## What this does not protect

- **A join across operators.** The Totem operator with the relay's operator, or with the node's, can match your address and time to your root's signed traffic (A-SIWF-COLLUSION-IP-TIME).
- **The profile fields.** Only the account number is proven. The username, name and picture are the relay's unsigned word (A-SIWF-PROFILE-FROM-RELAY).
- **Liveness.** The relay can withhold or delay a sign-in. It cannot forge one (A-SIWF-RELAY-TRUSTED-FOR-LIVENESS). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
- **The namespace name.** The validator sees that `accountLinks` exists under your anchor, as it does under every anchor (A-SIWF-NAMESPACE-NAME-VISIBLE).
- **A script on the page.** It can start a sign-in, as the page can. It cannot point the device at another relay or node: overrides are honoured only as the default, a loopback address, or a bare https origin for the node (A-SIWF-PAGE-IS-THE-DEVICE). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}
- **The public node's limits.** Whether `mainnet.optimism.io` answers browser calls with CORS at a usable rate is unverified until the first real run; it fails closed either way (A-SIWF-PUBLIC-RPC-CORS-AND-LIMITS).

{cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

## The obvious questions

### Can signing in bring my identity back on a new device?

No. It shows which Farcaster account is yours; it does not unlock anything. A passkey, this browser or the 24 words bring an identity back. {cite: custody-model.md > "Sign in with Farcaster (Persona launch pass, P1)"}

### Why does the browser check the chain, not the server?

Because a server-side check would hand the operator the account, an address and a time, which it could join to the root's own signed validator traffic. In the browser, the parties that learn the account are the relay and the node, and neither holds the root. {cite: custody-model.md > "Sign in with Farcaster (Persona launch pass, P1)"}

### What about Sign in with X?

Built on test data and dormant until the owner creates an X developer app and arms it: [Sign in with X](/mechanism/sign-in-with-x). X answers no browser CORS, so its one-time code goes through a stateless relay on the validator, and the X account joins the same public self as your Farcaster account when you sign in with both. Bring your X, the archive, still costs nothing.

### Can the owner switch it off?

Yes: `FC_SIWF=off` on the public app service hides the card on the next page load, with no rebuild. A misconfigured relay or node address shows "not available on this deployment (misconfigured)" and makes no request.

## Where it lives in the code

- `lib/fc/siwf/verify.ts`: the pure verifier (message fields, signature, chain checks).
- `lib/fc/siwf/flow.ts`: the flow, the fixed sentences, the gate for each shape and the fixture network.
- `lib/fc/siwf/links.ts`: the sealed `accountLinks` record.
- `app/api/fc/siwf/route.ts`: the device route; the server's `404 device_only`.
- `components/device/FarcasterSignIn.tsx`, `components/device/SaveMoment.tsx`, `components/profile/ThatsMeBadge.tsx`: the card, the save moment, the badge.
- `lib/identity/mainName.ts`, `lib/identity/handleStem.ts`: the one-main rule and the name-stem rule.
- Tests: `scripts/unit-siwf.mjs`, `scripts/accept-siwf.mjs`, `scripts/accept-siwf-prod.mjs` with `scripts/lib/siwf-stub.mjs`, and `scripts/smoke-deployed.mjs` check 9.
- Design record: [Custody model](/custody-model), D-SIWF-1 to D-SIWF-4.
