/* =====================================================================
   MODULE « SUIVI BOUGIES » — Métha de la Rotte — version rapide
   Reprend l'appli d'origine : compteur horaire, bancs A et B (12 bougies
   colorées vert / orange / rouge), saisie rapide kV cylindre par cylindre,
   heures de remplacement (HRS), courbes, paramètres, retour bug.
   Les saisies fonctionnent sans réseau et partent dès que le réseau revient.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var NS = 'http://www.w3.org/2000/svg';
  var IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
  var JOURS = [['1', 'Lundi'], ['2', 'Mardi'], ['3', 'Mercredi'], ['4', 'Jeudi'], ['5', 'Vendredi'], ['6', 'Samedi'], ['0', 'Dimanche']];

  /* ---------- Données de démonstration (tant que le serveur n'est pas réglé) ---------- */
  function demo() {
    var tensions = [26, 26, 26, 26, 26, 32, 28, 27, 26, 25, 31, 25];
    var hrs = [68813, 68780, 68780, 68813, 68780, 67549, 68813, 68813, 68813, 68780, 67134, 69099];
    var hist = {};
    IDS.forEach(function (id, i) {
      hist[id] = [['2026-08-17T09:14:00Z', 34], ['2026-09-03T16:50:00Z', 37], ['2026-09-09T08:30:00Z', 36], ['2026-09-29T10:00:00Z', tensions[i]]]
        .map(function (p, k) { return { horodatage: p[0], tension: p[1] - (i % 3) + (k === 3 ? (i % 3) : 0), heuresMoteur: 67579 + k * 500 }; });
    });
    return {
      dashboard: { heuresMoteur: 69184, seuilOrangeKv: 36, seuilRougeKv: 37,
        cylindres: IDS.map(function (id, i) { return { id: id, tension: tensions[i], derniereMaj: '2026-09-29T10:00:00Z', heureRemplacement: hrs[i] }; }) },
      historique: hist,
      parametres: { seuilOrangeKv: 36, seuilRougeKv: 37, seuilHeuresAlerte: 2300, heuresMoteur: 69184, seuilJoursReleve: 7,
        heureRappelMatin: 9, heureRappelApresMidi: 16, joursActifs: '1,2,3,4,5,6', derniereReleveComplet: '2026-09-29T10:03:00Z',
        seuilHeuresBougieRemplacement: 2400, apiConfiguree: true }
    };
  }

  /* ---------- outils ---------- */
  function nb(x) { var n = PM.nombre(x); return n === null || isNaN(n) ? null : n; } // « 21 300 » = 21300, « 12abc » refusé
  function fmt(n) { return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 }); }
  function fmtDate(s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  function fmtDateHeure(s) {
    var d = new Date(s); if (isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); return e; }
  // même règle que l'appli d'origine
  function statut(tension, S) {
    if (tension === null || tension === undefined || isNaN(tension)) return 'inconnu';
    if (tension >= S.seuilRougeKv) return 'rouge';
    if (tension >= S.seuilOrangeKv) return 'orange';
    return 'vert';
  }
  // icône de bougie de l'appli d'origine
  function iconeBougie(st) {
    return '<svg class="bg-icone st-' + st + '" viewBox="0 0 40 100" width="18" height="44" aria-hidden="true">' +
      '<g transform="rotate(180 20 50)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M18 4 C24 1 29 6 24 10"/><rect x="14" y="10" width="12" height="6" rx="2"/><rect x="9" y="16" width="22" height="22" rx="9"/>' +
      '<line x1="13" y1="21" x2="20" y2="16"/><line x1="13" y1="27" x2="26" y2="16"/><line x1="13" y1="33" x2="26" y2="22"/>' +
      '<polygon points="10,44 14,40 26,40 30,44 30,52 26,56 14,56 10,52"/><rect x="12" y="58" width="16" height="10" rx="3"/>' +
      '<rect x="14" y="68" width="12" height="18"/><line x1="14" y1="72" x2="26" y2="72"/><line x1="14" y1="77" x2="26" y2="77"/>' +
      '<line x1="14" y1="82" x2="26" y2="82"/><rect x="13" y="86" width="14" height="3" rx="1"/><path d="M20 89 L20 93 Q20 96 24 96"/></g></svg>';
  }
  var ICO = {
    courbes: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="14 6 21 6 21 13"/></svg>',
    retour: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    reglages: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'
  };

  window.MODULES.bougies = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'bougies_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'bougies_attente_' + ctx.site.id;
      var D = null, attente = [], ecran = 'accueil', seq = null, codeApiValide = null;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = r[0] || (modeDemo ? demo() : null);
        attente = r[1] || [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        return PM.Api.appeler(ctx.apiUrl, { action: 'bougies.donnees', cle: ctx.cle }, 25000).then(function (j) {
          delete j.ok; D = j; PM.DB.set(CLE_DONNEES, j);
          return PM.DB.listerEnvois().then(function (l) {
            var ids = (l || []).map(function (x) { return x.payload.id; });
            attente = attente.filter(function (a) { return ids.indexOf(a.id) >= 0; });
            PM.DB.set(CLE_ATTENTE, attente);
            if (!seq) afficher();
          });
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le suivi bougies.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : données du dernier chargement', 4000);
        });
      }
      var instance = PM.uid();
      window.__bgInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__bgInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- état affiché = serveur + saisies en attente ---------- */
      function etat() {
        var S = { seuilOrangeKv: D.parametres.seuilOrangeKv, seuilRougeKv: D.parametres.seuilRougeKv };
        var heures = Number(D.dashboard.heuresMoteur) || 0;
        var cyl = {};
        D.dashboard.cylindres.forEach(function (c) { cyl[c.id] = { id: c.id, tension: c.tension, derniereMaj: c.derniereMaj, heureRemplacement: c.heureRemplacement }; });
        var releve = D.parametres.derniereReleveComplet;
        attente.forEach(function (a) {
          if (a.type === 'bougies.compteur' && a.heuresMoteur >= heures) heures = a.heuresMoteur;
          else if (a.type === 'bougies.tension' && cyl[a.cylindre]) { cyl[a.cylindre].tension = a.tension; cyl[a.cylindre].derniereMaj = a.horodatage; cyl[a.cylindre].enAttente = true; }
          else if (a.type === 'bougies.remplacement' && cyl[a.cylindre]) { cyl[a.cylindre].heureRemplacement = a.heureRemplacement; cyl[a.cylindre].enAttente = true; }
          else if (a.type === 'bougies.releveComplet') releve = a.horodatage;
        });
        var liste = IDS.filter(function (id) { return cyl[id]; }).map(function (id) {
          var c = cyl[id];
          c.statut = statut(c.tension, S);
          c.heuresBougie = (c.heureRemplacement === null || c.heureRemplacement === undefined) ? null : Math.max(heures - c.heureRemplacement, 0);
          return c;
        });
        return { heuresMoteur: heures, S: S, cylindres: liste, releve: releve };
      }
      function historique() {
        var h = {};
        IDS.forEach(function (id) { h[id] = (D.historique[id] || []).slice(); });
        var heures = Number(D.dashboard.heuresMoteur) || 0;
        attente.forEach(function (a) {
          if (a.type === 'bougies.compteur' && a.heuresMoteur >= heures) heures = a.heuresMoteur;
          if (a.type === 'bougies.tension' && h[a.cylindre]) h[a.cylindre].push({ horodatage: a.horodatage, tension: a.tension, heuresMoteur: heures, enAttente: true });
        });
        return h;
      }

      /* ---------- enregistrement (file d'attente hors ligne) ---------- */
      function saisir(payload) {
        payload.id = PM.uid();
        if (modeDemo) {
          // en démonstration : appliqué localement, rien n'est envoyé
          appliquerDemo(payload);
          return;
        }
        attente.push(payload);
        PM.DB.set(CLE_ATTENTE, attente);
        PM.Envoi.ajouter(ctx.site.id, payload);
      }
      function appliquerDemo(p) {
        var c = D.dashboard.cylindres.filter(function (x) { return x.id === p.cylindre; })[0];
        if (p.type === 'bougies.tension') { c.tension = p.tension; c.derniereMaj = p.horodatage; D.historique[p.cylindre].push({ horodatage: p.horodatage, tension: p.tension, heuresMoteur: D.dashboard.heuresMoteur }); }
        else if (p.type === 'bougies.remplacement') c.heureRemplacement = p.heureRemplacement;
        else if (p.type === 'bougies.compteur') D.dashboard.heuresMoteur = D.parametres.heuresMoteur = p.heuresMoteur;
        else if (p.type === 'bougies.releveComplet') D.parametres.derniereReleveComplet = p.horodatage;
      }

      /* ---------- appels directs (paramètres, tests, retour) : réseau nécessaire ---------- */
      function appelDirect(corps, bouton) {
        if (modeDemo) return Promise.reject(new Error('Mode démonstration : renseigne le serveur de la Rotte dans Réglages.'));
        if (!navigator.onLine) return Promise.reject(new Error('Pas de réseau : réessaie quand le téléphone est connecté.'));
        var txt = bouton ? bouton.innerHTML : '';
        if (bouton) { if (navigator.vibrate) navigator.vibrate(25); bouton.disabled = true; bouton.innerHTML = '<span class="bg-spinner" aria-hidden="true"></span>'; }
        corps.cle = ctx.cle;
        return PM.Api.appeler(ctx.apiUrl, corps, 30000).then(function (j) {
          if (bouton) { bouton.disabled = false; bouton.innerHTML = txt; }
          return j;
        }, function (e) {
          if (bouton) { bouton.disabled = false; bouton.innerHTML = txt; }
          throw e;
        });
      }

      /* ================= écran ================= */
      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'nh3 bougies' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur de la Rotte dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var E = etat();
        racine.appendChild(barreOutils(E));
        if (ecran === 'accueil') ecranAccueil(racine, E);
        else if (ecran === 'hrs') ecranHrs(racine, E);
        else if (ecran === 'sequence') ecranSequence(racine, E);
        else if (ecran === 'courbes') ecranCourbes(racine, E);
        else if (ecran === 'parametres') ecranParametres(racine, E);
        if (ecran !== 'sequence') window.scrollTo(0, ecran === 'accueil' ? y : 0);
      }
      function aller(nom) { ecran = nom; if (nom !== 'sequence') seq = null; afficher(); window.scrollTo(0, 0); }

      function barreOutils(E) {
        var btn = function (id, contenu, titre, action, texte) {
          return el('button', { class: 'bg-ico' + (texte ? ' bg-ico-texte' : '') + (ecran === id ? ' actif' : ''), title: titre, 'aria-label': titre,
            html: contenu, onclick: action });
        };
        return el('div', { class: 'bg-barre' }, [
          el('button', { class: 'bg-compteur', title: 'Modifier le compteur horaire', onclick: ouvrirModaleCompteur }, [
            el('span', { class: 'bg-compteur-label' }, ['Compteur horaire']),
            el('span', { class: 'bg-compteur-valeur' }, [fmt(E.heuresMoteur) + ' h'])]),
          el('div', { class: 'bg-actions' }, [
            btn('hrs', 'HRS', 'Renseigner l’heure de remplacement d’une bougie', function () { aller('hrs'); }, true),
            btn('sequence', 'kV', 'Saisie rapide des tensions, cylindre par cylindre', demarrerSequence, true),
            btn('courbes', ICO.courbes, 'Courbes', function () { aller('courbes'); }),
            btn('retour', ICO.retour, 'Signaler un bug ou une amélioration', ouvrirModaleRetour),
            btn('parametres', ICO.reglages, 'Paramètres', function () { codeApiValide = null; aller('parametres'); })
          ])
        ]);
      }
      function lienRetour() { return el('button', { class: 'bg-lien-retour', onclick: function () { aller('accueil'); } }, ['← Retour']); }

      /* ----- Accueil : bancs A et B ----- */
      function carte(c, mode) {
        var tensionTxt = (c.tension === null || c.tension === undefined || isNaN(c.tension)) ? '-- kV' : fmt(c.tension) + ' kV';
        var bougieTxt = (c.heuresBougie === null || c.heuresBougie === undefined || isNaN(c.heuresBougie)) ? '-- h bougie' : fmt(c.heuresBougie) + ' h bougie';
        return el('button', { class: 'bg-cyl st-' + c.statut, 'data-id': c.id,
          onclick: function () { if (mode === 'hrs') ouvrirModaleRemplacement(c.id); else ouvrirModaleTension(c.id); } }, [
          el('div', { class: 'bg-cyl-ligne', html: '<span class="bg-cyl-id">' + c.id + '</span>' + iconeBougie(c.statut) }),
          mode === 'hrs' ? el('div', { class: 'bg-cyl-val' }, [bougieTxt]) : el('div', { class: 'bg-cyl-val' }, [tensionTxt]),
          mode === 'hrs' ? null : el('div', { class: 'bg-cyl-h' }, [bougieTxt]),
          c.enAttente ? el('span', { class: 'bg-cyl-attente', title: 'En attente d’envoi' }, ['⏳']) : null
        ]);
      }
      function bancs(racine, E, mode) {
        ['A', 'B'].forEach(function (b) {
          racine.appendChild(el('div', { class: 'bg-banc' }, ['Banc ' + b]));
          racine.appendChild(el('div', { class: 'bg-grille' }, E.cylindres.filter(function (c) { return c.id[0] === b; }).map(function (c) { return carte(c, mode); })));
        });
      }
      function ecranAccueil(racine, E) {
        bancs(racine, E, 'accueil');
        racine.appendChild(el('div', { class: 'bg-legende' }, [
          el('span', {}, [el('i', { class: 'st-vert' }), '< ' + fmt(E.S.seuilOrangeKv) + ' kV']),
          el('span', {}, [el('i', { class: 'st-orange' }), '≥ ' + fmt(E.S.seuilOrangeKv) + ' kV']),
          el('span', {}, [el('i', { class: 'st-rouge' }), '≥ ' + fmt(E.S.seuilRougeKv) + ' kV'])
        ]));
        if (E.releve) {
          var j = Math.floor((Date.now() - new Date(E.releve).getTime()) / 86400000);
          racine.appendChild(el('p', { class: 'petit bg-pied' }, ['Dernier relevé complet : ' + fmtDateHeure(E.releve) + ' (il y a ' + j + ' j)']));
        }
      }

      /* ----- HRS : remplacement d'une bougie ----- */
      function ecranHrs(racine, E) {
        racine.appendChild(lienRetour());
        racine.appendChild(el('p', { class: 'petit bg-instruction' }, ['Sélectionne une bougie pour renseigner l’heure moteur de son remplacement.']));
        bancs(racine, E, 'hrs');
      }

      /* ----- kV : saisie séquentielle des 12 tensions ----- */
      function demarrerSequence() { seq = { index: 0 }; ecran = 'sequence'; afficher(); window.scrollTo(0, 0); }
      function ecranSequence(racine, E) {
        var id = IDS[seq.index];
        var c = E.cylindres.filter(function (x) { return x.id === id; })[0];
        var input = el('input', { id: 'bg-seq-valeur', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Tension mesurée (kV)',
          value: (c && c.tension !== null && c.tension !== undefined) ? String(c.tension).replace('.', ',') : '' });
        var erreur = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var valider = el('button', { class: 'btn-principal', onclick: validerEtape }, ['Valider →']);
        function validerEtape() {
          var v = nb(input.value);
          if (v === null) { montrer(erreur, 'Merci de saisir une valeur numérique.'); return; }
          if (v < 0 || v > 60) { montrer(erreur, 'Valeur de tension invalide (0 à 60 kV attendu).'); return; }
          if (navigator.vibrate) navigator.vibrate(25);
          saisir({ type: 'bougies.tension', cylindre: id, tension: v, horodatage: new Date().toISOString() });
          seq.index++;
          if (seq.index >= IDS.length) {
            // les 12 tensions saisies dans la même session : relevé complet (réarme le rappel bougies + huile)
            saisir({ type: 'bougies.releveComplet', horodatage: new Date().toISOString() });
            seq = null; ecran = 'accueil'; afficher(); window.scrollTo(0, 0);
            PM.toast('Saisie des 12 tensions terminée.');
            return;
          }
          afficher();
        }
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); validerEtape(); } });
        racine.appendChild(el('div', { class: 'bg-seq-entete' }, [
          el('button', { class: 'bg-lien-retour', onclick: function () { aller('accueil'); } }, ['← Quitter']),
          el('span', { class: 'petit' }, [(seq.index + 1) + ' / ' + IDS.length])]));
        racine.appendChild(el('div', { class: 'bg-seq-progression' }, [el('div', { style: 'width:' + (seq.index / IDS.length * 100) + '%' })]));
        racine.appendChild(el('section', { class: 'bandeau bg-seq-carte' }, [
          el('h2', {}, ['Saisie rapide des tensions']),
          el('div', { class: 'bg-seq-cyl st-' + (c ? c.statut : 'inconnu') }, [id]),
          el('label', { for: 'bg-seq-valeur', class: 'petit' }, ['Tension mesurée (kV)']),
          input, erreur,
          el('div', { class: 'bg-boutons' }, [
            el('button', { class: 'btn-second', disabled: seq.index === 0 ? 'disabled' : null, onclick: function () { if (seq.index > 0) { seq.index--; afficher(); } } }, ['← Précédent']),
            valider])
        ]));
        setTimeout(function () { input.focus(); input.select(); }, 30);
      }

      /* ----- Courbes ----- */
      function ecranCourbes(racine, E) {
        racine.appendChild(lienRetour());
        var H = historique();
        var grille = el('div', { class: 'bg-courbes' });
        IDS.forEach(function (id) {
          var pts = H[id].map(function (p) { return { t: new Date(p.horodatage).getTime(), v: Number(p.tension), h: p.heuresMoteur, date: p.horodatage, attente: p.enAttente }; })
            .filter(function (p) { return !isNaN(p.t) && !isNaN(p.v); }).sort(function (a, b) { return a.t - b.t; });
          var c = E.cylindres.filter(function (x) { return x.id === id; })[0];
          var der = pts[pts.length - 1];
          var bloc = el('section', { class: 'bandeau trend-card' });
          bloc.appendChild(el('div', { class: 'trend-top' }, [
            el('div', { class: 'trend-title', html: '<span class="bg-cyl-id">' + id + '</span>' + iconeBougie(c ? c.statut : 'inconnu') }),
            der ? el('div', { class: 'trend-stat' }, [el('div', { class: 'trend-value' }, [fmt(der.v), el('span', { class: 'trend-unit' }, ['kV'])]),
              el('div', { class: 'trend-date' }, [fmtDateHeure(der.date) + (der.attente ? ' ⏳' : '')])]) : null]));
          var cw = el('div', { class: 'trend-chart-wrap' });
          var svgNode = svgEl('svg', { role: 'img', 'aria-label': 'Courbe de tension — cylindre ' + id });
          var tip = el('div', { class: 'chart-tooltip' });
          cw.appendChild(svgNode); cw.appendChild(tip); bloc.appendChild(cw);
          if (!courbe(svgNode, pts, E.S, tip)) { svgNode.style.display = 'none'; cw.appendChild(el('div', { class: 'chart-empty' }, ['Pas encore de mesure pour ce cylindre.'])); }
          grille.appendChild(bloc);
        });
        racine.appendChild(grille);
      }
      function courbe(svgNode, pts, S, tip) {
        var W = 480, Hh = 190, ML = 34, MR = 10, MT = 14, MB = 22, pw = W - ML - MR, ph = Hh - MT - MB;
        svgNode.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
        if (!pts.length) return false;
        var ts = pts.map(function (p) { return p.t; }), vs = pts.map(function (p) { return p.v; });
        var tMin = Math.min.apply(null, ts), tMax = Math.max.apply(null, ts);
        if (tMin === tMax) { tMin -= 86400000; tMax += 86400000; }
        // même échelle que l'appli d'origine : au moins 20 → 45 kV
        var vMin = Math.min(20, Math.min.apply(null, vs)), vMax = Math.max(45, Math.max.apply(null, vs));
        function X(t) { return ML + (t - tMin) / (tMax - tMin) * pw; }
        function Y(v) { return MT + ph - (v - vMin) / (vMax - vMin) * ph; }
        [vMin, (vMin + vMax) / 2, vMax].forEach(function (val) {
          var yy = Y(val);
          svgNode.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yy, y2: yy, class: 'chart-grid' }));
          var t = svgEl('text', { x: ML - 6, y: yy + 3, class: 'chart-tick', 'text-anchor': 'end' }); t.textContent = fmt(Math.round(val)); svgNode.appendChild(t);
        });
        [['seuilOrangeKv', 'bg-seuil-orange'], ['seuilRougeKv', 'bg-seuil-rouge']].forEach(function (s) {
          var yt = Y(S[s[0]]);
          svgNode.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: yt, y2: yt, class: 'bg-seuil ' + s[1] }));
        });
        var lb = svgEl('text', { x: W - MR, y: Y(S.seuilRougeKv) - 4, class: 'chart-threshold-label', 'text-anchor': 'end' }); lb.textContent = 'seuil ' + fmt(S.seuilRougeKv) + ' kV'; svgNode.appendChild(lb);
        [pts[0], pts[pts.length - 1]].forEach(function (p, i) {
          var t = svgEl('text', { x: i === 0 ? ML : W - MR, y: Hh - 6, class: 'chart-xtick', 'text-anchor': i === 0 ? 'start' : 'end' }); t.textContent = fmtDate(p.date); svgNode.appendChild(t);
        });
        var couleur = 'var(--bg-ligne)';
        if (pts.length > 1) {
          var gid = 'bgg' + PM.uid();
          var defs = svgEl('defs', {}), grad = svgEl('linearGradient', { id: gid, x1: '0', x2: '0', y1: '0', y2: '1' });
          grad.appendChild(svgEl('stop', { offset: '0', style: 'stop-color:' + couleur + ';stop-opacity:.45' }));
          grad.appendChild(svgEl('stop', { offset: '1', style: 'stop-color:' + couleur + ';stop-opacity:0' }));
          defs.appendChild(grad); svgNode.appendChild(defs);
          var base = MT + ph, d = 'M' + X(pts[0].t) + ',' + base;
          pts.forEach(function (p) { d += ' L' + X(p.t) + ',' + Y(p.v); });
          d += ' L' + X(pts[pts.length - 1].t) + ',' + base + ' Z';
          svgNode.appendChild(svgEl('path', { d: d, class: 'chart-area', style: 'fill:url(#' + gid + ')' }));
          svgNode.appendChild(svgEl('polyline', { points: pts.map(function (p) { return X(p.t) + ',' + Y(p.v); }).join(' '), class: 'chart-line', style: 'stroke:' + couleur }));
        }
        // points colorés selon le statut (comme l'appli d'origine)
        pts.forEach(function (p) {
          svgNode.appendChild(svgEl('circle', { cx: X(p.t), cy: Y(p.v), r: 4, class: 'bg-point st-' + statut(p.v, S) }));
        });
        var cross = svgEl('line', { y1: MT, y2: MT + ph, class: 'chart-crosshair' });
        var hit = svgEl('rect', { x: ML, y: MT, width: pw, height: ph, class: 'chart-hit' });
        svgNode.appendChild(cross); svgNode.appendChild(hit);
        function survol(evt) {
          var rect = svgNode.getBoundingClientRect(), px = (evt.clientX - rect.left) / rect.width * W, proche = pts[0], best = Infinity;
          pts.forEach(function (p) { var dd = Math.abs(X(p.t) - px); if (dd < best) { best = dd; proche = p; } });
          var nx = X(proche.t), ny = Y(proche.v);
          cross.setAttribute('x1', nx); cross.setAttribute('x2', nx); cross.style.opacity = 1;
          tip.innerHTML = fmtDateHeure(proche.date) + '<br><b>' + fmt(proche.v) + ' kV</b>' + (proche.h ? ' · ' + fmt(proche.h) + ' h' : '');
          tip.style.left = Math.min(Math.max(nx / W * 100, 18), 82) + '%'; tip.style.top = (ny / Hh * 100) + '%'; tip.style.opacity = 1;
        }
        hit.addEventListener('pointermove', survol);
        hit.addEventListener('pointerdown', survol);
        hit.addEventListener('pointerleave', function () { cross.style.opacity = 0; tip.style.opacity = 0; });
        return true;
      }

      /* ----- Paramètres (comme l'appli d'origine) ----- */
      function champ(label, id, valeur, attrs) {
        var input = el('input', Object.assign({ id: id, type: 'text', inputmode: 'decimal', value: valeur === null || valeur === undefined ? '' : String(valeur) }, attrs || {}));
        return el('div', { class: 'champ' }, [el('label', { for: id }, [label]), input]);
      }
      function montrer(zone, msg, ok) { zone.textContent = msg; zone.hidden = false; zone.className = ok ? 'bg-ok' : 'bg-erreur'; }
      function ecranParametres(racine, E) {
        var P = D.parametres;
        racine.appendChild(lienRetour());

        var msgForm = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var jours = String(P.joursActifs || '1,2,3,4,5,6').split(',');
        var cases = JOURS.map(function (j) {
          return el('label', { class: 'bg-jour' }, [el('input', { type: 'checkbox', value: j[0], checked: jours.indexOf(j[0]) >= 0 ? 'checked' : null }), ' ' + j[1]]);
        });
        var j = E.releve ? Math.floor((Date.now() - new Date(E.releve).getTime()) / 86400000) : null;
        var btnTestRemp = el('button', { class: 'btn-second', type: 'button' }, ['Envoyer un test (prochain remplacement bougie)']);
        var btnTestReleve = el('button', { class: 'btn-second', type: 'button' }, ['Envoyer un test (rappel bougies + huile)']);
        var btnMarquer = el('button', { class: 'btn-second', type: 'button' }, ['Marquer un relevé complet maintenant']);
        var btnEnr = el('button', { class: 'btn-principal', type: 'submit' }, ['Enregistrer']);
        var form = el('form', { class: 'bandeau bg-form' }, [
          el('h2', {}, ['Seuils d’alerte']),
          champ('Seuil orange (kV)', 'p-orange', P.seuilOrangeKv),
          champ('Seuil rouge / alerte (kV)', 'p-rouge', P.seuilRougeKv),
          champ('Heures moteur mini pour déclencher l’alerte (h)', 'p-heures', P.seuilHeuresAlerte, { inputmode: 'numeric' }),
          el('h2', {}, ['Prochain remplacement bougie']),
          el('p', { class: 'petit' }, ['Alerte envoyée sur WhatsApp après chaque mesure si une bougie dépasse les deux seuils ci-dessous (avec un délai mini de 6 h entre deux envois).']),
          champ('Seuil heures bougie avant remplacement (h)', 'p-seuil-heures-bougie', P.seuilHeuresBougieRemplacement, { inputmode: 'numeric' }),
          el('p', { class: 'petit' }, ['Le seuil de tension utilisé est le « Seuil rouge / alerte (kV) » ci-dessus.']),
          el('div', { class: 'bg-boutons' }, [btnTestRemp]),
          el('h2', {}, ['Rappel « Contrôle bougies + Analyse huile »']),
          el('p', { class: 'petit' }, ['Dernier relevé complet des 12 bougies : ' + (E.releve ? fmtDateHeure(E.releve) + ' (il y a ' + j + ' j)' : 'jamais enregistré')]),
          champ('Jours après le relevé complet avant rappel (j)', 'p-seuil-releve', P.seuilJoursReleve, { inputmode: 'numeric' }),
          champ('Heure de rappel — matin (0 à 23 h)', 'p-heure-matin', P.heureRappelMatin, { inputmode: 'numeric' }),
          champ('Heure de rappel — après-midi (0 à 23 h)', 'p-heure-apresmidi', P.heureRappelApresMidi, { inputmode: 'numeric' }),
          el('fieldset', { class: 'bg-jours' }, [el('legend', {}, ['Jours actifs pour les rappels'])].concat(cases)),
          el('div', { class: 'bg-boutons' }, [btnMarquer, btnTestReleve]),
          msgForm,
          el('div', { class: 'bg-boutons' }, [btnEnr])
        ]);
        var val = function (id) { return form.querySelector('#' + id).value; };
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var nouveaux = {
            seuilOrangeKv: nb(val('p-orange')), seuilRougeKv: nb(val('p-rouge')), seuilHeuresAlerte: nb(val('p-heures')),
            seuilHeuresBougieRemplacement: nb(val('p-seuil-heures-bougie')), seuilJoursReleve: nb(val('p-seuil-releve')),
            heureRappelMatin: nb(val('p-heure-matin')), heureRappelApresMidi: nb(val('p-heure-apresmidi')),
            joursActifs: cases.map(function (c) { return c.querySelector('input'); }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; })
          };
          var manque = ['seuilOrangeKv', 'seuilRougeKv', 'seuilHeuresAlerte', 'seuilHeuresBougieRemplacement', 'seuilJoursReleve', 'heureRappelMatin', 'heureRappelApresMidi']
            .some(function (k) { return nouveaux[k] === null; });
          if (manque) { montrer(msgForm, 'Les seuils et heures doivent être des nombres.'); return; }
          msgForm.hidden = true;
          appelDirect({ action: 'bougies.parametres', parametres: nouveaux }, btnEnr).then(function (j) {
            D.parametres = j.parametres; D.dashboard.seuilOrangeKv = j.parametres.seuilOrangeKv; D.dashboard.seuilRougeKv = j.parametres.seuilRougeKv;
            PM.DB.set(CLE_DONNEES, D);
            PM.toast('Paramètres enregistrés.');
            afficher();
          })['catch'](function (err) { montrer(msgForm, err.message); });
        });
        btnTestRemp.addEventListener('click', function () { tester('remplacement', btnTestRemp, msgForm); });
        btnTestReleve.addEventListener('click', function () { tester('releve', btnTestReleve, msgForm); });
        btnMarquer.addEventListener('click', function () {
          confirmer('Marquer un relevé complet maintenant ? Le compteur de jours avant le prochain rappel sera remis à zéro.', function () {
            saisir({ type: 'bougies.releveComplet', horodatage: new Date().toISOString() });
            PM.toast('Relevé complet enregistré.');
            afficher();
          });
        });
        racine.appendChild(form);
        racine.appendChild(blocConfigApi(P));
      }
      function tester(quoi, bouton, zone) {
        appelDirect({ action: 'bougies.test', quoi: quoi }, bouton).then(function () { PM.toast('Message de test envoyé.'); })['catch'](function (e) { montrer(zone, e.message); });
      }

      function blocConfigApi(P) {
        var bloc = el('section', { class: 'bandeau bg-form' }, [el('h2', {}, ['Configuration API (protégée)'])]);
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        if (!codeApiValide) {
          var code = el('input', { id: 'p-code-api', type: 'password', inputmode: 'numeric', autocomplete: 'off' });
          var btn = el('button', { class: 'btn-second', type: 'button' }, ['Déverrouiller']);
          btn.addEventListener('click', function () {
            msg.hidden = true;
            appelDirect({ action: 'bougies.configApi', code: code.value.trim() }, btn).then(function (j) {
              codeApiValide = code.value.trim();
              bloc.replaceWith(blocApiOuvert(j.config));
            })['catch'](function (e) { montrer(msg, e.message); });
          });
          bloc.appendChild(el('p', { class: 'petit' }, ['Cette section nécessite un code d’accès.' + (P.apiConfiguree ? '' : ' ⚠ WhatsApp n’est pas encore configuré.')]));
          bloc.appendChild(el('div', { class: 'champ' }, [el('label', { for: 'p-code-api' }, ['Code d’accès']), code]));
          bloc.appendChild(msg);
          bloc.appendChild(el('div', { class: 'bg-boutons' }, [btn]));
        }
        return bloc;
      }
      function blocApiOuvert(cfg) {
        var msg = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var tel = el('input', { id: 'p-tel', type: 'text', value: cfg.textMeBotDestinataire || '', autocomplete: 'off' });
        // La clé n'est plus renvoyée par le serveur : champ vide = on garde la clé actuelle
        var key = el('input', { id: 'p-apikey', type: 'password', value: '', autocomplete: 'off',
          placeholder: cfg.apiKeyConfiguree ? 'Clé enregistrée (…' + (cfg.apiKeyFin || '') + ') — laisser vide pour la garder' : 'Clé API TextMeBot' });
        var btnEnr = el('button', { class: 'btn-principal', type: 'button' }, ['Enregistrer la config API']);
        var btnTest = el('button', { class: 'btn-second', type: 'button' }, ['Envoyer un test WhatsApp']);
        btnEnr.addEventListener('click', function () {
          msg.hidden = true;
          appelDirect({ action: 'bougies.enregistrerConfigApi', code: codeApiValide, destinataire: tel.value.trim(), apiKey: key.value.trim() }, btnEnr)
            .then(function () { D.parametres.apiConfiguree = !!(tel.value.trim() && (key.value.trim() || cfg.apiKeyConfiguree)); if (key.value.trim()) { cfg.apiKeyConfiguree = true; cfg.apiKeyFin = key.value.trim().slice(-4); key.value = ''; key.placeholder = 'Clé enregistrée (…' + cfg.apiKeyFin + ') — laisser vide pour la garder'; } PM.DB.set(CLE_DONNEES, D); PM.toast('Configuration API enregistrée.'); })
            ['catch'](function (e) { montrer(msg, e.message); });
        });
        btnTest.addEventListener('click', function () { tester('whatsapp', btnTest, msg); });
        return el('section', { class: 'bandeau bg-form' }, [
          el('h2', {}, ['Alerte WhatsApp (TextMeBot)']),
          el('div', { class: 'champ' }, [el('label', { for: 'p-tel' }, ['Destinataire (numéro international ex : +33612345678, ou ID de groupe se terminant par @g.us)']), tel]),
          el('div', { class: 'champ' }, [el('label', { for: 'p-apikey' }, ['Clé API TextMeBot']), key]),
          msg,
          el('div', { class: 'bg-boutons' }, [btnTest, btnEnr])
        ]);
      }

      /* ================= fenêtres (modales) ================= */
      function modale(titre, contenu, boutons) {
        var fond = el('div', { class: 'bg-modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre });
        var boite = el('div', { class: 'bg-modale-boite' }, [el('h2', {}, [titre])].concat(contenu).concat([el('div', { class: 'bg-boutons' }, boutons)]));
        fond.appendChild(boite);
        fond.addEventListener('click', function (e) { if (e.target === fond) fermer(); });
        function fermer() { fond.remove(); document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', fermer); }
        function esc(e) { if (e.key === 'Escape') fermer(); }
        document.addEventListener('keydown', esc);
        window.addEventListener('hashchange', fermer);
        document.body.appendChild(fond);
        return fermer;
      }
      function modaleValeur(titre, label, valeur, valider) {
        var input = el('input', { id: 'bg-modale-valeur', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valeur === null || valeur === undefined ? '' : String(valeur).replace('.', ',') });
        var erreur = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var ok = el('button', { class: 'btn-principal', type: 'button' }, ['Valider']);
        var annuler = el('button', { class: 'btn-second', type: 'button' }, ['Annuler']);
        var fermer = modale(titre, [el('label', { for: 'bg-modale-valeur', class: 'petit' }, [label]), input, erreur], [annuler, ok]);
        function go() {
          var v = nb(input.value);
          if (v === null) { montrer(erreur, 'Merci de saisir une valeur numérique.'); return; }
          var msg = valider(v);
          if (msg) { montrer(erreur, msg); return; }
          if (navigator.vibrate) navigator.vibrate(25);
          fermer(); afficher();
        }
        annuler.addEventListener('click', fermer);
        ok.addEventListener('click', go);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        setTimeout(function () { input.focus(); input.select(); }, 30);
      }
      function confirmer(texte, oui) {
        var b1 = el('button', { class: 'btn-second', type: 'button' }, ['Annuler']);
        var b2 = el('button', { class: 'btn-principal', type: 'button' }, ['Confirmer']);
        var fermer = modale('Confirmation', [el('p', {}, [texte])], [b1, b2]);
        b1.addEventListener('click', fermer);
        b2.addEventListener('click', function () { fermer(); oui(); });
      }

      // mêmes contrôles que le serveur d'origine, faits tout de suite sur le téléphone
      function ouvrirModaleTension(id) {
        var c = etat().cylindres.filter(function (x) { return x.id === id; })[0];
        modaleValeur('Cylindre ' + id, 'Tension mesurée (kV)', c ? c.tension : '', function (v) {
          if (v < 0 || v > 60) return 'Valeur de tension invalide (0 à 60 kV attendu).';
          saisir({ type: 'bougies.tension', cylindre: id, tension: v, horodatage: new Date().toISOString() });
        });
      }
      function ouvrirModaleRemplacement(id) {
        var E = etat();
        var c = E.cylindres.filter(function (x) { return x.id === id; })[0];
        var initiale = (c && c.heureRemplacement !== null && c.heureRemplacement !== undefined) ? c.heureRemplacement : E.heuresMoteur;
        modaleValeur('Cylindre ' + id, 'Compteur horaire au remplacement (h)', initiale, function (v) {
          if (v < 0) return 'Valeur horaire invalide.';
          if (v > E.heuresMoteur) return 'Le remplacement ne peut pas être postérieur au compteur horaire actuel (' + E.heuresMoteur + ' h).';
          saisir({ type: 'bougies.remplacement', cylindre: id, heureRemplacement: v });
        });
      }
      function ouvrirModaleCompteur() {
        var E = etat();
        modaleValeur('Compteur horaire', 'Nouvelle valeur (heures)', E.heuresMoteur, function (v) {
          if (v < 0) return 'Valeur horaire invalide.';
          if (v < E.heuresMoteur) return 'La nouvelle valeur (' + v + ' h) est inférieure au compteur actuel (' + E.heuresMoteur + ' h).';
          saisir({ type: 'bougies.compteur', heuresMoteur: v });
        });
      }
      function ouvrirModaleRetour() {
        var cat = el('select', { id: 'bg-retour-cat' }, ['Bug', 'Amélioration', 'Autre'].map(function (c) { return el('option', { value: c }, [c]); }));
        var txt = el('textarea', { id: 'bg-retour-msg', rows: '4', placeholder: 'Décris le bug ou l’amélioration souhaitée…' });
        var erreur = el('p', { class: 'bg-erreur', hidden: 'hidden' });
        var annuler = el('button', { class: 'btn-second', type: 'button' }, ['Annuler']);
        var envoyer = el('button', { class: 'btn-principal', type: 'button' }, ['Envoyer']);
        var fermer = modale('Signaler un bug / une amélioration', [
          el('div', { class: 'champ' }, [el('label', { for: 'bg-retour-cat' }, ['Type']), cat]),
          el('div', { class: 'champ' }, [el('label', { for: 'bg-retour-msg' }, ['Ton message']), txt]), erreur], [annuler, envoyer]);
        annuler.addEventListener('click', fermer);
        envoyer.addEventListener('click', function () {
          var m = txt.value.trim();
          if (!m) { montrer(erreur, 'Merci de décrire le bug ou l’amélioration avant d’envoyer.'); return; }
          appelDirect({ action: 'bougies.retour', categorie: cat.value, message: m }, envoyer).then(function () {
            fermer(); PM.toast('Merci, ton message a bien été envoyé.');
          })['catch'](function (e) { montrer(erreur, e.message); });
        });
        setTimeout(function () { txt.focus(); }, 30);
      }
    }
  };
})();
