import "server-only";
// MULTI-FID PASS Gate 0 — THE X-ACCOUNT ISSUERS, behind the same
// AttestationIssuer interface as onchain.*: facts from X's "About this
// account" panel, read through the web-proof seam (fixture now; zkTLS /
// extension later), bucketed COARSELY, signed under ONE family key ("x").
//
//   x.account-region  americas | europe | asia-pacific | africa-middle-east
//                     — from "based in" at whichever granularity the
//                     account owner chose on X (country or region; both
//                     parse to the same four macro-regions). Refused when
//                     X flags a VPN caveat (the fact is weak) or the value
//                     maps to no macro-region (never a guess).
//   x.account-age     gte-1y-stable | gte-2y-stable | gte-4y-stable (nested)
//                     — join date AND zero username changes: an account
//                     that was renamed is not the same public history, so
//                     it supports no bucket at all.
//
// The claim value in the vault keeps what X showed (granularity, value,
// caveat, join date, change count); the public bucket is the macro-region
// or the age tier. One handle vouches for ONE root (retention.ts), and
// several handles aggregate: the region must agree (else refused — the
// narrower claim), the age is the oldest stable account.
import { randomBytes } from "@/lib/platform/crypto";
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { attestCanonical, claimHash, issueWindowStart } from "../canonical";
import { challengeIsLive, consumeChallenge, mintChallenge } from "../challenge";
import { issuerKeyFor, signWithKey } from "../issuerKey";
import { boundElsewhere, retain } from "../retention";
import type { AttestationClaim, AttestationIssuer, IssuedAttestation, JsonSchema, Refusal, SubjectRef } from "../types";
import { webProof } from "../webproof/source";
import type { XAboutFacts } from "../webproof/types";

export const X_KEY_ID = "x";
const YEAR = 365.25 * 24 * 3600 * 1000;

export const X_BUCKETS = Object.freeze({
  "x.account-region": Object.freeze(["americas", "europe", "asia-pacific", "africa-middle-east"]),
  "x.account-age": Object.freeze(["gte-1y-stable", "gte-2y-stable", "gte-4y-stable"]),
});
export type XIssuerId = keyof typeof X_BUCKETS;

const VALIDITY: Record<XIssuerId, number> = { "x.account-region": 28, "x.account-age": 28 };

// ---------- the macro-region map (X shows a country OR a region; both land here) ----------
const REGION_OF: Record<string, string> = {
  // regions as X names them
  "north america": "americas",
  "south america": "americas",
  "latin america": "americas",
  "central america": "americas",
  caribbean: "americas",
  americas: "americas",
  europe: "europe",
  "european union": "europe",
  eu: "europe",
  asia: "asia-pacific",
  "asia-pacific": "asia-pacific",
  "asia pacific": "asia-pacific",
  "east asia": "asia-pacific",
  "south asia": "asia-pacific",
  "southeast asia": "asia-pacific",
  oceania: "asia-pacific",
  australasia: "asia-pacific",
  africa: "africa-middle-east",
  "middle east": "africa-middle-east",
  "north africa": "africa-middle-east",
  "sub-saharan africa": "africa-middle-east",
  // countries (the common ones; an unknown value is REFUSED, never guessed)
  "united states": "americas",
  usa: "americas",
  us: "americas",
  canada: "americas",
  mexico: "americas",
  brazil: "americas",
  argentina: "americas",
  chile: "americas",
  colombia: "americas",
  peru: "americas",
  venezuela: "americas",
  "united kingdom": "europe",
  uk: "europe",
  ireland: "europe",
  france: "europe",
  germany: "europe",
  spain: "europe",
  portugal: "europe",
  italy: "europe",
  netherlands: "europe",
  belgium: "europe",
  switzerland: "europe",
  austria: "europe",
  sweden: "europe",
  norway: "europe",
  denmark: "europe",
  finland: "europe",
  poland: "europe",
  czechia: "europe",
  "czech republic": "europe",
  ukraine: "europe",
  romania: "europe",
  greece: "europe",
  turkey: "europe",
  russia: "europe",
  japan: "asia-pacific",
  china: "asia-pacific",
  "hong kong": "asia-pacific",
  taiwan: "asia-pacific",
  "south korea": "asia-pacific",
  korea: "asia-pacific",
  singapore: "asia-pacific",
  india: "asia-pacific",
  pakistan: "asia-pacific",
  bangladesh: "asia-pacific",
  indonesia: "asia-pacific",
  malaysia: "asia-pacific",
  philippines: "asia-pacific",
  thailand: "asia-pacific",
  vietnam: "asia-pacific",
  australia: "asia-pacific",
  "new zealand": "asia-pacific",
  "south africa": "africa-middle-east",
  nigeria: "africa-middle-east",
  kenya: "africa-middle-east",
  ghana: "africa-middle-east",
  egypt: "africa-middle-east",
  morocco: "africa-middle-east",
  israel: "africa-middle-east",
  "united arab emirates": "africa-middle-east",
  uae: "africa-middle-east",
  "saudi arabia": "africa-middle-east",
  qatar: "africa-middle-east",
};

/** the macro-region for an X "based in" value, or null when it is not one we know (refused upstream) */
export function regionBucket(value: string): string | null {
  return REGION_OF[value.trim().toLowerCase()] ?? null;
}

/** the buckets one account's facts support, per issuer */
export function xBucketsFor(id: XIssuerId, f: XAboutFacts, now = Date.now()): string[] {
  switch (id) {
    case "x.account-region": {
      if (!f.basedIn || f.vpnCaveat) return [];
      const b = regionBucket(f.basedIn.value);
      return b ? [b] : [];
    }
    case "x.account-age": {
      if (f.joinedAt === null || f.usernameChanges > 0) return [];
      const age = now - f.joinedAt;
      const out: string[] = [];
      if (age >= 1 * YEAR) out.push("gte-1y-stable");
      if (age >= 2 * YEAR) out.push("gte-2y-stable");
      if (age >= 4 * YEAR) out.push("gte-4y-stable");
      return out;
    }
  }
}

const SCHEMAS: Record<XIssuerId, JsonSchema> = {
  "x.account-region": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "x.account-region",
    description:
      "X's About-this-account 'based in' value for an account the root controls, at the granularity the owner chose on X (country or region), with X's VPN caveat. The PUBLIC bucket is one of four macro-regions; the claim keeps the value. Refused on a VPN caveat.",
    type: "object",
    properties: {
      kind: { const: "account-region" },
      granularity: { enum: ["country", "region"] },
      value: { type: "string" },
      vpnCaveat: { type: "boolean" },
      bucket: { enum: ["americas", "europe", "asia-pacific", "africa-middle-east"] },
      snapshotEpoch: { type: "integer" },
    },
    required: ["kind", "granularity", "value", "vpnCaveat", "bucket", "snapshotEpoch"],
  },
  "x.account-age": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "x.account-age",
    description:
      "An X account the root controls joined at least the bucket's years ago AND never changed its username. Buckets nest: gte-4y-stable implies gte-2y-stable implies gte-1y-stable. A renamed account supports no bucket.",
    type: "object",
    properties: {
      kind: { const: "account-age" },
      joinedAt: { type: "integer" },
      usernameChanges: { type: "integer" },
      bucket: { enum: ["gte-1y-stable", "gte-2y-stable", "gte-4y-stable"] },
      snapshotEpoch: { type: "integer" },
    },
    required: ["kind", "joinedAt", "usernameChanges", "bucket", "snapshotEpoch"],
  },
};
const DISPLAY: Record<XIssuerId, string> = {
  "x.account-region": "X account — based in (coarse region)",
  "x.account-age": "X account — age, username never changed",
};

/** an X handle must never ride an error or a recorded refusal */
function redactHandles(s: string): string {
  return s.replace(/@?[A-Za-z0-9_]{1,15}(?=\s|$|[,.;:)])/g, (m) => (m.length > 4 ? "<redacted>" : m));
}

function makeIssuer(id: XIssuerId): AttestationIssuer {
  return {
    id,
    displayName: DISPLAY[id],
    claimSchema: SCHEMAS[id],
    buckets: X_BUCKETS[id],
    validity: { epochs: VALIDITY[id] },
    trustTier: "attested",
    get publicKey() {
      return issuerKeyFor(X_KEY_ID).pubHex;
    },
    sign(canonical: string) {
      return signWithKey(issuerKeyFor(X_KEY_ID), canonical);
    },
    mintChallenge(subject) {
      return mintChallenge(id, subject, 0);
    },
    async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
      const adapter = webProof();
      let epoch: number;
      try {
        epoch = (await fetchEpoch(subject.mode)).epoch;
      } catch (e) {
        return { refused: true, reason: "issuer could not read the epoch: " + (e as Error).message };
      }
      let facts: XAboutFacts;
      const handles: string[] = [];
      if (subject.webProofs && subject.webProofs.length) {
        // the challenge binds the request to this issuer / mode / commitment; the proof binds the account
        if (!subject.challenge || !challengeIsLive(subject.challenge, id, subject)) return { refused: true, reason: "no live challenge for this subject — mint one first" };
        const all: XAboutFacts[] = [];
        for (const p of subject.webProofs) {
          const handle = String(p.handle || "").replace(/^@/, "").toLowerCase();
          if (!/^[a-z0-9_]{1,15}$/.test(handle)) return { refused: true, reason: "handle malformed" };
          if (boundElsewhere(X_KEY_ID, handle, subject.commitment, epoch, Math.max(...Object.values(VALIDITY)))) {
            return { refused: true, reason: "a bound account already vouches for another root — one account, one root" };
          }
          try {
            all.push(await adapter.xAbout({ handle, proof: String(p.proof ?? "") }));
          } catch (e) {
            return { refused: true, reason: "web proof unavailable or unverified: " + redactHandles((e as Error).message).split("\n")[0].slice(0, 160) };
          }
          handles.push(handle);
        }
        consumeChallenge(subject.challenge);
        facts = aggregate(id, all);
        if (id === "x.account-region" && facts.basedIn === null && all.some((f) => f.basedIn !== null && !f.vpnCaveat)) {
          return { refused: true, reason: "the bound accounts disagree on region — no bucket (the narrower claim)" };
        }
      } else if (subject.cohort === true && adapter.kind === "fixture" && process.env.ZK_DEV_HOOKS === "true" && adapter.cohortXAbout) {
        facts = adapter.cohortXAbout(subject.commitment, subject.cohortIndex);
      } else {
        return { refused: true, reason: "no X account bound — an x.* attestation needs a web proof of the account's About page" };
      }
      if (id === "x.account-region" && facts.vpnCaveat) return { refused: true, reason: "X flags the location with a VPN caveat — the fact is too weak to sign" };
      const supported = xBucketsFor(id, facts);
      const wanted = subject.buckets && subject.buckets.length ? subject.buckets.filter((b) => supported.includes(b)) : supported;
      if (wanted.length === 0) {
        return {
          refused: true,
          reason:
            id === "x.account-age" && facts.usernameChanges > 0
              ? "the account changed its username — no age bucket for a renamed account"
              : "the facts support none of the requested buckets",
        };
      }
      const out: IssuedAttestation[] = [];
      const key = issuerKeyFor(X_KEY_ID);
      for (const bucket of wanted) {
        const value: Record<string, unknown> =
          id === "x.account-region"
            ? { kind: "account-region", granularity: facts.basedIn!.granularity, value: facts.basedIn!.value, vpnCaveat: facts.vpnCaveat, bucket, snapshotEpoch: epoch }
            : { kind: "account-age", joinedAt: facts.joinedAt, usernameChanges: facts.usernameChanges, bucket, snapshotEpoch: epoch };
        const claim: AttestationClaim = { kind: id.slice("x.".length), bucket, value, nonce: randomBytes(32).toString("hex") };
        const fields = {
          mode: subject.mode,
          issuer: id,
          bucket,
          commitment: subject.commitment,
          claimHash: claimHash(claim),
          issuedEpoch: epoch,
          expiresEpoch: issueWindowStart(epoch) + VALIDITY[id],
        };
        out.push({
          issuerId: id,
          bucket,
          subjectCommitment: subject.commitment,
          claimHash: fields.claimHash,
          issueEpoch: epoch,
          expiryEpoch: fields.expiresEpoch,
          issuedAt: Date.now(),
          sig: signWithKey(key, attestCanonical(fields)),
          issuerPubkey: key.pubHex,
          claim,
          mode: subject.mode,
        });
      }
      retain(X_KEY_ID, handles, out);
      return out;
    },
  };
}

/** several bound accounts: the region must AGREE (else null → refused), the age is the oldest STABLE account's */
export function aggregate(id: XIssuerId, all: XAboutFacts[]): XAboutFacts {
  if (id === "x.account-region") {
    const located = all.filter((f) => f.basedIn !== null);
    const vpn = all.some((f) => f.vpnCaveat);
    const buckets = new Set(located.map((f) => (f.basedIn ? regionBucket(f.basedIn.value) : null)));
    const first = located[0];
    return {
      basedIn: buckets.size === 1 && first?.basedIn ? { ...first.basedIn } : null,
      vpnCaveat: vpn,
      joinedAt: null,
      usernameChanges: 0,
    };
  }
  const stable = all.filter((f) => f.joinedAt !== null && f.usernameChanges === 0);
  if (stable.length === 0) return { basedIn: null, vpnCaveat: false, joinedAt: null, usernameChanges: Math.max(0, ...all.map((f) => f.usernameChanges)) };
  return { basedIn: null, vpnCaveat: false, joinedAt: Math.min(...stable.map((f) => f.joinedAt as number)), usernameChanges: 0 };
}

export const xIssuers: Record<XIssuerId, AttestationIssuer> = {
  "x.account-region": makeIssuer("x.account-region"),
  "x.account-age": makeIssuer("x.account-age"),
};

export function isXIssuer(id: string): id is XIssuerId {
  return Object.prototype.hasOwnProperty.call(X_BUCKETS, id);
}
