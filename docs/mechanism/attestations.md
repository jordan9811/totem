# Attestations and issuers

An issuer vouches that your root holds a coarse fact, such as a wallet older than two years or at least 1 ETH. Later a persona proves it holds that bucket, and neither the issuer nor the validator learns which persona proved it.

::: warning Status: built, test data only
The open issuer interface and the `onchain.*` reference issuer are built, and the pass closed after three adversarial reviews and four consecutive clean sweeps (427 of 427 checks). The one read-only run against real chain data found that the test wallet supported no bucket. The reference issuer runs inside the app process, beside the user's keys, as a stand-in for a separate party. Nothing gated on an attestation is live on any deployment, and the floor that makes a bucket honourable needs 50 roots in it. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
:::

The verdict: the interface is the right shape. Trust is not part of the protocol: anyone can register an issuer, and each client decides which issuers it honours, by public key. Buckets are coarse on purpose, each bucket is its own membership tree with the same floor and churn rules as a tier, and the validator stores that an issuer vouched for a commitment under a bucket, never the value behind it. The weak point is the deployment, not the design: the issuer is co-hosted with the subject, so today "the issuer" and "the user's device" are one process. {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"}

## At a glance

<ol class="flow">
  <li><strong>Register</strong>An issuer posts its id, Ed25519 key, claim schema, buckets and validity.</li>
  <li><strong>Issue</strong>The issuer checks your facts and signs one issuance per bucket they support.</li>
  <li><strong>Trees</strong>Each bucket becomes a membership tree, built per epoch like a tier tree.</li>
  <li class="flow__us"><strong>Prove</strong>A persona proves membership in a bucket of an issuer your client honours, by key.</li>
  <li><strong>Gate</strong>A mode, filter pack or ad audience predicates on what was proved this epoch.</li>
</ol>
<p class="flow__note">The proof is the same Semaphore proof as a tier proof, with the issuer bound into the message, so a bucket proof is not reusable as a tier proof.</p>

## The interface

An issuer is a namespaced lowercase id (up to 48 characters, for example `onchain.wallet-age`), an Ed25519 key, a claim schema, the buckets it emits (ids up to 32 characters) and a validity in epochs. Registration on the validator is self-signed under the issuer's key: possession of the key is the whole of registration. The same id under another key is refused (409), so a key rotation is a new id. A universe holds at most 128 issuers. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}

**Honour by key.** The registry is open and first-come, so an id proves nothing. A client honours issuers through `ATTEST_HONORED_ISSUERS` (default `onchain.*`), and a pattern can pin a key, `onchain.*@<pubkey>`, which matches only when the issuer's registered key is that key. Every reader honours by key: the gate, the proven map, the label, the backpack. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## The reference issuer's buckets

| Issuer | Buckets | Validity |
|---|---|---|
| `onchain.wallet-age` | first transaction older than 1, 2 or 4 years (`gt1y`, `gt2y`, `gt4y`), the oldest of your bound wallets | 28 epochs |
| `onchain.holdings` | ETH held at the snapshot, summed over bound wallets: at least 0.1, 1 or 10 | 4 epochs |
| `onchain.protocol-history` | interacted with Aave, Morpho, Compound or Uniswap before the issue epoch | 28 epochs |
| `onchain.governance` | Snapshot votes, summed: at least 1, 5 or 20 | 28 epochs |

An exact balance or a first-transaction time is a fingerprint; a bucket shared by fifty roots is a set. Expiry is quantized to the issue epoch so every issuance of an epoch expires together, and activation and expiry are quantized to `ATTEST_ISSUE_WINDOW` epochs (default 1) on both processes. A late submission is refused: the issue epoch must be the current one. One wallet vouches for one root, and the batch a subject submits is signed by its device-auth key. {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"}

## Who learns what

| Party | Learns | Kept from it |
|---|---|---|
| The issuer | the subject's commitment, the wallet addresses that signed its challenge, and the exact facts behind them; it keeps a salted hash of each address so it can revoke | which persona later proves the bucket {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"} |
| The validator | that issuer I vouched for commitment C under bucket B, from epoch E to epoch X, with a nonce-salted claim hash and the issuer's signature; when a persona proves, that persona P proved bucket B this epoch | the claim value, any wallet address, how many wallets a root bound |
| A subscriber | that a persona is in bucket B of an issuer it honours, this epoch, and only if the bucket clears the floor | anything finer than the bucket |

The claim hash covers a 32-byte nonce the subject holds, so the small space of bucket values is not a dictionary.

## The reach issuers

Persona launch P5 adds two issuers behind the same interface, sharing one family key, `reach`, each honoured by its exact id plus that key: `fc.reach` (followers of the root's own main Farcaster account, buckets `gte-1k`, `gte-10k`, `gte-100k`, nested; a Neynar score of 0.7 to enter; one account per root; 8 epochs) and `x.reach` (the X handle that account verified on Farcaster; fixture only, since a live count needs an xAI key). Their bucket trees are the trees an anonymous post may prove instead of the plain anon tree, for the For You boost. Built, test data only, tested on the rig and deployed 2026-10-12. In the public site's browser device both refuse to register or issue (D-REACH-ISSUER-HOST-ONLY), because there the issuer key would be the visitor's own and could claim the open registry's id; on the public preview they wait for an issuer Totem runs. See [Reach tiers and the crowd floor](/mechanism/reach-tiers). {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## The floor, applied to buckets

A bucket is a tree, `attest:<issuer>/<bucket>`. The client counts its served leaves, rebuilds the signed root from them, and refuses to prove into any bucket with fewer than 50 members, with the same churn limit as a tier. A bucket below the floor is honoured nowhere: not by the feed, a mode or an ad audience. Two more client-side rules came out of the review: every honoured bucket tree is fetched on every tick, so fetching one is not a beacon, and the client keeps, per persona, the intersection of every attestation tree it has proven into and refuses a proof that would shrink that intersection below the floor. An attestation-gated surface carries a ninth label condition: the bucket clears the floor on the tick's census and its issuer is honoured. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## Revocation

An issuer revocation drops exactly one leaf at the next epoch, and it cannot be replayed away: re-posting the original signature does not undo it, and a re-issuance must carry a later issue epoch. The persona whose claims stop that epoch is visible as the one that stopped, the same class of leak as any revocation at an epoch boundary. "Revocation as no-renewal", where a leaf leaves with its window's cohort, is the quieter design and is not built. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## What this does not protect

- **A co-hosted issuer.** The reference issuers run inside the app process with their signing key beside the user's keystore, and the four `onchain` issuers share one key. Whoever holds that host holds address-to-commitment for every wallet it bound. In a product the issuer runs on its own host and clients pin its public key. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}
- **The data sources.** The live adapter reads Blockscout, Snapshot and keyless public RPCs, and sends the wallet address to them from the issuer's host. The tracked contract list per chain is fixed; a wrong or missing address under-reports and never over-reports. A self-hosted node or indexer is the product answer. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}
- **A commitment's profile.** Bucket member lists are public, because the client's cohort check needs the leaves, so a commitment's full set of buckets is public. The commitment is a root-level pseudonym; the floor, the budget and the running intersection guard the step from persona to commitment.
- **Small cells.** At an issue window of 1, an epoch with few issuances is a small cell. A deployment raises the window on both processes to merge cells.
- **`neq` predicates.** A prover picks the persona id it proves for, so "does not hold" audiences are advisory.
- **Retirement.** An issuer cannot retire an id or announce a compromised key in the protocol; subscribers un-pin the key. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## The obvious questions

### Who decides which issuers count?

Each client, by key. The default honours the `onchain` family under the key its own co-hosted issuer holds, which is why another device's onchain issuer is a different issuer from your device's point of view.

### Does the validator learn my balance?

No. It learns that an issuer vouched for your commitment under a bucket such as "at least 1 ETH", and when a persona proves it, that the persona holds that bucket this epoch. {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"}

### Is the test issuer ever honoured?

`test.mock-issuer` is an issuer like any other whose verification is vacuous. Fixtures use it; a product client does not honour it. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}

## Where it lives in the code

- `lib/attest/types.ts`, `lib/attest/ids.ts`: the issuer interface and id rules.
- `lib/attest/subscriber.ts`: honour by key. `lib/attest/proven.ts`: the per-epoch proven map surfaces read.
- `lib/attest/chain/live.ts`: the live chain adapter and the tracked contracts.
- `validator/zk.js`: the registry, issuances and `attest:` trees.
- Design record: [Issuers](/technical/issuers).
