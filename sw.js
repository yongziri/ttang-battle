/* 서비스 워커 — 링크(http/https)로 연 경우에만 등록된다(file:// 더블클릭은 사용 안 함).
   전략: 네트워크 우선 → 실패하면 캐시. 온라인이면 늘 새 파일을 받고, 받은 것을 캐시에 갱신해 둔다.
   파일을 바꿔 배포할 때 VERSION 을 올리면 예전 캐시가 지워진다. */
var VERSION = '2026-11-25-1';
var CACHE = 'ttang-battle-' + VERSION;
var FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'game.js', 'voxel.js', 'music.js', 'editor.js',
  'sets/social-5.js', 'sets/social-6.js', 'sets/social-7.js', 'sets/social-8.js',
  'sets/social-9.js', 'sets/social-10.js', 'sets/social-11.js', 'sets/social-12.js', 'sets/recreation.js',
  'fonts/Galmuri11.woff2', 'fonts/Galmuri11-Bold.woff2',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 한 파일이 없어도 나머지는 캐시(전부 실패시키지 않음)
    return Promise.all(FILES.map(function (f) {
      return fetch(f, { cache: 'no-cache' }).then(function (res) {
        if (res.ok) return c.put(f, res);
        return null;
      }).catch(function () { return null; });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('ttang-battle-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); })
    .then(function () { return self.clients.matchAll(); })
    .then(function (list) { list.forEach(function (cl) { cl.postMessage({ type: 'ttang-cached', version: VERSION }); }); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic' && !res.redirected) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('./').then(function (h) { return h || c.match('index.html'); });
        return Response.error();
      });
    });
  }));
});
