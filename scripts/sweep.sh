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
BASE="${BASE_URL:-http://localhost:${LAYERS_APP_PORT:-3001}}"
DETAIL="${DETAIL:-/tmp/sweep-detail.txt}"
SUITES="test:validator functional test:accept test:g1 test:g2 test:g3 test:substrate test:rootleak test:m1 test:m2 test:m3 test:m4 test:a1 test:a2 test:a3 test:a4 test:a5 test:a6 test:b0"

fails=0
infra=0
total=0

emit() { printf '  run%s %-11s %-6s %s\n' "$run" "$1" "$2" "$3"; }

# Warm-up before the first run only. The mocks inject 200-1500ms per adapter
# call BY DESIGN and a full /home render makes many of them, so the first cold
# render takes 7-9s. Suites that assert on rendered pages race that, which made
# run 1 differ from runs 2-4 for reasons unrelated to the product. Warming once
# makes the four runs measure the same thing.
if [ "$run" = "1" ]; then
  for u in /api/dev /home /explore /notifications "/search?q=restaking"; do
    curl -s -o /dev/null --max-time 120 "$BASE$u" || true
  done
fi

for t in $SUITES; do
  name="${t#test:}"

  # Cheap liveness probe between suites — NOT /home, which legitimately takes
  # seconds and whose slowness would masquerade as a dead server.
  if ! curl -s -o /dev/null --max-time 15 "$BASE/api/dev"; then
    emit "$name" "INFRA" "app server unreachable - CANNOT TEST"
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
  else
    mark="ok"
  fi
  emit "$name" "$mark" "$line"
done

printf '  run%s TOTAL: %s passing checks, %s failed suites, %s infra\n' "$run" "$total" "$fails" "$infra"
[ "$fails" -gt 0 ] && exit 1
[ "$infra" -gt 0 ] && exit 2
exit 0
