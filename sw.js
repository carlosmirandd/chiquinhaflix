// Service worker do ChiquinhaFlix: deixa o app instalável e abrir sem rede.
// Guarda só o "esqueleto" do site (HTML, CSS, JS, imagens). Dados e vídeos sempre vão à rede.
const V = 'chiquinhaflix-v2';
const BASE = ['./', 'index.html', 'style.css', 'app.js', 'tv.js', 'config.js', 'manifest.webmanifest', 'assets/chiquinha.png', 'assets/nome.png', 'assets/logo.png', 'assets/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;          // APIs, imagens externas e embeds: rede normal
  if (/\/(agenda|canais)\.json$/.test(u.pathname)) return; // dados: sempre da rede (o app tem o próprio cache)
  // rede primeiro (pega atualizações); sem rede, usa o que está guardado
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
