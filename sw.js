/* Service worker : garde l'appli sur le téléphone -> ouverture instantanée, même sans réseau.
   Pour publier une mise à jour : changer le numéro de VERSION ci-dessous. */
var VERSION = 'portail-metha-v5';
var FICHIERS = ['./', 'index.html', 'styles.css', 'config.js', 'app.js', 'rondes.js', 'nh3.js', 'icons/logo-prodeval.png',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FICHIERS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  var polices = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !polices) return; // serveurs Apps Script : jamais en cache ici
  // Affiche tout de suite la version gardée, et la met à jour en arrière-plan.
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (enCache) {
      var reseau = fetch(e.request).then(function (r) { if (r && r.ok) c.put(e.request, r.clone()); return r; })
        .catch(function () { return enCache; });
      return enCache || reseau;
    });
  }));
});
