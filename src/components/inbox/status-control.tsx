"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ConversationStatus } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Thread status control — one quick action plus a menu for the rest.
 *
 * The old control was a single dropdown that listed the three statuses
 * (مفتوحة / معلّقة / مغلقة) with equal weight, which made the agent read two
 * labels before acting on the one thing they do all day: put the thread to
 * rest (or bring it back). Now the button itself is the action and the
 * chevron holds everything else:
 *
 *   open / pending → [ غلق ] [▾]   menu: مفتوحة ✓, معلّقة
 *   closed         → [ فتح ] [▾]   menu: معلّقة, مغلقة ✓
 *
 * The current status is never a target — it renders with a check and is
 * disabled — so the menu can only offer real transitions.
 *
 * `pending` has no primary of its own on purpose: it is what the job derives
 * from a lapsed 24h window, and the honest way out is the customer writing
 * back (which reopens the thread in the database trigger). The menu still
 * offers it for a manual hold.
 */
export function StatusControl({
  status,
  onChange,
  className,
}: {
  status: ConversationStatus;
  onChange: (status: ConversationStatus) => void;
  className?: string;
}) {
  const t = useTranslations("Inbox.messageThread");

  const isClosed = status === "closed";
  const primaryTarget: ConversationStatus = isClosed ? "open" : "closed";
  const primaryLabel = isClosed ? t("statusActionOpen") : t("statusActionClose");

  const ALL_OPTIONS: { value: ConversationStatus; label: string; tone: string }[] = [
    { value: "open", label: t("statusOpen"), tone: "text-primary" },
    { value: "pending", label: t("statusPending"), tone: "text-amber-400" },
    { value: "closed", label: t("statusClosed"), tone: "text-muted-foreground" },
  ];
  const menuOptions = ALL_OPTIONS.filter(
    (option) => option.value !== primaryTarget,
  );

  return (
    <div
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(primaryTarget)}
        aria-label={primaryLabel}
        title={primaryLabel}
        className={cn(
          "inline-flex items-center px-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          isClosed ? "text-primary" : "text-muted-foreground",
        )}
      >
        {primaryLabel}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("statusChange")}
          title={t("statusChange")}
          className="inline-flex w-6 items-center justify-center border-s border-border bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
        >
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-border bg-popover">
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {t("status")}
          </div>
          {menuOptions.map((option) => {
            const isCurrent = option.value === status;
            return (
              <DropdownMenuItem
                key={option.value}
                disabled={isCurrent}
                onClick={() => {
                  if (isCurrent) return;
                  onChange(option.value);
                }}
                className={cn("justify-between text-sm", option.tone)}
              >
                <span>{option.label}</span>
                {isCurrent && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
