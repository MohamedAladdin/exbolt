/**
 * ExBolt mark — the product's own symbol, the same one the landing page
 * carries in its header and in `/landing/assets/favicon.svg`: a blue
 * speech bubble with a white bolt cut through it.
 *
 * The app used to show EXCAL's studio mark (gold plate + "E") on the auth
 * screens and in the sidebar, so the product's homepage and its own login
 * page advertised two different logos. This component is the single source
 * of the symbol inside the product; the favicon (`src/app/icon.tsx`) draws
 * the plate variant of the same bolt for 16/32 px legibility.
 *
 * Flat fills only, one blue (`#0A4DFF`), 64-unit grid — the brand rule:
 * no gradients, no shadows, no strokes.
 */
const BLUE = "#0A4DFF";
const PAPER = "#FFFFFF";

export function ExboltMark({
  className,
  label,
  tone = "colour",
}: {
  className?: string;
  /** Set only when the mark stands alone as the page's only label. */
  label?: string;
  /**
   * `colour` = brand blue bubble (default). `mono` = currentColor, for
   * places that need the mark to follow a text colour (print, dark chips).
   */
  tone?: "colour" | "mono";
}) {
  const plate = tone === "mono" ? "currentColor" : BLUE;
  const bolt = tone === "mono" ? "var(--color-background, #020617)" : PAPER;

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
      {/* Bubble body */}
      <path
        d="M20 5h24a13 13 0 0 1 13 13v22a13 13 0 0 1-13 13H20A13 13 0 0 1 7 40V18A13 13 0 0 1 20 5Z"
        fill={plate}
      />
      {/* Tail */}
      <path d="M19 46 10 62l21-9Z" fill={plate} />
      {/* Bolt */}
      <path
        d="M37 11 23.8 32.4c-.6.95 0 2.15 1.1 2.15h7.2l-2.5 13.6c-.2 1.2 1.25 1.9 2 .98L45 26.6c-.6-.95 0-2.15-1.1-2.15h-7.3l2.5-12.5c.2-1.2-1.25-1.9-2.1-.95Z"
        fill={bolt}
      />
    </svg>
  );
}
