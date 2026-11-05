/**
 * What a Settings → Agent → Setup save is allowed to write into
 * `ai_configs.handoff_message`.
 *
 * The column is optional free text, and the API distinguishes two shapes:
 * an ABSENT key leaves the stored note alone, while an empty string clears it.
 * Both are needed — but the form can only tell them apart if it knows whether a
 * human actually touched the box. An untouched field must therefore stay
 * absent: the screen used to send `null` on every save, so a page that painted
 * before the row arrived (or a read that failed, or a refresh) wiped a transfer
 * note the tenant had already saved — exactly the report «محفوظة على السيرفر
 * لكن الصفحة بتفتحها فاضية، ولو حد عمل Save هتتمسح».
 */
export function handoffMessagePayload(
  value: string,
  edited: boolean,
): string | null | undefined {
  if (!edited) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
