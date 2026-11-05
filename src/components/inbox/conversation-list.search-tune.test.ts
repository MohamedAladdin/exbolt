import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * His report (2026-11-05, after the first cut of the search tuning): the
 * «تخصيص البحث» control sat NEXT TO the search box as a second bordered 36px
 * square, sitting right beside the funnel — «ليسهل التفريق بينه وبين أيقونة
 * الفلتر» was exactly the problem: two identical squares read as the same kind
 * of control. The tuning button now lives INSIDE the field it modifies, and the
 * funnel is the only control left outside it.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'inbox', 'conversation-list.tsx'),
  'utf8',
)

describe('Inbox search tuning placement', () => {
  it('reserves room inside the field for the in-field button', () => {
    // The magnifier takes the start edge, the tuning button the end edge: the
    // text must not run underneath either one.
    expect(source).toContain('ps-9 pe-10')
  })

  it('positions the tuning trigger inside the search wrapper, not beside it', () => {
    // Order in the source is the DOM order: search icon → input → tuning
    // trigger (absolutely placed in the wrapper) → the funnel, which is the
    // first sibling OUTSIDE that wrapper.
    const input = source.indexOf('placeholder={t("searchPlaceholder")}')
    const tune = source.indexOf('aria-label={t("searchTuneLabel")}')
    const funnel = source.indexOf('aria-label={t("filtersLabel")}')
    expect(input).toBeGreaterThan(-1)
    expect(tune).toBeGreaterThan(input)
    expect(tune).toBeLessThan(funnel)
    // Absolutely positioned inside the relative wrapper = inside the box.
    expect(source).toContain('absolute end-1 top-1/2 flex h-7 w-7')
  })

  it('keeps it visually subordinate to the field, not a second filter button', () => {
    const trigger = source.slice(
      source.indexOf('aria-label={t("searchTuneLabel")}') - 200,
      source.indexOf('aria-label={t("searchTuneLabel")}') + 600,
    )
    // 28px, borderless, tinted only when it is off-default.
    expect(trigger).toContain('h-7 w-7')
    expect(trigger).not.toContain('h-9 w-9')
    expect(trigger).not.toContain('border-border text-muted-foreground hover:text-foreground')
    expect(trigger).toContain('bg-primary/20 text-primary')
  })

  it('still tells the operator the tuning is off-default', () => {
    expect(source).toContain('searchScope === "name" || searchDays !== 30')
    expect(source).toContain('rounded-full bg-primary')
  })

  it('keeps the filter button as the only bordered control in the row', () => {
    // One 36px bordered square left in the row (the funnel). A second one is
    // exactly what he asked to remove — the tuning button is 28px and borderless
    // because it now sits inside the field.
    const row = source.slice(
      source.indexOf('flex items-center gap-1.5'),
      source.indexOf('{/* Status tabs'),
    )
    expect(row.match(/h-9 w-9/g)?.length).toBe(1)
    expect(row.match(/aria-label=\{t\("filtersLabel"\)\}/g)?.length).toBe(1)
  })
})
