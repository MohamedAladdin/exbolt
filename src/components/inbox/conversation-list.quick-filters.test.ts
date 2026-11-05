import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * His spec (2026-11-05): «انقل جزئية الفلاتر السريعة من داخل القائمة المنسدلة
 * إلى الخارج تحت فلاتر حالة الرسائل — تكون بنفس تصميم جزء فلتر الحالة بس تكون
 * تحتها». A 320px panel has no room for these chips in the popover's shadow, and
 * they are the four views an agent switches between all day.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'inbox', 'conversation-list.tsx'),
  'utf8',
)

describe('Inbox quick filters placement', () => {
  it('renders the quick filters outside the funnel popover', () => {
    const popoverClose = source.indexOf('</PopoverContent>')
    const quickFilters = source.indexOf('QUICK_FILTERS.includes')
    expect(popoverClose).toBeGreaterThan(-1)
    expect(quickFilters).toBeGreaterThan(popoverClose)
  })

  it('sits below the status tabs, not above them', () => {
    const statusTabs = source.indexOf('STATUS_TABS.map')
    const quickFilters = source.indexOf('QUICK_FILTERS.includes')
    expect(statusTabs).toBeGreaterThan(-1)
    expect(quickFilters).toBeGreaterThan(statusTabs)
  })

  it('reuses the status row segmented container so the two read as siblings', () => {
    const container = 'rounded-lg border border-border bg-muted/40 p-0.5'
    expect(source.split(container).length - 1).toBe(2)
    const chip = 'items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors'
    expect(source.split(chip).length - 1).toBe(2)
  })

  it('wraps instead of hiding a chip behind a horizontal scroll', () => {
    // Four Arabic labels plus counts are wider than the 320px panel; the
    // status row already scrolls sideways, and doing that here would leave
    // «نافذة الرد تُغلق» permanently invisible on desktop.
    const quickRow = source.slice(source.indexOf('aria-label={t("quickFiltersLabel")}'))
    expect(quickRow.slice(0, 200)).toContain('flex flex-wrap')
  })

  it('keeps the toggle-off path back to the account default', () => {
    expect(source).toContain('setFilter(isActive ? DEFAULT_INBOX_FILTER : opt.value)')
  })
})
