"use client";
// PERSONA LAUNCH P4 — THE HALF-AND-HALF AVATAR: the ROOT on the left, the PERSONA on the right (plan §0, §2.4).
//
// Used for a ring member's merges (an anon post a ring shared, a card by an account a ring shared) and for the existing
// persona merge (MULTI-FID Gate 2), whose sides are swapped to the same rule: root / linked identity left, the persona
// that wrote the card right. data-testid "cast-split-avatar" is kept, so the suites that find it still do.
//
// ZERO REQUESTS for a ring's halves: a Face draws an INLINE image (a data: URI the owner's device sealed into the ring's
// envelope) or a monogram disc — never a URL, so opening a card never tells an image host that this device knows who
// the persona is. A caller that already shows a picture it loads anyway (the card's own author) passes that node.
import type React from "react";

/** a monogram's colour: stable per name, from a small string hash (no randomness, so a server render hydrates) */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function inlineImage(src: string | null | undefined): src is string {
  return typeof src === "string" && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(src);
}

/** one half's face: an inline thumbnail, or a monogram disc with the name's first letter */
export function Face({ thumb, name }: { thumb: string | null | undefined; name: string }) {
  if (inlineImage(thumb)) return <img src={thumb} alt="" className="h-full w-full object-cover" />;
  const letter = (name.trim().replace(/^@/, "")[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center text-[15px] font-bold text-white"
      style={{ background: `hsl(${hueOf(name)} 45% 42%)` }}
    >
      {letter}
    </span>
  );
}

export function SplitAvatar({
  left,
  right,
  leftName,
  rightName,
  size = 40,
  testid = "cast-split-avatar",
  onClick,
}: {
  /** the root (or the linked identity) */
  left: React.ReactNode;
  /** the persona */
  right: React.ReactNode;
  leftName: string;
  rightName: string;
  size?: number;
  testid?: string;
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      data-testid={testid}
      data-left={leftName}
      data-right={rightName}
      title={`${leftName} / ${rightName}`}
      className="relative inline-block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      <span className="absolute inset-0 block" style={{ clipPath: "polygon(0 0, 50% 0, 50% 100%, 0 100%)" }}>
        {left}
      </span>
      <span className="absolute inset-0 block" style={{ clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" }}>
        {right}
      </span>
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70" aria-hidden="true" />
    </span>
  );
}
