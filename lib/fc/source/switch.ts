// NEYNAR AS A SWITCH (notes/runbooks/MORNING-NOV-7.md §6; SECURITY-POSTURE.md §42) — WHERE EACH FARCASTER SURFACE READS FROM.
//
// One switch per surface, set by the OPERATOR on the public app (never by a visitor): FC_SOURCE_FOLLOWING,
// FC_SOURCE_NOTIFICATIONS, FC_SOURCE_FORYOU, FC_SOURCE_SEARCH, FC_SOURCE_COUNTS, FC_SOURCE_CHANNELS, each `network`
// (Farcaster's own node: the default, and what an unset variable means), `neynar` (through the server-side read relay,
// lib/fc/readRelay.server.ts, the one reader of NEYNAR_READ_API_KEY) or `auto` (network first; Neynar only for a read the
// node cannot answer at all — a capability, never a failure: a node read that fails is said, with Retry, never swapped
// for Neynar at that moment).
//
// THE HARD RULE (first principles: unlinkability is the product). A Neynar read goes through Totem's server, and only a
// read that names no visitor may go there. So:
//   * FOLLOWING and NOTIFICATIONS are NETWORK ONLY, whatever the switch says. Each is a read of one account's own graph:
//     through the relay it would hand that account to Totem's server (and, for a persona, tie it to the address its root
//     reads from). `neynar` or `auto` is REFUSED at boot with a sentence and read as network. There is no relay op for
//     either (the relay's path check refuses /notifications and every following feed but the house account's).
//   * COUNTS are NETWORK ONLY too (the decision this file records): a like or recast total is asked for a cast the visitor
//     is looking at, so the set of hashes one tab asks for is that tab's screen — for Following, a fingerprint of the
//     root's follow list. Batching and a shared cache do not change who asked for which set: only an outside relay would,
//     and none runs. The network keeps no totals, so counts are UNAVAILABLE on posts the tab read from the node, and
//     `neynar`/`auto` are refused at boot like Following's. Posts that arrive VIA Neynar (For You's discovery list, a Neynar
//     search) already carry Neynar's totals in the one answer every visitor gets: no count read is ever made.
//   * FOR YOU: the root's own For You stays the node's (SECURITY-POSTURE.md §40: the hub, always, for a signed-in root
//     acting as themselves; the relay never sees the root's graph). `neynar` makes the relay's discovery list (one
//     server-held author list, the same for everyone) the For You of everyone else: a persona acting, a visitor with no
//     Farcaster sign-in. `network` (the default) reads no Neynar for anyone. `auto` = neynar today: the node cannot answer
//     a For You for a persona (nothing is read from the node while one acts) or for a visitor with no Farcaster account.
//   * SEARCH: the device's own search always runs first (lib/search); `neynar` adds posts and people found through the
//     relay's search ops, labelled "Via Neynar". The query is what the visitor typed (a public search, naming no visitor),
//     never a fid, a persona or a list — and the device refuses to send a query that names one of its own accounts.
//     `auto` = neynar: Farcaster's node has no search at all.
//   * CHANNELS: not built (D-FCREAD-NO-CHANNELS-IN-V1; Neynar removed trending). The switch is read and shown, and is OFF
//     whatever it says.
//
// WITH NO READ KEY (the relay unarmed), `neynar` and `auto` behave as off and SAY so ("switched on, but Neynar isn't
// connected"): a surface never fails open into an empty list that looks like "nothing on Farcaster".
//
// An unknown value (a typo) reads as network, said once at boot by the variable's NAME and a length class, never the
// value. Not a refused boot: this is the read relay's convention for a feature's misconfiguration (readRelay.server.ts
// relayConfig: "a refused boot is an outage", the public app has no healthcheck path), and network is the safe side.
// The hard-rule refusals are not an outage either: the code has no Neynar path for those surfaces to fall into, so the
// value cannot be honoured whatever it is; refusing it loudly at boot and in Settings › Developer is the whole job.
//
// WHERE IT IS READ: the public app server (instrumentation.ts boot lines; app/(main)/settings/developer, which renders
// each surface's source and why, read-only; the relay route, which refuses an op whose surface is switched to the
// network: 503 fc_source_off, no upstream call, no charge) and the visitor's browser device, which gets ONLY the
// switches that change what it does (FC_SOURCE_FORYOU, FC_SOURCE_SEARCH, and only when set to neynar or auto) as device
// hints (lib/device/deviceEnv.server.ts). A hint is page-settable: it chooses what the tab asks for, and grants nothing
// (the relay route enforces the server's own value). Every switch unset forwards NOTHING: a page is byte for byte what
// it was.
//
// This file imports NOTHING (the instrumentation hook, the device env builder, the relay and the device all read it).

type Env = Record<string, string | undefined>;

export type FcSurface = "following" | "notifications" | "forYou" | "search" | "counts" | "channels";
export const FC_SURFACES: readonly FcSurface[] = ["following", "notifications", "forYou", "search", "counts", "channels"];

export const FC_SOURCE_ENV: Readonly<Record<FcSurface, string>> = {
  following: "FC_SOURCE_FOLLOWING",
  notifications: "FC_SOURCE_NOTIFICATIONS",
  forYou: "FC_SOURCE_FORYOU",
  search: "FC_SOURCE_SEARCH",
  counts: "FC_SOURCE_COUNTS",
  channels: "FC_SOURCE_CHANNELS",
};

export const FC_SURFACE_NAMES: Readonly<Record<FcSurface, string>> = {
  following: "Following",
  notifications: "Notifications",
  forYou: "For You",
  search: "Search",
  counts: "Like and recast totals",
  channels: "Channels",
};

export type FcSourceValue = "network" | "neynar" | "auto";
/** what the variable says: unset (absent or blank), one of the three values, or anything else */
export type FcSourceAsked = FcSourceValue | "unset" | "invalid";

/** THE HARD RULE: these never read through Neynar or Totem's server, whatever the switch says */
export const FC_NETWORK_ONLY: ReadonlySet<FcSurface> = new Set<FcSurface>(["following", "notifications", "counts"]);
/** surfaces the relay can serve (a read that names no visitor) */
export const FC_NEYNAR_CAPABLE: ReadonlySet<FcSurface> = new Set<FcSurface>(["forYou", "search"]);
/** not built: the switch is read and shown, and the surface is off */
export const FC_NOT_BUILT: ReadonlySet<FcSurface> = new Set<FcSurface>(["channels"]);

/** where a surface's content comes from in the UI ("Every feed and result says where it came from") */
export const FC_SOURCE_LABELS = {
  network: "From Farcaster's network",
  neynar: "Via Neynar",
  device: "From your device",
} as const;
export type FcSourceLabel = keyof typeof FC_SOURCE_LABELS;

/** the sentence each refused surface's boot line and Settings row carry (the hard rule, in plain words) */
export const FC_REFUSED_SENTENCES: Readonly<Record<"following" | "notifications" | "counts", string>> = {
  following: "Following stays on Farcaster's network: read through Neynar, it would hand your account to Totem's server.",
  notifications: "Notifications stay on Farcaster's network: read through Neynar, they would hand your account to Totem's server.",
  counts:
    "Like and recast totals stay network-only: asking Neynar for the totals of the posts on your screen would tell Totem's server which posts you are looking at, and for your Following that names your account.",
};

export const FC_SOURCE_OFF_SENTENCE = "This Farcaster read is switched to Farcaster's network on this site, so Neynar is not asked.";

export function askedSource(env: Env, surface: FcSurface): FcSourceAsked {
  const raw = String(env[FC_SOURCE_ENV[surface]] ?? "").trim().toLowerCase();
  if (raw === "") return "unset";
  if (raw === "network" || raw === "neynar" || raw === "auto") return raw;
  return "invalid";
}

/** does the switch ask for Neynar (neynar, or auto — which is Neynar for exactly the surfaces the node cannot answer)? */
function asksNeynar(asked: FcSourceAsked): boolean {
  return asked === "neynar" || asked === "auto";
}

/**
 * SERVER: may the relay serve this surface? Only a Neynar-capable surface (For You, search) whose server switch asks for
 * Neynar. Following, notifications, counts and channels: never, whatever the switch says. Read per call (a few string
 * checks), so the answer always matches the env the process holds.
 */
export function serverNeynarAllowed(env: Env, surface: FcSurface): boolean {
  return FC_NEYNAR_CAPABLE.has(surface) && asksNeynar(askedSource(env, surface));
}

export type FcSourceEffective = "network" | "neynar" | "off" | "unavailable";
export type FcSourceReason =
  | "default"
  | "set_network"
  | "invalid"
  | "refused"
  | "not_built"
  | "neynar"
  | "neynar_unarmed";

export interface FcSurfaceState {
  surface: FcSurface;
  name: string;
  variable: string;
  asked: FcSourceAsked;
  /** where this surface's content actually comes from on this deployment */
  effective: FcSourceEffective;
  reason: FcSourceReason;
  /** one plain sentence: the source and why */
  sentence: string;
  /** the UI label of the effective source, or null when the surface shows nothing from Farcaster */
  label: string | null;
}

function lengthClass(env: Env, surface: FcSurface): number {
  return String(env[FC_SOURCE_ENV[surface]] ?? "").length;
}

/** the network-side sentence of each surface (its source when no Neynar is in play) */
const NETWORK_SENTENCES: Readonly<Record<FcSurface, string>> = {
  following: "From Farcaster's network: your browser reads your own graph from a Farcaster node. Never Neynar, never Totem's server.",
  notifications: "From Farcaster's network: your browser reads them from a Farcaster node. Never Neynar, never Totem's server.",
  forYou: "From Farcaster's network for your own account (your browser reads your graph from a Farcaster node); nothing from Neynar for anyone.",
  search: "From your device only: Farcaster's network has no search.",
  counts: "Not available: Farcaster's network keeps no like or recast totals. Posts that arrive via Neynar carry Neynar's totals in the same answer every visitor gets.",
  channels: "Not built yet (coming soon): nothing reads channels from Farcaster's network or from Neynar.",
};

const NEYNAR_SENTENCES: Readonly<Record<"forYou" | "search", string>> = {
  forYou:
    "Your own account's For You still comes from Farcaster's network; for a persona or a visitor without a Farcaster sign-in, it is the curated list via Neynar (one list for everyone, naming no visitor).",
  search:
    "Your device is searched first, then posts and people via Neynar. What you type goes to Totem's server and to Neynar; who you are does not, and a search that names one of your own accounts is never sent.",
};

const UNARMED_SENTENCES: Readonly<Record<"forYou" | "search", string>> = {
  forYou: "Switched to Neynar, but Neynar isn't connected on this site (no read key), so it is off: your own account's For You still comes from Farcaster's network, and nobody else gets a Neynar list.",
  search: "Switched to Neynar, but Neynar isn't connected on this site (no read key), so it is off: only your device is searched.",
};

/**
 * One surface's state on THIS deployment: what the switch asks, where content actually comes from, and why. `relayArmed`
 * is the relay's own answer (readRelay.server.ts relayArmed) on the server, or the device's FC_READ_RELAY hint.
 */
export function surfaceState(env: Env, surface: FcSurface, relayArmed: boolean): FcSurfaceState {
  const asked = askedSource(env, surface);
  const base = { surface, name: FC_SURFACE_NAMES[surface], variable: FC_SOURCE_ENV[surface], asked };
  const invalidNote =
    asked === "invalid"
      ? ` ${FC_SOURCE_ENV[surface]} is not network, neynar or auto (a value of ${lengthClass(env, surface)} character(s)), so it reads as network.`
      : "";
  if (FC_NOT_BUILT.has(surface)) {
    return { ...base, effective: "off", reason: asked === "invalid" ? "invalid" : "not_built", sentence: NETWORK_SENTENCES[surface] + invalidNote, label: null };
  }
  if (FC_NETWORK_ONLY.has(surface)) {
    const effective: FcSourceEffective = surface === "counts" ? "unavailable" : "network";
    const label = surface === "counts" ? null : FC_SOURCE_LABELS.network;
    if (asksNeynar(asked)) {
      const s = FC_REFUSED_SENTENCES[surface as "following" | "notifications" | "counts"];
      return { ...base, effective, reason: "refused", sentence: `${FC_SOURCE_ENV[surface]}=${asked} is refused. ${s}`, label };
    }
    return { ...base, effective, reason: asked === "invalid" ? "invalid" : asked === "network" ? "set_network" : "default", sentence: NETWORK_SENTENCES[surface] + invalidNote, label };
  }
  // the Neynar-capable surfaces (For You, search)
  const s = surface as "forYou" | "search";
  if (asksNeynar(asked)) {
    const auto = asked === "auto" ? " (auto: Farcaster's network cannot answer this read at all, so auto is Neynar here.)" : "";
    if (!relayArmed) return { ...base, effective: "off", reason: "neynar_unarmed", sentence: UNARMED_SENTENCES[s] + auto, label: s === "search" ? FC_SOURCE_LABELS.device : FC_SOURCE_LABELS.network };
    return { ...base, effective: "neynar", reason: "neynar", sentence: NEYNAR_SENTENCES[s] + auto, label: FC_SOURCE_LABELS.neynar };
  }
  return {
    ...base,
    effective: "network",
    reason: asked === "invalid" ? "invalid" : asked === "network" ? "set_network" : "default",
    sentence: NETWORK_SENTENCES[s] + invalidNote,
    label: s === "search" ? FC_SOURCE_LABELS.device : FC_SOURCE_LABELS.network,
  };
}

export function allSurfaceStates(env: Env, relayArmed: boolean): FcSurfaceState[] {
  return FC_SURFACES.map((s) => surfaceState(env, s, relayArmed));
}

/**
 * The boot's lines (names and value classes only: network/neynar/auto are not secrets; an unknown value is said by its
 * length). `warn`: a refused or unknown value, one line each. `info`: the one summary line.
 */
export function fcSourceBootLines(env: Env, relayArmed: boolean): { warn: string[]; info: string } {
  const warn: string[] = [];
  const parts: string[] = [];
  for (const st of allSurfaceStates(env, relayArmed)) {
    if (st.reason === "refused") warn.push(`FC SOURCE REFUSED → ${st.sentence} ${st.surface === "counts" ? "Totals stay unavailable." : "It is read from Farcaster's network."}`);
    else if (st.reason === "invalid") warn.push(`FC SOURCE: ${st.variable} is not network, neynar or auto (a value of ${lengthClass(env, st.surface)} character(s)); it reads as network`);
    else if (st.reason === "neynar_unarmed") warn.push(`FC SOURCE: ${st.variable}=${st.asked}, but the Neynar read relay is not armed (no read key): ${st.name} via Neynar is OFF`);
    parts.push(`${st.surface}=${st.effective}`);
  }
  return { warn, info: `FC SOURCES: ${parts.join(" ")} (Neynar read relay ${relayArmed ? "armed" : "unarmed"}; Following and notifications never read through Neynar)` };
}

/** the device hints: ONLY the switches that change what the tab asks for, and only when they ask for Neynar */
export function fcSourceDeviceHints(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of ["forYou", "search"] as const) {
    const asked = askedSource(env, s);
    if (asksNeynar(asked)) out[FC_SOURCE_ENV[s]] = asked;
  }
  return out;
}

function processEnv(): Env {
  try {
    return (typeof process !== "undefined" && process.env ? process.env : {}) as Env;
  } catch {
    return {};
  }
}

/**
 * THE DEVICE: may this tab ask the relay for this surface? Its hint asks for Neynar AND the relay hint is on. Never for
 * Following, notifications, counts or channels (no hint is ever forwarded for them, and this refuses them by name too).
 * Off the device (a server render) always false: a server render never relays.
 */
export function deviceNeynarOn(surface: FcSurface, env: Env = processEnv()): boolean {
  if (typeof window === "undefined") return false;
  if (!FC_NEYNAR_CAPABLE.has(surface)) return false;
  const v = String(env[FC_SOURCE_ENV[surface]] ?? "");
  return (v === "neynar" || v === "auto") && env.FC_READ_RELAY === "on";
}

/** THE DEVICE: the hint asks for Neynar but the relay is not armed here — the surface says "switched on, not connected" */
export function deviceNeynarUnarmed(surface: FcSurface, env: Env = processEnv()): boolean {
  if (typeof window === "undefined" || !FC_NEYNAR_CAPABLE.has(surface)) return false;
  const v = String(env[FC_SOURCE_ENV[surface]] ?? "");
  return (v === "neynar" || v === "auto") && env.FC_READ_RELAY !== "on";
}

// ---------------------------------------------------------------------------------------------- the search guard

/** a query, as the device and the relay both normalise it: NFKC, lower case, one space between words, trimmed */
export function normaliseSearchQuery(q: unknown): string {
  if (typeof q !== "string") return "";
  return q.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** the query rule the relay enforces (2 to 64 characters after normalising, no control characters) */
export function searchQueryAllowed(q: string): boolean {
  // eslint-disable-next-line no-control-regex
  return q.length >= 2 && q.length <= 64 && !/[\u0000-\u001f\u007f]/.test(q);
}

/**
 * THE DEVICE'S GUARD: does this query name one of this visitor's own accounts — a persona's handle, the root's fname or
 * handle, or one of their fids? Then it is never sent to Neynar (the relay would see that name from this browser's
 * address). Whole tokens only: "@alice", "alice" and "alice's" name alice; "malice" does not. `names` are handles and
 * fnames (lower-cased here, a leading @ ignored); `fids` positive integers.
 */
export function queryNamesOwnAccount(q: string, own: { names: Iterable<string>; fids: Iterable<number> }): boolean {
  const text = normaliseSearchQuery(q);
  if (!text) return false;
  const tokens = new Set(text.split(/[^a-z0-9._-]+/).map((t) => t.replace(/^[._-]+|[._-]+$/g, "")).filter(Boolean));
  for (const t of [...tokens]) {
    // "alice.eth" also names "alice", and "name.base.eth" its first label
    const first = t.split(".")[0];
    if (first) tokens.add(first);
  }
  for (const raw of own.names) {
    const n = String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
    if (!n) continue;
    if (tokens.has(n)) return true;
    const head = n.split(".")[0];
    if (head && head.length >= 2 && tokens.has(head) && n.endsWith(".eth")) return true;
  }
  for (const f of own.fids) {
    if (Number.isInteger(f) && f > 0 && tokens.has(String(f))) return true;
  }
  return false;
}
