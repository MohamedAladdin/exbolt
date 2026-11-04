import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/ai/knowledge/suggestions
 *
 * The question/answer pairs the cron job lifted out of real conversations
 * where a human answered. Drafts only — the approved ones already became
 * documents and the dismissed ones are gone from the reviewer's way.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_knowledge_suggestions')
      .select('id, question, answer, source_conversation_id, created_at')
      .eq('account_id', accountId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('[ai/suggestions GET] error:', error)
      return NextResponse.json(
        { error: t('ai.knowledge.loadSuggestionsFailed') },
        { status: 500 },
      )
    }
    return NextResponse.json({ suggestions: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/knowledge/suggestions  (admin+)
 *
 * Review one draft:
 *   { id, action: 'approve' } → creates a knowledge-base document, indexes it,
 *                               and links the suggestion to it.
 *   { id, action: 'dismiss' } → marks it dismissed, creates nothing.
 *
 * Approval is the ONLY path from "the bot proposed" to "the bot knows": the
 * cron writes drafts, a human decides.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-suggest:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    const action = body?.action
    if (!id || (action !== 'approve' && action !== 'dismiss')) {
      return NextResponse.json(
        { error: t('ai.knowledge.invalidReview') },
        { status: 400 },
      )
    }

    const { data: suggestion, error: readErr } = await supabase
      .from('ai_knowledge_suggestions')
      .select('id, question, answer, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (readErr) {
      console.error('[ai/suggestions POST] read error:', readErr)
      return NextResponse.json(
        { error: t('ai.knowledge.loadSuggestionsFailed') },
        { status: 500 },
      )
    }
    if (!suggestion) {
      return NextResponse.json({ error: t('ai.knowledge.notFound') }, { status: 404 })
    }
    if (suggestion.status !== 'draft') {
      return NextResponse.json({ error: t('ai.knowledge.alreadyReviewed') }, { status: 409 })
    }

    const reviewedAt = new Date().toISOString()

    if (action === 'dismiss') {
      const { error } = await supabase
        .from('ai_knowledge_suggestions')
        .update({ status: 'dismissed', reviewed_by: userId, reviewed_at: reviewedAt })
        .eq('id', id)
        .eq('account_id', accountId)
      if (error) {
        console.error('[ai/suggestions POST] dismiss error:', error)
        return NextResponse.json(
          { error: t('ai.knowledge.reviewFailed') },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true, status: 'dismissed' })
    }

    // Approve → a real knowledge-base document, indexed like a manual one.
    const title = suggestion.question.trim().slice(0, 120)
    const content = `س: ${suggestion.question.trim()}\nج: ${suggestion.answer.trim()}`

    const { data: doc, error: insertErr } = await supabase
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, created_by: userId, title, content })
      .select('id')
      .single()

    if (insertErr || !doc) {
      console.error('[ai/suggestions POST] document insert error:', insertErr)
      return NextResponse.json(
        { error: t('ai.knowledge.saveDocFailed') },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey } = await loadEmbeddingsKey(supabase, accountId)
    let warning: string | null = null
    try {
      const ingest = await ingestDocument(
        supabase,
        accountId,
        { embeddingsApiKey },
        doc.id,
        content,
      )
      if (ingest.keywordOnly) {
        warning =
          ingest.embedError instanceof AiError
            ? t('ai.knowledge.savedIndexFailed', { message: ingest.embedError.message })
            : t('ai.knowledge.savedKeywordOnly')
      }
    } catch (err) {
      console.error('[ai/suggestions POST] ingest error:', err)
      warning =
        err instanceof AiError
          ? t('ai.knowledge.savedNotIndexed', { message: err.message })
          : t('ai.knowledge.indexingFailed')
    }

    const { error: linkErr } = await supabase
      .from('ai_knowledge_suggestions')
      .update({
        status: 'approved',
        reviewed_by: userId,
        reviewed_at: reviewedAt,
        document_id: doc.id,
      })
      .eq('id', id)
      .eq('account_id', accountId)
    if (linkErr) {
      console.error('[ai/suggestions POST] link error:', linkErr)
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      id: doc.id,
      ...(warning ? { warning } : {}),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
