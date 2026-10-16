// 通知を受け取るためのサービスワーカー（画面のキャッシュなどはしない）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'みんなの希望休', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png', // 通知バーの小さなアイコン（透明の背景に白い形だけ）
      tag: data.tag || undefined,
    }),
  );
});

// 通知を押したら、開いている画面があればそれを前に出し、なければ開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
