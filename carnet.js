/* =====================================================================
   MODULE « CARNET D'INTERVENTIONS » — un carnet par site (même classeur
   central pour les deux sites, colonne Site).
   - Toutes les interventions : saisies ici, notées par les autres outils
     (pompes, bougies, agitation) et reprises des onglets « Maint … ».
   - Nouvelle intervention : mêmes rubriques que les onglets Maint, avec
     dictée vocale, recopiée dans l'onglet Maint choisi.
   - Fonctionne sans réseau (saisies ⏳ envoyées au retour du réseau).
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;
  var TYPES = ['Préventif', 'Correctif - Suite alarme', 'Correctif', 'Réglage', 'Amélioration'];
  var PAR_PAGE = 40;

  var DEMO = {
    lignes: [
      { id: 'd1', date: '2026-11-04T11:00:00Z', site: '', source: 'Listing Maint Métha', par: 'Antonin, Mathieu', supSite: 'Site', lieu: 'Pompe CC', type: 'Correctif - Suite alarme', alarme: 'Discordance', prob: 'pompe cc usée', interv: 'rplt stator + rotor (fonctionnement 3189 hrs pour 8696 t)', effet: '', efficace: '', comm: '', heures: 48766, tonnage: 195437 },
      { id: 'd2', date: '2026-10-19T11:00:00Z', site: '', source: 'Listing Maint Métha', par: 'Antonin, Alex, Mathieu', supSite: 'Site', lieu: 'Broyeur', type: 'Préventif', prob: 'Usure croix + fuite réducteur', interv: 'Rplt couteaux et 1/2 grille + remplacement réducteur/moteur', heures: 48717, tonnage: 194678 },
      { id: 'd3', date: '2026-10-14T11:00:00Z', site: '', source: 'Portail', par: 'Antonin', supSite: 'Site', lieu: 'Cogénération', type: 'Correctif - Suite alarme', prob: 'H2S élevé', interv: 'Remplacement charbon (3 big bags)', effet: 'H2S < 50 ppm', efficace: 'Oui', heures: 69542 }
    ],
    listings: [{ court: 'Métha', onglet: 'Maint Métha', copier: true }]
  };

  /* ---------- outils ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateObj(s) { if (!s) return null; var d = new Date(s); return isNaN(d) ? null : d; }
  function fmtDate(s) { var d = dateObj(s); return d ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : String(s || '—'); }
  function fmtMois(d) { return d ? d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : 'Date à vérifier'; }
  function jourLocal(d) { d = d ? new Date(d) : new Date(); if (isNaN(d)) d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtNb(v) { var n = PM.nombre(v); return n === null || isNaN(n) ? String(v || '') : Math.round(n).toLocaleString('fr-FR'); }
  function sansAccent(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function origine(l) {
    var s = String(l.source || '');
    if (s === 'Portail') return { cle: 'portail', txt: 'Portail' };
    if (s.indexOf('Listing') === 0) return { cle: 'listing', txt: s.replace('Listing ', '') };
    return { cle: 'outil', txt: s };
  }
  function efficaceClasse(v) { var t = sansAccent(v); return /^o(ui)?$/.test(t) ? 'oui' : /^n(on)?$/.test(t) ? 'non' : t ? 'autre' : ''; }

  /* ---------- dictée vocale (Chrome Android, Safari iPhone) ---------- */
  var Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
  function boutonMicro(champ) {
    if (!Reco) return null;
    var b = el('button', { type: 'button', class: 'cn-micro', title: 'Dicter', 'aria-label': 'Dicter' }, ['🎤']);
    var r = null;
    b.onclick = function () {
      if (r) { r.stop(); return; }
      try {
        r = new Reco(); r.lang = 'fr-FR'; r.interimResults = false; r.continuous = false; r.maxAlternatives = 1;
        r.onresult = function (e) {
          var t = Array.prototype.map.call(e.results, function (x) { return x[0].transcript; }).join(' ').trim();
          if (!t) return;
          t = t.charAt(0).toUpperCase() + t.slice(1);
          champ.value = champ.value.trim() ? champ.value.trim() + ' ' + t : t;
          champ.dispatchEvent(new Event('input'));
        };
        r.onerror = function (e) { if (e.error === 'not-allowed') PM.toast('Micro refusé : autorise-le dans le navigateur'); else if (e.error !== 'no-speech' && e.error !== 'aborted') PM.toast('Dictée : ' + e.error); };
        r.onend = function () { r = null; b.classList.remove('actif'); };
        r.start(); b.classList.add('actif');
      } catch (err) { r = null; PM.toast('Dictée indisponible sur ce téléphone : utilise le micro du clavier'); }
    };
    return b;
  }

  window.MODULES.carnet = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_DONNEES = 'carnet_donnees_' + ctx.site.id;
      var CLE_ATTENTE = 'carnet_attente_' + ctx.site.id;
      var D = null, attente = [], ecran = 'liste', edition = null, ouverte = null, nbAffiches = PAR_PAGE;
      var filtre = { texte: '', lieu: '', origine: '', periode: '' };

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' })]));
      Promise.all([PM.DB.get(CLE_DONNEES), PM.DB.get(CLE_ATTENTE)]).then(function (r) {
        D = (r[0] && Array.isArray(r[0].lignes)) ? r[0] : (modeDemo ? DEMO : null);
        attente = Array.isArray(r[1]) ? r[1] : [];
        if (D) afficher();
        if (!modeDemo) rafraichir(!D);
      });

      function rafraichir(premier) {
        return PM.Api.appeler(ctx.apiUrl, { action: 'carnet.lister', cle: ctx.cle }, 45000).then(function (j) {
          if (!j || !Array.isArray(j.lignes)) throw new Error((j && j.erreur) || 'Réponse incomplète du serveur');
          delete j.ok;
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
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger le carnet d’interventions.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('span', { class: 'petit' }, ['Si le serveur répond « non initialisé » : exécuter initialiserCarnet() dans l’éditeur Apps Script du site.']), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { vue.innerHTML = ''; vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])); rafraichir(true); } }, ['Réessayer'])]));
          } else PM.toast((PM.raison ? PM.raison(e) : 'Hors ligne') + ' : carnet du dernier chargement', 4000);
        });
      }
      var instance = PM.uid();
      window.__carnetInstance = instance;
      PM.Envoi.surChangement(function (n) {
        if (window.__carnetInstance !== instance || location.hash.indexOf('outil/' + ctx.outil.id) < 0) return;
        if (!n && attente.length && !modeDemo) rafraichir(false);
      });

      /* ---------- lignes affichées = serveur + saisies en attente ---------- */
      function lignes() {
        var l = D.lignes.slice();
        function depuis(a, id) {
          return { id: id, date: a.date, site: ctx.site.nom, source: 'Portail', par: a.par, supSite: a.supSite, lieu: a.lieu, type: a.typeIntervention, alarme: a.alarme,
            prob: a.prob, interv: a.interv, effet: a.effet, efficace: a.efficace, comm: a.comm, heures: a.heures, tonnage: a.tonnage, duree: a.duree,
            copie: a.copie ? 'en attente' : '', enAttente: true };
        }
        attente.forEach(function (a) {
          if (a.type === 'carnet.ajout') l.unshift(depuis(a, a.id));
          else if (a.type === 'carnet.modif') l = l.map(function (x) { return x.id === a.idLigne ? Object.assign(depuis(a, x.id), { copie: x.copie }) : x; });
          else if (a.type === 'carnet.suppr') l = l.filter(function (x) { return x.id !== a.idLigne; });
        });
        // plus récent d'abord ; le même jour, la dernière saisie d'abord (une saisie en attente avant tout)
        function cle(x) { var d = dateObj(x.date); return d ? jourLocal(d) : ''; }
        function ordre(x) { if (x.enAttente) return Infinity; var s = dateObj(x.saisiLe) || dateObj(x.date); return s ? s.getTime() : 0; }
        l.sort(function (a, b) { var x = cle(a), y = cle(b); return x !== y ? (x < y ? 1 : -1) : ordre(b) - ordre(a); });
        return l;
      }
      function valeursDistinctes(cle) {
        var vu = {}, res = [];
        lignes().forEach(function (l) {
          String(l[cle] || '').split(/\s*,\s*/).forEach(function (v) {
            v = v.trim(); var k = sansAccent(v);
            if (v && !vu[k]) { vu[k] = 1; res.push(v); }
          });
        });
        return res.sort(function (a, b) { return a.localeCompare(b, 'fr'); });
      }
      function filtrees() {
        var mots = sansAccent(filtre.texte).split(/\s+/).filter(Boolean);
        var limite = filtre.periode ? Date.now() - Number(filtre.periode) * 86400000 : 0;
        return lignes().filter(function (l) {
          if (filtre.lieu && sansAccent(l.lieu) !== sansAccent(filtre.lieu)) return false;
          if (filtre.origine && origine(l).cle !== filtre.origine) return false;
          if (limite) { var d = dateObj(l.date); if (!d || d.getTime() < limite) return false; }
          if (mots.length) {
            var t = sansAccent([l.lieu, l.par, l.type, l.alarme, l.prob, l.interv, l.effet, l.comm, l.source, fmtDate(l.date)].join(' '));
            for (var i = 0; i < mots.length; i++) if (t.indexOf(mots[i]) < 0) return false;
          }
          return true;
        });
      }

      /* ---------- écran ---------- */
      function afficher() {
        var y = window.scrollY;
        vue.innerHTML = '';
        var racine = el('div', { class: 'carnet' });
        vue.appendChild(racine);
        if (modeDemo) {
          racine.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur du site dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        if (ecran === 'form') { racine.appendChild(formulaire()); window.scrollTo(0, 0); return; }
        ecranListe(racine);
        window.scrollTo(0, y);
      }

      function ecranListe(racine) {
        var tete = el('section', { class: 'bandeau cn-tete' }, [
          el('button', { class: 'btn-principal', onclick: function () { edition = null; ecran = 'form'; afficher(); } }, ['+ Nouvelle intervention'])
        ]);
        // recherche + filtres
        var recherche = el('input', { type: 'search', class: 'cn-recherche', placeholder: 'Rechercher : pompe, H2S, stator, Pierrick…', value: filtre.texte });
        recherche.addEventListener('input', function () { filtre.texte = recherche.value; nbAffiches = PAR_PAGE; dessinerListe(); });
        var lieux = valeursDistinctes('lieu');
        var selLieu = el('select', { 'aria-label': 'Lieu' }, [el('option', { value: '' }, ['Tous les lieux'])].concat(lieux.map(function (x) { return el('option', { value: x, selected: sansAccent(x) === sansAccent(filtre.lieu) ? 'selected' : null }, [x]); })));
        selLieu.onchange = function () { filtre.lieu = selLieu.value; nbAffiches = PAR_PAGE; dessinerListe(); };
        var selOrig = el('select', { 'aria-label': 'Origine' }, [['', 'Toutes les origines'], ['portail', 'Saisies du carnet'], ['outil', 'Outils du portail'], ['listing', 'Onglets Maint']].map(function (o) { return el('option', { value: o[0], selected: filtre.origine === o[0] ? 'selected' : null }, [o[1]]); }));
        selOrig.onchange = function () { filtre.origine = selOrig.value; nbAffiches = PAR_PAGE; dessinerListe(); };
        var selPer = el('select', { 'aria-label': 'Période' }, [['', 'Depuis le début'], ['30', '30 derniers jours'], ['90', '3 derniers mois'], ['365', '12 derniers mois']].map(function (o) { return el('option', { value: o[0], selected: filtre.periode === o[0] ? 'selected' : null }, [o[1]]); }));
        selPer.onchange = function () { filtre.periode = selPer.value; nbAffiches = PAR_PAGE; dessinerListe(); };
        tete.appendChild(recherche);
        tete.appendChild(el('div', { class: 'cn-filtres' }, [selLieu, selOrig, selPer]));
        racine.appendChild(tete);
        var zone = el('div', { class: 'cn-zone' });
        racine.appendChild(zone);
        racine.appendChild(piedSynchro());

        function dessinerListe() {
          zone.innerHTML = '';
          var l = filtrees();
          zone.appendChild(el('div', { class: 'petit cn-compte' }, [l.length + (l.length > 1 ? ' interventions' : ' intervention') + (filtre.texte || filtre.lieu || filtre.origine || filtre.periode ? ' (filtrées)' : '')]));
          if (!l.length) { zone.appendChild(el('div', { class: 'vide-msg' }, [lignes().length ? 'Aucune intervention ne correspond.' : 'Aucune intervention pour l’instant.'])); return; }
          var moisCourant = null;
          l.slice(0, nbAffiches).forEach(function (x) {
            var d = dateObj(x.date), m = d ? d.getFullYear() + '-' + d.getMonth() : 'x';
            if (m !== moisCourant) { moisCourant = m; zone.appendChild(el('h3', { class: 'cn-mois' }, [fmtMois(d)])); }
            zone.appendChild(carte(x));
          });
          if (l.length > nbAffiches) zone.appendChild(el('button', { class: 'btn-second cn-plus', onclick: function () { nbAffiches += PAR_PAGE * 2; dessinerListe(); } }, ['Voir plus (' + (l.length - nbAffiches) + ' de plus)']));
        }
        dessinerListe();
      }

      function carte(x) {
        var o = origine(x), ef = efficaceClasse(x.efficace), estOuverte = ouverte === x.id;
        var c = el('article', { class: 'cn-carte' + (x.enAttente ? ' attente' : '') + (estOuverte ? ' ouverte' : ''), tabindex: '0' });
        c.onclick = function (e) { if (e.target.closest('button')) return; ouverte = estOuverte ? null : x.id; afficher(); };
        c.appendChild(el('div', { class: 'cn-ligne1' }, [
          el('span', { class: 'cn-date' }, [fmtDate(x.date) + (x.enAttente ? ' ⏳' : '')]),
          el('span', { class: 'cn-origine cn-o-' + o.cle }, [o.txt])
        ]));
        c.appendChild(el('div', { class: 'cn-lieu' }, [x.lieu || '—', x.type ? el('span', { class: 'cn-type' }, [x.type]) : null]));
        if (x.prob) c.appendChild(el('div', { class: 'cn-prob' }, ['⚠ ' + x.prob]));
        if (x.interv) c.appendChild(el('div', { class: 'cn-interv' }, ['🔧 ' + x.interv]));
        var bas = [];
        if (x.par) bas.push('👤 ' + x.par);
        if (x.heures !== '' && x.heures !== undefined && x.heures !== null) bas.push('⏱ ' + fmtNb(x.heures) + ' h');
        if (x.tonnage !== '' && x.tonnage !== undefined && x.tonnage !== null) bas.push(fmtNb(x.tonnage) + ' t');
        c.appendChild(el('div', { class: 'cn-bas' }, [el('span', { class: 'petit' }, [bas.join(' · ')]),
          ef ? el('span', { class: 'cn-eff cn-eff-' + ef }, [ef === 'oui' ? '✓ Efficace' : ef === 'non' ? '✗ Pas efficace' : String(x.efficace)]) : null]));
        if (estOuverte) {
          var det = el('dl', { class: 'cn-detail' });
          [['Site / supervision', x.supSite], ['Type d’alarme', x.alarme], ['Effet attendu', x.effet], ['Action efficace', x.efficace], ['Commentaires', x.comm],
            ['Pièces', x.pieces], ['Volume', x.volume], ['Durée', x.duree ? x.duree + ' min' : ''], ['Origine', x.source], ['Recopiée dans', x.copie ? String(x.copie).split('|')[1] || x.copie : ''],
            ['Modifiée le', x.modifLe]].forEach(function (p) {
            if (p[1] === '' || p[1] === undefined || p[1] === null) return;
            det.appendChild(el('dt', {}, [p[0]])); det.appendChild(el('dd', {}, [String(p[1])]));
          });
          c.appendChild(det);
          if (o.cle === 'portail' && !x.enAttente && !modeDemo) {
            c.appendChild(el('button', { type: 'button', class: 'btn-second', onclick: function () { edition = x; ecran = 'form'; afficher(); } }, ['✎ Modifier']));
          } else if (o.cle !== 'portail') {
            c.appendChild(el('p', { class: 'petit' }, [o.cle === 'listing' ? 'Ligne reprise de l’onglet « ' + x.source.replace('Listing ', '') + ' » : la corriger dans le fichier Données journalières.' : 'Ligne notée par « ' + x.source + ' » : la corriger dans cet outil.']));
          }
        }
        return c;
      }

      function piedSynchro() {
        var der = D && D.derniereSynchro ? new Date(D.derniereSynchro) : null;
        var b = el('button', { class: 'btn-second', disabled: modeDemo ? 'disabled' : null }, ['↻ Reprendre les onglets Maint maintenant']);
        b.onclick = function () {
          if (!navigator.onLine) { PM.toast('Pas de réseau'); return; }
          b.disabled = true; b.textContent = 'Reprise en cours…';
          PM.Api.appeler(ctx.apiUrl, { action: 'carnet.synchroniser', cle: ctx.cle }, 90000).then(function (j) {
            if (!j || !j.ok) throw new Error((j && j.erreur) || 'Erreur serveur');
            if (j.occupe) { PM.toast('Serveur occupé : réessaie dans une minute'); return; }
            var s = j.synchro, err = (s.listings || []).filter(function (l) { return l.erreur; });
            PM.toast(s.ajoutees + ' ajoutée(s), ' + s.retirees + ' retirée(s)' + (err.length ? ' — ⚠ ' + err.map(function (l) { return l.onglet; }).join(', ') + ' illisible' : ''), 5000);
            return rafraichir(false);
          })['catch'](function (e) { PM.toast(PM.raison ? PM.raison(e) : e.message, 4000); })
            .then(function () { b.disabled = false; b.textContent = '↻ Reprendre les onglets Maint maintenant'; });
        };
        return el('section', { class: 'bandeau cn-pied' }, [
          el('p', { class: 'petit' }, ['Les lignes saisies à la main dans les onglets « Maint … » des fichiers Données journalières (et celles du NH3 / Clarke) sont reprises toutes les heures.' +
            (der && !isNaN(der) ? ' Dernière reprise : ' + der.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.' : '')]),
          b
        ]);
      }

      /* ===== FORMULAIRE : nouvelle intervention / modification ===== */
      function formulaire() {
        var E = edition;
        var f = el('section', { class: 'bandeau cn-form' });
        f.appendChild(el('div', { class: 'carte-tete' }, [el('h2', {}, [E ? 'Modifier l’intervention' : 'Nouvelle intervention']),
          el('button', { type: 'button', class: 'btn-second', onclick: function () { ecran = 'liste'; edition = null; afficher(); } }, ['Fermer'])]));

        function liste(id, valeurs) { return el('datalist', { id: id }, valeurs.map(function (v) { return el('option', { value: v }); })); }
        var idL = 'cn-lieux-' + ctx.site.id, idP = 'cn-par-' + ctx.site.id;
        f.appendChild(liste(idL, valeursDistinctes('lieu')));
        f.appendChild(liste(idP, valeursDistinctes('par')));

        var date = el('input', { type: 'date', value: jourLocal(E ? E.date : null) });
        var par = el('input', { type: 'text', list: idP, value: E ? (E.par || '') : PM.Prefs.get('agent', ''), placeholder: 'Prénom(s), ex. Antonin, Mathieu', autocomplete: 'off' });
        var supSite = (E && E.supSite) || 'Site';
        var choixSup = el('div', { class: 'cn-choix' });
        ['Site', 'Supervision'].forEach(function (v) {
          var b = el('button', { type: 'button', class: 'zone-chip' + (supSite === v ? ' actif' : '') }, [v === 'Site' ? '🏭 Sur site' : '🖥 Supervision']);
          b.onclick = function () { supSite = v; choixSup.querySelectorAll('button').forEach(function (x) { x.classList.toggle('actif', x === b); }); };
          choixSup.appendChild(b);
        });
        var lieu = el('input', { type: 'text', list: idL, value: E ? (E.lieu || '') : '', placeholder: 'ex. Pompe CC, Broyeur, Compresseur, Charbons…', autocomplete: 'off' });
        var type = el('select', {}, [el('option', { value: '' }, ['— Choisir —'])].concat(TYPES.map(function (t) { return el('option', { value: t, selected: E && E.type === t ? 'selected' : null }, [t]); })));
        if (E && E.type && TYPES.indexOf(E.type) < 0) type.appendChild(el('option', { value: E.type, selected: 'selected' }, [E.type]));
        var alarme = el('input', { type: 'text', value: E ? (E.alarme || '') : '', placeholder: 'ex. 01PT121 LL AN (facultatif)' });
        function zone(val, ph) { return el('textarea', { rows: '3', placeholder: ph }, [val || '']); }
        var prob = zone(E && E.prob, 'Ce qui ne va pas : symptôme, alarme, constat…');
        var interv = zone(E && E.interv, 'Ce qui a été fait : pièces changées, réglages…');
        var effet = el('input', { type: 'text', value: E ? (E.effet || '') : '', placeholder: 'ex. redémarrage, pression normale' });
        var efficace = (E && E.efficace) || '';
        var choixEff = el('div', { class: 'cn-choix' });
        [['Oui', '✓ Oui'], ['Non', '✗ Non'], ['À vérifier', '? À vérifier']].forEach(function (v) {
          var b = el('button', { type: 'button', class: 'zone-chip' + (efficace === v[0] ? ' actif' : '') }, [v[1]]);
          b.onclick = function () { efficace = efficace === v[0] ? '' : v[0]; choixEff.querySelectorAll('button').forEach(function (x) { x.classList.toggle('actif', x === b && efficace !== ''); }); };
          choixEff.appendChild(b);
        });
        var comm = zone(E && E.comm, 'Facultatif : cause trouvée, à surveiller, fournisseur…');
        var heures = el('input', { type: 'text', inputmode: 'decimal', value: E && E.heures !== undefined ? String(E.heures === null ? '' : E.heures) : '', placeholder: 'h' });
        var tonnage = el('input', { type: 'text', inputmode: 'decimal', value: E && E.tonnage !== undefined ? String(E.tonnage === null ? '' : E.tonnage) : '', placeholder: 't' });
        var duree = el('input', { type: 'text', inputmode: 'numeric', value: E && E.duree ? String(E.duree) : '', placeholder: 'min' });
        var copies = (D.listings || []).filter(function (l) { return l.copier; });
        var copie = el('select', {}, copies.map(function (l) { return el('option', { value: l.court }, [l.onglet]); }).concat([el('option', { value: '' }, ['Ne pas recopier'])]));
        var dernierChoix = PM.Prefs.get('carnet_copie_' + ctx.site.id, null);
        if (dernierChoix !== null) copie.value = dernierChoix;

        function avecMicro(champ) { var m = boutonMicro(champ); return m ? el('div', { class: 'cn-avec-micro' }, [champ, m]) : champ; }
        f.appendChild(el('div', { class: 'cn-2col' }, [el('div', { class: 'champ' }, [el('label', {}, ['Date']), date]), el('div', { class: 'champ' }, [el('label', {}, ['Réalisée par']), par])]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Lieu / équipement']), lieu, choixSup]));
        f.appendChild(el('div', { class: 'cn-2col' }, [el('div', { class: 'champ' }, [el('label', {}, ['Type']), type]), el('div', { class: 'champ' }, [el('label', {}, ['Type d’alarme']), alarme])]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Problématique']), avecMicro(prob)]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Intervention réalisée']), avecMicro(interv)]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Effet attendu']), avecMicro(effet)]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Action efficace ?']), choixEff]));
        f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Commentaires']), avecMicro(comm)]));
        f.appendChild(el('div', { class: 'cn-3col' }, [el('div', { class: 'champ' }, [el('label', {}, ['Heures matériel']), heures]), el('div', { class: 'champ' }, [el('label', {}, ['Tonnage']), tonnage]), el('div', { class: 'champ' }, [el('label', {}, ['Durée']), duree])]));
        if (!E && copies.length) f.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Recopier dans le fichier Données journalières']), copie]));
        if (!Reco) f.appendChild(el('p', { class: 'petit' }, ['Astuce : pour dicter, touche le micro du clavier du téléphone.']));
        f.appendChild(el('p', { class: 'petit' }, ['Plus la problématique et l’effet sont précis, plus l’assistant de diagnostic sera utile ensuite.']));

        f.appendChild(el('button', { class: 'btn-principal', onclick: function () {
          var champs = {
            date: date.value, par: par.value.trim(), supSite: supSite, lieu: lieu.value.trim(), typeIntervention: type.value, alarme: alarme.value.trim(),
            prob: prob.value.trim(), interv: interv.value.trim(), effet: effet.value.trim(), efficace: efficace, comm: comm.value.trim(),
            heures: heures.value.trim(), tonnage: tonnage.value.trim(), duree: duree.value.trim()
          };
          if (!/^\d{4}-\d{2}-\d{2}$/.test(champs.date)) { PM.toast('Date invalide'); date.focus(); return; }
          if (!champs.par) { PM.toast('Indique qui a réalisé l’intervention'); par.focus(); return; }
          if (!champs.lieu) { PM.toast('Indique le lieu / l’équipement'); lieu.focus(); return; }
          if (!champs.prob && !champs.interv) { PM.toast('Décris le problème ou l’intervention'); prob.focus(); return; }
          var nombres = [[heures, 'Heures'], [tonnage, 'Tonnage'], [duree, 'Durée']];
          for (var i = 0; i < nombres.length; i++) {
            var v = nombres[i][0].value.trim();
            if (v && isNaN(PM.nombre(v))) { PM.toast(nombres[i][1] + ' : nombre attendu'); nombres[i][0].focus(); return; }
          }
          if (!E && !PM.Prefs.get('agent', '')) PM.Prefs.set('agent', champs.par.split(',')[0].trim());
          if (E) {
            champs.type = 'carnet.modif'; champs.idLigne = E.id;
            enregistrer(champs, 'Intervention modifiée');
          } else {
            champs.type = 'carnet.ajout'; champs.copie = copies.length ? copie.value : '';
            PM.Prefs.set('carnet_copie_' + ctx.site.id, copie.value);
            enregistrer(champs, 'Intervention enregistrée');
          }
        } }, [E ? 'Enregistrer la modification' : 'Enregistrer l’intervention']));

        if (E) {
          var b = el('button', { type: 'button', class: 'btn-second cn-suppr' }, ['Supprimer cette intervention']);
          var arme = false;
          b.onclick = function () {
            if (!arme) { arme = true; b.textContent = 'Confirmer la suppression ?'; b.classList.add('arme'); setTimeout(function () { arme = false; b.textContent = 'Supprimer cette intervention'; b.classList.remove('arme'); }, 5000); return; }
            enregistrer({ type: 'carnet.suppr', idLigne: E.id }, 'Intervention supprimée');
          };
          f.appendChild(b);
          if (E.copie) f.appendChild(el('p', { class: 'petit' }, ['La copie dans « ' + (String(E.copie).split('|')[1] || 'l’onglet Maint') + ' » est corrigée aussi (sauf si elle a été retouchée à la main entre-temps).']));
        }
        return f;
      }

      /* Enregistrement : affiché tout de suite, envoyé dès que possible */
      function enregistrer(payload, message) {
        payload.id = PM.uid();
        if (!modeDemo) {
          attente.push(payload);
          PM.DB.set(CLE_ATTENTE, attente);
          PM.Envoi.ajouter(ctx.site.id, JSON.parse(JSON.stringify(payload)));
        }
        PM.toast(message + (modeDemo ? ' (démo, non envoyé)' : (navigator.onLine ? '' : ' · envoi au retour du réseau')));
        ecran = 'liste'; edition = null; ouverte = null;
        afficher();
        window.scrollTo(0, 0);
      }
    }
  };
})();
