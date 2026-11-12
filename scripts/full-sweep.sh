#!/usr/bin/env bash
# One full pass over every suite. Prints a single line per suite so N
# consecutive runs are comparable at a glance.
# Exit 1 = a product invariant broke. Exit 2 = could not test.
run=$1
fails=0
infra=0
total=0
# Warm-up. The mocks inject 200-1500ms per adapter call BY DESIGN, and a full
# /home render makes many of them, so a cold first render takes 7-9s. Suites
# that assert on rendered pages race that, which made run 1 of a sweep set
# look different from runs 2-4 for reasons that have nothing to do with the
# product. Warming once makes the four runs measure the same thing.
if [ "$run" = "1" ]; then
  for u in /api/dev /home /explore /notifications /search?q=restaking; do
    curl -s -o /dev/null --max-time 90 "http://localhost:${LAYERS_APP_PORT:-3001}$u" || true
  done
fi
for t in test:validator functional test:accept test:g1 test:g2 test:g3 test:substrate test:rootleak test:m1 test:m2 test:m3 test:m4; do
  name=${t#test:}
  # Health probe between suites. When the app server dies mid-sweep (it slept
  # overnight once), every remaining suite either hangs or reports invented
  # product failures. Catching it here reports one honest INFRA instead.
  if ! curl -s -o /dev/null --max-time 10 "http://localhost:${LAYERS_APP_PORT:-3001}/api/dev"; then
    printf "  run%s %-12s %-6s %s
" "$run" "$name" "INFRA" "app server unreachable — CANNOT TEST"
    infra=$((infra+1)); continue
  fi
  # Per-suite wall clock, so one wedged suite cannot stall the whole run.
  out=$(timeout 900 npm run "$t" 2>&1)
  code=$?
  if [ $code -eq 124 ]; then
    printf "  run%s %-12s %-6s %s
" "$run" "$name" "INFRA" "suite exceeded 900s — CANNOT TEST"
    infra=$((infra+1)); continue
  fi
  if [ $code -ne 0 ]; then
    echo "$out" | grep -E "^  (FAIL|INFRA) " | sed "s|^|    run$run $name |" >> /tmp/sweep-detail.txt
  fi
  line=$(echo "$out" | grep -E "^[0-9]+/[0-9]+ .*passed|passed, [0-9]+ FAILED|^ℹ pass [0-9]+|ALL FUNCTIONAL|ROOT-LEAK" | tail -1)
  n=$(echo "$out" | grep -cE "^  PASS ")
  total=$((total + n))
  if [ $code -eq 1 ]; then fails=$((fails+1)); mark="FAIL"; 
  elif [ $code -eq 2 ]; then infra=$((infra+1)); mark="INFRA";
  else mark="ok"; fi
  printf "  run%s %-12s %-6s %s\n" "$run" "$name" "$mark" "$line"
done
echo "  run$run TOTAL: $total passing checks, $fails failed suites, $infra infra"
[ $fails -gt 0 ] && exit 1
[ $infra -gt 0 ] && exit 2
exit 0
