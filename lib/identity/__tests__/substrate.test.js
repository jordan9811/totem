"use strict";
// Gate 0 substrate tests. These assert PROPERTIES, not behaviours:
// derivation is genuinely one-way, and hidden linkage is genuinely absent.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");

// Re-implement derivation exactly as lib/identity/keystore.ts does. If the two
// ever diverge, the uncomputability claim is unverified — so this file is a
// deliberate duplicate rather than an import (the module is server-only ESM).
const derive = (secret, nonce) =>
  "p_" + createHash("sha256").update(secret).update(":").update(nonce).digest("hex").slice(0, 32);

test("persona derivation is deterministic given the secret", () => {
  const secret = randomBytes(32).toString("hex");
  assert.equal(derive(secret, "n1"), derive(secret, "n1"));
  assert.notEqual(derive(secret, "n1"), derive(secret, "n2"));
});

test("SIBLING-UNCOMPUTABILITY: persona B cannot be derived from persona A", () => {
  const secret = randomBytes(32).toString("hex");
  const a = derive(secret, "nonce-a");
  const b = derive(secret, "nonce-b");

  // Everything an attacker plausibly holds: persona A's id, B's nonce, and
  // the derivation algorithm itself. None of it yields B.
  const attempts = [
    "p_" + createHash("sha256").update(a).update(":").update("nonce-b").digest("hex").slice(0, 32),
    "p_" + createHash("sha256").update("nonce-b").update(":").update(a).digest("hex").slice(0, 32),
    "p_" + createHash("sha256").update(a + "nonce-b").digest("hex").slice(0, 32),
    derive(a, "nonce-b"),
  ];
  for (const guess of attempts) {
    assert.notEqual(guess, b, "sibling was computable without the root secret");
  }
});

test("a different root produces different personas for the same nonce", () => {
  const s1 = randomBytes(32).toString("hex");
  const s2 = randomBytes(32).toString("hex");
  assert.notEqual(derive(s1, "same"), derive(s2, "same"));
});

// ---- grant resolution semantics ----

const OPEN = "*";
const live = (g, now = Date.now()) => g.revokedAt === null || g.revokedAt > now;

function resolveLinkage(grants, requests, from, to, viewer, now = Date.now()) {
  const pair = (g) =>
    (g.fromPersona === from && g.toPersona === to) || (g.fromPersona === to && g.toPersona === from);
  const rows = grants.filter((g) => pair(g) && live(g, now));
  if (rows.length === 0) return null;
  if (viewer) {
    const named = rows.find((g) => g.tier === "whitelist" && g.audienceMember === viewer);
    if (named) return { tier: "whitelist" };
  }
  const open = rows.find((g) => g.audienceMember === OPEN);
  if (!open) return null;
  if (open.tier === "public") return { tier: "public" };
  if (open.tier === "opt_in") {
    if (!viewer) return null;
    const asked = requests.some(
      (r) =>
        r.requesterPersona === viewer &&
        r.resolved &&
        ((r.fromPersona === from && r.toPersona === to) ||
          (r.fromPersona === to && r.toPersona === from))
    );
    return asked ? { tier: "opt_in" } : null;
  }
  return null;
}

const G = (o) => ({ revokedAt: null, audienceMember: OPEN, ...o });

test("HIDDEN is absence: no grant means no resolution, for anyone", () => {
  assert.equal(resolveLinkage([], [], "A", "B", "V"), null);
  assert.equal(resolveLinkage([], [], "A", "B", null), null);
  // and not merely a flag we could flip
  const unrelated = [G({ fromPersona: "A", toPersona: "C", tier: "public" })];
  assert.equal(resolveLinkage(unrelated, [], "A", "B", "V"), null);
});

test("PUBLIC resolves for anyone, including an anonymous viewer", () => {
  const g = [G({ fromPersona: "A", toPersona: "B", tier: "public" })];
  assert.equal(resolveLinkage(g, [], "A", "B", "V").tier, "public");
  assert.equal(resolveLinkage(g, [], "A", "B", null).tier, "public");
  // symmetric: the claim is pairwise, direction does not matter
  assert.equal(resolveLinkage(g, [], "B", "A", "V").tier, "public");
});

test("OPT-IN does not resolve on sight; it resolves after a recorded request", () => {
  const g = [G({ fromPersona: "A", toPersona: "B", tier: "opt_in" })];
  assert.equal(resolveLinkage(g, [], "A", "B", "V"), null);

  const asked = [{ requesterPersona: "V", fromPersona: "A", toPersona: "B", resolved: true }];
  assert.equal(resolveLinkage(g, asked, "A", "B", "V").tier, "opt_in");
  // someone else asking does not resolve it for me
  assert.equal(resolveLinkage(g, asked, "A", "B", "W"), null);
});

test("WHITELIST resolves only for named audience members", () => {
  const g = [
    G({ fromPersona: "A", toPersona: "B", tier: "whitelist", audienceMember: "V" }),
    G({ fromPersona: "A", toPersona: "B", tier: "whitelist", audienceMember: "W" }),
  ];
  assert.equal(resolveLinkage(g, [], "A", "B", "V").tier, "whitelist");
  assert.equal(resolveLinkage(g, [], "A", "B", "W").tier, "whitelist");
  assert.equal(resolveLinkage(g, [], "A", "B", "Z"), null);
  assert.equal(resolveLinkage(g, [], "A", "B", null), null);
});

test("REVOKE stops resolution but keeps the record", () => {
  const revoked = [
    G({ fromPersona: "A", toPersona: "B", tier: "whitelist", audienceMember: "V", revokedAt: Date.now() - 1000 }),
  ];
  assert.equal(resolveLinkage(revoked, [], "A", "B", "V"), null);
  // the row still exists — they cannot unlearn it, and we do not pretend they can
  assert.equal(revoked.length, 1);
});

// Mirrors grantCanonical()/grantId() in lib/identity/grants.ts.
// Deliberate duplicate, same reasoning as `derive` above. Since the
// crypto pass, signatures are REAL Ed25519 — signed here with
// node:crypto's native implementation, a second implementation against
// the noble one the app uses, so the canonical-form properties are
// pinned across both.
const { generateKeyPairSync, sign: edSign, verify: edVerify } = require("node:crypto");

const canonicalOf = (g) =>
  [
    g.kind ?? "linkage",
    g.fromPersona,
    g.toPersona,
    g.audienceMember,
    g.tier,
    String(g.issuedAt),
    String(g.revokedAt ?? ""),
  ].join("|");
// the id derives from the ISSUANCE canonical (revokedAt forced empty),
// so revocation re-signs without changing a grant's identity
const idOf = (g) =>
  "g_" + createHash("sha256").update(canonicalOf({ ...g, revokedAt: null })).digest("hex").slice(0, 24);

test("A SIGNATURE COMMITS TO THE CLAIM'S KIND", () => {
  // Two grants identical in every field except what they ASSERT:
  //   linkage — "these two personas are the same person, right now"
  //   forward — "this persona moved to that one"
  // If kind were outside the canonical form these would share bytes, and one
  // signature would verify as either claim. It must not.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const base = {
    fromPersona: "A",
    toPersona: "B",
    audienceMember: "V",
    tier: "whitelist",
    issuedAt: 1700000000000,
    revokedAt: null,
  };
  const linkageCanonical = canonicalOf({ ...base, kind: "linkage" });
  const forwardCanonical = canonicalOf({ ...base, kind: "forward" });
  assert.notEqual(linkageCanonical, forwardCanonical);

  // the SAME bytes signed as a linkage must NOT verify as a forward
  const sig = edSign(null, Buffer.from(linkageCanonical, "utf8"), privateKey);
  assert.equal(edVerify(null, Buffer.from(linkageCanonical, "utf8"), publicKey, sig), true);
  assert.equal(edVerify(null, Buffer.from(forwardCanonical, "utf8"), publicKey, sig), false);

  // distinct claims cannot collide onto one row in a Map keyed by id
  assert.notEqual(idOf({ ...base, kind: "linkage" }), idOf({ ...base, kind: "forward" }));

  // an unmarked grant is a linkage, so every pre-fork seed keeps its identity
  assert.equal(idOf(base), idOf({ ...base, kind: "linkage" }));
});

test("REVOCATION RE-SIGNS: the id is stable, the signature is not", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const base = {
    fromPersona: "A",
    toPersona: "B",
    audienceMember: "V",
    tier: "whitelist",
    issuedAt: 1700000000000,
    revokedAt: null,
  };
  const revoked = { ...base, revokedAt: 1700000001000 };

  // identity survives revocation — references keep working
  assert.equal(idOf(base), idOf(revoked));

  // but the ISSUANCE signature must NOT verify over the revoked state:
  // revokedAt is inside the canonical precisely so the revoked state is
  // itself a signed claim, which forces the re-sign
  const issueSig = edSign(null, Buffer.from(canonicalOf(base), "utf8"), privateKey);
  assert.equal(edVerify(null, Buffer.from(canonicalOf(base), "utf8"), publicKey, issueSig), true);
  assert.equal(edVerify(null, Buffer.from(canonicalOf(revoked), "utf8"), publicKey, issueSig), false);

  // and a signature from a DIFFERENT key never verifies (the forger case)
  const other = generateKeyPairSync("ed25519");
  const forged = edSign(null, Buffer.from(canonicalOf(base), "utf8"), other.privateKey);
  assert.equal(edVerify(null, Buffer.from(canonicalOf(base), "utf8"), publicKey, forged), false);
});
