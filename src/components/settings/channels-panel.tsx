"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Aperture,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  MessagesSquare,
  Unplug,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";
import type { MessagingChannel } from "@/lib/channels/types";
import { isOAuthConnectedChannel, oauthMessageKey } from "@/lib/oauth/result";

interface ChannelConfig {
  channel: MessagingChannel;
  external_id: string;
  display_name: string | null;
  is_active: boolean;
  updated_at: string | null;
}

const CHANNEL_META: Record<
  MessagingChannel,
  { icon: typeof MessagesSquare; idLabelKey: string; idPlaceholderKey: string; docsKey: string }
> = {
  messenger: {
    icon: MessagesSquare,
    idLabelKey: "messengerIdLabel",
    idPlaceholderKey: "messengerIdPlaceholder",
    docsKey: "messengerIdHint",
  },
  instagram: {
    icon: Aperture,
    idLabelKey: "instagramIdLabel",
    idPlaceholderKey: "instagramIdPlaceholder",
    docsKey: "instagramIdHint",
  },
};

/**
 * Settings → Channels: connect a Facebook Page (Messenger) or an
 * Instagram business account to the shared inbox.
 *
 * The primary action is "Connect with Facebook" — /api/oauth/meta/start
 * runs the Facebook Login flow, resolves the Page (or asks which one), and
 * stores an encrypted Page token without anyone handling a credential.
 * The manual id + token form stays available behind a collapsed
 * disclosure for customers who already hold a long-lived Page token.
 */
export function ChannelsPanel() {
  const t = useTranslations("Settings.channels");
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthResultHandled = useRef(false);
  const { canEditSettings, profileLoading } = useAuth();
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingChannel, setSavingChannel] = useState<MessagingChannel | null>(null);
  const [drafts, setDrafts] = useState<
    Record<MessagingChannel, { externalId: string; token: string }>
  >({
    messenger: { externalId: "", token: "" },
    instagram: { externalId: "", token: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/channels", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setConfigs((data.channels as ChannelConfig[]) ?? []);
      else toast.error(data.error ?? t("loadFailed"));
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth callback lands back here with `?connected=` or `?error=`.
  // Report it once, then drop the params so a reload does not replay the
  // toast. `oauthResultHandled` survives the router.replace re-render.
  useEffect(() => {
    if (oauthResultHandled.current) return;
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (!connected && !error) return;

    oauthResultHandled.current = true;
    if (connected && isOAuthConnectedChannel(connected)) {
      toast.success(t("oauth.connected"));
    } else if (error) {
      toast.error(t(oauthMessageKey(error)));
    }
    router.replace("/settings?tab=channels", { scroll: false });
  }, [searchParams, router, t]);

  const startOAuth = useCallback((channel: MessagingChannel) => {
    // A hard navigation, not router.push: the route answers with a 302 to
    // facebook.com, and the browser (not the Next router) has to follow
    // that cross-origin hop while keeping the httpOnly state cookie.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/oauth/meta/start?channel=${channel}`;
  }, []);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/meta`
      : "/api/webhooks/meta";

  const copyWebhook = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }, [webhookUrl, t]);

  const save = useCallback(
    async (channel: MessagingChannel) => {
      const draft = drafts[channel];
      if (savingChannel) return;
      setSavingChannel(channel);
      try {
        const res = await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            external_id: draft.externalId.trim(),
            access_token: draft.token.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? t("saveFailed"));
          return;
        }
        toast.success(t("saved"));
        if (data.subscribed === false) {
          toast.warning(
            t("subscribeWarning", { error: data.subscribe_error ?? "" }),
          );
        }
        setDrafts((prev) => ({ ...prev, [channel]: { externalId: "", token: "" } }));
        void load();
      } catch {
        toast.error(t("saveFailed"));
      } finally {
        setSavingChannel(null);
      }
    },
    [drafts, savingChannel, load, t],
  );

  const disconnect = useCallback(
    async (channel: MessagingChannel) => {
      if (!window.confirm(t("disconnectConfirm"))) return;
      try {
        const res = await fetch(`/api/channels?channel=${channel}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? t("disconnectFailed"));
          return;
        }
        toast.success(t("disconnected"));
        void load();
      } catch {
        toast.error(t("disconnectFailed"));
      }
    },
    [load, t],
  );

  const editable = canEditSettings && !profileLoading;

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Link2 className="size-4 text-primary" />
            {t("webhookTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("webhookDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground"
            >
              {webhookUrl}
            </code>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void copyWebhook()}>
              <Copy className="size-3.5" />
              {t("copy")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("webhookHint")}</p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {(["messenger", "instagram"] as MessagingChannel[]).map((channel) => {
          const meta = CHANNEL_META[channel];
          const Icon = meta.icon;
          const config = configs.find((c) => c.channel === channel);
          const draft = drafts[channel];
          const busy = savingChannel === channel;

          return (
            <Card key={channel}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Icon className="size-4 text-primary" />
                      {t(`channel.${channel}`)}
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {t(`channelDesc.${channel}`)}
                    </CardDescription>
                  </div>
                  {loading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : config ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                      <CheckCircle2 className="size-3" />
                      {t("connected")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("notConnected")}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {config && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
                    <span className="font-medium text-foreground">
                      {config.display_name ?? config.external_id}
                    </span>
                    <span dir="ltr" className="text-muted-foreground">
                      ID: {config.external_id}
                    </span>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ms-auto h-7 gap-1 text-xs text-muted-foreground hover:text-red-400"
                        onClick={() => void disconnect(channel)}
                      >
                        <Unplug className="size-3.5" />
                        {t("disconnect")}
                      </Button>
                    )}
                  </div>
                )}

                {editable && (
                  <>
                    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => startOAuth(channel)}
                      >
                        <Link2 className="size-3.5" />
                        {t("oauth.connect")}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        {t("oauth.connectHint")}
                      </p>
                    </div>

                    <details className="rounded-md border border-border/70 px-3 py-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {t("oauth.manualToggle")}
                      </summary>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {t("oauth.manualHint")}
                      </p>

                      <div className="mt-3 grid gap-2 sm:max-w-sm">
                        <Label htmlFor={`${channel}-id`} className="text-muted-foreground">
                          {t(meta.idLabelKey)}
                        </Label>
                        <Input
                          id={`${channel}-id`}
                          dir="ltr"
                          inputMode="numeric"
                          value={draft.externalId}
                          placeholder={t(meta.idPlaceholderKey)}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [channel]: { ...prev[channel], externalId: e.target.value },
                            }))
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">{t(meta.docsKey)}</p>
                      </div>

                      <div className="mt-3 grid gap-2">
                        <Label htmlFor={`${channel}-token`} className="text-muted-foreground">
                          {t("tokenLabel")}
                        </Label>
                        <Input
                          id={`${channel}-token`}
                          dir="ltr"
                          type="password"
                          autoComplete="off"
                          value={draft.token}
                          placeholder="EAAG…"
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [channel]: { ...prev[channel], token: e.target.value },
                            }))
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">{t("tokenHint")}</p>
                      </div>

                      <Button
                        size="sm"
                        className="mt-3"
                        disabled={busy || !draft.externalId.trim() || !draft.token.trim()}
                        onClick={() => void save(channel)}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            {t("saving")}
                          </>
                        ) : config ? (
                          t("reconnect")
                        ) : (
                          t("connect")
                        )}
                      </Button>
                    </details>
                  </>
                )}

                {!editable && !profileLoading && (
                  <p className="text-xs text-muted-foreground">{t("adminOnly")}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
