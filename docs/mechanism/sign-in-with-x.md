# Sign in with X

"Continue with X": approve on X, and your X account is you in Totem, with its name, username and picture. Identity, not custody: it shows which X account is yours and saves nothing; a passkey does.

::: warning Status: built, test data only; dormant until the owner arms it
<span class="st st--test">Built, test data only</span> and not deployed. It has run only against a loopback stand-in for X on a local copy shaped like the public site with live mode on, never against X itself. Until the owner creates an X developer app and runs `scripts/owner/arm-x-signin.ps1`, every "Continue with X" stays the disabled button marked Soon. <span class="st st--na">Not offered here</span> on the owner's private service. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}
:::

The verdict: X learns that you signed in to Totem, from your internet address. Totem's app server sees one page request coming back from X, with a one-time code it has no use for. Totem's validator passes that code to X and reads your public X profile for one request, then revokes the token: it is the one Totem server that sees which X account signed in, and the posture names that as an assumption. No persona is involved at any step. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

## At a glance

<ol class="flow">
  <li><strong>Keep, then go</strong>The tab keeps your identity in this browser (x.com replaces the page), draws a PKCE verifier and a state into this tab's own storage, and opens X's authorize page asking for <code>users.read tweet.read</code>.</li>
  <li><strong>Approve on X</strong>You approve on X. X sends the tab back to <code>/welcome/x</code> with a one-time code that lives 30 seconds.</li>
  <li class="flow__us"><strong>Check</strong>The device reads and removes the stored request (one shot), and refuses an answer whose state is not the one it made.</li>
  <li class="flow__us"><strong>Redeem</strong>The validator's thin relay trades code and verifier for a token, reads <code>/2/users/me</code>, revokes the token and answers the profile alone.</li>
  <li><strong>This is you</strong>Your X name, username and picture, editable, then Keep your account with a passkey.</li>
</ol>
<p class="flow__note">Every refusal is a fixed sentence and links nothing: a replayed callback, a wrong state, Cancel on X, a code past its 30 seconds.</p>

## Why there is a relay

X's token endpoint and its API answer no browser CORS for another site's origin. Measured read-only on 2026-11-06 with `Origin: https://ontotem.com`: `OPTIONS https://api.x.com/2/oauth2/token` answered 404 and `OPTIONS https://api.x.com/2/users/me` 405, with no `Access-Control-*` header; the same preflight from `https://x.com` answered 200. So the code cannot be redeemed from the tab. The step runs on the validator, stateless, the way the hub relay does for posting as yourself, and not on the public app server. It forwards only the client id it is armed with, to an https Totem callback only, and logs a count every ten minutes and nothing else. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

## Who learns what

| Party | Learns | Kept from it |
|---|---|---|
| X | that this X account signed in to Totem, your address and browser on its consent page, the time; then, from the validator, one code redeemed, one profile read, one revoke | your other accounts, your personas |
| The Totem public app server | one request, `GET /welcome/x?state=…&code=…`, from your address | the X account: the code needs the verifier, which stays in your tab |
| The validator | for one request: the code, the verifier, the token and your public X profile, with your address and the time | which identity in Totem made the request, your personas |

{cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

The card says this before anything is sent: "X will see that you're signing in to Totem, and your internet address. X opens in this tab, so Totem first keeps your identity in this browser. When you come back, Totem's server sees only that this browser returned from X. Totem's validator then trades X's one-time code for your public X profile, keeps nothing and logs nothing: it is the one Totem server that sees which X account signed in."

## What is stored

One more link in the same sealed record a Farcaster sign-in uses, padded so the record is exactly 1,024 bytes with no link, one, or both: the X account id, the username, the name, the picture address, X's verified flag and verified type, the persona id of your public self, and two times. Not the code, the verifier, the state or any token: the tab holds no token, and the relay revokes the one it used. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

## X and Farcaster on one identity

One identity has one public self. Sign in with X first and its persona is made from your X profile; connect Farcaster later (Sign in with Farcaster on the same step) and the Farcaster account joins that same public self, keeping the name and picture you confirmed. The other order works the same way. Your profile then says "Your Farcaster and X accounts", Settings › Account lists both, and each can be disconnected on its own. One X account per identity, kept as a tombstone after a disconnect, so only the same X account can sign in there again. No persona may share a name stem with your X username: matching names would link them in public. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

What needs a Farcaster account says so to an X-only identity, with "Connect Farcaster": your Following (it is your Farcaster graph), posting as yourself, and the anonymous crowd. Find your people uses your X archive, which stays in your browser, matched against the list of X accounts Farcaster users verified. Reading your X follows from X's API is off by decision: it costs $0.010 per account returned. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

## What X requires and costs (read 2026-11-06)

| Fact | As X documents it | Source |
|---|---|---|
| Authorize page | `https://x.com/i/oauth2/authorize` (twitter.com answers a 301 to it) | [docs.x.com authorization code](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) |
| Token, revoke | `POST https://api.x.com/2/oauth2/token`, `POST https://api.x.com/2/oauth2/revoke` | [docs.x.com user access token](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token) |
| Public client | "Native App" and "Single page App" are public clients: PKCE only, `client_id` in the body, no secret | [docs.x.com developer apps](https://docs.x.com/fundamentals/developer-apps) |
| Confidential client | "Web App, Automated App or Bot": HTTP Basic `client_id:client_secret` at the token endpoint | user access token page |
| Callback | must match exactly, trailing slash included; up to 10 per app; for local work `http://127.0.0.1`, not `localhost` | developer apps page |
| Code and token | the code lives 30 seconds; the access token two hours; a refresh token only with `offline.access` (not asked) | authorization code page |
| Scopes | `/2/users/me` needs `users.read` and `tweet.read`; following needs `follows.read` too | [get my user](https://docs.x.com/x-api/users/get-my-user), [get following](https://docs.x.com/x-api/users/get-following) |
| Fields | `profile_image_url`, `verified`, `verified_type` (blue, business, government, none) are asked; the default is id, name, username | [data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary) |
| Rate limit | `/2/users/me`: 75 requests per 15 minutes per user | [rate limits](https://docs.x.com/x-api/fundamentals/rate-limits) |
| Pricing model | pay-per-use credits, bought upfront, no subscription and no free tier for new developers; requests stop when credits run out | [introduction](https://docs.x.com/x-api/introduction), [pricing](https://docs.x.com/x-api/getting-started/pricing), [changelog](https://docs.x.com/changelog) (2026-02-06) |
| A sign-in's cost | "User: Read" is $0.010 per resource returned, so at most about $0.01 per sign-in; whether `/2/users/me` is billed at all is not stated (forum answers disagree). Each user is counted once per UTC day, on a best-effort basis by X's own account | pricing page |
| Following | $0.010 per user returned: about $10 for one page of 1,000 | pricing page |
| Free credits | $20 after the first credit purchase (adding a card alone no longer qualifies since 2026-10-13); they expire after 3 months | [free credits](https://docs.x.com/x-api/getting-started/free-credits) |
| The account | sign in at console.x.com with an X account, accept the Developer Agreement and Policy, describe the use case, name the app | [getting access](https://docs.x.com/x-api/getting-started/getting-access) |
| Policy | matching X data to identities elsewhere needs the user's express opt-in, and signing in is not by itself that consent | [developer policy](https://docs.x.com/developer-terms/policy), [agreement](https://docs.x.com/developer-terms/agreement) (2026-04-27) |

Unverified until the first real run: whether a new pay-per-use app answers `/2/users/me` at once (forum threads from November 2026 report 403 "client-not-enrolled" until the app is enrolled in pay-per-use), whether `/2/users/me` is billed, how X words its consent screen for a Single page App, and phones: when the X app is installed it may take over the x.com link, and the sign-in finishes only if X sends you back to the same browser tab that started it (another tab or an in-app browser says "not in progress in this tab", and nothing is linked). X also announced that expansion objects are billed from 2026-11-22; Totem asks for none.

## What this does not protect

- **The validator's view.** It sees your public X profile for one request and could be changed to keep it (A-XSI-RELAY-SEES-PROFILE). {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}
- **An address-and-time join.** The operator can match the relay request to your identity's own signed traffic from the same address (A-XSI-COLLUSION-IP-TIME). Personas stay out of it: their posts carry no root. {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}
- **The relay's word.** X issues no signed identity token a browser could check, so the tab trusts the relay for which X account signed in (A-XSI-RELAY-TRUSTED-FOR-PROFILE). {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}
- **The callback's query.** X answers in the query string, so the app server sees the callback request; the code in it is useless without the verifier and dies at first use (A-XSI-CALLBACK-QUERY). {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}
- **A slow phone.** X's code lives 30 seconds; a device that boots slower than that says so and asks you to start again (A-XSI-CODE-30S). {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"}

## The obvious questions

### Can signing in with X bring my identity back on a new device?

No. It shows which X account is yours; it unlocks nothing. A passkey, this browser or the 24 words bring an identity back.

### Why does Totem ask X for so little?

Only the profile is needed to show you as you. No posting permission, no follows, no refresh token, and the token is revoked once the profile is read.

### Can the owner switch it off?

Yes: `scripts/owner/arm-x-signin.ps1 -Disarm` takes the client id off the app first (the button says Soon again on its next load), then off the validator (the relay refuses). `X_SIGNIN=off` on a service is the same switch without deleting anything.

## Where it lives in the code

- `lib/x/signin/pkce.ts`: PKCE, the state, the authorize URL, the callback's checks, the profile's shape.
- `lib/x/signin/config.ts`: where it is offered (the server's hints to the tab, the landing's promise).
- `lib/x/signin/flow.ts`: the device flow, its fixed sentences and the record.
- `app/api/x/signin/route.ts`: the device route; any server answers `404 device_only`.
- `app/(main)/welcome/x/page.tsx`, `components/x/XCallback.tsx`: the callback page.
- `components/x/XSignIn.tsx`: the card; `components/x/ConnectFarcaster.tsx`: what an X-only identity is told.
- `validator/xsignin.js`: the relay.
- `lib/fc/siwf/links.ts`: the shared sealed record.
- Tests: `scripts/unit-x-signin.mjs`, `validator/test/xsignin.test.js`, `scripts/accept-x-signin-prod.mjs`, with `scripts/lib/x-api-stub.mjs`.
- The owner's switch: `scripts/owner/arm-x-signin.ps1` and notes/runbooks/OWNER-CHECKLIST.md, "Sign in with X".
