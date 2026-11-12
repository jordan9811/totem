<!-- uncited-ok: page — an editorial suggestion (a list of Farcaster accounts) for the owner to approve or edit; it makes no privacy or security claims -->
<!-- FC-READ (house): this page is the ready-made answer for discovery source (1), a fixed author list in FC_READ_FIDS. The relay has no default list, because choosing whose posts appear under the brand is the owner's call. This page lets the owner approve a list in one step instead of starting from nothing. Every fid below came from a keyless lookup done on 2026-09-27. None is guessed. -->
# Live discovery: a suggested starter author list

**This is a suggestion, not a decision.** Live discovery on the public preview shows the recent top-level posts of
the Farcaster accounts the owner picks (D-FCREAD-NO-CHANNELS-IN-V1). Whose posts appear under the Layers name is the
owner's call. Strike any row you don't want and delete its fid from the line at the bottom. The remaining line is
ready to use: section (i) step 3 of `notes/runbooks/GO-LIVE-FARCASTER.md` covers where it goes.

The list has 54 accounts. Each one met all four of these tests when checked on **2026-09-27**:

- **Well known.** It is a builder, founder, engineer, designer, artist, writer or maker with a real following. Most
  were found through the accounts that Farcaster's co-founder (fid 3) follows, and the rest through the people that
  active, trusted accounts are replying to right now.
- **Active.** It made at least one top-level post on or after 2026-08-28. Discovery shows only top-level posts, not
  replies or recasts, so an account that only replies would add nothing to the feed.
- **Brand-safe in the sample.** Its recent top-level posts, up to 5 per account, were read. Accounts were dropped for
  token or trading promotion, bots or game-result feeds, NSFW innuendo, political posts, or posts about private
  individuals.
- **Not flagged as spam.** Farcaster's public spam label for every listed account is `2 (unlikely to engage in spammy
  behavior)`.

**Neynar score was not checked.** It is visible only with a Neynar API key, and this check used no key. The relay
applies its floor when it reads (`FC_READ_MIN_SCORE`, default 0.5): an author below it is hidden, and nothing errors.
An author below the floor is simply missing from the first real read. The smaller accounts are the likeliest to fall
below it.

## The list

"Last top-level post" is the newest top-level post seen, in UTC. "Posts, 30 d" counts top-level posts in the 30 days
before 2026-09-27 among each account's 30 most recent casts, so it is a lower bound for the heaviest posters.

### Farcaster and the protocol

| # | Username | fid | Last top-level post | Posts, 30 d |
|---|---|---|---|---|
| 1 | dwr | 3 | 2026-09-26 | 4 |
| 2 | farcaster | 1 | 2026-09-22 | 4 |
| 3 | rish | 194 | 2026-09-25 | 2 |
| 4 | manan | 191 | 2026-08-29 | 1 |
| 5 | horsefacts.eth | 3621 | 2026-09-26 | 18 |
| 6 | deodad | 6841 | 2026-09-16 | 3 |
| 7 | christopher | 4085 | 2026-09-23 | 12 |
| 8 | adrienne | 5818 | 2026-09-25 | 9 |
| 9 | nounishprof | 4167 | 2026-09-27 | 3 |

### Builders and engineers

| # | Username | fid | Last top-level post | Posts, 30 d |
|---|---|---|---|---|
| 10 | vitalik.eth | 5650 | 2026-09-26 | 22 |
| 11 | stephancill | 1689 | 2026-09-26 | 3 |
| 12 | dylsteck.eth | 616 | 2026-09-19 | 2 |
| 13 | df | 1214 | 2026-09-21 | 4 |
| 14 | bayardo.eth | 6394 | 2026-09-25 | 11 |
| 15 | chaskin.eth | 7479 | 2026-09-24 | 6 |
| 16 | trent | 1766 | 2026-09-25 | 1 |
| 17 | tayyab | 66 | 2026-09-10 | 3 |
| 18 | matthewb | 4895 | 2026-09-27 | 5 |
| 19 | darrylyeo | 3854 | 2026-09-24 | 3 |
| 20 | w | 142 | 2026-09-11 | 1 |
| 21 | kmacb.eth | 4163 | 2026-09-26 | 5 |
| 22 | pjc | 12567 | 2026-09-26 | 8 |
| 23 | kenny | 2210 | 2026-09-27 | 7 |
| 24 | statuette | 15211 | 2026-09-26 | 2 |
| 25 | ahn.eth | 8004 | 2026-09-26 | 2 |
| 26 | les | 312 | 2026-09-24 | 14 |

### Founders, writers and thinkers

| # | Username | fid | Last top-level post | Posts, 30 d |
|---|---|---|---|---|
| 27 | kepano | 1321 | 2026-09-15 | 5 |
| 28 | linda | 12 | 2026-09-25 | 18 |
| 29 | vgr | 4606 | 2026-09-03 | 2 |
| 30 | july | 1287 | 2026-09-21 | 6 |
| 31 | shawki | 73 | 2026-09-14 | 1 |
| 32 | cojo.eth | 4327 | 2026-09-26 | 8 |
| 33 | sayangel | 1725 | 2026-09-27 | 15 |
| 34 | joeblau | 412 | 2026-09-25 | 14 |
| 35 | mark | 4256 | 2026-09-24 | 5 |
| 36 | brianjckim | 426 | 2026-09-26 | 7 |
| 37 | aviationdoctor.eth | 7237 | 2026-09-23 | 6 |
| 38 | cameron | 617 | 2026-09-26 | 13 |
| 39 | six | 7143 | 2026-09-26 | 16 |

### Artists and designers

| # | Username | fid | Last top-level post | Posts, 30 d |
|---|---|---|---|---|
| 40 | antimofm.eth | 4923 | 2026-09-26 | 6 |
| 41 | phil | 129 | 2026-09-15 | 1 |
| 42 | mxjxn | 4905 | 2026-09-27 | 4 |
| 43 | eirrann.eth | 14885 | 2026-09-27 | 9 |
| 44 | pichi | 234616 | 2026-09-26 | 2 |
| 45 | goldie | 7472 | 2026-09-26 | 15 |
| 46 | andreaboi.eth | 17195 | 2026-09-26 | 22 |
| 47 | 0ffline | 15351 | 2026-09-25 | 2 |
| 48 | arjantupan | 13089 | 2026-09-26 | 4 |
| 49 | kenjiquest | 426167 | 2026-09-27 | 5 |

### Makers and everyday life

| # | Username | fid | Last top-level post | Posts, 30 d |
|---|---|---|---|---|
| 50 | naomiii | 13077 | 2026-09-15 | 3 |
| 51 | huugo | 12977 | 2026-09-26 | 9 |
| 52 | samantha | 1606 | 2026-09-21 | 7 |
| 53 | brixbounty | 18723 | 2026-09-26 | 13 |
| 54 | carter | 2242 | 2026-09-23 | 5 |

## The line

All 54 fids in table order: comma-separated, no spaces, no duplicates. That is within the relay's 1-100 limit and
matches its `FC_READ_FIDS` shape check.

```
FC_READ_FIDS=3,1,194,191,3621,6841,4085,5818,4167,5650,1689,616,1214,6394,7479,1766,66,4895,3854,142,4163,12567,2210,15211,8004,312,1321,12,4606,1287,73,4327,1725,412,4256,426,7237,617,7143,4923,129,4905,14885,234616,7472,17195,15351,13089,426167,13077,12977,1606,18723,2242
```

The fids are in the same order as rows 1 to 54, so striking row N means deleting the Nth fid. The order does not
change what discovery shows.

Before you set it:

- **Striking a row.** Delete that fid and exactly one comma next to it. Keep the line as plain numbers separated
  by single commas: no spaces and no empty entries (`,,`). That is what both ways of setting it accept. Pasted
  unquoted into the GO-LIVE command, a space splits the line into separate arguments and a doubled comma is a
  PowerShell error; `scripts/owner/arm-live-reads.ps1` removes spaces but refuses an empty entry. The relay refuses
  the whole list (`bad_config`) for a duplicate, a leading zero, anything that is not a plain number, or more than
  100 fids. A mistyped fid that is still a valid number is accepted, and discovery will
  then show that other account, so check the line against the table.
- **Pick one source.** In the relay as of tonight, `FC_READ_FIDS` (this list) and `FC_READ_HOUSE_FID` (source 2, a
  house account's follows) are mutually exclusive. Set exactly one; if both are set, the relay stays unarmed.
- **Fids are permanent; usernames are not.** An account can rename or give up its username, but its fid stays with it.
  The usernames here are as of 2026-09-27; the line is what counts.
- **This list also works for source (2).** If you choose the house-account route instead, following these 54 from
  the house account gives it the same starting curation.

## Worth a second look

A handful of listed accounts are the closest calls: occasional market or coin talk, occasional opinion on current
affairs, event promotion, or very frequent posting (a discovery page holds 25 posts, so a heavy poster fills more of
it). Skim the recent posts of any account you are unsure about before approving; strike the row if in doubt.

## Checked and left out

177 accounts were looked up. 94 had no top-level post since 2026-08-28 and were left out as inactive (including
fid 2). 25 more were dropped by the brand-safety and signal screen (token or trading promotion, political posts,
NSFW innuendo, posts about private individuals, referral links, feeds of game results or bare links, anonymous
accounts with little original text). One active account was left out only because it has a post dated in the future;
the relay now drops future-dated posts, so it could be added.

## How this was checked

On 2026-09-27, using only keyless public reads of Farcaster's own API: no Neynar, no API key, no writes. There were
about 490 GET requests, throttled under the observed limit of 20 requests per 10 seconds.

1. **Candidates.** `GET https://api.farcaster.xyz/v2/following?fid=N&limit=50`, paged, for fid 3 (77 follows) and
   for fids 1, 5650, 426, 169, 1321 and 4606. Candidates were ranked by how many of those lists they appear in. More
   came from the parent authors of the recent replies of 15 active accounts.
2. **Username to fid.** Each candidate was looked up with
   `GET https://api.farcaster.xyz/v2/user-by-username?username=NAME`. That gave the fid, the follower count and the
   public spam label. Each listed username matches the username the lookup returned exactly.
3. **Activity.** `GET https://api.farcaster.xyz/v2/casts?fid=FID&limit=30`. A top-level post is a cast with no
   `parentHash`. Recency is the newest timestamp that is not in the future. The first row was not used, because the
   list can lead with a pinned or future-dated cast.
4. **Content.** Up to 5 of the most recent top-level posts per account were read by hand against the brand-safety
   tests above.

Activity was measured on 2026-09-27. Before arming, a re-check is cheap: the same two lookups per account, or simply
the relay's first real read.
