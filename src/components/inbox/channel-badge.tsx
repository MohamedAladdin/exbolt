"use client";

import { Aperture, MessageCircle, MessagesSquare, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { toChannel, type Channel } from "@/lib/channels/types";

/**
 * Visual identity for the three inbox channels.
 *
 * The icons are deliberately *outline* glyphs at the same optical weight
 * as the rest of the icon set — a filled WhatsApp bubble next to an
 * outline lucide icon reads as a sticker. Colour is the differentiator
 * (emerald / blue / pink), which is also the only cue that survives
 * greyscale printing and the two themes, so the tint sits on a 15%
 * background chip rather than on the glyph alone.
 */
interface ChannelVisual {
  Icon: LucideIcon;
  /** Chip fill + glyph colour. */
  chip: string;
  /** Solid dot fill, for the avatar corner marker. */
  dot: string;
  label: string;
}

export const CHANNEL_VISUAL: Record<Channel, ChannelVisual> = {
  whatsapp: {
    Icon: MessageCircle,
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    label: "WhatsApp",
  },
  // lucide dropped its brand glyphs, so the channels are identified by
  // *shape + colour* rather than by a logo: a single speech bubble
  // (WhatsApp), a doubled one (Messenger's two-people chat), and an
  // aperture (Instagram's camera).
  messenger: {
    Icon: MessagesSquare,
    chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
    label: "Messenger",
  },
  instagram: {
    Icon: Aperture,
    chip: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    dot: "bg-pink-500",
    label: "Instagram",
  },
};

interface ChannelBadgeProps {
  channel: Channel | string | null | undefined;
  /** `sm` for list rows / header, `xs` for inline use. */
  size?: "xs" | "sm";
  /** Show the channel name next to the icon. */
  withLabel?: boolean;
  className?: string;
}

/**
 * Icon chip naming the transport a thread lives on. Used in the thread
 * header, the conversation list and the contact sidebar so the channel is
 * never ambiguous.
 */
export function ChannelBadge({
  channel,
  size = "sm",
  withLabel = false,
  className,
}: ChannelBadgeProps) {
  const resolved = toChannel(channel);
  const { Icon, chip, label } = CHANNEL_VISUAL[resolved];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-1 py-px text-[9px]",
        chip,
        className,
      )}
      title={label}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5"} aria-hidden />
      {withLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/**
 * Corner marker for an avatar. WhatsApp is the default and pre-existing
 * channel, so it stays unmarked to keep the list quiet — only the
 * channels a reader has to *notice* get a dot.
 */
export function ChannelAvatarDot({
  channel,
  className,
}: {
  channel: Channel | string | null | undefined;
  className?: string;
}) {
  const resolved = toChannel(channel);
  if (resolved === "whatsapp") return null;
  const { dot, label, Icon } = CHANNEL_VISUAL[resolved];

  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-card",
        dot,
        className,
      )}
      title={label}
    >
      <Icon className="h-2 w-2 text-white" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
