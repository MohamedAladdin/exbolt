"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, Loader2, RotateCcw, Sparkles } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { brandName, composeBrandTitle, vendorSuffix, VENDOR_NAME } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Settings → Branding: the account's own system name.
 *
 * The name is shown in the sidebar and the browser tab, with the vendor
 * credit appended ("<name> من ExCal.uk" / "<name> by ExCal.uk"). Stored on
 * `accounts.brand_name` (migration 062) — account-wide, so every teammate
 * and every device sees the same label.
 */
export function BrandingPanel() {
  const t = useTranslations("Settings.branding");
  const { account, accountId, canEditSettings, profileLoading, refreshProfile } = useAuth();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!account || loaded) return;
    setDraft(account.brand_name ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(true);
  }, [account, loaded]);

  const saved = account?.brand_name ?? "";
  const dirty = draft.trim() !== saved.trim();
  const preview = composeBrandTitle(draft.trim() || null, "ar");

  async function save() {
    if (!accountId || saving) return;
    setSaving(true);
    try {
      const value = draft.trim() ? draft.trim() : null;
      const { error } = await createClient()
        .from("accounts")
        .update({ brand_name: value })
        .eq("id", accountId);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      await refreshProfile();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEditSettings || profileLoading || !loaded;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Sparkles className="size-4 text-primary" />
            {t("systemName")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("systemNameDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="brand-name" className="text-muted-foreground">
              {t("systemName")}
            </Label>
            <Input
              id="brand-name"
              value={draft}
              maxLength={60}
              disabled={disabled}
              placeholder={t("placeholder")}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{t("hint")}</p>
          </div>

          {/* Live preview — shows exactly what the sidebar and the browser
              tab will read, suffix included, so nobody saves a name and is
              surprised by the credit line. */}
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Eye className="size-3" />
              {t("preview")}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {brandName(draft)}
                </p>
                {draft.trim() ? (
                  <p className="truncate text-[10px] text-muted-foreground">
                    {vendorSuffix("ar")}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
              {t("tabTitle")}: <span className="text-foreground">{preview}</span>
            </p>
          </div>

          {canEditSettings ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("saving")}
                  </>
                ) : (
                  t("save")
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                disabled={saving || !saved}
                onClick={() => setDraft("")}
              >
                <RotateCcw className="size-3.5" />
                {t("reset")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("adminOnly")}</p>
          )}

          <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
            {t("creditNote", { vendor: VENDOR_NAME })}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
