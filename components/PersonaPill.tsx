// POST-DEPLOY Gate 2 — THE NON-COLOUR SIGNAL.
//
// The tint is a shortcut, not a signal. Roughly one in twelve men and one in
// two hundred women cannot separate two of the palette's entries reliably, a
// greyscale or e-ink display separates none of them, and a shared screen at a
// glance separates fewer still. So the handle is always there in TEXT, in the
// same chrome the wash is on, and the mode's border TREATMENT (solid / dashed /
// dotted / double) rides the same element — a second channel that survives
// greyscale on its own.
//
// The invariant the suite asserts: wherever the tint is, this is too. It is
// rendered by the layout (the mobile one) and by the left rail (the desktop
// one), which between them cover every page under the (main) group at every
// width — never by an individual page, because a page that forgot it would be
// a page where colour is the only cue.
//
// PROD-LIVE (D-CU-0-4): on a public deployment the handle comes from the browser device after it boots
// (components/ChromeRoot.tsx), so there is a moment with NO handle. The pill then says so in words — "Loading
// persona…", or "Persona unavailable" with a retry — and never falls back to anybody's handle: the server's fallback
// identity is the fixture owner's, and naming it to a stranger would be the exact lie this pill exists to prevent.
// With a handle (always, on the rig) the DOM is unchanged.
export function PersonaPill({
  handle,
  modeName,
  variant,
  pending = false,
  onRetry,
  none = false,
}: {
  handle: string | null;
  modeName?: string | null;
  variant: "rail" | "mobile";
  /** no handle yet because the device has not answered (public deployment only) */
  pending?: boolean;
  /** no handle because the read failed: offered as a retry (public deployment only) */
  onRetry?: () => void;
  /** LAYERS_WORLD=empty (lib/world.ts): no handle because this device has no persona yet — said, not an error */
  none?: boolean;
}) {
  const common =
    "flex items-center gap-1 overflow-hidden rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold leading-4 text-x-text";
  const unknown = handle === null;
  const label = unknown ? (pending ? "Loading persona…" : none ? "No persona yet" : "Persona unavailable") : "@" + handle;
  return (
    <div
      data-testid="persona-pill"
      data-persona-handle={handle ?? ""}
      data-mode-name={modeName ?? ""}
      data-variant={variant}
      {...(unknown ? { "data-state": pending ? "loading" : none ? "none" : "unknown" } : {})}
      title={modeName ? label + " · " + modeName : label}
      className={
        variant === "rail"
          ? common + " mx-auto mt-1 w-full max-w-[72px] justify-center xl2:mx-0 xl2:max-w-none xl2:justify-start"
          : common + " fixed bottom-[57px] left-2 z-30 max-w-[60vw] shadow-sm sm:hidden"
      }
      style={{
        borderWidth: 2,
        borderColor: "var(--persona-tint, transparent)",
        borderStyle: "var(--persona-mode-edge, solid)",
      }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: "var(--persona-tint, transparent)" }}
      />
      {unknown ? (
        <span className={"truncate " + (pending || none ? "text-x-sec" : "text-[#f4212e]")}>{label}</span>
      ) : (
        <span className="truncate">@{handle}</span>
      )}
      {unknown && onRetry ? (
        <button type="button" data-testid="persona-pill-retry" onClick={onRetry} className="shrink-0 underline">
          retry
        </button>
      ) : null}
      {modeName ? <span className="hidden truncate text-x-sec xl2:inline">· {modeName}</span> : null}
    </div>
  );
}
