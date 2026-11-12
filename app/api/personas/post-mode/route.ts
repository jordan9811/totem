import { NextRequest, NextResponse } from "next/server";
// PERSONA LAUNCH P3 (D2) — A PERSONA'S POST MODE: where its posts go (lib/identity/postMode.ts).
//
//   GET  ?personaId=<id>   the persona's mode (the acting persona when none is named): { personaId, handle, mode,
//                          explicit, ownAccount, options, settable }. `mode` is the EFFECTIVE one — the owner's choice, or
//                          the default for the persona's situation (anon without its own account, direct with one).
//   POST { personaId?, mode }  set it: "anon" (through @anon), "private" (Totem only) or "direct" (its own account —
//                          refused without one). Answers the new view. A write that does not fully land is an ERROR
//                          (503), never a quiet success: the keystore, the root roster and the sealed identity roster
//                          (what a recovery restores from) all carry the choice, or the caller hears about it.
//
// PERSONA LAUNCH P6 (D2): the view also says `launched` (the persona has its own LAUNCHED account) and `choiceRequired`
// (launched, and no choice made yet: the mode shows the preset "anon" and the composer asks before the next post);
// choosing any mode — the preset included — records the choice and clears it.
//
// A DEVICE route: on the public preview the browser device answers it from the visitor's own keystore and vault
// (scripts/device-routes.mjs lists it; it is not in SERVER_ONLY). Only this device's own personas are answered — a
// stranger's persona is "not one of your personas", never its mode.

export const dynamic = "force-dynamic";

async function personaFrom(raw: unknown): Promise<string | null> {
  if (typeof raw === "string" && raw) return raw;
  const { defaultPostingPersonaId } = await import("@/lib/identity/postMode");
  return defaultPostingPersonaId();
}

export async function GET(req: NextRequest) {
  const { isOwnPostingPersona, postModeView } = await import("@/lib/identity/postMode");
  const personaId = await personaFrom(req.nextUrl.searchParams.get("personaId"));
  if (!personaId) return NextResponse.json({ error: "No persona yet — create one in Settings › Account & Personas first.", code: "no_persona" }, { status: 409 });
  if (!isOwnPostingPersona(personaId)) return NextResponse.json({ error: "That isn't one of your personas.", code: "not_own" }, { status: 403 });
  try {
    return NextResponse.json(await postModeView(personaId));
  } catch (e) {
    // the persona's account record could not be read: never a guessed default (lib/fc/personaFid.ts fails closed)
    return NextResponse.json({ error: "Couldn't read this persona's post mode (" + (e as Error).message + "). Try again.", code: "unreadable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }
  const { setPostMode } = await import("@/lib/identity/postMode");
  const personaId = await personaFrom(body.personaId);
  if (!personaId) return NextResponse.json({ error: "No persona yet — create one in Settings › Account & Personas first.", code: "no_persona" }, { status: 409 });
  try {
    const r = await setPostMode(personaId, body.mode);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json(r.view);
  } catch (e) {
    return NextResponse.json({ error: "The post mode was not fully saved (" + (e as Error).message + "). Choose it again to finish.", code: "not_saved" }, { status: 503 });
  }
}
