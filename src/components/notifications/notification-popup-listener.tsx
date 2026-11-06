"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, Bot, TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { alertTypeForRow, inAppAlertAllowed } from "@/lib/notifications/gate";
import {
  isPopupType,
  popupBody,
  popupHref,
  rememberOnce,
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
 *   - tab hidden → sonner queues the same card and it is there when they come back,
 *     while the service worker's push banner covers the "not looking" case;
 *   - every case rings the chime (see `sound.ts`), independently of the OS sound.
 *
 * The card is NOT a desktop notification any more. This listener used to raise its
 * own `new Notification(...)` whenever the tab was hidden and the browser allowed
 * it, which ignored every switch in Settings — an operator who turned «إسناد
 * محادثة» off still got the banner, and once Web Push shipped the same row could
 * produce two banners. Out-of-app alerts now come from the worker alone (one switch,
 * one path); this component owns the in-app card and obeys `inAppAlertAllowed`.
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
  const { prefs } = useNotificationPreferences();

  // Replay guard: realtime redelivers after a reconnect and each tab holds
  // its own listener.
  const seen = useRef<Set<string>>(new Set());

  // The channel is opened once; the switches are read per event through a ref so
  // flipping a toggle does not tear the subscription down.
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  });

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

      const type = alertTypeForRow(row.type);
      if (!type) return;
      // The same switches that gate the phone gate this card: a type switched off
      // in Settings must not pop here, and quiet hours mean quiet here too.
      if (!inAppAlertAllowed(prefsRef.current, type)) return;

      const title = typeLabel(row.type);
      const body = popupBody(row.body);
      const Icon = TYPE_ICON[row.type];

      playNotificationChime();

      toast(title, {
        // `dir="auto"`: the stored body is one Latin sentence with the
        // customer's Arabic inside it ("AI agent handed off … “عايز أعرف
        // سعر الكشف”"). Inherited RTL reorders the two runs and reads as
        // jumbled; auto picks the direction of the first strong character.
        description: body ? <span dir="auto">{body}</span> : undefined,
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
