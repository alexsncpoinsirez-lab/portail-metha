/* =====================================================================
   MODULE « TÂCHES » — tableau de tâches par équipe (reprise de l'appli
   « Trello Perso » : équipes, colonnes propres à chaque équipe, tâches avec
   exécutants / demandeur / échéance / photos, opérateurs).
   Fonctionne sans réseau : les saisies partent dès que le réseau revient.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  // Couleurs des colonnes : les 4 premières = À faire / En cours / En attente / Terminé
  var PALETTE = ['#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

  /* ---------- outils ---------- */
  function texte(x) { return String(x === null || x === undefined ? '' : x).trim(); }
  function initiales(nom) {
    nom = texte(nom); if (!nom) return '?';
    var p = nom.split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  function teinte(nom) { var s = String(nom || ''), h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function pastille(nom, petite) {
    return el('span', { class: 'tp-pastille' + (petite ? ' petite' : ''), style: 'background:hsl(' + teinte(nom) + ' 42% 40%)', title: nom }, [initiales(nom)]);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  // Serveur ancien ou feuille modifiée à la main : exécutants « a|b » → liste ; date (Date / ISO) → AAAA-MM-JJ
  // (sinon le champ Échéance s'affichait vide et une modification effaçait l'échéance)
  function listeNoms(a) {
    if (Array.isArray(a)) return a.filter(Boolean);
    return String(a === null || a === undefined ? '' : a).split('|').map(function (n) { return n.trim(); }).filter(Boolean);
  }
  function jourIso(x) {
    var t = texte(x);
    if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var d = new Date(t);
    return isNaN(d) ? t : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function aujourdhui() { var n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }
  function estTermine(statut) { return !!statut && (statut.id === 'done' || /termin|effectu|fait$/i.test(statut.label || '')); }
  function echeance(t, statut) {
    if (!t.dueDate) return null;
    var diff = Math.round((new Date(t.dueDate + 'T00:00:00') - new Date(aujourdhui() + 'T00:00:00')) / 86400000);
    var cls = '';
    if (!estTermine(statut)) { if (diff < 0) cls = 'retard'; else if (diff <= 2) cls = 'bientot'; }
    return { texte: fmtDate(t.dueDate), cls: cls, diff: diff };
  }
  function vignette(p, taille) {
    return p.dataUrl ? p.dataUrl : 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(p.driveFileId) + '&sz=w' + taille;
  }
  function redimensionner(fichier, tailleMax, qualite) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var r = Math.min(1, tailleMax / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', qualite || 0.8));
        };
        img.onerror = function () { ko(new Error('Image invalide.')); };
        img.src = e.target.result;
      };
      lecteur.onerror = function () { ko(new Error('Lecture du fichier impossible.')); };
      lecteur.readAsDataURL(fichier);
    });
  }
  function modale(titre, sousTitre, contenu) {
    var fermerBtn = el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×']);
    var fond = el('div', { class: 'ag-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre });
    function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
    function esc(ev) { var t = document.querySelectorAll('.ag-modale'); if (ev.key === 'Escape' && fond === t[t.length - 1]) fermer(); }
    fermerBtn.addEventListener('click', fermer);
    fond.addEventListener('click', function (ev) { if (ev.target === fond) fermer(); });
    document.addEventListener('keydown', esc);
    window.addEventListener('hashchange', fermer);
    fond.appendChild(el('div', { class: 'ag-modale-boite tp-modale' }, [
      el('div', { class: 'ag-modale-tete' }, [el('div', {}, [el('h2', {}, [titre]), sousTitre ? el('div', { class: 'petit' }, [sousTitre]) : null]), fermerBtn])
    ].concat(contenu)));
    document.body.appendChild(fond);
    return fermer;
  }
  /* Bouton « Supprimer » en deux temps (pas de fenêtre système) */
  function boutonDanger(libelle, action, classe) {
    var b = el('button', { type: 'button', class: (classe || 'btn-second') + ' tp-danger' }, [libelle]);
    var arme = false, timer = null;
    b.onclick = function () {
      if (!arme) { arme = true; b.textContent = 'Confirmer ?'; b.classList.add('arme'); timer = setTimeout(function () { arme = false; b.textContent = libelle; b.classList.remove('arme'); }, 4000); return; }
      clearTimeout(timer); action();
    };
    return b;
  }

  /* ---------- données affichées = serveur + saisies en attente ---------- */
  function calculer(T, attente) {
    var sites = (T.sites || []).map(function (s) { return Object.assign({}, s); });
    var statuts = (T.statuts || []).map(function (s) { return Object.assign({}, s); });
    var taches = (T.taches || []).map(function (t) { return Object.assign({}, t, { assignees: listeNoms(t.assignees), dueDate: jourIso(t.dueDate), requestedAt: jourIso(t.requestedAt) }); });
    var operateurs = (T.operateurs || []).map(function (o) { return Object.assign({}, o); });
    var photos = (T.photos || []).map(function (p) { return Object.assign({}, p); });
    function site(id) { return sites.filter(function (s) { return s.id === id; })[0]; }
    (attente || []).forEach(function (a) {
      var t, s, o, i;
      if (a.type === 'taches.creer') { if (!taches.some(function (x) { return x.id === a.tache.id; })) taches.push(Object.assign({}, a.tache, { enAttente: true })); }
      else if (a.type === 'taches.modifier') { t = taches.filter(function (x) { return x.id === a.tacheId; })[0]; if (t) { Object.assign(t, a.patch); t.enAttente = true; } }
      else if (a.type === 'taches.supprimer') { taches = taches.filter(function (x) { return x.id !== a.tacheId; }); photos = photos.filter(function (p) { return p.taskId !== a.tacheId; }); }
      else if (a.type === 'statut.creer') { if (!statuts.some(function (x) { return x.id === a.statutId && x.siteId === a.siteId; })) statuts.push({ id: a.statutId, siteId: a.siteId, label: a.libelle, enAttente: true }); }
      else if (a.type === 'statut.renommer') { s = statuts.filter(function (x) { return x.id === a.statutId && x.siteId === a.siteId; })[0]; if (s) s.label = a.libelle; }
      else if (a.type === 'statut.supprimer') { statuts = statuts.filter(function (x) { return !(x.id === a.statutId && x.siteId === a.siteId); }); }
      else if (a.type === 'statut.reordonner') {
        var autres = statuts.filter(function (x) { return x.siteId !== a.siteId; });
        var ceux = statuts.filter(function (x) { return x.siteId === a.siteId; });
        ceux.sort(function (x, y) { i = a.ids.indexOf(x.id); var j = a.ids.indexOf(y.id); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
        statuts = autres.concat(ceux);
      }
      else if (a.type === 'operateur.creer') { if (!operateurs.some(function (x) { return x.id === a.operateurId; })) operateurs.push({ id: a.operateurId, name: a.nom }); }
      else if (a.type === 'operateur.renommer') { o = operateurs.filter(function (x) { return x.id === a.operateurId; })[0]; if (o) o.name = a.nom; }
      else if (a.type === 'operateur.supprimer') { operateurs = operateurs.filter(function (x) { return x.id !== a.operateurId; }); }
      else if (a.type === 'site.creer') {
        if (!site(a.siteId)) {
          sites.push({ id: a.siteId, name: a.nom, createdAt: a.date, enAttente: true });
          [['todo', 'À faire'], ['progress', 'En cours'], ['waiting', 'En attente'], ['done', 'Terminé']].forEach(function (d) { statuts.push({ id: d[0], siteId: a.siteId, label: d[1] }); });
        }
      }
      else if (a.type === 'site.renommer') { s = site(a.siteId); if (s) s.name = a.nom; }
      else if (a.type === 'photo.ajouter') { if (!photos.some(function (p) { return p.id === a.photoId; })) photos.push({ id: a.photoId, taskId: a.tacheId, driveFileId: '', dataUrl: a.apercu || '', fileName: a.nomFichier, addedAt: a.date, enAttente: true }); }
      else if (a.type === 'photo.supprimer') { photos = photos.filter(function (p) { return p.id !== a.photoId; }); }
    });
    operateurs.sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    sites.sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
    return { sites: sites, statuts: statuts, taches: taches, operateurs: operateurs, photos: photos };
  }

  /* ---------- démonstration (serveur pas encore réglé) ---------- */
  function demo() {
    var s1 = 'd1', s2 = 'd2';
    function st(id, site, label) { return { id: id, siteId: site, label: label }; }
    return {
      sites: [{ id: s1, name: 'Arraincourt Biogaz', createdAt: '2026-09-07' }, { id: s2, name: 'Metha Rotte', createdAt: '2026-09-08' }],
      statuts: [st('todo', s1, 'A faire Arraincourt Biogaz'), st('cmd', s1, 'A commander'), st('progress', s1, 'En cours'), st('done', s1, 'Tâches effectuées'),
        st('todo', s2, 'À faire'), st('progress', s2, 'En cours'), st('done', s2, 'Terminé')],
      operateurs: [{ id: 'o1', name: 'Alexandre Maot' }, { id: 'o2', name: 'Pierrick Noel' }, { id: 'o3', name: 'Antonin Persello' }, { id: 'o4', name: 'Pascal Spitz' }],
      taches: [
        { id: 't1', siteId: s1, siteName: 'Arraincourt Biogaz', title: 'Nettoyage échangeur skid', description: 'Démonter et nettoyer les plaques de l’échangeur skid', status: 'todo', assignees: ['Alexandre Maot', 'Antonin Persello'], requester: 'Alexandre Maot', requestedAt: '2026-09-09', dueDate: '2026-09-30' },
        { id: 't2', siteId: s1, siteName: 'Arraincourt Biogaz', title: 'Bouton poussoir pour coupler le me2me', description: '', status: 'todo', assignees: ['Pascal Spitz'], requester: '', requestedAt: '2026-09-09', dueDate: '2026-11-09' },
        { id: 't3', siteId: s1, siteName: 'Arraincourt Biogaz', title: 'Pièces Abac', description: '', status: 'cmd', assignees: ['Alexandre Maot'], requester: 'Pierrick Noel', requestedAt: '2026-09-09', dueDate: '' },
        { id: 't4', siteId: s1, siteName: 'Arraincourt Biogaz', title: 'Commande cible pour pousseur', description: '', status: 'done', assignees: ['Antonin Persello'], requester: '', requestedAt: '2026-09-09', dueDate: '' },
        { id: 't5', siteId: s2, siteName: 'Metha Rotte', title: 'Remise en état des pousseurs', description: '', status: 'todo', assignees: ['Pierrick Noel'], requester: 'Alexandre Maot', requestedAt: '2026-09-07', dueDate: '2026-09-25' }
      ],
      photos: []
    };
  }

  /* ===================================================================
     Écran du module
     =================================================================== */
  window.MODULES.taches = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var S = ctx.site.id;
      var K = { tout: 'tp_tout_' + S, attente: 'tp_attente_' + S };
      var T = null, attente = [], D = null;
      var equipe = PM.Prefs.get('tp_equipe', ''), filtre = PM.Prefs.get('tp_filtre', ''); // filtre : '' | nom d'opérateur
      var instance = PM.uid();
      window.__tpInstance = instance;
      function actif() { return window.__tpInstance === instance && location.hash.indexOf('outil/' + ctx.outil.id) >= 0; }
      function api(action, extra, delai) {
        if (modeDemo) return Promise.reject(new Error('Mode démonstration : renseigne le serveur dans Réglages.'));
        return PM.Api.appeler(ctx.apiUrl, Object.assign({ action: action, cle: ctx.cle }, extra || {}), delai || 60000);
      }
      function recalculer() { D = calculer(T, attente); }

      /* ---------- démarrage ---------- */
      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(K.tout), PM.DB.get(K.attente)]).then(function (r) {
        T = r[0] || (modeDemo ? demo() : null);
        attente = r[1] || [];
        if (T) { recalculer(); afficher(); }
        if (!modeDemo) charger(!T);
      });
      var dernierChargement = 0;
      function charger(premier) {
        dernierChargement = Date.now();
        return api('taches.tout', {}, 90000).then(function (j) {
          delete j.ok; T = j; PM.DB.set(K.tout, j);
          return nettoyerAttente().then(function () { recalculer(); if (actif() && !document.querySelector('.ag-modale')) afficher(); });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger les tâches.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'),
              el('span', { class: 'petit' }, [conseil(e)]), el('br'), el('br'),
              el('button', { class: 'btn-second', type: 'button', onclick: function () { vue.innerHTML = ''; vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])); charger(true); } }, ['Réessayer']), ' ',
              el('button', { class: 'btn-second', type: 'button', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : tâches du dernier chargement affichées. ' + conseil(e), 6000);
        });
      }
      // Que faire après un échec de chargement (« Connexion coupée » = souvent le déploiement du serveur Tâches)
      function conseil(e) {
        var t = e && e.type, m = (e && e.message) || '';
        if (/cl[ée] du site/i.test(m)) return 'Vérifie l’adresse /exec et la clé de la carte Tâches dans Réglages (clé affichée par initialiserApi).';
        if (t === 'reseau') return navigator.onLine === false ? 'Pas de réseau : réessaie quand le téléphone capte.'
          : 'Si le réseau marche ailleurs : le serveur Tâches n’est sans doute pas déployé en « Exécuter en tant que : Moi » + « Accès : Tout le monde », ou la nouvelle version n’a pas été créée (voir LISEZ-MOI de l’appli Trello perso).';
        if (t === 'delai' || t === 'occupe') return 'Le serveur est lent ou occupé : réessaie dans une minute.';
        if (t === 'page') return 'Le serveur Tâches renvoie une page Google : dans l’éditeur Apps Script, lance initialiserApi (accepte l’autorisation) puis vérifie le déploiement (Accès : Tout le monde).';
        return 'Réessaie dans une minute. Si ça continue, vérifie l’appli Trello perso (éditeur Apps Script → Exécutions).';
      }
      function nettoyerAttente() {
        return Promise.all([PM.DB.listerEnvois(), PM.DB.get(K.attente)]).then(function (r) {
          var ids = (r[0] || []).filter(function (x) { return !x.rejete; }).map(function (x) { return x.payload.id; });
          attente = (r[1] || []).filter(function (a) { return ids.indexOf(a.id) >= 0; });
          return PM.DB.set(K.attente, attente);
        });
      }
      // toutes les saisies parties → on recharge (au plus une fois par minute)
      var rechargePrevue = null;
      function rechargerPlusTard() {
        if (!actif() || modeDemo) return;
        var reste = 60000 - (Date.now() - dernierChargement);
        if (reste <= 0) { charger(false); return; }
        if (!rechargePrevue) rechargePrevue = setTimeout(function () { rechargePrevue = null; rechargerPlusTard(); }, reste);
      }
      PM.Envoi.surChangement(function (n) { if (actif() && !n && attente.length && !modeDemo) rechargerPlusTard(); });
      // retour sur l'appli après plus de 5 min : tâches rafraîchies
      var cacheDepuis = 0;
      window.__tpVisibilite && document.removeEventListener('visibilitychange', window.__tpVisibilite);
      window.__tpVisibilite = function () {
        if (document.hidden) { cacheDepuis = Date.now(); return; }
        if (actif() && !modeDemo && cacheDepuis && Date.now() - cacheDepuis > 5 * 60000) { cacheDepuis = 0; rechargerPlusTard(); }
      };
      document.addEventListener('visibilitychange', window.__tpVisibilite);

      /* ---------- saisie : file d'attente + affichage immédiat ---------- */
      function saisir(payload, avecPhoto) {
        payload.id = PM.uid();
        payload.agent = PM.Prefs.get('agent', '');
        payload.date = new Date().toISOString();
        attente.push(payload);
        if (modeDemo) { T = calculer(T, attente); T.photos.forEach(function (p) { delete p.enAttente; }); attente = []; }
        else {
          PM.DB.set(K.attente, attente);
          var envoi = Object.assign({}, payload); delete envoi.apercu; // l'aperçu reste sur le téléphone, seule la photo part
          PM.Envoi.ajouter(S, envoi, avecPhoto);
        }
        recalculer();
        afficher();
      }

      /* ---------- accès aux données ---------- */
      function equipeCourante() {
        var s = D.sites.filter(function (x) { return x.id === equipe; })[0] || D.sites[0];
        if (s && s.id !== equipe) { equipe = s.id; PM.Prefs.set('tp_equipe', equipe); }
        return s;
      }
      function colonnes(siteId) { return D.statuts.filter(function (s) { return s.siteId === siteId; }); }
      function couleur(siteId, statutId) { var i = colonnes(siteId).map(function (s) { return s.id; }).indexOf(statutId); return PALETTE[(i < 0 ? 7 : i) % PALETTE.length]; }
      function statut(siteId, id) { return colonnes(siteId).filter(function (s) { return s.id === id; })[0]; }
      function tachesDe(siteId) { return D.taches.filter(function (t) { return t.siteId === siteId; }); }
      function photosDe(tacheId) { return D.photos.filter(function (p) { return p.taskId === tacheId; }).sort(function (a, b) { return (a.addedAt || '').localeCompare(b.addedAt || ''); }); }
      function nomsOperateurs(plus) {
        var l = D.operateurs.map(function (o) { return o.name; });
        (plus || []).forEach(function (n) { if (n && l.indexOf(n) < 0) l.push(n); });
        return l;
      }

      /* ================= écran ================= */
      var defilX = 0;
      function afficher() {
        if (!actif() || !D) return;
        var ancien = vue.querySelector('.tp-board');
        if (ancien) defilX = ancien.scrollLeft;
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'tp' });
        vue.appendChild(racine);
        if (modeDemo) racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
          el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Données d’exemple, rien n’est envoyé. Une fois le serveur Trello perso déployé (Portail.gs), renseigne son adresse /exec et la clé dans ']), el('a', { href: '#reglages' }, ['Réglages']), '.']));
        var site = equipeCourante();
        if (!site) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucune équipe pour l’instant.', el('br'), el('br'), el('button', { class: 'btn-principal', type: 'button', onclick: nouvelleEquipe }, ['+ Créer une équipe'])])); return; }
        racine.appendChild(barreEquipes(site));
        racine.appendChild(barreOutils(site));
        tableau(racine, site);
        window.scrollTo(0, y);
      }

      function barreEquipes(site) {
        var b = el('div', { class: 'st-outils tp-equipes', role: 'tablist' });
        D.sites.forEach(function (s) {
          var n = tachesDe(s.id).filter(function (t) { return !estTermine(statut(s.id, t.status)); }).length;
          b.appendChild(el('button', { type: 'button', role: 'tab', class: 'st-outil' + (s.id === site.id ? ' actif' : ''), 'aria-selected': String(s.id === site.id),
            onclick: function () { equipe = s.id; PM.Prefs.set('tp_equipe', equipe); defilX = 0; afficher(); } }, [s.name + (n ? ' (' + n + ')' : '')]));
        });
        b.appendChild(el('button', { type: 'button', class: 'st-outil tp-plus', title: 'Nouvelle équipe', onclick: nouvelleEquipe }, ['+']));
        return b;
      }

      function barreOutils(site) {
        var sel = el('select', { class: 'st-select tp-filtre', 'aria-label': 'Filtrer par opérateur' }, [el('option', { value: '' }, ['Tous les opérateurs'])]
          .concat(nomsOperateurs(filtre ? [filtre] : []).map(function (n) { return el('option', { value: n, selected: n === filtre ? 'selected' : null }, [n]); })));
        sel.addEventListener('change', function () { filtre = sel.value; PM.Prefs.set('tp_filtre', filtre); afficher(); });
        var moi = PM.Prefs.get('tp_moi', '');
        var chipMoi = el('button', { type: 'button', class: 'st-chip' + (moi && filtre === moi ? ' actif' : ''), onclick: function () {
          if (!moi) { choisirMoi(); return; }
          filtre = filtre === moi ? '' : moi; PM.Prefs.set('tp_filtre', filtre); afficher();
        } }, ['⭐ Mes tâches']);
        return el('div', { class: 'st-actions tp-barre' }, [
          chipMoi, sel,
          el('button', { type: 'button', class: 'btn-principal st-mini', onclick: function () { ouvrirTache(null, { siteId: site.id, status: (colonnes(site.id)[0] || {}).id }); } }, ['+ Tâche']),
          el('button', { type: 'button', class: 'btn-second st-mini tp-menu', title: 'Colonnes, opérateurs, équipe', 'aria-label': 'Plus', onclick: function () { menu(site); } }, ['⋯'])
        ]);
      }

      function choisirMoi() {
        var sel = el('select', { class: 'st-select' }, [el('option', { value: '' }, ['— Choisir —'])].concat(nomsOperateurs().map(function (n) { return el('option', { value: n }, [n]); })));
        var agent = texte(PM.Prefs.get('agent', '')).toLowerCase();
        if (agent) nomsOperateurs().forEach(function (n) { if (n.toLowerCase().indexOf(agent) === 0) sel.value = n; });
        var fermer = modale('Qui es-tu ?', 'Pour afficher tes tâches d’un seul geste (réglé une fois sur ce téléphone).', [
          el('div', { class: 'champ' }, [el('label', {}, ['Mon nom dans la liste des opérateurs']), sel]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            if (!sel.value) { sel.focus(); return; }
            PM.Prefs.set('tp_moi', sel.value); filtre = sel.value; PM.Prefs.set('tp_filtre', filtre); fermer(); afficher();
          } }, ['Continuer'])]);
      }

      /* ---------- tableau : colonnes côte à côte, une par écran sur téléphone ---------- */
      function tableau(racine, site) {
        var cols = colonnes(site.id);
        var toutes = tachesDe(site.id);
        var visibles = filtre ? toutes.filter(function (t) { return (t.assignees || []).indexOf(filtre) >= 0; }) : toutes;
        racine.appendChild(el('p', { class: 'petit tp-sous' }, [toutes.length + ' tâche' + (toutes.length > 1 ? 's' : '') + (filtre ? ' · ' + visibles.length + ' pour ' + filtre : '')]));
        if (!cols.length) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucune colonne : ajoute-en une avec ⋯ → Colonnes.'])); return; }
        // onglets des colonnes (le tableau défile jusqu'à la colonne touchée)
        var onglets = el('div', { class: 'tp-onglets', role: 'tablist' });
        var board = el('div', { class: 'tp-board' });
        var boutonsOnglet = [];
        cols.forEach(function (s, i) {
          var c = couleur(site.id, s.id);
          var liste = visibles.filter(function (t) { return t.status === s.id; });
          var b = el('button', { type: 'button', role: 'tab', class: 'tp-onglet', style: '--cc:' + c, onclick: function () {
            var col = board.children[i]; if (col) board.scrollTo({ left: col.offsetLeft - 8, behavior: 'smooth' });
          } }, [el('span', { class: 'tp-point' }), s.label, el('span', { class: 'tp-nb' }, [String(liste.length)])]);
          boutonsOnglet.push(b); onglets.appendChild(b);
          var corps = el('div', { class: 'tp-col-corps' });
          if (!liste.length) corps.appendChild(el('div', { class: 'tp-col-vide' }, [filtre ? 'Rien pour ' + filtre : 'Aucune tâche']));
          liste.forEach(function (t) { corps.appendChild(carte(t, site, s)); });
          board.appendChild(el('section', { class: 'tp-col', style: '--cc:' + c, 'data-statut': s.id }, [
            el('div', { class: 'tp-col-tete' }, [el('span', { class: 'tp-barre-couleur' }), el('h3', {}, [s.label]), el('span', { class: 'tp-nb' }, [String(liste.length)])]),
            corps,
            el('button', { type: 'button', class: 'tp-col-ajout', onclick: function () { ouvrirTache(null, { siteId: site.id, status: s.id }); } }, ['+ Ajouter'])
          ]));
        });
        racine.appendChild(onglets); racine.appendChild(board);
        function majOnglet() {
          var x = board.scrollLeft + board.clientWidth / 2, idx = 0;
          Array.prototype.forEach.call(board.children, function (col, i) { if (col.offsetLeft <= x) idx = i; });
          boutonsOnglet.forEach(function (b, i) { b.classList.toggle('actif', i === idx); });
          var b = boutonsOnglet[idx];
          if (b && b.scrollIntoView) { try { b.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
        }
        var tick = false;
        board.addEventListener('scroll', function () { if (tick) return; tick = true; requestAnimationFrame(function () { tick = false; majOnglet(); }); });
        board.scrollLeft = defilX;
        setTimeout(majOnglet, 0);
      }

      function carte(t, site, s) {
        var e = echeance(t, s), nb = photosDe(t.id).length;
        return el('button', { type: 'button', class: 'tp-carte' + (t.enAttente ? ' attente' : ''), onclick: function () { ouvrirTache(t); } }, [
          el('div', { class: 'tp-titre' }, [t.title + (t.enAttente ? ' ⏳' : '')]),
          t.description ? el('div', { class: 'tp-desc' }, [t.description]) : null,
          el('div', { class: 'tp-pied' }, [
            e ? el('span', { class: 'tp-due ' + e.cls }, [(e.cls === 'retard' ? '⚠ ' : '') + e.texte]) : null,
            nb ? el('span', { class: 'tp-badge' }, ['📷 ' + nb]) : null,
            t.requester ? el('span', { class: 'tp-badge', title: 'Demandé par ' + t.requester }, ['← ' + initiales(t.requester)]) : null,
            el('span', { class: 'tp-espace' }),
            el('span', { class: 'tp-pastilles' }, (t.assignees || []).length ? (t.assignees || []).slice(0, 3).map(function (n) { return pastille(n, true); })
              .concat((t.assignees || []).length > 3 ? [el('span', { class: 'tp-pastille petite plus' }, ['+' + ((t.assignees || []).length - 3)])] : []) : [el('span', { class: 'tp-pastille petite vide', title: 'Aucun exécutant' }, ['?'])])
          ])
        ]);
      }

      /* ================= fiche tâche (création / modification) ================= */
      function ouvrirTache(t0, defauts) {
        var nouvelle = !t0;
        var siteId = nouvelle ? defauts.siteId : t0.siteId;
        var site = D.sites.filter(function (x) { return x.id === siteId; })[0] || {};
        var cols = colonnes(siteId);
        var v = nouvelle ? { title: '', description: '', status: defauts.status || (cols[0] || {}).id, assignees: [], requester: '', dueDate: '', requestedAt: aujourdhui() } : t0;
        var titre = el('input', { type: 'text', value: v.title, placeholder: 'Ex. Contrôler la pression du digesteur', autocomplete: 'off' });
        var desc = el('textarea', { rows: '3', placeholder: 'Détails, contexte, consignes…' }); desc.value = v.description || '';
        var statutChoisi = v.status;
        var choixStatut = el('div', { class: 'tp-choix' });
        function dessinerStatuts() {
          choixStatut.innerHTML = '';
          cols.forEach(function (s) {
            var c = couleur(siteId, s.id);
            choixStatut.appendChild(el('button', { type: 'button', class: 'st-chip' + (s.id === statutChoisi ? ' actif' : ''), style: s.id === statutChoisi ? 'border-color:' + c + ';color:' + c : '',
              onclick: function () { statutChoisi = s.id; dessinerStatuts(); } }, [s.label]));
          });
        }
        dessinerStatuts();
        var assignes = (v.assignees || []).slice();
        var choixExec = el('div', { class: 'tp-choix' });
        function dessinerExec() {
          choixExec.innerHTML = '';
          var noms = nomsOperateurs(assignes);
          if (!noms.length) choixExec.appendChild(el('p', { class: 'petit' }, ['Aucun opérateur : ajoute-les avec ⋯ → Opérateurs.']));
          noms.forEach(function (n) {
            var sel = assignes.indexOf(n) >= 0;
            choixExec.appendChild(el('button', { type: 'button', class: 'st-chip tp-exec' + (sel ? ' actif' : ''), onclick: function () {
              if (sel) assignes = assignes.filter(function (x) { return x !== n; }); else assignes.push(n);
              dessinerExec();
            } }, [pastille(n, true), n]));
          });
        }
        dessinerExec();
        var demandeur = el('select', { class: 'st-select' }, [el('option', { value: '' }, ['— Choisir —'])].concat(nomsOperateurs(v.requester ? [v.requester] : []).map(function (n) { return el('option', { value: n, selected: n === v.requester ? 'selected' : null }, [n]); })));
        var due = el('input', { type: 'date', value: v.dueDate || '' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var zonePhotos = el('div');
        function dessinerPhotos() {
          zonePhotos.innerHTML = '';
          if (nouvelle) { zonePhotos.appendChild(el('p', { class: 'petit' }, ['Enregistre la tâche pour pouvoir y ajouter des photos.'])); return; }
          var liste = photosDe(t0.id);
          var grille = el('div', { class: 'tp-photos' });
          liste.forEach(function (p, i) {
            grille.appendChild(el('div', { class: 'tp-photo' + (p.enAttente ? ' attente' : '') }, [
              el('img', { src: vignette(p, 300), alt: p.fileName || 'Photo', loading: 'lazy', onclick: function () { pleinEcran(liste, i); } }),
              boutonDanger('🗑', function () { saisir({ type: 'photo.supprimer', photoId: p.id }); dessinerPhotos(); }, 'tp-photo-suppr')
            ]));
          });
          grille.appendChild(el('button', { type: 'button', class: 'tp-photo-ajout', onclick: function () { choisirPhoto(t0, dessinerPhotos); } }, ['📷', el('span', {}, ['Ajouter'])]));
          zonePhotos.appendChild(grille);
        }
        dessinerPhotos();
        var fermer = modale(nouvelle ? 'Nouvelle tâche' : 'Modifier la tâche', site.name, [
          el('div', { class: 'champ' }, [el('label', {}, ['Titre']), titre]),
          el('div', { class: 'champ' }, [el('label', {}, ['Description (optionnel)']), desc]),
          el('div', { class: 'champ' }, [el('label', {}, ['Colonne']), choixStatut]),
          el('div', { class: 'champ' }, [el('label', {}, ['Exécutant(s)']), choixExec]),
          el('div', { class: 'nh3-2col' }, [
            el('div', { class: 'champ' }, [el('label', {}, ['Demandeur']), demandeur]),
            el('div', { class: 'champ' }, [el('label', {}, ['Date de la demande']), el('div', { class: 'tp-lecture' }, [fmtDate(v.requestedAt)])])]),
          el('div', { class: 'champ' }, [el('label', {}, ['Échéance (optionnel)']), due]),
          el('div', { class: 'champ' }, [el('label', {}, ['Photos']), zonePhotos]),
          msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var ti = titre.value.trim();
            if (!ti) { msg.textContent = 'Indique un titre.'; msg.hidden = false; titre.focus(); return; }
            var patch = { title: ti, description: desc.value.trim(), status: statutChoisi, assignees: assignes, requester: demandeur.value, dueDate: due.value };
            fermer();
            if (nouvelle) {
              saisir({ type: 'taches.creer', tache: Object.assign({ id: PM.uid(), siteId: siteId, siteName: site.name || '', requestedAt: aujourdhui() }, patch) });
              PM.toast('Tâche créée' + (modeDemo ? ' (démo)' : navigator.onLine ? '' : ' · envoi au retour du réseau'));
            } else {
              var diff = {};
              Object.keys(patch).forEach(function (k) { if (JSON.stringify(patch[k]) !== JSON.stringify(k === 'assignees' ? (t0.assignees || []) : (t0[k] || ''))) diff[k] = patch[k]; });
              if (!Object.keys(diff).length) return;
              saisir({ type: 'taches.modifier', tacheId: t0.id, patch: diff });
              PM.toast('Tâche modifiée');
            }
          } }, [nouvelle ? 'Créer la tâche' : 'Enregistrer']),
          nouvelle ? null : el('div', { class: 'nh3-actions-edition' }, [
            el('button', { type: 'button', class: 'btn-second', onclick: fermer }, ['Annuler']),
            boutonDanger('Supprimer la tâche', function () { fermer(); saisir({ type: 'taches.supprimer', tacheId: t0.id }); PM.toast('Tâche supprimée'); })
          ])
        ]);
        if (nouvelle) setTimeout(function () { titre.focus(); }, 30);
      }

      function choisirPhoto(t, apres) {
        var f = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
        document.body.appendChild(f);
        f.addEventListener('change', function () {
          var fichier = f.files[0]; f.remove();
          if (!fichier) return;
          var p = redimensionner(fichier, 1600, 0.82);
          (PM.attente ? PM.attente(p, 'Préparation de la photo…') : p).then(function (data) {
            saisir({ type: 'photo.ajouter', photoId: PM.uid(), tacheId: t.id, photo: data.split(',')[1] || '', apercu: data, nomFichier: (fichier.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_') }, true);
            PM.toast('Photo enregistrée' + (navigator.onLine ? '' : ' · envoi au retour du réseau'));
            if (apres) apres();
          })['catch'](function () { PM.toast('Impossible de lire cette photo.'); });
        });
        f.click();
      }
      function pleinEcran(liste, i) {
        var img = el('img', { src: vignette(liste[i], 1600), alt: 'Photo' });
        var fond = el('div', { class: 'tp-plein', onclick: function () { fond.remove(); } }, [img, el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×'])]);
        document.body.appendChild(fond);
      }

      /* ================= menu ⋯ : colonnes, opérateurs, équipe ================= */
      function menu(site) {
        var fermer = modale(site.name, 'Réglages de l’équipe', [
          el('button', { type: 'button', class: 'btn-second st-large', onclick: function () { fermer(); gererColonnes(site); } }, ['▦ Colonnes du tableau']),
          el('button', { type: 'button', class: 'btn-second st-large', style: 'margin-top:8px', onclick: function () { fermer(); gererOperateurs(); } }, ['👥 Opérateurs']),
          el('button', { type: 'button', class: 'btn-second st-large', style: 'margin-top:8px', onclick: function () { fermer(); renommerEquipe(site); } }, ['✎ Renommer l’équipe']),
          el('button', { type: 'button', class: 'btn-second st-large', style: 'margin-top:8px', onclick: function () { fermer(); PM.Prefs.set('tp_moi', ''); choisirMoi(); } }, ['⭐ Changer « Mes tâches »']),
          modeDemo ? null : el('button', { type: 'button', class: 'btn-second st-large', style: 'margin-top:8px', onclick: function () { fermer(); PM.toast('Rechargement…'); charger(false); } }, ['⟳ Recharger depuis le serveur'])
        ]);
      }

      function gererColonnes(site) {
        var corps = el('div');
        var nouveau = el('input', { type: 'text', placeholder: 'Nom de la nouvelle colonne', autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function dessiner() {
          corps.innerHTML = '';
          var cols = colonnes(site.id);
          cols.forEach(function (s, i) {
            var nb = tachesDe(site.id).filter(function (t) { return t.status === s.id; }).length;
            var ligne = el('div', { class: 'tp-col-ligne', style: '--cc:' + couleur(site.id, s.id) }, [
              el('span', { class: 'tp-barre-couleur' }),
              el('span', { class: 'tp-col-nom' }, [s.label, el('span', { class: 'petit' }, [' · ' + nb])]),
              el('button', { type: 'button', class: 'pp-icone', title: 'Monter', disabled: i === 0 ? 'disabled' : null, onclick: function () { deplacer(i, -1); } }, ['▲']),
              el('button', { type: 'button', class: 'pp-icone', title: 'Descendre', disabled: i === cols.length - 1 ? 'disabled' : null, onclick: function () { deplacer(i, 1); } }, ['▼']),
              el('button', { type: 'button', class: 'pp-icone', title: 'Renommer', onclick: function () { renommer(s); } }, ['✎']),
              nb ? el('span', { class: 'pp-icone', title: 'Déplace d’abord ses tâches', style: 'opacity:.35' }, ['🗑'])
                : boutonDanger('🗑', function () {
                  if (cols.length <= 1) { msg.textContent = 'Impossible de supprimer la dernière colonne.'; msg.hidden = false; return; }
                  saisir({ type: 'statut.supprimer', siteId: site.id, statutId: s.id }); dessiner();
                }, 'pp-icone')
            ]);
            corps.appendChild(ligne);
          });
        }
        function deplacer(i, dir) {
          var ids = colonnes(site.id).map(function (s) { return s.id; });
          var j = i + dir; if (j < 0 || j >= ids.length) return;
          var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
          saisir({ type: 'statut.reordonner', siteId: site.id, ids: ids }); dessiner();
        }
        function renommer(s) {
          var inp = el('input', { type: 'text', value: s.label, autocomplete: 'off' });
          var f2 = modale('Renommer la colonne', s.label, [el('div', { class: 'champ' }, [inp]),
            el('button', { class: 'btn-principal', type: 'button', onclick: function () {
              var v = inp.value.trim(); if (!v) { inp.focus(); return; }
              f2(); if (v !== s.label) { saisir({ type: 'statut.renommer', siteId: site.id, statutId: s.id, libelle: v }); dessiner(); }
            } }, ['Enregistrer'])]);
          setTimeout(function () { inp.focus(); inp.select(); }, 30);
        }
        dessiner();
        modale('Colonnes — ' + site.name, 'L’ordre ici est celui du tableau. Les 4 premières couleurs sont fixes.', [corps, msg,
          el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', {}, ['Ajouter une colonne']), nouveau]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = nouveau.value.trim(); if (!v) { nouveau.focus(); return; }
            if (colonnes(site.id).some(function (s) { return s.label.toLowerCase() === v.toLowerCase(); })) { msg.textContent = 'Une colonne porte déjà ce nom.'; msg.hidden = false; return; }
            msg.hidden = true; nouveau.value = '';
            saisir({ type: 'statut.creer', siteId: site.id, statutId: PM.uid(), libelle: v }); dessiner();
          } }, ['+ Ajouter'])]);
      }

      function gererOperateurs() {
        var corps = el('div');
        var nouveau = el('input', { type: 'text', placeholder: 'Prénom Nom', autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function dessiner() {
          corps.innerHTML = '';
          if (!D.operateurs.length) corps.appendChild(el('p', { class: 'petit' }, ['Aucun opérateur pour l’instant.']));
          D.operateurs.forEach(function (o) {
            corps.appendChild(el('div', { class: 'tp-col-ligne' }, [pastille(o.name, true), el('span', { class: 'tp-col-nom' }, [o.name]),
              el('button', { type: 'button', class: 'pp-icone', title: 'Renommer', onclick: function () { renommer(o); } }, ['✎']),
              boutonDanger('🗑', function () { saisir({ type: 'operateur.supprimer', operateurId: o.id }); dessiner(); }, 'pp-icone')]));
          });
        }
        function renommer(o) {
          var inp = el('input', { type: 'text', value: o.name, autocomplete: 'off' });
          var f2 = modale('Renommer l’opérateur', 'Les tâches déjà enregistrées gardent l’ancien nom.', [el('div', { class: 'champ' }, [inp]),
            el('button', { class: 'btn-principal', type: 'button', onclick: function () {
              var v = inp.value.trim(); if (!v) { inp.focus(); return; }
              f2(); if (v !== o.name) { saisir({ type: 'operateur.renommer', operateurId: o.id, nom: v }); dessiner(); }
            } }, ['Enregistrer'])]);
          setTimeout(function () { inp.focus(); inp.select(); }, 30);
        }
        dessiner();
        modale('Opérateurs', 'Proposés comme exécutants et demandeurs, pour toutes les équipes.', [corps, msg,
          el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', {}, ['Ajouter un opérateur']), nouveau]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = nouveau.value.trim(); if (!v) { nouveau.focus(); return; }
            if (D.operateurs.some(function (o) { return o.name.toLowerCase() === v.toLowerCase(); })) { msg.textContent = 'Cet opérateur existe déjà.'; msg.hidden = false; return; }
            msg.hidden = true; nouveau.value = '';
            saisir({ type: 'operateur.creer', operateurId: PM.uid(), nom: v }); dessiner();
          } }, ['+ Ajouter'])]);
      }

      function nouvelleEquipe() {
        var inp = el('input', { type: 'text', placeholder: 'Ex. Epandage', autocomplete: 'off' });
        var fermer = modale('Nouvelle équipe', 'Elle démarre avec 4 colonnes : À faire, En cours, En attente, Terminé.', [el('div', { class: 'champ' }, [el('label', {}, ['Nom']), inp]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim(); if (!v) { inp.focus(); return; }
            var id = PM.uid(); fermer();
            saisir({ type: 'site.creer', siteId: id, nom: v });
            equipe = id; PM.Prefs.set('tp_equipe', id); afficher();
          } }, ['Créer'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }
      function renommerEquipe(site) {
        var inp = el('input', { type: 'text', value: site.name, autocomplete: 'off' });
        var fermer = modale('Renommer l’équipe', site.name, [el('div', { class: 'champ' }, [inp]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim(); if (!v) { inp.focus(); return; }
            fermer(); if (v !== site.name) saisir({ type: 'site.renommer', siteId: site.id, nom: v });
          } }, ['Enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }
    }
  };
})();
