/* Offline cache for Talk Cards by Dr. Asma Khattala (adapted from Maria's Talk Cards sw.js).
   Several apps share asmaasma1111.github.io, so this app's caches all start with "epp-talk-cards-" and only
   those are ever deleted. Bump VERSION when app.js, style.css or index.html change.
   Level files, config.js and the voice list are refreshed in the background, so a new set reaches phones
   on the next open without a version bump. */
const PREFIX = 'epp-talk-cards-';
const VERSION = PREFIX + 'v1';
const LEVEL_FILES = ['pre-a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(l => `levels/${l}.json`);
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'levels/index.json',
  ...LEVEL_FILES,
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'fonts/noto-naskh-arabic.woff2'
];
const FRESH = /\/(levels\/[^/]+\.json|config\.js|audio\/voice\.json)$/;   // stale-while-revalidate

// The recorded voice: only the list (audio/voice.json) and the unlock clip are cached at install. Each clip is
// cached the first time it plays (cache first below), so a phone never downloads levels it has not reached.
async function cacheVoice(cache) {
  try {
    const res = await fetch('audio/voice.json', { cache: 'no-cache' });
    if (res.ok) await cache.put('audio/voice.json', res);
    await cache.add('audio/_unlock.m4a');
  } catch (e) { /* no recordings yet: the app uses the device voice */ }
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => { await c.addAll(FILES); await cacheVoice(c); }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // the teacher's Sheet (POST) is never cached
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const put = res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };
  // On a local test server, fetch fresh files first so edits show up; fall back to the cache offline.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    e.respondWith(fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-store' }).then(put)
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  if (FRESH.test(url.pathname)) {
    const net = fetch(req, { cache: 'no-cache' }).then(async res => {
      if (res.ok) await (await caches.open(VERSION)).put(req, res.clone());
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || net));
    return;
  }
  // Everywhere else: cache first, so the app opens instantly and works with no signal.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(put)));
});
