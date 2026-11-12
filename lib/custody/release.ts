import "server-only";
// BROWSER KEYSTORE PASS Gate 2 — the wrap path's release key (D-CU-2-THE-WRAP-PATH-IS-STATELESS-ON-THE-SERVER).
//
// THE ONE PLACE A SERVER HOLDS A KEY (docs/custody-model.md D-CU-0-8), and it is not a root, a seed, a vault key
// or a persona key: without the browser's wrapped blob it opens nothing. One secret; per-credential keys are derived
// from it, so no per-account row exists to leak. Rotating the secret orphans every wrap-path blob — the 24 words
// are the escape hatch (A-CU-2-RELEASE-SECRET-ROTATION).
import { createHmac } from "node:crypto";

/** the rig's fixed dev secret, only ever under ZK_DEV_HOOKS; production must set CUSTODY_RELEASE_SECRET or the wrap path is unavailable */
const DEV_SECRET = "layers-dev-release-secret-not-for-production";

export function releaseSecret(): Buffer | null {
  const s = process.env.CUSTODY_RELEASE_SECRET;
  if (s && s.length >= 32) return Buffer.from(s, "utf8");
  if (process.env.ZK_DEV_HOOKS === "true") return Buffer.from(DEV_SECRET, "utf8");
  return null;
}

/** 32 bytes, hex — the KEK for one credential, derivable again after any restart */
export function releaseKeyFor(secret: Buffer, credentialId: string): string {
  return createHmac("sha256", secret).update("layers/custody/release/v1|" + credentialId).digest("hex");
}

const publicDeployment = () => process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true";

/** the origins an assertion may come from: the app's own, from CONFIGURATION — never from the request
 *  (attack-custody-1 #3, -3 #10). Loopback origins exist only off a public deployment. */
export function allowedOrigins(): string[] {
  const out = new Set<string>();
  const app = process.env.APP_URL;
  if (app) out.add(app.replace(/\/$/, ""));
  for (const o of (process.env.CUSTODY_ALLOWED_ORIGINS || "").split(",")) if (o.trim()) out.add(o.trim());
  if (!publicDeployment()) {
    const port = process.env.LAYERS_APP_PORT || "3001";
    out.add(`http://localhost:${port}`);
    out.add(`http://127.0.0.1:${port}`);
  }
  return [...out];
}

/** the RP id the app registers passkeys under: the configured APP_URL's host, never an IP (WebAuthn refuses one),
 *  never the caller's Origin header */
export function rpId(): string {
  try {
    const h = new URL(process.env.APP_URL || "http://localhost").hostname;
    return /^\d+\.\d+\.\d+\.\d+$/.test(h) ? "localhost" : h;
  } catch {
    return "localhost";
  }
}
