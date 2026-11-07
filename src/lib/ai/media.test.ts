import { describe, it, expect, vi } from 'vitest'
import {
  MAX_IMAGES_PER_TURN,
  attachReadableMedia,
  audioTranscriptionTarget,
  modelSupportsVision,
  normalizeMediaType,
  readMediaForModel,
  type MediaRow,
} from './media'

/** A `fetch` that answers one canned response per call, in order. */
function fakeFetch(
  responses: (() => {
    ok?: boolean
    contentType?: string
    contentLength?: string
    body?: Uint8Array | object
  })[],
) {
  let call = 0
  return vi.fn(async () => {
    const spec = responses[Math.min(call, responses.length - 1)]!()
    call += 1
    const body =
      spec.body instanceof Uint8Array
        ? spec.body
        : new TextEncoder().encode(JSON.stringify(spec.body ?? {}))
    return {
      ok: spec.ok ?? true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type'
            ? (spec.contentType ?? 'image/jpeg')
            : name.toLowerCase() === 'content-length'
              ? (spec.contentLength ?? String(body.byteLength))
              : null,
      },
      arrayBuffer: async () => body.buffer,
      json: async () => JSON.parse(new TextDecoder().decode(body)),
    } as unknown as Response
  }) as unknown as typeof fetch
}

const imageRow = (url = 'https://cdn.test/photo.jpg'): MediaRow => ({
  content_type: 'image',
  media_url: url,
  content_text: null,
})

const audioRow = (url = 'https://cdn.test/voice.ogg'): MediaRow => ({
  content_type: 'audio',
  media_url: url,
  content_text: null,
})

const VISION_MODEL = 'gpt-4o'

describe('modelSupportsVision', () => {
  it.each([
    ['openai', 'gpt-4o'],
    ['openai', 'gpt-4.1-mini'],
    ['openai', 'gpt-5.4-mini'],
    ['anthropic', 'claude-haiku-4-5-20251001'],
    ['anthropic', 'claude-sonnet-4-5'],
    ['openai_compatible', 'llava-1.6'],
  ] as const)('%s / %s reads images', (provider, model) => {
    expect(modelSupportsVision(provider, model)).toBe(true)
  })

  it.each([
    ['openai', 'gpt-3.5-turbo'],
    ['openai', 'gpt-test'],
    ['anthropic', 'claude-2.1'],
    ['anthropic', 'claude-instant-1.2'],
    ['anthropic', ''],
  ] as const)('%s / %s does not', (provider, model) => {
    expect(modelSupportsVision(provider, model)).toBe(false)
  })
})

describe('normalizeMediaType', () => {
  it('drops the codec parameters WhatsApp appends to voice notes', () => {
    expect(normalizeMediaType('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(normalizeMediaType('IMAGE/JPEG')).toBe('image/jpeg')
    expect(normalizeMediaType(null)).toBe('')
  })
})

describe('audioTranscriptionTarget', () => {
  const base = {
    provider: 'anthropic' as const,
    apiKey: 'anthropic-key',
    baseUrl: null,
    embeddingsApiKey: null,
  }

  it('uses the account key on OpenAI', () => {
    expect(
      audioTranscriptionTarget({ ...base, provider: 'openai', apiKey: 'openai-key' }),
    ).toEqual({ apiKey: 'openai-key', baseUrl: null })
  })

  it('has nowhere to transcribe on an Anthropic-only account', () => {
    expect(audioTranscriptionTarget(base)).toBeNull()
  })

  it('reuses the optional OpenAI embeddings key on Anthropic', () => {
    expect(audioTranscriptionTarget({ ...base, embeddingsApiKey: 'emb-key' })).toEqual({
      apiKey: 'emb-key',
      baseUrl: null,
    })
  })

  it('needs a base URL for an OpenAI-compatible provider', () => {
    expect(
      audioTranscriptionTarget({
        ...base,
        provider: 'openai_compatible',
        apiKey: 'k',
        baseUrl: null,
      }),
    ).toBeNull()
    expect(
      audioTranscriptionTarget({
        ...base,
        provider: 'openai_compatible',
        apiKey: 'k',
        baseUrl: 'http://stt.local/v1',
      }),
    ).toEqual({ apiKey: 'k', baseUrl: 'http://stt.local/v1' })
  })
})

describe('readMediaForModel — images', () => {
  it('downloads the photo and hands it over as base64', async () => {
    const fetchImpl = fakeFetch([
      () => ({ contentType: 'image/jpeg', body: new Uint8Array([1, 2, 3]) }),
    ])
    const media = await readMediaForModel([imageRow()], {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      audio: null,
      fetchImpl,
    })
    expect(media.images).toHaveLength(1)
    expect(media.images[0]!.mediaType).toBe('image/jpeg')
    expect(Buffer.from(media.images[0]!.dataBase64, 'base64')).toEqual(
      Buffer.from([1, 2, 3]),
    )
    expect(media.skipped).toEqual([])
  })

  it('does not even download when the model cannot read images', async () => {
    const fetchImpl = fakeFetch([() => ({})])
    const media = await readMediaForModel([imageRow()], {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      audio: null,
      fetchImpl,
    })
    expect(media.images).toEqual([])
    expect(media.skipped).toEqual([{ type: 'image', reason: 'no_vision' }])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a file over the size cap instead of sending it', async () => {
    const fetchImpl = fakeFetch([
      () => ({ contentLength: '99999999', body: new Uint8Array([1]) }),
    ])
    const media = await readMediaForModel([imageRow()], {
      provider: 'openai',
      model: VISION_MODEL,
      audio: null,
      fetchImpl,
    })
    expect(media.images).toEqual([])
    expect(media.skipped).toEqual([{ type: 'image', reason: 'too_large' }])
  })

  it('reports a failed download', async () => {
    const fetchImpl = fakeFetch([() => ({ ok: false, body: new Uint8Array([1]) })])
    const media = await readMediaForModel([imageRow()], {
      provider: 'openai',
      model: VISION_MODEL,
      audio: null,
      fetchImpl,
    })
    expect(media.skipped).toEqual([{ type: 'image', reason: 'download_failed' }])
  })

  it('keeps the newest photos and drops the rest', async () => {
    // Bytes follow the URL, so the assertion below proves which rows were read.
    const fetchImpl = vi.fn(async (url: string) => {
      const tag = url.endsWith('a') ? 1 : url.endsWith('b') ? 2 : 3
      return {
        ok: true,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type' ? 'image/jpeg' : '1',
        },
        arrayBuffer: async () => new Uint8Array([tag]).buffer,
      } as unknown as Response
    }) as unknown as typeof fetch
    const media = await readMediaForModel(
      [imageRow('a'), imageRow('b'), imageRow('c')],
      { provider: 'openai', model: VISION_MODEL, audio: null, fetchImpl },
    )
    expect(media.images).toHaveLength(MAX_IMAGES_PER_TURN)
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_IMAGES_PER_TURN)
    // Newest two, restored to chronological order (b then c).
    expect(media.images[0]!.dataBase64).toBe(Buffer.from([2]).toString('base64'))
    expect(media.images[1]!.dataBase64).toBe(Buffer.from([3]).toString('base64'))
  })
})

describe('readMediaForModel — voice notes', () => {
  it('transcribes audio when the account has a speech key', async () => {
    const fetchImpl = fakeFetch([
      () => ({
        contentType: 'audio/ogg',
        body: new Uint8Array([9, 9]),
      }),
      () => ({ contentType: 'application/json', body: { text: 'عايز أحجز موعد' } }),
    ])
    const media = await readMediaForModel([audioRow()], {
      provider: 'openai',
      model: VISION_MODEL,
      audio: { apiKey: 'openai-key', baseUrl: null },
      fetchImpl,
    })
    expect(media.transcripts).toEqual(['عايز أحجز موعد'])
    expect(media.skipped).toEqual([])
    // Second call is the transcription upload, not another download.
    const mocked = fetchImpl as unknown as {
      mock: { calls: [string, RequestInit][] }
    }
    expect(mocked.mock.calls[1]![0]).toContain('/audio/transcriptions')
    expect(mocked.mock.calls[1]![1].body).toBeInstanceOf(FormData)
  })

  it('reports no_audio_key on an Anthropic-only account', async () => {
    const fetchImpl = fakeFetch([() => ({})])
    const media = await readMediaForModel([audioRow()], {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      audio: null,
      fetchImpl,
    })
    expect(media.transcripts).toEqual([])
    expect(media.skipped).toEqual([{ type: 'audio', reason: 'no_audio_key' }])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a failed transcription rather than inventing text', async () => {
    const fetchImpl = fakeFetch([
      () => ({ contentType: 'audio/ogg', body: new Uint8Array([1]) }),
      () => ({ ok: false, contentType: 'application/json', body: {} }),
    ])
    const media = await readMediaForModel([audioRow()], {
      provider: 'openai',
      model: VISION_MODEL,
      audio: { apiKey: 'k', baseUrl: null },
      fetchImpl,
    })
    expect(media.transcripts).toEqual([])
    expect(media.skipped).toEqual([{ type: 'audio', reason: 'transcription_failed' }])
  })

  it('refuses a format Whisper will reject', async () => {
    const fetchImpl = fakeFetch([
      () => ({ contentType: 'audio/amr', body: new Uint8Array([1]) }),
    ])
    const media = await readMediaForModel([audioRow()], {
      provider: 'openai',
      model: VISION_MODEL,
      audio: { apiKey: 'k', baseUrl: null },
      fetchImpl,
    })
    expect(media.skipped).toEqual([{ type: 'audio', reason: 'unsupported_type' }])
  })
})

describe('readMediaForModel — documents and video', () => {
  it('reports them as unreadable and never downloads', async () => {
    const fetchImpl = fakeFetch([() => ({})])
    const media = await readMediaForModel(
      [
        { content_type: 'document', media_url: 'https://cdn.test/a.pdf', content_text: null },
        { content_type: 'video', media_url: 'https://cdn.test/a.mp4', content_text: null },
      ],
      { provider: 'openai', model: VISION_MODEL, audio: { apiKey: 'k', baseUrl: null }, fetchImpl },
    )
    expect(media.images).toEqual([])
    expect(media.transcripts).toEqual([])
    expect(media.skipped.map((s) => s.type).sort()).toEqual(['document', 'video'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('attachReadableMedia', () => {
  const messages = [
    { role: 'user' as const, content: 'شوف الصورة دي' },
    { role: 'assistant' as const, content: 'تمام' },
    { role: 'user' as const, content: '[image]' },
  ]

  it('attaches images and transcripts to the customer turn being answered', () => {
    const out = attachReadableMedia(messages, {
      images: [{ mediaType: 'image/jpeg', dataBase64: 'AAA' }],
      transcripts: ['النتيجة طلعت كويسة'],
      skipped: [],
    })
    expect(out[2]!.images).toEqual([{ mediaType: 'image/jpeg', dataBase64: 'AAA' }])
    expect(out[2]!.content).toContain('[voice message transcription] النتيجة طلعت كويسة')
    expect(out[2]!.content.startsWith('[image]')).toBe(true)
  })

  it('leaves the input untouched', () => {
    const before = JSON.stringify(messages)
    attachReadableMedia(messages, {
      images: [],
      transcripts: ['x'],
      skipped: [],
    })
    expect(JSON.stringify(messages)).toBe(before)
  })

  it('returns the same array when there is nothing to attach', () => {
    const media = { images: [], transcripts: [], skipped: [] }
    expect(attachReadableMedia(messages, media)).toBe(messages)
  })
})
