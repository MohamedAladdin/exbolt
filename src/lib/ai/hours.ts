import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A working window: when something is allowed to act, in a named timezone.
 *
 * The assistant has its **own** window (`ai_configs.ai_schedule_*`), kept
 * deliberately separate from `accounts.business_hours_*`: that one describes
 * the *team's* week and feeds the response-time metric, and a clinic that lets
 * the bot answer on Friday must not have its reporting window rewritten (or
 * vice versa).
 */
export interface WorkWindow {
  enabled: boolean
  /** 'HH:MM' or 'HH:MM:SS', inclusive start. */
  start: string
  /** 'HH:MM' or 'HH:MM:SS', exclusive end. */
  end: string
  /** `extract(dow)` numbering: 0 = Sunday … 6 = Saturday. */
  days: number[]
  timezone: string
}

const ALWAYS_OPEN: WorkWindow = {
  enabled: false,
  start: '00:00',
  end: '23:59',
  days: [0, 1, 2, 3, 4, 5, 6],
  timezone: 'UTC',
}

const WEEKDAY_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Load the assistant's schedule. Never throws: a missing row or a DB error
 * answers `enabled: false`, which every caller treats as "always available"
 * — a broken settings read must never silence the assistant.
 */
export async function loadAiSchedule(
  db: SupabaseClient,
  accountId: string,
): Promise<WorkWindow> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select(
        'ai_schedule_enabled, ai_schedule_start, ai_schedule_end, ai_schedule_days, ai_schedule_timezone',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error || !data) {
      if (error) {
        console.warn('[ai hours] could not read the AI schedule:', error.message)
      }
      return ALWAYS_OPEN
    }

    return {
      enabled: data.ai_schedule_enabled === true,
      start: String(data.ai_schedule_start ?? ALWAYS_OPEN.start),
      end: String(data.ai_schedule_end ?? ALWAYS_OPEN.end),
      days: Array.isArray(data.ai_schedule_days)
        ? (data.ai_schedule_days as number[])
        : ALWAYS_OPEN.days,
      timezone: String(data.ai_schedule_timezone || ALWAYS_OPEN.timezone),
    }
  } catch (err) {
    console.warn('[ai hours] schedule read threw:', err)
    return ALWAYS_OPEN
  }
}

/**
 * Load the *team's* window (response-time metric). The assistant does not use
 * it — kept here so one module owns both windows and nobody re-invents the
 * timezone maths.
 */
export async function loadTeamBusinessHours(
  db: SupabaseClient,
  accountId: string,
): Promise<WorkWindow> {
  try {
    const { data, error } = await db
      .from('accounts')
      .select(
        'business_hours_enabled, business_hours_start, business_hours_end, business_days, business_timezone',
      )
      .eq('id', accountId)
      .maybeSingle()
    if (error || !data) return ALWAYS_OPEN
    return {
      enabled: data.business_hours_enabled === true,
      start: String(data.business_hours_start ?? ALWAYS_OPEN.start),
      end: String(data.business_hours_end ?? ALWAYS_OPEN.end),
      days: Array.isArray(data.business_days)
        ? (data.business_days as number[])
        : ALWAYS_OPEN.days,
      timezone: String(data.business_timezone || ALWAYS_OPEN.timezone),
    }
  } catch {
    return ALWAYS_OPEN
  }
}

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight. NaN when unparsable. */
export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim())
  if (!match) return Number.NaN
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return Number.NaN
  return hours * 60 + minutes
}

interface LocalClock {
  dow: number
  minutes: number
}

/**
 * The wall clock at `at` in `timeZone`. Returns null when the zone is not a
 * valid IANA name (a typo in settings, not a reason to stop replying).
 */
function localClock(at: Date, timeZone: string): LocalClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at)
    const pick = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? ''
    const dow = WEEKDAY_DOW[pick('weekday')]
    // Intl renders midnight as "24" in some engines/locales.
    const hour = Number(pick('hour')) % 24
    const minute = Number(pick('minute'))
    if (dow === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
      return null
    }
    return { dow, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

/**
 * Is `at` inside the window?
 *
 * Fail-open by design: a disabled window, no working days, an inverted or
 * unparsable range, or an unknown timezone all answer `true`. The cost of
 * answering outside hours is a slightly eager bot; the cost of a false
 * "closed" is a customer nobody answers.
 */
export function isInsideWorkWindow(
  window: WorkWindow,
  at: Date = new Date(),
): boolean {
  if (!window.enabled) return true

  const start = parseTimeToMinutes(window.start)
  const end = parseTimeToMinutes(window.end)
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return true
  if (!Array.isArray(window.days) || window.days.length === 0) return true

  const clock = localClock(at, window.timezone)
  if (!clock) {
    console.warn(
      `[hours] unknown timezone "${window.timezone}" — treating the window as open`,
    )
    return true
  }

  if (!window.days.includes(clock.dow)) return false
  if (start < end) return clock.minutes >= start && clock.minutes < end
  // Overnight window (e.g. 22:00 → 02:00) crosses midnight.
  return clock.minutes >= start || clock.minutes < end
}

/** "Sun,Mon,Tue 09:00–21:00 (Africa/Cairo)" — for logs and the settings hint. */
export function describeWorkWindow(window: WorkWindow): string {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = [...window.days]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d] ?? '?')
  return `${days.join(',')} ${window.start}–${window.end} (${window.timezone})`
}
