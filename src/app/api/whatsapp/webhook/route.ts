/**
 * Legacy alias for the Meta webhook.
 *
 * The canonical route is /api/webhooks/meta: one callback now serves
 * WhatsApp, Messenger and Instagram, so a `whatsapp` segment in the path
 * misdescribes it. This file stays so an app whose callback URL was already
 * registered in the Meta dashboard keeps verifying and receiving events —
 * remove it once every deployment has been re-pointed.
 */
export const maxDuration = 60

export { GET, POST } from '@/app/api/webhooks/meta/route'
