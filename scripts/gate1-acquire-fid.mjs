#!/usr/bin/env node
/**
 * GATE 1 — Throwaway test FID acquisition (Farcaster pass).
 *
 * Acquires a fresh, dedicated THROWAWAY Farcaster account for Totem testing.
 * Two mutually exclusive paths, selected by an explicit CLI flag. The script
 * refuses to run without one.
 *
 *   node scripts/gate1-acquire-fid.mjs neynar    Neynar-sponsored registration
 *                                                (requires NEYNAR_API_KEY +
 *                                                NEYNAR_WALLET_ID in .env.local)
 *   node scripts/gate1-acquire-fid.mjs onchain   Direct IdGateway registration
 *                                                on Optimism (requires
 *                                                OP_BURNER_PRIVATE_KEY)
 *   node scripts/gate1-acquire-fid.mjs verify    Read-only: re-check the
 *                                                acquired FID via user/bulk
 *
 * SAFETY CONTRACT (per notes/prompts/farcaster-live-prompt.md GATE 1):
 *   - Prints an itemized expected cost BEFORE any billable call.
 *   - Hard-aborts if the expected cost cannot be established to be under $10.
 *   - Even under $10, does NOTHING billable unless GATE1_CONFIRM=yes is set
 *     (default run is a dry run that only prints the cost sheet).
 *   - Profile is explicitly marked as a test account.
 *   - Credentials are appended to .env.local under a THROWAWAY-labeled block.
 *   - Private keys are NEVER printed to stdout.
 *
 * Every endpoint, contract address, and EIP-712 domain below was verified
 * against the Neynar-hosted docs (docs.neynar.com, incl. the mirrored
 * Farcaster protocol docs) and the hub-monorepo source on 2026-08-28.
 * Sources are cited inline and in notes/runbooks/GATE1-RUNBOOK.md. Do not edit constants
 * from memory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');

const BUDGET_USD = 10.0; // hard abort line, per notes/prompts/farcaster-live-prompt.md GATE 1

// ---------------------------------------------------------------------------
// Verified constants. Source for each is the doc page named in the comment.
// ---------------------------------------------------------------------------

const NEYNAR_BASE = 'https://api.neynar.com';
const FNAME_REGISTRY = 'https://fnames.farcaster.xyz'; // docs.neynar.com/farcaster/reference/fname/api

// docs.neynar.com/farcaster/reference/contracts/deployments (verified 2026-08-28)
const ID_GATEWAY_ADDRESS = '0x00000000fc25870c6ed6b6c7e41fb078b7656f69';
const ID_REGISTRY_ADDRESS = '0x00000000fc6c5f01fc30151999387bb99a9f489b';
const KEY_GATEWAY_ADDRESS = '0x00000000fc56947c7e7183f8ca4b62398caadf0b';
const SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS = '0x00000000fc700472606ed4fa22623acf62c60553';

// hub-monorepo packages/core/src/eth/contracts/idRegistry.ts (verified 2026-08-28)
const ID_REGISTRY_EIP_712_DOMAIN = {
  name: 'Farcaster IdRegistry',
  version: '1',
  chainId: 10,
  verifyingContract: ID_REGISTRY_ADDRESS,
};
const ID_REGISTRY_TRANSFER_TYPE = [
  { name: 'fid', type: 'uint256' },
  { name: 'to', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];

// docs.neynar.com/farcaster/reference/farcaster/signer-requests +
// docs.neynar.com/docs/mini-app-authentication (verified 2026-08-28)
const SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN = {
  name: 'Farcaster SignedKeyRequestValidator',
  version: '1',
  chainId: 10,
  verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS,
};
const SIGNED_KEY_REQUEST_TYPE = [
  { name: 'requestFid', type: 'uint256' },
  { name: 'key', type: 'bytes' },
  { name: 'deadline', type: 'uint256' },
];

// hub-monorepo packages/core/src/crypto/eip712.ts (verified 2026-08-28).
// chainId 1 is intentional: the fname registry checks against mainnet domain.
const USERNAME_PROOF_EIP_712_DOMAIN = {
  name: 'Farcaster name verification',
  version: '1',
  chainId: 1,
  verifyingContract: '0xe3be01d99baa8db9905b33a3ca391238234b79d1',
};
const USERNAME_PROOF_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'owner', type: 'address' },
];

// docs.neynar.com/docs/how-to-create-a-new-farcaster-account-with-neynar
// (fname regex, per farcaster/core validations)
const FNAME_REGEX = /^[a-z0-9][a-z0-9-]{0,15}$/;

// Minimal ABIs, shaped after the calls shown in
// docs.neynar.com/farcaster/developers/guides/basics/hello-world and
// farcaster/reference/contracts/reference/{id-gateway,key-gateway,id-registry}
const ID_GATEWAY_ABI = [
  { name: 'price', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'register', type: 'function', stateMutability: 'payable', inputs: [{ name: 'recovery', type: 'address' }], outputs: [] },
];
const ID_REGISTRY_ABI = [
  { name: 'idOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'nonces', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const KEY_GATEWAY_ABI = [
  {
    name: 'add', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyType', type: 'uint32' },
      { name: 'key', type: 'bytes' },
      { name: 'metadataType', type: 'uint8' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
];

const PROFILE_DISPLAY_NAME = 'Layers dev test';
const PROFILE_BIO = 'Layers dev test account — automated posts [layers-test]';

// ---------------------------------------------------------------------------
// Small utilities. Defensive by default; failure paths say exactly what is
// missing. Private key material is never interpolated into any output.
// ---------------------------------------------------------------------------

// A synchronous process.exit() while a fetch() is still tearing down its
// socket trips a libuv assertion on Windows (UV_HANDLE_CLOSING, src\win\async.c).
// Set exitCode and throw instead, so the event loop drains naturally.
class Stop extends Error {}

function die(...lines) {
  for (const l of lines) console.error(l);
  process.exitCode = 1;
  throw new Stop();
}

function loadEnvLocal() {
  // Parses KEY=VALUE lines. Values are merged into process.env WITHOUT
  // overriding anything already exported. File contents are never printed.
  if (!fs.existsSync(ENV_LOCAL)) return {};
  const parsed = {};
  const raw = fs.readFileSync(ENV_LOCAL, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return parsed;
}

function requireEnv(names, hints) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    die(
      'ABORT: required configuration is missing. Nothing was called, nothing was spent.',
      ...missing.map((n) => `  - ${n} is not set (checked process env and ${ENV_LOCAL})`),
      '',
      ...(hints || []),
    );
  }
}

async function loadViem() {
  // Both paths need EIP-712 typed-data signatures (secp256k1 + keccak256).
  // Node's built-in crypto cannot produce those, and hand-rolling keccak/
  // secp256k1 in a spend-adjacent script is exactly the from-memory crypto
  // this pass forbids. viem is NOT currently in package.json/node_modules
  // (verified 2026-08-28), so detect-and-instruct rather than crash.
  try {
    const viem = await import('viem');
    const accounts = await import('viem/accounts');
    const chains = await import('viem/chains');
    return { viem, accounts, chains };
  } catch (err) {
    die(
      'ABORT: the "viem" package is required and is not installed.',
      'Nothing was called, nothing was spent.',
      '',
      'Both Gate 1 paths need EIP-712 typed-data signatures (keccak256 +',
      'secp256k1), which Node’s built-in crypto cannot produce. Install viem',
      'as a dev dependency, then re-run:',
      '',
      '    npm install --save-dev viem',
      `    node scripts/gate1-acquire-fid.mjs ${process.argv[2] || '<neynar|onchain>'}`,
      '',
      `(import error was: ${err && err.message ? err.message : String(err)})`,
    );
  }
}

async function fetchJson(label, url, options = {}, { okStatuses = [200], allow404 = false } = {}) {
  // Never logs request headers or bodies (they can carry the API key or
  // signatures). On failure prints label, status, and the RESPONSE body only.
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    die(`ABORT at "${label}": network request failed before any response.`, `  ${err && err.message ? err.message : String(err)}`);
  }
  if (allow404 && res.status === 404) return { status: 404, json: null };
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave json null */ }
  if (!okStatuses.includes(res.status)) {
    die(
      `ABORT at "${label}": HTTP ${res.status}.`,
      `  Response body: ${text ? text.slice(0, 2000) : '(empty)'}`,
    );
  }
  if (json === null && text) {
    die(`ABORT at "${label}": expected JSON, got unparseable body: ${text.slice(0, 500)}`);
  }
  return { status: res.status, json };
}

function neynarHeaders(extra = {}) {
  return { 'x-api-key': process.env.NEYNAR_API_KEY, 'Content-Type': 'application/json', ...extra };
}

function assertPositiveInt(value, what) {
  if (!Number.isInteger(value) || value <= 0) {
    die(`ABORT: ${what} is not a positive integer (got: ${JSON.stringify(value)}). Refusing to continue on malformed data.`);
  }
}

function pickFname() {
  const requested = process.env.FC_TEST_FNAME;
  const fname = requested || `layers-test-${randomBytes(2).toString('hex')}`;
  if (!FNAME_REGEX.test(fname)) {
    die(
      `ABORT: fname "${fname}" fails the protocol regex ${FNAME_REGEX}.`,
      'Set FC_TEST_FNAME to a valid value (lowercase alphanumeric + hyphen, max 16 chars).',
    );
  }
  return fname;
}

function guardNotAlreadyAcquired() {
  if (process.env.FC_TEST_FID) {
    die(
      `ABORT: FC_TEST_FID is already configured (${process.env.FC_TEST_FID}).`,
      'A throwaway account appears to exist. Acquiring a second one would spend',
      'money for nothing. If you intend to re-acquire, remove the',
      '"# THROWAWAY TEST ACCOUNT — Gate 1" block from .env.local first.',
    );
  }
}

function appendEnvBlock(entries, originLabel) {
  // entries: [ [key, value, isSecret], ... ]. Secrets are written to the file
  // but never echoed. Keys echoed; values echoed only for non-secrets.
  const stamp = new Date().toISOString();
  let prefix = '';
  if (fs.existsSync(ENV_LOCAL)) {
    const existing = fs.readFileSync(ENV_LOCAL, 'utf8');
    if (existing.length && !existing.endsWith('\n')) prefix = '\n';
  }
  const lines = [
    `${prefix}`,
    `# THROWAWAY TEST ACCOUNT — Gate 1 (${originLabel}, acquired ${stamp})`,
    '# These credentials control a DISPOSABLE test identity only. They are the',
    '# ONLY identity the Totem write seam may ever sign as (HARD IDENTITY RULE).',
    ...entries.map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');
  fs.appendFileSync(ENV_LOCAL, lines, 'utf8');
  console.log(`\nCredentials appended to ${ENV_LOCAL}:`);
  for (const [k, v, isSecret] of entries) {
    console.log(`  ${k}=${isSecret ? '<written to .env.local, not echoed>' : v}`);
  }
}

function printCostSheet(title, rows, { establishedUnderBudget, totalLine }) {
  console.log('');
  console.log('EXPECTED COST — ' + title);
  console.log('-'.repeat(72));
  for (const [item, cost, source] of rows) {
    console.log(`  ${item.padEnd(44)} ${cost.padEnd(14)} ${source}`);
  }
  console.log('-'.repeat(72));
  console.log(`  ${totalLine}`);
  console.log(`  Budget line: hard abort above $${BUDGET_USD.toFixed(2)} (notes/prompts/farcaster-live-prompt.md GATE 1)`);
  console.log('');
  if (!establishedUnderBudget) {
    die(
      `ABORT: expected cost could not be established to be under $${BUDGET_USD.toFixed(2)}.`,
      'No billable call was made. Fix the inputs above (or provide GATE1_ETH_USD',
      'for the onchain path) and re-run.',
    );
  }
  if (process.env.GATE1_CONFIRM !== 'yes') {
    console.log('DRY RUN COMPLETE. No billable call was made, nothing was spent.');
    console.log('To execute for real:  GATE1_CONFIRM=yes node scripts/gate1-acquire-fid.mjs ' + process.argv[2]);
    console.log('(PowerShell:  $env:GATE1_CONFIRM="yes"; node scripts/gate1-acquire-fid.mjs ' + process.argv[2] + ')');
    process.exitCode = 0;
    throw new Stop();
  }
  console.log('GATE1_CONFIRM=yes — proceeding with acquisition.\n');
}

async function verifyViaBulkRead(fid, { attempts = 5, delayMs = 4000 } = {}) {
  // Retry adapter reads (ops-discipline): a freshly registered fid can lag
  // Neynar indexing. Absence after retries is reported loudly, never
  // swallowed into a false success.
  if (!process.env.NEYNAR_API_KEY) {
    console.log('VERIFICATION SKIPPED: NEYNAR_API_KEY not set, cannot run the user/bulk read.');
    return false;
  }
  const url = `${NEYNAR_BASE}/v2/farcaster/user/bulk?fids=${fid}`;
  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'x-api-key': process.env.NEYNAR_API_KEY } });
    } catch (err) {
      console.log(`  verify attempt ${i}/${attempts}: network error (${err && err.message ? err.message : err})`);
      res = null;
    }
    if (res && res.ok) {
      const body = await res.json().catch(() => null);
      const user = body && Array.isArray(body.users) ? body.users[0] : null;
      if (user && user.fid === fid) {
        console.log('\nVERIFICATION READ (GET /v2/farcaster/user/bulk?fids=' + fid + '):');
        console.log(`  fid:             ${user.fid}`);
        console.log(`  username:        ${user.username ?? '(none yet)'}`);
        console.log(`  display_name:    ${user.display_name ?? '(none yet)'}`);
        console.log(`  bio:             ${(user.profile && user.profile.bio && user.profile.bio.text) || '(none yet)'}`);
        console.log(`  custody_address: ${user.custody_address}`);
        return true;
      }
    } else if (res) {
      console.log(`  verify attempt ${i}/${attempts}: HTTP ${res.status}`);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('\nVERIFICATION READ DID NOT RESOLVE YET.');
  console.log('The registration calls above succeeded; the fid may still be indexing.');
  console.log('Re-check with:  node scripts/gate1-acquire-fid.mjs verify');
  return false;
}

// ---------------------------------------------------------------------------
// PATH 1: Neynar-sponsored registration.
// Flow per docs.neynar.com/docs/how-to-create-a-new-farcaster-account-with-neynar
// and docs.neynar.com/reference/register-account (verified 2026-08-28).
// ---------------------------------------------------------------------------

async function runNeynarPath() {
  guardNotAlreadyAcquired();
  requireEnv(['NEYNAR_API_KEY', 'NEYNAR_WALLET_ID'], [
    'The neynar path needs:',
    '  NEYNAR_API_KEY   - the existing Neynar API key',
    '  NEYNAR_WALLET_ID - the App Wallet id from dev.neynar.com (app -> "App Wallet"',
    '                     tab -> activate a wallet, fund it with $5+ of ETH on',
    '                     Optimism, copy its wallet id). Docs: Managing Onchain Wallets.',
    'Put both in .env.local.',
  ]);
  const { accounts, chains, viem } = await loadViem();

  const fname = pickFname();
  const skipSigner = process.env.GATE1_SKIP_SIGNER === 'yes';

  // Cost sheet BEFORE any Neynar call. All figures are doc-stated; Neynar
  // bills the onchain legs in ETH through YOUR app wallet, and no per-call
  // credit price for POST /v2/farcaster/user is documented.
  printCostSheet('neynar path (billed to your Neynar app wallet in ETH + plan credits)', [
    ['FID registration (onchain, via Neynar)', '~$0.20', 'docs/autonomous-farcaster-agent cost table'],
    ['Registration gas', '$0.10-$0.50', 'docs/managing-onchain-wallets "Gas Costs" tip'],
    ['First storage unit', '$0.05-$0.20', 'docs/managing-onchain-wallets "Gas Costs" tip'],
    ['Cold start: FID shelf pre-registration', 'first call only', 'bounded by docs’ "$5+ ETH" wallet guidance'],
    ['POST /v2/farcaster/signer', '2 credits', 'reference/compute-units'],
    ['GET fname/availability', '1 credit', 'reference/compute-units'],
    ['POST /v2/farcaster/user (credits)', 'not documented', 'absent from reference/compute-units'],
  ], {
    establishedUnderBudget: true, // documented worst case is ~$1 in ETH + docs cap wallet funding guidance at $5
    totalLine: 'Documented expected total: well under $2 in ETH (docs figures); first-ever call may draw more for the FID shelf, bounded by the $5 funding guidance. Established under the $10 line.',
  });

  // --- Billable phase begins ---

  // 0. fname availability (1 credit). reference/is-fname-available
  {
    const { json } = await fetchJson('fname availability', `${NEYNAR_BASE}/v2/farcaster/fname/availability?fname=${encodeURIComponent(fname)}`, { headers: neynarHeaders() });
    if (!json || typeof json.available !== 'boolean') {
      die('ABORT: fname availability response missing boolean "available" field. Refusing to guess.');
    }
    if (!json.available) {
      die(`ABORT: fname "${fname}" is taken. Set FC_TEST_FNAME to another value and re-run. (Only 1 credit was spent.)`);
    }
    console.log(`fname "${fname}" is available.`);
  }

  // 1. Claim a fresh FID. GET /v2/farcaster/user/fid, x-wallet-id required.
  //    10-MINUTE RULE: registration must complete within 10 minutes or Neynar
  //    reassigns this fid. First-ever call with a wallet takes ~1 minute
  //    (shelf pre-registration). reference/get-fresh-account-fid
  console.log('Fetching fresh FID (first-ever call with this wallet can take ~1 minute)...');
  const fidFetchedAt = Date.now();
  const { json: fidBody } = await fetchJson('fetch fresh FID', `${NEYNAR_BASE}/v2/farcaster/user/fid`, {
    headers: neynarHeaders({ 'x-wallet-id': process.env.NEYNAR_WALLET_ID }),
  });
  if (!fidBody || fidBody.fid === undefined) {
    die('ABORT: /v2/farcaster/user/fid response had no "fid" field. Refusing to continue.');
  }
  const fid = Number(fidBody.fid);
  assertPositiveInt(fid, 'fresh fid');
  console.log(`Fresh FID reserved: ${fid} (must be registered within 10 minutes).`);

  // 2. Local throwaway custody keypair (viem). The private key stays local.
  const custodyPrivateKey = accounts.generatePrivateKey();
  const custody = accounts.privateKeyToAccount(custodyPrivateKey);
  console.log(`Generated throwaway custody address: ${custody.address} (private key withheld from output).`);

  // 3. IdRegistry.nonces(custody) via public RPC (free read). Fresh key, so 0
  //    is expected, but read it rather than assume it.
  const rpcUrl = process.env.OP_RPC_URL; // optional override; viem falls back to the chain default
  const publicClient = viem.createPublicClient({ chain: chains.optimism, transport: viem.http(rpcUrl) });
  let nonce;
  try {
    nonce = await publicClient.readContract({
      address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'nonces', args: [custody.address],
    });
  } catch (err) {
    die(
      'ABORT: could not read IdRegistry.nonces from Optimism RPC.',
      `  ${err && err.message ? err.message : String(err)}`,
      'Set OP_RPC_URL to a working Optimism mainnet RPC and re-run.',
      '(The fid reservation lapses after 10 minutes; a re-run gets a fresh one.)',
    );
  }

  // 4. EIP-712 Transfer signature by the NEW custody key (Neynar pre-registers
  //    the fid and transfers it to this address; the RECIPIENT signs).
  //    Domain/types: hub-monorepo idRegistry.ts. Deadline: docs use now+1h.
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await custody.signTypedData({
    domain: ID_REGISTRY_EIP_712_DOMAIN,
    types: { Transfer: ID_REGISTRY_TRANSFER_TYPE },
    primaryType: 'Transfer',
    message: { fid: BigInt(fid), to: custody.address, nonce, deadline: BigInt(deadline) },
  });

  // 5. Managed signer (unless GATE1_SKIP_SIGNER=yes).
  let signerUuid = null;
  let signerPublicKey = null;
  let signerBlock = null;
  if (!skipSigner) {
    // 5a. POST /v2/farcaster/signer (2 credits) -> { signer_uuid, public_key, status }
    const { json: signerBody } = await fetchJson('create managed signer', `${NEYNAR_BASE}/v2/farcaster/signer`, {
      method: 'POST', headers: neynarHeaders(), body: '{}',
    });
    if (!signerBody || typeof signerBody.signer_uuid !== 'string' || typeof signerBody.public_key !== 'string') {
      die('ABORT: signer creation response missing signer_uuid/public_key. Refusing to continue.');
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(signerBody.public_key)) {
      die(`ABORT: signer public_key is not a 32-byte hex string (got length ${signerBody.public_key.length}).`);
    }
    signerUuid = signerBody.signer_uuid;
    signerPublicKey = signerBody.public_key;
    console.log(`Managed signer created: uuid=${signerUuid} status=${signerBody.status ?? '(unstated)'}`);

    // 5b. SignedKeyRequest metadata signature. DOC-AMBIGUOUS STEP, flagged:
    //     the guide's script signs with "your application's FID/mnemonic".
    //     This project has no app fid, so we use the SELF-OWNED form the
    //     protocol docs show in the hello-world guide: requestFid = the new
    //     fid itself, signed by its own (our) custody key. The validator only
    //     checks that the signature recovers to requestFid's custody, which
    //     holds here. If Neynar's endpoint rejects this (e.g. InvalidSignature
    //     on the signer object), re-run with GATE1_SKIP_SIGNER=yes and attach
    //     a signer afterwards (see notes/runbooks/GATE1-RUNBOOK.md).
    const signerDeadline = Math.floor(Date.now() / 1000) + 86400; // docs: 24h
    const skrSignature = await custody.signTypedData({
      domain: SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN,
      types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE },
      primaryType: 'SignedKeyRequest',
      message: { requestFid: BigInt(fid), key: signerPublicKey, deadline: BigInt(signerDeadline) },
    });
    // Despite the field name, Neynar wants the ABI-encoded
    // SignedKeyRequestMetadata struct, not the bare EIP-712 signature
    // (docs "Generate Signed Key Request Metadata Signature" passes the
    // output of getSignedKeyRequestMetadata, which encodes the struct).
    const skrMetadata = viem.encodeAbiParameters(
      [{
        type: 'tuple',
        components: [
          { name: 'requestFid', type: 'uint256' },
          { name: 'requestSigner', type: 'address' },
          { name: 'signature', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
        ],
      }],
      [{ requestFid: BigInt(fid), requestSigner: custody.address, signature: skrSignature, deadline: BigInt(signerDeadline) }],
    );
    signerBlock = {
      uuid: signerUuid,
      signed_key_request_metadata_signature: skrMetadata,
      app_fid: fid, // self-owned: the new fid vouches for its own key
      deadline: signerDeadline,
    };
  } else {
    console.log('GATE1_SKIP_SIGNER=yes — registering without a managed signer.');
  }

  // 6. Finalize registration. POST /v2/farcaster/user with the SAME wallet id,
  //    inside the 10-minute window. Body schema: reference/register-account.
  const elapsedMin = (Date.now() - fidFetchedAt) / 60000;
  if (elapsedMin > 9) {
    die(`ABORT: ${elapsedMin.toFixed(1)} minutes elapsed since the fid was reserved; the 10-minute window is nearly/fully expired. Re-run to reserve a fresh fid. Nothing was registered.`);
  }
  const registerBody = {
    fid,
    signature,
    requested_user_custody_address: custody.address,
    deadline,
    fname,
    metadata: { display_name: PROFILE_DISPLAY_NAME, bio: PROFILE_BIO },
  };
  if (signerBlock) registerBody.signer = signerBlock;

  console.log('Registering account (POST /v2/farcaster/user)...');
  const regRes = await fetch(`${NEYNAR_BASE}/v2/farcaster/user`, {
    method: 'POST',
    headers: neynarHeaders({ 'x-wallet-id': process.env.NEYNAR_WALLET_ID }),
    body: JSON.stringify(registerBody),
  }).catch((err) => die('ABORT: register call failed before any response.', `  ${err && err.message ? err.message : String(err)}`));
  const regText = await regRes.text();
  let reg = null;
  try { reg = regText ? JSON.parse(regText) : null; } catch { /* handled below */ }
  if (!regRes.ok || !reg || reg.success !== true) {
    const code = reg && reg.code;
    const hints = [];
    if (code === 'FidExpired') hints.push('Hint: the 10-minute reservation lapsed. Re-run; a fresh fid will be reserved.');
    if (code === 'InsufficientFunds') hints.push('Hint: the Neynar app wallet needs more ETH on Optimism (docs say $5+). Fund it at dev.neynar.com.');
    if (code === 'InvalidSignature') {
      hints.push('Hint: if this refers to the signer object, the self-owned app_fid form was rejected;');
      hints.push('      re-run with GATE1_SKIP_SIGNER=yes to register without a signer, then attach one (see notes/runbooks/GATE1-RUNBOOK.md).');
    }
    die(
      `ABORT: registration failed (HTTP ${regRes.status}).`,
      `  Response body: ${regText ? regText.slice(0, 2000) : '(empty)'}`,
      ...hints,
      'No credentials were persisted.',
    );
  }
  console.log(`Registration succeeded: ${reg.message || '(no message)'}`);

  // Prefer the signer facts the API reports over what we sent.
  const reportedSigner = reg.signer || (Array.isArray(reg.signers) ? reg.signers[0] : null);
  if (reportedSigner) {
    signerUuid = reportedSigner.signer_uuid || reportedSigner.uuid || signerUuid;
    signerPublicKey = reportedSigner.public_key || signerPublicKey;
    console.log(`Signer status per response: ${reportedSigner.status ?? '(unstated)'}`);
  }

  // 7. Persist. Private keys go to .env.local only.
  const entries = [
    ['FC_TEST_FID', String(fid), false],
    ['FC_TEST_FNAME', fname, false],
    ['FC_TEST_ORIGIN', 'neynar', false],
    ['FC_TEST_CUSTODY_ADDRESS', custody.address, false],
    ['FC_TEST_CUSTODY_PRIVATE_KEY', custodyPrivateKey, true],
  ];
  if (signerUuid) entries.push(['FC_TEST_SIGNER_UUID', signerUuid, false]);
  if (signerPublicKey) entries.push(['FC_TEST_SIGNER_PUBLIC_KEY', signerPublicKey, false]);
  appendEnvBlock(entries, 'neynar path');

  // 8. Verification read + spend statement.
  await verifyViaBulkRead(fid);
  console.log('\nSPEND — as far as it is knowable from here:');
  console.log('  Onchain legs were executed BY NEYNAR and billed in ETH to your app');
  console.log('  wallet; this script cannot see that wallet’s ledger. Documented');
  console.log('  expectation: ~$0.35-$0.90 (sources in the cost sheet above; first-ever');
  console.log('  call may add shelf pre-registration, bounded by the $5 funding guidance).');
  console.log('  Exact figure: dev.neynar.com -> your app -> App Wallet tab.');
  console.log(`  Neynar credits consumed: 1 (fname check) + ${skipSigner ? 0 : 2} (signer) + register-account (cost not documented).`);
  console.log('\nGATE 1 (neynar path) COMPLETE.');
}

// ---------------------------------------------------------------------------
// PATH 2: Direct onchain registration from a funded burner on Optimism.
// Flow per docs.neynar.com/farcaster/developers/guides/basics/hello-world and
// farcaster/reference/contracts/* (verified 2026-08-28).
// ---------------------------------------------------------------------------

async function runOnchainPath() {
  guardNotAlreadyAcquired();
  requireEnv(['OP_BURNER_PRIVATE_KEY'], [
    'The onchain path needs OP_BURNER_PRIVATE_KEY in .env.local: a burner EOA',
    'private key (0x + 64 hex) holding a few dollars of ETH ON OPTIMISM MAINNET.',
    'This key becomes the throwaway custody key. Never use a real wallet.',
  ]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.OP_BURNER_PRIVATE_KEY)) {
    die('ABORT: OP_BURNER_PRIVATE_KEY is not a 0x-prefixed 32-byte hex string. (Value not echoed.)');
  }
  const { viem, accounts, chains } = await loadViem();

  const burner = accounts.privateKeyToAccount(process.env.OP_BURNER_PRIVATE_KEY);
  console.log(`Burner (custody) address: ${burner.address}`);
  const rpcUrl = process.env.OP_RPC_URL;
  const publicClient = viem.createPublicClient({ chain: chains.optimism, transport: viem.http(rpcUrl) });
  const walletClient = viem.createWalletClient({ account: burner, chain: chains.optimism, transport: viem.http(rpcUrl) });

  const fname = pickFname();

  // --- Free reads to build a real cost sheet ---
  let balance, existingFid, priceWei, gasPrice;
  try {
    [balance, existingFid, priceWei, gasPrice] = await Promise.all([
      publicClient.getBalance({ address: burner.address }),
      publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [burner.address] }),
      publicClient.readContract({ address: ID_GATEWAY_ADDRESS, abi: ID_GATEWAY_ABI, functionName: 'price', args: [] }),
      publicClient.getGasPrice(),
    ]);
  } catch (err) {
    die(
      'ABORT: could not read from Optimism RPC (balance / idOf / IdGateway.price / gas price).',
      `  ${err && err.message ? err.message : String(err)}`,
      'Set OP_RPC_URL to a working Optimism mainnet RPC and re-run. Nothing was spent.',
    );
  }
  const alreadyRegistered = existingFid > 0n;
  if (alreadyRegistered) {
    console.log(`NOTE: this burner already owns fid ${existingFid} — registration will be skipped (resume mode).`);
  }

  // ETH/USD: needed to enforce the dollar budget. Sourced from Coinbase's
  // public spot endpoint, overridable/replaceable with GATE1_ETH_USD.
  let ethUsd = Number(process.env.GATE1_ETH_USD) || null;
  if (!ethUsd) {
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
      if (res.ok) {
        const body = await res.json();
        ethUsd = Number(body && body.data && body.data.amount) || null;
      }
    } catch { /* handled below */ }
  }
  if (!ethUsd || !(ethUsd > 0)) {
    die(
      'ABORT: could not establish the ETH/USD price, so the dollar cost cannot be',
      `established to be under $${BUDGET_USD.toFixed(2)}. No transaction was sent.`,
      'Set GATE1_ETH_USD=<current ETH price in USD> and re-run.',
    );
  }
  const usd = (wei) => Number(wei) / 1e18 * ethUsd;

  // Gas estimate for register (only meaningful if not yet registered).
  let registerGas = 0n;
  if (!alreadyRegistered) {
    try {
      registerGas = await publicClient.estimateContractGas({
        address: ID_GATEWAY_ADDRESS, abi: ID_GATEWAY_ABI, functionName: 'register',
        args: [viem.zeroAddress], value: priceWei, account: burner,
      });
    } catch (err) {
      die(
        'ABORT: gas estimation for IdGateway.register failed (often: burner balance',
        `below the registration price). price=${priceWei} wei (~$${usd(priceWei).toFixed(2)}), balance=${balance} wei (~$${usd(balance).toFixed(2)}).`,
        `  ${err && err.message ? err.message : String(err)}`,
        'Fund the burner on Optimism and re-run. Nothing was spent.',
      );
    }
  }
  const registerGasCost = registerGas * gasPrice;
  // KeyGateway.add cannot be estimated before the fid exists; use the doc
  // figure for the sheet and re-check against the live estimate post-register.
  const ADD_SIGNER_DOC_USD = 0.05; // docs/autonomous-farcaster-agent cost table
  const l2KnownUsd = usd(priceWei + registerGasCost) + (alreadyRegistered ? 0 : ADD_SIGNER_DOC_USD);
  // L1 data fees on OP Stack are additional and small; budget-check with a 2x
  // buffer on the gas legs so "under $10" is established conservatively.
  const conservativeUsd = usd(priceWei) + 2 * usd(registerGasCost) + 2 * ADD_SIGNER_DOC_USD;

  printCostSheet('onchain path (paid in ETH by the burner on Optimism)', [
    [alreadyRegistered ? 'IdGateway.register (SKIPPED: fid exists)' : 'IdGateway.register value (incl. 1 storage unit)',
      alreadyRegistered ? '$0.00' : `$${usd(priceWei).toFixed(2)} (${priceWei} wei)`,
      'live read: IdGateway.price()'],
    ['register gas (L2 estimate)', alreadyRegistered ? '$0.00' : `~$${usd(registerGasCost).toFixed(2)} (${registerGas} gas)`, 'live eth_estimateGas'],
    ['KeyGateway.add gas', `~$${ADD_SIGNER_DOC_USD.toFixed(2)}`, 'docs/autonomous-farcaster-agent cost table'],
    ['fname registration (offchain)', '$0.00', 'farcaster/reference/fname/api (free HTTP API)'],
    ['L1 data fee', 'small, extra', 'OP Stack; covered by 2x buffer below'],
    [`ETH/USD used: $${ethUsd.toFixed(2)}`, '', process.env.GATE1_ETH_USD ? 'GATE1_ETH_USD (user-supplied)' : 'coinbase.com spot'],
  ], {
    establishedUnderBudget: conservativeUsd < BUDGET_USD,
    totalLine: `Expected total ~$${l2KnownUsd.toFixed(2)}; conservative (2x gas buffer) $${conservativeUsd.toFixed(2)}.`,
  });

  if (balance < priceWei + 2n * registerGasCost && !alreadyRegistered) {
    die(
      `ABORT: burner balance (~$${usd(balance).toFixed(2)}) does not cover price + 2x gas (~$${usd(priceWei + 2n * registerGasCost).toFixed(2)}).`,
      'Fund the burner on Optimism and re-run. Nothing was spent.',
    );
  }

  // fname availability first (free, offchain): 404 from /transfers/current
  // means available. docs/autonomous-farcaster-agent fname table.
  {
    const { status } = await fetchJson('fname availability (fname registry)', `${FNAME_REGISTRY}/transfers/current?name=${encodeURIComponent(fname)}`, {}, { okStatuses: [200], allow404: true });
    if (status !== 404) {
      die(`ABORT: fname "${fname}" is already registered. Set FC_TEST_FNAME to another value and re-run. Nothing was spent.`);
    }
    console.log(`fname "${fname}" is available.`);
  }

  // --- Spending phase ---
  let spentWei = 0n;
  const receipts = [];

  let fid;
  if (alreadyRegistered) {
    fid = Number(existingFid);
  } else {
    // 1. IdGateway.register(recovery) with value = price. Recovery = zero
    //    address: the hello-world guide's default; an unrecoverable account is
    //    acceptable for a throwaway.
    console.log('Sending IdGateway.register...');
    let txHash;
    try {
      const { request } = await publicClient.simulateContract({
        address: ID_GATEWAY_ADDRESS, abi: ID_GATEWAY_ABI, functionName: 'register',
        args: [viem.zeroAddress], value: priceWei, account: burner,
      });
      txHash = await walletClient.writeContract(request);
    } catch (err) {
      die('ABORT: register transaction failed to send.', `  ${err && err.message ? err.message : String(err)}`, 'If nothing was mined, nothing was spent; check the burner on optimistic.etherscan.io.');
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      die(`ABORT: register transaction reverted (tx ${txHash}). Gas was spent; the registration price was returned by the revert. Investigate before re-running.`);
    }
    receipts.push(['register', receipt, priceWei]);
    spentWei += receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n) + priceWei;
    const fidBig = await publicClient.readContract({ address: ID_REGISTRY_ADDRESS, abi: ID_REGISTRY_ABI, functionName: 'idOf', args: [burner.address] });
    if (!(fidBig > 0n)) die('ABORT: register tx succeeded but IdRegistry.idOf still reads 0. Refusing to continue on inconsistent state.');
    fid = Number(fidBig);
    console.log(`Registered fid ${fid} (tx ${txHash}).`);
  }
  assertPositiveInt(fid, 'fid');

  // 2. Ed25519 signer keypair via node:crypto (no extra deps needed here).
  const kp = generateKeyPairSync('ed25519');
  const pubRaw = Buffer.from(kp.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const privRaw = Buffer.from(kp.privateKey.export({ format: 'jwk' }).d, 'base64url');
  if (pubRaw.length !== 32 || privRaw.length !== 32) {
    die(`ABORT: unexpected Ed25519 key lengths (pub ${pubRaw.length}, priv ${privRaw.length}); expected 32/32.`);
  }
  const signerPublicKey = '0x' + pubRaw.toString('hex');
  const signerPrivateKey = '0x' + privRaw.toString('hex'); // written to .env.local only
  console.log(`Generated Ed25519 signer key: ${signerPublicKey} (private key withheld from output).`);

  // 3. Self-owned SignedKeyRequestMetadata: the fid signs its own key request
  //    (requestFid = own fid, requestSigner = own custody address), exactly as
  //    in the hello-world guide where one account both owns the fid and vouches
  //    for the key. Metadata struct + Add call shapes:
  //    farcaster/reference/contracts/reference/{signed-key-request-validator,key-gateway}.
  const skrDeadline = Math.floor(Date.now() / 1000) + 3600;
  const skrSignature = await burner.signTypedData({
    domain: SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN,
    types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE },
    primaryType: 'SignedKeyRequest',
    message: { requestFid: BigInt(fid), key: signerPublicKey, deadline: BigInt(skrDeadline) },
  });
  const metadata = viem.encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'requestFid', type: 'uint256' },
        { name: 'requestSigner', type: 'address' },
        { name: 'signature', type: 'bytes' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    [{ requestFid: BigInt(fid), requestSigner: burner.address, signature: skrSignature, deadline: BigInt(skrDeadline) }],
  );

  // 4. KeyGateway.add(keyType=1, key, metadataType=1, metadata) called by the
  //    fid owner itself (no Add signature needed for a self-call).
  console.log('Sending KeyGateway.add...');
  try {
    const { request } = await publicClient.simulateContract({
      address: KEY_GATEWAY_ADDRESS, abi: KEY_GATEWAY_ABI, functionName: 'add',
      args: [1, signerPublicKey, 1, metadata], account: burner,
    });
    const txHash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      die(`ABORT: KeyGateway.add reverted (tx ${txHash}). The fid exists (${fid}) but the signer was NOT added. Gas for this tx was spent. Nothing was persisted; re-run to retry the signer step (registration will be skipped).`);
    }
    receipts.push(['add signer', receipt, 0n]);
    spentWei += receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n);
    console.log(`Signer key added onchain (tx ${txHash}).`);
  } catch (err) {
    die('ABORT: KeyGateway.add failed.', `  ${err && err.message ? err.message : String(err)}`, `The fid exists (${fid}); re-run to retry the signer step (registration will be skipped). Nothing was persisted yet.`);
  }

  // 5. fname claim via the offchain registry (free). UserNameProof EIP-712,
  //    mainnet domain, signed by the custody address.
  console.log('Claiming fname via fnames.farcaster.xyz...');
  const ts = Math.floor(Date.now() / 1000);
  const fnameSignature = await burner.signTypedData({
    domain: USERNAME_PROOF_EIP_712_DOMAIN,
    types: { UserNameProof: USERNAME_PROOF_TYPE },
    primaryType: 'UserNameProof',
    message: { name: fname, timestamp: BigInt(ts), owner: burner.address },
  });
  const fnameRes = await fetch(`${FNAME_REGISTRY}/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fname, from: 0, to: fid, fid, owner: burner.address, timestamp: ts, signature: fnameSignature }),
  }).catch((err) => die('ABORT: fname registry call failed.', `  ${err && err.message ? err.message : String(err)}`, `The fid (${fid}) and signer are live; only the fname is missing. Re-run to retry.`));
  const fnameText = await fnameRes.text();
  if (!fnameRes.ok) {
    die(
      `ABORT: fname registration failed (HTTP ${fnameRes.status}).`,
      `  Response body: ${fnameText ? fnameText.slice(0, 1000) : '(empty)'}`,
      `The fid (${fid}) and signer are live; only the fname is missing. Fix and re-run (registration + signer steps will be skipped).`,
    );
  }
  console.log(`fname "${fname}" associated with fid ${fid}.`);

  // 6. Persist.
  appendEnvBlock([
    ['FC_TEST_FID', String(fid), false],
    ['FC_TEST_FNAME', fname, false],
    ['FC_TEST_ORIGIN', 'onchain', false],
    ['FC_TEST_CUSTODY_ADDRESS', burner.address, false],
    ['FC_TEST_CUSTODY_PRIVATE_KEY', process.env.OP_BURNER_PRIVATE_KEY, true],
    ['FC_TEST_SIGNER_PUBLIC_KEY', signerPublicKey, false],
    ['FC_TEST_SIGNER_PRIVATE_KEY', signerPrivateKey, true],
  ], 'onchain path');

  // 7. Verification read + exact spend.
  await verifyViaBulkRead(fid);
  console.log('\nSPEND — exact, from transaction receipts:');
  for (const [label, receipt, value] of receipts) {
    const cost = receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n) + value;
    console.log(`  ${label}: ${cost} wei (~$${usd(cost).toFixed(2)})${receipt.l1Fee === undefined ? ' [l1Fee not reported by RPC; true cost marginally higher]' : ''}`);
  }
  console.log(`  TOTAL: ${spentWei} wei = ~$${usd(spentWei).toFixed(2)} at $${ethUsd.toFixed(2)}/ETH`);
  console.log('\nFOLLOW-UP REQUIRED (documented in notes/runbooks/GATE1-RUNBOOK.md):');
  console.log('  - The fname is associated but not yet ACTIVE as the username, and the');
  console.log('    profile display name/bio are unset: both need signed UserData messages');
  console.log('    submitted to a hub (@farcaster/hub-nodejs, not installed), so the');
  console.log('    "profile must say test account" requirement is NOT yet satisfied on');
  console.log('    this path. Complete it before any public write.');
  console.log('\nGATE 1 (onchain path) COMPLETE (with the follow-up above).');
}

// ---------------------------------------------------------------------------
// verify mode: read-only re-check of an already-acquired fid.
// ---------------------------------------------------------------------------

async function runVerify() {
  requireEnv(['FC_TEST_FID'], ['Nothing to verify: FC_TEST_FID is not in .env.local yet.']);
  const fid = Number(process.env.FC_TEST_FID);
  assertPositiveInt(fid, 'FC_TEST_FID');
  const ok = await verifyViaBulkRead(fid, { attempts: 3, delayMs: 3000 });
  process.exitCode = ok ? 0 : 1;
}

// ---------------------------------------------------------------------------

async function main() {
  if (typeof fetch !== 'function') {
    die('ABORT: this script needs Node 18+ (global fetch). Current version: ' + process.version);
  }
  loadEnvLocal();
  const mode = process.argv[2];
  if (mode === 'neynar') return runNeynarPath();
  if (mode === 'onchain') return runOnchainPath();
  if (mode === 'verify') return runVerify();
  die(
    'Refusing to run without an explicit path flag.',
    '',
    'Usage:',
    '  node scripts/gate1-acquire-fid.mjs neynar    # Neynar-sponsored (needs NEYNAR_WALLET_ID)',
    '  node scripts/gate1-acquire-fid.mjs onchain   # IdGateway on Optimism (needs OP_BURNER_PRIVATE_KEY)',
    '  node scripts/gate1-acquire-fid.mjs verify    # read-only re-check of FC_TEST_FID',
    '',
    'Both acquisition modes are DRY RUNS (cost sheet only) unless GATE1_CONFIRM=yes.',
  );
}

main().catch((err) => {
  if (err instanceof Stop) return;
  console.error('UNEXPECTED FAILURE (no partial state was persisted unless a "Credentials appended" line printed above):');
  console.error(`  ${err && err.stack ? err.stack : String(err)}`);
  process.exitCode = 1;
});
