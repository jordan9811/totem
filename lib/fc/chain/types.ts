// PERSONA LAUNCH P6 — THE CHAIN READER SEAM: public Farcaster chain facts a READER needs to check a launched account's
// claims for itself — which fid a custody address owns, which signer keys a fid has (the KeyRegistry), and its fname.
//
//   fixture  the validator's SIMULATED chain (validator/simchain.js, GET /sim-chain/*) — a public read naming only the
//            fid (or the name) asked about, no device headers, no cookies
//   live     REFUSES (F25, VERIFY-YOURSELF): this build does not read Optimism's KeyRegistry. A reader that cannot check
//            a claim renders the cast as plain anon — never as a name it could not check (lib/fc/personaFid.ts).

export interface ChainAccount {
  fid: number;
  custody: string;
  recovery: string;
  registeredAt: number;
  storageUnits: number;
  /** the current fname (the fname server's table), or null */
  fname: string | null;
}

export interface ChainKey {
  /** the Ed25519 signer public key, 64 lowercase hex */
  key: string;
  keyType: number;
  /** the app fid that vouched the key (a launched account: the ONE Totem registrar app fid) */
  requestFid: number;
  addedAt: number;
  removedAt: number | null;
}

export interface ChainSource {
  readonly kind: "fixture" | "live";
  /** the account a fid is, or null when the chain has no such fid. THROWS when the chain cannot be read. */
  account(fid: number): Promise<ChainAccount | null>;
  /** the fid a custody address owns, or null. THROWS when the chain cannot be read. */
  fidOfCustody(custody: string): Promise<number | null>;
  /** every key the KeyRegistry lists for the fid (active and removed). THROWS when the chain cannot be read. */
  keysOf(fid: number): Promise<ChainKey[]>;
  /** the fid a name belongs to now, or null. THROWS when the name server cannot be read. */
  fidOfName(name: string): Promise<number | null>;
}

/** is `key` an ACTIVE signer key in this list? (case-insensitive hex compare) */
export function hasActiveKey(keys: ChainKey[], key: string | null | undefined): boolean {
  if (typeof key !== "string" || !/^[0-9a-fA-F]{64}$/.test(key)) return false;
  const k = key.toLowerCase();
  return keys.some((x) => x.key.toLowerCase() === k && x.removedAt === null);
}
