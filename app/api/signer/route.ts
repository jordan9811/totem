import { NextRequest, NextResponse } from "next/server";
import { registerHandle } from "@/lib/identity/sessionHandles";
import { registerRoot } from "@/lib/validator";
import { recordRoot } from "@/lib/identity/rootRoster";
import { PERSONA_COOKIE, ROOT_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

// Stub signer connect. Real flow (live mode) would run Neynar SIWN and hand
// back a managed signer_uuid; the validator only ever sees fid + signer id,
// so the swap is invisible to it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fid = body.fid ?? 3_000_000 + Math.floor(Math.random() * 1_000_000);
  const signerUuid = body.signerUuid ?? crypto.randomUUID();
  const rootId = await registerRoot(fid, signerUuid);
  if (!rootId) return NextResponse.json({ error: "validator unavailable" }, { status: 502 });
  // ZK PASS 2 Gate 2: the device remembers which account this root is —
  // the validator no longer answers "which personas belong to fid X".
  await recordRoot(rootId, fid);
  // The browser gets an OPAQUE handle, in the body AND the cookie. The root
  // id stays server-side; a response or cookie carrying it is exactly what
  // the leak test forbids.
  const sessionHandle = await registerHandle(rootId);
  const res = NextResponse.json({ session: sessionHandle, fid });
  res.cookies.set(ROOT_COOKIE, sessionHandle, { path: "/" });
  res.cookies.set("layers_fid", String(fid), { path: "/" });
  res.cookies.delete(PERSONA_COOKIE);
  return res;
}
