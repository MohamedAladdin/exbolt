/* ExBolt service worker — Web Push only.
 *
 * Deliberately has NO `fetch` handler. A service worker without a cache has nothing
 * to add to a request, and one parked in the request path of a Next app is a
 * performance and debugging tax (stale chunks, opaque failures) for zero benefit.
 * Only `push` and `notificationclick` are handled.
 *
 * Rules that come from the product decisions, not from taste:
 *   - Never show an OS notification on a device whose dashboard tab is visible AND
 *     focused — that device already got the in-app popup.
 *   - One conversation = one banner. A burst collapses into «N رسائل جديدة» by
 *     reusing the tag, without delaying anything.
 *   - A click focuses an existing tab and navigates it, or opens a new one.
 *
 * Bump SW_VERSION when the behaviour changes; the page registers with
 * `updateViaCache: 'none'` so a new file is picked up on the next load.
 */
const SW_VERSION = 'v1-2026-11-05'

/** Is there a dashboard window the user is actually looking at? */
async function hasFocusedClient() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some((client) => client.visibilityState === 'visible' && client.focused === true)
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
      if (await hasFocusedClient()) return

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
        requireInteraction: false,
        vibrate: already === 0 ? [80, 40, 80] : undefined,
        silent: false,
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  const url = (event.notification.data && event.notification.data.url) || '/notifications'
  event.notification.close()

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
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
