// PUBLIC GO-LIVE — THE GUIDED FIRST RUN AND PUBLIC LIVE MODE, CALLED DIRECTLY (node only: no server, no browser, no network).
//
// Bundles the pure modules with esbuild (the unit-siwf.mjs recipe) and calls them:
//   U1  the step machine (lib/onboarding/state.ts), the owner's three steps: Welcome → Sign in with Farcaster → This is
//       you → Keep your account → done, with NO persona step (a persona is optional, made on /home: a machine that asks
//       for one in any of 128 fact/progress shapes fails), each skip, the anon page's click-through, Back, the 3-dot
//       indicator, and THE RETURNING-VISITOR RULE (restored or unlocked, and signed in or with a persona → never the flow)
//   U2  the X step's lookup (lib/onboarding/xHandle.ts): a whole-file index, looked up by fid locally; NEVER FAIL OPEN —
//       a failed download, an index that is not built, a malformed answer are all "unknown", never "none"
//   U3  the device-made picture (lib/identity/localAvatar.ts): deterministic, distinct, small, an inline data URI that
//       names no host (no request to anyone when it renders)
//   U4  the switch (lib/platform/publicLive.ts): the server half (a public deployment with PUBLIC_LIVE=true, nothing else),
//       the boot refusal and warning matrix, the device half (PUBLIC_LIVE=on only), the forwarded hint, and the
//       DELIBERATE DUPLICATE isPublicShape == env-contract isPublicDeployment over a matrix
//   U5  the world (lib/world-flag.ts): bank() takes the empty twin on a live public server and in a live tab, never on the
//       rig; isEmptyWorld() is true in a live tab only (the empty world's partition then runs there)
//   U6  ORDER: components/device/loadDevice.ts declares window.__LAYERS_DEVICE_ENV BEFORE it injects device.js (a fake
//       DOM records the env at the moment the device script is appended), and a bundle that reads bank() at module load
//       through the device's process shim sees PUBLIC_LIVE only when the env was declared first (the late-flag case
//       loads the demo bank: exactly why the order matters)
//   U7  where a post goes (state.ts readAnonDestination / destinationSentenceOf): the anon route's contract, validated;
//       the fallback uses the route's own existing words, never words of its own; nothing usable → null
//   U8  small pure helpers: isPhoneLike, suggestHandle; This is you's username: handleFromFname, handleSuggestions (three
//       free alternatives to a username taken inside Totem, deterministic, never the taken one)
//   U9  validator/seed.js under PUBLIC_LIVE (a child process on a temporary database): a live public validator seeds
//       nothing and refuses --force; a bad value refuses (78); an already-seeded database is left byte for byte; the
//       rig ignores the flag (and says so) and seeds its demo world
//   U10 the wiring, pinned in the sources (what a node harness cannot render): the device env forwards the hint, boot
//       mints nothing in live mode, the boot refuses a bad value and keeps the LAYERS_WORLD refusal first, the landing's
//       three doors, the nudge's "Finish setting up", the composer's contract fields, the fixture-only nav slots
//   U11 (F1) THE ANONYMOUS UNIVERSE HINT reaches every tab: lib/device/deviceEnv.server.ts deviceEnv() (bundled with its
//       server-only neighbours stubbed) forwards ZK_ANON_UNIVERSE=live AND ZK_MODE=live when the app holds
//       ZK_ANON_UNIVERSE=live — over the app's own ZK_MODE=fixture — "invalid" for any other value (never the value
//       itself), and nothing at all when unset (the object is otherwise byte for byte the same)
//   U12 (F5) AN EXPLICIT TARGET: farcaster|profile|save lands on that step (#profile needs a sign-in; #x and #persona are
//       gone with their steps) even for a returning visitor that is done
//       and past this document's skips; next lands past the welcome screen; unlock opens the welcome screen's unlock even
//       when the visitor is not fresh; anything else is no target; the app's hrefs carry the target in the HASH only (the
//       server never sees it) and round-trip; ?step= is read too and wins
//   U13 (F2) SIGN IN AGAIN: the offer follows the anon route's own words — run through lib/zk/anon/availability.ts itself
//       in a live, armed tab (not a leaf, a failed join, a join not listed → offered; joined with a time, under the floor,
//       a leaf → not), plus the hint and the sign-in both required, and anything unreadable offers nothing
//   U16 (final verify) THE REGISTRATION LANE (lib/adapters/mock/persist.ts): a bootstrap in flight across an identity change
//       (device loss, recovery, an unlock or a link) never leaves this device registered under the OLD identity: it runs
//       again for the current one, and enrollWithSeed waits for it, so the last registration to land is the current one
//   U14 THE WIRING the node harness renders or pins: the guest door (/anon in live mode, /home on the preview), the Save
//       step's lead by where the identity lives, the Farcaster step's after-reload sentence, NoPersonaYet's link, every
//       /welcome link's target, the Farcaster card's and the composer's "sign in again", the onboarding's target plumbing,
//       and the live reads sentence (the preview's words byte for byte, "this site" in live mode, landing = /help)
//   M   MUTATIONS: each guard is removed in the BUNDLE (or the child's copy) ONLY — the repo is never touched — and the
//       check that covers it must then FAIL (a check that cannot fail is not evidence)
//
//   node scripts/unit-onboarding.mjs            (npm run test:onboard-unit)
//   node scripts/unit-onboarding.mjs --only=U1,U6
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);

let passed = 0;
let failed = 0;
const failedIds = [];
async function check(id, name, fn) {
  if (!want(id)) return;
  try {
    const extra = await fn(M);
    passed++;
    console.log(`  PASS  ${id} ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failedIds.push(id);
    console.log(`  FAIL  ${id} ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}
const src = (rel) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------------- bundles
const tmp = mkdtempSync(path.join(os.tmpdir(), "unit-onboarding-"));
const S = (n) => path.join(tmp, n);
writeFileSync(
  S("entry.ts"),
  `export * as state from "@/lib/onboarding/state";
export * as xh from "@/lib/onboarding/xHandle";
export * as avatar from "@/lib/identity/localAvatar";
export * as live from "@/lib/platform/publicLive";
export * as contract from "@/lib/platform/env-contract";
export * as world from "@/lib/world-flag";
`
);
writeFileSync(S("load-entry.ts"), `export * as loader from "@/components/device/loadDevice";\n`);
// PUBLIC GO-LIVE (F1, F2, F5, F8, F10, F11): the device env builder, availability's real sentences, and the step components
writeFileSync(S("deviceenv-entry.ts"), `export { deviceEnv } from "@/lib/device/deviceEnv.server";\n`);
writeFileSync(S("avail-entry.ts"), `export * from "@/lib/zk/anon/availability";\n`);
writeFileSync(
  S("render-entry.tsx"),
  `export { WelcomeStep } from "@/components/onboarding/steps/WelcomeStep";
export { SaveStep, SAVE_LEAD, NOT_NOW_NOTE } from "@/components/onboarding/steps/SaveStep";
export { FarcasterStep, FARCASTER_LEAD, SIGN_IN_AGAIN_AFTER_RELOAD } from "@/components/onboarding/steps/FarcasterStep";
export { takenSentence, fnameStaysSentence } from "@/components/onboarding/steps/ProfileStep";
export { Progress } from "@/components/onboarding/Progress";
export { NoPersonaYet } from "@/components/world/NoPersonaYet";
export * as copy from "@/components/help/privacy-copy";
export * as React from "react";
export { renderToStaticMarkup } from "react-dom/server";
`
);
writeFileSync(S("stub-server-only.ts"), "export {};\n");
writeFileSync(S("stub-readrelay.ts"), "export function relayArmed() { return false; }\n");
writeFileSync(S("stub-siwf-flow.ts"), "export function siwfDeviceHints() { return {}; }\n");
writeFileSync(S("stub-registry.ts"), "export function currentRepImpl() { return 'mock'; }\n");
writeFileSync(S("stub-providers.ts"), "export function useApp() { return globalThis.__OB_APP ?? { publicLive: false }; }\n");
writeFileSync(S("stub-next-link.tsx"), `import * as React from "react";\nexport default function Link(props: any) { const { href, children, prefetch, ...rest } = props; return React.createElement("a", { "data-next-link": "1", href, ...rest }, children); }\n`);
/** the device env builder's server-only neighbours, stubbed (the unit-prover E1 recipe) */
const DE_ALIAS = { alias: { "server-only": S("stub-server-only.ts"), "@/lib/fc/readRelay.server": S("stub-readrelay.ts"), "@/lib/fc/siwf/flow": S("stub-siwf-flow.ts") } };
const AV_ALIAS = { alias: { "@/lib/adapters/registry": S("stub-registry.ts") } };
const RENDER_OPTS = {
  jsx: "automatic",
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "server-only": S("stub-server-only.ts"), "next/link": S("stub-next-link.tsx"), "@/components/Providers": S("stub-providers.ts") },
};
// the late-flag probe: bank() read AT MODULE LOAD, through the device's process shim (as in device.js)
// PUBLIC GO-LIVE (final verify, U16): the persist client with its identity and storage neighbours stubbed, and fetch mocked
writeFileSync(S("persist-entry.ts"), `export * as persist from "@/lib/adapters/mock/persist";\n`);
writeFileSync(S("stub-storage.ts"), "export const storage = { readText() { throw new Error('no file'); }, writeText() {}, exists() { return false; } };\n");
writeFileSync(S("stub-keystore.ts"), `const ID = () => (globalThis as any).__U16;
export function deviceAuthPublicKey() { return ID().anchor; }
export function signAsDeviceAuth() { return "sig"; }
export function linkedDelegation() { return null; }
export function deviceAuthPublicKeyFromSeed(seed: string) { return "anchor-of-" + seed; }
export function signAsDeviceAuthWithSeed() { return "sig"; }
`);
writeFileSync(S("stub-devicekeys.ts"), `export function deviceIdentity() { return { deviceId: "dev-u16", pubHex: "ab".repeat(32) }; }
export function delegationCanonical(b: unknown) { return JSON.stringify(b); }
export function signAsDevice() { return "proof"; }
export function signEnvelope() { return "env"; }
`);
writeFileSync(S("stub-vault.ts"), "export function sealWhole(_ns: string, entries: unknown) { return { __whole: entries }; }\n");
const PERSIST_OPTS = {
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  alias: { "server-only": S("stub-server-only.ts"), "@/lib/platform/storage": S("stub-storage.ts"), "@/lib/identity/keystore": S("stub-keystore.ts"), "@/lib/identity/deviceKeys": S("stub-devicekeys.ts"), "@/lib/vault/vault": S("stub-vault.ts") },
};
writeFileSync(S("bank-entry.ts"), `import { bank, isEmptyWorld } from "@/lib/world-flag";\nexport const BANK = bank("demo", "empty");\nexport const EMPTY = isEmptyWorld();\n`);

function mutatePlugin(mutations, applied) {
  return {
    name: "mutate",
    setup(b) {
      if (!mutations.length) return;
      b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        const rel = args.path.split(path.sep).join("/");
        const mine = mutations.filter((m) => rel.endsWith(m.file));
        if (!mine.length) return undefined;
        let s = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        for (const m of mine) {
          if (!s.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + m.file + ": " + m.find.slice(0, 80));
          s = s.replace(m.find, m.replace);
          applied.add(m);
        }
        return { contents: s, loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
      });
    },
  };
}
let bundleN = 0;
async function bundle(entry, mutations = [], extra = {}) {
  const applied = new Set();
  const out = S(`bundle-${++bundleN}.mjs`);
  const { plugins: extraPlugins = [], ...rest } = extra;
  await build({
    plugins: [mutatePlugin(mutations, applied), ...extraPlugins],
    absWorkingDir: ROOT,
    entryPoints: [S(entry)],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    ...rest,
  });
  if (mutations.length && applied.size !== mutations.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
  return { out, mod: await import(pathToFileURL(out).href + "?n=" + bundleN) };
}

let M;
try {
  M = (await bundle("entry.ts")).mod;
} catch (e) {
  console.log("cannot bundle the onboarding modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

/** run `fn` with process.env patched (names set to undefined are deleted) and, optionally, a window global */
function withEnv(env, fn, { windowed = false } = {}) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const oldWindow = globalThis.window;
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (windowed) globalThis.window = {};
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (windowed) {
      if (hadWindow) globalThis.window = oldWindow;
      else delete globalThis.window;
    }
  }
}

console.log("\nUNIT ONBOARDING — the guided first run and public live mode (node only)");

// ---------------------------------------------------------------------------------------------------------------- checks
const CHECKS = {};

CHECKS.U1 = async (M) => {
  const { nextStep, previousStep, progressOf, skip, confirmProfile, signedInHere, NO_PROGRESS, ONBOARDING_STEPS, COUNTED_STEPS, returningAndDone, isDone } = M.state;
  // THE OWNER'S FLOW: three counted steps, and NO persona step anywhere in the machine
  assert(JSON.stringify(ONBOARDING_STEPS) === JSON.stringify(["welcome", "farcaster", "profile", "save", "done"]), "the step order: " + JSON.stringify(ONBOARDING_STEPS));
  assert(JSON.stringify(COUNTED_STEPS) === JSON.stringify(["farcaster", "profile", "save"]), "the counted steps: " + JSON.stringify(COUNTED_STEPS));
  const F = (o = {}) => ({ publicSelf: false, saved: false, personas: 0, returning: false, ...o });
  const P = (o = {}) => ({ ...NO_PROGRESS, ...o });
  // a fresh visitor walks every step, in order, as each fact is met — and is DONE with zero personas
  const walk = [
    [F(), P(), "welcome"],
    [F(), P({ started: true }), "farcaster"],
    [F({ publicSelf: true }), P({ started: true }), "profile"],
    [F({ publicSelf: true }), P({ started: true, profileSeen: true }), "save"],
    [F({ publicSelf: true, saved: true }), P({ started: true, profileSeen: true }), "done"],
  ];
  for (const [f, p, want] of walk) assert(nextStep(f, p) === want, `facts ${JSON.stringify(f)} progress ${JSON.stringify(p)} → ${nextStep(f, p)}, want ${want}`);
  // NEVER A FORCED PERSONA: every combination of facts and progress with zero personas ends without a persona step, and
  // the hand-off comes with zero personas once signed in and kept (saved, or "Not now")
  const steps = new Set();
  for (const publicSelf of [false, true]) for (const saved of [false, true]) for (const returning of [false, true]) for (const started of [false, true]) for (const profileSeen of [false, true]) for (const sk of [[], ["farcaster"], ["save"], ["farcaster", "save"]]) {
    steps.add(nextStep(F({ publicSelf, saved, returning }), P({ started, profileSeen, skipped: sk })));
  }
  assert([...steps].every((s) => ONBOARDING_STEPS.includes(s)) && !steps.has("persona"), "a step outside the three (a persona step?): " + JSON.stringify([...steps]));
  assert(nextStep(F({ publicSelf: true }), skip(confirmProfile(P()), "save")) === "done", "signed in, This is you confirmed, Not now → done with no persona");
  assert(isDone(F({ publicSelf: true })) === true && isDone(F({ personas: 1 })) === true && isDone(F()) === false, "done = someone to be: the Farcaster account, or a persona made earlier");
  // skips: Sign in with Farcaster's quiet Skip goes on to Keep your account (This is you needs a sign-in), then done
  let p = P({ started: true });
  const f0 = F();
  assert(nextStep(f0, p) === "farcaster", "start");
  p = skip(p, "farcaster");
  assert(nextStep(f0, p) === "save", "after skipping Farcaster: " + nextStep(f0, p));
  p = skip(p, "save");
  assert(nextStep(f0, p) === "done", "after Not now: " + nextStep(f0, p));
  // This is you: shown once in this document, then confirmed
  assert(nextStep(F({ publicSelf: true, saved: true }), P({ started: true })) === "profile" && nextStep(F({ publicSelf: true, saved: true }), confirmProfile(P())) === "done", "This is you comes once, for a signed-in visitor");
  // the anon page's click-through (started, a public self already held) resumes AFTER Farcaster
  assert(nextStep(F({ publicSelf: true }), P({ started: true })) === "profile", "from=anon with a public self resumes at This is you");
  assert(nextStep(F(), P({ started: true })) === "farcaster", "from=anon without one starts at Farcaster (never the welcome screen)");
  // THE RETURNING-VISITOR RULE
  assert(returningAndDone(F({ returning: true, publicSelf: true })) === true, "restored/unlocked and signed in is returning-and-done");
  assert(returningAndDone(F({ returning: true, personas: 2 })) === true, "restored/unlocked with personas made earlier is returning-and-done");
  assert(nextStep(F({ returning: true, publicSelf: true }), P()) === "done", "a returning, signed-in visitor never sees the flow (no persona needed)");
  assert(nextStep(F({ returning: false, publicSelf: true }), P()) === "profile", "a visitor signed in in THIS tab (not returning) is still shown This is you: " + nextStep(F({ publicSelf: true }), P()));
  // PUBLIC GO-LIVE (F10): a RESTORED identity never sees the welcome screen again, even with nothing met yet
  assert(nextStep(F({ returning: true, personas: 0 }), P()) === "farcaster", "a returning (restored) visitor with nothing yet lands on Farcaster, not Welcome: " + nextStep(F({ returning: true, personas: 0 }), P()));
  assert(nextStep(F({ returning: true, saved: true }), P()) === "farcaster", "a restored, saved identity with no sign-in lands on Farcaster (the runbook's step 8)");
  // ...and when it signs in HERE it is shown This is you (a sign-in made in this document is not a returning visitor's)
  const here = signedInHere(P({ started: true }));
  assert(nextStep(F({ returning: true, saved: true, publicSelf: true }), here) === "profile", "a saved identity signing in for the first time skips This is you: " + nextStep(F({ returning: true, saved: true, publicSelf: true }), here));
  assert(nextStep(F({ returning: true, saved: true, publicSelf: true }), confirmProfile(here)) === "done", "then home");
  assert(skip(here, "save").signedInHere === true && confirmProfile(here).signedInHere === true, "a skip or a confirmation keeps the sign-in made here");
  assert(nextStep(F({ returning: false }), P()) === "welcome", "a fresh, NOT restored visitor still starts at Welcome (the control)");
  // Back, and the indicator
  assert(previousStep("save") === "profile" && previousStep("profile") === "farcaster" && previousStep("farcaster") === "welcome" && previousStep("save", false) === "farcaster", "Back goes one counted step back (from Keep your account to Sign in when not signed in)");
  const at = progressOf("profile");
  assert(at && at.index === 2 && at.total === 3, "This is you is step 2 of 3: " + JSON.stringify(at));
  assert(progressOf("welcome") === null && progressOf("done") === null, "the welcome screen and the hand-off show no indicator");
  return "5-step walk, no persona step over " + 2 * 2 * 2 * 2 * 2 * 4 + " fact/progress shapes, skips, the returning rule, Back, 3 dots";
};

CHECKS.U2 = async (M) => {
  const { xHandleForFid, handleForFid, readXHandleAnswer, xHandleSentence } = M.xh;
  const index = { byFid: new Map([[990777, [0, 2]], [5, [1]]]), xu: ["oldhandle", "someone", "stubalice_x"], at: Float64Array.from([1000, 2000, 3000]) };
  let calls = 0;
  const ok = async () => {
    calls++;
    return { available: true, index };
  };
  const a = await xHandleForFid(990777, ok);
  assert(a.state === "connected" && a.handle === "stubalice_x" && a.verifiedAt === 3000000, "the most recently verified handle: " + JSON.stringify(a));
  const b = await xHandleForFid(424242, ok);
  assert(b.state === "none", "a READ index with no row is none: " + JSON.stringify(b));
  assert(calls === 2, "one whole-index fetch per lookup (the fetcher, never a per-fid request): " + calls);
  const thrown = await xHandleForFid(990777, async () => {
    throw new Error("the X index could not be downloaded (HTTP 500)");
  });
  assert(thrown.state === "unknown", "a failed download is UNKNOWN, never none: " + JSON.stringify(thrown));
  const unbuilt = await xHandleForFid(990777, async () => ({ available: false, reason: "index not built" }));
  assert(unbuilt.state === "unknown" && /not built/.test(unbuilt.reason), "a 503 'index not built' is UNKNOWN: " + JSON.stringify(unbuilt));
  const garbage = await xHandleForFid(990777, async () => null);
  assert(garbage.state === "unknown", "a malformed answer is UNKNOWN: " + JSON.stringify(garbage));
  const noAcct = await xHandleForFid(null, ok);
  assert(noAcct.state === "no-account" && calls === 2, "no signed-in account: no-account, and NO fetch");
  assert(handleForFid(index, 5).handle === "someone" && handleForFid(index, 6) === null, "handleForFid by fid");
  for (const bad of [null, {}, { x: null }, { x: { state: "connected" } }, { x: { state: "weird" } }]) {
    assert(readXHandleAnswer(bad).state === "unknown", "a malformed route answer reads as unknown: " + JSON.stringify(bad));
  }
  assert(readXHandleAnswer({ x: { state: "none" } }).state === "none", "a route 'none' stays none");
  assert(/couldn't check/i.test(xHandleSentence({ state: "unknown", reason: "x" })) && !/no X account/i.test(xHandleSentence({ state: "unknown", reason: "x" })), "the unknown sentence says couldn't check, never no X account");
  return "connected / none / unknown ×3 / no-account; one fetch per lookup";
};

CHECKS.U3 = async (M) => {
  const { localAvatar, localAvatarSvg, isLocalAvatar, LOCAL_AVATAR_PREFIX } = M.avatar;
  const a1 = localAvatar("my_persona");
  const a2 = localAvatar("my_persona");
  assert(a1 === a2, "the same seed gives the same picture");
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(localAvatar("persona_" + i));
  assert(seen.size >= 190, "200 seeds give at least 190 different pictures: " + seen.size);
  assert(a1.startsWith(LOCAL_AVATAR_PREFIX) && isLocalAvatar(a1), "an inline data URI the app recognises");
  let max = 0;
  for (const s of ["a", "x".repeat(30), "persona_with_a_long_handle", "🙂"]) max = Math.max(max, localAvatar(s).length);
  assert(max < 1200, "small enough for the keystore record: " + max + " bytes");
  const svg = localAvatarSvg("my_persona");
  assert(/^<svg [^>]*viewBox='0 0 8 8'[^>]*>.*<\/svg>$/.test(svg), "an SVG document");
  const urls = svg.match(/https?:\/\/[^'"\s)]+/g) || [];
  assert(urls.every((u) => u === "http://www.w3.org/2000/svg"), "no URL but the SVG namespace (no host is asked for anything): " + urls.join(", "));
  assert(!/dicebear|pravatar/.test(a1), "no third-party avatar host");
  return `${seen.size}/200 distinct, ≤ ${max} bytes, deterministic`;
};

CHECKS.U4 = async (M) => {
  const { isPublicLive, isPublicShape, publicLiveBootProblem, publicLiveDeviceHints, publicLiveValue } = M.live;
  const { isPublicDeployment } = M.contract;
  // the deliberate duplicate
  for (const NODE_ENV of [undefined, "", "development", "production", "test"]) {
    for (const ZK_DEV_HOOKS of [undefined, "", "true", "false", "1"]) {
      const env = { NODE_ENV, ZK_DEV_HOOKS };
      assert(isPublicShape(env) === isPublicDeployment(env), "isPublicShape drifted from isPublicDeployment at " + JSON.stringify(env));
    }
  }
  const pub = { NODE_ENV: "production", ZK_DEV_HOOKS: "" };
  const rig = { NODE_ENV: "production", ZK_DEV_HOOKS: "true" };
  const dev = { NODE_ENV: "development" };
  // the server half
  assert(isPublicLive({ ...pub, PUBLIC_LIVE: "true" }) === true, "a public deployment with PUBLIC_LIVE=true is live");
  for (const v of [undefined, "", "false", "True", "yes", "on", "1"]) assert(isPublicLive({ ...pub, PUBLIC_LIVE: v }) === false, "PUBLIC_LIVE=" + v + " is not live");
  assert(isPublicLive({ ...rig, PUBLIC_LIVE: "true" }) === false && isPublicLive({ ...dev, PUBLIC_LIVE: "true" }) === false, "the rig and a dev server are never live");
  // the boot matrix
  for (const v of ["True", "yes", "on", "1", " true"]) {
    const p = publicLiveBootProblem({ ...pub, PUBLIC_LIVE: v });
    const fixed = p && "refuse" in p ? p.refuse.replace(/\(got a value of \d+ character\(s\)\)$/, "") : "";
    assert(p && "refuse" in p && fixed === 'PUBLIC_LIVE must be "true", "false" or unset ', "a public deployment refuses PUBLIC_LIVE=" + JSON.stringify(v) + " by name and length only, never echoing the value: " + JSON.stringify(p));
  }
  for (const v of [undefined, "", "true", "false"]) assert(publicLiveBootProblem({ ...pub, PUBLIC_LIVE: v }) === null, "PUBLIC_LIVE=" + v + " boots silently on a public deployment");
  const w = publicLiveBootProblem({ ...rig, PUBLIC_LIVE: "true" });
  assert(w && "warn" in w, "a rig with PUBLIC_LIVE set warns: " + JSON.stringify(w));
  assert(publicLiveBootProblem({ ...rig, PUBLIC_LIVE: "garbage" }) && "warn" in publicLiveBootProblem({ ...rig, PUBLIC_LIVE: "garbage" }), "a rig never refuses on it (ignored there)");
  assert(publicLiveBootProblem({ ...rig }) === null, "a rig without it says nothing");
  assert(publicLiveValue({ PUBLIC_LIVE: "true" }) === "on" && publicLiveValue({ PUBLIC_LIVE: "false" }) === "off" && publicLiveValue({ PUBLIC_LIVE: "TRUE" }) === "bad", "value classes");
  // the forwarded hint
  assert(JSON.stringify(publicLiveDeviceHints({ ...pub, PUBLIC_LIVE: "true" })) === JSON.stringify({ PUBLIC_LIVE: "on" }), "a live server forwards PUBLIC_LIVE=on");
  assert(JSON.stringify(publicLiveDeviceHints({ ...pub })) === "{}" && JSON.stringify(publicLiveDeviceHints({ ...rig, PUBLIC_LIVE: "true" })) === "{}", "nothing forwarded otherwise");
  // the device half: window defined, the device env's value "on" (never the server's "true")
  const dv = (v) => withEnv({}, () => isPublicLive({ PUBLIC_LIVE: v }), { windowed: true });
  assert(dv("on") === true && dv("true") === false && dv(undefined) === false && dv("ON") === false, "the tab is live only with PUBLIC_LIVE=on");
  return "duplicate pinned over 25 shapes; server, boot, hint and device matrices";
};

CHECKS.U5 = async (M) => {
  const { bank, isEmptyWorld } = M.world;
  const pubLive = { NODE_ENV: "production", ZK_DEV_HOOKS: "", PUBLIC_LIVE: "true", LAYERS_WORLD: undefined };
  assert(withEnv(pubLive, () => bank("demo", "empty")) === "empty", "a live public server reads the empty twin");
  assert(withEnv(pubLive, () => isEmptyWorld()) === false, "a live public SERVER is not the empty world itself (it holds no identity; LAYERS_WORLD stays refused there)");
  assert(withEnv({ ...pubLive, PUBLIC_LIVE: undefined }, () => bank("demo", "empty")) === "demo", "the preview (flag off) reads the demo bank");
  assert(withEnv({ ...pubLive, ZK_DEV_HOOKS: "true" }, () => bank("demo", "empty")) === "demo", "the rig with PUBLIC_LIVE=true still reads the demo bank");
  assert(withEnv({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", LAYERS_WORLD: "empty", PUBLIC_LIVE: undefined }, () => bank("demo", "empty")) === "empty", "LAYERS_WORLD=empty unchanged");
  assert(withEnv({ PUBLIC_LIVE: "on", LAYERS_WORLD: undefined }, () => isEmptyWorld() && bank("demo", "empty") === "empty", { windowed: true }) === true, "a live TAB runs the empty world");
  assert(withEnv({ PUBLIC_LIVE: undefined, LAYERS_WORLD: "empty" }, () => isEmptyWorld(), { windowed: true }) === false, "a tab never runs the empty world from LAYERS_WORLD");
  return "server: live → empty twin; rig/preview → demo; tab: PUBLIC_LIVE=on → the empty world";
};

/** a fake DOM for loadDevice.ts: records the device env at the moment each script is appended */
async function runLoader(loader, env) {
  const appended = [];
  const win = { setInterval, clearInterval, setTimeout, clearTimeout };
  const doc = {
    createElement: () => {
      const el = { dataset: {}, listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, removeEventListener() {} };
      return el;
    },
    querySelector: () => null,
    head: {
      appendChild(el) {
        appended.push({ src: el.src, type: el.type, envAtAppend: win.__LAYERS_DEVICE_ENV ? { ...win.__LAYERS_DEVICE_ENV } : null });
        queueMicrotask(() => {
          if (el.src === "/device/boot.js") win.__layersOrigFetch = () => {};
          if (el.src === "/device/device.js") win.__layersDevice = { ready: Promise.resolve({}) };
          el.onload && el.onload();
        });
      },
    },
  };
  const hadW = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const hadD = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const oldW = globalThis.window;
  const oldD = globalThis.document;
  globalThis.window = win;
  globalThis.document = doc;
  try {
    await loader.startDevice(env);
  } finally {
    if (hadW) globalThis.window = oldW;
    else delete globalThis.window;
    if (hadD) globalThis.document = oldD;
    else delete globalThis.document;
  }
  return appended;
}

CHECKS.U6 = async (M, mut = []) => {
  const L = (await bundle("load-entry.ts", mut.filter((m) => m.file.endsWith("loadDevice.ts")))).mod;
  const appended = await runLoader(L.loader, { PUBLIC_LIVE: "on", NODE_ENV: "production" });
  const dev = appended.find((a) => a.src === "/device/device.js");
  assert(dev, "the loader never injected device.js: " + JSON.stringify(appended.map((a) => a.src)));
  assert(dev.envAtAppend && dev.envAtAppend.PUBLIC_LIVE === "on", "device.js was injected BEFORE the env declared PUBLIC_LIVE=on (env at append: " + JSON.stringify(dev.envAtAppend) + ")");
  // the module-load half: bank() through the device's own process shim, evaluated after vs before the env exists
  const shim = path.join(ROOT, "lib/device/shims/process.ts");
  const { out } = await bundle("bank-entry.ts", mut.filter((m) => m.file.endsWith("world-flag.ts")), { inject: [shim] });
  const g = globalThis;
  const hadW = Object.prototype.hasOwnProperty.call(g, "window");
  g.window = {};
  let first;
  let late;
  try {
    g.__LAYERS_DEVICE_ENV = { PUBLIC_LIVE: "on" };
    first = await import(pathToFileURL(out).href + "?early");
    delete g.__LAYERS_DEVICE_ENV;
    late = await import(pathToFileURL(out).href + "?late");
    g.__LAYERS_DEVICE_ENV = { PUBLIC_LIVE: "on" }; // declared too late: the shim has already captured its env
  } finally {
    delete g.__LAYERS_DEVICE_ENV;
    if (!hadW) delete g.window;
  }
  assert(first.BANK === "empty" && first.EMPTY === true, "with the env declared first, the device's module-load bank() is the empty twin: " + first.BANK);
  assert(late.BANK === "demo", "the late-flag control: a bundle evaluated before the env loads the DEMO bank (" + late.BANK + ") — the order is what keeps the demo world out");
  return "env declared before device.js; module-load bank(): early → empty, late → demo";
};

CHECKS.U7 = async (M) => {
  const { readAnonDestination, destinationSentenceOf } = M.state;
  const good = { destination: "farcaster", destinationSentence: "Posts go to Farcaster through @anon.", postedSentence: "Sent through @anon.", castUrl: "https://farcaster.xyz/anon/0xabc" };
  const d = readAnonDestination(good);
  assert(d && d.destination === "farcaster" && d.destinationSentence === good.destinationSentence && d.postedSentence === good.postedSentence && d.castUrl === good.castUrl, "the contract is read: " + JSON.stringify(d));
  assert(readAnonDestination({ ...good, destination: "x" }) === null, "an unknown destination is not a contract");
  assert(readAnonDestination({ ...good, destinationSentence: " " }) === null, "an empty sentence is not a contract");
  assert(readAnonDestination({ ...good, castUrl: "javascript:alert(1)" }).castUrl === null, "only an https cast link is kept");
  assert(destinationSentenceOf(good) === good.destinationSentence, "the persona step's sentence is the route's, word for word");
  assert(destinationSentenceOf({ previewOnly: true, previewSentence: "Preview only: stays inside." }) === "Preview only: stays inside.", "an older route's own preview sentence");
  assert(destinationSentenceOf({ available: false, unavailableReason: "Anonymous posting isn't on here yet." }) === "Anonymous posting isn't on here yet.", "an older route's own reason");
  assert(destinationSentenceOf({ available: true }) === null && destinationSentenceOf(null) === null && destinationSentenceOf("x") === null, "nothing usable → null (the step says it could not check)");
  return "contract validated; fallback quotes the route only";
};

CHECKS.U8 = async (M) => {
  const { isPhoneLike, suggestHandle } = M.state;
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const pixel = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  const desk = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  assert(isPhoneLike(iphone, true) && isPhoneLike(pixel, true) && !isPhoneLike(desk, false) && !isPhoneLike(desk, true), "phones and a desktop");
  assert(suggestHandle("Night Owl!") === "night_owl" && suggestHandle("Café  Crème") === "cafe_creme" && suggestHandle("x".repeat(40)).length === 30 && suggestHandle("") === "", "handles from names");
  // This is you: the username inside Totem
  const { handleFromFname, handleSuggestions } = M.state;
  assert(handleFromFname("Alice.eth") === "alice_eth" && handleFromFname(null) === "farcaster_main" && handleFromFname("x".repeat(40)).length === 30, "handleFromFname");
  const takenSet = new Set(["alice", "alice_fc"]);
  const sug = handleSuggestions("alice", (h) => takenSet.has(h), 3);
  assert(sug.length === 3 && !sug.includes("alice") && sug.every((h) => !takenSet.has(h) && /^[a-z0-9_]{1,30}$/.test(h)), "three free alternatives, never the taken ones: " + JSON.stringify(sug));
  assert(JSON.stringify(handleSuggestions("alice", (h) => takenSet.has(h), 3)) === JSON.stringify(sug), "deterministic");
  const long = handleSuggestions("x".repeat(30), () => false, 3);
  assert(long.length === 3 && long.every((h) => h.length <= 30), "a 30-character username still gets 3 alternatives of at most 30: " + JSON.stringify(long));
  const most = handleSuggestions("bob", (h) => h !== "bob_7", 3);
  assert(JSON.stringify(most) === JSON.stringify(["bob_7"]), "only the free ones are offered: " + JSON.stringify(most));
  return "phone detection, handle suggestion, username alternatives " + JSON.stringify(sug);
};

/** run validator/seed.js in a child (optionally with a mutation applied to the CHILD'S copy, compiled at the real path) */
function runSeed(env, args = [], mutation = null) {
  const loader = `const fs=require("fs"),path=require("path"),Module=require("module");const f=path.join(${JSON.stringify(ROOT)},"validator","seed.js");let s=fs.readFileSync(f,"utf8").replace(/\\r\\n/g,"\\n");const m=${JSON.stringify(mutation)};if(m){if(!s.includes(m.find)){console.error("MUTATION ANCHOR NOT FOUND");process.exit(91)}s=s.replace(m.find,m.replace)}const mod=new Module(f,null);mod.filename=f;mod.paths=Module._nodeModulePaths(path.dirname(f));process.argv=[process.argv[0],f,...${JSON.stringify(args)}];mod._compile(s,f);`;
  const r = spawnSync(process.execPath, ["-e", loader], { cwd: ROOT, env: { ...process.env, PUBLIC_LIVE: undefined, LAYERS_WORLD: undefined, ...env }, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function roots(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare("SELECT COUNT(*) AS n FROM roots").get().n;
  } finally {
    db.close();
  }
}
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

let u9n = 0;
CHECKS.U9 = async (M, mut = []) => {
  const m = mut.find((x) => x.file === "validator/seed.js") ?? null;
  // fresh databases per run: a mutation run must never meet a database an earlier run seeded
  const D = (name) => S(`u9-${++u9n}-${name}`);
  const pub = { NODE_ENV: "production", ZK_DEV_HOOKS: "" };
  const db1 = D("live-empty.db");
  const a = runSeed({ ...pub, PUBLIC_LIVE: "true", VALIDATOR_DB: db1 }, ["--roster", "none"], m);
  assert(a.code === 0 && /WORLD: live/.test(a.out), "a live public validator's seed runs and says WORLD: live: " + a.code + " " + a.out.slice(0, 200));
  assert(roots(db1) === 0, "a live public validator seeds NOTHING into an empty database (roots: " + roots(db1) + ")");
  const forced = runSeed({ ...pub, PUBLIC_LIVE: "true", VALIDATOR_DB: D("live-force.db") }, ["--force", "--roster", "none"], m);
  assert(forced.code === 78, "--force is refused under PUBLIC_LIVE=true: " + forced.code);
  const bad = runSeed({ ...pub, PUBLIC_LIVE: "yes", VALIDATOR_DB: D("live-bad.db") }, ["--roster", "none"], m);
  assert(bad.code === 78 && !bad.out.includes("yes)") && /3 character/.test(bad.out), "a bad value refuses by name and length, never echoing it: " + bad.code + " " + bad.out.slice(0, 160));
  // an already-seeded database is never touched
  const db2 = D("seeded.db");
  const seeded = runSeed({ VALIDATOR_DB: db2, NODE_ENV: "development" }, ["--roster", "none"], null);
  assert(seeded.code === 0 && roots(db2) > 0, "the rig control seeds its demo world: " + seeded.code + " " + seeded.out.slice(-160));
  const before = sha(db2);
  const again = runSeed({ ...pub, PUBLIC_LIVE: "true", VALIDATOR_DB: db2 }, ["--roster", "none"], m);
  assert(again.code === 0 && sha(db2) === before, "an already-seeded database is left byte for byte under PUBLIC_LIVE=true");
  // the rig ignores the flag, and says so
  const db3 = D("rig-flag.db");
  const rig = runSeed({ NODE_ENV: "production", ZK_DEV_HOOKS: "true", PUBLIC_LIVE: "true", VALIDATOR_DB: db3 }, ["--roster", "none"], m);
  assert(rig.code === 0 && roots(db3) > 0 && /ignored here/.test(rig.out), "the rig ignores PUBLIC_LIVE (warns) and seeds its demo world: " + rig.out.slice(0, 200));
  return "live: 0 roots, --force 78, bad value 78, seeded db unchanged; rig: demo seeded + warning";
};

CHECKS.U10 = async () => {
  const env = src("lib/device/deviceEnv.server.ts");
  assert(/\.\.\.publicLiveDeviceHints\(\),/.test(env) && /import \{ publicLiveDeviceHints \} from "@\/lib\/platform\/publicLive";/.test(env), "deviceEnv forwards the live hint");
  const boot = src("lib/device/boot.ts");
  assert(boot.includes("if (!live && ks.listPersonas().length === 0) {"), "boot mints the pair only outside live mode");
  assert(boot.includes('const first = live ? personas.find((p) => p.publicSelf !== true) : personas[0];'), "the live acting persona is never the read-only public self");
  const inst = src("instrumentation.ts");
  const iRefuse = inst.indexOf('if (liveProblem && "refuse" in liveProblem) {');
  const iWorld = inst.indexOf('if (process.env.LAYERS_WORLD === "empty" && isPublicDeployment()) {');
  const iLine = inst.indexOf("console.log(PUBLIC_LIVE_WORLD_LINE);");
  assert(iRefuse > 0 && /process\.exit\(78\)/.test(inst.slice(iRefuse, iRefuse + 200)), "a bad PUBLIC_LIVE stops the boot (78)");
  assert(iWorld > 0 && iWorld < iLine, "the LAYERS_WORLD=empty refusal on a public deployment is checked BEFORE the live line");
  const landing = src("components/landing/Landing.tsx");
  assert(/<a href={GET_FARCASTER_URL}[^>]*data-testid="door-get-farcaster"/.test(landing), "No Farcaster account yet? Get one free links GET_FARCASTER_URL");
  for (const [id, href] of [["door-start", "/welcome#next"], ["door-unlock", "/welcome#unlock"], ["door-app", "/anon"]]) {
    assert(new RegExp(`<a href="${href.replace(/[#/]/g, (c) => "\\" + c)}"[^>]*data-testid="${id}"`).test(landing), `the landing's ${id} door goes to ${href}`);
  }
  assert(landing.split('data-testid="landing-siwf"').length === 2, "landing-siwf exactly once");
  // the owner's landing: his headline and line, Continue with X shown DISABLED and marked Soon, no context-collapse paragraph
  const copy = src("components/onboarding/copy.ts");
  assert(copy.includes('export const FRONT_HEADLINE = "One you. Many personas.";') && copy.includes('export const FRONT_LINE = "Your Farcaster account, plus as many other faces as you want. You decide who sees which one is you.";'), "the front door's words");
  assert(/<button type="button" disabled [^>]*data-testid="door-x">\s*\{CONTINUE_WITH_X\}\s*<span[^>]*>Soon<\/span>/.test(landing), "Continue with X is a disabled button marked Soon");
  const liveBranch = landing.slice(landing.indexOf("{live ? ("), landing.indexOf(") : (", landing.indexOf("{live ? (")));
  assert(!liveBranch.includes("{MISSION}") && liveBranch.includes("{FRONT_HEADLINE}"), "the live landing still carries the context-collapse paragraph, or not the headline");
  const nudge = src("components/device/IdentityNudge.tsx");
  assert(/<Link href=\{welcomeHref\("next"\)\} data-testid="identity-finish-setup"/.test(nudge), "the nudge's Finish setting up goes to /welcome?step=next (F5)");
  const composer = src("components/Composer.tsx");
  assert(composer.includes("dest: readAnonDestination(j),") && composer.includes('data-testid="composer-destination"') && composer.includes('href={welcomeHref("next")} data-testid="composer-sign-in"'), "the composer reads the anon route's contract and points a guest at /welcome#next (F8)");
  // posting as the root (POST AS YOU, 2026-11-05): "Posting as @you", what allowing it does, the REAL offer (the device's
  // answer, components/root/RootPost.tsx), the root's own composer once active, and the persona as the other way
  assert(composer.includes('data-testid="composer-posting-as"') && composer.includes("Posting as @{root.handle}") && composer.includes('<RootPostConnect status={rootPost.status} onChange={rootPost.set} />') && composer.includes("<RootComposer") && !composer.includes("coming soon"), "the composer's root line");
  assert(/export function publicSelfPostLine\(handle: string\): string \{\n  return `Totem posts to Farcaster as @\$\{handle\} once you allow it, with a key kept in your own vault\.`;/.test(composer), "the root's line says what allowing it does");
  const rootPostCopy = src("lib/fc/rootSigner/copy.ts");
  const rootPostUi = src("components/root/RootPost.tsx");
  assert(rootPostCopy.includes('export const ALLOW_LABEL = "Allow Totem to post as you";') && /return `Posts go to Farcaster as @\$\{handle\}\.`;/.test(rootPostCopy) && rootPostCopy.includes("Network School's \\\"social contract\\\""), "the root composer's two honest lines");
  assert(rootPostUi.includes("{postsGoAsLine(handle)}") && rootPostUi.includes("{MAIN_APP_NOTE}"), "the root composer shows both lines");
  assert(composer.includes("href={MAKE_PERSONA_HREF}") && M.state.MAKE_PERSONA_HREF === "/home#make-persona", "Make a persona goes to the home feed's card");
  const rail = src("components/LeftRail.tsx");
  const slots = (rail.match(/FIXTURE_ONLY_SLOTS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/) || [])[1] || "";
  for (const s of ["grok", "premium", "money", "market", "creator-studio", "rooms", "channels"]) assert(slots.includes(`"${s}"`), "the fixture-only slot " + s + " is hidden in live mode");
  return "device env, boot, instrumentation order, landing doors, nudge, composer, nav";
};

// ---------------------------------------------------------------------------------------------------------------- U11..U14
CHECKS.U11 = async (M, mut = []) => {
  const D = (await bundle("deviceenv-entry.ts", mut.filter((m) => m.file.endsWith("deviceEnv.server.ts")), DE_ALIAS)).mod;
  const base = { NODE_ENV: "production", ZK_DEV_HOOKS: "", ZK_MODE: undefined, ZK_ANON_UNIVERSE: undefined, PUBLIC_LIVE: undefined, ZK_ANON_POST: undefined, ZK_RELAY: undefined, ZK_RELAY_URL: undefined, ZK_ANON_POST_TREE: undefined, CUSTODY_PROVIDER: undefined, LAYERS_REQUIRE_SIG: undefined };
  const off = withEnv(base, () => D.deviceEnv());
  assert(!("ZK_ANON_UNIVERSE" in off) && off.ZK_MODE === "fixture", "unset: no hint, ZK_MODE fixture: " + JSON.stringify({ u: off.ZK_ANON_UNIVERSE, m: off.ZK_MODE }));
  const live = withEnv({ ...base, ZK_ANON_UNIVERSE: "live" }, () => D.deviceEnv());
  assert(live.ZK_ANON_UNIVERSE === "live" && live.ZK_MODE === "live", "ZK_ANON_UNIVERSE=live on the app must reach the tab as ZK_ANON_UNIVERSE=live + ZK_MODE=live: " + JSON.stringify({ u: live.ZK_ANON_UNIVERSE, m: live.ZK_MODE }));
  const overFixture = withEnv({ ...base, ZK_ANON_UNIVERSE: " LIVE ", ZK_MODE: "fixture" }, () => D.deviceEnv());
  assert(overFixture.ZK_MODE === "live" && overFixture.ZK_ANON_UNIVERSE === "live", "the hint's ZK_MODE=live wins over the app's own ZK_MODE=fixture: " + overFixture.ZK_MODE);
  const junk = withEnv({ ...base, ZK_ANON_UNIVERSE: "https://evil.example/?k=SECRET" }, () => D.deviceEnv());
  assert(junk.ZK_ANON_UNIVERSE === "invalid" && junk.ZK_MODE === "fixture" && !JSON.stringify(junk).includes("SECRET"), "a junk value goes as 'invalid' (never the value), ZK_MODE untouched: " + JSON.stringify({ u: junk.ZK_ANON_UNIVERSE, m: junk.ZK_MODE }));
  // unset is byte for byte the object without the hint: the live object minus its two hint values IS the unset object
  const back = { ...live };
  delete back.ZK_ANON_UNIVERSE;
  back.ZK_MODE = "fixture";
  assert(JSON.stringify(back) === JSON.stringify(off), "the hint changed more than its two names: " + JSON.stringify(back).slice(0, 160) + " vs " + JSON.stringify(off).slice(0, 160));
  return "live → ZK_ANON_UNIVERSE=live + ZK_MODE=live (over fixture); junk → invalid; unset → unchanged";
};

CHECKS.U12 = async (M) => {
  const { readTarget, landingStep, welcomeHref, nextStep, skip, NO_PROGRESS } = M.state;
  const F = (o = {}) => ({ publicSelf: false, saved: false, personas: 0, returning: false, ...o });
  const P = (o = {}) => ({ ...NO_PROGRESS, ...o });
  for (const t of ["farcaster", "profile", "save", "next"]) assert(readTarget(t) === t && readTarget(null, "#" + t) === t, "readTarget(" + t + ") and #" + t);
  for (const gone of ["x", "persona"]) assert(readTarget(gone) === null && readTarget(null, "#" + gone) === null, "the old #" + gone + " target is gone with its step");
  assert(readTarget(" Farcaster ") === "farcaster" && readTarget(null, "#Next") === "next", "a target is trimmed and lower-cased");
  assert(readTarget(null, "#unlock") === "unlock" && readTarget(undefined, "#UNLOCK") === "unlock", "#unlock is a target");
  assert(readTarget("unlock") === null, "unlock is a hash target only (it opens a half of the welcome screen, not a step)");
  assert(readTarget("save", "#unlock") === "save" && readTarget("profile", "#farcaster") === "profile", "?step= wins over the hash");
  for (const junk of ["welcome", "done", "", "../x", "farcaster;x", ["farcaster"], 1, null]) assert(readTarget(junk) === null, "no target from " + JSON.stringify(junk));
  for (const h of ["#unlockx", "unlock", "farcaster", "#", "", "#welcome", "#done", "#farcaster;x", "##next"]) assert(readTarget(null, h) === null, "no target from the hash " + JSON.stringify(h));
  // THE FINDING'S CASE: a returning visitor that is done, with ?step=farcaster, lands on Farcaster (not /home)
  const doneReturning = F({ returning: true, personas: 0, publicSelf: true, saved: true });
  assert(nextStep(doneReturning, P()) === "done", "the control: without a target a returning, done visitor is sent home");
  assert(landingStep(doneReturning, P(), "farcaster") === "farcaster", "?step=farcaster for a returning, done visitor: " + landingStep(doneReturning, P(), "farcaster"));
  for (const t of ["save", "profile"]) assert(landingStep(doneReturning, P(), t) === t, "?step=" + t + " for a returning, done visitor");
  assert(landingStep(F(), P(), "profile") === "farcaster", "#profile without a sign-in lands on Sign in with Farcaster");
  // past this document's skips
  const skipped = skip(skip(P({ started: true }), "farcaster"), "save");
  assert(nextStep(F(), skipped) === "done" && landingStep(F(), skipped, "farcaster") === "farcaster" && landingStep(F(), skipped, "save") === "save", "a named target is shown past a remembered skip");
  // #unlock: the welcome screen even when the visitor is not fresh
  const notFresh = F({ publicSelf: true });
  assert(nextStep(notFresh, P()) !== "welcome" && landingStep(notFresh, P(), "unlock") === "welcome", "#unlock for a visitor who is not fresh opens the welcome screen's unlock");
  assert(landingStep(doneReturning, P(), "unlock") === "welcome", "#unlock for a returning, done visitor too");
  // next: past the welcome screen, at the first unmet step; the returning rule still holds
  assert(nextStep(F(), P()) === "welcome" && landingStep(F(), P(), "next") === "farcaster", "?step=next skips the welcome screen: " + landingStep(F(), P(), "next"));
  assert(landingStep(F({ publicSelf: true }), P(), "next") === "profile", "?step=next resumes at the first unmet step");
  assert(landingStep(F({ publicSelf: true }), { ...P(), profileSeen: true }, "next") === "save", "?step=next past a confirmed This is you");
  assert(landingStep(F(), skipped, "next") === "done", "?step=next keeps this document's skips");
  assert(landingStep(doneReturning, P(), "next") === "done", "?step=next keeps the returning-visitor rule");
  // no target: exactly nextStep
  for (const [f, p] of [[F(), P()], [F({ publicSelf: true }), P({ started: true })], [doneReturning, P()], [F({ returning: true }), P()]]) assert(landingStep(f, p, null) === nextStep(f, p), "no target is nextStep");
  // the app's hrefs: the target in the HASH (never in the request the server sees), and they round-trip
  assert(welcomeHref() === "/welcome" && welcomeHref("farcaster") === "/welcome#farcaster" && welcomeHref("next") === "/welcome#next" && welcomeHref("unlock") === "/welcome#unlock", "welcomeHref: " + welcomeHref("farcaster"));
  for (const t of ["farcaster", "profile", "save", "next", "unlock"]) {
    const u = new URL(welcomeHref(t), "https://layers.example");
    assert(u.pathname === "/welcome" && u.search === "", "the target of " + t + " would reach the server: " + welcomeHref(t));
    assert(readTarget(u.searchParams.get("step"), u.hash) === t, "round trip " + t);
  }
  return "named steps past the returning rule and skips; next; #unlock when not fresh; junk → none; hash-only hrefs round-trip";
};

const AVAIL_COMMIT = "424242";
const AVAIL_CROWD = Array.from({ length: 60 }, (_, i) => String(1000 + i));
const availSnap = (members) => ({ mode: "live", tree: "valid", fetchedAt: Date.now(), epoch: { epoch: 100, epochMs: 6 * 3_600_000, msRemaining: 3_600_000 }, members: { members }, anonConfig: { liveRelay: true, tree: "valid" } });
/** availability's verdict as GET /api/anon carries it (unavailableCode / unavailableReason / availableFrom) */
const asRoute = (a) => ({ available: a.on ? null : false, unavailableCode: a.on ? null : a.code, unavailableReason: a.on ? null : a.reason, availableFrom: typeof a.availableFrom === "number" ? a.availableFrom : null });
CHECKS.U13 = async (M) => {
  const { crowdSignInAsked, rejoinOffered } = M.state;
  const A = (await bundle("avail-entry.ts", [], AV_ALIAS)).mod;
  const env = { NODE_ENV: "production", ZK_DEV_HOOKS: undefined, ZK_ANON_UNIVERSE: "live", PUBLIC_LIVE: undefined, ZK_ANON_FLOOR: undefined, ZK_ANON_POST: undefined, ZK_ANON_POST_TREE: "valid", ZK_GATE_TIER: undefined };
  const rows = withEnv(
    env,
    () => {
      const av = (o) => asRoute(A.anonPostingAvailability({ mode: "live", commitment: AVAIL_COMMIT, ...o }));
      return {
        notLeaf: av({ snap: availSnap(AVAIL_CROWD) }),
        joinFailed: av({ snap: availSnap(AVAIL_CROWD), join: { registered: false, activeFromEpoch: null, error: "the validator answered 503" } }),
        notListed: av({ snap: availSnap(AVAIL_CROWD), join: { registered: true, activeFromEpoch: 100, error: null } }),
        joinedLater: av({ snap: availSnap(AVAIL_CROWD), join: { registered: true, activeFromEpoch: 101, error: null }, timeText: () => "2:00 PM" }),
        underFloor: av({ snap: availSnap(["1", AVAIL_COMMIT]) }),
        leaf: av({ snap: availSnap([...AVAIL_CROWD, AVAIL_COMMIT]) }),
      };
    },
    { windowed: true }
  );
  // the real answers are what this check thinks they are (otherwise the pins below prove nothing)
  assert(rows.notLeaf.unavailableCode === "crowd" && rows.notLeaf.unavailableReason === A.ANON_LIVE_SIGN_IN_FIRST, "not a leaf: " + JSON.stringify(rows.notLeaf));
  assert(rows.joinFailed.unavailableReason === A.ANON_LIVE_JOIN_FAILED && rows.notListed.unavailableReason === A.ANON_LIVE_NOT_LISTED, "join failed / not listed: " + JSON.stringify([rows.joinFailed, rows.notListed]));
  assert(rows.joinedLater.unavailableCode === "crowd" && typeof rows.joinedLater.availableFrom === "number", "joined, a time: " + JSON.stringify(rows.joinedLater));
  assert(rows.underFloor.unavailableCode === "crowd" && rows.underFloor.availableFrom === null && /opens once at least/.test(rows.underFloor.unavailableReason), "under the floor: " + JSON.stringify(rows.underFloor));
  assert(rows.leaf.unavailableCode === null, "a leaf over the floor is on: " + JSON.stringify(rows.leaf));
  // the offer: exactly the three answers that ask for a Farcaster sign-in
  for (const k of ["notLeaf", "joinFailed", "notListed"]) assert(crowdSignInAsked(rows[k]) === true, k + " must offer the sign-in again: " + JSON.stringify(rows[k]));
  for (const k of ["joinedLater", "underFloor", "leaf"]) assert(crowdSignInAsked(rows[k]) === false, k + " must offer nothing: " + JSON.stringify(rows[k]));
  // relay's "may already be joined" sentence for a signed-in tab after a reload (onboard F2's exact diff), once it lands:
  // it must still end by asking for a Farcaster sign-in, or the card and the composer would lose the way forward
  if (typeof A.ANON_LIVE_MAYBE_JOINED === "string") assert(crowdSignInAsked({ unavailableCode: "crowd", unavailableReason: A.ANON_LIVE_MAYBE_JOINED, availableFrom: null }) === true, "ANON_LIVE_MAYBE_JOINED must ask for a Farcaster sign-in: " + A.ANON_LIVE_MAYBE_JOINED);
  // the joined-but-timing-unreadable sentence, the fixture crowd's sentences: nothing
  for (const r of [A.ANON_LIVE_JOINED_NEXT_WINDOW, A.ANON_NOT_IN_CROWD, A.ANON_JOIN_FAILED, A.ANON_JOINED_NEXT_WINDOW, A.anonFloorSentence(50, 3), A.anonLiveFloorSentence(50, 3)]) assert(crowdSignInAsked({ unavailableCode: "crowd", unavailableReason: r, availableFrom: null }) === false, "offered for: " + r);
  // the contract: no availableFrom, the crowd code, a readable answer
  assert(crowdSignInAsked({ unavailableCode: "crowd", unavailableReason: A.ANON_LIVE_SIGN_IN_FIRST, availableFrom: Date.now() + 60_000 }) === false, "a known time (availableFrom) offers nothing");
  for (const code of ["checking", "browser-live", "switch", null]) assert(crowdSignInAsked({ unavailableCode: code, unavailableReason: A.ANON_LIVE_SIGN_IN_FIRST, availableFrom: null }) === false, "code " + code + " offers nothing");
  for (const bad of [null, undefined, "x", 1, {}, { unavailableCode: "crowd" }]) assert(crowdSignInAsked(bad) === false, "unreadable offers nothing: " + JSON.stringify(bad));
  // the hint and the sign-in are both required
  assert(rejoinOffered({ hinted: true, signedIn: true, answer: rows.notLeaf }) === true, "hinted + signed in + asked → offered");
  assert(rejoinOffered({ hinted: false, signedIn: true, answer: rows.notLeaf }) === false, "not hinted → nothing");
  assert(rejoinOffered({ hinted: true, signedIn: false, answer: rows.notLeaf }) === false, "not signed in → nothing (the card's own Sign in button is there)");
  return "real availability: sign-in-first / join failed / not listed → offered; joined with a time / under the floor / a leaf → not; hint + sign-in required";
};

CHECKS.U14 = async (M, mut = []) => {
  const R = (await bundle("render-entry.tsx", mut, RENDER_OPTS)).mod;
  const html = (el) => R.renderToStaticMarkup(el);
  const h = R.React.createElement;
  const noop = () => {};
  // F8: the guest door
  const liveWelcome = html(h(R.WelcomeStep, { startOpen: false, live: true, onNew: noop, onUnlocked: noop }));
  // the welcome screen says the front door's words: the headline, Sign in with Farcaster, Continue with X disabled + Soon
  assert(liveWelcome.includes(">One you. Many personas.</h1>") && /data-testid="onboard-new"[^>]*>Sign in with Farcaster</.test(liveWelcome), "the welcome screen's headline and primary door: " + liveWelcome.slice(0, 300));
  assert(/<button[^>]*data-testid="onboard-x-soon"[^>]*disabled=""[^>]*>Continue with X<span[^>]*>Soon<\/span>/.test(liveWelcome) || /<button[^>]*disabled=""[^>]*data-testid="onboard-x-soon"[^>]*>Continue with X<span[^>]*>Soon<\/span>/.test(liveWelcome), "Continue with X is disabled and marked Soon");
  assert(/<a href="https:\/\/farcaster\.xyz"[^>]*data-testid="onboard-get-farcaster"[^>]*>Get one free<\/a>/.test(liveWelcome), "No Farcaster account yet? Get one free → farcaster.xyz");
  assert(!/persona that posts|first persona|New to Totem|save it with Face ID/i.test(liveWelcome), "the welcome screen still explains the old flow");
  const prevWelcome = html(h(R.WelcomeStep, { startOpen: false, live: false, onNew: noop, onUnlocked: noop }));
  const guestHref = (s) => (/<a[^>]*data-testid="onboard-guest"[^>]*>/.exec(s) || [""])[0].match(/href="([^"]*)"/)?.[1] ?? null;
  assert(guestHref(liveWelcome) === "/anon", "live mode's guest door goes to the anonymous feed: " + guestHref(liveWelcome));
  assert(guestHref(prevWelcome) === "/home", "the preview's guest door is unchanged (/home): " + guestHref(prevWelcome));
  assert(html(h(R.WelcomeStep, { startOpen: true, live: true, onNew: noop, onUnlocked: noop })).includes('data-testid="onboard-unlock"'), "startOpen opens the unlock");
  // Keep your account: the owner's line, Save with Face ID (a passkey where there is no built-in authenticator), Not now
  // and what it means BEFORE it is pressed; the progress indicator: three dots, step k of 3; This is you's taken words
  const facts = { webauthn: true, platformAuthenticator: true, saved: false, canSave: true };
  const saveProps = { kept: false, onSaved: noop, onNotNow: noop, onNext: noop, onBack: noop };
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
  const sv = html(h(R.SaveStep, { facts, ...saveProps }));
  assert(sv.includes(">Keep your account</h1>") && sv.includes(esc(R.SAVE_LEAD)) && R.SAVE_LEAD === "One tap with Face ID. No password, nothing to write down. Works on your other devices too.", "Keep your account's title and line: " + sv.slice(0, 300));
  assert(/data-testid="onboard-save-passkey"[^>]*>Save with Face ID</.test(sv) && /data-testid="onboard-keep"[^>]*>Not now</.test(sv) && sv.includes(esc(R.NOT_NOW_NOTE)) && R.NOT_NOW_NOTE === "Not now keeps it in this browser only.", "Save with Face ID, Not now and its note");
  assert(/data-testid="onboard-save-passkey"[^>]*>Save with a passkey</.test(html(h(R.SaveStep, { facts: { ...facts, platformAuthenticator: false }, ...saveProps }))), "a passkey where there is no built-in authenticator");
  assert(/data-testid="onboard-save-passkey"[^>]*disabled=""/.test(html(h(R.SaveStep, { facts: { ...facts, webauthn: false }, ...saveProps }))) || /disabled=""[^>]*data-testid="onboard-save-passkey"/.test(html(h(R.SaveStep, { facts: { ...facts, webauthn: false }, ...saveProps }))), "no passkey button that cannot work");
  const prog = html(h(R.Progress, { step: "profile" }));
  assert(/data-index="2" data-total="3"/.test(prog) && (prog.match(/<li /g) || []).length === 3 && prog.includes(">Step 2 of 3</p>"), "the indicator: three dots, step 2 of 3: " + prog);
  assert(R.takenSentence("alice") === "@alice is taken on Totem. These are free:" && R.fnameStaysSentence("alice") === "Your Farcaster username stays @alice on Farcaster. This only changes your name inside Totem.", "This is you's taken words");
  const fc = (o) => html(h(R.FarcasterStep, { signedIn: false, phone: true, onChanged: noop, onNext: noop, onSkip: noop, onBack: noop, ...o }));
  assert(fc({}).includes(esc(R.FARCASTER_LEAD)) && R.FARCASTER_LEAD === "Approve in the Farcaster app. We only read your public profile.", "step 1's line");
  assert(fc({ afterReload: true }).includes('data-testid="onboard-farcaster-after-reload"'), "a restored identity with no sign-in hears that a waiting sign-in must start again");
  assert(!fc({ afterReload: false }).includes("onboard-farcaster-after-reload") && !fc({ afterReload: true, signedIn: true }).includes("onboard-farcaster-after-reload"), "nobody else hears it");
  // F8: NoPersonaYet in live mode lands past the welcome screen
  globalThis.__OB_APP = { publicLive: true, personas: [] };
  try {
    const np = html(h(R.NoPersonaYet, { what: "Your home feed" }));
    assert(/<a[^>]*href="\/welcome#next"[^>]*data-testid="world-no-persona-link"/.test(np), "NoPersonaYet's live link for a guest: " + np.slice(0, 300));
    assert(/<a[^>]*href="\/anon"[^>]*data-testid="world-no-persona-anon"/.test(np), "NoPersonaYet offers a guest the anonymous feed in live mode");
    // signed in (the root) with no persona: the honest line, and the optional persona on the home card — never the first run
    globalThis.__OB_APP = { publicLive: true, personas: [{ id: "p1", handle: "alice", name: "Alice", publicSelf: true }] };
    const npRoot = html(h(R.NoPersonaYet, { what: "Your home feed" }));
    assert(/<a[^>]*href="\/home#make-persona"[^>]*data-testid="world-no-persona-link"[^>]*>Make a persona</.test(npRoot) && npRoot.includes("coming soon") && npRoot.includes("optional"), "NoPersonaYet for a signed-in root: " + npRoot.slice(0, 400));
    globalThis.__OB_APP = { publicLive: false };
    const rig = html(h(R.NoPersonaYet, { what: "Your home feed" }));
    assert(/href="\/settings\/account"/.test(rig) && !rig.includes("world-no-persona-anon"), "the rig's NoPersonaYet is unchanged");
  } finally {
    delete globalThis.__OB_APP;
  }
  // F11: the reads sentence — the preview's words byte for byte; live mode says "this site"; one picker for both pages
  const C = R.copy;
  assert(C.RELAY_READS === "When this preview shows live Farcaster posts, they are fetched through our server, read-only: it sees which posts and profiles are read, from which address and when.", "the preview's reads sentence changed");
  assert(C.LIVE_RELAY_READS === C.RELAY_READS.replace("When this preview shows", "When this site shows") && !/preview/i.test(C.LIVE_RELAY_READS), "the live reads sentence: " + C.LIVE_RELAY_READS);
  assert(C.relayReadsSentence(true) === C.LIVE_RELAY_READS && C.relayReadsSentence(false) === C.RELAY_READS, "relayReadsSentence");
  const landing = src("components/landing/Landing.tsx");
  const help = src("components/help/HelpPage.tsx");
  assert(landing.includes("[IDENTITY_IN_TAB, SERVER_HOLDS, relayReadsSentence(live)].join(\" \")") && !/\{\s*RELAY_READS\s*\}|, RELAY_READS\]/.test(landing), "the landing picks the reads sentence by mode");
  assert(help.includes("const reads = relayReadsSentence(live);") && help.split("{reads}").length === 3 && !help.includes("{RELAY_READS}"), "/help picks it the same way, in both places");
  // F5 / F2 / F8: the links, the target plumbing, the "sign in again" wiring (what a node render cannot reach: effects)
  const pins = [
    ["app/(main)/welcome/page.tsx", "target={readTarget(searchParams?.step)}"],
    ["components/onboarding/Onboarding.tsx", "landingStep(machineFacts, progress, target)"],
    ["components/onboarding/Onboarding.tsx", 'startOpen={target === "unlock"}'],
    ["components/onboarding/Onboarding.tsx", "afterReload={!!facts?.restored && !facts?.publicSelf}"],
    ["components/onboarding/Onboarding.tsx", "live={app.publicLive}"],
    ["components/settings/AccountPane.tsx", "href={welcomeHref(firstMissing)} data-testid=\"account-finish-setup-link\""],
    ["components/settings/AccountPane.tsx", 'href={live ? welcomeHref("farcaster") : "/device#farcaster"}'],
    ["components/device/IdentityNudge.tsx", 'href={welcomeHref("next")} data-testid="identity-finish-setup"'],
    ["components/device/FarcasterSignIn.tsx", "rejoinOffered({ hinted: true, signedIn: true, answer: j })"],
    ["components/device/FarcasterSignIn.tsx", "if (!signedInLink || !liveUniverseHinted(pageDeviceEnv())) {"],
    ["components/device/FarcasterSignIn.tsx", 'data-testid="siwf-rejoin" {...k.btn} disabled={busy} onClick={() => void start()}'],
    ["components/device/FarcasterSignIn.tsx", '!link.disconnected && rejoin === "offered" && !open'],
    ["components/Composer.tsx", "crowdSignInAsked(j) &&"],
    ["components/Composer.tsx", 'href={welcomeHref("farcaster")} data-testid="composer-anon-rejoin"'],
  ];
  for (const [f, needle] of pins) assert(src(f).includes(needle), f + " lacks: " + needle);
  // every move spends the target (Continue, Back, Skip, a persona made, an unlock)
  const ob = src("components/onboarding/Onboarding.tsx");
  assert((ob.match(/setTarget\(null\);/g) || []).length >= 4 && ob.includes('setTarget((t) => (t === "unlock" ? null : t));'), "every move spends the target (Continue, Back, Skip, a persona made; an unlock once its facts are read): " + (ob.match(/setTarget\(null\);/g) || []).length);
  assert(ob.includes("returning: facts.restored || facts.unlockedAtRead"), "returning is read with the facts (an unlock counts only for facts read after it)");
  // the card's disclosure comes BEFORE its "sign in again" button (nothing is sent before the visitor has read it)
  const card = src("components/device/FarcasterSignIn.tsx");
  assert(card.indexOf('data-testid="siwf-rejoin-disclosure"') > 0 && card.indexOf('data-testid="siwf-rejoin-disclosure"') < card.indexOf('data-testid="siwf-rejoin"'), "the disclosure precedes the rejoin button");
  return "guest door, Save lead, after-reload sentence, NoPersonaYet, reads sentence; " + pins.length + " wiring pins";
};

// PUBLIC GO-LIVE (final verify, F11): the live site's refusals say "this site", never "this preview" — the network
// write refusal (route and tooltip, one sentence), Launch (confirm + the history door) and the stub the smoke compares
// against. The preview's words stay byte for byte. Source-level (networkTarget.ts is server-only and imports the fixture
// corpus): `mut` is applied to the text read here, so every mutation below reaches what this check reads.
CHECKS.U16 = async (_M, mut = []) => {
  // a fresh module (its latch lives on globalThis), LAYERS_REQUIRE_SIG on, fetch mocked: every /device/register body is
  // recorded in the order it LANDS (answered), and a request can be held until the scenario lets it go
  const saved = { fetch: globalThis.fetch, sig: process.env.LAYERS_REQUIRE_SIG };
  globalThis.__layersEnvelope = undefined;
  process.env.LAYERS_REQUIRE_SIG = "true";
  const landed = [];
  const holds = new Map(); // path -> { gate: Promise, release }
  const hold = (p) => { let release; const gate = new Promise((r) => (release = r)); holds.set(p, { gate, release, started: null }); const started = new Promise((r) => (holds.get(p).started = r)); return { release, started }; };
  globalThis.fetch = async (url, init) => {
    const p = new URL(String(url)).pathname;
    const h = holds.get(p);
    if (h) { holds.delete(p); h.started(); await h.gate; }
    if (p === "/device/register") landed.push(JSON.parse(String(init.body)).anchorPubKey);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
  };
  try {
    const P = (await bundle("persist-entry.ts", mut.filter((m) => m.file.endsWith("persist.ts")), PERSIST_OPTS)).mod.persist;
    // A: the tick's write starts its bootstrap under OLD; the identity changes (device loss, then recovery's reset) while
    //    the anchor request is in flight; the old bootstrap then completes
    globalThis.__U16 = { anchor: "OLD" };
    const a = hold("/device/register"); // the registration body was built under OLD before the change
    const tickWrite = P.signedWriteHeaders("zkQueue", "{}");
    await a.started;
    globalThis.__U16 = { anchor: "NEW" };
    P.resetEnvelopeBootstrap();
    a.release();
    await tickWrite;
    await P.signedWriteHeaders("rootRoster", "{}");
    assert(landed.length >= 2 && landed[landed.length - 1] === "NEW", "after an identity change mid-bootstrap the device's last registration names " + JSON.stringify(landed) + " (the old identity's anchor would take every later write)");
    // B: an enrollment (recovery's enrollWithSeed) while a bootstrap's registration is still in flight
    landed.length = 0;
    globalThis.__layersEnvelope.bootstrapped = false;
    globalThis.__U16 = { anchor: "BLANK" };
    const r = hold("/device/register");
    const tick2 = P.signedWriteHeaders("lenses", "{}");
    await r.started;
    const enroll = P.enrollWithSeed("SEED");
    await new Promise((res) => setTimeout(res, 30)); // enrollment would land now if nothing ordered it
    r.release();
    await tick2;
    await enroll;
    assert(JSON.stringify(landed) === JSON.stringify(["BLANK", "anchor-of-SEED"]), "an enrollment landed before a bootstrap ahead of it: " + JSON.stringify(landed));
    const before = landed.length;
    await P.signedWriteHeaders("rings", "{}");
    assert(landed.length === before, "a write after an enrollment registered again: " + JSON.stringify(landed));
    return "across a change: " + landed.length + " registrations, the last for the enrolled identity";
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.sig === undefined) delete process.env.LAYERS_REQUIRE_SIG;
    else process.env.LAYERS_REQUIRE_SIG = saved.sig;
    globalThis.__layersEnvelope = undefined;
  }
};

CHECKS.U15 = async (_M, mut = []) => {
  const read = (f) => {
    let t = src(f);
    for (const m of mut.filter((x) => x.file === f)) {
      if (!t.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + f + ": " + m.find.slice(0, 80));
      t = t.replace(m.find, m.replace);
    }
    return t;
  };
  const PREVIEW = "Posting to Farcaster isn't on this preview yet. Reading is live; your own posts, folders and private posts still work.";
  const quoted = (t, re) => { const m = re.exec(t); return m ? m[1] : null; };
  const nt = read("lib/fc/networkTarget.ts");
  const cc = read("components/CastCard.tsx");
  const stub = read("scripts/lib/neynar-stub.mjs");
  const liveRoute = quoted(nt, /export const NETWORK_READ_ONLY_LIVE = \{\s*code: "NETWORK_READ_ONLY",\s*error: "([^"]+)",/);
  const prevRoute = quoted(nt, /export const NETWORK_READ_ONLY = \{\s*code: "NETWORK_READ_ONLY",\s*error: "([^"]+)",/);
  const liveCard = quoted(cc, /export const NETWORK_READ_ONLY_SENTENCE_LIVE =\s*"([^"]+)";/);
  const prevCard = quoted(cc, /export const NETWORK_READ_ONLY_SENTENCE =\s*"([^"]+)";/);
  const liveStub = quoted(stub, /networkReadOnlyLive: \{\s*status: 403,\s*code: "NETWORK_READ_ONLY",\s*error: "([^"]+)",/);
  assert(prevRoute === PREVIEW && prevCard === PREVIEW, "the preview's refusal changed: " + JSON.stringify([prevRoute, prevCard]));
  assert(liveRoute && !/preview/i.test(liveRoute) && /this site/.test(liveRoute), "the live refusal: " + JSON.stringify(liveRoute));
  assert(liveCard === liveRoute && liveStub === liveRoute, "the tooltip, the route and the smoke's stub disagree: " + JSON.stringify([liveCard, liveRoute, liveStub]));
  // the picker: live words exactly when live, and every refusal goes through it (no bare preview constant returned)
  assert(nt.includes("  return isPublicLive() ? NETWORK_READ_ONLY_LIVE : NETWORK_READ_ONLY;"), "networkReadOnlyAnswer does not pick by isPublicLive");
  assert(!/return NETWORK_READ_ONLY;/.test(nt) && (nt.match(/return networkReadOnlyAnswer\(\);/g) || []).length === 3, "a write or follow refusal returns the preview's words directly");
  assert(cc.includes('  return env?.PUBLIC_LIVE === "on" ? NETWORK_READ_ONLY_SENTENCE_LIVE : NETWORK_READ_ONLY_SENTENCE;'), "the card's sentence does not pick by the device env");
  for (const f of ["components/CastCard.tsx", "components/ProfileHeader.tsx", "components/thread/ThreadIsland.tsx"]) {
    const t = read(f).split("\n").filter((l) => !/export const NETWORK_READ_ONLY_SENTENCE|^  if \(typeof window === "undefined"\) return NETWORK_READ_ONLY_SENTENCE;$|NETWORK_READ_ONLY_SENTENCE_LIVE : NETWORK_READ_ONLY_SENTENCE;$/.test(l)).join("\n");
    assert(!/\bNETWORK_READ_ONLY_SENTENCE\b(?!_LIVE)/.test(t), f + " shows the preview's sentence directly instead of networkReadOnlySentence()");
  }
  assert(read("scripts/smoke-deployed.mjs").includes("const lwant = RELAY.networkReadOnlyLive;"), "the deployed smoke's live branch expects the preview's words");
  // Launch
  const lc = read("lib/launch/confirm.ts");
  const lr = read("app/api/launch/route.ts");
  assert(lc.includes(`reason: isPublicLive() ? "Launch isn't on this site yet." : "Launch isn't on this preview yet." }`), "lib/launch/confirm.ts: the live site still hears 'this preview'");
  assert(lr.includes(`isPublicLive() ? "Launch isn't on this site yet." : "Launch isn't on this preview yet."`) && !lr.includes(`{ error: "Launch isn't on this preview yet.", code: "public_preview" }`), "app/api/launch/route.ts: the history door still says 'this preview' on the live site");
  // availability: the live site's unarmed words (the unit-anon-relay A1 check runs the real function)
  const av = read("lib/zk/anon/availability.ts");
  assert(av.includes("          publicLiveHere() ? ANON_OFF_LIVE_RELAY_OFF : ANON_OFF_BROWSER_LIVE,"), "availability's live refusal ignores PUBLIC_LIVE");
  assert(!/preview/i.test(quoted(av, /export const ANON_OFF_LIVE_RELAY_OFF = "([^"]+)";/) || "preview"), "ANON_OFF_LIVE_RELAY_OFF mentions a preview");
  // PRIV-LIVE-1: a sign-in that joins the live crowd is seen by Totem's validator, and the card says so before the request
  const pc = read("components/help/privacy-copy.tsx");
  const card = read("components/device/FarcasterSignIn.tsx");
  const liveSees = quoted(pc, /export const SIWF_SERVER_SEES_LIVE = "([^"]+)";/);
  assert(liveSees && /records that your Farcaster account joined the anonymous crowd, with your internet address/.test(liveSees) && !/sees nothing/i.test(liveSees), "SIWF_SERVER_SEES_LIVE: " + JSON.stringify(liveSees));
  assert(quoted(pc, /export const SIWF_SERVER_SEES = "([^"]+)";/) === "Totem's server sees nothing.", "the not-live sentence changed");
  const rj0 = card.indexOf('data-testid="siwf-rejoin-disclosure"');
  const rejoinBlock = card.slice(rj0, card.indexOf("</div>", rj0));
  assert(rj0 > 0 && rejoinBlock.includes("{SIWF_SERVER_SEES_LIVE}") && !/server sees nothing/.test(rejoinBlock), "the 'sign in again' disclosure (always a live join) does not name the join: " + rejoinBlock.slice(0, 200));
  const d0 = card.indexOf('data-testid="siwf-disclosure"');
  const firstBlock = card.slice(d0, card.indexOf("</div>", d0));
  assert(d0 > 0 && firstBlock.includes("{liveUniverseHinted(pageDeviceEnv()) ? (") && firstBlock.includes("<>{SIWF_SERVER_SEES_LIVE}</>") && firstBlock.includes("<>Totem&rsquo;s server sees nothing.</>"), "the first sign-in's disclosure does not pick by the live hint: " + firstBlock.slice(0, 300));
  return "network refusal (route = tooltip = stub; preview unchanged), Launch (confirm + history), availability's unarmed words; the sign-in disclosure names the live join";
};

// ---------------------------------------------------------------------------------------------------------------- run
await check("U1", "the step machine: the walk, every skip, from=anon, the returning-visitor rule, Back, the indicator", CHECKS.U1);
await check("U2", "the X step: a whole-file lookup by fid; never fail open (failed, unbuilt, malformed → unknown)", CHECKS.U2);
await check("U3", "the device-made picture: deterministic, distinct, small, no host", CHECKS.U3);
await check("U4", "the switch: server, boot, device and hint matrices; the deliberate duplicate", CHECKS.U4);
await check("U5", "the world: the empty twin on a live server and in a live tab only", CHECKS.U5);
await check("U6", "ORDER: the device env is declared before device.js; a late flag would load the demo bank", (m) => CHECKS.U6(m, []));
await check("U7", "where a post goes: the route's contract, word for word; never words of its own", CHECKS.U7);
await check("U8", "phone detection and handle suggestion", CHECKS.U8);
await check("U9", "validator/seed.js under PUBLIC_LIVE: nothing seeded, nothing deleted, bad values refused, rig unchanged", (m) => CHECKS.U9(m, []));
await check("U10", "the wiring, pinned in the sources", CHECKS.U10);
await check("U11", "F1: the anonymous universe hint reaches every tab (live + ZK_MODE live over fixture; junk invalid; unset unchanged)", (m) => CHECKS.U11(m, []));
await check("U12", "F5: an explicit target (?step=, next, #unlock) lands where the link said", CHECKS.U12);
await check("U13", "F2: 'sign in again' follows availability's own words in a live, armed tab; the hint and the sign-in required", CHECKS.U13);
await check("U14", "F8/F10/F11 rendered, F2/F5 wiring pinned", (m) => CHECKS.U14(m, []));
await check("U15", "F11: the live site's refusals say 'this site' (network writes, Launch, an unarmed relay); the preview's words unchanged", (m) => CHECKS.U15(m, []));
await check("U16", "the registration lane: a bootstrap across an identity change registers again for the current identity; an enrollment never lands before a bootstrap ahead of it", (m) => CHECKS.U16(m, []));

// ---------------------------------------------------------------------------------------------------------------- M
const MUTATIONS = [
  ["a doctored step order (Save before Farcaster)", "U1", [{ file: "lib/onboarding/state.ts", find: `  if (!f.publicSelf && !skipped("farcaster")) return "farcaster";\n  if (f.publicSelf && !p.profileSeen && !skipped("profile")) return "profile";\n  if (!f.saved && !skipped("save")) return "save";`, replace: `  if (!f.saved && !skipped("save")) return "save";\n  if (!f.publicSelf && !skipped("farcaster")) return "farcaster";\n  if (f.publicSelf && !p.profileSeen && !skipped("profile")) return "profile";` }]],
  // THE OWNER'S RULE: a persona is never forced. Each mutation brings the old forced persona step back one way
  ["THE FORCED PERSONA STEP COMES BACK (the machine asks for a persona before the hand-off)", "U1", [{ file: "lib/onboarding/state.ts", find: `  if (!f.saved && !skipped("save")) return "save";\n  return "done";`, replace: `  if (!f.saved && !skipped("save")) return "save";\n  if (f.personas === 0 && !skipped("persona" as OnboardingStep)) return "persona" as OnboardingStep;\n  return "done";` }]],
  ["THE FORCED PERSONA STEP COMES BACK (the step list holds it again)", "U1", [{ file: "lib/onboarding/state.ts", find: `export const ONBOARDING_STEPS = ["welcome", "farcaster", "profile", "save", "done"] as const;`, replace: `export const ONBOARDING_STEPS = ["welcome", "farcaster", "profile", "save", "persona", "done"] as const;` }]],
  ["done requires a persona again (a signed-in visitor is never set up without one)", "U1", [{ file: "lib/onboarding/state.ts", find: "  return f.publicSelf || f.personas > 0;", replace: "  return f.personas > 0;" }]],
  ["a sign-in made in this document counts as a returning visitor's (This is you skipped)", "U1", [{ file: "lib/onboarding/state.ts", find: "  return f.personas > 0 || (f.publicSelf && !p.signedInHere);", replace: "  return f.personas > 0 || f.publicSelf;" }]],
  ["a skip forgets the sign-in made here", "U1", [{ file: "lib/onboarding/state.ts", find: "  return { ...p, started: true, skipped: p.skipped.includes(step)", replace: "  return { started: true, profileSeen: p.profileSeen, signedInHere: false, skipped: p.skipped.includes(step)" }]],
  ["This is you is skipped for a signed-in visitor", "U1", [{ file: "lib/onboarding/state.ts", find: `  if (f.publicSelf && !p.profileSeen && !skipped("profile")) return "profile";\n`, replace: "" }]],
  ["a username alternative may be a taken one", "U8", [{ file: "lib/onboarding/state.ts", find: `    if (c && c !== b && /^[a-z0-9_]{1,30}$/.test(c) && !out.includes(c) && !isTaken(c)) out.push(c);`, replace: `    if (c && /^[a-z0-9_]{1,30}$/.test(c) && !out.includes(c)) out.push(c);` }]],
  ["#profile shows This is you to a visitor who is not signed in", "U12", [{ file: "lib/onboarding/state.ts", find: `  if (target === "profile") return f.publicSelf ? "profile" : "farcaster";`, replace: `  if (target === "profile") return "profile";` }]],
  ["the returning rule forgets 'returning'", "U1", [{ file: "lib/onboarding/state.ts", find: "  if (!f.returning) return false;\n", replace: "" }]],
  ["a failed X download reads as 'no X account'", "U2", [{ file: "lib/onboarding/xHandle.ts", find: `    return { state: "unknown", reason: String((e as Error)?.message ?? e).slice(0, 200) || "the X list could not be downloaded" };`, replace: `    return { state: "none" };` }]],
  ["an unbuilt X index reads as 'no X account'", "U2", [{ file: "lib/onboarding/xHandle.ts", find: `    return { state: "unknown", reason: reason.slice(0, 200) };`, replace: `    return { state: "none" };` }]],
  ["the picture is random per render", "U3", [{ file: "lib/identity/localAvatar.ts", find: `fnv1a("layers-avatar/v1:" + String(seed ?? ""))`, replace: `fnv1a("layers-avatar/v1:" + String(seed ?? "") + Math.random())` }]],
  ["the server half ignores the deployment shape", "U4", [{ file: "lib/platform/publicLive.ts", find: `  return isPublicShape(env) && env.PUBLIC_LIVE === "true";`, replace: `  return env.PUBLIC_LIVE === "true";` }]],
  ["bank() ignores public live mode", "U5", [{ file: "lib/world-flag.ts", find: "  return isEmptyWorld() || isPublicLive() ? empty : demo;", replace: "  return isEmptyWorld() ? empty : demo;" }]],
  ["the loader declares the env AFTER device.js", "U6", [{ file: "components/device/loadDevice.ts", find: "    if (opts.overwriteEnv || !w().__LAYERS_DEVICE_ENV) w().__LAYERS_DEVICE_ENV = env;\n", replace: "" }, { file: "components/device/loadDevice.ts", find: "    const device = await ensureBundle();\n", replace: "    const device = await ensureBundle();\n    w().__LAYERS_DEVICE_ENV = env;\n" }]],
  ["the tab never runs the empty world", "U6", [{ file: "lib/world-flag.ts", find: "  if (typeof window !== \"undefined\") return isPublicLive();", replace: "  if (typeof window !== \"undefined\") return false;" }, { file: "lib/world-flag.ts", find: "  return isEmptyWorld() || isPublicLive() ? empty : demo;", replace: "  return isEmptyWorld() ? empty : demo;" }]],
  ["the destination fallback writes its own words", "U7", [{ file: "lib/onboarding/state.ts", find: `  if (o.available === false && typeof o.unavailableReason === "string" && o.unavailableReason.trim()) return o.unavailableReason;\n  return null;`, replace: `  if (o.available === false && typeof o.unavailableReason === "string" && o.unavailableReason.trim()) return o.unavailableReason;\n  return "Your posts go to Farcaster.";` }]],
  ["the seed seeds a live public validator anyway", "U9", [{ file: "validator/seed.js", find: `if (publicLive) {\n  console.log("[seed] PUBLIC_LIVE=true — the demo world is not seeded; the empty database stays empty (no roster written)");\n  process.exit(0);\n}`, replace: "" }]],
  ["the seed allows --force under PUBLIC_LIVE", "U9", [{ file: "validator/seed.js", find: `if (publicLive && force) {`, replace: `if (false && publicLive && force) {` }]],
  // PUBLIC GO-LIVE (F10, F1, F5, F2)
  ["a restored identity sees Welcome again (F10)", "U1", [{ file: "lib/onboarding/state.ts", find: `  if (fresh && !p.started && !f.returning) return "welcome";`, replace: `  if (fresh && !p.started) return "welcome";` }]],
  ["deviceEnv drops the universe hint (F1)", "U11", [{ file: "lib/device/deviceEnv.server.ts", find: "    ...anonUniverseHints(),\n", replace: "" }]],
  ["the hint spread BEFORE ZK_MODE, so the app's fixture wins (F1)", "U11", [{ file: "lib/device/deviceEnv.server.ts", find: `    ZK_MODE: process.env.ZK_MODE || "fixture",\n    // PUBLIC GO-LIVE (F1): the anonymous universe hint, AFTER ZK_MODE so its ZK_MODE "live" wins (see the header)\n    ...anonUniverseHints(),\n`, replace: `    ...anonUniverseHints(),\n    ZK_MODE: process.env.ZK_MODE || "fixture",\n` }]],
  ["a named target is ignored (F5)", "U12", [{ file: "lib/onboarding/state.ts", find: `  if (target === "farcaster" || target === "save") return target;\n`, replace: "" }]],
  ["#unlock is not read (F5)", "U12", [{ file: "lib/onboarding/state.ts", find: `  if (name === "unlock" || (STEP_TARGETS as readonly string[]).includes(name)) return name as OnboardingTarget;`, replace: `  if ((STEP_TARGETS as readonly string[]).includes(name)) return name as OnboardingTarget;` }]],
  ["the hash carries no step target (F5)", "U12", [{ file: "lib/onboarding/state.ts", find: `  if (name === "unlock" || (STEP_TARGETS as readonly string[]).includes(name)) return name as OnboardingTarget;`, replace: `  if (name === "unlock") return "unlock";` }]],
  ["the app's links put the target in the query, where the server sees it (F5)", "U12", [{ file: "lib/onboarding/state.ts", find: `  return target ? "/welcome#" + target : "/welcome";`, replace: `  return target ? (target === "unlock" ? "/welcome#unlock" : "/welcome?step=" + target) : "/welcome";` }]],
  ["?step=next keeps the welcome screen (F5)", "U12", [{ file: "lib/onboarding/state.ts", find: `  if (target === "next") return nextStep(f, { ...p, started: true });`, replace: `  if (target === "next") return nextStep(f, p);` }]],
  ["any crowd answer offers the sign-in again (F2)", "U13", [{ file: "lib/onboarding/state.ts", find: String.raw`  return /\bsign in with Farcaster\b/i.test(reason);`, replace: `  return true;` }]],
  ["a known time (availableFrom) still offers it (F2)", "U13", [{ file: "lib/onboarding/state.ts", find: `  if (typeof o.availableFrom === "number") return false;\n`, replace: "" }]],
  ["the offer ignores the live hint (F2)", "U13", [{ file: "lib/onboarding/state.ts", find: `  return o.hinted === true && o.signedIn === true && crowdSignInAsked(o.answer);`, replace: `  return o.signedIn === true && crowdSignInAsked(o.answer);` }]],
  ["the live guest door goes back to /home (F8)", "U14", [{ file: "components/onboarding/steps/WelcomeStep.tsx", find: `<Link href="/anon" data-testid="onboard-guest"`, replace: `<Link href="/home" data-testid="onboard-guest"` }]],
  ["Not now loses the sentence that says what it does", "U14", [{ file: "components/onboarding/steps/SaveStep.tsx", find: "            {NOT_NOW_NOTE}\n", replace: "" }]],
  ["Continue with X is offered as working (not disabled)", "U14", [{ file: "components/onboarding/steps/WelcomeStep.tsx", find: `          data-testid="onboard-x-soon"\n          disabled\n`, replace: `          data-testid="onboard-x-soon"\n` }]],
  ["the welcome screen explains the old flow again", "U14", [{ file: "components/onboarding/steps/WelcomeStep.tsx", find: `{FRONT_LINE}</p>`, replace: `{FRONT_LINE} Then make your first persona.</p>` }]],
  ["the indicator counts four steps", "U14", [{ file: "lib/onboarding/state.ts", find: `export const COUNTED_STEPS: readonly OnboardingStep[] = ["farcaster", "profile", "save"];`, replace: `export const COUNTED_STEPS: readonly OnboardingStep[] = ["farcaster", "profile", "save", "done"];` }]],
  ["the after-reload sentence is never shown (F10)", "U14", [{ file: "components/onboarding/steps/FarcasterStep.tsx", find: "{afterReload && !acted && !signedIn ? (", replace: "{false ? (" }]],
  ["NoPersonaYet goes back to the welcome screen (F8)", "U14", [{ file: "components/world/NoPersonaYet.tsx", find: `href={root ? MAKE_PERSONA_HREF : welcomeHref("next")}`, replace: `href={root ? MAKE_PERSONA_HREF : "/welcome"}` }]],
  ["NoPersonaYet sends a signed-in root back into the first run for a persona", "U14", [{ file: "components/world/NoPersonaYet.tsx", find: `href={root ? MAKE_PERSONA_HREF : welcomeHref("next")}`, replace: `href={welcomeHref("next")}` }]],
  ["the live site still says 'this preview' about reads (F11)", "U14", [{ file: "components/help/privacy-copy.tsx", find: "  return live ? LIVE_RELAY_READS : RELAY_READS;", replace: "  return RELAY_READS;" }]],
  // PUBLIC GO-LIVE (final verify, F11)
  ["the write refusal returns the preview's words on a live site (F11)", "U15", [{ file: "lib/fc/networkTarget.ts", find: "      if (await isNetworkCastTarget(t)) return networkReadOnlyAnswer();", replace: "      if (await isNetworkCastTarget(t)) return NETWORK_READ_ONLY;" }]],
  ["the picker ignores live mode (F11)", "U15", [{ file: "lib/fc/networkTarget.ts", find: "  return isPublicLive() ? NETWORK_READ_ONLY_LIVE : NETWORK_READ_ONLY;", replace: "  return NETWORK_READ_ONLY;" }]],
  ["the tooltip and the route say different live words (F11)", "U15", [{ file: "components/CastCard.tsx", find: `"Liking, replying to or recasting Farcaster posts from Totem isn't on this site yet.`, replace: `"Liking or replying to Farcaster posts isn't on this site yet.` }]],
  ["a thread shows the preview's sentence directly (F11)", "U15", [{ file: "components/thread/ThreadIsland.tsx", find: "          {networkReadOnlySentence()}\n", replace: "          {NETWORK_READ_ONLY_SENTENCE}\n" }]],
  ["Launch says 'this preview' on the live site (F11)", "U15", [{ file: "lib/launch/confirm.ts", find: `reason: isPublicLive() ? "Launch isn't on this site yet." : "Launch isn't on this preview yet." }`, replace: `reason: "Launch isn't on this preview yet." }` }]],
  ["the smoke expects the preview's words on a live site (F11)", "U15", [{ file: "scripts/smoke-deployed.mjs", find: "const lwant = RELAY.networkReadOnlyLive;", replace: "const lwant = RELAY.networkReadOnly;" }]],
  ["the 'sign in again' disclosure says Totem sees nothing (PRIV-LIVE-1)", "U15", [{ file: "components/device/FarcasterSignIn.tsx", find: "which sees your internet address too. {SIWF_SERVER_SEES_LIVE}\n", replace: "which sees your internet address too. Totem&rsquo;s server sees nothing.\n" }]],
  ["the first disclosure ignores the live hint (PRIV-LIVE-1)", "U15", [{ file: "components/device/FarcasterSignIn.tsx", find: "            {liveUniverseHinted(pageDeviceEnv()) ? (\n              <>{SIWF_SERVER_SEES_LIVE}</>", replace: "            {false ? (\n              <>{SIWF_SERVER_SEES_LIVE}</>" }]],
  // PUBLIC GO-LIVE (final verify): the registration lane (U16)
  ["a bootstrap that ran across an identity change still counts", "U16", [{ file: "lib/adapters/mock/persist.ts", find: "      if ((st.gen ?? 0) === gen) st.bootstrapped = true; // else the identity changed in flight: the loop registers again", replace: "      st.bootstrapped = true;" }]],
  ["an enrollment skips the registration lane", "U16", [{ file: "lib/adapters/mock/persist.ts", find: "  return inRegistrationLane(() => enrollWithSeedNow(seedHex, opts));", replace: "  return enrollWithSeedNow(seedHex, opts);" }]],
  ["the live sentence says 'sees nothing' (PRIV-LIVE-1)", "U15", [{ file: "components/help/privacy-copy.tsx", find: 'export const SIWF_SERVER_SEES_LIVE = "Then Totem checks', replace: 'export const SIWF_SERVER_SEES_LIVE = "Totem\' server sees nothing. Then Totem checks' }]],
];
// U6, U11 and U14 bundle their own entries (the mutation is applied there, not to entry.ts)
const SELF_BUNDLING = new Set(["U6", "U11", "U14", "U15", "U16"]);
if (want("M")) {
  console.log("\n  mutations (each must make its check FAIL):");
  for (const [label, id, muts] of MUTATIONS) {
    try {
      let threw = false;
      let why = "";
      try {
        const bundleMuts = muts.filter((m) => m.file !== "validator/seed.js");
        const Mm = bundleMuts.length && !SELF_BUNDLING.has(id) ? (await bundle("entry.ts", bundleMuts)).mod : M;
        await CHECKS[id](Mm, muts);
      } catch (e) {
        // final verify: a mutated copy that does not even BUILD proves nothing about the check (it used to count as caught)
        if (/MUTATION (ANCHOR|FILE)|Build failed/.test(String(e && e.message))) throw e;
        threw = true;
        why = String((e && e.message) || e).slice(0, 110);
      }
      if (threw) {
        passed++;
        console.log(`  PASS  M ${label} → ${id} fails (${why})`);
      } else {
        failed++;
        failedIds.push("M:" + id);
        console.log(`  FAIL  M ${label} → ${id} STILL PASSES (the check is vacuous)`);
      }
    } catch (e) {
      failed++;
      failedIds.push("M:" + id);
      console.log(`  FAIL  M ${label} — ${e && e.message ? e.message : String(e)}`);
    }
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failed === 0 ? "PASSED" : "FAILED"}: ${passed} checks passed, ${failed} failed${failedIds.length ? " (" + failedIds.join(", ") + ")" : ""}`);
process.exit(failed === 0 ? 0 : 1);
