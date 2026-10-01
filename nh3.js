/* =====================================================================
   MODULE « SUIVI NH3 » — Arraincourt Biogaz — version rapide
   Reprend l'écran de l'appli d'origine (schéma de filtration avec les
   cuves et le logo Prodeval, 3 courbes, historique, charbon actif) et
   fonctionne sans réseau : les saisies partent dès que le réseau revient.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var NS = 'http://www.w3.org/2000/svg';
  var UNIT = 'ppm';
  var POINTS = [
    { key: 'entree',  label: 'Entrée cuve 1', varColor: '--s1' },
    { key: 'sortie1', label: 'Sortie cuve 1', varColor: '--s2' },
    { key: 'sortie2', label: 'Sortie cuve 2', varColor: '--s3' }
  ];
  var CARBON_CUVES = [{ key: '03F321', bx: 170 }, { key: '03F331', bx: 560 }];
  var OPERATEURS = ['Alex', 'Pierrick', 'Antonin', 'Noé', 'Géraldine', 'Pascal', 'Régis', 'Benoit', 'Mathieu', 'Charles'];

  /* ---------- Données de démonstration (tant que le serveur n'est pas réglé) ---------- */
  var DEMO = {
    releves: [
      ['2026-08-27T18:00', 35, 10, 0], ['2026-09-01T17:59', 30, 20, 0], ['2026-09-03T13:41', 50, 26.5, 0],
      ['2026-09-10T13:22', 48, 12, 15], ['2026-09-11T07:17', 20, 10, 5], ['2026-09-13T09:32', 35, 10, 0],
      ['2026-09-17T07:50', 30, 0, 0], ['2026-09-25T08:45', 15, 5, 0]
    ].map(function (r, i) { return { id: 'd' + i, date: new Date(r[0]).toISOString(), entree: r[1], sortie1: r[2], sortie2: r[3], alerte: '' }; }),
    seuils: { entree: 30, sortie1: 0, sortie2: 0 },
    reglages: { intervalleJours: 7, heureDebutAlertes: 8, heureFinAlertes: 19 },
    charbon: {
      types: [{ nom: 'SA 66', couleur: '#2A78D6' }, { nom: 'SA 78 CX', couleur: '#EB6834' }],
      capaciteKg: 4000, roles: { cuve1: '03F331', force: '' },
      mouvements: [
        { id: 'g1', date: '2026-09-11T13:34:00Z', cuve: '03F321', typeMouvement: 'Remplacement', heuresCompteur: 34337, couches: [{ ordre: 1, type: 'SA 66', quantite: 500 }, { ordre: 2, type: 'SA 78 CX', quantite: 3500 }] },
        { id: 'g2', date: '2026-08-11T13:34:00Z', cuve: '03F331', typeMouvement: 'Remplacement', heuresCompteur: 33597, couches: [{ ordre: 1, type: 'SA 66', quantite: 500 }, { ordre: 2, type: 'SA 78 CX', quantite: 3500 }] },
        { id: 'g3', date: '2026-08-03T20:26:00Z', cuve: '03F321', typeMouvement: 'Remplacement', heuresCompteur: 33415, couches: [{ ordre: 1, type: 'SA 66', quantite: 500 }, { ordre: 2, type: 'SA 78 CX', quantite: 3500 }] }
      ]
    }
  };

  /* ---------- Schéma de filtration (repris de l'appli d'origine) ---------- */
  function tank(x, cx, pos) {
    return '<g class="tank">' +
      '<polygon points="' + x + ',184 ' + (x + 170) + ',184 ' + cx + ',258" class="tank-cone"/>' +
      '<rect x="' + x + '" y="44" width="170" height="140" rx="4" class="tank-body"/>' +
      '<circle cx="' + (x + 26) + '" cy="60" r="2.4" class="tank-rivets"/><circle cx="' + (x + 144) + '" cy="60" r="2.4" class="tank-rivets"/>' +
      '<circle cx="' + (x + 26) + '" cy="168" r="2.4" class="tank-rivets"/><circle cx="' + (x + 144) + '" cy="168" r="2.4" class="tank-rivets"/>' +
      '<ellipse cx="' + cx + '" cy="44" rx="85" ry="13" class="tank-cap"/><ellipse cx="' + cx + '" cy="184" rx="85" ry="9" class="tank-rim"/>' +
      '<text x="' + cx + '" y="91" class="tank-label" data-position="' + pos + '">—</text>' +
      '<rect x="' + (cx - 29) + '" y="110" width="58" height="50" rx="6" fill="#FFFFFF" stroke="var(--metal-edge)" stroke-width="1.2" filter="url(#nh3PlateShadow)"/>' +
      '<image href="icons/logo-prodeval.png" x="' + (cx - 22) + '" y="113.11" width="44" height="43.78" preserveAspectRatio="xMidYMid meet"/>' +
      '</g>';
  }
  function badge(key, x, yLeaderTop, yPipe, yRing) {
    return '<g class="badge-group" data-point="' + key + '">' +
      '<line x1="' + x + '" y1="' + yLeaderTop + '" x2="' + x + '" y2="' + yPipe + '" class="badge-leader"/>' +
      '<circle cx="' + x + '" cy="' + yPipe + '" r="2.6" style="fill:var(--pipe)"/>' +
      '<circle cx="' + x + '" cy="' + yRing + '" r="24" class="badge-ring status-none" data-role="ring"/>' +
      '<text x="' + x + '" y="' + (yRing + 4) + '" class="badge-value" data-role="value">—</text>' +
      '<text x="' + x + '" y="' + (yRing + 15) + '" class="badge-unit">ppm</text></g>';
  }
  var SCHEMA_SVG =
    '<svg class="nh3-schema-svg" viewBox="0 0 920 340" role="img" aria-label="Schéma des deux cuves de charbon actif avec les trois points de mesure NH3">' +
    '<defs><linearGradient id="nh3MetalGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" style="stop-color:var(--metal-2)"/><stop offset="0.5" style="stop-color:var(--metal-1)"/><stop offset="1" style="stop-color:var(--metal-3)"/></linearGradient>' +
    '<filter id="nh3PlateShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#101820" flood-opacity="0.28"/></filter></defs>' +
    '<text x="14" y="60" class="pipe-endlabel">Gaz brut</text><text x="906" y="294" text-anchor="end" class="pipe-endlabel">Vers valorisation</text>' +
    '<g><path d="M14,74 H170" class="pipe-line-edge"/><path d="M255,258 V304 H560 V74" class="pipe-line-edge"/><path d="M645,258 V304 H906" class="pipe-line-edge"/>' +
    '<path d="M14,74 H170" class="pipe-line"/><path d="M255,258 V304 H560 V74" class="pipe-line"/><path d="M645,258 V304 H906" class="pipe-line"/></g>' +
    tank(170, 255, 1) + tank(560, 645, 2) +
    '<polygon points="134,68 146,74 134,80" class="flow-arrow"/><polygon points="554,146 560,134 566,146" class="flow-arrow"/><polygon points="854,298 866,304 854,310" class="flow-arrow"/>' +
    badge('entree', 92, 54, 74, 30) + badge('sortie1', 407, 174, 304, 150) + badge('sortie2', 790, 174, 304, 150) +
    '</svg>';
  function carbonTank(code, x, cx, lx, anchor) {
    return '<g class="carbon-tank" data-cuve="' + code + '">' +
      '<polygon points="' + x + ',184 ' + (x + 170) + ',184 ' + cx + ',258" class="tank-cone"/>' +
      '<rect x="' + x + '" y="44" width="170" height="140" rx="4" class="tank-body"/>' +
      '<g clip-path="url(#nh3-clip-' + code + ')" data-role="layers"></g>' +
      '<ellipse cx="' + cx + '" cy="44" rx="85" ry="13" class="tank-cap"/>' +
      '<text x="' + lx + '" y="110" class="carbon-tank-label" text-anchor="' + anchor + '">' + code + '</text>' +
      '<text x="' + cx + '" y="216" class="carbon-bottom-note" data-role="bottom-note"></text>' +
      '<text x="' + cx + '" y="22" class="carbon-level-text" data-role="level-text">…</text></g>';
  }
  var CARBON_SVG =
    '<svg class="nh3-schema-svg" viewBox="0 0 920 300" role="img" aria-label="Niveau de charbon actif des cuves 03F321 et 03F331">' +
    '<defs><clipPath id="nh3-clip-03F321"><rect x="170" y="44" width="170" height="146" rx="4"/></clipPath><clipPath id="nh3-clip-03F331"><rect x="560" y="44" width="170" height="146" rx="4"/></clipPath></defs>' +
    carbonTank('03F321', 170, 255, 155, 'end') + carbonTank('03F331', 560, 645, 745, 'start') + '</svg>';

  /* ---------- outils ---------- */
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function statusFor(v, t) { if (v >= t) return 'crit'; if (v >= t * 0.8) return 'warn'; return 'good'; }
  function statusLabel(s) { return s === 'crit' ? 'Seuil dépassé' : s === 'warn' ? 'Proche du seuil' : 'Conforme'; }
  function fmtDateShort(s) { var d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  function fmtDateTime(s) {
    var d = new Date(s); if (isNaN(d)) return s;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtVal(v) { return (Math.round(v * 10) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 }); }
  function fmtKg(v) { return Math.round(v).toLocaleString('fr-FR'); }
  function nb(x) { if (x === '' || x === null || x === undefined) return null; var n = parseFloat(String(x).replace(',', '.')); return isNaN(n) ? null : n; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); return e; }
  function maintenantLocal() { var n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) + 'T' + pad(n.getHours()) + ':' + pad(n.getMinutes()); }
  function determinerCuve1(mouvements, force) {
    if (force === '03F321' || force === '03F331') return force;
    var der = { '03F321': null, '03F331': null };
    mouvements.forEach(function (m) { if (m.typeMouvement !== 'Remplacement') return; var d = new Date(m.date); if (!der[m.cuve] || d > der[m.cuve]) der[m.cuve] = d; });
    if (!der['03F321'] && !der['03F331']) return '03F331';
    if (!der['03F321']) return '03F321';
    if (!der['03F331']) return '03F331';
    return der['03F321'] > der['03F331'] ? '03F331' : '03F321';
  }

  window.MODULES.nh3 = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'nh3v2_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'nh3v2_attente_' + ctx.site.id;
      var D = null, attente = [], onglet = 'vue', formCharbonOuvert = false;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = r[0] || (modeDemo ? DEMO : null);
        attente = r[1] || [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        PM.Api.appeler(ctx.apiUrl, { action: 'nh3.donnees', cle: ctx.cle }, 25000).then(function (j) {
          delete j.ok; D = j; PM.DB.set(CLE_DONNEES, j);
          return PM.DB.listerEnvois().then(function (l) {
            var ids = (l || []).map(function (x) { return x.payload.id; });
            attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
            PM.DB.set(CLE_ATTENTE, attente);
            afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le suivi NH3.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast('Hors ligne : données du dernier chargement');
        });
      }
      var instance = PM.uid();
      window.__nh3Instance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__nh3Instance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- données affichées = serveur + saisies en attente ---------- */
      function releves() {
        var l = D.releves.slice();
        attente.forEach(function (a) { if (a.type === 'nh3.releve') l.push({ id: a.id, date: a.dateAnalyse, entree: a.entree, sortie1: a.sortie1, sortie2: a.sortie2, enAttente: true }); });
        return l.sort(byDate);
      }
      function mouvements() {
        var l = D.charbon.mouvements.slice();
        attente.forEach(function (a) {
          if (a.type === 'nh3.mouvement') l.push({ id: a.id, date: a.date, cuve: a.cuve, typeMouvement: a.typeMouvement, heuresCompteur: a.heuresCompteur,
            couches: a.couches.map(function (c, i) { return { ordre: i + 1, type: c.type, quantite: c.quantite }; }), enAttente: true });
        });
        return l;
      }
      function couleurCharbon(nom) { var t = D.charbon.types.filter(function (x) { return x.nom === nom; })[0]; return t ? t.couleur : '#8A94A6'; }

      /* ---------- écran ---------- */
      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'nh3' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur d’Arraincourt dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['vue', 'Suivi NH3'], ['analyse', '+ Analyse'], ['charbon', 'Charbon actif']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', 'aria-selected': String(onglet === t[0]),
            onclick: function () { onglet = t[0]; afficher(); window.scrollTo(0, 0); } }, [t[1]]));
        });
        racine.appendChild(tabs);
        if (onglet === 'vue') ecranVue(racine);
        else if (onglet === 'analyse') ecranAnalyse(racine);
        else ecranCharbon(racine);
        window.scrollTo(0, y);
      }

      /* ===== SUIVI NH3 : échéance, schéma, courbes, historique ===== */
      function ecranVue(racine) {
        var R = releves(), S = D.seuils, last = R[R.length - 1];

        // Échéance (même règle que l'appli d'origine : J + intervalle, à l'heure de début des alertes)
        if (last) {
          var ld = new Date(last.date), iv = D.reglages.intervalleJours > 0 ? D.reglages.intervalleJours : 7;
          var hd = isNaN(D.reglages.heureDebutAlertes) ? 8 : D.reglages.heureDebutAlertes;
          var ech = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + iv, hd, 0, 0, 0);
          var reste = ech - new Date(), retard = Math.floor(-reste / 86400000), st, txt;
          if (reste <= 0) { st = 'crit'; txt = 'Analyse en retard' + (retard > 0 ? ' de ' + retard + ' jour(s)' : '') + ' — échéance le ' + fmtDateTime(ech.toISOString()); }
          else if (reste <= 86400000) { st = 'warn'; txt = 'Analyse due demain (' + fmtDateTime(ech.toISOString()) + ')'; }
          else { st = 'good'; txt = 'Prochaine analyse due le ' + fmtDateTime(ech.toISOString()); }
          racine.appendChild(el('div', { style: 'margin-bottom:12px' }, [el('span', { class: 'status-pill ' + st }, [el('span', { class: 'dot' }), txt])]));
        }

        // Schéma de filtration
        var carte = el('section', { class: 'bandeau' });
        carte.appendChild(el('div', { class: 'carte-tete' }, [el('h2', {}, ['Schéma de filtration']),
          el('span', { class: 'petit' }, [last ? 'Dernière analyse : ' + fmtDateTime(last.date) + (last.enAttente ? ' ⏳' : '') : 'Aucune analyse enregistrée'])]));
        var wrap = el('div', { html: SCHEMA_SVG });
        carte.appendChild(wrap);
        var c1 = determinerCuve1(mouvements(), (D.charbon.roles || {}).force) === '03F321' ? '03F321' : '03F331';
        var c2 = c1 === '03F321' ? '03F331' : '03F321';
        wrap.querySelector('[data-position="1"]').textContent = c1;
        wrap.querySelector('[data-position="2"]').textContent = c2;
        POINTS.forEach(function (p) {
          var g = wrap.querySelector('.badge-group[data-point="' + p.key + '"]');
          var ring = g.querySelector('[data-role="ring"]');
          ring.classList.remove('status-none');
          if (last && typeof last[p.key] === 'number') {
            ring.classList.add('status-' + statusFor(last[p.key], S[p.key]));
            g.querySelector('[data-role="value"]').textContent = fmtVal(last[p.key]);
          } else ring.classList.add('status-none');
        });
        carte.appendChild(el('div', { class: 'schema-legend' }, POINTS.map(function (p) {
          return el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:var(' + p.varColor + ')' }), p.label,
            el('span', { class: 'legend-thresh' }, ['seuil ' + S[p.key] + ' ' + UNIT])]);
        })));
        racine.appendChild(carte);

        // 3 courbes de progression
        POINTS.forEach(function (p) {
          var series = R.map(function (r) { return { t: new Date(r.date).getTime(), v: r[p.key], date: r.date }; })
            .filter(function (pt) { return !isNaN(pt.t) && typeof pt.v === 'number'; }).sort(function (a, b) { return a.t - b.t; });
          var der = series[series.length - 1];
          var tc = el('section', { class: 'bandeau trend-card' });
          var stat = el('div', { class: 'trend-stat' });
          if (der) {
            var st2 = statusFor(der.v, S[p.key]);
            stat.appendChild(el('div', { class: 'trend-value' }, [fmtVal(der.v), el('span', { class: 'trend-unit' }, [UNIT])]));
            stat.appendChild(el('div', { class: 'trend-date' }, [fmtDateTime(der.date)]));
            stat.appendChild(el('span', { class: 'status-pill ' + st2 }, [el('span', { class: 'dot' }), statusLabel(st2)]));
          } else stat.appendChild(el('div', { class: 'trend-value petit' }, ['—']));
          tc.appendChild(el('div', { class: 'trend-top' }, [el('div', { class: 'trend-title' }, [el('span', { class: 'trend-dot', style: 'background:var(' + p.varColor + ')' }), p.label]), stat]));
          var cw = el('div', { class: 'trend-chart-wrap' });
          var svgNode = svgEl('svg', { role: 'img', 'aria-label': 'Courbe de progression — ' + p.label });
          var tip = el('div', { class: 'chart-tooltip' });
          cw.appendChild(svgNode); cw.appendChild(tip);
          tc.appendChild(cw);
          if (!renderChart(svgNode, series, S[p.key], p.varColor, tip)) { svgNode.style.display = 'none'; cw.appendChild(el('div', { class: 'chart-empty' }, ['Pas encore de relevé pour ce point.'])); }
          racine.appendChild(tc);
        });

        // Historique
        var rows = R.slice().reverse();
        var tbody = el('tbody');
        rows.forEach(function (r) {
          tbody.appendChild(el('tr', { class: r.enAttente ? 'attente' : '' }, [el('td', { class: 'date-cell' }, [fmtDateTime(r.date) + (r.enAttente ? ' ⏳' : '')])].concat(POINTS.map(function (p) {
            var st3 = statusFor(r[p.key], S[p.key]);
            return el('td', { class: 'val-cell' }, [el('span', { class: 'status-pill ' + st3 }, [el('span', { class: 'dot' }), fmtVal(r[p.key]) + ' ' + UNIT])]);
          }))));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Historique des relevés']), el('span', { class: 'petit' }, [rows.length + (rows.length > 1 ? ' relevés' : ' relevé')])]),
          el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table' }, [el('thead', {}, [el('tr', {}, ['Date', 'Entrée cuve 1', 'Sortie cuve 1', 'Sortie cuve 2'].map(function (h) { return el('th', {}, [h]); }))]), tbody])])
        ]));
        racine.appendChild(el('p', { class: 'petit nh3-pied' }, ['Seuils d’alerte — Entrée cuve 1 : ' + S.entree + ' ppm · Sortie cuve 1 : ' + S.sortie1 + ' ppm · Sortie cuve 2 : ' + S.sortie2 + ' ppm']));
      }

      /* Courbe d'un point (reprise de l'appli d'origine) */
      function renderChart(svgNode, series, threshold, colorVar, tooltipEl) {
        var W = 480, H = 190, ML = 34, MR = 10, MT = 16, MB = 22, plotW = W - ML - MR, plotH = H - MT - MB;
        svgNode.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        if (!series.length) return false;
        var ts = series.map(function (p) { return p.t; }), vs = series.map(function (p) { return p.v; });
        var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
        if (tMin === tMax) { tMin -= 86400000; tMax += 86400000; }
        var vMax = Math.max(Math.max.apply(null, vs), threshold) * 1.18; if (vMax <= 0) vMax = 1;
        function X(t) { return ML + (t - tMin) / (tMax - tMin) * plotW; }
        function Y(v) { return MT + plotH - v / vMax * plotH; }
        var color = 'var(' + colorVar + ')';
        [0, 0.5, 1].forEach(function (f) {
          var val = f * vMax, yy = Y(val);
          svgNode.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yy, y2: yy, class: 'chart-grid' }));
          var t = svgEl('text', { x: ML - 6, y: yy + 3, class: 'chart-tick', 'text-anchor': 'end' }); t.textContent = fmtVal(val); svgNode.appendChild(t);
        });
        if (threshold > 0 && threshold <= vMax) {
          var yt = Y(threshold);
          svgNode.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yt, y2: yt, class: 'chart-threshold' }));
          var lb = svgEl('text', { x: W - MR, y: yt - 4, class: 'chart-threshold-label', 'text-anchor': 'end' }); lb.textContent = 'seuil ' + fmtVal(threshold); svgNode.appendChild(lb);
        }
        [series[0], series[series.length - 1]].forEach(function (pt, i) {
          var t = svgEl('text', { x: i === 0 ? ML : W - MR, y: H - 6, class: 'chart-xtick', 'text-anchor': i === 0 ? 'start' : 'end' }); t.textContent = fmtDateShort(pt.date); svgNode.appendChild(t);
        });
        if (series.length === 1) {
          svgNode.appendChild(svgEl('circle', { cx: X(series[0].t), cy: Y(series[0].v), r: 6, class: 'chart-point-end', style: 'fill:' + color }));
        } else {
          var gid = 'g' + colorVar.replace(/[^a-z0-9]/gi, '') + PM.uid();
          var defs = svgEl('defs', {}), grad = svgEl('linearGradient', { id: gid, x1: '0', x2: '0', y1: '0', y2: '1' });
          grad.appendChild(svgEl('stop', { offset: '0', style: 'stop-color:' + color + ';stop-opacity:.45' }));
          grad.appendChild(svgEl('stop', { offset: '1', style: 'stop-color:' + color + ';stop-opacity:0' }));
          defs.appendChild(grad); svgNode.appendChild(defs);
          var base = MT + plotH, d = 'M' + X(series[0].t) + ',' + base;
          series.forEach(function (p) { d += ' L' + X(p.t) + ',' + Y(p.v); });
          d += ' L' + X(series[series.length - 1].t) + ',' + base + ' Z';
          svgNode.appendChild(svgEl('path', { d: d, class: 'chart-area', style: 'fill:url(#' + gid + ')' }));
          svgNode.appendChild(svgEl('polyline', { points: series.map(function (p) { return X(p.t) + ',' + Y(p.v); }).join(' '), class: 'chart-line', style: 'stroke:' + color }));
          series.forEach(function (p, i) {
            var fin = i === series.length - 1;
            svgNode.appendChild(svgEl('circle', { cx: X(p.t), cy: Y(p.v), r: fin ? 5 : 3, class: fin ? 'chart-point-end' : 'chart-point', style: fin ? 'fill:' + color : 'stroke:' + color }));
          });
        }
        var cross = svgEl('line', { y1: MT, y2: MT + plotH, class: 'chart-crosshair' });
        var dot = svgEl('circle', { r: 5, class: 'chart-hover-dot', style: 'fill:' + color });
        var hit = svgEl('rect', { x: ML, y: MT, width: plotW, height: plotH, class: 'chart-hit' });
        svgNode.appendChild(cross); svgNode.appendChild(dot); svgNode.appendChild(hit);
        function onMove(evt) {
          var rect = svgNode.getBoundingClientRect(), px = (evt.clientX - rect.left) / rect.width * W, near = series[0], best = Infinity;
          series.forEach(function (p) { var dd = Math.abs(X(p.t) - px); if (dd < best) { best = dd; near = p; } });
          var nx = X(near.t), ny = Y(near.v);
          cross.setAttribute('x1', nx); cross.setAttribute('x2', nx); cross.style.opacity = 1;
          dot.setAttribute('cx', nx); dot.setAttribute('cy', ny); dot.style.opacity = 1;
          tooltipEl.innerHTML = fmtDateTime(near.date) + '<br><b>' + fmtVal(near.v) + ' ' + UNIT + '</b>';
          tooltipEl.style.left = Math.min(Math.max(nx / W * 100, 18), 82) + '%'; tooltipEl.style.top = (ny / H * 100) + '%'; tooltipEl.style.opacity = 1;
        }
        hit.addEventListener('pointermove', onMove);
        hit.addEventListener('pointerdown', onMove);
        hit.addEventListener('pointerleave', function () { cross.style.opacity = 0; dot.style.opacity = 0; tooltipEl.style.opacity = 0; });
        return true;
      }

      /* ===== NOUVELLE ANALYSE ===== */
      function ecranAnalyse(racine) {
        var S = D.seuils;
        var date = el('input', { type: 'datetime-local', value: maintenantLocal() });
        var champs = {};
        var form = el('section', { class: 'bandeau' }, [el('h2', { class: 'nh3-h2' }, ['Nouvelle analyse NH3']), el('div', { class: 'champ' }, [el('label', {}, ['Date et heure du relevé']), date])]);
        POINTS.forEach(function (p) {
          var etat = el('span', { class: 'nh3-etat' });
          var inp = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'ppm', autocomplete: 'off' });
          inp.addEventListener('input', function () {
            var v = nb(inp.value);
            if (v === null) { etat.className = 'nh3-etat'; etat.textContent = ''; return; }
            var st = statusFor(v, S[p.key]);
            etat.className = 'nh3-etat ' + st; etat.textContent = statusLabel(st);
          });
          champs[p.key] = inp;
          form.appendChild(el('div', { class: 'champ' }, [el('label', {}, [el('i', { class: 'nh3-pastille', style: 'background:var(' + p.varColor + ')' }), p.label + ' (ppm) · seuil ' + S[p.key]]), inp, etat]));
        });
        form.appendChild(el('button', { class: 'btn-principal', onclick: function () {
          var v = {};
          for (var k in champs) { v[k] = nb(champs[k].value); if (v[k] === null || v[k] < 0) { PM.toast('Renseigne les 3 mesures'); champs[k].focus(); return; } }
          var d = new Date(date.value); if (isNaN(d)) { PM.toast('Date invalide'); return; }
          enregistrer({ type: 'nh3.releve', dateAnalyse: d.toISOString(), entree: v.entree, sortie1: v.sortie1, sortie2: v.sortie2 }, 'Analyse enregistrée', 'vue');
        } }, ['Enregistrer']));
        racine.appendChild(form);
      }

      /* ===== CHARBON ACTIF ===== */
      function pushCouche(stack, type, q) { var top = stack[stack.length - 1]; if (top && top.type === type) top.quantite += q; else stack.push({ type: type, quantite: q }); }
      function pile(cuve) {
        var stack = [];
        mouvements().filter(function (m) { return m.cuve === cuve; }).sort(byDate).forEach(function (m) {
          if (m.typeMouvement === 'Remplacement') stack = [];
          (m.couches || []).forEach(function (c) { pushCouche(stack, c.type, c.quantite); });
        });
        return stack;
      }
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

      function ecranCharbon(racine) {
        var carte = el('section', { class: 'bandeau' });
        carte.appendChild(el('div', { class: 'carte-tete' }, [el('h2', {}, ['Charbon actif — 03F321 / 03F331']),
          el('button', { class: 'btn-second', onclick: function () { formCharbonOuvert = !formCharbonOuvert; afficher(); } }, [formCharbonOuvert ? 'Fermer' : '+ Nouveau mouvement'])]));
        if (formCharbonOuvert) carte.appendChild(formulaireCharbon());
        var wrap = el('div', { html: CARBON_SVG });
        carte.appendChild(wrap);
        var capacite = D.charbon.capaciteKg > 0 ? D.charbon.capaciteKg : 4000, bodyBottom = 184, bodyH = 140, DOME_RY = 10;
        CARBON_CUVES.forEach(function (cfg) {
          var g = wrap.querySelector('.carbon-tank[data-cuve="' + cfg.key + '"]');
          var layersG = g.querySelector('[data-role="layers"]'), lvl = g.querySelector('[data-role="level-text"]'), note = g.querySelector('[data-role="bottom-note"]');
          var stack = pile(cfg.key), total = stack.reduce(function (s, l) { return s + l.quantite; }, 0), scale = total > capacite ? capacite / total : 1;
          var layers = [];
          stack.forEach(function (l) { var h = (l.quantite * scale / capacite) * bodyH; if (h > 0) layers.push({ type: l.type, h: h, color: couleurCharbon(l.type) }); });
          var n = layers.length, ys = [bodyBottom];
          layers.forEach(function (l) { ys.push(ys[ys.length - 1] - l.h); });
          var x0 = cfg.bx, x1 = cfg.bx + 170, xm = cfg.bx + 85;
          layers.forEach(function (l, i) {
            var yB = ys[i], yT = ys[i + 1];
            var ryT = Math.min(DOME_RY, l.h, i + 1 < n ? layers[i + 1].h : l.h);
            var ryB = i === 0 ? Math.min(DOME_RY, l.h) : Math.min(DOME_RY, l.h, layers[i - 1].h);
            var d = 'M' + x0 + ',' + yB + ' Q' + xm + ',' + (yB + ryB) + ' ' + x1 + ',' + yB + ' L' + x1 + ',' + yT + ' ';
            d += ryT > 0 ? ('Q' + xm + ',' + (yT + ryT) + ' ' + x0 + ',' + yT + ' Z') : ('L' + x0 + ',' + yT + ' Z');
            layersG.appendChild(svgEl('path', { d: d, fill: l.color }));
            if (l.h >= 12) { var t = svgEl('text', { x: xm, y: (yB + yT) / 2 + 4, class: 'carbon-layer-label' }); t.textContent = l.type; layersG.appendChild(t); }
          });
          if (n && layers[0].h > 0 && layers[0].h < 12) { note.textContent = 'Fond : ' + layers[0].type; note.style.fill = layers[0].color; }
          lvl.textContent = total > 0 ? fmtKg(total) + ' / ' + fmtKg(capacite) + ' kg' + (total > capacite ? ' (max atteint)' : '') : 'Vide';
        });
        carte.appendChild(el('div', { class: 'schema-legend' }, D.charbon.types.map(function (t) {
          return el('span', { class: 'legend-item' }, [el('span', { class: 'legend-swatch', style: 'background:' + t.couleur }), t.nom]);
        })));
        racine.appendChild(carte);

        // Historique charbon (avec durée de fonctionnement de chaque mélange)
        var rows = mouvements().slice().sort(byDate).reverse(), du = durees();
        var tbody = el('tbody');
        rows.forEach(function (m) {
          var total = (m.couches || []).reduce(function (s, c) { return s + c.quantite; }, 0);
          var dd = du[m.id];
          tbody.appendChild(el('tr', { class: m.enAttente ? 'attente' : '' }, [
            el('td', { class: 'date-cell' }, [fmtDateTime(m.date) + (m.enAttente ? ' ⏳' : '')]),
            el('td', {}, [m.cuve]), el('td', {}, [m.typeMouvement]),
            el('td', { html: (m.couches || []).map(function (c) { return c.type + ' — ' + fmtKg(c.quantite) + ' kg'; }).join('<br>') }),
            el('td', { class: 'val-cell' }, [fmtKg(total) + ' kg']),
            el('td', { class: 'val-cell' }, [(m.heuresCompteur !== null && m.heuresCompteur !== undefined) ? fmtKg(m.heuresCompteur) + ' h' : '—']),
            el('td', { class: 'val-cell' }, [dd && dd.ongoing ? 'En cours' : dd && typeof dd.h === 'number' ? fmtKg(dd.h) + ' h' : '—'])
          ]));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Historique charbon actif']), el('span', { class: 'petit' }, [rows.length + (rows.length > 1 ? ' mouvements' : ' mouvement')])]),
          el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table nh3-table-large' }, [
            el('thead', {}, [el('tr', {}, ['Date', 'Cuve', 'Mouvement', 'Charbon', 'Quantité', 'Heures compteur', 'Durée de fonctionnement'].map(function (h) { return el('th', {}, [h]); }))]), tbody])])
        ]));
      }

      function formulaireCharbon() {
        var date = el('input', { type: 'datetime-local', value: maintenantLocal() });
        var cuve = el('select', {}, ['03F321', '03F331'].map(function (c) { return el('option', { value: c }, [c]); }));
        var mvt = el('select', {}, [el('option', { value: 'Remplacement' }, ['Remplacement (vidange + remplissage)']), el('option', { value: 'Ajout' }, ['Ajout (par-dessus, sans vidange)'])]);
        var heures = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'heures' });
        var agent = PM.Prefs.get('agent', '');
        var oper = el('select', {}, [el('option', { value: '' }, ['— Choisir —'])].concat(OPERATEURS.map(function (o) { return el('option', { value: o, selected: o === agent ? 'selected' : null }, [o]); })));
        var blocHeures = el('div', { class: 'champ' }, [el('label', {}, ['Heures de fonctionnement de l’épurateur (h)']), heures]);
        var blocOper = el('div', { class: 'champ' }, [el('label', {}, ['Opérateur (tracé dans le tableau des interventions)']), oper]);
        function majVisibilite() { var r = mvt.value === 'Remplacement'; blocHeures.hidden = !r; blocOper.hidden = !r; }
        mvt.addEventListener('change', majVisibilite);
        var couches = el('div', { class: 'nh3-couches' });
        function renum() {
          var rs = couches.querySelectorAll('.carbon-layer-row');
          rs.forEach(function (r, i) { r.querySelector('.carbon-layer-index').textContent = i + 1; r.querySelector('.carbon-layer-remove').disabled = rs.length <= 1; });
        }
        function ajouterCouche(type, q) {
          var row = el('div', { class: 'carbon-layer-row' });
          var sel = el('select', {}, D.charbon.types.map(function (t) { return el('option', { value: t.nom, selected: t.nom === type ? 'selected' : null }, [t.nom]); }));
          var qty = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Quantité (kg)', value: q !== undefined ? String(q) : '' });
          var suppr = el('button', { type: 'button', class: 'carbon-layer-remove', 'aria-label': 'Retirer cette couche', onclick: function () { row.remove(); renum(); } }, ['✕']);
          row.appendChild(el('span', { class: 'carbon-layer-index' })); row.appendChild(sel); row.appendChild(qty); row.appendChild(suppr);
          couches.appendChild(row); renum();
        }
        // Pré-remplissage avec la composition du dernier remplacement
        var dernier = mouvements().filter(function (m) { return m.typeMouvement === 'Remplacement'; }).sort(byDate).pop();
        if (dernier) dernier.couches.forEach(function (c) { ajouterCouche(c.type, c.quantite); }); else ajouterCouche();
        majVisibilite();
        return el('div', { class: 'nh3-form-charbon' }, [
          el('div', { class: 'champ' }, [el('label', {}, ['Date et heure']), date]),
          el('div', { class: 'nh3-2col' }, [el('div', { class: 'champ' }, [el('label', {}, ['Cuve']), cuve]), el('div', { class: 'champ' }, [el('label', {}, ['Type de mouvement']), mvt])]),
          blocHeures, blocOper,
          el('p', { class: 'petit' }, ['Une couche par type de charbon : la première ligne est celle du fond de la cuve.']),
          couches,
          el('button', { type: 'button', class: 'btn-second', onclick: function () { ajouterCouche(); } }, ['+ Ajouter une couche']),
          el('button', { class: 'btn-principal', style: 'margin-top:12px', onclick: function () {
            var d = new Date(date.value); if (isNaN(d)) { PM.toast('Date invalide'); return; }
            var cs = [], ok = true;
            couches.querySelectorAll('.carbon-layer-row').forEach(function (r) {
              var q = nb(r.querySelector('input').value);
              if (q === null || q < 0) ok = false; else cs.push({ type: r.querySelector('select').value, quantite: q });
            });
            if (!ok || !cs.length) { PM.toast('Indique la quantité de chaque couche'); return; }
            var h = null;
            if (mvt.value === 'Remplacement') {
              h = nb(heures.value); if (h === null || h < 0) { PM.toast('Indique les heures compteur'); heures.focus(); return; }
              if (!oper.value) { PM.toast('Choisis l’opérateur'); return; }
            }
            formCharbonOuvert = false;
            enregistrer({ type: 'nh3.mouvement', date: d.toISOString(), cuve: cuve.value, typeMouvement: mvt.value, heuresCompteur: h,
              operateur: mvt.value === 'Remplacement' ? oper.value : null, couches: cs }, 'Mouvement de charbon enregistré', 'charbon');
          } }, ['Enregistrer'])
        ]);
      }

      /* Enregistrement : affiché tout de suite, envoyé dès que possible */
      function enregistrer(payload, message, ongletApres) {
        payload.id = PM.uid();
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, JSON.parse(JSON.stringify(payload)));
        PM.toast(message + (modeDemo ? ' (démo, non envoyé)' : (navigator.onLine ? '' : ' · envoi au retour du réseau')));
        onglet = ongletApres;
        afficher();
        window.scrollTo(0, 0);
      }
    }
  };
})();
