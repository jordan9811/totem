// POST-DEPLOY Gate 3 — THE BANNER TIER'S SURFACE.
//
// "Banner" is the tier for people you want to KNOW about without being
// interrupted by. So it is a strip above the timeline, not a notification:
// nothing is pushed, nothing is counted unread, nothing follows you out of the
// app. It is drawn from the same eligible set the timeline was built from, so
// it can never surface a post the mode's rules excluded, and it lives above the
// timeline entirely — never below the caught-up banner, where the anti-
// doomscroll contract says only readwise and folders may go.
import Link from "next/link";

export interface PreviewItem {
  hash: string;
  authorPersonaId: string;
  handle: string;
  text: string;
  minutesAgo: number;
  /** SPEC A: where the item opens. A post from the real Following opens by its FRAGMENT address (lib/fc/hubRead/copy.ts
   *  hubCastHref), which no browser sends to a server; absent = the sample post's own page. */
  href?: string;
}

const ago = (m: number) => (m < 60 ? m + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d");

export function PreviewStrip({ items }: { items: PreviewItem[] }) {
  if (!items.length) return null;
  return (
    <div
      data-testid="preview-strip"
      data-count={items.length}
      className="flex gap-2 overflow-x-auto border-b border-x-border px-4 py-2 no-scrollbar"
    >
      <span className="shrink-0 self-center text-[12px] font-bold uppercase tracking-wide text-x-sec">
        Banner
      </span>
      {/* PROD-LIVE (D-CU-0-4): client navigations (next/link), never a full document load — on a public deployment
          an unsaved visitor identity lives only in tab memory. No viewport prefetch: a strip of links must not fan
          out a server render per item. */}
      {items.map((it) => (
        <Link
          key={it.hash}
          prefetch={false}
          data-testid="preview-strip-item"
          data-persona={it.authorPersonaId}
          data-hash={it.hash}
          href={it.href ?? `/${it.handle}/status/${it.hash}`}
          className="w-[220px] shrink-0 rounded-xl border border-x-border px-3 py-2 hover:bg-x-hover"
        >
          <span className="block text-[13px] font-bold leading-4">
            @{it.handle}
            <span className="ml-1 font-normal text-x-sec">· {ago(it.minutesAgo)}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-4 text-x-sec">{it.text}</span>
        </Link>
      ))}
    </div>
  );
}
