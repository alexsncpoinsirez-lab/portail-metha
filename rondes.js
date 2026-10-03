/* =====================================================================
   MODULE « RONDE JOURNALIÈRE » — Métha de la Rotte — version rapide
   Même déroulé que l'appli d'origine :
   - un point de contrôle à la fois, réponse = passage au point suivant ;
   - « Précédent » pour corriger (une réponse déjà envoyée est remplacée) ;
   - notes entre parenthèses cliquables, photos de référence, bandeau
     « Dernière fois : … » si le point était en alerte au dernier passage ;
   - photos multiples, bip + vibration, « Merci … pour la ronde ! » ;
   - envoi groupé par zone, reprise de la ronde du jour, sans réseau ;
   - onglets Tableau de bord et Messagerie.
   ===================================================================== */
(function () {
  'use strict';
  var PM = window.PM, el = PM.el;

  /* Points de démonstration : utilisés tant que le serveur n'est pas réglé */
  var DEMO = {
    nomSite: 'Métha de la Rotte (démo)',
    derniereRonde: { date: '01/10/2026 09:11', agent: 'Mathieu', duree: 272 },
    agents: ['Mathieu', 'Charles', 'Thibaut'],
    points: [
      { zone: 'Supervision', libelle: 'Contrôle courbe production J-1', notes: [], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Supervision', libelle: 'Contrôle des alarmes', notes: [], reponses: ['Absence de défaut', 'Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], reponsesAlerte: ['Présence de défaut réparation effectuée', 'Présence de défaut réparation différée'], photos: [] },
      { zone: 'Supervision', libelle: 'Contrôle T° cuves', notes: ['45°'], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [], derniereAlerte: true, derniereReponseAlerte: 'Non conforme' },
      { zone: 'Supervision', libelle: 'Contrôle valeurs gaz avant charbon', notes: ['CH4 50-54%', 'O2 0,6%', 'H2S réagir si la valeur est au dessus de 250 ppm'], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Incorporation', libelle: 'Contrôle usure vis verticale', notes: [], reponses: ['Conforme', 'Non conforme'], reponsesAlerte: ['Non conforme'], photos: [] },
      { zone: 'Incorporation', libelle: 'Nettoyage des fonds poussant', notes: [], reponses: ['Effectué', 'Reporté'], reponsesAlerte: ['Reporté'], photos: [], derniereAlerte: true, derniereReponseAlerte: 'Reporté' }
    ]
  };

  function jourCourant() { return new Date().toDateString(); }
  function cleDuPoint(p) { return p.zone + '||' + p.libelle; }

  /* Bip + vibration à chaque réponse (comme l'original) */
  var audio = null;
  function debloquerAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }
  function vibrerEtBip() {
    if (navigator.vibrate) navigator.vibrate(150);
    try {
      if (!audio) return;
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15);
    } catch (e) {}
  }
  function direMerci(prenom) {
    if (!window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(prenom ? 'Merci ' + prenom + ' pour la ronde !' : 'Merci pour la ronde !');
      u.lang = 'fr-FR'; window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* Réduit une photo avant envoi (1280 px, JPEG) */
  function compresserPhoto(fichier) {
    return new Promise(function (ok, ko) {
      var lecteur = new FileReader();
      lecteur.onerror = ko;
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = ko;
        img.onload = function () {
          var r = Math.min(1, 1280 / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', 0.72));
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }
  function visionneuse(src) {
    var v = el('div', { class: 'visionneuse', onclick: function () { v.remove(); } }, [el('img', { src: src, alt: '' })]);
    document.body.appendChild(v);
  }

  window.MODULES.rondes = {
    afficher: function (vue, ctx) {
      var modeDemo = !ctx.apiUrl;
      var CLE_CFG = 'ronde2_cfg_' + ctx.site.id;
      var CLE_BROUILLON = 'ronde2_brouillon_' + ctx.site.id;
      var config = null, R = null, onglet = 'ronde', index = 0, enFin = false, recapFin = null;

      vue.appendChild(el('div', { class: 'chargement' }, [el('div', { class: 'squelette' }), el('div', { class: 'squelette' }),
        el('p', { class: 'petit', style: 'text-align:center' }, ['Chargement des points de contrôle…'])]));
      Promise.all([PM.DB.get(CLE_CFG), PM.DB.get(CLE_BROUILLON)]).then(function (r) {
        config = r[0] || (modeDemo ? DEMO : null);
        R = r[1] && r[1].jour === jourCourant() ? r[1] : null;
        if (!modeDemo) rafraichir(!config);
        if (config) demarrer();
      })['catch'](probleme);

      // En cas de souci, on affiche la cause au lieu de rester bloqué sur l'écran de chargement
      function probleme(e) {
        console.error('Ronde :', e);
        vue.innerHTML = '';
        vue.appendChild(el('div', { class: 'vide-msg' }, [
          'La ronde n’a pas pu s’afficher.', el('br'),
          el('span', { class: 'petit' }, [String(e && e.message || e)]), el('br'), el('br'),
          el('button', { class: 'btn-second', onclick: function () {
            Promise.all([PM.DB.del(CLE_CFG)]).then(function () { location.reload(); });
          } }, ['Recharger les points depuis le serveur']), el('br'), el('br'),
          el('button', { class: 'btn-second', onclick: function () {
            if (!confirm('Effacer la ronde en cours sur cet appareil ? Les réponses déjà envoyées restent dans la feuille.')) return;
            Promise.all([PM.DB.del(CLE_CFG), PM.DB.del(CLE_BROUILLON)]).then(function () { location.reload(); });
          } }, ['Repartir de zéro sur cet appareil'])
        ]));
      }

      function rafraichir(premier) {
        PM.Api.appeler(ctx.apiUrl, { action: 'config', cle: ctx.cle }, 45000).then(function (j) {
          delete j.ok;
          if (!j.points || !j.points.length) throw new Error('Aucun point de contrôle actif reçu du serveur.');
          var change = JSON.stringify(j) !== JSON.stringify(config);
          config = j; PM.DB.set(CLE_CFG, j);
          if (change && onglet === 'ronde' && !enFin) { try { demarrer(); } catch (err) { probleme(err); } }
        })['catch'](function (e) {
          if (premier) {
            vue.innerHTML = '';
            vue.appendChild(el('div', { class: 'vide-msg' }, ['Impossible de charger les points de contrôle.', el('br'), el('span', { class: 'petit' }, [e.message]), el('br'), el('br'),
              el('button', { class: 'btn-second', onclick: function () { location.hash = 'reglages'; } }, ['Ouvrir les réglages'])]));
          } else PM.toast('Hors ligne : points de contrôle du dernier chargement');
        });
      }

      function sauver() { if (R) PM.DB.set(CLE_BROUILLON, R); }

      /* Zones contiguës dans l'ordre des points (comme regrouperParZone_) */
      function zones() {
        var z = [];
        config.points.forEach(function (p, i) {
          var d = z[z.length - 1];
          if (d && d.nom === p.zone) d.indices.push(i); else z.push({ nom: p.zone, indices: [i] });
        });
        return z;
      }
      function zoneDe(i) { return zones().filter(function (z) { return z.indices.indexOf(i) >= 0; })[0]; }
      function rep(i) { return R.reponses[cleDuPoint(config.points[i])]; }

      function demarrer() {
        if (!R) R = { jour: jourCourant(), agent: PM.Prefs.get('agent', ''), debut: null, reponses: {} };
        index = config.points.length;
        for (var i = 0; i < config.points.length; i++) { var x = rep(i); if (!x || !x.reponse) { index = i; break; } }
        enFin = false;
        afficher();
      }

      /* ---------- habillage : onglets ---------- */
      function afficher() {
        vue.innerHTML = '';
        if (modeDemo) {
          vue.appendChild(el('div', { class: 'bandeau', style: 'border-color:var(--attente)' }, [
            el('b', {}, ['Mode démonstration. ']), el('span', { class: 'petit' }, ['Rien n’est envoyé. Renseigne le serveur dans ']),
            el('a', { href: '#reglages' }, ['Réglages']), '.']));
        }
        var tabs = el('div', { class: 'onglets', role: 'tablist' });
        [['ronde', 'Ronde du jour'], ['dashboard', 'Tableau de bord'], ['messagerie', 'Messagerie']].forEach(function (t) {
          tabs.appendChild(el('button', { role: 'tab', class: onglet === t[0] ? 'actif' : '', onclick: function () { onglet = t[0]; afficher(); } }, [t[1]]));
        });
        vue.appendChild(tabs);
        if (onglet === 'ronde') { if (enFin) ecranFin(); else ecranRonde(); }
        else if (onglet === 'dashboard') ecranDashboard();
        else ecranMessagerie();
      }

      /* ---------- RONDE : un point à la fois ---------- */
      function ecranRonde() {
        var total = config.points.length;
        // Agent
        var champAgent = el('input', { type: 'text', placeholder: 'Ton prénom', value: R.agent || '' });
        champAgent.addEventListener('change', function () { R.agent = champAgent.value.trim(); PM.Prefs.set('agent', R.agent); sauver(); });
        var agentsRapides = el('div', { class: 'agents' }, (config.agents || []).slice(0, 5).map(function (a) {
          return el('button', { class: 'btn-second' + (a === R.agent ? ' actif' : ''), onclick: function () { R.agent = a; PM.Prefs.set('agent', a); sauver(); afficher(); } }, [a]);
        }));
        var dr = config.derniereRonde;
        vue.appendChild(el('div', { class: 'champ' }, [el('label', {}, ['Agent effectuant la ronde']), champAgent, R.agent ? null : agentsRapides,
          dr ? el('div', { class: 'petit' }, ['Dernière ronde : ' + dr.date + ' · ' + dr.agent + (dr.duree ? ' · ' + dr.duree + ' min' : '')]) : null]));

        if (!total) { vue.appendChild(el('div', { class: 'vide-msg' }, ['Aucun point de contrôle actif. Vérifie la feuille PointsControle.'])); return; }
        if (index >= total) { terminer(); return; }

        // Progression
        vue.appendChild(el('div', { class: 'ronde-progress' }, [el('div', { style: 'width:' + Math.round(index / total * 100) + '%' })]));
        vue.appendChild(el('div', { class: 'ronde-nav' }, [
          el('button', { class: 'ronde-precedent', disabled: index === 0 ? 'disabled' : null, onclick: function () { if (index > 0) { index--; afficher(); } } }, ['◀ Précédent']),
          el('span', { class: 'petit' }, ['Point ' + (index + 1) + ' / ' + total])
        ]));

        var p = config.points[index], cle = cleDuPoint(p);
        var x = R.reponses[cle] || (R.reponses[cle] = { reponse: null, note: undefined, photos: [], idSaisie: PM.uid(), envoye: false });
        if (x.note === undefined) x.note = p.notes && p.notes.length === 1 ? p.notes[0] : null;

        var carte = el('div', { class: 'bandeau ronde-carte' });
        if (p.derniereAlerte) carte.appendChild(el('div', { class: 'ronde-badge-alerte' }, ['⚠ Dernière fois : ' + p.derniereReponseAlerte]));
        carte.appendChild(el('div', { class: 'ronde-zone' }, [p.zone]));
        carte.appendChild(el('h2', { class: 'ronde-libelle' }, [p.libelle]));

        // Notes cliquables (la note choisie part en commentaire / détail de l'alerte)
        if (p.notes && p.notes.length) {
          var notes = el('div', { class: 'ronde-notes' });
          p.notes.forEach(function (n) {
            notes.appendChild(el('div', { class: 'ronde-note' + (x.note === n ? ' selectionnee' : ''), onclick: function () {
              x.note = x.note === n ? null : n; sauver(); afficher();
            } }, [n]));
          });
          carte.appendChild(notes);
        }

        // Photos de référence
        var refs = (p.photos || []).filter(function (u) { return u.indexOf('ID_DU_FICHIER') < 0; });
        if (refs.length) {
          carte.appendChild(el('div', { class: 'ronde-refs' + (refs.length > 1 ? ' multiples' : '') }, refs.map(function (u) {
            return el('img', { src: u, alt: 'Photo de référence', loading: 'lazy', onclick: function () { visionneuse(u); }, onerror: function () { this.remove(); } });
          })));
        }

        // Photos de la réponse (une ou plusieurs)
        var input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: 'multiple', style: 'display:none' });
        input.addEventListener('change', function () {
          var fichiers = Array.prototype.slice.call(input.files || []);
          if (!fichiers.length) return;
          PM.toast('Préparation de la photo…', 1200);
          Promise.all(fichiers.map(compresserPhoto)).then(function (ds) {
            x.photos = (x.photos || []).concat(ds); x.photosNouvelles = true; sauver(); afficher();
          })['catch'](function () { PM.toast('Photo illisible'); });
        });
        var miniatures = el('div', { class: 'ronde-miniatures' }, (x.photos || []).map(function (src, k) {
          return el('div', { class: 'ronde-mini' }, [
            el('img', { src: src, alt: '', onclick: function () { visionneuse(src); } }),
            el('button', { class: 'ronde-mini-x', 'aria-label': 'Retirer', onclick: function () { x.photos.splice(k, 1); sauver(); afficher(); } }, ['✕'])
          ]);
        }));
        carte.appendChild(el('div', { class: 'ronde-photo' }, [input, el('button', { class: 'btn-photo', onclick: function () { input.click(); } }, ['📷 Ajouter une photo']), miniatures]));

        // Réponses : un clic = enregistré + point suivant
        var grille = el('div', { class: 'reponses' });
        p.reponses.forEach(function (r) {
          var estAlerte = p.reponsesAlerte.indexOf(r) >= 0;
          grille.appendChild(el('button', { class: 'rep' + (x.reponse === r ? ' choisi' : '') + (estAlerte ? ' alerte' : ''), onclick: function () {
            debloquerAudio();
            repondre(index, r);
          } }, [r]));
        });
        carte.appendChild(grille);
        if (x.envoye) carte.appendChild(el('div', { class: 'petit', style: 'margin-top:8px' }, ['✓ Déjà envoyé — une nouvelle réponse remplacera la précédente.']));
        vue.appendChild(carte);
      }

      function payload(i) {
        var p = config.points[i], x = rep(i);
        return {
          type: 'reponse', idSaisie: x.idSaisie, agent: R.agent || '', horodatage: x.horodatage,
          zone: p.zone, libelle: p.libelle, reponse: x.reponse, reponsesAlerte: p.reponsesAlerte,
          commentaire: x.note || '', photos: x.photosNouvelles ? (x.photos || []) : [],
          photoNomFichier: p.libelle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
        };
      }
      function envoyer(i) {
        var x = rep(i), pl = payload(i);
        if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, pl, pl.photos.length > 0);
        x.envoye = true; x.photosNouvelles = false;
      }

      function repondre(i, r) {
        var x = rep(i);
        if (!R.debut) R.debut = new Date().toISOString();
        x.reponse = r; x.horodatage = new Date().toISOString();
        vibrerEtBip();
        if (x.envoye) {
          // Correction d'un point déjà envoyé : renvoi immédiat (la ligne sera remplacée)
          envoyer(i); sauver(); PM.toast('Réponse corrigée');
          afficher(); return;
        }
        var z = zoneDe(i);
        if (z.indices[z.indices.length - 1] === i) z.indices.forEach(function (k) { if (rep(k) && rep(k).reponse && !rep(k).envoye) envoyer(k); });
        sauver();
        index = i + 1;
        // Saute les points déjà répondus (retour en arrière puis reprise)
        while (index < config.points.length && rep(index) && rep(index).reponse && rep(index).envoye) index++;
        afficher();
        window.scrollTo(0, 0);
      }

      /* ---------- Fin de ronde ---------- */
      function terminer() {
        // Points répondus mais pas encore envoyés (zone incomplète) : on envoie tout
        config.points.forEach(function (p, i) { var x = rep(i); if (x && x.reponse && !x.envoye) envoyer(i); });
        var fin = new Date().toISOString();
        var nb = 0, alertes = 0;
        config.points.forEach(function (p, i) { var x = rep(i); if (x && x.reponse) { nb++; if (p.reponsesAlerte.indexOf(x.reponse) >= 0) alertes++; } });
        if (!modeDemo && R.debut) PM.Envoi.ajouter(ctx.site.id, { type: 'finRonde', agent: R.agent || '', debut: R.debut, fin: fin });
        recapFin = { nb: nb, alertes: alertes, duree: R.debut ? Math.max(0, Math.round((new Date(fin) - new Date(R.debut)) / 60000)) : null };
        direMerci(R.agent);
        R = null; PM.DB.del(CLE_BROUILLON);
        enFin = true;
        afficher();
      }

      function ecranFin() {
        var statut = el('div', { class: 'petit' });
        function maj(n) {
          statut.textContent = modeDemo ? 'Mode démo : rien n’a été envoyé.'
            : (n ? (navigator.onLine ? 'Envoi en cours… (' + n + ' restant)' : 'Pas de réseau : envoi automatique dès le retour du réseau (' + n + ' en attente).')
                 : 'Tout est enregistré dans la feuille Google ✓' + (recapFin.alertes ? ' — alertes WhatsApp regroupées envoyées si le seuil est atteint.' : ''));
        }
        PM.Envoi.surChangement(maj); PM.Envoi.compter().then(maj);
        vue.appendChild(el('div', { class: 'bandeau', style: 'text-align:center;padding:28px 16px' }, [
          el('div', { style: 'font-size:22px;font-weight:800' }, ['✅ Ronde terminée']),
          el('p', {}, [recapFin.nb + ' point(s) renseigné(s), ' + (recapFin.alertes ? recapFin.alertes + ' réponse(s) en anomalie' : 'aucune alerte') + (recapFin.duree !== null ? ' · Durée : ' + recapFin.duree + ' min' : '') + '.']),
          statut, el('div', { style: 'height:12px' }),
          el('button', { class: 'btn-principal', onclick: function () { enFin = false; R = null; demarrer(); if (!modeDemo) rafraichir(false); } }, ['Démarrer une nouvelle ronde'])
        ]));
      }

      /* ---------- Tableau de bord (en ligne) ---------- */
      function ecranDashboard() {
        var zone = el('div', {}, [el('div', { class: 'chargement' }, [el('div', { class: 'squelette' })])]);
        vue.appendChild(zone);
        if (modeDemo) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Disponible une fois le serveur réglé.'])); return; }
        PM.Api.appeler(ctx.apiUrl, { action: 'dashboard', cle: ctx.cle }, 30000).then(function (s) {
          zone.innerHTML = '';
          zone.appendChild(el('div', { class: 'ronde-stats' }, [
            [s.nbJoursAvecRonde30j, 'jours de ronde (30 j)'], [s.tauxCompletionMoyen + '%', 'taux de complétion moyen'],
            [s.totalEntrees30j, 'relevés (30 j)'], [s.messagesOuverts, 'message(s) non traité(s)']
          ].map(function (c) { return el('div', { class: 'bandeau ronde-stat' }, [el('div', { class: 'ronde-stat-val' }, [String(c[0])]), el('div', { class: 'petit' }, [c[1]])]); })));
          zone.appendChild(el('h3', { class: 'ronde-h3' }, ['Alertes les plus fréquentes (30 j)']));
          zone.appendChild(s.topAlertes.length ? el('div', {}, s.topAlertes.map(function (a) {
            return el('div', { class: 'bandeau ronde-ligne' }, [el('div', {}, [el('b', {}, [a.zone + ' — ' + a.libelle]), el('div', { class: 'petit' }, ['réponse : ' + a.reponse])]), el('span', { class: 'ronde-compte' }, [a.occurrences + '×'])]);
          })) : el('p', { class: 'petit' }, ['Aucune alerte récurrente sur les 30 derniers jours.']));
          zone.appendChild(el('h3', { class: 'ronde-h3' }, ['Dernières alertes']));
          zone.appendChild(s.dernieresAlertes.length ? el('div', {}, s.dernieresAlertes.map(function (a) {
            var photos = String(a.photoUrl || '').split('\n').filter(Boolean);
            return el('div', { class: 'bandeau ronde-anomalie' }, [
              el('b', {}, [a.zone + ' — ' + a.libelle]),
              el('div', { class: 'petit' }, [a.horodatage + ' · ' + a.agent + ' · réponse : ' + a.reponse]),
              a.commentaire ? el('div', { class: 'petit' }, [a.commentaire]) : null,
              photos.length ? el('div', {}, photos.map(function (u, k) { return el('a', { href: u, target: '_blank', rel: 'noopener', class: 'ronde-lien-photo' }, ['📷 ' + (photos.length > 1 ? 'Photo ' + (k + 1) : 'Voir la photo')]); })) : null
            ]);
          })) : el('p', { class: 'petit' }, ['Aucune alerte récente.']));
        })['catch'](function (e) { zone.innerHTML = ''; zone.appendChild(el('div', { class: 'vide-msg' }, ['Tableau de bord indisponible (réseau ?)', el('br'), el('span', { class: 'petit' }, [e.message])])); });
      }

      /* ---------- Messagerie (bugs / améliorations) ---------- */
      function ecranMessagerie() {
        var type = el('select', {}, ['Bug', 'Amélioration'].map(function (t) { return el('option', { value: t }, [t]); }));
        var texte = el('textarea', { rows: '4', placeholder: 'Décris le problème ou l’idée…' });
        vue.appendChild(el('div', { class: 'bandeau' }, [
          el('h3', { class: 'ronde-h3', style: 'margin-top:0' }, ['Signaler un bug ou une amélioration']),
          el('div', { class: 'champ' }, [el('label', {}, ['Type']), type]),
          el('div', { class: 'champ' }, [el('label', {}, ['Message']), texte]),
          el('button', { class: 'btn-principal', onclick: function () {
            var t = texte.value.trim();
            if (!t) { PM.toast('Écris un message avant d’envoyer.'); return; }
            if (!modeDemo) PM.Envoi.ajouter(ctx.site.id, { type: 'message', agent: PM.Prefs.get('agent', ''), typeMessage: type.value, texte: t, horodatage: new Date().toISOString() });
            texte.value = '';
            PM.toast(modeDemo ? 'Démo : message non envoyé' : 'Message envoyé');
            setTimeout(chargerListe, 2500);
          } }, ['Envoyer'])
        ]));
        var liste = el('div');
        vue.appendChild(el('h3', { class: 'ronde-h3' }, ['Historique']));
        vue.appendChild(liste);
        function chargerListe() {
          if (modeDemo) { liste.innerHTML = ''; liste.appendChild(el('p', { class: 'petit' }, ['Disponible une fois le serveur réglé.'])); return; }
          PM.Api.appeler(ctx.apiUrl, { action: 'messages', cle: ctx.cle }, 25000).then(function (j) {
            liste.innerHTML = '';
            if (!j.messages.length) { liste.appendChild(el('p', { class: 'petit' }, ['Aucun message pour le moment.'])); return; }
            j.messages.forEach(function (m) {
              liste.appendChild(el('div', { class: 'bandeau ronde-ligne' }, [
                el('div', {}, [el('span', { class: 'ronde-type' }, [m.type]), ' ', el('b', {}, [m.agent]), el('span', { class: 'petit' }, [' · ' + m.horodatage]), el('div', {}, [m.texte])]),
                m.statut === 'Nouveau'
                  ? el('button', { class: 'btn-second', onclick: function () {
                      PM.Api.appeler(ctx.apiUrl, { action: 'messageTraite', cle: ctx.cle, ligne: m.ligne }).then(chargerListe)['catch'](function (e) { PM.toast(e.message); });
                    } }, ['Marquer traité'])
                  : el('span', { class: 'petit' }, ['Traité'])
              ]));
            });
          })['catch'](function () { liste.innerHTML = ''; liste.appendChild(el('p', { class: 'petit' }, ['Historique indisponible hors ligne.'])); });
        }
        chargerListe();
      }
    }
  };
})();
