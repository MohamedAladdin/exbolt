"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, Bot, TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  desktopNotificationOptions,
  getNotificationPermission,
} from "@/lib/notifications/browser-notify";
import {
  isPopupType,
  popupBody,
  popupHref,
  rememberOnce,
  shouldShowDesktop,
  type PopupType,
} from "@/lib/notifications/popup";
import {
  attachAudioUnlock,
  playNotificationChime,
} from "@/lib/notifications/sound";
import type { Notification as AppNotification } from "@/types";

const TYPE_ICON: Record<PopupType, typeof Bell> = {
  conversation_assigned: UserPlus,
  ai_handoff_unassigned: Bot,
  report_alert: TriangleAlert,
};

/**
 * Makes a new `notifications` row impossible to miss.
 *
 * Before this listener an assignment, an AI handoff and a report alert all
 * landed the same way: a row in a list nobody was looking at, plus a badge
 * that only exists on the Notifications page. The alert was "delivered" and
 * still went unseen.
 *
 * Three surfaces, chosen by where the user actually is:
 *   - tab in front of them → a sonner card, top-right, with an action;
 *   - tab hidden + browser permission granted → a desktop notification that
 *     stays on screen (`requireInteraction`) and opens the conversation;
 *   - tab hidden, no permission → the card is queued by sonner and is there
 *     when they come back.
 * Every case plays the chime (see `sound.ts`), independently of the OS's own
 * notification sound.
 *
 * Mount ONCE per signed-in dashboard tab — the dashboard shell does it next
 * to <BrowserNotificationsListener />.
 */
export function NotificationPopupListener() {
  const { user, accountId } = useAuth();
  const router = useRouter();
  const t = useTranslations("NotificationPopups");
  const typeLabel = useTranslations("NotificationTypes");
  const userId = user?.id ?? null;

  // Replay guard: realtime redelivers after a reconnect and each tab holds
  // its own listener.
  const seen = useRef<Set<string>>(new Set());

  // Audio can only start after a gesture — retried on every gesture until
  // the context is actually running (see attachAudioUnlock).
  useEffect(() => attachAudioUnlock(), []);

  useEffect(() => {
    if (!userId || !accountId) return;

    const supabase = createClient();

    const open = async (row: AppNotification) => {
      // Mark read BEFORE navigating: a same-origin navigation aborts the
      // in-flight PATCH, which left the alert unread and the badge stale —
      // measured on the live box (read_at still null after the click).
      // Opening an alert is reading it, the same rule /notifications uses.
      try {
        await supabase
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("read_at", null);
      } catch {
        // Non-fatal: opening the alert still matters more than the badge.
      }
      router.push(popupHref(row));
    };

    const show = (row: AppNotification) => {
      if (!isPopupType(row.type)) return;
      if (row.account_id !== accountId) return;
      if (!rememberOnce(seen.current, row.id)) return;

      const title = typeLabel(row.type);
      const body = popupBody(row.body);
      const Icon = TYPE_ICON[row.type];

      playNotificationChime();

      if (
        shouldShowDesktop({
          documentVisible: document.visibilityState === "visible",
          permission: getNotificationPermission(),
        })
      ) {
        try {
          const desktop = new Notification(
            title,
            desktopNotificationOptions(
              { title, body },
              `exbolt-alert-${row.id}`,
            ),
          );
          desktop.onclick = () => {
            window.focus();
            void open(row);
            desktop.close();
          };
          return;
        } catch {
          // Android Chrome refuses the constructor outside a service worker;
          // fall through to the in-page card instead of losing the alert.
        }
      }

      toast(title, {
        description: body || undefined,
        icon: <Icon className="size-4 text-primary" aria-hidden />,
        duration: 12_000,
        action: { label: t("open"), onClick: () => void open(row) },
      });
    };

    const channel = supabase
      .channel(`notification-popups:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => show(payload.new as AppNotification),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, userId, router, t, typeLabel]);

  return null;
}
