"use client";

import { useEffect, useMemo, useState } from "react";
import { Forward, Search, AlertTriangle } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FORWARD_TARGET_MAX,
  forwardPayloadFor,
} from "@/lib/whatsapp/forward-message";
import type { Message } from "@/types";

interface ForwardTarget {
  conversation_id: string;
  channel: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  last_message_at: string | null;
}

interface MessageForwardDialogProps {
  message: Message | null;
  onClose: () => void;
  /** Called with how many chats received the message. */
  onForwarded: (count: number) => void;
}

/**
 * Pick up to five chats and re-send the message into them.
 *
 * There is no forward endpoint on the Cloud API — this is a normal send
 * of the same payload into other conversations, labelled with the
 * forward marker in our own UI. Media is re-sent by its stored
 * `chat-media` URL, so a message whose attachment is gone says so here
 * instead of failing at Meta.
 */
export function MessageForwardDialog({
  message,
  onClose,
  onForwarded,
}: MessageForwardDialogProps) {
  const t = useTranslations("Inbox.forward");
  const [targets, setTargets] = useState<ForwardTarget[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const plan = message ? forwardPayloadFor(message) : { reason: undefined };
  const blocked = Boolean(message) && !plan.payload;

  // Load candidates once per opened message.
  useEffect(() => {
    if (!message) return;
    let cancelled = false;
    setLoading(true);
    setSelected([]);
    setQuery("");
    (async () => {
      try {
        const res = await fetch(
          `/api/whatsapp/forward/targets?exclude=${encodeURIComponent(message.conversation_id)}`,
        );
        const payload = await res.json().catch(() => ({ targets: [] }));
        if (!cancelled) setTargets(payload?.targets ?? []);
      } catch {
        if (!cancelled) setTargets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((row) =>
      `${row.name ?? ""} ${row.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [targets, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= FORWARD_TARGET_MAX) return prev;
      return [...prev, id];
    });
  };

  const handleSend = async () => {
    if (!message || selected.length === 0 || blocked) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: message.id,
          conversation_ids: selected,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = typeof payload?.code === "string" ? payload.code : "";
        const reason =
          code && t.has(`errors.${code}`)
            ? t(`errors.${code}`)
            : payload?.error || `HTTP ${res.status}`;
        toast.error(t("failed", { reason }));
        return;
      }

      const sentCount = Array.isArray(payload?.sent) ? payload.sent.length : 0;
      const failedCount = Array.isArray(payload?.failed) ? payload.failed.length : 0;
      if (failedCount > 0) {
        toast.warning(t("partial", { sent: sentCount, failed: failedCount }));
      } else {
        toast.success(t("sent", { count: sentCount }));
      }
      onForwarded(sentCount);
      onClose();
    } catch (err) {
      toast.error(
        t("failed", { reason: err instanceof Error ? err.message : "network" }),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <Forward className="h-4 w-4 rtl:-scale-x-100" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("desc", { max: FORWARD_TARGET_MAX })}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {plan.reason === "media_unavailable"
                ? t("mediaUnavailable")
                : plan.reason === "unsupported"
                  ? t("unsupported")
                  : t("noContent")}
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                className="ps-8"
                autoFocus
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-1">
              {loading && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t("loading")}
                </p>
              )}
              {!loading && filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {query ? t("noMatch") : t("empty")}
                </p>
              )}
              {filtered.map((row) => {
                const isSelected = selected.includes(row.conversation_id);
                const atCap =
                  !isSelected && selected.length >= FORWARD_TARGET_MAX;
                return (
                  <button
                    key={row.conversation_id}
                    type="button"
                    onClick={() => toggle(row.conversation_id)}
                    disabled={atCap}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors",
                      "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                      isSelected && "bg-primary/10",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {isSelected && <span className="text-[10px] leading-none">✓</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" dir="auto">
                        {row.name || row.phone || t("unknownContact")}
                      </span>
                      {row.name && row.phone && (
                        <span
                          className="block truncate text-[11px] text-muted-foreground"
                          dir="ltr"
                        >
                          {row.phone}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <span className="me-auto text-[11px] text-muted-foreground">
            {t("selected", {
              count: selected.length,
              max: FORWARD_TARGET_MAX,
            })}
          </span>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSend}
            disabled={blocked || sending || selected.length === 0}
            className="gap-1.5"
          >
            <Forward className="h-4 w-4 rtl:-scale-x-100" />
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
