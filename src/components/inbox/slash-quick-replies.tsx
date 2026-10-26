"use client";

import { MessageSquare, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { QuickReply } from "@/types";
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive";

interface SlashQuickRepliesProps {
  items: QuickReply[];
  /** Keyboard-highlighted row. */
  activeIndex: number;
  loading: boolean;
  emptyLabel: string;
  onPick: (qr: QuickReply) => void;
  onHover: (index: number) => void;
}

/**
 * Inline suggestion list for the composer's `/` trigger.
 *
 * Sits above the composer as an overlay (not a dialog) so the agent keeps
 * typing while it narrows. Keyboard is the primary path — ↑/↓ move,
 * Enter/Tab insert, Esc dismisses — with the mouse as a fallback; that is
 * why the highlighted row is tracked by the composer and passed in rather
 * than living here.
 */
export function SlashQuickReplies({
  items,
  activeIndex,
  loading,
  emptyLabel,
  onPick,
  onHover,
}: SlashQuickRepliesProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-popover p-3 shadow-lg">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-popover px-3 py-2.5 text-xs text-muted-foreground shadow-lg">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Quick replies"
      className="max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      {items.map((qr, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={qr.id}
            type="button"
            role="option"
            aria-selected={isActive}
            // `onMouseDown` + preventDefault keeps focus in the textarea so
            // the caret/selection survive the click.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(qr);
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
              isActive ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            {qr.kind === "interactive" ? (
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {qr.title}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {qr.kind === "interactive" && qr.interactive_payload
                  ? interactivePayloadPreviewText(qr.interactive_payload)
                  : qr.content_text}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
