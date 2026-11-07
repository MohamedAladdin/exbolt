import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  base_url: null,
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.baseUrl).toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig handoff message', () => {
  it('carries the tenant holding line into the runtime config', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, handoff_message: 'فريقنا هيكمّل مع حضرتك' }),
      'acct',
      { requireActive: false },
    )
    expect(config!.handoffMessage).toBe('فريقنا هيكمّل مع حضرتك')
  })
})

describe('CONFIG_COLUMNS', () => {
  // Drift guard: `toConfig` maps a column per field, and a column missing from
  // the select list read as `undefined` — `handoff_message` shipped that way, so
  // every handoff went silent while the DB row carried the tenant's wording and
  // the settings screen painted it. Every mapped column must be selected.
  it('selects every column the mapper reads', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./config.ts', import.meta.url)),
      'utf8',
    )
    const columns = (
      src.match(/const CONFIG_COLUMNS =\s*'([^']+)'/)![1] ?? ''
    )
      .split(',')
      .map((c) => c.trim())

    const read = [...src.matchAll(/\brow\.([a-z][a-z0-9_]*)/g)].map((m) => m[1])
    expect(read.length).toBeGreaterThan(5)
    for (const column of new Set(read)) {
      expect(columns).toContain(column)
    }
  })
})
