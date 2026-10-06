/* =====================================================================
   MODULE « ANALYSES DIGESTAT » — version rapide, une par site
   Reprend le tableau de bord de l'appli d'origine (Suivi Analyses Biogaz) :
   filtre par point de mesure, une carte par cuve (dernières valeurs connues),
   4 courbes (Ratio AOV/TAC, AOV, TAC, MS %), tableau des 30 derniers rapports
   avec lien vers le PDF. Le serveur du site ne renvoie QUE les analyses de ce site.
   Consultation seule : le scan des mails, l'import de PDF et la suppression
   restent dans l'appli d'origine.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var NS = 'http://www.w3.org/2000/svg';
  var CHAMPS = [['PH', 'pH', ''], ['AOV', 'AOV', ''], ['TAC', 'TAC', ''], ['Ratio_AOV_TAC', 'Ratio AOV/TAC', ''], ['MS_pct', 'MS', '%']];
  var COURBES = [['Ratio_AOV_TAC', 'Ratio AOV/TAC'], ['AOV', 'AOV'], ['TAC', 'TAC'], ['MS_pct', 'Matière sèche (%)']];
  // couleur fixe par cuve (palette validée du portail), gris pour un point inhabituel
  var COULEUR_POINT = { 'Digesteur': '--s1', 'Digesteur 2': '--s2', 'Post-Digesteur': '--s3' };

  function demo(siteId) {
    var site = siteId === 'arraincourt' ? 'Arraincourt' : 'Rotte', l = [];
    [['2026-07-08', 0.18, 0.18, 0.17], ['2026-07-27', 0.26, 0.24, 0.17], ['2026-08-20', 0.22, 0.21, 0.19], ['2026-09-15', 0.24, 0.23, 0.18]].forEach(function (r, k) {
      ['Digesteur', 'Digesteur 2', 'Post-Digesteur'].forEach(function (p, i) {
        var tac = 14 + i + k * 0.4, ratio = r[i + 1];
        l.push({ ID_PDF: 'demo' + k, Site: site, Point_Mesure: p, Date_Analyse: r[0], PH: 7.6 + i * 0.1, AOV: Math.round(ratio * tac * 100) / 100, TAC: Math.round(tac * 100) / 100,
          Ratio_AOV_TAC: ratio, MS_pct: k === 2 ? 10 + i * 0.4 : '', Commentaire_IA: 'La valeur AOV/TAC est correcte pour l’analyse actuelle.', Lien_PDF: '' });
      });
    });
    return { lignes: l };
  }

  function vide(v) { return v === '' || v === null || v === undefined; }
  function fmt(v) { return typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(v); }
  function fmtDate(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('fr-FR'); }
  function dateLigne(l) { return l.Date_Analyse || l.Date_Traitement || ''; }
  function nomPoint(l) { return l.Point_Mesure || 'Général'; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); return e; }
  function couleur(p) { return COULEUR_POINT[p] ? 'var(' + COULEUR_POINT[p] + ')' : 'var(--texte-2)'; }

  /* Les rapports Novatech arrivent en plusieurs PDF (AOV/TAC, MS, renvois…) et chaque PDF
     répète parfois la même ligne d'analyse. On regroupe donc tout par cuve + date d'analyse :
     une seule mesure par cuve et par jour, avec toutes ses valeurs (pH, AOV, TAC, ratio, MS). */
  function consolider(lignes) {
    var parCle = {}, ordre = [];
    lignes.forEach(function (l) {
      var d = String(l.Date_Analyse || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return; // ligne sans date d'analyse : inexploitable
      var p = nomPoint(l), k = p + '::' + d;
      if (!parCle[k]) { parCle[k] = { Point_Mesure: p, Date_Analyse: d, ID_PDF: 'jour::' + d, Liens: [], _comAov: '', _com: '' }; ordre.push(k); }
      var m = parCle[k];
      CHAMPS.forEach(function (c) { if (!vide(l[c[0]])) m[c[0]] = l[c[0]]; });
      if (l.Lien_PDF && m.Liens.indexOf(l.Lien_PDF) < 0) m.Liens.push(l.Lien_PDF);
      if (l.Commentaire_IA) { if (!vide(l.AOV) || !vide(l.Ratio_AOV_TAC)) m._comAov = l.Commentaire_IA; else m._com = l.Commentaire_IA; }
    });
    var res = ordre.map(function (k) {
      var m = parCle[k];
      m.Commentaire_IA = m._comAov || m._com; // l'avis sur l'AOV/TAC est plus utile que la mention MS
      m.Lien_PDF = m.Liens[0] || '';
      return m;
    });
    res.sort(function (a, b) { return a.Date_Analyse < b.Date_Analyse ? -1 : a.Date_Analyse > b.Date_Analyse ? 1 : 0; });
    return res;
  }
  // Une cuve qui n'a plus d'analyse depuis 4 mois de plus que la plus récente du site
  // (ex. Stockage, ou Préfosse qui n'est plus prélevée) est masquée par défaut.
  var JOURS_INACTIF = 120;
  var ORDRE_POINTS = ['Digesteur', 'Digesteur 2', 'Post-Digesteur', 'Préfosse', 'Stockage'];
  function parOrdre(a, b) {
    var ia = ORDRE_POINTS.indexOf(a), ib = ORDRE_POINTS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }
  function pointsActifs(lignes) {
    var der = {}, max = '';
    lignes.forEach(function (l) { var p = nomPoint(l); if (!der[p] || l.Date_Analyse > der[p]) der[p] = l.Date_Analyse; if (l.Date_Analyse > max) max = l.Date_Analyse; });
    var actifs = [], anciens = [];
    Object.keys(der).forEach(function (p) {
      var ecart = (new Date(max) - new Date(der[p])) / 86400000;
      (ecart > JOURS_INACTIF ? anciens : actifs).push({ point: p, derniere: der[p] });
    });
    var ordre = ['Digesteur', 'Digesteur 2', 'Post-Digesteur'];
    function rang(x) { var i = ordre.indexOf(x.point); return i < 0 ? 99 : i; }
    actifs.sort(function (a, b) { return rang(a) - rang(b); });
    return { actifs: actifs.map(function (x) { return x.point; }), anciens: anciens };
  }

  window.MODULES.analyses = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE = 'analyses_donnees_' + ctx.site.id;
      var D = null, filtre = 'Tous', majLe = null, voirAnciens = false;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      PM.DB.get(CLE).then(function (c) {
        D = c || (modeDemo ? demo(ctx.site.id) : null);
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier, bouton) {
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Actualisation…'; }
        return PM.Api.appeler(ctx.apiUrl, { action: 'analyses.donnees', cle: ctx.cle }, 30000).then(function (j) {
          D = { lignes: j.lignes || [], majLe: new Date().toISOString() };
          PM.DB.set(CLE, D);
          afficher();
        })['catch'](function (e) {
          if (bouton) { bouton.disabled = false; bouton.textContent = 'Actualiser'; }
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger les analyses.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : analyses du dernier chargement', 4000);
        });
      }

      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'nh3 analyses' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Données fictives. Renseigne le serveur du site dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var consolidees = consolider(D.lignes || []);
        var pa = pointsActifs(consolidees);
        var points = voirAnciens ? pa.actifs.concat(pa.anciens.map(function (x) { return x.point; })) : pa.actifs;
        var toutes = consolidees.filter(function (l) { return points.indexOf(nomPoint(l)) >= 0; });
        if (filtre !== 'Tous' && points.indexOf(filtre) < 0) filtre = 'Tous';
        var sel = el('select', { 'aria-label': 'Point de mesure' }, [el('option', { value: 'Tous' }, ['Tous les points'])].concat(points.map(function (p) {
          return el('option', { value: p, selected: filtre === p ? 'selected' : null }, [p]);
        })));
        sel.addEventListener('change', function () { filtre = sel.value; afficher(); });
        var btn = el('button', { class: 'btn-second', type: 'button' }, ['Actualiser']);
        btn.addEventListener('click', function () { if (modeDemo) PM.toast('Mode démonstration'); else rafraichir(false, btn); });
        racine.appendChild(el('div', { class: 'an-filtres' }, [sel, btn]));
        if (pa.anciens.length) {
          var chk = el('input', { type: 'checkbox', checked: voirAnciens ? 'checked' : null });
          chk.addEventListener('change', function () { voirAnciens = chk.checked; afficher(); });
          racine.appendChild(el('label', { class: 'petit an-anciens' }, [chk, ' Afficher aussi les points sans analyse récente : ' +
            pa.anciens.map(function (x) { return x.point + ' (dernière le ' + fmtDate(x.derniere) + ')'; }).join(', ')]));
        }
        racine.appendChild(el('p', { class: 'petit an-etat' }, [toutes.length + ' analyse(s) par cuve et par date' + (D.majLe ? ' · mis à jour le ' + new Date(D.majLe).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')]));

        var donnees = toutes.filter(function (l) { return filtre === 'Tous' || nomPoint(l) === filtre; });
        if (!donnees.length) {
          racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucun résultat pour l’instant pour ce site.']));
          return;
        }
        cartes(racine, donnees);
        racine.appendChild(el('h2', { class: 'an-titre' }, ['Courbes de progression — digestat']));
        var grille = el('div', { class: 'an-courbes' });
        COURBES.forEach(function (c) { grille.appendChild(carteCourbe(donnees, c[0], c[1])); });
        racine.appendChild(grille);
        tableau(racine, donnees);
        racine.appendChild(el('p', { class: 'petit an-pied' }, ['Import d’un ancien PDF et suppression d’un rapport : dans l’appli d’origine « Suivi Analyses Biogaz ».']));
        window.scrollTo(0, y);
      }

      /* ----- une carte par cuve : dernière valeur connue champ par champ (comme l'original) ----- */
      function cartes(racine, donnees) {
        var parPoint = {}, ordre = [];
        donnees.forEach(function (l) {
          var p = nomPoint(l);
          if (!parPoint[p]) { parPoint[p] = { valeurs: {}, derniereDate: '' }; ordre.push(p); }
          var d = dateLigne(l);
          CHAMPS.forEach(function (c) { if (!vide(l[c[0]])) parPoint[p].valeurs[c[0]] = { valeur: l[c[0]], date: d }; });
          if (d) parPoint[p].derniereDate = d;
        });
        ordre.sort(parOrdre);
        var zone = el('div', { class: 'an-cartes' });
        ordre.forEach(function (p, i) {
          var e = parPoint[p], stats = [];
          CHAMPS.forEach(function (c) {
            var v = e.valeurs[c[0]]; if (!v) return;
            stats.push(el('div', { class: 'an-stat' }, [
              el('span', { class: 'an-stat-label' }, [c[1]]),
              el('span', { class: 'an-stat-val' }, [fmt(v.valeur) + c[2]]),
              v.date && v.date !== e.derniereDate ? el('span', { class: 'an-stat-ancien' }, [fmtDate(v.date)]) : null
            ]));
          });
          if (!stats.length) stats.push(el('div', { class: 'petit' }, ['Aucune valeur enregistrée']));
          zone.appendChild(el('section', { class: 'bandeau an-carte', style: '--i:' + i + ';--pt:' + couleur(p) }, [
            el('div', { class: 'an-carte-titre' }, [el('span', { class: 'an-pastille' }), p]),
            el('div', { class: 'an-grille' }, stats),
            el('div', { class: 'an-carte-date' }, ['Dernier rapport : ' + fmtDate(e.derniereDate)])
          ]));
        });
        racine.appendChild(zone);
      }

      /* ----- courbe : une ligne par cuve, axe des dates ----- */
      function carteCourbe(donnees, champ, titre) {
        var series = {}, ordre = [];
        donnees.forEach(function (l) {
          if (vide(l[champ])) return;
          var t = new Date(dateLigne(l)).getTime(); if (isNaN(t)) return;
          var p = nomPoint(l);
          if (!series[p]) { series[p] = []; ordre.push(p); }
          series[p].push({ t: t, v: Number(l[champ]), date: dateLigne(l), p: p });
        });
        var bloc = el('section', { class: 'bandeau trend-card' }, [el('h3', { class: 'an-courbe-titre' }, [titre])]);
        var cw = el('div', { class: 'trend-chart-wrap' });
        var svg = svgEl('svg', { role: 'img', 'aria-label': 'Courbe ' + titre });
        var tip = el('div', { class: 'chart-tooltip' });
        cw.appendChild(svg); cw.appendChild(tip); bloc.appendChild(cw);
        var tous = [];
        ordre.sort(parOrdre);
        ordre.forEach(function (p) { series[p].sort(function (a, b) { return a.t - b.t; }); tous = tous.concat(series[p]); });
        if (!tous.length) { svg.style.display = 'none'; cw.appendChild(el('div', { class: 'chart-empty' }, ['Pas encore de valeur pour ce paramètre.'])); return bloc; }

        var W = 480, H = 200, ML = 38, MR = 10, MT = 12, MB = 22, pw = W - ML - MR, ph = H - MT - MB;
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        var ts = tous.map(function (p) { return p.t; }), vs = tous.map(function (p) { return p.v; });
        var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
        if (tMin === tMax) { tMin -= 86400000 * 7; tMax += 86400000 * 7; }
        var vMin = Math.min.apply(null, vs), vMax = Math.max.apply(null, vs), marge = (vMax - vMin) * 0.15 || Math.abs(vMax) * 0.1 || 1;
        vMin -= marge; vMax += marge;
        function X(t) { return ML + (t - tMin) / (tMax - tMin) * pw; }
        function Y(v) { return MT + ph - (v - vMin) / (vMax - vMin) * ph; }
        [vMin, (vMin + vMax) / 2, vMax].forEach(function (val) {
          var yy = Y(val);
          svg.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yy, y2: yy, class: 'chart-grid' }));
          var t = svgEl('text', { x: ML - 6, y: yy + 3, class: 'chart-tick', 'text-anchor': 'end' }); t.textContent = fmt(Math.round(val * 100) / 100); svg.appendChild(t);
        });
        [[tMin, 'start', ML], [tMax, 'end', W - MR]].forEach(function (a) {
          var t = svgEl('text', { x: a[2], y: H - 6, class: 'chart-xtick', 'text-anchor': a[1] }); t.textContent = fmtDate(new Date(a[0])); svg.appendChild(t);
        });
        ordre.forEach(function (p) {
          var s = series[p], c = couleur(p);
          if (s.length > 1) svg.appendChild(svgEl('polyline', { points: s.map(function (q) { return X(q.t) + ',' + Y(q.v); }).join(' '), class: 'chart-line', style: 'stroke:' + c }));
          s.forEach(function (q, i) { svg.appendChild(svgEl('circle', { cx: X(q.t), cy: Y(q.v), r: i === s.length - 1 ? 4.5 : 3, class: 'an-point', style: 'fill:' + c })); });
        });
        var cross = svgEl('line', { y1: MT, y2: MT + ph, class: 'chart-crosshair' });
        var hit = svgEl('rect', { x: ML, y: MT, width: pw, height: ph, class: 'chart-hit' });
        svg.appendChild(cross); svg.appendChild(hit);
        function survol(evt) {
          var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W, proche = tous[0], best = Infinity;
          tous.forEach(function (q) { var d = Math.abs(X(q.t) - px); if (d < best) { best = d; proche = q; } });
          var memeDate = tous.filter(function (q) { return q.date === proche.date; });
          cross.setAttribute('x1', X(proche.t)); cross.setAttribute('x2', X(proche.t)); cross.style.opacity = 1;
          tip.innerHTML = fmtDate(proche.date) + memeDate.map(function (q) { return '<br>' + q.p + ' : <b>' + fmt(q.v) + '</b>'; }).join('');
          tip.style.left = Math.min(Math.max(X(proche.t) / W * 100, 22), 78) + '%'; tip.style.top = '30%'; tip.style.opacity = 1;
        }
        hit.addEventListener('pointermove', survol); hit.addEventListener('pointerdown', survol);
        hit.addEventListener('pointerleave', function () { cross.style.opacity = 0; tip.style.opacity = 0; });
        bloc.appendChild(el('div', { class: 'an-legende' }, ordre.map(function (p) {
          return el('span', {}, [el('i', { style: 'background:' + couleur(p) }), p]);
        })));
        return bloc;
      }

      /* ----- tableau : un rapport par ligne, une colonne par cuve (30 plus récents) ----- */
      function resume(l) {
        var parts = [];
        if (!vide(l.PH)) parts.push('pH ' + fmt(l.PH));
        if (!vide(l.AOV)) parts.push('AOV ' + fmt(l.AOV));
        if (!vide(l.TAC)) parts.push('TAC ' + fmt(l.TAC));
        if (!vide(l.Ratio_AOV_TAC)) parts.push('Ratio ' + fmt(l.Ratio_AOV_TAC));
        if (!vide(l.MS_pct)) parts.push('MS ' + fmt(l.MS_pct) + '%');
        return parts.length ? parts.join(' · ') : '—';
      }
      function tableau(racine, donnees) {
        var groupes = {}, ordre = [];
        donnees.forEach(function (l) {
          var k = l.ID_PDF || (l.Site + '::' + dateLigne(l));
          if (!groupes[k]) { groupes[k] = []; ordre.push(k); }
          groupes[k].push(l);
        });
        var recents = ordre.slice().reverse().slice(0, 30), cols = [];
        recents.forEach(function (k) { groupes[k].forEach(function (l) { var p = nomPoint(l); if (cols.indexOf(p) < 0) cols.push(p); }); });
        cols.sort(parOrdre);
        var tbody = el('tbody');
        recents.forEach(function (k) {
          var g = groupes[k], premiere = g[0], parP = {};
          g.forEach(function (l) { parP[nomPoint(l)] = l; });
          var com = g.map(function (l) { return l._comAov; }).filter(Boolean)[0] || g.map(function (l) { return l.Commentaire_IA; }).filter(Boolean)[0] || '';
          var liens = [];
          g.forEach(function (l) { (l.Liens || (l.Lien_PDF ? [l.Lien_PDF] : [])).forEach(function (u) { if (liens.indexOf(u) < 0) liens.push(u); }); });
          tbody.appendChild(el('tr', {}, [el('td', { class: 'date-cell' }, [fmtDate(dateLigne(premiere))])]
            .concat(cols.map(function (p) { return el('td', { class: 'val-cell' }, [parP[p] ? resume(parP[p]) : '—']); }))
            .concat([el('td', { class: 'an-com' }, [com ? el('div', { class: 'an-com-txt', title: 'Toucher pour tout lire', onclick: function () { this.classList.toggle('ouvert'); } }, [com]) : '']),
              el('td', { class: 'an-liens' }, liens.slice(0, 3).map(function (u, i) {
                return el('a', { class: 'an-pdf', href: u, target: '_blank', rel: 'noopener' }, [liens.length > 1 ? 'PDF ' + (i + 1) : 'Voir le PDF']);
              }))])));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Derniers résultats']), el('span', { class: 'petit' }, [recents.length + ' date(s) d’analyse'])]),
          el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table nh3-table-large' }, [
            el('thead', {}, [el('tr', {}, ['Date analyse'].concat(cols).concat(['Commentaire', '']).map(function (h) { return el('th', {}, [h]); }))]), tbody])])
        ]));
      }
    }
  };
})();
