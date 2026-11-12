// ZK PASS 1 Gate 1 — minimal RFC 9292 Binary HTTP (known-length framing
// only). DELIBERATE DUPLICATE of validator/bhttp.js; the Gate 1 suite
// round-trips between the two. Format plumbing, not cryptography.
// PERSONA LAUNCH P7: already browser-safe (Uint8Array only, no Buffer, no node:*): the browser device's OHTTP adapter
// frames its inner request with it in the tab (lib/zk/anon/relay.ts webOhttpRelay).

function encVarint(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) throw new Error("bhttp: varint must be a non-negative integer");
  if (n < 64) return Uint8Array.of(n);
  if (n < 16384) return Uint8Array.of(0x40 | (n >> 8), n & 0xff);
  if (n < 1073741824) return Uint8Array.of(0x80 | (n >>> 24), (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  out[0] |= 0xc0;
  return out;
}

function decVarint(buf: Uint8Array, pos: number): { value: number; next: number } {
  if (pos >= buf.length) throw new Error("bhttp: truncated varint");
  const first = buf[pos];
  const len = 1 << (first >> 6);
  if (pos + len > buf.length) throw new Error("bhttp: truncated varint");
  let v = BigInt(first & 0x3f);
  for (let i = 1; i < len; i++) v = (v << BigInt(8)) | BigInt(buf[pos + i]);
  return { value: Number(v), next: pos + len };
}

const te = new TextEncoder();
const td = new TextDecoder();
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const lp = (b: Uint8Array) => concat([encVarint(b.length), b]);
const lpStr = (s: string) => lp(te.encode(s));

function encodeFields(headers: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(headers)) parts.push(lpStr(k.toLowerCase()), lpStr(v));
  return concat(parts);
}

export interface BhttpRequest {
  method: string;
  scheme: string;
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}
export interface BhttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export function encodeRequest(r: BhttpRequest): Uint8Array {
  return concat([encVarint(0), lpStr(r.method), lpStr(r.scheme), lpStr(r.authority), lpStr(r.path), lp(encodeFields(r.headers)), lp(r.body), encVarint(0)]);
}

export function encodeResponse(r: BhttpResponse): Uint8Array {
  return concat([encVarint(1), encVarint(r.status), lp(encodeFields(r.headers)), lp(r.body), encVarint(0)]);
}

function reader(buf: Uint8Array) {
  let p = 0;
  const varint = () => {
    const r = decVarint(buf, p);
    p = r.next;
    return r.value;
  };
  const bytes = () => {
    const n = varint();
    if (p + n > buf.length) throw new Error("bhttp: truncated field");
    const out = buf.subarray(p, p + n);
    p += n;
    return out;
  };
  const str = () => td.decode(bytes());
  const fields = () => {
    const len = varint();
    const end = p + len;
    if (end > buf.length) throw new Error("bhttp: truncated field section");
    const headers: Record<string, string> = {};
    while (p < end) {
      const name = str();
      const value = str();
      headers[name] = value;
    }
    if (p !== end) throw new Error("bhttp: field section length mismatch");
    return headers;
  };
  return { varint, bytes, str, fields };
}

export function decodeRequest(buf: Uint8Array): BhttpRequest {
  const r = reader(buf);
  if (r.varint() !== 0) throw new Error("bhttp: only known-length requests are supported");
  const method = r.str();
  const scheme = r.str();
  const authority = r.str();
  const path = r.str();
  const headers = r.fields();
  const body = r.bytes();
  return { method, scheme, authority, path, headers, body };
}

export function decodeResponse(buf: Uint8Array): BhttpResponse {
  const r = reader(buf);
  if (r.varint() !== 1) throw new Error("bhttp: only known-length responses are supported");
  let status = r.varint();
  let headers = r.fields();
  while (status >= 100 && status < 200) {
    status = r.varint();
    headers = r.fields();
  }
  const body = r.bytes();
  return { status, headers, body };
}
