import { ImageResponse } from "next/og";

/**
 * Installable-app icons for the PWA manifest.
 *
 * `src/app/icon.tsx` is a 32px tab icon; a manifest needs 192 and 512, and Safari
 * will not offer "Add to Home Screen" — the only path to Web Push on iOS — without
 * them. Same artwork as the favicon (the ExBolt bolt on the brand-blue plate), just
 * at install sizes.
 *
 * `maskable=1` keeps the mark inside the safe zone Android crops to, so the icon is
 * not clipped into a circle-eaten blob on a home screen.
 */

export const runtime = "edge";

const SIZES = [192, 512] as const;

function clampSize(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 192;
  const rounded = SIZES.reduce((best, size) =>
    Math.abs(size - parsed) < Math.abs(best - parsed) ? size : best,
  );
  return rounded;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const size = clampSize(params.get("size"));
  const maskable = params.get("maskable") === "1";
  // Maskable icons must keep everything inside the inner 80% circle.
  const inset = maskable ? Math.round(size * 0.1) : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A4DFF",
        }}
      >
        <svg
          width={size - inset * 2}
          height={size - inset * 2}
          viewBox="0 0 64 64"
          fill="none"
        >
          <path
            d="M37.4 8.5 16.2 35.9c-.7.9-.05 2.2 1.1 2.2h10.4l-3.2 16.2c-.2 1.2 1.3 1.9 2.1 1l21.2-27.4c.7-.9.05-2.2-1.1-2.2H35.9l3.6-15.2c.2-1.2-1.3-1.9-2.1-1Z"
            fill="#FFFFFF"
          />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
