"use client";

import { useMemo } from "react";
import Linkify from "linkify-react";

import { cn } from "@/lib/utils";
import { segmentByPhone } from "@/lib/contacts/phone-detect";
import { ContactPeek } from "./contact-peek";

interface LinkedTextProps {
  text: string;
  className?: string;
  /** Outbound bubbles sit on the primary fill — invert the affordances. */
  onPrimary?: boolean;
}

interface LinkifiedSpanProps {
  text: string;
  onPrimary?: boolean;
}

/**
 * One text segment with safe, clickable HTTP(S)/www links.
 *
 * Kept separate from `LinkedText` on purpose: it carries no phone handling
 * and no next-intl/next-navigation imports, so it renders in a node test.
 * Phone detection and URL linkification are two different features that both
 * own the message body — upstream wacrm ships only linkified URLs, this fork
 * ships both, composed here (phone segments become contact cards, everything
 * between them is linkified).
 */
export function LinkifiedSpan({ text, onPrimary = false }: LinkifiedSpanProps) {
  return (
    <Linkify
      as="span"
      options={{
        defaultProtocol: "https",
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        className: onPrimary
          ? "underline underline-offset-2 opacity-90 hover:opacity-70"
          : "text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300",
        validate: {
          url: (url: string) => /^https?:\/\//i.test(url) || /^www\./i.test(url),
        },
      }}
    >
      {text}
    </Linkify>
  );
}

/**
 * Message body with phone numbers turned into contact cards and URLs made
 * clickable.
 *
 * Renders exactly the same markup as a plain `<p>` (whitespace preserved,
 * long words broken) so it is a drop-in replacement; digit runs which pass
 * `findPhoneMatches` become buttons that open the contact peek, and the text
 * between them is linkified so a URL is tappable without a second bubble.
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
          <LinkifiedSpan
            key={`text-${index}`}
            text={segment.text}
            onPrimary={onPrimary}
          />
        ),
      )}
    </p>
  );
}
