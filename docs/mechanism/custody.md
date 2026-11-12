# Browser custody

The browser is the device: it mints the seed, holds every private key and answers the app's own API. The server stores ciphertext, public keys and exactly one release secret.

::: warning Status: works live, with named gaps
<span class="st st--live">Works live</span> on the public preview: the seed is minted in the browser, personas are created and posts round-trip in the device, and two browser profiles get two independent roots (all checked against the deployment). Saving with a passkey or the 24 words is deployed; its automated checks ran on a local production-shaped copy with virtual authenticators, not against the deployment. <span class="st st--test">Built, test data only</span>: linking a second device and linking two roots; the passkey-first save screens and [Sign in with Farcaster](/mechanism/sign-in-with-farcaster), which is an identity link, not a save method (both deployed 2026-10-11, only run on test data so far); and chunked sealed documents with a loud 256 KiB save limit. <span class="st st--soon">Coming soon</span>: Sign in with X, which needs a paid X developer app; no real social-login provider is in the code. The owner service is the one named exception: its seed sits on the server's volume. {cite: notes/reports/REPORT-CUSTODY.md > "What was verified against the deployment"}
:::

The verdict: the rule "the server never holds a root, a seed, a vault key or a persona private key" is true on the public preview, by construction and by test. The seed exists in memory until you save it; saving wraps the same seed under a key-encryption key (KEK) that a save method supplies, and the wrapped blob is ciphertext wherever it lives. The weak points are the ones every browser wallet has: any script running on the app's origin can do what the page can, and a passkey belongs to the domain that created it. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## At a glance

<ol class="flow">
  <li><strong>First visit</strong>The browser mints 32 random bytes. Nothing is saved; closing the tab loses them.</li>
  <li class="flow__us"><strong>Save</strong>A method yields a KEK; the seed is wrapped with AES-256-GCM.</li>
  <li><strong>The blob</strong>Passkey PRF blobs go to the validator; wrap-path blobs stay in this browser.</li>
  <li><strong>Unlock</strong>One passkey assertion; unwrap; the seed is held in memory only.</li>
  <li><strong>New device</strong>Link it (sealed keys, not the seed) or type the 24 words.</li>
</ol>
<p class="flow__note">An unsaved visitor still leaves public identifiers on the validator: an anchor public key, a device delegation, a root row with a negative pseudo-fid, and sealed rows that only the lost seed could open.</p>

## Ephemeral first

A first visit mints the seed with `crypto.getRandomValues` and keeps it in memory. A strip says the identity lives in this tab until you save it. The boot still registers public material: the device-auth anchor, a delegation, a root row whose fid is a negative number derived from 32 bits of the anchor, and sealed state rows. None of it is key material. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"}

"Keep this identity on this device" generates a non-extractable AES-256-GCM key inside WebCrypto, stores it in IndexedDB as a `CryptoKey`, and mirrors every storage entry as ciphertext under it with the entry's path as associated data. No code can export that key, including this code; any code on the origin can still use it. {cite: notes/reports/REPORT-CUSTODY.md > "Stage 3 — the browser device — GREEN"}

## The save paths

Every method wraps the same 32-byte seed under that method's 32-byte KEK with AES-256-GCM, a random 12-byte nonce and the method id as associated data, so a blob cannot be replayed under another method. A wrong KEK fails the tag; nothing half-succeeds. A method id is a public identifier and belongs to the first anchor that wrote it, so a stranger cannot overwrite your blob. A login that finds no method record is reported as an empty account and never creates one. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"}

| Method | KEK | Where the blob lives | Trusts | Today |
|---|---|---|---|---|
| Passkey, PRF path | `HKDF(PRF(salt "layers/prf/v1"), "layers/v1/kek-from-prf")` | the validator, plus a copy in IndexedDB | the platform's passkey sync and WebAuthn | deployed |
| Passkey, wrap path (no PRF) | `HMAC-SHA256(release secret, "layers/custody/release/v1" ‖ credential id)`, released by the app server after it verifies a WebAuthn assertion | this browser's IndexedDB only, so the account is device-bound | the app server not to release without an assertion | deployed |
| The 24 words | the seed itself, as BIP39 | your paper | you | deployed |
| Social login (designed for email and Google) | `HKDF(provider export, "layers/v1/kek-from-provider")` | the validator | the provider's export staying deterministic | <span class="st st--soon">Coming soon</span>: adapter only, no provider; on the rig, a fixture card |

The picker is passkey first (Persona launch P1, built on test data): "Save with Face ID / fingerprint" first, Sign in with Farcaster second, and the 24 words, Restore, Keep in this browser, Devices and Linked accounts under a collapsed Advanced. A save card appears at the first useful moment (a first post that is not anonymous, a first persona, a sign-in or a landed X archive import) while the identity is tab-only. Sign in with Farcaster is not a row in this table: it yields no stable secret to derive a KEK from, so it cannot bring a lost identity back. {cite: custody-model.md > "Onboarding"}

**The assertion check, exactly.** The server parses no attestation object and no CBOR. At registration the browser hands over the credential's SPKI key and algorithm; every unlock verifies an assertion with WebCrypto (Ed25519, or ECDSA P-256 after DER conversion) over `authenticatorData ‖ SHA-256(clientDataJSON)`, and checks a server-signed challenge with a two-minute lifetime, spent once per server instance (a restart or a second instance can accept it again inside the two minutes, and it is not bound to a credential id: A-CU-5-CHALLENGE-REPLAY-PER-INSTANCE), the origin, the RP id hash and the user-present flag. The release fails closed: a 503 when the validator errors or cannot be reached. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

**Why PRF is preferred.** With PRF, the same synced passkey yields the same KEK on any device and the blob is on the validator, so the root follows the passkey. That is the WebAuthn PRF design; it has not been exercised here with a real synced passkey, because the virtual authenticator carries no hmac-secret material (A-CU-2-SYNCED-PASSKEY-PRF-NOT-SIMULABLE). Cross-device unlock end to end was proven only on the provider path. The wrap path is the one place a server holds a key, and that key opens nothing without the blob that stays in your browser. Rotating the release secret orphans every wrap-path blob; the 24 words are the way back. {cite: custody-model.md > "Onboarding"}

## Linking a device

The new device mints an X25519 key pair in memory and posts an offer; it gets back a 10-character code (50 bits) that can be created once and expires in ten minutes. The old device types the code and an 8-hex-character fingerprint, `sha256(code | hpkePub | devicePubKey)`, shown on the new device; a mismatch is refused before anything is sealed. The old device then seals, with HPKE (X25519, HKDF-SHA256, AES-256-GCM, `@hpke/core`) to the new device's key: a delegation for the new device, the root's id and anchor, the vault key, the ZK master, and each persona's three key leaves. The seed and the device-auth private key do not cross. The relay holds a device key, an HPKE public key and ciphertext. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)"}

**What the fingerprint does not stop: the relay itself.** The fingerprint is 8 hex characters, 32 bits (`lib/device/linking.ts` keeps `h.slice(0, 8)`). The validator, which relays the offer, also mints the code (`validator/custody.js` `mintCode`) and stores and serves both public keys. Against an outsider the check gives about 2^-32 resistance. Against the relay it gives none: a malicious relay keeps its own HPKE key, varies `devicePubKey` (any 64-hex string is accepted) and needs about 2^32 SHA-256 calls, seconds on a GPU, to match the target fingerprint inside the ten-minute offer. The old device then seals the vault key, the ZK master and every persona's sign, signer and custody leaves to the attacker. Root linking uses the same 32-bit fingerprint. So device and root linking trust the validator. The fix is a commit-then-reveal short authentication string, or a longer fingerprint over values the relay does not choose. It is not built, and not yet filed as an assumption in the security posture. <!-- uncited-ok: read from lib/device/linking.ts, lib/device/rootlink.ts and validator/custody.js on 2026-10-07 -->

## Linking two roots

Two roots on two devices can be linked, never merged: a pairwise grant `{rootA, rootB, issuedAt}` signed by both device-auth keys, each signature made on the device that holds that root, sealed into both vaults. Each client then shows the other root's personas beside its own, with the sentence that they are linked, not merged, and that reputation does not combine. Personas, nullifiers and reputation stay separate. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

One correction to the design record: the validator's `root_link_grants` table records the two anchors of every completed root link, so that revocation is scoped to its parties. The operator therefore does learn which two anchors were linked. `custody-model.md` still says the server holds nothing that names two roots together; that row predates the table. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The vault

Each namespace the device saves is sealed whole: AES-256-GCM via `@noble/ciphers` (Cure53-audited), a random 96-bit nonce per record, associated data binding `namespace | recordId | version` so a ciphertext cannot be moved to another slot, and one opaque record per namespace padded to 1 KiB steps. Reads fail closed: a moved or tampered record is dropped, and a namespace in which every record fails to open throws instead of reading as empty. A local pin file records which namespaces this device has sealed, so a namespace the operator deletes is refused instead of read as never written. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."} {cite: SECURITY-POSTURE.md > "Assumptions added by this pass (by id)"}

## Chunked sealed documents and the body limit

Persona launch P2, built on test data. Every JSON route on the validator accepts up to 256 KiB (`STATE_BODY_LIMIT_BYTES = 262144`, `validator/limits.js`; the app's persist client carries the same constant, and a test asserts the two are equal). The client checks a sealed body's size before sending and throws an error naming the namespace and its size; the validator answers `413` in JSON naming the limit and the namespace. Retries cover a network failure or a 5xx; nothing is marked saved until the validator says so. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

A sealed namespace is hex ciphertext, so one PUT holds about 128 KiB of plaintext. A bigger document, such as an X archive's shelf (20,000 posts is about 6 MB), is stored by `lib/vault/chunkedDoc.ts` as numbered pieces of at most 96 KiB of plaintext (`CHUNK_PLAINTEXT_BYTES = 98304`), each sealed under its own name so a piece moved elsewhere fails to open, plus a sealed manifest written last that names the generation, the piece count and the SHA-256 of the whole. A save that dies part way leaves the old manifest pointing at the old pieces. The pieces live in two slots, `<name>.g0.<i>` and `<name>.g1.<i>`, so the set of names stays bounded (D-X-SLOT-NAMES). Names are per root, never per persona. A missing, foreign, unreadable or mismatched piece throws "could not be read, nothing was changed", and the module refuses to write until a read has succeeded. The residuals: the operator sees each document's piece count and padded size, a size class (A-X-NAMESPACE-SIZE-CLASS), and can serve an older complete copy to a fresh process (A-X-DOC-ROLLBACK). {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

## What each side holds

| The browser holds | The validator holds | The app server holds |
|---|---|---|
| the seed, in memory, and wrapped under each method's KEK | one anchor public key per root | the public pages |
| the vault key and device-auth key (derived) | device public keys, delegations, envelope counters | one wrap-path release secret |
| persona private keys (derived, used, dropped) | one sealed record per namespace, keyed by anchor | the Neynar read key, once the owner sets it (see [The read relay](/mechanism/read-relay)) |
| the device key | method records: credential id, SPKI key; a hashed provider subject | |
| the ZK identity and every nullifier secret | wrapped-seed blobs (ciphertext) | |
| a signed-in Farcaster account, in the sealed `accountLinks` record (built, test data only) | `accountLinks`: one sealed record, exactly 1,024 bytes, under every anchor | nothing from a sign-in: no request reaches it |
| vault plaintext and the search index | ZK commitments and trees; short-lived link relays; root-link anchor pairs | |

The posture's one rule, stated with its evidence: the server never holds a root, a seed, a vault key or a persona private key, and a production server refuses to open a keystore at all. Every sweep greps the validator's database, its log and the app's log for every seed, KEK, PRF output, provider export, persona key leaf and device key the test devices used. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The owner service, the named exception

The owner service runs in rig shape: the owner's seed, device key and envelope counters live on a Railway volume, and the server derives every persona's keys. Every page and API route needs a live session cookie, `v2.<issued>.<expiry>.<epoch>.<method>.<nonce>.<HMAC>` under a key derived from the owner's passphrase, `__Host-` prefixed, httpOnly, Secure, SameSite=Strict, good for `OWNER_SESSION_DAYS` (default 30, capped at 90) per device for a browser sign-in and 24 hours for a script's, and live only while its epoch is the volume's current one. The owner signs in with the passphrase or, after one passphrase sign-in on that device, with Face ID, Touch ID, a fingerprint or Windows Hello: a WebAuthn passkey, discoverable, user verification required, bound to `APP_URL`'s host, registered only from a passphrase session at most 30 minutes old, at most five of them. Revocation is server-side: Settings › Security removes a passkey (ending its sessions), "Lost this device?" removes it and signs out every device in one write, "Sign out everywhere" draws a new epoch, and a new passphrase ends every session and retires every passkey. Logins, and the two passkey routes, are metered at 10 per address (refilled one a minute) and 30 across all addresses (one per ten seconds), plus 400 ms per failure. The passphrase and a registered passkey are alternatives, not two factors: either one alone can post as every persona and reveal the 24 words. The passkey build was deployed on 2026-10-10 and has not been used there yet. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## Adversary model

- **The validator operator** holds ciphertext, public keys, anchors and blobs. It can withhold or delete records (availability) and see sizes, counts and timing (metadata). It has no key to open what it stores. During a device or root link it can substitute its own device and receive the keys, as described under Linking a device.
- **The app server operator** holds the wrap-path release secret. With a copy of a wrap-path blob from your browser it could reconstruct that seed; the blob's home in IndexedDB is the mitigation, and PRF avoids the split entirely. {cite: custody-model.md > "Onboarding"}
- **Railway** terminates TLS and sees every request's address and path. It forwards ciphertext and public state to the validator. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Script on the app's origin** is the device. A third-party script, an injected script or a page served from the same origin could use the non-extractable key and read memory. These docs are such pages: since the owner's decision of 2026-10-10 the app serves them at `/docs`, under a policy that runs only their own scripts and lets them connect only to the app's origin. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## What this does not protect

- **Same-origin script.** The page is the device. The app serves no third-party script, and its own pages have no content security policy beyond `frame-ancestors 'none'`. The docs at `/docs` share the origin: their scripts could reach the same key, which the owner accepted rather than run a second origin. Their policy narrows what an injected script could load or send; it does not stop a script the build itself ships. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **A change of domain.** A passkey is bound to the host that saved it. Moving the app from its `railway.app` subdomain to a custom domain orphans every passkey saved so far; the 24 words still work.
- **Metadata.** Record counts, sealed sizes (in 1 KiB steps), write timing and which namespaces change.
- **Large saves, fixed in the code (test data only).** The old gap, a save over Express's default 100 KB swallowed without a word, is fixed in the code: the limit is 256 KiB, a save over it is refused out loud with the namespace and its size, and big documents save in sealed pieces (above). It was deployed to both sites on 2026-10-11. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
- **A link made through a dishonest validator.** The 32-bit fingerprint does not stop the relay that minted the code; see Linking a device.
- **A stolen linked device.** It keeps the vault key, the ZK master and every persona's sign, signer and custody keys for good. Revoking the device stops only its validator writes: the thief can still sign as each persona, attribute that persona's proof history, and, once a persona has a Farcaster account, transfer it with the custody key. Persona keys cannot be rotated in place, so getting clear means a new seed and onchain custody transfers. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Losing everything at once.** If the validator loses a PRF blob and the browser's copy is gone, only the 24 words reach the seed.
- **The owner service.** The host holds the seed; the passphrase, or a registered passkey, opens the whole account; a stolen cookie works until it expires or the owner signs out everywhere, removes that passkey or changes the passphrase (a stolen passphrase session cannot be ended on its own). {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## The obvious questions

### What happens if I close the tab before saving?

The seed is gone. What the device wrote is ciphertext under a vault key derived from a seed that no longer exists anywhere. Public posts on the preview lived only in the tab's memory, so they are gone too. The next visit mints a new root.

### Can the operator log in as me?

On the public preview, no: it holds no seed and no vault key. With the wrap path it holds a release key that opens nothing without the blob in your browser. On the owner service the operator is the owner. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### What Sign in with Farcaster is, and is not

It is an identity link: the browser device verifies, by itself, that the person in the tab controls a Farcaster account, and seals that account into the root's `accountLinks` record with a read-only public self persona. It is not a save method and not a way back in: a sign-in yields no stable secret to derive a KEK from, and a validator record keyed by the account number would be an account-to-anchor table. The public app server receives no request for it. Built, test data only; the full mechanism is [Sign in with Farcaster](/mechanism/sign-in-with-farcaster). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

Social login in the KEK sense is still designed as one more KEK source: a provider (a Privy-class embedded wallet offering email and Google) exports a deterministic secret, and Totem derives a KEK from it, so the provider never sees a Totem key. The adapter exists; no real provider is installed, and the public preview refuses the test provider. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"}

Signing in with X is a separate question: it needs an X developer app, which X bills per use, and a client secret held by a server, because X's API sends no browser-access headers. That spend waits for the owner's decision; version 1 is Sign in with Farcaster plus Bring your X, the archive.

### Is the escrow passphrase still a thing?

The crypto pass built a passphrase escrow (scrypt, then AES-256-GCM, the blob stored on the validator). The route still exists in the device code, but no screen on the public preview offers it. Its weakness is stated in the posture: the blob is offline-grindable, and cracking it exposes the seed and so the whole nullifier history. {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}

## Where it lives in the code

- `lib/device/`: the browser device (boot, fetch host, generated route table, shims); `lib/device/custody/`: the wrap, passkey client, provider adapter, method client.
- `lib/platform/storage.browser.ts`: the non-extractable key and the IndexedDB mirror.
- `lib/custody/webauthn.ts`, `lib/custody/release.ts`, `app/api/custody/passkey/*`: the server half of the wrap path.
- `lib/device/linking.ts`, `lib/device/rootlink.ts`: device and root linking.
- `validator/custody.js`: method records, blobs and link relays.
- `lib/vault/vault.ts`, `lib/vault/sealedPins.ts`: the vault format and the deletion pins; `lib/vault/chunkedDoc.ts`: chunked sealed documents; `validator/limits.js`: the body limit.
- `lib/fc/siwf/`, `app/api/fc/siwf/route.ts`, `components/device/FarcasterSignIn.tsx`, `components/device/SaveMoment.tsx`: Sign in with Farcaster and the save moment.
- Design record: [Custody model](/custody-model).
