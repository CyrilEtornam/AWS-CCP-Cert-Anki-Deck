// Bump this on every deploy that changes cached files, so clients pick up
// the new version instead of serving stale cache-first responses forever.
var CACHE_VERSION = 'ccp-study-v3';

var CORE_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/fraunces.woff2',
  'data/deck.json',
  'data/curriculum.json',
  'data/reference-index.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(CORE_ASSETS)
        .then(function () { return fetch('data/reference-index.json'); })
        .then(function (res) { return res.json(); })
        .then(function (refIndex) {
          var refUrls = refIndex.map(function (item) { return 'data/reference/' + item.file; });
          return cache.addAll(refUrls);
        });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var network = fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
