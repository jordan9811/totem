// BROWSER KEYSTORE PASS Gate 1 stage 3 — the early bootstrap (a classic, synchronous script the page loads FIRST).
// Until the device bundle has booted, any same-origin fetch under /api/ is queued instead of reaching the network,
// so a client component that fetches on mount cannot race the device and land on the server (which, in production,
// holds no identity and would answer "no device"). lib/device/host.ts drains the queue when it installs.
//
// PROD-LIVE (D-CU-0-4): on a public deployment the ROOT layout loads this with next/script strategy
// "beforeInteractive", so it runs before hydration on EVERY document — including one the visitor reached by a soft
// navigation, where a <script> element React inserts during client rendering is never executed. The guard below
// makes a second copy (the /device page's own loader, DeviceHostMount's fallback) a no-op: the queue is installed
// once per document.
//
// A device that FAILED to start (lib/device/bootState.ts markDeviceFailed sets __layersDeviceFailed and drains the
// queue with 503s) must not leave later requests hanging either: they get the same 503 JSON answer, so every island
// shows its error state instead of an infinite spinner. Never fail open — the answer is an error, not an empty body.
(function () {
  if (window.__layersOrigFetch) return;
  var orig = window.fetch.bind(window);
  // FC-READ: "/api/fc/read" (the live-read relay, which holds the read key) goes to the server, never into the queue
  // the device answers — this default must equal scripts/device-routes.mjs SERVER_ONLY. CONNECT MAIN: "/api/fc/connect"
  // (the owner service's QR flow; the server refuses it on a public deployment) is the server's for the same reason.
  // Each entry covers its subtree ("/api/<entry>" and "/api/<entry>/…", the loop below).
  var serverOnly = (window.__LAYERS_DEVICE_SERVER_ONLY || ["/api/health", "/api/dev/live", "/api/custody/passkey/challenge", "/api/custody/passkey/release", "/api/owner-login", "/api/fc/read", "/api/fc/connect", "/api/fc/connector"]);
  window.__layersOrigFetch = orig;
  window.__layersFetchQueue = [];
  function isDevicePath(input) {
    try {
      var href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      var u = new URL(href, location.href);
      if (u.origin !== location.origin || u.pathname.indexOf("/api/") !== 0) return false;
      for (var i = 0; i < serverOnly.length; i++) {
        if (u.pathname === serverOnly[i] || u.pathname.indexOf(serverOnly[i] + "/") === 0) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function failed(reason) {
    return new Response(JSON.stringify({ error: "device failed to start: " + reason, code: "device_failed" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  window.fetch = function (input, init) {
    if (window.__layersDeviceInstalled || !isDevicePath(input)) return orig(input, init);
    if (typeof window.__layersDeviceFailed === "string") return Promise.resolve(failed(window.__layersDeviceFailed));
    return new Promise(function (resolve, reject) {
      window.__layersFetchQueue.push({ input: input, init: init, resolve: resolve, reject: reject });
    });
  };
})();
