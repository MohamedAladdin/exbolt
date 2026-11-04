import { ImageResponse } from "next/og";

// Favicon: the ExBolt bolt on the brand-blue plate — the same artwork the
// landing page serves as `/landing/assets/favicon.svg`, so the tab icon does
// not change identity when a visitor signs in. The bubble form of the mark
// (src/components/brand/exbolt-mark.tsx) keeps its tail above ~24 px; the
// plate is what reads at 16/32.
// Next.js renders this at build time and auto-injects <link rel="icon">.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="16" fill="#0A4DFF" />
          <path
            d="M37.4 8.5 16.2 35.9c-.7.9-.05 2.2 1.1 2.2h10.4l-3.2 16.2c-.2 1.2 1.3 1.9 2.1 1l21.2-27.4c.7-.9.05-2.2-1.1-2.2H35.9l3.6-15.2c.2-1.2-1.3-1.9-2.1-1Z"
            fill="#FFFFFF"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
