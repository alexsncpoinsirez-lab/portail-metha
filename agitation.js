/* =====================================================================
   MODULE « HAUTEUR AGITATION » — Métha de la Rotte — version rapide
   Reprend l'appli d'origine : 3 cuves (Digesteur, Post-digesteur, Stockage),
   jauge de hauteur d'hélice par agitateur, réglage ± tours ou tours cumulés,
   aperçu du calcul, confirmation vocale, historique filtrable + export CSV.
   Les réglages fonctionnent sans réseau et partent dès que le réseau revient.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  // Table de référence hauteur hélice / radier (identique à l'appli d'origine)
  var TABLE = [[0, 0.99], [10, 1.26], [20, 1.56], [30, 1.88], [40, 2.20], [50, 2.55], [60, 2.89], [70, 3.24], [80, 3.60], [90, 3.96], [100, 4.32], [110, 4.68], [120, 5.04]];
  function toursToHauteur(t) {
    t = Math.max(0, t);
    if (t <= 120) {
      for (var i = 0; i < TABLE.length - 1; i++) {
        var t0 = TABLE[i][0], h0 = TABLE[i][1], t1 = TABLE[i + 1][0], h1 = TABLE[i + 1][1];
        if (t >= t0 && t <= t1) return h0 + (h1 - h0) * (t - t0) / (t1 - t0);
      }
    }
    var a0 = TABLE[TABLE.length - 2], a1 = TABLE[TABLE.length - 1];
    return a1[1] + (a1[1] - a0[1]) / (a1[0] - a0[0]) * (t - 120);
  }
  var OPERATEURS = ['Adam', 'Alex', 'Benoit', 'Mathieu', 'Pierrick', 'Régis', 'Thibaut', 'Tigrou'];
  var ECHELLE_MAX = 8.0;
  var CUVES = [
    { nom: 'Digesteur', reperes: [0.99, 5.04, 6.9, 7.45, 7.5], agitateurs: [
      { id: 'dig-1', nom: 'Agitateur à tige (côté post-digesteur)' }] },
    { nom: 'Post-digesteur', reperes: [0.99, 5.04, 6.9, 7.45, 7.5], agitateurs: [
      { id: 'pd-1', nom: 'Agitateur immergé 1 (côté local technique)' },
      { id: 'pd-2', nom: 'Agitateur immergé 2 (côté champs)' }] },
    { nom: 'Stockage', reperes: [0.99, 5.04, 7.2, 7.45, 7.5], agitateurs: [
      { id: 'st-1', nom: 'Agitateur immergé 1 (côté séparateur)' },
      { id: 'st-2', nom: 'Agitateur immergé 2' },
      { id: 'st-3', nom: 'Agitateur immergé 3 (côté champs)' }] }
  ];
  var INDEX = {};
  CUVES.forEach(function (c) { c.agitateurs.forEach(function (a) { a.cuve = c.nom; a.reperes = c.reperes; INDEX[a.id] = a; }); });

  function demo() {
    var ag = { 'dig-1': [0, null, null], 'pd-1': [15, '2026-09-04T08:23:28Z', 'Mathieu'], 'pd-2': [0, null, null],
      'st-1': [149, '2026-09-03T08:08:16Z', 'Adam'], 'st-2': [15, '2026-09-25T08:07:40Z', 'Mathieu'], 'st-3': [12, '2026-09-28T08:45:50Z', 'Mathieu'] };
    var D = { agitateurs: {}, historique: [] };
    Object.keys(ag).forEach(function (id) { D.agitateurs[id] = { tours: ag[id][0], maj: ag[id][1], technicien: ag[id][2] }; });
    [['2026-09-28T08:45:50Z', 'st-3', 2, 12, 'Mathieu'], ['2026-09-25T08:07:40Z', 'st-2', 3, 15, 'Mathieu'], ['2026-09-17T08:17:43Z', 'st-2', -3, 12, 'Mathieu'],
      ['2026-09-04T08:23:28Z', 'pd-1', 0, 15, 'Mathieu'], ['2026-09-03T08:08:16Z', 'st-1', 20, 149, 'Adam']].forEach(function (h) {
      var a = INDEX[h[1]];
      D.historique.push({ ts: h[0], cuve: a.cuve, agitateur: a.nom, id: a.id, mode: '± tours', delta: h[2], tours: h[3], hauteur: toursToHauteur(h[3]), technicien: h[4] });
    });
    return D;
  }

  function fmtM(h) { return Number(h).toFixed(2).replace('.', ',') + ' m'; }
  function fmtCm(h) { return Math.round(h * 100) + ' cm'; }
  function fmtTours(t) { return Number(t).toLocaleString('fr-FR', { maximumFractionDigits: 1 }); }
  function fmtDate(ts) {
    if (!ts) return 'jamais réglé';
    var d = new Date(ts); if (isNaN(d)) return String(ts);
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  window.MODULES.agitation = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'agitation_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'agitation_attente_' + ctx.site.id;
      var D = null, attente = [], onglet = 'dash', filtre = '';

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = r[0] || (modeDemo ? demo() : null);
        attente = r[1] || [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        return PM.Api.appeler(ctx.apiUrl, { action: 'agitation.donnees', cle: ctx.cle }, 25000).then(function (j) {
          delete j.ok; D = j; PM.DB.set(CLE_DONNEES, j);
          return PM.DB.listerEnvois().then(function (l) {
            var ids = (l || []).map(function (x) { return x.payload.id; });
            attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
            PM.DB.set(CLE_ATTENTE, attente);
            if (!document.querySelector('.ag-modale')) afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le suivi des agitateurs.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast('Hors ligne : données du dernier chargement');
        });
      }
      var instance = PM.uid();
      window.__agInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__agInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- état affiché = serveur + réglages en attente (même calcul que le serveur) ---------- */
      function etat() {
        var ag = {}, hist = D.historique.slice();
        Object.keys(INDEX).forEach(function (id) {
          var s = D.agitateurs[id] || { tours: 0, maj: null, technicien: null };
          ag[id] = { tours: Number(s.tours) || 0, maj: s.maj, technicien: s.technicien };
        });
        attente.forEach(function (p) {
          var s = ag[p.agitId]; if (!s) return;
          var avant = s.tours;
          var apres = Math.max(0, p.mode === 'delta' ? avant + p.valeur : p.valeur);
          s.tours = apres; s.maj = p.horodatage; s.technicien = p.technicien; s.enAttente = true;
          var a = INDEX[p.agitId];
          hist.unshift({ ts: p.horodatage, cuve: a.cuve, agitateur: a.nom, id: a.id, mode: p.mode === 'delta' ? '± tours' : 'tours absolus',
            delta: apres - avant, tours: apres, hauteur: toursToHauteur(apres), technicien: p.technicien, enAttente: true });
        });
        return { agitateurs: ag, historique: hist };
      }

      function saisir(payload) {
        payload.id = PM.uid();
        if (modeDemo) {
          var s = D.agitateurs[payload.agitId], avant = s.tours, a = INDEX[payload.agitId];
          s.tours = Math.max(0, payload.mode === 'delta' ? avant + payload.valeur : payload.valeur);
          s.maj = payload.horodatage; s.technicien = payload.technicien;
          D.historique.unshift({ ts: payload.horodatage, cuve: a.cuve, agitateur: a.nom, id: a.id, mode: payload.mode === 'delta' ? '± tours' : 'tours absolus',
            delta: s.tours - avant, tours: s.tours, hauteur: toursToHauteur(s.tours), technicien: payload.technicien });
          return;
        }
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        PM.Envoi.ajouter(ctx.site.id, payload);
      }

      /* ---------- voix (comme l'appli d'origine) ---------- */
      function voixActive() { return PM.Prefs.get('agitation_voix', 'on') !== 'off'; }
      function parler(texte) {
        if (!voixActive() || !('speechSynthesis' in window)) return;
        try { window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(texte); u.lang = 'fr-FR'; window.speechSynthesis.speak(u); } catch (e) {}
      }
      function annoncer(nom, delta, h) {
        var n = Math.round(Math.abs(delta)), cm = Math.round(h * 100);
        if (n === 0) parler(nom + ' : hauteur inchangée, ' + cm + ' centimètres.');
        else parler(nom + ' : ' + (delta > 0 ? 'montée' : 'descente') + ' de ' + n + ' tour' + (n > 1 ? 's' : '') + '. Hauteur ' + cm + ' centimètres.');
      }

      /* ================= écran ================= */
      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'agitation' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur de la Rotte dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['dash', 'Tableau de bord'], ['hist', 'Historique']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', 'aria-selected': String(onglet === t[0]),
            onclick: function () { onglet = t[0]; afficher(); window.scrollTo(0, 0); } }, [t[1]]));
        });
        racine.appendChild(tabs);
        var E = etat();
        if (onglet === 'dash') ecranTableau(racine, E); else ecranHistorique(racine, E);
        window.scrollTo(0, y);
      }

      function jauge(a, h) {
        var pct = Math.max(0, Math.min(100, h / ECHELLE_MAX * 100));
        var w = el('div', { class: 'ag-jauge' }, [el('div', { class: 'ag-jauge-remplie', style: 'height:' + pct + '%' })]);
        var dernierLibelle = -1;
        a.reperes.forEach(function (r) {
          var p = Math.max(0, Math.min(100, r / ECHELLE_MAX * 100));
          // repères trop proches (ex. 7,45 et 7,5 m) : le trait reste, le texte n'est pas répété pour rester lisible
          var lisible = r - dernierLibelle > 0.3;
          if (lisible) dernierLibelle = r;
          w.appendChild(el('div', { class: 'ag-repere', style: 'bottom:' + p + '%', title: String(r).replace('.', ',') + ' m' },
            lisible ? [el('span', {}, [String(r).replace('.', ',') + ' m'])] : []));
        });
        w.appendChild(el('div', { class: 'ag-helice', style: 'bottom:' + pct + '%', title: 'Hélice à ' + fmtM(h) }));
        return w;
      }

      function ecranTableau(racine, E) {
        var grille = el('div', { class: 'ag-cuves' });
        CUVES.forEach(function (c, ci) {
          var cartes = el('div', { class: 'ag-cartes' });
          c.agitateurs.forEach(function (a) {
            var st = E.agitateurs[a.id], h = toursToHauteur(st.tours);
            cartes.appendChild(el('button', { class: 'ag-carte', 'data-id': a.id, onclick: function () { ouvrirReglage(a.id); } }, [
              el('div', { class: 'ag-nom' }, [a.nom]),
              jauge(a, h),
              el('div', { class: 'ag-stats' }, [
                el('div', { class: 'ag-h' }, [fmtM(h)]),
                el('div', { class: 'ag-t' }, [fmtCm(h) + ' · ' + fmtTours(Math.round(st.tours)) + ' tours']),
                el('div', { class: 'ag-maj' }, [(st.technicien ? st.technicien + ' · ' : '') + fmtDate(st.maj) + (st.enAttente ? ' ⏳' : '')])
              ])
            ]));
          });
          grille.appendChild(el('section', { class: 'bandeau ag-cuve', style: '--i:' + ci }, [el('h2', { class: 'ag-cuve-titre' }, [c.nom]), cartes]));
        });
        racine.appendChild(grille);
        racine.appendChild(el('p', { class: 'petit ag-astuce' }, ['Touche un agitateur pour enregistrer un réglage.']));
        var chk = el('input', { type: 'checkbox', checked: voixActive() ? 'checked' : null });
        chk.addEventListener('change', function () {
          PM.Prefs.set('agitation_voix', chk.checked ? 'on' : 'off');
          if (chk.checked) parler('Confirmation vocale activée.'); else if (window.speechSynthesis) window.speechSynthesis.cancel();
        });
        racine.appendChild(el('p', { class: 'petit ag-pied' }, [
          'Table de référence hauteur hélice / radier : 0 tour = 0,99 m … 120 tours = 5,04 m (interpolation par paliers de 10 tours).',
          el('br'), el('label', { class: 'ag-voix' }, [chk, ' 🔊 Confirmation vocale'])]));
      }

      function ecranHistorique(racine, E) {
        var sel = el('select', { 'aria-label': 'Filtrer par agitateur' }, [el('option', { value: '' }, ['Tous les agitateurs'])]);
        CUVES.forEach(function (c) {
          var og = el('optgroup', { label: c.nom });
          c.agitateurs.forEach(function (a) { og.appendChild(el('option', { value: a.id, selected: filtre === a.id ? 'selected' : null }, [a.nom])); });
          sel.appendChild(og);
        });
        sel.addEventListener('change', function () { filtre = sel.value; afficher(); });
        var lignes = E.historique.filter(function (h) { return !filtre || h.id === filtre; });
        var btnCsv = el('button', { class: 'btn-second', type: 'button', onclick: function () { exporterCsv(E.historique); } }, ['Exporter CSV']);
        var tbody = el('tbody');
        lignes.forEach(function (h) {
          var d = Number(h.delta);
          tbody.appendChild(el('tr', { class: h.enAttente ? 'attente' : '' }, [
            el('td', {}, [fmtDate(h.ts) + (h.enAttente ? ' ⏳' : '')]), el('td', {}, [h.cuve]), el('td', {}, [h.agitateur]), el('td', {}, [h.mode]),
            el('td', { class: 'ag-num ' + (d > 0 ? 'ag-monte' : d < 0 ? 'ag-descend' : '') }, [(d > 0 ? '+' : '') + fmtTours(d)]),
            el('td', { class: 'ag-num' }, [fmtTours(h.tours)]), el('td', { class: 'ag-num' }, [fmtM(h.hauteur)]), el('td', {}, [h.technicien || ''])
          ]));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'ag-hist-outils' }, [sel, btnCsv]),
          lignes.length ? el('div', { class: 'table-scroll ag-hist' }, [el('table', { class: 'nh3-table ag-table' }, [
            el('thead', {}, [el('tr', {}, ['Date', 'Cuve', 'Agitateur', 'Mode', 'Δ tours', 'Tours cumulés', 'Hauteur', 'Opérateur'].map(function (t) { return el('th', {}, [t]); }))]),
            tbody])])
            : el('div', { class: 'vide-msg' }, ['Aucun réglage enregistré pour l’instant.'])
        ]));
      }

      function exporterCsv(hist) {
        var lignes = [['Date', 'Cuve', 'Agitateur', 'Mode', 'Delta tours', 'Tours cumules', 'Hauteur (m)', 'Operateur'].join(';')].concat(hist.map(function (h) {
          return [fmtDate(h.ts), h.cuve, h.agitateur, h.mode, h.delta, h.tours, Number(h.hauteur).toFixed(2), h.technicien].join(';');
        }));
        var blob = new Blob(['﻿' + lignes.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'historique_agitateurs.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }

      /* ---------- fenêtre de réglage (comme l'appli d'origine) ---------- */
      function ouvrirReglage(id) {
        var a = INDEX[id], mode = 'delta', signe = 1;
        var st = etat().agitateurs[id];
        var fond = el('div', { class: 'ag-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': a.nom });
        var actuel = el('div', { class: 'ag-encadre' });
        var lbl = el('label', { for: 'ag-valeur', class: 'ag-label' });
        var input = el('input', { id: 'ag-valeur', type: 'text', inputmode: 'decimal', autocomplete: 'off' });
        var bMonte = el('button', { type: 'button', class: 'ag-signe actif' }, ['▲ Monter']);
        var bDescend = el('button', { type: 'button', class: 'ag-signe' }, ['▼ Descendre']);
        var signes = el('div', { class: 'ag-signes' }, [bMonte, bDescend]);
        var mDelta = el('button', { type: 'button', class: 'ag-mode actif' }, ['Ajuster ± tours']);
        var mAbs = el('button', { type: 'button', class: 'ag-mode' }, ['Tours cumulés']);
        var selOp = el('select', { id: 'ag-operateur' }, [el('option', { value: '', disabled: 'disabled' }, ['Choisir…'])].concat(OPERATEURS.map(function (o) { return el('option', { value: o }, [o]); })));
        var dernier = PM.Prefs.get('agitation_operateur', '');
        selOp.value = OPERATEURS.indexOf(dernier) >= 0 ? dernier : '';
        var apercu = el('div', { class: 'ag-encadre ag-apercu' });
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var valider = el('button', { type: 'button', class: 'btn-principal' }, ['Valider']);
        var fermerBtn = el('button', { type: 'button', class: 'ag-fermer', 'aria-label': 'Fermer' }, ['×']);

        function nouveauxTours() {
          var raw = PM.nombre(input.value);
          if (raw === null || isNaN(raw)) return null;
          raw = Math.abs(raw);
          return Math.max(0, mode === 'delta' ? st.tours + signe * raw : raw);
        }
        function maj() {
          var h = toursToHauteur(st.tours);
          actuel.innerHTML = 'Actuellement : <strong>' + fmtTours(Math.round(st.tours)) + ' tours</strong> — ' + fmtM(h) + ' (' + fmtCm(h) + ')';
          lbl.textContent = mode === 'delta' ? 'Nombre de tours à ajuster' : 'Nombre de tours cumulés depuis le point bas';
          input.placeholder = mode === 'delta' ? 'ex : 10' : 'ex : 40';
          signes.hidden = mode !== 'delta';
          bMonte.classList.toggle('actif', signe === 1); bDescend.classList.toggle('actif', signe === -1);
          mDelta.classList.toggle('actif', mode === 'delta'); mAbs.classList.toggle('actif', mode === 'abs');
          var n = nouveauxTours();
          if (n === null) { apercu.textContent = 'Saisis une valeur pour voir l’aperçu du calcul.'; return; }
          var nh = toursToHauteur(n);
          apercu.innerHTML = fmtTours(Math.round(st.tours)) + ' tours (' + fmtM(h) + ') → <strong>' + fmtTours(Math.round(n)) + ' tours (' + fmtM(nh) + ' / ' + fmtCm(nh) + ')</strong>';
        }
        bMonte.addEventListener('click', function () { signe = 1; maj(); });
        bDescend.addEventListener('click', function () { signe = -1; maj(); });
        mDelta.addEventListener('click', function () { mode = 'delta'; maj(); });
        mAbs.addEventListener('click', function () { mode = 'abs'; maj(); });
        input.addEventListener('input', maj);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });

        function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
        function esc(e) { if (e.key === 'Escape') fermer(); }
        function go() {
          msg.hidden = true;
          if (!selOp.value) { msg.textContent = 'Choisis un opérateur.'; msg.hidden = false; return; }
          var n = nouveauxTours();
          if (n === null) { msg.textContent = 'Saisis une valeur valide.'; msg.hidden = false; return; }
          var raw = Math.abs(PM.nombre(input.value));
          var valeur = mode === 'delta' ? signe * raw : raw;
          if (navigator.vibrate) navigator.vibrate(25);
          PM.Prefs.set('agitation_operateur', selOp.value);
          saisir({ type: 'agitation.reglage', agitId: id, mode: mode, valeur: valeur, technicien: selOp.value, horodatage: new Date().toISOString() });
          var h = toursToHauteur(n);
          annoncer(a.nom, n - st.tours, h);
          fermer();
          afficher();
          PM.toast('Enregistré : ' + fmtTours(Math.round(n)) + ' tours, hauteur ' + fmtM(h) + ' (' + fmtCm(h) + ').');
        }
        valider.addEventListener('click', go);
        fermerBtn.addEventListener('click', fermer);
        fond.addEventListener('click', function (e) { if (e.target === fond) fermer(); });
        document.addEventListener('keydown', esc);
        window.addEventListener('hashchange', fermer);

        fond.appendChild(el('div', { class: 'ag-modale-boite' }, [
          el('div', { class: 'ag-modale-tete' }, [el('div', {}, [el('h2', {}, [a.nom]), el('div', { class: 'petit' }, [a.cuve])]), fermerBtn]),
          actuel,
          el('div', { class: 'ag-modes' }, [mDelta, mAbs]),
          el('div', { class: 'champ' }, [lbl, signes, input]),
          el('div', { class: 'champ' }, [el('label', { for: 'ag-operateur' }, ['Opérateur']), selOp]),
          apercu, valider, msg
        ]));
        document.body.appendChild(fond);
        maj();
        setTimeout(function () { input.focus(); }, 30);
      }
    }
  };
})();
