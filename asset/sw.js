// Service worker: aplikasi bisa dibuka cepat & tetap tampil walau sinyal lemah.
// File aplikasi: ambil dari jaringan dulu (selalu versi terbaru), cadangan dari cache bila offline.
const V = 'inv-app-1.3-1.3.11250953';
const SHELL = ['./', './index.html', './app.js', './api.js', './app.css', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './header.jpg', './notadinas.jpg'];
const CDN = ['https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js', 'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).then(() => Promise.all(CDN.map(u =>
    fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {}))))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname === 'unpkg.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); return r; })));
  }
});
