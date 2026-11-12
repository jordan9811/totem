# Notifications from Farcaster

Sign in with Farcaster and, while you act as yourself, Notifications is your own Farcaster account's: who followed you, the posts that mention you, and the replies, likes and recasts on your newest posts, grouped like X, with an unread count on the bell. Your browser reads them straight from a Farcaster node. No Neynar, and nothing passes through Totem's servers.

::: warning Status: built, test data only, not deployed
<span class="st st--test">Built, test data only</span>. The node's behaviour was measured read-only on the real public node on 2026-11-06; the notifications themselves have only run against a local stand-in of a Snapchain node that answers the way the real one does. It is not deployed yet. {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}
:::

The verdict: the reads go from your browser to the node and nowhere else, like [Following from the hub](/mechanism/following-from-the-hub); the node's operator learns that your browser checks who reacts to you, and roughly when a tab is open, and Totem's validator learns only that a sealed record of yours was rewritten. {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

## At a glance

<ol class="flow">
  <li class="flow__us"><strong>Who followed you</strong><code>GET /v1/linksByTargetFid</code> for your own account, your newest 50 followers.</li>
  <li class="flow__us"><strong>Who mentioned you</strong><code>GET /v1/castsByMention</code>, the newest 50 posts that mention you.</li>
  <li class="flow__us"><strong>Your newest posts</strong><code>GET /v1/castsByFid</code>, your newest 25.</li>
  <li class="flow__us"><strong>On each of them</strong><code>GET /v1/castsByParent</code> for the replies and <code>/v1/reactionsByCast</code> for the likes and the recasts.</li>
  <li class="flow__us"><strong>Names</strong><code>GET /v1/userDataByFid</code>, only for the first few accounts of each group on screen.</li>
</ol>
<p class="flow__note">Every read is a plain GET naming your own account: no custom header, no cookie, no referrer, at most 8 at a time, through the same guard as Following.</p>

## What it shows

- **Grouped like X**: "Alice, Bob and 12 others liked your post", "Carol and Dave recast your post", "Eve and 2 others followed you" (follows group by day), newest first. Likes and recasts that arrived after you last looked are their own group, so what is new stands apart. {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}
- **Replies and mentions** one by one, each a full Farcaster card: it opens as its thread, and once Totem may post as you ([Post as you](/mechanism/post-as-you)) Reply, Like and Recast work on it as your own account, exactly as on Following.
- **Accounts and posts open on the hub pages**: an avatar opens the account at `/fc/profile`, a liked post opens at `/fc/cast`. The account or post rides the part of the address after `#`, which a browser does not send to Totem's server.
- **The tabs**: All; Priority (without likes and recasts); Mentions (mentions and replies).
- **The window, said on the page**: your newest 50 followers and 50 mentions, and the replies, likes and recasts on your newest 25 posts. A post with more likes than one page holds says "and at least 98 others". Quote posts of yours are not shown yet, and your mode's notification setting does not filter these yet.

## Unread, and where "seen" lives

The bell in the left rail and the phone tab bar counts what is newer than the last time you looked. Opening Notifications (any of its tabs, as on X) marks everything up to the newest one as seen and the count clears at once. That time is one record in your vault, sealed in your browser and padded to the same 256 bytes whatever it holds; every device keeps one, so its existence says nothing. Seen on one of your devices is seen on all of them. It is never a plaintext row on Totem's server and never in your browser's local storage. {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

The page asks again every minute while the tab is visible and the bell every 2 minutes, both again when you come back to the tab, and neither while the tab is hidden. Each of your posts is re-checked on its own clock (a tenth of its age, from 1 to 30 minutes), so an open tab costs a few reads a minute once it has read everything.

## Measured first, then designed

On the real public node, read-only, on 2026-11-06:

- Every "who did something to this account or post" read answers **per shard**: ask for 5 and up to 10 come back, two shards' newest 5 each, side by side, so a page is not in order. One page, merged, is the exact newest of everything; Totem reads one page and claims nothing past it.
- Their next-page tokens are not reliable: the replies read always returns one, even with no replies, and following it starts the list over; the reactions read repeats items across pages. So no token is ever followed.
- Without a page size, the followers read answered 10,000 per shard (9.9 MB in 12 seconds for one account), so a page size always rides.
- The whole read, for five real accounts: 78 node reads before names for any account with 25 posts; with names, 224 to 284 reads, 0.65 to 3.0 MB and 1.0 to 1.6 seconds; an account with one follower and no posts, 4 reads in 61 ms. Every answer 200, none 429.

{cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

## When a read fails

A failure is said, with Retry, and is never shown as an empty list: "Couldn't read your notifications from Farcaster's network just now. Nothing was read, so this is not an empty list." A read that failed beside ones that worked is counted ("Couldn't read your mentions just now, so some notifications may be missing"), and what was read earlier stays. "No notifications yet" appears only after every read worked. If the record of what you have seen cannot be read, the page says so and the bell shows a dot that says it cannot tell, never 0. {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

## What each party sees

| Party | Sees |
|---|---|
| The Farcaster node your browser reads | what it sees for [Following](/mechanism/following-from-the-hub), plus that your browser asks, by your account, who follows you, who mentions you and who reacts to your newest posts, about once a minute while a tab is open as you |
| Totem's app server | nothing new: no read passes through it, and the Notifications page carries no identifier |
| Totem's validator | that your sealed seen record was rewritten, at a time, as 256 bytes of ciphertext; not the time inside it |
| Neynar | nothing: it is not used |
| Someone using this browser later | nothing from the reads (they live in the tab's memory); the seen time is sealed in your vault |

{cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

Your personas stay out of it. While you act as a persona, Notifications and the bell are the persona's, as before, and nothing is read from the node as you. While you act as yourself, what one of your own personas did to you (a follow, a like, a reply, a mention) is left off your screen and never looked up, because the node knows this browser is you. What that cannot remove: such a follow or like is public on Farcaster for anyone to see, and while few people use Totem, the timing of your browser going quiet and a persona posting is still a hint (A-NOTIF-PERSONA-SEPARATION). {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"}

## Where it lives, and how it is tested

- **Browser:** `lib/fc/hubRead/notifications.ts` (the reads, the groups, the clocks), `lib/fc/hubRead/seen.ts` (the sealed seen record), the hub route's `notifications`, `unread` and `seen` ops (`app/api/fc/hub/route.ts`, a device route), `components/hub/HubNotifications.tsx`, `components/hub/HubUnreadBadge.tsx`, `components/notifications/NotificationsBody.tsx`.
- **Tests:** `npm run test:hub-notif-unit` (against a local stand-in node that answers per shard: the exact reads and page sizes, the groups and their order and words, the shard merge, "at least", the unread count and the sealed record, every failure said, the clocks, your personas left out, nothing read while one acts; and a mutation of each guard), and `scripts/accept-hub-notifications-prod.mjs` on the production shape (the bell counting and clearing, the planted notifications grouped and in order, seen across a reload, the tabs, a like from a reply card, the error and Retry, that Totem's servers saw no follower or post, and zero node reads while a persona acts).
