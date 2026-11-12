// runner regression probe: a suite killed mid-run — one PASS line, NO
// summary, exit 137. The runner must record INFRA "no verdict", never ok.
console.log("  PASS 1. probe: a check that ran before the kill");
process.exit(137);
