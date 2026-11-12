import "server-only";
// SEED ⇄ RECOVERY PHRASE. The root secret is 32 bytes; a standard BIP39
// 24-word mnemonic is that entropy in a form a human can write down.
// Backing up the phrase backs up the identity: the same phrase re-derives
// the same seed, and from the seed the whole hierarchy (persona keys,
// vault key, device-auth key) reproduces exactly.
//
// Audited primitive: @scure/bip39 (independently audited; already on
// disk). No hand-rolled wordlist or checksum.
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/** 32-byte seed → 24-word phrase. */
export function seedToMnemonic(seedHex: string): string {
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== 32) throw new Error(`mnemonic: seed must be 32 bytes, got ${seed.length}`);
  return bip39.entropyToMnemonic(new Uint8Array(seed), wordlist);
}

/** 24-word phrase → 32-byte seed. Throws on an invalid phrase (bad word
 * or bad checksum) — a mistyped phrase is a WRONG identity, never a
 * silently-different one. */
export function mnemonicToSeed(mnemonic: string): string {
  const normalized = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
  if (!bip39.validateMnemonic(normalized, wordlist)) {
    throw new Error("recovery phrase is invalid (bad word or checksum)");
  }
  return Buffer.from(bip39.mnemonicToEntropy(normalized, wordlist)).toString("hex");
}
