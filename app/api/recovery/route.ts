import { NextRequest, NextResponse } from "next/server";
import { validatorUrl } from "@/lib/ports";
// RECOVERY — a lost device is not a death sentence.
//
// Baseline: the RECOVERY PHRASE (24-word BIP39). Revealing it forces an
// explicit acknowledgment, because the phrase IS the identity: write it
// down, lose it and everything is gone, anyone who has it is you.
//
// Stronger option (built): ENCRYPTED PASSPHRASE ESCROW. The seed sealed
// under a passphrase, stored as ciphertext the server cannot read;
// recovery needs only the passphrase. (Social recovery / Shamir is the
// documented next step — it needs an audited secret-sharing library this
// build does not have, and the crypto discipline forbids hand-rolling
// one; see lib/recovery/escrow.ts.)
//
// Either path reconstructs the WHOLE identity after total device loss:
// the phrase/passphrase yields the seed, the seed re-derives the vault
// key, the vault key decrypts the identity roster off the validator, and
// the keystore is rebuilt — after which every persona key, grant
// signature, and vault record reproduces bit-identically.
import { rootMaterialForLeakTest } from "@/lib/identity/keystore";
import { seedToMnemonic, mnemonicToSeed } from "@/lib/recovery/mnemonic";
import { sealSeedEscrow, openSeedEscrow, type SeedEscrow } from "@/lib/recovery/escrow";
import { recoverIdentity, rosterHealthy, syncRoster } from "@/lib/identity/roster";
import { flush } from "@/lib/adapters/mock/persist";

export const dynamic = "force-dynamic";

const VBASE = validatorUrl();
const ESCROW_KEY = "self"; // single-root demo: one escrow slot

const ACK_TEXT =
  "I understand this phrase is my only backup: anyone who has it controls my account, " +
  "and if I lose it there is no reset and no recovery.";

function currentSeedHex(): string {
  // rootMaterialForLeakTest()[0] is the root secret hex — used here INSIDE
  // the server to back up the seed the owner already holds; it never
  // leaves except as the phrase the owner explicitly reveals.
  return rootMaterialForLeakTest()[0];
}

export async function GET() {
  return NextResponse.json({
    phraseAvailable: true,
    escrowPresent: await escrowExists(),
    rosterHealthy: await rosterHealthy(),
    ackRequired: ACK_TEXT,
  });
}

async function escrowExists(): Promise<boolean> {
  try {
    const res = await fetch(`${VBASE}/state/seedEscrow`, { cache: "no-store" });
    const entries = (await res.json())?.entries ?? {};
    return Boolean(entries[ESCROW_KEY]);
  } catch {
    return false;
  }
}

/** BROWSER KEYSTORE PASS Gate 5 (attack-custody-1, noted): this route runs in the browser device, where the seed is.
 *  On a production SERVER — no window, production build, no dev hooks — it refuses before reading a body, so a
 *  phrase or a passphrase posted at the server is never parsed, never opened, and never enrols anything there. */
function serverHoldsNoIdentity(): boolean {
  return typeof window === "undefined" && process.env.NODE_ENV === "production" && process.env.ZK_DEV_HOOKS !== "true";
}

export async function POST(req: NextRequest) {
  if (serverHoldsNoIdentity()) {
    return NextResponse.json({ error: "recovery runs in the device; this server holds no identity" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (body.action === "syncRoster") {
    await syncRoster();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "revealPhrase") {
    // FORCED ACKNOWLEDGMENT: the phrase is revealed only against an
    // explicit acknowledgment of what holding it means.
    if (body.acknowledged !== true) {
      return NextResponse.json({ error: "acknowledgment required", ackText: ACK_TEXT }, { status: 428 });
    }
    return NextResponse.json({ phrase: seedToMnemonic(currentSeedHex()), wordCount: 24 });
  }

  if (body.action === "escrowSeal") {
    const passphrase = String(body.passphrase ?? "");
    let blob: SeedEscrow;
    try {
      blob = sealSeedEscrow(currentSeedHex(), passphrase);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    // stored as ciphertext (already passphrase-sealed) on the validator
    try {
      const prior = await fetch(`${VBASE}/state/seedEscrow`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.entries ?? {})
        .catch(() => ({}));
      await flush("seedEscrow", { ...prior, [ESCROW_KEY]: blob });
    } catch (e) {
      return NextResponse.json({ error: `escrow store failed: ${(e as Error).message}` }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "recover") {
    // Two doors to the same seed: the phrase, or the escrow + passphrase.
    let seedHex: string;
    try {
      if (body.phrase) {
        seedHex = mnemonicToSeed(String(body.phrase));
      } else if (body.passphrase) {
        const res = await fetch(`${VBASE}/state/seedEscrow`, { cache: "no-store" });
        const blob = ((await res.json())?.entries ?? {})[ESCROW_KEY] as SeedEscrow | undefined;
        if (!blob) return NextResponse.json({ error: "no escrow on file" }, { status: 404 });
        seedHex = openSeedEscrow(blob, String(body.passphrase));
      } else {
        return NextResponse.json({ error: "phrase or passphrase required" }, { status: 400 });
      }
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    try {
      const personas = await recoverIdentity(seedHex);
      return NextResponse.json({ ok: true, recoveredPersonas: personas });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
