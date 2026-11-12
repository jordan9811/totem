"use strict";
// PERSONA LAUNCH P2 (BYX G1, closes the board issue "Large saves vanish without a word") — THE STATE BODY LIMIT.
//
// express.json() used to run with its default 100 KB limit and no handler, so a namespace that outgrew it was answered
// with express's HTML 413 page, and the app's persist client (which swallowed every non-OK) dropped the save without a
// word: memory said "saved", the validator kept the old copy, the next restart lost the difference. Now the limit is a
// deliberate number, the refusal is JSON naming it, and the client checks the size BEFORE sending and throws a
// PersistError naming the namespace (lib/adapters/mock/persist.ts — its copy of this constant is asserted equal).
//
// 256 KiB: a sealed namespace is hex ciphertext (2 bytes per plaintext byte), so this holds ~128 KiB of plaintext per
// PUT. Anything bigger is a module-owned chunked document (lib/vault/chunkedDoc.ts, 96 KiB plaintext per chunk).
const STATE_BODY_LIMIT_BYTES = 262144;

/** the namespace a request path names (PUT /state/:ns), for the refusal; null elsewhere */
function namespaceOf(path) {
  const m = /^\/state\/([^/?#]+)/.exec(String(path || ""));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * The error middleware mounted right after the body parser: body-parser's `entity.too.large` becomes a JSON 413
 * naming the limit and the namespace — never express's HTML page. Every other error passes on unchanged.
 */
function bodyLimitErrorHandler(err, req, res, next) {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "body too large", limit: STATE_BODY_LIMIT_BYTES, namespace: namespaceOf(req.path) });
  }
  return next(err);
}

module.exports = { STATE_BODY_LIMIT_BYTES, bodyLimitErrorHandler, namespaceOf };
