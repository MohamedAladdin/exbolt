/**
 * One place that turns a push failure into the message a human reads.
 *
 * Two surfaces offer the same switch — Settings → الإشعارات and the quick card on
 * the notifications page — and a failure that reads «تعذّر إتمام العملية» on one of
 * them while the other says «الإشعارات غير مُهيّأة على السيرفر» teaches the operator
 * that the two screens disagree about their own product. The mapping is a pure
 * function over `PushFailure`, returning a key in the
 * `Settings.notifications.device` namespace both surfaces already translate.
 *
 * `denied` deliberately maps to the hint rather than a bare "denied": the user has
 * to be told where the browser's lock icon is, otherwise the switch reads as broken.
 */

import type { PushFailure } from "@/hooks/use-push";

export type PushFailureMessageKey =
  | "notConfigured"
  | "tooManyDevices"
  | "stateDeniedHint"
  | "noDevice"
  | "stateUnsupported"
  | "failed";

const MESSAGES: Record<PushFailure, PushFailureMessageKey> = {
  unsupported: "stateUnsupported",
  denied: "stateDeniedHint",
  not_configured: "notConfigured",
  too_many_devices: "tooManyDevices",
  no_device: "noDevice",
  // The three transport failures a retry can actually fix: one honest sentence.
  network: "failed",
  save_failed: "failed",
  subscribe_failed: "failed",
};

export function pushFailureMessageKey(reason?: PushFailure): PushFailureMessageKey {
  return reason ? MESSAGES[reason] ?? "failed" : "failed";
}
