"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  currentLocale,
  currentPermission,
  enablePush,
  getExistingSubscription,
} from "@/hooks/use-push";
import {
  readPromptDismissals,
  recordPromptDismissal,
  shouldShowPushPrompt,
  type PromptDecision,
} from "@/lib/push/prompt";

/**
 * The one-time ask: «فعّل إشعارات المتصفح عشان يوصلك كل جديد أول بأول».
 *
 * Deliberately not a modal and not a permission dialog on load — Chrome
 * quiet-blocks an unprompted `Notification.requestPermission()` and the block is
 * what the user is stuck with. The bar appears once, its button is the gesture that
 * asks, and «مش دلوقتي» buys two weeks of silence, then one reminder, then nothing.
 *
 * The decision itself is pure (`lib/push/prompt.ts`); this component only renders it
 * and remembers the dismissal on this device.
 */
export function PushPrompt() {
  const t = useTranslations("PushPrompt");
  const [decision, setDecision] = useState<PromptDecision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { dismissals, dismissedAt } = readPromptDismissals();
      const subscribed = Boolean(await getExistingSubscription());
      if (cancelled) return;
      setDecision(
        shouldShowPushPrompt({
          permission: currentPermission(),
          subscribed,
          dismissals,
          dismissedAt,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!decision?.show) return null;

  const dismiss = () => {
    recordPromptDismissal();
    setDecision(null);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enablePush(currentLocale());
      if (result.ok) {
        toast.success(t("enabledToast"));
        setDecision(null);
        return;
      }
      toast.error(result.reason === "not_configured" ? t("notConfigured") : t("failed"));
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  const denied = decision.variant === "denied";

  return (
    <div className="border-border bg-card mx-4 mt-3 flex flex-col gap-3 rounded-xl border p-3 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <BellRing className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-foreground text-sm font-medium">{denied ? t("deniedTitle") : t("title")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {denied ? t("deniedBody") : t("body")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 ps-12 sm:ps-0">
        {!denied && (
          <Button type="button" size="sm" onClick={() => void enable()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
            {t("enable")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
          <X className="size-4" />
          {denied ? t("ok") : t("later")}
        </Button>
      </div>
    </div>
  );
}
