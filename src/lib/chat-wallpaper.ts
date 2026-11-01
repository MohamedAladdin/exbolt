/**
 * Chat wallpaper — what sits *behind* the message bubbles in the inbox.
 *
 * WhatsApp lets every user repaint their chat, and agents who live in this
 * screen all day asked for the same control here. The choice is a legibility
 * preference (like the theme or the Arabic type scale), so it is device-scoped
 * and stored in localStorage — never synced to the account and never uploaded.
 *
 * Two invariants this module exists to protect:
 *
 *  1. **The wallpaper can never hurt the text.** Bubble fills and their
 *     foregrounds are separate CSS tokens (`--chat-out`, `--chat-out-foreground`,
 *     `--chat-in`, `--chat-in-foreground` in `src/app/globals.css`), so a wild
 *     photo or a dark canvas changes the *room*, never the letters.
 *  2. **Stored garbage never renders.** Settings live in localStorage, which
 *     any user (or extension) can edit; `parseChatWallpaper` is total — it
 *     returns a valid setting for every possible input.
 */

export const CHAT_WALLPAPER_STORAGE_KEY = 'exbolt:chat:wallpaper';

/**
 * Preset canvases. `doodle` is the WhatsApp-style pattern the inbox shipped
 * with; the rest are flat surfaces tuned per mode in globals.css
 * (`[data-chat-wallpaper="…"]`). Ids are the CSS attribute values, so adding
 * one is a two-file change: this list + a globals.css block per mode.
 */
export const WALLPAPER_IDS = [
  'doodle',
  'plain',
  'sand',
  'sage',
  'sky',
  'lilac',
  'rose',
  'graphite',
] as const;

export type WallpaperId = (typeof WALLPAPER_IDS)[number];

export const DEFAULT_WALLPAPER_ID: WallpaperId = 'doodle';

/**
 * Photo opacity bounds. The floor keeps a chosen photo visible (otherwise
 * "I picked a photo and nothing happened"), the ceiling keeps the canvas from
 * becoming the photo itself.
 */
export const MIN_PHOTO_OPACITY = 0.15;
export const MAX_PHOTO_OPACITY = 1;
export const DEFAULT_PHOTO_OPACITY = 0.45;

/**
 * A base64 data URL we are willing to keep in localStorage. ~1.4 MB of string
 * is ≈ 1 MB of image, and browsers cap the whole origin at 5 MB — the rest of
 * that budget already holds the theme, font and draft state. Uploads are
 * downscaled to fit before they get here (see `prepareWallpaperPhoto`).
 */
export const MAX_PHOTO_DATA_URL_CHARS = 1_400_000;

export interface ChatWallpaper {
  id: WallpaperId;
  /** Device-stored custom photo (data URL), or null for a preset alone. */
  photo: string | null;
  /** How strongly the photo shows through, 0.15–1. */
  photoOpacity: number;
}

export const DEFAULT_CHAT_WALLPAPER: ChatWallpaper = {
  id: DEFAULT_WALLPAPER_ID,
  photo: null,
  photoOpacity: DEFAULT_PHOTO_OPACITY,
};

export function isWallpaperId(value: unknown): value is WallpaperId {
  return (
    typeof value === 'string' &&
    (WALLPAPER_IDS as ReadonlyArray<string>).includes(value)
  );
}

/** Clamp any number-like input into the accepted opacity band. */
export function clampPhotoOpacity(value: unknown): number {
  // Only a real number or a non-empty numeric string counts. `Number("")` is
  // 0, and 0 is a legal *clamped* value — so an empty string would otherwise
  // become "photo barely visible" instead of "no opinion, use the default".
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_PHOTO_OPACITY;
  return Math.min(MAX_PHOTO_OPACITY, Math.max(MIN_PHOTO_OPACITY, n));
}

/**
 * Only an inline image data URL may be stored. `javascript:` and remote
 * `http(s):` URLs are rejected on purpose: the value reaches a CSS
 * `background-image`, and a remote URL would leak an agent's chat canvas
 * (with its referrer) to whoever hosts it.
 */
export function isWallpaperPhoto(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^data:image\/(png|jpe?g|webp|avif);base64,/i.test(value) &&
    value.length <= MAX_PHOTO_DATA_URL_CHARS
  );
}

export function isPhotoTooLarge(value: string): boolean {
  return value.length > MAX_PHOTO_DATA_URL_CHARS;
}

/** Total parse of a stored value: always returns a renderable setting. */
export function parseChatWallpaper(
  raw: string | null | undefined
): ChatWallpaper {
  if (!raw) return DEFAULT_CHAT_WALLPAPER;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CHAT_WALLPAPER;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return DEFAULT_CHAT_WALLPAPER;
  }

  const candidate = parsed as Partial<Record<keyof ChatWallpaper, unknown>>;
  return {
    // An unknown preset id degrades to the default one instead of rendering
    // an unpainted canvas; the photo survives, since it is independent.
    id: isWallpaperId(candidate.id) ? candidate.id : DEFAULT_WALLPAPER_ID,
    photo: isWallpaperPhoto(candidate.photo) ? candidate.photo : null,
    photoOpacity: clampPhotoOpacity(candidate.photoOpacity),
  };
}

export function serializeChatWallpaper(wallpaper: ChatWallpaper): string {
  return JSON.stringify({
    id: isWallpaperId(wallpaper.id) ? wallpaper.id : DEFAULT_WALLPAPER_ID,
    photo: isWallpaperPhoto(wallpaper.photo) ? wallpaper.photo : null,
    photoOpacity: clampPhotoOpacity(wallpaper.photoOpacity),
  });
}

/** True when the setting differs from the shipped look (drives «استرجاع»). */
export function hasCustomLook(wallpaper: ChatWallpaper): boolean {
  return (
    wallpaper.id !== DEFAULT_WALLPAPER_ID ||
    wallpaper.photo !== null ||
    wallpaper.photoOpacity !== DEFAULT_PHOTO_OPACITY
  );
}
