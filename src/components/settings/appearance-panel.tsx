"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages, Moon, Palette, SunMoon, Sun, Type } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { useUiPrefs } from "@/hooks/use-ui-prefs";
import { MODES, THEMES, type Mode, type ThemeId } from "@/lib/themes";
import {
  ARABIC_FONTS,
  ARABIC_FONT_LABELS,
  FONT_SIZES,
  type ArabicFont,
  type FontSize,
} from "@/lib/ui-prefs";
import { LOCALES, LOCALE_LABELS, localeDirection, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Appearance panel — light/dark mode + accent-color picker.
 *
 * Two independent controls: a mode toggle (light / dark) and the
 * accent grid. Either applies + persists immediately. No save button:
 * each change is a single attribute swap on <html>, there's nothing
 * to roll back.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays both choices before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  const { arabicFont, setArabicFont, fontSize, setFontSize } = useUiPrefs();
  const t = useTranslations("Settings.appearance");
  const currentLocale = useLocale();
  const router = useRouter();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Switch the UI language.
   *
   * The locale is resolved server-side from a cookie, so the flow is:
   * persist the choice → paint `lang`/`dir` optimistically (instant
   * feedback, correct direction before the server answers) → refresh the
   * server components so every string re-renders in the new catalogue.
   * No full reload, so the panel keeps its scroll position.
   */
  const changeLocale = useCallback(
    async (next: Locale) => {
      if (next === currentLocale || pendingLocale) return;
      setPendingLocale(next);
      try {
        await fetch("/api/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: next }),
        });
        document.documentElement.lang = next;
        document.documentElement.dir = localeDirection(next);
        startTransition(() => router.refresh());
      } finally {
        setPendingLocale(null);
      }
    },
    [currentLocale, pendingLocale, router],
  );

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />

      {/* Language first: it decides the direction of everything below. */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Languages className="size-4 text-muted-foreground" />
          {t("language")}
        </h3>
        <p className="-mt-2 text-xs text-muted-foreground">{t("languageDescription")}</p>

        <div
          role="radiogroup"
          aria-label={t("language")}
          className="grid max-w-md grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {LOCALES.map((locale) => {
            const isActive = locale === currentLocale;
            const isPending = pendingLocale === locale;
            return (
              <button
                key={locale}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => void changeLocale(locale)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-start text-sm transition-colors",
                  isActive
                    ? "border-primary/60 ring-2 ring-primary/40"
                    : "border-border hover:bg-muted/40",
                  isPending && "opacity-60",
                )}
              >
                <span className="font-medium text-foreground">
                  {LOCALE_LABELS[locale]}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Typography — Arabic face + global size. */}
      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Type className="size-4 text-muted-foreground" />
          {t("typography")}
        </h3>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("arabicFont")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("arabicFont")}
            className="grid max-w-md grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {ARABIC_FONTS.map((font) => {
              const isActive = font === arabicFont;
              return (
                <button
                  key={font}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setArabicFont(font as ArabicFont)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-start transition-colors",
                    isActive
                      ? "border-primary/60 ring-2 ring-primary/40"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {ARABIC_FONT_LABELS[font]}
                  </span>
                  <span
                    className="text-base text-foreground"
                    style={{
                      fontFamily:
                        font === "cairo"
                          ? "var(--font-arabic-cairo)"
                          : font === "tajawal"
                            ? "var(--font-arabic-tajawal)"
                            : "var(--font-arabic-kufi)",
                    }}
                  >
                    أهلاً بك
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("arabicFontHint")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("fontSize")}</p>
          <div
            role="radiogroup"
            aria-label={t("fontSize")}
            className="flex max-w-md gap-2"
          >
            {FONT_SIZES.map((size) => {
              const isActive = size === fontSize;
              return (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setFontSize(size as FontSize)}
                  className={cn(
                    "flex-1 rounded-lg border bg-card py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary/60 text-foreground ring-2 ring-primary/40"
                      : "border-border text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {t(`size.${size}`)}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("fontSizeHint")}</p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SunMoon className="size-4 text-muted-foreground" />
          {t("mode")}
        </h3>

        <div
          role="radiogroup"
          aria-label={t("colorMode")}
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {MODES.map((m) => (
            <ModeCard
              key={m}
              mode={m}
              isActive={m === mode}
              onPick={() => setMode(m)}
            />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Palette className="size-4 text-muted-foreground" />
          {t("accentColor")}
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((tObj) => (
            <ThemeCard
              key={tObj.id}
              id={tObj.id}
              name={tObj.name}
              tagline={tObj.tagline}
              swatch={tObj.swatch}
              isActive={tObj.id === theme}
              onPick={() => setTheme(tObj.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ModeCard({
  mode,
  isActive,
  onPick,
}: {
  mode: Mode;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("Settings.appearance");
  const isLight = mode === "light";
  const Icon = isLight ? Sun : Moon;
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={t("useMode", { mode })}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-start transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-semibold capitalize text-foreground">
        {mode}
      </span>
      {isActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="h-3 w-3" />
          {t("active")}
        </span>
      )}
    </button>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("Settings.appearance");
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={t("useTheme", { name })}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-start transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            {t("active")}
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-muted-foreground/60" />
        <span className="w-3 bg-muted" />
        <span className="w-3 bg-card" />
      </div>
      <span className="sr-only">{t("themeId", { id })}</span>
    </button>
  );
}
