/* =====================================================================
   MODULE « ANALYSES DIGESTAT » — version rapide, une par site
   03/11/2026 : tous les paramètres des rapports (acides gras, oligo-éléments,
   matière, azote), rangés en 4 onglets pour que l'écran reste lisible :
     Essentiel · Acides gras · Oligo-éléments · Matière
   Dans chaque onglet :
     1. un tableau « dernière valeur » : une ligne par paramètre, une colonne par
        cuve, pastille vert / orange / rouge (repère indicatif) et flèche
        d'évolution depuis l'analyse précédente ;
     2. la courbe du paramètre choisi (toucher une ligne du tableau) ;
     3. l'historique de ce paramètre, avec commentaire et lien vers le PDF.
   Le serveur du site ne renvoie QUE les analyses de ce site.
   Consultation seule : le scan des mails, l'import de PDF et la suppression
   restent dans l'appli d'origine.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var NS = 'http://www.w3.org/2000/svg';

  /* ----- Catalogue des paramètres -----
     u : unité ; rep : repère indicatif { ok: [min, max], att: [min, max] } -> vert dans ok,
     orange dans att, rouge au-delà. Pas de rep = pas de pastille (pas de valeur cible fixée).
     Les repères se modifient ICI (à caler avec le labo / Novatech). */
  var PARAMS = {
    Ratio_AOV_TAC: { l: 'Ratio AOV/TAC', u: '', rep: { ok: [0.15, 0.40], att: [0.10, 0.50] } },
    PH: { l: 'pH', u: '', rep: { ok: [7.2, 8.2], att: [7.0, 8.5] } },
    AOV: { l: 'AOV (FOS)', u: 'g/kg' },
    TAC: { l: 'TAC', u: 'g/kg' },
    NH4N_gl: { l: 'Azote ammoniacal NH4-N', u: 'g/l', rep: { ok: [0, 3], att: [0, 4] } },
    MS_pct: { l: 'Matière sèche (MS)', u: '%' },
    MSO_pct: { l: 'Matière sèche organique', u: '% brut' },
    Perte_Feu_pct: { l: 'Perte au feu (part organique)', u: '% MS' },
    Acide_Acetique: { l: 'Acide acétique', u: 'mg/kg', rep: { ok: [0, 1500], att: [0, 3000] } },
    Acide_Propionique: { l: 'Acide propionique', u: 'mg/kg', rep: { ok: [0, 500], att: [0, 1000] } },
    Acide_Isobutyrique: { l: 'Acide isobutyrique', u: 'mg/kg', rep: { ok: [0, 100], att: [0, 300] } },
    Acide_nButyrique: { l: 'Acide n-butyrique', u: 'mg/kg', rep: { ok: [0, 100], att: [0, 300] } },
    Acide_Isovalerique: { l: 'Acide isovalérique', u: 'mg/kg', rep: { ok: [0, 100], att: [0, 300] } },
    Acide_nValerique: { l: 'Acide n-valérique', u: 'mg/kg', rep: { ok: [0, 100], att: [0, 300] } },
    Acide_nCaproique: { l: 'Acide n-caproïque', u: 'mg/kg', rep: { ok: [0, 100], att: [0, 300] } },
    Equiv_Acetique: { l: 'Équivalent acide acétique', u: 'mg/kg' },
    Fer: { l: 'Fer', u: 'mg/kg' },
    Soufre: { l: 'Soufre', u: 'mg/kg' },
    Ratio_Fe_S: { l: 'Rapport fer / soufre', u: 'atomes', calc: true, rep: { ok: [1, 1e9], att: [0.7, 1e9] },
      aide: 'Calculé : 1 atome de fer suffit en théorie à bloquer 1 atome de soufre.' },
    Cobalt: { l: 'Cobalt', u: 'mg/kg' },
    Nickel: { l: 'Nickel', u: 'mg/kg' },
    Molybdene: { l: 'Molybdène', u: 'mg/kg' },
    Selenium: { l: 'Sélénium', u: 'mg/kg' },
    Manganese: { l: 'Manganèse', u: 'mg/kg' },
    Cuivre: { l: 'Cuivre', u: 'mg/kg' },
    Zinc: { l: 'Zinc', u: 'mg/kg' },
    Sodium: { l: 'Sodium', u: 'mg/kg' }
  };
  var THEMES = [
    { id: 'essentiel', nom: 'Essentiel', params: ['Ratio_AOV_TAC', 'PH', 'AOV', 'TAC', 'Acide_Propionique', 'NH4N_gl', 'MS_pct'] },
    { id: 'acides', nom: 'Acides gras', params: ['Acide_Acetique', 'Acide_Propionique', 'Acide_Isobutyrique', 'Acide_nButyrique',
      'Acide_Isovalerique', 'Acide_nValerique', 'Acide_nCaproique', 'Equiv_Acetique'] },
    { id: 'oligos', nom: 'Oligo-éléments', params: ['Fer', 'Soufre', 'Ratio_Fe_S', 'Cobalt', 'Nickel', 'Molybdene', 'Selenium',
      'Manganese', 'Cuivre', 'Zinc', 'Sodium'] },
    { id: 'matiere', nom: 'Matière', params: ['MS_pct', 'MSO_pct', 'Perte_Feu_pct', 'NH4N_gl'] }
  ];
  var CLES = Object.keys(PARAMS).filter(function (k) { return !PARAMS[k].calc; });
  // couleur fixe par cuve (palette validée du portail), gris pour un point inhabituel
  var COULEUR_POINT = { 'Digesteur': '--s1', 'Digesteur 2': '--s2', 'Post-Digesteur': '--s3' };
  var ORDRE_POINTS = ['Digesteur', 'Digesteur 2', 'Post-Digesteur', 'Préfosse', 'Stockage'];
  var NOM_COURT = { 'Digesteur': 'Dig. 1', 'Digesteur 2': 'Dig. 2', 'Post-Digesteur': 'Post-D.' }; // en-têtes sur téléphone
  var JOURS_ANCIEN = 45; // une valeur plus vieille que ça par rapport à la dernière analyse de la cuve affiche sa date
  var JOURS_INACTIF = 120; // cuve sans analyse depuis 4 mois de plus que la plus récente : masquée par défaut

  function demo(siteId) {
    var site = siteId === 'arraincourt' ? 'Arraincourt' : 'Rotte', l = [];
    [['2026-04-14', 0.18, 0.18, 0.17], ['2026-07-27', 0.26, 0.24, 0.17], ['2026-08-20', 0.22, 0.21, 0.19], ['2026-10-16', 0.31, 0.33, 0.25]].forEach(function (r, k) {
      ['Digesteur', 'Digesteur 2', 'Post-Digesteur'].forEach(function (p, i) {
        var tac = 13 + i + k * 0.4, ratio = r[i + 1], complet = k === 0 || k === 3;
        l.push({ ID_PDF: 'demo' + k, Site: site, Point_Mesure: p, Date_Analyse: r[0], PH: 7.6 + i * 0.1, AOV: Math.round(ratio * tac * 100) / 100, TAC: Math.round(tac * 100) / 100,
          Ratio_AOV_TAC: ratio, MS_pct: 10 + i * 0.4, Commentaire_IA: 'La valeur AOV/TAC est correcte pour l’analyse actuelle.', Lien_PDF: '',
          NH4N_gl: complet ? 1.4 + i * 0.1 : '', Acide_Acetique: complet ? 900 + k * 150 - i * 300 : '', Acide_Propionique: complet ? 60 - i * 20 : '',
          Acide_Isobutyrique: complet ? (i === 2 ? '<25' : 30) : '', Acide_nButyrique: complet ? '<25' : '', Fer: complet ? (k ? 4000 : 700) - i * 100 : '',
          Soufre: complet ? 470 + k * 10 : '', Cobalt: complet ? 0.15 : '', Nickel: complet ? 0.5 : '', Molybdene: complet ? 0.3 : '', Selenium: complet ? 0.04 : '',
          MSO_pct: complet ? 8 - i * 0.3 : '', Perte_Feu_pct: complet ? 76 - i : '' });
      });
    });
    return { lignes: l };
  }

  /* ----- Petits outils ----- */
  function vide(v) { return v === '' || v === null || v === undefined; }
  // « <25 » = sous la limite de détection du labo : affiché, compté comme 25 au plus, pas tracé
  function sousLimite(v) { return typeof v === 'string' && /^</.test(v); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (vide(v)) return null;
    var n = Number(String(v).replace(/^</, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function fmtN(v) {
    var a = Math.abs(v), d = a < 1 ? 3 : a < 10 ? 2 : a < 100 ? 1 : 0;
    return v.toLocaleString('fr-FR', { maximumFractionDigits: d });
  }
  function fmt(v) { if (sousLimite(v)) return '< ' + fmtN(num(v)); var n = num(v); return n === null ? String(v) : fmtN(n); }
  function fmtDate(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('fr-FR'); }
  function fmtDateCourte(v) { var d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  function nomPoint(l) { return l.Point_Mesure || 'Général'; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); return e; }
  // Lien PDF : seulement http(s) (jamais « javascript: » venu d'une cellule du Sheet)
  function lienSur(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null; }
  // Date d'analyse : « 2026-09-15… » gardée ; « 15/09/2026 » (ou 15.09.2026, 15-09-2026) convertie ; sinon ''
  function dateIso(v) {
    var t = String(v || '').trim(), m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(t);
    if (m) t = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    t = t.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) && !isNaN(new Date(t)) ? t : '';
  }
  function couleur(p) { return COULEUR_POINT[p] ? 'var(' + COULEUR_POINT[p] + ')' : 'var(--texte-2)'; }
  function parOrdre(a, b) {
    var ia = ORDRE_POINTS.indexOf(a), ib = ORDRE_POINTS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }
  /** 'ok' | 'att' | 'alerte' | '' (pas de repère) */
  function etat(cle, v) {
    var r = PARAMS[cle] && PARAMS[cle].rep, n = num(v);
    if (!r || n === null) return '';
    function dans(z) { return n >= z[0] && n <= z[1]; }
    if (sousLimite(v)) return n <= r.ok[1] ? 'ok' : n <= r.att[1] ? 'att' : '';
    return dans(r.ok) ? 'ok' : dans(r.att) ? 'att' : 'alerte';
  }
  var MOT_ETAT = { ok: 'dans le repère', att: 'à surveiller', alerte: 'hors repère' };
  function uniteTexte(cle) { var u = PARAMS[cle].u; return u && u !== 'atomes' ? ' ' + u : ''; }

  /* Les rapports arrivent en plusieurs PDF (AOV/TAC, MS, AGV + oligos…) et répètent parfois la même ligne.
     On regroupe donc tout par cuve + date d'analyse : une seule mesure par cuve et par jour. */
  var illisibles = 0; // lignes écartées au dernier regroupement (date d'analyse vide ou illisible)
  function consolider(lignes) {
    var parCle = {}, ordre = [];
    illisibles = 0;
    lignes.forEach(function (l) {
      var d = dateIso(l.Date_Analyse);
      if (!d) { illisibles++; return; }
      var p = nomPoint(l), k = p + '::' + d;
      if (!parCle[k]) { parCle[k] = { Point_Mesure: p, Date_Analyse: d, Liens: [], _comAov: '', _com: '' }; ordre.push(k); }
      var m = parCle[k];
      CLES.forEach(function (c) { if (!vide(l[c])) m[c] = l[c]; });
      if (l.Lien_PDF && m.Liens.indexOf(l.Lien_PDF) < 0) m.Liens.push(l.Lien_PDF);
      if (l.Commentaire_IA) { if (!vide(l.AOV) || !vide(l.Ratio_AOV_TAC)) m._comAov = l.Commentaire_IA; else m._com = l.Commentaire_IA; }
    });
    var res = ordre.map(function (k) {
      var m = parCle[k], fe = num(m.Fer), s = num(m.Soufre);
      m.Commentaire_IA = m._comAov || m._com; // l'avis sur l'AOV/TAC est plus utile que la mention MS
      if (fe !== null && s && !sousLimite(m.Fer)) m.Ratio_Fe_S = Math.round((fe / 55.845) / (s / 32.06) * 100) / 100;
      return m;
    });
    res.sort(function (a, b) { return a.Date_Analyse < b.Date_Analyse ? -1 : a.Date_Analyse > b.Date_Analyse ? 1 : 0; });
    return res;
  }
  function pointsActifs(lignes) {
    var der = {}, max = '';
    lignes.forEach(function (l) { var p = nomPoint(l); if (!der[p] || l.Date_Analyse > der[p]) der[p] = l.Date_Analyse; if (l.Date_Analyse > max) max = l.Date_Analyse; });
    var actifs = [], anciens = [];
    Object.keys(der).forEach(function (p) {
      var ecart = (new Date(max) - new Date(der[p])) / 86400000;
      (ecart > JOURS_INACTIF ? anciens : actifs).push({ point: p, derniere: der[p] });
    });
    actifs.sort(function (a, b) { return parOrdre(a.point, b.point); });
    return { actifs: actifs.map(function (x) { return x.point; }), anciens: anciens };
  }

  window.MODULES.analyses = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE = 'analyses_donnees_' + ctx.site.id;
      var D = null, filtre = 'Tous', voirAnciens = false, toutHisto = false;
      var theme = PM.Prefs.get('an_theme', 'essentiel');
      if (!THEMES.some(function (t) { return t.id === theme; })) theme = 'essentiel';
      var choix = PM.Prefs.get('an_param', {}) || {}; // paramètre choisi pour la courbe, par onglet

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
        points.sort(parOrdre);
        if (filtre !== 'Tous' && points.indexOf(filtre) < 0) filtre = 'Tous';

        // --- filtres : cuve + actualiser ---
        var sel = el('select', { 'aria-label': 'Cuve' }, [el('option', { value: 'Tous' }, ['Toutes les cuves'])].concat(points.map(function (p) {
          return el('option', { value: p, selected: filtre === p ? 'selected' : null }, [p]);
        })));
        sel.addEventListener('change', function () { filtre = sel.value; afficher(); });
        var btn = el('button', { class: 'btn-second', type: 'button' }, ['Actualiser']);
        btn.addEventListener('click', function () { if (modeDemo) PM.toast('Mode démonstration'); else rafraichir(false, btn); });
        racine.appendChild(el('div', { class: 'an-filtres' }, [sel, btn]));
        if (pa.anciens.length) {
          var chk = el('input', { type: 'checkbox', checked: voirAnciens ? 'checked' : null });
          chk.addEventListener('change', function () { voirAnciens = chk.checked; afficher(); });
          racine.appendChild(el('label', { class: 'petit an-anciens' }, [chk, ' Afficher aussi les cuves sans analyse récente : ' +
            pa.anciens.map(function (x) { return x.point + ' (dernière le ' + fmtDate(x.derniere) + ')'; }).join(', ')]));
        }
        racine.appendChild(el('p', { class: 'petit an-etat' }, [consolidees.length + ' analyse(s) par cuve et par date' + (D.majLe ? ' · mis à jour le ' + new Date(D.majLe).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')]));
        if (illisibles) racine.appendChild(el('p', { class: 'bg-erreur' }, ['⚠ ' + illisibles + (illisibles > 1 ? ' analyses avec une date illisible' : ' analyse avec une date illisible')
          + ' (voir la colonne Date_Analyse de l’onglet Resultats dans le Sheet) : elles ne sont pas affichées.']));

        var cuves = filtre === 'Tous' ? points : [filtre];
        var donnees = consolidees.filter(function (l) { return cuves.indexOf(nomPoint(l)) >= 0; });
        if (!donnees.length) {
          racine.appendChild(el('div', { class: 'vide-msg' }, ['Aucun résultat pour l’instant pour ce site.']));
          return;
        }

        // --- onglets de thèmes ---
        var tabs = el('div', { class: 'onglets an-onglets', role: 'tablist' });
        THEMES.forEach(function (t) {
          var n = t.params.filter(function (c) { return donnees.some(function (l) { return !vide(l[c]); }); }).length;
          tabs.appendChild(el('button', { role: 'tab', class: theme === t.id ? 'actif' : '', 'aria-selected': String(theme === t.id),
            onclick: function () { theme = t.id; PM.Prefs.set('an_theme', theme); afficher(); } }, [t.nom, n ? null : el('span', { class: 'an-onglet-vide' }, [' ·'])]));
        });
        racine.appendChild(tabs);

        var th = THEMES.filter(function (t) { return t.id === theme; })[0];
        var presents = th.params.filter(function (c) { return donnees.some(function (l) { return !vide(l[c]); }); });
        if (!presents.length) {
          racine.appendChild(el('div', { class: 'bandeau vide-msg' }, ['Pas encore de valeur pour « ' + th.nom + ' ».', el('br'),
            el('span', { class: 'petit' }, ['Ces paramètres arrivent avec les rapports complets (AGV + oligo-éléments).'])]));
          pied(racine);
          window.scrollTo(0, y);
          return;
        }
        var param = choix[theme];
        if (presents.indexOf(param) < 0) param = presents[0];

        // une cuve sans aucune valeur dans cet onglet (ex. Post-Digesteur sans oligo-éléments) n'a pas de colonne
        var cuvesTh = cuves.filter(function (p) { return donnees.some(function (l) { return nomPoint(l) === p && presents.some(function (c) { return !vide(l[c]); }); }); });
        matrice(racine, donnees, cuvesTh, presents, param, th);
        racine.appendChild(el('h2', { class: 'an-titre', id: 'an-courbe' }, ['Évolution — ' + PARAMS[param].l]));
        racine.appendChild(carteCourbe(donnees, param));
        historique(racine, donnees, cuvesTh, param);
        pied(racine);
        window.scrollTo(0, y);

        function choisir(c) {
          choix[theme] = c; PM.Prefs.set('an_param', choix); afficher();
          var t = document.getElementById('an-courbe'); if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        /* ----- tableau « dernière valeur » : paramètres en lignes, cuves en colonnes ----- */
        function matrice(racine, donnees, cuves, params, actif, th) {
          // par cuve : liste des analyses dans l'ordre des dates
          var parCuve = {};
          cuves.forEach(function (p) { parCuve[p] = donnees.filter(function (l) { return nomPoint(l) === p; }); });
          var derniereDate = {};
          cuves.forEach(function (p) {
            var d = '';
            parCuve[p].forEach(function (l) { if (params.some(function (c) { return !vide(l[c]); })) d = l.Date_Analyse; });
            derniereDate[p] = d;
          });
          var thead = el('tr', {}, [el('th', { class: 'an-m-param' }, ['Paramètre'])].concat(cuves.map(function (p) {
            return el('th', { class: 'an-m-cuve', title: p }, [el('span', { class: 'an-m-nom' }, [el('i', { class: 'an-pastille', style: '--pt:' + couleur(p) }),
                el('span', { class: 'an-nom-long' }, [p]), el('span', { class: 'an-nom-court' }, [NOM_COURT[p] || p])]),
              el('span', { class: 'an-m-date' }, [derniereDate[p] ? fmtDate(derniereDate[p]) : '—'])]);
          })));
          var tbody = el('tbody');
          params.forEach(function (c) {
            var P = PARAMS[c];
            var tr = el('tr', { class: 'an-m-ligne' + (c === actif ? ' choisi' : ''), tabindex: '0', role: 'button',
              'aria-label': 'Voir la courbe ' + P.l, onclick: function () { choisir(c); },
              onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(c); } } }, [
              el('td', { class: 'an-m-param' }, [el('span', { class: 'an-m-lib' }, [P.l]), P.u ? el('span', { class: 'an-m-unite' }, [P.u]) : null])
            ]);
            cuves.forEach(function (p) {
              var serie = parCuve[p].filter(function (l) { return !vide(l[c]); });
              var der = serie[serie.length - 1], prec = serie[serie.length - 2];
              if (!der) { tr.appendChild(el('td', { class: 'an-m-val an-m-rien' }, ['—'])); return; }
              var v = der[c], e = etat(c, v), sous = [];
              // évolution depuis l'analyse précédente de la même cuve
              var a = num(v), b = prec ? num(prec[c]) : null;
              if (a !== null && b !== null && b !== 0 && !sousLimite(v) && !sousLimite(prec[c])) {
                var pct = Math.round((a - b) / Math.abs(b) * 100);
                if (Math.abs(pct) >= 3) sous.push(el('span', { class: 'an-m-evol ' + (pct > 0 ? 'monte' : 'baisse'), title: 'Depuis le ' + fmtDate(prec.Date_Analyse) + ' : ' + fmt(prec[c]) },
                  [(pct > 0 ? '▲ +' : '▼ ') + pct + ' %']));
                else sous.push(el('span', { class: 'an-m-evol stable', title: 'Depuis le ' + fmtDate(prec.Date_Analyse) + ' : ' + fmt(prec[c]) }, ['= stable']));
              }
              if ((new Date(derniereDate[p]) - new Date(der.Date_Analyse)) / 86400000 > JOURS_ANCIEN) sous.push(el('span', { class: 'an-m-ancien' }, ['au ' + fmtDateCourte(der.Date_Analyse)]));
              tr.appendChild(el('td', { class: 'an-m-val', title: e ? MOT_ETAT[e] : null }, [
                el('span', { class: 'an-m-chiffre' }, [e ? el('i', { class: 'an-etat-pt ' + e }) : null, fmt(v)]),
                sous.length ? el('span', { class: 'an-m-sous' }, sous) : null
              ]));
            });
            tbody.appendChild(tr);
          });
          var nbAbsents = th.params.length - params.length;
          racine.appendChild(el('section', { class: 'bandeau an-matrice' }, [
            el('div', { class: 'carte-tete' }, [el('h2', {}, ['Dernières valeurs']),
              el('span', { class: 'petit' }, ['Touche une ligne pour sa courbe'])]),
            el('div', { class: 'table-scroll' }, [el('table', { class: 'an-m-table' }, [el('thead', {}, [thead]), tbody])]),
            el('div', { class: 'an-m-legende petit' }, [
              el('span', {}, [el('i', { class: 'an-etat-pt ok' }), 'dans le repère']),
              el('span', {}, [el('i', { class: 'an-etat-pt att' }), 'à surveiller']),
              el('span', {}, [el('i', { class: 'an-etat-pt alerte' }), 'hors repère']),
              nbAbsents ? el('span', {}, [nbAbsents + ' paramètre(s) jamais mesuré(s), masqué(s)']) : null
            ]),
            PARAMS[actif].aide ? el('p', { class: 'petit an-aide' }, [PARAMS[actif].aide]) : null
          ]));
        }
      }

      function pied(racine) {
        racine.appendChild(el('p', { class: 'petit an-pied' }, [
          'Repères indicatifs, à caler avec le laboratoire. « < 25 » = sous la limite de détection du labo. ',
          'Import d’un ancien PDF et suppression d’un rapport : dans l’appli d’origine « Suivi Analyses Biogaz ».']));
      }

      /* ----- courbe : une ligne par cuve, axe des dates, zone verte = repère ----- */
      function carteCourbe(donnees, champ) {
        var P = PARAMS[champ], series = {}, ordre = [], nbSous = 0;
        donnees.forEach(function (l) {
          if (vide(l[champ])) return;
          if (sousLimite(l[champ])) { nbSous++; return; }
          var t = new Date(l.Date_Analyse).getTime(), v = num(l[champ]); if (isNaN(t) || v === null) return;
          var p = nomPoint(l);
          if (!series[p]) { series[p] = []; ordre.push(p); }
          series[p].push({ t: t, v: v, date: l.Date_Analyse, p: p });
        });
        var bloc = el('section', { class: 'bandeau trend-card' }, [el('h3', { class: 'an-courbe-titre' }, [P.l + (P.u && P.u !== 'atomes' ? ' (' + P.u + ')' : '')])]);
        var cw = el('div', { class: 'trend-chart-wrap' });
        var svg = svgEl('svg', { role: 'img', 'aria-label': 'Courbe ' + P.l });
        var tip = el('div', { class: 'chart-tooltip' });
        cw.appendChild(svg); cw.appendChild(tip); bloc.appendChild(cw);
        var tous = [];
        ordre.sort(parOrdre);
        ordre.forEach(function (p) { series[p].sort(function (a, b) { return a.t - b.t; }); tous = tous.concat(series[p]); });
        if (!tous.length) {
          svg.style.display = 'none';
          cw.appendChild(el('div', { class: 'chart-empty' }, [nbSous ? 'Toutes les valeurs sont sous la limite de détection du labo.' : 'Pas encore de valeur pour ce paramètre.']));
          return bloc;
        }
        var W = 480, H = 210, ML = 44, MR = 10, MT = 12, MB = 22, pw = W - ML - MR, ph = H - MT - MB;
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        var ts = tous.map(function (p) { return p.t; }), vs = tous.map(function (p) { return p.v; });
        var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
        if (tMin === tMax) { tMin -= 86400000 * 7; tMax += 86400000 * 7; }
        var vMin = Math.min.apply(null, vs), vMax = Math.max.apply(null, vs);
        var rep = P.rep;
        // la zone verte reste visible si elle est proche des valeurs (sans écraser l'échelle)
        if (rep) {
          var lo = rep.ok[0], hi = rep.ok[1] > 1e6 ? null : rep.ok[1], ampl = (vMax - vMin) || Math.abs(vMax) || 1;
          if (lo > 0 && lo >= vMin - ampl && lo < vMin) vMin = lo;
          if (hi !== null && hi <= vMax + ampl && hi > vMax) vMax = hi;
        }
        var marge = (vMax - vMin) * 0.12 || Math.abs(vMax) * 0.1 || 1;
        vMin -= marge; vMax += marge;
        if (vMin < 0 && Math.min.apply(null, vs) >= 0) vMin = 0;
        function X(t) { return ML + (t - tMin) / (tMax - tMin) * pw; }
        function Y(v) { return MT + ph - (v - vMin) / (vMax - vMin) * ph; }
        if (rep) {
          var y1 = Y(Math.min(rep.ok[1], vMax)), y0 = Y(Math.max(rep.ok[0], vMin));
          if (y0 > y1) svg.appendChild(svgEl('rect', { x: ML, y: y1, width: pw, height: y0 - y1, class: 'an-zone-ok' }));
        }
        [vMin, (vMin + vMax) / 2, vMax].forEach(function (val) {
          var yy = Y(val);
          svg.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yy, y2: yy, class: 'chart-grid' }));
          var t = svgEl('text', { x: ML - 6, y: yy + 3, class: 'chart-tick', 'text-anchor': 'end' }); t.textContent = fmtN(val); svg.appendChild(t);
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
          // construit avec du texte (le nom du point vient du Sheet : jamais interprété comme du HTML)
          tip.textContent = '';
          tip.appendChild(document.createTextNode(fmtDate(proche.date)));
          memeDate.forEach(function (q) { tip.appendChild(el('br')); tip.appendChild(document.createTextNode(q.p + ' : ')); tip.appendChild(el('b', {}, [fmtN(q.v) + uniteTexte(champ)])); });
          tip.style.left = Math.min(Math.max(X(proche.t) / W * 100, 22), 78) + '%'; tip.style.top = '30%'; tip.style.opacity = 1;
        }
        hit.addEventListener('pointermove', survol); hit.addEventListener('pointerdown', survol);
        hit.addEventListener('pointerleave', function () { cross.style.opacity = 0; tip.style.opacity = 0; });
        bloc.appendChild(el('div', { class: 'an-legende' }, ordre.map(function (p) {
          return el('span', {}, [el('i', { style: 'background:' + couleur(p) }), p]);
        }).concat(rep ? [el('span', {}, [el('i', { class: 'an-legende-zone' }), 'repère : ' + (rep.ok[1] > 1e6 ? '≥ ' + fmtN(rep.ok[0]) : rep.ok[0] > 0 ? fmtN(rep.ok[0]) + ' à ' + fmtN(rep.ok[1]) : '≤ ' + fmtN(rep.ok[1]))])] : [])
          .concat(nbSous ? [el('span', {}, [nbSous + ' valeur(s) « < limite » non tracée(s)'])] : [])));
        return bloc;
      }

      /* ----- historique du paramètre choisi : une date par ligne, une colonne par cuve ----- */
      function historique(racine, donnees, cuves, champ) {
        var parDate = {}, dates = [];
        donnees.forEach(function (l) {
          if (vide(l[champ])) return;
          var d = l.Date_Analyse;
          if (!parDate[d]) { parDate[d] = { cuves: {}, com: '', liens: [] }; dates.push(d); }
          parDate[d].cuves[nomPoint(l)] = l[champ];
          if (!parDate[d].com && l.Commentaire_IA) parDate[d].com = l.Commentaire_IA;
          (l.Liens || []).map(lienSur).forEach(function (u) { if (u && parDate[d].liens.indexOf(u) < 0) parDate[d].liens.push(u); });
        });
        dates.sort().reverse();
        var recents = toutHisto ? dates : dates.slice(0, 10);
        var tbody = el('tbody');
        recents.forEach(function (d) {
          var g = parDate[d];
          tbody.appendChild(el('tr', {}, [el('td', { class: 'date-cell' }, [fmtDate(d)])]
            .concat(cuves.map(function (p) {
              var v = g.cuves[p], e = vide(v) ? '' : etat(champ, v);
              return el('td', { class: 'val-cell' }, vide(v) ? ['—'] : [e ? el('i', { class: 'an-etat-pt ' + e }) : null, fmt(v)]);
            }))
            .concat([el('td', { class: 'an-com' }, [g.com ? el('div', { class: 'an-com-txt', title: 'Toucher pour tout lire', onclick: function () { this.classList.toggle('ouvert'); } }, [g.com]) : '']),
              el('td', { class: 'an-liens' }, g.liens.slice(0, 3).map(function (u, i) {
                return el('a', { class: 'an-pdf', href: u, target: '_blank', rel: 'noopener' }, [g.liens.length > 1 ? 'PDF ' + (i + 1) : 'Voir le PDF']);
              }))])));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Historique — ' + PARAMS[champ].l]), el('span', { class: 'petit' }, [dates.length + ' date(s)' + uniteTexte(champ).replace(/^ /, ' · ')])]),
          el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table nh3-table-large' }, [
            el('thead', {}, [el('tr', {}, ['Date'].concat(cuves).concat(['Commentaire', '']).map(function (h) { return el('th', {}, [h]); }))]), tbody])]),
          dates.length > 10 ? el('button', { class: 'btn-second an-voir-tout', type: 'button', onclick: function () { toutHisto = !toutHisto; afficher(); } },
            [toutHisto ? 'Voir seulement les 10 dernières' : 'Voir les ' + dates.length + ' dates']) : null
        ]));
      }
    }
  };
})();
