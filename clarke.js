/* =====================================================================
   MODULE « SUIVI CHARBON CLARKE » — Arraincourt Biogaz — version rapide
   Deux cuves de charbon actif en série : Cuve 1 (2 m³) → compresseur
   2 étages → Cuve 2 (plus petite). Même principe que le charbon du
   Suivi NH3 : remplacements / ajouts couche par couche, historique,
   modification / suppression, fonctionne sans réseau.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var NS = 'http://www.w3.org/2000/svg';
  // géométrie du schéma : cuve 1 plus grande que la cuve 2
  var CUVES = [
    { key: 'cuve1', x: 72,  w: 190, top: 50,  bottom: 220, cx: 167 },
    { key: 'cuve2', x: 720, w: 140, top: 100, bottom: 220, cx: 790 }
  ];

  /* ---------- Données de démonstration (tant que le serveur n'est pas réglé) ---------- */
  var DEMO = {
    types: [{ nom: 'SA 66', couleur: '#2A78D6' }, { nom: 'SA 78 CX', couleur: '#EB6834' }],
    cuves: { cuve1: { nom: 'Cuve 1', capaciteKg: 1000 }, cuve2: { nom: 'Cuve 2', capaciteKg: 500 } },
    operateurs: ['Alex', 'Pierrick', 'Antonin', 'Noé', 'Géraldine', 'Pascal', 'Régis', 'Benoit', 'Mathieu', 'Charles'],
    mouvements: [
      { id: 'g1', date: '2026-09-20T09:10:00Z', cuve: 'cuve1', typeMouvement: 'Remplacement', heuresCompteur: 12480, operateur: 'Alex', remarque: '', couches: [{ ordre: 1, type: 'SA 66', quantite: 200 }, { ordre: 2, type: 'SA 78 CX', quantite: 800 }] },
      { id: 'g2', date: '2026-08-02T14:30:00Z', cuve: 'cuve2', typeMouvement: 'Remplacement', heuresCompteur: 11320, operateur: 'Pierrick', remarque: '', couches: [{ ordre: 1, type: 'SA 78 CX', quantite: 500 }] },
      { id: 'g3', date: '2026-06-15T08:00:00Z', cuve: 'cuve1', typeMouvement: 'Remplacement', heuresCompteur: 10200, operateur: 'Alex', remarque: '', couches: [{ ordre: 1, type: 'SA 66', quantite: 200 }, { ordre: 2, type: 'SA 78 CX', quantite: 800 }] }
    ]
  };

  /* ---------- Schéma : cuve 1 → compresseur 2 étages → cuve 2 ---------- */
  function cuveSvg(c) {
    var h = c.bottom - c.top, cx = c.cx, x1 = c.x + c.w, ry = Math.round(c.w * 0.075);
    return '<g class="carbon-tank" data-cuve="' + c.key + '">' +
      '<polygon points="' + c.x + ',' + c.bottom + ' ' + x1 + ',' + c.bottom + ' ' + cx + ',' + (c.bottom + 44) + '" class="tank-cone"/>' +
      '<rect x="' + c.x + '" y="' + c.top + '" width="' + c.w + '" height="' + h + '" rx="4" class="tank-body"/>' +
      '<g clip-path="url(#ck-clip-' + c.key + ')" data-role="layers"></g>' +
      '<ellipse cx="' + cx + '" cy="' + c.top + '" rx="' + (c.w / 2) + '" ry="' + ry + '" class="tank-cap"/>' +
      '<text x="' + cx + '" y="' + (c.top - 22) + '" class="carbon-tank-label" text-anchor="middle" data-role="nom">—</text>' +
      '<text x="' + cx + '" y="' + (c.top - 8) + '" class="carbon-level-text" data-role="level-text">…</text>' +
      '<text x="' + cx + '" y="' + (c.bottom + 62) + '" class="ck-sous" text-anchor="middle" data-role="sous">—</text>' +
      '</g>';
  }
  function compresseurSvg() {
    // photo du compresseur 2 étages (vue miroir, fournie par Alex) : icons/compresseur-clarke.png
    return '<g class="ck-compresseur">' +
      '<image href="icons/compresseur-clarke.png" x="350" y="66" width="220" height="216" preserveAspectRatio="xMidYMid meet"/>' +
      '<text x="460" y="297" class="ck-comp-txt">COMPRESSEUR 2 ÉTAGES</text>' +
      '</g>';
  }
  var SCHEMA_SVG =
    '<svg class="nh3-schema-svg" viewBox="0 0 920 300" role="img" aria-label="Schéma : cuve 1 de charbon, compresseur 2 étages, cuve 2 de charbon">' +
    '<defs><linearGradient id="ckMetalGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" style="stop-color:var(--metal-2)"/><stop offset="0.5" style="stop-color:var(--metal-1)"/><stop offset="1" style="stop-color:var(--metal-3)"/></linearGradient>' +
    CUVES.map(function (c) { return '<clipPath id="ck-clip-' + c.key + '"><rect x="' + c.x + '" y="' + c.top + '" width="' + c.w + '" height="' + (c.bottom - c.top + 6) + '" rx="4"/></clipPath>'; }).join('') + '</defs>' +
    '<text x="8" y="108" class="pipe-endlabel">Entrée</text><text x="912" y="142" text-anchor="end" class="pipe-endlabel">Sortie</text>' +
    // conduites : entrée → cuve 1 ; cuve 1 → compresseur ; compresseur → cuve 2 ; cuve 2 → sortie
    '<g><path d="M8,120 H72" class="pipe-line-edge"/><path d="M262,130 H292 V195 H360" class="pipe-line-edge"/><path d="M560,195 H655 V150 H720" class="pipe-line-edge"/><path d="M860,150 H912" class="pipe-line-edge"/>' +
    '<path d="M8,120 H72" class="pipe-line"/><path d="M262,130 H292 V195 H360" class="pipe-line"/><path d="M560,195 H655 V150 H720" class="pipe-line"/><path d="M860,150 H912" class="pipe-line"/></g>' +
    cuveSvg(CUVES[0]) + compresseurSvg() + cuveSvg(CUVES[1]) +
    '<polygon points="300,160 306,172 294,172" class="flow-arrow"/><polygon points="616,189 628,195 616,201" class="flow-arrow"/><polygon points="884,144 896,150 884,156" class="flow-arrow"/>' +
    '</svg>';

  /* ---------- outils ---------- */
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDateTime(s) {
    var d = new Date(s); if (isNaN(d)) return s;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(s) { var d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function fmtKg(v) { return Math.round(v).toLocaleString('fr-FR'); }
  function nb(x) { var n = PM.nombre(x); return n === null || isNaN(n) ? null : n; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); return e; }
  function maintenantLocal(d) { var n = d ? new Date(d) : new Date(); if (isNaN(n)) n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + 'T' + pad(n.getHours()) + ':' + pad(n.getMinutes()); }
  function joursDepuis(s) { var d = new Date(s); return isNaN(d) ? null : Math.floor((Date.now() - d) / 86400000); }

  window.MODULES.clarke = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'clarke_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'clarke_attente_' + ctx.site.id;
      var D = null, attente = [], onglet = 'vue', formOuvert = false, edition = null;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = (r[0] && Array.isArray(r[0].mouvements)) ? r[0] : (modeDemo ? DEMO : null); // copie locale valide seulement
        attente = Array.isArray(r[1]) ? r[1] : [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        PM.Api.appeler(ctx.apiUrl, { action: 'clarke.donnees', cle: ctx.cle }, 25000).then(function (j) {
          delete j.ok;
          if (!Array.isArray(j.mouvements)) throw new Error('Réponse incomplète du serveur (Suivi Charbon Clarke non initialisé ?)');
          D = j; PM.DB.set(CLE_DONNEES, j);
          return PM.DB.listerEnvois().then(function (l) {
            var ids = (l || []).map(function (x) { return x.payload.id; });
            attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
            PM.DB.set(CLE_ATTENTE, attente);
            afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le Suivi Charbon Clarke.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('span', { class: 'petit' }, ['Si le serveur répond « non initialisé » : exécuter initialiserClarke() dans l’éditeur Apps Script d’Arraincourt.']), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : données du dernier chargement', 4000);
        });
      }
      var instance = PM.uid();
      window.__clarkeInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__clarkeInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- données affichées = serveur + saisies en attente ---------- */
      function mouvements() {
        var l = D.mouvements.slice();
        function depuis(a, id) {
          return { id: id, date: a.date, cuve: a.cuve, typeMouvement: a.typeMouvement, heuresCompteur: a.heuresCompteur, operateur: a.operateur || '', remarque: a.remarque || '',
            couches: a.couches.map(function (c, i) { return { ordre: i + 1, type: c.type, quantite: c.quantite }; }), enAttente: true };
        }
        attente.forEach(function (a) {
          if (a.type === 'clarke.mouvement') l.push(depuis(a, a.id));
          else if (a.type === 'clarke.mouvement.modif') l = l.map(function (m) { return m.id === a.idMouvement ? depuis(a, m.id) : m; });
          else if (a.type === 'clarke.mouvement.suppr') l = l.filter(function (m) { return m.id !== a.idMouvement; });
        });
        return l;
      }
      function types() {
        var l = D.types.slice();
        attente.forEach(function (a) { if (a.type === 'clarke.type' && !l.some(function (t) { return t.nom === a.nom; })) l.push({ nom: a.nom, couleur: a.couleur || '#8A94A6', enAttente: true }); });
        return l;
      }
      function couleurCharbon(nom) { var t = types().filter(function (x) { return x.nom === nom; })[0]; return t ? t.couleur : '#8A94A6'; }
      function nomCuve(k) { return (D.cuves && D.cuves[k] && D.cuves[k].nom) || (k === 'cuve1' ? 'Cuve 1' : 'Cuve 2'); }
      function capacite(k) { var c = D.cuves && D.cuves[k] && D.cuves[k].capaciteKg; return c > 0 ? c : (k === 'cuve1' ? 1000 : 500); }
      function pushCouche(stack, type, q) { var top = stack[stack.length - 1]; if (top && top.type === type) top.quantite += q; else stack.push({ type: type, quantite: q }); }
      function pile(cuve) {
        var stack = [];
        mouvements().filter(function (m) { return m.cuve === cuve; }).sort(byDate).forEach(function (m) {
          if (m.typeMouvement === 'Remplacement') stack = [];
          (m.couches || []).forEach(function (c) { pushCouche(stack, c.type, c.quantite); });
        });
        return stack;
      }
      function dernierRemplacement(cuve) {
        return mouvements().filter(function (m) { return m.cuve === cuve && m.typeMouvement === 'Remplacement'; }).sort(byDate).pop() || null;
      }
      /* durée de fonctionnement de chaque remplacement (différence de compteur avec le suivant, par cuve) */
      function durees() {
        var parCuve = {}, res = {};
        mouvements().forEach(function (m) { if (m.typeMouvement === 'Remplacement') (parCuve[m.cuve] = parCuve[m.cuve] || []).push(m); });
        Object.keys(parCuve).forEach(function (c) {
          var l = parCuve[c].sort(byDate);
          l.forEach(function (a, i) {
            var s = l[i + 1];
            if (a.heuresCompteur === null || a.heuresCompteur === undefined) res[a.id] = null;
            else if (!s) res[a.id] = { ongoing: true };
            else if (s.heuresCompteur !== null && s.heuresCompteur !== undefined) res[a.id] = { h: s.heuresCompteur - a.heuresCompteur };
            else res[a.id] = null;
          });
        });
        return res;
      }
      function boutonModifier(ligne, action) {
        if (ligne.enAttente || modeDemo) return el('td', { class: 'nh3-td-modif' }, []);
        return el('td', { class: 'nh3-td-modif' }, [el('button', { type: 'button', class: 'nh3-btn-modif', title: 'Modifier', 'aria-label': 'Modifier', onclick: action }, ['✎'])]);
      }
      function boutonSupprimer(libelle, action) {
        var b = el('button', { type: 'button', class: 'btn-second nh3-btn-suppr' }, [libelle]);
        var arme = false;
        b.onclick = function () {
          if (!arme) { arme = true; b.textContent = 'Confirmer la suppression ?'; b.classList.add('arme'); setTimeout(function () { arme = false; b.textContent = libelle; b.classList.remove('arme'); }, 5000); return; }
          action();
        };
        return b;
      }

      /* ---------- écran ---------- */
      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'nh3 clarke' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur d’Arraincourt dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['vue', 'Charbon Clarke'], ['historique', 'Historique']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', 'aria-selected': String(onglet === t[0]),
            onclick: function () { onglet = t[0]; afficher(); window.scrollTo(0, 0); } }, [t[1]]));
        });
        racine.appendChild(tabs);
        if (onglet === 'vue') ecranVue(racine); else ecranHistorique(racine);
        window.scrollTo(0, y);
      }

      /* ===== VUE : schéma + état des cuves + formulaire ===== */
      function ecranVue(racine) {
        var carte = el('section', { class: 'bandeau' });
        carte.appendChild(el('div', { class: 'carte-tete' }, [el('h2', {}, ['Charbon actif — compresseur 2 étages']),
          el('button', { class: 'btn-second', onclick: function () { formOuvert = !formOuvert; edition = null; afficher(); } }, [formOuvert ? 'Fermer' : '+ Nouveau mouvement'])]));
        if (formOuvert) carte.appendChild(formulaire());
        var wrap = el('div', { html: SCHEMA_SVG });
        carte.appendChild(wrap);
        var DOME_RY = 10;
        CUVES.forEach(function (cfg) {
          var g = wrap.querySelector('.carbon-tank[data-cuve="' + cfg.key + '"]');
          var layersG = g.querySelector('[data-role="layers"]'), lvl = g.querySelector('[data-role="level-text"]'), sous = g.querySelector('[data-role="sous"]');
          g.querySelector('[data-role="nom"]').textContent = nomCuve(cfg.key);
          var cap = capacite(cfg.key), bodyH = cfg.bottom - cfg.top, bodyBottom = cfg.bottom;
          var stack = pile(cfg.key), total = stack.reduce(function (s, l) { return s + l.quantite; }, 0), scale = total > cap ? cap / total : 1;
          var layers = [];
          stack.forEach(function (l) { var h = (l.quantite * scale / cap) * bodyH; if (h > 0) layers.push({ type: l.type, h: h, color: couleurCharbon(l.type) }); });
          var n = layers.length, ys = [bodyBottom];
          layers.forEach(function (l) { ys.push(ys[ys.length - 1] - l.h); });
          var x0 = cfg.x, x1 = cfg.x + cfg.w, xm = cfg.cx;
          layers.forEach(function (l, i) {
            var yB = ys[i], yT = ys[i + 1];
            var ryT = Math.min(DOME_RY, l.h, i + 1 < n ? layers[i + 1].h : l.h);
            var ryB = i === 0 ? Math.min(DOME_RY, l.h) : Math.min(DOME_RY, l.h, layers[i - 1].h);
            var d = 'M' + x0 + ',' + yB + ' Q' + xm + ',' + (yB + ryB) + ' ' + x1 + ',' + yB + ' L' + x1 + ',' + yT + ' ';
            d += ryT > 0 ? ('Q' + xm + ',' + (yT + ryT) + ' ' + x0 + ',' + yT + ' Z') : ('L' + x0 + ',' + yT + ' Z');
            layersG.appendChild(svgEl('path', { d: d, fill: l.color }));
            if (l.h >= 12) { var t = svgEl('text', { x: xm, y: (yB + yT) / 2 + 4, class: 'carbon-layer-label' }); t.textContent = l.type + ' · ' + fmtKg(stack[i].quantite) + ' kg'; layersG.appendChild(t); }
          });
          lvl.textContent = total > 0 ? fmtKg(total) + ' / ' + fmtKg(cap) + ' kg' + (total > cap ? ' (max atteint)' : '') : 'Vide';
          var der = dernierRemplacement(cfg.key), j = der ? joursDepuis(der.date) : null;
          sous.textContent = der ? 'Remplacé le ' + fmtDate(der.date) + (j !== null ? ' (' + j + ' j)' : '') : 'Aucun remplacement enregistré';
        });
        carte.appendChild(el('div', { class: 'schema-legend' }, types().map(function (t) {
          return el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:' + t.couleur }), t.nom + (t.enAttente ? ' ⏳' : '')]);
        })));
        racine.appendChild(carte);

        // État de chaque cuve (cartes)
        var du = durees();
        var grille = el('div', { class: 'ck-cuves' });
        CUVES.forEach(function (cfg) {
          var der = dernierRemplacement(cfg.key), stack = pile(cfg.key), total = stack.reduce(function (s, l) { return s + l.quantite; }, 0);
          var j = der ? joursDepuis(der.date) : null, dd = der ? du[der.id] : null;
          var nbRempl = mouvements().filter(function (m) { return m.cuve === cfg.key && m.typeMouvement === 'Remplacement'; }).length;
          var c = el('section', { class: 'bandeau ck-cuve' }, [
            el('div', { class: 'carte-tete' }, [el('h2', {}, [nomCuve(cfg.key)]), el('span', { class: 'petit' }, [cfg.key === 'cuve1' ? '2 m³ · avant compresseur' : 'après compresseur'])]),
            el('div', { class: 'ck-kpis' }, [
              el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [total > 0 ? fmtKg(total) : '—', el('span', { class: 'trend-unit' }, [' kg'])]), el('div', { class: 'ck-kpi-lbl' }, ['charbon en place'])]),
              el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [j !== null ? String(j) : '—', el('span', { class: 'trend-unit' }, [' j'])]), el('div', { class: 'ck-kpi-lbl' }, ['depuis le remplacement'])]),
              el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [dd && dd.ongoing ? 'En cours' : dd && typeof dd.h === 'number' ? fmtKg(dd.h) + ' h' : '—']), el('div', { class: 'ck-kpi-lbl' }, ['fonctionnement'])]),
              el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [String(nbRempl)]), el('div', { class: 'ck-kpi-lbl' }, [nbRempl > 1 ? 'remplacements' : 'remplacement'])])
            ]),
            el('div', { class: 'petit' }, [der ? 'Dernier remplacement : ' + fmtDateTime(der.date) + (der.operateur ? ' — ' + der.operateur : '') + (der.heuresCompteur !== null && der.heuresCompteur !== undefined ? ' — compteur ' + fmtKg(der.heuresCompteur) + ' h' : '') : 'Aucun remplacement enregistré.']),
            stack.length ? el('div', { class: 'petit' }, ['Composition (du fond vers le haut) : ' + stack.map(function (l) { return l.type + ' ' + fmtKg(l.quantite) + ' kg'; }).join(' · ')]) : null
          ]);
          grille.appendChild(c);
        });
        racine.appendChild(grille);
      }

      /* ===== HISTORIQUE ===== */
      function ecranHistorique(racine) {
        var rows = mouvements().slice().sort(byDate).reverse(), du = durees();
        var tbody = el('tbody');
        rows.forEach(function (m) {
          var total = (m.couches || []).reduce(function (s, c) { return s + c.quantite; }, 0), dd = du[m.id];
          tbody.appendChild(el('tr', { class: m.enAttente ? 'attente' : '' }, [
            boutonModifier(m, function () { edition = m; formOuvert = true; onglet = 'vue'; afficher(); window.scrollTo(0, 0); }),
            el('td', { class: 'date-cell' }, [fmtDateTime(m.date) + (m.enAttente ? ' ⏳' : '')]),
            el('td', {}, [nomCuve(m.cuve)]), el('td', {}, [m.typeMouvement]),
            el('td', {}, (m.couches || []).reduce(function (acc, c, i) { if (i) acc.push(el('br')); acc.push(String(c.type) + ' — ' + fmtKg(c.quantite) + ' kg'); return acc; }, [])),
            el('td', { class: 'val-cell' }, [fmtKg(total) + ' kg']),
            el('td', { class: 'val-cell' }, [(m.heuresCompteur !== null && m.heuresCompteur !== undefined) ? fmtKg(m.heuresCompteur) + ' h' : '—']),
            el('td', { class: 'val-cell' }, [dd && dd.ongoing ? 'En cours' : dd && typeof dd.h === 'number' ? fmtKg(dd.h) + ' h' : '—']),
            el('td', {}, [m.operateur || '—']),
            el('td', { class: 'ck-remarque' }, [m.remarque || ''])
          ]));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Historique charbon Clarke']), el('span', { class: 'petit' }, [rows.length + (rows.length > 1 ? ' mouvements' : ' mouvement')])]),
          rows.length ? el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table nh3-table-large' }, [
            el('thead', {}, [el('tr', {}, ['', 'Date', 'Cuve', 'Mouvement', 'Charbon', 'Quantité', 'Heures compteur', 'Durée de fonctionnement', 'Opérateur', 'Remarque'].map(function (h) { return el('th', {}, [h]); }))]), tbody])])
            : el('p', { class: 'petit' }, ['Aucun mouvement enregistré. Touche « + Nouveau mouvement » dans l’onglet Charbon Clarke.']),
          modeDemo || !rows.length ? null : el('p', { class: 'petit' }, ['Touche ✎ pour corriger ou supprimer un mouvement.'])
        ]));
      }

      /* ===== FORMULAIRE : nouveau mouvement / modification ===== */
      function formulaire() {
        var E = edition;
        var date = el('input', { type: 'datetime-local', value: maintenantLocal(E ? E.date : null) });
        var cuve = el('select', {}, CUVES.map(function (c) { return el('option', { value: c.key, selected: E && E.cuve === c.key ? 'selected' : null }, [nomCuve(c.key) + (c.key === 'cuve1' ? ' (2 m³, avant compresseur)' : ' (après compresseur)')]); }));
        var mvt = el('select', {}, [el('option', { value: 'Remplacement' }, ['Remplacement (vidange + remplissage)']), el('option', { value: 'Ajout', selected: E && E.typeMouvement === 'Ajout' ? 'selected' : null }, ['Ajout (par-dessus, sans vidange)'])]);
        var heures = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'heures (facultatif)', value: E && typeof E.heuresCompteur === 'number' ? String(E.heuresCompteur) : '' });
        var agent = PM.Prefs.get('agent', '');
        var operateurs = (D.operateurs && D.operateurs.length ? D.operateurs : DEMO.operateurs);
        var oper = el('select', {}, [el('option', { value: '' }, ['— Choisir —'])].concat(operateurs.map(function (o) { return el('option', { value: o, selected: o === agent ? 'selected' : null }, [o]); })));
        var remarque = el('input', { type: 'text', placeholder: 'facultatif', value: E ? (E.remarque || '') : '' });
        var blocOper = el('div', { class: 'champ' }, [el('label', {}, ['Opérateur (tracé dans le tableau des interventions)']), oper]);
        function majVisibilite() { blocOper.hidden = mvt.value !== 'Remplacement' || !!E; }
        mvt.addEventListener('change', majVisibilite);
        var couches = el('div', { class: 'nh3-couches' });
        function renum() {
          var rs = couches.querySelectorAll('.carbon-layer-row');
          rs.forEach(function (r, i) { r.querySelector('.carbon-layer-index').textContent = i + 1; r.querySelector('.carbon-layer-remove').disabled = rs.length <= 1; });
        }
        function optionsTypes(sel, choisi) {
          sel.innerHTML = '';
          types().forEach(function (t) { sel.appendChild(el('option', { value: t.nom, selected: t.nom === choisi ? 'selected' : null }, [t.nom])); });
        }
        function ajouterCouche(type, q) {
          var row = el('div', { class: 'carbon-layer-row' });
          var sel = el('select', { class: 'ck-type' }); optionsTypes(sel, type);
          var qty = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Quantité (kg)', value: q !== undefined ? String(q) : '' });
          var suppr = el('button', { type: 'button', class: 'carbon-layer-remove', 'aria-label': 'Retirer cette couche', onclick: function () { row.remove(); renum(); } }, ['✕']);
          row.appendChild(el('span', { class: 'carbon-layer-index' })); row.appendChild(sel); row.appendChild(qty); row.appendChild(suppr);
          couches.appendChild(row); renum();
        }
        // pré-remplissage avec la composition du dernier remplacement de la cuve choisie
        function preRemplir() {
          couches.innerHTML = '';
          var dernier = E || dernierRemplacement(cuve.value);
          if (dernier && dernier.couches.length) dernier.couches.forEach(function (c) { ajouterCouche(c.type, c.quantite); }); else ajouterCouche();
        }
        preRemplir();
        if (!E) cuve.addEventListener('change', preRemplir);
        majVisibilite();

        // nouveau type de charbon (envoyé avec la file hors ligne, disponible tout de suite dans les listes)
        var nouveauType = el('input', { type: 'text', placeholder: 'Nom du nouveau type (ex. SA 90)' });
        var blocType = el('div', { class: 'champ ck-nouveau-type', hidden: true }, [el('label', {}, ['Nouveau type de charbon']),
          el('div', { style: 'display:flex;gap:8px' }, [nouveauType, el('button', { type: 'button', class: 'btn-second', onclick: function () {
            var nom = nouveauType.value.trim(); if (!nom) { PM.toast('Indique le nom du type'); return; }
            if (types().some(function (t) { return t.nom.toLowerCase() === nom.toLowerCase(); })) { PM.toast('Ce type existe déjà'); return; }
            var palette = ['#2A78D6', '#EB6834', '#2BB673', '#9B59B6', '#F1C40F', '#1ABC9C', '#E74C3C', '#34495E'];
            envoyer({ type: 'clarke.type', nom: nom, couleur: palette[types().length % palette.length] });
            nouveauType.value = ''; blocType.hidden = true;
            couches.querySelectorAll('select.ck-type').forEach(function (s) { optionsTypes(s, s.value); });
            PM.toast('Type « ' + nom + ' » ajouté' + (modeDemo ? ' (démo)' : ''));
          } }, ['Ajouter'])])]);

        return el('div', { class: 'nh3-form-charbon' + (E ? ' nh3-edition' : '') }, [
          E ? el('h3', { class: 'nh3-h2' }, ['Modifier le mouvement du ' + fmtDateTime(E.date)]) : null,
          el('div', { class: 'champ' }, [el('label', {}, ['Date et heure']), date]),
          el('div', { class: 'nh3-2col' }, [el('div', { class: 'champ' }, [el('label', {}, ['Cuve']), cuve]), el('div', { class: 'champ' }, [el('label', {}, ['Type de mouvement']), mvt])]),
          el('div', { class: 'champ' }, [el('label', {}, ['Heures compteur du compresseur (h) — sert à calculer la durée de fonctionnement']), heures]),
          blocOper,
          el('p', { class: 'petit' }, ['Une couche par type de charbon : la première ligne est celle du fond de la cuve.']),
          couches,
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
            el('button', { type: 'button', class: 'btn-second', onclick: function () { ajouterCouche(); } }, ['+ Ajouter une couche']),
            el('button', { type: 'button', class: 'btn-second', onclick: function () { blocType.hidden = !blocType.hidden; if (!blocType.hidden) nouveauType.focus(); } }, ['+ Nouveau type de charbon'])
          ]),
          blocType,
          el('div', { class: 'champ', style: 'margin-top:8px' }, [el('label', {}, ['Remarque']), remarque]),
          el('button', { class: 'btn-principal', style: 'margin-top:12px', onclick: function () {
            var d = new Date(date.value); if (isNaN(d)) { PM.toast('Date invalide'); return; }
            var cs = [], ok = true;
            couches.querySelectorAll('.carbon-layer-row').forEach(function (r) {
              var q = nb(r.querySelector('input').value);
              if (q === null || q < 0) ok = false; else cs.push({ type: r.querySelector('select').value, quantite: q });
            });
            if (!ok || !cs.length) { PM.toast('Indique la quantité de chaque couche'); return; }
            var h = null;
            if (heures.value.trim() !== '') { h = nb(heures.value); if (h === null || h < 0) { PM.toast('Heures compteur invalides'); heures.focus(); return; } }
            if (!E && mvt.value === 'Remplacement' && !oper.value) { PM.toast('Choisis l’opérateur'); return; }
            formOuvert = false;
            if (E) {
              edition = null;
              enregistrer({ type: 'clarke.mouvement.modif', idMouvement: E.id, date: d.toISOString(), cuve: cuve.value, typeMouvement: mvt.value, heuresCompteur: h, operateur: E.operateur || '', remarque: remarque.value.trim(), couches: cs }, 'Mouvement de charbon modifié');
            } else {
              enregistrer({ type: 'clarke.mouvement', date: d.toISOString(), cuve: cuve.value, typeMouvement: mvt.value, heuresCompteur: h,
                operateur: mvt.value === 'Remplacement' ? oper.value : '', remarque: remarque.value.trim(), couches: cs }, 'Mouvement de charbon enregistré');
            }
          } }, [E ? 'Enregistrer la modification' : 'Enregistrer']),
          E ? el('div', { class: 'nh3-actions-edition' }, [
            el('button', { type: 'button', class: 'btn-second', onclick: function () { edition = null; formOuvert = false; afficher(); } }, ['Annuler']),
            boutonSupprimer('Supprimer ce mouvement', function () {
              edition = null; formOuvert = false;
              enregistrer({ type: 'clarke.mouvement.suppr', idMouvement: E.id }, 'Mouvement supprimé');
            })
          ]) : null
        ]);
      }

      /* Enregistrement : affiché tout de suite, envoyé dès que possible */
      function envoyer(payload) {
        payload.id = PM.uid();
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, JSON.parse(JSON.stringify(payload)));
      }
      function enregistrer(payload, message) {
        envoyer(payload);
        PM.toast(message + (modeDemo ? ' (démo, non envoyé)' : (navigator.onLine ? '' : ' · envoi au retour du réseau')));
        onglet = 'vue';
        afficher();
        window.scrollTo(0, 0);
      }
    }
  };
})();
