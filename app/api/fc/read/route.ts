import type { NextRequest } from "next/server";
import { fcRead, noteRefused, refusal, type FcReadAnswer } from "@/lib/fc/readRelay.server";

// FC-READ — POST /api/fc/read: the public live-read relay's door (lib/fc/readRelay.server.ts is the room).
//
// SERVER-ONLY (scripts/device-routes.mjs SERVER_ONLY, public/device/boot.js's default list): the browser device
// forwards this path to the real server instead of answering it in the tab, and the device bundle never contains
// this route or the module that holds the key.
//
// Why POST with a JSON body {op, arg}: THIS request's handle or hash stays out of its path and query string. It does
// not keep a visitor's browsing out of the platform's HTTP log: opening a live profile or thread is a page request
// for /<fname> or /<fname>/status/<hash>, and that path is logged next to the address (A-FCREAD-OPERATOR-SEES-READS).
// Why the custom header: x-layers-relay makes every cross-origin browser request a CORS preflight, and nothing here
// ever approves one (no Access-Control-Allow-* header is sent, OPTIONS answers 405), so another website cannot reach
// this route directly with an <img>, a <form> or a no-cors fetch. Sec-Fetch-Site: cross-site is refused on top
// (browsers set it and pages cannot). FRAMING a preview page is blocked separately (frame-ancestors 'none' in
// middleware.ts, and a framed device makes no lookup); a top-level navigation or popup to a lookup URL still reaches
// the relay as a same-origin request, bounded by the global bucket and the lookup shares (A-FCREAD-BUDGET-DOS).
//
// Nothing is logged here: no op argument, no address, no body. FC-READ (house): nor which discovery source is armed —
// the status answer the relay hands back is the same armed/reason/state in fids mode and in house mode. The relay logs aggregate counters only.
export const dynamic = "force-dynamic";
// FC-READ: belt and braces against Next 14's fetch Data Cache — the relay's upstream fetch is cache:"no-store"
// already; this makes every fetch under this segment no-store as well, so no upstream answer can persist outside the
// relay's own cache and budget accounting.
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;
const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

function send(a: FcReadAnswer): Response {
  return new Response(JSON.stringify(a.body), {
    status: a.status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...(a.headers ?? {}) },
  });
}

/** the address the middleware's limiter keys on (middleware.ts clientAddress — duplicated, not imported: the
 *  middleware is its own bundle). A forwarding header is honoured only behind a configured proxy (TRUST_PROXY=true);
 *  otherwise one shared bucket, exactly as the API limiter behaves. Per-address limits are best effort until the
 *  platform's X-Forwarded-For is measured (A-FCREAD-FORWARDING-HEADER); the relay's global bucket does not care.
 *  FC-READ (review, cost-abuse-3): the address is NORMALISED before the relay hashes it (addressKeyOf below). No
 *  address at all stays "local" — the rig and the local pair, which run without TRUST_PROXY, key exactly as before. */
function clientAddress(req: NextRequest): string {
  // PUBLIC GO-LIVE (A-WEB-PROXY-HOP-HEADERS): X-Real-IP's right-most entry, else the RIGHT-most X-Forwarded-For entry, exactly as middleware.ts edgeForwardedAddress
  const lastEntry = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  const forwarded = process.env.TRUST_PROXY === "true" ? lastEntry(req.headers.get("x-real-ip")) || lastEntry(req.headers.get("x-forwarded-for")) || null : null;
  const raw = req.ip || forwarded;
  return raw ? addressKeyOf(raw) : "local";
}

// FC-READ (review, cost-abuse-3) — the per-address KEY, not the raw address string. The three functions below are
// IDENTICAL in middleware.ts (the middleware is its own bundle; the unit harness checks the two copies match):
//   * IPv4 ("a.b.c.d", or "a.b.c.d:port") -> "a.b.c.d", as before
//   * IPv6 -> its /64 ("2001:db8:1:2::/64"): a subscriber's prefix is one bucket, however many of its 2^64
//     addresses it rotates through (it used to be a fresh bucket per address, even behind an honest edge)
//   * IPv4-mapped IPv6 ("::ffff:a.b.c.d") -> "a.b.c.d", the same bucket as the plain IPv4
//   * anything unparseable -> one shared "unknown" bucket, so a junk forwarding value buys no fresh buckets
function addressKeyOf(raw: string): string {
  let s = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else {
    const withPort = /^([0-9.]+):\d{1,5}$/.exec(s);
    if (withPort) s = withPort[1];
  }
  const v4 = ipv4Octets(s);
  if (v4) return v4.join(".");
  const v6 = ipv6Groups(s.replace(/%[0-9a-z._~-]+$/, ""));
  if (!v6) return "unknown";
  if (v6[0] === 0 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0 && v6[4] === 0 && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join(".");
  }
  return v6.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}

function ipv4Octets(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function ipv6Groups(s: string): number[] | null {
  if (s.length < 2 || s.length > 45 || !/^[0-9a-f:.]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string, last: boolean): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const segs = part.split(":");
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (last && i === segs.length - 1 && seg.includes(".")) {
        const o = ipv4Octets(seg);
        if (!o) return null;
        out.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(seg)) out.push(parseInt(seg, 16));
      else return null;
    }
    return out;
  };
  const head = parse(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? parse(halves[1], true) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill >= 1 ? [...head, ...new Array<number>(fill).fill(0), ...tail] : null;
}

/** read at most MAX_BODY_BYTES; null when the body is larger (or unreadable) */
async function boundedText(req: NextRequest): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

function badOp(): Response {
  noteRefused();
  return send(refusal(400, "bad_op"));
}

export async function POST(req: NextRequest): Promise<Response> {
  // cross-site first: a request another site's page made is refused before anything is read
  if (req.headers.get("x-layers-relay") !== "1" || (req.headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") {
    noteRefused();
    return send(refusal(403, "cross_site"));
  }
  // every parameter is the server's: a query string of any kind (fid=, viewer_fid=, cursor=, limit=, provider=) is
  // REJECTED, not stripped
  if (req.nextUrl.search) return badOp();
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return badOp();
  const text = await boundedText(req);
  if (text === null) return badOp();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return badOp();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badOp();
  // exactly {op} or {op, arg} — any other key (fid, viewer_fid, cursor, provider, limit, ...) refuses the request.
  // FC-READ (house): this is also why a visitor can never steer the house mode's following-feed read. Its fid is the
  // server's FC_READ_HOUSE_FID alone: discovery takes no arg, there is no "following" op, and a body key, a query
  // string or an argument naming an fid is refused here or by the relay's parseOp before any upstream call.
  const keys = Object.keys(body);
  if (!keys.includes("op") || keys.some((k) => k !== "op" && k !== "arg")) return badOp();
  const { op, arg } = body as { op?: unknown; arg?: unknown };
  try {
    return send(await fcRead(op, arg, clientAddress(req)));
  } catch {
    // never the error's text (it could carry a header value); a fixed answer, and the device treats it as final
    return send(refusal(503, "fc_read_upstream"));
  }
}

/** never a CORS approval: a preflight gets no Access-Control-Allow-* header, so the browser never sends the POST */
export function OPTIONS(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST", ...NO_STORE } });
}
