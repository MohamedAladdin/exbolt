import { describe, expect, it } from 'vitest';

import {
  CHAT_WALLPAPER_STORAGE_KEY,
  DEFAULT_CHAT_WALLPAPER,
  DEFAULT_PHOTO_OPACITY,
  MAX_PHOTO_DATA_URL_CHARS,
  MIN_PHOTO_OPACITY,
  WALLPAPER_IDS,
  clampPhotoOpacity,
  hasCustomLook,
  isPhotoTooLarge,
  isWallpaperId,
  isWallpaperPhoto,
  parseChatWallpaper,
  serializeChatWallpaper,
} from './chat-wallpaper';

/**
 * The wallpaper setting lives in localStorage, which is user-editable and
 * survives deploys. `parseChatWallpaper` is the only thing between that string
 * and a rendered CSS `background-image`, so every branch of it is asserted
 * here — including the hostile ones.
 */

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('isWallpaperId', () => {
  it('accepts every published preset', () => {
    for (const id of WALLPAPER_IDS) expect(isWallpaperId(id)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'Doodle', 'brick', null, undefined, 3, {}]) {
      expect(isWallpaperId(value)).toBe(false);
    }
  });
});

describe('isWallpaperPhoto', () => {
  it('accepts inline raster data URLs', () => {
    expect(isWallpaperPhoto(PHOTO)).toBe(true);
    expect(isWallpaperPhoto('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isWallpaperPhoto('data:image/webp;base64,UklGRg==')).toBe(true);
  });

  it('rejects remote URLs, script URLs and oversized payloads', () => {
    // A remote URL would leak the agent's chat canvas (and referrer) to a
    // third party the moment the thread renders.
    expect(isWallpaperPhoto('https://example.com/wall.jpg')).toBe(false);
    expect(isWallpaperPhoto('javascript:alert(1)')).toBe(false);
    expect(isWallpaperPhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isWallpaperPhoto('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isWallpaperPhoto(null)).toBe(false);
    expect(
      isWallpaperPhoto(
        `data:image/jpeg;base64,${'A'.repeat(MAX_PHOTO_DATA_URL_CHARS)}`
      )
    ).toBe(false);
  });
});

describe('clampPhotoOpacity', () => {
  it('keeps in-range values', () => {
    expect(clampPhotoOpacity(0.5)).toBe(0.5);
    expect(clampPhotoOpacity(MIN_PHOTO_OPACITY)).toBe(MIN_PHOTO_OPACITY);
  });

  it('clamps out-of-range numbers', () => {
    expect(clampPhotoOpacity(0)).toBe(MIN_PHOTO_OPACITY);
    expect(clampPhotoOpacity(-3)).toBe(MIN_PHOTO_OPACITY);
    expect(clampPhotoOpacity(9)).toBe(1);
  });

  it('coerces numeric strings and rejects everything else', () => {
    // Stored JSON is attacker-editable, so a numeric string is tolerated...
    expect(clampPhotoOpacity('0.5')).toBe(0.5);
    // ...but a missing / nonsense value must not produce NaN in CSS.
    for (const value of ['', 'abc', null, undefined, NaN, Infinity, {}]) {
      expect(clampPhotoOpacity(value)).toBe(DEFAULT_PHOTO_OPACITY);
    }
  });
});

describe('parseChatWallpaper', () => {
  it('returns the default for missing or unreadable input', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '{',
      '[]',
      '"doodle"',
      '42',
      'null',
    ]) {
      expect(parseChatWallpaper(raw)).toEqual(DEFAULT_CHAT_WALLPAPER);
    }
  });

  it('reads a full stored setting', () => {
    expect(
      parseChatWallpaper(
        JSON.stringify({ id: 'sage', photo: PHOTO, photoOpacity: 0.7 })
      )
    ).toEqual({ id: 'sage', photo: PHOTO, photoOpacity: 0.7 });
  });

  it('degrades an unknown preset to the default but keeps a valid photo', () => {
    // A preset removed in a later release must not blank the canvas, and it
    // must not take the user's photo with it.
    expect(
      parseChatWallpaper(
        JSON.stringify({ id: 'neon', photo: PHOTO, photoOpacity: 0.3 })
      )
    ).toEqual({
      id: DEFAULT_CHAT_WALLPAPER.id,
      photo: PHOTO,
      photoOpacity: 0.3,
    });
  });

  it('drops a hostile photo but keeps the preset', () => {
    expect(
      parseChatWallpaper(
        JSON.stringify({ id: 'sky', photo: 'javascript:alert(1)' })
      )
    ).toEqual({ id: 'sky', photo: null, photoOpacity: DEFAULT_PHOTO_OPACITY });
  });
});

describe('serializeChatWallpaper', () => {
  it('round-trips through the parser unchanged', () => {
    const setting = { id: 'rose' as const, photo: PHOTO, photoOpacity: 0.6 };
    expect(parseChatWallpaper(serializeChatWallpaper(setting))).toEqual(
      setting
    );
  });

  it('never writes an invalid value to storage', () => {
    const dirty = {
      id: 'neon' as never,
      photo: 'https://evil.example/x.jpg' as never,
      photoOpacity: 42 as never,
    };
    expect(JSON.parse(serializeChatWallpaper(dirty))).toEqual({
      id: DEFAULT_CHAT_WALLPAPER.id,
      photo: null,
      photoOpacity: 1,
    });
  });
});

describe('hasCustomLook', () => {
  it('is false for the shipped look', () => {
    expect(hasCustomLook(DEFAULT_CHAT_WALLPAPER)).toBe(false);
  });

  it('is true once any axis is changed', () => {
    expect(hasCustomLook({ ...DEFAULT_CHAT_WALLPAPER, id: 'sand' })).toBe(true);
    expect(hasCustomLook({ ...DEFAULT_CHAT_WALLPAPER, photo: PHOTO })).toBe(
      true
    );
    expect(
      hasCustomLook({ ...DEFAULT_CHAT_WALLPAPER, photoOpacity: 0.9 })
    ).toBe(true);
  });
});

describe('storage key', () => {
  it('is namespaced with the product prefix', () => {
    expect(CHAT_WALLPAPER_STORAGE_KEY).toBe('exbolt:chat:wallpaper');
  });
});

describe('isPhotoTooLarge', () => {
  it('flags only payloads over the budget', () => {
    expect(isPhotoTooLarge(PHOTO)).toBe(false);
    expect(isPhotoTooLarge('A'.repeat(MAX_PHOTO_DATA_URL_CHARS + 1))).toBe(
      true
    );
  });
});
