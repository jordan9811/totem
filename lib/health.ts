import "server-only";
// ATTESTATION PASS Gate 0 — THE LIVENESS CONTRACT (app side).
//
// ZK Pass 2's closing sweeps found the runner's probe accepting ANY HTTP
// response as "alive": another project's server answered 404 on the port
// and fifteen suites ran against it — and were recorded green. The
// health endpoint now returns a Totem-SPECIFIC payload that is SIGNED,
// and the runner (scripts/lib/health-probe.mjs) accepts only that: the
// app name, a git commit, an uptime, and an Ed25519 signature over the
// canonical form of exactly those fields. A stub that returns 200 with
// any other body — or the right shape with a wrong signature — is DOWN.
//
// The signing key is a per-PROCESS random key (generated at first use,
// never written anywhere): the signature is a scheme check that binds
// the fields to one live process, not an identity claim — the app has
// no identity to assert on an unauthenticated local endpoint, and
// putting the device key here would publish the device's public key to
// anyone who can reach the port for no gain. The VALIDATOR's health is
// signed by its persistent key and cross-checked against
// /zk/validator-key by the probe; that side IS an identity check.
//
// CANONICAL FORM — a deliberate duplicate of validator/server.js
// (healthCanonical) and scripts/lib/health-probe.mjs; drift between them
// fails the probe, which is the point.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "@/lib/platform/crypto";
import path from "node:path";
import { publicKeyOf, signCanonical } from "@/lib/crypto/ed25519";
import { validatorUrl } from "@/lib/ports";
import { readOwnerSecret } from "@/lib/platform/owner-access";

export const HEALTH_APP_NAME = "layers";
/** PROD-LIVE: what an owner service reports as its peer (see healthPayload) */
export const HEALTH_PEER_PRIVATE = "private";
export const HEALTH_DOMAIN = "layers-health/1";

export interface HealthFields {
  app: string;
  commit: string;
  buildId: string | null;
  startedAt: number;
  /** whole seconds since the process started */
  uptime: number;
  port: number;
  pid: number;
  /** the validator URL THIS process talks to ("-" on the validator). The
   * runner refuses to launch when it is not the validator under test: a
   * stale VALIDATOR_URL in .env.local once pointed a pinned app at a dead
   * port, and every suite failed "validator unavailable" instead of the
   * runner saying so. */
  peer: string;
}

export interface HealthPayload extends HealthFields {
  ok: true;
  pubkey: string;
  sig: string;
}

export function healthCanonical(f: HealthFields): string {
  return [HEALTH_DOMAIN, f.app, f.commit, f.buildId ?? "-", String(f.startedAt), String(f.uptime), String(f.port), String(f.pid), f.peer ?? "-"].join("|");
}

/** the commit HEAD names — read from .git directly (no child process on a
 * request path); "unknown" outside a checkout */
export function gitHead(root = process.cwd()): string {
  // BROWSER KEYSTORE PASS Gate 6: a deployed build carries no .git, so the deploy names its own commit — otherwise
  // a deployed service reports "unknown" and nothing can say which code is live
  if (process.env.LAYERS_COMMIT) return process.env.LAYERS_COMMIT;
  try {
    const head = readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5).trim();
    const loose = path.join(root, ".git", ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
    const packed = path.join(root, ".git", "packed-refs");
    if (existsSync(packed)) {
      const line = readFileSync(packed, "utf8")
        .split(/\r?\n/)
        .find((l) => l.endsWith(" " + ref));
      if (line) return line.split(" ")[0];
    }
  } catch {
    /* not a checkout */
  }
  return "unknown";
}

function readBuildId(): string | null {
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

interface ProcessKey {
  priv: Uint8Array;
  pub: string;
  startedAt: number;
  commit: string;
  buildId: string | null;
}
const g = globalThis as unknown as { __layersHealthKey?: ProcessKey };
function processKey(): ProcessKey {
  if (!g.__layersHealthKey) {
    const priv = new Uint8Array(randomBytes(32));
    g.__layersHealthKey = { priv, pub: publicKeyOf(priv), startedAt: Date.now(), commit: gitHead(), buildId: readBuildId() };
  }
  return g.__layersHealthKey;
}

/** the signed payload for THIS process, bound to the port it answered on */
export function healthPayload(port: number): HealthPayload {
  const k = processKey();
  const fields: HealthFields = {
    app: HEALTH_APP_NAME,
    commit: k.commit,
    buildId: k.buildId,
    startedAt: k.startedAt,
    uptime: Math.floor((Date.now() - k.startedAt) / 1000),
    port,
    pid: process.pid,
    // PROD-LIVE (review: the health payload published the private validator address). /api/health is the one route
    // the owner access gate exempts (the platform's health check carries no cookie), so on the owner service `peer`
    // told anyone who found the URL its validator's *.railway.internal address — the one thing that service keeps
    // off the public network (A-PRODLIVE-PRIVATE-NETWORK-IS-THE-VALIDATOR-GATE). With OWNER_ACCESS_SECRET set it
    // says "private" instead, and the signature covers that word like any other value. The runner's --peer= check
    // (scripts/lib/health-probe.mjs) is only ever run against the laptop rig and the public preview, where the
    // secret is unset and the real URL is still reported, so it keeps catching a stale VALIDATOR_URL exactly as
    // before; nothing probes the owner app with --peer= (its validator is unreachable from the prober anyway).
    peer: readOwnerSecret() ? HEALTH_PEER_PRIVATE : validatorUrl(),
  };
  return { ok: true, ...fields, pubkey: k.pub, sig: signCanonical(healthCanonical(fields), k.priv) };
}
