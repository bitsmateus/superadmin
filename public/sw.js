// Service worker do TenantHub — só existe pra habilitar "instalar app" e notificação push.
// De propósito NÃO cacheia nada (sem app shell offline): é uma ferramenta interna que muda
// várias vezes por semana, cache de bundle aqui serviria versão velha do painel pra galera.
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Handler de fetch vazio (só repassa pra rede) — alguns navegadores só contam o app como
// instalável se o service worker tiver um listener de fetch registrado.
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'TenantHub', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'TenantHub'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
