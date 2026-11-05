import type { MetadataRoute } from "next";

import { PRODUCT_NAME } from "@/lib/branding";

/**
 * PWA manifest.
 *
 * It exists for one concrete reason: **iOS only delivers Web Push to a web app that
 * has been added to the Home Screen**, and Safari shows the "Add to Home Screen"
 * affordance only when the page is a valid web app manifest + icon. Android Chrome
 * and desktop Chrome/Edge install too, which is what keeps the push channel alive
 * when the browser itself is closed.
 *
 * `start_url` is the dashboard, not the marketing page: an installed app that opens
 * on the landing page is a worse experience than no install at all.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: "WhatsApp CRM — shared inbox, automations and AI agents.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0b12",
    theme_color: "#0A4DFF",
    lang: "ar",
    dir: "rtl",
    icons: [
      {
        src: "/pwa-icon?size=192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon?size=512&maskable=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
