// BROWSER KEYSTORE PASS Gate 1 stage 3 — builds the browser device: the app's own data layer and API route
// handlers, bundled for the browser behind small shims for next/server, next/headers, server-only, react and node:*
// (docs/custody-model.md D-CU-0-3). Output: public/device/device.js, served statically by Next.
//   node scripts/build-device.mjs            one build
//   node scripts/build-device.mjs --watch    rebuild on change
//
// PERSONA LAUNCH P7 — and the browser's PROVER, a second bundle beside it:
//   public/device/prover.js              lib/zk/prover/browser-worker.ts — a module Web Worker the device starts lazily,
//                                        one job per worker (lib/zk/transport/browser.ts). The ONLY browser file that
//                                        carries snarkjs (GPL-3.0): its banner says so and where the corresponding
//                                        source is, and prover.js.LICENSE.txt carries the notice, the bundled packages'
//                                        own license comments and the full GPL-3.0 text (snarkjs's COPYING).
//   public/device/zk/semaphore-20.wasm   the pinned proving files, COPIED from ZK_ARTIFACT_DIR (default .zk-artifacts)
//   public/device/zk/semaphore-20.zkey   ONLY when both are present there AND match their pins (bytes, sha256,
//                                        blake2b-512 — lib/zk/ceremonyPins.ts). This script NEVER downloads anything;
//                                        a missing or mismatched pair ships no files (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY)
//   public/device/zk/manifest.json       { present, pins, … } — the worker reads `present` only; it trusts its own pins
// PUBLIC GO-LIVE (the relay track, A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY): two switches for a DEPLOYED build. ZK_ARTIFACT_FETCH=1 fetches a MISSING pinned file into ZK_ARTIFACT_DIR from the pinned host (lib/zk/ceremonyPins.ts SEMAPHORE_ARTIFACT_BASE) before staging and keeps it only if it matches its pins (bytes, sha256, blake2b-512) — the one download this script makes, opt-in. REQUIRE_ZK_ARTIFACTS=1 FAILS the build when the files are absent or off-pin, or over ZK_FILES_BUDGET_BYTES (6 MiB).
//   public/device/source/                PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER, owner decision J): prover.js's
//                                        GPL-3.0 SOURCE OFFER, written on every build by stageSourceOffer() from
//                                        scripts/lib/gpl-source.mjs — the Totem files the bundle was built from (read
//                                        from esbuild's METAFILE, never a hand-kept list) byte for byte as .ts.txt, the
//                                        files that control the build, the GPL-3.0 text, a manifest (sha256 of each,
//                                        snarkjs / ffjavascript versions with tagged upstream links, every bundled
//                                        package, the commit) and a notice page. The build FAILS — and deletes prover.js
//                                        and its LICENSE file — when the offer does not match the bundle: a sixth Totem
//                                        input, a file that cannot be read, a missing GPL text or a served byte that
//                                        differs from its source. prover.js never ships without its offer.
// All of it is generated and gitignored. The pinned verification key is bundled into prover.js as TEXT (the define
// __LAYERS_PINNED_VKEY_TEXT__) after this script checks it against VKEY_PIN — an unpinned key fails the build.
// PERSONA LAUNCH GO-LIVE: the banner's list of Totem files is no longer hand-kept either: a metafile-only pre-pass of the
// same prover build names them (proverBanner), and the real build's metafile must name the same set.
//
// BUDGETS that FAIL the build (D-PROVER-BUNDLE-BUDGET): device.js <= 5,242,880 bytes (5 MiB; it was 4.5 MiB until
// 2026-11-07, when the hub readers, notifications, For You, the extras on real posts and ads together reached 4,761,006
// bytes; the follow-up is to split the hub readers into a chunk loaded only on the feeds that use them) and free of every
// snarkjs/ffjavascript marker literal (snarkjs must never ride the bundle every page loads);
// prover.js <= 1,572,864 bytes (1.5 MiB). Sizes are printed every build.
import { build, context, version as ESBUILD_VERSION } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFER_DIR_NAME, OFFER_URL, buildOffer, bundledPackagesOf, layersInputsOf, offerProblems, readCommit, servedProblems, writeOffer } from "./lib/gpl-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (name) => path.join(ROOT, "lib", "device", "shims", name + ".ts");

export const DEVICE_BUDGET_BYTES = 5_242_880;
export const PROVER_BUDGET_BYTES = 1_572_864;
export const ZK_FILES_BUDGET_BYTES = 6_291_456;
export function zkArtifactViolations({ required, present, reason, bytes }) {
  const out = [];
  if (required && !present) out.push("REQUIRE_ZK_ARTIFACTS=1 and the pinned proving files are not shipped (" + (reason || "absent") + ")");
  if (present && !(Number.isFinite(bytes) && bytes > 0)) out.push("the shipped proving files' size is unknown");
  else if (present && bytes > ZK_FILES_BUDGET_BYTES) out.push(`the proving files are ${bytes} bytes, over their budget of ${ZK_FILES_BUDGET_BYTES}`);
  return out;
}
export async function fetchMissingArtifacts(pins, artifactDir, fetchImpl = fetch) {
  const p = pins.ARTIFACT_PINS[pins.PINNED_DEPTH];
  const notes = [];
  mkdirSync(artifactDir, { recursive: true });
  for (const pin of [p.wasm, p.zkey]) {
    const file = path.join(artifactDir, pin.file);
    if (existsSync(file)) continue;
    const url = pins.SEMAPHORE_ARTIFACT_BASE + pin.file;
    let b = null;
    try { const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) }); if (res.ok) b = Buffer.from(await res.arrayBuffer()); else notes.push(`${pin.file}: ${url} answered ${res.status}`); } catch (e) { notes.push(`${pin.file}: ${url} did not answer (${e && e.name ? e.name : "error"})`); }
    if (!b) continue;
    if (b.length !== pin.bytes || sha256(b) !== pin.sha256 || blake2b512(b) !== pin.blake2b512) { notes.push(`${pin.file}: the fetched bytes do not match the pins — discarded`); continue; }
    writeFileSync(file, b);
    notes.push(`${pin.file}: fetched from ${url}, pins checked`);
  }
  return notes;
}
/** literals only snarkjs / ffjavascript put in a bundle (they survive minification; scripts/unit-prover.mjs checks each
 *  one is present in prover.js, so this list cannot go stale silently) */
export const SNARK_MARKERS = Object.freeze(["ffjavascript", "snarkjs", "snarkJS", "Invalid witness length", "zkey file is not groth16", "data:application/javascript;base64,"]);

/** PURE: the budget verdict over what the build produced — an empty list is a pass */
export function budgetViolations({ deviceBytes, deviceText, proverBytes }) {
  const out = [];
  if (!Number.isFinite(deviceBytes)) out.push("device.js size unknown");
  else if (deviceBytes > DEVICE_BUDGET_BYTES) out.push(`device.js is ${deviceBytes} bytes, over its budget of ${DEVICE_BUDGET_BYTES}`);
  if (typeof deviceText !== "string") out.push("device.js could not be read for the snarkjs check");
  else for (const m of SNARK_MARKERS) if (deviceText.includes(m)) out.push(`device.js carries a snarkjs/ffjavascript marker (${JSON.stringify(m)}) — snarkjs belongs in prover.js only`);
  if (!Number.isFinite(proverBytes)) out.push("prover.js size unknown");
  else if (proverBytes > PROVER_BUDGET_BYTES) out.push(`prover.js is ${proverBytes} bytes, over its budget of ${PROVER_BUDGET_BYTES}`);
  return out;
}

// LAYERS_DEVICE_OUT (a directory): build there instead of public/device — a scratch build (a builder checking sizes)
// that cannot replace the files a running pair is serving. Unset: public/device, as always.
const OUT_DIR = process.env.LAYERS_DEVICE_OUT ? path.resolve(process.env.LAYERS_DEVICE_OUT) : path.join(ROOT, "public", "device");
const DEVICE_OUT = path.join(OUT_DIR, "device.js");
const PROVER_OUT = path.join(OUT_DIR, "prover.js");
const ZK_OUT = path.join(OUT_DIR, "zk");
const VKEY_FILE = path.join(ROOT, "node_modules", "@semaphore-protocol", "proof", "src", "verification-keys.json");

const pkgVersion = (rel) => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "node_modules", rel, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
};
export const SNARKJS_VERSION = pkgVersion("snarkjs");
export const FFJS_VERSION = (() => {
  const nested = pkgVersion("snarkjs/node_modules/ffjavascript");
  return nested !== "unknown" ? nested : pkgVersion("ffjavascript");
})();
const PROVER_ENTRY_REL = "lib/zk/prover/browser-worker.ts";
/**
 * PURE: prover.js's banner. PERSONA LAUNCH GO-LIVE: `layersFiles` (the bundle's Totem inputs, from the metafile pre-pass)
 * replace the hand-kept list, and the banner names the source offer (/device/source/). The LICENSE file's name stays in
 * the banner's first 2,000 characters (smoke-deployed check 11) and its first 1,200 (accept-anon-prod check 1).
 */
export function proverBanner({ snarkjs = SNARKJS_VERSION, ffjavascript = FFJS_VERSION, layersFiles }) {
  const others = [...(layersFiles || [])].filter((f) => f !== PROVER_ENTRY_REL).sort();
  return (
    `// Totem browser prover (public/device/prover.js) — built by scripts/build-device.mjs from ${PROVER_ENTRY_REL}.\n` +
    `// This file contains snarkjs ${snarkjs} and ffjavascript ${ffjavascript} (and wasmcurves, wasmbuilder, fastfile, r1csfile, binfileutils), licensed GPL-3.0;\n` +
    `// this file as a whole is distributed under GPL-3.0. Corresponding source: https://github.com/iden3/snarkjs (v${snarkjs}),\n` +
    `// https://github.com/iden3/ffjavascript (v${ffjavascript}), and Totem's own ${PROVER_ENTRY_REL} with the modules it imports\n` +
    `// (${others.join(", ")}). Full notices and the GPL-3.0 text:\n` +
    `// /device/prover.js.LICENSE.txt\n` +
    `// The source offer (those Totem files exactly as built, with sha256, the build files and every bundled package): ${OFFER_URL}`
  );
}

/** the pins, read from the ONE copy (lib/zk/ceremonyPins.ts) by bundling it — never a second hand-kept list */
async function loadPins() {
  const r = await build({ absWorkingDir: ROOT, entryPoints: [path.join(ROOT, "lib", "zk", "ceremonyPins.ts")], bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const blake2b512 = (b) => createHash("blake2b512").update(b).digest("hex");

/** copy the pinned proving files ONLY if present and verified; write the manifest either way; NEVER download */
export function stageArtifacts(pins, { artifactDir, outDir }) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const p = pins.ARTIFACT_PINS[pins.PINNED_DEPTH];
  const result = { present: false, reason: "", files: [] };
  const check = (pin) => {
    const file = path.join(artifactDir, pin.file);
    if (!existsSync(file)) return `${pin.file} is not in ${artifactDir}`;
    const b = readFileSync(file);
    if (b.length !== pin.bytes) return `${pin.file} is ${b.length} bytes, its pin says ${pin.bytes}`;
    if (sha256(b) !== pin.sha256) return `${pin.file} does not match its sha256 pin`;
    if (blake2b512(b) !== pin.blake2b512) return `${pin.file} does not match its blake2b-512 pin`;
    return null;
  };
  const problems = [check(p.wasm), check(p.zkey)].filter(Boolean);
  if (problems.length === 0) {
    for (const pin of [p.wasm, p.zkey]) copyFileSync(path.join(artifactDir, pin.file), path.join(outDir, pin.file));
    result.present = true;
    result.files = [p.wasm.file, p.zkey.file];
  } else result.reason = problems.join("; ");
  const manifest = {
    present: result.present,
    depth: pins.PINNED_DEPTH,
    version: pins.SEMAPHORE_ARTIFACT_VERSION,
    // informational: the worker checks the files against the pins bundled INTO prover.js, never against these
    pins: { wasm: p.wasm, zkey: p.zkey, vkey: pins.VKEY_PIN },
    note: result.present ? "the pinned Semaphore v4 depth-20 proving files, copied at build after their pins checked" : "no proving files on this deployment: live proofs cannot be made in a browser here (" + result.reason + ")",
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return result;
}

const deviceOptions = {
  absWorkingDir: ROOT,
  entryPoints: [path.join(ROOT, "lib", "device", "entry.ts")],
  outfile: DEVICE_OUT,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  tsconfig: path.join(ROOT, "tsconfig.json"),
  loader: { ".json": "json" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  inject: [shim("process"), shim("buffer")],
  alias: {
    "server-only": shim("server-only"),
    "next/server": shim("next-server"),
    "next/headers": shim("next-headers"),
    react: shim("react"),
    // esbuild aliases are prefixes: name the subpaths first so they do not inherit the parent's shim
    "node:fs/promises": shim("node-fs-promises"),
    "fs/promises": shim("node-fs-promises"),
    "@/lib/session/ephemeral": path.join(ROOT, "lib", "session", "ephemeral.ts"),
    "node:fs": shim("node-fs"),
    fs: shim("node-fs"),
    "node:path": shim("node-path"),
    path: shim("node-path"),
    "node:crypto": shim("node-crypto"),
    crypto: shim("node-crypto"),
    "node:http": shim("node-net"),
    http: shim("node-net"),
    "node:https": shim("node-net"),
    https: shim("node-net"),
    "node:worker_threads": shim("node-net"),
    worker_threads: shim("node-net"),
    "node:child_process": shim("node-net"),
    child_process: shim("node-net"),
    // the device's session is its own identity, not the seeded self (lib/device/shims/session.ts)
    "@/lib/session": shim("session"),
  },
  banner: { js: "// Totem browser device — built by scripts/build-device.mjs. The keys this bundle handles never leave the browser." },
};

/** prover.js's esbuild options — exported (PUBLIC GO-LIVE) so scripts/unit-prover.mjs G1 reads the source offer's inputs from
 *  the build's OWN options, never a copy that could drift */
export function proverOptions(vkeyText, banner) {
  return {
    absWorkingDir: ROOT,
    entryPoints: [path.join(ROOT, "lib", "zk", "prover", "browser-worker.ts")],
    outfile: PROVER_OUT,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    sourcemap: false,
    minify: true,
    legalComments: "external",
    logLevel: "info",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("production"), __LAYERS_PINNED_VKEY_TEXT__: JSON.stringify(vkeyText) },
    banner: { js: banner },
  };
}

/**
 * PERSONA LAUNCH GO-LIVE — write public/device/source/ for the prover just built and prove it matches that build. Inputs:
 * the REAL build's metafile, the GPL text's path, the banner's two versions. Throws (the caller fails the build and
 * deletes prover.js) on: a metafile input the offer cannot serve, a file that cannot be read, a missing GPL text, an
 * offer whose file set is not the bundle's Totem inputs, a banner version the bundle does not carry, or a written file
 * that differs from its committed source. Exported for scripts/unit-prover.mjs (G2/G3), which drives it on a temp folder.
 */
export function stageSourceOffer({ root = ROOT, outDir, metafile, gplPath = path.join(ROOT, "node_modules", "snarkjs", "COPYING"), env = process.env, snarkjsVersion = SNARKJS_VERSION, ffjavascriptVersion = FFJS_VERSION, mutate = null }) {
  const layersFiles = layersInputsOf(metafile);
  const packages = bundledPackagesOf(metafile, (dir) => JSON.parse(readFileSync(path.join(root, ...dir.split("/"), "package.json"), "utf8")));
  let gplText;
  try {
    gplText = readFileSync(gplPath, "utf8");
  } catch {
    throw new Error(`${path.relative(root, gplPath) || gplPath} (the GPL-3.0 text) is missing — prover.js cannot ship without its source offer`);
  }
  const readSource = (rel) => readFileSync(path.join(root, ...rel.split("/")));
  const offer = buildOffer({ layersFiles, packages, gplText, commit: readCommit(root, env), esbuildVersion: ESBUILD_VERSION, readFile: readSource });
  // the test seam (unit-prover G2): a mutation applied to the built offer BEFORE the checks — production passes none
  if (typeof mutate === "function") mutate(offer);
  const problems = offerProblems(offer.manifest, layersFiles, { snarkjsVersion, ffjavascriptVersion });
  if (problems.length) throw new Error("the source offer does not match prover.js: " + problems.join("; "));
  writeOffer(outDir, offer);
  if (typeof mutate === "function" && typeof mutate.afterWrite === "function") mutate.afterWrite(outDir);
  const served = servedProblems({ outDir, manifest: offer.manifest, readSource });
  if (served.length) throw new Error("the written source offer is not the committed source: " + served.join("; "));
  return offer.manifest;
}

/** the pinned vkey file's text — refused (the build fails) unless its bytes are the pin */
function pinnedVkeyText(pins) {
  const buf = readFileSync(VKEY_FILE);
  if (buf.length !== pins.VKEY_PIN.bytes || sha256(buf) !== pins.VKEY_PIN.sha256) {
    throw new Error(`the installed verification-keys.json is not the build pin (${buf.length} bytes, sha256 ${sha256(buf)}) — refusing to bundle it`);
  }
  return buf.toString("utf8");
}

/** prover.js.LEGAL.txt (esbuild's name) → prover.js.LICENSE.txt with the GPL notice first and the GPL-3.0 text last */
function writeLicenseFile(banner) {
  const legal = PROVER_OUT + ".LEGAL.txt";
  const license = PROVER_OUT + ".LICENSE.txt";
  const comments = existsSync(legal) ? readFileSync(legal, "utf8") : "(no bundled license comments)\n";
  if (existsSync(legal)) unlinkSync(legal);
  let gpl = "";
  try {
    gpl = readFileSync(path.join(ROOT, "node_modules", "snarkjs", "COPYING"), "utf8");
  } catch {
    throw new Error("node_modules/snarkjs/COPYING (the GPL-3.0 text) is missing — prover.js cannot ship without it");
  }
  // PERSONA LAUNCH GO-LIVE: the banner (and so this notice) names the source offer at /device/source/
  const notice =
    banner.replace(/^\/\/ ?/gm, "") +
    "\n\nThe packages bundled into prover.js and their licenses: snarkjs (GPL-3.0), ffjavascript (GPL-3.0), wasmcurves (GPL-3.0),\n" +
    "wasmbuilder (GPL-3.0), fastfile (GPL-3.0), r1csfile (GPL-3.0), @iden3/binfileutils (GPL-3.0), circom_runtime (Apache-2.0),\n" +
    "js-sha3 (MIT), @semaphore-protocol/group (MIT), @zk-kit/lean-imt and @zk-kit/utils (MIT), poseidon-lite (MIT),\n" +
    "@noble/hashes (MIT), buffer / ieee754 / base64-js (MIT / BSD-3-Clause).\n\n" +
    "---------------------------------------------------------------- license comments carried by the bundled sources\n\n";
  writeFileSync(license, notice + comments + "\n---------------------------------------------------------------- GNU GENERAL PUBLIC LICENSE, version 3 (from snarkjs's COPYING)\n\n" + gpl);
}

async function main() {
  // the route table is generated from the filesystem so a new route cannot be forgotten
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "device-routes.mjs")], { stdio: "inherit" });
  const pins = await loadPins();
  const vkeyText = pinnedVkeyText(pins);
  // PERSONA LAUNCH GO-LIVE: the metafile-only PRE-PASS of the very same prover build names the Totem files the banner
  // lists (nothing written); the real build below must name the same set, or the build fails
  const pre = await build({ ...proverOptions(vkeyText, ""), write: false, metafile: true, logLevel: "silent" });
  const bannerFiles = layersInputsOf(pre.metafile);
  const banner = proverBanner({ layersFiles: bannerFiles });
  if (process.argv.includes("--watch")) {
    // watch mode is a developer loop: no LICENSE file and no source offer are written (a release build writes both)
    const dctx = await context(deviceOptions);
    const pctx = await context({ ...proverOptions(vkeyText, banner), legalComments: "none" });
    await dctx.watch();
    await pctx.watch();
    console.log("[build-device] watching device.js and prover.js");
    return;
  }
  const result = await build({ ...deviceOptions, metafile: true });
  const out = result.metafile.outputs[path.relative(ROOT, deviceOptions.outfile).split(path.sep).join("/")];
  console.log(`[build-device] ${path.relative(ROOT, DEVICE_OUT)}: ${(out.bytes / 1024).toFixed(0)} KiB, ${Object.keys(out.inputs).length} modules`);
  const proverResult = await build({ ...proverOptions(vkeyText, banner), metafile: true });
  // PERSONA LAUNCH GO-LIVE (A-GPL-SOURCE-OFFER): the LICENSE file and the source offer, or no prover at all (a missing
  // COPYING used to throw here with prover.js already on disk)
  try {
    writeLicenseFile(banner);
    const built = layersInputsOf(proverResult.metafile);
    if (JSON.stringify(built) !== JSON.stringify(bannerFiles)) throw new Error(`the banner names ${bannerFiles.join(", ")} but the bundle was built from ${built.join(", ")}`);
    const manifest = stageSourceOffer({ outDir: path.join(OUT_DIR, OFFER_DIR_NAME), metafile: proverResult.metafile });
    console.log(`[build-device] source offer: ${path.relative(ROOT, path.join(OUT_DIR, OFFER_DIR_NAME))}/ — ${manifest.files.length} Totem file(s) (${manifest.files.map((f) => f.path).join(", ")}), ${manifest.build.length} build file(s), ${manifest.packages.length} bundled package(s), commit ${manifest.commit.slice(0, 12)}`);
  } catch (e) {
    for (const f of [PROVER_OUT, PROVER_OUT + ".LICENSE.txt"]) rmSync(f, { force: true });
    rmSync(path.join(OUT_DIR, OFFER_DIR_NAME), { recursive: true, force: true });
    console.error("[build-device] SOURCE OFFER: " + (e && e.message ? e.message : e) + " — prover.js removed: it never ships without its GPL-3.0 source offer");
    process.exit(1);
  }
  const artifactDir = path.isAbsolute(process.env.ZK_ARTIFACT_DIR || "") ? process.env.ZK_ARTIFACT_DIR : path.join(ROOT, process.env.ZK_ARTIFACT_DIR || ".zk-artifacts");
  if (process.env.ZK_ARTIFACT_FETCH === "1") for (const n of await fetchMissingArtifacts(pins, artifactDir)) console.log("[build-device] fetch: " + n);
  const staged = stageArtifacts(pins, { artifactDir, outDir: ZK_OUT });
  const deviceBytes = statSync(DEVICE_OUT).size;
  const proverBytes = statSync(PROVER_OUT).size;
  console.log(`[build-device] sizes: device.js ${deviceBytes} B (budget ${DEVICE_BUDGET_BYTES}), prover.js ${proverBytes} B (budget ${PROVER_BUDGET_BYTES})`);
  console.log(`[build-device] proving files: ${staged.present ? "copied to " + path.relative(ROOT, ZK_OUT) + " (pins checked: " + staged.files.join(", ") + ")" : "NOT shipped — " + staged.reason}`);
  const zkBytes = staged.present ? staged.files.reduce((n, f) => n + statSync(path.join(ZK_OUT, f)).size, 0) : 0;
  const zv = zkArtifactViolations({ required: process.env.REQUIRE_ZK_ARTIFACTS === "1", present: staged.present, reason: staged.reason, bytes: zkBytes });
  const v = budgetViolations({ deviceBytes, deviceText: readFileSync(DEVICE_OUT, "utf8"), proverBytes });
  if (v.length || zv.length) {
    for (const line of [...v, ...zv]) console.error("[build-device] BUDGET: " + line);
    process.exit(1);
  }
}

// run as a script (npm run build, build:device, test:device); imported (scripts/unit-prover.mjs reads the budget function)
// it builds nothing. Compared as paths, case-folded on Windows (a shell may hand over "c:\…" for "C:\…").
const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  await main();
}
