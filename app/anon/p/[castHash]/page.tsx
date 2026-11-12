import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CAST_HASH_RE, embedMeta, isFarcasterWebUrl, MINIAPP_HOME_PATH } from "@/lib/miniapp/manifest";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused, publicOrigin } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { isPublicLive } from "@/lib/platform/publicLive";
import { validatorUrl } from "@/lib/ports";

// PUBLIC GO-LIVE — ONE @anon POST, SHAREABLE: /anon/p/<castHash>, the link a "Share" puts in a cast. A SERVER page (no
// device: nothing here is anyone's identity) that reads relay's single-cast validator read, GET /zk/anon-cast?mode=&hash=
// — public data, the validator's own row, NO viewer and no header that names one — and prints the fc:miniapp embed, so
// the cast shows a button that opens /anon inside Farcaster.
//
//   * a hidden (taken-down) or unknown cast is a 404 (the validator answers 404 for both; it is never shown again);
//   * on the PREVIEW the live universe is read first, then the test one: a test post is labelled "Preview only · not on
//     Farcaster". On a LIVE site (shareUniverses below) ONLY the live universe is read, so a test-universe post is a 404
//     there (ASM-2: a test proof is forgeable from public constants, so a test row must never render under "Anon Wire"
//     with the fc:miniapp embed on the real site);
//   * a validator that cannot be read (twice) is said in plain words — never "not found" (never fail open);
//   * a "View on Farcaster" link only for https on the Farcaster web client's hosts (lib/miniapp/manifest.ts);
//   * no Report button here (the page boots no device to send one): it points to the takedown page instead.
// The validator address is the device's own (NEXT_PUBLIC_VALIDATOR_URL, else lib/ports.ts validatorUrl()).

export const dynamic = "force-dynamic";

interface ShareCast {
  castHash: string;
  text: string;
  at: number | null;
  castUrl: string | null;
  mode: "live" | "fixture";
  /** THE HUB ROUTE: the protocol's own copy was read ("confirmed"), or the hub could not be read just now ("unchecked") */
  network?: "confirmed" | "unchecked";
}
type Read = { kind: "ok"; cast: ShareCast } | { kind: "missing" } | { kind: "error"; reason: string };

const READ_TIMEOUT_MS = 5000;

async function readOnce(mode: "live" | "fixture", hash: string): Promise<{ status: number; json: unknown; isJson: boolean } | null> {
  const base = (process.env.NEXT_PUBLIC_VALIDATOR_URL || validatorUrl()).replace(/\/+$/, "");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/zk/anon-cast?mode=${mode}&hash=${hash}`, { cache: "no-store", signal: ac.signal, headers: { accept: "application/json" } });
    const isJson = (r.headers.get("content-type") ?? "").includes("application/json");
    const json = isJson ? await r.json().catch(() => null) : null;
    return { status: r.status, json, isJson };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PUBLIC GO-LIVE (ASM-2) — which universes this site's share page reads, in order. The test universe's proofs are
 * FORGEABLE from public constants (validator/zk.js fixtureTag is a hash over public inputs and a constant key), so on a
 * site that is live it must never render: ONLY "live" when the app is live (lib/platform/publicLive.ts isPublicLive(): a
 * public deployment with PUBLIC_LIVE=true) or when its anonymous posts are live (ZK_ANON_UNIVERSE set on this server:
 * "live", or any other value, which is taken as not-the-preview rather than guessed at — fail closed). Otherwise (the
 * preview, the rig, the owner service) live first, then the test universe, labelled: the flag-off behaviour unchanged.
 * Read at REQUEST time, never at import, from this server's own environment. NOT exported (a page file may export only
 * Next's own fields); scripts/unit-miniapp.mjs SP-LIVE measures it through the page, by the requests it makes.
 */
function shareUniverses(env: Record<string, string | undefined> = process.env): ReadonlyArray<"live" | "fixture"> {
  const anonUniverseSet = String(env.ZK_ANON_UNIVERSE ?? "").trim() !== "";
  return isPublicLive(env) || anonUniverseSet ? ["live"] : ["live", "fixture"];
}

/**
 * THE HUB ROUTE — the cast AS THE FARCASTER PROTOCOL HAS IT: the validator's keyless castById read of its hub
 * (GET /zk/anon/network-cast?hash=0x…; validator/anonpublic.js networkCast, taken-down rows left out). The Farcaster app
 * may hide @anon (an account that has not opted in to its rules); the protocol does not, so this page shows the protocol's
 * copy. "off" = this site's validator reads no hub (501); "missing" = the hub says it is not there (or it was removed);
 * "error" = the hub could not be read (retried once) — said in plain words, never "not found".
 */
type NetRead = { kind: "ok"; text: string; at: number | null; castHash: string | null; castUrl: string | null } | { kind: "off" } | { kind: "missing" } | { kind: "error"; reason: string };
async function readNetwork(networkHash: string): Promise<NetRead> {
  const base = (process.env.NEXT_PUBLIC_VALIDATOR_URL || validatorUrl()).replace(/\/+$/, "");
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
    try {
      const r = await fetch(`${base}/zk/anon/network-cast?hash=${networkHash}`, { cache: "no-store", signal: ac.signal, headers: { accept: "application/json" } });
      const j = (await r.json().catch(() => null)) as { cast?: { text?: unknown; at?: unknown; castHash?: unknown; castUrl?: unknown; hash?: unknown } } | null;
      if (r.status === 501) return { kind: "off" };
      if (r.status === 404 && j) return { kind: "missing" };
      const c = j && j.cast;
      if (r.status === 200 && c && c.hash === networkHash && typeof c.text === "string") {
        return { kind: "ok", text: c.text, at: typeof c.at === "number" && Number.isFinite(c.at) ? c.at : null, castHash: typeof c.castHash === "string" && CAST_HASH_RE.test(c.castHash) ? c.castHash : null, castUrl: isFarcasterWebUrl(c.castUrl) ? c.castUrl : null };
      }
      last = "the Farcaster network read answered " + r.status;
    } catch {
      last = "the Farcaster network couldn't be reached";
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind: "error", reason: last };
}
const NETWORK_HASH_RE = /^0x[0-9a-f]{40}$/;
const networkHashOfUrl = (u: string | null) => {
  const m = u ? /\/(0x[0-9a-f]{40})$/.exec(u) : null;
  return m ? m[1] : null;
};

/** the universes shareUniverses() names, in order; each read retried once when it fails (no answer, 5xx, or not the contract) */
async function readCast(hash: string): Promise<Read> {
  // THE HUB ROUTE: a 0x network hash (a link from the protocol's own list) is read from the protocol alone
  if (NETWORK_HASH_RE.test(hash)) {
    const n = await readNetwork(hash);
    if (n.kind === "ok") return { kind: "ok", cast: { castHash: n.castHash ?? hash, text: n.text, at: n.at, castUrl: n.castUrl, mode: "live", network: "confirmed" } };
    if (n.kind === "error") return { kind: "error", reason: n.reason };
    return { kind: "missing" };
  }
  const row = await readRelayRow(hash);
  // a LIVE row with a network hash, on a site whose validator reads a hub: the protocol's copy is shown (and a cast the
  // protocol no longer has — deleted there — is not shown); an unreadable hub keeps the relay's own row, said as such
  if (row.kind === "ok" && row.cast.mode === "live") {
    const nh = networkHashOfUrl(row.cast.castUrl);
    if (nh) {
      const n = await readNetwork(nh);
      if (n.kind === "ok") return { kind: "ok", cast: { ...row.cast, text: n.text, at: n.at ?? row.cast.at, network: "confirmed" } };
      if (n.kind === "missing") return { kind: "missing" };
      if (n.kind === "error") return { kind: "ok", cast: { ...row.cast, network: "unchecked" } };
    }
  }
  return row;
}

async function readRelayRow(hash: string): Promise<Read> {
  let failure = "";
  for (const mode of shareUniverses()) {
    let res = await readOnce(mode, hash);
    if (!res || res.status >= 500 || (res.status === 404 && !res.isJson)) res = await readOnce(mode, hash);
    if (!res) {
      failure = "the post list couldn't be reached";
      continue;
    }
    if (res.status === 404 && res.isJson) continue; // not in this universe (or hidden): try the next
    if (res.status === 404) {
      failure = "this site's post list doesn't answer single posts yet";
      continue;
    }
    if (res.status !== 200 || !res.json || typeof res.json !== "object") {
      failure = "the post list answered " + res.status;
      continue;
    }
    const o = res.json as { cast?: unknown };
    const c = (o.cast && typeof o.cast === "object" ? o.cast : o) as { castHash?: unknown; text?: unknown; at?: unknown; castUrl?: unknown };
    if (c.castHash !== hash || typeof c.text !== "string") {
      failure = "the post list answered something else";
      continue;
    }
    return { kind: "ok", cast: { castHash: hash, text: c.text, at: typeof c.at === "number" && Number.isFinite(c.at) ? c.at : null, castUrl: isFarcasterWebUrl(c.castUrl) ? c.castUrl : null, mode } };
  }
  return failure ? { kind: "error", reason: failure } : { kind: "missing" };
}

const originNow = () => publicOrigin(headers() as unknown as Headers);

export async function generateMetadata(): Promise<Metadata> {
  return { title: "A post from @anon · Totem", description: "An anonymous post on Farcaster, from @anon.", other: embedMeta(originNow()) };
}

export default async function AnonPostPage({ params }: { params: { castHash: string } }) {
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  const hash = String(params.castHash ?? "").toLowerCase();
  if (!CAST_HASH_RE.test(hash) && !NETWORK_HASH_RE.test(hash)) notFound();
  const read = await readCast(hash);
  if (read.kind === "missing") notFound();
  return (
    <main data-testid="anon-share-page" className="mx-auto flex w-full max-w-[600px] flex-col gap-3 px-4 py-4">
      <header className="text-[17px] font-extrabold">Anon Wire</header>
      {read.kind === "error" ? (
        <section data-testid="anon-share-error" role="alert" className="rounded-2xl border border-x-border-dark p-4 text-[15px]">
          This post couldn&rsquo;t be loaded just now ({read.reason}). Reload to try again.
        </section>
      ) : (
        <article data-testid="anon-share-cast" data-cast-hash={read.cast.castHash} data-mode={read.cast.mode} className="rounded-2xl border border-x-border-dark p-4">
          <div className="flex items-center gap-2 text-[13px] text-x-sec">
            <span className="font-bold text-x-text">@anon</span>
            {read.cast.at !== null ? <span>· {new Date(read.cast.at).toUTCString().replace(/:\d\d GMT$/, " UTC")}</span> : null}
            {read.cast.mode === "fixture" ? <span className="rounded-full bg-x-pill px-2 text-[12px]">Preview only · not on Farcaster</span> : null}
            {read.cast.network === "confirmed" ? <span data-testid="anon-share-onnet">· on the Farcaster network</span> : null}
            {read.cast.network === "unchecked" ? <span data-testid="anon-share-unchecked">· couldn&rsquo;t check the Farcaster network just now</span> : null}
          </div>
          <p data-testid="anon-share-text" className="mt-2 whitespace-pre-wrap break-words text-[17px] leading-6">
            {read.cast.text}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
            {read.cast.castUrl ? (
              <a data-testid="anon-share-cast-link" href={read.cast.castUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-x-sec hover:text-x-blue hover:underline">
                View on Farcaster
              </a>
            ) : null}
            <Link href="/terms" className="text-x-sec hover:underline">
              Report a post
            </Link>
          </div>
        </article>
      )}
      <section className="rounded-2xl border border-x-border-dark p-4">
        <p className="text-[15px] leading-5">
          {/* PUBLIC GO-LIVE (PRIV-LIVE-4): no "nobody learns who wrote a post, Totem included" (components/anon/AnonExplainer.tsx) */}
          <span className="font-bold">@anon</span> is one shared Farcaster account. A post carries no name or account, only proof that someone in the crowd wrote it.
        </p>
        <Link href={MINIAPP_HOME_PATH} data-testid="anon-share-open" className="mt-3 inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover">
          Post anonymously too
        </Link>
      </section>
    </main>
  );
}
