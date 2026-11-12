#!/usr/bin/env bash
# PROD-LIVE (D-CU-0-4) — the PRODUCTION-SHAPED local pair: the shape the public preview ships in, on the pinned
# ports, so scripts/accept-prodlive.mjs, `npm run test:cu6` and `npm run smoke:deployed` can measure it locally.
# (Moved into the repo from the pass's scratch launcher att-run-prod.sh; docs/internal/prodlive-testing.md.)
#
#   scripts/run-prod-shape.sh [--build] [--no-restart] [suite...]
#     --build        rebuild first (npm run build: the device bundle, then next build)
#     --no-restart   keep the running pair; just run the suites
#     suite          an npm script name (test:cu6) or a scripts/*.mjs path, run in order against the pair
#
# What makes it production-shaped:
#   * NODE_ENV=production and ZK_DEV_HOOKS EMPTY — isPublicDeployment() is true on both processes, so the server
#     holds no identity and every page under app/(main) runs the visitor's in-browser device;
#   * every MUST-NOT-SHIP name blanked — read from validator/env-contract.js at run time, so this list can never
#     drift from the contract the processes enforce at boot; DATA_SOURCE and CUSTODY_FIXTURE_PROVIDER blanked too;
#   * LAYERS_REQUIRE_SIG=true (the contract's MUST-BE-SET half);
#   * VALIDATOR_URL / NEXT_PUBLIC_VALIDATOR_URL / APP_URL passed EXPLICITLY, as the rig launcher does: an env var
#     already set beats .env.local in Next, and a stale .env.local once pointed the app at :4000.
# The deliberate differences from a real deployment, all on the LOCAL validator only and all for the same reason (every
# browser context of every local suite reaches it from ONE loopback address, where a deployment gives each visitor
# their own):
#   * VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY is raised (default 1000, PRODLIVE_ROOTS_PER_DAY to change it). Never
#     raise it on a deployment — it is the abuse cap (validator/caps.js).
#   * FC-READ (lead fix): the per-address token bucket is raised — VALIDATOR_RL_CAPACITY (default here 3000,
#     PRODLIVE_RL_CAPACITY) and VALIDATOR_RL_REFILL_PER_SECOND (default here 50, PRODLIVE_RL_REFILL); the shipped
#     defaults are 300 and 5/s. accept-fcread boots a few dozen devices (~49 validator calls a boot) and drained the
#     shared bucket, so device boots failed on 429s ("the validator refused this root") and the smoke after it met 429s
#     on /zk/validator-key and /zk/dev/reset. The validator IGNORES both names on a hosting platform
#     (validator/server.js, env-contract.js isHostedPlatform), and accept-cu4 checks 6 and 9 measure the shipped
#     defaults on a throwaway validator that carries neither. PRODLIVE_RL_CAPACITY=300 PRODLIVE_RL_REFILL=5 runs the
#     pair on the defaults.
#
# FC-READ (the public live-read relay, lib/fc/readRelay.server.ts) — the APP now gets its own environment:
#   * APP_ENV = SRV_ENV plus the relay's variables; VAL_ENV never carries them (the validator REFUSES
#     NEYNAR_READ_API_KEY at boot — validator/env-contract.js VALIDATOR_REFUSES, blanked here from that list).
#   * By default NEYNAR_READ_API_KEY is BLANK for the app. `next start` loads .env.local, and once the owner keeps the
#     read key there (the secrets audit can only learn a value from that file) every production-shaped run would
#     otherwise arm the relay against the REAL network and spend real credits on every suite. A set-but-empty
#     variable beats .env.local in Next's loader. The pair must come up with the relay unarmed, and that is asserted.
#   * PRODLIVE_FC_READ=stub starts the loopback Neynar stub (scripts/lib/neynar-stub.mjs) on PRODLIVE_STUB_PORT
#     (default 4319, never a pinned port) and injects FC_READ_RIG=stub, a FAKE key, NEYNAR_READ_BASE_URL=<the stub>,
#     FC_READ_DENY=<the stub's planted denylisted hash> and FC_READ_FIDS=<the stub's discovery authors> into the APP
#     only. FC-READ (no channels): the relay has NO default FC_READ_FIDS (whose casts appear under the Totem brand is
#     the owner's call), so without it the relay disarms with bad_config and this launcher stops NOT STUB-SHAPED; the
#     list is the stub's own (`node scripts/lib/neynar-stub.mjs fids`: the authors of its planted casts). Default mode
#     blanks FC_READ_FIDS (and the retired FC_READ_CHANNELS) by name with the key.
#     FC-READ (house): discovery has a second source, FC_READ_HOUSE_FID (one house account whose FOLLOWS are the list;
#     the relay reads its following feed, the fid pinned). Exactly ONE source may be set, so stub mode arms ONE:
#     PRODLIVE_FC_READ_SOURCE=fids (the default) gives the app FC_READ_FIDS and blanks FC_READ_HOUSE_FID;
#     PRODLIVE_FC_READ_SOURCE=house gives it FC_READ_HOUSE_FID=<the stub's house account> (`node
#     scripts/lib/neynar-stub.mjs house-fid`) and blanks FC_READ_FIDS. The stub serves the same planted corpus both
#     ways, so every suite measures either source. Default mode blanks both by name (an owner's house fid in
#     .env.local must not reach the pair any more than the key), and refuses PRODLIVE_FC_READ_SOURCE=house: without
#     the stub it would change nothing, and a run that silently ignored it would pass for the wrong reason. The suites
#     get PRODLIVE_FC_READ_SOURCE, so accept-fcread can assert the pair read the source it was started with.
#     The suites then run with NEYNAR_STUB_URL (and EXPECT_FC_READ=armed unless the caller set it), and the launcher
#     FAILS (exit 1) if the stub recorded any violation (a /notifications read, a following-feed read other than the
#     pinned house request, a fid/viewer_fid/cursor, a wrong key, ...).
#     Any other value refuses: a read against the real network is the owner's, on Railway, under a small budget.
#     FC-READ (review): the suites that run the secrets audit (accept-cu4 / test:cu4, audit-secrets) also get the fake
#     key as NEYNAR_READ_API_KEY, so the audit can look for the value the app held (it has none in .env.local here).
#     Every restart stops a stub left from an earlier run first; --no-restart leaves it as it is.
#
# PERSONA LAUNCH P1 (Sign in with Farcaster) — PRODLIVE_SIWF=stub starts scripts/lib/siwf-stub.mjs (a loopback relay +
#   JSON-RPC stub) on PRODLIVE_SIWF_STUB_PORT (default 4321, never a pinned port) and hands FC_SIWF_RELAY_URL and
#   FC_SIWF_RPC_URL=<the stub> to the APP only; default mode blanks FC_SIWF, FC_SIWF_RELAY_URL and FC_SIWF_RPC_URL by
#   name (a value in .env.local or the calling shell must not reach the pair). The validator never carries these names.
#   The suites get SIWF_STUB_URL and EXPECT_SIWF_RELAY_HOST / EXPECT_SIWF_RPC_HOST (smoke-deployed check 9), and the
#   launcher FAILS if the stub recorded a violation. The stub's accounts are test constants: fids 990777/990778, fnames
#   stubalice/stubbob, and an unresolvable picture host pfp.example.invalid.
#
# PERSONA LAUNCH GO-LIVE — ZK_ANON_POST_TREE=valid on both processes (PRODLIVE_ANON_TREE to change it), the public
#   preview's anonymous tree (D-PUBLIC-ANON-TREE); the suites get EXPECT_ANON_TREE. On --no-restart pass the same
#   PRODLIVE_ANON_TREE the pair was started with.
#
# PUBLIC GO-LIVE — PRODLIVE_PUBLIC_LIVE=true runs the pair in public LIVE mode (lib/platform/publicLive.ts): PUBLIC_LIVE=true
#   on BOTH processes (the app forwards PUBLIC_LIVE=on to every tab; the validator's seed seeds nothing new), and the
#   suites get EXPECT_PUBLIC_LIVE=true. Default: PUBLIC_LIVE is BLANKED by name on both (a value in .env.local or the
#   calling shell must not reach the pair), and the suites get EXPECT_PUBLIC_LIVE=false — every existing suite runs on the
#   preview exactly as before. Any other value refuses to start. On --no-restart pass the same value the pair was started
#   with. The onboarding suite: PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh
#   scripts/accept-onboard-prod.mjs
#
# PUBLIC GO-LIVE (F1) — PRODLIVE_ANON_UNIVERSE=live gives the APP ZK_ANON_UNIVERSE=live (what scripts/owner/arm-public-anon.ps1
#   sets on the public app once the validator's @anon relay is armed; the app then hands every tab ZK_ANON_UNIVERSE=live and
#   ZK_MODE=live through lib/device/deviceEnv.server.ts), and the suites get EXPECT_ANON_UNIVERSE=live. Default: the name is
#   BLANKED on both processes (a value in .env.local or the calling shell must not reach the pair) and the suites get
#   EXPECT_ANON_UNIVERSE=unset. Any other value refuses to start. Asserted, not assumed: after the start the launcher reads
#   the server-rendered /anon and stops (NOT UNIVERSE-SHAPED) when the hint is missing on a live run (the build predates
#   the forwarding) or present on a default one. On --no-restart pass the same value the pair was started with. The run:
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ANON_UNIVERSE=live ONBOARD_ONLY=O14 bash scripts/run-prod-shape.sh
#   scripts/accept-onboard-prod.mjs
#
# POST AS YOU — PRODLIVE_ROOTPOST=stub starts scripts/lib/farcaster-api-stub.mjs serve (a loopback Farcaster signed key
#   request API on PRODLIVE_ROOTPOST_PORT, default 4335, and a loopback Snapchain node on PRODLIVE_ROOTPOST_HUB_PORT, default
#   4337; never a pinned port) and arms Totem's app account on the VALIDATOR with the stub's PUBLIC test constants
#   (FC_APP_FID, FC_APP_CUSTODY_KEY = `node scripts/lib/farcaster-api-stub.mjs app-key`, a key that reaches nothing),
#   FC_KEY_REQUEST_API_URL and FC_HUB_URL = the stubs; the APP gets FC_ROOT_HUB_URL = the hub stub (the node the tab reads).
#   Default mode blanks FC_APP_FID, FC_APP_CUSTODY_KEY, FC_APP_SPONSOR, FC_KEY_REQUEST_API_URL, FC_KEY_REQUEST_TTL_SEC on the
#   validator and FC_ROOT_HUB_URL + FC_APP_CUSTODY_KEY on the app by name (a value in .env.local or the calling shell must
#   not reach the pair; the public app refuses FC_APP_CUSTODY_KEY at boot). The suites get ROOTPOST_STUB_URL and
#   EXPECT_ROOT_POST=armed (default: EXPECT_ROOT_POST=unset), and the launcher FAILS if the stub recorded a violation (a
#   browser calling Farcaster's API directly). The run:
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub bash scripts/run-prod-shape.sh scripts/accept-root-post-prod.mjs
#
# FOLLOWING FROM THE HUB — a tab signed in with Farcaster reads its own graph from a Snapchain node (lib/fc/hubRead). So
#   that a stub sign-in's reads stay on the machine, PRODLIVE_HUB=stub (the DEFAULT whenever PRODLIVE_SIWF=stub) starts the
#   same loopback node (scripts/lib/farcaster-api-stub.mjs serve, ports as above) with `--graph default` (the stub accounts'
#   follows and casts: HUB_DEFAULT_GRAPH) and gives the APP FC_ROOT_HUB_URL = that node; under PRODLIVE_ROOTPOST=stub the
#   post-as-you stub IS that node. The validator is armed only by PRODLIVE_ROOTPOST=stub. PRODLIVE_HUB=off keeps the default
#   (the public node's address; Chromium in the suites resolves nothing but loopback). The suites get HUB_STUB_URL (the
#   stub's /__stub/hub/* steering) and HUB_URL, and EXPECT_HUB=stub|off; the launcher FAILS if the node saw a preflight or a
#   read carrying a cookie or a Referer (a tab's read is a plain GET, credentials omitted, no referrer). The hub suite:
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ROOTPOST=stub bash scripts/run-prod-shape.sh scripts/accept-hub-read-prod.mjs
#
# SIGN IN WITH X — PRODLIVE_X=stub starts scripts/lib/x-api-stub.mjs serve (a loopback X OAuth 2.0 consent page + token,
#   users/me and revoke endpoints) on PRODLIVE_X_STUB_PORT (default 4338, never a pinned port; the harness lock's port list
#   covers it) with the app's own callback (<BASE>/welcome/x) as its one registered redirect, and arms BOTH processes with
#   the stub's PUBLIC test client id: the APP gets X_CLIENT_ID and X_SIGNIN_AUTHORIZE_URL = the stub's /i/oauth2/authorize
#   (the tab navigates there), the VALIDATOR gets X_CLIENT_ID and X_SIGNIN_API_URL = the stub (its relay redeems codes
#   there). A public client: no X_CLIENT_SECRET anywhere (the public app refuses one at boot). Default mode blanks X_CLIENT_ID,
#   X_CLIENT_SECRET, X_SIGNIN and X_SIGNIN_AUTHORIZE_URL on the app and X_CLIENT_ID, X_CLIENT_SECRET, X_SIGNIN and
#   X_SIGNIN_API_URL on the validator by name (a value in .env.local or the calling shell must not reach the pair). Asserted,
#   not assumed: the validator's /x/signin/config must say ready (stub) or not (default), and /welcome must carry the tab
#   hint X_SIGNIN (stub) or none (default). The suites get X_STUB_URL and EXPECT_X_SIGNIN=armed (default EXPECT_X_SIGNIN=unset),
#   and the launcher FAILS if the stub recorded a violation (a browser calling X's token or API endpoints, a preflight, a
#   follows read, a field beyond the three) or if any token it issued was not revoked. The run:
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_X=stub bash scripts/run-prod-shape.sh scripts/accept-x-signin-prod.mjs
#
# ADS, PHASE 1 — PRODLIVE_ADS=on gives the APP ADS=on (lib/ads/switch.ts: the house ads placed by each visitor's device;
#   the app forwards ADS=on to every tab). Default: ADS is BLANKED by name on the app (a value in .env.local or the calling
#   shell must not reach the pair), so ads are DORMANT, as a deploy ships them. Asserted, not assumed: /welcome must hand
#   tabs the ADS=on hint (on) or none (default). The suites get EXPECT_ADS=on|off. The two runs of the ads suite:
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub PRODLIVE_ADS=on bash scripts/run-prod-shape.sh scripts/accept-ads-prod.mjs
#   PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/accept-ads-prod.mjs   (dormant)
#
# Logs: $TEMP/layers-app.log and $TEMP/layers-validator.log (test:cu6's log grep reads them there), and
# $TEMP/layers-neynar-stub.log under PRODLIVE_FC_READ=stub, $TEMP/layers-siwf-stub.log under PRODLIVE_SIWF=stub.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TEMP:-/tmp}/prod-shape"; mkdir -p "$OUT"
LOGDIR="${TEMP:-/tmp}"
cd "$REPO" || exit 1
BUILD=0; RESTART=1
while [ $# -gt 0 ]; do case "$1" in --build) BUILD=1; shift;; --no-restart) RESTART=0; shift;; *) break;; esac; done
APP_PORT="${LAYERS_APP_PORT:-3001}"; VAL_PORT="${LAYERS_VALIDATOR_PORT:-4001}"
BASE="http://localhost:$APP_PORT"; VBASE="http://localhost:$VAL_PORT"

# the must-not-ship names, blanked (names only — no value is ever read or printed here)
MNS_BLANK="$(node -e "process.stdout.write(require('./validator/env-contract.js').MUST_NOT_SHIP.map((n) => n + '=').join(' '))")" \
  || { echo "cannot read MUST_NOT_SHIP from validator/env-contract.js"; exit 1; }
[ -n "$MNS_BLANK" ] || { echo "MUST_NOT_SHIP is empty — refusing to guess"; exit 1; }
# PERSONA LAUNCH GO-LIVE (D-PUBLIC-ANON-TREE): the public deployment's anonymous tree, on BOTH processes, as the public
# preview runs it (.env.production.example: ZK_ANON_POST_TREE=valid) — the app forwards it to every tab
# (lib/device/deviceEnv.server.ts), the validator accepts only it. PRODLIVE_ANON_TREE overrides it for a run (a tree NAME:
# valid or tier-1..tier-10; anything else refuses to start). scripts/accept-anon-prod.mjs reads the tree a page's device was
# given and runs its throwaway validator on the same one.
# PUBLIC GO-LIVE: live mode on both processes, or blanked by name on both (see the header)
case "${PRODLIVE_PUBLIC_LIVE:-}" in
  true) LIVE_ENV="PUBLIC_LIVE=true"; EXPECT_LIVE=true;;
  ""|false) LIVE_ENV="PUBLIC_LIVE="; EXPECT_LIVE=false;;
  *) echo "PRODLIVE_PUBLIC_LIVE=${PRODLIVE_PUBLIC_LIVE} is not true or false"; exit 1;;
esac
# PUBLIC GO-LIVE (F1): the anonymous universe hint, on the APP only, or blanked by name on both (see the header)
case "${PRODLIVE_ANON_UNIVERSE:-}" in
  live) UNIVERSE_APP="ZK_ANON_UNIVERSE=live"; EXPECT_UNIVERSE=live;;
  ""|unset) UNIVERSE_APP="ZK_ANON_UNIVERSE="; EXPECT_UNIVERSE=unset;;
  *) echo "PRODLIVE_ANON_UNIVERSE=${PRODLIVE_ANON_UNIVERSE} is not live or unset"; exit 1;;
esac
# ADS, PHASE 1: the app's ads switch, on, or blanked by name (dormant, as a deploy ships it; see the header)
case "${PRODLIVE_ADS:-}" in
  on) ADS_APP="ADS=on"; EXPECT_ADS=on;;
  ""|off) ADS_APP="ADS="; EXPECT_ADS=off;;
  *) echo "PRODLIVE_ADS=${PRODLIVE_ADS} is not on or off"; exit 1;;
esac
# NEYNAR AS A SWITCH (lib/fc/source/switch.ts, SECURITY-POSTURE.md §42): the app's per-surface source switches. Default:
# all six BLANKED by name (network everywhere, as a deploy ships them; a value in .env.local or the calling shell must not
# reach the pair). PRODLIVE_FC_SOURCES="foryou=neynar,search=neynar" (surfaces following, notifications, foryou, search,
# counts, channels; values network, neynar, auto, or any other word to measure an unknown value) gives the APP those
# switches. The suites get EXPECT_FC_SOURCES (the same list) and the hints are asserted from /welcome below.
FCS_APP="FC_SOURCE_FOLLOWING= FC_SOURCE_NOTIFICATIONS= FC_SOURCE_FORYOU= FC_SOURCE_SEARCH= FC_SOURCE_COUNTS= FC_SOURCE_CHANNELS="
FCS_HINTS=""
EXPECT_FC_SOURCES="${PRODLIVE_FC_SOURCES:-}"
if [ -n "${PRODLIVE_FC_SOURCES:-}" ]; then
  for pair in $(echo "$PRODLIVE_FC_SOURCES" | tr ',' ' '); do
    s="${pair%%=*}"; v="${pair#*=}"
    case "$v" in ""|*[!a-zA-Z0-9_-]*) echo "PRODLIVE_FC_SOURCES: '$pair' needs a plain word value"; exit 1;; esac
    case "$s" in
      following) FCS_APP="$FCS_APP FC_SOURCE_FOLLOWING=$v";;
      notifications) FCS_APP="$FCS_APP FC_SOURCE_NOTIFICATIONS=$v";;
      foryou) FCS_APP="$FCS_APP FC_SOURCE_FORYOU=$v"; case "$v" in neynar|auto) FCS_HINTS="$FCS_HINTS FC_SOURCE_FORYOU:$v";; esac;;
      search) FCS_APP="$FCS_APP FC_SOURCE_SEARCH=$v"; case "$v" in neynar|auto) FCS_HINTS="$FCS_HINTS FC_SOURCE_SEARCH:$v";; esac;;
      counts) FCS_APP="$FCS_APP FC_SOURCE_COUNTS=$v";;
      channels) FCS_APP="$FCS_APP FC_SOURCE_CHANNELS=$v";;
      *) echo "PRODLIVE_FC_SOURCES: '$s' is not a surface (following, notifications, foryou, search, counts, channels)"; exit 1;;
    esac
  done
fi
ANON_TREE="${PRODLIVE_ANON_TREE:-valid}"
case "$ANON_TREE" in valid|tier-[1-9]|tier-10) ;; *) echo "PRODLIVE_ANON_TREE=$ANON_TREE is not a plain tree name (valid, tier-1..tier-10)"; exit 1;; esac
SRV_ENV="NODE_ENV=production ZK_DEV_HOOKS= LAYERS_REQUIRE_SIG=true ZK_PREFETCH_MS=3000 DATA_SOURCE= CUSTODY_FIXTURE_PROVIDER= LAYERS_MAINTENANCE= LAYERS_APP_PORT=$APP_PORT LAYERS_VALIDATOR_PORT=$VAL_PORT VALIDATOR_URL=$VBASE NEXT_PUBLIC_VALIDATOR_URL=$VBASE APP_URL=$BASE ZK_ANON_POST_TREE=$ANON_TREE $LIVE_ENV $MNS_BLANK"
# FC-READ: the validator-only refusals (names only), blanked for the validator; READ_BLANK blanks the read key by name
# for both processes even where an older contract has no such list
VR_BLANK="$(node -e "process.stdout.write((require('./validator/env-contract.js').VALIDATOR_REFUSES || []).map((n) => n + '=').join(' '))" 2>/dev/null)"
# FC-READ (house): FC_READ_HOUSE_FID, the second discovery source, blanked by name like the first
READ_BLANK="NEYNAR_READ_API_KEY= NEYNAR_READ_BASE_URL= FC_READ_RIG= FC_READ_DENY= FC_READ_FIDS= FC_READ_HOUSE_FID= FC_READ_CHANNELS="
VAL_ENV="$SRV_ENV $READ_BLANK $VR_BLANK ZK_ANON_UNIVERSE= VALIDATOR_NEW_ROOTS_PER_ADDRESS_PER_DAY=${PRODLIVE_ROOTS_PER_DAY:-1000} VALIDATOR_RL_CAPACITY=${PRODLIVE_RL_CAPACITY:-3000} VALIDATOR_RL_REFILL_PER_SECOND=${PRODLIVE_RL_REFILL:-50}"
APP_ENV="$SRV_ENV $READ_BLANK"

# FC-READ: the relay's test mode — a loopback stub, never the network
FC_MODE="${PRODLIVE_FC_READ:-}"
STUB_KEY="" # FC-READ (review): only ever this launcher's own fake key (set below), never one from the calling shell
STUB_PORT="${PRODLIVE_STUB_PORT:-4319}"
STUB_URL="http://127.0.0.1:$STUB_PORT"
case "$FC_MODE" in
  ""|stub) ;;
  *) echo "PRODLIVE_FC_READ=$FC_MODE is not a mode this launcher runs (only 'stub': a real-network read is the owner's, on Railway, under a small budget)"; exit 1;;
esac
# FC-READ (house): which discovery source stub mode arms — exactly one (fids, the default; or house)
FC_SOURCE="${PRODLIVE_FC_READ_SOURCE:-fids}"
case "$FC_SOURCE" in
  fids|house) ;;
  *) echo "PRODLIVE_FC_READ_SOURCE=$FC_SOURCE is not a discovery source (fids or house)"; exit 1;;
esac
if [ "$FC_MODE" != "stub" ] && [ "$FC_SOURCE" != "fids" ]; then
  echo "PRODLIVE_FC_READ_SOURCE=$FC_SOURCE needs PRODLIVE_FC_READ=stub (default mode arms no source: both are blanked)"; exit 1
fi
case "$STUB_PORT" in
  3001|4001|3009|3100|3101|"$APP_PORT"|"$VAL_PORT") echo "PRODLIVE_STUB_PORT=$STUB_PORT is pinned for the pair or another suite — pick another"; exit 1;;
esac
# PERSONA LAUNCH P1 (SIWF): the sign-in relay + chain stub — loopback only, the APP only
SIWF_MODE="${PRODLIVE_SIWF:-}"
SIWF_PORT="${PRODLIVE_SIWF_STUB_PORT:-4321}"
SIWF_URL="http://127.0.0.1:$SIWF_PORT"
case "$SIWF_MODE" in ""|stub) ;; *) echo "PRODLIVE_SIWF=$SIWF_MODE is not a mode this launcher runs (only 'stub')"; exit 1;; esac
case "$SIWF_PORT" in 3001|4001|3009|3029|3011|3091|3100|3101|4091|4319|"$APP_PORT"|"$VAL_PORT"|"$STUB_PORT") echo "PRODLIVE_SIWF_STUB_PORT=$SIWF_PORT is pinned for a pair or another stub — pick another"; exit 1;; esac
# POST AS YOU: the Farcaster API + Snapchain stubs — loopback only; the app account on the VALIDATOR, the node hint on the APP
RP_MODE="${PRODLIVE_ROOTPOST:-}"
RP_PORT="${PRODLIVE_ROOTPOST_PORT:-4335}"
RP_HUB_PORT="${PRODLIVE_ROOTPOST_HUB_PORT:-4337}"
RP_URL="http://127.0.0.1:$RP_PORT"
RP_HUB_URL="http://127.0.0.1:$RP_HUB_PORT"
case "$RP_MODE" in ""|stub) ;; *) echo "PRODLIVE_ROOTPOST=$RP_MODE is not a mode this launcher runs (only 'stub': a real key request is the owner's, on the deployed site)"; exit 1;; esac
for p in "$RP_PORT" "$RP_HUB_PORT"; do case "$p" in 3001|4001|3009|3011|3023|3029|3091|3100|3101|4009|4057|4063|4091|4319|4321|"$APP_PORT"|"$VAL_PORT"|"$STUB_PORT"|"$SIWF_PORT") echo "PRODLIVE_ROOTPOST port $p is pinned for a pair or another stub — pick another"; exit 1;; esac; done
[ "$RP_PORT" != "$RP_HUB_PORT" ] || { echo "PRODLIVE_ROOTPOST_PORT and PRODLIVE_ROOTPOST_HUB_PORT must differ"; exit 1; }
RP_BLANK_VAL="FC_APP_FID= FC_APP_CUSTODY_KEY= FC_APP_SPONSOR= FC_KEY_REQUEST_API_URL= FC_KEY_REQUEST_TTL_SEC="
# FOLLOWING FROM THE HUB: the node a signed-in tab reads (the default whenever the sign-in is the stub's)
HUB_MODE="${PRODLIVE_HUB:-}"
if [ -z "$HUB_MODE" ]; then if [ "$SIWF_MODE" = "stub" ] || [ "$RP_MODE" = "stub" ]; then HUB_MODE=stub; else HUB_MODE=off; fi; fi
case "$HUB_MODE" in stub|off) ;; *) echo "PRODLIVE_HUB=$HUB_MODE is not stub or off"; exit 1;; esac
RP_BLANK_APP="FC_ROOT_HUB_URL= FC_APP_CUSTODY_KEY="
# SIGN IN WITH X: the X stub — loopback only; the client id on BOTH processes, the authorize page on the app, the API on the validator
X_MODE="${PRODLIVE_X:-}"
X_PORT="${PRODLIVE_X_STUB_PORT:-4338}"
X_URL="http://127.0.0.1:$X_PORT"
case "$X_MODE" in ""|stub) ;; *) echo "PRODLIVE_X=$X_MODE is not a mode this launcher runs (only 'stub': a real X sign-in is the owner's, on the deployed site)"; exit 1;; esac
case "$X_PORT" in 3001|4001|3009|3011|3023|3029|3091|3100|3101|4009|4057|4063|4091|4319|4321|4335|4337|"$APP_PORT"|"$VAL_PORT"|"$STUB_PORT"|"$SIWF_PORT"|"$RP_PORT"|"$RP_HUB_PORT") echo "PRODLIVE_X_STUB_PORT=$X_PORT is pinned for a pair or another stub — pick another"; exit 1;; esac
X_BLANK_APP="X_CLIENT_ID= X_CLIENT_SECRET= X_SIGNIN= X_SIGNIN_AUTHORIZE_URL="
X_BLANK_VAL="X_CLIENT_ID= X_CLIENT_SECRET= X_SIGNIN= X_SIGNIN_API_URL="

# Kill EVERY listener on a port (IPv4 + IPv6 rows), as a process TREE, and verify. A kill that silently fails leaves
# the next start dying EADDRINUSE against a stale build that is still serving (happened once: the old `next start`
# child survived a single-PID kill). Stop-Process, not taskkill: from this bash taskkill reported "no such pid" on
# live processes and left both servers standing.
kill_pid() { powershell.exe -NoProfile -Command "Stop-Process -Id $1 -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1; }
kill_port() { for pid in $(powershell.exe -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort $1 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" 2>/dev/null | tr -d '\r'); do [ -n "$pid" ] && [ "$pid" != "0" ] && kill_pid "$pid"; done; }
# (no backslash escapes in the PowerShell regex: bash + PowerShell quoting mangled them once and the match silently
# returned nothing)
# FC-READ (house, verify): SCOPED TO THIS REPO. The match used to be every node.exe whose command line said server.js,
# next start or next dev — on this machine that included ANOTHER project's `next dev` (a different repo's dev server
# in another session), which a restart here would have killed. Now: this repo's own supervisor scripts by name
# (scripts/validator-supervisor.mjs, scripts/start-app.mjs — npm runs them with a relative path), and the generic
# names (server.js, next start/dev) only when the command line carries this repo's own path. Compared in forward-slash
# lower case, so neither the path nor the pattern needs a backslash. `next.{0,2}(start|dev)` because the command line
# is `…\next\dist\bin\next" start` (a quote and a space between: the old 'next start' never matched it).
REPO_M="$(cygpath -m "$REPO" 2>/dev/null | tr 'A-Z' 'a-z')"
kill_supervisors() {
  [ -n "$REPO_M" ] || { echo "cannot resolve this repo's Windows path (cygpath) — not killing anything by command line"; return 0; }
  for p in $(powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { \$_.CommandLine -match 'scripts.validator-supervisor.mjs|scripts.start-app.mjs' -or (\$_.CommandLine.Replace([char]92,[char]47).ToLower().Contains('$REPO_M') -and \$_.CommandLine -match 'server.js|next.{0,2}(start|dev)') } | Select-Object -ExpandProperty ProcessId" 2>/dev/null | tr -d '\r'); do kill_pid "$p"; done
}
port_free() { [ -z "$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort $1 -ErrorAction SilentlyContinue).OwningProcess" 2>/dev/null | tr -d '\r')" ]; }
# FC-READ: the stub is asked to stop first (it closes its socket cleanly), then its port is cleared like the pair's
stop_stub() { curl -s -o /dev/null --max-time 5 -X POST "$STUB_URL/__stub/shutdown" 2>/dev/null || true; sleep 1; port_free "$STUB_PORT" || kill_port "$STUB_PORT"; }
stub_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$STUB_URL/__stub/state" 2>/dev/null | grep -q '^200$'; }
siwf_stop() { curl -s -o /dev/null --max-time 5 -X POST "$SIWF_URL/__stub/shutdown" 2>/dev/null || true; sleep 1; port_free "$SIWF_PORT" || kill_port "$SIWF_PORT"; }
siwf_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$SIWF_URL/__stub/state" 2>/dev/null | grep -q '^200$'; }
rp_stop() { curl -s -o /dev/null --max-time 5 -X POST "$RP_URL/__stub/shutdown" 2>/dev/null || true; sleep 1; port_free "$RP_PORT" || kill_port "$RP_PORT"; port_free "$RP_HUB_PORT" || kill_port "$RP_HUB_PORT"; }
rp_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$RP_URL/__stub/state" 2>/dev/null | grep -q '^200$'; }
x_stop() { curl -s -o /dev/null --max-time 5 -X POST "$X_URL/__stub/shutdown" 2>/dev/null || true; sleep 1; port_free "$X_PORT" || kill_port "$X_PORT"; }
x_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$X_URL/__stub/state" 2>/dev/null | grep -q '^200$'; }
relay_status() { curl -s --max-time 60 -X POST -H 'content-type: application/json' -H 'x-layers-relay: 1' --data '{"op":"status"}' "$BASE/api/fc/read" 2>/dev/null; }

if [ "$RESTART" = "1" ]; then
  kill_supervisors; kill_port "$APP_PORT"; kill_port "$VAL_PORT"
  for i in $(seq 1 20); do port_free "$APP_PORT" && port_free "$VAL_PORT" && break; kill_port "$APP_PORT"; kill_port "$VAL_PORT"; sleep 1; done
  port_free "$APP_PORT" && port_free "$VAL_PORT" || { echo "PORTS STILL HELD after kill — refusing to start over a stale server"; exit 1; }
  # FC-READ: a stub from an earlier run never outlives a restart (a default-mode pair must not find one answering)
  stop_stub
  port_free "$STUB_PORT" || { echo "PORT $STUB_PORT STILL HELD after stopping the Neynar stub — refusing to start"; exit 1; }
  siwf_stop; port_free "$SIWF_PORT" || { echo "PORT $SIWF_PORT STILL HELD after stopping the SIWF stub — refusing to start"; exit 1; }
  rp_stop; { port_free "$RP_PORT" && port_free "$RP_HUB_PORT"; } || { echo "PORT $RP_PORT or $RP_HUB_PORT STILL HELD after stopping the post-as-you stub — refusing to start"; exit 1; }
  x_stop; port_free "$X_PORT" || { echo "PORT $X_PORT STILL HELD after stopping the X stub — refusing to start"; exit 1; }
fi
if [ "$BUILD" = "1" ]; then
  for i in 1 2 3 4 5 6 7 8; do rm -rf .next 2>/dev/null; [ -d .next ] || break; sleep 5; done
  [ -d .next ] && echo "WARN: .next still present after retries"
  # NEXT_PUBLIC_* are inlined at build time: name the pinned validator explicitly here too
  env NEXT_PUBLIC_VALIDATOR_URL="$VBASE" npm run build > "$OUT/build.txt" 2>&1; echo "BUILD_EXIT=$?" >> "$OUT/build.txt"
  if ! grep -q "BUILD_EXIT=0" "$OUT/build.txt" && grep -q "EINVAL" "$OUT/build.txt"; then
    echo "build hit the OneDrive lock — retrying once"; sleep 15; rm -rf .next 2>/dev/null
    env NEXT_PUBLIC_VALIDATOR_URL="$VBASE" npm run build > "$OUT/build.txt" 2>&1; echo "BUILD_EXIT=$?" >> "$OUT/build.txt"
  fi
  grep -q "BUILD_EXIT=0" "$OUT/build.txt" || { echo "BUILD FAILED"; tail -30 "$OUT/build.txt"; exit 1; }
fi
if [ "$RESTART" = "1" ]; then
  [ -f .keystore/fixture-roster.json ] || node validator/export-roster.js .keystore/fixture-roster.json 2>/dev/null || true
  : > "$LOGDIR/layers-validator.log"
  if [ "$FC_MODE" = "stub" ]; then
    # FC-READ: a fresh FAKE key per start (the stub refuses one without its prefix, so a real key can never be served
    # back by its /__stub/state), handed to the stub through its environment (never argv) and to the app alone
    STUB_KEY="$(node scripts/lib/neynar-stub.mjs make-key)" && DENY_HASH="$(node scripts/lib/neynar-stub.mjs deny-hash)" \
      && FIDS="$(node scripts/lib/neynar-stub.mjs fids)" && [ -n "$FIDS" ] \
      && HOUSE_FID="$(node scripts/lib/neynar-stub.mjs house-fid)" && [ -n "$HOUSE_FID" ] \
      || { echo "cannot read the stub's key, deny hash, discovery fids or house fid from scripts/lib/neynar-stub.mjs"; exit 1; }
    : > "$LOGDIR/layers-neynar-stub.log"
    (env NEYNAR_STUB_KEY="$STUB_KEY" node scripts/lib/neynar-stub.mjs serve --port "$STUB_PORT" > "$LOGDIR/layers-neynar-stub.log" 2>&1 &)
    for i in $(seq 1 20); do stub_up && break; sleep 0.5; done
    stub_up || { echo "THE NEYNAR STUB DID NOT START on $STUB_PORT"; tail -5 "$LOGDIR/layers-neynar-stub.log"; exit 1; }
    # FC-READ (no channels): the discovery author list is the stub's (the relay has no default); the retired
    # FC_READ_CHANNELS is blanked by name. FC-READ (house): exactly ONE source — the other is blanked by name, so
    # neither .env.local nor the calling shell can hand the app both (both set is bad_config)
    if [ "$FC_SOURCE" = "house" ]; then SOURCE_ENV="FC_READ_HOUSE_FID=$HOUSE_FID FC_READ_FIDS="; else SOURCE_ENV="FC_READ_FIDS=$FIDS FC_READ_HOUSE_FID="; fi
    APP_ENV="$SRV_ENV FC_READ_RIG=stub NEYNAR_READ_API_KEY=$STUB_KEY NEYNAR_READ_BASE_URL=$STUB_URL/v2/farcaster FC_READ_DENY=$DENY_HASH $SOURCE_ENV FC_READ_CHANNELS="
    echo "neynar stub: $STUB_URL (fake key, loopback base URL, denylist, discovery source: $FC_SOURCE) → the app only"
  fi
  # PERSONA LAUNCH P1 (SIWF): the relay/RPC overrides reach the APP only; default mode blanks them by name
  APP_ENV="$APP_ENV FC_SIWF= FC_SIWF_RELAY_URL= FC_SIWF_RPC_URL="
  # PUBLIC GO-LIVE (F1): the anonymous universe hint (live, or blanked by name)
  APP_ENV="$APP_ENV $UNIVERSE_APP"
  # ADS, PHASE 1: the ads switch (on, or blanked by name: dormant)
  APP_ENV="$APP_ENV $ADS_APP"
  # NEYNAR AS A SWITCH: the source switches (the caller's list, or all six blanked by name: network everywhere)
  APP_ENV="$APP_ENV $FCS_APP"
  if [ "$SIWF_MODE" = "stub" ]; then
    : > "$LOGDIR/layers-siwf-stub.log"
    (node scripts/lib/siwf-stub.mjs serve --port "$SIWF_PORT" > "$LOGDIR/layers-siwf-stub.log" 2>&1 &)
    for i in $(seq 1 20); do siwf_up && break; sleep 0.5; done
    siwf_up || { echo "THE SIWF STUB DID NOT START on $SIWF_PORT"; tail -5 "$LOGDIR/layers-siwf-stub.log"; exit 1; }
    APP_ENV="$APP_ENV FC_SIWF_RELAY_URL=$SIWF_URL FC_SIWF_RPC_URL=$SIWF_URL"
    echo "siwf stub: $SIWF_URL (loopback relay + JSON-RPC) → the app only"
  fi
  # POST AS YOU: the app account and the stubs (or every name blanked)
  VAL_ENV="$VAL_ENV $RP_BLANK_VAL"
  APP_ENV="$APP_ENV $RP_BLANK_APP"
  if [ "$RP_MODE" = "stub" ] || [ "$HUB_MODE" = "stub" ]; then
    RP_KEY="$(node scripts/lib/farcaster-api-stub.mjs app-key)" && RP_FID="$(node scripts/lib/farcaster-api-stub.mjs app-fid)" && [ -n "$RP_KEY" ] && [ -n "$RP_FID" ] \
      || { echo "cannot read the post-as-you stub's test app account from scripts/lib/farcaster-api-stub.mjs"; exit 1; }
    GRAPH_ARG=""; [ "$HUB_MODE" = "stub" ] && GRAPH_ARG="--graph default"
    : > "$LOGDIR/layers-rootpost-stub.log"
    (node scripts/lib/farcaster-api-stub.mjs serve --port "$RP_PORT" --hub-port "$RP_HUB_PORT" --app-fid "$RP_FID" $GRAPH_ARG > "$LOGDIR/layers-rootpost-stub.log" 2>&1 &)
    for i in $(seq 1 20); do rp_up && break; sleep 0.5; done
    rp_up || { echo "THE POST-AS-YOU STUB DID NOT START on $RP_PORT"; tail -5 "$LOGDIR/layers-rootpost-stub.log"; exit 1; }
    APP_ENV="$APP_ENV FC_ROOT_HUB_URL=$RP_HUB_URL"
    if [ "$RP_MODE" = "stub" ]; then
      VAL_ENV="$VAL_ENV FC_APP_FID=$RP_FID FC_APP_CUSTODY_KEY=$RP_KEY FC_KEY_REQUEST_API_URL=$RP_URL FC_HUB_URL=$RP_HUB_URL"
      echo "post-as-you stub: $RP_URL (Farcaster key request API) + $RP_HUB_URL (Snapchain node); test app account fid $RP_FID → the validator; the node hint → the app"
    else
      echo "hub stub: $RP_HUB_URL (a loopback Snapchain node, the default graph; the validator is NOT armed) → the app's node hint"
    fi
  fi
  # SIGN IN WITH X: the stub's public test client id on both processes (or every name blanked on both)
  VAL_ENV="$VAL_ENV $X_BLANK_VAL"
  APP_ENV="$APP_ENV $X_BLANK_APP"
  if [ "$X_MODE" = "stub" ]; then
    X_CID="$(node scripts/lib/x-api-stub.mjs client-id)" && [ -n "$X_CID" ] || { echo "cannot read the X stub's test client id from scripts/lib/x-api-stub.mjs"; exit 1; }
    : > "$LOGDIR/layers-x-stub.log"
    (node scripts/lib/x-api-stub.mjs serve --port "$X_PORT" --redirect "$BASE/welcome/x" > "$LOGDIR/layers-x-stub.log" 2>&1 &)
    for i in $(seq 1 20); do x_up && break; sleep 0.5; done
    x_up || { echo "THE X STUB DID NOT START on $X_PORT"; tail -5 "$LOGDIR/layers-x-stub.log"; exit 1; }
    APP_ENV="$APP_ENV X_CLIENT_ID=$X_CID X_SIGNIN_AUTHORIZE_URL=$X_URL/i/oauth2/authorize"
    VAL_ENV="$VAL_ENV X_CLIENT_ID=$X_CID X_SIGNIN_API_URL=$X_URL"
    echo "x stub: $X_URL (loopback X OAuth 2.0 + API; test client id; callback $BASE/welcome/x) → the authorize page to the app, the API to the validator"
  fi
  (env $VAL_ENV npm run validator:supervised > "$LOGDIR/layers-validator.log" 2>&1 &)
  (env $APP_ENV npm run start > "$LOGDIR/layers-app.log" 2>&1 &)
  up=0
  for i in $(seq 1 60); do
    v=$(node scripts/lib/health-probe.mjs "$VBASE" layers-validator 2>/dev/null); vc=$?
    a=$(node scripts/lib/health-probe.mjs "$BASE" layers "--peer=$VBASE" 2>/dev/null); ac=$?
    if [ "$vc" = "0" ] && [ "$ac" = "0" ]; then up=1; echo "validator: $v"; echo "app: $a"; break; fi
    sleep 2
  done
  [ "$up" = "1" ] || { echo "START FAILED"; tail -20 "$LOGDIR/layers-app.log"; tail -10 "$LOGDIR/layers-validator.log"; exit 1; }
  # the SHAPE, asserted rather than assumed: a public deployment refuses the dev registry. A 200 here means the
  # pair came up as the rig (ZK_DEV_HOOKS leaked in from the calling shell), and every suite after would measure
  # the wrong thing.
  dev=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "$BASE/api/dev")
  [ "$dev" = "403" ] || { echo "NOT PRODUCTION-SHAPED: /api/dev answered $dev (expected 403)"; exit 1; }
  echo "shape: public (/api/dev 403, dev hooks off, signatures required)"
  # FC-READ: the relay's arming, asserted rather than assumed — unarmed by default (a read key in .env.local must not
  # reach this pair), armed on the stub under PRODLIVE_FC_READ=stub (every relay suite after would otherwise measure
  # the seed fallback and pass for the wrong reason)
  rs="$(relay_status)"
  if [ "$FC_MODE" = "stub" ]; then
    echo "$rs" | grep -q '"armed":true' || { echo "NOT STUB-SHAPED: the relay did not arm on the stub (status: $(echo "$rs" | cut -c1-200); source: $FC_SOURCE)"; exit 1; }
    echo "relay: armed on the loopback stub (discovery source: $FC_SOURCE)"
  else
    echo "$rs" | grep -q '"armed":false' || { echo "NOT PRODUCTION-SHAPED: the read relay is not unarmed with the key blanked (status: $(echo "$rs" | cut -c1-200))"; exit 1; }
    echo "relay: unarmed ($(echo "$rs" | sed -n 's/.*"reason":"\([a-z_]*\)".*/\1/p'))"
  fi
  # PUBLIC GO-LIVE (F1): the universe hint, asserted from the server-rendered /anon (its flight data escapes the quotes)
  anon_html="$(curl -s --max-time 120 "$BASE/anon")"
  if [ "$EXPECT_UNIVERSE" = "live" ]; then
    echo "$anon_html" | grep -Eq 'ZK_ANON_UNIVERSE[\\"]*:[\\"]*live' || { echo "NOT UNIVERSE-SHAPED: the app holds ZK_ANON_UNIVERSE=live but /anon hands tabs no live hint (a build without lib/device/deviceEnv.server.ts's anonUniverseHints spread?)"; exit 1; }
    echo "universe: live (/anon hands every tab ZK_ANON_UNIVERSE=live)"
  else
    if echo "$anon_html" | grep -q 'ZK_ANON_UNIVERSE'; then echo "NOT PRODUCTION-SHAPED: /anon carries a universe hint on a pair that set none"; exit 1; fi
    echo "universe: unset (no hint on /anon)"
  fi
  # SIGN IN WITH X: the arming, asserted rather than assumed — the validator's relay and the tab hint, both ways
  xcfg="$(curl -s --max-time 30 "$VBASE/x/signin/config")"
  welcome_html="$(curl -s --max-time 120 "$BASE/welcome")"
  if [ "$X_MODE" = "stub" ]; then
    echo "$xcfg" | grep -q '"ready":true' || { echo "NOT X-STUB-SHAPED: the validator's Sign in with X relay is not armed (config: $(echo "$xcfg" | cut -c1-200))"; exit 1; }
    echo "$welcome_html" | grep -Eq 'X_SIGNIN[\\"]*:[\\"]*on' || { echo "NOT X-STUB-SHAPED: /welcome hands tabs no X_SIGNIN=on hint (a build without lib/device/deviceEnv.server.ts's xSigninDeviceHints spread?)"; exit 1; }
    echo "x sign-in: armed on the loopback stub (relay ready; /welcome hands every tab X_SIGNIN=on)"
  else
    echo "$xcfg" | grep -q '"ready":false' || { echo "NOT PRODUCTION-SHAPED: the Sign in with X relay is armed on a pair that set no client id (config: $(echo "$xcfg" | cut -c1-200))"; exit 1; }
    if echo "$welcome_html" | grep -q 'X_SIGNIN'; then echo "NOT PRODUCTION-SHAPED: /welcome carries an X_SIGNIN hint on a pair that set no client id"; exit 1; fi
    echo "x sign-in: dormant (no client id on either process; Continue with X says Soon)"
  fi
  # ADS, PHASE 1: the switch, asserted from the server-rendered /welcome both ways (its flight data escapes the quotes)
  if [ "$EXPECT_ADS" = "on" ]; then
    echo "$welcome_html" | grep -Eq '[\\"]ADS[\\"]*:[\\"]*on' || { echo "NOT ADS-SHAPED: the app holds ADS=on but /welcome hands tabs no ADS=on hint (a build without lib/device/deviceEnv.server.ts's adsDeviceHints spread?)"; exit 1; }
    echo "ads: on (/welcome hands every tab ADS=on)"
  else
    if echo "$welcome_html" | grep -Eq '[\\"]ADS[\\"]*:'; then echo "NOT PRODUCTION-SHAPED: /welcome carries an ADS hint on a pair that set no ADS"; exit 1; fi
    echo "ads: dormant (no ADS on the app; no hint on /welcome)"
  fi
  # NEYNAR AS A SWITCH: the source hints, asserted from /welcome both ways — exactly the For You / search switches that ask
  # for Neynar, and NEVER a Following, notifications, counts or channels hint (the hard rule: the tab has no Neynar path)
  for n in FC_SOURCE_FOLLOWING FC_SOURCE_NOTIFICATIONS FC_SOURCE_COUNTS FC_SOURCE_CHANNELS; do
    if echo "$welcome_html" | grep -Eq "[\\\\\"]$n[\\\\\"]*:"; then echo "NOT PRODUCTION-SHAPED: /welcome hands tabs a $n hint (that surface is network-only and is never forwarded)"; exit 1; fi
  done
  for n in FC_SOURCE_FORYOU FC_SOURCE_SEARCH; do
    want="$(echo "$FCS_HINTS" | tr ' ' '\n' | grep "^$n:" | cut -d: -f2)"
    if [ -n "$want" ]; then
      echo "$welcome_html" | grep -Eq "[\\\\\"]$n[\\\\\"]*:[\\\\\"]*$want" || { echo "NOT SOURCE-SHAPED: the app holds $n=$want but /welcome hands tabs no such hint (a build without lib/device/deviceEnv.server.ts's fcSourceDeviceHints spread?)"; exit 1; }
    elif echo "$welcome_html" | grep -Eq "[\\\\\"]$n[\\\\\"]*:"; then echo "NOT PRODUCTION-SHAPED: /welcome carries a $n hint on a pair whose $n asks for no Neynar"; exit 1; fi
  done
  echo "fc sources: ${PRODLIVE_FC_SOURCES:-all network (blanked)}; hints on /welcome:${FCS_HINTS:- none}"
  # warm the server-rendered shells (curl runs no device, so it mints no root)
  for u in /home /explore /settings /settings/zk; do curl -s -o /dev/null --max-time 120 "$BASE$u" || true; done
fi
# FC-READ: in stub mode the suites learn where the stub is, and that the relay is expected armed
# PERSONA LAUNCH GO-LIVE: the suites learn the anonymous tree the pair runs (smoke-deployed check 10 expects it)
SUITE_ENV="BASE_URL=$BASE VALIDATOR_URL=$VBASE EXPECT_ANON_TREE=$ANON_TREE EXPECT_PUBLIC_LIVE=$EXPECT_LIVE EXPECT_ANON_UNIVERSE=$EXPECT_UNIVERSE EXPECT_ADS=$EXPECT_ADS EXPECT_FC_SOURCES=$EXPECT_FC_SOURCES"
# FC-READ (house): and which discovery source the pair was started with (on --no-restart, the caller's value: pass the
# same one the pair was started with — accept-fcread check 5 fails a pair whose reads came from the other source)
if [ "$FC_MODE" = "stub" ]; then SUITE_ENV="$SUITE_ENV NEYNAR_STUB_URL=$STUB_URL EXPECT_FC_READ=${EXPECT_FC_READ:-armed} PRODLIVE_FC_READ_SOURCE=$FC_SOURCE"; fi
if [ "$SIWF_MODE" = "stub" ]; then SUITE_ENV="$SUITE_ENV SIWF_STUB_URL=$SIWF_URL EXPECT_SIWF_RELAY_HOST=127.0.0.1:$SIWF_PORT EXPECT_SIWF_RPC_HOST=127.0.0.1:$SIWF_PORT"; fi
# POST AS YOU: where the stub is, and that the app account is expected armed
if [ "$RP_MODE" = "stub" ]; then SUITE_ENV="$SUITE_ENV ROOTPOST_STUB_URL=$RP_URL ROOTPOST_HUB_URL=$RP_HUB_URL EXPECT_ROOT_POST=armed"; else SUITE_ENV="$SUITE_ENV EXPECT_ROOT_POST=unset"; fi
# FOLLOWING FROM THE HUB: where the node a signed-in tab reads is, and its steering
if [ "$HUB_MODE" = "stub" ]; then SUITE_ENV="$SUITE_ENV HUB_STUB_URL=$RP_URL HUB_URL=$RP_HUB_URL EXPECT_HUB=stub"; else SUITE_ENV="$SUITE_ENV EXPECT_HUB=off"; fi
# SIGN IN WITH X: where the X stub is, and that the sign-in is expected armed
if [ "$X_MODE" = "stub" ]; then SUITE_ENV="$SUITE_ENV X_STUB_URL=$X_URL EXPECT_X_SIGNIN=armed"; else SUITE_ENV="$SUITE_ENV EXPECT_X_SIGNIN=unset"; fi
# FC-READ (review): the secrets audit (scripts/audit-secrets.mjs, run by accept-cu4 check 4) must be able to LOOK for the
# key the app held. In stub mode the app held the stub's fake key and its log says "[fc-read] armed", but .env.local has
# no NEYNAR_READ_API_KEY — so the audit could only say COULD NOT RUN (exit 2) and cu4 check 4 failed every stub run. The
# audit also learns a required secret from its own environment, so the fake key rides the environment of the suites
# that run the audit, and ONLY those: accept-cu6's throwaway processes inherit the suite environment with no blanking of
# this name, so there a public validator would refuse to boot on it (VALIDATOR_REFUSES) and a throwaway app would arm
# the relay against the REAL base URL. accept-cu4's probes and accept-fcread's side apps blank it by name. On
# --no-restart the key is read back from the running stub (its /__stub/state serves only a key with the fake prefix);
# the value is never printed.
AUDIT_ENV=""
if [ "$FC_MODE" = "stub" ]; then
  if [ -z "${STUB_KEY:-}" ]; then
    STUB_KEY="$(curl -s --max-time 10 "$STUB_URL/__stub/state" 2>/dev/null | node -e '
      let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
        let k = ""; try { k = String(JSON.parse(t).key || ""); } catch {}
        if (!/^fcread-stub-[A-Za-z0-9-]{4,68}$/.test(k)) process.exit(1);
        process.stdout.write(k);
      });')" || STUB_KEY=""
  fi
  [ -n "$STUB_KEY" ] || { echo "PRODLIVE_FC_READ=stub: cannot read the running stub's fake key from $STUB_URL/__stub/state (is the stub-mode pair up? start it without --no-restart)"; exit 1; }
  AUDIT_ENV="NEYNAR_READ_API_KEY=$STUB_KEY"
fi
for s in "$@"; do
  name="${s##*/}"; name="${name%.mjs}"; name="${name#test:}"
  # FC-READ (review): the suites that run the secrets audit (named above) get the fake key; no other suite does
  EXTRA_ENV=""
  case "$name" in cu4|accept-cu4|audit-secrets) EXTRA_ENV="$AUDIT_ENV";; esac
  if [ -f "$s" ]; then env $SUITE_ENV $EXTRA_ENV node "$s" > "$OUT/$name.txt" 2>&1; else env $SUITE_ENV $EXTRA_ENV npm run "$s" > "$OUT/$name.txt" 2>&1; fi
  code=$?; echo "EXIT=$code" >> "$OUT/$name.txt"
  printf '  %-12s exit=%s  %s\n' "$name" "$code" "$(grep -E 'checks passed|PASSED|FAILED|ROOT-LEAK|# (pass|fail)' "$OUT/$name.txt" | tail -1)"
  grep -E '^  (FAIL|INFRA|ABORT)' "$OUT/$name.txt" | cut -c1-400
done
echo "--- validator deaths (validator/deaths.log) ---"; tail -3 validator/deaths.log 2>/dev/null || echo "(none)"
# FC-READ: the stub's own verdict over everything the relay sent it this run — a violation fails the launcher even
# when every suite passed (the stub is the only witness of what went upstream)
if [ "$FC_MODE" = "stub" ]; then
  curl -s --max-time 10 "$STUB_URL/__stub/state" | node -e '
    let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
      let s; try { s = JSON.parse(t); } catch { console.log("--- neynar stub: no state (is it still running?) ---"); process.exit(3); }
      const v = s.violations || [];
      console.log("--- neynar stub: " + s.hits.total + " upstream request(s), " + v.length + " violation(s) ---");
      for (const x of v.slice(0, 12)) console.log("  VIOLATION " + x.kind + " " + x.route + (x.detail ? " (" + x.detail + ")" : ""));
      process.exit(v.length ? 1 : 0);
    });' || exit 1
fi
# POST AS YOU: the Farcaster API stub's own verdict (a browser reaching it directly is a violation: only the validator may)
if [ "$RP_MODE" = "stub" ]; then
  curl -s --max-time 10 "$RP_URL/__stub/state" | node -e '
    let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
      let s; try { s = JSON.parse(t); } catch { console.log("--- post-as-you stub: no state ---"); process.exit(3); }
      const v = s.violations || [];
      console.log("--- post-as-you stub: " + s.calls.length + " API request(s), " + s.requests.length + " key request(s), " + (s.hub && s.hub.submits ? s.hub.submits.length : 0) + " hub submit(s), " + v.length + " violation(s) ---");
      for (const x of v.slice(0, 12)) console.log("  VIOLATION " + x.kind + " " + x.path + (x.detail ? " (" + x.detail + ")" : ""));
      process.exit(v.length ? 1 : 0);
    });' || exit 1
fi
# FOLLOWING FROM THE HUB: the node's own verdict over every read a tab made (a preflight, a cookie or a Referer fails it)
if [ "$HUB_MODE" = "stub" ]; then
  curl -s --max-time 10 "$RP_URL/__stub/hub/reads" | node -e '
    let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
      let s; try { s = JSON.parse(t); } catch { console.log("--- hub stub: no read log ---"); process.exit(3); }
      const bad = (s.reads || []).filter((r) => r.cookie || r.referer);
      console.log("--- hub stub: " + (s.reads || []).length + " read(s), at most " + s.maxInFlight + " in flight, " + s.preflights + " preflight(s), " + bad.length + " with a cookie or Referer ---");
      process.exit(s.preflights || bad.length ? 1 : 0);
    });' || exit 1
fi
# PERSONA LAUNCH P1 (SIWF): the sign-in stub's own verdict over everything the browser device sent it this run
if [ "$SIWF_MODE" = "stub" ]; then
  curl -s --max-time 10 "$SIWF_URL/__stub/state" | node -e '
    let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
      let s; try { s = JSON.parse(t); } catch { console.log("--- siwf stub: no state ---"); process.exit(3); }
      const v = s.violations || [];
      console.log("--- siwf stub: " + s.requests.length + " request(s), " + v.length + " violation(s) ---");
      for (const x of v.slice(0, 12)) console.log("  VIOLATION " + x.kind + " " + x.path + (x.detail ? " (" + x.detail + ")" : ""));
      process.exit(v.length ? 1 : 0);
    });' || exit 1
fi
# SIGN IN WITH X: the X stub's own verdict over everything that reached it this run (a browser on the token or API
# endpoints, a preflight, a follows read, a field beyond the three) — and every token it issued must have been revoked
if [ "$X_MODE" = "stub" ]; then
  curl -s --max-time 10 "$X_URL/__stub/state" | node -e '
    let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
      let s; try { s = JSON.parse(t); } catch { console.log("--- x stub: no state ---"); process.exit(3); }
      const v = s.violations || [];
      const alive = (s.tokens.issued || 0) - (s.tokens.revoked || 0);
      console.log("--- x stub: " + s.authorizes + " authorize page(s), " + s.tokenCalls + " token call(s), " + s.tokens.issued + " token(s) issued, " + s.tokens.revoked + " revoked, " + s.usersMe + " users/me, " + v.length + " violation(s) ---");
      for (const x of v.slice(0, 12)) console.log("  VIOLATION " + x.kind + " " + x.path + (x.detail ? " (" + x.detail + ")" : ""));
      if (alive) console.log("  " + alive + " token(s) were never revoked");
      process.exit(v.length || alive ? 1 : 0);
    });' || exit 1
fi
