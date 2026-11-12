# GO LIVE ON FARCASTER — real accounts per persona, real casts

> **Going live is `notes/runbooks/GO-LIVE-TODAY.md` (2026-10-17): the steps to take Totem live for everyone, on the public site.**
> The public site is the product: people sign in with Farcaster there, save with Face ID, make personas, and their
> persona posts reach Farcaster through the public @anon. This file is the older manual reference for the owner's
> private service. Sections (b) to (g) are **not the go-live path**: they stay for the private service, which is
> optional now. Section (i), live reads for the public site, IS a go-live step (`notes/runbooks/GO-LIVE-TODAY.md` step 4); sections
> (l) and (m) are parked.
>
> **Use the scripts first: `notes/runbooks/GO-LIVE-MORNING.md`.** `scripts/owner/arm-owner-service.ps1`, `acquire-fid.ps1`,
> `arm-live-reads.ps1` and `arm-anon.ps1` automate sections (c)–(f) and (i), with every guard below built in and
> tested (`npm run test:owner-scripts`). The owner service's Railway project already exists: section (c) steps 2–4 were run
> on 2026-09-27 EXCEPT the passphrase (step 1 and step 4's `OWNER_ACCESS_SECRET` line), so owner-app is built and
> waiting for it; `arm-owner-service.ps1` makes and sets the passphrase and runs the step 5 checks itself. The
> worktree is `C:\Users\jorda\layers-owner-deploy`. This file is the manual reference. Where they differ, the scripts
> win: (b) step 1 — use the lines `arm-owner-service.ps1` prints, which move ONLY the custody key (the
> `Copy-Item .env.local` backup below copies every secret in the file); (d) — never put `FID_ACQUIRE_CONFIRM` in
> `.env.local` or leave it in your shell; disarm with `acquire-fid.ps1 -Disarm`, which also finishes an interrupted
> disarm; (i) steps 6–7 — `arm-live-reads.ps1` offers the raise to 100,000 right after its own passing smoke, so
> Claude's first measured read runs under the everyday cap rather than the 2,000 test cap.

This is your runbook for putting your personas on Farcaster for real: each public persona gets its own Farcaster
account (its own FID), and casts from it go out to the network. It is written for Windows PowerShell 5.1 on this
machine. The ordered checklist that points into this file is `notes/runbooks/OWNER-CHECKLIST.md`.

Two ways to do it, and you can do the first today:

- **Option 0 — the laptop rig.** No new infrastructure. The app you already run on `localhost:3001` makes the real
  casts. Works while your laptop is on.
- **The owner service.** The same rig, hosted on Railway as a private, passphrase-gated service that only you can
  open, so it runs without your laptop. This is decision **D-PRODLIVE-OWNER-SERVICE** (notes/runbooks/PREVIEW-READINESS.md,
  SECURITY-POSTURE.md §18).

The public preview (`app-production-15c4.up.railway.app`) stays keyless for writes: one identity per browser, no live
writes, no signer, no wallet. Once you give it a separate READ key (section i) it also shows real Farcaster posts,
read-only, through one server route. Section (h) explains why posting there cannot simply be switched on, and what
the pass after this one builds so that it can.

**How to read the markers.** The assistant never runs these steps for you. Steps that spend money or publish in public
are yours alone, and are marked like this:

- **[SPENDS MONEY]** moves real funds (ETH from your Neynar app wallet) or starts a recurring charge.
- **[PUBLISHES]** puts something on the public Farcaster network, where it can be seen by anyone and deleting it is
  only a request.
- **[SECRET]** handles a credential. It is always read from a file or piped in with `--stdin`, never typed on a
  command line (a command line ends up in your shell history and in process listings).

---

## Before every sitting: the session preamble

Sections (c) to (i) are done over several sittings, hours apart. `$ownerApp`, the signed-in session `$s` and
`Get-EnvLocal` exist only in the window that defined them; in a fresh window `$env:APP_URL = $ownerApp` sets nothing
and the acquisition command falls back to the laptop rig (it says `target app: http://localhost:3001` and stops
before anything billable, but it is a surprise). Open **Windows PowerShell 5.1** (not PowerShell 7) and paste this
first, every time:

```powershell
Set-Location "$HOME\OneDrive\Documents\SOCIAL MEDIA"
$OutputEncoding = [Text.ASCIIEncoding]::new()
function Get-EnvLocal($name) { ((Get-Content .env.local | Where-Object { $_ -match "^$name=" } | Select-Object -First 1) -replace "^$name=", "") -replace '^"|"$', "" }
git status --short
git log -1 --oneline
railway status
if (Test-Path "$HOME\.layers\owner-app-url") {
  $ownerApp = (Get-Content "$HOME\.layers\owner-app-url" -Raw).Trim()
  $pw = (Get-Content "$HOME\.layers\owner-secret" -Raw).Trim()
  Invoke-RestMethod -Method Post "$ownerApp/api/owner-login" -ContentType application/json -Body (@{ passphrase = $pw } | ConvertTo-Json) -SessionVariable s | Out-Null
  Remove-Variable pw
  "owner app: $ownerApp (signed in for 24 hours)"
}
```

- `$OutputEncoding` ASCII matters for every `| railway variable set --stdin` pipe below. Railway trims a trailing
  line break from stdin but not a leading byte-order mark; a UTF-8-with-BOM encoding would silently prefix the secret
  with three invisible bytes (`FC_TEST_SIGNER_UUID` is not trimmed by the app).
- `git status --short` must print nothing: `railway up` uploads this folder exactly as it is.
- `railway status` names the project this folder is linked to. From section (c) step 2 on, that is `layers-owner`.
  **Every command aimed at the PUBLIC preview must then carry
  `--project <railway-project-id> --environment production --service app`** (those IDs are not
  secrets; they come from `railway status --json` on the public project). A bare `railway up`, `variable set` or
  `redeploy` goes to whatever is linked, which after section (c) is the owner service.
- **Never run `railway variables` or `railway variable list`** in a terminal you share, record or paste from: every
  form prints values (`--json` and `--kv` include the raw values). For names only:
  `(railway variable list --service owner-app --json | ConvertFrom-Json).PSObject.Properties.Name`.

---

## (a) What you get, and what it costs

| item | cost | source |
|---|---|---|
| Railway, two more services (owner app + owner validator) with a volume each | Hobby is $5/month and includes $5 of usage; Pro is $20/month and includes $20. Usage is metered: RAM $10/GB/month, vCPU $20/vCPU/month, volumes $0.15/GB/month, public egress $0.05/GB. Traffic between the two services over the private network is not billed as egress. The public preview's pair measured at "a few cents an hour" (notes/reports/REPORT-CUSTODY.md), so expect a similar pair to land in single-digit dollars a month on top of your plan. Hobby volumes are capped at 5 GB; this needs well under 1 GB. | [Railway plans](https://docs.railway.com/reference/pricing/plans), [private networking](https://docs.railway.com/networking/private-networking/how-it-works) |
| Neynar API plan | Since the June 2026 plan update, new customers choose **Free** (10M credits a month, 600 requests per minute per endpoint, 1,000 per minute across all endpoints, all read and write APIs, 5 apps) or **Scale** ($249/month, 60M credits). Starter and Growth are grandfathered for existing subscribers. What happens when credits run out (requests stop, or overage is billed) is **not documented**: the only statement is that going over credits "will not automatically trigger rate limits". Check it on your billing page before section (i). | [Neynar rate limits and plans](https://docs.neynar.com/reference/what-are-the-rate-limits-on-neynar-apis) |
| Casting | No onchain cost. Credits only: posting a cast is 150 credits, deleting one 10, a like, recast or follow 10. Every signer you write with counts as a "monthly active signer" at **20,000 credits a month**. Worked example: three persona accounts, each posting ten casts a day, is 3 × 20,000 + 3 × 10 × 30 × 150 = **195,000 credits a month, about 2% of the Free plan**. | [Neynar credit pricing](https://docs.neynar.com/reference/compute-units) |
| Live reads on the owner service (`DATA_SOURCE=neynar`, optional) | Credits per page view: feeds are 4 credits per item requested, a cast lookup 2, a user lookup 1 per FID. This is the part that can grow; watch the usage page at dev.neynar.com for the first week. | same |
| Live reads on the PUBLIC preview (section i, optional) | Capped by the relay's own daily budget, **100,000 credits a day by default** (about 3M a month, 30% of Free), counted on cache misses only. The budget is per process and restarts with every redeploy. Assumed to draw on the **same credit pool** as your owner writes, even from a second app: confirm on the usage page. | SECURITY-POSTURE.md §19 |
| **[SPENDS MONEY]** One Farcaster account per persona | About **$0.35 to $0.90 of ETH each**, paid from your Neynar app wallet on Optimism (measured in the Farcaster pass; Neynar's own guide says "~$0.10–0.50 in gas" for a registration). Checking the name is 1 credit. | notes/reports/REPORT-FC.md Gate 1; [Neynar app wallets](https://docs.neynar.com/docs/managing-onchain-wallets) |
| The app wallet itself | Neynar asks for "$5+ ETH on Optimism" before the first account call, because the first call pre-registers a few accounts. You funded it in the Farcaster pass. App wallets **cannot be withdrawn from** (the Farcaster pass found this), so fund only what you will use. | [Neynar account creation](https://docs.neynar.com/docs/how-to-create-a-new-farcaster-account-with-neynar) |
| The anon relay account (section f, optional) | The relay's own casts, at the casting prices above. One thing to switch off: a Neynar key on the validator also starts its reputation poller unless `VALIDATOR_POLLER=off` is set there. Section (c) step 3 sets it when the validator is created, and section (f) sets it again before the key. Left on, the poller reads one real account every 60 seconds with a user lookup and a 25-cast feed read. That account is fid 9152, the real **@warpcast** account the fixture world borrowed for its "self" — not you. By the published table that is up to about 100 credits a minute, **up to ~4.4M credits a month, about 44% of the Free plan**, for as long as the key is on the validator. | validator/poller.js; [Neynar credit pricing](https://docs.neynar.com/reference/compute-units) |

**Caps built into the code.** Two persona accounts and $10 of account-creation spend in total, checked before any
billable call and again by the app, on a ledger that survives resets. You can raise both (section d, step 9), up to
hard bounds of 20 accounts and $25. The write ledger separately caps casts at 10 a day and all actions at 30 a day,
and refuses loudly past that; it never queues.

---

## (b) OPTION 0 — real casts today from the laptop rig

> **Not the go-live path (2026-10-17).** This section is for the owner's private service, which is optional now. Going live for everyone is `notes/runbooks/GO-LIVE-TODAY.md`.

Nothing new to deploy. Your `.env.local` already holds what the Farcaster pass left there: `NEYNAR_API_KEY`,
`NEYNAR_WALLET_ID`, `FC_TEST_FID` / `FC_TEST_SIGNER_UUID` (the throwaway account, fid 3348985, `@layers-test-852c`)
and `FC_TEST_CUSTODY_PRIVATE_KEY`.

1. **[SECRET] Move the custody private key out of `.env.local`.** The app refuses every Farcaster write while that key
   is in its environment (a key that can transfer the account has no business next to the code that posts). The app
   never needs it. These commands move the line without printing it:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.layers" | Out-Null
   Copy-Item .env.local "$HOME\.layers\env.local.backup"
   $lines = Get-Content .env.local
   $lines | Where-Object { $_ -match '^FC_TEST_CUSTODY_PRIVATE_KEY=' } | Add-Content "$HOME\.layers\fc-test-custody.env"
   [System.IO.File]::WriteAllLines((Resolve-Path .env.local), [string[]]($lines | Where-Object { $_ -notmatch '^FC_TEST_CUSTODY_PRIVATE_KEY=' }))
   Remove-Variable lines
   ```

   (`WriteAllLines` writes without a byte-order mark, which the env parsers need.)

2. **Start the validator** in its own terminal:

   ```powershell
   $env:ZK_DEV_HOOKS = "true"; $env:LAYERS_REQUIRE_SIG = "true"
   npm run seed:validator        # does nothing if the database is already seeded
   npm run validator:supervised
   ```

3. **Build, then start the app with writes armed**, in a second terminal. The two extra flags live only in this
   terminal, so closing it disarms everything:

   ```powershell
   npm run build
   $env:ZK_DEV_HOOKS = "true"; $env:LAYERS_REQUIRE_SIG = "true"
   $env:ENABLE_FC_WRITE = "true"          # real writes on
   $env:PERSONA_FID_LIVE_ONLY = "true"    # a new persona waits for a REAL account instead of getting a pretend one
   npm run start
   ```

   While this terminal is armed, **do not run any `npm run test:*` or sweep.** The suites post through the same write
   door, and with writes armed they would post for real.

4. **Check it is armed** (from a third terminal):

   ```powershell
   $api = "http://localhost:3001"
   Invoke-RestMethod "$api/api/fc/write" | Select-Object writeEnabled, throwawayConfigured
   ```

   Both must be `True`.

5. **[PUBLISHES] Your first real cast, as the throwaway account.** Switch the rig to the shared-account mode (every
   persona posts through the one throwaway, and this client shows which persona wrote it), then cast:

   ```powershell
   Invoke-RestMethod -Method Post "$api/api/fc/persona" -ContentType application/json -Body '{"action":"setNetworkMode","mode":"shared-fid"}'
   $r = Invoke-RestMethod -Method Post "$api/api/fc/write" -ContentType application/json -Body (@{ action = "cast"; text = "first light" } | ConvertTo-Json)
   $r | Format-List hash, mode, fid, personaId
   ```

   `mode` must say `live` and `fid` must be `3348985`. If `mode` says `fixture`, the write went to the rig's
   simulated network: the app was not started with `ENABLE_FC_WRITE=true`. Confirm on the network at
   <https://farcaster.xyz/layers-test-852c>.

6. **[PUBLISHES] As one of your personas, still through the shared account.** List who you can act as, then name one:

   ```powershell
   (Invoke-RestMethod "$api/api/personas/act-as-options").options | Format-Table id, handle, kind
   $r = Invoke-RestMethod -Method Post "$api/api/fc/write" -ContentType application/json -Body (@{ action = "cast"; text = "hello again"; personaId = "persona_viewer_main" } | ConvertTo-Json)
   ```

   On the network it is still `@layers-test-852c`; inside this client, a viewer you have granted sees your persona.

7. **Undo a cast** if you want to (deletes on Farcaster are a request that hubs honour, not an erasure):

   ```powershell
   Invoke-RestMethod -Method Post "$api/api/fc/write" -ContentType application/json -Body (@{ action = "delete"; hash = $r.hash } | ConvertTo-Json)
   ```

8. **Go back to one account per persona** (the default) before section (d):

   ```powershell
   Invoke-RestMethod -Method Post "$api/api/fc/persona" -ContentType application/json -Body '{"action":"setNetworkMode","mode":"per-persona-fid"}'
   ```

9. **Disarm:** close the app terminal. Start it again without `ENABLE_FC_WRITE` before you run any suite.

Personas with their own accounts on the laptop: follow section (d) against `http://localhost:3001`, with the app
also started with `$env:FID_ACQUIRE_ENABLED = "true"`, and skip everything about `APP_URL` and the passphrase.

**Pick one home for persona accounts.** A persona's Farcaster keys come off the root phrase of the device that made
the persona. The laptop's root lives in `.keystore/`; the owner service mints its own root on its own volume. An
account created from the laptop can only ever be driven from the laptop, and the same for the service. The clean
split: casts as the throwaway on the laptop now, persona accounts on the owner service (sections c to e).

---

## (c) THE OWNER SERVICE on Railway

> **Not the go-live path (2026-10-17).** This section is for the owner's private service, which is optional now. Going live for everyone is `notes/runbooks/GO-LIVE-TODAY.md`.

What you are building: a new Railway project, `layers-owner`, with two services.

- **owner-validator**: the rig's validator, from `railway/Dockerfile.owner-validator`, with its SQLite database on a
  volume. It gets **no public domain**; it is reachable only from the owner app over Railway's private network. It
  refuses to boot if it can see a public domain or TCP proxy attached to it, or if you have not declared
  `LAYERS_PRIVATE_NETWORK_ONLY=true`. It checks at every boot; a domain added while it is running is not seen until
  its next deploy, so the rule is simply: never add one.
- **owner-app**: the rig's Next server, from `railway/Dockerfile.owner-app`, with your root seed on a volume
  (`/data/keystore`, the hosted twin of `.keystore/`). Every page and API route answers only to you: without the
  session cookie a page sends you to `/owner-login` and an API call gets a 401. It refuses to boot without an owner
  passphrase of 16+ characters, and refuses a validator address that looks public. The gate covers every path except
  the build's own `/_next/static/` files and `/_next/image`. An earlier version let `/favicon.ico/…` paths slip past
  it; that is fixed, and the page layout and `/device` now check your session themselves too (SECURITY-POSTURE.md §18).

Railway's per-service config files (`railway.toml`) cannot be adopted by services created today (the feature is
deprecated and "new services cannot opt into Config as Code", per [Railway's docs](https://docs.railway.com/config-as-code)),
so each service is pointed at its image with the `RAILWAY_DOCKERFILE_PATH` variable, and the rest is variables and
a volume.

**Never share the passphrase.** Whoever has it can post as every one of your personas and read out your 24 words.
It also opens the rig's developer controls (`/api/dev`, the Developer pane): only you can reach them, and
`resetSeed` there wipes the seeded world's state (your live account records and live spend survive a reset,
D-FID-5-RESET-KEEPS-MONEY, but do not press it casually).

**Reading logs after a deploy.** Plain `railway logs` shows the most recent SUCCESSFUL deployment, so right after a
redeploy (still building, or crashed on a refused boot) it shows the OLD container. Every check below that follows a
deploy uses `--latest --lines 100`, which reads the newest deployment even if it failed or is still starting. Repeat
it until the line you are waiting for appears, or a `REFUSING TO START` line tells you why not.

1. **[SECRET] Make the passphrase.** 32 random bytes, written straight to a file. Also save it in your password
   manager, because you will paste it into the login page.

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\.layers" | Out-Null
   $bytes = New-Object byte[] 32
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   [Convert]::ToBase64String($bytes) | Set-Content -NoNewline -Encoding ascii "$HOME\.layers\owner-secret"
   Remove-Variable bytes
   ```

2. **Create the project.** Run the session preamble first (`git status --short` prints nothing): `railway up`
   uploads the working directory exactly as it is. `railway init` links this folder to the new project, replacing the
   link to `layers-preview`, and the project's ID is saved for the teardown in section (g). The service names are
   different on purpose (`owner-app` / `owner-validator` against `app` / `validator`), so a command aimed at the
   wrong project fails instead of touching the other one.

   ```powershell
   railway whoami
   railway init --name layers-owner --json
   $proj = railway status --json | ConvertFrom-Json
   $proj.name                          # must say layers-owner — check railway status before every block below
   $proj.id | Set-Content -NoNewline -Encoding ascii "$HOME\.layers\owner-project-id"
   ```

   **From here on, this folder is linked to `layers-owner`.** Any command meant for the public preview must carry
   `--project <railway-project-id> --environment production --service app` (section i does), or you
   re-link first with `railway link --project <railway-project-id> --environment production --service app`.
   A future public deploy is `railway up --project <railway-project-id> --environment production --service app --ci`,
   never a bare `railway up`.

3. **The validator.** No `railway domain` for this service, ever. `railway volume` takes its `--service` BEFORE the
   word `add`, and only as a service ID, which `railway add --json` prints:

   ```powershell
   $v = railway add --service owner-validator --json | ConvertFrom-Json
   $v.id                               # a UUID; if empty, run `railway volume add --mount-path /data --json` instead (add links the new service)
   railway volume --service $v.id add --mount-path /data --json
   railway variable set --service owner-validator --skip-deploys RAILWAY_DOCKERFILE_PATH=railway/Dockerfile.owner-validator LAYERS_PRIVATE_NETWORK_ONLY=true VALIDATOR_POLLER=off "LAYERS_COMMIT=$(git rev-parse --short HEAD)"
   railway up --service owner-validator --ci
   railway logs --service owner-validator --latest --lines 100
   ```

   In the logs, expect `OWNER SERVICE: hosted dev-hooks validator, private network only`, then on the first boot
   `[seed] device roster written: /data/fixture-roster.json`, then `listening on :4001`. A line starting
   `REFUSING TO START` names what is wrong, and the container exits with code 78. The validator supervisor passes
   that refusal through instead of restarting the validator inside a process that looks alive, so a bad setting
   shows up as a crashed deploy in the dashboard, not only as a line in the log. (`VALIDATOR_POLLER=off` is set now
   and stays set: it costs nothing while the validator holds no key, and it is what keeps the poller off the day it
   does, section f.)

4. **The app.** Its public domain is the only public address in the project. The domain command prints the full
   `https://…` address as JSON; it is captured, printed, and saved for every later sitting:

   ```powershell
   $a = railway add --service owner-app --json | ConvertFrom-Json
   $a.id                               # a UUID; if empty, run `railway volume add --mount-path /data --json` instead
   railway volume --service $a.id add --mount-path /data --json
   $ownerApp = (railway domain --service owner-app --port 3001 --json | ConvertFrom-Json).domain
   $ownerApp                           # must start with https:// and end without a slash
   $ownerApp | Set-Content -NoNewline -Encoding ascii "$HOME\.layers\owner-app-url"
   railway variable set --service owner-app --skip-deploys RAILWAY_DOCKERFILE_PATH=railway/Dockerfile.owner-app "APP_URL=$ownerApp" VALIDATOR_URL=http://owner-validator.railway.internal:4001 TRUST_PROXY=true PERSONA_FID_LIVE_ONLY=true "LAYERS_COMMIT=$(git rev-parse --short HEAD)"
   Get-Content "$HOME\.layers\owner-secret" | railway variable set --service owner-app --skip-deploys --stdin OWNER_ACCESS_SECRET
   railway up --service owner-app --ci
   railway logs --service owner-app --latest --lines 100
   ```

   Expect `[boot] OWNER SERVICE: hosted rig, owner access gate armed, validator on the private network`. The image
   already carries `ZK_DEV_HOOKS=true`, `LAYERS_REQUIRE_SIG=true` and `KEYSTORE_DIR=/data/keystore`; do not set
   `NEXT_PUBLIC_VALIDATOR_URL` (the boot refuses it: the browser is never told where this validator is). If the
   domain command prints `{"domains":[...]}` instead, the service already had a domain (a re-run): read the address
   from `$HOME\.layers\owner-app-url` rather than retyping it; a copy from the browser with a trailing slash turns
   `$ownerApp/api/health` into `//api/health`, which the gate does not exempt.

5. **Check the gate from outside:**

   ```powershell
   Invoke-RestMethod "$ownerApp/api/health" | Select-Object app, commit, peer    # peer must say private
   curl.exe -s -o NUL -w "%{http_code}`n" "$ownerApp/api/fc/write"     # must print 401
   curl.exe -s -o NUL -w "%{http_code}`n" "$ownerApp/favicon.ico/status/0x0"     # must print 303 (sent to sign-in)
   ```

6. **One-time, before you sign in: hand the seeded roster to the app.** The validator's first boot seeded the
   rig's fixture world and wrote the roster that pairs with it onto ITS volume; the app keeps that roster beside
   its keystore, on ITS volume. The roster is fixture bookkeeping (ids, not keys).

   ```powershell
   railway.cmd ssh --service owner-validator -- cat /data/fixture-roster.json | Set-Content -Encoding ascii "$HOME\.layers\fixture-roster.json"
   railway.cmd ssh --service owner-app -- mkdir -p /data/keystore
   Get-Content "$HOME\.layers\fixture-roster.json" | railway.cmd ssh --service owner-app -- tee /data/keystore/fixture-roster.json | Out-Null
   railway.cmd ssh --service owner-app -- ls /data/keystore
   railway redeploy --service owner-app --yes
   railway logs --service owner-app --latest --lines 100     # repeat until the new deployment prints [boot] OWNER SERVICE
   ```

   These lines say `railway.cmd`, not `railway`, on purpose: in PowerShell, `railway` runs npm's `railway.ps1` shim,
   and PowerShell drops a bare `--` on its way into a script. The `.cmd` shim passes `--` through untouched. (An SSH
   key is already registered with Railway on this machine, so `ssh` will not stop to ask for one; if it ever does, that
   prompt prints to standard output and would land in `fixture-roster.json`: check the file holds JSON.)

   `ls` should show `fixture-roster.json`. The app reads the roster once per process, hence the redeploy (it
   restarts the same image; nothing is rebuilt).

   With `LAYERS_WORLD=empty` on owner-app this step is not needed: under the flag the app never treats a fixture
   root as yours (your personas get no seeded reputation, and none is recorded under the seeded self's root), and a
   validator that boots with the flag on an EMPTY volume writes no roster at all. `arm-owner-service.ps1` records the
   step as not needed when the download finds no roster and owner-app carries `LAYERS_WORLD=empty`.

7. **Sign in** in your browser, at the timeline rather than the bare address (the bare address is the landing page):

   ```powershell
   Start-Process "$ownerApp/home"
   ```

   You land on `/owner-login`, paste the passphrase, and arrive on `/home`. A browser sign-in lasts 30 days per
   device (`OWNER_SESSION_DAYS`, capped at 90). Once the owner passkey build is deployed here, the app then offers
   **Add Face ID / fingerprint for this device** (Windows Hello on a PC): take it, and that device signs in with one
   tap from then on; the 24 words are never needed to sign in. Do the same once on your phone. On a computer that is
   not yours, tap **This isn't my device** instead (it is signed out within 2 hours). Lost a device: Settings › Security ›
   **Lost this device?** removes its sign-in and signs out every device; **Sign out everywhere** for a device that never
   added one; a new passphrase (section g, lock-out) does both. Details: SECURITY-POSTURE.md §18. Then sign the
   PowerShell window in too (this session, `$s`, is a script's: it lasts a day, and the preamble does the same in a new
   window):

   ```powershell
   $pw = (Get-Content "$HOME\.layers\owner-secret" -Raw).Trim()
   Invoke-RestMethod -Method Post "$ownerApp/api/owner-login" -ContentType application/json -Body (@{ passphrase = $pw } | ConvertTo-Json) -SessionVariable s | Out-Null
   Remove-Variable pw
   ```

8. **[SECRET] Write down the service's 24 words.** The volume holds the only copy of this root. The persona accounts
   you create next are owned by keys that come off it; if the volume is lost without these words, those accounts
   are lost with it. Revealing the words is also what mints the root, if no page has yet:

   ```powershell
   (Invoke-RestMethod -Method Post "$ownerApp/api/recovery" -ContentType application/json -Body '{"action":"revealPhrase","acknowledged":true}' -WebSession $s).phrase
   ```

   Write them on paper, then `Clear-Host`. Do not paste them into a file or a chat.

9. **[SECRET] Arm live Farcaster on the app.** The Neynar key and the throwaway's signer come from your `.env.local`
   and are piped in, never shown (`Get-EnvLocal` is defined by the session preamble). Use the **same** Neynar key as
   the laptop: a signer only works with the key it was made under, and the persona signers in section (d) are made
   from the laptop.

   ```powershell
   Get-EnvLocal NEYNAR_API_KEY | railway variable set --service owner-app --skip-deploys --stdin NEYNAR_API_KEY
   Get-EnvLocal FC_TEST_SIGNER_UUID | railway variable set --service owner-app --skip-deploys --stdin FC_TEST_SIGNER_UUID
   railway variable set --service owner-app --skip-deploys "FC_TEST_FID=$(Get-EnvLocal FC_TEST_FID)" ENABLE_FC_WRITE=true
   railway variable set --service owner-app --skip-deploys DATA_SOURCE=neynar     # optional: live Farcaster content in the feeds
   railway redeploy --service owner-app --yes
   railway logs --service owner-app --latest --lines 100     # repeat until the new deployment prints [boot] OWNER SERVICE
   Invoke-RestMethod "$ownerApp/api/fc/write" -WebSession $s | Select-Object writeEnabled, throwawayConfigured
   ```

   **Both must be `True`** before any cast in section (e). If either is `False`, the redeploy is not live yet (read
   the `--latest` logs again) or a variable did not land.

   **Whose feed you see with `DATA_SOURCE=neynar`.** With `NEYNAR_VIEWER_FID` unset, the owner service's live home
   feed and notifications are those of fid 3 (dwr), not yours. For You, Following, Explore and the history shelf all
   read that one following feed: Neynar removed its trending feed in August, so there is no network-wide ranking to
   show. Channel tabs read that channel's feed. To see your own, set your real fid on the owner app
   only: `railway variable set --service owner-app NEYNAR_VIEWER_FID=<your real fid>` (it redeploys by itself; wait for
   the boot line). That is fine behind the owner gate. **Never 9152** (that is @warpcast, which the seed borrowed), and
   **never on the public app**, whose boot contract refuses the name whatever its value: on a process strangers can
   reach it would hand them that account's following feed, mutes and notifications.

   **It is now a privacy setting too, not only a feed preference** (the connect-main build, 2026-10-08; not yet on the
   deployed service). Until your main account is connected, `NEYNAR_VIEWER_FID` is how the app knows which Farcaster
   account is YOURS, so that a persona never replies to, likes, recasts, follows or @mentions it from a button. With it
   unset and no main connected, every such action by a persona on the real network is refused (`FC_MAIN_UNKNOWN`: the
   app says so and nothing is sent); plain posts still go out. Set to the wrong fid, it refuses interacting with that
   account instead (safe direction). `arm-owner-service.ps1 -ViewerFid <your main account's fid>` sets it
   (SECURITY-POSTURE.md §14, A-FID-MAIN-SEPARATION-BY-VIEWER-FID).

   **Never** set these on either owner service: `FC_TEST_CUSTODY_PRIVATE_KEY` (writes refuse while it is present),
   `NEYNAR_SIGNER_UUID` (writes refuse while an unknown signer is present), `NEXT_PUBLIC_VALIDATOR_URL` (boot
   refuses), `NEYNAR_READ_API_KEY` (the public relay's key: the relay is dormant on a rig-shaped service, so it would
   do nothing here except sit next to your write key). `NEYNAR_WALLET_ID` stays on your laptop: the app never reads
   it, because the billable account calls in section (d) run from your laptop.

Optional: in the Railway dashboard, set owner-app's healthcheck path to `/api/health` (liveness is the one path the
gate lets through).

---

## (d) FULL FID PERSONAS — one real account per persona

> **Not the go-live path (2026-10-17).** This section is for the owner's private service, which is optional now. Going live for everyone is `notes/runbooks/GO-LIVE-TODAY.md`.

The acquisition command is `scripts/fid-acquire.mjs`. It runs on your laptop, makes the Neynar calls with your
laptop's key and wallet, and asks the app to sign with the persona's custody key (the key never leaves the app) and
to seal the receipt. It always prints a cost sheet first, does nothing billable without `FID_ACQUIRE_CONFIRM=yes`,
handles one persona per run, and records an account that already exists instead of making a second one. Start each
sitting with the session preamble; `railway status` must say `layers-owner`.

1. **[SPENDS MONEY] Check the app wallet has funds.** dev.neynar.com, your app, the App Wallet tab. You need about
   $0.90 per account you will create, plus a margin. Top it up with ETH **on Optimism** only if it is short. The
   portal's "Protocol: Ethereum" column names the asset, not the chain; ETH sent on Ethereum mainnet does not arrive
   (the Farcaster pass learned this the hard way). Funds cannot be withdrawn.

2. **Create the persona.** With `LAYERS_WORLD=empty` and no persona yet, the fork page has nothing to fork FROM:
   first create one in Settings, Account & Personas (`/settings/account`, "Create your first persona"); that page then
   links to the fork page. In the owner app, Settings, Identity, Fork (`/settings/identity/fork`), fork your main
   persona into a new PUBLIC persona and give it a name and a handle. The handle becomes the Farcaster username:
   lowercase letters, digits and hyphens, 16 characters at most. **Neither the handle, the display name nor the bio may
   contain "layers"** (the command refuses any profile value that names this client). **Leave compartment mode off**
   (it is off by default): in compartment mode the app shows only the active persona and refuses the command's key
   probe, which the command reports, misleadingly, as "the app has no keys". Because the service runs with
   `PERSONA_FID_LIVE_ONLY=true`, the new persona is left "pending" rather than given a pretend account. Only a persona
   made this way (from your root phrase) can own a real account; the seeded personas' keys are public by construction
   and are refused.

3. **Find its id:**

   ```powershell
   (Invoke-RestMethod "$ownerApp/api/personas/act-as-options" -WebSession $s).options | Format-Table id, handle, kind
   ```

   Yours is the `p_...` row with the handle you chose.

4. **Arm acquisition on the app,** then **wait** for the redeploy it starts by itself. A run that lands before the new
   container is up stops at "app not answering" or at the ledger step (nothing billable is lost, but it is confusing):

   ```powershell
   railway variable set --service owner-app FID_ACQUIRE_ENABLED=true
   railway logs --service owner-app --latest --lines 100     # repeat until the NEW deployment prints [boot] OWNER SERVICE
   ```

5. **[SECRET] Dry run from the laptop.** The target comes from this shell only, never from `.env.local`, and the
   passphrase is read from its file:

   ```powershell
   $env:APP_URL = $ownerApp
   $env:OWNER_ACCESS_SECRET = (Get-Content "$HOME\.layers\owner-secret" -Raw).Trim()
   node scripts/fid-acquire.mjs p_PASTE_THE_ID
   ```

   The first line must say `target app: https://…railway.app`. If it says `http://localhost:3001`, `$ownerApp` was
   empty (a new window without the preamble): run the preamble and start this step again. Read the cost sheet: the
   registration estimate ($0.90, the top of the measured range), what the ledger already holds, and the cap. It ends
   with `DRY RUN — nothing billable was called.`

   **The registrant, stated first.** Before the cost sheet the command names who registers the account onchain: the
   App Wallet behind `NEYNAR_WALLET_ID`, your own wallet, not Neynar. That wallet registered the Totem-named test
   account and the fids beside it (3348983 to 3348991) in one burst on 2026-08-29, so a persona made through it sits
   next to the test account onchain for good (same sender, minutes apart, a next-door fid; `notes/runbooks/GO-LIVE-MORNING.md` step
   0 (a); SECURITY-POSTURE.md §14, A-FID-REGISTRANT-BY-FIAT). The confirmed run in step 6 refuses unless THIS shell
   carries `FID_REGISTRANT_ACK`: `SIBLINGS` to go ahead with that wallet knowingly, or `FRESH` with a different
   `NEYNAR_WALLET_ID` set in this shell (a fresh Neynar app's own App Wallet that never registered or funded the test
   account or a persona: your word, which nothing here can check; the personas made through it still share it with
   each other). Both are read before `.env.local` is loaded, so a line in that file is inert and refused, like
   `FID_ACQUIRE_CONFIRM`. The one-command script `scripts\owner\acquire-fid.ps1` asks for the same word at a prompt
   and shows a wallet id by its last 4 characters only.

6. **[SPENDS MONEY] [PUBLISHES] Create the account.** This creates a public Farcaster account for the persona:

   ```powershell
   $env:FID_ACQUIRE_CONFIRM = "yes"
   $env:FID_REGISTRANT_ACK = "SIBLINGS"     # or "FRESH", with $env:NEYNAR_WALLET_ID = "<the fresh wallet id>" set in this shell
   node scripts/fid-acquire.mjs p_PASTE_THE_ID
   Remove-Item Env:FID_ACQUIRE_CONFIRM
   Remove-Item Env:FID_REGISTRANT_ACK
   ```

   It ends with `recorded: p_... → fid NNN (@handle)`. If it stops part-way, just run it again: it checks the
   network first and records an account that exists rather than paying for a second one.

7. **Verify it on the network:** open `https://farcaster.xyz/<the handle>`. And in the app:

   ```powershell
   (Invoke-RestMethod "$ownerApp/api/fc/persona" -WebSession $s).map
   ```

8. **The next persona: hours later, not minutes.** Two accounts registered minutes apart from one wallet are an easy
   public pair. Repeat steps 2 to 7 (and 4, if you disarmed in between).

9. **More than two accounts.** Raise both caps, in **both** places: on the app, and in the laptop shell that runs
   the command (the command refuses when the app allows more than it does). Hard bounds are 20 accounts and $25. The
   dollar cap is cumulative, and the ledger books every account at $0.90, so 10 accounts need at least $9. The set
   redeploys the app by itself; wait for the boot line before the next run:

   ```powershell
   railway variable set --service owner-app LAYERS_MAX_LIVE_PERSONA_FIDS=5 LAYERS_FID_SPEND_CAP_USD=10
   $env:LAYERS_MAX_LIVE_PERSONA_FIDS = "5"; $env:LAYERS_FID_SPEND_CAP_USD = "10"
   railway logs --service owner-app --latest --lines 100
   ```

10. **Disarm acquisition** when you are done:

    ```powershell
    railway variable delete --service owner-app FID_ACQUIRE_ENABLED
    railway redeploy --service owner-app --yes     # if it answers "cannot be redeployed … building", the delete already started one
    railway logs --service owner-app --latest --lines 100     # repeat until the new deployment prints [boot] OWNER SERVICE
    Remove-Item Env:OWNER_ACCESS_SECRET, Env:APP_URL
    ```

---

## (e) The first real cast from each persona

> **Not the go-live path (2026-10-17).** This section is for the owner's private service, which is optional now. Going live for everyone is `notes/runbooks/GO-LIVE-TODAY.md`.

With writes armed (section c, step 9) and the persona owning an account (section d). Start with the preamble, then
confirm the running container is armed, every time before you cast:

```powershell
railway logs --service owner-app --latest --lines 50     # the newest deployment has printed [boot] OWNER SERVICE
Invoke-RestMethod "$ownerApp/api/fc/write" -WebSession $s | Select-Object writeEnabled, throwawayConfigured     # both True
```

**From the app itself** (the buttons build of 2026-10-08: built and unit-tested on test data, NOT yet run on the
deployed service). Once that build is deployed here, the app's own Post box, likes, recasts and follows post AS the
persona directly, through the same door as the bodies below. Switch to the persona and click into the Post box: the
line under it must read `Posts to Farcaster as @<its fname> — public` (if it reads `Saved in Totem only — … has no
Farcaster account yet`, section (d) did not finish for that persona). Post: the toast says `Posted to Farcaster as
@<fname>` with a link to the cast, and the line under the box gains "view it on Farcaster". The line is the contract:
a post is refused, with nothing sent, when what it said changed between the look and the click (another tab switched
persona, or an account was created meanwhile). Farcaster takes 320 bytes per post; the box counts. A persona's replies,
likes, recasts, follows and @mentions need `NEYNAR_VIEWER_FID` set (section c step 9); one aimed at your main account,
at another of your personas from a one-tap button, at the shared test account or at the anon account is refused
(`FC_SELF_LINK`). Undo (un-like, un-recast, un-follow) is not wired: the app says so and changes nothing on Farcaster;
use a Farcaster app. Daily caps, shared by every account: 10 casts, 10 follows (`FC_FOLLOWS_PER_DAY`), 30 actions
(`FC_CASTS_PER_DAY`, `FC_ACTIONS_PER_DAY` raise them; each set redeploys the app). With `DATA_SOURCE=neynar` the
persona's new post does not show in the home feed, which is `NEYNAR_VIEWER_FID`'s: find it on the persona's profile or
through the link. The PowerShell bodies below remain the fallback, and the first real post from the app on the
deployed service is what moves its status from "built, test data only" to live: tell Claude when you have seen it on
farcaster.xyz.

1. **[PUBLISHES] Cast as the persona:**

   ```powershell
   $r = Invoke-RestMethod -Method Post "$ownerApp/api/fc/write" -ContentType application/json -WebSession $s -Body (@{ action = "cast"; text = "hello, farcaster"; personaId = "p_PASTE_THE_ID" } | ConvertTo-Json)
   $r | Format-List hash, mode, fid, personaId
   ```

   `mode` must be `live` and `fid` must be the persona's own fid from section (d) step 7. If `mode` comes back
   `fixture`, the write went to the rig's simulated network. The likely causes, in order: writes are not armed on the
   running container (the check above said `False`, or the redeploy was not live yet); or the persona's account has
   no usable signer (the registration reported none). With `DATA_SOURCE=neynar` set, the second case refuses
   outright with a 403 `FC_IDENTITY` instead. A 401 `owner_login_required` means the PowerShell session expired (they
   last a day): run the preamble again.

   **Text that is not plain ASCII** (emoji, curly quotes, dashes, accents): Windows PowerShell 5.1 may send a string
   body as ISO-8859-1, which would reach a PUBLIC cast mangled (untested, so treat it as likely). Send the bytes as
   UTF-8 instead:

   ```powershell
   $b = [Text.Encoding]::UTF8.GetBytes((@{ action = "cast"; text = "PASTE THE TEXT"; personaId = "p_PASTE_THE_ID" } | ConvertTo-Json))
   $r = Invoke-RestMethod -Method Post "$ownerApp/api/fc/write" -ContentType "application/json; charset=utf-8" -WebSession $s -Body $b
   ```

2. **Confirm it on the network:** `https://farcaster.xyz/<the handle>` shows the cast under the persona's own account,
   with nothing in its profile that points at you or at this client. Inside the owner app, the cast carries your
   persona. The app's own record of every write is here:

   ```powershell
   (Invoke-RestMethod "$ownerApp/api/fc/write" -WebSession $s).entries | Select-Object -First 5 | Format-Table kind, castHash, fid, at
   ```

3. **[PUBLISHES] Replies, likes, recasts and follows** go through the same door, each as the persona you name. Each
   needs its target; these are the exact bodies (a like or recast without `targetHash` is refused with a 400):

   ```powershell
   $w = { param($body) Invoke-RestMethod -Method Post "$ownerApp/api/fc/write" -ContentType application/json -WebSession $s -Body ($body | ConvertTo-Json) }
   & $w @{ action = "like";   targetHash = "0xPASTE_THE_CAST_HASH"; personaId = "p_PASTE_THE_ID" }
   & $w @{ action = "recast"; targetHash = "0xPASTE_THE_CAST_HASH"; personaId = "p_PASTE_THE_ID" }
   & $w @{ action = "reply";  text = "PASTE THE TEXT"; parentHash = "0xPASTE_THE_CAST_HASH"; personaId = "p_PASTE_THE_ID" }
   & $w @{ action = "follow"; targetFid = 123; personaId = "p_PASTE_THE_ID" }
   ```

   Replying from a cast in the timeline with "act as" does the same thing from the page.

---

## (f) The anon account (optional)

> **Not the go-live path (2026-10-17).** This is the anon account of the owner's private service. The public @anon, the one everyone's persona posts go through, is `notes/runbooks/GO-LIVE-TODAY.md` step 3 (`arm-public-anon.ps1`), with a Neynar app of its own.

**Use the script: `scripts\owner\arm-anon.ps1`** (`notes/runbooks/GO-LIVE-MORNING.md` step 6). It does everything in this section in
order, asks you to type `ANON` once before it changes anything and once more before the first real cast, refuses the
wrong key or the wrong account before any variable is set, and is its own kill switch (`-Disarm`). `-WhatIf` prints
every command without running any. This section is what it does and why, and the by-hand lines for each step.

**What this is on your service, honestly.** An anonymous post in Totem is relayed by the **validator's own** Farcaster
account after a membership proof, never by a persona's account and never by the app's. Where many people share one
validator, that proof hides the author in a crowd. On your private service there is exactly one person: the proof
proves membership in a set of one, and the privacy label above the composer keeps saying `DEMO` and lists why. So
here the anon account is **an extra account with no name on it**, not a voice in a crowd. What keeps it apart from
you and your personas is not the proof but four plain facts, each of which the script checks or you control: it is
created under a credential of its own (a THIRD Neynar app, step 1); its profile names nothing; the network time of
each cast is the validator's relay slot, not the moment you wrote it; and what you write in it. A real crowd needs
the multi-tenant validator, which this is not. The decision, and what it does not cover, is
`SECURITY-POSTURE.md` §20 (D-ANON-OWNER-SERVICE-UNNAMED-ACCOUNT).

**What switching it on changes elsewhere, and what it costs.** Two of the variables are not local to anon.
`ADAPTER_REP=zk` makes the For You tier gate read PROVEN tiers: a persona that has not proved a tier is tier 0 for
discovery until it does. `ZK_MODE=live` moves every ZK surface (registration, tiers, attestations, the anon queue)
from the fixture universe to the live one, and the live prover downloads its artifacts once onto the app's volume
(`/data/zk-artifacts`, hash-checked against pins). Persona creation, account acquisition and the other arm scripts are
untouched. Credits: 150 a cast, plus about 20,000 a month while the agent's signer counts as active, from the same
pool as everything else; `VALIDATOR_POLLER=off` must stay set, or the poller adds up to ~4.4M a month (section a). The
first live post is a gate-level event: this path is built and fixture-verified **but has never run live** (there is no
`live-fid4.json` in `research/`), the cap is one post, and raising it is a deliberate step after the first cast is
seen on the network (step 7).

**The reveal stays off here.** Inside the owner app a relayed anon cast carries a "Prove this is yours" control. It
needs a persona that owns a live Farcaster account to attribute to, so until section (d) has run it only says "no
persona of yours has its own account yet". Leave it alone even then: the reveal addition is below the bar everything
else met (`SECURITY-POSTURE.md` §14.1), and a reveal is permanent and visible to every reader of this server (here,
you): it ties that cast to that persona inside Totem and cannot be undone, while nothing changes on Farcaster, where
the cast stays the agent's (§14.2: the claim is checkable inside Totem only until the persona's own key is
registered on its account).

1. **The account: a THIRD Neynar app, and "Create Agent" in it.** On dev.neynar.com create a new app, named so you
   will recognise it (e.g. `anon-relay`): **no wallet, no webhooks, no other signers.** In that app use "Create Agent":
   Neynar registers a fresh Farcaster account at its own expense (it limits how many per developer, per
   [Neynar's guide](https://docs.neynar.com/docs/create-farcaster-bot-ui)) and gives you an fid and a signer uuid,
   paired with THAT app's key. Give the agent a username, display name and bio that say nothing about Totem, you or
   your personas (the script refuses a profile that contains "layers"; the rest is your judgement). Copy the app's API
   key into your password manager as the ANON key, and keep the signer uuid in your password manager too: the script
   asks for both at hidden prompts (nothing secret on disk). The by-hand block in step 3 is the only place a file is
   used.

   Why a third app: the app's privacy check (condition 10, `lib/zk/privacy.ts`) fails whenever the validator relays
   with THIS app's Neynar key or through the throwaway, because one credential would then create, sign for and write
   as every persona and the anon account too. The script refuses the first app's key (`NEYNAR_API_KEY` in `.env.local`),
   the read app's key, the throwaway (`FC_TEST_FID`), fid 9152 and every persona's fid, all compared in memory. What a
   third app does NOT change: it is under the same Neynar developer account, so Neynar can still join it to your other
   apps (A-FID-NEYNAR-SEES-ALL); and which fid Neynar wrote as `requestFid` into the agent's onchain key is unread
   (`research/VERIFY-YOURSELF.md` F22): if the agent and your personas share one, they are linked on chain whatever
   the proof says.

2. **Before it runs: writes already armed, poller off, nothing foreign on the validator.** The script requires writes
   armed on owner-app (section c step 9: `GET /api/fc/write` says `writeEnabled: True`); on live, the app refuses an
   anon post unless `ENABLE_FC_WRITE=true` is set there too, because a relay is a real write. It refuses to go on if
   owner-validator carries `NEYNAR_SIGNER_UUID`, `NEYNAR_READ_API_KEY` or any `FC_TEST_*` name (a signer credential
   that is not the anon account's, present in the validator's environment, refuses every relay by design). From the
   laptop, with the ANON key, it checks that `GET /v2/farcaster/signer` reports the uuid `approved` for exactly your
   fid and that the profile does not name Totem, BEFORE any variable is set.

3. **[SECRET] Arm, with the one command:**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-anon.ps1 -AnonFid PASTE_THE_FID
   ```

   Paste the signer uuid, then the ANON key, at the hidden prompts (or add `-KeyFromClipboard` for the key; afterwards
   press Win+V and choose Clear all). It asks you to type `THIRD` (the key is the third app's), prints the two side
   effects above and asks you to type `ANON`. Then, in this order, all with `--skip-deploys`
   until the end: on **owner-validator**, `VALIDATOR_POLLER=off` first, then `NEYNAR_API_KEY` (the ANON key) and
   `FC_ANON_SIGNER_UUID` on stdin, each read back and compared in memory, then `FC_ANON_FID`, `ENABLE_FC_WRITE=true`,
   `ZK_ANON_POST_LIVE_CAP=1` and `ZK_ANON_POST_TREE=valid`; on **owner-app**, `ZK_MODE=live`, `ADAPTER_REP=zk`,
   `ZK_ANON_FLOOR=1` and `ZK_ANON_POST_TREE=valid`. Why each one is there:

   | variable | service | why |
   |---|---|---|
   | `VALIDATOR_POLLER=off` | validator | set BEFORE the key, so the validator never boots holding a key with the poller on (section c step 3 set it already; it is set again on purpose) |
   | `NEYNAR_API_KEY` | validator | the ANON key: the relay posts with it. Never the app's key (condition 10), never the read key |
   | `FC_ANON_SIGNER_UUID`, `FC_ANON_FID` | validator | the agent's signer and fid; the validator checks the signer is `approved` for exactly this fid before every relay (cached 10 minutes) |
   | `ENABLE_FC_WRITE=true` | validator | arms the relay like every other real write; without it every anon submission is refused |
   | `ZK_ANON_POST_LIVE_CAP=1` | validator | at most one live anon post until you raise it (step 7) |
   | `ZK_ANON_POST_TREE=valid` | both, identical | the tree an anon post proves membership in. The default is `tier-2`, and a root with no reputation sits in tier 1, so the default refuses you forever; `valid` is every active registration. Each side enforces its own copy, so the two must match |
   | `ZK_MODE=live` | app | the live universe; in the fixture universe the "proof" is a tag under a public key and nothing reaches the network |
   | `ADAPTER_REP=zk` | app | the app refuses anon posting unless reputation is proof-mediated (fail closed, `lib/zk/gate.ts`); the default is `mock` |
   | `ZK_ANON_FLOOR=1` | app | the client's anonymity floor, 50 by default: your live universe has one root, so 50 refuses forever. 1 is the honest number for one owner (seeding decoys would only be cosmetic: their secrets are public) |

   Then it redeploys owner-validator and reads the `--latest` logs until they show
   `[poller] VALIDATOR_POLLER=off - rep accrual poller disabled` and `listening on :4001`. **If `[poller] polling
   Neynar every 60s` appears instead, it deletes `NEYNAR_API_KEY` from the validator, redeploys it and stops.** Then it
   redeploys owner-app and waits for `[boot] OWNER SERVICE`. Finally it signs in and reads `GET /api/anon`: `mode`
   must be `live`, `config.liveRelay` and `config.armed` `True`, `config.fid` your fid, `config.tree` `valid`, and
   privacy condition 10 (`anon-relay`) `ok`. Anything else stops with the reason, and nothing more is changed.

   By hand, if you ever need to (the ANON key and the signer uuid in one-line files first, written from the clipboard
   with `(Get-Clipboard -Raw).Trim() | Set-Content -NoNewline -Encoding ascii "$HOME\.layers\anon-key"` and the same
   for `anon-signer`; delete both files at the end):

   ```powershell
   railway variable set --service owner-validator --skip-deploys VALIDATOR_POLLER=off
   Get-Content "$HOME\.layers\anon-key" | railway variable set --service owner-validator --skip-deploys --stdin NEYNAR_API_KEY
   Get-Content "$HOME\.layers\anon-signer" | railway variable set --service owner-validator --skip-deploys --stdin FC_ANON_SIGNER_UUID
   railway variable set --service owner-validator --skip-deploys FC_ANON_FID=PASTE_THE_FID ENABLE_FC_WRITE=true ZK_ANON_POST_LIVE_CAP=1 ZK_ANON_POST_TREE=valid
   railway variable set --service owner-app --skip-deploys ZK_MODE=live ADAPTER_REP=zk ZK_ANON_FLOOR=1 ZK_ANON_POST_TREE=valid
   railway redeploy --service owner-validator --yes
   railway logs --service owner-validator --latest --lines 100     # the poller-off line, then listening on :4001; NOT "polling Neynar every 60s"
   railway redeploy --service owner-app --yes
   railway logs --service owner-app --latest --lines 100           # [boot] OWNER SERVICE
   Remove-Item "$HOME\.layers\anon-key", "$HOME\.layers\anon-signer"
   $a = Invoke-RestMethod "$ownerApp/api/anon" -WebSession $s
   $a.mode; $a.config | Format-List liveRelay, armed, fid, tree, pending
   $a.privacy.conditions | Where-Object { $_.id -eq 10 } | Format-List ok, detail
   ```

4. **Register the service's root in the live universe, then wait one epoch.** An anon post proves membership of a
   registered commitment, and the owner service has never registered one in the live universe. The script does it
   with the owner session (`POST /api/zk {"action":"register","mode":"live"}`; registration is account-level, so it
   must come from a session with no persona selected, which the script's and the preamble's `$s` are). `200` with
   `existing: True`, or `409` "this root already has an active registered commitment", both mean done. It prints
   `activeFromEpoch`: the registration takes effect at the NEXT epoch, and the validator's epoch is 6 hours
   (`ZK_EPOCH_MS`), so up to 6 hours of waiting, during which `-FirstCast` is refused. By hand:

   ```powershell
   $r = Invoke-RestMethod -Method Post "$ownerApp/api/zk" -ContentType application/json -WebSession $s -Body '{"action":"register","mode":"live"}'
   $r | Format-List ok, status, existing, epochRegistered, activeFromEpoch
   $z = (Invoke-RestMethod "$ownerApp/api/zk?mode=live" -WebSession $s).status
   $z.epoch; $z.registration | Format-List registered, activeFromEpoch, activeNow
   $z.trees | Where-Object { $_.tree -eq "valid" } | Format-List tree, epoch, size     # size 1 or more once active
   $z.artifactsCached                                                                   # wasm and zkey True once downloaded
   ```

   Optional, and only in the same arming, before the registration: `ZK_EPOCH_MS=3600000` on owner-validator (one hour,
   the shortest the app accepts, `ZK_EPOCH_MIN_MS`). Activation then takes at most an hour, and the anon window ("one
   anon post per window") becomes one hour instead of six. Set it with `--skip-deploys` before the redeploy in step 3.
   **Never lengthen it afterwards:** epochs are numbered from the clock, and a longer epoch renumbers them downward,
   which would push an active registration back into the future.

5. **[PUBLISHES] The first anon cast: `-FirstCast`.**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-anon.ps1 -FirstCast -CastText "what you want to say"
   ```

   **Persona launch P3:** `POST /api/anon` now posts AS a persona, and `-FirstCast` posts as the owner service's
   current session persona, so you need at least one persona that is not set to "Totem only" (Posts from @persona go,
   under the Post box). With none, the app answers `409` "No persona yet — create one in Settings › Account & Personas
   first." Which persona it was is kept only in the sealed reveal record; on the network the cast is @anon's. The
   lifetime cap stays 1 (it now defaults to 1 even if the variable is lost or blanked) and `-RaiseCap` is unchanged.

   (One mode per run: `-AnonFid` arms, `-FirstCast` posts; together they are refused.) It refuses until `GET /api/zk`
   says `registration.activeNow: True` and until the validator's anon tree equals the app's, then asks for `ANON`
   (the text is `-CastText`; without it, a dated line that names nothing). The post goes through the same door as the composer's "Post
   anonymously" switch (`POST /api/anon {text}`, answered `202 queued` with its `castHash`): nothing leaves at that
   moment. At the next prefetch tick (about every 10 minutes) the app proves the root's membership in `valid` under a
   message that binds the text; the queue sends the proof over the anonymous channel 30 seconds to 15 minutes later;
   the validator verifies it, stores the text as a PENDING row, and posts it at the top of the next hour plus up to
   10 minutes, in random order with any other pending row (D-FID-5-STORE-AND-FORWARD). So the cast appears on the
   network up to about 1 h 40 min after you type `ANON`, at a time that is the validator's and not yours. The script
   watches `GET /api/anon?castHash=` (`wanted`, then `queued`, then `sent` with outcome `accepted`), then the
   validator's pending count back to 0, then the agent's own casts on the public Farcaster API
   (`https://api.farcaster.xyz/v2/casts?fid=`), read without any key and matched by the post's text, for at least
   90 minutes, and prints the cast's network hash. Confirm at `https://farcaster.xyz/<the agent's username>`: the cast is there under the agent's
   name, with nothing that points at you.

   Or use the composer: in the owner app, tick "Post anonymously". The label above the box reads
   `DEMO — not yet private: ...` and lists the conditions that do not hold here; that is the honest state described
   above, not a fault. The toast "Queued anonymously" means the same `202`. Text is at most 320 characters.

6. **What the words mean while you wait, and what can stop it.** `wanted`: held by the app until the next tick.
   `queued`: proved, waiting out its random delay. `sent` / `accepted`: the validator has it as a pending row; from
   here only the validator's clock matters. `sent` / `replay`: the validator had already accepted this proof (safe).
   `refused`: the validator refused, and the script prints the app's attempt log with the stage and reason. The
   common refusals: `POST /api/anon` refuses with "anon posting needs the zk rep binding" (`ADAPTER_REP=zk` did not
   land on the app) or "anon posting on the live universe needs ENABLE_FC_WRITE=true" (writes are not armed on the
   app); `409` "You have used all 4 anonymous posts for this 6-hour window. They are shared across your personas." (Persona
   launch P3: 4 slots per person per window, `ZK_ANON_POST_SLOTS`, which must be equal on the app and the validator or
   posting pauses; wait for the next window: 6 hours, or 1 with the short epoch); a proof
   refused at the `cohort` stage (the floor is still 50) or the `membership` stage (the registration is not active
   yet); the validator's "live relay cap … is reached"
   (step 7); "the configured signer is not approved for FC_ANON_FID" (the agent's signer was revoked, or the uuid was
   pasted with a stray character: `-Disarm`, arm again). A pending row that Neynar refuses at its slot stays pending
   and is tried again at the next slot, at most `ZK_ANON_RELAY_MAX_ATTEMPTS` (6) slots, after which it is marked
   `failed` and stops counting against the cap; a slot whose request was cut off after Neynar had accepted it would be
   sent again too, so after each slot look at the agent's casts on the network: if there is one too many, delete the
   extra one with the ANON key (`DELETE /v2/farcaster/cast`, 10 credits).

7. **After the first cast: the cap.** `ZK_ANON_POST_LIVE_CAP=1` is a count of the live rows the validator holds,
   pending or relayed, not a daily allowance: once one row exists the next submission is refused, and a row that is
   stuck pending keeps its slot until it is relayed, or until the relay gives up after 6 slots and marks it `failed`,
   which frees the cap. After the first cast the script prints the cap and the counts and a note; the raise is its own
   run, `arm-anon.ps1 -RaiseCap 5`, behind a typed `RAISE`, and is refused until a first cast is on record; the hard
   bound is 100. By hand (this set redeploys the validator by itself; read its `--latest` logs for the poller-off line and
   `listening on :4001` again):

   ```powershell
   railway variable set --service owner-validator ZK_ANON_POST_LIVE_CAP=5
   railway logs --service owner-validator --latest --lines 100
   ```

   Raise it only after the first cast is on the network and looks the way you meant it to: the cap is the one thing
   that bounds what a stuck queue, a bug or a stolen passphrase can publish under that name.

8. **Kill switch: `-Disarm`.**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-anon.ps1 -Disarm
   ```

   It deletes `NEYNAR_API_KEY`, `FC_ANON_SIGNER_UUID` and `ENABLE_FC_WRITE` on owner-validator and `ZK_MODE` and
   `ADAPTER_REP` on owner-app, redeploys both (a delete alone does not redeploy, and the old container keeps relaying
   until the new one is up), waits for the boot lines, checks `GET /api/anon` reports `mode: fixture` and
   `config.armed: False` (with `ZK_MODE` gone the app is back in the fixture universe, where `liveRelay` is always
   true by definition, so `armed`, the validator's own write switch, is the honest check), and prints how many
   pending rows the validator still holds: they stay on its volume and go out at the first slot
   after you arm again, so **arming again is also sending them**. `FC_ANON_FID`, the cap, the tree, the floor and
   `VALIDATOR_POLLER=off` are left in place; they do nothing without the key. **`railway down --service owner-app`
   (section g) does NOT stop a pending anon cast:** the relay runs inside the validator. By hand, the shortest stop is

   ```powershell
   railway variable delete --service owner-validator ENABLE_FC_WRITE
   railway redeploy --service owner-validator --yes
   railway logs --service owner-validator --latest --lines 100
   ```

   A leaked ANON key: rotate or delete it at dev.neynar.com FIRST (that is the only thing that stops someone else
   using it), then `-Disarm`; a new key goes in with step 3 when you want anon back. Remember that the agent's signer
   is paired with the key that made it, so after a rotation "Create Agent" may have to be done again.

---

## (g) Kill switch and teardown

> **Not the go-live path (2026-10-17).** This section is for the owner's private service, which is optional now. Going live for everyone is `notes/runbooks/GO-LIVE-TODAY.md`.

Run the preamble first; `railway status` must say `layers-owner` for every owner row. The public relay's rows carry
their own `--project` flags and work from any link.

| to | do this |
|---|---|
| stop all owner publishing **now** | `railway down --service owner-app --yes`. It removes the running container at once and keeps the volume (your root, your ledger). To restore later, from the same clean checkout: `railway up --service owner-app --ci`, then the `--latest` logs. |
| stop owner publishing, keep the service up | `railway variable set --service owner-app ENABLE_FC_WRITE=false` (this redeploys by itself), then `railway logs --service owner-app --latest --lines 100` until the NEW deployment prints `[boot] OWNER SERVICE`. The old container keeps posting until the new one is up; `railway down` above is the immediate one. |
| stop an anon cast that is waiting for its relay slot | `arm-anon.ps1 -Disarm` (section f, step 8). The relay runs INSIDE the validator, so `railway down --service owner-app` does not stop it; by hand: `railway variable delete --service owner-validator ENABLE_FC_WRITE`, then `railway redeploy --service owner-validator --yes` and its `--latest` logs. Pending rows stay on the volume and go out after the next arming. |
| lock everyone out, including any open session | Re-run section (c) step 1 (a new passphrase file) and update your password manager, then run the block under this table. Every old cookie stops verifying once the new deployment is up, and every Face ID / fingerprint sign-in is retired with it: add them again after signing in with the new passphrase. |
| sign out a lost or stolen device | No Railway command: from any signed-in device, Settings › Security › **Lost this device?** next to its Face ID / fingerprint removes that sign-in AND signs out every device in one step (for an iPhone, also erase it in Find My). A device that never added one: **Sign out everywhere**. Both take effect at once; a passphrase session on its own cannot be ended singly (SECURITY-POSTURE.md §18). |
| pause the whole service | `railway variable set --service owner-app LAYERS_MAINTENANCE=true` and the same for `owner-validator`. To resume, `railway variable delete` both AND `railway redeploy` both (a running container keeps the environment it started with). |
| stop account creation | `railway variable delete --service owner-app FID_ACQUIRE_ENABLED`, then redeploy and read the `--latest` logs (section d, step 10) |
| remove the Neynar key from the owner services | `railway variable delete --service owner-app NEYNAR_API_KEY` **and** `railway variable delete --service owner-app DATA_SOURCE` (without the key, `DATA_SOURCE=neynar` leaves the live feeds broken), and the validator's key if you armed anon; then redeploy and read the `--latest` logs. If you think the key leaked, rotate it at dev.neynar.com, but read what that does to existing signer uuids first: signers are paired with the key that made them, and whether rotation keeps them is undocumented. |
| pause the PUBLIC site's live reads (keeps the key) | section (i), kill switch: `FC_READ=off` |
| remove the PUBLIC site's read key, or it leaked | section (i), kill switch |

Lock-out block (after the new passphrase file exists). Always `--skip-deploys` when a redeploy follows: a redeploy
asked for while another deploy is still building is refused.

```powershell
Get-Content "$HOME\.layers\owner-secret" | railway variable set --service owner-app --skip-deploys --stdin OWNER_ACCESS_SECRET
railway redeploy --service owner-app --yes
railway logs --service owner-app --latest --lines 100     # repeat until the new deployment prints [boot] OWNER SERVICE
```

**Teardown.** First make sure you have the 24 words on paper (section c, step 8). The persona accounts stay on
Farcaster after the service is gone, and only the root phrase can ever drive them again. Then delete the project **by
the ID saved in section (c) step 2**. Plain `railway delete --yes` does NOT delete the linked project: it opens a
picker over every project in every workspace and `--yes` skips the confirmation after the pick, so one wrong arrow key
deletes the public preview, volumes included.

```powershell
$ownerProjectId = (Get-Content "$HOME\.layers\owner-project-id" -Raw).Trim()
railway delete --project $ownerProjectId --yes     # add --2fa-code <code> only if Railway asks for it
railway link --project <railway-project-id> --environment production --service app
railway status                                     # must say layers-preview again
```

---

## (h) The public site: what it does now, and what comes next for strangers

> **Superseded for going live (2026-10-17):** `notes/runbooks/GO-LIVE-TODAY.md` is the public site's go-live list. What follows is the read-only state before it.

**What the public preview does, once section (i) is done.** It shows real Farcaster posts, read-only: the discovery
timeline (the recent posts of Farcaster accounts you choose, in ONE of two ways, section (i) step 3: a list of up to
100 accounts, `FC_READ_FIDS`, or everyone a "house" Farcaster account follows, `FC_READ_HOUSE_FID`), and profile and
thread pages for Farcaster usernames and cast hashes the visitor's own device does not already hold.
Channels are not part of v1 (D-FCREAD-NO-CHANNELS-IN-V1: channels are not an emphasis in v1; discovery is a general
feed; there is no per-channel live read), so a channel tab, wherever one shows, stays preview content. Every one of
those reads goes through one server route (`POST /api/fc/read`) whose single server-only module holds the READ key;
the browser gets a mode hint, never the key. Following, notifications, history, search, channel tabs, the right rail
and everything the server renders stay preview content. Liking, recasting, replying to or quoting a real Farcaster
post, following its author, adding it to a folder or staking on it is refused with "Posting to Farcaster isn't on this
preview yet. Reading is live; your own posts, folders and private posts still work." Marking it as a refutation,
concurring with a note or using it as a custom-rule trigger is disabled with the same sentence. Every real post, a
real thread's first post and a real profile's header carry a small "Farcaster · read-only" mark. The visitor's own
posts, likes on preview posts, folders and private posts work exactly as before. Without the key, nothing changes
except honest labels: the relay reports `no_key` and the feeds say they are showing preview content.
SECURITY-POSTURE.md §19 is what this costs, including that the operator now sees which reads each address makes, and
that Railway's HTTP log records the address with the path of every live profile and thread page a visitor opens.

**Signing in is built; posting still is not** (Persona launch P1, built on test data 2026-10-10, not yet on the deployed
site). A visitor can press Sign in with Farcaster on the public site's `/device` page, scan the QR with the Farcaster
app and approve: the browser verifies the sign-in itself and the account appears as a read-only "public self" marked
"that's me". The public app server receives no request for it (`404 device_only` if one ever reaches it), and nothing
about it changes on Farcaster. Posting, replying, liking, recasting and following AS that account through a persona's
buttons are refused ("Persona actions never act as your Farcaster account. To act as yourself, choose You in the account
menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your account, once you allow Totem to
post as you. To do this as a persona, switch to one of your personas."). POST AS YOU (built on test data 2026-11-05, not deployed): posting as the
account itself is now its own door, the browser self-custody and thin write relay below, for the visitor's OWN account
(a key in their vault, approved in the Farcaster app, relayed by the public validator; `SECURITY-POSTURE.md` §35 and
`notes/runbooks/GO-LIVE-TODAY.md` step 3's last part). `FC_SIWF=off` on the public `app` service hides the
card with no rebuild. What the sign-in relay and the chain node learn is `SECURITY-POSTURE.md` §21; the owner's first
real sign-in is `notes/runbooks/OWNER-CHECKLIST.md` step C.

**Bring your X** (Persona launch P2, built on test data): request your X archive now, on X under Settings → Your
account → Download an archive of your data (https://x.com/settings/download_your_data); it takes a day or more. When it
arrives, import it on both sites (Settings › Import from X), then reload and restart: that run is what flips the
status rows (`notes/runbooks/OWNER-CHECKLIST.md` steps A and E). The browser reads the archive; X is never called.

**Anonymous posting from the public site** (Persona launch P7, built on test data 2026-10-13, not deployed yet). A
visitor's tab proves in a background worker and sends over the browser's anonymous channel; the posts are test data
that stay inside the preview, every card says "Preview only · not on Farcaster", and nothing a browser sends reaches
Farcaster. Posting through @anon to Farcaster from the public site needs everything below plus a public @anon of its
own: section (k).

**Why posting on the public preview cannot just be switched on.**

- Its boot contract refuses every live credential and write switch (`NEYNAR_API_KEY`, `ENABLE_FC_WRITE`,
  `FID_ACQUIRE_ENABLED`, `DATA_SOURCE=neynar`, `NEYNAR_VIEWER_FID` and the rest) and exits before serving a page. That
  is deliberate. The READ key is the one scoped exception (notes/runbooks/PREVIEW-READINESS.md §5): a key from a second Neynar app
  with no signer and no wallet, which can read and cannot post as anyone.
- Every live write today is a **Neynar managed signer held by a server**. A managed signer is a server-side ability
  to post as that account. On the public site that would mean the server (and anyone holding the Neynar key) could
  post as every visitor: exactly the topology D-CUSTODY-ONE-RULE forbids ("the server never holds a root, a seed, a
  vault key or a persona private key").
- Account creation spends from **your** wallet. Opened to strangers, anyone could spend it.
- The owner service is safe only because it is single-tenant and gated. Remove the gate and it is notes/runbooks/PREVIEW-READINESS.md
  §1 again: every visitor is you.

**The design for posting, in a later pass: browser self-custody plus a thin write relay.** (This is a different
relay from the read relay above: it would forward messages a visitor's browser signed, and hold no key that can
post.) Most of the key material already exists:

1. **Keys stay in the browser.** The visitor's device already derives, from its root, each persona's Ed25519
   Farcaster signer key and an Ethereum custody key (the same derivations the owner service uses, running in the
   browser's device since the keystore pass).
2. **Posting.** The device builds and signs a Farcaster `CastAdd` message itself, with the persona's signer key. A
   thin server relay forwards the signed bytes to the network, either to a hub's `POST /v1/submitMessage`, which takes
   the encoded message ([Neynar hub API](https://docs.neynar.com/reference/publish-message)), or to Neynar's
   `POST /v2/farcaster/message`, which takes a message signed by a developer-managed signer (150 credits;
   [Neynar](https://docs.neynar.com/reference/publish-message-to-farcaster)). The relay can refuse to forward a
   message; it cannot change it or write one, because it holds no key.
3. **Adding the key to the account.** The persona's signer key is registered onchain for its FID with a signed key
   request. That needs an app FID to vouch for the key: a server-held key, but one that can only vouch, not post.
4. **Creating accounts.** The browser's custody key signs the registration and transfer; somebody still pays the
   onchain fee. That pass has to decide who: a sponsored relay with per-visitor caps and abuse controls (proof of
   personhood or invite codes), or the visitor paying.
5. **What that pass builds:** message construction and signing in the device (the `@farcaster/core` protocol
   types), the key-registration flow, the write relay with per-device caps and a credit budget, the sponsorship
   decision, and three new adversarial reviews. Until then, the owner service is how your personas post, and the
   public preview only reads.

---

## (i) THE PUBLIC SITE'S LIVE READS — the READ key

> **A go-live step (2026-10-17):** this is `notes/runbooks/GO-LIVE-TODAY.md` step 4. Run `arm-live-reads.ps1` from there; this section is its long reference.

This gives the public preview real Farcaster posts to read (section h). It uses a **second** Neynar key, from a
**second** Neynar app, set on the public `app` service only. It spends Neynar credits on cache misses, under a daily
budget, from what is assumed to be the same monthly pool as your owner writes.

**Do this section only after all of these are true, in this order:**

1. The assistant has deployed the relay code to `layers-preview` **without** the key.
2. The deployed smoke passes, and the relay's status reports `no_key` (step 5 below shows how to ask it yourself).
3. (Recommended) In the Railway dashboard, on the `layers-preview` project's `app` service, set the healthcheck path to
   `/api/health`. Today the public app has none, so a deployment that refuses to boot is likely an outage rather than
   a failed rollout. The relay itself never refuses to boot (a bad setting only leaves it unarmed, with a named
   reason), but the boot contract does, for the must-not-ship names.

Every command below names the public project explicitly, because section (c) re-linked this folder to `layers-owner`.
Run the preamble first. Nothing here is typed on a command line.

1. **Check your Neynar plan and the pool.** On dev.neynar.com, note: your plan (Free is 10M credits a month); this
   month's usage so far; whether usage is shown per account or per app (the plan text suggests one pool shared by all
   your apps: the relay's reads, the owner service's writes, any live testing on the laptop, and the validator poller
   if it were ever on); and what your billing settings say happens at zero credits (requests stop, or overage is
   billed). If credits are pooled and you want real isolation, the alternative is a separate Neynar account (check
   Neynar's terms); otherwise the relay's daily budget below is sized to leave room for your writes.

2. **[SECRET] Create a SECOND app** on dev.neynar.com (Free allows 5), named so you will recognise it, e.g.
   `layers-preview-read`, and write down that this is the READ app. In it: **no signers, no webhooks, no bans, and do
   not open or fund its App Wallet.** Copy its API key into your password manager. A copy in `.env.local` is now
   safe but optional: the production-shaped launcher (`scripts/run-prod-shape.sh`) blanks this name for the local
   app, so no local run can arm against the real API, and the secrets audit then also greps the build for it (with no
   local copy it reports the key as NOT AUDITED, which is honest, not a failure).

   What this key can and cannot do, so you know what a leak costs: Neynar cannot make a key read-only or limit it to
   an origin. The READ app has no signer, so the key cannot post as any of your personas (their signers are paired
   with your first key) and, with no wallet, cannot register accounts. It **can** read, create signers and webhooks
   of its own and spend your credits fast (minutes, not days). The relay's budget cannot stop someone else holding it.
   **The only switch that stops a leaked key is rotating or deleting it at dev.neynar.com.**

3. **Budget and the discovery source first, before the key.** The first arming uses a small budget, for the
   assistant's one real read smoke:

   ```powershell
   railway variable set --project <railway-project-id> --environment production --service app --skip-deploys FC_READ_DAILY_CREDITS=2000
   ```

   The discovery timeline is the recent posts of Farcaster accounts you choose, not channels and not a network-wide
   ranking (Neynar removed its trending feeds from its API in August). You choose them in ONE of two ways, and you set
   exactly one variable: both set, or neither, leaves the relay unarmed with `bad_config` (D-FCREAD-HOUSE-ACCOUNT,
   SECURITY-POSTURE.md §19).

   | | (1) a list of accounts | (2) a house account's follows (the assistant's recommendation) |
   |---|---|---|
   | you give the assistant | the usernames of up to 100 accounts | the username of ONE Farcaster account you control, used only to follow |
   | it gives you back | the `FC_READ_FIDS=` line, their fids comma-separated | the `FC_READ_HOUSE_FID=` line, that account's fid |
   | changing who appears | a new list: one `variable set` and a redeploy (which also resets the day's budget) | follow or unfollow from the house account in any Farcaster client: no variable, no redeploy; it shows within about a quarter of an hour |
   | how many accounts | 1 to 100 | as many as the account follows |
   | Neynar credits | 100 a refresh, at most 14,400 a day | the same |
   | who can see the list | anyone, one post at a time (every post shows its author) | anyone, all at once: an account's follows are public on Farcaster |
   | who decides what shows | whoever can set variables on the public `app` service | whoever controls the house account (its recovery, and every Farcaster app signed in as it); losing that account loses curation, not keys |

   Either way, only those accounts' own top-level posts appear, never replies or recasts, and authors under the score
   floor are hidden. For (2): use a dedicated account, not your personal one (its follows would put your own social
   graph on the preview, and every personal follow would change the preview) and not a persona (the curation list
   would be tied to that persona), signed into as few Farcaster apps as possible, because every app signed in as it
   can change its follows. The preview never posts as it and holds no key or signer for it. Do not rely on muting
   someone from it; unfollow instead. Follow the accounts before step 5, so the first refresh has
   posts to show; Neynar describes the following feed as reverse chronological, so the busiest posters take most of
   the 25 places.

   Then paste ONE of these two lines, exactly as the assistant gives it back (never with the `<…>` placeholder, which
   PowerShell refuses):

   ```powershell
   railway variable set --project <railway-project-id> --environment production --service app --skip-deploys FC_READ_FIDS=<the fids, comma-separated, no spaces>
   ```

   ```powershell
   railway variable set --project <railway-project-id> --environment production --service app --skip-deploys FC_READ_HOUSE_FID=<the house account's fid>
   ```

4. **[SECRET] The key, from the clipboard as ONE line.** Copy the key from your password manager, then paste this
   block. `Get-Clipboard` without `-Raw` returns a list of lines, and a value with a line break inside it would later
   make the server's fetch throw an error whose message contains the key; the shape check below refuses anything
   that is not one key-shaped line and prints nothing of the value:

   ```powershell
   $k = (Get-Clipboard -Raw).Trim()
   if ($k -notmatch '^[A-Za-z0-9-]{16,80}$') { "not a key-shaped value; nothing was sent" } else { $k | railway variable set --project <railway-project-id> --environment production --service app --skip-deploys --stdin NEYNAR_READ_API_KEY }
   Remove-Variable k
   Set-Clipboard -Value ' '
   ```

   Then press **Win+V** and choose **Clear all**, so the key is not left in Windows clipboard history.

   Set it as a **service variable on `app`**, as above: never as a shared or project variable (that would also reach
   the validator, whose boot refuses this name), never under the name `NEYNAR_API_KEY` (the public app's boot refuses
   that), and never on either owner service.

5. **One redeploy, then check it armed.**

   ```powershell
   railway redeploy --project <railway-project-id> --environment production --service app --yes
   railway logs --project <railway-project-id> --environment production --service app --latest --lines 100
   $pubUrl = "https://app-production-15c4.up.railway.app"
   Invoke-RestMethod -Method Post "$pubUrl/api/fc/read" -ContentType application/json -Headers @{ "x-layers-relay" = "1" } -Body '{"op":"status"}'
   ```

   Repeat the logs line until the new deployment prints `[boot] production environment contract: clean` and the
   relay's `[fc-read]` line. The status call must answer `armed: True` with `reason: armed`. It never shows the key or
   any budget number, and never which discovery source you chose. Other reasons: `no_key` (the key did not land, or
   the redeploy is not live yet); `bad_key` (the stored value is not key-shaped: repeat step 4); `bad_config` (a
   setting does not parse, most likely the discovery source: the relay's `[fc-read]` log line names the variable,
   never its value. Exactly one of `FC_READ_FIDS` and `FC_READ_HOUSE_FID` must be set: if both are, delete the one you
   did not choose (the "switch the discovery source" row below); if the named one is malformed, repeat its line from
   step 3 without `--skip-deploys`); `off` (`FC_READ=off` is set); `not_public` or `bad_base_url` (tell the
   assistant: neither should happen on this service).

6. **Tell the assistant it is armed.** It runs one real read smoke under the 2,000-credit budget and measures the
   credit cost of the three endpoints Neynar's price table does not list. It also counts how many discovery posts
   survive the score floor: if fewer than about 20 of 25 do, it raises discovery's page size to 40 to 50 (160 to 200
   credits a refresh instead of 100) rather than paging. Look at the usage page on dev.neynar.com right after.

7. **Raise the budget to the everyday value** (this set redeploys by itself, which also resets the day's count):

   ```powershell
   railway variable set --project <railway-project-id> --environment production --service app FC_READ_DAILY_CREDITS=100000
   railway logs --project <railway-project-id> --environment production --service app --latest --lines 100
   ```

   Then the status call again. 100,000 a day is about 3M a month, 30% of the Free plan, and leaves the rest for your
   writes (about 195k a month for three personas). Profile and thread lookups may spend at most 70% of the day and any
   one address at most 5%, so the discovery timeline keeps its share (at most 14,400 a day, or 28,800 if step 6
   raised the page size) even on a day someone spends the lookups on purpose. The budget counts per UTC day and per
   running instance, and restarts with every redeploy, including every `variable set` without `--skip-deploys`, so a
   day with three redeploys can spend up to four budgets.

8. **Watch the usage page** on dev.neynar.com one hour and 24 hours after step 7. Raise the budget only after a week
   of real numbers.

**Later changes** on the same service (each `variable set` without `--skip-deploys` redeploys and resets the day's
budget):

| to | do this |
|---|---|
| change whose posts show, list (1) | `FC_READ_FIDS` again, the whole list each time (1 to 100 fids; the assistant gives you the line). The redeploy starts with an empty cache, so the new list shows at once. |
| change whose posts show, house account (2) | nothing on Railway: follow or unfollow from the house account in any Farcaster client. It shows within about a quarter of an hour (the relay refreshes discovery at most every 10 minutes), with no redeploy and no budget reset. |
| switch the discovery source | set the new one first, with `--skip-deploys` (the step 3 line); then delete the old one: `railway variable delete --project <railway-project-id> --environment production --service app FC_READ_FIDS` (or `FC_READ_HOUSE_FID`); then `railway redeploy --project <railway-project-id> --environment production --service app --yes` (if it answers "cannot be redeployed … building", the delete already started one); then the `--latest` logs and the status call: `reason: armed`. Until the redeploy is live the running deployment keeps the old source; a deployment that sees both answers `bad_config`. |
| hide low-score authors more or less | `FC_READ_MIN_SCORE` (default 0.5: authors whose Neynar score is below it, or missing, are hidden). |

The discovery cost is the same in both modes and does not depend on how many accounts are chosen: one refresh every
10 minutes at most, 4 credits per post asked for.
**Never** set `NEYNAR_READ_BASE_URL` on Railway: it exists for the local test stub, and the relay refuses to arm with
it on a hosted platform.

**Kill switch for the public reads.**

| to | do this |
|---|---|
| pause live reads, keep the key | `railway variable set --project <railway-project-id> --environment production --service app FC_READ=off` (it redeploys by itself), then the `--latest` logs and the status call: `reason: off`. Undo with `railway variable delete --project <railway-project-id> --environment production --service app FC_READ` and a redeploy. |
| remove the key | `railway variable delete --project <railway-project-id> --environment production --service app NEYNAR_READ_API_KEY`, then `railway redeploy --project <railway-project-id> --environment production --service app --yes` (if it answers "cannot be redeployed … building", the delete already started one), then the logs and the status call: `reason: no_key`. |
| the key leaked | Rotate or delete it at dev.neynar.com **first**: that is the only thing that stops someone else using it. Then remove it from the service (row above), and set the new key with step 4 and step 5 when you want reads back. |
| someone else controls the house account (2) | Its follows are the preview's discovery list, so pause first: `FC_READ=off` (first row). Then either recover the account in Farcaster, or switch the discovery source (the "Later changes" table) to a list or to a new house account, and delete `FC_READ`. The relay holds no key or signer for that account, so nothing else is exposed (D-FCREAD-HOUSE-ACCOUNT). |

Open tabs keep showing the posts they already fetched, labelled as cached, until they reload; the server refuses every
new read at once. Nothing else on the preview changes: identities, posts, folders and private posts are untouched.

---

### Reference: the owner services' variables

| variable | service | who sets it | notes |
|---|---|---|---|
| `RAILWAY_DOCKERFILE_PATH` | both | command | `railway/Dockerfile.owner-app` / `railway/Dockerfile.owner-validator` |
| `LAYERS_PRIVATE_NETWORK_ONLY=true` | validator | command | boot refuses without it; set it only once the service has no domain |
| `APP_URL` | app | command | the owner app's https origin (login redirects and WebAuthn use it) |
| `VALIDATOR_URL` | app | command | `http://owner-validator.railway.internal:4001`; boot refuses a public-looking host |
| `TRUST_PROXY=true` | app | command | the platform edge sets the forwarding header; the login limiter keys on it |
| `PERSONA_FID_LIVE_ONLY=true` | app | command | a new persona waits for a real account instead of a pretend one |
| `LAYERS_COMMIT` | both | command | the commit the signed health payload names |
| `OWNER_ACCESS_SECRET` | app | **you, `--stdin`** | 16+ characters; the runbook makes 32 random bytes; rotating it signs out every device and retires every Face ID / fingerprint sign-in |
| `OWNER_SESSION_DAYS` | app | **you**, optional | how long a browser sign-in lasts per device: whole days, default 30, capped at 90 (a script's sign-in lasts a day whatever this says). Face ID / fingerprint sign-ins are bound to `APP_URL`'s host, which step 4 set |
| `NEYNAR_API_KEY` | app (validator only for anon) | **you, `--stdin`** | on the app, the same key as the laptop; on the validator ONLY the third app's ANON key (section f): never the app's key there (privacy condition 10), never the read key |
| `FC_TEST_FID` / `FC_TEST_SIGNER_UUID` | app | **you** (`--stdin` for the uuid) | the throwaway; writes refuse if armed without it |
| `ENABLE_FC_WRITE=true` | app (validator for anon) | **you** | real writes on; on the validator it arms the anon relay, and deleting it there is the shortest stop for a pending anon cast (section f, step 8) |
| `FID_ACQUIRE_ENABLED=true` | app | **you**, only while creating accounts | wait for the redeploy after setting or deleting it |
| `DATA_SOURCE=neynar` | app | **you**, optional | live content; costs credits per page view; delete it together with the key |
| `NEYNAR_VIEWER_FID` | app only | **you** (`arm-owner-service.ps1 -ViewerFid`) | your main account's fid: the live home feed and notifications are yours, AND, until main is connected, it is how a persona is kept from replying to, liking, recasting, following or @mentioning your main account from a button. Without it those actions are refused (`FC_MAIN_UNKNOWN`, fails closed; plain posts still go out), so pass it. Never 9152 (@warpcast); never on the public app |
| `LAYERS_MAX_LIVE_PERSONA_FIDS` / `LAYERS_FID_SPEND_CAP_USD` | app **and** your laptop shell | **you**, optional | raise the caps within 20 / $25 |
| `FC_ANON_FID` / `FC_ANON_SIGNER_UUID` | validator | **you**, optional (`--stdin` for the uuid; `arm-anon.ps1`) | the agent account from the THIRD Neynar app, section (f) step 1: never the throwaway, never a persona's fid |
| `ZK_ANON_POST_LIVE_CAP` | validator | **you**, optional (`arm-anon.ps1`) | the live relay cap, 1 by default and at most 100: a count of the live rows the validator holds (pending or relayed), not a daily allowance; raise it only after the first cast is on the network (section f, step 7) |
| `ZK_ANON_POST_SLOTS` | **both, identical**, optional | nobody by default | Persona launch P3: anonymous posts per person per window, shared across personas; default 4, an integer from 1 to 16, blank means unset. If the app and the validator disagree, anon posting pauses and says so |
| `ZK_ANON_POST_DAILY_CAP` | validator | nobody by default | Persona launch P3: every anon post the validator accepts in a day, for everyone; default 500. On this service the lifetime cap above is the tighter bound |
| `VALIDATOR_X_INDEX=on` | validator | **you**, optional, a decision (`notes/runbooks/OWNER-CHECKLIST.md` step D) | Persona launch P2: builds the list of Farcaster-verified X accounts for Find your people, 60 s after boot and then nightly (about 3.5 min, about 45 MB of transfer); it crawls `api.farcaster.xyz`, a beta endpoint with no stated terms. Read `GET <validator>/x/fc-index/meta` for its rows and size. Default off: the panel then says the list is not available |
| `ZK_ANON_POST_TREE=valid` | **both, identical** | **you**, optional (`arm-anon.ps1`) | the tree an anon post proves membership in; `valid` is every active registration (the default, `tier-2`, refuses a root with no reputation); each side enforces its own copy, so the two must match |
| `ZK_EPOCH_MS=3600000` | validator | **you**, optional, before the first registration | one-hour epochs (the app's minimum): the live registration takes effect within an hour and the anon window is an hour instead of six; never lengthen it afterwards (section f, step 4) |
| `VALIDATOR_POLLER=off` | validator | command (c3), and **you** again in (f) | keep it set whenever the validator holds any Neynar key; without it the poller reads @warpcast every minute, up to ~4.4M credits a month from the shared pool |
| `ZK_MODE=live` | app | **you**, optional (`arm-anon.ps1`) | every ZK surface moves to the live universe, and the prover downloads its artifacts once to `/data/zk-artifacts` (section f) |
| `ADAPTER_REP=zk` | app | **you**, optional (`arm-anon.ps1`) | the app refuses anon posting without it (fail closed) unless `ZK_ANON_POST=on` (section (k)); side effect: the For You tier gate reads PROVEN tiers, so an unproven persona is tier 0 for discovery (section f) |
| `ZK_ANON_FLOOR=1` | app | **you**, optional (`arm-anon.ps1`) | the client's anonymity floor, 50 by default; 1 is the honest number for a live universe with one root (section f): a set of one, not a crowd |
| `LAYERS_MAINTENANCE=true` | both | **you** | the pause switch |
| `LAYERS_WORLD=empty` | both | command | the demo world off (lib/world.ts): no seeded or fixture personas, posts, feeds, follows, channels, rooms, folders, curator or market content anywhere; the roster, switcher and acting persona are your keystore's own personas (with none, the pages say so and Settings › Account & Personas offers a plain "Create persona"); feeds show live content (`DATA_SOURCE=neynar`) or say "Nothing here yet". Nothing is deleted: demo rows already stored are hidden at read and written back verbatim with every write, and come back if the variable is deleted. On the validator an EMPTY database is not seeded (a fresh deploy starts with nothing). Under it the Developer pane's destructive actions (seed reset, device loss, tamper, zk reset, fid forget) and every zk test-rig action but the read-only probes answer 403. A write that names a hidden record's key keeps the stored record (logged `[world] ...`). Any other value, including a variable that is set but EMPTY, refuses to boot (only an absent variable means the demo world; the boot log says `[boot] WORLD: demo` or `[boot] WORLD: empty`) |
| baked into the images | | | `ZK_DEV_HOOKS=true`, `LAYERS_REQUIRE_SIG=true`, `NODE_ENV=production`, the `/data` paths, ports 3001 / 4001 |

### Reference: the public app's live-read variables (project `layers-preview`, service `app` only)

| variable | who sets it | notes |
|---|---|---|
| `NEYNAR_READ_API_KEY` | **you, `--stdin`**, section (i) step 4 | the SECOND Neynar app's key; service variable on `app` only; the validator refuses it at boot |
| `FC_READ_DAILY_CREDITS` | **you**, section (i) steps 3 and 7 | credits per UTC day per instance, counted on cache misses; default 100000 when unset |
| `FC_READ=off` | **you**, kill switch | disarms the relay without deleting the key |
| `FC_READ_FIDS` | **you**, section (i) step 3, source (1) | 1 to 100 comma-separated fids of the accounts whose own posts are the discovery timeline (D-FCREAD-NO-CHANNELS-IN-V1); set this OR `FC_READ_HOUSE_FID`, never both; malformed, both set or neither set leaves the relay unarmed (`bad_config`) |
| `FC_READ_HOUSE_FID` | **you**, section (i) step 3, source (2) | one fid: the house Farcaster account whose follows are the discovery list (D-FCREAD-HOUSE-ACCOUNT); curate by following and unfollowing, no redeploy; its follows are public; set this OR `FC_READ_FIDS`, never both |
| `FC_READ_MIN_SCORE` | **you**, optional | default 0.5; authors below it, or without a score, are hidden |
| `NEYNAR_READ_BASE_URL` | **never on Railway** | local test stub only; the relay refuses to arm with it on a hosted platform |
| `NEYNAR_API_KEY`, `ENABLE_FC_WRITE`, `DATA_SOURCE=neynar`, `NEYNAR_VIEWER_FID` | **never** | the public boot contract refuses each of them and exits |


## (j) Persona launch, wave 2: rings, reach tiers and launch (test data; what going live needs)

**Status (2026-10-12): built, test data only, deployed to both sites on 2026-10-12 and not yet used there.** No script
arms any of it, nothing in it spends, and nothing in it reaches the real network. Each status row stays "Built, test data only" until you have seen the
piece work on a deployed site. The checklist is `notes/runbooks/OWNER-CHECKLIST.md` steps G to I.

**Rings** (SECURITY-POSTURE.md §24). Settings › Rings: up to 16 rings, each sharing chosen PUBLIC personas at one of
two depths (that it is you, or also which anonymous posts it wrote). A member hands you a private address, or you send
someone without Totem a `/d` link; the device publishes sealed notes to the validator's ring drop about hourly, signed
by the device and padded to groups of 4. Nothing to set: the drop is part of every validator. On the owner service a
ring publishes to that service's own validator, so members on the public site cannot read it yet
(A-RING-OWNER-SERVICE-DROP; reaching them needs the drop on the public validator and the owner's device registered
there, the next pass). The `/d` page sits behind the owner gate on the owner service like every page, so the service
does not offer to make a `/d` link, and adding a member there says that the notes reach only devices that read this
service's own server, with no promise of delivery (fix UX-R2).

**Reach tiers** (§25). An anonymous post can prove a follower bucket of your main Farcaster account (1k+, 10k+, 100k+;
a Neynar score of 0.7 or more to enter) and get a head start in For You with the label "posted by an account with 10k+
followers". A tier is offered only while at least 50 accounts are in it, so with one owner none is ever offered on the
owner service. Going live:

- a live `fc.reach` needs `ATTEST_FID_SOURCE=live` and Neynar read credits on the `NEYNAR_API_KEY` plan (plan O3);
- `x.reach` needs an xAI key (plan O5); until then it is fixture only and refuses on live facts.

**Launch and the Totem registrar** (§26). Launch runs on a SIMULATED registrar (`validator/registrar.js`,
`validator/simchain.js`): the account appears on a simulated chain 2 to 48 hours after the click, with one $0 spend row
per batch that registered an account, and nothing is created on Farcaster. On the owner service's live universe it refuses with "Launch needs the
Totem registrar, which isn't set up yet." Going live (plan O1) needs:

1. a FRESH Totem registrar wallet with ETH on Optimism, funded from an exchange withdrawal; never the Neynar App Wallet,
   which registered the test account (section (d), A-FID-REGISTRANT-BY-FIAT);
2. a registrar app fid that is never the connector, anon or test fid (the simulated registrar refuses to register
   while they are the same number; it still accepts requests, so launches would stall without a word);
3. the live Bundler call, the live KeyRegistry read (F25), the live fname server and a live thin relay;
4. the add-key order on the real chain (A-LAUNCH-ADD-METADATA-ORDER): the registrar app signs its key-request metadata
   before the device signs Add, which needs a second anonymous round trip or a published vouch; not built.

**2026-10-17:** a live registrar for the owner service was written and then PARKED (section (l)); points 1 to 4 are
still not in the build.

About $0.20 of storage per account plus a few cents of gas. `LAYERS_REGISTRAR_PRIVATE_KEY` is in `MUST_NOT_SHIP` on both
halves (a public process carrying it refuses to boot) and nothing reads it this wave: do not set it anywhere. A price per
launch (about $5, paid with prepaid credits that do not tie the payer to the persona) is a later pass.

**The variables this wave adds.**

| variable | where | notes |
|---|---|---|
| `ZK_REACH_FLOOR` | app and validator | the crowd floor of a reach tier; default 50, never below `ZK_ANON_FLOOR`; leave it unset |
| `ZK_ANON_REACH_ISSUERS` | validator | which reach issuers an anon post may prove; default `fc.reach,x.reach`, `none` for none |
| `RING_DROP_MAX_ROWS` | validator | the ring drop's row cap; default 4,096 (about 34 MB per read at the cap); never raise it casually |
| `RING_DROP_MAX_ROWS_PER_WRITE`, `RING_DROP_WRITES_PER_HOUR`, `RING_DROP_ROWS_PER_HOUR`, `RING_DROP_MAX_LIVE_PER_DEVICE`, `RING_DROP_MAX_LIVE_PER_ADDRESS` | validator | 28 rows per signed write (a multiple of 4); per device 120 writes and 2,048 rows an hour and 1,024 live rows; per address 2,048 live rows. Leave them unset |
| `RINGS_PUBLISH_MS` | app | the re-seal cadence, hourly by default and never below a minute (with its ±25 % jitter a one-minute setting can fire at 45 seconds); a test knob that nothing limits to the rig: leave it unset |
| `LAYERS_REGISTRAR_PRIVATE_KEY` | **never** | refused at boot on a public deployment; nothing reads it this wave |


## (k) Persona launch, wave 3: anonymous posting from the public site, and Totem on X (test data; what going live needs)

**Status (2026-10-13): built, test data only, not deployed yet.** Nothing in it spends, nothing reaches Farcaster or
X, and no script arms any of it. Each status row stays "Built, test data only" until you have seen the piece work on a
deployed site. The checklist is `notes/runbooks/OWNER-CHECKLIST.md` steps J to M.

**Anonymous posting from the public site** (SECURITY-POSTURE.md §27). A visitor's tab makes the proof itself, in a
background worker (`public/device/prover.js`), and sends it over the browser's anonymous channel to the validator's web
route (`POST /zk/anon/web`). The posts are test data: they stay inside the preview, every card says "Preview only · not
on Farcaster", and nothing is posted to Farcaster; the live universe is refused in the browser and at the web route. A
visitor can post only once their browser's identity is in the anonymous crowd, and only while that crowd holds at least
50 identities. Nothing to set: the deploy brings it. Three things come with it:

1. **The GPL-3.0 duty of `prover.js`** (§5). It bundles snarkjs 0.7.5, ffjavascript 0.3.1, wasmcurves, wasmbuilder,
   fastfile, r1csfile and @iden3/binfileutils, all GPL-3.0, so the file as a whole is distributed under GPL-3.0. Its
   banner names the upstream sources and Totem's own worker sources (`lib/zk/prover/browser-worker.ts`,
   `lib/zk/ceremonyPins.ts`, `lib/zk/transport/fixtureCore.ts`, `lib/zk/hash.ts`, `lib/zk/transport/types.ts`), and
   `/device/prover.js.LICENSE.txt` carries the notice, the bundled packages' license comments and the full GPL-3.0 text.
   `device.js` never contains snarkjs (the build fails if it does). **No longer your action (decided 2026-10-17: publish; the
   go-live build serves the source at `/device/source/`).** The earlier wording, for reference (A-GPL-SOURCE-OFFER): this repository
   has no public remote, so before relying on public distribution either publish those worker sources or keep a written
   offer of the corresponding source. Counsel review before commercial distribution is still recommended.
2. **A check of the hosting edge's headers, at the deploy** (A-WEB-PROXY-HOP-HEADERS). The web route accepts the proxy
   hop headers `x-forwarded-*`, `x-real-ip`, `forwarded`, `via`, `x-request-id` and `x-request-start` only with
   `TRUST_PROXY=true`, which the public validator already has (D-CU-6-TRUST-PROXY-ON-THE-PLATFORM); any OTHER header the
   edge adds refuses every web submission, so anonymous posting would fail closed for everyone. After the deploy, one
   read settles it: `curl -s "https://<public validator>/zk/anon/web/head?mode=fixture&tree=tier-2"` must answer a head
   (or `{"error":"unknown"}`), never `{"error":"refused"}`; `npm run smoke:deployed` makes this read (check 10) and
   checks the GPL notice above (check 11). A refusal means the list needs a reviewed edit in `validator/anon.js`.
3. **No proving files on a deployed build** (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY). `.zk-artifacts` is excluded from
   the images, so a deployed build serves `/device/zk/manifest.json` with `present: false` and no `.wasm` or `.zkey`;
   test proofs need none, and a real proof in a browser refuses plainly ("The proving files aren't on this site yet…").
   Real proofs from strangers' browsers are a later step, with the public @anon below.

The kill switch: `ZK_ANON_POST=off` on the public `app` service (setting a variable redeploys it) turns anonymous
posting off on the server and in every visitor's tab; any value other than `on` or `off` also reads as off.

**Going live for strangers** (posting through @anon to Farcaster from the public site) is not built and needs, in
order: a public @anon of its own (a THIRD Neynar app and its agent account, never the owner service's; plan O2, about
150 credits a cast and about $365 a year of storage at 500 casts a day); the proving files on the deployed public site;
a test crowd that is a real crowd; and your yes. An outside OHTTP relay (plan O8) is what would stop the operator from
seeing each poster's internet address and browser (A-WEB-CHANNEL-DIRECT-UA); until one exists the label stays DEMO.

**Totem on X** (§28). On a server-side device (the rig, where it is tested, and the owner service), with "Post
anonymously" ticked in the test universe, the composer offers "Also post to @totem on X — test data: nothing reaches X", never pre-ticked. A copy is proved like an
anonymous post with its own slot (one per person per 6-hour window by default), waits in the validator's outbox for a
moderator's signed decision, and an approved copy goes out at the outbox's next hourly slot through a TEST transport
that writes a row and calls nothing. Nothing is ever approved without a moderator, and a rejected copy is kept and
hidden. Copies follow the rule for a public anonymous account: no @mentions, one link at most, at most 280 characters
(a link counts 23), and an article goes as a short quote and its link, never in full. Not on the public site this wave
(D-X-PUBLIC-OFF). On the owner service the box shows only while anonymous posting is on and runs on test data: today
anonymous posting there is off until section (f) arms it, and armed it runs on the live universe, where the box says
copies to X run on test data only. Settings lists it under "Totem on X", beside the DM inbox: "DM a tweet to @totem to save it (test
data: no DM is read from X yet)."

**2026-10-17:** a live X transport for the owner service was written and then PARKED (section (m)). Going live still needs (plan O4): a Totem account on X and X developer billing (pay per use, about $0.015 a post, $0.195
with a link, `lib/x/ratecard.json`, last verified 2026-08-01), then a real X transport (not built) and your moderator
key on the validator. **Your moderator key:** Settings › Totem on X shows this device's public moderator key; copy it
into `X_OUTBOX_MODERATORS` on the owner validator. It is a PUBLIC key; the private half never leaves your device. Not
needed for test data, and nothing posts to X without a live transport, which does not exist.

**The variables this wave adds.** None is needed for test data.

| variable | where | notes |
|---|---|---|
| `ZK_ANON_POST` | app | `on` or `off`; the kill switch for anonymous posting on that app's server and in every visitor's tab. Unset: the public site's tabs post on test data (preview only), and the rig and the owner service keep the old rule (on only with `ADAPTER_REP=zk`). Any other value reads as off |
| `X_OUTBOX_MODERATORS` | validator | comma-separated PUBLIC Ed25519 keys (64 hex each); copy yours from Settings › Totem on X. Without one, nothing is ever approved |
| `ZK_X_ANON_POST_SLOTS` | **both, identical** | X copies per person per window, default 1, an integer from 1 to 4; if the app and the validator disagree, copies pause and say so |
| `X_OUTBOX_DAILY_CAP` | validator | copies the outbox takes, and posts it makes, in a day; default 50 |
| `X_OUTBOX_RELAY_INTERVAL_MS`, `X_OUTBOX_RELAY_SPREAD_MS` | validator | the outbox's relay slot (an hour) and the random spread after it (30 minutes on the public shape, 0 elsewhere); leave them unset |
| `ZK_ARTIFACT_DIR` | the build only | where `scripts/build-device.mjs` looks for the pinned proving files to copy into `/device/zk/` (default `.zk-artifacts`); it never downloads them |


## (l) The live Totem registrar on the owner service (parked 2026-10-17)

**Parked: not in the build, and nothing to run.** The stopped go-live run wrote a live registrar for the owner's private
service; when the owner redirected the go-live to the public site, it was taken out of the tree and kept as a patch in
the session scratchpad (`parked-registrar.patch`, with this section's full earlier text in
`docs-track/parked-registrar-GO-LIVE-FARCASTER-l.md`, and also in `parked-registrar-docs.patch`).
There is no `arm-registrar.ps1`. Launch stays on the simulated
registrar on both sites (section (j)). Revive it later: apply the patch, re-run its tests and reviews, then restore this
section. SECURITY-POSTURE.md §29.

## (m) Live posting to @totem on X from the owner service (parked 2026-10-17)

**Parked: not in the build, and nothing to run.** The stopped go-live run wrote a live X transport for the owner's
private service; when the owner redirected the go-live to the public site, it was taken out of the tree and kept as a
patch in the session scratchpad (`parked-xlive.patch`, with this section's full earlier text in
`docs-track/parked-xlive-GO-LIVE-FARCASTER-m.md`, and also in `parked-xlive-docs.patch`). There is no `arm-x.ps1`. Totem on X stays on its test transport
(section (k)), and nothing is posted to X. Revive it later: apply the patch, re-run its tests and reviews, then restore
this section. SECURITY-POSTURE.md §30.
