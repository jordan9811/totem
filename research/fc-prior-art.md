# Farcaster-Ecosystem ZK Prior Art (2026 state)

Research date: 2026-08-30. Every load-bearing claim tagged LIVE-CHECKED (URL, date, what it said)
or MEMORY (unverified recollection — treat as a lead, not a fact). Written for the Layers ZK layer:
persona proves root-properties (rep >= T, same-human, not-revoked, holds-attestation) without
persona -> root linkability, browser/mobile proving, bolt-on to existing Ed25519 + adapter seam.

---

## 0. TL;DR verdicts

- **Anoncast is the closest living prior art and it is ALIVE but radically simplified.** After the
  anon.world platform shut down (Jan 2026), Slokh nuked the monorepo history and rebuilt anoncast as
  a minimal app: one Noir circuit proving "wallet I control holds >= X $ANON" via an in-circuit
  ecrecover + Ethereum storage (Merkle-Patricia) proof. **No nullifier, no rate-limit crypto, no
  audit.** Posting goes through a server-held signer on a shared FID — exactly Layers' Gate-4 model.
- **33bits is dead** (site TLS-broken, repos untouched since Nov 2024) but left the single most
  transferable trick: don't verify Ed25519 in-circuit — **register a ZK-friendly hash commitment as
  the "key" and prove preimage knowledge + Merkle membership** (MiMC leaf = H(fid, pubkey), depth-16
  tree mirrored off the KeyRegistry by a trusted backend).
- **Nobody in the ecosystem ever shipped nullifiers, revocation, or reputation-threshold proofs.**
  Every project proved exactly one predicate (token balance or FID-range membership) and leaned on a
  trusted backend for everything else. Layers' property set (rep >= T, not-revoked, same-human) is
  genuinely beyond ecosystem prior art — the prior art solves the *transport* (shared-FID posting,
  browser proving) not the *credential semantics*.
- **Our problem is structurally easier than theirs** wherever they fought Ethereum/Farcaster data
  structures: our Merkle tree is over root commitments WE mint, so we choose Poseidon/ZK-friendly
  leaves at mint time, need no storage proofs, no ecrecover, no KeyRegistry mirroring, and no
  third-party tree-freshness trust beyond our own validator (which is already in the trust model).
- **Ecosystem context shifted under everyone:** Neynar acquired the Farcaster protocol, the Farcaster
  app, and Clanker in Jan 2026 (Merkle Manufactory returned ~$180M to investors). No official
  protocol-team ZK-identity roadmap exists as of this check.

---

## 1. Anoncast / Anon World (Slokh / Kartik Patel) — the closest prior art

### 1.1 Timeline (all LIVE-CHECKED unless noted)

- **Nov 2024** — $ANON token launched via Clanker by an anonymous Superanon user; Slokh ships
  anoncast.org: hold $ANON -> post anonymously to a single shared Farcaster account (@anoncast).
  Repo `Slokh/anoncast` created 2024-11-18 (GitHub API, checked 2026-08-30). Vitalik famously bought
  ANON (Decrypt, Nov 2024).
- **Jan 3, 2025** — Anon World launched: Reddit-like anonymous social platform on Farcaster,
  "ZK-based credentials stored locally in the browser, no metadata or wallet info collected," ERC20
  credentials on Base with "more chains and types of credentials being added very soon" (The Block,
  theblock.co/post/333011, checked 2026-08-30). Proofs took "up to a few minutes" (CoinMarketCap/
  bitkan coverage, checked 2026-08-30).
- **Jan 14, 2026** — **anon.world shut down.** Commit history of `Slokh/anoncast` (via redirect from
  `anondotworld/anonworld`) was rewritten to 8 commits, oldest dated 2026-01-14 02:05 UTC:
  "feat: rebuild anoncast with simplified architecture"; a later commit adds a banner reading
  verbatim **"anon.world has been shut down. anoncast lives on."** linking to anoncast.org
  (GitHub API commits list + commit diff of `shutdown-banner.tsx`, checked 2026-08-30).
- **2026 state** — repo `Slokh/anoncast`, MIT, 142 stars, last push 2026-03-20, not archived
  (GitHub API, 2026-08-30). $ANON trades ~$0.0001 with ~$1.1K daily volume on the main pool
  (CoinGecko/Coinbase price pages, checked 2026-08-30) — token-gate economics effectively dead.
  anoncast.org returned HTTP 404 to a server-side fetch on 2026-08-30 — likely bot-blocking or a
  client-rendered route, but LIVE POSTING STATUS IS UNCONFIRMED (flagged below).

### 1.2 What is actually proven (LIVE-CHECKED: raw `packages/credentials/src/circuit/src/main.nr`,
raw.githubusercontent.com/anondotworld/anonworld/main/..., checked 2026-08-30)

The current (post-rebuild) Noir circuit proves: "an Ethereum address I control held >= verified_balance
of token T at block N" — with the address never revealed.

- **Private inputs:** ECDSA signature (64B), signed message hash, secp256k1 pubkey x/y, MPT storage
  nodes `[[u8;1080]; 5]`, storage leaf (120B), raw storage value.
- **Public inputs:** chain_id, block_number, token_address, balance_slot, verified_balance,
  storage_hash (32B), storage_depth.
- **Constraints:** (1) in-circuit **ecrecover** binds the prover to a wallet; (2) a Merkle-Patricia
  storage proof shows `balanceOf[wallet]` under the token's storage root; (3) verified_balance <=
  actual balance. Helper lib in-repo: bytes/ecrecover/RLP/proof modules (`src/noir-lib/`).
- **The "tree of eligible accounts" is Ethereum's own storage trie** — there is no custom
  eligible-set Merkle tree in the current build. Depth sized for ~108K holders (max depth ~6 MPT
  levels in the circuit constants).

### 1.3 Verifier and trust model (LIVE-CHECKED: raw `verifier.ts`, same repo, 2026-08-30)

- Client-side: `getProof()` pulls the storage proof from an RPC (eth_getProof-style) and proves in
  the browser with Barretenberg WASM (a Jan 2026 commit sets `HOME=/tmp` "for Barretenberg cache" on
  Vercel — bb.js is doing server-side verification there too).
- `verifyProof()` checks ONLY the SNARK against the vkey and parses public inputs
  (balance, chainId, blockNumber, tokenAddress, balanceSlot, storageHash). **It does NOT re-check
  storage_hash against a live RPC in the verifier class, and there is no block-staleness bound** —
  whether the API route pins block recency is unverified (flag).
- **No nullifier anywhere. No cryptographic rate limit.** Same proof is reusable; spam control is
  the token threshold plus whatever server-side throttling exists (unverified).
- **Posting transport:** the server holds the signer for the shared Farcaster account and publishes
  via Neynar API; X crossposting via twitter-api-v2 at a higher token tier (5K $ANON to cast,
  2M $ANON to crosspost per the README; ChainCatcher reported threshold cuts over time —
  30K -> 15K in an earlier era, so numbers moved with the token price).
- **Audit: none found.** No audit mention in repo or any coverage (searched 2026-08-30). MIT license.

### 1.4 The anon.world-era credential system (now unpublished — MEMORY + press only)

The Jan-2025-era monorepo had a richer system: reusable ZK "credentials" minted in the browser and
stored locally, attachable to posts in communities; press confirms local browser storage, no
server-side wallet metadata, ERC20-on-Base as the only launched credential type, multi-minute proof
times, and founder intent to add "more types of credentials" (The Block, bitkan, CoinMarketCap —
checked 2026-08-30). **The history rewrite deleted this code from the public main branch**; GitHub
search for surviving forks of the old monorepo found nothing substantive (checked 2026-08-30).
MEMORY (unverified): the old credential records carried expiry and could be "re-verified" against
fresh chain state, and a "vault" grouped credentials under a persistent anonymous profile — persona-
like. Do not build on this without recovering the old tree (flag: recover via GitHub events/forks or
Wayback if it matters).

### 1.5 What anoncast teaches Layers

1. **Shared-FID + server-held signer + client-side ZK gate is a shipped, socially-accepted pattern**
   — it is exactly our Gate 4 architecture, and it survived two years of use. The anonymity set is
   "everyone who could pass the gate," not the followee graph.
2. **No-nullifier is a real shipped choice** — for pure posting-gates it was enough, because the
   scarce resource ($ANON) rate-limits economically. Layers' rep >= T and not-revoked predicates
   cannot lean on that: we need per-epoch/per-action nullifiers (Semaphore-style) because personas
   are free to mint.
3. **Proof-time is the UX killer they kept paying down**: minutes at anon.world launch; the Farcaster
   ZK-anons writeup credits a rebuild with a ~7.5x proof-generation speedup "enabling mobile access"
   (paragraph.com/@papajams.eth/farcasters-zk-anons, checked 2026-08-30). Their storage-proof +
   ecrecover circuit is heavy; ours (Poseidon Merkle + Poseidon nullifier over our own tree) is one
   to two orders of magnitude smaller. Browser proving is FEASIBLE — they proved harder statements
   than ours in-browser with Noir/Barretenberg on phones.
4. **Complexity died, the minimal core survived**: communities/credential-vault platform shut down;
   the one-predicate poster lives. Ship the smallest provable predicate first.
5. **Token-gating as sybil resistance decays with the token** ($ANON at ~$0.0001 makes the gate
   nearly free). Layers gates on root-level reputation instead — healthier, but it means OUR
   threshold predicate has to carry the whole anti-sybil load the moment it ships.

---

## 2. 33bits / 66bits (Kugusha & Sergey) — dead, but the best trick in the ecosystem

### 2.1 Status: dead

- `33bits-xyz/{app,api,docs}` last updated Nov 22-27, 2024; not archived but untouched since
  (GitHub org page, checked 2026-08-30). **https://33bits.xyz fails TLS entirely**
  (WRONG_VERSION_NUMBER on fetch, 2026-08-30) — hosting/cert gone. 66bits.xyz not re-verified (flag).

### 2.2 Architecture (LIVE-CHECKED: 33bits docs README + raw `circuits/v2/src/main.nr` +
`src/utils/keygen.ts`, checked 2026-08-30)

- **Eligibility set:** backend watches Farcaster's KeyRegistry on Optimism and builds a Merkle tree
  over registered signers, **leaf = MiMC([fid, public_key])**, capped at FID <= 20001 (early
  adopters). Tree depth 16 in circuit v2.
- **The Ed25519 dodge (their key insight):** an early prototype tried Ethereum storage proofs via
  noir-trie-proofs and hit ~2M gates — over browser RAM budget — and EdDSA-in-circuit was rejected
  as too slow (app README, checked 2026-08-30). Instead, `keygen.ts` generates a random 32-byte
  secret and computes **"public key" = MiMC7(secret)** — NOT an Ed25519 key — then submits it
  through a SignedKeyRequest flow so Warpcast/KeyRegistry registers this MiMC commitment in the
  user's signer slot (a registered-but-unusable "read-only" signer). The backend's tree then
  naturally contains MiMC([fid, MiMC(secret)]).
- **Circuit v2 (Noir, nargo 0.17):** private: fid, public_key_preimage, leaf index, path[16];
  public: timestamp, public_key, note_root, message[16], reply[4]. Constrains
  MiMC(preimage) == public_key and Merkle membership of MiMC([fid, public_key]) under note_root;
  message/timestamp/reply are bound as public inputs. **No fid-range constraint visible in the
  circuit itself — the <= 20001 cap appears enforced by which leaves the backend admits to the tree
  (tree-side gating, not circuit-side).** No nullifier in-circuit; `public_key` itself is public, so
  every cast by the same secret is LINKABLE to one anonymous key (a persistent pseudonym per key,
  not per-message unlinkability) — and rate limiting rode on that linkability plus the backend.
- **Casting flow:** browser proof (up to ~2 min), backend verifies vs its own root, backend
  publishes to Farcaster. Trust: backend-honest-about-root, backend-can-censor.

### 2.3 Why it died (assessment, flagged as inference)

No shutdown post found (searched 2026-08-30). Convergent evidence: hobby experiment by two devs;
anonymity set capped at FID <= 20001 (small, and "early adopter" prestige faded); 2-minute proofs;
a backend + tree-mirroring service with real ops cost and zero revenue (66bits' token features were
the monetization attempt); attention moved to anoncast when $ANON hit a $40M market cap (Marty_cFly
X post, Nov 2024, checked 2026-08-30). Died of maintenance-cost-vs-traction, not of a crypto break.

### 2.4 What 33bits teaches Layers

1. **Commit-then-prove-preimage beats signature-verification-in-circuit.** Their MiMC-key-in-the-
   KeyRegistry hack exists ONLY because they didn't control the registry. **We do.** Layers mints
   root commitments into its own tree, so the "register a fake key" contortion disappears: leaf =
   Poseidon(root_commitment, ...) directly, chosen ZK-friendly on day one. This is the single
   clearest place our problem is EASIER than every predecessor's.
2. **Public-key-as-public-input = linkable pseudonym.** Fine for a persistent anon persona, fatal
   for unlinkability across personas. Layers must keep the per-persona public value DERIVED
   (nullifier = H(secret, scope)) rather than exposing one commitment across contexts.
3. **Tree-side gating vs circuit-side predicates:** they enforced eligibility by curating leaves.
   That works when the tree-builder is trusted anyway — for Layers, rep >= T can be tree-side
   (validator only admits/updates leaves with current rep, prover shows membership in the current
   epoch root) OR circuit-side (rep as a leaf field with a range check). Tree-side is cheaper in
   constraints but makes the root a revocation/reputation EPOCH — which we need anyway for
   not-revoked. Their design quietly demonstrates the epoch-root pattern.
4. **Storage proofs in-browser were their dead end** (2M gates) — anoncast later made storage proofs
   work, but only for one slot with heavy optimization. We never need them.

---

## 3. The rest of the field

- **Sealcaster (Big Whale Labs, late 2022)** — first ZK app on Farcaster. Circom; user proves
  ownership of an Ethereum account connected to a Farcaster account (pre-onchain-registry era) via
  the SealCred attestation model, posts from a burner wallet kept in local encrypted storage
  (BWL blog "Introducing Sealcaster" + Bitget overview, checked 2026-08-30). MEMORY (unverified
  detail): SealCred used a centralized attestor that signed EdDSA attestations verified in-circuit —
  i.e., a trusted-issuer credential, not a trustless one. Effectively defunct; the "Applied ZK
  part 3" post 404s content-wise on the current blog (checked 2026-08-30). Company pivoted after
  2023. Lesson: attestor-signed-credential-verified-in-circuit is the cheapest path to arbitrary
  predicates (a Neynar-score gate would work exactly like this) at the price of one trusted signer —
  for Layers, the validator can be that signer for properties it already sees, but persona->root
  unlinkability must then come from the proof layer, not the attestor's discretion.
- **Superanon (woj, 2024)** — anonymous posting via the Supercast client. NOT ZK: trusted-operator
  anonymity (paragraph.com ZK-anons article, checked 2026-08-30). Grew fastest of all of them
  ("primary source of gossip on Farcaster") — proof that the demand is for the SOCIAL feature;
  cryptographic trustlessness was never the growth driver. Layers should not expect ZK rigor itself
  to acquire users; it de-risks the operator.
- **RumourCast (rumourcast.xyz, Disky & Leovido, 2024)** — anoncast-fork-style token-gated anon
  client (Bitget overview Dec 2024, checked 2026-08-30). 2026 status unverified (flag, low import).
- **Semaphore over Farcaster:** searches (2026-08-30) found NO shipped Semaphore/zk-kit deployment
  keyed on FIDs or the KeyRegistry. Semaphore remains the audited reference design for
  membership + nullifier (PSE, audited, v4 with LeanIMT — MEMORY on v4 details, verify in the
  primitives track), but nobody wired it to Farcaster identity. The lane is empty.
- **Neynar score ZK:** none exists. The score is a centralized 0-1.0 API value, recalculated weekly
  (hourly for new users), widely used for app gating in plaintext (docs.neynar.com + Neynar blog,
  checked 2026-08-30). Any "prove score >= X anonymously" must be attestation-based (Neynar or our
  validator signs, circuit verifies) — there is no on-chain slot to storage-prove.
- **Farcaster protocol team / Neynar official ZK:** no FIP, no roadmap item, nothing in snapchain
  docs about ZK identity or private accounts (searched 2026-08-30). Varun Srinivasan discussed ZK
  possibilities on the Zero Knowledge Podcast (ep. 331) — interest, not commitment. Post-acquisition
  (Jan 2026: Neynar took over protocol, app, Clanker; Merkle returned ~$180M — The Block,
  cryptobriefing, checked 2026-08-30) the stated direction is "builder-first" infrastructure, which
  if anything RAISES the odds that identity-layer innovation like Layers is expected to come from
  apps, not the protocol.

---

## 4. Transfer map: their choices -> our design

| Their choice | Verdict for Layers (root/persona model) |
|---|---|
| Shared FID + server signer + client ZK gate (anoncast) | ADOPT — already our Gate 4; prior art proves social acceptance |
| Storage proof + ecrecover in-circuit (anoncast) | REJECT — needed only because their registry was Ethereum; ours isn't |
| Commit ZK-friendly hash, prove preimage + membership (33bits) | ADOPT, simplified — mint Poseidon commitments into OUR tree at persona/root creation |
| MiMC (both) | REPLACE with Poseidon/Poseidon2 (current audited standard in Noir/circom toolchains — verify exact lib in primitives track) |
| No nullifier (anoncast), linkable public key (33bits) | REJECT — free personas demand scoped nullifiers H(root_secret, scope) for rate-limit, same-human, and revocation semantics |
| Tree curated by trusted backend (33bits) | ADOPT with eyes open — our validator already holds this role; publish epoch roots so provers can detect equivocation |
| Eligibility enforced tree-side (33bits FID cap) | ADOPT for rep >= T v1 (epoch roots per threshold tier), circuit-side range checks later if tiers multiply |
| Attestor-signed credential in-circuit (SealCred) | KEEP IN POCKET for Neynar-score and holds-attestation predicates |
| Token-gate as sybil resistance (anoncast) | REJECT — decays with token price; root reputation is our gate |
| Multi-minute browser proofs (all, early) | BUDGET HARD — our circuits are far smaller; target seconds, not minutes; they proved phones can do worse and survive |
| Platform complexity (anon.world communities/vaults) | WARNING — the rich version died, the minimal poster survived; ship one predicate end-to-end first |

Where we are strictly easier: (1) no foreign data structures — no MPT, RLP, secp256k1, or Ed25519
inside circuits; (2) leaf format chosen for the proof system at mint time; (3) the tree-builder
(validator) is already inside our trust model, so "backend honest about root" is not a NEW
assumption — and epoch-published roots make it auditable; (4) our anonymity set (all Layers roots /
all personas above tier) grows with the product instead of being frozen (33bits' FID cap) or priced
in a dying token (anoncast).

Where we are harder: nobody before us needed unlinkability BETWEEN a user's own identities
(persona A !~ persona B !~ root) under an adversarial validator, nullifier semantics tied to
mutable reputation, or revocation that doesn't dox the revoked. Ecosystem prior art is silent
there — that design load falls on the primitives track (Semaphore-family + epoch roots), not on
anything Farcaster-native we can fork.

---

## 5. Flags (uncertain, load-bearing)

1. anoncast.org live posting status in Aug 2026 — server fetch 404'd; repo pushed 2026-03-20.
2. Whether anoncast's API enforces block-recency/staleness on proofs (verifier class does not).
3. anon.world-era credential expiry/vault mechanics — code deleted in history rewrite; MEMORY only.
4. SealCred attestor-EdDSA-in-circuit detail — MEMORY; blog content now unreachable.
5. 33bits rate-limiting specifics and 66bits fate — undocumented; site TLS-dead is confirmed, the
   "why" narrative is inference.
6. 33bits FID<=20001 enforced tree-side not circuit-side — inferred from v2 circuit lacking a range
   check; confirm against the api repo's tree-builder before citing as fact.

## 6. Sources (checked 2026-08-30)

- github.com/Slokh/anoncast (= anondotworld/anonworld redirect): repo API metadata, commits API,
  README, packages/credentials/src/circuit/src/main.nr, src/verifier.ts, commit diff shutdown-banner.tsx
- github.com/33bits-xyz: org page; app README; docs README; circuits/v2/src/main.nr; src/utils/keygen.ts
- theblock.co/post/333011 (Anon World launch, Jan 3 2025); theblock.co/post/386549 +
  cryptobriefing.com/neynar-farcaster-acquisition (Neynar acquires Farcaster, Jan 2026)
- paragraph.com/@papajams.eth/farcasters-zk-anons (ecosystem history: Sealcaster, Superanon, $ANON,
  33bits/66bits, RumourCast, 7.5x proof speedup)
- bitget.com/news/detail/12560604413277 (Dec 2024 ecosystem overview)
- blog.bigwhalelabs.com (Sealcaster intro; Applied ZK part 3 content unreachable)
- coingecko.com/en/coins/anon-2, coinbase.com price page ($ANON ~ $0.0001, ~$1.1K vol)
- docs.neynar.com/docs/neynar-user-quality-score; neynar.com/blog/neynar-scores-under-the-hood
- chaincatcher.com/en/article/2153046 (threshold cut 30K->15K ANON)
- decrypt.co/292783 (Vitalik buys ANON, Nov 2024)
- x.com/Marty_cFly/status/1859661822325862493 (33bits vs $ANON gate, Nov 2024)
- zeroknowledge.fm/331-2 (Varun Srinivasan on ZK Podcast)
- Failed fetches (evidence of absence/death): https://33bits.xyz (TLS WRONG_VERSION_NUMBER),
  https://anoncast.org and https://anon.world (404 to server-side fetch)
