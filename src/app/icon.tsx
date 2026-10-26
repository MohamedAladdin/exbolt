import { ImageResponse } from "next/og";

// Favicon = the EXCAL "E" block (see src/components/brand/excal-mark.tsx):
// a gold plate with the top-right corner cut at 45° and a dark E in the
// cut-out. Flat fills, 64-unit grid, so the edges stay crisp at 16/32 px.
// Next.js renders this at build time and auto-injects <link rel="icon">.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="32" height="32" viewBox="0 0 64 64">
          <path d="M0 0 H45 L64 19 V64 H0 Z" fill="#F5C242" />
          <path
            d="M24 18 H44 V23.5 H30.5 V29 H41 V34.3 H30.5 V40.5 H44.5 V46 H24 Z"
            fill="#0E1116"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
