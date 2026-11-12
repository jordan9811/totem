import type { Metadata } from "next";
import { getChannels, getFeed } from "@/lib/data";
import { buildFeed, debunkSourcesFor } from "@/lib/feed";
import { applyFeedPolicy } from "@/lib/policy";
import { getSession } from "@/lib/session";
import { adapters } from "@/lib/adapters/registry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { AdapterError } from "@/lib/adapters/types";
import { composerPropsFor } from "@/lib/private/composerProps";
import { MobileHeader } from "@/components/MobileChrome";
import { personaById, state } from "@/lib/adapters/mock/store";
import { PrivacyLabel } from "@/components/zk/PrivacyLabel";
import { gatedAttestationOfMode } from "@/lib/attest/gated";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { ClassicHomeFeed, HomeFeed } from "@/components/home/HomeFeed";
import { isEmptyWorld } from "@/lib/world";
import { NoPersonaYet } from "@/components/world/NoPersonaYet";

// PUBLIC GO-LIVE: "Home / Totem" (it said "Home / X")
export const metadata: Metadata = { title: "Home / Totem" };
export const dynamic = "force-dynamic";

async function retryOnce<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { tab?: string; feed?: string; compose?: string };
}) {
  // PUBLIC GO-LIVE: /home?compose=1 is the guided first run's hand-off — the composer is focused once it can be used
  const focusComposer = searchParams.compose === "1";
  // PROD-LIVE (D-CU-0-4): on a public deployment the server holds NO identity — no keystore, no device key — so
  // every read below (the session, the feed build, the modes, the composer's persona kind, the vault's scroll zones,
  // the undo depth, the zk gate) would throw "refusing to mint a device key on a production server", and hydrate()'s
  // memoized failure would then poison every later adapter call on this process. The server renders the shell (the
  // mobile header and the tab bar) and the island fetches the rest from the routes the browser device answers
  // in-process. On the RIG nothing changes: the server computes exactly what it always did and hands it to the same
  // island as `initial`.
  const pub = isPublicDeployment();

  // FC-READ (no channels) — OWNER DECISION D-FCREAD-NO-CHANNELS-IN-V1 ("channels are not an emphasis in v1"): on a
  // PUBLIC deployment the tab bar carries no channel tabs, and any tab but Following IS For You. Discovery there is
  // the live relay's author-list feed, and a channel tab would have shown it under a channel's label (the default
  // home builds the discovery surface for every tab but Following). The RIG keeps its channel tabs and the raw tab
  // unchanged — same DOM, same behaviour.
  const tab = pub ? (searchParams.tab === "following" ? "following" : "foryou") : (searchParams.tab ?? "foryou");
  const surface = tab === "following" ? "following" : "discovery";
  const channels = pub ? [] : getChannels();

  // The phase-1 validator-backed fixture timeline. Still a real, reachable
  // surface (?feed=classic) so the persona/rep/block flow the validator
  // owns keeps its end-to-end coverage — see scripts/functional.mjs.
  // The seeded, mode-aware feed below is the default.
  if (searchParams.feed === "classic") {
    if (pub) {
      // keyed by tab: a tab switch is a different feed, never the last tab's casts under the new tab's name
      return (
        <>
          <MobileHeader />
          <ClassicHomeFeed key={tab} tab={tab} channels={channels} initial={null} />
        </>
      );
    }
    const session = await getSession();
    const { casts, nextPage } = await getFeed(tab);
    const policied = await applyFeedPolicy(casts, { surface, viewer: session.active, own: session.personas.map((p) => p.id) });
    const { decorateCrossposts } = await import("@/lib/crosspost/collapse");
    const filtered = decorateCrossposts(policied, activeSeedPersonaId());
    return (
      <>
        <MobileHeader />
        <ClassicHomeFeed tab={tab} channels={getChannels()} initial={{ casts: filtered, nextPage }} />
      </>
    );
  }

  if (pub) {
    return (
      <>
        <MobileHeader />
        <HomeFeed tab={tab} surface={surface} channels={channels} initial={null} focusComposer={focusComposer} />
      </>
    );
  }

  // ---- RIG: the server's own reads, unchanged ----
  const personaId = activeSeedPersonaId();
  // LAYERS_WORLD=empty (lib/world.ts): with no real persona there is no one to build a timeline for — the page says
  // so and points at the create path, instead of building a feed for "" (the demo world always has its seeded self)
  const emptyWorld = isEmptyWorld();
  if (emptyWorld && !personaId) {
    return (
      <>
        <MobileHeader />
        <NoPersonaYet what="Your timeline" />
      </>
    );
  }

  // ZK PASS 1 Gate 2: under the zk rep binding, rendering For You for one
  // of OUR OWN personas schedules its eligibility proof AT IDLE — proven
  // off this request, queued with a random delay, sent by the drain loop.
  // A render is not a persona action; nothing here waits on it, and a
  // view-as session (someone else's persona) never triggers it.
  let zkGateActive = false;
  {
    const { currentRepImpl } = await import("@/lib/adapters/registry");
    const { isViewingAs } = await import("@/lib/activePersona");
    zkGateActive = currentRepImpl() === "zk";
    if (zkGateActive && !isViewingAs()) {
      const { requestEligibility } = await import("@/lib/zk/gate");
      requestEligibility(personaId);
    }
  }

  let feed: Awaited<ReturnType<typeof buildFeed>> | null = null;
  let modes: Awaited<ReturnType<typeof adapters.mode.list>> = [];
  let loadError: string | null = null;
  // UX Gate 2: the undo stack's configured depth — a real per-persona
  // setting, read alongside everything else this page already fetches.
  let undoDepth = 3;

  const composer = await composerPropsFor(personaId);
  // MEGA PASS 2 Gate 3: this device's scroll-zone layout (vault; null = default). A failed read is the default,
  // never a guess at a layout.
  let zones: import("@/lib/zones/types").ZoneConfig | null = null;
  try {
    const { zoneConfigForThisDevice } = await import("@/lib/zones/store");
    const z = await zoneConfigForThisDevice();
    zones = z.saved ? z.config : null;
  } catch {
    zones = null;
  }

  try {
    [feed, modes] = await Promise.all([
      buildFeed(personaId, { surface }),
      retryOnce(() => adapters.mode.list(personaId)),
    ]);
    undoDepth = state().timelineUndoDepth.get(personaId) ?? 3;
  } catch (e) {
    loadError = (e as AdapterError).message;
  }

  // Gate 4: an attestation-gated mode hands the label the bucket it gates on (the ninth condition)
  const gatedAttestation = zkGateActive && feed ? await gatedAttestationOfMode(feed.mode) : undefined;

  const seeded = personaById.get(personaId);
  return (
    <>
      <MobileHeader />
      <HomeFeed
        tab={tab}
        surface={surface}
        channels={getChannels()}
        initial={{
          feed: feed
            ? {
                cards: feed.cards,
                mode: feed.mode,
                contentStale: feed.contentStale,
                previewStrip: feed.previewStrip ?? [],
                // Viewer-aware debunk attribution — the same value /api/feed2 carries as `debunk`. Read only when the
                // timeline will render (as before: the error branch never read it).
                debunk: loadError ? {} : debunkSourcesFor(personaId),
              }
            : null,
          modes,
          loadError,
          zones,
          undoDepth,
          composer,
          persona: seeded
            ? { id: personaId, handle: seeded.handle, name: seeded.name, avatarUrl: seeded.avatarUrl }
            : undefined,
          ...(emptyWorld ? { emptyWorld: true } : {}),
        }}
        // ZK PASS 1 Gate 3: on the proof-mediated discovery surface, the COMPUTED privacy label — DEMO until every
        // condition holds. A SERVER component, so it is computed here and handed to the island as a slot; it is
        // never rendered on a public deployment (returned above), whose server has no zk state to compute it from.
        privacyLabel={zkGateActive && surface === "discovery" ? <PrivacyLabel attestation={gatedAttestation} /> : null}
      />
    </>
  );
}
