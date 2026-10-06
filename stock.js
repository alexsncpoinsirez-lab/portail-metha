/* =====================================================================
   MODULE « STOCK PIÈCES DÉTACHÉES » — version rapide
   Reprend l'appli d'origine (classeur « Appli Stock Metha ») et ajoute :
   - tout le stock du site chargé d'un coup (navigation et recherche
     instantanées, consultable hors ligne) ;
   - scan d'un QR -> fenêtre « Retirer 1 » directe ;
   - motif de chaque mouvement (Intervention, Réception commande…) ;
   - vue par casier et mode inventaire (quantité comptée) ;
   - commandes : À commander -> Commandé (date, fournisseur) -> Reçu ;
   - QR codes fabriqués dans l'appli (plus de site extérieur) ;
   - contrôle des données (doublons, tests, lignes vides…) ;
   - sortie de stock proposée depuis le Suivi des pompes (STOCK_SORTIE).
   Chaque site ne modifie que SON listing ; les références communes
   partagent une seule quantité (Stock_Commun) sur les deux sites.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var OUTIL_DU_SITE = { site1: 'stock-rotte', site2: 'stock-arr' }; // site1/site2 = ordre de l'onglet Sites du hub
  var MOTIFS_SORTIE = ['Intervention', 'Correction', 'Autre'];
  var MOTIFS_ENTREE = ['Réception commande', 'Retour de pièce', 'Correction', 'Autre'];
  var TYPES_PIECE = ['stock.quantite', 'stock.reception', 'stock.seuil', 'stock.casier', 'stock.designation', 'stock.reference', 'stock.photo', 'stock.retirerPhoto'];

  /* ---------- outils ---------- */
  function cle(p) { return String(p.reference || '').trim() || String(p.designation || '').trim(); }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function lienSur(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  // les liens « uc?export=view » de Drive s'affichent mal : on passe par la miniature Drive
  function urlPhoto(u) {
    u = String(u || '').trim();
    if (/^data:image\//.test(u)) return u;
    if (!lienSur(u)) return '';
    var m = /[?&]id=([\w-]{10,})/.exec(u) || /\/d\/([\w-]{10,})/.exec(u);
    return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000' : u;
  }
  function entier(v, min) {
    var n = PM.nombre(v);
    if (n === null || isNaN(n)) return NaN;
    n = Math.round(n);
    return n < (min || 0) ? NaN : n;
  }
  function casierNorm(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ' '); }
  // QR code fabriqué sur le téléphone (bibliothèque qrcode.js, hors ligne, rien n'est envoyé ailleurs)
  function qrDataUrl(texte, taille) {
    if (typeof window.qrcode !== 'function') return '';
    try {
      var q = window.qrcode(0, 'M');
      q.addData(texte);
      q.make();
      var cell = Math.max(2, Math.floor(taille / (q.getModuleCount() + 8)));
      return q.createDataURL(cell, cell * 4);
    } catch (e) { return ''; }
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
          ok(c.toDataURL('image/jpeg', qualite || 0.75));
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
    fond.appendChild(el('div', { class: 'ag-modale-boite' }, [
      el('div', { class: 'ag-modale-tete' }, [el('div', {}, [el('h2', {}, [titre]), sousTitre ? el('div', { class: 'petit' }, [sousTitre]) : null]), fermerBtn])
    ].concat(contenu)));
    document.body.appendChild(fond);
    return fermer;
  }
  function tableau(entetes, lignes, classe) {
    var tbody = el('tbody');
    lignes.forEach(function (tr) { tbody.appendChild(tr); });
    return el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table' + (classe ? ' ' + classe : '') }, [
      el('thead', {}, [el('tr', {}, entetes.map(function (h) { return el('th', {}, [h]); }))]), tbody])]);
  }

  /* ---------- données : stock du site + modifications en attente ---------- */
  function cles(siteId) { return { tout: 'stock_tout_' + siteId, attente: 'stock_attente_' + siteId }; }
  function etatTout(T, attente) {
    var mats = ((T && T.materiels) || []).map(function (m) { return { nom: m.nom, pieces: (m.pieces || []).map(function (p) { return Object.assign({}, p); }) }; });
    function mat(nom) { return mats.filter(function (m) { return m.nom === nom; })[0]; }
    (attente || []).forEach(function (a) {
      if (a.type === 'stock.materiel') { if (!mat(a.nom)) mats.push({ nom: a.nom, pieces: [], enAttente: true }); return; }
      var m = mat(a.materiel);
      if (!m) return;
      if (a.type === 'stock.piece') {
        var np = a.piece;
        m.pieces.push({ rowIndex: null, reference: np.reference || '', designation: np.designation, quantiteStock: np.quantiteStock || 0, seuil: np.seuil || 0,
          casier: np.casier || '', cotes: '', substitution: '', reperes: '', photo: np.photo || '', partage: false, enAttente: true });
        return;
      }
      if (TYPES_PIECE.indexOf(a.type) < 0) return;
      var cible = m.pieces.filter(function (p) { return a.rowIndex && p.rowIndex === a.rowIndex && cle(p) === cle(a); })[0]
        || m.pieces.filter(function (p) { return cle(p) === cle(a); })[0];
      if (!cible) return;
      var memeRef = [cible];
      if (a.reference) {
        memeRef = [];
        mats.forEach(function (mm) { mm.pieces.forEach(function (p) { if (p.reference === a.reference) memeRef.push(p); }); });
      }
      if (a.type === 'stock.quantite') memeRef.forEach(function (p) { p.quantiteStock = a.absolu ? Math.max(0, a.compte) : Math.max(0, p.quantiteStock + a.delta); });
      else if (a.type === 'stock.reception') memeRef.forEach(function (p) { p.quantiteStock += a.quantite; });
      else if (a.type === 'stock.seuil') memeRef.forEach(function (p) { p.seuil = a.seuil; });
      else if (a.type === 'stock.casier') cible.casier = a.casier;
      else if (a.type === 'stock.designation') cible.designation = a.nouvelle;
      else if (a.type === 'stock.reference') { cible.reference = a.nouvelle; cible.partage = false; }
      else if (a.type === 'stock.photo') cible.photo = a.photo;
      else if (a.type === 'stock.retirerPhoto') cible.photo = '';
      cible.enAttente = true;
    });
    mats.forEach(function (m) {
      m.pieces.forEach(function (p) { p.materiel = m.nom; p.quantiteACommander = Math.max((p.seuil || 0) - p.quantiteStock, 0); p.stockBas = p.quantiteStock <= (p.seuil || 0); });
      m.nbAlertes = m.pieces.filter(function (p) { return p.stockBas; }).length;
    });
    return mats;
  }
  function ajouterAttente(siteId, payload, avecPhoto) {
    var k = cles(siteId);
    return PM.DB.get(k.attente).then(function (l) {
      l = l || [];
      l.push(payload);
      return PM.DB.set(k.attente, l);
    }).then(function () { return PM.Envoi.ajouter(siteId, payload, avecPhoto); });
  }

  function demo() {
    function p(i, r, d, q, s, c) { return { rowIndex: i, reference: r, designation: d, quantiteStock: q, seuil: s, casier: c || '', cotes: '', substitution: '', reperes: '', photo: '', partage: false }; }
    var casiers = [];
    for (var c = 0; c < 26; c++) for (var n = 1; n <= 4; n++) casiers.push(String.fromCharCode(65 + c) + n);
    return { site: 'Démonstration', urlScanner: '', casiers: casiers, materiels: [
      { nom: 'Broyeur', pieces: [p(2, 'GFL 952 M9', 'Grille', 6, 3, '2F'), p(3, 'GSM019E4', 'Couteau', 2, 16, '2F'), p(4, 'DFD0019', 'Mousse O', 44, 8, '3A')] },
      { nom: 'Pompe CC', pieces: [p(2, 'PKE 0027', 'Stator', 1, 1, 'E3'), p(3, 'PRO 0023', 'Rotor', 0, 1, 'E3'), p(4, 'PBT.B019', 'Garniture étanche', 2, 1, '')] },
      { nom: 'Séparateur Bauer', pieces: [p(2, '2003654', 'Grand tamis', 1, 1, '3C'), p(3, '2003611', 'Vis', 2, 1, '3B')] }] };
  }

  /* ===================================================================
     Écran du module
     =================================================================== */
  window.MODULES.stock = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var S = ctx.site.id, K = cles(S);
      var T = null;            // stock du site (serveur)
      var attente = [];        // modifications pas encore confirmées par le serveur
      var ecran = 'materiels', materiel = null, filtre = '', recherche = '';
      var casierChoisi = null, invPortee = null, invFaits = {};
      var params = ctx.params || [];
      var instance = PM.uid();
      window.__stInstance = instance;
      function actif() { return window.__stInstance === instance && location.hash.indexOf('outil/' + ctx.outil.id) >= 0; }
      function api(action, extra, delai) {
        if (modeDemo) return Promise.reject(new Error('Mode démonstration : renseigne le serveur du site dans Réglages.'));
        return PM.Api.appeler(ctx.apiUrl, Object.assign({ action: action, cle: ctx.cle }, extra || {}), delai || 60000);
      }
      function mats() { return etatTout(T, attente); }
      function pieces(m) { var x = mats().filter(function (mm) { return mm.nom === m; })[0]; return x ? x.pieces : []; }
      function toutesPieces() { var l = []; mats().forEach(function (m) { l = l.concat(m.pieces); }); return l; }

      /* ---------- démarrage ---------- */
      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(K.tout), PM.DB.get(K.attente)]).then(function (r) {
        T = r[0] || (modeDemo ? demo() : null);
        attente = r[1] || [];
        if (params[0]) { ecran = 'pieces'; materiel = params[0]; }
        if (T) { afficher(); ouvrirLien(); }
        if (!modeDemo) charger(!T);
      });
      var lienTraite = false;
      // QR code d'une pièce (#outil/stock-xxx/<matériel>/<référence>) : fenêtre « Retirer » directe
      function ouvrirLien() {
        if (lienTraite || !params[1] || !T) return;
        var p = pieces(materiel).filter(function (x) { return x.reference === params[1]; })[0];
        if (!p) { if (T.maj || modeDemo) { lienTraite = true; PM.toast('Pièce « ' + params[1] + ' » introuvable dans ' + materiel); } return; }
        lienTraite = true;
        ouvrirQuantite(p, true);
      }
      function charger(premier) {
        return api('stock.tout', {}, 90000).then(function (j) {
          delete j.ok; T = j; PM.DB.set(K.tout, j);
          return nettoyerAttente().then(function () {
            if (actif() && !document.querySelector('.ag-modale')) afficher();
            ouvrirLien();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le stock.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { charger(true); } }, ['Réessayer']), ' ',
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast('Hors ligne : stock du dernier chargement');
        });
      }
      // toutes les saisies parties -> on recharge (quantités partagées à jour)
      PM.Envoi.surChangement(function (n) {
        if (!actif() || n || !attente.length || modeDemo) return;
        charger(false);
      });
      function nettoyerAttente() {
        return Promise.all([PM.DB.listerEnvois(), PM.DB.get(K.attente)]).then(function (r) {
          var ids = (r[0] || []).filter(function (x) { return !x.rejete; }).map(function (x) { return x.payload.id; });
          attente = (r[1] || []).filter(function (a) { return ids.indexOf(a.id) >= 0; });
          return PM.DB.set(K.attente, attente);
        });
      }

      /* ---------- saisie : file d'attente + affichage immédiat ---------- */
      function saisir(payload, avecPhoto) {
        var agent = PM.Prefs.get('agent', '');
        if (!agent) { demanderAgent(function () { saisir(payload, avecPhoto); }); return; }
        payload.id = PM.uid();
        payload.agent = agent;
        payload.horodatage = new Date().toISOString();
        if (navigator.vibrate) navigator.vibrate(25);
        attente.push(payload);
        if (modeDemo) {
          T = { site: T.site, urlScanner: '', casiers: casiersDefinis(), materiels: mats().map(function (m) { return { nom: m.nom, pieces: m.pieces }; }) };
          attente = [];
        } else {
          PM.DB.set(K.attente, attente);
          PM.Envoi.ajouter(S, payload, avecPhoto);
        }
        afficher();
        if (rafraichirFiche) rafraichirFiche();
      }
      function demanderAgent(suite) {
        var inp = el('input', { type: 'text', placeholder: 'Prénom', autocomplete: 'off' });
        var fermer = modale('Qui fait la modification ?', 'Ton prénom est noté dans l’historique des mouvements (une seule fois sur ce téléphone).', [
          el('div', { class: 'champ' }, [inp]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim();
            if (!v) { inp.focus(); return; }
            PM.Prefs.set('agent', v); fermer(); suite();
          } }, ['Continuer'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }
      function refPiece(p) { return { materiel: p.materiel, rowIndex: p.rowIndex, reference: p.reference, designation: p.designation }; }

      /* ================= écrans ================= */
      function afficher() {
        if (!actif() || !T) return;
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'stock' });
        vue.appendChild(racine);
        if (modeDemo) racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
          el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur du site dans ']), el('a', { href: '#reglages' }, ['Réglages']), '.']));
        racine.appendChild(barreOutils());
        ({ pieces: ecranPieces, casiers: ecranCasiers, inventaire: ecranInventaire, commander: ecranCommander, recherche: ecranRecherche,
          historique: ecranHistorique, communes: ecranCommunes, controle: ecranControle }[ecran] || ecranMateriels)(racine);
        window.scrollTo(0, y);
      }
      function aller(e, m) { ecran = e; if (m !== undefined) materiel = m; filtre = ''; afficher(); window.scrollTo(0, 0); }

      function barreOutils() {
        function b(txt, titre, fn, actifSi) {
          return el('button', { class: 'st-outil' + (actifSi ? ' actif' : ''), type: 'button', title: titre, 'aria-label': titre, onclick: fn }, [txt]);
        }
        var nbCmd = toutesPieces().filter(function (p) { return p.stockBas && p.quantiteACommander > 0; }).length;
        return el('div', { class: 'st-outils' }, [
          b('▦ Matériels', 'Matériels du site', function () { aller('materiels'); }, ecran === 'materiels' || ecran === 'pieces'),
          b('🗄 Casiers', 'Vue par casier', function () { aller('casiers'); }, ecran === 'casiers'),
          b('📷 Scan', 'Scanner un QR code', scanner),
          b('🛒 Commandes' + (nbCmd ? ' (' + nbCmd + ')' : ''), 'À commander / commandé', function () { aller('commander'); }, ecran === 'commander'),
          b('📋 Inventaire', 'Mode inventaire', function () { aller('inventaire'); }, ecran === 'inventaire'),
          b('📜', 'Historique des mouvements', function () { aller('historique'); }, ecran === 'historique'),
          b('🔗', 'Pièces au stock commun', function () { aller('communes'); }, ecran === 'communes'),
          b('🩺', 'Contrôle des données', function () { aller('controle'); }, ecran === 'controle')
        ]);
      }

      /* ---------- matériels + recherche instantanée dans tout le site ---------- */
      function ecranMateriels(racine) {
        var liste = mats();
        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('h2', { class: 'pp-titre' }, [T.site || ctx.site.nom]),
          el('button', { class: 'btn-second', type: 'button', onclick: ouvrirAjoutMateriel }, ['+ Ajouter un matériel'])]));
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand', placeholder: '🔍 Chercher une pièce (désignation, référence, casier)…', value: recherche, autocomplete: 'off' });
        var zone = el('div');
        racine.appendChild(champ); racine.appendChild(zone);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(recherche);
          if (t.length >= 2) {
            var r = toutesPieces().filter(function (p) { return norm([p.designation, p.reference, p.casier, p.ancienneReference].join(' ')).indexOf(t) >= 0; });
            zone.appendChild(r.length ? tableau(['Pièce', 'Matériel', 'Stock', ''], r.slice(0, 80).map(function (p) { return lignePiece(p, true); }), 'st-pieces')
              : el('div', { class: 'vide-msg' }, ['Aucune pièce de ce site ne correspond.']));
            zone.appendChild(el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { aller('recherche'); } }, ['Chercher aussi sur l’autre site']));
            return;
          }
          if (!liste.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Aucun matériel trouvé dans ce fichier.'])); return; }
          var g = el('div', { class: 'pp-grille' });
          liste.forEach(function (m, i) {
            g.appendChild(el('button', { class: 'pp-carte st-carte', type: 'button', style: '--i:' + i, onclick: function () { recherche = ''; aller('pieces', m.nom); } }, [
              el('div', { class: 'st-carte-tete' }, [el('span', { class: 'pp-nom' }, [m.nom]),
                m.nbAlertes ? el('span', { class: 'st-pastille', title: m.nbAlertes + ' pièce(s) sous le seuil' }, [String(m.nbAlertes)]) : null]),
              el('div', { class: 'pp-der' }, [m.enAttente ? 'en attente d’envoi…' : (m.pieces.length + ' pièce' + (m.pieces.length > 1 ? 's' : '') + (m.nbAlertes ? ' · ' + m.nbAlertes + ' sous seuil' : ''))])
            ]));
          });
          zone.appendChild(g);
        }
        champ.addEventListener('input', function () { recherche = champ.value; remplir(); });
        remplir();
      }
      function ouvrirAjoutMateriel() {
        var inp = el('input', { type: 'text', placeholder: 'ex : Broyeur, Pompe doseuse…' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Ajouter un matériel', 'Crée un nouvel onglet dans le fichier du site, avec les colonnes habituelles.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Nom du matériel']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var nom = inp.value.trim();
            if (!nom) { msg.textContent = 'Indique un nom.'; msg.hidden = false; return; }
            if (mats().some(function (m) { return norm(m.nom) === norm(nom); })) { msg.textContent = 'Ce matériel existe déjà.'; msg.hidden = false; return; }
            fermer(); saisir({ type: 'stock.materiel', nom: nom }); PM.toast('Matériel ajouté');
          } }, ['Ajouter'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }

      /* ---------- pièces d'un matériel ---------- */
      function ecranPieces(racine) {
        var liste = pieces(materiel);
        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('button', { class: 'btn-second', type: 'button', onclick: function () { aller('materiels'); } }, ['← Matériels']),
          el('h2', { class: 'pp-titre' }, [materiel])]));
        var champ = el('input', { type: 'search', class: 'st-filtre', placeholder: 'Filtrer (désignation, référence, casier)…', value: filtre, autocomplete: 'off' });
        racine.appendChild(el('div', { class: 'st-actions' }, [champ,
          el('button', { class: 'btn-second', type: 'button', onclick: function () { imprimerQr(liste, (T.site ? T.site + ' — ' : '') + materiel); } }, ['🖨 QR codes']),
          el('button', { class: 'btn-second', type: 'button', onclick: ouvrirAjoutPiece }, ['+ Ajouter une pièce'])]));
        var conteneur = el('div');
        racine.appendChild(conteneur);
        function remplir() {
          conteneur.innerHTML = '';
          var f = norm(filtre);
          var vues = liste.filter(function (p) { return !f || norm([p.designation, p.reference, p.casier, p.ancienneReference].join(' ')).indexOf(f) >= 0; });
          if (!vues.length) { conteneur.appendChild(el('div', { class: 'vide-msg' }, [liste.length ? 'Aucune pièce ne correspond.' : 'Aucune pièce enregistrée.'])); return; }
          conteneur.appendChild(tableau(['Référence', 'Désignation', 'Casier', 'Stock', ''], vues.map(function (p) { return lignePiece(p, false); }), 'st-pieces st-pieces-casier'));
        }
        champ.addEventListener('input', function () { filtre = champ.value; remplir(); });
        remplir();
      }
      // avecMateriel : vue recherche / casier (la 2e colonne montre le matériel)
      function lignePiece(p, avecMateriel) {
        var sous = [];
        if (p.cotes) sous.push(p.cotes);
        if (p.reperes) sous.push('rep. ' + p.reperes);
        if (p.substitution) sous.push('subst. ' + p.substitution);
        var badges = [
          p.partage ? el('span', { class: 'st-badge st-partage', title: 'Référence retrouvée sur un autre site ou matériel : stock partagé' }, ['🔗 Partagé']) : null,
          p.stockBas ? el('span', { class: 'st-badge st-alerte' }, ['Stock bas']) : null,
          p.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['à envoyer']) : null];
        var cellQte = el('td', {}, [el('button', { class: 'st-qte', type: 'button', title: 'Modifier la quantité', onclick: function () { ouvrirQuantite(p); } }, [String(p.quantiteStock)]),
          p.quantiteACommander > 0 ? el('div', { class: 'st-acommander' }, ['à commander : ' + p.quantiteACommander]) : null]);
        var actions = el('td', { class: 'pp-actions' }, [
          el('button', { class: 'pp-icone', type: 'button', title: 'Ajouter au panier', onclick: function () { ouvrirPanier(p); } }, ['🛒']),
          el('button', { class: 'pp-icone', type: 'button', title: 'Détails', onclick: function () { ouvrirFiche(p); } }, ['ℹ️'])]);
        var classe = (p.stockBas ? 'st-bas' : '') + (p.enAttente ? ' attente' : '');
        if (avecMateriel) {
          return el('tr', { class: classe }, [
            el('td', {}, [el('span', {}, [p.designation]), badges[0], badges[1], badges[2],
              el('div', { class: 'st-sous' }, [(p.reference ? 'Réf. ' + p.reference : 'sans référence') + (p.casier ? ' · casier ' + p.casier : '')])]),
            el('td', {}, [p.materiel]), cellQte, actions]);
        }
        return el('tr', { class: classe }, [
          el('td', { class: 'st-ref' }, [p.reference || '—', urlPhoto(p.photo) ? el('button', { class: 'pp-icone', type: 'button', title: 'Voir la photo', onclick: function () { pleinEcran(p.photo); } }, ['📷']) : null]),
          el('td', {}, [el('span', {}, [p.designation]), badges[0], badges[1], badges[2], sous.length ? el('div', { class: 'st-sous' }, [sous.join(' · ')]) : null]),
          el('td', {}, [p.casier || '']), cellQte, actions]);
      }

      /* ---------- vue par casier ---------- */
      // casiers du magasin (liste du site, A1…Z4 au départ) + ceux déjà notés sur des pièces
      function casiersDefinis() {
        var l = ((T && T.casiers) || []).map(casierNorm);
        attente.forEach(function (a) {
          var c = casierNorm(a.nom);
          if (a.type === 'stock.casierAjout' && l.indexOf(c) < 0) l.push(c);
          if (a.type === 'stock.casierSuppr') l = l.filter(function (x) { return x !== c; });
        });
        return l;
      }
      function groupesCasiers() {
        var g = {};
        casiersDefinis().forEach(function (c) { if (c) g[c] = []; });
        toutesPieces().forEach(function (p) { var c = casierNorm(p.casier) || '(sans casier)'; (g[c] = g[c] || []).push(p); });
        return Object.keys(g).sort(function (a, b) {
          if (a === '(sans casier)') return 1; if (b === '(sans casier)') return -1;
          return a.localeCompare(b, 'fr', { numeric: true });
        }).map(function (c) { return { casier: c, pieces: g[c] }; });
      }
      function ecranCasiers(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Casiers']));
        racine.appendChild(el('div', { class: 'st-actions' }, [el('p', { class: 'petit', style: 'flex:1;margin:0' }, ['Ce qu’il y a dans chaque casier, tous matériels confondus.']),
          el('button', { class: 'btn-second', type: 'button', onclick: function () { nouveauCasier(function (c) { casierChoisi = c; afficher(); }); } }, ['+ Nouveau casier'])]));
        var gs = groupesCasiers();
        var puces = el('div', { class: 'st-casiers' });
        gs.forEach(function (g) {
          var bas = g.pieces.filter(function (p) { return p.stockBas; }).length;
          puces.appendChild(el('button', { class: 'st-casier' + (casierChoisi === g.casier ? ' actif' : ''), type: 'button', onclick: function () { casierChoisi = g.casier; afficher(); } }, [
            el('b', {}, [g.casier]), el('span', {}, [' ' + g.pieces.length]), bas ? el('span', { class: 'st-pastille st-pastille-mini' }, [String(bas)]) : null]));
        });
        racine.appendChild(puces);
        var g = gs.filter(function (x) { return x.casier === casierChoisi; })[0];
        if (!g) { racine.appendChild(el('p', { class: 'petit' }, ['Touche un casier pour voir son contenu.'])); return; }
        racine.appendChild(el('div', { class: 'pp-barre', style: 'margin-top:12px' }, [el('h3', { class: 'pp-titre' }, ['Casier ' + g.casier]),
          el('button', { class: 'btn-second', type: 'button', onclick: function () { invPortee = { type: 'casier', valeur: g.casier }; invFaits = {}; aller('inventaire'); } }, ['📋 Inventorier ce casier']),
          !g.pieces.length && g.casier !== '(sans casier)' ? el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Supprimer ce casier vide', onclick: function () {
            if (confirm('Supprimer le casier ' + g.casier + ' de la liste ?')) { casierChoisi = null; saisir({ type: 'stock.casierSuppr', nom: g.casier }); }
          } }, ['🗑']) : null]));
        racine.appendChild(g.pieces.length ? tableau(['Pièce', 'Matériel', 'Stock', ''], g.pieces.map(function (p) { return lignePiece(p, true); }), 'st-pieces')
          : el('p', { class: 'petit' }, ['Casier vide pour l’instant. Utilise « Inventorier ce casier » pour y ranger les pièces trouvées.']));
      }

      function listeCasiers() {
        return el('datalist', { id: 'st-liste-casiers' }, groupesCasiers().filter(function (g) { return g.casier !== '(sans casier)'; }).map(function (g) { return el('option', { value: g.casier }); }));
      }
      function nouveauCasier(suite) {
        var inp = el('input', { type: 'text', placeholder: 'ex : AA1, Étagère 5, Armoire B', autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Nouveau casier', 'Il s’ajoute à la liste des casiers de ce site.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Nom du casier']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var c = casierNorm(inp.value);
            if (!c) { msg.textContent = 'Indique un nom.'; msg.hidden = false; return; }
            if (casiersDefinis().indexOf(c) >= 0) { fermer(); if (suite) suite(c); return; }
            fermer(); saisir({ type: 'stock.casierAjout', nom: c }); PM.toast('Casier ' + c + ' ajouté'); if (suite) suite(c);
          } }, ['Ajouter'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }
      // inventaire d'un casier : une pièce trouvée dedans est rangée dans ce casier, avec la quantité comptée
      function pieceTrouvee(casier) {
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand', placeholder: 'Chercher la pièce (désignation, référence)…', autocomplete: 'off' });
        var zone = el('div', { class: 'st-sortie' });
        var fermer = modale('Pièce trouvée dans ' + casier, 'Choisis la pièce : son casier devient ' + casier + ' et tu saisis la quantité comptée.', [champ, zone,
          el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { fermer(); materiel = mats()[0] && mats()[0].nom; ouvrirAjoutPiece(casier); } }, ['+ Pièce qui n’existe pas encore'])]);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(champ.value);
          if (t.length < 2) { zone.appendChild(el('p', { class: 'petit' }, ['Tape au moins 2 caractères.'])); return; }
          toutesPieces().filter(function (p) { return norm([p.designation, p.reference].join(' ')).indexOf(t) >= 0; }).slice(0, 30).forEach(function (p) {
            zone.appendChild(el('button', { class: 'st-sortie-ligne', type: 'button', onclick: function () { fermer(); rangerEtCompter(p, casier); } }, [
              el('span', { class: 'st-sortie-nom' }, [p.designation, el('div', { class: 'st-sous' }, [p.materiel + ' · ' + (p.reference || 'sans réf.') + ' · ' + (p.casier ? 'casier ' + p.casier : 'sans casier') + ' · stock ' + p.quantiteStock])])]));
          });
          if (!zone.children.length) zone.appendChild(el('p', { class: 'petit' }, ['Aucune pièce ne correspond.']));
        }
        champ.addEventListener('input', remplir); remplir();
        setTimeout(function () { champ.focus(); }, 30);
      }
      function rangerEtCompter(p, casier) {
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: String(p.quantiteStock), autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale(p.designation, p.materiel + ' — ' + (p.casier && casierNorm(p.casier) !== casier ? 'casier ' + p.casier + ' → ' + casier : 'casier ' + casier), [
          el('div', { class: 'champ' }, [el('label', {}, ['Quantité comptée dans ' + casier]), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var n = entier(inp.value, 0);
            if (isNaN(n)) { msg.textContent = 'Saisis un nombre entier (0 ou plus).'; msg.hidden = false; return; }
            fermer();
            if (casierNorm(p.casier) !== casier) saisir(Object.assign({ type: 'stock.casier', casier: casier }, refPiece(p)));
            invFaits[p.materiel + '|' + cle(p)] = n;
            saisir(Object.assign({ type: 'stock.quantite', absolu: true, compte: n, motif: 'Inventaire' }, refPiece(p)));
          } }, ['Ranger et enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }

      /* ---------- mode inventaire (quantité comptée) ---------- */
      function ecranInventaire(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Inventaire']));
        racine.appendChild(el('p', { class: 'petit' }, ['Saisis le nombre compté : l’appli calcule l’écart et le note dans l’historique (motif « Inventaire »).']));
        var choix = el('select', { class: 'st-select', style: 'flex:1 1 200px;margin:0' }, [el('option', { value: '' }, ['Choisir un matériel ou un casier…'])]
          .concat([el('optgroup', { label: 'Matériels' }, mats().map(function (m) { return el('option', { value: 'materiel|' + m.nom }, [m.nom]); }))])
          .concat([el('optgroup', { label: 'Casiers' }, groupesCasiers().map(function (g) { return el('option', { value: 'casier|' + g.casier }, ['Casier ' + g.casier]); }))]));
        if (invPortee) choix.value = invPortee.type + '|' + invPortee.valeur;
        choix.addEventListener('change', function () {
          var v = choix.value.split('|');
          invPortee = v[0] ? { type: v[0], valeur: v.slice(1).join('|') } : null;
          invFaits = {};
          afficher();
        });
        racine.appendChild(el('div', { class: 'st-actions' }, [choix,
          el('button', { class: 'btn-second', type: 'button', onclick: function () { nouveauCasier(function (c) { invPortee = { type: 'casier', valeur: c }; invFaits = {}; afficher(); }); } }, ['+ Nouveau casier'])]));
        if (!invPortee) return;
        var parCasier = invPortee.type === 'casier' && invPortee.valeur !== '(sans casier)';
        if (parCasier) racine.appendChild(el('button', { class: 'btn-second st-large', style: 'margin:0 0 12px', type: 'button', onclick: function () { pieceTrouvee(invPortee.valeur); } }, ['+ Pièce trouvée dans ce casier']));
        var liste = invPortee.type === 'materiel' ? pieces(invPortee.valeur)
          : toutesPieces().filter(function (p) { return (casierNorm(p.casier) || '(sans casier)') === invPortee.valeur; });
        if (!liste.length) { racine.appendChild(el('div', { class: 'vide-msg' }, [parCasier ? 'Casier vide pour l’instant : ajoute les pièces trouvées avec le bouton ci-dessus.' : 'Aucune pièce.'])); return; }
        var champs = [];
        var lignes = liste.map(function (p) {
          var k = p.materiel + '|' + cle(p);
          var inp = el('input', { type: 'text', inputmode: 'numeric', class: 'st-compte', placeholder: String(p.quantiteStock), autocomplete: 'off', 'aria-label': 'Quantité comptée' });
          var ecart = el('span', { class: 'st-ecart' });
          var ok = el('button', { class: 'btn-second st-ok', type: 'button', title: 'Valider ce comptage' }, ['✓']);
          function majEcart() {
            var n = entier(inp.value, 0);
            ecart.textContent = isNaN(n) ? '' : (n - p.quantiteStock === 0 ? '= ok' : (n - p.quantiteStock > 0 ? '+' : '') + (n - p.quantiteStock));
            ecart.className = 'st-ecart' + (isNaN(n) ? '' : (n === p.quantiteStock ? ' st-plus' : ' st-moins'));
          }
          function valider() {
            var n = entier(inp.value, 0);
            if (isNaN(n)) { inp.focus(); return false; }
            invFaits[k] = n;
            saisir(Object.assign({ type: 'stock.quantite', absolu: true, compte: n, motif: 'Inventaire' }, refPiece(p)));
            return true;
          }
          inp.addEventListener('input', majEcart);
          inp.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var i = champs.indexOf(inp);
            if (champs[i + 1]) champs[i + 1].focus();
          });
          ok.addEventListener('click', valider);
          if (invFaits[k] === undefined) champs.push(inp);
          champs.valider = champs.valider || [];
          champs.valider.push(function () { return inp.value.trim() !== '' && invFaits[k] === undefined ? valider() : false; });
          return el('tr', { class: invFaits[k] !== undefined ? 'st-fait' : '' }, [
            el('td', {}, [p.designation, el('div', { class: 'st-sous' }, [(p.reference || 'sans réf.') + ' · ' + (invPortee.type === 'casier' ? p.materiel : (p.casier ? 'casier ' + p.casier : 'sans casier'))])]),
            el('td', {}, [String(p.quantiteStock)]),
            el('td', {}, invFaits[k] !== undefined ? [el('b', { class: 'st-plus' }, ['✓ ' + invFaits[k]])] : [inp, ecart]),
            el('td', {}, invFaits[k] !== undefined ? [] : [ok])]);
        });
        racine.appendChild(tableau(['Pièce', 'Avant', 'Compté', ''], lignes, 'st-inventaire'));
        racine.appendChild(el('button', { class: 'btn-principal', type: 'button', onclick: function tous() {
          if (!PM.Prefs.get('agent', '')) { demanderAgent(tous); return; }
          var n = 0;
          (champs.valider || []).forEach(function (f) { if (f()) n++; });
          PM.toast(n ? n + ' comptage(s) enregistré(s)' : 'Aucun comptage saisi');
        } }, ['Valider tous les comptages saisis']));
      }

      /* ---------- fiche pièce ---------- */
      var rafraichirFiche = null;
      function ouvrirFiche(p0) {
        var corps = el('div');
        modale(p0.designation || p0.reference || 'Pièce', p0.materiel, [corps]);
        var docs = null;
        function piece() {
          return pieces(p0.materiel).filter(function (x) { return p0.rowIndex ? x.rowIndex === p0.rowIndex : cle(x) === cle(p0); })[0] || p0;
        }
        function ligne(lib, val, edit) {
          return [el('dt', {}, [lib]), el('dd', {}, [val === '' || val === null || val === undefined ? el('span', { class: 'petit' }, ['non renseigné']) : String(val),
            edit ? el('button', { class: 'pp-icone', type: 'button', title: 'Modifier ' + lib.toLowerCase(), onclick: edit }, ['✎']) : null])];
        }
        function rendre() {
          if (!document.body.contains(corps)) { rafraichirFiche = null; return; }
          var p = piece();
          corps.innerHTML = '';
          corps.appendChild(el('div', { class: 'st-fiche-qte' }, [
            el('button', { class: 'st-qte st-qte-grand', type: 'button', onclick: function () { ouvrirQuantite(p); } }, [String(p.quantiteStock)]),
            el('span', { class: 'petit' }, ['en stock — touche pour modifier'])]));
          var dl = el('dl', { class: 'st-details' });
          [].concat(
            ligne('Désignation', p.designation, function () { editerTexte(p, 'Désignation', 'designation', 'stock.designation', true); }),
            ligne('Casier', p.casier, function () { editerCasier(p); }),
            ligne('Seuil mini', p.seuil, function () { editerSeuil(p); }),
            ligne('À commander', p.quantiteACommander),
            ligne('Référence', p.reference, function () { editerTexte(p, 'Référence', 'reference', 'stock.reference', false); }),
            p.ancienneReference ? ligne('Ancienne réf.', p.ancienneReference) : [],
            p.cotes ? ligne('Côtes', p.cotes) : [], p.substitution ? ligne('Substitution', p.substitution) : [], p.reperes ? ligne('Repères', p.reperes) : []
          ).forEach(function (n) { dl.appendChild(n); });
          corps.appendChild(dl);
          var src = urlPhoto(p.photo);
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Photo',
            el('button', { class: 'pp-icone', type: 'button', title: src ? 'Remplacer la photo' : 'Ajouter une photo', onclick: function () { choisirPhoto(p); } }, [src ? '✎' : '+'])]),
            src ? el('div', { class: 'st-photo' }, [el('img', { src: src, alt: 'Photo de la pièce', onclick: function () { pleinEcran(p.photo); } }),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer la photo', onclick: function () {
                if (confirm('Retirer la photo de cette pièce ?')) saisir(Object.assign({ type: 'stock.retirerPhoto' }, refPiece(p)));
              } }, ['🗑'])])
              : el('p', { class: 'petit' }, [p.photo && !lienSur(p.photo) ? 'Pas encore de vraie photo (« ' + p.photo + ' ») : touche + pour en prendre une.' : 'Aucune photo pour l’instant.'])]));
          if (p.reference) {
            var qr = qrDataUrl(lienFiche(p), 180);
            if (qr) corps.appendChild(el('div', { class: 'st-qr' }, [el('div', { class: 'st-section-titre' }, ['QR code — à coller sur le casier']),
              el('img', { src: qr, alt: 'QR code', width: '180', height: '180' })]));
          }
          var zoneDocs = el('div', { class: 'st-docs' });
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Documents',
            p.reference ? el('button', { class: 'pp-icone', type: 'button', title: 'Ajouter un document', onclick: function () { ajouterDocument(p); } }, ['+']) : null]), zoneDocs]));
          remplirDocs(zoneDocs, p);
          corps.appendChild(el('div', { class: 'bg-boutons st-fiche-boutons' }, [
            el('button', { class: 'btn-second', type: 'button', onclick: function () { imprimerQr([p], p.designation || p.reference); } }, ['🖨 Imprimer']),
            el('button', { class: 'btn-second', type: 'button', onclick: function () { ouvrirPanier(p); } }, ['🛒 Panier']),
            el('button', { class: 'btn-second', type: 'button', onclick: scanner }, ['📷 Scanner suivant'])]));
        }
        function remplirDocs(zone, p) {
          if (!p.reference) { zone.appendChild(el('p', { class: 'petit' }, ['Pas de référence sur cette pièce : impossible d’y associer un document.'])); return; }
          var enAtt = attente.filter(function (a) { return a.type === 'stock.document' && a.reference === p.reference; }).map(function (a) { return { nom: a.nom, lien: a.lien, enAttente: true }; });
          var retires = attente.filter(function (a) { return a.type === 'stock.retirerDocument' && a.reference === p.reference; }).map(function (a) { return a.lien; });
          function lister(liste) {
            zone.innerHTML = '';
            liste = liste.filter(function (d) { return retires.indexOf(d.lien) < 0; }).concat(enAtt);
            if (!liste.length) { zone.appendChild(el('p', { class: 'petit' }, ['Aucun document pour l’instant.'])); return; }
            liste.forEach(function (d) {
              var u = lienSur(d.lien);
              zone.appendChild(el('div', { class: 'st-doc' }, [
                u ? el('a', { href: u, target: '_blank', rel: 'noopener' }, ['📄 ' + d.nom]) : el('span', {}, ['📄 ' + d.nom]),
                d.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['à envoyer']) : el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer ce document', onclick: function () {
                  if (confirm('Retirer « ' + d.nom + ' » ?')) { docs = null; saisir({ type: 'stock.retirerDocument', reference: p.reference, lien: d.lien }); }
                } }, ['🗑'])]));
            });
          }
          if (docs && docs.ref === p.reference) { lister(docs.liste); return; }
          zone.appendChild(el('p', { class: 'petit' }, ['Chargement…']));
          (modeDemo ? Promise.resolve({ documents: [] }) : api('stock.documents', { reference: p.reference }, 30000)).then(function (j) {
            docs = { ref: p.reference, liste: j.documents || [] }; lister(docs.liste);
          })['catch'](function () { zone.innerHTML = ''; zone.appendChild(el('p', { class: 'petit' }, ['Documents indisponibles hors ligne.'])); });
        }
        rafraichirFiche = rendre;
        rendre();
      }

      /* ---------- modifications ---------- */
      // depuisScan : ouvert par un QR code -> « Retirer 1 » prêt à valider + accès à la fiche
      function ouvrirQuantite(p, depuisScan) {
        var sens = -1, motif = MOTIFS_SORTIE[0];
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: '1', autocomplete: 'off' });
        var bR = el('button', { class: 'st-sens actif', type: 'button' }, ['− Retirer']);
        var bA = el('button', { class: 'st-sens', type: 'button' }, ['+ Ajouter']);
        var zoneMotifs = el('div', { class: 'st-motifs' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function majMotifs() {
          zoneMotifs.innerHTML = '';
          (sens < 0 ? MOTIFS_SORTIE : MOTIFS_ENTREE).forEach(function (m) {
            zoneMotifs.appendChild(el('button', { class: 'st-chip' + (m === motif ? ' actif' : ''), type: 'button', onclick: function () { motif = m; majMotifs(); } }, [m]));
          });
        }
        function majSens(s) { sens = s; motif = (s < 0 ? MOTIFS_SORTIE : MOTIFS_ENTREE)[0]; bR.classList.toggle('actif', s === -1); bA.classList.toggle('actif', s === 1); majMotifs(); }
        bR.onclick = function () { majSens(-1); }; bA.onclick = function () { majSens(1); };
        majMotifs();
        var fermer = modale(depuisScan ? (p.designation || p.reference) : 'Modifier la quantité',
          (depuisScan ? p.materiel + (p.casier ? ' · casier ' + p.casier : '') + ' — ' : (p.designation || p.reference) + ' — ') + 'stock actuel : ' + p.quantiteStock, [
            el('div', { class: 'st-sens-ligne' }, [bR, bA]),
            el('div', { class: 'st-rapides' }, [1, 2, 5, 10].map(function (v) { return el('button', { class: 'st-chip', type: 'button', onclick: function () { inp.value = v; } }, [String(v)]); })),
            el('div', { class: 'champ' }, [el('label', {}, ['Quantité']), inp]),
            el('div', { class: 'petit', style: 'margin:-4px 0 6px' }, ['Motif']), zoneMotifs, msg,
            el('button', { class: 'btn-principal', type: 'button', onclick: valider }, ['Valider']),
            depuisScan ? el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { fermer(); ouvrirFiche(p); } }, ['ℹ️ Voir la fiche de la pièce']) : null]);
        function valider() {
          var q = entier(inp.value, 1);
          if (isNaN(q)) { msg.textContent = 'Saisis un nombre entier (1 ou plus).'; msg.hidden = false; return; }
          if (p.quantiteStock + sens * q < 0) { msg.textContent = 'La quantité ne peut pas devenir négative.'; msg.hidden = false; return; }
          fermer();
          saisir(Object.assign({ type: 'stock.quantite', delta: sens * q, motif: motif }, refPiece(p)));
          PM.toast((sens < 0 ? 'Retiré : ' : 'Ajouté : ') + q + ' × ' + (p.designation || p.reference));
        }
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
      }
      function editerTexte(p, lib, champ, type, obligatoire) {
        var inp = el('input', { type: 'text', value: p[champ] || '', autocomplete: 'off' });
        var note = type === 'stock.reference' ? 'Si cette référence existe déjà ailleurs (autre site ou matériel), la pièce rejoint aussitôt le stock déjà partagé. Si tu la vides, elle redevient propre à cette ligne.' : '';
        var fermer = modale('Modifier : ' + lib.toLowerCase(), note, [el('div', { class: 'champ' }, [el('label', {}, [lib]), inp]),
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim();
            if (obligatoire && !v) { inp.focus(); return; }
            if (v === (p[champ] || '')) { fermer(); return; }
            if (!confirm('Changer « ' + (p[champ] || 'non renseigné') + ' » en « ' + (v || 'non renseigné') + ' » ?')) return;
            fermer(); saisir(Object.assign({ type: type, nouvelle: v }, refPiece(p)));
          } }, ['Enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }
      function editerSeuil(p) {
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: String(p.seuil || 0), autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Modifier le seuil mini', 'Pour une référence partagée avec un autre site, ce seuil s’applique partout où elle est utilisée.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Seuil mini']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = entier(inp.value, 0);
            if (isNaN(v)) { msg.textContent = 'Saisis un nombre entier (0 ou plus).'; msg.hidden = false; return; }
            if (!confirm('Changer le seuil mini de ' + p.seuil + ' à ' + v + ' ?')) return;
            fermer(); saisir(Object.assign({ type: 'stock.seuil', seuil: v }, refPiece(p)));
          } }, ['Enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }
      function editerCasier(p) {
        var inp = el('input', { type: 'text', value: p.casier || '', placeholder: 'ex : A1, C10 / 1', autocomplete: 'off', list: 'st-liste-casiers' });
        var sugg = el('div', { class: 'st-sugg' });
        var fermer = modale('Modifier le casier', 'Le casier reste propre à cette ligne, même pour une référence partagée.', [
          listeCasiers(), el('div', { class: 'champ' }, [el('label', {}, ['Casier']), inp]), sugg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim();
            if (v === (p.casier || '')) { fermer(); return; }
            if (!confirm('Changer le casier de « ' + (p.casier || 'non renseigné') + ' » à « ' + (v || 'non renseigné') + ' » ?')) return;
            fermer(); saisir(Object.assign({ type: 'stock.casier', casier: v }, refPiece(p)));
          } }, ['Enregistrer'])]);
        // casiers déjà utilisés pour la même référence (ce site tout de suite, l'autre site si réseau)
        var autres = toutesPieces().filter(function (x) { return p.reference && x.reference === p.reference && x !== p && x.casier && !(x.materiel === p.materiel && x.rowIndex === p.rowIndex); })
          .map(function (x) { return { site: T.site, materiel: x.materiel, casier: x.casier }; });
        function montrer(liste) {
          sugg.innerHTML = '';
          if (!liste.length) return;
          sugg.appendChild(el('p', { class: 'petit' }, ['Même référence ailleurs :']));
          liste.forEach(function (e) { sugg.appendChild(el('button', { class: 'st-sugg-btn', type: 'button', onclick: function () { inp.value = e.casier; } }, ['Même casier que ' + e.site + ' — ' + e.materiel + ' (' + e.casier + ')'])); });
        }
        montrer(autres);
        if (p.partage && p.reference && !modeDemo) {
          api('stock.emplacements', { reference: p.reference, materiel: p.materiel, rowIndex: p.rowIndex }).then(function (j) {
            montrer((j.emplacements || []).filter(function (e) { return e.casier; }));
          })['catch'](function () {});
        }
        setTimeout(function () { inp.focus(); }, 30);
      }
      function choisirPhoto(p) {
        var f = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: 'hidden' });
        document.body.appendChild(f);
        f.addEventListener('change', function () {
          var fichier = f.files[0]; f.remove();
          if (!fichier) return;
          redimensionner(fichier, 1280, 0.75).then(function (data) {
            saisir(Object.assign({ type: 'stock.photo', photo: data }, refPiece(p)), true);
            PM.toast('Photo enregistrée');
          })['catch'](function () { PM.toast('Impossible de lire cette photo.'); });
        });
        f.click();
      }
      function ajouterDocument(p) {
        var nom = el('input', { type: 'text', placeholder: 'ex : Fiche technique, Notice de montage' });
        var lien = el('input', { type: 'url', placeholder: 'https://drive.google.com/…' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Ajouter un document', 'Dans Google Drive : clic droit sur le fichier > Partager > Copier le lien, puis colle-le ici.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Nom du document']), nom]),
          el('div', { class: 'champ' }, [el('label', {}, ['Lien (Google Drive ou autre URL)']), lien]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            if (!nom.value.trim()) { msg.textContent = 'Indique un nom.'; msg.hidden = false; return; }
            if (!lienSur(lien.value)) { msg.textContent = 'Le lien doit commencer par http:// ou https://'; msg.hidden = false; return; }
            fermer(); saisir({ type: 'stock.document', reference: p.reference, nom: nom.value.trim(), lien: lien.value.trim() }); PM.toast('Document ajouté');
          } }, ['Ajouter'])]);
      }
      function ouvrirAjoutPiece(casierImpose) {
        var c = {
          designation: el('input', { type: 'text' }), reference: el('input', { type: 'text' }),
          quantite: el('input', { type: 'text', inputmode: 'numeric', value: '0' }), seuil: el('input', { type: 'text', inputmode: 'numeric', value: '0' }),
          casier: el('input', { type: 'text', placeholder: 'ex : A1, C10 / 1', value: casierImpose || '', list: 'st-liste-casiers' }), photo: el('input', { type: 'file', accept: 'image/*', capture: 'environment' })
        };
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function champ(lib, i) { return el('div', { class: 'champ' }, [el('label', {}, [lib]), i]); }
        var choixMat = el('select', { class: 'st-select' }, mats().map(function (m) { return el('option', { value: m.nom }, [m.nom]); }));
        choixMat.value = materiel;
        choixMat.addEventListener('change', function () { materiel = choixMat.value; });
        var fermer = modale('Ajouter une pièce', casierImpose ? 'Rangée dans le casier ' + casierImpose : materiel, [
          casierImpose ? champ('Matériel', choixMat) : null, listeCasiers(),
          champ('Désignation', c.designation), champ('Référence', c.reference),
          el('div', { class: 'pp-deux' }, [champ('Quantité de départ', c.quantite), champ('Seuil', c.seuil)]),
          champ('Casier', c.casier), champ('Photo (facultatif)', c.photo),
          el('p', { class: 'petit' }, ['Même référence qu’une pièce existante (ce site ou l’autre) = stock partagé automatiquement. Côtes, Substitution et Repères restent modifiables dans le Google Sheets du site.']),
          msg, el('button', { class: 'btn-principal', type: 'button', onclick: valider }, ['Ajouter'])]);
        function valider() {
          var q = entier(c.quantite.value, 0), s = entier(c.seuil.value, 0);
          if (!c.designation.value.trim()) { msg.textContent = 'La désignation est obligatoire.'; msg.hidden = false; return; }
          if (isNaN(q) || isNaN(s)) { msg.textContent = 'Quantité et seuil : nombres entiers (0 ou plus).'; msg.hidden = false; return; }
          var ref = c.reference.value.trim();
          if (ref && pieces(materiel).some(function (p) { return p.reference === ref; }) && !confirm('Cette référence existe déjà dans ' + materiel + '. L’ajouter quand même ?')) return;
          var piece = { designation: c.designation.value.trim(), reference: ref, quantiteStock: q, seuil: s, casier: c.casier.value.trim() };
          var fichier = c.photo.files[0];
          (fichier ? redimensionner(fichier, 1280, 0.75) : Promise.resolve('')).then(function (data) {
            if (data) piece.photo = data;
            fermer(); saisir({ type: 'stock.piece', materiel: materiel, piece: piece }, !!data); PM.toast('Pièce ajoutée');
          })['catch'](function () { msg.textContent = 'Impossible de lire la photo choisie.'; msg.hidden = false; });
        }
        setTimeout(function () { c.designation.focus(); }, 30);
      }
      function ouvrirPanier(p) {
        if (!p.reference) { PM.toast('Pièce sans référence : impossible de l’ajouter au panier.'); return; }
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: String(p.quantiteACommander > 0 ? p.quantiteACommander : 1) });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Ajouter au panier', (p.designation || p.reference) + ' — réf. ' + p.reference, [
          el('div', { class: 'champ' }, [el('label', {}, ['Quantité à commander']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var q = entier(inp.value, 1);
            if (isNaN(q)) { msg.textContent = 'Saisis un nombre entier (1 ou plus).'; msg.hidden = false; return; }
            fermer(); saisir({ type: 'stock.panier', materiel: p.materiel, reference: p.reference, designation: p.designation, casier: p.casier, quantite: q });
            PM.toast('Ajouté au panier « À commander »');
          } }, ['Ajouter au panier'])]);
      }

      /* ---------- commandes : À commander -> Commandé -> Reçu ---------- */
      var listeCommande = null, cmdServeur = null;
      function ecranCommander(racine) {
        racine.appendChild(el('div', { class: 'pp-barre' }, [el('h2', { class: 'pp-titre' }, ['Commandes']),
          el('button', { class: 'btn-second', type: 'button', onclick: exporterPdf }, ['🧾 Export PDF'])]));
        var zone = el('div');
        racine.appendChild(zone);
        function rendre() {
          zone.innerHTML = '';
          var liste = (cmdServeur || []).slice();
          // pièces sous seuil recalculées avec le stock à jour (y compris saisies en attente)
          var pieceDe = {};
          toutesPieces().forEach(function (p) { pieceDe[p.materiel + '|' + p.reference] = p; });
          liste = liste.filter(function (x) {
            if (x.origine !== 'seuil') return true;
            var p = pieceDe[x.materiel + '|' + x.reference];
            if (p) x.quantite = p.quantiteACommander;
            return !p || p.quantiteACommander > 0;
          });
          attente.forEach(function (a) {
            if (['stock.panier', 'stock.retirerPanier', 'stock.commande', 'stock.reception'].indexOf(a.type) < 0) return;
            var avant = liste.filter(function (x) { return x.materiel === a.materiel && x.reference === a.reference; })[0];
            liste = liste.filter(function (x) { return x !== avant; });
            if (a.type === 'stock.panier') liste.push({ origine: 'panier', statut: avant && avant.statut || '', materiel: a.materiel, reference: a.reference, designation: a.designation, casier: a.casier, quantite: a.quantite, fournisseur: avant && avant.fournisseur, dateCommande: avant && avant.dateCommande, enAttente: true });
            if (a.type === 'stock.commande') liste.push({ origine: 'panier', statut: 'Commandé', materiel: a.materiel, reference: a.reference, designation: a.designation, casier: a.casier, quantite: a.quantite, fournisseur: a.fournisseur, dateCommande: new Date(a.horodatage).toLocaleDateString('fr-FR'), enAttente: true });
          });
          listeCommande = liste;
          var aCmd = liste.filter(function (x) { return x.statut !== 'Commandé'; });
          var cmd = liste.filter(function (x) { return x.statut === 'Commandé'; });
          zone.appendChild(el('h3', { class: 'pp-h3' }, ['À commander (' + aCmd.length + ')']));
          zone.appendChild(aCmd.length ? tableau(['Pièce', 'Qté', ''], aCmd.map(ligneACommander), 'st-cmd') : el('p', { class: 'petit' }, ['Rien à commander pour le moment 🎉']));
          zone.appendChild(el('h3', { class: 'pp-h3', style: 'margin-top:16px' }, ['Commandé, en attente de réception (' + cmd.length + ')']));
          zone.appendChild(cmd.length ? tableau(['Pièce', 'Qté', ''], cmd.map(ligneCommandee), 'st-cmd') : el('p', { class: 'petit' }, ['Aucune commande en cours.']));
        }
        function descr(it) {
          return el('td', {}, [it.designation || it.reference,
            el('span', { class: 'st-badge ' + (it.origine === 'panier' ? 'st-partage' : 'st-alerte') }, [it.origine === 'panier' ? 'Panier' : 'Seuil']),
            it.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['à envoyer']) : null,
            el('div', { class: 'st-sous' }, [it.materiel + ' · réf. ' + (it.reference || '—') + (it.casier ? ' · casier ' + it.casier : '') +
              (it.statut === 'Commandé' ? ' · commandé le ' + (it.dateCommande || '?') + (it.fournisseur ? ' chez ' + it.fournisseur : '') : '')])]);
        }
        function voir(it) { return el('button', { class: 'pp-icone', type: 'button', title: 'Voir la pièce', onclick: function () {
          var p = pieces(it.materiel).filter(function (x) { return x.reference === it.reference; })[0];
          if (p) ouvrirFiche(p); else PM.toast('Pièce introuvable');
        } }, ['👁']); }
        function ligneACommander(it) {
          function changer(d) {
            var q = Math.max(0, (it.quantite || 0) + d);
            if (q === it.quantite || (q === 0 && it.origine !== 'panier')) return;
            saisir(q === 0 ? { type: 'stock.retirerPanier', materiel: it.materiel, reference: it.reference }
              : { type: 'stock.panier', materiel: it.materiel, reference: it.reference, designation: it.designation, casier: it.casier, quantite: q });
          }
          return el('tr', { class: it.enAttente ? 'attente' : '' }, [descr(it),
            el('td', {}, [el('div', { class: 'st-pm' }, [
              el('button', { type: 'button', 'aria-label': 'Moins', onclick: function () { changer(-1); } }, ['−']), el('b', {}, [String(it.quantite)]),
              el('button', { type: 'button', 'aria-label': 'Plus', onclick: function () { changer(1); } }, ['+'])])]),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'btn-second st-mini', type: 'button', title: 'Marquer comme commandé', onclick: function () { ouvrirCommande(it); } }, ['Commandé']),
              voir(it),
              it.origine === 'panier' ? el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer de la liste', onclick: function () { saisir({ type: 'stock.retirerPanier', materiel: it.materiel, reference: it.reference }); } }, ['🗑']) : null])]);
        }
        function ligneCommandee(it) {
          return el('tr', { class: it.enAttente ? 'attente' : '' }, [descr(it), el('td', {}, [el('b', {}, [String(it.quantite)])]),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'btn-principal st-mini', type: 'button', title: 'Commande reçue : ajouter au stock', onclick: function () { ouvrirReception(it); } }, ['Reçu']),
              voir(it),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Annuler la commande', onclick: function () {
                if (confirm('Annuler la commande de ' + (it.designation || it.reference) + ' ?')) saisir({ type: 'stock.retirerPanier', materiel: it.materiel, reference: it.reference });
              } }, ['🗑'])])]);
        }
        function ouvrirCommande(it) {
          if (!it.reference) { PM.toast('Pièce sans référence.'); return; }
          var q = el('input', { type: 'text', inputmode: 'numeric', value: String(it.quantite || 1) });
          var four = el('input', { type: 'text', placeholder: 'ex : Vogelsang, Wangen, Bauer…', value: PM.Prefs.get('stock_dernier_fournisseur', '') });
          var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
          var fermer = modale('Marquer comme commandé', (it.designation || it.reference) + ' — réf. ' + it.reference, [
            el('div', { class: 'pp-deux' }, [el('div', { class: 'champ' }, [el('label', {}, ['Quantité commandée']), q]), el('div', { class: 'champ' }, [el('label', {}, ['Fournisseur (facultatif)']), four])]), msg,
            el('button', { class: 'btn-principal', type: 'button', onclick: function () {
              var n = entier(q.value, 1);
              if (isNaN(n)) { msg.textContent = 'Quantité : nombre entier (1 ou plus).'; msg.hidden = false; return; }
              PM.Prefs.set('stock_dernier_fournisseur', four.value.trim());
              fermer(); saisir({ type: 'stock.commande', materiel: it.materiel, reference: it.reference, designation: it.designation, casier: it.casier, quantite: n, fournisseur: four.value.trim() });
            } }, ['Commandé'])]);
        }
        function ouvrirReception(it) {
          var q = el('input', { type: 'text', inputmode: 'numeric', value: String(it.quantite || 1) });
          var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
          var p = pieces(it.materiel).filter(function (x) { return x.reference === it.reference; })[0];
          var fermer = modale('Commande reçue', (it.designation || it.reference) + (p ? ' — stock actuel : ' + p.quantiteStock : ''), [
            el('div', { class: 'champ' }, [el('label', {}, ['Quantité reçue (ajoutée au stock)']), q]), msg,
            el('button', { class: 'btn-principal', type: 'button', onclick: function () {
              var n = entier(q.value, 1);
              if (isNaN(n)) { msg.textContent = 'Quantité : nombre entier (1 ou plus).'; msg.hidden = false; return; }
              fermer(); saisir({ type: 'stock.reception', materiel: it.materiel, reference: it.reference, designation: it.designation, rowIndex: p && p.rowIndex, quantite: n, fournisseur: it.fournisseur || '' });
              PM.toast('Reçu : +' + n + ' en stock');
            } }, ['Ajouter au stock'])]);
        }
        var cacheCmd = 'stock_commander_' + S;
        PM.DB.get(cacheCmd).then(function (c) { if (cmdServeur === null) { cmdServeur = c || []; if (ecran === 'commander') rendre(); } });
        if (!modeDemo) api('stock.commander', {}, 60000).then(function (j) {
          cmdServeur = j.liste || []; PM.DB.set(cacheCmd, cmdServeur);
          if (ecran === 'commander' && actif() && !document.querySelector('.ag-modale')) rendre();
        })['catch'](function () { PM.toast('Hors ligne : commandes du dernier chargement'); });
        else if (cmdServeur === null) { cmdServeur = toutesPieces().filter(function (p) { return p.quantiteACommander > 0; }).map(function (p) { return { origine: 'seuil', statut: '', materiel: p.materiel, reference: p.reference, designation: p.designation, casier: p.casier, quantite: p.quantiteACommander }; }); }
        if (cmdServeur !== null) rendre();
      }
      function exporterPdf() {
        var liste = (listeCommande || []).filter(function (x) { return x.statut !== 'Commandé'; });
        if (!liste.length) { PM.toast('Rien à exporter pour le moment.'); return; }
        var charge = window.jspdf ? Promise.resolve() : new Promise(function (ok, ko) {
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = ok; s.onerror = ko; document.head.appendChild(s);
        });
        charge.then(function () {
          var doc = new window.jspdf.jsPDF(), y = 18;
          doc.setFontSize(14); doc.text('A commander - Pieces detachees - ' + (T.site || ctx.site.nom), 14, y); y += 8;
          doc.setFontSize(10); doc.text(new Date().toLocaleDateString('fr-FR'), 14, y); y += 10;
          var x = [14, 55, 112, 165, 185];
          doc.setFontSize(9); doc.setFont(undefined, 'bold');
          ['Reference', 'Piece', 'Materiel', 'Casier', 'Qte'].forEach(function (c, i) { doc.text(c, x[i], y); });
          doc.setFont(undefined, 'normal'); y += 4; doc.setLineWidth(0.2); doc.line(14, y, 196, y); y += 6;
          liste.forEach(function (it) {
            if (y > 280) { doc.addPage(); y = 18; }
            doc.text(String(it.reference || '-'), x[0], y);
            doc.text(String(it.designation || '-').substring(0, 24), x[1], y);
            doc.text(String(it.materiel || '').substring(0, 22), x[2], y);
            doc.text(String(it.casier || '-'), x[3], y);
            doc.text(String(it.quantite), x[4], y);
            y += 6;
          });
          doc.save('a-commander-' + new Date().toISOString().slice(0, 10) + '.pdf');
        })['catch'](function () { PM.toast('La bibliothèque PDF n’a pas pu se charger. Vérifie ta connexion.'); });
      }

      /* ---------- recherche sur tous les sites (serveur) ---------- */
      var minuteur = null;
      function ecranRecherche(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Recherche sur tous les sites']));
        racine.appendChild(el('p', { class: 'petit' }, ['Référence actuelle ou ancienne, ou désignation. Les pièces de l’autre site s’ouvrent dans son propre outil.']));
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand', placeholder: 'Tape une référence…', value: recherche, autocomplete: 'off' });
        var zone = el('div');
        racine.appendChild(champ); racine.appendChild(zone);
        function lancer() {
          var t = champ.value.trim(); recherche = t;
          zone.innerHTML = '';
          if (t.length < 2) { zone.appendChild(el('p', { class: 'petit' }, ['Tape au moins 2 caractères.'])); return; }
          zone.appendChild(el('p', { class: 'petit' }, ['Recherche…']));
          clearTimeout(minuteur);
          minuteur = setTimeout(function () {
            (modeDemo ? Promise.resolve({ resultats: [] }) : api('stock.recherche', { terme: t }, 60000)).then(function (j) {
              if (champ.value.trim() !== t) return;
              zone.innerHTML = '';
              var r = j.resultats || [];
              if (!r.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Aucune pièce trouvée pour « ' + t + ' ».'])); return; }
              zone.appendChild(tableau(['Référence', 'Pièce', 'Site / matériel', 'Stock'], r.map(function (x) {
                var autreOutil = !x.ceSite && OUTIL_DU_SITE[x.siteId];
                return el('tr', { class: (x.stockBas ? 'st-bas ' : '') + 'st-clic', onclick: function () {
                  if (x.ceSite) { var p = pieces(x.materiel).filter(function (pp) { return pp.reference === x.reference; })[0]; if (p) ouvrirFiche(p); else aller('pieces', x.materiel); }
                  else if (autreOutil) location.hash = 'outil/' + autreOutil + '/' + encodeURIComponent(x.materiel) + '/' + encodeURIComponent(x.reference || '');
                } }, [
                  el('td', { class: 'st-ref' }, [x.reference || '—', x.ancienneReference ? el('div', { class: 'st-sous' }, ['anc. ' + x.ancienneReference]) : null]),
                  el('td', {}, [x.designation, x.casier ? el('div', { class: 'st-sous' }, ['Casier ' + x.casier]) : null]),
                  el('td', {}, [x.site, el('div', { class: 'st-sous' }, [x.materiel])]),
                  el('td', {}, [String(x.quantiteStock)])]);
              })));
            })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('p', { class: 'bg-erreur' }, [e.message])); });
          }, 300);
        }
        champ.addEventListener('input', lancer);
        setTimeout(function () { champ.focus(); }, 30);
        if (recherche) lancer();
      }

      /* ---------- historique du site ---------- */
      function ecranHistorique(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Historique']));
        racine.appendChild(el('p', { class: 'petit' }, ['50 derniers mouvements de ce site.']));
        var zone = el('div', {}, [el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])]);
        racine.appendChild(zone);
        (modeDemo ? Promise.resolve({ lignes: [] }) : api('stock.historique', { limite: 50 }, 45000)).then(function (j) {
          zone.innerHTML = '';
          var l = j.lignes || [];
          if (!l.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Aucun mouvement enregistré.'])); return; }
          zone.appendChild(tableau(['Date', 'Pièce', 'Mvt', 'Qté'], l.map(function (x) {
            return el('tr', {}, [
              el('td', { class: 'date-cell' }, [x.date, el('div', { class: 'st-sous' }, [String(x.utilisateur)])]),
              el('td', {}, [String(x.designation || x.reference), el('div', { class: 'st-sous' }, [x.materiel + (x.reference ? ' · ' + x.reference : '')]),
                x.motif ? el('div', { class: 'st-motif' }, [String(x.motif)]) : null]),
              el('td', { class: x.delta < 0 ? 'st-moins' : 'st-plus' }, [(x.delta > 0 ? '+' : '') + x.delta]),
              el('td', {}, [String(x.nouvelleQuantite)])]);
          })));
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Historique indisponible : ' + e.message])); });
      }

      /* ---------- stock commun ---------- */
      function ecranCommunes(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Stock commun']));
        racine.appendChild(el('p', { class: 'petit' }, ['Références retrouvées sur plusieurs sites ou matériels — une seule quantité et un seul seuil, partagés automatiquement.']));
        var zone = el('div', {}, [el('p', { class: 'petit' }, ['Recherche sur tous les sites… (quelques secondes)'])]);
        racine.appendChild(zone);
        (modeDemo ? Promise.resolve({ liste: [] }) : api('stock.communes', {}, 90000)).then(function (j) {
          zone.innerHTML = '';
          var l = j.liste || [];
          if (!l.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Aucune référence retrouvée à plusieurs endroits pour l’instant.'])); return; }
          l.forEach(function (x) {
            zone.appendChild(el('div', { class: 'bandeau st-commune' }, [
              el('b', {}, [x.designation || x.reference]),
              el('div', { class: 'st-sous' }, ['Réf. ' + x.reference + ' — stock partagé actuel : ' + x.quantitePartagee]),
              el('div', { class: 'st-emplacements' }, x.emplacements.map(function (e) {
                return el('div', { class: 'st-emplacement' }, [e.site + ' — ' + e.materiel + ' (' + (e.casier ? 'casier ' + e.casier : 'casier non renseigné') + ')']);
              }))]));
          });
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Indisponible : ' + e.message])); });
      }

      /* ---------- contrôle des données (rapport, ne modifie rien) ---------- */
      function ecranControle(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Contrôle des données']));
        racine.appendChild(el('p', { class: 'petit' }, ['Liste ce qui mérite un nettoyage dans les Google Sheets des deux sites. Rien n’est modifié ici : corrige directement dans le classeur indiqué (ligne donnée).']));
        var zone = el('div', {}, [el('p', { class: 'petit' }, ['Analyse des deux sites… (quelques secondes)'])]);
        racine.appendChild(zone);
        (modeDemo ? Promise.resolve({ rapport: { doublons: [], tests: [], lignesVides: [], photosTexte: [], communDoublons: [], communOrphelins: [], colonnes: [], ecarts: [] } })
          : api('stock.controle', {}, 120000)).then(function (j) {
          var r = j.rapport || {};
          zone.innerHTML = '';
          var total = 0;
          function bloc(titre, aide, liste, texte) {
            total += liste.length;
            var d = el('details', { class: 'bandeau st-controle' + (liste.length ? '' : ' st-ok-bloc') }, [
              el('summary', {}, [el('b', {}, [(liste.length ? '⚠ ' : '✓ ') + titre]), el('span', { class: 'st-badge ' + (liste.length ? 'st-alerte' : 'st-envoi') }, [String(liste.length)])]),
              el('p', { class: 'petit' }, [aide])]);
            liste.slice(0, 200).forEach(function (x) { d.appendChild(el('div', { class: 'st-emplacement' }, [texte(x)])); });
            zone.appendChild(d);
          }
          bloc('Écarts entre une ligne et le stock commun', 'La quantité écrite sur la ligne ne correspond pas à la quantité partagée (Stock_Commun). Le bouton ci-dessous les remet d’accord.', r.ecarts || [],
            function (x) { return x.ou + ', ligne ' + x.ligne + ' : ' + (x.designation || x.reference) + ' — ligne ' + x.ligneQte + ', stock commun ' + x.commun; });
          bloc('Références en double dans un même matériel', 'Deux lignes avec la même référence dans le même onglet : elles partagent la même quantité, une seule suffit.', r.doublons || [],
            function (x) { return x.ou + ', lignes ' + x.autreLigne + ' et ' + x.ligne + ' : ' + x.reference + ' (' + x.designation + ')'; });
          bloc('Références de test', 'Lignes dont la référence ou la désignation commence par « test ».', r.tests || [],
            function (x) { return x.ou + ', ligne ' + x.ligne + ' : ' + (x.reference || '') + ' ' + (x.designation || ''); });
          bloc('Lignes sans désignation ni référence', 'Lignes qui contiennent autre chose (souvent « Voir photo ») mais pas de pièce : à vider.', r.lignesVides || [],
            function (x) { return x.ou + ', ligne ' + x.ligne; });
          bloc('Photos sans vraie image', 'La colonne Photo contient un texte (« Voir photo »…) au lieu d’un lien : ouvre la fiche de la pièce et prends la photo.', r.photosTexte || [],
            function (x) { return x.ou + ', ligne ' + x.ligne + ' : ' + x.designation + ' (« ' + x.texte + ' »)'; });
          bloc('Doublons dans Stock_Commun', 'Même référence sur deux lignes de l’onglet Stock_Commun du classeur Appli Stock Metha : garde la bonne quantité sur une seule ligne.', r.communDoublons || [],
            function (x) { return x.reference + ' (' + x.designation + ') — lignes ' + x.lignes.join(' et '); });
          bloc('Références du stock commun utilisées nulle part', 'Lignes de Stock_Commun dont la référence n’existe plus dans aucun listing.', r.communOrphelins || [],
            function (x) { return x.reference + ' (' + x.designation + ') — ligne ' + x.ligne; });
          bloc('Colonnes inconnues', 'Colonnes que l’appli n’utilise pas (ex. « Column 1 », prix…) : à renommer ou supprimer si inutiles.', r.colonnes || [],
            function (x) { return x.ou + ', colonne ' + x.colonne + ' : « ' + x.titre + ' »'; });
          if ((r.ecarts || []).length) zone.appendChild(el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            if (!confirm('Recopier la quantité du stock commun sur toutes les lignes concernées des deux listings ?')) return;
            saisir({ type: 'stock.synchroniser' }); PM.toast('Alignement demandé : il part avec les autres saisies.');
          } }, ['Aligner les quantités sur le stock commun']));
          if (!total) zone.insertBefore(el('div', { class: 'vide-msg' }, ['Tout est propre 👍']), zone.firstChild);
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Contrôle indisponible : ' + e.message])); });
      }

      /* ---------- QR codes (fabriqués sur le téléphone) ---------- */
      function lienFiche(p) {
        var base = location.origin + location.pathname.replace(/index\.html$/, '');
        return base + '#outil/' + ctx.outil.id + '/' + encodeURIComponent(p.materiel || materiel) + '/' + encodeURIComponent(p.reference);
      }
      function imprimerQr(liste, titre) {
        liste = liste.filter(function (p) { return p.reference; });
        if (!liste.length) { PM.toast('Aucune pièce avec référence à imprimer.'); return; }
        var w = window.open('', '_blank');
        if (!w) { PM.toast('Le navigateur a bloqué la fenêtre d’impression.'); return; }
        var d = w.document;
        d.open(); d.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title></title><style>' +
          'body{font-family:Arial,Helvetica,sans-serif;margin:20px;color:#1c2624}h1{font-size:16px;margin-bottom:16px}' +
          '.grille{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.carte-qr{border:1px solid #ccc;border-radius:8px;padding:10px;text-align:center;break-inside:avoid;page-break-inside:avoid}' +
          '.carte-qr img{width:200px;max-width:100%;height:auto;image-rendering:pixelated}.qr-ref{font-weight:700;margin-top:6px;font-size:13px}.qr-designation{font-size:12px;margin-top:2px}.qr-casier{font-size:11px;color:#5f6b68;margin-top:2px}' +
          '@media print{@page{margin:12mm}}</style></head><body><h1></h1><div class="grille"></div></body></html>');
        d.close();
        d.title = titre; d.querySelector('h1').textContent = titre;
        var g = d.querySelector('.grille');
        liste.forEach(function (p) {
          var c = d.createElement('div'); c.className = 'carte-qr';
          var img = d.createElement('img'); img.src = qrDataUrl(lienFiche(p), 240); img.alt = 'QR code'; c.appendChild(img);
          [['qr-ref', p.reference], ['qr-designation', p.designation], ['qr-casier', p.casier ? 'Casier : ' + p.casier : '']].forEach(function (t) {
            if (!t[1]) return; var e = d.createElement('div'); e.className = t[0]; e.textContent = t[1]; c.appendChild(e);
          });
          g.appendChild(c);
        });
        setTimeout(function () { try { w.print(); } catch (e) {} }, 500);
      }

      /* ---------- scan d'un QR code ---------- */
      // QR du portail ET anciens QR de l'appli d'origine (?site=site1&materiel=…&reference=…)
      function ouvrirLienScanne(texte) {
        var t = String(texte || '').trim(), cible = null;
        var h = t.indexOf('#outil/');
        if (h >= 0) cible = t.slice(h + 1);
        else {
          var m;
          try { m = new URL(t); } catch (e) { m = null; }
          if (m && m.searchParams.get('materiel')) cible = 'outil/' + (OUTIL_DU_SITE[m.searchParams.get('site')] || ctx.outil.id) + '/' +
            encodeURIComponent(m.searchParams.get('materiel')) + '/' + encodeURIComponent(m.searchParams.get('reference') || '');
        }
        if (!cible) { PM.toast('QR code non reconnu : ' + t.slice(0, 60)); return; }
        if (location.hash === '#' + cible) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash = cible;
      }
      function scanner() {
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
          var u = T && lienSur(T.urlScanner);
          if (u) { window.open(u, '_blank'); return; }
          PM.toast('Le scan n’est pas disponible sur ce téléphone.');
          return;
        }
        var detecteur;
        try { detecteur = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { PM.toast('Le scan n’est pas disponible sur ce téléphone.'); return; }
        var video = el('video', { playsinline: 'playsinline', muted: 'muted', class: 'st-video' });
        var info = el('p', { class: 'petit', style: 'text-align:center' }, ['Vise le QR code collé sur le casier.']);
        var flux = null, fini = false;
        var fermerM = modale('Scanner un QR code', '', [el('div', { class: 'st-scan' }, [video, el('div', { class: 'st-cadre' })]), info]);
        function stop() { fini = true; if (flux) flux.getTracks().forEach(function (tr) { tr.stop(); }); }
        var obs = setInterval(function () { if (!document.body.contains(video)) { clearInterval(obs); stop(); } }, 500);
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
          flux = s; video.srcObject = s; video.muted = true; return video.play();
        }).then(function boucle() {
          if (fini) return;
          detecteur.detect(video).then(function (codes) {
            if (fini) return;
            if (codes && codes.length) {
              if (navigator.vibrate) navigator.vibrate(60);
              stop(); fermerM();
              document.querySelectorAll('.ag-modale').forEach(function (m) { m.remove(); });
              ouvrirLienScanne(codes[0].rawValue); return;
            }
            setTimeout(boucle, 200);
          })['catch'](function () { setTimeout(boucle, 400); });
        })['catch'](function (e) { info.textContent = 'Caméra indisponible : ' + (e && e.message || e); });
      }

      function pleinEcran(u) {
        var src = urlPhoto(u);
        if (!src) return;
        var fond = el('div', { class: 'ag-modale st-plein', role: 'dialog', onclick: function () { fond.remove(); } }, [el('img', { src: src, alt: 'Photo de la pièce' })]);
        document.body.appendChild(fond);
      }
    }
  };

  /* ===================================================================
     Sortie de stock proposée après une intervention (Suivi des pompes)
     opts = { siteId, apiUrl, cle, equipement, typeId, pieces:[libellés], date, agent }
     =================================================================== */
  var MOTS_TYPE = { wangen: ['wangen'], cc: ['pompe cc', ' cc'], lobes: ['lobe'], broyeur: ['broyeur'], separateur: ['separateur', 'bauer'] };
  window.STOCK_SORTIE = function (opts) {
    if (!opts || !opts.apiUrl || !(opts.pieces || []).length) return;
    var K = cles(opts.siteId);
    Promise.all([PM.DB.get(K.tout), PM.DB.get(K.attente)]).then(function (r) {
      if (r[0]) return [r[0], r[1]];
      return PM.Api.appeler(opts.apiUrl, { action: 'stock.tout', cle: opts.cle }, 60000).then(function (j) { delete j.ok; PM.DB.set(K.tout, j); return [j, r[1]]; });
    }).then(function (r) {
      var mats = etatTout(r[0], r[1] || []).filter(function (m) { return m.pieces.length; });
      if (!mats.length) return;
      var nomEq = norm(opts.equipement), mots = MOTS_TYPE[opts.typeId] || [];
      function score(m) {
        var n = ' ' + norm(m.nom) + ' ', s = 0;
        if (n.trim() === nomEq) s += 10;
        if (nomEq && (n.indexOf(nomEq) >= 0 || nomEq.indexOf(n.trim()) >= 0)) s += 5;
        mots.forEach(function (w) { if (n.indexOf(w) >= 0) s += 3; });
        return s;
      }
      var meilleur = mats.slice().sort(function (a, b) { return score(b) - score(a); })[0];
      if (score(meilleur) === 0) meilleur = null;
      var libelles = (opts.pieces || []).map(function (l) { return norm(l).replace(/x$|s$/, ''); });
      var choix = el('select', { class: 'st-select' }, [el('option', { value: '' }, ['Choisir le matériel du stock…'])].concat(mats.map(function (m) { return el('option', { value: m.nom }, [m.nom]); })));
      if (meilleur) choix.value = meilleur.nom;
      var zone = el('div', { class: 'st-sortie' });
      var lignes = [];
      function remplir() {
        zone.innerHTML = ''; lignes = [];
        var m = mats.filter(function (x) { return x.nom === choix.value; })[0];
        if (!m) return;
        m.pieces.forEach(function (p) {
          var d = norm(p.designation);
          var coche = libelles.some(function (l) { return l && d.indexOf(l) >= 0; });
          var cb = el('input', { type: 'checkbox' });
          cb.checked = coche;
          var q = el('input', { type: 'text', inputmode: 'numeric', value: '1', class: 'st-compte', 'aria-label': 'Quantité' });
          lignes.push({ p: p, cb: cb, q: q });
          zone.appendChild(el('label', { class: 'st-sortie-ligne' + (coche ? ' coche' : '') }, [cb,
            el('span', { class: 'st-sortie-nom' }, [p.designation, el('div', { class: 'st-sous' }, [(p.reference || 'sans réf.') + ' · stock ' + p.quantiteStock + (p.casier ? ' · casier ' + p.casier : '')])]), q]));
          cb.addEventListener('change', function () { cb.parentNode.classList.toggle('coche', cb.checked); });
        });
      }
      choix.addEventListener('change', remplir);
      var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
      var fermer = modale('Sortir les pièces du stock ?', 'Intervention sur ' + opts.equipement + ' : coche les pièces prises au magasin.', [choix, zone, msg,
        el('button', { class: 'btn-principal', type: 'button', onclick: function () {
          var choisies = lignes.filter(function (l) { return l.cb.checked; });
          if (!choisies.length) { fermer(); return; }
          var erreurs = choisies.filter(function (l) { var n = entier(l.q.value, 1); return isNaN(n) || n > l.p.quantiteStock; });
          if (erreurs.length) { msg.textContent = 'Quantité invalide ou supérieure au stock pour : ' + erreurs.map(function (l) { return l.p.designation; }).join(', '); msg.hidden = false; return; }
          var agent = opts.agent || PM.Prefs.get('agent', '') || 'Portail';
          var suite = Promise.resolve();
          choisies.forEach(function (l) {
            var payload = { id: PM.uid(), type: 'stock.quantite', materiel: l.p.materiel, rowIndex: l.p.rowIndex, reference: l.p.reference, designation: l.p.designation,
              delta: -entier(l.q.value, 1), motif: 'Intervention ' + opts.equipement + (opts.date ? ' du ' + opts.date.split('-').reverse().join('/') : ''), agent: agent, horodatage: new Date().toISOString() };
            suite = suite.then(function () { return ajouterAttente(opts.siteId, payload, false); });
          });
          suite.then(function () { PM.toast(choisies.length + ' pièce(s) sortie(s) du stock'); });
          fermer();
        } }, ['Sortir du stock']),
        el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { fermer(); } }, ['Pas maintenant'])]);
      remplir();
    })['catch'](function () { /* stock indisponible : pas de proposition */ });
  };
})();
