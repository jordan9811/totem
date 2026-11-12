#!/usr/bin/env bash
# Run the suites that failed intermittently and record the EXACT failing
# assertion each time, so a scattered failure pattern can be diagnosed rather
# than dismissed as noise.
runs=${1:-6}
: > /tmp/flakes.txt
for i in $(seq 1 "$runs"); do
  for t in test:accept test:g1 test:g2 test:g3 test:m3; do
    out=$(npm run "$t" 2>&1)
    code=$?
    if [ $code -ne 0 ]; then
      echo "$out" | grep -E "^  (FAIL|INFRA) " | sed "s/^/[run$i ${t#test:}] /" >> /tmp/flakes.txt
    fi
  done
done
echo "--- failures across $runs runs ---"
cat /tmp/flakes.txt
echo "--- frequency ---"
sed -E 's/\[run[0-9]+ /[/' /tmp/flakes.txt | sort | uniq -c | sort -rn
