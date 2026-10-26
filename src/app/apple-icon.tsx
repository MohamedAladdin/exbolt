import { ImageResponse } from "next/og";

// iOS home-screen icon: the same EXCAL "E" block at 180 px. Without it
// iOS falls back to a screenshot of the page, which is the one place the
// product would show up unbranded.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
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
