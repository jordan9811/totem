// THE HUB ROUTE (Neynar-free @anon) — A LOOPBACK FARCASTER PROTOCOL for tests: an Optimism JSON-RPC that simulates the
// four Farcaster contracts the owner's account script touches, a Snapchain node's HTTP API, and the fname server. Nothing
// here touches a real chain, a real node or a real name; every port is loopback, never a pinned one.
//
// WHY ONE STUB: the account script (scripts/owner/make-anon-account.mjs) and the validator's hub transport
// (validator/anonpublic.js, validator/hubmessage.js) are judged by what the PROTOCOL accepts, so the stub checks what a
// real one would, independently of the code under test (its own protobuf DECODER, its own BLAKE3 and Ed25519 checks, its
// own EIP-712 recovery, its own ABI decoding of signed raw transactions):
//   chain   eth_chainId (0xa), eth_blockNumber, eth_gasPrice, eth_maxPriorityFeePerGas, eth_getBlockByNumber (a base fee),
//           eth_getBalance, eth_getTransactionCount, eth_estimateGas, eth_call (IdGateway.price, StorageRegistry.ethUsdPrice /
//           unitPrice, IdRegistry.idOf, KeyRegistry.keyDataOf, GasPriceOracle.getL1Fee), eth_sendRawTransaction (a SIGNED
//           EIP-1559 tx: the sender recovered, chain id 10, nonce in order, balance enough for value + gas; IdGateway.register
//           gives the next fid and refunds overpayment, refuses a custody that already has one; KeyGateway.add requires the
//           sender to be the fid's custody and the SignedKeyRequest metadata to recover to the requestFid's custody),
//           eth_getTransactionReceipt. A RE-SENT raw tx (the same hash) is accepted once: a second copy changes nothing.
//           ("Allow Totem to post as you", the app account: IdGateway.registerFor(to, recovery, deadline, sig) — the
//           EIP-712 Register signature must recover to `to` over the gateway's nonce for `to` (IdGateway.nonces, used up
//           on success), the deadline not passed (SignatureExpired), `to` without an fid (HasId), the SENDER pays the
//           value and gets the overpayment back while the fid goes to `to`; eth_estimateGas refuses the same reverts.)
//           (the app account's profile key: KeyGateway.addFor(fidOwner, keyType, key, metadataType, metadata, deadline,
//           sig), in KeyGateway.sol's order — the deadline (SignatureExpired), the EIP-712 Add signature recovered to
//           `fidOwner` over the GATEWAY's nonce for `fidOwner` (KeyGateway.nonces, used up on success; InvalidSignature),
//           then KeyRegistry.add's own checks for fidOwner's fid (Unauthorized without one, the key state, the
//           SignedKeyRequest metadata). Any sender may send it; the sender pays the gas only.)
//   hub     POST /v1/submitMessage (decodes the protobuf; checks hash = BLAKE3(data_bytes)[:20], the Ed25519 signature, the
//           signer ACTIVE for the fid on the stub chain, the timestamp within 10 minutes, a USERNAME only with an fname proof
//           to the fid), GET /v1/castsByFid, /v1/castById, /v1/onChainSignersByFid, /v1/info; errors shaped like Snapchain's.
//           (FOLLOWING FROM THE HUB, the browser's reads: GET /v1/linksByFid (follows, paged by pageSize + pageToken, oldest
//           follow first like the real node), /v1/castsByFid (paged, reverse=true newest first), /v1/castsByParent (a
//           cast's direct replies), /v1/userDataByFid; casts carry their parentCastId, embeds and mentions as the real
//           node's JSON does. (POST AS YOU ON HUB CARDS: /v1/reactionsByFid?fid=&reaction_type=Like|Recast, paged, reverse=
//           true newest first, the reactions submitted or planted; any other reaction_type is the real node's 400 "unknown
//           variant", measured 2026-11-05.) (NOTIFICATIONS FROM FARCASTER: /v1/linksByTargetFid?target_fid=&link_type=follow,
//           /v1/castsByMention?fid=, /v1/reactionsByCast?target_fid=&target_hash=&reaction_type=, answered PER SHARD like
//           the real node's by-target indexes (two shards by fid parity, each its own pageSize, concatenated; measured
//           2026-11-06), with its refusals (no target_fid, no link_type, an unknown reaction variant); with
//           hubRead.shardedParents castsByParent too, and its token then never ends, as the real one's does. Steering:
//           stub.plantFollow (a follower added), stub.removeReaction.) (FOR YOU FROM THE HUB, spec B: reactionsByFid with
//           NO reaction_type is the real node's 400 "missing field `reaction_type`", measured 2026-11-07; linksByFid with
//           reverse=true answers newest follows first, as the real node does. Steering: stub.plantTwoHop (a root, its
//           follows, the active ones' likes, recasts and follows of accounts beyond them) and stub.forYouTruth (what For
//           You should show, computed from this stub's own state, for a known keyed half or, with anyHalf, for any).) An OPTIONS preflight answers 404 like the real node's, so a tab can only make SIMPLE reads.
//           Steering for those reads: stub.plant / stub.plantSynthetic (a graph, its casts and profiles), stub.truth (the
//           ground-truth timeline: every live cast of a root and the accounts it follows, newest first), stub.hubRead
//           (per-request delay, failures by path and fid, a 429 run with Retry-After, and the read log: path, fid,
//           Origin / Referer / Cookie seen, the most requests in flight at once, preflights).)
//   fnames  GET /transfers/current?name=, POST /transfers (the UserNameProof EIP-712 signature must recover to `owner`, and
//           `owner` must be the custody of `fid` on the stub chain).
// Steering (tests): stub.state (balances, fids, keys, casts, names), stub.calls (every request: kind, method, path, status),
// stub.fund(address, wei), stub.failNext(kind, status, n, skip) (the next n matching requests fail, after `skip` pass),
// stub.close().
import http from "node:http";
import { blake3 } from "@noble/hashes/blake3";
import { ed25519 } from "@noble/curves/ed25519";
import { parseTransaction, recoverTransactionAddress, decodeFunctionData, decodeAbiParameters, parseAbi, recoverTypedDataAddress, keccak256, encodeAbiParameters } from "viem";

export const FORBIDDEN_PORTS = new Set([3001, 4001, 3023, 3029, 3011, 4319, 4321, 4057, 4063, 3091, 4091, 3009, 4009]);
export const ADDR = Object.freeze({
  ID_GATEWAY: "0x00000000fc25870c6ed6b6c7e41fb078b7656f69",
  ID_REGISTRY: "0x00000000fc6c5f01fc30151999387bb99a9f489b",
  KEY_GATEWAY: "0x00000000fc56947c7e7183f8ca4b62398caadf0b",
  KEY_REGISTRY: "0x00000000fc1237824fb747abde0ff18990e59b7e",
  STORAGE_REGISTRY: "0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d",
  GAS_ORACLE: "0x420000000000000000000000000000000000000f",
});
const ABI = parseAbi([
  "function price() view returns (uint256)",
  "function ethUsdPrice() view returns (uint256)",
  "function unitPrice() view returns (uint256)",
  "function idOf(address) view returns (uint256)",
  "function keyDataOf(uint256 fid, bytes key) view returns ((uint8 state, uint32 keyType))",
  "function getL1Fee(bytes) view returns (uint256)",
  "function register(address recovery) payable returns (uint256 fid, uint256 overpayment)",
  "function add(uint32 keyType, bytes key, uint8 metadataType, bytes metadata)",
  "function nonces(address owner) view returns (uint256)",
  "function registerFor(address to, address recovery, uint256 deadline, bytes sig) payable returns (uint256 fid, uint256 overpayment)",
  "function addFor(address fidOwner, uint32 keyType, bytes key, uint8 metadataType, bytes metadata, uint256 deadline, bytes sig)",
]);
// the KeyGateway's EIP-712 domain (EIP712("Farcaster KeyGateway", "1") in KeyGateway.sol; its live domainSeparatorV4 matched
// this on 2026-11-05) and the Add message addFor checks
const ADD_DOMAIN = { name: "Farcaster KeyGateway", version: "1", chainId: 10, verifyingContract: "0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B" };
const ADD_TYPES = { Add: [{ name: "owner", type: "address" }, { name: "keyType", type: "uint32" }, { name: "key", type: "bytes" }, { name: "metadataType", type: "uint8" }, { name: "metadata", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
// the IdGateway's EIP-712 domain (EIP712("Farcaster IdGateway", "1") in IdGateway.sol; its live domainSeparatorV4 matched
// this on 2026-11-05) and the Register message registerFor checks
const REGISTER_DOMAIN = { name: "Farcaster IdGateway", version: "1", chainId: 10, verifyingContract: "0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69" };
const REGISTER_TYPES = { Register: [{ name: "to", type: "address" }, { name: "recovery", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const SKR_DOMAIN = { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" };
const SKR_TYPES = { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] };
const FNAME_DOMAIN = { name: "Farcaster name verification", version: "1", chainId: 1, verifyingContract: "0xe3be01d99baa8db9905b33a3ca391238234b79d1" };
const FNAME_TYPES = { UserNameProof: [{ name: "name", type: "string" }, { name: "timestamp", type: "uint256" }, { name: "owner", type: "address" }] };
const FC_EPOCH = 1_609_459_200_000;
const lc = (s) => String(s).toLowerCase();

// ---------------------------------------------------------------------------------------------- an independent decoder
function readVarint(b, i) {
  let v = 0n, s = 0n;
  for (;;) {
    if (i >= b.length) throw new Error("truncated varint");
    const x = b[i++];
    v |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return [v, i];
    s += 7n;
  }
}
/** { field: [values] } — varints as BigInt, length-delimited as Uint8Array */
export function decodeProto(b) {
  const out = {};
  let i = 0;
  while (i < b.length) {
    let key;
    [key, i] = readVarint(b, i);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    let val;
    if (wire === 0) [val, i] = readVarint(b, i);
    else if (wire === 2) {
      let len;
      [len, i] = readVarint(b, i);
      val = b.subarray(i, i + Number(len));
      i += Number(len);
    } else throw new Error("unsupported wire type " + wire);
    (out[field] ??= []).push(val);
  }
  return out;
}
const one = (o, f) => (o[f] ? o[f][0] : undefined);
const hex = (u) => "0x" + Buffer.from(u).toString("hex");

export async function startProtocolStub({ port = 0, ethUsd = 2298.13, priceWei = 87_027_278_700_509n, gasPrice = 1_000_353n, l1FeeWei = 30_000_000_000n, firstFid = 990001, hubSyncDelayMs = 0, now = () => Date.now() } = {}) {
  if (FORBIDDEN_PORTS.has(port)) throw new Error("port " + port + " is reserved");
  const st = {
    balances: new Map(), nonces: new Map(), fidOf: new Map(), custodyOf: new Map(), keys: new Map(), // keys: "fid:pubhex" -> {state,keyType,at}
    txs: new Map(), // hash -> {receipt}
    nextFid: firstFid, block: 1000n, casts: new Map(), // hash -> {fid, text, ts, removed}
    userData: new Map(), names: new Map(), // name -> {to, owner, timestamp}
    priceWei, ethUsd, gasPrice, l1FeeWei, spent: 0n,
    gatewayNonces: new Map(), // address -> the IdGateway's next Register nonce (registerFor)
    keyGatewayNonces: new Map(), // address -> the KeyGateway's next Add nonce (addFor)
    keyPaidBy: {}, // "fid:pubhex" -> the address that SENT the addFor (paid its gas)
    // FOLLOWING FROM THE HUB: fid -> [{target, ts}] (ts in Farcaster seconds, oldest first), and two cast indexes
    links: new Map(), castIdx: new Map(), byParent: new Map(),
  };
  // the browser's reads, steered and recorded (see the header). `shardedParents`: castsByParent answers the real node's
  // way too (per shard, a token that never ends); off by default so the Following suites keep their one-shard answers.
  const hubRead = { delayMs: 0, fails: [], rate: null, inFlight: 0, maxInFlight: 0, preflights: 0, reads: [], shardedParents: false };
  /** every cast goes in through here, so the per-fid and per-parent indexes can never disagree with st.casts */
  function putCast(h, rec) {
    st.casts.set(h, rec);
    if (!st.castIdx.has(rec.fid)) st.castIdx.set(rec.fid, new Set());
    st.castIdx.get(rec.fid).add(h);
    if (rec.parent && rec.parent.hash) {
      const k = lc(rec.parent.hash);
      if (!st.byParent.has(k)) st.byParent.set(k, new Set());
      st.byParent.get(k).add(h);
    }
  }
  const calls = [];
  const fails = [];
  const forced = (kind) => {
    const f = fails.find((x) => (x.kind === kind || x.kind === "*") && x.n > 0);
    if (!f) return null;
    if (f.skip > 0) {
      f.skip--;
      return null;
    }
    f.n--;
    return f.status;
  };
  const bal = (a) => st.balances.get(lc(a)) ?? 0n;

  // ---- the chain
  const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
  function ethCall(to, data) {
    to = lc(to);
    let d;
    try {
      d = decodeFunctionData({ abi: ABI, data });
    } catch {
      throw new Error("execution reverted (unknown selector)");
    }
    if (to === ADDR.ID_GATEWAY && d.functionName === "price") return word(st.priceWei);
    if (to === ADDR.ID_GATEWAY && d.functionName === "nonces") return word(st.gatewayNonces.get(lc(d.args[0])) ?? 0);
    if (to === ADDR.KEY_GATEWAY && d.functionName === "nonces") return word(st.keyGatewayNonces.get(lc(d.args[0])) ?? 0);
    if (to === ADDR.STORAGE_REGISTRY && d.functionName === "ethUsdPrice") return word(BigInt(Math.round(st.ethUsd * 1e8)));
    if (to === ADDR.STORAGE_REGISTRY && d.functionName === "unitPrice") return word(st.priceWei);
    if (to === ADDR.ID_REGISTRY && d.functionName === "idOf") return word(st.fidOf.get(lc(d.args[0])) ?? 0);
    if (to === ADDR.KEY_REGISTRY && d.functionName === "keyDataOf") {
      const k = st.keys.get(String(d.args[0]) + ":" + lc(d.args[1]).slice(2));
      return encodeAbiParameters([{ type: "tuple", components: [{ name: "state", type: "uint8" }, { name: "keyType", type: "uint32" }] }], [{ state: k ? k.state : 0, keyType: k ? k.keyType : 0 }]);
    }
    if (to === ADDR.GAS_ORACLE && d.functionName === "getL1Fee") return word(st.l1FeeWei);
    throw new Error("execution reverted (no such function at that address)");
  }
  /** IdGateway.registerFor's checks, in the contract's order (the signature and deadline, then the registry's HasId,
   *  then the payment); null or the revert reason. `commit` applies it (the fid to `to`, the nonce used, the sender pays). */
  async function registerFor(from, args, value, commit) {
    const [rto, recovery, deadline, sig] = args;
    const toL = lc(rto);
    if (BigInt(Math.floor(now() / 1000)) > deadline) return "SignatureExpired";
    const nonce = BigInt(st.gatewayNonces.get(toL) ?? 0);
    let rec = null;
    try {
      rec = lc(await recoverTypedDataAddress({ domain: REGISTER_DOMAIN, types: REGISTER_TYPES, primaryType: "Register", message: { to: rto, recovery, nonce, deadline }, signature: sig }));
    } catch {
      rec = null;
    }
    if (rec !== toL) return "InvalidSignature";
    if (st.fidOf.has(toL)) return "HasId";
    if ((value ?? 0n) < st.priceWei) return "InsufficientPayment";
    if (!commit) return null;
    const fid = st.nextFid++;
    st.fidOf.set(toL, fid);
    st.custodyOf.set(fid, toL);
    st.recovery = { ...(st.recovery || {}), [fid]: lc(recovery) };
    st.gatewayNonces.set(toL, Number(nonce) + 1);
    st.balances.set(from, bal(from) - st.priceWei); // the SENDER pays the rent; the overpayment is refunded to it
    st.spent += st.priceWei;
    st.paidBy = { ...(st.paidBy || {}), [fid]: from };
    return null;
  }
  /** apply a decoded tx; returns null or a revert reason */
  async function apply(from, tx) {
    const to = lc(tx.to || "");
    let d;
    try {
      d = decodeFunctionData({ abi: ABI, data: tx.data || "0x" });
    } catch {
      return "unknown selector";
    }
    if (to === ADDR.ID_GATEWAY && d.functionName === "registerFor") return registerFor(from, d.args, tx.value ?? 0n, true);
    if (to === ADDR.ID_GATEWAY && d.functionName === "register") {
      if (st.fidOf.has(from)) return "HasId";
      if ((tx.value ?? 0n) < st.priceWei) return "InsufficientPayment";
      const fid = st.nextFid++;
      st.fidOf.set(from, fid);
      st.custodyOf.set(fid, from);
      st.recovery = { ...(st.recovery || {}), [fid]: lc(d.args[0]) };
      st.balances.set(from, bal(from) - st.priceWei); // the overpayment is refunded
      st.spent += st.priceWei;
      return null;
    }
    if (to === ADDR.KEY_GATEWAY && d.functionName === "add") {
      const fid = st.fidOf.get(from);
      if (!fid) return "Unauthorized (the sender has no fid)";
      return keyRegistryAdd(fid, d.args, true);
    }
    if (to === ADDR.KEY_GATEWAY && d.functionName === "addFor") return addFor(from, d.args, true);
    return "no such function";
  }
  /** KeyRegistry.add's checks for an fid that has been found (the key type, the SignedKeyRequest metadata recovered to
   *  the requestFid's custody, the key not yet added); null or the revert reason. `commit` adds the key. */
  async function keyRegistryAdd(fid, [keyType, key, metadataType, metadata], commit) {
    if (keyType !== 1 || metadataType !== 1) return "InvalidKeyType";
    let m;
    try {
      [m] = decodeAbiParameters([{ type: "tuple", components: [{ name: "requestFid", type: "uint256" }, { name: "requestSigner", type: "address" }, { name: "signature", type: "bytes" }, { name: "deadline", type: "uint256" }] }], metadata);
    } catch {
      return "InvalidMetadata (not abi-encoded)";
    }
    if (BigInt(Math.floor(now() / 1000)) > m.deadline) return "InvalidMetadata (expired)";
    const custody = st.custodyOf.get(Number(m.requestFid));
    if (!custody || lc(m.requestSigner) !== custody) return "InvalidMetadata (requestSigner is not the requestFid's custody)";
    const rec = lc(await recoverTypedDataAddress({ domain: SKR_DOMAIN, types: SKR_TYPES, primaryType: "SignedKeyRequest", message: { requestFid: m.requestFid, key, deadline: m.deadline }, signature: m.signature }));
    if (rec !== custody) return "InvalidMetadata (signature)";
    const k = fid + ":" + lc(key).slice(2);
    if (st.keys.get(k)?.state === 1) return "InvalidState (key already added)";
    if (!commit) return null;
    st.keys.set(k, { state: 1, keyType: 1, at: now() });
    return null;
  }
  /** KeyGateway.addFor's checks, in KeyGateway.sol's order (the deadline and the Add signature over the gateway's nonce
   *  for fidOwner, then KeyRegistry.add for fidOwner's fid); null or the revert reason. `commit` uses the nonce and adds
   *  the key; the SENDER (`from`, any address) only pays the gas. */
  async function addFor(from, args, commit) {
    const [fidOwner, keyType, key, metadataType, metadata, deadline, sig] = args;
    const ownerL = lc(fidOwner);
    if (BigInt(Math.floor(now() / 1000)) > deadline) return "SignatureExpired";
    const nonce = BigInt(st.keyGatewayNonces.get(ownerL) ?? 0);
    let rec = null;
    try {
      rec = lc(await recoverTypedDataAddress({ domain: ADD_DOMAIN, types: ADD_TYPES, primaryType: "Add", message: { owner: fidOwner, keyType, key, metadataType, metadata, nonce, deadline }, signature: sig }));
    } catch {
      rec = null;
    }
    if (rec !== ownerL) return "InvalidSignature";
    const fid = st.fidOf.get(ownerL);
    if (!fid) return "Unauthorized (fidOwner has no fid)";
    const why = await keyRegistryAdd(fid, [keyType, key, metadataType, metadata], commit);
    if (why || !commit) return why;
    st.keyGatewayNonces.set(ownerL, Number(nonce) + 1);
    st.keyPaidBy[fid + ":" + lc(key).slice(2)] = from;
    return null;
  }
  async function rpc(method, params) {
    const f = forced("rpc:" + method) ?? forced("rpc");
    if (f) return { httpStatus: f };
    switch (method) {
      case "eth_chainId": return { result: "0xa" };
      case "eth_blockNumber": return { result: "0x" + st.block.toString(16) };
      case "eth_gasPrice": return { result: "0x" + st.gasPrice.toString(16) };
      case "eth_maxPriorityFeePerGas": return { result: "0x" + (st.gasPrice / 4n || 1n).toString(16) };
      case "eth_getBlockByNumber": return { result: { number: "0x" + st.block.toString(16), baseFeePerGas: "0x" + st.gasPrice.toString(16), timestamp: "0x" + Math.floor(now() / 1000).toString(16) } };
      case "eth_getBalance": return { result: "0x" + bal(params[0]).toString(16) };
      case "eth_getTransactionCount": return { result: "0x" + (st.nonces.get(lc(params[0])) ?? 0).toString(16) };
      case "eth_estimateGas": {
        const tx = params[0] || {};
        const to = lc(tx.to || "");
        if (to === ADDR.ID_GATEWAY) {
          let dd = null;
          try {
            dd = decodeFunctionData({ abi: ABI, data: tx.data || "0x" });
          } catch {
            dd = null;
          }
          if (dd && dd.functionName === "registerFor") {
            const value = BigInt(tx.value || "0x0");
            if (value > bal(tx.from)) return { error: { code: -32000, message: "insufficient funds for transfer" } };
            const why = await registerFor(lc(tx.from), dd.args, value, false);
            if (why) return { error: { code: 3, message: "execution reverted: " + why } };
            return { result: "0x" + (189_991).toString(16) };
          }
          if (st.fidOf.has(lc(tx.from))) return { error: { code: 3, message: "execution reverted: HasId" } };
          if (BigInt(tx.value || "0x0") > bal(tx.from)) return { error: { code: -32000, message: "insufficient funds for transfer" } };
          return { result: "0x" + (145_491).toString(16) };
        }
        if (to === ADDR.KEY_GATEWAY) {
          let dk = null;
          try {
            dk = decodeFunctionData({ abi: ABI, data: tx.data || "0x" });
          } catch {
            dk = null;
          }
          if (dk && dk.functionName === "addFor") {
            const why = await addFor(lc(tx.from), dk.args, false);
            if (why) return { error: { code: 3, message: "execution reverted: " + why } };
            // gasUsed of six mainnet addFor transactions on 2026-11-05: 179,461 to 179,677
            return { result: "0x" + (179_509).toString(16) };
          }
          if (!st.fidOf.has(lc(tx.from))) return { error: { code: 3, message: "execution reverted: Unauthorized" } };
          return { result: "0x" + (190_000).toString(16) };
        }
        return { error: { code: 3, message: "execution reverted" } };
      }
      case "eth_call": {
        try {
          return { result: ethCall(params[0].to, params[0].data) };
        } catch (e) {
          return { error: { code: 3, message: e.message } };
        }
      }
      case "eth_sendRawTransaction": {
        const raw = params[0];
        const hash = keccak256(raw);
        if (st.txs.has(hash)) return { error: { code: -32000, message: "already known" } };
        let tx, from;
        try {
          tx = parseTransaction(raw);
          from = lc(await recoverTransactionAddress({ serializedTransaction: raw }));
        } catch {
          return { error: { code: -32602, message: "invalid raw transaction" } };
        }
        if (tx.chainId !== 10) return { error: { code: -32000, message: "invalid chain id" } };
        const nonce = st.nonces.get(from) ?? 0;
        if (tx.nonce !== nonce) return { error: { code: -32000, message: tx.nonce < nonce ? "nonce too low" : "nonce too high" } };
        const gasCost = BigInt(tx.gas) * st.gasPrice + st.l1FeeWei;
        if (bal(from) < (tx.value ?? 0n) + BigInt(tx.gas) * BigInt(tx.maxFeePerGas ?? st.gasPrice)) return { error: { code: -32000, message: "insufficient funds for gas * price + value" } };
        st.nonces.set(from, nonce + 1);
        st.balances.set(from, bal(from) - gasCost);
        st.spent += gasCost;
        const revert = await apply(from, tx);
        st.block += 1n;
        st.txs.set(hash, { from, to: lc(tx.to), status: revert ? "0x0" : "0x1", revert, blockNumber: st.block });
        return { result: hash };
      }
      case "eth_getTransactionReceipt": {
        const t = st.txs.get(params[0]);
        if (!t) return { result: null };
        st.block += 1n; // each look moves the chain on, so confirmations come
        return { result: { transactionHash: params[0], status: t.status, blockNumber: "0x" + t.blockNumber.toString(16), from: t.from, to: t.to, logs: [] } };
      }
      default: return { error: { code: -32601, message: "the stub does not answer " + method } };
    }
  }

  // ---- the hub
  const hubErr = (msg) => ({ status: 400, body: { error: "Failed to submit message", error_detail: 'status: InvalidArgument, message: "bad_request.validation_failure/' + msg + '", details: [], metadata: MetadataMap { headers: {} }' } });
  function signerActiveAt(fid, pub) {
    const k = st.keys.get(fid + ":" + pub);
    return !!k && k.state === 1 && now() - k.at >= hubSyncDelayMs;
  }
  function submit(buf) {
    let m, d;
    try {
      m = decodeProto(buf);
      const dataBytes = one(m, 7) ?? one(m, 1);
      d = decodeProto(dataBytes);
      const hash = one(m, 2), sig = one(m, 4), signer = one(m, 6);
      if (!hash || !sig || !signer) return hubErr("missing hash, signature or signer");
      if (Number(one(m, 3)) !== 1 || Number(one(m, 5)) !== 1) return hubErr("invalid scheme");
      if (hex(blake3(dataBytes, { dkLen: 20 })) !== hex(hash)) return hubErr("invalid hash");
      if (!ed25519.verify(sig, hash, signer)) return hubErr("invalid signature");
      const fid = Number(one(d, 2) ?? 0n);
      if (!fid) return { status: 400, body: { error: "Failed to submit message", error_detail: 'status: InvalidArgument, message: "bad_request.invalid_param/fid cannot be 0"' } };
      if (Number(one(d, 4)) !== 1) return hubErr("invalid network");
      const ts = FC_EPOCH + Number(one(d, 3) ?? 0n) * 1000;
      if (Math.abs(ts - now()) > 10 * 60_000) return hubErr("timestamp too far from now");
      if (!signerActiveAt(fid, Buffer.from(signer).toString("hex"))) return hubErr("invalid signer");
      const type = Number(one(d, 1));
      const h = hex(hash);
      if (type === 1) {
        const body = decodeProto(one(d, 5));
        const text = Buffer.from(one(body, 4) ?? []).toString("utf8");
        if (Buffer.byteLength(text) > 320) return hubErr("text too long");
        if (st.casts.has(h)) return { status: 400, body: { error: "Failed to submit message", error_detail: 'status: AlreadyExists, message: "bad_request.duplicate/message has already been merged"' } };
        // POST AS YOU: a reply's parent (CastAddBody field 3, a CastId { 1 fid, 2 hash }) is kept, so a suite can check it
        const parentRaw = one(body, 3);
        let parent = null;
        if (parentRaw) {
          const pc = decodeProto(parentRaw);
          parent = { fid: Number(one(pc, 1) ?? 0n), hash: hex(one(pc, 2) ?? []) };
          if (!parent.fid || parent.hash.length !== 42) return hubErr("invalid parent cast id");
        }
        putCast(h, { fid, text, ts, removed: false, parent });
      } else if (type === 2) {
        const body = decodeProto(one(d, 6));
        const target = hex(one(body, 1) ?? []);
        const c = st.casts.get(target);
        if (!c || c.fid !== fid) return { status: 400, body: { error: "Failed to submit message", error_detail: 'status: NotFound, message: "not_found/cast not found"' } };
        c.removed = true;
      } else if (type === 11) {
        const body = decodeProto(one(d, 12));
        const field = Number(one(body, 1)), value = Buffer.from(one(body, 2) ?? []).toString("utf8");
        if (field === 6) {
          const n = st.names.get(value);
          if (!n || n.to !== fid) return hubErr("username proof not found for fid");
        }
        st.userData.set(fid + ":" + field, value);
      } else if (type === 3 || type === 4) {
        // POST AS YOU: ReactionAdd / ReactionRemove (MessageData field 7: ReactionBody { 1 type LIKE=1 | RECAST=2,
        // 2 target_cast_id CastId { 1 fid, 2 hash } })
        const body = decodeProto(one(d, 7) ?? new Uint8Array(0));
        const kind = Number(one(body, 1) ?? 0n);
        const tc = one(body, 2);
        if (kind !== 1 && kind !== 2) return hubErr("invalid reaction type");
        if (!tc) return hubErr("reaction has no target cast id");
        const t = decodeProto(tc);
        const target = { fid: Number(one(t, 1) ?? 0n), hash: hex(one(t, 2) ?? []) };
        if (!target.fid || target.hash.length !== 42) return hubErr("invalid target cast id");
        const rk = fid + ":" + kind + ":" + target.hash;
        st.reactions ??= new Map();
        if (type === 3) st.reactions.set(rk, { fid, kind, target, at: ts });
        else st.reactions.delete(rk);
      } else return hubErr("unsupported message type");
      return { status: 200, body: { hash: h, data: { fid, type } } };
    } catch (e) {
      return hubErr("malformed message: " + e.message);
    }
  }
  // the real node's JSON for a CastAdd (checked 2026-11-05: parentCastId {fid, hash} or null, parentUrl, embeds [{url} |
  // {castId: {fid, hash}}], mentions [fid] with their UTF-8 byte positions in the text)
  const castMsg = (h, c) => ({ data: { type: "MESSAGE_TYPE_CAST_ADD", fid: c.fid, timestamp: Math.floor((c.ts - FC_EPOCH) / 1000), network: "FARCASTER_NETWORK_MAINNET", castAddBody: { embedsDeprecated: [], mentions: c.mentions ?? [], parentCastId: c.parent ? { fid: c.parent.fid, hash: c.parent.hash } : null, parentUrl: c.parentUrl ?? null, text: c.text, embeds: c.embeds ?? [], mentionsPositions: c.mentionsPositions ?? [], type: "CAST" } }, hash: h, hashScheme: "HASH_SCHEME_BLAKE3", signatureScheme: "SIGNATURE_SCHEME_ED25519" });
  const linkMsg = (fid, l) => ({ data: { type: "MESSAGE_TYPE_LINK_ADD", fid, timestamp: l.ts, network: "FARCASTER_NETWORK_MAINNET", linkBody: { type: "follow", displayTimestamp: null, targetFid: l.target } }, hash: "0x" + Buffer.from(blake3(new TextEncoder().encode("link:" + fid + ":" + l.target), { dkLen: 20 })).toString("hex"), hashScheme: "HASH_SCHEME_BLAKE3", signatureScheme: "SIGNATURE_SCHEME_ED25519" });
  /** an opaque page token (the offset, base64url): the real node's tokens are opaque too */
  const tokenOf = (n) => Buffer.from("o:" + n).toString("base64url");
  const offsetOf = (t) => {
    if (!t) return 0;
    const s = Buffer.from(String(t), "base64url").toString("utf8");
    const m = /^o:(\d+)$/.exec(s);
    return m ? Number(m[1]) : -1;
  };
  /** one page of a list, the node's way: pageSize (default 100 here), pageToken, and "" once there is no more */
  function page(list, url) {
    const n = Math.max(1, Math.min(10_000, Number(url.searchParams.get("pageSize") || 100)));
    const off = offsetOf(url.searchParams.get("pageToken"));
    if (off < 0) return null;
    const slice = list.slice(off, off + n);
    return { slice, nextPageToken: off + n < list.length ? tokenOf(off + n) : "" };
  }
  // NOTIFICATIONS FROM FARCASTER — the real node's BY-TARGET indexes (measured read-only 2026-11-06): answered PER SHARD.
  // Each of the two shards (an account's shard here: its fid's parity) returns its own `pageSize` items, its own order,
  // and the two are concatenated, so a page holds up to twice pageSize and is not in order across shards. The token
  // carries both shards' offsets; castsByParent's (with shardedParents) never ends: past the last item it starts over.
  const SHARDS = 2;
  const shardTokenOf = (offs) => Buffer.from("s:" + offs.join(",")).toString("base64url");
  const shardOffsets = (t) => {
    if (!t) return Array(SHARDS).fill(0);
    const m = /^s:(\d+(?:,\d+)*)$/.exec(Buffer.from(String(t), "base64url").toString("utf8"));
    const offs = m ? m[1].split(",").map(Number) : null;
    return offs && offs.length === SHARDS ? offs : null;
  };
  /** `list` oldest first, each item with the `fid` that places it in a shard */
  function shardPage(list, url, { wrap = false } = {}) {
    const n = Math.max(1, Math.min(10_000, Number(url.searchParams.get("pageSize") || 1000)));
    const offs = shardOffsets(url.searchParams.get("pageToken"));
    if (!offs) return null;
    const reverse = url.searchParams.get("reverse") === "true";
    const out = [];
    const next = [];
    let more = false;
    for (let s = 0; s < SHARDS; s++) {
      const mine = list.filter((x) => x.fid % SHARDS === s);
      if (reverse) mine.reverse();
      const slice = mine.slice(offs[s], offs[s] + n);
      out.push(...slice);
      next.push(offs[s] + slice.length);
      if (offs[s] + slice.length < mine.length) more = true;
    }
    return { slice: out, nextPageToken: more ? shardTokenOf(next) : wrap ? shardTokenOf(Array(SHARDS).fill(0)) : "" };
  }
  const castsOf = (fid) => [...(st.castIdx.get(fid) ?? [])].map((h) => [h, st.casts.get(h)]).filter(([, c]) => c && !c.removed && c.fid === fid).sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : 1));
  const hubFail = (p, fid) => {
    const f = hubRead.fails.find((x) => (x.path === p || x.path === "*") && (x.fid === "*" || x.fid === fid) && x.n > 0);
    if (!f) return null;
    f.n--;
    return f.status;
  };

  /** the node's answer to one read (FOLLOWING FROM THE HUB): the real node's shapes, statuses and refusals */
  const BAD_FID = { status: 400, body: "Invalid query parameters: invalid digit found in string" };
  const REACTION_KINDS = { Like: [1], Recast: [2], None: [1, 2] };
  const REACTION_NAMES = { 1: "REACTION_TYPE_LIKE", 2: "REACTION_TYPE_RECAST" };
  const reactionMsg = (k, r) => ({ data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: r.fid, timestamp: Math.floor((r.at - FC_EPOCH) / 1000), network: "FARCASTER_NETWORK_MAINNET", reactionBody: { type: REACTION_NAMES[r.kind], targetCastId: { fid: r.target.fid, hash: r.target.hash } } }, hash: "0x" + Buffer.from(blake3(new TextEncoder().encode("reaction:" + k), { dkLen: 20 })).toString("hex"), hashScheme: "HASH_SCHEME_BLAKE3", signatureScheme: "SIGNATURE_SCHEME_ED25519" });
  /** NOTIFICATIONS FROM FARCASTER: the by-target reads, the real node's names, refusals and per-shard pages */
  function targetAnswer(p, url) {
    const tf = url.searchParams.get("target_fid");
    const targetFid = Number(tf);
    if (p === "/v1/castsByMention") {
      const f = Number(url.searchParams.get("fid"));
      if (url.searchParams.get("fid") === null || !Number.isSafeInteger(f) || f < 0) return BAD_FID;
      const list = [...st.casts.entries()].filter(([, c]) => !c.removed && Array.isArray(c.mentions) && c.mentions.includes(f)).sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : 1)).map(([h, c]) => ({ fid: c.fid, h, c }));
      const pg = shardPage(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      return { status: 200, body: { messages: pg.slice.map((x) => castMsg(x.h, x.c)), nextPageToken: pg.nextPageToken } };
    }
    if (tf === null) return { status: 400, body: "Invalid query parameters: missing field `target_fid`" };
    if (!Number.isSafeInteger(targetFid) || targetFid < 0) return BAD_FID;
    if (p === "/v1/linksByTargetFid") {
      if (!url.searchParams.get("link_type")) return { status: 400, body: { error: "Failed to get links by target fid", error_detail: 'status: InvalidArgument, message: "link_type is required", details: [], metadata: MetadataMap { headers: {} }' } };
      if (url.searchParams.get("link_type") !== "follow") return { status: 200, body: { messages: [], nextPageToken: "" } };
      const list = [];
      for (const [fid, links] of st.links) for (const l of links) if (l.target === targetFid) list.push({ fid, l });
      list.sort((a, b) => a.l.ts - b.l.ts || a.fid - b.fid);
      const pg = shardPage(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      return { status: 200, body: { messages: pg.slice.map((x) => linkMsg(x.fid, x.l)), nextPageToken: pg.nextPageToken } };
    }
    // /v1/reactionsByCast
    const rt = url.searchParams.get("reaction_type");
    if (rt !== null && !REACTION_KINDS[rt]) return { status: 400, body: "Invalid query parameters: unknown variant `" + rt + "`, expected one of `None`, `Like`, `Recast`" };
    const th = lc(url.searchParams.get("target_hash") || "");
    if (!th) return { status: 400, body: "Invalid query parameters: missing field `target_hash`" };
    const want = REACTION_KINDS[rt ?? "None"];
    const list = [...(st.reactions ?? new Map()).entries()].filter(([, r]) => r.target.fid === targetFid && r.target.hash === th && want.includes(r.kind)).sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1)).map(([k, r]) => ({ fid: r.fid, k, r }));
    const pg = shardPage(list, url);
    if (!pg) return { status: 400, body: { error: "invalid page token" } };
    return { status: 200, body: { messages: pg.slice.map((x) => reactionMsg(x.k, x.r)), nextPageToken: pg.nextPageToken } };
  }
  function readAnswer(p, url, fid) {
    if (["/v1/linksByTargetFid", "/v1/castsByMention", "/v1/reactionsByCast"].includes(p)) return targetAnswer(p, url);
    if (!Number.isSafeInteger(fid) || fid < 0 || url.searchParams.get("fid") === null) return BAD_FID;
    const reverse = url.searchParams.get("reverse") === "true";
    if (p === "/v1/userDataByFid") {
      const NAMES = { 1: "USER_DATA_TYPE_PFP", 2: "USER_DATA_TYPE_DISPLAY", 3: "USER_DATA_TYPE_BIO", 5: "USER_DATA_TYPE_URL", 6: "USER_DATA_TYPE_USERNAME" };
      const messages = [...st.userData.entries()].filter(([k]) => k.startsWith(fid + ":")).map(([k, value]) => ({ data: { type: "MESSAGE_TYPE_USER_DATA_ADD", fid, userDataBody: { type: NAMES[k.split(":")[1]], value } } }));
      return { status: 200, body: { messages, nextPageToken: "" } };
    }
    if (p === "/v1/linksByFid") {
      if (url.searchParams.get("link_type") !== "follow") return { status: 200, body: { messages: [], nextPageToken: "" } };
      let list = [...(st.links.get(fid) ?? [])];
      if (reverse) list.reverse();
      const pg = page(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      return { status: 200, body: { messages: pg.slice.map((l) => linkMsg(fid, l)), nextPageToken: pg.nextPageToken } };
    }
    if (p === "/v1/castsByFid") {
      let list = castsOf(fid);
      if (reverse) list.reverse();
      const pg = page(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      return { status: 200, body: { messages: pg.slice.map(([h, c]) => castMsg(h, c)), nextPageToken: pg.nextPageToken } };
    }
    if (p === "/v1/reactionsByFid") {
      // the real node's names (2026-11-05): `Like`, `Recast` (and `None`); the hub-style REACTION_TYPE_LIKE is refused
      const rt = url.searchParams.get("reaction_type");
      const kinds = { Like: [1], Recast: [2], None: [1, 2] };
      // SPEC B (measured read-only 2026-11-07): the real node REQUIRES reaction_type on reactionsByFid
      if (rt === null) return { status: 400, body: "Invalid query parameters: missing field `reaction_type`" };
      if (!kinds[rt]) return { status: 400, body: "Invalid query parameters: unknown variant `" + rt + "`, expected one of `None`, `Like`, `Recast`" };
      const want = kinds[rt ?? "None"];
      let list = [...(st.reactions ?? new Map()).entries()].filter(([, r]) => r.fid === fid && want.includes(r.kind)).sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1));
      if (reverse) list.reverse();
      const pg = page(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      const NAMES = { 1: "REACTION_TYPE_LIKE", 2: "REACTION_TYPE_RECAST" };
      const messages = pg.slice.map(([k, r]) => ({ data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: r.fid, timestamp: Math.floor((r.at - FC_EPOCH) / 1000), network: "FARCASTER_NETWORK_MAINNET", reactionBody: { type: NAMES[r.kind], targetCastId: { fid: r.target.fid, hash: r.target.hash } } }, hash: "0x" + Buffer.from(blake3(new TextEncoder().encode("reaction:" + k), { dkLen: 20 })).toString("hex"), hashScheme: "HASH_SCHEME_BLAKE3", signatureScheme: "SIGNATURE_SCHEME_ED25519" }));
      return { status: 200, body: { messages, nextPageToken: pg.nextPageToken } };
    }
    if (p === "/v1/castsByParent") {
      const ph = lc(url.searchParams.get("hash") || "");
      const list = [...(st.byParent.get(ph) ?? [])].map((h) => [h, st.casts.get(h)]).filter(([, c]) => c && !c.removed && c.parent && c.parent.fid === fid).sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : 1));
      if (hubRead.shardedParents) {
        // the real node's way (measured 2026-11-06): per shard, and a token that never ends (it starts over)
        const sp = shardPage(list.map(([h, c]) => ({ fid: c.fid, h, c })), url, { wrap: true });
        if (!sp) return { status: 400, body: { error: "invalid page token" } };
        return { status: 200, body: { messages: sp.slice.map((x) => castMsg(x.h, x.c)), nextPageToken: sp.nextPageToken } };
      }
      if (reverse) list.reverse();
      const pg = page(list, url);
      if (!pg) return { status: 400, body: { error: "invalid page token" } };
      return { status: 200, body: { messages: pg.slice.map(([h, c]) => castMsg(h, c)), nextPageToken: pg.nextPageToken } };
    }
    // /v1/castById
    const h = lc(url.searchParams.get("hash") || "");
    const c = st.casts.get(h);
    if (!c || c.removed || c.fid !== fid) return { status: 400, body: { error: "Failed to get cast", error_detail: 'status: NotFound, message: "cast not found", details: [], metadata: MetadataMap { headers: {} }' } };
    return { status: 200, body: castMsg(h, c) };
  }

  // ---- planting a graph (FOLLOWING FROM THE HUB): accounts, follows, casts and profiles, no signatures needed
  const fcSeconds = (ms) => Math.floor((ms - FC_EPOCH) / 1000);
  const castHash = (seed) => "0x" + Buffer.from(blake3(new TextEncoder().encode("planted-cast:" + seed), { dkLen: 20 })).toString("hex");
  /** profile {username, display, pfp, bio}: the UserData the node would hold */
  function plantProfile(fid, prof) {
    if (!prof) return;
    if (prof.username) st.userData.set(fid + ":6", prof.username);
    if (prof.display) st.userData.set(fid + ":2", prof.display);
    if (prof.pfp) st.userData.set(fid + ":1", prof.pfp);
    if (prof.bio) st.userData.set(fid + ":3", prof.bio);
  }
  /** a cast {fid, text, ts (ms), parent?, embeds?, mentions?, mentionsPositions?, seed?|hash?} → its hash */
  function plantCast(c) {
    const h = lc(c.hash ?? castHash(c.seed ?? c.fid + ":" + c.ts + ":" + c.text));
    putCast(h, { fid: c.fid, text: c.text ?? "", ts: c.ts, removed: false, parent: c.parent ?? null, embeds: c.embeds ?? [], mentions: c.mentions ?? [], mentionsPositions: c.mentionsPositions ?? [], parentUrl: c.parentUrl ?? null });
    return h;
  }
  /** a reaction {fid, kind: "like"|"recast", target: {fid, hash}, ts (ms)} the node holds, as if the account had made it */
  function plantReaction(r) {
    const kind = r.kind === "recast" ? 2 : 1;
    const target = { fid: r.target.fid, hash: lc(r.target.hash) };
    st.reactions ??= new Map();
    st.reactions.set(r.fid + ":" + kind + ":" + target.hash, { fid: r.fid, kind, target, at: r.ts ?? now() });
  }
  /** fid follows targets (each {fid, ts ms}), oldest follow first, as the node orders them */
  function plantFollows(fid, targets) {
    const list = targets.map((t) => ({ target: t.fid, ts: fcSeconds(t.ts) })).sort((a, b) => a.ts - b.ts);
    st.links.set(fid, list);
  }
  /** NOTIFICATIONS FROM FARCASTER: `fid` follows `target` at `ts` (ms), added to what it already follows (a follower of
   *  the root, for linksByTargetFid); `remove: true` is its unfollow */
  function plantFollow({ fid, target, ts, remove = false }) {
    const list = (st.links.get(fid) ?? []).filter((l) => l.target !== target);
    if (!remove) list.push({ target, ts: fcSeconds(ts ?? now()) });
    list.sort((a, b) => a.ts - b.ts);
    st.links.set(fid, list);
  }
  /** a reaction gone (ReactionRemove) */
  function removeReaction({ fid, kind, target }) {
    const k = fid + ":" + (kind === "recast" ? 2 : 1) + ":" + lc(target.hash);
    return st.reactions ? st.reactions.delete(k) : false;
  }
  /** a deterministic synthetic graph: `root` follows n accounts (fids from `base`), each with castsPer casts spread over
   *  `spanDays`; one prolific account (30 casts in the last hour), replies between them, mentions, url embeds, a quote, and
   *  one cast dated decades ahead (a real node holds those: fid 347's "time traveling" cast, seen 2026-11-05). */
  function plantSynthetic({ root, n, castsPer = 6, base = 2_000_000, spanDays = 14, nowMs = Date.now(), prolific = true, future = true, seed = 1, rootProfile = null } = {}) {
    let x = seed >>> 0 || 1;
    const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
    const fids = Array.from({ length: n }, (_, i) => base + i);
    plantFollows(root, fids.map((f, i) => ({ fid: f, ts: nowMs - (n - i) * 3_600_000 })));
    if (rootProfile) plantProfile(root, rootProfile);
    const made = [];
    for (const [i, f] of fids.entries()) {
      // the picture sits on a host no client loads by itself (.invalid, off Totem's media allowlist): a browser suite's
      // "nothing left the machine" stays true, and the card shows its click-to-load placeholder
      plantProfile(f, { username: "acct" + (f - base), display: "Account " + (f - base), pfp: "https://pfp.stub.invalid/" + f + ".png", bio: "synthetic account " + (f - base) });
      const k = prolific && i === 0 ? 30 : castsPer;
      for (let j = 0; j < k; j++) {
        const ts = prolific && i === 0 ? nowMs - Math.floor(rnd() * 3_600_000) : nowMs - Math.floor(rnd() * spanDays * 86_400_000);
        const c = { fid: f, ts: ts - (ts % 1000), text: "post " + j + " by acct" + (f - base), seed: seed + ":" + f + ":" + j };
        if (made.length > 3 && rnd() < 0.15) {
          const parent = made[Math.floor(rnd() * made.length)];
          c.parent = { fid: parent.fid, hash: parent.hash };
          c.text = "a reply by acct" + (f - base) + " (" + j + ")";
        } else if (made.length > 3 && rnd() < 0.08) {
          const m = made[Math.floor(rnd() * made.length)];
          c.text = "gm  and thanks";
          c.mentions = [m.fid];
          c.mentionsPositions = [3];
        } else if (rnd() < 0.08) c.embeds = [{ url: "https://example.org/article/" + f + "/" + j }];
        else if (made.length > 3 && rnd() < 0.05) {
          const q = made[Math.floor(rnd() * made.length)];
          c.embeds = [{ castId: { fid: q.fid, hash: q.hash } }];
          c.text = "quoting this";
        }
        made.push({ fid: f, hash: plantCast(c), ts: c.ts });
      }
    }
    if (future && fids.length > 1) made.push({ fid: fids[1], hash: plantCast({ fid: fids[1], ts: nowMs + 40 * 365 * 86_400_000, text: "oh so we're time traveling now?", seed: seed + ":future" }), ts: nowMs + 40 * 365 * 86_400_000 });
    return { root, base, n, casts: made.length, prolificFid: prolific ? base : null, futureFid: future && n > 1 ? base + 1 : null };
  }
  /** the ground truth (FOLLOWING FROM THE HUB): every live cast by `root` and the accounts it follows, newest first,
   *  without casts dated more than `skewMs` ahead (the device leaves those out of the order) */
  function truth(root, { limit = 100, skewMs = 600_000, nowMs = Date.now(), accounts = null } = {}) {
    const fids = new Set([root, ...(st.links.get(root) ?? []).map((l) => l.target)]);
    const allowed = accounts ? new Set(accounts) : null;
    const out = [];
    for (const f of fids) {
      if (allowed && !allowed.has(f)) continue;
      for (const [h, c] of castsOf(f)) if (c.ts <= nowMs + skewMs) out.push({ hash: h, fid: f, ts: c.ts, text: c.text, parent: c.parent ?? null });
    }
    out.sort((a, b) => b.ts - a.ts || (a.hash < b.hash ? 1 : -1));
    return out.slice(0, limit);
  }

  // ---- SPEC B (FOR YOU FROM THE HUB): a deterministic 2-hop graph and its ground truth
  const whole = (ms) => ms - (ms % 1000);
  /** `root` follows `follows` accounts (fids base.., the LAST the most recently followed); the `active` most recently
   *  followed of them liked posts in the last hours (the rest only 400 days ago); `outer` accounts beyond the follows (fids
   *  outerBase..) post in the last hours, plus one post 10 days old each, and outer k is followed by the first
   *  max(0, active - k) active follows (so the most-followed order is outer0, outer1, ...), and active follow i alone also
   *  follows outer (20 + i) (accounts followed by ONE sampled follow, below the bar); active follow i likes `likesPer`
   *  posts by outer accounts ((i + j) % outer's first post: neighbours share some, so those carry several likers) and
   *  recasts one, and ALSO likes, newest of all, a post by an account the root follows and one by the root (both must stay
   *  out of For You). `own`: a persona account of the root's (its fid), followed by every active follow and liked by the
   *  first three: its casts exist, and must never be read or shown. Returns what was planted. */
  function plantTwoHop({ root, base = 3_000_000, follows = 60, active = 12, outerBase = 3_500_000, outer = 40, likesPer = 5, castsPer = 3, nowMs = Date.now(), seed = 7, rootProfile = null, own = null, extraFollowed = [] } = {}) {
    const fl = Array.from({ length: follows }, (_, i) => base + i);
    plantFollows(root, [...fl.map((f, i) => ({ fid: f, ts: nowMs - (follows - i) * 60_000 })), ...extraFollowed.map((f, i) => ({ fid: f, ts: nowMs - (follows + 10 + i) * 60_000 }))]);
    if (rootProfile) plantProfile(root, rootProfile);
    const byRecency = [...fl].reverse();
    const act = byRecency.slice(0, active);
    const outs = Array.from({ length: outer }, (_, k) => outerBase + k);
    for (const f of fl) plantProfile(f, { username: "f" + (f - base), display: "Follow " + (f - base) });
    for (const o of outs) plantProfile(o, { username: "o" + (o - outerBase), display: "Outer " + (o - outerBase) });
    const outerCasts = new Map();
    for (const [k, o] of outs.entries()) {
      const hs = [];
      for (let j = 0; j < castsPer; j++) {
        const ts = whole(nowMs - (k * 7 + j * 3 + 5) * 60_000);
        hs.push({ hash: plantCast({ fid: o, ts, text: `outer ${k} post ${j}`, seed: `2hop:${seed}:${o}:${j}` }), fid: o, ts });
      }
      const oldTs = whole(nowMs - 10 * 86_400_000 - k * 1000);
      hs.push({ hash: plantCast({ fid: o, ts: oldTs, text: `outer ${k} old post`, seed: `2hop:${seed}:${o}:old` }), fid: o, ts: oldTs, old: true });
      outerCasts.set(o, hs);
    }
    const followedPost = { fid: fl[0], ts: whole(nowMs - 30 * 60_000) };
    followedPost.hash = plantCast({ ...followedPost, text: "a post by someone the root follows", seed: `2hop:${seed}:followed` });
    const rootPost = { fid: root, ts: whole(nowMs - 31 * 60_000) };
    rootPost.hash = plantCast({ ...rootPost, text: "the root's own post", seed: `2hop:${seed}:root` });
    let ownPost = null;
    if (own) {
      plantProfile(own, { username: "ownpersona", display: "Own Persona" });
      ownPost = { fid: own, ts: whole(nowMs - 20 * 60_000) };
      ownPost.hash = plantCast({ ...ownPost, text: "a post by the root's own persona", seed: `2hop:${seed}:own` });
    }
    for (const [i, a] of act.entries()) {
      const targets = outs.filter((_, k) => i < active - k).map((t, j) => ({ fid: t, ts: nowMs - (j + 1) * 3_600_000 }));
      if (outs[20 + i]) targets.push({ fid: outs[20 + i], ts: nowMs - 50 * 3_600_000 });
      targets.push({ fid: root, ts: nowMs - 2 * 86_400_000 }, { fid: fl[0], ts: nowMs - 3 * 86_400_000 });
      if (own) targets.push({ fid: own, ts: nowMs - 30 * 60_000 });
      plantFollows(a, targets);
      for (let j = 0; j < likesPer; j++) {
        const t = outerCasts.get(outs[(i + j) % outs.length])[0];
        plantReaction({ fid: a, kind: "like", target: { fid: t.fid, hash: t.hash }, ts: whole(nowMs - (i * 10 + j + 2) * 60_000) });
      }
      const rc = outerCasts.get(outs[(i + 1) % outs.length])[1];
      plantReaction({ fid: a, kind: "recast", target: { fid: rc.fid, hash: rc.hash }, ts: whole(nowMs - (i * 10 + 5) * 60_000) });
      // newest of all: a like of a followed account's post and of the root's (both excluded), and the own persona's
      plantReaction({ fid: a, kind: "like", target: { fid: followedPost.fid, hash: followedPost.hash }, ts: whole(nowMs - 30_000) });
      plantReaction({ fid: a, kind: "like", target: { fid: rootPost.fid, hash: rootPost.hash }, ts: whole(nowMs - 40_000) });
      if (own && i < 3) plantReaction({ fid: a, kind: "like", target: { fid: own, hash: ownPost.hash }, ts: whole(nowMs - 50_000) });
    }
    // the quiet follows: one like, 400 days ago
    for (const f of byRecency.slice(active)) {
      const t = outerCasts.get(outs[f % outs.length])[0];
      plantReaction({ fid: f, kind: "like", target: { fid: t.fid, hash: t.hash }, ts: whole(nowMs - 400 * 86_400_000) });
    }
    return { root, base, follows: fl, active: act, outer: outs, outerCasts: Object.fromEntries([...outerCasts].map(([k, v]) => [k, v])), followedPost, rootPost, ownPost };
  }
  /** what For You should show for `root` (lib/fc/hubRead/forYou.ts's design, computed from the stub's own state): the
   *  sample, the posts the sample brings in, the accounts several of them follow and their posts of the window, each with
   *  its proof. `eligible(fid)` is the keyed half (default: every account); `own` the persona fids never read.
   *  `anyHalf`: what ANY keyed half could show, for a suite that cannot know the tab's vault key. "Every account eligible"
   *  is NOT that superset (2026-11-07, accept-hub-foryou-prod FY3 failing about one run in two): a follow brings in its
   *  2 newest reactions BY ELIGIBLE ACCOUNTS, skipping a post another follow already brought in, so when a half leaves the
   *  accounts of its newest reactions out its 2 reach further down its list (and which ones also depends on the order the
   *  sample's reads come back in); and a half's top 30 accounts can rank below the top 30 of all. So with anyHalf: EVERY
   *  window reaction of the sample by an account the rules allow (not the root, not followed, not own), and EVERY account
   *  at least 2 of the sample follow. Each proof is the same either way (it never depends on the half). */
  function forYouTruth(root, { nowMs = Date.now(), eligible = () => true, own = new Set(), L = {}, anyHalf = false } = {}) {
    const C = { probeMax: 1000, probeBatch: 40, sample: 40, activeHours: 72, reactionsPage: 25, likedPerFollow: 2, likedMax: 80, linksPage: 50, minFollowedBy: 2, accounts: 30, castsPage: 5, castsWindowHours: 168, futureSkewMs: 600_000, ...L };
    const fcMs = (sec) => FC_EPOCH + sec * 1000;
    const links = [...(st.links.get(root) ?? [])].map((l) => ({ fid: l.target, ts: fcMs(l.ts) }));
    const followed = new Set(links.map((l) => l.fid));
    const list = links.sort((a, b) => b.ts - a.ts || a.fid - b.fid).map((l) => l.fid).filter((f) => f !== root && !own.has(f));
    const ok = (fid) => fid !== root && !followed.has(fid) && !own.has(fid) && eligible(fid);
    const reacts = [...(st.reactions ?? new Map()).entries()].map(([k, r]) => ({ k, ...r, ms: fcMs(Math.floor((r.at - FC_EPOCH) / 1000)) }));
    const newestOf = (f, kind, n) => reacts.filter((r) => r.fid === f && r.kind === kind).sort((a, b) => b.at - a.at || (a.k < b.k ? 1 : -1)).slice(0, n);
    const since = nowMs - C.activeHours * 3_600_000;
    const sample = [];
    let probed = 0;
    const max = Math.min(list.length, C.probeMax);
    for (let i = 0; i < max && sample.length < C.sample; i += C.probeBatch) {
      const batch = list.slice(i, Math.min(i + C.probeBatch, max));
      probed += batch.length;
      for (const f of batch) {
        const n = newestOf(f, 1, 1)[0];
        if (n && n.ms >= since && sample.length < C.sample) sample.push(f);
      }
    }
    const proof = new Map();
    const liked = [];
    const followedBy = new Map();
    for (const f of sample) {
      const mine = [...newestOf(f, 1, C.reactionsPage).map((r) => ({ ...r, kindName: "like" })), ...newestOf(f, 2, C.reactionsPage).map((r) => ({ ...r, kindName: "recast" }))];
      for (const r of mine) {
        const p = proof.get(r.target.hash) ?? { likers: new Set(), recasters: new Set() };
        (r.kind === 1 ? p.likers : p.recasters).add(f);
        proof.set(r.target.hash, p);
      }
      let took = 0;
      for (const r of [...mine].sort((a, b) => b.ms - a.ms)) {
        if (!anyHalf && (took >= C.likedPerFollow || liked.length >= C.likedMax)) break;
        if (r.ms < since || liked.includes(r.target.hash) || !ok(r.target.fid)) continue;
        const c = st.casts.get(r.target.hash);
        liked.push(r.target.hash);
        took++;
        void c;
      }
      const fl = [...(st.links.get(f) ?? [])].sort((a, b) => b.ts - a.ts).slice(0, C.linksPage);
      for (const l of fl) {
        if (l.target === root) continue;
        const s = followedBy.get(l.target) ?? new Set();
        s.add(f);
        followedBy.set(l.target, s);
      }
    }
    const accounts = [...followedBy.entries()].filter(([t, s]) => s.size >= C.minFollowedBy && ok(t)).sort((a, b) => b[1].size - a[1].size || a[0] - b[0]).slice(0, anyHalf ? undefined : C.accounts).map(([t]) => t);
    const posts = new Set();
    const limit = nowMs + C.futureSkewMs;
    for (const h of liked) {
      const c = st.casts.get(h);
      if (c && !c.removed && c.ts <= limit) posts.add(h);
    }
    const winSince = nowMs - C.castsWindowHours * 3_600_000;
    for (const a of accounts) for (const [h, c] of castsOf(a).reverse().slice(0, C.castsPage)) if (c.ts >= winSince && c.ts <= limit) posts.add(h);
    const out = [...posts].map((h) => {
      const c = st.casts.get(h);
      const p = proof.get(h);
      const by = followedBy.get(c.fid);
      return { hash: h, fid: c.fid, ts: c.ts, text: c.text, likes: p ? p.likers.size : 0, recasts: p ? p.recasters.size : 0, followedBy: by ? by.size : 0 };
    });
    out.sort((a, b) => b.ts - a.ts || (a.hash < b.hash ? 1 : -1));
    return { sample, probed, liked, accounts, posts: out };
  }

  // ---- the server
  const readBody = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
  // POST AS YOU: every answer carries Access-Control-Allow-Origin *, as the public Snapchain node's do (checked 2026-11-05),
  // so a browser tab can READ it; an OPTIONS preflight still falls through to 404, as the real node's does, so a tab can
  // never submit to it directly (application/octet-stream is preflighted)
  const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body, (k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v))); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const raw = await readBody(req);
    const p = url.pathname;
    const log = (kind, status, extra = {}) => calls.push({ kind, method: req.method, path: p, status, at: Date.now(), ...extra });
    if (p === "/rpc" && req.method === "POST") {
      let j;
      try { j = JSON.parse(raw.toString("utf8")); } catch { log("rpc", 400); return send(res, 400, { error: "bad json" }); }
      const batch = Array.isArray(j) ? j : [j];
      const out = [];
      for (const q of batch) {
        const r = await rpc(q.method, q.params || []);
        if (r.httpStatus) { log("rpc", r.httpStatus, { rpc: q.method }); return send(res, r.httpStatus, { error: "forced" }); }
        log("rpc", 200, { rpc: q.method, error: r.error ? r.error.message : undefined });
        out.push(r.error ? { jsonrpc: "2.0", id: q.id, error: r.error } : { jsonrpc: "2.0", id: q.id, result: r.result });
      }
      return send(res, 200, Array.isArray(j) ? out : out[0]);
    }
    if (p.startsWith("/v1/")) {
      // FOLLOWING FROM THE HUB: a preflight is refused like the real node's (OPTIONS 404), and counted
      if (req.method === "OPTIONS") {
        hubRead.preflights++;
        log("hub", 404, { preflight: true });
        return send(res, 404, { error: "not found" });
      }
      const f = forced("hub:" + p) ?? forced("hub");
      if (f) { log("hub", f); return send(res, f, { error: "forced", error_detail: "the stub was told to fail" }); }
      if (p === "/v1/submitMessage" && req.method === "POST") {
        const r = submit(new Uint8Array(raw));
        log("hub", r.status, { submit: r.status === 200 ? r.body.hash : r.body.error_detail });
        return send(res, r.status, r.body);
      }
      if (p === "/v1/info") { log("hub", 200); return send(res, 200, { version: "stub", dbStats: {} }); }
      // the account a read names: `fid=`, or `target_fid=` (NOTIFICATIONS FROM FARCASTER's by-target reads)
      const fid = Number(url.searchParams.get("fid") ?? url.searchParams.get("target_fid"));
      // FOLLOWING FROM THE HUB: the browser's reads, tracked (in flight at once, delay, failures, a 429 run, headers seen)
      if (["/v1/linksByFid", "/v1/castsByFid", "/v1/castsByParent", "/v1/userDataByFid", "/v1/castById", "/v1/reactionsByFid", "/v1/linksByTargetFid", "/v1/castsByMention", "/v1/reactionsByCast"].includes(p)) {
        hubRead.inFlight++;
        hubRead.maxInFlight = Math.max(hubRead.maxInFlight, hubRead.inFlight);
        const h = req.headers;
        const entry = { path: p, fid, at: Date.now(), origin: h.origin ?? null, referer: h.referer ?? null, cookie: !!h.cookie, status: 0 };
        hubRead.reads.push(entry);
        try {
          if (hubRead.delayMs > 0) await new Promise((r) => setTimeout(r, hubRead.delayMs));
          if (hubRead.rate && hubRead.rate.n > 0) {
            hubRead.rate.n--;
            entry.status = 429;
            log("hub", 429, { fid });
            res.writeHead(429, { "content-type": "application/json", "access-control-allow-origin": "*", "retry-after": String(hubRead.rate.retryAfter) });
            return res.end(JSON.stringify({ error: "Too many requests" }));
          }
          const failed = hubFail(p, fid);
          if (failed) {
            entry.status = failed;
            log("hub", failed, { fid });
            return send(res, failed, { error: "forced", error_detail: "the stub was told to fail" });
          }
          const ans = readAnswer(p, url, fid);
          entry.status = ans.status;
          log("hub", ans.status, { fid });
          return send(res, ans.status, ans.body);
        } finally {
          hubRead.inFlight--;
        }
      }
      if (p === "/v1/onChainSignersByFid") {
        const events = [...st.keys.entries()].filter(([k, v]) => k.startsWith(fid + ":") && v.state === 1 && now() - v.at >= hubSyncDelayMs).map(([k]) => ({ type: "EVENT_TYPE_SIGNER", chainId: 10, fid, signerEventBody: { key: "0x" + k.split(":")[1], keyType: 1, eventType: "SIGNER_EVENT_TYPE_ADD", metadataType: 1 } }));
        log("hub", 200);
        return send(res, 200, { events });
      }
      log("hub", 404);
      return send(res, 404, { error: "not found" });
    }
    if (p.startsWith("/transfers")) {
      const f = forced("fnames:" + req.method) ?? forced("fnames");
      if (f) { log("fnames", f); return send(res, f, { error: "forced" }); }
      if (p === "/transfers/current" && req.method === "GET") {
        const name = url.searchParams.get("name");
        const n = st.names.get(name);
        if (!n) { log("fnames", 404); return send(res, 404, { error: "No transfer found" }); }
        log("fnames", 200);
        return send(res, 200, { transfer: { username: name, to: n.to, from: 0, owner: n.owner, timestamp: n.timestamp } });
      }
      if (p === "/transfers" && req.method === "POST") {
        let b;
        try { b = JSON.parse(raw.toString("utf8")); } catch { log("fnames", 400); return send(res, 400, { error: "bad json" }); }
        const { name, from, to, fid, owner, timestamp, signature } = b || {};
        const bad = (why) => { log("fnames", 400, { why }); return send(res, 400, { error: why, code: "bad_request" }); };
        if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(String(name))) return bad("invalid name");
        if (from !== 0 || to !== fid) return bad("from must be 0 and to must be fid for a registration");
        if (Math.abs(Number(timestamp) * 1000 - now()) > 5 * 60_000) return bad("timestamp too far from now");
        if (st.custodyOf.get(Number(fid)) !== lc(owner)) return bad("owner is not the fid's custody");
        let rec;
        try { rec = lc(await recoverTypedDataAddress({ domain: FNAME_DOMAIN, types: FNAME_TYPES, primaryType: "UserNameProof", message: { name, timestamp: BigInt(timestamp), owner }, signature })); } catch { return bad("invalid signature"); }
        if (rec !== lc(owner)) return bad("invalid signature");
        const cur = st.names.get(name);
        if (cur && cur.to !== Number(fid)) return bad("name is already registered");
        st.names.set(name, { to: Number(fid), owner: lc(owner), timestamp });
        log("fnames", 200);
        return send(res, 200, { transfer: { username: name, to: Number(fid), from: 0 } });
      }
      log("fnames", 404);
      return send(res, 404, { error: "not found" });
    }
    log("other", 404);
    send(res, 404, { error: "not found in the stub" });
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((r, j) => { server.once("error", j); server.listen(port, "127.0.0.1", () => { server.off("error", j); r(); }); });
    if (!FORBIDDEN_PORTS.has(server.address().port)) break;
    await new Promise((r) => server.close(r));
  }
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    base, rpcUrl: base + "/rpc", hubUrl: base, fnamesUrl: base, state: st, calls,
    fund(address, wei) { st.balances.set(lc(address), bal(address) + BigInt(wei)); },
    failNext(kind, status, n = 1, skip = 0) { fails.push({ kind, status, n, skip }); },
    clearFails() { fails.length = 0; },
    /** give an existing fid a signer directly (validator tests: no transaction needed) */
    seedAccount(fid, custody, pubHex) { st.fidOf.set(lc(custody), fid); st.custodyOf.set(fid, lc(custody)); if (pubHex) st.keys.set(fid + ":" + lc(pubHex).replace(/^0x/, ""), { state: 1, keyType: 1, at: 0 }); },
    // FOLLOWING FROM THE HUB (the browser's reads): plant a graph, steer the reads, read the ground truth
    hubRead,
    plantProfile, plantCast, plantFollows, plantFollow, plantSynthetic, plantReaction, removeReaction, truth,
    // SPEC B (For You from the hub): the 2-hop graph and what For You should show for it
    plantTwoHop, forYouTruth,
    /** remove a cast as its author would (CastRemove): it leaves every read */
    removeCast(hash) { const c = st.casts.get(lc(hash)); if (c) c.removed = true; return !!c; },
    resetHubReads() { hubRead.reads.length = 0; hubRead.maxInFlight = 0; hubRead.preflights = 0; },
    clearHubSteering() { hubRead.fails.length = 0; hubRead.rate = null; hubRead.delayMs = 0; hubRead.shardedParents = false; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
