/* Service worker : garde l'appli sur le téléphone -> ouverture instantanée, même sans réseau.
   Pour publier une mise à jour : changer le numéro de VERSION ci-dessous. */
var VERSION = 'portail-metha-v11';
var FICHIERS = ['./', 'index.html', 'styles.css', 'config.js', 'app.js', 'rondes.js', 'nh3.js', 'bougies.js', 'agitation.js', 'analyses.js', 'icons/logo-prodeval.png',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

// Fichiers indispensables : s'il en manque un, la mise à jour attend. Les images peuvent manquer sans tout bloquer.
var ESSENTIELS = ['./', 'index.html', 'styles.css', 'config.js', 'app.js'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(FICHIERS.map(function (f) {
      // cache: 'reload' -> toujours la version fraîche de GitHub (pas un mélange ancien / nouveau)
      var p = fetch(new Request(f, { cache: 'reload' })).then(function (r) {
        if (!r.ok) throw new Error(f + ' : ' + r.status);
        return c.put(f, r);
      });
      return ESSENTIELS.indexOf(f) >= 0 ? p : p['catch'](function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
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
