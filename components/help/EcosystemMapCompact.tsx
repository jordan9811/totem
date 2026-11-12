// The Help page's small map: X on top, Totem in the middle, Farcaster at the bottom, and the arrows that matter
// between them. It is the compact cousin of the docs site's big map (docs/public/diagrams/ecosystem-map.svg), drawn
// again here as inline SVG because the app's code never reads anything from docs/ (D-CU-6; DOCS UNDER APP serves the
// BUILT docs at /docs, the big map included, but no app module imports from docs/).
//
// Honesty rules, the same as the rest of the Help page:
//   * every arrow's status is read from lib/status/features.ts for the reader's own site, so this picture can never
//     promise more than the status list below it does. The one arrow with no row of its own (re-posting an imported
//     tweet to Farcaster) is "soon" at best, and "na" wherever posting to Farcaster is not offered at all;
//   * a feature id the status file no longer has renders as "soon", the closed direction: missing means not working;
//   * the status is never colour alone: each dot's outline style differs, and the list under the picture writes every
//     status out in the legend's own words.
//
// No hooks, no browser APIs, no server imports: it renders the same in a server or a client component. Light only,
// like the rest of the app. Its chips use their own test id (eco-chip), so the Help page's chip checks
// (scripts/accept-help.mjs) neither count nor constrain them.
import { featureById, legendOf, type StatusId, type SurfaceId } from "@/lib/status/features";
import { StatusChip } from "./StatusChip";

type Zone = "x" | "layers" | "farcaster";

interface ArrowDef {
  n: number;
  /** the row in lib/status/features.ts this arrow takes its status from; absent for the one derived arrow */
  feature?: string;
  /** PERSONA LAUNCH P7: on the public site this arrow's DESTINATION is not reached even on test data (an anonymous post
   *  made there stays inside the preview), so there the arrow shows this instead of its row's status. Never more than the
   *  row: a row that is "na" on the public site stays "na". */
  publicCap?: { status: StatusId; note: string };
  title: string;
  /** what the arrow does, in one plain line */
  what: string;
  from: Zone;
  to: Zone;
  /** both ways (the paid X features read from X and write to it) */
  both?: boolean;
}

const ARROWS: readonly ArrowDef[] = [
  // PERSONA LAUNCH P2 (BYX): arrows 1 to 3 take their status from the rows like every arrow; their words now say what
  // Bring your X v1 does (the Farcaster-verified badge, the archive read in the browser, matching on the device).
  { n: 1, feature: "x-link", title: "Link your X account", what: "“X @handle, verified on Farcaster”, read from the verification a persona's own Farcaster account made. A typed handle is only a test link.", from: "x", to: "layers" },
  {
    n: 2,
    feature: "x-archive",
    title: "Import your X archive",
    what: "Your browser reads the ZIP or its folder; your posts land on a “From X” shelf in Totem with their original dates. Nothing is called from X.",
    from: "x",
    to: "layers",
  },
  {
    n: 3,
    feature: "x-find-people",
    title: "Find your X follows on Farcaster",
    what: "Matched on your device against a list of Farcaster-verified X accounts. Following them from Totem comes later.",
    from: "x",
    to: "farcaster",
  },
  {
    n: 4,
    title: "Re-post a tweet to Farcaster",
    what: "One at a time, dated today and labelled “originally on X” with the tweet's own date. A cast Totem sends is dated when it goes out, so the old date stays in Totem.",
    from: "layers",
    to: "farcaster",
  },
  {
    n: 5,
    feature: "persona-accounts",
    title: "A persona posts as its own account",
    what: "Each public persona gets a real Farcaster account with its own name.",
    from: "layers",
    to: "farcaster",
  },
  {
    n: 6,
    feature: "anon-account",
    title: "Post anonymously",
    what: "A persona posts through @anon: a membership proof, a random wait, then one shared account with no name on it. Up to 4 every 6 hours per person.",
    from: "layers",
    to: "farcaster",
    publicCap: {
      status: "soon",
      note: "Anonymous posting to Farcaster isn't on this preview yet. Anonymous posts made here (built, test data only, not deployed yet) stay inside the preview.",
    },
  },
  { n: 7, feature: "live-reads", title: "Read real Farcaster posts", what: "Read-only, through your own feed rules.", from: "farcaster", to: "layers" },
  {
    n: 8,
    feature: "x-paid",
    title: "Post to X, sync from X",
    what: "Needs a paid X developer account, so it waits for the owner's yes.",
    from: "layers",
    to: "x",
    both: true,
  },
];

/** the status an arrow shows on this site: its row's, or, for the derived arrow, never more than "soon" */
function statusOf(a: ArrowDef, surface: SurfaceId): { status: StatusId; note: string } {
  if (a.feature) {
    const f = featureById(a.feature);
    if (!f) return { status: "soon", note: "Not in the status list, so treated as not working yet." };
    if (surface === "public" && a.publicCap && f.status.public !== "na") return { status: a.publicCap.status, note: a.publicCap.note };
    return { status: f.status[surface], note: f.notes[surface] };
  }
  // n 4: re-posting needs posting to Farcaster, and is not built itself
  const post = featureById("post-to-farcaster");
  if (post && post.status[surface] === "na") return { status: "na", note: "Not offered on this site." };
  return { status: "soon", note: "Not built. The history shelf it would post from has only run on test data so far." };
}

// The app's own status colours (StatusChip's palette), as SVG paint, plus a line style per status.
const DOT: Record<StatusId, { fill: string; stroke: string; dash?: string; ink: string }> = {
  live: { fill: "#00ba7c26", stroke: "#00ba7c", ink: "#0f1419" },
  fixture: { fill: "#ffd40040", stroke: "#b38f00", ink: "#0f1419" },
  off: { fill: "#eff3f4", stroke: "#8b98a5", ink: "#0f1419" },
  designed: { fill: "#7856ff14", stroke: "#7856ff", dash: "1.5 2.5", ink: "#0f1419" },
  soon: { fill: "#1d9bf014", stroke: "#1d9bf0", dash: "3 2.5", ink: "#0f1419" },
  na: { fill: "none", stroke: "#cfd9de", dash: "2 2.5", ink: "#8b98a5" },
};
const LINE: Record<StatusId, { stroke: string; dash?: string }> = {
  live: { stroke: "#536471" },
  fixture: { stroke: "#536471" },
  off: { stroke: "#536471" },
  designed: { stroke: "#536471", dash: "5 4" },
  soon: { stroke: "#536471", dash: "5 4" },
  na: { stroke: "#cfd9de", dash: "1.5 4" },
};

// Where each zone band sits in the picture (viewBox 360 x 452), and where each arrow crosses the gaps.
const BAND = { x: { top: 8, bottom: 72 }, layers: { top: 140, bottom: 264 }, farcaster: { top: 338, bottom: 444 } } as const;
const UPPER_X: Record<number, number> = { 1: 52, 2: 124, 3: 196, 8: 300 }; // X <-> Totem
const LOWER_X: Record<number, number> = { 7: 40, 4: 110, 3: 196, 5: 262, 6: 322 }; // Totem <-> Farcaster

function Dot({ x, y, n, status }: { x: number; y: number; n: number; status: StatusId }) {
  const d = DOT[status];
  return (
    <g>
      <circle cx={x} cy={y} r={10.5} fill={d.fill} stroke={d.stroke} strokeWidth={1.8} strokeDasharray={d.dash} />
      <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={11.5} fontWeight={700} fill={d.ink}>
        {n}
      </text>
    </g>
  );
}

/** a vertical arrow in one gap, broken around its number so the line never runs through it */
function GapArrow({ x, top, bottom, n, status, down, both }: { x: number; top: number; bottom: number; n: number; status: StatusId; down: boolean; both?: boolean }) {
  const l = LINE[status];
  const mid = (top + bottom) / 2;
  const head = status === "na" ? "url(#eco-ah-faint)" : "url(#eco-ah)";
  const start = down ? top + 4 : bottom - 4; // the end it leaves from
  const end = down ? bottom - 4 : top + 4; // the end it points at
  const beforeDot = down ? mid - 13 : mid + 13;
  const afterDot = down ? mid + 13 : mid - 13;
  const seg = (from: number, to: number, withHead: boolean) => (
    <path d={`M${x} ${from}V${to}`} fill="none" stroke={l.stroke} strokeWidth={1.8} strokeDasharray={l.dash} markerEnd={withHead ? head : undefined} />
  );
  return (
    <g>
      {/* both ways: the first half is drawn from the dot outwards, so it carries a head too */}
      {both ? seg(beforeDot, start, true) : seg(start, beforeDot, false)}
      {seg(afterDot, end, true)}
      <Dot x={x} y={mid} n={n} status={status} />
    </g>
  );
}

function Pill({ x, y, w, label, tone }: { x: number; y: number; w: number; label: string; tone: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={22} rx={11} fill="#ffffff" stroke={tone} strokeOpacity={0.45} />
      <text x={x + w / 2} y={y + 11} dy="0.35em" textAnchor="middle" fontSize={11.5} fill="currentColor">
        {label}
      </text>
    </g>
  );
}

const SLATE = "#536471";
const BLUE = "#1d9bf0";
const PURPLE = "#7856ff";

export function EcosystemMapCompact({ surface }: { surface: SurfaceId }) {
  const rows = ARROWS.map((a) => ({ ...a, ...statusOf(a, surface) }));
  const byN = new Map(rows.map((r) => [r.n, r]));
  const summary =
    "A map in three bands. X at the top: your posts, follows and archive. Totem in the middle: your root, personas, history shelf, feed rules, readwise, private posts and the anon composer. Farcaster at the bottom: persona accounts, the anon account and public casts. " +
    rows.map((r) => `Arrow ${r.n}, ${r.title}: ${legendOf(r.status).label}.`).join(" ");

  const upper = [1, 2, 3, 8].map((n) => {
    const r = byN.get(n)!;
    // X -> Totem points down; the paid features point both ways
    return <GapArrow key={"u" + n} x={UPPER_X[n]} top={BAND.x.bottom} bottom={BAND.layers.top} n={n} status={r.status} down={r.from === "x"} both={r.both} />;
  });
  const lower = [7, 4, 3, 5, 6].map((n) => {
    const r = byN.get(n)!;
    // Totem -> Farcaster points down; reading real posts points up. Arrow 3 continues from the X gap: matched in
    // Totem, followed on Farcaster.
    const down = r.to === "farcaster";
    return <GapArrow key={"l" + n} x={LOWER_X[n]} top={BAND.layers.bottom} bottom={BAND.farcaster.top} n={n} status={r.status} down={down} />;
  });

  return (
    <figure className="mt-6" data-testid="eco-map" data-surface={surface} aria-labelledby="eco-map-caption">
      <div className="mx-auto w-full max-w-[460px]">
        <svg viewBox="0 0 360 452" className="block h-auto w-full text-x-text" role="img" aria-label={summary}>
          <defs>
            <marker id="eco-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5 0 10z" fill={SLATE} />
            </marker>
            <marker id="eco-ah-faint" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5 0 10z" fill="#cfd9de" />
            </marker>
          </defs>

          {/* X */}
          <rect x={8} y={BAND.x.top} width={344} height={BAND.x.bottom - BAND.x.top} rx={14} fill={SLATE} fillOpacity={0.07} stroke={SLATE} strokeOpacity={0.35} />
          <path d="M22 22l12 14M34 22L22 36" fill="none" stroke={SLATE} strokeWidth={2} strokeLinecap="round" />
          <text x={44} y={34} fontSize={15} fontWeight={700} fill="currentColor">
            X
          </text>
          <text x={22} y={58} fontSize={12.5} fill={SLATE}>
            your posts, your follows, the archive X gives you
          </text>

          {/* Totem */}
          <rect x={8} y={BAND.layers.top} width={344} height={BAND.layers.bottom - BAND.layers.top} rx={14} fill={BLUE} fillOpacity={0.06} stroke={BLUE} strokeOpacity={0.45} />
          <g fill="none" stroke={BLUE} strokeWidth={1.8} strokeLinejoin="round">
            <path d="M28 151l8 4.5-8 4.5-8-4.5z" />
            <path d="M20 159.5l8 4.5 8-4.5" />
            <path d="M20 163.5l8 4.5 8-4.5" />
          </g>
          <text x={44} y={164} fontSize={15} fontWeight={700} fill="currentColor">
            Totem
          </text>
          <text x={22} y={188} fontSize={12.5} fill={SLATE}>
            your private side: one root, many personas
          </text>
          <Pill x={20} y={200} w={72} label="your root" tone={BLUE} />
          <Pill x={98} y={200} w={74} label="personas" tone={BLUE} />
          <Pill x={178} y={200} w={78} label="X shelf" tone={BLUE} />
          <Pill x={262} y={200} w={78} label="feed rules" tone={BLUE} />
          <Pill x={20} y={230} w={74} label="readwise" tone={BLUE} />
          <Pill x={100} y={230} w={104} label="anon composer" tone={BLUE} />
          <Pill x={210} y={230} w={98} label="private posts" tone={BLUE} />

          {/* Farcaster */}
          <rect x={8} y={BAND.farcaster.top} width={344} height={BAND.farcaster.bottom - BAND.farcaster.top} rx={14} fill={PURPLE} fillOpacity={0.06} stroke={PURPLE} strokeOpacity={0.45} />
          <path d="M21 364v-13h14v13h-3.6v-4.6a3.4 3.4 0 0 0-6.8 0V364z" fill="none" stroke={PURPLE} strokeWidth={1.8} strokeLinejoin="round" />
          <text x={44} y={362} fontSize={15} fontWeight={700} fill="currentColor">
            Farcaster
          </text>
          <text x={22} y={386} fontSize={12.5} fill={SLATE}>
            the public network: any app can read it
          </text>
          <Pill x={20} y={402} w={114} label="persona accounts" tone={PURPLE} />
          <Pill x={140} y={402} w={104} label="the anon account" tone={PURPLE} />
          <Pill x={250} y={402} w={90} label="public casts" tone={PURPLE} />

          {upper}
          {lower}
        </svg>
      </div>

      <figcaption id="eco-map-caption" className="mt-3 text-[14px] leading-5 text-x-sec">
        How Totem sits between X and Farcaster. Solid lines are built, dashed lines are not built yet, and each number&apos;s status on this site is
        written out below.
      </figcaption>

      <ol className="mt-4 flex flex-col gap-3" aria-label="The arrows on the map, and how real each one is on this site">
        {rows.map((r) => (
          <li key={r.n} className="flex gap-3" data-testid="eco-arrow" data-arrow={r.n} data-feature={r.feature ?? "derived"} data-status={r.status}>
            <svg viewBox="0 0 24 24" className="mt-[1px] h-6 w-6 shrink-0" aria-hidden="true">
              <circle cx={12} cy={12} r={10.5} fill={DOT[r.status].fill} stroke={DOT[r.status].stroke} strokeWidth={1.8} strokeDasharray={DOT[r.status].dash} />
              <text x={12} y={12} dy="0.35em" textAnchor="middle" fontSize={11.5} fontWeight={700} fill={DOT[r.status].ink}>
                {r.n}
              </text>
            </svg>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-bold leading-5">
                <span>{r.title}</span>
                <StatusChip status={r.status} surface={surface} testid="eco-chip" />
              </p>
              <p className="mt-1 text-[14px] leading-5 text-x-sec">{r.what}</p>
              <p className="mt-1 text-[14px] leading-5 text-x-sec">
                <span className="font-semibold text-x-text">On this site: </span>
                {r.note}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
