/* ExBolt service worker — Web Push only.
 *
 * Deliberately has NO `fetch` handler. A service worker without a cache has nothing
 * to add to a request, and one parked in the request path of a Next app is a
 * performance and debugging tax (stale chunks, opaque failures) for zero benefit.
 * Only `push` and `notificationclick` are handled.
 *
 * This worker is the ONLY thing that raises an out-of-app alert. The dashboard used
 * to draw its own banners with `new Notification(...)`, which meant a switch in
 * Settings could not turn them off and a single message could produce two banners.
 *
 * Rules that come from the product decisions, not from taste:
 *   - Never interrupt a user who is already looking at that conversation — the
 *     thread itself is the alert. Being on a different page is not "looking at it",
 *     so a focused tab elsewhere still gets a banner.
 *   - An assignment/handoff/report alert is suppressed while a dashboard tab is
 *     focused: the in-app card already fired on that device.
 *   - One conversation = one banner. A burst collapses into «N رسائل جديدة» by
 *     reusing the tag, without delaying anything.
 *   - Every banner dismisses itself after CLOSE_AFTER_MS. A notification that sits
 *     on screen until the user closes it by hand is the reported bug: «الإشعار
 *     بيظهر فترة طويلة لحد ما بقفله أنا».
 *   - A click focuses an existing tab and navigates it, or opens a new one.
 *
 * Bump SW_VERSION when the behaviour changes; the page registers with
 * `updateViaCache: 'none'` so a new file is picked up on the next load.
 */
const SW_VERSION = 'v2-2026-11-06'

/** How long a banner stays on screen before it dismisses itself. */
const CLOSE_AFTER_MS = 10_000

/** Kinds the in-app card already covers on a focused device. */
const POPUP_KINDS = ['conversation_assigned', 'ai_handoff_unassigned', 'report_alert']

async function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

function queryConversationId(payload) {
  const tag = typeof payload.tag === 'string' ? payload.tag : ''
  if (tag.startsWith('conv:')) return tag.slice('conv:'.length)
  try {
    return new URL(payload.url || '', self.location.origin).searchParams.get('c')
  } catch {
    return null
  }
}

function isViewingConversation(client, conversationId) {
  if (!conversationId) return false
  try {
    return new URL(client.url).searchParams.get('c') === conversationId
  } catch {
    return false
  }
}

/**
 * Should this push become a banner?
 *
 * Returns false only when the device is already showing the user the thing the
 * banner would tell them about — the open thread, or an in-app card for an alert
 * that has one. Everything else is a real interruption and gets a banner.
 */
function shouldShow(payload, clients) {
  // The explicit test button is pressed while looking at the screen; suppressing it
  // would make the button look broken.
  if (payload.kind === 'test') return true

  const focused = clients.filter(
    (client) => client.visibilityState === 'visible' && client.focused === true,
  )
  if (focused.length === 0) return true

  const conversationId = queryConversationId(payload)
  if (conversationId && focused.some((client) => isViewingConversation(client, conversationId))) {
    return false
  }

  if (payload.kind === 'customer_message') return true
  return !POPUP_KINDS.includes(payload.kind)
}

/** Count of already-shown notifications for this tag, so a burst reads as «N». */
async function existingCount(tag) {
  if (!tag) return 0
  const shown = await self.registration.getNotifications({ tag })
  return shown.length
}

function readPayload(event) {
  if (!event.data) return null
  try {
    return event.data.json()
  } catch {
    try {
      const text = event.data.text()
      return text ? { title: text, body: '' } : null
    } catch {
      return null
    }
  }
}

/** Dismiss our own banner after a limited time, never someone else's. */
async function dismissAfterDelay(tag) {
  await new Promise((resolve) => setTimeout(resolve, CLOSE_AFTER_MS))
  const shown = await self.registration.getNotifications(tag ? { tag } : {})
  for (const notification of shown) {
    const data = notification.data || {}
    if (data.v === SW_VERSION) notification.close()
  }
}

self.addEventListener('install', (event) => {
  // Take over as soon as the file is parsed; there is no cached shell to wait for.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const payload = readPayload(event)
  if (!payload || !payload.title) return

  event.waitUntil(
    (async () => {
      const clients = await windowClients()
      if (!shouldShow(payload, clients)) return

      const tag = payload.tag || undefined
      const already = await existingCount(tag)

      // Same conversation, another message: update the banner in place. No second
      // sound (`renotify: false`) so a chatty customer does not turn into a siren.
      const lang = payload.lang === 'en' ? 'en' : 'ar'
      const body =
        already > 0
          ? lang === 'en'
            ? `${already + 1} new messages`
            : `${already + 1} رسائل جديدة`
          : payload.body

      await self.registration.showNotification(payload.title, {
        body,
        tag,
        icon: '/icon',
        badge: '/icon',
        dir: 'auto',
        lang,
        data: { url: payload.url || '/notifications', kind: payload.kind || 'alert', v: SW_VERSION },
        renotify: already === 0,
        // Never `true`: that is what pinned the banner to the screen until it was
        // closed by hand. The worker dismisses it itself after CLOSE_AFTER_MS.
        requireInteraction: false,
        vibrate: already === 0 ? [80, 40, 80] : undefined,
        // A dashboard tab is open somewhere, so the page plays the product's own
        // chime (`sound.ts`) and the OS must not ring twice. With no tab open this
        // is the only sound the user gets.
        silent: clients.length > 0,
      })

      await dismissAfterDelay(tag)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  const url = (event.notification.data && event.notification.data.url) || '/notifications'
  event.notification.close()

  event.waitUntil(
    (async () => {
      const windows = await windowClients()
      for (const client of windows) {
        if ('focus' in client) {
          try {
            if ('navigate' in client) await client.navigate(url)
            await client.focus()
            return
          } catch {
            // Fall through to openWindow below.
          }
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

/* Chrome rotates a subscription on its own (browser update, storage eviction,
 * VAPID change). Without this the device silently stops receiving anything. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.subscribe(
        event.oldSubscription
          ? {
              userVisibleOnly: true,
              applicationServerKey: event.oldSubscription.options.applicationServerKey,
            }
          : { userVisibleOnly: true },
      )
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), locale: 'ar' }),
      })
    })().catch(() => {}),
  )
})
