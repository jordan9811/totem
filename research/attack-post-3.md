# attack-post-3 — the vault seam, cache coherence, and fail-open/fail-closed

Scope: `git diff 7f70cec..HEAD` (commits `d3d183c`, `a9d0b3d`, `6229339`).
Angle: the three new sealed namespaces (`personaChrome`, `deliveryTiers`, and
`readwiseState` where it touches the reset contract), the padding scheme, the
"never fail open" claim, cache coherence across flush, the reset contract, the
key format, and the colour arithmetic.

Method: read-only. No `npm run`, no server, no port bound, no script executed
against the rig. `npx tsc --noEmit` — clean. Two throwaway `node` scripts in the
session scratchpad did pure arithmetic (the padding maths and the colour-vision
matrices); they touched no project file and no socket.

Counts: **1 critical, 4 high, 7 medium, 2 low, 2 nits.** One design
disagreement. A "checked and found sound" list is at the end.

---

## F-1 — CRITICAL — the operator can turn compartment mode off, and erase the tier map, by serving a record that is not ciphertext

**Real defect.** Not covered by any assumption id in SECURITY-POSTURE.md.

`lib/identity/chrome.ts:79-92` and `lib/delivery/tiers.ts:62-69`:

```ts
const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
if (entries && Object.keys(entries).length) {
  const plain = decryptNamespace(VAULT_NS, entries);
  const rec = plain["_"] as { m?: Partial<ChromeDoc> } | undefined;
  const m = rec?.m ?? {};
  doc = { tints: ..., unified: m.unified === true, compartment: m.compartment === true, loaded: true };
}
```

`decryptNamespace` (`lib/vault/vault.ts:159-183`) **`continue`s** on any record
that is not ciphertext-shaped, and only throws when `attempted > 0 && recovered
=== 0`. A record that is not ciphertext never increments `attempted`. So if the
operator replaces the sealed `_` record with *any* plaintext object — or with a
record carrying a mismatched `ns`/`id`, which is also `continue`d at
vault.ts:169 — `decryptNamespace` returns `{}`, `rec` is `undefined`, and
`load()` produces:

- `personaChrome`: `{ tints: {}, unified: false, compartment: false, loaded: true }`
- `deliveryTiers`: `{ tiers: {}, loaded: true }`

**`loaded: true`.** That is the fail-open the whole module is written to
prevent, reached without the validator returning a single error, so none of the
three retries fire and the `if (!doc.loaded) throw` at chrome.ts:104 /
tiers.ts:81 never runs.

The second half is worse: `save()` refuses only `!doc.loaded`
(chrome.ts:115, tiers.ts:92). The forged-empty document is `loaded: true`, so
the next `setTint` / `setCompartment` / `setTier` **seals the empty document
back over the real one**, under the real vault key. The loss is then permanent
and self-inflicted.

A cheaper version needs no forgery at all: the operator **deletes** the row.
`fetchState` returns 404, chrome.ts:74-77 sets `doc.loaded = true` and breaks,
and the outcome is identical. This is verbatim the lesson already written into
this repo at `lib/vault/vault.ts:63-66` — *"encryption hides them from the
operator but nothing stops the operator DELETING them, and 'absent' was the
benign first-run state (attack-3 F-3)"* — recorded for `zkQueue`, and neither
new namespace applies it.

Concrete sequence:
1. Owner turns compartment mode on. `personaChrome` holds a sealed record.
2. Operator runs `UPDATE adapter_state SET ... ` (or simply deletes the row) so
   `/state/personaChrome` answers `{"entries":{"_":{"unified":true}}}` — no
   `ct`, no `nonce`.
3. Any request: `load()` returns `compartment:false, loaded:true`.
   `viewScope()` returns `reason:"single"`, `visiblePersonaIds: ownIds`.
   `/api/personas`, `/api/personas/act-as-options` and `/api/search/unified`
   all enumerate every sibling. `/api/influence?view=history&personaId=<sibling>`
   answers 200 instead of 403.
4. Owner changes any tint. The empty document is sealed and PUT. The record is
   now genuinely gone.

For `deliveryTiers` the same step un-quiets every account the owner turned down
— the direction `lib/delivery/tiers.ts:78-80` names as the one that "leaks
attention to somebody unwanted".

**Why the existing defence does not cover this.** `lib/adapters/mock/persist.ts`
has exactly the right mechanism — `markSealed()` (line 357) records that this
device sealed a namespace, and `hydrate()` (`lib/adapters/mock/store.ts:725`)
refuses a plaintext shape for a namespace already in that set. It does not
apply here for two independent reasons: `flushVault()` (persist.ts:393-411)
**never calls `markSealed`** (only `flush()` does, at line 373), and `hydrate()`
iterates `Object.entries(SERIALIZERS)`, which is `Record<Namespace, Serializer>`
— `personaChrome` and `deliveryTiers` are `ExtraNamespace`, so the loop never
reaches them even if they were marked.

**Fix.** In each sealed module's `load()`, treat "the namespace has entries but
no decryptable `_` record" as a hard failure rather than as an empty document:

```ts
const plain = decryptNamespace(VAULT_NS, entries);
const rec = plain["_"];
if (!rec) throw new Error("persona chrome: the validator returned a record this device cannot authenticate");
```

and have `flushVault()` call `markSealed(ns)` so a *once-sealed* namespace
coming back 404 or plaintext is refused too (the 404 case needs the
`sealedNamespaces()` set, since an absent record is legitimately the first-run
state). The same three-line change is owed to `lib/zones/store.ts:36-40`,
`lib/influence/allowance.ts`, `lib/x/porting.ts`, `lib/attest/vault.ts:26-32`
and `lib/zk/anonAttribution.ts` — but compartment mode and the quiet tier are
the first two where the forged-empty read silently removes a **protection**.

---

## F-2 — HIGH — a device unlock under a different seed keeps the previous root's chrome and tier documents, and then writes them into the new root's vault

**Real defect.** Item 4's class, in the production path rather than the rig.

`lib/device/boot.ts:152-165`:

```ts
/**
 * Gate 2: the device installed a different seed (an unlock, an import). Forget every cache that belongs to the
 * previous root — the keystore copy, the envelope bootstrap, the roster, the store — and boot the identity again.
 */
export async function reloadIdentity(): Promise<DeviceInfo> {
  ks.forgetCachedKeystore();
  persist.resetEnvelopeBootstrap();
  roster.resetRootRoster();
  await store.reloadForDevice();
  deviceJar.clear();
  return bootIdentity();
}
```

"Forget every cache that belongs to the previous root" forgets five things and
leaves **every sealed-document cache standing**: `__layersPersonaChrome`,
`__layersDeliveryTiers`, `__layersScrollZones`, `__layersInfluence`,
`__layersPorts`, `__layersZkAttestations`, `__layersPersonaFids`,
`__layersAnonAttribution`, `__layersReadwiseState`. `reloadForDevice()`
(`lib/adapters/mock/store.ts:899-907`) resets the mock state, the hydration
promise, the flush cache, the local store and the ephemeral session — and
nothing sealed.

Sequence:
1. Root A has compartment mode ON and twelve quiet accounts. Both documents are
   cached in the process.
2. The person unlocks with root B's seed (or imports a phrase). `reloadIdentity()`
   runs.
3. `viewScope()` calls `load()`, which short-circuits on
   `if (g.__layersPersonaChrome) return g.__layersPersonaChrome` (chrome.ts:68).
   **Root B's session runs under root A's compartment flag** — on, when root B
   never asked for it, or off, when root B had it on and is now unprotected with
   no indication.
4. `tierMapFor(mode.id)` returns root A's quiet map, so root B's feed is ranked
   by a stranger's preferences.
5. Root B changes any tint or any tier. `save()` seals **root A's document**
   under **root B's vault key** and PUTs it to root B's `/state/personaChrome`.
   Root B's real record is overwritten and root A's tint map now lives,
   readable, inside root B's vault.

The rig's device-loss hook has the same gap and names it in its own comment.
`app/api/dev/route.ts:216-226`:

```ts
// attack-mega-2 F2: the in-process caches this pass added die with the device too, so recovery (c4) rebuilds
// them from the vault rather than inheriting a warm cache
const { resetPortsCache: rpc } = ...; rpc();
const { resetUnifiedIndex: rui } = ...; rui();
const { resetEmbedWorker: rew } = ...; rew();
const { resetZonesCache: rzc } = ...; rzc();
const { resetInfluenceCache: ric } = ...; ric();
```

The post-deploy pass added two caches to the same family and touched neither
this list nor `reloadIdentity()`. It only touched `resetSeed`.

**Fix.** One exported registry — e.g. `lib/vault/caches.ts` exporting
`resetEverySealedCache()` — called from `reloadIdentity()`, from
`simulateDeviceLoss`, and from `resetSeed`, so a new sealed namespace is
registered in exactly one place instead of three. That is the durable form of
the fix; adding two more lines to three call sites is the same bug waiting for
Gate 5.

---

## F-3 — HIGH — the deuteranopia matrix is wrong, and the suite's "independent copy" contains the identical error

**Real defect.** `lib/identity/colorVision.ts:33` and `scripts/accept-pd2.mjs:91`.

```ts
deuteranopia: [[0.625, 0.7, 0], [0.7, 0.3, 0], [0, 0, 1]],
```

The standard Viénot–Brettel–Mollon / HCIRN deuteranopia matrix — the same source
the file's other two rows come from verbatim — is:

```
[[0.625, 0.375, 0], [0.700, 0.300, 0], [0, 0.300, 0.700]]
```

Two transcription errors in one matrix: row 0 column 1 is `0.7` where it should
be `0.375` (the `0.7` appears to have been copied down from row 1 column 0), and
row 2 is the identity where it should be `[0, 0.3, 0.7]`. The protanopia and
tritanopia rows are correct to five decimals, which is what makes the slip
invisible on a read-through.

Two consequences, both measured:

1. **Row 0 sums to 1.325**, so the simulated red channel leaves gamut.
   `linearToSrgb` clamps only the lower end (`Math.max(c, 0)`), so the value is
   passed through; `toLab` then feeds `c > 1` back into `srgbToLinear`, producing
   `Y > 1` and `L* > 100`. Over 20 000 random colours, 599 of 60 000 channel
   samples exceeded 1.0, maximum 1.131. Every distance involving such a colour is
   inflated.
2. **The red–green axis no longer collapses**, which is the entire purpose of the
   simulation. With the correct matrix `R' = 0.625R + 0.375G` and
   `G' = 0.700R + 0.300G` are near-identical mixtures, so R' ≈ G' and red-green
   information is destroyed. With `0.7` in place of `0.375` they are different
   mixtures, so the difference `R' − G'` preserves exactly the information a
   deuteranope does not have. Pure red vs pure green measures dE 45.1 under the
   shipped matrix and 88.4 under the correct one — the shipped one *understates*
   there, but for the near-neutral violets that matter it overstates badly.

**The concrete failure this causes.** `MIN_SEPARATION` is 12 (colorVision.ts:70).
Searching hand-pickable hex values against the default palette blue `#1d9bf0`
found twelve pairs in seconds that the shipped gate **accepts** and a real
deuteranope cannot distinguish:

| picked colour | shipped `separation()` | correct `separation()` |
|---|---|---|
| `#6a07f9` | 12.4 (accepted) | **4.1**, deuteranopia |
| `#631af5` | 12.3 (accepted) | **4.5**, deuteranopia |
| `#6409f4` | 12.9 (accepted) | **4.8**, deuteranopia |
| `#6318f2` | 12.3 (accepted) | **5.1**, deuteranopia |

`POST /api/persona/chrome {action:"tint", personaId:"<B>", color:"#6a07f9"}`
with sibling A on the default blue returns `{ok:true}`. That is precisely the
failure the module header claims to have fixed — *"the product blue and a violet
collapsing to a CIE76 dE of 4.3 under protanopia"* (chrome.ts:29-32) —
reintroduced one vision model over, in the gate rather than in the palette.

**What is NOT affected, and should be said plainly.** The eight shipped defaults
hold a minimum pairwise dE of **15.05 under both the shipped and the corrected
matrices** (worst pair `#0f5c3a`/`#536471`, protanopia). The auto-assigned
palette is genuinely safe. The defect is confined to the `setTint` gate on
hand-picked colours — which is exactly where the header says free-text colour
entry needed a gate.

**On the independence claim.** `lib/identity/colorVision.ts:15-17` says the suite
"carries its own independent copy of this arithmetic on purpose: a suite that
imports the implementation it is checking only proves the implementation equals
itself." `scripts/accept-pd2.mjs:85-109` is a character-for-character
transliteration — same `srgbToLinear`, same `linearToSrgb` with the same
one-sided clamp, same `toLab`, same `Math.hypot`, and **the same wrong
deuteranopia matrix**. It is not an independent copy; it is the same copy in a
different file extension. Check 3 of pd2 (line 195) therefore validates the
palette against the same mistake and passes.

**Fix.** Correct both matrices. Then add the invariants a *genuinely* independent
check can assert without re-deriving the arithmetic:

- every simulation row sums to 1.0 ± 1e-9 (catches this exact slip);
- no simulated channel exceeds 1.0 for any of the 2^24 sRGB inputs sampled;
- for deuteranopia and protanopia, rows 0 and 1 must be the same R/G mixture up
  to a scalar — that is the dichromatic collapse, stated as an assertion;
- one hard-coded expected dE from an external reference, so a future retyping
  is caught by a number rather than by a shape.

---

## F-4 — HIGH — the layout's single `catch` fails the SCOPE open: an unreadable chrome record renders every sibling in the switcher

**Real defect.** Contradicts the comment eight lines above it and
`A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC`'s framing.

`app/(main)/layout.tsx:73-76` states the contract:

> *"It fails OPEN, and only this far: an unreadable chrome record leaves the
> chrome UNTINTED … The SCOPE half never fails open — viewScope throws, and the
> routes that enforce it answer 503."*

`app/(main)/layout.tsx:82-106` does not implement it:

```ts
let visibleIds: string[] | null = null;
try {
  const own = await ownPersonaIdsAll();
  const tints = await tintsFor(...);        // load() — can throw
  tintColor = ...; tintSource = ...;
  const scope = await viewScope(...);        // same load(), same throw
  visibleIds = scope.visiblePersonaIds;
} catch {
  tintColor = null;                          // visibleIds stays null
}
...
const visiblePersonas = visibleIds ? session.personas.filter(...) : session.personas;
```

One `try` covers both halves, and the `catch` restores only the tint. `visibleIds`
stays `null`, so line 106 hands **`session.personas`** — the complete roster — to
`<Providers>`. The account switcher, which line 102-104 calls "the server render
agreeing with the route", renders every sibling while compartment mode is on.

Triggering it does not require three timeouts. `load()`'s retry loop breaks
immediately on a vault-key error (`chrome.ts:97`:
`if (String((e as Error).message).includes("vault")) break;`), and
`decryptNamespace` throws `vault: all N ciphertext records in "personaChrome"
failed to decrypt` on a wrong key or a corrupted record — which the rig can
produce today with the `corruptVaultCiphertext` dev action. One corrupted byte,
one page load, full roster.

The routes do fail closed (`/api/personas` and `/api/personas/act-as-options` let
the throw escape to a 500; `/api/persona/chrome` and `/api/delivery` answer 503),
so the *data layer* holds. But the server-rendered switcher is a data layer too,
and it is the one the person is looking at.

Two smaller edges in the same block:
- `tintSource` keeps its initial `"unavailable"` and `data-scope` (line 166)
  evaluates to `"normal"` — the markup positively asserts a normal scope when the
  server does not know what the scope is.
- The catch also swallows a throw from `ownPersonaIdsAll()`. That one is currently
  benign (`lib/influence/allowance.ts:122-126` reads `SEED_VIEWER` and the
  keystore synchronously, no vault), but it means an unrelated module gaining a
  vault read would silently disable compartment mode in the switcher.

**Fix.** Split the two:

```ts
try { /* tints only */ } catch { tintColor = null; }
// no catch — or, if the layout must never 500:
let visibleIds: string[];
try { visibleIds = (await viewScope(...)).visiblePersonaIds; }
catch { visibleIds = [session.active?.id ?? actingId]; }   // fail CLOSED
```

and render `data-scope` from `scope.reason`, with a third value (`"unknown"`)
when the record could not be read.

---

## F-5 — HIGH — the in-memory document is replaced before the flush resolves, and is never rolled back

**Real defect** (pattern inherited from `lib/zones/store.ts:58`; the new
namespaces are the first where the stranded value is a protection).

`lib/identity/chrome.ts:114-122` and `lib/delivery/tiers.ts:91-98`:

```ts
async function save(doc: ChromeDoc): Promise<void> {
  if (!doc.loaded) throw ...;
  g.__layersPersonaChrome = doc;          // <- cache updated FIRST
  ...
  await flushVault(VAULT_NS, sealed);      // <- may throw
}
```

### 5a. A failed flush leaves a ghost protection

`POST /api/persona/chrome {action:"compartment", on:true}` → `doc.compartment =
true` → cache updated → `flushVault` throws (validator 500, or 413 — see F-10 —
or 409, see 5b) → the route answers 503. The person sees an error. But every
`viewScope()` for the rest of the process reads `compartment: true` from the
cache, so the app *behaves* as though compartment mode is on: the switcher
narrows, the act-as picker narrows, search rebuilds single-persona. The owner
has every reason to believe the protection took.

It did not. The next process restart reads `compartment: false` from the vault,
and nothing announces it. `A-POST-COMPARTMENT-IS-NOT-ANTI-FORENSIC` says it is
"one tap to leave" — this is zero taps to leave, on a timer the owner cannot see.

The mirror case loses a quiet setting: a failed `setTier(..., "quiet")` shows the
account quieted for the rest of the process and normal after a restart.

### 5b. The 429 retry holds its counter, so an earlier write can land last

`validatorFetch` (`lib/adapters/mock/persist.ts:119-127`) retries a 429 up to
four times, waiting up to 8 s each. The envelope counter is allocated **once**,
in `envelopeHeaders` (persist.ts:259) **before** the first attempt, and reused
across every retry.

```
t=0   A: POST tint       → doc.tints = {...+A}; seals S1 (compartment:false); PUT → 429; sleeps 8 s
t=1   B: POST compartment → doc.compartment = true; seals S2 (tints+A, compartment:true); PUT → 200
      validator: compartment = true.  Route B returns ok. UI shows compartment ON.
t=8   A: retry with the SAME counter N
```

- **`LAYERS_REQUIRE_SIG` unset** — A's PUT succeeds and overwrites S2. The
  validator now holds `compartment:false`. Both routes returned 200. Nothing
  logged an error. The next restart silently drops the protection.
- **`LAYERS_REQUIRE_SIG=true`** — `validator/server.js:475`
  (`if (prev && counter <= prev.counter) return { status: 409, error: 'stale
  counter …' }`) refuses A. `flushVault` throws, A's route answers 503. That is
  better, but A's tint is *already in the shared cache* and is never rolled back,
  so the divergence of 5a stands and A's change is lost at the next restart.

Note the two writers share one object: `await load()` returns
`g.__layersPersonaChrome` itself, not a copy, so B's seal already contains A's
mutation. The damage is always "an earlier-sealed payload landing last reverts a
later mutation", never a partial merge.

**Fix.**
1. Seal from a snapshot, flush, and assign the cache only on success:
   ```ts
   const next = { ...doc };
   await flushVault(VAULT_NS, seal(next));
   g.__layersPersonaChrome = next;
   ```
   Roll the caller's mutation back on throw (or make the mutators build a new
   document and pass it to `save`, never mutate the cached one in place).
2. Serialise writes per namespace behind a promise chain. `lib/zk/anon/queue.ts:230`
   already does this for the drain (`__layersZkDrainInFlight`); the same shape
   here makes 5b unreachable.
3. Allocate the envelope counter **inside** the retry loop, not once per
   `envelopeHeaders` call, so a deferred retry is not guaranteed to be stale.

---

## F-6 — MEDIUM — SECURITY-POSTURE.md documents a fail-open the code deliberately refuses

**Documentation defect, on the exact claim a reviewer checks.**

`SECURITY-POSTURE.md`, `A-POST-A-TIER-IS-A-PREFERENCE-SIGNAL-ON-THIS-DEVICE`,
final clause:

> *"… it travels with the vault, and a device that cannot read the vault
> **delivers everything Normally** rather than guessing."*

`lib/delivery/tiers.ts:78-86` says the opposite, at length:

> *"Never fail open. An unreadable tier map read as 'everything is normal' would
> quietly un-quiet an account the owner turned down, which is the one direction
> of this setting that leaks attention to somebody unwanted."*

and throws. `lib/feed.ts:392-402` does not catch it, `/api/feed2` answers 503,
`app/(main)/home/page.tsx:104-111` sets `loadError`. The code is right. The
posture document — which is what an operator, an auditor or the next reviewer
reads — states the behaviour the code exists to prevent.

Two smaller inaccuracies in the same section: §17's opening says "the vault
records this pass adds (`personaChrome`)", naming one namespace when the pass
adds two (`deliveryTiers`, plus `readwiseState` in flight); and §17's "What
compartment mode does" lists four narrowed surfaces without saying that the
*cross-persona view* toggle narrows exactly one of them (see D-1).

**Fix.** Replace the clause with "a device that cannot read the vault refuses to
build a feed rather than delivering everything normally", and name `deliveryTiers`
in the opening paragraph.

---

## F-7 — MEDIUM — `tintsFor` de-duplicates by exact string while `setTint` gates by perceptual distance, so the gate creates the collision it just refused

**Real defect.** `lib/identity/chrome.ts:150-171` vs `179-214`.

`tintsFor` builds `taken` from chosen colours and then walks the palette
skipping `taken.has(color)` — **exact string equality**. `setTint` gates with
`separation(...) < MIN_SEPARATION` — **perceptual**. A chosen colour that is near
a palette entry without being equal to it does not remove that entry from the
walk.

Repro, with roster order `[C, A, B]` (the order `ownPersonaIdsAll()` happens to
return — see F-8 for why that order is not stable):

1. All three auto: `C = #1d9bf0`, `A = #f4a524`, `B = #0f5c3a`.
2. `POST /api/persona/chrome {action:"tint", personaId:"A", color:"#f4a525"}`.
   `setTint` calls `tintsFor(ownIds)` (line 190), which returns the *current*
   assignment — `C` blue, `B` pine, both far from `#f4a525`. `A`'s own row is
   skipped by `if (id === personaId) continue`. **Accepted.**
3. Next render: `taken = {"#f4a525"}`. `C` takes `PAL[0] = #1d9bf0`. `B` steps to
   `PAL[1] = #f4a524` — not in `taken`, because `"#f4a524" !== "#f4a525"`.
4. `A = #f4a525`, `B = #f4a524`. **dE ≈ 0.2 under every vision model**, including
   normal.

Nothing refuses it, nothing reports it, and the collision is *created by* the
control whose stated job (chrome.ts:184-189) is preventing it: *"a free-text
colour that happens to land on a sibling's accent … would quietly undo the whole
cue."*

**Fix.** In `tintsFor`, skip a palette entry when it is within `MIN_SEPARATION` of
**any** taken colour, not only when it is string-equal:

```ts
const clashes = (c: string) => [...taken].some((t) => separation(c, t).distance < MIN_SEPARATION);
```

and have `setTint` re-run `tintsFor` after the write, refusing (and rolling back)
if any pair now collapses — the invariant should be checked on the *resulting*
assignment, not on the pre-write one.

---

## F-8 — MEDIUM — auto tints move when the roster changes, and the clone report promises a colour nothing stores

**Real defect**, against the module's own stated invariant.

`lib/identity/chrome.ts:141-145`:

> *"The walk is deterministic (roster order, palette order, skipping what is
> already taken), so the same roster always yields the same assignment — a tint
> that moved between renders would be worse than no tint at all."*

The walk is deterministic **for a fixed roster**. It assigns by *position*, and
nothing persists an auto tint — `doc.tints` holds chosen colours only
(chrome.ts:52). Remove any persona earlier in the walk and every persona after it
shifts one palette slot:

- `own = [A, B, C]` → A `#1d9bf0`, B `#f4a524`, C `#0f5c3a`.
- Delete B (a clone the owner discards; `purgeForkedPersonas()` during
  `resetState`; or simply a different `ownPersonaIdsAll()` ordering after the
  keystore changes — `lib/influence/allowance.ts:122-126` builds it as
  `[...new Set([...SEED_VIEWER.personas, ...ownPersonaIds()])]`).
- `own = [A, C]` → A `#1d9bf0`, **C `#f4a524`**. C's cue changed colour with no
  action by C's owner.

`app/api/identity/fork/route.ts:300-312` makes the promise explicit and then does
not keep it:

```ts
const assigned = await tintsFor([...(await ownPersonaIdsAll()), created.id]);
tint = assigned[created.id] ? { ...assigned[created.id] } : null;
```

`tintsFor` computes; nothing saves. The clone report says "your new persona is
blue" — the route's own comment distinguishes that from "happens to be blue
today" — and what it actually returns is the second thing.

**Fix.** Either persist the auto assignment on first observation (write it into
`doc.tints` with the `source:"auto"` marker already in the `Tint` type), or derive
the colour from a stable per-persona hash with collision stepping instead of from
roster position. The fork route should take the first option so its report is
true when it is read.

---

## F-9 — MEDIUM — the ciphertext length is a monotone counter of the map size, at ~21 delivery settings per step, and no assumption id says so

**Design disagreement / missing assumption**, not a code bug.

The padding is `target = 1024 * Math.ceil((inner.length + 64) / 1024)` and
`pad = max(0, target - inner.length - 48)`, so the sealed plaintext is
`{"m":<inner>,"pad":"<pad>"}` = `inner + 15 + (target - inner - 48)` =
**exactly `target - 33` bytes**, verified for inner lengths 0 … 20 000. The
ciphertext therefore reveals `ceil((inner.length + 64) / 1024)` and nothing else
about the content. The *addresses* claim in `lib/vault/vault.ts:100-109` and §17
is true. The *size* is a channel that is not mentioned anywhere.

Measured step points, using realistic ids (`mode_xxxx|persona_acc_crypto_N` →
tier):

| `deliveryTiers` entries | plaintext | | `personaChrome` chosen tints | plaintext |
|---|---|---|---|---|
| 0–20 | 991 B | | 0–27 | 991 B |
| 21 | 2015 B | | 28 | 2015 B |
| 43 | 3039 B | | 58 | 3039 B |
| 65 | 4063 B | | 88 | 4063 B |
| 86 | 5087 B | | 118 | 5087 B |

So:

- **`personaChrome` is effectively constant-size in practice** — the first step
  needs 28 *chosen* tints, and auto tints are not stored. The claim holds there
  for any realistic roster.
- **`deliveryTiers` steps at ~21–22 non-normal settings and keeps stepping,
  unbounded.** A user who marks 25 accounts quiet is visibly distinct from a
  fresh install. And because every write PUTs the whole record, the operator sees
  the *exact request* at which the step happens, which pins the count to the
  boundary rather than merely to the bucket — "you crossed 21 on this write" is
  strictly more than "you are somewhere in 21–42".

The older namespaces use the identical formula (`lib/vault/vault.ts:199-206`
`sealWhole`, `lib/zones/store.ts:59`, `lib/influence/allowance.ts:103`,
`lib/attest/vault.ts:41`), so this is consistent rather than a regression — but
the posture table at SECURITY-POSTURE.md:1239 describes the influence record as
*"ciphertext of a fixed 1 KiB step"*, which reads as "always 1 KiB" and is not
what the formula does.

**Ask.** Either state it —

> **A-POST-DELIVERY-SIZE-STEPS-WITH-THE-MAP** — the sealed record is padded to a
> 1 KiB boundary, so its length leaks the size of the map to within ~21 entries,
> and each write that crosses a boundary pins the count to that boundary. The
> operator learns roughly how many accounts you have singled out, never which or
> to what.

— or give the record a floor large enough that realistic maps never step (8 KiB
costs nothing at this scale, and moves the first step to ~170 entries).

---

## F-10 — MEDIUM — `modeId` is unvalidated, and a `|` in it breaks the key split

**Real defect.** `app/api/delivery/route.ts:91` + `lib/delivery/tiers.ts:48,117,134-136`.

```ts
const modeId = typeof body.modeId === "string" && body.modeId ? body.modeId : active.id;
```

No check that `modeId` is one of the viewer's modes — and the route already has
the list, three lines earlier, for `modeName`. `setTier` validates only
`!modeId || !personaId` (tiers.ts:159). The key is built by concatenation
(`tiers.ts:48`) and split at the **first** `|` in `listNonNormal` (tiers.ts:135)
while `tierMapFor` splits by **prefix** (tiers.ts:117). Those two disagree the
moment a component contains the delimiter.

```
POST /api/delivery {"personaId":"persona_x","modeId":"mode_a|persona_y","tier":"quiet"}
  → key "mode_a|persona_y|persona_x"
listNonNormal() → { modeId:"mode_a", personaId:"persona_y|persona_x", tier:"quiet" }
tierMapFor("mode_a") → Map { "persona_y|persona_x" => "quiet" }
```

The management screen shows a quiet row against `mode_a` naming an account that
does not exist (`personaById.get(...)` misses, so the raw key is rendered as the
handle — route.ts:74). The row is enforced by nothing, because
`deliveryMap.get(post.authorPersonaId)` never matches. And the only way to remove
it is to POST `personaId: "persona_y|persona_x"` with `tier:"normal"` under
`mode_a`, which no UI offers.

Real mode ids are `nextId("mode")` = `mode_<base36>` (`lib/adapters/mock/mode.ts:49`)
and cannot contain `|`, so this is client-supplied only — a storage- and
UI-integrity bug, not a privilege boundary. But it is also the unbounded-growth
vector for F-9 and for the validator's body limit: `validator/server.js:137` is a
bare `express.json()`, default **100 kb**. At ~48 bytes per entry plus base64
expansion that is roughly 1 500 rows, after which every `flushVault` of the
namespace answers 413 **forever** — while `save()` keeps updating the cache first
(F-5) and the route keeps reporting success on the *next* setting.

**Fix.** Validate `modeId` against the `modes` list the route already fetched;
reject `|` in either component; and store `{ [modeId]: { [personaId]: tier } }`
as a nested map so the delimiter stops being load-bearing. A cap on the number of
rows is cheap insurance for the 413.

---

## F-11 — MEDIUM — repo-wide reset audit: the three new caches are correct; two older sealed caches have no reset at all

**Item 4, answered.** Every `globalThis` sealed-document cache in the repo,
checked against `resetSeed` (`app/api/dev/route.ts:429-546`):

| cache | module | reset in `resetSeed`? |
|---|---|---|
| `__layersPersonaChrome` | `lib/identity/chrome.ts:63` | yes — route.ts:518-519 |
| `__layersDeliveryTiers` | `lib/delivery/tiers.ts:47` | yes — route.ts:523-524 |
| `__layersReadwiseState` | `lib/readwise/state.ts:77` | yes (working tree, Gate 4 in flight) |
| `__layersScrollZones` | `lib/zones/store.ts:24` | yes |
| `__layersInfluence` | `lib/influence/allowance.ts:61` | yes (twice — also in `resetState`) |
| `__layersPorts` | `lib/x/porting.ts:72` | yes |
| `__layersZkAttestations` | `lib/attest/vault.ts:17` | yes |
| `__layersPersonaFids` | `lib/fc/personaFid.ts:51` | yes |
| `__layersRootRoster` | `lib/identity/rootRoster.ts:55` | yes |
| `__layersUnifiedSearch` | `lib/search/unified.ts:121` | yes |
| `__layersZkPrefetch` | `lib/zk/prefetch.ts:66` | yes, via `resetZkRuntimeOverrides` |
| **`__layersAnonAttribution`** | `lib/zk/anonAttribution.ts:48` | **NO — no reset function exists** |
| **`__layersSessionHandles`** | `lib/identity/sessionHandles.ts:15` | **NO — no reset function exists** |

The two new ones are correct, including the subtlety that matters: both reset
calls sit **after** `await resetState()` (route.ts:487), which reaches
`wipeAll()` → `DELETE /state` (store.ts:859) and drops every namespace, so no
concurrent read can reload the pre-wipe record. That is the ordering the
attestation-pass comment at route.ts:489-492 asks for, and it was followed.

The two misses:

- **`anonAttribution`** — `save()` (anonAttribution.ts:86-93) seals the whole
  `doc.items`, so after `resetSeed` wiped the namespace the next
  `sealSecretForPost` re-uploads **every pre-reset reveal secret**. The module's
  own comment at line 124-125 claims *"the reset wipes this namespace like every
  other fixture-only table"* — true of the validator, false of the cache, and the
  cache wins on the next write. This is the resurrection class exactly.
- **`sessionHandles`** — `loadAll()` reads the validator only when the map is
  empty (sessionHandles.ts:23), and `registerHandle()` re-flushes the whole map
  (lines 48-63). Wiped handle→rootId rows — a session-deanonymization table, by
  the module's own comment — come back on the next session registration.

Both are pre-existing, not introduced by this diff, but item 4 asked for the
sweep and this is what it turns up. See also **F-2**, which is the same audit run
against `reloadIdentity()` and `simulateDeviceLoss` instead of `resetSeed`, and
which the new code *does* miss.

**Fix.** Export `resetAnonAttributionCache()` and `resetSessionHandles()`, and
fold all of it into the single `resetEverySealedCache()` registry proposed in F-2.

---

## F-12 — MEDIUM — the suite cannot catch F-4 or F-5, and says so about F-4 in its own comment

**Test vacuity**, on precisely the two surfaces this review broke.

`scripts/accept-pd2.mjs:274-279`:

```js
// the OTHER roster (the session track) narrows by the same chokepoint; on this rig it
// already holds one persona, so the assertion is that it never GREW and never emptied
const people = (await api("GET", "/api/personas")).json;
const n = (people?.personas ?? []).length;
if (n > switcher0) throw new Error("the account switcher grew under compartment mode: ...");
if (switcher0 > 0 && n === 0) throw new Error("compartment mode emptied the account switcher ...");
```

`switcher0` is 1 on this rig, so both assertions pass for `n === 1` whether or
not compartment mode does anything at all. The check is admitted-vacuous in its
own comment, and the surface it was meant to cover — `visiblePersonas` in
`app/(main)/layout.tsx:106` — is **never asserted at all**: `data-scope` appears
in the layout (line 166) and in no check in `accept-pd2.mjs`.

Neither `accept-pd2.mjs` nor `accept-pd3.mjs` ever exercises an unreadable vault.
`grep -n "503" scripts/accept-pd3.mjs` returns nothing. "Never fail open" — the
loudest claim both modules make, stated three times in comments — is asserted by
zero checks.

**Fix.** Three checks, all cheap with hooks that already exist:
1. Arm `corruptVaultCiphertext` (or `forceFail` on the `personaChrome` read),
   load `/home`, assert `data-scope` is not `"normal"` and that the rendered
   switcher did not widen. That check fails today.
2. Same arming, `GET /api/feed2` → assert 503, not 200 with unquieted posts.
3. Set compartment on, then `forceFail` the flush, and assert that a *restart* or
   a `resetChromeCache()` + reload still reports compartment on — i.e. that the
   503 did not leave a ghost. That check fails today (F-5a).

Add a second persona to the session track so check 7's switcher assertion stops
being vacuous.

---

## F-13 — LOW — `data-scope` is a heuristic where `scope.reason` already exists

`app/(main)/layout.tsx:166`:

```tsx
data-scope={visibleIds && visibleIds.length === 1 && session.personas.length > 1 ? "compartment" : "normal"}
```

`viewScope` already returns `reason: "compartment" | "unified" | "single"`
(chrome.ts:263, 282). Re-deriving it from lengths gives the wrong answer in two
cases: a root with one session persona under compartment mode reports
`"normal"`, and an unreadable record also reports `"normal"` (F-4). A marker that
says "normal" when the server does not know is worse than an absent one.

**Fix.** Emit `scope.reason`, and a fourth value `"unknown"` when the read failed.

---

## F-14 — LOW — the pad target is computed in UTF-16 code units and applied to a UTF-8 payload

`inner.length` counts UTF-16 code units; the wire carries UTF-8. A document
holding non-ASCII (reachable through the unvalidated `modeId` of F-10, or any
future field holding user text) pads to a code-unit boundary and lands on a byte
length the scheme did not choose. Measured: `{"😀|persona_x":"quiet"}` is 24 code
units and 26 bytes. Two documents the scheme considers the same "bucket" can
therefore differ in ciphertext length, which is the one property the padding
exists to remove.

**Fix.** `const target = 1024 * Math.ceil((Buffer.byteLength(inner) + 64) / 1024)`
and pad by bytes. Applies to all six copies of the formula, including
`sealWhole` at `lib/vault/vault.ts:203`.

---

## F-15 — NIT ×2

- **`Math.max(0, target - inner.length - 48)` can never clamp.** Since
  `target ≥ inner.length + 64` by construction, `target - inner.length - 48 ≥ 16`
  for every input; the minimum over lengths 0…20 000 is exactly 16. The `max` is
  dead code. Harmless, but it reads as a guard against a case that cannot occur,
  which hides that the real invariant (pad ∈ [16, 1039]) is never asserted.
- **`flushVault()` does not call `markSealed()`** (`persist.ts:393-411` vs
  `flush()` at 373). Combined with `hydrate()` only iterating `SERIALIZERS`
  (store.ts:712), the Gate 5 plaintext-rollback defence covers none of the
  `flushVault`-only namespaces. Currently consistent with its consumer, so it is
  not a live hole on its own — but it is the missing half of F-1's fix.

---

## D-1 — design disagreement — `unified` narrows one surface, `compartment` narrows four, and §17 does not distinguish them

`viewScope` (chrome.ts:272-284) computes `visiblePersonaIds` from `compartment`
only:

```ts
visiblePersonaIds: compartment ? [activePersonaId] : ownIds,
```

So with the cross-persona view **off** — which §17 calls the deliberate default —
`/api/personas`, `/api/personas/act-as-options` and the rendered switcher still
enumerate every sibling. Only `lib/search/unified.ts:93` respects `unified`
(`personaIds: sc.unified ? own : [active]`), and `/api/influence` gates on
`compartment` alone (`app/api/influence/route.ts:39`).

That is defensible — you must be able to switch personas, so the switcher cannot
narrow on the default toggle — but §17's "What compartment mode does" lists four
surfaces without saying that turning the cross-persona view off narrows exactly
one of them, which is a reasonable thing for a reader to get wrong.

**Ask.** One sentence in §17: "the cross-persona view governs the search index
only; the switcher, the act-as picker and a sibling's stake history narrow under
compartment mode and not under the view toggle, because switching personas has to
remain possible."

---

## Checked and found sound

Things I attacked and could not break:

- **The padding never produces a negative pad**, and the sealed plaintext length
  is a clean function of the bucket (`target - 33`, verified across 0…20 000).
  No pad-underflow, no short-write, no length that reveals `inner.length` more
  finely than the 1 KiB bucket. See F-9 for the residual, which is the bucket
  itself.
- **The reset ordering for the two new caches is right.** `resetChromeCache()`
  and `resetDeliveryCache()` both run after `await resetState()` (which awaits
  `wipeAll()` → `DELETE /state`, all namespaces), so no concurrent read can warm
  the cache from a pre-wipe record. The attestation-pass lesson was applied.
- **`buildFeed`'s delivery block is not wrapped in a `try`** (`lib/feed.ts:392-402`),
  and neither of its two callers swallows the throw into a normal feed:
  `/api/feed2` answers 503 (`app/api/feed2/route.ts:24-27`) and
  `app/(main)/home/page.tsx:104-111` catches into `loadError` with no feed
  rendered. The quiet tier cannot silently become "off" through the feed path.
- **`/api/personas` and `/api/personas/act-as-options` let the throw escape** to a
  500 rather than catching it into a full roster. Fail-closed, correctly.
- **`setUnified` throws before mutating** when compartment is on (chrome.ts:288-290),
  and the route maps it to a 409 with a code rather than swallowing it
  (`app/api/persona/chrome/route.ts:78-86`). Leaving compartment mode does not
  restore `unified` (chrome.ts:296-300) — checked, and asserted by pd2 check 7.
- **`separation()` returns the minimum across models, not the maximum.** Starting
  from `Infinity` with `if (d < worst.distance)` is the conservative direction;
  the naming ("worst") matches the semantics. Sound — the bug is in the matrix
  (F-3), not in the reduction.
- **The palette's own minimum is 15.05**, matching the header's "~15" claim, under
  both the shipped and the corrected matrices. The defaults are genuinely safe.
- **`session.active` can only be null when `session.personas` is empty**
  (`lib/session.ts:42-43`: `... || personas[0] || null`), so the
  `session.active?.id ?? actingId` fallback in `app/(main)/layout.tsx:94` cannot
  empty the switcher by handing `viewScope` a seeded id that is absent from the
  session roster. The failure mode the comment at lines 90-93 describes is
  genuinely closed.
- **`listNonNormal()` is complete by construction** — `setTier` deletes the key on
  `tier === DEFAULT_TIER` (tiers.ts:169), so "normal" is never a stored value and
  the list needs no filtering. Correct, and pd3 check at line 234 asserts it.
- **`pin` and `banner` are genuinely device-only.** `lib/algo/artifact.ts:181-190`
  keeps the allowlist at three and refuses the two new actions *by name* with a
  reason, rather than falling through to "unknown action". The `delivery.tier`
  field reads `null` in contexts without a mode (`lib/rules/evaluate.ts:56-57`),
  so a delivery rule in an activation preview matches nothing rather than
  matching everything.
- **`npx tsc --noEmit` is clean** on the working tree, including the uncommitted
  Gate 4 readwise files.

---

## Suggested order of work

1. **F-1** — the load-side check. Three lines per module, closes an operator-side
   silent disable plus permanent record destruction.
2. **F-2** — the sealed-cache registry, called from all three reset sites. Closes
   the cross-root bleed and stops Gate 5 repeating it.
3. **F-3** — the matrix, in both files, plus the row-sum invariant so the next
   retyping is caught by an assertion instead of by a reviewer.
4. **F-4** and **F-5** — the layout split and the flush ordering; both are small
   and both are protections that currently evaporate quietly.
5. **F-12** — the three checks, so 1/4/5 cannot regress.
6. **F-6**, **F-9**, **D-1** — the document catches up with the code.
7. **F-7**, **F-8**, **F-10**, **F-13**, **F-14**, **F-15**.
