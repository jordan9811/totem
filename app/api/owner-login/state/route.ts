import { NextRequest, NextResponse } from "next/server";
// OWNER PASSKEYS (D-OWNER-PASSKEYS) — INTERNAL: the owner gate's state for the Edge middleware. The middleware runs in
// the Edge sandbox and cannot read the volume, so it asks the server it runs inside, over the server's own loopback
// (middleware.ts fetchGateState), for the two things a session's liveness depends on: the current session epoch and
// the slot ids of the passkeys registered under the current passphrase. Opaque random values — no credential id, no
// name, no key.
//
// It answers ONLY to a request carrying OWNER_INTERNAL_HEADER with the token derived from the passphrase (which a
// stranger cannot make). middleware.ts admits this exact path without a session only with that token; without it the
// path is gated like any other (401), and this handler answers 404 to anything that still arrives without it. A file
// that cannot be read is a 503 — the middleware then refuses every session (never fail open).
//
// Server-only (scripts/device-routes.mjs: the /api/owner-login prefix). No secret configured: 404.
import { OWNER_INTERNAL_HEADER, ownerInternalTokenOk, readOwnerSecret } from "@/lib/platform/owner-access";
import { readOwnerGateState } from "@/lib/platform/owner-store.server";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const secret = readOwnerSecret();
  if (!secret) return json({ error: "not found" }, 404);
  if (!(await ownerInternalTokenOk(req.headers.get(OWNER_INTERNAL_HEADER), secret))) return json({ error: "not found" }, 404);
  try {
    return json(await readOwnerGateState(secret), 200);
  } catch (e) {
    console.error("[owner-gate] the owner state on the volume cannot be read: " + ((e as Error)?.message ?? "error"));
    return json({ error: "the owner state on the volume cannot be read" }, 503);
  }
}
