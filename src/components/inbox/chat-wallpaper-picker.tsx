'use client';

import { useId, useRef, useState } from 'react';
import {
  Check,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useChatWallpaper } from '@/hooks/use-chat-wallpaper';
import {
  DEFAULT_PHOTO_OPACITY,
  MAX_PHOTO_DATA_URL_CHARS,
  MIN_PHOTO_OPACITY,
  WALLPAPER_IDS,
  hasCustomLook,
  isPhotoTooLarge,
  type WallpaperId,
} from '@/lib/chat-wallpaper';
import { cn } from '@/lib/utils';

/**
 * Chat wallpaper picker — the WhatsApp-style "change the chat background"
 * control, shared by Settings → Appearance and the paint button in the thread
 * header (so an agent can repaint the chat without leaving it).
 *
 * Every tile paints itself with the real `data-chat-wallpaper` attribute and
 * the real bubble tokens, so what the picker shows is literally what the
 * thread will look like — no separate mock palette to drift.
 */
export function ChatWallpaperPicker({
  variant = 'panel',
  onBeforeFileDialog,
}: {
  /** `panel` = full settings section; `popover` = compact, inside the header. */
  variant?: 'panel' | 'popover';
  /**
   * Fired right before the native file dialog opens. The popover variant uses
   * it to suppress the dismissal the browser reports for that hand-off.
   */
  onBeforeFileDialog?: () => void;
}) {
  const t = useTranslations('ChatWallpaper');
  const { wallpaper, updateWallpaper, resetWallpaper } = useChatWallpaper();
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPopover = variant === 'popover';

  const persist = (ok: boolean) => {
    setError(ok ? null : t('storageFull'));
  };

  const onPickPreset = (id: WallpaperId) => {
    persist(updateWallpaper({ id }));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await prepareWallpaperPhoto(file);
      if (isPhotoTooLarge(dataUrl)) {
        setError(t('photoTooLarge'));
        return;
      }
      persist(updateWallpaper({ photo: dataUrl }));
    } catch {
      setError(t('photoReadFailed'));
    } finally {
      setBusy(false);
      // Allow re-picking the same file after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      data-wallpaper-picker
      className={cn('space-y-4', isPopover && 'space-y-3')}
    >
      {/* Preset canvases */}
      <div
        role="radiogroup"
        aria-label={t('presetGroup')}
        className={cn(
          'grid gap-2',
          isPopover ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'
        )}
      >
        {WALLPAPER_IDS.map((id) => {
          const isActive = wallpaper.id === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={t(`presets.${id}`)}
              onClick={() => onPickPreset(id)}
              className={cn(
                'chat-surface group relative flex h-16 flex-col justify-end overflow-hidden rounded-lg border p-1.5 transition-all',
                isActive
                  ? 'border-primary/70 ring-primary/40 ring-2'
                  : 'border-border hover:border-primary/40'
              )}
              data-chat-wallpaper={id}
            >
              {/* Mini conversation: one outgoing, one incoming — the pair the
                  contrast fix is about, at 1:1 with the real tokens. */}
              <span aria-hidden className="flex flex-col items-end gap-1">
                <span className="bg-chat-out h-2 w-9 rounded-full" />
                <span className="bg-chat-in ring-chat-ring h-2 w-6 rounded-full ring-1 ring-inset" />
              </span>
              {isActive && (
                <span className="bg-primary text-primary-foreground absolute end-1 top-1 flex h-4 w-4 items-center justify-center rounded-full">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
              <span
                className={cn(
                  'absolute inset-x-1 top-1 truncate rounded px-1 text-start text-[10px] font-medium backdrop-blur-sm',
                  'bg-card/75 text-foreground',
                  isActive && 'bg-primary/90 text-primary-foreground'
                )}
                aria-hidden
              >
                {t(`presets.${id}`)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom photo */}
      <div className="border-border bg-card rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
              <ImagePlus className="text-muted-foreground size-3.5" />
              {t('photoTitle')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
              {t('photoHint')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <label
              htmlFor={fileInputId}
              onClick={() => onBeforeFileDialog?.()}
              className={cn(
                'border-border text-foreground hover:bg-muted/60 inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                busy && 'pointer-events-none opacity-60'
              )}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {wallpaper.photo ? t('replacePhoto') : t('uploadPhoto')}
            </label>
            <input
              ref={fileRef}
              id={fileInputId}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {wallpaper.photo && (
              <button
                type="button"
                onClick={() => persist(updateWallpaper({ photo: null }))}
                aria-label={t('removePhoto')}
                title={t('removePhoto')}
                className="border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {wallpaper.photo && (
          <div className="mt-3 flex items-center gap-2">
            <span
              aria-hidden
              className="border-border size-8 shrink-0 rounded border bg-cover bg-center"
              style={{ backgroundImage: `url(${wallpaper.photo})` }}
            />
            <label
              htmlFor={`${fileInputId}-opacity`}
              className="text-muted-foreground text-[11px] font-medium"
            >
              {t('photoOpacity')}
            </label>
            <input
              id={`${fileInputId}-opacity`}
              type="range"
              min={MIN_PHOTO_OPACITY * 100}
              max={100}
              step={5}
              defaultValue={Math.round(
                (wallpaper.photoOpacity || DEFAULT_PHOTO_OPACITY) * 100
              )}
              onChange={(e) =>
                updateWallpaper({ photoOpacity: Number(e.target.value) / 100 })
              }
              className="bg-muted accent-primary h-1.5 flex-1 cursor-pointer appearance-none rounded-full"
            />
            <span className="text-muted-foreground w-9 shrink-0 text-[11px] tabular-nums">
              {Math.round(wallpaper.photoOpacity * 100)}%
            </span>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="text-destructive mt-2 text-[11px] font-medium"
          >
            {error}
          </p>
        )}
      </div>

      {hasCustomLook(wallpaper) && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            resetWallpaper();
          }}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors"
        >
          <RotateCcw className="size-3" />
          {t('reset')}
        </button>
      )}
    </div>
  );
}

/** Longest edge of a stored wallpaper photo. Phone screenshots are 3–4k wide
 *  and pointless at this size — the canvas is a background, not a gallery. */
const MAX_EDGE_PX = 1600;

/**
 * Downscale + re-encode a picked image until it fits the localStorage budget.
 *
 * Steps down deliberately: a 4 MB camera JPEG is ~5.5 MB of base64 and would
 * blow the origin quota on its own. Each attempt re-renders at a smaller edge
 * and lower quality; the first one under the cap wins. Throws when even the
 * smallest attempt is too big (an already-pathological source).
 */
async function prepareWallpaperPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('not-an-image');
  }

  const attempts: Array<[number, number]> = [
    [MAX_EDGE_PX, 0.82],
    [1280, 0.72],
    [1024, 0.62],
    [768, 0.5],
  ];

  const bitmap = await createBitmap(file);
  try {
    for (const [edge, quality] of attempts) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no-2d-context');
      ctx.drawImage(bitmap, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_PHOTO_DATA_URL_CHARS) return dataUrl;
    }
  } finally {
    // Free the decoded frame early; large photos hold a lot of memory.
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
  throw new Error('too-large');
}

type DecodedImage = ImageBitmap & { close?: () => void };

/** `createImageBitmap` where available, `<img>` decode everywhere else. */
async function createBitmap(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    return (await createImageBitmap(file)) as DecodedImage;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img as unknown as DecodedImage;
  } finally {
    URL.revokeObjectURL(url);
  }
}
