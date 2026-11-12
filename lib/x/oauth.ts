import "server-only";
import { appUrl } from "@/lib/ports";
// X OAUTH — PKCE flow behind an adapter. The fixture implementation plays a
// RECORDED exchange whose shapes match X API v2 documented responses; the
// live implementation hits the real endpoints and only constructs when
// credentials exist. Results are tagged with their mode — FIXTURE-VERIFIED
// is a result, "passed" with no qualifier is a lie.
import { createHash, randomBytes } from "@/lib/platform/crypto";
import { withMockLatency } from "../adapters/mockUtils";

export interface XTokenResponse {
  token_type: "bearer";
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
}

export interface XUserMe {
  data: { id: string; username: string; name: string };
}

export interface XOAuthAdapter {
  mode: "live" | "fixture";
  beginAuth(): Promise<{ authorizeUrl: string; state: string; codeVerifier: string }>;
  exchangeCode(code: string, codeVerifier: string): Promise<XTokenResponse>;
  /** GET /2/users/me — whose account actually authorized */
  fetchMe(accessToken: string, fixtureHandle?: string): Promise<XUserMe>;
}

function pkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, challenge };
}

/** Recorded-exchange fixture. Shapes are X API v2's documented responses;
 * latency and the 2% failure ride along (mocks lie about cost, never
 * success). fixtureHandle simulates WHICH X account authorized — a dev-only
 * input that live mode ignores (judgment call, logged in REPORT-X). */
export const fixtureXOAuth: XOAuthAdapter = {
  mode: "fixture",
  async beginAuth() {
    return withMockLatency(() => {
      const { codeVerifier, challenge } = pkcePair();
      const state = randomBytes(12).toString("base64url");
      const authorizeUrl =
        "https://x.com/i/oauth2/authorize?response_type=code&client_id=FIXTURE_CLIENT" +
        "&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fx%2Fcallback" +
        "&scope=tweet.read%20tweet.write%20users.read%20follows.read%20offline.access" +
        `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
      return { authorizeUrl, state, codeVerifier };
    }, { label: "x.oauth.begin" });
  },
  async exchangeCode(code) {
    return withMockLatency<XTokenResponse>(
      () => ({
        token_type: "bearer",
        expires_in: 7200,
        access_token: "fixture-token-" + createHash("sha256").update(code).digest("hex").slice(0, 24),
        scope: "tweet.read tweet.write users.read follows.read offline.access",
        refresh_token: "fixture-refresh-" + createHash("sha256").update(code + "r").digest("hex").slice(0, 24),
      }),
      { label: "x.oauth.exchange" }
    );
  },
  async fetchMe(accessToken, fixtureHandle = "yeak_offchain") {
    return withMockLatency<XUserMe>(
      () => ({
        data: {
          // X user ids are large numeric strings; derive one deterministically
          // from the handle without BigInt (tsconfig targets pre-ES2020)
          id: "11" + String(parseInt(createHash("sha256").update(fixtureHandle).digest("hex").slice(0, 12), 16)).padStart(17, "0"),
          username: fixtureHandle,
          name: fixtureHandle,
        },
      }),
      { label: "x.oauth.me" }
    );
  },
};

/** Live implementation: real endpoints, real credentials. Constructed only
 * when X_API_CLIENT_ID exists — fetchMe/exchangeCode never silently no-op. */
export function liveXOAuth(): XOAuthAdapter {
  const clientId = process.env.X_API_CLIENT_ID;
  const clientSecret = process.env.X_API_CLIENT_SECRET;
  if (!clientId) throw new Error("liveXOAuth constructed without X_API_CLIENT_ID");
  return {
    mode: "live",
    async beginAuth() {
      const { codeVerifier, challenge } = pkcePair();
      const state = randomBytes(12).toString("base64url");
      const authorizeUrl =
        "https://x.com/i/oauth2/authorize?response_type=code" +
        `&client_id=${encodeURIComponent(clientId)}` +
        "&redirect_uri=" + encodeURIComponent(process.env.X_API_REDIRECT_URI ?? `${appUrl()}/api/x/callback`) +
        "&scope=" + encodeURIComponent("tweet.read tweet.write users.read follows.read offline.access") +
        `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
      return { authorizeUrl, state, codeVerifier };
    },
    async exchangeCode(code, codeVerifier) {
      const res = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(clientSecret
            ? { Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") }
            : {}),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          redirect_uri: process.env.X_API_REDIRECT_URI ?? `${appUrl()}/api/x/callback`,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new Error(`X token exchange failed: ${res.status}`);
      return (await res.json()) as XTokenResponse;
    },
    async fetchMe(accessToken) {
      const res = await fetch("https://api.x.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`X users/me failed: ${res.status}`);
      return (await res.json()) as XUserMe;
    },
  };
}

/** Reality decides the adapter. */
export function xOAuth(): XOAuthAdapter {
  return process.env.X_API_CLIENT_ID ? liveXOAuth() : fixtureXOAuth;
}
