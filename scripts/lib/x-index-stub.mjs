// PERSONA LAUNCH P2 (BYX G7) — A LOCAL STAND-IN for the two public lists the X index is built from:
//   GET /fc/account-verifications?platform=x&limit=1000&cursor=<base64url {page,limit,platform}>   (api.farcaster.xyz)
//   GET /transfers?from_id=N                                                                         (fnames.farcaster.xyz)
// with the real shapes and paging as probed 2026-10-08: verifications paged BY PAGE NUMBER inside an opaque cursor,
// newest first, `next` absent on the last page; transfers 100 a page by id, `to: 0` a release. One planted 429 with
// Retry-After (the crawler must honour it) and one planted release. It never touches the network: the handler is a
// pure function, served on an EPHEMERAL loopback port that is checked against every pinned port, or called in-process
// through stubFetch (the unit harness — any other URL fails the test).
import http from "node:http";

/** ports this stub must never take: the pinned rig pair, the prod-shape pair, the world-empty rollback pair, the
 *  Neynar stub and accept-cu4's probes */
export const FORBIDDEN_PORTS = new Set([3001, 4001, 3029, 3011, 4319, 3091, 4091, 3009, 3100, 3101]);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64 = (s) => {
  try {
    return JSON.parse(Buffer.from(String(s), "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/**
 * The stub's world. rows: verification rows ({fid, platform, platformId, platformUsername, verifiedAt, fname?});
 * transfers are derived from the rows' fnames (one register each, ids from 1) plus `extraTransfers` (e.g. a release).
 */
export function createIndexStub({ rows = [], extraTransfers = [], pageSize = 1000, throttleOnce = true, breakPage = null } = {}) {
  const st = { rows: rows.slice(), extraTransfers: extraTransfers.slice(), pageSize, throttled: !throttleOnce, breakPage, calls: [] };
  const transfers = () => {
    const out = [];
    let id = 1;
    for (const r of st.rows) if (r.fname) out.push({ id: id++, timestamp: 1700000000 + id, username: r.fname, owner: "0x" + "0".repeat(40), from: 0, to: r.fid });
    for (const t of st.extraTransfers) out.push({ id: id++, timestamp: 1700000000 + id, owner: "0x" + "0".repeat(40), from: 0, ...t });
    return out;
  };
  /** answer one request: {status, headers, body} */
  function handle(method, urlStr) {
    const url = new URL(urlStr, "http://stub.invalid");
    st.calls.push({ method, path: url.pathname, query: url.search });
    if (method !== "GET") return { status: 405, headers: {}, body: { error: "method" } };
    if (url.pathname === "/fc/account-verifications") {
      if (url.searchParams.get("platform") !== "x") return { status: 400, headers: {}, body: { error: "platform" } };
      const cur = url.searchParams.get("cursor");
      const page = cur ? unb64(cur)?.page : 0;
      if (!Number.isInteger(page) || page < 0) return { status: 400, headers: {}, body: { error: "cursor" } };
      if (page === 1 && !st.throttled) {
        st.throttled = true;
        return { status: 429, headers: { "Retry-After": "1" }, body: { error: "rate limited" } };
      }
      // newest first, like the real list
      const sorted = st.rows.slice().sort((a, b) => b.verifiedAt - a.verifiedAt || a.fid - b.fid);
      const slice = sorted.slice(page * st.pageSize, (page + 1) * st.pageSize).map(({ fname: _f, ...r }) => r);
      if (st.breakPage === page && slice.length) slice[0] = { ...slice[0], platformId: Number(slice[0].platformId) }; // a SCHEMA BREAK (a number id)
      const more = (page + 1) * st.pageSize < sorted.length;
      return { status: 200, headers: {}, body: { result: { verifications: slice }, ...(more ? { next: { cursor: b64({ page: page + 1, limit: 1000, platform: "x" }) } } : {}) } };
    }
    if (url.pathname === "/transfers") {
      const from = Number(url.searchParams.get("from_id") ?? 0);
      const list = transfers().filter((t) => t.id > from).slice(0, 100);
      return { status: 200, headers: {}, body: { transfers: list } };
    }
    return { status: 404, headers: {}, body: { error: "not in the stub" } };
  }
  return {
    state: st,
    handle,
    setRows(next) {
      st.rows = next.slice();
    },
    addRow(row) {
      st.rows.push(row);
    },
    setBreakPage(p) {
      st.breakPage = p;
    },
    resetThrottle() {
      st.throttled = false;
    },
    /** an in-process fetch for the unit harness: answers ONLY base + the two paths; anything else throws */
    fetchFor(base) {
      return async (u, init = {}) => {
        const s = String(u);
        if (!s.startsWith(base + "/")) throw new Error("unit: a request left the stub: " + s);
        const r = handle((init.method || "GET").toUpperCase(), s.slice(base.length));
        const text = JSON.stringify(r.body);
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: { get: (k) => r.headers[Object.keys(r.headers).find((h) => h.toLowerCase() === String(k).toLowerCase())] ?? null },
          json: async () => JSON.parse(text),
          text: async () => text,
        };
      };
    },
  };
}

/** serve a stub on an ephemeral 127.0.0.1 port that is none of the pinned ports; returns {url, close, stub} */
export async function startIndexStub(opts = {}) {
  const stub = createIndexStub(opts);
  for (let attempt = 0; attempt < 10; attempt++) {
    const server = http.createServer((req, res) => {
      const r = stub.handle(req.method, req.url);
      res.writeHead(r.status, { "Content-Type": "application/json", ...r.headers });
      res.end(JSON.stringify(r.body));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    if (FORBIDDEN_PORTS.has(port)) {
      await new Promise((r) => server.close(r));
      continue;
    }
    return { url: "http://127.0.0.1:" + port, port, stub, close: () => new Promise((r) => server.close(r)) };
  }
  throw new Error("x-index-stub: could not find a free ephemeral port outside the pinned set");
}
