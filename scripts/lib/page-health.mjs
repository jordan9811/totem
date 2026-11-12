// PROD-LIVE (D-CU-0-4) — what a page SHOWS, measured in a real browser. Shared by scripts/accept-prodlive.mjs and
// scripts/smoke-deployed.mjs.
//
// Why this exists: the deployed smoke passed 8/8 while the public preview was broken, because it only drove the
// device's API layer (page.evaluate(fetch)) and never looked at what the pages rendered. Every broken page still
// answered HTTP 200 — the failure was an INLINE sentence ("Couldn't load your timeline … refusing to mint a device
// key on a production server") inside a perfectly healthy document. A status code cannot see that; the DOM can.
//
// Nothing here writes, and nothing here loads a page: the callers own navigation (and with it the root budget —
// every full load of an UNSAVED visitor mints a new root on the validator).

/** The sentences a broken page prints inline. Curly and straight apostrophes both: the pages render &rsquo;. */
export const INLINE_ERROR_NEEDLES = [
  { label: "refusing to mint", re: /refusing to mint/i },
  { label: "refusing to open", re: /refusing to open/i },
  { label: "refusing to", re: /refusing to/i },
  { label: "Couldn't load", re: /couldn['’]t load/i },
  { label: "Couldn't confirm", re: /couldn['’]t confirm/i },
  { label: "Couldn't read", re: /couldn['’]t read/i },
  { label: "Application error", re: /Application error/ },
  { label: "Internal Server Error", re: /Internal Server Error/ },
  { label: "This page could not be found", re: /This page could not be found/ },
  // word-bounded: a count like 14042 or a hash is not a 404
  { label: "404", re: /\b404\b/ },
];

/** The rig's FIXTURE identity — the owner's real handle, the seeded persona and root, the seeded fid. On a public
 *  deployment none of these may name the VISITOR anywhere in the chrome (D-CU-0-4). The fid is bounded so a hex id,
 *  a decimal or a longer number that merely contains the digits does not match. */
export const FIXTURE_IDENTITY_NEEDLES = [
  { label: "yeak__", re: /yeak__/ },
  { label: "persona_viewer_main", re: /persona_viewer_main/ },
  { label: "root_viewer", re: /root_viewer/ },
  { label: "9152 (the seeded fid)", re: /(?<![\w.])9152(?![\w.])/ },
];

/** The fixture SELF's other public fields (lib/fixtures/data.json "self"). The chrome falls back to these when it
 *  has no persona to show, which on a public deployment is the same bug as naming the fixture persona. */
export const FIXTURE_SELF_NEEDLES = [
  { label: "the fixture display name \"jordan\"", re: /(?<![\w-])jordan(?![\w-])/ },
  { label: "the fixture bio \"Delphi Research\"", re: /Delphi Research/ },
  { label: "the fixture avatar (pravatar img=12)", re: /pravatar\.cc\/160\?img=12(?!\d)/ },
];

/** the fixture self's follow counts, which the mobile drawer has hard-coded (checked only inside the drawer) */
export const FIXTURE_DRAWER_NEEDLES = [
  { label: "the fixture following count 1,162", re: /(?<![\d,])1,162(?![\d,])/ },
  { label: "the fixture follower count 4,242", re: /(?<![\d,])4,242(?![\d,])/ },
];

/** every needle in `needles` that `text` matches, with a short snippet of context around the first hit */
export function scanNeedles(text, needles) {
  const hits = [];
  const s = String(text ?? "");
  for (const n of needles) {
    const m = n.re.exec(s);
    if (!m) continue;
    const at = m.index;
    const snippet = s.slice(Math.max(0, at - 50), at + m[0].length + 50).replace(/\s+/g, " ").trim();
    hits.push({ label: n.label, snippet });
  }
  return hits;
}

/** a hit list as one line for a failure message */
export const describeHits = (hits) => hits.map((h) => `"${h.label}" (…${h.snippet}…)`).join("; ");

/**
 * FC-READ: what the body-needle scan leaves out — every cast card, and anything marked as network content. With the
 * public live-read relay on, a timeline shows REAL Farcaster casts, and real people write "404" and "refusing to" and
 * "couldn't load" in their posts; a needle scan over the whole body would fail the deployed smoke on someone's cast.
 * The needles are about the PAGE's own inline errors, which never render inside a cast card. `:not([data-live="false"])`
 * because React renders data-live={false} as the attribute "false".
 *
 * FC-READ (review): the "Farcaster · read-only" marker (data-testid="network-marker") is named too. On a live card and
 * a live permalink root it sits inside a [data-live] region and is excluded twice over; on a network PROFILE header it
 * may not (only that header's disabled Follow carries data-live), and the marker is network labelling, never the
 * page's own error. Its copy carries no needle word either — this keeps it that way whatever the copy becomes.
 */
export const NEEDLE_SCAN_EXCLUDE = 'article[data-testid="cast"], [data-live]:not([data-live="false"]), [data-testid="network-marker"]';

/**
 * The inline errors on the current page: every needle in the visible body text OUTSIDE cast cards
 * (NEEDLE_SCAN_EXCLUDE), every VISIBLE element whose testid ends in "-error" and carries text, and a device-status that
 * reached "failed". Returns strings; empty = clean.
 */
export async function inlineErrors(page) {
  const snap = await page.evaluate((exclude) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const errorEls = [...document.querySelectorAll('[data-testid$="-error"]')]
      .filter((el) => visible(el) && (el.innerText || "").trim().length > 0)
      .map((el) => el.getAttribute("data-testid") + ": " + (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 140));
    const status = document.querySelector('[data-testid="device-status"][data-state="failed"]');
    if (status) errorEls.push("device-status failed: " + (status.innerText || "").trim().replace(/\s+/g, " ").slice(0, 140));
    // the preview banner's "unknown" is the device failing to answer /api/zk — an error state, never a label
    const banner = document.querySelector('[data-testid="preview-banner"][data-state="unknown"]');
    if (banner) errorEls.push("preview-banner unknown: " + (banner.innerText || "").trim().replace(/\s+/g, " ").slice(0, 140));
    // FC-READ: the body text WITHOUT the cast cards. innerText is read with the excluded subtrees display:none for the
    // length of this one synchronous task (restored before it ends: no paint, no React render sees it), so what is
    // scanned is exactly what innerText means everywhere else in this file — hidden text stays out, block breaks stay in.
    let text = "";
    let excluded = 0;
    if (document.body) {
      const skip = [...document.querySelectorAll(exclude)];
      excluded = skip.length;
      // the whole style attribute is saved and put back verbatim, and an absent one stays absent. Chrome syncs a CSSOM
      // write to the attribute lazily: a bare removeAttribute right after style.setProperty is undone by that sync
      // (measured: style="" reappears), so the attribute is set to "" first and then removed.
      const saved = skip.map((el) => el.getAttribute("style"));
      try {
        for (const el of skip) el.style.setProperty("display", "none", "important");
        text = document.body.innerText;
      } finally {
        skip.forEach((el, i) => {
          el.setAttribute("style", saved[i] ?? "");
          if (saved[i] === null) el.removeAttribute("style");
        });
      }
    }
    return { text, errorEls, excluded };
  }, NEEDLE_SCAN_EXCLUDE);
  const out = [];
  const hits = scanNeedles(snap.text, INLINE_ERROR_NEEDLES);
  // "refusing to" is the umbrella of the two specific refusals: name it only when neither specific one matched
  const specific = hits.some((h) => h.label === "refusing to mint" || h.label === "refusing to open");
  for (const h of hits) if (!(specific && h.label === "refusing to")) out.push(`text "${h.label}" (…${h.snippet}…)`);
  for (const e of snap.errorEls) out.push("element " + e);
  return out;
}

/** innerText length of <main> (the layout's content column); 0 when there is no <main> */
export async function mainTextLength(page) {
  return page.evaluate(() => {
    const m = document.querySelector("main");
    return m ? (m.innerText || "").trim().length : 0;
  });
}

/**
 * Wait for the in-browser device to boot on the current document and return its public info (anchor, rootId, fid,
 * personaIds, activePersonaId, restored, persistent). Throws with the device's own reason when boot fails, and with
 * a timeout otherwise — never resolves to a guess.
 */
export async function waitForDevice(page, timeoutMs = 90_000) {
  const attempt = () =>
    page.evaluate(
      (ms) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("the device did not boot within " + Math.round(ms / 1000) + " s")), ms);
          const wait = () => {
            const d = window.__layersDevice;
            if (!d) return setTimeout(wait, 100);
            d.ready.then(
              (info) => {
                clearTimeout(t);
                resolve(JSON.parse(JSON.stringify(info)));
              },
              (e) => {
                clearTimeout(t);
                reject(new Error("device boot failed: " + String(e && e.message ? e.message : e).slice(0, 240)));
              }
            );
          };
          wait();
        }),
      timeoutMs
    );
  try {
    return await attempt();
  } catch (e) {
    // a client-side redirect can replace the document under the evaluate; wait for the new one once, then retry
    if (!/Execution context was destroyed|navigation/i.test(String(e && e.message))) throw e;
    await page.waitForLoadState("load").catch(() => {});
    return attempt();
  }
}

/** the card testids a timeline renders (a cast, or one of the feed's own card kinds) */
export const TIMELINE_CARD_SELECTOR = [
  "cast",
  "readwise-card",
  "sent-card",
  "correction-card",
  "migration-card",
  "resurfaced-card",
  "private-card",
  "moved-card",
  "folder-card",
  "highlight-card",
]
  .map((t) => `main [data-testid="${t}"]`)
  .join(", ");

/**
 * Wait until the timeline on the current page shows at least one card, or a feed-error appears, or the time runs
 * out. Returns the card count; throws with the error's text (a feed-error is never "zero cards, fine").
 */
export async function waitForTimelineCards(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const err = await page.locator('[data-testid="feed-error"]').first();
    if ((await err.count()) && (await err.isVisible().catch(() => false))) {
      throw new Error("feed-error: " + ((await err.innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 240));
    }
    const n = await page.locator(TIMELINE_CARD_SELECTOR).count();
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 500));
  }
  const errs = await inlineErrors(page).catch(() => []);
  throw new Error("no timeline card rendered within " + Math.round(timeoutMs / 1000) + " s" + (errs.length ? " — " + errs.join("; ") : ""));
}
