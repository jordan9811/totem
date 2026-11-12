import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaByHandle, personaById } from "@/lib/adapters/mock/store";
import {
  eventIdempotencyKey,
  followingFor,
  logEdgeEvent,
  resolveFirstInteraction,
  setFollowing,
} from "@/lib/eventlog/log";
import { AdapterError } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

const idOf = (v: string | undefined | null): string | null => {
  if (!v) return null;
  const byHandle = personaByHandle.get(v);
  if (byHandle) return byHandle.id;
  return personaById.has(v) ? v : null;
};

export async function GET() {
  return NextResponse.json({ following: [...followingFor(activeSeedPersonaId())] });
}

/**
 * Follow/unfollow — previously pure client chrome; now a real edge with a
 * real origin. The log write happens BEFORE the response: an edge action
 * whose history failed to record is unrecoverable, so a log failure fails
 * the request loudly rather than succeeding silently.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const target = idOf(body.personaId ?? body.handle);
  if (!target) return NextResponse.json({ error: "unknown persona" }, { status: 404 });
  const follow = body.follow !== false;
  const actor = activeSeedPersonaId();
  const idempotencyKey = eventIdempotencyKey(req, body);

  try {
    await setFollowing(target, follow);
    await logEdgeEvent({
      type: follow ? "follow" : "unfollow",
      actorPersonaId: actor,
      targetPersona: target,
      triggeringCastId: body.triggeringCastId ?? null,
      context: body.context ?? "profile",
      idempotencyKey,
    });
    // "later follows" half of co-interaction: the earliest own reply/like
    // targeting this account becomes the pair's origin.
    if (follow) await resolveFirstInteraction(actor, target, body.context ?? "profile");
    return NextResponse.json({ ok: true, following: [...followingFor(actor)] });
  } catch (e) {
    return NextResponse.json(
      { error: `follow recorded=false: ${(e as AdapterError).message}` },
      { status: 503 }
    );
  }
}
