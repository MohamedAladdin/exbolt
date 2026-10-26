import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Inter, Cairo, Tajawal, Noto_Kufi_Arabic } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";
import {
  ARABIC_FONTS,
  ARABIC_FONT_STORAGE_KEY,
  DEFAULT_ARABIC_FONT,
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  FONT_SIZE_STORAGE_KEY,
} from "@/lib/ui-prefs";
import { localeDirection } from "@/i18n/config";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

/**
 * Arabic UI faces, self-hosted through next/font (no third-party request,
 * no CSP hole). Three families because Arabic UI type is a matter of taste:
 * Cairo (geometric, closest to the Latin default), Tajawal (narrower, fits
 * dense tables) and Noto Kufi Arabic (heavier, high-contrast headings).
 * Only the one the user picks is ever referenced by `--font-sans`, but all
 * three are declared so switching is instant and offline.
 */
const cairo = Cairo({
  variable: "--font-arabic-cairo",
  subsets: ["arabic", "latin"],
});

const tajawal = Tajawal({
  variable: "--font-arabic-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
});

const notoKufi = Noto_Kufi_Arabic({
  variable: "--font-arabic-kufi",
  subsets: ["arabic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    ...metadata,
    description: t("description"),
  };
}

const metadata: Metadata = {
  title: {
    default: "ExBolt",
    template: "%s — ExBolt",
  },
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;

    // Typography preferences (Settings → Appearance). Same reasoning as
    // theme/mode: applying them before first paint avoids a visible
    // re-flow when the hook mounts.
    var FONT_KEY = ${JSON.stringify(ARABIC_FONT_STORAGE_KEY)};
    var FONT_DEFAULT = ${JSON.stringify(DEFAULT_ARABIC_FONT)};
    var FONTS = ${JSON.stringify(ARABIC_FONTS)};
    var savedFont = localStorage.getItem(FONT_KEY);
    d.dataset.arabicFont = FONTS.indexOf(savedFont) !== -1 ? savedFont : FONT_DEFAULT;

    var SIZE_KEY = ${JSON.stringify(FONT_SIZE_STORAGE_KEY)};
    var SIZE_DEFAULT = ${JSON.stringify(DEFAULT_FONT_SIZE)};
    var SIZES = ${JSON.stringify(FONT_SIZES)};
    var savedSize = localStorage.getItem(SIZE_KEY);
    d.dataset.fontSize = SIZES.indexOf(savedSize) !== -1 ? savedSize : SIZE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
    d.dataset.arabicFont = ${JSON.stringify(DEFAULT_ARABIC_FONT)};
    d.dataset.fontSize = ${JSON.stringify(DEFAULT_FONT_SIZE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = localeDirection(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      // NOTE: data-theme / data-mode / data-arabic-font / data-font-size are
      // deliberately NOT rendered here. They are the user's device-scoped
      // preferences, written by the boot script below. Rendering defaults on
      // the server meant that any client-side `router.refresh()` (e.g. after
      // switching language) reconciled the attributes back to the defaults and
      // silently reset the user's theme, mode and type size.
      className={`${inter.variable} ${cairo.variable} ${tajawal.variable} ${notoKufi.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
