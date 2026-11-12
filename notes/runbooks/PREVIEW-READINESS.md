# PREVIEW-READINESS — Gate 0 of the public preview pass (2026-09-16)

**Verdict: STOP THE PASS. Do not deploy.** Multi-tenancy does not hold, and
unauthenticated requests mutate every visitor's state. Both are structural,
not configuration. What would need building is at the end.

Method: two empty browser contexts (A and B, no cookies, no device, no
root) driven by `scripts/audit-preview-g0.mjs` against the production build
of `ad7207a`, once in the harness configuration (`ZK_DEV_HOOKS=true` on
both processes) and once in a production-shaped configuration
(`NODE_ENV=production`, `ZK_DEV_HOOKS` unset, every write flag unset,
`NEYNAR_API_KEY` absent). `scripts/audit-secrets.mjs` did the secrets
audit against the build output, both process logs and every tracked file.
Nothing below is inferred from reading code alone; every row was measured.
Both instruments are committed so the answers can be re-derived.

---

## 1. Multi-tenancy — does a fresh browser mint its own root?

**No. Every visitor IS the owner.** The deployed app would be the owner's
device, and a stranger opening the URL occupies it.

| measured (production-shaped config) | A | B |
|---|---|---|
| cookies set on first visit | none | none |
| `/api/personas` roster and active persona | `persona_59b0853b88dfddb1` | the same |
| zk root commitment (`/api/zk?mode=fixture`) | present | **identical to A's** |
| `/api/dev` registry readable | 200 | 200 |

Why, in the code: there is one keystore file per process
(`.keystore/root.json`, `lib/identity/keystore.ts`), one vault key derived
from that seed, one in-memory state (`lib/adapters/mock/store.ts`
`state()` on `globalThis`), one seeded viewer (`SEED_VIEWER`), and the
only per-request selection is a cookie that picks WHICH of the owner's own
personas is acting (`lib/activePersona.ts`, `lib/session.ts`). Nothing mints
a root, a keystore or a vault per visitor, because the app was built as a
single-user client where "the device" is the process it runs in. Every
privacy claim in `SECURITY-POSTURE.md` assumes that topology (§8); a shared
process breaks it before any adversary is involved.

## 2. Seeded state — shared, per-visitor, or cross-mutating?

**Shared and cross-mutating, in both configurations.**

| measured | hooks on | production-shaped |
|---|---|---|
| A posts a cast; B's feed (`/api/feed`) contains it | yes | yes |
| B sets the plain cookie `layers_seed_persona=persona_viewer_alt` and reads `/api/private/posts` | 200, 3 posts | 200, 3 posts |
| B, with that cookie, authors a private post as the owner's private persona | 200 | 200 |
| B calls `/api/dev {action:"viewAs"}` (not in the refused set) and reads private posts | 200, 4 posts | 200, 4 posts |
| B calls `resetSeed`; A's cast survives | no — wiped | refused (403); survives |

The private persona is one of the owner's seeded personas, so a
guessable cookie value — no secret, no proof — is all a stranger needs to
read and write the owner's private posts. That is the disclosure model
inverted: it is not a bug in a grant check, it is the absence of any
notion of "which person is this request from".

## 3. Dev surfaces — every rig hook, with a verdict

Verdicts are for a production build with `ZK_DEV_HOOKS` unset, as measured.
**Anything marked OPEN that mutates state is a stop-the-pass finding by the
pass's own rule; four of them are.**

| surface | where | production verdict (measured) | mutates shared state? |
|---|---|---|---|
| `/api/dev` GET (adapter registry, latency/failure controls, data source) | `app/api/dev/route.ts` | **OPEN** (200) | no, but leaks configuration |
| `/api/dev` `resetSeed`, `tamperState`, `issueTestDelegation`, `setDataSource`, `simulateDeviceLoss`, `revokeDevice`, `corruptVaultCiphertext` | same, `RIG_ONLY_ACTIONS` | refused (403) | — |
| `/api/dev` `forceFail {label,count}` | same | **OPEN** (200) | **yes** — the next N adapter calls of every visitor fail |
| `/api/dev` `setLatency {range,failureRate}`, `maxLatency {on}` | same | **OPEN** (200) | **yes** — process-wide latency and failure injection |
| `/api/dev` `forgeEvent`, `forceExhaust`, `resetInboxCursor`, `fastForwardReadwise` | same | **OPEN** (200 / 500) | **yes** — event log, caught-up state, the DM cursor, readwise queues |
| `/api/dev` `viewAs {personaId}` | same | **OPEN** (200) | per-browser cookie, but grants any persona incl. the private one |
| `/api/dev` `cryptoProbe`, `vaultRoundTrip`, `vaultReadback`, `decorateProbe`, `lastReceived`, `setCollapse`, `setLastVisit`, `expireNeynarCache`, `forceFcPublishDrop`, `fcSimNetwork` | same | **OPEN** | probes; `fcSimNetwork` / `forceFcPublishDrop` change shared behaviour |
| `/api/dev/live` (DATA_SOURCE diagnostic that performs a real Neynar read when a key exists) | `app/api/dev/live/route.ts` | **OPEN** (200); with the key present it fetched 5 live casts — a spend-capable read from an unauthenticated GET | no; costs credits |
| `/api/zk` rig actions (`resetZk`, `seedDecoys`, `register`, `advanceEpoch`, `prefetchNow`, `drain`, `prove`, `submit`, `enqueue`, `setRepImpl`, `setHonoredIssuers`, `requestAttestation`, `budgetProbe`, `probe`) | `app/api/zk/route.ts` | refused (403) | — |
| `/api/search/unified` POST hooks (`semanticUnavailable`, `cloudSends`, `dropIndex`, `embedBothWays`) | `app/api/search/unified/route.ts` | refused (403) | — |
| `/api/fc/persona` rig actions | `app/api/fc/persona/route.ts` | gated on `ZK_DEV_HOOKS` (code) | — |
| cookies `layers_view_as`, `layers_seed_persona` | `lib/activePersona.ts` | **honoured in production** — a plain value selects any seeded persona | per-browser, but see §2 |
| `SHOW_INTERNAL` (docs site only) | `docs/.vitepress/config.mts` | safe — build-time, docs only | no |
| validator `/zk/dev/*` (`reset`, `advance-epoch`, `seed-decoys`, `split-view`, `request-count`, `relay-now`) | `validator/zk.js` | refused (403) | — |
| validator `POST /events {rootId,type,count}` | `validator/server.js:174` | **OPEN** (201, score moved) — no envelope, no signature | **yes** — anyone inflates any root's reputation |
| validator `GET /state`, `GET /state/:ns` | `validator/server.js:365` | **OPEN** (200): every namespace, plaintext ones readable (`escrows`, `balances`, `readRequests`, `activeMode`, `lastVisit`, `lenses` on this instance) | no; the operator view becomes the public view |
| validator `PUT /state/:ns`, `DELETE /state` | same | refused without a device envelope (401) under `LAYERS_REQUIRE_SIG=true` | — |
| validator `POST /device/auth-anchor` | `validator/server.js:231` | first-write-wins: refused here (409) because an anchor exists; **on a fresh deployment the first stranger's key becomes the anchor** | — |
| validator `POST /stakes`, `/zk/register`, `/zk/submit`, `/zk/attest`, `/zk/issuers` | `validator/stakes.js`, `validator/zk.js` | signature-checked per row (stakes) or proof-checked; public by design | — |
| rate limiting, anywhere | — | **none** on any route of either process | — |

## 4. Secrets audit

**Clean.** `scripts/audit-secrets.mjs`, names and counts only:

- `.env.local` holds 11 values (Neynar key and wallet id, the validator URLs, the throwaway Farcaster fid, fname, origin, custody address, custody PRIVATE key, signer uuid, signer public key). None is tracked (`git ls-files` clean; `.env.local`, `.keystore/`, `validator/*.db`, `.zk-artifacts/`, `research/live-fid*.json` all ignored).
- No secret VALUE appears in the client bundle (`.next/static`), the server bundle (`.next/server`), the app log or the validator log. Names appear as expected references only.
- The keystore's long value (the root seed material) appears nowhere.
- The two tracked live artifacts (`research/live-att1.json`, `shots/live-z2.json`) hold status shapes and counts, no credentials.
- `NEXT_PUBLIC_VALIDATOR_URL` and the throwaway fid/fname/origin are public by design.
- One exposure the audit could not see: `next start` loads `.env.local`, so the harness instance carries the Neynar key and the custody private key in process. Production must start from an environment that does not contain them.

## 5. What production must have OFF — and whether each refuses

Measured on the production-shaped instance (flags unset):

| flag / path | measured | verdict |
|---|---|---|
| `ENABLE_FC_WRITE` / `ENABLE_WRITE` unset → `/api/fc/write cast` | 200, `mode: "fixture"` (no network write) | refuses live; fixture write still lands in the shared corpus |
| `ENABLE_X_WRITE` unset → `/api/crosspost` to destination `x` | 403 (not bound; the flag refusal sits behind the binding check) | refuses |
| `ENABLE_X_READ` + X credentials absent → `/api/x/inbox` | `mode: "fixture"` | refuses live |
| spend ledger `/api/x/spend` | 0 entries, live total 0 | nothing spend-capable ran |
| live proving → `/api/zk prove` | 403 (rig action) | refuses; `ZK_MODE` defaults to `fixture` |
| FID acquisition (`FID_ACQUIRE_ENABLED` unset) | fixture path only; records 0 | refuses live |
| `DATA_SOURCE` unset | `seed` | correct |
| `NEYNAR_API_KEY` absent → `/api/dev/live` | `hasKey: false`, `liveFetch: "threw"` | refuses — **but with the key present the same GET performed a real read**; the key must not ship |
| `ZK_DEV_HOOKS` unset (both processes) | app rig actions 403, validator dev routes 403 | correct — but see §3 for the actions that are not gated at all |

Production must therefore have OFF (unset): `ENABLE_FC_WRITE`, `ENABLE_WRITE`,
`ENABLE_X_WRITE`, `ENABLE_X_READ`, `FID_ACQUIRE_ENABLED`, `ZK_DEV_HOOKS`,
`DATA_SOURCE` (or explicitly `seed`), `ZK_MODE` (or explicitly `fixture`),
and must not carry `NEYNAR_API_KEY`, `NEYNAR_SIGNER_UUID`, `X_API_*`,
`X_LAYERS_INBOX_TOKEN`, `FC_TEST_*`, `FC_ANON_*`. `LAYERS_REQUIRE_SIG=true`
must be ON.

**Scoped exception (2026-09-25, FC-READ — SECURITY-POSTURE.md §19).** The
app service, and only the app service, may carry `NEYNAR_READ_API_KEY`: the
key of a SECOND Neynar app with no signers, no App Wallet and no webhooks,
read by exactly one server-only module (`lib/fc/readRelay.server.ts`) behind
`POST /api/fc/read`. It turns on READS for the browser device's discovery,
profile and thread surfaces and nothing else (channels are not relayed:
D-FCREAD-NO-CHANNELS-IN-V1, channels are not an emphasis in v1; discovery is
a general feed of the authors the operator chose, and there is no
per-channel live read): `NEYNAR_API_KEY`,
`ENABLE_FC_WRITE` and `DATA_SOURCE=neynar` stay refused, everything the
server renders stays seed (a page render is unmetered, so a live read there
would be the `/api/dev/live` problem above again), and a write that targets a
network cast answers 403 `NETWORK_READ_ONLY`. The relay arms only on a public
deployment and DISARMS with a named reason — it never refuses to boot — on a
malformed key, a discovery source that is not exactly one of `FC_READ_FIDS`
(an author list, 1 to 100 fids) and `FC_READ_HOUSE_FID` (one fid: a house
account whose follows are the list, D-FCREAD-HOUSE-ACCOUNT) — both set,
neither, or a malformed value — `FC_READ=off`, or `NEYNAR_READ_BASE_URL` set
on a hosted platform or pointing off loopback (that variable exists for the
local stub only). House mode is the one following feed the relay may read:
the house account's, with its fid pinned to that server constant and never
sent as a `viewer_fid`; no visitor's following feed and no notifications are
ever read, and `NEYNAR_VIEWER_FID` stays refused below. The relay's spend
is bounded by `FC_READ_DAILY_CREDITS` (default 100000 a UTC day per
instance, counted on cache misses; discovery is one 100-credit call per 10
minutes at most, 14,400 a day, from either source); its other knob is
`FC_READ_MIN_SCORE` (default 0.5).
Two refusals ride along: the validator refuses to boot with
`NEYNAR_READ_API_KEY`, and `NEYNAR_VIEWER_FID` joins the must-not-ship list on
both processes whatever its value, because on a process strangers reach it
hands them that fid's following feed, mutes and notifications. Without the key
the preview reads exactly what it read before.

---

## What would need building before this can be a public URL

In order of necessity. None of it is packaging; all of it is scope the
public-preview prompt says this pass must not grow.

1. **Tenancy, or an honest substitute.** The real fix is a tenant boundary
   in the app process: every `globalThis` singleton (`state()`, the keystore
   cache, dev controls, the influence/zones/ports/search caches, the
   embedding worker) keyed by a server-issued session, a keystore and vault
   per tenant, `SEED_VIEWER` instantiated per tenant, and the validator's
   device anchor per tenant — the validator already supports many roots and
   devices; the app does not. That is a pass of its own and it touches the
   crypto layer. The honest substitute for a *preview* is a **single-tester
   demo behind an access secret**: one link token or password, one tester
   at a time, the banner and `TESTING.md` saying in plain words that state
   is shared and the privacy layer's conditions are not met. Deploying
   without one or the other puts the owner's device on the internet.
2. **Gate every dev surface, not seven actions.** `/api/dev` (all actions
   and the GET) and `/api/dev/live` refuse entirely unless `ZK_DEV_HOOKS`;
   the `layers_view_as` and `layers_seed_persona` cookies are honoured only
   under the same flag or an owner secret; `forceFail`, `setLatency`,
   `maxLatency`, `forgeEvent`, `forceExhaust`, `resetInboxCursor`,
   `fastForwardReadwise`, `fcSimNetwork`, `forceFcPublishDrop` join
   `RIG_ONLY_ACTIONS` at minimum.
3. **The validator is not a public server today.** `POST /events` needs
   the device envelope (or removal — rep events should come only from the
   poller and the app's own settled accruals); `GET /state` needs an owner
   check or the validator stays on a private network reachable only by the
   app; the device-auth anchor must be provisioned before the first public
   request, never left to first-write-wins.
4. **Rate limiting on every route of both processes** (Gates 3 and 5 of
   the prompt assume it exists; it does not).
5. **A production environment file that omits every credential** and a
   boot check that refuses to start with any of §5's keys present in a
   public deployment.

Until 1 and 2 are done, Gates 1–6 have nothing safe to deploy. The landing
page (Gate 1) and the GitBook sync (Gate 2) can be built without deploying
the app, but the prompt's exit for Gate 1 ("entering the app from a fresh
browser produces a working, independent session") cannot be met by any
packaging step.

## Iterations used

Gate 0: 1 of 3. Rig restored to the harness configuration afterwards
(`ZK_DEV_HOOKS=true`, `LAYERS_REQUIRE_SIG=true`) on `ad7207a`.

---

## Addendum (2026-09-23) — D-PRODLIVE-OWNER-SERVICE: the honest substitute, built for one person

§1 named the only honest shared-identity form for a hosted Layers: "a single-tester demo behind an access secret".
The public preview did not need it (the browser keystore pass gave every visitor their own root), but the owner's
request — "full FID personas and real casts" — does: every live Farcaster write in this codebase is a Neynar managed
signer held by a SERVER, and the public preview's server holds nothing by design. So the substitute is now built, for
exactly one tester, the owner, as a separate deployment. The runbook is `notes/runbooks/GO-LIVE-FARCASTER.md`.

| | |
|---|---|
| decision | **D-PRODLIVE-OWNER-SERVICE** — a SEPARATE Railway project (`layers-owner`) with an app and a validator in RIG shape (`ZK_DEV_HOOKS=true`), reachable only by the owner. The public preview stays keyless and multi-tenant, unchanged. |
| what it overrides, and how narrowly | **D-CUSTODY-ONE-RULE** ("the server never holds a root, a seed, a vault key or a persona private key") and **D-CUSTODY-RIG-KEEPS-THE-DEV-KEYSTORE** (the server-held keystore is the rig's, not a URL's). On the owner service the server holds the owner's root seed on a volume (`KEYSTORE_DIR=/data/keystore`), exactly as the rig laptop holds it in `.keystore/`. The override is scoped to that one deployment by four boot-time and request-time controls, not by convention. |
| control 1 — the gate | `OWNER_ACCESS_SECRET` set ⇒ `middleware.ts` refuses every page (303 to `/owner-login`) and every `/api/*` route (401 JSON) without the owner's session cookie. Exempt: liveness, the login page and route, the icon. The cookie is `__Host-` prefixed, httpOnly, Secure, SameSite=Strict, 24 hours, and holds an expiry, a nonce and an HMAC under a key derived from the passphrase (`lib/platform/owner-access.ts`), never the passphrase. The passphrase is compared in constant time (`app/api/owner-login/route.ts`); attempts are metered per address (10, one a minute) and globally (30, one per ten seconds) whatever the rig flag says. |
| control 2 — it cannot boot open | A rig-shaped app on a hosted platform (any Railway variable, or `LAYERS_HOSTED=true`) exits 78 without a 16+ character `OWNER_ACCESS_SECRET`, with a `VALIDATOR_URL` that is not a private address, or with `NEXT_PUBLIC_VALIDATOR_URL` set (`instrumentation.ts`, `lib/platform/env-contract.ts` `hostedRigViolations`). The laptop rig sets no hosting variable, so the 83 suites are untouched. |
| control 3 — the validator is not a public server | The rig validator answers unsigned state reads, rep events and root registration (§3 above). A dev-hooks validator on a hosted platform exits 78 unless `LAYERS_PRIVATE_NETWORK_ONLY=true` AND the platform reports no public domain or TCP proxy for it (`validator/env-contract.js`, run as its own step before the supervisor in `railway/Dockerfile.owner-validator`). The app reaches it at `http://owner-validator.railway.internal:4001`. |
| control 4 — rig-shaped by construction | `railway/Dockerfile.owner-app` bakes `ZK_DEV_HOOKS=true` at build and run time, so that image can never be deployed as a keyless public preview by mistake, and the public preview's builder never produces a rig. |
| what did not change | The public preview, its contract and its suites. One fix rode along: both copies of the contract now refuse `DATA_SOURCE=neynar` — the value that actually turns live content on — where they previously checked only `DATA_SOURCE=live`. |

**Costs (C-PRODLIVE-\*).**

- **C-PRODLIVE-RAILWAY** — two more services and two small volumes, metered like the public pair ("a few cents an
  hour", notes/reports/REPORT-CUSTODY.md): single-digit dollars a month on the owner's existing plan.
- **C-PRODLIVE-NEYNAR-CREDITS** — 150 credits a cast and 20,000 a month per signer that writes; three personas at ten
  casts a day is about 195,000 credits a month, ~2% of Neynar's Free plan (10M). Live reads cost per page view.
- **C-PRODLIVE-FID-ETH** — ~$0.35–$0.90 of ETH per persona account from the Neynar app wallet (the owner's spend,
  through `scripts/fid-acquire.mjs`, dry run first). Caps: two accounts and $10 by default; raisable only by setting
  `LAYERS_MAX_LIVE_PERSONA_FIDS` / `LAYERS_FID_SPEND_CAP_USD` on the app AND in the command's shell, bounded at 20 and
  $25. The ledger's per-account estimate can no longer be set below the measured $0.90 (an estimate of 0 would have
  let the dollar cap never bind).
- **C-PRODLIVE-POLLER** — a Neynar key on the validator (only needed for the anon relay) starts the reputation
  poller: up to ~4.4M credits a month for the fixture world's one real-range fid. Switch it off with `VALIDATOR_POLLER=off` on the owner validator (validator/poller.js).

**Assumptions (A-PRODLIVE-\*)** are stated in SECURITY-POSTURE.md §18. The short list: the platform host is trusted
with the owner's seed (A-PRODLIVE-THE-HOST-HOLDS-THE-SEED); the passphrase is the whole account
(A-PRODLIVE-THE-PASSPHRASE-IS-THE-ACCOUNT); the validator's only protection is being unreachable
(A-PRODLIVE-PRIVATE-NETWORK-IS-THE-VALIDATOR-GATE); the volume is the only copy of the root until the owner writes
down the 24 words (A-PRODLIVE-THE-VOLUME-IS-THE-ONLY-COPY); one root per home (A-PRODLIVE-ONE-HOME-PER-ROOT).

**Not built, named:** strangers going live. That needs browser self-custody of the persona's Farcaster signer key
and a relay that forwards messages it cannot forge (notes/runbooks/GO-LIVE-FARCASTER.md §h). It is the next pass, not this one.
