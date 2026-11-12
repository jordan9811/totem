# Launch and the registrar

Launch turns a persona into its own Farcaster account: an anonymous request to a Totem registrar, an account created 2 to 48 hours later at a random time, then one batch reveal of every anonymous post the persona made, signed by the key that account registered, so anyone can check it.

::: warning Status: built, test data only, against a simulated registrar
<span class="st st--test">Built, test data only</span> on the laptop rig, deployed 2026-10-12 and not yet used on a deployed site. The registrar and the chain are SIMULATED: nothing is created on Farcaster, every spend row is $0 and no network is called. <span class="st st--soon">Coming soon</span> on the public preview, which says "Launch isn't on this preview yet.": anonymous posts made there (built in wave 3, test data only, not deployed) stay inside the preview, and launching from there needs the Totem registrar. On the owner's live universe it says "Launch needs the Totem registrar, which isn't set up yet." {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
:::

The verdict: nothing at the click and nothing in the request names the root, a device, the persona id or a sibling; the chain sees "made by Totem", never "made by you"; and a reveal is believed only when the signer is a registered key of the account. The costs are stated before the confirm: the reveal is permanent and all at once, it shows the windows the persona posted in and the reach tier its posts proved, and in a quiet week a batch can hold one launch. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## At a glance

<ol class="flow">
  <li><strong>Preview</strong>Device-local: every anon post it will link (your sealed records joined to the device's own-rows mirror of the complete public list), what that narrows, what stays hidden. It writes and fetches nothing.</li>
  <li><strong>Confirm</strong>After the no-undo line, type the handle. The request is built and signed in memory; nothing is written or sent at the click.</li>
  <li class="flow__us"><strong>Request</strong>At a later tick: a one-launch-per-person-per-window proof over <code>/zk/anon/submit</code>, 4,096 bytes, no device headers.</li>
  <li class="flow__us"><strong>Register</strong>The registrar's batch, 2 to 48 hours later: one Bundler call per account; one $0 spend row per batch that registered one (simulated).</li>
  <li><strong>Reveal</strong>One batch reveal signed by the new key; then the name, the profile, one launch post and up to 10 quotes, at the current time.</li>
</ol>
<p class="flow__note">Each step after the confirm runs at its own jittered tick, so no two of them line up with each other or with the registration. After launch the persona's post mode is a required choice, preset to anon.</p>

## The privacy rules, and where each is enforced

| Rule | What it says | Built as |
|---|---|---|
| R1. Totem registers the accounts, not you | a fresh Totem registrar wallet pays; the persona's own derived custody key signs Register and Add; one registrar app fid vouches every key; recovery is a second root-derived key | simulated: `validator/simchain.js`, app fid 7,000,000; the live wallet is the owner's O1 |
| R2. Random creation timing | the account appears 2 to 48 hours after the click | a batch moment in [arrival + 2 h, arrival + 47.5 h], batches 12 to 36 hours apart at a keyed-random hour |
| R3. The request carries no identity | anonymous channel, one launch per person per window, not device-signed | claim kind `persona-launch`; a device header is refused |
| R6. A tier needs a crowd | a reach tier is offered only with at least 50 accounts in it | [Reach tiers](/mechanism/reach-tiers) |
| R7. Reveal is permanent and all at once | every anon post of the persona, in one event, signed by its registered key | `revealBatch`, all or nothing |
| R8. Ring notes are uniform | a fixed 256-byte note on every anon post | [Rings and ring notes](/mechanism/rings) |
| R9. Your accounts never touch | the self-link guard; the launch quotes are the one exception | at most 10 quotes, own revealed originals only {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"} |

{cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## The request

The request carries the persona's derived custody address (`fc-custody/<nonce>`, the account's owner), its derived recovery address (`fc-recovery/<nonce>`), its derived Ed25519 signer key (`fc-signer/<nonce>`), the chosen name and profile, and two EIP-712 signatures by the custody key (IdGateway Register, KeyGateway Add). Their deadline is quantized to a 7-day boundary at least 4 days after the click's day, never the click time or its day, which a signature would publish for good; the registrar refuses any other deadline. A batch whose window crosses a 7-day boundary can still be split in two by it (A-LAUNCH-DEADLINE-WEEK). Its canonical form is at most 2,048 bytes, and `sha256("layers-launch-request/1|" + request)` is bound into the proof's message, so the request cannot be swapped after proving. The validator queues it inside the nullifier's transaction: nothing is queued without its nullifier, and no nullifier is spent without its queue row, except a repeat for a custody the registrar already holds, which is accepted with no new row. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

At the click, the pending launch is a record in the sealed `zkQueue`, written on that namespace's own deferred schedule like an anon post's reveal secret: a write of its own at the click would be the beacon the random timing exists to hide. The preview fetches nothing: it reads the own-rows mirror of the complete public anon list that every device's tick keeps (fix W2-LAUNCH-REVEAL-200; the newest-200 list it first read left older posts out), so previewing and walking away leaves no trace. It reports how far the posts narrow the persona as the intersection of their crowds, exact where it can be counted and otherwise "at most N, possibly far fewer"; below the floor, or unknown, the confirm needs an explicit acknowledgement (fix LP-4), and the confirm needs a preview opened in the last 30 minutes. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## The registrar

Each accepted request is due at a batch moment drawn uniformly with a CSPRNG from those inside [arrival + 2 h, arrival + 47.5 h]. Batch moments come once a simulated day, at an hour in [06:00, 18:00) keyed by an HMAC of the validator's private signing key, so two batches are 12 to 36 hours apart and the window always holds one; nobody outside the operator can predict the hour, though the signing key sits in the database, so whoever holds a snapshot of it can recompute the hours. With the device's jittered send, the account appears 2 to 48 hours after the click. The simulated Bundler call registers the fid to the custody address with its recovery address, adds the signer key and rents one storage unit, verifying both signatures as the contracts would. The registrar refuses to register if its app fid equals `FC_TEST_FID`, `FC_ANON_FID` or `FC_CONNECT_APP_FID`; that is checked at each batch, not at boot, so requests are still accepted and wait. Each batch that registered an account writes one `registrar_spend` row with `usd_cents` 0. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

Every device that runs the test universe (the server device of the rig or of a service on test data) makes the same two public reads on every tick, launch or not: the registrations list (with each account's active signer keys) and the complete anon list, paged. A browser device, where launch is not offered, makes neither. It looks for its own custody address and keys locally and never asks about one account to spot its registration (fix LP-1); after the reveal it does read per account (the thin relay's key check, the history, the self-link guard). No arrival hour is stored with the request (fix LP-6); the launch's nullifier row keeps its 6-hour epoch, not beside the fid. Past the 48 hours promised, a launch keeps watching rather than failing; once it has waited 72 hours after the registrar took it with no account, it may be launched again, and the registrar takes a repeat for the same custody without a second row. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## The batch reveal

```
canonical = "layers-anon-reveal-batch/1|<mode>|<fid>|<signerPubKey>|sha256(sorted cast hashes joined by ',')"
```

Signed by the persona's derived signer, exactly the key the Bundler call added, and sent once as `POST /zk/anon/reveal {batch: true, …}` over an isolated socket. The validator checks the signature and that the signer is an ACTIVE key of the fid on the (simulated) KeyRegistry, then, in one transaction, every secret against its row's commitment; the first account to reveal a row keeps it. It stores the batch in `zk_reveal_batches` and its hash on every row (`zk_anon_casts.attributed_batch`). The items are every cast this device holds a sealed record for as this persona, and none of its siblings'. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

A reader renders "revealed from @anon · @fname" only when the signer is a registered key of that fid on the chain (checkable, `chain`); otherwise the own-device rule applies, else plain anon. A chain read that fails falls back to the own-device rule (on the launching device the card reads "anon · revealed as @name (inside Totem only)"; elsewhere it is plain anon), and a row forged straight into the database renders anon. This closes A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY on the simulated chain only; on the real network it waits for the live key-registry read (F25). {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## History and after

On Farcaster, at the CURRENT time (D5): one launch cast linking the proof page, then up to 10 quotes of originals picked in the preview, only from this launch's revealed batch. Backdating is possible on Farcaster but proves nothing, is pruned first and sits before the account's own registration. Inside Totem the profile shows the whole revealed history at the original dates, labelled "revealed from @anon", row by row only where a check passes: the chain check, or on the launching device the own-device rule. The proof page (`/proof/<fid>`) shows the batch, the signer key, the signature and the key-registry check from public reads only (the reveal batches, the public anon list, the simulated chain), so opening it mints no root. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

After launch the persona's post mode is a required choice, preset to anon. `direct` posts are signed by the account's own key and forwarded by a thin relay, which can drop a message but never forge one: a wrong key, a removed key, a bad signature or a timestamp more than 10 minutes from now is refused. Going back from direct to anon is weak once your style is public, and the screen says so. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## Assumptions

| Id | What it means |
|---|---|
| A-LAUNCH-WINDOW-OCCUPANCY | Revealing shows which windows the persona posted in; in those windows the root's other personas had fewer slots left. The preview says so. |
| A-LAUNCH-REVEAL-IP | The reveal and the registrations read go direct over an isolated socket, and the name proof over the app's ordinary connection; none goes through OHTTP, and the operator sees the device's address on the reveal. |
| A-LAUNCH-ADD-METADATA-ORDER | On the real chain the registrar app must sign its key-request metadata before the device signs Add: a second anonymous round trip or a published vouch, not built. |
| A-LAUNCH-BATCH-OF-ONE | A quiet week's batch can hold one launch, which narrows its timing to that batch. |
| A-LAUNCH-TIER-NARROWS | The revealed posts' reach tier puts the launched account in that tier's crowd. The preview says so. |
| A-LAUNCH-THIN-RELAY-CAP | A launched account's writes are bounded by the network's 200 messages per storage unit per day, not by `FC_CASTS_PER_DAY`. |

{cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## What going live needs

The owner's O1: a fresh Totem registrar wallet with ETH on Optimism from an exchange withdrawal (never the Neynar App Wallet), a registrar app fid that is none of the connector, anon or test fids, the live Bundler call, the live KeyRegistry read (F25), the live fname server, a live thin relay, and the add-key order above. `LAYERS_REGISTRAR_PRIVATE_KEY` is in `MUST_NOT_SHIP` on both halves, and nothing reads it this wave. A price per launch (about $5) waits for prepaid credits that do not tie the payer to the persona. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(j) Persona launch, wave 2: rings, reach tiers and launch (test data; what going live needs)"}

## Where it lives in the code

The preview, confirm, request, reveal, history and tick: `lib/launch/*`. The registrar and its sim clock: `validator/registrar.js`; the simulated chain and fname server: `validator/simchain.js` (migration 25). The chain reader seam: `lib/fc/chain/*`. The thin relay: `lib/fc/thinRelay.ts`. The self-link guard's exception: `lib/fc/writes.ts`. The screens: `app/(main)/launch/[personaId]`, `components/launch/*`; the proof page: `app/proof/[fid]`. The route: `app/api/launch/route.ts`. Tests: `scripts/unit-launch.mjs`, `scripts/accept-launch.mjs`, `validator/test/registrar.test.js`.
