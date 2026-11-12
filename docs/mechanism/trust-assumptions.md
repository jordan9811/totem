# Trust assumptions

Every party Totem depends on: what it sees, what it could do, and what stops it. The public preview and the owner service trust different parties for different things, so each has its own table.

::: tip How to read this page
"What stops it" names a mechanism that exists in the code, or says plainly that nothing does. A row that ends in "nothing" is an assumption, and the posture document lists it by id. Status words are as defined on the [overview](/mechanism/#read-this-first). {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"}
:::

The verdict: on the public preview, your secrets depend on your browser and on the code the app's origin serves. Three more parties join that list in specific cases: if you saved with a synced PRF passkey, your passkey provider together with the validator's operator (the provider can produce the KEK, the validator holds the blob); if you saved with a wrap-path passkey, the app server's release secret together with a copy of the blob from your browser; and during a device or root link, the validator, which relays the link and can substitute its own device. Outside a link, the validator and Railway are trusted for availability and see metadata, never content. Every privacy property beyond content (that your personas cannot be grouped) still depends on parties that are either not deployed (a third-party network relay, a crowd of 50 roots) or not neutral (Neynar, the set curator). On the owner service the trust collapses onto three things: the owner's Railway account, the owner's passphrase, and Neynar, which can write as every persona account once those accounts exist. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## At a glance

<ol class="flow">
  <li class="flow__us"><strong>Your browser</strong>Holds every secret. Trusted for everything.</li>
  <li><strong>The origin's code</strong>Runs as the device. Trusted not to ship a hostile script.</li>
  <li><strong>Validator, Railway</strong>Hold ciphertext and see metadata. Trusted for availability.</li>
  <li><strong>Set curator</strong>Decides tree membership. Trusted, auditable, not trustless.</li>
  <li><strong>Neynar, the chain</strong>See every Farcaster account Totem manages. Trusted with linkage.</li>
</ol>
<p class="flow__note">Read left to right as "from what you control to what you do not".</p>

## Who must be trusted, for what

| Property | Rests on | Today |
|---|---|---|
| Your vault stays unread | your browser; the app's origin serving no hostile script; for a synced PRF passkey, the provider not colluding with the validator's operator; for a wrap-path passkey, the release secret and the blob staying apart; during a device or root link, the validator | holds on the public preview under those conditions; the origin has no content security policy beyond `frame-ancestors 'none'`, and linking trusts the validator (see [Browser custody](/mechanism/custody#linking-a-device)) |
| Your writes are yours | your device key and its delegation; the validator checking the chain and the counter | holds |
| Your account stays reachable | the validator, Railway, your saved method, or the 24 words | the 24 words are the escape hatch |
| A persona's root stays hidden from the validator | a non-colluding relay, a live universe of 50 or more roots, an honest set curator, and the seed not held by the validator's operator | not met anywhere; the label says DEMO |
| Your personas look unrelated on Farcaster | Neynar, the onchain registration and key-request records, and your own behaviour | Neynar sees every managed account; the onchain records are unread |
| What you read on the public site stays private | the app server's operator and Railway | it does not: the relay discloses reads to the operator |

Sources: {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'} {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"} {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

## The public preview

| Party | Sees | Can do | What stops it | Source |
|---|---|---|---|---|
| Your browser (the device) | everything: the seed, every key, the vault in the clear, the search index | anything you can | nothing; it is you. Any script on the origin can do what the page can | {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"} |
| The app server | page requests; relayed reads with address, time and argument; passkey assertions for the wrap path | serve a hostile page, which is the device; refuse to release a wrap-path KEK; read what each address looks up | it holds no seed and no vault key; it serves no third-party script; a hostile page is not stopped by anything but review of what is deployed | {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |
| The validator's operator | ciphertext records and their sizes in 1 KiB steps; anchors, delegations, persona public keys; commitments and trees; persona ids on proofs; stake rows; hour-grained timing; root-link anchor pairs | withhold, delete or roll back records; curate tree membership; correlate a device's personas by address and timing; during a device or root link, substitute its own device and receive the vault key, the ZK master and every persona's key leaves | AES-256-GCM with associated data; signed envelopes and counters; pin files that turn a deletion into a refusal; device-pinned validator key and history anchor. Nothing stops the link substitution: the 32-bit fingerprint can be ground by the relay that mints the code | {cite: SECURITY-POSTURE.md > "2. What the operator can still do"} |
| Railway (the platform) | every request's address and path; the validator's volume and its backups | read or alter what it hosts; take the service down | the volume holds ciphertext and public state; TLS ends at its edge, so it is in the trust base for metadata and availability | {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"} |
| Neynar (read key, dormant) | the app's aggregate cache misses | answer reads, or refuse them; a leaked key can burn the account's credits | a second app with no signers or wallet; a daily credit budget; rotation at Neynar | {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |
| Your passkey's platform (Apple, Google, a password manager) | that a credential exists for this site | for the PRF path, produce the PRF output, and so the KEK | the platform's own security; the 24 words work without it | {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"} |
| Authors of live posts | the address of anyone whose browser loads their embedded image | track who viewed a post | no referrer, lazy loading and click-to-load outside an allowlist are specified for live cards | {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |
| Other visitors | from cache timing, that someone opened the same live thread or profile recently | probe, at the cost of their own rate tokens | every lookup spends a token, hit or miss | {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"} |

## The owner service

| Party | Sees | Can do | What stops it | Source |
|---|---|---|---|---|
| The owner (operator, user and only root) | everything | everything, as every persona | nothing; there is no third party to hide from | {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"} |
| Railway, and anyone in the owner's Railway account | the owner's seed, device key and envelope counters on the app volume | act as every persona, including the live Farcaster accounts | nothing in this codebase; the volume is not encrypted by it | {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"} |
| Whoever holds the passphrase | everything the owner sees | post as every persona, reveal the 24 words, use the developer controls | login metering (about 360 guesses an hour at most); Sign out everywhere, removing a passkey and rotating the passphrase revoke sessions server-side; a registered Face ID / fingerprint is an alternative to the passphrase, not a second factor | {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"} |
| Anything else in the owner's Railway project | the owner validator, over the private network | use its open developer routes | the rule that the project holds these two services and nothing else | {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"} |
| Neynar (write key, managed signers) | every persona account it created or signs for, every write, and every anon cast. A distinct key for the anon relay (a third Neynar app) stops only a join by credential; Neynar the company serves both keys and can still join by account, address and timing | write as any persona account; join all of them | nothing technical; self-custody signers are a later pass | {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"} |
| Farcaster hubs, other clients | each persona account's casts, follows, likes, fname, custody address and registration time | link accounts by behaviour, timing and creation | the owner's own restraint; the act-as picker warns that two own accounts interacting is public | {cite: SECURITY-POSTURE.md > "What is hidden, from whom"} |
| The chain (Optimism) | registration, rent payer, transfer sender, and each key request's requesting fid | cluster every account a developer registered, if those are developer-unique | the registrant is developer-unique (read 2026-10-07): accounts from one app wallet cluster with each other and with the Totem-named test account; the request fid (6131) and the recovery proxy are shared and cluster nobody; the rent payer is unread (VERIFY-YOURSELF F21) | {cite: VERIFY-YOURSELF.md > "F21 — The registrant rule was never read from the chain (HIGH; one lookup decides it)"} |
| The reference issuer | the wallet addresses it checks and the exact facts | vouch falsely; map address to commitment | clients honour issuers by key; in this deployment the issuer is the owner's own process | {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"} |
| Blockscout, Snapshot, public RPC nodes | the wallet addresses the issuer looks up, from the issuer's host | log them | nothing; a self-hosted node is the product answer | {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"} |

## Rings, reach tiers and launch (built, test data only)

Persona launch wave 2 adds four parties. These pieces were deployed on 2026-10-12 and have only run on test data; each row is what the code and its posture section say.

| Party | Sees | Can do | What stops it | Source |
|---|---|---|---|---|
| The validator's operator, as the ring drop | which registered device publishes, when and its padded row count, and at rest which devices have ever published; a revoke as one delete; every reader's address on every tick | withhold the drop; re-serve a deleted, unexpired envelope until its lease | fixed-size rows with no writer column; hints keyed by a PSK it lacks; a withheld read hides merges and drops nothing; a sequence number stops an old envelope overriding a newer one | {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"} |
| A ring member | the personas and anon posts its ring was given, from the generations it was sent | pass on a claim, not a proof; seal a note naming your persona onto its own anon post for the rest of the ring; keep the keys it already had after a revoke | no signature, so a leak proves nothing; a revoke or a lowering starts a fresh key chain for future posts, and an add steps the chain forward so a newcomer cannot open older posts; the in-ring forge is not stopped (v1.1) | {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"} |
| The reach issuer | fid to commitment at issuance: who is in each tier | vouch falsely; know every tier's members | clients honour it by exact id and key; it runs only on a host Totem runs, never in a visitor's browser (D-REACH-ISSUER-HOST-ONLY); the crowd floor of 50; it never sees which post a member made | {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"} |
| The Totem registrar (simulated) | a launch request's public fields as it arrives (no arrival hour is stored); the device's address on the batch reveal | delay or drop a launch; choose the batch | the request names no root, device or sibling; the recovery key is root-derived, so it cannot seize the account; every reader checks the reveal against the key registry | {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"} |

## Anonymous posting from the public site, and Totem on X (built, test data only, not deployed)

Persona launch wave 3 adds three parties and changes what the origin's code is trusted with.

| Party | Sees | Can do | What stops it | Source |
|---|---|---|---|---|
| The origin's code, as the browser prover | the secret scalar of each job it proves, inside your tab | anything the page can; a hostile `prover.js` could send the secret out | the worker is same-origin, gets one job and is terminated; it checks the proving files against pins bundled into it, and makes no other request; a hostile script from the origin is stopped only by review of what is deployed, as for the device itself | {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} |
| The validator's operator, as the web channel's receiver | under the direct relay, each anonymous post's internet address, the browser's user-agent and client hints, its time and its test-universe envelope | correlate a poster's address and browser across posts; refuse or drop posts | a fixed 4,096-byte body with no cookie, referrer or device header; an outside OHTTP relay would hide the address and browser, and none is deployed, so the label stays DEMO | {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} |
| An OHTTP relay (none deployed) | the tab's address and browser headers, the time and the ciphertext's size | withhold or delay posts | it sees only ciphertext; "third party" is the operator's word, not a check | {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} |
| The X outbox's moderator (the owner) | every copy's words, rejected ones included | approve or reject any copy; nothing posts without a decision | the copy names nobody; decisions are signed and kept; a rejected copy is kept and hidden, never shown again | {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"} |

## Supply chain

| Component | Trusted for | What checks it | Source |
|---|---|---|---|
| The Semaphore v4 ceremony | soundness of every live proof | the CDN zkey matches the ceremony's published final zkey; 386 contributions parsed; an independent contributor's hash present; `snarkjs zkey verify` not completed | {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"} |
| `snarkjs` 0.7.5 | verification on both sides, and, since Persona launch P7, proving in a visitor's browser (`/device/prover.js`, GPL-3.0) | pinned; both sides run the same library, so they are not independent evidence; in the browser the proving files and the verification key are checked against pins bundled into `prover.js` | {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"} {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} |
| `@noble/hashes`, `@noble/ciphers`, `@noble/curves` | HKDF, SHA-256, AES-GCM, Ed25519, secp256k1 | the cited design record names one audit, Cure53's of `@noble/ciphers`; one implementation serves Node and the browser, so the bytes on the wire are meant to be identical (D-CU-0-1). No audit of `@noble/hashes` or `@noble/curves`, and no test that checks the bytes both ways, is cited here | {cite: custody-model.md > "The key hierarchy does not change; its home does"} |
| `@hpke/core` | device and root linking; OHTTP | RFC 9180 test vectors; no formal third-party audit on record | {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"} |
| An OHTTP or Tor relay | hiding the submitter's address from the validator | not deployed; when it is, "third party" is the operator's attestation, not a check | {cite: SECURITY-POSTURE.md > "3. What is ASSUMED, not verified — by VERIFY-YOURSELF id and by review"} |

## What no party here can be trusted to do

These are the gaps that no row above closes.

- **Hide that two of your accounts interact.** Replies, likes and follows between your own accounts are public on Farcaster.
- **Forget.** A revealed anon post, a grant a friend has seen, a reading any operator logged: revocation is forward-only everywhere.
- **Survive a stolen seed.** The 24 words are the whole identity, retroactively, including the ZK history. {cite: notes/reports/REPORT-CRYPTO.md > "THREAT MODEL (stated plainly, per the spec)"}
- **Make the ZK claim true on a one-person service.** One root is a crowd of one, and its operator holds the seed. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}

## Where it lives

The posture document is the source of every row: `SECURITY-POSTURE.md`, sections 2, 3, 8, 13, 14, 16, 18, 19, for rings, reach tiers and launch 24 to 26, and for anonymous posting from the public site and the X outbox 27 and 28. The design record for custody is [Custody model](/custody-model). The operator's view, section by section, is on [What the operator can still do](/privacy/operator).
