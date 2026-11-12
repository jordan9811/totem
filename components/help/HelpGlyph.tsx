// A question mark in a circle: the Help entry's icon in the left rail, the More menu, the mobile drawer and the
// settings index. Drawn in currentColor, so it takes the colour of whatever row it sits in. No state: a server or a
// client component may render it.
export function HelpGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
      <circle cx="12" cy="17.4" r="0.4" fill="currentColor" />
    </svg>
  );
}
