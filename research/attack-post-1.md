# attack-post-1 — adversarial review of the post-deploy pass (Gates 0–3)

**Scope:** `git diff 7f70cec..HEAD` — commits `d3d183c`, `a9d0b3d`, `6229339`.
**Angle:** scope enforcement and cross-persona disclosure.
**Method:** source first. Every claim quoted from `notes/reports/REPORT-POST.md` or `SECURITY-POSTURE.md` §17 was
re-derived from the code; where the code and the prose disagree, the code is what is reported. No
product process was started; `npx tsc --noEmit` is clean on HEAD (exit 0) and is the only command run
against the tree.

**Counts:** 1 critical · 4 high · 5 medium · 2 low/nit. Ten things were checked and found sound;
they are listed at the end with what was actually verified, not just named.

---

## Summary table

| id | sev | one line |
|---|---|---|
| F-1 | critical | `GET /api/persona/chrome` — the route that *implements* compartment mode — returns every sibling's id, handle and colour regardless of it, and `/settings/persona-mode` renders that list. |
| F-2 | medium | The tint-collision refusal is an oracle: under compartment mode it confirms siblings exist and leaks their accents to within a few dE. |
| F-3 | high | Five more cross-persona surfaces never call `viewScope()` at all — including the persona→FID map, the relationship-port list (persona↔persona↔X handle), and `?delta=` echoing `ownPersonaIdsAll()`. |
| F-4 | high | `POST /api/identity/fork` never checks that `fromPersona` is the caller's; Gate 1's `copySettings` therefore copies a non-owned persona's rules, modes and folders, inherits its tier, and overwrites its fork record. |
| F-5 | medium | `confirmPort` checks the *device*, not the *issuing persona* — "refuses anyone but the issuing persona" is not what the predicate says. |
| F-6 | medium | `confirmPort` has a check-then-await gap: two concurrent confirms issue two grants; confirm racing decline ends "declined" with the disclosure made. |
| F-7 | high | This pass widened the `layers_seed_persona` cookie from "the seeded own list" to "anything in the render map", silently — the same power as `view-as` without `view-as`'s banner. |
| F-8 | medium | The two identity universes meet inside `currentScope()`: with a roster-minted active persona the search index narrows to **nothing**, and the act-as picker empties instead of narrowing. |
| F-9 | medium | The tint roster is computed over two different sets in the layout and the route, so the deterministic-assignment guarantee does not hold across them. |
| F-10 | low | "The sibling's records are never read … never in the process memory" overclaims: the index is scoped, the process is not. |
| F-11 | low | `g.__layersPersonaChrome` is a process global with no root key; the compartment flag survives a root switch inside one process. |
| F-12 | nit | 1 KiB padding quantum buckets the chosen-tint count at ~30; `confirmPort`'s lapse message describes a revival path that cannot happen. |

---

## F-1 — `GET /api/persona/chrome` is itself an unscoped cross-persona surface

**Severity: critical** (against the pass's own headline claim; see the deployment note at the end)
**Type: (a) real defect, introduced by this pass**

**Where:** `app/api/persona/chrome/route.ts:34–53`, specifically `:37–39` and `:45–49`.
**Renderer:** `components/settings/PersonaTintPane.tsx:36–45`, mounted at
`app/(main)/settings/persona-mode/page.tsx:14`.

**The claim.** `notes/reports/REPORT-POST.md`, D-POST-2-COMPARTMENT-IS-ENFORCED-AT-THE-API: "The account switcher,
the act-as picker, the search index and a sibling's stake history all narrow at the route, not in the
DOM … One chokepoint answers for all four: `viewScope()`." `SECURITY-POSTURE.md` §17: "Four surfaces
narrow AT THE API, not in the DOM."

**What the code does.** The route asks the chokepoint and then does not use the answer:

```ts
const active = activeSeedPersonaId();
const own = await ownIds();                 // ownPersonaIdsAll() — the whole sibling set
const scope = await viewScope(active, own); // asked…
const tints = await tintsFor(own);          // …and ignored
return NextResponse.json({
  activePersonaId: active,
  palette: TINT_PALETTE,
  scope,                                    // reported, not enforced
  tints: own.map((id) => ({ ...tints[id], handle: personaById.get(id)?.handle ?? id, wash: … })),
});
```

`scope.visiblePersonaIds` is computed (`lib/identity/chrome.ts:281`: `compartment ? [activePersonaId]
: ownIds`) and then never intersected with `own`. The `tints` array carries, for every own persona:
the persona **id**, the **handle**, the colour, and whether the owner chose it.

**Exploit path.** Owner has personas `@work` and `@nsfw`. Owner taps compartment mode while a
colleague is looking over their shoulder, or while screen-sharing. Compartment is on; `/api/personas`
correctly returns one persona; the act-as picker correctly offers one. The colleague (or anyone with
the tab, or a stale client, or `curl` against the same session) then does either of:

1. navigates Settings → **Persona & mode**, which is a normal, unrestricted settings page, or
2. `GET /api/persona/chrome`.

Both return the full roster with handles. This is a strictly larger disclosure than the account
switcher that compartment mode was built to suppress — the switcher shows handles, this shows handles
*and* the stable persona ids, and it does so from the one route whose header comment says "The scope
this route reports is the SAME value /api/personas, /api/personas/act-as-options and
/api/search/unified enforce". It reports it; it does not enforce it.

**What I would change.** Filter the enumerated set, not just report the scope:

```ts
const visible = new Set(scope.visiblePersonaIds);
const listed = own.filter((id) => visible.has(id));
… tints: listed.map(…)
```

and keep `palette` (which says nothing about the roster) as is. The structural fix is better: make
`viewScope` return the narrowed list as the *only* way to get a roster in a route, and make
`ownPersonaIdsAll()` the exception that has to be justified at each call site (see F-3).

---

## F-2 — the tint-collision refusal is a sibling-enumeration oracle

**Severity: medium** — survives the F-1 fix, so it needs its own change
**Type: (a) real defect**

**Where:** `lib/identity/chrome.ts:179–208` (`setTint`), driven by
`app/api/persona/chrome/route.ts:60`.

`setTint` is handed `ownIds` and loops over *all* of them:

```ts
const current = await tintsFor(ownIds);          // :190
for (const id of ownIds) {
  if (id === personaId) continue;
  const sep = separation(color, other.color);    // :195
  if (sep.distance < MIN_SEPARATION)             // :196
    return { ok: false, code: "collides", reason:
      "that colour is indistinguishable from another persona's under " + sep.model +
      " (distance " + sep.distance.toFixed(1) + ", the cue needs " + MIN_SEPARATION + ") …" };
}
```

The route passes `await ownIds()` — the unscoped `ownPersonaIdsAll()` — with no reference to
compartment mode.

**Exploit path.** Compartment mode on, device scoped to `@work`. The attacker only ever names the
*active* persona, so no ownership check fires:

1. `POST /api/persona/chrome {"action":"tint","personaId":"<active>","color":"#000000"}`.
2. Read the response. A `200` means no sibling accent is within dE 12 of black. A `409` means one is,
   and the body names the vision model and the exact distance to it.
3. Walk the hex space. `MIN_SEPARATION` is 12 and `separation()` returns the worst-model distance
   (`lib/identity/colorVision.ts:58–67`), so each refusal is a sphere-intersection constraint in
   Lab space. A few dozen probes localise each sibling accent to a few dE, and the count of mutually
   exclusive constraint clusters is a lower bound on the sibling count.

A single `409` already defeats the point: it proves "this device holds at least one other persona",
which the brief names explicitly ("a route that leaks the sibling SET — even just a count or a
length"). The eight-entry palette (`chrome.ts:40–49`) is public, so recovering an accent to within a
few dE usually identifies which palette slot a sibling holds, and `tintsFor`'s deterministic walk
(`chrome.ts:146–166`) then tells you roster *position*.

**What I would change.** Two things, both cheap:
- Pass `scope.visiblePersonaIds` as the collision set when `scope.compartment` is true — under
  compartment there is exactly one visible persona, so there is nothing to collide with and the
  refusal cannot fire. (The cue is not degraded: you cannot see the siblings to confuse them with.)
- Alternatively, refuse tint *edits* entirely while compartment is held, with "leave compartment mode
  to change colours" — consistent with the 409 that `setUnified` already returns.

**A smaller thing in the same place, worth fixing for audit honesty.** The comment at
`chrome.ts:190–195` says "the refusal names the sibling and the vision model it collapses under". It
does not name the sibling — the message says "another persona's". That is the right behaviour and the
wrong comment; a reader auditing the leak surface from the comments would conclude something worse
than the truth is shipping.

---

## F-3 — five cross-persona surfaces that never ask `viewScope()`

**Severity: high** (collectively)
**Type: (a) real defect for the two this pass's claim covers; (c) design gap for the rest**

I enumerated every route under `app/api/` that returns more than the active persona's data and checked
each against the chokepoint. Four routes call it (`/api/personas`, `/api/personas/act-as-options`,
`/api/influence?view=history`, `/api/search/unified` via `currentScope`). The following return the
sibling set and do not:

**F-3a — `app/api/fc/persona/route.ts:31–37` (GET).** Returns
`map: await personaFidMap()` and `records: (await allPersonaFids()).map(redact)` — every own persona
id paired with its Farcaster **fid** and **fname**. This is the strongest cross-persona surface in the
product (it is the whole subject of §14) and it is one unauthenticated `GET` away under compartment
mode. `redact()` strips the Neynar signer uuid; it does not strip the mapping, which *is* the
disclosure.

**F-3b — `app/api/x/port/route.ts:13–22` (GET).** Returns every port with `fromPersona`, `toPersona`,
`counterpart`, and `handles` — the root's two X handles as a pair. A persona↔persona↔X-handle linkage
table, unscoped. (It also hands a caller the `portId` that F-5 needs.)

**F-3c — `app/api/disclosure/route.ts:19`.** `return NextResponse.json({ …, ownPersonas:
SEED_VIEWER.personas })` — the seeded sibling id list, appended to every disclosure read,
unconditionally.

**F-3d — `app/api/personas/bindings/route.ts:20–62`.** Iterates `SEED_VIEWER.personas` and returns
each one's id, handle, name and default mode, then loops again and returns every mode of every persona
tagged with `ownerPersonaId`. The settings matrix is a complete roster dump.

**F-3e — `app/api/lenses/route.ts:29–31`.**
```ts
const personaIds = q.get("personaIds") ? … : await ownPersonaIdsAll();
const delta = await influenceDelta(lens.spec, personaIds, viewer, epoch);
return NextResponse.json({ lensId: lens.id, personaIds, delta });
```
`GET /api/lenses?delta=canonical` echoes `ownPersonaIdsAll()` straight back. It also accepts a
caller-supplied `personaIds`, so under compartment mode `?delta=canonical&personaIds=<sibling>` runs
the accrual arithmetic for a sibling and returns it.

**Exploit path (any of them).** Identical to F-1: compartment mode is held, the DOM shows one persona,
and one `GET` returns the set. F-3a is the one I would fix first — a fid is a permanent public
network identifier, so leaking the *pairing* is worse than leaking the ids.

**What I would change.** The routes-add-a-check approach has now failed six times in one pass
(F-1 plus these five). Move the narrowing to where the set is produced: rename `ownPersonaIdsAll()`
to `ownPersonaIdsUnscoped()` and add `visiblePersonaIds()` that goes through `viewScope`. Then a grep
for the unscoped name is the standing check, and a new route that wants the full set has to say why —
which is the same shape as the Gate 0 needle decision (D-POST-0-THE-NEEDLE-IS-GENERAL-NOT-A-LIST),
applied to the roster instead of to the vault.

---

## F-4 — the fork route never checks that `fromPersona` is the caller's, and Gate 1 hung `copySettings` off it

**Severity: high**
**Type: (a) real defect. The missing check is pre-existing; this pass widened what it costs.**

**Where:** `app/api/identity/fork/route.ts:112–133` (resolution), `:137` (tier),
`:157–182` (creation), `:257–267` (fork record), `:286–294` (`copySettings`).
`lib/identity/clone.ts:62–64` and `:66–126`.

`idOf()` (`route.ts:31–36`) resolves any id or handle present in the global `personaById` /
`personaByHandle` maps — which hold every seeded persona of every root, and now (see F-7) every roster
persona `lib/validator.ts:46–55` has registered. There is no ownership predicate anywhere in `POST`.

The only thing resembling authorization is the 403 path at `:212–219`: "A signing refusal … is a
permanent authorization failure". But both functions it guards iterate `carry`:

- `issueForwardPointer` (`lib/identity/fork.ts:74–94`) — `for (const holder of carry)`.
- `reissueGrants` (`lib/identity/fork.ts:122–154`) — filters originals by `carry.includes(...)`.

With `carry: []` neither signs anything, so **the 403 never fires**.

**Exploit path.** One request:

```
POST /api/identity/fork
{"fromPersona":"<any handle or id in the store>","carry":[],"startFrom":true}
```

and the caller gets, in order:

1. **The victim's settings, copied and reported.** `copySettings(fromPersona, created.id, …)` reads
   `adapters.rules.list(victim)`, `adapters.mode.list(victim)`, `adapters.mode.getActive(victim)` and
   `adapters.space.listFolders(victim)` — the last including `postHashes` — and writes them as the
   caller's own artifacts under the caller's new persona (`clone.ts:73–118`). The response's `clone`
   object returns `modes`, `rules`, `folders` and `followsShared` as counts, and the copied artifacts
   are then readable through the caller's own `/api/modes`, `/api/rules` and `/api/folders`.
   `clone.ts:62–64` says in so many words: *"The personas must both belong to the caller's root — the
   route checks that"*. The route does not.
2. **An impersonating persona.** In non-`per-persona-fid` mode `:157–167` creates it with
   `name: "<victim> (new)"`, `handle: "<victim>_2"`, `avatarUrl: source.avatarUrl`, `bio: source.bio`,
   `cluster: source.cluster`, and `:171–182` registers that in `personaById`/`personaByHandle`.
3. **The victim's tier.** `:137` `const tier = await adapters.rep.tierFor(fromPersona)`, stamped onto
   the new record at `:179`. `lib/adapters/mock/rep.ts:36–46` reads exactly that field, so the new
   persona *is* that tier. `ownTierNow()` (`lib/influence/allowance.ts:134–143`) takes the **max** over
   own personas, so the caller's influence allowance rises to the victim's. Under the zk rep impl the
   tier carries only through the continuity proof, so this half is mode-dependent — real on
   legacy/mock, mitigated on zk.
4. **The victim's continuity, destroyed.** `:257–267` does `state().forks.set(fromPersona, { …,
   forwardGrantIds: [], carried: [], … })` followed by `persistNs("forks")` at `:267`. If the victim
   had genuinely forked, their record is gone: `GET /api/identity/fork?resolve=<victim>` reads
   `record?.forwardGrantIds` (`:60`), now empty, so every carried grant-holder's "did this account
   move?" answers `null` forever. An integrity attack, persisted.

**What the pass got right here.** `rosterRoot = sessionRoot ?? (await rootForFid(getSelf().fid)) ??
source.rootId` (`:197`) puts the caller's root first, so the clone does land under a root the caller
controls — the second half of the brief's question 5 is answered correctly, and the comment at
`:188–192` reasons about it properly.

**What I would change.** Hoist the check that `/api/seed-persona:18` already builds:

```ts
const mine = new Set([...SEED_VIEWER.personas, ...ownPersonaIds(), ...session.personas.map(p => p.id)]);
if (!mine.has(fromPersona))
  return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
```

placed immediately after `:125`, before `currentGrantHolders` is read. Apply the same predicate to
`GET ?personaId=`, which today returns `holders` — the victim's audience list with handles, names and
avatars (`:84–99`) — to any caller who names them.

---

## F-5 — `confirmPort` checks the device, not the issuing persona

**Severity: medium**
**Type: (a) real defect — the code is weaker than the stated contract**

**Where:** `lib/x/porting.ts:233`; route at `app/api/x/port/route.ts:33–35`.

```ts
if (!ownIds().has(p.fromPersona)) throw new Error("only the persona that issued the port can confirm it");
```

`ownIds()` (`porting.ts:114`) is `SEED_VIEWER.personas ∪ ownPersonaIds()` — the device's whole own
set. `runRelationshipPort:133` already refused to create the port unless `own.has(fromPersona)`, so
this predicate is **true for every port in the vault**. It can only fail if the issuing persona later
leaves the device's own set. The acting persona is never consulted: the route's confirm branch calls
`confirmPort(String(body.portId ?? ""), …)` and does not touch `activeSeedPersonaId()`, which it
imports and uses everywhere else in the same file.

**The claim.** `notes/reports/REPORT-POST.md` Gate 0: "`confirmPort()` — which refuses an expired offer, refuses a
port that is not awaiting an answer, **refuses anyone but the issuing persona**, and refuses a second
answer once settled." Three of those four hold. The third does not.

**Exploit path.** Compartment mode on, device scoped to `@work`. Persona `@nsfw` issued a port to
counterpart `@c` weeks ago; `@c` has now proved the handle, so the port sits at
`awaiting-confirmation`.

1. `GET /api/x/port` (unscoped — F-3b) hands the caller the `portId`, both personas and both X
   handles.
2. `POST /api/x/port {"action":"confirm","portId":"port_…"}`.
3. `confirmPort` reaches `:242` and issues the `@nsfw → @c` whitelist linkage grant.

A real disclosure is made from a device that is supposedly scoped to a different persona, by a caller
acting as a persona with no relationship to the port. Compartment mode is documented as a
shoulder-surfing control (A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC), and this is a shoulder-surfing
scenario: the person at the keyboard is not the one who issued the port.

**What I would change.** `confirmPort(portId, accept, actingPersonaId)` with
`if (p.fromPersona !== actingPersonaId) throw …`, and the route passing `activeSeedPersonaId()`. Keep
the existing `ownIds()` check as a second condition — it is doing a different, also useful job.

---

## F-6 — `confirmPort` double-issue race

**Severity: medium** (low impact, but it falsifies a stated refusal)
**Type: (a) real defect**

**Where:** `lib/x/porting.ts:223–247`.

The status check (`:232`) and the grant issuance (`:242`) straddle an `await`, with the status write
(`:244`) after it. `load()` returns the same cached object (`:75`), so there is one shared `p` and no
lock.

- Two concurrent `{"action":"confirm"}` posts both observe `awaiting-confirmation` and both reach
  `issueGrant`: **two live whitelist grants** for the same pair, one `grantId` recorded, one orphaned
  and unrevokable through this surface.
- `confirm` racing `decline`: the decline can win the status write while the confirm's grant is
  already issued. The port reads `declined`, `resolvedAt` set, and the disclosure has happened. The
  receipt lies in the safe-looking direction, which is the worse direction.

The report's "a second answer on a settled offer is refused" holds only under serialization, which
nothing here enforces.

**What I would change.** Set a transient `p.status = "issuing"` synchronously before the `await`, or
keep a per-port in-flight set on the module global. Both are three lines.

---

## F-7 — the persona cookie's trust boundary widened from "your list" to "anything rendered", with no banner

**Severity: high** (deployment-dependent — see the note at the end)
**Type: (a) real defect, introduced by this pass**

**Where:** `lib/activePersona.ts:37–38`. The diff:

```diff
-  if (fromCookie && SEED_VIEWER.personas.includes(fromCookie)) return fromCookie;
+  if (fromCookie && (SEED_VIEWER.personas.includes(fromCookie) || personaById.has(fromCookie))) return fromCookie;
```

`personaById` is the global rendering map of every seeded persona in the store — not the caller's
personas. This pass also *grew* that map from three new places: `lib/validator.ts:46–55` registers
every roster persona of every root queried, `app/api/seed-persona/route.ts:35–41` registers on switch,
and `app/api/identity/fork/route.ts:118–121, 171–182` registers on fork. So the accepted set is now
"every persona this process has ever rendered or resolved", and it only grows.

**The in-code justification is a trust-the-client argument.** `:34–36`: "The cookie is only ever set by
`/api/seed-persona`, which checks ownership against the session's roster first." A cookie is
client-supplied. `/api/seed-persona` validating before it *sets* the cookie says nothing about what a
caller can *send*.

**Exploit path.** Set `layers_seed_persona=<any persona id in the store>` — a header, a console
`document.cookie`, an extension, a shared browser profile. Then `activeSeedPersonaId()` returns it,
and every route keyed on it acts as that persona:

- `GET /api/eventlog` → that persona's relationship log. That route's own docstring
  (`app/api/eventlog/route.ts:9–14`) says "The actor comes from the server session — there is
  deliberately no way to name someone else's log, and this is the only route that may return
  event-log material at all". The cookie is now a way to name someone else's log.
- `GET /api/folders` → their folders. `GET /api/delivery` → their tier map.
  `GET /api/influence?view=history` → `own: true`. `GET /api/feed2` → their timeline.
- `POST /api/delivery`, `POST /api/persona/chrome {"action":"tint"}` → writes attributed to them.

**The comparison that makes this a regression rather than a wash.** `VIEW_AS_COOKIE`
(`activePersona.ts:28–29`) already grants exactly this power, deliberately, for demos and tests — and
it is *surfaced*: `isViewingAs()` (`:43–46`) exists to drive a banner. `SEED_PERSONA_COOKIE` now grants
the same power with no banner and no equivalent predicate. The pass gave the silent cookie the loud
cookie's reach.

**What I would change.** Keep the widening — the bug it fixed (writes silently landing on the seeded
default) was real and worse — but bound it to the caller's own set rather than to the render map. Have
`/api/seed-persona` record accepted roster personas in a device-held own list (the keystore roster, or
a small module-level set), and have `activeSeedPersonaId()` check `SEED_VIEWER.personas ∪
ownPersonaIds() ∪ thatSet`. That preserves every fix in D-POST-1-ONE-ROSTER-ONE-TRUTH without making
the render map an authorization surface.

---

## F-8 — the two identity universes meet inside `currentScope()`; the scope narrows to nothing

**Severity: medium**
**Type: (a) real defect — the brief's question 3, confirmed in two places**

**Where:** `lib/search/unified.ts:85–101` and `:145`; `app/api/personas/act-as-options/route.ts:26`;
`app/api/personas/route.ts:16`.

`currentScope()` mixes the tracks:

```ts
const own = await ownPersonaIdsAll();      // SEED_VIEWER ∪ keystore        — the SEEDED track
const active = activeSeedPersonaId();      // anything in personaById (F-7) — either track
const sc = await viewScope(active, own);
return { personaIds: sc.unified ? own : [active], … };   // :96
```

A persona created through `POST /api/personas` lives in the **roster** track: `recordPersona(...)`
puts it in `rootRoster`, `personasForRoot` surfaces it in `session.personas` and (since this pass)
registers it in `personaById` — but nothing puts it in the keystore, so it is **not** in
`ownPersonaIdsAll()`. `/api/seed-persona:18` accepts it (it checks the session roster) and sets the
cookie; `activeSeedPersonaId()` returns it (`personaById.has`). So `active ∉ own` is reachable through
supported product flows.

**Consequence 1 — the search index empties silently.** With `active ∉ own`, `personaIds: [active]`,
and `collectRecords:145` does `all.filter((id) => scope.personaIds.includes(id))` → `[]`.
`GET /api/search/unified?status=1` answers `indexed: 0, personas: []`, `?browse=1` answers nothing, and
`scope.reason` says `"single"`. Failing shut is the right direction; failing shut *while reporting a
normal single-persona scope* is the wrong way to do it. Nothing in the response distinguishes "you have
no records" from "your active persona is outside the universe this scope was computed in".

**Consequence 2 — the act-as picker empties instead of narrowing.** `act-as-options:26` passes
`viewScope(activeId, [...SEED_VIEWER.personas, ...minted])`. Under compartment mode
`visiblePersonaIds = [activeId]`, and `options` is the intersection with the seeded+minted list — which
does not contain a roster persona. Result: `options: []`. That is precisely the bug Gate 2's iteration
2 says it fixed ("Compartment mode narrows a roster to its active persona; erasing it is a different
bug wearing the same clothes") — fixed in the layout, still present in this route through a different
track mismatch.

**Consequence 3 — the same shape in `/api/personas`.** `:16` passes `session.active?.id ?? ""`. A
session whose `active` is null under compartment mode gives `visible = {""}` and an empty switcher —
and an empty switcher is how you would normally *leave* compartment mode. The layout
(`app/(main)/layout.tsx:94`) uses a different fallback (`?? actingId`), so the two disagree on the same
condition, and the layout's fallback is a *seeded*-track id being filtered against a *session*-track
list, which empties too.

**What I would change.** Make `viewScope` assert its own precondition. It already never fails open
(it throws when the record is unreadable), so it is the right place:

```ts
if (!ownIds.includes(activePersonaId))
  throw new Error("view scope: the active persona is not in the roster it was scoped against");
```

That turns three silent wrong answers into one loud 503 at the chokepoint, and it forces the callers to
agree on which universe they are in — which is D-POST-1-ONE-ROSTER-ONE-TRUTH applied one layer up from
where Gate 1 applied it.

---

## F-9 — the tint roster is computed over two different sets

**Severity: medium**
**Type: (a) real defect, follows from F-8**

**Where:** `app/(main)/layout.tsx:87` vs `app/api/persona/chrome/route.ts:39`.

```ts
// layout
const tints = await tintsFor(own.includes(actingId) ? own : [...own, actingId]);
// route
const tints = await tintsFor(own);
```

With `active ∉ own` (F-8), the chrome paints a colour computed over `own + [acting]` while the settings
pane lists colours computed over `own` alone — and the acting persona is absent from the pane
entirely. Worse, `setTint` for that persona is refused `not_own` (`chrome.ts:182–184`), because the
route hands it `await ownIds()`. So the owner sees a colour on their own chrome that the tint editor
does not list and will not let them change, with a message saying it is not their persona.

`chrome.ts:140–142` states the guarantee this breaks: "The walk is deterministic (roster order,
palette order, skipping what is already taken), so the same roster always yields the same assignment —
a tint that moved between renders would be worse than no tint at all." It is deterministic *per
roster*; the two call sites pass different rosters.

**What I would change.** One helper — `chromeRoster()` — used by both, defined as whatever F-8's fix
settles on as "the device's personas".

---

## F-10 — "the sibling's records are never read" is stronger than what the code delivers

**Severity: low**
**Type: (c) a claim I would argue with, not a defect in the mechanism**

**The claim.** D-POST-2-THE-SCOPE-IS-THE-INDEX-NOT-A-FILTER: "the sibling's records are never read,
never embedded, and **never in the process memory a screen-share could reach**." `unified.ts:132–135`
repeats it.

**What the code does.** `collectRecords` (`unified.ts:140–213`) iterates the *whole* store and filters
per record: `for (const pp of s.privatePosts.values()) if (!ownSet.has(pp.authorPersonaId)) continue;`
and the same shape for `dmRequests`, `folders`, `edgeEvents`, `xImportedPosts`, `xImportedPrivate`.
`ownStakes()` (`lib/influence/allowance.ts:192`) returns the entire decrypted stake mirror before the
`ownSet` filter at `:192` of unified.ts. The store itself (`lib/adapters/mock/store.ts:123, 206`) is a
process-global that holds every persona's private posts and DMs at all times, and in the real direction
the decrypted vault holds everything for the root regardless of scope.

**What actually holds, and is the load-bearing part:** the *index* is built per scope, the caches are
keyed by scope (`unified.ts:118–123`), and `resetUnifiedIndex()` drops every scope's cache on a
compartment change (`app/api/persona/chrome/route.ts:94–95`). Those are real and I verified them. What
does not hold is the memory-capture claim — a screen-share sees rendered pixels either way, and a
memory capture sees the store and the vault either way.

§17 already has **A-POST-UNIFIED-INDEX-LIVES-IN-ONE-PROCESS** for the unified-*on* case ("a memory
capture taken while the view was on still has them"). The compartment case is stated absolutely and
should not be. I would narrow both sentences to the index, which is the claim the code earns.

---

## F-11 — the chrome cache is a process global with no root key

**Severity: low**
**Type: (b)/(c) — consistent with an existing unstated assumption, worth stating**

**Where:** `lib/identity/chrome.ts:59–60`, `:66`, `:113`.

`g.__layersPersonaChrome` is keyed by nothing. The same shape as `__layersInfluence`
(`allowance.ts:112–114`) and `__layersDeliveryTiers` (`tiers.ts:47`), so it inherits the existing
one-root-per-process assumption rather than creating it. But this pass put a **protection** in that
record. On a rig where `ROOT_COOKIE` can move the session to another root inside one process, the
cached `compartment` flag and tint map follow: root B inherits root A's compartment state, and
`save()` (`:111–118`) seals the merged doc back under whatever vault key the process holds. Only
`resetChromeCache()` from `/api/dev` (`app/api/dev/route.ts:513–518`) clears it, and that runs on seed
reset, not on a root switch.

**What I would change.** Either key the global on the session root, or add an explicit assumption to
§17 — "A-POST-CHROME-IS-ONE-ROOT-PER-PROCESS" — saying the compartment flag is a property of the
process's vault and not of the session. The second is honest and free; the first is better if
multi-root-per-process is ever real.

---

## F-12 — two nits

**F-12a — the padding quantum buckets the chosen-tint count.** `chrome.ts:113–116`:
`target = 1024 * Math.ceil((inner.length + 64) / 1024)`. A chosen tint is about 30 bytes of JSON, so
the sealed record steps 1 KiB → 2 KiB somewhere around thirty chosen tints. That is a coarse bucket,
not a count, and it is the same discipline used for `influence` and `deliveryTiers` — noting it only so
that §17's "one opaque padded record under one opaque key, so the operator cannot even read the
ADDRESSES as a sibling set" is read for what it precisely claims (addresses hidden) rather than as a
size claim it does not make.

**F-12b — a lapse message describing a path that cannot happen.** `porting.ts:230`: "that offer has
lapsed; **the counterpart can prove the handle again to raise a fresh one**". `confirmPort` has just
set `p.status = "expired"` (`:228`), and `resolvePendingPorts:199` only advances ports with
`status === "pending"`. Once a port lapses it can never be raised again by any path. Either the message
should say so, or `confirmPort` should reset an expired-on-arrival port to `pending` — and I would
pick the message, because a self-reviving offer is the thing Gate 0 was built to remove.

---

## Checked and found sound

These were attacked and held. Recorded with what was verified, because "not mentioned" and "checked"
are different claims.

1. **The tint is never published.** I traced every reference to `tint`, `washOf` and `TINT_PALETTE`
   across `app/`, `lib/` and `components/`. The value reaches exactly three destinations: the sealed
   `personaChrome` vault record (`lib/vault/vault.ts:100–107` registers the namespace;
   `chrome.ts:113–117` encrypts before `flushVault`; `lib/adapters/mock/persist.ts:109` lists it as an
   extra namespace), `/api/persona/chrome`'s own responses and the fork response, and the
   `data-tint` / CSS-custom-property attributes the layout renders
   (`app/(main)/layout.tsx:100–102, 162–167`). Nothing writes it into a cast, a grant, a crosspost, a
   lens, an algo artifact, a profile or any validator payload. **The brief's question 6 is answered
   in the affirmative for the network.** The failure found (F-1/F-2) is about who on the *device* can
   read it, which is a different claim than the one §17 makes about publication.
2. **The compartment/unified interlock.** `chrome.ts:293–306`: entering compartment forces
   `unified = false`; `setUnified(true)` while compartment is held throws, and the route converts that
   to a 409 rather than swallowing it (`app/api/persona/chrome/route.ts:78–86`); leaving compartment
   does not restore `unified`. I grepped for every writer of the chrome doc — there is no second path
   that sets `unified` or `compartment`. D-POST-2-LEAVING-COMPARTMENT-RESTORES-NOTHING holds exactly
   as written.
3. **Fail-closed on an unreadable chrome record.** `chrome.ts:63–108`: three attempts with backoff, a
   `vault`-flavoured error breaks out immediately rather than retrying a permanent failure, and
   `doc.loaded === false` **throws** instead of returning `{tints:{},unified:false,compartment:false}`.
   `save()` (`:111–112`) refuses to seal over a doc it never loaded. `lib/delivery/tiers.ts:50–98` does
   the same for the tier map, with the right reasoning recorded (un-quieting is the dangerous
   direction). This is the "never fail open" rule applied correctly, and the asymmetry
   (D-POST-2-THE-TINT-FAILS-OPEN-AND-ONLY-THIS-FAR) is implemented as described: the layout catches and
   renders untinted (`layout.tsx:96–98`), the routes do not catch and answer 503.
4. **`pin` and `banner` cannot be imported.** `lib/algo/artifact.ts:181–190` still allowlists exactly
   `["hide","downrank","flag"]` and names the two new actions in the refusal text. I looked for a
   second sanitizer, and for any path that builds a `Rule` from imported JSON without passing
   `sanitizeArtifact` — there isn't one. The compiled delivery rules
   (`lib/delivery/tiers.ts:196–222`) are constructed in-process per feed build and never written
   through `adapters.rules`, so they cannot be exported and re-imported either.
5. **The delivery tier map's storage and shape.** One sealed padded record under key `_`
   (`tiers.ts:89–98`), namespace registered in both `VAULT_NAMESPACES` (`vault.ts:107–108`) and
   `ExtraNamespace` (`persist.ts:109`). `listNonNormal()` is the complete non-normal set *by
   construction* — `setTier` deletes the key when the tier is `normal` (`tiers.ts:167–169`), so nothing
   is being filtered out of a larger structure. The account genuinely never enters a rule: every clause
   `compileDeliveryRules` emits compares `delivery.tier` or `author.cluster`, and `lib/feed.ts:538`
   resolves the author's tier exactly once into the evaluator context. There is no second filtering
   path.
6. **Tier placement semantics.** The delivery keys sit below the demote key in the feed's final sort,
   so a sunk or curator-flagged author stays sunk. Pins are selected from `eligible` after the hide
   pass, one per author, capped at `Math.max(1, floor(limit/4))`, and `pending` excludes them so the
   page does not grow. `previewStrip` is drawn from `eligible`, never from a backfill.
   A-POST-DELIVERY-IS-ATTENTION-NOT-ACCESS is accurate: a tier changes placement and nothing about it
   reaches the account it is set on.
7. **`rosterExport` is dev-gated.** `app/api/zk/route.ts:36–93` — `rosterExport` is in `DEV_ACTIONS`
   and refused with 403 unless `ZK_DEV_HOOKS=true`. The whole-roster export is not a shipped surface.
   (`gateStatus` is *not* gated, but it only echoes eligibility for a caller-supplied `personaIds`
   list, so it discloses nothing about which personas are the caller's.)
8. **No second route still on the old port path.** `resolvePendingPorts` (`porting.ts:193–212`) no
   longer calls `issueGrant` — the diff removed it — and it has exactly one caller,
   `lib/x/attestations.ts:98–99`. I grepped every `issueGrant` call site in the tree:
   `app/api/identity/grant`, `lib/x/altlink.ts:168`, `porting.ts:168` (issuer-initiated) and
   `porting.ts:242` (`confirmPort`). There is no surviving path from "prove the handle" to "grant
   issued". Replay and status-confusion also hold: a `declined` or `expired` port can never be raised
   again, because `resolvePendingPorts:199` requires `status === "pending"`, and a second prover cannot
   overwrite `counterpart.personaId` for the same reason. The expiry boundary is consistent
   (`<= Date.now()` in all three of `resolvePendingPorts`, `confirmPort` and `portStatus`). The offer
   inherits the port's original 30-day window rather than getting a fresh one from `matchedAt`, which
   REPORT-POST states deliberately ("the 30-day lapse stays as the offer's outer bound") — so that is a
   choice, not a bug, though it means a handle proved on day 29 leaves the issuer hours to answer.
9. **Clone artifact semantics.** `copySettings` creates rules first and maps old rule ids into the
   clone's modes (`clone.ts:73–105`), clears `pinnedPersonaId`, forces `activationEnabled: false`, and
   skips presets. All three of D-POST-1-COPY-ARTIFACTS-NOT-REFERENCES,
   D-POST-1-A-COPIED-MODE-NEVER-ARRIVES-ARMED and the preset exclusion are implemented exactly as
   described. Nothing is copied by reference. And on the brief's question 5, second half: the clone
   lands under `sessionRoot ?? rootForFid(self) ?? source.rootId` (`fork/route.ts:197`) — the caller's
   root takes precedence, so a clone cannot be planted under a root the caller does not control. The
   first half of that question is F-4.
10. **`npx tsc --noEmit` is clean on HEAD** (exit 0). Nothing in this review was derived from a type
    error, and none of the findings are compile-visible — which is itself worth saying, since every one
    of F-1, F-3 and F-5 is a *correct program* doing the wrong thing.

---

## The deployment note that sets severity

F-1, F-4 and F-7 are rated on the rig / preview shape, where the app server holds the seeded keystore
and answers `/api/*` for whoever holds the cookie (`app/(main)/layout.tsx:115–126` describes exactly
this split). On a public deployment `isPublicDeployment()` makes the device the page and each visitor
runs their own root, which narrows F-4 and F-7 to "the person at the keyboard can act as personas they
do not own on their own device" — still wrong, much less interesting.

F-1, F-2, F-3, F-5, F-8 and F-9 are **not** narrowed by that, because compartment mode's own threat
model (A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC) is explicitly "a shoulder-surfing and screen-share
control" — i.e. an adversary who *is* at the owner's device, in the owner's session, which is the
adversary all six of those findings assume.

## The one structural recommendation

Six of the twelve findings are the same shape: a set of own persona ids reaches a response without
passing the chokepoint. `viewScope()` is a good chokepoint and it is well built — it fails closed, it
has one clear contract, and where it is called it does the right thing. The problem is that calling it
is optional and the grep for "did you call it" does not exist. `ownPersonaIdsAll()` is the actual
chokepoint, because it is where the set comes from. Rename it, add a scoped sibling, and make the
unscoped name the thing the sweep greps for — the same move Gate 0 already made for the vault
(D-POST-0-THE-NEEDLE-IS-GENERAL-NOT-A-LIST), applied to the roster.
