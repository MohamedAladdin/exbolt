/**
 * EXCAL mark — the studio's "E" block, the same shape used as the
 * favicon on excal.uk: a gold plate with the top-right corner cut at 45°
 * and a dark E left in the cut-out.
 *
 * Flat fills only, one shape, no gradients — the brand rule. It is drawn
 * at a 64-unit grid so every edge lands on a whole unit at 16/32/48 px.
 *
 * `colour` switches the plate to the dark ink variant for use on the gold
 * brand surfaces (email headers, print); the default gold plate is what
 * the app shell and the auth cards use.
 */
const PLATE = "#F5C242";
const INK = "#0E1116";

export function ExcalMark({
  className,
  variant = "gold",
  label,
}: {
  className?: string;
  variant?: "gold" | "ink";
  /** Set only when the mark stands alone as the page's only label. */
  label?: string;
}) {
  const plate = variant === "ink" ? INK : PLATE;
  const glyph = variant === "ink" ? PLATE : INK;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      shapeRendering="geometricPrecision"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d="M0 0 H45 L64 19 V64 H0 Z" fill={plate} />
      <path d="M24 18 H44 V23.5 H30.5 V29 H41 V34.3 H30.5 V40.5 H44.5 V46 H24 Z" fill={glyph} />
    </svg>
  );
}
