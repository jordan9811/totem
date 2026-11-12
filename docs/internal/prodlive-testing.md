# Testing the public shape (prod-live)
<!-- uncited-ok: page — an operator runbook for the public-shape test scripts; it states how to run them, not what the system guarantees -->

The public preview runs with `NODE_ENV=production` and the dev hooks off. In that shape the server holds no identity. The visitor's identity is the device inside their browser tab, which answers the app's `/api/*` calls in the page (decision D-CU-0-4: a production server renders public state only).

The 83 rig suites cannot see this shape: they run with the dev hooks on, where the server keeps the seeded keystore. The deployed smoke passed 8/8 while most pages of the preview printed "Couldn't load … refusing to mint a device key" inside an HTTP 200, because it only drove the device's API and never looked at a rendered page. Three scripts now look at the pages:

- `scripts/accept-prodlive.mjs` is the full suite. It checks the landing door, settings reachable by clicking (rail, More menu, mobile drawer), a walk of every page under `app/(main)` plus one of each detail page, no fixture identity in the chrome, the account switcher roster, a write that shows up without a reload, persona-scoped panes, a visible device boot failure, soft navigation and persistence. Its check 12 caps what the walk spends through the live-read relay (below).
- `scripts/smoke-deployed.mjs` is the short post-deploy check. Its check 2b fails when `/home` has no timeline cards or shows an inline load error, or when `/settings` does not render after a click on `nav-settings`. Its check 2a asserts the live-read relay is in the state you expect (`EXPECT_FC_READ`, below).
- `scripts/accept-fcread.mjs` covers public live Farcaster reads. It runs only locally, against the production-shaped pair started in stub mode (below).

## Run it locally

1. Start the production-shaped pair on the pinned ports (3001 app, 4001 validator). Add `--build` after code changes:

   ```sh
   bash scripts/run-prod-shape.sh --build
   ```

   The launcher blanks every must-not-ship variable (it reads the list from `validator/env-contract.js`, including the validator-only `VALIDATOR_REFUSES` list) and sets `LAYERS_REQUIRE_SIG=true`. It passes the validator and app URLs explicitly. After startup it makes two checks. First, `/api/dev` must answer 403; if the pair came up as the rig, the launcher refuses to go on. Second, the live-read relay must report itself unarmed (see "Live Farcaster reads" below).

2. Run the suites against it, either directly or through the launcher:

   ```sh
   node scripts/accept-prodlive.mjs
   node scripts/smoke-deployed.mjs   # needs BASE_URL and VALIDATOR_URL, see below
   bash scripts/run-prod-shape.sh --no-restart scripts/accept-prodlive.mjs test:cu6
   ```

   `accept-prodlive` defaults to `http://localhost:3001` and `http://127.0.0.1:4001`. It aborts with exit 2 if `/api/dev` does not answer 403, which means it will not run against the rig. It prints `N/M prod-live checks passed` and exits 1 on any failure.

## Run it against Railway

```sh
BASE_URL=https://<app>.up.railway.app VALIDATOR_URL=https://<validator>.up.railway.app node scripts/accept-prodlive.mjs
BASE_URL=https://<app>.up.railway.app VALIDATOR_URL=https://<validator>.up.railway.app EXPECT_FC_READ=no_key node scripts/smoke-deployed.mjs
```

Railway is the real deployment. Run each of these once per deploy, not in a loop (see the budgets below).

Set `EXPECT_FC_READ` to the state the deployment should be in:

| The app service holds | `EXPECT_FC_READ` | What check 2a also asserts |
|---|---|---|
| no `NEYNAR_READ_API_KEY` (the default) | `no_key` (the default) | `/home` shows no live card |
| the read key and exactly one discovery source, `FC_READ_FIDS` or `FC_READ_HOUSE_FID` | `armed` | a live card renders (`data-live`, a 0x + 40-hex hash), and liking it is refused `403 NETWORK_READ_ONLY` with the preview's sentence |
| the read key but no source, both sources, or a malformed one | `bad_config` | `/home` shows no live card |
| the key plus `FC_READ=off` | `off` | `/home` shows no live card |

A smoke that passed while the relay was silently unarmed would prove nothing about live reads, so there is no "anything goes" value. The status answer must also carry no number and no field outside the documented ones: `armed`, `reason` and `state`. A `channels` field fails check 2a, because it means the deployment runs a build from before the no-channels change (below).

## Live Farcaster reads (FC-READ)

On a public deployment whose app service holds `NEYNAR_READ_API_KEY`, the browser device reads real Farcaster casts through one server route, `POST /api/fc/read` (`lib/fc/readRelay.server.ts` is its only reader of the key). The tests never touch the real network. They use a loopback stand-in for Neynar, `scripts/lib/neynar-stub.mjs`.

### Discovery is not channel-based (v1)

The owner decided that channels are not an emphasis in v1. So:

- **Discovery reads a list of authors, not channels.** The relay makes one call per cache miss: `GET /v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25`. `FC_READ_FIDS` is a server-only list of 1 to 100 author fids. It has no default, and it is one of two sources, of which exactly one must be set (see "Two discovery sources" below). A malformed list gives `bad_config` naming `FC_READ_FIDS`. Leaving it unset gives `bad_config` only when `FC_READ_HOUSE_FID` is unset too, and the log line then names both variables. Either way every surface stays seed. The relay follows no cursor and sends no `viewer_fid`. It drops replies itself, because it is not known whether Neynar's fids filter includes them.
- **There is no `channel` op.** The relay answers it `400 bad_op` and makes no upstream call. Channel tabs on the device stay seed, with no relay request at all.
- **The status answer no longer lists channels.** It also does not list the author fids.
- **Why this endpoint.** Neynar removed `/feed/trending` and `filter_type=global_trending` from its published API contract on 2026-08-07, and `/feed/for_you` three days earlier. The fids filter is the only feed still in the contract that is not per-viewer, not channel-based, and whose quality the operator controls. Neynar's credits page prices it at 4 credits × the page limit, so 100 credits per miss at a limit of 25, the same as the channel feed it replaces.

### Two discovery sources: the owner picks one

Discovery can take its authors from either of two server variables. Exactly one must be set. With both set, neither set, or a malformed value, the relay reports `bad_config` and every surface stays seed. Its log line names the variable, never the value. The status answer never says which source is armed, and never shows the fid.

- **`FC_READ_FIDS`, a list of authors.** This is the fids feed above. Changing the list means a redeploy, and the list holds at most 100 authors.
- **`FC_READ_HOUSE_FID`, one "house" Farcaster account.** The accounts it follows are the list. The owner curates by following and unfollowing in any Farcaster client, with no redeploy and no 100-author cap. The relay makes one call per cache miss: `GET /v2/farcaster/feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25`. This is Neynar's "Following" feed, spelled with the trailing slash as Neynar documents it.
  - The fid is pinned to the server's configured value in the relay's path check, the same way `limit` is. The check gets that value from the armed configuration, not from the path it is checking. It is never a `viewer_fid`, and never a value from the client.
  - Every other following-feed shape stays refused: another fid, a `viewer_fid`, a `cursor`, and `/feed/?feed_type=following`.
  - The relay follows no cursor and drops replies. The same score floor and denylist apply.
  - It costs the same as the fids feed: 4 credits × 25 = 100 per miss.

Decision **D-FCREAD-HOUSE-ACCOUNT** covers what house mode concedes. The house account's follow list is public on Farcaster by nature. Whoever controls that account curates the public feed. Losing control of it means losing curation, not keys: the relay holds none of that account's keys and never writes.

### What the launcher does with the read key

- **By default, the app gets `NEYNAR_READ_API_KEY` blanked.** `next start` loads `.env.local`, and the key belongs there once you have it: `scripts/audit-secrets.mjs` can only find a leak of a value it read from that file. Without the blank, every production-shaped run would arm the relay against the real network and spend real credits. The launcher asserts that the relay reports itself unarmed, and stops if it does not.
- **The validator never gets the read key.** The validator refuses to boot with it (`VALIDATOR_REFUSES`), and the launcher blanks it there too.
- **`PRODLIVE_FC_READ=stub` switches to stub mode.** The launcher starts the stub on `PRODLIVE_STUB_PORT` (default 4319, never 3001, 4001, 3009, 3100 or 3101). It gives the app five things, and the app only:
  - `FC_READ_RIG=stub`;
  - a fresh fake key (`fcread-stub-…`);
  - `NEYNAR_READ_BASE_URL` pointing at the stub;
  - `FC_READ_DENY` set to the stub's planted denylisted hash;
  - one discovery source, chosen by `PRODLIVE_FC_READ_SOURCE`:
    - `fids`, the default: `FC_READ_FIDS` set to the stub's author list (`node scripts/lib/neynar-stub.mjs fids`), and `FC_READ_HOUSE_FID` blanked;
    - `house`: `FC_READ_HOUSE_FID` set to the stub's house account (`node scripts/lib/neynar-stub.mjs house-fid`), and `FC_READ_FIDS` blanked.

    The relay has no default for either. Without a source, or with both, the pair does not arm, and the launcher stops with `NOT STUB-SHAPED`.

  It then asserts that the relay reports itself armed. The suites run with `NEYNAR_STUB_URL`, with `EXPECT_FC_READ=armed` unless you set it yourself, and with `PRODLIVE_FC_READ_SOURCE`, so `accept-fcread` can check that the pair read discovery from that source. With `--no-restart`, pass the same source the pair was started with. At the end the launcher reads the stub's own record and exits 1 on any violation, even if every suite passed.
- **Default mode blanks both sources by name**, along with the key. It refuses `PRODLIVE_FC_READ_SOURCE=house`, because without the stub that setting would change nothing.
- **Any other value of `PRODLIVE_FC_READ` refuses.** A run against the real network is yours to make, on Railway, under a small `FC_READ_DAILY_CREDITS`.
- **Every restart stops a stub left from an earlier run.** `--no-restart` leaves it as it is. Its log is `$TEMP/layers-neynar-stub.log`.

```sh
PRODLIVE_FC_READ=stub PRODLIVE_FC_SOURCES=foryou=neynar bash scripts/run-prod-shape.sh --build scripts/accept-fcread.mjs scripts/smoke-deployed.mjs
# the same pair on the house source:
PRODLIVE_FC_READ=stub PRODLIVE_FC_READ_SOURCE=house PRODLIVE_FC_SOURCES=foryou=neynar bash scripts/run-prod-shape.sh scripts/accept-fcread.mjs scripts/smoke-deployed.mjs
```

Since the per-surface switch (SECURITY-POSTURE.md §42), an armed key alone puts nothing on For You: `PRODLIVE_FC_SOURCES=foryou=neynar` gives the pair `FC_SOURCE_FORYOU=neynar`, and `accept-fcread` check 0 refuses a pair started without it. `scripts/accept-fc-source-prod.mjs` measures the switch itself, run twice: `PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_FC_READ=stub PRODLIVE_FC_SOURCES=following=neynar,notifications=neynar,foryou=neynar,search=neynar,counts=neynar,channels=neynar`, and the same without `PRODLIVE_FC_SOURCES`.

The stub serves the same planted posts from both sources, so every pair check measures either one. `accept-fcread` also tests the house source on its side apps (checks 24 to 24d), and the relay's own path check and arming in-process (check 25), in every run, whichever source the pair uses.

### What the stub is

The stub serves the four recordings in `fixtures/neynar/` plus synthesized answers for the relay's five endpoints: the fids discovery feed (`/feed/` with `filter_type=fids`), the house account's following feed (`/feed/following/`), `/cast/conversation`, `/user/by_username` and `/feed/user/casts`. Both discovery answers have the shape of the recorded `feed-following.json`: `{casts, next: {cursor}}`. Both set `next.cursor` while more remain, which the relay must ignore.

- The fids answer holds only casts by the fids asked for, as Neynar's does.
- The house answer is served for one designated account only: the stub's house fid, printed by `node scripts/lib/neynar-stub.mjs house-fid`. That account "follows" every author the stub planted a post for, so its feed holds the same posts, the planted ones included.
- Both answers include one planted top-level post dated 2061 (marker `FCREAD-FUTURE`), by an ordinary high-score author already on the list. The real network carries posts like that. The feed is ordered newest first, so the relay must drop any post dated more than 10 minutes ahead of its clock, or that post would sit at the top of the public feed. Every other post is re-dated to the last few minutes on each answer; this one keeps its date.

It enforces the documented parameters and maxima with Neynar's own 400 shape (`{message, code, property, status}`):

- `/feed/`: `feed_type` is `following` or `filter`; `filter_type` is `fids`, `parent_url`, `channel_id`, `embed_url` or `embed_types`; `fids` is required with `filter_type=fids` and holds at most 100 integers; `limit` is 1 to 100 (from Neynar's current published contract, v3.184.0);
- user casts: at most 150;
- conversation: at most 50.

It records the exact query string of every request and counts hits. `POST /__stub/force` makes it answer the next requests with a 429 or a 5xx.

It records a **violation**, and the run fails, for any of these:

- `/notifications`;
- a following feed other than the pinned house request. That request is exactly `/v2/farcaster/feed/following/` with `fid=<the stub's house fid>`, `with_recasts=false` and `limit=25`, and nothing else. Another fid, a `viewer_fid`, a `cursor`, another limit, a missing or extra parameter, the path without its trailing slash, or `/feed/?feed_type=following` are all violations;
- a `viewer_fid`, `cursor` or `provider` parameter;
- a fid anywhere but `/feed/user/casts` and the pinned house request;
- **any channel feed**: `/feed/channels`, `/feed/parent_urls`, anything under `/channel`, or `/feed/` filtered by `channel_id` or `parent_url`;
- a discovery request that is not exactly the decided one (`feed_type=filter`, `filter_type=fids`, `fids`, `with_recasts=false`, `limit=25`, nothing else), or one filtered by `embed_url` or `embed_types`;
- an endpoint Neynar has removed: `/feed/trending`, `/feed/for_you`, or `filter_type=global_trending` (answered 404 or 400, as the network would);
- a path outside the relay's table;
- a non-GET request;
- a wrong or missing `x-api-key`;
- a forwarded visitor header (cookie, `X-Forwarded-For`, `Referer`, `Origin`).

It also plants test data for the suites:

- an author below the score floor, and one with no score;
- a cast on the denylist;
- an image on a host outside the media allowlist (`media.fcread-stub.invalid`);
- a cast whose text is page-health needle words ("404", "refusing to", "Couldn't load");
- a reply inside the discovery feed, by an author the floor admits, which the relay must drop.

The planted casts are reached the way Neynar reaches casts: by their authors' fids. So the relay's `FC_READ_FIDS` must name those authors. `node scripts/lib/neynar-stub.mjs fids` prints the list, and the side apps in `accept-fcread` use it too. If the pair's list leaves a planted author out, checks 15, 15b, 17 and 18 fail their precondition and name the missing authors. On the house source, the stub's house account reaches every planted post. The precondition then fails only if the pair's following-feed request was not the pinned one, and it says what was wrong with it.

`GET /__stub/state` returns the counts, the request log, the violations, the planted hashes and fids, and the fake key. The stub refuses to start with any key that lacks the `fcread-stub-` prefix, so a real key can never be served back.

### What accept-fcread checks

`accept-fcread` measures two kinds of app. It tests the pair in a real browser. It also starts **side apps**: `next start` of the same build on `FCREAD_SIDE_PORT` (default 3029), each with one variable changed, pointed at an in-process stub so their upstream counts are exact. Most armed side apps hold the stub's author list as `FC_READ_FIDS`. The house side apps (checks 24 to 24d) hold the stub's house fid as `FC_READ_HOUSE_FID` instead. Every side app gets both variables blanked first, so a real list or house account in `.env.local` never reaches one. Every check asserts its precondition first, so none can pass over nothing.

| # | What it proves |
|---|---|
| 0 | The pair's relay is armed on this stub, and a miss reaches the stub carrying the fake key |
| 2 | `/home` shows `data-live` cards served by the stub, the device env says `FC_READ_RELAY=on`, and feed2 marks them `network:true` |
| 16 | The `live-source` chip says `live` in copy free of needle words; feed2 and the classic feed report relay/live; Following reports seed |
| 3 | No page request goes to api.neynar.com or the stub (every non-loopback request is intercepted and recorded; nothing leaves the machine) |
| 15, 15b | The score floor hides a low-score and a no-score author; the denylist hides a hash, in the feed and as a thread |
| 15c | A post dated 2061 that the stub served is dropped: it is not in the discovery answer, not on `/home`, and its thread answers `not_found` after one upstream read |
| 17 | A live card made of needle words is visible, and `inlineErrors` still reads the page as clean |
| 18 | Live `<img>`s are `no-referrer` and lazy, their requests carried no Referer, and an unlisted host is click-to-load and never fetched before the click |
| 2b | A live thread and a live profile open in the browser |
| 6 | A second browser profile gets the same live cards, with the stub's hit count unchanged |
| 7, 7b | Liking, recasting, replying, act-as, adding to a folder and staking on a live card are refused `403 NETWORK_READ_ONLY`; liking a seed card still works |
| 8 | A post round-trips on Following with the relay on, and Following carries no network cast |
| 23 | A channel-shaped classic home tab (`art`, a former default channel, and the fixture's own channel tab) answers seed from the device, with no relay request and no stub hit; For You on the same device still reads the relay |
| 5a | fid, viewer_fid, cursor, limit, provider, a query string, a malformed argument or the retired `channel` op (any id) is refused `400 bad_op`, with stub hits frozen |
| 1 | With no key: status `no_key`, no hint, seed cards, no live card, no relay request, no stub call |
| 9 (16b) | With `FC_READ_DAILY_CREDITS=1`: status armed first, then `503 fc_read_budget` with no stub call; the chip says `budget`, and the device does not retry |
| 10 | With `FC_READ=off`: status `off`, `503 fc_read_off`, no hint, no stub call |
| 5b | Discovery and the three lookups work; payloads are mapped, with no raw Neynar field; user-casts carries only the fid that by_username resolved; the `channel` op is refused `400 bad_op` with no upstream call, before and after discovery is cached |
| 5d | Discovery's one miss is one upstream request to `/v2/farcaster/feed/` with exactly `feed_type=filter`, `filter_type=fids`, the app's `FC_READ_FIDS`, `with_recasts=false` and `limit=25`, and never a channel feed; the reply and the 2061-dated post the stub planted in that feed are dropped, and no relayed cast carries a channel. The 2061-dated post is also missing from its author's profile (user-casts), after the stub's answer is shown to have carried it |
| 13 | A random 40-hex thread reaches the stub once, then is answered 404 from cache |
| 12 | Server renders of `/<fname>`, `/home`, `/explore`, profiles and threads cause no stub hit (after a positive control) |
| 11 | Cross-site requests are refused and the stub is never called: no header, `Sec-Fetch-Site: cross-site`, a GET, a text/plain body, and a real browser on another site |
| 14 | With `TRUST_PROXY=true`, a spoofed address is first shown to pick its own bucket; then a 100-address burst is still held to at most 60 upstream calls |
| 24 | The house source, on a side app holding `FC_READ_HOUSE_FID` and no `FC_READ_FIDS`. It arms, and its one discovery miss is one upstream `GET /v2/farcaster/feed/following/` with exactly the house `fid`, `with_recasts=false` and `limit=25`, and nothing else. The in-feed reply, the low-score and no-score authors, the denylisted post and the 2061-dated post never reach the answer. `/home` renders live cards from it, and the page's own read is a cache hit. The status names neither the source nor the fid |
| 24b | A house miss costs 100 credits (4 × 25): on a 100-credit day the status is `live`, the one miss is served, and the status then says `budget` |
| 24c | Exactly one source: with both variables set, and with neither, the status is `bad_config`, discovery answers `503 fc_read_unarmed`, the page carries no hint and the stub is never called. The log line names the variables, never a value. The precondition is that each source arms on its own (5b, 24) |
| 24d | A malformed `FC_READ_HOUSE_FID` (zero; a leading zero; a list of fids; a username) gives `bad_config` naming `FC_READ_HOUSE_FID`, never its value, with no stub call |
| 25 | The relay's own checks, called in-process by `scripts/unit-fcread-relay.mjs` (also `npm run test:fcread-unit`; no server needed). The end-to-end checks only see the one request the relay builds, so they cannot see a refusal. This one calls the path check and the arming directly. In house mode it refuses every other following shape: another fid, a leading-zero spelling, `viewer_fid`, `cursor`, a wrong or missing parameter, no trailing slash, a suffix, and `/feed/?feed_type=following`. In list mode it admits no following path at all. The house path is admitted for discovery only. Fourteen malformed house fids, both sources set, and neither set each give `bad_config` with zero upstream fetches. Each source makes exactly its one request |
| 5 | Across everything both stubs saw: no violation, every endpoint exercised (the pinned house request included), a `fid` only where resolved or pinned, never a device's pseudo-fid, never a channel feed, no following feed but the pinned house request, and every discovery request exactly the decided one. It also checks that the pair read discovery only from the source it was started with (`PRODLIVE_FC_READ_SOURCE`) |
| 4 | The fake key is absent from the HTML, the RSC payload, device.js, the device env, the relay bodies, the app log and `.next/static`; device.js names neither `NEYNAR_READ_API_KEY` nor `readRelay` |
| 19 | The status op carries only documented fields (`armed`, `reason`, `state`; no `channels`): no number, never the key |

`accept-fcread` aborts (exit 2) if:

- the pair is not on loopback;
- `/api/dev` does not answer 403;
- no stub answers;
- the side port is already held.

It never runs against Railway; the deployed smoke's check 2a does that job. A run mints about seven roots on the local validator (its cap is raised to 1000 there). The house checks add six side-app starts to a run, about a minute or two.

### The relay's budgets during tests

The pair runs without `TRUST_PROXY`, so every local request shares one per-address bucket of 20 relay misses per 10 minutes. Cache hits are free.

- `accept-fcread` spends about 8 misses on the pair. It sends everything miss-heavy to its side apps.
- `accept-prodlive`'s route walk opens seed casts and seed authors first. It keeps at most 5 live casts as candidates, and its check 12 fails past 5 relayed thread reads or 5 relayed profile reads.

Run the stub-mode suites more than twice within 10 minutes and the pair may answer `429 fc_read_rate`. Restart the pair to clear the budget and the cache.

### The secrets audit and the read key

`scripts/audit-secrets.mjs` (accept-cu4 check 4) now also scans `public/device/device.js`, and learns `NEYNAR_READ_API_KEY` from `.env.local` or from its own environment (the stub-mode launcher hands it the fake key). With no value anywhere it prints **COULD NOT RUN** and exits 2 only when the app log shows the relay ARMED here, because only then could a local artifact hold a key it cannot look for. When no local process ever held one (the default launcher blanks the name for the app), it prints **NOT AUDITED** for that key and still audits everything else. A missing `device.js` is always COULD NOT RUN.

## The root budget

Each full page load by a visitor who has not saved their identity mints a new root on the validator. The validator allows 100 new roots per address per day (`VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY` in `validator/caps.js`). Against Railway that address is the owner's own. A suite that burns through the cap locks the owner out of creating an identity for a day.

- `accept-prodlive` boots one identity through the landing door and calls `window.__layersDevice.persist()`, so every later full load restores that same identity. Each load checks that the same root came back (`info.restored`). If a load does not restore it, the suite stops making full loads. It fails if the run minted more than 3 roots, and it also fails if its counter (201 answers on `/device/auth-anchor`) saw no roots at all, because that means the counter is not working. A normal run mints 1 root. The boot-failure check uses a second browser context whose device never boots, so it mints none.
- `smoke-deployed` mints 2 roots (profiles A and B, the two-tenants check). Its content check reaches `/settings` by clicking, not with a full load, so it adds no root. Its relay check (2a) runs in profile A's page and adds none.
- A full run against Railway therefore costs about 3 of the owner's 100 daily roots.
- `run-prod-shape.sh` raises the cap to 1000 on the local validator only (`PRODLIVE_ROOTS_PER_DAY`), because every local run mints from the loopback address. Do not raise it on a deployment: it is the abuse cap.

The suite also paces itself against the validator's per-address rate limit (300 burst, 5 per second). It models the bucket from the calls the browser made and waits before a load that would empty it. A walk of about 70 pages takes several minutes, and much of that is pacing.

## The validator's rate limit, locally

Every browser context of every local suite reaches the validator from one loopback address, so one bucket stands in for what a deployment gives each visitor. A device boot is about 49 validator calls. `accept-fcread` boots a few dozen devices and used to drain the bucket: device boots then failed with "the validator refused this root", and the smoke after it met 429s.

- `run-prod-shape.sh` raises the local validator's bucket to 3000 burst and 50 per second (`VALIDATOR_RL_CAPACITY`, `VALIDATOR_RL_REFILL_PER_SECOND`; change them with `PRODLIVE_RL_CAPACITY` and `PRODLIVE_RL_REFILL`, or set 300 and 5 to run on the defaults).
- The validator ignores both names on a hosting platform (`isHostedPlatform()`: any `RAILWAY_*` variable, or `LAYERS_HOSTED=true`) and logs that it did. A deployment always runs 300 and 5 per second.
- `accept-cu4` checks 6 and 9 measure the shipped defaults on a throwaway validator (port 4009) that carries neither name, not on the pair.
- When a device boot fails in `accept-fcread`, the failure line says how many validator 429s that browser context met.

## When a check fails

- A `3. route …` line names one page. The aggregate `3. ROUTE WALK` line lists every failing page. If rate limiting was seen during that page, the line says so, which points at the bucket and not the product.
- `(not discovered)` means a list page rendered no link to one of its detail pages (a channel, folder, room, algo card, profile or cast thread), so the detail page could not be tested. Fix the list page first.
- `4.` names the needle it found and where: the fixture handle, persona, root or fid, or the fixture self's name, bio, avatar or follow counts.
- `11.` failing with "the counter is blind" means the run cannot know how many roots it spent. Treat the whole run as unmeasured.
- In accept-fcread, a line starting `precondition:` means the check could not measure what it names. Examples: no live card rendered, or the relay was not armed. Fix that first; the check has not passed.
- `NOT STUB-SHAPED` or `NOT PRODUCTION-SHAPED … relay` from the launcher means the relay's arming did not match the mode. In default mode the likely cause is a read key reaching the app some other way. In stub mode the stub or the base URL is wrong, or the app holds no discovery source or both (the status then says `bad_config`; the launcher line names the source it meant to arm).
- In accept-fcread, a precondition that ends "the pair's FC_READ_FIDS omits the planted … author(s)" means the pair's author list leaves out authors the stub planted casts for. Start the pair with the stub's list. One that ends "not the stub's pinned house request" means a house-source pair asked for the wrong following feed. The line says what was wrong with the request.
- A `5.` line saying the pair "was started with PRODLIVE_FC_READ_SOURCE=…, but its discovery reads were …" means the running pair uses the other source. This usually happens after `--no-restart` with a different `PRODLIVE_FC_READ_SOURCE`. Restart the pair with the source you mean.
- `24.` failing its precondition "did not arm on FC_READ_HOUSE_FID alone" means the build has no house source. Checks 24b to 24d then fail their preconditions for the same reason.
- `--- neynar stub: … violation(s)` after the suites lists what the relay sent upstream that it must never send. Each line names the rule and the path.
