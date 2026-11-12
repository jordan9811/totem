# The anon page and the Farcaster Mini App

<!-- PUBLIC GO-LIVE (2026-10-17): the mechanism note for /anon (the native anon page) and its Farcaster Mini App. The
     consumer page is docs/features/anon-page.md; the relay underneath is docs/mechanism/anon-relay.md. -->

The anon page (`/anon` on the site) is a door into the public @anon relay for Farcaster people who skip the rest of
Totem. It boots the same browser device as the app, makes a light root with no persona, signs in with Farcaster to join
the crowd, and posts as that root through the same proof, the same caps, the same filter and the same relay as a
persona's post in Totem. Inside the Farcaster app it is a Mini App ("Anon Wire"), described by a manifest at
`/.well-known/farcaster.json` that the owner signs for the site's final web address.

::: warning Status: built, test data only, not deployed yet
<span class="st st--test">Built, test data only</span>, tested against stand-ins on the test machine (a stand-in sign-in
relay and chain, a stand-in for Neynar, throwaway validators), part of the go-live build and not deployed yet. Nothing
it sends has reached Farcaster. Its posts reach Farcaster only once the owner arms the public @anon (until then a live
site offers no anonymous posting: in live mode the test universe is off); the Mini App opens inside Farcaster only once
he has signed its manifest. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}
:::

The verdict: the page adds a door, not a new trust. The server that renders it holds no key and hears nothing about a
post; the proof is made in the visitor's tab; the one relay credential stays on the validator; and what a post costs
(Neynar reads it, the operator sees its words, hour and sending address, a crowd under 50 stays closed) is the relay's,
stated on the page before the first post. What the page adds is stated too: inside Farcaster, the Farcaster client knows
that its user opened the page, and a Share posts from the sharer's own account. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"} {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

## At a glance

<ol class="flow">
  <li><strong>Boot</strong>The page starts the browser device and makes a light root, with no persona: the root's commitment is the crowd's leaf</li>
  <li class="flow__us"><strong>Join</strong>A verified Sign in with Farcaster, then the relay's fid gate adds one commitment for that account, a leaf from the next 6-hour window</li>
  <li class="flow__us"><strong>Prove</strong>The tab proves "one free slot of a member of the crowd this window" in a background worker</li>
  <li class="flow__us"><strong>Filter and queue</strong>The validator checks the proof, refuses the obvious, keeps the post until its slot</li>
  <li><strong>Relay</strong>The post goes out from @anon at a random moment in the next slot</li>
</ol>
<p class="flow__note">The share page, the Report button and the takedown queue sit beside this path; the Mini App is the same page opened inside Farcaster.</p>

## The fid gate

On the public site the live crowd is one commitment per Farcaster account (D-PUBLIC-LIVE-TREE). After a verified
sign-in the device sends the signed sign-in message with its commitment and a salt; the message's nonce has to bind that
commitment and salt, its domain has to be the site's own (`APP_URL`), it has to be fresh and unused, and its signer has
to be the account's custody address or one of its auth addresses, which the validator reads from Optimism without a key.
A newer sign-in moves the account to a new commitment from the next window. The validator keeps which account joined
with which commitment (a dedicated crowd identity, never the root's registered commitment), and from the proof alone
never learns which member wrote which post; the sign-in, the posts and the reports reach it from one address while no
outside relay is set up. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

Inside the Farcaster app the page signs in through the Mini App SDK's own sign-in, over the device's nonce, and the
device checks the signature and the chain itself, exactly as for the QR flow. When that is not available the page says
"Signing in from inside Farcaster isn't ready on this site yet. Open this page in your browser to sign in."
{cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

## Caps, slots and timing

The page posts as the root (`postAs: "root"`), under the same budget as a Totem persona's anonymous post: a few slots
per person per 6-hour window (4 by default, shared with that root's personas), a daily cap for the whole site, and the
public relay's lifetime cap, which the owner sets when he arms it and raises later. A new member's first post waits for
the window after it joined, and posting opens only once at least 50 people have joined (the client's floor). Posts leave
in 30-minute slots with a random spread of up to 30 more, in random order. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"} {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

## The filter, reports and takedowns

Before a verified post is stored, an automatic filter refuses the obvious (slurs, phone numbers, email and street
addresses, scam links), and the tab runs the same filter first, so the reason shows before the click; a refusal is
logged as its rule and hour only. Every @anon post carries a Report button with a fixed list of reasons and no reporter.
The owner's moderator key, derived on his device from his saved identity (every device that opens that identity has
the same one), signs a REMOVE, which hides the post in Totem at once, keeps its record, and deletes it from Farcaster
through the agent; an outcome that cannot be confirmed is said as such.
{cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

## The Mini App

- **The manifest** is served at `/.well-known/farcaster.json` by the app's server, from `APP_URL` and three public app
  variables (`MINIAPP_ACCOUNT_ASSOCIATION_HEADER`, `_PAYLOAD`, `_SIGNATURE`): the account association, a signature over
  the site's domain by the Farcaster account that owns the Mini App. It grants nothing; it proves the domain. Unsigned,
  or signed for another domain, the manifest is served without it and the server's log says why, because Farcaster
  refuses an unsigned app and a manifest that looked signed would be a lie. The owner signs it in the Farcaster app's
  developer tools and runs one script, `scripts/owner/arm-miniapp.ps1`: `-FromClipboard` takes the manifest tool's
  accountAssociation JSON (without it, three visible prompts ask for the header, the payload and the signature, which
  are public), it shows the domain and the account the signature is for, and a typed SIGN puts it on the public app.
  It refuses a signature for another domain than the site's, an `APP_URL` that is unset or not https, and a public app
  that carries a must-not-ship variable (named, never valued). It sets the three variables on stdin without
  redeploying, reads them back, redeploys once and reads the manifest back; a re-run with the same values says "nothing
  to change". `-Status` only reads ("SIGNED for ..." or "UNSIGNED: ..."), and `-Disarm` deletes the three, redeploys
  and checks that the manifest is unsigned again. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}
- **The embed.** The anon page and each share page print a `fc:miniapp` tag (and the older `fc:frame`), so a cast that
  links them shows a "Post anonymously" button that opens the page inside Farcaster.
- **Framing.** These two pages, and only these, may be framed, and only by the Farcaster web client's own origins
  (the Mini App opens in an iframe on the web and a WebView on a phone). Their content security policy allows scripts,
  styles and fonts from the site only, images from the site and the hosts the Totem app loads pictures from directly
  (Open Totem continues the Totem session in the same page), and connections to the site, its validator and the
  sign-in services the page names. Every other page stays unframeable. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

## The share page and Open Totem

`/anon/p/<hash>` shows one relayed post, read from the validator's public one-post read with no viewer; a post that was
taken down, or never existed, is a 404, and a validator that cannot be read is said in plain words, never "not found".
A test post is labelled "Preview only · not on Farcaster". Open Totem is a soft move to the guided start in the same
tab on the site, so the root and the sign-in come along; inside a Mini App, Totem opens in the browser, which keeps
separate storage, and the page says so. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

The feed under the composer reads `/api/anon?recent=1&casts=1` (answered by the browser device in the tab) every 60
seconds and after a post. Inside Farcaster, `ready()`, which hides Farcaster's splash screen, is called as soon as the
page has drawn its first screen, before the browser device has finished booting; the SDK is the bundled
`@farcaster/miniapp-sdk` 0.3.0, evaluated only when the page is framed or in a WebView.
{cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

## What this does not protect

- **The Farcaster client.** Inside the Farcaster app, the client knows its user opened the Mini App, and can see the sign-in it asked for. It does not see the proof or which post was theirs. {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}
- **A Share.** Sharing posts from your own account; sharing your own fresh post points at you, and the page says so first.
- **Everything the relay does not protect:** Neynar reads every post, the operator sees words, hours and the sending address, writing style is yours to watch, and the main Farcaster app may hide @anon. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

## Where it lives in the code

`app/anon/page.tsx`, `app/anon/AnonApp.tsx`, `components/anon/*`, `app/anon/p/[castHash]/page.tsx`, `lib/miniapp/manifest.ts`,
`lib/miniapp/sdk.ts`, `app/.well-known/farcaster.json/route.ts`, `middleware.ts` (the framing exception); the relay underneath
is [The anon relay](/mechanism/anon-relay). Tested by `scripts/unit-miniapp.mjs`, `scripts/accept-anon-page-prod.mjs` and the
owner script's cases (`scripts/owner/test/cases-miniapp.mjs`).
