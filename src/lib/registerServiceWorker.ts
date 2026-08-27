/** Registra o service worker do PWA (public/sw.js) — só existe pra habilitar "instalar app" e
 * notificação push, não cacheia nada (ver comentário no próprio sw.js). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[sw] falha ao registrar service worker', err)
    })
  })
}
