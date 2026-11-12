import { NextRequest, NextResponse } from "next/server";
import { validatorUrl } from "@/lib/ports";
// DEVICE MANAGEMENT + LINKING — the seed-holding device's control surface.
//
// GET  → the list of authorized devices (public material: ids, pubkeys,
//        status), read straight from the validator.
// POST { action: "linkBegin", deviceId, devicePubKey }
//     → authorize a NEW device: sign a delegation for its key, seal a
//       payload { delegation, vaultKey } under a fresh high-entropy
//       linking secret, store the CIPHERTEXT on the relay, and return
//       { linkId, secret }. The secret is shown as a QR/code and carried
//       out-of-band; the relay never sees it. THE SEED NEVER LEAVES.
// POST { action: "revoke", deviceId }
//     → sign a revocation with the device-auth key and post it to the
//       validator. Forward-looking only: the device's future writes are
//       refused; what it already wrote stands (stated in the UI).
import {
  deviceAuthPublicKey,
  signAsDeviceAuth,
  vaultKeyBytes,
} from "@/lib/identity/keystore";
import { delegationCanonical } from "@/lib/identity/deviceKeys";
import { toHex } from "@/lib/crypto/ed25519";
import { newLinkingSecret, sealLink } from "@/lib/linking/link";
import { flush } from "@/lib/adapters/mock/persist";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const VBASE = validatorUrl();

export async function GET() {
  try {
    const { signedReadHeaders } = await import("@/lib/adapters/mock/persist");
    const res = await fetch(`${VBASE}/device/list`, { cache: "no-store", headers: await signedReadHeaders("devices") });
    const data = await res.json();
    return NextResponse.json({ devices: data.devices ?? [], anchor: deviceAuthPublicKey() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, devices: [] }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (body.action === "linkBegin") {
    const devicePubKey = String(body.devicePubKey ?? "");
    const deviceId = String(body.deviceId ?? "");
    if (!/^[0-9a-f]{64}$/.test(devicePubKey) || !deviceId) {
      return NextResponse.json({ error: "devicePubKey (32-byte hex) and deviceId required" }, { status: 400 });
    }
    // 1. delegation for the new device, signed by the device-auth key
    const base = {
      v: 1 as const,
      deviceId,
      devicePubKey,
      scopes: ["state-write", "vault-read"],
      issuedAt: Date.now(),
      expiresAt: null,
    };
    const delegation = { ...base, signature: signAsDeviceAuth(delegationCanonical(base)) };
    // 2. seal { delegation, vaultKey } under a fresh out-of-band secret
    const session = await getSession().catch(() => null);
    const secret = newLinkingSecret();
    const sealed = sealLink(secret, {
      delegation,
      vaultKeyHex: toHex(vaultKeyBytes()),
      fid: session?.active ? undefined : null,
    });
    // 3. the relay stores ONLY the ciphertext (leak-grepped)
    const linkId = "lnk_" + deviceId + "_" + String(base.issuedAt);
    try {
      // whole-namespace replace: keep prior links, add this one
      const prior = await fetch(`${VBASE}/state/deviceLinks`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.entries ?? {})
        .catch(() => ({}));
      await flush("deviceLinks", { ...prior, [linkId]: sealed });
    } catch (e) {
      return NextResponse.json({ error: `relay store failed: ${(e as Error).message}` }, { status: 503 });
    }
    // secret returned to the origin device's UI (QR); NEVER stored on the relay
    return NextResponse.json({ linkId, secret, anchor: deviceAuthPublicKey() });
  }

  if (body.action === "revoke") {
    const deviceId = String(body.deviceId ?? "");
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    const issuedAt = Date.now();
    const canonical = ["layers-device-revoke/1", deviceId, String(issuedAt)].join("|");
    const signature = signAsDeviceAuth(canonical);
    try {
      const res = await fetch(`${VBASE}/device/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, issuedAt, signature }),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json({ error: data.error ?? "revoke refused" }, { status: res.status });
      return NextResponse.json({ ok: true, deviceId });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
