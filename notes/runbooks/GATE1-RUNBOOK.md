# Gate 1 runbook — throwaway FID acquisition, verified fact sheet

Companion to `scripts/gate1-acquire-fid.mjs`. Every claim below was verified
against the Neynar MCP docs server (docs.neynar.com, including its mirror of
the Farcaster protocol docs under `/farcaster/`) or the hub-monorepo source,
on 2026-08-28/29. Sources are named per claim, notes/runbooks/NEYNAR-CONTRACT.md style.
Items the docs did not confirm are flagged **UNVERIFIED** — the script treats
each one defensively rather than guessing.

Gate 1 is TABLED on a money decision (notes/reports/REPORT-FC.md §GATE 1). Nothing in this
file or the script spends anything until the user answers Option A or B below
AND runs the script with `GATE1_CONFIRM=yes`. Default runs are dry runs that
print the cost sheet and exit.

## What the user must do first

**Option A — Neynar-sponsored (preferred, fastest):**

1. Log into [dev.neynar.com](https://dev.neynar.com), select the app.
2. "App Wallet" tab → activate a wallet
   (docs: `docs/managing-onchain-wallets`).
3. Fund that wallet with **$5+ of ETH on Optimism mainnet** (docs require this
   before the first fresh-FID call; the surplus stays yours).
4. Put the wallet id in `.env.local` as `NEYNAR_WALLET_ID` (treat it like a
   secret, per the docs).
5. `npm install --save-dev viem` (see Dependencies below).
6. Dry run: `node scripts/gate1-acquire-fid.mjs neynar`
   Execute: `GATE1_CONFIRM=yes node scripts/gate1-acquire-fid.mjs neynar`
   (PowerShell: `$env:GATE1_CONFIRM="yes"; node scripts/gate1-acquire-fid.mjs neynar`)

**Option B — direct onchain from a burner:**

1. Create a fresh burner EOA (never a real wallet) and fund it with a few
   dollars of ETH **on Optimism mainnet**.
2. Put its private key in `.env.local` as `OP_BURNER_PRIVATE_KEY`.
3. `npm install --save-dev viem`.
4. Optional: `OP_RPC_URL` (defaults to viem's public Optimism RPC);
   `GATE1_ETH_USD` if the Coinbase spot-price read is unreachable.
5. Dry run: `node scripts/gate1-acquire-fid.mjs onchain`
   Execute: `GATE1_CONFIRM=yes node scripts/gate1-acquire-fid.mjs onchain`

Either path: `FC_TEST_FNAME` optionally overrides the generated
`layers-test-xxxx` fname (regex `/^[a-z0-9][a-z0-9-]{0,15}$/`, per
`docs/how-to-create-a-new-farcaster-account-with-neynar` → farcaster/core).
`node scripts/gate1-acquire-fid.mjs verify` re-runs the read-only
verification (`GET /v2/farcaster/user/bulk?fids=FC_TEST_FID`) at any time.

## Dependencies (checked in this repo, 2026-08-28)

- **viem: NOT installed** (not in `package.json`, not in `node_modules`, no
  transitive copy). Both paths need EIP-712 typed-data signatures
  (keccak256 + secp256k1), which Node's built-in crypto cannot produce, so
  the script **detects and instructs** (`npm install --save-dev viem`) and
  exits without side effects instead of crashing.
- **@farcaster/hub-nodejs: NOT installed.** Not needed for acquisition. It IS
  needed for the onchain path's follow-up (activating the username and
  setting display name/bio via hub `UserData` messages — see Option B notes).
- Ed25519 signer keygen uses `node:crypto` (built-in). Node 18+ required
  (global `fetch`); the script checks.

## The 10-minute FID reservation rule (neynar path)

From `reference/get-fresh-account-fid` and `reference/register-account`:

- After `GET /v2/farcaster/user/fid`, the fid must be registered via
  `POST /v2/farcaster/user` **within 10 minutes**, or Neynar may assign it to
  another user.
- The **same `wallet_id`** must be used for both calls; mixing wallets errors.
- **Cold start:** the first-ever call with a new `wallet_id` takes ~1 minute
  (Neynar pre-registers a shelf of FIDs, billed to the wallet); the wallet
  must hold **$5+ ETH on Optimism** before that call. Subsequent calls <1s.

The script timestamps the fid fetch and refuses to POST past minute 9.

## Neynar path — exact endpoints (verified against reference pages)

Auth header: `x-api-key` (current reference; older guide snippets show
`api_key` — record of that discrepancy kept here, script uses `x-api-key`,
the same convention notes/runbooks/NEYNAR-CONTRACT.md verified live).

| Step | Call | Notes |
|---|---|---|
| fname check | `GET /v2/farcaster/fname/availability?fname=` | → `{ available: boolean }` (required). 1 credit. `reference/is-fname-available` |
| Claim fid | `GET /v2/farcaster/user/fid` | headers `x-api-key`, **`x-wallet-id` (required)**. → `{ fid: uint32 }`. Errors: `RequiredField`, `InvalidWalletId`, `InsufficientFunds`. `reference/get-fresh-account-fid` |
| Create managed signer | `POST /v2/farcaster/signer` body `{}` | → `{ signer_uuid, public_key, status }`. `signer_uuid` is **paired with the API key**. 2 credits. `docs/how-to-create-a-new-farcaster-account-with-neynar` + `reference/compute-units` |
| Register | `POST /v2/farcaster/user` | headers `x-api-key`, **`x-wallet-id` (required, same wallet)**. `reference/register-account` |

`POST /v2/farcaster/user` request body (`reference/register-account`, all
wire names snake_case):

- `fid` number **required** — from the claim step
- `signature` string **required** — EIP-712 **Transfer** signature (below)
- `requested_user_custody_address` string **required**
- `deadline` number **required** — unix seconds; guide uses now+3600
- `fname` string optional
- `metadata` object optional — `display_name`, `bio`, `pfp_url`, `url`,
  `username`, `location{latitude,longitude}`, `verified_accounts{x,github}`.
  The script sets `display_name: "Layers dev test"` and
  `bio: "Layers dev test account — automated posts [layers-test]"` here, so
  the profile is test-marked at creation (no separate PATCH needed).
- `signer` object optional — `uuid`, `signed_key_request_metadata_signature`,
  `app_fid`, `deadline` (all required within the object)

Response: `{ success: true, message, user, signers[], signer? }` — signer
`status` enum `generated | pending_approval | approved | revoked`. Error
codes on 400: `RequiredField`, `InvalidSignature`, `FidExpired`,
`InsufficientFunds` (script prints a targeted hint for each).

### The two EIP-712 signatures

**Transfer** (the registration signature — Neynar pre-registers the fid and
transfers it; the RECIPIENT custody key signs). Domain and type from
hub-monorepo `packages/core/src/eth/contracts/idRegistry.ts`:

```
domain: { name: "Farcaster IdRegistry", version: "1", chainId: 10,
          verifyingContract: 0x00000000fc6c5f01fc30151999387bb99a9f489b }
Transfer(uint256 fid, address to, uint256 nonce, uint256 deadline)
```

`nonce` is read live from `IdRegistry.nonces(custody)` (0 for the fresh
throwaway key, but read, not assumed). Note: one docs helper snippet
(`farcaster/reference/contracts/reference/id-registry`) spells the read
`nonce` singular — the account-creation guide and hub-monorepo use
`nonces(address)`; the script uses `nonces`.

**SignedKeyRequest** (vouches for the managed signer's Ed25519 key). Domain
and type from `farcaster/reference/farcaster/signer-requests` and
`docs/mini-app-authentication`:

```
domain: { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10,
          verifyingContract: 0x00000000fc700472606ed4fa22623acf62c60553 }
SignedKeyRequest(uint256 requestFid, bytes key, uint256 deadline)
```

**UNVERIFIED — self-owned `app_fid`.** The guide's signer script signs with
"your application's FID and mnemonic". This project has no app fid, and the
pass prompt forbids accepting any other key, so the script uses the
self-owned form the protocol docs themselves demonstrate (hello-world guide:
one account registers the fid AND signs its own key request):
`app_fid = the new fid`, signature by the new custody key. The onchain
validator provably accepts this; whether **Neynar's endpoint** accepts
`app_fid == fid` at registration time is not stated in any retrieved page.
Handling: if the register call 400s with `InvalidSignature`, re-run with
`GATE1_SKIP_SIGNER=yes` to register without a signer, then attach one via
`POST /v2/farcaster/signer` + `POST /v2/farcaster/signer/signed_key`
(`reference/register-signed-key`; supports `sponsor.sponsored_by_neynar` at a
credit charge).

## Onchain path — contracts and flow

Addresses, all **Optimism mainnet**, from
`farcaster/reference/contracts/deployments` (Neynar-hosted Farcaster protocol
docs; cross-checked against `docs/autonomous-farcaster-agent`, which lists
identical values for the four it names). "There are no testnet deployments."

| Contract | Address | In script |
|---|---|---|
| IdGateway | `0x00000000fc25870c6ed6b6c7e41fb078b7656f69` | register + price |
| IdRegistry | `0x00000000fc6c5f01fc30151999387bb99a9f489b` | idOf, nonces, EIP-712 domain |
| KeyGateway | `0x00000000fc56947c7e7183f8ca4b62398caadf0b` | add signer |
| StorageRegistry | `0x00000000fcCe7f938e7aE6D3c335bD6a1a7c593D` | not called (first unit bundled in register price) |
| KeyRegistry | `0x00000000Fc1237824fb747aBDE0FF18990E59b7e` | not called |
| SignedKeyRequestValidator | `0x00000000fc700472606ed4fa22623acf62c60553` | EIP-712 domain only |
| Bundler | `0x00000000fc04c910a0b5fea33b03e0447ad0b0aa` | not used (needs an app fid for its SignerParams flow) |

Flow (per `farcaster/developers/guides/basics/hello-world`, adapted from
hub-web helpers to plain viem):

1. `IdGateway.price()` — wei price to register, **includes 1 storage unit**
   (`farcaster/reference/contracts/reference/id-gateway`).
2. `IdGateway.register(recovery)` payable with `value = price`, called by the
   burner itself → no Register signature needed (signatures are only for
   registering **on behalf of** another account). Recovery = zero address
   (hello-world default; unrecoverable is acceptable for a throwaway). fid
   read back via `IdRegistry.idOf(burner)`.
3. Ed25519 keypair (node:crypto). Self-owned SignedKeyRequestMetadata:
   `requestFid = own fid`, `requestSigner = burner`, SignedKeyRequest
   signature by the burner — the hello-world flow, where the fid vouches for
   its own key. Metadata ABI-encoded as the
   `(uint256,address,bytes,uint256)` tuple
   (`farcaster/reference/contracts/reference/signed-key-request-validator`).
4. `KeyGateway.add(keyType=1, key, metadataType=1, metadata)` called by the
   fid owner → no Add signature needed for a self-call
   (`farcaster/reference/contracts/reference/key-gateway`: 1 is the only
   supported keyType/metadataType).
5. fname via the **offchain registry** `https://fnames.farcaster.xyz`
   (`farcaster/reference/fname/api`):
   - availability: `GET /transfers/current?name=X` — **404 = available**
     (`docs/autonomous-farcaster-agent`)
   - claim: `POST /transfers` body `{ name, from: 0, to: fid, fid, owner,
     timestamp, signature }`, signature = EIP-712 **UserNameProof** by the
     custody address. Domain from hub-monorepo
     `packages/core/src/crypto/eip712.ts` (the docs defer to
     `makeUserNameProofClaim` without printing constants):

```
domain: { name: "Farcaster name verification", version: "1", chainId: 1,
          verifyingContract: 0xe3be01d99baa8db9905b33a3ca391238234b79d1 }
UserNameProof(string name, uint256 timestamp, address owner)
```

  chainId 1 (Ethereum mainnet) is intentional — same domain regardless of
  where the fid lives. The core source notes the verifyingContract "will be
  the farcaster ENS CCIP contract later".

**Option B known gap (printed by the script, on the record here):** claiming
the fname only *associates* it. Making it the active username AND setting
display name/bio require signed `UserData` messages submitted to a hub
(`farcaster/reference/fname/api`: "still needs a UserData message";
hello-world §5). That needs `@farcaster/hub-nodejs` (not installed) — or
registering the Ed25519 key as a Neynar developer-managed signer and using
`POST /v2/farcaster/message` (150 credits; shape **UNVERIFIED**, live-probe
before relying on it). Until done, the "profile must say test account"
requirement is NOT satisfied on this path; the script exits with a loud
FOLLOW-UP REQUIRED banner. The neynar path has no such gap (metadata set at
registration).

## Price facts as stated in the docs

| Item | Docs figure | Source |
|---|---|---|
| FID registration (total, Optimism) | ~$0.20 | `docs/autonomous-farcaster-agent` cost table |
| Add signer (Optimism) | ~$0.05 | `docs/autonomous-farcaster-agent` cost table |
| Account registration gas | ~$0.10–0.50 | `docs/managing-onchain-wallets` "Gas Costs" tip |
| Storage purchase gas | ~$0.05–0.20 | `docs/managing-onchain-wallets` "Gas Costs" tip |
| fname registration | free (HTTP API, no fee stated) | `farcaster/reference/fname/api` |
| Neynar app wallet funding floor | $5+ ETH on Optimism before first fresh-FID call | `reference/get-fresh-account-fid` |
| `POST /v2/farcaster/signer` | 2 credits | `reference/compute-units` |
| `GET /v2/farcaster/fname/availability` | 1 credit | `reference/compute-units` |
| `POST /v2/farcaster/user` (register) | **no credit cost documented** | absent from `reference/compute-units` |
| `GET /v2/farcaster/user/bulk` | 1 credit × fids | `reference/compute-units` |

Both paths are an order of magnitude under the $10 abort line on documented
figures. The onchain path prices itself live anyway (`IdGateway.price()` +
`eth_estimateGas` + ETH/USD spot) and hard-aborts if the conservative total
(2× gas buffer for OP-Stack L1 data fees) cannot be established under $10;
the neynar path's exact ETH spend is billed inside Neynar's wallet and is
reported as the documented range plus a pointer to the App Wallet tab —
"to the cent" is genuinely not knowable client-side on that path, and the
script says so instead of inventing a number.

## Script safety behaviors (implemented, not aspirational)

- Refuses to run without an explicit `neynar` / `onchain` / `verify` flag.
- Dry-run by default; `GATE1_CONFIRM=yes` required for any billable call,
  and the cost sheet prints first in every mode.
- Refuses to run if `FC_TEST_FID` already exists (no accidental double-spend);
  onchain path resumes idempotently if the burner already owns a fid.
- Never prints private key material; `.env.local` values are parsed but never
  echoed; API failures print response bodies only, never request headers.
- Every API/RPC response is shape-validated before use (missing `fid`,
  non-boolean `available`, malformed signer key, `idOf` still 0 after a
  successful register, etc. each abort with the exact missing thing).
- Success appends a `# THROWAWAY TEST ACCOUNT — Gate 1` block to `.env.local`:
  `FC_TEST_FID`, `FC_TEST_FNAME`, `FC_TEST_ORIGIN`, `FC_TEST_CUSTODY_ADDRESS`,
  `FC_TEST_CUSTODY_PRIVATE_KEY`, plus `FC_TEST_SIGNER_UUID` +
  `FC_TEST_SIGNER_PUBLIC_KEY` (neynar) or `FC_TEST_SIGNER_PRIVATE_KEY` +
  `FC_TEST_SIGNER_PUBLIC_KEY` (onchain) — matching the names the Gate 3
  identity rule (`assertThrowawayIdentity`) checks.
- Verification read (`user/bulk`) retries 5× (retry-adapter-reads rule) and
  reports "not indexed yet" honestly instead of failing open or fake-passing.
