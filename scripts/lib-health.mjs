// Shared health guard for the acceptance suites.
//
// Lesson from the gated pass: a dying dev server produced ECONNREFUSED and
// 503s that surfaced as scary-looking product failures ("sensitive claim
// accepted without consent", "ads shown to an unmatched viewer"). Those were
// false alarms — the request never reached the handler. Tests must be able
// to say "I could not test this" distinctly from "this invariant is broken".
export async function assertServersUp(base, validatorBase = `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`) {
  const problems = [];
  try {
    // Bounded. A server that is gone answers instantly, but one that is
    // wedged accepts the connection and never replies — and an unbounded
    // fetch there hangs the suite instead of reporting it.
    const r = await fetch(base + "/api/dev", { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) problems.push(`next /api/dev returned ${r.status}`);
  } catch (e) {
    problems.push(`next unreachable: ${e.message}`);
  }
  try {
    const r = await fetch(validatorBase + "/health", { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) problems.push(`validator /health returned ${r.status}`);
  } catch (e) {
    problems.push(`validator unreachable: ${e.message}`);
  }
  if (problems.length) {
    console.log("\nINFRASTRUCTURE NOT READY — not a product result:");
    for (const p of problems) console.log("  - " + p);
    process.exit(2); // distinct from 1 (assertion failures)
  }
}

// ---------------------------------------------------------------------------
// CONTENT-AWARE RETRY — the Gate 0 (Farcaster pass) helper, one home for a
// gap this project hit four times before centralizing it here:
//
// A route that fans out over N adapter calls with per-item try/catch (e.g.
// GET /api/crosspost calling costEstimate() per destination) returns a
// perfectly valid 200 that is MISSING an item when one call hits the mocks'
// natural 2% synthetic failure. That is deliberate product behavior ("don't
// offer it this round"). A status-only retry accepts the incomplete 200,
// and the suite then fails on content — or crashes on `.find(...).prop` —
// in a way that looks like a product bug and isn't.
//
// Rule: retry until the response HAS THE CONTENT YOU NEED, not just an OK
// status. And on pages: poll for the confirmed outcome, never a flat wait.

/**
 * Re-run `fn` until `complete(result)` is truthy, up to `attempts` times.
 * Returns the LAST result either way — the helper never masks a genuine
 * failure; the caller's own assertion still runs against what came back.
 * A throwing `complete` counts as incomplete, so `r.json.list.find(...)`
 * checks can be written without defensive null-guards.
 */
export async function retryContent(fn, complete, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    try {
      if (complete(last)) return last;
    } catch {
      /* incomplete this round — go again */
    }
  }
  return last;
}

/**
 * Poll an async predicate until truthy. Budget defaults to 20 x 400ms; an
 * optional `midway` hook (e.g. a page.reload) runs once at the halfway
 * mark, covering "state landed after the render began". Returns true on
 * success, false on budget exhaustion — the caller asserts, not the helper.
 */
export async function pollUntil(pred, { tries = 20, delayMs = 400, midway } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await pred()) return true;
    } catch {
      /* not yet — keep polling */
    }
    if (midway && i === Math.floor(tries / 2)) await midway();
    else await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** True when an error looks like infrastructure rather than a product failure. */
export function isInfraError(message) {
  return (
    /ECONNREFUSED|ECONNRESET|socket hang up|INFRA:|Timeout .* exceeded|net::ERR|fetch failed|UND_ERR|EADDRINUSE|ETIMEDOUT/i.test(
      String(message)
    ) ||
    // The mocks inject a 2% synthetic failure ON PURPOSE, so a call that
    // trips one has not revealed a product defect — it has revealed the
    // harness doing its job. Reads and idempotent writes retry through it;
    // genuinely non-idempotent operations (create, duplicate, advance, send)
    // deliberately do NOT, because retrying those trades a flake for a
    // duplicate. When one of those trips, the honest classification is
    // "could not test", not "invariant broken".
    //
    // This does NOT weaken the fail-closed tests: those use forceFail and
    // assert a specific outcome, so they fail on the assertion rather than on
    // the injected error.
    /mock adapter synthetic failure/i.test(String(message))
  );
}
