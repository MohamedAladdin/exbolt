import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard for React error #310 («Rendered more hooks than during the previous
 * render»), which took the whole inbox down on 2026-11-04: the sidebar returns
 * early while no contact is selected, so any hook declared *after* that return
 * only exists once a conversation is opened — and React refuses to render.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'inbox', 'contact-sidebar.tsx'),
  'utf8',
)

describe('ContactSidebar hook order', () => {
  it('declares no hooks after the "no contact selected" early return', () => {
    const earlyReturn = source.indexOf('if (!contact) {')
    expect(earlyReturn).toBeGreaterThan(-1)

    const after = source.slice(earlyReturn)
    const hooks = after.match(/\buse(?:State|Effect|Callback|Memo|Ref|Reducer)\s*[<(]/g) ?? []
    expect(hooks).toEqual([])
  })
})
