/* =====================================================================
   MODULE « SUIVI REMPLACEMENT DE POMPES » — version rapide
   Reprend l'appli d'origine (v10 du 17/09) : matériels du site, fiche
   matériel avec saisie d'intervention (opérateur, date, compteur horaire
   et tonnage facultatifs, pièces remplacées, commentaire), courbes des
   heures / tonnes entre deux interventions, historique modifiable.
   Chaque site ne voit que SON matériel (le serveur du site filtre).
   Les saisies fonctionnent sans réseau et partent dès que le réseau revient.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  // Repris de l'appli d'origine (le serveur renvoie les mêmes listes)
  var TYPES_DEFAUT = [
    { id: 'wangen', label: 'Pompe Wangen', pieces: [{ id: 'rotor', label: 'Rotor' }, { id: 'stator', label: 'Stator' }, { id: 'garniture', label: 'Garniture étanche' }, { id: 'cardan', label: 'Cardan' }] },
    { id: 'cc', label: 'Pompe CC', tonnage: true, pieces: [{ id: 'rotor', label: 'Rotor' }, { id: 'stator', label: 'Stator' }, { id: 'garniture', label: 'Garniture étanche' }, { id: 'cardan', label: 'Cardan' }] },
    { id: 'lobes', label: 'Pompe à Lobes', pieces: [{ id: 'lobes', label: 'Lobes' }, { id: 'garniture', label: 'Garniture étanche' }, { id: 'roulements', label: 'Roulements' }] },
    { id: 'broyeur', label: 'Broyeur', tonnage: true, pieces: [{ id: 'couteaux', label: 'Couteaux' }, { id: 'grille', label: 'Grille' }, { id: 'garniture', label: 'Garniture étanche' }] },
    { id: 'separateur', label: 'Séparateur', pieces: [{ id: 'grille', label: 'Grille' }, { id: 'vis', label: 'Vis' }, { id: 'garniture', label: 'Garniture étanche' }] }
  ];
  var OPERATEURS_DEFAUT = ['Adam', 'Alex', 'Benoit', 'Mathieu', 'Pierrick', 'Régis', 'Thibaut', 'Tigrou'];
  var NOM_SITE = { rotte: 'Metha de la Rotte', arraincourt: 'Arraincourt Biogaz' };

  // Logos des fabricants, comme l'appli d'origine v15 (fichiers dans icons/)
  var LOGOS = {
    wangen: { src: 'icons/logo-wangen.png', nom: 'Wangen Pumpen' },
    cc: { src: 'icons/logo-vogelsang.png', nom: 'Vogelsang' },
    lobes: { src: 'icons/logo-vogelsang.png', nom: 'Vogelsang' },
    broyeur: { src: 'icons/logo-vogelsang.png', nom: 'Vogelsang' },
    separateur: { src: 'icons/logo-bauer.png', nom: 'Bauer' }
  };
  function logo(typeId, petit) {
    var L = LOGOS[typeId];
    if (!L) return null;
    return el('span', { class: 'pp-logo' + (petit ? ' pp-logo-petit' : '') }, [el('img', { src: L.src, alt: L.nom })]);
  }

  function demo(siteId) {
    var nom = NOM_SITE[siteId] || siteId;
    var D = { types: TYPES_DEFAUT, operateurs: OPERATEURS_DEFAUT, equipements: [], interventions: [] };
    TYPES_DEFAUT.forEach(function (t, i) { D.equipements.push({ id: 'demo-' + i, site: nom, type: t.id, nom: t.label, horametre: null, tonnage: null }); });
    [['2026-03-12', 1180, 15200, ['rotor', 'stator']], ['2026-06-20', 1910, 24800, ['stator']], ['2026-09-15', 2655, 34100, ['rotor', 'stator', 'garniture']]].forEach(function (r, i) {
      D.interventions.push({ id: 'demo-i' + i, equipementId: 'demo-1', date: r[0], operateur: 'Mathieu', horametre: r[1], tonnage: r[2], pieces: r[3], commentaire: '', timestamp: r[0] + 'T08:00:00Z' });
    });
    return D;
  }

  /* ---------- formats (comme l'appli d'origine) ---------- */
  function vide(n) { return n === null || n === undefined || n === '' || isNaN(n); }
  function fmtH(n) { return vide(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('fr-FR') + ' h'; }
  function fmtT(n) { return vide(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('fr-FR') + ' T'; }
  function fmtDateFR(d) {
    if (!d) return '—';
    var p = String(d).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d);
  }
  function aujourdhui() {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function nombre(v) {
    var n = PM.nombre(v); // « 21 300 » = 21300, « 12abc » refusé
    if (n === null) return '';
    return isNaN(n) || n < 0 ? NaN : n;
  }

  window.MODULES.pompes = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'pompes_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'pompes_attente_' + ctx.site.id;
      var D = null, attente = [];
      var ecran = 'liste', equipCourant = null, enEdition = null, messageForm = null, formModifie = false;
      var brille = true; // reflet sur les logos : seulement à l'arrivée sur un écran, pas à chaque rafraîchissement

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = r[0] || (modeDemo ? demo(ctx.site.id) : null);
        attente = r[1] || [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        return PM.Api.appeler(ctx.apiUrl, { action: 'pompes.donnees', cle: ctx.cle }, 30000).then(function (j) {
          delete j.ok; D = j; PM.DB.set(CLE_DONNEES, j);
          return PM.DB.listerEnvois().then(function (l) {
            var ids = (l || []).map(function (x) { return x.payload.id; });
            attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
            PM.DB.set(CLE_ATTENTE, attente);
            // pas de rafraîchissement d'écran pendant une saisie : rien ne doit s'effacer sous les doigts
            if (!document.querySelector('.ag-modale') && !enEdition && !formModifie) afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le suivi des pompes.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { rafraichir(true); } }, ['Réessayer']), ' ',
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast('Hors ligne : données du dernier chargement');
        });
      }
      var instance = PM.uid();
      window.__ppInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__ppInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- état affiché = serveur + saisies en attente ---------- */
      function etat() {
        var E = {
          types: D.types || TYPES_DEFAUT, operateurs: D.operateurs || OPERATEURS_DEFAUT,
          equipements: (D.equipements || []).map(function (e) { return Object.assign({}, e); }),
          interventions: (D.interventions || []).map(function (i) { return Object.assign({}, i); })
        };
        attente.forEach(function (p) {
          if (p.type === 'pompes.materiel') {
            if (!E.equipements.some(function (e) { return e.id === p.equipementId; }))
              E.equipements.push({ id: p.equipementId, site: NOM_SITE[ctx.site.id], type: p.typeId, nom: p.nom, horametre: null, tonnage: null, enAttente: true });
          } else if (p.type === 'pompes.renommer') {
            E.equipements.forEach(function (e) { if (e.id === p.equipementId) { e.nom = p.nom; e.enAttente = true; } });
          } else if (p.type === 'pompes.intervention') {
            if (!E.interventions.some(function (i) { return i.id === p.interventionId; }))
              E.interventions.push({ id: p.interventionId, equipementId: p.equipementId, date: p.date, operateur: p.operateur,
                horametre: vide(p.horametre) ? null : p.horametre, tonnage: vide(p.tonnage) ? null : p.tonnage,
                pieces: p.pieces || [], commentaire: p.commentaire || '', timestamp: p.horodatage, enAttente: true });
          } else if (p.type === 'pompes.modification') {
            E.interventions.forEach(function (i) {
              if (i.id !== p.interventionId) return;
              i.date = p.date; i.operateur = p.operateur; i.pieces = p.pieces || []; i.commentaire = p.commentaire || '';
              i.horametre = vide(p.horametre) ? null : p.horametre; i.tonnage = vide(p.tonnage) ? null : p.tonnage; i.enAttente = true;
            });
          } else if (p.type === 'pompes.releve') {
            E.equipements.forEach(function (e) { if (e.id === p.equipementId) { e.horametreActuel = p.horametre; e.dateReleve = p.date; e.releveEnAttente = true; } });
          } else if (p.type === 'pompes.suppression') {
            E.interventions = E.interventions.filter(function (i) { return i.id !== p.interventionId; });
          }
        });
        E.interventions.sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return a.timestamp < b.timestamp ? -1 : (a.timestamp > b.timestamp ? 1 : 0);
        });
        E.typeIndex = {};
        E.types.forEach(function (t) { E.typeIndex[t.id] = t; });
        // compteurs connus = dernier relevé réellement saisi (comme refreshEquipCounters_)
        E.equipements.forEach(function (e) {
          var liste = E.interventions.filter(function (i) { return i.equipementId === e.id; });
          var h = null, t = null;
          liste.forEach(function (i) { if (i.horametre !== null) h = i.horametre; if (i.tonnage !== null) t = i.tonnage; });
          var touche = attente.some(function (p) { return p.equipementId === e.id; });
          if (liste.length || touche) { e.horametre = h; e.tonnage = (E.typeIndex[e.type] || {}).tonnage ? t : null; }
        });
        return E;
      }
      function interventionsDe(E, id) { return E.interventions.filter(function (i) { return i.equipementId === id; }); }

      function saisir(payload) {
        payload.id = PM.uid();
        payload.horodatage = payload.horodatage || new Date().toISOString();
        if (modeDemo) { attente.push(payload); var E = etat(); attente = []; D = E; return; }
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        PM.Envoi.ajouter(ctx.site.id, payload);
      }

      /* ================= écrans ================= */
      function afficher() {
        var y = window.scrollY;
        formModifie = false;
        vue.innerHTML = '';
        var racine = el('div', { class: 'pompes' + (brille ? ' pp-brille' : '') });
        brille = false;
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur du site dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var E = etat();
        if (ecran === 'detail' && E.equipements.some(function (e) { return e.id === equipCourant; })) ecranDetail(racine, E);
        else { ecran = 'liste'; ecranListe(racine, E); }
        window.scrollTo(0, y);
      }

      /* ---------- tableau de bord du site ---------- */
      function ecranListe(racine, E) {
        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('h2', { class: 'pp-titre' }, [NOM_SITE[ctx.site.id] || ctx.site.nom]),
          el('button', { class: 'btn-second', type: 'button', onclick: function () { ouvrirAjoutMateriel(E); } }, ['+ Ajouter un matériel'])
        ]));
        var grille = el('div', { class: 'pp-grille' });
        E.equipements.forEach(function (e, i) {
          var t = E.typeIndex[e.type];
          var liste = interventionsDe(E, e.id), der = liste[liste.length - 1];
          var ecoule = (e.horametreActuel !== null && e.horametreActuel !== undefined && e.horametre !== null && e.horametre !== undefined)
            ? Math.max(0, e.horametreActuel - e.horametre) : null;
          var carte = el('div', { class: 'pp-carte', role: 'button', tabindex: '0', style: '--i:' + i, onclick: function () {
            ecran = 'detail'; equipCourant = e.id; enEdition = null; messageForm = null; brille = true; afficher(); window.scrollTo(0, 0);
          } }, [
            el('div', { class: 'pp-carte-tete' }, [logo(e.type) || el('span', { class: 'pp-badge' }, [t ? t.label : e.type]),
              el('button', { class: 'pp-hrs', type: 'button', title: 'Relever le compteur horaire', onclick: function (ev) { ev.stopPropagation(); ouvrirReleve(e); } }, ['HRS'])]),
            el('div', { class: 'pp-nom' }, [e.nom + (e.enAttente ? ' ⏳' : '')]),
            ecoule !== null
              ? el('div', { class: 'pp-ecoule' }, [el('b', {}, [fmtH(ecoule)]), ' depuis la dernière intervention' + (e.releveEnAttente ? ' ⏳' : '')])
              : el('div', { class: 'pp-ecoule pp-gris' }, ['Heures écoulées : — (appuie sur HRS)'])
          ]);
          carte.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') carte.click(); });
          grille.appendChild(carte);
        });
        racine.appendChild(E.equipements.length ? grille : el('div', { class: 'vide-msg' }, ['Aucun matériel suivi sur ce site.']));
      }

      /* ---------- fiche d'un matériel ---------- */
      function ecranDetail(racine, E) {
        var e = E.equipements.filter(function (x) { return x.id === equipCourant; })[0];
        var t = E.typeIndex[e.type];
        var liste = interventionsDe(E, e.id);

        racine.appendChild(el('div', { class: 'pp-barre' }, [
          el('button', { class: 'btn-second', type: 'button', onclick: function () { ecran = 'liste'; enEdition = null; brille = true; afficher(); window.scrollTo(0, 0); } }, ['← Matériels']),
          el('div', { class: 'pp-detail-nom' }, [logo(e.type, true), el('span', {}, [e.nom]),
            el('button', { class: 'pp-icone', type: 'button', title: 'Renommer', 'aria-label': 'Renommer', onclick: function () { ouvrirRenommer(e); } }, ['✎'])]),
          el('div', { class: 'pp-actions-tete' }, [
            el('button', { class: 'pp-ajout', type: 'button', title: 'Nouvelle intervention', 'aria-label': 'Nouvelle intervention',
              html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 0 0 2.2 2.2l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.5-.5-2.1z"/><path d="M19 14v6M16 17h6"/></svg>',
              onclick: function () { ouvrirFormulaire(E, e, null); } }),
            el('span', { class: 'pp-badge' }, [t ? t.label : e.type])
          ])
        ]));

        /* courbes : heures / tonnes entre chaque intervention */
        var relH = liste.filter(function (i) { return i.horametre !== null; });
        var itemsH = [];
        for (var a = 1; a < relH.length; a++) itemsH.push({ label: fmtDateFR(relH[a].date), value: Math.max(0, relH[a].horametre - relH[a - 1].horametre) });
        racine.appendChild(el('section', { class: 'bandeau' }, [el('h3', { class: 'pp-h3' }, ['Heures de fonctionnement entre chaque intervention']),
          itemsH.length ? barres(itemsH, 'var(--accent)', 'h') : el('p', { class: 'petit pp-vide' }, [diagnostic(liste.length, relH.length, 'relevé de compteur horaire')])]));
        if (t && t.tonnage) {
          var relT = liste.filter(function (i) { return i.tonnage !== null; });
          var itemsT = [];
          for (var b = 1; b < relT.length; b++) itemsT.push({ label: fmtDateFR(relT[b].date), value: Math.max(0, relT[b].tonnage - relT[b - 1].tonnage) });
          racine.appendChild(el('section', { class: 'bandeau' }, [el('h3', { class: 'pp-h3' }, ['Quantité incorporée entre chaque intervention']),
            itemsT.length ? barres(itemsT, '#17a398', 'T') : el('p', { class: 'petit pp-vide' }, [diagnostic(liste.length, relT.length, 'relevé de tonnage')])]));
        }

        /* historique (le plus récent en premier) */
        var tbody = el('tbody');
        liste.forEach(function (x, idx) {
          var hTxt = '—', qTxt = '—', k;
          if (x.horametre !== null) for (k = idx - 1; k >= 0; k--) if (liste[k].horametre !== null) { hTxt = fmtH(Math.max(0, x.horametre - liste[k].horametre)); break; }
          if (t && t.tonnage && x.tonnage !== null) for (k = idx - 1; k >= 0; k--) if (liste[k].tonnage !== null) { qTxt = fmtT(Math.max(0, x.tonnage - liste[k].tonnage)); break; }
          var cells = [
            el('td', { class: 'date-cell' }, [fmtDateFR(x.date) + (x.enAttente ? ' ⏳' : '')]),
            el('td', {}, [x.operateur || '']),
            el('td', { class: 'val-cell' }, [fmtH(x.horametre)]),
            el('td', { class: 'val-cell' }, [hTxt])];
          if (t && t.tonnage) cells.push(el('td', { class: 'val-cell' }, [fmtT(x.tonnage)]), el('td', { class: 'val-cell' }, [qTxt]));
          cells.push(el('td', {}, [libellesPieces(t, x.pieces) || '—']),
            el('td', { class: 'pp-com-cell' }, [x.commentaire || '—']),
            el('td', { class: 'pp-actions' }, [
              el('button', { class: 'pp-icone', type: 'button', title: 'Modifier', 'aria-label': 'Modifier', onclick: function () {
                ouvrirFormulaire(E, e, x);
              } }, ['✎']),
              el('button', { class: 'pp-icone pp-danger', type: 'button', title: 'Supprimer', 'aria-label': 'Supprimer', onclick: function () { ouvrirSuppression(t, x); } }, ['🗑'])
            ]));
          tbody.insertBefore(el('tr', { class: (x.enAttente ? 'attente ' : '') + (x.id === enEdition ? 'pp-ligne-edition' : '') }, cells), tbody.firstChild);
        });
        var entetes = ['Date', 'Opérateur', 'Compteur (h)', 'Heures depuis la dernière intervention'];
        if (t && t.tonnage) entetes.push('Tonnage (T)', 'Quantité depuis la dernière intervention');
        entetes.push('Pièces remplacées', 'Commentaire', '');
        racine.appendChild(el('section', { class: 'bandeau' }, [el('h3', { class: 'pp-h3' }, ['Historique des interventions']),
          liste.length ? el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table pp-table' }, [
            el('thead', {}, [el('tr', {}, entetes.map(function (h) { return el('th', {}, [h]); }))]), tbody])])
            : el('div', { class: 'vide-msg' }, ['Aucune intervention enregistrée pour l’instant.'])]));
      }

      function libellesPieces(t, ids) {
        return (ids || []).map(function (pid) {
          var p = t ? t.pieces.filter(function (pp) { return pp.id === pid; })[0] : null;
          return p ? p.label : pid;
        }).join(', ');
      }
      function diagnostic(nbI, nbR, libelle) {
        if (nbI === 0) return 'Aucune intervention enregistrée pour ce matériel.';
        if (nbR === 0) return nbI + ' intervention(s) enregistrée(s), mais aucune ne porte de ' + libelle + '. Il en faut 2 pour tracer une courbe.';
        if (nbR === 1) return nbI + ' intervention(s) enregistrée(s), dont 1 seule avec un ' + libelle + '. Il en faut 2 pour tracer une courbe.';
        return 'Pas encore assez de données pour tracer une courbe.';
      }

      /* petit graphique en barres (comme l'appli d'origine) */
      function barres(items, couleur, unite) {
        var n = items.length, H = 190, pg = 34, pd = 12, ph = 18, pb = 30;
        var W = Math.max(320, n * 64);
        var larg = Math.min(46, ((W - pg - pd) / n) * 0.55);
        var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1])) * 1.2;
        function xc(i) { return pg + (i + 0.5) * (W - pg - pd) / n; }
        function yp(v) { return H - pb - (v / max) * (H - ph - pb); }
        var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
        [0, 0.5, 1].forEach(function (f) {
          var yy = ph + f * (H - ph - pb);
          s += '<line x1="' + pg + '" y1="' + yy + '" x2="' + (W - pd) + '" y2="' + yy + '" style="stroke:var(--bord)" stroke-width="1"/>';
          s += '<text x="2" y="' + (yy + 3) + '" font-size="10" style="fill:var(--texte-2)">' + Math.round(max * (1 - f)) + '</text>';
        });
        items.forEach(function (it, i) {
          var x = xc(i), y = yp(it.value);
          s += '<rect x="' + (x - larg / 2) + '" y="' + y + '" width="' + larg + '" height="' + Math.max(0, H - pb - y) + '" rx="3" style="fill:' + couleur + '"><title>' + it.label + ' : ' + it.value.toLocaleString('fr-FR') + ' ' + unite + '</title></rect>';
          s += '<text x="' + x + '" y="' + (y - 4) + '" font-size="10" text-anchor="middle" style="fill:var(--texte)">' + Math.round(it.value).toLocaleString('fr-FR') + '</text>';
          s += '<text x="' + x + '" y="' + (H - 10) + '" font-size="10" text-anchor="middle" style="fill:var(--texte-2)">' + it.label + '</text>';
        });
        return el('div', { class: 'pp-graph', html: s + '</svg>' });
      }

      /* ---------- fenêtres (même gabarit que le suivi agitation) ---------- */
      function modale(titre, sousTitre, contenu) {
        var fermerBtn = el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×']);
        var fond = el('div', { class: 'ag-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre });
        function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
        function esc(ev) { if (ev.key === 'Escape') fermer(); }
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

      /* ---------- fenêtre « Nouvelle intervention » / modification ---------- */
      function ouvrirFormulaire(E, e, iv) {
        var t = E.typeIndex[e.type];
        var operateurs = E.operateurs;
        var selOp = el('select', { id: 'pp-op' }, operateurs.map(function (o) { return el('option', { value: o }, [o]); }).concat([el('option', { value: '__autre__' }, ['Autre…'])]));
        var inAutre = el('input', { id: 'pp-autre', type: 'text', placeholder: 'Nom' });
        var champAutre = el('div', { class: 'champ', hidden: 'hidden' }, [el('label', { for: 'pp-autre' }, ['Nom de l’opérateur']), inAutre]);
        var inDate = el('input', { id: 'pp-date', type: 'date' });
        var inH = el('input', { id: 'pp-h', type: 'text', inputmode: 'decimal', placeholder: 'vide si non relevé', autocomplete: 'off' });
        var inT = el('input', { id: 'pp-t', type: 'text', inputmode: 'decimal', placeholder: 'vide si non relevé', autocomplete: 'off' });
        var inCom = el('textarea', { id: 'pp-com', rows: '2', placeholder: 'Observations, référence pièce, etc.' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });

        var dernierOp = PM.Prefs.get('pompes_operateur', '');
        if (iv) {
          if (operateurs.indexOf(iv.operateur) >= 0) selOp.value = iv.operateur;
          else { selOp.value = '__autre__'; inAutre.value = iv.operateur || ''; champAutre.hidden = false; }
          inDate.value = iv.date || '';
          inH.value = iv.horametre === null ? '' : String(iv.horametre).replace('.', ',');
          inT.value = iv.tonnage === null ? '' : String(iv.tonnage).replace('.', ',');
          inCom.value = iv.commentaire || '';
        } else {
          if (operateurs.indexOf(dernierOp) >= 0) selOp.value = dernierOp;
          inDate.value = aujourdhui();
        }
        selOp.addEventListener('change', function () { champAutre.hidden = selOp.value !== '__autre__'; });

        var liste = interventionsDe(E, e.id);
        var der = liste[liste.length - 1];
        var aide = iv ? 'Vous modifiez une intervention déjà enregistrée. Les compteurs saisis restent des relevés cumulés.'
          : ((e.horametre === null && e.tonnage === null) ? 'Aucun relevé de compteur enregistré — les compteurs sont facultatifs.'
            : 'Dernier relevé connu : ' + fmtH(e.horametre) + (t && t.tonnage ? ' · ' + fmtT(e.tonnage) : '') + '.')
            + (der ? ' Dernière intervention : ' + fmtDateFR(der.date) + '.' : '');

        var pieces = el('div', { class: 'pp-pieces' });
        (t ? t.pieces : []).forEach(function (p) {
          var cb = el('input', { type: 'checkbox', value: p.id, checked: iv && iv.pieces.indexOf(p.id) >= 0 ? 'checked' : null });
          var chip = el('label', { class: 'pp-piece' + (cb.checked ? ' coche' : '') }, [cb, el('span', {}, [p.label])]);
          cb.addEventListener('change', function () { chip.classList.toggle('coche', cb.checked); });
          pieces.appendChild(chip);
        });

        var btn = el('button', { class: 'btn-principal', type: 'button' }, [iv ? 'Enregistrer les modifications' : 'Enregistrer l’intervention']);
        btn.addEventListener('click', function () {
          msg.hidden = true;
          function erreur(txt) { msg.textContent = txt; msg.hidden = false; }
          var operateur = selOp.value === '__autre__' ? inAutre.value.trim() : selOp.value;
          if (!operateur) return erreur('Veuillez indiquer l’opérateur.');
          if (!inDate.value) return erreur('Veuillez indiquer une date.');
          var h = nombre(inH.value);
          if (h !== '' && isNaN(h)) return erreur('Compteur horaire invalide — laissez le champ vide s’il n’a pas été relevé.');
          if (!iv && h !== '' && e.horametre !== null && h < e.horametre &&
            !window.confirm('Le compteur saisi (' + h + ' h) est inférieur au dernier relevé (' + e.horametre + ' h). Continuer quand même ?')) return;
          var to = '';
          if (t && t.tonnage) {
            to = nombre(inT.value);
            if (to !== '' && isNaN(to)) return erreur('Tonnage invalide — laissez le champ vide s’il n’a pas été relevé.');
            if (!iv && to !== '' && e.tonnage !== null && to < e.tonnage &&
              !window.confirm('Le tonnage saisi (' + to + ' T) est inférieur au dernier relevé (' + e.tonnage + ' T). Continuer quand même ?')) return;
          }
          var choix = Array.prototype.map.call(pieces.querySelectorAll('input:checked'), function (c) { return c.value; });
          var donnees = { operateur: operateur, date: inDate.value, horametre: h, tonnage: to, pieces: choix, commentaire: inCom.value.trim() };
          if (iv) { donnees.type = 'pompes.modification'; donnees.interventionId = iv.id; }
          else { donnees.type = 'pompes.intervention'; donnees.interventionId = PM.uid() + PM.uid(); donnees.equipementId = e.id; }
          if (navigator.vibrate) navigator.vibrate(25);
          if (operateurs.indexOf(operateur) >= 0) PM.Prefs.set('pompes_operateur', operateur);
          saisir(donnees);
          var texte = iv ? 'Intervention modifiée.' : 'Intervention enregistrée.';
          fermer();
          afficher();
          PM.toast(texte + (modeDemo || navigator.onLine ? '' : ' Envoi dès le retour du réseau.'));
        });

        var champsCompteurs = [el('div', { class: 'champ' }, [el('label', { for: 'pp-date' }, ['Date']), inDate]),
          el('div', { class: 'champ' }, [el('label', { for: 'pp-h' }, ['Compteur horaire (h) — facultatif']), inH])];
        var fermer = modale(iv ? 'Modifier l’intervention du ' + fmtDateFR(iv.date) : 'Nouvelle intervention', e.nom, [el('div', { class: 'pp-form' }, [
          el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', { for: 'pp-op' }, ['Opérateur']), selOp]),
          champAutre,
          el('div', { class: 'pp-deux' }, champsCompteurs),
          t && t.tonnage ? el('div', { class: 'champ' }, [el('label', { for: 'pp-t' }, ['Tonnage traité (T) — compteur cumulé, facultatif']), inT]) : null,
          el('p', { class: 'petit pp-aide' }, [aide]),
          el('div', { class: 'champ' }, [el('label', {}, ['Pièces remplacées']), pieces]),
          el('div', { class: 'champ' }, [el('label', { for: 'pp-com' }, ['Commentaire (facultatif)']), inCom]),
          btn, msg
        ])]);

      }

      /* ---------- bouton HRS : relevé du compteur horaire actuel ---------- */
      function ouvrirReleve(e) {
        var input = el('input', { id: 'pp-hrs', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex : 21 300' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var btn = el('button', { class: 'btn-principal', type: 'button' }, ['Enregistrer le relevé']);
        var infos = [];
        if (e.horametreActuel !== null && e.horametreActuel !== undefined) infos.push('Dernier relevé : ' + fmtH(e.horametreActuel) + (e.dateReleve ? ' le ' + fmtDateFR(e.dateReleve) : '') + '.');
        infos.push(e.horametre !== null && e.horametre !== undefined ? 'Compteur à la dernière intervention : ' + fmtH(e.horametre) + '.' : 'Aucun compteur saisi lors des interventions : les heures écoulées ne pourront pas être calculées.');
        var fermer = modale('Compteur horaire', e.nom, [
          el('div', { class: 'ag-encadre' }, [infos.join(' ')]),
          el('div', { class: 'champ' }, [el('label', { for: 'pp-hrs' }, ['Compteur horaire actuel (h)']), input]), btn, msg]);
        function go() {
          var h = nombre(input.value);
          if (h === '' || isNaN(h)) { msg.textContent = 'Saisis le compteur horaire.'; msg.hidden = false; return; }
          var ref = (e.horametreActuel !== null && e.horametreActuel !== undefined) ? e.horametreActuel : e.horametre;
          if (ref !== null && ref !== undefined && h < ref &&
            !window.confirm('Le compteur saisi (' + h + ' h) est inférieur au dernier relevé connu (' + ref + ' h). Continuer quand même ?')) return;
          saisir({ type: 'pompes.releve', equipementId: e.id, horametre: h, date: aujourdhui() });
          fermer(); afficher();
          PM.toast('Relevé enregistré : ' + fmtH(h) + '.');
        }
        btn.addEventListener('click', go);
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
        setTimeout(function () { input.focus(); }, 30);
      }

      function ouvrirRenommer(e) {
        var input = el('input', { id: 'pp-renom', type: 'text', value: e.nom });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var btn = el('button', { class: 'btn-principal', type: 'button' }, ['Enregistrer']);
        var fermer = modale('Renommer le matériel', null, [el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', { for: 'pp-renom' }, ['Nom']), input]), btn, msg]);
        btn.addEventListener('click', function () {
          var nom = input.value.trim();
          if (!nom) { msg.textContent = 'Le nom ne peut pas être vide.'; msg.hidden = false; return; }
          saisir({ type: 'pompes.renommer', equipementId: e.id, nom: nom });
          fermer(); afficher(); PM.toast('Matériel renommé.');
        });
        setTimeout(function () { input.focus(); input.select(); }, 30);
      }

      function ouvrirAjoutMateriel(E) {
        var sel = el('select', { id: 'pp-type' }, E.types.map(function (t) { return el('option', { value: t.id }, [t.label]); }));
        var input = el('input', { id: 'pp-nouveau', type: 'text', placeholder: 'ex : Pompe Wangen 2', value: E.types[0] ? E.types[0].label : '' });
        sel.addEventListener('change', function () { var t = E.typeIndex[sel.value]; if (t) input.value = t.label; });
        var btn = el('button', { class: 'btn-principal', type: 'button' }, ['Ajouter']);
        var fermer = modale('Ajouter un matériel', NOM_SITE[ctx.site.id], [
          el('div', { class: 'champ', style: 'margin-top:12px' }, [el('label', { for: 'pp-type' }, ['Type de matériel']), sel]),
          el('div', { class: 'champ' }, [el('label', { for: 'pp-nouveau' }, ['Nom']), input]), btn]);
        btn.addEventListener('click', function () {
          saisir({ type: 'pompes.materiel', equipementId: PM.uid() + PM.uid(), typeId: sel.value, nom: input.value.trim() || (E.typeIndex[sel.value] || {}).label });
          fermer(); afficher(); PM.toast('Matériel ajouté.');
        });
      }

      function ouvrirSuppression(t, x) {
        var btn = el('button', { class: 'btn-principal pp-btn-danger', type: 'button' }, ['Supprimer définitivement']);
        var fermer = modale('Supprimer l’intervention', null, [
          el('div', { class: 'ag-encadre' }, [el('b', {}, [fmtDateFR(x.date)]), ' · ' + (x.operateur || '') + ' · ' + fmtH(x.horametre) + (t && t.tonnage ? ' · ' + fmtT(x.tonnage) : ''),
            el('br'), 'Pièces : ' + (libellesPieces(t, x.pieces) || 'aucune')]),
          el('p', { class: 'petit' }, ['Cette suppression est définitive. Les durées de vie calculées à partir de cette intervention seront recalculées automatiquement.']),
          btn]);
        btn.addEventListener('click', function () {
          saisir({ type: 'pompes.suppression', interventionId: x.id, equipementId: x.equipementId });
          if (enEdition === x.id) enEdition = null;
          fermer(); afficher(); PM.toast('Intervention supprimée.');
        });
      }
    }
  };
})();
