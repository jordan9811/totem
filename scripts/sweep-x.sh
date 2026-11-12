#!/usr/bin/env bash
# One full pass over every suite, printing a single comparable line each.
#
#   exit 0  every suite green
#   exit 1  a product invariant broke
#   exit 2  could not test (server unreachable, or a suite wedged)
#
# Failing assertions are appended to $DETAIL so a scattered pattern across
# runs can be diagnosed rather than dismissed as noise.
set -u

run="${1:-1}"
# Attestation pass Gate 0: PINNED ports (lib/ports.ts defaults), and the
# suite list can be overridden for the runner's own regression test.
BASE="${BASE_URL:-http://localhost:${LAYERS_APP_PORT:-3001}}"
VBASE="${VALIDATOR_URL:-http://localhost:${LAYERS_VALIDATOR_PORT:-4001}}"
DETAIL="${DETAIL:-/tmp/sweep-detail.txt}"
PROBE="node scripts/lib/health-probe.mjs"
SUITES="${SUITES_OVERRIDE:-test:validator functional test:accept test:g1 test:g2 test:g3 test:substrate test:rootleak test:m1 test:m2 test:m3 test:m4 test:a1 test:a2 test:a3 test:a4 test:a5 test:a6 test:b0 test:b1 test:b2 test:b3 test:b4 test:x0 test:x1 test:x2 test:x3 test:x4 test:ux0 test:ux1 test:ux2 test:ux3 test:ux4 test:calla test:fc2 test:fc3 test:fc4 test:fc5 test:c0 test:c1 test:c2 test:c3 test:c4 test:bp test:z0 test:z1 test:z2 test:z3 test:z4 test:z5 test:z6 test:z7 test:z8 test:z9 test:runner test:att1 test:att2 test:att3 test:att4 test:fid0 test:fid1 test:fid2 test:fid3 test:fid4 test:fid5 test:anon-reveal test:m2g1 test:m2g2 test:m2g3 test:m2g4 test:m2g5 test:m2g6 test:m2g7 test:m2g8 test:cu2 test:cu3 test:device test:no-keystore test:device-restart test:pd0 test:pd1 test:pd2 test:pd3 test:pd4 test:help test:fc-buttons test:connect test:siwf test:siwf-unit test:x5 test:x-unit test:ns-sizes test:anon-slots test:anon-slots-unit test:linkage6 test:rings test:rings-unit test:reach test:reach-unit test:launch test:launch-unit test:prover-unit test:x-outbox test:x-outbox-unit test:runbook-unit test:onboard-unit test:anon-relay-unit test:miniapp-unit test:lockfile}"

fails=0
infra=0
total=0

emit() { printf '  run%s %-11s %-6s %s\n' "$run" "$1" "$2" "$3"; }

# THE LIVENESS CONTRACT (Attestation pass Gate 0). Both processes must answer
# the SIGNED Totem health payload before anything runs; a server on the port
# that answers anything else is DOWN and the runner REFUSES to launch. ZK Pass
# 2's closing sweeps ran fifteen suites against another project's server
# because a 404 on the port used to read as alive.
app_h="$($PROBE "$BASE" layers "--peer=$VBASE")" || {
  emit runner INFRA "REFUSED: app on $BASE is not Totem ($app_h) - CANNOT TEST"
  printf '  run%s TOTAL: 0 passing checks, 0 failed suites, 1 infra\n' "$run"
  exit 2
}
val_h="$($PROBE "$VBASE" layers-validator)" || {
  emit runner INFRA "REFUSED: validator on $VBASE is not Totem ($val_h) - CANNOT TEST"
  printf '  run%s TOTAL: 0 passing checks, 0 failed suites, 1 infra\n' "$run"
  exit 2
}
printf '  run%s runner: app %s; validator %s\n' "$run" "$app_h" "$val_h"

# Warm-up before the first run only. The mocks inject 200-1500ms per adapter
# call BY DESIGN and a full /home render makes many of them, so the first cold
# render takes 7-9s. Suites that assert on rendered pages race that, which made
# run 1 differ from runs 2-4 for reasons unrelated to the product. Warming once
# makes the four runs measure the same thing.
if [ "$run" = "1" ]; then
  for u in /api/dev /home /explore /notifications "/search?q=restaking" /market/reads /messages /curators/desk /settings/import-x /settings/attestations; do
    curl -s -o /dev/null --max-time 120 "$BASE$u" || true
  done
fi

for t in $SUITES; do
  name="${t#test:}"

  # Liveness between suites: the SIGNED contract again (not /home, whose
  # legitimate slowness would masquerade as a dead server). A foreign server
  # that answers on the port is DOWN, never alive.
  if ! why="$($PROBE "$BASE" layers)"; then
    emit "$name" "INFRA" "app server is not Totem ($why) - CANNOT TEST"
    infra=$((infra + 1))
    continue
  fi

  out="$(timeout 900 npm run "$t" 2>&1)"
  code=$?

  if [ "$code" -eq 124 ]; then
    emit "$name" "INFRA" "suite exceeded 900s - CANNOT TEST"
    infra=$((infra + 1))
    continue
  fi

  if [ "$code" -ne 0 ]; then
    printf '%s\n' "$out" | grep -E '^  (FAIL|INFRA) ' | sed "s|^|    run$run $name |" >> "$DETAIL"
  fi

  line="$(printf '%s\n' "$out" | grep -E '^[0-9]+/[0-9]+ .*passed|passed, [0-9]+ FAILED|^. pass [0-9]+|ALL FUNCTIONAL|ROOT-LEAK' | tail -1)"
  n="$(printf '%s\n' "$out" | grep -cE '^  PASS ')"
  total=$((total + n))

  if [ "$code" -eq 1 ]; then
    fails=$((fails + 1)); mark="FAIL"
  elif [ "$code" -eq 2 ]; then
    infra=$((infra + 1)); mark="INFRA"
  elif [ "$code" -ne 0 ]; then
    # NEVER silently green. A suite that dies on any other code (crash, OOM,
    # npm failure) used to fall through to "ok" with an empty summary — a
    # dead app server once produced fifteen such false greens in one sweep.
    infra=$((infra + 1)); mark="INFRA"; line="suite exited $code with no verdict - CANNOT TEST"
  else
    mark="ok"
  fi
  emit "$name" "$mark" "$line"
done

printf '  run%s TOTAL: %s passing checks, %s failed suites, %s infra\n' "$run" "$total" "$fails" "$infra"
[ "$fails" -gt 0 ] && exit 1
[ "$infra" -gt 0 ] && exit 2
exit 0
