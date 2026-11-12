"use client";
// PUBLIC PREVIEW Gate 1 (run as BROWSER KEYSTORE PASS Gate 6) — the preview banner carried into the app itself.
//
// It names the CURRENT privacy-label state, and the state is computed, never a constant: the banner asks the
// device that runs in this page for `privacyConditions` (lib/zk/privacy.ts, the eight-plus machine-checked
// conditions) and renders what came back. A label that could not be computed is shown as NOT private — the
// banner never fails open into a claim. Dismissible per session (sessionStorage), because the prompt asks for a
// dismissible strip; the in-app zk label (components/zk/PrivacyLabel.tsx) stays non-dismissable by design.
//
// PROD-LIVE (mobile): at 390 px the sentence, the link and the "Hide for this session" button wrapped to three or four
// lines and, with the unsaved-identity nudge under it, took about a quarter of the screen. Below `sm` the strip is ONE
// line: the same computed label, shortened ("DEMO — not yet private · 5/9 fail"), a "why?" link and a ×.
// The LABEL never shortens away — DEMO / NOT private / the private label are in the short line too — and from `sm` up
// the text is the full sentence, unchanged (accept-cu6 check 3 reads the banner's innerText at a desktop width, where
// the short copy is display:none and so absent from innerText). The hide button keeps its aria-label at every width.
//
// PROD-LIVE (late boot): a device that boots AFTER loadDevice.ts's 90 s deadline answered this banner's read with a
// 503, which is "unknown" — correctly NOT private, but stale once the device answers. When the device announces
// "ready" and the label is "unknown", it is computed again (computing → demo/private), so a slow boot does not pin
// the banner on a state the device can now answer.
//
// PERSONA LAUNCH wave 3 (final verify): the label is also computed again on every prefetch tick of this document's
// device (lib/device/bootState.ts ZK_TICK_EVENT): since UXH-2 the first tick lands seconds after boot, and a label
// computed once before it kept a failing count the device no longer held (accept-cu6 check 3, scripts/unit-prover T1).
//
// FC-READ (SECURITY-POSTURE.md §19, A-FCREAD-OPERATOR-SEES-READS): when the device runs in relay mode, live Farcaster
// posts are read THROUGH the preview's server, which then sees what is read, from which address and when — metadata
// the app server never saw before. The DEMO label would be dishonest by omission without saying so, so the banner
// appends a fixed disclosure whenever relay reads are on. It is a disclosure, not a privacy CONDITION: the failing
// count stays exactly the device's own `privacyConditions` verdict (accept-cu6 check 3 compares the two), and the
// sentence carries no digit, so "N of M privacy conditions fail" still parses unambiguously. Relay mode is read from
// the SAME object the device bundle captured its env from (`__LAYERS_DEVICE_ENV.FC_READ_RELAY`), or from the
// `relayReads` prop when the layout passes its per-request hint; either one saying "on" shows the disclosure (it
// fails toward disclosing). The sentence avoids the page-health needle words.
//
// PUBLIC GO-LIVE (public live mode, lib/platform/publicLive.ts; the layout passes live): the label stays COMPUTED, word
// for word the device's verdict (DEMO with its count, or the private label — never a constant, never stronger), but the
// "Preview —" lead and the "on this deployment" tail go: in live mode this is the product, honestly labelled, not a
// preview for testing. The count still reads "N of M privacy conditions fail" (accept-cu6 check 3's parse holds).
import { useEffect, useRef, useState } from "react";
import { DEVICE_EVENT, ZK_TICK_EVENT, type DeviceEventDetail } from "@/lib/device/bootState";

/** FC-READ: the fixed disclosures, full (desktop sentence) and short (the one-line phone strip) */
const RELAY_DISCLOSURE = "Farcaster reads are relayed through our server, which sees what is read.";
const RELAY_DISCLOSURE_SHORT = "reads relayed";

/** FC-READ: true when the device environment this page booted with declares relay reads (never throws) */
function relayDeclaredByDevice(): boolean {
  try {
    const env = (window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string> }).__LAYERS_DEVICE_ENV;
    return env?.FC_READ_RELAY === "on";
  } catch {
    return false;
  }
}

interface Verdict {
  private: boolean;
  label: string;
  conditions: { key: string; ok: boolean; detail: string }[];
  failing: string[];
}
type State = "computing" | "demo" | "private" | "unknown";

const KEY = "layers-preview-banner";

export function PreviewBanner({
  docsUrl = "",
  postureHref = "/help#privacy",
  relayReads = false,
  live = false,
}: { docsUrl?: string; postureHref?: string; relayReads?: boolean; live?: boolean } = {}) {
  const [verdict, setVerdict] = useState<Verdict | "error" | null>(null);
  const [hidden, setHidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // FC-READ: only the prop on the server render and the first client render (no window to read there, and the two
  // must match for hydration), then re-read on mount, on every device event and whenever the verdict lands — the
  // device env is set by DeviceHostMount's boot, which may finish after this banner mounts
  const [relay, setRelay] = useState(relayReads);
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;
  void docsUrl; // kept in the signature for the layout's call; the link below always opens a new tab now

  useEffect(() => {
    setRelay(relayReads || relayDeclaredByDevice());
  }, [relayReads, verdict]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "dismissed") setHidden(true);
    } catch {
      /* storage unavailable: the banner simply shows */
    }
    const onDevice = (e: Event) => {
      const detail = (e as CustomEvent<DeviceEventDetail>).detail;
      if (relayDeclaredByDevice()) setRelay(true);
      if (detail && detail.state === "ready" && verdictRef.current === "error") {
        setVerdict(null);
        setAttempt((a) => a + 1);
      }
    };
    // PERSONA LAUNCH wave 3 (final verify): a tick changed what the device holds (the first one now lands seconds after
    // boot, from the composer's first read) — compute the label again. The old verdict stays on screen until the new one
    // arrives (no flash of "computing"); a banner still computing is left to its own read.
    const onTick = () => {
      if (verdictRef.current !== null) setAttempt((a) => a + 1);
    };
    window.addEventListener(DEVICE_EVENT, onDevice);
    window.addEventListener(ZK_TICK_EVENT, onTick);
    return () => {
      window.removeEventListener(DEVICE_EVENT, onDevice);
      window.removeEventListener(ZK_TICK_EVENT, onTick);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // answered by the browser device (the fetch patch), which holds the root the conditions are computed on
    fetch("/api/zk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "privacyConditions" }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("privacy label: " + r.status))))
      .then((j: Verdict) => {
        if (alive) setVerdict(typeof j?.private === "boolean" && Array.isArray(j.conditions) ? j : "error");
      })
      .catch(() => {
        if (alive) setVerdict("error");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (hidden) return null;
  const state: State = verdict === null ? "computing" : verdict === "error" ? "unknown" : verdict.private ? "private" : "demo";
  const failing = verdict && verdict !== "error" ? verdict.conditions.filter((c) => !c.ok).length : 0;
  const total = verdict && verdict !== "error" ? verdict.conditions.length : 0;
  const label = live
    ? state === "computing"
      ? "Computing the privacy label for this device…"
      : state === "unknown"
        ? "The privacy label could not be computed; treat this as NOT private."
        : state === "private"
          ? (verdict as Verdict).label + "."
          : `DEMO, not yet private: ${failing} of ${total} privacy conditions fail here. Nothing here is a guarantee.`
    : state === "computing"
      ? "Preview — computing the privacy label for this device…"
      : state === "unknown"
        ? "Preview — the privacy label could not be computed; treat this as NOT private."
        : state === "private"
          ? "Preview — " + (verdict as Verdict).label + "."
          : `Preview — DEMO, not yet private: ${failing} of ${total} privacy conditions fail on this deployment. Nothing here is a guarantee.`;
  // FC-READ: the disclosure follows the label, never replaces or precedes it (the label stays the first words)
  const text = relay ? label + " " + RELAY_DISCLOSURE : label;
  // the phone line: short enough to fit un-truncated at 360 px, and the label always first (the landing's own wording).
  // FC-READ: the relay marker goes last, so a narrow screen truncates the marker before it ever truncates the label;
  // the full sentence (with the disclosure) is always in the title and the screen-reader copy.
  const shortLabel =
    state === "computing"
      ? "Computing the privacy label…"
      : state === "unknown"
        ? "Label unknown — NOT private"
        : state === "private"
          ? (verdict as Verdict).label
          : `DEMO — not yet private · ${failing}/${total} fail`;
  const short = relay ? shortLabel + " · " + RELAY_DISCLOSURE_SHORT : shortLabel;
  const tone = state === "private" ? "text-x-green bg-[#00ba7c0d]" : state === "computing" ? "text-x-sec bg-[#eff3f4]" : "text-[#f4212e] bg-[#f4212e0d]";
  return (
    <div
      data-testid="preview-banner"
      data-state={state}
      data-mode={live ? "live" : undefined}
      data-reads={relay ? "relayed" : "local"}
      role="status"
      aria-live="polite"
      title={text}
      className={"flex items-center gap-2 border-b border-x-border px-4 py-1.5 text-[13px] leading-4 sm:gap-3 sm:py-2 " + tone}
    >
      <span className="min-w-0 font-bold">
        <span className="block truncate sm:hidden">
          {short}
          <span className="sr-only"> ({text})</span>
        </span>
        <span className="hidden sm:inline">{text}</span>
      </span>
      {/* PROD-LIVE: always a NEW tab, so this tab's identity stays where it is (a full load here would wipe an
          unsaved one). DOCS UNDER APP: the href is the docs' privacy page, /docs/privacy/ (lib/platform/preview.ts
          postureUrl), which every deployment now serves; HELP's /help#privacy is only the fallback for an empty docs
          url. Neither the docs nor /help starts a device, so the new tab mints no second identity and shows no save
          nag: it is a page to read. */}
      <a href={postureHref} target="_blank" rel="noreferrer" className="shrink-0 underline text-x-sec hover:text-x-text">
        <span className="sm:hidden">why?</span>
        <span className="hidden sm:inline">what this means</span>
      </a>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, "dismissed");
          } catch {
            /* nothing to remember in */
          }
          setHidden(true);
        }}
        className="ml-auto shrink-0 rounded-full px-2 text-[15px] leading-4 text-x-text hover:bg-x-hover sm:border sm:border-x-border-dark sm:px-3 sm:py-0.5 sm:text-[12px] sm:font-bold"
        aria-label={live ? "Hide the privacy label for this session" : "Hide the preview banner for this session"}
      >
        <span aria-hidden className="sm:hidden">
          ×
        </span>
        <span className="hidden sm:inline">Hide for this session</span>
      </button>
    </div>
  );
}
