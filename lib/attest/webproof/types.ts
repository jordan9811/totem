// MULTI-FID PASS Gate 0 — the WEB-PROOF seam. The x.* issuers read facts
// about an X ACCOUNT ("About this account": based-in, join date, username
// changes) through this adapter and nothing else. A fixture
// implementation replays recorded facts for seeded handles (sweeps); a
// live one — a zkTLS transcript or the browser extension — arrives in a
// later pass and is REFUSED until then (fail closed: nothing is ever
// issued from a fact nobody verified). What comes back is exact — a
// country, a join timestamp, a count — and exact is what the issuer must
// never let out: it buckets before it signs.

export interface XAboutFacts {
  /** X's "based in" value as X shows it; granularity is the ACCOUNT OWNER'S choice on X's side, so both parse */
  basedIn: { granularity: "country" | "region"; value: string } | null;
  /** X flags the location as possibly affected by a VPN/proxy — the fact is weak, and the issuer refuses on it */
  vpnCaveat: boolean;
  /** ms since epoch the account joined X; null = unknown */
  joinedAt: number | null;
  /** how many times the @username changed, per X */
  usernameChanges: number;
}

/** what the subject presents: the handle it claims and a proof of the About page for it */
export interface WebProof {
  handle: string;
  proof: string;
}

export interface WebProofAdapter {
  readonly kind: "fixture" | "live";
  /** the About facts behind a proof; throws when the proof does not verify or the source is unavailable (never fails open) */
  xAbout(proof: WebProof): Promise<XAboutFacts>;
  /** FIXTURE ONLY: synthetic facts for a cohort commitment (the decoy crowd needs buckets to clear the floor) */
  cohortXAbout?(commitment: string, index?: number): XAboutFacts;
}
