/**
 * The notifications page's quick settings — which switches it carries, and the one
 * link to the rest.
 *
 * Pure and React-free so the href is guarded by a test instead of by somebody
 * noticing that the button "does nothing": `/settings?tab=notification` (one letter
 * short) resolves to the Overview landing, and the click then looks like a dead
 * button rather than a wrong constant.
 */

import { TYPE_KEYS, type TypeKey } from "@/lib/push/preferences";

/**
 * Settings → الإشعارات. `resolveSection` reads `?tab=`, and `notifications` is one
 * of its `SettingsSection` values; the test asserts that resolution rather than
 * trusting the string.
 */
export const NOTIFICATIONS_SETTINGS_HREF = "/settings?tab=notifications";

/**
 * The type switches the card shows: exactly the preference catalogue, in its own
 * order. Derived rather than retyped so a fifth notification type appears here
 * without anyone remembering to come back for it.
 */
export const QUICK_TYPE_KEYS: readonly TypeKey[] = TYPE_KEYS;
