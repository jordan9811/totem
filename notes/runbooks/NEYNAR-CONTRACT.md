# Neynar contract — recorded from the source, not from training data

Gate 4 builds against this file. Every claim here came from the Neynar MCP
server (its published OpenAPI reference) or from a live call with the project's
`NEYNAR_API_KEY`. Where the live API and prior assumptions disagree, the live
API wins and the disagreement is recorded, because those are exactly the
places an integration written from memory breaks.

## Provenance

- **MCP server**: `mcp__neynar__search_neynar` against `/reference/fetch-feed`
  and the nodejs-sdk feed pages. Available from the Gate 2/3 boundary onward;
  it was **not** in the tool registry earlier in this pass, which is why the
  earlier judgment call in `notes/reports/REPORT-MEGA.md` records falling back to direct
  API calls.
- **Live probe**: `GET https://api.neynar.com/v2/farcaster/user/bulk?fids=3`
  → 200, with a real user object.

## Auth

Header `x-api-key: $NEYNAR_API_KEY`. Optional `x-neynar-experimental: bool`
(default false) enables Neynar-score-based filtering.

## `GET /v2/farcaster/feed/`

Query parameters are **snake_case** (the Node SDK's camelCase is an SDK
convention, not the wire format):

| Param | Type | Notes |
|---|---|---|
| `feed_type` | enum `following` \| `filter` | default `following`; `following` requires `fid` or address |
| `filter_type` | enum `fids` \| `parent_url` \| `channel_id` \| `embed_url` \| `embed_types` | only when `feed_type=filter`; `global_trending` was **removed** from this enum in spec v3.183.0 (2026-08-07) |
| `fid` | integer | user whose feed to build |
| `fids` | string | comma-separated, **max 100**, with `filter_type=fids` |
| `channel_id` | string | with `filter_type=channel_id` |
| `members_only` | boolean | default **true**, with `filter_type=channel_id`; marked **deprecated** in spec v3.184.0 |
| `parent_url`, `embed_url`, `embed_types` | | per matching `filter_type` |
| `with_recasts` | boolean | default true |
| `limit` | int32 | default 25, **max 100** |
| `cursor` | string | pagination |
| `viewer_fid` | integer | **respects this user's mutes and blocks**, and adds `viewer_context` |

Response: `{ casts: Cast[], next: { cursor: string } }`.

**Rechecked 2026-09-25 (FC-READ (no channels)) against the published OpenAPI
spec v3.184.0** (`github.com/neynarxyz/OAS`, `src/api/spec.yaml`): the table
above is still the contract, and `limit` is default 25, maximum 100. The
response schema is `FeedResponse { casts, next: { cursor } }`, both required.
`casts[].author` is the full User object, with `score` optional in the schema
(present on all 25 authors of the recorded `fixtures/neynar/feed-following.json`,
0.98 to 1.0, beside the legacy `experimental.neynar_user_score`); a quoted
cast's author (`embeds[].cast.author`) is dehydrated and carries no score.
The public read relay's discovery is this endpoint with
`feed_type=filter&filter_type=fids` in list mode, and `/feed/following/` in
house mode (the FC-READ section below).

`viewer_fid` matters for this project specifically: it is Farcaster's
server-side block enforcement, and it is *not* the same thing as Totem's
`blockedFor()` fan-out. Both must apply. Neynar cannot know about a pairwise
block held in the local store, and the local store cannot know about a
protocol-level mute.

## Cast object

```
object            "cast"
hash              string
thread_hash       string
parent_hash       string | null
parent_url        string | null
root_parent_url   string | null
parent_author     object
author            User
text              string
timestamp         string   <-- ISO-8601 date-time, e.g. "2024-10-27T05:55:59.000Z"
embeds            (EmbedCast | EmbedUrl)[]
reactions         object
replies           object
channel           Channel | ChannelDehydrated | null
mentioned_profiles      UserDehydrated[]
mentioned_channels      ChannelDehydrated[]
mentioned_channels_ranges  TextRange[]   { start, end }
viewer_context    object
```

## User object (as `casts[].author`)

```
fid                 int32
username            string
display_name        string | null   <-- NULLABLE
pfp_url             string | null   <-- NULLABLE
custody_address     string
follower_count      int32
following_count     int32
profile.bio.text    string          <-- nested, not a flat `bio`
profile.banner.url  string
profile.location    { latitude, longitude, address, radius }
registered_at       date-time
verifications       string[]
verified_addresses  { eth_addresses[], sol_addresses[], primary { eth_address, sol_address } }
verified_accounts   [{ platform: "x" | "github", username }]
pro                 { status: "subscribed" | "unsubscribed", expires_at, subscribed_at }
score               double
experimental.neynar_user_score  double
viewer_context      { following, followed_by, blocking, blocked_by }
```

## Where this contradicts the local model

These are the adapter's real work. Each one is a place a from-memory
integration would produce plausible, wrong code.

| # | Neynar | `lib/types.ts` | Consequence |
|---|---|---|---|
| 1 | `timestamp` is an ISO-8601 **string** | `Cast.timestamp: number` (epoch ms) | must parse; a raw assign yields `NaN` in every relative-time label |
| 2 | `display_name` and `pfp_url` are **nullable** | `User.displayName: string`, `pfpUrl: string` non-null | real accounts with no display name or avatar crash or render "null" |
| 3 | `follower_count` / `following_count` | `followerCount` / `followingCount` | silent `undefined` → counts render blank |
| 4 | bio at `profile.bio.text` | `User.bio?: string` flat | silent `undefined` |
| 5 | `reactions` / `replies` are **objects** | `likes`, `recasts`, `replies` are flat numbers | `[object Object]` in the UI |
| 6 | **no view count exists** | `Cast.views: number` required | see below |
| 7 | `casts[].channel` may be a *dehydrated* variant with fewer fields | — | field presence is not guaranteed by the type name alone |

**On #6 — the honest handling.** Farcaster has no impression metric. The X
clone renders a view count on every post. Under `DATA_SOURCE=neynar` that
number must be **absent**, not zero: rendering "0 views" on a real cast is
fabricating a metric the protocol does not have, and it would be the one
number on screen that is a lie. `Cast.views` becomes optional and the view
element renders only when the field is present.

## Endpoints Gate 4 will use (read-only)

| Purpose | Endpoint |
|---|---|
| Feed | `GET /v2/farcaster/feed/` |
| Users by fid | `GET /v2/farcaster/user/bulk?fids=` |
| User by username | `GET /v2/farcaster/user/by_username?username=` |
| Casts by user | `GET /v2/farcaster/feed/user/casts` |
| Channel | `GET /v2/farcaster/channel` |

Writes are out of scope for this gate: `ENABLE_WRITE=false`, and the write
adapter throws loudly rather than silently no-oping.

## Gate 2 additions (Farcaster pass, verified 2026-08-28)

Same provenance discipline: everything below came from the Neynar MCP server's
published OpenAPI reference chunks on 2026-08-28. Items the docs did not
confirm are flagged **LIVE-PROBE** — do not code against those without a real
call first. No reference page retrieved states per-endpoint credit costs.
OpenAPI lists all paths with a trailing slash (`/v2/farcaster/cast/`); both
forms work in practice, but record it.

**Mutes/blocks routing** (from `docs/mutes-blocks-and-bans`): for
`cast/conversation`, `feed/channels`, `feed/trending`, `user/search`,
`cast`, they apply to the optional `viewer_fid`. For `notifications*` they
apply to the **`fid` param itself** — there is no separate `viewer_fid` on
notifications.

### `GET /v2/farcaster/cast/conversation`

| Param | Type | Notes |
|---|---|---|
| `identifier` | string | **required**; cast hash or URL |
| `type` | enum `url` \| `hash` | **required**; says which one `identifier` is |
| `reply_depth` | integer | default **2**; depth of nested `direct_replies` |
| `include_chronological_parent_casts` | boolean | default **false**; include all ancestors up to root, chronological |
| `viewer_fid` | integer | mutes/blocks + `viewer_context` |
| `sort_type` | enum `chron` \| `desc_chron` \| `algorithmic` | default `chron`; orders descendants |
| `fold` | enum `above` \| `below` | omit = full conversation, no folding; `below` = the low-quality replies hidden below the fold |
| `limit` | int32 | default **20** |
| `cursor` | string | pagination (over direct replies) |

Response: `{ conversation: { cast: CastAndConversations } }` where
`CastAndConversations` = full Cast **plus**
`direct_replies: CastAndConversationsRef[]` — **recursive**: each reply
carries its own `direct_replies` down to `reply_depth`. Every node is a full
Cast (nullable `display_name`/`pfp_url` on every author, object-shaped
`reactions`/`replies` — all the Gate 4 mapping traps apply at every depth).

**LIVE-PROBE**: the docs' OpenAPI chunk for this page truncates mid-response,
so the retrieved spec never shows where `chronological_parent_casts` sits
(expected `conversation.chronological_parent_casts: Cast[]`) nor the
top-level `next` cursor object. Confirm both with one real call before the
thread screen renders ancestors or paginates.

### `GET /v2/farcaster/cast`

| Param | Type | Notes |
|---|---|---|
| `identifier` | string | **required**; hash or URL — a short-hash web URL like `https://farcaster.xyz/dwr.eth/0x029f7cce` is accepted with `type=url` |
| `type` | enum `url` \| `hash` | **required** |
| `viewer_fid` | integer | adds `viewer_context` (`liked`, `recasted`) on the cast |

Response: `{ cast: Cast }` — same Cast object as the feed endpoints, with
`cast.channel` possibly dehydrated and everything nullable that is nullable
in the feed. No list wrapper, no cursor.

### `GET /v2/farcaster/notifications`

| Param | Type | Notes |
|---|---|---|
| `fid` | integer | **required**; mutes/blocks apply to this fid — no `viewer_fid` exists |
| `type` | enum[] as comma-separated string | filter values: `follows`, `recasts`, `likes`, `mentions`, `replies` |
| `limit` | int32 | default **15** |
| `cursor` | string | pagination |

**`priority_mode` is NOT in the current OpenAPI spec.** It survives in older
SDK examples (v1→v2 migration guide passes `priorityMode`), but the recorded
current spec lists only the four params above. **LIVE-PROBE** before relying
on it either way.

Response: `{ next: { cursor: string | null }, notifications: Notification[] }`.

```
notifications[].object                 "notification"
notifications[].type                   enum follows | recasts | likes | mention | reply | quote
notifications[].most_recent_timestamp  ISO-8601 string, required
notifications[].seen                   boolean, required
notifications[].count                  int32, OPTIONAL — bundle size for follows/likes/recasts
notifications[].cast                   Cast, OPTIONAL — absent on follows
notifications[].follows                Follower[], OPTIONAL — { object:"follower", user: User, app: UserDehydrated }
notifications[].reactions              ReactionWithUserInfo[], OPTIONAL —
                                       { object: "likes"|"recasts", user: User,
                                         cast: CastDehydrated { hash, object:"cast_dehydrated",
                                                                author: UserDehydrated, app } }
```

Traps recorded from the spec:

1. **Filter/response enum mismatch**: you request plural `mentions`/`replies`
   but receive singular `mention`/`reply`; `quote` appears in responses and
   has **no filter value**. Switch on the response enum, not the request one.
2. `reactions[].cast` is **dehydrated** — hash + author stub only, no text or
   timestamp. Rendering "X liked: <cast text>" requires a follow-up
   `GET /v2/farcaster/cast` (or a local cache) per reacted cast.
3. On any embedded `cast`: `reactions.likes` and `reactions.recasts` arrays
   are **deprecated and always empty** per the spec — the counts live at
   `reactions.likes_count` / `reactions.recasts_count`. Never derive counts
   from array length.
4. `cast.parent_author.fid` is `int32 | null`. `cast.app` is
   `UserDehydrated | null`. All author objects carry nullable
   `display_name`/`pfp_url`.
5. `seen` is server state; flipping it is a separate authenticated write
   (`markNotificationsAsSeen` in the SDK) — out of scope while
   `ENABLE_WRITE=false`, so the local unread state must be client-side.

### `GET /v2/farcaster/feed/channels` — the "casts in channels" endpoint

Verified as the current purpose-built endpoint (page
`reference/fetch-feed-by-channel-ids`). The `feed_type=filter` +
`filter_type=channel_id` route on `/v2/farcaster/feed/` still works for a
single channel; this one takes up to 10 at once.

| Param | Type | Notes |
|---|---|---|
| `channel_ids` | string | **required**; comma-separated, **max 10** |
| `with_recasts` | boolean | default **true** |
| `with_replies` | boolean | default **false** |
| `members_only` | boolean | default **true** — non-member casts silently excluded |
| `fids` | string | comma-separated, max 10; filter feed to these authors |
| `viewer_fid` | integer | mutes/blocks + `viewer_context` |
| `limit` | int32 | default **25** |
| `cursor` | string | pagination |
| `should_moderate` | boolean | default **false**; only casts liked by the channel moderator |

Response: `{ casts: Cast[], next: { cursor } }` — identical Cast contract to
`/v2/farcaster/feed/`, including the dehydrated-channel variant on
`casts[].channel`.

**2026-09-25 (FC-READ (no channels)):** in spec v3.184.0 both `members_only`
and `should_moderate` are marked **deprecated**, and `limit` has a maximum of
100. The public read relay no longer calls this endpoint
(D-FCREAD-NO-CHANNELS-IN-V1: channels are not an emphasis in v1). The rig's
channel feed in `lib/adapters/neynar/content.ts` still does.

### `GET /v2/farcaster/feed/trending`

**REMOVED from the published contract (recorded 2026-09-25, FC-READ (no
channels)).** OAS spec v3.183.0 (2026-08-07) dropped this path, and the same
release dropped `filter_type=global_trending` from `/v2/farcaster/feed/`; three
days earlier v3.182.0 (2026-08-04) dropped `/feed/for_you`. Nothing was added
in their place. The last spec that carried trending, v3.182.0, gave `limit`
default 10, maximum 10; `time_window` one of `1h`, `6h`, `12h`, `24h`, `7d`
(`7d` for channel feeds only); `provider` `neynar` only. Its reference page
now shows only a title and an SDK link, and the Node SDK's main branch has no
trending method. A keyless probe on 2026-09-25 answered **401**, the same as a
made-up route and the removed `/feed/for_you`, where every in-spec feed route
answered the x402 **402** challenge: consistent with retirement, not proof of
it. Treat it as absent. If a keyed call ever answers 200, it is off-contract
and can disappear without notice. (v3.184.0, the same day, also dropped the
`algorithmic` sort from `/cast/search`.) The rest of this section is the
record from before the removal.



Path verified (mutes/blocks list + a docs-embedded live URL:
`/v2/farcaster/feed/trending?limit=10&time_window=24h&provider=neynar`).
Wire params (snake_case of the verified SDK params): `limit`, `cursor`,
`viewer_fid`, `time_window`, `channel_id`, `parent_url`, `provider`,
`provider_metadata` (URL-encoded JSON; used with `provider=mbd`).

**LIVE-PROBE**: the full OpenAPI chunk for this page never surfaced through
the docs search, so the exact `time_window` enum, `provider` enum, `limit`
default/max, and defaults are unverified. Known signal: `24h` works (docs
URL), the SDK enum uses keys like `_6h`, and sibling trending endpoints use
`1h/6h/12h/24h/7d` (fungibles) vs `1d/7d/30d` (channels) — do not guess which
set this one takes. Response is `{ casts: Cast[], next: { cursor } }` per the
docs example.

**Maximum page size: 10** (recorded 2026-09-25, FC-READ). The generated
Node SDK typings (`@neynar/nodejs-sdk` 3.177.0, `feed-api.d.ts`, built from
the OpenAPI spec) describe `limit` as "Default: 10, Maximum: 10", and list
`time_window` values `1h`, `6h`, `12h`, `24h`, `7d` ("7d window for channel
feeds only") and `provider` value `neynar`. That package is not in this
repo's `node_modules`, and on 2026-09-25 the docs MCP search returned the
SDK page's parameter table without defaults or maxima, so the number is from
the typings alone. The code used to ask for `limit=25` (`lib/data.ts`
`liveTrending(25)`, used by classic For You, Explore and History on the rig
and the owner service); if the live API enforced the typed maximum, that call
400'd and `getFeed` fell back to the fixture without a sound, so those surfaces
may never have shown live content. The public read relay never called trending;
its discovery surface is `/feed/` filtered by author fids (the FC-READ section
below). A stub must not serve this path as a working endpoint, so a fixture
cannot hide the removal.

**The code no longer calls this path (2026-09-25, FC-READ (no channels)).**
`liveTrending` is gone. On the rig and the owner service (`DATA_SOURCE=neynar`),
classic For You and Following, Explore and History now read the viewer's
following feed (`liveViewerFeed`: `/feed/?feed_type=following&fid=<NEYNAR_VIEWER_FID>`,
limit 25), the same read the mode-aware home (`/api/feed2`, limit 40) already
made; channel tabs still read `/feed/channels`, which is in the contract.

### `GET /v2/farcaster/feed/following/` — the following feed, by its own path

Recorded 2026-09-27 (FC-READ (house)), because the public read relay's house
mode calls it (the FC-READ section below). Sources: the published OpenAPI spec
v3.184.0 (`github.com/neynarxyz/OAS`, `src/api/spec.yaml`, operationId
`fetch-user-following-feed`; the path's definition is byte-identical in
v3.182.0, so the August removals did not touch it) and the docs MCP reference
page `reference/fetch-user-following-feed`, which agree.

| Param | Type | Notes |
|---|---|---|
| `fid` | integer, min 1 | **required**: the user whose following feed to build |
| `viewer_fid` | integer, min 1 | mutes/blocks of THIS user + `viewer_context` |
| `with_recasts` | boolean | default **true** |
| `limit` | int32 | default **25**, min 1, **max 100** |
| `cursor` | string | pagination |

Header `x-neynar-experimental` as on `/feed/`. No `with_replies`, no
`feed_type`, no filter. Response: `FeedResponse { casts, next: { cursor } }`,
the same schema as `/feed/`; errors are `400 ErrorRes` (no 404 is listed).
Price: its own row on the Credits Pricing page, `/v2/farcaster/feed/following`
**4 × page limit** (documented). Mutes and blocks apply to the optional
`viewer_fid` (`docs/mutes-blocks-and-bans` lists this path among those), so a
call without one should not be expected to honour the `fid`'s own mutes (not
probed). Neynar's guide
(`docs/what-does-vitalikeths-farcaster-feed-look-like`) describes it as the
"reverse chronological" feed of whom the fid follows; the recorded
`fixtures/neynar/feed-following.json` is newest-first, 25 casts, 25 scored
authors, no replies, no recasts.

The same feed is also reachable as `/feed/?feed_type=following&fid=<fid>`
(the `/feed/` default when `feed_type` is absent); the rig's `liveViewerFeed`
uses that shape. The public relay never does: its `/feed/` path check pins
`feed_type=filter`.

### `GET /v2/farcaster/user/by_username`

| Param | Type | Notes |
|---|---|---|
| `username` | string | **required** |
| `viewer_fid` | integer | adds `viewer_context` |

Response: `{ user: User }` — the full User object from the Gate 4 section:
`display_name` and `pfp_url` **nullable**, bio at `profile.bio.text`,
`verified_addresses.primary.{eth,sol}_address` each `string | null`. Spec
lists **404 Resource not found** for a nonexistent username — treat 404 as
"no such user", not as an outage.

### `GET /v2/farcaster/user/search`

| Param | Type | Notes |
|---|---|---|
| `q` | string | **required** |
| `viewer_fid` | integer | mutes/blocks + `viewer_context` |
| `limit` | int32 | default **5** (unusually low — pass it explicitly; max unstated, LIVE-PROBE before assuming 100) |
| `cursor` | string | pagination |

Response is **nested one level deeper than every other endpoint here**:
`{ result: { users: User[], next: { cursor: string | null } } }` — and
`result.next` is *optional* in the spec, not required. A mapper that reads
top-level `users`/`next` (the `/user/by_location` and `/followers` shape)
gets `undefined` silently — exactly the never-fail-open case: throw, don't
default to an empty list.

### Cross-cutting, recorded once

- `reactions.likes[]` / `reactions.recasts[]` are deprecated always-empty
  arrays **everywhere** the current spec shows them; counts are
  `likes_count` / `recasts_count`. Older docs examples (and possibly older
  cached fixtures) still show populated arrays with `{ fid, fname }` — the
  spec, not the examples, is current.
- Still **no view/impression count** on any endpoint above; the Gate 4 rule
  (render the view element only when the field exists) extends unchanged to
  threads, notifications, and channel feeds.
- `power_badge` shows up in older example payloads but not in the current
  User spec (which has `pro` and `score` instead) — don't map it.

## FC-READ: the public read relay's operations and what each costs (2026-09-25)

The public preview reads live Farcaster through ONE server route,
`POST /api/fc/read`, whose module `lib/fc/readRelay.server.ts` holds a
SECOND app's key (`NEYNAR_READ_API_KEY`: no signers, no App Wallet, no
webhooks). The browser never calls Neynar and never sees the key
(SECURITY-POSTURE.md §19). The relay is a closed table, not a proxy: the
client names an operation and at most one argument, and every upstream
parameter below is fixed by the relay. The client never supplies `fid`,
`viewer_fid`, `cursor`, `provider` or `limit`; no call carries a
`viewer_fid`, so every answer is identical for every caller and can be
shared from one cache.

| op | arg | upstream (GET, `no-store`) | documented max | credits per miss | cache |
|---|---|---|---|---|---|
| `status` | — | none | — | 0 | — |
| `discovery` (list mode) | — | `/v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25`, one page, no cursor | 100 fids; limit 100 | 100 (documented: 4 × limit) | 600 s |
| `discovery` (house mode) | — | `/v2/farcaster/feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25`, one page, no cursor | limit 100 | 100 (documented: 4 × limit) | 600 s |
| `thread` | `0x` + 40 lowercase hex | `/v2/farcaster/cast/conversation?identifier=<hash>&type=hash&reply_depth=2&include_chronological_parent_casts=true&limit=10` | limit 50 | ~40 (ASSUMED: 4 × limit) | 900 s |
| `user` | a Farcaster username | `/v2/farcaster/user/by_username?username=<fname>` | — | ~2 (ASSUMED) | 1,800 s |
| `user-casts` | a Farcaster username | `/v2/farcaster/feed/user/casts?fid=<resolved on the server>&limit=10` | limit 150 | ~40 (ASSUMED: 4 × limit) | 1,800 s |

**No `channel` op (D-FCREAD-NO-CHANNELS-IN-V1, the owner's decision of
2026-09-25: channels are not an emphasis in v1; discovery is a general feed;
there is no per-channel live read).** A request for it is `bad_op`, and a
channel tab stays preview content. `FC_READ_FIDS` is server environment only:
1 to 100 comma-separated integer author fids, and one of the TWO exclusive
discovery sources (see "Two discovery sources" below): malformed, the relay
stays unarmed with `bad_config` naming `FC_READ_FIDS`; unset, it stays
unarmed only when `FC_READ_HOUSE_FID` is unset too, and the log then names
both variables. It is curation by AUTHOR: the
general ranked feeds (`/feed/trending`, `filter_type=global_trending`,
`/feed/for_you`) are gone from the contract (see trending above), and the only
uncurated in-contract feed, `filter_type=embed_types`, is a firehose that the
score floor cannot clean of high-scoring bots. For the discovery path the
relay requires and pins the VALUES `feed_type=filter`, `filter_type=fids` and
`with_recasts=false` as it pins `limit`, so the same pathname can never carry
`feed_type=following` (the default when `feed_type` is absent); and it
drops any cast whose `parent_hash` is not null, because whether the fids
filter returns replies is unverified (the recorded following feed had none in
25). No `viewer_fid` is sent or needed, and no parameter adds the author
score: it is already in the payload.

**Two discovery sources, exactly one configured (FC-READ (house),
2026-09-27; D-FCREAD-HOUSE-ACCOUNT in SECURITY-POSTURE.md §19).** List mode
is the `FC_READ_FIDS` row above. House mode is `FC_READ_HOUSE_FID`: one
positive integer, the fid of a "house" Farcaster account whose follows are
the curation list, read as that account's following feed (the
`/feed/following/` section above); the owner curates by following and
unfollowing in any Farcaster client, with no redeploy and no 100-fid cap.
Both set, neither set, or a malformed value: the relay stays unarmed with
`bad_config`, and its log names the variable, never the value. The status op
says neither which source is configured nor any fid. House mode is the one
following-feed request the relay can make: its path check pins `fid` to the
server's configured `FC_READ_HOUSE_FID` (handed to the check from the armed
configuration, not read off the path it checks) and requires exactly `fid`, `with_recasts=false`
and `limit=25`; no `viewer_fid` (so the house account's mutes are not relied
on: unfollowing, or `FC_READ_DENY`, is how an author is removed), no
cursor, never a client value. The reply drop, the score floor, the denylist
and the cost (4 × limit, charged once a miss) are the same as list mode.
Whether the following feed carries replies, or the house account's own
casts, is unverified; replies are dropped either way.

**Future-dated casts (FC-READ, 2026-09-27).** A cast's `timestamp` is the
author's claim, and the network carries some far in the future: a keyless
read of api.farcaster.xyz on 2026-09-27 listed a top-level cast dated
2061-09-12 first among one well-known account's casts. The device's final
feed order is by recency, so one such cast would sit at the top of the public
discovery feed, in either source, for decades, and its age would render as
negative. The relay drops (never clamps) any cast dated more than 10 minutes
ahead of its own clock (Farcaster's clock-skew allowance), in every op: a
discovery cast, a profile's cast, a thread's root (the thread then answers
`not_found`), an ancestor, a reply or a quoted cast. The stub plants one
(`FCREAD-FUTURE`, dated 2061) and `accept-fcread` checks 5d, 15c and 24
measure the drop. Whether Neynar's feeds serve such a cast first, as that
read did, is unverified; the drop holds either way.

Never called by the relay: `/v2/farcaster/notifications` (bound to an fid),
any following feed but the house one (`/feed/?feed_type=following` in any
mode, see the pinned values above; `/feed/following/` for any other fid,
with a `viewer_fid` or a cursor, or at all in list mode), `/feed/channels`
(D-FCREAD-NO-CHANNELS-IN-V1),
`/feed/trending` (removed from the contract, see above), any POST, signer,
webhook, ban or wallet endpoint. A 404 from `by_username` or `conversation`
means "no such user / cast" and is negative-cached for 3,600 s. The relay checks each path
and its parameter NAMES against this table when it builds the call, never an
argument's value, so a user named `cursor`, `following` or `notifications`
is an ordinary `by_username` lookup (FC-READ review).

- **Documented prices** (Credits Pricing page, `reference/compute-units`,
  rechecked 2026-09-25, and the feed rows again 2026-09-27):
  `/v2/farcaster/feed` 4 × page limit (the row list-mode discovery is priced
  from: 4 × 25 = 100 a miss); `/feed/channels` 4 × page limit; `GET /cast` 2;
  `/feed/following` 4 × page limit (the row house-mode discovery is priced
  from: also 100 a miss); `/notifications` 5 × page limit; `/channel/list` 2 ×
  page limit; `/user/bulk` 1 per fid.
- **Not on that page, so ASSUMED until measured:** `/cast/conversation`,
  `/feed/user/casts` (priced like the feed family, 4 × page limit) and
  `/user/by_username` (≤ 2). (`/feed/trending` was never on it either, and is
  now out of the contract.) The first real arming runs under a 2,000-credit
  daily budget and measures one call of each against the portal's usage
  counter; the relay's price table is corrected from that. The same run counts
  the discovery casts that survive the score floor, the denylist and the reply
  drop: if fewer than about 20 of 25 do, discovery's page size rises to 40 to
  50 (160 to 200 credits a miss) rather than following a cursor.
- **Maxima**: `/feed/` limit 100 and at most 100 `fids`, `/feed/following/`
  limit 100 (spec v3.184.0); `cast/conversation` 50 and `feed/user/casts` 150
  (SDK typings 3.177.0, unchanged in spec v3.184.0). The relay stays far
  under each; the test stub enforces them, so a fixture cannot accept a call
  the live API would refuse.
- **The author score** the relay's content floor reads (`FC_READ_MIN_SCORE`,
  default 0.5) is the User object's `score` ("probability that the account is
  not spam", 0–1). The recorded fixtures also carry
  `experimental.neynar_user_score` with a deprecation notice saying it was
  promoted to `score`; read `score`. An author with no `score` is treated as
  below the floor and hidden.
- **Per-day ceiling of the shared keys** at those lifetimes: discovery is the
  only one, 86,400 / 600 = 144 misses × 100 = 14,400 credits a day, whatever
  the length of the author list or the house account's follow list, in either
  mode (at page size 40 to 50: 23,040 to 28,800), and
  nothing for channel tabs, which make no relay call. The relay's default
  budget is 100,000 credits a UTC day per instance (`FC_READ_DAILY_CREDITS`),
  about 3M a month, 30% of the Free plan's 10M. Lookups (`thread`, `user`, `user-casts`)
  may spend at most 70% of it and one address at most 5%; a miss is charged
  once however many retries it takes, and a failing key or a run of failures
  pauses upstream calls for 45 s / 60 s without charging (SECURITY-POSTURE.md
  §19, C-FCREAD-NEYNAR-CREDITS).
- **Rate limits** (Free): 600 requests a minute per endpoint, 1,000 across all
  endpoints, independent of credits, and assumed shared by every app on the
  account. The relay's own global miss bucket is 60 a minute.
