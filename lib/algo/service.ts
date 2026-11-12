import "server-only";
// Export, publish, preview, import — the lifecycle of a portable algorithm.
import { createHash } from "@/lib/platform/crypto";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { personaById, state, persistNs } from "@/lib/adapters/mock/store";
import { buildFeed } from "@/lib/feed";
import type { ModeDefinition, Rule } from "@/lib/adapters/types";
import {
  sanitizeArtifact,
  signArtifact,
  verifyArtifact,
  type AlgoArtifact,
  type SanitizeResult,
} from "./artifact";

export interface AlgoCard {
  /** hash-shaped id so the existing folder infrastructure can hold it */
  id: string;
  artifact: AlgoArtifact;
  publishedByPersonaId: string;
  publishedAt: number;
}

// ---------------------------------------------------------------- export

/** Serialize a mode to a signed artifact. Rules are embedded in full —
 * portability means the receiver evaluates everything locally. */
export async function exportMode(modeId: string, actorPersonaId: string): Promise<AlgoArtifact> {
  const modes = await retryAdapter(() => adapters.mode.list(actorPersonaId));
  const mode = modes.find((m) => m.id === modeId);
  if (!mode) throw new Error(`mode ${modeId} not found`);
  const rules: Rule[] = [];
  for (const id of mode.ruleIds) {
    const r = await retryAdapter(() => adapters.rules.get(id));
    if (r) rules.push(r);
  }
  const author = personaById.get(actorPersonaId);
  // MEGA PASS 2 Gate 2: a mode that sees through a lens exports it — an algo IS a portable algorithm with an influence section
  const { getLens } = await import("@/lib/lens/service");
  const pinned = mode.lens ? getLens(mode.lens) : null;
  const body: Omit<AlgoArtifact, "signature"> = {
    schemaVersion: 1,
    name: mode.name,
    summary: `${rules.length} rule${rules.length === 1 ? "" : "s"}, ranking ${Object.entries(mode.ranking)
      .sort((a, b) => b[1] - a[1])[0][0]}-first`,
    authorPersonaId: actorPersonaId,
    authorHandle: author?.handle ?? "unknown",
    algoVersion: 1,
    ranking: mode.ranking,
    rules: rules.map((r) => ({ name: r.name, action: r.action, root: r.root })),
    modeFlags: {
      ...(mode.followedOnly !== undefined ? { followedOnly: mode.followedOnly } : {}),
      ...(mode.longformOnly !== undefined ? { longformOnly: mode.longformOnly } : {}),
      ...(mode.hideReplies !== undefined ? { hideReplies: mode.hideReplies } : {}),
      showTrending: mode.showTrending,
      calmRanking: mode.calmRanking,
      ...(mode.kingOfTheHill !== undefined ? { kingOfTheHill: mode.kingOfTheHill } : {}),
      ...(mode.allowAds !== undefined ? { allowAds: mode.allowAds } : {}),
    },
    createdAt: Date.now(),
    ...(pinned ? { lens: { signals: { ...pinned.spec.signals }, influenceDistribution: JSON.parse(JSON.stringify(pinned.spec.influenceDistribution)) } } : {}),
    ...(mode.importedFrom
      ? {
          forkedFrom: {
            authorHandle: mode.importedFrom.authorHandle,
            algoVersion: mode.importedFrom.algoVersion,
            name: mode.importedFrom.name,
          },
        }
      : {}),
  };
  // Signer refusal (no key resolves for the actor) refuses the export —
  // an unsigned artifact never leaves this function.
  const signature = signArtifact(body);
  if (signature === null)
    throw new Error(`cannot sign as ${actorPersonaId} — no key resolves, export refused`);
  return { ...body, signature };
}

// --------------------------------------------------------------- publish

export async function publishAlgoCard(artifact: AlgoArtifact, publisher: string): Promise<AlgoCard> {
  const card: AlgoCard = {
    id: "0xalgo" + createHash("sha256").update(artifact.signature).digest("hex").slice(0, 12),
    artifact,
    publishedByPersonaId: publisher,
    publishedAt: Date.now(),
  };
  const s = state();
  if (!s.algoCards.has(card.id)) s.algoCards.set(card.id, card);
  await persistNs("algoCards");
  return card;
}

export function getAlgoCard(id: string): AlgoCard | null {
  return state().algoCards.get(id) ?? null;
}

// --------------------------------------------------------------- preview

/** Turn a sanitized artifact into the ModeDefinition activation would create. */
function modeFromArtifact(a: AlgoArtifact, owner: string, ruleIds: string[]): ModeDefinition {
  return {
    id: "mode_preview",
    personaId: owner,
    name: a.name,
    isPreset: false,
    ranking: a.ranking,
    ruleIds,
    notificationPolicy: "all",
    actionButtonSlots: { composer: [], nav: [] },
    showTrending: a.modeFlags.showTrending ?? true,
    calmRanking: a.modeFlags.calmRanking ?? false,
    followedOnly: a.modeFlags.followedOnly,
    longformOnly: a.modeFlags.longformOnly,
    hideReplies: a.modeFlags.hideReplies,
    allowAds: a.modeFlags.allowAds,
    kingOfTheHill: a.modeFlags.kingOfTheHill,
    createdAt: Date.now(),
    importedFrom: {
      authorHandle: a.authorHandle,
      authorPersonaId: a.authorPersonaId,
      algoVersion: a.algoVersion,
      name: a.name,
      modifiedLocally: false,
    },
  };
}

export interface AlgoPreview {
  hides: number;
  total: number;
  pct: number;
  samples: { hash: string; text: string; authorHandle: string }[];
  boosts: { handle: string; delta: number }[];
  mutedTopics: string[];
  violations: SanitizeResult["violations"];
  /** MEGA PASS 2 Gate 2: a lens preview also shows the influence consequence — accrual last epoch under it vs canonical */
  influence?: import("@/lib/lens/service").InfluenceDelta;
}

/**
 * The mandatory pre-activation preview. Runs the CURRENT feed and the
 * CANDIDATE feed through the identical buildFeed code path and diffs — so
 * "hides N posts" is not an estimate, it is the activation outcome computed
 * early. The seeded corpus is deterministic, so the numbers are exact.
 */
export async function previewArtifact(raw: unknown, viewer: string): Promise<AlgoPreview> {
  const { artifact, violations } = sanitizeArtifact(raw);
  if (!artifact) {
    return { hides: 0, total: 0, pct: 0, samples: [], boosts: [], mutedTopics: [], violations };
  }
  if (artifact.kind === "filter_pack" && verifyArtifact(artifact)) {
    // Pack preview: accounts filtered, and the share of the CURRENT feed
    // those accounts author — computed against the live window, so the
    // number is the activation outcome, not an estimate.
    const { packFailures } = await import("@/lib/packs/service");
    const failed = new Set(packFailures(artifact));
    const current = await buildFeed(viewer, { surface: "discovery", limit: 40 });
    const posts = current.cards.filter((c) => c.kind === "post" && c.cast && !c.private);
    const hiddenPosts = posts.filter((c) => c.cast!.personaId && failed.has(c.cast!.personaId));
    const samples = hiddenPosts.slice(0, 3).map((c) => ({
      hash: c.cast!.hash,
      text: c.cast!.text.slice(0, 120),
      authorHandle: c.cast!.author.username,
    }));
    return {
      hides: failed.size,
      total: posts.length,
      pct: posts.length ? Math.round((hiddenPosts.length / posts.length) * 100) : 0,
      samples,
      boosts: [],
      mutedTopics: [],
      violations,
    };
  }
  if (!verifyArtifact(artifact)) {
    return {
      hides: 0, total: 0, pct: 0, samples: [], boosts: [], mutedTopics: [],
      violations: [...violations, { where: "artifact", field: "signature", reason: "signature does not verify — artifact was altered after signing" }],
    };
  }
  if (artifact.kind === "lens" && artifact.lens) {
    // MEGA PASS 2 Gate 2: a lens preview is the SAME feed ranked without and with the lens (exact — the identical
    // buildFeed path activation uses), plus the influence delta: what your accrual last epoch would have been under it
    const { influenceDelta } = await import("@/lib/lens/service");
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    const LIMIT = 40;
    const current = await buildFeed(viewer, { surface: "discovery", limit: LIMIT, lensOverride: null });
    const candidate = await buildFeed(viewer, { surface: "discovery", limit: LIMIT, lensOverride: artifact.lens });
    const posts = (cards: typeof current.cards) => cards.filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => c.cast!);
    const cur = posts(current.cards);
    const cand = posts(candidate.cards);
    const candHashes = new Set(cand.map((c) => c.hash));
    const hidden = cur.filter((c) => !candHashes.has(c.hash));
    const rankOf = (list: typeof cur) => {
      const m = new Map<string, number>();
      list.forEach((c, i) => {
        if (!m.has(c.author.username)) m.set(c.author.username, i);
      });
      return m;
    };
    const r0 = rankOf(cur);
    const r1 = rankOf(cand);
    const boosts = [...r1.entries()].filter(([h]) => r0.has(h)).map(([h, i]) => ({ handle: h, delta: (r0.get(h) ?? 0) - i })).filter((b) => b.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    // GATE 5 (attack-post-1 F-3e): the lens route was rescoped and THIS caller was not, so the
    // same aggregate accrual arithmetic came back over the unscoped own-persona set one route
    // over — subtract the scoped answer from it and the siblings' aggregate falls out.
    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
    const influence = await influenceDelta(artifact.lens, await visibleOwnPersonaIds(), viewer);
    return {
      hides: hidden.length,
      total: cur.length,
      pct: cur.length ? Math.round((hidden.length / cur.length) * 100) : 0,
      samples: hidden.slice(0, 3).map((c) => ({ hash: c.hash, text: c.text.slice(0, 120), authorHandle: c.author.username })),
      boosts,
      mutedTopics: [],
      violations,
      influence,
    };
  }

  const inlineRules: Rule[] = artifact.rules.map((r, i) => ({
    id: `preview_rule_${i}`,
    name: r.name,
    action: r.action,
    root: r.root,
    createdAt: 0,
  })) as Rule[];

  // The same limit the real feed serves. "Against your current feed" must
  // mean the feed the user actually sees — previewing at a deeper limit
  // produced numbers about posts that were never on screen.
  const LIMIT = 40;
  const [current, candidate] = [
    await buildFeed(viewer, { surface: "discovery", limit: LIMIT }),
    await buildFeed(viewer, {
      surface: "discovery",
      limit: LIMIT,
      modeOverride: modeFromArtifact(artifact, viewer, []),
      inlineRules,
    }),
  ];

  const posts = (cards: typeof current.cards) =>
    cards.filter((c) => c.kind === "post" && c.cast && !c.private).map((c) => c.cast!);
  const cur = posts(current.cards);
  const cand = posts(candidate.cards);
  const candHashes = new Set(cand.map((c) => c.hash));

  const hidden = cur.filter((c) => !candHashes.has(c.hash));
  const samples = hidden.slice(0, 3).map((c) => ({
    hash: c.hash,
    text: c.text.slice(0, 120),
    authorHandle: c.author.username,
  }));

  // Boosted accounts: rank improvement between the two orderings.
  const rankOf = (list: typeof cur) => {
    const m = new Map<string, number>();
    list.forEach((c, i) => {
      if (!m.has(c.author.username)) m.set(c.author.username, i);
    });
    return m;
  };
  const r0 = rankOf(cur);
  const r1 = rankOf(cand);
  const boosts = [...r1.entries()]
    .filter(([h]) => r0.has(h))
    .map(([h, i]) => ({ handle: h, delta: (r0.get(h) ?? 0) - i }))
    .filter((b) => b.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  // Muted topics: clusters present now whose posts vanish entirely.
  const clustersOf = (list: typeof cur) => {
    const set = new Set<string>();
    for (const c of list) {
      const cluster = c.personaId ? personaById.get(c.personaId)?.cluster : null;
      if (cluster) set.add(cluster);
    }
    return set;
  };
  const c0 = clustersOf(cur);
  const c1 = clustersOf(cand);
  const mutedTopics = [...c0].filter((t) => !c1.has(t));

  return {
    hides: hidden.length,
    total: cur.length,
    pct: cur.length ? Math.round((hidden.length / cur.length) * 100) : 0,
    samples,
    boosts,
    mutedTopics,
    violations,
  };
}

// ---------------------------------------------------------------- import

export async function importArtifact(
  raw: unknown,
  viewer: string,
  activate: boolean
): Promise<{
  mode: ModeDefinition | null;
  pack?: { id: string; name: string };
  /** MEGA PASS 2 Gate 2: a lens import stores the lens (and pins it on the active mode when activating) */
  lens?: { id: string; name: string };
  violations: SanitizeResult["violations"];
}> {
  const { artifact, violations } = sanitizeArtifact(raw);
  if (!artifact) return { mode: null, violations };
  if (!verifyArtifact(artifact)) {
    return {
      mode: null,
      violations: [...violations, { where: "artifact", field: "signature", reason: "signature does not verify" }],
    };
  }

  // Filter packs share the whole pipeline up to here — signature, whitelist,
  // guardrails — then store as a pack rather than becoming a mode. Attachment
  // to a mode is a separate, explicit act (packs are default-OFF).
  if (artifact.kind === "filter_pack") {
    const { storePack, persistPacks } = await import("@/lib/packs/service");
    const pack = storePack(artifact);
    await persistPacks();
    return { mode: null, pack: { id: pack.id, name: artifact.name }, violations };
  }

  // MEGA PASS 2 Gate 2: a lens shares the whole pipeline up to here — signature, whitelist, guardrails — then is
  // STORED as a lens (like a pack) rather than becoming a mode; activating pins it on the active mode.
  if (artifact.kind === "lens") {
    const { storeLens, applyLens } = await import("@/lib/lens/service");
    const lens = await storeLens(artifact);
    if (activate) {
      const active = await retryAdapter(() => adapters.mode.getActive(viewer));
      await applyLens(active.id, lens.id);
    }
    return { mode: null, lens: { id: lens.id, name: lens.name }, violations };
  }
  // an algo that carries a lens section pins that lens on the mode it becomes
  let pinnedLensId: string | null = null;
  if (artifact.lens) {
    const { storeLens } = await import("@/lib/lens/service");
    pinnedLensId = (await storeLens(artifact)).id;
  }

  // Materialize the artifact's rules as real stored rules owned by the viewer.
  const ruleIds: string[] = [];
  for (const r of artifact.rules) {
    const created = await retryAdapter(() =>
      adapters.rules.create({
        personaId: viewer,
        name: `[${artifact.name}] ${r.name}`,
        action: r.action,
        root: r.root,
      })
    );
    ruleIds.push(created.id);
  }

  const mode = await retryAdapter(() =>
    adapters.mode.create({
      ...modeFromArtifact(artifact, viewer, ruleIds),
      ...(pinnedLensId ? { lens: pinnedLensId } : {}),
      id: undefined as unknown as string, // adapter mints the id
    } as unknown as Omit<ModeDefinition, "id">)
  );

  if (activate) await retryAdapter(() => adapters.mode.setActive(viewer, mode.id));
  return { mode, violations };
}
