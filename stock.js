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
  // Clé de partage (même règle que le serveur, stCleCommune_) : NON = jamais partagée ; sans référence = jamais partagée.
  // La référence est le SEUL lien entre deux lignes (choix d'Alex 16/10).
  function cleCommune(p) {
    if (p.commun === false) return '';
    return String(p.reference || '').trim();
  }
  // Commandes : référence « 00123 » = 123 (Sheets a pu la transformer en nombre) ; sans référence : matériel + désignation
  function refNorm(r) { r = String(r === null || r === undefined ? '' : r).trim(); return /^\d+$/.test(r) ? (r.replace(/^0+/, '') || '0') : r; }
  function cleCmd(x) { return x.materiel + '|' + (String(x.reference || '').trim() ? 'r:' + refNorm(x.reference) : 'd:' + String(x.designation || '').trim()); }
  var TYPES_CMD = ['stock.panier', 'stock.retirerPanier', 'stock.commande', 'stock.reception'];
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function lienSur(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  // les liens « uc?export=view » de Drive s'affichent mal : on passe par la miniature Drive
  // plusieurs photos par pièce : un lien par ligne dans la cellule Photo
  function liensPhotos(u) { return String(u || '').split(/\s*[\n|]\s*/).filter(function (x) { return /^data:image\//.test(x) || lienSur(x); }); }
  function urlPhoto(u) {
    u = liensPhotos(u)[0] || '';
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
  function casiersParDefaut() {
    var l = [];
    for (var c = 0; c < 26; c++) for (var n = 0; n <= 3; n++) l.push('Casier ' + String.fromCharCode(65 + c) + n);
    return l;
  }
  // « Casier 3 G » / « Tiroir C10 / 1 » -> { type, code } ; sans préfixe -> type inconnu
  // Repère écrit toujours de la même façon : majuscules, sans espace, « / » et « - » -> « - »
  // (« 3 G » = « 3G », « C10 / 1 » = « C10-1 », « B1/ 2 » = « B1-2 ») : impossible de créer deux fois le même rangement.
  function canonCode(c) {
    return String(c || '').toUpperCase().replace(/Ø/g, '0').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*[\/\-_.]\s*/g, '-').replace(/\s+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  // lettre O et chiffre 0 : confondus pour chercher et comparer (« AO » trouve A0, « 00 » trouve O0),
  // et le zéro s'affiche barré « Ø » pour qu'on ne lise jamais un O à la place
  function plie(code) { return String(code || '').replace(/O/g, '0'); }
  function affiche(code) { return String(code || '').replace(/0/g, 'Ø'); }
  // Casier = LETTRE (colonne, de gauche à droite) puis CHIFFRE (étage 0 à 3, du bas vers le haut) :
  // « 0F » s'écrit « F0 », « 3J-K-L » s'écrit « J3-K3-L3 »
  function casierCode(code) {
    var m = /^(\d)([A-Z]+(?:-[A-Z]+)*)$/.exec(code);
    return m ? m[2].split('-').map(function (l) { return l + m[1]; }).join('-') : code;
  }
  var CASIER_OK = /^[A-Z]{1,2}[0-3](?:-[A-Z]{1,2}[0-3])*$/;
  function rangement(lib) {
    var m = /^\s*(casier|tiroir|armoire)\b\s*(.*)$/i.exec(String(lib || ''));
    if (!m) return { type: '', code: canonCode(lib) };
    var type = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(), code = canonCode(m[2]);
    return { type: type, code: type === 'Casier' ? casierCode(code) : code };
  }
  function libelle(type, code) { code = canonCode(code); if (type === 'Casier') code = casierCode(code); return code ? (type ? type + ' ' + code : code) : ''; }
  // ancienne liste (A1…) : ce sont des casiers
  function libelleRangement(lib) { var r = rangement(lib); return libelle(r.type || 'Casier', r.code); }
  function rangementTexte(lib) {
    var r = rangement(lib);
    return r.type === 'Casier' ? '🗄 Casier ' + affiche(r.code) : r.type === 'Tiroir' ? '🗃 Tiroir ' + affiche(r.code) : r.type === 'Armoire' ? '🚪 Armoire ' + affiche(r.code) : String(lib || '');
  }
  // clé de comparaison : type + repère normalisé
  function casierNorm(c) { if (!String(c || '').trim()) return ''; var r = rangement(c); return r.type + '|' + plie(r.code); }
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
      if (a.type === 'stock.transferer' && a.mode === 'deplacer') a = Object.assign({}, a, { type: 'stock.supprimerPiece' });
      if (a.type === 'stock.supprimerPiece') {
        var idxS = -1;
        m.pieces.forEach(function (p, i) { if (idxS < 0 && ((a.rowIndex && p.rowIndex === a.rowIndex && cle(p) === cle(a)) || (!a.rowIndex && cle(p) === cle(a)))) idxS = i; });
        if (idxS < 0) m.pieces.forEach(function (p, i) { if (idxS < 0 && cle(p) === cle(a)) idxS = i; });
        if (idxS >= 0) m.pieces.splice(idxS, 1);
        return;
      }
      if (TYPES_PIECE.indexOf(a.type) < 0) return;
      var cible = m.pieces.filter(function (p) { return a.rowIndex && p.rowIndex === a.rowIndex && cle(p) === cle(a); })[0]
        || m.pieces.filter(function (p) { return cle(p) === cle(a); })[0];
      if (!cible) return;
      // quantité / seuil : toutes les lignes qui partagent le stock (même règle que le serveur ; une pièce NON ne touche qu'elle-même)
      var memeRef = [cible], kc = cleCommune(cible);
      if (kc) {
        memeRef = [];
        mats.forEach(function (mm) { mm.pieces.forEach(function (p) { if (p === cible || cleCommune(p) === kc) memeRef.push(p); }); });
      }
      if (a.type === 'stock.quantite') memeRef.forEach(function (p) { p.quantiteStock = a.absolu ? Math.max(0, a.compte) : Math.max(0, p.quantiteStock + a.delta); });
      else if (a.type === 'stock.reception') memeRef.forEach(function (p) { p.quantiteStock += a.quantite; });
      else if (a.type === 'stock.seuil') memeRef.forEach(function (p) { p.seuil = a.seuil; });
      else if (a.type === 'stock.casier') cible.casier = a.casier;
      else if (a.type === 'stock.designation') cible.designation = a.nouvelle;
      else if (a.type === 'stock.reference') { cible.reference = a.nouvelle; cible.partage = false; }
      else if (a.type === 'stock.photo') cible.photo = (a.ajout ? liensPhotos(cible.photo) : []).concat([a.photo]).join('\n');
      else if (a.type === 'stock.retirerPhoto') cible.photo = a.lien ? liensPhotos(cible.photo).filter(function (x) { return x !== a.lien; }).join('\n') : '';
      cible.enAttente = true;
    });
    mats.forEach(function (m) {
      m.pieces.forEach(function (p) { p.materiel = m.nom; p.quantiteACommander = Math.max((p.seuil || 0) - p.quantiteStock, 0); p.stockBas = (p.seuil || 0) > 0 && p.quantiteStock <= p.seuil; }); // seuil 0 = pas de seuil
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
    for (var c = 0; c < 26; c++) for (var n = 0; n <= 3; n++) casiers.push('Casier ' + String.fromCharCode(65 + c) + n);
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
      // Panier / commandes : lignes de l'onglet Commandes lues sur le serveur (cmdLu = heure où la lecture est PARTIE).
      // Une saisie confirmée APRÈS ce moment reste appliquée par-dessus (cmdConfirmes) : une lecture un peu
      // ancienne ne peut plus faire disparaître une pièce qu'on vient d'ajouter au panier.
      var cmdServeur = null, cmdLu = 0, cmdConfirmes = [];
      var ecran = 'materiels', materiel = null, filtre = '', recherche = '';
      var casierChoisi = null, invPortee = null, invFaits = {}, photoMode = 'avec', photoFiltre = '';
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
        if (T && Array.isArray(T.commandes)) cmdServeur = T.commandes;
        if (params[0]) { ecran = 'pieces'; materiel = params[0]; }
        if (T) { afficher(); ouvrirLien(); }
        if (!modeDemo) charger(!T);
      });
      // Retour sur l'appli après plus de 5 min en arrière-plan : stock rafraîchi en douceur
      var cacheDepuis = 0;
      window.__stVisibilite && document.removeEventListener('visibilitychange', window.__stVisibilite);
      window.__stVisibilite = function () {
        if (document.hidden) { cacheDepuis = Date.now(); return; }
        if (actif() && !modeDemo && cacheDepuis && Date.now() - cacheDepuis > 5 * 60000) { cacheDepuis = 0; rechargerPlusTard(); }
      };
      document.addEventListener('visibilitychange', window.__stVisibilite);
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
        dernierChargement = Date.now();
        var depart = Date.now();
        return api('stock.tout', {}, 90000).then(function (j) {
          delete j.ok;
          // Sécurité : un matériel que le serveur n'a pas pu relire (ou une réponse vide) ne doit
          // jamais effacer les pièces déjà connues sur ce téléphone.
          var ancien = T && T.materiels ? T : null, garde = 0;
          if (ancien && (!j.materiels || !j.materiels.length) && ancien.materiels.length) { j.materiels = ancien.materiels; garde++; }
          (j.materiels || []).forEach(function (m) {
            if (!m.erreur || !ancien) return;
            var a = ancien.materiels.filter(function (x) { return x.nom === m.nom; })[0];
            if (a && a.pieces && a.pieces.length) { m.pieces = a.pieces; garde++; }
          });
          if (garde) PM.toast('Une partie du stock n’a pas pu être relue : dernière version gardée.', 4000);
          T = j; PM.DB.set(K.tout, j);
          if (Array.isArray(j.commandes)) { cmdServeur = j.commandes; cmdLu = depart; PM.DB.set('stock_commander_' + S, cmdServeur); }
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
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : stock du dernier chargement', 4000);
        });
      }
      // toutes les saisies parties -> on recharge (quantités partagées à jour), mais :
      // - pas pendant l'inventaire (l'écran ne bouge pas sous les doigts) : rechargé en sortant ;
      // - au plus une fois par minute (le serveur n'est pas noyé de rechargements complets).
      var dernierChargement = 0, rechargePrevue = null, rechargeEnAttente = false;
      function rechargerPlusTard() {
        if (!actif() || modeDemo) return;
        if (ecran === 'inventaire') { rechargeEnAttente = true; return; }
        var reste = 60000 - (Date.now() - dernierChargement);
        if (reste <= 0) { rechargeEnAttente = false; charger(false); return; }
        if (!rechargePrevue) rechargePrevue = setTimeout(function () { rechargePrevue = null; rechargerPlusTard(); }, reste);
      }
      PM.Envoi.surChangement(function (n) {
        if (!actif() || n || !attente.length || modeDemo) return;
        rechargerPlusTard();
      });
      // Retire de « attente » les saisies que la file a VRAIMENT envoyées (ou que le serveur a refusées).
      // Avant : une saisie toute neuve, pas encore arrivée dans la file (ajout en cours), était retirée aussi
      // -> la pièce disparaissait de l'écran (ex. panier) jusqu'au rechargement suivant.
      function nettoyerAttente() {
        return Promise.all([PM.DB.listerEnvois(), PM.DB.get(K.attente)]).then(function (r) {
          var ids = (r[0] || []).filter(function (x) { return !x.rejete; }).map(function (x) { return x.payload && x.payload.id; });
          var liste = (r[1] || []).slice(), vus = {};
          liste.forEach(function (a) { vus[a.id] = true; });
          attente.forEach(function (a) { if (!vus[a.id]) liste.push(a); }); // saisies de cet écran pas encore copiées sur le téléphone
          var maintenant = Date.now(), parties = [];
          attente = liste.filter(function (a) {
            if (ids.indexOf(a.id) >= 0) return true;
            if (!a.enFile && maintenant - (Date.parse(a.horodatage) || 0) < 120000) return true; // ajout dans la file en cours
            parties.push(a); return false;
          });
          parties.forEach(function (a) { if (TYPES_CMD.indexOf(a.type) >= 0) cmdConfirmes.push({ t: maintenant, a: a }); });
          cmdConfirmes = cmdConfirmes.filter(function (c) { return c.t > cmdLu; });
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
          cmdServeur = lignesCmd().map(function (x) { delete x.enAttente; return x; }); // démo : le panier est gardé en mémoire
          attente = [];
        } else {
          PM.DB.set(K.attente, attente);
          PM.Envoi.ajouter(S, payload, avecPhoto).then(function () { payload.enFile = true; PM.DB.set(K.attente, attente); }, function () {});
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
      // empreinte : rangement + côtes vus ici ; le serveur s'en sert pour départager deux lignes identiques
      function refPiece(p) { return { materiel: p.materiel, rowIndex: p.rowIndex, reference: p.reference, designation: p.designation, empreinte: { casier: p.casier || '', cotes: p.cotes || '' } }; }

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
        ({ pieces: ecranPieces, casiers: ecranCasiers, inventaire: ecranInventaire, noncomptees: ecranNonComptees, commander: ecranCommander, recherche: ecranRecherche,
          historique: ecranHistorique, communes: ecranCommunes, controle: ecranControle, photos: ecranPhotos }[ecran] || ecranMateriels)(racine);
        window.scrollTo(0, y);
      }
      function aller(e, m) {
        var sortieInventaire = ecran === 'inventaire' && e !== 'inventaire';
        ecran = e; if (m !== undefined) materiel = m; filtre = ''; afficher(); window.scrollTo(0, 0);
        if (sortieInventaire && rechargeEnAttente) rechargerPlusTard();
      }

      function barreOutils() {
        function b(txt, titre, fn, actifSi) {
          return el('button', { class: 'st-outil' + (actifSi ? ' actif' : ''), type: 'button', title: titre, 'aria-label': titre, onclick: fn }, [txt]);
        }
        // 🛒 = pièces choisies au panier ; ⚠ = pièces sous le seuil mini (pas encore au panier)
        var nb = compteurs(), txtCmd = (nb.panier || nb.seuil) ? ' ' + [nb.panier ? '🛒 ' + nb.panier : '', nb.seuil ? '⚠ ' + nb.seuil : ''].filter(Boolean).join(' · ') : '';
        return el('div', { class: 'st-outils' }, [
          b('▦ Matériels', 'Matériels du site', function () { aller('materiels'); }, ecran === 'materiels' || ecran === 'pieces'),
          b('🗄 Rangements', 'Vue par casier', function () { aller('casiers'); }, ecran === 'casiers'),
          b('🖼 Photos', 'Photos des pièces', function () { aller('photos'); }, ecran === 'photos'),
          b('📷 Scan', 'Scanner un QR code', scanner),
          b('🛒 Commandes' + txtCmd, 'Panier, pièces sous le seuil, commandes en cours', function () { aller('commander'); }, ecran === 'commander'),
          b('📋 Inventaire', 'Mode inventaire', function () { aller('inventaire'); }, ecran === 'inventaire'),
          b('📜', 'Historique des mouvements', function () { aller('historique'); }, ecran === 'historique'),
          b('🔗', 'Pièces au stock commun', function () { aller('communes'); }, ecran === 'communes'),
          b(T && T.nbSoucis ? '🩺 ⚠' : '🩺', T && T.nbSoucis ? 'Contrôle des données : ' + T.nbSoucis + ' étape(s) non terminée(s)' : 'Contrôle des données', function () { aller('controle'); }, ecran === 'controle')
        ]);
      }

      /* ---------- photos : toutes les pièces en images, et celles qui n'en ont pas encore ---------- */
      function miniature(u) { return urlPhoto(u).replace(/&sz=w\d+$/, '&sz=w400'); }
      function ecranPhotos(racine) {
        var tout = toutesPieces().filter(function (p) { return p.designation || p.reference; });
        var avec = tout.filter(function (p) { return urlPhoto(p.photo); }), sans = tout.filter(function (p) { return !urlPhoto(p.photo); });
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Photos des pièces']));
        racine.appendChild(el('div', { class: 'st-onglets' }, [
          el('button', { class: 'st-onglet' + (photoMode === 'avec' ? ' actif' : ''), type: 'button', onclick: function () { photoMode = 'avec'; afficher(); } }, ['🖼 Avec photo (' + avec.length + ')']),
          el('button', { class: 'st-onglet' + (photoMode === 'sans' ? ' actif' : ''), type: 'button', onclick: function () { photoMode = 'sans'; afficher(); } }, ['➕ Sans photo (' + sans.length + ')'])]));
        var champ = el('input', { type: 'search', class: 'st-filtre', placeholder: '🔍 Pièce, référence, matériel, rangement…', value: photoFiltre, autocomplete: 'off' });
        racine.appendChild(champ);
        var zone = el('div');
        racine.appendChild(zone);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(photoFiltre);
          var liste = (photoMode === 'avec' ? avec : sans).filter(function (p) {
            return !t || norm([p.designation, p.reference, p.materiel, p.casier, p.casier ? rangementTexte(p.casier) : ''].join(' ')).indexOf(t) >= 0;
          });
          if (!liste.length) { zone.appendChild(el('p', { class: 'petit' }, [t ? 'Aucune pièce ne correspond à « ' + photoFiltre + ' ».' : photoMode === 'avec' ? 'Aucune photo pour l’instant. Va dans « Sans photo » pour en prendre.' : 'Toutes les pièces ont une photo 👍'])); return; }
          if (photoMode === 'avec') {
            var g = el('div', { class: 'st-galerie' });
            liste.forEach(function (p) {
              g.appendChild(el('div', { class: 'st-vignette' }, [
                el('div', { class: 'st-vignette-img' }, [
                  el('img', { src: miniature(p.photo), alt: p.designation || p.reference, loading: 'lazy', onclick: function () { pleinEcran(liensPhotos(p.photo), 0); } }),
                  liensPhotos(p.photo).length > 1 ? el('span', { class: 'st-nb-photos' }, ['📷 ' + liensPhotos(p.photo).length]) : null]),
                el('button', { class: 'st-vignette-txt', type: 'button', onclick: function () { ouvrirFiche(p); } }, [
                  el('b', {}, [p.designation || p.reference]),
                  el('div', { class: 'st-sous' }, [(p.reference ? p.reference + ' · ' : '') + p.materiel + (p.casier ? ' · ' + rangementTexte(p.casier) : '')])])]));
            });
            zone.appendChild(g);
          } else {
            var l = el('div', { class: 'st-sortie', style: 'max-height:none' });
            liste.slice(0, 200).forEach(function (p) {
              l.appendChild(el('div', { class: 'st-ligne-photo' }, [
                el('button', { class: 'st-vignette-txt', type: 'button', onclick: function () { ouvrirFiche(p); } }, [
                  el('b', {}, [p.designation || p.reference]),
                  el('div', { class: 'st-sous' }, [(p.reference ? p.reference + ' · ' : '') + p.materiel + (p.casier ? ' · ' + rangementTexte(p.casier) : '')])]),
                el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () { choisirPhoto(p); } }, ['📷 Prendre'])]));
            });
            if (liste.length > 200) l.appendChild(el('p', { class: 'petit' }, ['… ' + (liste.length - 200) + ' autres : précise la recherche.']));
            zone.appendChild(l);
          }
        }
        champ.addEventListener('input', function () { photoFiltre = champ.value; remplir(); });
        remplir();
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
          if (!vues.length) {
            var mm = (T && T.materiels || []).filter(function (x) { return x.nom === materiel; })[0];
            conteneur.appendChild(el('div', { class: 'vide-msg' }, [liste.length ? 'Aucune pièce ne correspond.'
              : (mm && mm.erreur ? 'Les pièces de ce matériel n’ont pas pu être lues (serveur lent).' : 'Aucune pièce enregistrée.'),
              liste.length ? null : el('div', { style: 'margin-top:12px' }, [el('button', { class: 'btn-second', type: 'button', onclick: function () { PM.toast('Rechargement…'); charger(false); } }, ['↻ Recharger le stock'])])]));
            return;
          }
          conteneur.appendChild(tableau(['Référence', 'Désignation', 'Rangement', 'Stock', ''], vues.map(function (p) { return lignePiece(p, false); }), 'st-pieces st-pieces-casier'));
        }
        champ.addEventListener('input', function () { filtre = champ.value; remplir(); });
        remplir();
      }
      /* Repère des pièces communes aux deux sites (même quantité, même seuil ; rangement propre à chaque site) */
      function texteCommun(p) {
        if (!p.partage) return '';
        var autres = p.communAvec || [];
        return autres.length ? 'Commune avec ' + autres.join(' et ') + ' : même quantité et même seuil sur les deux sites (rangement propre à chaque site)' : 'Référence présente plusieurs fois sur ce site : même quantité partagée';
      }
      function badgeCommun(p) {
        if (!p.partage) return null;
        var autres = p.communAvec || [];
        return el('span', { class: 'st-badge st-partage', title: texteCommun(p) }, ['🔗 ' + (autres.length ? 'Commune' : 'Partagée')]);
      }
      // avecMateriel : vue recherche / casier (la 2e colonne montre le matériel)
      function lignePiece(p, avecMateriel) {
        var sous = [];
        if (p.cotes) sous.push(p.cotes);
        if (p.reperes) sous.push('rep. ' + p.reperes);
        if (p.substitution) sous.push('subst. ' + p.substitution);
        var badges = [
          badgeCommun(p),
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
              el('div', { class: 'st-sous' }, [(p.reference ? 'Réf. ' + p.reference : 'sans référence') + (p.casier ? ' · ' + rangementTexte(p.casier) : '')])]),
            el('td', {}, [p.materiel]), cellQte, actions]);
        }
        return el('tr', { class: classe }, [
          el('td', { class: 'st-ref' }, [p.reference || '—', urlPhoto(p.photo) ? el('button', { class: 'pp-icone', type: 'button', title: 'Voir la photo', onclick: function () { pleinEcran(liensPhotos(p.photo), 0); } }, ['📷']) : null]),
          el('td', {}, [el('span', {}, [p.designation]), badges[0], badges[1], badges[2], sous.length ? el('div', { class: 'st-sous' }, [sous.join(' · ')]) : null]),
          el('td', {}, [p.casier ? rangementTexte(p.casier) : '']), cellQte, actions]);
      }

      /* ---------- rangements : casiers et tiroirs ---------- */
      // liste du site (Casier A1…Z4 au départ) + rangements déjà notés sur des pièces
      function casiersDefinis() {
        // serveur pas encore à jour (pas de liste) : on affiche quand même Casier A1…Z4
        var l = ((T && T.casiers) || casiersParDefaut()).map(libelleRangement);
        attente.forEach(function (a) {
          if (a.type === 'stock.casierAjout' && !l.some(function (x) { return casierNorm(x) === casierNorm(a.nom); })) l.push(a.nom);
          if (a.type === 'stock.casierSuppr') l = l.filter(function (x) { return casierNorm(x) !== casierNorm(a.nom); });
        });
        return l;
      }
      // groupes { casier: libellé, cle, type, code, pieces } triés : casiers, tiroirs, autres, sans rangement
      function groupesCasiers() {
        var g = {};
        function groupe(lib) {
          var k = casierNorm(lib);
          if (!g[k]) { var r = rangement(lib); g[k] = { casier: r.type ? libelle(r.type, r.code) : String(lib).trim(), cle: k, type: r.type, code: r.code, pieces: [] }; }
          return g[k];
        }
        casiersDefinis().forEach(function (c) { if (c) groupe(c); });
        toutesPieces().forEach(function (p) {
          if (p.casier) groupe(p.casier).pieces.push(p);
          else { g['~'] = g['~'] || { casier: '(sans rangement)', cle: '~', type: '', code: '', pieces: [] }; g['~'].pieces.push(p); }
        });
        var ordre = { Casier: 0, Tiroir: 1, Armoire: 2, '': 3 };
        return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) {
          if (a.cle === '~') return 1; if (b.cle === '~') return -1;
          return (ordre[a.type] - ordre[b.type]) || a.code.localeCompare(b.code, 'fr', { numeric: true });
        });
      }
      function memeRangement(p, lib) { return lib === '(sans rangement)' ? !p.casier : casierNorm(p.casier) === casierNorm(lib); }
      function ecranCasiers(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Rangements']));
        racine.appendChild(el('div', { class: 'st-actions' }, [el('p', { class: 'petit', style: 'flex:1;margin:0' }, ['Ce qu’il y a dans chaque casier et chaque tiroir, tous matériels confondus.']),
          el('button', { class: 'btn-second', type: 'button', onclick: function () { nouveauCasier(function (c) { casierChoisi = c; afficher(); }); } }, ['+ Nouveau rangement'])]));
        var gs = groupesCasiers();
        [['Casier', '🗄 Casiers'], ['Tiroir', '🗃 Tiroirs'], ['Armoire', '🚪 Armoires'], ['', 'Autres rangements (type à préciser)']].forEach(function (t) {
          var liste = gs.filter(function (g) { return g.type === t[0]; });
          if (!liste.length) return;
          racine.appendChild(el('div', { class: 'st-sous-titre' }, [t[1] + ' (' + liste.filter(function (g) { return g.cle !== '~'; }).length + ')']));
          var puces = el('div', { class: 'st-casiers' });
          liste.forEach(function (g) {
            var bas = g.pieces.filter(function (p) { return p.stockBas; }).length;
            puces.appendChild(el('button', { class: 'st-casier' + (casierChoisi && casierNorm(casierChoisi) === g.cle ? ' actif' : ''), type: 'button', onclick: function () { casierChoisi = g.casier; afficher(); } }, [
              el('b', {}, [g.cle === '~' ? g.casier : (affiche(g.code) || g.casier)]), el('span', {}, [' ' + g.pieces.length]), bas ? el('span', { class: 'st-pastille st-pastille-mini' }, [String(bas)]) : null]));
          });
          racine.appendChild(puces);
        });
        var g = gs.filter(function (x) { return casierChoisi && (x.cle === casierNorm(casierChoisi) || (x.cle === '~' && casierChoisi === x.casier)); })[0];
        if (!g) { racine.appendChild(el('p', { class: 'petit' }, ['Touche un casier ou un tiroir pour voir son contenu.'])); return; }
        racine.appendChild(el('div', { class: 'pp-barre', style: 'margin-top:12px' }, [el('h3', { class: 'pp-titre' }, [rangementTexte(g.casier)]),
          el('button', { class: 'btn-second', type: 'button', onclick: function () { invPortee = { type: 'casier', valeur: g.casier }; invFaits = {}; aller('inventaire'); } }, ['📋 Inventorier']),
          g.pieces.length && g.cle !== '~' ? el('button', { class: 'btn-second', type: 'button', onclick: function () { toutDeplacer(g); } }, ['↪ Tout déplacer']) : null,
          !g.pieces.length && g.cle !== '~' ? el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Supprimer ce rangement vide', onclick: function () {
            if (confirm('Supprimer « ' + g.casier + ' » de la liste ?')) { casierChoisi = null; saisir({ type: 'stock.casierSuppr', nom: g.casier }); }
          } }, ['🗑']) : null]));
        racine.appendChild(g.pieces.length ? tableau(['Pièce', 'Matériel', 'Stock', ''], g.pieces.map(function (p) { return lignePiece(p, true); }), 'st-pieces')
          : el('p', { class: 'petit' }, ['Vide pour l’instant. Utilise « Inventorier » pour y ranger les pièces trouvées.']));
      }

      // tout le contenu d'un rangement part dans un autre ; le rangement de départ reste dans la liste, vide
      function toutDeplacer(g) {
        var fermer;
        var sel = selecteurRangement({ placeholder: 'Vers : Armoire 1, C10, 3G…', vide: 'Choisis le rangement d’arrivée (ou crée-le).', surChoix: function (lib) {
          if (casierNorm(lib) === g.cle) { PM.toast('C’est le même rangement'); return; }
          if (!confirm('Déplacer les ' + g.pieces.length + ' pièce(s) de « ' + g.casier + ' » vers « ' + lib + ' » ?')) return;
          fermer();
          g.pieces.slice().forEach(function (p) { saisir(Object.assign({ type: 'stock.casier', casier: lib }, refPiece(p))); });
          casierChoisi = lib; PM.toast(g.pieces.length + ' pièce(s) déplacée(s) vers ' + lib); afficher();
        } });
        fermer = modale('Tout déplacer : ' + g.casier, 'Toutes les pièces rangées ici partent dans le rangement choisi. « ' + g.casier + ' » reste dans la liste, vide.', [sel.noeud]);
        setTimeout(sel.focus, 30);
      }

      function listeCasiers() {
        return el('datalist', { id: 'st-liste-casiers' }, groupesCasiers().filter(function (g) { return g.cle !== '~'; }).map(function (g) { return el('option', { value: g.casier }); }));
      }
      /* Sélecteur de rangement : on tape quelques lettres, la liste des casiers / tiroirs
         qui correspondent se réduit à chaque lettre ; un toucher choisit. « c » ou « casier »
         en tête = seulement les casiers, « t » ou « tiroir » = seulement les tiroirs.
         Création seulement si le repère n'existe pas, toujours au format « Casier X » / « Tiroir X ». */
      function selecteurRangement(o) {
        o = o || {};
        var choisi = o.valeur ? (rangement(o.valeur).type ? libelle(rangement(o.valeur).type, rangement(o.valeur).code) : String(o.valeur).trim()) : '';
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand st-rgt-champ', placeholder: o.placeholder || '🔍 Casier, tiroir ou armoire : A1, C10, 3G…', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
        var info = el('div', { class: 'st-rgt-choisi' });
        var liste = el('div', { class: 'st-rgt-liste' });
        function majInfo() {
          info.innerHTML = '';
          if (choisi) info.appendChild(el('span', {}, ['Choisi : ', el('b', {}, [rangementTexte(choisi)])]));
          else if (o.vide) info.appendChild(el('span', { class: 'petit' }, [o.vide]));
        }
        function choisir(lib) {
          choisi = lib; champ.value = ''; liste.innerHTML = ''; majInfo();
          if (o.surChoix) o.surChoix(lib);
        }
        function analyser(q) {
          var t = String(q || '').trim(), type = '';
          var m = /^(casier|tiroir|armoire|cas|tir|arm|c|t)(?:\s+|$)(.*)$/i.exec(t);
          // « c » / « t » seuls ou suivis d'un espace = filtre de type ; « C10 » reste un repère
          // (« armoire » / « arm » en toutes lettres seulement : « A » seul reste un casier A…)
          if (m && (m[2] !== undefined) && (/^(casier|tiroir|armoire|cas|tir|arm)$/i.test(m[1]) || /\s/.test(t.charAt(m[1].length)) || t.length === 1)) {
            type = /^a/i.test(m[1]) ? 'Armoire' : /^c/i.test(m[1]) ? 'Casier' : 'Tiroir'; t = m[2];
          }
          return { type: type, code: casierCode(canonCode(t)) }; // « 0F » tapé = F0
        }
        function proposer() {
          liste.innerHTML = '';
          var a = analyser(champ.value);
          if (!champ.value.trim()) return;
          var gs = groupesCasiers().filter(function (g) { return g.cle !== '~' && (g.type ? (!a.type || g.type === a.type) : !a.type); });
          var q = casierCode(plie(a.code));
          var debut = gs.filter(function (g) { return plie(g.code).indexOf(q) === 0; });
          var dedans = gs.filter(function (g) { return q && plie(g.code).indexOf(q) > 0; });
          var res = debut.concat(dedans).slice(0, 40);
          res.forEach(function (g) {
            liste.appendChild(el('button', { class: 'st-rgt-prop', type: 'button', onclick: function () { choisir(g.casier); } }, [
              el('span', {}, [g.type ? rangementTexte(g.casier) : '❔ ' + g.casier + ' (type à préciser)']), el('span', { class: 'st-sous' }, [g.pieces.length + ' pièce' + (g.pieces.length > 1 ? 's' : '')])]));
          });
          var exact = a.code && gs.some(function (g) { return plie(g.code) === q && (!a.type || g.type === a.type); });
          if (a.code && !exact && o.creation !== false) {
            var types = (a.type ? [a.type] : ['Casier', 'Tiroir', 'Armoire']).filter(function (t) { return t !== 'Casier' || CASIER_OK.test(a.code); });
            if (!types.length) { liste.appendChild(el('p', { class: 'petit' }, ['Un casier s’écrit lettre puis étage 0 à 3 (ex. F0, G2).'])); return; }
            liste.appendChild(el('div', { class: 'st-rgt-creer' }, [el('span', { class: 'petit' }, ['« ' + affiche(a.code) + ' » n’existe pas encore :'])].concat(types.map(function (t) {
              return el('button', { class: 'btn-second st-mini', type: 'button', onclick: function () {
                var lib = libelle(t, a.code);
                if (!confirm('Créer le rangement « ' + lib + ' » ?')) return;
                saisir({ type: 'stock.casierAjout', nom: lib }); PM.toast(lib + ' ajouté');
                choisir(lib);
              } }, ['+ ' + (t === 'Casier' ? '🗄 ' : t === 'Tiroir' ? '🗃 ' : '🚪 ') + t + ' ' + affiche(a.code)]);
            }))));
          }
          if (!res.length && !(a.code && !exact)) liste.appendChild(el('p', { class: 'petit' }, ['Aucun rangement ne correspond.']));
        }
        champ.addEventListener('input', proposer);
        champ.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var premier = liste.querySelector('.st-rgt-prop');
          if (premier) premier.click();
        });
        majInfo();
        return {
          noeud: el('div', { class: 'st-rgt' }, [champ, liste, info]),
          valeur: function () { return choisi; },
          vider: function () { choisi = ''; majInfo(); },
          definir: function (lib) { choisi = lib; majInfo(); },
          focus: function () { champ.focus(); }
        };
      }
      function champRangement(valeur) {
        return selecteurRangement({ valeur: valeur, vide: 'Aucun rangement : tape quelques lettres pour en choisir un.' });
      }
      function nouveauCasier(suite) {
        var fermer;
        var sel = selecteurRangement({ placeholder: 'Tape le repère : C10-4, 3G, AA1…', surChoix: function (lib) { fermer(); if (suite) suite(lib); },
          vide: 'S’il existe déjà, il apparaît dans la liste : touche-le. Sinon, choisis « + Casier », « + Tiroir » ou « + Armoire ».' });
        fermer = modale('Nouveau rangement', 'Format unique : « Casier », « Tiroir » ou « Armoire » + repère en majuscules (ex. Casier 3G, Tiroir C10-1, Armoire 1).', [sel.noeud]);
        setTimeout(sel.focus, 30);
      }
      // inventaire d'un rangement : une pièce trouvée dedans y est rangée, avec la quantité comptée
      function pieceTrouvee(casier) {
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand', placeholder: 'Chercher la pièce (désignation, référence)…', autocomplete: 'off' });
        var zone = el('div', { class: 'st-sortie' });
        var fermer = modale('Pièce trouvée : ' + casier, 'Choisis la pièce : elle est rangée dans « ' + casier + ' » et tu saisis la quantité comptée.', [champ, zone,
          el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { fermer(); materiel = mats()[0] && mats()[0].nom; ouvrirAjoutPiece(casier); } }, ['+ Pièce qui n’existe pas encore'])]);
        function remplir() {
          zone.innerHTML = '';
          var t = norm(champ.value);
          if (t.length < 2) { zone.appendChild(el('p', { class: 'petit' }, ['Tape au moins 2 caractères.'])); return; }
          toutesPieces().filter(function (p) { return norm([p.designation, p.reference].join(' ')).indexOf(t) >= 0; }).slice(0, 30).forEach(function (p) {
            zone.appendChild(el('button', { class: 'st-sortie-ligne', type: 'button', onclick: function () { fermer(); rangerEtCompter(p, casier); } }, [
              el('span', { class: 'st-sortie-nom' }, [p.designation, el('div', { class: 'st-sous' }, [p.materiel + ' · ' + (p.reference || 'sans réf.') + ' · ' + (p.casier ? rangementTexte(p.casier) : 'sans rangement') + ' · stock ' + p.quantiteStock])])]));
          });
          if (!zone.children.length) zone.appendChild(el('p', { class: 'petit' }, ['Aucune pièce ne correspond.']));
        }
        champ.addEventListener('input', remplir); remplir();
        setTimeout(function () { champ.focus(); }, 30);
      }
      function rangerEtCompter(p, casier) {
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: String(p.quantiteStock), autocomplete: 'off' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var change = !memeRangement(p, casier);
        var fermer = modale(p.designation, p.materiel + ' — ' + (change && p.casier ? p.casier + ' → ' + casier : casier), [
          el('div', { class: 'champ' }, [el('label', {}, ['Quantité comptée']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var n = entier(inp.value, 0);
            if (isNaN(n)) { msg.textContent = 'Saisis un nombre entier (0 ou plus).'; msg.hidden = false; return; }
            fermer();
            if (change) saisir(Object.assign({ type: 'stock.casier', casier: casier }, refPiece(p)));
            invFaits[p.materiel + '|' + cle(p)] = n;
            saisir(Object.assign({ type: 'stock.quantite', absolu: true, compte: n, vu: p.quantiteStock, motif: 'Inventaire' }, refPiece(p)));
          } }, ['Ranger et enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }

      /* ---------- mode inventaire (quantité comptée) ---------- */
      function ecranInventaire(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Inventaire']));
        racine.appendChild(el('p', { class: 'petit' }, ['Saisis le nombre compté : l’appli calcule l’écart et le note dans l’historique (motif « Inventaire »).']));
        racine.appendChild(el('button', { class: 'btn-second st-large', style: 'margin:0 0 12px', type: 'button', onclick: function () { aller('noncomptees'); } }, ['🔎 Pièces non touchées depuis l’inventaire']));
        var choixMat = el('select', { class: 'st-select', style: 'margin:0' }, [el('option', { value: '' }, ['…ou un matériel entier'])]
          .concat(mats().map(function (m) { return el('option', { value: m.nom }, [m.nom]); })));
        if (invPortee && invPortee.type === 'materiel') choixMat.value = invPortee.valeur;
        choixMat.addEventListener('change', function () {
          invPortee = choixMat.value ? { type: 'materiel', valeur: choixMat.value } : null; invFaits = {}; afficher();
        });
        var sel = selecteurRangement({ valeur: invPortee && invPortee.type === 'casier' && invPortee.valeur !== '(sans rangement)' ? invPortee.valeur : '',
          vide: 'Tape un repère : la liste se réduit à chaque lettre.',
          surChoix: function (lib) { invPortee = { type: 'casier', valeur: lib }; invFaits = {}; afficher(); } });
        racine.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Casier ou tiroir à inventorier']), sel.noeud]));
        racine.appendChild(choixMat);
        if (!invPortee) setTimeout(sel.focus, 30);
        if (!invPortee) return;
        var parCasier = invPortee.type === 'casier' && invPortee.valeur !== '(sans rangement)';
        if (parCasier) racine.appendChild(el('button', { class: 'btn-second st-large', style: 'margin:0 0 12px', type: 'button', onclick: function () { pieceTrouvee(invPortee.valeur); } }, ['+ Pièce trouvée ici']));
        var liste = invPortee.type === 'materiel' ? pieces(invPortee.valeur)
          : toutesPieces().filter(function (p) { return memeRangement(p, invPortee.valeur); });
        racine.appendChild(el('h3', { class: 'pp-h3', style: 'margin-top:14px' }, [invPortee.type === 'materiel' ? invPortee.valeur : rangementTexte(invPortee.valeur)]));
        if (!liste.length) { racine.appendChild(el('div', { class: 'vide-msg' }, [parCasier ? 'Vide pour l’instant : ajoute les pièces trouvées avec le bouton ci-dessus.' : 'Aucune pièce.'])); return; }
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
            saisir(Object.assign({ type: 'stock.quantite', absolu: true, compte: n, vu: p.quantiteStock, motif: 'Inventaire' }, refPiece(p)));
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
            el('td', {}, [p.designation, el('div', { class: 'st-sous' }, [(p.reference || 'sans réf.') + ' · ' + (invPortee.type === 'casier' ? p.materiel : (p.casier ? rangementTexte(p.casier) : 'sans rangement'))])]),
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

      /* ---------- pièces non comptées : aucun comptage « Inventaire » depuis X jours ---------- */
      var invDates = null, invDatesMaj = 0, ncJours = 30;
      function cleInv(p) { return String(p.reference || '').trim() || (p.materiel + '|' + String(p.designation || '').trim()); }
      function chargerDatesInventaire(force) {
        if (invDates && !force && Date.now() - invDatesMaj < 60000) return Promise.resolve(invDates);
        return api('stock.inventaire', {}, 90000).then(function (j) {
          invDates = j.dates || {}; invDatesMaj = Date.now();
          PM.DB.set(K.tout + '_inv', invDates);
          return invDates;
        })['catch'](function (e) {
          return PM.DB.get(K.tout + '_inv').then(function (d) { if (!d) throw e; invDates = d; return d; });
        });
      }
      function ecranNonComptees(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Pièces non touchées']));
        racine.appendChild(el('p', { class: 'petit' }, ['Pièces dont la fiche n’a reçu aucune modification (comptage, quantité, casier, désignation, référence, seuil, photo…) depuis la période choisie : elles n’ont sans doute pas été vues à l’inventaire. ',
          'Dès qu’une pièce est modifiée, elle sort de la liste. Touche ✓ si elle est bien là (quantité inchangée) ou « Plus en stock » pour la passer à 0.']));
        var sel = el('select', { class: 'st-select', style: 'margin:0 0 12px' }, [[7, 'depuis 7 jours'], [30, 'depuis 30 jours'], [90, 'depuis 3 mois'], [365, 'depuis 1 an'], [0, 'jamais modifiées']].map(function (o) {
          return el('option', { value: String(o[0]), selected: o[0] === ncJours ? 'selected' : null }, ['Non touchées ' + o[1]]);
        }));
        sel.addEventListener('change', function () { ncJours = Number(sel.value); afficher(); });
        racine.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Période']), sel]));
        if (modeDemo) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Indisponible en mode démonstration.'])); return; }
        var zone = el('div'); racine.appendChild(zone);
        zone.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })]));
        chargerDatesInventaire(false).then(function (dates) {
          if (ecran !== 'noncomptees' || !actif()) return;
          zone.innerHTML = '';
          // modifications faites sur ce téléphone et pas encore parties comptent aussi
          var locaux = {};
          attente.forEach(function (a) { if (TYPES_PIECE.indexOf(a.type) >= 0 || a.type === 'stock.piece') { var k0 = cleInv(a.type === 'stock.piece' ? Object.assign({ materiel: a.materiel }, a.piece) : a); locaux[k0] = Math.max(locaux[k0] || 0, new Date(a.horodatage).getTime() || 0); } });
          // date « Modifié le » de la fiche (toutes les lignes d'une même référence comptent)
          var fiches = {};
          toutesPieces().forEach(function (p) { var t = p.modifieLe ? new Date(p.modifieLe).getTime() : 0; var k1 = cleInv(p); if (t > (fiches[k1] || 0)) fiches[k1] = t; });
          var limite = ncJours ? Date.now() - ncJours * 86400000 : Infinity;
          var dejaZero = 0, parMat = {}, ordre = [], total = 0;
          toutesPieces().forEach(function (p) {
            var k = cleInv(p), d = dates[k] || {}, dernier = Math.max(d.i || 0, d.m || 0, fiches[k] || 0, locaux[k] || 0);
            var fait = invFaits[p.materiel + '|' + cle(p)] !== undefined; // traitée à l'instant : reste affichée, cochée
            if (!fait && (ncJours ? dernier >= limite : dernier > 0)) return;
            if (!fait && !p.quantiteStock) { dejaZero++; return; }
            if (!parMat[p.materiel]) { parMat[p.materiel] = []; ordre.push(p.materiel); }
            parMat[p.materiel].push({ p: p, dernier: dernier, mouvement: d.m || 0 });
            total++;
          });
          zone.appendChild(el('p', { class: 'petit' }, [total + ' pièce' + (total > 1 ? 's' : '') + ' à vérifier' + (dejaZero ? ' · ' + dejaZero + ' déjà à 0 (non affichées)' : '')]));
          if (!total) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Toutes les pièces ont été touchées sur cette période. 👍'])); return; }
          ordre.forEach(function (nom) {
            zone.appendChild(el('h3', { class: 'pp-h3', style: 'margin-top:14px' }, [nom + ' (' + parMat[nom].length + ')']));
            var lignes = parMat[nom].map(function (x) {
              var p = x.p, k = p.materiel + '|' + cle(p);
              var info = x.dernier ? 'dernière modification le ' + new Date(x.dernier).toLocaleDateString('fr-FR') : 'jamais modifiée';
              function marquer(n) {
                invFaits[k] = n;
                saisir(Object.assign({ type: 'stock.quantite', absolu: true, compte: n, vu: p.quantiteStock, motif: n === 0 ? 'Inventaire — plus en stock' : 'Inventaire' }, refPiece(p)));
              }
              return el('tr', { class: invFaits[k] !== undefined ? 'st-fait' : '' }, [
                el('td', {}, [p.designation, el('div', { class: 'st-sous' }, [(p.reference || 'sans réf.') + ' · ' + (p.casier ? rangementTexte(p.casier) : 'sans rangement')]), el('div', { class: 'st-sous' }, [info])]),
                el('td', {}, [String(p.quantiteStock)]),
                el('td', { class: 'st-nc-actions' }, invFaits[k] !== undefined ? [el('b', { class: 'st-plus' }, ['✓ ' + invFaits[k]])] : [
                  el('button', { class: 'btn-second st-ok', type: 'button', title: 'Présente, quantité inchangée', onclick: function () { marquer(p.quantiteStock); } }, ['✓']),
                  el('button', { class: 'btn-second st-ok st-nc-zero', type: 'button', title: 'Passer la quantité à 0', onclick: function () { marquer(0); } }, ['Plus en stock'])])]);
            });
            zone.appendChild(tableau(['Pièce', 'Stock', ''], lignes, 'st-inventaire st-nc'));
          });
        })['catch'](function (e) {
          zone.innerHTML = '';
          zone.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de lire l’historique des comptages.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
            el('button', { class: 'btn-second', type: 'button', onclick: function () { afficher(); } }, ['Réessayer'])]));
        });
      }

      /* ---------- mise en commun des pièces des deux sites ---------- */
      function blocMiseEnCommun() {
        var d = el('div', { class: 'bandeau st-controle' });
        var zoneR = el('div');
        function rapport(r, titre) {
          zoneR.innerHTML = '';
          if (!r) return;
          var n = (r.corrections || []).length;
          zoneR.appendChild(el('p', { class: 'petit' }, [(titre || 'Dernière mise en commun') + ' : ' + (r.date ? new Date(r.date).toLocaleString('fr-FR') : '') + ' — '
            + r.communes + ' référence' + (r.communes > 1 ? 's' : '') + ' commune' + (r.communes > 1 ? 's' : '') + ', ' + n + ' ligne' + (n > 1 ? 's' : '') + ' corrigée' + (n > 1 ? 's' : '')
            + ((r.fusions || []).length ? ', ' + r.fusions.length + ' doublon(s) fusionné(s)' : '') + ((r.nouvelles || []).length ? ', ' + r.nouvelles.length + ' ajoutée(s) au stock commun' : '') + '.']));
          (r.corrections || []).slice(0, 200).forEach(function (c) {
            zoneR.appendChild(el('div', { class: 'st-emplacement' }, [c.ou + ', ligne ' + c.ligne + ' : ' + (c.designation || c.reference) + ' (' + c.reference + ') — ' + c.avant + ' → ' + c.apres
              + (c.seuilAvant !== c.seuilApres ? ', seuil ' + c.seuilAvant + ' → ' + c.seuilApres : '') + ' · ' + c.regle]));
          });
          var orph = r.sansCorrespondance || [];
          if (orph.length) {
            zoneR.appendChild(el('p', { class: 'petit st-orphelines' }, [el('b', {}, ['⚠ ' + orph.length + ' ligne' + (orph.length > 1 ? 's' : '') + ' cochée' + (orph.length > 1 ? 's' : '') + ' OUI sans équivalent sur l’autre site']),
              ' — à corriger dans le Sheet (même référence des deux côtés) :']));
            orph.forEach(function (o) {
              var txt = o.ou + ', ligne ' + o.ligne + ' : ' + (o.designation || o.reference) + (o.reference ? ' (' + o.reference + ')' : ' (sans référence)');
              var pistes = (o.pistes || []).map(function (q) { return q.ou + ' l.' + q.ligne + ' « ' + (q.designation || q.reference) + ' »' + (q.reference ? ' (' + q.reference + ')' : '') + (q.commun === 'NON' ? ' — marquée NON' : ''); });
              zoneR.appendChild(el('div', { class: 'st-emplacement' }, [txt, pistes.length ? el('div', { class: 'petit' }, ['↳ ressemble à : ' + pistes.join(' ; ')]) : null]));
            });
          }
          var sansRef = r.sansReference || [];
          if (sansRef.length) {
            zoneR.appendChild(el('p', { class: 'petit st-orphelines' }, [el('b', {}, ['⚠ ' + sansRef.length + ' ligne' + (sansRef.length > 1 ? 's' : '') + ' cochée' + (sansRef.length > 1 ? 's' : '') + ' OUI mais sans référence']),
              ' — elles ne peuvent pas être communes : ajoute la référence dans le Sheet (la même sur les deux sites).']));
            sansRef.forEach(function (o) {
              var pistes = (o.pistes || []).map(function (q) { return q.ou + ' l.' + q.ligne + ' : réf. ' + q.reference; });
              zoneR.appendChild(el('div', { class: 'st-emplacement' }, [o.ou + ', ligne ' + o.ligne + ' : ' + o.designation,
                pistes.length ? el('div', { class: 'petit' }, ['↳ même désignation avec une référence : ' + pistes.join(' ; ')]) : null]));
            });
          }
          if ((r.retirees || []).length) zoneR.appendChild(el('p', { class: 'petit' }, ['Retiré du stock commun (ne correspond plus à aucune référence) : ' + r.retirees.map(function (x) { return x.reference; }).join(', ')]));
        }
        var btn = el('button', { class: 'btn-principal', type: 'button', onclick: function () {
          if (!confirm('Mettre en commun les pièces présentes sur les deux sites ?\nMême quantité et même seuil sur toutes leurs lignes (la ligne modifiée le plus récemment fait foi). Le rangement n’est pas touché.')) return;
          btn.disabled = true; btn.textContent = 'Mise en commun en cours…';
          api('stock.communiser', {}, 180000).then(function (j) {
            btn.disabled = false; btn.textContent = '🔗 Mettre en commun maintenant';
            rapport(j.rapport, 'Mise en commun faite');
            PM.toast('Mise en commun terminée'); rechargerPlusTard(); charger(false);
          })['catch'](function (e) { btn.disabled = false; btn.textContent = '🔗 Mettre en commun maintenant'; PM.toast('Impossible : ' + e.message, 5000); });
        } }, ['🔗 Mettre en commun maintenant']);
        d.appendChild(el('b', {}, ['Pièces communes aux deux sites']));
        d.appendChild(el('p', { class: 'petit' }, ['La colonne « Commun » du Sheet décide : NON = jamais partagée ; OUI (ou vide) avec une référence = partagée avec toute ligne de même référence. Sans référence, une pièce n’est jamais partagée. Même quantité et même seuil partout (le rangement reste propre à chaque site). Les lignes en écart sont corrigées, l’historique le note (motif « Mise en commun »). Un contrôle de nuit refait la même chose et t’envoie un mail s’il a corrigé quelque chose.']));
        d.appendChild(btn); d.appendChild(zoneR);
        if (!modeDemo) api('stock.communRapport', {}, 60000).then(function (j) { rapport(j.rapport); })['catch'](function () {});
        return d;
      }

      /* ---------- passer une pièce à l'autre site (copie commune ou déplacement) ---------- */
      var autresSitesCache = null;
      function ouvrirTransfert(p) {
        var corps = el('div', {}, [el('p', { class: 'petit' }, ['Lecture des matériels de l’autre site…'])]);
        var fermer = modale('⇄ Passer « ' + (p.designation || p.reference) + ' » à l’autre site', p.materiel, [corps]);
        (autresSitesCache ? Promise.resolve(autresSitesCache) : api('stock.autresSites', {}, 60000).then(function (j) { return (autresSitesCache = j.sites || []); })).then(function (sites) {
          corps.innerHTML = '';
          if (!sites.length) { corps.appendChild(el('p', { class: 'petit' }, ['Aucun autre site configuré.'])); return; }
          var choixSite = el('select', { class: 'st-select' }, sites.map(function (s) { return el('option', { value: s.id }, [s.nom]); }));
          var choixMat = el('select', { class: 'st-select' });
          var nouveauMat = el('input', { type: 'text', placeholder: 'Nom du nouveau matériel', autocomplete: 'off', hidden: 'hidden' });
          function remplirMat() {
            var s = sites.filter(function (x) { return x.id === choixSite.value; })[0] || { materiels: [] };
            choixMat.innerHTML = '';
            var liste = s.materiels.slice();
            if (liste.indexOf(p.materiel) < 0) liste.unshift(p.materiel); // même nom de matériel proposé en premier
            liste.forEach(function (m) { choixMat.appendChild(el('option', { value: m }, [m + (s.materiels.indexOf(m) < 0 ? ' (nouveau)' : '')])); });
            choixMat.appendChild(el('option', { value: '__nouveau' }, ['+ Autre matériel…']));
            choixMat.value = p.materiel; // même matériel que ici, proposé par défaut
            nouveauMat.hidden = true;
          }
          choixSite.addEventListener('change', remplirMat);
          choixMat.addEventListener('change', function () { nouveauMat.hidden = choixMat.value !== '__nouveau'; if (!nouveauMat.hidden) setTimeout(function () { nouveauMat.focus(); }, 30); });
          remplirMat();
          var peutCopier = !!cleCommune(p); // NON ou sans référence = jamais commune
          var mode = peutCopier ? 'copier' : 'deplacer';
          var chipCopier = el('button', { type: 'button', class: 'st-chip' + (mode === 'copier' ? ' actif' : ''), disabled: peutCopier ? null : 'disabled', onclick: function () { mode = 'copier'; maj(); } }, ['Copier (commune aux deux)']);
          var chipDeplacer = el('button', { type: 'button', class: 'st-chip' + (mode === 'deplacer' ? ' actif' : ''), onclick: function () { mode = 'deplacer'; maj(); } }, ['Déplacer (retirée d’ici)']);
          var aide = el('p', { class: 'petit' });
          function maj() {
            chipCopier.classList.toggle('actif', mode === 'copier'); chipDeplacer.classList.toggle('actif', mode === 'deplacer');
            aide.textContent = mode === 'copier'
              ? 'La pièce apparaîtra sur les deux sites avec la même quantité (' + p.quantiteStock + ') et le même seuil. Le rangement reste propre à chaque site.'
              : 'La pièce est recréée là-bas (quantité ' + p.quantiteStock + ', photos, côtes, repères) puis retirée d’ici.';
            var bp = corps.querySelector('.btn-principal'); if (bp) bp.textContent = mode === 'copier' ? 'Copier' : 'Déplacer';
          }
          maj();
          var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
          corps.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Vers le site']), choixSite]));
          corps.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Dans le matériel']), choixMat, nouveauMat]));
          corps.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Comment']), el('div', { class: 'st-actions' }, [chipCopier, chipDeplacer]), aide]));
          if (!peutCopier) corps.appendChild(el('p', { class: 'petit' }, [p.commun === false && p.reference ? 'Pièce marquée NON (pas commune) dans le Sheet : seul le déplacement est possible.' : 'Sans référence, la pièce ne peut pas être commune : seul le déplacement est possible.']));
          corps.appendChild(msg);
          corps.appendChild(el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var mat = choixMat.value === '__nouveau' ? nouveauMat.value.trim() : choixMat.value;
            if (!mat) { msg.textContent = 'Indique le matériel de destination.'; msg.hidden = false; nouveauMat.focus(); return; }
            var siteNom = (sites.filter(function (x) { return x.id === choixSite.value; })[0] || {}).nom || 'l’autre site';
            fermer();
            var m2 = document.querySelectorAll('.ag-modale'); if (m2.length) m2[m2.length - 1].remove(); // ferme aussi la fiche
            if (mode === 'copier') { autresSitesCache = null; }
            saisir(Object.assign({ type: 'stock.transferer', versSite: choixSite.value, versMateriel: mat, mode: mode, quantite: p.quantiteStock }, refPiece(p)));
            PM.toast((mode === 'copier' ? 'Copiée vers ' : 'Déplacée vers ') + siteNom + ' / ' + mat + (navigator.onLine ? '' : ' · envoi au retour du réseau'), 4000);
          } }, [mode === 'copier' ? 'Copier' : 'Déplacer']));
        })['catch'](function (e) { corps.innerHTML = ''; corps.appendChild(el('p', { class: 'bg-erreur' }, ['Impossible de lire l’autre site : ' + e.message])); });
      }

      /* ---------- suppression d'une pièce (deux appuis, pas de fenêtre système) ---------- */
      function boutonSupprimerPiece(p) {
        var b = el('button', { class: 'btn-second st-large st-danger', type: 'button' }, ['🗑 Supprimer cette pièce du listing']);
        var arme = false, timer = null;
        b.onclick = function () {
          if (!arme) {
            arme = true; b.classList.add('arme');
            b.textContent = 'Confirmer la suppression' + (p.partage ? ' (la ligne de ' + ((p.communAvec || [])[0] || 'l’autre site') + ' est conservée)' : '') + ' ?';
            timer = setTimeout(function () { arme = false; b.classList.remove('arme'); b.textContent = '🗑 Supprimer cette pièce du listing'; }, 5000);
            return;
          }
          clearTimeout(timer);
          var modales = document.querySelectorAll('.ag-modale'); if (modales.length) modales[modales.length - 1].remove();
          saisir(Object.assign({ type: 'stock.supprimerPiece', quantite: p.quantiteStock }, refPiece(p)));
          PM.toast('Pièce supprimée' + (navigator.onLine ? '' : ' · envoi au retour du réseau'));
        };
        return b;
      }

      /* ---------- fiche pièce ---------- */
      var rafraichirFiche = null;
      function ouvrirFiche(p0) {
        var corps = el('div');
        modale(p0.designation || p0.reference || 'Pièce', p0.materiel, [corps]);
        var docs = null;
        // Pièce affichée : même numéro de ligne ET même référence ou même désignation (une seule des deux change à la fois).
        // Avant : le numéro de ligne seul -> après un rechargement (ligne ajoutée/supprimée), la fiche montrait une AUTRE pièce.
        var pCourante = p0;
        function piece() {
          var c = pCourante, l = pieces(c.materiel);
          var x = (c.rowIndex ? l.filter(function (y) { return y.rowIndex === c.rowIndex && ((c.reference && y.reference === c.reference) || (c.designation && y.designation === c.designation)); })[0] : null)
            || l.filter(function (y) { return cle(y) === cle(c); })[0];
          if (x) pCourante = x;
          return x || c;
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
            ligne('Rangement', p.casier ? rangementTexte(p.casier) : '', function () { editerCasier(p); }),
            ligne('Seuil mini', p.seuil, function () { editerSeuil(p); }),
            ligne('À commander', p.quantiteACommander),
            ligne('Référence', p.reference, function () { editerTexte(p, 'Référence', 'reference', 'stock.reference', false); }),
            p.partage ? ligne('🔗 Stock commun', (p.communAvec || []).length ? 'avec ' + p.communAvec.join(' et ') + ' — même quantité, même seuil' : 'présente plusieurs fois sur ce site') : [],
            p.ancienneReference ? ligne('Ancienne réf.', p.ancienneReference) : [],
            p.cotes ? ligne('Côtes', p.cotes) : [], p.substitution ? ligne('Substitution', p.substitution) : [], p.reperes ? ligne('Repères', p.reperes) : []
          ).forEach(function (n) { dl.appendChild(n); });
          corps.appendChild(dl);
          var liens = liensPhotos(p.photo);
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Photos' + (liens.length ? ' (' + liens.length + ')' : '')]),
            liens.length ? el('div', { class: 'st-photos' }, liens.map(function (u, i) {
              return el('div', { class: 'st-photo-mini' }, [
                el('img', { src: urlPhoto(u).replace(/&sz=w\d+$/, '&sz=w400'), alt: 'Photo ' + (i + 1), loading: 'lazy', onclick: function () { pleinEcran(liens, i); } }),
                el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer cette photo', onclick: function () {
                  if (confirm('Retirer cette photo ?')) saisir(Object.assign({ type: 'stock.retirerPhoto', lien: u }, refPiece(p)));
                } }, ['🗑'])]);
            }))
              : el('p', { class: 'petit' }, ['Aucune photo pour l’instant : vue d’ensemble, plaque signalétique, cotes…']),
            liens.length < 8 ? el('button', { class: 'btn-principal st-large st-btn-photo', type: 'button', onclick: function () { choisirPhoto(p); } }, ['📷 Prendre une photo'])
              : el('p', { class: 'petit' }, ['8 photos maximum : retire-en une pour en prendre une autre.'])]));
          if (p.reference) {
            var qr = qrDataUrl(lienFiche(p), 180);
            if (qr) corps.appendChild(el('div', { class: 'st-qr' }, [el('div', { class: 'st-section-titre' }, ['QR code — à coller sur le casier']),
              el('img', { src: qr, alt: 'QR code', width: '180', height: '180' })]));
          }
          var zoneDocs = el('div', { class: 'st-docs' });
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Documents (liens web)',
            p.reference ? el('button', { class: 'pp-icone', type: 'button', title: 'Ajouter un lien vers un document', onclick: function () { ajouterDocument(p); } }, ['+']) : null]), zoneDocs]));
          remplirDocs(zoneDocs, p);
          corps.appendChild(el('div', { class: 'bg-boutons st-fiche-boutons' }, [
            el('button', { class: 'btn-second', type: 'button', onclick: function () { imprimerQr([p], p.designation || p.reference); } }, ['🖨 Imprimer']),
            el('button', { class: 'btn-second', type: 'button', onclick: function () { ouvrirPanier(p); } }, ['🛒 Panier']),
            el('button', { class: 'btn-second', type: 'button', onclick: scanner }, ['📷 Scanner suivant'])]));
          if (!p.enAttente) corps.appendChild(el('div', { class: 'st-section st-suppr-piece' }, [
            modeDemo ? null : el('button', { class: 'btn-second st-large', type: 'button', onclick: function () { ouvrirTransfert(p); } }, ['⇄ Passer à l’autre site']),
            boutonSupprimerPiece(p)]));
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
          (depuisScan ? p.materiel + (p.casier ? ' · ' + rangementTexte(p.casier) : '') + ' — ' : (p.designation || p.reference) + ' — ') + 'stock actuel : ' + p.quantiteStock, [
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
            if (type === 'stock.reference') v = v.replace(/,/g, '.'); // virgules -> points (choix d'Alex)
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
        var ch = champRangement(p.casier || '');
        var sugg = el('div', { class: 'st-sugg' });
        var fermer = modale('Modifier le rangement', 'Casier ou tiroir : propre à cette ligne, même pour une référence partagée.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Casier ou tiroir']), ch.noeud]), sugg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = ch.valeur();
            if (casierNorm(v) === casierNorm(p.casier || '')) { fermer(); return; }
            if (!confirm('Changer « ' + (p.casier || 'non renseigné') + ' » en « ' + (v || 'non renseigné') + ' » ?')) return;
            fermer(); saisir(Object.assign({ type: 'stock.casier', casier: v }, refPiece(p)));
          } }, ['Enregistrer'])]);
        var inp = { set value(v) { ch.definir(libelleRangement(v)); } };
        // casiers déjà utilisés pour la même référence (ce site tout de suite, l'autre site si réseau)
        var autres = toutesPieces().filter(function (x) { return p.reference && x.reference === p.reference && x !== p && x.casier && !(x.materiel === p.materiel && x.rowIndex === p.rowIndex); })
          .map(function (x) { return { site: T.site, materiel: x.materiel, casier: x.casier }; });
        function montrer(liste) {
          sugg.innerHTML = '';
          if (!liste.length) return;
          sugg.appendChild(el('p', { class: 'petit' }, ['Même référence ailleurs :']));
          liste.forEach(function (e) { sugg.appendChild(el('button', { class: 'st-sugg-btn', type: 'button', onclick: function () { inp.value = e.casier; } }, ['Comme ' + e.site + ' — ' + e.materiel + ' (' + rangementTexte(e.casier) + ')'])); });
        }
        montrer(autres);
        if (p.partage && p.reference && !modeDemo) {
          api('stock.emplacements', { reference: p.reference, materiel: p.materiel, rowIndex: p.rowIndex }).then(function (j) {
            montrer((j.emplacements || []).filter(function (e) { return e.casier; }));
          })['catch'](function () {});
        }
        setTimeout(ch.focus, 30);
      }
      function choisirPhoto(p) {
        var f = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'position:fixed;left:-9999px;top:0;opacity:0' }); // pas « hidden » : certains iPhone n'ouvrent pas l'appareil photo sur un champ masqué
        document.body.appendChild(f);
        f.addEventListener('change', function () {
          var fichier = f.files[0]; f.remove();
          if (!fichier) return;
          (PM.attente ? PM.attente(redimensionner(fichier, 1024, 0.7), 'Préparation de la photo…') : redimensionner(fichier, 1024, 0.7)).then(function (data) {
            saisir(Object.assign({ type: 'stock.photo', photo: data, ajout: true }, refPiece(p)), true);
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
          casier: champRangement(casierImpose || ''), photo: el('input', { type: 'file', accept: 'image/*', capture: 'environment' })
        };
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function champ(lib, i) { return el('div', { class: 'champ' }, [el('label', {}, [lib]), i]); }
        var choixMat = el('select', { class: 'st-select' }, mats().map(function (m) { return el('option', { value: m.nom }, [m.nom]); }));
        choixMat.value = materiel;
        choixMat.addEventListener('change', function () { materiel = choixMat.value; });
        var fermer = modale('Ajouter une pièce', casierImpose ? 'Rangée dans ' + rangementTexte(casierImpose) : materiel, [
          casierImpose ? champ('Matériel', choixMat) : null,
          champ('Désignation', c.designation), champ('Référence', c.reference),
          el('div', { class: 'pp-deux' }, [champ('Quantité de départ', c.quantite), champ('Seuil', c.seuil)]),
          champ('Rangement (casier ou tiroir)', c.casier.noeud), champ('Photo (facultatif)', c.photo),
          el('p', { class: 'petit' }, ['Même référence qu’une pièce existante (ce site ou l’autre) = stock partagé automatiquement. Côtes, Substitution et Repères restent modifiables dans le Google Sheets du site.']),
          msg, el('button', { class: 'btn-principal', type: 'button', onclick: valider }, ['Ajouter'])]);
        function valider() {
          var q = entier(c.quantite.value, 0), s = entier(c.seuil.value, 0);
          if (!c.designation.value.trim()) { msg.textContent = 'La désignation est obligatoire.'; msg.hidden = false; return; }
          if (isNaN(q) || isNaN(s)) { msg.textContent = 'Quantité et seuil : nombres entiers (0 ou plus).'; msg.hidden = false; return; }
          var ref = c.reference.value.trim().replace(/,/g, '.'); // virgules -> points (choix d'Alex)
          if (ref && pieces(materiel).some(function (p) { return p.reference === ref; }) && !confirm('Cette référence existe déjà dans ' + materiel + '. L’ajouter quand même ?')) return;
          var piece = { designation: c.designation.value.trim(), reference: ref, quantiteStock: q, seuil: s, casier: c.casier.valeur() };
          var fichier = c.photo.files[0];
          (fichier ? (PM.attente ? PM.attente(redimensionner(fichier, 1024, 0.7), 'Préparation de la photo…') : redimensionner(fichier, 1024, 0.7)) : Promise.resolve('')).then(function (data) {
            if (data) piece.photo = data;
            fermer(); saisir({ type: 'stock.piece', materiel: materiel, piece: piece }, !!data); PM.toast('Pièce ajoutée');
          })['catch'](function () { msg.textContent = 'Impossible de lire la photo choisie.'; msg.hidden = false; });
        }
        setTimeout(function () { c.designation.focus(); }, 30);
      }
      /* ---------- panier : les pièces choisies avec 🛒 (avec ou sans référence) ---------- */
      function ligneDuPanier(p) { var k = cleCmd(p); return lignesCmd().filter(function (x) { return x.statut !== 'Commandé' && cleCmd(x) === k; })[0]; }
      function ouvrirPanier(p, qPropose) {
        var deja = ligneDuPanier(p);
        var q0 = deja ? deja.quantite : (qPropose || (p.quantiteACommander > 0 ? p.quantiteACommander : 1));
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: String(q0) });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale(deja ? 'Déjà dans le panier' : 'Ajouter au panier', (p.designation || p.reference) + ' — ' + (p.reference ? 'réf. ' + p.reference : 'sans référence') + ' · ' + p.materiel, [
          el('div', { class: 'champ' }, [el('label', {}, ['Quantité à commander']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var q = entier(inp.value, 1);
            if (isNaN(q)) { msg.textContent = 'Saisis un nombre entier (1 ou plus).'; msg.hidden = false; return; }
            fermer(); saisir({ type: 'stock.panier', materiel: p.materiel, reference: p.reference || '', designation: p.designation, casier: p.casier, quantite: q });
            PM.toast((deja ? 'Panier mis à jour : ' : 'Ajouté au panier : ') + q + ' × ' + (p.designation || p.reference));
          } }, [deja ? 'Mettre à jour le panier' : 'Ajouter au panier'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }

      /* Lignes de l'onglet Commandes (serveur) + saisies pas encore confirmées, appliquées comme le fera le serveur */
      function lignesCmd() {
        var liste = (cmdServeur || []).filter(function (x) { return x.origine === 'panier'; }).map(function (x) { return Object.assign({}, x, { reference: String(x.reference === null || x.reference === undefined ? '' : x.reference) }); });
        var actions = cmdConfirmes.filter(function (c) { return c.t > cmdLu; }).map(function (c) { return c.a; })
          .concat(attente.filter(function (a) { return TYPES_CMD.indexOf(a.type) >= 0; }));
        actions.forEach(function (a) {
          var k = cleCmd(a), enAtt = attente.indexOf(a) >= 0;
          function trouve(commandee) { return liste.filter(function (x) { return cleCmd(x) === k && (x.statut === 'Commandé') === commandee; })[0]; }
          function retirer(commandee) { liste = liste.filter(function (x) { return !(cleCmd(x) === k && (commandee === undefined || (x.statut === 'Commandé') === commandee)); }); }
          var date = new Date(a.horodatage).toLocaleDateString('fr-FR');
          if (a.type === 'stock.panier') {
            if (!(a.quantite > 0)) { retirer(false); return; }
            var b = trouve(false);
            if (b) { b.quantite = a.quantite; if (a.casier) b.casier = a.casier; b.enAttente = b.enAttente || enAtt; }
            else liste.push({ origine: 'panier', statut: '', materiel: a.materiel, reference: a.reference || '', designation: a.designation, casier: a.casier, quantite: a.quantite, enAttente: enAtt });
          } else if (a.type === 'stock.retirerPanier') retirer(a.quoi === 'panier' ? false : a.quoi === 'commande' ? true : undefined);
          else if (a.type === 'stock.reception') retirer(a.quoi === 'commande' ? true : undefined);
          else if (a.type === 'stock.commande') {
            var bp = trouve(false), bc = trouve(true);
            if (bp && bc) { bc.quantite = (bc.quantite || 0) + a.quantite; bc.fournisseur = a.fournisseur || bc.fournisseur; bc.dateCommande = date; bc.enAttente = bc.enAttente || enAtt; liste = liste.filter(function (x) { return x !== bp; }); }
            else if (bp || bc) { var x = bp || bc; x.statut = 'Commandé'; x.quantite = a.quantite; x.fournisseur = a.fournisseur; x.dateCommande = date; x.enAttente = x.enAttente || enAtt; }
            else liste.push({ origine: 'panier', statut: 'Commandé', materiel: a.materiel, reference: a.reference || '', designation: a.designation, casier: a.casier, quantite: a.quantite, fournisseur: a.fournisseur, dateCommande: date, enAttente: enAtt });
          }
        });
        return liste;
      }
      /* Pièces sous le seuil mini (calculées ici avec le stock à jour, saisies en attente comprises).
         Une pièce commune à plusieurs matériels n'apparaît qu'une fois ; une pièce déjà au panier ou commandée n'y est plus. */
      function lignesSeuil(cmd) {
        var parCle = {}, res = [];
        toutesPieces().forEach(function (p) {
          if (!p.stockBas || !(p.quantiteACommander > 0)) return;
          var kc = cleCommune(p);
          var deja = cmd.some(function (x) {
            if (!kc) return cleCmd(x) === cleCmd(p);
            return String(p.reference || '').trim() ? refNorm(x.reference) === refNorm(p.reference) : (!String(x.reference || '').trim() && String(x.designation || '').trim() === String(p.designation || '').trim());
          });
          if (deja) return;
          var k = kc ? 'c|' + kc : 'l|' + cleCmd(p);
          if (parCle[k]) { if (parCle[k].materiels.indexOf(p.materiel) < 0) parCle[k].materiels.push(p.materiel); return; }
          res.push(parCle[k] = { origine: 'seuil', statut: '', materiel: p.materiel, materiels: [p.materiel], reference: p.reference || '', designation: p.designation, casier: p.casier,
            quantite: p.quantiteACommander, stock: p.quantiteStock, seuil: p.seuil, piece: p });
        });
        return res;
      }
      function compteurs() {
        var cmd = lignesCmd();
        return { panier: cmd.filter(function (x) { return x.statut !== 'Commandé'; }).length, commande: cmd.filter(function (x) { return x.statut === 'Commandé'; }).length, seuil: lignesSeuil(cmd).length };
      }

      /* ---------- commandes : 🛒 Mon panier -> Commandé -> Reçu ; ⚠ sous le seuil à part ---------- */
      function ecranCommander(racine) {
        racine.appendChild(el('div', { class: 'pp-barre' }, [el('h2', { class: 'pp-titre' }, ['Commandes'])]));
        var zone = el('div');
        racine.appendChild(zone);
        function rendre() {
          zone.innerHTML = '';
          var liste = lignesCmd();
          var panier = liste.filter(function (x) { return x.statut !== 'Commandé'; });
          var cmd = liste.filter(function (x) { return x.statut === 'Commandé'; });
          var seuil = lignesSeuil(liste);
          // 1) Mon panier : seulement les pièces choisies avec 🛒
          var c1 = el('section', { class: 'bandeau st-cmd-carte st-cmd-panier' }, [
            el('h3', { class: 'pp-h3' }, ['🛒 Mon panier (' + panier.length + ')']),
            el('p', { class: 'petit' }, ['Les pièces que tu as choisies avec 🛒. Le bon de commande PDF ne reprend que ces lignes.'])]);
          if (panier.length) {
            c1.appendChild(tableau(['Pièce', 'Qté', ''], panier.map(ligneDuPanierCmd), 'st-cmd'));
            c1.appendChild(el('div', { class: 'bg-boutons st-cmd-boutons' }, [
              el('button', { class: 'btn-second st-danger', type: 'button', onclick: function () {
                if (!confirm('Vider le panier (' + panier.length + ' pièce' + (panier.length > 1 ? 's' : '') + ') ?\nLes commandes déjà passées ne sont pas touchées.')) return;
                panier.forEach(function (it) { saisir({ type: 'stock.retirerPanier', quoi: 'panier', materiel: it.materiel, reference: it.reference, designation: it.designation }); });
                PM.toast('Panier vidé');
              } }, ['Vider le panier']),
              el('button', { class: 'btn-principal', type: 'button', onclick: function () { ouvrirBonDeCommande(panier); } }, ['🧾 Bon de commande (PDF)'])]));
          } else c1.appendChild(el('p', { class: 'petit st-cmd-vide' }, ['Panier vide : touche 🛒 sur une pièce, ou « + Panier » dans la liste « Sous le seuil mini » ci-dessous.']));
          zone.appendChild(c1);
          // 2) Sous le seuil mini : liste automatique, on choisit ce qu'on met au panier
          var c2 = el('section', { class: 'bandeau st-cmd-carte st-cmd-seuil' }, [
            el('h3', { class: 'pp-h3' }, ['⚠ Sous le seuil mini (' + seuil.length + ')']),
            el('p', { class: 'petit' }, ['Liste automatique : stock au seuil mini ou en dessous. Touche « + Panier » pour choisir ce que tu commandes.'])]);
          if (seuil.length) {
            c2.appendChild(tableau(['Pièce', 'Manque', ''], seuil.map(ligneSeuil), 'st-cmd'));
            c2.appendChild(el('div', { class: 'bg-boutons' }, [el('button', { class: 'btn-second', type: 'button', onclick: function () { exporterSeuil(seuil); } }, ['Exporter cette liste (PDF)'])]));
          } else c2.appendChild(el('p', { class: 'petit' }, ['Aucune pièce sous le seuil mini 🎉']));
          zone.appendChild(c2);
          // 3) Commandé, en attente de réception (inchangé)
          var c3 = el('section', { class: 'bandeau st-cmd-carte' }, [el('h3', { class: 'pp-h3' }, ['📦 Commandé, en attente de réception (' + cmd.length + ')'])]);
          c3.appendChild(cmd.length ? tableau(['Pièce', 'Qté', ''], cmd.map(ligneCommandee), 'st-cmd') : el('p', { class: 'petit' }, ['Aucune commande en cours.']));
          zone.appendChild(c3);
        }
        function descr(it) {
          var mats = it.materiels && it.materiels.length > 1 ? it.materiels.join(' + ') : it.materiel;
          return el('td', {}, [it.designation || it.reference,
            it.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['à envoyer']) : null,
            el('div', { class: 'st-sous' }, [(it.reference ? 'réf. ' + it.reference : 'sans référence') + ' · ' + mats + (it.casier ? ' · ' + rangementTexte(it.casier) : '') +
              (it.origine === 'seuil' ? ' · stock ' + it.stock + ' / seuil ' + it.seuil : '') +
              (it.statut === 'Commandé' ? ' · commandé le ' + (it.dateCommande || '?') + (it.fournisseur ? ' chez ' + it.fournisseur : '') : '')])]);
        }
        function pieceDe(it) { var k = cleCmd(it); return pieces(it.materiel).filter(function (x) { return cleCmd(x) === k; })[0]; }
        function voir(it) { return el('button', { class: 'pp-icone', type: 'button', title: 'Voir la pièce', onclick: function () {
          var p = it.piece || pieceDe(it);
          if (p) ouvrirFiche(p); else PM.toast('Pièce introuvable dans « ' + it.materiel + ' » : elle a peut-être été renommée ou supprimée.');
        } }, ['👁']); }
        function ligneDuPanierCmd(it) {
          function changer(d) {
            var q = Math.max(0, (it.quantite || 0) + d);
            if (q === it.quantite) return;
            if (q === 0 && !confirm('Retirer « ' + (it.designation || it.reference) + ' » du panier ?')) return;
            saisir(q === 0 ? { type: 'stock.retirerPanier', quoi: 'panier', materiel: it.materiel, reference: it.reference, designation: it.designation }
              : { type: 'stock.panier', materiel: it.materiel, reference: it.reference, designation: it.designation, casier: it.casier, quantite: q });
          }
          return el('tr', { class: it.enAttente ? 'attente' : '' }, [descr(it),
            el('td', {}, [el('div', { class: 'st-pm' }, [
              el('button', { type: 'button', 'aria-label': 'Moins', onclick: function () { changer(-1); } }, ['−']), el('b', {}, [String(it.quantite)]),
              el('button', { type: 'button', 'aria-label': 'Plus', onclick: function () { changer(1); } }, ['+'])])]),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'btn-second st-mini', type: 'button', title: 'Marquer comme commandé', onclick: function () { ouvrirCommande(it); } }, ['Commandé']),
              voir(it),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer du panier', onclick: function () { saisir({ type: 'stock.retirerPanier', quoi: 'panier', materiel: it.materiel, reference: it.reference, designation: it.designation }); } }, ['🗑'])])]);
        }
        function ligneSeuil(it) {
          return el('tr', {}, [descr(it), el('td', {}, [el('b', {}, [String(it.quantite)])]),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'btn-second st-mini', type: 'button', title: 'Ajouter au panier', onclick: function () { ouvrirPanier(it.piece, it.quantite); } }, ['+ Panier']),
              voir(it)])]);
        }
        function ligneCommandee(it) {
          return el('tr', { class: it.enAttente ? 'attente' : '' }, [descr(it), el('td', {}, [el('b', {}, [String(it.quantite)])]),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'btn-principal st-mini', type: 'button', title: 'Commande reçue : ajouter au stock', onclick: function () { ouvrirReception(it); } }, ['Reçu']),
              voir(it),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Annuler la commande', onclick: function () {
                if (confirm('Annuler la commande de ' + (it.designation || it.reference) + ' ?')) saisir({ type: 'stock.retirerPanier', quoi: 'commande', materiel: it.materiel, reference: it.reference, designation: it.designation });
              } }, ['🗑'])])]);
        }
        function ouvrirCommande(it) {
          var q = el('input', { type: 'text', inputmode: 'numeric', value: String(it.quantite || 1) });
          var four = el('input', { type: 'text', placeholder: 'ex : Vogelsang, Wangen, Bauer…', value: PM.Prefs.get('stock_dernier_fournisseur', '') });
          var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
          var fermer = modale('Marquer comme commandé', (it.designation || it.reference) + ' — ' + (it.reference ? 'réf. ' + it.reference : 'sans référence'), [
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
          var p = pieceDe(it);
          var fermer = modale('Commande reçue', (it.designation || it.reference) + (p ? ' — stock actuel : ' + p.quantiteStock : ''), [
            el('div', { class: 'champ' }, [el('label', {}, ['Quantité reçue (ajoutée au stock)']), q]), msg,
            el('button', { class: 'btn-principal', type: 'button', onclick: function () {
              var n = entier(q.value, 1);
              if (isNaN(n)) { msg.textContent = 'Quantité : nombre entier (1 ou plus).'; msg.hidden = false; return; }
              fermer(); saisir(Object.assign({ type: 'stock.reception', quoi: 'commande', materiel: it.materiel, reference: it.reference, designation: it.designation, quantite: n, fournisseur: it.fournisseur || '' },
                p ? { rowIndex: p.rowIndex, empreinte: { casier: p.casier || '', cotes: p.cotes || '' } } : {}));
              PM.toast('Reçu : +' + n + ' en stock');
            } }, ['Ajouter au stock'])]);
        }
        var cacheCmd = 'stock_commander_' + S;
        if (cmdServeur === null) PM.DB.get(cacheCmd).then(function (c) { if (cmdServeur === null) { cmdServeur = c || []; if (ecran === 'commander' && actif()) rendre(); } });
        if (!modeDemo) {
          var depart = Date.now();
          api('stock.commander', { panierSeul: true }, 60000).then(function (j) {
            cmdServeur = (j.liste || []).filter(function (x) { return x.origine === 'panier'; }); cmdLu = depart; PM.DB.set(cacheCmd, cmdServeur);
            if (ecran === 'commander' && actif() && !document.querySelector('.ag-modale')) rendre();
          })['catch'](function (e) { PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : commandes du dernier chargement', 4000); });
        } else if (cmdServeur === null) cmdServeur = [];
        if (cmdServeur !== null) rendre();
      }

      /* ---------- PDF (jsPDF chargé à la demande) ---------- */
      function chargerJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return new Promise(function (ok, ko) {
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = function () { window.jspdf && window.jspdf.jsPDF ? ok(window.jspdf.jsPDF) : ko(new Error('jsPDF absent')); };
          s.onerror = function () { s.remove(); ko(new Error('chargement impossible')); };
          document.head.appendChild(s);
        });
      }
      // Police standard du PDF (Helvetica) = caractères latins seulement : accents OK, le reste est remplacé
      function latin1(t) {
        return String(t === null || t === undefined ? '' : t).replace(/[’‘‚′`]/g, "'").replace(/[“”„″]/g, '"').replace(/[—–‑−]/g, '-').replace(/…/g, '...')
          .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/€/g, 'EUR').replace(/[   ]/g, ' ').replace(/[^\x00-\xFF]/g, '').replace(/\s+/g, ' ').trim();
      }
      function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
      /* o = { titre, lignes:[{reference, designation, materiel(s), quantite}], numero, fournisseur, demandeur, remarques, signatures, fichier } */
      function fabriquerPdf(JsPDF, o) {
        var doc = new JsPDF({ unit: 'mm', format: 'a4' }), G = 14, D = 196, BAS = 280, y;
        var site = latin1(T.site || ctx.site.nom), date = new Date().toLocaleDateString('fr-FR');
        var col = [{ x: G, w: 36, t: 'Réf.' }, { x: G + 38, w: 84, t: 'Désignation' }, { x: G + 124, w: 40, t: 'Matériel' }, { x: D, w: 14, t: 'Qté', droite: true }];
        function enteteTableau() {
          doc.setFillColor(232, 236, 235); doc.rect(G, y - 5, D - G, 8, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(30, 40, 38);
          col.forEach(function (c) { doc.text(latin1(c.t), c.x + (c.droite ? 0 : 1), y, c.droite ? { align: 'right' } : undefined); });
          doc.setFont('helvetica', 'normal'); y += 7;
        }
        // en-tête
        y = 20;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20, 30, 28); doc.text(latin1(o.titre), G, y);
        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        if (o.numero) doc.text('N° ' + o.numero, D, y - 5, { align: 'right' });
        doc.text('Date : ' + date, D, y + 1, { align: 'right' });
        y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(site, G, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Pièces détachées', G, y + 5);
        y += 11;
        var infos = [];
        if (o.demandeur !== undefined) infos.push(['Demandé par', latin1(o.demandeur) || '-']);
        if (o.fournisseur !== undefined) infos.push(['Fournisseur', latin1(o.fournisseur) || 'à préciser']);
        if (infos.length) {
          doc.setDrawColor(190, 198, 196); doc.setLineWidth(0.3); doc.rect(G, y, D - G, 7 * infos.length + 3);
          infos.forEach(function (l, i) { doc.setFont('helvetica', 'bold'); doc.text(latin1(l[0]) + ' :', G + 3, y + 6 + i * 7); doc.setFont('helvetica', 'normal'); doc.text(l[1], G + 33, y + 6 + i * 7); });
          y += 7 * infos.length + 11;
        } else y += 4;
        enteteTableau();
        // lignes (désignations longues : retour à la ligne, jamais coupées)
        var total = 0;
        doc.setFontSize(9.5);
        o.lignes.forEach(function (it, i) {
          var mat = it.materiels && it.materiels.length ? it.materiels.join(', ') : it.materiel;
          var cell = [doc.splitTextToSize(latin1(it.reference) || '-', col[0].w - 2), doc.splitTextToSize(latin1(it.designation) || '-', col[1].w - 2), doc.splitTextToSize(latin1(mat) || '-', col[2].w - 2)];
          var n = Math.max(cell[0].length, cell[1].length, cell[2].length), h = n * 4.2 + 2.8;
          if (y + h - 4 > BAS) { doc.addPage(); y = 20; enteteTableau(); doc.setFontSize(9.5); }
          if (i % 2) { doc.setFillColor(246, 248, 247); doc.rect(G, y - 4.2, D - G, h, 'F'); }
          doc.setTextColor(30, 40, 38);
          cell.forEach(function (lignes, k) { doc.text(lignes, col[k].x + 1, y); });
          doc.setFont('helvetica', 'bold'); doc.text(String(it.quantite), D - 1, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
          doc.setDrawColor(220, 225, 224); doc.setLineWidth(0.1); doc.line(G, y - 4.2 + h, D, y - 4.2 + h);
          y += h; total += Number(it.quantite) || 0;
        });
        y += 4;
        if (y > BAS) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text('Total : ' + o.lignes.length + ' ligne' + (o.lignes.length > 1 ? 's' : '') + ', ' + total + ' pièce' + (total > 1 ? 's' : ''), D, y, { align: 'right' });
        doc.setFont('helvetica', 'normal'); y += 8;
        if (o.signatures) {
          var rem = doc.splitTextToSize(latin1(o.remarques), D - G - 6), hR = Math.max(22, rem.length * 4.5 + 10);
          if (y + hR + 38 > 287) { doc.addPage(); y = 20; }
          doc.setDrawColor(190, 198, 196); doc.setLineWidth(0.3); doc.rect(G, y, D - G, hR);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('Remarques', G + 3, y + 5);
          doc.setFont('helvetica', 'normal'); if (rem.length) doc.text(rem, G + 3, y + 10);
          y += hR + 6;
          var l2 = (D - G - 6) / 2;
          [['Demandeur', G], ['Validation / visa', G + l2 + 6]].forEach(function (s) {
            doc.rect(s[1], y, l2, 30);
            doc.setFont('helvetica', 'bold'); doc.text(latin1(s[0]), s[1] + 3, y + 5);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text('Date et signature :', s[1] + 3, y + 10); doc.setFontSize(9.5);
          });
        }
        // pied de page : numéro de page sur chaque page
        var nb = doc.getNumberOfPages();
        for (var p = 1; p <= nb; p++) {
          doc.setPage(p); doc.setFontSize(8); doc.setTextColor(120, 130, 128);
          doc.text(latin1(site + ' - ' + o.titre.toLowerCase() + (o.numero ? ' ' + o.numero : '') + ' - ' + date), G, 290);
          doc.text('Page ' + p + ' / ' + nb, D, 290, { align: 'right' });
        }
        doc.save(o.fichier);
      }
      function erreurPdf(e) {
        PM.toast(/chargement|jsPDF/.test(e && e.message || '') ? 'Pas de connexion : la bibliothèque PDF n’a pas pu se charger. Réessaie avec du réseau.'
          : 'Le PDF n’a pas pu être créé (' + ((e && e.message) || 'erreur inconnue') + ') : réessaie, ou recharge l’appli.', 6000);
      }
      /* Bon de commande : UNIQUEMENT les pièces du panier. Fournisseur demandé avant (prérempli avec le dernier utilisé). */
      function ouvrirBonDeCommande(panier) {
        if (!panier.length) { PM.toast('Le panier est vide : rien à mettre dans le bon de commande.'); return; }
        var agent = PM.Prefs.get('agent', '');
        if (!agent) { demanderAgent(function () { ouvrirBonDeCommande(panier); }); return; }
        var four = el('input', { type: 'text', placeholder: 'ex : Vogelsang, Wangen, Bauer…', value: PM.Prefs.get('stock_dernier_fournisseur', ''), autocomplete: 'off' });
        var rem = el('textarea', { rows: '3', placeholder: 'ex : livraison au site, urgent…' });
        var coche = el('input', { type: 'checkbox' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var btn = el('button', { class: 'btn-principal', type: 'button' }, ['🧾 Créer le PDF']);
        var fermer = modale('Bon de commande', panier.length + ' ligne' + (panier.length > 1 ? 's' : '') + ' du panier · demandé par ' + agent, [
          el('div', { class: 'champ' }, [el('label', {}, ['Fournisseur (facultatif)']), four]),
          el('div', { class: 'champ' }, [el('label', {}, ['Remarques (facultatif)']), rem]),
          el('label', { class: 'st-coche' }, [coche, ' Marquer ces pièces comme commandées']), msg, btn]);
        btn.onclick = function () {
          var f = four.value.trim(), d = new Date();
          var numero = 'BC-' + d.getFullYear() + deuxChiffres(d.getMonth() + 1) + deuxChiffres(d.getDate()) + '-' + deuxChiffres(d.getHours()) + deuxChiffres(d.getMinutes());
          PM.Prefs.set('stock_dernier_fournisseur', f);
          btn.disabled = true; btn.textContent = 'Création du PDF…';
          chargerJsPdf().then(function (JsPDF) {
            fabriquerPdf(JsPDF, { titre: 'BON DE COMMANDE', lignes: panier, numero: numero, fournisseur: f, demandeur: agent, remarques: rem.value.trim(), signatures: true,
              fichier: 'bon-de-commande-' + d.toISOString().slice(0, 10) + '.pdf' });
            fermer();
            if (coche.checked) {
              panier.forEach(function (it) { saisir({ type: 'stock.commande', materiel: it.materiel, reference: it.reference, designation: it.designation, casier: it.casier, quantite: it.quantite, fournisseur: f }); });
              PM.toast('Bon ' + numero + ' créé · ' + panier.length + ' pièce(s) passée(s) en « Commandé »', 5000);
            } else PM.toast('Bon de commande ' + numero + ' créé');
          })['catch'](function (e) { btn.disabled = false; btn.textContent = '🧾 Créer le PDF'; msg.hidden = true; erreurPdf(e); });
        };
        setTimeout(function () { four.focus(); }, 30);
      }
      function exporterSeuil(liste) {
        if (!liste.length) { PM.toast('Aucune pièce sous le seuil mini : rien à exporter.'); return; }
        chargerJsPdf().then(function (JsPDF) {
          fabriquerPdf(JsPDF, { titre: 'PIÈCES SOUS LE SEUIL MINI', lignes: liste, fichier: 'sous-le-seuil-' + new Date().toISOString().slice(0, 10) + '.pdf' });
        })['catch'](erreurPdf);
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
                  el('td', {}, [x.designation, x.casier ? el('div', { class: 'st-sous' }, [rangementTexte(x.casier)]) : null]),
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
                return el('div', { class: 'st-emplacement' }, [e.site + ' — ' + e.materiel + ' (' + (e.casier ? rangementTexte(e.casier) : 'rangement non renseigné') + ')']);
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
          // Étapes secondaires qui ont planté (copie sur l'autre site, historique, contrôle de nuit…) : la saisie elle-même est gardée
          var soucis = j.soucis || [];
          if (T) T.nbSoucis = soucis.length;
          if (soucis.length) {
            var bs = el('div', { class: 'bandeau st-soucis' }, [
              el('b', {}, ['⚠ Étapes non terminées (' + soucis.length + ')']),
              el('p', { class: 'petit' }, ['La saisie est bien enregistrée ; la mise en commun / le contrôle de nuit remettra les deux sites d’accord.'])]);
            soucis.slice(0, 20).forEach(function (x) { bs.appendChild(el('div', { class: 'st-emplacement' }, [new Date(x.quand).toLocaleString('fr-FR') + ' — ' + x.message])); });
            var bEff = el('button', { class: 'btn-second', type: 'button', onclick: function () {
              bEff.disabled = true;
              api('stock.soucisEffacer', { jusqua: soucis[0].quand }, 30000).then(function (k) {
                var reste = k.soucis || [];
                if (T) T.nbSoucis = reste.length;
                PM.toast(reste.length ? 'Effacé (' + reste.length + ' nouveau(x) souci(s) arrivé(s) entre-temps : rouvre le contrôle pour les voir)' : 'Soucis effacés');
                bs.remove();
                var bo = vue.querySelector('.st-outils'); if (bo) bo.replaceWith(barreOutils()); // pastille ⚠ de 🩺 à jour, sans relancer tout le contrôle
              })['catch'](function (e) { bEff.disabled = false; PM.toast('Impossible d’effacer : ' + e.message + '. Réessaie avec du réseau.', 5000); });
            } }, ['J’ai vu, effacer']);
            bs.appendChild(el('div', { class: 'bg-boutons' }, [bEff]));
            zone.appendChild(bs);
          }
          function bloc(titre, aide, liste, texte) {
            total += liste.length;
            var d = el('details', { class: 'bandeau st-controle' + (liste.length ? '' : ' st-ok-bloc') }, [
              el('summary', {}, [el('b', {}, [(liste.length ? '⚠ ' : '✓ ') + titre]), el('span', { class: 'st-badge ' + (liste.length ? 'st-alerte' : 'st-envoi') }, [String(liste.length)])]),
              el('p', { class: 'petit' }, [aide])]);
            liste.slice(0, 200).forEach(function (x) { d.appendChild(el('div', { class: 'st-emplacement' }, [texte(x)])); });
            zone.appendChild(d);
          }
          bloc('Écarts entre une ligne et le stock commun', 'La quantité écrite sur la ligne (celle que l’appli affiche) ne correspond pas à la copie du stock commun : souvent une correction faite à la main dans Sheets. « Mettre en commun maintenant » (plus bas) remet tout d’accord.', r.ecarts || [],
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
          // (les feuilles font foi : les écarts se règlent par la mise en commun, bloc ci-dessous)
          if (!total) zone.insertBefore(el('div', { class: 'vide-msg' }, ['Tout est propre 👍']), zone.firstChild);
          zone.appendChild(blocMiseEnCommun());
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

      // plein écran : une photo ou plusieurs (glisser à gauche / à droite, ou flèches) ; toucher le fond = fermer
      function pleinEcran(liste, debut) {
        liste = (typeof liste === 'string' ? liensPhotos(liste) : liste || []).filter(function (u) { return urlPhoto(u); });
        if (!liste.length) return;
        var i = Math.min(Math.max(debut || 0, 0), liste.length - 1);
        var img = el('img', { alt: 'Photo de la pièce' }), compteur = el('div', { class: 'st-plein-nb' });
        function montrer() { img.src = urlPhoto(liste[i]); compteur.textContent = liste.length > 1 ? (i + 1) + ' / ' + liste.length : ''; }
        function aller2(d) { i = (i + d + liste.length) % liste.length; montrer(); }
        var plusieurs = liste.length > 1;
        var fond = el('div', { class: 'ag-modale st-plein', role: 'dialog', onclick: function () { fond.remove(); } }, [
          img, compteur,
          plusieurs ? el('button', { class: 'st-plein-fl st-plein-g', type: 'button', 'aria-label': 'Photo précédente', onclick: function (e) { e.stopPropagation(); aller2(-1); } }, ['‹']) : null,
          plusieurs ? el('button', { class: 'st-plein-fl st-plein-d', type: 'button', 'aria-label': 'Photo suivante', onclick: function (e) { e.stopPropagation(); aller2(1); } }, ['›']) : null]);
        var x0 = null;
        fond.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
        fond.addEventListener('touchend', function (e) {
          if (x0 === null || !plusieurs) return;
          var dx = e.changedTouches[0].clientX - x0; x0 = null;
          if (Math.abs(dx) > 40) { e.preventDefault(); aller2(dx < 0 ? 1 : -1); }
        });
        montrer();
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
