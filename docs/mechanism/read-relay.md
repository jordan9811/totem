# The read relay

How a keyless public site can show real Farcaster posts: one server route holds a read-only key, reads a fixed set of things on a fixed daily budget, and reads nothing tied to the visitor.

::: info Status: off on purpose
<span class="st st--off">Off on purpose</span>. Built, tested against a loopback stub, and deployed with the public site, where it stays dormant until the owner sets the read key and one discovery source. As of 2026-10-07 it has not been armed: it reports `no_key`, and the feeds say they show preview content. The first arming runs under a 2,000-credit budget to measure the assumed prices. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}
:::

The verdict: the relay trades one privacy property for a usable public site, and says so. Neynar cannot scope a key and answers every origin, so a key that reached a browser would work from anywhere; the key therefore stays on the server and every live read passes the operator. The operator, and Railway's HTTP log, can see which real Farcaster accounts and casts each address opened. In exchange the relay is a closed table: five operations, parameters the server fixes, no visitor fid ever sent, and a credit budget that bounds spend however hard someone pushes. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## At a glance

<ol class="flow">
  <li><strong>Visitor</strong>Opens For You, a Farcaster profile or a thread.</li>
  <li><strong>Device</strong>Calls <code>POST /api/fc/read</code> with one of five operations.</li>
  <li class="flow__us"><strong>Relay</strong>Checks the header, the rate and the budget; answers from cache or makes one fixed GET.</li>
  <li><strong>Neynar</strong>Answers to a key from a second app that has no signers and no wallet.</li>
  <li><strong>Card</strong>Mapped fields only, marked "Farcaster · read-only".</li>
</ol>
<p class="flow__note">Notifications, history, search, channel tabs, the right rail and everything the server renders stay preview content even when the relay is armed. The relay has no Following read: for a visitor signed in with Farcaster, Following is their own graph, read by their browser from a Farcaster node (<a href="./following-from-the-hub">Following from the hub</a>).</p>

## The contract

| Operation | Upstream call | Credits per miss | Cache lifetime |
|---|---|---|---|
| `status` | none | 0 | |
| `discovery`, list mode | `/feed/` with `feed_type=filter`, `filter_type=fids`, the server's `FC_READ_FIDS` (1 to 100 authors), no recasts, limit 25, one page | 100 (documented) | 600 s |
| `discovery`, house mode | `/feed/following/` for the server's `FC_READ_HOUSE_FID` only, no recasts, limit 25, one page | 100 (documented) | 600 s |
| `thread` | `/cast/conversation`, reply depth 2, limit 10 | about 40 (assumed) | 900 s |
| `user` | `/user/by_username` | about 2 (assumed) | 1,800 s |
| `user-casts` | `/feed/user/casts`, limit 10, fid resolved on the server | about 40 (assumed) | 1,800 s |
| an unknown hash or name | the miss that found it | | 3,600 s, negative |

Built on test data and not deployed (2026-11-07): two more operations, `search-casts` (`/cast/search/` with the visitor's query and limit 10, about 40 credits, assumed) and `search-users` (`/user/search/`, limit 5, 10 credits, documented), each taking the query and nothing else. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"}

Exactly one discovery source may be configured; both, neither or a malformed value leaves the relay unarmed with `bad_config`. The client never supplies an fid, a `viewer_fid`, a cursor, a provider or a limit, and the path check pins parameter names and, for the feed path, their values before any token or credit is taken. There is no channel operation: channels are not part of version 1, because Neynar's published contract has no general ranked feed left. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## The budget

| Bound | Value |
|---|---|
| Daily credit budget | 100,000 by default, counted per UTC day, in memory, per instance, on cache misses only |
| Discovery's ceiling | 86,400 / 600 = 144 misses × 100 = 14,400 credits a day, whatever the author list |
| Lookups' share | at most 70% of the day (70,000), so lookups can never starve discovery {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |
| One address's share | at most 5% of the day (5,000 credits, about 125 thread misses), then 429 until UTC midnight |
| Per-address bucket | 20 lookup requests per 10 minutes, hits included, taken before the cache is consulted |
| Global miss bucket | 60 misses a minute, independent of address |
| Failure handling | a miss is charged once before its first attempt; a failed miss puts its key on a 45-second cooldown; five failures in a row open a 60-second breaker for every key |
| When spent | discovery serves its last answer, labelled cached, for up to 24 hours; lookups have no shelf |
| Content floor | only the chosen authors' own top-level casts; authors under a Neynar score of 0.5, or with none, are hidden; an operator denylist on top; casts dated more than 10 minutes in the future are dropped |

100,000 credits a day is about 3 million a month, 30% of Neynar's Free plan. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## Decisions, and what each costs

- **The key stays on the server.** One server-only module reads it; the browser gets a mode hint, never the key; the validator refuses to boot with it. Cost: the app server holds a second secret, and the operator pays for and sees every read. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}
- **Server renders stay preview content.** Page renders are not rate-limited, so one live read inside a render would be an unmetered spend path any GET could trigger.
- **Writes are refused per target.** A like, recast, reply, follow, folder add or stake aimed at a real cast answers 403 with one fixed sentence, and the card reverts. Flipping the whole device to live data would have refused the visitor's own posts.
- **Following stays local.** The device's own fid is derived from its anchor, so forwarding it would let the operator join reads to a root; a `viewer_fid` is refused, not stripped.
- **A house account, as one option.** The owner can curate discovery by following accounts from a dedicated Farcaster account instead of editing a list. Its follow list is then public, and whoever controls that account curates the preview.

Source: {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## Who learns what

| Party | Learns |
|---|---|
| The app server's operator | each relayed read's address, time, operation and argument (which thread, which profile); discovery carries no argument |
| Railway's HTTP log | the page path of every live profile and thread a visitor opens, `/<fname>` or `/<fname>/status/<hash>`, beside the address; the operator also runs the validator, so reads can be joined to a root's signed traffic by address and time |
| Neynar | the app's aggregate cache misses, never a visitor's address {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |
| Other visitors | from timing alone, that someone opened the same thread or profile recently (15 minutes for a thread, 30 for a profile, an hour for a not-found) |
| An author who embeds an image | the address of each viewer whose browser loads it |

Source: {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## Adversary model and what this does not protect

- **Which accounts you read.** The operator can read, from the platform's log alone, which real Farcaster accounts and casts each address looked at. This is disclosed on the landing page and in the banner. Moving live permalinks to a path with the identifier in the fragment would keep it out of that log; it was not done. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}
- **Budget exhaustion.** Random hashes are guaranteed misses. With many addresses, or one that can choose its forwarding header, the 70,000-credit lookup share empties in about half an hour at roughly 40 credits a thread miss. Discovery keeps the rest of the day. Another site cannot call the relay or frame a preview page, but it can send its visitors to preview pages top level. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}
- **Per-address limits.** They key on the leftmost `X-Forwarded-For` entry, and whether Railway's edge sets or appends that header is unmeasured. Until a header-echo measurement, per-address limits are best-effort; the global buckets and the daily budget bound spend.
- **A leaked key.** A Neynar key has no scopes. The read key belongs to an app with no signers, wallet, webhooks or bans, so a leak cannot post as anyone, but it can read, create signers of its own on the account's credits, and burn credits fast: at 1,000 requests a minute, 2,000-credit hub calls empty 10 million credits in about five minutes. The only kill switch for a leaked key is rotating it at Neynar. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}
- **Shared credits.** One Neynar account's credit pool is assumed shared by every app in it, so a read spike can starve the owner's posting.
- **Restarts.** The budget restarts empty on every redeploy, so the real daily ceiling is the budget × (redeploys that day + 1) × instances.

## One switch per surface

Built on test data and not deployed (2026-11-07). Arming the key no longer switches anything on by itself: the operator sets a source per surface (`FC_SOURCE_FOLLOWING`, `FC_SOURCE_NOTIFICATIONS`, `FC_SOURCE_FORYOU`, `FC_SOURCE_SEARCH`, `FC_SOURCE_COUNTS`, `FC_SOURCE_CHANNELS`), each `network` (the default), `neynar` or `auto`, and the relay answers an operation only while its surface asks for Neynar (`503 fc_source_off` otherwise, before any token or credit). Following and notifications never go through Neynar, whatever the switch says: through the relay they would hand the visitor's account to Totem's server, so `neynar` is refused at boot and read as network. Like and recast totals stay unavailable on posts read from Farcaster's network, because a count read would name the posts on the visitor's screen. Settings › Developer shows each surface's source and why. {cite: SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"}

## The obvious questions

### Why not let the browser call Neynar directly?

Because the key would then work from anywhere, for anyone, and a Neynar key has no read-only scope and no origin restriction.

### What does a visitor see when it is armed?

Discovery: the recent top-level posts of the authors the owner chose, read-only. Profiles and threads for Farcaster names and hashes the device does not already hold. Every real post carries a "Farcaster · read-only" mark.

### Can the relay see who I am?

It sees your address and what you read, like any server you visit. It never receives your fid, your persona ids or anything from your vault. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## Where it lives in the code

- `lib/fc/readRelay.server.ts`: the only module that reads the key; the operation table, path check, budget, cache and breaker.
- `app/api/fc/read/route.ts`: the route, its header and cross-site checks.
- `scripts/accept-fcread.mjs`, `scripts/unit-fcread-relay.mjs`: the stub-backed checks.
- Runbook: `notes/runbooks/GO-LIVE-FARCASTER.md`, section (i).
