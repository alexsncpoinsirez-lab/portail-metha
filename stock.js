/* =====================================================================
   MODULE « STOCK PIÈCES DÉTACHÉES » — version rapide
   Reprend l'appli d'origine (classeur « Appli Stock Metha ») :
   matériels du site (badge pièces sous seuil), pièces d'un matériel,
   fiche pièce (quantité, casier, seuil, référence, désignation, photo,
   documents, QR code), panier « À commander », recherche par référence
   (actuelle ou ancienne, tous sites), historique, stock commun,
   impression des QR codes, scan d'un QR code.
   Chaque site ne modifie que SON listing (le serveur du site le fixe) ;
   le stock des références communes reste partagé comme avant.
   Les modifications fonctionnent sans réseau et partent dès que possible.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var OUTIL_DU_SITE = { site1: 'stock-rotte', site2: 'stock-arr' }; // site1/site2 = ordre de l'onglet Sites du hub

  /* ---------- outils ---------- */
  function cle(p) { return String(p.reference || '').trim() || String(p.designation || '').trim(); }
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

  function demo() {
    return {
      site: 'Démonstration', urlScanner: '',
      materiels: [{ nom: 'Broyeur', nbAlertes: 1, nbPieces: 3 }, { nom: 'Séparateur Bauer', nbAlertes: 0, nbPieces: 2 }],
      pieces: {
        'Broyeur': [
          { rowIndex: 2, reference: 'GFL 952 M9', designation: 'Grille', quantiteStock: 6, seuil: 3, quantiteACommander: 0, casier: '2F', cotes: '', substitution: '', reperes: '', photo: '', partage: false, stockBas: false },
          { rowIndex: 3, reference: 'GSM019E4', designation: 'Couteau', quantiteStock: 2, seuil: 16, quantiteACommander: 14, casier: '', cotes: '', substitution: '', reperes: '', photo: '', partage: false, stockBas: true },
          { rowIndex: 4, reference: 'DFD0019', designation: 'Mousse O', quantiteStock: 44, seuil: 8, quantiteACommander: 0, casier: '', cotes: '121x6,5x10', substitution: '', reperes: '', photo: '', partage: false, stockBas: false }],
        'Séparateur Bauer': [
          { rowIndex: 2, reference: '2003654', designation: 'Grand tamis', quantiteStock: 1, seuil: 1, quantiteACommander: 0, casier: '3C', cotes: '', substitution: '', reperes: '40', photo: '', partage: false, stockBas: true },
          { rowIndex: 3, reference: '2003611', designation: 'Vis', quantiteStock: 2, seuil: 1, quantiteACommander: 0, casier: '3B', cotes: '', substitution: '', reperes: '33', photo: '', partage: true, stockBas: false }]
      }
    };
  }

  window.MODULES.stock = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var S = ctx.site.id;
      var CLE_MAT = 'stock_materiels_' + S, CLE_ATT = 'stock_attente_' + S;
      function clePieces(m) { return 'stock_pieces_' + S + '_' + m; }
      var DEMO = modeDemo ? demo() : null;
      var M = null;                 // { site, siteId, materiels, urlScanner }
      var piecesCache = {};         // materiel -> pièces du serveur
      var attente = [];             // modifications pas encore confirmées par le serveur
      var ecran = 'materiels', materiel = null, filtre = '';
      var params = ctx.params || [];
      var instance = PM.uid();
      window.__stInstance = instance;
      function actif() { return window.__stInstance === instance && location.hash.indexOf('outil/' + ctx.outil.id) >= 0; }

      function api(action, extra, delai) {
        if (modeDemo) return Promise.reject(new Error('Mode démonstration : renseigne le serveur du site dans Réglages.'));
        return PM.Api.appeler(ctx.apiUrl, Object.assign({ action: action, cle: ctx.cle }, extra || {}), delai || 45000);
      }

      /* ---------- démarrage ---------- */
      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_MAT), PM.DB.get(CLE_ATT)]).then(function (r) {
        M = r[0] || (modeDemo ? { site: DEMO.site, materiels: DEMO.materiels, urlScanner: '' } : null);
        attente = r[1] || [];
        if (params[0]) { ecran = 'pieces'; materiel = params[0]; }
        if (M || ecran === 'pieces') afficher();
        if (!modeDemo) chargerMateriels(!M);
        if (ecran === 'pieces') chargerPieces(materiel, params[1]);
      });

      function chargerMateriels(premier) {
        return api('stock.materiels').then(function (j) {
          M = { site: j.site, siteId: j.siteId, materiels: j.materiels || [], urlScanner: j.urlScanner || '' };
          PM.DB.set(CLE_MAT, M);
          if (ecran === 'materiels' && actif() && !document.querySelector('.ag-modale')) afficher();
        })['catch'](function (e) {
          if (premier && ecran === 'materiels') erreurChargement(e, function () { chargerMateriels(true); });
          else if (!premier) PM.toast('Hors ligne : données du dernier chargement');
        });
      }

      function chargerPieces(m, refAOuvrir) {
        var p = modeDemo ? Promise.resolve(DEMO.pieces[m] || []) : PM.DB.get(clePieces(m));
        p.then(function (c) {
          if (c) { piecesCache[m] = c; if (ecran === 'pieces' && materiel === m && actif()) afficher(); }
          if (modeDemo) { ouvrirRef(refAOuvrir); return; }
          api('stock.pieces', { materiel: m }).then(function (j) {
            piecesCache[m] = j.pieces || [];
            PM.DB.set(clePieces(m), piecesCache[m]);
            return nettoyerAttente().then(function () {
              if (ecran === 'pieces' && materiel === m && actif() && !document.querySelector('.ag-modale')) afficher();
              ouvrirRef(refAOuvrir);
            });
          })['catch'](function (e) {
            if (!c && ecran === 'pieces' && materiel === m) erreurChargement(e, function () { chargerPieces(m, refAOuvrir); });
            else { PM.toast('Hors ligne : données du dernier chargement'); ouvrirRef(refAOuvrir); }
          });
        });
      }
      function ouvrirRef(ref) {
        if (!ref) return;
        var p = pieces(materiel).filter(function (x) { return x.reference === ref; })[0];
        if (p) ouvrirFiche(p); else PM.toast('Pièce « ' + ref + ' » introuvable dans ' + materiel);
      }

      function erreurChargement(e, reessayer) {
        vue.innerHTML = '';
        vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le stock.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
          el('button', { class: 'btn-second', onclick: reessayer }, ['Réessayer']), ' ',
          el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
      }

      // Quand toutes les saisies sont parties, on recharge depuis le serveur (quantités partagées à jour)
      PM.Envoi.surChangement(function (n) {
        if (!actif() || n || !attente.length || modeDemo) return;
        if (ecran === 'pieces') chargerPieces(materiel); else chargerMateriels(false);
      });
      function nettoyerAttente() {
        return PM.DB.listerEnvois().then(function (l) {
          var ids = (l || []).filter(function (x) { return !x.rejete; }).map(function (x) { return x.payload.id; });
          attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
          PM.DB.set(CLE_ATT, attente);
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
        if (modeDemo) {
          attente.push(payload);
          if (payload.materiel && DEMO.pieces[payload.materiel]) piecesCache[payload.materiel] = DEMO.pieces[payload.materiel] = pieces(payload.materiel);
          if (payload.type === 'stock.materiel') DEMO.materiels.push({ nom: payload.nom, nbAlertes: 0, nbPieces: 0 });
          attente = [];
          afficher();
          return;
        }
        attente.push(payload);
        PM.DB.set(CLE_ATT, attente);
        PM.Envoi.ajouter(S, payload, avecPhoto);
        afficher();
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

      // Pièces affichées = dernières pièces du serveur + modifications en attente
      function pieces(m) {
        var liste = (piecesCache[m] || []).map(function (p) { return Object.assign({}, p); });
        var TYPES_PIECE = ['stock.quantite', 'stock.seuil', 'stock.casier', 'stock.designation', 'stock.reference', 'stock.photo', 'stock.retirerPhoto'];
        attente.forEach(function (a) {
          if (a.materiel !== m) return;
          if (a.type !== 'stock.piece' && TYPES_PIECE.indexOf(a.type) < 0) return;
          if (a.type === 'stock.piece') {
            var np = a.piece;
            liste.push({ rowIndex: null, reference: np.reference || '', designation: np.designation, quantiteStock: np.quantiteStock || 0, seuil: np.seuil || 0,
              quantiteACommander: Math.max((np.seuil || 0) - (np.quantiteStock || 0), 0), casier: np.casier || '', cotes: '', substitution: '', reperes: '',
              photo: np.photo || '', partage: false, stockBas: (np.quantiteStock || 0) <= (np.seuil || 0), enAttente: true });
            return;
          }
          var cible = liste.filter(function (p) { return a.rowIndex && p.rowIndex === a.rowIndex && cle(p) === cle(a); })[0]
            || liste.filter(function (p) { return cle(p) === cle(a); })[0];
          if (!cible) return;
          var memeRef = a.reference ? liste.filter(function (p) { return p.reference === a.reference; }) : [cible];
          if (a.type === 'stock.quantite') memeRef.forEach(function (p) { p.quantiteStock = Math.max(0, p.quantiteStock + a.delta); });
          else if (a.type === 'stock.seuil') memeRef.forEach(function (p) { p.seuil = a.seuil; });
          else if (a.type === 'stock.casier') cible.casier = a.casier;
          else if (a.type === 'stock.designation') cible.designation = a.nouvelle;
          else if (a.type === 'stock.reference') { cible.reference = a.nouvelle; cible.partage = false; }
          else if (a.type === 'stock.photo') cible.photo = a.photo;
          else if (a.type === 'stock.retirerPhoto') cible.photo = '';
          memeRef.concat([cible]).forEach(function (p) {
            p.quantiteACommander = Math.max(p.seuil - p.quantiteStock, 0);
            p.stockBas = p.quantiteStock <= p.seuil;
          });
          cible.enAttente = true;
        });
        return liste;
      }
      function refPiece(p) { return { materiel: materiel, rowIndex: p.rowIndex, reference: p.reference, designation: p.designation }; }

      /* ================= écrans ================= */
      function afficher() {
        if (!actif()) return;
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'stock' });
        vue.appendChild(racine);
        if (modeDemo) racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
          el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur du site dans ']), el('a', { href: '#reglages' }, ['Réglages']), '.']));
        racine.appendChild(barreOutils());
        if (ecran === 'pieces') ecranPieces(racine);
        else if (ecran === 'commander') ecranCommander(racine);
        else if (ecran === 'recherche') ecranRecherche(racine);
        else if (ecran === 'historique') ecranHistorique(racine);
        else if (ecran === 'communes') ecranCommunes(racine);
        else ecranMateriels(racine);
        window.scrollTo(0, ecran === 'recherche' ? 0 : y);
      }
      function aller(e, m) { ecran = e; if (m !== undefined) materiel = m; filtre = ''; afficher(); window.scrollTo(0, 0); }

      function barreOutils() {
        function b(txt, titre, fn, actifSi) {
          return el('button', { class: 'st-outil' + (actifSi ? ' actif' : ''), type: 'button', title: titre, 'aria-label': titre, onclick: fn }, [txt]);
        }
        return el('div', { class: 'st-outils' }, [
          b('▦ Matériels', 'Matériels du site', function () { aller('materiels'); }, ecran === 'materiels' || ecran === 'pieces'),
          b('🔍', 'Recherche par référence', function () { aller('recherche'); }, ecran === 'recherche'),
          b('📷', 'Scanner un QR code', scanner),
          b('🛒', 'À commander', function () { aller('commander'); }, ecran === 'commander'),
          b('📜', 'Historique des mouvements', function () { aller('historique'); }, ecran === 'historique'),
          b('🔗', 'Pièces au stock commun', function () { aller('communes'); }, ecran === 'communes')
        ]);
      }

      /* ---------- matériels du site ---------- */
      function ecranMateriels(racine) {
        var mats = ((M && M.materiels) || []).slice();
        attente.forEach(function (a) {
          if (a.type === 'stock.materiel' && !mats.some(function (m) { return m.nom === a.nom; })) mats.push({ nom: a.nom, nbAlertes: 0, nbPieces: 0, enAttente: true });
        });
        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('h2', { class: 'pp-titre' }, [(M && M.site) || ctx.site.nom]),
          el('button', { class: 'btn-second', type: 'button', onclick: ouvrirAjoutMateriel }, ['+ Ajouter un matériel'])]));
        if (!mats.length) { racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucun matériel trouvé dans ce fichier.'])); return; }
        var g = el('div', { class: 'pp-grille' });
        mats.forEach(function (m, i) {
          g.appendChild(el('button', { class: 'pp-carte st-carte', type: 'button', style: '--i:' + i, onclick: function () { aller('pieces', m.nom); chargerPieces(m.nom); } }, [
            el('div', { class: 'st-carte-tete' }, [el('span', { class: 'pp-nom' }, [m.nom]),
              m.nbAlertes ? el('span', { class: 'st-pastille', title: m.nbAlertes + ' pièce(s) sous le seuil' }, [String(m.nbAlertes)]) : null]),
            el('div', { class: 'pp-der' }, [m.enAttente ? 'en attente d’envoi…' : (m.nbPieces + ' pièce' + (m.nbPieces > 1 ? 's' : '') + (m.nbAlertes ? ' · ' + m.nbAlertes + ' sous seuil' : ''))])
          ]));
        });
        racine.appendChild(g);
      }
      function ouvrirAjoutMateriel() {
        var inp = el('input', { type: 'text', placeholder: 'ex : Broyeur, Pompe doseuse…' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var fermer = modale('Ajouter un matériel', 'Crée un nouvel onglet dans le fichier du site, avec les colonnes habituelles.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Nom du matériel']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var nom = inp.value.trim();
            if (!nom) { msg.textContent = 'Indique un nom.'; msg.hidden = false; return; }
            if (((M && M.materiels) || []).some(function (m) { return m.nom.toLowerCase() === nom.toLowerCase(); })) { msg.textContent = 'Ce matériel existe déjà.'; msg.hidden = false; return; }
            fermer(); saisir({ type: 'stock.materiel', nom: nom }); PM.toast('Matériel ajouté');
          } }, ['Ajouter'])]);
        setTimeout(function () { inp.focus(); }, 30);
      }

      /* ---------- pièces d'un matériel ---------- */
      function ecranPieces(racine) {
        var liste = pieces(materiel);
        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('button', { class: 'btn-second', type: 'button', onclick: function () { aller('materiels'); chargerMateriels(false); } }, ['← Matériels']),
          el('h2', { class: 'pp-titre' }, [materiel])]));
        var champ = el('input', { type: 'search', class: 'st-filtre', placeholder: 'Filtrer (désignation, référence, casier)…', value: filtre, autocomplete: 'off' });
        racine.appendChild(el('div', { class: 'st-actions' }, [champ,
          el('button', { class: 'btn-second', type: 'button', onclick: function () { imprimerQr(liste.filter(function (p) { return p.reference; }), (M && M.site ? M.site + ' — ' : '') + materiel); } }, ['🖨 QR codes']),
          el('button', { class: 'btn-second', type: 'button', onclick: ouvrirAjoutPiece }, ['+ Ajouter une pièce'])]));
        var conteneur = el('div');
        racine.appendChild(conteneur);
        function remplir() {
          conteneur.innerHTML = '';
          var f = filtre.toLowerCase();
          var vues = liste.filter(function (p) { return !f || [p.designation, p.reference, p.casier, p.ancienneReference].join(' ').toLowerCase().indexOf(f) >= 0; });
          if (!piecesCache[materiel] && !modeDemo) { conteneur.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])); return; }
          if (!vues.length) { conteneur.appendChild(el('div', { class: 'vide-msg' }, [liste.length ? 'Aucune pièce ne correspond.' : 'Aucune pièce enregistrée.'])); return; }
          var tbody = el('tbody');
          vues.forEach(function (p) { tbody.appendChild(lignePiece(p)); });
          conteneur.appendChild(el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table st-pieces' }, [
            el('thead', {}, [el('tr', {}, ['Référence', 'Désignation', 'Casier', 'Stock', ''].map(function (h) { return el('th', {}, [h]); }))]), tbody])]));
        }
        champ.addEventListener('input', function () { filtre = champ.value; remplir(); });
        remplir();
      }
      function lignePiece(p) {
        var sous = [];
        if (p.cotes) sous.push(p.cotes);
        if (p.reperes) sous.push('rep. ' + p.reperes);
        if (p.substitution) sous.push('subst. ' + p.substitution);
        var tr = el('tr', { class: (p.stockBas ? 'st-bas' : '') + (p.enAttente ? ' attente' : '') }, [
          el('td', { class: 'st-ref' }, [p.reference || '—', urlPhoto(p.photo) ? el('button', { class: 'pp-icone', type: 'button', title: 'Voir la photo', onclick: function () { pleinEcran(p.photo); } }, ['📷']) : null]),
          el('td', {}, [el('span', {}, [p.designation]),
            p.partage ? el('span', { class: 'st-badge st-partage', title: 'Référence retrouvée sur un autre site ou matériel : stock partagé' }, ['🔗 Partagé']) : null,
            p.stockBas ? el('span', { class: 'st-badge st-alerte' }, ['Stock bas']) : null,
            p.enAttente ? el('span', { class: 'st-badge st-envoi' }, ['à envoyer']) : null,
            sous.length ? el('div', { class: 'st-sous' }, [sous.join(' · ')]) : null]),
          el('td', {}, [p.casier || '']),
          el('td', {}, [el('button', { class: 'st-qte', type: 'button', title: 'Modifier la quantité', onclick: function () { ouvrirQuantite(p); } }, [String(p.quantiteStock)]),
            p.quantiteACommander > 0 ? el('div', { class: 'st-acommander' }, ['à commander : ' + p.quantiteACommander]) : null]),
          el('td', { class: 'pp-actions' }, [
            el('button', { class: 'pp-icone', type: 'button', title: 'Ajouter au panier', onclick: function () { ouvrirPanier(p); } }, ['🛒']),
            el('button', { class: 'pp-icone', type: 'button', title: 'Détails', onclick: function () { ouvrirFiche(p); } }, ['ℹ️'])])
        ]);
        return tr;
      }

      /* ---------- fiche pièce ---------- */
      var rafraichirFiche = null;
      function ouvrirFiche(p0) {
        var corps = el('div');
        var fermer = modale(p0.designation || p0.reference || 'Pièce', materiel, [corps]);
        var docs = null;
        function piece() {
          return pieces(materiel).filter(function (x) { return p0.rowIndex ? x.rowIndex === p0.rowIndex : cle(x) === cle(p0); })[0] || p0;
        }
        function ligne(lib, val, edit) {
          return [el('dt', {}, [lib]), el('dd', {}, [val === '' || val === null || val === undefined ? el('span', { class: 'petit' }, ['non renseigné']) : String(val),
            edit ? el('button', { class: 'pp-icone', type: 'button', title: 'Modifier ' + lib.toLowerCase(), onclick: edit }, ['✎']) : null])];
        }
        function rendre() {
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
          // photo
          var src = urlPhoto(p.photo);
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Photo',
            el('button', { class: 'pp-icone', type: 'button', title: src ? 'Remplacer la photo' : 'Ajouter une photo', onclick: function () { choisirPhoto(p); } }, [src ? '✎' : '+'])]),
            src ? el('div', { class: 'st-photo' }, [el('img', { src: src, alt: 'Photo de la pièce', onclick: function () { pleinEcran(p.photo); } }),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer la photo', onclick: function () {
                if (confirm('Retirer la photo de cette pièce ?')) saisir(Object.assign({ type: 'stock.retirerPhoto' }, refPiece(p)));
              } }, ['🗑'])])
              : (p.photo && !lienSur(p.photo) ? el('p', { class: 'petit' }, ['📷 ' + p.photo + ' (voir la colonne Photo du Google Sheets)']) : el('p', { class: 'petit' }, ['Aucune photo pour l’instant.']))]));
          // QR code
          if (p.reference) corps.appendChild(el('div', { class: 'st-qr' }, [el('div', { class: 'st-section-titre' }, ['QR code — à coller sur le casier']),
            el('img', { src: urlQr(p, 180), alt: 'QR code', width: '180', height: '180' })]));
          // documents
          var zoneDocs = el('div', { class: 'st-docs' });
          corps.appendChild(el('div', { class: 'st-section' }, [el('div', { class: 'st-section-titre' }, ['Documents',
            p.reference ? el('button', { class: 'pp-icone', type: 'button', title: 'Ajouter un document', onclick: function () { ajouterDocument(p); } }, ['+']) : null]), zoneDocs]));
          remplirDocs(zoneDocs, p);
          corps.appendChild(el('div', { class: 'bg-boutons st-fiche-boutons' }, [
            el('button', { class: 'btn-second', type: 'button', onclick: function () { imprimerQr([p], p.designation || p.reference); } }, ['🖨 Imprimer']),
            el('button', { class: 'btn-second', type: 'button', onclick: function () { ouvrirPanier(p); } }, ['🛒 Panier']),
            el('button', { class: 'btn-second', type: 'button', onclick: function () { fermer(); scanner(); } }, ['📷 Scanner suivant'])]));
        }
        function remplirDocs(zone, p) {
          if (!p.reference) { zone.appendChild(el('p', { class: 'petit' }, ['Pas de référence sur cette pièce : impossible d’y associer un document.'])); return; }
          var enAtt = attente.filter(function (a) { return a.type === 'stock.document' && a.reference === p.reference; })
            .map(function (a) { return { nom: a.nom, lien: a.lien, enAttente: true }; });
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
                  if (confirm('Retirer « ' + d.nom + ' » ?')) { saisir({ type: 'stock.retirerDocument', reference: p.reference, lien: d.lien }); docs = null; }
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
        var obs = setInterval(function () { if (!document.body.contains(corps)) { clearInterval(obs); if (rafraichirFiche === rendre) rafraichirFiche = null; } }, 1000);
      }
      function apresModif() { afficher(); if (rafraichirFiche) rafraichirFiche(); }

      /* ---------- modifications ---------- */
      function ouvrirQuantite(p) {
        var sens = -1;
        var inp = el('input', { type: 'text', inputmode: 'numeric', value: '1', autocomplete: 'off' });
        var bR = el('button', { class: 'st-sens actif', type: 'button' }, ['− Retirer']);
        var bA = el('button', { class: 'st-sens', type: 'button' }, ['+ Ajouter']);
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function majSens(s) { sens = s; bR.classList.toggle('actif', s === -1); bA.classList.toggle('actif', s === 1); }
        bR.onclick = function () { majSens(-1); }; bA.onclick = function () { majSens(1); };
        var fermer = modale('Modifier la quantité', (p.designation || p.reference) + ' — stock actuel : ' + p.quantiteStock, [
          el('div', { class: 'st-sens-ligne' }, [bR, bA]),
          el('div', { class: 'st-rapides' }, [1, 2, 5, 10].map(function (v) { return el('button', { class: 'st-chip', type: 'button', onclick: function () { inp.value = v; } }, [String(v)]); })),
          el('div', { class: 'champ' }, [el('label', {}, ['Quantité']), inp]), msg,
          el('button', { class: 'btn-principal', type: 'button', onclick: valider }, ['Valider'])]);
        function valider() {
          var q = entier(inp.value, 1);
          if (isNaN(q)) { msg.textContent = 'Saisis un nombre entier (1 ou plus).'; msg.hidden = false; return; }
          if (p.quantiteStock + sens * q < 0) { msg.textContent = 'La quantité ne peut pas devenir négative.'; msg.hidden = false; return; }
          fermer();
          saisir(Object.assign({ type: 'stock.quantite', delta: sens * q }, refPiece(p)));
          apresModif();
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
            fermer(); saisir(Object.assign({ type: type, nouvelle: v }, refPiece(p))); apresModif();
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
            fermer(); saisir(Object.assign({ type: 'stock.seuil', seuil: v }, refPiece(p))); apresModif();
          } }, ['Enregistrer'])]);
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }
      function editerCasier(p) {
        var inp = el('input', { type: 'text', value: p.casier || '', placeholder: 'ex : 3 G, C10 / 1', autocomplete: 'off' });
        var sugg = el('div', { class: 'st-sugg' });
        var fermer = modale('Modifier le casier', 'Le casier reste propre à cette ligne, même pour une référence partagée.', [
          el('div', { class: 'champ' }, [el('label', {}, ['Casier']), inp]), sugg,
          el('button', { class: 'btn-principal', type: 'button', onclick: function () {
            var v = inp.value.trim();
            if (v === (p.casier || '')) { fermer(); return; }
            if (!confirm('Changer le casier de « ' + (p.casier || 'non renseigné') + ' » à « ' + (v || 'non renseigné') + ' » ?')) return;
            fermer(); saisir(Object.assign({ type: 'stock.casier', casier: v }, refPiece(p))); apresModif();
          } }, ['Enregistrer'])]);
        if (p.partage && p.reference && !modeDemo) {
          sugg.appendChild(el('p', { class: 'petit' }, ['Recherche des autres emplacements…']));
          api('stock.emplacements', { reference: p.reference, materiel: materiel, rowIndex: p.rowIndex }).then(function (j) {
            sugg.innerHTML = '';
            var autres = (j.emplacements || []).filter(function (e) { return e.casier; });
            if (!autres.length) return;
            sugg.appendChild(el('p', { class: 'petit' }, ['Même référence ailleurs :']));
            autres.forEach(function (e) {
              sugg.appendChild(el('button', { class: 'st-sugg-btn', type: 'button', onclick: function () { inp.value = e.casier; } }, ['Même casier que ' + e.site + ' — ' + e.materiel + ' (' + e.casier + ')']));
            });
          })['catch'](function () { sugg.innerHTML = ''; });
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
            PM.toast('Photo enregistrée'); apresModif();
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
            fermer(); saisir({ type: 'stock.document', reference: p.reference, nom: nom.value.trim(), lien: lien.value.trim() }); PM.toast('Document ajouté'); apresModif();
          } }, ['Ajouter'])]);
      }
      function ouvrirAjoutPiece() {
        var c = {
          designation: el('input', { type: 'text' }), reference: el('input', { type: 'text' }),
          quantite: el('input', { type: 'text', inputmode: 'numeric', value: '0' }), seuil: el('input', { type: 'text', inputmode: 'numeric', value: '0' }),
          casier: el('input', { type: 'text', placeholder: 'ex : 3 G, C10 / 1' }), photo: el('input', { type: 'file', accept: 'image/*', capture: 'environment' })
        };
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        function champ(lib, i) { return el('div', { class: 'champ' }, [el('label', {}, [lib]), i]); }
        var fermer = modale('Ajouter une pièce', materiel, [
          champ('Désignation', c.designation), champ('Référence', c.reference),
          el('div', { class: 'pp-deux' }, [champ('Quantité de départ', c.quantite), champ('Seuil', c.seuil)]),
          champ('Casier', c.casier), champ('Photo (facultatif)', c.photo),
          el('p', { class: 'petit' }, ['Même référence qu’une pièce existante (ce site ou l’autre) = stock partagé automatiquement. Côtes, Substitution et Repères restent modifiables dans le Google Sheets du site.']),
          msg, el('button', { class: 'btn-principal', type: 'button', onclick: valider }, ['Ajouter'])]);
        function valider() {
          var q = entier(c.quantite.value, 0), s = entier(c.seuil.value, 0);
          if (!c.designation.value.trim()) { msg.textContent = 'La désignation est obligatoire.'; msg.hidden = false; return; }
          if (isNaN(q) || isNaN(s)) { msg.textContent = 'Quantité et seuil : nombres entiers (0 ou plus).'; msg.hidden = false; return; }
          var piece = { designation: c.designation.value.trim(), reference: c.reference.value.trim(), quantiteStock: q, seuil: s, casier: c.casier.value.trim() };
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
            fermer(); saisir({ type: 'stock.panier', materiel: p.materiel || materiel, reference: p.reference, designation: p.designation, casier: p.casier, quantite: q });
            PM.toast('Ajouté au panier « À commander »');
          } }, ['Ajouter au panier'])]);
      }

      /* ---------- à commander ---------- */
      var listeCommande = null;
      function ecranCommander(racine) {
        racine.appendChild(el('div', { class: 'pp-barre' }, [el('h2', { class: 'pp-titre' }, ['À commander']),
          el('button', { class: 'btn-second', type: 'button', onclick: exporterPdf }, ['🧾 Export PDF'])]));
        racine.appendChild(el('p', { class: 'petit' }, ['Pièces de ce site sous leur seuil, et pièces ajoutées au panier.']));
        var zone = el('div');
        racine.appendChild(zone);
        function rendre(liste) {
          zone.innerHTML = '';
          // panier modifié sur ce téléphone, pas encore envoyé
          attente.forEach(function (a) {
            if (a.type !== 'stock.panier' && a.type !== 'stock.retirerPanier') return;
            liste = liste.filter(function (x) { return !(x.materiel === a.materiel && x.reference === a.reference); });
            if (a.type === 'stock.panier' && a.quantite > 0) liste.push({ origine: 'panier', materiel: a.materiel, reference: a.reference, designation: a.designation, casier: a.casier, quantite: a.quantite, enAttente: true });
          });
          listeCommande = liste;
          if (!liste.length) { zone.appendChild(el('div', { class: 'vide-msg' }, ['Rien à commander pour le moment 🎉'])); return; }
          var tbody = el('tbody');
          liste.forEach(function (it) {
            function changer(d) {
              var q = Math.max(0, (it.quantite || 0) + d);
              if (q === it.quantite) return;
              if (q === 0 && it.origine !== 'panier') return;
              saisir(q === 0 ? { type: 'stock.retirerPanier', materiel: it.materiel, reference: it.reference }
                : { type: 'stock.panier', materiel: it.materiel, reference: it.reference, designation: it.designation, casier: it.casier, quantite: q });
            }
            tbody.appendChild(el('tr', { class: it.enAttente ? 'attente' : '' }, [
              el('td', {}, [it.designation || it.reference, el('span', { class: 'st-badge ' + (it.origine === 'panier' ? 'st-partage' : 'st-alerte') }, [it.origine === 'panier' ? 'Panier' : 'Seuil']),
                el('div', { class: 'st-sous' }, ['Réf. ' + (it.reference || '—') + (it.casier ? ' · casier ' + it.casier : '')])]),
              el('td', {}, [it.materiel]),
              el('td', {}, [el('div', { class: 'st-pm' }, [
                el('button', { type: 'button', 'aria-label': 'Retirer', onclick: function () { changer(-1); } }, ['−']),
                el('b', {}, [String(it.quantite)]),
                el('button', { type: 'button', 'aria-label': 'Ajouter', onclick: function () { changer(1); } }, ['+'])])]),
              el('td', { class: 'pp-actions' }, [
                el('button', { class: 'pp-icone', type: 'button', title: 'Voir la pièce', onclick: function () { aller('pieces', it.materiel); chargerPieces(it.materiel, it.reference); } }, ['👁']),
                it.origine === 'panier' ? el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Retirer de la liste', onclick: function () { saisir({ type: 'stock.retirerPanier', materiel: it.materiel, reference: it.reference }); } }, ['🗑']) : null])
            ]));
          });
          zone.appendChild(el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table' }, [
            el('thead', {}, [el('tr', {}, ['Pièce', 'Matériel', 'Qté', ''].map(function (h) { return el('th', {}, [h]); }))]), tbody])]));
        }
        var cache = 'stock_commander_' + S;
        PM.DB.get(cache).then(function (c) { if (c && ecran === 'commander') rendre(c); else if (!c) zone.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])); });
        if (modeDemo) { rendre([]); return; }
        api('stock.commander', {}, 60000).then(function (j) {
          PM.DB.set(cache, j.liste || []);
          if (ecran === 'commander' && actif()) rendre(j.liste || []);
        })['catch'](function (e) { PM.toast('Hors ligne : ' + e.message); });
      }
      function exporterPdf() {
        if (!listeCommande || !listeCommande.length) { PM.toast('Rien à exporter pour le moment.'); return; }
        var charge = window.jspdf ? Promise.resolve() : new Promise(function (ok, ko) {
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = ok; s.onerror = ko; document.head.appendChild(s);
        });
        charge.then(function () {
          var doc = new window.jspdf.jsPDF(), y = 18;
          doc.setFontSize(14); doc.text('A commander - Pieces detachees - ' + ((M && M.site) || ctx.site.nom), 14, y); y += 8;
          doc.setFontSize(10); doc.text(new Date().toLocaleDateString('fr-FR'), 14, y); y += 10;
          var x = [14, 55, 112, 165, 185];
          doc.setFontSize(9); doc.setFont(undefined, 'bold');
          ['Reference', 'Piece', 'Materiel', 'Casier', 'Qte'].forEach(function (c, i) { doc.text(c, x[i], y); });
          doc.setFont(undefined, 'normal'); y += 4; doc.setLineWidth(0.2); doc.line(14, y, 196, y); y += 6;
          listeCommande.forEach(function (it) {
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

      /* ---------- recherche (tous les sites) ---------- */
      var minuteur = null, dernierTerme = '';
      function ecranRecherche(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Recherche']));
        racine.appendChild(el('p', { class: 'petit' }, ['Référence actuelle ou ancienne, ou désignation — sur tous les sites.']));
        var champ = el('input', { type: 'search', class: 'st-filtre st-filtre-grand', placeholder: 'Tape une référence…', value: dernierTerme, autocomplete: 'off' });
        var zone = el('div');
        racine.appendChild(champ); racine.appendChild(zone);
        function lancer() {
          var t = champ.value.trim(); dernierTerme = t;
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
              var tbody = el('tbody');
              r.forEach(function (x) {
                var autreOutil = !x.ceSite && OUTIL_DU_SITE[x.siteId];
                tbody.appendChild(el('tr', { class: (x.stockBas ? 'st-bas ' : '') + 'st-clic', onclick: function () {
                  if (x.ceSite) { aller('pieces', x.materiel); chargerPieces(x.materiel, x.reference); }
                  else if (autreOutil) location.hash = 'outil/' + autreOutil + '/' + encodeURIComponent(x.materiel) + '/' + encodeURIComponent(x.reference || '');
                } }, [
                  el('td', { class: 'st-ref' }, [x.reference || '—', x.ancienneReference ? el('div', { class: 'st-sous' }, ['anc. ' + x.ancienneReference]) : null]),
                  el('td', {}, [x.designation, x.casier ? el('div', { class: 'st-sous' }, ['Casier ' + x.casier]) : null]),
                  el('td', {}, [x.site, el('div', { class: 'st-sous' }, [x.materiel])]),
                  el('td', {}, [String(x.quantiteStock)])]));
              });
              zone.appendChild(el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table' }, [
                el('thead', {}, [el('tr', {}, ['Référence', 'Pièce', 'Site / matériel', 'Stock'].map(function (h) { return el('th', {}, [h]); }))]), tbody])]));
            })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('p', { class: 'bg-erreur' }, [e.message])); });
          }, 300);
        }
        champ.addEventListener('input', lancer);
        setTimeout(function () { champ.focus(); }, 30);
        if (dernierTerme) lancer();
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
          var tbody = el('tbody');
          l.forEach(function (x) {
            tbody.appendChild(el('tr', {}, [
              el('td', { class: 'date-cell' }, [x.date, el('div', { class: 'st-sous' }, [String(x.utilisateur)])]),
              el('td', {}, [String(x.designation || x.reference), el('div', { class: 'st-sous' }, [x.materiel + (x.reference ? ' · ' + x.reference : '')])]),
              el('td', { class: x.delta < 0 ? 'st-moins' : 'st-plus' }, [(x.delta > 0 ? '+' : '') + x.delta]),
              el('td', {}, [String(x.nouvelleQuantite)])]));
          });
          zone.appendChild(el('div', { class: 'bandeau st-tableau' }, [el('table', { class: 'nh3-table st-table' }, [
            el('thead', {}, [el('tr', {}, ['Date', 'Pièce', 'Mvt', 'Qté'].map(function (h) { return el('th', {}, [h]); }))]), tbody])]));
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Historique indisponible : ' + e.message])); });
      }

      /* ---------- stock commun (références à plusieurs endroits) ---------- */
      function ecranCommunes(racine) {
        racine.appendChild(el('h2', { class: 'pp-titre', style: 'margin-bottom:6px' }, ['Stock commun']));
        racine.appendChild(el('p', { class: 'petit' }, ['Références retrouvées sur plusieurs sites ou matériels — leur stock et leur seuil sont partagés automatiquement.']));
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

      /* ---------- QR codes ---------- */
      function lienFiche(p) {
        var base = location.origin + location.pathname.replace(/index\.html$/, '');
        return base + '#outil/' + ctx.outil.id + '/' + encodeURIComponent(p.materiel || materiel) + '/' + encodeURIComponent(p.reference);
      }
      function urlQr(p, taille) {
        return 'https://api.qrserver.com/v1/create-qr-code/?size=' + taille + 'x' + taille + '&data=' + encodeURIComponent(lienFiche(p));
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
          '.carte-qr img{max-width:100%;height:auto}.qr-ref{font-weight:700;margin-top:6px;font-size:13px}.qr-designation{font-size:12px;margin-top:2px}.qr-casier{font-size:11px;color:#5f6b68;margin-top:2px}' +
          '@media print{@page{margin:12mm}}</style></head><body><h1></h1><div class="grille"></div></body></html>');
        d.close();
        d.title = titre; d.querySelector('h1').textContent = titre;
        var g = d.querySelector('.grille');
        liste.forEach(function (p) {
          var c = d.createElement('div'); c.className = 'carte-qr';
          var img = d.createElement('img'); img.src = urlQr(p, 220); img.width = 200; img.height = 200; img.alt = 'QR code'; c.appendChild(img);
          [['qr-ref', p.reference], ['qr-designation', p.designation], ['qr-casier', p.casier ? 'Casier : ' + p.casier : '']].forEach(function (t) {
            if (!t[1]) return; var e = d.createElement('div'); e.className = t[0]; e.textContent = t[1]; c.appendChild(e);
          });
          g.appendChild(c);
        });
        setTimeout(function () { try { w.print(); } catch (e) {} }, 900);
      }

      /* ---------- scan d'un QR code ---------- */
      // Gère les QR du portail ET les anciens QR de l'appli d'origine (?site=site1&materiel=…&reference=…)
      function ouvrirLienScanne(texte) {
        var t = String(texte || '').trim();
        var h = t.indexOf('#outil/');
        if (h >= 0) { location.hash = t.slice(h + 1); if (location.hash === t.slice(h)) window.dispatchEvent(new HashChangeEvent('hashchange')); return true; }
        var m;
        try { m = new URL(t); } catch (e) { m = null; }
        if (m && m.searchParams.get('materiel')) {
          var outil = OUTIL_DU_SITE[m.searchParams.get('site')] || ctx.outil.id;
          location.hash = 'outil/' + outil + '/' + encodeURIComponent(m.searchParams.get('materiel')) + '/' + encodeURIComponent(m.searchParams.get('reference') || '');
          return true;
        }
        PM.toast('QR code non reconnu : ' + t.slice(0, 60));
        return false;
      }
      function scanner() {
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
          var u = M && lienSur(M.urlScanner);
          if (u) { window.open(u, '_blank'); return; }
          PM.toast('Le scan n’est pas disponible sur ce téléphone.');
          return;
        }
        var video = el('video', { playsinline: 'playsinline', muted: 'muted', class: 'st-video' });
        var info = el('p', { class: 'petit', style: 'text-align:center' }, ['Vise le QR code collé sur le casier.']);
        var flux = null, fini = false, detecteur;
        try { detecteur = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { PM.toast('Le scan n’est pas disponible sur ce téléphone.'); return; }
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
              stop(); fermerM(); ouvrirLienScanne(codes[0].rawValue); return;
            }
            setTimeout(boucle, 200);
          })['catch'](function () { setTimeout(boucle, 400); });
        })['catch'](function (e) { info.textContent = 'Caméra indisponible : ' + (e && e.message || e); });
      }

      /* ---------- fenêtres ---------- */
      function pleinEcran(u) {
        var src = urlPhoto(u);
        if (!src) return;
        var fond = el('div', { class: 'ag-modale st-plein', role: 'dialog', onclick: function () { fond.remove(); } }, [el('img', { src: src, alt: 'Photo de la pièce' })]);
        document.body.appendChild(fond);
      }
      function modale(titre, sousTitre, contenu) {
        var fermerBtn = el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×']);
        var fond = el('div', { class: 'ag-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre });
        function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
        function esc(ev) { if (ev.key === 'Escape' && fond === document.querySelectorAll('.ag-modale')[document.querySelectorAll('.ag-modale').length - 1]) fermer(); }
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
    }
  };
})();
