import { NextRequest, NextResponse } from "next/server";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { personaById, state } from "@/lib/adapters/mock/store";
import {
  setSubscription,
  subscriptionsFor,
  validAnnotations,
  type SubscriptionAction,
} from "@/lib/curators/annotations";
import {
  createDraft,
  draftProgress,
  draftsVisibleTo,
  curatorRecordFor,
  signDraft,
} from "@/lib/curators/issuance";
import { annotationTally, curatorAccuracy } from "@/lib/refutation/edges";

export const dynamic = "force-dynamic";

const handleOf = (id: string) => personaById.get(id)?.handle ?? id;

/** Available curator feeds + the viewer's subscriptions. Annotation listings
 * contain VALID annotations only — a sub-threshold draft is not data anyone
 * receives, not even here. Drafts appear ONLY in the `drafts` block, ONLY
 * for the personas invited to sign them. */
export async function GET() {
  const viewer = activeSeedPersonaId();
  const feeds = [...state().curatorFeeds.values()].map((f) => ({
    id: f.id,
    name: f.name,
    threshold: f.threshold,
    curators: f.curatorPersonaIds.map((id) => personaById.get(id)?.handle ?? id),
    annotations: validAnnotations(f).map((a) => ({
      id: a.id,
      targetCastId: a.targetCastId,
      claim: a.claim,
      evidenceLink: a.evidenceLink,
      signerCount: a.signers.length,
      flagsAuthor: a.flagsAuthor ?? false,
      tally: annotationTally(a.id),
    })),
    accuracy: curatorAccuracy(f.id),
  }));
  // the issuance side: drafts THIS persona may see, plus their curator record
  const drafts = draftsVisibleTo(viewer).map((d) => {
    const p = draftProgress(d);
    return {
      id: d.id,
      feedId: d.feedId,
      status: d.status,
      targetCastId: d.base.targetCastId,
      claim: d.base.claim,
      evidenceLink: d.base.evidenceLink,
      createdByHandle: handleOf(d.createdBy),
      signedHandles: p.signed.map(handleOf),
      awaitingHandles: p.awaiting.map(handleOf),
      threshold: p.threshold,
      canSign:
        d.status === "pending" &&
        (d.createdBy === viewer || d.invited.includes(viewer)) &&
        !p.signed.includes(viewer),
    };
  });
  return NextResponse.json({
    feeds,
    subscriptions: subscriptionsFor(viewer),
    drafts,
    curatorRecord: curatorRecordFor(viewer),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const viewer = activeSeedPersonaId();

  // issuance actions ride the same route; anything else falls through to the
  // original subscription contract (whose `action` field is badge/demote/…)
  try {
    if (body.action === "draft") {
      const draft = await createDraft({
        feedId: body.feedId,
        byPersona: viewer,
        targetCastId: body.targetCastId,
        claim: body.claim,
        evidenceLink: body.evidenceLink ?? "",
        flagsAuthor: !!body.flagsAuthor,
        ...(body.edge ? { edge: body.edge } : {}),
        ...(Array.isArray(body.invite) ? { invite: body.invite } : {}),
      });
      return NextResponse.json({ draft: { id: draft.id, status: draft.status } });
    }
    if (body.action === "sign") {
      const draft = await signDraft(body.draftId, viewer);
      return NextResponse.json({
        draft: { id: draft.id, status: draft.status, issuedAnnotationId: draft.issuedAnnotationId },
      });
    }
  } catch (e) {
    const msg = (e as Error).message;
    const forbidden = /not invited|only desk members/.test(msg);
    return NextResponse.json({ error: msg }, { status: forbidden ? 403 : 404 });
  }

  const { feedId, subscribe, action } = body;
  if (!feedId) return NextResponse.json({ error: "feedId required" }, { status: 400 });
  if (!state().curatorFeeds.has(feedId))
    return NextResponse.json({ error: "unknown feed" }, { status: 404 });
  const chosen: SubscriptionAction = ["badge", "demote", "autoblock"].includes(action)
    ? action
    : "badge"; // default badge only — the least invasive action is the default
  const subscriptions = await setSubscription(viewer, feedId, subscribe === false ? null : chosen);
  return NextResponse.json({ subscriptions });
}
