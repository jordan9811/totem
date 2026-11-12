# For You from the hub

Sign in with Farcaster and, while you act as yourself, For You comes from your own Farcaster graph: posts the people you follow liked or recast lately, and recent posts from accounts several of them follow, ordered by your mode. Your browser reads them straight from a Farcaster node. No Neynar, and nothing passes through Totem's servers.

::: warning Status: built, test data only, not deployed
<span class="st st--test">Built, test data only</span>. The node's behaviour was measured read-only on the real public node on 2026-11-07; the feed itself has only run against a local stand-in of a Snapchain node. It is not deployed yet. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}
:::

The verdict: the reads go from your browser to the node and nowhere else, like [Following from the hub](/mechanism/following-from-the-hub); the node's operator learns more than from Following (which accounts beyond your follows you are shown, and which of your follows are active), and an account For You skips is at most 2:1 evidence that it is one of your personas, because which accounts it reads is decided by a coin keyed to your vault. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}

## At a glance

<ol class="flow">
  <li class="flow__us"><strong>Who you follow</strong>the same read Following makes, shared.</li>
  <li class="flow__us"><strong>Who of them is active</strong><code>GET /v1/reactionsByFid</code> with a page of 1, most recently followed first, 40 at a time, until 40 liked a post in the last 3 days or 1,000 were checked.</li>
  <li class="flow__us"><strong>What they liked, recast and follow</strong>for each of those 40: their newest 25 likes, 25 recasts and 50 follows.</li>
  <li class="flow__us"><strong>The posts</strong><code>GET /v1/castById</code> for at most 2 posts each of them liked or recast in the window; <code>GET /v1/castsByFid</code> for the newest 5 posts of the 30 accounts most of them follow.</li>
  <li class="flow__us"><strong>Names</strong><code>GET /v1/userDataByFid</code> for the authors, the first two people who liked each post, and the accounts a post replies to or mentions.</li>
</ol>
<p class="flow__note">Every read is a plain GET: no custom header, no cookie, no referrer, at most 8 at a time, through the same guard as Following.</p>

## What it shows

- **Why each post is here**: "Liked by Alice and 2 others you follow", "Recast by Bob", or "Followed by 9 people you follow". These count only the people you follow that were read, so they are floors, never a network total: Farcaster's node keeps no counts. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}
- **What was read, in words**: "From 40 people you follow who liked a post in the last 3 days, and 30 accounts several of them follow."
- **Never your Following**: posts by accounts you follow, and your own, stay out (they are Following's). Posts by your personas are never read and never shown. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}
- **Your mode orders it**: the same mode, rules, lens and delivery tiers as [Following](/mechanism/following-from-the-hub). Here the mode's engagement weight and your lens's likes and recasts count the people you follow who liked or recast a post, and author affinity is how many of them follow its author; the page says so. Switching modes re-orders the same posts and reads nothing new.
- **Cards work like Following's**: a post opens as its thread, an author as their profile, and once Totem may post as you ([Post as you](/mechanism/post-as-you)) Reply, Like and Recast act as your own account.

## Measured first, then designed

On the real public node, read-only, on 2026-11-07:

- The accounts you followed most recently are a poor guide to who is active: for one account following 1,854, only 6 of the 40 most recently followed had liked anything in a week, while the 40 most recently active had all liked within 17 hours. So For You looks for activity, at about 600 bytes a check.
- A follow's newest 1,000 follows weigh about 365 KB; their newest 50 about 24 KB. Ranking by whole follow lists picked famous accounts that had not posted in months; ranking by the newest 50 found accounts that had posted that week.
- The node needs the reaction kind on a reactions read (it refuses one without it), so likes and recasts are two reads.
- The whole design, four real accounts: 304 to 1,214 node reads, 1.7 to 2.6 MB, 1.7 to 5.7 seconds, 103 to 150 posts to show. Every answer 200, none 429.

{cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}

## Why it reads only half of what it could

Which accounts For You reads is a function of public data: who you follow, what they liked, whom they follow. A node could work out the same list and notice the one account it expected your browser to read and that it skipped, which would be your persona. So every account beyond the people you follow passes a coin first, keyed to your vault: it is read only when the coin says so, which is true for about half of all accounts, the same way every time and on every one of your devices. An account that is never read is then out for the same reason as half of all accounts, so its absence is at most 2:1 evidence, however long the node watches. The cost is that about half of what For You might show you never appears. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}

## When a read fails

A failure is said, with Retry, and is never shown as an empty feed: "Couldn't read For You from Farcaster's network just now … this is not an empty feed." Reads that failed beside ones that worked are counted on the page, and the rest is shown. The empty states ("you don't follow anyone yet", "none of the people you follow liked a post in the last 3 days", "what they liked is all by people you already follow") appear only after every read worked. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}

## Which source wins

For you, acting as yourself, For You comes from the node whether or not Totem's read relay is switched on: it matches Following, and Neynar's future is a dependency risk since Farcaster's sale. The relay can be For You for everyone else (a persona acting, or no Farcaster sign-in), and only while the operator switches For You to Neynar (built on test data, off by default); it reads one author list Totem's server holds and names no visitor's account. It is never your fallback when a node read fails. While a persona acts, For You is the persona's, exactly as before, and nothing is read from the node as you. {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"}

## What each party sees

| Party | Sees |
|---|---|
| The Farcaster node your browser reads | what it sees for [Following](/mechanism/following-from-the-hub), plus that your browser checked which of your follows are active, read what up to 40 of them liked and follow, and read the posts and profiles of up to 30 accounts you do not follow and the posts your follows liked |
| Totem's app server | nothing new: no read passes through it |
| Totem's validator | nothing new: no read passes through it |
| Neynar | nothing: it is not used for your For You |
| Someone using this browser later | nothing from the reads (they live in the tab's memory) |
