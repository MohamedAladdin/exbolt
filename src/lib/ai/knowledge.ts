import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

export interface IngestResult {
  keywordOnly: boolean
  embedError: unknown
}

const CHUNK_DELETE_BATCH = 100

/**
 * Words too common to say anything about relevance. Arabic questions are short,
 * so a token that appears in almost every chunk only adds noise.
 */
const STOPWORDS = new Set([
  'فيه','في','من','عن','على','هل','ايه','إيه','كام','عايز','عاوز','ممكن','حضرتك',
  'انا','أنا','هو','هي','يا','لو','ولا','او','أو','و','اللي','التي','الذي','بتاع',
  'عندكم','عندك','محتاج','محتاجة','ممكن','يعني','بس','كمان','دلوقتي','the','and','for',
  'you','your','are','is','do','does','have','what','how','much','where','can','a','of','in','to',
])

/** Question terms worth matching against an excerpt (Arabic words ≥3 chars). */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      (query || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ]
}

/**
 * Re-order retrieved excerpts so the ones that actually mention the question's
 * own words come first.
 *
 * Lexical retrieval ranks by ts_rank over the whole chunk, which can put a
 * generic "الفروع" section above the one line that names المنصورة. Since the
 * model reads these in order and hands off when unsure, the passage that
 * contains the asked-about city has to lead. Pure and stable: equal scores keep
 * their incoming order.
 */
export function rerankByQueryTerms(chunks: string[], query: string): string[] {
  const terms = queryTerms(query)
  if (terms.length === 0 || chunks.length < 2) return chunks
  return [...chunks]
    .map((content, index) => {
      const haystack = content.toLowerCase()
      const score = terms.reduce(
        (total, term) => (haystack.includes(term) ? total + 1 : total),
        0,
      )
      return { content, index, score }
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((row) => row.content)
}

interface MatchRow {
  id: string
  content: string
}

/**
 * (Re)build the chunks for one document. Re-chunks the content and —
 * when the account has an embeddings key — embeds each chunk. Runs under
 * whatever client the caller passes (service-role for ingest routes).
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<IngestResult> {
  const chunks = chunkText(content)

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey && chunks.length > 0) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const { data: previousChunks, error: listErr } = await db
    .from('ai_knowledge_chunks')
    .select('id')
    .eq('document_id', documentId)
  if (listErr) throw listErr

  if (chunks.length > 0) {
    const rows = chunks.map((content, i) => ({
      document_id: documentId,
      account_id: accountId,
      chunk_index: i,
      content,
      embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
    }))
    const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
    if (insErr) throw insErr
  }

  const previousIds = (previousChunks ?? []).map((row: { id: string }) => row.id)
  for (let i = 0; i < previousIds.length; i += CHUNK_DELETE_BATCH) {
    const { error: delErr } = await db
      .from('ai_knowledge_chunks')
      .delete()
      .in('id', previousIds.slice(i, i + CHUNK_DELETE_BATCH))
    if (delErr) throw delErr
  }

  return { keywordOnly: embedError !== null, embedError }
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 8,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, string>() // id → content, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  return rerankByQueryTerms(Array.from(picked.values()), query).slice(0, k)
}
