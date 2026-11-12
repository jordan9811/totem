# attack-custody-2 — adversarial review of the BROWSER KEYSTORE PASS (Gates 0–4)

Reviewer 2. Read-only: `docs/custody-model.md`, `notes/reports/REPORT-CUSTODY.md`,
`SECURITY-POSTURE.md` §8/§16, `research/VERIFY-YOURSELF.md`, then
`git diff e177b65..HEAD` and the files under `lib/device/`,
`lib/custody/`, `lib/platform/`, `lib/identity/keystore.ts`,
`lib/adapters/mock/persist.ts`, `validator/{custody,server,db,migrations,env-contract}.js`,
`app/api/custody/`, `app/api/dev/route.ts`, `middleware.ts`,
`instrumentation.ts`, `components/device/DeviceApp.tsx`,
`app/layout.tsx`, `app/device/page.tsx`, `public/device/{boot.js,smoke.html}`,
`scripts/{device-smoke,accept-cu2,accept-cu3,accept-cu4,build-device,audit-preview-g0}.mjs`
and `shots/audit-preview-g0-cu4-ihvbw.json`. No server, no suite, no build was run.

## Verdict

The move is real and most of it is right: the validator is genuinely
multi-tenant, `adapter_state` is genuinely keyed by anchor and genuinely
opaque per namespace, the HPKE link payload genuinely carries no seed, the
keystore genuinely refuses to open on a production server, and the browser
storage backend is a careful piece of work. But the pass's own headline —
"the server never holds a root, a seed, a vault key or a persona private
key" — is defended only against the *server*, and this pass introduced two
new holders that are not the server and are not modelled anywhere: the
`window` object of the page, and the shipped custody provider. `window.__layersDevice`
hands the 32-byte seed, the vault key, the device-auth key, every persona
key leaf, every KEK and the 24 words to any script on the origin
(`lib/device/entry.ts:112-120,139`), and the only provider adapter in the
tree derives its KEK from `sha256("layers-fixture-provider|" + method + "|" + subject)`
where `subject` is a string the visitor types into a text box
(`lib/device/custody/provider.ts:32-33`, `components/device/DeviceApp.tsx:290`) —
so with the provider-path blob sitting on the validator behind an
unauthenticated GET, *any* stranger can unwrap *any* social-saved root's
seed, and the reverse (pre-writing a record under a victim's subject)
drops the victim inside a root the attacker holds. Both are one-click,
both are in the production path, and neither is what `A-CU-2-REAL-PROVIDER-NOT-EXERCISED`
says ("the real provider is not exercised" describes a coverage gap; the
shipped fixture is a live backdoor). Below that: the root-link relay
stores `anchor_a`, `anchor_b` and both roots' persona handles in one
plaintext row and serves it to anyone with the code, which is exactly what
D-CU-0-14 and §16 promise the validator never learns; the grant's
co-signature does not cover the persona lists, so the relay can inject
personas into both sides' "linked accounts"; the wrap-path release accepts
a caller-supplied public key whenever the validator lookup fails, behind a
comment describing a refusal that is not in the code; both rate limiters
key on a raw client-supplied `X-Forwarded-For`; and the whole "production
posture" rests on `LAYERS_REQUIRE_SIG`, which `.env.production.example`
files under `# ---- optional` and which no boot check reads. Gate 4's exit
("burst tests hit the rate limits on both processes; the boot check refuses
a poisoned environment") is true of what the suites measure and false of
what the claims say. The pass should not be called closed.

---

## Findings

### 1. CRITICAL — the only custody provider in the tree derives its KEK from a public string, and the blob is a public GET: any stranger unwraps any social-saved seed

`lib/device/custody/provider.ts:28-35`

```ts
export const fixtureProvider: CustodyProviderAdapter = {
  name: "fixture",
  async login(method, hint) {
    const subject = (hint && hint.trim()) || "fixture-user";
    return { subject, exported: sha256Bytes(te.encode("layers-fixture-provider|" + method + "|" + subject)) };
  },
};
export function providerAdapter(): CustodyProviderAdapter {
  const which = (process.env.CUSTODY_PROVIDER || "fixture").toLowerCase();
  if (which === "fixture") return fixtureProvider;
```

`saveProvider` puts the wrapped seed on the validator
(`lib/device/custody/index.ts:177 — await putBlob(methodId, blob);`), and the
validator serves blobs to anybody:

```js
// validator/custody.js:41-44
// the blob: public ciphertext, keyed by a public identifier
app.get("/custody/blob/:id", (req, res) => {
  const row = db.prepare("SELECT blob, updated_at FROM custody_blobs WHERE method_id = ?").get(req.params.id);
```

**What an attacker does.** Nothing privileged. `GET
$VALIDATOR/custody/blob/pv:fixture:farcaster:<subject>`, then offline:
`kek = HKDF-SHA256(sha256("layers-fixture-provider|farcaster|" + subject), "", "layers/v1/kek-from-provider", 32)`
(`wrap.ts:57-60`), then `aesGcmOpen(kek, nonce, ct, "layers/custody/v1|" + methodId)`
(`wrap.ts:41-48`). Or, without leaving the UI: open `/device`, type the
subject into the `"account (fixture)"` box
(`components/device/DeviceApp.tsx:290`), click **Unlock with social
login** — `unlockProvider` finds the record, derives the same KEK, fetches
the blob and calls `installSeed` (`index.ts:184-198`).

**What they get.** The victim's 32-byte seed, therefore the root, the
device-auth key, the vault key, every persona signing key, the Farcaster
signer and custody keys, the zk identity and every nullifier secret, plus
`exportPhrase()` for the 24 words. Total, silent, offline account takeover
of every identity saved through the social path.

**The mirror image is worse.** The attacker pre-writes a record under a
subject the victim will use (`putMethod` needs only *an* envelope; see
finding 10) with a blob wrapping the **attacker's** seed. When the victim
logs in with their own email/handle, `unlockProvider` finds the record,
derives the public KEK, unwraps the attacker's seed and calls
`installSeed` — the victim now operates inside a root the attacker holds
the seed for, and every private post, DM and vault write they make lands in
a vault the attacker can decrypt. That is "one root for two people",
achieved without touching the victim's device.

**Default-subject collision.** `hint` is optional, so the *first* visitor
who clicks "Save with Farcaster" with the box empty takes
`pv:fixture:farcaster:fixture-user` (`provider.ts:32`). Every later
visitor's save of that method is refused 409 (`validator/custody.js:73`),
and anyone at all can unlock that first visitor's root by leaving the box
empty.

`scripts/accept-cu2.mjs` does not merely miss this — check 6 asserts it as
a pass: *"const G = await device("G"); … const u = await G.must("unlockProvider", "google", "carol-" + stamp); if (u.empty || u.info.rootId !== R1) throw"* (lines 227-232). A brand-new browser context that knows only the subject string is *required* to land on the root.

**Smallest fix.** One line, in `providerAdapter()`: refuse the fixture
outside the rig —
`if (which === "fixture" && process.env.ZK_DEV_HOOKS !== "true") throw new Error("no custody provider is configured in this build");`
— and have `status()` return `providerMethods: []` so the picker hides the
social card instead of offering a backdoor as an equal (D-CU-0-10).

---

### 2. CRITICAL — `window.__layersDevice` publishes the seed, the vault key, the device-auth key, every persona leaf, every KEK and the 24 words to any script on the origin

`lib/device/entry.ts:112-120` and `:139`

```ts
  api.needles = async () => {
    const ks = await import("@/lib/identity/keystore");
    const dk = await import("@/lib/identity/deviceKeys");
    return [...ks.rootMaterialForLeakTest(), ...ks.keyMaterialForLeakTest(), ...dk.deviceKeyMaterialForLeakTest()].filter(…);
  };
  api.rootOnly = async () => {
    const ks = await import("@/lib/identity/keystore");
    return ks.rootOnlyMaterialForLeakTest();
  };
…
(globalThis as unknown as { __layersDevice: DeviceApi }).__layersDevice = api;
```

`rootMaterialForLeakTest()` is `[f.rootSecretHex, rootHandle()]`
(`keystore.ts:181-185`); `keyMaterialForLeakTest()` is the seed, the vault
key, the device-auth private seed, the zk master and every persona
`sign`/`fcSigner`/`fcCustody` leaf (`keystore.ts:441-460`);
`rootOnlyMaterialForLeakTest()` is the seed and the device-auth key
(`keystore.ts:436-440`). Beside them on the same object:
`custody.secrets()` (every KEK, PRF output and provider export the device
used — `index.ts:45-52`), `custody.exportPhrase()`,
`custody.importPhrase(words)`, `linking.lastPayload()` and
`linking.approve(code)`. There is no `ZK_DEV_HOOKS` gate, no build-time
strip (`scripts/build-device.mjs` has one entry point and no `define` that
removes them), and `minify: false`.

**What an attacker does.** Any script that reaches the origin — a stored
XSS, a compromised dependency in the page bundle, a third-party tag, a
browser extension content script, or a "paste this in the console" support
scam — runs:

```js
await window.__layersDevice.needles()          // the seed, in hex, first element
await window.__layersDevice.custody.exportPhrase()   // the 24 words
await window.__layersDevice.linking.approve("ATTACKERCODE")  // seals the vault key + every persona leaf to the attacker's HPKE key
await window.__layersDevice.custody.importPhrase(attackerWords) // silently replaces the visitor's identity
```

`linking.approve` needs no user gesture (unlike a passkey, which requires
user verification), so exfiltration is a single call.

**What they get.** Everything. The pass's whole thesis — that moving the
seed off the server makes it the visitor's — is undone by publishing it on
the visitor's own `window`. Note the direct contradiction with
D-CU-3-STORAGE-IS-EPHEMERAL-UNTIL-THE-VISITOR-SAYS-OTHERWISE, which says of
the IndexedDB wrapping key "The key cannot be exported by any code,
including this code" (`lib/platform/storage.browser.ts:160` does generate it
with `extractable = false`) — and then `needles()` hands out the plaintext
that key exists to protect.

**Smallest fix.** Gate the four grep affordances on the rig flag the device
already reads: in `entry.ts`, only attach `needles`, `rootOnly`,
`custody.secrets` and `linking.lastPayload` when
`process.env.ZK_DEV_HOOKS === "true"` (the smoke page already sets its own
env, `public/device/smoke.html:12-27`, so the suites can turn them on).
Separately, `exportPhrase` / `importPhrase` / `linking.approve` should
require a fresh user gesture the page cannot synthesise.

---

### 3. HIGH — the root-link relay stores both anchors and both roots' persona handles in one plaintext row, and serves it unauthenticated

`validator/custody.js:210-233`, `validator/migrations.js` (migration 19),
`lib/device/rootlink.ts:110,125`

```js
app.post("/rootlink/offer", (req, res) => {
  const { proposal } = req.body || {};
  … db.prepare("INSERT INTO root_link_offers (code, anchor_a, proposal, anchor_b, answer, sig_a, …)").run(code, anchor, JSON.stringify(proposal), …);
});
app.get("/rootlink/:code", (req, res) => {          // ← no signed() call
  const row = db.prepare("SELECT * FROM root_link_offers WHERE code = ?").get(String(req.params.code).toUpperCase());
  res.json({ code: row.code, proposal: JSON.parse(row.proposal), answer: row.answer ? JSON.parse(row.answer) : null, sigA: row.sig_a, expiresAt: row.expires_at });
});
```

and the proposal/answer the device posts:

```ts
// lib/device/rootlink.ts:110
const proposal = { a: m.anchor, rootA: m.rootId, issuedAt: Date.now(), personasA: m.personas };
// :125
await relaySigned(`/rootlink/${…}/answer`, "PUT", { answer: { b: m.anchor, rootB: m.rootId, personasB: m.personas, sigB } });
```

where `m.personas` is `{ id, handle, name, avatarUrl }` per persona
(`rootlink.ts:60`).

**What an attacker does.** (a) The validator's operator runs
`SELECT anchor_a, anchor_b, proposal, answer FROM root_link_offers` — one
row, the pair, plus every persona id and handle on both sides, in the
clear. (b) A stranger who has the code (shoulder-surfed, screenshared,
pasted into a support chat, or read from the DB) does `GET /rootlink/<code>`
and gets the same.

**What they get.** The exact fact the design says the validator never
learns, plus the persona→anchor join that D-CU-1-EVERY-NAMESPACE-IS-SEALED
exists to prevent. Compare, verbatim:

- `docs/custody-model.md` D-CU-0-14: "stored in each root's vault (ciphertext; the validator never sees which two roots are one person)".
- `notes/reports/REPORT-CUSTODY.md` D-CU-3-A-ROOT-LINK-IS-A-CO-SIGNED-GRANT: "The validator relays ciphertext and two anchors that were already public and never learns that the pair is one person."
- `SECURITY-POSTURE.md` §16: "The validator relays two public anchors and learns nothing it did not already hold."
- and the reason it matters, in the pass's own words (D-CU-1-EVERY-NAMESPACE-IS-SEALED): "a plaintext namespace naming a persona would join that persona to the anchor that signs its zk registration — persona → root in two hops."

Here it is one hop, in a table the pass added, for both roots at once.
Migration 19's comment ("Two public anchors; no grant body outlives the
exchange here") is true only of the *completed* grant.

**Smallest fix.** The relay only needs to carry opaque bytes: have the
proposing device seal `{rootA, personasA}` to a key derived from the code
(the link relay already does exactly this with HPKE) and post only
`{a, issuedAt, sealed}`; `GET /rootlink/:code` then returns ciphertext.
Failing that, at minimum gate `GET /rootlink/:code` behind the envelope and
drop `personasA`/`personasB` from the relay body, exchanging them inside
the sealed channel.

---

### 4. HIGH — the root-link grant's co-signature does not cover the persona lists, so the relay can inject personas into both sides' "linked accounts"

`lib/device/rootlink.ts:46-51` vs `:135` and `:161`

```ts
export function grantCanonical(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt">): string {
  return `layers/rootlink/v1|${g.a}|${g.b}|${g.rootA}|${g.rootB}|${g.issuedAt}`;
}
…
const grant: RootLinkGrant = { v: 1, ...partial, personasA: row.proposal.personasA, personasB: m.personas, sigA: done.sigA, sigB };
if (!verifyCanonical(grant.sigA, grantCanonical(grant), grant.a)) throw new Error("the other root's signature does not verify");
```

`personasA` comes from the relay row, and the canonical string signed by
both device-auth keys contains only the two anchors, the two root ids and a
timestamp. Both signatures verify over a grant whose persona lists have
been rewritten.

**What an attacker does.** The validator's operator (or anyone who can
modify the response — `NEXT_PUBLIC_VALIDATOR_URL` is a plain env value and
`.env.production.example` shows `http://` origins) edits
`proposal.personasA` / `answer.personasB` in the row before each side reads
it. `personasOk` accepts up to 64 entries with any `id` and `handle`
strings (`validator/custody.js:209`).

**What they get.** Both clients store the doctored grant in their own
vaults (`writeGrants`, `rootlink.ts:78-83`) and render it as truth:
`components/device/DeviceApp.tsx:346` prints
`{r.personas.map((p) => "@" + p.handle).join(", ")}` under "Linked
accounts". So the operator can make any handle — `@vitalik`, a moderator, a
brand — appear as an account the visitor has linked, persistently, in the
switcher and settings, with the reassuring sentence "linked, not merged"
beside it. `scripts/accept-cu3.mjs` check 7 verifies the personas arrive,
never that they are the ones that were signed.

**Smallest fix.** Put them in the canonical:
`layers/rootlink/v1|a|b|rootA|rootB|issuedAt|sha256(JSON.stringify(personasA))|sha256(JSON.stringify(personasB))`
and have `answer()`/`complete()` verify against the lists they store.

---

### 5. HIGH — the wrap-path release accepts a caller-supplied public key whenever the validator lookup fails, under a comment describing a check that does not exist

`app/api/custody/passkey/release/route.ts:31-45`

```ts
  let key: { spkiHex: string; alg: number } | null = null;
  try {
    const r = await fetch(`${validatorUrl()}/custody/method/${encodeURIComponent("pk:" + credentialId)}`, { cache: "no-store" });
    if (r.ok) { … if (m?.pubkey_spki && typeof m.alg === "number") key = { spkiHex: m.pubkey_spki, alg: m.alg }; }
  } catch {
    /* the validator is unreachable: fall through to first-use only if nothing is recorded — refused below otherwise */
  }
  if (!key) {
    if (typeof spkiHex !== "string" || !/^[0-9a-f]{40,400}$/.test(spkiHex) || (alg !== -8 && alg !== -7))
      return NextResponse.json({ error: "no recorded key for this credential and none supplied" }, { status: 404 });
    key = { spkiHex, alg };
  }
```

There is no "refused below otherwise". When the `fetch` throws, or when the
validator answers anything other than 2xx (500, 503, or its own 429 — see
finding 7), `key` stays null and the **attacker's** SPKI is used to verify
the **attacker's** assertion.

**What an attacker does.** `POST /api/custody/passkey/challenge` (open, no
auth — `challenge/route.ts:10-14`), mint an Ed25519 keypair, build
`authenticatorData = sha256(rpId) ‖ 0x01 ‖ 00000000` and
`clientDataJSON = {"type":"webauthn.get","challenge":<the challenge>,"origin":"http://localhost:3001"}`,
sign `authData ‖ sha256(clientDataJSON)`, and POST to `/release` with the
victim's `credentialId` plus their own `spkiHex`/`alg` — while the
validator is restarting, throttled, or unreachable. Both remaining checks
are theirs to satisfy: `allowedOrigins()` unconditionally includes
`http://localhost:${port}` and `http://127.0.0.1:${port}` even in
production (`lib/custody/release.ts:30-32`), and the RP id the hash is
compared against is derived from the request's own `Origin` header
(`route.ts:48 — rpId: rpIdFor(req.headers.get("origin"))`).

**What they get.** `releaseKeyFor(secret, credentialId)` — the server-held
half of `A-CU-WRAP-PATH-SPLIT` for an arbitrary credential, which the
posture says is "released only after it verifies a WebAuthn assertion for
that credential" and "Trusts the server not to release without an
assertion" (§16). It does not open a seed on its own (the wrap-path blob is
IndexedDB-only), but it converts the assumption's two-party split into a
one-party secret plus a browser-storage read, and it is derivable forever
(the key is a pure HMAC, so a single successful release is permanent).

**Smallest fix.** Make the lookup failure fatal and the first-use path
explicit: on a throw or a non-404 status, return 503; accept the supplied
`spkiHex` only when the validator answered a clean **404**.

---

### 6. HIGH — `LAYERS_REQUIRE_SIG` is the whole production posture of the validator, is documented as optional, and is checked by nothing

`.env.production.example:32-40`

```
# ---- optional
…
# the validator: signed envelopes required; origins allowed to reach it are the app's
LAYERS_REQUIRE_SIG=true
```

`validator/server.js:24,31`

```js
const REQUIRE_SIG = process.env.LAYERS_REQUIRE_SIG === "true";
const STRICT = REQUIRE_SIG && !DEV_HOOKS;
```

Every gate D-CU-1-UNSIGNED-IS-A-RIG-ONLY-AFFORDANCE claims is spelled
`if (REQUIRE_SIG && req.header(...)) { … } else if (STRICT) return 401;`
(`server.js:460-464`, `:473-477`, `:391-395`, and `/roots` and `/events` at
`:165-174` and `:235-257`). With `LAYERS_REQUIRE_SIG` unset, `STRICT` is false,
neither branch fires, and every one of them falls through to
`anchorOf(req, db)` — which is `singleAnchor(db)`, "the oldest registered
one" (`validator/db.js:53-58`). `DELETE /state` is worse still: its guard is
`if (REQUIRE_SIG)` alone (`server.js:524-525`).

**What an attacker does.** Against a deployment that set `NODE_ENV=production`
and treated the "optional" block as optional: `GET /state` (the whole
ciphertext namespace set of the first visitor who ever registered),
`GET /device/list`, `PUT /state/<ns>` (overwrite it), `POST /events` (rep
inflation, readiness finding 3), `POST /roots`, and `DELETE /state` (wipe
it) — all unauthenticated. The boot check prints
`[validator] production environment contract: clean` while this is true,
because the contract is a list of variables that must be *absent*
(`validator/env-contract.js:22-29`) and contains no variable that must be
*present*.

**What they get.** Findings 1, 2 and 3 of `notes/runbooks/PREVIEW-READINESS.md` reopened
by one missing environment variable, with a green boot line.

**Smallest fix.** Add the positive half of the contract: in
`enforceBootContract`, when `isPublicDeployment()`, also refuse if
`LAYERS_REQUIRE_SIG !== "true"` (and, in the app's `instrumentation.ts`, if
`CUSTODY_RELEASE_SECRET` is unset while the wrap path is advertised). Move
`LAYERS_REQUIRE_SIG=true` out of `# ---- optional` into `# ---- required`.

---

### 7. HIGH — both rate limiters key on a raw client-supplied `X-Forwarded-For`, so the Gate 4 limit is a header away from nothing (and an unbounded map)

`middleware.ts:34` and `validator/server.js:110`

```ts
const ip = req.ip || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
```

```js
const key = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket.remoteAddress || "local";
```

`next@^14.2.5` (`package.json:142`) populates `NextRequest.ip` only on
Vercel — nothing in `node_modules/next/dist/server/base-server.js` sets it —
so on a self-hosted `next start` the app's key *is* the client's header.
The validator is unambiguous: it reads the header **before** `req.ip` and
`req.socket.remoteAddress`, with Express's `trust proxy` off, so the header
wins even on a direct connection.

**What an attacker does.** Send `X-Forwarded-For: <counter++>` with every
request. Each distinct value is a fresh bucket seeded at full capacity
(`middleware.ts:19`, `server.js:111`) — 200 free app requests and 300 free
validator requests per header value, unlimited values.

**What they get.** (a) No effective rate limit anywhere, including on the
unauthenticated surfaces this pass added: `GET /custody/blob/:id`,
`GET /custody/method/:id`, `GET /link/:code`, `GET /rootlink/:code`,
`POST /link/offer`, `POST /device/auth-anchor`, `POST /device/register`.
(b) Memory exhaustion: `buckets`/`rlBuckets` grow one entry per distinct
value and are swept only for entries older than 120 s, at most once per
60 s — millions of entries fit in a sweep window.

`scripts/accept-cu4.mjs:93-113` sends its bursts with plain `fetch` and no
`X-Forwarded-For`, so no regression of this property can fail the suite;
the check measures the one case the attacker will not use.

**Smallest fix.** Key on the socket address (`req.socket.remoteAddress`
server-side) and honour a forwarded header only from a configured trusted
proxy count — e.g. read `X-Forwarded-For`'s *rightmost* entry and only when
`TRUST_PROXY=1` is set. Also cap the map (evict oldest past N entries).

---

### 8. HIGH — one signed `DELETE /state` from any anchor deletes every other visitor's fixture anon casts and every stake row

`validator/server.js:524-538`

```js
  app.delete("/state", (req, res) => {
    if (REQUIRE_SIG) { … const bad = checkEnvelope(req, "*", bodyHash); if (bad) return …; }
    db.prepare("DELETE FROM adapter_state WHERE anchor = ?").run(anchorOf(req, db));
    …
      db.prepare("DELETE FROM zk_anon_casts WHERE mode = 'fixture'").run();
      // MEGA PASS 2 Gate 1: fixture stake rows are seed state too (the app re-seeds them after the wipe)
      db.prepare("DELETE FROM stakes WHERE mode = 'fixture'").run();
```

The `adapter_state` delete was correctly scoped to the caller's anchor by
migration 16. The two lines below it were not.

**What an attacker does.** Boots a browser device (any visitor gets an
anchor, a device and an envelope for free — that is D-CU-0-6), then issues
one envelope-signed `DELETE /state` against the validator directly.

**What they get.** Every anon cast in the deployment (the env example ships
`ZK_MODE=fixture`, so every anon cast is `mode = 'fixture'`) and every stake
row — the influence and reputation substrate of Mega pass 2 — deleted, for
everyone. A cross-tenant destructive write in the one route the code itself
calls "the most destructive call on the surface".

**Smallest fix.** Scope them, or refuse them outside the rig:
`if (DEV_HOOKS) { …the two deletes… }` — the comment already says they exist
because "the app re-seeds them after the wipe", which is a rig behaviour.

---

### 9. MEDIUM — a device can be re-anchored to a stranger's root without the device's consent

`validator/server.js:326,357-361`

```js
  app.post("/device/register", (req, res) => {        // ← no envelope, ever, STRICT or not
…
    // What is refused is a HIJACK: a different key claiming a known id under a different anchor.
    if (prior && prior.anchor && prior.anchor !== anchor.pubkey && prior.pubkey !== delegation.devicePubKey)
      return res.status(403).json({ error: "device id is registered to another key under another device-auth anchor" });
```

The rule treats "the delegation names the same device public key" as
evidence that the device agreed to move. A device public key is public
material, not a secret — `GET /link/:code` publishes `deviceId` and
`devicePubKey` to anyone with a link code, unauthenticated
(`validator/custody.js:147-160`), and the validator's operator has both
outright. Nothing in the request is signed by the device.

**What an attacker does.** Registers their own anchor (open by design,
`server.js:302`), then POSTs `{ anchorPubKey: <theirs>, delegation: { deviceId: <victim's>, devicePubKey: <victim's>, …, signature: <signed by their own device-auth key> } }`.
The `ON CONFLICT(device_id) DO UPDATE SET … anchor = excluded.anchor`
(`server.js:363-366`) moves the row.

**What they get.** `checkEnvelope` then stamps
`req.layersAnchor = <attacker's anchor>` for every request the victim's
device makes (`server.js:449`), so the victim reads an empty tenant and
writes into the attacker's namespace set — a remote lockout and state
diversion, with the victim's own rows stranded under their old anchor.

**Smallest fix.** Require the *device's* signature on a re-anchoring: when
`prior` exists and `prior.anchor !== anchor.pubkey`, demand a valid envelope
signed by `prior.pubkey` (namespace `devices`) in addition to the
delegation.

---

### 10. MEDIUM — writing a method record needs no proof of possession, so any method id can be squatted permanently

`validator/custody.js:63-79`

```js
  // write a record: first anchor wins the id; the same anchor may update its own key material
  app.put("/custody/method/:id", (req, res) => {
…
    const existing = db.prepare("SELECT anchor FROM custody_methods WHERE method_id = ?").get(id);
    if (existing && existing.anchor !== anchor) return res.status(409).json({ error: "that method id belongs to another root" });
```

The envelope proves only that *some* device wrote it. Nothing proves the
writer holds the passkey whose credential id it names or the provider
account whose subject it names — the app server does verify a WebAuthn
assertion, but it does so at `/release`, and its result never reaches the
validator.

**What an attacker does.** Boots a device, then `PUT /custody/method/pv:fixture:email:victim@example.com`
and `PUT /custody/method/pk:<a credential id they have seen>` under their
own anchor. `DELETE` requires the owning anchor
(`validator/custody.js:104-114`), so the victim can never reclaim it.

**What they get.** A permanent, unrecoverable denial of that save method
for the real owner (their save fails 409 forever, and D-CU-0-10's picker
offers no alternative id) — and, with the fixture provider, finding 1's
pre-emption attack. Combined with finding 14 (the envelope does not sign
the path), an on-path attacker can also retarget a legitimate record write
to a different method id.

**Smallest fix.** Bind the record to possession: have `/api/custody/passkey/release`
return a short-lived, server-signed token naming the credential id it just
verified an assertion for, and have `PUT /custody/method/pk:*` require it.
For `pv:*`, require the provider's own signed token once a real provider
exists — and until then, finding 1's fix removes the surface.

---

### 11. MEDIUM — `providerMethodId` is a lossy sanitizer over a truncated string, so distinct provider subjects collide on one method id

`lib/device/custody/provider.ts:44-47`

```ts
export function providerMethodId(provider: string, method: ProviderMethod, subject: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return `pv:${safe(provider)}:${safe(method)}:${safe(subject)}`;
}
```

Every character outside `[A-Za-z0-9._-]` maps to `_`, and anything past 80
characters is dropped. Email local parts legitimately use `+`, `!`, `%`,
`&`, `'`, `/`, `=`, `?`, `^`, `{`, `}`, `~`, and Google/Farcaster subjects
are opaque strings of unbounded length. So `a!b@c.com`, `a+b@c.com` and
`a%b@c.com` are one id; any two subjects sharing an 80-character prefix are
one id.

**What an attacker does.** Registers a subject that sanitizes to the
victim's id. With a real provider the KEKs differ, so the victim's unlock
fails the GCM tag — a confusing permanent lockout rather than a takeover.
With the shipped fixture it is finding 1.

**What they get.** First-write-wins on an id that does not identify one
account. `notes/reports/REPORT-CUSTODY.md` D-CU-2-METHOD-IDS-ARE-PUBLIC-IDENTIFIERS says
"a method id belongs to the first anchor that wrote it" as a safety
property; it is only safe if the map from account to id is injective.

**Smallest fix.** Hash instead of sanitize:
`` return `pv:${safe(provider)}:${safe(method)}:${createHash("sha256").update(subject).digest("hex")}`; ``
Lookup still works (the unlocking device knows the subject), collisions go
away, and it also stops the validator from storing email addresses in the
clear (finding 12).

---

### 12. MEDIUM — the method record joins a real-world identifier to the anchor that keys everything else, on a public endpoint

`validator/custody.js:34-39`

```js
  // the record: public. Answers "which root, which path" and hands the app server the key to verify against.
  app.get("/custody/method/:id", (req, res) => {
    const row = db.prepare("SELECT method_id, kind, anchor, pubkey_spki, alg, created_at FROM custody_methods WHERE method_id = ?").get(req.params.id);
```

With `providerMethodId` as written, `custody_methods.method_id` holds
`pv:fixture:email:alice_example.com` and the row holds `anchor` beside it.
The anchor is the primary key of every `adapter_state` row for that root
and the key that signs its zk registration.

**What an attacker does.** Guesses an email or a Farcaster handle and
`GET /custody/method/pv:fixture:email:<it>`; or, as the operator, reads the
table.

**What they get.** A stable join from a human identity to the anchor whose
ciphertext rows, device list, root row and zk commitment are all keyed by
it — the deanonymisation channel the namespace-sealing work was built to
close, arriving through a different table. §16 discloses that the validator
holds "a public identifier — a credential id or a provider subject — bound
to an anchor", but neither §16 nor any `A-CU-*` records that this is a
persona/identity→root linkage or that it is world-readable.

**Smallest fix.** Finding 11's hashed id, plus gate the `anchor` field:
return it only under the envelope (the app server's release path needs only
`pubkey_spki` and `alg`; the device knows its own anchor).

---

### 13. MEDIUM — the empty-account fork's only signal is an unauthenticated 404 from the validator, and the local mirror is never consulted

`lib/device/custody/index.ts:140-141` and `:188-189`

```ts
  const rec = await getMethod(methodId);
  if (!rec) return { empty: true, methodId, kind: "passkey" };
```

`getMethod` is an unauthenticated `GET /custody/method/:id` with no
signature over the answer (`methods.ts:24-29`), and the device holds a local
blob for every method it ever saved (`mirrorBlob`, `methods.ts:70-73`) which
this path does not look at.

**What an attacker does.** The validator's operator (or anyone able to
answer for it) returns 404 for a victim's method id. The victim sees
"New here, or already have an account?" and clicks "Start fresh here"
(`DeviceApp.tsx:296-305`).

**What they get.** Exactly the outcome D-CU-0-12 was written to prevent —
"a heuristic that guesses wrong silently creates the second root this pass
then has to link" — produced not by a heuristic but by trusting an
untrusted server's absence signal. The rule "the empty account is the only
signal — no IP, user-agent or timing heuristics, ever" is honoured; the
signal itself is unauthenticated. `scripts/accept-cu3.mjs` check 1 asserts
the fork renders on an empty login for two user agents; nothing asserts it
does *not* render when this browser has local evidence of a save.

**Smallest fix.** One condition:
`if (!rec && !localBlob(methodId)) return { empty: true, … };` and throw a
loud "this identity exists on this device but the directory does not
acknowledge it" when the local blob is present.

---

### 14. MEDIUM — the device envelope signs neither the HTTP method nor the path, so every `custody`-namespace operation is interchangeable

`lib/identity/deviceKeys.ts:104-106`

```ts
export function envelopeCanonical(namespace: string, bodyHashHex: string, counter: number): string {
  return ["layers-envelope/1", namespace, bodyHashHex, String(counter)].join("|");
}
```

All of Gate 2's and Gate 3's routes sign namespace `"custody"`
(`methods.ts:35,52,59,65`; `linking.ts:102,139`; `rootlink.ts:100`). The
empty-body group — `GET /custody/methods`, `DELETE /custody/method/:id`,
`DELETE /link/:code`, `DELETE /rootlink/:code` — all sign the identical
string `layers-envelope/1|custody|<sha256("")>|<counter>`. The
body-hash group signs the body but not the path, so
`PUT /custody/method/:id` is valid for any `:id` with that body.

**What an attacker does.** An on-path position (a TLS-terminating proxy, or
any `http://` validator URL — `.env.production.example` and
`lib/ports.ts` both default to `http://`) intercepts the device's routine
`GET /custody/methods` (the page issues it on every `refresh()`,
`DeviceApp.tsx:87`) and replays its headers as
`DELETE /custody/method/<the victim's id>` or `DELETE /rootlink/<code>`.
Counter monotonicity (`server.js:443-447`) stops replay of an envelope the
validator already accepted, not substitution of one it has not.

**What they get.** Deletion of a save method (and its blob — the only copy
for a wrap-path account), or of a pending link. The property
"`checkEnvelope` … every state read and write … scoped to it"
(D-CU-1-THE-ENVELOPE-CARRIES-THE-TENANT) holds for the tenant and not for
the operation.

**Smallest fix.** Add the verb and path to the canonical:
`["layers-envelope/2", method, path, namespace, bodyHash, counter].join("|")`,
version-gated so the existing rig envelopes keep verifying.

---

### 15. MEDIUM — the boot check, the keystore refusal and the dev-route closure all hinge on `NODE_ENV === "production"` exactly, and `ZK_DEV_HOOKS=true` silently disables all of them

`lib/platform/env-contract.ts:26-27`, `validator/env-contract.js:19-21`,
`lib/identity/keystore.ts:102-109`, `app/api/dev/route.ts:17,32`

```ts
export function isPublicDeployment(env = process.env): boolean {
  return env.NODE_ENV === "production" && env.ZK_DEV_HOOKS !== "true";
}
```

Three consequences. (a) The validator is a plain `node validator/server.js`
— nothing sets `NODE_ENV` for it — so a deployment that arms
`LAYERS_REQUIRE_SIG` but forgets `NODE_ENV=production` gets
`enforceBootContract()` returning immediately: every must-not-ship variable
passes, silently. (b) The comparison is exact where the value comparison is
normalised (`!OFF.has(v.trim().toLowerCase())`, line 35), so
`NODE_ENV=Production` or a trailing space bypasses it. (c)
`ZK_DEV_HOOKS=true` makes `isPublicDeployment()` false, so the boot check
**returns without printing anything** — while simultaneously re-enabling the
server-side keystore (`keystore.ts:105`), opening `/api/dev` whole
(`route.ts:32`), exempting both rate limiters (`middleware.ts:32`,
`server.js:103`) and re-enabling unsigned validator reads (`server.js:31`).
`.env.production.example:17-18` claims otherwise: "`# ---- required to be
OFF (unset or empty). The boot check refuses to start otherwise.`" with
`ZK_DEV_HOOKS=` in the list — `ZK_DEV_HOOKS` is not in `MUST_NOT_SHIP`, and
setting it refuses nothing.

**What an attacker gets.** Nothing directly; this is the misconfiguration
that turns every other finding on. Worth naming because the pass's answer to
"how do we know production is production" is one unvalidated string, and
`scripts/accept-cu4.mjs` always sets `NODE_ENV: "production"` in its `pub`
env (line 133), so no test covers its absence.

**Smallest fix.** Add `ZK_DEV_HOOKS` to `MUST_NOT_SHIP` (its `OFF` set
already treats unset/empty/false as off, so the rig is unaffected — the rig
runs with it *on*, which is exactly what should refuse to be called a public
deployment), and make the boot check fail closed on an unrecognised
`NODE_ENV`: refuse unless it is exactly `production` or `development`/`test`.

---

### 16. MEDIUM — the anonymous channel is mounted before the rate limiter, so "rate limiting on every route" is false for the four most expensive routes

`validator/server.js:88-94` then `:102`

```js
  const { mountAnon } = require("./anon");
  mountAnon(app, db);
  // BROWSER KEYSTORE PASS Gate 4 — rate limiting on every route …
  app.use((req, res, next) => {
```

Express runs middleware in registration order, so `POST /zk/anon/submit`,
`GET /zk/anon/head`, `GET /zk/ohttp-keys` and `POST /zk/anon/ohttp`
(`validator/anon.js:165,181,187,192`) never reach the bucket. Each `submit`
verifies a proof and then deliberately holds the connection:
`await sleepUntil(t0 + responseMs())` (`anon.js:173`).

**What an attacker does.** Opens thousands of concurrent
`POST /zk/anon/submit` requests with junk bodies.

**What they get.** Unmetered CPU plus a connection pool held open by the
constant-time response, i.e. a cheap unauthenticated denial of service
against the validator, including the liveness contract the attestation pass
built. `scripts/accept-cu4.mjs:106` bursts `/zk/members`, which is *after*
the limiter, so the suite cannot see this.

**Smallest fix.** Move the `app.use` bucket above `mountAnon` — it does not
need `express.json()` (it reads `req.headers` and `req.path` only), which is
the reason `mountAnon` sits where it does.

---

### 17. MEDIUM — `linking.accept()` installs a linked root without verifying the delegation against the anchor it names

`lib/device/linking.ts:126-134` and `lib/identity/keystore.ts:239-241`

```ts
  const del = payload.delegation as { devicePubKey?: string; deviceId?: string };
  if (payload.v !== 2 || del?.devicePubKey !== me.pubHex || del?.deviceId !== me.deviceId) throw new Error("link: the material is not for this device");
  …
  ks.installLinkedRoot({ anchorPubHex: payload.anchorPubHex, …, delegation: payload.delegation, … }, payload.personas);
```

```ts
export function installLinkedRoot(linked: LinkedRoot, personas: KeystorePersona[]): void {
  if (!/^[0-9a-f]{64}$/.test(linked.anchorPubHex) || !/^[0-9a-f]{64}$/.test(linked.vaultKeyHex)) throw new Error("installLinkedRoot: malformed material");
```

Shape checks only. Nothing calls `verifyCanonical(delegation.signature,
delegationCanonical(delegation), payload.anchorPubHex)`.

**What an attacker does.** Reads the offer (`GET /link/:code` is
unauthenticated and publishes `deviceId`, `devicePubKey` and `hpkePub` —
`validator/custody.js:147-160`), seals a payload naming *their* anchor,
*their* vault key and *their* persona leaves to the offer's HPKE key, and
posts it under their own envelope before the legitimate old device does
(`PUT /link/:code/sealed` is first-write-wins, `custody.js:172`). The code
is 50 bits so this is not brute-forceable, but it is the whole attack for
any code that is seen: over a shoulder, in a screenshare, in a support
chat, or by the validator's operator reading `link_offers`.

**What they get.** The victim's new device believes it holds an identity;
in fact it holds one whose seed the attacker owns, so every subsequent
private post, DM and vault write is readable by the attacker. Note the
delegation would also fail at the validator (`/device/register` verifies it
against a registered anchor), but the attacker registers their anchor
first, so it succeeds.

**Smallest fix.** In `accept()`, before `installLinkedRoot`:
`if (!verifyCanonical(del.signature, dk.delegationCanonical({…del, signature: undefined})), payload.anchorPubHex) throw …` —
and have the UI show the anchor prefix and persona handles the payload
carries, so a person can compare them with the device they meant to link.

---

### 18. MEDIUM — any envelope-holding device can revoke any root-link grant id; the relay's own comment says "either party"

`validator/custody.js:190-193` and `:273-280`

```js
// … Revocations are by grant id, signed by either party.
…
  app.post("/rootlink/revoke", (req, res) => {
    const { grantId } = req.body || {};
    if (typeof grantId !== "string" || !/^[0-9a-f]{32}$/.test(grantId)) return res.status(400).json({ error: "grantId required" });
    const anchor = signed(req, res, bodyHash(req));
    if (!anchor) return;
    db.prepare("INSERT OR IGNORE INTO root_link_revocations (grant_id, anchor, created_at) VALUES (?, ?, ?)").run(grantId, anchor, Date.now());
```

No check that the caller is a party. `GET /rootlink/revoked/:id` is public
(`:224-227`) and `linked()` **deletes** the grant from the vault when it
answers true (`lib/device/rootlink.ts:183-186`).

**What an attacker does.** Computes the grant id — `sha256("layers/rootlink/v1|a|b|rootA|rootB|issuedAt").slice(0,32)`
(`rootlink.ts:46-51`) — from the relay row they read with the code
(finding 3), and posts it. Or, being a *former* linked partner, replays it
after an unlink to keep the pair unlinkable.

**What they get.** Permanent, silent revocation of someone else's root
link; both sides drop the grant on their next read, and the revocation row
never expires. Also a permanent `(grant_id, anchor)` record on the
validator that outlives the ten-minute relay row.

**Smallest fix.** Require the caller to be a party. The cheapest version
without storing the grant: have the revoker post
`{ grantId, a, b, rootA, rootB, issuedAt }`, recompute the id, and refuse
unless `req.layersAnchor` is `a` or `b`.

---

### 19. MEDIUM — reads that fail silently into falsy defaults (against the standing never-fail-open rule), including one that reports a successful save that did not persist

Three places:

```ts
// lib/device/custody/methods.ts:58-62
export async function listMethods(): Promise<MethodRecord[]> {
  const r = await orig()(`${base()}/custody/methods`, { cache: "no-store", headers: await signedReadHeaders("custody") });
  if (!r.ok) return [];
```

```ts
// lib/device/custody/index.ts:71-81
let wrapProbe: boolean | null = null;
async function wrapPathAvailable(): Promise<boolean> {
  if (wrapProbe !== null) return wrapProbe;
  try { … } catch { wrapProbe = false; }
  return wrapProbe;
}
```

```ts
// lib/platform/storage.browser.ts:111-120
    queue = queue.then(async () => { … }).catch((e) => console.error("[device] storage: mirror failed for " + path, e));
```

**What happens.** A single transient 429/500 makes `status().methods` empty,
so the strip says **"Unsaved — this identity lives in this tab"** for a
saved identity (`DeviceApp.tsx:236`), `saved` goes false, "Approve" and
"Propose a link" are disabled, and `savePasskey`'s `had` flag reports an
attach as a first save (`index.ts:106`). A single failure in
`wrapPathAvailable` is memoised for the life of the tab, permanently
disabling the wrap path. And an IndexedDB write that fails (quota, private
mode, a locked DB) is swallowed to a console line while `savePasskey`
returns success — for a wrap-path account the mirrored blob is *the only
copy* (`index.ts:128-130`), so the UI says "Saved" over an identity that is
now unreachable except by the 24 words.

**Smallest fix.** Retry then throw: `listMethods` should propagate a
non-404 failure (`status()`'s caller already renders errors);
`wrapPathAvailable` should not cache a failure (`if (wrapProbe === true) return true`);
`enablePersistence`/`mirror` should surface the first failure to the caller
so the save reports honestly.

---

### 20. MEDIUM — the 24 words are not a universal escape hatch: recovery needs the validator to still hold the anchor row

`lib/adapters/mock/persist.ts:271-277` and `validator/server.js:313-317`

```ts
  const anchor = await vfetch("/device/auth-anchor", {
    method: "POST", …
    body: JSON.stringify({ pubkey: anchorPubKey, existingOnly: true }),
  });
…
  if (!anchor || !reg) throw new Error("enrollWithSeed: the validator refused this seed's anchor or delegation");
```

```js
    if (req.body && req.body.existingOnly === true)
      return res.status(404).json({ error: "no identity is registered under that device-auth anchor" });
```

`importPhrase → installSeed → recoverIdentity → enrollWithSeed`
(`index.ts:62-69`, `lib/identity/roster.ts:56-62`) refuses before it reads
anything if the phrase's anchor is not already registered.

**What this costs.** D-CU-0-11 calls the 24 words "the universal escape
hatch … 24 words in on any device reproduces the seed", and
`A-CU-BLOB-ON-VALIDATOR` names them as the escape from losing every blob.
They are not an escape from losing the `device_auth` row: a validator
restore-from-backup that predates the root, a database reset (which the rig
does routinely, `validator/seed.js --force`), or importing into a
*different* deployment all leave the phrase unusable. The recorded
assumption understates the dependency: the words need the validator to
remember the anchor.

**Smallest fix.** Let a recovery *create* the anchor —
`existingOnly` is there so a wrong-phrase probe leaves nothing behind
(D-CU-1-PROBING-IS-NOT-REGISTERING), which is satisfied by probing first
and then registering only after the roster decrypts, or by accepting an
empty roster when the phrase's anchor is absent and letting the vault
decrypt be the wrong-phrase signal it already is.

---

### 21. MEDIUM — D-CU-0-3 is not built: the device is installed only by `/device`, and the `--device` audit measures a harness page

`app/layout.tsx:16-23` installs nothing. The only loader of the device is
`components/device/DeviceApp.tsx:96-98`:

```ts
        window.__LAYERS_DEVICE_ENV = env;
        await loadScript("/device/boot.js");
        await loadScript("/device/device.js", "module");
```

and the audit replaces the app's pages with the smoke harness:

```js
// scripts/audit-preview-g0.mjs:21-22
const DEVICE = process.argv.includes("--device");
const DEVICE_PAGE = "/device/smoke.html?validator=" + encodeURIComponent(VBASE);
```

`docs/custody-model.md` D-CU-0-3 says "In production a client component
installed by the root layout (`DeviceHost`) patches `window.fetch` so every
`/api/*` request is answered in-process". There is no such component and no
such install. `notes/reports/REPORT-CUSTODY.md` names only the SSR half as the gap ("the
API surface is the device's, the rendering path is not") — the API surface
is the device's on `/device` and `/device/smoke.html`, and the Next server's
everywhere else.

**What follows.** Two of the Gate 4 table's flipped findings are measured
on a page that is not the product. Concretely, the cookie check is
structurally vacuous in `--device` mode:
`audit-preview-g0.mjs:104-106` plants `layers_seed_persona` in the *browser
cookie jar*, then calls `/api/private/posts` through the page's fetch, where
the handler's cookie source is the in-process device jar
(`lib/device/shims/next-headers.ts:5-19`, `lib/device/jar.ts:4`) and cannot
see a browser cookie at all. The recorded result — `"B, with a guessable
cookie, reads the owner's PRIVATE posts": {"status":200,"count":0}`
(`shots/audit-preview-g0-cu4-ihvbw.json`) — is not evidence that the cookie
is powerless; it is evidence that the audit set it on a channel the device
never reads. The same shot's `"POST /device/auth-anchor with a stranger's
key": {"status":400,"error":"pubkey is not a usable Ed25519 key …"}` is
vacuous for the same reason: the "stranger's key" is not a point on the
curve, so the refusal says nothing about anchor scoping.

**Smallest fix.** Either build `DeviceHost` in `app/layout.tsx` (guarded on
`!ZK_DEV_HOOKS`), or state plainly in `notes/reports/REPORT-CUSTODY.md` and §16 that the
browser device serves `/device` only and that findings 1 and 2 are closed
for that surface. For the audit: in `--device` mode, drive a real app page
and set the cookie through the device jar as well, or drop the check and say
why.

---

### 22. LOW — the device's rig gate and its server fall-through are page-settable globals

`lib/device/shims/process.ts:8-9`

```ts
const declared = ((globalThis as unknown as { __LAYERS_DEVICE_ENV?: Env }).__LAYERS_DEVICE_ENV ?? {}) as Env;
const env: Env = { NODE_ENV: "production", ...declared };
```

`public/device/boot.js:8`

```js
var serverOnly = (window.__LAYERS_DEVICE_SERVER_ONLY || ["/api/health", "/api/dev/live", "/api/custody/passkey/challenge", "/api/custody/passkey/release"]);
```

Any script that runs before the bundle can set
`__LAYERS_DEVICE_ENV = { ZK_DEV_HOOKS: "true" }`, which re-opens the
device's own `/api/dev` route (`app/api/dev/route.ts:32`) and with it
`tamperState`, `corruptVaultCiphertext`, `revokeDevice`,
`simulateDeviceLoss` and `issueTestDelegation` against the visitor's own
identity; or set `__LAYERS_DEVICE_SERVER_ONLY = ["/api/"]` so every
`/api/*` call — including the bodies of private posts — falls through to the
Next server instead of the device. Both are strictly less than finding 2
gives an attacker, which is why this is LOW, but the second is the
"server-only fall-through" path being asked about, and it means plaintext
the device should have kept can be steered to the server's request log with
one global.

**Smallest fix.** Freeze both (`Object.freeze`) and read the env from a
`<script type="application/json">` the server rendered rather than a
mutable global; drop the `||` override on `serverOnly` and let the
generated `SERVER_ONLY_ROUTES` be the only source.

---

### 23. LOW — the wrap path's origin and RP-id checks do not constrain a non-browser caller, and `localhost` is allowed in production

`lib/custody/release.ts:26-45`

```ts
export function allowedOrigins(): string[] {
  const out = new Set<string>();
  const app = process.env.APP_URL;
  if (app) out.add(app.replace(/\/$/, ""));
  const port = process.env.LAYERS_APP_PORT || "3001";
  out.add(`http://localhost:${port}`);
  out.add(`http://127.0.0.1:${port}`);
…
export function rpIdFor(origin: string | null): string {
  try { const h = new URL(origin || "http://localhost").hostname; …
```

The RP id the assertion's `rpIdHash` is compared against comes from the
request's `Origin` header (`release/route.ts:48`) — attacker-controlled for
any scripted client — and the allowed-origin set always contains
`http://localhost:<port>`, which a genuine browser on a production origin
can never produce but a forging client will happily put in its
`clientDataJSON`. Against the caller who matters, the only real check is the
recorded SPKI, which is finding 5.

**Smallest fix.** Derive the RP id from `APP_URL`, not from the request;
add the localhost origins only when `ZK_DEV_HOOKS === "true"`.

---

### 24. LOW/NOTE — a cluster of smaller gaps worth recording

- **`acceptChallenge`'s spend set is per-process memory** (`lib/custody/webauthn.ts:103-113`), so a challenge is spendable once *per instance* and replayable across a restart inside its two-minute TTL; it is also not bound to a credential id or a caller. `A-CU-4-RATE-LIMIT-PER-INSTANCE` records the multi-instance caveat for the bucket; nothing records it for the challenge.
- **The record's `kind` and the id's prefix are never cross-checked.** `validator/custody.js:66-69` accepts `kind: "provider"` under a `pk:` id and vice versa, and `unlockProvider` never reads `rec.kind` at all (`index.ts:188-196`). Both paths currently fail closed at the tag, but the invariant is unasserted.
- **`POST /device/auth-anchor` is unauthenticated and uncapped** (`server.js:302-321`) and `POST /device/register` scans *every* registered anchor with an Ed25519 verify when `anchorPubKey` is omitted (`server.js:333-340`). Together: permanent `device_auth` growth and an O(anchors) CPU amplifier per unauthenticated request. Iteration 5's incident (22 junk anchors) was fixed with `existingOnly` on the recovery path only.
- **`link_offers` caps at 1000 rows** (`validator/custody.js:136`): 1000 unauthenticated `POST /link/offer` calls deny device linking to everyone for ten minutes at a time.
- **The two-column table overstates the device key.** `docs/custody-model.md` says "the device private key (IndexedDB, non-extractable CryptoKey)"; `lib/identity/deviceKeys.ts:66-73` writes `privHex` into a JSON file through the storage seam. It is raw hex, mirrored as ciphertext, and it is in `needles()`.
- **"The key cannot be exported by any code"** (D-CU-3-STORAGE-IS-EPHEMERAL-…) is true of the wrapping key's *bytes* and misleading about its *use*: every same-origin script can call `crypto.subtle.decrypt` with the `CryptoKey` it reads from IndexedDB and recover `root.json` verbatim.
- **`sealWhole`'s pass-through is a standing escape hatch.** `lib/vault/vault.ts:186`: `if (values.length > 0 && values.every((v) => looksLikeCiphertext(v))) return entries;` — any namespace whose values are per-record ciphertext keeps its *addresses* in the clear. That is the trap iteration 3 found in `xImportedPrivate` ("`dm:` address sat in the clear beside its ciphertext"), and the rule that admitted it is still in place for every future namespace. `A-CU-3-PER-RECORD-VAULT-ROWS-REVEAL-COUNTS` covers counts, not addresses.
- **A private post id is 48 bits with no collision check** (`lib/private/store.ts:19-21`, `hashFor()` → `randomBytes(6)`); it is the row address. Within one root that is fine; it is the kind of margin that is cheaper to widen than to reason about.
- **`rootMaterialForLeakTest()[0]` is a seed on a root-holding device and a 24-char root *handle* on a linked one** (`keystore.ts:181-185`), and `recoverIdentity` feeds that value to `enrollWithSeed` as `priorSeed` (`lib/identity/roster.ts:72-73`, `:55-66`). Currently unreachable (`currentSeedHex()` throws first), but it is a type confusion sitting in the undo path that D-CU-1-ENROLLING-IS-A-MOVE-AND-OWES-AN-UNDO depends on.
- **Device route errors return `e.message` to the page** (`lib/device/host.ts:61-65`) and log it to the console. Nothing checked currently puts key material in a message; nothing prevents it either, and a page-level error reporter would ship whatever does.

---

## What I checked that holds (do not re-derive)

1. **The HPKE link payload really carries no seed and no device-auth key.** `lib/identity/keystore.ts:218-237` (`linkMaterial`) returns the vault key, the zk master, the persona records and the three per-persona leaves, and nothing else; `seedBytes()` and `signAsDeviceAuth()` both throw on a linked file (`:191`, `:359`); `rootOnlyMaterialForLeakTest()` returns `[]` on a linked device (`:436-440`), which is what the Gate 3 payload grep searches for. The refusals are at the door for exports, saves, persona minting and linking another device (`index.ts:57`, `keystore.ts:220,500`).
2. **The wrap primitive is sound.** AES-256-GCM, a random 12-byte nonce, the method id as associated data (`lib/device/custody/wrap.ts:30-38`); the KEK length is checked on both sides; `unwrapSeed` validates the shape and lets the tag decide (`:41-48`). A blob cannot be replayed under another method id, and `PUT /custody/blob/:id` enforces `blob.method === id` (`validator/custody.js:86`).
3. **Anchor scoping of `adapter_state` is real.** Migration 16 rekeys the table `PRIMARY KEY (anchor, namespace, key)` and moves legacy rows under the registered anchor; every read and write in `server.js` is `WHERE anchor = ?` (`:398`, `:465`, `:480`, `:502-509`, `:530`). `checkEnvelope` derives the anchor from the device's stored delegation, not from anything the caller asserts (`:428`, `:449`).
4. **`sealWhole` does hide keys and values for the whole-map namespaces**, padded to a KiB boundary, with `A-CU-NAMESPACE-NAMES-VISIBLE` honestly recorded (`lib/vault/vault.ts:182-191`).
5. **The production keystore refusal is at both doors.** `refuseOnAProductionServer` guards `load()` *and* `persist()` (`keystore.ts:114`, `:153`), and it correctly exempts the browser (`typeof window !== "undefined"`), which is the one process that should hold a seed.
6. **`/api/dev` is closed whole on a production build**, GET included (`app/api/dev/route.ts:16-20,31-34`), which is a strictly better closure than extending `RIG_ONLY_ACTIONS` — D-CU-4-THE-DEV-ROUTE-IS-CLOSED-WHOLE-NOT-BY-LIST is accurate. The `shots/*.json` 403s bear it out.
7. **`getMethod` does not fail open into the fork.** `methods.ts:26-28` throws on any non-404 non-ok status, so a 429 or 500 cannot manufacture an empty account (that is what finding 13 is *not* about — the hole there is a truthful 404 from an untrusted source, not an error).
8. **The link and root-link relays do refuse the obvious things.** Offer codes are 50 bits from a server-side CSPRNG with an unambiguous alphabet and a uniform `% 32` over random bytes (`validator/custody.js:120-127`); an offer's `sealed` is write-once (`:172`); `proposal.a` and `answer.b` must equal the signing anchor (`:216,241`); only the proposer completes (`:258`); a root cannot link to itself (`:246`); offers expire in ten minutes and are swept on every touch.
9. **`POST /events` and `POST /roots` are envelope-gated and anchor-checked** under `REQUIRE_SIG` (`server.js:169-176,250-258`), which is the rep-inflation hole of readiness finding 3, genuinely closed — subject to finding 6's dependency on the flag being set.
10. **The two must-not-ship lists are byte-identical** (`lib/platform/env-contract.ts:7-21` vs `validator/env-contract.js:4-16`), and both boot refusals print names and exit 78 without touching values (`instrumentation.ts:16-18`, `validator/env-contract.js:39-40`). The gap is what the list omits (finding 15) and what it cannot express (finding 6), not the mechanism.
11. **The platform crypto layer introduces no new primitive.** `lib/platform/crypto.ts` is a shape-compatible facade over `@noble/hashes` and `@noble/ciphers`, with randomness from `getRandomValues` (`:64-68`) and no hand-rolled construction anywhere in it.
12. **The browser storage backend's shape is right.** The wrapping key is generated with `extractable = false` (`storage.browser.ts:160`), every entry is sealed with the path as associated data (`:65-69`), a record that does not open is skipped loudly rather than guessed at (`:101-104`), and `wipe()` clears both stores (`:166-171`).
13. **`hashFor()` is no longer content-derived** (`lib/private/store.ts:19-21`) — the stage-3 iteration-4 defect is really fixed, and nothing recomputes the id.
14. **`reloadIdentity()` clears the right caches** before re-booting under a new seed: the keystore copy, the envelope bootstrap, the root roster, the store and the device jar (`lib/device/boot.ts:153-164`) — so an unlock does not leave the previous root's state addressable.
15. **`unenroll` exists and is called on both failure paths** of `recoverIdentity` (`lib/identity/roster.ts:55-66`, called at `:80` and `:93`), which is the undo D-CU-1-ENROLLING-IS-A-MOVE-AND-OWES-AN-UNDO promises; the swallow at `:61` is safe because the keystore still holds the prior seed at that point, so the next bootstrap re-anchors correctly.

## Properties no suite would catch a regression of

Named so the next reviewer can add them rather than rediscover them:

- **"No page-reachable API returns key material."** Nothing greps the device's *own* `window` surface; `scripts/device-smoke.mjs:186-` greps the validator's DB and the two server logs, which is the wrong side of finding 2.
- **"A stranger who knows a save method's public identifier cannot reach the root."** `scripts/accept-cu2.mjs:227-232` asserts the opposite as a pass.
- **"The rate limit survives a client-chosen bucket key."** `accept-cu4.mjs:93-113` sends no `X-Forwarded-For`.
- **"Every route is rate limited."** `accept-cu4.mjs:106` bursts a route mounted after the limiter.
- **"The validator holds nothing that names two roots together."** Nothing greps `root_link_offers`; `accept-cu3.mjs` check 7 reads the linked personas back and asserts they arrive.
- **"A root-link grant's persona lists are the ones that were signed."** Nothing tampers with the relay row.
- **"The boot contract refuses a public deployment with the security switches off."** `accept-cu4.mjs` only poisons the must-not-ship list, and always with `NODE_ENV=production` set.
- **"`DELETE /state` touches only the caller's tenant."** Nothing asserts a second anchor's anon casts or stakes survive another anchor's wipe.
- **"A save that reports success persisted."** `device-smoke.mjs` check 9 tests the happy path of `enablePersistence`; nothing simulates an IndexedDB write failure.
- **"The fork does not render for an identity this browser has a local blob for."** `accept-cu3.mjs` check 1 tests only that it does render when nothing is saved.
