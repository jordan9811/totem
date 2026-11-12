<!-- uncited-ok: page — a decision record for the browser-keystore pass; every "never" here is a design rule the leak grep enforces, not a verified property of the code until Gate 1 closes -->
# Custody model — every visitor is their own device

Written before any implementation (browser keystore pass, Gate 0,
2026-09-16). Decisions carry ids (`D-CU-0-*`) so the report, the
posture and the reviewers can cite them; assumptions carry `A-CU-*`.

## The one rule

**The server never holds a root, a seed, a vault key, or a persona
private key.** Not per-tenant, not sealed, not in a TEE. The server holds
ciphertext, commitments, public keys and public state; the browser holds
everything else. Every decision below is downstream of this rule, and the
two-column table at the end is the rule made checkable.

Today the rule is false by construction: the "device" is the Next.js
server process (`SECURITY-POSTURE.md` §8), it holds `.keystore/root.json`,
and the readiness audit (`notes/runbooks/PREVIEW-READINESS.md`) measured what that means
on a public URL — two strangers share one root, one persona roster and one
corpus. Finding 1 (multi-tenancy) and finding 2 (shared state) are the
ones this pass closes; findings 3–5 close in Gate 4.

## The key hierarchy does not change; its home does

Everything in `notes/reports/REPORT-CRYPTO.md` survives:

```
seed (32 bytes, expressible as 24 BIP39 words)                   ← BROWSER, in memory
 ├─ persona sign keys  HKDF(seed, "layers/v1/persona-sign/"+nonce) → Ed25519
 ├─ vault key          HKDF(seed, "layers/v1/vault/1")             → AES-256-GCM
 ├─ device-auth key    HKDF(seed, …)  signs device delegations
 ├─ zk identity        HKDF(seed, …)  the Semaphore secret
 └─ fc custody/signer  HKDF(seed, …)
device keys: random per device (per browser profile), delegated by the device-auth key
```

**D-CU-0-1 — THE HIERARCHY IS UNCHANGED, ONLY ITS HOME MOVES.** No new
derivation, no new primitive. The same `lib/crypto/{kdf,ed25519,
vaultCipher}` code runs in the browser; the only change to it is that
the vault cipher's implementation moves from `node:crypto` to an audited
pure-TypeScript AES-GCM (`@noble/ciphers`, Cure53-audited) so one code
path runs in both Node and the browser with identical bytes on the wire.
*Rationale:* the crypto pass's review cycle and the linkage tests are
evidence about this hierarchy; changing it would discard that evidence.

## Where things live

**D-CU-0-2 — THE DEVICE IS THE BROWSER.** Everything that today runs in
the Next server holding the keystore — the adapters and their state, the
vault, persona signing, the device envelope, the zk client, feed
building, search, the influence allowance, zones, ports — runs in the
browser in production. The Next server keeps no device. *Rationale:* the
one rule leaves no other shape. A server that decrypts the vault per
request "holds the vault key" for the duration of the request, on a host
the visitor does not control; a server that computes over plaintext the
browser sends it holds the plaintext. Both are the topology §8 says makes
every privacy claim void.

**D-CU-0-3 — THE BROWSER SERVES ITS OWN API.** The page's client
components keep calling `fetch("/api/…")` exactly as they do now (54 of
78 components already do). In production a client component installed by
the root layout (`DeviceHost`) patches `window.fetch` so every `/api/*`
request is answered in-process by the browser-hosted data layer; the
route handlers are the same modules, bundled for the browser behind small
shims for `next/server`, `next/headers`, `server-only` and `node:*`. In
the rig (`ZK_DEV_HOOKS=true`) the patch is off and the Next server serves
`/api/*` from the dev keystore exactly as today, so every existing suite
keeps its behaviour. *Rationale:* a fetch patch is deterministic on the
first load and has no lifecycle (a service worker does not control the
page that registered it until the next navigation, and its install races
the first data fetch). *Consequence, recorded:* anything that bypasses
the page's `fetch` — Playwright's `context.request`, curl — reaches the
server, which in production has no device and answers "no identity". The
readiness audit will therefore be driven through the page's own fetch,
which is what a browser does.

**D-CU-0-4 — THE NEXT SERVER IN PRODUCTION RENDERS PUBLIC STATE ONLY.**
Server-rendered pages get the public corpus (seeded accounts, public
trees, epochs, public lens artifacts) and no device; the visitor's
private layers — modes, rules, readwise, private posts, DM items,
allowance, zone layout, lens pin — hydrate client-side from the browser
device. *Rationale:* server components cannot ask the browser for data
during a render; the alternative (client-render everything) throws away
the first paint. *Recorded deviation:* in production the first paint
shows the public ordering and the personal ranking replaces it after
hydration — the same skeleton-to-timeline swap the X client does; the
preview banner names it.

**D-CU-0-5 — THE VALIDATOR BECOMES MULTI-ANCHOR.** Today `device_auth` is
one row (`id = 1`), first-write-wins across everyone, and `adapter_state`
is one tenant's namespaces. It becomes: one anchor per root, keyed by the
root's device-auth public key; devices reference the anchor whose
delegation they carry; state rows are keyed `(anchor, namespace, key)`;
`PUT`/`DELETE /state` under a device envelope write the caller's anchor;
`GET /state[/ns]` require the signed-read envelope and return the
caller's anchor only; `POST /events` requires the envelope (readiness
finding 3). Registering an anchor never conflicts with a stranger's,
because the anchor IS the root's public key and registering it proves
nothing — only a delegation signed by its private key can use it.
Migration 16 moves every existing row under the rig's anchor.
*Rationale:* per-root state on the validator is what "two vaults" means;
the envelope machinery already identifies a device, it only lacked the
tenant dimension.

## Onboarding

**D-CU-0-6 — EPHEMERAL FIRST.** A first visit mints a 32-byte seed with
`crypto.getRandomValues` in the browser, with no auth, no phrase, no
login. It exists in memory only. A persistent strip says: "this identity
lives in this tab; save it to keep it." Reloading or closing the tab
loses it and the next visit mints fresh. Nothing about an unsaved visitor
reaches the validator except the public actions they took (a public cast
row signed by an ephemeral persona is as real as any other) and the
ciphertext their device wrote, which nothing can open once the tab is
gone. *Rationale:* zero friction to try; the honest label makes the loss
the visitor's choice, and a memory-only seed never touches storage that
outlives the tab.

**D-CU-0-7 — SAVING MEANS WRAPPING THE SAME SEED UNDER A METHOD'S KEY.**
The seed stays the random 32 bytes the tab minted (or the 24 words
restored). Every save method contributes a key-encryption key (KEK) and
the seed is wrapped under it with AES-256-GCM; the wrapped blob is
ciphertext and lives on the validator keyed by the method's public
identifier (a passkey credential id, a provider user id), with a copy in
the browser's IndexedDB. Unlocking = obtain the KEK, fetch the blob,
unwrap, hold the seed in memory. *Rationale:* ephemeral-first forces
this. A root that already exists cannot later become a function of a
passkey's PRF output; wrapping is the one mechanism that lets a
pre-existing root gain a method, gain a second method, and be reached by
any of them — "one account, many methods" falls out for free.
*Assumption A-CU-BLOB-ON-VALIDATOR:* if the validator loses every blob
for a root and the browser's copy is gone, the methods cannot reach the
seed; the 24 words are the escape hatch, and the save flow says so.

**D-CU-0-8 — PASSKEY: PRF WHERE AVAILABLE, WRAP OTHERWISE, RECORDED.**
WebAuthn with discoverable credentials (login needs no username). Both
paths are implemented; the capability is detected at runtime; the chosen
path is recorded on the account's method record.

- **PRF path.** `navigator.credentials.get` with the `prf` extension
  evaluated over a fixed salt (`"layers/prf/v1"`) yields 32 deterministic
  bytes; `KEK = HKDF(prf, "layers/v1/kek-from-prf")`. The same passkey
  yields the same KEK on any device that syncs it, so a synced passkey on
  a new device unwraps the same seed and resolves to the same root.
- **Wrap path (no PRF).** The passkey can only authenticate. The KEK is a
  random 32-byte key generated at save time and held by the app server,
  released to the browser only after a verified WebAuthn assertion for
  that credential; the wrapped blob for wrap-path accounts lives ONLY in
  the browser's IndexedDB, never on the validator. *This is the one place
  a server holds a key,* and it is not a root, a seed, a vault key or a
  persona key: without the browser's blob it opens nothing. Consequence,
  stated on the account: a wrap-path account is device-bound — it moves
  to another device by device linking or by the 24 words, not by logging
  in with the passkey there. *Assumption A-CU-WRAP-PATH-SPLIT:* an
  operator holding the release key AND a copy of the browser's blob
  reconstructs the seed; the blob's home in IndexedDB is the mitigation,
  and PRF is the path to prefer wherever it exists (it does on current
  Chrome, Edge, Safari 18+ and Firefox).

**D-CU-0-9 — SOCIAL LOGIN IS A CUSTODY-PROVIDER ADAPTER.** One provider
SDK (Privy-class embedded wallet: key shares in the provider's
enclave, exportable) offering Farcaster, email and Google, Farcaster
listed first, behind `CustodyProviderAdapter { login(method), export() }`.
The provider's export (a seed or a deterministic secret) is used only
as `KEK = HKDF(export, "layers/v1/kek-from-provider")` — the provider
never sees a Layers key, and the Layers seed is never the provider's
seed. A fixture provider runs in the sweeps; `live-cu2` runs once against
the real SDK with no spend. *Rationale:* the provider is a KEK source
like any other method; treating it as THE root would make one company's
enclave the custodian of the whole hierarchy.

**D-CU-0-10 — THE PICKER SHOWS BOTH PATHS AS EQUALS**, ordered by device
capability: passkey first where WebAuthn exists, social first where it
does not (with one sentence saying why passkey is absent). Neither is
hidden. After a save, a nudge offers the other method as a backup; it
never blocks.
*Amended by the Persona launch pass (P1, 2026-10-10):* the picker is
passkey first. Its order is (1) "Save with Face ID / fingerprint" (or
"Save with a passkey" where no platform authenticator exists), (2) Sign
in with Farcaster, (3) the fixture social card on the rig only, and (4)
an "Advanced" section, collapsed, with the 24 words, Restore from 24
words, Keep in this browser, Devices and Linked accounts. A save card
appears at the first useful moment (after a first post that is not
anonymous, a first persona, a verified sign-in or a landed X archive
import) while the identity is still tab-only. "Social
login" on the public site is now Sign in with Farcaster, and it is an
IDENTITY link, not a KEK source (D-SIWF-1 below): it yields no stable
secret to wrap the seed under, so it can never bring a lost identity back.

**D-CU-0-11 — SEED EXPORT IS THE UNIVERSAL ESCAPE HATCH.** 24 BIP39
words (the existing `lib/recovery/mnemonic.ts`), shown in the browser
only, never transmitted; 24 words in on any device reproduces the seed,
therefore the root, every persona and the vault (the crypto pass's
recovery, now the bridge that needs no provider, no passkey, no
platform keychain).

**D-CU-0-12 — EVERY AUTH COMPLETION THAT LANDS ON AN EMPTY ACCOUNT FORKS.**
After any unlock or creation, if the root's anchor holds no state on the
validator, the client renders "New here? Start fresh" / "Already have an
account? Link this device" before anything else. The empty account is the
only signal — no IP, user-agent or timing heuristics, ever.
*Rationale:* a heuristic that guesses wrong silently creates the second
root this pass then has to link; an explicit fork costs one click.

## Devices and duplicate roots

**D-CU-0-13 — DEVICE LINKING: THREE ENTRY POINTS, ONE MECHANISM.** The
crypto pass's flow, re-homed: the old device issues a delegation for the
new device's public key (signed by the root's device-auth key) and
HPKE-seals to the new device's key the material a device needs — the
vault key and the persona sign-key leaves of the roster — never the seed.
Entry points: from the new device ("link existing" — it shows a short
code / QR the old device scans), from the old device (settings → add
device — it shows the code), and from neither (24 words). The seed never
crosses the channel; the payload grep asserts it.

**D-CU-0-14 — ROOT LINKING IS LINK, NOT MERGE.** Two roots cannot be
merged: personas, nullifiers and reputation derive from a specific seed.
They can be linked: a pairwise grant `{rootA, rootB, issuedAt}` signed by
BOTH roots' device-auth keys, stored in each root's vault (ciphertext;
the validator never sees which two roots are one person). A client that
holds both roots — the missed-fork case is resolved by device-linking
the second root into the first's browser — presents them as one
identity: one persona switcher, unified search over both vaults, one
settings surface, with the sentence "these accounts are linked, not
merged — reputation does not combine" wherever a tier is shown.
Unlinking deletes the grant from both vaults and is symmetric.
*Rationale:* the persona-grant machinery applied one level up; anything
stronger would need the validator to know the pair.

## What the browser holds, what the server holds

The leak grep is extended with a needle class per row of the left
column; every needle is asserted absent from the validator's database,
its log, the app server's log and both build outputs, on every sweep.

| BROWSER holds (never leaves it) | SERVER holds (validator unless noted) |
|---|---|
| the seed (memory; wrapped under each method's KEK in IndexedDB) | anchor public keys (one per root) |
| the vault key (memory, derived) | device public keys, delegations, envelope counters |
| persona private keys (derived, used, dropped) | the ciphertext namespaces, keyed by anchor |
| the device private key (hex in the storage seam, mirrored to IndexedDB as ciphertext under a non-extractable wrapping key; it is in the leak grep) | wrapped-seed blobs per PRF or provider method (ciphertext, keyed by credential or a hashed provider subject) |
| the device-auth private key (derived) | account method records: credential ids, provider user ids, which passkey path (public identifiers) |
| the zk identity secret and every nullifier secret | zk commitments, trees, root history, nullifiers, eligibility rows |
| vault plaintext: private posts, grants, forks, the event log, backpack claims, allowances, lens pins, zone layouts, ports, readwise, modes | public persona ids and Ed25519 public keys (the directory), stakes rows, rep events per root row, anon casts, attestations, public lens artifacts |
| the search index and the embedding worker's state | the public corpus and config (Next server) |
| PRF outputs, provider exports, KEKs (transient) | the wrap-path release keys, per credential (Next server — the one exception, D-CU-0-8) |
| the 24 words (display only) | the X OAuth client secret (Next server — a server credential, not user key material) |
| the linked-root grants (in each vault) | nothing that names two roots together |

Rig only (never in a production process): `.keystore/root.json`,
`device.json`, `zk-identity.json`, `zk-pins.json`,
`envelope-counters.json` on disk; the seeded viewer (`SEED_VIEWER`) as
an identity; the `layers_view_as` / `layers_seed_persona` cookies.

## How Gate 1 will be built, and where it may stop

Gate 1 is single-threaded and staged so that each stage is green on the
full legacy suite before the next begins; the rig keeps the server-hosted
dev keystore throughout, so the suites do not change behaviour.

1. **Platform layer.** `lib/platform/{crypto,storage,env}` — one
   `createHash`/`randomBytes`/AES-GCM implementation on `@noble/hashes`
   and `@noble/ciphers` used by Node and the browser alike; `server-only`
   markers and `node:*` imports retired from every module that must run
   in the browser. Behaviour-preserving; the crypto suites prove it.
2. **Validator tenancy.** Migration 16 (multi-anchor), per-anchor state,
   envelope-gated reads, `POST /events` under the envelope. The app's
   persistence layer already signs; it gains nothing but the signed read.
3. **The browser device.** The keystore's browser backend (seed in
   memory; wrapped blob and the device key, sealed under a non-extractable wrapping key, in IndexedDB), the
   `DeviceHost` fetch patch, the route bundle for the browser, the
   production server's refusal to open a dev keystore, public-only
   server rendering, the seeded viewer and the persona cookies made
   rig-only.
4. **Proof.** The readiness audit re-run through the page (two contexts,
   two commitments, two empty vaults, no cross-reading); restart-survival
   with browser-held state across a hard kill of both servers; the leak
   greps with the new needle classes; the full legacy suite.

Recorded deviations from the letter of the gate: (i) "no production code
path reads `.keystore/`" is delivered as a boot-time refusal in any
process without `ZK_DEV_HOOKS` plus a probe that starts production with
an empty `KEYSTORE_DIR` and asserts it stays empty — the server bundle
still contains the rig's module, because the rig is the same build;
(ii) a visitor's own public casts stay in that visitor's device until a
public cast relay exists (the network is off in preview), so visitors do
not see one another's public posts either — the gate's "cannot see each
other's posts" is met in both directions; (iii) the audit script's
requests go through the page's fetch (D-CU-0-3).

## What Gate 1 actually built (recorded after the fact)

All four stages landed. The browser device is `lib/device/` (the boot, the
fetch host, the generated route table and the shims), its storage backend
is `lib/platform/storage.browser.ts`, and its page-side half is
`public/device/boot.js` plus the bundle `scripts/build-device.mjs`
produces. Four instruments prove it: `scripts/device-smoke.mjs`,
`scripts/probe-no-keystore.mjs`, `scripts/device-restart-survival.mjs`,
and `scripts/audit-preview-g0.mjs --device`, which drives the readiness
audit through the page's own fetch as deviation (iii) said it would.

One piece of stage 3 is NOT built and is named rather than hidden:
server-side public-only rendering (D-CU-0-4). The API surface is the
device's, but a server-rendered page still reaches for data the device
should supply, so a production server renders `/home` instead of refusing
or rendering the public corpus. The no-keystore probe measures this rather
than asserting it. The preview pass needs it before a page is served to a
stranger; nothing else in Gate 1 depends on it.
If stage 3 cannot be made green within Gate 1's budget, the pass stops
there with stages 1 and 2 committed — they are behaviour-preserving and
correct on their own — and the report says exactly which surfaces the
browser host does not yet serve. Nothing above Gate 1 is built on a
keystore that still lives on the server.

## Sign in with Farcaster (Persona launch pass, P1)

Recorded 2026-10-10 from `research/spec-siwf-passkey-first-2026-10-08.txt`;
built on test data only. The posture is SECURITY-POSTURE.md §21.

**D-SIWF-1 — THE DEVICE VERIFIES.** The whole sign-in runs in the browser
device: it creates the Farcaster relay channel, shows the QR code, polls,
verifies the signed message itself (a 65-byte signature recovered
locally, a contract wallet's through ERC-6492 over the node) and checks
the account against Optimism's IdRegistry or KeyRegistry with `eth_call`
from the browser. The public app server receives no request; a request
that reaches it on a public deployment is refused `404 device_only`
before its body is read. *Rationale:* a server-side verify would hand the
operator the account, an address and a time, joinable to the root's own
signed validator traffic; the third parties (the relay, the node) learn
the account and an address but never the root.

**D-SIWF-2 — SEALED, UNIFORM, 1,024 BYTES.** The binding is one sealed
record in a new vault namespace, `accountLinks`, whose ciphertext is
exactly 1,024 bytes with or without a link. Every root seals the empty
record at boot, so the namespace's presence says nothing and its size
says nothing. The validator learns the name, never an account number.

**D-SIWF-3 — A READ-ONLY PUBLIC SELF, NO FORK.** A verified sign-in mints
a "public self" persona (`publicSelf: true`) for the account: listed in
the switcher with a read-only chip, shown on its profile with the "that's
me" badge, never a switch target on the public site. Posting, replying,
reacting, following and acting as it are refused
(`PUBLIC_SELF_READ_ONLY`); forking from it is refused, because a fork
carries a continuity proof to its source and would publicly link the new
persona to the account. One account per root; a disconnect leaves a
tombstone; the handle-stem rule applies both ways.

**D-SIWF-4 — NO SIGNATURE STORED.** The record keeps the account number,
the relay's profile fields, the persona id, the auth method, the signer
address, the SHA-256 of the nonce and of the message, the verification
time and the node's host. It never keeps the signature, the raw message,
the relay's IP and user-agent metadata, the custody and verified
addresses or the channel token: a signature is a transferable proof that
the account signed in to this domain, and keeping it widens what a vault
compromise leaks for no product value.

**Amends D-CU-3-A-ROOT-WITHOUT-A-FID** (notes/reports/REPORT-CUSTODY.md): that decision
says binding a real account number later "is a re-registration". It is
not: a Farcaster binding is a sealed `accountLinks` record, never a
`roots` row. The root keeps its negative pseudo-fid, because a `roots` row
carrying a real account number would be a plaintext account-to-anchor
table the operator could read.
