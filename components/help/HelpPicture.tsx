// The Help page's two pictures, both plain HTML lists so they read as lists with the styles off (the Salvo flow
// pattern): across on a wide screen, down on a phone, so the text never shrinks to fit.
//   * ThreePanels: one private you, many personas, posting to Farcaster. Each panel's chip is that capability's status
//     on the reader's site, read from lib/status/features.ts, so the picture cannot promise more than the list does.
//   * AtAGlance: the five steps a new user takes, with the one that bites (saving) outlined and an unbuilt one dashed
//     (none since PERSONA LAUNCH wave 2: rings, step 4, are built on test data; the `soon` flag stays for the next one).
// Drawings are inline SVG in currentColor and the app's own colours; nothing is fetched.
import type { ReactNode } from "react";
import { featureById, type SurfaceId } from "@/lib/status/features";
import { StatusChip } from "./StatusChip";

/** an arrow to the next item: across from `sm` up, down below it (decorative; the list order carries the meaning) */
function Arrow({ gap = 26 }: { gap?: number }) {
  return (
    <>
      <span aria-hidden style={{ right: -(gap / 2 + 6) }} className="pointer-events-none absolute top-1/2 hidden -translate-y-1/2 text-[15px] text-[#8b98a5] sm:block">
        →
      </span>
      <span aria-hidden className="pointer-events-none absolute -bottom-[21px] left-1/2 -translate-x-1/2 text-[15px] text-[#8b98a5] sm:hidden">
        ↓
      </span>
    </>
  );
}

function RootDrawing() {
  return (
    <svg viewBox="0 0 180 96" className="h-[84px] w-full text-x-text" role="img" aria-label="A key inside a phone: one root identity on your device">
      <rect x="66" y="6" width="48" height="84" rx="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M84 82h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <g className="text-x-blue">
        <circle cx="90" cy="44" r="17" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2" />
        <circle cx="84" cy="44" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M89 44h11m-3 0v5m-4-5v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function PersonasDrawing() {
  const personas: { y: number; label: string; tint: string }[] = [
    { y: 18, label: "main", tint: "#1d9bf0" },
    { y: 48, label: "finsta", tint: "#f91880" },
    { y: 78, label: "alt", tint: "#00ba7c" },
  ];
  return (
    <svg viewBox="0 0 180 96" className="h-[84px] w-full text-x-text" role="img" aria-label="One root branching into three personas: main, finsta and alt">
      {personas.map((p) => (
        <path key={p.label} d={`M38 48 C 64 48, 70 ${p.y}, 96 ${p.y}`} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
      ))}
      <g className="text-x-blue">
        <circle cx="28" cy="48" r="11" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2" />
      </g>
      {personas.map((p) => (
        <g key={p.label}>
          <circle cx="107" cy={p.y} r="11" fill={p.tint} fillOpacity="0.16" stroke={p.tint} strokeWidth="2" />
          <circle cx="107" cy={p.y - 3} r="3.2" fill={p.tint} />
          <path d={`M101 ${p.y + 6} a6 5 0 0 1 12 0`} fill={p.tint} />
          <text x="124" y={p.y + 4} fontSize="12" fill="currentColor">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function FarcasterDrawing() {
  return (
    <svg viewBox="0 0 180 96" className="h-[84px] w-full text-x-text" role="img" aria-label="A persona's post on its way to Farcaster, drawn dashed because it is not finished">
      <circle cx="30" cy="48" r="11" fill="#f91880" fillOpacity="0.16" stroke="#f91880" strokeWidth="2" />
      <circle cx="30" cy="45" r="3.2" fill="#f91880" />
      <path d="M24 54 a6 5 0 0 1 12 0" fill="#f91880" />
      <path d="M48 48h56" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
      <path d="M100 42l7 6-7 6" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* a simple arch, for Farcaster */}
      <g className="text-[#7856ff]">
        <path d="M120 72V30h40v42h-9V54a11 11 0 0 0-22 0v18z" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const PANELS: { id: string; title: string; caption: string; drawing: ReactNode; feature: string }[] = [
  {
    id: "you",
    title: "One private you",
    caption: "One root identity holds everything. On the public site it lives in your browser: save it with Face ID or a passkey, or it goes when the tab closes or reloads.",
    drawing: <RootDrawing />,
    feature: "identity",
  },
  {
    id: "personas",
    title: "Many personas",
    caption: "Your main, a finsta, alts. Every persona is made from the one root.",
    drawing: <PersonasDrawing />,
    feature: "personas",
  },
  {
    id: "farcaster",
    title: "Posting to Farcaster",
    caption: "Planned: each persona posts as its own Farcaster account. Today posts stay inside Totem; the chip says how far along this is.",
    drawing: <FarcasterDrawing />,
    feature: "post-to-farcaster",
  },
];

export function ThreePanels({ surface }: { surface: SurfaceId }) {
  return (
    <ol className="mt-6 flex flex-col gap-[26px] sm:flex-row sm:gap-[30px]" data-testid="help-picture" aria-label="How Totem fits together, in three pictures">
      {PANELS.map((p, i) => {
        const f = featureById(p.feature);
        return (
          <li key={p.id} className="relative flex min-w-0 flex-1 flex-col rounded-2xl border border-x-border bg-[#f7f9f9] p-3" data-testid="help-panel" data-panel={p.id} data-feature={p.feature}>
            {p.drawing}
            <p className="mt-2 text-[15px] font-bold leading-5">{p.title}</p>
            <p className="mt-1 flex-1 text-[14px] leading-5 text-x-sec">{p.caption}</p>
            {f ? (
              <p className="mt-2">
                <StatusChip status={f.status[surface]} surface={surface} testid="picture-chip" />
              </p>
            ) : null}
            {i < PANELS.length - 1 ? <Arrow gap={30} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

const STEPS: { title: string; body: string; key?: boolean; soon?: boolean }[] = [
  { title: "Open the app", body: "A private root identity is made in your browser, with two personas to start." },
  { title: "Save it", body: "Face ID, a fingerprint or a passkey; the 24 words are the backup. Unsaved, it goes when the tab closes or reloads.", key: true },
  { title: "Make personas", body: "Your main, a finsta, alts, all from the one root. Signing in with Farcaster adds your own account, read-only." },
  { title: "Pick who sees what", body: "Rings decide who sees which persona. Built, test data only; deployed on 12 October 2026, not yet used." },
  { title: "Post", body: "Inside Totem today. Farcaster is coming." },
];

export function AtAGlance() {
  return (
    <>
      <ol className="mt-4 flex flex-col gap-[22px] sm:flex-row sm:gap-[22px]" data-testid="help-flow">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={
              "relative min-w-0 flex-1 rounded-[10px] border bg-[#f7f9f9] px-3 py-3 text-[14px] leading-[1.45] text-x-sec sm:text-[13px] " +
              (s.key ? "border-x-blue" : s.soon ? "border-dashed border-x-border-dark" : "border-x-border-dark")
            }
          >
            <strong className="mb-1 block text-x-text">{s.title}</strong>
            {s.body}
            {i < STEPS.length - 1 ? <Arrow gap={22} /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[14px] leading-5 text-x-sec">
        The outlined step is the one that catches people out. Step 4 is built on test data only, deployed on 12 October 2026 and not yet used, and step 5 reaches only Totem so far; the list below says exactly how far.
      </p>
    </>
  );
}
