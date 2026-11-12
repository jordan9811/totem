# attack-post-2 — adversarial review: the feed, the rules engine, and the delivery tiers

**Scope:** `git diff 7f70cec..HEAD`, concentrating on `lib/feed.ts`, `lib/injection.ts`,
`lib/rules/evaluate.ts`, `lib/delivery/tiers.ts`, `lib/algo/artifact.ts`,
`lib/adapters/types.ts`, `app/api/delivery/route.ts`, `app/api/feed2/route.ts`.
Claims attacked: `notes/reports/REPORT-POST.md` GATE 3 and `SECURITY-POSTURE.md` §17.

**Method:** read-only. Nothing was run except `npx tsc --noEmit` (clean, exit 0). No
server started, no port bound, no `accept-*` script executed. `scripts/accept-pd3.mjs`
was read, not run. No product file was edited.

**Claims under attack (verbatim):**

1. "The tiers change PLACEMENT, never membership." (`SECURITY-POSTURE.md` §17)
2. "a quiet account is deranked and still present" (`A-POST-DELIVERY-IS-ATTENTION-NOT-ACCESS`)
3. "Pinning acts on the posts the feed already holds." (`D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS`)
4. "An imported algorithm cannot pin or banner." (`D-POST-3-PIN-AND-BANNER-ARE-DEVICE-ONLY`)
5. "the banner tier's strip is drawn from the same eligible set the timeline was built from"
6. "'facet only' scopes to the facets the viewer already follows" (`A-POST-FACET-ONLY-IS-THE-EXISTING-SCOPE`)
7. "a device that cannot read the vault delivers everything Normally rather than guessing"
   (`A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE`)

**Result:** 1 critical, 3 high, 5 medium, 2 low, 2 nit. Claims 1, 2, 3, 4, 5, 6 and 7
are each falsified by at least one finding below.

---

## Severity table

| id | sev | one line |
|---|---|---|
| F-1 | critical | Setting ONE account to any non-normal tier blanks the entire live timeline of every unattributed stranger. |
| F-2 | high | `quiet` does not derank, it hides: the corpus-sort penalty puts every quieted post below the `limit` cut. |
| F-3 | high | Every delivery tier is inert on live content — the live eval context has no `delivery`, so quiet fails OPEN. |
| F-4 | high | `pin` and `banner` are reachable without the importer: `POST /api/rules` takes an arbitrary `action`, and `buildFeed` never validates a stored rule. |
| F-5 | medium | Never-miss resurrects a post from outside the page and evicts one that was on it. |
| F-6 | medium | The compiled `facet-only` rule is dead code under every state `setTier` permits — and wrong in both directions once the facet-follow is dropped (cross-root cluster UNION). |
| F-7 | medium | `previewStrip` and `pinnedHashes` survive into the live-content branch: a strip of seeded posts above a live timeline, pointing at a corpus the viewer is not reading. |
| F-8 | medium | On a fully exhausted feed the banner strip still shows up to 6 posts, including already-seen ones and ones that never made the page. Untested. |
| F-9 | medium | An unreadable `deliveryTiers` vault takes down the WHOLE feed, not just the tiers — and `SECURITY-POSTURE.md` documents the opposite behaviour. |
| F-10 | low | The pin/quiet ordering keys live inside the private-posts `try`; any throw in that block silently drops the whole final ordering. |
| F-11 | low | `lib/rules/evaluate.ts`'s guardrail comment claims the evaluator calls `validateRuleGroup`. It does not — and unknown field + `neq` matches everything. |
| F-12 | nit | `accept-pd3.mjs` check 2's "vanished rather than falling" guard is unreachable; check 4 passes entirely on the pre-existing facet scope. |
| F-13 | nit | A tier does not follow a fork's forward pointer; the padded vault record leaks a coarse row count. |

---

## F-1 — critical — one delivery tier blanks the live timeline

**(a) real defect.**

**Where:** `lib/feed.ts:401`, `lib/feed.ts:407`, `lib/feed.ts:656-658`, `lib/feed.ts:667`;
`lib/delivery/tiers.ts:204-221`.

**The chain.**

`compileDeliveryRules()` always emits four rules whenever the tier map for the active mode
is non-empty (`lib/feed.ts:401` — the condition is `deliveryMap.size`, not "is any account
on facet-only"). The fourth is the facet-only `hide` rule, whose root contains a nested
group with a clause on `author.cluster` (`lib/delivery/tiers.ts:216`). Those rules are
pushed into the same `rules` array the mode's own rules use (`lib/feed.ts:407`).

In the live-content branch:

```ts
// lib/feed.ts:656-658
const referencesAuthor = (grp: Rule["root"]): boolean =>
  grp.clauses.some((c) => ("combinator" in c ? referencesAuthor(c) : /^author\./.test(c.field)));
const authorHideRuleExists = rules.some((r) => r.action === "hide" && referencesAuthor(r.root));
```

`referencesAuthor` recurses into groups, so the facet-only rule makes
`authorHideRuleExists` **true**. Then:

```ts
// lib/feed.ts:667
if (!att && authorHideRuleExists) return false; // unknowable author under an author rule: hidden
```

Every live cast without an attribution — i.e. every cast by anyone who is not one of the
viewer's own personas posting through the shared FID — is dropped. `cards` is then
replaced by that near-empty list (`lib/feed.ts:714`), and the "a live feed the MODE
filtered to zero is an EMPTY live feed" comment above it means the user gets the
empty-state UI.

**Concrete failing input.**

1. Developer pane → data source `neynar` (`setDataSourceOverride("neynar")`,
   `lib/adapters/neynar/mode.ts:18-36` — a runtime switch, no restart), or
   `DATA_SOURCE=neynar` in the deployed preview.
2. Timeline renders live Farcaster casts. Confirm it is non-empty.
3. `POST /api/delivery {"personaId":"persona_acc_astro_1","tier":"never-miss"}` — one
   account, the friendliest tier in the set, in the active mode.
4. Reload `/home`. The live timeline is now empty (or holds only the viewer's own
   attributed casts). Setting the tier back to `normal` restores it.

Any of `never-miss`, `banner`, `quiet` or `facet-only` on any single account does this,
because the trigger is `deliveryMap.size`, not the tier's identity.

**Why the claim fails.** This is the largest possible membership change — the whole
timeline — produced by a setting documented as "PLACEMENT, never membership" and as
"attention, not access". `scripts/accept-pd3.mjs` cannot see it: every check runs against
the seeded corpus, and nothing in the suite flips the data source.

**Fix.** Two independent changes, both cheap:

- Do not compile the facet-only rule when no account in this mode is actually on
  `facet-only`. Compile per-tier on demand:
  `const tiersPresent = new Set(deliveryMap.values())`, and push each rule only if its
  tier is in that set. That alone removes the trigger for the common case.
- Better, and needed anyway: exclude compiled delivery rules from the
  `authorHideRuleExists` probe. That probe exists to catch *the mode's* author rules —
  a rule the owner cannot see, did not write, and that is scoped to a tier no stranger
  can hold, must not stand in for one. Mark compiled rules (`r.id.startsWith("delivery:")`
  or a `synthetic: true` field) and filter them out at `lib/feed.ts:658`.

---

## F-2 — high — `quiet` hides rather than deranks

**(a) real defect.** Falsifies `A-POST-DELIVERY-IS-ATTENTION-NOT-ACCESS` ("a quiet
account is deranked and still present") and `lib/delivery/tiers.ts:225-228`'s own
docstring ("finite so a quiet account is deranked and not disappeared — that is what
'facet only' and a block are for").

**Where:** `lib/feed.ts:552-558` (the corpus sort), `lib/feed.ts:576-592` (the window
cut), `lib/delivery/tiers.ts:228` (`QUIET_PENALTY = 1000`).

The penalty is applied in the **corpus** sort, over all 410 seeded posts
(`seed/data/posts.json`), and then the window is cut at `limit` (40):

```ts
// lib/feed.ts:555-557
const qa = quieted.has(a.hash) ? QUIET_PENALTY : 0;
...
return rankScore(b,...) + lensTermFor(b, tb) - qb - (rankScore(a,...) + lensTermFor(a, ta) - qa);
```

`rankScore + lensTerm` lives in roughly the 0–3 range. A penalty of 1000 is not "finite
but large", it is *total*: every quieted post sorts below every non-quieted post. The
diversity walk (`lib/feed.ts:588-593`) then fills 40 slots from the front of `pending`,
and with ~350 non-quieted eligible posts it never reaches a quieted one. The quieted
account contributes **zero** cards.

The comment 300 lines below documents this exact trap for the demote feature:

> "An earlier attempt sank them in the corpus sort, which pushed them below the limit
> entirely — a de facto block wearing demote's label" (`lib/feed.ts:850-854`)

`quiet` repeats it verbatim, one feature later. The compensating key at
`lib/feed.ts:880-882` is correct but dead: there are no quieted cards left in the window
to order.

**Concrete failing input.**

1. `POST /api/dev {"action":"resetSeed"}`.
2. `POST /api/delivery {"personaId":"persona_acc_astro_3","tier":"quiet"}` — 24 seed
   posts, the most prolific author in the corpus.
3. `GET /api/feed2` → zero cards with `cast.personaId === "persona_acc_astro_3"`.

The suite does not catch it. `accept-pd3.mjs:127` is
`if (at >= 0 && !(at > before))` — when the account falls off the page (`at < 0`) the
down-move assertion is skipped, and the very next line, the guard that is supposed to
catch exactly this, is unreachable (see F-12). The check's own success string prints
`"off the page"` as an acceptable outcome.

**Fix.** Apply the quiet penalty **only in the final sort**, for the same reason the
comment at `lib/feed.ts:847` gives about demote. Remove `qa`/`qb` from the corpus sort at
`lib/feed.ts:555-557` entirely; `lib/feed.ts:880-882` already sinks quieted cards to the
bottom of the window, which is the guarantee the feature actually promises. If a corpus
term is wanted at all, make it a real weight (e.g. `-0.5`) and assert in the suite that
the quieted author still has ≥1 card on the page.

---

## F-3 — high — the tiers are inert on live content, and quiet fails open

**(a) real defect.**

**Where:** `lib/feed.ts:669-683` — the live eval context.

The live context is built with `post`, `author` and `viewer` and **no `delivery` key**.
Per `lib/rules/evaluate.ts:56-57`, `fieldValue("delivery.tier")` then returns `null`, and
every compiled rule uses `op: "eq"` against a tier string, so nothing matches. In
addition `pinSet`, `quieted` and `previewStrip` are all keyed by seeded post hashes,
which do not exist in the live card set — so the final-sort keys at `lib/feed.ts:877-882`
are no-ops too.

Net: in live mode, `never-miss`, `banner`, `quiet` and `facet-only` all silently do
nothing to the content the viewer is actually reading (except F-1's side effect, which is
the opposite of nothing).

This is the direction `lib/delivery/tiers.ts:78-86` says the feature never fails:

> "Never fail open. An unreadable tier map read as 'everything is normal' would quietly
> un-quiet an account the owner turned down, which is the one direction of this setting
> that leaks attention to somebody unwanted."

The module refuses to fail open on a vault read and then fails open on the entire live
surface.

**Concrete failing input.** Data source `neynar`; an attributed persona `p` (one of the
viewer's own, posting through the shared FID) set to `quiet` in the active mode. Its
attributed casts rank exactly as before. Same for `never-miss` — nothing is pinned.

**Fix.** Add `delivery: { tier: att ? deliveryOf(att.id) : "normal" }` to the live ctx at
`lib/feed.ts:669`, and carry `pinned`/`bannered`/`quieted` for attributed live casts the
same way the seeded loop does (`lib/feed.ts:536-547`). Unattributed strangers correctly
have no tier — they are not accounts the owner has an opinion about. If the tiers are
deliberately seed-only for now, say so as a named assumption in `SECURITY-POSTURE.md`
rather than leaving §17's unqualified claims to cover a surface they do not reach.

---

## F-4 — high — `pin` and `banner` are reachable without the importer

**(a) real defect**, against `D-POST-3-PIN-AND-BANNER-ARE-DEVICE-ONLY` as it is *tested*
(`accept-pd3.mjs:322-338` tests the import route only) rather than as it is *worded*.

**Where:** `app/api/rules/route.ts:24`, `lib/adapters/mock/rules.ts:30-43`,
`app/api/modes/route.ts:36` and `:65`, `lib/adapters/mock/mode.ts:60`,
`lib/feed.ts:417-431`.

`lib/algo/artifact.ts:181-193` is a real guard and it holds: `sanitizeArtifact` refuses
`pin`/`banner` by name, and `validateRuleGroup` separately refuses `delivery.tier`
because it is absent from `EVALUABLE_FIELDS` (`lib/rules/evaluate.ts:75-85`). Both
guards are sound. The problem is that they are the **only** guards, and three other doors
into the same `rules` array have none.

```ts
// app/api/rules/route.ts:21-26 — no allowlist on action, no validateRuleGroup on root
const rule = await adapters.rules.create({
  personaId: activeSeedPersonaId(),
  name: body.name,
  action: body.action ?? "hide",
  root: body.root,
});
```

`lib/adapters/mock/rules.ts:32-39` stores `rule.action` verbatim. `POST /api/modes`
(`:36`) and `PATCH /api/modes` (`:65`, `{...existing, ...patch}`) both accept arbitrary
`ruleIds`. And `buildFeed` resolves a mode's stored rules with **no** validation at all —
contrast `lib/feed.ts:408-416`, where inline rules ARE run through `validateRuleGroup`,
with `lib/feed.ts:417-431`, where stored rules are simply pushed.

**Concrete failing input.**

```
POST /api/rules
{"name":"hoist","action":"pin",
 "root":{"combinator":"AND","clauses":[{"field":"author.tier","op":"gte","value":0}]}}
→ {"rule":{"id":"rule_N","action":"pin",...}}

PATCH /api/modes
{"modeId":"<active mode id>","patch":{"ruleIds":["rule_N"]}}

GET /api/feed2
→ pinnedHashes has 10 entries (pinCap = floor(40/4)); the first ten cards are
  one post each from the ten highest-ranked authors, hoisted above everything
  the recency sort would have put there.
```

The same request with `"action":"banner"` fills `previewStrip` with six arbitrary posts —
the "push channel" the decision record says cannot be built.

Note also that `req.json()` in Next route handlers does not check `Content-Type`, so a
cross-origin `fetch` with `text/plain` reaches these routes without a preflight. That
raises this from "the owner can shoot their own foot" toward "a page the owner visits can
rearrange their timeline". Whether that matters is a threat-model call for this repo; the
missing allowlist is a defect either way.

**Fix.** Put the allowlist where the claim lives — at the point a `Rule` reaches the
engine, not in one importer:

- `app/api/rules/route.ts`: reject any `action` outside `["hide","downrank","flag"]`
  with 400, and run `validateRuleGroup(body.root)` before `create`.
- `lib/feed.ts:417-431`: after `adapters.rules.get(ruleId)`, refuse a stored rule whose
  action is `pin`/`banner` unless its id starts with `delivery:` (i.e. it came from
  `compileDeliveryRules`), and run `validateRuleGroup(rule.root)` the same way inline
  rules are. The compiled rules are the only legitimate `pin`/`banner` carriers, and they
  never pass through the adapter.
- Add a check to `accept-pd3.mjs` that `POST /api/rules` with `action:"pin"` is refused —
  check 9 currently proves only that the *importer* refuses it.

---

## F-5 — medium — never-miss resurrects from outside the page, and evicts from inside it

**(a) real defect**, against `D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS`: "Pinning
acts on the posts the feed already holds."

**Where:** `lib/feed.ts:577-587`.

```ts
const seenAuthor = new Set<string>();
const pins: SeedPost[] = [];
for (const p of eligible) {          // <- eligible, ~350 posts, not `ordered`
  if (!pinned.has(p.hash) || seenAuthor.has(p.authorPersonaId)) continue;
  ...
}
const ordered: SeedPost[] = [...pins];
const pending = eligible.filter((p) => !pinSet.has(p.hash));
while (ordered.length < limit && pending.length > 0) { ... }
```

The pin is drawn from `eligible` (the whole filtered corpus), not from the window. If the
never-miss account's best post ranks 300th, it is hoisted to position 0 — a post the feed
did **not** already hold. And because `ordered` starts at `pins.length` and the walk stops
at `limit`, each pin costs one slot: the post that would have been 40th is cut. So the
tier both *adds* something that was not on the page and *removes* something that was —
in a feature documented as "PLACEMENT, never membership".

`accept-pd3.mjs:109` only asserts the page did not *grow*
(`after.cards.length > baseCards.length`), which is true of an even trade.

**Concrete failing input.** Reset the seed; pick any author whose posts are all older
than the 40th-ranked post (`persona_acc_fantasy_5`, tier 1, is a good candidate on the
`following` surface where the discovery gate does not remove it). Set it `never-miss`.
Its oldest-but-highest-scoring post appears at index 0 of a page it was nowhere near, and
`baseCards[39]` is gone.

**Fix.** Decide which claim to keep and make the code say it.

- If "acts on the posts the feed already holds" is the contract: build the window first
  (`ordered` from `pending` alone), then hoist pinned posts **that are already in
  `ordered`**. A never-miss author with nothing on the page gets nothing pinned, which is
  consistent with "the rest of their posts rank normally".
- If resurrection is intended (it is arguably what "never miss" means): drop that clause
  from `D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS` and from §17, and say instead that
  a pin may displace the lowest-ranked post on the page. Either way the current pairing of
  code and claim is wrong.

---

## F-6 — medium — the `facet-only` rule is dead code, and wrong when it is not

**(a) real defect**, against `A-POST-FACET-ONLY-IS-THE-EXISTING-SCOPE` ("'facet only'
scopes to the facets the viewer already follows").

**Where:** `lib/feed.ts:399-401`, `lib/delivery/tiers.ts:204-221`,
`app/api/delivery/route.ts:29-38`, `lib/feed.ts:513-516`.

Two problems, one cause: the compiled rule is handed a **global union** of clusters across
every facet-scoped root, while both the existing feed scope and the write-time validation
are **per root**.

```ts
// lib/feed.ts:399-401
const allowed = new Set<string>();
for (const set of facetScopedRoots.values()) for (const c of set) allowed.add(c);
deliveryRules = deliveryMap.size ? compileDeliveryRules([...allowed]) : [];
```

versus the pre-existing, correct, per-root check:

```ts
// lib/feed.ts:513-516
if (author && facetScopedRoots.has(author.rootId)) {
  const allowedClusters = facetScopedRoots.get(author.rootId)!;
  if (!allowedClusters.has(author.cluster)) continue;
}
```

and the correct per-root check at write time (`app/api/delivery/route.ts:33-37` filters
`m[1] === rootId`).

**Consequence 1 — dead code.** `setTier` refuses `facet-only` unless the target's root
already has a followed facet (`lib/delivery/tiers.ts:161-166` + the route's per-root
lookup). But if the root has a followed facet, the per-root check at `lib/feed.ts:513`
has *already* excluded every persona of that root outside the followed clusters. The
compiled rule then evaluates `author.cluster ∈ union`, and the union is a superset of the
per-root set, so it is always true and the rule never hides anything. **Under every state
`setTier` permits, the facet-only tier is a no-op** — the account is scoped by the
facet-follow the viewer already had, tier or no tier.

`accept-pd3.mjs:165-188` cannot tell: it follows `facet_root_acc_crypto_2_crypto`, sets
`persona_acc_crypto_2` to `facet-only`, then switches the followed facet to
`astronomy` — and the 0 posts it asserts come entirely from `lib/feed.ts:513`. Delete the
facet-only rule from `compileDeliveryRules` and check 4 still passes.

**Consequence 2 — wrong in both directions once the facet-follow is dropped.** The tier
persists in the vault; the facet-follow does not have to. After unfollowing, the root
leaves `facetScopedRoots`, the per-root check stops applying, and the compiled rule
becomes the only thing left — evaluated against clusters followed on **other** roots:

- Union contains the author's cluster → the rule matches nothing → `facet-only` silently
  behaves as `normal`, showing every post the account makes.
- Union does not contain it (or is empty → the `"\u0000none"` sentinel,
  `lib/delivery/tiers.ts:216`) → every post that account makes is hidden. This is exactly
  the outcome `setTier` refuses to create at write time, reached by a different route.

**Concrete failing input (the permissive direction).**

1. `POST /api/disclosure/facets {"facetId":"facet_root_acc_food_1_restaurants","follow":true}`
2. `POST /api/delivery {"personaId":"persona_acc_food_1","tier":"facet-only"}` → accepted.
3. `POST /api/disclosure/facets {"facetId":"facet_root_acc_food_2_restaurants","follow":true}`
   (a different root, same cluster name — keeps `"restaurants"` in the union).
4. `POST /api/disclosure/facets {"facetId":"facet_root_acc_food_1_restaurants","follow":false}`
5. `GET /api/feed2` → `persona_acc_food_1` is back at full volume with the tier still
   reading `facet-only` on `/settings/delivery`.

**Fix.** Pass the map, not the union: `compileDeliveryRules` should take
`Map<rootId, Set<cluster>>` and compile a facet-only clause that is scoped per root — or,
since the evaluator has no root field, the feed should resolve the tier to a
*post-specific* sentinel the way it already resolves the tier itself. The cleanest version
given the existing seam: at `lib/feed.ts:538`, resolve
`deliveryOf(post.authorPersonaId)` and, when the tier is `facet-only`, downgrade it to
`"facet-only-out"` when `author.cluster` is not in `facetScopedRoots.get(author.rootId)`
(defaulting to the empty set when the root is not scoped at all). Then the compiled rule
is a plain `delivery.tier eq "facet-only-out"` with no cluster clause — which also
removes the `author.cluster` clause that causes F-1.

---

## F-7 — medium — the preview strip survives into live mode

**(a) real defect**, against "the banner tier's strip is drawn from the same eligible set
the timeline was built from" (§17) and `components/PreviewStrip.tsx:6-9` ("drawn from the
same eligible set the timeline was built from, so it can never surface a post the mode's
rules excluded").

**Where:** `lib/feed.ts:594-610` (built from seeded `eligible`), `lib/feed.ts:714`
(`cards` is *replaced* by live casts), `lib/feed.ts:1389` and `:1403` (both returns carry
`previewStrip`/`pinnedHashes` unconditionally).

In live mode the timeline the viewer sees is Farcaster casts. `previewStrip` is still the
seeded corpus. The strip is therefore a surface of posts that are in **no** sense "the
eligible set the timeline was built from" — they are from the other universe entirely, and
`components/PreviewStrip.tsx:37` links each one to `/{handle}/status/{hash}`, a post the
viewer cannot scroll to in the timeline they are reading.

The codebase already takes the opposite position for every other seed-derived surface:

> "In live mode the seed-derived injections are dropped. A community note about a seeded
> post, or a folder card pointing at one, annotates a post that is not in this timeline —
> the card would reference something the viewer cannot scroll to." (`lib/feed.ts:1241-1245`)

`pinnedHashes` has the same problem in the other direction: it names seeded hashes that
appear nowhere in `cards`, so the UI marks nothing and the suite would assert on a set
disconnected from the page.

**Concrete failing input.** Data source `neynar`;
`POST /api/delivery {"personaId":"persona_acc_astro_1","tier":"banner"}`; load `/home`.
Above the live timeline sits a strip of six seeded `persona_acc_astro_1` posts. (In
practice F-1 fires first and the timeline below is empty, which makes the strip the only
content on the page.)

**Fix.** Guard both outputs the same way the injection queue is guarded at
`lib/feed.ts:1311-1338`: `previewStrip: live ? [] : previewStrip`, `pinnedHashes: live ? [] : [...pinSet]`
— or, properly, build the strip from the live eligible set for attributed casts once F-3
is fixed.

---

## F-8 — medium — the banner strip resurrects content on a fully exhausted feed

**(a) real defect**, against `D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS`: "On a fully
exhausted feed — everything seen — a never-miss post does NOT come back above or below the
caught-up banner."

**Where:** `lib/feed.ts:1361-1389`.

The decision id says "a tier", and §17 generalises the caught-up claim to the strip in the
same paragraph. The exhausted branch returns `previewStrip` untouched. The strip is built
from `eligible` (`lib/feed.ts:599`) with **no** `isNew` filter and **no** `limit`, so on a
fully exhausted feed — everything seen, `cards` reduced to the banner plus readwise and
folders — the page still renders up to six banner-tier posts above the timeline,
including posts already read and posts that never made the window.

The comment defends this on a technicality ("The preview strip lives above the timeline
entirely, so it is not 'content below the banner' either", `lib/feed.ts:1384-1388`). That
is true of *placement* and beside the point of the contract: the anti-doomscroll promise
is that the feed ENDS, and six fresh-looking cards at the top of an ended feed is a
backfill regardless of which side of the banner they sit on.

`accept-pd3.mjs:268-286` (check 7 part two) asserts
`full.filter(c => c.kind === "post").length === 0` — it inspects `cards` only and never
looks at `previewStrip`. The behaviour is untested.

**Concrete failing input.**

1. `POST /api/delivery {"personaId":"persona_acc_astro_1","tier":"banner"}`
2. `POST /api/dev {"action":"setLastVisit","minutesAgo":0}` (everything seen).
3. `GET /api/feed2` → `cards` is banner-plus-below only, `previewStrip.length === 6`.

**Fix.** In the exhausted branch, filter the strip to items newer than `lastVisit`
(`absoluteTime(p.minutesAgo) > lastVisit`), which is the same predicate `isNew` uses at
`lib/feed.ts:1347-1358`. A full exhaust then yields an empty strip and the claim holds
literally. Add the `previewStrip.length === 0` assertion to check 7 part two.

---

## F-9 — medium — an unreadable tier vault takes the whole feed down, and the posture doc says otherwise

**(a) real defect + documentation contradiction.**

**Where:** `lib/delivery/tiers.ts:50-89`, `lib/feed.ts:393-403`,
`SECURITY-POSTURE.md` §17 `A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE`.

`load()` deliberately throws rather than returning an empty map — a good decision, argued
well at `lib/delivery/tiers.ts:78-86`. But the caller does not contain it:

```ts
// lib/feed.ts:393-402 — a bare block, no try/catch
{
  const { tierMapFor, compileDeliveryRules, QUIET_PENALTY: qp } = await import("@/lib/delivery/tiers");
  QUIET_PENALTY = qp;
  deliveryMap = await tierMapFor(mode.id);
  ...
}
```

The throw propagates out of `buildFeed`, `app/(main)/home/page.tsx:110` catches it into
`loadError`, and the user gets "Couldn't load your timeline" — **no feed at all**, because
one optional preference map could not be decrypted. Every other optional read in this
function is wrapped (packs `:296-301`, strikes `:314-319`, curator flags `:336-338`,
channels `:350-354`, folders `:358-363`, stakes `:461-463`, readwise state `:932-940`).
Note also `lib/delivery/tiers.ts:74` — a decrypt error whose message contains "vault"
breaks out of the retry loop immediately, so a key problem is a permanent outage until
`resetDeliveryCache()` runs.

Meanwhile `SECURITY-POSTURE.md` §17 states the opposite behaviour:

> "it travels with the vault, and a device that cannot read the vault delivers everything
> Normally rather than guessing."

Three descriptions, three different behaviours: the posture doc says fail-open-to-normal,
the module says fail-closed-refuse, the feed delivers total outage.

**(c) design disagreement, on the underlying call.** Refusing rather than un-quieting is
defensible. Refusing the *entire timeline* is not the same decision, and nothing in the
pass argues for it. The failure the module worries about — a quieted account quietly
returning — is bounded and reversible; a blank home screen is neither.

**Fix.** Pick one and make all three agree. My recommendation: keep the refusal, but
degrade to a *labelled* feed — catch the throw in `buildFeed`, serve the timeline with
`deliveryRules = []`, and return a `deliveryStale: true` flag the way `contentStale`
already works (`lib/feed.ts:633`), so the UI can say "delivery settings unavailable —
everyone is showing normally" rather than laundering it. That is exactly the honesty
pattern the live-content path already uses. Then correct
`A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE` to describe it.

---

## F-10 — low — the delivery ordering keys are inside the private-posts `try`

**(a) real defect**, pre-existing in structure but newly load-bearing.

**Where:** `lib/feed.ts:757-891`.

The final sort — which is where the demote key, the pin key and the quiet key all live,
and which `lib/feed.ts:847-855` calls "the only place a position guarantee survives" —
sits inside the `try` that starts at `lib/feed.ts:757` with
`adapters.identity.visiblePrivatePosts`. Its `catch` (`:886-891`) is documented as
fail-closed for private posts, and it is. But it also swallows any throw from the anon-cast
fetch (`:794-796`), the fid-profile resolve (`:807`), the standing loop, or the sort
itself — and the consequence is that **the entire final ordering is skipped**. Demoted
authors are not sunk, pins are not hoisted, quieted posts are not lowered, and nothing
anywhere says so.

**Concrete failing input.** Any failure of `fetchAnonCasts` (`lib/feed.ts:796`) that
survives `withRetry` — the mock adapters fail 2% of calls by design
(`lib/feed.ts:36-38`) — produces a feed with no delivery ordering and no signal.

**Fix.** Split the block: keep private posts and anon casts in their own `try`s, and move
`cards.sort(...)` out to the top level where it cannot be skipped. The sort reads only
local state and cannot throw for an adapter reason.

---

## F-11 — low — the guardrail comment overstates what the evaluator does

**(a) real defect** (stale claim), with a small fail-open behind it.

**Where:** `lib/rules/evaluate.ts:65-70`.

> "THE enforcement point for imported algorithms... Both the import sanitizer and the
> evaluator itself call this, so a hostile rule that somehow survives import still cannot
> evaluate."

`evaluateGroup` (`lib/rules/evaluate.ts:164-173`) does not call `validateRuleGroup`. The
only callers are `sanitizeArtifact` (`lib/algo/artifact.ts:175`) and the inline-rule loop
in `buildFeed` (`lib/feed.ts:409`). A stored rule reaching the engine through
`mode.ruleIds` is never validated at all (see F-4).

What actually stands in for it is `fieldValue`'s `default: return null`
(`lib/rules/evaluate.ts:60-62`), and that is not equivalent: it is safe for `eq`, `in`,
`contains` and the numeric ops, but **`neq` against an unknown field matches every post**
(`null !== expected`). So an unvalidated stored rule
`{action:"hide", root:{combinator:"AND", clauses:[{field:"identity.linkage", op:"neq", value:"x"}]}}`
blanks the feed, and `{action:"pin", ...}` pins everything — the F-4 payload without even
needing a real field.

**Fix.** Either make the comment true (call `validateRuleGroup` once per rule at the top
of `buildFeed`'s rule resolution, for stored and inline rules alike — the natural place is
`lib/feed.ts:417-431`), or rewrite the comment to say the sanitizer is the only enforcement
point and the evaluator's null default is a backstop, not a guard. Separately, make `neq`
on a `null` actual return `false` — "is not X" should not be a true statement about a
field that does not exist.

---

## F-12 — nit — two `accept-pd3.mjs` checks cannot fail

**(a) real defect in the suite** (not the product), worth recording because both cover
findings above.

**Where:** `scripts/accept-pd3.mjs:130`, `scripts/accept-pd3.mjs:165-188`.

```js
// :119-130
at = indexOf(after.cards, TOP);
if (at >= 0 && !(at > before)) throw new Error("quiet did not move the account down: ...");
if (!(at >= 0 || beforeCount > 0)) throw new Error("the account vanished rather than falling");
```

`beforeCount` is `postsOf(baseCards, TOP).length`, and `TOP` is chosen at `:82` as
`authorsInOrder[0]` — an author *present in* `baseCards`. So `beforeCount > 0` is true by
construction, the disjunction is always true, and the negation is never taken. The guard
against F-2 is unreachable. The first line is also skipped when `at < 0`, so a total
disappearance passes both assertions.

Check 4 (`:165-188`) asserts 0 posts outside the followed facet — an outcome produced
entirely by `lib/feed.ts:513-516`, which predates this pass. Deleting the facet-only rule
from `compileDeliveryRules` leaves the check green (F-6).

**Fix.** For check 2, assert `postsOf(after.cards, TOP).length > 0` directly — "still
present" is the claim, so assert presence, not a disjunction that contains it. For check 4,
set the tier while the root's facet-follow is *absent* from the union (the F-6 repro) so
the rule is the only thing that can produce the result.

---

## F-13 — nit — two smaller observations

**(a) a tier does not follow a fork.** `deliveryOf` keys on `post.authorPersonaId`
(`lib/feed.ts:403`, `:538`). When a persona forks forward, the tier set on the new persona
does not apply to the old persona's posts, and the tier set on the old one keeps applying
to posts nobody will make again. `resolveForwardPointer` is already imported into this
file (`lib/feed.ts:10`) and used at `:1190`. Not a security issue; it will read as a bug
the first time someone quiets an account that has moved.

**(b) the padded record leaks a coarse row count.** `lib/delivery/tiers.ts:94-97` pads to
a 1 KiB boundary. A row is roughly 45 bytes (`"m_xxx|persona_acc_crypto_1":"never-miss",`),
so the sealed size steps at roughly every 22 non-normal settings. §17's claim that the
validator "learns neither the accounts nor the tiers" is correct; the operator does learn
`floor(rows/22)`. Worth one line as an assumption, not a fix.

---

## What I checked and found sound

These were attacked and held. Recording them so the next reviewer does not repeat the work.

- **The order of operations in the eligibility loop** (`lib/feed.ts:493-549`). Every
  `continue` — channel membership (`:507`), blocks including 3-strike mutes and curator
  auto-blocks (`:508`), `hideReplies` (`:509`), `followedOnly` (`:510`), per-root facet
  scope (`:511-515`), saturation (`:519`), the discovery/zk gate (`:524`) and the `hide`
  rules (`:541`) — all sit **above** the three lines that populate `pinned`, `bannered`
  and `quieted` (`:545-547`). A post excluded by any of them can never enter those sets,
  so on the seeded path the "placement, never membership" claim holds at this level. (It
  fails elsewhere — F-1, F-2, F-5 — but not here.)
- **The preview strip cannot leak a private post.** The strip is built from `SEED_POSTS`
  (`lib/feed.ts:599`), which is a frozen import from `seed/data/posts.json`
  (`lib/adapters/mock/store.ts:80`) and is never mutated at runtime — I grepped for
  `SEED_POSTS.push/unshift/splice` and there are none. Private posts live in a separate
  store reached through `adapters.identity.visiblePrivatePosts` (`lib/feed.ts:758`) and
  are appended to `cards` well after the strip is built.
- **The strip cannot leak a blocked author, a channel post, or a facet-scoped post.** All
  three exclusions run before `eligible.push` (above), and the strip filters `eligible`.
- **The strip does not leak a merged identity.** `mergedAuthorFor` is applied only to
  `cards` (`lib/feed.ts:1396-1400`); the strip uses the bare persona handle
  (`lib/feed.ts:607`), which is what every non-granted viewer sees anyway. The strip
  discloses strictly less than the card, not more.
- **The `"\u0000none"` sentinel is a genuine sentinel.** Verified by hexdump of
  `lib/delivery/tiers.ts:216` — the first byte is NUL, so it cannot collide with a cluster
  name that arrives through the `^facet_(.+)_([^_]+)$` parse (`lib/feed.ts:373`), which
  cannot produce a NUL.
- **The negate/`in` handling in the facet-only rule is correct as written.**
  `evaluateGroup` applies `group.negate` after combining (`lib/rules/evaluate.ts:171-172`),
  an empty group returns `false` before negation (`:170`), and `in` requires an array
  (`:156`). The `NOT (cluster in allowed)` construction does what the comment says. The
  bug in F-6 is the *contents* of `allowed`, not the rule shape.
- **`delivery.tier` is correctly absent from `EVALUABLE_FIELDS`** (`lib/rules/evaluate.ts:75-85`).
  That means the rule builder cannot offer it, `sanitizeArtifact` refuses an import that
  names it, and `buildFeed`'s inline-rule loop refuses a preview rule that names it. Only
  `compileDeliveryRules`, which bypasses the validator by construction, can emit one.
  Correct and deliberate.
- **The artifact import path is double-guarded and holds.** `lib/algo/artifact.ts:175-193`
  runs `validateRuleGroup` *and* the three-action allowlist, and the refusal names the
  action. `importArtifact` (`lib/algo/service.ts:347-357`) materialises rules only after
  `sanitizeArtifact` succeeded. The lens path (`lib/algo/service.ts:330-338`) and the pack
  path (`:321-328`) carry no rule actions at all. A filter pack contributes only
  `blockedIds` (`lib/feed.ts:293-296`), never a `Rule`. I found no route from an
  *artifact* to `pin`/`banner`. F-4's route does not involve an artifact.
- **`resetDeliveryCache` is wired into `resetSeed`** (`app/api/dev/route.ts:519-524`), and
  `deliveryTiers` is registered in both `VAULT_NAMESPACES` (`lib/vault/vault.ts:99-109`)
  and `ExtraNamespace` (`lib/adapters/mock/persist.ts:109`). The ops rule holds.
- **`save()` refuses to seal over an unloaded doc** (`lib/delivery/tiers.ts:92`), so a
  failed read cannot be laundered into an empty write. Good.
- **Normal is not stored** (`lib/delivery/tiers.ts:169`), so `listNonNormal` is complete by
  construction as claimed. Verified.
- **The injection contract survives the pin.** `injectIntoFeed` (`lib/injection.ts:90-155`)
  dedupes on `cast.hash` from the posts array, which now includes pinned cards, so a pin
  cannot produce a duplicate injected card. The per-type caps (`:137`), the per-tenant
  reservation floor (`:113-129`) and the `every: 4` cadence (`:149-152`) are all computed
  from the merged card list and are indifferent to which posts are in it. No break found.
- **The pin key is correctly below the demote key** (`lib/feed.ts:858-879`): a
  curator-flagged or standing-sunk author stays at the bottom even on never-miss. That
  half of the claim holds exactly as written.
- **The tier is genuinely per (account, mode).** `keyOf` (`lib/delivery/tiers.ts:48`),
  `tierMapFor`'s prefix scan (`:113-119`) and the route's `modeId` default
  (`app/api/delivery/route.ts:51`, `:91`) are consistent. The `indexOf` of `|` in
  `listNonNormal` (`:134-136`) splits on the *first* separator, which is correct given mode
  ids contain no `|`.
- **`npx tsc --noEmit` is clean** (exit 0).

---

## Summary of what falsifies what

| claim | falsified by |
|---|---|
| "tiers change PLACEMENT, never membership" | F-1 (whole live timeline), F-2 (quiet cuts), F-5 (pin evicts and resurrects) |
| "a quiet account is deranked and still present" | F-2 |
| "pinning acts on the posts the feed already holds" | F-5 |
| "an imported algorithm cannot pin or banner" | holds for artifacts; F-4 defeats it through `/api/rules` |
| "the strip is drawn from the same eligible set the timeline was built from" | F-7 (live mode), F-8 (exhausted feed) |
| "'facet only' scopes to the facets the viewer already follows" | F-6 |
| "a device that cannot read the vault delivers everything Normally" | F-9 (it delivers nothing at all) |
| "never fail open … the one direction that leaks attention" | F-3 (fails open on the entire live surface) |
