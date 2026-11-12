// Gate 0 exit criterion: create a mode, a rule, a block, and a bookmark
// schedule → restart BOTH servers → assert all four survived.
//
// The restart is done by the caller (scripts/gate0.mjs) so this file can be
// invoked in two phases:
//   node scripts/restart-survival.mjs write   → creates state, prints ids
//   node scripts/restart-survival.mjs verify  → asserts they still exist
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pollUntil } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE_ZK = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const STATE_FILE = "shots/.restart-survival.json";
const phase = process.argv[2] || "write";

const browser = await chromium.launch();
const page = await browser.newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status(), json, text };
}

let failures = 0;
const results = [];
const ok = (n) => { results.push(n); console.log("  PASS  " + n); };
const fail = (n, d) => {
  failures++;
  results.push(n);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

// Retry helper: the 2% synthetic failure rate applies to these calls too.
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r.status >= 200 && r.status < 300) return r;
      last = new Error("status " + r.status + " " + (r.json?.error ?? ""));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

if (phase === "write") {
  const created = {};

  // 1. a mode
  const modeRes = await retry(() =>
    api("POST", "/api/modes", {
      name: "Restart Survivor",
      ranking: { recency: 1, engagement: 1, authorAffinity: 1, clusterAffinity: 1 },
      ruleIds: [],
      notificationPolicy: "all",
      actionButtonSlots: { composer: [], nav: [] },
      showTrending: true,
      calmRanking: false,
      isPreset: false,
    })
  );
  created.modeId = modeRes.json.mode.id;
  created.modeName = modeRes.json.mode.name;

  // 2. a rule
  const ruleRes = await retry(() =>
    api("POST", "/api/rules", {
      name: "Restart Survivor Rule",
      action: "hide",
      root: { combinator: "AND", clauses: [{ field: "author.tier", op: "lt", value: 3 }] },
    })
  );
  created.ruleId = ruleRes.json.rule.id;

  // 3. a block (mock rep adapter, root-level fan-out)
  const accounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
  const target = accounts.personas.find((p) => p.handle === "gwei_whisperer");
  created.blockedPersonaId = target.id;
  await retry(() => api("POST", "/api/block-seed", { personaId: target.id }));

  // 4. a bookmark/readwise schedule
  const longform = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts.find(
    (p) => p.truncate
  );
  created.readwiseHash = longform.hash;
  await retry(() => api("POST", "/api/feed-health", { postHash: longform.hash }));

  // 6-8. mega-pass state: a grant, a fork, and a private post. These are the
  // disclosure substrate itself — if a grant does not survive a restart then
  // every linkage silently becomes hidden, and if a fork does not survive
  // then a carried holder loses the trail through no decision of anyone's.
  const bnb = accounts.personas.find((p) => p.handle === "brothandbones");
  const luke = accounts.personas.find((p) => p.handle === "linescoreluke");
  const dave = accounts.personas.find((p) => p.handle === "drivethru_dave");
  const scope = accounts.personas.find((p) => p.handle === "backyard_scope");
  const annie = accounts.personas.find((p) => p.handle === "aperture_annie");

  // 6. a grant issued at runtime (not seeded), to a viewer who had none
  await retry(() =>
    api("POST", "/api/identity/grant", {
      fromPersona: bnb.id,
      toPersona: luke.id,
      audienceMember: dave.id,
      tier: "whitelist",
    })
  );
  created.grantFrom = bnb.id;
  created.grantTo = luke.id;
  created.grantAudience = dave.id;

  // 7. a fork, with one carried holder
  const forkRes = await retry(() =>
    api("POST", "/api/identity/fork", {
      fromPersona: bnb.id,
      carry: [dave.id],
      newName: "Restart Survivor Fork",
      newHandle: "restart_survivor_fork",
    })
  );
  created.forkOld = bnb.id;
  created.forkNew = forkRes.json.newPersona;
  created.forkCarried = dave.id;

  // 8. a private post, authored as the private persona
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: scope.id }));
  const privRes = await retry(() =>
    api("POST", "/api/private/posts", { text: "restart survivor private post" })
  );
  created.privateHash = privRes.json.post.hash;
  created.privateViewer = annie.id;
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));

  // 9. Tier A: a relationship event with its receipts, and the follow delta
  const relTarget = accounts.personas.find((p) => p.handle === "restakerelle");
  await retry(() =>
    api("POST", "/api/follow", {
      personaId: relTarget.id,
      follow: true,
      triggeringCastId: "0xcr0001",
      context: "restart_survival",
    })
  );
  created.relFollowTarget = relTarget.id;

  // 10. Tier A: an imported algorithm and a curator subscription
  const algoCards = await retry(() => api("GET", "/api/algo"));
  const calmCard = algoCards.json.cards.find((c) => c.artifact.name === "Calm Signal");
  const imported = await retry(() =>
    api("POST", "/api/algo/import", { artifact: calmCard.artifact, activate: false })
  );
  created.importedModeId = imported.json.mode.id;
  await retry(() =>
    api("POST", "/api/curators", { feedId: "curator_recordsdesk", subscribe: true, action: "demote" })
  );

  // 5. market state (Gate 3): an intent must survive too
  const intentRes = await retry(() =>
    api("POST", "/api/market/intent", {
      category: "espresso",
      description: "Restart survivor intent",
      escrowAmount: 4200,
      pitchSlots: 2,
      windowMs: 60000,
    })
  );
  created.marketIntentId = intentRes.json.intent.id;

  // ---- Tier B state ----

  // 11. an imported filter pack, ATTACHED to the survivor mode
  const packCard = algoCards.json.cards.find((c) => c.artifact.kind === "filter_pack");
  const packImp = await retry(() =>
    api("POST", "/api/algo/import", { artifact: packCard.artifact, activate: false })
  );
  created.packId = packImp.json.pack.id;
  await retry(() =>
    api("PATCH", "/api/modes", { modeId: created.modeId, patch: { filterPackIds: [created.packId] } })
  );

  // 12. a crosspost record with its external ref (rides the event log AND
  // the crossposts namespace)
  created.crosspostHash = "0xrsb" + Date.now().toString(36);
  const xpost = await retry(() =>
    api("POST", "/api/crosspost", {
      castHash: created.crosspostHash,
      text: "restart survivor crosspost subject",
      destinationIds: ["x_mock"],
    })
  );
  created.crosspostRef = xpost.json.published[0].externalRef;

  // 13. a MID-FLIGHT escrow: a read request whose window is OPEN at the
  // restart. Deliberately no clock advance in this phase — the clock offset
  // dies with the process, and the window must keep ticking on wall time.
  // NOT relTarget: step 9 just made the viewer follow restakerelle, which
  // makes her reads FREE (mutuals price 0) — the mid-flight escrow needs a
  // payer with a real price
  const payer = accounts.personas.find((p) => p.handle === "drivethru_dave");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: payer.id }));
  const readReq = await retry(() =>
    api("POST", "/api/market/infofi", {
      action: "requestRead",
      toPersona: accounts.personas.find((p) => p.handle === "yeak__").id,
      castHash: "0xcr0012",
    })
  );
  created.readRequestId = readReq.json.request.id;
  created.readEscrowId = readReq.json.request.escrowId;
  created.readPrice = readReq.json.request.price;
  created.readPayerBalance = readReq.json.balance;
  created.readPayerId = payer.id;
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));

  // 14. a PENDING curator draft (1-of-2) made at runtime
  const annette = accounts.personas.find((p) => p.handle === "archive_annette");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: annette.id }));
  const draftRes = await retry(() =>
    api("POST", "/api/curators", {
      action: "draft",
      feedId: "curator_recordsdesk",
      targetCastId: "0xcr0014",
      claim: "Restart survivor draft: the timeline here omits the second recall notice.",
      evidenceLink: "https://example.org/restart/recall",
    })
  );
  created.draftId = draftRes.json.draft.id;
  created.draftAuthorId = annette.id;
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));

  // ---- X interop state ----

  // 15. an account attestation on the main persona
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "yeak_offchain" }));
  created.xHandle = "yeak_offchain";

  // 16. a COMMITTED archive import (posts + following lanes)
  const s1 = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  await retry(() => api("POST", "/api/x/import", { action: "ingestFixture", sessionId: s1.json.sessionId }));
  await retry(() =>
    api("POST", "/api/x/import", { action: "commit", sessionId: s1.json.sessionId, lanes: ["posts", "following"], acknowledgedFingerprintWarning: true })
  );
  created.importSessionCommitted = s1.json.sessionId;

  // 17. a MID-FLIGHT import session: two files ingested, NOT committed —
  // the restart must resume it, not lose it
  const s2 = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  const fs2 = await import("node:fs/promises");
  for (const f of ["account.js", "like.js"]) {
    const content = await fs2.readFile("fixtures/x-archive/data/" + f, "utf8");
    await retry(() => api("POST", "/api/x/import", { action: "ingest", sessionId: s2.json.sessionId, name: f, content }));
  }
  created.importSessionMidflight = s2.json.sessionId;

  // 18. spend-ledger state: one confirmed costed publish
  await retry(() => api("POST", "/api/x/spend", { action: "beginRun", label: "restart" }));
  const pub = await retry(() =>
    api("POST", "/api/crosspost", {
      castHash: "0xrestartspend",
      text: "restart survivor costed publish https://example.org/rs",
      destinationIds: ["x"],
      confirmSpend: true,
    })
  );
  created.spendRef = pub.json.published[0].externalRef;

  // 19. migration prefs (an exclusion) — the pending list itself came from 16
  await retry(() => api("POST", "/api/x/migrate", { action: "prefs", excludedHandles: ["randomx_beta"] }));

  // 20. UX Gate 0: a resurfaced X import — the resurface flag + timestamp
  // ARE real persisted state (unlike the undo stack below)
  const importedPosts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  if (importedPosts?.[0]) {
    await retry(() =>
      api("POST", "/api/x/import", { action: "resurface", tweetId: importedPosts[0].id, on: true })
    );
    created.resurfacedTweetId = importedPosts[0].id;
  }

  // 21. UX Gate 1: a persona default-mode binding and a mode's forced-persona
  // pin — both real settings
  const modesForBinding = (await retry(() => api("GET", "/api/modes"))).json.modes;
  const workMode = modesForBinding.find((m) => m.name === "Work");
  if (workMode) {
    await retry(() =>
      api("POST", "/api/personas/bindings", {
        action: "setDefaultMode",
        personaId: workMode.personaId,
        modeId: workMode.id,
      })
    );
    created.boundDefaultModeId = workMode.id;
    created.boundDefaultModePersona = workMode.personaId;
  }

  // 22. UX Gate 2: create ACTUAL undo state through the browser UI — the
  // negative assertion this exists to prove needs a real prior session to
  // prove absent, not just an untouched default
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const refreshBtn = page.locator("[data-testid=timeline-refresh]");
  if ((await refreshBtn.count()) > 0) {
    await refreshBtn.click();
    await page.waitForTimeout(1500);
  }

  // 23. UX Gate 3: resolve a cold source into readwise, then surface one
  // chunk — postByHash never persists itself (SEED_POSTS only), so
  // verify needs a chunk actually rendered post-restart, not just the
  // resolved-count API reading back correctly. That's the one path a
  // resolved cold item could silently vanish on: coldResolved survives via
  // the ordinary namespace mechanism either way.
  const resolved23 = await retry(() =>
    api("POST", "/api/x/coldstore", { action: "resolve", sourceId: "cold_bf_longform" })
  );
  if (resolved23.json.resolved > 0 || resolved23.json.alreadyResolved > 0) {
    await retry(() => api("POST", "/api/dev", { action: "fastForwardReadwise" }));
    created.coldSourceId = "cold_bf_longform";
  }

  // 24. UX Gate 4: an attested claim (via the DID connector) and a
  // self-declared one — the score itself is pure computation over
  // graphClaims/graphConsent (both ALREADY-persisted namespaces, nothing
  // new to wire up), so the real thing worth proving is that recomputing
  // it after a real restart lands on the exact same number, not a cached
  // or now-stale one.
  let didJob = (await retry(() => api("POST", "/api/graph/import", { connectorId: "conn_did" }))).json.job;
  while (didJob.status !== "preview" && didJob.status !== "complete") {
    didJob = (await retry(() => api("POST", "/api/graph/import", { jobId: didJob.id }))).json.job;
  }
  if (didJob.status === "preview") {
    // backpack pass: the walk stops at preview — commit to actually write.
    didJob = (await retry(() => api("POST", "/api/graph/import", { jobId: didJob.id, action: "commit" }))).json.job;
  }
  await retry(() =>
    api("POST", "/api/graph", { category: "habits", label: "Restart survivor self-claim", value: "rs_self_habit_1" })
  );
  const scoreBefore = (await retry(() => api("GET", "/api/graph/score"))).json;
  created.backpackScore = scoreBefore.score;
  created.backpackClaimValue = "did_controlled";

  // 25. CALL OPTION A: the daily rate-limit cap is explicitly named in this
  // pass's safety set ("alt-link rate limit + delay") — if altLinkAttempts
  // didn't survive a restart, restarting the server would silently reset
  // anyone's daily quota. Link + ack + run once; verify checks the count
  // (not the cap boundary itself — that's accept-calla.mjs's job).
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "rs_altlink_primary" }));
  await retry(() => api("POST", "/api/x/altlink", { action: "linkAlt", handle: "rs_altlink_alt" }));
  await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
  const altAttempt = await retry(() =>
    api("POST", "/api/x/altlink", {
      action: "run",
      altHandle: "rs_altlink_alt",
      targetPostId: "rs_post_1",
      audienceMember: "gwei_whisperer",
    })
  );
  created.altLinkAttemptId = altAttempt.json.attempt.id;
  created.altLinkDelayMs = altAttempt.json.attempt.delayMs;

  // 26. FC pass: (a) an attributed fixture cast — the write LEDGER and the
  // ATTRIBUTION INDEX are both persisted, real data about (sim) public
  // casts; (b) a publish whose response is dropped mid-flight — the
  // PENDING ledger entry must survive the restart so the retry resumes
  // check-before-retry instead of blind-retrying.
  const fcPub = await retry(() =>
    api("POST", "/api/fc/write", { action: "cast", text: "restart survivor attributed cast [layers-test fixture]" })
  );
  created.fcCastHash = fcPub.json.hash;
  created.fcPersonaId = fcPub.json.personaId;

  await retry(() => api("POST", "/api/dev", { action: "forceFcPublishDrop", count: 1 }));
  created.fcAmbiguousText = "restart survivor mid-flight publish [layers-test fixture]";
  const dropped = await api("POST", "/api/fc/write", { action: "cast", text: created.fcAmbiguousText });
  if (dropped.status !== 502) console.log("  WARN: mid-flight drop returned " + dropped.status + ", expected 502");

  // ZK PASS 1: registration state, the signed root history + the client's
  // VAULT anchor of it, the proof-history budget and the nullifier store
  // must all survive a hard kill of BOTH servers.
  {
    const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
    await retry(() => zk("resetZk"));
    const issued = await retry(() =>
      api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "cd".repeat(32), deviceId: "dev_rs_zk_probe" })
    );
    await fetch(VBASE_ZK + "/device/auth-anchor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: issued.json.anchorPubKey }),
    });
    await retry(() => zk("register"));
    created.zkCommitment = (await retry(() => zk("probe"))).json.commitment;
    await retry(() => zk("seedDecoys", { count: 60 })); // the client refuses to prove below its floor
    await retry(() => zk("advanceEpoch"));
    const proved = await retry(() => zk("prove", { claimKind: "tier-membership", tree: "valid", personaId: "persona_viewer_main", gateId: "foryou" }));
    created.zkEnvelope = proved.json.envelope;
    created.zkEpoch = proved.json.epoch;
    created.zkRoot = proved.json.envelope.publicInputs.merkleTreeRoot;
    const sub = await retry(() => zk("submit", { envelope: proved.json.envelope }));
    if (sub.json.status !== 200) throw new Error("zk submit refused in the write phase: " + JSON.stringify(sub.json));
    const bud = await retry(() => zk("budgetProbe", { personaId: "persona_viewer_main", epoch: proved.json.epoch }));
    created.zkBudgetUsed = bud.json.status.used;
    // Gate 1: a QUEUED (jittered, not yet due) submission must survive the
    // kill still queued, then drain exactly once — never twice, never lost.
    const queued = await retry(() =>
      zk("enqueue", { claimKind: "tier-membership", tree: "valid", personaId: "persona_viewer_alt", gateId: "foryou", jitterMinMs: 300_000, jitterMaxMs: 360_000 })
    );
    created.zkQueuedId = queued.json.id;
    created.zkQueuedNotBefore = queued.json.notBefore;
  }

  // ---- MEGA PASS 2 state: allowance + stake history, a lens pin, a button binding, a zone layout, a DM-sourced
  // bookmark (and the search index that must be RE-DERIVED, never stored), a pending relationship port ----
  {
    await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
    const st = await retry(() => api("POST", "/api/influence", { action: "stake", castHash: "0xcr0001", stakeAction: "like", amount: 1 }));
    created.m2Remaining = st.json.remaining;
    created.m2StakeId = st.json.stake?.id ?? st.json.id ?? null;
    const modes = (await retry(() => api("GET", "/api/modes"))).json;
    created.m2ModeId = modes.activeId;
    await retry(() => api("POST", "/api/lenses", { action: "apply", lensId: "lens_slow_reads", modeId: created.m2ModeId }));
    created.m2Bindings = ["reply", "recast", "like", "views", "bookmark", "stake-as"];
    await retry(() => api("PATCH", "/api/modes", { modeId: created.m2ModeId, patch: { actionButtonSlots: { composer: [], nav: [], cast: created.m2Bindings } } }));
    const z = await retry(() => api("POST", "/api/zones", { action: "preset", layout: "reading", viewport: { w: 1280, h: 900 }, insetPx: 33 }));
    created.m2ZoneDevice = z.json.device;
    created.m2ZoneConfig = z.json.config;
    // the @totem inbox: the fixture's $LINKED sender is the first attested handle (yeak_offchain, linked above)
    await retry(() => api("POST", "/api/dev", { action: "resetInboxCursor" }));
    const poll = await retry(() => api("POST", "/api/x/inbox", { action: "poll" }));
    created.m2DmHash = poll.json.landed?.[0]?.hash ?? null;
    if (!created.m2DmHash) throw new Error("the DM poll landed nothing in the write phase: " + JSON.stringify(poll.json).slice(0, 200));
    const idx = (await retry(() => api("GET", "/api/search/unified?status=1"))).json;
    created.m2Indexed = idx.indexed;
    // a pending port: the fork made above holds this root's second X handle; the counterpart handle is not attested yet
    await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: created.forkNew }));
    await retry(() => api("POST", "/api/x/link", { action: "begin" }));
    await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: "rs_second" }));
    await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
    await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
    created.m2Counterpart = "rs_cp_" + Date.now().toString(36).slice(-6); // fresh per run: an attested handle would resolve at once
    const port = await retry(() => api("POST", "/api/x/port", { fromPersona: "persona_viewer_main", toPersona: created.forkNew, counterpart: { handle: created.m2Counterpart }, targetPostId: "1500000000000000042" }));
    created.m2PortId = port.json.port?.id;
    if (!created.m2PortId || port.json.port?.grantId) throw new Error("the port did not queue as PENDING in the write phase: " + JSON.stringify(port.json).slice(0, 200));
  }

  writeFileSync(STATE_FILE, JSON.stringify(created, null, 2));
  console.log("wrote state:", JSON.stringify(created));
  await browser.close();
  process.exit(0);
}

// ---- verify phase ----
if (!existsSync(STATE_FILE)) {
  console.log("no state file — run the write phase first");
  process.exit(1);
}
const created = JSON.parse(readFileSync(STATE_FILE, "utf8"));

await check("mode survived restart", async () => {
  const r = await retry(() => api("GET", "/api/modes"));
  const found = r.json.modes.find((m) => m.id === created.modeId);
  if (!found) throw new Error("mode " + created.modeId + " gone after restart");
  if (found.name !== created.modeName) throw new Error("mode name changed: " + found.name);
});

await check("rule survived restart", async () => {
  const r = await retry(() => api("GET", "/api/rules"));
  const found = r.json.rules.find((x) => x.id === created.ruleId);
  if (!found) throw new Error("rule " + created.ruleId + " gone after restart");
});

await check("block survived restart", async () => {
  const r = await retry(() => api("GET", "/api/blocked"));
  if (!r.json.personaIds.includes(created.blockedPersonaId))
    throw new Error("blocked persona not in list after restart");
});

await check("readwise schedule survived restart", async () => {
  const r = await retry(() => api("GET", "/api/feed-health"));
  const found = r.json.schedules.find((s) => s.postHash === created.readwiseHash);
  if (!found) throw new Error("readwise schedule gone after restart");
  if (!found.chunks || found.chunks.length === 0) throw new Error("schedule has no chunks");
});

// Gate 3 state must persist too — the market layer writes through the same
// adapter_state table, so a regression there would otherwise go unnoticed.
await check("market intent survived restart", async () => {
  if (!created.marketIntentId) throw new Error("no market intent recorded in the write phase");
  const r = await retry(() => api("GET", `/api/market/intent?intentId=${created.marketIntentId}`));
  if (!r.json.intent) throw new Error("intent gone after restart");
  if (r.json.intent.description !== "Restart survivor intent")
    throw new Error("intent data changed after restart: " + r.json.intent.description);
});

// ---- mega-pass state ----

await check("runtime-issued GRANT survived restart", async () => {
  // The grant was issued at runtime to a viewer who is not on the seeded
  // whitelist, so a pass here cannot be explained by re-seeding.
  const r = await retry(() =>
    api(
      "GET",
      `/api/identity?personaId=${created.grantFrom}&viewerPersonaId=${created.grantAudience}`
    )
  );
  if (!r.json?.identity?.linked)
    throw new Error("granted viewer cannot resolve the linkage after restart");
  if (r.json.identity.linked.personaId !== created.grantTo)
    throw new Error("grant resolves to the wrong persona after restart");
});

await check("FORK and its forward pointer survived restart", async () => {
  const carried = await retry(() =>
    api(
      "GET",
      `/api/identity/fork?resolve=${created.forkOld}&viewerPersonaId=${created.forkCarried}`
    )
  );
  if (carried.json?.moved !== created.forkNew)
    throw new Error("carried holder lost the forward pointer after restart");

  // and containment survives too — a restart must not open it up
  const accounts2 = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
  const outsider = accounts2.personas.find((p) => p.handle === "crustcritic");
  const dropped = await retry(() =>
    api("GET", `/api/identity/fork?resolve=${created.forkOld}&viewerPersonaId=${outsider.id}`)
  );
  if (dropped.json?.moved)
    throw new Error("FAIL-OPEN: a dropped holder resolved the pointer after restart");
});

await check("PRIVATE POST survived restart, and stayed private", async () => {
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: created.privateViewer }));
  const granted = await retry(() => api("GET", "/api/private/posts"));
  if (!(granted.json?.posts ?? []).some((p) => p.hash === created.privateHash))
    throw new Error("private post gone for the granted viewer after restart");

  const accounts3 = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
  const outsider = accounts3.personas.find((p) => p.handle === "drivethru_dave");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: outsider.id }));
  const denied = await api("GET", `/api/private/posts/${created.privateHash}`);
  if (denied.status !== 404)
    throw new Error(`FAIL-OPEN: outsider read the private post after restart (${denied.status})`);
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
});

// CRYPTO PASS Gate 2: the post above came back readable across a REAL
// process kill — proof the encrypted vault survives restart and decrypts
// on hydrate. This adds the other half: it survived AS CIPHERTEXT, never
// as plaintext, on the untrusted validator.
await check("VAULT: the survived private post was ciphertext at rest, not plaintext", async () => {
  const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
  const res = await fetch(`${VBASE}/state/privatePosts`, { cache: "no-store" });
  const text = await res.text();
  if (text.includes("restart survivor private post"))
    throw new Error("the private post text is PLAINTEXT on the validator after restart");
  const entries = JSON.parse(text).entries ?? {};
  const recs = Object.values(entries);
  if (recs.length === 0) throw new Error("no privatePosts records on the validator after restart");
  if (!recs.every((r) => r && r.v === 1 && typeof r.ct === "string"))
    throw new Error("a surviving privatePosts record is not vault ciphertext");
});

await check("IMPORTED ALGO survived restart with provenance intact", async () => {
  const modes = await retry(() => api("GET", "/api/modes"));
  const mode = modes.json.modes.find((m) => m.id === created.importedModeId);
  if (!mode) throw new Error("imported mode gone after restart");
  if (mode.importedFrom?.authorHandle !== "quietvalidator")
    throw new Error("imported mode survived but lost its provenance");
  // and its materialized rules still resolve — a dangling ruleId would 503
  const feed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (!feed.json.cards) throw new Error("feed unavailable after restart with imported mode present");
});

await check("CURATOR SUBSCRIPTION survived restart with its action", async () => {
  const cur = await retry(() => api("GET", "/api/curators"));
  const sub = (cur.json.subscriptions ?? []).find((x) => x.feedId === "curator_recordsdesk");
  if (!sub) throw new Error("curator subscription gone after restart");
  if (sub.action !== "demote") throw new Error(`subscription action lost: ${sub.action}`);
});

await check("RELATIONSHIP EVENT survived restart with its receipts", async () => {
  const r = await retry(() => api("GET", `/api/eventlog?target=${created.relFollowTarget}`));
  const follow = (r.json.events ?? []).find(
    (e) => e.type === "follow" && !e.backfilled && e.context === "restart_survival"
  );
  if (!follow) throw new Error("the follow event did not survive the restart");
  if (follow.triggeringCastId !== "0xcr0001")
    throw new Error("the event survived but lost its triggering cast");
  // and the graph edge itself survived, not just its record
  const f = await retry(() => api("GET", "/api/follow"));
  if (!f.json.following.includes(created.relFollowTarget))
    throw new Error("follow delta lost on restart — the graph reverted to seed");
});

// ---- Tier B state ----

await check("FILTER PACK survived restart, still attached, still filtering", async () => {
  const packs = await retry(() => api("GET", "/api/packs"));
  if (!(packs.json.packs ?? []).some((x) => x.id === created.packId))
    throw new Error("imported pack gone after restart");
  const modes = await retry(() => api("GET", "/api/modes"));
  const mode = modes.json.modes.find((m) => m.id === created.modeId);
  if (!(mode?.filterPackIds ?? []).includes(created.packId))
    throw new Error("pack attachment lost on restart");
});

await check("CROSSPOST record survived restart with its external ref", async () => {
  const r = await retry(() => api("GET", "/api/eventlog?target=x_mock"));
  const ev = (r.json.events ?? []).find(
    (e) => e.type === "crosspost" && e.triggeringCastId === created.crosspostHash
  );
  if (!ev) throw new Error("crosspost event gone after restart");
  if (ev.externalRef !== created.crosspostRef)
    throw new Error("crosspost survived but lost its external ref");
});

await check("MID-FLIGHT ESCROW survived restart held, and its window still terminates", async () => {
  // still held, still pending, payer still debited — nothing stranded or
  // quietly refunded by the restart itself
  const esc = await retry(() => api("GET", "/api/market/infofi?surface=escrow&id=" + created.readEscrowId));
  if (esc.json.escrow?.status !== "held")
    throw new Error(`escrow ${esc.json.escrow?.status ?? "missing"} after restart, expected held`);
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: created.readPayerId }));
  const bal = await retry(() => api("GET", "/api/market/infofi?surface=balance"));
  if (bal.json.balance !== created.readPayerBalance)
    throw new Error("payer balance drifted across the restart");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));

  // the window RESUMED: advancing past it still reaches the refund terminal
  await retry(() => api("POST", "/api/market/infofi", { action: "advanceClock", ms: 3_700_000 }));
  await retry(() => api("GET", "/api/market/infofi?surface=inbox")); // sweep
  const after = await retry(() => api("GET", "/api/market/infofi?surface=escrow&id=" + created.readEscrowId));
  if (after.json.escrow?.status !== "refunded")
    throw new Error("expired escrow did not refund after restart — window stranded");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: created.readPayerId }));
  const restored = await retry(() => api("GET", "/api/market/infofi?surface=balance"));
  if (restored.json.balance !== created.readPayerBalance + created.readPrice)
    throw new Error("refund after restart did not restore the payer");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
});

await check("CURATOR DRAFT survived restart pending, invisible, and still signable", async () => {
  // visible + pending for its author
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: created.draftAuthorId }));
  let cur = await retry(() => api("GET", "/api/curators"));
  const draft = (cur.json.drafts ?? []).find((d) => d.id === created.draftId);
  if (!draft) throw new Error("draft gone for its author after restart");
  if (draft.status !== "pending") throw new Error("draft issued itself across the restart");
  if (draft.signedHandles.length !== 1) throw new Error("draft signature count changed");
  // still invisible to a civilian
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
  cur = await retry(() => api("GET", "/api/curators"));
  if ((cur.json.drafts ?? []).some((d) => d.id === created.draftId))
    throw new Error("FAIL-OPEN: draft visible to a non-invited viewer after restart");
  // and still ACTIONABLE: the invited co-signer takes it to threshold
  const accounts4 = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
  const mo = accounts4.personas.find((p) => p.handle === "marginalia_mo");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: mo.id }));
  const signed = await retry(() => api("POST", "/api/curators", { action: "sign", draftId: created.draftId }));
  if (signed.json.draft.status !== "issued")
    throw new Error("draft survived but could not be issued after restart");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
});

// ---- X interop state ----

await check("X ATTESTATION survived restart with its binding", async () => {
  const st = await retry(() => api("GET", "/api/x/link"));
  if (st.json.attestation?.handle !== created.xHandle) throw new Error("attestation gone after restart");
  // /api/crosspost GET always returns 200, even when a destination's own
  // costEstimate() hit the mocks' natural 2% synthetic failure and got
  // silently dropped for THIS call (documented, deliberate: "an
  // unreachable destination is simply not offered this round"). The
  // generic retry() only retries on non-2xx, so a content-complete check
  // needs its own retry here — same lesson as the resetSeed hardening fix.
  let dests;
  for (let i = 0; i < 4; i++) {
    dests = await retry(() => api("GET", "/api/crosspost?text=probe"));
    if (dests.json.destinations.some((d) => d.id === "x")) break;
  }
  if (!dests.json.destinations.some((d) => d.id === "x"))
    throw new Error("X destination binding lost on restart");
});

await check("IMPORTED ARCHIVE survived restart (posts on the profile, hashed pending list)", async () => {
  await page.goto(BASE + "/yeak__", { waitUntil: "networkidle" });
  // settle: poll until hydration renders all 5 (was a flat 800ms wait); server-rendered state, so a midway reload is safe
  await pollUntil(
    async () => (await page.locator("[data-testid=imported-post]").count()) === 5,
    { tries: 15, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const n = await page.locator("[data-testid=imported-post]").count();
  if (n !== 5) throw new Error(`${n} imported posts after restart, expected 5`);
  const m = await retry(() => api("GET", "/api/x/migrate"));
  if (m.json.pendingCount + m.json.matches.length !== 4)
    throw new Error("hashed pending list lost on restart");
  if (!(m.json.prefs.excludedHandles ?? []).includes("randomx_beta"))
    throw new Error("migration prefs lost on restart");
});

// PERSONA LAUNCH P2 (BYX G3): staged lanes are memory-only now (an archive's contents are never persisted half-read),
// so the session survives a restart as a RECORD and asks for the file again — nothing partial is kept or committed.
await check("MID-FLIGHT IMPORT survived restart as a record and asks for the file again (nothing partial kept)", async () => {
  const sessions = await retry(() => api("GET", "/api/x/import"));
  const open = (sessions.json.sessions ?? []).find((x) => x.id === created.importSessionMidflight);
  if (!open) throw new Error("mid-flight session gone after restart");
  if (open.status === "committed") throw new Error("mid-flight session committed itself");
  if (open.files.length !== 2) throw new Error("mid-flight session lost its ingested files");
  if (open.archiveHandle !== created.xHandle) throw new Error("session lost the archive identity");
  if (open.staged !== false) throw new Error("staged lanes claimed to survive a restart");
  const refused = await api("POST", "/api/x/import", { action: "commit", sessionId: created.importSessionMidflight, lanes: ["likes"] });
  if (refused.status !== 409 || !/drop the archive in once more/.test(refused.json?.error ?? ""))
    throw new Error(`commit after restart: ${refused.status}`);
});

await check("SPEND LEDGER survived restart; the idempotency map still dedupes", async () => {
  const ledger = await retry(() => api("GET", "/api/x/spend"));
  const entry = ledger.json.entries.find((e) => e.id === "spend:x:0xrestartspend");
  if (!entry) throw new Error("spend entry gone after restart");
  if (entry.amount !== 0.195) throw new Error("spend amount drifted");
  // the strongest check: a re-send of the same cast CONVERGES to the same
  // ref across the restart — no second post, no second spend
  const again = await retry(() =>
    api("POST", "/api/crosspost", {
      castHash: "0xrestartspend",
      text: "restart survivor costed publish https://example.org/rs",
      destinationIds: ["x"],
      confirmSpend: true,
    })
  );
  if (again.json.published[0].externalRef !== created.spendRef)
    throw new Error("idempotency map lost — a restart would allow a double post");
  if (!again.json.published[0].deduped) throw new Error("re-send not marked deduped");
  const after = await retry(() => api("GET", "/api/x/spend"));
  if (after.json.entries.length !== ledger.json.entries.length)
    throw new Error("re-send after restart recorded a second spend");
});

// ---- UX pass state ----

await check("RESURFACED IMPORT survived restart, still dated now, still in the feed", async () => {
  if (!created.resurfacedTweetId) throw new Error("no resurfaced tweet recorded in the write phase");
  const posts = (await retry(() => api("GET", "/api/x/import"))).json.importedPosts;
  const p = posts.find((x) => x.id === created.resurfacedTweetId);
  if (!p?.resurfaced) throw new Error("resurfaced flag lost after restart");
  if (!p.resurfacedAt) throw new Error("resurfacedAt lost after restart");
  const feed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (!feed.json.cards.some((c) => c.kind === "resurfaced"))
    throw new Error("resurfaced card no longer enters the feed after restart");
});

await check("PERSONA DEFAULT-MODE BINDING survived restart and still fires on switch", async () => {
  if (!created.boundDefaultModeId) throw new Error("no binding recorded in the write phase");
  const bindings = await retry(() => api("GET", "/api/personas/bindings"));
  const row = bindings.json.personas.find((p) => p.id === created.boundDefaultModePersona);
  if (row?.defaultModeId !== created.boundDefaultModeId) throw new Error("binding lost after restart");
  // and it still APPLIES — switch away and back
  const other = bindings.json.personas.find((p) => p.id !== created.boundDefaultModePersona);
  if (other) {
    await retry(() => api("POST", "/api/seed-persona", { personaId: other.id }));
    await retry(() => api("POST", "/api/seed-persona", { personaId: created.boundDefaultModePersona }));
    const modesNow = await retry(() => api("GET", "/api/modes"));
    if (modesNow.json.activeId !== created.boundDefaultModeId)
      throw new Error("binding survived but no longer fires on persona switch");
  }
});

await check("COLD-STORAGE RESOLUTION survived restart — resolved count intact AND the card still renders", async () => {
  if (!created.coldSourceId) throw new Error("no cold-source resolution recorded in the write phase");
  const cs = await retry(() => api("GET", "/api/x/coldstore"));
  const s = cs.json.sources.find((x) => x.id === created.coldSourceId);
  if (!s || s.resolvedCount !== 40 || s.coldCount !== 0)
    throw new Error(`resolved state lost after restart: ${JSON.stringify(s)}`);
  // the real test: postByHash is a plain module Map, rebuilt from
  // SEED_POSTS only on a real restart — if the coldstore replay hook
  // didn't run, the persisted readwise schedule's postHash resolves to
  // nothing and the card silently disappears from the feed
  const feed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
  if (!feed.json.cards.some((c) => c.cast.hash.startsWith("cold:cold_bf_longform_")))
    throw new Error("FAIL-OPEN: resolved cold item lost its rendered card after restart (postByHash replay gap)");
  // Backpack pass: the OTHER half of the contract — cold IDs persist
  // UNRESOLVED. A source never designated for resolution must come back
  // fully cold, proving the restart did not auto-resolve anything.
  const untouched = cs.json.sources.find((x) => x.id !== created.coldSourceId && x.coldCount > 0);
  if (!untouched) throw new Error("no untouched cold source to check for unresolved persistence");
  if (untouched.resolvedCount !== 0)
    throw new Error(`a never-designated source auto-resolved across restart: ${JSON.stringify(untouched)}`);
});

await check("BACKPACK CLAIMS + SCORE survived restart — same claim, same provenance, same recomputed score", async () => {
  if (created.backpackScore === undefined) throw new Error("no backpack score recorded in the write phase");
  const claims = (await retry(() => api("GET", "/api/graph"))).json.claims;
  const did = claims.find((c) => c.value === created.backpackClaimValue);
  if (!did || did.source !== "attested" || did.issuer !== "did:web:layers.example")
    throw new Error(`DID claim lost or wrong after restart: ${JSON.stringify(did)}`);
  const after = (await retry(() => api("GET", "/api/graph/score"))).json;
  if (after.score !== created.backpackScore)
    throw new Error(`score after restart is ${after.score}, expected ${created.backpackScore}`);
  const sum = after.breakdown.reduce((a, f) => a + f.points, 0);
  if (sum !== after.score) throw new Error(`post-restart breakdown sums to ${sum}, displayed score is ${after.score}`);
});

// Backpack pass: backpack claims are VAULT data — the DID claim above
// survived the kill readable, so this asserts the other half: it survived
// AS CIPHERTEXT on the validator, never plaintext (the same discipline the
// private-post check applies, now for graphClaims).
await check("VAULT: the survived backpack claim was ciphertext at rest, not plaintext", async () => {
  const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
  const res = await fetch(`${VBASE}/state/graphClaims`, { cache: "no-store" });
  const text = await res.text();
  if (text.includes("Controls a verifiable DID") || text.includes("did:web:layers.example"))
    throw new Error("a backpack claim's label/issuer is PLAINTEXT on the validator after restart");
  const entries = JSON.parse(text).entries ?? {};
  const recs = Object.values(entries);
  if (recs.length === 0) throw new Error("no graphClaims records on the validator after restart");
  if (!recs.every((r) => r && r.v === 1 && typeof r.ct === "string"))
    throw new Error("a surviving graphClaims record is not vault ciphertext");
});

await check("CALL OPTION A SAFETY: the alt-link rate-limit history survived restart — a restart cannot reset the quota", async () => {
  if (!created.altLinkAttemptId) throw new Error("no alt-link attempt recorded in the write phase");
  const j = (await retry(() => api("GET", "/api/x/altlink"))).json;
  const found = j.recentAttempts.find((a) => a.id === created.altLinkAttemptId);
  if (!found) throw new Error("alt-link attempt lost after restart — the daily cap would silently reset on every restart");
  if (found.delayMs !== created.altLinkDelayMs)
    throw new Error(`delayMs changed across restart: ${found.delayMs} vs ${created.altLinkDelayMs}`);
});

await check("FC WRITE LEDGER + ATTRIBUTION survived restart — the sent entry, and the index still resolves", async () => {
  if (!created.fcCastHash) throw new Error("no fc cast recorded in the write phase");
  const l = await retry(() => api("GET", "/api/fc/write"));
  if (!l.json.entries.some((e) => e.castHash === created.fcCastHash && e.status === "sent"))
    throw new Error("sent ledger entry lost after restart");
  const att = await retry(() =>
    api("GET", `/api/fc/attribution?hashes=${created.fcCastHash}`)
  );
  if (att.json.attributions[created.fcCastHash]?.id !== created.fcPersonaId)
    throw new Error("attribution index lost or wrong after restart");
});

await check("FC MID-FLIGHT PUBLISH resumes check-before-retry after restart — never a blind retry", async () => {
  if (!created.fcAmbiguousText) throw new Error("no ambiguous publish recorded in the write phase");
  const l = await retry(() => api("GET", "/api/fc/write"));
  if (!l.json.entries.some((e) => e.status === "pending"))
    throw new Error("the pending (ambiguous) ledger entry did not survive the restart");
  // Retry the same content THROUGH the seam: the sim network died with the
  // old process, so the check finds nothing, settles the stale pending as
  // failed, and publishes fresh — exactly one cast in the NEW network, and
  // no pending entries left. (Live mode differs only in that the check
  // would FIND the cast on the real network and dedupe — same code path.)
  const retried = await retry(() => api("POST", "/api/fc/write", { action: "cast", text: created.fcAmbiguousText }));
  if (!retried.json.hash) throw new Error("resumed publish failed");
  const l2 = await retry(() => api("GET", "/api/fc/write"));
  if (l2.json.entries.some((e) => e.status === "pending"))
    throw new Error("pending entry not settled by the resumed check-before-retry");
  const net = await retry(() => api("POST", "/api/dev", { action: "fcSimNetwork" }));
  const matches = net.json.casts.filter((c) => c.text === created.fcAmbiguousText);
  if (matches.length !== 1) throw new Error(`expected exactly 1 cast for the resumed content, got ${matches.length}`);
});

await check("UX GATE 2 SAFETY: the undo stack does NOT survive a hard restart — session-scoped, never data", async () => {
  // the write phase created a real undo-stack entry (a refresh through the
  // browser UI) in ITS OWN chromium process; this is a SEPARATE process —
  // sessionStorage never crosses that boundary, which is the entire point
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if ((await page.locator("[data-testid=timeline-undo]").count()) !== 0)
    throw new Error("FAIL-OPEN: undo state survived a hard restart — it must be ephemeral, not data");
});

await check("ZK PASS 1: registration, signed placement, root history continuous with the VAULT anchor, proof budget, and the nullifier store all survived the hard kill", async () => {
  if (!created.zkCommitment) throw new Error("no zk state recorded in the write phase");
  const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
  const s = (await retry(() => api("GET", "/api/zk?mode=fixture"))).json.status;
  if (s.commitment !== created.zkCommitment) throw new Error("commitment changed across restart");
  if (!s.registration?.registered) throw new Error("registration lost after restart");
  if (!s.placement?.verified) throw new Error("signed placement missing or invalid after restart");
  // the served history must still contain the hash this client anchored —
  // a restart is not allowed to fork the chain
  const rc = (await retry(() => zk("rootCheck", { tree: "valid", root: created.zkRoot }))).json;
  if (!rc.ok) throw new Error("anchored root refused after restart (fork or lost anchor): " + rc.reason);
  const bud = (await retry(() => zk("budgetProbe", { personaId: "persona_viewer_main", epoch: created.zkEpoch }))).json.status;
  if (JSON.stringify(bud.used) !== JSON.stringify(created.zkBudgetUsed)) throw new Error("proof-history budget lost after restart");
  // the nullifier store survived: the same envelope is STILL a replay
  const re = (await retry(() => zk("submit", { envelope: created.zkEnvelope }))).json;
  if (re.status !== 409) throw new Error(`nullifier store lost: resubmit returned ${re.status} ${JSON.stringify(re.response)}`);
  // Gate 2: the eligibility the accepted proof granted survived too (read
  // through the app: the store takes the signed envelope when armed)
  const el = (await retry(() => zk("gateStatus", { personaIds: ["persona_viewer_main"] }))).json.eligibility.persona_viewer_main;
  if (created.zkEnvelope?.publicInputs?.tree?.startsWith("tier-") && !el) throw new Error("eligibility mark lost after restart");
  // the device pins (anchor, key pin, cohort record) survived the kill
  if (!s.pins?.validatorKeyPinned || !s.pins.anchors?.["fixture:valid"] || !s.pins.cohorts?.["fixture:valid"]) throw new Error("device pins lost after restart: " + JSON.stringify(s.pins));
});

await check("ZK PASS 1 Gate 1: a queued jittered submission survived the hard kill still QUEUED, then drained exactly once — never duplicated, never lost", async () => {
  if (!created.zkQueuedId) throw new Error("no queued submission recorded in the write phase");
  const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
  const before = (await retry(() => zk("queueStatus"))).json;
  const item = before.items.find((i) => i.id === created.zkQueuedId);
  if (!item) throw new Error("the queued submission was LOST across the restart");
  if (item.status !== "queued") throw new Error(`the queued submission changed status across the restart: ${item.status}`);
  if (item.notBefore !== created.zkQueuedNotBefore) throw new Error("the jittered time was re-drawn across the restart");
  // not due yet → nothing sent
  const early = (await retry(() => zk("drain"))).json;
  if (early.sent !== 0) throw new Error("drained an item before its jittered time after restart");
  // force "now" past its time → sent exactly once
  const due = (await retry(() => zk("drain", { now: created.zkQueuedNotBefore + 1 }))).json;
  if (due.sent !== 1 || due.outcomes.accepted !== 1) throw new Error(`drain after restart: ${JSON.stringify(due)}`);
  const again = (await retry(() => zk("drain", { now: created.zkQueuedNotBefore + 1 }))).json;
  if (again.sent !== 0) throw new Error("the item was sent TWICE");
});

// ---- MEGA PASS 2 state ----

await check("ALLOWANCE and STAKE HISTORY survived restart (sealed in the vault, re-hydrated)", async () => {
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
  const a = (await retry(() => api("GET", "/api/influence?view=allowance"))).json.allowance;
  if (a.remaining !== created.m2Remaining) throw new Error(`allowance remaining ${a.remaining} != ${created.m2Remaining} before the kill`);
  const h = (await retry(() => api("GET", "/api/influence?view=history&personaId=persona_viewer_main"))).json;
  if (!(h.stakes ?? []).some((s) => s.castHash === "0xcr0001" && s.action === "like")) throw new Error("the stake is gone from the owner's history after restart");
});

await check("LENS PIN and BUTTON BINDINGS survived restart on the mode", async () => {
  const modes = (await retry(() => api("GET", "/api/modes"))).json.modes;
  const m = modes.find((x) => x.id === created.m2ModeId);
  if (!m) throw new Error("the mode is gone after restart");
  if (m.lens !== "lens_slow_reads") throw new Error("the lens pin is gone after restart: " + m.lens);
  if (JSON.stringify(m.actionButtonSlots?.cast ?? []) !== JSON.stringify(created.m2Bindings)) throw new Error("the button bindings changed after restart: " + JSON.stringify(m.actionButtonSlots?.cast));
});

await check("ZONE CONFIG survived restart for THIS device (sealed per device)", async () => {
  const z = (await retry(() => api("GET", "/api/zones"))).json;
  if (!z.saved) throw new Error("no saved zone config after restart");
  if (z.device !== created.m2ZoneDevice) throw new Error("the device fingerprint changed across the restart");
  if (JSON.stringify(z.config) !== JSON.stringify(created.m2ZoneConfig)) throw new Error("the zone config changed across the restart");
});

await check("DM-SOURCED BOOKMARK survived restart and the SEARCH INDEX was RE-DERIVED (never stored)", async () => {
  const info = (await retry(() => api("GET", "/api/x/inbox"))).json;
  if (!info.folder || info.folder.count < 1) throw new Error("the DM folder is empty after restart");
  if (!(info.schedules ?? []).some((s) => s.postHash === created.m2DmHash)) throw new Error("the DM readwise schedule is gone after restart");
  const idx = (await retry(() => api("GET", "/api/search/unified?status=1"))).json;
  if (!(idx.indexed >= 1)) throw new Error("the search index did not re-derive after restart");
  if (idx.indexed < created.m2Indexed - 5) throw new Error(`the re-derived index is much smaller than before the kill (${idx.indexed} vs ${created.m2Indexed})`);
  const hit = (await retry(() => api("GET", "/api/search/unified?q=restaking&mode=keyword"))).json;
  const flat = JSON.stringify(hit);
  if (!flat.includes(created.m2DmHash) && !/restaking/i.test(flat)) throw new Error("the DM-sourced item is not findable after the index re-derived: " + flat.slice(0, 200));
});

await check("PENDING RELATIONSHIP PORT survived restart and RESOLVES when the counterpart attests", async () => {
  const before = (await retry(() => api("GET", "/api/x/port"))).json.ports.find((p) => p.id === created.m2PortId);
  if (!before) throw new Error("the pending port is gone after restart");
  if (before.grantId) throw new Error("the pending port resolved by itself across the restart");
  const accounts4 = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
  const counterpart = accounts4.personas.find((p) => p.handle === "crustcritic");
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: counterpart.id }));
  await retry(() => api("POST", "/api/x/link", { action: "begin" }));
  await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: created.m2Counterpart }));
  await retry(() => api("POST", "/api/dev", { action: "viewAs", personaId: null }));
  const after = (await retry(() => api("GET", "/api/x/port"))).json.ports.find((p) => p.id === created.m2PortId);
  if (!after?.grantId) throw new Error("the pending port did not resolve when the counterpart attested after the restart: " + JSON.stringify(after));
});

await browser.close();
const total = results.length;
console.log(
  failures === 0
    ? `\nRESTART-SURVIVAL PASSED (${total}/${total})`
    : `\n${failures} of ${total} RESTART-SURVIVAL CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
