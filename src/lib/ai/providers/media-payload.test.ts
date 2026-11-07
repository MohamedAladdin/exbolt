import { describe, expect, it, vi, afterEach } from 'vitest'
import type { ChatMessage } from '../types'
import {
  mergeConsecutive,
  toAnthropicContent,
  toOpenAiContent,
} from './shared'
import { generateOpenAi } from './openai'
import { generateAnthropic } from './anthropic'

const IMAGE = { mediaType: 'image/jpeg', dataBase64: 'AQID' }
const DATA_URL = 'data:image/jpeg;base64,AQID'

const args = (messages: ChatMessage[]) => ({
  apiKey: 'test-key',
  model: 'gpt-4o',
  systemPrompt: 'You are the clinic assistant.',
  messages,
  timeoutMs: 5000,
  baseUrl: null,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toOpenAiContent', () => {
  it('keeps a plain string when the turn has no images', () => {
    expect(toOpenAiContent({ role: 'user', content: 'مرحبا' })).toBe('مرحبا')
  })

  it('sends text then the image as a data URL', () => {
    const content = toOpenAiContent({
      role: 'user',
      content: 'شوف التحليل ده',
      images: [IMAGE],
    })
    expect(content).toEqual([
      { type: 'text', text: 'شوف التحليل ده' },
      { type: 'image_url', image_url: { url: DATA_URL } },
    ])
  })

  it('omits the text part when a caption-less photo is all there is', () => {
    const content = toOpenAiContent({ role: 'user', content: '', images: [IMAGE] })
    expect(content).toEqual([{ type: 'image_url', image_url: { url: DATA_URL } }])
  })
})

describe('toAnthropicContent', () => {
  it('keeps a plain string when the turn has no images', () => {
    expect(toAnthropicContent({ role: 'user', content: 'مرحبا' })).toBe('مرحبا')
  })

  it('sends the image block first, then the words', () => {
    const content = toAnthropicContent({
      role: 'user',
      content: '[image]',
      images: [IMAGE],
    })
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
      { type: 'text', text: '[image]' },
    ])
  })

  it('never emits an empty text block (the API rejects it)', () => {
    const content = toAnthropicContent({ role: 'user', content: '  ', images: [IMAGE] })
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
    ])
  })
})

describe('mergeConsecutive keeps the images on the merged turn', () => {
  it('carries both photos into one turn', () => {
    const merged = mergeConsecutive([
      { role: 'user', content: '[image]', images: [IMAGE] },
      { role: 'user', content: 'والصورة التانية دي', images: [{ ...IMAGE, dataBase64: 'BAUG' }] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.content).toBe('[image]\n\nوالصورة التانية دي')
    expect(merged[0]!.images).toHaveLength(2)
  })

  it('does not invent an images key on a text-only turn', () => {
    const merged = mergeConsecutive([{ role: 'user', content: 'مرحبا' }])
    expect('images' in merged[0]!).toBe(false)
  })
})

describe('provider request bodies carry the image', () => {
  it('OpenAI gets an image_url part', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'تمام' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await generateOpenAi(args([{ role: 'user', content: '[image]', images: [IMAGE] }]))

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    const userTurn = body.messages[1]
    expect(userTurn.content).toEqual([
      { type: 'text', text: '[image]' },
      { type: 'image_url', image_url: { url: DATA_URL } },
    ])
  })

  it('Anthropic gets an image block', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'تمام' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await generateAnthropic(args([{ role: 'user', content: '[image]', images: [IMAGE] }]))

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(body.messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
      { type: 'text', text: '[image]' },
    ])
  })
})
