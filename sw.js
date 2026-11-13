// Service worker minimo: la app abre aunque no haya señal (solo archivos propios).
// Primero busca en internet (para ver siempre la version nueva) y, si falla, usa la copia guardada.
// No guarda nada de Supabase ni de otros sitios: los datos siempre vienen en vivo.
const CACHE = 'inventario-v1';
const BASE = ['./', './index.html', './styles.css', './app.js', './local.js', './config.js', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => { }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ns => Promise.all(ns.filter(n => n !== CACHE).map(n => caches.delete(n)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(r, { cache: 'no-store' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
      .catch(() => caches.match(r))
  );
});
