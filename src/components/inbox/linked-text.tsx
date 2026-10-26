"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { segmentByPhone } from "@/lib/contacts/phone-detect";
import { ContactPeek } from "./contact-peek";

interface LinkedTextProps {
  text: string;
  className?: string;
  /** Outbound bubbles sit on the primary fill — invert the affordances. */
  onPrimary?: boolean;
}

/**
 * Message body with phone numbers turned into contact cards.
 *
 * Renders exactly the same markup as a plain `<p>` (whitespace preserved,
 * long words broken) so it is a drop-in replacement; the only difference is
 * that digit runs which pass `findPhoneMatches` become buttons that open
 * the contact peek. Everything else — URLs, emoji, line breaks — is left
 * to the browser as before.
 */
export function LinkedText({ text, className, onPrimary = false }: LinkedTextProps) {
  const segments = useMemo(() => segmentByPhone(text), [text]);

  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm", className)}>
      {segments.map((segment, index) =>
        segment.kind === "phone" ? (
          <ContactPeek
            key={`phone-${index}`}
            candidate={segment.candidate}
            label={segment.text}
            onPrimary={onPrimary}
          />
        ) : (
          <span key={`text-${index}`}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
