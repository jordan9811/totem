// BROWSER KEYSTORE PASS Gate 1 stage 3 — DeviceHost: the browser answers its own `/api/*` (docs/custody-model.md
// D-CU-0-3). `window.fetch` is patched so a same-origin request under /api/ is routed to the bundled route handler
// in-process; everything else goes to the network untouched. The page's early bootstrap (public/device/boot.js)
// queued the requests that arrived before the device was ready; installing drains that queue through the same path.
import { NextRequest } from "@/lib/device/shims/next-server";
import type { DeviceRoute } from "@/lib/device/routes.generated";
import { noPersonaActs, noPersonaWriteRefusal } from "@/lib/device/actingRoot";

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response> | Response;
interface Queued {
  input: RequestInfo | URL;
  init?: RequestInit;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
interface DeviceWindow {
  __layersOrigFetch?: typeof fetch;
  __layersFetchQueue?: Queued[];
  __layersDeviceInstalled?: boolean;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function hrefOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export function isDeviceRequest(input: RequestInfo | URL, serverOnly: string[]): URL | null {
  let url: URL;
  try {
    url = new URL(hrefOf(input), location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return null;
  if (serverOnly.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return null;
  return url;
}

export async function handleDeviceRequest(routes: DeviceRoute[], url: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  let match: DeviceRoute | null = null;
  let params: Record<string, string> = {};
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    match = r;
    params = Object.fromEntries(r.params.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
    break;
  }
  if (!match) return json({ error: "the device serves no such route: " + url.pathname }, 404);
  const fn = match.mod[method] as Handler | undefined;
  if (typeof fn !== "function") return json({ error: `method ${method} not allowed on ${match.pattern}` }, 405);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const bodyless = method === "GET" || method === "HEAD";
  const body = bodyless ? undefined : init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  // ACTING AS YOURSELF (lib/device/actingRoot.ts): while no persona is the tab's acting identity, a persona write is
  // refused HERE, before its route runs, so no route can quietly act as some default persona (the root's own writes,
  // some judged by their body, go through)
  // (judged only while no persona acts and only for a write: every other request runs exactly as before, with no await)
  if (!bodyless && noPersonaActs()) {
    const noPersona = await noPersonaWriteRefusal(match.pattern, method, typeof body === "string" ? body : body === undefined ? null : "\u0000not-text");
    if (noPersona) return json(noPersona.body, noPersona.status);
  }
  const req = new NextRequest(url.href, { method, headers, body: body as BodyInit | undefined });
  try {
    const res = await fn(req, { params });
    return res instanceof Response ? res : json(res, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[device] " + method + " " + url.pathname + " threw: " + msg);
    return json({ error: msg }, 500);
  }
}

/** Patch window.fetch, then drain whatever the early bootstrap queued. Idempotent. */
export function installDeviceHost(routes: DeviceRoute[], serverOnly: string[]): void {
  const w = window as unknown as DeviceWindow;
  if (w.__layersDeviceInstalled) return;
  const orig = w.__layersOrigFetch ?? window.fetch.bind(window);
  const patched: typeof fetch = (input, init) => {
    const url = isDeviceRequest(input, serverOnly);
    return url ? handleDeviceRequest(routes, url, input, init) : orig(input, init);
  };
  window.fetch = patched;
  w.__layersDeviceInstalled = true;
  const queued = w.__layersFetchQueue ?? [];
  w.__layersFetchQueue = [];
  for (const q of queued) patched(q.input, q.init).then(q.resolve, q.reject);
}
