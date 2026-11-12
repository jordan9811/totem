# REPORT-BACKPACK — Data Backpack + Selective Resolution Pass

Ship three gates that ride the context-graph + vault rails the UX and
crypto passes already laid: a selective resolution surface (Gate 0), a
data-backpack import surface with provenance, trust tiers, a preview
step, a sensitive-consent gate, and vault encryption (Gate 1), and an
Ad Match Score with an anti-gaming invariant, transparent breakdown,
honest suggestions, and a floor that a high score cannot buy past
(Gate 2).

**Status: BUILT + CLOSED, ARMED. accept-bp 8/8** (`LAYERS_REQUIRE_SIG=true`,
production build). One self-inflicted regression found and fixed during
verification (see "The regression the suite caught"). tsc clean.

---

## The call up front: reconcile, don't rebuild

The recon (4 read-only agents mapping the exact deltas) found the pass
was NOT greenfield. The UX pass had already built the backpack import
UI, the self-declare flow, the Ad Match Score, and the k-floor. The
crypto pass had already made `graphClaims` / `graphConsent` / `imports`
vault namespaces (encrypt-at-flush, decrypt-at-hydrate). So the honest
scope was **close the gaps between what exists and what the three gates
actually require**, not re-pour foundations. Every gate below is written
as "what was already there / what this pass added."

This is the [feature-request-splitting] discipline applied in reverse:
instead of splitting a new feature into ship-now + backlog, it's
recognizing that most of the "new" feature already shipped and only the
seams were missing.

---

## Trust topology (every grep hangs on it)

Three provenance tiers, a straight multiplier — the anti-gaming property
made literal, not a UI framing choice:

| `source`      | `TRUST_PERCENT` | meaning                                  |
|---------------|-----------------|------------------------------------------|
| `self`        | 10              | you said so                              |
| `x-inferred`  | 50              | a platform export inferred it            |
| `attested`    | 100             | a third party cryptographically issued it |

A claim also now carries a `method` (`self-declared` / `w3c-vc` /
`did-control` / `platform-export` / `x-archive`) and an `issuer` — the
*how* and *who* of provenance, separate from the *how much I trust it*
tier. A self-declared claim moves the score ~1 point; the equivalent
attested claim moves it ~10. That 10× gap is `claimPoints()`, tested as
an exact marginal delta in both `accept-ux4` and `accept-bp`.

---

## GATE 0 — Selective resolution — ALREADY DONE (UX pass)

Selective bookmark/thread resolution into readwise is the cold-store /
resolution surface the UX and X-import passes built. Confirmed present
and covered (`test:b*`, `test:x*`, restart-survival's cold-resolution
checks). No new code this pass; the recon confirmed the gate's
requirements were already met. Logged as done, moved on.

---

## GATE 1 — Data backpack import surface — BUILT

**What already existed:** the connector catalogue (6 connectors), the
multi-step import job with visible progress, the self-declare form, the
fail-closed sensitive-consent gate in `claimsForMatching`, and the vault
namespaces.

**What this pass added — the confirm-before-it-lands seam:**

- **A preview step.** `advanceImport` used to walk straight to
  `complete`, writing claims as a side effect. It now lands on a new
  `status: "preview"` and writes *nothing* — `job.preview` is exactly
  what *would* land, one line per yield, each tagged with its tier,
  method, issuer, whether it's sensitive, and whether it's `withheld`
  (sensitive-without-consent: shown, never written). A new
  `commitImport(jobId)` is the only thing that writes claims, and it
  **re-derives** the preview against consent *as of commit time* — so a
  category opted in (or out) between preview and commit is honoured.
  `previewItemsFor()` is shared by both preview and commit, so the
  preview provably equals what lands. `commitImport` is idempotent
  (`complete` → returns unchanged) and refuses to commit a job that
  isn't in preview (`FORBIDDEN`).
- **Per-claim provenance.** `GraphClaim` gained `method`; `addClaim`
  stamps `self-declared` (or `x-archive` for X imports) and sets
  `issuedAt`. New `ClaimProvenance` component: every claim shown with
  tier + method + issuer + date, sorted attested→inferred→self, never a
  flat undifferentiated list.
- **Preview UI.** `GraphImports` walks to preview then shows a confirm /
  cancel panel; each preview row exposes its value, tier, method, and
  withheld state; withheld sensitive rows are called out.
- **Vault encryption.** graphClaims was already a vault namespace, so
  imported claims flush as ciphertext — *once the flush actually fires*
  (this is what the regression below was about).

Two seed connectors carry explicit methods (`conn_vc_degree` →
`w3c-vc`, `conn_did` → `did-control`); the rest default to
`platform-export`.

---

## GATE 2 — Ad Match Score — BUILT

**What already existed:** the 0-100 score reading `claimsForMatching`
(one definition of "counted" shared with the ad marketplace), the
anti-gaming multiplier, the breakdown, the honesty-guardrail copy, and
the k-floor refusal.

**What this pass added — making the invariants assertable, not just true:**

- **`rawTotal`.** The breakdown now sums to `rawTotal` *exactly*, and
  `score = min(100, rawTotal)`. Before, the cap silently broke "the
  breakdown sums to the total" whenever the total exceeded 100.
  Surfacing `rawTotal` makes both properties assertable at once: sum
  equals rawTotal (always), and the cap is a real, disclosed clamp
  ("Sum of factors: 107 (capped at 100)").
- **Honest suggestions.** Each connector's suggested delta excludes any
  sensitive yield whose category isn't consented (completing the import
  wouldn't pay out those points either — a suggestion promising points
  an import wouldn't deliver is a dark pattern by another name), and is
  **clamped to the remaining headroom** below 100 (a "+12" at score 95
  is shown as "+5"). Suggestions are ranked by delta descending; a
  wholly-sensitive connector doesn't appear at all until its category is
  opted in.
- **The floor still holds.** A k-floor-violating audience is refused
  (422, with `size`/`kFloor` in the payload) regardless of how high the
  creating persona's score is. Score buys better-priced inventory, never
  a smaller-than-k audience.

---

## The regression the suite caught (and the fix)

Moving claim-writing from `advanceImport` to `commitImport` stranded the
persistence trigger. The declarative write-through map in `registry.ts`
still listed `advanceImport: ["imports", "graphClaims"]` (but advance no
longer writes graphClaims) and had **no entry for `commitImport`** — so
committed claims lived in the in-process Map (every in-process read
passed) but **never flushed to the validator**: no restart survival, no
ciphertext at rest.

`accept-bp` check 8 caught it precisely because it's a *non-vacuous*
vault test — it imports a claim, then greps the validator's
`graphClaims` namespace and asserts (a) no plaintext needle and (b)
records exist as `{v:1, ct:string}` ciphertext. The "records exist" half
is what fired: *"import did not flush."* A weaker test that only greps
for absent plaintext would have gone false-green on an empty namespace.

Fix: `advanceImport: ["imports"]`, `commitImport: ["imports",
"graphClaims"]`. This is a [never-fail-open] instance — the write
silently succeeded in memory and silently failed to persist; the test
refused to accept the silent half.

---

## The false-green trap the recon flagged (and how the needles dodge it)

`root-leak.mjs`'s positive vault-plaintext needles had to be connector
labels/issuers that **actually flush** on import — "Controls a
verifiable DID", "did:web:layers.example", "Northgate Bank", "Corvid
Health", etc. The obvious needles ("Espresso", "Amateur astronomy") are
**seed self-claims that live in a read-time overlay and never persist to
graphClaims** — greenlighting on their absence would prove nothing. The
recon caught this before it cost a false-green; the needle comment
documents the trap so the next editor doesn't reintroduce it.

---

## What the vault must hold (updated)

Unchanged in shape, sharpened in coverage: `graphClaims`,
`graphConsent`, and `imports` are the backpack's vault namespaces.
graphClaims is the sensitive one — claim labels, values, issuers,
methods — and it now flushes as ciphertext **on commit** (the gap this
pass closed). The invariant the tests enforce: an imported backpack
claim is readable by our own client (decrypt-at-hydrate) and is
ciphertext at rest on the untrusted validator, never plaintext, and
survives a restart.

---

## Suite

`scripts/accept-bp.mjs` (`test:bp`), registered in `package.json` and
`scripts/sweep-x.sh:15` SUITES. 8 checks, all ARMED:

1. Import previews before committing; nothing written until commit;
   preview matches what lands exactly.
2. SAFETY: a sensitive yield is withheld until opted in — shown held in
   preview, never written on commit, appears nowhere (claims *and*
   score) until consent, then lands.
3. Per-claim provenance inspectable — method + issuer per claim, tiers
   distinct, rendered on the page.
4. Anti-gaming: self-declared barely moves the score, attested moves it
   substantially (explicit thresholds + a minimum gap).
5. Breakdown sums to rawTotal exactly; score = min(100, rawTotal);
   driven above 100 to prove the cap is a real, disclosed clamp.
6. Suggestions ranked by delta; never surface an un-opted sensitive
   category; opting in grows the delta.
7. SAFETY: a high-score profile still cannot bypass the audience
   k-floor.
8. SAFETY: an imported backpack claim is ciphertext on the validator,
   never plaintext (non-vacuous — imports first, then asserts records
   exist *as* ciphertext).

---

## KNOWN-BROKEN / not in scope

- **Crypto transfers remain out of scope and non-executable** by the
  assistant, per the standing safety set — nothing in this pass touches
  fund movement.
- Gate 0 selective resolution was pre-existing; this pass did not extend
  it beyond confirming coverage.
- The score's category base values and the k-floor are fixture
  constants, not tuned economic parameters — a real deployment would
  calibrate them.

---

## Verification

All ARMED (`LAYERS_REQUIRE_SIG=true`, production build, `next build` +
`next start`), against a dual-server restart discipline.

- **tsc:** clean.
- **`test:bp`:** 8/8, standalone.
- **Full sweep (all 46 suites, incl. `test:bp` newly wired into
  `sweep-x.sh:15`):** `run1 bp ok 8/8`; **TOTAL 305 passing checks, 0
  failed suites.** The only blemish was 3 suites (`m2`, `a6`, `b2`)
  reporting INFRA with **0 FAILED** — `page.goto: Timeout 30000ms
  exceeded` on heavy pages, where the mocks' injected 200–1500ms per
  adapter call pushes a full render past Playwright's 30s default. Not a
  product break (the assertion never runs — the page didn't finish
  loading), and timing-variant (a6 showed 3 infra in one run, 1 in
  another). Confirmed by re-running each standalone: the same
  render-timeout pattern, still 0 FAILED. This is the known
  cold-render/latency-injection flakiness, not a regression from this
  pass (m2/a6/b2 are pre-existing suites this pass didn't touch).
- **restart-survival: 29/29**, including the two that directly validate
  this pass's fix under a real dual-server restart — *"BACKPACK CLAIMS +
  SCORE survived restart — same claim, same provenance, same recomputed
  score"* and *"VAULT: the survived backpack claim was ciphertext at
  rest, not plaintext."*
- **Regression on the shared `registry.ts` change:** `ux4` 7/7, `g2`
  4/4, `rootleak` clean — the import-touching suites and the positive
  vault needles all green; graphClaims now flushes correctly through
  `commitImport`.
