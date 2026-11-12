# One root, many personas: the key hierarchy

Every key in Totem comes off one 32-byte seed through domain-separated HKDF, so one persona's keys say nothing about another's.

::: tip Status: works live
The derivation runs in every visitor's browser on the public preview, where the seed is minted, and on the owner service's server, where the owner's seed lives. The two Farcaster branches are derived everywhere and used for real only on the owner service, where no persona has created its account yet (as of 2026-10-07). {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
:::

The verdict: this is the part of Totem that is finished. A root is a 32-byte seed. Every key is `HKDF-SHA256(seed, info = "layers/v1/" + branch)`, with one branch per use and the persona's nonce inside the per-persona branches. Persona ids are a one-way hash of the seed and the nonce. Device keys are random and authorised by a delegation, so a device can act without ever holding the seed. Recovery is re-derivation: the 24 words give back the seed, the seed gives back the vault key, the vault gives back the roster of nonces, and the nonces give back every persona key, bit for bit. What the hierarchy does not give you is any protection against a stolen seed, and nothing about it hides behaviour. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}

## At a glance

<ol class="flow">
  <li><strong>Seed</strong>32 bytes from the browser's random source, or restored from 24 words</li>
  <li class="flow__us"><strong>HKDF-SHA256</strong>One call per branch, info string "layers/v1/" plus the branch name</li>
  <li><strong>Root keys</strong>The vault key, the device-auth key and one ZK identity</li>
  <li><strong>Persona keys</strong>A signing key, a Farcaster signer and a Farcaster custody key, per nonce</li>
  <li><strong>Device key</strong>Random per browser, authorised by the device-auth key</li>
</ol>
<p class="flow__note">The save methods (passkey, provider) also derive a key-encryption key with HKDF, from their own secret rather than the seed. See <a href="./custody">Browser custody</a>.</p>

<figure class="diagram">
<svg viewBox="0 0 400 386" role="img" aria-labelledby="kh-t kh-d" xmlns="http://www.w3.org/2000/svg">
<title id="kh-t">One seed, many keys</title>
<desc id="kh-d">The seed splits into keys made once per root (the vault key, the device-auth key, the ZK identity) and keys made once per persona (three keys for each persona nonce). The device key is random and delegated by the device-auth key.</desc>
<defs><marker id="kh-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-head" d="M0 0L10 5L0 10z"/></marker></defs>
<rect class="dg-box dg-box--us" x="110" y="4" width="180" height="58" rx="10"/>
<text class="dg-title" x="200" y="28" text-anchor="middle">Seed</text>
<text class="dg-sub" x="200" y="49" text-anchor="middle">32 bytes = your 24 words</text>
<path class="dg-line" d="M200 62V76M95 76H305"/>
<line class="dg-line" x1="95" y1="76" x2="95" y2="94" marker-end="url(#kh-a)"/>
<line class="dg-line" x1="305" y1="76" x2="305" y2="94" marker-end="url(#kh-a)"/>
<rect class="dg-ring" x="1" y="96" width="188" height="196" rx="10"/>
<text class="dg-sub" x="95" y="116" text-anchor="middle">once per root</text>
<rect class="dg-box" x="10" y="126" width="170" height="46" rx="8"/>
<text class="dg-text" x="22" y="145">Vault key</text>
<text class="dg-tiny" x="22" y="162">AES-256-GCM · vault/1</text>
<rect class="dg-box" x="10" y="180" width="170" height="46" rx="8"/>
<text class="dg-text" x="22" y="199">Device-auth key</text>
<text class="dg-tiny" x="22" y="216">Ed25519 · device-auth/1</text>
<rect class="dg-box" x="10" y="234" width="170" height="46" rx="8"/>
<text class="dg-text" x="22" y="253">ZK identity</text>
<text class="dg-tiny" x="22" y="270">Semaphore · zk-identity/1</text>
<rect class="dg-ring" x="211" y="96" width="188" height="196" rx="10"/>
<text class="dg-sub" x="305" y="116" text-anchor="middle">once per persona</text>
<rect class="dg-box" x="220" y="126" width="170" height="46" rx="8"/>
<text class="dg-text" x="232" y="145">Persona A</text>
<text class="dg-tiny" x="232" y="162">three keys from nonce a</text>
<rect class="dg-box" x="220" y="180" width="170" height="46" rx="8"/>
<text class="dg-text" x="232" y="199">Persona B</text>
<text class="dg-tiny" x="232" y="216">three keys from nonce b</text>
<rect class="dg-box dg-box--soon" x="220" y="234" width="170" height="46" rx="8"/>
<text class="dg-text" x="232" y="253">More personas</text>
<text class="dg-tiny" x="232" y="270">a new nonce each</text>
<rect class="dg-box dg-box--soon" x="1" y="304" width="188" height="78" rx="10"/>
<text class="dg-text" x="14" y="326">Device key</text>
<text class="dg-sub" x="14" y="346">random per browser,</text>
<text class="dg-sub" x="14" y="364">delegated by device-auth</text>
<rect class="dg-box" x="211" y="304" width="188" height="78" rx="10"/>
<text class="dg-text" x="224" y="324">Each persona's keys</text>
<text class="dg-tiny" x="224" y="342">sign key · Ed25519</text>
<text class="dg-tiny" x="224" y="358">Farcaster signer · Ed25519</text>
<text class="dg-tiny" x="224" y="374">Farcaster custody · secp256k1</text>
</svg>
<figcaption>Every solid box is HKDF-SHA256 of the seed under its own info string. The device key is the one key not derived from the seed.</figcaption>
</figure>

## The derivation table

`derive(seed, info) = HKDF-SHA256(ikm = seed, salt = empty, info = "layers/v1/" + info, length = 32)`. RFC 5869 allows an empty salt (section 3.1 recommends one but permits omitting it); with a uniformly random 32-byte seed the salt adds nothing in practice (section 3.3 covers uniform input keying material). A seed that is not exactly 32 bytes is refused, because a short seed is not a weaker identity but a different one. Info strings are assembled in one module and nowhere else, so two features do not drift onto the same bytes, with one exception below: persona ids.

| Branch (after `layers/v1/`) | Output | Used for | One per |
|---|---|---|---|
| `persona-sign/<nonce>` | Ed25519 seed | grants, stakes, attributions, fork pointers | persona |
| `fc-signer/<nonce>` | Ed25519 seed | the persona's own Farcaster signer key | persona |
| `fc-custody/<nonce>` | secp256k1 scalar | the address that owns the persona's fid on the IdRegistry | persona |
| `vault/1` | AES-256-GCM key | sealing every namespace the device saves | root |
| `device-auth/1` | Ed25519 seed | device delegations, root-link grants, ZK registration | root |
| `zk-identity/1` | 32-byte master | the root's Semaphore v4 identity (BabyJubJub secret, Poseidon commitment) | root |
| `zk-identity/1/reissue-<i>`, i from 1 to 1024 | 32-byte master | the identity after a revocation | root |
| `kek-from-prf`, `kek-from-provider` | 32-byte key | wrapping the seed for a save method (input is the method's secret, not the seed) | save method |

**Persona ids.** `personaId = "p_" + first 128 bits of SHA-256(seedHex ‖ ":" ‖ nonce)`. The same nonce feeds the id and the three persona keys, so the name and the keys can never drift apart, and an id reveals nothing about the seed or its siblings. The id is a hash of the raw seed computed in `lib/identity/keystore.ts`, outside `kdf.ts` and with no domain string, so it is the one derivation the single-module rule does not cover. {cite: notes/design/architecture-v3.md > "Keystore"}

**The roster.** The nonces live in a sealed roster in the vault, written on every persona mint. Without it the seed would re-derive keys but could not enumerate personas. With it, recovery is complete: phrase, seed, vault key, roster, every persona key, every grant signature. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}

**One ZK identity per root, never per persona.** A commitment per persona would publish the persona-to-root grouping inside the public membership trees. HKDF runs once, outside the circuit; anything that must ever re-derive inside a circuit derives from that master with Poseidon. {cite: SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"}

**Why the device-auth key is its own branch.** If a persona key signed device delegations, the validator would see one signer authorising every persona a device acts for, which is the linkage the design exists to deny. The device-auth key authorises devices and says nothing about personas. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}

## Devices and delegations

A device key is random, minted per browser profile, and never derived from the seed. The root's device-auth key signs a delegation for it. The validator checks the chain on every write: the registered anchor (the device-auth public key), then the delegation, then the device's signature, then a per-namespace counter. The counter is a device-persisted integer that only goes up; it used to be the wall clock, and the clock paired persona creation to devices, so it was replaced. Revocation is forward-only and burns the device id. {cite: SECURITY-POSTURE.md > "Fixed in the pass"} {cite: notes/reports/REPORT-CRYPTO.md > "SECURITY POSTURE — what an attacker can and cannot do now"}

A device that was linked rather than minted holds the vault key, the ZK master and each persona's three key leaves as values, plus its own delegation. It holds no seed. It can act as every persona and open the vault; it cannot mint a persona, export the 24 words or authorise another device. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The Farcaster branches

On the owner service a persona can own a real Farcaster account: the derived `fc-custody` address owns the fid, and the write path re-checks the record's custody address and signer key against the keys derived for that persona before every write. Only personas minted from the owner's own seed may hold a live account; the seeded demo personas derive from a public constant, so anyone with the repository could re-key an account they owned. {cite: SECURITY-POSTURE.md > "Fixed by the pass, after the reviews (Gate 5)"}

Live writes would go through a Neynar managed signer, not the derived `fc-signer` key: Neynar, and anyone with the app's Neynar key, can write as each persona account. As of 2026-10-07 no persona has an account, so nothing posts as a persona yet; on the deployed service the owner app's own Post, Like and Follow buttons save inside Totem only (the build that sends them through the write door as a persona is built, test data only, and waits for a deploy), and the only live cast path is the owner's command line, as a shared test account. Signing in the browser with the derived key and submitting through a relay that holds no key is the design for a later pass. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"} {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(h) The public site: what it does now, and what comes next for strangers"}

## Adversary model

| Adversary | Holds | Gets |
|---|---|---|
| The validator operator | anchors, delegations, persona public keys, ciphertext | no way to compute a sibling persona from one it knows; the derivation is one-way {cite: notes/design/architecture-v3.md > "The thesis, stated as invariants"} |
| A network observer | each persona account's public signer key and custody address | independent-looking keys; any link comes from behaviour, timing or Neynar, not from the keys |
| Someone with the 24 words | the seed | everything: every key, the vault, the full ZK history {cite: notes/reports/REPORT-CRYPTO.md > "THREAT MODEL (stated plainly, per the spec)"} |
| A linked device's thief | the vault key, the ZK master and every persona's sign, signer and custody leaves | all of them permanently. Revoking the device stops its validator writes only: the thief can still sign as each persona, attribute its proof history with the ZK master, and transfer any persona's fid with the custody key. No new personas and no phrase. Recovery means a new seed (a new account) plus onchain custody transfers |
| The public key directory, if malicious | persona public keys | key substitution for personas you do not hold (trust on first use); your own personas are cross-checked against local derivation {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"} |

## What this does not protect

- **A stolen seed.** Whoever holds the 24 words is you, retroactively: they can recompute every nullifier and attribute your whole proof history. There is no remote kill. The only recourse is forking to new personas, which limits future damage. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}
- **Rotation.** Re-issuing the ZK identity rotates a branch under the same seed, so it answers a leaked prover branch and not a leaked seed. A new seed is a new account. {cite: SECURITY-POSTURE.md > "Assumptions added by Gate 3 (by id)"}
- **Behaviour.** Independent keys do nothing about two personas that follow the same accounts, write the same way or act in the same hour. Follows belong to the device, not to a persona, so a clone shares them. {cite: SECURITY-POSTURE.md > "Assumptions added by this pass (by id)"}
- **The owner service's host.** There the seed sits on a Railway volume that this codebase does not encrypt; the platform and anyone in the owner's Railway account can read it. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## The obvious questions

### If someone learns one of my persona keys, can they find my other personas?

No. Each persona key is HKDF of the seed under that persona's nonce. Going from one output to another means inverting HKDF or SHA-256 to recover the seed. What links personas in practice is behaviour and the network, covered on [Linkage and disclosure](/mechanism/linkage-and-disclosure). {cite: notes/design/architecture-v3.md > "The thesis, stated as invariants"}

### Can I rotate a persona's key?

Not in place. A persona's key is a function of the seed and its nonce, so a new key means a new nonce and a new persona. That is what forking is: the old persona signs a forward pointer to the new one and hands it only to the people it chooses. See [Linkage and disclosure](/mechanism/linkage-and-disclosure#forks-and-forward-pointers).

### Does the owner service use a different hierarchy?

No. It runs the same code with the seed on the server instead of in a browser. That is the one named exception to the rule that the server holds no seed.

### Why HKDF and not BIP32?

The code's stated reason is discipline: one audited primitive (HKDF from `@noble/hashes`), versioned info strings assembled in one place, and a seed that is already uniform 32-byte entropy. The keys also sit on three curves (Ed25519, secp256k1, and BabyJubJub inside the Semaphore package) plus a symmetric cipher, and none of them uses BIP32's public derivation.

## Where it lives in the code

- `lib/crypto/kdf.ts`: the whole derivation tree, the `layers/v1/` domain and every info string.
- `lib/crypto/ed25519.ts`, `lib/crypto/vaultCipher.ts`: signing and sealing.
- `lib/identity/keystore.ts`: `derivePersonaId`, the linked-device mode, key leaves.
- `lib/device/custody/wrap.ts`: the two key-encryption-key branches.
- `lib/zk/identity.ts`, `lib/zk/registration.ts`: the Semaphore identity and re-issuance.
- Design record: [Custody model](/custody-model).
