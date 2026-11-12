import { SearchBox } from "./SearchBox";
import Link from "next/link";
import type { LiveItem, NewsItem, Trend, User } from "@/lib/types";
import { KebabIcon, SearchIcon, VerifiedBadge } from "./icons";
import { FollowButton } from "./FollowButton";

export function SearchPill() {
  return (
    <div className="sticky top-0 z-10 bg-white py-1">
      <SearchBox />
    </div>
  );
}

export function Card({ title, children, footer }: { title: string; children: React.ReactNode; footer?: string }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-x-border bg-white">
      <h2 className="px-4 py-3 text-xl font-black leading-6">{title}</h2>
      {children}
      {footer && (
        <Link href="#" className="block px-4 py-4 text-[15px] text-x-blue hover:bg-x-hover">
          {footer}
        </Link>
      )}
    </div>
  );
}

export function LiveOnXCard({ items }: { items: LiveItem[] }) {
  return (
    <Card title="Live on X">
      {items.map((item, i) => (
        <div key={i} className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-x-hover">
          <div className="min-w-0 pr-3">
            {item.host && (
              <p className="flex items-center text-[13px] leading-4 text-x-text">
                <img src={item.avatars[0]} alt="" className="mr-1 h-4 w-4 rounded-full object-cover" />
                <span className="font-bold">{item.host}</span>
                {item.verified && <VerifiedBadge size={14} className="mx-0.5" />}
                <span className="text-x-sec">{item.action}</span>
              </p>
            )}
            <p className="clamp-2 mt-0.5 text-[15px] font-bold leading-5">{item.title}</p>
          </div>
          <div
            className={`flex shrink-0 items-center rounded-full border-2 bg-white py-[1px] pl-[2px] pr-2 ${
              i % 2 === 0 ? "border-[#f91880]" : "border-[#7856ff]"
            }`}
          >
            <span className="flex -space-x-1.5">
              {item.avatars.slice(0, 3).map((a, j) => (
                <img key={j} src={a} alt="" className="h-5 w-5 rounded-full border border-white object-cover" />
              ))}
            </span>
            <span className="ml-1 text-[13px] text-x-text">{item.viewers}</span>
          </div>
        </div>
      ))}
      <div className="pb-2" />
    </Card>
  );
}

export function NewsCard({ items }: { items: NewsItem[] }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-x-border bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xl font-black leading-6">Today&rsquo;s News</h2>
        <button className="rounded-full p-1 text-x-text hover:bg-x-hover">
          <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="currentColor">
            <path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" />
          </svg>
        </button>
      </div>
      {items.map((n, i) => (
        <div key={i} className="cursor-pointer px-4 py-2.5 hover:bg-x-hover">
          <p className="clamp-2 text-[15px] font-bold leading-5">{n.title}</p>
          <div className="mt-1 flex items-center">
            <span className="flex -space-x-1.5">
              {n.avatars.map((a, j) => (
                <img key={j} src={a} alt="" className="h-4 w-4 rounded-full border border-white object-cover" />
              ))}
            </span>
            <span className="ml-1.5 text-[13px] leading-4 text-x-sec">{n.meta}</span>
          </div>
        </div>
      ))}
      <div className="pb-2" />
    </div>
  );
}

export function TrendsCard({ trends }: { trends: Trend[] }) {
  return (
    <Card title="What’s happening" footer="Show more">
      {trends.map((t, i) =>
        t.kind === "promoted" ? (
          <div key={i} className="cursor-pointer px-4 py-2.5 hover:bg-x-hover">
            <p className="text-[15px] font-bold leading-5">{t.title}</p>
            <p className="text-[13px] leading-4 text-x-sec">{t.sub}</p>
            <p className="mt-0.5 flex items-center text-[13px] leading-4 text-x-sec">
              <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" className="mr-1">
                <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zM13 17h-2v-6H8l4-5 4 5h-3v6z" />
              </svg>
              Promoted by {t.promotedBy}
            </p>
          </div>
        ) : (
          <div key={i} className="flex cursor-pointer items-start justify-between px-4 py-2.5 hover:bg-x-hover">
            <div>
              <p className="text-[13px] leading-4 text-x-sec">{t.category}</p>
              <p className="mt-0.5 text-[15px] font-bold leading-5">{t.title}</p>
            </div>
            <button className="-mr-1 rounded-full p-1.5 text-x-sec hover:bg-[#1d9bf01a] hover:text-x-blue">
              <KebabIcon size={18.75} />
            </button>
          </div>
        )
      )}
    </Card>
  );
}

export function WhoToFollowCard({ users, title = "Who to follow" }: { users: User[]; title?: string }) {
  return (
    <Card title={title} footer="Show more">
      {users.map((u) => (
        <div key={u.fid} className="flex cursor-pointer items-center px-4 py-3 hover:bg-x-hover">
          <img src={u.pfpUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          <div className="ml-3 min-w-0 flex-1">
            <p className="flex items-center text-[15px] font-bold leading-5 hover:underline">
              <span className="truncate">{u.displayName}</span>
              {u.verified && <VerifiedBadge size={16} className="ml-0.5 shrink-0" />}
            </p>
            <p className="truncate text-[15px] leading-5 text-x-sec">@{u.username}</p>
          </div>
          <FollowButton />
        </div>
      ))}
    </Card>
  );
}

// HELP: the footer was X's legal links as dead text (Terms of Service … "© 2026 X Corp."), none of which exists for
// Totem. It now leads to the Help page's sections, every one a next/link (a soft navigation keeps this tab's
// identity). "Docs" goes to Help's docs section, which links the full docs in a new tab — DOCS UNDER APP: always, at
// /docs on this app unless NEXT_PUBLIC_DOCS_URL overrides it. This client component never reads the variable
// (NEXT_PUBLIC_* names are frozen at build time; the server reads it per request, lib/platform/preview.ts).
const FOOTER_LINKS: { href: string; label: string; testid: string }[] = [
  { href: "/help", label: "Help", testid: "rail-footer-help" },
  { href: "/help#today", label: "What works today", testid: "rail-footer-today" },
  { href: "/help#privacy", label: "Privacy", testid: "rail-footer-privacy" },
  { href: "/help#docs", label: "Docs", testid: "rail-footer-docs" },
];

export function RailFooter() {
  return (
    <nav aria-label="Help" className="mb-4 flex flex-wrap px-4 text-[13px] leading-4 text-x-sec">
      {FOOTER_LINKS.map((l, i) => (
        <span key={l.href} className="mb-1 mr-1.5">
          <Link href={l.href} data-testid={l.testid} className="hover:underline">
            {l.label}
          </Link>
          {i < FOOTER_LINKS.length - 1 ? <span aria-hidden className="ml-1.5">·</span> : null}
        </span>
      ))}
    </nav>
  );
}
