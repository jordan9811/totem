# Deploying

Both deployments run on Railway, and both are pushed from a checkout with `railway up`. Nothing deploys on a commit, because the repository has no git remote.

::: info Status
The public preview (`layers-preview`) and the owner service (`layers-owner`) **work live**; both ran `fe780a2` when checked on 2026-10-10, and the owner service's writes were armed on 2026-10-07. Five builds of 2026-10-08 (the empty world, the owner's passkey sign-in, the app's buttons going to Farcaster, the QR connect flow, the anon arm script) went out with `fe780a2`. The persona launch pass's first wave was deployed to both sites on 2026-10-11 and its second wave (rings, reach tiers, launch on a simulated registrar) on 2026-10-12, both still test data only. The docs are served by each app at `/docs` since 2026-10-10, which retired the separate docs service published that day.
:::

## At a glance

<ol class="flow">
<li><strong>Clean checkout</strong><code>git status --short</code> prints nothing. <code>railway up</code> uploads the folder as it is, minus <code>.gitignore</code>.</li>
<li><strong>Name the commit</strong>Set <code>LAYERS_COMMIT</code> with <code>--skip-deploys</code>, so the health payload names what is running.</li>
<li class="flow__us"><strong>Push</strong><code>railway up --service &lt;name&gt; --ci</code>, with the project named explicitly.</li>
<li><strong>Wait for the boot line</strong>Railway reports success before a refusing process exits. Read the latest logs.</li>
<li><strong>Verify</strong>Both signed health probes, then <code>npm run smoke:deployed</code>.</li>
</ol>
<p class="flow__note">The same five steps for every service. What differs is which project the folder is linked to.</p>

Before pushing a dependency change, run `npm run test:lockfile` (the sweep runs it too): it dry-runs the validator image's `npm ci --omit=dev --ignore-scripts` and the app build's `npm ci` on a temp copy of the manifests and lock, with your npm and with node:24-slim's (pinned in `scripts/check-lockfile.mjs`), and fails on a lock that `npm ci` would refuse, as Railway did on 2026-10-20 (`Missing: bufferutil@4.1.0 from lock file`).

## The four services

| Project | Service | Built from | State | Reachable |
|---|---|---|---|---|
| `layers-preview` | `app` | the platform's Next.js builder: `npm run build`, then `npm start` | none; holds no identity | public domain |
| `layers-preview` | `validator` | `Dockerfile.validator` (`RAILWAY_DOCKERFILE_PATH`) | SQLite on a 1 GB volume at `/data`, with `VACUUM INTO` backups every 6 hours, newest 28 kept | public domain |
| `layers-owner` | `owner-app` | `railway/Dockerfile.owner-app` | the owner's keystore and proving artifacts on a volume at `/data` | public domain, behind the owner passphrase |
| `layers-owner` | `owner-validator` | `railway/Dockerfile.owner-validator` | SQLite on a volume at `/data` | the private network only |

The owner project holds these two services and nothing else: anything deployed into the same project and environment could reach the owner validator's open dev routes over the private network. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

Both validators run under `scripts/validator-supervisor.mjs`, which restarts on a crash, appends the cause to `/data/deaths.log`, and passes a boot refusal (exit 78) through so the container stops where the platform shows it.

## Which folder deploys where

- **The main repository folder is linked to `layers-preview`.**
- **A separate git worktree is linked to `layers-owner`**, checked out detached at the commit the owner service should run. Run owner `railway up` from there, so each project has its own folder and its own link.
- A bare `railway up`, `variable set` or `redeploy` goes to whatever the current folder is linked to. Every command aimed at the public preview from anywhere else carries `--project`, `--environment` and `--service`, and the owner scripts name all three on every call.
- `railway status` before anything, every sitting. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "Before every sitting: the session preamble"}

## Verifying a deploy

```bash
node scripts/lib/health-probe.mjs <validator URL> layers-validator
node scripts/lib/health-probe.mjs <app URL> layers --peer=<validator URL>
BASE_URL=<app URL> VALIDATOR_URL=<validator URL> EXPECT_FC_READ=no_key npm run smoke:deployed
BASE_URL=<app URL> VALIDATOR_URL=<validator URL> node scripts/accept-prodlive.mjs   # once per deploy
```

The health payload is signed and names the commit from `LAYERS_COMMIT`; if it names the commit you pushed, that commit is serving. `EXPECT_FC_READ` must match the relay's intended state (`no_key`, `armed`, `bad_config` or `off`); there is no "anything goes" value. A full prod-live run against Railway costs about 3 of the 100 new roots the validator allows your address per day.

The owner service's health route is open, but every other page and route needs the owner session, so its checks run inside the owner scripts.

From the deploy that carries persona launch wave 3, two more checks on the public pair, both made by `npm run smoke:deployed` (checks 10 and 11): `curl -s "<validator URL>/zk/anon/web/head?mode=fixture&tree=valid"` through the platform's edge must answer a head or `{"error":"unknown"}`, never `{"error":"refused"}` (a refusal means the edge adds a header outside the web route's list, and every anonymous post from a browser would be refused: A-WEB-PROXY-HOP-HEADERS); and `<app URL>/device/prover.js.LICENSE.txt` must answer the GPL notice (since the go-live build check 10 also makes a short POST through the door, and check 11 reads the whole source offer and Help's link to it). {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(k) Persona launch, wave 3: anonymous posting from the public site, and Totem on X (test data; what going live needs)"}

## The kill switch and rollback

| To | Do this |
|---|---|
| pause a service | `railway variable set --service <name> LAYERS_MAINTENANCE=true`. Every route but liveness answers a static 503. Setting it redeploys the same image by itself. |
| resume | `railway variable delete` it, then `railway redeploy`. A running container keeps the environment it started with, and `railway restart` reuses that snapshot. |
| stop owner publishing now | `railway down --service owner-app --yes` removes the running container and keeps the volume. It does not stop a pending anonymous cast: the relay runs inside the validator, so use `arm-anon.ps1 -Disarm`, or delete `ENABLE_FC_WRITE` on `owner-validator` and redeploy it. |
| sign out a lost device | No Railway command: Settings › Security › **Lost this device?** removes that Face ID / fingerprint sign-in and signs out every device; **Sign out everywhere** for a device that did not add one; a new passphrase does both and retires every passkey. |
| roll back | Deploy from a checkout of the earlier commit. The CLI has no "redeploy this deployment id" verb; this path was exercised on the preview. |
| tear down | Delete by the project ID saved when the project was created. Plain `railway delete --yes` opens a picker over every project in every workspace, and `--yes` skips the confirmation after the pick. |

{cite: notes/reports/REPORT-CUSTODY.md > "5. The kill switch, and rollback"} {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(g) Kill switch and teardown"}

## Traps

### Windows PowerShell 5.1 adds a byte-order mark to piped stdin

Even with `$OutputEncoding` set to ASCII, PowerShell 5.1 prefixes piped input to a native program with `EF BB BF`, and Railway stores it. A secret piped with `--stdin` then carries three invisible bytes, and some readers do not trim them. The owner scripts set `[Console]::InputEncoding` and `$OutputEncoding` to UTF-8 without a BOM and self-test before sending anything; `test:owner-scripts` starts its console with a BOM to prove the fix holds.

### `railway.cmd` runs through `cmd.exe`

On Windows the CLI is a `.cmd` shim, so `|`, `>` and `&` inside a remote command passed to `railway ssh` run on your machine, not on the container.

### Setting a variable redeploys; deleting one does not

`variable set` redeploys by itself. Batch several sets with `--skip-deploys` and redeploy once, because a redeploy asked for while another is still building is refused. `variable delete` does not redeploy, and a restart keeps the old variables. After any change the only proof is the new deployment's boot line.

### No healthcheck: SUCCESS comes before the refusal

Neither app service has a healthcheck path, so Railway marks a deployment successful before a process that refuses its environment has exited. Read `railway logs --service <name> --latest` until the boot line appears: `[boot] OWNER SERVICE` on the owner app, `listening on :4001` on a validator, or the named refusal.

### A deployed image has no `.git`

Both services read the commit they report from `LAYERS_COMMIT`. Set it with `--skip-deploys` before `railway up`, or the health payload names the wrong one. `arm-live-reads.ps1` reads it to check the deployed build supports the house source.

### `.dockerignore` and the platform's manifest

Railway's upload lists every tracked file and resolves content through `.dockerignore`. Excluding a tracked path there to slim one image breaks the other service's build.

### The device bundle is a build artifact

`public/device/device.js` is gitignored. `npm run build` runs `scripts/build-device.mjs` before `next build`; a build that skips it serves a 404 for its own device.

### The browser prover is a second build artifact, and GPL-3.0

`npm run build` also writes `public/device/prover.js` and its `prover.js.LICENSE.txt` (gitignored, like `device.js`). The build fails if `device.js` is over 5,242,880 bytes (5 MiB; 4.5 MiB until 2026-11-07) or carries snarkjs, or if `prover.js` is over 1,572,864 bytes (D-PROVER-BUNDLE-BUDGET). `prover.js` is GPL-3.0, and serving it is distribution: its banner and license file must ship with it, and the build also writes its source offer to `public/device/source/` (gitignored): the build fails without the GPL text or with a copy that differs from its source (A-GPL-SOURCE-OFFER, resolved by the go-live build). {cite: SECURITY-POSTURE.md > "5. The GPL-3 note"}

### A deployed build ships no proving files

`.zk-artifacts` is in `.dockerignore`, and the build never downloads, so a deployed `/device/zk/manifest.json` says `present: false`. Test proofs need no files; a real proof in a browser refuses in plain words (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY). {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### Git Bash rewrites path-like arguments

`/data` becomes `C:/Program Files/Git/data`. Prefix the command with `MSYS_NO_PATHCONV=1`.

### Config lives in variables, not the repo

New Railway services do not adopt config-as-code files, so the owner services are defined by their two Dockerfiles, `RAILWAY_DOCKERFILE_PATH`, variables and volumes. A setting changed in the dashboard is not in the repository (A-PRODLIVE-CONFIG-IS-VARIABLES).

### A domain on the owner validator is checked only at boot

The owner validator refuses to start with a public domain or TCP proxy attached, but a domain attached to a running validator goes unnoticed until its next deploy. Do not attach one.

### Passkeys belong to the host

The passkey RP id is the host of `APP_URL`. Moving the public preview to a custom domain orphans every passkey saved on the platform subdomain, so the domain has to be chosen before strangers save. The owner app's Face ID / fingerprint sign-ins are bound to its `APP_URL` host the same way. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

On the live public site (`PUBLIC_LIVE=true`), a page request on any host but `APP_URL`'s, such as the platform's own `*.up.railway.app` address after the domain move, answers a 308 to the same path and query on `APP_URL`, with `cache-control: no-store`. `/api/*`, loopback and the platform's private network are never redirected, and `/api/health` always answers 200. `npm run smoke:deployed` check 15b checks this when `OLD_APP_URL` names the old address. The anon page's `img-src` names the app's media hosts (the same list the cards use), so pictures still load after **Open Totem** carries the session over; smoke check 15 holds it to that exact list. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Printing variables prints values

`railway variables` and `railway variable list` print values in every format, `--json` and `--kv` included. For names only, read the JSON keys, and do not run either in a shared or recorded terminal.

### A new custom header needs CORS on the validator

The browser device calls the public validator cross-origin. A new request header must be added to the validator's `Access-Control-Allow-Headers`, or every preflight fails and the device reports it as a refused bootstrap, which reads like an auth error.

## What it costs

The public pair measured at a few cents an hour on the Hobby plan ($5 a month, $5 of usage included); the owner pair is the same shape. Neynar costs are separate: casting is 150 credits, each active signer about 20,000 credits a month, and the public read relay is capped at 100,000 credits a day per instance by default. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(a) What you get, and what it costs"}

## The docs, at /docs on the app (live since 2026-10-10)

There is no docs service any more (D-DOCS-UNDER-APP, 2026-10-10). The app serves this site itself at `/docs`, and `npm run build`, which the platform runs for the public app and `railway/Dockerfile.owner-app` runs for the owner app, builds it between the device bundle and `next build`:

1. `scripts/build-docs.mjs` deletes `.docs-site/` and builds the site into it from the committed source, with `SHOW_INTERNAL` removed from the environment.
2. `scripts/docs-guard.mjs` fails the build if the output holds an internal page or chunk, the internal section's path, the internal roadmap's data, a platform app hostname, or a root-absolute link outside `/docs/`. It is the guard the retired docs image ran, ported.
3. `next build`. `app/docs/[[...slug]]/route.ts` serves `.docs-site/` at `/docs` with a content security policy of its own. <!-- uncited-ok: describes the build steps; the policy's privacy reading is on Tradeoffs and in the posture's section 16 -->

`docs:generate`, `docs:check` and `docs:sync` do not run in the app build. The generated pages are committed, and a citation that drifted must not block an app deploy; run all three before committing docs (`notes/runbooks/CONTRIBUTING-DOCS.md`).

**How a docs change ships.** With the app. A docs-only commit reaches readers at the next `railway up` of the public app, and of the owner app, where `/docs` sits behind the owner's sign-in like every other page. The app's kill switch pauses the docs too. The watch patterns in `railway.toml` exclude `docs/**`; that matters only if a service is ever connected to GitHub.

**Retiring the old service.** Delete `NEXT_PUBLIC_DOCS_URL` on the public `app` and on `owner-app` with the deploy: a value there overrides `/docs`, and the old value points at the retired service. Then delete the `docs` service in the public project.

**A trap for docs writers.** The guard fails the app build on any public page whose text contains the internal pages' path or a platform app hostname, including the public app's own address. Write "the internal pages" instead, and leave hostnames out. A raw HTML link in a page (`<a href>`) does not get the `/docs/` base: write it relative (`./page`). Why `/docs` rather than a separate origin is on [Tradeoffs](./tradeoffs.md#where-the-docs-are-served).

**robots.txt.** The app's `robots.txt` disallows the whole origin, so the docs are not indexed either.
