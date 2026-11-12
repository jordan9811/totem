import "server-only";
// SIGN IN WITH X (2026-11-06) — THE FLOW, in the visitor's browser device. docs/mechanism/sign-in-with-x.md;
// SECURITY-POSTURE.md §38. The model is Sign in with Farcaster (lib/fc/siwf/flow.ts), step for step where X allows it.
//
// WHAT IT IS: identity, not custody. A finished sign-in means "X says the person in this tab controls X account N right
// now", and binds N to this tab's ROOT: one more link in the SAME sealed accountLinks record (lib/fc/siwf/links.ts), and the
// root's read-only public self persona (minted here when the root has none yet, or the one Sign in with Farcaster minted,
// which the X account then joins). It saves nothing: a passkey saves the identity. NO PERSONA is ever involved: the X
// account is the root's own, and nothing here reads, names or writes a persona other than the root's public self.
//
// THE STEPS:
//   start    the device draws a PKCE verifier and a state (lib/x/signin/pkce.ts), keeps them in THIS TAB's sessionStorage
//            (they must survive the trip to x.com, which replaces the document), and answers the authorize URL. The card
//            first keeps the identity in this browser (components/x/XSignIn.tsx): leaving for x.com ends this document.
//   (X)      the visitor approves on x.com; X sends the tab back to <origin>/welcome/x?state=…&code=….
//   finish   on the callback page the device READS AND REMOVES the stored request (one shot: a reload, Back or a replayed
//            link finds nothing), checks the state, then hands {code, verifier, redirect_uri, client_id} to the
//            validator's THIN STATELESS RELAY (POST /x/signin/exchange, validator/xsignin.js), because X's token endpoint and
//            API answer no browser CORS for a third-party origin. The relay redeems the code, reads GET /2/users/me,
//            REVOKES the token, and answers the profile alone: the access token never reaches this tab, and nothing
//            keeps it. Then the device records the link and the public self.
//
// WHERE IT RUNS: the browser device only. A public server answers the route 404 device_only before reading the body; the
// rig and the owner service are not offered it (no hint reaches their pages).
//
// THE DEVICE ENV IS PAGE-SETTABLE (as A-SIWF-PAGE-IS-THE-DEVICE): the authorize URL override is honoured only as X's own
// page or a loopback URL (lib/x/signin/config.ts authorizeUrlRule), and the relay is the validator this tab already uses.
//
// FIXED SENTENCES: every refusal is one of SENTENCES below. No code, verifier, state, token or upstream text is ever placed
// in an error, a view or a log line (scripts/unit-x-signin.mjs X7).
import { derivedFromMain } from "@/lib/identity/handleStem";
import { authorizeUrlRule, X_CLIENT_ID_RE } from "./config";
import {
  PENDING_KEY,
  X_PERSONA_NONCE,
  callbackParams,
  freshRequest,
  authorizeUrlFor,
  handleFromX,
  judgeCallback,
  pendingText,
  readPending,
  readXUser,
  redirectUriFor,
  type XUser,
} from "./pkce";
import type { XAccountLink } from "@/lib/fc/siwf/links";

// ------------------------------------------------------------------------------------------------- errors & sentences

export type XsiCode =
  | "xsi_dormant"
  | "xsi_off"
  | "bad_config"
  | "device_only"
  | "xsi_no_request"
  | "xsi_expired"
  | "xsi_state"
  | "xsi_denied"
  | "xsi_answer"
  | "xsi_code"
  | "xsi_relay"
  | "xsi_relay_off"
  | "xsi_profile"
  | "xsi_one_x"
  | "xsi_signed_in"
  | "xsi_handle_stem"
  | "xsi_linked_device"
  | "xsi_seal"
  | "xsi_links_unreadable"
  | "xsi_storage"
  | "not_signed_in"
  | "confirm_required"
  | "bad_request";

export const SENTENCES: Record<XsiCode, string> = {
  xsi_dormant: "Sign in with X is coming soon to this site.",
  xsi_off: "Sign in with X is switched off on this site.",
  bad_config: "Sign in with X is not available on this deployment (misconfigured).",
  device_only: "Sign in with X runs in your browser; this server does not handle sign-ins",
  xsi_no_request: "That sign-in is not in progress in this tab (it finished, was started in another tab, or this page was reloaded). Start again.",
  xsi_expired: "The sign-in request expired. Start again.",
  xsi_state: "That answer from X did not match the sign-in this tab started, so it was refused. Nothing was saved.",
  xsi_denied: "You didn't allow it on X, so nothing was saved.",
  xsi_answer: "X's answer was not one Totem can use. Nothing was saved. Start again.",
  xsi_code: "X refused the sign-in code (it may have expired: X allows 30 seconds). Nothing was saved. Start again.",
  xsi_relay: "Totem couldn't reach X just now. Nothing was saved. Start again.",
  xsi_relay_off: "Sign in with X isn't switched on on this site's server yet.",
  xsi_profile: "X didn't send an account Totem can use. Nothing was saved.",
  xsi_one_x: "Another X account is already linked to this identity. Totem keeps one per identity, even after a disconnect.",
  xsi_signed_in: "You are already signed in with X here. Disconnect it first to sign in again.",
  xsi_handle_stem: "One of your personas shares a name with this X account. Matching names would publicly link them. Rename that persona first, then sign in.",
  xsi_linked_device: "Sign in on a device that holds your identity. A linked device cannot add accounts.",
  xsi_seal: "Signed in with X, but it couldn't be saved just now. Nothing was linked. Start again.",
  xsi_links_unreadable: "Couldn't read your linked accounts just now. Nothing was changed. Try again.",
  xsi_storage: "This browser won't keep the sign-in request while X opens (storage is off for this site), so it did not start.",
  not_signed_in: "No X account is linked to this identity.",
  confirm_required: "Type DISCONNECT to confirm.",
  bad_request: "That request was not understood.",
};

const STATUS: Partial<Record<XsiCode, number>> = {
  xsi_dormant: 403,
  xsi_off: 403,
  bad_config: 503,
  device_only: 404,
  xsi_relay: 502,
  xsi_code: 502,
  xsi_relay_off: 503,
  xsi_seal: 503,
  xsi_links_unreadable: 503,
  xsi_storage: 503,
  not_signed_in: 404,
  confirm_required: 400,
  bad_request: 400,
};

export class XsiError extends Error {
  readonly code: XsiCode;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: XsiCode, sentence?: string) {
    super(sentence ?? SENTENCES[code]);
    this.code = code;
    this.status = STATUS[code] ?? 409;
    this.retryable = code === "xsi_links_unreadable";
  }
}

// ------------------------------------------------------------------------------------------------- the runtime seam

/** the tab's storage for the request in flight (sessionStorage in the browser) */
export interface XsiStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

interface XsiRuntime {
  device: boolean;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  storage: () => XsiStorage;
  log: (line: string) => void;
}

const gr = globalThis as unknown as { __layersXsiRuntime?: XsiRuntime | null };

function sessionStore(): XsiStorage {
  const s = (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage;
  if (!s) throw new XsiError("xsi_storage");
  return {
    get: (k) => s.getItem(k),
    set: (k, v) => s.setItem(k, v),
    remove: (k) => s.removeItem(k),
  };
}

function runtime(): XsiRuntime {
  if (gr.__layersXsiRuntime) return gr.__layersXsiRuntime;
  const device = typeof window !== "undefined";
  const w = globalThis as unknown as { __layersOrigFetch?: typeof fetch };
  return {
    device,
    env: process.env,
    // the UNPATCHED fetch: the device's patch answers /api/* in the tab; the validator is another origin
    fetch: (device && w.__layersOrigFetch) || fetch,
    now: () => Date.now(),
    storage: sessionStore,
    log: (line) => console.warn(line),
  };
}

/** NODE HARNESS ONLY (scripts/unit-x-signin.mjs): run as a device with an injected network, clock and storage */
export function __setXsiRuntimeForTests(r: Partial<XsiRuntime> | null): void {
  if (typeof window !== "undefined") throw new Error("__setXsiRuntimeForTests is a node-harness seam");
  gr.__layersXsiRuntime = r ? { device: true, env: process.env, fetch, now: () => Date.now(), storage: sessionStore, log: (l) => console.warn(l), ...r } : null;
}

// ------------------------------------------------------------------------------------------------- the gate

export type XsiGate = { ok: true; clientId: string; authorizeUrl: string; authorizeHost: string; relayUrl: string; relayHost: string } | { ok: false; code: XsiCode };

const gl = globalThis as unknown as { __layersXsiBadSaid?: Set<string> };
function sayBadConfig(rt: XsiRuntime, name: string): void {
  const said = (gl.__layersXsiBadSaid ??= new Set());
  if (said.has(name)) return;
  said.add(name);
  rt.log(`[x-signin] bad_config (${name})`);
}

/** where this process may run a sign-in. Pure over the runtime (no I/O). */
export function xsiGate(): XsiGate {
  const rt = runtime();
  if (!rt.device) return { ok: false, code: "device_only" };
  const env = rt.env;
  const mode = (env.X_SIGNIN ?? "").trim().toLowerCase();
  if (mode === "off") return { ok: false, code: "xsi_off" };
  if (mode === "bad_config") {
    sayBadConfig(rt, env.X_SIGNIN_BAD === "X_SIGNIN_AUTHORIZE_URL" ? "X_SIGNIN_AUTHORIZE_URL" : "X_CLIENT_ID");
    return { ok: false, code: "bad_config" };
  }
  if (mode !== "on") return { ok: false, code: "xsi_dormant" };
  const clientId = (env.X_CLIENT_ID ?? "").trim();
  if (!X_CLIENT_ID_RE.test(clientId)) {
    sayBadConfig(rt, "X_CLIENT_ID");
    return { ok: false, code: "bad_config" };
  }
  const authz = authorizeUrlRule(env.X_SIGNIN_AUTHORIZE_URL, false);
  if (!authz.ok) {
    sayBadConfig(rt, "X_SIGNIN_AUTHORIZE_URL");
    return { ok: false, code: "bad_config" };
  }
  let relay: URL;
  try {
    relay = new URL((env.VALIDATOR_URL ?? "").trim() || "http://localhost:4001");
    if (relay.protocol !== "https:" && relay.protocol !== "http:") throw new Error("not http");
  } catch {
    sayBadConfig(rt, "VALIDATOR_URL");
    return { ok: false, code: "bad_config" };
  }
  return { ok: true, clientId, authorizeUrl: authz.url, authorizeHost: authz.host, relayUrl: relay.origin + relay.pathname.replace(/\/+$/, ""), relayHost: relay.host };
}

function openGate(): Extract<XsiGate, { ok: true }> {
  const g = xsiGate();
  if (!g.ok) throw new XsiError(g.code);
  return g;
}

// ------------------------------------------------------------------------------------------------- memory

interface Memory {
  queue: Promise<unknown>;
  /** one-shot: the finish that recorded says so, so the card and the callback can show the moment once */
  justSignedIn: boolean;
}
const gm = globalThis as unknown as { __layersXsi?: Memory };
function memory(): Memory {
  return (gm.__layersXsi ??= { queue: Promise.resolve(), justSignedIn: false });
}

/** one step at a time in this process: a finish and a disconnect racing must never record twice */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const m = memory();
  const next = m.queue.catch(() => undefined).then(fn);
  m.queue = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------------------------------------------- views

export interface XsiLinkView {
  username: string;
  name: string | null;
  pfpUrl: string | null;
  personaId: string;
  handle: string | null;
  verified: boolean;
  verifiedAt: number;
  disconnected: boolean;
}

export interface XsiStatusView {
  available: boolean;
  code: XsiCode | null;
  reason: string | null;
  /** where the visitor is sent, and which server relays (the card names both before the first request) */
  authorizeHost: string | null;
  relayHost: string | null;
  link: XsiLinkView | null;
  /** a request is waiting in this tab (started, not yet answered) */
  pending: boolean;
  moment?: "signed-in";
}

async function readXLink(): Promise<XAccountLink | null> {
  const { xLink } = await import("@/lib/fc/siwf/links");
  try {
    return await xLink();
  } catch {
    throw new XsiError("xsi_links_unreadable");
  }
}

async function linkView(link: XAccountLink | null): Promise<XsiLinkView | null> {
  if (!link) return null;
  let handle: string | null = null;
  try {
    const { getPersona } = await import("@/lib/identity/keystore");
    handle = getPersona(link.personaId)?.handle ?? null;
  } catch {
    handle = null;
  }
  return { username: link.username, name: link.name, pfpUrl: link.pfpUrl, personaId: link.personaId, handle, verified: link.verified, verifiedAt: link.verifiedAt, disconnected: link.disconnectedAt !== null };
}

function pendingHere(rt: XsiRuntime): boolean {
  try {
    return readPending(rt.storage().get(PENDING_KEY)) !== null;
  } catch {
    return false;
  }
}

/** GET: where things stand. A pure read of config, this tab's storage and the sealed record: no network call, never a code,
 *  a verifier or a state. THROWS xsi_links_unreadable when the record cannot be read (never "no X account"). */
export async function xsiStatus(): Promise<XsiStatusView> {
  const g = xsiGate();
  if (!g.ok) return { available: false, code: g.code, reason: SENTENCES[g.code], authorizeHost: null, relayHost: null, link: null, pending: false };
  const rt = runtime();
  const view: XsiStatusView = {
    available: true,
    code: null,
    reason: null,
    authorizeHost: g.authorizeHost,
    relayHost: g.relayHost,
    link: await linkView(await readXLink()),
    pending: pendingHere(rt),
  };
  const m = memory();
  if (m.justSignedIn) {
    m.justSignedIn = false;
    view.moment = "signed-in";
  }
  return view;
}

// ------------------------------------------------------------------------------------------------- the steps

function linkedDeviceRefusal(): Promise<void> {
  return import("@/lib/identity/keystore").then(
    (ks) => {
      if (ks.isLinkedDevice()) throw new XsiError("xsi_linked_device");
    },
    () => {
      throw new XsiError("xsi_linked_device"); // no keystore here: nothing could be minted
    }
  );
}

/** START: a fresh verifier and state, kept in this tab only, and the authorize URL. Replaces any earlier request. */
export function startXsi(where: { origin: string }): Promise<{ authorizeUrl: string; status: XsiStatusView }> {
  return serialized(async () => {
    const g = openGate();
    const rt = runtime();
    await linkedDeviceRefusal();
    const link = await readXLink();
    if (link && link.disconnectedAt === null) throw new XsiError("xsi_signed_in");
    const origin = String(where.origin ?? "");
    if (!/^https?:\/\/[^/\s?#]+$/.test(origin)) throw new XsiError("bad_request");
    const { verifier, challenge, state } = await freshRequest();
    const redirectUri = redirectUriFor(origin);
    try {
      rt.storage().set(PENDING_KEY, pendingText({ v: 1, state, verifier, redirectUri, clientId: g.clientId, createdAt: rt.now() }));
    } catch {
      throw new XsiError("xsi_storage");
    }
    const authorizeUrl = authorizeUrlFor({ base: g.authorizeUrl, clientId: g.clientId, redirectUri, state, challenge });
    return { authorizeUrl, status: await xsiStatus() };
  });
}

/** CANCEL: forget the request in flight (X's page simply leads nowhere afterwards) */
export function cancelXsi(): Promise<XsiStatusView> {
  return serialized(async () => {
    openGate();
    try {
      runtime().storage().remove(PENDING_KEY);
    } catch {
      /* nothing stored: nothing to forget */
    }
    return xsiStatus();
  });
}

interface RelayAnswer {
  user: XUser;
  revoked: boolean;
}

/** the validator's relay: one POST, a second only when the first got NO answer (a code is single-use: an answered
 *  refusal is final). Every failure is a fixed code; nothing upstream is echoed. */
async function relayExchange(g: Extract<XsiGate, { ok: true }>, rt: XsiRuntime, body: { code: string; codeVerifier: string; redirectUri: string; clientId: string }): Promise<RelayAnswer> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = await rt.fetch(g.relayUrl + "/x/signin/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20_000) : undefined,
      });
    } catch {
      res = null;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!res) throw new XsiError("xsi_relay");
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = j && typeof j.code === "string" ? j.code : "";
    if (code === "not_armed") throw new XsiError("xsi_relay_off");
    if (code === "x_refused") throw new XsiError("xsi_code");
    if (code === "x_users_me" || code === "x_answer") throw new XsiError("xsi_profile");
    throw new XsiError("xsi_relay");
  }
  const user = readXUser(j?.user);
  if (!user) throw new XsiError("xsi_profile");
  return { user, revoked: j?.revoked === true };
}

/**
 * FINISH (the callback page): the stored request is READ AND REMOVED first (one shot), then judged (pkce.ts
 * judgeCallback: in flight, fresh, this page's callback, the state), then redeemed through the relay, then recorded.
 * Every refusal records nothing.
 */
export function finishXsi(where: { origin: string; search: string }): Promise<XsiStatusView> {
  return serialized(async () => {
    const g = openGate();
    const rt = runtime();
    let raw: string | null = null;
    try {
      const st = rt.storage();
      raw = st.get(PENDING_KEY);
      st.remove(PENDING_KEY); // ONE SHOT: whatever happens next, this request can never be answered twice
    } catch {
      raw = null;
    }
    const origin = String(where.origin ?? "");
    if (!/^https?:\/\/[^/\s?#]+$/.test(origin)) throw new XsiError("bad_request");
    const verdict = judgeCallback(readPending(raw), callbackParams(String(where.search ?? "")), rt.now(), redirectUriFor(origin));
    if (!verdict.ok) throw new XsiError(verdict.code);
    if (verdict.pending.clientId !== g.clientId) throw new XsiError("xsi_no_request"); // started under another X app
    await linkedDeviceRefusal();
    const answer = await relayExchange(g, rt, { code: verdict.code, codeVerifier: verdict.pending.verifier, redirectUri: verdict.pending.redirectUri, clientId: g.clientId });
    await record(answer.user, rt);
    memory().justSignedIn = true;
    return xsiStatus();
  });
}

/** the persona's handle, free inside Totem (the first alternative when another account already uses it) */
async function freeHandle(base: string, ks: typeof import("@/lib/identity/keystore")): Promise<string> {
  try {
    const { personaByHandle } = await import("@/lib/adapters/mock/store");
    if (!personaByHandle.has(base)) return base;
    const own = new Set(ks.listPersonas().map((p) => p.handle.toLowerCase()));
    const { handleSuggestions } = await import("@/lib/onboarding/state");
    const free = handleSuggestions(base, (h) => personaByHandle.has(h) || own.has(h), 1)[0];
    if (!free) throw new XsiError("xsi_handle_stem", `Another account here already uses @${base}. Rename it first, then sign in.`);
    return free;
  } catch (e) {
    if (e instanceof XsiError) throw e;
    return base;
  }
}

/** RECORD: mint or adopt the root's public self, sync the rosters (loud), seal the X link (loud). Idempotent: a retry
 *  finds the persona the first attempt minted (deterministic nonce). */
async function record(user: XUser, rt: XsiRuntime): Promise<void> {
  const ks = await import("@/lib/identity/keystore");
  if (ks.isLinkedDevice()) throw new XsiError("xsi_linked_device");
  const links = await import("@/lib/fc/siwf/links");
  let both: Awaited<ReturnType<typeof links.rootLinks>>;
  try {
    both = await links.rootLinks();
  } catch {
    throw new XsiError("xsi_links_unreadable");
  }
  // one X account per root: a live link or a TOMBSTONE for another X account refuses (only the same account re-arms)
  if (both.x && both.x.xid !== user.id) throw new XsiError("xsi_one_x");
  const nonce = X_PERSONA_NONCE(user.id);
  const existing = ks.listPersonas().find((p) => p.nonce === nonce) ?? null;
  // ONE public self per root: when the root signed in with Farcaster first, the X account joins THAT persona (it keeps the
  // name and picture the visitor confirmed); the root shows both accounts
  const fcSelf = !existing && both.farcaster ? ks.getPersona(both.farcaster.personaId) : null;
  const adopted = fcSelf && fcSelf.publicSelf === true ? fcSelf : null;
  let handle = existing?.handle ?? adopted?.handle ?? handleFromX(user.username);
  const selfId = existing?.id ?? adopted?.id ?? null;
  // the stem rule, both directions (as Sign in with Farcaster's): no OTHER persona of this root may share a stem with the
  // X username, nor already hold the handle the public self would take — matching names would publicly link them
  const clash = ks.listPersonas().find((p) => p.id !== selfId && p.nonce !== nonce && (derivedFromMain(p.handle, user.username) || p.handle.toLowerCase() === handle));
  if (clash)
    throw new XsiError(
      "xsi_handle_stem",
      `Your persona @${clash.handle} shares a name with this X account. Matching names would publicly link them. Rename that persona first, then sign in.`
    );
  if (!existing && !adopted) handle = await freeHandle(handle, ks);
  const name = (user.name ?? "").trim().slice(0, 50) || user.username;
  const avatarUrl = user.pfpUrl && user.pfpUrl.length <= 256 ? user.pfpUrl : null;
  let persona = existing ?? adopted;
  if (!persona) persona = ks.createPersona({ name, handle, kind: "public", avatarUrl, bio: null, cluster: null, nonce, forkedFrom: null, publicSelf: true });
  // the root shows the X account it signed in with (This is you's Show can hide it again)
  if (persona.xShown !== user.username) persona = ks.updatePersona(persona.id, { xShown: user.username }) ?? persona;
  try {
    const { syncRoster } = await import("@/lib/identity/roster");
    await syncRoster();
    if (rt.device) {
      const { getSession } = await import("@/lib/session");
      const session = await getSession(); // the device's session shim adopts the new persona into the store maps
      if (session.rootId) {
        const { recordPersona } = await import("@/lib/identity/rootRoster");
        await recordPersona(session.rootId, persona.id, {
          id: persona.id,
          name: persona.name,
          handle: persona.handle,
          avatarUrl: persona.avatarUrl,
          bio: persona.bio,
          createdAt: persona.createdAt,
          publicSelf: true,
        });
      }
    }
  } catch {
    throw new XsiError("xsi_seal");
  }
  const next: XAccountLink = {
    kind: "x",
    xid: user.id,
    username: user.username,
    name: user.name,
    pfpUrl: user.pfpUrl,
    verified: user.verified,
    verifiedType: user.verifiedType,
    personaId: persona.id,
    verifiedAt: rt.now(),
    disconnectedAt: null,
  };
  try {
    await links.updateAccountLinks((all) => {
      // re-checked INSIDE the write, on the document the validator holds (a second tab may have linked meanwhile)
      const prev = all.links.find((l): l is XAccountLink => l.kind === "x");
      if (prev && prev.xid !== user.id) throw new XsiError("xsi_one_x");
      return { v: 1, links: [...all.links.filter((l) => l.kind !== "x"), next] };
    });
  } catch (e) {
    if (e instanceof XsiError) throw e;
    throw new XsiError("xsi_seal");
  }
}

/** DISCONNECT: tombstone the X link (disconnectedAt); the public self is kept, and stops showing the X account. Signing in
 *  again as the same X account re-arms it; another X account stays refused. */
export function disconnectXsi(confirm: string): Promise<XsiStatusView> {
  return serialized(async () => {
    openGate();
    if (confirm !== "DISCONNECT") throw new XsiError("confirm_required");
    const link = await readXLink();
    if (!link) throw new XsiError("not_signed_in");
    if (link.disconnectedAt === null) {
      const { updateAccountLinks } = await import("@/lib/fc/siwf/links");
      const at = runtime().now();
      try {
        await updateAccountLinks((doc) => {
          const x = doc.links.find((l) => l.kind === "x");
          if (!x) throw new XsiError("not_signed_in");
          return { v: 1, links: doc.links.map((l) => (l === x ? { ...x, disconnectedAt: at } : l)) };
        });
      } catch (e) {
        if (e instanceof XsiError) throw e;
        throw new XsiError("xsi_seal");
      }
      try {
        const ks = await import("@/lib/identity/keystore");
        const p = ks.getPersona(link.personaId);
        if (p && p.xShown === link.username) ks.updatePersona(p.id, { xShown: null });
      } catch {
        /* the link is the fact; the profile's X line goes with the next This is you */
      }
    }
    return xsiStatus();
  });
}

/** reloadIdentity / tests: forget the moment and the queue, AND the tab's request in flight — a request started under
 *  the previous root must never land on the next one */
export function resetXsi(): void {
  gm.__layersXsi = { queue: Promise.resolve(), justSignedIn: false };
  try {
    runtime().storage().remove(PENDING_KEY);
  } catch {
    /* no storage here: nothing in flight */
  }
}
