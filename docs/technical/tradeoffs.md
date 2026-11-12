# Tradeoffs

The major decisions, each with the options that lost, why the winner won, and what it costs. Read this before proposing to undo one.

::: info Status
Seven of these are decided and built. Two are not: the separate docs origin is a recommendation waiting on the owner, and "Bring your X" is **Designed**. Each section says which.
:::

## At a glance

<ol class="flow">
<li><strong>The rule</strong>The public server holds no one's keys. Most decisions below follow from that.</li>
<li><strong>The consequences</strong>The browser is the device, the server renders public shells, live reads go through a narrow relay.</li>
<li class="flow__us"><strong>The exception</strong>One person's own rig on a host, so the owner can post to Farcaster now.</li>
<li><strong>The shortcuts</strong>Managed signers, an author list instead of channels, test data first.</li>
<li><strong>Still open</strong>Where the docs live; how X data comes in.</li>
</ol>

## The browser holds the keys, not the server

| Option | What it gives | What it costs |
|---|---|---|
| One keystore in the server process | The original shape; every suite already measured it | Measured on a production-shaped build: two strangers shared one root, one roster and one corpus. Every visitor is the owner. |
| Per-visitor custody on the server, sealed or in a TEE | Server-side features keep working | A server that decrypts a vault per request holds the vault key for that request, on a host the visitor does not control |
| **The browser is the device** | Each visitor mints their own root in their own tab | Everything below |

**Why.** It is the only shape in which the server holds ciphertext, commitments, public keys and public state, and nothing else. Every privacy statement in the posture document assumes the process holding the seed belongs to the user. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"} {cite: docs/custody-model.md > "The one rule"}

**Cost.**
- Any script running on the app's origin can do what the page can, including using the non-extractable wrapping key in IndexedDB. The defence is serving no third-party script; the app's own pages have no content security policy yet beyond `frame-ancestors 'none'` (A-CU-5-THE-PAGE-IS-THE-DEVICE, A-CU-6-NO-CSP-YET). Since 2026-10-10 the docs run on the same origin, at `/docs`, under a strict policy of their own (see [Where the docs are served](#where-the-docs-are-served)).
- An identity that is not saved dies with the tab, and every full page load before saving mints a new root.
- The passkey wrap path needs one server secret, `CUSTODY_RELEASE_SECRET`, and a passkey belongs to the host that saved it.
- There is no social login on the public preview: no real custody provider is in the tree.

{cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

**Status.** Built in the browser keystore pass; **works live** on the public preview.

## The browser answers its own API, and the server renders shells

| Option | What it gives | What it costs |
|---|---|---|
| A service worker answers `/api/*` | Standard browser machinery | It does not control the page that registered it until the next navigation, so its install races the first data fetch |
| **Patch `window.fetch` in the page (D-CU-0-3)** | Deterministic from the first load; 54 of 78 components already called `fetch` | Anything that bypasses the page's fetch reaches a server with no identity |
| Server components read identity | Fast first paint with personal data | Needs the keys on the server |
| Client-render every page | Simple | Throws away the first paint |
| **Server renders public shells; client islands read the device (D-CU-0-4)** | First paint of public content, then the personal layer | A second data path per component |

{cite: docs/custody-model.md > "Where things live"}

**Why.** The route handlers stay one set of modules that run in Node on a rig and in the tab on a public deployment. Islands read through `lib/client/useApiJson.ts`; on the rig the server hands them `initial` data, so the 83 rig suites still exercise the same components.

**Cost.**
- The first paint shows the public ordering and the personal ranking replaces it after hydration.
- `curl`, Playwright's `context.request` and any other caller outside the page get "no identity", so the public shape has its own suites.
- D-CU-0-4 was decided in the browser keystore pass and built only in the prod-live pass. Until then, most pages on the deployed preview printed a load error inside an HTTP 200, and the deployed smoke passed because it did not look at a page.
- In-app links have to be soft navigation: a full page load wipes an unsaved identity.

**Status.** Built (`70151a5`); **works live**.

## A separate read key, behind a server relay

| Option | What it gives | What it costs |
|---|---|---|
| `DATA_SOURCE=neynar` on the public server | Live content with code that exists | The owner's key can post through its signers, so the boot contract refuses it on a public deployment |
| A read key in the browser | No server in the path | A key that reaches any browser works from anywhere |
| **A second Neynar app with no signers; its key read by one server-only module** | Live reads with no write capability anywhere near the public site | The operator sees and pays for every read |
| No live reads | Nothing to run | The preview shows only the demo corpus |

**Why.** Neynar offers no read-only key and no origin or address restriction, and it answers every origin, so a key that leaves the server is a key anyone can use. The relay holds it in `lib/fc/readRelay.server.ts`, the only code that reads it; the route is on the device's server-only list, so the browser bundle cannot contain it. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

**Cost.**
- The app server holds a second secret.
- Every live read passes the operator, and the platform logs the page paths a visitor opens (A-FCREAD-OPERATOR-SEES-READS).
- The operator pays: up to 100,000 credits a day per instance by default, about 30% of Neynar's Free plan over a month. Anyone can spend the day's lookup budget on purpose (A-FCREAD-BUDGET-DOS); discovery keeps its own share.
- Everything the server renders, plus notifications and search, stays preview content; Following does not come through the relay at all (for a visitor signed in with Farcaster it is read by the browser from a Farcaster node: [Following from the hub](/mechanism/following-from-the-hub)).

**Status.** Built and deployed; **Off on purpose** until the owner sets the key and a discovery source.

## No channels in v1: an author list or a house account

Neynar retired its trending feed, global trending and For You in August 2026, so there is no network-wide feed to read. The owner said channels are not an emphasis in v1 (D-FCREAD-NO-CHANNELS-IN-V1).

| Option | What it gives | What it costs |
|---|---|---|
| Channel feeds | A familiar shape | Channels were dropped from v1, and each channel is another call to budget |
| **An author list, `FC_READ_FIDS`** | 1 to 100 chosen accounts; one call per cache miss | Changing the list means a variable change and a redeploy |
| **A house account, `FC_READ_HOUSE_FID`** | Curate by following and unfollowing, no redeploy | The house account's follows are public, so the curation is public |

**Chosen.** Exactly one of the two, chosen by the owner. There is no default: with neither set, or both, the relay stays unarmed and says `bad_config`.

**Cost.** Strangers see a curated author list, read-only, not "Farcaster". Only authors' own top-level posts are shown, and an author with a Neynar user score below 0.5, or with no score, is hidden. Channel tabs stay preview content. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(i) THE PUBLIC SITE'S LIVE READS — the READ key"}

**Status.** Built; dormant with the relay.

## Managed signers now, self-custody later

| Option | What it gives | What it costs |
|---|---|---|
| **Neynar managed signers** | Posting works through `/cast`, `/reaction` and `/user/follow` with a signer id | Neynar holds every persona's signing key |
| A developer-managed signer on a root-derived key | The key comes off the 24 words; Neynar relays but does not hold it | Every write becomes a signed protocol message (150 credits each); `lib/fc/writes.ts` knows only signer-id endpoints |
| Signing in the browser, with a write relay | Strangers could post from the public site | For a visitor's OWN account: built, test data only, not deployed (a key in the vault, approved in the Farcaster app, relayed unchanged by the validator; [Post as you](/mechanism/post-as-you)). For a persona's own account: needs account registration and a sponsor; not built |

**Why.** It is the shape the code already had, and it gave the owner real casts in one pass.

**Cost.** Neynar, and anyone holding the API key, can write as every persona, and one API key registered, signs for and sees every persona account, so Neynar can join them all (A-PRODLIVE-NEYNAR-HOLDS-THE-SIGNERS, A-FID-NEYNAR-SEES-ALL). A reveal of an anonymous post is signed, but the check of that key against Farcaster's key registry is not built and the derived key that signs it is not registered on the account, so other readers see a revealed post as plain `anon`: a reveal is checkable inside Totem only (A-FID-ATTR-LIVE-KEY-REGISTRY, A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY). Each active signer costs about 20,000 credits a month. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

**Status.** Managed signers built on the owner service. The root-derived signer is **Designed**. Signing in the browser with a write relay is built, test data only, for a visitor's own account (2026-11-05, not deployed), and **Designed** for a persona's own account. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(h) The public site: what it does now, and what comes next for strangers"}

## The owner service as the honest substitute

| Option | What it gives | What it costs |
|---|---|---|
| Run the public preview in rig mode | Live posting today | Every visitor would be the owner. Rejected twice. |
| Wait for browser self-custody | The real design | Not built |
| The laptop rig only | Works now | Posting only while the laptop is on |
| **A separate rig-shaped pair on Railway, for one person, behind a passphrase** | Real accounts and casts now, without touching the public preview | One scoped exception to the one rule |

**Why.** It gives the owner live Farcaster without making the public site hold anyone's key. {cite: notes/runbooks/PREVIEW-READINESS.md > "Addendum (2026-09-23) — D-PRODLIVE-OWNER-SERVICE: the honest substitute, built for one person"}

**Cost.**
- The platform holds the owner's seed on a volume, unencrypted by this codebase (A-PRODLIVE-THE-HOST-HOLDS-THE-SEED).
- The passphrase, or a Face ID / fingerprint sign-in added from a passphrase session, opens the whole account (alternatives, not two factors), and a session cookie is a bearer token for up to 30 days (`OWNER_SESSION_DAYS`, capped at 90), revocable server-side: Sign out everywhere, remove a passkey, change the passphrase. The passkey build was deployed on 2026-10-10 and has not been used there yet.
- The owner validator's dev routes are open; being unreachable is its only protection.
- The privacy label's conditions are not met there. On a one-owner service the membership proof hides nothing, because there is no crowd: the anonymous account is an extra account with no name on it.

{cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

**Status.** **Works live** for its one user. The app's own Post, Like, Recast and Follow buttons reaching Farcaster as a persona are **Built, test data only** (the buttons build of 2026-10-08) and wait for a deploy and a first real post; on the deployed service today they still save inside Totem.

## Where the docs are served

| Option | What it gives | What it costs |
|---|---|---|
| **`/docs` on the app's origin** (the pattern the owner's other project uses) | One domain, one deploy, docs that always match the app they describe | The docs' scripts run on the origin that holds visitors' keys; the docs go down with the app's kill switch; a docs edit ships only with an app deploy |
| GitBook Git Sync | A hosted editor | Needs a git remote, and renders neither the citation tokens nor VitePress containers |
| GitHub Pages | Free hosting | Needs a remote, and a paid plan for a private repository |
| Cloudflare Pages or Netlify | A separate origin, no remote | A new vendor account |
| A static Railway service of its own | A separate origin on the platform already in use | One more service and deploy step |

**Decision.** `/docs` on the app, the owner's call on 2026-10-10 ("it should just be project / docs"), recorded as D-DOCS-UNDER-APP. It replaces the separate Railway service, which was built and published the same day and is now retired. The risk it accepts, stated plainly: the app's origin keeps each visitor's non-extractable wrapping key in IndexedDB, any script on that origin can use it, and the docs now ship client code on that origin. The mitigations: every docs page is written in this repository, with no user content and no third-party script; `npm run build` builds the site from the committed source with `SHOW_INTERNAL` removed and fails on anything internal; and every docs page carries a content security policy that runs only the site's own scripts, loads only from the app's origin and connects nowhere else. The policy does not stop a script the build itself ships. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

**Cost.** Nothing extra: no service and no domain. The retired docs service can be deleted.

**Status.** Deployed: each app has served the docs at `/docs` since 2026-10-10 (checked on the public preview; behind sign-in on the owner's service). `NEXT_PUBLIC_DOCS_URL` must stay unset on both apps, because a value there overrides `/docs`.

## The X archive, not the X API

| Option | What it gives | What it costs |
|---|---|---|
| The X API with per-user OAuth | Live linking, sync, crossposting | Pay per use with no free tier: about $10 to read one person's 1,000 follows and $16 for 3,200 posts, $0.015 a post, $0.20 with a link. Tokens expire after 2 hours unless refreshed, and X sends no CORS headers, so a server must hold the client secret. |
| **The archive X gives every user, parsed in the browser** | Follows, posts and account details at $0 | The archive takes about a day to arrive and has no bookmarks |
| **Farcaster's keyless X-verification lookup** | Maps the numeric X ids in the archive's `following.js` to Farcaster accounts, with browser access allowed | About 397,000 rows, so the whole index (2 to 5 MB) is downloaded and matched on the device |

**Plan.** "Bring your X" v1: drop the archive, see which of your X follows are on Farcaster, follow them in one confirm, and keep your posts as a dated shelf. The follow list stays on the device. Prices are from X's pricing page as read on 2026-10-07.

**Cost.** Importing a follow list into a persona ties that persona to your X identity, because a follow graph is a fingerprint. Following hundreds of matches needs a follow budget beyond the write ledger's 30 actions a day. Whether Farcaster permits bulk mirroring of the lookup is unverified.

**Status.** Today, every X feature is **Built, test data only**, and no X credential exists. Bring your X v1 (the persona launch pass) is built on a synthetic 3,000-post archive: the ZIP or folder read in the page, sealed pieces, the keyless list matched on the device; the list is off until the owner switches it on. Paid X features wait for the owner's yes. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"} {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

## Test data first, behind one adapter registry

| Option | What it gives | What it costs |
|---|---|---|
| Build each surface against a real backend first | Every feature is real when it ships | Nothing is demoable until every backend exists |
| **Typed mock adapters behind a registry** | A complete, clickable product now; a backend swap is a registry change | "Built" is easy to mistake for "works" |

**Why.** The surface was much larger than any backend that existed. Mocks fail on purpose (200 to 1,500 ms of latency, 2% errors), so every screen handles loading and failure from day one. {cite: ARCHITECTURE.md > "Why adapters, and why mock-first"}

**Cost.** Several passes closed "fixture-verified" and the docs then called the features shipped: X interop and the persona accounts were both overstated. The demo world needs hiding on the owner service (`LAYERS_WORLD=empty`). And the mock store is the production store on the public device, so its limits ship: local posts live in memory and are gone after a reload. This site's status words exist to keep the difference visible.

**Status.** The shape of the codebase.
