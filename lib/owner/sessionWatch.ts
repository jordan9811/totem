// OWNER PASSKEYS (review UX-14) — a session that ends while a page is open. The owner gate answers every API call
// after that with 401 {code: "owner_login_required"} (middleware.ts), and each feature shows its own generic error
// ("the post failed"). This watches the page's own same-origin /api/ calls for exactly that answer and reports it
// once, so the page can say what happened and offer the way back in — without navigating away from a half-written
// post. It reads only a 401's JSON body (a clone; the caller still gets the response untouched), only on the owner
// service (components/owner/OwnerSessionWatch.tsx is rendered only when an owner gate is configured).
//
// What it does NOT do (review UX-14, first half — declined, see the review notes): renew a session in use. Sessions
// last OWNER_SESSION_DAYS from sign-in, as specified; a sliding renewal would let an active session live forever and
// would restart the enrollment window a stolen passphrase session must not get back.
import { OWNER_LOGIN_PATH } from "@/lib/platform/owner-paths";

interface FetchWindow {
  fetch: typeof fetch;
  location: { origin: string; href: string };
}

function sameOriginApi(input: RequestInfo | URL, win: FetchWindow): boolean {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, win.location.href);
    return u.origin === win.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** wraps win.fetch; calls onSignedOut (once) when one of the page's own API calls is answered "owner login required".
 *  Returns the uninstaller (which restores the original only if nothing replaced the wrapper since). */
export function watchOwnerSession(win: FetchWindow, onSignedOut: () => void): () => void {
  const original = win.fetch;
  const call = original.bind(win as unknown as typeof globalThis);
  let told = false;
  const wrapped: typeof fetch = async (input, init) => {
    const res = await call(input, init);
    if (!told && res.status === 401 && sameOriginApi(input, win)) {
      res
        .clone()
        .json()
        .then((j: { code?: unknown } | null) => {
          if (!told && j?.code === "owner_login_required") {
            told = true;
            onSignedOut();
          }
        })
        .catch(() => undefined);
    }
    return res;
  };
  win.fetch = wrapped;
  return () => {
    if (win.fetch === wrapped) win.fetch = original;
  };
}

/** where "Sign in again" goes: the sign-in page, then back to this page */
export function signInAgainHref(pathAndQuery: string): string {
  return `${OWNER_LOGIN_PATH}?next=${encodeURIComponent(pathAndQuery || "/home")}`;
}
