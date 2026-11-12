#!/usr/bin/env bash
# Runs the complete suite N times, restarting the Next dev server between
# runs. A single long-lived dev server accumulates HMR state and eventually
# throws React context errors from inside next's own runtime — a dev-server
# durability problem, not a product signal. Restarting isolates the product.
#
# Spawning Next from a Node child_process proved unreliable on Windows here
# (the child dies with stdio ignored); nohup from bash is what actually works.
#
# Requires a production build first: npx next build.
set -u
RUNS="${1:-4}"
PORT="${LAYERS_APP_PORT:-3001}"
LOG=/tmp/stability-next.log
GREEN=0

port_pids() {
  netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $NF}' | sort -u
}

# Kill and VERIFY. A kill that silently fails leaves the next start failing
# with EADDRINUSE, which the harness then misreports as "next did not come
# up" — infrastructure noise dressed up as a result.
kill_port() {
  local attempt=0
  while [ $attempt -lt 10 ]; do
    local pids
    pids=$(port_pids)
    [ -z "$pids" ] && return 0
    for p in $pids; do
      taskkill //F //PID "$p" >/dev/null 2>&1 || true
    done
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "        (WARNING: port $PORT still held by: $(port_pids))"
  return 1
}

start_once() {
  # Never spawn a second server onto a held port — that produces EADDRINUSE
  # and an orphan process that outlives the run.
  if [ -n "$(port_pids)" ]; then
    echo "        (port $PORT still held; refusing to spawn a second server)"
    return 1
  fi
  # Production server, not dev. The suites exercise the application, not
  # Next's dev machinery: no HMR, no on-demand compilation, no file watcher
  # holding handles on .next. Both far more stable and a truer target.
  nohup npx next start -p "$PORT" > "$LOG" 2>&1 &
  local deadline=$((SECONDS + 240))
  while [ $SECONDS -lt $deadline ]; do
    if curl -s -o /dev/null -m 5 "http://localhost:$PORT/home"; then
      sleep 3   # let first-route compilation settle
      return 0
    fi
    # Only bail out on a failure that genuinely cannot resolve itself.
    # Bailing on any "Error:" abandons a server that is merely slow to bind,
    # which then holds the port and makes the retry refuse to start — that
    # is what produced a spurious "next did not come up".
    if grep -q "EADDRINUSE\|Cannot find module" "$LOG" 2>/dev/null; then
      return 1
    fi
    sleep 2
  done
  return 1
}

start_next() {
  # This working directory is OneDrive-backed, which holds file handles on
  # .next briefly after a kill; starting immediately fails with EINVAL on
  # readlink. Give it a moment, and if it still fails, clear .next and retry.
  sleep 5
  if start_once; then return 0; fi

  # A previous attempt may have bound the port late. If something is serving
  # now, use it rather than declaring failure.
  if curl -s -o /dev/null -m 5 "http://localhost:$PORT/home"; then
    echo "        (a late-binding server is serving; using it)"
    sleep 2
    return 0
  fi

  echo "        (start failed; rebuilding and retrying)"
  kill_port
  npx next build > /tmp/stability-build.log 2>&1 || true
  sleep 3
  start_once
}

run_suite() {
  local name="$1" cmd="$2"
  local out
  out=$(eval "$cmd" 2>&1)
  local code=$?
  local summary
  summary=$(echo "$out" | grep -E "[0-9]+/[0-9]+ (acceptance|Gate)|ALL FUNCTIONAL|^ℹ pass" | head -1)
  if [ $code -eq 0 ]; then
    printf "  ok    %-22s %s\n" "$name" "$summary"
  else
    printf "  FAIL  %-22s %s\n" "$name" "$summary"
    echo "$out" | grep -E "^\s+FAIL|Error:" | head -4 | sed 's/^/        /'
    return 1
  fi
}

for i in $(seq 1 "$RUNS"); do
  echo ""
  echo "===== RUN $i/$RUNS ====="
  kill_port
  sleep 2
  if ! start_next; then
    echo "  FAIL  next did not come up"
    continue
  fi

  run_failed=0
  run_suite "validator units"   "npm run test:validator" || run_failed=1
  run_suite "phase-1 functional" "npm run functional"    || run_failed=1
  run_suite "waves 1-3"          "npm run test:accept"   || run_failed=1
  run_suite "gate 1"             "npm run test:g1"       || run_failed=1
  run_suite "gate 2"             "npm run test:g2"       || run_failed=1
  run_suite "gate 3"             "npm run test:g3"       || run_failed=1

  if [ $run_failed -eq 0 ]; then
    echo "  RUN $i: ALL GREEN"
    GREEN=$((GREEN + 1))
  else
    echo "  RUN $i: HAD FAILURES"
  fi
done

kill_port
echo ""
echo "===== STABILITY SUMMARY ====="
echo "$GREEN/$RUNS consecutive runs fully green"
[ "$GREEN" -eq "$RUNS" ]
