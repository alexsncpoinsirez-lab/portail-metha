/* =====================================================================
   PORTAIL MÉTHA — moteur de l'appli
   - navigation (accueil -> site -> outil)
   - stockage local (IndexedDB) pour l'affichage instantané
   - file d'attente d'envoi : les saisies partent dès qu'il y a du réseau
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Petits utilitaires ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  var toastTimer;
  function toast(msg, duree) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('visible'); }, duree || 2600);
  }

  /* ---------- Préférences légères (localStorage, protégé) ---------- */
  var Prefs = {
    get: function (k, def) {
      try { var v = localStorage.getItem('pm_' + k); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem('pm_' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- Stockage local : IndexedDB ---------- */
  var DB = (function () {
    var dbp = null;
    var memoire = { kv: {}, outbox: {} }; // secours si IndexedDB indisponible
    var seq = 1;
    function ouvrir() {
      if (dbp) return dbp;
      dbp = new Promise(function (ok) {
        try {
          var req = indexedDB.open('portail-metha', 1);
          req.onupgradeneeded = function () {
            var db = req.result;
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
          };
          req.onsuccess = function () { ok(req.result); };
          req.onerror = function () { ok(null); };
        } catch (e) { ok(null); }
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return ouvrir().then(function (db) {
        if (!db) { var r = fn(null); return (r && r.result !== undefined) ? r.result : r; }
        return new Promise(function (ok, ko) {
          var t = db.transaction(store, mode);
          var res = fn(t.objectStore(store));
          t.oncomplete = function () { ok(res instanceof IDBRequest ? res.result : undefined); };
          t.onerror = function () { ko(t.error); };
        });
      });
    }
    return {
      get: function (k) {
        return tx('kv', 'readonly', function (s) { return s ? s.get(k) : { result: memoire.kv[k] }; });
      },
      set: function (k, v) {
        return tx('kv', 'readwrite', function (s) { if (s) s.put(v, k); else memoire.kv[k] = v; });
      },
      del: function (k) {
        return tx('kv', 'readwrite', function (s) { if (s) s['delete'](k); else delete memoire.kv[k]; });
      },
      ajouterEnvoi: function (item) {
        return tx('outbox', 'readwrite', function (s) {
          if (s) s.add(item); else { item.seq = seq++; memoire.outbox[item.seq] = item; }
        });
      },
      listerEnvois: function () {
        return tx('outbox', 'readonly', function (s) {
          if (s) return s.getAll();
          return { result: Object.keys(memoire.outbox).map(function (k) { return memoire.outbox[k]; }) };
        });
      },
      supprimerEnvoi: function (seqId) {
        return tx('outbox', 'readwrite', function (s) { if (s) s['delete'](seqId); else delete memoire.outbox[seqId]; });
      }
    };
  })();

  /* ---------- Appels au serveur Apps Script ---------- */
  var Api = {
    // text/plain évite la « pré-vérification » CORS, Apps Script accepte très bien.
    appeler: function (apiUrl, corps, delaiMs) {
      if (!apiUrl) return Promise.reject(new Error('URL du serveur non renseignée (Réglages)'));
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, delaiMs || 25000) : null;
      return fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corps),
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('Serveur : code ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.ok !== true) throw new Error((j && j.erreur) || 'Réponse invalide du serveur');
        return j;
      });
    }
  };

  /* ---------- File d'attente d'envoi (hors ligne) ---------- */
  var Envoi = (function () {
    var enCours = false;
    var ecouteurs = [];
    function notifier() {
      return DB.listerEnvois().then(function (l) {
        var n = (l || []).length;
        majEtatSync(n);
        ecouteurs.forEach(function (f) { try { f(n); } catch (e) {} });
        return n;
      });
    }
    function vider() {
      if (enCours || !navigator.onLine) return notifier();
      enCours = true;
      return DB.listerEnvois().then(function (liste) {
        liste = liste || [];
        if (!liste.length) return;
        // Regroupe les saisies sans photo (25 max) ; une photo part seule.
        var premier = liste[0];
        var lot = [premier];
        if (!premier.photo) {
          for (var i = 1; i < liste.length && lot.length < 25; i++) {
            if (liste[i].photo || liste[i].siteId !== premier.siteId) break;
            lot.push(liste[i]);
          }
        }
        return Api.appeler(apiSite(premier.siteId), {
          action: 'enregistrer',
          cle: cleSite(premier.siteId),
          items: lot.map(function (x) { return x.payload; })
        }).then(function () {
          return Promise.all(lot.map(function (x) { return DB.supprimerEnvoi(x.seq); }));
        }).then(function () {
          enCours = false;
          return vider();
        });
      })['catch'](function (e) {
        console.warn('Envoi différé :', e && e.message);
        Envoi.derniereErreur = e && e.message;
      }).then(function () { enCours = false; return notifier(); });
    }
    return {
      // siteId : la saisie part vers le serveur de CE site uniquement
      ajouter: function (siteId, payload, photo) {
        payload.id = payload.id || uid();
        return DB.ajouterEnvoi({ siteId: siteId, payload: payload, photo: !!photo, cree: Date.now() })
          .then(function () { vider(); return payload.id; });
      },
      vider: vider,
      compter: notifier,
      surChangement: function (f) { ecouteurs.push(f); }
    };
  })();

  function majEtatSync(nAttente) {
    var e = $('#etatSync');
    e.classList.remove('horsligne', 'attente');
    if (!navigator.onLine) {
      e.classList.add('horsligne');
      e.textContent = nAttente ? 'Hors ligne · ' + nAttente + ' en attente' : 'Hors ligne';
    } else if (nAttente) {
      e.classList.add('attente');
      e.textContent = nAttente + ' à envoyer';
    } else {
      e.textContent = 'À jour';
    }
  }
  window.addEventListener('online', function () { Envoi.vider(); });
  window.addEventListener('offline', function () { Envoi.compter(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Envoi.vider(); });
  setInterval(function () { Envoi.vider(); }, 30000);

  /* ---------- Icônes ---------- */
  var ICONES = {
    ronde: '<path d="M9 4h6M9 4a2 2 0 0 0-2 2v0H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1a2 2 0 0 0-2-2M8.5 12.5l2 2 4.5-4.5"/>',
    analyse: '<path d="M9 3v6l-4.5 8.5A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.8-2.5L15 9V3M8 3h8M7.5 14h9"/>',
    bougie: '<path d="M12 2v3M9 5h6v4H9zM10 9h4v5h-4zM12 14v4M10 18h4M11 21h2"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v7"/>',
    filtre: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    agitation: '<path d="M12 3v18M12 12c-4 0-6-2-7-4M12 12c4 0 6 2 7 4M5 21h14"/>',
    pompe: '<circle cx="10" cy="13" r="5.5"/><circle cx="10" cy="13" r="1.6"/><path d="M14 8.5h6v4M4.5 21h11M10 18.5V21"/>',
    document: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    site: '<path d="M3 21h18M5 21V10l5-3v14M10 21V5l9 4v12M13 11h3M13 15h3"/>',
    fleche: '<path d="M9 5l7 7-7 7"/>'
  };
  function icone(nom, taille) {
    taille = taille || 26;
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', taille); s.setAttribute('height', taille);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = ICONES[nom] || ICONES.document;
    return s;
  }

  /* ---------- Configuration ---------- */
  var CFG = window.PORTAIL_CONFIG;
  function site(id) { return CFG.sites.filter(function (s) { return s.id === id; })[0]; }
  function trouverOutil(id) {
    for (var i = 0; i < CFG.sites.length; i++) {
      var o = CFG.sites[i].outils.filter(function (x) { return x.id === id; })[0];
      if (o) return { outil: o, site: CFG.sites[i] };
    }
    return null;
  }
  /* Un serveur Apps Script PAR SITE : adresse + clé propres à chaque site */
  function apiSite(siteId) {
    var s = site(siteId) || {};
    return Prefs.get('api_site_' + siteId, '') || s.apiUrl || '';
  }
  function cleSite(siteId) { return Prefs.get('cle_site_' + siteId, ''); }
  // Reprise automatique des réglages de la v1 (réglés par outil)
  (function migrerReglagesV1() {
    if (Prefs.get('api_site_rotte', '') || !Prefs.get('api_rondes-rotte', '')) return;
    Prefs.set('api_site_rotte', Prefs.get('api_rondes-rotte', ''));
    Prefs.set('cle_site_rotte', Prefs.get('cle_rondes-rotte', ''));
  })();

  /* ---------- Écrans ---------- */
  function entete(titre, sous, retour) {
    $('#titre').textContent = titre;
    $('#sousTitre').textContent = sous || '';
    var b = $('#btnRetour');
    b.hidden = !retour;
    b.onclick = function () { location.hash = retour || ''; };
    document.title = titre === 'Portail Métha' ? titre : titre + ' · Portail Métha';
  }

  function ecranAccueil(vue) {
    entete('Portail Métha', 'Outils de maintenance', null);
    vue.appendChild(el('p', { class: 'accueil-intro' }, ['Choisis ton site pour retrouver ses outils.']));
    var grille = el('div', { class: 'sites' });
    CFG.sites.forEach(function (s) {
      var rapides = s.outils.filter(function (o) { return o.type === 'interne'; }).length;
      var b = el('button', {
        class: 'carte-site', style: '--c:' + s.couleur + ';--n:' + (s.neon || s.couleur) + ';--i:' + grille.children.length,
        onclick: function () { Prefs.set('dernierSite', s.id); location.hash = 'site/' + s.id; }
      }, [
        el('div', { class: 'deco', html: DECO_SITE }),
        icone('site', 34),
        el('div', { class: 'statut' }, ['● EN LIGNE · SITE ' + String(grille.children.length + 1).padStart(2, '0')]),
        el('div', { class: 'nom' }, [s.nom]),
        el('div', { class: 'info' }, [s.outils.length + ' outil' + (s.outils.length > 1 ? 's' : '') + (rapides ? ' · ' + rapides + ' en version rapide' : '')])
      ]);
      grille.appendChild(b);
    });
    vue.appendChild(grille);
  }

  function badgeOutil(o) {
    if (o.type === 'interne') return el('span', { class: 'badge rapide' }, ['⚡ Version rapide']);
    if (!o.url) return el('span', { class: 'badge vide' }, ['Lien à renseigner']);
    return el('span', { class: 'badge ancien' }, ['Ancienne version']);
  }

  function ouvrirOutil(o) {
    if (o.type === 'interne') { location.hash = 'outil/' + o.id; return; }
    if (!o.url) { toast('Lien pas encore renseigné : colle l’URL dans config.js'); return; }
    window.open(o.url, '_blank', 'noopener');
  }

  function ecranSite(vue, id) {
    var s = site(id);
    if (!s) { location.hash = ''; return; }
    entete(s.nom, s.sousTitre, '#');
    vue.style.setProperty('--c', s.couleur);

    var car = el('div', { class: 'carrousel', role: 'list' });
    s.outils.forEach(function (o, i) {
      car.appendChild(el('button', { class: 'carte-outil', role: 'listitem', style: '--c:' + s.couleur + ';--n:' + (s.neon || s.couleur) + ';--i:' + i, onclick: function () { ouvrirOutil(o); } }, [
        el('div', { class: 'ico' }, [icone(o.icone, 30)]),
        el('div', { class: 'nom' }, [o.nom]),
        el('div', { class: 'desc' }, [o.description || '']),
        badgeOutil(o)
      ]));
    });
    vue.appendChild(car);

    var pts = el('div', { class: 'points-nav', style: '--c:' + s.couleur + ';--n:' + (s.neon || s.couleur) });
    s.outils.forEach(function (_, i) { pts.appendChild(el('span', { class: i === 0 ? 'actif' : '' })); });
    vue.appendChild(pts);
    // Effet « coverflow » : chaque carte pivote selon sa distance au centre
    function majCarrousel() {
      var cartes = car.children, centre = car.scrollLeft + car.clientWidth / 2, idx = 0, best = 1e9;
      for (var i = 0; i < cartes.length; i++) {
        var c = cartes[i], m = c.offsetLeft + c.offsetWidth / 2, d = m - centre;
        var r = Math.max(-1, Math.min(1, d / c.offsetWidth));
        c.style.setProperty('--d', r.toFixed(3));
        c.style.setProperty('--a', Math.abs(r).toFixed(3));
        if (Math.abs(d) < best) { best = Math.abs(d); idx = i; }
      }
      Array.prototype.forEach.call(pts.children, function (p, i) { p.classList.toggle('actif', i === idx); });
    }
    var rafCar = null;
    car.addEventListener('scroll', function () {
      if (rafCar) return;
      rafCar = requestAnimationFrame(function () { rafCar = null; majCarrousel(); });
    }, { passive: true });
    requestAnimationFrame(majCarrousel);

    vue.appendChild(el('div', { class: 'liste-titre' }, ['Tous les outils']));
    var liste = el('div', { class: 'liste-outils' });
    s.outils.forEach(function (o) {
      liste.appendChild(el('button', { class: 'ligne-outil', style: '--c:' + s.couleur + ';--n:' + (s.neon || s.couleur), onclick: function () { ouvrirOutil(o); } }, [
        el('div', { class: 'ico' }, [icone(o.icone, 20)]),
        el('div', { class: 'txt' }, [el('div', { class: 'nom' }, [o.nom]), el('div', { class: 'desc' }, [o.type === 'interne' ? 'Version rapide · hors ligne' : (o.url ? 'Ouvre l’ancienne appli' : 'Lien à renseigner')])]),
        icone('fleche', 18)
      ]));
    });
    vue.appendChild(liste);
  }

  function ecranOutil(vue, id) {
    var t = trouverOutil(id);
    if (!t || t.outil.type !== 'interne') { location.hash = ''; return; }
    var mod = (window.MODULES || {})[t.outil.module];
    entete(t.outil.nom, t.site.nom, '#site/' + t.site.id);
    if (!mod) { vue.appendChild(el('div', { class: 'vide-msg' }, ['Module introuvable.'])); return; }
    mod.afficher(vue, {
      outil: t.outil, site: t.site, apiUrl: apiSite(t.site.id), cle: cleSite(t.site.id)
    });
  }

  function ecranReglages(vue) {
    entete('Réglages', 'Connexion aux serveurs Apps Script', '#');
    vue.appendChild(el('p', { class: 'petit' }, [
      'Chaque site a son propre serveur. Colle son adresse (se termine par /exec) et sa clé : tous les outils « version rapide » du site s’en servent.'
    ]));
    CFG.sites.forEach(function (s) {
      var rapides = s.outils.filter(function (o) { return o.type === 'interne'; });
      var url = el('input', { type: 'url', value: apiSite(s.id), placeholder: 'https://script.google.com/macros/s/…/exec' });
      var cle = el('input', { type: 'text', value: cleSite(s.id), placeholder: 'Clé du site', autocomplete: 'off' });
      var res = el('div', { class: 'petit' });
      vue.appendChild(el('div', { class: 'bandeau', style: '--n:' + (s.neon || s.couleur) }, [
        el('div', { style: 'font-weight:700' }, [s.nom]),
        el('div', { class: 'petit', style: 'margin-bottom:10px' }, [rapides.length
          ? 'Outils concernés : ' + rapides.map(function (o) { return o.nom; }).join(', ')
          : 'Aucun outil en version rapide pour l’instant']),
        el('div', { class: 'champ' }, [el('label', {}, ['Adresse du serveur du site']), url]),
        el('div', { class: 'champ' }, [el('label', {}, ['Clé du site']), cle]),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('button', { class: 'btn-second', onclick: function () {
            Prefs.set('api_site_' + s.id, url.value.trim());
            Prefs.set('cle_site_' + s.id, cle.value.trim());
            if (!url.value.trim()) { res.textContent = 'Enregistré (vide)'; return; }
            res.textContent = 'Test en cours…';
            Api.appeler(url.value.trim(), { action: 'ping', cle: cle.value.trim() }, 20000).then(function (j) {
              res.textContent = '✓ Connecté à « ' + (j.nomSite || 'serveur') + ' »';
              Envoi.vider();
            })['catch'](function (e) { res.textContent = '✗ ' + e.message; });
          } }, ['Enregistrer et tester']),
          res
        ])
      ]));
    });
    vue.appendChild(el('div', { class: 'bandeau' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Nom de l’agent sur ce téléphone']),
      (function () {
        var i = el('input', { type: 'text', value: Prefs.get('agent', ''), placeholder: 'Prénom' });
        i.addEventListener('change', function () { Prefs.set('agent', i.value.trim()); toast('Nom enregistré'); });
        return el('div', { class: 'champ' }, [i]);
      })()
    ]));
    var themeActuel = Prefs.get('theme', 'futur');
    vue.appendChild(el('div', { class: 'bandeau' }, [
      el('div', { style: 'font-weight:700;margin-bottom:10px' }, ['Apparence']),
      el('div', { style: 'display:flex;gap:8px' }, [['futur', 'Futuriste'], ['classique', 'Classique (plein soleil)']].map(function (t) {
        return el('button', { class: 'btn-second' + (themeActuel === t[0] ? ' actif' : ''), onclick: function () {
          Prefs.set('theme', t[0]); appliquerTheme(); router();
        } }, [t[1]]);
      }))
    ]));
    vue.appendChild(el('p', { class: 'petit' }, ['Version de l’appli : ' + VERSION_APP]));
  }

  /* ---------- Thème (futuriste par défaut) ---------- */
  function appliquerTheme() {
    var t = Prefs.get('theme', 'futur');
    document.body.classList.toggle('futur', t === 'futur');
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t === 'futur' ? '#05080f' : '#1d2a24');
  }
  var DECO_SITE = '<svg viewBox="0 0 200 120" aria-hidden="true">' +
    '<g fill="none" stroke="currentColor" stroke-width="1.2">' +
    '<path d="M30 100h140M45 100V70h110v30"/><path d="M45 70a55 38 0 0 1 110 0" class="dome"/>' +
    '<path d="M60 70a40 26 0 0 1 80 0" opacity=".5"/><path d="M75 70a25 15 0 0 1 50 0" opacity=".3"/>' +
    '<circle cx="100" cy="48" r="3" class="pulse"/><path d="M155 85h25v15M180 85V40" opacity=".6"/>' +
    '<line x1="40" y1="0" x2="40" y2="120" class="scan"/></g></svg>';

  /* ---------- Routeur ---------- */
  function router() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var vue = $('#vue');
    vue.innerHTML = '';
    vue.removeAttribute('style');
    window.scrollTo(0, 0);
    var p = h.split('/');
    if (p[0] === 'site') ecranSite(vue, p[1]);
    else if (p[0] === 'outil') ecranOutil(vue, p[1]);
    else if (p[0] === 'reglages') ecranReglages(vue);
    else ecranAccueil(vue);
  }
  window.addEventListener('hashchange', router);
  $('#btnReglages').addEventListener('click', function () { location.hash = 'reglages'; });

  var VERSION_APP = '1.4.0';

  /* ---------- Exposé aux modules ---------- */
  window.PM = { apiSite: apiSite, cleSite: cleSite, el: el, $: $, toast: toast, Prefs: Prefs, DB: DB, Api: Api, Envoi: Envoi, uid: uid, icone: icone };
  window.MODULES = window.MODULES || {};

  /* ---------- Démarrage ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    appliquerTheme();
    router();
    Envoi.vider();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js')['catch'](function () {});
    });
  }
})();
