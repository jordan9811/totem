# Post-deploy pass — Gate 5: every review finding, dispositioned

Each finding from the three adversarial reports was re-checked against the tree by an
INDEPENDENT verifier that did not have the report, was handed only a self-contained
restatement of the claim, and was told to be adversarial about any fix it found and to try
to defeat it before calling it closed.

**47 findings: 24 PARTIAL, 4 FIXED, 19 OPEN.**

PARTIAL means a fix landed and a reachable gap remains. The residual is stated in full,
because a half-fix reads exactly like a whole one from the outside — and several of these
are residuals inside fixes written earlier in this same gate.

| id | status | severity |
|---|---|---|
| F-1 | PARTIAL | critical as filed; the remaining gap on the same route is medium |
| F-1 | PARTIAL | critical |
| F-1 | PARTIAL | high (reported critical; blast radius narrowed from 4 trigger tiers to 1, impact unchanged when it fires) |
| F-2 | PARTIAL | high |
| F-2 | FIXED | high |
| F-3 | FIXED | high |
| F-3 | PARTIAL | medium (downgraded from high: the fail-open direction the posture singles out — quiet — is genuinely closed; what remains is banner/never-miss placement) |
| F-3a | PARTIAL | high |
| F-3b | PARTIAL | high |
| F-3c | PARTIAL | high |
| F-3d | PARTIAL | high as filed; residual is medium (one sibling identifier, not the roster) |
| F-3e | PARTIAL | high (as filed); residual gap is medium |
| F-4 | FIXED | high |
| F-4 | PARTIAL | high |
| F-4 | PARTIAL | high (as filed); the residual gap that remains is medium |
| F-5 | OPEN | high |
| F-7 | PARTIAL | medium (re-assessed down from high) |
| F-10 | PARTIAL | medium (residual is narrower than the original: low-medium) |
| F-11 | FIXED | medium |
| F-12 | OPEN | medium |
| F-15b | OPEN | low (structurally; it is the enabling half of a medium rollback path) |
| F-2 | OPEN | medium |
| F-5 | OPEN | medium |
| F-5 | OPEN | medium |
| F-6 | OPEN | medium |
| F-6 | PARTIAL | medium as filed; the surviving residual is low (documentation-only, no exploit path) |
| F-6 | OPEN | medium |
| F-7 | PARTIAL | medium |
| F-7 | PARTIAL | low (originally reported medium; the reported 0.2 dE path is closed, the surviving path is narrower) |
| F-8 | PARTIAL | medium |
| F-8 | PARTIAL | medium |
| F-8 | PARTIAL | medium |
| F-9 | OPEN | medium |
| F-9 | OPEN | medium |
| F-9 | PARTIAL | medium |
| D-1 | OPEN | low |
| F-10 | OPEN | low |
| F-10 | OPEN | low |
| F-11 | PARTIAL | low |
| F-11 | OPEN | low |
| F-13 | PARTIAL | low |
| F-14 | OPEN | low |
| F-12 | OPEN | nit |
| F-12a | PARTIAL | nit |
| F-12b | OPEN | nit |
| F-13 | OPEN | nit |
| F-15a | OPEN | nit |

---

## F-1 — PARTIAL (critical as filed; the remaining gap on the same route is medium)

**Evidence.** GET is fixed in the current tree (uncommitted working-tree change on top of a9d0b3d). C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\persona\chrome\route.ts lines 44-57 now read:

  44: const tints = await tintsFor(own);
  45: const visible = new Set(scope.visiblePersonaIds);
  ...
  51:   tints: own
  52:     .filter((id) => visible.has(id))
  53:     .map((id) => ({ ...tints[id], handle: personaById.get(id)?.handle ?? id, wash: washOf(tints[id].color) })),

Line 52 is decisive: the enumerated answer is intersected with scope.visiblePersonaIds, which lib/identity/chrome.ts:305 sets to `compartment ? [activePersonaId] : ownIds`. The assignment still walks the whole roster (required, since "a colour no sibling holds" is not computable per-persona), but only the ANSWER is narrowed. I tried to defeat it: (a) `scope` is still in the body, but under compartment it carries only [activePersonaId]; (b) if the active persona is not in ownPersonaIdsAll() the filter yields [] — it fails closed, not open; (c) viewScope throws rather than defaulting, and the catch answers 503 (line 60), so an unreadable chrome record does not fail open; (d) the renderer components/settings/PersonaTintPane.tsx:35-48 takes its whole list from j.tints, so the settings page now shows only the visible set; (e) the page's other pane is scoped too — app/api/personas/bindings/route.ts:23-25 filters through visibleOwnPersonaIds(). The header comment's claim (route.ts:11-13) is now true for GET.

What is NOT fixed is the POST half of the same route, which never consults scope or ownership at all — app/api/persona/chrome/route.ts lines 76-81:

  76: if (body.action === "clearTint") {
  77:   await clearTint(String(body.personaId ?? ""));
  78:   const own = await ownIds();
  79:   const tints = await tintsFor(own);
  80:   return NextResponse.json({ ok: true, tint: tints[String(body.personaId ?? "")] ?? null });

`tints` is built from `own` (the unscoped roster), not from scope.visiblePersonaIds, and clearTint (lib/identity/chrome.ts:242-250) does no ownership check before mutating doc.tints.

**Residual.** Same route, POST path, compartment mode ON. `POST /api/persona/chrome {"action":"clearTint","personaId":"persona_viewer_alt"}` returns `{ok:true, tint:{personaId:"persona_viewer_alt", color:"#xxxxxx", source:"auto"}}` — a non-active sibling's stable persona id and accent colour, from the route that implements compartment mode, while compartment mode is on. A non-own id returns `tint: null`, so the call is a clean membership oracle: non-null means "this is one of the device's personas". The candidate ids need not be discovered from the now-scoped GET — the seeded roster ids are static repo constants (seed/data/viewer.json: "persona_viewer_main", "persona_viewer_alt", reached via SEED_VIEWER.personas in lib/influence/allowance.ts:124-128), so the seeded siblings are enumerable by guessing, and any suspected keystore-minted id can be confirmed. Handles are the one thing this path does not return (the GET added those). It is also a cross-persona WRITE: clearTint deletes that sibling's chosen tint before the read, with no ownership test, so the oracle is destructive. Fix shape: build the answer from scope.visiblePersonaIds (or visibleOwnPersonaIds()) and reject personaId outside it, the way `setTint` at line 68 at least rejects non-own ids.

Two things I decided are NOT residual defects: (1) `POST {"action":"compartment","on":false}` turns the protection off from any script in the session and then returns the full roster — but that is identical to the user tapping "Leave compartment mode" in PersonaTintPane, i.e. inherent to a device-local mode aimed at incidental disclosure on a shared screen, not at a hostile operator holding the device; (2) the active persona's AUTO colour is assigned by roster position (lib/identity/chrome.ts:167-197), so under compartment it weakly leaks a lower bound on sibling count — the route comment at lines 39-43 already acknowledges the assignment must walk the whole roster, and no id or handle escapes.

## F-1 — PARTIAL (critical)

**Evidence.** FIXED HALF — lib/identity/chrome.ts:89-92 (and the twin at lib/delivery/tiers.ts:69-73) now refuse "records present, none readable":

  89	        if (!rec)
  90	          throw new Error(
  91	            "vault: personaChrome holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
  92	          );

I confirmed this throw actually escapes: the message contains "vault", so the catch's `if (String((e as Error).message).includes("vault")) break;` (chrome.ts:107) fires immediately, `doc` remains the initializer `{...EMPTY, tints:{}}` with loaded:false, and the terminal `if (!doc.loaded) throw` (chrome.ts:113-118) runs. `save()` is unreachable on this path. Attempts to defeat it: a mis-addressed record (vault.ts:169 `if (rec.ns !== ns || rec.id !== id) continue;` after `attempted++` at :164) and a truncated/tampered record both drive `attempted > 0 && recovered === 0` and make decryptNamespace throw at vault.ts:180-182, which also contains "vault". The one bypass left is a truthy non-object `plain["_"]` (a bare string passes `!rec`, then `rec?.m ?? {}` yields the empty doc with loaded:true) — but producing it requires a valid AES-GCM seal at address (ns,"_") under the real vault key, which the untrusted validator does not hold. Not operator-reachable.

RESIDUAL 1, SAME TWO FILES — the report's second case (row deletion) is NOT closed, and the real mechanism is more direct than the report states. validator/server.js:503-514 never returns 404 for a missing namespace; it returns 200 with `{ entries: {} }` ("const entries = {}; for (const r of rows) entries[r.key] = JSON.parse(r.value); res.json({ entries });" at :511-513). So a DELETE of the adapter_state rows lands on the empty branch, chrome.ts:100-102:

 100	      } else {
 101	        doc.loaded = true;
 102	      }

(tiers.ts:74-75 is identical) — producing exactly the forged document the finding names: `{ tints: {}, unified: false, compartment: false, loaded: true }` and `{ tiers: {}, loaded: true }`. viewScope() then returns reason:"single" with all sibling ids visible, and save() — which refuses only `!doc.loaded` (chrome.ts:122) — ratifies the emptiness. The dead 404 branch (chrome.ts:74-77, tiers.ts:57-58) does the same. Report's supporting fact (a) confirmed and still load-bearing: markSealed is called only at lib/adapters/mock/persist.ts:373 inside flush(), never in flushVault() (:393-411), so sealedNamespaces() is empty for every vault-whole namespace; fact (b) confirmed: hydrate() iterates SERIALIZERS at lib/adapters/mock/store.ts:712, typed `Record<Namespace, Serializer>`, so its sealed-vs-plaintext guard at :725 cannot reach these ExtraNamespace loaders.

RESIDUAL 2 — five modules the report named as owed the same check are untouched, still carrying the ORIGINAL defect verbatim. lib/zones/store.ts:39: "doc = { devices: rec?.m?.devices && typeof rec.m.devices === \"object\" ? rec.m.devices : {}, loaded: true };" with no `!rec` guard above it. Same shape at lib/influence/allowance.ts:75-76, lib/x/porting.ts:86-87, lib/zk/anonAttribution.ts:68-69, lib/attest/vault.ts:28-29, plus lib/fc/personaFid.ts:68-69 and lib/identity/rootRoster.ts:89-91. Two are worse than the pattern: lib/zk/anonAttribution.ts loses the only proof this device authored a past anon post (its own header, :53-55), and lib/attest/vault.ts:7-36 catches EVERY error including decryptNamespace's wrong-key throw, returns `{ items: [] }`, and its save() (:39-46) has no `loaded` guard at all.

**Residual.** Two reachable paths remain. (1) In the two files the claim names, the operator deleting the adapter_state rows for `personaChrome`/`deliveryTiers` still yields `{tints:{},unified:false,compartment:false,loaded:true}` / `{tiers:{},loaded:true}` via the `} else { doc.loaded = true; }` branch (chrome.ts:100-102, tiers.ts:74-75), because the validator answers a missing namespace with 200 `{entries:{}}` rather than 404 (validator/server.js:511-513) and no device-local marker distinguishes "deleted" from "never written" — flushVault never calls markSealed (persist.ts:393-411 vs :373), so sealedNamespaces() is empty for these namespaces and no loader consults it. Compartment mode silently turns off, every quieted account is un-quieted, and save() ratifies it. This is not inherent: SECURITY-POSTURE.md:143-146 records the identical finding (attack-3 F-3) being fixed by pinning the anchor device-side in .keystore/zk-pins.json; the same remedy is simply not wired to the vault-whole namespaces. (2) The original "entries present, `_` unreadable" input still produces a forged-empty document that save() seals over the real record in lib/zones/store.ts:39, lib/influence/allowance.ts:75-76, lib/x/porting.ts:86-87, lib/attest/vault.ts:28-29, lib/zk/anonAttribution.ts:68-69, lib/fc/personaFid.ts:68-69 and lib/identity/rootRoster.ts:89-91 — five of which the report named explicitly.

## F-1 — PARTIAL (high (reported critical; blast radius narrowed from 4 trigger tiers to 1, impact unchanged when it fires))

**Evidence.** Both halves of the claim were re-read in the current working tree (the fix is uncommitted — `lib/delivery/tiers.ts` and `lib/feed.ts` are both `M` against 6229339).

(1) CHANGED — `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\delivery\tiers.ts`, compileDeliveryRules at lines 220-253. Each tier rule is now emitted only if that tier is in use, and the facet-only rule is guarded by an early return:
  tiers.ts:235  `if (!tiersInUse.has("facet-only")) return rules;`
The `author.cluster` clause (tiers.ts:248) is only reachable past that line. The single caller passes the live tier set, scoped to the mode:
  feed.ts:412  `deliveryRules = deliveryMap.size ? compileDeliveryRules([...allowed], new Set(deliveryMap.values())) : [];`
`compileDeliveryRules` has exactly one production caller (feed.ts:396/412; the only other hit is a string match in scripts/accept-pd3.mjs:323). So never-miss, banner and quiet no longer blank the live timeline — that part of the finding is genuinely closed, not commented closed.

(2) UNCHANGED — `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\feed.ts` lines 671-682. The probe still scans the same `rules` array that `rules.push(...deliveryRules)` (feed.ts:418) fills, with no id-prefix or synthetic marker filter (grep for `delivery:` in feed.ts returns nothing):
  feed.ts:673  `const authorHideRuleExists = rules.some((r) => r.action === "hide" && referencesAuthor(r.root));`
  feed.ts:682  `if (!att && authorHideRuleExists) return false; // unknowable author under an author rule: hidden`
`referencesAuthor` (feed.ts:671-672) still recurses into nested groups, so the compiled `delivery:facet-only` rule — the only `hide`-action rule compileDeliveryRules emits, and the only one carrying an `author.*` clause — still sets the flag whenever it is compiled.

Attempts to defeat / confirm reachability: `setTier` (tiers.ts, the `no_facet` branch) refuses `facet-only` when no facet of that account's root is followed, and `app/api/delivery/route.ts` POST (line 93) really does resolve `facets` from live disclosure state before calling it — so facet-only is not settable out of thin air. It IS settable the moment the viewer follows any one facet of that account's root, which is the feature's normal use. I could not find any path that re-emits the facet-only rule without a facet-only tier, and no other caller reintroduces it.

**Residual.** Two reachable paths remain, both through the one tier the fix did not cover:

1. Normal use. Follow one facet of account A's root, then set A to `facet-only` (POST /api/delivery with the facet followed — the route supplies `facets`, so setTier accepts). compileDeliveryRules now passes tiers.ts:235, emits `delivery:facet-only` with its nested `author.cluster` clause, feed.ts:673 goes true, and feed.ts:682 drops every live cast with no attribution — i.e. every stranger, which is nearly the whole neynar timeline. `cards` is then replaced wholesale by that near-empty `ranked` list and the user gets the empty-state UI. One preference on one account, a blank timeline — the original finding verbatim, minus three of its four triggers.

2. Sticky after unfollow. The `no_facet` refusal is a write-time check only; nothing re-validates or clears a stored `facet-only` row when the facet is later unfollowed (`facet-only` appears nowhere outside lib/delivery/tiers.ts except UI labels and a type union). Unfollow the facet and the tier persists, `allowedClusters` collapses to `[" none"]` (tiers.ts:248), the rule still compiles, the blanking persists — and now account A is hidden outright too.

The fail-closed justification does not cover this case. The compiled rule's root is an AND whose first clause is `{ field: "delivery.tier", op: "eq", value: "facet-only" }`, and feed.ts:702 sets `delivery: { tier: att ? deliveryOf(att.id) : "normal" }` for an unattributed stranger. The stranger's delivery tier is knowably "normal", so the rule could never fire on them; the author clause is unreachable for exactly the posts the probe uses it to hide. The probe is a false positive here, not a conservative read. Closing it: exclude compiled rules by their `delivery:` id prefix (or a `synthetic: true` marker) at feed.ts:673, or make `referencesAuthor` only count an author clause that is reachable given the clauses the evaluator can decide for an unattributed cast.

## F-2 — PARTIAL (high)

**Evidence.** lib/device/boot.ts:153-195 — `reloadIdentity()` was rewritten since the review and now carries a GATE 5 (attack-post-3 F-2) block that resets eleven caches: `resetChromeCache()` (170-171), `resetDeliveryCache()`, `resetReadwiseStateCache()`, `resetZonesCache()`, `resetPortsCache()`, `resetInfluenceCache()`, `resetAttestationVaultCache()`, `resetUnifiedIndex()`, `resetActable()`, `resetAnonAttributionCache()`, `resetSessionHandlesCache()`, plus the original five. The chrome half of the report is closed: `lib/identity/chrome.ts:144-146` `export function resetChromeCache(): void { g.__layersPersonaChrome = undefined; }` is now called on the unlock path, so root B no longer runs on root A's compartment flag or tint map. `lib/adapters/mock/store.ts:899-907` `reloadForDevice()` is unchanged and still resets only mock state / hydration / flush cache / local store / ephemeral session, as reported.

The gap is the one sealed namespace the new list omits. Decisive line, lib/fc/personaFid.ts:54: `  if (g.__layersPersonaFids) return g.__layersPersonaFids;` — and its reset, lib/fc/personaFid.ts:168-171, is wired to exactly one caller: `/** resetSeed: the validator's copies were just wiped — the in-process record must not outlive them */ export function resetPersonaFidCache(): void { g.__layersPersonaFids = undefined; }`. A repo-wide grep for `resetPersonaFidCache` returns only that definition and `app/api/dev/route.ts:546-547`. `reloadIdentity()` never calls it, and `bootIdentity()` (boot.ts:53-152) does not clear it indirectly.

`personaFids` is a real sealed vault namespace (lib/vault/vault.ts VAULT_NAMESPACES, entry "personaFids", whose own comment says the records hold "custody address, signer reference — a Neynar signer uuid is a secret —, registrant, funder"), and `save()` (personaFid.ts:85-98) calls `encryptNamespace(VAULT_NS, …)` whose key defaults to `vaultKeyBytes()` evaluated at call time (lib/vault/vault.ts:134-138), i.e. root B's key, then `flushVault(VAULT_NS, sealed)` to root B's record.

Also still stale: app/api/dev/route.ts:192-228 `simulateDeviceLoss` — the block whose comment cites "attack-mega-2 F2" still resets only `resetPortsCache`, `resetUnifiedIndex`, `resetEmbedWorker`, `resetZonesCache`, `resetInfluenceCache` (lines 217-226), i.e. none of the eight caches added since, exactly as the report said. The proposed durable fix was not taken: `lib/vault/caches.ts` does not exist (lib/vault/ contains only vault.ts), and boot.ts:169-170 admits the invariant is comment-enforced: "The sealed caches are listed here and in /api/dev resetSeed, and the two lists have to stay in step" — they are already out of step by `personaFids`.

**Residual.** Reachable, unchanged in shape, on the `personaFids` namespace. Under root A, any ordinary read warms the cache — GET /api/fc/persona (`personaFidMap()` / `allPersonaFids()`, app/api/fc/persona/route.ts:40-43) or feed rendering via `publicProfileForFid` → `personaOfFid` → `load()` (lib/feed.ts:828). Then unlock or import a different seed: `lib/device/custody/index.ts:66-72 installSeed()` → `boot.reloadIdentity()`, or `lib/device/linking.ts:157-160` after `installLinkedRoot`. `/api/fc/persona` is served in-process by the device (lib/device/routes.generated.ts:48, r45), the same globalThis that holds `__layersPersonaFids`, so after the reload `load()` returns root A's doc without a fetch or decrypt. The first write — POST /api/fc/persona with the record action → `recordPersonaFid` (route.ts:162-163 → personaFid.ts:154-160), or `nextFixtureFid()` (personaFid.ts:147-153) on a fixture-fid mint, or `forgetPersonaFids()` — calls `save(doc)`, which seals root A's items under root B's vault key and PUTs them over root B's `personaFids` record: root A's fids, custody addresses and Neynar signer uuids land readably inside root B's vault, and root B's own record is destroyed. Three attempted defeats of the fix all fail to stop it: (1) the retry/refusal path in `load()` never runs, because the cache short-circuits before `fetchState`, so the "wrong key throws loud" protection is bypassed; (2) the `if (!doc.loaded) throw` guard in `save()` (personaFid.ts:86) passes, because root A's document was genuinely loaded; (3) there is no root binding to catch the mismatch — `PersonaFidRecord` (personaFid.ts:25-38) carries personaId/fid/custodyAddress/signer but no rootId, and neither `save()` nor `flushVault` compares the doc's origin root to the current one. Fix: add `const { resetPersonaFidCache } = await import("@/lib/fc/personaFid"); resetPersonaFidCache();` to the boot.ts:169-192 block, and bring `simulateDeviceLoss` onto the same list — ideally via the single exported registry the report proposed, since the comment-enforced "two lists" invariant has already failed once here.

## F-2 — FIXED (high)

**Evidence.** The corpus sort no longer carries the quiet terms. Current `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\feed.ts` lines 563-573 (decisive line 566):

    eligible.sort((a, b) => {
      const ta = tierOf(a.authorPersonaId, personaById.get(a.authorPersonaId)?.tier ?? 1);
      const tb = tierOf(b.authorPersonaId, personaById.get(b.authorPersonaId)?.tier ?? 1);
      return rankScore(b, mode, following, tb) + lensTermFor(b, tb) - (rankScore(a, mode, following, ta) + lensTermFor(a, ta));
    });
    // GATE 5 (attack-post-2 F-2): the quiet penalty is NOT applied here ...

`git diff -- lib/feed.ts` confirms this is a real code change, not just a comment: the removed lines are `-    const qa = quieted.has(a.hash) ? QUIET_PENALTY : 0;` / `-    const qb = ...` / `- ... - qb - (... - qa)`. So the fix is in the working tree (uncommitted on top of 6229339), and the shipped device bundle agrees: `public\device\device.js` has `quieted` only at 60563/60595/60674/60794-60795, with `QUIET_PENALTY2` assigned at 60486 and never used in a sort.

Quiet now lives only in the final in-window sort, lib/feed.ts 946-948:
      const qa = a.cast && quieted.has(a.cast.hash) ? 1 : 0;
      const qb = b.cast && quieted.has(b.cast.hash) ? 1 : 0;
      if (qa !== qb) return qa - qb;
— a 0/1 tiebreak below the demote key (932) and the pin key (945), inside a comparator that reorders and never removes.

Attempts to defeat the fix, all failed:
1. Window selection: the diversity walk (lib/feed.ts 578-607, `while (ordered.length < limit && pending.length > 0)`) draws from `pending` in corpus-score order and has no quiet awareness, so a quiet post now competes on merit and enters the top 40 at its natural rank.
2. Live path: the live window is cut at `.slice(0, opts.limit ?? 40)` (line 733) after a sort on `liveScore` (lines 713-722), which contains only recency/engagement/calm/longform terms — no quiet term. `quieted` is populated for live casts at line 707 for the final sort only.
3. Truncation after the final sort: nothing trims `cards` by `limit` after line 950. The only `limit` uses in the file are 245, 570 (comment), 578, 591, 603, 652, 733 — none downstream of the sort. The tail returns `injectIntoFeed(cards, ...)` at 1464/1474, which splices items in rather than cutting.
4. Caught-up path: `const fresh = cards.filter(isNew)` (1425) does drop cards, but purely on `lastVisit` timestamps (1413-1424); it is blind to `quieted`, so a fresh quiet post survives above the banner.
5. `QUIET_PENALTY` (still exported as 1000 at lib/delivery/tiers.ts:260) is now dead in the app: the only non-bundle references are the import and assignment at lib/feed.ts:394-397, and nothing reads the variable. No other caller in the repo uses it.

One adjacent observation, NOT this defect: the quiet key sits inside the `try` that opens at lib/feed.ts:782 with `await withRetry(() => adapters.identity.visiblePrivatePosts(personaId))`; if that read throws past its retries, the `catch` at 951 swallows it and the whole final sort is skipped, so quiet (and demote and pin) simply does not apply that build. That is a fail-OPEN on ordering, the opposite of F-2's hide, and it equally affects demote — worth its own finding rather than reopening this one.

## F-3 — FIXED (high)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\colorVision.ts:41 now reads:
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
and scripts\accept-pd2.mjs:91 carries the identical corrected row. Both changes are in the working tree, uncommitted (git diff vs a9d0b3d shows exactly these two lines plus an 8-line GATE 5 comment at colorVision.ts:31-38).

Verified offline (pure arithmetic in Node, no server/ports/accept scripts):
- All four SIM rows sum to 1.000000; scanning 584,064 simulated channel samples over the RGB cube gives zero channels > 1.0, max exactly 1.000000, so claimed consequence (1) (L* > 100 via the one-sided clamp) is no longer reachable for hex input.
- Claimed consequence (2) is closed: separation("#6a07f9","#1d9bf0") = 4.12 deuteranopia (was 12.4); #631af5 -> 4.54, #6409f4 -> 4.82, #6318f2 -> 5.10. All < MIN_SEPARATION = 12 (colorVision.ts:78), so setTint returns {ok:false, code:"collides"} at chrome.ts:222.
- Shipped palette unharmed: worst pair #0f5c3a/#536471 at dE 15.05 under protanopia, matching the report.

Bypass attempts that failed: every writer of doc.tints routes through setTint (app/api/persona/chrome/route.ts:68, app/api/identity/fork/route.ts:325 and :338); clearTint only deletes. HEX = /^#[0-9a-f]{6}$/i (chrome.ts:65) with parseInt base 16 makes uppercase input equivalent and the stored value is lowercased, so no case-aliasing. tintsFor's collides() (chrome.ts:184) uses the same corrected separation, so auto-assignment and the explicit gate agree. No third copy of the matrix exists outside colorVision.ts, accept-pd2.mjs and the docs.

Non-exploitable residue worth logging, not a reachable gap: linearToSrgb (colorVision.ts:20) still clamps one side only -- `Math.max(c, 0)` -- so gamut safety now rests entirely on rows summing to 1, and nothing asserts that. None of the four recommended invariants (row sums 1.0 +/- 1e-9, no channel > 1.0, deuteranopia/protanopia rows 0 and 1 the same R/G mixture up to a scalar, one hard-coded external dE) was added anywhere in scripts/, and there is no regression test pinning a known-indistinguishable hand-picked pair to a refusal -- pd2's only negative tint test (accept-pd2.mjs:336) reuses a sibling's exact colour, which any matrix rejects. pd2 remains a hand transliteration of the same arithmetic, so the same blind spot would reproduce on the next mistranscription. Finally, the header at colorVision.ts:15-17 still claims the suite "carries its own independent copy of this arithmetic on purpose" while lines 36-38 concede that independence did not hold.

## F-3 — PARTIAL (medium (downgraded from high: the fail-open direction the posture singles out — quiet — is genuinely closed; what remains is banner/never-miss placement))

**Evidence.** Analysed against lib/feed.ts at md5 27d7447f72d2ead781cab4c5c087184d (1507 lines; the file was edited mid-session from 1466 lines, so all line numbers below are from that snapshot, re-confirmed against the working copy).

WHAT IS FIXED. The core of the claim is no longer true. lib/feed.ts:702 now puts the delivery key in the LIVE context, under a comment naming this very finding (lib/feed.ts:684 "GATE 5 (attack-post-2 F-3): the live path gets the SAME delivery context as the seeded one"):

    lib/feed.ts:702    delivery: { tier: att ? deliveryOf(att.id) : "normal" },

`deliveryOf` (lib/feed.ts:414) reads the per-mode map keyed by persona id, and `att.id` is a persona id, so an attributed live cast resolves its real tier. fieldValue therefore returns the tier string rather than null (lib/rules/evaluate.ts:56-57 `case "delivery.tier": return ctx.delivery?.tier ?? null;`), and the compiled eq-rules match. Two of the four tiers now really act on live casts:
- quiet: lib/feed.ts:707 adds the live hash to `quieted`, and `quieted` is read in the FINAL sort at lib/feed.ts:946-947, which runs after the live merge. Working.
- facet-only: it is a `hide` rule (lib/delivery/tiers.ts compileDeliveryRules), evaluated for live casts at lib/feed.ts:709 with `author.cluster` populated from `personaById.get(att.id)`. Working.

The second half of the claim (pinSet/previewStrip frozen from seeded hashes) was ALSO seen and back-filled, at lib/feed.ts:875-912, again self-documented: "giving the LIVE path a delivery context fixed quiet ... and did NOT fix pin or banner, because both were frozen from the SEEDED corpus a hundred lines above".

WHY IT IS STILL PARTIAL. I attacked that back-fill and it does not hold for `banner`. The back-fill only APPENDS into structures the seeded pass already filled to their caps, and the seeded entries it is competing with are not even on the live page.

The decisive line:

    lib/feed.ts:901        if (previewStrip.length >= 6) break;

`previewStrip` is built earlier, from the SEEDED eligible set, with NO per-author dedupe and a hard cap of six:

    lib/feed.ts:614-617  const previewStrip = eligible
                           .filter((p) => bannered.has(p.hash))
                           .sort((a, b) => a.minutesAgo - b.minutesAgo)
                           .slice(0, 6)

Unlike the pin hoist (lib/feed.ts:595, one post per author), the strip takes every banner-matching seeded post. Every seeded persona has plenty: `seed/data/posts.json` holds 410 posts across 25 personas, 16-24 posts each (top authors: persona_acc_astro_3 = 24, persona_acc_crypto_1 = 23). The `eligible` loop at lib/feed.ts:509 runs over SEED_POSTS unconditionally, in live mode too. So marking ONE account `banner` puts six of that persona's SEEDED posts in the strip, and the back-fill loop at 901 breaks on its first iteration before examining a single live cast. Banner remains inert on live content in the ordinary single-account case — and worse, in neynar mode the strip renders seeded posts from a world the viewer is not reading, which directly contradicts SECURITY-POSTURE.md:1747-1748 ("the banner tier's strip is drawn from the same eligible set the timeline was built from" — in live mode the timeline is built from live casts, not from `eligible`).

The same shape, less reachable, for never-miss:

    lib/feed.ts:890        if (pinSet.size >= pinCap) break;

`pinCap = Math.max(1, Math.floor(limit / 4))` (lib/feed.ts:591) with `limit = opts.limit ?? 40` (lib/feed.ts:578); every caller passes 40 or nothing (app/api/feed2/route.ts:15, app/api/lenses/route.ts:52-53, lib/algo/service.ts:160/190/233), so pinCap is 10. In live mode `pinSet` is pre-loaded with one seeded hash per never-miss author, none of which is on the page. Below ten never-miss accounts the back-fill still works (I checked the author-dedupe seeding at lib/feed.ts:885-888: `cards.find(x => x.cast?.hash === h)` misses for seeded hashes in live mode, so `pinnedAuthors` stays empty and the live cast by the same persona is NOT blocked). At ten or more never-miss accounts, line 890 breaks immediately and never-miss is fully inert on live, with `pinnedHashes` (lib/feed.ts:1460/1474 `[...pinSet]`) containing only hashes the UI cannot mark.

WHAT I TRIED AND COULD NOT BREAK. quiet on live: `quieted` is consumed directly in the post-merge sort, so it survives. facet-only on live: the hide rule is evaluated inline per live cast. deliveryOf key-space: tierMapFor strips the `modeId|` prefix and setTier refuses `|` in either id (lib/delivery/tiers.ts), so seeded and live attributions share one key space. Unattributed live casts correctly get `"normal"` and are skipped by the `if (att)` guard at lib/feed.ts:704.

SECONDARY (different mechanism, same direction). The back-fill AND the delivery sort both sit inside the try opened at lib/feed.ts:782 and swallowed at lib/feed.ts:951. That body performs `withRetry(() => adapters.identity.visiblePrivatePosts(...))` (lib/feed.ts:783) and `withRetry(() => fetchAnonCasts(zkMode()))` (lib/feed.ts:821). If either exhausts its retries, the catch swallows, the sort never runs, and quiet silently does nothing — a fail-open on quiet caused by an unrelated subsystem being unavailable, in exactly the direction lib/delivery/tiers.ts:86-90 promises never happens ("would quietly un-quiet an account the owner turned down"). This affects seeded mode equally, so it is not F-3 proper, but it is the same promise.

NOT AN ASSUMPTION. SECURITY-POSTURE.md §17 (lines 1725-1751) and its A-POST-DELIVERY-* assumptions (lines 1815+) contain no scoping of the tiers to seeded content; §17 states the strip property unqualified. So the residual is an unfixed gap, not a named limit.

**Residual.** In neynar/live mode, set ONE attributed persona of the viewer's to `banner` in the active mode. The seeded eligibility pass (lib/feed.ts:509-566) matches that persona's 16-24 posts in seed/data/posts.json against the compiled banner rule, and lib/feed.ts:614-617 fills previewStrip with the six most recent of them. The live back-fill at lib/feed.ts:900-901 then breaks on its first iteration (`previewStrip.length >= 6`), so no live attributed cast ever reaches the strip: the banner tier does nothing to the content the viewer is actually reading, and the strip displays seeded posts instead. Second path, same block: set ten or more accounts to `never-miss`; pinSet reaches pinCap (10, from limit 40) with seeded hashes that are absent from the live card set, lib/feed.ts:890 breaks immediately, and both the final-sort pin key (lib/feed.ts:943-944) and the returned pinnedHashes (lib/feed.ts:1460/1474) are no-ops on live content. The fix in both cases is to compute the pin and strip caps over the cards actually on the page rather than appending to structures the seeded corpus already exhausted.

## F-3a — PARTIAL (high)

**Evidence.** THE FIX IS REAL AT THE GET. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\fc\persona\route.ts` lines 29-46 no longer return the unfiltered map. The decisive line is 43:

    return { map, records: (await allPersonaFids()).filter((r) => visible.has(r.personaId)).map(redact) };

with line 39 `const visible = new Set(await visibleOwnPersonaIds());` and line 42 filtering `personaFidMap()` the same way. `git diff app/api/fc/persona/route.ts` confirms this replaced the old `map: await personaFidMap(), records: (await allPersonaFids()).map(redact)`.

I tried to defeat that chokepoint and could not, at the GET:
- `visibleOwnPersonaIds()` (lib/identity/chrome.ts:326-333) resolves the acting persona itself and routes through `viewScope`, which at line 307 returns `visiblePersonaIds: compartment ? [activePersonaId] : ownIds`. Under compartment mode the GET returns exactly one row.
- It does not fail open. `load()` (chrome.ts:114-119) throws when the chrome record is unreadable rather than defaulting compartment to false, and chrome.ts:89-92 refuses a namespace holding unreadable records instead of treating it as empty. GET has no try/catch, so the throw becomes a 500, not a permissive answer.
- `redact()` is irrelevant to the narrowing, as the report said, but the narrowing now happens before it.

THE GAP: the same file's POST handler rebuilds the identical persona-to-fid pairing in two unscoped actions, both of which sit ABOVE the `if (!devHooksOn())` gate at line 98, so they are product path, not rig path. Neither was touched by the fix (`git diff HEAD` shows zero changed lines matching them).

Line 82, action `registrantLinkage`:

    return NextResponse.json({ ...registrantLinkage(records), fids: records.map((r) => r.fid) });

with line 79 `const all = await allPersonaFids();` and line 81 defaulting `records` to `all` when `body.fids` is absent. `allPersonaFids()` (lib/fc/personaFid.ts:110-112) is the raw unfiltered item list. No `viewScope()`, no `visibleOwnPersonaIds()`.

Line 91, action `identityProbe`:

    return NextResponse.json({ allowed: true, fid: creds.fid, personaId: creds.personaId ?? null });

`assertOwnFidIdentity` is called at line 86-90 with `personaId: personaId || undefined`, so a body carrying only `fid` takes the "a fid named without a persona" branch in lib/fc/writes.ts:141-149, which does `const owner = await personaOfFid(requested.fid)` and returns `personaId: rec.personaId`. That is the reverse of the map the GET now withholds, returned with no scope check.

middleware.ts contains only a maintenance switch and a 200-burst/3-per-second token bucket. It applies no scope or ownership check to /api/fc/persona, and the exploit below needs only a handful of requests, so the limiter does not bite.

**Residual.** Two POST requests to the same route reconstruct the full persona-to-fid map that the GET fix removes, under compartment mode, without ZK_DEV_HOOKS:

1. POST /api/fc/persona with {"action":"registrantLinkage"} and no `fids` key. Line 81 falls through to `records = all`, and line 82 returns `fids: [...]` for EVERY own persona record. This alone is the complete own-fid set, so no fid-space enumeration is needed. The `findings` array additionally groups those fids by shared `custody` address (lib/fc/linkage.ts:40 includes the custody grouping with no sponsor exemption), which links fids to each other directly.

2. For each fid f from step 1, POST {"action":"identityProbe","fid":f}. Line 91 answers `{allowed:true, fid:f, personaId:"<the persona>"}`. Joining the two gives persona -> fid for every own persona, which is the exact disclosure F-3a describes.

That is N+1 requests for N personas, far inside the 200-token burst. Step 2 is also a standalone ownership oracle: a fid that is not this root's throws FcIdentityError and returns 403 `{allowed:false}` (line 93), so an outsider holding a candidate fid can test "is this account one of yours" against a root.

Only `fname` is absent from the reconstruction, and POST `signerProbe` (line 76) supplies it: given a personaId it returns `fname: fnameFromHandle(handle)` plus `custodyAddress`, again with no view-scope check.

The fix should be applied at the route's POST as well: `registrantLinkage` should filter `all` through `visibleOwnPersonaIds()` before both `registrantLinkage(records)` and the returned `fids`, and `identityProbe` should refuse (or null out `personaId`) when the resolved `creds.personaId` is not in the visible set. Nothing in SECURITY-POSTURE.md or docs/internal/assumptions.md records this POST surface as an accepted assumption.

## F-3b — PARTIAL (high)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\x\port\route.ts lines 13-33. A scope filter was added since the review (confirmed new by `git diff` — it is a working-tree change, not in HEAD). Decisive line, route.ts:23:

    const scoped = ports.filter((p) => visible.has(p.fromPersona) || visible.has(p.toPersona));

with route.ts:21-22 `const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome"); const visible = new Set(await visibleOwnPersonaIds());` and route.ts:25 `ports: scoped.map((p) => ({ ...p, state: portStatus(p) }))`.

The chokepoint is real and fails CLOSED: lib/identity/chrome.ts:326-333 `visibleOwnPersonaIds()` calls `viewScope()`, whose line ~307 is `visiblePersonaIds: compartment ? [activePersonaId] : ownIds`, and chrome.ts `load()` throws ("persona chrome unavailable … refusing rather than treating the vault as empty") when the vault is unreadable, which route.ts:30-32 turns into a 503 rather than an unscoped listing.

What still gets through — the rows themselves are not redacted. lib/x/porting.ts:36-63 defines the record and line 45 documents `handles: [string, string]` as "the two X handles the breadcrumb comes from — both this root's"; route.ts:25 spreads the record whole (`...p`). So under compartment mode a port whose `fromPersona` is the active persona is still returned carrying `toPersona` (a persona compartment mode is supposed to suppress), both of this root's X handles, the counterpart, and the `portId`. components/settings/RelationshipPortFlow.tsx:86-87 prints exactly that: `{p.fromPersona} → {p.toPersona}` and `from @{p.handles[0]} and @{p.handles[1]}`.

Attempts to defeat the fix that FAILED (i.e. the fix held): (a) fail-open via an unreadable chrome vault — throws, 503; (b) the `layers_view_as` cookie naming a stranger persona (lib/activePersona.ts:28-30 honours any seeded persona) — under compartment that narrows `visible` to a stranger and the filter returns nothing, and with compartment off `ownPersonaIdsAll()` (lib/influence/allowance.ts:124-128) is the device roster, so view-as does not widen it; (c) no query parameters exist on the GET to steer the scope; (d) no other route or component reads `listPorts()` — the only callers are this route plus `resetPortsCache` in app/api/dev/route.ts and lib/device/boot.ts.

**Residual.** Three reachable gaps, no crafted input needed.

1) Row-level linkage survives compartment mode. Turn compartment on, GET /api/x/port as persona P: every port where P is `fromPersona` OR `toPersona` comes back whole (route.ts:23 is an OR over a record that by construction names two personas). Each row hands the caller the sibling persona id at the other end and `handles[0]`/`handles[1]` — the root's primary and alt X handles as a pair. That is the persona↔persona↔X-handle linkage F-3b names; only the row SET narrowed, the row CONTENT did not. Compare app/api/personas/bindings/route.ts:25, where the same chokepoint collapses the surface to a single visible id because the record has one persona field. A real fix here is redacting the non-visible end and the second handle under `reason === "compartment"`, or returning no ports at all.

2) portId is still handed to a persona that cannot legitimately act on the port. Under compartment mode, a port issued BY a hidden sibling TO the active persona passes the OR filter, so the active persona learns its `portId`. lib/x/porting.ts:233 authorizes confirmation with `if (!ownIds().has(p.fromPersona))` — `ownIds()` (porting.ts:114) is the whole device roster, not the active persona — so that portId is sufficient to POST {action:"confirm", portId} and turn a sibling's pending offer into a real issued grant (porting.ts:240-247). The F-5 hand-off F-3b warned about is therefore only partly closed.

3) Default configuration is still the full table. `unified:false` does NOT narrow anything: viewScope returns `ownIds` for both reason "unified" and reason "single", so with compartment off (the default, chrome.ts EMPTY = `{unified:false, compartment:false}`) GET /api/x/port returns every port of every persona, unscoped, exactly as reported. This matches the convention used by the other F-3 fixes in this pass (disclosure, bindings, lenses, fc/persona all gate only on compartment), so it is arguably in-design rather than an oversight — but the finding's literal claim ("unscoped") remains true in the default mode.

## F-3c — PARTIAL (high)

**Evidence.** The named line is no longer unconditional. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\disclosure\route.ts` lines 19-27 now read:

19:    // GATE 5 (attack-post-1 F-3): `ownPersonas` is the sibling set by another name.
20:    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
21:    const visible = new Set(await visibleOwnPersonaIds());
22:    return NextResponse.json({
23:      grant,
24:      canViewLinkage: canView,
25:      requests,
26:      ownPersonas: SEED_VIEWER.personas.filter((id) => visible.has(id)),
27:    });

`git diff` confirms the pre-fix line was `ownPersonas: SEED_VIEWER.personas`.

The chokepoint is real: `lib/identity/chrome.ts:326-333` `visibleOwnPersonaIds()` resolves the acting persona itself and calls `viewScope()`, and `viewScope` (line 307) returns `visiblePersonaIds: compartment ? [activePersonaId] : ownIds`. It does not fail open — `load()` throws at lines 114-119 ("refusing rather than treating the vault as empty") when the chrome record is unreadable, and that throw lands in the route's own catch, which answers 503 (line 29) rather than the full list.

Attempts to defeat the fix, all failed:
- Request-controlled scope: `visibleOwnPersonaIds()` takes no arguments; neither the `personaId` nor the `viewerPersonaId` query param reaches it. Passing `?personaId=<sibling>` does not widen `ownPersonas`.
- View-as: `activeSeedPersonaId()` (lib/activePersona.ts:24-46) honours `layers_view_as` for any seeded persona, but under compartment that yields `[stranger]`, and the intersection with `SEED_VIEWER.personas` then yields `[]` — narrower, not wider.
- Cache/ghost state: `save()` (chrome.ts:124-142) restores the previous cache on a failed flush, so a compartment flag cannot be half-set; `setCompartment` forces `unified` false.
- Import failure / adapter failure: both throw inside the same try and produce 503, not a fallback list.

WHY IT IS ONLY PARTIAL: the scoping was applied to a field nobody reads, while the surface it was meant to protect gets the sibling set by a second, unscoped path. `grep -rn "ownPersonas"` over app/components/lib/scripts finds exactly one producer (this line) and zero consumers — `components/settings/DisclosurePane.tsx` uses only `data.grant` and `data.requests` (lines 33-35) and iterates its `personas` prop. That prop comes from `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\(main)\settings\privacy\page.tsx:19`:

19:    personas = (await Promise.all(SEED_VIEWER.personas.map((id) => mockPersonaAdapter.get(id)))).filter(

That server component reads `SEED_VIEWER.personas` directly, with no `viewScope()` / `visibleOwnPersonaIds()` call and no compartment check, and renders the full sibling roster (ids, handles, avatars) into the HTML — then the pane fires one `GET /api/disclosure?personaId=<id>` per sibling.

**Residual.** Under compartment mode, open /settings/privacy. The page at app/(main)/settings/privacy/page.tsx:19 enumerates SEED_VIEWER.personas unscoped and ships the whole sibling roster to the browser in the server-rendered payload, so the compartment never narrows the disclosure surface. The route's now-scoped `ownPersonas` field has no consumer, so the fix changes nothing observable. Secondarily, the route still applies no ownership or scope check to the `personaId` query param: `GET /api/disclosure?personaId=<any persona>` returns that persona's `grant` and `listUnlockRequests` regardless of compartment, and `grant.innerCircleViewerIds` is itself a list of persona ids (populated with counterpart ids by the mutual-unlock path, lib/adapters/mock/disclosure.ts:97-102), so sibling ids can return through a field the filter does not touch. Closing it means scoping the page's roster through visibleOwnPersonaIds() and rejecting a personaId the scope does not contain, not only filtering the response field.

## F-3d — PARTIAL (high as filed; residual is medium (one sibling identifier, not the roster))

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\personas\bindings\route.ts

THE FIX (lines 20-26, added since the review — confirmed by `git diff` on this file, working tree vs HEAD):
  23  const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
  24  const visibleIds = new Set(await visibleOwnPersonaIds());
  25  const enumerable = SEED_VIEWER.personas.filter((id) => visibleIds.has(id));
`enumerable` replaces `SEED_VIEWER.personas` in BOTH loops — the persona map (line 26) and the mode loop (line 41, `for (const personaId of enumerable)`). `visibleOwnPersonaIds()` (lib/identity/chrome.ts:326-333) resolves the acting persona itself and goes through `viewScope()`, whose line 307 is `visiblePersonaIds: compartment ? [activePersonaId] : ownIds`. So under compartment mode the route enumerates exactly one persona and exactly that persona's modes (`mode.list` is strictly owner-filtered: lib/adapters/mock/mode.ts:21 `.filter((m) => m.personaId === personaId)`). The roster dump described in the finding is closed.

THE RESIDUAL — the decisive line, app/api/personas/bindings/route.ts:59:
  59        pinnedPersonaId: m.pinnedPersonaId ?? null,
This field is emitted raw, never tested against `visibleIds`. A mode owned by persona A may legitimately pin persona B: the POST `setPin` handler (lines 91-101) checks only that `mode.personaId` and `target` are each in `SEED_VIEWER.personas` — it never requires `target === mode.personaId`. That cross-persona pin is a first-class, tested feature, not a corner case: scripts/accept-ux1.mjs:116 `await bind({ action: "setPin", modeId: chill.id, personaId: ALT })` under the check titled "A mode pinned to a DIFFERENT persona switches persona on pick", where `chill` is owned by MAIN (`yeak__`) and ALT is `backyard_scope` — the other seeded sibling.

WHAT I TRIED AND COULD NOT DEFEAT:
- View-as cookie (lib/activePersona.ts:29-30 honours VIEW_AS for ANY seeded persona). Under compartment this sets `visibleIds = {thatPersona}`; naming a stranger's persona makes `enumerable` EMPTY (the filter is against SEED_VIEWER.personas), so it fails closed rather than widening. It degrades to a per-id confirmation oracle only if the caller already knows a sibling id.
- Vault failure. `load()` (chrome.ts:114-119) throws rather than returning compartment:false; GET has no try/catch, so an unreadable chrome record yields a 500 with no body — fail-closed.
- Cache poisoning. `save()` (chrome.ts:130-141) adopts `g.__layersPersonaChrome` only after a successful flush and restores `previous` on failure, so a failed compartment write is loud, not a silent off.
- POST handlers still use the unscoped `SEED_VIEWER.personas.includes(...)` (lines 75, 94, 97, 132), but those are write authorization, not enumeration; they leak at most a yes/no per guessed id.
One narrower note, not the residual: `load()` treats a 404 from the validator for the `personaChrome` namespace as an empty document with compartment off (chrome.ts:74-77), so a namespace that is deleted outright (as opposed to corrupted, which attack-post-3 F-1 closed at lines 89-92) reads as compartment OFF after a process restart, and the route dumps the full roster again.

**Residual.** With compartment mode ON and active persona MAIN (`persona_viewer_main`): GET /api/personas/bindings returns `personas` narrowed to MAIN alone, but `modes[]` still carries `pinnedPersonaId: "persona_viewer_alt"` for any of MAIN's modes that was pinned to the sibling — the exact flow scripts/accept-ux1.mjs:116 exercises. That hands an adversary in the owner's session (the threat model attack-post-1 states for F-3, "shoulder-surfing and screen-share", an adversary at the owner's device) a sibling persona id on the surface compartment mode was supposed to narrow. The id alone, not the sibling's handle, name, default mode or mode list — so it is a seed for the confirmation oracles elsewhere (e.g. re-requesting this route under a VIEW_AS cookie naming that id returns that persona's handle, name, defaultModeId and undo depth despite compartment mode), not a dump. Fix shape: filter `pinnedPersonaId` through `visibleIds` (emit null, or a "pinned elsewhere" flag, when the target is out of scope), the same way `enumerable` gates the two loops. The UI does not depend on the raw value surviving: components/settings/PersonaModeMatrix.tsx:137 only feeds it to a `<select>` whose options are already the narrowed persona list.

## F-3e — PARTIAL (high (as filed); residual gap is medium)

**Evidence.** BOTH named defects are closed in the current working tree (uncommitted change, `git diff --stat app/api/lenses/route.ts` = 15 insertions / 3 deletions on top of 2a65941).

C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\lenses\route.ts, lines 30-42 (delta branch). Decisive lines:

  31:      const visible = await visibleOwnPersonaIds();
  33:      const asked = q.get("personaIds") ? String(q.get("personaIds")).split(",").filter(Boolean) : visible;
  34:      const outside = asked.filter((id) => !visible.includes(id));
  35-39:   if (outside.length) return NextResponse.json({ error: "those personas are outside this device's current scope", code: "out_of_scope" }, { status: 403 });
  41:      const delta = await influenceDelta(lens.spec, personaIds, viewer, epoch);

(1) The echo is now the SCOPED list, not `ownPersonaIdsAll()`. `visibleOwnPersonaIds()` (C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts:326-333) calls `viewScope()` internally, and viewScope line 306 returns `visiblePersonaIds: compartment ? [activePersonaId] : ownIds`. Under compartment mode the response body echoes only the active persona. The finding's "there is no viewScope() call" is no longer true — it is reached through visibleOwnPersonaIds().
(2) A caller-supplied `personaIds` outside the visible set is refused 403 BEFORE `influenceDelta` runs (the check at 34-39 precedes the call at 41), so no sibling arithmetic is computed or returned.

The `preview` branch was fixed the same way (route.ts:60-61 uses `visibleForPreview()` rather than `ownPersonaIdsAll()`); the `ownPersonaIdsAll` import still at route.ts:49 is now used only for a dead binding in that branch, no scope impact.

Attempts to defeat the fix, all failed:
- `?delta=canonical&personaIds=<sibling>` → 403, nothing computed.
- Mixed `?personaIds=<active>,<sibling>` → `outside.length` is 1 → whole request 403, no partial answer.
- Case/whitespace variants (`SIBLING`, ` sibling`) → `visible.includes()` is exact-match and there is no trim/normalize anywhere in the path, and rejection happens before any lookup, so a downstream loose match cannot be reached.
- `?personaIds=,` → `filter(Boolean)` yields `[]`, `outside` empty, delta over the empty set = zeros. No leak.
- `?personaIds=` (empty value) → falsy, falls back to `visible`.
- Fail-open probe: if the chrome vault is unreadable, `load()` throws (chrome.ts:110-116 "refusing rather than treating the vault as empty"), `visibleOwnPersonaIds()` propagates, the route's catch answers 503. The compartment does not evaporate on a validator hiccup.

**Residual.** The same accrual arithmetic is still reachable under compartment mode from ONE ROUTE OVER, because the other caller of `influenceDelta` was not rescoped:

C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\algo\service.ts:207
  const influence = await influenceDelta(artifact.lens, await ownPersonaIdsAll(), viewer);

That is inside `previewArtifact()`'s `kind === "lens"` branch, reached by POST /api/algo/preview (C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\algo\preview\route.ts:11 → `previewArtifact(artifact, activeSeedPersonaId())`). No `viewScope()` / `visibleOwnPersonaIds()` call exists on that path.

Concrete exploit path, all on-device, compartment mode ON:
1. GET /api/lenses?export=canonical → a signed artifact (exportLens, lib/lens/service.ts:101-123, signs as the active persona whose key is on the device, so `verifyArtifact` at lib/algo/artifact.ts:121 passes).
2. POST /api/algo/preview {artifact} → response carries `preview.influence` = {epoch, canonical:{score,count,confirmed,evaluated}, underLens:{...}} computed over the UNSCOPED `ownPersonaIdsAll()` set.
3. GET /api/lenses?delta=canonical → the same arithmetic scoped to `[activePersonaId]` alone, and with the same default epoch (`influenceDelta` defaults to `currentEpoch()-1` in both callers, lib/lens/service.ts:243-244), so the two are apples-to-apples.
4. Subtract: the difference is the siblings' aggregate accrual score/count/confirmed/evaluated for that epoch. With a single sibling it is that sibling's numbers exactly.

Narrower than the original finding (no persona ids are echoed, and the numbers are an aggregate rather than addressable per sibling id), but it is the same class of disclosure the fix was meant to shut, and it is reachable with no special input.

Separately, worth naming but NOT counted as the gap: with compartment off and `unified` merely off, `visibleOwnPersonaIds()` still returns the full own-persona set (chrome.ts:306, `reason: "single"`), so the delta response echoes every own persona id. That is viewScope's declared contract and is consistent across the other rescoped routes (disclosure, fc/persona, x/port, personas/bindings), so it is design rather than a defect here.

## F-4 — FIXED (high)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\(main)\layout.tsx lines 82-121 have been restructured into TWO separate try blocks. The tint half (lines 87-99) imports `ownPersonaIdsAll()` and calls `tintsFor(...)`, and its catch sets only `tintColor = null; tintSource = "unavailable"`. The scope half is its own try (lines 100-113) calling `viewScope(session.active?.id ?? actingId, session.personas.map((p) => p.id))`, and its catch fails CLOSED. Decisive line, layout.tsx:111:

    visibleIds = session.active ? [session.active.id] : [];

with line 112 `scopeUnavailable = true;` and the comment at 108-110 ("FAIL CLOSED. An unreadable chrome record cannot be read as 'no compartment'"). Because both branches of the scope try now assign an array, `visibleIds` can no longer be null at line 121 (`const visiblePersonas = visibleIds ? session.personas.filter(...) : session.personas`), so the `session.personas` fallback is unreachable on the failure path and `<Providers personas={visiblePersonas}>` (line 161) never receives the sibling set. The `data-scope` edge is also addressed: layout.tsx:181 renders `data-scope={scopeUnavailable ? "unavailable" : ...}`, so the markup no longer positively asserts `"normal"` when the server does not know the scope. The trigger the report named is still cheap and real — lib/identity/chrome.ts:107 `if (String((e as Error).message).includes("vault")) break;` still short-circuits the retry loop, and chrome.ts:89-92 throws `vault: personaChrome holds N record(s), none readable by this device` — but that throw now only reaches the scope catch, which narrows the roster instead of widening it.

Attempts to defeat the fix, all failed: (1) forcing `visibleIds` back to null — impossible, both paths assign; (2) using the `ownPersonaIdsAll()` throw the report flagged (lib/influence/allowance.ts) to suppress the scope read — it is now raised inside the tint try at layout.tsx:91-92 only, and the scope try re-enters `load()` independently; (3) ordering — `load()` caches into `globalThis.__layersPersonaChrome` only after success (chrome.ts:120), so a tint-block failure leaves no poisoned cache for the scope block to read as an empty doc; (4) client-side re-widening — components/Providers.tsx only POSTs to /api/personas (line 62) to create, it never GETs the roster back, and app/api/personas/route.ts:16 calls `viewScope(...)` outside any try, so an unreadable record errors the route rather than returning the full list; (5) derived-attribute lie — `data-scope` is computed from `visibleIds.length === 1 && session.personas.length > 1`, and since non-compartment `viewScope` returns the full `ownIds` (chrome.ts:307), that derivation cannot report "normal" while a compartment narrowing is in effect.

**Residual.** None for the reported leak. Two non-leaking cosmetics remain in the same block, both failing in the safe direction: if `session.active` is null AND the chrome read fails, layout.tsx:111 yields `[]` and the switcher renders an empty roster rather than the active persona alone (fail-closed, but an erased rather than narrowed list); and `data-scope` is derived from list lengths rather than from `scope.reason`, so "unified" and "single" both render as "normal", and compartment mode on a one-persona roster also renders "normal" (no siblings exist to leak).

## F-4 — PARTIAL (high)

**Evidence.** POST HALF — FIXED. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\identity\fork\route.ts` lines 127-144 now carry an ownership predicate that did not exist when the review was written (it is uncommitted; `git diff` on the file shows this as a new hunk after line 124). Decisive line, route.ts:139:

    if (!own.has(fromPersona))

built at route.ts:138 as `const own = new Set([...(await ownPersonaIdsAll()), ...(await getSession()).personas.map((p) => p.id)]);`, returning 403 `code: "not_own"`. It sits after `fromPersona` is finally resolved (route.ts:112-124) and before `carry`, `currentGrantHolders`, `createPersona`, `copySettings` and the `state().forks.set` at route.ts:276, so all four reported consequences are gated by it. I checked the set it builds: `ownPersonaIdsAll()` (lib/influence/allowance.ts:123-127) = `SEED_VIEWER.personas` ∪ keystore `ownPersonaIds()`, and `seed/data/viewer.json` lists exactly `["persona_viewer_main","persona_viewer_alt"]`; the default session (no root cookie) resolves via `personasByFid(getSelf().fid)` → `personasForRoot("root_viewer")` → the same two. So the review's own example — forking `persona_acc_fantasy_2` (tier 10, root_acc_fantasy_2) or `brothandbones` (root_acc_food_1) — now 403s. `copySettings` has exactly one caller (route.ts:309), so there is no second door into lib/identity/clone.ts.

Attempts to defeat the POST fix that FAILED: (a) passing a handle instead of an id — `idOf` (route.ts:31-36) resolves it to the same id the check tests; (b) `__proto__`/`constructor` as `fromPersona` — `personaById`/`personaByHandle` are `Map`s, so `.has()`/`.get()` do not walk the prototype; (c) non-string `fromPersona` — falls through to the 400 at route.ts:125; (d) TOCTOU between the check and use — `fromPersona` is assigned once and never reassigned; (e) throwing the check to skip it — lines 135-144 are OUTSIDE the `try` at line 150, so a keystore/session failure is a 500, not a pass.

GET HALF — UNTOUCHED, still reachable. `git diff` on the route contains no hunk in `GET`. Decisive line, route.ts:84:

    const holders = currentGrantHolders(personaId).map((h) => ({

`personaId` comes straight from `idOf(req.nextUrl.searchParams.get("personaId"))` at route.ts:46 — any id or handle in the global store — and lines 84-99 return every live linkage grant-holder of that persona with `handle`, `name`, `avatarUrl`, `grantId`, `tier`, plus the `suspicion` note, with no session read, no ownership predicate and no 403 anywhere in the GET body (lines 45-103). middleware.ts guards only maintenance and rate limiting.

**Residual.** Two reachable paths remain.

1. UNCONDITIONAL — audience disclosure, and a chain off it that defeats the forward pointer's "fail closed by construction" claim. `GET /api/identity/fork?personaId=brothandbones` (any handle or id in the store) returns that persona's full audience list. Then feed one of those `audienceMember` ids straight back in: `viewerPersonaId` at route.ts:48-50 is caller-supplied and never checked against the session (`viewerParam === null ? activeSeedPersonaId() : viewerParam === "" ? null : idOf(viewerParam)`), so `GET /api/identity/fork?resolve=<victim>&viewerPersonaId=<holder-from-step-1>` makes `resolveForwardPointer` (lib/identity/fork.ts:96-116) match on `g.audienceMember !== viewer` against an id the attacker chose. That returns the victim's new persona id/name/handle/avatar (route.ts:77), the fork commitment AND its nonce (route.ts:67), and the new fid/fname (route.ts:68-74). lib/identity/fork.ts:99-101 claims "FAIL CLOSED by construction ... a forced adapter call gets the same null a dropped holder's UI does" — that is only true against a viewer the server authenticates, and this route lets the caller name the viewer. scripts/accept-fid3.mjs:106-109 uses `viewerPersonaId=` as the rig's mechanism, so it is caller-supplied by design.

2. CONDITIONAL on `LAYERS_REQUIRE_SIG` being unset (the rig/dev default; validator/server.js:24) — the POST check's `own` set can be widened to the victim's. seed/data/accounts.json publishes each seeded root's `signerUuid` in plaintext (`"seed-signer-acc_food_1"` etc.). `POST /api/signer {"fid":5000015,"signerUuid":"seed-signer-acc_food_1"}` reaches validator/server.js:202-206, which does `SELECT id, anchor FROM roots WHERE signer_uuid = ?` and returns the EXISTING seeded rootId with a 200. The anchor guard on the line above (`if (anchor && existing.anchor && existing.anchor !== anchor)`) is short-circuited because `anchor` is only populated inside `if (REQUIRE_SIG && req.header("x-layers-device"))` and `signedWriteHeaders` returns `{}` when `REQUIRE_SIG()` is false (lib/adapters/mock/persist.ts:335-338). The route then sets a valid `layers_root` cookie, `getSession()` resolves that root, and `personasForRoot` serves the victim's personas out of the device's `.keystore/fixture-roster.json` pre-006 export — so route.ts:138 admits them and the fork proceeds. The fork-record destruction at route.ts:276 (`state().forks.set(fromPersona, {... forwardGrantIds: [], carried: [] ...})` + `persistNs("forks")`) survives this path intact, which is the persisted-integrity half of the original finding. With `LAYERS_REQUIRE_SIG=true` the app's own device anchor is sent, the seeded rows' `anchor='seed'` (validator/seed.js:26) mismatches, and the validator 403s, so this path closes.

Also worth flagging to the pass owner (functional, not security): scripts/accept-c4.mjs:18, scripts/accept-fid1.mjs:24, scripts/accept-fid2.mjs:26 and scripts/accept-anon-reveal.mjs:89 all fork from `brothandbones` — "a seeded persona the viewer can fork" — which the new check now refuses with 403. Those suites will fail against this working tree unless they first take a session as that root.

## F-4 — PARTIAL (high (as filed); the residual gap that remains is medium)

**Evidence.** DOOR 1 (pin/banner via POST /api/rules) IS CLOSED. C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\rules\route.ts:18-34 now carries a positive allowlist added since the review (git diff vs HEAD confirms it is a working-tree change, not pre-existing):

    line 25:  const CREATABLE_ACTIONS = new Set(["hide", "downrank", "flag"]);
    line 29-30:  const action = body.action ?? "hide";
                 if (!CREATABLE_ACTIONS.has(action))   // -> 400 "action_not_creatable"
    line 39:  action,        // the allowlisted local, not body.action

I tried to defeat it and could not. (a) It is a positive allowlist, so a non-string action (object, array, number), " pin", "PIN", or a prototype-shaped key all fall through to 400 — it fails closed, unlike a denylist. (b) I enumerated every other writer of the rules store: `adapters.rules.create` has exactly three callers — this route, lib/algo/service.ts:350 (fed only from `artifact.rules`, and sanitizeArtifact is called on every import path, lib/algo/service.ts:150 and :309, refusing pin/banner by name at lib/algo/artifact.ts:185-193), and lib/identity/clone.ts:76 (copies `r.action` verbatim but only from rules that already exist, and every preset in lib/adapters/mock/presets.ts is action "hide"). `adapters.rules.update` (lib/adapters/mock/rules.ts:44-53) has NO caller and no route — there is no PATCH /api/rules. The only other write is the persisted-state merge at lib/adapters/mock/store.ts:382-389, which is disk hydration, not request-reachable. (c) Referencing the compiled rule ids directly does not work: `compileDeliveryRules` (lib/delivery/tiers.ts:220-225) mints `delivery:never-miss` / `delivery:banner` in memory only, so a mode PATCH naming them hits the unresolvable-rule throw in lib/feed.ts. So there is no longer a stored pin/banner rule an attacker can produce, and the "arbitrary root + pin" escalation (pin everything via `author.tier gte 0`) is gone.

WHAT IS STILL OPEN — the other two thirds of the re-check question are both answered NO:

1. POST /api/rules still never calls validateRuleGroup(body.root). Line 40 is still `root: body.root`, unchecked and not even null-checked — the sibling preview route does better (`app/api/rules/preview/route.ts`: `if (!root) return ... 400`). The mock adapter stores it verbatim (lib/adapters/mock/rules.ts:36, `root: rule.root`).

2. buildFeed still validates nothing on stored rules. lib/feed.ts:431-443 resolves `mode.ruleIds` and does `rules.push(rule)` with no validateRuleGroup and no action check, in contrast to the inline-rule loop immediately above at lib/feed.ts:419-427 which does validate. app/api/modes/route.ts also still accepts an arbitrary `ruleIds` array on POST (line ~37) and via `{...existing, ...patch}` on PATCH (line ~64) — only `actionButtonSlots.cast` is validated there.

The decisive residual line is the evaluator's unguarded deref, lib/rules/evaluate.ts:165:

    const results = group.clauses.map((clause) =>

`evaluateGroup` does NOT use `group.clauses ?? []` (validateRuleGroup, line 105, does), and lib/feed.ts:556 calls `evaluateGroup(rule.root, ctx)` inside the per-post loop with no try/catch.

**Residual.** A persistent, self-inflicted-but-CSRF-reachable denial of the whole timeline, via the exact same two-call sequence the finding described, because body.root is never validated.

POST /api/rules {"name":"x","action":"hide","root":{"combinator":"AND"}}  -> 200, stored (action passes the allowlist; the root has no `clauses` key and nothing looks at it). Then PATCH /api/modes {"modeId":"<active>","patch":{"ruleIds":["rule_N"]}} -> 200. Then every GET /api/feed2 reaches lib/feed.ts:556 -> evaluateGroup(root) -> lib/rules/evaluate.ts:165 `group.clauses.map` on undefined -> TypeError, which app/api/feed2/route.ts:24-26 turns into a 503 for the entire feed. `root: null` or an omitted `root` does the same (`null.clauses`). The state is persisted, so the timeline stays bricked across restarts until the rule is deleted out of band.

Two amplifiers: (i) there is still no CSRF/origin check anywhere — middleware.ts does maintenance + rate limiting only, and `req.json()` does not check Content-Type, so a cross-origin text/plain fetch reaches both routes without a preflight, exactly as the finding said; (ii) the same effect is reachable with the modes route alone, since PATCH accepts any ruleIds and an unresolvable id makes buildFeed throw by design (lib/feed.ts:435-441, deliberately fail-closed).

Minimal closure, matching what the review asked for: call validateRuleGroup(body.root) in the POST handler after a shape check (`root` present, `combinator` a string, `clauses` an array) and 400/422 on violations; and either mirror that validation in buildFeed's stored-rule loop or harden lib/rules/evaluate.ts:165 to `(group?.clauses ?? [])`. Hardening only the evaluator downgrades the DoS to "the rule matches nothing" but leaves the stored-rule loop asymmetric with the inline loop above it.

## F-5 — OPEN (high)

**Evidence.** A fix was ATTEMPTED and is inert. lib/identity/chrome.ts:124-142 (`save`) now reads, at line 130: `const previous = g.__layersPersonaChrome;` and at 135-141 `try { await flushVault(VAULT_NS, sealed); } catch (e) { g.__layersPersonaChrome = previous; throw e; } g.__layersPersonaChrome = doc;`. The decisive line is chrome.ts:130 — `previous` is the SAME OBJECT as `doc`. The report's own aliasing observation is still true and is what kills the fix: chrome.ts:68 `if (g.__layersPersonaChrome) return g.__layersPersonaChrome;` returns the cached object itself, and chrome.ts:120 `g.__layersPersonaChrome = doc;` installs the freshly loaded object before returning it, so after `load()` the cache and the caller's `doc` are one object on every path. Every writer then mutates it IN PLACE with no await before `save()`: chrome.ts:348 `doc.compartment = !!on;` (and 349 `doc.unified = false`), chrome.ts:237 `doc.tints = { ...doc.tints, [personaId]: color.toLowerCase() };`, chrome.ts:248, chrome.ts:339. Therefore the rollback assigns the already-mutated object back to itself. Nothing is rolled back. Mirror file identical: lib/delivery/tiers.ts:101 `const previous = g.__layersDeliveryTiers;` with tiers.ts:51 returning the cached object, tiers.ts:194 `doc.tiers = next;` mutating it in place, and tiers.ts:105-110 restoring the same alias. No snapshot is taken anywhere — chrome.ts:131 `const m = { tints: doc.tints, unified: doc.unified, compartment: doc.compartment };` reads the live fields, and tiers.ts:104 seals `doc.tiers` directly. Sub-case 5b is untouched: lib/adapters/mock/persist.ts:259 `const counter = nextCounter(ns);` sits inside `envelopeHeaders`, which flushVault calls once at persist.ts:399 BEFORE persist.ts:404 `res = await validatorFetch(BASE + '/state/' + ns, { method: "PUT", headers, body: JSON.stringify({ entries }) });` — and validatorFetch (persist.ts:119-127) loops `if (res.status !== 429 || attempt >= 4) return res;` re-sending the identical headers, so the counter and the sealed snapshot are both stale on retry. The validator guard the report quotes is still there (validator/server.js:475-476, `if (prev && counter <= prev.counter) return { status: 409, error: ... }`). The only working-tree change to persist.ts is one added ExtraNamespace string ("readwiseState"). No per-namespace write serialisation was added: the `__layersZkDrainInFlight` promise chain exists only at lib/zk/anon/queue.ts:269-275 and nothing like it guards personaChrome or deliveryTiers.

**Residual.** 5a fully reachable, unchanged in effect. POST /api/persona/chrome {action:"compartment",on:true} → setCompartment (chrome.ts:345) gets the cached doc, sets compartment=true on it, save() captures `previous` = that same mutated object, flushVault throws (validator 500/413/409 → persist.ts:409, or transport → 408), the catch reassigns the identical object, the route answers 503 (app/api/persona/chrome/route.ts catch → status 503) and every later viewScope() (chrome.ts:298-310) and visibleOwnPersonaIds() in that process reads compartment:true from the cache: the switcher narrows, act-as narrows, search rebuilds single-persona. The vault never heard of it; it evaporates on restart with no announcement. The reverse direction is worse: a failed setCompartment(false) leaves the cache with compartment:false while the vault still holds true, so the process runs UNPROTECTED after a refusal the owner saw as an error. Same for setTint (ghost tint) and, in tiers.ts, a failed setTier(...,"quiet") showing the account quieted for the process and normal after restart. 5b fully reachable and untouched: writer A's tint sealed at t=0, 429'd, retried at t=8s with the counter allocated at t=0 and the pre-B snapshot; with LAYERS_REQUIRE_SIG unset it overwrites B's compartment:true with both routes returning 200 and nothing logged; with it set A gets 409 → 503 while A's tint stays in the shared cache (and, per the above, is not rolled back). The three fixes still wanted: seal from a real copy (structuredClone/spread) and only then publish it to the global on success; serialise per namespace behind a promise chain like queue.ts:269; move nextCounter(ns) inside the retry loop, or re-derive headers per attempt in flushVault/flush.

## F-7 — PARTIAL (medium (re-assessed down from high))

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\activePersona.ts:43-73. The reported predicate is GONE. Decisive line, lib/activePersona.ts:44:

    if (fromCookie && mayActAs(fromCookie)) return fromCookie;

and the allowlist it calls, lib/activePersona.ts:57-73:

    export function mayActAs(personaId: string): boolean {
      if (SEED_VIEWER.personas.includes(personaId)) return true;
      if (actable().has(personaId)) return true;
      try { if (ownPersonaIds().includes(personaId)) { actable().add(personaId); return true; } } catch {}
      return false;
    }

`personaById` is no longer consulted on the SEED_PERSONA_COOKIE path (it is still consulted for VIEW_AS_COOKIE at line 30 and isViewingAs at line 88, which is deliberate and bannered). So the three render-map feeders the finding named are now inert for act-as power: lib/validator.ts:50-54 (registers every roster persona of every root queried), app/api/seed-persona/route.ts:40-47 and app/api/identity/fork/route.ts:118-120 / 189+ all write only to personaById/personaByHandle, not to the allowlist. Grep confirms the allowlist has exactly three writers: allowActingAs (lib/activePersona.ts:76), called only at app/api/seed-persona/route.ts:39 AFTER the ownership check at lines 18-21 (`mine = SEED_VIEWER.personas ∪ session.personas`), the keystore branch, and resetActable (app/api/dev/route.ts:533, lib/device/boot.ts:186).

Attempts to defeat the fix that FAILED: (a) poisoning the caller's own roster with a stranger's id so /api/seed-persona would accept it — every recordPersona caller (app/api/personas/route.ts:36, app/api/identity/fork/route.ts:219, lib/adapters/validator/index.ts:51, lib/device/boot.ts:100) passes a freshly minted id, never a client-supplied one; (b) reaching an act-as path that still trusts the render map — app/api/actions/act-as/route.ts:64 is independently stricter (`SEED_VIEWER.personas` ∪ `isOwnPersona`) and does not read the allowlist; (c) warming personaById via a validator roster query (lib/validator.ts:50) and then sending the cookie — mayActAs now returns false.

RESIDUAL (why PARTIAL, not FIXED): the allowlist is PROCESS-global, not session- or root-scoped — lib/activePersona.ts:51, `const g = globalThis as unknown as { __layersActable?: Set<string> };` — so line 59 `if (actable().has(personaId)) return true;` is true for EVERY browser session in the process, not just the one whose roster was checked at app/api/seed-persona/route.ts:18-21.

**Residual.** Cross-session carry-over of an accepted persona, with no banner (isViewingAs, lib/activePersona.ts:86-89, still only covers VIEW_AS_COOKIE). Exploit path, all steps reachable on the deployed preview: (1) the legitimate holder of root R1 switches persona via POST /api/seed-persona {personaId: X} where X is in R1's session roster but NOT in the device keystore and NOT in SEED_VIEWER.personas (a fixture-roster persona, or one created through the signer/validator adapter path) — allowActingAs(X) puts X into globalThis.__layersActable; (2) that same route at app/api/seed-persona/route.ts:40-46 also registers X into personaById AND personaByHandle, so /@<X's handle> now renders, and app/(main)/[handle]/page.tsx:134 emits `<FacetFollow personaId={seeded.id} />` — X's 64-hex id is in the page payload for any visitor who knows the handle, which is how the attacker learns the otherwise unguessable id; (3) a different browser — no cookies at all, or its own root obtained from POST /api/signer (app/api/signer/route.ts:12-26, unauthenticated, mints a fresh root on demand) — sends only `Cookie: layers_seed_persona=X`; (4) mayActAs hits line 59 and activeSeedPersonaId() returns X, so GET /api/eventlog returns X's relationship log (app/api/eventlog/route.ts:16 `const actor = activeSeedPersonaId();`, whose own docstring says there is deliberately no way to name someone else's log), plus /api/folders, /api/delivery, /api/influence?view=history, /api/feed2, and the writes POST /api/delivery and POST /api/persona/chrome {"action":"tint"} — with no view-as banner. The set only grows until a seed reset or reboot clears it. The fix the finding itself proposed (bound to SEED_VIEWER.personas ∪ ownPersonaIds() ∪ a device-held accepted set) is implemented except for the last term: the accepted set is not device/session-held, it is process-held. Keying it by the resolved root (or by the opaque layers_root session handle) closes this; nothing else in the module would need to change.

Scope note, so the residual is not overstated: the OTHER two allowlist branches are session-independent by design and are NOT part of this residual — SEED_VIEWER.personas was already session-independent before the Gate 1 change, and ownPersonaIds() reads the one server-side .keystore/root.json, which this architecture treats as the device's own (any caller reaching the process can already mint and sign as those personas via /api/personas and /api/actions/act-as). That is the pre-existing "the process is the device" posture. The residual above is strictly wider than it, because a roster/fixture persona that the keystore never minted becomes act-as-able process-wide.

## F-10 — PARTIAL (medium (residual is narrower than the original: low-medium))

**Evidence.** THE DELIMITER HALF IS FIXED, at the single writer. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\delivery\tiers.ts` lines 174-182 (uncommitted working-tree change; `git diff -- lib/delivery/tiers.ts` shows it is new since 6229339) now carry the decisive guard:

  179:  if (modeId.includes("|") || personaId.includes("|"))
  180:    return { ok: false, code: "malformed", reason: "a mode or persona id may not contain '|' — it is the key separator" };
  181:  if (modeId.length > 200 || personaId.length > 200)
  182:    return { ok: false, code: "malformed", reason: "mode and persona ids are at most 200 characters" };

It sits at tiers.ts:179, BEFORE the delete branch at 192 (`if (tier === DEFAULT_TIER) delete next[keyOf(modeId, personaId)]`), so it covers both set and clear. I tried to defeat it: `setTier` is the only writer of `doc.tiers` (grep over app/, lib/, components/, scripts/ shows callers are only `app/api/delivery/route.ts:94`, plus `resetDeliveryCache` in `app/api/dev/route.ts:523` and `lib/device/boot.ts:172`, and read-only `tierMapFor` in `lib/feed.ts:404`). `keyOf` (tiers.ts:48), `listNonNormal`'s first-`|` split (tiers.ts:148) and `tierMapFor`'s prefix strip (tiers.ts:130) are all unchanged, but with no `|` reachable in either component the two can no longer disagree. The reproduction in the report now returns HTTP 400 `malformed`. The management pane round-trips `row.modeId`/`row.personaId` verbatim (`components/settings/DeliveryTiersPane.tsx:53`), so every listed row is deletable via its own select.

WHAT WAS NOT DONE. Two of the four requested fixes are absent and the route is byte-for-byte unchanged (`git diff HEAD -- app/api/delivery/route.ts` is empty). `app/api/delivery/route.ts:91` still reads:

  91:  const modeId = typeof body.modeId === "string" && body.modeId ? body.modeId : active.id;

There is no membership check against the viewer's modes — POST never even fetches `adapters.mode.list` (only GET does, at route.ts:46); `personaId` (route.ts:89) is likewise never checked against `personaById`, which is consulted only for `rootId` at route.ts:93 and tolerates `undefined`. Storage is still the flat concatenated key (`Doc.tiers`, tiers.ts:42-48), not a nested `{ [modeId]: { [personaId]: tier } }`, and there is no row cap anywhere in `setTier` or the route.

THE GROWTH CONSEQUENCE IS STILL LIVE. `validator/server.js:137` is still a bare `app.use(express.json())` (default 100 kb); `validator/caps.js:87` caps writes per device per hour (2000), not bytes or rows. `middleware.ts:32-58` applies no origin/CSRF check and allows 200 burst + 3/s, and the route parses with `req.json()` regardless of content-type, so even an off-origin page can drive simple-request POSTs. Each accepted POST with a fresh 200-char `modeId`/`personaId` pair persists ~410 bytes into the sealed record, so a few hundred requests push `flushVault` past the body limit.

**Residual.** Three reachable gaps remain, none a privilege boundary.

1. Unvalidated `modeId`/`personaId` (route.ts:91 and :89) still let a client persist rows for modes and accounts that do not exist. `listNonNormal()` returns them, and GET falls back to the raw id for both name and handle (`modeName(r.modeId)` route.ts:47/:72, `personaById.get(r.personaId)?.handle ?? r.personaId` route.ts:74), so the management screen shows groups headed by a raw `mode_...` string listing `@persona_...` accounts nobody follows. Nothing enforces them: `lib/feed.ts:404` only loads `tierMapFor(mode.id)` for the mode actually active. They are individually deletable now, but only one click at a time.

2. No row cap, so growth into the validator's 100 kb limit is intact: ~200-400 POSTs of maximal-length ids (inside one 200-request burst, or at the sustained 3/s the middleware allows) grow the sealed record until `flushVault` answers 413. The F-5 rollback in `save()` (tiers.ts:100-111) means the oversized doc is not adopted, so the namespace is not bricked permanently and the failure is loud (the throw reaches route.ts:97-99 → 503) rather than the silent success the original report described — but every NEW legitimate tier change fails with 503 until the owner deletes enough junk rows by hand. Denial-of-configuration plus a polluted management screen.

3. New, introduced by the fix itself: `load()` (tiers.ts:62-73) adopts `rec.m.tiers` wholesale with no key sanitisation, while the guard at tiers.ts:179 rejects any `|`-bearing component on the way back out. A key such as `mode_a|persona_y|persona_x`, already sealed into the namespace by a pre-fix build (or by a linked second device still running one — this vault namespace is shared across linked devices), still mis-splits in `listNonNormal` and is now IMPOSSIBLE to remove through the UI or the API: the pane posts `personaId: "persona_y|persona_x"` with `tier: "normal"` and gets 400 `malformed`. Before the fix that one POST would have cleared it. A one-time sanitising sweep in `load()` (drop or re-key any entry whose key has more than one `|`) would close this.

## F-11 — FIXED (medium)

**Evidence.** Both reported misses now have real reset functions and both are actually called from `resetSeed`, after the wipe.

DEFECT 1 — `__layersAnonAttribution`. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\zk\anonAttribution.ts:161-169` now ends with the decisive line:

  167  export function resetAnonAttributionCache(): void {
  168    g.__layersAnonAttribution = undefined;

That defeats the resurrection at its source: `load()` at line 57 is `if (g.__layersAnonAttribution) return g.__layersAnonAttribution;` — `undefined` is falsy, so the next `sealSecretForPost` re-reads the wiped validator namespace (404 → `doc.loaded = true`, `items: {}` at line 63) and `save()` line 91 seals an empty items map instead of every pre-reset reveal secret. The module's own comment at line 125 ("the reset wipes this namespace like every other fixture-only table") is now true of the cache as well as the validator.

DEFECT 2 — `__layersSessionHandles`. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\sessionHandles.ts:75-81`:

  79  export function resetSessionHandlesCache(): void {
  80    g.__layersSessionHandles = new Map();

A fresh empty Map restores the `size > 0` gate in `loadAll()` (line 23), so the next `registerHandle()` re-reads the wiped namespace and flushes only the new handle at line 61, not the whole pre-reset handle→rootId deanonymization table.

WIRING AND ORDER. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\dev\route.ts:535-542` calls both, and both land AFTER `await resetState()` at line 487 (which reaches `wipeAll()` at `lib/adapters/mock/store.ts:859` → `DELETE /state` at `lib/adapters/mock/persist.ts:418`), so no concurrent read can reload a pre-wipe record. Destructured names match the exports exactly (`resetAnonAttributionCache`, `resetSessionHandlesCache`), so neither is a silently-undefined no-op.

STILL SOUND, NOT REGRESSED (the thing the report asked not to lose): `resetChromeCache()` (route line 519) and `resetDeliveryCache()` (line 524) are both still after `await resetState()` on line 487.

WHAT I TRIED IN ORDER TO DEFEAT THE FIX, and could not:
1. Another wipe path that skips the cache resets. `wipeAll()` has exactly one caller (`store.ts:859`), `resetState()` has exactly one caller (`app/api/dev/route.ts:487`). The only other `DELETE /state` in the tree is `scripts/audit-preview-g0.mjs:159`, which is a NEGATIVE probe asserting the envelope-less call is refused, not a wipe.
2. Validator keeping its copy so the reset is cosmetic. `validator/server.js:553-559` deletes every `adapter_state` row for the anchor, so both namespaces really are wiped server-side.
3. A stale reference surviving the reassignment. Neither module holds a module-level alias; `loadAll()`/`load()` re-read `g.*` on every call, and no other module captures the Map or the Doc (only callers are `lib/session.ts:32`, `app/api/signer/route.ts:24`, `lib/zk/gate.ts:167`, `app/api/anon/route.ts:94`, all per-call).
4. Production reachability of a half-reset. Irrelevant — `resetSeed` is in `RIG_ONLY_ACTIONS` (route line 23) and the whole POST is 403 on a production build without `ZK_DEV_HOOKS` (lines 32-34).

ONE THING WORTH NAMING, NOT A RESIDUAL OF THIS FINDING: `save()` at `lib/zk/anonAttribution.ts:88` re-installs the caller's doc unconditionally (`g.__layersAnonAttribution = doc`), so a `sealSecretForPost` whose `await load()` resolved BEFORE a reset would, after the reset, re-seal its stale items and re-install the stale doc; `registerHandle()` has the identical shape (holds `map` across awaits, flushes the whole map at line 61). That is a concurrent-write interleaving, not "the next write", it needs an in-flight anon post or session registration racing a rig-only reset, and the exact same pattern exists in every other sealed cache in this registry including the two the report explicitly called sound. It belongs to the F-2 registry refactor, not to F-11.

NOT DONE, and not a defect: the F-2 `resetEverySealedCache()` single registry was not created — a repo-wide grep for that symbol returns nothing. The thirteen resets are still hand-listed in `resetSeed`. That is the suggested refactor to stop the bug class recurring, not the defect F-11 reported; the defect itself is closed.

## F-12 — OPEN (medium)

**Evidence.** Re-read in the current tree (working copy, HEAD = 6229339). All three limbs of F-12 still hold, and nothing in the acceptance scripts changed in response to it.

1) The vacuous switcher assertion is byte-for-byte the reviewed one. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\scripts\accept-pd2.mjs:274-279`, inside check 7 ("COMPARTMENT SUPPRESSES EVERY CROSS-PERSONA SURFACE, AT THE API"):

    274  // the OTHER roster (the session track) narrows by the same chokepoint; on this rig it
    275  // already holds one persona, so the assertion is that it never GREW and never emptied
    276  const people = (await api("GET", "/api/personas")).json;
    277  const n = (people?.personas ?? []).length;
    278  if (n > switcher0) throw new Error("the account switcher grew under compartment mode: " + switcher0 + " → " + n);
    279  if (switcher0 > 0 && n === 0) throw new Error("compartment mode emptied the account switcher instead of narrowing it");

`switcher0` is captured at `scripts/accept-pd2.mjs:132` from the same route BEFORE compartment is turned on, so with a one-persona session track both predicates are satisfied by `n === switcher0 === 1` whether or not `/api/personas` narrows anything. The comment at 274-275 still states this outright. `git diff HEAD -- scripts/accept-pd2.mjs` contains exactly one hunk, the `SIM.deuteranopia` matrix at line 91 — unrelated. The guard added at line 272 (`if (!(roster.length > 1)) throw ...`) protects the *act-as* picker assertion (a different roster, `/api/personas/act-as-options`), not this one, and predates the review. No second persona was added to the session track.

2) `data-scope` is asserted nowhere. It exists at `app/(main)/layout.tsx:181`:

    181  data-scope={scopeUnavailable ? "unavailable" : visibleIds && visibleIds.length === 1 && session.personas.length > 1 ? "compartment" : "normal"}

`grep -rn "data-scope\|scopeUnavailable\|visiblePersonas" scripts/` returns nothing at all. The surface F-4's fix was written for — layout.tsx:99-113 now has separate try/catch blocks with a fail-closed scope catch, commented "GATE 5 (attack-post-3 F-4)" — was fixed in the *source* and has zero checks behind it. Note also that `data-scope` only ever reads `"compartment"` when `session.personas.length > 1`, so on this rig (one session persona) the attribute reads `"normal"` under compartment mode anyway: the fix and the check would both need the second session persona F-12 asked for.

3) No pd script ever exercises an unreadable vault. `grep -n "corruptVaultCiphertext\|forceFail\|503\|resetChromeCache" scripts/accept-pd2.mjs scripts/accept-pd3.mjs scripts/accept-pd4.mjs scripts/accept-pd4-draft.mjs` returns nothing. Both hooks exist and are live in `app/api/dev/route.ts` (`corruptVaultCiphertext` at line 297, in RIG_ONLY_ACTIONS at line 23; `forceFail` at line 124) and are used by a dozen other suites (accept-a1, b3, g3, m3, mega2-g1, x0, x3), so the checks were available and simply were not written. Meanwhile the "never fail open" claim is asserted in module comments at `lib/identity/chrome.ts:111` and `lib/identity/chrome.ts:322` ("It does NOT fail open: if the chrome record cannot be read, `viewScope` throws"), `lib/readwise/state.ts:121`, `lib/zk/anonAttribution.ts:54` and `lib/adapters/mock/persist.ts:389`. The only pd2 reference to `personaChrome` is check 9 at `scripts/accept-pd2.mjs:344-351`, which asserts the namespace is ciphertext on the validator — not that an unreadable record refuses.

Attempts to defeat the finding (i.e. to find coverage elsewhere): searched all of `scripts/` for `data-scope`, `visiblePersonas`, `scopeUnavailable`, `viewScope`, `corruptVaultCiphertext`, and for any `feed2` + 503 pairing; searched the untracked `scripts/accept-pd4.mjs` (its 8 checks are all Readwise cadence/dwell/bin, none touch scope or vault failure); checked `git diff HEAD` for pd2/pd3 (colour matrix, and a pd3 change to the `deliveryOf` call-site count at lines 308-316 — a different finding). Nothing covers it.

**Residual.** A regression that widens the compartment roster or fails open passes the whole suite today. Concretely: (a) revert the scope `catch` at `app/(main)/layout.tsx:110-113` to `visibleIds = null` — the server render would then hand `Providers` the full `session.personas` while compartment mode is ON, and no check notices, because `data-scope` is unread and the only switcher assertion is `n > switcher0` with `switcher0 === n === 1`; (b) make `/api/personas` stop filtering under compartment — same two predicates still pass; (c) arm `corruptVaultCiphertext` (or `forceFail` on the `personaChrome` read) and request the feed — nothing in pd2/pd3/pd4 asserts a 503 rather than a 200 carrying unquieted posts, so a quiet-rules read that degrades to "nothing is quieted" ships green. The three checks F-12 asked for (armed-failure `data-scope` assertion, armed-failure `/api/feed2` 503, compartment-survives-a-failed-flush) are still unwritten, and the session track still holds one persona so the switcher assertion cannot become non-vacuous without seeding a second.

## F-15b — OPEN (low (structurally; it is the enabling half of a medium rollback path))

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\adapters\mock\persist.ts:393-411 — `flushVault` body still runs straight from the signature to header assembly with no seal bookkeeping: line 397 `  let headers: Record<string, string> = { "Content-Type": "application/json" };` is the first statement, and the whole body (397-410) is headers → `validatorFetch` PUT → throw on transport/!ok. Compare `flush()` at persist.ts:368-373, whose line 373 is `  markSealed(ns);`. `markSealed` (persist.ts:357) is therefore reachable ONLY from `flush()`. Other side: store.ts:712 `    for (const [ns, serializer] of Object.entries(SERIALIZERS) as [Namespace, Serializer][]) {` with `const SERIALIZERS: Record<Namespace, Serializer>` (store.ts:365), so the Gate 5 guard at store.ts:725 (`if (sealedNamespaces().has(ns) && !looksSealed(...))`) is never evaluated for any `ExtraNamespace`. Both halves of the claim hold. Cross-check of every caller: the only `flush()` call sites are store.ts:691 (non-vault branch of `persistNs` — store.ts:685 routes `isVaultNamespace(ns)` to `flushVault` instead), store.ts:703 (`modes`), sessionHandles.ts:61, app/api/device/route.ts:83, app/api/recovery/route.ts:108. So no vault namespace — not even the SERIALIZERS-registered ones (`privatePosts`, `grantsV3`, `zkQueue`, …) — is ever recorded as sealed, and the three ExtraNamespaces that DO get marked (`sessionHandles`, `deviceLinks`, `seedEscrow`) are marked but never consulted. `sealedNamespaces()` has no other reader in the repo (grep: persist.ts:348/358, store.ts:718/725 only). Change since the review: the only edits to these files are uncommitted and enlarge the gap — `readwiseState` added to `ExtraNamespace` (persist.ts:109) and to `VAULT_NAMESPACES` (vault.ts:111), i.e. a new flushVault-only, hydrate-invisible namespace holding per-paragraph dwell. No fix to defeat; I looked for an alternative first-run marker (grep for `sealed-namespaces`/`everWritten`/`firstRun` across lib, app, scripts, validator) and found none, and checked lib/device/boot.ts-era local-pin machinery — device-local pins exist only for zkQueue's budget/anchors, not as a per-namespace "this device has written here" record.

**Residual.** The reachable gap is the empty-read case, and it is worse than the report assumed because the validator never answers 404: `validator/server.js:503-514` (GET /state/:namespace) SELECTs the rows and unconditionally `res.json({ entries })`, so an operator who deletes the namespace's rows gets `200 {"entries":{}}`. In `lib/identity/chrome.ts` the F-1 guard added at :80-92 only fires inside `if (entries && Object.keys(entries).length)`; an empty `entries` falls to the `else { doc.loaded = true }` at :100-102, so `load()` returns `{tints:{}, unified:false, compartment:false, loaded:true}` — compartment mode silently OFF, every cross-persona surface re-enumerating siblings — and the next `save()` (chrome.ts:124-141) seals that emptiness over the real record permanently. Identical shape in `lib/delivery/tiers.ts:57-76`: deleted rows read as "every account is normal", un-quieting accounts the owner turned down. Same for the other flushVault-only modules (zones/store.ts, influence/allowance.ts, x/porting.ts, attest/vault.ts, zk/anonAttribution.ts, fc/personaFid.ts, identity/rootRoster.ts, readwise/state.ts). Nothing in the codebase can distinguish "this device sealed personaChrome and the operator deleted it" from "first run" because `flushVault` never populates the set and the Extra modules never read it; the F-1 fix deliberately only covers "records present, none readable". Closing it needs both halves the review named: `markSealed(ns)` in `flushVault` (after the write succeeds, so a refused write does not mark), and each Extra module's `load()` consulting `sealedNamespaces()` before accepting an empty/absent namespace as first-run.

## F-2 — OPEN (medium)

**Evidence.** Decisive line, `app/api/persona/chrome/route.ts:68` (current working tree, uncommitted state on top of a9d0b3d):

      const r = await setTint(String(body.personaId ?? ""), String(body.color ?? ""), await ownIds());

`ownIds()` is defined at `app/api/persona/chrome/route.ts:29-32` as a direct pass-through to `ownPersonaIdsAll()` — the unscoped full roster. The tint branch (route.ts:67-75) never calls `viewScope`, never calls `visibleOwnPersonaIds`, and never reads `doc.compartment`.

The consumer is unchanged from the review: `lib/identity/chrome.ts:205-240`. Control flow for a probe naming the ACTIVE persona:
- 206-207: hex shape check, 400/`malformed` on a bad hex.
- 208-209: `if (!ownIds.includes(personaId))` → 403/`not_own`. The active persona IS in the roster, so this never fires for the probe.
- 216: `const current = await tintsFor(ownIds);` — the full roster, so every sibling gets a resolved colour (chosen or deterministic auto).
- 217-234, the oracle itself:

    for (const id of ownIds) {
      if (id === personaId) continue;
      const other = current[id];
      if (!other) continue;
      const sep = separation(color, other.color);
      if (sep.distance < MIN_SEPARATION)
        return { ok: false, code: "collides", reason: "that colour is indistinguishable from another persona's under " + sep.model + " (distance " + sep.distance.toFixed(1) + ", the cue needs " + MIN_SEPARATION + ") — pick another, or change that persona's first" };

Route mapping at `route.ts:72` turns `collides` into a distinct **409** (400 for malformed, 403 for not_own), so the three outcomes are cleanly separable by status code alone. `separation()` (`lib/identity/colorVision.ts:66-75`) returns the worst-model distance and names the model; `MIN_SEPARATION = 12` (`colorVision.ts:79`). `TINT_PALETTE` is exported and also returned verbatim by GET (`route.ts:49`), and `tintsFor`'s deterministic walk (`chrome.ts:178-197`) maps accent back to roster position.

Adversarial checks I ran, all negative:
1. Grepped every `setTint` caller: only `route.ts:68` and `app/api/identity/fork/route.ts:325,338` — the fork path also passes the unscoped `[...(await ownPersonaIdsAll()), created.id]`.
2. The Gate 5 fix that DID land (`git diff HEAD -- app/api/persona/chrome/route.ts`) touches only **GET**: it adds `const visible = new Set(scope.visiblePersonaIds)` and a `.filter((id) => visible.has(id))` over the response list. It does not touch the POST tint branch, and the comment it adds at route.ts:39-43 explicitly preserves the unscoped ASSIGNMENT ("only the ANSWER is narrowed") — which is exactly the leak channel POST re-exposes.
3. The scoped helper the codebase now standardises on, `visibleOwnPersonaIds()` (`chrome.ts:326-333`), is adopted by six other routes (disclosure, fc/persona, lenses, personas/bindings, x/port) but NOT by the route that implements compartment mode.
4. No middleware gate: `middleware.ts` exists but the chrome route has no rate limit or per-action scope check.
5. Zero-sibling case confirms the oracle's sensitivity: with a single persona the loop body never runs, so every well-formed probe returns 200. A single 409 anywhere over the 8-entry palette proves a sibling exists.

SEPARATE SUB-CLAIM, also OPEN and unchanged: `lib/identity/chrome.ts:210-211` still reads "A COLOUR THAT COLLIDES WITH A SIBLING'S IS REFUSED, and the refusal names the / sibling and the vision model it collapses under." The emitted string (chrome.ts:227) says only "another persona's" — no handle, no id. The comment overstates the disclosure and should be corrected to match.

**Residual.** The full probe still works on the current source. Under compartment mode, a caller who only ever names the active persona: POST /api/persona/chrome {"action":"tint","personaId":"<active>","color":"#xxxxxx"} repeatedly. 403 never fires (active is own), so no ownership check gates the loop. A 409 with code "collides" proves at least one non-active persona exists on the device, and the reason string hands back the worst-case vision model plus the exact dE to one decimal — a hard constraint sphere around a sibling's accent. Walking the 8 public TINT_PALETTE entries plus a few dozen bisecting probes localises each sibling accent to within ~1 dE, and because tintsFor's auto walk is deterministic in roster order, a localised accent maps back to roster position and therefore bounds the sibling COUNT. Each probe that returns 200 also persists the tint, but the attacker can restore state via the clearTint branch.

Adjacent, same route, same class, worth fixing in the same edit: the clearTint branch (route.ts:76-81) calls `clearTint(personaId)` with NO ownership check at all (chrome.ts:243-250 checks only `personaId in doc.tints`), then answers with `tints[String(body.personaId)] ?? null` computed from the unscoped `tintsFor(await ownIds())`. A non-null answer is a second existence oracle over own persona ids, and the call destroys a sibling's chosen tint as a side effect.

Note on the shape of any fix: narrowing the collision set to `scope.visiblePersonaIds` does NOT work here — it would let a compartment-mode pick land on a hidden sibling's accent and silently defeat the cue the whole gate exists for. The two honest fixes are (a) refuse tint edits outright while compartment is held ("leave compartment mode to change accents"), which is uniform and leaks nothing, or (b) keep the full-roster check but make the compartment-mode refusal non-informative — same status for collides and for a generic refusal, no model, no distance — and accept that even a bare refusal is a weak existence bit. (a) is the only one that closes it.

## F-5 — OPEN (medium)

**Evidence.** lib/x/porting.ts is byte-identical to commit d3d183c (`git diff -- lib/x/porting.ts` is empty). The predicate is unchanged at lib/x/porting.ts:233:

    if (!ownIds().has(p.fromPersona)) throw new Error("only the persona that issued the port can confirm it");

Read with control flow (lib/x/porting.ts:223-248): `export async function confirmPort(portId: string, accept: boolean)` — the signature still takes no acting persona, so line 233's message ("only the persona that issued the port") is not what line 233 enforces. `ownIds()` (line 114) is `new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])`, the device's whole own set, and `runRelationshipPort` (line 133) already refused creation unless `own.has(fromPersona)`, so the check is vacuous for every port in the vault. Nothing between lines 224 and 242 reads the active persona; the flow goes status checks → line 233 → `issueGrant({ fromPersona: p.fromPersona, toPersona: p.toPersona, audienceMember, tier: "whitelist" })` at line 242.

Caller, app/api/x/port/route.ts:41: `const port = await confirmPort(String(body.portId ?? ""), body.action === "confirm");` — still no acting-persona argument, in a file that imports and uses `activeSeedPersonaId` on lines 14 and 46. It is the only caller (`grep -rn confirmPort` finds route.ts:41 and the definition). `resolvePendingPorts` is called once, from lib/x/attestations.ts:99, and its return value is discarded, so port ids do not leak to the counterpart — the portId must come from the device.

What DID change since the review is a different finding's fix: `git diff -- app/api/x/port/route.ts` shows the GET now scopes the listing (route.ts:21-23, "GATE 5 (attack-post-1 F-3)"), `const scoped = ports.filter((p) => visible.has(p.fromPersona) || visible.has(p.toPersona));`. That narrows one enumeration path but does not touch the authorization defect.

I tried to defeat that scoping, two ways, both succeed:
1. In-scope, no bypass needed: the filter is an OR over both parties. A port whose `toPersona` is the active persona A but whose `fromPersona` is sibling B is still listed to A with its `id`, and `confirmPort` then issues B's grant — the exact acting != issuer case, entirely within compartment mode.
2. The scope is one unauthenticated POST away: `setCompartment` (lib/identity/chrome.ts:345-351) does no authorization, and app/api/persona/chrome/route.ts:97-98 exposes it as `POST {action:"compartment", on:false}`. Any caller that can reach /api/x/port can first turn compartment mode off, GET every port id on the device, turn it back on, and confirm. middleware.ts is a rate-limiter and maintenance switch only (no auth), so the same client reaches both routes.

No fix is present to defeat beyond that; `grep -rn "actingPersona\|actorPersona"` over lib/x/ and app/api/x/ hits only lib/x/migration.ts, an unrelated function.

**Residual.** confirmPort still never consults the acting persona. Concrete path, no bypass required: device in compartment mode scoped to persona A; sibling B holds an awaiting-confirmation port B→A (B is `fromPersona`, A is `toPersona`). GET /api/x/port lists it anyway because route.ts:23 filters on `visible.has(p.fromPersona) || visible.has(p.toPersona)` and A matches the second disjunct. POST /api/x/port {"action":"confirm","portId":"port_…"} passes line 233 (B is in the device's own set), reaches line 242, and issues the whitelist linkage grant fromPersona B → toPersona A to the counterpart — a disclosure B never authorized. Second path, for a port where A is neither party: POST /api/persona/chrome {"action":"compartment","on":false} (unauthenticated, chrome/route.ts:97), GET /api/x/port for the now-unfiltered ids, then confirm as above. Fix is still the one named in the report: give confirmPort an `actingPersonaId` from `activeSeedPersonaId()` and assert `p.fromPersona === actingPersonaId`.

## F-5 — OPEN (medium)

**Evidence.** The seeded pin hoist in `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\feed.ts` is unchanged in mechanism; only line numbers moved (+17 from the review's ~577-587). Lines 591-608 now read:

591: `const pinCap = Math.max(1, Math.floor(limit / 4));`
594: `for (const p of eligible) {`   <-- DECISIVE: selection scans the whole filtered corpus, not the built window
595: `    if (!pinned.has(p.hash) || seenAuthor.has(p.authorPersonaId)) continue;`
601: `const ordered: SeedPost[] = [...pins];`
602: `const pending = eligible.filter((p) => !pinSet.has(p.hash));`
603: `while (ordered.length < limit && pending.length > 0) {`

`limit` defaults to 40 (line 578). `eligible` is the whole hide-filtered corpus (built 504-561, sorted 563-567). So a pin is chosen by corpus rank, and because `ordered` starts at `pins.length` while the diversity walk still stops at `limit`, each pin costs exactly one walk pick. Both halves of the finding hold: a post the page did not hold is hoisted to index 0, and the post that would have taken the last slot is dropped.

I checked for a fix and found none: no `attack-post-2 F-5` marker anywhere (feed.ts carries markers for F-1 at 410, F-2 at 568, F-3 at 684, F-8 at 1414, F-9 at 398 — F-5 is absent), nothing in `docs/internal/assumptions.md` or `docs/internal/passes/18-post-deploy.md` about never-miss, and no new assertion in `scripts/accept-pd4.mjs` / `accept-pd4-draft.mjs` (neither file mentions pins at all).

Reachability confirmed offline without running anything: `seed/data/posts.json` holds 410 posts; re-implementing `baseRankTerms` (feed.ts:203-224) with the Default mode weights (`lib/adapters/mock/presets.ts:91`, recency .4 / engagement .3 / affinity .2 / cluster .1) and the seed viewer from `seed/data/viewer.json` puts `persona_acc_fantasy_5`'s 15 posts at corpus ranks 269, 296, 305, 330, 340, ... — best score 0.4733 against 0.7481 at rank 40. On the `following` surface `discoveryHides` returns false at feed.ts:458 (`if (opts.surface !== "discovery") return false;`), so the tier-1 account stays eligible. Nothing downstream restores the evicted post: `eligible` is not referenced again after line 614 (the banner strip), `injectIntoFeed` only adds non-post cards, and the final sort (874-908) reorders `cards` in place.

The contradiction the finding names is still live in the docs: `notes/reports/REPORT-POST.md:159` (D-POST-3-A-TIER-REORDERS-AND-NEVER-RESURRECTS) still says "Pinning acts on the posts the feed already holds", while `notes/reports/REPORT-POST.md:186` (iteration 3) records the opposite as deliberate — "the strip and the pin draw from the build's ELIGIBLE set, which is wider than the page on purpose". D-POST-3-A's asserted content is only about the caught-up case (a SEEN post does not come back, via the `fresh` filter at feed.ts:1390-1418), so the out-of-window hoist is untested, and the eviction consequence is asserted nowhere.

Suite coverage is still what the finding said, and is weaker than claimed: `scripts/accept-pd3.mjs:95` requires `before > 0` — the target account is already on the page — and line 108 is the only composition assertion: `if ((after.cards ?? []).length > baseCards.length) throw new Error("pinning grew the page: ...")`. An even trade passes.

I tried to defeat the finding three ways and failed: (1) no later code re-adds a dropped post; (2) the cap does not help — `pinCap` bounds how many slots are stolen, not whether any are; (3) the "by design" reading does not cover it — the one place the codebase does implement the correct shape is the NEW live-path hoist added in the working tree at lib/feed.ts:884-899, which iterates `for (const c of cards)` (the built window) and only adds to `pinSet`, i.e. pure reorder with no membership change. The seeded hoist twenty lines' worth of comments above it was not brought to that shape.

**Residual.** Still fully reachable. Repro (no code change needed): reset the seed, stay on the `following` surface in Default mode, set `persona_acc_fantasy_5` (tier 1, viewer does not follow it, all 15 of its posts rank 269th or worse of 410) to never-miss in the active mode. `pins` is populated from `eligible` at lib/feed.ts:594, so its rank-269 post becomes `ordered[0]`; the walk at 603 then fills only 39 more slots from `pending`, so the post that occupied `baseCards[39]` is no longer on the page. Net: one post added that the feed did not hold, one removed that it did — page length unchanged, which is why accept-pd3.mjs:108 passes. Fix shape already exists in this file: select pins from the built window the way the live-path hoist at 884-899 does (build `ordered` first, then reorder within it), or keep corpus-wide selection and raise the walk bound to `limit` non-pin picks so a pin never evicts — but note the second option makes the page grow, which contradicts the one assertion the suite does make.

## F-6 — OPEN (medium)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\x\porting.ts, confirmPort() lines 223-248, unchanged since commit d3d183c (`git diff` on the file is empty). The gap is exactly as reported — the guard at 232, the await at 242, the write at 244:

  232:  if (p.status !== "awaiting-confirmation") throw new Error("this port is " + p.status + ", not awaiting confirmation");
  242:  const grant = await retryAdapter(() => adapters.identity.issueGrant({ fromPersona: p.fromPersona, toPersona: p.toPersona, audienceMember, tier: "whitelist" }));
  244:  p.status = "issued";

Nothing between 232 and 242 mutates p, so no caller can observe that a confirm is in flight. There is no transient `issuing` state and no per-port in-flight set: `grep -n "issuing\|lock\|inflight\|in-flight" lib/x/porting.ts` returns nothing. The codebase has the in-flight pattern (lib/fc/writes.ts:392 `const inFlight = new Map<...>()`) but it is not applied here.

The shared-object premise also still holds: lib/x/porting.ts:75 `if (g.__layersPorts) return g.__layersPorts;` — every caller gets the same Doc, so both requests mutate the same `p`.

The window is wide, not theoretical: issueGrant goes through withMockLatency (lib/adapters/mockUtils.ts:44-45, `const delay = lo + rand() * (hi - lo); await new Promise((resolve) => setTimeout(resolve, delay));` — default [200, 1500] ms on the rig), and outside the rig it still yields on `await hydrate()` and on the signing path.

Grant ids are content-derived, not random: lib/identity/grants.ts:97-100 hashes the issuance canonical, which includes `String(g.issuedAt)` (line 87). Two confirms that resume in different milliseconds therefore produce two DISTINCT ids, both stored by lib/adapters/mock/identity.ts:125 `state().grantsV3.set(grant.id, grant);`. Only same-millisecond issuance collapses to one row. p.grantId (line 243) is last-writer-wins, so the other row is not named by the port.

`flushVault` (lib/adapters/mock/persist.ts:393-411) is an unserialized PUT of a whole-namespace snapshot with no queue and no version check, so concurrent saves race at the validator on last-arrival.

Route surface confirms both requests are reachable concurrently: app/api/x/port/route.ts POST dispatches `body.action === "confirm" | "decline"` straight into confirmPort with no gating.

**Residual.** Consequence (1) is fully reachable in one process, as reported. Two POSTs of {"action":"confirm","portId":X} issued within the issueGrant latency window (200-1500 ms on the rig): both pass line 232, both reach line 242, two whitelist grants for the same (fromPersona, toPersona, audienceMember, "whitelist") land in grantsV3 with different ids, and the port records only one. The harm is not the duplicate itself (same disclosure) but revocation: the user revokes the grantId the port names, resolveLinkage still finds the second live grant, and the linkage keeps resolving while the receipt says it was withdrawn. One correction to the review's wording — the orphan is not absolutely unrevokable: GET /api/identity/grant?personaId=<fromPersona> (app/api/identity/grant/route.ts:21-31) lists every grant for the persona, so a user who knows to look there can revoke it by id. It is unrevokable through the port surface only.

Consequence (2) as literally worded ("ends with status 'declined'") is NOT reachable through the in-memory object, and the review overstates it. I tried to defeat it and could not construct the interleaving: the decline branch's guard (232) and its write (235 `p.status = "declined"`) have no await between them (line 233 ownIds() -> keystore ownPersonaIds() at lib/identity/keystore.ts:483 is synchronous), so on a single-threaded loop a decline either lands before the confirm's write — in which case the confirm resumes and overwrites with "issued" — or lands after it and is rejected by 232. The in-memory end state is always "issued".

What IS reachable is the same defect one layer down, and it is still a receipt that lies safe:
(a) Persisted state. Confirm A suspends at 242. Decline B passes 232, writes "declined"/resolvedAt, and calls save(doc), which serializes {status:"declined", grantId:null} synchronously inside save before its own await. A resumes, writes "issued"/grantId, and calls save with {status:"issued"}. Two unserialized PUTs to /state/relationshipPorts are now in flight; if B's arrives last, the vault holds `declined` with resolvedAt set and grantId null while the whitelist grant is live. The process cache masks this until a restart or resetPortsCache(), after which load() rehydrates the lying receipt.
(b) HTTP responses. Both handlers serialize the same shared `p` after their own await, so the decline's 200 response can render `status:"issued"` (A resumed during B's flush), or the confirm's response can render a port the caller was simultaneously told was declined. The two receipts for one port disagree.

A minimal fix that closes both: set a synchronous transient (p.status = "issuing", or a per-port Set<portId> guard) immediately after line 232 and before the await, restore the prior status on the issueGrant failure path, and treat "issuing" as non-confirmable and non-declinable at 232. That alone does not fix the unserialized flushVault last-writer-wins, which is a separate, broader hazard for every namespace.

## F-6 — PARTIAL (medium as filed; the surviving residual is low (documentation-only, no exploit path))

**Evidence.** F-6 has three parts and they have diverged. Part 1 (the headline doc/code contradiction) is CLOSED, but by the CODE moving to the document, not the reverse — so the fix F-6 asks for must NOT be applied, it would make the posture wrong.

1) The contradiction is gone. `lib/feed.ts:398-407` (current tree, uncommitted edit) now contains the decisive change:
```
398  // GATE 5 (attack-post-2 F-9): an unreadable tier map threw straight out of buildFeed and
399  // 503'd the ENTIRE timeline. ... it contradicted the posture, which promised "delivers everything Normally".
400  // The module still refuses to treat an unreadable vault as empty; the FEED degrades to
402  // Normal delivery and keeps working, which is what the posture now says.
403      try {
404        deliveryMap = await tierMapFor(mode.id);
405      } catch {
406        deliveryMap = new Map();
407      }
```
`lib/delivery/tiers.ts:88-93` still throws ("Never fail open ... refusing rather than treating the vault as empty"), but the feed contains it. I tried to defeat the containment: `tierMapFor` is the ONLY tiers.ts call inside `buildFeed` (grep: lib/feed.ts:396, 404, 412 are the only hits), `compileDeliveryRules`/`QUIET_PENALTY`/`deliveryOf` are pure and cannot throw on an empty map, `deliveryRules` is gated on `deliveryMap.size`, and the module-level `await import(...)` at :396 is outside the try but cannot fail from a vault error. `app/(main)/home/page.tsx:110-111` sets `loadError` only from `buildFeed`, and nothing on that page fetches `/api/delivery`, so the 503 path F-6 described (`/api/feed2` → 503 → `loadError`) is no longer reachable from an unreadable tier vault. The only 503 left is `app/api/delivery/route.ts:80-82`, which is the management screen, not delivery — consistent with the assumption's wording.

2) STILL OPEN, verbatim untouched — `SECURITY-POSTURE.md:1697`:
   "validator learns; the vault records this pass adds (`personaChrome`) are"
The pass adds three: `lib/identity/chrome.ts:22` (`personaChrome`, commit a9d0b3d gate 2), `lib/delivery/tiers.ts:31` (`VAULT_NS = "deliveryTiers"`, commit 6229339 gate 3), and `lib/readwise/state.ts:26` (`VAULT_NS = "readwiseState"`, gate 4, untracked/in flight). `git diff SECURITY-POSTURE.md` shows the only working-tree change to §17 is the heading gaining the readwise clause; the opening paragraph and the assumption body were not edited.

3) STILL OPEN — `SECURITY-POSTURE.md:1716-1723` ("What compartment mode does") lists the four surfaces that narrow at the API and says nothing about the view toggle. D-1's underlying code facts are unchanged: `lib/identity/chrome.ts:307` `visiblePersonaIds: compartment ? [activePersonaId] : ownIds` (switcher / act-as ignore `unified`) vs `lib/search/unified.ts:102` `personaIds: sc.unified ? roster : [active]` (the index is the one surface the toggle narrows).

4) The clause F-6 quotes, `SECURITY-POSTURE.md:1830-1831` ("a device that cannot read the vault delivers everything Normally rather than guessing"), is now an ACCURATE description of the feed path and should be left alone.

**Residual.** Two documentation inaccuracies from F-6 survive verbatim and are the whole remaining fix: SECURITY-POSTURE.md:1697 names one vault namespace (`personaChrome`) where the pass adds three (`deliveryTiers`, `readwiseState`), and §17's compartment section (1716-1723) still does not say that the cross-persona view toggle narrows exactly one of the four surfaces (the search index) while the other three narrow only under compartment mode. Neither is exploitable; both mislead a reader auditing the vault surface or the scope model.

Two adjacent observations the re-check turned up, outside F-6's scope but created by the fix to it: (a) `lib/delivery/tiers.ts:85-87` still says "Never fail open ... would quietly un-quiet an account the owner turned down", which is now false of the delivered behaviour — the feed's catch at lib/feed.ts:405-406 performs precisely that un-quieting, so the inaccurate text has moved from the posture into the module comment; (b) the degradation is SILENT — `grep -rn deliveryStale` over app/lib/components/scripts/docs returns nothing, so the labelled-degradation the F-9 fix note recommended was not built, and a viewer whose vault is unreadable sees quieted accounts at full weight with no indication. F-6 does not cover either, but part 1's closure rests on them.

## F-6 — OPEN (medium)

**Evidence.** The cross-root UNION is untouched. lib/feed.ts:408-412 (current tree, working copy):

408  const allowed = new Set<string>();
409  for (const set of facetScopedRoots.values()) for (const c of set) allowed.add(c);
410  // GATE 5 (attack-post-2 F-1): compile only the tiers actually in use — see the note in
411  // lib/delivery/tiers.ts about what compiling the facet-only rule unconditionally cost.
412  deliveryRules = deliveryMap.size ? compileDeliveryRules([...allowed], new Set(deliveryMap.values())) : [];

`compileDeliveryRules` did change since the review, but only in the way F-1 asked: its new second parameter is `tiersInUse` (lib/delivery/tiers.ts:221, `export function compileDeliveryRules(allowedClusters: string[], tiersInUse: ReadonlySet<DeliveryTier>)`), gating WHICH rules are compiled. The facet-only clause body is byte-for-byte the flat list F-6 named — lib/delivery/tiers.ts:247: `{ field: "author.cluster", op: "in", value: allowedClusters.length ? allowedClusters : [" none"] }` under a `negate: true` OR, i.e. still NOT(author.cluster in <global union>). It never receives a rootId, so it cannot be per-root. attack-post-2.md:683 says so in its own words: the bug is the contents of `allowed`, not the rule shape — and the contents are unchanged.

The two per-root checks F-6 contrasted it with are also unchanged, only renumbered: lib/feed.ts:524-527 (`if (author && facetScopedRoots.has(author.rootId)) { const allowedClusters = facetScopedRoots.get(author.rootId)!; if (!allowedClusters.has(author.cluster)) continue; }`) and app/api/delivery/route.ts:35 (`if (m && m[1] === rootId) out.push(m[2]);`). `deliveryOf` (lib/feed.ts:414) is still `deliveryMap.get(authorPersonaId) ?? "normal"` — no post-specific facet-only-out tier was introduced.

Consequence 1 (dead code) still holds on the seeded path: setTier (lib/delivery/tiers.ts:186-191) still refuses facet-only when `facetFollowed.length === 0`, and the route computes that per root, so the target's root is in facetScopedRoots at write time; the continue at 527 then removes every persona of that root outside the per-root set, and the per-root set is a subset of `allowed`, so the surviving author's cluster is always in `allowed`, the negated OR is always false, the AND is always false. Hides nothing.

Consequence 2 still holds: nothing prunes the tier when the facet-follow is dropped. app/api/disclosure/facets/route.ts:30 calls `adapters.disclosure.unfollowFacet`, and lib/adapters/registry.ts:108 persists only `["followedFacets"]` — the tier vault is not touched. `evaluateGroup` (lib/rules/evaluate.ts:172, `return group.negate ? !combined : combined`) and the `in` op (evaluate.ts:155-156, `includes(actual)`) give exactly the two wrong directions.

I confirmed the repro's ingredients in the shipped seed rather than assuming them: `seed/data/accounts.json` has persona_acc_food_1 (root_acc_food_1, cluster "restaurants") and persona_acc_food_2 (root_acc_food_2, cluster "restaurants"); the cluster name "restaurants" spans root_acc_food_1..4, "crypto" spans seven roots, "fantasy" spans six. The facet-id regex at lib/feed.ts:373 and the route's at app/api/delivery/route.ts:34 are the same, so facet_root_acc_food_2_restaurants parses to root root_acc_food_2 / cluster restaurants and lands in the union while root_acc_food_1 is no longer in facetScopedRoots.

What I tried in order to defeat the F-1 fix as though it were an F-6 fix: (a) hoping `tiersInUse` would prevent the rule existing in the leaked state — it does not, the tier is still in deliveryMap.values() after the unfollow, so the rule is still compiled and is now the ONLY facet check; (b) hoping the write-time refusal covered the read path — setTier runs once, the feed rebuilds on every request; (c) hoping some unfollow handler revoked the tier — grep of every followedFacets/unfollowFacet caller shows none; (d) hoping `[" none"]` was a fail-closed sentinel that merely errs safe — it is fail-closed in the wrong way, it hides every post that account makes, which is verbatim what setTier's `no_facet` refusal exists to prevent.

**Residual.** Three reachable paths, all on the current tree.

(1) Permissive leak, seeded path, exactly the filed repro: follow facet_root_acc_food_1_restaurants; POST /api/delivery {"personaId":"persona_acc_food_1","tier":"facet-only"} (accepted, route line 93-94 finds one facet on that root); follow facet_root_acc_food_2_restaurants; unfollow facet_root_acc_food_1_restaurants. root_acc_food_1 leaves facetScopedRoots so lib/feed.ts:524 no longer applies; `allowed` = {"restaurants"} from root_acc_food_2; persona_acc_food_1's cluster IS "restaurants", so the negated `in` is false and the hide clause never fires. The account is back at full volume while /settings/delivery still reads "facet only".

(2) Restrictive leak, same shape: after setting facet-only, unfollow every facet (or leave only facets whose cluster names differ, e.g. follow facet_root_acc_astro_1_astronomy instead). `allowed` is empty → the `[" none"]` sentinel → NOT(in) is true for every post → every post persona_acc_food_1 makes is hidden. That is the total blackout setTier returns 409 `no_facet` to prevent; it is reachable by two ordinary UI actions in the other order.

(3) A path the original finding did not name, and which breaks its own "dead code" claim: the LIVE cast branch has no per-root facet scoping at all. lib/feed.ts:675-710 filters live casts on hideReplies, blocked, discoveryHides and the compiled rules only — there is no `facetScopedRoots` check anywhere between 675 and 711 (the only other occurrences are 524 and 927, the seeded pass and the health-card `visible()` helper). So on live content the union IS the whole enforcement, and it leaks across roots even while the facet-follow is present and correct: with facet_root_acc_food_2_restaurants followed and persona_acc_food_1 set to facet-only via its own root's facet, an attributed live cast from persona_acc_food_1 in cluster "restaurants" passes at full volume, while the same author's seeded post is scoped out at line 527. The two paths disagree about the same author in the same build.

The fix the finding asks for is still the right one and is still not present: pass a per-root `Map<rootId, Set<cluster>>` (or resolve a post-specific `facet-only-out` tier at lib/feed.ts:414 where deliveryOf already has the author id and can reach personaById for the rootId), and apply facet scoping on the live branch too.

## F-7 — PARTIAL (medium)

**Evidence.** The file has been edited since the review (F-7's cited line numbers no longer land; lib/feed.ts is now 1507 lines). A fix DID land nearby, but it fixes the mirror half only and leaves F-7's own half open.

SEEDED BUILD, unchanged and unconditional — lib/feed.ts:614-616 (the rule pass that fills `bannered` runs at :557 before any live check, over the seeded `eligible` set):
    const previewStrip = eligible
      .filter((p) => bannered.has(p.hash))
      .sort((a, b) => a.minutesAgo - b.minutesAgo)

THE FIX THAT LANDED — lib/feed.ts:874-915, a block headed "GATE 5, second look at attack-post-2 F-3". It cites F-3 (live casts never reaching pin/banner), not F-7. It is purely ADDITIVE: after `cards` has been replaced by live casts at :750, it APPENDS live pin/banner entries to the existing seeded `pinSet` and `previewStrip`. It removes nothing. lib/feed.ts:899-903 is the decisive line:

    // and the banner tier's strip, which was likewise built from the seeded set only
    for (const c of cards) {
      if (previewStrip.length >= 6) break;

Because the seeded strip is already capped at 6 (:617 `.slice(0, 6)`), a viewer with six or more banner-tier seeded posts hits `previewStrip.length >= 6` on the first iteration and NO live entry is ever added. The strip stays 100% seeded. With fewer seeded banner posts the result is a MIXED strip — some live, some seeded — which is arguably a worse state than before, because the surface now looks live-aware while still carrying seeded rows.

NEITHER RETURN PATH GUARDS ON LIVE. The `live ? [] : ...` guard the finding asked for does not exist on either. lib/feed.ts:1474:
    return { cards: merged, mode, contentStale, lensId: activeLens.id, previewStrip, pinnedHashes: [...pinSet] };
and the exhausted path, lib/feed.ts:1459-1460:
    const stripHere = fresh.length ? previewStrip : [];
That ternary is the F-8 fix (its comment names "attack-post-2 F-8" — the exhausted-feed sibling) and it keys on `fresh.length`, not on `live`. `isLiveContent()` IS consulted elsewhere in this same region — :1376 `const live = isLiveContent();` drops seed-derived injections, and :1411 disables the caught-up branch in live mode — so the file still takes the opposite position for every other seed-derived surface. `live` is in scope at both return sites and simply is not applied to these two fields.

CLAIMS THE CODE STILL CONTRADICTS, both verified unchanged: SECURITY-POSTURE.md:1747 ("the banner tier's strip is drawn from the same eligible set the timeline was built from") and components/PreviewStrip.tsx:6-8 (same sentence). components/PreviewStrip.tsx:37 still renders `href={`/${it.handle}/status/${it.hash}`}` for a seeded hash the live timeline does not contain.

ATTEMPTS TO DEFEAT THE FIX / to argue it closed: (1) Could `eligible` be empty in live mode, making the seeded strip empty? No — `eligible` and the :549-558 rule pass are built from the seed corpus unconditionally, above and independent of the `if (isLiveContent())` branch at :650. (2) Could live casts crowd the seeded rows out? No — the loop only pushes while `length < 6` and never evicts; and only ATTRIBUTED live casts can enter `bannered` at all (:702 hands an unattributed stranger `delivery: { tier: "normal" }`), so a stranger-only live feed contributes zero. (3) Does the final sort neutralise it? No — the sort at :943-947 operates on `cards`; `previewStrip` is a separate returned field rendered at app/(main)/home/page.tsx:163, never reconciled against `cards`. (4) Is it test-covered now? No — `previewStrip` appears only in scripts/accept-pd3.mjs, all in seeded mode; the live-mode assertion attack-post-2 recommended was not added.

**Residual.** Repro as originally written still stands: data source neynar; POST /api/delivery {"personaId":"persona_acc_astro_1","tier":"banner"}; GET /api/feed2 or load /home. `bannered` fills with that persona's SEEDED post hashes at lib/feed.ts:557, `previewStrip` fills with up to six of them at :614, `cards` is then wholly replaced by live Farcaster casts at :750, the live top-up loop at :900 breaks immediately on `previewStrip.length >= 6`, and :1474 returns the seeded strip. The user sees a "Banner" strip of seeded persona posts above a live timeline, each linking to /{handle}/status/{hash} for a post not in the feed. With fewer than six seeded banner posts the strip is a silent MIX of seeded and live rows, which is harder to spot than the all-seeded case.

Second, distinct residual on pinnedHashes: seeded hashes are never removed from `pinSet`, so :1474 returns hashes absent from `cards` (no current UI consumer — grep finds none in app/(main)/home/page.tsx or components/FeedCards.tsx — so this is an API-response/test-surface defect, not a rendering one). It also partially re-opens F-3, the thing the Gate 5 block was written to fix: `pinCap = Math.max(1, Math.floor(limit / 4))` = 10 at the default limit of 40, and the seeded pin loop at :594-599 may consume that budget with seeded hashes, after which :890 `if (pinSet.size >= pinCap) break;` starves live pin-rule matches of every remaining slot.

Minimal close: at both return sites apply the `live` flag already computed at :1376 — `previewStrip: live ? liveOnlyStrip : previewStrip`, `pinnedHashes: live ? liveOnlyPins : [...pinSet]` — or, cleaner and immune to future callers, reset `previewStrip.length = 0` and `pinSet.clear()` at the top of the :874 block (before the live top-up loops) so both are rebuilt from `cards` alone whenever the live branch replaced them. Either way the accept suite needs the live-mode assertion (strip contains no hash absent from `cards`) that does not exist today.

## F-7 — PARTIAL (low (originally reported medium; the reported 0.2 dE path is closed, the surviving path is narrower))

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts, tintsFor lines 167-197 (uncommitted working-tree change on top of a9d0b3d) and setTint lines 205-240.

Half the asked-for fix IS present, verbatim as recommended. Line 184:
  const collides = (candidate: string) => [...taken].some((t) => separation(candidate, t).distance < MIN_SEPARATION);
and the walk at 190 uses it, so the `taken` test is perceptual, not `taken.has(color)`. I replayed the report's exact repro against the current code (own reimplementation of colorVision.ts arithmetic, pure computation): roster [C,A,B], A chosen `#f4a525`, now yields C `#1d9bf0`, A `#f4a525`, B `#0f5c3a` — B steps past `#f4a524` because separation(#f4a524,#f4a525)=0.077 < 12. The 0.2 dE collision the report describes is gone. Other callers all pass the full roster (app/(main)/layout.tsx:93 `own.includes(actingId) ? own : [...own, actingId]`, app/api/persona/chrome/route.ts:44/68 via ownPersonaIdsAll(), app/api/identity/fork/route.ts:325/335), and setTint/clearTint are the only writers of doc.tints (nothing in lib/identity/clone.ts copies a tint), so there is no subset-roster hole in the guard.

The OTHER half is absent, and the decisive line is the loop bound at chrome.ts:190-196:
      for (let n = 0; n < TINT_PALETTE.length && collides(color); n++) {
        cursor++;
        color = TINT_PALETTE[cursor % TINT_PALETTE.length];
      }
      taken.add(color);
      cursor++;
      out[id] = { personaId: id, color, source: "auto" };
After a full lap the loop falls out and assigns `color` ANYWAY, still colliding, with no flag: source stays "auto" and the GET at app/api/persona/chrome/route.ts:50-58 returns it as an ordinary tint. setTint still verifies only the PRE-write assignment (line 216 `const current = await tintsFor(ownIds);`) and never re-runs tintsFor after `await save(doc)` at line 238.

**Residual.** The auto-walk can still hand a sibling a colour below MIN_SEPARATION of an ACCEPTED chosen colour — the same mechanism as F-7, via the exhaustion fallback instead of string equality, and it is reachable at six personas.

MIN_SEPARATION is 12 and the palette's min pairwise worst-model distance is 15.0, so a single hex can sit inside 12 of TWO palette entries. A grid search found six such pairs, e.g. #00e8c0 (blue+lavender), #d0d000 (amber+pink), #000840 (pine+ink). Each is accepted by setTint as long as no sibling currently HOLDS one of the two entries it covers — which is true while the roster is small, and personas are created afterwards by /api/identity/fork.

Replayed against the current algorithm, all six steps are what the code does today:
  1. roster [P0,P1,P2], all auto -> blue, amber, pine
  2. POST {action:"tint", personaId:"P0", color:"#00e8c0"} -> ACCEPTED (200)
  3. POST {action:"tint", personaId:"P1", color:"#d0d000"} -> ACCEPTED
  4. POST {action:"tint", personaId:"P2", color:"#000840"} -> ACCEPTED
  5. fork P3, P4 -> auto #7f1d1d, #536471 (fine; worst pair 27.2)
  6. fork P5 -> every palette entry now collides, the loop at chrome.ts:190 gives up and assigns TINT_PALETTE[cursor] = #1d9bf0. separation("#00e8c0","#1d9bf0") = 3.29 — below the 4.1/4.3 the colorVision header calls "a coin flip", and far below the 12 the control enforces. P0 and P5 are indistinguishable, silently, source "auto".

Note the recommended setTint post-write re-check would NOT catch this: each setTint is collision-free at the moment it is written; the collapse arrives when a later persona is forked. The missing guard is in the walk itself (refuse/mark rather than assign a colliding entry after a full lap), plus a degraded-assignment signal in Tint so the UI can say so.

Sharper still, the system already DETECTS this collision and then discards the detection: app/api/identity/fork/route.ts:335-339 computes `picked` from tintsFor, calls `setTint(created.id, picked.color, ids)`, which refuses with code "collides", and then falls back to `tint = persisted.ok ? { ...persisted.tint } : { ...picked };` — reporting the colliding colour as the new persona's tint anyway, unpersisted, and every later render re-derives the same colliding colour from the walk.

Floor case, no adversary and no chosen colours at all: a 9th persona gets TINT_PALETTE[0] again — P0 and P8 both #1d9bf0, dE 0, source "auto", silently. That one is documented at chrome.ts:188-189 ("after a full lap the palette is exhausted and a repeat is honest — the pill is still the real signal") and is defensible as an assumption; the six-persona 3.29 dE case above is not, because it is produced by the control that exists to prevent it, from inputs the API returned 200 for.

**Proposed assumption.** A-POST-TINT-PALETTE-EXHAUSTION — with more personas than the eight-entry palette can separate, the auto tint walk repeats a palette entry rather than inventing an unmeasured colour; the persona pill, not the accent, remains the authoritative cue. (Covers only the no-chosen-colour 9th-persona repeat; it does NOT cover the six-persona case in `residual`, where an accepted chosen colour drives the walk below MIN_SEPARATION.)

## F-8 — PARTIAL (medium)

**Evidence.** A fix was added at C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\search\unified.ts:91-102 (git diff shows it is the only change to this file): `const roster = own.includes(active) ? own : [...own, active];` then `personaIds: sc.unified ? roster : [active],` (line 102). It widens only the UNIFIED branch and the ownIds handed to viewScope. The collector was not touched, and it is the decisive line — unified.ts:151: `const own = scope ? all.filter((id) => scope.personaIds.includes(id)) : all;` with `const all = await ownPersonaIdsAll();` at line 150. With the cross-persona view off (the documented DEFAULT, and what compartment mode forces) scope.personaIds is `[active]`, so when active is a roster-minted persona the intersection with ownPersonaIdsAll() is [] exactly as before: GET /api/search/unified?status=1 answers indexed 0, personas [], scope {unified:false, compartment:false, activePersonaId:<roster id>, personaIds:[<roster id>]} — and SearchScope carries no `reason`, so nothing at all distinguishes "no records" from "active persona outside the scoped universe". Reachability re-verified in the current tree: app/api/personas/route.ts:34-36 creates through lib/validator.ts:113 (HTTP to the validator) plus recordPersona(), never the keystore, so the persona is absent from ownPersonaIdsAll() (lib/influence/allowance.ts:124-128 = SEED_VIEWER.personas ∪ keystore ownPersonaIds()); app/api/seed-persona/route.ts:18-19 accepts it against session.personas, calls allowActingAs (line 39) and warms personaById (41-46), so activeSeedPersonaId() returns it via mayActAs (lib/activePersona.ts:44,57-73). Records really do exist under that id (app/api/block/route.ts:32 `actorPersonaId: activeSeedPersonaId()`, folders ownerPersonaId, dmRequests), so the empty index is not vacuous. viewScope still does NOT assert its precondition: lib/identity/chrome.ts:298-310 takes (activePersonaId, ownIds) and returns `visiblePersonaIds: compartment ? [activePersonaId] : ownIds` with no membership check; the union is done ad hoc by two callers only (chrome.ts:331, unified.ts:96). Attempt to defeat the fix: none needed beyond turning the unified toggle off, which is its default state (comment at unified.ts:99-101 says so). The /api/personas and layout.tsx halves of the report are NOT live: lib/session.ts computes `active = (activeId && personas.find(...)) || personas[0] || null`, so `session.active` is null only when session.personas is empty, in which case the `?? ""` (app/api/personas/route.ts:15-19) and `?? actingId` (app/(main)/layout.tsx:105) fallbacks filter an already-empty list.

**Residual.** Three reachable gaps remain. (1) Search, default scope: connect a signer, POST /api/personas, POST /api/seed-persona with that id, act (block/follow/bookmark/DM) as it, then GET /api/search/unified?status=1 or ?q= — indexed 0, personas [], reported as an ordinary non-compartment "single" scope. Same for ?browse=1. Even with the unified view ON, that persona's own records are still never collected, because collectRecords starts from ownPersonaIdsAll() (unified.ts:150) and the roster id is not in it. Fix belongs in collectRecords' starting set (or in a single resolver that both it and currentScope use), not in currentScope alone. (2) app/api/personas/act-as-options/route.ts:26 still passes `[...SEED_VIEWER.personas, ...minted]` where `minted` is the KEYSTORE list (line 21, listPersonas()); with a roster-minted active persona under compartment mode `visible = {activeId}` intersects that list to nothing and the route answers `options: []` — the picker empties instead of narrowing. (3) The same mixing is now also in app/api/persona/chrome/route.ts:38/50-52 (`own = ownPersonaIdsAll()`, `tints: own.filter((id) => visible.has(id))`): under compartment with a roster-minted active persona the tint list is empty, so the settings page shows no accent for the persona being acted as. Underneath all three: viewScope (lib/identity/chrome.ts:298) still does not throw when activePersonaId is outside ownIds, so every new caller re-opens the hole.

## F-8 — PARTIAL (medium)

**Evidence.** Half the finding is fixed, half is untouched.

FIXED HALF — the fork route now persists. `app/api/identity/fork/route.ts:327-342` replaced the compute-and-report block with a compute-then-`setTint` block, carrying a comment that names this finding:
  line 338: `          const persisted = await setTint(created.id, picked.color, ids);`
  line 339: `          tint = persisted.ok ? { ...persisted.tint } : { ...picked };`
`setTint` (lib/identity/chrome.ts:203-241) writes `doc.tints[personaId]` and calls `save()`, so a fork's auto colour does land in the vault and the clone report's promise is backed on the success path.

OPEN HALF — `tintsFor` itself is unchanged in the respect the finding names. The only edit to it (git diff lib/identity/chrome.ts) swapped the string test `taken.has(color)` for the perceptual `collides(color)` (a different finding, F-7). The assignment is still by roster position and still writes nothing:
  lib/identity/chrome.ts:187: `    let color = TINT_PALETTE[cursor % TINT_PALETTE.length];`
  lib/identity/chrome.ts:196: `    out[id] = { personaId: id, color, source: "auto" };`
`out` is returned and discarded; `doc.tints` is still declared (chrome.ts:163) as "personaId → "#rrggbb", only for personas whose owner CHOSE one", and no `save()`/`setTint` call exists on any path through `tintsFor`. The invariant comment at chrome.ts:162-165 ("the same roster always yields the same assignment") is still true only for a fixed roster.

The finding's worked example reproduces verbatim against current source: `own=[A,B,C]` with empty `doc.tints` yields A `#1d9bf0`, B `#f4a524`, C `#0f5c3a`; drop B and C walks to `#f4a524`. The three read callers all pass the whole roster and none persists: `app/(main)/layout.tsx:93`, `app/api/persona/chrome/route.ts:44` and `:79`. The other persona-creation paths (`app/api/seed-persona/route.ts`, `app/api/personas/route.ts`) contain no reference to tints at all, so every persona minted outside `/api/identity/fork` — and every persona that already existed before this change — keeps a position-derived, unpersisted colour.

ATTEMPTS TO DEFEAT THE FORK FIX: the `collides` branch of `setTint` is unreachable for a normal roster (both `tintsFor` calls hit the same cached `doc` via `g.__layersPersonaChrome`, so `picked.color` is re-derived identically and compared against the same sibling colours), and a `save()` throw is caught by the outer handler at line 344 and surfaced as `{error}`. It is reachable by palette exhaustion, see `residual`.

**Residual.** Two concrete paths remain.

1) The general drift, unfixed. Any persona whose tint was never hand-set and that was not created through the fork route still gets its colour from its index in `ownPersonaIdsAll()` = `[...new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])]` (lib/influence/allowance.ts:127). Remove an earlier persona — a discarded clone, `purgeForkedPersonas()` during `resetState` (lib/adapters/mock/store.ts:837-838), or any change in keystore enumeration order — and every later unpersisted persona's accent shifts with no action by its owner. The fork fix makes this worse in one case: a forked persona's now-`chosen` colour is seeded into `taken` before the auto walk, so deleting a sibling of it re-seats the remaining auto personas from `cursor = 0` (e.g. roster [A,B] plus fork C persisted `#0f5c3a`; delete A and B moves `#f4a524` → `#1d9bf0`).

2) The fork route's own report still promises an unstored colour at palette exhaustion. `TINT_PALETTE` has 8 entries. Fork with 8 existing siblings (9 ids): the walk gives ids[0..7] all eight colours, then for `created.id` the bounded loop at chrome.ts:190 runs its full lap, every candidate collides, and it exits holding `#1d9bf0` — the "honest repeat" the comment at chrome.ts:188-189 allows. `setTint(created.id, "#1d9bf0", ids)` at fork/route.ts:338 then finds distance 0 < MIN_SEPARATION (12) against ids[0] and returns `{ok:false, code:"collides"}`. Line 339 falls through to `tint = { ...picked }` — the response reports `#1d9bf0` with `source:"auto"`, nothing is stored, and no `error`/`code` field tells the caller the write was refused (contrast line 326, which does report the refusal for a caller-supplied tint).

Also worth noting, not a security hole: the persisted fork tint is stored in the same map as owner-chosen colours, so it comes back `source:"chosen"` and the UI cannot distinguish "the owner picked this" from "the system picked it at creation". The `Tint` type already carries the `"auto"` marker the finding suggested using for exactly this.

## F-8 — PARTIAL (medium)

**Evidence.** A fix IS present in the working tree (lib/feed.ts is modified, +127/-13 vs HEAD), but it is coarser than the finding asked for, and the second half of the finding (the test) was not done.

CODE — lib/feed.ts:1452-1460, inside the `if (exhausted)` branch of buildFeed:
  1455  // GATE 5 (attack-post-2 F-8): the strip does NOT survive a fully exhausted feed. It is
  1456  // drawn from posts the owner has by definition already seen once everything is caught
  1457  // up, and an "ended" timeline with six cards still sitting above it is the
  1458  // anti-doomscroll contract being honoured in the cards and broken in the chrome.
  1459  const stripHere = fresh.length ? previewStrip : [];
  1460  return { cards: [...above, banner, ...below], mode, contentStale, lensId: activeLens.id, previewStrip: stripHere, pinnedHashes: [...pinSet] };

Decisive line: lib/feed.ts:1459 — `const stripHere = fresh.length ? previewStrip : [];`

Answering the two re-check questions literally:
(1) "Does the exhausted branch filter the strip to items newer than lastVisit (the same predicate isNew uses)?" — NO. It applies no per-item predicate to the strip at all. It is all-or-nothing on `fresh.length`. The strip is still built at lib/feed.ts:614-623 from `eligible` with no isNew filter (`.filter((p) => bannered.has(p.hash)).sort(...).slice(0, 6)`), and topped up from live cards at lib/feed.ts:899-911, unchanged.
(2) "Does check 7 assert previewStrip.length === 0?" — NO. scripts/accept-pd3.mjs check 7 part two (lines 268-287) still inspects only `cards`: line 282 `const postsAnywhere = full.filter((c) => c.kind === "post");` and line 285 `full.slice(j + 1).filter((c) => !allowed.has(c.kind))`. `previewStrip` appears in that file only at lines 141, 147, 161 (check 3, the banner-tier check) and nowhere in the exhaust check. No other script, in scripts/ at all, asserts the exhausted strip.

The literal repro in the finding no longer reproduces. `absoluteTime` is BOOT-relative, not Date.now()-relative (lib/adapters/mock/store.ts:101, `export const absoluteTime = (minutesAgo: number) => BOOT - minutesAgo * 60_000;`), and `setLastVisit {minutesAgo:0}` writes `Date.now()` (app/api/dev/route.ts:89), which is >= BOOT and therefore newer than every seeded post (the smallest seeded `minutesAgo` literal is 1; there is no `minutesAgo: 0`). So on the stated repro `fresh.length === 0`, `stripHere` is `[]`, and `previewStrip.length === 6` becomes `0`.

ATTEMPTS TO DEFEAT THE FIX (what I tried):
- Non-post cards slipping past `isNew`'s first line (lib/feed.ts:1414, `if (card.kind !== "post" || !card.cast) return true;`) to keep `fresh` non-empty: the only writers of `cards` before this branch are `ordered.map(...)` (kind "post"), lib/feed.ts:788 (private posts, kind "post") and lib/feed.ts:835 (relayed anon casts, kind "post"). No cast-less or non-post card exists there, so that path is closed.
- Live mode: the whole branch is gated `!isLiveContent()` (lib/feed.ts:1411), but the caught-up banner is not rendered in live mode either, so the "feed ends" contract is not being claimed there. Not a way in.
- `calibration === "aggressive"` saturated-story marking (lib/feed.ts:1420-1422) only makes MORE cards non-fresh, shrinking `fresh` toward the fixed case. Not a way in.
- `lastVisit === 0` skips the branch entirely, but then no banner is shown. Not a way in.
What I could NOT close is the coarseness of the gate itself, described in `residual`.

**Residual.** The gate is `fresh.length ? previewStrip : []` (lib/feed.ts:1459), not a per-item freshness filter, while the branch it sits in fires on PARTIAL exhaust too: `const exhausted = fresh.length < cards.length || fresh.length === 0;` (lib/feed.ts:1426). So exactly ONE fresh card anywhere in the window restores the entire unfiltered 6-item strip — including items older than lastVisit and items that never made the 40-card page, which is the substance of the original complaint.

Concrete path, no exotic setup: POST /api/delivery {"personaId":"persona_acc_astro_1","tier":"banner"}; POST /api/dev {"action":"setLastVisit","minutesAgo":30} (instead of 0). Seeded posts newer than 30 minutes are fresh, older ones are not, so `fresh.length` is between 1 and cards.length-1 → `exhausted` is true, the caught-up banner renders, and `stripHere === previewStrip`. Because the strip is drawn from `eligible` newest-first (lib/feed.ts:614-617) and `eligible` is deliberately wider than the page, whenever that account's six newest posts all predate lastVisit the viewer sees a "caught up" banner with six already-read banner-tier posts pinned above the timeline.

A second, sharper variant: after a genuine full exhaust, a single new private post (lib/feed.ts:788, `isNew` → `(card.cast.timestamp ?? 0) > lastVisit`) or a single relayed anon cast (lib/feed.ts:835) arriving with a post-lastVisit timestamp is enough — neither is a banner-tier post, yet either one flips `fresh.length` to 1 and brings back all six stale strip items.

Second residual, independent of the above: the behaviour is still untested. scripts/accept-pd3.mjs check 7 part two (lines 268-287) never reads `previewStrip`, so nothing in the suite would catch a regression of lib/feed.ts:1459 back to returning `previewStrip` unconditionally. The review's own recommended second change ("Add the `previewStrip.length === 0` assertion to check 7 part two", research/attack-post-2.md:489) was not applied.

## F-9 — OPEN (medium)

**Evidence.** No shared roster helper exists. `grep -rn "chromeRoster|tintRoster"` over the tree returns nothing, and `tintsFor` still has three distinct roster expressions at three call sites.

The two named lines are unchanged in the current tree:
- C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\(main)\layout.tsx:93 — `const tints = await tintsFor(own.includes(actingId) ? own : [...own, actingId]);` (widened roster; `own` = `await ownPersonaIdsAll()` at :92, `actingId` = `activeSeedPersonaId()` at :87)
- C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\api\persona\chrome\route.ts:44 — `const tints = await tintsFor(own);` (unwidened; `own` = `await ownIds()` → `ownPersonaIdsAll()` at route.ts:29-32). Same unwidened roster again at route.ts:79 in the `clearTint` branch.

The refusal is also unchanged: C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts:208-209 — `if (!ownIds.includes(personaId))` / `return { ok: false, code: "not_own", reason: "not one of your personas — a tint is set by its owner" };`, and route.ts:66 hands it `await ownIds()`.

The guarantee it breaks is still stated verbatim at chrome.ts:163-165: "The walk is deterministic (roster order, palette order, skipping what is already taken), so the same roster always yields the same assignment".

The F-8 precondition is still reachable, and F-8's proposed fix was NOT applied — `viewScope` (chrome.ts:298-312) does no `ownIds.includes(activePersonaId)` assertion; it just reads the doc and returns. The reachable flow, all in current source: `POST /api/personas` (app/api/personas/route.ts:29-40) calls `recordPersona(...)` into the root roster and never touches the keystore; `ownPersonaIdsAll()` (lib/influence/allowance.ts:124-128) is `[...new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])]` where `ownPersonaIds()` (lib/identity/keystore.ts:483-485) reads only the keystore — so the new persona is not in `own`. `POST /api/seed-persona` (app/api/seed-persona/route.ts:18) validates against `new Set([...SEED_VIEWER.personas, ...session.personas.map(p => p.id)])`, accepts it, calls `allowActingAs`, and sets the cookie; `activeSeedPersonaId()` (lib/activePersona.ts) then returns it via `mayActAs` → `actable()`. `active ∉ own` holds. The `layers_view_as` cookie is a second, even shorter path: `activeSeedPersonaId()` returns any id in `personaById`, explicitly "not just one of the viewer's own".

Consequence in the current tree, confirmed end to end: layout.tsx:94-95 sets `tintColor`/`tintSource` from `tints[actingId]`, which only exists because of the widening, so the chrome IS painted. The settings pane renders exactly what the route returns — components/settings/PersonaTintPane.tsx:40 `setTints(j.tints ?? [])` and :93 `tints.map(...)` — and route.ts:51-57 builds that list as `own.filter((id) => visible.has(id))`, which cannot contain `actingId`. So no row, no palette swatch, and a manual `{action:"tint", personaId: actingId}` (PersonaTintPane.tsx:122) hits chrome.ts:209 and returns 403 `not_own` (route.ts:67-71).

Attempts to defeat the claim that failed: (1) the Gate 5 edit to this GET is uncommitted and visible in `git diff` — it added `const visible = new Set(scope.visiblePersonaIds)` and the `.filter(...)`, i.e. it touched this exact line pair and narrowed the answer further rather than unifying the roster; (2) `visibleOwnPersonaIds()` (chrome.ts:326-333) DOES widen — `all.includes(active) ? all : [...all, active]` — but it is a third expression that this route does not call; (3) appending `actingId` at the END of the layout's roster leaves every other persona's auto assignment identical (the walk is order-dependent and the extra id is last), so the divergence is confined to `actingId` — which is exactly the persona the chrome is tinted for.

**Residual.** With `active ∉ own` (reachable via a `POST /api/personas` roster persona selected through `/api/seed-persona`, or via the `layers_view_as` cookie), the chrome is tinted with a colour the settings pane never lists and `setTint` refuses with `not_own`/403. Under compartment mode it is worse than the original report: `viewScope(active, own)` returns `visiblePersonaIds = [active]` (chrome.ts:307), and `own.filter(id => visible.has(id))` (route.ts:52) is then EMPTY, so the pane lists zero tints while the chrome is still painted. Fix is still the one the review named: one `chromeRoster()` used by layout.tsx:93, route.ts:44, route.ts:79 and chrome.ts:326-333, plus the F-8 precondition assertion inside `viewScope`.

## F-9 — OPEN (medium)

**Evidence.** Untouched in the current tree — no floor, no assumption id, and the misleading posture line is still there.

1) The formula is verbatim as reported, in `save()`:
`C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\delivery\tiers.ts:103-104`
```
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: { tiers: doc.tiers }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
```
and identically at `lib\identity\chrome.ts:133-134`, `lib\vault\vault.ts:203-204` (`sealWhole`), `lib\zones\store.ts:60-61`, `lib\influence\allowance.ts:106-108`, `lib\attest\vault.ts:42-43`. A repo-wide grep for `1024` / `Math.ceil` across those six seams finds no floor constant and no second boundary — consistent, not a regression, and no 8 KiB floor anywhere.

2) The arithmetic still collapses to a pure function of the bucket. `pad = target - L - 48` is always ≥ 16 (since `target ≥ L + 64`), so `Math.max(0, …)` never clamps and the sealed plaintext length is exactly `target − k` for a constant k: `target − 33` in `chrome.ts`/`sealWhole` (where `inner = JSON.stringify(m)`), and `target − 23` in `tiers.ts`, where `m` is re-wrapped as `{ tiers: … }` and adds 10 bytes the `inner` measurement did not see. (Minor correction to the report's "exactly target − 33 for 0…20 000": that holds for chrome/sealWhole, not for tiers — the constant differs, the leak does not.)

3) The length reaches the operator undistorted. `encryptRecord` is AES-GCM with no compression and hex output — `lib\crypto\vaultCipher.ts:45-46` returns `ct: body.toString("hex")`, i.e. `2·(pt+16)` characters — and `flushVault` PUTs the whole record every write: `lib\adapters\mock\persist.ts:410` `validatorFetch(BASE + \`/state/${ns}\`, { method: "PUT", … body: JSON.stringify({ entries }) })`. The only constant-size request padding in the codebase is the anon ZK channel (`lib\zk\config.ts:88` `ZK_SUBMIT_BYTES = 4096`), which does not cover vault PUTs.

4) Nothing was disclosed. `docs/internal/assumptions.md` (whole file read; it is a 10-line index) has no size entry. SECURITY-POSTURE.md §17 "Assumptions added by this pass (by id)" (lines 1797-1845) lists A-POST-FOLLOWS-ARE-ONE-LIST … A-POST-THE-BIN-IS-NOT-A-DELETE with no size assumption; `A-POST-DELIVERY-SIZE-STEPS-WITH-THE-MAP` appears nowhere in the tree except as the recommendation text inside `research\attack-post-3.md:577`. `A-CU-NAMESPACE-NAMES-VISIBLE` — the only id that touches this at all — is cited in `lib\vault\vault.ts:196` and `notes/reports/REPORT-CUSTODY.md:100` but does not exist in SECURITY-POSTURE.md at all (grep for `A-CU-NAMESPACE` in the posture: zero hits), and in any case it says only "name and KiB-rounded size", not that the size counts entries or that a boundary-crossing write pins the count.

5) The misleading row is unchanged: `SECURITY-POSTURE.md:1239` — `| the allowance … | the vault, ONE opaque padded sealed record (`influence`) | ciphertext of a fixed 1 KiB step — never the balance, never the tier |`. "a fixed 1 KiB step" is the only posture sentence on record size and it reads as "always 1 KiB", which the formula does not do.

6) Attempts to defeat / discount the finding: (a) I looked for a fix hidden in the uncommitted working tree — `git diff` on tiers.ts, chrome.ts, vault.ts, SECURITY-POSTURE.md and assumptions.md shows the padding lines only as unchanged context; the +42 posture lines are the readwise section and three A-POST-READWISE/BIN/DWELL assumptions, none about size. (b) I checked whether `sealWhole` might re-pad the already-sealed record to a different boundary and blur the count — `lib\vault\vault.ts:199` returns `entries` untouched when every value already looks like ciphertext, so no second padding is applied. (c) I checked whether the 1 KiB bucket is coarse enough to be harmless: entries are `"<modeId>|<personaId>":"<tier>"`, ~45-50 bytes each, so ~21 per KiB — matching the report's measured 21/43/65/86 step points. (d) `personaChrome` really is effectively constant for a realistic roster (first step at 28 chosen tints), so the live channel is `deliveryTiers`, which is unbounded and keeps stepping.

**Residual.** The operator (or anyone reading validator rows / TLS record sizes for the PUT) reads `len(ct)` on `PUT /state/deliveryTiers` and recovers `ceil((L+64)/1024)` exactly, i.e. the number of non-normal delivery settings to within ~21. Worse than a static bucket: because every mutation PUTs the whole record, the operator sees the individual request at which 991 B → 2015 B, which pins the count to the boundary (the 21st non-normal setting) rather than to a range, and the direction of the step says whether the owner added or cleared a setting. Combined with the other per-write metadata already visible (namespace name, timestamp, and the fact that a tier write follows a UI action), this turns "how many accounts this person has quietly turned down or never wants to miss" into an observable the posture claims is hidden. Reachable today with no special access beyond the validator the product already assumes is untrusted for content. Two ways to close it: give the record an 8 KiB floor (`target = Math.max(8192, 1024*ceil(...))`, first step at ~170 entries, and fix SECURITY-POSTURE.md:1239's "fixed 1 KiB step" wording to describe an actual step function), or, if the step is accepted, add A-POST-DELIVERY-SIZE-STEPS-WITH-THE-MAP to §17 and register A-CU-NAMESPACE-NAMES-VISIBLE in the posture where the code already cites it.

## F-9 — PARTIAL (medium)

**Evidence.** The outage half is closed. `lib/feed.ts:392-414` no longer has a bare block: lines 403-407 read

    403      try {
    404        deliveryMap = await tierMapFor(mode.id);
    405      } catch {
    406        deliveryMap = new Map();
    407      }

with the commit comment at lines 398-402 naming this finding ("GATE 5 (attack-post-2 F-9): an unreadable tier map threw straight out of buildFeed and 503'd the ENTIRE timeline"). Line 412 then yields `deliveryRules = []` because `deliveryMap.size` is 0, and line 414 `deliveryOf` returns "normal" for every author, so the timeline builds. `app/(main)/home/page.tsx:104-112` no longer sees a throw from this path, so no `loadError` / "Couldn't load your timeline".

`lib/delivery/tiers.ts` is unchanged in the relevant respect: the corrupted-namespace throw (lines 69-72), the "vault" fast-break (line 81) and the never-fail-open throw (lines 88-93) are all still there, which is intended — the module still refuses, the caller now contains it.

The doc disagreement is also gone, resolved by the code moving to the doc rather than the doc moving: `SECURITY-POSTURE.md:1830-1831` (A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE) still says "a device that cannot read the vault delivers everything Normally / rather than guessing", and that is now literally what happens. `git diff SECURITY-POSTURE.md` shows §17 gained only the readwise section and three new assumption ids; this bullet was not touched.

What I tried in order to defeat the fix, and failed:
- The dynamic `import()` sits OUTSIDE the try (line 396). Only a module-load failure escapes there, and the module's top level is imports plus const declarations with no vault access, so the reported failure mode (unreadable/corrupt `deliveryTiers` namespace, validator unreachable, wrong key) cannot reach it. `compileDeliveryRules` at line 412 is also outside the try but is pure and synchronous.
- The finding's compounding claim — "a permanent outage until resetDeliveryCache() runs" — is false in the current source, and was false before the fix too: `lib/delivery/tiers.ts:88-94` throws at the `if (!doc.loaded)` guard BEFORE `g.__layersDeliveryTiers = doc`, so a failed load is never cached. Every subsequent `buildFeed` re-enters `load()` and re-attempts. The `break` at line 81 only skips the two in-request backoff retries.
- Other callers of the throwing functions: `app/api/delivery/route.ts:52, 64, 65` (`tierFor`, `listNonNormal`, `tierMapFor`) are still unwrapped, but the route's own `catch` at line 79 turns it into a 503 on the delivery SETTINGS screen only. That is the correct behaviour there — showing an empty tier list as truth would be the fail-open the module exists to prevent — and it cannot take down the timeline.

**Residual.** The label half of the finding was not done, and the gap it leaves is reachable. `catch { deliveryMap = new Map(); }` at lib/feed.ts:405-407 is bare: no `deliveryStale` in the return type (lib/feed.ts:258-270 still carries only `contentStale`), nothing passed through app/api/feed2/route.ts:15-23, no console warning, not even a captured error variable. So while the vault is unreadable, an account the owner set to "quiet" is delivered Normally and an account set to "facet only" stops being scoped, with the timeline rendering as if no tiers had ever been set — visually identical to the healthy empty-map case. That is precisely the outcome lib/delivery/tiers.ts:85-93 throws to prevent ("silently un-quieting an account is the one direction of this setting that hands attention to somebody the owner turned down"); the module's protection is now fully neutralised at the one caller that matters, and the owner gets no signal in the moment. SECURITY-POSTURE.md:1830-1831 sanctions the Normal fallback but says nothing about it being silent and unlabelled. Concretely: owner sets @X to quiet in work mode, the device later cannot decrypt the deliveryTiers namespace (wrong/rotated vault key, corrupt record — the exact case tiers.ts:69-72 detects), and @X's posts sit un-deranked at the top of the work-mode timeline for as long as the condition lasts, with no banner and no log line. The remedy the finding named — surface `deliveryStale: true` the way `contentStale` is surfaced at lib/feed.ts:648/1474 and rendered at components/SeededTimeline.tsx:225 — would close it.

## D-1 — OPEN (low)

**Evidence.** The asymmetry is unchanged in the current tree, and the documentation sentence the finding asks for was never written.

1. C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts:298-309 — `viewScope()` still derives the enumerable set from `compartment` alone. Decisive line, chrome.ts:307:
    `    visiblePersonaIds: compartment ? [activePersonaId] : ownIds,`
   The `unified` flag it returns (line 301, `const unified = doc.unified && !compartment;`) never touches `visiblePersonaIds`.

2. Only the search index reads `unified`. C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\search\unified.ts:102:
    `    personaIds: sc.unified ? roster : [active],`
   (The working-tree edit to this file was the F-8 minted-roster fix — `own` became `roster`; the toggle semantics are untouched.)

3. The other three surfaces still gate on `compartment`/`visiblePersonaIds` only, so with the cross-persona view OFF they enumerate every sibling:
   - app\api\personas\route.ts:16-19 — `const scope = await viewScope(activeId ?? "", session.personas.map((p) => p.id)); const visible = new Set(scope.visiblePersonaIds);`
   - app\api\personas\act-as-options\route.ts:26-28 — same `visiblePersonaIds` filter.
   - app\api\influence\route.ts:39 — `if (scope.compartment && !scope.visiblePersonaIds.includes(personaId))` — the 403 is conditioned on `scope.compartment` explicitly, so a sibling's stake history is served whenever compartment mode is off, regardless of the view toggle.
   - The server-rendered switcher in app\(main)\layout.tsx:105 takes the same `viewScope` result.

4. SECURITY-POSTURE.md §17 is unchanged on this point. Lines 1718-1723, "What compartment mode does", still read: "Four surfaces narrow AT THE API, not in the DOM: the search index ..., the account switcher, the act-as picker, and a sibling's stake history." `git diff SECURITY-POSTURE.md` shows the only working-tree additions to §17 are the readwise subsection (lines 1753-1777) and three A-POST-DWELL/READWISE/BIN assumptions — nothing about the view toggle. Grepping SECURITY-POSTURE.md for "cross-persona view" returns exactly three hits (1692 heading, 1721 "turning it on while compartment is held is refused", 1804 A-POST-UNIFIED-INDEX-LIVES-IN-ONE-PROCESS), none of which says the toggle narrows only the index. Nor is the sentence anywhere else: grep for "narrows only" / "index only" / "only the search" across SECURITY-POSTURE.md, notes/reports/REPORT-POST.md, docs/internal/ and research/ returns nothing. notes/reports/REPORT-POST.md:101-102 describes index-is-the-scope and "all four narrow at the route", which reproduces the same conflation rather than resolving it.

I tried to find a fix to defeat and there is none: no code change gates any of the three non-search surfaces on `unified`, and no doc text distinguishes the two toggles. The behaviour itself remains defensible (a switcher that hid siblings on the default toggle would make persona switching impossible), so this stays a documentation defect, not a leak.

**Residual.** A reader of §17 sees the cross-persona view described as a toggle and compartment mode described as narrowing four surfaces, with nothing saying which toggle governs which. With compartment mode off and the cross-persona view off — the state §17 calls the deliberate default — `/api/personas`, `/api/personas/act-as-options`, the server-rendered switcher in app/(main)/layout.tsx, and `/api/influence?view=history&personaId=<sibling>` all still enumerate or serve sibling personas; only the search index is narrowed. The remaining fix is the one sentence the review asked for in §17's "What compartment mode does": the cross-persona view governs the search index only, while the switcher, the act-as picker and a sibling's stake history narrow under compartment mode and not under the view toggle.

## F-10 — OPEN (low)

**Evidence.** Unchanged in the current tree. lib/search/unified.ts:136-144 (docblock on collectRecords) still states, decisively at line 141: " * never in the process memory a screen-share or a stray render could reach." The only edit to this file since the review is the F-8 roster fix (git diff shows +10/-3, all inside currentScope at lines 91-102); the sentence was not touched. notes/reports/REPORT-POST.md:101 repeats it: "the sibling's records are never read, never embedded, and never in the process memory a screen-share could reach."

The contradicting facts are all still true: lib/search/unified.ts:164-165 walks the whole store and filters per record — "for (const pp of s.privatePosts.values()) {" / "if (!ownSet.has(pp.authorPersonaId)) continue;" — same shape at 169-170 (dmRequests), 179 and 206-207 (edgeEvents), 189 (folders), 211-212 / 215-216 (xImportedPosts, xImportedPrivate). lib/influence/allowance.ts:192 — "return [...(await load()).mine];" — hands back the entire decrypted stake mirror, filtered only afterwards at unified.ts:198. lib/adapters/mock/store.ts:255-257 and 343-349 make the store a process global (__layersMockState) holding every persona's privatePosts and dmRequests at all times.

New, beyond the review: allowance.ts:61/97 caches the decrypted influence doc on globalThis.__layersInfluence, and the only clearer is resetInfluenceCache() at allowance.ts:112-114, which neither resetUnifiedIndex() nor app/api/persona/chrome/route.ts calls — so every persona's decrypted stake history survives a compartment switch in process memory.

The load-bearing mechanism does hold and I could not defeat it: scopeKey at unified.ts:129, per-scope cache at 234-239, resetUnifiedIndex at 245-247 now called on BOTH the unified toggle (app/api/persona/chrome/route.ts:83-84) and the compartment toggle (102-103), plus lib/device/boot.ts:184-185 and the dev route. collectRecords has exactly one caller (ensureIndex, unified.ts:231), and every read path (unifiedSearch 264-266/285-295, browseAll 332-337) reads only cache.records, never state() at query time. Attempts to defeat it: an unscoped collectRecords call (no such caller exists), a stale wider-scope cache surviving a switch (all scopes dropped), and the F-8 roster path (with unified off the scope is still [active]). No sibling record reaches a response.

**Residual.** The inaccurate absolute sentence is still shipped in two places — lib/search/unified.ts:141 and notes/reports/REPORT-POST.md:101 — and nothing in SECURITY-POSTURE.md narrows it for the solo/compartment case: A-POST-UNIFIED-INDEX-LIVES-IN-ONE-PROCESS (SECURITY-POSTURE.md:1804-1809) is scoped to "with the cross-persona view ON". The concrete way the claim is false with compartment ON: globalThis.__layersMockState still holds every sibling's privatePosts and dmRequests (store.ts:255-257), and globalThis.__layersInfluence still holds every sibling's decrypted StakeEvent list (allowance.ts:97, never cleared by resetUnifiedIndex), so a heap dump, a crash report, an error serializer, or any future surface that renders from state() rather than from the scoped index reaches sibling records that the sentence promises are not in memory. Fix is two words of prose plus one assumption: narrow both sentences to "never in the INDEX", and record an assumption (e.g. A-POST-THE-SCOPE-BOUNDS-THE-INDEX-NOT-THE-PROCESS) saying the process still holds every own persona's records in the mock store and the decrypted vault regardless of scope. Optional hardening if the claim is meant literally: call resetInfluenceCache() alongside resetUnifiedIndex() in app/api/persona/chrome/route.ts.

## F-10 — OPEN (low)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\feed.ts, lines 782-955 (read in full, plus 555-620 and 1450-1475 for the callers of the same state).

The structure the finding describes is unchanged. The try still opens at 782 with the private-post read:

  782:   try {
  783:     const privatePosts = await withRetry(() => adapters.identity.visiblePrivatePosts(personaId));

the anon-cast network read is still inside it:

  821:       const anonCasts = await withRetry(() => fetchAnonCasts(zkMode()));

the final ordering is still inside it, and its own comment still says it is the only place a position guarantee survives:

  915:     cards.sort((a, b) => {
  917-918:       // the feed's final ordering, so it is the only place a position
  919:       //   guarantee can actually be made.
  943:       const pa = a.cast && pinSet.has(a.cast.hash) ? 0 : 1;
  946:       const qa = a.cast && quieted.has(a.cast.hash) ? 1 : 0;

and the catch is still silent, still documented only for private posts:

  951:   } catch {
  952:     // FAIL CLOSED. If we cannot establish who is entitled to a private post,

The file HAS been edited since the review — commit 6229339 plus the working-tree Gate 5 changes landed fixes for F-1, F-2, F-3 and F-9 in this same function — but none of them touched this control flow, and two of them widened the blast radius:

1. The F-2 fix DELETED the quiet penalty from the corpus sort (lib/feed.ts:563-572; git diff shows `- const qa = quieted.has(a.hash) ? QUIET_PENALTY : 0;` removed with the note "Quiet is applied THERE"). Quiet now has exactly ONE application site, line 946, inside the swallowed block. Before the fix a throw left a partial quiet penalty in place; now a throw makes quiet fail fully open — the direction the comment at 683-686 calls "the one direction this setting must never fail."
2. The F-3 second-look fix ADDED a new live-cast pin hoist and banner-strip fill (lines 880-911) inside the same try, so a throw now also drops the live pin hoist and the banner preview strip.

Reachability, adversarially: I looked for any guard that would keep line 821 from throwing and found none. `fetchAnonCasts` -> `vget` (lib/zk/validatorClient.ts:51-59) throws unconditionally on transport failure or non-2xx — the module header at line 9 states "NEVER FAIL OPEN: every helper throws on transport/HTTP failure." Its only gate is `if (!mode.followedOnly)` (line 818), and `zkMode()` (lib/zk/config.ts:22) just reads a string; there is no "validator configured?" check. So the repro is stronger than the review's 2%-mock-failure path: with the validator on :4001 not running, EVERY feed build in a non-followedOnly mode throws deterministically at 821, three retries and all, and returns a feed with no demote sink, no pin hoist, no quiet lowering, and no private posts.

I also tried to defeat it from the other side — is the ordering redone later? No. `grep -n "\.sort("` on the file returns only 563, 616, 732 and 915; 563/616/732 all run BEFORE the try, and nothing between 955 and the two returns re-sorts `cards`. `demotedAuthors`, `sunkForStanding`, `pinSet` and `quieted` are read nowhere after line 947.

There is no signal to the caller either, and one active lie: both returns (lines 1460 and 1474) ship `pinnedHashes: [...pinSet]`, and `pinSet` is built at line 600 OUTSIDE the try. So on a throw the API (app/api/feed2/route.ts:15,23) still tells the UI which hashes are pinned while the cards sit unhoisted at their timestamp positions. `contentStale` is set only by the live-content catch at 767-771, never by this one.

**Residual.** Any throw between lines 783 and 950 skips the whole final ordering silently. Concretely: (a) validator down or returning non-2xx -> `fetchAnonCasts` at 821 throws past withRetry on every build -> feed rendered with demote, pin and quiet all inert; (b) the three dynamic `await import(...)` at 819, 820 and 831 throw on a module-resolution or module-init error and land in the same catch; (c) `adapters.identity.visiblePrivatePosts` at 783 failing three mock retries (~0.0008%/build) does the same; (d) any TypeError inside the standing loop or the new pin-hoist block at 880-911 does the same. In every case the returned `pinnedHashes` still names pinned posts that were not hoisted. The fix the finding asks for — move the `cards.sort` (and ideally the pin-hoist/banner-strip block, which reads only local state) out to the top level, and give private posts and anon casts their own narrow try blocks — has not been applied.

## F-11 — PARTIAL (low)

**Evidence.** THE GLOBAL IS STILL UNKEYED, as reported. lib/identity/chrome.ts:63 — `const g = globalThis as unknown as { __layersPersonaChrome?: ChromeDoc };` — with `load()` (lib/identity/chrome.ts:67-68) returning `g.__layersPersonaChrome` verbatim on a warm cache and `save()` (lib/identity/chrome.ts:124-142) re-sealing with `encryptNamespace(VAULT_NS, ...)`, which defaults to `key = vaultKeyBytes()` (lib/vault/vault.ts:134-138). Same shape as `__layersDeliveryTiers` (lib/delivery/tiers.ts:47) and `__layersInfluence`.

THE REPORTED VECTOR (ROOT_COOKIE) DOES NOT HOLD. `ROOT_COOKIE` only feeds `getSession()` (lib/session.ts:31 `const handle = jar.get(ROOT_COOKIE)?.value ?? null;`). It does not select the vault key: `vaultKeyBytes()` (lib/identity/keystore.ts:327-331) reads the process keystore `g.__layersKeystore`, and the chrome chokepoint's persona set comes from `ownPersonaIdsAll()` (lib/influence/allowance.ts:124-128), which is `SEED_VIEWER.personas + ownPersonaIds()` — also keystore-derived. A cookie swap therefore leaves the cached doc correct for the process's root. On that vector alone this would be NOT-A-DEFECT.

A FIX WAS ADDED SINCE THE REVIEW, and it closes the main paths. lib/device/boot.ts:169-171, inside `reloadIdentity()`: `const { resetChromeCache } = await import("@/lib/identity/chrome"); resetChromeCache();` — under a comment naming this exact bug ("GATE 5 (attack-post-3 F-2) ... the first write sealed the OLD root's document into the NEW root's vault, which is the one direction of this mistake that is not recoverable"). `app/api/dev/route.ts:513-518` does the same on resetSeed. Every keystore-switch path I could find routes through `reloadIdentity()`: `installSeed()` (lib/device/custody/index.ts:66-73, used by unlockPasskey/unlockProvider/importPhrase) and device linking (lib/device/linking.ts:154-160). `resetKeystore()` has no callers.

THE GAP THAT DEFEATS IT — a third root-switch site on neither list. app/api/recovery/route.ts:133, in the `action === "recover"` branch:
    `const personas = await recoverIdentity(seedHex);`
    `return NextResponse.json({ ok: true, recoveredPersonas: personas });`
It calls `recoverIdentity()` DIRECTLY, not through `installSeed()`, and returns without `reloadIdentity()` or `resetChromeCache()`. `recoverIdentity()` (lib/identity/roster.ts:99) calls `restoreFromRecovery(seedHex, personas)`, which is lib/identity/keystore.ts:600: `persist({ version: 3, rootSecretHex: seedHex, personas: personas.map((p) => ({ ...p })) });` — and `persist()` (lib/identity/keystore.ts:152-159) sets `g.__layersKeystore = file` in place. So the process's vault key moves to root B while `g.__layersPersonaChrome` still holds root A's document. `enrollWithSeed()` (lib/adapters/mock/persist.ts:283-314) clears no caches either. boot.ts:168 states the invariant this violates: "The sealed caches are listed here and in /api/dev resetSeed, and the two lists have to stay in step."

NO ASSUMPTION IS RECORDED. SECURITY-POSTURE.md §17 (lines ~1790-1810) has A-POST-TINT-IS-PER-DEVICE and A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC, neither of which says the compartment flag is a property of the process's vault rather than the session; grep for "one root per process"/"per process" across SECURITY-POSTURE.md and docs/internal/assumptions.md returns only an unrelated §8 line (SECURITY-POSTURE.md:664).

WHAT I TRIED AND COULD NOT MAKE WORK: the ROOT_COOKIE vector itself (blocked — cookie does not reach the vault key or the persona set); the failure paths of `recoverIdentity()` (lines 82-96 `unenroll()` and throw BEFORE `restoreFromRecovery`, so a wrong phrase leaves the keystore and the cache consistent); `resetKeystore()` (uncalled); `installLinkedRoot()` (lib/device/linking.ts:154, immediately followed by `reloadIdentity()` at :160 with nothing fallible between them that touches chrome).

**Residual.** POST /api/recovery {action:"recover", phrase|passphrase} on a warm process. Order of calls: (1) any request that renders a cross-persona surface calls `visibleOwnPersonaIds()` → `viewScope()` → `load()`, populating `g.__layersPersonaChrome` with root A's doc (compartment flag + tint map); (2) POST /api/recovery with a DIFFERENT seed succeeds — `restoreFromRecovery()` rewrites `g.__layersKeystore` so `vaultKeyBytes()` is now root B's, but nothing clears the chrome cache; (3) two consequences in the same process, no restart: READ — `viewScope()` keeps answering with root A's `compartment`, so if root A had compartment OFF and root B has it ON, root B's protection is silently off and `visibleOwnPersonaIds()` returns the full sibling set that compartment mode exists to suppress (and never reads root B's actual stored chrome record); WRITE — the next `setTint`/`clearTint`/`setUnified`/`setCompartment` calls `save()`, which seals root A's `{tints, unified, compartment}` under root B's vault key into root B's `personaChrome` namespace. That write is the direction boot.ts:168 itself calls "not recoverable": root B's real chrome record is overwritten with root A's, including root A's persona-id → hex tint map, which is a sibling-set disclosure into another root's vault. The fix is one line at app/api/recovery/route.ts:133 — route it through `boot.reloadIdentity()` as `installSeed()` does, or call the same reset list — and the same route leaves every other sealed cache stale too (deliveryTiers, readwise, zones, ports, influence, attestation, anonAttribution, sessionHandles, rootRoster), so chrome is the instance, not the whole of it.

## F-11 — OPEN (low)

**Evidence.** Nothing in this finding was addressed. `lib/rules/evaluate.ts` is byte-identical to HEAD (`git diff HEAD -- lib/rules/evaluate.ts` is empty; last touched at 6229339, which only added `delivery.tier`).

1) The false comment is verbatim intact — C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\rules\evaluate.ts:67-70:
   "// THE enforcement point for imported algorithms, per the Tier A spec:
    // \"enforce in the rules evaluator, not the import UI\". Both the import
    // sanitizer and the evaluator itself call this, so a hostile rule that
    // somehow survives import still cannot evaluate."
   `evaluateGroup` (evaluate.ts:164-173) and `evalCondition` (128-162) contain no call to `validateRuleGroup`. A full-tree grep for `validateRuleGroup` returns exactly four call sites and none is the evaluator: app/api/personas/bindings/route.ts:115, lib/algo/artifact.ts:175, lib/feed.ts:420, and the function's own recursion at evaluate.ts:107.

2) buildFeed still validates inline rules only. lib/feed.ts:419-426 validates `opts.inlineRules`; the stored-rule loop immediately after does not — lib/feed.ts:429-443 ends with the decisive line, **lib/feed.ts:442: `    rules.push(rule);`**, reached straight from `const rule = await withRetry(() => adapters.rules.get(ruleId));` (feed.ts:430) with only a null check in between. The compiled delivery rules are also pushed unvalidated (feed.ts:417).

3) `neq` against a null actual still returns true — **lib/rules/evaluate.ts:144-145: `    case "neq":` / `      return actual !== expected;`** — and `fieldValue`'s `default: return null` (evaluate.ts:60-61) is what an unknown field falls through to. `null !== "x"` is true for every post.

Reachability, checked end to end: POST /api/rules (app/api/rules/route.ts:36) passes `body.root` to `adapters.rules.create` with no shape or field check; the mock adapter stores it as given (lib/adapters/mock/rules.ts:30-43, no validation); POST /api/modes takes `ruleIds: body.ruleIds ?? []` (app/api/modes/route.ts:36) with no check that those rules validate. So `{action:"hide", root:{combinator:"AND", clauses:[{field:"identity.linkage", op:"neq", value:"x"}]}}` still lands in `rules` at feed.ts:442 and blanks the feed at feed.ts:551 (`rules.some((rule) => rule.action === "hide" && evaluateGroup(rule.root, ctx))`).

Attempts to defeat what did change: the `pin`-everything half is now blocked, but incidentally and only at the creation doors, not by this finding's remediation. `CREATABLE_ACTIONS = new Set(["hide", "downrank", "flag"])` (app/api/rules/route.ts:24) rejects `pin`/`banner` at POST, and lib/algo/artifact.ts:184-192 rejects them on import (both labelled GATE 5 / attack-post-2 F-4). I looked for a way back to `pin`: `adapters.rules.update` (lib/adapters/mock/rules.ts:45-53) does `{...existing, ...patch}` with no action allowlist and no root validation, but no route reaches it — the only `rules.update` reference in the tree is its own definition. `lib/identity/clone.ts:76` re-creates rules via the adapter directly, bypassing the route's allowlist, but it copies `r.action` from an already-stored rule, so it propagates a hostile `hide` rule to a cloned persona rather than minting a `pin`. `lib/algo/service.ts:350` creates only sanitized artifact rules. `previewCount` (lib/adapters/mock/rules.ts:62+) evaluates a caller-supplied root unvalidated too, but only returns a count.

Note for whoever fixes this: `EVALUABLE_FIELDS` (evaluate.ts:75-85) does not contain `delivery.tier`, though `FIELD_LABEL` (evaluate.ts:195) does and the compiled delivery rules use it. Adding `validateRuleGroup` to the stored-rule loop at feed.ts:429 is safe as written (delivery rules are pushed earlier, at 417), but moving the check to cover all of `rules` would reject the engine's own compiled rules until that field is added to the set.

**Residual.** Unchanged from the original report, minus the `pin` variant. Owner-session path: POST /api/rules with `{"name":"x","action":"hide","root":{"combinator":"AND","clauses":[{"field":"identity.linkage","op":"neq","value":"x"}]}}` (accepted — `hide` is in CREATABLE_ACTIONS), then POST /api/modes with that rule id in `ruleIds`, then activate the mode: feed.ts:442 pushes it unvalidated, fieldValue returns null for the unknown field, `neq` at evaluate.ts:145 is true for every post, feed.ts:551 hides all of them. Persists across builds because it is a stored rule, and lib/identity/clone.ts:76 copies it to any persona cloned from that one. No `pin`/`banner` escalation remains through any route I could find. Separately, the comment at evaluate.ts:67-70 still tells a future reader that the evaluator enforces the field allowlist, which is the documentation defect that makes the code gap likely to persist.

## F-13 — PARTIAL (low)

**Evidence.** C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\app\(main)\layout.tsx:181 (current working tree; the file is modified vs a9d0b3d):

        data-scope={scopeUnavailable ? "unavailable" : visibleIds && visibleIds.length === 1 && session.personas.length > 1 ? "compartment" : "normal"}

Half the finding is closed. The F-4 rework split the shared catch into two (layout.tsx:87-99 tint, 100-113 scope) and added `let scopeUnavailable = false` (line 81), set at line 112 in the scope catch. So the unreadable-record path now emits the fourth value the report asked for — named "unavailable" rather than "unknown" — instead of asserting "normal". `git diff app/(main)/layout.tsx` shows both the split and the `scopeUnavailable ? "unavailable" :` prefix as uncommitted edits.

The other half is untouched: the marker is still re-derived from array lengths, not from `scope.reason`. `viewScope` still returns it — C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts:308: `reason: compartment ? "compartment" : unified ? "unified" : "single",` — and layout.tsx:105-106 reads only `scope.visiblePersonaIds` and lets `scope` fall out of scope at the end of the try block, so `reason` is not even in scope at the JSX.

Tried to defeat the remaining heuristic and could not produce a false "compartment": when `doc.compartment` is false, `viewScope` returns `visiblePersonaIds = ownIds`, and layout passes `session.personas.map(p => p.id)` as `ownIds` (line 105), so `visibleIds.length === session.personas.length`; the `length === 1 && personas.length > 1` conjunction can never both hold. The failure is one-directional: it under-reports compartment, never over-reports it.

No test or script asserts `data-scope` — grep over scripts/*.mjs, *.sh, app, components, lib finds only the emit site and research/attack-post-3.md; scripts/accept-pd2.mjs reads data-tint, data-persona-handle, data-persona-id, data-mode-edge, data-mode-id from `persona-tint-root` but never data-scope. So the residual is a wrong diagnostic marker, not a wrong suppression: the actual narrowing is done by `visiblePersonas` (line 121) and by /api/personas, both of which are driven by `visiblePersonaIds` and are correct in the single-persona case.

**Residual.** Compartment mode ON with a session roster of one persona (or zero) still renders data-scope="normal" while `viewScope(...).reason === "compartment"`. Path: a root whose device roster resolves to a single persona — `getSession()` in lib/session.ts builds `personas` from `personasForRoot(rootId)` for a signer root, or `personasByFid(getSelf().fid)` for the seeded self, and either can yield one entry (a freshly enrolled root, or one whose siblings are not yet on this device) — with `compartment: true` in the personaChrome vault doc, which is a single global flag, not per-root. Then `visibleIds = [activeId]` (length 1) but `session.personas.length > 1` is false, so the ternary falls through to "normal". Same for `session.personas.length === 0`: `visibleIds` is `[actingId]`, personas.length is 0, marker says "normal".

Secondarily, `reason: "unified"` and `reason: "single"` are both flattened to "normal", so the marker cannot distinguish the cross-persona view being on from it being off — the report's stated point that the value should be `scope.reason` verbatim.

Fix is still the one-liner the report asked for: hoist `let scopeReason: string | null = null` beside `scopeUnavailable`, set `scopeReason = scope.reason` at layout.tsx:106, and emit `data-scope={scopeUnavailable ? "unknown" : scopeReason ?? "unknown"}`.

## F-14 — OPEN (low)

**Evidence.** Untouched in the current tree — no copy of the formula uses byte length. A repo-wide grep for `1024 * Math.ceil` finds 14 call sites (the report said six), every one of them still computing the target from UTF-16 code units:

lib/delivery/tiers.ts:103-104 (`save()`), decisive line:
```
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: { tiers: doc.tiers }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
```
The identical pair appears at lib/identity/chrome.ts:133-134, lib/vault/vault.ts:203-204 (`sealWhole`), lib/zones/store.ts:60-61, lib/influence/allowance.ts:106-109, lib/attest/vault.ts:42-43, and also — not named in the report — lib/readwise/state.ts:140-141, lib/x/porting.ts:107, lib/zk/anonAttribution.ts:90, lib/identity/sessionHandles.ts:60, lib/identity/roster.ts:33, lib/identity/rootRoster.ts:104, lib/device/rootlink.ts:106, lib/fc/personaFid.ts:93. `Buffer.byteLength` appears nowhere in any of them (it exists only in the anon-submit padding, lib/zk/anon/submit.ts:35 and validator/anon.js:73, which are a different scheme and do use bytes).

The length really does reach the wire as bytes — lib/crypto/vaultCipher.ts:44:
```
  const pt = Buffer.from(JSON.stringify(plaintext), "utf8");
```
AES-GCM is length-preserving, so `ct` hex length is 2×(UTF-8 bytes + 16). Padding chosen in code units therefore does not fix the byte length.

Nothing has changed here: `git log` on these files shows only the gate-2/gate-3 commits that introduced them, and `git diff` shows no working-tree edit to any padding line. No assumption id covering this exists in SECURITY-POSTURE.md or docs/internal/assumptions.md.

**Residual.** Still reachable, and by a much shorter path than the report's F-10 `modeId`. lib/readwise/state.ts stores raw article prose inside the padded document: `BinEntry.text` (state.ts:59) and `priorityFolders: string[]` (state.ts:67) are both inside `const m = { knobs, priorityFolders, dwell, bin }` at state.ts:138, whose `JSON.stringify` is the `inner` measured at line 140. `bury()` (state.ts:234-239) writes `text` verbatim, and it is live over HTTP — app/api/readwise/route.ts:122-126 calls `bury(chunkId, found.postHash, found.index, found.text)` from the X-out button in components/ReadwiseChunk.tsx:94. Any bookmarked article containing an emoji, an accent, a curly quote or CJK lands non-ASCII in `inner`; `text` is uncapped in length here, so the byte/code-unit delta is proportional to the highlight, not to a single stray character.

Concrete distinguisher: two readwise documents whose code-unit length is identical — so the scheme places both in the same 1024 bucket and pads both to the same code-unit target — produce different `ct` hex lengths on the validator whenever their non-ASCII content differs. One buried English chunk vs. one buried Japanese chunk of the same code-unit count differ by up to 2 bytes per character (3-byte CJK vs 1-byte ASCII), i.e. hundreds of bytes across a normal highlight, which is far more than the 1024-byte bucket the padding was meant to hide them in. The validator sees a size that is a function of the script the owner reads, which is exactly the property the padding exists to remove.

Two secondary gaps in the same expression, not in the original report: (1) the `- 48` wrapper allowance is a hard-coded guess at the `{"m":…,"pad":"…"}` overhead — it does not account for the `pad` string's own length digits or for the whole-record wrapper, so even pure-ASCII documents do not land exactly on `target`; (2) `Math.max(0, …)` silently yields zero padding whenever `inner.length + 64` sits within 48 code units of a bucket boundary, so documents near a boundary get no padding at all rather than being pushed to the next bucket. The asked-for fix (`Buffer.byteLength(inner)` and pad by bytes) should be applied to all 14 copies, not six, and ideally hoisted into one shared helper so the next module that seals a whole namespace cannot reintroduce it.

## F-12 — OPEN (nit)

**Evidence.** Both halves are untouched. `git diff scripts/accept-pd3.mjs` shows exactly one hunk, in check 8 (lines 305-326, the `deliveryOf(`/`inContext` count), 9 insertions 2 deletions; checks 2 and 4 are byte-identical to the reviewed version.

(a) C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\scripts\accept-pd3.mjs, check 2 at lines 118-137. The decisive line, line 130:
    `if (!(at >= 0 || beforeCount > 0)) throw new Error("the account vanished rather than falling");`
with line 120 `const beforeCount = postsOf(baseCards, TOP).length;` and line 82 `const TOP = authorsInOrder[0];` where line 80 builds `authorsInOrder` as `[...new Set(baseCards.filter((c) => c.kind === "post" && c.cast?.personaId).map((c) => c.cast.personaId))]`. TOP is by construction an author with at least one post card IN baseCards, so `beforeCount >= 1`, the disjunction is a tautology, and the throw is unreachable. The only other assertion, line 127 `if (at >= 0 && !(at > before)) throw ...`, is self-guarded on `at >= 0`, so `at < 0` skips it too. The check's own return string (line 136) prints `"off the page"` as a success outcome. There is no `postsOf(after.cards, TOP).length > 0` anywhere in the check; the requested direct presence assertion was not added.

(b) Same file, check 4 at lines 165-187. Line 178-179 unfollow the crypto facet and follow `facet_root_acc_crypto_2_astronomy`, so at the moment of the line 183 assertion (`if (after !== 0) throw ...`) the viewer HAS a facet-follow on that root. lib\feed.ts lines 523-527 (the review cited ~513-516; the block moved, the code did not):
    `if (author && facetScopedRoots.has(author.rootId)) { const allowedClusters = facetScopedRoots.get(author.rootId)!; if (!allowedClusters.has(author.cluster)) continue; }`
That `continue` fires before the evaluator context is built (lines 539-547), so the post never reaches any compiled rule. The compiled `delivery:facet-only` rule in lib\delivery\tiers.ts tests `author.cluster in allowedClusters` where lib\feed.ts line 409 builds that argument as the UNION across roots (`for (const set of facetScopedRoots.values()) for (const c of set) allowed.add(c);`) — with exactly one scoped root the union equals the per-root set, so the rule computes the identical boolean to the scope that already skipped the post. The check does not set the tier while the root's facet-follow is absent from the union.

I tried to defeat each. (a): compile "quiet" to `action: "hide"` instead of `"downrank"` in compileDeliveryRules — `at` becomes -1, line 127 is skipped by its own `at >= 0` guard, line 130's disjunction is still true, line 134's `restored` is >= 0 because the tier is back to normal, and the check reports PASS with "off the page" while quiet does the one thing its own title (line 118, "WITHOUT HIDING IT") forbids. (b): delete the `rules.push({ id: "delivery:facet-only", ... })` block from compileDeliveryRules — the line 170 refusal still returns 409/no_facet (that guard lives in setTier, not in the compiler), `visible` is unchanged, and `after` is still 0 via the per-root scope; the check stays green. I could not construct any input under which either assertion fails.

**Residual.** Check 2 cannot distinguish "deranked and fell down the page" from "hidden entirely", which is precisely the distinction its title asserts; any regression that turns quiet into a hide (compiling it to action "hide", or QUIET_PENALTY becoming a filter) passes both of its assertions and the restore assertion. Check 4's scope half is insensitive to the code it purports to prove: removing the facet-only compiled rule from lib\delivery\tiers.ts leaves it green, so the only live coverage of that rule is check 8's textual `compileDeliveryRules` grep. Minimal fixes: in check 2 replace line 130 with an unconditional `if (postsOf(after.cards, TOP).length === 0) throw ...` (and drop the `at >= 0 &&` guard on line 127, since presence is then asserted); in check 4, after setting facet-only, unfollow the crypto facet WITHOUT following astronomy so `facetScopedRoots` has no entry for root_acc_crypto_2, the per-root `continue` cannot fire, and only the compiled hide rule (with an empty union → the `[" none"]` sentinel) can produce 0. Note one correction to the finding's wording: check 4 is not vacuous in its entirety — the 409/no_facet refusal at lines 169-170 exercises the real `setTier` guard in lib\delivery\tiers.ts. It is the scope half that cannot fail.

## F-12a — PARTIAL (nit)

**Evidence.** QUANTUM — VERIFIED, unchanged. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\identity\chrome.ts:133-134`, inside `save()`:

    const target = 1024 * Math.ceil((inner.length + 64) / 1024);
    const sealed = encryptNamespace(VAULT_NS, { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });

The quantum is exactly 1024 and there is no degenerate un-padded branch: `target >= inner.length + 64` always, so `target - inner.length - 48 >= 16` and the `Math.max(0, ...)` clamp is never taken. The plaintext record is `{"m":<inner>,"pad":"<pad>"}` = 15 + inner.length + (target - inner.length - 48) = target - 33 bytes — always an exact multiple-of-1024 minus 33. So the sealed size is a true 1 KiB bucket, exactly as F-12a describes. The identical line appears in 13 modules (`lib/vault/vault.ts:203` `sealWhole`, `lib/influence/allowance.ts:106`, `lib/delivery/tiers.ts:103`, `lib/attest/vault.ts:42`, `lib/device/rootlink.ts:106`, `lib/fc/personaFid.ts:93`, `lib/identity/roster.ts:33`, `lib/identity/rootRoster.ts:104`, `lib/identity/sessionHandles.ts:60`, `lib/readwise/state.ts:140`, `lib/x/porting.ts:107`, `lib/zk/anonAttribution.ts:90`, `lib/zones/store.ts:60`) — same discipline, same constant.

ARITHMETIC — the finding's "roughly thirty" is off by a third, in the safe direction. Persona ids are not short: `lib/identity/keystore.ts:163-167` — `derivePersonaId` returns `"p_" + sha256(...).slice(0, 32)`, i.e. 34 chars. So one chosen-tint entry in `inner` is `"p_<32 hex>":"#1d9bf0",` = 47 bytes, not ~30. Base `{"tints":{},"unified":false,"compartment":false}` is 48 bytes, and the 1 KiB→2 KiB step fires at `inner.length >= 961`, i.e. at 20 chosen tints, not thirty. The bucket is therefore coarser relative to any plausible roster than the finding said: a device with fewer than 20 hand-picked tints is indistinguishable from an empty one, which is every realistic device.

CHROME PROSE — does NOT overstate; this half of the finding comes back clean. The two places that describe this record both make an ADDRESS claim only, never a size claim:
- `lib/identity/chrome.ts:5-8`: "Both live in ONE opaque padded sealed vault record (`personaChrome`, key "_") ... a per-persona map keyed by persona id would hand the operator this root's sibling set in the ADDRESSES even with every value encrypted."
- `SECURITY-POSTURE.md:1697-1699`: "sealed whole like `modes`, one opaque padded record under one opaque key, so the operator cannot even read the ADDRESSES as a sibling set."
Neither sentence asserts the count is hidden. The sibling `deliveryTiers` prose is the same shape and equally clean (`lib/delivery/tiers.ts:23-26`: "the addresses would say as much as the values"), and the global honest statement exists at `lib/vault/vault.ts:195-196` — "only the namespace's NAME and its padded size remain visible (A-CU-NAMESPACE-NAMES-VISIBLE)" — and again at `notes/reports/REPORT-CUSTODY.md:100` ("its KiB-rounded size remain[s] visible"). So the padding is documented as size-leaking-at-KiB-granularity at the mechanism, and the chrome claim is correctly scoped to addresses.

THE THIRD RECORD THE FINDING NAMES IS THE ONE THAT OVERSTATES. `lib\influence\allowance.ts:107`, the comment directly above the same quantum:

    // ONE opaque padded sealed record: the length reveals neither the balance nor the history size

That is a size-hiding claim, and the 1 KiB quantum does not support it. Unlike `tints` (bounded by the roster, and one entry per hand-picked colour), `InfluenceDoc` at `lib/influence/allowance.ts:56-57` holds `mine: StakeEvent[]` and `accruals: AccrualRecord[]`, both append-only and unbounded — the sealed `influence` record crosses 1 KiB after a handful of stakes and keeps stepping, so its ciphertext length is a monotone, ~1 KiB-quantized readout of exactly "the history size" the comment says it does not reveal.

I tried to defeat the chrome claim itself and could not: there is no path that writes `personaChrome` without going through `save()` (the only callers are `setTint`, `clearTint`, `setUnified`, `setCompartment`, all in this file), no caller passes its own pre-sealed entries into the `sealWhole` pass-through for this namespace, and `pad` is never zero. The address-hiding property holds as stated.

**Residual.** Two concrete leftovers, both documentation-grade, neither a new exploit path.

1. `lib/influence/allowance.ts:107` asserts "the length reveals neither the balance nor the history size" about a record whose history arrays grow without bound. An operator watching the `influence` namespace's ciphertext length sees it step 1 KiB → 2 KiB → 3 KiB and learns the stake/accrual history size to within ~1 KiB, plus the timing of each crossing. The fix is the comment, not the code: say "to a 1 KiB bucket" the way `lib/vault/vault.ts:196` and `notes/reports/REPORT-CUSTODY.md:100` already do. `SECURITY-POSTURE.md:1239` is borderline on the same point — "ciphertext of a fixed 1 KiB step" reads as "always 1 KiB" as easily as "quantized to 1 KiB".

2. `A-CU-NAMESPACE-NAMES-VISIBLE` is cited by id in `lib/vault/vault.ts:196` and `notes/reports/REPORT-CUSTODY.md:100` but has no row of its own in the assumptions table (zero `A-CU-` ids appear in `docs/internal/assumptions.md`; the table is in `notes/reports/REPORT-CUSTODY.md` and this id is not in it). The honest size-visibility statement is therefore prose only, with a dangling id pointing at it — so there is nothing for a reader chasing the id to land on, which is how the `influence` comment got to contradict it without anything catching the contradiction.

For the chrome record specifically, nothing remains: the quantum is real, the prose is address-scoped, and the only correction is that the bucket edge is at 20 chosen tints rather than thirty.

## F-12b — OPEN (nit)

**Evidence.** The message is unchanged in the current tree. `C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\x\porting.ts` lines 227-230, inside `confirmPort`:

```
227:  if (p.status === "expired" || (p.expiresAt !== null && p.expiresAt <= Date.now())) {
228:    p.status = "expired";
229:    await save(doc);
230:    throw new Error("that offer has lapsed; the counterpart can prove the handle again to raise a fresh one");
```

The guard the review named is also unchanged — `lib/x/porting.ts:199`, in `resolvePendingPorts`: `if (p.status !== "pending" || p.counterpart.handle !== h) continue;`, and line 200 marks an elapsed pending port `expired` and `continue`s. A grep of every `.status =` assignment in the repo shows the ONLY place a port ever becomes `"pending"` is the object literal in `runRelationshipPort` (`lib/x/porting.ts:182`, `status: grant ? "issued" : "pending"`); nothing anywhere rewrites an existing port back to `pending`. The single caller of `resolvePendingPorts` is `lib/x/attestations.ts:98-99`, the handle-attestation hook — i.e. exactly the "counterpart proves the handle" path the message points at. So once a port is expired, that path skips it forever and the sentence describes a recovery that no code offers.

Reachability is real, not theoretical: `expiresAt` is never cleared when a port moves to `awaiting-confirmation` (lines 205-207 set only `status`/`counterpart.personaId`/`matchedAt`), so an offer that is matched and then left past its 30-day `PENDING_PORT_TTL_MS` window hits line 227 when the issuer finally answers, and `app/api/x/port/route.ts:41` passes the message through verbatim to the client as `{ error: <message> }` with status 503. `git log -- lib/x/porting.ts` shows the file last changed at d3d183c (the Gate 0 commit the review was written against) and `git diff --stat -- lib/x/porting.ts` is empty, so no edit has touched it since.

I tried to defeat the finding by looking for any path that makes the message true — a second caller of `resolvePendingPorts`, a status reset, a re-issuance hook, or UI copy that supersedes it — and found none. The nearest thing to a "fresh offer" is `runRelationshipPort`, which only the issuing side can invoke (it validates `ownIds()`/attestation of the caller's own handles) and which, if the counterpart's handle is already attested, issues the grant outright rather than raising an offer. Nothing the counterpart can do revives or replaces a lapsed port.

**Residual.** The fix has not been applied. Concrete path: issuer creates a port naming an unattested handle (status `pending`, `expiresAt = now + 30d`); counterpart attests the handle on day 1, so the port becomes `awaiting-confirmation` with `expiresAt` untouched; the issuer answers on day 31 via POST /api/x/port with `action: "confirm"`; `confirmPort` takes the line-227 branch and returns the line-230 text, telling the issuer the counterpart can re-prove the handle to raise a fresh offer. Re-attesting does nothing (line 199 requires `status === "pending"`), so the user is sent to a dead end. No disclosure or authorisation consequence — the guard itself is correct and fails closed; this is wrong user-facing copy only. The fix belongs in the message (say the port must be raised again by the issuer), not in reviving expired ports as pending.

## F-13 — OPEN (nit)

**Evidence.** (a) C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\feed.ts:414 — `  const deliveryOf = (authorPersonaId: string): string => deliveryMap.get(authorPersonaId) ?? "normal";` — a raw Map.get on the exact author id, no forward-pointer resolution. Called at lib/feed.ts:549 (`delivery: { tier: deliveryOf(post.authorPersonaId) },`) and lib/feed.ts:702 (`delivery: { tier: att ? deliveryOf(att.id) : "normal" },`). `resolveForwardPointer` is imported at lib/feed.ts:10 and used in the same function at lib/feed.ts:1261 for the "moved" card, so it is in scope and deliberately unused for tiers. I checked the three other places a fix could live and found none: lib/delivery/tiers.ts has zero occurrences of `fork`/`forward` (tierMapFor slices raw personaIds out of `modeId|personaId`); app/api/delivery/route.ts:94 passes `String(body.personaId)` straight into setTier with no normalisation, and components/DeliveryTierPicker.tsx POSTs the cast author's id as-is; app/api/identity/fork/route.ts carries the rep tier (line 156) and reissues linkage grants but never touches the delivery map. (b) C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA\lib\delivery\tiers.ts:103 — `  const target = 1024 * Math.ceil((inner.length + 64) / 1024);` over `JSON.stringify(doc.tiers)`, so the sealed size still steps with row count. SECURITY-POSTURE.md §17 begins at line 1692; its assumption `A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE` at line 1826 still reads "the validator holds ciphertext under one opaque key and learns neither the accounts nor the tiers" with no companion line about ciphertext length. A grep of the whole posture for pad/padded/1 KiB/record size hits only lines 646, 1239 and 1698, none of which states the size-to-count relation.

**Residual.** (a) A viewer holding a forward grant for @old -> @new quiets @old; @new's posts evaluate with delivery.tier = "normal" and rank normally, while @old's residual posts stay quieted. Symmetrically, never-miss set on @new does not pin @old's still-visible posts. Reachable on both the seeded path (line 549) and the live path (line 702). Loudness bug, not an access bug. Fix would be to resolve post.authorPersonaId through resolveForwardPointer(author, viewer, fork.forwardGrantIds) before the map lookup, or to migrate the map key at fork time. (b) An operator watching the deliveryTiers namespace learns floor(rows/~22) from the sealed record's 1 KiB step, and watches it change as the owner adds settings. The report asked only for a named assumption line; no such line exists in SECURITY-POSTURE.md.

**Proposed assumption.** A-POST-A-PADDED-RECORD-LEAKS-ITS-MAGNITUDE — the delivery-tier record is padded to a 1 KiB boundary, so the validator learns neither the accounts nor the tiers but does learn roughly how many non-normal settings exist (one step per ~22 rows) and when that count crosses a step; the padding hides the contents, not the magnitude.

## F-15a — OPEN (nit)

**Evidence.** Untouched in the current tree. `lib/delivery/tiers.ts:103-104`:
```
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m: { tiers: doc.tiers }, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
```
Identical pair at `lib/identity/chrome.ts:133-134`. The proof is one line: for any integer n = `inner.length` >= 0, `target = 1024 * ceil((n + 64) / 1024) >= n + 64`, therefore `target - n - 48 >= 16`. The `Math.max(0, …)` argument is never negative, so the clamp is unreachable at every call site. Upper bound likewise holds: `target < n + 64 + 1024`, so pad <= 1039. Nothing in the tree asserts either bound — `grep -rn "pad.length\|PAD_MIN\|assertPad\|invariant"` over `lib/` and `scripts/` returns no pad-related hit; the only `invariant` machinery is the escrow ledger's.

The formula is not in two places but FOURTEEN, each an independent literal copy of the same expression, so there is no single seam where an assertion could be added today: `lib/delivery/tiers.ts:104`, `lib/identity/chrome.ts:134`, `lib/vault/vault.ts:204` (`sealWhole`), `lib/adapters/mock/store.ts:665` (the only one that names its step, `OPAQUE_STEP = 1024`), `lib/attest/vault.ts:43`, `lib/device/rootlink.ts:107`, `lib/fc/personaFid.ts:94`, `lib/identity/rootRoster.ts:105`, `lib/identity/roster.ts:34`, `lib/identity/sessionHandles.ts:61`, `lib/influence/allowance.ts:108`, `lib/readwise/state.ts:141`, `lib/x/porting.ts:108`, `lib/zk/anonAttribution.ts:91`, `lib/zones/store.ts:61`.

Both named files HAVE been edited since the review — `git diff lib/delivery/tiers.ts` shows the F-1 fix (refusing a corrupted namespace instead of reading it as empty), the F-5 fix (cache adopted only after `flushVault` resolves), and the F-10 fix (rejecting `|` in mode/persona ids) — but the two pad lines are outside every hunk. F-15a was not in scope of those edits.

What I tried to make the clamp fire: (1) n = 0 → target = 1024, pad = 976; (2) n exactly 960 (one below the 1024 boundary) → target = 1024, pad = 16, the tight case and still non-negative; (3) n = 961 → target = 2048, pad = 1039, the other extreme; (4) float error at large n — `(n + 64) / 1024` stays exact well past V8's ~2^29 max string length, so `Math.ceil` cannot round down; (5) a smaller `OPAQUE_STEP` in `lib/adapters/mock/store.ts` — irrelevant, since `step * ceil((n + 64) / step) >= n + 64` for ANY positive step, so the floor of 16 is independent of the bucket size. The only way `inner.length` misbehaves is `JSON.stringify` returning `undefined` (an `undefined`/circular argument), and that throws a TypeError on `.length` two tokens earlier, before the `Math.max` is evaluated.

**Residual.** The clamp is still dead at all 14 sites and pad ∈ [16, 1039] is still asserted nowhere. No exploit path — this cannot produce a wrong pad, only hide one. The concrete remaining risk is maintenance, and it is slightly worse than the review stated because of the copy count: if anyone later changes the `+ 64` term, the `- 48` term or the step at ONE of the fourteen sites and breaks the floor, the `Math.max` silently absorbs it into `pad = ""`, the padded record drops to its true length, and the size-bucketing property that `lib/vault/vault.ts:193-196` is built to provide (only "the namespace's NAME and its padded size remain visible") degrades to leaking real plaintext length — with no test failing, since no test reads the pad. Worth noting alongside: the `- 48` is a magic wrapper allowance that does not match either wrapper it is used with (the `{"m":{"tiers":…},"pad":"…"}` shape in tiers.ts overshoots by 23 chars, the `{"m":…,"pad":"…"}` shape in chrome.ts by 33), so the sealed plaintext lands at `target - 23` and `target - 33` rather than at `target`. Harmless — the offset is constant per site, so lengths stay on the 1024 grid and no content leaks — but it is the same absent-invariant smell: the constant is unexplained and unchecked. The fix is one helper (e.g. `padTo(inner)` in `lib/vault/vault.ts`) that drops the `Math.max`, asserts `pad >= 16 && pad <= 1039`, and is called from all fourteen sites.

