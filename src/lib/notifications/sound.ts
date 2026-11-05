/**
 * The alert sound for in-app notifications.
 *
 * A browser notification is only as loud as the OS decides: Chrome's banner
 * honours the system volume, and on a muted Windows box "the notification
 * arrived silently" is not a bug in our `new Notification(...)` call. So the
 * product plays its own chime, generated with the Web Audio API — no asset to
 * ship, cache, version or license, and no network hop before the sound.
 *
 * Two constraints shape this file:
 *
 *  - Autoplay policy. An AudioContext starts `suspended` until a user gesture,
 *    so `unlockNotificationAudio()` is bound to the first pointerdown/keydown
 *    in the dashboard. After that, a chime fired from a realtime callback is
 *    allowed to speak.
 *  - The preference is device-scoped (localStorage) and defaults to ON. An
 *    alert feature that has to be switched on before it makes a sound is the
 *    same silent notification this module exists to fix.
 */

/** localStorage key for the device-scoped sound opt-out. */
export const SOUND_STORAGE_KEY = "exbolt:notification-sound";

/** Same-tab change signal; `storage` only fires in *other* tabs. */
export const SOUND_CHANGE_EVENT = "exbolt:notification-sound-change";

/**
 * A chime is a "somebody needs you" signal, not a ringtone: several alerts
 * landing in the same second (a handoff burst) must not turn into a siren.
 */
export const CHIME_THROTTLE_MS = 1_200;

/** The two notes of the chime: A5 then D6 — a short rising "ding-dong". */
export const CHIME_NOTES = [
  { frequency: 880, offset: 0 },
  { frequency: 1174.66, offset: 0.13 },
] as const;

/** Peak gain per note. Quiet enough not to startle, loud enough to notice. */
export const CHIME_GAIN = 0.16;

/** How long one note rings before its envelope has decayed to silence. */
export const CHIME_NOTE_DURATION = 0.42;

/**
 * Is a chime allowed right now? Pure so the burst rule is testable without
 * an audio device: disabled pref → never, and a second alert inside the
 * throttle window is swallowed (`lastPlayedAt === null` = never played).
 */
export function shouldPlaySound(args: {
  enabled: boolean;
  lastPlayedAt: number | null;
  now?: number;
  throttleMs?: number;
}): boolean {
  if (!args.enabled) return false;
  const now = args.now ?? Date.now();
  const throttle = args.throttleMs ?? CHIME_THROTTLE_MS;
  if (args.lastPlayedAt === null) return true;
  return now - args.lastPlayedAt >= throttle;
}

/** Device-scoped preference. Absent/unreadable reads as ON. */
export function readSoundPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "0";
  } catch {
    // Private browsing / sandboxed contexts: fall back to the default.
    return true;
  }
}

export function writeSoundPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(SOUND_STORAGE_KEY, "1");
    } else {
      window.localStorage.setItem(SOUND_STORAGE_KEY, "0");
    }
  } catch {
    // Best-effort; the toggle still applies for this page's lifetime.
  }
  window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
}

/** Subscribe to sound-pref changes, shaped for `useSyncExternalStore`. */
export function subscribeSoundPref(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SOUND_STORAGE_KEY) onChange();
  };
  window.addEventListener(SOUND_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SOUND_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------------------------------------------------------------------
// Playback (browser only)
// ---------------------------------------------------------------------

let audioContext: AudioContext | null = null;
let lastPlayedAt: number | null = null;

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const Ctor =
    window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/**
 * Call from a real user gesture (the dashboard binds it to the first
 * pointerdown/keydown). Safe to call any number of times.
 */
export function unlockNotificationAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
}

/**
 * Play the chime if the preference allows it. Returns whether anything was
 * scheduled — non-throwing by design, because an alert must never fail
 * because the audio device did.
 */
export function playNotificationChime(): boolean {
  if (!shouldPlaySound({ enabled: readSoundPref(), lastPlayedAt })) return false;

  const ctx = getAudioContext();
  if (!ctx) return false;

  // A context unlocked by a gesture earlier in this tab is already running;
  // resume() is a no-op then, and covers the tab that was restored from a
  // background discard.
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  try {
    const start = ctx.currentTime + 0.01;
    for (const note of CHIME_NOTES) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + note.offset;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, at);

      // Fast attack, exponential decay to (near) silence. Exponential ramps
      // cannot touch zero, hence the 0.0001 floor.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(CHIME_GAIN, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_NOTE_DURATION);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + CHIME_NOTE_DURATION + 0.02);
    }
  } catch {
    return false;
  }

  lastPlayedAt = Date.now();
  return true;
}

/** Test seam: forget the throttle window (and any created context). */
export function resetNotificationChimeState(): void {
  lastPlayedAt = null;
}
