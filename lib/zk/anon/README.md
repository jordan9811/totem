# The anonymous submission channel — what it is and what it is not

Proofs never ride the device-envelope path (which signs every write with
a device key the validator can map to a root). They go to a separate,
unauthenticated endpoint on the validator (`POST /zk/anon/submit`, or the
OHTTP gateway `POST /zk/anon/ohttp`) over a fresh socket, with exactly
these headers: `host`, `content-type`, `content-length`, `x-zk-pow`
(plus `connection: close`). Anything else — a cookie, an authorization
header, `x-layers-*`, `x-forwarded-for`, a user-agent, a referer — is an
identifying header, and the validator refuses the submission. Rate
limiting is a stateless proof of work bound to the body bytes. Every
outcome is the same size and is held to the same timing floor.

## The relay is the privacy

`direct` (the default) sends straight to the validator. The operator sees
your IP on every submission. **That configuration is not private and the
product says so** (the Gate 3 label reads "DEMO — not yet private" with
`direct` no matter what else holds).

`ohttp` (RFC 9458 Oblivious HTTP) encrypts each submission to the
validator's gateway key and sends it through a **relay**. The relay sees
your IP and ciphertext; the validator sees the relay's IP and plaintext.
That splits the identity from the content — **only if the relay and the
operator do not collude.** A relay the operator runs (including the test
relay in `scripts/lib-ohttp-relay.mjs`) provides exactly nothing. This is a
standing external dependency and cost, not a library: the operator must
contract or partner with a non-colluding relay and then ATTEST it with
`ZK_RELAY_THIRD_PARTY=true`. The attestation cannot be machine-checked; the
posture doc lists it as an assumption.

Candidate public OHTTP relays (as of this writing; each requires a
gateway-side arrangement, none is a drop-in):

- Cloudflare's OHTTP relay (used by Apple iCloud Private Relay's OHTTP
  path and Cloudflare Privacy Gateway partners);
- Fastly's OHTTP relay (used by Mozilla Firefox's OHTTP-based telemetry
  and DoH configurations);
- any RFC 9458-conformant relay operated by a party contractually
  independent of the operator.

`tor` (SOCKS5 to an onion-service gateway) is **stubbed**: selecting it
refuses to submit rather than silently downgrading to `direct`.

## What the channel does not fix

Timing. A proof sent when you act is correlated with the act regardless
of the relay. That is why proofs are precomputed at idle and queued with a
random delay (`lib/zk/anon/queue.ts`); the relay hides *who*, the jitter
hides *when* — for the submission. Three things it does NOT hide, found by
the adversarial reviews and stated in SECURITY-POSTURE.md:

- the **preparation** (epoch, members, history fetches; the queued-state
  write) rides the identified channel at the time of the motivating
  render — one burst per persona per epoch, not one per render
  (A-PREPARE-BURST);
- a relay's **passive log** joins submissions to the gateway's view by
  time even with every request padded to one constant size, because OHTTP
  is not a mixnet (A-RELAY-PASSIVE-JOIN);
- the `personaId` that the proof's message binds in the clear — the
  proof-history budget bounds partitions per epoch, not epochs.

And one thing the channel USED to break itself: the queue's `sent` mark
was flushed to the validator ~150 ms after every anonymous send, an
identified write bracketing the anonymous one. It is now persisted on its
own random delay.

## The browser channel (PERSONA LAUNCH P7)

On the public site there is no server-side device: the visitor's browser
tab is the device, and a tab has no sockets of its own. So a tab proves in
a Web Worker (`public/device/prover.js`, built from
`lib/zk/prover/browser-worker.ts`) and sends over the **web channel**
(`lib/zk/anon/webChannel.ts`, the only module that sends anything for the
anonymous path from a tab) to two routes of its own on the validator:
`POST /zk/anon/web?pow=<nonce>` and `GET /zk/anon/web/head`. The strict
`/zk/anon/submit` route and the OHTTP gateway are unchanged.

What the tab pins on every request: no cookies or HTTP auth
(`credentials: "omit"`), no Referer (`referrerPolicy: "no-referrer"`),
nothing cached, a redirect is an error, no keepalive beacon, one header
(`content-type: text/plain;charset=UTF-8`, which keeps it a CORS "simple"
request with no preflight), a body of exactly 4096 bytes, and the proof of
work in the query string. The validator tolerates exactly the headers a
browser adds by itself (user-agent, origin, accept-language, the
`sec-ch-ua*` and `sec-fetch-*` hints, priority, pragma, cache-control, dnt,
sec-gpc) and refuses a cookie, an authorization, any `x-layers-*` header or
a referer, whatever else holds. Proxy hop headers (`x-forwarded-*`,
`x-real-ip`, `forwarded`, `via`, `x-request-id`, `x-request-start`) are
tolerated only when the operator declared the proxy (`TRUST_PROXY=true`).

What it does NOT hide, said plainly:

- **A-WEB-CHANNEL-DIRECT-UA.** Under `direct` the operator sees the
  visitor's IP AND the browser's user-agent and client hints on every
  submission, and a page cannot choose the browser's connection pooling.
  The label stays DEMO under `direct`, as it always did.
- **A-WEB-TAB-CLOSED-POST-EXPIRES.** A post still waiting for its proof
  lives only in the open tab; one proved for a window that ends while the
  tab is closed is refused when the reopened tab sends it (an anonymous
  post gets no epoch grace). Both are said in plain words.
- The browser carries **test-universe envelopes only** this wave: the tab
  refuses to send a live one, and the web route refuses one before it is
  verified. Under OHTTP the gateway cannot tell a tab from a server device
  (that is what OHTTP is for), so the tab's own refusal is the one that
  holds there.

Two things the review of P7 closed (the timing and the bytes around the
channel, not the channel itself):

- **L1, no request at proof time.** The prover used to be loaded from
  `/device/prover.js` (and, live, its proving files) when a proof was due —
  one request, revalidated every time (`/public` is `max-age=0`), on a tick
  whose other requests are the same for every device: it marked the device
  that had just proved, the last timing link once OHTTP is armed. Every tab
  now loads the prover at boot, proving or not, and starts each one-job
  worker from a Blob URL of those bytes; live jobs carry the boot-loaded
  files (`lib/zk/transport/browser.ts`). A job that finds nothing loaded is
  refused, never loaded lazily, and the worker's own `fetch` refuses.
- **L2, an allowlisted body.** `paddedBody` serializes only the envelope's
  own fields (`v, mode, claimKind, publicInputs, nullifier, proof,
  payload`), so a prover timing (`provingMs`, which the live transports used
  to hang on the envelope) or anything else a caller adds in memory never
  rides the 4096 bytes. The prove time is kept in memory instead.

OHTTP-ready: with `ZK_RELAY=ohttp` the tab encapsulates the request itself
(HPKE, `ohttp.ts` + `bhttp.ts`), fetches the gateway's key configuration
THROUGH the relay URL the device environment names (only an https URL with
no credentials or query is ever handed to a page), and sends ciphertext to
the relay. No relay URL is a refusal, never a fallback to direct. The relay
must answer CORS for a browser (the test relay in
`scripts/lib-ohttp-relay.mjs` does). `tor` still refuses.
