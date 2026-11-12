// BROWSER KEYSTORE PASS Gate 1 stage 3 — `next/server` for the device bundle: the surface the route handlers use
// (NextResponse.json, req.json, req.nextUrl, req.cookies.get, res.cookies.set/delete) over the browser's own
// Request/Response. Cookies land in the device jar immediately — one visitor, one jar (lib/device/jar.ts).
import { deviceJar } from "@/lib/device/jar";

type CookieRecord = { name: string; value: string };

function cookieReader() {
  return {
    get: (name: string): CookieRecord | undefined => {
      const v = deviceJar.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
    has: (name: string): boolean => deviceJar.has(name),
    getAll: (): CookieRecord[] => deviceJar.entries().map(([name, value]) => ({ name, value })),
  };
}

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies: ReturnType<typeof cookieReader>;
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    this.nextUrl = new URL(href, typeof location !== "undefined" ? location.origin : "http://device.local");
    this.cookies = cookieReader();
  }
}

export class NextResponse extends Response {
  readonly cookies = {
    set: (name: string, value: string, _opts?: unknown) => {
      deviceJar.set(name, value);
      return this.cookies;
    },
    delete: (name: string) => {
      deviceJar.delete(name);
      return this.cookies;
    },
    get: (name: string): CookieRecord | undefined => {
      const v = deviceJar.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
  };
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
  static redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
}
