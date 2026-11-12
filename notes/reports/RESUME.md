# RESUME — MEGA PASS 2 "The rails are open" (reputation UBI + lenses + modular UI + interop hooks + docs site)

Prompt: `notes/prompts/mega-pass-2-prompt.md` (repo root). Max 24 iterations (G1:4 G2:4
G3:3 G4:3 G5:2 G6:2 G7:2 G8:4, call options off the remainder). Gates 1–2
single-threaded and first; if either cannot close cleanly, stop. Wall clock
14 h hard stop. Commit at every green gate after `git check-ignore -q` on
.env.local .keystore/ validator/layers.db .zk-artifacts/. Report:
`notes/reports/REPORT-MEGA2.md`. Baseline: `9d809bc` (Multi-FID pass closed on `526addf`,
478 ×4; + the anoncast reveal, 487 checks / 65 suites in `sweep-x.sh`).

## Standing constraints (this session)

- ORCHESTRATION: I am the orchestrator (Fable 5.1). Any subagent MUST run as
  Opus or Sonnet with the model set explicitly on every spawn; subagents
  only for (a) the three Gate 7 reviewers and (b) parallel page-writing in
  Gate 8's historical docs, each on a bounded brief. Gates 1–2 are mine alone.
- Live spend: only Gate 5's DM hook may touch a real API, read-only, under
  the spend ledger, ≤ $1, and only if X credentials exist; otherwise
  fixture. No FID creation this pass. Everything else: fixture, pinned
  ports 3001/4001, fixed runner, no spend/post/deploy.
- Standing rules carry over: adapters first, X visual parity, fail-closed
  on privacy surfaces, safety features never KNOWN-BROKEN, retry adapter
  reads, no new crypto primitives (proof-mediated things ride the existing
  tier/attestation machinery), computed privacy label, vault plaintext
  never at rest server-side, 4 consecutive clean sweeps on identical code
  to close.
- Never echo `.env.local`; never print a private key.

## Current state

- BROWSER KEYSTORE PASS — **Gates 1–6 CLOSED; the preview is LIVE.** Gate 1 `d68aff3`, Gates 2–4 `90471d4` + `7dbfb61`, Gate 5 `0d2e254` (three adversarial reviews, 52 findings, every one fixed or an assumption by id), Gate 6 `3a0cc6a` + the deployment commit that follows it. App: `https://app-production-15c4.up.railway.app`. Validator: `https://validator-production-db6b.up.railway.app`. Both report commit `3a0cc6a` in their signed health payloads.
- PROOF: `npm run smoke:deployed` **8/8 against the deployed URLs** — the landing renders cold, the app boots a device in an empty profile, the banner names the COMPUTED label, a persona is created and a post round-trips, dev routes are refused, and **two browser profiles get two independent roots** (the exit the preview pass halted on). Locally: `test:cu6` 10/10 and `test:cu4` 9/9 on a production-shaped pair, `test:cu2` 9/9, `test:cu3` 7/7, `test:device` 10/10, `test:no-keystore` 3/3, `test:device-restart` 5/5, validator units 40/40, and the full legacy list **79 of 79 suites**.
- OPERATIONS: the kill switch is `LAYERS_MAINTENANCE=true` per service (a variable change; clearing it needs `railway redeploy`, because a running container keeps the environment it started with). Backups: `VACUUM INTO` at boot and every six hours into the volume, newest 28 kept; restore with `node scripts/validator-restore.mjs <dump>`. Rollback: deploy the target commit from a checkout (exercised: rolled back to `0d2e254`, saw the landing page disappear from the live URL, rolled forward). Teardown, which stops every charge: `railway delete --yes`.
- COST: single-digit dollars a month on top of the $5 plan already being paid; no single service is near the $20/month line, so the reserved spend question never triggered. The workspace has no hard limit set.
- THE TWO OWNER DECISIONS, both reserved by the prompt and neither blocking: a custom domain (the preview is on platform subdomains; moving hosts orphans any passkey saved under the old one, because the WebAuthn RP id is the host), and whether to keep it running.
- NOT IN THE TREE, NAMED: no social login on the deployment (the fixture provider is a rig adapter and is refused; A-CU-2-REAL-PROVIDER-NOT-EXERCISED), no GitBook connection (the repository has no remote — everything on the repo side is ready and `notes/runbooks/CONNECTING-GITBOOK.md` is the five-minute version), no content security policy yet (A-CU-6-NO-CSP-YET), unified search over a linked root's vault (A-CU-3-UNIFIED-SEARCH-IS-PRESENTATION-ONLY), server-side public-only rendering (D-CU-0-4).
- NEXT: /verify — four consecutive clean sweeps on identical code, tsc strict and the production build clean, then notes/runbooks/MORNING.md is the handover.
- RIG NOTE: the dev keystore and validator DB were rebuilt from seed during Gate 1 stage 2. `node validator/seed.js --force` now emits `.keystore/fixture-roster.json` too, so the rig is reproducible from nothing.

- BROWSER KEYSTORE PASS (2026-09-16, from `e177b65`; prompt `notes/prompts/browser-keystore-prompt.md`): Gate 0 design gate DONE — `docs/custody-model.md` (D-CU-0-1..14, two assumptions, the browser/server table, the staged Gate 1 plan and its recorded deviations); `notes/reports/REPORT-CUSTODY.md` opened. Next: Gate 1 stage 1 (platform layer: noble-based createHash/randomBytes/AES-GCM shared by Node and the browser; retire server-only/node:* from modules that must run in the browser), behaviour-preserving, proven by the crypto + zk suites before stage 2 (validator multi-anchor, migration 16).

- PUBLIC PREVIEW PASS (2026-09-16): Gate 0 readiness audit run and HALTED THE PASS — multi-tenancy does not hold (two strangers share one root, one persona roster, one corpus) and unauthenticated dev actions mutate every visitor's state even in a production build. Findings, evidence tables and what would need building: `notes/runbooks/PREVIEW-READINESS.md`; instruments `scripts/audit-preview-g0.mjs` and `scripts/audit-secrets.mjs` (secrets: clean). Gates 1-6 NOT started. Rig restored to the harness config on `ad7207a`.

- /verify series 1 on `2221dbf`: HALTED at 0 of 4 — sweep 1 = 550 passing, 1 failed suite (m2g1 check 5: no NEW stewardship row — the zk dev reset rewinds the epoch clock and the validator kept stewardship rows from earlier runs, so the per-root-per-epoch dedupe swallowed the new accrual; a rig collision, the product rule is right). Fix: `/zk/dev/reset` clears stewardship rows (validator/zk.js). Series 2 targets the commit after that fix.
- /verify CLOSED on `55b25da`: series 2, four consecutive clean sweeps (551/551, 73/73, 0 infra). notes/runbooks/MORNING.md written; notes/reports/SWEEP-STATUS.md has the series table; notes/reports/REPORT-MEGA2.md has the closing bar. Nothing pending. Next pass starts from the closing commit (see `git log -1`).
- (superseded) /verify IN PROGRESS on `2221dbf` (all eight gates committed; reviews answered; restart-survival 36/36; docs green). Closing series: `att-sweep-one.sh N $TEMP/m2-sweeps/s1` for N = 1..4, one per background call; results in `$TEMP/m2-sweeps/s1/run-N.txt` (last line `SWEEP_EXIT=`). DO NOT edit docs/, notes/reports/REPORT-MEGA2.md, SECURITY-POSTURE.md, notes/runbooks/MORNING.md or notes/reports/SWEEP-STATUS.md cited sections while a sweep runs — `test:m2g8` re-locks nothing and flags drift. After 4 clean: write notes/reports/SWEEP-STATUS.md (new section), notes/runbooks/MORNING.md, `npm run docs:sync -- --update`, `npm run docs:check`, commit `mega2: /verify CLOSED`.

- START: 2026-09-15 (from `9d809bc`)
- Gate 1 (reputation UBI): **GREEN, committed `26b90b2`** (`test:m2g1` 8/8, validator units 40/40, 18-suite regression green; `test:m2g1` in sweep-x.sh → baseline 495 / 66).
- Gate 2 (lenses): **GREEN, committed `2a65941`** (`test:m2g2` 7/7, 18-suite regression green; in sweep-x.sh → baseline 502 / 67).
- Gate 3 (scroll zones + action buttons): **GREEN** on the gate suite (`test:m2g3` 8/8, 2 iterations; one rig fix — the Default window holds no long-form post, so the suite reads under Curate). 19-suite regression green; COMMITTED as `mega2: gate 3 green (8/8)` (hash in `git log`). `test:m2g3` in sweep-x.sh (baseline → 510 / 68).
- Gate 4 (unified search): **GREEN** on the gate suite (`test:m2g4` 8/8, 2 iterations; one rig fix — the paraphrase overlapped the canary by stem). 19-suite regression green; COMMITTED as `mega2: gate 4 green (8/8)`. `test:m2g4` in sweep-x.sh (baseline → 518 / 69). Posture §15 search half appended.
- Gate 5 (DM-to-bookmark hook): **GREEN** on the gate suite (`test:m2g5` 7/7 + validator units, 2 iterations; two rig fixes). 23-suite regression green; COMMITTED as `mega2: gate 5 green (7/7)`. `test:m2g5` in sweep-x.sh (baseline → 525 / 70). Live spend $0.00 (fixture; no creds).
- Gate 6 (relationship porting): **GREEN** on the gate suite (`test:m2g6` 8/8, first run). 25-suite regression green; COMMITTED as `mega2: gate 6 green (8/8)`. `test:m2g6` in sweep-x.sh (baseline → 533 / 71).
- Gate 7 (linkage v5): **GREEN** (`test:m2g7` 9/9, 3 iterations, two rig fixes); in sweep-x.sh (baseline → 542 / 72); posture §15 has A-MEGA2-STAKE-COTIMING (measured set 10). Part 1 committed `7692012`. Reviews DONE (`research/attack-mega-{1,2,3}.md`: 1 CRITICAL, 2 HIGH, 3 MEDIUM, 2 LOW, 1 INFO) — all fixed or assumed by id (REPORT part 2 table; posture §15 tail): persona-scoped DM hash, `modes` + `readwise` sealed as one opaque record each, pending ports expire (30 d), keyed sender hash, rep_events hour grain + migration 15, device-loss cache resets. Linkage v5 now 10/10 on the fixed build; 12-suite check green. Part 2 COMMITTED (see git log); restart-survival re-run green after the fixes.
- Gate 8 (docs site): **GREEN** (`test:m2g8` 8/8; 2 build iterations + 2 suite iterations, all rig). VitePress 1.6.4 on 3011; `npm run docs:build|dev|check|sync|generate`; `SHOW_INTERNAL=1` for the internal section; 61 pages, 14 full pass pages + 2 stubs; lock `docs/.cite-lock.json`. COMMITTED. Re-run `npm run docs:sync -- --update` after any report edit and commit the lock.

## Gate 1 in one paragraph (so a fresh session can pick it up)

Allowance = `lib/influence/allowance.ts`, ONE opaque sealed vault record
(namespace `influence`: balance {epoch, allowance, remaining, tier}, per-
action defaults + directions, the owner's own stake mirror, settled
accruals). Stakes = `lib/influence/stakes.ts` → validator `POST /stakes`
(`validator/stakes.js`, migration 14; rows per PERSONA, signed by the
persona key over `layers-stake/1|mode|persona|cast|action|direction|
amount|epoch|nonce` — DELIBERATE DUPLICATE both sides), reserve-before-send
/ refund-on-refusal, verified at every read against `publicKeyForPersona`.
Accrual = `lib/influence/accrual.ts`: PURE `evaluateStakes(rows, ctx,
curves)` over public rows (confirmation from notes/standing/non-retraction;
NO dwell — the event log forbids it; the early curve is one weighted term,
`// TUNE`), `settleStewardship()` evaluates epoch-1 and posts
`/events {rootId, type:"stewardship"}` (validator `rep.js` WEIGHTS +
`/events` VALID) — so under zk the persona proves the higher tier through
the same tree membership. Clusters = `lib/influence/clusters.ts` (pure).
Seeds = `lib/influence/seed.ts` (signed through the product path;
cluster crypto_4/5/6 on 0xcr0001/0xcr0036/0xcr0118 in E-1; two epochs of
outcomes). API `app/api/influence` (views: allowance/history/cast/clusters/
accruals/evaluate; actions: stake/setSettings/settle). Action routes
react/refute/annotations-vote carry the default stake (zero = none; the
action stands whatever the stake says). UI `/settings/influence`
(`InfluencePane`). Card: a HIDDEN `data-testid="cast-stake"` span (parity
untouched). `docs/root-reads.md` §G names accrual.ts for the z6 grep.

## How to run

- Servers: `bash <scratchpad>/att-run.sh [--build] [--no-restart] suites…`
  (kills by port, starts the supervised validator + the app on 3001/4001
  with `ZK_DEV_HOOKS=true LAYERS_REQUIRE_SIG=true ZK_PREFETCH_MS=3000`,
  waits on the signed probes, warms). Outputs in `$TEMP/att-run/<suite>.txt`;
  this pass's run logs in `$TEMP/m2-runs/`.
- Sweeps: one per background call via `<scratchpad>/att-sweep-one.sh N
  $TEMP/m2-sweeps/<series>`. Baseline 487 checks / 65 suites BEFORE this
  pass's suites join `scripts/sweep-x.sh` (each gate adds its suite at
  green; never edit sweep-x.sh while a sweep runs).
- HARNESS RULE: one harness at a time; wait for HARNESS_EXIT.
- Scratchpad: `C:\Users\jorda\AppData\Local\Temp\claude\C--Users-jorda-OneDrive-Documents-SOCIAL-MEDIA\0007b404-c46b-4c8b-b230-fe7397dc0ecd\scratchpad`
  (`att-run.sh`, `att-sweep-one.sh`, `m2g1..m2g8-edits.cjs` — anchored CRLF-aware edit scripts, one per gate, each
  anchoring on the previous gate's output; `anchor-dry.cjs <script>` dry-runs the anchors; `g5/`, `g6/` staged trees;
  `docs-scaffold.cjs` (idempotent docs site scaffold); `g7-brief.md` (the reviewer brief, {{FOCUS}}/{{N}} placeholders)).

## Exact next command (for a fresh session)

1. Read this file, then `notes/reports/REPORT-MEGA2.md` (tail) and `git log --oneline -5`.
2. `node scripts/lib/health-probe.mjs http://localhost:3001 layers
   --peer=http://localhost:4001` and `… :4001 layers-validator` — if DOWN,
   `bash <scratchpad>/att-run.sh --build`.
3. Continue at the gate named above. The remaining sequence, each step only after HARNESS_EXIT of the previous:
   - Gate 4: when `$TEMP/m2-runs/g4-regress.txt` is all green, record it in notes/reports/REPORT-MEGA2.md (replace the Gate 4
     line "Regression set before the commit: below."), guard (`git check-ignore .env.local .keystore/ validator/layers.db .zk-artifacts/` must list 4),
     commit ONLY: notes/reports/REPORT-MEGA2.md notes/reports/RESUME.md SECURITY-POSTURE.md package.json scripts/sweep-x.sh app/(main)/search/page.tsx
     app/api/dev/route.ts app/api/search/unified components/UnifiedSearch.tsx lib/search scripts/accept-mega2-g4.mjs.
   - Gate 5: `node <scratchpad>/m2g5-edits.cjs && npx tsc --noEmit`, then `att-run.sh --build test:m2g5 test:validator`,
     fix, regression (incl. test:x2 test:ux3 test:c4 test:fid4 test:fid5 — readwise is now vaulted), add test:m2g5 to sweep-x.sh, commit its paths
     (+ fixtures/x-dms.json, scripts/accept-mega2-g5.mjs, scripts/live-m2g5.mjs, lib/x/inbox.ts, app/api/x/inbox, components/settings/DmHookPanel.tsx, app/(main)/settings/dm-hook).
   - Gate 6: `node <scratchpad>/m2g6-edits.cjs && npx tsc --noEmit`, `att-run.sh --build test:m2g6`, regression (incl. test:ux4 test:calla test:x1), sweep += m2g6, commit.
   - Gate 7: `node <scratchpad>/m2g7-edits.cjs`, `att-run.sh --no-restart test:m2g7` (the suite is written), then spawn the three reviewers
     (Agent tool, model sonnet, prompt = g7-brief.md with {{N}} = 1..3 and {{FOCUS}} = (1) stakes/allowance linking roots + lens guardrail bypass,
     (2) search/index leakage server-side + zone/binding records, (3) DM ingest sender→persona beyond the attestation + relationship ports),
     fix or ASSUMPTION by id, posture §15 final (add A-MEGA2-STAKE-COTIMING with the measured set size), sweep += m2g7, commit.
   - Gate 8: `npm i -D vitepress@1.6.4` (NO harness running), `node <scratchpad>/m2g8-edits.cjs`, `npm run docs:build`, fix content the build rejects,
     `npm run test:m2g8` (needs no app), add test:m2g8 to sweep-x.sh, commit docs/ scripts/docs-*.mjs notes/runbooks/CONTRIBUTING-DOCS.md .gitignore package.json package-lock.json.
   - /verify: `att-sweep-one.sh N $TEMP/m2-sweeps/s1` ×4 on identical code; greps; restart-survival; device-loss; tsc; build; notes/runbooks/MORNING.md.

---

# POST-DEPLOY PASS (current)

**Prompt:** `notes/prompts/post-deploy-prompt.md`. **Report:** `notes/reports/REPORT-POST.md`. Started from `b8d2222`.

## Where the gates are

| gate | state | commit |
|---|---|---|
| 0 — hygiene (sealing proven, port re-confirmation, below-bar label) | CLOSED, `test:pd0` 4/4 | `d3d183c` |
| 1 — persona cloning | CLOSED, `test:pd1` 6/6 | `d3d183c` |
| 2 — persona tint + unified cross-persona view | CLOSED, `test:pd2` 9/9 | `a9d0b3d` |
| 3 — per-account delivery tiers | CLOSED, `test:pd3` 10/10 | `6229339` |
| 4 — readwise knobs + dwell | built, `test:pd4` | uncommitted |
| 5 — three adversarial reviews + posture | reviews done, findings fixed | uncommitted |

## What Gate 5 changed, and why a re-run is wide

The three reviews (`research/attack-post-1.md`, `-2.md`, `-3.md`) found 3
criticals and 8 highs. The fixes reach well outside the gates that introduced
them, so the regression set for the closing sweep must include every suite that
touches:

- **the acting-persona resolver** (`lib/activePersona.ts` now keeps an explicit
  allowlist): anything that switches persona — `pd1`, `pd2`, `pd3`, `ux1`, `m3`,
  `accept`, `fid*`
- **the five newly scoped routes** (`/api/fc/persona`, `/api/x/port` GET,
  `/api/disclosure`, `/api/personas/bindings`, `/api/lenses?delta=`):
  `a1 anon-reveal fid1 fid2 fid3 fid5 m2g1 m2g2 m2g6 m2g7 ux1 ux2`
- **the feed** (quiet moved to the final sort, delivery on the live path, the
  facet-only rule compiled only when used, the strip dropped on a full exhaust):
  `a3 a1 a2 m2 m3 m4 g3 ux1 ux3 ux4 m2g1 m2g2 m2g4 accept`
- **`/api/rules`** (action allowlist): `a1 g2 m3 accept`
- **`reloadIdentity` / `resetSeed`** (every sealed cache now resets):
  `device device-restart cu2 cu3 no-keystore anon-reveal`

## Exact next command (for a fresh session)

1. Read this file, then `notes/reports/REPORT-POST.md` (tail) and `git log --oneline -5`.
2. `node scripts/lib/health-probe.mjs http://localhost:3001 layers --peer=http://localhost:4001`
   and `… :4001 layers-validator` — if DOWN, `bash <scratchpad>/att-run.sh --build`.
3. If Gates 4 and 5 are still uncommitted: run `att-run.sh --build test:pd0
   test:pd1 test:pd2 test:pd3 test:pd4`, then the regression set above, then the
   guard (`git check-ignore .env.local .keystore/ validator/layers.db
   .zk-artifacts/` must list 4), then commit.
4. Then **/verify**, which is the only thing left: the full legacy suite, the
   leak greps, restart survival, and **four consecutive clean sweeps on
   identical code** (`att-sweep-one.sh N <dir>` ×4). `scripts/sweep-x.sh`
   already carries `test:pd0` … `test:pd4`. Finish with `notes/runbooks/MORNING.md`.

**One harness at a time.** Wait for HARNESS_EXIT before starting another; a
second harness restarts the servers under the first and both results are void.
This session broke that rule once and paid for it.

## POST-DEPLOY PASS — CLOSED

Closed on `e2d909e`: four consecutive clean sweeps, 623 checks over 83 suites
each, 0 failed and 0 infra in every one. `notes/runbooks/MORNING.md` is the summary;
`notes/reports/REPORT-POST.md` the full write-up; `research/attack-post-disposition.md` the
per-finding disposition.

Nothing is outstanding for this pass. The call options in
`notes/prompts/post-deploy-prompt.md` (readwise module scaffold, ad-slot scrollbar control,
influence visualization) were not opened.

**Before the next closing series, purge the rig's accumulated validator rows.**
`resetSeed` does not clear validator TABLES, and ~15 sweeps of block-testing
suites left 97 rows in `blocks_v2` — enough to empty the classic fixture feed
and refuse the settle guard. `docs/internal/open-issues.md` has the detail.

