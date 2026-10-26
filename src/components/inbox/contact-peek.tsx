"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "./channel-badge";
import type { PhoneCandidate } from "@/lib/contacts/phone-detect";

/** Window event the inbox listens for to open a thread by id. */
export const OPEN_CONVERSATION_EVENT = "exbolt:open-conversation";

interface PeekContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  channel: string;
  tags: { name: string; color: string }[];
}

interface LookupResponse {
  contact: PeekContact | null;
  conversation_id: string | null;
}

interface ContactPeekProps {
  candidate: PhoneCandidate;
  /** The phone as it appeared in the message, for the trigger label. */
  label: string;
  /** Outbound bubbles sit on the primary fill — invert the affordances. */
  onPrimary?: boolean;
  className?: string;
}

/**
 * A phone number inside a message body, made actionable.
 *
 * Opens a popover with whatever the CRM already knows about that number
 * (requirement: "show the contact's data if available") and, crucially,
 * lets the agent start a chat *without* a detour through Contacts — the
 * contact is created on the fly by /api/contacts/open-chat if it does not
 * exist yet.
 *
 * Keyboard/a11y: it is a real button (focusable, Enter/Space open the
 * popover), and the popover is Base UI's, which already traps focus and
 * restores it on close.
 */
export function ContactPeek({
  candidate,
  label,
  onPrimary = false,
  className,
}: ContactPeekProps) {
  const t = useTranslations("Inbox.contactPeek");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  // `+201012345678` when derivable, else the raw digits — the route accepts
  // both and does the fuzzy match against the account's contact book.
  const phone = candidate.e164 ?? candidate.digits;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(
          `/api/contacts/lookup?phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" },
        );
        const payload = (await res.json().catch(() => ({}))) as LookupResponse;
        if (!cancelled && res.ok) setData(payload);
        else if (!cancelled) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, phone]);

  const openConversation = useCallback(
    (conversationId: string) => {
      window.dispatchEvent(
        new CustomEvent(OPEN_CONVERSATION_EVENT, {
          detail: { conversationId },
        }),
      );
      setOpen(false);
    },
    [],
  );

  const startChat = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/contacts/open-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: data?.contact?.name ?? undefined }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        conversation_id?: string;
        contact_created?: boolean;
        error?: string;
      };
      if (!res.ok || !payload.conversation_id) {
        toast.error(payload.error ?? t("chatFailed"));
        return;
      }
      toast.success(
        payload.contact_created ? t("contactCreated") : t("chatOpened"),
      );
      openConversation(payload.conversation_id);
    } catch {
      toast.error(t("chatFailed"));
    } finally {
      setCreating(false);
    }
  }, [creating, data?.contact?.name, openConversation, phone, t]);

  const contact = data?.contact ?? null;
  const hasThread = !!data?.conversation_id;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline rounded-sm underline decoration-dotted underline-offset-2 transition-colors",
          onPrimary
            ? "decoration-primary-foreground/60 hover:bg-primary-foreground/15"
            : "decoration-muted-foreground/70 hover:bg-foreground/5 hover:decoration-foreground/60",
          className,
        )}
        title={t("triggerTitle")}
      >
        {label}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 gap-3 p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("loading")}
          </div>
        ) : failed ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t("lookupFailed")}
          </p>
        ) : (
          <>
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {contact?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={contact.avatar_url}
                    alt={contact.name ?? phone}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  (contact?.name ?? phone).charAt(0)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {contact?.name || t("unknownName")}
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span dir="ltr">{contact?.phone || phone}</span>
                </p>
              </div>
              <ChannelBadge channel={contact?.channel ?? "whatsapp"} size="xs" />
            </div>

            {contact && (contact.email || contact.company) && (
              <dl className="space-y-1 border-t border-border pt-2 text-xs">
                {contact.company && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <dd className="truncate text-foreground">{contact.company}</dd>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    <dd className="truncate text-foreground" dir="ltr">
                      {contact.email}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {contact && contact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((tag) => (
                  <span
                    key={`${tag.name}-${tag.color}`}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {!contact && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("notFoundHint")}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={creating || !candidate.e164}
                onClick={() => void startChat()}
                title={!candidate.e164 ? t("incompleteNumber") : undefined}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : hasThread ? (
                  <MessageSquare className="h-3 w-3" />
                ) : (
                  <UserPlus className="h-3 w-3" />
                )}
                {hasThread ? t("openChat") : t("startChat")}
              </Button>

              {contact && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/contacts?contact=${contact.id}`);
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("openContact")}
                </Button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
