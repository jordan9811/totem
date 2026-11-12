# Running it

Three ways to run Totem: the laptop rig, the production-shaped pair, and the owner service. Same code; the environment picks the shape.

::: info Status
The laptop rig and the production-shaped pair run on any machine with Node 24. The owner service runs only on Railway, and the owner arms it with PowerShell scripts. What each shape is, and why there are three, is on the [Architecture](./architecture.md) page.
:::

## At a glance

<ol class="flow">
<li><strong>Install</strong><code>npm run setup</code>: dependencies, Chromium for the suites, the seed corpus, the validator's fixture world.</li>
<li><strong>Validator</strong><code>npm run validator</code> on port 4001. SQLite through <code>node:sqlite</code>.</li>
<li class="flow__us"><strong>App</strong><code>npm run dev</code> on port 3001, with <code>ZK_DEV_HOOKS=true</code>.</li>
<li><strong>Open it</strong><code>http://localhost:3001</code> is the landing page; <code>/home</code> is the app.</li>
<li><strong>Test it</strong>One suite with <code>npm run test:&lt;name&gt;</code>, or the full sweep.</li>
</ol>
<p class="flow__note">That is the rig. The production-shaped pair and the owner service are below.</p>

## Ports

Every entry point takes its port from `lib/ports.ts` or a byte-identical shell copy, not from a literal.

| Port | What | Variable |
|---|---|---|
| 3001 | the Next app | `LAYERS_APP_PORT`; on a host, `PORT` |
| 4001 | the validator | `LAYERS_VALIDATOR_PORT` |
| 3011 | the docs dev server (`npm run docs:dev`), at `/docs/` on 127.0.0.1, strict; the app itself serves the built docs at `/docs` | none |
| 4319 | the loopback Neynar stub, in stub mode only | `PRODLIVE_STUB_PORT` |
| 3019, 4019, 4009 | throwaway servers some suites start and stop themselves | none |

`scripts/start-app.mjs` refuses to start when a local `VALIDATOR_URL` names a port other than the pinned one. A stale `:4000` in `.env.local` once pointed the app at a dead validator for a whole pass.

## 1. The laptop rig

The rig is the original shape: the server holds the seeded keystore in `.keystore/` and answers `/api/*` itself. The mock adapters add 200 to 1,500 ms of latency and fail 2% of calls on purpose, so every surface handles loading and error states.

```bash
npm run setup                 # once: install, Chromium, seed/generate.mjs, validator/seed.js
export ZK_DEV_HOOKS=true      # both processes: the dev hooks, which the suites need
npm run validator             # :4001
npm run dev                   # :3001, for working on a page
npm run build && npm start    # :3001, the production build the sweeps run against
```

- **Node 24.** The validator needs `node:sqlite`, which arrived in Node 22.5; both deployment images use 24.
- **Windows.** The shell scripts run in Git Bash. Prefix a command with `MSYS_NO_PATHCONV=1` when an argument looks like a path (`/data`), or Git Bash rewrites it.
- **`.env.local`** is optional and gitignored. By name: `NEYNAR_API_KEY` and `NEYNAR_WALLET_ID` (the owner's Neynar app), the `FC_TEST_*` set (the throwaway Farcaster account), and `VALIDATOR_URL` with `NEXT_PUBLIC_VALIDATOR_URL`. Without any of them everything runs on fixtures. Content stays on the seed unless `DATA_SOURCE=neynar` is set, whatever keys are present.
- **Real casts from the rig** are possible with those keys and `ENABLE_FC_WRITE=true`, through the same write door the owner service uses (the runbook's Option 0). {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(b) OPTION 0 — real casts today from the laptop rig"}
- **Seeing disclosure from the other seat:** `POST /api/dev {"action":"viewAs","personaId":"<persona>"}` renders every surface as another persona; `personaId: null` returns to yourself.

`npm run build` runs `scripts/build-device.mjs` first. That writes `public/device/device.js`, which is not tracked in git, so a build that skips it serves a 404 for its own device.

## 2. The production-shaped pair

The public preview's shape, on your machine: `NODE_ENV=production`, `ZK_DEV_HOOKS` empty, every must-not-ship variable blanked, `LAYERS_REQUIRE_SIG=true`. The server holds no identity, so open pages in a real browser: a `curl` or a Playwright `context.request` reaches the server, which answers "no identity".

```bash
bash scripts/run-prod-shape.sh --build                     # build, then start the pair on 3001 / 4001
bash scripts/run-prod-shape.sh --no-restart test:cu6       # run suites against the running pair
node scripts/accept-prodlive.mjs                           # the page-level suite (it refuses a rig)
PRODLIVE_FC_READ=stub bash scripts/run-prod-shape.sh       # arm the read relay against the loopback stub
```

- **What the launcher sets.** It reads the must-not-ship list from `validator/env-contract.js` at run time, so the two stay in step. It passes `VALIDATOR_URL`, `NEXT_PUBLIC_VALIDATOR_URL` and `APP_URL` explicitly, because a variable already set beats `.env.local` in Next. After startup it checks that `/api/dev` answers 403 and that the read relay is unarmed (or armed, in stub mode), and stops if either is wrong.
- **What it changes on purpose.** Every local browser context reaches the validator from one loopback address, so the launcher raises two local limits: new roots per address per day to 1,000 (`PRODLIVE_ROOTS_PER_DAY`) and the validator's token bucket to 3,000 burst and 50 a second (`PRODLIVE_RL_CAPACITY`, `PRODLIVE_RL_REFILL`). The shipped defaults are 100 roots, 300 burst and 5 a second. The validator ignores the two token-bucket names on a hosting platform; the roots cap is honoured everywhere, so leave it alone on a deployment.
- **The read key stays out.** `NEYNAR_READ_API_KEY` is blanked for the app by default, so a key kept in `.env.local` does not arm the relay against the real network during a test. Stub mode injects a fake key, the stub's base URL and one discovery source (`PRODLIVE_FC_READ_SOURCE=fids` or `house`), and fails the run if the relay sent the stub anything it must not send.
- **Logs** land in `$TEMP/layers-app.log`, `$TEMP/layers-validator.log` and, in stub mode, `$TEMP/layers-neynar-stub.log`.
- **Read the per-suite lines.** The launcher exits 0 even when a suite fails.

## 3. The owner service

The owner service does not run locally; it is a rig-shaped pair on Railway in its own project, `layers-owner`. What it trusts is in the privacy posture. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

| Script | What it does | Spends |
|---|---|---|
| `scripts/owner/arm-owner-service.ps1` | Passphrase, boot, gate checks, roster hand-over, sign-in, the 24 words (after typing PAPER), then arms live writes. Resumable with `-Step`; `-WhatIf` prints every action and does none. | nothing |
| `scripts/owner/acquire-fid.ps1 -PersonaId p_…` | Arms account creation, prints the dry-run cost sheet, and only after the owner types SPEND creates one Farcaster account for one persona; then offers to disarm. | about $0.35 to $0.90 of ETH per account |
| `scripts/owner/arm-live-reads.ps1` | Not the owner service: arms live reads on the PUBLIC app with a second Neynar key and one discovery source; `-Disarm` is its kill switch. | Neynar credits under a daily budget |

Run each in a standalone Windows PowerShell 5.1 window, not an IDE terminal and not a shared screen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-owner-service.ps1
```

The scripts keep their state and secrets under the owner's `$HOME\.layers\`, send every secret to Railway on stdin only, read each one back and compare it in memory, and name the project, environment and service on every Railway call. `notes/runbooks/GO-LIVE-FARCASTER.md` is the full runbook, `notes/runbooks/GO-LIVE-MORNING.md` the short version. To deploy the owner service, see [Deploying](./deploy.md). {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(c) THE OWNER SERVICE on Railway"}

The empty world, once it ships, is one more variable on `owner-app`: `LAYERS_WORLD=empty`. The app refuses any other non-empty value at boot, so a typo does not leave the demo world showing.

## The docs site

```bash
npm run docs:generate          # regenerate the from-source pages (adapters, scopes, data model, roadmap data)
npm run docs:dev               # VitePress on http://127.0.0.1:3011/docs/
npm run docs:check             # privacy claims must cite; every cite must resolve
npm run docs:sync              # cited sections hashed against docs/.cite-lock.json
npm run docs:sync -- --update  # re-lock after re-reading the pages that cite a drifted section
npm run docs:build             # a local build into docs/.vitepress/dist; SHOW_INTERNAL=1 adds the internal section
npm run docs:summary           # append new pages to docs/SUMMARY.md, never reorder it
```

The app serves the docs at `/docs`. `npm run build` builds them into `.docs-site/` (gitignored, and left out of a deploy's upload) with `SHOW_INTERNAL` removed, checks them with `scripts/docs-guard.mjs`, and only then runs `next build`; `app/docs/[[...slug]]/route.ts` serves that folder. `npm run docs:build` writes `docs/.vitepress/dist` for a local look; the app does not serve that folder. Nothing in the app's code imports from `docs/`, and `tsconfig.json` excludes it; `test:m2g8` and `test:cu6` check both. The docs may read app source, and the generated pages do exactly that.

## The obvious questions

### Why does `npm start` look broken locally?

Because without `ZK_DEV_HOOKS=true` a production build is the public shape. The server holds no identity, so server-rendered islands wait for the device in your tab. Open the page in a browser and it works; a `curl` of an API route gets "no identity" by design.

### Why did my test run mint so many roots?

Every full page load by a visitor who has not saved their identity mints a new root. The validator allows 100 a day per address, and against Railway that address is yours. `accept-prodlive` saves its identity once and restores it on every later load, and fails if a run mints more than 3.

### Why does the app refuse to start?

It names the reason and never a value. The usual ones: a must-not-ship variable is set on a production build without the dev hooks (exit 78); `LAYERS_REQUIRE_SIG` is not `true` there (exit 78); a local `VALIDATOR_URL` disagrees with the pinned validator port (exit 2); a rig-shaped build on a hosting platform lacks `OWNER_ACCESS_SECRET` or a private `VALIDATOR_URL` (exit 78). {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Can I point the rig at the real network?

Yes, deliberately. Live content needs `DATA_SOURCE=neynar` and a key; live writes need `ENABLE_FC_WRITE=true` and the throwaway credentials; account creation needs `FID_ACQUIRE_ENABLED=true` and the owner's command. None of these happen because a key is merely present.
