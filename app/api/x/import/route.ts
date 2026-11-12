import { NextRequest, NextResponse } from "next/server";
// X ARCHIVE IMPORT — session-based, lane-toggleable, idempotent.
//
// PERSONA LAUNCH P2 (BYX G3): the archive NEVER reaches this route. The page reads the ZIP or folder in the browser
// (lib/x/archiveZip.ts) and sends parsed lanes in batches — begin → account → posts / following / likes / interests →
// preview → commit (or discard). On a public deployment this route is answered in the tab by the browser device, so
// even the parsed lanes stay in the visitor's browser until they are sealed for the validator.
//
// Rig-only (`fixtureAvailable`, a rig SERVER process — never the owner service or the empty world, review W1-R5): `ingestFixture` (the on-disk fixture archive, read with node:fs
// imported inside the branch — the device's fs shim refuses it, and a public server must not read archives from its
// disk), the legacy raw-file `ingest`, and the two chunk-tamper hooks the rig suite uses to prove a cold read.
// Everywhere else they answer 404 "not on this site".
import { activeSeedPersonaId } from "@/lib/activePersona";
import { SEED_VIEWER } from "@/lib/adapters/mock/store";
import { ownPersonaIds } from "@/lib/identity/keystore";
import { isEmptyWorld, isRealPersona } from "@/lib/world";
import { PersistError } from "@/lib/adapters/mock/persist";
import { ChunkReadError, ChunkStaleError } from "@/lib/vault/chunkedDoc";
import { xRigFixturesAvailable } from "@/lib/x/attestations";
import {
  BATCH_LIMITS,
  commitSession,
  discardSession,
  importedLikesFor,
  importedPostsForAsync,
  importedPrivateFor,
  importLimits,
  ImportRefusal,
  importSensitiveItem,
  ingestFile,
  IMPORT_LANES,
  newImportSession,
  previewSession,
  sensitiveQueueFor,
  sessionStaged,
  sessionsFor,
  setAllResurfaced,
  setResurfaced,
  shelfSummary,
  stageAccount,
  stageFollowing,
  stageInterests,
  stageLikes,
  stagePosts,
  type ImportLane,
  type ImportSession,
} from "@/lib/x/importer";
import { shelfPage } from "@/lib/views/social.server";

export const dynamic = "force-dynamic";

/** PERSONA LAUNCH P2 (BYX G0): the rig's fixture conveniences — a rig SERVER only (never the browser device, the owner
 *  service or the empty world: review W1-R5, the one predicate in lib/x/attestations.ts) */
function fixtureAvailable(): boolean {
  return xRigFixturesAvailable();
}

/**
 * PERSONA LAUNCH P2 (review UX-10): who keeps what the page sends — the browser device on a public deployment (this
 * route answered in the tab: `window` is defined there) or the server of a single-owner service / the rig. The page's
 * "what leaves this browser" sentence is worded from it, so it is never wrong about where the parsed lanes go.
 */
function savedBy(): "device" | "service" {
  return typeof window === "undefined" ? "service" : "device";
}
const NOT_HERE = () => NextResponse.json({ error: "not on this site" }, { status: 404 });

/** a receiving persona must be the viewer's own: the acting one, a seeded self, or one this device's keystore minted */
function ownPersona(personaId: string, acting: string): boolean {
  if (!personaId) return false;
  if (isEmptyWorld() && !isRealPersona(personaId)) return false;
  if (personaId === acting || SEED_VIEWER.personas.includes(personaId)) return true;
  try {
    return ownPersonaIds().includes(personaId);
  } catch {
    return false;
  }
}

const sessionView = (x: ImportSession) => ({
  id: x.id,
  status: x.status,
  personaId: x.personaId,
  archiveHandle: x.archiveHandle,
  verified: x.verified,
  // names only — a session never carries archive content
  files: x.filesSeen ?? [],
  counts: x.counts,
  committedLanes: x.committedLanes,
  staged: sessionStaged(x.id),
});

export async function GET(req: NextRequest) {
  const personaId = activeSeedPersonaId();
  const q = req.nextUrl.searchParams;
  const sessionId = q.get("sessionId");
  try {
    if (sessionId) {
      const { session, lanes, staged } = previewSession(sessionId);
      return NextResponse.json({ session: sessionView(session), lanes, staged });
    }
    // the profile shelf's next page / its chips (components/x/ImportedFromX.tsx) — the same rows the profile shows
    if (q.get("view") === "shelf") {
      const of = q.get("personaId") || personaId;
      const page = await shelfPage(of, {
        offset: Number(q.get("offset") ?? 0),
        retweets: q.get("retweets") === "1",
        replies: q.get("replies") !== "0",
      });
      return NextResponse.json(page);
    }
    const summary = await shelfSummary(); // THROWS when the shelf cannot be read: a 503 with the reason, never "0"
    const base = {
      sessions: sessionsFor(personaId).map(sessionView),
      sensitiveQueue: sensitiveQueueFor(personaId),
      shelf: summary,
      fixtureAvailable: fixtureAvailable(),
      savedBy: savedBy(),
      limits: importLimits(),
      batch: BATCH_LIMITS,
    };
    if (q.get("view") === "summary") return NextResponse.json(base);
    const posts = await importedPostsForAsync(personaId);
    return NextResponse.json({
      ...base,
      privateImports: [
        ...importedPrivateFor(personaId).map((r) => ({ id: r.id, kind: r.kind, text: r.text })),
        ...importedLikesFor(personaId).map((r) => ({ id: r.id, kind: r.kind, text: r.text })),
      ],
      importedPosts: posts.map((p) => ({
        id: p.id,
        text: p.text,
        createdAt: p.createdAt,
        resurfaced: p.resurfaced,
        resurfacedAt: p.resurfacedAt,
        isRetweet: p.isRetweet === true,
        isReply: !!p.replyToId,
      })),
    });
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown) {
  if (e instanceof ImportRefusal) return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
  if (e instanceof ChunkReadError) return NextResponse.json({ error: e.message, code: "unreadable" }, { status: 503 });
  if (e instanceof ChunkStaleError) return NextResponse.json({ error: e.message, code: "stale" }, { status: 409 });
  if (e instanceof PersistError)
    return NextResponse.json({ error: `Couldn't save your X data: ${e.message}. Try again; anything already saved is not duplicated.`, code: "save_failed" }, { status: 503 });
  const msg = (e as Error)?.message ?? "error";
  const refusal = /unknown import session|already committed|requires explicit consent|unknown queued|identity is unknown|unknown imported post/.test(msg);
  return NextResponse.json({ error: msg }, { status: refusal ? 409 : 503 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "the request was not readable" }, { status: 400 });
  }
  const acting = activeSeedPersonaId();
  const sid = String(body.sessionId ?? "");
  try {
    switch (body.action) {
      case "begin": {
        const pid = typeof body.personaId === "string" && body.personaId ? body.personaId : acting;
        if (!ownPersona(pid, acting)) return NextResponse.json({ error: "that persona is not one of yours on this device" }, { status: 403 });
        const session = await newImportSession(pid);
        return NextResponse.json({ sessionId: session.id, session: sessionView(session) });
      }
      case "account":
        return NextResponse.json({ session: sessionView(await stageAccount(sid, body.account)) });
      case "posts":
        return NextResponse.json({ session: sessionView(await stagePosts(sid, body.posts as unknown[], { total: body.total, newestOnly: body.newestOnly, file: typeof body.file === "string" ? body.file : undefined })) });
      case "following":
        return NextResponse.json({ session: sessionView(await stageFollowing(sid, body.ids as unknown[], { total: body.total, newestOnly: body.newestOnly })) });
      case "likes":
        return NextResponse.json({ session: sessionView(await stageLikes(sid, body.likes as unknown[], { total: body.total, newestOnly: body.newestOnly })) });
      case "interests":
        return NextResponse.json({ session: sessionView(await stageInterests(sid, body.names as unknown[])) });
      case "preview": {
        const { session, lanes, staged } = previewSession(sid);
        return NextResponse.json({ session: sessionView(session), lanes, staged });
      }
      case "commit": {
        const lanes = (Array.isArray(body.lanes) ? body.lanes : []).filter((l): l is ImportLane => (IMPORT_LANES as readonly string[]).includes(String(l)));
        const pid = typeof body.personaId === "string" && body.personaId ? body.personaId : undefined;
        if (pid && !ownPersona(pid, acting)) return NextResponse.json({ error: "that persona is not one of yours on this device" }, { status: 403 });
        const result = await commitSession(sid, lanes, { personaId: pid, acknowledgedFingerprintWarning: body.acknowledgedFingerprintWarning === true });
        return NextResponse.json(result);
      }
      case "discard":
        return NextResponse.json({ session: sessionView(await discardSession(sid)) });
      case "ingest": {
        // the legacy raw-file path: parsed HERE, so the raw file crosses to this process — the rig only
        if (!fixtureAvailable()) return NOT_HERE();
        const session = await ingestFile(sid, String(body.name ?? ""), String(body.content ?? ""));
        return NextResponse.json({ sessionId: session.id, files: session.filesSeen, archiveHandle: session.archiveHandle, verified: session.verified });
      }
      case "ingestFixture": {
        if (!fixtureAvailable()) return NOT_HERE();
        // server-side fixture ingestion: every data/*.js of the on-disk fixture archive, through the same staging
        // path the page's lanes take. node:fs is imported HERE, inside the rig branch: nothing else in this route
        // touches a disk, and the browser device's fs shim would refuse it anyway.
        const { readFile, readdir } = await import("node:fs/promises");
        const path = await import("node:path");
        const dir = path.join(process.cwd(), "fixtures", "x-archive", "data");
        let session: ImportSession | null = null;
        const target = sid ? sid : (await newImportSession(acting, { fixture: true })).id;
        // a session begun by `begin` becomes a fixture session when the fixture archive is loaded into it
        const { state, persistNs } = await import("@/lib/adapters/mock/store");
        const s0 = state().xImportSessions.get(target);
        if (s0 && !s0.fixture) {
          s0.fixture = true;
          await persistNs("xImportSessions");
        }
        for (const file of (await readdir(dir)).sort()) session = await ingestFile(target, file, await readFile(path.join(dir, file), "utf8"));
        return NextResponse.json({ sessionId: target, files: session?.filesSeen ?? [], archiveHandle: session?.archiveHandle ?? null, verified: session?.verified ?? false });
      }
      case "importSensitive":
        await importSensitiveItem(acting, String(body.key));
        return NextResponse.json({ imported: true });
      case "resurface":
        return NextResponse.json({ post: await setResurfaced(acting, String(body.tweetId), !!body.on) });
      case "resurfaceAll":
        return NextResponse.json({ changed: await setAllResurfaced(acting, !!body.on) });
      case "devTamperChunk":
      case "devRestoreChunk": {
        // RIG-ONLY test hooks (scripts/accept-x5.mjs R7): flip one byte of one stored piece of an X document on the
        // validator WITHOUT touching this process's cache, then put it back — so the suite can prove that
        // /api/dev dropSealedCaches makes the next read a cold one (the corrupted piece is then refused loudly)
        if (!fixtureAvailable()) return NOT_HERE();
        const { tamperChunk, restoreChunk } = await import("@/lib/vault/chunkedDoc");
        const ns = String(body.ns ?? "");
        return NextResponse.json(body.action === "devTamperChunk" ? await tamperChunk(ns) : await restoreChunk(ns));
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}
