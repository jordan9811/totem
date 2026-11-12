"use strict";
// ZK PASS 1 Gate 1 — minimal RFC 9292 Binary HTTP, KNOWN-LENGTH framing
// only (framing indicator 0 = request, 1 = response). This is the message
// format Oblivious HTTP (RFC 9458) encapsulates. Format plumbing, not
// cryptography: QUIC varints (RFC 9000 §16), length-prefixed strings.
// Byte-identical duplicate in lib/zk/anon/bhttp.ts; a round-trip test pins
// them together.

function encVarint(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("bhttp: varint must be a non-negative integer");
  if (n < 64) return Buffer.from([n]);
  if (n < 16384) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n | 0x4000);
    return b;
  }
  if (n < 1073741824) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE((n | 0x80000000) >>> 0);
    return b;
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n) | (BigInt(3) << BigInt(62)));
  return b;
}

function decVarint(buf, pos) {
  if (pos >= buf.length) throw new Error("bhttp: truncated varint");
  const first = buf[pos];
  const len = 1 << (first >> 6);
  if (pos + len > buf.length) throw new Error("bhttp: truncated varint");
  let v = BigInt(first & 0x3f);
  for (let i = 1; i < len; i++) v = (v << BigInt(8)) | BigInt(buf[pos + i]);
  return { value: Number(v), next: pos + len };
}

const lp = (bytes) => Buffer.concat([encVarint(bytes.length), bytes]);
const lpStr = (s) => lp(Buffer.from(String(s), "utf8"));

function encodeFields(headers) {
  const parts = [];
  for (const [k, v] of Object.entries(headers || {})) parts.push(lpStr(k.toLowerCase()), lpStr(v));
  return Buffer.concat(parts);
}

function encodeRequest({ method, scheme, authority, path, headers, body }) {
  const fields = encodeFields(headers);
  const content = Buffer.from(body || new Uint8Array(0));
  return Buffer.concat([encVarint(0), lpStr(method), lpStr(scheme), lpStr(authority), lpStr(path), lp(fields), lp(content), encVarint(0)]);
}

function encodeResponse({ status, headers, body }) {
  const fields = encodeFields(headers);
  const content = Buffer.from(body || new Uint8Array(0));
  return Buffer.concat([encVarint(1), encVarint(status), lp(fields), lp(content), encVarint(0)]);
}

function reader(buf) {
  let p = 0;
  return {
    varint() {
      const r = decVarint(buf, p);
      p = r.next;
      return r.value;
    },
    bytes() {
      const n = this.varint();
      if (p + n > buf.length) throw new Error("bhttp: truncated field");
      const out = buf.subarray(p, p + n);
      p += n;
      return out;
    },
    str() {
      return this.bytes().toString("utf8");
    },
    fields() {
      const len = this.varint();
      const end = p + len;
      if (end > buf.length) throw new Error("bhttp: truncated field section");
      const headers = {};
      while (p < end) {
        const name = this.str();
        const value = this.str();
        headers[name] = value;
      }
      if (p !== end) throw new Error("bhttp: field section length mismatch");
      return headers;
    },
    pos() {
      return p;
    },
  };
}

function decodeRequest(buf) {
  const r = reader(Buffer.from(buf));
  if (r.varint() !== 0) throw new Error("bhttp: only known-length requests are supported");
  const method = r.str();
  const scheme = r.str();
  const authority = r.str();
  const path = r.str();
  const headers = r.fields();
  const body = r.bytes();
  return { method, scheme, authority, path, headers, body };
}

function decodeResponse(buf) {
  const r = reader(Buffer.from(buf));
  if (r.varint() !== 1) throw new Error("bhttp: only known-length responses are supported");
  let status = r.varint();
  let headers = r.fields();
  // informational responses (1xx) carry their own field sections; skip them
  while (status >= 100 && status < 200) {
    status = r.varint();
    headers = r.fields();
  }
  const body = r.bytes();
  return { status, headers, body };
}

module.exports = { encVarint, decVarint, encodeRequest, decodeRequest, encodeResponse, decodeResponse };
