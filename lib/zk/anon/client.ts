import "server-only";
// ZK PASS 1 Gate 1 — the ISOLATED submission path.
//
// CONNECTION ISOLATION: submissions go out on a fresh socket every time
// (`agent: false` on node:http/https — no pool, no keep-alive), never on
// the undici pool the envelope client (lib/adapters/mock/persist.ts) and
// the validator client use, and with an EXPLICIT minimal header set — no
// user-agent, no cookies, nothing the runtime would add on its own. This
// module deliberately imports neither persist.ts nor validatorClient.ts
// (a static check in the suite enforces that) so it cannot share their
// transport by accident.
//
// Diagnostics of the last submission (socket reuse flag, headers actually
// sent, relay kind, timing) are kept in memory for the isolation assertion;
// they never leave the process except through the dev-only status probe.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface IsolatedResponse {
  status: number;
  body: Uint8Array;
  contentType: string | null;
  /** node's flag: true only when a keep-alive socket was reused (must be false) */
  reusedSocket: boolean;
  headersSent: string[];
  ms: number;
}

export async function isolatedRequest(url: string, opts: { method: "GET" | "POST"; headers?: Record<string, string>; body?: Uint8Array; timeoutMs?: number }): Promise<IsolatedResponse> {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const headers: Record<string, string> = { host: u.host };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  if (opts.body) headers["content-length"] = String(opts.body.length);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method,
        headers,
        agent: false, // ← the isolation: a new socket, no pooling, no keep-alive
        timeout: opts.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: new Uint8Array(Buffer.concat(chunks)),
            contentType: (res.headers["content-type"] as string | undefined) ?? null,
            reusedSocket: req.reusedSocket === true,
            headersSent: Object.keys(req.getHeaders()).map((h) => h.toLowerCase()),
            ms: performance.now() - t0,
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("isolated request timed out")));
    req.on("error", reject);
    if (opts.body) req.write(Buffer.from(opts.body));
    req.end();
  });
}

// PERSONA LAUNCH P7: the browser device has no sockets of its own, so its submissions leave on the web channel
// (lib/zk/anon/webChannel.ts) and the diagnostics say so: `channel` names the path; `agentFalse` is true exactly on the
// node path above (the isolation it names is this file's agent:false); `reusedSocket` is null on the web channel, where
// a page can neither see nor choose the browser's connection pool (A-WEB-CHANNEL-DIRECT-UA). accept-z1 check 4 reads
// the node path's values, unchanged.
export interface AnonDiagnostics {
  at: number;
  relay: string;
  channel?: "node" | "web";
  agentFalse: boolean;
  reusedSocket: boolean | null;
  headersSent: string[];
  outcome: string;
  ms: number;
  powMs: number;
  powAttempts: number;
}

const g = globalThis as unknown as { __layersAnonLast?: AnonDiagnostics | null };
export function lastAnonSubmission(): AnonDiagnostics | null {
  return g.__layersAnonLast ?? null;
}
export function recordAnonSubmission(d: AnonDiagnostics): void {
  g.__layersAnonLast = d;
}
