"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EDIT_TEXT_MAX, editModeFor, normalizeEditText } from "@/lib/whatsapp/message-edit";
import type { Message } from "@/types";

interface MessageEditDialogProps {
  /** The message being edited; null keeps the dialog closed. */
  message: Message | null;
  onClose: () => void;
  /** Called after a successful save so the thread can patch its state. */
  onSaved: (
    messageId: string,
    patch: Partial<Message>,
    mode: "in_place" | "correction",
  ) => void;
}

/**
 * One dialog, two truths.
 *
 * WhatsApp's Cloud API cannot edit a message that already reached the
 * recipient, so the copy changes with the message: a failed send is
 * rewritten in place (and re-sent), a delivered one gets a correction
 * that quotes it. The agent always sees which of the two is about to
 * happen before pressing the button.
 */
export function MessageEditDialog({
  message,
  onClose,
  onSaved,
}: MessageEditDialogProps) {
  const t = useTranslations("Inbox.edit");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const mode = message ? editModeFor(message) : "blocked";

  // Reset to the message's own text every time a new target opens.
  useEffect(() => {
    setText(message?.content_text ?? "");
  }, [message]);

  const normalized = normalizeEditText(text);
  const unchanged = (message?.content_text ?? "").trim() === (normalized.text ?? "");
  const canSave = Boolean(message) && mode !== "blocked" && !!normalized.text && !unchanged && !saving;

  const handleSave = async () => {
    if (!message || !canSave) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/whatsapp/messages/${message.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_text: normalized.text }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Prefer a localised message for the machine codes we know; the
        // server's own text is English-at-build (Api catalogue), so it is
        // the fallback rather than the first choice.
        const code = typeof payload?.code === "string" ? payload.code : "";
        const reason =
          code && t.has(`errors.${code}`)
            ? t(`errors.${code}`)
            : payload?.error || `HTTP ${res.status}`;
        toast.error(t("failed", { reason }));
        return;
      }

      if (payload.mode === "in_place") {
        // Same row, new text — patch it locally so the bubble updates
        // even if realtime is disconnected.
        onSaved(
          message.id,
          {
            content_text: normalized.text ?? "",
            status: "sent",
            edited_at: new Date().toISOString(),
            error_code: null,
            error_title: null,
            error_details: null,
          },
          "in_place",
        );
        toast.success(t("savedInPlace"));
      } else {
        onSaved(
          message.id,
          {
            edited_at: new Date().toISOString(),
            correction_message_id: payload.message_id ?? null,
          },
          "correction",
        );
        toast.success(t("sentCorrection"));
      }
      onClose();
    } catch (err) {
      toast.error(
        t("failed", { reason: err instanceof Error ? err.message : "network" }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-popover border-border sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <PencilLine className="h-4 w-4" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {mode === "in_place" ? t("descInPlace") : t("descCorrection")}
          </DialogDescription>
        </DialogHeader>

        {mode === "correction" && (
          <div className="flex items-start gap-2 rounded border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("correctionNotice")}</p>
          </div>
        )}

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={EDIT_TEXT_MAX}
          dir="auto"
          autoFocus
          placeholder={t("placeholder")}
          className="resize-none"
        />

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {t("counter", { count: text.trim().length, max: EDIT_TEXT_MAX })}
          </span>
          {mode === "correction" && text.trim() && (
            <span dir="auto" className="max-w-[60%] truncate">
              {t("previewLabel")}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="gap-1.5"
          >
            <PencilLine className="h-4 w-4" />
            {mode === "in_place" ? t("save") : t("sendCorrection")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
