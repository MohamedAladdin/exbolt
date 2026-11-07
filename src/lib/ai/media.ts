import type { AiConfig, AiProvider, ChatImage, ChatMessage } from './types'

// ============================================================
// Inbound media → model input.
//
// The assistant used to be text-only: the context builder dropped every
// non-text row and the adapters sent a single string per turn, so a photo
// or a voice note reached the inbox and never reached the model. This
// module turns the media rows of the current inbound batch into the two
// shapes providers actually accept — base64 image blocks, and text
// transcribed from audio — and reports what it could not read so the
// caller can hand the thread to a human instead of staying silent.
//
// Every failure here is a soft failure: nothing throws, a media row that
// cannot be read lands in `skipped` with a reason.
// ============================================================

/** Anthropic caps one image at 5 MB *after* base64 inflation; keep the raw
 *  bytes well below it. Meta's own image limit is 5 MB too. */
export const MAX_IMAGE_BYTES = 3_500_000
/** Whisper's upload limit is 25 MB; voice notes are orders of magnitude
 *  smaller, so this only catches an accidental video-in-an-audio-bucket. */
export const MAX_AUDIO_BYTES = 20_000_000
/** How many images ride along with one turn. Two covers "front and back
 *  of the report" without turning a reply into a token bill. */
export const MAX_IMAGES_PER_TURN = 2
export const MAX_TRANSCRIPTS_PER_TURN = 2

const MEDIA_FETCH_TIMEOUT_MS = 15_000
const TRANSCRIBE_TIMEOUT_MS = 60_000
const WHISPER_MODEL = 'whisper-1'

/** One image as both providers take it: the MIME type plus raw base64. */
export type AiImage = ChatImage

export type MediaSkipReason =
  | 'unsupported_type'
  | 'too_large'
  | 'download_failed'
  | 'no_vision'
  | 'no_audio_key'
  | 'transcription_failed'
  | 'empty'

export interface SkippedMedia {
  type: string
  reason: MediaSkipReason
}

export interface ReadableMedia {
  images: AiImage[]
  /** Plain text of the customer's voice notes, oldest first. */
  transcripts: string[]
  skipped: SkippedMedia[]
}

/** The columns `readMediaForModel` needs from a `messages` row. */
export interface MediaRow {
  content_type: string | null
  media_url: string | null
  content_text: string | null
}

export interface AudioTarget {
  apiKey: string
  /** OpenAI-compatible base URL (no trailing slash); null = api.openai.com. */
  baseUrl: string | null
}

/** Image MIME types both providers read. A sticker arrives as image/webp. */
const VISION_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

/** Extensions Whisper accepts. `audio/amr` (some Android recorders) is
 *  deliberately absent — the API rejects it, and a retry cannot fix that. */
const WHISPER_MIME = new Set([
  'audio/ogg',
  'audio/oga',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
])

/**
 * Models known to accept image input. Deliberately an allow-list: sending
 * an image block to a text-only model is a 400 that costs the whole reply,
 * while an unlisted model simply falls back to a handoff (a human reads
 * the photo). Extend the pattern when a tenant picks a vision model.
 */
const VISION_MODEL_PATTERNS = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /gpt-5/i,
  /^o3/i,
  /^o4/i,
  /gemini/i,
  /llava/i,
  /pixtral/i,
  /qwen.*vl/i,
  /minicpm-v/i,
  /claude-(3|4|sonnet|opus|haiku)/i,
]

const NO_VISION_MODEL_PATTERNS = [/claude-2/i, /claude-instant/i]

export function modelSupportsVision(provider: AiProvider, model: string): boolean {
  const name = (model ?? '').trim()
  if (!name) return false
  if (NO_VISION_MODEL_PATTERNS.some((re) => re.test(name))) return false
  // A custom OpenAI-compatible server can serve any model id; the pattern
  // list is the only signal we have, so an unknown id means "no vision".
  void provider
  return VISION_MODEL_PATTERNS.some((re) => re.test(name))
}

/** `audio/ogg; codecs=opus` → `audio/ogg`. */
export function normalizeMediaType(raw: string | null | undefined): string {
  return (raw ?? '').split(';')[0]!.trim().toLowerCase()
}

/**
 * Where speech-to-text can run for this account.
 *
 * Anthropic has no transcription endpoint, so an Anthropic-only account has
 * nowhere to send a voice note — unless it also stored the optional OpenAI
 * embeddings key (`ai_configs.embeddings_api_key`), which is an OpenAI key
 * by contract and works for Whisper too. Returning null is not an error:
 * the caller hands the thread to a human who can press play.
 */
export function audioTranscriptionTarget(
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'baseUrl' | 'embeddingsApiKey'>,
): AudioTarget | null {
  if (!config.apiKey && !config.embeddingsApiKey) return null
  if (config.provider === 'openai') {
    return { apiKey: config.apiKey, baseUrl: null }
  }
  if (config.provider === 'openai_compatible') {
    return config.baseUrl ? { apiKey: config.apiKey, baseUrl: config.baseUrl } : null
  }
  // Anthropic + a separate OpenAI key: use it for audio only.
  if (config.embeddingsApiKey) {
    return { apiKey: config.embeddingsApiKey, baseUrl: null }
  }
  return null
}

type DownloadResult =
  | { ok: true; bytes: Uint8Array; mediaType: string }
  | { ok: false; reason: 'too_large' | 'download_failed' | 'empty' }

async function downloadMedia(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch,
): Promise<DownloadResult> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, reason: 'download_failed' }

    const declared = Number(res.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: 'too_large' }
    }

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) return { ok: false, reason: 'empty' }
    if (bytes.byteLength > maxBytes) return { ok: false, reason: 'too_large' }

    const mediaType =
      normalizeMediaType(res.headers.get('content-type')) || 'application/octet-stream'
    return { ok: true, bytes, mediaType }
  } catch {
    return { ok: false, reason: 'download_failed' }
  }
}

export interface TranscribeArgs {
  apiKey: string
  baseUrl?: string | null
  bytes: Uint8Array
  mediaType: string
  fileName?: string
  fetchImpl?: typeof fetch
}

/**
 * OpenAI-format speech-to-text. Throws only on a caller mistake; a provider
 * failure is returned as null so one bad voice note cannot cost the reply.
 */
export async function transcribeAudio(args: TranscribeArgs): Promise<string | null> {
  const fetchImpl = args.fetchImpl ?? fetch
  const base = (args.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')

  try {
    const form = new FormData()
    // Copy into a plain ArrayBuffer: a Uint8Array over SharedArrayBuffer is not
    // a BlobPart, and the bytes are small enough that the copy is free.
    const body = new Uint8Array(args.bytes).buffer as ArrayBuffer
    form.append(
      'file',
      new Blob([body], { type: normalizeMediaType(args.mediaType) }),
      args.fileName ?? `voice.${extensionFor(args.mediaType)}`,
    )
    form.append('model', WHISPER_MODEL)
    form.append('response_format', 'json')

    const res = await fetchImpl(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data = (await res.json().catch(() => null)) as { text?: string } | null
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    return text || null
  } catch {
    return null
  }
}

function extensionFor(mediaType: string): string {
  const normalized = normalizeMediaType(mediaType)
  const ext = normalized.split('/')[1] ?? 'ogg'
  return ext === 'mpeg' ? 'mp3' : ext === 'x-m4a' ? 'm4a' : ext
}

export interface ReadMediaOptions {
  provider: AiProvider
  model: string
  /** Null when the account has no OpenAI-format key (Anthropic-only). */
  audio: AudioTarget | null
  fetchImpl?: typeof fetch
}

/**
 * Turn the media rows of one inbound batch into provider input.
 *
 * Reads at most the newest `MAX_IMAGES_PER_TURN` images and
 * `MAX_TRANSCRIPTS_PER_TURN` voice notes; anything else — a video, a PDF,
 * a 12 MB photo, a model without vision, an account with no STT key —
 * lands in `skipped` so the caller can hand off instead of guessing.
 */
export async function readMediaForModel(
  rows: MediaRow[],
  opts: ReadMediaOptions,
): Promise<ReadableMedia> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const vision = modelSupportsVision(opts.provider, opts.model)

  const images: AiImage[] = []
  const transcripts: string[] = []
  const skipped: SkippedMedia[] = []

  // Newest first: a customer who sends three photos means the last two.
  const ordered = [...rows].reverse()

  for (const row of ordered) {
    const type = normalizeMediaType(row.content_type)
    const url = row.media_url

    if (type === 'image') {
      if (images.length >= MAX_IMAGES_PER_TURN) continue
      if (!vision) {
        skipped.push({ type, reason: 'no_vision' })
        continue
      }
      if (!url) {
        skipped.push({ type, reason: 'download_failed' })
        continue
      }
      const got = await downloadMedia(url, MAX_IMAGE_BYTES, fetchImpl)
      if (!got.ok) {
        skipped.push({ type, reason: got.reason })
        continue
      }
      // An unknown image MIME (or none at all) is claimed as jpeg: both
      // providers sniff the real format from the bytes, and WhatsApp's own
      // pipeline already bets the same way.
      const declared = VISION_MIME.has(got.mediaType) ? got.mediaType : 'image/jpeg'
      images.push({
        mediaType: declared === 'image/jpg' ? 'image/jpeg' : declared,
        dataBase64: Buffer.from(got.bytes).toString('base64'),
      })
      continue
    }

    if (type === 'audio') {
      if (transcripts.length >= MAX_TRANSCRIPTS_PER_TURN) continue
      if (!opts.audio) {
        skipped.push({ type, reason: 'no_audio_key' })
        continue
      }
      if (!url) {
        skipped.push({ type, reason: 'download_failed' })
        continue
      }
      const got = await downloadMedia(url, MAX_AUDIO_BYTES, fetchImpl)
      if (!got.ok) {
        skipped.push({ type, reason: got.reason })
        continue
      }
      const mediaType = normalizeMediaType(got.mediaType)
      if (!WHISPER_MIME.has(mediaType)) {
        skipped.push({ type, reason: 'unsupported_type' })
        continue
      }
      const text = await transcribeAudio({
        apiKey: opts.audio.apiKey,
        baseUrl: opts.audio.baseUrl,
        bytes: got.bytes,
        mediaType,
        fetchImpl,
      })
      if (!text) {
        skipped.push({ type, reason: 'transcription_failed' })
        continue
      }
      transcripts.push(text)
      continue
    }

    // video / document / location / template / interactive: real inbound
    // content the model cannot read, and that a human can.
    skipped.push({ type: type || 'unknown', reason: 'unsupported_type' })
  }

  // Both lists were built newest-first; hand them over oldest-first so the
  // transcript reads in the order the customer spoke.
  images.reverse()
  transcripts.reverse()

  return { images, transcripts, skipped }
}

/** The label that tells the model a passage came from speech, not typing. */
export const TRANSCRIPT_LABEL = '[voice message transcription]'

/** Placeholder text for a media row that carried no caption. */
export function mediaPlaceholder(contentType: string | null | undefined): string {
  switch (normalizeMediaType(contentType)) {
    case 'image':
      return '[image]'
    case 'audio':
      return '[voice message]'
    case 'video':
      return '[video]'
    case 'document':
      return '[document]'
    case 'location':
      return '[location]'
    default:
      return '[media]'
  }
}

/**
 * Put what we could read onto the turn being answered.
 *
 * Speech becomes text on the customer's last turn, labelled as a transcript so
 * the model does not treat a mis-heard word as the customer's own phrasing.
 * Images are attached to the same turn. Returns the input untouched when there
 * is nothing to add, so the common text-only path costs no allocation.
 */
export function attachReadableMedia(
  messages: ChatMessage[],
  media: ReadableMedia,
): ChatMessage[] {
  const transcripts = media.transcripts.filter((t) => t.trim())
  if (media.images.length === 0 && transcripts.length === 0) return messages

  const out = messages.map((m) => ({ ...m }))
  let target = -1
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      target = i
      break
    }
  }
  // No customer turn in the window (media rows are always customer rows, so
  // this only happens on a truncated context): append one rather than lose it.
  if (target < 0) {
    out.push({ role: 'user', content: '' })
    target = out.length - 1
  }

  const turn = out[target]
  if (transcripts.length > 0) {
    const spoken = transcripts.map((t) => `${TRANSCRIPT_LABEL} ${t.trim()}`).join('\n\n')
    turn.content = turn.content.trim() ? `${turn.content.trim()}\n\n${spoken}` : spoken
  }
  if (media.images.length > 0) {
    turn.images = [...(turn.images ?? []), ...media.images]
  }
  return out
}
