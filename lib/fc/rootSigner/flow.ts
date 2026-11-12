import "server-only";
// POST AS YOU — "Allow Totem to post as you", THE FLOW (the browser device's side). The visitor's own Farcaster account
// (the root: the one Sign in with Farcaster linked, lib/fc/siwf/links.ts) gets a posting key that lives in THEIR vault,
// approved in THEIR Farcaster app, with no Neynar and no managed signer:
//
//   1. start   a fresh Ed25519 key is made in this tab and SEALED (lib/fc/rootSigner/store.ts, state "pending") BEFORE
//              anyone outside hears of it; then the validator (validator/keyrequest.js POST /fc/key-request) signs the
//              SignedKeyRequest with Totem's app account and creates the request with Farcaster's API. The device checks
//              the answer (its key, the app fid the validator publishes, a deadline in the future, a link the Farcaster
//              app opens) and seals the token and link: "Approve in the Farcaster app" (a link on a phone, a QR code
//              on a computer).
//   2. poll    one look at the request through the validator (GET /fc/key-request). "completed" counts only when the
//              approving account IS the root's (userFid === the linked fid: another account in the visitor's app is
//              refused and the key forgotten), and only once a Snapchain node lists the key as an ACTIVE signer of that
//              fid, read by THIS TAB directly (GET /v1/onChainSignersByFid: the public node allows browser CORS on reads),
//              not through Totem. Until then nothing is enabled; a node that never lists it is refused (not_on_hub).
//   3. post    a CastAdd (a reply with its parent), a CastRemove, a like or recast, built and signed HERE with the root's
//              key (lib/fc/hub/message.ts) and handed to the validator's thin relay (POST /fc/hub/submit), which forwards
//              the bytes unchanged (the node refuses browser CORS on submitMessage). A refusal is an error with the node's
//              own words, never a silent drop. NEVER a persona's key: the root's key is its own random key, and this
//              module reads no persona and no keystore key.
//   4. disconnect  forgets the key on this identity (the sealed record keeps only its public half) and says how to remove
//              it in the Farcaster app (Settings > Connected apps), which is the only thing that stops it working.
//
// PERSONA SEPARATION FOR WRITES (SECURITY-POSTURE.md §35 A-ROOTPOST-PERSONA-SEPARATION; the reads' rule is §36's). The
// relay and the node already tie this browser to the root, so two writes would hand them a persona: (1) anything as the
// root while a persona is the tab's acting identity (the root's like or reply leaving this browser at the moment the
// persona acts), and (2) a like, recast or reply as the root that TARGETS one of the visitor's own persona accounts (a
// public, permanent edge from the root to the persona). Every write (cast, reply, delete, like, recast and their undo)
// passes separatedWrite before anything is signed, and the acting check again as the last word before the bytes leave:
// acting_persona, own_persona. Fail closed: an unreadable jar counts as acting; an unreadable persona list refuses a
// write that has a target. The answers are lib/fc/hubRead/separation.ts's, the same ones the reads ask.
//
// WHERE IT RUNS: the browser device only. A server never holds the root's key: the route answers 404 device_only on any
// server, public or rig, before reading the body.
//
// FIXED SENTENCES: every refusal is one of SENTENCES (plus, for the node's and Farcaster's own refusals, their short words
// as the validator relays them). No key, token or message bytes are ever placed in an error, a view or a log line.
import { mainLink } from "@/lib/fc/siwf/links";
import { qrSvgPath } from "@/lib/qr";
import { castBytes, FC_CAST_MAX_BYTES } from "@/lib/fc/castLimits";
import type { CastId, HubBody } from "@/lib/fc/hub/message";
import { newRootKeyPair, rootSignerView, signAsRoot, updateRootSigner, type RootSignerView } from "./store";
import { hubReadUrlRule } from "./config";
import { REMOVE_IN_APP, ROOT_NOT_ON_OWN_PERSONA, ROOT_OFF_WHILE_PERSONA } from "./copy";
/** how long after Farcaster says "completed" the node may take to list the key before the device refuses it */
export const HUB_GRACE_MS = 5 * 60_000;
/** where an approval link may point (validator/keyrequest.js DEEPLINK_HOSTS: the same list, checked twice) */
export const APPROVAL_LINK_HOSTS: readonly string[] = ["farcaster.xyz", "www.farcaster.xyz", "client.farcaster.xyz", "warpcast.com", "www.warpcast.com", "client.warpcast.com"];
const TOKEN_RE = /^[A-Za-z0-9_-]{8,160}$/;
const HASH_RE = /^0x[0-9a-f]{40}$/;

export type RootPostCode =
  | "device_only"
  | "not_signed_in"
  | "disconnected_account"
  | "not_armed"
  | "validator"
  | "farcaster"
  | "bad_answer"
  | "expired"
  | "other_account"
  | "not_on_hub"
  | "hub_unreadable"
  | "no_key"
  | "hub_refused"
  | "hub_unreachable"
  | "too_long"
  | "empty"
  | "vault"
  | "confirm_required"
  | "bad_config"
  | "bad_request"
  | "acting_persona"
  | "own_persona";

export const SENTENCES: Record<RootPostCode, string> = {
  device_only: "Posting as your own account runs in your browser; this server never holds your key.",
  not_signed_in: "Sign in with Farcaster first: Totem posts only as the account you signed in with.",
  disconnected_account: "Your Farcaster account is disconnected here. Sign in with it again first.",
  not_armed: "Posting as your own account isn't switched on on this site yet.",
  validator: "Totem's server could not be reached just now. Nothing was sent; try again.",
  farcaster: "Farcaster could not make the request just now. Nothing was approved; try again.",
  bad_answer: "The answer to the key request was not one Totem can trust, so nothing was shown. Nothing was approved.",
  expired: "That approval request expired before it was approved. Start again.",
  other_account: "That approval came from a different Farcaster account, not yours. Nothing was turned on, and the key was forgotten.",
  not_on_hub: "Farcaster says the key was approved, but Farcaster's network does not list it for your account. Nothing was turned on.",
  hub_unreadable: "Farcaster's network could not be checked just now. Nothing is turned on yet; checking again shortly.",
  no_key: "Totem can't post as you yet: allow it first.",
  hub_refused: "Farcaster refused the post.",
  hub_unreachable: "Farcaster's network did not answer. Nothing was posted; try again.",
  too_long: `Farcaster takes at most ${FC_CAST_MAX_BYTES} bytes in a post.`,
  empty: "There is nothing to post.",
  vault: "Your posting key could not be read or saved just now. Nothing was sent; try again.",
  confirm_required: "Type DISCONNECT to confirm.",
  bad_config: "Posting as your own account is not available on this deployment (misconfigured).",
  bad_request: "That request was not understood.",
  acting_persona: ROOT_OFF_WHILE_PERSONA + " Nothing was sent.",
  own_persona: ROOT_NOT_ON_OWN_PERSONA + " Nothing was sent.",
};
const STATUS: Partial<Record<RootPostCode, number>> = {
  device_only: 404,
  not_signed_in: 409,
  disconnected_account: 409,
  not_armed: 503,
  validator: 502,
  farcaster: 502,
  bad_answer: 502,
  expired: 410,
  other_account: 409,
  not_on_hub: 409,
  hub_unreadable: 503,
  no_key: 409,
  hub_refused: 502,
  hub_unreachable: 502,
  too_long: 400,
  empty: 400,
  vault: 503,
  confirm_required: 400,
  bad_config: 503,
  bad_request: 400,
  acting_persona: 409,
  own_persona: 403,
};

export class RootPostError extends Error {
  code: RootPostCode;
  status: number;
  retryable: boolean;
  constructor(code: RootPostCode, detail?: string) {
    super(detail ? SENTENCES[code] + " " + detail : SENTENCES[code]);
    this.name = "RootPostError";
    this.code = code;
    this.status = STATUS[code] ?? 409;
    this.retryable = ["validator", "farcaster", "hub_unreadable", "hub_unreachable", "vault"].includes(code);
  }
}

// ------------------------------------------------------------------------------------------------- the runtime seam
interface RootPostRuntime {
  device: boolean;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  /** PERSONA SEPARATION: the visitor's own persona accounts (and the anon account when known); THROWS when unreadable */
  own: () => Promise<Set<number>>;
  /** PERSONA SEPARATION: a persona (not the root) is this tab's acting identity; THROWS when unreadable */
  acting: () => Promise<boolean>;
}
// the device's answers, the same module the reads ask (lib/fc/hubRead/separation.ts)
async function ownPersonaFids(): Promise<Set<number>> {
  return (await (await import("@/lib/fc/hubRead/separation")).ownPersonaAccounts()).fids;
}
async function personaIsActing(): Promise<boolean> {
  return (await import("@/lib/fc/hubRead/separation")).personaActing();
}
const gr = globalThis as unknown as { __layersRootPostRuntime?: RootPostRuntime | null };
function runtime(): RootPostRuntime {
  if (gr.__layersRootPostRuntime) return gr.__layersRootPostRuntime;
  const device = typeof window !== "undefined";
  const w = globalThis as unknown as { __layersOrigFetch?: typeof fetch };
  // the UNPATCHED fetch in the device: the patch answers /api/* in the tab; the validator and the node are other origins
  return { device, env: process.env, fetch: (device && w.__layersOrigFetch) || fetch, now: () => Date.now(), own: ownPersonaFids, acting: personaIsActing };
}
/** NODE HARNESS ONLY (scripts/unit-root-post.mjs): run as a device with an injected network, env and clock (the persona
 *  answers stay the separation module's unless a check injects them; the harnesses alias that module to a stub) */
export function __setRootPostRuntimeForTests(r: Partial<RootPostRuntime> | null): void {
  if (typeof window !== "undefined") throw new Error("__setRootPostRuntimeForTests is a node-harness seam");
  gr.__layersRootPostRuntime = r ? { device: true, env: process.env, fetch, now: () => Date.now(), own: ownPersonaFids, acting: personaIsActing, ...r } : null;
}

// ------------------------------------------------------------------------------------------------- config
function hubBase(rt: RootPostRuntime): string {
  if ((rt.env.FC_ROOT_POST ?? "").trim() === "bad_config") throw new RootPostError("bad_config");
  const r = hubReadUrlRule(rt.env.FC_ROOT_HUB_URL, false);
  if (!r.ok) throw new RootPostError("bad_config");
  return r.url;
}
function validatorBase(rt: RootPostRuntime): string {
  const v = (rt.env.VALIDATOR_URL ?? "").trim() || "http://localhost:4001";
  return v.replace(/\/+$/, "");
}
function gate(): RootPostRuntime {
  const rt = runtime();
  if (!rt.device) throw new RootPostError("device_only");
  return rt;
}

// ------------------------------------------------------------------------------------------------- the network
async function vfetch(rt: RootPostRuntime, path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await rt.fetch(validatorBase(rt) + path, { ...init, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  } catch {
    throw new RootPostError("validator");
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
/** the validator's word for a refusal (its fixed sentence; for Farcaster's or the node's refusal, their short words) */
const said = (j: Record<string, unknown> | null) => (j && typeof j.error === "string" ? j.error.slice(0, 300) : "");

interface AppAccount {
  ready: boolean;
  appFid: number | null;
  sponsored: boolean;
}
const ga = globalThis as unknown as { __layersRootPostApp?: { at: number; v: AppAccount } | null };
/** GET /fc/app-account, cached a minute; THROWS when it cannot be read (never "not armed" for "unknown") */
async function appAccount(rt: RootPostRuntime, fresh = false): Promise<AppAccount> {
  const c = ga.__layersRootPostApp;
  if (!fresh && c && rt.now() - c.at < 60_000) return c.v;
  const r = await vfetch(rt, "/fc/app-account");
  if (r.status !== 200 || !r.json || typeof r.json.ready !== "boolean") throw new RootPostError("validator");
  const v: AppAccount = { ready: r.json.ready === true, appFid: Number.isSafeInteger(r.json.appFid) ? (r.json.appFid as number) : null, sponsored: r.json.sponsored === true };
  ga.__layersRootPostApp = { at: rt.now(), v };
  return v;
}

/** is `key` an ACTIVE Ed25519 signer of `fid` on the node THIS TAB reads? true / false; THROWS when it cannot be read */
export async function keyActiveOnHub(rt: RootPostRuntime, fid: number, key: string): Promise<boolean> {
  const want = key.toLowerCase();
  let res: Response;
  try {
    res = await rt.fetch(hubBase(rt) + "/v1/onChainSignersByFid?fid=" + encodeURIComponent(String(fid)) + "&signer=" + want, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  } catch (e) {
    if (e instanceof RootPostError) throw e;
    throw new RootPostError("hub_unreadable");
  }
  const text = await res.text().catch(() => "");
  if (res.status === 404 || (res.status === 400 && /not ?found|no.*signer/i.test(text))) return false;
  let j: { events?: unknown } | null = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  if (res.status !== 200 || !j || !Array.isArray(j.events)) throw new RootPostError("hub_unreadable");
  let active = false;
  for (const e of j.events as Array<{ fid?: unknown; signerEventBody?: { key?: unknown; keyType?: unknown; eventType?: unknown } }>) {
    const b = e && e.signerEventBody;
    if (!b || Number(e.fid) !== fid || String(b.key ?? "").toLowerCase() !== want || Number(b.keyType) !== 1) continue;
    if (b.eventType === "SIGNER_EVENT_TYPE_ADD") active = true;
    else if (b.eventType === "SIGNER_EVENT_TYPE_REMOVE") active = false;
  }
  return active;
}

export function approvalLinkOk(url: string, token: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password || !url.includes(token)) return false;
  if (u.protocol === "farcaster:") return true;
  return u.protocol === "https:" && APPROVAL_LINK_HOSTS.includes(u.hostname.toLowerCase());
}

// ------------------------------------------------------------------------------------------------- the account
interface Account {
  fid: number;
  fname: string | null;
}
async function account(): Promise<Account> {
  let link;
  try {
    link = await mainLink();
  } catch {
    throw new RootPostError("vault");
  }
  if (!link) throw new RootPostError("not_signed_in");
  if (link.disconnectedAt !== null) throw new RootPostError("disconnected_account");
  return { fid: link.fid, fname: link.fname };
}
async function view(): Promise<Awaited<ReturnType<typeof rootSignerView>>> {
  try {
    return await rootSignerView();
  } catch {
    throw new RootPostError("vault");
  }
}
async function seal(fn: Parameters<typeof updateRootSigner>[0]): Promise<void> {
  try {
    await updateRootSigner(fn);
  } catch (e) {
    if (e instanceof RootPostError) throw e;
    throw new RootPostError("vault");
  }
}

// ------------------------------------------------------------------------------------------------- memory (this tab)
interface Memory {
  queue: Promise<unknown>;
  /** when Farcaster first said "completed" for the pending key (the node's grace window starts then) */
  completedAt: number | null;
  /** the casts this tab posted as the root (for the composer's Delete): hash + text, newest first, at most 10 */
  posted: Array<{ hash: string; text: string; at: number }>;
  /** the last poll's word: "approved" (waiting for the chain) or "waiting_for_hub" */
  stage: "approved" | "waiting_for_hub" | null;
}
const gm = globalThis as unknown as { __layersRootPost?: Memory };
const memory = (): Memory => (gm.__layersRootPost ??= { queue: Promise.resolve(), completedAt: null, posted: [], stage: null });
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const m = memory();
  const next = m.queue.catch(() => undefined).then(fn);
  m.queue = next.catch(() => undefined);
  return next;
}
// FOLLOWING FROM THE HUB: a cast or delete this tab just made as the root, told to whoever listens (the Following
// timeline, lib/fc/hubRead/read.ts), so the root sees their own post there at once and a deleted one goes at once; the
// node's next read confirms either. A listener's failure never touches the post.
// A like or recast (or its undo) is told the same way, so the cards' pressed state (lib/fc/hubRead/read.ts hubReacted)
// follows it at once.
export type RootCastEvent =
  | { kind: "cast"; fid: number; hash: string; text: string; at: number; parent: CastId | null }
  | { kind: "delete"; fid: number; hash: string }
  | { kind: "react"; fid: number; reaction: "like" | "recast"; target: CastId; on: boolean; at: number };
const gl = globalThis as unknown as { __layersRootCastListeners?: Set<(ev: RootCastEvent) => void> };
export function onRootCast(fn: (ev: RootCastEvent) => void): () => void {
  const set = (gl.__layersRootCastListeners ??= new Set());
  set.add(fn);
  return () => set.delete(fn);
}
function emitRootCast(ev: RootCastEvent): void {
  for (const fn of gl.__layersRootCastListeners ?? []) {
    try {
      fn(ev);
    } catch {
      /* a listener's problem, never the post's */
    }
  }
}

/** reloadIdentity / resetSeed: the previous root's memory goes */
export function resetRootPost(): void {
  gm.__layersRootPost = { queue: Promise.resolve(), completedAt: null, posted: [], stage: null };
  ga.__layersRootPostApp = null;
}

// ------------------------------------------------------------------------------------------------- the view
export interface RootPostStatus {
  /** can this tab offer "Allow Totem to post as you" at all (signed in, connected, the site armed) */
  available: boolean;
  /** why not, in one sentence (null when available) */
  reason: string | null;
  code: RootPostCode | null;
  account: { fid: number; fname: string | null } | null;
  state: "none" | "pending" | "active";
  stage: "waiting" | "approved" | "waiting_for_hub" | null;
  /** the PUBLIC key Totem would post with (never the private half) */
  key: string | null;
  appFid: number | null;
  deadline: number | null;
  activatedAt: number | null;
  /** pending only: the link to open on a phone, and its QR code for a computer */
  approval: { url: string; qr: { viewBox: number; path: string } } | null;
  /** Totem pays the network fee (the app account sponsors) — else the visitor's Farcaster app may ask them to */
  sponsored: boolean;
  /** the key a Disconnect forgot (its public half) and when: still remove it in the Farcaster app */
  forgotten: { key: string; at: number } | null;
  posted: Array<{ hash: string; text: string; at: number; url: string | null }>;
  hubHost: string;
}
function castUrl(fname: string | null, hash: string): string | null {
  return fname ? `https://farcaster.xyz/${encodeURIComponent(fname)}/${hash.slice(0, 10)}` : null;
}
async function buildStatus(rt: RootPostRuntime): Promise<RootPostStatus> {
  const hubHost = (() => {
    try {
      return new URL(hubBase(rt)).host;
    } catch {
      return "";
    }
  })();
  const base: RootPostStatus = { available: false, reason: null, code: null, account: null, state: "none", stage: null, key: null, appFid: null, deadline: null, activatedAt: null, approval: null, sponsored: false, forgotten: null, posted: [], hubHost };
  let acct: Account;
  try {
    acct = await account();
  } catch (e) {
    const code = e instanceof RootPostError ? e.code : "vault";
    return { ...base, code, reason: SENTENCES[code] };
  }
  base.account = acct;
  const v = await view();
  base.forgotten = v.forgotten && v.forgotten.fid === acct.fid ? { key: v.forgotten.key, at: v.forgotten.at } : null;
  const s: RootSignerView | null = v.signer && v.signer.fid === acct.fid ? v.signer : null;
  const m = memory();
  base.posted = m.posted.map((p) => ({ ...p, url: castUrl(acct.fname, p.hash) }));
  if (s && s.state === "active") {
    // an active key posts whether or not the site is armed for NEW requests (the relay still needs the validator)
    return { ...base, available: true, state: "active", key: s.key, appFid: s.appFid, activatedAt: s.activatedAt };
  }
  let app: AppAccount;
  try {
    app = await appAccount(rt);
  } catch {
    return { ...base, code: "validator", reason: SENTENCES.validator };
  }
  if (!app.ready || !app.appFid) return { ...base, code: "not_armed", reason: SENTENCES.not_armed };
  base.available = true;
  base.sponsored = app.sponsored;
  if (s && s.state === "pending" && s.token && s.deeplinkUrl) {
    const expired = s.deadline * 1000 <= rt.now();
    return {
      ...base,
      state: expired ? "none" : "pending",
      stage: expired ? null : m.stage ?? "waiting",
      key: s.key,
      appFid: s.appFid,
      deadline: s.deadline,
      approval: expired ? null : { url: s.deeplinkUrl, qr: qrSvgPath(s.deeplinkUrl) },
      ...(expired ? { code: "expired" as const, reason: SENTENCES.expired } : {}),
    };
  }
  return base;
}

export async function rootPostStatus(): Promise<RootPostStatus> {
  const rt = gate();
  return serialized(() => buildStatus(rt));
}

/** "Allow Totem to post as you": make the key, seal it, ask for the approval. Resumes a pending one that has not expired. */
export async function startRootPost(): Promise<RootPostStatus> {
  const rt = gate();
  return serialized(async () => {
    const acct = await account();
    const v = await view();
    const cur = v.signer && v.signer.fid === acct.fid ? v.signer : null;
    if (cur && cur.state === "active") return buildStatus(rt);
    if (cur && cur.state === "pending" && cur.token && cur.deeplinkUrl && cur.deadline * 1000 > rt.now() + 60_000) return buildStatus(rt);
    const app = await appAccount(rt, true);
    if (!app.ready || !app.appFid) throw new RootPostError("not_armed");
    // 1. the key, sealed BEFORE anyone outside this tab hears of it (a pending key with no request yet is reused)
    let pair: { priv: string; key: string } | null = null;
    let key = cur && cur.state === "pending" && !cur.token ? cur.key : null;
    if (!key) {
      pair = newRootKeyPair();
      key = pair.key;
      const p = pair;
      await seal((doc) => ({ ...doc, signer: { fid: acct.fid, priv: p.priv, key: p.key, appFid: app.appFid as number, state: "pending", token: null, deeplinkUrl: null, deadline: 0, createdAt: rt.now(), activatedAt: null } }));
    }
    memory().completedAt = null;
    memory().stage = null;
    // 2. the validator signs it with the app account and creates the request with Farcaster
    const r = await vfetch(rt, "/fc/key-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    if (r.status === 503) throw new RootPostError("not_armed");
    if (r.status === 429) throw new RootPostError("farcaster", said(r.json));
    if (r.status !== 201 || !r.json) throw new RootPostError("farcaster", said(r.json));
    const j = r.json;
    const token = typeof j.token === "string" ? j.token : "";
    const url = typeof j.deeplinkUrl === "string" ? j.deeplinkUrl : "";
    const deadline = Number.isSafeInteger(j.deadline) ? (j.deadline as number) : 0;
    const nowS = Math.floor(rt.now() / 1000);
    // 3. the answer is checked here too: our key, the app fid the validator publishes, a live deadline, a link the
    //    Farcaster app opens (never shown otherwise)
    if (j.key !== key || j.requestFid !== app.appFid || !TOKEN_RE.test(token) || url.length > 300 || !approvalLinkOk(url, token) || deadline <= nowS + 60 || deadline > nowS + 86_400 + 120) throw new RootPostError("bad_answer");
    const k = key;
    await seal((doc) => (doc.signer && doc.signer.key === k ? { ...doc, signer: { ...doc.signer, token, deeplinkUrl: url, deadline, appFid: app.appFid as number } } : doc));
    return buildStatus(rt);
  });
}

/** one look at the pending request; enables the key only when the root's own account approved it AND the node lists it */
export async function pollRootPost(): Promise<RootPostStatus> {
  const rt = gate();
  return serialized(async () => {
    const acct = await account();
    const v = await view();
    const s = v.signer && v.signer.fid === acct.fid ? v.signer : null;
    if (!s || s.state !== "pending" || !s.token) return buildStatus(rt);
    const m = memory();
    const r = await vfetch(rt, "/fc/key-request?token=" + encodeURIComponent(s.token));
    if (r.status === 404) {
      await seal((doc) => (doc.signer && doc.signer.key === s.key ? { ...doc, signer: null } : doc));
      throw new RootPostError("expired");
    }
    if (r.status !== 200 || !r.json) throw new RootPostError("validator", said(r.json));
    const state = r.json.state;
    const userFid = Number.isSafeInteger(r.json.userFid) ? (r.json.userFid as number) : null;
    if (r.json.key !== s.key) throw new RootPostError("bad_answer");
    if (state === "pending") {
      if (s.deadline * 1000 <= rt.now()) {
        await seal((doc) => (doc.signer && doc.signer.key === s.key ? { ...doc, signer: null } : doc));
        throw new RootPostError("expired");
      }
      m.stage = null;
      return buildStatus(rt);
    }
    // approved or completed: it must be THIS account's approval
    if (userFid !== null && userFid !== acct.fid) {
      await seal((doc) => (doc.signer && doc.signer.key === s.key ? { ...doc, signer: null, forgotten: { key: s.key, fid: userFid, at: rt.now() } } : doc));
      m.stage = null;
      m.completedAt = null;
      throw new RootPostError("other_account");
    }
    if (state === "approved") {
      m.stage = "approved";
      return buildStatus(rt);
    }
    if (state !== "completed" || userFid === null) throw new RootPostError("bad_answer");
    // completed by this account: enabled only once the node THIS TAB reads lists the key as active for the fid
    m.completedAt ??= rt.now();
    let active: boolean;
    try {
      active = await keyActiveOnHub(rt, acct.fid, s.key);
    } catch (e) {
      m.stage = "waiting_for_hub";
      throw e;
    }
    if (!active) {
      if (rt.now() - m.completedAt > HUB_GRACE_MS) {
        await seal((doc) => (doc.signer && doc.signer.key === s.key ? { ...doc, signer: null, forgotten: { key: s.key, fid: acct.fid, at: rt.now() } } : doc));
        m.stage = null;
        m.completedAt = null;
        throw new RootPostError("not_on_hub");
      }
      m.stage = "waiting_for_hub";
      return buildStatus(rt);
    }
    await seal((doc) => (doc.signer && doc.signer.key === s.key ? { ...doc, signer: { ...doc.signer, state: "active", token: null, deeplinkUrl: null, activatedAt: rt.now() } } : doc));
    m.stage = null;
    m.completedAt = null;
    return buildStatus(rt);
  });
}

/** forget a pending request (nothing approved yet): the key goes with it */
export async function cancelRootPost(): Promise<RootPostStatus> {
  const rt = gate();
  return serialized(async () => {
    const acct = await account();
    await seal((doc) => (doc.signer && doc.signer.fid === acct.fid && doc.signer.state === "pending" ? { ...doc, signer: null } : doc));
    memory().stage = null;
    memory().completedAt = null;
    return buildStatus(rt);
  });
}

/** forget the ACTIVE key on this identity (the public half is kept to say what to remove in the Farcaster app) */
export async function disconnectRootPost(confirm: string): Promise<RootPostStatus & { removeHow: string }> {
  const rt = gate();
  if (confirm !== "DISCONNECT") throw new RootPostError("confirm_required");
  return serialized(async () => {
    const acct = await account();
    await seal((doc) => (doc.signer && doc.signer.fid === acct.fid ? { ...doc, signer: null, forgotten: { key: doc.signer.key, fid: acct.fid, at: rt.now() } } : doc));
    memory().posted = [];
    return { ...(await buildStatus(rt)), removeHow: REMOVE_HOW };
  });
}
export const REMOVE_HOW = "Totem has forgotten the key on this identity. It can still post until you remove it. " + REMOVE_IN_APP;

/** PERSONA SEPARATION FOR WRITES (the header): no root write while a persona acts; no root write that targets one of the
 *  visitor's own persona accounts (a like's or recast's target, a reply's parent). Fail closed both ways. */
async function notActing(rt: RootPostRuntime): Promise<void> {
  let acting: boolean;
  try {
    acting = await rt.acting();
  } catch {
    acting = true; // unknown: nothing goes out as the root
  }
  if (acting) throw new RootPostError("acting_persona");
}
function targetOf(body: HubBody): CastId | null {
  if (body.type === "CastAdd") return body.parent ?? null;
  if (body.type === "CastRemove") return null; // the root's own cast, by hash: no other account is named
  return body.target;
}
async function separatedWrite(rt: RootPostRuntime, body: HubBody): Promise<void> {
  await notActing(rt);
  const target = targetOf(body);
  if (!target) return;
  let own: Set<number>;
  try {
    own = await rt.own();
  } catch {
    throw new RootPostError("vault"); // the list cannot be read: a write naming another account does not go
  }
  if (own.has(target.fid)) throw new RootPostError("own_persona");
}

async function submit(rt: RootPostRuntime, body: HubBody, acct: Account): Promise<{ hash: string }> {
  await separatedWrite(rt, body);
  let msg;
  try {
    msg = await signAsRoot(acct.fid, body, rt.now());
  } catch (e) {
    const t = String((e as Error)?.message ?? "");
    if (/no active posting key|another Farcaster account/.test(t)) throw new RootPostError("no_key");
    if (/longer than|missing|malformed|not a like/.test(t)) throw new RootPostError("bad_request", t);
    throw new RootPostError("vault");
  }
  // the last word before the bytes leave: a switch to a persona while this was being signed stops it
  await notActing(rt);
  let res: Response;
  try {
    res = await rt.fetch(validatorBase(rt) + "/fc/hub/submit", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: msg.bytes as unknown as BodyInit, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  } catch {
    throw new RootPostError("hub_unreachable");
  }
  let j: Record<string, unknown> | null = null;
  try {
    j = (await res.json()) as Record<string, unknown>;
  } catch {
    j = null;
  }
  if (res.status === 503) throw new RootPostError("not_armed");
  if (res.status !== 200 || !j || j.ok !== true) {
    // the node's own words (or the relay's), never swallowed
    const words = said(j).replace(/^Farcaster's node refused it: /, "");
    throw new RootPostError(res.status === 502 && j && j.code === "hub_unreachable" ? "hub_unreachable" : "hub_refused", words);
  }
  if (j.hash !== msg.hash) throw new RootPostError("hub_refused", "The relay answered for a different message.");
  return { hash: msg.hash };
}

/** post a cast (a reply when `parent` is given) as the root */
export async function castAsRoot(text: string, parent: CastId | null = null): Promise<{ hash: string; url: string | null; fname: string | null }> {
  const rt = gate();
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) throw new RootPostError("empty");
  if (castBytes(t) > FC_CAST_MAX_BYTES) throw new RootPostError("too_long");
  if (parent && (!Number.isSafeInteger(parent.fid) || !HASH_RE.test(parent.hash))) throw new RootPostError("bad_request");
  return serialized(async () => {
    const acct = await account();
    const { hash } = await submit(rt, { type: "CastAdd", text: t, parent }, acct);
    const m = memory();
    m.posted = [{ hash, text: t.slice(0, 120), at: rt.now() }, ...m.posted.filter((p) => p.hash !== hash)].slice(0, 10);
    emitRootCast({ kind: "cast", fid: acct.fid, hash, text: t, at: rt.now(), parent });
    return { hash, url: castUrl(acct.fname, hash), fname: acct.fname };
  });
}

/** delete one of the root's casts */
export async function deleteAsRoot(hash: string): Promise<{ hash: string }> {
  const rt = gate();
  if (!HASH_RE.test(String(hash))) throw new RootPostError("bad_request");
  return serialized(async () => {
    const acct = await account();
    await submit(rt, { type: "CastRemove", targetHash: hash }, acct);
    memory().posted = memory().posted.filter((p) => p.hash !== hash);
    emitRootCast({ kind: "delete", fid: acct.fid, hash });
    return { hash };
  });
}

/** like or recast a cast as the root (or undo it with remove) */
export async function reactAsRoot(reaction: "like" | "recast", target: CastId, remove = false): Promise<{ hash: string }> {
  const rt = gate();
  if ((reaction !== "like" && reaction !== "recast") || !target || !Number.isSafeInteger(target.fid) || target.fid <= 0 || !HASH_RE.test(String(target.hash))) throw new RootPostError("bad_request");
  return serialized(async () => {
    const acct = await account();
    const r = await submit(rt, { type: remove ? "ReactionRemove" : "ReactionAdd", reaction, target }, acct);
    emitRootCast({ kind: "react", fid: acct.fid, reaction, target: { fid: target.fid, hash: target.hash }, on: !remove, at: rt.now() });
    return r;
  });
}
