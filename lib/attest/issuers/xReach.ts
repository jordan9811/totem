import "server-only";
// PERSONA LAUNCH P5 (D1: "X later") — THE X REACH ISSUER, FIXTURE ONLY this wave:
//
//   x.reach   gte-1k | gte-10k | gte-100k   (nested, like fc.reach)
//
// WHAT IT ASSERTS: the X handle VERIFIED ON FARCASTER by the root's own main account (Farcaster's public X verification,
// the same fact lib/x/identity.ts reads from the keyless index) has at least that many followers on X. The entry ticket
// is the main account's Neynar score (D1, the same 0.7 as fc.reach). One handle per root (retention family "x.reach").
//
// WHY FIXTURE ONLY: a live X follower count needs the owner's xAI key (plan §5 O5) — not set up. On live facts the issuer
// refuses in plain words and issues nothing (never a guess). The fixture knows the rig's main account (fixture-main) and
// its verified handle; a dev override sets its follower count (app/api/reach, ZK_DEV_HOOKS only).
import { fetchEpoch } from "@/lib/zk/validatorClient";
import { REACH_BUCKETS } from "@/lib/reach/trees";
import { fidFacts, fidSource } from "../fid/source";
import { issuerKeyFor, signWithKey } from "../issuerKey";
import { boundElsewhere, retain } from "../retention";
import type { AttestationIssuer, IssuedAttestation, JsonSchema, Refusal, SubjectRef } from "../types";
import { REACH_KEY_ID, REACH_VALIDITY_EPOCHS, mainAccountFid, reachIssuances } from "./fcReach";

export const X_REACH_ID = "x.reach";

/** the fixture's Farcaster-verified X handles and their follower counts, by the main account's fid (fixture-main) */
const FIXTURE_X: Readonly<Record<number, { handle: string; followers: number }>> = Object.freeze({
  9_200_001: Object.freeze({ handle: "fixture_main_x", followers: 42_000 }),
});
const g = globalThis as unknown as { __layersXReachOverrides?: Map<number, number | null> };
const overrides = () => (g.__layersXReachOverrides ??= new Map());

/** TEST RIG ONLY (app/api/reach, behind ZK_DEV_HOOKS): a fixture main account's X follower count (undefined clears it) */
export function setFixtureXFollowers(fid: number, followers: number | null | undefined): void {
  if (!Number.isInteger(fid) || fid <= 0) throw new Error("x.reach fixture: fid malformed");
  if (followers === undefined) overrides().delete(fid);
  else overrides().set(fid, followers);
}
export function clearFixtureXFollowers(): void {
  overrides().clear();
}

const SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "x.reach",
  description:
    "The X handle verified on Farcaster by the root's own main account (whose Neynar score is at least 0.7) has at least the bucket's number of followers on X at the snapshot. Buckets nest; tiers, never the number. Fixture only until the X follower source exists.",
  type: "object",
  properties: { kind: { const: "reach" }, provider: { const: "x" }, bucket: { enum: [...REACH_BUCKETS] }, snapshotEpoch: { type: "integer" } },
  required: ["kind", "provider", "bucket", "snapshotEpoch"],
};

export const xReachIssuer: AttestationIssuer = {
  id: X_REACH_ID,
  displayName: "X followers — reach tier (coarse, test data only)",
  claimSchema: SCHEMA,
  buckets: REACH_BUCKETS,
  validity: { epochs: REACH_VALIDITY_EPOCHS },
  trustTier: "attested",
  get publicKey() {
    return issuerKeyFor(REACH_KEY_ID).pubHex;
  },
  sign(canonical: string) {
    return signWithKey(issuerKeyFor(REACH_KEY_ID), canonical);
  },
  async issue(subject: SubjectRef): Promise<IssuedAttestation[] | Refusal> {
    if (fidSource() !== "fixture") return { refused: true, reason: "X follower counts aren't connected yet (they need the owner's xAI key) — nothing was issued." };
    const adapter = fidFacts();
    let epoch: number;
    try {
      epoch = (await fetchEpoch(subject.mode)).epoch;
    } catch (e) {
      return { refused: true, reason: "the issuer could not read the epoch: " + (e as Error).message };
    }
    if (subject.cohort === true) {
      if (process.env.ZK_DEV_HOOKS !== "true" || !adapter.cohortFacts) return { refused: true, reason: "cohort facts are a fixture rig's only" };
      const f = adapter.cohortFacts(subject.commitment, subject.cohortIndex);
      return reachIssuances(X_REACH_ID, "x", subject, epoch, { score: f.score, followers: f.followerCount }, { source: "X" });
    }
    let fid: number | null;
    try {
      fid = await mainAccountFid();
    } catch (e) {
      return { refused: true, reason: "Couldn't read your Farcaster account (" + String((e as Error).message).replace(/\b\d{1,12}\b/g, "<n>").slice(0, 160) + ") — nothing was issued." };
    }
    if (fid === null) return { refused: true, reason: "Sign in with your Farcaster account first — an X reach tier comes from the X handle that account verified." };
    const x = FIXTURE_X[fid];
    if (!x) return { refused: true, reason: "Your Farcaster account has no verified X handle here." };
    if (boundElsewhere(X_REACH_ID, x.handle, subject.commitment, epoch, REACH_VALIDITY_EPOCHS)) {
      return { refused: true, reason: "This X handle already proves the reach of another identity — one handle per identity." };
    }
    let score: number | null;
    try {
      score = (await adapter.facts(fid)).score;
    } catch (e) {
      return { refused: true, reason: "Your account's score is unavailable right now (" + String((e as Error).message).replace(/\b\d{1,12}\b/g, "<n>").slice(0, 120) + ")." };
    }
    const followers = overrides().has(fid) ? (overrides().get(fid) ?? null) : x.followers;
    const issued = reachIssuances(X_REACH_ID, "x", subject, epoch, { score, followers }, { source: "X" });
    if (!Array.isArray(issued)) return issued;
    retain(X_REACH_ID, [x.handle], issued);
    return issued;
  },
};
