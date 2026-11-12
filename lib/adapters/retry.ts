import "server-only";
// Mock adapters fail 2% of calls by design (and 25% with dev latency
// injection maxed). Server code that fans out across several calls should
// retry transient failures the way a real client would, and surface an
// error state only when a call fails persistently. Never swallow a failure
// into a falsy value — that silently renders "no tier" / "not blocked".
export async function retryAdapter<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
