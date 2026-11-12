# Following from the hub

Sign in with Farcaster and your Following tab is your own Farcaster graph: the accounts you follow and their posts, newest first, read by your browser straight from a Farcaster node. No Neynar, and nothing passes through Totem's servers.

::: warning Status: built, test data only, not deployed
<span class="st st--test">Built, test data only</span>. The node's behaviour was measured read-only on the real public node on 2026-11-05; the timeline itself has only run against a local stand-in of a Snapchain node. It is not deployed yet. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}
:::

The verdict: the reads go from your browser to the node and nowhere else, so Totem's app server and validator learn nothing new, and the price is that the node's operator (Farcaster, now Network School) sees your internet address next to your own account and everything you read. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## At a glance

<ol class="flow">
  <li class="flow__us"><strong>Who you follow</strong><code>GET /v1/linksByFid</code> for your own account, 1,000 a page, most recently followed first.</li>
  <li class="flow__us"><strong>Their posts</strong><code>GET /v1/castsByFid</code>, each account's newest 10, at most 8 requests at a time, for the 1,000 accounts you followed most recently.</li>
  <li class="flow__us"><strong>Merge</strong>Exact newest-first order down to a horizon; "Show older posts" reads the next page of the accounts holding it.</li>
  <li class="flow__us"><strong>Names</strong><code>GET /v1/userDataByFid</code>, only for the accounts on screen.</li>
  <li class="flow__us"><strong>Threads</strong><code>GET /v1/castById</code> and <code>/v1/castsByParent</code> by the post's fid and hash.</li>
  <li class="flow__us"><strong>Your reactions</strong><code>GET /v1/reactionsByFid</code> for your own account, your newest 200 likes and 200 recasts, once Totem may post as you.</li>
</ol>
<p class="flow__note">Every read is a plain GET: no custom header, no cookie, no referrer. The node answers browsers with <code>Access-Control-Allow-Origin: *</code>.</p>

## What it shows

- **Following** on Home: the posts of the people you follow, and your own, newest first. While it reads, it shows what is in and says "Reading posts from 412 of 966 accounts…". Your own post as yourself ([Post as you](/mechanism/post-as-you)) shows at the top at once.
- **Your mode** decides it (built and tested on test data, not deployed yet): the mode pill above Following switches between your modes, and the mode's rules, lens and per-account delivery settings ("Never miss", "Banner", "Quiet", from a post's menu) apply to these posts in your browser. A mode orders and filters the posts already read and never reads more, so the node sees the same reads under every mode. What a Farcaster post can't carry, such as like or recast counts, is listed as not available on Farcaster posts; if a mode hides everything the page says "Your mode hid all N posts". Under the Default mode the order is newest first. See [Your feed: modes and rules](/features/modes-and-rules). {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}
- **Find your people** on the home card: "You follow 120 accounts on Farcaster.", opening the list at `/fc/following`, 50 at a time. Which of them use Totem is not marked yet.
- **A post** opens as a thread at `/fc/cast`: the posts it replies to above it, its replies below. Once Totem may post as you, the thread has a Reply box that replies on Farcaster as you.
- **Reply, Like and Recast** on every card act as your own Farcaster account once Totem may post as you ([Post as you](/mechanism/post-as-you)): a like or recast is pressed only after the node accepted it, a second tap undoes it, Reply opens a box under the card, and your own posts can be deleted from the card's menu. Which posts you already liked or recast comes from the node (your newest 200 of each); a post older than those shows "Totem couldn't tell", never "not liked". Before you allow it, while you act as a persona, or on one of your personas' posts, the buttons stay off and say why. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}
- **An account** opens at `/fc/profile`: its name, picture, bio and newest posts. The node keeps no follower or like counts, so none are shown, never a made-up 0. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## Measured first, then designed

On the real public node, read-only, on 2026-11-05:

| Root | Requests | Data | Time at 8 in flight | First 20 posts | Per request |
|---|---|---|---|---|---|
| following 111 | 223 | 1.3 MB | 1.4 s | 0.33 s | p50 34 ms, p99 178 ms |
| following 965 | 1,933 | 11.5 MB | 9.5 s (2.6 s at 32) | 1.1 s | p50 32 ms, p99 108 ms |

No 429 in about 4,100 requests, including 1,933 in 2.6 seconds. Then the design itself, measured the same way: following 965, 1,096 requests, 50 posts on screen after 0.8 s, everything read after 5.0 s; following 110, 171 requests and 1.0 s; following 1,854 (the first 1,000 read), 1,101 requests and 5.3 s; every answer 200. The node also holds posts dated decades ahead (one is dated 2066), and lists accounts as following themselves. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

What that led to: at most 8 requests at a time from a tab; the 1,000 most recently followed accounts read for the timeline (the page says so past that); names only for what is on screen, so the 965-follow root costs about 1,100 requests instead of 1,933; the page filling as reads land, the accounts at the horizon read further while the rest loads, and nothing already on screen blinking out; a cache in the tab's memory (nothing on disk) with each account re-checked on its own clock, from a minute for an account that just posted to six hours for a quiet one; a 429 pausing every read for the node's Retry-After and saying so; posts dated more than 10 minutes ahead left out of the order. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## When a read fails

A failure is said, with Retry, and is never shown as an empty timeline: "Couldn't read who you follow from Farcaster's network just now. Nothing was read, so this is not an empty list." Accounts whose posts could not be read are counted on the page, and a profile that could not be read shows the account's number. "You don't follow anyone on Farcaster yet." and "No posts yet" appear only after reads that worked. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## Which source wins

Following, once you are signed in with Farcaster on the live site, always comes from the hub, whether or not the [read relay](/mechanism/read-relay) has its Neynar key: the relay has no following read, by design, because it would have to give your account number to Totem's server. For You stays the relay when it is on. A post or account opened from a hub card is read from the hub; one opened from a relay card, from the relay. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## What each party sees

| Party | Sees |
|---|---|
| The Farcaster node your browser reads | your internet address and browser, that the reads come from Totem's pages (the `Origin` header), the time, your own account (its follow list is the first read), and every account and post you read |
| Totem's app server | nothing new: the pages carry no identifier (the post or account rides the part of the address after `#`, which a browser does not send), so it sees that someone opened "a Farcaster post", not which |
| Totem's validator | nothing new: no read passes through it |
| Neynar | nothing: it is not used |
| Someone using this browser later | nothing: the graph lives in the tab's memory and goes with a reload |

{cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

The residual worth knowing: the node's operator can tie your internet address to your Farcaster account and to everyone you follow (A-HUBREAD-NODE-SEES-GRAPH), and the browser trusts what the node answers (A-HUBREAD-NODE-HONEST). {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

Your personas stay out of it. Because the node knows this browser is you, the browser never asks it about one of your own personas: not its profile, not its posts, not a quote of one, and not a persona you follow. While you act as a persona, it reads nothing from the node at all, so Following and the home card show the persona's world, not yours; choose **You** in the account menu (built on test data only, not deployed) to act as yourself and see your own. What that cannot remove: while few people use Totem, the timing of your browser going quiet and a persona posting through Totem is still a hint (A-HUBREAD-PERSONA-SEPARATION). {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## Where it lives, and how it is tested

- **Browser:** `lib/fc/hubRead/read.ts` (the reads, the cap, the cache, the merge), `lib/fc/hubRead/copy.ts` (the words and the answer shapes), `app/api/fc/hub/route.ts` (a device route; any server answers `404 device_only` before reading the body), `components/hub/*`, `app/(main)/fc/{following,cast,profile}`.
- **Tests:** `npm run test:hub-read-unit` (the device's reads against a local stand-in node: the order against the stand-in's ground truth, the cap and at most 8 in flight with 1,500 follows, every failure said, a 429's pause, the refresh, your own post, threads; and a mutation of each guard), and `scripts/accept-hub-read-prod.mjs` on the production shape (the home card, the timeline while it fills, a reply's thread, a profile, the list, your own post on top, the error and Retry, and that Totem's servers saw no followed account or post).
