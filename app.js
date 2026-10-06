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
  /* Lecture d'un nombre saisi : « 21 300 », « 77967,8 », « 1.5 ».
     Renvoie null si vide, NaN si ce n'est pas un nombre (« 12abc » est refusé). */
  function nombre(x) {
    if (x === null || x === undefined) return null;
    if (typeof x === 'number') return isFinite(x) ? x : NaN;
    var t = String(x).replace(/[\s\u00a0\u202f']/g, '').replace(',', '.');
    if (t === '') return null;
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : NaN;
  }

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
      majEnvoi: function (item) {
        return tx('outbox', 'readwrite', function (s) { if (s) s.put(item); else memoire.outbox[item.seq] = item; });
      },
      // false si le téléphone n'a pas de stockage durable (navigation privée…) : les saisies seraient perdues à la fermeture
      durable: function () { return ouvrir().then(function (db) { return !!db; }); },
      supprimerEnvoi: function (seqId) {
        return tx('outbox', 'readwrite', function (s) { if (s) s['delete'](seqId); else delete memoire.outbox[seqId]; });
      }
    };
  })();

  /* ---------- Journal réseau : les 40 derniers échanges (Réglages) ---------- */
  var Journal = (function () {
    var cle = 'pm_journal_reseau', l = [];
    try { l = JSON.parse(localStorage.getItem(cle) || '[]') || []; } catch (e) { l = []; }
    return {
      noter: function (x) { l.unshift(x); if (l.length > 40) l.length = 40; try { localStorage.setItem(cle, JSON.stringify(l)); } catch (e) {} },
      lister: function () { return l.slice(); },
      vider: function () { l = []; try { localStorage.removeItem(cle); } catch (e) {} }
    };
  })();
  // Erreur typée : reseau (pas de réseau / coupure), delai (serveur trop lent), occupe, page (le serveur
  // renvoie une page Google : autorisation ou déploiement), serveur (le serveur a répondu une vraie erreur).
  function erreur(type, message) { var e = new Error(message); e.type = type; e.serveur = type === 'serveur'; return e; }
  function raison(e) {
    var t = e && e.type;
    return t === 'reseau' ? 'Pas de réseau' : t === 'delai' ? 'Serveur trop lent' : t === 'occupe' ? 'Serveur occupé'
      : t === 'page' ? 'Serveur indisponible' : 'Erreur du serveur';
  }
  function nomSiteDeUrl(u) {
    try { var s = CFG.sites.filter(function (x) { return apiSite(x.id) === u; })[0]; return s ? s.nom : ''; } catch (e) { return ''; }
  }

  /* ---------- Appels au serveur Apps Script ---------- */
  var Api = {
    // text/plain évite la « pré-vérification » CORS, Apps Script accepte très bien.
    // Lectures : au moins 60 s d'attente et UN nouvel essai automatique si le serveur est lent ou occupé
    // (Apps Script qui « se réveille » + gros tableaux + 4G faible dépassent souvent 25 s).
    appeler: function (apiUrl, corps, delaiMs) {
      if (!apiUrl) return Promise.reject(erreur('serveur', 'URL du serveur non renseignée (Réglages)'));
      var action = String(corps && corps.action || '');
      var lecture = action !== 'enregistrer' && action !== 'ping';
      var delai = lecture ? Math.max(delaiMs || 0, 60000) : (delaiMs || 60000);
      function essai(n) {
        var t0 = Date.now();
        function noter(r, m) { Journal.noter({ t: t0, a: action, s: nomSiteDeUrl(apiUrl), d: Date.now() - t0, r: r, m: m || '', n: n }); }
        if (navigator.onLine === false) { var e0 = erreur('reseau', 'Pas de réseau : le téléphone est hors connexion.'); noter('reseau', e0.message); return Promise.reject(e0); }
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, delai) : null;
        return fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(corps),
          redirect: 'follow',
          signal: ctrl ? ctrl.signal : undefined
        })['catch'](function (e) {
          if (timer) clearTimeout(timer);
          if (e && e.name === 'AbortError') throw erreur('delai', 'Le serveur n’a pas répondu en ' + Math.round(delai / 1000) + ' s.');
          throw erreur('reseau', navigator.onLine === false ? 'Pas de réseau : le téléphone est hors connexion.'
            : 'Connexion coupée pendant l’échange (réseau faible, écran éteint ou appli quittée ?).');
        }).then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) throw erreur(r.status === 429 || r.status >= 500 ? 'occupe' : 'page', 'Serveur : code ' + r.status);
          return r.text();
        }).then(function (txt) {
          var j;
          try { j = JSON.parse(txt); } catch (x) {
            throw erreur('page', 'Le serveur a renvoyé une page Google au lieu des données (autorisation à refaire ou déploiement en cours ?).');
          }
          if (!j || j.ok !== true) {
            var m = (j && j.erreur) || 'Réponse invalide du serveur';
            throw erreur(/lock|verrou|occup|too many|trop de|simultan|service invoked/i.test(m) ? 'occupe' : 'serveur', m);
          }
          noter(j.occupe ? 'occupe' : 'ok', j.occupe ? 'serveur occupé : renvoi plus tard' : (j.copie ? 'copie rapide' : ''));
          return j;
        }).then(null, function (e) {
          if (!e.type) e = erreur('serveur', e.message || String(e));
          noter(e.type, e.message);
          var refaire = lecture && n === 0 && (e.type === 'delai' || e.type === 'occupe' || e.type === 'page' || (e.type === 'reseau' && navigator.onLine !== false));
          if (!refaire) throw e;
          return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return essai(1); });
        });
      }
      return essai(0);
    }
  };

  /* ---------- File d'attente d'envoi (hors ligne) ----------
     - une saisie n'est retirée du téléphone QUE si le serveur l'a acceptée ;
     - une saisie refusée par le serveur est mise de côté (Réglages → Saisies refusées),
       elle ne bloque plus les suivantes ni l'autre site ;
     - un serveur en panne ne bloque pas l'envoi vers l'autre site. */
  var numeroEcran = 0; // augmente à chaque changement d'écran (voir router)
  var Envoi = (function () {
    var enCours = false;
    var ecouteurs = [];
    var erreurs = {}; // dernière erreur par site
    function etat(l) {
      l = l || [];
      var refusees = l.filter(function (x) { return x.rejete; }).length;
      return { attente: l.length - refusees, refusees: refusees };
    }
    function notifier() {
      return DB.listerEnvois().then(function (l) {
        var e = etat(l);
        majEtatSync(e.attente, e.refusees);
        ecouteurs = ecouteurs.filter(function (f) { return f.__ecran === numeroEcran; }); // écrans fermés : oubliés
        ecouteurs.forEach(function (f) { try { f(e.attente); } catch (x) {} });
        return e.attente;
      });
    }
    // Lot : saisies qui se suivent pour un même site (sans mélanger l'ordre), 25 max ; une photo part seule.
    function preparerLot(liste, siteId) {
      var dusite = liste.filter(function (x) { return !x.rejete && x.siteId === siteId; }); // lots de 8 : réponse du serveur toujours rapide
      var premier = dusite[0];
      if (premier.photo || premier.seul) return [premier];
      var lot = [premier];
      for (var i = 1; i < dusite.length && lot.length < 8; i++) {
        if (dusite[i].photo || dusite[i].seul) break;
        lot.push(dusite[i]);
      }
      return lot;
    }
    function envoyerLot(lot) {
      var siteId = lot[0].siteId;
      var avecPhoto = lot.some(function (x) { return x.photo; });
      return Api.appeler(apiSite(siteId), {
        action: 'enregistrer',
        cle: cleSite(siteId),
        items: lot.map(function (x) { return x.payload; })
      }, avecPhoto ? 120000 : 90000).then(function (j) {
        delete erreurs[siteId];
        var rejets = {}, restants = {};
        (j.rejets || []).forEach(function (r) { if (r && r.id) rejets[r.id] = r.erreur || 'Refusée par le serveur'; });
        (j.restants || []).forEach(function (id) { restants[id] = true; });
        var nbRefus = 0;
        return Promise.all(lot.map(function (x) {
          var id = x.payload && x.payload.id;
          if (id && rejets[id]) { nbRefus++; x.rejete = true; x.erreur = rejets[id]; x.quand = Date.now(); return DB.majEnvoi(x); }
          if (id && restants[id]) return null; // le serveur n'a pas eu le temps : renvoyée au prochain passage
          return DB.supprimerEnvoi(x.seq);
        })).then(function () {
          if (nbRefus) toast('⚠ ' + nbRefus + ' saisie' + (nbRefus > 1 ? 's refusées' : ' refusée') + ' par le serveur — voir Réglages', 5000);
          if (j.occupe) { erreurs[siteId] = { message: 'Serveur occupé (un autre téléphone envoie) : nouvel essai automatique', quand: Date.now() }; return 'site'; }
          return true;
        });
      }, function (e) {
        var msg = (e && e.message) || 'Erreur inconnue';
        erreurs[siteId] = { message: raison(e) + ' — ' + msg, quand: Date.now() };
        console.warn('Envoi différé (' + siteId + ') :', msg);
        if (!e || !e.serveur || /cl[ée] du site/i.test(msg)) return 'site'; // réseau ou clé : on réessaiera tel quel
        // Le serveur a répondu une erreur pour tout le lot : on isole la saisie fautive
        if (lot.length > 1) {
          return Promise.all(lot.map(function (x) { x.seul = true; return DB.majEnvoi(x); })).then(function () { return 'lot'; });
        }
        var x = lot[0];
        x.seul = true;
        x.essais = (x.essais || 0) + 1;
        if (x.essais >= 3) { x.rejete = true; x.erreur = msg; x.quand = Date.now(); toast('⚠ Une saisie est refusée par le serveur — voir Réglages', 5000); }
        return DB.majEnvoi(x).then(function () { return 'saisie'; });
      });
    }
    // Après un échec, le site attend un peu avant le prochain essai (20 s, 40 s, 80 s, 2 min max) :
    // on n'encombre pas un serveur déjà lent. « Envoyer maintenant », Renvoyer et le retour du réseau passent outre.
    var pause = {}, palier = {};
    function vider(force) {
      if (enCours || navigator.onLine === false) return notifier();
      enCours = true;
      var sitesEnPanne = {}, dejaTentees = {}, tours = 0;
      function suivant() {
        if (++tours > 200) return; // sécurité
        return DB.listerEnvois().then(function (liste) {
          liste = (liste || []).filter(function (x) { return !x.rejete && !dejaTentees[x.seq]; });
          var aFaire = liste.filter(function (x) { return !sitesEnPanne[x.siteId] && (force === true || !(pause[x.siteId] > Date.now())); });
          if (!aFaire.length) return;
          var lot = preparerLot(liste, aFaire[0].siteId);
          return envoyerLot(lot).then(function (r) {
            var sid = lot[0].siteId;
            if (r === 'site') {                                              // serveur injoignable ou occupé : on passe à l'autre site
              sitesEnPanne[sid] = true;
              palier[sid] = Math.min((palier[sid] || 10000) * 2, 120000); pause[sid] = Date.now() + palier[sid];
            } else if (r === true) { delete pause[sid]; delete palier[sid]; }
            else if (r === 'saisie') dejaTentees[lot[0].seq] = true;      // saisie fautive : on passe aux suivantes
            return suivant();                                              // 'lot' : renvoi une par une tout de suite
          });
        });
      }
      return suivant()['catch'](function (e) { console.warn('File d’envoi :', e && e.message); })
        .then(function () { enCours = false; return notifier(); });
    }
    return {
      // siteId : la saisie part vers le serveur de CE site uniquement
      ajouter: function (siteId, payload, photo) {
        payload.id = payload.id || uid();
        return DB.ajouterEnvoi({ siteId: siteId, payload: payload, photo: !!photo, cree: Date.now() })
          .then(function () { vider(); return payload.id; }, function (e) {
            toast('⚠ Impossible d’enregistrer la saisie sur ce téléphone (mémoire pleine ?). Réessaie.', 6000);
            throw e;
          });
      },
      vider: vider,
      forcer: function () { return vider(true); },
      compter: notifier,
      // l'écouteur est oublié dès qu'on change d'écran (évite qu'ils s'empilent)
      surChangement: function (f) { f.__ecran = numeroEcran; ecouteurs.push(f); },
      erreurs: function () { return erreurs; },
      refusees: function () { return DB.listerEnvois().then(function (l) { return (l || []).filter(function (x) { return x.rejete; }); }); },
      renvoyer: function (x) { delete x.rejete; delete x.erreur; x.essais = 0; x.seul = true; return DB.majEnvoi(x).then(function () { return vider(true); }); },
      abandonner: function (x) { return DB.supprimerEnvoi(x.seq).then(notifier); }
    };
  })();
  Object.defineProperty(Envoi, 'derniereErreur', { get: function () {
    var e = Envoi.erreurs(), k = Object.keys(e);
    return k.length ? e[k[0]].message : null;
  } });

  function majEtatSync(nAttente, nRefusees) {
    var e = $('#etatSync');
    e.classList.remove('horsligne', 'attente');
    e.title = Envoi.derniereErreur ? 'Dernière erreur d’envoi : ' + Envoi.derniereErreur : '';
    if (nRefusees) {
      e.classList.add('attente');
      e.textContent = '⚠ ' + nRefusees + ' refusée' + (nRefusees > 1 ? 's' : '');
      e.title = (nAttente ? nAttente + ' à envoyer. ' : '') + 'Toucher pour voir les saisies refusées.';
      e.style.cursor = 'pointer';
      e.onclick = function () { location.hash = 'reglages'; };
      return;
    }
    e.onclick = null; e.style.cursor = '';
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
  window.addEventListener('online', function () { Envoi.forcer(); });
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
    stock: '<path d="M3 8l9-5 9 5v10l-9 5-9-5zM3 8l9 5 9-5M12 13v10M7.5 5.5l9 5"/>',
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
  // Si l'adresse est écrite dans config.js, c'est TOUJOURS elle qui est utilisée :
  // un lien de configuration piégé ne peut pas détourner les saisies vers un autre serveur.
  function apiSite(siteId) {
    var s = site(siteId) || {};
    return s.apiUrl || Prefs.get('api_site_' + siteId, '') || '';
  }
  var RE_EXEC = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
  function urlCourte(u) { var m = /\/s\/([^/]+)\/exec/.exec(u || ''); return m ? '…' + m[1].slice(-8) : (u || '—'); }
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

  function ecranOutil(vue, id, extra) {
    var t = trouverOutil(id);
    if (!t || t.outil.type !== 'interne') { location.hash = ''; return; }
    var mod = (window.MODULES || {})[t.outil.module];
    entete(t.outil.nom, t.site.nom, '#site/' + t.site.id);
    if (!mod) { vue.appendChild(el('div', { class: 'vide-msg' }, ['Module introuvable.'])); return; }
    mod.afficher(vue, {
      outil: t.outil, site: t.site, apiUrl: apiSite(t.site.id), cle: cleSite(t.site.id),
      params: extra || [] // ex. #outil/stock-rotte/<matériel>/<référence> (QR code d'une pièce)
    });
  }

  /* ---------- Lien de configuration : remplit serveur + clé d'un ou plusieurs sites ---------- */
  function b64urlEncode(txt) {
    return btoa(unescape(encodeURIComponent(txt))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(txt) {
    txt = txt.replace(/-/g, '+').replace(/_/g, '/');
    while (txt.length % 4) txt += '=';
    return decodeURIComponent(escape(atob(txt)));
  }
  function lienConfig(ids) {
    var data = ids.map(function (id) { return { i: id, u: apiSite(id), k: cleSite(id) }; })
      .filter(function (d) { return d.u && d.k; });
    if (!data.length) return '';
    return location.origin + location.pathname.replace(/index\.html$/, '') + '#config/' + b64urlEncode(JSON.stringify(data));
  }
  // Lit un lien (ou juste la partie après #config/) et enregistre les réglages APRÈS confirmation.
  // Renvoie les noms des sites configurés.
  function appliquerConfig(texte) {
    var code = String(texte || '').trim();
    var pos = code.indexOf('#config/');
    if (pos >= 0) code = code.slice(pos + 8);
    else code = code.replace(/^#?config\//, '');
    var data;
    try { data = JSON.parse(b64urlDecode(code)); } catch (e) { throw new Error('Lien de configuration invalide.'); }
    var aRegler = [], lignes = [], alerte = false;
    (Array.isArray(data) ? data : [data]).forEach(function (d) {
      var s = d && site(d.i);
      if (!s || !d.k) return;
      var u;
      if (s.apiUrl) {
        // adresse figée dans l'appli : le lien ne peut apporter que la clé
        if (d.u && d.u !== s.apiUrl) { alerte = true; lignes.push('⚠ ' + s.nom + ' : le lien indique un AUTRE serveur que celui de l’appli → ignoré'); return; }
        u = s.apiUrl;
      } else {
        if (!d.u || !RE_EXEC.test(d.u)) return;
        u = d.u;
        var actuel = Prefs.get('api_site_' + s.id, '');
        if (actuel && actuel !== u) { alerte = true; lignes.push('⚠ ' + s.nom + ' : REMPLACE le serveur actuel (' + urlCourte(actuel) + ') par ' + urlCourte(u)); }
        else lignes.push('• ' + s.nom + ' : serveur ' + urlCourte(u));
      }
      if (s.apiUrl) lignes.push('• ' + s.nom + ' : clé du site');
      aRegler.push({ s: s, u: u, k: String(d.k) });
    });
    if (!aRegler.length) throw new Error(lignes.length ? lignes.join('\n') : 'Lien de configuration invalide.');
    var ok = window.confirm('Régler le portail avec ce lien ?\n\n' + lignes.join('\n') +
      '\n\nN’accepte que si le lien vient de quelqu’un de l’équipe' + (alerte ? ' — en cas de doute, refuse et demande à Alex.' : '.'));
    if (!ok) throw new Error('Configuration annulée.');
    aRegler.forEach(function (r) {
      if (!r.s.apiUrl) Prefs.set('api_site_' + r.s.id, r.u);
      Prefs.set('cle_site_' + r.s.id, r.k);
    });
    Envoi.vider();
    return aRegler.map(function (r) { return r.s.nom; });
  }
  function partagerLien(lien, titre, zone) {
    if (!lien) { toast('Renseigne d’abord le serveur et la clé, puis « Enregistrer et tester ».'); return; }
    zone.innerHTML = '';
    var champ = el('input', { type: 'text', value: lien, readonly: 'readonly' });
    zone.appendChild(el('div', { class: 'champ', style: 'margin-top:8px' }, [el('label', {}, ['Lien à envoyer à l’équipe (contient la clé : ne pas diffuser en dehors)']), champ]));
    if (navigator.share) {
      navigator.share({ title: titre, text: titre + ' — ouvre ce lien sur ton téléphone pour régler le portail :', url: lien })['catch'](function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(lien).then(function () { toast('Lien copié : colle-le dans WhatsApp ou un mail.'); })['catch'](function () { champ.select(); });
    } else champ.select();
  }

  /* Bloc « Envois » : saisies en attente, refusées, dernière erreur par site */
  function blocEnvois() {
    var bloc = el('div', { class: 'bandeau', id: 'blocEnvois' }, [el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Envois'])]);
    var corps = el('div');
    bloc.appendChild(corps);
    function remplir() {
      DB.listerEnvois().then(function (l) {
        l = l || [];
        corps.innerHTML = '';
        var attente = l.filter(function (x) { return !x.rejete; }).length;
        var refusees = l.filter(function (x) { return x.rejete; });
        corps.appendChild(el('p', { class: 'petit' }, [attente ? attente + ' saisie' + (attente > 1 ? 's' : '') + ' en attente d’envoi.' : 'Aucune saisie en attente.']));
        var errs = Envoi.erreurs();
        Object.keys(errs).forEach(function (id) {
          var s = site(id);
          corps.appendChild(el('p', { class: 'petit', style: 'color:#e8a33d' }, ['⚠ ' + (s ? s.nom : id) + ' : ' + errs[id].message + ' (' + new Date(errs[id].quand).toLocaleTimeString('fr-FR') + ')']));
        });
        DB.durable().then(function (ok) {
          if (!ok) corps.appendChild(el('p', { class: 'petit', style: 'color:#ff6b6b' }, ['⚠ Ce téléphone ne garde pas les saisies en mémoire (navigation privée ?) : elles seront perdues si l’appli est fermée avant l’envoi.']));
        });
        if (attente) corps.appendChild(el('button', { class: 'btn-second', onclick: function () { toast('Envoi…'); Envoi.forcer().then(remplir); } }, ['Envoyer maintenant']));
        if (!refusees.length) return;
        corps.appendChild(el('p', { class: 'petit', style: 'margin-top:10px;font-weight:700' }, ['Saisies refusées par le serveur (' + refusees.length + ')']));
        refusees.forEach(function (x) {
          var s = site(x.siteId), p = x.payload || {};
          var NOMS = { reponse: 'Ronde', finRonde: 'Fin de ronde', message: 'Message', nh3: 'Suivi NH3', bougies: 'Suivi Bougies', agitation: 'Hauteur agitation', pompes: 'Suivi des pompes' };
          var t = String(p.type || '?');
          var quoi = (NOMS[t] || NOMS[t.split('.')[0]] || t) + (t.indexOf('.') > 0 ? ' (' + t.split('.')[1] + ')' : '') + (p.libelle ? ' · ' + p.libelle : '') + (p.zone ? ' — ' + p.zone : '');
          corps.appendChild(el('div', { class: 'champ', style: 'border-left:3px solid #e8a33d;padding-left:8px;margin:8px 0' }, [
            el('div', { class: 'petit' }, [(s ? s.nom : x.siteId) + ' — ' + new Date(x.cree).toLocaleString('fr-FR')]),
            el('div', {}, [quoi]),
            el('div', { class: 'petit', style: 'color:#e8a33d' }, ['Motif : ' + (x.erreur || 'inconnu')]),
            el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
              el('button', { class: 'btn-second', onclick: function () { Envoi.renvoyer(x).then(remplir); } }, ['Renvoyer']),
              el('button', { class: 'btn-second', onclick: function () {
                if (window.confirm('Supprimer définitivement cette saisie du téléphone ?')) Envoi.abandonner(x).then(remplir);
              } }, ['Supprimer'])
            ])
          ]));
        });
      });
    }
    remplir();
    return bloc;
  }

  /* Bloc « Journal réseau » : ce qui s'est passé avec chaque serveur (heure, outil, durée, résultat) */
  function blocJournal() {
    var LIB = { ok: '✓', reseau: '📵 Pas de réseau', delai: '⏳ Trop lent', occupe: '⏸ Occupé', page: '⚠ Page Google', serveur: '✗ Erreur serveur' };
    var bloc = el('div', { class: 'bandeau' }, [el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Journal réseau']),
      el('p', { class: 'petit' }, ['Les 40 derniers échanges avec les serveurs. En cas de souci, fais une capture de cette liste.'])]);
    var liste = el('div', { class: 'journal' });
    bloc.appendChild(liste);
    function remplir() {
      liste.innerHTML = '';
      var l = Journal.lister();
      if (!l.length) { liste.appendChild(el('p', { class: 'petit' }, ['Rien pour l’instant.'])); return; }
      l.forEach(function (x) {
        var d = new Date(x.t);
        liste.appendChild(el('div', { class: 'journal-ligne' + (x.r === 'ok' ? '' : ' ko') }, [
          el('span', {}, [d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR')]),
          el('span', {}, [(x.s ? x.s + ' · ' : '') + x.a + (x.n ? ' (2e essai)' : '')]),
          el('span', {}, [(x.d / 1000).toFixed(1) + ' s']),
          el('span', {}, [(LIB[x.r] || x.r) + (x.m && x.r !== 'ok' ? ' — ' + x.m : (x.m ? ' · ' + x.m : ''))])]));
      });
    }
    remplir();
    bloc.appendChild(el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
      el('button', { class: 'btn-second', onclick: remplir }, ['Actualiser']),
      el('button', { class: 'btn-second', onclick: function () { Journal.vider(); remplir(); } }, ['Effacer'])]));
    return bloc;
  }

  function ecranReglages(vue) {
    entete('Réglages', 'Connexion aux serveurs Apps Script', '#');
    vue.appendChild(blocEnvois());
    vue.appendChild(blocJournal());
    vue.appendChild(el('p', { class: 'petit' }, [
      'Chaque site a son propre serveur. Colle son adresse (se termine par /exec) et sa clé : tous les outils « version rapide » du site s’en servent.'
    ]));
    CFG.sites.forEach(function (s) {
      var rapides = s.outils.filter(function (o) { return o.type === 'interne'; });
      var url = el('input', { type: 'url', value: apiSite(s.id), placeholder: 'https://script.google.com/macros/s/…/exec' });
      if (s.apiUrl) { url.readOnly = true; url.title = 'Adresse fixée dans l’appli (config.js)'; }
      // clé masquée (••••) : visible seulement en appuyant sur « Afficher »
      var cle = el('input', { type: 'password', value: cleSite(s.id), placeholder: 'Clé du site', autocomplete: 'off' });
      var voirCle = el('button', { class: 'btn-second', type: 'button', style: 'margin-top:6px', onclick: function () {
        var cache = cle.type === 'password';
        cle.type = cache ? 'text' : 'password';
        voirCle.textContent = cache ? 'Masquer' : 'Afficher';
      } }, ['Afficher']);
      var res = el('div', { class: 'petit' });
      var zone = el('div');
      vue.appendChild(el('div', { class: 'bandeau', style: '--n:' + (s.neon || s.couleur) }, [
        el('div', { style: 'font-weight:700' }, [s.nom]),
        el('div', { class: 'petit', style: 'margin-bottom:10px' }, [rapides.length
          ? 'Outils concernés : ' + rapides.map(function (o) { return o.nom; }).join(', ')
          : 'Aucun outil en version rapide pour l’instant']),
        el('div', { class: 'champ' }, [el('label', {}, ['Adresse du serveur du site']), url]),
        el('div', { class: 'champ' }, [el('label', {}, ['Clé du site']), cle, voirCle]),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('button', { class: 'btn-second', onclick: function () {
            var u = url.value.trim(), k = cle.value.trim();
            if (u && !s.apiUrl && !RE_EXEC.test(u)) { res.textContent = '✗ Adresse invalide : elle doit commencer par https://script.google.com/macros/s/ et finir par /exec'; return; }
            if (!u) { Prefs.set('api_site_' + s.id, ''); Prefs.set('cle_site_' + s.id, k); res.textContent = 'Enregistré (vide)'; return; }
            // adresse figée dans l'appli : la clé est enregistrée tout de suite (le test dit ensuite si elle est bonne)
            if (s.apiUrl) Prefs.set('cle_site_' + s.id, k);
            // adresse saisie à la main : on teste AVANT d'enregistrer (une faute de frappe n'écrase plus des réglages qui marchaient)
            res.textContent = 'Test en cours…';
            Api.appeler(u, { action: 'ping', cle: k }, 20000).then(function (j) {
              if (!s.apiUrl) Prefs.set('api_site_' + s.id, u);
              Prefs.set('cle_site_' + s.id, k);
              res.textContent = '✓ Connecté à « ' + (j.nomSite || 'serveur') + ' » — enregistré';
              Envoi.vider();
            })['catch'](function (e) { res.textContent = '✗ ' + e.message + (s.apiUrl ? ' — clé enregistrée, vérifie-la' : ' — rien n’a été modifié'); });
          } }, ['Enregistrer et tester']),
          el('button', { class: 'btn-second', onclick: function () {
            partagerLien(lienConfig([s.id]), 'Portail Métha — ' + s.nom, zone);
          } }, ['Partager la configuration']),
          res
        ]),
        zone
      ]));
    });
    // lien pour tous les sites + collage manuel d'un lien reçu
    var zoneTous = el('div');
    var collage = el('input', { type: 'text', placeholder: 'Colle ici un lien de configuration reçu', autocomplete: 'off' });
    var resCollage = el('div', { class: 'petit' });
    vue.appendChild(el('div', { class: 'bandeau' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Configuration de l’équipe']),
      el('p', { class: 'petit' }, ['Un lien règle d’un coup le téléphone d’un collègue : il l’ouvre, et le portail enregistre tout seul les serveurs et les clés.']),
      el('button', { class: 'btn-second', onclick: function () {
        partagerLien(lienConfig(CFG.sites.map(function (x) { return x.id; })), 'Portail Métha — tous les sites', zoneTous);
      } }, ['Partager la configuration des deux sites']),
      zoneTous,
      el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', {}, ['Lien de configuration reçu']), collage]),
      el('button', { class: 'btn-second', onclick: function () {
        try { var noms = appliquerConfig(collage.value); toast('Configuré : ' + noms.join(', ')); router(); }
        catch (e) { resCollage.textContent = '✗ ' + e.message; }
      } }, ['Appliquer']),
      resCollage
    ]));
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
    // Installation comme une vraie appli (sans le petit logo Chrome sur l'icône)
    var dejaInstallee = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    vue.appendChild(el('div', { class: 'bandeau' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Installer sur ce téléphone']),
      dejaInstallee ? el('p', { class: 'petit' }, ['Le portail est installé comme une appli sur ce téléphone.'])
        : window.__invitInstall ? el('button', { class: 'btn-principal', onclick: function () {
            var inv = window.__invitInstall; window.__invitInstall = null;
            inv.prompt(); inv.userChoice.then(function () { router(); });
          } }, ['Installer l’appli'])
        : el('p', { class: 'petit' }, ['Dans Chrome : menu ⋮ → « Installer l’application » (ou « Ajouter à l’écran d’accueil » puis « Installer », pas « Créer un raccourci »). Sur iPhone : Safari → Partager → « Sur l’écran d’accueil ».'])
    ]));
    // Version réellement installée sur ce téléphone (nom du cache du service worker, ex. « v17 »)
    var ligneVersion = el('p', { class: 'petit' }, ['Version installée : …']);
    if (window.caches) caches.keys().then(function (k) {
      var v = k.filter(function (x) { return x.indexOf('portail-metha-') === 0; }).sort().pop();
      ligneVersion.textContent = 'Version installée : ' + (v ? v.replace('portail-metha-', '') : 'aucune (pas de cache)');
    });
    vue.appendChild(el('div', { class: 'bandeau' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, ['Mise à jour']),
      ligneVersion,
      el('p', { class: 'petit' }, ['Si une nouveauté publiée sur GitHub n’apparaît pas, ce bouton efface la copie gardée sur ce téléphone et recharge tout. Les saisies en attente d’envoi sont conservées.']),
      el('button', { class: 'btn-second', onclick: function () {
        var etapes = [];
        if (navigator.serviceWorker) etapes.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
        if (window.caches) etapes.push(caches.keys().then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x); })); }));
        toast('Mise à jour…');
        Promise.all(etapes)['catch'](function () {}).then(function () { location.reload(); });
      } }, ['Forcer la mise à jour'])
    ]));
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
    numeroEcran++;
    var vue = $('#vue');
    vue.innerHTML = '';
    vue.removeAttribute('style');
    window.scrollTo(0, 0);
    var p = h.split('/');
    if (p[0] === 'config') {
      try {
        var noms = appliquerConfig(h);
        toast('Portail configuré : ' + noms.join(', '), 4500);
      } catch (e) { toast(e.message || 'Lien de configuration invalide.', 4500); }
      history.replaceState(null, '', location.pathname); // la clé ne reste pas dans l'adresse
      p = [''];
    }
    if (p[0] === 'site') ecranSite(vue, p[1]);
    else if (p[0] === 'outil') ecranOutil(vue, p[1], p.slice(2).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } }));
    else if (p[0] === 'reglages') ecranReglages(vue);
    else ecranAccueil(vue);
  }
  window.addEventListener('hashchange', router);
  $('#btnReglages').addEventListener('click', function () { location.hash = 'reglages'; });

  var VERSION_APP = '1.10.0';

  /* ---------- Exposé aux modules ---------- */
  window.PM = { raison: raison, Journal: Journal, apiSite: apiSite, cleSite: cleSite, el: el, $: $, toast: toast, Prefs: Prefs, DB: DB, Api: Api, Envoi: Envoi, uid: uid, icone: icone, nombre: nombre };
  window.MODULES = window.MODULES || {};

  /* ---------- Démarrage ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    appliquerTheme();
    router();
    Envoi.vider();
    DB.durable().then(function (ok) {
      if (!ok) toast('⚠ Stockage indisponible sur ce téléphone : les saisies non envoyées seront perdues à la fermeture.', 6000);
    });
  });
  // Chrome propose l'installation : on garde l'invitation pour le bouton « Installer l'appli » (Réglages)
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__invitInstall = e; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // vérifie s'il y a une nouvelle version à chaque retour sur l'appli
        document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update()['catch'](function () {}); });
      })['catch'](function () {});
      // nouvelle version installée -> on recharge une fois pour l'afficher tout de suite
      var avaitControleur = !!navigator.serviceWorker.controller, recharge = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!avaitControleur || recharge) return;
        recharge = true;
        location.reload();
      });
    });
  }
})();
