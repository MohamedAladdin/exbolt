"use client";

/**
 * A searchable currency picker.
 *
 * A native `<select>` with ~160 options is a scroll bar, not a control: the
 * accountant looking for «جنيه مصري» has to know where E starts. This is a
 * search box over the catalogue (code, Arabic name, English name), with the
 * Arab-world currencies surfaced first — the list this product is actually
 * used with.
 *
 * It stays inline (no popover) on purpose: settings cards are read top to
 * bottom, and a dropdown that covers the card it belongs to is worse than a
 * short scrollable list.
 */

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { ARAB_CURRENCIES, CURRENCIES, currencySymbol, currencyName, searchCurrencies } from "@/lib/currency";

interface Props {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

export function CurrencyPicker({ value, onChange, disabled }: Props) {
  const t = useTranslations("Settings.deals");
  // The active UI locale, not the build-time `NEXT_PUBLIC_APP_LOCALE`: the
  // Arabic screen must read «جنيه مصري» and answer an Arabic search.
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const results = useMemo(() => searchCurrencies(query, locale), [query, locale]);

  // The current value must always be reachable, even while searching for
  // something else: an operator who filtered and then panicked needs to see
  // what is actually saved.
  const current = CURRENCIES.find((c) => c.code === value);

  const quick = useMemo(
    () => ARAB_CURRENCIES.map((code) => CURRENCIES.find((c) => c.code === code)!).filter(Boolean),
    [],
  );

  return (
    <div className="grid gap-2">
      {current && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm text-foreground">
            <span className="font-medium">{current.code}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            {currencyName(current.code, locale)}
          </span>
          <span className="text-sm text-muted-foreground">{currencySymbol(current.code, locale)}</span>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("currencySearch")}
          aria-label={t("currencySearch")}
          className="h-9 w-full rounded-lg border border-border bg-muted ps-8 pe-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {!query && (
        <div className="flex flex-wrap gap-1.5">
          <span className="py-1 text-xs text-muted-foreground">{t("arabCurrencies")}:</span>
          {quick.map((option) => (
            <button
              key={option.code}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.code)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                option.code === value
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.code}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {results.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("noCurrencyResults")}</p>
        )}
        {results.map((option) => {
          const active = option.code === value;
          return (
            <button
              key={option.code}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.code)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-muted ${
                active ? "bg-primary/5 text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="min-w-0">
                <span className="font-mono text-xs text-foreground">{option.code}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="truncate">{currencyName(option.code, locale)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {currencySymbol(option.code, locale)}
                {active && <Check className="size-3.5 text-primary" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
