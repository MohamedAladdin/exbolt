import { ImageResponse } from "next/og";

// iOS home-screen icon: the plate variant of the ExBolt bolt at 180 px, the
// same artwork as the favicon. Without it iOS falls back to a screenshot of
// the page, which is the one place the product would show up unbranded.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
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
