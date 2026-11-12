"use client";
// iOS-grade settings IA chrome. Reuses X's existing tokens exactly: 53px
// header, #eff3f4 hairlines, 20px black headings, 15px rows, x-sec
// secondary text, chevron affordance.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BackArrow } from "../icons";
import { useApp } from "@/components/Providers";

export const SETTINGS_SECTIONS = [
  { href: "/settings/account", label: "Account & Personas", blurb: "Personas, display identity, linkage" },
  // PERSONA LAUNCH P2 (BYX G0): the archive import was reachable only by typing its address. Shown on every deployment:
  // the archive is read in this browser (nothing is uploaded) and saved sealed, on the rig and the public site alike.
  // Its testid is settings-link-import-x (SettingsNav derives it from the href).
  { href: "/settings/import-x", label: "Import from X", blurb: "Drop in the archive X gives you: find your X follows on Farcaster, keep your history" },
  // CONNECT MAIN (post-box set): the owner-service page that connects the owner's existing Farcaster account by QR.
  // Hidden on the public device like the developer row (SettingsNav): the route refuses there, so the row would be
  // navigation to a dead end.
  { href: "/settings/connect", label: "Connect your Farcaster account", blurb: "Post as your own account; approve once in the Farcaster app by QR" },
  { href: "/settings/modes", label: "Modes", blurb: "Ranking, filters, notifications, action buttons" },
  { href: "/settings/rules", label: "Rules & Filters", blurb: "Build rules, preview what they catch" },
  { href: "/settings/delivery", label: "Delivery", blurb: "Where each account shows up — per account, per mode" },
  { href: "/settings/readwise", label: "Readwise", blurb: "Cadence, chunk length, priority folders, the recycle bin" },
  { href: "/settings/feed-health", label: "Feed Health", blurb: "Readwise, sends, topic saturation, corrections" },
  { href: "/settings/privacy", label: "Privacy & Disclosure", blurb: "Who can see which persona links to which" },
  // PERSONA LAUNCH P4: rings ("top 16") — every deployment (the visitor's browser device holds and publishes its own rings)
  { href: "/settings/rings", label: "Rings", blurb: "Up to 16 rings of people who see which personas are you" },
  // PUBLIC GO-LIVE (the relay track): every visitor sees it; a non-moderator reads "You are not a moderator on this site." and the key to copy
  { href: "/settings/moderation", label: "Moderation", blurb: "Reported anonymous posts: keep or remove them, and your moderator key" },
  { href: "/settings/attestations", label: "Attestations", blurb: "Credentials, badges, tier graduation" },
  { href: "/settings/zk", label: "ZK privacy layer", blurb: "Commitment, epochs, anonymous channel, privacy conditions" },
  { href: "/settings/influence", label: "Influence", blurb: "Allowance, stakes, stewardship, the coordination view" },
  { href: "/settings/lenses", label: "Lenses", blurb: "The algo through different curves — preview, switch, share" },
  { href: "/settings/zones", label: "Scroll zones", blurb: "Draw where scrolling reads the article and where it moves the feed" },
  { href: "/settings/dm-hook", label: "DM to bookmark", blurb: "DM a link to @totem from your linked X account; it lands here" },
  { href: "/settings/porting", label: "Relationship porting", blurb: "Graduate someone from one of your personas to another — a grant here, a breadcrumb on X" },
  { href: "/settings/developer", label: "Developer", blurb: "Adapter registry, latency injection, seed reset" },
  { href: "/settings/experimental", label: "Experimental", blurb: "Prototype features — riskier, may change or disappear" },
  // HELP: the one row that leaves /settings. A next/link like every row (SettingsNav); /help is outside the app group
  // and starts no device, so the soft navigation keeps this tab's identity. Its testid is settings-link-help.
  { href: "/help", label: "Help & how it works", blurb: "What works today, the obvious questions, the words we use" },
];

export function SettingsHeader({ title, back }: { title: string; back?: string }) {
  const router = useRouter();
  return (
    <div className="sticky top-0 z-20 flex h-[53px] items-center bg-white/85 px-4 backdrop-blur-md">
      <button
        onClick={() => (back ? router.push(back) : router.back())}
        aria-label="Back"
        className="-ml-2 mr-5 flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-x-hover"
      >
        <BackArrow size={20} />
      </button>
      <h1 className="text-xl font-black leading-6">{title}</h1>
    </div>
  );
}

export function SettingsNav() {
  const pathname = usePathname();
  // PROD-LIVE: on a public deployment the developer pane's /api/dev controls refuse (no dev hooks), so the row is
  // navigation to a dead end — the page itself still renders an honest "not available" state if typed. The same for
  // the connect-main page (CONNECT MAIN): its route refuses on a public deployment and inside the browser device.
  const { deviceIsThePage } = useApp();
  const sections = SETTINGS_SECTIONS.filter((s) => !(deviceIsThePage && (s.href === "/settings/developer" || s.href === "/settings/connect")));
  return (
    <nav>
      {sections.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          data-testid={`settings-link-${section.href.split("/").pop()}`}
          className={`flex items-center justify-between border-b border-x-border px-4 py-3.5 transition-colors hover:bg-x-hover ${
            pathname === section.href ? "bg-[#f7f9f9]" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-[15px] leading-5">{section.label}</span>
            <span className="block truncate text-[13px] leading-4 text-x-sec">{section.blurb}</span>
          </span>
          <span className="ml-3 shrink-0 text-x-sec">›</span>
        </Link>
      ))}
    </nav>
  );
}

export function SettingsGroup({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="border-b border-x-border pb-2">
      <h2 className="px-4 pb-1 pt-4 text-[13px] font-bold uppercase tracking-wide text-x-sec">{title}</h2>
      {note && <p className="px-4 pb-2 text-[13px] leading-4 text-x-sec">{note}</p>}
      {children}
    </section>
  );
}

export function Row({
  label,
  sub,
  right,
  onClick,
  testid,
}: {
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  testid?: string;
}) {
  const inner = (
    <>
      <span className="min-w-0">
        <span className="block text-[15px] leading-5">{label}</span>
        {sub && <span className="block text-[13px] leading-4 text-x-sec">{sub}</span>}
      </span>
      <span className="ml-3 flex shrink-0 items-center">{right}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        data-testid={testid}
        onClick={onClick}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-x-hover"
      >
        {inner}
      </button>
    );
  }
  return (
    <div data-testid={testid} className="flex items-center justify-between px-4 py-3">
      {inner}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  busy,
  testid,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  testid?: string;
}) {
  return (
    <button
      data-testid={testid}
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${
        on ? "bg-x-blue" : "bg-[#cfd9de]"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-transform ${
          on ? "translate-x-[20px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

export function ErrorNote({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div data-testid="settings-error" className="mx-4 my-3 rounded-2xl border border-[#fdc9ce] bg-[#f4212e0d] p-3">
      <p className="text-[15px] leading-5 text-[#f4212e]">Something went wrong. {error}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white">
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div data-testid="settings-loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center justify-between border-b border-x-border px-4 py-3.5">
          <div className="w-full">
            <div className="skeleton h-3.5 w-40 rounded-full" />
            <div className="skeleton mt-2 h-3 w-64 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
