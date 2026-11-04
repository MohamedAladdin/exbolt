"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, ImagePlus, Loader2, RotateCcw, Sparkles, Trash2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { brandName, composeBrandTitle, vendorSuffix, VENDOR_NAME } from "@/lib/branding";
import { ExboltMark } from "@/components/brand/exbolt-mark";
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
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!account || loaded) return;
    setDraft(account.brand_name ?? "");
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

  /**
   * Upload the mark and store its public URL.
   *
   * Public on purpose: the same URL is embedded in the printed report and in
   * the scheduled email, and a signed URL would expire before a manager opens
   * Monday's mail. Path is `account-<id>/…` so the storage policy can prove the
   * uploader belongs to this account.
   */
  async function uploadLogo(file: File) {
    if (!accountId || uploading) return;
    if (file.size > 1_048_576) {
      toast.error(t("logoTooBig"));
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const extension = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `account-${accountId}/logo-${Date.now()}.${extension || "png"}`;
      const { error: uploadError } = await supabase.storage
        .from("brand-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        toast.error(t("logoFailed"));
        return;
      }
      const { data: publicUrl } = supabase.storage.from("brand-assets").getPublicUrl(path);
      const { error } = await supabase
        .from("accounts")
        .update({ logo_url: publicUrl.publicUrl })
        .eq("id", accountId);
      if (error) {
        toast.error(t("logoFailed"));
        return;
      }
      toast.success(t("saved"));
      await refreshProfile();
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (!accountId) return;
    setUploading(true);
    try {
      const { error } = await createClient()
        .from("accounts")
        .update({ logo_url: null })
        .eq("id", accountId);
      if (error) {
        toast.error(t("logoFailed"));
        return;
      }
      toast.success(t("saved"));
      await refreshProfile();
      router.refresh();
    } finally {
      setUploading(false);
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
              <ExboltMark className="h-8 w-8 shrink-0" />
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <ImagePlus className="size-4 text-primary" />
            {t("logoTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t("logoDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-muted/40">
              {account?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={account.logo_url}
                  alt={brandName(draft)}
                  className="max-h-14 max-w-14 object-contain"
                />
              ) : (
                <ExboltMark className="h-8 w-8 opacity-40" />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEditSettings || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {account?.logo_url ? t("logoReplace") : t("logoUpload")}
            </Button>
            {account?.logo_url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canEditSettings || uploading}
                onClick={() => void removeLogo()}
              >
                <Trash2 className="size-4" />
                {t("logoRemove")}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("logoHint")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
