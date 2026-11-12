// runner regression probe: a product-style failure with a FAIL line.
console.log("  PASS 1. probe: first");
console.log("  FAIL 2. probe: deliberate failure - the detail file must receive exactly this line");
console.log("1/2 probe checks passed, 1 FAILED, 0 infra");
process.exit(1);
