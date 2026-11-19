/* =====================================================================
   MODULE « CONSOMMATION D'EAU » — Arraincourt Biogaz — version rapide
   De temps en temps : date + volume total du compteur (paramètre 01).
   L'appli calcule la consommation moyenne par mois depuis le relevé
   précédent (et sur toute la période). Historique, modification /
   suppression, fonctionne sans réseau.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var JOURS_MOIS = 30.44; // mois moyen (365,25 / 12)

  var DEMO = {
    unite: 'm³', compteur: 'Compteur d’eau — paramètre 01',
    operateurs: ['Alex', 'Pierrick', 'Antonin', 'Noé', 'Géraldine', 'Pascal', 'Régis', 'Benoit', 'Mathieu', 'Charles'],
    releves: [
      { id: 'd1', date: '2026-06-02T10:00:00Z', volume: 15230, operateur: 'Alex', remarque: '' },
      { id: 'd2', date: '2026-07-15T10:00:00Z', volume: 15610, operateur: 'Pierrick', remarque: '' },
      { id: 'd3', date: '2026-09-01T10:00:00Z', volume: 16080, operateur: 'Alex', remarque: '' },
      { id: 'd4', date: '2026-10-20T10:00:00Z', volume: 16495, operateur: 'Alex', remarque: '' }
    ]
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function fmtDate(s) { var d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function fmtNb(v, dec) { return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function nb(x) { var n = PM.nombre(x); return n === null || isNaN(n) ? null : n; }
  function dateLocale(s) { var n = s ? new Date(s) : new Date(); if (isNaN(n)) n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); }
  // date du champ (AAAA-MM-JJ) → midi heure locale : pas de décalage de jour avec les fuseaux
  function dateIso(v) { var p = String(v || '').split('-'); if (p.length !== 3) return null; var d = new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); return isNaN(d) ? null : d.toISOString(); }
  function jourEntre(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  window.MODULES.eau = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'eau_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'eau_attente_' + ctx.site.id;
      var D = null, attente = [], onglet = 'vue', formOuvert = false, edition = null;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = (r[0] && Array.isArray(r[0].releves)) ? r[0] : (modeDemo ? DEMO : null);
        attente = Array.isArray(r[1]) ? r[1] : [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        PM.Api.appeler(ctx.apiUrl, { action: 'eau.donnees', cle: ctx.cle }, 25000).then(function (j) {
          delete j.ok;
          if (!Array.isArray(j.releves)) throw new Error('Réponse incomplète du serveur (serveur d’Arraincourt pas encore mis à jour ?)');
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
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger la consommation d’eau.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('span', { class: 'petit' }, ['Si le serveur répond « Action inconnue » : coller la dernière version d’API-Arraincourt-COMPLET.gs puis faire une Nouvelle version du déploiement.']), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : données du dernier chargement', 4000);
        });
      }
      var instance = PM.uid();
      window.__eauInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__eauInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- relevés affichés = serveur + saisies en attente ---------- */
      function releves() {
        var l = D.releves.slice();
        attente.forEach(function (a) {
          if (a.type === 'eau.releve') l.push({ id: a.id, date: a.date, volume: a.volume, operateur: a.operateur || '', remarque: a.remarque || '', enAttente: true });
          else if (a.type === 'eau.releve.modif') l = l.map(function (r) { return r.id === a.idReleve ? { id: r.id, date: a.date, volume: a.volume, operateur: r.operateur, remarque: a.remarque || '', enAttente: true } : r; });
          else if (a.type === 'eau.releve.suppr') l = l.filter(function (r) { return r.id !== a.idReleve; });
        });
        return l.sort(byDate);
      }
      function unite() { return (D && D.unite) || 'm³'; }
      /* périodes entre deux relevés successifs : jours, volume consommé, moyenne par mois */
      function periodes() {
        var l = releves(), res = [];
        for (var i = 1; i < l.length; i++) {
          var a = l[i - 1], b = l[i], j = jourEntre(a.date, b.date), dv = b.volume - a.volume;
          res.push({ de: a, a: b, jours: j, volume: dv, ok: j > 0 && dv >= 0, baisse: dv < 0,
            parMois: j > 0 && dv >= 0 ? dv / j * JOURS_MOIS : null, parJour: j > 0 && dv >= 0 ? dv / j : null });
        }
        return res;
      }
      function moyenneGlobale(ps) {
        var j = 0, v = 0;
        ps.forEach(function (p) { if (p.ok) { j += p.jours; v += p.volume; } });
        return j > 0 ? { parMois: v / j * JOURS_MOIS, jours: j, volume: v } : null;
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
        var racine = el('div', { class: 'nh3 eau' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur d’Arraincourt dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['vue', 'Consommation'], ['historique', 'Historique']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', 'aria-selected': String(onglet === t[0]),
            onclick: function () { onglet = t[0]; afficher(); window.scrollTo(0, 0); } }, [t[1]]));
        });
        racine.appendChild(tabs);
        if (onglet === 'vue') ecranVue(racine); else ecranHistorique(racine);
        window.scrollTo(0, y);
      }

      /* ===== VUE : chiffres clés + formulaire + graphique ===== */
      function ecranVue(racine) {
        var l = releves(), ps = periodes(), der = l[l.length - 1] || null, derP = ps[ps.length - 1] || null, glob = moyenneGlobale(ps), u = unite();
        var carte = el('section', { class: 'bandeau' });
        carte.appendChild(el('div', { class: 'carte-tete' }, [el('h2', {}, ['Consommation d’eau']),
          el('button', { class: 'btn-second', onclick: function () { formOuvert = !formOuvert; edition = null; afficher(); } }, [formOuvert ? 'Fermer' : '+ Nouveau relevé'])]));
        if (formOuvert) carte.appendChild(formulaire());

        var kpiPrincipal;
        if (derP && derP.ok) kpiPrincipal = fmtNb(derP.parMois, derP.parMois < 100 ? 1 : 0);
        else kpiPrincipal = '—';
        carte.appendChild(el('div', { class: 'eau-principal' }, [
          el('div', { class: 'eau-principal-lbl' }, ['Moyenne par mois depuis le relevé précédent']),
          el('div', { class: 'eau-principal-val' }, [kpiPrincipal, el('span', { class: 'trend-unit' }, [' ' + u + ' / mois'])]),
          el('div', { class: 'petit' }, [
            !derP ? (l.length ? 'Il faut au moins deux relevés pour calculer une moyenne. Fais un 2e relevé dans quelques jours.' : 'Aucun relevé : touche « + Nouveau relevé ».')
              : derP.baisse ? '⚠ Le dernier volume est plus petit que le précédent (compteur changé ou erreur de saisie ?) : moyenne non calculée.'
              : derP.jours <= 0 ? 'Les deux derniers relevés sont le même jour : moyenne non calculée.'
              : 'Du ' + fmtDate(derP.de.date) + ' au ' + fmtDate(derP.a.date) + ' : ' + fmtNb(derP.volume, derP.volume % 1 ? 1 : 0) + ' ' + u + ' en ' + derP.jours + ' j, soit ' + fmtNb(derP.parJour, 2) + ' ' + u + ' / jour.'
          ])
        ]));
        carte.appendChild(el('div', { class: 'ck-kpis' }, [
          el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [der ? fmtNb(der.volume, der.volume % 1 ? 1 : 0) : '—', el('span', { class: 'trend-unit' }, [' ' + u])]), el('div', { class: 'ck-kpi-lbl' }, ['dernier volume total' + (der ? ' (' + fmtDate(der.date) + ')' : '')])]),
          el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [der ? String(Math.max(0, jourEntre(der.date, new Date()))) : '—', el('span', { class: 'trend-unit' }, [' j'])]), el('div', { class: 'ck-kpi-lbl' }, ['depuis le dernier relevé'])]),
          el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [glob ? fmtNb(glob.parMois, glob.parMois < 100 ? 1 : 0) : '—', el('span', { class: 'trend-unit' }, [' ' + u])]), el('div', { class: 'ck-kpi-lbl' }, ['par mois sur toute la période'])]),
          el('div', { class: 'ck-kpi' }, [el('div', { class: 'ck-kpi-val' }, [String(l.length)]), el('div', { class: 'ck-kpi-lbl' }, [l.length > 1 ? 'relevés' : 'relevé'])])
        ]));
        racine.appendChild(carte);

        // Graphique : moyenne mensuelle de chaque période (12 dernières)
        var okP = ps.filter(function (p) { return p.ok; }).slice(-12);
        if (okP.length) {
          var max = Math.max.apply(null, okP.map(function (p) { return p.parMois; })) || 1;
          racine.appendChild(el('section', { class: 'bandeau' }, [
            el('div', { class: 'carte-tete' }, [el('h2', {}, ['Moyenne par mois, relevé après relevé']), el('span', { class: 'petit' }, [u + ' / mois'])]),
            el('div', { class: 'eau-barres' }, okP.slice().reverse().map(function (p, i) {
              return el('div', { class: 'eau-barre-ligne' + (i === 0 ? ' dernier' : '') }, [
                el('div', { class: 'eau-barre-lbl' }, [fmtDate(p.de.date).slice(0, 5) + ' → ' + fmtDate(p.a.date).slice(0, 6) + fmtDate(p.a.date).slice(8)]),
                el('div', { class: 'eau-barre-fond' }, [el('div', { class: 'eau-barre', style: 'width:' + Math.max(3, Math.round(p.parMois / max * 100)) + '%' })]),
                el('div', { class: 'eau-barre-val' }, [fmtNb(p.parMois, p.parMois < 100 ? 1 : 0)])
              ]);
            })),
            el('p', { class: 'petit' }, ['Calcul : volume consommé entre deux relevés ÷ nombre de jours × 30,4 (mois moyen).'])
          ]));
        }
      }

      /* ===== HISTORIQUE ===== */
      function ecranHistorique(racine) {
        var l = releves(), ps = periodes(), u = unite(), parId = {};
        ps.forEach(function (p) { parId[p.a.id] = p; });
        var tbody = el('tbody');
        l.slice().reverse().forEach(function (r) {
          var p = parId[r.id];
          tbody.appendChild(el('tr', { class: r.enAttente ? 'attente' : '' }, [
            el('td', { class: 'nh3-td-modif' }, r.enAttente || modeDemo ? [] : [el('button', { type: 'button', class: 'nh3-btn-modif', title: 'Modifier', 'aria-label': 'Modifier',
              onclick: function () { edition = r; formOuvert = true; onglet = 'vue'; afficher(); window.scrollTo(0, 0); } }, ['✎'])]),
            el('td', { class: 'date-cell' }, [fmtDate(r.date) + (r.enAttente ? ' ⏳' : '')]),
            el('td', { class: 'val-cell' }, [fmtNb(r.volume, r.volume % 1 ? 1 : 0) + ' ' + u]),
            el('td', { class: 'val-cell' }, [p ? (p.baisse ? '⚠ baisse' : fmtNb(p.volume, p.volume % 1 ? 1 : 0) + ' ' + u) : '—']),
            el('td', { class: 'val-cell' }, [p ? p.jours + ' j' : '—']),
            el('td', { class: 'val-cell' }, [p && p.ok ? fmtNb(p.parMois, p.parMois < 100 ? 1 : 0) + ' ' + u : '—']),
            el('td', {}, [r.operateur || '—']),
            el('td', { class: 'ck-remarque' }, [r.remarque || ''])
          ]));
        });
        racine.appendChild(el('section', { class: 'bandeau' }, [
          el('div', { class: 'carte-tete' }, [el('h2', {}, ['Historique des relevés']), el('span', { class: 'petit' }, [l.length + (l.length > 1 ? ' relevés' : ' relevé')])]),
          l.length ? el('div', { class: 'table-scroll' }, [el('table', { class: 'nh3-table nh3-table-large' }, [
            el('thead', {}, [el('tr', {}, ['', 'Date', 'Volume total (param. 01)', 'Consommé', 'Durée', 'Moyenne / mois', 'Relevé par', 'Remarque'].map(function (h) { return el('th', {}, [h]); }))]), tbody])])
            : el('p', { class: 'petit' }, ['Aucun relevé. Touche « + Nouveau relevé » dans l’onglet Consommation.']),
          modeDemo || !l.length ? null : el('p', { class: 'petit' }, ['Touche ✎ pour corriger ou supprimer un relevé.'])
        ]));
      }

      /* ===== FORMULAIRE : nouveau relevé / modification ===== */
      function formulaire() {
        var E = edition, u = unite();
        var date = el('input', { type: 'date', value: dateLocale(E ? E.date : null) });
        var volume = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex. 16 495', value: E ? String(E.volume).replace('.', ',') : '' });
        var agent = PM.Prefs.get('agent', '');
        var operateurs = (D.operateurs && D.operateurs.length ? D.operateurs : DEMO.operateurs);
        var oper = el('select', {}, [el('option', { value: '' }, ['— Choisir —'])].concat(operateurs.map(function (o) { return el('option', { value: o, selected: o === agent ? 'selected' : null }, [o]); })));
        var remarque = el('input', { type: 'text', placeholder: 'facultatif', value: E ? (E.remarque || '') : '' });
        var l = releves().filter(function (r) { return !E || r.id !== E.id; }), precedent = l[l.length - 1] || null;
        var confirmeBaisse = false;

        var btn = el('button', { class: 'btn-principal', style: 'margin-top:12px', onclick: function () {
          var d = dateIso(date.value); if (!d) { PM.toast('Date invalide'); date.focus(); return; }
          var v = nb(volume.value); if (v === null || v < 0) { PM.toast('Indique le volume total affiché au paramètre 01'); volume.focus(); return; }
          if (!E && !oper.value) { PM.toast('Choisis qui a fait le relevé'); return; }
          // volume plus petit que le relevé d'avant : on demande confirmation (2e appui)
          var avant = l.filter(function (r) { return r.date <= d; }).pop();
          if (avant && v < avant.volume && !confirmeBaisse) {
            confirmeBaisse = true;
            btn.textContent = 'Volume plus petit que le ' + fmtDate(avant.date) + ' (' + fmtNb(avant.volume) + ') — confirmer ?';
            btn.classList.add('arme');
            setTimeout(function () { confirmeBaisse = false; btn.textContent = E ? 'Enregistrer la modification' : 'Enregistrer'; btn.classList.remove('arme'); }, 6000);
            return;
          }
          formOuvert = false;
          if (E) {
            edition = null;
            enregistrer({ type: 'eau.releve.modif', idReleve: E.id, date: d, volume: v, remarque: remarque.value.trim() }, 'Relevé modifié');
          } else {
            PM.Prefs.set && oper.value && PM.Prefs.set('agent', oper.value);
            enregistrer({ type: 'eau.releve', date: d, volume: v, operateur: oper.value, remarque: remarque.value.trim() }, 'Relevé enregistré');
          }
        } }, [E ? 'Enregistrer la modification' : 'Enregistrer']);

        return el('div', { class: 'nh3-form-charbon eau-form' + (E ? ' nh3-edition' : '') }, [
          E ? el('h3', { class: 'nh3-h2' }, ['Modifier le relevé du ' + fmtDate(E.date)]) : null,
          el('div', { class: 'nh3-2col' }, [
            el('div', { class: 'champ' }, [el('label', {}, ['Date du relevé']), date]),
            el('div', { class: 'champ' }, [el('label', {}, ['Volume total — paramètre 01 (' + u + ')']), volume])
          ]),
          el('div', { class: 'eau-aide' }, [el('b', {}, ['📟 Paramètre 01 ']), 'sur le compteur : c’est le volume total (index) à recopier.',
            precedent ? el('span', { class: 'petit' }, [' Dernier relevé : ' + fmtNb(precedent.volume, precedent.volume % 1 ? 1 : 0) + ' ' + u + ' le ' + fmtDate(precedent.date) + '.']) : null]),
          E ? null : el('div', { class: 'champ' }, [el('label', {}, ['Relevé par']), oper]),
          el('div', { class: 'champ' }, [el('label', {}, ['Remarque']), remarque]),
          btn,
          E ? el('div', { class: 'nh3-actions-edition' }, [
            el('button', { type: 'button', class: 'btn-second', onclick: function () { edition = null; formOuvert = false; afficher(); } }, ['Annuler']),
            boutonSupprimer('Supprimer ce relevé', function () {
              edition = null; formOuvert = false;
              enregistrer({ type: 'eau.releve.suppr', idReleve: E.id }, 'Relevé supprimé');
            })
          ]) : null
        ]);
      }

      /* Enregistrement : affiché tout de suite, envoyé dès que possible */
      function enregistrer(payload, message) {
        payload.id = PM.uid();
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, JSON.parse(JSON.stringify(payload)));
        PM.toast(message + (modeDemo ? ' (démo, non envoyé)' : (navigator.onLine ? '' : ' · envoi au retour du réseau')));
        onglet = 'vue';
        afficher();
        window.scrollTo(0, 0);
      }
    }
  };
})();
